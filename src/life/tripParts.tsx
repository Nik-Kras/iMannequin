// Parts shared by the Trips list and a trip's checklist.
import { useState } from 'react';
import { db, newId } from '../data/db';
import { todayISO } from '../data/repo';
import { useI18n } from '../i18n';
import { Sheet } from '../ui/parts';
import type { Trip } from '../domain/types';
import { daysBetween, formatRange } from './calendar';
import { tripDays, tripPhase } from './trips';
import { SheetHead } from './ui';

/** Changes a trip from its latest stored state, so quick taps never overwrite each other. */
export function updateTrip(id: string, change: (trip: Trip) => Trip): Promise<void> {
  return db.transaction('rw', db.trips, async () => {
    const cur = await db.trips.get(id);
    if (cur) await db.trips.put(change(cur));
  });
}

/** "in 17 days", "tomorrow", "today", "on the trip". */
export function useDueLabel(): (trip: Trip) => string {
  const { t, tn } = useI18n();
  return (trip) => {
    const today = todayISO();
    if (tripPhase(trip, today) === 'ongoing') return trip.start === today ? t('trips.today') : t('trips.ongoing');
    const n = daysBetween(today, trip.start);
    if (n === 1) return t('trips.tomorrow');
    return tn('trips.inDays', n);
  };
}

/** "14–16 Nov · 3 days". */
export function useTripDates(): (trip: Trip) => string {
  const { lang, tn } = useI18n();
  return (trip) => `${formatRange(trip.start, trip.end, lang)} · ${tn('trips.days', tripDays(trip))}`;
}

/** Create a trip, or edit its name and dates. Calls `onDone` with the saved trip's id. */
export function TripForm({ trip, onClose, onDone }: { trip?: Trip; onClose: () => void; onDone: (id: string) => void }) {
  const { t } = useI18n();
  const today = todayISO();
  const [name, setName] = useState(trip?.name ?? '');
  const [start, setStart] = useState(trip?.start ?? today);
  const [end, setEnd] = useState(trip?.end ?? today);
  const valid = name.trim().length > 0 && !!start && !!end;
  const submit = async () => {
    if (!valid) return;
    const s = start <= end ? start : end;
    const e = start <= end ? end : start;
    const saved: Trip = trip
      ? { ...trip, name: name.trim(), start: s, end: e }
      : { id: newId(), name: name.trim(), start: s, end: e, entries: [], archived: false, createdAt: Date.now() };
    await db.trips.put(saved);
    onDone(saved.id);
  };
  const title = trip ? t('trips.formEdit') : t('trips.formNew');
  return (
    <Sheet onClose={onClose} label={title}>
      <form className="life-sheet" onSubmit={(ev) => { ev.preventDefault(); void submit(); }}>
        <SheetHead title={title} onClose={onClose} />
        <label className="field">
          <span className="field__label">{t('trips.name')}</span>
          <input className="input" value={name} maxLength={60} placeholder={t('trips.namePlaceholder')} onChange={(ev) => setName(ev.target.value)} autoFocus={!trip} />
        </label>
        <div className="life-pair">
          <label className="field grow">
            <span className="field__label">{t('trips.start')}</span>
            <input className="input" type="date" value={start} onChange={(ev) => { setStart(ev.target.value); if (ev.target.value > end) setEnd(ev.target.value); }} required />
          </label>
          <label className="field grow">
            <span className="field__label">{t('trips.end')}</span>
            <input className="input" type="date" value={end} min={start} onChange={(ev) => setEnd(ev.target.value)} required />
          </label>
        </div>
        <button type="submit" className="btn btn--primary btn--block" disabled={!valid}>{trip ? t('action.save') : t('trips.create')}</button>
      </form>
    </Sheet>
  );
}

/** A luggage-ticket card: notched left end with an eyelet (board Trips.dc.html). */
export function Ticket({ children, tilt = 0, className = '' }: { children: React.ReactNode; tilt?: number; className?: string }) {
  return (
    <div className={`ticket ${className}`} style={{ transform: `rotate(${tilt}deg)` }}>
      <div className="ticket__paper">{children}</div>
      <span className="ticket__eyelet" aria-hidden="true" />
    </div>
  );
}
