// Wardrobe (F5): every saved piece as a paper card, with search by description and filters.
import { useEffect, useMemo, useRef, useState } from 'react';
import '../styles/wardrobe.css';
import { useRoute, navigate } from '../app/router';
import { searchWardrobeDetailed } from '../ai';
import { useActiveItems, useLocations, useReviewItems, useSettings } from '../data/repo';
import { reportError } from '../diag/diagnostics';
import { SEASONS, type ColourName, type Item, type Location, type Season } from '../domain/types';
import { useI18n, type I18n } from '../i18n';
import { notify } from '../ui/action';
import { CutoutImg, Empty } from '../ui/parts';
import { Icon } from '../ui/icons';
import { applyFilter, CATEGORY_GROUPS, EMPTY_FILTER, filterFromQuery, filterToQuery, isFiltered, type WardrobeFilter } from '../wardrobe/filters';
import { AiMark, ColourSheet, COLOURS, TitledSheet, tiltFor, usePhotos } from '../wardrobe/parts';
import { readScroll, readSearch, writeScroll, writeSearch } from '../wardrobe/session';

type SheetKind = 'colour' | 'season' | 'place' | 'smarter' | null;
interface Results { q: string; ids: string[]; smart?: boolean }

/** Plain-text match used when the AI search isn't available: every word must appear somewhere on the item. */
function localSearch(items: Item[], q: string, places: Location[], i18n: I18n): string[] {
  const words = q.toLocaleLowerCase().split(/\s+/).filter(Boolean);
  const placeName = (id?: string) => places.find((p) => p.id === id)?.name ?? '';
  return items.filter((it) => {
    const hay = [
      it.name, it.brand, it.notes, placeName(it.locationId), i18n.t(`cat.${it.category}`),
      ...it.colours.map((c) => i18n.t(`colour.${c}`)), ...it.seasons.map((s) => i18n.t(`season.${s}`)),
    ].join(' ').toLocaleLowerCase();
    return words.every((w) => hay.includes(w));
  }).map((it) => it.id);
}

