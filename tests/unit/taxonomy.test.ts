import { describe, expect, it } from 'vitest';
import { CATEGORY, layerOrder, placeItem } from '../../src/domain/taxonomy';
import type { CategoryId } from '../../src/domain/types';

describe('taxonomy', () => {
  it('a dress clears the top and bottoms, and a top clears the dress', () => {
    let s = placeItem({ base: 't', legs: 'j' }, 'full', 'd');
    expect(s).toEqual({ full: 'd' });
    s = placeItem(s, 'base', 't2');
    expect(s).toEqual({ base: 't2' });
  });
  it('orders layers per try-on §6, with the toggles', () => {
    const cats: Record<string, CategoryId> = { t: 'tshirt', j: 'jeans', b: 'boots', c: 'coat', s: 'scarf', h: 'hat' };
    const base = { slots: { base: 't', legs: 'j', feet: 'b', outer: 'c', neck: 's', head: 'h' }, accessories: [], categoryOf: (id: string) => cats[id] };
    expect(layerOrder({ ...base, tuckIn: false, intoBoots: false })).toEqual(['b', 'j', 't', 'c', 's', 'h']);
    expect(layerOrder({ ...base, tuckIn: true, intoBoots: true })).toEqual(['t', 'j', 'b', 'c', 's', 'h']);
  });
  it('every category has a zone and an anchor group', () => {
    for (const c of Object.values(CATEGORY)) { expect(c.zone).toBeTruthy(); expect(c.group).toBeTruthy(); }
  });
});
