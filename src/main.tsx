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
  // ?seed loads the synthetic sample wardrobe (dev, tests, screenshots), then drops the flag.
  if (new URLSearchParams(location.search).has('seed')) {
    const { seedSampleWardrobe } = await import('./dev/samples');
    await seedSampleWardrobe();
    history.replaceState(null, '', location.pathname + location.hash);
  }
  await getSettings(); // creates the settings record on first launch
  createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>);
}
void boot();
