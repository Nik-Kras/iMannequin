// Data, AI and memory items of docs/bug-audit.md. WebKit (iPhone Safari's engine), iPhone 15 Pro, persistent profiles
// that are closed and reopened like iOS killing the home-screen app. Synthetic garments only (R2).
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test as base, devices, expect, webkit, type BrowserContext, type Page } from '@playwright/test';
import { failWrites, fakeDevice, garmentFile, modelMirror, openApp, withDb } from './helpers';
import { MODEL_SPECS, hfUrl } from '../../src/ai/registry';

type App = { context: BrowserContext; page: Page };
type LaunchOpts = { stallWorker?: boolean; models?: 'none' | 'mirror' };

/** Like ./fixtures, but the same profile can be opened again after closing it (a relaunch). */
const test = base.extend<{ launch: (o?: LaunchOpts) => Promise<App> }>({
  launch: async ({}, use) => {
    const dir = mkdtempSync(join(tmpdir(), 'imannequin-data-'));
    const open: BrowserContext[] = [];
    const errors: string[] = [];
    await use(async ({ stallWorker = false, models = 'none' } = {}) => {
      const context = await webkit.launchPersistentContext(dir, {
        ...devices['iPhone 15 Pro'],
        baseURL: `http://localhost:${process.env.IMQ_PORT ?? '4183'}/iMannequin/`,
        locale: 'en-GB',
        timezoneId: 'Europe/London',
      });
      open.push(context);
      await fakeDevice(context);
      if (models === 'none') await context.route('https://huggingface.co/**', (r) => r.abort());
      else if (!(await modelMirror(context))) test.skip(true, 'IMQ_MODEL_MIRROR is not set');
      // An AI worker that never answers: the app is closed while the queue is still busy.
      if (stallWorker) await context.addInitScript(() => {
        (window as unknown as { Worker: unknown }).Worker = class { onmessage = null; onerror = null; postMessage() {} terminate() {} addEventListener() {} removeEventListener() {} };
      });
      const page = context.pages()[0] ?? (await context.newPage());
      page.on('pageerror', (e) => errors.push(String(e)));
      return { context, page };
    });
    for (const c of open) await c.close().catch(() => {});
    rmSync(dir, { recursive: true, force: true });
    if (errors.length) throw new Error('Page errors:\n' + errors.join('\n'));
  },
});

/** The built-in plain-background cut-out, and no classifier (both CLIP models marked as failed here): no downloads. */
async function noModels(page: Page) {
  await withDb(page, `const s = await db.settings.get('app'); await db.settings.put({ ...s, models: { ...s.models, cutout: 'plain-bg' } });`);
  await page.evaluate(() => localStorage.setItem('imq-ai-failed', JSON.stringify(['clip-b32@webgpu', 'clip-b32@wasm', 'fashion-clip@webgpu', 'fashion-clip@wasm'])));
}

const queueStates = (page: Page) => withDb<string[]>(page, `return (await db.queue.orderBy('createdAt').toArray()).map((j) => j.state + (j.errorCode ? ':' + j.errorCode : ''))`);

/** Every stored image that can't be read in this session: "<table>.<id>.<field>: <error>". */
const deadBlobs = (page: Page) => withDb<string[]>(page, `
  const out = [];
  for (const t of ['photos', 'queuePhotos', 'queueCuts']) {
    if (!db[t]) continue;
    for (const r of await db[t].toArray()) for (const [k, v] of Object.entries(r)) {
      if (v instanceof Blob) { try { await v.arrayBuffer(); } catch (e) { out.push(t + '.' + (r.id ?? r.jobId) + '.' + k + ': ' + e.name); } }
    }
  }
  return out;`);

/** Real PNG/JPEG blobs drawn in the page (in-memory copies, like the app stores them). */
const SEED_IMAGES = `
  const img = async (colour, type) => {
    const c = document.createElement('canvas'); c.width = 64; c.height = 80;
    const g = c.getContext('2d'); g.fillStyle = colour; g.fillRect(8, 8, 48, 64);
    const b = await new Promise((r) => c.toBlob(r, type));
    return new Blob([await b.arrayBuffer()], { type });
  };
  const photo = async (id, itemId, colour, extra = {}) => ({
    id, itemId, original: await img(colour, 'image/jpeg'), cutout: await img(colour, 'image/png'), thumb: await img(colour, 'image/png'),
    width: 64, height: 80, cutoutModel: 'plain-bg', cutoutApproved: false, createdAt: Date.now(), ...extra,
  });
  const item = (id, status, extra = {}) => ({ id, name: 'Test ' + id, category: 'tshirt', colours: ['navy'], seasons: ['summer'],
    tryOnPhotoId: 'p-' + id, status, createdAt: Date.now(), updatedAt: Date.now(), ...extra });`;

