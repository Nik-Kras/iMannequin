// See all (D21, board SeeAll): every garment for one slot as a grid of cut-outs, with season, colour and place filters.
// The one on the mannequin is circled; "Put it on" / "Take it off" changes the outfit and goes back to Dress-up.
import { useMemo, useState } from 'react';
import { goBack } from '../app/router';
import { useActiveItems, useLocations, useSettings } from '../data/repo';
import { categoriesForSlot } from '../domain/taxonomy';
import { SEASONS, type ColourName, type OutfitDraft, type Season, type Slot } from '../domain/types';
import { useI18n, type Key } from '../i18n';
import { currentSeason, editDraft, GarmentThumb, isWorn, putOn, takeOff, useItemPhotos } from '../tryon/ui';
import { useAction } from '../ui/action';
import { Icon } from '../ui/icons';
import { Chip, Empty, Header, PenCircle, Sheet } from '../ui/parts';
import '../styles/dressup.css';

type SlotParam = Slot | 'acc';
const SLOT_PARAMS: SlotParam[] = ['head', 'neck', 'base', 'mid', 'outer', 'full', 'legs', 'feet', 'hands', 'acc'];
const ZONE: Record<SlotParam, Key> = {
  head: 'zone.head', neck: 'zone.neck', base: 'zone.top', mid: 'zone.top', outer: 'zone.top', full: 'zone.full',
  legs: 'zone.legs', feet: 'zone.feet', hands: 'zone.hands', acc: 'zone.acc',
};
const ROTS = [-0.6, 0.5, -0.3, 0.6, -0.5, 0.3, 0.5, -0.6, 0.2, -0.4, 0.6, -0.3];
const EMPTY_DRAFT: OutfitDraft = { slots: {}, accessories: [], toggles: { tuckIn: false, intoBoots: false } };

type Filter = 'season' | 'colour' | 'place';

