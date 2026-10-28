// Data, AI and memory items of docs/bug-audit.md. WebKit (iPhone Safari's engine), iPhone 15 Pro, persistent profiles
// that are closed and reopened like iOS killing the home-screen app. Synthetic garments only (R2).
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test as base, devices, expect, webkit, type BrowserContext, type Page } from '@playwright/test';
import { fakeDevice, garmentFile, modelMirror, openApp, withDb } from './helpers';

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
