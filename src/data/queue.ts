// Processing queue for new garment photos (F2). OWNER: the wardrobe module.
// Runs while the app is open (iPhone pauses web apps in the background), a batch at a time: every waiting photo
// is cut out, then every cut-out is analysed (same-item check, a Photo and an Item in the "To review" inbox), so
// each AI model loads once per batch (bug-audit #6). Jobs live in IndexedDB, so a reload resumes where it stopped.
//
// Storage (bug-audit #1): a job record holds no Blob. The photo bytes are written once to queuePhotos and the
// cut-out once to queueCuts; a job's state changes rewrite only the small record. On WebKit, rewriting a record
// whose Blob was read from IndexedDB fails ("Error preparing Blob/File data") or leaves the Blob dead.
import { liveQuery } from 'dexie';
import { db, getSettings, inMemory, isConnectionError, newId, withReopen } from './db';
import type { CutoutResult, GarmentAnalysis, SearchHit } from '../ai';
import type { CategoryId, ColourName, Item, ItemSuggestion, Lang, Photo, QueueError, QueueJob, QueuePhoto } from '../domain/types';
import { reportError } from '../diag/diagnostics';
import { autoName } from '../wardrobe/naming';
import { makePreview } from '../wardrobe/images';

export interface QueueDeps {
  cutOut: (photo: Blob) => Promise<CutoutResult>;
  analyse: (cutout: Blob) => Promise<GarmentAnalysis>;
  findSame: (embedding: Float32Array, category: CategoryId, excludeItemId?: string, colours?: ColourName[]) => Promise<SearchHit | null>;
  /** Small preview for grids; undefined keeps the cut-out itself. */
  thumb: (cutout: Blob) => Promise<Blob | undefined>;
  lang: () => Promise<Lang>;
  /** Frees the AI models once the queue has nothing left (bug-audit #8). */
  release?: () => Promise<void>;
}

/** The on-device AI and canvas helpers, loaded only when the first job runs. */
export const defaultDeps: QueueDeps = {
  cutOut: async (p) => (await import('../ai')).cutOutGarment(p),
  analyse: async (c) => (await import('../ai')).analyseGarment(c),
  // The colour check needs the new photo's colours, since the item isn't saved yet.
  findSame: async (e, c, x, col) => (await import('../ai')).findSameItemWithColours(e, c, col, x),
  thumb: async (c) => (await import('../wardrobe/images')).makeThumb(c),
  lang: async () => (await getSettings()).lang,
  release: async () => (await import('../ai')).releaseAiWhenIdle(),
};

/** Most photos cut out before they are analysed; the first review items shouldn't wait for a long gallery import. */
export const BATCH = 10;

/**
 * Adds photos to the queue, oldest first. Returns the new job ids. The bytes are stored as in-memory copies (WebKit
 * can fail to store a Blob backed by a picked file or a canvas), each with a small preview (bug-audit #11).
 */
export async function enqueuePhotos(blobs: Blob[]): Promise<string[]> {
  const now = Date.now();
  const jobs: QueueJob[] = [];
  const photos: QueuePhoto[] = [];
  for (const [i, b] of blobs.entries()) {
    const blob = await inMemory(b);
    const preview = await previewOf(blob);
    const id = newId();
    jobs.push({ id, kind: 'garment', state: 'waiting', createdAt: now + i });
    photos.push({ jobId: id, blob, ...(preview ? { preview } : {}) });
  }
  await withReopen(() => db.transaction('rw', db.queue, db.queuePhotos, async () => {
    await db.queuePhotos.bulkPut(photos);
    await db.queue.bulkPut(jobs);
  }));
  return jobs.map((j) => j.id);
}

async function previewOf(photo: Blob): Promise<Blob | undefined> {
  try {
    const p = await makePreview(photo);
    return p && (await inMemory(p));
  } catch {
    return undefined;
  }
}

