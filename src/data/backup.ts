// Backup and restore of the whole wardrobe to one file (R6, F16, architecture §8).
// A `.imannequin` file is a zip: manifest.json holds every record with a format version, and images/ holds every
// Blob (garment originals, cut-outs, thumbnails, the body photo, cut-out and mask). Blobs are stored uncompressed
// (they are already PNG/JPEG); the manifest is deflated. Readers find entries by name, so their order is free:
// the manifest is written last, once it is known which images could be read.
//
// Memory (bug-audit #5): export folds the zip into Blob parts as it goes; restore reads the zip's directory and
// takes every stored image as a slice of the file, copying a few records at a time into the database.
//
// R6: bump BACKUP_VERSION whenever the data model changes, and teach `migrate` to read older files.
import Dexie from 'dexie';
import { Zip, ZipDeflate, ZipPassThrough, inflateSync, strFromU8, strToU8 } from 'fflate';
import { db, getSettings, withFreshBlobs } from './db';
import type { AppSettings } from '../domain/types';
import { reportError } from '../diag/diagnostics';

export const BACKUP_FORMAT = 'imannequin-backup';
export const BACKUP_VERSION = 1;
export const BACKUP_EXT = '.imannequin';
export const BACKUP_MIME = 'application/zip';

/** Tables written to a backup. The processing queue is transient and is not backed up. */
const TABLES = ['items', 'photos', 'body', 'locations', 'outfits', 'wear', 'trips', 'calibration', 'settings'] as const;
type TableName = (typeof TABLES)[number];

export interface BackupManifest {
  format: typeof BACKUP_FORMAT;
  version: number;
  app: string;
  createdAt: number;
  counts: Record<TableName, number>;
  tables: Record<TableName, unknown[]>;
}

export class BackupError extends Error {
  constructor(public code: 'notBackup' | 'newer' | 'corrupt', message?: string) {
    super(message ?? code);
  }
}

const appVersion = (): string => (typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : 'dev');

const EXT: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif' };

function toBase64(u8: Uint8Array): string {
  let s = '';
  for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode(...u8.subarray(i, i + 0x8000));
  return btoa(s);
}
function fromBase64(b64: string): Uint8Array {
  const s = atob(b64);
  const u8 = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) u8[i] = s.charCodeAt(i);
  return u8;
}

const safe = (s: string) => s.replace(/[^\w.-]+/g, '_');

/**
 * Replaces Blobs with file references and typed arrays with base64, so the record fits in JSON.
 * Blobs are collected in `files` for the zip.
 */
function encode(value: unknown, path: string, files: { name: string; blob: Blob }[]): unknown {
  if (value instanceof Blob) {
    const name = `images/${safe(path)}.${EXT[value.type] ?? 'bin'}`;
    files.push({ name, blob: value });
    return { $blob: name, type: value.type };
  }
  if (value instanceof Float32Array) return { $f32: toBase64(new Uint8Array(value.buffer, value.byteOffset, value.byteLength)) };
  if (Array.isArray(value)) return value.map((v, i) => encode(v, `${path}-${i}`, files));
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[k] = encode(v, `${path}-${k}`, files);
    return out;
  }
  return value;
}

function decode(value: unknown, files: Record<string, Blob>): unknown {
  if (Array.isArray(value)) return value.map((v) => decode(v, files));
  if (value && typeof value === 'object') {
    const o = value as Record<string, unknown>;
    if (typeof o.$blob === 'string') {
      const data = files[o.$blob];
      if (!data) throw new BackupError('corrupt', `missing ${o.$blob}`);
      return data.slice(0, data.size, typeof o.type === 'string' ? o.type : ''); // no copy
    }
    if (typeof o.$f32 === 'string') {
      const u8 = fromBase64(o.$f32);
      return new Float32Array(u8.buffer, u8.byteOffset, u8.byteLength / 4);
    }
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(o)) out[k] = decode(v, files);
    return out;
  }
  return value;
}

/** Removes the references to images that couldn't be read. True when something was removed. */
function dropMissing(value: unknown, missing: Set<string>): boolean {
  if (Array.isArray(value)) return value.map((v) => dropMissing(v, missing)).some(Boolean);
  if (!value || typeof value !== 'object') return false;
  let dropped = false;
  for (const [k, v] of Object.entries(value)) {
    const ref = (v as { $blob?: unknown } | null)?.$blob;
    if (typeof ref === 'string' && missing.has(ref)) {
      delete (value as Record<string, unknown>)[k];
      dropped = true;
    } else if (dropMissing(v, missing)) dropped = true;
  }
  return dropped;
}

