// Parts shared by the Outfits and Wear log screens.
import { useI18n } from '../i18n';
import { navigate } from '../app/router';
import { Segmented } from '../ui/parts';
import type { Item } from '../domain/types';
import { monthAfterDay } from './calendar';

/** "Outfits" title with the Saved | Wear log switch (both boards). */
export function OutfitsHeader({ view }: { view: 'saved' | 'log' }) {
  const { t } = useI18n();
  return (
    <div className="header">
      <h1 className="h1">{t('tab.outfits')}</h1>
      <Segmented onPaper label={t('outfits.view')} value={view}
        options={[{ value: 'saved', label: t('outfits.saved') }, { value: 'log', label: t('outfits.wearLog') }]}
        onChange={(v) => navigate(v === 'log' ? '/wear-log' : '/outfits', { replace: true })} />
    </div>
  );
}

/** "since March" / "з березня" / "never" for the not-worn strip. */
export function sinceLabel(item: Item, t: ReturnType<typeof useI18n>['t'], lang: 'en' | 'uk'): string {
  if (!item.lastWornAt) return t('outfits.never');
  const d = new Date(item.lastWornAt);
  const month = monthAfterDay(d, lang);
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return t('outfits.since', { month: sameYear ? month : `${month} ${String(d.getFullYear()).slice(2)}` });
}
