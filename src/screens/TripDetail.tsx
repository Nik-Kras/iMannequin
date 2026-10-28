// F14: one trip's packing list, grouped by storage place so packing is one walk round the flat (board TripChecklist.dc.html, D45).
import '../styles/life.css';
import { useState } from 'react';
import { db, newId } from '../data/db';
import { useActiveItems, useLocations } from '../data/repo';
import { useI18n } from '../i18n';
import { goBack } from '../app/router';
import { Empty, Header, ProgressBar, Sheet } from '../ui/parts';
import { Icon } from '../ui/icons';
import type { Item, Outfit, Trip } from '../domain/types';
import { useById, useItemsById, useOutfits, useTrip } from '../life/hooks';
import { checklist, outfitPieceIds, setTripItem, setTripOutfit, togglePacked, tripOutfitIds } from '../life/trips';
import { byCategory, draftFromOutfit } from '../life/wardrobe';
import { ConfirmSheet, LIcon, MiniMannequin, nbHyphen, PieceImg, SheetHead } from '../life/ui';
import { TripForm, updateTrip, useDueLabel, useTripDates } from '../life/tripParts';

const TAG_TILTS = [-1, 0.8, -0.7, 1];
const STAMP_TILTS = [-9, -6, -11, -7, -8];
const LOOK_TILTS = [-0.6, 0.5, -0.3, 0.4];

type Panel = 'outfits' | 'pieces' | 'menu' | 'edit' | 'delete' | undefined;

