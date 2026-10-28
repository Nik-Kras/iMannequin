// Main-thread side of the AI worker: picks the device, keeps one worker (one model) alive at a time,
// and remembers models that crashed the tab so the next candidate is used (as RHP's reader does).
import type { FromWorker, ToWorker } from './worker';
import type { Device, ModelSpec } from './registry';
import { beginRisk, endRisk, record, reportError } from '../diag/diagnostics';

type Gpu = { requestAdapter(): Promise<{ features: { has(f: string): boolean }; limits: { maxStorageBuffersPerShaderStage: number } } | null> };

let devicePromise: Promise<Device> | null = null;
let storageBuffers = 0;

/** WebGPU with shader-f16 (fp16 / q4f16 weights), otherwise WebAssembly on the CPU. */
export function detectDevice(): Promise<Device> {
  devicePromise ??= (async () => {
    try {
      const gpu = (navigator as unknown as { gpu?: Gpu }).gpu;
      const adapter = gpu ? await gpu.requestAdapter() : null;
      storageBuffers = adapter?.limits.maxStorageBuffersPerShaderStage ?? 0;
      return adapter?.features.has('shader-f16') ? 'webgpu' : 'wasm';
    } catch {
      return 'wasm';
    }
  })();
  return devicePromise;
}

/** The GPU's storage-buffer limit per shader stage (0 without WebGPU); some ONNX kernels need more than 8–10. */
export async function gpuStorageBuffers(): Promise<number> {
  await detectDevice();
  return storageBuffers;
}

// ---- Crash guard ----
// iPhone Safari kills a tab that runs out of memory, so no error reaches the code. A model run is
// noted as "running" before it starts and cleared after; a note left over at start-up was a crash.

const RUNNING = 'imq-ai-running';
const FAILED = 'imq-ai-failed';

function store(): Storage | null {
  try { return typeof localStorage === 'undefined' ? null : localStorage; } catch { return null; }
}

function readFailed(): string[] {
  try { return JSON.parse(store()?.getItem(FAILED) ?? '[]'); } catch { return []; }
}

export const failKey = (modelId: string, device: Device) => `${modelId}@${device}`;

export function markFailed(key: string): void {
  try { store()?.setItem(FAILED, JSON.stringify([...new Set([...readFailed(), key])])); } catch { /* storage full: ignore */ }
}

export function failedModels(): string[] { return readFailed(); }

/** Lets every model be tried again (Model lab → Reset to recommended). */
export function resetFailures(): void {
  store()?.removeItem(FAILED);
  store()?.removeItem(RUNNING);
}

/** The model that crashed the app on its last run, if any (moved into the failed list). */
export const crashedOnLastRun: string | null = (() => {
  const s = store();
  const key = s?.getItem(RUNNING);
  if (!key) return null;
  s!.removeItem(RUNNING);
  markFailed(key);
  return key;
})();

/** Runs `job` with the crash guard set for `key`. */
export async function guarded<T>(key: string, job: () => Promise<T>): Promise<T> {
  store()?.setItem(RUNNING, key);
  beginRisk(`ai:${key}`); // the black box reports a kill here on the next launch (D50)
  try {
    return await job();
  } finally {
    store()?.removeItem(RUNNING);
    endRisk();
  }
}

// ---- One job at a time ----
// The wardrobe queue, Fix cut-out, search and the Model lab can all ask for AI work at once. Every
// public entry point runs inside exclusive(), so jobs queue up and only one model is ever in memory.
// Don't nest exclusive() calls: the inner one would wait for the outer one forever.

let chain: Promise<unknown> = Promise.resolve();

export function exclusive<T>(job: () => Promise<T>): Promise<T> {
  const p = chain.then(job, job);
  chain = p.catch(() => undefined);
  return p;
}

// ---- The worker ----

export type Progress = (loaded: number, total: number) => void;
type DistributiveOmit<T, K extends keyof never> = T extends unknown ? Omit<T, K> : never;
type Job = DistributiveOmit<Exclude<ToWorker, { type: 'init' }>, 'id'>;

interface Live { worker: Worker; key: string | null; device: Device }
let live: Live | null = null;
let nextId = 1;
const pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void; onProgress?: Progress }>();

function spawn(key: string | null, device: Device): Live {
  const worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
  worker.postMessage({ type: 'init', device } satisfies ToWorker);
  worker.onmessage = (e: MessageEvent<FromWorker>) => {
    const m = e.data;
    const p = pending.get(m.id);
    if (!p) return;
    if (m.type === 'progress') { p.onProgress?.(m.loaded, m.total); return; }
    pending.delete(m.id);
    if (m.type === 'done') p.resolve(m.result);
    else {
      const err = new Error(m.message);
      reportError(err, 'ai.run', { model: key, device });
      p.reject(err);
    }
  };
  worker.onerror = (e) => {
    const err = new Error(e.message || 'AI worker crashed');
    reportError(err, 'ai.worker', { model: key, device });
    for (const [id, p] of pending) { pending.delete(id); p.reject(err); }
    if (live?.worker === worker) live = null;
  };
  return { worker, key, device };
}

/** Frees the model's memory. It reloads from the browser cache next time. */
export function releaseAi(): void {
  if (!live) return;
  live.worker.terminate();
  for (const [id, p] of pending) { pending.delete(id); p.reject(new Error('released')); }
  live = null;
}

/**
 * Sends a job to a worker that holds `modelKey` (null = any worker will do), terminating a worker
 * that holds a different model first: one AI model in memory at a time.
 */
export async function run<T>(modelKey: string | null, job: Job, opts: { onProgress?: Progress; timeoutMs?: number } = {}): Promise<T> {
  const device = await detectDevice();
  const dev = modelKey?.endsWith('@wasm') ? 'wasm' : modelKey?.endsWith('@webgpu') ? 'webgpu' : device;
  if (!live || (modelKey !== null && live.key !== modelKey && live.key !== null) || (modelKey !== null && live.device !== dev)) {
    releaseAi();
    live = spawn(modelKey, dev);
  } else if (modelKey !== null && live.key === null) {
    live.key = modelKey; // a model-free worker takes the model
  }
  const w = live;
  const id = nextId++;
  return new Promise<T>((resolve, reject) => {
    const timer = opts.timeoutMs
      ? setTimeout(() => {
          if (!pending.has(id)) return;
          pending.delete(id);
          if (live === w) releaseAi(); // stops a runaway generation
          record('ai.timeout', { model: modelKey, job: job.type });
          reject(new Error('timeout'));
        }, opts.timeoutMs)
      : undefined;
    pending.set(id, {
      resolve: (v) => { clearTimeout(timer); resolve(v as T); },
      reject: (e) => { clearTimeout(timer); reject(e); },
      onProgress: opts.onProgress,
    });
    record('ai.job', { model: modelKey, job: job.type, device: dev });
    w.worker.postMessage({ ...job, id } as ToWorker);
  });
}

/** Device a model runs on here: WebGPU unless it failed there before. */
export async function deviceFor(spec: ModelSpec): Promise<Device> {
  const d = await detectDevice();
  if (d === 'webgpu' && readFailed().includes(failKey(spec.id, 'webgpu'))) return 'wasm';
  return d;
}

/** A failed download (offline, flaky Wi-Fi) is not the model's fault. */
export function isNetworkError(err: unknown): boolean {
  const m = String((err as Error)?.message ?? err);
  return (typeof navigator !== 'undefined' && !navigator.onLine) || /fetch|network|load failed|connection|offline/i.test(m);
}