/** Runs the job again from its photo. */
export async function retryJob(id: string): Promise<void> {
  await withReopen(() => db.transaction('rw', db.queue, db.queueCuts, async () => {
    await db.queueCuts.delete(id);
    await db.queue.update(id, { state: 'waiting', error: undefined, errorCode: undefined, cut: undefined });
  }));
}

/** Removes a job with its photo and cut-out, whatever its state. */
export async function removeJob(id: string): Promise<void> {
  await withReopen(() => db.transaction('rw', db.queue, db.queuePhotos, db.queueCuts, async () => {
    await db.queue.delete(id);
    await db.queuePhotos.delete(id);
    await db.queueCuts.delete(id);
  }));
}

/**
 * When the runner starts: finished jobs have become review items, so they are cleared; photos still inside job
 * records from before database v3 move to queuePhotos; a job left 'working' was interrupted (reload, iPhone killed
 * the page, a failed write), so it waits again.
 */
export async function resumeQueue(): Promise<void> {
  await withReopen(() => db.transaction('rw', db.queue, db.queuePhotos, db.queueCuts, async () => {
    const done = (await db.queue.where('state').equals('done').primaryKeys()) as string[];
    await db.queue.bulkDelete(done);
    await db.queuePhotos.bulkDelete(done);
    await db.queueCuts.bulkDelete(done);
  }));
  await moveLegacyPhotos();
  await withReopen(() => db.queue.where('state').equals('working').modify({ state: 'waiting' }));
}

/** Moves the photo out of job records written before database v3. A photo that can't be read is reported lost. */
async function moveLegacyPhotos(): Promise<void> {
  const legacy = (await withReopen(() => db.queue.toArray())).filter((j) => j.blob);
  for (const { blob, ...job } of legacy) {
    let copy: Blob | null = null;
    try {
      copy = await inMemory(blob!);
    } catch (err) {
      reportError(err, 'queue.legacyPhoto');
    }
    if (copy) {
      const preview = await previewOf(copy);
      const photo: QueuePhoto = { jobId: job.id, blob: copy, ...(preview ? { preview } : {}) };
      await withReopen(() => db.queuePhotos.put(photo));
    }
    const next: QueueJob = copy ? job : { ...job, state: 'failed', error: 'The photo could not be read', errorCode: 'photo-lost' };
    await withReopen(() => db.queue.put(next)); // the record without its Blob
  }
}

const waitingJobs = () => withReopen(() => db.queue.where('state').equals('waiting').sortBy('createdAt'));

/** Processes the oldest waiting job, both steps. Returns false when nothing was waiting. */
export async function processNextJob(deps: QueueDeps = defaultDeps): Promise<boolean> {
  const [job] = await waitingJobs();
  if (!job) return false;
  if (!job.cut) await cutStep(job.id, deps);
  await analyseStep(job.id, deps);
  return true;
}

/**
 * Processes up to `max` waiting jobs in two steps: every photo is cut out, then every cut-out is analysed, so
 * the cut-out model and the classifier each load once per batch (bug-audit #6). Returns false when nothing was
 * waiting. Each job's failure is stored on the job; only a database that can't be written stops the batch.
 */
export async function processBatch(deps: QueueDeps = defaultDeps, max = BATCH): Promise<boolean> {
  const batch = (await waitingJobs()).slice(0, max);
  if (!batch.length) return false;
  for (const job of batch) if (!job.cut) await cutStep(job.id, deps);
  for (const job of batch) await analyseStep(job.id, deps);
  return true;
}

/** Marks a job as being processed. A failure here means the database can't be written: the batch stops. */
const setWorking = (id: string) => withReopen(() => db.queue.update(id, { state: 'working', error: undefined, errorCode: undefined }));

async function cutStep(id: string, deps: QueueDeps): Promise<void> {
  await setWorking(id);
  const photo = await readPhoto(id);
  if (!photo) return;
  let cut: CutoutResult;
  try {
    cut = await deps.cutOut(photo);
  } catch (err) {
    return fail(id, err);
  }
  try {
    const cutout = await inMemory(cut.cutout);
    await withReopen(() => db.transaction('rw', db.queue, db.queueCuts, async () => {
      if (!(await db.queue.get(id))) return; // removed (Retake) while it was running
      await db.queueCuts.put({ jobId: id, cutout, width: cut.width, height: cut.height, model: cut.model });
      await db.queue.update(id, { cut: true });
    }));
  } catch (err) {
    return fail(id, err, 'storage');
  }
}

