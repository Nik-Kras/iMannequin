// IndexedDB via Dexie. Everything stays on the phone (R1); backup.ts exports it to a file (R6).
import Dexie, { type Table } from 'dexie';
import type {
  AppSettings, BodyRecord, CalibrationRun, GarmentAnchors, Item, Location, Outfit, Photo, QueueCut, QueueJob, QueuePhoto, Trip, WearEntry,
} from '../domain/types';

/** Garment anchors cached per photo. Kept apart from Photo so caching them never rewrites a record
 *  that holds Blobs: on WebKit, reads in flight while such a record is rewritten get dead Blob handles. */
export interface AnchorCache { photoId: string; anchors: GarmentAnchors }

export class IMannequinDB extends Dexie {
  items!: Table<Item, string>;
  photos!: Table<Photo, string>;
  body!: Table<BodyRecord, string>;
  locations!: Table<Location, string>;
  outfits!: Table<Outfit, string>;
  wear!: Table<WearEntry, string>;
  trips!: Table<Trip, string>;
  queue!: Table<QueueJob, string>;
  settings!: Table<AppSettings, string>;
  calibration!: Table<CalibrationRun, string>;
  anchors!: Table<AnchorCache, string>;
  queuePhotos!: Table<QueuePhoto, string>;
  queueCuts!: Table<QueueCut, string>;

  constructor(name = 'imannequin') {
    super(name);
    this.version(1).stores({
      items: 'id, status, category, locationId, createdAt, updatedAt, lastWornAt',
      photos: 'id, itemId',
      body: 'id',
      locations: 'id, order',
      outfits: 'id, createdAt',
      wear: 'id, date, outfitId',
      trips: 'id, start, archived',
      queue: 'id, state, createdAt',
      settings: 'id',
      calibration: 'id, task, modelId, createdAt',
    });
    this.version(2).stores({ anchors: 'photoId' });
    // Queue photos and cut-outs in their own write-once tables, so a job's state changes never rewrite a Blob
    // (bug-audit #1). Older queue records keep their `blob` until the runner moves it (queue.ts, moveLegacyPhotos):
    // copying a Blob needs an await, which would end this upgrade transaction, and one unreadable photo here
    // would stop the whole database from opening.
    this.version(3).stores({ queuePhotos: 'jobId', queueCuts: 'jobId' });
  }
}

export const db = new IMannequinDB();

/**
 * Runs a write, and once more after reopening the database if the connection was lost. iOS drops the
 * IndexedDB connection of a page that was in the background (the camera or photo picker was open):
 * "UnknownError: Connection to Indexed Database server lost".
 */
export async function withReopen<T>(write: () => Promise<T>, onRetry?: (err: unknown) => void, timeoutMs = WRITE_TIMEOUT_MS): Promise<T> {
  try {
    return await withTimeout(write(), timeoutMs);
  } catch (err) {
    if (!isConnectionError(err)) throw err;
    onRetry?.(err);
    db.close({ disableAutoOpen: false });
    await db.open();
    return withTimeout(write(), timeoutMs);
  }
}

/** A write that hasn't settled after this long is treated as a lost connection (iOS can leave it hanging). */
export const WRITE_TIMEOUT_MS = 10_000;

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  if (!ms) return p;
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new DOMException('IndexedDB did not answer in time', 'UnknownError')), ms);
  });
  return Promise.race([p, timeout]).finally(() => clearTimeout(timer));
}

/** Errors that mean the database connection is gone (worth one reopen and retry). */
export function isConnectionError(err: unknown): boolean {
  const name = (err as { name?: string })?.name ?? '';
  const inner = (err as { inner?: { name?: string } })?.inner?.name ?? '';
  return [name, inner].some((n) => ['UnknownError', 'InvalidStateError', 'DatabaseClosedError'].includes(n));
}

/**
 * A record with every Blob field replaced by an in-memory copy. Rewrite Blob-holding records only like this:
 * on WebKit, storing a record whose Blobs are handles read from IndexedDB can leave them dead (bug-audit #2).
 */
export async function withFreshBlobs<T extends object>(record: T): Promise<T> {
  const out = { ...record } as Record<string, unknown>;
  for (const [k, v] of Object.entries(out)) if (v instanceof Blob) out[k] = await inMemory(v);
  return out as T;
}

/** Copies a Blob's bytes into memory. WebKit can fail to store a Blob backed by a picked file or a canvas. */
export async function inMemory(b: Blob): Promise<Blob> {
  return new Blob([await b.arrayBuffer()], { type: b.type || 'application/octet-stream' });
}

export const newId = (): string =>
  (globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`);

export function defaultSettings(lang: AppSettings['lang'] = 'en'): AppSettings {
  return {
    id: 'app',
    lang,
    mannequin: 'photo',
    weather: { enabled: false },
    models: {},
    notWornMonths: 6,
    onboarded: false,
    modelsReady: false,
    installGuideDismissed: false,
    diagnostics: true,
    draft: { slots: {}, accessories: [], toggles: { tuckIn: false, intoBoots: false } },
  };
}

export async function getSettings(): Promise<AppSettings> {
  const s = await db.settings.get('app');
  if (s) return { ...defaultSettings(s.lang), ...s };
  const lang = typeof navigator !== 'undefined' && navigator.language?.toLowerCase().startsWith('uk') ? 'uk' : 'en';
  const fresh = defaultSettings(lang);
  await db.settings.put(fresh);
  return fresh;
}

/** Read and write in one transaction, so quick taps never overwrite each other (bug-audit #23). */
export async function updateSettings(patch: Partial<AppSettings>): Promise<void> {
  await db.transaction('rw', db.settings, async () => {
    const s = await getSettings();
    await db.settings.put({ ...s, ...patch, id: 'app' });
  });
}

/** Default storage places created on first run (D22); the user renames or adds more. */
export const DEFAULT_PLACES = ['place.wardrobe', 'place.drawers', 'place.underBed', 'place.sofaBox', 'place.hallway', 'place.topShelf'] as const;
