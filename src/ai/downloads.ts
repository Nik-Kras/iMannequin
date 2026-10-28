// Model downloads into the same Cache API store transformers.js reads ("transformers-cache", keyed by
// the Hub URL), streamed to disk with real progress and without loading the model into memory.
import { deviceFor } from './client';
import { hfUrl, modelBytes, spec as specOf, type Device, type ModelSpec } from './registry';

const CACHE = 'transformers-cache';

async function cache(): Promise<Cache | null> {
  try {
    return typeof caches === 'undefined' ? null : await caches.open(CACHE);
  } catch {
    return null;
  }
}

function filesOf(s: ModelSpec, device: Device): [string, number][] {
  return Object.entries(s.files?.[device] ?? {});
}

/** True when every file the model needs on this device is in the cache. Built-in models always are. */
export async function isDownloaded(modelId: string): Promise<boolean> {
  const s = specOf(modelId);
  if (!s) return false;
  if (s.runtime !== 'transformers') return true;
  const c = await cache();
  if (!c) return false;
  const device = await deviceFor(s);
  for (const [file] of filesOf(s, device)) if (!(await c.match(hfUrl(s.source, file)))) return false;
  return true;
}

/** Bytes still to download for these models on this device. */
export async function remainingBytes(ids: string[]): Promise<{ total: number; remaining: number }> {
  const c = await cache();
  let total = 0, remaining = 0;
  for (const id of ids) {
    const s = specOf(id);
    if (!s || s.runtime !== 'transformers') continue;
    const device = await deviceFor(s);
    for (const [file, size] of filesOf(s, device)) {
      total += size;
      if (!c || !(await c.match(hfUrl(s.source, file)))) remaining += size;
    }
  }
  return { total, remaining };
}

export async function downloadSize(modelId: string): Promise<number> {
  const s = specOf(modelId);
  return s ? modelBytes(s, await deviceFor(s)) : 0;
}

/**
 * Downloads a model's files that aren't cached yet. `onProgress` gets bytes done (including files
 * already cached) and the total. Pass an AbortSignal to pause; finished files stay cached.
 */
export async function downloadModel(modelId: string, onProgress?: (done: number, total: number) => void, signal?: AbortSignal): Promise<void> {
  const s = specOf(modelId);
  if (!s || s.runtime !== 'transformers') return;
  const c = await cache();
  if (!c) throw new Error('This browser has no storage for models');
  const device = await deviceFor(s);
  const files = filesOf(s, device);
  const total = files.reduce((a, [, n]) => a + n, 0);
  let done = 0;
  for (const [file, size] of files) {
    const url = hfUrl(s.source, file);
    if (await c.match(url)) { done += size; onProgress?.(done, total); continue; }
    const res = await fetch(url, { signal });
    if (!res.ok || !res.body) throw new Error(`Download failed (${res.status}): ${file}`);
    const type = res.headers.get('content-type') ?? 'application/octet-stream';
    if (res.headers.get('content-encoding') || !res.headers.get('content-length')) {
      // Small compressed metadata: store the decoded bytes with their true length.
      const buf = await res.arrayBuffer();
      await c.put(url, new Response(buf, { status: 200, headers: { 'content-type': type, 'content-length': String(buf.byteLength) } }));
      done += size;
      onProgress?.(done, total);
      continue;
    }
    const base = done;
    let got = 0;
    let lastReport = 0;
    const counted = res.body.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, ctrl) {
        got += chunk.byteLength;
        if (got - lastReport > 256 * 1024) { lastReport = got; onProgress?.(base + Math.min(got, size), total); }
        ctrl.enqueue(chunk);
      },
    }));
    const headers = { 'content-type': type, 'content-length': res.headers.get('content-length')! };
    await c.put(url, new Response(counted, { status: 200, headers }));
    done = base + size;
    onProgress?.(done, total);
  }
}

/** Removes a model's files from the cache (both devices' variants). */
export async function deleteDownload(modelId: string): Promise<void> {
  const s = specOf(modelId);
  const c = await cache();
  if (!s || !c || s.runtime !== 'transformers') return;
  const shared = new Set<string>();
  for (const d of ['webgpu', 'wasm'] as Device[]) for (const [file] of filesOf(s, d)) shared.add(file);
  for (const file of shared) await c.delete(hfUrl(s.source, file));
}
