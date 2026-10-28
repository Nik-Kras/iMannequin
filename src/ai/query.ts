// Search by description, step 1 (D32): a plain keyword parser for English and Ukrainian. It maps
// categories, zones, colours, seasons, warmth and the user's own place names to filters. Only words
// it can't map (Ukrainian ones in particular, which CLIP can't read) call for the language model.
import type { CategoryId, ColourName, Item, Season, Zone } from '../domain/types';
import { CATEGORIES, CATEGORY } from '../domain/taxonomy';

export type Warmth = 'warm' | 'light';

export interface ParsedQuery {
  categories: CategoryId[];
  zones: Zone[];
  colours: ColourName[];
  seasons: Season[];
  warmth?: Warmth;
  placeIds: string[];
  /** Words the parser could not map, minus stop words, as typed. */
  rest: string[];
  /** Some unmapped words are not English, so CLIP can't use them. */
  restNeedsTranslation: boolean;
  /** English phrase for CLIP text→image ranking. */
  phrase: string;
}

type Facet =
  | { f: 'cat'; v: CategoryId[] }
  | { f: 'zone'; v: Zone }
  | { f: 'colour'; v: ColourName }
  | { f: 'season'; v: Season[] }
  | { f: 'warmth'; v: Warmth };

/** Lexicon entry: words separated by spaces; a trailing * means "starts with" (Ukrainian endings). */
type Entry = [pattern: string, facet: Facet];

const cat = (...v: CategoryId[]): Facet => ({ f: 'cat', v });
const col = (v: ColourName): Facet => ({ f: 'colour', v });
const sea = (...v: Season[]): Facet => ({ f: 'season', v });
const zone = (v: Zone): Facet => ({ f: 'zone', v });
const warm: Facet = { f: 'warmth', v: 'warm' };
const light: Facet = { f: 'warmth', v: 'light' };

const many = (words: string, facet: Facet): Entry[] => words.split('|').map((w) => [w, facet]);

