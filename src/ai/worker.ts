/// <reference lib="webworker" />
// The AI worker: runs models off the main thread so the UI stays smooth (architecture §3).
// One worker holds at most one model; the client terminates it before loading another, which is
// the only reliable way to give the memory back on iPhone Safari (a tab dies at about 2 GB).
// transformers.js is imported lazily, so plain-code jobs (plain-background cut-out, colours) are light.
import { garmentColours } from './colours';
import { composeCutout, pixels, toBitmap } from './image';
import { cleanModelMask, plainBackgroundCutout, PLAIN_CLEAN } from './mask';
import type { Device, ModelSpec } from './registry';

declare const self: DedicatedWorkerGlobalScope;

type Msgs = { role: 'system' | 'user'; content: string }[];
export type ToWorker =
  | { type: 'init'; device: Device }
  | { type: 'plain'; id: number; blob: Blob; force?: boolean }
  | { type: 'segment'; id: number; blob: Blob; spec: ModelSpec }
  | { type: 'colours'; id: number; blob: Blob }
  | { type: 'load'; id: number; spec: ModelSpec; part?: 'vision' | 'text' }
  | { type: 'embed-image'; id: number; blob: Blob; spec: ModelSpec }
  | { type: 'embed-text'; id: number; texts: string[]; spec: ModelSpec }
  | { type: 'generate'; id: number; spec: ModelSpec; messages: Msgs; maxTokens: number }
  | { type: 'describe'; id: number; blob: Blob; spec: ModelSpec }
  /** Free every model (bug-audit #6); `final`: also the GPU device, as the client terminates the worker next. */
  | { type: 'dispose'; id: number; final?: boolean };

export interface CutoutOut { png: Blob; width: number; height: number; confidence: number; reasons: string[]; clean: boolean; crop?: { x: number; y: number; w: number; h: number } }

export type FromWorker =
  | { type: 'progress'; id: number; loaded: number; total: number }
  | { type: 'done'; id: number; result: unknown }
  | { type: 'error'; id: number; message: string; code?: string };

type TF = typeof import('@huggingface/transformers');
let T: TF | null = null;
let device: Device = 'wasm';

/** Plain-background mask size: big enough for a clean edge, small enough to take ~100 ms. */
const PLAIN_SIDE = 768;
/** The segmentation models work at 1024 × 1024; their mask is computed at up to this size. */
const MODEL_SIDE = 1024;

async function tf(): Promise<TF> {
  if (T) return T;
  T = await import('@huggingface/transformers');
  const { env } = T;
  env.allowLocalModels = false;
  env.useBrowserCache = true;
  // Runtimes come from our own origin, never a CDN (R1). On the CPU path use the plain build:
  // the "asyncify" build leaks memory on Safari until iOS kills the tab (onnxruntime#26827).
  const base = new URL(`${import.meta.env.BASE_URL}vendor/ort/`, self.location.origin).href;
  const suffix = device === 'webgpu' ? '.asyncify' : '';
  const onnx = env.backends.onnx as unknown as { wasm: { wasmPaths: unknown; numThreads?: number } };
  onnx.wasm.wasmPaths = { mjs: `${base}ort-wasm-simd-threaded${suffix}.mjs`, wasm: `${base}ort-wasm-simd-threaded${suffix}.wasm` };
  onnx.wasm.numThreads = 1; // GitHub Pages can't send COOP/COEP, so there are no threads anyway.
  // Offline, optional metadata files (tokenizer_config.json on an image model…) can't be fetched;
  // answer them with a 404 so a downloaded model still loads. Weights are never faked.
  env.fetch = async (input: string | URL, init?: RequestInit) => {
    try {
      return await fetch(input, init);
    } catch (err) {
      if (/\.(json|jinja|txt)(\?|$)/.test(String(input))) return new Response(null, { status: 404, statusText: 'offline' });
      throw err;
    }
  };
  return T;
}

// ---- Loading ----

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;
const loaded = new Map<string, Promise<Any>>();
/** A WebGPU session ran in this worker, so ONNX Runtime holds a GPU device. */
let gpuUsed = false;

