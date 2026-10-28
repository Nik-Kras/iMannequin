// The owner's bug and the body-photo flow (docs/bug-audit.md). WebKit, iPhone 15 Pro, synthetic figure (R2).
import { expect, test } from './fixtures';
import { bodyFile, failWrites, fakeDevice, openApp, withDb } from './helpers';

const lost = () => new DOMException('Connection to Indexed Database server lost. Refresh the page to try again', 'UnknownError');

test.describe('#0 "Use this photo"', () => {
  test.beforeEach(async ({ context, page }) => {
    await fakeDevice(context);
    await openApp(page, { onboarded: false, route: '/body?onboarding=1' });
    await page.locator('input[type=file]:not([capture])').setInputFiles(await bodyFile(page, 'good'));
    await expect(page.getByRole('button', { name: 'Use this photo' })).toBeVisible();
  });

  test('#0 saves after iOS dropped the database connection (one retry)', async ({ page }) => {
    await page.evaluate((msg) => {
      const db = (window as any).__imq.db;
      const put = db.body.put.bind(db.body);
      let failures = 1;
      db.body.put = (...a: unknown[]) => (failures-- > 0 ? Promise.reject(new DOMException(msg, 'UnknownError')) : put(...a));
    }, lost().message);
    await page.getByRole('button', { name: 'Use this photo' }).click();
    await expect(page).toHaveURL(/#\/dressup/);
    expect(await withDb(page, `return !!(await db.body.get('current'))`)).toBe(true);
  });

  test('#0 a save that keeps failing says so instead of doing nothing', async ({ page }) => {
    await page.evaluate((msg) => {
      const db = (window as any).__imq.db;
      db.body.put = () => Promise.reject(new DOMException(msg, 'UnknownError'));
    }, lost().message);
    await page.getByRole('button', { name: 'Use this photo' }).click();
    await expect(page.getByRole('alert')).toContainText('couldn’t save the photo');
    await expect(page.getByRole('button', { name: 'Use this photo' })).toBeEnabled();
    await expect(page).toHaveURL(/#\/body/);
  });
});

/** Width and height of the stored body photo, and its type. */
const storedPhoto = (page: import('@playwright/test').Page) => withDb<{ w: number; h: number; type: string }>(page,
  `const b = await db.body.get('current'); const bmp = await createImageBitmap(b.photo); return { w: bmp.width, h: bmp.height, type: b.photo.type };`);

test.describe('#9 body photo at full resolution', () => {
  test.beforeEach(async ({ context, page }) => {
    await fakeDevice(context);
    await openApp(page, { onboarded: false, route: '/body?onboarding=1' });
  });

  test('#9 a 48 MP photo is processed and stored at 2048 px', async ({ page }) => {
    await page.locator('input[type=file]:not([capture])').setInputFiles(await bodyFile(page, 'good', { W: 8000, H: 6000 }));
    await page.getByRole('button', { name: 'Use this photo' }).click({ timeout: 30_000 });
    await expect(page).toHaveURL(/#\/dressup/);
    const p = await storedPhoto(page);
    expect(Math.max(p.w, p.h)).toBeLessThanOrEqual(2048);
    expect(p.type).toBe('image/jpeg');
  });

  test('#9 the picked file is copied at once: a file that turns unreadable later still saves', async ({ page }) => {
    await page.locator('input[type=file]:not([capture])').setInputFiles(await bodyFile(page, 'good'));
    await expect(page.getByRole('button', { name: 'Use this photo' })).toBeVisible();
    // iOS can revoke access to a picked file once the picker is gone (NotReadableError).
    await page.evaluate(() => {
      const fail = () => Promise.reject(new DOMException('The I/O read operation failed.', 'NotReadableError'));
      const ab = Blob.prototype.arrayBuffer;
      Blob.prototype.arrayBuffer = function (this: Blob) { return this instanceof File ? fail() : ab.call(this); } as typeof ab;
    });
    await page.getByRole('button', { name: 'Use this photo' }).click();
    await expect(page).toHaveURL(/#\/dressup/);
    const p = await storedPhoto(page);
    expect(Math.max(p.w, p.h)).toBeLessThanOrEqual(2048);
  });
});

for (const camera of ['deny', 'none'] as const) {
  test(`#12 "Take photo" with the camera ${camera === 'deny' ? 'refused' : 'missing'} says so and still takes the photo`, async ({ context, page }) => {
    await fakeDevice(context, { camera });
    await openApp(page, { route: '/body' });
    await page.getByRole('button', { name: /Take photo/ }).click();
    await expect(page.getByText(camera === 'deny' ? /Camera access is off/ : /Camera not available/)).toBeVisible();
    // A real file input inside the label (iOS blocks click() on an input from async code), and the gallery.
    const take = page.locator('label', { hasText: 'Take photo' });
    await expect(take).toBeVisible();
    await expect(page.getByRole('button', { name: 'Choose from gallery' })).toBeVisible();
    await take.locator('input[type=file][capture]').setInputFiles(await bodyFile(page, 'good'));
    await expect(page.getByRole('button', { name: 'Use this photo' })).toBeVisible();
  });
}

test('#12 the hidden file inputs stay in the page while the camera is open', async ({ context, page }) => {
  await fakeDevice(context);
  await openApp(page, { route: '/body' });
  const before = await page.locator('input[type=file]').elementHandles();
  await page.getByRole('button', { name: /Take photo/ }).click();
  await expect(page.getByRole('dialog', { name: 'Camera' })).toBeVisible();
  expect(await Promise.all(before.map((h) => h.evaluate((el) => el.isConnected)))).not.toContain(false);
});

test.describe('#15 body camera', () => {
  test.beforeEach(async ({ context, page }) => {
    await fakeDevice(context);
    await context.addInitScript(() => {
      // Counts the countdown's ticks (Web Audio).
      const w = window as unknown as { __ticks: number; AudioContext: unknown; webkitAudioContext: unknown };
      w.__ticks = 0;
      const param = () => ({ value: 0, setValueAtTime() {}, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {} });
      class FakeAudio {
        state = 'running'; currentTime = 0; destination = {};
        resume() { return Promise.resolve(); }
        close() { return Promise.resolve(); }
        createGain() { return { gain: param(), connect(n: unknown) { return n; } }; }
        createOscillator() { return { type: 'sine', frequency: param(), connect(n: unknown) { return n; }, start() { w.__ticks++; }, stop() {} }; }
      }
      w.AudioContext = FakeAudio;
      w.webkitAudioContext = FakeAudio;
    });
    await openApp(page, { route: '/body' });
    await page.evaluate(() => Object.assign(window, { __imqCamScene: { type: 'person', variant: 'good' }, __imqPoseVariant: 'good' }));
    await page.getByRole('button', { name: /Take photo/ }).click();
    await expect(page.getByRole('button', { name: /Start 10 s timer/ })).toBeEnabled();
  });

  test('#15 Cancel and the hint sit on dark backgrounds, not straight on the video', async ({ page }) => {
    const bg = (loc: import('@playwright/test').Locator) => loc.evaluate((el) => getComputedStyle(el).backgroundColor);
    expect(await bg(page.getByRole('button', { name: 'Cancel' }))).toBe('rgba(20, 20, 20, 0.55)');
    expect(await bg(page.getByText('Step back until you fit the outline', { exact: false }))).toBe('rgba(20, 20, 20, 0.55)');
  });

  test('#15 the countdown is announced in full and ticks for the last 3 seconds', async ({ page }) => {
    await page.getByRole('button', { name: /Start 10 s timer/ }).click();
    await expect(page.getByRole('status').filter({ hasText: /Photo in \d+ seconds/ })).toBeAttached();
    await expect(page.getByRole('button', { name: 'Use this photo' })).toBeVisible({ timeout: 20_000 });
    expect(await page.evaluate(() => (window as unknown as { __ticks: number }).__ticks)).toBeGreaterThanOrEqual(3);
  });

  test('#15 leaving the app during the countdown stops it instead of shooting a black frame', async ({ page }) => {
    await page.getByRole('button', { name: /Start 10 s timer/ }).click();
    const setHidden = (hidden: boolean) => page.evaluate((hidden) => {
      Object.defineProperty(document, 'visibilityState', { value: hidden ? 'hidden' : 'visible', configurable: true });
      Object.defineProperty(document, 'hidden', { value: hidden, configurable: true });
      document.dispatchEvent(new Event('visibilitychange'));
    }, hidden);
    await setHidden(true);
    await setHidden(false);
    await expect(page.getByRole('button', { name: /Start 10 s timer/ })).toBeEnabled({ timeout: 3000 });
  });
});

test.describe('#13 a pose check the user disagrees with', () => {
  test.beforeEach(async ({ context, page }) => {
    await fakeDevice(context);
    await openApp(page, { onboarded: false, route: '/body?onboarding=1' });
  });

  test('#13 the guide’s arm angle is the one the check uses', async ({ page }) => {
    await expect(page.getByText('arms out 25–65°')).toBeVisible();
  });

  test('#13 arms too low: "Use anyway" keeps the photo', async ({ page }) => {
    await page.locator('input[type=file]:not([capture])').setInputFiles(await bodyFile(page, 'armsdown'));
    await expect(page.getByText(/too close to your body/)).toBeVisible();
    await page.getByRole('button', { name: 'Use anyway' }).click();
    await expect(page).toHaveURL(/#\/dressup/);
    expect(await withDb(page, `return !!(await db.body.get('current'))`)).toBe(true);
  });

  test('#13 no person found: no "Use anyway", and no "Check your points" title', async ({ page }) => {
    await page.locator('input[type=file]:not([capture])').setInputFiles(await bodyFile(page, 'none'));
    await expect(page.getByText(/couldn’t find a person/)).toBeVisible();
    await expect(page.getByRole('heading', { level: 1 })).not.toHaveText('Check your points');
    await expect(page.getByRole('button', { name: 'Use anyway' })).toHaveCount(0);
  });
});

test.describe('#14 a skipped body photo', () => {
  test('#14 Dress-up offers to create the mannequin, and the card can be dismissed', async ({ page }) => {
    await openApp(page, { seed: true });
    await page.getByRole('link', { name: /Create your mannequin/ }).click();
    await expect(page).toHaveURL(/#\/body/);
    await page.goBack();
    await page.getByRole('button', { name: 'Hide this' }).click();
    await expect(page.getByRole('link', { name: /Create your mannequin/ })).toHaveCount(0);
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Dress-up' })).toBeVisible();
    await expect(page.getByRole('link', { name: /Create your mannequin/ })).toHaveCount(0);
  });

  test('#14 a reload on the check screen processes the same photo again', async ({ context, page }) => {
    await fakeDevice(context);
    await openApp(page, { onboarded: false, route: '/body?onboarding=1' });
    await page.locator('input[type=file]:not([capture])').setInputFiles(await bodyFile(page, 'good'));
    await expect(page.getByRole('button', { name: 'Use this photo' })).toBeVisible();
    await page.reload();
    await expect(page.getByRole('button', { name: 'Use this photo' })).toBeVisible();
    await page.getByRole('button', { name: 'Retake' }).click();
    await page.reload();
    await expect(page.getByRole('button', { name: /Take photo/ })).toBeVisible();
  });
});

test('#3 Skip on the body photo reports a failed write instead of failing silently', async ({ page }) => {
  await openApp(page, { onboarded: false, route: '/body?onboarding=1' });
  await failWrites(page, 'settings', 'put');
  await page.getByRole('button', { name: 'Skip for now' }).click();
  await expect(page.locator('.toast', { hasText: 'Couldn’t save' })).toBeVisible();
  await expect(page).toHaveURL(/#\/body/);
});
