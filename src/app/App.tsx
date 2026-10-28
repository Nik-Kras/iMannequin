import { useEffect, useState } from 'react';
import { useRegisterSW } from 'virtual:pwa-register/react';
import { I18nProvider, useI18n } from '../i18n';
import { useSettings, ensureDefaultPlaces } from '../data/repo';
import { getSettings } from '../data/db';
import { startQueueRunner } from '../data/queue';
import { Toast } from '../ui/parts';
import { TabBar } from './TabBar';
import { navigate, useRoute, TAB_ROOTS } from './router';
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

function isStandalone(): boolean {
  return window.matchMedia('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
}
const isPhone = () => window.matchMedia('(pointer: coarse)').matches;

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
  const [browserTab] = useState(() => !isStandalone() && isPhone());
  const { needRefresh: [needRefresh, setNeedRefresh], updateServiceWorker } = useRegisterSW();

  useEffect(() => startQueueRunner(), []);
  // Each screen opens at the top (the window keeps its scroll otherwise).
  useEffect(() => { window.scrollTo(0, 0); }, [route.path]);
  useEffect(() => { if (settings) document.documentElement.lang = settings.lang; }, [settings?.lang]);
  useEffect(() => {
    if (!settings) return;
    void ensureDefaultPlaces(settings.lang);
    void navigator.storage?.persist?.();
    // Read the stored value: the live settings can lag a screen that has just finished onboarding.
    if (!settings.onboarded && !ONBOARDING.includes(route.parts[0])) {
      void getSettings().then((fresh) => { if (!fresh.onboarded) navigate('/welcome', { replace: true }); });
    }
  }, [settings, route.parts]);

  if (!settings) return null;
  if (browserTab && !settings.installGuideDismissed) return <InstallGuide />;
  const showTabs = settings.onboarded && (TAB_ROOTS.some((p) => route.path === p) || route.path === '/review' || route.path === '/wear-log');
  return (
    <>
      <main key={route.path}><Screen parts={route.parts} /></main>
      {settings.onboarded && <BackupReminder />}
      {showTabs && <TabBar current={route.path} />}
      {needRefresh && (
        <Toast onDone={() => setNeedRefresh(false)} ms={60_000}
          action={<button type="button" className="text-action" onClick={() => updateServiceWorker(true)}>{t('update.reload')}</button>}>
          {t('update.ready')}
        </Toast>
      )}
    </>
  );
}

export default function App() {
  const settings = useSettings();
  return (
    <I18nProvider lang={settings?.lang ?? 'en'}>
      <div className="paper-bg" aria-hidden="true" />
      <div className="app"><Shell /></div>
    </I18nProvider>
  );
}
