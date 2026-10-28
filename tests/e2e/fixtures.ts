// WebKit (the iPhone Safari engine) with a persistent profile: ephemeral contexts behave like
// private browsing, where IndexedDB can't store Blobs. An installed app on a phone is persistent.
import { test as base, devices, webkit, type BrowserContext, type Page } from '@playwright/test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export const test = base.extend<{ context: BrowserContext; page: Page }>({
  context: async ({}, use) => {
    const dir = mkdtempSync(join(tmpdir(), 'imannequin-e2e-'));
    const ctx = await webkit.launchPersistentContext(dir, {
      ...devices['iPhone 15 Pro'],
      baseURL: 'http://localhost:4183/iMannequin/',
      locale: 'en-GB',
      timezoneId: 'Europe/London',
    });
    await use(ctx);
    await ctx.close();
    rmSync(dir, { recursive: true, force: true });
  },
  page: async ({ context }, use) => {
    const page = context.pages()[0] ?? (await context.newPage());
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    await use(page);
    if (errors.length) throw new Error('Page errors:\n' + errors.join('\n'));
  },
});
export { expect } from '@playwright/test';
