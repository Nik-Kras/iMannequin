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
    // WebKit on Linux reports the page's own image and worker loads that a reload or navigation cancelled as
    // "Cannot load … due to access control checks". Those are ignored, but only right after the test navigates:
    // the same message in a live page would be a broken image.
    let navigatedAt = -Infinity;
    page.on('request', (r) => { if (r.isNavigationRequest() && r.frame() === page.mainFrame()) navigatedAt = Date.now(); });
    page.on('pageerror', (e) => {
      const text = String(e);
      if (/^(Error: )?Cannot load \S+ due to access control checks\.?$/.test(text) && Date.now() - navigatedAt < 3000) return;
      errors.push(text);
    });
    await use(page);
    if (errors.length) throw new Error('Page errors:\n' + errors.join('\n'));
  },
});
export { expect } from '@playwright/test';
