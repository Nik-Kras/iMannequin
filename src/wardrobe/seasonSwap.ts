// Seasonal swap (F10): which items to put away when a season ends.
import { SEASONS, type Item, type Season } from '../domain/types';

export function nextSeason(s: Season): Season {
  return SEASONS[(SEASONS.indexOf(s) + 1) % 4];
}

export function previousSeason(s: Season): Season {
  return SEASONS[(SEASONS.indexOf(s) + 3) % 4];
}

/** Meteorological season for a date (northern hemisphere: spring is March to May). */
export function seasonOf(date: Date): Season {
  const m = date.getMonth();
  return m >= 2 && m <= 4 ? 'spring' : m >= 5 && m <= 7 ? 'summer' : m >= 8 && m <= 10 ? 'autumn' : 'winter';
}

/** The season that has just ended is the one to put away. */
export function defaultPutAway(date = new Date()): Season {
  return previousSeason(seasonOf(date));
}

/** Items worn in the season going away, grouped by their current place, then by name. */
export function swapCandidates(items: Item[], season: Season, placeOrder: string[] = []): Item[] {
  const rank = (id?: string) => (id ? placeOrder.indexOf(id) : -1);
  return items
    .filter((it) => it.seasons.includes(season))
    .sort((a, b) => rank(a.locationId) - rank(b.locationId) || a.name.localeCompare(b.name));
}

/**
 * Preselected items: everything for the season going away, except pieces also worn in the next season
 * (they stay at hand) and pieces already in the destination.
 */
export function preselect(items: Item[], season: Season, destId?: string): Set<string> {
  const next = nextSeason(season);
  return new Set(
    items.filter((it) => it.seasons.includes(season) && !it.seasons.includes(next) && (!destId || it.locationId !== destId)).map((it) => it.id),
  );
}

/** Applies the user's taps on top of the preselection. */
export function selection(pre: Set<string>, overrides: Record<string, boolean>, candidates: Item[]): string[] {
  return candidates.filter((it) => overrides[it.id] ?? pre.has(it.id)).map((it) => it.id);
}
