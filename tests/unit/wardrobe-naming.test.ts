import { describe, expect, it } from 'vitest';
import { autoName, ukAdjective } from '../../src/wardrobe/naming';

describe('wardrobe auto-naming (D38)', () => {
  it('names items in English from the main colour and the category', () => {
    expect(autoName('en', 'jeans', 'navy')).toBe('Navy jeans');
    expect(autoName('en', 'sweater', 'rust')).toBe('Rust sweater');
    expect(autoName('en', 'tshirt', 'cream')).toBe('Cream T-shirt');
    expect(autoName('en', 'swimshorts', 'blue')).toBe('Blue swim shorts');
    expect(autoName('en', 'dress')).toBe('Dress');
  });

  it('calls denim jeans blue jeans', () => {
    expect(autoName('en', 'jeans', 'denim')).toBe('Blue jeans');
    expect(autoName('uk', 'jeans', 'denim')).toBe('Сині джинси');
    expect(autoName('en', 'jacket', 'denim')).toBe('Denim jacket');
    expect(autoName('uk', 'jacket', 'denim')).toBe('Джинсова куртка');
  });

  it('agrees Ukrainian adjectives with gender and number', () => {
    expect(autoName('uk', 'jeans', 'navy')).toBe('Темно-сині джинси');
    expect(autoName('uk', 'sweater', 'rust')).toBe('Іржавий светр');
    expect(autoName('uk', 'dress', 'red')).toBe('Червона сукня');
    expect(autoName('uk', 'coat', 'white')).toBe('Біле пальто');
    expect(autoName('uk', 'hoodie', 'blue')).toBe('Синє худі');
    expect(autoName('uk', 'tshirt', 'navy')).toBe('Темно-синя футболка');
    expect(autoName('uk', 'sneakers', 'black')).toBe('Чорні кросівки');
    expect(autoName('uk', 'swimtop', 'yellow')).toBe('Жовтий купальний топ');
    expect(autoName('uk', 'bag', 'multi')).toBe('Різнокольорова сумка');
  });

  it('puts indeclinable colours after the noun', () => {
    expect(autoName('uk', 'jacket', 'khaki')).toBe('Куртка хакі');
    expect(autoName('en', 'jacket', 'khaki')).toBe('Khaki jacket');
  });

  it('inflects hard and soft adjectives', () => {
    expect(ukAdjective('Зелений', 'f')).toBe('зелена');
    expect(ukAdjective('Зелений', 'n')).toBe('зелене');
    expect(ukAdjective('Синій', 'f')).toBe('синя');
    expect(ukAdjective('Синій', 'n')).toBe('синє');
    expect(ukAdjective('Синій', 'pl')).toBe('сині');
    expect(ukAdjective('Хакі', 'f')).toBeUndefined();
  });
});
