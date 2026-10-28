// Candidate models per task (architecture §4–5). Every repo id and licence was checked against the
// Hugging Face Hub API on 2026-10-28 (R3); sizes are the Hub's byte counts for the files we fetch.
import type { AiTask, AppSettings } from '../domain/types';
import type { ModelInfo } from './index';

/** Where a transformers.js model runs. WebGPU is used only with shader-f16 (fp16 / q4f16 weights). */
export type Device = 'webgpu' | 'wasm';

export interface ModelSpec extends ModelInfo {
  runtime: 'code' | 'transformers' | 'mediapipe';
  /** What the worker builds from the repo. */
  kind?: 'segmentation' | 'clip-pair' | 'clip-joint' | 'causal-lm' | 'florence';
  /** dtype passed to from_pretrained, per device. For CLIP pairs: [vision, text]. */
  dtype?: Record<Device, string | [string, string]>;
  /** Files transformers.js fetches (path in the repo → bytes), per device. */
  files?: Record<Device, Record<string, number>>;
  /** Short note shown in the Model lab. */
  note?: string;
  /** Devices it can run on; omitted = both. */
  devices?: Device[];
  /** WebGPU storage buffers per shader stage its largest kernel needs (ONNX Runtime errors out below it). */
  minStorageBuffers?: number;
}

const HF = 'https://huggingface.co/';
export const hfUrl = (repo: string, file: string) => `${HF}${repo}/resolve/main/${file}`;

const birefnetMeta = { 'config.json': 81, 'preprocessor_config.json': 391 };
const ormbgMeta = { 'config.json': 27, 'preprocessor_config.json': 283 };
const clipMeta = { 'config.json': 4524, 'preprocessor_config.json': 520, 'tokenizer.json': 2224119, 'tokenizer_config.json': 775 };
const fclipMeta = { 'config.json': 1192, 'preprocessor_config.json': 466, 'tokenizer.json': 3642073, 'tokenizer_config.json': 803 };
const qwen3Meta = { 'config.json': 943, 'generation_config.json': 219, 'tokenizer.json': 9117040, 'tokenizer_config.json': 10369 };
const qwen3SmallMeta = { ...qwen3Meta, 'config.json': 912 };
const qwen25Meta = { 'config.json': 809, 'generation_config.json': 242, 'tokenizer.json': 7031673, 'tokenizer_config.json': 7849 };
const florenceMeta = { 'config.json': 5432, 'generation_config.json': 292, 'preprocessor_config.json': 2673, 'tokenizer.json': 2297961, 'tokenizer_config.json': 197658 };

