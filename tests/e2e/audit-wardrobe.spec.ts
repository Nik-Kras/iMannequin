// Adding, reviewing and browsing clothes (docs/bug-audit.md). WebKit, iPhone 15 Pro, synthetic garments (R2).
// Model downloads are refused (no network for Hugging Face), so the queue never fetches real models.
import type { Locator, Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { failWrites, fakeDevice, garmentFile, openApp, setCamera, withDb } from './helpers';

test.beforeEach(async ({ context }) => {
  await fakeDevice(context);
  await context.route('https://huggingface.co/**', (r) => r.abort());
});

/** Code for withDb bodies that defines `png`: a synthetic garment drawn in the page. */
const PNG = (colour = '#1f3a5f') => `
  const c = document.createElement('canvas'); c.width = 240; c.height = 300;
  window.__imqLib.draw(c.getContext('2d'), 240, 300, { type: 'garment', kind: 'tee', colour: '${colour}' });
  const png = await new Promise((r) => c.toBlob(r, 'image/png'));`;

interface SeedItem {
  id: string; name: string; category?: string; status?: 'review' | 'active'; colours?: string[]; seasons?: string[];
  locationId?: string; lastWornAt?: number; photos?: number; createdAt?: number;
  suggestion?: { categories?: { id: string; score: number }[]; colours?: string[]; seasons?: string[]; aiFields?: string[]; sameItemId?: string };
}

/** Stores an item with `photos` synthetic photos (the first is the try-on photo). */
async function seedItem(page: Page, o: SeedItem) {
  const item = {
    category: 'tshirt', status: 'review', colours: ['navy'], seasons: ['summer'], ...o,
    suggestion: o.suggestion ?? (o.status === 'active' ? undefined : { categories: [{ id: o.category ?? 'tshirt', score: 0.8 }], colours: o.colours ?? ['navy'], seasons: [], aiFields: ['name', 'category', 'colours'] }),
  };
  await withDb(page, `${PNG()}
    const now = ${o.createdAt ?? 'Date.now()'};
    const item = ${JSON.stringify(item)};
    delete item.photos;
    const ids = [];
    for (let i = 0; i < ${o.photos ?? 1}; i++) {
      const pid = item.id + '-p' + i; ids.push(pid);
      await db.photos.put({ id: pid, itemId: item.id, original: png, cutout: png, thumb: png, width: 240, height: 300, cutoutModel: 'birefnet-lite', cutoutApproved: false, createdAt: now + i });
    }
    await db.items.put({ ...item, tryOnPhotoId: ids[0], createdAt: now, updatedAt: now });`);
  return o.id;
}

/** A queue job as the queue stores it (photo bytes + state), for the inbox and the camera strip. */
async function seedJob(page: Page, o: { id: string; state: 'waiting' | 'working' | 'done' | 'failed'; error?: string; errorCode?: string; itemId?: string; createdAt?: number }) {
  await withDb(page, `${PNG('#a8323a')}
    await db.queue.put({ kind: 'garment', blob: png, createdAt: ${o.createdAt ?? 'Date.now()'}, ...${JSON.stringify(o)} });`);
}

const toast = (page: Page) => page.locator('.toast');

/** Touch area of a control, counting an absolutely positioned ::after hit area (as the a11y audit measured). */
async function hitSize(l: Locator) {
  return l.evaluate((el) => {
    const r = el.getBoundingClientRect();
    const a = getComputedStyle(el, '::after');
    let w = r.width, h = r.height;
    if (a.content !== 'none' && a.position === 'absolute') {
      const px = (v: string) => (v.endsWith('px') ? parseFloat(v) : 0);
      w = Math.max(w, r.width - px(a.left) - px(a.right));
      h = Math.max(h, r.height - px(a.top) - px(a.bottom));
    }
    return { w, h };
  });
}

// ---------------------------------------------------------------- #3 Silent failures

test.describe('#3 silent failures in adding and reviewing clothes', () => {
  test('#3 a shutter photo that can’t be stored says so, flashes only once stored, and Retry stores it', async ({ page }) => {
    await openApp(page, { route: '/add' });
    await page.getByRole('button', { name: 'Continue' }).click(); // the first-visit photo guide
    await setCamera(page, { type: 'garment', kind: 'tee' });
    const shutter = page.getByRole('button', { name: 'Take photo' });
    await expect(shutter).toBeVisible();
    await page.waitForFunction(() => (document.querySelector('video') as HTMLVideoElement | null)?.videoWidth);
    await failWrites(page, 'queue', 'bulkAdd', 2);
    await failWrites(page, 'queue', 'add', 2);
    await shutter.click();
    await expect(toast(page)).toContainText('Couldn’t keep the photo');
    await expect(page.locator('.wd-cam__flash')).toHaveCount(0);
    await toast(page).getByRole('button', { name: 'Try again' }).click();
    await expect.poll(() => withDb(page, 'return db.queue.count()')).toBe(1);
    await expect(page.locator('.wd-cam__flash')).toHaveCount(1);
  });

  test('#3 a gallery import that can’t be stored says so', async ({ page }) => {
    await openApp(page, { route: '/add' });
    await failWrites(page, 'queue', 'bulkAdd');
    await failWrites(page, 'queue', 'add');
    await page.locator('label.wd-cam__side input[type=file]').setInputFiles([await garmentFile(page, 'tee'), await garmentFile(page, 'jeans')]);
    await expect(toast(page)).toContainText('Couldn’t keep the photo');
  });

  test('#3 Save that fails says so, and the button works again', async ({ page }) => {
    await openApp(page);
    await seedItem(page, { id: 'r1', name: 'Navy T-shirt' });
    await page.goto('./?e2e#/item/r1');
    const save = page.getByRole('button', { name: /^Save/ });
    await failWrites(page, 'items', 'put', 2);
    await save.click();
    await expect(toast(page)).toContainText('Couldn’t save');
    await expect(save).toBeEnabled();
    await save.click();
    await expect.poll(() => withDb(page, `return (await db.items.get('r1')).status`)).toBe('active');
  });

  test('#3 "Looks good", "Use for try-on", "Yes, same one" and Delete report failures', async ({ page }) => {
    await openApp(page);
    await seedItem(page, { id: 'old', name: 'Olive skirt', category: 'skirt', status: 'active', colours: ['olive'], photos: 2 });
    await seedItem(page, { id: 'r1', name: 'Olive skirt', category: 'skirt', colours: ['olive'], suggestion: { categories: [{ id: 'skirt', score: 0.9 }], aiFields: ['name', 'category'], sameItemId: 'old' } });
    await page.goto('./?e2e#/item/r1');
    await failWrites(page, 'photos', 'update');
    await page.getByRole('button', { name: /Looks good/ }).click();
    await expect(toast(page)).toContainText('didn’t work');
    await failWrites(page, 'items', 'delete');
    await page.getByRole('button', { name: 'Yes, same one' }).click();
    await expect(toast(page)).toContainText('didn’t work');
    await page.getByRole('button', { name: 'Delete this photo' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Delete' }).click();
    await expect(toast(page)).toContainText('didn’t work');

    await page.goto('./?e2e#/item/old');
    await page.getByRole('button', { name: /Photo 2/ }).click();
    await failWrites(page, 'items', 'put');
    await page.getByRole('button', { name: 'Use for try-on' }).click();
    await expect(toast(page)).toContainText('Couldn’t save');
  });

  test('#3 Fix cut-out “Use this cut-out” that fails says so', async ({ page }) => {
    await openApp(page);
    await seedItem(page, { id: 'r1', name: 'Navy T-shirt' });
    await page.goto('./?e2e#/item/r1/fix');
    await failWrites(page, 'photos', 'update');
    await page.getByRole('button', { name: 'Use this cut-out' }).click();
    await expect(toast(page)).toContainText('Couldn’t save');
    await expect(page.getByRole('button', { name: 'Use this cut-out' })).toBeEnabled();
  });

  test('#3 review inbox Try again and Remove report failures', async ({ page }) => {
    await openApp(page);
    await seedJob(page, { id: 'j1', state: 'failed', error: 'Something odd' });
    await page.goto('./?e2e#/review');
    await failWrites(page, 'queue', 'update');
    await page.getByRole('button', { name: 'Try again' }).click();
    await expect(toast(page)).toContainText('didn’t work');
    await failWrites(page, 'queue', 'delete');
    await page.getByRole('button', { name: 'Remove' }).click();
    await expect(toast(page)).toContainText('didn’t work');
    await expect(page).toHaveURL(/#\/review/);
  });

  test('#3 seasonal swap and place rename report failures', async ({ page }) => {
    await openApp(page, { seed: true, route: '/season-swap' });
    await page.getByRole('group', { name: 'Season to put away' }).getByRole('button', { name: 'Summer' }).click();
    await page.getByRole('group', { name: 'Where it goes' }).getByRole('button').first().click();
    const move = page.locator('.wd-movebar button');
    await expect(move).toBeEnabled();
    await failWrites(page, 'items', 'update');
    await move.click();
    await expect(toast(page)).toContainText('Couldn’t save');
    await expect(move).toBeEnabled();

    await page.goto('./?e2e#/places');
    await page.getByRole('button', { name: 'Edit', exact: true }).click();
    await page.getByRole('button', { name: /^Edit / }).first().click();
    await failWrites(page, 'locations', 'update');
    await page.getByRole('dialog').getByRole('textbox').fill('Attic');
    await page.getByRole('dialog').getByRole('button', { name: 'Rename' }).click();
    await expect(toast(page)).toContainText('Couldn’t save');
  });
});

// ---------------------------------------------------------------- #16 Which photo failed and why

test.describe('#16 the queue says which photo failed and why', () => {
  test('#16 a failed row shows its photo, and a lost connection is not blamed on the photo', async ({ page }) => {
    await openApp(page);
    await seedJob(page, { id: 'net', state: 'failed', error: 'Load failed' });
    await seedJob(page, { id: 'idb', state: 'failed', error: 'QuotaExceededError: The quota has been exceeded.' });
    await page.goto('./?e2e#/review');
    const rows = page.locator('.wd-failrow');
    await expect(rows).toHaveCount(2);
    await expect(rows.first().locator('img')).toHaveCount(1);
    await expect(page.getByText('Couldn’t find the garment')).toHaveCount(0);
    await expect(rows.first()).toContainText('connection');
    await expect(rows.nth(1)).toContainText('space');
    await expect(rows.first().getByRole('button', { name: 'Try again' })).toBeVisible();
  });

  test('#16 each failure code has its own message and action', async ({ page }) => {
    await openApp(page);
    const t0 = Date.now();
    await seedJob(page, { id: 'a', state: 'failed', error: 'x', errorCode: 'no-garment', createdAt: t0 });
    await seedJob(page, { id: 'b', state: 'failed', error: 'x', errorCode: 'models', createdAt: t0 + 1 });
    await seedJob(page, { id: 'c', state: 'failed', error: 'x', errorCode: 'photo-lost', createdAt: t0 + 2 });
    await seedJob(page, { id: 'd', state: 'failed', error: 'x', errorCode: 'unreadable', createdAt: t0 + 3 });
    await page.goto('./?e2e#/review');
    const rows = page.locator('.wd-failrow');
    await expect(rows.nth(0)).toContainText('Couldn’t find the garment');
    await expect(rows.nth(0).getByRole('button', { name: 'Retake' })).toBeVisible();
    await expect(rows.nth(1).getByRole('button', { name: 'Download models' })).toBeVisible();
    await expect(rows.nth(2)).toContainText('This photo was lost');
    await expect(rows.nth(2).getByRole('button', { name: 'Remove' })).toBeVisible();
    await expect(rows.nth(3)).toContainText('can’t be opened');
    await rows.nth(3).getByRole('button', { name: 'Remove' }).click();
    await expect(rows).toHaveCount(3);
    await rows.nth(1).getByRole('button', { name: 'Download models' }).click();
    await expect(page).toHaveURL(/#\/models/);
  });

  test('#16 photos still waiting show their own state', async ({ page, context }) => {
    // Hold the model download so the first photo stays "cutting out".
    await context.unroute('https://huggingface.co/**');
    await context.route('https://huggingface.co/**', () => {});
    await openApp(page);
    const t0 = Date.now();
    await seedJob(page, { id: 'w1', state: 'waiting', createdAt: t0 });
    await seedJob(page, { id: 'w2', state: 'waiting', createdAt: t0 + 1 });
    await page.goto('./?e2e#/review');
    const pending = page.getByRole('list', { name: /still cutting out/ });
    await expect(pending.getByRole('listitem')).toHaveCount(2);
    await expect(pending.locator('img')).toHaveCount(2);
    await expect(pending.getByRole('listitem').filter({ hasText: /Waiting|Cutting out/ })).toHaveCount(2);
  });

  test('#16 files that aren’t photos are counted, not dropped silently', async ({ page }) => {
    await openApp(page, { route: '/add' });
    const txt = { name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('not a photo') };
    await page.locator('label.wd-cam__side input[type=file]').setInputFiles([await garmentFile(page, 'tee'), await garmentFile(page, 'jeans'), txt]);
    await expect(toast(page)).toContainText('2 photos added');
    await expect(toast(page)).toContainText('1 file wasn’t a photo');
    await page.locator('label.wd-cam__side input[type=file]').setInputFiles([txt]);
    await expect(toast(page)).toContainText('1 file wasn’t a photo');
  });

  test('#16 strip thumbnails open their review item or their failed row', async ({ page }) => {
    await openApp(page);
    await seedItem(page, { id: 'r1', name: 'Navy T-shirt' });
    const t0 = Date.now();
    await seedJob(page, { id: 'f1', state: 'failed', error: 'No garment found in the photo', createdAt: t0 });
    await seedJob(page, { id: 'd1', state: 'done', itemId: 'r1', createdAt: t0 + 1 });
    await page.goto('./?e2e#/add');
    await page.getByRole('link', { name: 'Didn’t work' }).click();
    await expect(page).toHaveURL(/#\/review\?job=f1/);
    await expect(page.locator('.wd-failrow--target')).toBeInViewport();
    await page.goBack();
    await page.getByRole('link', { name: 'Ready to review' }).click();
    await expect(page).toHaveURL(/#\/item\/r1/);
  });
});

// ---------------------------------------------------------------- #17 Review in fewer steps

test.describe('#17 reviewing a pile of garments', () => {
  test('#17 a sticky "Save and next · 1 of 3" without scrolling; "Looks good" is a quiet tick', async ({ page }) => {
    await openApp(page);
    const t0 = Date.now();
    for (const [i, id] of ['a', 'b', 'c'].entries()) await seedItem(page, { id, name: `Tee ${id}`, createdAt: t0 + i });
    await page.goto('./?e2e#/item/a');
    const save = page.getByRole('button', { name: 'Save and next · 1 of 3' });
    await expect(save).toBeInViewport({ ratio: 1 });
    await expect(page.locator('.wd-form .btn--primary')).toHaveCount(1);
    await save.click();
    await expect(page).toHaveURL(/#\/item\/b/);
    await expect(page.getByRole('button', { name: 'Save and next · 1 of 2' })).toBeInViewport({ ratio: 1 });
  });

  test('#17 the place used for the last garment is suggested for the next, marked ✦', async ({ page }) => {
    await openApp(page);
    const t0 = Date.now();
    await seedItem(page, { id: 'a', name: 'Tee a', createdAt: t0 });
    await seedItem(page, { id: 'b', name: 'Tee b', createdAt: t0 + 1 });
    await page.goto('./?e2e#/item/a');
    await page.getByRole('button', { name: /Where is it kept/ }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Hallway' }).first().click();
    await page.getByRole('button', { name: /^Save and next/ }).click();
    await expect(page).toHaveURL(/#\/item\/b/);
    const field = page.getByRole('button', { name: /Where is it kept/ });
    await expect(field).toContainText('Hallway');
    await expect(field.getByRole('img', { name: 'Suggested by AI' })).toHaveCount(1);
    await page.getByRole('button', { name: /^Save/ }).click();
    expect(await withDb(page, `const h = (await db.locations.toArray()).find((p) => p.name.startsWith('Hallway')); return (await db.items.get('b')).locationId === h.id`)).toBe(true);
  });
});

// ---------------------------------------------------------------- #18 Edits kept

test.describe('#18 item-form edits and wardrobe filters survive leaving the screen', () => {
  test('#18 edits survive the edge swipe back, Fix → back, and the app being killed', async ({ page }) => {
    await openApp(page, { route: '/wardrobe' });
    await seedItem(page, { id: 'a1', name: 'Navy T-shirt', status: 'active' });
    await page.getByRole('link', { name: /Navy T-shirt/ }).click();
    await page.getByLabel('Name').fill('My tee');
    await page.getByLabel('Brand').fill('Acme');
    await page.goBack();
    await page.getByRole('link', { name: /Navy T-shirt/ }).click();
    await expect(page.getByLabel('Name')).toHaveValue('My tee');
    await expect(page.getByLabel('Brand')).toHaveValue('Acme');
    await page.getByRole('link', { name: 'Fix' }).click();
    await expect(page.getByRole('heading', { name: 'Fix the cut-out' })).toBeVisible();
    await page.goBack();
    await expect(page.getByLabel('Name')).toHaveValue('My tee');
    await page.reload();
    await expect(page.getByLabel('Name')).toHaveValue('My tee');
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(page).toHaveURL(/#\/wardrobe/);
    await page.getByRole('link', { name: /My tee/ }).click();
    await expect(page.getByLabel('Name')).toHaveValue('My tee');
  });

  test('#18 Back asks before discarding changes', async ({ page }) => {
    await openApp(page, { route: '/wardrobe' });
    await seedItem(page, { id: 'a1', name: 'Navy T-shirt', status: 'active' });
    await page.getByRole('link', { name: /Navy T-shirt/ }).click();
    await page.getByLabel('Name').fill('My tee');
    await page.locator('.wd-form__nav .back').click();
    const dialog = page.getByRole('dialog', { name: 'Discard changes?' });
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(page.getByLabel('Name')).toHaveValue('My tee');
    await page.locator('.wd-form__nav .back').click();
    await page.getByRole('dialog').getByRole('button', { name: 'Discard' }).click();
    await expect(page).toHaveURL(/#\/wardrobe/);
    await page.getByRole('link', { name: /Navy T-shirt/ }).click();
    await expect(page.getByLabel('Name')).toHaveValue('Navy T-shirt');
  });

  test('#18 wardrobe search, filters and scroll survive a visit to an item', async ({ page }) => {
    await page.setViewportSize({ width: 393, height: 560 });
    await openApp(page, { seed: true, route: '/wardrobe' });
    const cards = page.locator('.wd-grid > li');
    await expect(cards).toHaveCount(17);
    await page.getByRole('button', { name: 'Tops', exact: true }).click();
    await expect(cards).toHaveCount(3);
    await cards.first().getByRole('link').click();
    await expect(page.getByLabel('Name')).toBeVisible();
    await page.goBack();
    await expect(page.getByRole('button', { name: 'Tops', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await expect(cards).toHaveCount(3);

    await page.getByRole('button', { name: 'All', exact: true }).click();
    await page.getByRole('searchbox').fill('black');
    await page.keyboard.press('Enter');
    await expect(page.getByText(/found for “black”/)).toBeVisible();
    const found = await cards.count();
    await cards.first().getByRole('link').click();
    await page.goBack();
    await expect(page.getByRole('searchbox')).toHaveValue('black');
    await expect(cards).toHaveCount(found);

    await page.getByRole('button', { name: 'Clear search' }).click();
    await expect(cards).toHaveCount(17);
    await cards.last().scrollIntoViewIfNeeded();
    const y = await page.evaluate(() => scrollY);
    expect(y).toBeGreaterThan(200);
    await cards.last().getByRole('link').click();
    await expect(page.getByLabel('Name')).toBeVisible();
    await page.goBack();
    await expect(cards).toHaveCount(17);
    await expect.poll(() => page.evaluate(() => scrollY)).toBeGreaterThan(y - 40);
  });
});

// ---------------------------------------------------------------- #10 Search model

test('#10 free-text search never loads the language model by itself; a tap offers it', async ({ page, context }) => {
  // A phone with WebGPU: the only kind that may run the language model.
  await context.addInitScript(() => {
    Object.defineProperty(navigator, 'gpu', { configurable: true, value: { requestAdapter: async () => ({ features: new Set(['shader-f16']), limits: { maxStorageBuffersPerShaderStage: 10 } }) } });
  });
  await openApp(page, { seed: true, route: '/wardrobe' });
  await page.getByRole('searchbox').fill('щось для пікніка з друзями');
  await page.keyboard.press('Enter');
  await expect(page.locator('.wd-resultline, .empty').first()).toBeVisible();
  const smarter = page.getByRole('button', { name: /Search smarter/ });
  await expect(smarter).toBeVisible();
  await smarter.click();
  await page.getByRole('dialog').getByRole('button', { name: 'Open Model lab' }).click();
  await expect(page).toHaveURL(/#\/model-lab/);
});

// ---------------------------------------------------------------- #11 The camera strip

test.describe('#11 the Add-clothes strip', () => {
  test('#11 each photo in the strip gets one image URL while it goes through the queue', async ({ page, context }) => {
    await context.addInitScript(() => {
      const real = URL.createObjectURL.bind(URL);
      (window as unknown as { __urls: number }).__urls = 0;
      URL.createObjectURL = (b: Blob | MediaSource) => { (window as unknown as { __urls: number }).__urls++; return real(b); };
    });
    await openApp(page);
    await seedItem(page, { id: 'a1', name: 'Navy T-shirt', status: 'active' }); // no first-visit guide
    await page.goto('./?e2e#/add');
    const n = 3;
    const files = [];
    for (const k of ['tee', 'jeans', 'skirt']) files.push(await garmentFile(page, k, '#2f3e5c'));
    await page.locator('label.wd-cam__side input[type=file]').setInputFiles(files);
    // Every photo goes waiting → cutting out → ready (or failed): each state change re-read every row.
    await expect(page.locator('.wd-cam__strip .wd-jobthumb--waiting, .wd-cam__strip .wd-jobthumb--working')).toHaveCount(0, { timeout: 45_000 });
    await expect(page.locator('.wd-cam__strip > li:not(.wd-jobthumb--empty)')).toHaveCount(n);
    await page.waitForTimeout(500);
    // One URL for the photo, one for its cut-out once it's ready.
    expect(await page.evaluate(() => (window as unknown as { __urls: number }).__urls)).toBeLessThanOrEqual(2 * n);
  });

  test('#11 a gallery import fills the strip photo by photo, with feedback', async ({ page, context }) => {
    // Hold the model download so nothing finishes while the photos come in.
    await context.unroute('https://huggingface.co/**');
    await context.route('https://huggingface.co/**', () => {});
    await openApp(page, { route: '/add' });
    await page.evaluate(() => {
      const w = window as unknown as { __counts: number[]; __texts: string[] };
      w.__counts = []; w.__texts = [];
      new MutationObserver(() => {
        w.__counts.push(document.querySelectorAll('.wd-cam__strip > li:not(.wd-jobthumb--empty)').length);
        w.__texts.push(document.querySelector('.wd-cam__left')?.textContent ?? '');
      }).observe(document.body, { subtree: true, childList: true, characterData: true });
    });
    const files = [];
    for (const k of ['tee', 'jeans', 'skirt', 'sweater', 'coat', 'dress']) files.push(await garmentFile(page, k, '#2f3e5c', { W: 2400, H: 3200 }));
    await page.locator('label.wd-cam__side input[type=file]').setInputFiles(files);
    await expect(page.locator('.wd-cam__strip > li:not(.wd-jobthumb--empty)')).toHaveCount(6, { timeout: 30_000 });
    const { counts, texts } = await page.evaluate(() => {
      const w = window as unknown as { __counts: number[]; __texts: string[] };
      return { counts: w.__counts, texts: w.__texts };
    });
    expect(counts.some((n) => n > 0 && n < 6)).toBe(true);
    expect(texts.some((s) => /Adding photos/.test(s))).toBe(true);
  });
});

// ---------------------------------------------------------------- #20 Unrecognised category

test('#20 an unrecognised garment has no category until the user picks one', async ({ page }) => {
  await openApp(page);
  await seedItem(page, { id: 'u1', name: 'Navy T-shirt', suggestion: { categories: [], colours: ['navy'], seasons: [], aiFields: ['name', 'colours'] } });
  await page.goto('./?e2e#/item/u1');
  await expect(page.getByText('The AI didn’t recognise it. Choose a category.')).toBeVisible();
  const group = page.getByRole('group', { name: 'Category' });
  await expect(group.locator('[aria-pressed=true]')).toHaveCount(0);
  const save = page.getByRole('button', { name: /^Save/ });
  await expect(save).toBeDisabled();
  await group.getByRole('button', { name: 'All categories' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Jeans' }).click();
  await expect(save).toBeEnabled();
  await save.click();
  await expect.poll(() => withDb(page, `return (await db.items.get('u1')).category`)).toBe('jeans');
});

// ---------------------------------------------------------------- #21 Retake

test.describe('#21 Retake asks first and Close lands somewhere real', () => {
  test('#21 Retake in the review inbox asks before deleting the photo', async ({ page }) => {
    await openApp(page);
    await seedJob(page, { id: 'j1', state: 'failed', error: 'No garment found in the photo' });
    await page.goto('./?e2e#/review');
    await page.getByRole('button', { name: 'Retake' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    expect(await withDb(page, `return db.queue.count()`)).toBe(1);
    await page.getByRole('button', { name: 'Retake' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Retake' }).click();
    await expect(page).toHaveURL(/#\/add/);
    expect(await withDb(page, `return db.queue.count()`)).toBe(0);
  });

  test('#21 Retake in Fix cut-out asks first, and Close returns to the review inbox', async ({ page }) => {
    await openApp(page, { route: '/wardrobe' });
    await seedItem(page, { id: 'r1', name: 'Navy T-shirt' });
    await page.goto('./?e2e#/review');
    await page.getByRole('link', { name: /Navy T-shirt/ }).click();
    await page.getByRole('link', { name: 'Fix' }).click();
    await page.getByRole('button', { name: 'Retake photo' }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    expect(await withDb(page, `return !!(await db.items.get('r1'))`)).toBe(true);
    await page.getByRole('dialog').getByRole('button', { name: 'Retake' }).click();
    await expect(page).toHaveURL(/#\/add/);
    await page.getByRole('dialog').getByRole('button', { name: 'Continue' }).click(); // the first-visit photo guide
    await page.getByRole('button', { name: 'Close camera' }).click();
    await expect(page).toHaveURL(/#\/review/);
    await expect(page.getByText('isn’t here any more')).toHaveCount(0);
  });
});

// ---------------------------------------------------------------- #23, #25

test('#23 a double tap on Add creates one place', async ({ page }) => {
  await openApp(page, { route: '/places' });
  await expect(page.locator('.wd-places > li').first()).toBeVisible();
  const n = await withDb<number>(page, 'return db.locations.count()');
  await page.getByRole('button', { name: 'Add a place' }).click();
  await page.getByRole('dialog').getByRole('textbox').fill('Attic');
  await page.getByRole('dialog').getByRole('button', { name: 'Add', exact: true }).dblclick();
  await expect.poll(() => withDb(page, 'return db.locations.count()')).toBe(n + 1);
  await page.waitForTimeout(300);
  expect(await withDb(page, 'return db.locations.count()')).toBe(n + 1);
});

test('#25 a Fix cut-out link to a missing item says so', async ({ page }) => {
  await openApp(page, { route: '/item/nope/fix' });
  await expect(page.getByText('This item isn’t here any more.')).toBeVisible();
});

// ---------------------------------------------------------------- #42 #43 #45 #46 #48 #49 #50

test.describe('#42 touch targets in the wardrobe screens are at least 44 px', () => {
  test('#42 search clear, tips pill, quick places, New place, brand field', async ({ page }) => {
    await openApp(page, { route: '/wardrobe' });
    await seedItem(page, { id: 'a1', name: 'Navy T-shirt', status: 'active' });
    await page.getByRole('searchbox').fill('navy');
    const clear = await hitSize(page.getByRole('button', { name: 'Clear search' }));
    expect(clear.w).toBeGreaterThanOrEqual(44);
    expect(clear.h).toBeGreaterThanOrEqual(44);

    await page.goto('./?e2e#/item/a1');
    for (const l of [page.locator('.wd-tagbtn--quiet').first(), page.getByRole('button', { name: /New place/ })]) {
      expect((await hitSize(l)).h).toBeGreaterThanOrEqual(44);
    }
    expect((await page.getByLabel('Brand').boundingBox())!.height).toBeGreaterThanOrEqual(44);

    await page.goto('./?e2e#/add');
    expect((await page.locator('.wd-cam__pill').boundingBox())!.height).toBeGreaterThanOrEqual(44);
  });

  test('#42 Fix cut-out tool tabs and season-swap chips', async ({ page }) => {
    await openApp(page);
    await seedItem(page, { id: 'a1', name: 'Navy T-shirt', status: 'active' });
    await page.goto('./?e2e#/item/a1/fix');
    await page.getByRole('button', { name: 'Brush' }).click();
    expect((await page.getByRole('button', { name: 'Erase' }).boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await page.goto('./?e2e#/season-swap');
    expect((await page.getByRole('group', { name: 'Season to put away' }).getByRole('button').first().boundingBox())!.height).toBeGreaterThanOrEqual(44);
  });
});

test('#43 the item form has a heading, and colour chips announce what a tap does', async ({ page }) => {
  await openApp(page);
  await seedItem(page, { id: 'r1', name: 'Navy T-shirt' });
  await page.goto('./?e2e#/item/r1');
  await expect(page.getByRole('heading', { level: 1, name: 'Navy T-shirt' })).toHaveCount(1);
  const chip = page.getByRole('button', { name: 'Remove Navy, suggested by AI' });
  await expect(chip).toBeVisible();
  await expect(chip).not.toHaveAttribute('aria-pressed', /.*/);
});

test('#45 unselected chips, notes field and review dots use the --line border', async ({ page }) => {
  await openApp(page);
  const t0 = Date.now();
  await seedItem(page, { id: 'r1', name: 'Tee 1', createdAt: t0 });
  await seedItem(page, { id: 'r2', name: 'Tee 2', createdAt: t0 + 1 });
  await page.goto('./?e2e#/item/r1');
  const line = 'rgb(137, 132, 122)';
  await expect(page.getByRole('group', { name: 'Seasons' }).getByRole('button', { name: 'Winter' })).toHaveCSS('border-top-color', line);
  await expect(page.getByLabel('Notes')).toHaveCSS('border-top-color', line);
  await expect(page.locator('.wd-dot:not(.wd-dot--on)').first()).toHaveCSS('background-color', line);
});

test('#46 place names on cards are 18 px Caveat in ink', async ({ page }) => {
  await openApp(page, { seed: true, route: '/wardrobe' });
  const place = page.locator('.wd-card__place').first();
  await expect(place).toHaveCSS('font-size', '18px');
  await expect(place).toHaveCSS('color', 'rgb(20, 20, 20)');
});

test('#48 options, cards and rows have a pressed state', async ({ page }) => {
  await openApp(page, { route: '/wardrobe' });
  const rules = await page.evaluate(() => {
    const out: string[] = [];
    for (const s of document.styleSheets) {
      try { for (const r of s.cssRules) if (r instanceof CSSStyleRule && r.selectorText.includes(':active')) out.push(r.selectorText); } catch { /* cross-origin */ }
    }
    return out.join(' ');
  });
  for (const cls of ['.wd-opt', '.wd-tagbtn', '.wd-rowlink', '.wd-placerow', '.wd-swapcard-item', '.wd-model']) expect(rules).toContain(`${cls}:active`);
});

test.describe('#49 visual defects', () => {
  test('#49 Fix cut-out’s action bar has its own paper behind it', async ({ page }) => {
    await openApp(page);
    await seedItem(page, { id: 'a1', name: 'Navy T-shirt', status: 'active' });
    await page.goto('./?e2e#/item/a1/fix');
    await expect(page.locator('.wd-fix__actions')).not.toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
  });

  test('#49 on an iPhone SE, the cut-out row doesn’t overlap and failed-row buttons stay on one line', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await openApp(page, { lang: 'uk' });
    await seedItem(page, { id: 'r1', name: 'Navy T-shirt' });
    await withDb(page, `await db.photos.update('r1-p0', { cutoutApproved: true });`);
    await seedJob(page, { id: 'j1', state: 'failed', error: 'Something odd' });
    await page.goto('./?e2e#/item/r1');
    // Nothing in the cut-out row overlaps or spills out of its box (the approval text ran under Fix).
    await expect(page.getByRole('link', { name: 'Виправити' })).toBeVisible();
    const clash = await page.locator('.wd-photo__row > *').evaluateAll((els) => {
      const r = els.map((e) => e.getBoundingClientRect());
      const hit = (a: DOMRect, b: DOMRect) => !(a.right <= b.left || b.right <= a.left || a.bottom <= b.top || b.bottom <= a.top);
      return r.some((a, i) => r.some((b, j) => i < j && hit(a, b))) || els.some((e) => e.scrollWidth > e.clientWidth + 1);
    });
    expect(clash).toBe(false);
    await page.goto('./?e2e#/review');
    const buttons = page.locator('.wd-failrow button');
    await expect(buttons.first()).toBeVisible();
    const tops = await buttons.evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().top)));
    expect(new Set(tops).size).toBe(1);
  });
});

test.describe('#50 copy', () => {
  test('#50 Ukrainian: cut-out answer, queue count, last worn date, seconds', async ({ page }) => {
    await openApp(page, { lang: 'uk' });
    await seedItem(page, { id: 'r1', name: 'Темно-синя футболка' });
    await seedItem(page, { id: 'a1', name: 'Темно-синя футболка', status: 'active', lastWornAt: Date.parse('2026-03-12T12:00') });
    await page.goto('./?e2e#/item/r1');
    await expect(page.getByText('Гаразд')).toHaveCount(0);
    await page.goto('./?e2e#/item/a1');
    await expect(page.getByText(/Востаннє вдягали/)).toBeVisible();
    await expect(page.getByText(/р\.\./)).toHaveCount(0);
    await page.goto('./?e2e#/item/a1/fix');
    await expect(page.getByText(/\d,\d с на цьому телефоні/)).toBeVisible({ timeout: 20_000 });
  });

  test('#50 “Looks like your olive skirt”, and one empty-search message', async ({ page }) => {
    await openApp(page, { seed: true });
    const old = await withDb<string>(page, `return (await db.items.toArray()).find((i) => i.name === 'Olive skirt').id`);
    await seedItem(page, { id: 'r1', name: 'Olive skirt', category: 'skirt', colours: ['olive'], suggestion: { categories: [{ id: 'skirt', score: 0.9 }], aiFields: ['name', 'category'], sameItemId: old } });
    await page.goto('./?e2e#/item/r1');
    await expect(page.locator('.wd-same__text')).toContainText('Looks like your olive skirt');
    await page.goto('./?e2e#/wardrobe');
    await page.getByRole('searchbox').fill('zzzz');
    await page.keyboard.press('Enter');
    await expect(page.getByText(/zzzz/)).toHaveCount(1);
  });

  test('#50 the camera-denied message points to the iPhone setting', async ({ context, page }) => {
    await context.addInitScript(() => {
      navigator.mediaDevices.getUserMedia = async () => { throw new DOMException('Permission denied', 'NotAllowedError'); };
    });
    await openApp(page, { route: '/add' });
    await expect(page.getByText(/Settings → Safari → Camera/)).toBeVisible();
  });
});