const EN: Entry[] = [
  ...many('t-shirt|tshirt|t shirt|tee', cat('tshirt')),
  ...many('top|tank top|tank|camisole|cami|crop top', cat('top')),
  ...many('shirt|button-up|button-down|button up shirt|flannel', cat('shirt')),
  ...many('blouse', cat('blouse')),
  ...many('bikini top|bikini', cat('swimtop')),
  ...many('sweater|jumper|pullover|knit|knitwear|turtleneck', cat('sweater')),
  ...many('hoodie|hoody|sweatshirt', cat('hoodie')),
  ...many('cardigan|cardi', cat('cardigan')),
  ...many('jacket|bomber|windbreaker|puffer|anorak', cat('jacket')),
  ...many('coat|parka|trench|overcoat', cat('coat')),
  ...many('blazer|suit jacket', cat('blazer')),
  ...many('dress|gown|sundress', cat('dress')),
  ...many('jumpsuit|romper|overalls|playsuit', cat('jumpsuit')),
  ...many('swimsuit|bathing suit|one-piece', cat('swimsuit')),
  ...many('trousers|pants|chinos|slacks|joggers|sweatpants', cat('trousers')),
  ...many('jeans', cat('jeans')),
  ...many('shorts', cat('shorts')),
  ...many('skirt', cat('skirt')),
  ...many('leggings|tights', cat('leggings')),
  ...many('swim shorts|swim trunks|trunks|board shorts|boardshorts', cat('swimshorts')),
  ...many('sneakers|trainers|runners', cat('sneakers')),
  ...many('shoes|heels|loafers|flats|pumps|oxfords|brogues', cat('shoes')),
  ...many('boots|booties|wellies', cat('boots')),
  ...many('sandals|flip-flops|flip flops|slides', cat('sandals')),
  ...many('hat|beanie|beret|bucket hat|fedora', cat('hat')),
  ...many('cap|baseball cap', cat('cap')),
  ...many('scarf|shawl|snood', cat('scarf')),
  ...many('tie|necktie|bow tie', cat('tie')),
  ...many('gloves|mittens|mitts', cat('gloves')),
  ...many('bag|backpack|tote|handbag|purse|clutch|rucksack', cat('bag')),
  ...many('belt', cat('belt')),
  ...many('glasses|sunglasses|shades|spectacles', cat('glasses')),
  ...many('jewellery|jewelry|necklace|earrings|bracelet|ring|watch', cat('jewellery')),
  ...many('swimwear|swimming', cat('swimtop', 'swimsuit', 'swimshorts')),
  ...many('outerwear', cat('jacket', 'coat', 'blazer')),
  ...many('knits', cat('sweater', 'cardigan')),
  ...many('bottoms', zone('legs')),
  ...many('footwear', zone('feet')),
  ...many('accessories|accessory', zone('acc')),
  ...many('headwear', zone('head')),
  // colours (multi-word first so "light blue" isn't read as "light")
  ...many('light blue|sky blue|baby blue|royal blue|cobalt|blue', col('blue')),
  ...many('dark blue|navy blue|navy', col('navy')),
  ...many('denim', col('denim')),
  ...many('black', col('black')),
  ...many('white|off-white|off white', col('white')),
  ...many('grey|gray|light grey|light gray|dark grey|dark gray|charcoal|silver', col('grey')),
  ...many('cream|ivory|ecru', col('cream')),
  ...many('beige|sand|nude', col('beige')),
  ...many('brown|chocolate', col('brown')),
  ...many('tan|camel', col('tan')),
  ...many('red|scarlet', col('red')),
  ...many('burgundy|maroon|wine|bordeaux', col('burgundy')),
  ...many('pink|rose', col('pink')),
  ...many('orange', col('orange')),
  ...many('rust|terracotta', col('rust')),
  ...many('yellow', col('yellow')),
  ...many('mustard', col('mustard')),
  ...many('green|sage|emerald|mint', col('green')),
  ...many('olive', col('olive')),
  ...many('khaki', col('khaki')),
  ...many('teal|turquoise', col('teal')),
  ...many('purple|violet|lilac|lavender|plum', col('purple')),
  ...many('multicolour|multicolor|multicoloured|multicolored|colourful|colorful', col('multi')),
  // seasons and warmth
  ...many('spring', sea('spring')),
  ...many('summer|summery', sea('summer')),
  ...many('autumn|fall', sea('autumn')),
  ...many('winter|wintry', sea('winter')),
  ...many('warm|cosy|cozy|thick|insulated|wool|woolly|woollen|cold|freezing|snow', warm),
  ...many('light|lightweight|thin|airy|breezy|hot|heat', light),
];

