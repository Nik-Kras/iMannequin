import { describe, expect, it } from 'vitest';
import { facetMatch, mergeLlm, needsLanguageModel, parseLlmAnswer, parseQuery, sameStem, textMatch, tokenize } from '../../src/ai/query';
import { rank } from '../../src/ai/search';
import type { Item } from '../../src/domain/types';

const PLACES = [
  { id: 'p-bed', name: 'Under the bed' },
  { id: 'p-sofa', name: 'Sofa box' },
  { id: 'p-shelf', name: 'Top shelf' },
  { id: 'u-bed', name: 'Під ліжком' },
  { id: 'u-sofa', name: 'Диван' },
  { id: 'u-shelf', name: 'Верхня полиця' },
];

describe('tokenize', () => {
  it('keeps hyphens and apostrophes inside words', () => {
    expect(tokenize("Blue T-shirt, в’єтнамки & темно-синій!")).toEqual(['blue', 't-shirt', "в'єтнамки", 'темно-синій']);
  });
});

describe('keyword parser, English', () => {
  it('reads colour + category', () => {
    const q = parseQuery('blue striped shirt');
    expect(q.colours).toEqual(['blue']);
    expect(q.categories).toEqual(['shirt']);
    expect(q.rest).toEqual(['striped']);
    expect(needsLanguageModel(q)).toBe(false);
    expect(q.phrase).toBe('blue striped button-up shirt');
  });

  it('reads "something warm for winter"', () => {
    const q = parseQuery('something warm for winter');
    expect(q.warmth).toBe('warm');
    expect(q.seasons).toEqual(['winter']);
    expect(q.rest).toEqual([]);
    expect(needsLanguageModel(q)).toBe(false);
  });

  it('prefers multi-word colours over warmth words', () => {
    const q = parseQuery('light blue jeans');
    expect(q.colours).toEqual(['blue']);
    expect(q.warmth).toBeUndefined();
    expect(q.categories).toEqual(['jeans']);
  });

  it('handles plurals and synonyms', () => {
    expect(parseQuery('dresses').categories).toEqual(['dress']);
    expect(parseQuery('hoodies').categories).toEqual(['hoodie']);
    expect(parseQuery('trainers').categories).toEqual(['sneakers']);
    expect(parseQuery('grey jumpers').categories).toEqual(['sweater']);
    expect(parseQuery('autumn fall').seasons).toEqual(['autumn']);
    expect(parseQuery('swim shorts').categories).toEqual(['swimshorts']);
  });

  it('maps zone words', () => {
    expect(parseQuery('footwear').zones).toEqual(['feet']);
    expect(parseQuery('outerwear').categories).toEqual(['jacket', 'coat', 'blazer']);
  });

  it('does not read "warm" as the place "Wardrobe"', () => {
    const q = parseQuery('something warm for winter', [{ id: 'w', name: 'Wardrobe' }, ...PLACES]);
    expect(q.placeIds).toEqual([]);
    expect(q.warmth).toBe('warm');
  });

  it('finds the user\'s place names', () => {
    expect(parseQuery('what is under the bed', PLACES).placeIds).toEqual(['p-bed']);
    expect(parseQuery('jeans in the sofa', PLACES).placeIds).toEqual(['p-sofa']);
    const q = parseQuery('top shelf', PLACES);
    expect(q.placeIds).toEqual(['p-shelf']);
    expect(q.categories).toEqual([]); // "top" belonged to the place name
  });

  it('asks for the language model only for free-form text it can\'t map', () => {
    expect(needsLanguageModel(parseQuery('something to wear to a summer wedding'))).toBe(false); // summer mapped
    expect(needsLanguageModel(parseQuery('what goes with my favourite interview look'))).toBe(true);
  });
});

describe('keyword parser, Ukrainian', () => {
  it('reads inflected colours and categories', () => {
    const q = parseQuery('червону сукню');
    expect(q.colours).toEqual(['red']);
    expect(q.categories).toEqual(['dress']);
    expect(needsLanguageModel(q)).toBe(false);
  });

  it('reads "щось тепле на зиму"', () => {
    const q = parseQuery('щось тепле на зиму');
    expect(q.warmth).toBe('warm');
    expect(q.seasons).toEqual(['winter']);
    expect(q.rest).toEqual([]);
  });

  it('tells denim (colour) from jeans (category)', () => {
    const q = parseQuery('джинсова куртка');
    expect(q.colours).toEqual(['denim']);
    expect(q.categories).toEqual(['jacket']);
    expect(parseQuery('чорні джинси').categories).toEqual(['jeans']);
  });

  it('reads navy and blue', () => {
    expect(parseQuery('темно-синій светр').colours).toEqual(['navy']);
    expect(parseQuery('синя сорочка').colours).toEqual(['blue']);
    expect(parseQuery('блакитні шорти').colours).toEqual(['blue']);
  });

  it('reads seasons in their adverb forms', () => {
    expect(parseQuery('що носити влітку').seasons).toEqual(['summer']);
    expect(parseQuery('куртка на весну').seasons).toEqual(['spring']);
    expect(parseQuery('восени').seasons).toEqual(['autumn']);
  });

  it('finds place names in other cases', () => {
    expect(parseQuery('що лежить під ліжком', PLACES).placeIds).toEqual(['u-bed']);
    expect(parseQuery('светри в дивані', PLACES).placeIds).toEqual(['u-sofa']);
    const q = parseQuery('на верхній полиці', PLACES);
    expect(q.placeIds).toEqual(['u-shelf']);
    expect(q.zones).toEqual([]); // "верхній" belonged to the place name
  });

  it('needs the language model for unmapped Ukrainian words', () => {
    const q = parseQuery('щось для співбесіди');
    expect(q.rest).toEqual(['співбесіди']);
    expect(needsLanguageModel(q)).toBe(true);
    expect(q.phrase).toBe('clothing'); // Cyrillic never reaches CLIP
  });
});