function progressFor(id: number, spec: ModelSpec) {
  const files = spec.files?.[device] ?? {};
  const expected = Object.values(files).reduce((a, b) => a + b, 0);
  const got = new Map<string, number>();
  let last = 0;
  return (p: { status: string; file?: string; loaded?: number; total?: number }) => {
    if (p.status !== 'progress' || !p.file) return;
    got.set(p.file, p.loaded ?? 0);
    const loadedBytes = [...got.values()].reduce((a, b) => a + b, 0);
    const total = Math.max(expected, loadedBytes);
    if (loadedBytes - last > total / 200 || loadedBytes === total) {
      last = loadedBytes;
      post({ type: 'progress', id, loaded: loadedBytes, total });
    }
  };
}

function dtypeOf(spec: ModelSpec, i = 0): Any {
  const d = spec.dtype?.[device];
  return Array.isArray(d) ? d[i] : d;
}

function load(spec: ModelSpec, part: string, id: number): Promise<Any> {
  const key = `${spec.id}:${part}`;
  let p = loaded.get(key);
  if (p) return p;
  p = (async () => {
    const t = await tf();
    // On the CPU, WebAssembly memory only grows; ORT's arena and memory-pattern planner keep peak
    // buffers around, which pushes 1024 × 1024 segmentation models past the limit (std::bad_alloc).
    const session_options = device === 'wasm' ? { enableCpuMemArena: false, enableMemPattern: false } : undefined;
    if (device === 'webgpu') gpuUsed = true;
    const opts = { device, progress_callback: progressFor(id, spec), session_options };
    switch (`${spec.kind}:${part}`) {
      case 'segmentation:main':
        return t.pipeline('image-segmentation', spec.source, { ...opts, dtype: dtypeOf(spec) });
      case 'clip-pair:vision':
        return { processor: await t.AutoProcessor.from_pretrained(spec.source), model: await t.CLIPVisionModelWithProjection.from_pretrained(spec.source, { ...opts, dtype: dtypeOf(spec, 0) }) };
      case 'clip-pair:text':
        return { tokenizer: await t.AutoTokenizer.from_pretrained(spec.source), model: await t.CLIPTextModelWithProjection.from_pretrained(spec.source, { ...opts, dtype: dtypeOf(spec, 1) }) };
      case 'clip-joint:vision':
      case 'clip-joint:text':
      case 'clip-joint:main': {
        const joint = await load(spec, 'joint', id);
        return joint;
      }
      case 'clip-joint:joint':
        return {
          processor: await t.AutoProcessor.from_pretrained(spec.source),
          tokenizer: await t.AutoTokenizer.from_pretrained(spec.source),
          model: await t.CLIPModel.from_pretrained(spec.source, { ...opts, dtype: dtypeOf(spec) }),
        };
      case 'causal-lm:main':
        return { tokenizer: await t.AutoTokenizer.from_pretrained(spec.source), model: await t.AutoModelForCausalLM.from_pretrained(spec.source, { ...opts, dtype: dtypeOf(spec) }) };
      case 'florence:main':
        return { processor: await t.AutoProcessor.from_pretrained(spec.source), model: await t.Florence2ForConditionalGeneration.from_pretrained(spec.source, { ...opts, dtype: dtypeOf(spec) }) };
      default:
        throw new Error(`Unknown model kind ${spec.kind}:${part}`);
    }
  })();
  p.catch(() => loaded.delete(key));
  loaded.set(key, p);
  return p;
}

// ---- Helpers ----

/** The cut-out drawn on white (flat-lay product photos are on white), as a transformers.js RawImage. */
async function rawOnWhite(blob: Blob, maxSide = 448): Promise<Any> {
  const t = await tf();
  const bmp = await toBitmap(blob);
  const k = Math.min(1, maxSide / Math.max(bmp.width, bmp.height));
  const w = Math.max(1, Math.round(bmp.width * k)), h = Math.max(1, Math.round(bmp.height * k));
  const c = new OffscreenCanvas(w, h);
  const ctx = c.getContext('2d') as OffscreenCanvasRenderingContext2D;
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(bmp, 0, 0, w, h);
  bmp.close();
  const d = ctx.getImageData(0, 0, w, h);
  return new t.RawImage(d.data, w, h, 4).rgb();
}

