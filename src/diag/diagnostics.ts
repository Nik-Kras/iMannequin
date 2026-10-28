import * as Sentry from '@sentry/react';
import { createBlackBox, type Crumb } from './blackbox';

/**
 * Diagnostics (D50): the black box (always on, stays on the phone) plus Sentry crash reports (on by default,
 * switchable in Settings). Reports carry technical data only: never photos, cut-outs, garment names, brands,
 * places, notes or the weather location (R1 as amended by D50). See docs/architecture.md §12.
 */

const DSN = import.meta.env.VITE_SENTRY_DSN as string | undefined;
export const RELEASE = `imannequin@${__APP_VERSION__}+${__BUILD_ID__}`;

export const blackbox = createBlackBox(safeStorage(), RELEASE);
let enabled = false;
let started = false;
/** The Settings switch, which may change while Sentry is still starting. */
let wanted = false;

function safeStorage(): Storage {
  try {
    if (typeof localStorage !== 'undefined') return localStorage;
  } catch { /* blocked storage: fall through */ }
  const m = new Map<string, string>();
  return {
    getItem: (k) => m.get(k) ?? null,
    setItem: (k, v) => void m.set(k, v),
    removeItem: (k) => void m.delete(k),
    clear: () => m.clear(),
    key: () => null,
    get length() { return m.size; },
  };
}

/** Session code shown in Settings so a crash can be found in Sentry ("tag session:K7F2-9QXA"). */
export function sessionCode(): string {
  return `${blackbox.installId()}-${blackbox.session?.id ?? '????'}`;
}

export function record(stage: string, data?: Crumb['d']) {
  blackbox.record(stage, data);
  if (enabled) Sentry.addBreadcrumb({ category: 'app', message: stage, data: data ?? undefined, level: 'info' });
}

export function beginRisk(name: string) {
  blackbox.beginRisk(name);
  record(`risk.begin ${name}`);
}

export function endRisk() {
  const r = blackbox.session?.risk;
  blackbox.endRisk();
  if (r) record(`risk.end ${r}`);
}

/** Runs `fn` as a risky step: if iOS kills the app inside it, the next launch reports it. */
export async function risky<T>(name: string, fn: () => Promise<T>): Promise<T> {
  beginRisk(name);
  try {
    return await fn();
  } finally {
    endRisk();
  }
}

/** A short technical description of an error, safe to log (no user text is ever in our error messages). */
export function describeError(err: unknown): { name: string; message: string } {
  const e = err as { name?: string; message?: string };
  return { name: String(e?.name ?? typeof err), message: String(e?.message ?? err).slice(0, 300) };
}

export function reportError(err: unknown, where: string, data?: Crumb['d']) {
  record(`error ${where}`, { ...describeError(err), ...data });
  if (enabled) Sentry.captureException(err, { tags: { where }, extra: data });
}

/** Unhandled promise rejections go to the black box too (bug-audit #4); Sentry, when on, has its own handler. */
export function watchUnhandled(target: Pick<Window, 'addEventListener'> = window): void {
  target.addEventListener('unhandledrejection', (e) => record('error unhandled', describeError((e as PromiseRejectionEvent).reason)));
}

/** Times `fn` as a Sentry span (shows up under Performance) when diagnostics are on. */
export function span<T>(name: string, op: string, fn: () => Promise<T>, attributes?: Record<string, string>): Promise<T> {
  return enabled ? Sentry.startSpan({ name, op, attributes }, fn) : fn();
}

export function setDiagnosticsEnabled(on: boolean) {
  wanted = on;
  enabled = on && !!DSN && started && !!Sentry.getClient();
}

