// Dress-up (F6, D21, D31 option B): the mannequin on the left, a column of slots on the right joined to the body by
// callout lines, and a row of clothes that opens below the mannequin, never over it.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { navigate } from '../app/router';
import { db, newId } from '../data/db';
import { todayISO, useActiveItems, useSettings } from '../data/repo';
import { useWeather } from '../data/weather';
import { CATEGORY, categoriesForSlot, placeItem, type DressupSlot } from '../domain/taxonomy';
import type { Item, OutfitDraft, Slot } from '../domain/types';
import { useI18n, type Key } from '../i18n';
import { deleteWear, logWear } from '../life/wear';
import { MannequinStage, calloutPoints, useBody } from '../tryon';
import { editDraft, GarmentThumb, isWorn, putOn, takeOff, useItemPhotos, useMatchingOutfit, useViewport } from '../tryon/ui';
import { attempt, useAction } from '../ui/action';
import { Icon } from '../ui/icons';
import { IconButton, Sheet, Stamp, Toast } from '../ui/parts';
import '../styles/dressup.css';

type Open = DressupSlot | 'acc';
type TopLayer = 'base' | 'mid' | 'outer';

/**
 * Slot sizes, roomiest first. The column takes the first that fits between the header and the bottom panel; the last
 * drops the Top slot's layer thumbnails (an open row has the layer switch). Targets stay ≥ 44 px.
 */
const TIERS = [
  { slot: 46, top: 84, gap: 6 },
  { slot: 44, top: 72, gap: 4 },
  { slot: 44, top: 68, gap: 2 },
  { slot: 44, top: 44, gap: 2 },
];
const ORDER: DressupSlot[] = ['head', 'neck', 'top', 'hands', 'legs', 'feet'];
const EMPTY_DRAFT: OutfitDraft = { slots: {}, accessories: [], toggles: { tuckIn: false, intoBoots: false } };
const BODY_CARD_HIDDEN = 'imq.bodyCard.hidden';

const LABEL: Record<DressupSlot, Key> = { head: 'zone.head', neck: 'zone.neck', top: 'zone.top', hands: 'zone.hands', legs: 'zone.legs', feet: 'zone.feet' };
const ADD: Record<DressupSlot, Key> = { head: 'dressup.add.head', neck: 'dressup.add.neck', top: 'dressup.add.top', hands: 'dressup.add.hands', legs: 'dressup.add.legs', feet: 'dressup.add.feet' };

/** The draft slot a Dress-up slot (and Top layer tab) edits. */
const slotOf = (open: Open, layer: TopLayer): Slot | 'acc' => (open === 'top' ? layer : open);
const sameItems = (a: string[], b: string[]) => [...a].sort().join(',') === [...b].sort().join(',');

