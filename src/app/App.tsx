import { Component, useEffect, useRef, useState, type ReactNode } from 'react';
import { useRegisterSW } from 'virtual:pwa-register/react';
import { I18nProvider, useI18n } from '../i18n';
import { useSettings, ensureDefaultPlaces } from '../data/repo';
import { db, getSettings, isConnectionError } from '../data/db';
import { startQueueRunner } from '../data/queue';
import { record, reportError, setDiagnosticsEnabled, startDiagnostics } from '../diag/diagnostics';
import { Toast, ToastHost } from '../ui/parts';
import { dismissNotice, useNotices } from '../ui/action';
import type { Lang } from '../domain/types';
import { TabBar } from './TabBar';
import { inPhoneBrowserTab } from './display';
import { navigate, routeNow, useRoute, TAB_ROOTS } from './router';
import DressUp from '../screens/DressUp';
import SeeAll from '../screens/SeeAll';
import AdjustFit from '../screens/AdjustFit';
import BodyPhoto from '../screens/BodyPhoto';
import Wardrobe from '../screens/Wardrobe';
import AddClothes from '../screens/AddClothes';
import ReviewInbox from '../screens/ReviewInbox';
import ItemForm from '../screens/ItemForm';
import FixCutout from '../screens/FixCutout';
import Places from '../screens/Places';
import SeasonSwap from '../screens/SeasonSwap';
import Outfits from '../screens/Outfits';
import WearLog from '../screens/WearLog';
import ShareOutfit from '../screens/ShareOutfit';
import Trips from '../screens/Trips';
import TripDetail from '../screens/TripDetail';
import Settings from '../screens/Settings';
import Welcome from '../screens/Welcome';
import InstallGuide from '../screens/InstallGuide';
import ModelDownload from '../screens/ModelDownload';
import ModelLab from '../screens/ModelLab';
import BackupReminder from '../screens/BackupReminder';

const ONBOARDING = ['welcome', 'models', 'body'];

function Screen({ parts }: { parts: string[] }) {
  const [a, b, c] = parts;
  switch (a) {
    case 'dressup': return <DressUp />;
    case 'see-all': return <SeeAll slot={b} />;
    case 'fit': return <AdjustFit itemId={b} />;
    case 'body': return <BodyPhoto />;
    case 'wardrobe': return <Wardrobe />;
    case 'add': return <AddClothes />;
    case 'review': return <ReviewInbox />;
    case 'item': return c === 'fix' ? <FixCutout itemId={b} /> : <ItemForm itemId={b} />;
    case 'places': return <Places />;
    case 'season-swap': return <SeasonSwap />;
    case 'outfits': return <Outfits />;
    case 'wear-log': return <WearLog />;
    case 'share': return <ShareOutfit />;
    case 'trips': return <Trips />;
    case 'trip': return <TripDetail tripId={b} />;
    case 'settings': return <Settings />;
    case 'welcome': return <Welcome />;
    case 'models': return <ModelDownload />;
    case 'model-lab': return <ModelLab />;
    default: return <DressUp />;
  }
}

function Shell() {
  const route = useRoute();
  const settings = useSettings();
  const { t } = useI18n();
  const [browserTab] = useState(inPhoneBrowserTab);
  const { needRefresh: [needRefresh, setNeedRefresh], updateServiceWorker } = useRegisterSW();
  const guide = !!settings && browserTab && !settings.installGuideDismissed;

  useEffect(() => startQueueRunner(), []);
  // Diagnostics start once the switch's value is known; flipping it applies immediately (D50).
  useEffect(() => {
    if (!settings) return;
    void startDiagnostics(settings.diagnostics);
    setDiagnosticsEnabled(settings.diagnostics);
  }, [settings?.diagnostics, settings]);
  // Each screen opens at the top (the window keeps its scroll otherwise), Welcome too after the install guide (#26).
  useEffect(() => { window.scrollTo(0, 0); }, [route.path, guide]);
  useEffect(() => { if (settings) document.documentElement.lang = settings.lang; }, [settings?.lang]);
  useScreenFocus(route.path);
  // The default places are made once (D22): places the user deletes stay deleted (bug-audit #34).
  const seeded = settings?.placesSeeded;
  useEffect(() => {
    if (!settings || seeded) return;
    void seedPlacesOnce(settings.lang).catch((err) => reportError(err, 'places.seed'));
    void navigator.storage?.persist?.();
  }, [!!settings, seeded]);
  // Redirects look at the address as it is now: a navigation may have landed since this render.
  useEffect(() => {
    if (!settings) return;
    if (settings.onboarded) {
      // Onboarding is over: a stale entry or a link to its screens lands on Dress-up (bug-audit #22).
      const now = routeNow();
      if (now.parts[0] === 'welcome' || (now.parts[0] === 'models' && now.query.has('onboarding'))) navigate('/dressup', { replace: true });
      return;
    }
    // Read the stored value: the live settings can lag a screen that has just finished onboarding.
    if (!ONBOARDING.includes(route.parts[0])) {
      void getSettings()
        .then((fresh) => { if (!fresh.onboarded && !ONBOARDING.includes(routeNow().parts[0])) navigate('/welcome', { replace: true }); })
        .catch((err) => reportError(err, 'onboarding.check'));
    }
  }, [settings, route.parts]);

  if (!settings) return null;
  if (guide) return <><InstallGuide /><Notices /></>;
  const showTabs = settings.onboarded && (TAB_ROOTS.some((p) => route.path === p) || route.path === '/review' || route.path === '/wear-log');
  return (
    <>
      <main key={route.path}><Screen parts={route.parts} /></main>
      {settings.onboarded && <BackupReminder />}
      {showTabs && <TabBar current={route.path} />}
      <Notices />
      {needRefresh && (
        <Toast onDone={() => setNeedRefresh(false)} ms={60_000}
          action={<button type="button" className="text-action" onClick={() => updateServiceWorker(true)}>{t('update.reload')}</button>}>
          {t('update.ready')}
        </Toast>
      )}
    </>
  );
}