async function analyseStep(id: string, deps: QueueDeps): Promise<void> {
  const job = await withReopen(() => db.queue.get(id));
  if (!job?.cut || job.state === 'failed' || job.state === 'done') return;
  if (job.state !== 'working') await setWorking(id);
  let rec;
  try {
    rec = await withReopen(() => db.queueCuts.get(id));
  } catch (err) {
    return fail(id, err, 'storage');
  }
  let cutout: Blob;
  try {
    if (!rec) throw new Error('The cut-out is missing');
    cutout = await inMemory(rec.cutout);
  } catch (err) {
    return fail(id, err, 'storage'); // Retry cuts the photo out again
  }
  const original = await readPhoto(id);
  if (!original) return;

  let photo: Photo;
  let item: Item;
  try {
    const analysis = await deps.analyse(cutout);
    const itemId = newId();
    const top = analysis.categories[0]?.id;
    // No category recognised: the type needs one, but the suggestion says none was found and the form asks (#20).
    const category: CategoryId = top ?? 'tshirt';
    let same: SearchHit | null = null;
    if (analysis.embedding && top) {
      // The same-item check is a hint; if it fails, the item is still added.
      same = await deps.findSame(analysis.embedding, category, itemId, analysis.colours).catch(() => null);
    }
    const [thumb, lang] = await Promise.all([deps.thumb(cutout).catch(() => undefined), deps.lang()]);
    const now = Date.now();
    photo = {
      id: newId(), itemId, original, cutout, thumb: thumb ? await inMemory(thumb) : cutout,
      width: rec.width, height: rec.height, cutoutModel: rec.model, cutoutApproved: false,
      embedding: analysis.embedding, embeddingModel: analysis.embeddingModel, createdAt: now,
    };
    const aiFields: NonNullable<ItemSuggestion['aiFields']> = top ? ['name', 'category'] : [];
    if (analysis.colours.length) aiFields.push('colours');
    if (analysis.seasons.length) aiFields.push('seasons');
    const suggestion: ItemSuggestion = {
      categories: analysis.categories.slice(0, 3),
      colours: analysis.colours,
      seasons: analysis.seasons,
      aiFields,
      ...(same ? { sameItemId: same.itemId, sameItemScore: same.score } : {}),
    };
    item = {
      id: itemId, name: autoName(lang, category, analysis.colours[0]), category,
      colours: [...analysis.colours], seasons: [...analysis.seasons], tryOnPhotoId: photo.id,
      status: 'review', suggestion, createdAt: now, updatedAt: now,
    };
  } catch (err) {
    return fail(id, err);
  }
  try {
    await withReopen(() => db.transaction('rw', [db.queue, db.photos, db.items, db.queuePhotos, db.queueCuts], async () => {
      // The job may have been removed (Retake) while it was running.
      if (!(await db.queue.get(id))) return;
      await db.photos.put(photo);
      await db.items.put(item);
      await db.queue.update(id, { state: 'done', itemId: item.id });
      // The photo and cut-out now live in the Photo record.
      await db.queuePhotos.delete(id);
      await db.queueCuts.delete(id);
    }));
  } catch (err) {
    return fail(id, err, 'storage');
  }
}

/** The job's photo as an in-memory copy; null (and the job failed) when it can't be read. */
async function readPhoto(id: string): Promise<Blob | null> {
  let rec;
  try {
    rec = await withReopen(() => db.queuePhotos.get(id));
  } catch (err) {
    await fail(id, err, 'storage');
    return null;
  }
  try {
    if (!rec?.blob) throw new Error('The photo is missing');
    return await inMemory(rec.blob);
  } catch (err) {
    await fail(id, err, 'photo-lost');
    return null;
  }
}

