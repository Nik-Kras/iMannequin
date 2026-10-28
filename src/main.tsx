import * as Sentry from '@sentry/react';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './styles/global.css';
import App, { Oops } from './app/App';
import { getSettings, withReopen } from './data/db';
import { describeError, record, watchUnhandled } from './diag/diagnostics';

declare global {
  const __APP_VERSION__: string;
  const __BUILD_ID__: string;
}

/** How long the database may take to open before the error screen shows instead of a blank page (bug-audit #4). */
const OPEN_TIMEOUT_MS = 12_000;

watchUnhandled();

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
    history.replaceState(history.state, '', location.pathname + location.hash);
  }
  // Creates the settings record on first launch. A lost connection is reopened once; a database that never
  // answers counts as a failed start.
  let timer: ReturnType<typeof setTimeout> | undefined;
  await Promise.race([
    withReopen(() => getSettings(), undefined, 5000),
    new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('The database did not open in time')), OPEN_TIMEOUT_MS); }),
  ]).finally(() => clearTimeout(timer));
}

// React 19 error hooks report render errors (no-ops until Sentry starts, if diagnostics are on).
const root = () => createRoot(document.getElementById('root')!, {
  onUncaughtError: Sentry.reactErrorHandler(),
  onCaughtError: Sentry.reactErrorHandler(),
  onRecoverableError: Sentry.reactErrorHandler(),
});

boot().then(
  () => root().render(<StrictMode><App /></StrictMode>),
  (err: unknown) => {
    record('error boot', describeError(err));
    root().render(<><div className="paper-bg" aria-hidden="true" /><div className="app"><Oops error={err} /></div></>);
  },
);
