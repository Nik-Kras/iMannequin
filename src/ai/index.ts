// Public API of the on-device AI module (architecture §4). Screens import only from here.
// OWNER: the AI module. Signatures are the contract other modules code against; keep them stable.
import type { CategoryId, ColourName, Landmark, Season } from '../domain/types';
import { CATEGORY, CATEGORIES } from '../domain/taxonomy';
import { db, getSettings } from '../data/db';
import { deviceFor, exclusive, failKey, guarded, isNetworkError, releaseAi, run } from './client';
import { decideSameItem, cosine, SAME_ITEM_THRESHOLD } from './classify';
import { analyseWith, unusableHere, usableModel, withModel } from './embed';
import { MODEL_SPECS, chosenModel, spec as specOf, type ModelSpec } from './registry';
import { isDownloaded } from './downloads';
import { PoseError, runPose } from './pose';
import { searchDetailed } from './search';
import type { CutoutOut } from './worker';
import { record, reportError, risky } from '../diag/diagnostics';

export interface CutoutResult {
  /** PNG with a transparent background, cropped to the garment with a small margin. */
  cutout: Blob;
  width: number;
  height: number;
  /** Model id that produced it, e.g. 'plain-bg', 'birefnet-lite'. */
  model: string;
  ms: number;
  /** The rectangle of the original photo (original pixels, EXIF-rotated) the cut-out covers, margin included. */
  crop?: { x: number; y: number; w: number; h: number };
}

export interface GarmentAnalysis {
  categories: { id: CategoryId; score: number }[];
  colours: ColourName[];
  seasons: Season[];
  embedding?: Float32Array;
  embeddingModel?: string;
  model: string;
}

export interface PoseResult {
  /** 33 MediaPipe points, x/y normalised 0–1 to the photo. */
  landmarks: Landmark[];
  /** Person mask at photo size: alpha/intensity > 127 = body. */
  mask: ImageData;
  width: number;
  height: number;
  model: string;
}

export interface SearchHit { itemId: string; score: number }

export interface ModelInfo {
  id: string;
  task: 'cutout' | 'classify' | 'search' | 'describe' | 'pose';
  label: string;
  licence: string;
  /** Approximate download in MB, or undefined when unknown. */
  sizeMb?: number;
  /** Hugging Face repo id, or a self-hosted path. */
  source: string;
  default?: boolean;
}

const now = () => performance.now();

/** Error tags the queue turns into a message and an action (QueueError, bug-audit #16). */
const tagged = (message: string, code: 'no-garment' | 'models' | 'network') => Object.assign(new Error(message), { code });
const noGarment = () => tagged('No garment found in the photo', 'no-garment');

/**
 * Cuts the garment out of a flat-lay photo. Tries the plain-background fast path first, then the chosen model.
 * With `opts.model` (Fix cut-out → try another model) only that model runs; 'plain-bg' always returns its result.
 */
export function cutOutGarment(photo: Blob, opts?: { model?: string }): Promise<CutoutResult> {
  return exclusive(() => cutOut(photo, opts));
}