/** Stores the failure on the job. Never throws: a job that can't be marked waits again on the next start. */
async function fail(id: string, err: unknown, code: QueueError = errorCodeOf(err)): Promise<void> {
  reportError(err, 'queue.job', { code });
  const error = err instanceof Error ? err.message : String(err);
  try {
    await withReopen(() => db.queue.update(id, { state: 'failed', error, errorCode: code }));
  } catch (e) {
    reportError(e, 'queue.fail');
  }
}

const CODES: QueueError[] = ['no-garment', 'models', 'network', 'storage', 'photo-lost', 'unreadable', 'other'];

/** Why a job failed (bug-audit #16): the AI module tags its errors; otherwise judged from the error. */
export function errorCodeOf(err: unknown): QueueError {
  const code = (err as { code?: unknown })?.code;
  if (typeof code === 'string' && CODES.includes(code as QueueError)) return code as QueueError;
  const name = (err as { name?: string })?.name ?? '';
  const msg = String((err as Error)?.message ?? err);
  if (name === 'QuotaExceededError' || isConnectionError(err) || /quota|indexeddb|indexed database|object store/i.test(msg)) return 'storage';
  if (/no garment/i.test(msg)) return 'no-garment';
  if (/decode|source image/i.test(msg)) return 'unreadable';
  if ((typeof navigator !== 'undefined' && navigator.onLine === false) || /fetch|network|load failed|offline/i.test(msg)) return 'network';
  return 'other';
}

// One runner per page. React's StrictMode starts and stops effects twice, so starts are counted.
let refs = 0;
let running = false;
let again = false;
let resumed: Promise<void> | null = null;
let retryMs = 0;
let retryTimer: ReturnType<typeof setTimeout> | undefined;
const RETRY_FIRST_MS = 1000;
const RETRY_MAX_MS = 60_000;

/** Never rejects: a failure is reported and the runner tries again later (bug-audit #1). */
async function pump(deps: QueueDeps): Promise<void> {
  if (running) { again = true; return; }
  running = true;
  let failed = false;
  try {
    // Resumes once per page, and again after a failure (a job may have been left 'working').
    resumed ??= resumeQueue();
    try {
      await resumed;
    } catch (err) {
      resumed = null;
      throw err;
    }
    let worked = false;
    do {
      again = false;
      while (refs > 0 && (await processBatch(deps))) worked = true;
    } while (again && refs > 0);
    // Nothing left: give the models' memory back (bug-audit #8).
    if (worked) await deps.release?.().catch((err) => reportError(err, 'queue.release'));
  } catch (err) {
    failed = true;
    resumed = null;
    reportError(err, 'queue.runner');
  } finally {
    running = false;
  }
  clearTimeout(retryTimer);
  retryMs = failed ? Math.min(RETRY_MAX_MS, Math.max(RETRY_FIRST_MS, retryMs * 2)) : 0;
  if (refs > 0 && (failed || again)) retryTimer = setTimeout(() => void pump(deps), retryMs);
}

/** Starts processing waiting jobs; wakes up when jobs are added or retried. Returns a stop function. */
export function startQueueRunner(deps: QueueDeps = defaultDeps): () => void {
  refs++;
  const wake = () => { void pump(deps); };
  const sub = liveQuery(() => db.queue.where('state').equals('waiting').count()).subscribe({
    next: (n) => { if (n > 0) wake(); },
    error: () => {},
  });
  const onVisible = () => { if (document.visibilityState === 'visible') wake(); };
  if (typeof document !== 'undefined') document.addEventListener('visibilitychange', onVisible);
  wake();
  return () => {
    refs--;
    sub.unsubscribe();
    if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', onVisible);
  };
}

/** Test hook: resets the per-page runner state. */
export function _resetRunnerForTests(): void {
  refs = 0;
  running = false;
  again = false;
  resumed = null;
  retryMs = 0;
  clearTimeout(retryTimer);
}
