// Embedding helpers on the main thread: text embeddings are computed once per model and prompt set,
// then kept in memory and in the Cache API, so classifying a photo needs only the image encoder.
import { failKey, guarded, markFailed, run, deviceFor, isNetworkError, failedModels, gpuStorageBuffers } from './client';
import { spec as specOf, specsFor, chosenModel, type ModelSpec } from './registry';
import type { AppSettings } from '../domain/types';
import { categoryPrompts, categoryVectors, suggestSeasons, topCategories, WARMTH_PROMPTS, zeroShot } from './classify';

const mem = new Map<string, Float32Array[]>();
const STORE = 'imannequin-ai';

function hash(s: string): string {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return (h >>> 0).toString(36);
}

const cacheUrl = (key: string) => new URL(`${import.meta.env.BASE_URL}__ai/text/${encodeURIComponent(key)}`, location.origin).href;

async function readStored(key: string, count: number): Promise<Float32Array[] | null> {
  try {
    const c = await caches.open(STORE);
    const r = await c.match(cacheUrl(key));
    if (!r) return null;
    const all = new Float32Array(await r.arrayBuffer());
    const dim = all.length / count;
    if (!Number.isInteger(dim)) return null;
    return Array.from({ length: count }, (_, i) => all.slice(i * dim, (i + 1) * dim));
  } catch {
    return null;
  }
}

async function writeStored(key: string, vs: Float32Array[]): Promise<void> {
  try {
    const dim = vs[0]?.length ?? 0;
    const all = new Float32Array(vs.length * dim);
    vs.forEach((v, i) => all.set(v, i * dim));
    const c = await caches.open(STORE);
    await c.put(cacheUrl(key), new Response(all.buffer, { headers: { 'content-type': 'application/octet-stream' } }));
  } catch { /* no cache: recompute next time */ }
}

/** Text embeddings for `texts` with a classification model (cached). */
export async function textEmbeddings(s: ModelSpec, texts: string[], opts: { store?: boolean } = {}): Promise<Float32Array[]> {
  const key = `${s.id}:${hash(texts.join('\n'))}:${texts.length}`;
  const hit = mem.get(key) ?? (opts.store !== false ? await readStored(key, texts.length) : null);
  if (hit) { mem.set(key, hit); return hit; }
  const device = await deviceFor(s);
  const k = failKey(s.id, device);
  const vs = await guarded(k, () => run<Float32Array[]>(k, { type: 'embed-text', texts, spec: s }));
  mem.set(key, vs);
  if (opts.store !== false) await writeStored(key, vs);
  return vs;
}

export async function imageEmbedding(s: ModelSpec, blob: Blob): Promise<Float32Array> {
  const device = await deviceFor(s);
  const k = failKey(s.id, device);
  return guarded(k, () => run<Float32Array>(k, { type: 'embed-image', blob, spec: s }));
}

/**
 * The model to use for a task: the user's choice, unless it failed on this device before, then the
 * next candidate. Null when none is left.
 */
export async function usableModel(settings: Pick<AppSettings, 'models'> | undefined, task: ModelSpec['task'], filter: (s: ModelSpec) => boolean = (s) => s.runtime === 'transformers'): Promise<ModelSpec | null> {
  const chosen = chosenModel(settings, task);
  const list = [chosen, ...specsFor(task).filter((s) => s.id !== chosen.id)].filter(filter);
  for (const s of list) {
    if (await unusableHere(s)) continue;
    return s;
  }
  return null;
}

/** Why a model can't run here: 'device' (needs WebGPU / a bigger GPU limit) or 'failed' (it failed on this phone before). */
export async function unusableHere(s: ModelSpec): Promise<'device' | 'failed' | null> {
  const d = await deviceFor(s);
  if (s.devices && !s.devices.includes(d)) return 'device';
  if (d === 'webgpu' && s.minStorageBuffers && (await gpuStorageBuffers()) < s.minStorageBuffers) return 'device';
  return failedModels().includes(failKey(s.id, d)) ? 'failed' : null;
}

/** The model a task really uses on this phone: a built-in choice as is, otherwise the first usable candidate. */
export async function effectiveModel(settings: Pick<AppSettings, 'models'> | undefined, task: ModelSpec['task']): Promise<ModelSpec> {
  const chosen = chosenModel(settings, task);
  if (chosen.runtime !== 'transformers') return chosen;
  return (await usableModel(settings, task)) ?? chosen;
}

const worked = new Set<string>();

/**
 * Runs a model job. When a model fails before it ever worked in this session (an unsupported
 * operator on this GPU, a broken file), it's marked failed on this device so the next candidate is
 * used. Network trouble and timeouts don't count against the model.
 */
export async function withModel<T>(s: ModelSpec, job: () => Promise<T>): Promise<T> {
  const key = failKey(s.id, await deviceFor(s));
  try {
    const r = await job();
    worked.add(key);
    return r;
  } catch (err) {
    const msg = String((err as Error)?.message ?? err);
    if (!worked.has(key) && !isNetworkError(err) && msg !== 'timeout' && msg !== 'released') markFailed(key);
    throw err;
  }
}

export { specOf };

/** Category top-3, seasons and the image embedding of a cut-out with one classification model. */
export async function analyseWith(s: ModelSpec, cutout: Blob) {
  return withModel(s, async () => {
    const embedding = await imageEmbedding(s, cutout);
    const cats = categoryPrompts();
    const flat = await textEmbeddings(s, [...cats, ...WARMTH_PROMPTS]);
    const categories = topCategories(embedding, categoryVectors(flat.slice(0, cats.length)));
    const warmth = zeroShot(embedding, flat.slice(cats.length));
    const seasons = categories.length ? suggestSeasons(categories[0].id, warmth) : [];
    return { categories, seasons, embedding };
  });
}
