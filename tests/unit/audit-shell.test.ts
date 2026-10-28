// Shell, wear log and reminder fixes from docs/bug-audit.md that can be checked without a browser.
import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '../../src/data/db';
import { todayISO } from '../../src/data/repo';
import type { Item } from '../../src/domain/types';
import { shouldRemindBackup } from '../../src/life/reminder';
import { deleteWear, logOutfit, markWorn, wornAt } from '../../src/life/wear';
import { blackbox, watchUnhandled } from '../../src/diag/diagnostics';

const day = 86_400_000;

describe('#36 the backup reminder waits until the wardrobe is worth a copy', () => {
  const now = Date.UTC(2026, 9, 28, 9);
  it('#36 one new garment: no reminder yet', () => {
    expect(shouldRemindBackup({ itemCount: 1, firstItemAt: now - day, now })).toBe(false);
    expect(shouldRemindBackup({ itemCount: 9, firstItemAt: now - 2 * day, now })).toBe(false);
  });
  it('#36 ten garments, or three days after the first one', () => {
    expect(shouldRemindBackup({ itemCount: 10, firstItemAt: now - 60_000, now })).toBe(true);
    expect(shouldRemindBackup({ itemCount: 1, firstItemAt: now - 3 * day, now })).toBe(true);
  });
  it('#36 still monthly after a backup or a dismissal', () => {
    expect(shouldRemindBackup({ itemCount: 20, lastBackupAt: now - 10 * day, now })).toBe(false);
    expect(shouldRemindBackup({ itemCount: 20, backupReminderAt: now - 10 * day, now })).toBe(false);
  });
});

const item = (id: string, lastWornAt?: number): Item => ({
  id, name: id, category: 'jeans', colours: ['navy'], seasons: ['autumn'], status: 'active', createdAt: 1, updatedAt: 1, lastWornAt,
});

describe('#29 wear log writes', () => {
  beforeEach(async () => {
    await db.wear.clear();
    await db.items.clear();
    await db.items.bulkPut([item('jeans'), item('tee')]);
  });

  it('#29 markWorn logs one garment once per day and moves its "last worn" forward', async () => {
    await markWorn('jeans', '2026-10-20');
    await markWorn('jeans', '2026-10-20');
    expect(await db.wear.count()).toBe(1);
    const first = (await db.items.get('jeans'))!.lastWornAt!;
    expect(todayISO(new Date(first))).toBe('2026-10-20');
    await markWorn('jeans');
    expect((await db.items.get('jeans'))!.lastWornAt!).toBeGreaterThan(first);
    expect((await db.items.get('tee'))!.lastWornAt).toBeUndefined();
  });

  it('#29 a look logged for an earlier day doesn’t move "last worn" back', async () => {
    await markWorn('tee');
    const today = (await db.items.get('tee'))!.lastWornAt!;
    await logOutfit('2026-10-01', { slots: { base: 'tee', legs: 'jeans' }, accessories: [], toggles: { tuckIn: false, intoBoots: false } });
    expect((await db.items.get('tee'))!.lastWornAt).toBe(today);
    expect(todayISO(new Date((await db.items.get('jeans'))!.lastWornAt!))).toBe('2026-10-01');
  });

  it('#29 deleting an entry falls back to the latest remaining wear', async () => {
    await markWorn('jeans', '2026-10-10');
    await markWorn('jeans', '2026-10-20');
    const later = (await db.wear.where('date').equals('2026-10-20').first())!;
    await deleteWear(later.id);
    expect(todayISO(new Date((await db.items.get('jeans'))!.lastWornAt!))).toBe('2026-10-10');
    await deleteWear((await db.wear.toArray())[0].id);
    expect((await db.items.get('jeans'))!.lastWornAt).toBeUndefined();
    expect(wornAt({ date: '2026-10-10', createdAt: Date.now() })).toBeLessThan(Date.now());
  });
});

describe('#4 unhandled promise rejections', () => {
  it('#4 are written to the black box', () => {
    const target = new EventTarget();
    watchUnhandled(target as unknown as Window);
    target.dispatchEvent(Object.assign(new Event('unhandledrejection'), { reason: new Error('marker-unit-4') }));
    expect(JSON.stringify(blackbox.log())).toContain('marker-unit-4');
  });
});
