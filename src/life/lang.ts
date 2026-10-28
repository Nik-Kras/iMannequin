// Switching the UI language (D4) from Welcome or Settings.
import { db, DEFAULT_PLACES, getSettings, updateSettings } from '../data/db';
import { translate, type Key } from '../i18n';
import type { Lang } from '../domain/types';

export async function switchLanguage(lang: Lang): Promise<void> {
  const s = await getSettings();
  document.documentElement.lang = lang;
  if (s.lang === lang) return;
  await updateSettings({ lang });
  // The default place names follow the language until the user renames them.
  const locations = await db.locations.toArray();
  for (const l of locations) {
    const key = DEFAULT_PLACES.find((k) => translate(s.lang, k as Key) === l.name);
    if (key) await db.locations.update(l.id, { name: translate(lang, key as Key) });
  }
}
