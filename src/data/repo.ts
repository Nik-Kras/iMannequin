// Shared reads and writes. Feature modules add their own helpers next to their screens.
import { useLiveQuery } from 'dexie-react-hooks';
import { db, DEFAULT_PLACES, getSettings, newId, updateSettings } from './db';
import type { AppSettings, Item, Location, OutfitDraft, Photo, Slot } from '../domain/types';
import { CATEGORY, placeItem } from '../domain/taxonomy';
import { translate } from '../i18n';

export function useSettings(): AppSettings | undefined {
  return useLiveQuery(() => getSettings(), []);
}

export function useActiveItems(): Item[] | undefined {
  return useLiveQuery(() => db.items.where('status').equals('active').toArray(), []);
}

export function useReviewItems(): Item[] | undefined {
  return useLiveQuery(() => db.items.where('status').equals('review').sortBy('createdAt'), []);
}

export function useItem(id?: string): Item | undefined {
  return useLiveQuery(() => (id ? db.items.get(id) : undefined), [id]);
}

export function usePhoto(id?: string): Photo | undefined {
  return useLiveQuery(() => (id ? db.photos.get(id) : undefined), [id]);
}

export function useLocations(): Location[] | undefined {
  return useLiveQuery(() => db.locations.orderBy('order').toArray(), []);
}

/** First run: create the default storage places in the user's language (D22). */
export async function ensureDefaultPlaces(lang: AppSettings['lang']): Promise<void> {
  if ((await db.locations.count()) > 0) return;
  await db.locations.bulkAdd(DEFAULT_PLACES.map((key, i) => ({ id: newId(), name: translate(lang, key), order: i })));
}

export async function saveItem(item: Item): Promise<void> {
  await db.items.put({ ...item, updatedAt: Date.now() });
}

/** Deletes an item, its photos, and removes it from outfits, the draft and trips. */
export async function deleteItem(id: string): Promise<void> {
  await db.transaction('rw', [db.items, db.photos, db.outfits, db.trips, db.settings], async () => {
    await db.photos.where('itemId').equals(id).delete();
    await db.items.delete(id);
    const outfits = await db.outfits.toArray();
    for (const o of outfits) {
      const slots = Object.fromEntries(Object.entries(o.slots).filter(([, v]) => v !== id));
      const accessories = o.accessories.filter((a) => a !== id);
      if (accessories.length !== o.accessories.length || Object.keys(slots).length !== Object.keys(o.slots).length) {
        await db.outfits.put({ ...o, slots, accessories, updatedAt: Date.now() });
      }
    }
    const trips = await db.trips.toArray();
    for (const t of trips) {
      const entries = t.entries.filter((e) => !(e.kind === 'item' && e.refId === id));
      if (entries.length !== t.entries.length) await db.trips.put({ ...t, entries });
    }
    const s = await getSettings();
    const d = s.draft;
    const dslots = Object.fromEntries(Object.entries(d.slots).filter(([, v]) => v !== id));
    await db.settings.put({ ...s, draft: { ...d, slots: dslots, accessories: d.accessories.filter((a) => a !== id) } });
  });
}

/** Dress-up's current outfit lives in settings so it survives reloads. */
export async function setDraft(draft: OutfitDraft): Promise<void> {
  await updateSettings({ draft });
}

/** Puts an item on the mannequin in its category's slot (accessories toggle on/off). */
export async function wearInDraft(item: Item): Promise<void> {
  const s = await getSettings();
  const def = CATEGORY[item.category];
  const d = s.draft;
  if (!def.slot) {
    const on = d.accessories.includes(item.id);
    await setDraft({ ...d, outfitId: undefined, accessories: on ? d.accessories.filter((a) => a !== item.id) : [...d.accessories, item.id] });
    return;
  }
  await setDraft({ ...d, outfitId: undefined, slots: placeItem(d.slots, def.slot as Slot, item.id) });
}

/** Days since the item was last worn, or undefined if never. */
export function daysSinceWorn(item: Item, now = Date.now()): number | undefined {
  return item.lastWornAt ? Math.floor((now - item.lastWornAt) / 86_400_000) : undefined;
}

export const todayISO = (d = new Date()): string =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