test.describe('#1 queue survives the app closing', () => {
  test('#1 photos waiting in the queue are all processed after a relaunch, none lost or stuck', async ({ launch }) => {
    test.setTimeout(120_000);
    let { context, page } = await launch({ stallWorker: true });
    await openApp(page, { route: '/add' });
    await noModels(page);
    const files = [await garmentFile(page, 'tee', '#a33a2a'), await garmentFile(page, 'jeans', '#3e5b85'), await garmentFile(page, 'skirt', '#6b6b3a')];
    await page.locator('input[type=file][multiple]').setInputFiles(files);
    await expect.poll(() => queueStates(page)).toEqual(['working', 'waiting', 'waiting']);
    await context.close();

    ({ page } = await launch());
    await page.goto('./?e2e#/review');
    await expect.poll(() => queueStates(page), { timeout: 60_000 }).toEqual(['done', 'done', 'done']);
    expect(await withDb(page, `return await db.items.where('status').equals('review').count()`)).toBe(3);
    expect(await deadBlobs(page)).toEqual([]);
  });

  test('#11 a queued photo is stored with a small preview for the strip', async ({ launch }) => {
    const { page } = await launch({ stallWorker: true });
    await openApp(page, { route: '/add' });
    await page.locator('input[type=file][multiple]').setInputFiles([await garmentFile(page, 'tee', '#a33a2a', { W: 1536, H: 2048 })]);
    await expect.poll(() => withDb(page, `return db.queuePhotos ? await db.queuePhotos.count() : -1`)).toBe(1);
    const size = await withDb<number[]>(page, `const [p] = await db.queuePhotos.toArray(); const b = await createImageBitmap(p.preview); return [b.width, b.height, p.preview.size];`);
    expect(Math.max(size[0], size[1])).toBe(96);
    expect(size[2]).toBeLessThan(10_000);
  });
});

test.describe('#2 garments from an earlier session keep their images', () => {
  test('#2 "Looks good", "Yes, same one" and Fix cut-out "Use" after a relaunch leave every image readable', async ({ launch }) => {
    test.setTimeout(90_000);
    let { context, page } = await launch();
    await openApp(page, { route: '/wardrobe' });
    await withDb(page, `${SEED_IMAGES}
      await db.items.bulkPut([item('a', 'active'), item('r1', 'review'), item('r2', 'review', { suggestion: { sameItemId: 'a', sameItemScore: 0.97 } }), item('r3', 'review')]);
      await db.photos.bulkPut([await photo('p-a', 'a', '#1f3a5f', { cutoutApproved: true }), await photo('p-r1', 'r1', '#a33a2a'), await photo('p-r2', 'r2', '#1f3a5f'), await photo('p-r3', 'r3', '#6b6b3a')]);`);
    await context.close();

    ({ page } = await launch());
    await openApp(page, { route: '/item/r1' });
    expect(await deadBlobs(page)).toEqual([]);

    // "Looks good" (setCutoutApproved)
    const looksGood = page.getByRole('button', { name: 'Looks good' });
    await looksGood.click();
    await expect(looksGood).toHaveAttribute('aria-pressed', 'true');
    expect(await deadBlobs(page)).toEqual([]);

    // "Yes, same one" (mergeIntoExisting)
    await page.goto('./?e2e#/item/r2');
    await page.getByRole('button', { name: 'Yes, same one' }).click();
    await expect.poll(() => withDb(page, `return (await db.photos.get('p-r2')).itemId`)).toBe('a');
    expect(await deadBlobs(page)).toEqual([]);

    // Fix cut-out → Brush → Use (saveCutout)
    await page.goto('./?e2e#/item/r3/fix');
    await page.getByRole('button', { name: 'Brush' }).click();
    await page.getByRole('button', { name: 'Use this cut-out' }).click();
    await expect.poll(() => withDb(page, `return (await db.photos.get('p-r3')).cutoutApproved`)).toBe(true);
    expect(await deadBlobs(page)).toEqual([]);
  });
});

