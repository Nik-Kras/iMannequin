// Model lab calibration (architecture §5, D12): every downloaded candidate runs on up to 12 photos from
// the wardrobe; timings and simple scores are stored as CalibrationRun rows (no photos, R1).
import { db, newId } from '../data/db';
import type { AiTask, CalibrationRun, CategoryId, Item, Photo, Season } from '../domain/types';
import { deviceFor, exclusive, failKey, guarded, releaseAi, run, detectDevice } from './client';
import { isDownloaded } from './downloads';
import { analyseWith, withModel } from './embed';
import { llmMessages, parseLlmAnswer, type LlmFilters } from './query';
import { MODEL_SPECS, type ModelSpec } from './registry';
import type { CutoutOut } from './worker';

export const CALIBRATION_PHOTOS = 12;

/** Free-form test searches the keyword parser can't fully read (half in Ukrainian), with what a sensible answer contains. */
const SMART: CategoryId[] = ['blazer', 'shirt', 'blouse', 'trousers', 'shoes', 'dress', 'skirt'];
const RAIN: CategoryId[] = ['coat', 'jacket', 'boots'];
const BEACH: CategoryId[] = ['swimsuit', 'swimshorts', 'swimtop', 'shorts', 'sandals', 'top', 'tshirt', 'dress'];
const any = (a: CategoryId[], b: CategoryId[]) => a.some((x) => b.includes(x));
const has = (s: Season[], x: Season) => s.includes(x);
export const SEARCH_TESTS: { query: string; uk: boolean; ok: (f: LlmFilters) => boolean }[] = [
  { query: 'something to wear to a job interview', uk: false, ok: (f) => any(f.categories, SMART) },
  { query: 'clothes for a rainy day', uk: false, ok: (f) => any(f.categories, RAIN) || f.warmth === 'warm' || has(f.seasons, 'autumn') },
  { query: 'what do I take to the beach', uk: false, ok: (f) => any(f.categories, BEACH) || has(f.seasons, 'summer') },
  { query: 'що вдягнути на співбесіду', uk: true, ok: (f) => any(f.categories, SMART) },
  { query: 'одяг на випадок дощу', uk: true, ok: (f) => any(f.categories, RAIN) || f.warmth === 'warm' || has(f.seasons, 'autumn') },
  { query: 'що взяти на пляж', uk: true, ok: (f) => any(f.categories, BEACH) || has(f.seasons, 'summer') },
];

export interface CalibrationStep { task: AiTask; modelId: string; label: string; done: number; total: number }

export interface CalibrationOutcome {
  runs: CalibrationRun[];
  /** Cut-outs each model produced in this run (kept in memory only, for the side-by-side view). */
  cutouts: Record<string, Blob[]>;
  descriptions: Record<string, string[]>;
  ms: number;
}

/** A short technical label for the export: platform, browser and the device class used. No identifiers. */
export async function deviceLabel(): Promise<string> {
  const ua = navigator.userAgent;
  const platform = /iPhone/.test(ua) ? 'iPhone' : /iPad/.test(ua) ? 'iPad' : /Android/.test(ua) ? 'Android' : /Mac/.test(ua) ? 'Mac' : /Windows/.test(ua) ? 'Windows' : 'Other';
  const browser = /CriOS|Chrome/.test(ua) ? 'Chrome' : /Safari/.test(ua) ? 'Safari' : /Firefox/.test(ua) ? 'Firefox' : 'Other';
  const version = ua.match(/(?:Version|Chrome|CriOS|Firefox)\/(\d+)/)?.[1] ?? '';
  return `${platform} · ${browser} ${version} · ${await detectDevice()}`.trim();
}

/** Up to 12 wardrobe photos, one per category first so the sample is varied. */
export async function calibrationPhotos(): Promise<{ item: Item; photo: Photo }[]> {
  const items = await db.items.where('status').equals('active').reverse().sortBy('createdAt');
  const pairs: { item: Item; photo: Photo }[] = [];
  for (const item of items) {
    if (!item.tryOnPhotoId) continue;
    const photo = await db.photos.get(item.tryOnPhotoId);
    if (photo?.original) pairs.push({ item, photo });
  }
  const seen = new Set<CategoryId>();
  const firsts = pairs.filter((p) => (seen.has(p.item.category) ? false : (seen.add(p.item.category), true)));
  const rest = pairs.filter((p) => !firsts.includes(p));
  return [...firsts, ...rest].slice(0, CALIBRATION_PHOTOS);
}

/** Runs one model job in the shared queue (other AI work waits its turn) and times it. */
function timed<T>(job: () => Promise<T>): Promise<{ value: T; ms: number }> {
  return exclusive(async () => {
    const t0 = performance.now();
    const value = await job();
    return { value, ms: performance.now() - t0 };
  });
}

