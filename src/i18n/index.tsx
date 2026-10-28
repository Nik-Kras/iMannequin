// Tiny i18n: typed keys, {var} interpolation and Intl plural rules (Ukrainian has one/few/many).
import { createContext, useContext, useMemo, type ReactNode } from 'react';
import type { Lang } from '../domain/types';
import enCommon from './en/common';
import enDressup from './en/dressup';
import enWardrobe from './en/wardrobe';
import enOutfits from './en/outfits';
import enTrips from './en/trips';
import enSettings from './en/settings';
import enOnboarding from './en/onboarding';
import enAi from './en/ai';
import enBody from './en/body';
import ukCommon from './uk/common';
import ukDressup from './uk/dressup';
import ukWardrobe from './uk/wardrobe';
import ukOutfits from './uk/outfits';
import ukTrips from './uk/trips';
import ukSettings from './uk/settings';
import ukOnboarding from './uk/onboarding';
import ukAi from './uk/ai';
import ukBody from './uk/body';

export const en = { ...enCommon, ...enDressup, ...enWardrobe, ...enOutfits, ...enTrips, ...enSettings, ...enOnboarding, ...enAi, ...enBody };
export const uk = { ...ukCommon, ...ukDressup, ...ukWardrobe, ...ukOutfits, ...ukTrips, ...ukSettings, ...ukOnboarding, ...ukAi, ...ukBody };
export type Key = keyof typeof en;
/** Keys that have plural forms: base name without the _one/_few/_many/_other suffix. */
export type PluralKey = Key extends infer K ? (K extends `${infer B}_other` ? B : never) : never;

const DICTS: Record<Lang, Record<string, string>> = { en, uk };
type Vars = Record<string, string | number>;

export function translate(lang: Lang, key: Key, vars?: Vars): string {
  const s = DICTS[lang][key] ?? DICTS.en[key] ?? key;
  return vars ? s.replace(/\{(\w+)\}/g, (_, k) => String(vars[k] ?? `{${k}}`)) : s;
}

export function translatePlural(lang: Lang, key: PluralKey, n: number, vars?: Vars): string {
  const cat = new Intl.PluralRules(lang === 'uk' ? 'uk' : 'en').select(n);
  const k = `${key}_${cat}` in DICTS[lang] ? `${key}_${cat}` : `${key}_other`;
  return translate(lang, k as Key, { n, ...vars });
}

export interface I18n {
  lang: Lang;
  t: (key: Key, vars?: Vars) => string;
  tn: (key: PluralKey, n: number, vars?: Vars) => string;
  /** Locale-aware date, e.g. "12 Oct". */
  date: (d: Date | number | string, opts?: Intl.DateTimeFormatOptions) => string;
}

const Ctx = createContext<I18n | null>(null);

export function makeI18n(lang: Lang): I18n {
  const locale = lang === 'uk' ? 'uk-UA' : 'en-GB';
  return {
    lang,
    t: (k, v) => translate(lang, k, v),
    tn: (k, n, v) => translatePlural(lang, k, n, v),
    date: (d, opts) => new Date(d).toLocaleDateString(locale, opts ?? { day: 'numeric', month: 'short' }),
  };
}

export function I18nProvider({ lang, children }: { lang: Lang; children: ReactNode }) {
  const value = useMemo(() => makeI18n(lang), [lang]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useI18n(): I18n {
  const v = useContext(Ctx);
  if (!v) throw new Error('useI18n outside I18nProvider');
  return v;
}
