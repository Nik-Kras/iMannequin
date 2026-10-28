// Calendar and date helpers for the wear log and trips. Dates are local 'YYYY-MM-DD' strings (repo.todayISO).
import type { Lang, WearEntry } from '../domain/types';

const DAY = 86_400_000;

export const isoDate = (y: number, m0: number, d: number): string =>
  `${y}-${String(m0 + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;

/** Local midnight of an ISO date. */
export function parseISO(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d);
}

/** Whole days from `a` to `b` (positive when b is later), ignoring daylight-saving shifts. */
export function daysBetween(a: string, b: string): number {
  const pa = a.split('-').map(Number);
  const pb = b.split('-').map(Number);
  return Math.round((Date.UTC(pb[0], pb[1] - 1, pb[2]) - Date.UTC(pa[0], pa[1] - 1, pa[2])) / DAY);
}

export interface YearMonth { year: number; month: number } // month is 0-based

export function ymOf(iso: string): YearMonth {
  const [y, m] = iso.split('-').map(Number);
  return { year: y, month: m - 1 };
}

export function addMonths(ym: YearMonth, delta: number): YearMonth {
  const n = ym.year * 12 + ym.month + delta;
  return { year: Math.floor(n / 12), month: ((n % 12) + 12) % 12 };
}

export const sameMonth = (a: YearMonth, b: YearMonth): boolean => a.year === b.year && a.month === b.month;

/** Calendar cells for a month, Monday first, padded with nulls to whole weeks. */
export function monthCells(ym: YearMonth): (string | null)[] {
  const first = new Date(ym.year, ym.month, 1);
  const offset = (first.getDay() + 6) % 7; // Monday = 0
  const days = new Date(ym.year, ym.month + 1, 0).getDate();
  const cells: (string | null)[] = Array(offset).fill(null);
  for (let d = 1; d <= days; d++) cells.push(isoDate(ym.year, ym.month, d));
  while (cells.length % 7) cells.push(null);
  return cells;
}

export const localeOf = (lang: Lang): string => (lang === 'uk' ? 'uk-UA' : 'en-GB');

/** Short weekday names, Monday first ("Mon" / "пн"). */
export function weekdayLabels(lang: Lang): string[] {
  const f = new Intl.DateTimeFormat(localeOf(lang), { weekday: 'short' });
  // 2026-10-26 is a Monday.
  return Array.from({ length: 7 }, (_, i) => f.format(new Date(2026, 9, 26 + i)));
}

const cap = (s: string): string => s.charAt(0).toLocaleUpperCase() + s.slice(1);

/** "October 2026" / "Жовтень 2026". */
export function monthTitle(ym: YearMonth, lang: Lang): string {
  const month = new Intl.DateTimeFormat(localeOf(lang), { month: 'long' }).format(new Date(ym.year, ym.month, 1));
  return `${cap(month)} ${ym.year}`;
}

/** Month name as it reads after a day number: "March" / "березня" (Ukrainian genitive). */
export function monthAfterDay(d: Date, lang: Lang): string {
  const parts = new Intl.DateTimeFormat(localeOf(lang), { day: 'numeric', month: 'long' }).formatToParts(d);
  return parts.find((p) => p.type === 'month')?.value ?? '';
}

/** Trip dates: "14–16 Nov", "30 Nov – 2 Dec", "30 Dec 2026 – 2 Jan 2027". */
export function formatRange(start: string, end: string, lang: Lang): string {
  const a = parseISO(start);
  const b = parseISO(end);
  const loc = localeOf(lang);
  const dm = (d: Date, year?: boolean) =>
    new Intl.DateTimeFormat(loc, { day: 'numeric', month: 'short', ...(year ? { year: 'numeric' } : {}) }).format(d);
  if (start === end) return dm(a);
  if (a.getFullYear() !== b.getFullYear()) return `${dm(a, true)} – ${dm(b, true)}`;
  if (a.getMonth() === b.getMonth()) {
    const month = new Intl.DateTimeFormat(loc, { day: 'numeric', month: 'short' }).formatToParts(b)
      .filter((p) => p.type !== 'day').map((p) => p.value).join('').trim();
    return `${a.getDate()}–${b.getDate()} ${month}`;
  }
  return `${dm(a)} – ${dm(b)}`;
}

/** Every item worn on each day, merged across that day's entries, in first-seen order. */
export function wornByDate(entries: WearEntry[]): Map<string, { itemIds: string[]; outfitIds: string[] }> {
  const map = new Map<string, { itemIds: string[]; outfitIds: string[] }>();
  for (const e of [...entries].sort((x, y) => x.createdAt - y.createdAt)) {
    const day = map.get(e.date) ?? { itemIds: [], outfitIds: [] };
    for (const id of e.itemIds) if (!day.itemIds.includes(id)) day.itemIds.push(id);
    if (e.outfitId && !day.outfitIds.includes(e.outfitId)) day.outfitIds.push(e.outfitId);
    map.set(e.date, day);
  }
  return map;
}

/** Wear count and last worn date of every saved outfit. */
export function outfitWearStats(entries: WearEntry[]): Map<string, { count: number; last: string }> {
  const stats = new Map<string, { count: number; last: string; days: Set<string> }>();
  for (const e of entries) {
    if (!e.outfitId) continue;
    const s = stats.get(e.outfitId) ?? { count: 0, last: e.date, days: new Set<string>() };
    if (!s.days.has(e.date)) { s.days.add(e.date); s.count++; }
    if (e.date > s.last) s.last = e.date;
    stats.set(e.outfitId, s);
  }
  return new Map([...stats].map(([k, v]) => [k, { count: v.count, last: v.last }]));
}

/** The moment N calendar months before `now`. */
export function monthsAgo(n: number, now = Date.now()): number {
  const d = new Date(now);
  d.setMonth(d.getMonth() - n);
  return d.getTime();
}
