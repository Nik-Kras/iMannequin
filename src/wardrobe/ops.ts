// Database writes for the wardrobe screens: places, seasonal swap, same-item merge, cut-out edits.
// Every write reopens a lost connection once (iOS drops it after the camera or picker) and throws if it still
// fails, so the screen's useAction can say so (bug-audit #3).
import { db, newId, withFreshBlobs, withReopen } from '../data/db';
import type { Item, Photo } from '../domain/types';

/** Seasonal swap: moves the items to a place in one transaction. */
export async function moveItems(ids: string[], locationId: string): Promise<void> {
  const now = Date.now();
  await withReopen(() => db.transaction('rw', db.items, async () => {
    for (const id of ids) await db.items.update(id, { locationId, updatedAt: now });
  }));
}

export async function addPlace(name: string): Promise<string> {
  const id = newId();
  await withReopen(() => db.transaction('rw', db.locations, async () => {
    const last = await db.locations.orderBy('order').last();
    await db.locations.put({ id, name: name.trim(), order: (last?.order ?? -1) + 1 });
  }));
  return id;
}

export async function renamePlace(id: string, name: string): Promise<void> {
  await withReopen(() => db.locations.update(id, { name: name.trim() }));
}

/** Moves a place one step up (-1) or down (+1) in the list. */
export async function movePlace(id: string, dir: -1 | 1): Promise<void> {
  await withReopen(() => db.transaction('rw', db.locations, async () => {
    const list = await db.locations.orderBy('order').toArray();
    const i = list.findIndex((p) => p.id === id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= list.length) return;
    [list[i], list[j]] = [list[j], list[i]];
    await Promise.all(list.map((p, k) => (p.order === k ? undefined : db.locations.update(p.id, { order: k }))));
  }));
}

/** Deletes a place; its items keep everything else and lose the place. */
export async function deletePlace(id: string): Promise<void> {
  await withReopen(() => db.transaction('rw', db.locations, db.items, async () => {
    const now = Date.now();
    const items = await db.items.where('locationId').equals(id).toArray();
    for (const it of items) await db.items.put({ ...it, locationId: undefined, updatedAt: now });
    await db.locations.delete(id);
  }));
}

/**
 * Photo records hold Blobs, so they are rewritten only with in-memory copies of them: on WebKit, storing a record
 * whose Blobs were read from IndexedDB leaves its images unreadable until a relaunch (bug-audit #2). Copying needs
 * awaits, which would end a transaction, so the copies are made first.
 */
async function freshPhotos(ids: string[], change: (p: Photo) => Partial<Photo>): Promise<Photo[]> {
  const found = (await db.photos.bulkGet(ids)).filter((p): p is Photo => !!p);
  return Promise.all(found.map((p) => withFreshBlobs({ ...p, ...change(p) })));
}

/** "Yes, same one" (D43): the review item's photos join the existing item's gallery, and the review item goes. */
export async function mergeIntoExisting(reviewId: string, existingId: string): Promise<void> {
  const ids = (await db.photos.where('itemId').equals(reviewId).primaryKeys()) as string[];
  const moved = await freshPhotos(ids, () => ({ itemId: existingId }));
  await withReopen(() => db.transaction('rw', db.items, db.photos, async () => {
    await db.photos.bulkPut(moved);
    await db.items.delete(reviewId);
    await db.items.update(existingId, { updatedAt: Date.now() });
  }));
}

/** "No, different": forget the same-item hint so it isn't asked again. */
export async function dismissSameItem(item: Item): Promise<void> {
  if (!item.suggestion) return;
  const rest = { ...item.suggestion };
  delete rest.sameItemId;
  delete rest.sameItemScore;
  await withReopen(() => db.items.update(item.id, { suggestion: rest }));
}

/** Saves a fixed cut-out on the photo and marks it approved; anchors are re-detected from the new shape. */
export async function saveCutout(photoId: string, patch: { cutout: Blob; thumb?: Blob; width: number; height: number; model?: string }): Promise<void> {
  const [next] = await freshPhotos([photoId], (p) => ({
    cutout: patch.cutout, thumb: patch.thumb ?? patch.cutout, width: patch.width, height: patch.height,
    cutoutModel: patch.model ?? p.cutoutModel, cutoutApproved: true, anchors: undefined,
  }));
  if (next) await withReopen(() => db.photos.put(next));
}

export async function setCutoutApproved(photoId: string, approved: boolean): Promise<void> {
  const [next] = await freshPhotos([photoId], () => ({ cutoutApproved: approved }));
  if (next) await withReopen(() => db.photos.put(next));
}
