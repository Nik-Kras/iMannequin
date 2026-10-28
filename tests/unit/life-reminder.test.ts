import { describe, expect, it } from 'vitest';
import { BACKUP_INTERVAL_MS, shouldRemindBackup } from '../../src/life/reminder';
import { forecastUrl, roundCoord, weatherKind } from '../../src/data/weather';

const now = Date.UTC(2026, 9, 28, 9);
const day = 86_400_000;

describe('backup reminder', () => {
  it('stays hidden with an empty wardrobe', () => {
    expect(shouldRemindBackup({ itemCount: 0, now })).toBe(false);
  });
  it('shows when there was never a backup', () => {
    expect(shouldRemindBackup({ itemCount: 10, now })).toBe(true);
  });
  it('stays hidden for 30 days after a backup', () => {
    expect(shouldRemindBackup({ itemCount: 12, lastBackupAt: now - 29 * day, now })).toBe(false);
    expect(shouldRemindBackup({ itemCount: 12, lastBackupAt: now - BACKUP_INTERVAL_MS, now })).toBe(true);
  });
  it('stays hidden for 30 days after it was dismissed', () => {
    expect(shouldRemindBackup({ itemCount: 12, backupReminderAt: now - 10 * day, now })).toBe(false);
    expect(shouldRemindBackup({ itemCount: 12, lastBackupAt: now - 90 * day, backupReminderAt: now - 31 * day, now })).toBe(true);
  });
});

describe('weather hint', () => {
  it('rounds the location to about 10 km before it is sent', () => {
    expect(roundCoord(50.4501)).toBe(50.5);
    expect(roundCoord(-0.1278)).toBe(-0.1);
    const url = new URL(forecastUrl(50.4501, 30.5234));
    expect(url.host).toBe('api.open-meteo.com');
    expect(url.searchParams.get('latitude')).toBe('50.5');
    expect(url.searchParams.get('longitude')).toBe('30.5');
  });
  it('maps WMO weather codes to short kinds', () => {
    expect(weatherKind(0)).toBe('clear');
    expect(weatherKind(2)).toBe('partly');
    expect(weatherKind(45)).toBe('fog');
    expect(weatherKind(63)).toBe('rain');
    expect(weatherKind(81)).toBe('showers');
    expect(weatherKind(73)).toBe('snow');
    expect(weatherKind(95)).toBe('storm');
  });
});
