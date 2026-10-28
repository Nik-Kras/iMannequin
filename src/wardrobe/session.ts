// What the wardrobe screens keep for the session (bug-audit #17, #18): unsaved item-form drafts, the places
// used while reviewing, and the wardrobe grid's scroll. sessionStorage survives iOS reloading a killed page.

function read<T>(key: string): T | undefined {
  try {
    const s = sessionStorage.getItem(key);
    return s ? (JSON.parse(s) as T) : undefined;
  } catch {
    return undefined;
  }
}

function write(key: string, value: unknown): void {
  try {
    if (value === undefined) sessionStorage.removeItem(key);
    else sessionStorage.setItem(key, JSON.stringify(value));
  } catch { /* storage full or blocked: the draft just isn't kept */ }
}

const draftKey = (itemId: string) => `imq-item-draft:${itemId}`;
export const readDraft = <T>(itemId: string) => read<T>(draftKey(itemId));
export const writeDraft = (itemId: string, draft: unknown) => write(draftKey(itemId), draft);
export const clearDraft = (itemId: string) => write(draftKey(itemId), undefined);

const PLACES = 'imq-recent-places';
/** Places picked in this session, most recent first. */
export const recentPlaces = (): string[] => read<string[]>(PLACES) ?? [];
export function usedPlace(id: string): void {
  write(PLACES, [id, ...recentPlaces().filter((x) => x !== id)].slice(0, 6));
}

const REVIEW_PLACE = 'imq-review-place';
/** The place given to the last garment saved from the review pile; suggested for the next one. */
export const lastReviewPlace = () => read<string>(REVIEW_PLACE);
export const setLastReviewPlace = (id: string | undefined) => write(REVIEW_PLACE, id);

const scrollKey = (where: string) => `imq-scroll:${where}`;
export const readScroll = (where: string) => read<number>(scrollKey(where));
export const writeScroll = (where: string, y: number) => write(scrollKey(where), Math.round(y));

const SEARCH = 'imq-wardrobe-search';
/** The last wardrobe search's results, so coming back to the same query doesn't search again. */
export const readSearch = () => read<{ q: string; ids: string[]; smart?: boolean }>(SEARCH);
export const writeSearch = (r: { q: string; ids: string[]; smart?: boolean } | null) => write(SEARCH, r ?? undefined);
