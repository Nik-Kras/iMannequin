// Zero-shot category and season suggestions from CLIP embeddings (architecture §4.1), and the
// same-item decision (D9). Pure maths over Float32Arrays; the embeddings come from the worker.
import type { CategoryId, ColourName, Season } from '../domain/types';
import { CATEGORIES } from '../domain/taxonomy';
import { coloursAgree } from './colours';

/** Prompt templates averaged per category (prompt ensembling makes zero-shot steadier). */
export const TEMPLATES = ['a photo of {}', 'a flat lay photo of {}', 'a product photo of {}, on a plain background'];

/** Every category prompt, in CATEGORIES order × TEMPLATES order. */
export const categoryPrompts = (): string[] => CATEGORIES.flatMap((c) => TEMPLATES.map((t) => t.replace('{}', c.prompt)));

/** Warm / light / in-between, for the season suggestion. */
export const WARMTH_PROMPTS = [
  'a photo of warm, thick clothing for cold winter weather',
  'a photo of light, thin clothing for hot summer weather',
  'a photo of clothing for mild spring or autumn weather',
];

/** Seasons a category is usually worn in; the warmth prompts adjust them per garment. */
export const SEASON_PRIOR: Record<CategoryId, Season[]> = {
  tshirt: ['spring', 'summer'], top: ['summer'], shirt: ['spring', 'summer', 'autumn'], blouse: ['spring', 'summer', 'autumn'],
  swimtop: ['summer'], sweater: ['autumn', 'winter'], hoodie: ['spring', 'autumn', 'winter'], cardigan: ['spring', 'autumn'],
  jacket: ['spring', 'autumn'], coat: ['autumn', 'winter'], blazer: ['spring', 'autumn'], dress: ['spring', 'summer'],
  jumpsuit: ['spring', 'summer'], swimsuit: ['summer'], trousers: ['spring', 'autumn', 'winter'], jeans: ['spring', 'autumn', 'winter'],
  shorts: ['summer'], skirt: ['spring', 'summer'], leggings: ['autumn', 'winter'], swimshorts: ['summer'],
  sneakers: ['spring', 'summer', 'autumn'], shoes: ['spring', 'summer', 'autumn'], boots: ['autumn', 'winter'], sandals: ['summer'],
  hat: ['autumn', 'winter'], cap: ['spring', 'summer'], scarf: ['autumn', 'winter'], tie: ['spring', 'summer', 'autumn', 'winter'],
  gloves: ['winter'], bag: ['spring', 'summer', 'autumn', 'winter'], belt: ['spring', 'summer', 'autumn', 'winter'],
  glasses: ['spring', 'summer', 'autumn', 'winter'], jewellery: ['spring', 'summer', 'autumn', 'winter'],
};

const ALL_YEAR = new Set<CategoryId>(['tie', 'bag', 'belt', 'glasses', 'jewellery']);
const ORDER: Season[] = ['spring', 'summer', 'autumn', 'winter'];

export function dot(a: Float32Array, b: Float32Array): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
}

/** Cosine similarity (embeddings from the worker are already unit length, but don't rely on it). */
export function cosine(a: Float32Array, b: Float32Array): number {
  const n = Math.sqrt(dot(a, a) * dot(b, b));
  return n ? dot(a, b) / n : 0;
}

/** Mean of unit vectors, renormalised. */
export function meanUnit(vs: Float32Array[]): Float32Array {
  const out = new Float32Array(vs[0].length);
  for (const v of vs) for (let i = 0; i < v.length; i++) out[i] += v[i];
  const n = Math.sqrt(dot(out, out)) || 1;
  return out.map((x) => x / n);
}

/** CLIP's zero-shot probabilities: softmax over 100 × cosine. */
export function zeroShot(image: Float32Array, texts: Float32Array[], scale = 100): number[] {
  const logits = texts.map((t) => scale * cosine(image, t));
  const m = Math.max(...logits);
  const e = logits.map((l) => Math.exp(l - m));
  const s = e.reduce((a, b) => a + b, 0);
  return e.map((x) => x / s);
}

/** Groups the flat prompt embeddings (categoryPrompts order) into one vector per category. */
export function categoryVectors(flat: Float32Array[]): Float32Array[] {
  const k = TEMPLATES.length;
  return CATEGORIES.map((_, i) => meanUnit(flat.slice(i * k, i * k + k)));
}

export function topCategories(image: Float32Array, catVectors: Float32Array[], n = 3): { id: CategoryId; score: number }[] {
  const p = zeroShot(image, catVectors);
  return CATEGORIES.map((c, i) => ({ id: c.id, score: p[i] }))
    .sort((a, b) => b.score - a.score)
    .slice(0, n);
}

/**
 * Seasons from the category's usual seasons, nudged by how warm or light the garment looks.
 * `warmth` = probabilities for [warm, light, mild] (WARMTH_PROMPTS order).
 */
export function suggestSeasons(category: CategoryId, warmth?: number[]): Season[] {
  const s = new Set(SEASON_PRIOR[category]);
  if (!warmth || ALL_YEAR.has(category)) return ORDER.filter((x) => s.has(x));
  const [warm, light] = warmth;
  if (warm > 0.55) { s.add('winter'); s.add('autumn'); if (light < 0.15) s.delete('summer'); }
  if (light > 0.55) { s.add('summer'); if (warm < 0.15) s.delete('winter'); }
  if (!s.size) SEASON_PRIOR[category].forEach((x) => s.add(x));
  return ORDER.filter((x) => s.has(x));
}

// ---- Same item (D9) ----

export interface SameItemCandidate { itemId: string; score: number; colours: ColourName[] }

/** Strict cosine thresholds per embedding model; calibration on real phones may move them (D12). */
export const SAME_ITEM_THRESHOLD: Record<string, number> = { 'clip-b32': 0.93, 'fashion-clip': 0.93 };

/**
 * The same physical item, or null when unsure: the best match must clear a strict threshold, agree
 * on colour, and not be tied with another item (two identical black T-shirts stay separate).
 */
export function decideSameItem(cands: SameItemCandidate[], newColours: ColourName[], threshold: number, margin = 0.015): { itemId: string; score: number } | null {
  const sorted = [...cands].sort((a, b) => b.score - a.score);
  const best = sorted[0];
  if (!best) return null;
  const need = newColours.length ? threshold : threshold + 0.02;
  if (best.score < need) return null;
  if (!coloursAgree(newColours, best.colours)) return null;
  const rival = sorted.find((c) => c.itemId !== best.itemId && c.score >= best.score - margin && coloursAgree(newColours, c.colours));
  if (rival) return null;
  return { itemId: best.itemId, score: best.score };
}
