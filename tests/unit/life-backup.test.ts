import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { strToU8, zipSync } from 'fflate';
import { db, getSettings, updateSettings } from '../../src/data/db';
import { applyBackup, BackupError, BACKUP_VERSION, exportBackup, readBackup } from '../../src/data/backup';
import type { BodyRecord, Item, Location, Outfit, Photo, Trip, WearEntry } from '../../src/domain/types';

// Synthetic bytes only (R2): no real images.
const png = (...bytes: number[]) => new Blob([new Uint8Array([0x89, 0x50, 0x4e, 0x47, ...bytes])], { type: 'image/png' });
const bytes = async (b: Blob) => Array.from(new Uint8Array(await b.arrayBuffer()));

async function seed() {
  const loc: Location = { id: 'loc1', name: 'Under the bed', order: 0 };
  const item: Item = {
    id: 'it1', name: 'Navy jeans', category: 'jeans', colours: ['navy'], seasons: ['autumn'], locationId: 'loc1',
    tryOnPhotoId: 'ph1', status: 'active', createdAt: 1, updatedAt: 2, lastWornAt: 3,
    fit: { dx: 0.1, dy: -0.2, scale: 1.05, rotate: 2 },
  };
  const photo: Photo = {
    id: 'ph1', itemId: 'it1', original: png(1, 2, 3), cutout: png(4, 5), thumb: png(6), width: 640, height: 900,
    cutoutApproved: true, cutoutModel: 'plain-bg', embedding: new Float32Array([0.25, -1.5, 3]), embeddingModel: 'clip', createdAt: 1,
  };
  const body: BodyRecord = {
    id: 'current', photo: png(7, 7), cutout: png(8), mask: png(9), canonical: { width: 1000, height: 2000 },
    landmarks: [{ x: 1, y: 2, z: 0, visibility: 0.9 }], createdAt: 5,
  };
  const outfit: Outfit = { id: 'o1', name: 'Office Monday', slots: { legs: 'it1' }, accessories: [], toggles: { tuckIn: true, intoBoots: false }, createdAt: 1, updatedAt: 1 };
  const wear: WearEntry = { id: 'w1', date: '2026-10-28', outfitId: 'o1', itemIds: ['it1'], createdAt: 1 };
  const trip: Trip = { id: 't1', name: 'Sea', start: '2026-11-14', end: '2026-11-16', entries: [{ id: 'e1', kind: 'item', refId: 'it1', packed: true }], archived: false, createdAt: 1 };
  await db.locations.put(loc);
  await db.items.put(item);
  await db.photos.put(photo);
  await db.body.put(body);
  await db.outfits.put(outfit);
  await db.wear.put(wear);
  await db.trips.put(trip);
  await updateSettings({ lang: 'uk', mannequin: 'outline', notWornMonths: 9, onboarded: true, weather: { enabled: true, lat: 50.4, lon: 30.5 } });
}

async function wipe() {
  await Promise.all(db.tables.map((t) => t.clear()));
}

describe('backup', () => {
  beforeEach(wipe);

  it('round-trips every record and every image', async () => {
    await seed();
    const file = await exportBackup();
    expect(file.size).toBeGreaterThan(100);

    // The phone loses everything, and has some other data meanwhile.
    await wipe();
    await db.items.put({ id: 'other', name: 'Other', category: 'hat', colours: [], seasons: [], status: 'active', createdAt: 0, updatedAt: 0 });
    await updateSettings({ modelsReady: true, installGuideDismissed: true });

    const parsed = await readBackup(file);
    expect(parsed.manifest.version).toBe(BACKUP_VERSION);
    expect(parsed.manifest.counts.items).toBe(1);
    await applyBackup(parsed);

    expect(await db.items.get('other')).toBeUndefined();
    const item = await db.items.get('it1');
    expect(item?.name).toBe('Navy jeans');
    expect(item?.fit).toEqual({ dx: 0.1, dy: -0.2, scale: 1.05, rotate: 2 });

    const photo = await db.photos.get('ph1');
    expect(photo?.original).toBeInstanceOf(Blob);
    expect(photo?.original.type).toBe('image/png');
    expect(await bytes(photo!.original)).toEqual([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);
    expect(await bytes(photo!.cutout!)).toEqual([0x89, 0x50, 0x4e, 0x47, 4, 5]);
    expect(await bytes(photo!.thumb!)).toEqual([0x89, 0x50, 0x4e, 0x47, 6]);
    expect(photo?.embedding).toBeInstanceOf(Float32Array);
    expect(Array.from(photo!.embedding!)).toEqual([0.25, -1.5, 3]);

    const body = await db.body.get('current');
    expect(await bytes(body!.photo)).toEqual([0x89, 0x50, 0x4e, 0x47, 7, 7]);
    expect(await bytes(body!.mask)).toEqual([0x89, 0x50, 0x4e, 0x47, 9]);
    expect(body?.landmarks).toEqual([{ x: 1, y: 2, z: 0, visibility: 0.9 }]);

    expect(await db.locations.toArray()).toEqual([{ id: 'loc1', name: 'Under the bed', order: 0 }]);
    expect((await db.outfits.get('o1'))?.toggles.tuckIn).toBe(true);
    expect((await db.wear.get('w1'))?.itemIds).toEqual(['it1']);
    expect((await db.trips.get('t1'))?.entries[0].packed).toBe(true);

    const s = await getSettings();
    expect(s.lang).toBe('uk');
    expect(s.mannequin).toBe('outline');
    expect(s.notWornMonths).toBe(9);
    expect(s.weather).toEqual({ enabled: true, lat: 50.4, lon: 30.5 });
    // Device-specific settings stay with this phone; the backup time becomes the last backup.
    expect(s.modelsReady).toBe(true);
    expect(s.installGuideDismissed).toBe(true);
    expect(s.lastBackupAt).toBe(parsed.manifest.createdAt);
  });

  it('rejects files that are not backups', async () => {
    await expect(readBackup(new Blob(['hello']))).rejects.toBeInstanceOf(BackupError);
    const zip = zipSync({ 'manifest.json': strToU8(JSON.stringify({ format: 'something-else', version: 1, tables: {} })) });
    await expect(readBackup(new Blob([zip as BlobPart]))).rejects.toMatchObject({ code: 'notBackup' });
  });

  it('refuses backups from a newer format version', async () => {
    const zip = zipSync({ 'manifest.json': strToU8(JSON.stringify({ format: 'imannequin-backup', version: BACKUP_VERSION + 1, tables: {} })) });
    await expect(readBackup(new Blob([zip as BlobPart]))).rejects.toMatchObject({ code: 'newer' });
  });
});