test.describe('#5 backup', () => {
  test('#5 an image WebKit lost doesn\'t fail the backup; the file restores everything else', async ({ launch }, info) => {
    test.setTimeout(90_000);
    let { context, page } = await launch();
    await openApp(page, { route: '/wardrobe' });
    await withDb(page, `${SEED_IMAGES}
      await db.items.bulkPut([item('a', 'active'), item('b', 'active')]);
      await db.photos.bulkPut([await photo('p-a', 'a', '#1f3a5f'), await photo('p-b', 'b', '#a33a2a')]);`);
    await context.close();

    ({ context, page } = await launch());
    await context.addInitScript(() => { delete (Navigator.prototype as { share?: unknown }).share; delete (Navigator.prototype as { canShare?: unknown }).canShare; });
    await openApp(page, { route: '/settings' });
    // Rewriting a record with its stored Blobs (what #2 fixed in the app) still kills them in this session.
    await withDb(page, `const p = await db.photos.get('p-b'); await db.photos.put({ ...p, cutoutApproved: true });`);
    expect((await deadBlobs(page)).length).toBe(3);

    const download = page.waitForEvent('download', { timeout: 20_000 });
    await page.getByRole('button', { name: 'Export backup' }).click();
    const file = info.outputPath('backup.imannequin');
    await (await download).saveAs(file);
    await expect(page.getByText('Couldn’t make the backup.')).toHaveCount(0);
    await expect(page.getByText('1 photo couldn’t be read on this phone, so it isn’t in the backup.')).toBeVisible();

    await page.locator('input[type=file][accept*=imannequin]').setInputFiles(file);
    await page.getByRole('button', { name: 'Replace and restore' }).click();
    await expect.poll(() => withDb(page, `return (await db.photos.get('p-a'))?.original?.size ?? 0`)).toBeGreaterThan(0);
    expect(await withDb(page, `return Object.keys(await db.photos.get('p-b')).filter((k) => ['original', 'cutout', 'thumb'].includes(k))`)).toEqual([]);
    expect(await withDb(page, `return await db.items.count()`)).toBe(2);
    expect(await deadBlobs(page)).toEqual([]);
  });
});

/** Puts placeholder files in the model cache, as if they were downloaded (only their presence is checked). */
async function cacheModelFiles(page: Page, urls: string[]) {
  await page.evaluate(async (urls) => {
    const c = await caches.open('transformers-cache');
    for (const u of urls) await c.put(u, new Response('x', { headers: { 'content-length': '1' } }));
  }, urls);
}
const filesOf = (id: string, match: RegExp = /./) => {
  const s = MODEL_SPECS.find((m) => m.id === id)!;
  return Object.values(s.files!).flatMap((f) => Object.keys(f)).filter((f) => match.test(f)).map((f) => hfUrl(s.source, f));
};
const downloadMb = async (page: Page) => Number((await page.getByRole('button', { name: /^Download \d/ }).textContent())!.replace(/\D+/g, ''));