describe('stems and text matches', () => {
  it('sameStem accepts changed endings only', () => {
    expect(sameStem('дивані', 'диван')).toBe(true);
    expect(sameStem('ліжку', 'ліжком')).toBe(true);
    expect(sameStem('box', 'boots')).toBe(false);
  });

  it('textMatch finds brand words', () => {
    expect(textMatch({ name: 'Blue jeans', brand: "Levi's", notes: '' }, ["levi's"])).toBe(1);
    expect(textMatch({ name: 'Blue jeans' }, ['zara'])).toBe(0);
  });
});

describe('language model answer', () => {
  it('reads JSON wrapped in prose and drops unknown values', () => {
    const a = parseLlmAnswer('Sure! {"categories":["coat","parka"],"colours":["gray"],"seasons":["fall"],"places":["Диван"],"warmth":"warm","phrase":"warm coat for rain"} done');
    expect(a).toEqual({ categories: ['coat'], colours: ['grey'], seasons: ['autumn'], places: ['Диван'], warmth: 'warm', phrase: 'warm coat for rain' });
  });

  it('returns null for garbage', () => {
    expect(parseLlmAnswer('no json here')).toBeNull();
    expect(parseLlmAnswer('{oops')).toBeNull();
  });

  it('ignores a thinking block and a Ukrainian phrase', () => {
    const a = parseLlmAnswer('<think>{"categories":["dress"]}</think>{"categories":["shorts"],"phrase":"шорти"}');
    expect(a?.categories).toEqual(['shorts']);
    expect(a?.phrase).toBeUndefined();
  });

  it('merges with the keyword parse without overriding it', () => {
    const q = parseQuery('щось для співбесіди', PLACES);
    const m = mergeLlm(q, { categories: ['blazer', 'shirt'], colours: [], seasons: [], places: ['диван'], phrase: 'smart blazer for a job interview' }, PLACES);
    expect(m.categories).toEqual(['blazer', 'shirt']);
    expect(m.placeIds).toEqual(['u-sofa']);
    expect(m.phrase).toBe('smart blazer for a job interview');
    expect(m.rest).toEqual([]);
  });
});

describe('filters and ranking', () => {
  const item = (id: string, p: Partial<Item>): Item => ({
    id, name: id, category: 'tshirt', colours: [], seasons: [], status: 'active', createdAt: 0, updatedAt: 0, ...p,
  });
  const items = [
    item('navy-sweater', { category: 'sweater', colours: ['navy'], seasons: ['autumn', 'winter'], locationId: 'u-sofa' }),
    item('red-dress', { category: 'dress', colours: ['red'], seasons: ['summer'] }),
    item('coat', { category: 'coat', colours: ['tan'], seasons: ['autumn', 'winter'] }),
    item('tee', { category: 'tshirt', colours: ['white'], seasons: ['spring', 'summer'], brand: 'Uniqlo' }),
  ];

  it('facetMatch: AND across facets, OR within one', () => {
    const q = parseQuery('warm navy or tan');
    expect(facetMatch(items[0], q)).toBe(1);
    expect(facetMatch(items[2], q)).toBe(1);
    expect(facetMatch(items[1], q)).toBe(0);
  });

  it('ranks items that match every filter', () => {
    const hits = rank(items, parseQuery('щось тепле на зиму'), null);
    expect(hits.map((h) => h.itemId).sort()).toEqual(['coat', 'navy-sweater']);
  });

  it('uses CLIP similarity to order the filtered items', () => {
    const sims = new Map([['coat', 0.31], ['navy-sweater', 0.25], ['red-dress', 0.2], ['tee', 0.21]]);
    const hits = rank(items, parseQuery('something warm'), sims);
    expect(hits[0].itemId).toBe('coat');
  });

  it('without filters, keeps CLIP\'s closest band and text matches', () => {
    const sims = new Map([['coat', 0.24], ['navy-sweater', 0.23], ['red-dress', 0.31], ['tee', 0.2]]);
    const q = parseQuery('uniqlo outfit for a party');
    const hits = rank(items, q, sims).map((h) => h.itemId);
    expect(hits).toContain('red-dress');
    expect(hits).toContain('tee'); // brand match
    expect(hits).not.toContain('coat');
  });

  it('places filter by location', () => {
    expect(rank(items, parseQuery('в дивані', PLACES), null).map((h) => h.itemId)).toEqual(['navy-sweater']);
  });
});