/** App-wide messages from useAction / notify (failed saves with Retry). */
function Notices() {
  const list = useNotices();
  const n = list[list.length - 1];
  if (!n) return null;
  return (
    <Toast key={n.id} onDone={() => dismissNotice(n.id)} ms={n.ms}
      action={n.action && n.actionLabel ? <button type="button" className="text-action" onClick={() => { dismissNotice(n.id); n.action!(); }}>{n.actionLabel}</button> : undefined}>
      {n.text}
    </Toast>
  );
}

/** Creates the default places on first run (D22), once: an install that already has places counts as done. */
async function seedPlacesOnce(lang: Lang): Promise<void> {
  await db.transaction('rw', [db.locations, db.settings], async () => {
    const s = await getSettings();
    if (s.placesSeeded) return;
    await ensureDefaultPlaces(lang);
    await db.settings.put({ ...s, placesSeeded: true });
  });
}

/**
 * VoiceOver (bug-audit #43): after a navigation the new screen's h1 gets the focus (instead of the focus staying on
 * <body>) and names the page. Screens that read data first draw their h1 a moment later, so it is awaited.
 */
function useScreenFocus(path: string) {
  const first = useRef(true);
  useEffect(() => {
    const focus = !first.current;
    first.current = false;
    const apply = (): boolean => {
      const main = document.querySelector('main');
      const h1 = main?.querySelector<HTMLElement>('h1');
      if (!main || !h1) return false;
      const name = h1.textContent?.trim() ?? '';
      document.title = name && name !== 'iMannequin' ? `${name} · iMannequin` : 'iMannequin';
      // A field the screen focused itself, or a tap that came first, keeps the focus.
      if (focus && !main.contains(document.activeElement)) {
        h1.tabIndex = -1;
        h1.focus({ preventScroll: true });
      }
      return true;
    };
    if (apply()) return;
    const watch = new MutationObserver(() => { if (apply()) watch.disconnect(); });
    watch.observe(document.querySelector('.app') ?? document.body, { childList: true, subtree: true });
    const stop = setTimeout(() => watch.disconnect(), 3000);
    return () => {
      watch.disconnect();
      clearTimeout(stop);
    };
  }, [path]);
}

/** Last-resort screen so a bug or a failed start never leaves a blank page; the wardrobe is untouched (bug-audit #4). */
export function Oops({ error }: { error?: unknown }) {
  const message = String((error as Error | undefined)?.message ?? error ?? '').slice(0, 200);
  return (
    <div className="screen screen--no-tabs pad stack gap-16" style={{ justifyContent: 'center', minHeight: '100dvh' }}>
      <h1 className="h1">Oops · Ой</h1>
      <p className="body">Something went wrong. Your wardrobe is safe. · Щось пішло не так. Гардероб у безпеці.</p>
      {message && <p className="meta">{message}</p>}
      <button type="button" className="btn btn--primary btn--block" onClick={() => location.reload()}>Restart · Перезапустити</button>
    </div>
  );
}

/**
 * Catches render errors anywhere below, including the settings read the whole app depends on. A lost IndexedDB
 * connection (iOS, after the camera or the photo picker) is reopened once and the screens read again.
 */
class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };
  private retried = false;
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  componentDidCatch(error: Error) {
    // Sentry already gets it through React's onCaughtError hook (main.tsx); keep it in the black box too.
    record('error render', { message: String(error.message).slice(0, 300) });
    if (this.retried || !isConnectionError(error)) return;
    this.retried = true;
    db.close({ disableAutoOpen: false });
    void Promise.race([db.open().catch(() => undefined), new Promise((r) => setTimeout(r, 5000))]).then(() => {
      this.setState({ error: null });
      setTimeout(() => { this.retried = false; }, 10_000);
    });
  }
  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    if (!this.retried && isConnectionError(error)) return null; // reopening (componentDidCatch)
    return <Oops error={error} />;
  }
}

function Localised({ children }: { children: ReactNode }) {
  const settings = useSettings();
  return <I18nProvider lang={settings?.lang ?? 'en'}>{children}</I18nProvider>;
}

export default function App() {
  return (
    <>
      <div className="paper-bg" aria-hidden="true" />
      <div className="app">
        <ErrorBoundary><Localised><Shell /></Localised></ErrorBoundary>
        <ToastHost />
      </div>
    </>
  );
}
