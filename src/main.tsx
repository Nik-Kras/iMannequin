import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './styles/global.css';
import App from './app/App';

declare global {
  const __APP_VERSION__: string;
  const __BUILD_ID__: string;
}

createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>);