export default function DressUp() {
  const { t } = useI18n();
  const settings = useSettings();
  const items = useActiveItems();
  const draft = settings?.draft ?? EMPTY_DRAFT;
  const body = useBody();
  const bodies = useLiveQuery(() => db.body.count(), []);
  const weather = useWeather();
  const matched = useMatchingOutfit(settings?.draft);
  const vp = useViewport();

  const [open, setOpen] = useState<Open | null>(null);
  const [layer, setLayer] = useState<TopLayer>('outer');
  const [toast, setToast] = useState<{ text: string; undo?: () => void } | null>(null);
  const [saving, setSaving] = useState(false);
  const [freshStamp, setFreshStamp] = useState(false);
  const [cardHidden, setCardHidden] = useState(() => { try { return localStorage.getItem(BODY_CARD_HIDDEN) === '1'; } catch { return false; } });

  // Items on the mannequin (they may not be in the active list, e.g. archived since).
  const draftIds = useMemo(() => [...new Set([...Object.values(draft.slots), ...draft.accessories].filter(Boolean) as string[])], [draft]);
  const wornItems = useLiveQuery(async () => (await db.items.bulkGet(draftIds)).filter((x): x is Item => !!x), [draftIds.join(',')]);
  const byId = useMemo(() => new Map((wornItems ?? []).map((i) => [i.id, i])), [wornItems]);
  const photos = useItemPhotos(useMemo(() => [...(items ?? []), ...(wornItems ?? [])], [items, wornItems]));
  const itemOf = (id?: string) => (id ? byId.get(id) : undefined);

  // Wear log for today: is this exact outfit already logged?
  const today = todayISO();
  const todays = useLiveQuery(() => db.wear.where('date').equals(today).toArray(), [today]);
  const wornEntry = useMemo(() => (todays && draftIds.length ? todays.find((w) => sameItems(w.itemIds, draftIds)) : undefined), [todays, draftIds]);

  /** Every draft change: written from the stored draft (quick taps never lose one), failures shown (bug-audit #3, #23). */
  const edit = useCallback((change: (d: OutfitDraft) => OutfitDraft) => {
    void attempt('dressup.draft', () => editDraft(change), t('state.saveFailed'));
  }, [t]);

  // ----- Layout: the bottom panel's height, then the mannequin from the space above it, and the slot column beside it.
  const [panelH, setPanelH] = useState(142);
  const panelRO = useRef<ResizeObserver | null>(null);
  const panelRef = useCallback((el: HTMLElement | null) => {
    panelRO.current?.disconnect();
    if (!el) return;
    const ro = new ResizeObserver(() => setPanelH(el.offsetHeight));
    ro.observe(el);
    panelRO.current = ro;
    setPanelH(el.offsetHeight);
  }, []);
  // The app's toasts are drawn outside this screen; they read this to sit above the panel (bug-audit #44).
  useEffect(() => {
    document.body.style.setProperty('--du-panel', `${panelH}px`);
    return () => { document.body.style.removeProperty('--du-panel'); };
  }, [panelH]);

  const [stageH, setStageH] = useState(0);
  const roRef = useRef<ResizeObserver | null>(null);
  const stageRef = useCallback((el: HTMLDivElement | null) => {
    roRef.current?.disconnect();
    if (!el) return;
    const ro = new ResizeObserver(() => setStageH(el.clientHeight));
    ro.observe(el);
    roRef.current = ro;
    setStageH(el.clientHeight);
  }, []);
  // No floor: on a small phone with a row open, a floor pushed the feet under the row (bug-audit #27, D31).
  const mh = Math.round(Math.max(120, Math.min(stageH - 8, 2 * (vp.w - 170), 520)));
  const mLeft = 4;
  const mTop = 2;
  const colLeft = mLeft + mh / 2 + 12;
  const colW = Math.max(112, Math.min(150, vp.w - colLeft - 14));

  const points = useMemo(() => (body ? calloutPoints(body) : undefined), [body]);
  const scale = mh / 2000;
  const toCss = (p: { x: number; y: number }) => ({ x: mLeft + p.x * scale, y: mTop + p.y * scale });

  const top = draft.slots.outer ?? draft.slots.mid ?? draft.slots.base ?? draft.slots.full;
  const layersOn = [draft.slots.base ?? draft.slots.full, draft.slots.mid, draft.slots.outer];
  const { tier, slots } = useMemo(() => {
    if (!points) return { tier: TIERS[0], slots: [] };
    // The column lives between the header (the stage's top) and the bottom panel's torn edge (bug-audit #27).
    const avail = stageH - 12;
    const total = (ids: DressupSlot[], tr: typeof TIERS[number]) => ids.reduce((s, id) => s + (id === 'top' ? tr.top : tr.slot), 0) + (ids.length - 1) * tr.gap;
    const tr = TIERS.find((x) => total(ORDER, x) <= avail) ?? TIERS[TIERS.length - 1];
    let ids = ORDER;
    if (open && total(ids, tr) > avail) {
      // A short screen with a row open: the open slot and as many neighbours as fit; closing the row shows them all.
      const at = ORDER.indexOf(open === 'acc' ? 'top' : open);
      let lo = at;
      let hi = at;
      for (;;) {
        const up = lo > 0 && total(ORDER.slice(lo - 1, hi + 1), tr) <= avail;
        const down = hi < ORDER.length - 1 && total(ORDER.slice(lo, hi + 2), tr) <= avail;
        if (!up && !down) break;
        if (down && (!up || hi - at <= at - lo)) hi++;
        else lo--;
      }
      ids = ORDER.slice(lo, hi + 1);
    }
    let y = -Infinity;
    const placed = ids.map((id) => {
      const h = id === 'top' ? tr.top : tr.slot;
      const target = toCss(points[id]);
      const want = Math.max(0, target.y - h / 2, y + tr.gap);
      y = want + h;
      return { id, h, top: want, target };
    });
    // Keep the column above the panel: shift up from the bottom, then never above the header.
    let limit = avail;
    for (let i = placed.length - 1; i >= 0; i--) {
      if (placed[i].top + placed[i].h > limit) placed[i].top = limit - placed[i].h;
      limit = placed[i].top - tr.gap;
    }
    y = 0;
    for (const p of placed) { p.top = Math.max(p.top, y); y = p.top + p.h + tr.gap; }
    return { tier: tr, slots: placed };
  }, [points, mh, stageH, open]);

  const openSlot = (id: Open) => {
    if (open === id) { setOpen(null); return; }
    if (id === 'top') setLayer(draft.slots.outer ? 'outer' : draft.slots.mid ? 'mid' : 'base');
    setOpen(id);
  };
  const onZone = (z: string) => openSlot(z === 'torso' ? 'top' : (z as Open));

  // ----- Clothes row for the open slot.
  const editSlot = open ? slotOf(open, layer) : undefined;
  const rowItems = useMemo(() => {
    if (!editSlot || !items) return [];
    const cats = new Set(categoriesForSlot(editSlot).map((c) => c.id));
    return items
      .filter((i) => cats.has(i.category))
      .sort((a, b) => (b.lastWornAt ?? 0) - (a.lastWornAt ?? 0) || a.name.localeCompare(b.name));
  }, [editSlot, items]);
  const wearCard = (item: Item) => {
    const slot = editSlot;
    edit((d) => {
      if (isWorn(d, item.id)) return takeOff(d, item.id);
      if (slot && slot !== 'acc' && CATEGORY[item.category].slot !== 'full' && CATEGORY[item.category].slot !== slot) return d;
      return putOn(d, item);
    });
  };
  const clearSlot = () => {
    const slot = editSlot;
    if (!slot) return;
    edit((d) => {
      if (slot === 'acc') return { ...d, outfitId: undefined, accessories: [] };
      let next = placeItem(d.slots, slot, undefined);
      if (slot === 'base' || slot === 'legs') next = placeItem(next, 'full', undefined);
      return { ...d, outfitId: undefined, slots: next };
    });
  };
  const wornInRow = editSlot === 'acc' ? undefined : editSlot ? (draft.slots[editSlot] ?? ((editSlot === 'base' || editSlot === 'legs') ? draft.slots.full : undefined)) : undefined;
  const flip = (k: 'tuckIn' | 'intoBoots') => edit((d) => ({ ...d, outfitId: undefined, toggles: { ...d.toggles, [k]: !d.toggles[k] } }));
  const toggle = open === 'top' && layer === 'base'
    ? { label: t('dressup.tuckIn'), on: draft.toggles.tuckIn, flip: () => flip('tuckIn') }
    : open === 'legs' || open === 'feet'
      ? { label: t('dressup.intoBoots'), on: draft.toggles.intoBoots, flip: () => flip('intoBoots') }
      : null;
  const rowTitle = open === 'acc' ? t('zone.acc') : open ? t(LABEL[open]) : '';

  // ----- Actions. One at a time (no double saves, bug-audit #23); failures are shown with Retry (#3).
  const empty = draftIds.length === 0;
  const opts = { errorText: t('state.saveFailed'), retryLabel: t('action.retry') };
  const saveOutfit = useAction('dressup.saveOutfit', async (name: string) => {
    const now = Date.now();
    const id = newId();
    await db.transaction('rw', db.outfits, db.settings, async () => {
      await db.outfits.add({ id, name: name.trim() || t('dressup.newCombination'), slots: { ...draft.slots }, accessories: [...draft.accessories], toggles: { ...draft.toggles }, createdAt: now, updatedAt: now });
      await editDraft((d) => ({ ...d, outfitId: id }));
    });
    setSaving(false);
    setToast({ text: t('dressup.outfitSaved') });
  }, opts);
  const wear = useAction('dressup.wearToday', async (intent: 'log' | 'unlog') => {
    if (intent === 'unlog') {
      // "✓ Worn today" takes today's entry back, with Undo (bug-audit #21).
      const entry = wornEntry;
      if (!entry) return;
      await deleteWear(entry.id);
      setFreshStamp(false);
      setToast({ text: t('dressup.unlogged'), undo: () => void attempt('dressup.undoUnlog', () => logWear(entry.date, entry.itemIds, entry.outfitId), t('state.saveFailed')) });
      return;
    }
    const ids = draftIds;
    // Logged once, even when a second tap arrives before the screen shows the first.
    const id = await db.transaction('rw', db.wear, db.items, async () => {
      const dup = await db.wear.where('date').equals(today).filter((w) => sameItems(w.itemIds, ids)).count();
      return dup ? undefined : logWear(today, ids, matched?.id);
    });
    if (!id) return;
    setFreshStamp(true);
    setToast({ text: t('dressup.logged'), undo: () => void attempt('dressup.undoWear', () => deleteWear(id), t('state.actionFailed')) });
  }, opts);
  const lastWearTap = useRef(0);
  const onWear = () => {
    if (empty) { setToast({ text: t('dressup.nothingOn') }); return; }
    // A double tap on the toggle would log the outfit and take it back at once.
    const now = Date.now();
    if (now - lastWearTap.current < 400) return;
    lastWearTap.current = now;
    void wear.run(wornEntry ? 'unlog' : 'log');
  };

  useEffect(() => { if (!wornEntry) setFreshStamp(false); }, [wornEntry]);

  const hideBodyCard = () => {
    setCardHidden(true);
    try { localStorage.setItem(BODY_CARD_HIDDEN, '1'); } catch { /* shown again next time */ }
  };

  if (!settings) return null;
  const noClothes = items !== undefined && items.length === 0;
  const selectedItemId = wornInRow;
  const showBodyCard = bodies === 0 && !cardHidden;

  return (
    <div className="du">
      <div className="header du__header">
        <h1 className="h1">{t('dressup.title')}</h1>
        <div className="header__actions">
          <IconButton icon="settings" label={t('action.settings')} onClick={() => navigate('/settings')} />
        </div>
      </div>

      <div className="du__stage" ref={stageRef} style={{ marginBottom: panelH }}>
        {stageH > 0 && (
          <>
            <div className="du__mannequin" style={{ left: mLeft, top: mTop }}>
              <MannequinStage draft={draft} height={mh} onTapZone={onZone} selectedItemId={selectedItemId} />
            </div>
            <svg className="du__lines" aria-hidden="true">
              {slots.map((s) => {
                const on = open === s.id;
                const y = s.top + s.h / 2;
                const d = `M${colLeft} ${y}L${s.target.x + 22} ${y}L${s.target.x} ${s.target.y}`;
                return (
                  <g key={s.id} className={on ? 'is-on' : undefined}>
                    <path d={d} className="du__line" />
                    <circle cx={s.target.x} cy={s.target.y} r={on ? 3.4 : 2.8} className="du__dot" />
                  </g>
                );
              })}
            </svg>
            <div className="du__slots" role="group" aria-label={t('dressup.slots')}>
              {slots.map((s) => {
                const on = open === s.id;
                if (s.id === 'top') {
                  const n = layersOn.filter(Boolean).length;
                  const it = itemOf(top);
                  const compact = tier.top <= TIERS[3].top;
                  return (
                    <button key={s.id} type="button" className={`du-slot du-slot--top${on ? ' is-on' : ''}${tier.top < TIERS[0].top ? ' is-tight' : ''}`} aria-expanded={on}
                      style={{ left: colLeft, top: s.top, width: colW, height: s.h }} onClick={() => openSlot('top')}>
                      <span className="du-slot__text">
                        <span className="du-slot__label">{t('dressup.topLayers', { n })}</span>
                        <span className="du-slot__name">{it ? it.name : t(ADD.top)}</span>
                      </span>
                      {!compact && (
                        <span className="du-slot__layers">
                          {(['base', 'mid', 'outer'] as const).map((l, i) => {
                            const li = itemOf(layersOn[i]);
                            return (
                              <span key={l} className={`du-slot__layer${li ? '' : ' is-empty'}`} title={li ? li.name : t('dressup.layerEmpty', { layer: t(`layer.${l}`) })}>
                                {li ? <GarmentThumb item={li} photos={photos} w={32} h={26} /> : <Icon name="plus" size={14} strokeWidth={2} />}
                              </span>
                            );
                          })}
                        </span>
                      )}
                    </button>
                  );
                }
                const id = s.id === 'legs' ? draft.slots.legs ?? draft.slots.full : draft.slots[s.id as Slot];
                const it = itemOf(id);
                return (
                  <button key={s.id} type="button" className={`du-slot${it ? '' : ' is-empty'}${on ? ' is-on' : ''}`} aria-expanded={on}
                    style={{ left: colLeft, top: s.top, width: colW, height: s.h }} onClick={() => openSlot(s.id)}>
                    <span className="du-slot__thumb">
                      {it ? <GarmentThumb item={it} photos={photos} w={34} h={30} /> : <Icon name="plus" size={18} strokeWidth={1.8} />}
                    </span>
                    <span className="du-slot__text">
                      <span className="du-slot__label">{t(LABEL[s.id])}</span>
                      <span className="du-slot__name">{it ? it.name : t(ADD[s.id])}</span>
                    </span>
                  </button>
                );
              })}
            </div>
            <button type="button" className={`du__extras${open === 'acc' ? ' is-on' : ''}`} aria-expanded={open === 'acc'}
              style={{ top: mTop + mh * 0.67 }} onClick={() => openSlot('acc')}>
              <span className="du__extras-icon"><Icon name="bag" size={21} /></span>
              <span className="du__extras-label">{t('zone.acc')}</span>
              {draft.accessories.length > 0 && <span className="du__extras-count">{draft.accessories.length}</span>}
            </button>
          </>
        )}
      </div>

      {wornEntry && !open && (
        <span className="du__stamp" style={{ bottom: `calc(var(--tabbar-h) + ${panelH + 18}px)` }}><Stamp animate={freshStamp}>{t('dressup.wornStamp')}</Stamp></span>
      )}

      {!open && (
        <section className="du__sheet paper-edge" aria-label={t('dressup.thisOutfit')} ref={panelRef}>
          {noClothes ? (
            <div className="du__empty">
              <p className="body">{t('dressup.emptyWardrobe')}</p>
              <button type="button" className="btn btn--primary btn--block" onClick={() => navigate('/add')}>
                <Icon name="plus" size={20} />{t('dressup.addClothes')}
              </button>
            </div>
          ) : (
            <>
              <div className="du__sheet-top">
                {showBodyCard ? (
                  // A body photo skipped at onboarding: the way back to it (bug-audit #14).
                  <div className="du__body-card">
                    <a className="du__body-link" href="#/body" onClick={(e) => { e.preventDefault(); navigate('/body'); }}>
                      <Icon name="camera" size={18} />{t('dressup.bodyCard')}<Icon name="chevron" size={16} />
                    </a>
                    <button type="button" className="du__body-hide" aria-label={t('dressup.bodyCard.hide')} onClick={hideBodyCard}>
                      <Icon name="close" size={16} strokeWidth={2} />
                    </button>
                  </div>
                ) : (
                  <>
                    <span className="tag du__tag">{matched ? matched.name : t('dressup.newCombination')}</span>
                    {weather ? (
                      <span className="du__weather"><Icon name="weather" size={18} strokeWidth={1.7} />{t('dressup.weather', { t: weather.tempC, summary: weather.summary })}</span>
                    ) : (
                      <span className="meta">{matched ? t('dressup.savedState') : t('dressup.notSaved')}</span>
                    )}
                  </>
                )}
              </div>
              <div className="du__actions">
                <button type="button" className="btn btn--primary du__save" aria-disabled={!!matched || empty}
                  onClick={() => { if (empty) setToast({ text: t('dressup.nothingOn') }); else if (!matched) setSaving(true); }}>
                  <Icon name={matched ? 'check' : 'outfits'} size={20} />{matched ? t('dressup.saved') : t('dressup.saveOutfit')}
                </button>
                <button type="button" className="btn btn--secondary du__wear" aria-pressed={!!wornEntry} aria-busy={wear.busy} onClick={onWear}>
                  {wornEntry && <Icon name="check" size={18} strokeWidth={2.2} />}
                  {wornEntry ? t('dressup.wornToday') : t('dressup.wearingToday')}
                </button>
                <button type="button" className="btn btn--secondary btn--square" aria-label={t('dressup.share')} onClick={() => navigate('/share')}>
                  <Icon name="share" size={20} />
                </button>
              </div>
            </>
          )}
        </section>
      )}

      {open && (
        <section className="du__row paper-edge" aria-label={rowTitle} ref={panelRef}>
          <div className="du__row-head">
            <h2 className="h2">{rowTitle}</h2>
            <div className="du__row-actions">
              {wornInRow && (
                <a className="text-action" href={`#/fit/${wornInRow}`} onClick={(e) => { e.preventDefault(); navigate(`/fit/${wornInRow}`); }}>
                  <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 5h14v14H5Z" strokeDasharray="2.5 2.5" /><path d="M5 5h.01M19 5h.01M5 19h.01M19 19h.01" strokeWidth="4.5" /></svg>
                  {t('dressup.adjustFit')}
                </a>
              )}
              <a className="text-action" href={`#/see-all/${editSlot}`} onClick={(e) => { e.preventDefault(); navigate(`/see-all/${editSlot}`); }}>{t('action.seeAll')}</a>
              <IconButton icon="close" label={t('action.close')} variant="tissue" onClick={() => setOpen(null)} />
            </div>
          </div>
          <div className="du__row-controls">
            {open === 'top' && (
              <div role="group" aria-label={t('dressup.layer')} className="seg">
                {(['base', 'mid', 'outer'] as const).map((l) => (
                  <button key={l} type="button" aria-pressed={layer === l} onClick={() => setLayer(l)}>{t(`layer.${l}`)}</button>
                ))}
              </div>
            )}
            {toggle && (
              <button type="button" role="switch" aria-checked={toggle.on} className="switch du__toggle" onClick={toggle.flip}>
                <span className="switch__track" />{toggle.label}
              </button>
            )}
            {open !== 'top' && !toggle && <span className="meta">{t('dressup.tapCard')}</span>}
          </div>
          <div className="du__cards hscroll">
            <button type="button" className="du-card du-card--none" onClick={clearSlot}>
              <Icon name="none" size={24} strokeWidth={1.6} />{t('dressup.none')}
            </button>
            {rowItems.map((it) => {
              const on = isWorn(draft, it.id);
              return (
                <button key={it.id} type="button" className={`du-card${on ? ' is-on' : ''}`} aria-pressed={on} onClick={() => wearCard(it)}>
                  <span className="du-card__img"><GarmentThumb item={it} photos={photos} w={64} h={50} /></span>
                  <span className="du-card__name">{it.name}</span>
                </button>
              );
            })}
            {rowItems.length === 0 && (
              <div className="du-card du-card--add">
                <span className="meta">{t('dressup.rowEmpty')}</span>
                <a className="text-action" href="#/add" onClick={(e) => { e.preventDefault(); navigate('/add'); }}><Icon name="plus" size={16} />{t('dressup.addClothes')}</a>
              </div>
            )}
          </div>
        </section>
      )}

      {saving && <SaveSheet draft={draft} items={wornItems ?? []} busy={saveOutfit.busy} onCancel={() => setSaving(false)} onSave={(n) => void saveOutfit.run(n)} />}
      {toast && (
        <Toast onDone={() => setToast(null)} action={toast.undo ? (
          <button type="button" className="text-action" onClick={() => { toast.undo?.(); setToast(null); }}>{t('dressup.undo')}</button>
        ) : undefined}>{toast.text}</Toast>
      )}
    </div>
  );
}

