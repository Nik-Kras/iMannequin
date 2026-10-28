// Wear log writes (D46): log a look or a single garment on a day, or take an entry back. Each item's "last worn"
// follows its latest entry, so the not-worn list stays right.
import { db, newId } from '../data/db';
import { todayISO } from '../data/repo';
import type { OutfitDraft, WearEntry } from '../domain/types';
import { parseISO } from './calendar';
import { outfitItemIds } from './wardrobe';

/** When an entry counts as worn: the moment it was logged if that was on the day itself, else midday of that day. */
export function wornAt(e: Pick<WearEntry, 'date' | 'createdAt'>): number {
  return todayISO(new Date(e.createdAt)) === e.date ? e.createdAt : parseISO(e.date).getTime() + 12 * 3_600_000;
}

/** Logs items as worn on a day; an item's "last worn" moves forward when this day is later. Returns the entry id. */
export async function logWear(date: string, itemIds: string[], outfitId?: string): Promise<string> {
  const entry: WearEntry = { id: newId(), date, itemIds, createdAt: Date.now(), ...(outfitId ? { outfitId } : {}) };
  const at = wornAt(entry);
  await db.transaction('rw', db.wear, db.items, async () => {
    await db.wear.add(entry);
    for (const id of itemIds) {
      const item = await db.items.get(id);
      if (item && (item.lastWornAt ?? 0) < at) await db.items.update(id, { lastWornAt: at });
    }
  });
  return entry.id;
}

/** Logs the Dress-up look on a day. */
export function logOutfit(date: string, draft: OutfitDraft): Promise<string> {
  return logWear(date, outfitItemIds(draft), draft.outfitId);
}

/** Marks one garment worn on a day (today by default); nothing changes when it is already logged that day. */
export async function markWorn(itemId: string, date = todayISO()): Promise<void> {
  const logged = await db.wear.where('date').equals(date).filter((w) => w.itemIds.includes(itemId)).count();
  if (!logged) await logWear(date, [itemId]);
}

/** Deletes a log entry; each of its items falls back to its latest remaining wear (or none). */
export async function deleteWear(id: string): Promise<void> {
  await db.transaction('rw', db.wear, db.items, async () => {
    const entry = await db.wear.get(id);
    if (!entry) return;
    await db.wear.delete(id);
    for (const itemId of entry.itemIds) {
      const rest = await db.wear.filter((w) => w.itemIds.includes(itemId)).toArray();
      await db.items.update(itemId, { lastWornAt: rest.length ? Math.max(...rest.map(wornAt)) : undefined });
    }
  });
}
