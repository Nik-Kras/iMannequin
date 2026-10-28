// Auto-filled item names (D38): main colour + category, in the user's language ("Navy jeans", "Темно-сині джинси").
// Ukrainian adjectives agree with the noun's grammatical gender and number.
import type { CategoryId, ColourName, Lang } from '../domain/types';
import { translate } from '../i18n';

type Gender = 'm' | 'f' | 'n' | 'pl';

/** Grammatical gender of each Ukrainian category name in i18n (`cat.<id>`). */
const UK_GENDER: Record<CategoryId, Gender> = {
  tshirt: 'f', top: 'm', shirt: 'f', blouse: 'f', swimtop: 'm',
  sweater: 'm', hoodie: 'n', cardigan: 'm',
  jacket: 'f', coat: 'n', blazer: 'm',
  dress: 'f', jumpsuit: 'm', swimsuit: 'm',
  trousers: 'pl', jeans: 'pl', shorts: 'pl', skirt: 'f', leggings: 'pl', swimshorts: 'pl',
  sneakers: 'pl', shoes: 'pl', boots: 'pl', sandals: 'pl',
  hat: 'm', cap: 'f', scarf: 'm', tie: 'f', gloves: 'pl',
  bag: 'f', belt: 'm', glasses: 'pl', jewellery: 'pl',
};

/** Masculine adjective used for a colour in a name, when it differs from the colour's label ("Денім" → "джинсовий"). */
const UK_ADJ_OVERRIDE: Partial<Record<ColourName, string>> = { denim: 'джинсовий' };

const cap = (s: string) => (s ? s[0].toLocaleUpperCase() + s.slice(1) : s);
/** Lower-cases the first letter of a noun, but keeps "T-shirt" as it is. */
const lowerNoun = (s: string) => (/^\p{Lu}-/u.test(s) ? s : s ? s[0].toLocaleLowerCase() + s.slice(1) : s);

/** Inflects a Ukrainian masculine adjective (-ий hard, -ій soft) for gender/number; undefined if indeclinable (хакі). */
export function ukAdjective(masc: string, g: Gender): string | undefined {
  const m = masc.toLocaleLowerCase();
  if (m.endsWith('ий')) {
    const stem = m.slice(0, -2);
    return g === 'm' ? m : stem + ({ f: 'а', n: 'е', pl: 'і' } as const)[g];
  }
  if (m.endsWith('ій')) {
    const stem = m.slice(0, -2);
    return g === 'm' ? m : stem + ({ f: 'я', n: 'є', pl: 'і' } as const)[g];
  }
  return undefined;
}

export function ukGender(category: CategoryId): Gender {
  return UK_GENDER[category];
}

/** "Navy jeans" / "Темно-сині джинси" from the main colour and the category. */
export function autoName(lang: Lang, category: CategoryId, colour?: ColourName): string {
  const noun = translate(lang, `cat.${category}`);
  if (!colour) return noun;
  // Denim jeans read oddly in both languages; jeans in denim are simply blue.
  const c: ColourName = colour === 'denim' && category === 'jeans' ? 'blue' : colour;
  if (lang === 'uk') {
    const masc = UK_ADJ_OVERRIDE[c] ?? translate('uk', `colour.${c}`);
    const adj = ukAdjective(masc, UK_GENDER[category]);
    // Indeclinable colours (хакі) follow the noun: "Куртка хакі".
    return adj ? `${cap(adj)} ${lowerNoun(noun)}` : `${noun} ${masc.toLocaleLowerCase()}`;
  }
  return `${translate('en', `colour.${c}`)} ${lowerNoun(noun)}`;
}