export const MODEL_SPECS: ModelSpec[] = [
  // ---- Garment cut-out ----
  {
    id: 'plain-bg', task: 'cutout', label: 'Plain background', licence: 'MIT', sizeMb: 0, source: 'code', runtime: 'code',
    note: 'Built in. Works when the background is one clean colour.',
  },
  {
    id: 'birefnet-lite', task: 'cutout', label: 'BiRefNet-lite', licence: 'MIT', source: 'onnx-community/BiRefNet_lite-ONNX',
    runtime: 'transformers', kind: 'segmentation',
    // Measured in Chrome 2026-10-28: on the CPU its fixed 1024 × 1024 input runs out of WebAssembly
    // memory (std::bad_alloc); on WebGPU one kernel needs 11 storage buffers per shader stage, more
    // than many GPUs allow (Chrome on a Mac: 10). Elsewhere the next candidate (ORMBG) is used.
    // Not the default (bug-audit #7): in WebKit on WebGPU it grew from 612 MB to 4 GB and failed with bad_alloc,
    // where an iPhone kills the tab at about 2 GB. It stays selectable in the Model lab.
    devices: ['webgpu'],
    minStorageBuffers: 11,
    dtype: { webgpu: 'fp16', wasm: 'fp32' },
    files: {
      webgpu: { ...birefnetMeta, 'onnx/model_fp16.onnx': 114538221 },
      wasm: { ...birefnetMeta, 'onnx/model.onnx': 224005088 },
    },
  },
  {
    // Replaces IS-Net: onnx-community/ISNet-ONNX is AGPL-3.0 on the Hub, which R3 rules out.
    // ORMBG is an IS-Net (DIS) model under Apache-2.0 (schirrmacher/ormbg). The default since bug-audit #7:
    // it peaks around 1.2 GB in WebKit on WebGPU.
    id: 'ormbg', task: 'cutout', label: 'ORMBG (IS-Net)', licence: 'Apache-2.0', source: 'onnx-community/ormbg-ONNX', default: true,
    runtime: 'transformers', kind: 'segmentation',
    dtype: { webgpu: 'fp16', wasm: 'fp32' },
    files: {
      webgpu: { ...ormbgMeta, 'onnx/model_fp16.onnx': 88117930 },
      wasm: { ...ormbgMeta, 'onnx/model.onnx': 176116019 },
    },
  },
  // ---- Category, seasons, embeddings ----
  {
    id: 'clip-b32', task: 'classify', label: 'CLIP ViT-B/32', licence: 'MIT', source: 'Xenova/clip-vit-base-patch32', default: true,
    runtime: 'transformers', kind: 'clip-pair',
    dtype: { webgpu: ['q4f16', 'q4f16'], wasm: ['q8', 'q8'] },
    files: {
      webgpu: { ...clipMeta, 'onnx/vision_model_q4f16.onnx': 53267374, 'onnx/text_model_q4f16.onnx': 72531963 },
      wasm: { ...clipMeta, 'onnx/vision_model_quantized.onnx': 89117001, 'onnx/text_model_quantized.onnx': 64504507 },
    },
  },
  {
    // patrickjohncyh/fashion-clip (MIT), exported for transformers.js as one joint model (int8 MatMuls).
    id: 'fashion-clip', task: 'classify', label: 'FashionCLIP', licence: 'MIT', source: 'rshelby17/fashion-clip-onnx',
    runtime: 'transformers', kind: 'clip-joint',
    dtype: { webgpu: 'q8', wasm: 'q8' },
    files: {
      webgpu: { ...fclipMeta, 'onnx/model_quantized.onnx': 235878570 },
      wasm: { ...fclipMeta, 'onnx/model_quantized.onnx': 235878570 },
    },
  },
  // ---- Search language model (D32): loads only when a search needs it ----
  {
    id: 'qwen3-1.7b', task: 'search', label: 'Qwen3-1.7B', licence: 'Apache-2.0', source: 'onnx-community/Qwen3-1.7B-ONNX', default: true,
    runtime: 'transformers', kind: 'causal-lm',
    dtype: { webgpu: 'q4f16', wasm: 'q4' },
    files: {
      webgpu: { ...qwen3Meta, 'onnx/model_q4f16.onnx': 1426069098 },
      wasm: { ...qwen3Meta, 'onnx/model_q4.onnx': 2147212861 },
    },
  },
  {
    id: 'qwen2.5-1.5b', task: 'search', label: 'Qwen2.5-1.5B', licence: 'Apache-2.0', source: 'onnx-community/Qwen2.5-1.5B-Instruct',
    runtime: 'transformers', kind: 'causal-lm',
    dtype: { webgpu: 'q4f16', wasm: 'q4' },
    files: {
      webgpu: { ...qwen25Meta, 'onnx/model_q4f16.onnx': 1221878940 },
      wasm: { ...qwen25Meta, 'onnx/model_q4.onnx': 1787566590 },
    },
  },
  {
    id: 'qwen3-0.6b', task: 'search', label: 'Qwen3-0.6B', licence: 'Apache-2.0', source: 'onnx-community/Qwen3-0.6B-ONNX',
    runtime: 'transformers', kind: 'causal-lm',
    dtype: { webgpu: 'q4f16', wasm: 'q4' },
    files: {
      webgpu: { ...qwen3SmallMeta, 'onnx/model_q4f16.onnx': 569789750 },
      wasm: { ...qwen3SmallMeta, 'onnx/model_q4.onnx': 919096585 },
    },
  },
  // ---- Descriptions (optional) ----
  {
    id: 'florence2-base', task: 'describe', label: 'Florence-2 base', licence: 'MIT', source: 'onnx-community/Florence-2-base-ft', default: true,
    runtime: 'transformers', kind: 'florence',
    dtype: { webgpu: 'q4f16', wasm: 'q8' },
    files: {
      webgpu: {
        ...florenceMeta, 'onnx/vision_encoder_q4f16.onnx': 62416644, 'onnx/embed_tokens_q4f16.onnx': 78780309,
        'onnx/encoder_model_q4f16.onnx': 25705965, 'onnx/decoder_model_merged_q4f16.onnx': 56543716,
      },
      wasm: {
        ...florenceMeta, 'onnx/vision_encoder_quantized.onnx': 93746540, 'onnx/embed_tokens_quantized.onnx': 39390433,
        'onnx/encoder_model_quantized.onnx': 43651493, 'onnx/decoder_model_merged_quantized.onnx': 98177697,
      },
    },
  },
  // ---- Body key points: self-hosted with the app (public/models), Apache-2.0 ----
  { id: 'pose-lite', task: 'pose', label: 'MediaPipe Pose lite', licence: 'Apache-2.0', sizeMb: 5.5, source: 'models/pose_landmarker_lite.task', default: true, runtime: 'mediapipe' },
  { id: 'pose-full', task: 'pose', label: 'MediaPipe Pose full', licence: 'Apache-2.0', sizeMb: 9.0, source: 'models/pose_landmarker_full.task', runtime: 'mediapipe' },
];

const MB = 1024 * 1024;

/** Download size in bytes on a device (0 for built-in and self-hosted models). */
export function modelBytes(spec: ModelSpec, device: Device): number {
  const files = spec.files?.[device];
  return files ? Object.values(files).reduce((a, b) => a + b, 0) : 0;
}

// sizeMb in the public list is the WebGPU figure (iPhone Safari 26 and Android Chrome both have WebGPU).
for (const s of MODEL_SPECS) if (s.files) s.sizeMb = Math.round(modelBytes(s, 'webgpu') / MB);

export const spec = (id: string): ModelSpec | undefined => MODEL_SPECS.find((m) => m.id === id);
export const specsFor = (task: AiTask): ModelSpec[] => MODEL_SPECS.filter((m) => m.task === task);
export const defaultModel = (task: AiTask): ModelSpec => specsFor(task).find((m) => m.default) ?? specsFor(task)[0];

/** The model the user chose for a task (Settings.models), or the default. Unknown ids fall back to the default. */
export function chosenModel(settings: Pick<AppSettings, 'models'> | undefined, task: AiTask): ModelSpec {
  const id = settings?.models?.[task];
  const s = id ? spec(id) : undefined;
  return s && s.task === task ? s : defaultModel(task);
}

/** The models the first-run download fetches: the default cut-out and classification models. */
export const ONBOARDING_MODELS = ['ormbg', 'clip-b32'];

export function formatMb(bytes: number): string {
  const mb = bytes / MB;
  if (mb >= 1000) return `${(mb / 1024).toFixed(1)} GB`;
  return `${Math.max(1, Math.round(mb))} MB`;
}
