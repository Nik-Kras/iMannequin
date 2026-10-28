import { defineConfig, devices } from '@playwright/test';

// WebKit is the engine behind iPhone Safari; the device profile gives iPhone size, touch and user agent.
export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 60_000,
  fullyParallel: true,
  reporter: [['list']],
  use: {
    ...devices['iPhone 15 Pro'],
    browserName: 'webkit',
    baseURL: 'http://localhost:4173/iMannequin/',
    locale: 'en-GB',
    timezoneId: 'Europe/London',
  },
  webServer: {
    command: 'pnpm build && pnpm preview',
    url: 'http://localhost:4173/iMannequin/',
    reuseExistingServer: true,
    timeout: 240_000,
  },
});
