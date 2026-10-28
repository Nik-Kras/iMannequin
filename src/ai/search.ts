// Search by description (F5, D32): keyword filters first, CLIP text→image ranking second, and the
// small language model only when the words can't be mapped (Ukrainian or free-form text), and only when the
// user asks for it: it peaks at about 4 GB, so it never runs by itself or on WebAssembly (bug-audit #10).
import { db, getSettings } from '../data/db';
import type { Item, Photo } from '../domain/types';
import { exclusive, failKey, guarded, run, deviceFor, isNetworkError, releaseAi, type Progress } from './client';
import { cosine } from './classify';
import { isDownloaded } from './downloads';
import { textEmbeddings, usableModel, withModel } from './embed';
import {
  facetMatch, hasFilters, llmMessages, mergeLlm, needsLanguageModel, parseLlmAnswer, parseQuery, textMatch,
  type ParsedQuery, type PlaceRef,
} from './query';
import type { SearchHit } from './index';

export interface SearchOptions {
  /** 'run' uses the language model when needed and downloaded; 'download' may fetch it first; 'off' (default) never. */
  llm?: 'run' | 'download' | 'off';
  onProgress?: Progress;
  /** Called with the keyword results before the language model runs, so the screen can show them at once. */
  onPlain?: (hits: SearchHit[]) => void;
}

export interface SearchResult {
  hits: SearchHit[];
  query: ParsedQuery;
  needsLlm: boolean;
  usedLlm: boolean;
  /** The search model is on this phone. */
  llmDownloaded: boolean;
  /** The search model can run here: there is one, and the phone has WebGPU. */
  llmUsable: boolean;
}

const LLM_TIMEOUT = 90_000;
const MAX_FREE_HITS = 12;

export async function searchDetailed(text: string, opts: SearchOptions = {}): Promise<SearchResult> {
  const settings = await getSettings();
  const [items, locations] = await Promise.all([
    db.items.where('status').equals('active').toArray(),
    db.locations.toArray(),
  ]);
  const places: PlaceRef[] = locations.map((l) => ({ id: l.id, name: l.name }));
  let q = parseQuery(text, places);
  const needsLlm = needsLanguageModel(q);
  const llmSpec = await usableModel(settings, 'search');
  const llmDownloaded = llmSpec ? await isDownloaded(llmSpec.id) : false;
  const llmDevice = llmSpec ? await deviceFor(llmSpec) : null;
  const llmUsable = llmDevice === 'webgpu';

  const clip = await usableModel(settings, 'classify');
  const clipReady = clip ? await isDownloaded(clip.id) : false;

  if (needsLlm && opts.onPlain) opts.onPlain(rank(items, q, null));

  let usedLlm = false;
  const asked = opts.llm === 'run' || opts.llm === 'download';
  if (needsLlm && llmSpec && llmUsable && asked && (llmDownloaded || opts.llm === 'download')) {
    try {
      const key = failKey(llmSpec.id, 'webgpu');
      const answer = await exclusive(async () => {
        try {
          return await withModel(llmSpec, () => guarded(key, () => run<string>(key,
            { type: 'generate', spec: llmSpec, messages: llmMessages(text, places), maxTokens: 160 },
            { onProgress: opts.onProgress, timeoutMs: llmDownloaded ? LLM_TIMEOUT : 60 * 60_000 })));
        } finally {
          releaseAi(); // its memory goes back as soon as it has answered
        }
      });
      const parsed = parseLlmAnswer(answer);
      if (parsed) { q = mergeLlm(q, parsed, places); usedLlm = true; }
    } catch (err) {
      if (isNetworkError(err) && opts.llm === 'download') throw err;
      // Otherwise fall back to the keyword parse.
    }
  }

  let sims: Map<string, number> | null = null;
  if (clip && clipReady && q.phrase) {
    try {
      const photos = await embeddedPhotos(items, clip.id);
      if (photos.length) {
        const [t] = await exclusive(() => withModel(clip, () => textEmbeddings(clip, [`a photo of ${q.phrase}`], { store: false })));
        sims = new Map();
        for (const p of photos) {
          const s = cosine(t, p.embedding!);
          if (!sims.has(p.itemId!) || s > sims.get(p.itemId!)!) sims.set(p.itemId!, s);
        }
      }
    } catch { sims = null; }
  }
  return { hits: rank(items, q, sims), query: q, needsLlm, usedLlm, llmDownloaded, llmUsable };
}

async function embeddedPhotos(items: Item[], model: string): Promise<Photo[]> {
  const ids = new Set(items.map((i) => i.id));
  const photos = await db.photos.where('itemId').anyOf([...ids]).toArray();
  return photos.filter((p) => p.embedding && p.embeddingModel === model && p.itemId);
}

/**
 * Orders items for a parsed query. With filters: items matching all of them, ranked by CLIP
 * similarity and text matches (partial matches only when nothing matches fully). Without filters:
 * the items CLIP finds closest (a narrow band below the best) and plain text matches.
 */
export function rank(items: Item[], q: ParsedQuery, sims: Map<string, number> | null): SearchHit[] {
  const vals = sims ? [...sims.values()] : [];
  const lo = vals.length ? Math.min(...vals) : 0, hi = vals.length ? Math.max(...vals) : 0;
  const norm = (id: string) => (sims?.has(id) && hi > lo ? (sims.get(id)! - lo) / (hi - lo) : 0);
  const scored = items.map((it) => ({ it, f: facetMatch(it, q), t: textMatch(it, q.rest), c: norm(it.id), raw: sims?.get(it.id) }));

  let pool: typeof scored;
  if (hasFilters(q)) {
    pool = scored.filter((s) => s.f === 1);
    if (!pool.length) pool = scored.filter((s) => s.f >= 0.5);
  } else if (sims && sims.size) {
    // CLIP's text–image similarities sit close together: keep the top of the range only.
    const cut = Math.max(hi - 0.03, lo + 0.75 * (hi - lo));
    pool = scored.filter((s) => (s.raw !== undefined && s.raw >= cut) || s.t > 0);
    pool = pool.sort((a, b) => (b.raw ?? 0) - (a.raw ?? 0)).slice(0, MAX_FREE_HITS);
  } else {
    pool = scored.filter((s) => s.t > 0);
  }
  return pool
    .map((s) => ({ itemId: s.it.id, score: Math.round((0.6 * s.f + 0.25 * s.c + 0.15 * s.t) * 1000) / 1000 }))
    .sort((a, b) => b.score - a.score);
}
