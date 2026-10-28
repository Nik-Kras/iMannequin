// Body zones, layers and categories (PRD §5, D17, D24, D34). Names live in i18n under `cat.<id>`.
import type { AnchorGroup, CategoryId, Layer, Slot, Zone } from './types';

export interface CategoryDef {
  id: CategoryId;
  zone: Zone;
  layer?: Layer;
  /** The slot the item occupies on the mannequin; accessories have none. */
  slot?: Slot;
  group: AnchorGroup;
  /** English prompt for zero-shot classification ("a photo of …"). */
  prompt: string;
}

const C = (id: CategoryId, zone: Zone, slot: Slot | undefined, group: AnchorGroup, prompt: string, layer?: Layer): CategoryDef => ({ id, zone, slot, group, prompt, layer });

export const CATEGORIES: CategoryDef[] = [
  C('tshirt', 'torso', 'base', 'top', 'a t-shirt', 'base'),
  C('top', 'torso', 'base', 'top', 'a sleeveless top', 'base'),
  C('shirt', 'torso', 'base', 'top', 'a button-up shirt', 'base'),
  C('blouse', 'torso', 'base', 'top', 'a blouse', 'base'),
  C('swimtop', 'torso', 'base', 'top', 'a bikini top', 'base'),
  C('sweater', 'torso', 'mid', 'top', 'a knitted sweater', 'mid'),
  C('hoodie', 'torso', 'mid', 'top', 'a hoodie', 'mid'),
  C('cardigan', 'torso', 'mid', 'top', 'a cardigan', 'mid'),
  C('jacket', 'torso', 'outer', 'top', 'a jacket', 'outer'),
  C('coat', 'torso', 'outer', 'top', 'a long coat', 'outer'),
  C('blazer', 'torso', 'outer', 'top', 'a blazer', 'outer'),
  C('dress', 'full', 'full', 'top', 'a dress', 'base'),
  C('jumpsuit', 'full', 'full', 'top', 'a jumpsuit', 'base'),
  C('swimsuit', 'full', 'full', 'top', 'a one-piece swimsuit', 'base'),
  C('trousers', 'legs', 'legs', 'bottom', 'a pair of trousers'),
  C('jeans', 'legs', 'legs', 'bottom', 'a pair of jeans'),
  C('shorts', 'legs', 'legs', 'bottom', 'a pair of shorts'),
  C('skirt', 'legs', 'legs', 'skirt', 'a skirt'),
  C('leggings', 'legs', 'legs', 'bottom', 'a pair of leggings'),
  C('swimshorts', 'legs', 'legs', 'bottom', 'a pair of swim shorts'),
  C('sneakers', 'feet', 'feet', 'shoes', 'a pair of sneakers'),
  C('shoes', 'feet', 'feet', 'shoes', 'a pair of shoes'),
  C('boots', 'feet', 'feet', 'shoes', 'a pair of boots'),
  C('sandals', 'feet', 'feet', 'shoes', 'a pair of sandals'),
  C('hat', 'head', 'head', 'hat', 'a hat'),
  C('cap', 'head', 'head', 'hat', 'a baseball cap'),
  C('scarf', 'neck', 'neck', 'scarf', 'a scarf'),
  C('tie', 'neck', 'neck', 'tie', 'a necktie'),
  C('gloves', 'hands', 'hands', 'gloves', 'a pair of gloves'),
  C('bag', 'acc', undefined, 'bag', 'a bag'),
  C('belt', 'acc', undefined, 'belt', 'a belt'),
  C('glasses', 'acc', undefined, 'glasses', 'a pair of glasses'),
  C('jewellery', 'acc', undefined, 'jewellery', 'a piece of jewellery'),
];

export const CATEGORY: Record<CategoryId, CategoryDef> = Object.fromEntries(CATEGORIES.map((c) => [c.id, c])) as Record<CategoryId, CategoryDef>;

/** Categories that can go in a slot. `base` and `legs` also accept full-body pieces (they clear each other). */
export function categoriesForSlot(slot: Slot | 'acc'): CategoryDef[] {
  if (slot === 'acc') return CATEGORIES.filter((c) => c.zone === 'acc');
  if (slot === 'base' || slot === 'legs') return CATEGORIES.filter((c) => c.slot === slot || c.slot === 'full');
  return CATEGORIES.filter((c) => c.slot === slot);
}

/** Dress-up slot column, top to bottom (D31). `top` groups base/mid/outer. */
export const DRESSUP_SLOTS = ['head', 'neck', 'top', 'hands', 'legs', 'feet'] as const;
export type DressupSlot = (typeof DRESSUP_SLOTS)[number];

/** Drawing order on the mannequin, bottom to top (try-on §6). */
export function layerOrder(params: {
  slots: Partial<Record<Slot, string>>;
  accessories: { id: string; category: CategoryId }[];
  categoryOf: (itemId: string) => CategoryId | undefined;
  tuckIn: boolean;
  intoBoots: boolean;
}): string[] {
  const { slots, accessories, categoryOf, tuckIn, intoBoots } = params;
  const out: string[] = [];
  const push = (id?: string) => { if (id) out.push(id); };
  const legs = slots.legs;
  const legsIsLeggings = legs ? categoryOf(legs) === 'leggings' : false;
  if (legsIsLeggings) push(legs);
  if (tuckIn) push(slots.base);
  if (!intoBoots) push(slots.feet);
  if (!legsIsLeggings) push(legs);
  if (intoBoots) push(slots.feet);
  if (!tuckIn) push(slots.base);
  push(slots.full);
  const neck = slots.neck;
  const neckIsTie = neck ? categoryOf(neck) === 'tie' : false;
  if (neckIsTie) push(neck);
  for (const a of accessories) if (a.category === 'belt') push(a.id);
  push(slots.mid);
  push(slots.outer);
  if (!neckIsTie) push(neck);
  push(slots.hands);
  for (const a of accessories) if (a.category === 'bag' || a.category === 'jewellery') push(a.id);
  push(slots.head);
  for (const a of accessories) if (a.category === 'glasses') push(a.id);
  return out;
}

/** Putting an item in a slot, with the dress rule (try-on §6): a full-body piece clears base and legs, and vice versa. */
export function placeItem(slots: Partial<Record<Slot, string>>, slot: Slot, itemId: string | undefined): Partial<Record<Slot, string>> {
  const next = { ...slots };
  if (!itemId) {
    delete next[slot];
    return next;
  }
  next[slot] = itemId;
  if (slot === 'full') { delete next.base; delete next.legs; }
  if (slot === 'base' || slot === 'legs') delete next.full;
  return next;
}
