// F14: trips with their packing progress (board Trips.dc.html, D45).
import '../styles/life.css';
import { useMemo, useState } from 'react';
import { todayISO, useLocations } from '../data/repo';
import { useI18n } from '../i18n';
import { navigate } from '../app/router';
import { Empty, ProgressBar, Stamp } from '../ui/parts';
import { Icon } from '../ui/icons';
import type { Item, Location, Outfit, Trip } from '../domain/types';
import { useById, useItemsById, useOutfits, useTrips } from '../life/hooks';
import { checklist, splitTrips, tripOutfitIds } from '../life/trips';
import { draftFromOutfit } from '../life/wardrobe';
import { MiniMannequin } from '../life/ui';
import { Ticket, TripForm, useDueLabel, useTripDates } from '../life/tripParts';

const TILTS = [-0.5, 0.4, -0.3, 0.5];

export default function Trips() {
  const { t } = useI18n();
  const trips = useTrips();
  const outfitsById = useById(useOutfits());
  const items = useItemsById();
  const locations = useLocations();
  const [creating, setCreating] = useState(false);
  const { upcoming, past } = useMemo(() => splitTrips(trips ?? [], todayISO()), [trips]);
  const ctx = { outfitsById, items: items ?? new Map<string, Item>(), locations: locations ?? [] };

  return (
    <div className="screen">
      <div className="stack gap-16">
        <div className="header">
          <h1 className="h1">{t('tab.trips')}</h1>
          <button type="button" className="btn btn--primary btn--sm trips__new" onClick={() => setCreating(true)}>
            <Icon name="plus" size={20} strokeWidth={2} />{t('trips.new')}
          </button>
        </div>

        {trips && trips.length === 0 && (
          <Empty icon="trips" action={<button type="button" className="btn btn--primary" onClick={() => setCreating(true)}>{t('trips.new')}</button>}>
            {t('trips.empty')}
          </Empty>
        )}

        {upcoming.length > 0 && (
          <section className="stack gap-12" aria-labelledby="trips-up">
            <h2 id="trips-up" className="title-card pad">{t('trips.upcoming')}</h2>
            <ul className="trips__list">
              {upcoming.map((trip, i) => <li key={trip.id}><TripCard trip={trip} tilt={TILTS[i % 4]} {...ctx} /></li>)}
            </ul>
          </section>
        )}

        {past.length > 0 && (
          <section className="stack gap-12" aria-labelledby="trips-past">
            <h2 id="trips-past" className="title-card pad">{t('trips.past')}</h2>
            <ul className="trips__list">
              {past.map((trip, i) => <li key={trip.id}><TripCard trip={trip} tilt={-TILTS[i % 4]} past {...ctx} /></li>)}
            </ul>
          </section>
        )}
      </div>
      {creating && <TripForm onClose={() => setCreating(false)} onDone={(id) => { setCreating(false); navigate(`/trip/${id}`); }} />}
    </div>
  );
}

function TripCard({ trip, tilt, past, outfitsById, items, locations }: {
  trip: Trip; tilt: number; past?: boolean; outfitsById: Map<string, Outfit>; items: Map<string, Item>; locations: Location[];
}) {
  const { t, tn } = useI18n();
  const due = useDueLabel();
  const dates = useTripDates();
  const list = checklist(trip, outfitsById, items, locations);
  const looks = tripOutfitIds(trip).map((id) => outfitsById.get(id)).filter((o): o is Outfit => !!o);
  const packed = t('trips.packed', { packed: list.packed, total: list.total });
  return (
    <a className="trip-link" href={`#/trip/${trip.id}`} onClick={(e) => { e.preventDefault(); navigate(`/trip/${trip.id}`); }}>
      <Ticket tilt={tilt} className={past ? 'ticket--past' : ''}>
        <div className="trip-card__top">
          <span className="trip-card__name">{trip.name}</span>
          {!past && <span className="trip-card__due">{due(trip)}</span>}
        </div>
        <span className="trip-card__meta">
          {dates(trip)} · {past ? t('trips.packedMeta', { packed: list.packed, total: list.total }) : looks.length ? tn('trips.outfits', looks.length) : tn('count.items', list.total)}
        </span>
        {!past && looks.length > 0 && (
          <span className="trip-card__looks" aria-hidden="true">
            {looks.slice(0, 5).map((o) => <span key={o.id} className="trip-card__look inset"><MiniMannequin draft={draftFromOutfit(o)} height={68} /></span>)}
          </span>
        )}
        {!past && list.total > 0 && (
          <span className="stack gap-4 trip-card__progress">
            <span className="trip-card__packed">{packed}</span>
            <ProgressBar value={list.packed / list.total} label={t('trips.packedLabel')} />
          </span>
        )}
        {past && <span className="trip-card__stamp"><Stamp>{t('trips.done')}</Stamp></span>}
      </Ticket>
    </a>
  );
}
