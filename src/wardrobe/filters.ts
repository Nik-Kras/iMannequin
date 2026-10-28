// Wardrobe filters (F5): category groups, colours, seasons, place and "not worn in N months" (D42).
import { CATEGORY } from '../domain/taxonomy';
import type { CategoryId, ColourName, Item, Season } from '../domain/types';

export const CATEGORY_GROUPS = ['tops', 'layers', 'outerwear', 'bottoms', 'dresses', 'shoes', 'accessories'] as const;
export type CategoryGroup = (typeof CATEGORY_GROUPS)[number];

/** Which Wardrobe chip a category falls under. Hats, scarves, gloves, bags and the rest are accessories. */
export function groupOf(category: CategoryId): CategoryGroup {
  const d = CATEGORY[category];
  switch (d.zone) {
    case 'torso': return d.layer === 'mid' ? 'layers' : d.layer === 'outer' ? 'outerwear' : 'tops';
    case 'full': return 'dresses';
    case 'legs': return 'bottoms';
    case 'feet': return 'shoes';
    default: return 'accessories';
  }
}

export interface WardrobeFilter {
  group: CategoryGroup | 'all';
  /** Any of these colours. */
  colours: ColourName[];
  /** Any of these seasons. */
  seasons: Season[];
  /** A place id, 'none' for items without a place, or undefined for every place. */
  place?: string;
  notWorn: boolean;
}

export const EMPTY_FILTER: WardrobeFilter = { group: 'all', colours: [], seasons: [], place: undefined, notWorn: false };

/** The moment N calendar months before `now`. */
export function monthsAgo(months: number, now = Date.now()): number {
  const d = new Date(now);
  d.setMonth(d.getMonth() - months);
  return d.getTime();
}

/** Not worn for N months: last worn before the cut-off, or never worn and added before it. */
export function isNotWorn(item: Item, months: number, now = Date.now()): boolean {
  return (item.lastWornAt ?? item.createdAt) < monthsAgo(months, now);
}

export function matchesFilter(item: Item, f: WardrobeFilter, opts: { notWornMonths: number; now?: number }): boolean {
  if (f.group !== 'all' && groupOf(item.category) !== f.group) return false;
  if (f.colours.length && !item.colours.some((c) => f.colours.includes(c))) return false;
  if (f.seasons.length && !item.seasons.some((s) => f.seasons.includes(s))) return false;
  if (f.place === 'none' ? !!item.locationId : f.place && item.locationId !== f.place) return false;
  if (f.notWorn && !isNotWorn(item, opts.notWornMonths, opts.now)) return false;
  return true;
}

export function applyFilter(items: Item[], f: WardrobeFilter, opts: { notWornMonths: number; now?: number }): Item[] {
  return items.filter((it) => matchesFilter(it, f, opts));
}

export function isFiltered(f: WardrobeFilter): boolean {
  return f.group !== 'all' || f.colours.length > 0 || f.seasons.length > 0 || f.place !== undefined || f.notWorn;
}

/** Brands already used, most used first, for the item form's suggestions. */
export function usedBrands(items: Item[]): string[] {
  const counts = new Map<string, { name: string; n: number }>();
  for (const it of items) {
    const b = it.brand?.trim();
    if (!b) continue;
    const k = b.toLocaleLowerCase();
    const cur = counts.get(k);
    counts.set(k, { name: cur?.name ?? b, n: (cur?.n ?? 0) + 1 });
  }
  return [...counts.values()].sort((a, b) => b.n - a.n || a.name.localeCompare(b.name)).map((x) => x.name);
}
