// Copies the WebAssembly runtimes the app loads at run time into public/vendor/, so they are
// served from our own origin (rule R1: no CDNs). public/vendor/ is git-ignored.
import { cp, mkdir, readdir, realpath } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { join } from 'node:path';

const require = createRequire(import.meta.url);
const root = new URL('..', import.meta.url).pathname;
const out = join(root, 'public/vendor');

const mediapipe = join(root, 'node_modules/@mediapipe/tasks-vision/wasm');
await mkdir(join(out, 'mediapipe'), { recursive: true });
// Only the classic loaders are used (the *_module_* variants are for ES-module workers).
for (const f of await readdir(mediapipe)) {
  if (!f.includes('_module_')) await cp(join(mediapipe, f), join(out, 'mediapipe', f));
}

// onnxruntime-web is a dependency of transformers.js and sits next to it in pnpm's store.
const tf = await realpath(require.resolve('@huggingface/transformers'));
const marker = '/node_modules/@huggingface/transformers/';
const ortDist = join(tf.slice(0, tf.indexOf(marker)), 'node_modules/onnxruntime-web/dist');
await mkdir(join(out, 'ort'), { recursive: true });
let n = 0;
for (const f of await readdir(ortDist)) {
  // The worker uses the plain build on WASM and the asyncify build on WebGPU (src/ai/worker.ts).
  if (/^ort-wasm-simd-threaded(\.asyncify)?\.(wasm|mjs)$/.test(f)) {
    await cp(join(ortDist, f), join(out, 'ort', f));
    n++;
  }
}
console.log(`copy-vendor: mediapipe wasm + ${n} onnxruntime files -> public/vendor/`);
