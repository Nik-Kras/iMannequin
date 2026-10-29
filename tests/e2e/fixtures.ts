// The project's phone (iPhone in WebKit, Android in Chromium) with a persistent profile: ephemeral contexts behave like
// private browsing, where WebKit's IndexedDB can't store Blobs. An installed app on a phone is persistent.
import { test as base, type BrowserContext, type Page, type PlaywrightTestOptions, type TestInfo } from '@playwright/test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** The phone of the running project, for persistent contexts: size, pixel ratio, touch and user agent. */
export function phone(info: TestInfo) {
  const { viewport, screen, userAgent, deviceScaleFactor, isMobile, hasTouch } = info.project.use as PlaywrightTestOptions;
  return {
    viewport, screen, userAgent, deviceScaleFactor, isMobile, hasTouch,
    baseURL: `http://localhost:${process.env.IMQ_PORT ?? '4183'}/iMannequin/`,
    locale: 'en-GB',
    timezoneId: 'Europe/London',
  };
}

export const test = base.extend<{ context: BrowserContext; page: Page }>({
  context: async ({ playwright, browserName }, use, info) => {
    const dir = mkdtempSync(join(tmpdir(), 'imannequin-e2e-'));
    const ctx = await playwright[browserName].launchPersistentContext(dir, phone(info));
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