/** Route paths hold only screen names and random ids; queries are dropped. */
const safeUrl = (url: string) => url.replace(/[?#].*$/, '');

/** What the phone can do; attached to every report. Nothing personal. */
async function deviceSnapshot() {
  const nav = navigator as Navigator & { standalone?: boolean; gpu?: GPU; deviceMemory?: number };
  const ios = navigator.userAgent.match(/OS (\d+)[_.](\d+)(?:[_.](\d+))? like Mac OS X/)?.slice(1).filter(Boolean).join('.') ?? null;
  const adapter = nav.gpu ? await nav.gpu.requestAdapter().catch(() => null) : null;
  const est = await navigator.storage?.estimate?.().catch(() => undefined);
  const mb = (n?: number) => (n === undefined ? null : Math.round(n / 1048576));
  return {
    ios,
    standalone: !!nav.standalone || matchMedia('(display-mode: standalone)').matches,
    screen: `${screen.width}x${screen.height}@${devicePixelRatio}`,
    cores: navigator.hardwareConcurrency ?? null,
    device_memory_gb: nav.deviceMemory ?? null,
    cross_origin_isolated: crossOriginIsolated,
    webgpu: !!adapter,
    gpu_vendor: adapter?.info?.vendor ?? null,
    gpu_architecture: adapter?.info?.architecture ?? null,
    shader_f16: adapter?.features.has('shader-f16') ?? null,
    max_buffer_mb: mb(adapter?.limits.maxBufferSize),
    max_storage_buffers: adapter?.limits.maxStorageBuffersPerShaderStage ?? null,
    storage_quota_mb: mb(est?.quota),
    storage_usage_mb: mb(est?.usage),
    storage_persisted: (await navigator.storage?.persisted?.().catch(() => null)) ?? null,
  };
}

/**
 * Called once settings are loaded. Starts the session, sets up Sentry if allowed, and reports the previous
 * session if it was killed in the middle of something risky.
 */
export async function startDiagnostics(allowed: boolean) {
  if (started) return;
  started = true;
  const { previous, previousLog, end } = blackbox.start();
  document.addEventListener('visibilitychange', () => {
    blackbox.setVisible(document.visibilityState === 'visible');
    record(`visibility ${document.visibilityState}`);
  });
  window.addEventListener('hashchange', () => record('route', { path: safeUrl(location.hash.slice(1)) }));
  record('route', { path: safeUrl(location.hash.slice(1)) || '/' });

  // Read now: the router rewrites the hash (onboarding redirect) before Sentry starts.
  const selfTest = location.hash.startsWith('#sentry-test');
  // Automated test browsers (Playwright) don't report, except the deliberate #sentry-test check.
  const automated = navigator.webdriver && !selfTest;
  wanted = allowed;
  if (!allowed || !DSN || automated) return;
  // Sentry and the device snapshot cost ~10–15 ms; let the first screen draw before them.
  // The black box above is already recording.
  await new Promise((r) => setTimeout(r, 1500));

  Sentry.init({
    dsn: DSN,
    release: RELEASE,
    environment: location.hostname === 'nik-kras.github.io' ? 'production' : 'local',
    // No user info, cookies, headers or bodies: only what we attach explicitly.
    dataCollection: { userInfo: false, cookies: false, httpHeaders: false, httpBodies: [] },
    // Few users, so every trace is kept: page load, model downloads and the AI spans.
    tracesSampleRate: 1.0,
    // No trace headers on outgoing requests: there's no backend of ours, and extra headers would make
    // Hugging Face and the weather service reject the requests (CORS preflight).
    tracePropagationTargets: [],
    integrations: [
      Sentry.browserTracingIntegration(),
      // No click breadcrumbs: button text can hold garment names and brands. Navigation is recorded by
      // record('route') above, with ids only.
      Sentry.breadcrumbsIntegration({ dom: false, history: false, xhr: false, fetch: true, sentry: true }),
    ],
    beforeBreadcrumb: (crumb) => {
      // The weather request carries the location in its query (D50: never sent).
      if (crumb.data && typeof crumb.data.url === 'string') crumb.data.url = safeUrl(crumb.data.url);
      return crumb;
    },
    beforeSend: (event) => {
      if (!enabled) return null;
      if (event.request?.url) event.request.url = safeUrl(event.request.url);
      return event;
    },
    beforeSendTransaction: (event) => {
      if (!enabled) return null;
      if (event.request?.url) event.request.url = safeUrl(event.request.url);
      for (const s of event.spans ?? []) {
        if (typeof s.description === 'string') s.description = safeUrl(s.description);
        if (s.data && typeof s.data['http.url'] === 'string') s.data['http.url'] = safeUrl(s.data['http.url']);
        if (s.data && typeof s.data.url === 'string') s.data.url = safeUrl(s.data.url);
      }
      return event;
    },
    initialScope: {
      // ip_address null: never send or infer the IP (and with it, the location).
      user: { id: blackbox.installId(), ip_address: null },
      tags: { session: sessionCode() },
    },
  });
  enabled = wanted;
  // Setup check: opening the app with #sentry-test throws one real, unhandled error.
  if (selfTest) {
    setTimeout(() => {
      throw new Error('iMannequin Sentry verification error (#sentry-test)');
    }, 1500);
  }

  const device = await deviceSnapshot();
  Sentry.setContext('device', device);
  Sentry.setTags({ ios: device.ios ?? 'other', standalone: device.standalone, webgpu: device.webgpu });
  record('app.start', { release: RELEASE, standalone: device.standalone });

  if (previous && end !== 'clean') {
    // How long it had been in the risky step when the last log line was written.
    const lastT = previousLog.length ? previousLog[previousLog.length - 1].t : null;
    const seconds = previous.riskSince && lastT ? Math.round((lastT - previous.riskSince) / 1000) : null;
    Sentry.captureEvent({
      level: end === 'crash' ? 'fatal' : 'warning',
      message:
        end === 'crash'
          ? `App was killed during ${previous.risk} (likely out of memory)`
          : `App was killed in the background during ${previous.risk}`,
      fingerprint: ['app-killed', end, previous.risk!.split('@')[0]],
      tags: { risk: previous.risk, previous_session: `${blackbox.installId()}-${previous.id}`, previous_release: previous.version },
      extra: { seconds_in_risky_step_at_last_log: seconds, last_log: previousLog.at(-1)?.s ?? null },
      breadcrumbs: previousLog.map((c) => ({ timestamp: c.t / 1000, category: 'blackbox', message: c.s, data: c.d })),
    });
  }
}
