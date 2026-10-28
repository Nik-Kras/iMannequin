// Packing lists (F14, D45). A trip holds outfits and single pieces; the checklist is every distinct piece,
// grouped by where it is stored so packing is one walk round the flat.
//
// Storage in Trip.entries:
// - { kind: 'outfit' } entries are the outfits on the trip.
// - { kind: 'item' } entries are single pieces added on their own, and the packed flag of any piece. A piece that
//   comes from an outfit gets an item entry only once it is packed.
import type { Item, Location, Outfit, Trip, TripEntry } from '../domain/types';
import { byCategory, outfitItemIds } from './wardrobe';
import { daysBetween } from './calendar';

type Ids = () => string;

export function tripOutfitIds(trip: Trip): string[] {
  return trip.entries.filter((e) => e.kind === 'outfit').map((e) => e.refId);
}

/** Pieces that come from the trip's outfits. */
export function outfitPieceIds(trip: Trip, outfits: Map<string, Outfit>, exceptOutfitId?: string): Set<string> {
  const ids = new Set<string>();
  for (const oid of tripOutfitIds(trip)) {
    if (oid === exceptOutfitId) continue;
    const o = outfits.get(oid);
    if (o) for (const id of outfitItemIds(o)) ids.add(id);
  }
  return ids;
}

/** Every distinct piece on the checklist (outfit pieces first, then single pieces). */
export function tripItemIds(trip: Trip, outfits: Map<string, Outfit>): string[] {
  const ids = [...outfitPieceIds(trip, outfits)];
  for (const e of trip.entries) if (e.kind === 'item' && !ids.includes(e.refId)) ids.push(e.refId);
  return ids;
}

export function isPacked(trip: Trip, itemId: string): boolean {
  return trip.entries.some((e) => e.kind === 'item' && e.refId === itemId && e.packed);
}

export interface ChecklistGroup {
  /** Undefined for pieces without a storage place. */
  location?: Location;
  pieces: { item: Item; packed: boolean }[];
  packed: number;
}

export interface Checklist { groups: ChecklistGroup[]; packed: number; total: number }

/** The checklist grouped by storage place, in the user's place order; pieces without a place come last. */
export function checklist(trip: Trip, outfits: Map<string, Outfit>, items: Map<string, Item>, locations: Location[]): Checklist {
  const pieces = tripItemIds(trip, outfits).map((id) => items.get(id)).filter((x): x is Item => !!x);
  const order = [...locations].sort((a, b) => a.order - b.order);
  const known = new Set(order.map((l) => l.id));
  const groups: ChecklistGroup[] = [];
  const make = (location: Location | undefined, list: Item[]) => {
    if (!list.length) return;
    const ps = [...list].sort(byCategory).map((item) => ({ item, packed: isPacked(trip, item.id) }));
    groups.push({ location, pieces: ps, packed: ps.filter((p) => p.packed).length });
  };
  for (const loc of order) make(loc, pieces.filter((i) => i.locationId === loc.id));
  make(undefined, pieces.filter((i) => !i.locationId || !known.has(i.locationId)));
  const total = pieces.length;
  const packed = groups.reduce((s, g) => s + g.packed, 0);
  return { groups, packed, total };
}

/** Tick or untick a piece. */
export function togglePacked(trip: Trip, itemId: string, outfits: Map<string, Outfit>, newId: Ids): Trip {
  const entry = trip.entries.find((e) => e.kind === 'item' && e.refId === itemId);
  let entries: TripEntry[];
  if (!entry) entries = [...trip.entries, { id: newId(), kind: 'item', refId: itemId, packed: true }];
  else if (!entry.packed) entries = trip.entries.map((e) => (e === entry ? { ...e, packed: true } : e));
  else if (outfitPieceIds(trip, outfits).has(itemId)) entries = trip.entries.filter((e) => e !== entry);
  else entries = trip.entries.map((e) => (e === entry ? { ...e, packed: false } : e));
  return { ...trip, entries };
}

/** Add or remove an outfit. Removing it also drops the pieces only that outfit brought. */
export function setTripOutfit(trip: Trip, outfitId: string, on: boolean, outfits: Map<string, Outfit>, newId: Ids): Trip {
  const has = trip.entries.some((e) => e.kind === 'outfit' && e.refId === outfitId);
  if (on) return has ? trip : { ...trip, entries: [...trip.entries, { id: newId(), kind: 'outfit', refId: outfitId, packed: false }] };
  if (!has) return trip;
  const o = outfits.get(outfitId);
  const others = outfitPieceIds(trip, outfits, outfitId);
  const brought = new Set(o ? outfitItemIds(o).filter((id) => !others.has(id)) : []);
  return {
    ...trip,
    entries: trip.entries.filter((e) => !(e.kind === 'outfit' && e.refId === outfitId) && !(e.kind === 'item' && brought.has(e.refId))),
  };
}

/** Add or remove a single piece. Pieces that come from an outfit are managed through the outfit. */
export function setTripItem(trip: Trip, itemId: string, on: boolean, newId: Ids): Trip {
  const has = trip.entries.some((e) => e.kind === 'item' && e.refId === itemId);
  if (on) return has ? trip : { ...trip, entries: [...trip.entries, { id: newId(), kind: 'item', refId: itemId, packed: false }] };
  return { ...trip, entries: trip.entries.filter((e) => !(e.kind === 'item' && e.refId === itemId)) };
}

export type TripPhase = 'upcoming' | 'ongoing' | 'past';

export function tripPhase(trip: Trip, today: string): TripPhase {
  if (trip.archived || trip.end < today) return 'past';
  if (trip.start <= today) return 'ongoing';
  return 'upcoming';
}

/** Upcoming and ongoing trips soonest first; past (ended or archived) trips most recent first. */
export function splitTrips(trips: Trip[], today: string): { upcoming: Trip[]; past: Trip[] } {
  const upcoming = trips.filter((t) => tripPhase(t, today) !== 'past').sort((a, b) => a.start.localeCompare(b.start));
  const past = trips.filter((t) => tripPhase(t, today) === 'past').sort((a, b) => b.end.localeCompare(a.end));
  return { upcoming, past };
}

export const tripDays = (trip: Pick<Trip, 'start' | 'end'>): number => daysBetween(trip.start, trip.end) + 1;

/** Removes a deleted outfit from every trip's entries (pieces it brought go too). */
export function withoutOutfit(trip: Trip, outfitId: string, outfits: Map<string, Outfit>): Trip {
  return setTripOutfit(trip, outfitId, false, outfits, () => '');
}
