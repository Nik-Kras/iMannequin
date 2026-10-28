import { describe, expect, it } from 'vitest';
import { CATEGORIES } from '../../src/domain/taxonomy';
import type { CategoryId, Item } from '../../src/domain/types';
import { applyFilter, EMPTY_FILTER, groupOf, isFiltered, isNotWorn, monthsAgo, usedBrands } from '../../src/wardrobe/filters';

const NOW = new Date('2026-10-28T12:00:00').getTime();
const DAY = 86_400_000;
let n = 0;
function item(p: Partial<Item> & { category: CategoryId }): Item {
  n++;
  return { id: `i${n}`, name: `Item ${n}`, colours: [], seasons: [], status: 'active', createdAt: NOW - 400 * DAY, updatedAt: NOW, ...p };
}

describe('wardrobe filters', () => {
  it('sorts every category into one Wardrobe chip group', () => {
    expect(groupOf('tshirt')).toBe('tops');
    expect(groupOf('blouse')).toBe('tops');
    expect(groupOf('hoodie')).toBe('layers');
    expect(groupOf('coat')).toBe('outerwear');
    expect(groupOf('jeans')).toBe('bottoms');
    expect(groupOf('skirt')).toBe('bottoms');
    expect(groupOf('dress')).toBe('dresses');
    expect(groupOf('swimsuit')).toBe('dresses');
    expect(groupOf('boots')).toBe('shoes');
    expect(groupOf('hat')).toBe('accessories');
    expect(groupOf('gloves')).toBe('accessories');
    expect(groupOf('bag')).toBe('accessories');
    for (const c of CATEGORIES) expect(groupOf(c.id)).toBeTruthy();
  });

  it('filters by group, colours and seasons (any of)', () => {
    const tee = item({ category: 'tshirt', colours: ['navy'], seasons: ['summer'] });
    const coat = item({ category: 'coat', colours: ['tan', 'black'], seasons: ['autumn', 'winter'] });
    const jeans = item({ category: 'jeans', colours: ['denim'], seasons: ['spring', 'autumn'] });
    const all = [tee, coat, jeans];
    const o = { notWornMonths: 6, now: NOW };
    expect(applyFilter(all, { ...EMPTY_FILTER, group: 'outerwear' }, o)).toEqual([coat]);
    expect(applyFilter(all, { ...EMPTY_FILTER, colours: ['black', 'navy'] }, o)).toEqual([tee, coat]);
    expect(applyFilter(all, { ...EMPTY_FILTER, seasons: ['autumn'] }, o)).toEqual([coat, jeans]);
    expect(applyFilter(all, { ...EMPTY_FILTER, seasons: ['autumn'], colours: ['denim'] }, o)).toEqual([jeans]);
    expect(applyFilter(all, EMPTY_FILTER, o)).toEqual(all);
  });

  it('filters by place, including items without one', () => {
    const a = item({ category: 'tshirt', locationId: 'p1' });
    const b = item({ category: 'tshirt' });
    const o = { notWornMonths: 6, now: NOW };
    expect(applyFilter([a, b], { ...EMPTY_FILTER, place: 'p1' }, o)).toEqual([a]);
    expect(applyFilter([a, b], { ...EMPTY_FILTER, place: 'none' }, o)).toEqual([b]);
  });

  it('finds clothes not worn for N months, counting from when new items were added', () => {
    const recent = item({ category: 'tshirt', lastWornAt: NOW - 20 * DAY });
    const old = item({ category: 'tshirt', lastWornAt: NOW - 200 * DAY });
    const neverOld = item({ category: 'tshirt' });
    const neverNew = item({ category: 'tshirt', createdAt: NOW - 10 * DAY });
    expect(isNotWorn(recent, 6, NOW)).toBe(false);
    expect(isNotWorn(old, 6, NOW)).toBe(true);
    expect(isNotWorn(neverOld, 6, NOW)).toBe(true);
    expect(isNotWorn(neverNew, 6, NOW)).toBe(false);
    expect(isNotWorn(old, 12, NOW)).toBe(false);
    expect(applyFilter([recent, old, neverOld, neverNew], { ...EMPTY_FILTER, notWorn: true }, { notWornMonths: 6, now: NOW })).toEqual([old, neverOld]);
  });

  it('counts calendar months', () => {
    expect(new Date(monthsAgo(6, new Date('2026-10-28T12:00:00').getTime())).getMonth()).toBe(3);
  });

  it('knows when a filter is on', () => {
    expect(isFiltered(EMPTY_FILTER)).toBe(false);
    expect(isFiltered({ ...EMPTY_FILTER, notWorn: true })).toBe(true);
    expect(isFiltered({ ...EMPTY_FILTER, place: 'none' })).toBe(true);
  });

  it('suggests brands already used, most used first', () => {
    const list = [item({ category: 'tshirt', brand: 'Uniqlo' }), item({ category: 'tshirt', brand: 'COS' }), item({ category: 'tshirt', brand: 'uniqlo ' }), item({ category: 'tshirt' })];
    expect(usedBrands(list)).toEqual(['Uniqlo', 'COS']);
  });
});
