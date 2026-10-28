import { describe, expect, it } from 'vitest';
import type { CategoryId, OutfitDraft } from '../../src/domain/types';
import { draftItemIds, orderedItemIds } from '../../src/tryon/layers';

const cats: Record<string, CategoryId> = {
  tee: 'tshirt', sw: 'sweater', coat: 'coat', jeans: 'jeans', leg: 'leggings', boots: 'boots', dress: 'dress',
  scarf: 'scarf', tie: 'tie', hat: 'hat', gl: 'gloves', belt: 'belt', bag: 'bag', specs: 'glasses', ring: 'jewellery',
};
const items = Object.entries(cats).map(([id, category]) => ({ id, category }));
const draft = (slots: OutfitDraft['slots'], accessories: string[] = [], tuckIn = false, intoBoots = false): OutfitDraft => ({ slots, accessories, toggles: { tuckIn, intoBoots } });

describe('layering (try-on §6, D40)', () => {
  const full = { base: 'tee', mid: 'sw', outer: 'coat', legs: 'jeans', feet: 'boots', neck: 'scarf', head: 'hat', hands: 'gl' };

  it('draws bottom to top in the default order', () => {
    expect(orderedItemIds(draft(full, ['belt', 'bag', 'specs']), items)).toEqual(['boots', 'jeans', 'tee', 'belt', 'sw', 'coat', 'scarf', 'gl', 'bag', 'hat', 'specs']);
  });

  it('Tuck in puts the base top under the trousers', () => {
    const o = orderedItemIds(draft(full, [], true), items);
    expect(o.indexOf('tee')).toBeLessThan(o.indexOf('jeans'));
    expect(o.indexOf('sw')).toBeGreaterThan(o.indexOf('jeans'));
  });

  it('Trousers into boots draws the boots over the trousers', () => {
    const off = orderedItemIds(draft(full), items);
    const on = orderedItemIds(draft(full, [], false, true), items);
    expect(off.indexOf('boots')).toBeLessThan(off.indexOf('jeans'));
    expect(on.indexOf('boots')).toBeGreaterThan(on.indexOf('jeans'));
  });

  it('puts leggings under everything and a tie under the jumper, a scarf over the coat', () => {
    const o = orderedItemIds(draft({ base: 'tee', mid: 'sw', legs: 'leg', feet: 'boots', neck: 'tie' }), items);
    expect(o[0]).toBe('leg');
    expect(o.indexOf('tie')).toBeLessThan(o.indexOf('sw'));
    const s = orderedItemIds(draft({ outer: 'coat', neck: 'scarf' }), items);
    expect(s.indexOf('scarf')).toBeGreaterThan(s.indexOf('coat'));
  });

  it('draws a dress where the base top would be and lists every item once', () => {
    const d = draft({ full: 'dress', outer: 'coat', feet: 'boots' }, ['ring']);
    expect(orderedItemIds(d, items)).toEqual(['boots', 'dress', 'coat', 'ring']);
    expect(draftItemIds(draft({ full: 'dress' }, ['ring', 'ring']))).toEqual(['dress', 'ring']);
  });
});
