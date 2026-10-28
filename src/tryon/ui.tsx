// Helpers shared by the try-on screens (Dress-up, See all, Adjust fit).
import { useEffect, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../data/db';
import { CATEGORY, placeItem } from '../domain/taxonomy';
import type { Item, Outfit, OutfitDraft, Photo, Slot } from '../domain/types';
import { CutoutImg } from '../ui/parts';

/** Photos (by id) for a list of items, for thumbnails. */
export function useItemPhotos(items: Item[] | undefined): Record<string, Photo> | undefined {
  const ids = (items ?? []).map((i) => i.tryOnPhotoId).filter((x): x is string => !!x);
  const key = ids.join(',');
  return useLiveQuery(async () => {
    const photos = await db.photos.bulkGet(ids);
    const out: Record<string, Photo> = {};
    photos.forEach((p) => { if (p) out[p.id] = p; });
    return out;
  }, [key]);
}

/** A garment's cut-out thumbnail, scaled to fit a box. */
export function GarmentThumb({ item, photos, w, h, className }: { item?: Item; photos?: Record<string, Photo>; w: number; h: number; className?: string }) {
  const p = item?.tryOnPhotoId ? photos?.[item.tryOnPhotoId] : undefined;
  const blob = p?.cutout ?? p?.thumb;
  if (!item || !blob) return <span className={className} style={{ display: 'block', width: w, height: h }} />;
  return <CutoutImg blob={blob} alt="" style={{ width: w, height: h, objectFit: 'contain' }} />;
}

/** The slot an item goes in (a dress takes the full-body slot); accessories have none. */
export function slotForItem(item: Item): Slot | undefined {
  return CATEGORY[item.category].slot;
}

/** The draft with an item put on (accessories are added). Clears the saved-outfit link. */
export function putOn(draft: OutfitDraft, item: Item): OutfitDraft {
  const slot = slotForItem(item);
  if (!slot) return draft.accessories.includes(item.id) ? draft : { ...draft, outfitId: undefined, accessories: [...draft.accessories, item.id] };
  return { ...draft, outfitId: undefined, slots: placeItem(draft.slots, slot, item.id) };
}

/** The draft with an item taken off, wherever it is. */
export function takeOff(draft: OutfitDraft, itemId: string): OutfitDraft {
  const slots = Object.fromEntries(Object.entries(draft.slots).filter(([, v]) => v !== itemId)) as OutfitDraft['slots'];
  return { ...draft, outfitId: undefined, slots, accessories: draft.accessories.filter((a) => a !== itemId) };
}

export function isWorn(draft: OutfitDraft, itemId: string): boolean {
  return Object.values(draft.slots).includes(itemId) || draft.accessories.includes(itemId);
}

/** Whether a saved outfit is exactly what's on the mannequin. */
export function sameOutfit(draft: OutfitDraft, o: Outfit): boolean {
  const a = Object.entries(draft.slots).filter(([, v]) => v).sort();
  const b = Object.entries(o.slots).filter(([, v]) => v).sort();
  if (a.length !== b.length || a.some(([k, v], i) => b[i][0] !== k || b[i][1] !== v)) return false;
  const x = [...draft.accessories].sort();
  const y = [...o.accessories].sort();
  if (x.length !== y.length || x.some((v, i) => y[i] !== v)) return false;
  return !!draft.toggles.tuckIn === !!o.toggles?.tuckIn && !!draft.toggles.intoBoots === !!o.toggles?.intoBoots;
}

/** The saved outfit the draft matches, preferring the one it was loaded from. */
export function useMatchingOutfit(draft: OutfitDraft | undefined): Outfit | undefined {
  const outfits = useLiveQuery(() => db.outfits.toArray(), []);
  if (!draft || !outfits) return undefined;
  const linked = draft.outfitId ? outfits.find((o) => o.id === draft.outfitId) : undefined;
  if (linked && sameOutfit(draft, linked)) return linked;
  return outfits.find((o) => sameOutfit(draft, o));
}

/** Window inner size, live. */
export function useViewport(): { w: number; h: number } {
  const [v, setV] = useState(() => ({ w: window.innerWidth, h: window.innerHeight }));
  useEffect(() => {
    const on = () => setV({ w: window.innerWidth, h: window.innerHeight });
    window.addEventListener('resize', on);
    return () => window.removeEventListener('resize', on);
  }, []);
  return v;
}

/** The current season in the northern hemisphere, for the See all default filter. */
export function currentSeason(d = new Date()): 'spring' | 'summer' | 'autumn' | 'winter' {
  const m = d.getMonth();
  return m >= 2 && m <= 4 ? 'spring' : m >= 5 && m <= 7 ? 'summer' : m >= 8 && m <= 10 ? 'autumn' : 'winter';
}