async function cutOut(photo: Blob, opts?: { model?: string }): Promise<CutoutResult> {
  const t0 = now();
  const asked = opts?.model ? specOf(opts.model) : undefined;
  if (opts?.model && !asked) throw new Error(`Unknown model ${opts.model}`);
  const done = (r: CutoutOut, model: string): CutoutResult => ({ cutout: r.png, width: r.width, height: r.height, model, ms: Math.round(now() - t0), crop: r.crop });

  let plain: CutoutOut | null = null;
  if (!asked || asked.id === 'plain-bg') {
    plain = await run<CutoutOut | null>(null, { type: 'plain', blob: photo, force: asked?.id === 'plain-bg' });
    if (plain?.clean || (asked && plain)) return done(plain!, 'plain-bg');
    if (asked) throw noGarment();
  }

  if (asked && (await unusableHere(asked)) === 'device') throw new Error(`${asked.label} needs WebGPU`);
  const settings = await getSettings();
  if (!asked && chosenModel(settings, 'cutout').runtime === 'code') {
    // The user chose "Plain background" in the Model lab: no model, take the plain result as it is.
    const forced = await run<CutoutOut | null>(null, { type: 'plain', blob: photo, force: true });
    if (forced) return done(forced, 'plain-bg');
    throw noGarment();
  }
  let lastErr: unknown = null;
  let lastModel: ModelSpec | null = null;
  // The chosen model, then the next candidates when one fails on this phone (each failure is remembered).
  for (let attempt = 0; attempt < 3; attempt++) {
    const model = asked ?? (await usableModel(settings, 'cutout'));
    if (!model) break;
    lastModel = model;
    try {
      const device = await deviceFor(model);
      const key = failKey(model.id, device);
      const r = await withModel(model, () => guarded(key, () => run<CutoutOut | null>(key, { type: 'segment', blob: photo, spec: model })));
      if (r) return done(r, model.id);
      break; // the model ran but found nothing
    } catch (err) {
      lastErr = err;
      if (asked) throw err;
      if (isNetworkError(err) || !(await unusableHere(model))) break; // not the model's fault: don't try others
    }
  }
  // No model could run (offline before the download, or every candidate failed): the plain result, if any.
  const fallback = await run<CutoutOut | null>(null, { type: 'plain', blob: photo, force: true });
  if (fallback) return done(fallback, 'plain-bg');
  if (lastErr && lastModel && isNetworkError(lastErr)) {
    // Offline: either the model was never downloaded, or the connection dropped while it loaded.
    throw tagged(String((lastErr as Error)?.message ?? lastErr), (await isDownloaded(lastModel.id)) ? 'network' : 'models');
  }
  throw lastErr ?? noGarment();
}

/** Category (top-3), colours, seasons and an image embedding for a cut-out. */
export function analyseGarment(cutout: Blob): Promise<GarmentAnalysis> {
  return exclusive(() => analyse(cutout));
}

async function analyse(cutout: Blob): Promise<GarmentAnalysis> {
  const colours = await run<ColourName[]>(null, { type: 'colours', blob: cutout });
  const settings = await getSettings();
  const s = await usableModel(settings, 'classify');
  if (!s) return { categories: [], colours, seasons: [], model: 'plain' };
  try {
    const r = await analyseWith(s, cutout);
    return { ...r, colours, embeddingModel: s.id, model: s.id };
  } catch (err) {
    // The user picks the category (architecture §4 fallback); colours still come from plain code.
    if (isNetworkError(err)) console.warn('analyseGarment: model not available offline');
    return { categories: [], colours, seasons: [], model: 'plain' };
  }
}

/** The most similar existing item in the same zone, when it looks like the same physical piece (D9). */
export async function findSameItem(embedding: Float32Array, category: CategoryId, excludeItemId?: string): Promise<SearchHit | null> {
  return findSameItemWithColours(embedding, category, undefined, excludeItemId);
}

/**
 * findSameItem with the new photo's colours (GarmentAnalysis.colours) for the colour check. Without
 * colours they are read from the excluded item when it's already saved; with none at all, the
 * threshold is stricter.
 */
