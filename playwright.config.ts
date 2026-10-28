import { defineConfig, devices } from '@playwright/test';

// IMQ_PORT lets several worktrees run their own preview at once (default 4183).
const PORT = process.env.IMQ_PORT ?? '4183';
const BASE = `http://localhost:${PORT}/iMannequin/`;

// WebKit is the engine behind iPhone Safari; the device profile gives iPhone size, touch and user agent.
export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 60_000,
  fullyParallel: true,
  reporter: [['list']],
  use: {
    ...devices['iPhone 15 Pro'],
    browserName: 'webkit',
    baseURL: BASE,
    locale: 'en-GB',
    timezoneId: 'Europe/London',
  },
  webServer: {
    command: 'pnpm build && pnpm preview',
    url: BASE,
    reuseExistingServer: true,
    timeout: 240_000,
  },
});
