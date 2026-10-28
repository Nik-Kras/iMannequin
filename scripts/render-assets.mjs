// Renders the crumpled-paper texture and the "iM" app icons (D30) with headless Chrome.
// Run once: `pnpm assets`. Outputs are committed (src/assets/paper.webp, public/*.png, public/favicon.svg).
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const chrome = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const tmp = mkdtempSync(join(tmpdir(), 'im-assets-'));
const prata = join(root, 'node_modules/@fontsource/prata/files/prata-latin-400-normal.woff2');

function shot(name, html, w, h) {
  const file = join(tmp, `${name}.html`);
  writeFileSync(file, `<!doctype html><html><head><meta charset="utf-8"><style>
    @font-face { font-family: Prata; src: url('file://${prata}') format('woff2'); }
    html, body { margin: 0; width: ${w}px; height: ${h}px; overflow: hidden; }</style></head><body>${html}</body></html>`);
  const out = join(tmp, `${name}.png`);
  execFileSync(chrome, ['--headless=new', '--disable-gpu', '--hide-scrollbars', '--force-device-scale-factor=1',
    `--screenshot=${out}`, `--window-size=${w},${h}`, '--virtual-time-budget=4000', `file://${file}`], { stdio: 'ignore' });
  return out;
}

// Paper: the lighting map of a crumpled sheet, multiplied over #EEECE7 in CSS.
const paper = shot('paper', `<svg width="900" height="1950"><filter id="c" x="0" y="0" width="100%" height="100%">
  <feTurbulence type="fractalNoise" baseFrequency="0.0055 0.008" numOctaves="4" seed="7"/>
  <feDiffuseLighting lighting-color="#fff" surfaceScale="2.4" diffuseConstant="1.08"><feDistantLight azimuth="225" elevation="40"/></feDiffuseLighting>
  </filter><rect width="100%" height="100%" filter="url(#c)"/></svg>`, 900, 1950);
execFileSync('cwebp', ['-quiet', '-q', '72', paper, '-o', join(root, 'src/assets/paper.webp')]);

// "iM" icon: white Prata on a black tile. Full-bleed square; the OS applies its own mask.
const tile = (size, pad = 0) => `<div style="width:${size}px;height:${size}px;background:#141414;display:flex;align-items:center;justify-content:center;
  color:#fff;font:400 ${Math.round(size * (pad ? 0.34 : 0.42))}px/1 Prata,serif;letter-spacing:-0.02em;padding-bottom:${Math.round(size * 0.04)}px;box-sizing:border-box">iM</div>`;
for (const [name, size, pad] of [['icon-192', 192, 0], ['icon-512', 512, 0], ['icon-maskable-512', 512, 1], ['apple-touch-icon', 180, 0]]) {
  const p = shot(name, tile(size, pad), size, size);
  writeFileSync(join(root, 'public', `${name}.png`), readFileSync(p));
}
writeFileSync(join(root, 'public/favicon.svg'), `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="#141414"/><text x="32" y="43" text-anchor="middle" font-family="Prata, Georgia, serif" font-size="28" fill="#fff" letter-spacing="-0.5">iM</text></svg>\n`);
console.log('assets rendered');
