import { describe, expect, it } from 'vitest';
import {
  addMonths, daysBetween, formatRange, monthAfterDay, monthCells, monthTitle, outfitWearStats, weekdayLabels, wornByDate,
} from '../../src/life/calendar';
import { draftFromItems, lookTitle, notWornItems } from '../../src/life/wardrobe';
import type { Item, WearEntry } from '../../src/domain/types';

describe('calendar', () => {
  it('lays out October 2026 Monday-first', () => {
    const cells = monthCells({ year: 2026, month: 9 });
    expect(cells.slice(0, 4)).toEqual([null, null, null, '2026-10-01']); // 1 Oct 2026 is a Thursday
    expect(cells).toHaveLength(35);
    expect(cells.filter(Boolean)).toHaveLength(31);
    expect(cells[33]).toBe('2026-10-31');
  });
  it('pads February to whole weeks', () => {
    const cells = monthCells({ year: 2027, month: 1 }); // 1 Feb 2027 is a Monday
    expect(cells[0]).toBe('2027-02-01');
    expect(cells).toHaveLength(28);
  });
  it('moves between months and years', () => {
    expect(addMonths({ year: 2026, month: 0 }, -1)).toEqual({ year: 2025, month: 11 });
    expect(addMonths({ year: 2026, month: 11 }, 1)).toEqual({ year: 2027, month: 0 });
  });
  it('counts days across the clock change', () => {
    expect(daysBetween('2026-10-24', '2026-10-26')).toBe(2);
    expect(daysBetween('2026-10-28', '2026-11-14')).toBe(17);
  });
  it('formats titles and ranges in both languages', () => {
    expect(monthTitle({ year: 2026, month: 9 }, 'en')).toBe('October 2026');
    expect(monthTitle({ year: 2026, month: 9 }, 'uk')).toBe('Жовтень 2026');
    expect(weekdayLabels('en')[0]).toBe('Mon');
    expect(formatRange('2026-11-14', '2026-11-16', 'en')).toBe('14–16 Nov');
    expect(formatRange('2026-11-30', '2026-12-02', 'en')).toBe('30 Nov – 2 Dec');
    expect(monthAfterDay(new Date(2026, 2, 5), 'uk')).toBe('березня');
    expect(monthAfterDay(new Date(2026, 2, 5), 'en')).toBe('March');
  });
  it('merges a day’s wear entries and counts outfit wears once per day', () => {
    const e = (id: string, date: string, itemIds: string[], outfitId?: string, createdAt = 0): WearEntry => ({ id, date, itemIds, outfitId, createdAt });
    const entries = [e('1', '2026-10-28', ['a', 'b'], 'o1', 1), e('2', '2026-10-28', ['b', 'c'], undefined, 2), e('3', '2026-10-12', ['a'], 'o1'), e('4', '2026-10-28', ['a'], 'o1', 3)];
    expect(wornByDate(entries).get('2026-10-28')).toEqual({ itemIds: ['a', 'b', 'c'], outfitIds: ['o1'] });
    expect(outfitWearStats(entries).get('o1')).toEqual({ count: 2, last: '2026-10-28' });
  });
});

describe('wardrobe helpers', () => {
  const now = new Date(2026, 9, 28).getTime();
  const day = 86_400_000;
  const it_ = (id: string, category: Item['category'], extra: Partial<Item> = {}): Item => ({
    id, name: id, category, colours: [], seasons: [], status: 'active', createdAt: now - 400 * day, updatedAt: 0, ...extra,
  });
  it('lists clothes not worn for N months, ignoring new ones', () => {
    const items = [
      it_('Olive skirt', 'skirt', { lastWornAt: now - 230 * day }),
      it_('Navy sweater', 'sweater', { lastWornAt: now - 200 * day }),
      it_('Blue jeans', 'jeans', { lastWornAt: now - day }),
      it_('Old never worn', 'hat'),
      it_('New never worn', 'cap', { createdAt: now - 3 * day }),
      it_('Archived', 'coat', { status: 'archived', lastWornAt: now - 900 * day }),
    ];
    expect(notWornItems(items, 6, now).map((i) => i.id)).toEqual(['Old never worn', 'Olive skirt', 'Navy sweater']);
    expect(notWornItems(items, 12, now).map((i) => i.id)).toEqual(['Old never worn']);
  });
  it('rebuilds a look from worn items and names it', () => {
    const byId = new Map([it_('Rust sweater', 'sweater'), it_('Cream T-shirt', 'tshirt'), it_('Blue jeans', 'jeans'), it_('Canvas tote', 'bag')].map((i) => [i.id, i]));
    const ids = ['Cream T-shirt', 'Rust sweater', 'Blue jeans', 'Canvas tote'];
    expect(draftFromItems(ids, byId)).toEqual({
      slots: { base: 'Cream T-shirt', mid: 'Rust sweater', legs: 'Blue jeans' }, accessories: ['Canvas tote'], toggles: { tuckIn: false, intoBoots: false },
    });
    expect(lookTitle(ids, byId)).toBe('Rust sweater, blue jeans');
  });
});
