// Backup and restore of the whole wardrobe to one file (R6, F16, architecture §8).
// A `.imannequin` file is a zip: manifest.json holds every record with a format version, and images/ holds every
// Blob (garment originals, cut-outs, thumbnails, the body photo, cut-out and mask). Blobs are stored uncompressed
// (they are already PNG/JPEG); the manifest is deflated.
//
// R6: bump BACKUP_VERSION whenever the data model changes, and teach `migrate` to read older files.
import { Zip, ZipDeflate, ZipPassThrough, strFromU8, strToU8, unzipSync } from 'fflate';
import { db, getSettings } from './db';
import type { AppSettings } from '../domain/types';

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

function decode(value: unknown, files: Record<string, Uint8Array>): unknown {
  if (Array.isArray(value)) return value.map((v) => decode(v, files));
  if (value && typeof value === 'object') {
    const o = value as Record<string, unknown>;
    if (typeof o.$blob === 'string') {
      const data = files[o.$blob];
      if (!data) throw new BackupError('corrupt', `missing ${o.$blob}`);
      return new Blob([data as BlobPart], { type: typeof o.type === 'string' ? o.type : '' });
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

/** Builds the backup file. `onProgress` gets 0–1 while images are packed. */
export async function exportBackup(onProgress?: (p: number) => void): Promise<Blob> {
  const files: { name: string; blob: Blob }[] = [];
  const tables = {} as Record<TableName, unknown[]>;
  const counts = {} as Record<TableName, number>;
  const createdAt = Date.now();
  await db.transaction('r', TABLES.map((t) => db.table(t)), async () => {
    for (const t of TABLES) {
      const rows = await db.table(t).toArray();
      counts[t] = rows.length;
      tables[t] = rows.map((r: { id?: string }, i: number) => encode(r, `${t}-${r.id ?? i}`, files));
    }
  });
  const manifest: BackupManifest = { format: BACKUP_FORMAT, version: BACKUP_VERSION, app: appVersion(), createdAt, counts, tables };

  return new Promise<Blob>((resolve, reject) => {
    const chunks: Uint8Array[] = [];
    const zip = new Zip((err, data, final) => {
      if (err) { reject(err); return; }
      chunks.push(data);
      if (final) resolve(new Blob(chunks as BlobPart[], { type: BACKUP_MIME }));
    });
    const run = async () => {
      const m = new ZipDeflate('manifest.json', { level: 6 });
      zip.add(m);
      m.push(strToU8(JSON.stringify(manifest)), true);
      for (let i = 0; i < files.length; i++) {
        const f = new ZipPassThrough(files[i].name);
        zip.add(f);
        f.push(new Uint8Array(await files[i].blob.arrayBuffer()), true);
        onProgress?.((i + 1) / files.length);
      }
      zip.end();
    };
    run().catch(reject);
  });
}

export interface ParsedBackup { manifest: BackupManifest; files: Record<string, Uint8Array> }

/** Reads and checks a backup file without changing anything. */
export async function readBackup(file: Blob): Promise<ParsedBackup> {
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(new Uint8Array(await file.arrayBuffer()));
  } catch {
    throw new BackupError('notBackup');
  }
  const raw = files['manifest.json'];
  if (!raw) throw new BackupError('notBackup');
  let manifest: BackupManifest;
  try {
    manifest = JSON.parse(strFromU8(raw));
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

/**
 * Replaces everything on the phone with the backup. Settings that belong to this phone (models downloaded here,
 * the install guide) are kept; the backup's time becomes the last backup time.
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
    installGuideDismissed: here.installGuideDismissed,
    lastBackupAt: manifest.createdAt,
    backupReminderAt: undefined,
  };
  rows.settings = [settings];
  await db.transaction('rw', [...TABLES.map((t) => db.table(t)), db.queue], async () => {
    await db.queue.clear();
    for (const t of TABLES) {
      await db.table(t).clear();
      if (rows[t].length) await db.table(t).bulkPut(rows[t]);
    }
  });
}

export const backupFileName = (d = new Date()): string =>
  `imannequin-${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}${BACKUP_EXT}`;
