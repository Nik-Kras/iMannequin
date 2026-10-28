// App shell, navigation, sheets, toasts, onboarding and the paper UI kit (docs/bug-audit.md). WebKit, iPhone 15 Pro.
import type { BrowserContext, Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { failWrites, fakeDevice, openApp, withDb } from './helpers';

const LOST = 'Connection to Indexed Database server lost. Refresh the page to try again';
const SAVE_FAILED = 'Couldn’t save. Try again.';

/** Loads the app as a new document (history.state starts empty), after `before` in the same tab. */
async function freshLoad(page: Page, route: string, before = 'about:blank') {
  // Leaving while the service worker registers makes WebKit log an access-control error.
  await page.evaluate(() => Promise.race([navigator.serviceWorker?.ready, new Promise((r) => setTimeout(r, 3000))]));
  await page.goto(before);
  await page.goto(`./?e2e#${route}`);
  await page.waitForFunction(() => (window as unknown as { __imq?: unknown }).__imq);
}

/** Makes reads of the settings store (live queries: read-only transactions) fail like iOS after it dropped the connection. */
async function breakSettingsReads(page: Page, times: number) {
  await page.evaluate(({ times, msg }) => {
    const w = window as unknown as { __fails: number };
    w.__fails = times;
    const real = IDBObjectStore.prototype.get;
    IDBObjectStore.prototype.get = function (this: IDBObjectStore, ...a: [IDBValidKey | IDBKeyRange]) {
      if (this.name === 'settings' && this.transaction.mode === 'readonly' && w.__fails > 0) {
        w.__fails--;
        throw new DOMException(msg, 'UnknownError');
      }
      return real.apply(this, a);
    };
  }, { times, msg: LOST });
}

const trip = (id = 't1', name = 'Lisbon') =>
  `await db.trips.put({ id: '${id}', name: '${name}', start: '2026-11-10', end: '2026-11-12', entries: [], archived: false, createdAt: Date.now() });`;

/** A visualViewport we can shrink like the iOS keyboard does (headless WebKit has no keyboard). */
async function fakeKeyboard(context: BrowserContext) {
  await context.addInitScript(() => {
    const vv = new EventTarget() as EventTarget & Record<string, number>;
    let h: number | null = null;
    Object.defineProperties(vv, {
      height: { get: () => h ?? innerHeight }, width: { get: () => innerWidth },
      offsetTop: { get: () => 0 }, offsetLeft: { get: () => 0 }, pageTop: { get: () => scrollY }, pageLeft: { get: () => 0 }, scale: { get: () => 1 },
    });
    Object.defineProperty(window, 'visualViewport', { get: () => vv, configurable: true });
    (window as unknown as { __kbd: (px: number) => void }).__kbd = (px) => { h = px ? innerHeight - px : null; vv.dispatchEvent(new Event('resize')); };
  });
}

test.describe('#4 never a blank page', () => {
  test('#4 a settings read error shows the Oops screen instead of a blank page', async ({ page }) => {
    await openApp(page, { route: '/settings' });
    await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();
    await breakSettingsReads(page, 1e9);
    await withDb(page, `await db.settings.toCollection().modify((s) => { s.notWornMonths = 9; });`);
    await expect(page.getByRole('heading', { name: 'Oops · Ой' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Restart · Перезапустити' })).toBeVisible();
  });

  test('#4 a lost connection while reading settings is reopened once and the screen recovers', async ({ page }) => {
    await openApp(page, { route: '/settings' });
    await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();
    await breakSettingsReads(page, 1);
    await withDb(page, `await db.settings.toCollection().modify((s) => { s.notWornMonths = 9; });`);
    await page.waitForTimeout(1500);
    await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();
    await expect(page.getByText('9 months')).toBeVisible();
  });

  test('#4 a start that fails shows the bilingual error screen', async ({ context, page }) => {
    await context.addInitScript((msg) => {
      IDBFactory.prototype.open = function () { throw new DOMException(msg, 'UnknownError'); };
    }, LOST);
    await page.goto('./');
    await expect(page.getByRole('heading', { name: 'Oops · Ой' })).toBeVisible({ timeout: 20_000 });
    await expect(page.getByRole('button', { name: 'Restart · Перезапустити' })).toBeVisible();
  });

  test('#4 a start that hangs shows the error screen after a timeout', async ({ context, page }) => {
    test.setTimeout(60_000);
    await context.addInitScript(() => {
      // A request that never answers, like a stuck IndexedDB on iOS.
      IDBFactory.prototype.open = function () { return new EventTarget() as unknown as IDBOpenDBRequest; };
    });
    await page.goto('./');
    await expect(page.getByRole('heading', { name: 'Oops · Ой' })).toBeVisible({ timeout: 30_000 });
  });

  test('#4 unhandled promise rejections are written to the black box', async ({ page }) => {
    await openApp(page, { route: '/dressup' });
    await page.evaluate(() => window.dispatchEvent(new PromiseRejectionEvent('unhandledrejection', { promise: Promise.resolve(), reason: new Error('marker-4711') })));
    expect(await page.evaluate(() => localStorage.getItem('imq-bb-log'))).toContain('marker-4711');
  });
});

test.describe('#24 Back', () => {
  test('#24 Back on the first screen of a browser tab stays in the app', async ({ page }) => {
    await openApp(page);
    await freshLoad(page, '/settings');
    await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();
    await page.getByRole('button', { name: 'Dress-up' }).click();
    await expect(page).toHaveURL(/\?e2e#\/dressup$/);
    await expect(page.getByRole('heading', { name: 'Dress-up' })).toBeVisible();
  });

  test('#24 Back on the first screen with screens ahead of it still goes somewhere', async ({ context, page }) => {
    await openApp(page);
    const tab = await context.newPage();
    await tab.goto('./?e2e#/settings');
    await expect(tab.getByRole('heading', { name: 'Settings' })).toBeVisible();
    await tab.getByRole('button', { name: /^Places/ }).click();
    await expect(tab).toHaveURL(/#\/places$/);
    await tab.evaluate(() => history.back());
    await expect(tab).toHaveURL(/#\/settings$/);
    await tab.getByRole('button', { name: 'Dress-up' }).click();
    await expect(tab).toHaveURL(/#\/dressup$/);
  });

  test('#24 the back gesture closes an open sheet instead of leaving the screen', async ({ page }) => {
    await openApp(page, { route: '/trips' });
    await withDb(page, trip());
    await page.getByRole('link', { name: /Lisbon/ }).click();
    await expect(page).toHaveURL(/#\/trip\/t1$/);
    await page.getByRole('button', { name: 'Trip options' }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.evaluate(() => history.back());
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await page.waitForTimeout(300);
    await expect(page).toHaveURL(/#\/trip\/t1$/);
    // Closed by its own button, the sheet leaves nothing behind: one Back returns to the list.
    await page.getByRole('button', { name: 'Trip options' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Close' }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await page.waitForTimeout(300);
    await page.evaluate(() => history.back());
    await expect(page).toHaveURL(/#\/trips$/);
  });

  test('#24 deleting a trip from its confirm sheet lands on the list', async ({ page }) => {
    await openApp(page, { route: '/trips' });
    await withDb(page, trip());
    await page.getByRole('link', { name: /Lisbon/ }).click();
    await page.getByRole('button', { name: 'Trip options' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Delete trip' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Delete', exact: true }).click();
    await expect(page).toHaveURL(/#\/trips$/);
    await page.waitForTimeout(500);
    await expect(page).toHaveURL(/#\/trips$/);
    await expect(page.getByRole('heading', { name: 'Trips' })).toBeVisible();
  });
});

test.describe('#22 onboarding and Back', () => {
  test('#22 Back after onboarding does not return to the onboarding screens', async ({ page }) => {
    await openApp(page, { onboarded: false, route: '/welcome' });
    await page.getByRole('button', { name: /Continue/ }).click();
    await page.getByRole('button', { name: /Not now|Next: your body photo/ }).first().click();
    await page.getByRole('button', { name: 'Skip for now' }).click();
    await expect(page.getByRole('heading', { name: 'Dress-up' })).toBeVisible();
    // Back from here may leave the browser tab (there is nothing of the app behind), but never shows onboarding.
    await page.evaluate(() => history.back());
    await page.waitForTimeout(800);
    expect(page.url()).not.toMatch(/welcome|models|onboarding/);
  });

  test('#22 Welcome and the onboarding model screen send an onboarded user to Dress-up', async ({ page }) => {
    await openApp(page, { route: '/wardrobe' });
    await page.evaluate(() => { location.hash = '#/welcome'; });
    await expect(page).toHaveURL(/#\/dressup$/);
    await page.evaluate(() => { location.hash = '#/models?onboarding=1'; });
    await expect(page).toHaveURL(/#\/dressup$/);
  });
});

test.describe('#23 double taps', () => {
  test('#23 a double tap on Create trip makes one trip', async ({ page }) => {
    await openApp(page, { route: '/trips' });
    await page.getByRole('button', { name: /New trip/ }).first().click();
    await page.getByLabel('Name').fill('Porto');
    await page.evaluate(() => { const b = document.querySelector<HTMLButtonElement>('[role=dialog] button[type=submit]')!; b.click(); b.click(); });
    await expect(page).toHaveURL(/#\/trip\//);
    await page.waitForTimeout(500);
    expect(await withDb(page, 'return db.trips.count()')).toBe(1);
  });

  test('#23 a double tap on the Settings icon or the centre + opens the screen once', async ({ context, page }) => {
    await fakeDevice(context);
    await openApp(page, { route: '/dressup' });
    await page.getByRole('button', { name: 'Settings' }).dblclick();
    await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();
    await page.getByRole('button', { name: 'Dress-up' }).click();
    await expect(page).toHaveURL(/#\/dressup$/);
    await page.getByRole('navigation').getByRole('link', { name: 'Add clothes' }).dblclick();
    await expect(page).toHaveURL(/#\/add$/);
    // The first visit shows the photo tips in a sheet; Back would close that first.
    await page.waitForTimeout(600);
    if (await page.getByRole('dialog').isVisible()) {
      await page.getByRole('dialog').getByRole('button', { name: 'Close' }).click();
      await page.waitForTimeout(300);
    }
    await page.evaluate(() => history.back());
    await expect(page).toHaveURL(/#\/dressup$/);
  });
});

test.describe('#3 shell taps that write report failures', () => {
  test('#3 a Settings switch that can’t save says so', async ({ page }) => {
    await openApp(page, { route: '/settings' });
    await failWrites(page, 'settings', 'put');
    await page.getByRole('button', { name: 'Outline' }).click();
    await expect(page.getByText(SAVE_FAILED)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Try again' })).toBeVisible();
  });

  test('#3 the crash-report switch and the months choice report failures', async ({ page }) => {
    await openApp(page, { route: '/settings' });
    await failWrites(page, 'settings', 'put');
    await page.getByRole('switch', { name: 'Crash reports' }).click();
    await expect(page.getByText(SAVE_FAILED)).toBeVisible();
    await page.getByRole('button', { name: /Not worn after/ }).click();
    await page.getByRole('dialog').getByRole('button', { name: '3 months' }).click();
    await expect(page.getByText(SAVE_FAILED)).toBeVisible();
  });

  test('#3 the install guide’s button reports a failed save', async ({ page }) => {
    await page.goto('./?e2e');
    await expect(page.getByRole('button', { name: 'Keep using it in the browser' })).toBeVisible();
    await failWrites(page, 'settings', 'put');
    await page.getByRole('button', { name: 'Keep using it in the browser' }).click();
    await expect(page.getByText(SAVE_FAILED)).toBeVisible();
  });

  test('#3 Welcome’s language switch reports a failed save', async ({ page }) => {
    await openApp(page, { onboarded: false, route: '/welcome' });
    await failWrites(page, 'settings', 'put');
    await page.getByRole('button', { name: 'Українська' }).click();
    await expect(page.getByText(SAVE_FAILED)).toBeVisible();
  });

  test('#3 the backup reminder’s dismiss reports a failed save', async ({ page }) => {
    await openApp(page, { seed: true, route: '/wardrobe' });
    await failWrites(page, 'settings', 'put');
    await page.getByRole('button', { name: 'Remind me in a month' }).click();
    await expect(page.getByText(SAVE_FAILED)).toBeVisible();
  });
});

test.describe('#26 #31 install guide', () => {
  test('#26 Welcome opens at the top after the install guide', async ({ page }) => {
    await page.goto('./');
    await page.getByRole('button', { name: 'Keep using it in the browser' }).scrollIntoViewIfNeeded();
    expect(await page.evaluate(() => scrollY)).toBeGreaterThan(0);
    await page.getByRole('button', { name: 'Keep using it in the browser' }).click();
    await expect(page.getByRole('button', { name: /Continue/ })).toBeAttached();
    await page.waitForTimeout(300);
    expect(await page.evaluate(() => scrollY)).toBe(0);
  });

  test('#31 the install guide and Settings say a browser tab keeps its own data', async ({ page }) => {
    await page.goto('./?e2e');
    await expect(page.getByText(/home-screen app keep separate wardrobes/)).toBeVisible();
    await page.getByRole('button', { name: 'Keep using it in the browser' }).click();
    await withDb(page, `const s = await db.settings.get('app'); await db.settings.put({ ...s, onboarded: true, modelsReady: true });`);
    await page.goto('./?e2e#/settings');
    await expect(page.getByText(/This is a browser tab/)).toBeVisible();
  });
});

test.describe('#32 keyboard', () => {
  test('#32 a sheet with a text field rises above the keyboard', async ({ context, page }) => {
    await fakeKeyboard(context);
    await openApp(page, { route: '/trips' });
    await page.getByRole('button', { name: /New trip/ }).first().click();
    await page.getByLabel('Name').focus();
    await page.evaluate(() => (window as unknown as { __kbd: (px: number) => void }).__kbd(336));
    const vh = await page.evaluate(() => innerHeight);
    await expect.poll(async () => {
      const b = await page.getByRole('button', { name: 'Create trip' }).boundingBox();
      return b!.y + b!.height;
    }).toBeLessThanOrEqual(vh - 336);
    await page.evaluate(() => (window as unknown as { __kbd: (px: number) => void }).__kbd(0));
    await expect.poll(async () => page.locator('.sheet').evaluate((s) => getComputedStyle(s).bottom)).toBe('0px');
  });

  test('#32 Return in the trip name moves to the dates instead of creating the trip', async ({ page }) => {
    await openApp(page, { route: '/trips' });
    await page.getByRole('button', { name: /New trip/ }).first().click();
    await expect(page.getByLabel('Name')).toHaveAttribute('enterkeyhint', 'next');
    await page.getByLabel('Name').fill('Rome');
    await page.getByLabel('Name').press('Enter');
    await expect(page.getByLabel('From')).toBeFocused();
    await expect(page.getByRole('dialog')).toBeVisible();
    expect(await withDb(page, 'return db.trips.count()')).toBe(0);
  });
});

test.describe('#43 #44 VoiceOver', () => {
  test('#43 a new screen gets the focus on its heading and names the page', async ({ page }) => {
    await openApp(page, { route: '/dressup' });
    await page.getByRole('button', { name: 'Settings' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Settings' })).toBeFocused();
    await expect(page).toHaveTitle('Settings · iMannequin');
  });

  test('#43 a sheet takes the focus, hides the screen behind it, and gives the focus back', async ({ page }) => {
    await openApp(page, { route: '/trips' });
    await withDb(page, trip());
    const opener = page.getByRole('button', { name: /New trip/ }).first();
    await opener.focus();
    await opener.click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    expect(await dialog.evaluate((d) => d.contains(document.activeElement))).toBe(true);
    expect(await page.locator('.tabbar').evaluate((e) => !!e.closest('[inert]'))).toBe(true);
    expect(await page.getByRole('link', { name: /Lisbon/ }).evaluate((e) => !!e.closest('[inert]'))).toBe(true);
    await dialog.getByRole('button', { name: 'Close' }).click();
    await expect(dialog).toHaveCount(0);
    await expect(opener).toBeFocused();
    expect(await page.locator('[inert]:not(.sheet--closing, .scrim--closing)').count()).toBe(0);
  });

  test('#43 a sheet without a text field moves the focus to its title', async ({ page }) => {
    await openApp(page, { route: '/trips' });
    await withDb(page, trip());
    await page.getByRole('link', { name: /Lisbon/ }).click();
    await page.getByRole('button', { name: 'Trip options' }).click();
    await expect(page.getByRole('dialog').getByRole('heading', { name: 'Lisbon' })).toBeFocused();
  });

  test('#44 toasts are read out through a live region that is already in the page', async ({ page }) => {
    await openApp(page, { route: '/settings' });
    await page.evaluate(() => document.querySelectorAll('[aria-live], [role=status], [role=alert]').forEach((e) => e.setAttribute('data-was-there', '')));
    await failWrites(page, 'settings', 'put');
    await page.getByRole('button', { name: 'Outline' }).click();
    await expect(page.locator('[data-was-there]').filter({ hasText: SAVE_FAILED })).toHaveCount(1);
  });
});

test.describe('#39 #41 #42 #45 #47 #48 paper kit', () => {
  for (const width of [320, 262]) {
    test(`#39 no sideways overflow at ${width} px (Ukrainian)`, async ({ page }) => {
      await page.setViewportSize({ width, height: 640 });
      await openApp(page, { seed: true, lang: 'uk', route: '/outfits' });
      await withDb(page, `const s = await db.settings.get('app'); await db.settings.put({ ...s, backupReminderAt: Date.now() });`);
      for (const route of ['/outfits', '/wear-log', '/trips', '/settings']) {
        await page.evaluate((r) => { location.hash = r; }, route);
        await page.waitForTimeout(700);
        const over = await page.evaluate(() => {
          const vw = document.documentElement.clientWidth;
          const out: string[] = [];
          for (const el of document.querySelectorAll<HTMLElement>('main *, .tabbar *')) {
            const r = el.getBoundingClientRect();
            if (!r.width || (r.right <= vw + 1 && r.left >= -1)) continue;
            let scroller = false;
            for (let e: HTMLElement | null = el; e; e = e.parentElement) {
              const ox = getComputedStyle(e).overflowX;
              if (ox === 'auto' || ox === 'scroll' || (ox === 'hidden' && e !== el)) { scroller = true; break; }
            }
            if (!scroller) out.push(`${el.tagName.toLowerCase()}.${el.className} "${(el.textContent ?? '').trim().slice(0, 20)}" ${Math.round(r.left)}..${Math.round(r.right)}`);
          }
          return { doc: document.documentElement.scrollWidth - vw, out: out.slice(0, 6) };
        });
        expect(over, route).toEqual({ doc: 0, out: [] });
      }
    });
  }

  test('#41 Reduce Motion: nothing loops fast, the spinner pulses slowly, the scan line stops', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await openApp(page, { onboarded: false, route: '/body?onboarding=1' });
    const s = await page.evaluate(() => {
      const probe = (cls: string) => {
        const e = document.createElement('div');
        e.className = cls;
        document.body.appendChild(e);
        const cs = getComputedStyle(e);
        return { name: cs.animationName, count: cs.animationIterationCount, dur: parseFloat(cs.animationDuration) };
      };
      return { scan: probe('bp__scan'), spinner: probe('spinner') };
    });
    expect(s.scan.name).toBe('none');
    expect(s.spinner.name).not.toBe('spin');
    expect(s.spinner.dur).toBeGreaterThanOrEqual(1);
  });

  test('#42 segmented controls, the language switch and the backup action are 44 px to the finger', async ({ page }) => {
    const reach = (sel: string) => page.evaluate((sel) => {
      const el = document.querySelector<HTMLElement>(sel)!;
      const r = el.getBoundingClientRect();
      const x = r.left + r.width / 2;
      const top = document.elementFromPoint(x, r.top + r.height / 2 - 21.5);
      const bottom = document.elementFromPoint(x, r.top + r.height / 2 + 21.5);
      return !!top && !!bottom && el.contains(top) && el.contains(bottom);
    }, sel);
    await openApp(page, { seed: true, route: '/outfits' });
    await expect(page.getByRole('heading', { name: 'Outfits' })).toBeVisible();
    expect(await reach('.seg button[aria-pressed=false]')).toBe(true);
    const go = page.getByRole('button', { name: 'Back up' });
    expect((await go.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await page.evaluate(() => { location.hash = '#/settings'; });
    await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();
    expect(await reach('.set-seg .seg button[aria-pressed=false]')).toBe(true);
  });

  test('#45 unselected control borders and the progress track use the 3:1 line colour', async ({ page }) => {
    await openApp(page, { route: '/settings' });
    const line = 'rgb(137, 132, 122)';
    await expect(page.locator('.set-mode[aria-pressed=false]')).toHaveCSS('border-top-color', line);
    expect(await page.evaluate(() => {
      const bar = document.createElement('div');
      bar.className = 'bar';
      document.body.appendChild(bar);
      return getComputedStyle(bar).boxShadow;
    })).toContain('137, 132, 122');
  });

  test('#47 a disabled button is pencil with graphite text, not 40 % opacity', async ({ page }) => {
    await openApp(page, { route: '/trips' });
    await page.getByRole('button', { name: /New trip/ }).first().click();
    const create = page.getByRole('button', { name: 'Create trip' });
    await expect(create).toBeDisabled();
    await expect(create).toHaveCSS('opacity', '1');
    await expect(create).toHaveCSS('background-color', 'rgb(207, 202, 193)');
    await expect(create).toHaveCSS('color', 'rgb(85, 82, 76)');
  });

  test('#48 a sheet slides out instead of vanishing, and rows and chips have a pressed state', async ({ page }) => {
    await openApp(page, { route: '/trips' });
    await page.getByRole('button', { name: /New trip/ }).first().click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.getByRole('dialog').getByRole('button', { name: 'Close' }).click();
    await expect(page.locator('.sheet--closing')).toHaveCount(1);
    await expect(page.locator('.sheet--closing')).toHaveCount(0);
    const selectors = await page.evaluate(() => [...document.styleSheets].flatMap((s) => {
      try { return [...s.cssRules].map((r) => (r as CSSStyleRule).selectorText ?? ''); } catch { return []; }
    }).join('\n'));
    for (const c of ['.chip', '.list-row', '.trip-piece', '.picker__cell']) expect(selectors).toContain(`${c}:active`);
  });

  test('#37 the Settings icon is a cog (one outline around a hole), not a sun with rays', async ({ page }) => {
    await openApp(page, { route: '/dressup' });
    const d = await page.getByRole('button', { name: 'Settings' }).locator('path').first().getAttribute('d');
    expect(d!.match(/M/g)!.length).toBe(2);
  });
});