export async function findSameItemWithColours(embedding: Float32Array, category: CategoryId, colours?: ColourName[], excludeItemId?: string): Promise<SearchHit | null> {
  const settings = await getSettings();
  // The model analyseGarment used (the chosen one, or the next if it failed on this phone).
  const model = (await usableModel(settings, 'classify'))?.id ?? chosenModel(settings, 'classify').id;
  const zone = CATEGORY[category]?.zone;
  if (!zone) return null;
  const items = (await db.items.toArray()).filter((i) => i.status !== 'archived' && i.id !== excludeItemId && CATEGORY[i.category]?.zone === zone);
  if (!items.length) return null;
  const byId = new Map(items.map((i) => [i.id, i]));
  const photos = await db.photos.where('itemId').anyOf([...byId.keys()]).toArray();
  const best = new Map<string, number>();
  for (const p of photos) {
    if (!p.embedding || p.embeddingModel !== model || !p.itemId || p.embedding.length !== embedding.length) continue;
    const s = cosine(embedding, p.embedding);
    if (s > (best.get(p.itemId) ?? -1)) best.set(p.itemId, s);
  }
  const self = !colours?.length && excludeItemId ? await db.items.get(excludeItemId) : undefined;
  const newColours = colours?.length ? colours : self?.colours?.length ? self.colours : self?.suggestion?.colours ?? [];
  const cands = [...best.entries()].map(([itemId, score]) => ({ itemId, score, colours: byId.get(itemId)!.colours }));
  return decideSameItem(cands, newColours, SAME_ITEM_THRESHOLD[model] ?? 0.93);
}

/** Body key points and person mask from the A-pose photo. */
export function detectPose(photo: Blob): Promise<PoseResult> {
  return exclusive(() => pose(photo));
}

async function pose(photo: Blob): Promise<PoseResult> {
  // Tests stand in for MediaPipe with synthetic key points (R2: no real body photos in the repo).
  const fake = (globalThis as { __imqFakePose?: (p: Blob) => Promise<PoseResult> }).__imqFakePose;
  if (fake) return fake(photo);
  await releaseAi(); // one AI model in memory at a time
  const settings = await getSettings();
  const chosen = chosenModel(settings, 'pose');
  const order = [chosen, ...MODEL_SPECS.filter((m) => m.task === 'pose' && m.id !== chosen.id)];
  let lastErr: unknown;
  for (const s of order) {
    try {
      const r = await risky(`pose:${s.id}`, () => runPose(photo, s.source));
      record('pose.done', { model: s.id, width: r.width, height: r.height, points: r.landmarks.length });
      return { ...r, model: s.id };
    } catch (err) {
      lastErr = err;
      if (err instanceof PoseError && err.code === 'no-person') { record('pose.noPerson', { model: s.id }); throw err; }
      reportError(err, 'pose', { model: s.id });
    }
  }
  throw lastErr;
}

/** Search the active wardrobe by description, in English or Ukrainian (D32). */
export async function searchWardrobe(query: string): Promise<SearchHit[]> {
  if (!query.trim()) return [];
  return (await searchDetailed(query)).hits;
}

export const MODELS: ModelInfo[] = MODEL_SPECS;

// ---- Extra exports (additions to the contract) ----

export { searchDetailed as searchWardrobeDetailed, type SearchOptions, type SearchResult } from './search';
export { effectiveModel, unusableHere } from './embed';
export { PoseError } from './pose';
export { releaseAi, crashedOnLastRun, resetFailures, failedModels, detectDevice } from './client';

/** Frees the AI model once the work queued before this call is done (the garment queue is idle, bug-audit #8). */
export function releaseAiWhenIdle(): Promise<void> {
  return exclusive(() => releaseAi());
}
export { isDownloaded, downloadModel, deleteDownload, remainingBytes, downloadSize } from './downloads';
export { MODEL_SPECS, ONBOARDING_MODELS, chosenModel, defaultModel, specsFor, formatMb, type ModelSpec } from './registry';
export { parseQuery, needsLanguageModel } from './query';
export { garmentColours, nameColour } from './colours';

/** A short English description of a cut-out (optional Florence-2 task, used by the Model lab). */
export async function describeGarment(cutout: Blob): Promise<string> {
  const settings = await getSettings();
  const s = await usableModel(settings, 'describe');
  if (!s) throw new Error('No description model');
  const key = failKey(s.id, await deviceFor(s));
  return exclusive(() => withModel(s, () => guarded(key, () => run<string>(key, { type: 'describe', blob: cutout, spec: s }))));
}

/** Category names in prompt order, for debugging and the Model lab. */
export const CATEGORY_IDS: CategoryId[] = CATEGORIES.map((c) => c.id);
