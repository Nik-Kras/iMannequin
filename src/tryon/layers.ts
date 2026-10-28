// Draft outfit → garments in drawing order (try-on §6). Pure.
import { layerOrder } from '../domain/taxonomy';
import type { Item, OutfitDraft } from '../domain/types';

/** Every item on the mannequin, slots first, without duplicates. */
export function draftItemIds(draft: OutfitDraft): string[] {
  const ids = [...Object.values(draft.slots), ...draft.accessories].filter((x): x is string => !!x);
  return [...new Set(ids)];
}

/** Garments in drawing order, bottom to top, honouring the Tuck in and Trousers into boots toggles (D40). */
export function orderedItemIds(draft: OutfitDraft, items: Pick<Item, 'id' | 'category'>[]): string[] {
  const byId = new Map(items.map((i) => [i.id, i]));
  return layerOrder({
    slots: draft.slots,
    accessories: draft.accessories.map((id) => byId.get(id)).filter((x): x is Pick<Item, 'id' | 'category'> => !!x).map((i) => ({ id: i.id, category: i.category })),
    categoryOf: (id) => byId.get(id)?.category,
    tuckIn: draft.toggles.tuckIn,
    intoBoots: draft.toggles.intoBoots,
  });
}
