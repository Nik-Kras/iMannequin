// F9: the wear log as a month calendar of garment colours, plus recent days (board WearLog.dc.html).
import '../styles/life.css';
import { useMemo, useState } from 'react';
import { todayISO, useActiveItems, useSettings } from '../data/repo';
import { useI18n } from '../i18n';
import { navigate } from '../app/router';
import { Icon } from '../ui/icons';
import { useById, useItemsById, useOutfits, useWear } from '../life/hooks';
import {
  addMonths, daysBetween, monthCells, monthTitle, parseISO, sameMonth, weekdayLabels, wornByDate, ymOf, type YearMonth,
} from '../life/calendar';
import { swatchBackground } from '../life/colours';
import { draftFromItems, lookTitle, notWornItems } from '../life/wardrobe';
import { OutfitsHeader } from '../life/outfits';
import { MiniMannequin } from '../life/ui';

const RECENT = 3;

export default function WearLog() {
  const { t, tn, lang, date } = useI18n();
  const settings = useSettings();
  const wear = useWear();
  const itemsById = useItemsById();
  const outfitsById = useById(useOutfits());
  const active = useActiveItems();
  const today = todayISO();
  const thisMonth = ymOf(today);
  const [ym, setYm] = useState<YearMonth>(thisMonth);
  const days = useMemo(() => wornByDate(wear ?? []), [wear]);
  const items = itemsById ?? new Map();
  const months = settings?.notWornMonths ?? 6;
  const staleCount = useMemo(() => notWornItems(active ?? [], months).length, [active, months]);

  const cells = monthCells(ym);
  const prefix = `${ym.year}-${String(ym.month + 1).padStart(2, '0')}`;
  const monthDays = [...days.entries()].filter(([d]) => d.startsWith(prefix));
  const savedDays = monthDays.filter(([, v]) => v.outfitIds.some((id) => outfitsById.has(id))).length;
  const weekdays = weekdayLabels(lang);

  const recent = [...days.entries()].filter(([d]) => d <= today).sort((a, b) => b[0].localeCompare(a[0])).slice(0, RECENT);
  const what = (itemIds: string[], outfitIds: string[]) => {
    const saved = outfitIds.map((id) => outfitsById.get(id)).find(Boolean);
    return saved?.name ?? lookTitle(itemIds, items);
  };

  return (
    <div className="screen">
      <div className="stack gap-12">
        <OutfitsHeader view="log" />

        <section className="card wearcal" aria-labelledby="wearcal-h">
          <div className="wearcal__head">
            <div className="stack">
              <h2 id="wearcal-h" className="h2">{monthTitle(ym, lang)}</h2>
              <span className="meta">{tn('outfits.log.days', monthDays.length)} · {t('outfits.log.inSaved', { n: savedDays })}</span>
            </div>
            <div className="row">
              <button type="button" className="wearcal__nav" aria-label={t('outfits.log.prev')} onClick={() => setYm(addMonths(ym, -1))}>
                <Icon name="back" size={20} strokeWidth={2} />
              </button>
              <button type="button" className="wearcal__nav" aria-label={t('outfits.log.next')} disabled={sameMonth(ym, thisMonth)} onClick={() => setYm(addMonths(ym, 1))}>
                <Icon name="chevron" size={20} strokeWidth={2} />
              </button>
            </div>
          </div>
          <div className="wearcal__grid" aria-hidden="true">
            {weekdays.map((w) => <span key={w} className="wearcal__wd">{w}</span>)}
          </div>
          <ul className="wearcal__grid">
            {cells.map((iso, i) => {
              if (!iso) return <li key={`x${i}`} className="wearcal__cell wearcal__cell--pad" aria-hidden="true" />;
              const day = days.get(iso);
              const isToday = iso === today;
              const future = iso > today;
              const swatches = day ? day.itemIds.map((id) => items.get(id)?.colours[0]).filter((c) => !!c).slice(0, 4) : [];
              const label = day ? t('outfits.log.wornOn', { date: date(parseISO(iso), { day: 'numeric', month: 'long' }), what: what(day.itemIds, day.outfitIds) }) : date(parseISO(iso), { day: 'numeric', month: 'long' });
              return (
                <li key={iso} aria-label={label} aria-current={isToday ? 'date' : undefined}
                  className={`wearcal__cell${day ? ' wearcal__cell--worn' : ''}${isToday ? ' wearcal__cell--today' : ''}${future ? ' wearcal__cell--future' : ''}`}>
                  <span className="wearcal__n">{parseISO(iso).getDate()}</span>
                  {swatches.length > 0 && (
                    <span className="wearcal__sw">
                      {swatches.map((c, k) => <span key={k} style={{ background: swatchBackground(c!) }} />)}
                    </span>
                  )}
                  {isToday && day && <span className="wearcal__stamp" aria-hidden="true">{t('outfits.log.stamp')}</span>}
                </li>
              );
            })}
          </ul>
        </section>

        <h2 className="title-card pad">{t('outfits.log.recent')}</h2>
        {recent.length === 0 ? (
          <p className="pad body life-muted">{t('outfits.log.empty')}</p>
        ) : (
          <ul className="stack gap-8 recent">
            {recent.map(([iso, v]) => {
              const saved = v.outfitIds.map((id) => outfitsById.get(id)).find(Boolean);
              const count = v.itemIds.filter((id) => items.has(id)).length;
              const age = daysBetween(iso, today);
              const when = age === 0 ? t('outfits.log.today') : date(parseISO(iso), { weekday: 'short', day: 'numeric' });
              return (
                <li key={iso} className="card recent__row">
                  <span className="recent__doll"><MiniMannequin draft={draftFromItems(v.itemIds, items)} height={52} /></span>
                  <span className="grow stack">
                    <span className="row-text recent__title">{what(v.itemIds, v.outfitIds)}</span>
                    <span className="meta">{tn('outfits.pieces', count)}{saved ? '' : ` · ${t('outfits.log.notSaved')}`}</span>
                  </span>
                  <span className="recent__when">{when}</span>
                </li>
              );
            })}
          </ul>
        )}

        {staleCount > 0 && (
          <a className="banner recent__stale" href="#/wardrobe?notWorn=1" onClick={(e) => { e.preventDefault(); navigate('/wardrobe?notWorn=1'); }}>
            <span className="grow">{tn('outfits.notWorn', months)} · {tn('count.items', staleCount)}</span>
            <Icon name="chevron" size={20} strokeWidth={2} />
          </a>
        )}
      </div>
    </div>
  );
}
