// Every tap that writes goes through useAction (docs/bug-audit.md #3): one at a time, a lost IndexedDB
// connection reopened and retried, failures reported to diagnostics and shown to the user with Retry.
import { useCallback, useRef, useState, useSyncExternalStore } from 'react';
import { withReopen } from '../data/db';
import { reportError } from '../diag/diagnostics';

export interface Notice { id: number; text: string; actionLabel?: string; action?: () => void; ms?: number }

let notices: Notice[] = [];
let nextId = 1;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

/** Shows a message in the app-wide toast (rendered once by the shell, inside a live region). */
export function notify(n: Omit<Notice, 'id'>): number {
  const id = nextId++;
  notices = [...notices.filter((x) => x.text !== n.text), { ...n, id }];
  emit();
  return id;
}

export function dismissNotice(id: number): void {
  notices = notices.filter((n) => n.id !== id);
  emit();
}

export function useNotices(): Notice[] {
  return useSyncExternalStore((l) => (listeners.add(l), () => listeners.delete(l)), () => notices);
}

/**
 * Runs a user action that writes. While it runs, `busy` is true and further calls are ignored (no double
 * saves). IndexedDB errors from a lost connection are retried once after reopening. Any failure is
 * reported (where = `name`) and shown as `errorText` with a Retry action; the promise resolves to
 * undefined then, so callers never see a rejection.
 */
export function useAction<A extends unknown[], R>(
  name: string,
  fn: (...args: A) => Promise<R>,
  opts: { errorText: string; retryLabel: string; retry?: boolean },
): { run: (...args: A) => Promise<R | undefined>; busy: boolean } {
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  const fnRef = useRef(fn);
  fnRef.current = fn;
  const optsRef = useRef(opts);
  optsRef.current = opts;
  const run = useCallback(async (...args: A): Promise<R | undefined> => {
    if (inFlight.current) return undefined;
    inFlight.current = true;
    setBusy(true);
    try {
      return await withReopen(() => fnRef.current(...args));
    } catch (err) {
      reportError(err, name);
      const o = optsRef.current;
      notify({ text: o.errorText, actionLabel: o.retry === false ? undefined : o.retryLabel, action: o.retry === false ? undefined : () => void run(...args), ms: 8000 });
      return undefined;
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }, [name]);
  return { run, busy };
}

/** For handlers outside React state: runs `fn`, reporting and showing a failure instead of rejecting. */
export async function attempt<R>(name: string, fn: () => Promise<R>, errorText: string): Promise<R | undefined> {
  try {
    return await withReopen(fn);
  } catch (err) {
    reportError(err, name);
    notify({ text: errorText, ms: 8000 });
    return undefined;
  }
}