const UK: Entry[] = [
  ...many('футболк*', cat('tshirt')),
  ...many('топ|топи|топік*|майк*', cat('top')),
  ...many('сорочк*|сорочок', cat('shirt')),
  ...many('блуз*', cat('blouse')),
  ...many('бікіні', cat('swimtop')),
  ...many('светр*|светер|кофт*|пуловер*|джемпер*|гольф*', cat('sweater')),
  ...many('худі|толстовк*|світшот*', cat('hoodie')),
  ...many('кардиган*', cat('cardigan')),
  ...many('куртк*|курток|вітровк*|пуховик*|бомбер*', cat('jacket')),
  ...many('пальт*|плащ*|тренч*', cat('coat')),
  ...many('піджак*|жакет*|блейзер*', cat('blazer')),
  ...many('сукн*|суконь|плать*|платт*|сарафан*', cat('dress')),
  ...many('комбінезон*', cat('jumpsuit')),
  ...many('купальник*', cat('swimsuit')),
  ...many('штан*|брюк*|чінос*|джогер*', cat('trousers')),
  ...many('шорт*', cat('shorts')),
  ...many('спідниц*|спідниць', cat('skirt')),
  ...many('легінс*|лосин*|колгот*', cat('leggings')),
  ...many('плавк*', cat('swimshorts')),
  ...many('кросівк*|кросовк*|кросівок|кеди|кедів|кедах', cat('sneakers')),
  ...many('туфл*|туфель|лофер*|балетк*|мокасин*', cat('shoes')),
  ...many('черевик*|чобот*|чобіт|ботильйон*|берц*|уггі', cat('boots')),
  ...many('сандал*|босоніжк*|шльопанц*|в\'єтнамк*', cat('sandals')),
  ...many('капелюх*|шапк*|шапок|берет*|панам*', cat('hat')),
  ...many('кепк*|кепок|бейсболк*', cat('cap')),
  ...many('шарф*|хустк*|хусток|палантин*|снуд*', cat('scarf')),
  ...many('краватк*|краваток', cat('tie')),
  ...many('рукавичк*|рукавиц*|рукавичок', cat('gloves')),
  ...many('сумк*|сумок|рюкзак*|шопер*|клатч*', cat('bag')),
  ...many('пас|паса|пасок|паском|пояс*|ремін*|ремен*', cat('belt')),
  ...many('окуляр*', cat('glasses')),
  ...many('прикрас*|намист*|сережк*|браслет*|каблучк*|кулон*|годинник*', cat('jewellery')),
  ...many('купальн*', cat('swimtop', 'swimsuit', 'swimshorts')),
  ...many('верхній одяг|верхнього одягу', cat('jacket', 'coat', 'blazer')),
  ...many('верх', zone('torso')),
  ...many('низ', zone('legs')),
  ...many('взутт*', zone('feet')),
  ...many('аксесуар*', zone('acc')),
  // colours ("джинсов*" before "джинс*": a denim jacket is not jeans)
  ...many('темно-син*|темносин*|нейві', col('navy')),
  ...many('джинсов*|денім*', col('denim')),
  ...many('джинс*', cat('jeans')),
  ...many('синій|синя|синє|сині|синю|синього|синьої|синіх|синім|синьому|блакитн*|голуб*', col('blue')),
  ...many('чорн*', col('black')),
  ...many('біл*', col('white')),
  ...many('сір*|графітов*', col('grey')),
  ...many('кремов*|молочн*|айвор*', col('cream')),
  ...many('бежев*|пісочн*', col('beige')),
  ...many('коричнев*|шоколадн*', col('brown')),
  ...many('карамельн*|кемел*', col('tan')),
  ...many('червон*', col('red')),
  ...many('бордов*|бордо|винн*', col('burgundy')),
  ...many('рожев*', col('pink')),
  ...many('помаранчев*|оранжев*', col('orange')),
  ...many('іржав*|теракот*', col('rust')),
  ...many('жовт*', col('yellow')),
  ...many('гірчичн*', col('mustard')),
  ...many('зелен*|салатов*|смарагдов*|м\'ятн*', col('green')),
  ...many('оливков*', col('olive')),
  ...many('хакі', col('khaki')),
  ...many('бірюзов*', col('teal')),
  ...many('фіолетов*|бузков*|лілов*|лавандов*', col('purple')),
  ...many('різнокольоров*|кольоров*|строкат*', col('multi')),
  // seasons and warmth
  ...many('весн*|весін*|навесні|веснян*', sea('spring')),
  ...many('літо|літа|літу|літом|літн*|влітку', sea('summer')),
  ...many('осін*|осен*|восени', sea('autumn')),
  ...many('зим*|взимку', sea('winter')),
  ...many('тепл*|утеплен*|холод*|мороз*|вовнян*', warm),
  ...many('легк*|легеньк*|тонк*|спек*|жарк*|жару', light),
];

const STOP = new Set([
  'something', 'some', 'anything', 'a', 'an', 'the', 'for', 'to', 'in', 'on', 'at', 'of', 'with', 'my', 'me', 'i', 'find', 'show',
  'what', 'which', 'where', 'is', 'are', 'that', 'this', 'it', 'and', 'or', 'wear', 'clothes', 'clothing', 'items', 'item', 'stuff',
  'thing', 'things', 'outfit', 'piece', 'pieces', 'please', 'have', 'do', 'can', 'all', 'any', 'under', 'weather', 'day', 'days', 'from', 'by',
  'щось', 'якийсь', 'якась', 'якесь', 'які', 'яка', 'який', 'яке', 'що', 'для', 'на', 'в', 'у', 'з', 'із', 'зі', 'до', 'мені', 'мій', 'моя', 'моє',
  'мої', 'знайди', 'покажи', 'де', 'є', 'і', 'й', 'та', 'або', 'одяг', 'одягу', 'речі', 'річ', 'всі', 'усі', 'все', 'щоб', 'носити', 'вдягнути',
  'одягнути', 'під', 'над', 'біля', 'будь', 'ласка', 'мене', 'хочу', 'треба', 'потрібно', 'погоди', 'погода', 'погоду', 'щоденн', 'дня', 'день',
]);