export default function TripDetail({ tripId }: { tripId?: string }) {
  const { t } = useI18n();
  const trip = useTrip(tripId);
  const outfits = useOutfits();
  const outfitsById = useById(outfits);
  const items = useItemsById();
  const locations = useLocations();
  const due = useDueLabel();
  const dates = useTripDates();
  const [panel, setPanel] = useState<Panel>();

  if (trip === null) {
    return (
      <div className="screen screen--no-tabs">
        <Header back="/trips" backLabel={t('tab.trips')} />
        <Empty icon="trips">{t('trips.notFound')}</Empty>
      </div>
    );
  }
  if (!trip || !items || !locations) return <div className="screen screen--no-tabs" />;

  const list = checklist(trip, outfitsById, items, locations);
  const looks = tripOutfitIds(trip).map((id) => outfitsById.get(id)).filter((o): o is Outfit => !!o);
  const left = list.total - list.packed;

  return (
    <div className="screen screen--no-tabs trip">
      <Header back="/trips" backLabel={t('tab.trips')}
        actions={(
          <button type="button" className="icon-btn" aria-label={t('trips.menu')} onClick={() => setPanel('menu')}><LIcon name="dots" size={20} /></button>
        )} />
      <div className="pad stack gap-4">
        <h1 className="h1">{trip.name}</h1>
        <p className="trip__meta">{dates(trip)}{trip.archived ? '' : ` · ${due(trip)}`}</p>
      </div>

      {list.total > 0 && (
        <div className="pad stack gap-8 trip__progress">
          <div className="trip__count">
            <span className="trip__packed" aria-live="polite">{t('trips.packed', { packed: list.packed, total: list.total })}</span>
            <span className="trip__left">{left === 0 ? t('trips.ready') : t('trips.toGo', { n: left })}</span>
          </div>
          <ProgressBar value={list.packed / list.total} label={t('trips.packedLabel')} />
          <p className="trip__hint">{t('trips.hint')}</p>
        </div>
      )}

      <h2 className="title-card pad trip__h">{t('tab.outfits')}</h2>
      <ul className="hscroll trip__looks">
        {looks.map((o, i) => (
          <li key={o.id} className="card trip-look" style={{ transform: `rotate(${LOOK_TILTS[i % 4]}deg)` }}>
            <MiniMannequin draft={draftFromOutfit(o)} height={88} />
            <span className="trip-look__name">{o.name}</span>
          </li>
        ))}
        <li className="trip__add-look">
          <button type="button" className="dashed-slot" aria-label={t('trips.addOutfit')} onClick={() => setPanel('outfits')}>
            <Icon name="plus" size={22} strokeWidth={2} />
          </button>
        </li>
      </ul>

      {list.total === 0 && <p className="pad body life-muted trip__empty">{t('trips.emptyTrip')}</p>}

      <div className="stack gap-12 trip__groups">
        {list.groups.map((g, gi) => (
          <section key={g.location?.id ?? 'none'} className="stack gap-8" aria-label={g.location?.name ?? t('trips.noPlace')}>
            <div className="trip-group__head">
              <span className="tag" style={{ transform: `rotate(${TAG_TILTS[gi % 4]}deg)` }}>{g.location?.name ?? t('trips.noPlace')}</span>
              <span className="trip-group__count">{g.packed === g.pieces.length ? t('trips.allPacked') : t('trips.groupCount', { packed: g.packed, total: g.pieces.length })}</span>
            </div>
            <ul className="trip-grid">
              {g.pieces.map(({ item, packed }, i) => (
                <li key={item.id}>
                  <button type="button" className={`trip-piece${packed ? ' trip-piece--packed' : ''}`} aria-pressed={packed}
                    aria-label={t(packed ? 'trips.piecePacked' : 'trips.pieceNotPacked', { name: item.name })}
                    onClick={() => void updateTrip(trip.id, (cur) => togglePacked(cur, item.id, outfitsById, newId))}>
                    <span className="trip-piece__img"><PieceImg item={item} size={44} /></span>
                    <span className="trip-piece__name">{nbHyphen(item.name)}</span>
                    {packed && <span className={`trip-piece__stamp${t('trips.stamp').length > 7 ? ' trip-piece__stamp--long' : ''}`} style={{ transform: `translateX(-50%) rotate(${STAMP_TILTS[i % 5]}deg)` }} aria-hidden="true">{t('trips.stamp')}</span>}
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>

      <div className="pad trip__add-pieces">
        <button type="button" className="btn btn--block trip__dashed" onClick={() => setPanel('pieces')}>
          <Icon name="plus" size={20} strokeWidth={2} />{t('trips.addPieces')}
        </button>
      </div>

      {panel === 'outfits' && <OutfitPicker trip={trip} outfits={outfits ?? []} outfitsById={outfitsById} onClose={() => setPanel(undefined)} />}
      {panel === 'pieces' && <PiecePicker trip={trip} outfitsById={outfitsById} onClose={() => setPanel(undefined)} />}
      {panel === 'menu' && (
        <Sheet onClose={() => setPanel(undefined)} label={t('trips.menu')}>
          <div className="life-sheet">
            <SheetHead title={trip.name} onClose={() => setPanel(undefined)} />
            <div className="card list life-menu">
              <button type="button" className="list-row" onClick={() => setPanel('edit')}>
                <Icon name="calendar" />{t('trips.edit')}
              </button>
              <button type="button" className="list-row" onClick={() => { void updateTrip(trip.id, (cur) => ({ ...cur, archived: !cur.archived })); setPanel(undefined); }}>
                <Icon name="check" />{trip.archived ? t('trips.unarchive') : t('trips.archive')}
              </button>
              <button type="button" className="list-row life-menu__danger" onClick={() => setPanel('delete')}>
                <Icon name="trash" />{t('trips.delete')}
              </button>
            </div>
          </div>
        </Sheet>
      )}
      {panel === 'edit' && <TripForm trip={trip} onClose={() => setPanel(undefined)} onDone={() => setPanel(undefined)} />}
      {panel === 'delete' && (
        <ConfirmSheet title={t('trips.delete')} text={t('trips.deleteConfirm', { name: trip.name })} confirm={t('action.delete')} danger
          onClose={() => setPanel(undefined)} onConfirm={() => void db.trips.delete(trip.id).then(() => goBack('/trips'))} />
      )}
    </div>
  );
}

function OutfitPicker({ trip, outfits, outfitsById, onClose }: { trip: Trip; outfits: Outfit[]; outfitsById: Map<string, Outfit>; onClose: () => void }) {
  const { t } = useI18n();
  const on = new Set(tripOutfitIds(trip));
  const toggle = (o: Outfit) => updateTrip(trip.id, (cur) => setTripOutfit(cur, o.id, !tripOutfitIds(cur).includes(o.id), outfitsById, newId));
  return (
    <Sheet onClose={onClose} label={t('trips.pickOutfits')}>
      <div className="life-sheet">
        <SheetHead title={t('trips.pickOutfits')} onClose={onClose} />
        {outfits.length === 0 ? <p className="body life-muted">{t('trips.noOutfits')}</p> : (
          <ul className="picker picker--looks">
            {outfits.map((o) => (
              <li key={o.id}>
                <button type="button" className="picker__cell" aria-pressed={on.has(o.id)} onClick={() => void toggle(o)}>
                  <MiniMannequin draft={draftFromOutfit(o)} height={96} />
                  <span className="picker__look-name">{o.name}</span>
                  {on.has(o.id) && <span className="picker__check" aria-hidden="true"><Icon name="check" size={16} strokeWidth={2.4} /></span>}
                </button>
              </li>
            ))}
          </ul>
        )}
        <button type="button" className="btn btn--primary btn--block" onClick={onClose}>{t('action.done')}</button>
      </div>
    </Sheet>
  );
}

function PiecePicker({ trip, outfitsById, onClose }: { trip: Trip; outfitsById: Map<string, Outfit>; onClose: () => void }) {
  const { t } = useI18n();
  const active = useActiveItems();
  const fromOutfits = outfitPieceIds(trip, outfitsById);
  const singles = new Set(trip.entries.filter((e) => e.kind === 'item').map((e) => e.refId));
  const sorted = [...(active ?? [])].sort(byCategory);
  const toggle = (item: Item) => updateTrip(trip.id, (cur) => setTripItem(cur, item.id, !cur.entries.some((e) => e.kind === 'item' && e.refId === item.id), newId));
  return (
    <Sheet onClose={onClose} label={t('trips.pickPieces')}>
      <div className="life-sheet">
        <SheetHead title={t('trips.pickPieces')} onClose={onClose} />
        <ul className="picker picker--pieces">
          {sorted.map((item) => {
            const locked = fromOutfits.has(item.id);
            const on = locked || singles.has(item.id);
            return (
              <li key={item.id}>
                <button type="button" className="picker__cell" aria-pressed={on} disabled={locked} onClick={() => void toggle(item)}>
                  <span className="picker__img"><PieceImg item={item} size={44} /></span>
                  <span className="picker__name">{nbHyphen(item.name)}</span>
                  {locked && <span className="picker__sub">{t('trips.inOutfit')}</span>}
                  {on && <span className="picker__check" aria-hidden="true"><Icon name="check" size={16} strokeWidth={2.4} /></span>}
                </button>
              </li>
            );
          })}
        </ul>
        <button type="button" className="btn btn--primary btn--block" onClick={onClose}>{t('action.done')}</button>
      </div>
    </Sheet>
  );
}
