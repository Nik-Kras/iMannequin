import { describe, expect, it } from 'vitest';
import type { Item, Location, Outfit, Trip } from '../../src/domain/types';
import { checklist, setTripItem, setTripOutfit, splitTrips, togglePacked, tripDays, tripItemIds, tripPhase } from '../../src/life/trips';

let n = 0;
const id = () => `e${++n}`;
const item = (id: string, category: Item['category'], locationId?: string): Item => ({
  id, name: id, category, colours: [], seasons: [], locationId, status: 'active', createdAt: 0, updatedAt: 0,
});
const items = new Map([
  item('coat', 'coat', 'hall'), item('jeans', 'jeans', 'wardrobe'), item('tee', 'tshirt', 'drawers'),
  item('boots', 'boots', 'hall'), item('dress', 'dress', 'wardrobe'), item('tote', 'bag'), item('scarf', 'scarf', 'gone'),
].map((i) => [i.id, i]));
const locations: Location[] = [
  { id: 'hall', name: 'Hallway rack', order: 2 },
  { id: 'wardrobe', name: 'Wardrobe', order: 0 },
  { id: 'drawers', name: 'Chest of drawers', order: 1 },
];
const outfit = (id: string, slots: Outfit['slots'], accessories: string[] = []): Outfit => ({
  id, name: id, slots, accessories, toggles: { tuckIn: false, intoBoots: false }, createdAt: 0, updatedAt: 0,
});
const outfits = new Map([
  outfit('walk', { outer: 'coat', base: 'tee', legs: 'jeans', feet: 'boots' }),
  outfit('dinner', { full: 'dress', feet: 'boots' }, ['tote']),
].map((o) => [o.id, o]));
const empty: Trip = { id: 't', name: 'Sea', start: '2026-11-14', end: '2026-11-16', entries: [], archived: false, createdAt: 0 };

describe('trip checklist', () => {
  it('lists each piece once, grouped by storage place in place order, unplaced last', () => {
    let trip = setTripOutfit(empty, 'walk', true, outfits, id);
    trip = setTripOutfit(trip, 'dinner', true, outfits, id);
    trip = setTripItem(trip, 'scarf', true, id);
    expect(tripItemIds(trip, outfits).sort()).toEqual(['boots', 'coat', 'dress', 'jeans', 'scarf', 'tee', 'tote']);
    const c = checklist(trip, outfits, items, locations);
    expect(c.groups.map((g) => g.location?.id)).toEqual(['wardrobe', 'drawers', 'hall', undefined]);
    expect(c.groups[0].pieces.map((p) => p.item.id)).toEqual(['dress', 'jeans']);
    expect(c.groups[2].pieces.map((p) => p.item.id)).toEqual(['coat', 'boots']);
    // A piece whose place was deleted, and a piece with no place, are both "no place".
    expect(c.groups[3].pieces.map((p) => p.item.id).sort()).toEqual(['scarf', 'tote']);
    expect(c.total).toBe(7);
    expect(c.packed).toBe(0);
  });

  it('ticks pieces, counts progress per group and overall', () => {
    let trip = setTripOutfit(empty, 'walk', true, outfits, id);
    trip = togglePacked(trip, 'coat', outfits, id);
    trip = togglePacked(trip, 'boots', outfits, id);
    let c = checklist(trip, outfits, items, locations);
    expect(c.packed).toBe(2);
    expect(c.total).toBe(4);
    expect(c.groups.find((g) => g.location?.id === 'hall')?.packed).toBe(2);
    // Unticking an outfit piece leaves no stray single-item entry behind.
    trip = togglePacked(trip, 'coat', outfits, id);
    c = checklist(trip, outfits, items, locations);
    expect(c.packed).toBe(1);
    expect(trip.entries.filter((e) => e.kind === 'item').map((e) => e.refId)).toEqual(['boots']);
  });

  it('keeps single pieces on the list when unticked', () => {
    let trip = setTripItem(empty, 'tote', true, id);
    trip = togglePacked(trip, 'tote', outfits, id);
    expect(checklist(trip, outfits, items, locations).packed).toBe(1);
    trip = togglePacked(trip, 'tote', outfits, id);
    const c = checklist(trip, outfits, items, locations);
    expect(c.total).toBe(1);
    expect(c.packed).toBe(0);
  });

  it('removing an outfit drops only the pieces no other outfit needs', () => {
    let trip = setTripOutfit(empty, 'walk', true, outfits, id);
    trip = setTripOutfit(trip, 'dinner', true, outfits, id);
    trip = togglePacked(trip, 'boots', outfits, id);
    trip = togglePacked(trip, 'coat', outfits, id);
    trip = setTripOutfit(trip, 'walk', false, outfits, id);
    expect(tripItemIds(trip, outfits).sort()).toEqual(['boots', 'dress', 'tote']);
    // Boots are still needed for dinner and stay packed.
    expect(checklist(trip, outfits, items, locations).packed).toBe(1);
  });

  it('skips deleted items and adding twice is a no-op', () => {
    let trip = setTripItem(empty, 'ghost', true, id);
    trip = setTripItem(trip, 'tote', true, id);
    trip = setTripItem(trip, 'tote', true, id);
    expect(trip.entries).toHaveLength(2);
    expect(checklist(trip, outfits, items, locations).total).toBe(1);
  });
});

describe('trip phases', () => {
  const t = (start: string, end: string, archived = false): Trip => ({ ...empty, id: start, start, end, archived });
  it('splits upcoming (soonest first) from past (latest first)', () => {
    const today = '2026-10-28';
    expect(tripPhase(t('2026-10-27', '2026-10-29'), today)).toBe('ongoing');
    expect(tripPhase(t('2026-11-01', '2026-11-02', true), today)).toBe('past');
    const { upcoming, past } = splitTrips([t('2026-12-02', '2026-12-05'), t('2026-10-03', '2026-10-06'), t('2026-11-14', '2026-11-16'), t('2026-09-01', '2026-09-02')], today);
    expect(upcoming.map((x) => x.start)).toEqual(['2026-11-14', '2026-12-02']);
    expect(past.map((x) => x.start)).toEqual(['2026-10-03', '2026-09-01']);
  });
  it('counts days inclusively', () => {
    expect(tripDays({ start: '2026-11-14', end: '2026-11-16' })).toBe(3);
    expect(tripDays({ start: '2026-10-24', end: '2026-10-26' })).toBe(3); // across the clock change
  });
});
