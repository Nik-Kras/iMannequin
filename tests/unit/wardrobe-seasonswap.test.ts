import { describe, expect, it } from 'vitest';
import type { Item, Season } from '../../src/domain/types';
import { defaultPutAway, nextSeason, preselect, seasonOf, selection, swapCandidates } from '../../src/wardrobe/seasonSwap';

const it_ = (id: string, seasons: Season[], locationId?: string, name = id): Item =>
  ({ id, name, category: 'tshirt', colours: [], seasons, locationId, status: 'active', createdAt: 0, updatedAt: 0 });

describe('seasonal swap', () => {
  it('knows the season order and which one just ended', () => {
    expect(nextSeason('summer')).toBe('autumn');
    expect(nextSeason('winter')).toBe('spring');
    expect(seasonOf(new Date('2026-10-28'))).toBe('autumn');
    expect(seasonOf(new Date('2026-01-10'))).toBe('winter');
    expect(defaultPutAway(new Date('2026-10-28'))).toBe('summer');
    expect(defaultPutAway(new Date('2026-04-02'))).toBe('winter');
  });

  it('preselects pieces for the season going away, except ones also worn next season or already there', () => {
    const items = [
      it_('shorts', ['summer'], 'drawers'),
      it_('sage', ['summer', 'spring'], 'drawers'),
      it_('dress', ['summer', 'autumn'], 'wardrobe'),
      it_('sneakers', ['spring', 'summer', 'autumn'], 'hall'),
      it_('linen', ['summer'], 'bed'),
      it_('coat', ['winter']),
    ];
    const pre = preselect(items, 'summer', 'bed');
    expect([...pre].sort()).toEqual(['sage', 'shorts']);
    expect(swapCandidates(items, 'summer').map((i) => i.id)).not.toContain('coat');
  });

  it('applies taps on top of the preselection', () => {
    const items = [it_('a', ['summer']), it_('b', ['summer', 'autumn']), it_('c', ['summer'])];
    const pre = preselect(items, 'summer');
    expect(selection(pre, {}, items)).toEqual(['a', 'c']);
    expect(selection(pre, { a: false, b: true }, items)).toEqual(['b', 'c']);
  });

  it('groups candidates by place order, then name', () => {
    const items = [it_('x', ['winter'], 'p2', 'Zebra'), it_('y', ['winter'], 'p1', 'Beta'), it_('z', ['winter'], 'p1', 'Alpha'), it_('w', ['winter'], undefined, 'Mid')];
    expect(swapCandidates(items, 'winter', ['p1', 'p2']).map((i) => i.id)).toEqual(['w', 'z', 'y', 'x']);
  });
});
