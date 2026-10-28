// The owner's bug and the body-photo flow (docs/bug-audit.md). WebKit, iPhone 15 Pro, synthetic figure (R2).
import { expect, test } from './fixtures';
import { bodyFile, fakeDevice, openApp, withDb } from './helpers';

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