/** Zip output is gathered into a Blob part every this many bytes, so the file is never held twice in memory. */
const FLUSH_BYTES = 16 * 1024 * 1024;

export interface BackupResult {
  blob: Blob;
  /** Images that couldn't be read on this phone and were left out (bug-audit #5). */
  skipped: number;
}

/** Builds the backup file. `onProgress` gets 0–1 while images are packed. */
export async function exportBackup(onProgress?: (p: number) => void): Promise<Blob> {
  return (await exportBackupFile(onProgress)).blob;
}

/**
 * Builds the backup file and says how many images were left out. An image that can't be read (WebKit can lose a
 * stored Blob) is skipped instead of failing the whole backup; its record stays, without that image.
 */
export async function exportBackupFile(onProgress?: (p: number) => void): Promise<BackupResult> {
  const files: { name: string; blob: Blob }[] = [];
  const tables = {} as Record<TableName, unknown[]>;
  const counts = {} as Record<TableName, number>;
  const createdAt = Date.now();
  await db.transaction('r', TABLES.map((t) => db.table(t)), async () => {
    for (const t of TABLES) {
      const rows = await db.table(t).toArray();
      tables[t] = rows.map((r: { id?: string }, i: number) => encode(r, `${t}-${r.id ?? i}`, files));
    }
  });

  const parts: Blob[] = [];
  let chunks: Uint8Array[] = [];
  let buffered = 0;
  const flush = () => {
    if (chunks.length) parts.push(new Blob(chunks as BlobPart[]));
    chunks = [];
    buffered = 0;
  };
  let failure: unknown = null;
  let ended = false;
  const zip = new Zip((err, data, final) => {
    if (err) { failure = err; return; }
    chunks.push(data);
    buffered += data.length;
    if (buffered >= FLUSH_BYTES || final) flush();
    if (final) ended = true;
  });

  const skipped = new Set<string>();
  for (let i = 0; i < files.length; i++) {
    let data: Uint8Array | null = null;
    try {
      data = new Uint8Array(await files[i].blob.arrayBuffer());
    } catch (err) {
      skipped.add(files[i].name);
      reportError(err, 'backup.image');
    }
    if (data) {
      const f = new ZipPassThrough(files[i].name);
      zip.add(f);
      f.push(data, true);
    }
    if (failure) throw failure;
    onProgress?.((i + 1) / files.length);
  }

  if (skipped.size) {
    // A body record without its photo, cut-out or mask is unusable: the restored phone asks for a new one.
    tables.body = tables.body.filter((r) => !dropMissing(r, skipped));
    for (const t of TABLES) if (t !== 'body') dropMissing(tables[t], skipped);
  }
  for (const t of TABLES) counts[t] = tables[t].length;
  const manifest: BackupManifest = { format: BACKUP_FORMAT, version: BACKUP_VERSION, app: appVersion(), createdAt, counts, tables };
  const m = new ZipDeflate('manifest.json', { level: 6 });
  zip.add(m);
  m.push(strToU8(JSON.stringify(manifest)), true);
  zip.end();
  if (failure) throw failure;
  if (!ended) throw new Error('The backup file was not finished');
  return { blob: new Blob(parts, { type: BACKUP_MIME }), skipped: skipped.size };
}

export interface ParsedBackup { manifest: BackupManifest; files: Record<string, Blob> }

/**
 * A zip's entries, read through its central directory: stored entries (the images) are slices of the file, so
 * nothing is copied; deflated ones (the manifest) are inflated. Throws on anything that isn't a zip.
 */