function SaveSheet({ draft, items, busy, onCancel, onSave }: { draft: OutfitDraft; items: Item[]; busy: boolean; onCancel: () => void; onSave: (name: string) => void }) {
  const { t } = useI18n();
  const byId = new Map(items.map((i) => [i.id, i]));
  // Named after the top piece only (or what's there), so suggested names stay short (bug-audit #40).
  const first = [draft.slots.full, draft.slots.outer, draft.slots.mid, draft.slots.base, draft.slots.legs, draft.slots.feet].find((id) => id && byId.has(id));
  const [name, setName] = useState(first ? byId.get(first)!.name : '');
  return (
    <Sheet onClose={onCancel} label={t('dressup.saveTitle')}>
      <form className="du__save-sheet" onSubmit={(e) => { e.preventDefault(); if (!busy) onSave(name); }}>
        <h2 className="h2">{t('dressup.saveTitle')}</h2>
        <label className="field">
          <span className="field__label">{t('dressup.outfitName')}</span>
          <input className="input" value={name} placeholder={t('dressup.outfitNameHint')} onChange={(e) => setName(e.target.value)} autoFocus maxLength={60} />
        </label>
        <div className="row gap-12">
          <button type="button" className="btn btn--secondary grow" onClick={onCancel}>{t('action.cancel')}</button>
          <button type="submit" className="btn btn--primary grow" disabled={busy} aria-busy={busy}>{t('action.save')}</button>
        </div>
      </form>
    </Sheet>
  );
}
