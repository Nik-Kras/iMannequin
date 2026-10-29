// Dress-up, See all and Adjust fit items of docs/bug-audit.md. WebKit, iPhone 15 Pro (and smaller viewports), sample wardrobe (R2).
import { devices, type Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { failWrites, openApp, withDb } from './helpers';

type Box = { x: number; y: number; width: number; height: number };
const box = async (page: Page, sel: string): Promise<Box> => (await page.locator(sel).first().boundingBox())!;
const overlaps = (a: Box, b: Box) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

/** Puts sample clothes on the mannequin: three top layers, bottoms and shoes. */
async function dress(page: Page) {
  await withDb(page, `const items = await db.items.toArray(); const by = (n) => items.find((i) => i.name === n).id;
    const s = await db.settings.get('app');
    await db.settings.put({ ...s, draft: { slots: { base: by('Cream T-shirt'), mid: by('Navy sweater'), outer: by('Denim jacket'), legs: by('Blue jeans'), feet: by('White sneakers') }, accessories: [], toggles: { tuckIn: false, intoBoots: false } } });`);
}
/** In-app navigation (a page.goto here reloads, and WebKit reports the images it was loading as page errors). */
const go = (page: Page, hash: string) => page.evaluate((h) => { location.hash = h; }, hash);
const itemId = (page: Page, name: string) => withDb<string>(page, `return (await db.items.toArray()).find((i) => i.name === '${name}').id;`);

test.describe('#27 Dress-up layout on small screens', () => {
  for (const dev of ['iPhone SE', 'iPhone SE (3rd gen)', 'iPhone 15 Pro']) {
    test(`#27 ${dev}: slots clear of the header, the row never over the feet, nothing clipped`, async ({ page }) => {
      await page.setViewportSize(devices[dev].viewport);
      await openApp(page, { seed: true, lang: 'uk' });
      await dress(page);
      await expect(page.locator('.du-slot').first()).toBeVisible();
      await page.waitForTimeout(400);
      const vw = page.viewportSize()!.width;
      const check = async (state: string) => {
        const header = await box(page, '.du__header');
        const gear = await box(page, '.du__header .icon-btn');
        const panel = await box(page, '.du__sheet, .du__row');
        for (const s of await page.locator('.du-slot').all()) {
          const b = (await s.boundingBox())!;
          expect(b.y, `${state}: slot below the header`).toBeGreaterThanOrEqual(header.y + header.height);
          expect(b.y + b.height, `${state}: slot above the panel’s torn edge`).toBeLessThanOrEqual(panel.y - 6);
          expect(overlaps(b, gear), `${state}: slot under the Settings button`).toBe(false);
          expect(b.x + b.width, `${state}: slot inside the screen`).toBeLessThanOrEqual(vw);
        }
        expect(await page.evaluate(() => document.documentElement.scrollWidth), `${state}: no sideways scroll`).toBeLessThanOrEqual(vw);
      };
      await check('closed');
      // Save and Wearing today keep their text inside the button.
      for (const sel of ['.du__save', '.du__wear']) {
        expect(await page.locator(sel).evaluate((el) => el.scrollWidth <= el.clientWidth + 1), `${sel} text fits`).toBe(true);
      }
      // The Shoes row: the Shoes slot and the feet stay above it (D31).
      await page.getByRole('button', { name: /^Взуття/ }).click();
      await expect(page.locator('.du__row')).toBeVisible();
      await expect(() => check('feet row')).toPass({ timeout: 5000 });
      const row = await box(page, '.du__row');
      const shoes = (await page.getByRole('button', { name: /^Взуття/ }).boundingBox())!;
      expect(shoes.y + shoes.height, 'Shoes slot above the row').toBeLessThanOrEqual(row.y);
      const man = await box(page, '.du__mannequin .mannequin');
      expect(man.y + man.height, 'mannequin’s feet above the row').toBeLessThanOrEqual(row.y);
      // The Top row with the base layer: the layer switch and Tuck in fit on the screen.
      await page.getByRole('button', { name: /^Верх, шарів/ }).click();
      await page.locator('.du__row .seg button').first().click();
      const toggle = (await page.getByRole('switch').boundingBox())!;
      expect(toggle.x + toggle.width, 'Tuck in inside the screen').toBeLessThanOrEqual(vw);
      // Measured once the row has finished sliding up and the column has moved to make room.
      await expect(() => check('top row')).toPass({ timeout: 5000 });
    });
  }
});

test('#27 Adjust fit on an iPhone SE: the hem handles stay above the panel', async ({ page }) => {
  await page.setViewportSize(devices['iPhone SE'].viewport);
  await openApp(page, { seed: true, lang: 'uk' });
  await dress(page);
  await go(page, `#/fit/${await itemId(page, 'Blue jeans')}`);
  await expect(page.locator('.af-handle').first()).toBeAttached();
  const panel = await box(page, '.af__panel');
  for (const h of await page.locator('.af-handle circle:nth-child(2)').all()) {
    const b = (await h.boundingBox())!;
    expect(b.y + b.height, 'handle above the panel').toBeLessThanOrEqual(panel.y);
  }
});

test.describe('#23 quick taps on Dress-up', () => {
  test.beforeEach(async ({ page }) => { await openApp(page, { seed: true }); });

  test('#23 two accessory taps at once put both on', async ({ page }) => {
    await withDb(page, `const its = (await db.items.toArray()).filter((i) => i.category !== 'bag').slice(0, 2);
      await db.items.update(its[0].id, { category: 'bag' }); await db.items.update(its[1].id, { category: 'belt' });`);
    await page.getByRole('button', { name: /Extras/ }).click();
    const cards = page.locator('.du-card:not(.du-card--none)');
    await expect(cards).toHaveCount(3);
    await page.evaluate(() => {
      const c = [...document.querySelectorAll<HTMLElement>('.du-card:not(.du-card--none)')];
      c[0].click(); c[1].click();
    });
    await expect.poll(() => withDb(page, `return (await db.settings.get('app')).draft.accessories.length;`)).toBe(2);
  });

  test('#23 a double tap on Wearing today logs the outfit once', async ({ page }) => {
    await dress(page);
    await page.locator('.du__wear').evaluate((el: HTMLElement) => { el.click(); setTimeout(() => el.click(), 60); });
    await page.waitForTimeout(800);
    expect(await withDb(page, `return await db.wear.count();`)).toBe(1);
  });

  test('#23 a double tap on Save in the name sheet saves one outfit', async ({ page }) => {
    await dress(page);
    await page.getByRole('button', { name: 'Save outfit' }).click();
    await page.getByRole('dialog').locator('button[type=submit]').evaluate((el: HTMLElement) => { el.click(); el.click(); el.click(); });
    await page.waitForTimeout(800);
    expect(await withDb(page, `return await db.outfits.count();`)).toBe(1);
  });
});

test.describe('#3 failed writes on Dress-up, See all and Adjust fit are reported', () => {
  test.beforeEach(async ({ page }) => { await openApp(page, { seed: true }); await dress(page); });
  const failed = (page: Page) => page.locator('.toast', { hasText: /Couldn’t save|didn’t work/ });

  test('#3 Save outfit', async ({ page }) => {
    await failWrites(page, 'outfits', 'add');
    await page.getByRole('button', { name: 'Save outfit' }).click();
    await page.getByRole('dialog').locator('button[type=submit]').click();
    await expect(failed(page)).toBeVisible();
  });

  test('#3 Wearing today', async ({ page }) => {
    await failWrites(page, 'wear', 'add');
    await page.getByRole('button', { name: 'Wearing today' }).click();
    await expect(failed(page)).toBeVisible();
  });

  test('#3 putting a garment on', async ({ page }) => {
    await page.getByRole('button', { name: /^Bottoms/ }).click();
    await failWrites(page, 'settings', 'put');
    await page.getByRole('button', { name: /Black jeans/ }).click();
    await expect(failed(page)).toBeVisible();
  });

  test('#3 Adjust fit Done', async ({ page }) => {
    const id = await itemId(page, 'Blue jeans');
    await go(page, `#/fit/${id}`);
    await page.getByRole('button', { name: 'Move up' }).click();
    await failWrites(page, 'items', 'update');
    await page.getByRole('button', { name: 'Done' }).click();
    await expect(failed(page)).toBeVisible();
  });

  test('#3 See all Put it on', async ({ page }) => {
    await go(page, '#/see-all/legs');
    await page.getByRole('button', { name: /Black jeans/ }).click();
    await failWrites(page, 'settings', 'put');
    await page.getByRole('button', { name: 'Put it on' }).click();
    await expect(failed(page)).toBeVisible();
  });
});

test.describe('#21 destructive taps', () => {
  test('#21 tapping "Worn today" offers Undo', async ({ page }) => {
    await openApp(page, { seed: true });
    await dress(page);
    await page.getByRole('button', { name: 'Wearing today' }).click();
    await expect(page.getByRole('button', { name: 'Worn today' })).toBeVisible();
    await page.waitForTimeout(500); // a second, deliberate tap (a double tap is ignored)
    await page.getByRole('button', { name: 'Worn today' }).click();
    await expect.poll(() => withDb(page, `return await db.wear.count();`)).toBe(0);
    await page.locator('.toast').getByRole('button', { name: 'Undo' }).click();
    await expect.poll(() => withDb(page, `return await db.wear.count();`)).toBe(1);
  });

  test('#21 leaving Adjust fit keeps the drags its note says are saved', async ({ page }) => {
    await openApp(page, { seed: true });
    await dress(page);
    const id = await itemId(page, 'Blue jeans');
    await go(page, `#/fit/${id}`);
    await page.getByRole('button', { name: 'Move up' }).click();
    await page.getByRole('button', { name: 'Move up' }).click();
    await page.getByRole('button', { name: 'Dress-up' }).click();
    await expect(page.getByRole('heading', { name: 'Dress-up' })).toBeVisible();
    await expect.poll(() => withDb(page, `return !!(await db.items.get('${id}')).fit;`)).toBe(true);
  });
});

test('#25 Adjust fit for a garment that isn’t there says so, with a way back', async ({ page }) => {
  await openApp(page, { seed: true, route: '/fit/no-such-item' });
  await expect(page.getByText(/isn’t in your wardrobe/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Done' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Dress-up' }).first().click();
  await expect(page.getByRole('heading', { name: 'Dress-up' })).toBeVisible();
});

test.describe('#11 thumbnails on Dress-up', () => {
  test.beforeEach(async ({ page }) => { await openApp(page, { seed: true }); });

  test('#11 the clothes row shows the small thumbnails, not the cut-outs', async ({ page }) => {
    await withDb(page, `const c = document.createElement('canvas'); c.width = 40; c.height = 40; c.getContext('2d').fillRect(0, 0, 40, 40);
      const b = await new Promise((r) => c.toBlob(r, 'image/png')); const buf = await b.arrayBuffer();
      for (const p of await db.photos.toArray()) await db.photos.put({ ...p, original: new Blob([await p.original.arrayBuffer()], { type: p.original.type }), cutout: new Blob([await p.cutout.arrayBuffer()], { type: 'image/png' }), thumb: new Blob([buf], { type: 'image/png' }) });`);
    await page.getByRole('button', { name: /^Bottoms/ }).click();
    const imgs = page.locator('.du-card__img img');
    await expect(imgs.first()).toBeVisible();
    await expect.poll(() => imgs.evaluateAll((els) => els.map((e) => (e as HTMLImageElement).naturalWidth))).toEqual(expect.arrayContaining([40]));
    expect(Math.max(...await imgs.evaluateAll((els) => els.map((e) => (e as HTMLImageElement).naturalWidth)))).toBeLessThanOrEqual(40);
  });

  test('#11 putting a garment on doesn’t copy every thumbnail again', async ({ page }) => {
    await page.getByRole('button', { name: /^Top/ }).click();
    await expect(page.locator('.du-card img').first()).toBeVisible();
    await page.waitForTimeout(500);
    await page.evaluate(() => {
      const w = window as unknown as { __copies: number };
      w.__copies = 0;
      const ab = Blob.prototype.arrayBuffer;
      Blob.prototype.arrayBuffer = function (this: Blob) { w.__copies++; return ab.call(this); } as typeof ab;
    });
    await page.locator('.du-card:not(.du-card--none)').nth(1).click();
    await page.waitForTimeout(1000);
    // At most the new slot thumbnail; the old code copied every card in the row and every slot again.
    expect(await page.evaluate(() => (window as unknown as { __copies: number }).__copies)).toBeLessThanOrEqual(2);
  });
});

test.describe('#28 small defects', () => {
  test('#28 the Extras label stands on a paper slip over the legs', async ({ page }) => {
    await openApp(page, { seed: true });
    const look = await page.getByRole('button', { name: /Extras/ }).evaluate((btn) => {
      const el = [...btn.querySelectorAll<HTMLElement>('*')].find((e) => e.textContent?.trim() === 'Extras' && !e.children.length) ?? btn;
      const s = getComputedStyle(el);
      return { bg: s.backgroundColor, shadow: s.textShadow };
    });
    expect(look.bg !== 'rgba(0, 0, 0, 0)' || look.shadow !== 'none').toBe(true);
  });

  test('#28 the mannequin’s zones are out of VoiceOver’s way but still answer a tap', async ({ page }) => {
    await openApp(page, { seed: true });
    await expect(page.locator('.mannequin__zone').first()).toBeAttached();
    await expect(page.getByRole('button', { name: 'Choose a hat' })).toHaveCount(0);
    await page.locator('.mannequin__zone').first().click({ force: true });
    await expect(page.getByRole('heading', { level: 2, name: 'Hat' })).toBeVisible();
  });

  test('#28 Adjust fit’s back link lines up with the title', async ({ page }) => {
    await openApp(page, { seed: true });
    await go(page, `#/fit/${await itemId(page, 'Blue jeans')}`);
    const back = (await page.getByRole('button', { name: 'Dress-up' }).boundingBox())!;
    const title = (await page.getByRole('heading', { level: 1 }).boundingBox())!;
    expect(Math.abs(back.x - title.x)).toBeLessThanOrEqual(2);
  });

  test('#28 See all shows garments with no season set', async ({ page }) => {
    await openApp(page, { seed: true });
    await withDb(page, `const it = (await db.items.toArray()).find((i) => i.name === 'Black jeans'); await db.items.update(it.id, { seasons: [], name: 'Seasonless jeans' });`);
    await go(page, '#/see-all/legs');
    await expect(page.getByRole('button', { name: /Seasonless jeans/ })).toBeVisible();
  });

  test('#28 See all’s pen circle leaves the place name readable', async ({ page }) => {
    await openApp(page, { seed: true });
    await dress(page);
    await go(page, '#/see-all/outer');
    const card = page.locator('.sa-card', { hasText: 'Denim jacket' });
    const circle = (await card.locator('svg[aria-hidden=true]').last().boundingBox())!;
    const place = (await card.locator('.sa-card__place').boundingBox())!;
    expect(overlaps(circle, place)).toBe(false);
  });
});

test.describe('#40 names on Dress-up', () => {
  test('#40 clothes-row cards show whole lines of the name (up to three), none cut in half', async ({ page }) => {
    await openApp(page, { seed: true, lang: 'uk' });
    await withDb(page, `const items = await db.items.toArray(); const by = (n) => items.find((i) => i.name === n).id;
      await db.items.update(by('White sneakers'), { name: 'Білі шкіряні кросівки Veja' }); await db.items.update(by('Black boots'), { name: 'Чорні черевики на грубій підошві' });`);
    await page.getByRole('button', { name: /^Взуття/ }).click();
    for (const n of await page.locator('.du-card__name').all()) {
      const fits = await n.evaluate((el) => {
        const line = parseFloat(getComputedStyle(el).lineHeight);
        return el.clientHeight >= Math.min(el.scrollHeight, 3 * line) - 1;
      });
      expect(fits, await n.textContent() ?? '').toBe(true);
    }
  });

  test('#40 the suggested outfit name is short: the top piece only', async ({ page }) => {
    await openApp(page, { seed: true });
    await dress(page);
    await page.getByRole('button', { name: 'Save outfit' }).click();
    await expect(page.getByRole('dialog').getByRole('textbox')).toHaveValue('Denim jacket');
  });
});

test('#44 the toast on Dress-up doesn’t cover Save, Wearing today or Share', async ({ page }) => {
  await openApp(page, { seed: true });
  await dress(page);
  await page.getByRole('button', { name: 'Wearing today' }).click();
  const toast = page.locator('.toast').filter({ hasText: 'Logged for today' });
  await expect(toast).toBeVisible();
  await page.waitForTimeout(400); // the toast slides in
  const t = (await toast.boundingBox())!;
  for (const sel of ['.du__save', '.du__wear', '.du__actions .btn--square']) expect(overlaps(t, await box(page, sel)), sel).toBe(false);
});

test('#42 the clothes row’s links and buttons are at least 44 × 44', async ({ page }) => {
  await openApp(page, { seed: true, lang: 'uk' });
  await dress(page);
  await page.getByRole('button', { name: /^Низ/ }).click();
  for (const el of await page.locator('.du__row-actions > *').all()) {
    const b = (await el.boundingBox())!;
    expect([Math.round(b.width) >= 44, Math.round(b.height) >= 44], await el.textContent() ?? '').toEqual([true, true]);
  }
});

test('#48 slots, row cards and See all cards have a pressed state', async ({ page }) => {
  await openApp(page, { seed: true });
  const rules = await page.evaluate(() => {
    const out: string[] = [];
    for (const sheet of [...document.styleSheets]) {
      try { for (const r of [...sheet.cssRules]) if (r instanceof CSSStyleRule && r.selectorText.includes(':active')) out.push(r.selectorText); } catch { /* cross-origin */ }
    }
    return out.join(' ');
  });
  for (const cls of ['.du-slot', '.du-card', '.sa-card']) expect(rules).toContain(`${cls}:active`);
});

test('Q19 a filled slot hides its zone label so a long name gets three lines', async ({ page }) => {
  await openApp(page, { seed: true });
  const jeans = await itemId(page, 'Blue jeans');
  await dress(page);
  await withDb(page, `const i = await db.items.get('${jeans}'); await db.items.put({ ...i, name: 'Dark blue wide-leg selvedge jeans with turn-ups' });`);
  const slot = page.getByRole('button', { name: /^Bottoms.*selvedge/ });
  await expect(slot).toBeVisible();
  const view = await slot.evaluate((el) => {
    const label = el.querySelector<HTMLElement>('.du-slot__label')!;
    const name = el.querySelector<HTMLElement>('.du-slot__name')!;
    return {
      labelShown: label.getBoundingClientRect().width > 2,
      lines: Math.round(name.getBoundingClientRect().height / parseFloat(getComputedStyle(name).lineHeight)),
      inside: name.getBoundingClientRect().bottom <= el.getBoundingClientRect().bottom + 0.5,
    };
  });
  expect(view).toEqual({ labelShown: false, lines: 3, inside: true });
  // An empty slot still says what it is.
  const hat = page.getByRole('button', { name: /^Hat/ });
  expect(await hat.locator('.du-slot__label').evaluate((el) => el.getBoundingClientRect().width > 2)).toBe(true);
});