async function zipEntries(file: Blob): Promise<Record<string, Blob>> {
  const size = file.size;
  const tailSize = Math.min(size, 22 + 0xffff);
  const tail = new DataView(await file.slice(size - tailSize).arrayBuffer());
  let end = -1;
  for (let i = tailSize - 22; i >= 0; i--) if (tail.getUint32(i, true) === 0x06054b50) { end = i; break; }
  if (end < 0) throw new Error('No zip directory');
  const count = tail.getUint16(end + 10, true);
  const dirSize = tail.getUint32(end + 12, true);
  const dirAt = tail.getUint32(end + 16, true);
  if (dirAt + dirSize > size) throw new Error('Bad zip directory');
  const dir = new DataView(await file.slice(dirAt, dirAt + dirSize).arrayBuffer());
  const out: Record<string, Blob> = {};
  for (let n = 0, p = 0; n < count; n++) {
    if (dir.getUint32(p, true) !== 0x02014b50) throw new Error('Bad zip entry');
    const method = dir.getUint16(p + 10, true);
    const packed = dir.getUint32(p + 20, true);
    const unpacked = dir.getUint32(p + 24, true);
    const nameLen = dir.getUint16(p + 28, true);
    const at = dir.getUint32(p + 42, true);
    const name = strFromU8(new Uint8Array(dir.buffer, dir.byteOffset + p + 46, nameLen));
    p += 46 + nameLen + dir.getUint16(p + 30, true) + dir.getUint16(p + 32, true);
    const local = new DataView(await file.slice(at, at + 30).arrayBuffer());
    if (local.getUint32(0, true) !== 0x04034b50) throw new Error('Bad zip entry');
    const start = at + 30 + local.getUint16(26, true) + local.getUint16(28, true);
    const data = file.slice(start, start + packed);
    if (method === 0) out[name] = data;
    else if (method === 8) out[name] = new Blob([inflateSync(new Uint8Array(await data.arrayBuffer()), { out: new Uint8Array(unpacked) }) as BlobPart]);
    else throw new Error(`Unsupported zip method ${method}`);
  }
  return out;
}

/** Reads and checks a backup file without changing anything. */
export async function readBackup(file: Blob): Promise<ParsedBackup> {
  let files: Record<string, Blob>;
  let manifest: BackupManifest;
  try {
    files = await zipEntries(file);
    manifest = JSON.parse(await files['manifest.json'].text());
  } catch {
    throw new BackupError('notBackup');
  }
  if (manifest?.format !== BACKUP_FORMAT || typeof manifest.version !== 'number' || !manifest.tables) throw new BackupError('notBackup');
  if (manifest.version > BACKUP_VERSION) throw new BackupError('newer');
  return { manifest: migrate(manifest), files };
}

/** Upgrades older backup formats to the current one. Version 1 is the first format. */
function migrate(m: BackupManifest): BackupManifest {
  return m;
}

/** Records written per step of a restore: their images are copied into memory a few at a time. */
const RESTORE_BATCH = 8;

/**
 * Replaces everything on the phone with the backup. Settings that belong to this phone are kept (models downloaded
 * and chosen here, the install guide, the crash-report switch, the weather location: bug-audit #5); the backup's
 * time becomes the last backup time. The queue and the anchors cache are cleared.
 */
export async function applyBackup({ manifest, files }: ParsedBackup): Promise<void> {
  const rows = {} as Record<TableName, unknown[]>;
  for (const t of TABLES) rows[t] = (manifest.tables[t] ?? []).map((r) => decode(r, files));
  const here = await getSettings();
  const saved = (rows.settings[0] ?? {}) as Partial<AppSettings>;
  const settings: AppSettings = {
    ...here,
    ...saved,
    id: 'app',
    onboarded: true,
    modelsReady: here.modelsReady,
    models: here.models,
    installGuideDismissed: here.installGuideDismissed,
    diagnostics: here.diagnostics,
    weather: here.weather,
    lastBackupAt: manifest.createdAt,
    backupReminderAt: undefined,
  };
  rows.settings = [settings];
  await db.transaction('rw', [...TABLES.map((t) => db.table(t)), db.queue, db.queuePhotos, db.queueCuts, db.anchors], async () => {
    await Promise.all([db.queue.clear(), db.queuePhotos.clear(), db.queueCuts.clear(), db.anchors.clear()]);
    for (const t of TABLES) {
      await db.table(t).clear();
      for (let i = 0; i < rows[t].length; i += RESTORE_BATCH) {
        const batch = rows[t].slice(i, i + RESTORE_BATCH) as object[];
        // The images are slices of the picked file, which WebKit can fail to store: in-memory copies, a batch at a time.
        const fresh = t === 'photos' || t === 'body' ? await Dexie.waitFor(Promise.all(batch.map((r) => withFreshBlobs(r)))) : batch;
        await db.table(t).bulkPut(fresh);
      }
    }
  });
}


export const backupFileName = (d = new Date()): string =>
  `imannequin-${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}${BACKUP_EXT}`;