function f32(tensor: Any): Float32Array {
  const t = tensor.type === 'float32' ? tensor : tensor.to('float32');
  return new Float32Array(t.data);
}

function rows(tensor: Any): Float32Array[] {
  const data = f32(tensor);
  const [n, d] = tensor.dims;
  return Array.from({ length: n }, (_, i) => normalise(data.slice(i * d, (i + 1) * d)));
}

function normalise(v: Float32Array): Float32Array {
  let s = 0;
  for (const x of v) s += x * x;
  const n = Math.sqrt(s) || 1;
  return v.map((x) => x / n);
}

// ---- Jobs ----

async function plain(blob: Blob, force = false): Promise<CutoutOut | null> {
  const bmp = await toBitmap(blob);
  try {
    const img = pixels(bmp, PLAIN_SIDE);
    const r = plainBackgroundCutout(img.data, img.width, img.height);
    if (r.confidence < PLAIN_CLEAN && !force) return { png: new Blob(), width: 0, height: 0, confidence: r.confidence, reasons: r.reasons, clean: false };
    const out = await composeCutout(bmp, r.alpha, r.width, r.height);
    if (!out) return null;
    return { png: out.blob, width: out.width, height: out.height, crop: out.crop, confidence: r.confidence, reasons: r.reasons, clean: r.confidence >= PLAIN_CLEAN };
  } finally {
    bmp.close();
  }
}

async function segment(id: number, blob: Blob, spec: ModelSpec): Promise<CutoutOut | null> {
  const t = await tf();
  const segmenter = await load(spec, 'main', id);
  const bmp = await toBitmap(blob);
  try {
    const img = pixels(bmp, MODEL_SIDE);
    const raw = new t.RawImage(img.data, img.width, img.height, 4).rgb();
    const [first] = await segmenter(raw);
    const mask = first.mask; // 1 channel, at the input size
    const alpha = cleanModelMask(new Uint8ClampedArray(mask.data), mask.width, mask.height);
    const out = await composeCutout(bmp, alpha, mask.width, mask.height);
    if (!out) return null;
    return { png: out.blob, width: out.width, height: out.height, crop: out.crop, confidence: 1, reasons: [], clean: true };
  } finally {
    bmp.close();
  }
}

async function colours(blob: Blob) {
  const bmp = await toBitmap(blob);
  try {
    return garmentColours(pixels(bmp, 256).data);
  } finally {
    bmp.close();
  }
}

async function embedImage(id: number, blob: Blob, spec: ModelSpec): Promise<Float32Array> {
  const image = await rawOnWhite(blob);
  if (spec.kind === 'clip-joint') {
    const { processor, tokenizer, model } = await load(spec, 'joint', id);
    const { pixel_values } = await processor(image);
    const text = tokenizer(['a photo of clothing'], { padding: true, truncation: true });
    const out = await model({ ...text, pixel_values });
    return rows(out.image_embeds)[0];
  }
  const { processor, model } = await load(spec, 'vision', id);
  const { pixel_values } = await processor(image);
  const out = await model({ pixel_values });
  return rows(out.image_embeds)[0];
}

async function embedText(id: number, texts: string[], spec: ModelSpec): Promise<Float32Array[]> {
  if (spec.kind === 'clip-joint') {
    const t = await tf();
    const { processor, tokenizer, model } = await load(spec, 'joint', id);
    const blank = new t.RawImage(new Uint8ClampedArray(224 * 224 * 3).fill(255), 224, 224, 3);
    const { pixel_values } = await processor(blank);
    const text = tokenizer(texts, { padding: true, truncation: true });
    const out = await model({ ...text, pixel_values });
    return rows(out.text_embeds);
  }
  const { tokenizer, model } = await load(spec, 'text', id);
  const inputs = tokenizer(texts, { padding: true, truncation: true });
  const out = await model(inputs);
  return rows(out.text_embeds);
}

