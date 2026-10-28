// Where the app runs: installed on the home screen, or in a phone's browser tab (D47).
export function isStandalone(): boolean {
  return window.matchMedia('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
}

/** A browser tab on a phone keeps its own data, apart from the home-screen app (bug-audit #31). */
export const inPhoneBrowserTab = (): boolean => !isStandalone() && window.matchMedia('(pointer: coarse)').matches;