export default function Wardrobe() {
  const i18n = useI18n();
  const { t, tn } = i18n;
  const route = useRoute();
  const items = useActiveItems();
  const review = useReviewItems();
  const places = useLocations() ?? [];
  const settings = useSettings();
  const months = settings?.notWornMonths ?? 6;
  // Filters and the search live in the URL, so they are still there after a visit to an item (bug-audit #18).
  // Other screens open the wardrobe pre-filtered: #/wardrobe?place=<id|none> and #/wardrobe?notWorn=1.
  const [filter, setFilter] = useState<WardrobeFilter>(() => filterFromQuery(route.query));
  const [sheet, setSheet] = useState<SheetKind>(null);
  const [query, setQuery] = useState(() => route.query.get('q') ?? '');
  const [results, setResults] = useState<Results | null>(() => {
    const q = route.query.get('q');
    const last = readSearch();
    return q && last?.q === q ? last : null;
  });
  const [searching, setSearching] = useState(false);
  // The language model never runs by itself (bug-audit #10): a keyword search first, then a tap when it would help.
  const [llm, setLlm] = useState<{ q: string; downloaded: boolean } | null>(null);

  useEffect(() => {
    if (!location.hash.startsWith('#/wardrobe')) return;
    const qs = filterToQuery(filter, results?.q);
    const hash = `#/wardrobe${qs ? `?${qs}` : ''}`;
    if (location.hash !== hash) history.replaceState(history.state, '', hash);
    writeSearch(results);
  }, [filter, results]);
  // The same screen can be re-opened with another query (the route key ignores it): the Wardrobe tab, a place link.
  // A search in the URL whose results weren't kept runs again.
  const routeQs = route.query.toString();
  useEffect(() => {
    const p = new URLSearchParams(routeQs);
    setFilter(filterFromQuery(p));
    const q = p.get('q') ?? '';
    setQuery(q);
    if (!q) { setResults(null); setLlm(null); } else if (readSearch()?.q !== q) void runSearch(q);
  }, [routeQs]);

  // The scroll position comes back too. It is read before the shell scrolls the new screen to the top.
  const [savedY] = useState(() => readScroll(location.hash));
  const restored = useRef(false);
  useEffect(() => {
    let raf = 0;
    const onScroll = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => { if (restored.current && location.hash.startsWith('#/wardrobe')) writeScroll(location.hash, scrollY); });
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => { window.removeEventListener('scroll', onScroll); cancelAnimationFrame(raf); };
  }, []);

  const all = useMemo(() => [...(items ?? [])].sort((a, b) => b.createdAt - a.createdAt), [items]);
  const shown = useMemo(() => {
    let list = all;
    if (results) {
      const byId = new Map(all.map((it) => [it.id, it]));
      list = results.ids.map((id) => byId.get(id)).filter((x): x is Item => !!x);
    }
    return applyFilter(list, filter, { notWornMonths: months });
  }, [all, results, filter, months]);
  const photos = usePhotos(shown.map((it) => it.tryOnPhotoId));
  const placeName = (id?: string) => places.find((p) => p.id === id)?.name;
  const presentColours = useMemo(() => COLOURS.filter((c) => all.some((it) => it.colours.includes(c)) || filter.colours.includes(c)), [all, filter.colours]);

  useEffect(() => {
    if (restored.current || !items) return;
    restored.current = true;
    if (savedY) requestAnimationFrame(() => window.scrollTo(0, savedY));
  }, [items, savedY]);

  async function runSearch(q: string, smart = false) {
    const text = q.trim();
    if (!text) { setResults(null); setLlm(null); return; }
    setSearching(true);
    try {
      const r = await searchWardrobeDetailed(text, { llm: smart ? 'run' : 'off' });
      const ids = [...r.hits].sort((a, b) => b.score - a.score).map((h) => h.itemId);
      setResults({ q: text, ids: ids.length ? ids : localSearch(all, text, places, i18n), smart: r.usedLlm });
      setLlm(r.needsLlm && r.llmUsable && !r.usedLlm ? { q: text, downloaded: r.llmDownloaded } : null);
      if (smart && !r.usedLlm) notify({ text: t('wardrobe.search.smarterFailed'), ms: 5000 });
    } catch (err) {
      reportError(err, 'wardrobe.search');
      setResults({ q: text, ids: localSearch(all, text, places, i18n) });
      setLlm(null);
    } finally {
      setSearching(false);
    }
  }

  const patch = (p: Partial<WardrobeFilter>) => setFilter((f) => ({ ...f, ...p }));
  const listLabel = <T extends string>(values: T[], label: (v: T) => string) =>
    values.length === 0 ? undefined : values.length === 1 ? label(values[0]) : t('wardrobe.filter.more', { first: label(values[0]), n: values.length - 1 });
  const colourLabel = listLabel(filter.colours, (c: ColourName) => t(`colour.${c}`));
  const seasonLabel = listLabel(filter.seasons, (s: Season) => t(`season.${s}`));
  const placeLabel = filter.place === 'none' ? t('wardrobe.item.noPlace') : placeName(filter.place);

  if (!items) return <div className="screen" />;

  return (
    <div className="screen wd">
      <div className="stack gap-12">
        <div className="header">
          <div className="wd-titlerow">
            <h1 className="h1">{t('wardrobe.title')}</h1>
            <span className="wd-count">{tn('count.items', all.length)}</span>
          </div>
        </div>

        <form className="wd-search" role="search" onSubmit={(e) => { e.preventDefault(); void runSearch(query); (document.activeElement as HTMLElement | null)?.blur(); }}>
          <Icon name="search" size={20} />
          <label className="grow">
            <span className="sr-only">{t('wardrobe.search.label')}</span>
            <input type="search" enterKeyHint="search" value={query} placeholder={t('wardrobe.search.placeholder')}
              onChange={(e) => { setQuery(e.target.value); if (!e.target.value) { setResults(null); setLlm(null); } }} />
          </label>
          {searching ? <span className="spinner" role="status" aria-label={t('wardrobe.search.searching')} />
            : query ? (
              <button type="button" className="wd-search__clear" aria-label={t('wardrobe.search.clear')} onClick={() => { setQuery(''); setResults(null); setLlm(null); }}>
                <Icon name="close" size={18} />
              </button>
            ) : <AiMark size={16} />}
        </form>

        {review && review.length > 0 && (
          <a className="wd-banner" href="#/review">
            <span className="wd-banner__n num">{review.length}</span>
            <span className="grow">{tn('wardrobe.reviewBanner', review.length)}</span>
            <Icon name="chevron" size={20} strokeWidth={2} />
          </a>
        )}

        {all.length > 0 && <>
        <div className="hscroll wd-chiprow" role="group" aria-label={t('wardrobe.item.category')}>
          {(['all', ...CATEGORY_GROUPS] as const).map((g) => (
            <button key={g} type="button" className="wd-opt" aria-pressed={filter.group === g} onClick={() => patch({ group: g })}>
              {t(`wardrobe.group.${g}`)}
            </button>
          ))}
        </div>

        <div className="hscroll wd-chiprow" role="group" aria-label={t('wardrobe.filter.label')}>
          <button type="button" className="wd-drop" aria-pressed={!!colourLabel} aria-haspopup="dialog" onClick={() => setSheet('colour')}>
            {colourLabel ?? t('wardrobe.filter.colour')}<Icon name="down" size={14} strokeWidth={2} />
          </button>
          <button type="button" className="wd-drop" aria-pressed={!!seasonLabel} aria-haspopup="dialog" onClick={() => setSheet('season')}>
            {seasonLabel ?? t('wardrobe.filter.season')}<Icon name="down" size={14} strokeWidth={2} />
          </button>
          <button type="button" className="wd-drop" aria-pressed={!!placeLabel} aria-haspopup="dialog" onClick={() => setSheet('place')}>
            <span className={placeLabel ? 'wd-drop__hand' : undefined}>{placeLabel ?? t('wardrobe.filter.place')}</span><Icon name="down" size={14} strokeWidth={2} />
          </button>
          <button type="button" className="wd-drop" aria-pressed={filter.notWorn} onClick={() => patch({ notWorn: !filter.notWorn })}>
            {tn('wardrobe.filter.notWorn', months)}
          </button>
        </div>
        </>}
      </div>

      {(results || isFiltered(filter)) && all.length > 0 && (shown.length > 0 || isFiltered(filter)) && (
        <div className="wd-resultline">
          {/* With nothing found, the empty state below says so once (bug-audit #50). */}
          <span className="meta grow" aria-live="polite">
            {shown.length === 0 ? '' : results ? tn('wardrobe.search.results', shown.length, { q: results.q }) : tn('count.items', shown.length)}
          </span>
          {isFiltered(filter) && <button type="button" className="text-action" onClick={() => setFilter(EMPTY_FILTER)}>{t('wardrobe.filter.clear')}</button>}
        </div>
      )}
      {results && llm?.q === results.q && all.length > 0 && (
        <div className="wd-smarter">
          <button type="button" className="text-action" disabled={searching}
            onClick={() => (llm.downloaded ? void runSearch(results.q, true) : setSheet('smarter'))}>
            <AiMark size={15} />{t('wardrobe.search.smarter')}
          </button>
        </div>
      )}

      {all.length === 0 ? (
        <Empty icon="wardrobe" action={<button type="button" className="btn btn--primary" onClick={() => navigate('/add')}><Icon name="camera" size={20} />{t('tab.add')}</button>}>
          {t('wardrobe.empty')}
        </Empty>
      ) : shown.length === 0 ? (
        <Empty icon="search">{results ? t('wardrobe.search.none', { q: results.q }) : t('wardrobe.noMatch')}</Empty>
      ) : (
        <ul className="wd-grid" aria-label={t('wardrobe.title')}>
          {shown.map((it, i) => {
            const photo = it.tryOnPhotoId ? photos.get(it.tryOnPhotoId) : undefined;
            const place = placeName(it.locationId);
            return (
              <li key={it.id}>
                <a className="wd-card" href={`#/item/${it.id}`} style={{ transform: `rotate(${tiltFor(i)}deg)` }}>
                  <CutoutImg blob={photo?.thumb ?? photo?.cutout} alt="" style={{ width: '100%', height: 72 }} />
                  <span className="wd-card__name">{it.name}</span>
                  {place && <span className="wd-card__place"><Icon name="pin" size={11} strokeWidth={2.2} />{place}</span>}
                </a>
              </li>
            );
          })}
        </ul>
      )}

      {sheet === 'smarter' && (
        <TitledSheet title={t('wardrobe.search.getModel')} onClose={() => setSheet(null)}
          footer={<button type="button" className="btn btn--primary btn--block" onClick={() => { setSheet(null); navigate('/model-lab'); }}>{t('wardrobe.search.openLab')}</button>}>
          <p className="body wd-muted">{t('wardrobe.search.getModelBody')}</p>
        </TitledSheet>
      )}
      {sheet === 'colour' && (
        <ColourSheet only={presentColours} value={filter.colours} onChange={(colours) => patch({ colours })} onClose={() => setSheet(null)} />
      )}
      {sheet === 'season' && (
        <TitledSheet title={t('wardrobe.item.seasons')} onClose={() => setSheet(null)}
          footer={<button type="button" className="btn btn--primary btn--block" onClick={() => setSheet(null)}>{t('action.done')}</button>}>
          <div className="wd-seasons">
            {SEASONS.map((s) => (
              <button key={s} type="button" className="wd-opt" aria-pressed={filter.seasons.includes(s)}
                onClick={() => patch({ seasons: filter.seasons.includes(s) ? filter.seasons.filter((x) => x !== s) : [...filter.seasons, s] })}>
                {t(`season.${s}`)}
              </button>
            ))}
          </div>
        </TitledSheet>
      )}
      {sheet === 'place' && (
        <TitledSheet title={t('wardrobe.filter.place')} onClose={() => setSheet(null)}>
          <div className="wd-chips">
            <button type="button" className="wd-opt" aria-pressed={filter.place === undefined} onClick={() => { patch({ place: undefined }); setSheet(null); }}>
              {t('wardrobe.filter.anyPlace')}
            </button>
            {places.map((p, i) => (
              <button key={p.id} type="button" className="wd-tagbtn" aria-pressed={filter.place === p.id} style={{ transform: `rotate(${tiltFor(i)}deg)` }}
                onClick={() => { patch({ place: p.id }); setSheet(null); }}>{p.name}</button>
            ))}
            <button type="button" className="wd-opt" aria-pressed={filter.place === 'none'} onClick={() => { patch({ place: 'none' }); setSheet(null); }}>
              {t('wardrobe.item.noPlace')}
            </button>
          </div>
        </TitledSheet>
      )}
    </div>
  );
}
