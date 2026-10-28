import { describe, expect, it } from 'vitest';
import { en, uk, translate, translatePlural } from '../../src/i18n';

describe('i18n', () => {
  it('has the same keys in English and Ukrainian', () => {
    expect(Object.keys(uk).sort()).toEqual(Object.keys(en).sort());
  });
  it('has no empty strings', () => {
    for (const [k, v] of [...Object.entries(en), ...Object.entries(uk)]) expect(v, k).not.toBe('');
  });
  it('interpolates and pluralises Ukrainian', () => {
    expect(translatePlural('uk', 'count.items', 1)).toBe('1 річ');
    expect(translatePlural('uk', 'count.items', 3)).toBe('3 речі');
    expect(translatePlural('uk', 'count.items', 5)).toBe('5 речей');
    expect(translatePlural('en', 'count.items', 1)).toBe('1 item');
    expect(translate('en', 'tab.add')).toBe('Add clothes');
  });
});
