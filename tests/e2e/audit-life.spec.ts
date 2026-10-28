// Outfits, wear log, trips, sharing, settings and the backup reminder (docs/bug-audit.md). WebKit, iPhone 15 Pro.
import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { failWrites, openApp, withDb } from './helpers';

const SAVE_FAILED = 'Couldn’t save. Try again.';

/** Ids of the sample clothes by name. */
const ids = (page: Page) => withDb<Record<string, string>>(page, `return Object.fromEntries((await db.items.toArray()).map((i) => [i.name, i.id]));`);

async function setDraft(page: Page, slots: Record<string, string>, outfitId?: string) {
  await withDb(page, `const s = await db.settings.get('app'); await db.settings.put({ ...s, draft: { slots: ${JSON.stringify(slots)}, accessories: [], toggles: { tuckIn: false, intoBoots: false }${outfitId ? `, outfitId: '${outfitId}'` : ''} } });`);
}

async function addOutfit(page: Page, id: string, name: string, slots: Record<string, string>) {
  await withDb(page, `await db.outfits.put({ id: '${id}', name: ${JSON.stringify(name)}, slots: ${JSON.stringify(slots)}, accessories: [], toggles: { tuckIn: false, intoBoots: false }, createdAt: Date.now(), updatedAt: Date.now() });`);
}

