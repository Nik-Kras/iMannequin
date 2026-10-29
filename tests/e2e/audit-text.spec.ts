// #38 of docs/bug-audit.md: text follows the phone's text size. On an iPhone the root font size is the iOS
// Text Size (font: -apple-system-body); the test browser has no such setting, so it sets the root size itself.
import { devices, type Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { openApp, withDb } from './helpers';

type Box = { x: number; y: number; width: number; height: number };
const box = async (page: Page, sel: string): Promise<Box> => (await page.locator(sel).first().boundingBox())!;
const overlaps = (a: Box, b: Box) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
const go = (page: Page, hash: string) => page.evaluate((h) => { location.hash = h; }, hash);
/** The phone's text size as a percentage of the default. */
const textSize = (page: Page, percent: number) => page.addStyleTag({ content: `html { font-size: ${16 * percent / 100}px !important; }` });
const px = (page: Page, sel: string) => page.locator(sel).first().evaluate((el) => parseFloat(getComputedStyle(el).fontSize));

/** Text that sticks out of its box. The text's own rectangle is measured: a touch-area ::after layer doesn't count. */
const outside = (sel: string) => [...document.querySelectorAll<HTMLElement>(sel)]
  .filter((el) => el.offsetParent && !el.closest('.hscroll'))
  .filter((el) => {
    const box = el.getBoundingClientRect();
    const range = document.createRange();
    range.selectNodeContents(el);
    const text = range.getBoundingClientRect();
    return text.width > 0 && (text.left < box.left - 1 || text.right > box.right + 1 || text.top < box.top - 1 || text.bottom > box.bottom + 1);
  })
  .map((el) => `${el.className.split(' ')[0]} “${(el.textContent ?? '').trim().slice(0, 24)}”`);
const clipped = (page: Page) => page.evaluate(`(${outside})('.btn, .chip, .seg button, .text-action, .back, .tab, .list-row')`) as Promise<string[]>;

test('#38 text follows the phone’s text size; titles and Dress-up grow less', async ({ page }) => {
  await openApp(page, { seed: true, route: '/settings' });
  await expect(page.getByRole('heading', { name: 'Settings', level: 1 })).toBeVisible();
  const before = { body: await px(page, '.set-text'), title: await px(page, 'h1'), btn: await px(page, '.btn') };
  await textSize(page, 150);
  expect(await px(page, '.set-text')).toBeCloseTo(before.body * 1.5, 1);
  expect(await px(page, '.btn')).toBeCloseTo(before.btn * 1.5, 1);
  expect(await px(page, 'h1')).toBeCloseTo(before.title * 1.5, 1);
  await textSize(page, 300);
  expect(await px(page, '.set-text'), 'capped at 200 %').toBeCloseTo(before.body * 2, 1);
  expect(await px(page, 'h1'), 'titles capped at 150 %').toBeCloseTo(before.title * 1.5, 1);

  await go(page, '#/dressup');
  await expect(page.locator('.du-slot').first()).toBeVisible();
  const tab = await px(page, '.tab');
  await page.addStyleTag({ content: 'html { font-size: 16px !important; }' });
  expect(tab, 'tab labels and Dress-up capped at 125 %').toBeCloseTo((await px(page, '.tab')) * 1.25, 1);
});

test('#38 at 200 % text nothing is cut off or pushed off the screen', async ({ page }) => {
  await openApp(page, { seed: true, route: '/wardrobe' });
  await withDb(page, `await db.trips.put({ id: 't1', name: 'Lisbon weekend', start: '2026-11-06', end: '2026-11-09', entries: [], archived: false, createdAt: Date.now() });`);
  await textSize(page, 200);
  const vw = page.viewportSize()!.width;
  const problems: string[] = [];
  for (const route of ['#/wardrobe', '#/outfits', '#/trips', '#/trip/t1', '#/settings', '#/places', '#/wear-log', '#/season-swap']) {
    await go(page, route);
    await page.waitForTimeout(300);
    const width = await page.evaluate(() => document.documentElement.scrollWidth);
    if (width > vw) problems.push(`${route}: scrolls sideways (${width} px)`);
    for (const c of await clipped(page)) problems.push(`${route}: ${c}`);
  }
  expect(problems).toEqual([]);
});

for (const dev of ['iPhone SE (3rd gen)', 'iPhone 15 Pro']) {
  test(`#38 ${dev} at 200 % text: Dress-up keeps every slot on screen, clear of the header and the panel`, async ({ page }) => {
    await page.setViewportSize(devices[dev].viewport);
    await openApp(page, { seed: true, lang: 'uk' });
    await textSize(page, 200);
    await expect(page.locator('.du-slot').first()).toBeVisible();
    await page.waitForTimeout(400);
    const vw = page.viewportSize()!.width;
    const header = await box(page, '.du__header');
    const gear = await box(page, '.du__header .icon-btn');
    const panel = await box(page, '.du__sheet, .du__row');
    for (const s of await page.locator('.du-slot').all()) {
      const b = (await s.boundingBox())!;
      expect(b.y, 'slot below the header').toBeGreaterThanOrEqual(header.y + header.height);
      expect(b.y + b.height, 'slot above the panel').toBeLessThanOrEqual(panel.y - 6);
      expect(overlaps(b, gear), 'slot under the Settings button').toBe(false);
      expect(b.x + b.width, 'slot inside the screen').toBeLessThanOrEqual(vw);
    }
    expect(await page.evaluate(`(${outside})('.du-slot')`), 'slot text inside the slot').toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth), 'no sideways scroll').toBeLessThanOrEqual(vw);
    for (const sel of ['.du__save', '.du__wear']) {
      expect(await page.locator(sel).evaluate((el) => el.scrollWidth <= el.clientWidth + 1), `${sel} text fits`).toBe(true);
    }
  });
}
