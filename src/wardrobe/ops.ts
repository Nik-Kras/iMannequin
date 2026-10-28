// Database writes for the wardrobe screens: places, seasonal swap, same-item merge, cut-out edits.
import { db, newId } from '../data/db';
import type { Item, Photo } from '../domain/types';

/** Seasonal swap: moves the items to a place in one transaction. */
export async function moveItems(ids: string[], locationId: string): Promise<void> {
  const now = Date.now();
  await db.transaction('rw', db.items, async () => {
    for (const id of ids) await db.items.update(id, { locationId, updatedAt: now });
  });
}

export async function addPlace(name: string): Promise<string> {
  const id = newId();
  const last = await db.locations.orderBy('order').last();
  await db.locations.add({ id, name: name.trim(), order: (last?.order ?? -1) + 1 });
  return id;
}

export async function renamePlace(id: string, name: string): Promise<void> {
  await db.locations.update(id, { name: name.trim() });
}

/** Moves a place one step up (-1) or down (+1) in the list. */
export async function movePlace(id: string, dir: -1 | 1): Promise<void> {
  await db.transaction('rw', db.locations, async () => {
    const list = await db.locations.orderBy('order').toArray();
    const i = list.findIndex((p) => p.id === id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= list.length) return;
    [list[i], list[j]] = [list[j], list[i]];
    await Promise.all(list.map((p, k) => (p.order === k ? undefined : db.locations.update(p.id, { order: k }))));
  });
}

/** Deletes a place; its items keep everything else and lose the place. */
export async function deletePlace(id: string): Promise<void> {
  await db.transaction('rw', db.locations, db.items, async () => {
    const now = Date.now();
    const items = await db.items.where('locationId').equals(id).toArray();
    for (const it of items) await db.items.put({ ...it, locationId: undefined, updatedAt: now });
    await db.locations.delete(id);
  });
}

/** "Yes, same one" (D43): the review item's photos join the existing item's gallery, and the review item goes. */
export async function mergeIntoExisting(reviewId: string, existingId: string): Promise<void> {
  await db.transaction('rw', db.items, db.photos, async () => {
    const photos = await db.photos.where('itemId').equals(reviewId).toArray();
    for (const p of photos) await db.photos.update(p.id, { itemId: existingId });
    await db.items.delete(reviewId);
    await db.items.update(existingId, { updatedAt: Date.now() });
  });
}

/** "No, different": forget the same-item hint so it isn't asked again. */
export async function dismissSameItem(item: Item): Promise<void> {
  if (!item.suggestion) return;
  const rest = { ...item.suggestion };
  delete rest.sameItemId;
  delete rest.sameItemScore;
  await db.items.update(item.id, { suggestion: rest });
}

/** Saves a fixed cut-out on the photo and marks it approved; anchors are re-detected from the new shape. */
export async function saveCutout(photoId: string, patch: { cutout: Blob; thumb?: Blob; width: number; height: number; model?: string }): Promise<void> {
  const p = await db.photos.get(photoId);
  if (!p) return;
  const next: Photo = {
    ...p, cutout: patch.cutout, thumb: patch.thumb ?? patch.cutout, width: patch.width, height: patch.height,
    cutoutModel: patch.model ?? p.cutoutModel, cutoutApproved: true, anchors: undefined,
  };
  await db.photos.put(next);
}

export async function setCutoutApproved(photoId: string, approved: boolean): Promise<void> {
  await db.photos.update(photoId, { cutoutApproved: approved });
}