/** Today (or another day this month) as an ISO date and as the calendar names it, in the page's time zone. */
const day = (page: Page, back = 0) => page.evaluate((back) => {
  const d = new Date();
  if (d.getDate() > back) d.setDate(d.getDate() - back);
  const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  return { iso, label: d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long' }) };
}, back);

test.describe('#29 wear log', () => {
  test('#29 tapping a logged day opens its entries, and an entry can be deleted', async ({ page }) => {
    await openApp(page, { seed: true, route: '/wear-log' });
    const by = await ids(page);
    const { iso, label } = await day(page);
    await withDb(page, `await db.wear.put({ id: 'w1', date: '${iso}', itemIds: ['${by['Cream T-shirt']}'], createdAt: Date.now() });`);
    await page.getByRole('button', { name: new RegExp(`^${label}`) }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toContainText('Cream T-shirt');
    await dialog.getByRole('button', { name: /Delete/ }).click();
    await expect.poll(() => withDb(page, 'return db.wear.count()')).toBe(0);
  });

  test('#29 a recent day opens the same sheet', async ({ page }) => {
    await openApp(page, { seed: true, route: '/wear-log' });
    const by = await ids(page);
    const { iso } = await day(page);
    await withDb(page, `await db.wear.put({ id: 'w1', date: '${iso}', itemIds: ['${by['Black jeans']}'], createdAt: Date.now() });`);
    await page.getByRole('button', { name: /Black jeans/ }).last().click();
    await expect(page.getByRole('dialog')).toContainText('Black jeans');
  });

  test('#29 the current outfit can be logged for an earlier day', async ({ page }) => {
    await openApp(page, { seed: true, route: '/wear-log' });
    const by = await ids(page);
    await setDraft(page, { legs: by['Blue jeans'] });
    const { iso, label } = await day(page, 1);
    await page.getByRole('button', { name: new RegExp(`^${label}`) }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Log the current outfit for this day' }).click();
    await expect.poll(() => withDb(page, `return (await db.wear.toArray()).map((w) => [w.date, w.itemIds.join()])`)).toEqual([[iso, by['Blue jeans']]]);
  });
});

test.describe('#30 #35 sharing', () => {
  test('#30 Save to Photos opens the share sheet and doesn’t claim it saved anything', async ({ context, page }) => {
    await context.addInitScript(() => {
      Object.defineProperty(Navigator.prototype, 'canShare', { value: () => true, configurable: true });
      Object.defineProperty(Navigator.prototype, 'share', {
        value: async (d: ShareData) => { (window as unknown as { __shared: string[] }).__shared = (d.files ?? []).map((f) => f.type); },
        configurable: true,
      });
    });
    await openApp(page, { seed: true, route: '/dressup' });
    const by = await ids(page);
    await setDraft(page, { base: by['Black T-shirt'], legs: by['Blue jeans'] });
    await page.evaluate(() => { location.hash = '#/share'; });
    await page.getByRole('button', { name: 'Save to Photos' }).click();
    await expect.poll(() => page.evaluate(() => (window as unknown as { __shared?: string[] }).__shared)).toEqual(['image/png']);
    await page.waitForTimeout(300);
    await expect(page.getByText(/Image saved|downloaded/)).toHaveCount(0);
  });

  test('#30 without a share sheet the button says Download, and only then confirms a download', async ({ context, page }) => {
    await context.addInitScript(() => {
      delete (Navigator.prototype as unknown as Record<string, unknown>).share;
      delete (Navigator.prototype as unknown as Record<string, unknown>).canShare;
    });
    await openApp(page, { seed: true, route: '/dressup' });
    const by = await ids(page);
    await setDraft(page, { base: by['Black T-shirt'], legs: by['Blue jeans'] });
    await page.evaluate(() => { location.hash = '#/share'; });
    await expect(page.getByRole('button', { name: 'Save to Photos' })).toHaveCount(0);
    const download = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Download image' }).click();
    await download;
    await expect(page.getByText('Image downloaded')).toBeVisible();
  });

  test('#35 “Include my photo” isn’t offered without a body photo', async ({ page }) => {
    await openApp(page, { seed: true, route: '/dressup' });
    const by = await ids(page);
    await setDraft(page, { base: by['Black T-shirt'] });
    await page.evaluate(() => { location.hash = '#/share'; });
    await expect(page.getByRole('heading', { name: 'Share outfit' })).toBeVisible();
    await page.waitForTimeout(500);
    await expect(page.getByRole('switch', { name: 'Include my photo' })).toHaveCount(0);
  });
});

test.describe('#33 trips', () => {
  test('#33 an end date before the start still creates the trip (dates swapped)', async ({ page }) => {
    await openApp(page, { route: '/trips' });
    await page.getByRole('button', { name: /New trip/ }).first().click();
    await page.getByLabel('Name').fill('Kyiv');
    await page.getByLabel('From').fill('2026-12-10');
    await page.getByLabel('To').fill('2026-12-05');
    await page.getByRole('button', { name: 'Create trip' }).click();
    await expect(page).toHaveURL(/#\/trip\//);
    expect(await withDb(page, `return (await db.trips.toArray()).map((t) => [t.start, t.end])`)).toEqual([['2026-12-05', '2026-12-10']]);
  });

  test('#33 a past trip doesn’t say “in -N days”', async ({ page }) => {
    await openApp(page, { route: '/trips' });
    await withDb(page, `const d = (n) => { const x = new Date(); x.setDate(x.getDate() - n); return x.toISOString().slice(0, 10); };
      await db.trips.put({ id: 'old', name: 'Old trip', start: d(33), end: d(30), entries: [], archived: false, createdAt: Date.now() });`);
    await page.getByRole('link', { name: /Old trip/ }).click();
    await expect(page.getByRole('heading', { name: 'Old trip' })).toBeVisible();
    await expect(page.locator('.trip__meta')).not.toContainText(/-\d/);
  });

  test('#33 the piece picker has category headings and a filter', async ({ page }) => {
    await openApp(page, { seed: true, route: '/trips' });
    await withDb(page, `await db.trips.put({ id: 't1', name: 'Lisbon', start: '2026-11-10', end: '2026-11-12', entries: [], archived: false, createdAt: Date.now() });`);
    await page.getByRole('link', { name: /Lisbon/ }).click();
    await page.getByRole('button', { name: 'Add single pieces' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByRole('heading', { name: 'Jeans' })).toBeVisible();
    await dialog.getByRole('searchbox').fill('jeans');
    await expect(dialog.locator('.picker__cell')).toHaveCount(2);
  });
});

test.describe('#34 #36 #14 settings and reminders', () => {
  test('#34 deleted default places stay deleted', async ({ page }) => {
    await openApp(page, { route: '/settings' });
    // First launch made the six default places (openApp's own settings write can land in between: wait for the flag).
    await expect.poll(() => withDb(page, `return [await db.locations.count(), (await db.settings.get('app')).placesSeeded]`)).toEqual([6, true]);
    await withDb(page, 'await db.locations.clear()');
    for (const r of ['/places', '/wardrobe', '/settings']) {
      await page.evaluate((r) => { location.hash = r; }, r);
      await page.waitForTimeout(400);
    }
    await page.reload();
    await page.waitForTimeout(800);
    expect(await withDb(page, 'return db.locations.count()')).toBe(0);
  });

  test('#36 one new garment doesn’t trigger the backup reminder yet', async ({ page }) => {
    await openApp(page, { seed: true, route: '/wardrobe' });
    await withDb(page, `const all = await db.items.toArray(); await db.items.bulkDelete(all.slice(1).map((i) => i.id));`);
    await page.waitForTimeout(500);
    await expect(page.getByRole('button', { name: 'Back up' })).toHaveCount(0);
  });

  test('#36 ten garments show a quiet reminder whose Ukrainian action is “Створити копію”', async ({ page }) => {
    await openApp(page, { seed: true, lang: 'uk', route: '/wardrobe' });
    const reminder = page.locator('.backup-reminder');
    await expect(reminder.getByRole('button', { name: 'Створити копію' })).toBeVisible();
    await expect(reminder).toHaveCSS('background-color', 'rgb(255, 255, 255)');
  });

  test('#14 Settings offers “Take body photo” when there is none', async ({ page }) => {
    await openApp(page, { route: '/settings' });
    await expect(page.getByRole('button', { name: 'Take body photo' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Retake body photo' })).toHaveCount(0);
  });
});

test.describe('#21 #40 outfits', () => {
  test('#21 putting on a saved outfit over an unsaved look offers Undo', async ({ page }) => {
    await openApp(page, { seed: true, route: '/outfits' });
    const by = await ids(page);
    await addOutfit(page, 'o1', 'Office Monday', { base: by['Black T-shirt'], legs: by['Black jeans'] });
    await setDraft(page, { mid: by['Rust sweater'], legs: by['Blue jeans'] });
    await page.getByRole('button', { name: 'Put on Office Monday' }).click();
    await expect(page).toHaveURL(/#\/dressup$/);
    const undo = page.getByRole('button', { name: 'Undo' });
    await expect(undo).toBeVisible();
    await page.waitForTimeout(4500);
    await expect(undo).toBeVisible(); // toasts with an action stay at least 6 s (#44)
    await undo.click();
    await expect.poll(() => withDb(page, `return (await db.settings.get('app')).draft.slots`)).toEqual({ mid: by['Rust sweater'], legs: by['Blue jeans'] });
  });

  test('#44 a toast with an action waits while it is touched', async ({ page }) => {
    await openApp(page, { seed: true, route: '/outfits' });
    const by = await ids(page);
    await addOutfit(page, 'o1', 'Office Monday', { base: by['Black T-shirt'] });
    await setDraft(page, { legs: by['Blue jeans'] });
    await page.getByRole('button', { name: 'Put on Office Monday' }).click();
    const toast = page.locator('.toast').filter({ has: page.getByRole('button', { name: 'Undo' }) });
    await expect(toast).toBeVisible();
    await toast.dispatchEvent('pointerdown');
    await page.waitForTimeout(8000);
    await expect(toast).toBeVisible();
    await toast.dispatchEvent('pointerup');
    await expect(toast).toHaveCount(0, { timeout: 10_000 });
  });

  test('#40 a long outfit name gets two lines on its tag', async ({ page }) => {
    await openApp(page, { seed: true, route: '/outfits' });
    const by = await ids(page);
    await addOutfit(page, 'o1', 'Weekend in the mountains', { base: by['Black T-shirt'] });
    const tag = page.locator('.outfit-card__tag');
    await expect(tag).toHaveText('Weekend in the mountains');
    expect(await tag.evaluate((e) => e.scrollWidth <= e.clientWidth + 1 && e.scrollHeight <= e.clientHeight + 2)).toBe(true);
  });

  test('#40 a trip’s look names get two lines', async ({ page }) => {
    await openApp(page, { seed: true, route: '/trips' });
    const by = await ids(page);
    await addOutfit(page, 'o1', 'Dinner by the sea', { base: by['Black T-shirt'] });
    await withDb(page, `await db.trips.put({ id: 't1', name: 'Lisbon', start: '2026-11-10', end: '2026-11-12', entries: [{ id: 'e1', kind: 'outfit', refId: 'o1', packed: false }], archived: false, createdAt: Date.now() });`);
    await page.getByRole('link', { name: /Lisbon/ }).click();
    const name = page.locator('.trip-look__name');
    await expect(name).toHaveText('Dinner by the sea');
    expect(await name.evaluate((e) => e.scrollWidth <= e.clientWidth + 1 && e.scrollHeight <= e.clientHeight + 2)).toBe(true);
  });
});

test.describe('#3 outfits, trips and settings writes report failures', () => {
  test('#3 renaming or deleting an outfit that can’t be saved says so', async ({ page }) => {
    await openApp(page, { seed: true, route: '/outfits' });
    const by = await ids(page);
    await addOutfit(page, 'o1', 'Office Monday', { base: by['Black T-shirt'] });
    await failWrites(page, 'outfits', 'update');
    await page.getByRole('button', { name: 'More for Office Monday' }).click();
    await page.getByRole('dialog').getByLabel('Name').fill('Office Tuesday');
    await page.getByRole('dialog').getByRole('button', { name: 'Save' }).click();
    await expect(page.getByText(SAVE_FAILED)).toBeVisible();
    await expect(page.getByRole('dialog')).toBeVisible(); // nothing was saved: the sheet stays open
    await page.getByRole('dialog').getByRole('button', { name: 'Close' }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await failWrites(page, 'outfits', 'delete');
    await page.getByRole('button', { name: 'More for Office Monday' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Delete' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Delete', exact: true }).click();
    await expect(page.getByText(SAVE_FAILED)).toBeVisible();
    expect(await withDb(page, 'return db.outfits.count()')).toBe(1);
  });

  test('#3 putting on an outfit that can’t be saved stays put and says so', async ({ page }) => {
    await openApp(page, { seed: true, route: '/outfits' });
    const by = await ids(page);
    await addOutfit(page, 'o1', 'Office Monday', { base: by['Black T-shirt'] });
    await failWrites(page, 'settings', 'put');
    await page.getByRole('button', { name: 'Put on Office Monday' }).click();
    await expect(page.getByText(SAVE_FAILED)).toBeVisible();
    await expect(page).toHaveURL(/#\/outfits$/);
  });

  test('#3 packing, archiving and deleting a trip report failures', async ({ page }) => {
    await openApp(page, { seed: true, route: '/trips' });
    const by = await ids(page);
    await withDb(page, `await db.trips.put({ id: 't1', name: 'Lisbon', start: '2026-11-10', end: '2026-11-12', entries: [{ id: 'e1', kind: 'item', refId: '${by['Blue jeans']}', packed: false }], archived: false, createdAt: Date.now() });`);
    await page.getByRole('link', { name: /Lisbon/ }).click();
    await failWrites(page, 'trips', 'put');
    await page.getByRole('button', { name: 'Blue jeans, not packed' }).click();
    await expect(page.getByText(SAVE_FAILED)).toBeVisible();
    await page.getByRole('button', { name: 'Trip options' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Archive trip' }).click();
    await expect(page.getByText(SAVE_FAILED)).toBeVisible();
    await failWrites(page, 'trips', 'delete');
    await page.getByRole('button', { name: 'Trip options' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Delete trip' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Delete', exact: true }).click();
    await expect(page.getByText(SAVE_FAILED)).toBeVisible();
    expect(await withDb(page, 'return db.trips.count()')).toBe(1);
  });

  test('#3 deleting the original body photo reports a failure', async ({ page }) => {
    await openApp(page, { route: '/settings' });
    await withDb(page, `const b = () => new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' });
      await db.body.put({ id: 'current', photo: b(), cutout: b(), mask: b(), landmarks: [], canonical: { width: 10, height: 20 }, createdAt: 1 });`);
    await failWrites(page, 'body', 'put');
    await page.getByRole('button', { name: 'Delete original photo' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Delete', exact: true }).click();
    await expect(page.getByText(SAVE_FAILED)).toBeVisible();
  });
});
