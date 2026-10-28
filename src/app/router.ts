// Hash routing: works on GitHub Pages (no server rewrites) and with the iPhone back swipe.
import { useSyncExternalStore } from 'react';

export interface Route { path: string; parts: string[]; query: URLSearchParams }

function read(): Route {
  const raw = location.hash.replace(/^#/, '') || '/dressup';
  const [path, qs = ''] = raw.split('?');
  return { path, parts: path.split('/').filter(Boolean), query: new URLSearchParams(qs) };
}

let current = read();
const listeners = new Set<() => void>();
window.addEventListener('hashchange', () => {
  current = read();
  listeners.forEach((l) => l());
});

export function useRoute(): Route {
  return useSyncExternalStore((l) => (listeners.add(l), () => listeners.delete(l)), () => current);
}

export function navigate(path: string, opts?: { replace?: boolean }): void {
  const hash = '#' + path;
  if (opts?.replace) history.replaceState(null, '', hash);
  else history.pushState(null, '', hash);
  current = read();
  listeners.forEach((l) => l());
}

/** Back to the previous screen, or to a fallback when the screen was opened directly. */
export function goBack(fallback = '/dressup'): void {
  if (history.length > 1 && history.state !== 'root') history.back();
  else navigate(fallback, { replace: true });
}

export const TAB_ROOTS = ['/dressup', '/wardrobe', '/outfits', '/trips'] as const;