async function generate(id: number, spec: ModelSpec, messages: Msgs, maxTokens: number): Promise<string> {
  const { tokenizer, model } = await load(spec, 'main', id);
  const inputs = tokenizer.apply_chat_template(messages, { add_generation_prompt: true, return_dict: true, enable_thinking: false });
  const out = await model.generate({ ...inputs, max_new_tokens: maxTokens, do_sample: false });
  const n = inputs.input_ids.dims.at(-1);
  return tokenizer.batch_decode(out.slice(null, [n, null]), { skip_special_tokens: true })[0] as string;
}

async function describe(id: number, blob: Blob, spec: ModelSpec): Promise<string> {
  const { processor, model } = await load(spec, 'main', id);
  const image = await rawOnWhite(blob, 768);
  const task = '<MORE_DETAILED_CAPTION>';
  const inputs = await processor(image, processor.construct_prompts(task));
  const ids = await model.generate({ ...inputs, max_new_tokens: 80 });
  const text = processor.batch_decode(ids, { skip_special_tokens: false })[0];
  const result = processor.post_process_generation(text, task, image.size);
  return String(result[task] ?? '').trim();
}

// ---- Letting go (bug-audit #6) ----
// Before another model loads, every session here is released. In WebKit, terminating a worker that has run an
// ONNX Runtime WebGPU session kills the page about 1.5 s later even then, so a WebGPU worker is kept and loads the
// next model itself; only a worker about to be terminated (`final`) also destroys its GPU device.

/** Disposes every distinct loaded model (a pipeline, or a { model } pair). Returns how many were disposed. */
export async function disposeModels(models: Iterable<Promise<unknown>>): Promise<number> {
  const seen = new Set<unknown>();
  for (const p of models) {
    try {
      const m = (await p) as { dispose?: () => unknown; model?: { dispose?: () => unknown } } | null;
      const target = typeof m?.dispose === 'function' ? m : m?.model;
      if (!target || seen.has(target) || typeof target.dispose !== 'function') continue;
      seen.add(target);
      await target.dispose();
    } catch { /* a model that failed to load, or to free */ }
  }
  return seen.size;
}

async function disposeAll(final: boolean): Promise<string> {
  const models = [...loaded.values()];
  loaded.clear();
  const n = await disposeModels(models);
  // The device getter creates a device when no session made one, so only ask after a WebGPU model ran.
  if (!final || !gpuUsed || !T) return `${n} models`;
  try {
    const gpu = (T.env.backends.onnx as unknown as { webgpu?: { device?: Promise<GPUDevice> } }).webgpu;
    const d = await gpu?.device;
    await d?.queue.onSubmittedWorkDone();
    d?.destroy();
    return `${n} models, device ${d ? 'destroyed' : 'none'}`;
  } catch (err) {
    return `${n} models, device: ${String(err)}`;
  }
}

const post = (m: FromWorker, transfer: Transferable[] = []) => self.postMessage(m, transfer);

const onMessage = async (e: MessageEvent<ToWorker>) => {
  const m = e.data;
  if (m.type === 'init') { device = m.device; return; }
  try {
    let result: unknown;
    switch (m.type) {
      case 'dispose': result = await disposeAll(!!m.final); break;
      case 'plain': result = await plain(m.blob, m.force); break;
      case 'segment': result = await segment(m.id, m.blob, m.spec); break;
      case 'colours': result = await colours(m.blob); break;
      case 'load': await load(m.spec, m.spec.kind === 'clip-pair' ? (m.part ?? 'vision') : m.spec.kind === 'clip-joint' ? 'joint' : 'main', m.id); result = true; break;
      case 'embed-image': result = await embedImage(m.id, m.blob, m.spec); break;
      case 'embed-text': result = await embedText(m.id, m.texts, m.spec); break;
      case 'generate': result = await generate(m.id, m.spec, m.messages, m.maxTokens); break;
      case 'describe': result = await describe(m.id, m.blob, m.spec); break;
    }
    post({ type: 'done', id: m.id, result });
  } catch (err) {
    const code = (err as { code?: unknown })?.code;
    post({ type: 'error', id: m.id, message: String((err as Error)?.message ?? err), ...(typeof code === 'string' ? { code } : {}) });
  }
};
// Unit tests import this file for disposeModels outside a worker.
if (typeof self !== 'undefined') self.onmessage = onMessage;
