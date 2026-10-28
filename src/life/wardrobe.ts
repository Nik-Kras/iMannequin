// Wardrobe helpers shared by Outfits, the wear log and trips.
import type { Item, Outfit, OutfitDraft, Slot } from '../domain/types';
import { CATEGORIES, CATEGORY, placeItem } from '../domain/taxonomy';
import { monthsAgo } from './calendar';

/**
 * Items not worn for `months` months, longest-unworn first. A never-worn item counts only once it has been in the
 * wardrobe that long, so clothes added last week are not flagged.
 */
export function notWornItems(items: Item[], months: number, now = Date.now()): Item[] {
  const cutoff = monthsAgo(months, now);
  return items
    .filter((i) => i.status === 'active' && (i.lastWornAt !== undefined ? i.lastWornAt < cutoff : i.createdAt < cutoff))
    .sort((a, b) => (a.lastWornAt ?? 0) - (b.lastWornAt ?? 0) || a.name.localeCompare(b.name));
}

/** A draft that puts these items on the mannequin, each in its category's slot. */
export function draftFromItems(itemIds: string[], itemsById: Map<string, Item>): OutfitDraft {
  let slots: Partial<Record<Slot, string>> = {};
  const accessories: string[] = [];
  for (const id of itemIds) {
    const item = itemsById.get(id);
    if (!item) continue;
    const slot = CATEGORY[item.category]?.slot;
    if (slot) slots = placeItem(slots, slot, id);
    else accessories.push(id);
  }
  return { slots, accessories, toggles: { tuckIn: false, intoBoots: false } };
}

export function draftFromOutfit(o: Outfit): OutfitDraft {
  return { slots: { ...o.slots }, accessories: [...o.accessories], toggles: { ...o.toggles }, outfitId: o.id };
}

/** Every item in an outfit: slots first (top to toe), then accessories. */
export function outfitItemIds(o: Pick<Outfit, 'slots' | 'accessories'>): string[] {
  const order: Slot[] = ['head', 'neck', 'outer', 'mid', 'base', 'full', 'hands', 'legs', 'feet'];
  const ids = order.map((s) => o.slots[s]).filter((x): x is string => !!x);
  for (const a of o.accessories) if (!ids.includes(a)) ids.push(a);
  return ids;
}

/** Short title for an unsaved look: the outermost top (or dress) and the bottoms, e.g. "Rust sweater, blue jeans". */
export function lookTitle(itemIds: string[], itemsById: Map<string, Item>): string {
  const items = itemIds.map((id) => itemsById.get(id)).filter((x): x is Item => !!x);
  const bySlot = (s: Slot) => items.find((i) => CATEGORY[i.category]?.slot === s);
  const top = bySlot('outer') ?? bySlot('mid') ?? bySlot('base') ?? bySlot('full');
  const legs = bySlot('legs');
  const names = [top, legs].filter((x): x is Item => !!x).map((i) => i.name);
  if (!names.length && items[0]) names.push(items[0].name);
  return names.map((n, i) => (i === 0 ? n : n.charAt(0).toLocaleLowerCase() + n.slice(1))).join(', ');
}

const CAT_ORDER = new Map(CATEGORIES.map((c, i) => [c.id, i]));

/** Packing / display order: by category (tops, dresses, bottoms, shoes, then the rest), then name. */
export function byCategory(a: Item, b: Item): number {
  return (CAT_ORDER.get(a.category) ?? 99) - (CAT_ORDER.get(b.category) ?? 99) || a.name.localeCompare(b.name);
}