export default function SeeAll({ slot: param }: { slot?: string }) {
  const { t, tn } = useI18n();
  const slot: SlotParam = SLOT_PARAMS.includes(param as SlotParam) ? (param as SlotParam) : 'base';
  const settings = useSettings();
  const items = useActiveItems();
  const places = useLocations();
  const draft = settings?.draft ?? EMPTY_DRAFT;
  const [season, setSeason] = useState<Season | undefined>(() => currentSeason());
  const [colour, setColour] = useState<ColourName>();
  const [place, setPlace] = useState<string>();
  const [picking, setPicking] = useState<Filter | null>(null);
  const [picked, setPicked] = useState<string>();

  const inSlot = useMemo(() => {
    const cats = new Set(categoriesForSlot(slot).map((c) => c.id));
    return (items ?? []).filter((i) => cats.has(i.category))
      .sort((a, b) => (b.lastWornAt ?? 0) - (a.lastWornAt ?? 0) || a.name.localeCompare(b.name));
  }, [items, slot]);
  // A garment with no season set isn't hidden by the season filter (bug-audit #28).
  const shown = inSlot.filter((i) => (!season || !i.seasons?.length || i.seasons.includes(season)) && (!colour || i.colours.includes(colour)) && (!place || i.locationId === place));
  const photos = useItemPhotos(inSlot);
  const placeName = (id?: string) => places?.find((p) => p.id === id)?.name;
  const worn = inSlot.find((i) => isWorn(draft, i.id));
  const current = inSlot.find((i) => i.id === (picked ?? worn?.id));
  const colours = useMemo(() => [...new Set(inSlot.flatMap((i) => i.colours))], [inSlot]);

  const done = useAction('seeAll.done', async (change: (d: OutfitDraft) => OutfitDraft) => {
    await editDraft(change);
    goBack('/dressup');
  }, { errorText: t('state.saveFailed'), retryLabel: t('action.retry') });

  const filterChip = (f: Filter, value: string | undefined, label: string, clear: () => void) => value ? (
    <button key={f} type="button" className="sa-filter" aria-pressed="true" aria-label={t('dressup.filter.remove', { name: `${t(`dressup.filter.${f}`)}: ${label}` })} onClick={clear}>
      {label}<Icon name="close" size={15} strokeWidth={2.2} />
    </button>
  ) : (
    <button key={f} type="button" className="sa-filter" aria-haspopup="dialog" onClick={() => setPicking(f)}>
      {t(`dressup.filter.${f}`)}<Icon name="down" size={14} strokeWidth={2} />
    </button>
  );

  return (
    <div className="screen screen--no-tabs sa">
      <div className="sa__head">
        <Header back="/dressup" backLabel={t('tab.dressup')} />
        <div className="pad sa__title">
          <h1 className="h1">{t(`dressup.seeAll.${slot}`)}</h1>
          <p className="sa__sub">{t('dressup.seeAll.sub', { zone: t(ZONE[slot]), count: tn('count.items', shown.length) })}</p>
        </div>
        <div role="group" aria-label={t('dressup.filters')} className="hscroll sa__filters">
          {filterChip('season', season, season ? t(`season.${season}`) : '', () => setSeason(undefined))}
          {filterChip('colour', colour, colour ? t(`colour.${colour}`) : '', () => setColour(undefined))}
          {filterChip('place', place, placeName(place) ?? '', () => setPlace(undefined))}
        </div>
      </div>

      {items && shown.length === 0 ? (
        <Empty icon="search" action={
          <button type="button" className="btn btn--secondary btn--sm" onClick={() => { setSeason(undefined); setColour(undefined); setPlace(undefined); }}>{t('dressup.filter.clear')}</button>
        }>{inSlot.length ? t('dressup.filter.none') : t('dressup.rowEmpty')}</Empty>
      ) : (
        <div className="sa__grid">
          {shown.map((it, i) => {
            const on = isWorn(draft, it.id);
            const isPicked = current?.id === it.id;
            return (
              <button key={it.id} type="button" className={`sa-card${isPicked ? ' is-picked' : ''}`} aria-pressed={isPicked}
                style={{ transform: `rotate(${ROTS[i % ROTS.length]}deg)` }} onClick={() => setPicked(it.id)}>
                {/* The pen circle rings the garment, not the whole card, so it never crosses the place name. */}
                <span className="sa-card__img"><GarmentThumb item={it} photos={photos} w={88} h={70} />{on && <PenCircle />}</span>
                <span className="sa-card__name">{it.name}</span>
                {placeName(it.locationId) && <span className="sa-card__place">{placeName(it.locationId)}</span>}
                {on && <span className="sr-only">{t('dressup.onYouNow')}</span>}
              </button>
            );
          })}
        </div>
      )}

      {current && (
        <section className="sa__bar paper-edge" aria-label={t('dressup.chosen')}>
          <GarmentThumb item={current} photos={photos} w={56} h={50} />
          <div className="sa__bar-text">
            <span className="sa__bar-name">{current.name}</span>
            <span className="sa__bar-note">
              {isWorn(draft, current.id)
                ? (placeName(current.locationId) ? t('dressup.onYouAt', { place: placeName(current.locationId)! }) : t('dressup.onYouNow'))
                : placeName(current.locationId) ? t('dressup.from', { place: placeName(current.locationId)! }) : ''}
            </span>
          </div>
          {isWorn(draft, current.id)
            ? <button type="button" className="btn btn--secondary" disabled={done.busy} onClick={() => void done.run((d) => takeOff(d, current.id))}>{t('dressup.takeOff')}</button>
            : <button type="button" className="btn btn--primary" disabled={done.busy} onClick={() => void done.run((d) => putOn(d, current))}>{t('dressup.putOn')}</button>}
        </section>
      )}

      {picking && (
        <Sheet onClose={() => setPicking(null)} label={t(`dressup.filter.${picking}`)}>
          <h2 className="h2 sa__pick-head">{t(`dressup.filter.${picking}`)}</h2>
          <ul className="sa__pick">
            {picking === 'season' && SEASONS.map((s) => (
              <li key={s}><Chip onClick={() => { setSeason(s); setPicking(null); }}>{t(`season.${s}`)}</Chip></li>
            ))}
            {picking === 'colour' && colours.map((c) => (
              <li key={c}><Chip onClick={() => { setColour(c); setPicking(null); }}>{t(`colour.${c}`)}</Chip></li>
            ))}
            {picking === 'place' && (places ?? []).filter((p) => inSlot.some((i) => i.locationId === p.id)).map((p) => (
              <li key={p.id}><Chip onClick={() => { setPlace(p.id); setPicking(null); }}>{p.name}</Chip></li>
            ))}
          </ul>
        </Sheet>
      )}
    </div>
  );
}
