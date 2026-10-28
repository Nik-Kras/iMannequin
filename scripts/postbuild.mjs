// After `vite build`: drop the ONNX Runtime copy Vite bundles from transformers.js. The app loads
// its own copy from vendor/ort/ (src/ai/worker.ts), so the bundled one is never fetched.
import { readdir, rm } from 'node:fs/promises';

const dist = new URL('../dist/', import.meta.url);
let removed = 0;
for (const f of await readdir(new URL('assets/', dist))) {
  if (/^ort-wasm-.*\.(wasm|mjs)$/.test(f)) { await rm(new URL(`assets/${f}`, dist)); removed++; }
}
console.log(`postbuild: removed ${removed} unused runtime file(s)`);
