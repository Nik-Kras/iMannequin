// Hash routing: works on GitHub Pages (no server rewrites) and with the iPhone back swipe.
// Every history entry carries its depth in the app ({ idx }), so Back knows whether there is an app screen
// behind it, and never leaves the app or does nothing (bug-audit #24). An open sheet is an entry of its own
// ({ sheet }), so the edge swipe and Back close the sheet instead of the screen.
import { useSyncExternalStore } from 'react';

export interface Route { path: string; parts: string[]; query: URLSearchParams }
/** history.state of an app entry. A sheet entry also names the depth of the screen under it (`base`). */
interface Entry { idx: number; sheet?: number; base?: number }

function read(): Route {
  const raw = location.hash.replace(/^#/, '') || '/dressup';
  const [path, qs = ''] = raw.split('?');
  return { path, parts: path.split('/').filter(Boolean), query: new URLSearchParams(qs) };
}

const entry = (): Entry | null => {
  const s = history.state as Entry | null;
  return s && typeof s.idx === 'number' ? s : null;
};
/** Depth of the screen an entry shows (a sheet entry shows the screen under it). */
const screenIdx = (e: Entry): number => (e.sheet !== undefined ? (e.base ?? e.idx - 1) : e.idx);

let current = read();
let lastIdx = 0;
const listeners = new Set<() => void>();
const emit = () => {
  current = read();
  listeners.forEach((l) => l());
};

/** Sheets on screen, by token: the depth of their entry and how to close them. */
const openSheets = new Map<number, { idx: number; close: () => void }>();
let sheetSeq = 0;
/** Runs once the next popstate arrives (after a jump of several entries). */
let afterPop: (() => void) | undefined;
/** A history jump of ours is on its way; closing sheets mustn't add another. */
let travelling = false;
let travelTimer: ReturnType<typeof setTimeout> | undefined;
function travel(delta: number) {
  travelling = true;
  clearTimeout(travelTimer);
  travelTimer = setTimeout(() => { travelling = false; }, 1000);
  history.go(delta);
}

/** Gives an entry the browser made itself (a typed hash, a plain link) the next depth. */
function adopt(): Entry {
  let e = entry();
  if (!e) {
    e = { idx: lastIdx + 1 };
    history.replaceState(e, '');
  }
  lastIdx = e.idx;
  return e;
}

{
  const e = entry();
  if (!e) history.replaceState({ idx: 0 }, '');
  else if (e.sheet !== undefined) history.replaceState({ idx: e.idx }, ''); // reloaded with a sheet open
  lastIdx = e?.idx ?? 0;
}

window.addEventListener('popstate', () => {
  const prev = lastIdx;
  const e = adopt();
  travelling = false;
  // The entry of a sheet that has closed: skip it on the way back.
  if (e.sheet !== undefined && !openSheets.has(e.sheet) && e.idx < prev) { travel(-1); return; }
  // Back over an open sheet (the iPhone edge swipe) closes it.
  for (const s of [...openSheets.values()].reverse()) if (s.idx > e.idx) s.close();
  const after = afterPop;
  afterPop = undefined;
  after?.();
});
window.addEventListener('hashchange', () => {
  adopt();
  emit();
});

/** The route in the address bar right now (a render's route can be a navigation behind). */
export const routeNow = (): Route => read();

export function useRoute(): Route {
  return useSyncExternalStore((l) => (listeners.add(l), () => listeners.delete(l)), () => current);
}

/** Onboarding screens replace each other, so Back after onboarding never returns to them (bug-audit #22). */
export const isOnboardingRoute = (r: Route): boolean => r.parts[0] === 'welcome' || r.query.get('onboarding') === '1';

export function navigate(path: string, opts?: { replace?: boolean }): void {
  const hash = '#' + path;
  // A second tap on the same link must not stack the screen twice (bug-audit #23).
  if (!opts?.replace && location.hash === hash) return;
  const e = entry() ?? { idx: lastIdx };
  // From an open sheet, the new screen takes the sheet's entry: Back then returns to the screen under it.
  const replace = !!opts?.replace || e.sheet !== undefined || isOnboardingRoute(current);
  const next: Entry = { idx: replace ? e.idx : e.idx + 1 };
  if (replace) history.replaceState(next, '', hash);
  else history.pushState(next, '', hash);
  lastIdx = next.idx;
  emit();
}

/** Back to the previous screen, or to a fallback when this screen is the first one the app opened. */
export function goBack(fallback = '/dressup'): void {
  const e = entry() ?? { idx: lastIdx };
  const screen = screenIdx(e);
  if (screen > 0) travel(screen - 1 - e.idx);
  else if (e.idx > 0) {
    // A sheet is open over the first screen: close it, then put the fallback in the screen's place.
    afterPop = () => navigate(fallback, { replace: true });
    travel(-e.idx);
  } else navigate(fallback, { replace: true });
}

/**
 * Gives an open sheet its own history entry, so Back and the iPhone edge swipe close it (bug-audit #24).
 * `close` is called when the user goes back over it. Returns the cleanup for when the sheet unmounts.
 */
export function sheetEntry(close: () => void): () => void {
  const token = ++sheetSeq;
  const e = entry() ?? { idx: lastIdx };
  // A sheet that replaces one that has just closed (a menu opening a form) takes over its entry.
  const reuse = e.sheet !== undefined && !openSheets.has(e.sheet);
  const s: Entry = { idx: reuse ? e.idx : e.idx + 1, sheet: token, base: screenIdx(e) };
  if (reuse) history.replaceState(s, '');
  else history.pushState(s, '');
  lastIdx = s.idx;
  openSheets.set(token, { idx: s.idx, close });
  return () => {
    openSheets.delete(token);
    // Closed by its own buttons: take its entry off, unless a new sheet or screen has taken it over by then.
    setTimeout(() => { if (!travelling && entry()?.sheet === token) travel(-1); }, 0);
  };
}

export const TAB_ROOTS = ['/dressup', '/wardrobe', '/outfits', '/trips'] as const;
