// Four tabs with a raised centre + for adding clothes (D29).
import { useI18n } from '../i18n';
import { Icon, type IconName } from '../ui/icons';
import { navigate } from './router';

const TABS: { path: string; icon: IconName; key: 'tab.dressup' | 'tab.wardrobe' | 'tab.outfits' | 'tab.trips' }[] = [
  { path: '/dressup', icon: 'dressup', key: 'tab.dressup' },
  { path: '/wardrobe', icon: 'wardrobe', key: 'tab.wardrobe' },
  { path: '/outfits', icon: 'outfits', key: 'tab.outfits' },
  { path: '/trips', icon: 'trips', key: 'tab.trips' },
];

export function TabBar({ current }: { current: string }) {
  const { t } = useI18n();
  const tab = (x: (typeof TABS)[number]) => (
    <a key={x.path} href={`#${x.path}`} className="tab" aria-current={current.startsWith(x.path) || (x.path === '/outfits' && current === '/wear-log') || (x.path === '/wardrobe' && current === '/review') ? 'page' : undefined}
      onClick={(e) => { e.preventDefault(); navigate(x.path, { replace: true }); }}>
      <span className="tab__icon"><Icon name={x.icon} /></span>
      {t(x.key)}
    </a>
  );
  return (
    <nav className="tabbar" aria-label={t('nav.main')}>
      {tab(TABS[0])}
      {tab(TABS[1])}
      <a href="#/add" className="tab-add" aria-label={t('tab.add')} onClick={(e) => { e.preventDefault(); navigate('/add'); }}>
        <Icon name="plus" size={26} strokeWidth={2.1} />
      </a>
      {tab(TABS[2])}
      {tab(TABS[3])}
    </nav>
  );
}
