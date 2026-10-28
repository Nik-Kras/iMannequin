// IndexedDB via Dexie. Everything stays on the phone (R1); backup.ts exports it to a file (R6).
import Dexie, { type Table } from 'dexie';
import type {
  AppSettings, BodyRecord, CalibrationRun, GarmentAnchors, Item, Location, Outfit, Photo, QueueJob, Trip, WearEntry,
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
  }
}

export const db = new IMannequinDB();

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

export async function updateSettings(patch: Partial<AppSettings>): Promise<void> {
  const s = await getSettings();
  await db.settings.put({ ...s, ...patch, id: 'app' });
}

/** Default storage places created on first run (D22); the user renames or adds more. */
export const DEFAULT_PLACES = ['place.wardrobe', 'place.drawers', 'place.underBed', 'place.sofaBox', 'place.hallway', 'place.topShelf'] as const;