/** Lowercase words; keeps inner hyphens and apostrophes (t-shirt, темно-синій, в'єтнамки). */
export function tokenize(text: string): string[] {
  return (text.toLowerCase().replace(/[’ʼ`]/g, "'").match(/[\p{L}\p{N}]+(?:['-][\p{L}\p{N}]+)*/gu) ?? []);
}

const isCyrillic = (w: string) => /[Ѐ-ӿ]/.test(w);

/** English singular forms a token may stand for ("dresses" → dress, "hoodies" → hoodie). */
function enForms(t: string): string[] {
  const out = [t];
  if (t.endsWith('s') && !t.endsWith('ss')) {
    out.push(t.slice(0, -1));
    if (t.endsWith('es')) out.push(t.slice(0, -2));
    if (t.endsWith('ies')) out.push(t.slice(0, -3) + 'y', t.slice(0, -3) + 'ie');
  }
  return out;
}

function wordMatches(pattern: string, token: string): boolean {
  if (pattern.endsWith('*')) return token.startsWith(pattern.slice(0, -1));
  if (isCyrillic(pattern)) return token === pattern;
  return enForms(token).includes(pattern) || enForms(pattern).includes(token);
}

interface CompiledEntry { words: string[]; facet: Facet }
const LEXICON: CompiledEntry[] = [...EN, ...UK]
  .map(([p, facet]) => ({ words: tokenize(p.replace(/\*/g, ' STAR ')).reduce<string[]>((acc, w) => {
    if (w === 'star') acc[acc.length - 1] += '*';
    else acc.push(w);
    return acc;
  }, []), facet }))
  // Longest phrase first, then longer stems first, so "light blue" beats "light" and "джинсов*" beats "джинс*".
  .sort((a, b) => b.words.length - a.words.length || b.words.join(' ').length - a.words.join(' ').length);

function commonPrefix(a: string, b: string): number {
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  return i;
}

/** Same word allowing a changed ending: "дивані" ~ "диван", "ліжку" ~ "ліжком", "drawers" ~ "drawer". */
export function sameStem(a: string, b: string): boolean {
  if (a === b) return true;
  // Only the last two letters may differ, counted on the longer word ("warm" is not "wardrobe").
  const p = commonPrefix(a, b);
  return p >= Math.max(3, Math.max(a.length, b.length) - 2);
}

export interface PlaceRef { id: string; name: string }

export function parseQuery(query: string, places: PlaceRef[] = []): ParsedQuery {
  const tokens = tokenize(query);
  const used = new Array(tokens.length).fill(false);
  const out: ParsedQuery = { categories: [], zones: [], colours: [], seasons: [], placeIds: [], rest: [], restNeedsTranslation: false, phrase: '' };

  // 1. The user's own place names ("under the bed", "у дивані"): a content word of 4+ letters, or all of
  //    the name's content words, must be in the query.
  for (const p of places) {
    const words = tokenize(p.name).filter((w) => !STOP.has(w));
    const hits: number[] = [];
    let strong = false;
    for (const w of words) {
      const i = tokens.findIndex((t, k) => !used[k] && sameStem(t, w));
      if (i >= 0) { hits.push(i); if (w.length >= 4) strong = true; }
    }
    if (strong || (words.length > 0 && hits.length === words.length)) {
      out.placeIds.push(p.id);
      for (const i of hits) used[i] = true;
    }
  }

  // 2. Lexicon phrases, longest first.
  for (const e of LEXICON) {
    for (let i = 0; i + e.words.length <= tokens.length; i++) {
      if (e.words.some((_, k) => used[i + k] || !wordMatches(e.words[k], tokens[i + k]))) continue;
      for (let k = 0; k < e.words.length; k++) used[i + k] = true;
      const f = e.facet;
      if (f.f === 'cat') out.categories.push(...f.v);
      else if (f.f === 'zone') out.zones.push(f.v);
      else if (f.f === 'colour') out.colours.push(f.v);
      else if (f.f === 'season') out.seasons.push(...f.v);
      else out.warmth = f.v;
    }
  }
  out.categories = [...new Set(out.categories)];
  out.zones = [...new Set(out.zones)];
  out.colours = [...new Set(out.colours)];
  out.seasons = [...new Set(out.seasons)];

  // 3. What's left.
  out.rest = tokens.filter((t, i) => !used[i] && !STOP.has(t) && !/^\d+$/.test(t));
  out.restNeedsTranslation = out.rest.some(isCyrillic);
  out.phrase = englishPhrase(out);
  return out;
}

const ZONE_NOUN: Record<Zone, string> = {
  head: 'hat', neck: 'scarf', torso: 'top', full: 'dress', legs: 'trousers', feet: 'shoes', hands: 'gloves', acc: 'accessory',
};

/** "a photo of warm navy sweater" style phrase for CLIP, from what the parser understood plus English leftovers. */
export function englishPhrase(q: Pick<ParsedQuery, 'categories' | 'zones' | 'colours' | 'warmth' | 'seasons' | 'rest'>): string {
  const parts: string[] = [];
  if (q.warmth) parts.push(q.warmth === 'warm' ? 'warm' : 'light');
  if (q.seasons.length === 1) parts.push(q.seasons[0] === 'autumn' ? 'autumn' : q.seasons[0]);
  parts.push(...q.colours.filter((c) => c !== 'multi').slice(0, 2));
  if (q.colours.includes('multi')) parts.push('colourful');
  parts.push(...q.rest.filter((w) => !isCyrillic(w)));
  const noun = q.categories.length
    ? CATEGORY[q.categories[0]].prompt.replace(/^an? (pair of )?/, '')
    : q.zones.length ? ZONE_NOUN[q.zones[0]] : 'clothing';
  parts.push(noun);
  return parts.join(' ');
}

/** The parser left words it can't use: Ukrainian (CLIP is English-only) or a free-form sentence. */
export function needsLanguageModel(q: ParsedQuery): boolean {
  if (q.restNeedsTranslation) return true;
  const facets = q.categories.length + q.zones.length + q.colours.length + q.seasons.length + q.placeIds.length + (q.warmth ? 1 : 0);
  return facets === 0 && q.rest.length >= 3;
}

export const hasFilters = (q: ParsedQuery) =>
  q.categories.length + q.zones.length + q.colours.length + q.seasons.length + q.placeIds.length > 0 || !!q.warmth;

/** Share of the query's facets an item matches (1 = all of them). Within a facet any value matches. */
export function facetMatch(item: Pick<Item, 'category' | 'colours' | 'seasons' | 'locationId'>, q: ParsedQuery): number {
  const checks: boolean[] = [];
  if (q.categories.length || q.zones.length) {
    checks.push(q.categories.includes(item.category) || q.zones.includes(CATEGORY[item.category]?.zone));
  }
  if (q.colours.length) checks.push(item.colours.some((c) => q.colours.includes(c)));
  if (q.seasons.length) checks.push(item.seasons.some((s) => q.seasons.includes(s)));
  else if (q.warmth) checks.push(item.seasons.includes(q.warmth === 'warm' ? 'winter' : 'summer'));
  if (q.placeIds.length) checks.push(!!item.locationId && q.placeIds.includes(item.locationId));
  if (!checks.length) return 1;
  return checks.filter(Boolean).length / checks.length;
}

/** Plain text match of leftover words against an item's name, brand and notes (e.g. a brand name). */
export function textMatch(item: Pick<Item, 'name' | 'brand' | 'notes'>, rest: string[]): number {
  if (!rest.length) return 0;
  const words = tokenize(`${item.name} ${item.brand ?? ''} ${item.notes ?? ''}`);
  const hit = rest.filter((r) => words.some((w) => sameStem(w, r))).length;
  return hit / rest.length;
}

// ---- Language-model step ----

export interface LlmFilters {
  categories: CategoryId[];
  colours: ColourName[];
  seasons: Season[];
  places: string[];
  warmth?: Warmth;
  phrase?: string;
}

const CATEGORY_IDS = new Set(CATEGORIES.map((c) => c.id));
const COLOURS = new Set<ColourName>(['black', 'white', 'grey', 'cream', 'beige', 'brown', 'tan', 'red', 'burgundy', 'pink', 'orange', 'rust', 'yellow', 'mustard', 'green', 'olive', 'khaki', 'teal', 'blue', 'navy', 'denim', 'purple', 'multi']);
const SEASON_IDS = new Set<Season>(['spring', 'summer', 'autumn', 'winter']);

/** The prompt that asks the language model for JSON filters plus an English phrase for CLIP. */
export function llmMessages(query: string, places: PlaceRef[]): { role: 'system' | 'user'; content: string }[] {
  return [
    {
      role: 'system',
      content:
        'You turn a wardrobe search (English or Ukrainian) into JSON filters. Reply with one JSON object only, no prose.\n' +
        `Keys: "categories" (from: ${[...CATEGORY_IDS].join(', ')}), "colours" (from: ${[...COLOURS].join(', ')}), ` +
        '"seasons" (from: spring, summer, autumn, winter), "places" (from the user\'s places below, exact names), ' +
        '"warmth" ("warm", "light" or null), "phrase" (a short English description of the clothes, for an image search).\n' +
        'Use empty lists when the query does not say. Do not guess colours or places that are not asked for.\n' +
        `User's places: ${places.map((p) => JSON.stringify(p.name)).join(', ') || 'none'}.`,
    },
    { role: 'user', content: `${query} /no_think` },
  ];
}

/** Reads the model's answer defensively: first JSON object, unknown values dropped. Null when unusable. */
export function parseLlmAnswer(text: string): LlmFilters | null {
  const cleaned = text.replace(/<think>[\s\S]*?<\/think>/g, '');
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(cleaned.slice(start, end + 1));
  } catch {
    return null;
  }
  const list = (v: unknown): string[] => (Array.isArray(v) ? v : typeof v === 'string' && v ? [v] : []).map((x) => String(x).toLowerCase().trim());
  const warmth = typeof raw.warmth === 'string' && (raw.warmth === 'warm' || raw.warmth === 'light') ? raw.warmth : undefined;
  const phrase = typeof raw.phrase === 'string' && !/[Ѐ-ӿ]/.test(raw.phrase) ? raw.phrase.trim().slice(0, 80) : undefined;
  return {
    categories: list(raw.categories).filter((c): c is CategoryId => CATEGORY_IDS.has(c as CategoryId)),
    colours: list(raw.colours ?? raw.colors).map((c) => (c === 'gray' ? 'grey' : c)).filter((c): c is ColourName => COLOURS.has(c as ColourName)),
    seasons: list(raw.seasons).map((s) => (s === 'fall' ? 'autumn' : s)).filter((s): s is Season => SEASON_IDS.has(s as Season)),
    places: Array.isArray(raw.places) ? raw.places.map(String) : [],
    warmth,
    phrase: phrase || undefined,
  };
}

/** Adds the language model's filters to the keyword parse; the keyword parse is never overridden. */
export function mergeLlm(q: ParsedQuery, llm: LlmFilters, places: PlaceRef[]): ParsedQuery {
  const placeIds = llm.places
    .map((name) => places.find((p) => p.name.toLowerCase() === name.toLowerCase() || tokenize(p.name).some((w) => w.length >= 4 && tokenize(name).some((n) => sameStem(n, w))))?.id)
    .filter((id): id is string => !!id);
  const merged: ParsedQuery = {
    ...q,
    categories: [...new Set([...q.categories, ...llm.categories])],
    colours: [...new Set([...q.colours, ...llm.colours])],
    seasons: [...new Set([...q.seasons, ...llm.seasons])],
    placeIds: [...new Set([...q.placeIds, ...placeIds])],
    warmth: q.warmth ?? llm.warmth,
    rest: [],
    restNeedsTranslation: false,
  };
  merged.phrase = llm.phrase ?? englishPhrase(merged);
  return merged;
}