export async function calibrate(onStep: (s: CalibrationStep) => void, signal: AbortSignal): Promise<CalibrationOutcome> {
  const t0 = performance.now();
  const sample = await calibrationPhotos();
  const device = await deviceLabel();
  const createdAt = Date.now();
  const out: CalibrationOutcome = { runs: [], cutouts: {}, descriptions: {}, ms: 0 };
  const stop = () => { if (signal.aborted) throw new DOMException('Stopped', 'AbortError'); };
  const save = async (task: AiTask, modelId: string, photos: number, totalMs: number, editedRate?: number) => {
    if (!photos) return;
    const row: CalibrationRun = { id: newId(), task, modelId, photos, msPerPhoto: Math.round(totalMs / photos), editedRate, device, createdAt };
    await db.calibration.put(row);
    out.runs.push(row);
  };
  const downloaded = async (task: AiTask) => {
    const list: ModelSpec[] = [];
    for (const s of MODEL_SPECS) if (s.task === task && s.runtime !== 'mediapipe' && (await isDownloaded(s.id))) list.push(s);
    return list;
  };

  try {
    // Cut-outs, from the original photos.
    for (const s of await downloaded('cutout')) {
      stop();
      let ms = 0, clean = 0, n = 0;
      out.cutouts[s.id] = [];
      for (const { photo } of sample) {
        stop();
        onStep({ task: 'cutout', modelId: s.id, label: s.label, done: n, total: sample.length });
        try {
          if (s.runtime === 'code') {
            const r = await timed(() => run<CutoutOut | null>(null, { type: 'plain', blob: photo.original, force: true }));
            ms += r.ms;
            if (r.value?.clean) clean++;
            if (r.value) out.cutouts[s.id].push(r.value.png);
          } else {
            const key = failKey(s.id, await deviceFor(s));
            const r = await timed(() => withModel(s, () => guarded(key, () => run<CutoutOut | null>(key, { type: 'segment', blob: photo.original, spec: s }))));
            ms += r.ms;
            if (r.value) out.cutouts[s.id].push(r.value.png);
          }
          n++;
        } catch (err) {
          if (signal.aborted) throw err;
          break; // this model doesn't run here; the next one still gets its turn
        }
      }
      await save('cutout', s.id, n, ms, s.runtime === 'code' && n ? 1 - clean / n : undefined);
    }

    // Category, on the approved cut-outs (the user's category is the reference).
    for (const s of await downloaded('classify')) {
      let ms = 0, right = 0, n = 0;
      for (const { item, photo } of sample) {
        stop();
        onStep({ task: 'classify', modelId: s.id, label: s.label, done: n, total: sample.length });
        try {
          const r = await timed(() => analyseWith(s, photo.cutout ?? photo.original));
          ms += r.ms;
          if (r.value.categories[0]?.id === item.category) right++;
          n++;
        } catch (err) {
          if (signal.aborted) throw err;
          break;
        }
      }
      await save('classify', s.id, n, ms, n ? 1 - right / n : undefined);
    }

    // Search language models, on fixed free-form test searches.
    const places = (await db.locations.toArray()).map((l) => ({ id: l.id, name: l.name }));
    for (const s of await downloaded('search')) {
      let ms = 0, ok = 0, n = 0;
      const key = failKey(s.id, await deviceFor(s));
      for (const test of SEARCH_TESTS) {
        stop();
        onStep({ task: 'search', modelId: s.id, label: s.label, done: n, total: SEARCH_TESTS.length });
        try {
          const r = await timed(() => withModel(s, () => guarded(key, () => run<string>(key, { type: 'generate', spec: s, messages: llmMessages(test.query, places), maxTokens: 160 }, { timeoutMs: 180_000 }))));
          ms += r.ms;
          const parsed = parseLlmAnswer(r.value);
          if (parsed && test.ok(parsed)) ok++;
          n++;
        } catch (err) {
          if (signal.aborted) throw err;
          break;
        }
      }
      await save('search', s.id, n, ms, n ? 1 - ok / n : undefined);
    }

    // Descriptions (slow), on three cut-outs.
    for (const s of await downloaded('describe')) {
      let ms = 0, n = 0;
      out.descriptions[s.id] = [];
      const key = failKey(s.id, await deviceFor(s));
      for (const { photo } of sample.slice(0, 3)) {
        stop();
        onStep({ task: 'describe', modelId: s.id, label: s.label, done: n, total: Math.min(3, sample.length) });
        try {
          const r = await timed(() => withModel(s, () => guarded(key, () => run<string>(key, { type: 'describe', blob: photo.cutout ?? photo.original, spec: s }, { timeoutMs: 180_000 }))));
          ms += r.ms;
          out.descriptions[s.id].push(r.value);
          n++;
        } catch (err) {
          if (signal.aborted) throw err;
          break;
        }
      }
      await save('describe', s.id, n, ms);
    }
  } finally {
    await exclusive(async () => releaseAi());
  }
  out.ms = performance.now() - t0;
  return out;
}

/** The export file: timings and scores only, no photos and no item names (R1). */
export async function exportCalibration(): Promise<Blob> {
  const runs = await db.calibration.orderBy('createdAt').toArray();
  const body = {
    app: 'iMannequin',
    version: typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : 'dev',
    exportedAt: new Date().toISOString(),
    device: await deviceLabel(),
    searchTests: SEARCH_TESTS.map((t) => ({ query: t.query, uk: t.uk })),
    runs: runs.map(({ task, modelId, photos, msPerPhoto, editedRate, device, createdAt }) => ({ task, modelId, photos, msPerPhoto, editedRate, device, at: new Date(createdAt).toISOString() })),
  };
  return new Blob([JSON.stringify(body, null, 2)], { type: 'application/json' });
}
