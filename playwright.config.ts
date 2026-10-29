import { defineConfig, devices } from '@playwright/test';

// IMQ_PORT lets several worktrees run their own preview at once (default 4183).
const PORT = process.env.IMQ_PORT ?? '4183';
const BASE = `http://localhost:${PORT}/iMannequin/`;

// Two phones: iPhone (WebKit, the engine behind iPhone Safari) and Android (Chromium, the engine behind Chrome).
// The Android profile is the owner's Galaxy S25 Ultra as it reported itself to Sentry: 384 × 832 at 2.8125×.
export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 60_000,
  fullyParallel: true,
  // CI only: on a shared Linux runner the fake camera's first frame can arrive late; a test that passes on its retry
  // is reported as flaky instead of blocking the deploy.
  retries: process.env.CI ? 1 : 0,
  reporter: [['list']],
  use: {
    baseURL: BASE,
    locale: 'en-GB',
    timezoneId: 'Europe/London',
  },
  projects: [
    { name: 'iphone', use: { ...devices['iPhone 15 Pro'], browserName: 'webkit' } },
    {
      name: 'android',
      use: { ...devices['Pixel 9'], viewport: { width: 384, height: 832 }, screen: { width: 384, height: 832 }, deviceScaleFactor: 2.8125, browserName: 'chromium' },
    },
  ],
  webServer: {
    command: 'pnpm build && pnpm preview',
    url: BASE,
    reuseExistingServer: true,
    timeout: 240_000,
  },
});
