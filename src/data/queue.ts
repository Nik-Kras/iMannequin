// Processing queue for new garment photos (F2). OWNER: the wardrobe module.
// Runs while the app is open (iPhone pauses web apps in the background), one job at a time:
// cut out → analyse → same-item check → a Photo and an Item waiting in the "To review" inbox.
// Jobs live in IndexedDB, so a reload resumes where it stopped.
import { liveQuery } from 'dexie';
import { db, getSettings, newId } from './db';
import type { CutoutResult, GarmentAnalysis, SearchHit } from '../ai';
import type { CategoryId, ColourName, Item, ItemSuggestion, Lang, Photo, QueueJob } from '../domain/types';
import { autoName } from '../wardrobe/naming';

export interface QueueDeps {
  cutOut: (photo: Blob) => Promise<CutoutResult>;
  analyse: (cutout: Blob) => Promise<GarmentAnalysis>;
  findSame: (embedding: Float32Array, category: CategoryId, excludeItemId?: string, colours?: ColourName[]) => Promise<SearchHit | null>;
  /** Small preview for grids; undefined keeps the cut-out itself. */
  thumb: (cutout: Blob) => Promise<Blob | undefined>;
  lang: () => Promise<Lang>;
}

/** The on-device AI and canvas helpers, loaded only when the first job runs. */
export const defaultDeps: QueueDeps = {
  cutOut: async (p) => (await import('../ai')).cutOutGarment(p),
  analyse: async (c) => (await import('../ai')).analyseGarment(c),
  // The colour check needs the new photo's colours, since the item isn't saved yet.
  findSame: async (e, c, x, col) => (await import('../ai')).findSameItemWithColours(e, c, col, x),
  thumb: async (c) => (await import('../wardrobe/images')).makeThumb(c),
  lang: async () => (await getSettings()).lang,
};

/** Adds photos to the queue, oldest first. Returns the new job ids. */
export async function enqueuePhotos(blobs: Blob[]): Promise<string[]> {
  const now = Date.now();
  const jobs: QueueJob[] = blobs.map((blob, i) => ({ id: newId(), kind: 'garment', blob, state: 'waiting', createdAt: now + i }));
  await db.queue.bulkAdd(jobs);
  return jobs.map((j) => j.id);
}

export async function retryJob(id: string): Promise<void> {
  await db.queue.update(id, { state: 'waiting', error: undefined });
}

export async function removeJob(id: string): Promise<void> {
  await db.queue.delete(id);
}

/**
 * On app start: a job left 'working' was interrupted (reload, iPhone killed the page), so it waits again.
 * Finished jobs have become review items, so they are cleared.
 */
export async function resumeQueue(): Promise<void> {
  await db.transaction('rw', db.queue, async () => {
    await db.queue.where('state').equals('working').modify({ state: 'waiting' });
    await db.queue.where('state').equals('done').delete();
  });
}

/** Processes the oldest waiting job. Returns false when nothing was waiting. */
export async function processNextJob(deps: QueueDeps = defaultDeps): Promise<boolean> {
  const [job] = await db.queue.where('state').equals('waiting').sortBy('createdAt');
  if (!job) return false;
  await db.queue.update(job.id, { state: 'working', error: undefined });
  try {
    // Re-read after the write: on WebKit a Blob held across a rewrite of its record can go dead.
    const blob = (await db.queue.get(job.id))?.blob ?? job.blob;
    const cut = await deps.cutOut(blob);
    const analysis = await deps.analyse(cut.cutout);
    const itemId = newId();
    const top = analysis.categories[0]?.id;
    const category: CategoryId = top ?? 'tshirt';
    let same: SearchHit | null = null;
    if (analysis.embedding) {
      // The same-item check is a hint; if it fails, the item is still added.
      same = await deps.findSame(analysis.embedding, category, itemId, analysis.colours).catch(() => null);
    }
    const [thumb, lang] = await Promise.all([deps.thumb(cut.cutout).catch(() => undefined), deps.lang()]);
    const now = Date.now();
    const photo: Photo = {
      id: newId(), itemId, original: job.blob, cutout: cut.cutout, thumb: thumb ?? cut.cutout,
      width: cut.width, height: cut.height, cutoutModel: cut.model, cutoutApproved: false,
      embedding: analysis.embedding, embeddingModel: analysis.embeddingModel, createdAt: now,
    };
    const aiFields: NonNullable<ItemSuggestion['aiFields']> = ['name'];
    if (top) aiFields.push('category');
    if (analysis.colours.length) aiFields.push('colours');
    if (analysis.seasons.length) aiFields.push('seasons');
    const suggestion: ItemSuggestion = {
      categories: analysis.categories.slice(0, 3),
      colours: analysis.colours,
      seasons: analysis.seasons,
      aiFields,
      ...(same ? { sameItemId: same.itemId, sameItemScore: same.score } : {}),
    };
    const item: Item = {
      id: itemId, name: autoName(lang, category, analysis.colours[0]), category,
      colours: [...analysis.colours], seasons: [...analysis.seasons], tryOnPhotoId: photo.id,
      status: 'review', suggestion, createdAt: now, updatedAt: now,
    };
    await db.transaction('rw', db.queue, db.photos, db.items, async () => {
      // The job may have been removed (Retake) while it was running.
      if (!(await db.queue.get(job.id))) return;
      await db.photos.add(photo);
      await db.items.add(item);
      await db.queue.update(job.id, { state: 'done', itemId });
    });
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    await db.queue.update(job.id, { state: 'failed', error });
  }
  return true;
}

// One runner per page. React's StrictMode starts and stops effects twice, so starts are counted.
let refs = 0;
let running = false;
let again = false;
let resumed: Promise<void> | null = null;

async function pump(deps: QueueDeps): Promise<void> {
  if (running) { again = true; return; }
  running = true;
  try {
    resumed ??= resumeQueue();
    await resumed;
    do {
      again = false;
      while (refs > 0 && (await processNextJob(deps)));
    } while (again && refs > 0);
  } finally {
    running = false;
  }
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
}