test.describe('#19 model download', () => {
  test('#19 after a reload mid-download, the files already on the phone are counted', async ({ launch }) => {
    const { page } = await launch();
    await openApp(page, { route: '/models' });
    const before = await downloadMb(page);
    // The image half of CLIP finished before the app was closed (either device's file).
    await cacheModelFiles(page, filesOf('clip-b32', /vision_model/));
    await page.reload();
    await expect.poll(() => downloadMb(page)).toBeLessThan(before - 40);
  });

  test('#19 Add clothes and Settings say when the models are missing, and lead to the download', async ({ launch }) => {
    const { page } = await launch();
    await openApp(page, { route: '/add' });
    await page.getByRole('dialog').getByRole('button', { name: 'Continue' }).click(); // the first-visit guide
    const banner = page.getByRole('region', { name: 'AI models not downloaded' });
    await expect(banner).toContainText('aren’t on this phone yet');
    await banner.getByRole('button', { name: 'Download' }).click();
    await expect(page).toHaveURL(/#\/models/);

    await page.goto('./?e2e#/settings');
    await expect(page.getByRole('region', { name: 'AI models not downloaded' })).toBeVisible();

    await cacheModelFiles(page, [...filesOf('ormbg'), ...filesOf('clip-b32')]);
    await page.goto('./?e2e#/add');
    await expect(page.locator('input[type=file][multiple]')).toHaveCount(1);
    await page.waitForTimeout(1000);
    await expect(page.getByRole('region', { name: 'AI models not downloaded' })).toHaveCount(0);
  });
});

test.describe('#3 Model lab says when a tap didn\'t work', () => {
  test('#3 choosing a model while the database can\'t be written shows an error instead of failing silently', async ({ launch }) => {
    const { page } = await launch();
    await openApp(page, { route: '/model-lab' });
    const use = page.getByRole('button', { name: 'Use FashionCLIP for Clothing type and colour' });
    await expect(use).toBeEnabled();
    await failWrites(page, 'settings', 'put');
    await use.click();
    await expect(page.getByText('Couldn’t save. Try again.')).toBeVisible();
  });
});

test.describe('#6 / #8 real models in one session (needs IMQ_MODEL_MIRROR)', () => {
  test('#6 four garments on a busy table are processed without the page crashing; a WebGPU worker is reused, never terminated', async ({ launch }) => {
    test.setTimeout(420_000);
    const { context, page } = await launch({ models: 'mirror' });
    // Logs what the app tells its AI workers.
    await context.addInitScript(() => {
      const log: string[] = ((window as unknown as { __workerLog: string[] }).__workerLog = []);
      const ids = new WeakMap<object, number>();
      let count = 0;
      const id = (w: object) => { if (!ids.has(w)) { ids.set(w, ++count); log.push(`spawn ${count}`); } return ids.get(w); };
      const proto = Worker.prototype as unknown as { postMessage: (...a: unknown[]) => void; terminate: () => void };
      const { postMessage, terminate } = proto;
      proto.postMessage = function (this: object, ...a: unknown[]) {
        const n = id(this);
        if ((a[0] as { type?: string })?.type === 'dispose') log.push(`dispose ${n}`);
        return postMessage.apply(this, a);
      };
      proto.terminate = function (this: object) { log.push(`terminate ${id(this)}`); return terminate.call(this); };
    });
    let crashed = false;
    page.on('crash', () => { crashed = true; });
    await openApp(page, { route: '/add' });
    await page.getByRole('dialog').getByRole('button', { name: 'Continue' }).click();
    // Garments on wooden planks with clutter: the plain-background cut-out gives up, so the cut-out model runs.
    const files = [];
    for (const [i, [kind, colour]] of [['tee', '#1f3a5f'], ['jeans', '#a8323a'], ['sweater', '#4f7a4a'], ['skirt', '#c9962f']].entries()) {
      const data = await page.evaluate(({ kind, colour }) => {
        const W = 1200, H = 1600;
        const c = document.createElement('canvas'); c.width = W; c.height = H;
        const g = c.getContext('2d')!;
        for (let y = 0; y < H; y += H / 9) { g.fillStyle = `hsl(${25 + (y % 7)}, 35%, ${45 + (y / H) * 15}%)`; g.fillRect(0, y, W, H / 9 - 4); }
        for (let k = 0; k < 300; k++) { g.strokeStyle = `rgba(60,30,10,${0.15 + (k % 5) / 20})`; g.lineWidth = 2 + (k % 4); g.beginPath(); const y0 = (k * 7919) % H; g.moveTo(0, y0); g.bezierCurveTo(W / 3, y0 + 30, (2 * W) / 3, y0 - 30, W, y0 + 10); g.stroke(); }
        for (let k = 0; k < 12; k++) { g.fillStyle = ['#d33', '#36c', '#eee', '#222', '#f90'][k % 5]; g.fillRect((k * 104729) % W, (k * 7919) % H, W / 14, H / 20); }
        const t = document.createElement('canvas'); t.width = W; t.height = H;
        (window as unknown as { __imqLib: { draw: (...a: unknown[]) => void } }).__imqLib.draw(t.getContext('2d'), W, H, { type: 'garment', kind, colour, bg: 'rgba(0,0,0,0)' });
        g.drawImage(t, 0, 0);
        return c.toDataURL('image/jpeg', 0.9);
      }, { kind, colour });
      files.push({ name: `busy-${i}.jpg`, mimeType: 'image/jpeg', buffer: Buffer.from(data.split(',')[1], 'base64') });
    }
    await page.locator('input[type=file][multiple]').setInputFiles(files);
    await expect.poll(() => withDb(page, `return await db.queue.count()`)).toBe(4);
    await expect.poll(async () => crashed || (await queueStates(page).catch(() => ['?'])).every((s) => s === 'done' || s.startsWith('failed')), { timeout: 400_000, intervals: [2000] }).toBe(true);
    expect(crashed).toBe(false);
    expect(await queueStates(page)).toEqual(['done', 'done', 'done', 'done']);
    const cutBy = await withDb<string[]>(page, `return (await db.photos.toArray()).map((p) => p.cutoutModel)`);
    expect(cutBy.filter((m) => m !== 'plain-bg').length).toBeGreaterThan(0);
    // The queue let the models go once it was empty (#8), and never terminated a worker it hadn't asked to dispose.
    const workerLog = () => page.evaluate(() => (window as unknown as { __workerLog: string[] }).__workerLog);
    await expect.poll(async () => (await workerLog()).at(-1)).toMatch(/^(dispose|terminate)/);
    const log = await workerLog();
    for (const entry of log.filter((l) => l.startsWith('terminate'))) expect(log.indexOf(entry.replace('terminate', 'dispose'))).toBeGreaterThanOrEqual(0);
    // On WebGPU one worker does all of it: cut-out model, CLIP's text half, CLIP's image half.
    if (await page.evaluate(async () => !!(await (navigator as unknown as { gpu?: { requestAdapter(): Promise<unknown> } }).gpu?.requestAdapter()))) {
      expect(log.filter((l) => l.startsWith('spawn'))).toEqual(['spawn 1']);
      expect(log.filter((l) => l.startsWith('terminate'))).toEqual([]);
    }
  });
});
