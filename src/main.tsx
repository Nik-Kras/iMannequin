import * as Sentry from '@sentry/react';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './styles/global.css';
import App from './app/App';
import { getSettings } from './data/db';

declare global {
  const __APP_VERSION__: string;
  const __BUILD_ID__: string;
}

async function boot() {
  // End-to-end tests and audit scripts (?e2e) seed and inspect the database directly.
  if (new URLSearchParams(location.search).has('e2e')) {
    const { db } = await import('./data/db');
    Object.assign(window, { __imq: { db } });
  }
  // ?seed loads the synthetic sample wardrobe (dev, tests, screenshots), then drops the flag.
  if (new URLSearchParams(location.search).has('seed')) {
    const { seedSampleWardrobe } = await import('./dev/samples');
    await seedSampleWardrobe();
    history.replaceState(null, '', location.pathname + location.hash);
  }
  await getSettings(); // creates the settings record on first launch
  // React 19 error hooks report render errors (no-ops until Sentry starts, if diagnostics are on).
  createRoot(document.getElementById('root')!, {
    onUncaughtError: Sentry.reactErrorHandler(),
    onCaughtError: Sentry.reactErrorHandler(),
    onRecoverableError: Sentry.reactErrorHandler(),
  }).render(<StrictMode><App /></StrictMode>);
}
void boot();
