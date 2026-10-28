// Turns a draft outfit into drawable layers: loads each garment's cut-out and anchors, fits it to the body and puts
// the layers in drawing order (try-on §6).
import { db } from '../data/db';
import { CATEGORY } from '../domain/taxonomy';
import type { FitAdjustment, GarmentAnchors, Item, OutfitDraft, Photo } from '../domain/types';
import { decode, garmentAnchors, type LoadedBody } from './assets';
import type { LayerInput } from './compositor';
import { fitGarment, type Placement } from './fit';
import { orderedItemIds } from './layers';

export { draftItemIds, orderedItemIds } from './layers';

export interface SceneData { items: Item[]; photos: Record<string, Photo | undefined> }

/** Items and their try-on photos for a draft (one read). */
export async function loadSceneData(ids: string[], extra: string[] = []): Promise<SceneData> {
  const all = [...new Set([...ids, ...extra])];
  const items = (await db.items.bulkGet(all)).filter((x): x is Item => !!x);
  const pids = items.map((i) => i.tryOnPhotoId).filter((x): x is string => !!x);
  const photos = await db.photos.bulkGet(pids);
  const byId: Record<string, Photo | undefined> = {};
  pids.forEach((id, i) => { byId[id] = photos[i]; });
  return { items, photos: byId };
}

export interface PreparedScene {
  layers: LayerInput[];
  placements: Record<string, Placement>;
  anchors: Record<string, GarmentAnchors>;
}

/** Decodes, anchors and fits every garment of the draft on this body. */
export async function prepareScene(draft: OutfitDraft, data: SceneData, body: LoadedBody, override?: { itemId: string; fit?: FitAdjustment }): Promise<PreparedScene> {
  const byId = new Map(data.items.map((i) => [i.id, i]));
  const order = orderedItemIds(draft, data.items);
  const out: PreparedScene = { layers: [], placements: {}, anchors: {} };
  const ready = await Promise.all(order.map(async (id) => {
    const item = byId.get(id);
    const photo = item?.tryOnPhotoId ? data.photos[item.tryOnPhotoId] : undefined;
    if (!item || !photo?.cutout) return undefined;
    try {
      let image: ImageBitmap;
      try {
        image = await decode(photo.cutout);
      } catch {
        // A Blob read while its record was being written can be dead on WebKit; a fresh read is fine.
        const fresh = await db.photos.get(photo.id);
        if (!fresh?.cutout) return undefined;
        image = await decode(fresh.cutout);
      }
      const anchors = await garmentAnchors(photo, CATEGORY[item.category].group, image);
      return { item, photo, image, anchors };
    } catch {
      return undefined;
    }
  }));
  for (const r of ready) {
    if (!r) continue;
    const fit = override && override.itemId === r.item.id ? override.fit : r.item.fit;
    const placement = fitGarment(r.item.category, r.anchors, body, fit);
    const box0 = r.anchors.points.box0;
    const box1 = r.anchors.points.box1;
    out.placements[r.item.id] = placement;
    out.anchors[r.item.id] = r.anchors;
    out.layers.push({
      key: `${r.photo.id}:${r.photo.cutout?.size ?? 0}`,
      itemId: r.item.id,
      image: r.image,
      pieces: placement.pieces,
      box: box0 && box1 ? { x0: box0.x, y0: box0.y, x1: box1.x, y1: box1.y } : undefined,
    });
  }
  return out;
}
