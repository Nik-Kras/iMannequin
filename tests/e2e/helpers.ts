// Shared helpers for the end-to-end tests. Everything is synthetic (R2): garments are the design canvas's paper
// shapes drawn on a plain table, the body is a drawn A-pose figure, and MediaPipe is replaced by key points
// computed from that drawing (window.__imqFakePose, read by src/ai/index.ts).
import { createReadStream, existsSync, readFileSync, statSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { join, normalize } from 'node:path';
import type { BrowserContext, Page } from '@playwright/test';
import { SHAPES } from '../../src/dev/shapes';

export type CamMode = 'live' | 'deny' | 'none';
export type BodyVariant = 'good' | 'armsdown' | 'cropped' | 'none';
export type Scene =
  | { type: 'garment'; kind: string; colour?: string; bg?: string }
  | { type: 'person'; variant: BodyVariant }
  | { type: 'blank' };

/** In-page drawing code, shared by the fake camera and the photo files. */
function pageLib({ SHAPES }: { SHAPES: Record<string, { vb: string; d: string; x: string; rule?: string }> }) {
  const BODY = 'M93 50L93 62C86 66 74 66 69 71C64 75 62 80 61 84L38 126L16 172L10 188L16 196L24 192L27 175L49 131L73 98L80 140L74 178L77 270L80 352L74 366L72 374L93 376L92 362L90 352L95 272L100 205L105 272L110 352L108 362L107 376L128 374L126 366L120 352L123 270L126 178L120 140L127 98L151 131L173 175L176 192L184 196L190 188L184 172L162 126L139 84C138 80 136 75 131 71C126 66 114 66 107 62L107 50Z';
  const ARMS_DOWN = 'M93 50L93 62C86 66 74 66 69 71C64 75 62 80 61 84L58 126L56 172L54 188L58 196L66 192L67 175L70 131L73 98L80 140L74 178L77 270L80 352L74 366L72 374L93 376L92 362L90 352L95 272L100 205L105 272L110 352L108 362L107 376L128 374L126 366L120 352L123 270L126 178L120 140L127 98L130 131L133 175L134 192L142 196L146 188L144 172L142 126L139 84C138 80 136 75 131 71C126 66 114 66 107 62L107 50Z';
  const P: Record<number, [number, number]> = { 0: [100, 36], 1: [103, 30], 2: [106, 30], 3: [109, 30], 4: [97, 30], 5: [94, 30], 6: [91, 30], 7: [114, 32], 8: [86, 32], 9: [103, 43], 10: [97, 43], 11: [127, 74], 12: [73, 74], 13: [156, 128], 14: [44, 128], 15: [179, 175], 16: [21, 175], 17: [183, 194], 18: [17, 194], 19: [186, 192], 20: [14, 192], 21: [176, 188], 22: [24, 188], 23: [114, 182], 24: [86, 182], 25: [113, 270], 26: [87, 270], 27: [115, 352], 28: [85, 352], 29: [116, 368], 30: [84, 368], 31: [120, 374], 32: [80, 374] };
  const WALL = '#d9d6cf';
  const matrix = (W: number, H: number, variant: string) => {
    const k = variant === 'cropped' ? (1.15 * H) / 400 : Math.min((0.8 * H) / 400, (0.9 * W) / 200);
    const cy = variant === 'cropped' ? H * 0.62 : H / 2;
    return new DOMMatrix().translate(W / 2, cy).rotate(3).scale(k).translate(-100, -200);
  };
  const points = (variant: string) => (variant === 'armsdown' ? { ...P, 13: [136, 128], 14: [64, 128], 15: [138, 180], 16: [62, 180] } : P) as Record<number, [number, number]>;
  const w = window as unknown as Record<string, unknown>;
  w.__imqLib = {
    landmarks(W: number, H: number, variant: string) {
      const m = matrix(W, H, variant);
      const p = points(variant);
      return Array.from({ length: 33 }, (_, i) => {
        const q = m.transformPoint(new DOMPoint(p[i][0], p[i][1]));
        // Like MediaPipe: a point outside the photo comes back with low visibility.
        const inside = q.x >= 0 && q.x <= W && q.y >= 0 && q.y <= H;
        return { x: q.x / W, y: q.y / H, z: 0, visibility: inside ? 0.98 : 0.05 };
      });
    },
    draw(g: CanvasRenderingContext2D, W: number, H: number, scene: { type: string; variant?: string; kind?: string; colour?: string; bg?: string }) {
      g.save();
      if (scene.type === 'person') {
        g.fillStyle = WALL; g.fillRect(0, 0, W, H);
        if (scene.variant !== 'none') {
          g.setTransform(matrix(W, H, scene.variant ?? 'good'));
          g.fillStyle = '#b98f72';
          g.beginPath(); g.ellipse(100, 33, 15, 19, 0, 0, Math.PI * 2); g.fill();
          g.fill(new Path2D(scene.variant === 'armsdown' ? ARMS_DOWN : BODY));
          g.fillStyle = '#2f3a4a'; g.fillRect(76, 168, 48, 30);
        }
      } else if (scene.type === 'garment') {
        g.fillStyle = scene.bg ?? '#ecebe7'; g.fillRect(0, 0, W, H);
        const s = SHAPES[scene.kind ?? 'tee'] ?? SHAPES.tee;
        const [vx, vy, vw, vh] = s.vb.split(' ').map(Number);
        const k = Math.min((0.7 * W) / vw, (0.7 * H) / vh);
        g.translate(W / 2 - (vx + vw / 2) * k, H / 2 - (vy + vh / 2) * k);
        g.scale(k, k);
        g.fillStyle = scene.colour ?? '#1f3a5f';
        g.fill(new Path2D(s.d), (s.rule as CanvasFillRule) ?? 'nonzero');
      } else {
        g.fillStyle = '#8a8a86'; g.fillRect(0, 0, W, H);
      }
      g.restore();
    },
  };
  w.__imqPoseVariant ??= 'good';
  w.__imqCamScene ??= { type: 'blank' };
}

function fakePose() {
  const w = window as unknown as Record<string, any>;
  w.__imqFakePose = async (blob: Blob, shared?: ImageBitmap) => {
    const bmp = shared ?? await createImageBitmap(blob);
    const W = bmp.width, H = bmp.height;
    const c = document.createElement('canvas'); c.width = W; c.height = H;
    const g = c.getContext('2d')!; g.drawImage(bmp, 0, 0);
    const d = g.getImageData(0, 0, W, H);
    const mask = new ImageData(W, H);
    let n = 0;
    for (let i = 0; i < d.data.length; i += 4) {
      const v = Math.abs(d.data[i] - 0xd9) + Math.abs(d.data[i + 1] - 0xd6) + Math.abs(d.data[i + 2] - 0xcf) > 30 ? 255 : 0;
      if (v) n++;
      mask.data[i] = mask.data[i + 1] = mask.data[i + 2] = mask.data[i + 3] = v;
    }
    const variant = w.__imqPoseVariant;
    if (variant === 'none' || n < W * H * 0.02) return { landmarks: [], mask, width: W, height: H, model: 'fake' };
    return { landmarks: w.__imqLib.landmarks(W, H, variant), mask, width: W, height: H, model: 'fake' };
  };
}

function fakeCamera({ mode }: { mode: CamMode }) {
  const w = window as unknown as Record<string, any>;
  const md = (navigator.mediaDevices ?? {}) as MediaDevices;
  Object.defineProperty(navigator, 'mediaDevices', { value: md, configurable: true });
  md.getUserMedia = async () => {
    if (mode === 'deny') throw new DOMException('Permission denied', 'NotAllowedError');
    if (mode === 'none') throw new DOMException('Requested device not found', 'NotFoundError');
    const c = document.createElement('canvas');
    c.width = 1080; c.height = 1920;
    const g = c.getContext('2d')!;
    const draw = () => { w.__imqLib.draw(g, c.width, c.height, w.__imqCamScene); requestAnimationFrame(draw); };
    draw();
    return c.captureStream(15);
  };
}

/** Installs the drawing code, the fake pose and (optionally) a fake camera in every page of the context. */
export async function fakeDevice(context: BrowserContext, { camera = 'live' as CamMode | null, pose = true } = {}) {
  await context.addInitScript(pageLib, { SHAPES });
  if (pose) await context.addInitScript(fakePose);
  if (camera) await context.addInitScript(fakeCamera, { mode: camera });
}

/**
 * Serves Hugging Face model files from a local mirror (IMQ_MODEL_MIRROR, laid out as <org>/<repo>/<file>), so tests
 * that run the real cut-out and classifier don't download them. Returns false when there is no mirror: such tests skip.
 */
export async function modelMirror(context: BrowserContext, browserName = 'webkit'): Promise<boolean> {
  const dir = process.env.IMQ_MODEL_MIRROR;
  if (!dir || !existsSync(dir)) return false;
  // Chromium closes when a 100+ MB model comes through the test protocol, so it's redirected to a local file server;
  // WebKit can't be redirected from a route, so it gets the file itself.
  const base = browserName === 'chromium' ? await mirrorServer(dir) : undefined;
  await context.route('https://huggingface.co/**', async (route) => {
    const m = new URL(route.request().url()).pathname.match(/^\/([^/]+)\/([^/]+)\/resolve\/[^/]+\/(.+)$/);
    const file = m && join(dir, m[1], m[2], decodeURIComponent(m[3]));
    if (!file || !existsSync(file) || !statSync(file).isFile()) return route.abort();
    if (base) return route.fulfill({ status: 302, headers: { location: `${base}/${m[1]}/${m[2]}/${m[3]}`, 'access-control-allow-origin': '*' } });
    const body = readFileSync(file);
    return route.fulfill({ status: 200, body, headers: { 'content-type': 'application/octet-stream', 'content-length': String(body.length), 'access-control-allow-origin': '*' } });
  });
  return true;
}

/** One static server per test worker for the model mirror (<org>/<repo>/<file>), with CORS. Returns its origin. */
let mirror: Promise<string> | undefined;
function mirrorServer(dir: string): Promise<string> {
  mirror ??= new Promise((resolve) => {
    const srv: Server = createServer((req, res) => {
      const file = join(dir, normalize(decodeURIComponent(new URL(req.url ?? '/', 'http://x').pathname)));
      if (!file.startsWith(dir) || !existsSync(file) || !statSync(file).isFile()) {
        res.writeHead(404, { 'access-control-allow-origin': '*' });
        return res.end();
      }
      res.writeHead(200, { 'content-type': 'application/octet-stream', 'content-length': statSync(file).size, 'access-control-allow-origin': '*' });
      createReadStream(file).pipe(res);
    });
    srv.listen(0, '127.0.0.1', () => resolve(`http://127.0.0.1:${(srv.address() as AddressInfo).port}`));
    srv.unref();
  });
  return mirror;
}

/** What the fake live camera films from now on. */
export async function setCamera(page: Page, scene: Scene) {
  await page.evaluate((scene) => {
    const w = window as unknown as Record<string, unknown>;
    w.__imqCamScene = scene;
    if (scene.type === 'person') w.__imqPoseVariant = scene.variant;
  }, scene);
}

async function render(page: Page, scene: Scene, name: string, W: number, H: number) {
  const dataUrl = await page.evaluate(({ scene, W, H }) => {
    const c = document.createElement('canvas'); c.width = W; c.height = H;
    (window as unknown as { __imqLib: { draw: (...a: unknown[]) => void } }).__imqLib.draw(c.getContext('2d'), W, H, scene);
    return c.toDataURL('image/jpeg', 0.92);
  }, { scene, W, H });
  return { name, mimeType: 'image/jpeg', buffer: Buffer.from(dataUrl.split(',')[1], 'base64') };
}

/** A synthetic garment photo for setInputFiles. */
export function garmentFile(page: Page, kind = 'tee', colour = '#1f3a5f', { W = 1200, H = 1600, bg }: { W?: number; H?: number; bg?: string } = {}) {
  return render(page, { type: 'garment', kind, colour, bg }, `${kind}.jpg`, W, H);
}

/** A synthetic body photo for setInputFiles; also tells the fake pose which figure it is. */
export async function bodyFile(page: Page, variant: BodyVariant = 'good', { W = 1200, H = 1600 } = {}) {
  await page.evaluate((v) => { (window as unknown as Record<string, unknown>).__imqPoseVariant = v; }, variant);
  return render(page, { type: 'person', variant }, `body-${variant}.jpg`, W, H);
}

/** Opens the app with ?e2e (the database is reachable from tests), past the install guide. */
export async function openApp(page: Page, { seed = false, onboarded = true, lang = 'en', route = '/dressup' } = {}) {
  await page.goto(`./?e2e${seed ? '&seed' : ''}#/welcome`);
  // boot() drops ?seed from the URL once the sample wardrobe is stored.
  await page.waitForFunction(() => (window as unknown as { __imq?: unknown }).__imq && !location.search.includes('seed'));
  // In a transaction, so it can't undo a flag the app writes at the same time (such as placesSeeded).
  await withDb(page, `while (!(await db.settings.get('app'))) await new Promise((r) => setTimeout(r, 50));
    await db.transaction('rw', db.settings, async () => {
      const s = await db.settings.get('app');
      await db.settings.put({ ...s, lang: '${lang}', installGuideDismissed: true, onboarded: ${onboarded}, modelsReady: true });
    });`);
  // Let the first page finish registering the service worker: WebKit reports the aborted sw.js fetch as a page error.
  await page.evaluate(() => Promise.race([navigator.serviceWorker?.ready, new Promise((r) => setTimeout(r, 3000))]));
  await page.goto(`./?e2e#${route}`);
  await page.waitForFunction(() => (window as unknown as { __imq?: unknown }).__imq);
  // The app has started on this page (settings read, diagnostics session open), so a test never races the start.
  await page.waitForFunction(() => {
    try { return JSON.parse(localStorage.getItem('imq-bb-session') ?? 'null')?.started >= Math.floor(performance.timeOrigin); } catch { return false; }
  });
}

/** Runs code against the app's Dexie database; `db` is in scope. Needs openApp (?e2e). */
export async function withDb<T = unknown>(page: Page, body: string): Promise<T> {
  await page.waitForFunction(() => (window as unknown as { __imq?: unknown }).__imq);
  return page.evaluate(`(async () => { const db = window.__imq.db; ${body} })()`) as Promise<T>;
}

/**
 * Makes the app's IndexedDB writes fail like iOS after the page was in the background ("Connection to Indexed
 * Database server lost"). `times`: how many calls fail before the real method runs again (Infinity = always).
 */
export async function failWrites(page: Page, table: string, method: 'put' | 'add' | 'bulkAdd' | 'update' | 'delete' | 'bulkPut' = 'put', times = Infinity) {
  await page.evaluate(({ table, method, times }) => {
    const db = (window as any).__imq.db;
    const t = db[table];
    const real = t[method].bind(t);
    let left = times;
    t[method] = (...a: unknown[]) => (left-- > 0
      ? Promise.reject(new DOMException('Connection to Indexed Database server lost. Refresh the page to try again', 'UnknownError'))
      : real(...a));
  }, { table, method, times: times === Infinity ? 1e9 : times });
}
