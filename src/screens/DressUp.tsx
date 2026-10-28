// Dress-up (F6, D21, D31 option B): the mannequin on the left, a column of slots on the right joined to the body by
// callout lines, and a row of clothes that opens below the mannequin, never over it.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { navigate } from '../app/router';
import { db, newId } from '../data/db';
import { setDraft, todayISO, useActiveItems, useSettings } from '../data/repo';
import { useWeather } from '../data/weather';
import { CATEGORY, categoriesForSlot, placeItem, type DressupSlot } from '../domain/taxonomy';
import type { Item, OutfitDraft, Slot } from '../domain/types';
import { useI18n, type Key } from '../i18n';
import { MannequinStage, calloutPoints, useBody } from '../tryon';
import { GarmentThumb, isWorn, putOn, takeOff, useItemPhotos, useMatchingOutfit, useViewport } from '../tryon/ui';
import { Icon } from '../ui/icons';
import { IconButton, Sheet, Stamp, Toast } from '../ui/parts';
import '../styles/dressup.css';

type Open = DressupSlot | 'acc';
type TopLayer = 'base' | 'mid' | 'outer';

const SLOT_H = 46;
const TOP_H = 84;
const GAP = 6;
const EMPTY_DRAFT: OutfitDraft = { slots: {}, accessories: [], toggles: { tuckIn: false, intoBoots: false } };

const LABEL: Record<DressupSlot, Key> = { head: 'zone.head', neck: 'zone.neck', top: 'zone.top', hands: 'zone.hands', legs: 'zone.legs', feet: 'zone.feet' };
const ADD: Record<DressupSlot, Key> = { head: 'dressup.add.head', neck: 'dressup.add.neck', top: 'dressup.add.top', hands: 'dressup.add.hands', legs: 'dressup.add.legs', feet: 'dressup.add.feet' };

/** The draft slot a Dress-up slot (and Top layer tab) edits. */
const slotOf = (open: Open, layer: TopLayer): Slot | 'acc' => (open === 'top' ? layer : open);

export default function DressUp() {
  const { t } = useI18n();
  const settings = useSettings();
  const items = useActiveItems();
  const draft = settings?.draft ?? EMPTY_DRAFT;
  const body = useBody();
  const weather = useWeather();
  const matched = useMatchingOutfit(settings?.draft);
  const vp = useViewport();

  const [open, setOpen] = useState<Open | null>(null);
  const [layer, setLayer] = useState<TopLayer>('outer');
  const [toast, setToast] = useState<{ text: string; undo?: () => void } | null>(null);
  const [saving, setSaving] = useState(false);
  const [freshStamp, setFreshStamp] = useState(false);

  // Items on the mannequin (they may not be in the active list, e.g. archived since).
  const draftIds = useMemo(() => [...new Set([...Object.values(draft.slots), ...draft.accessories].filter(Boolean) as string[])], [draft]);
  const wornItems = useLiveQuery(async () => (await db.items.bulkGet(draftIds)).filter((x): x is Item => !!x), [draftIds.join(',')]);
  const byId = useMemo(() => new Map((wornItems ?? []).map((i) => [i.id, i])), [wornItems]);
  const photos = useItemPhotos(useMemo(() => [...(items ?? []), ...(wornItems ?? [])], [items, wornItems]));
  const itemOf = (id?: string) => (id ? byId.get(id) : undefined);

  // Wear log for today: is this exact outfit already logged?
  const today = todayISO();
  const todays = useLiveQuery(() => db.wear.where('date').equals(today).toArray(), [today]);
  const wornEntry = useMemo(() => {
    if (!todays || !draftIds.length) return undefined;
    const want = [...draftIds].sort().join(',');
    return todays.find((w) => [...w.itemIds].sort().join(',') === want);
  }, [todays, draftIds]);

  const update = useCallback((next: OutfitDraft) => { void setDraft(next); }, []);

  // ----- Layout: mannequin size from the space above the clothes row, and the slot column beside it.
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
  const mh = Math.round(Math.max(300, Math.min(stageH + 6, 2 * (vp.w - 170), 520)));
  const mLeft = 4;
  const mTop = 2;
  const colLeft = mLeft + mh / 2 + 12;
  const colW = Math.max(112, Math.min(150, vp.w - colLeft - 14));

  const points = useMemo(() => (body ? calloutPoints(body) : undefined), [body]);
  const scale = mh / 2000;
  const toCss = (p: { x: number; y: number }) => ({ x: mLeft + p.x * scale, y: mTop + p.y * scale });

  const top = draft.slots.outer ?? draft.slots.mid ?? draft.slots.base ?? draft.slots.full;
  const layersOn = [draft.slots.base ?? draft.slots.full, draft.slots.mid, draft.slots.outer];
  const slots = useMemo(() => {
    if (!points) return [];
    const order: DressupSlot[] = ['head', 'neck', 'top', 'hands', 'legs', 'feet'];
    let y = -Infinity;
    const placed = order.map((id) => {
      const h = id === 'top' ? TOP_H : SLOT_H;
      const target = toCss(points[id]);
      const want = Math.max(target.y - h / 2, y + GAP);
      y = want + h;
      return { id, h, top: want, target };
    });
    // Keep the column inside the stage: shift up from the bottom if it overflows.
    let limit = mTop + mh - 10;
    for (let i = placed.length - 1; i >= 0; i--) {
      if (placed[i].top + placed[i].h > limit) placed[i].top = limit - placed[i].h;
      limit = placed[i].top - GAP;
    }
    return placed;
  }, [points, mh]);

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
    if (isWorn(draft, item.id)) { update(takeOff(draft, item.id)); return; }
    if (editSlot && editSlot !== 'acc' && CATEGORY[item.category].slot !== 'full' && CATEGORY[item.category].slot !== editSlot) return;
    update(putOn(draft, item));
  };
  const clearSlot = () => {
    if (!editSlot) return;
    if (editSlot === 'acc') { update({ ...draft, outfitId: undefined, accessories: [] }); return; }
    let next = placeItem(draft.slots, editSlot, undefined);
    if (editSlot === 'base' || editSlot === 'legs') next = placeItem(next, 'full', undefined);
    update({ ...draft, outfitId: undefined, slots: next });
  };
  const wornInRow = editSlot === 'acc' ? undefined : editSlot ? (draft.slots[editSlot] ?? ((editSlot === 'base' || editSlot === 'legs') ? draft.slots.full : undefined)) : undefined;
  const toggle = open === 'top' && layer === 'base'
    ? { label: t('dressup.tuckIn'), on: draft.toggles.tuckIn, flip: () => update({ ...draft, outfitId: undefined, toggles: { ...draft.toggles, tuckIn: !draft.toggles.tuckIn } }) }
    : open === 'legs' || open === 'feet'
      ? { label: t('dressup.intoBoots'), on: draft.toggles.intoBoots, flip: () => update({ ...draft, outfitId: undefined, toggles: { ...draft.toggles, intoBoots: !draft.toggles.intoBoots } }) }
      : null;
  const rowTitle = open === 'acc' ? t('zone.acc') : open ? t(LABEL[open]) : '';

  // ----- Actions.
  const empty = draftIds.length === 0;
  const saveOutfit = async (name: string) => {
    const now = Date.now();
    const id = newId();
    await db.outfits.add({ id, name: name.trim() || t('dressup.newCombination'), slots: { ...draft.slots }, accessories: [...draft.accessories], toggles: { ...draft.toggles }, createdAt: now, updatedAt: now });
    await setDraft({ ...draft, outfitId: id });
    setSaving(false);
    setToast({ text: t('dressup.outfitSaved') });
  };
  const wearToday = async () => {
    if (empty) { setToast({ text: t('dressup.nothingOn') }); return; }
    if (wornEntry) { await undoWear(wornEntry.id, wornItems ?? []); return; }
    const before = (wornItems ?? []).map((i) => ({ id: i.id, lastWornAt: i.lastWornAt }));
    const id = newId();
    const now = Date.now();
    await db.transaction('rw', db.wear, db.items, async () => {
      await db.wear.add({ id, date: today, outfitId: matched?.id, itemIds: draftIds, createdAt: now });
      for (const it of draftIds) await db.items.update(it, { lastWornAt: now });
    });
    setFreshStamp(true);
    setToast({
      text: t('dressup.logged'),
      undo: () => {
        void db.transaction('rw', db.wear, db.items, async () => {
          await db.wear.delete(id);
          for (const b of before) await db.items.update(b.id, { lastWornAt: b.lastWornAt });
        });
      },
    });
  };
  const undoWear = async (entryId: string, worn: Item[]) => {
    await db.transaction('rw', db.wear, db.items, async () => {
      await db.wear.delete(entryId);
      // Fall back to the latest earlier wear of each item, if any.
      for (const it of worn) {
        const prev = await db.wear.filter((w) => w.itemIds.includes(it.id)).toArray();
        const last = prev.map((w) => w.createdAt).sort((a, b) => b - a)[0];
        await db.items.update(it.id, { lastWornAt: last });
      }
    });
    setFreshStamp(false);
  };

  useEffect(() => { if (!wornEntry) setFreshStamp(false); }, [wornEntry]);

  if (!settings) return null;
  const noClothes = items !== undefined && items.length === 0;
  const selectedItemId = wornInRow;

  return (
    <div className="du">
      <div className="header du__header">
        <h1 className="h1">{t('dressup.title')}</h1>
        <div className="header__actions">
          <IconButton icon="settings" label={t('action.settings')} onClick={() => navigate('/settings')} />
        </div>
      </div>

      <div className="du__stage" ref={stageRef}>
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
                  return (
                    <button key={s.id} type="button" className={`du-slot du-slot--top${on ? ' is-on' : ''}`} aria-expanded={on}
                      style={{ left: colLeft, top: s.top, width: colW, height: s.h }} onClick={() => openSlot('top')}>
                      <span className="du-slot__text">
                        <span className="du-slot__label">{t('dressup.topLayers', { n })}</span>
                        <span className="du-slot__name">{it ? it.name : t(ADD.top)}</span>
                      </span>
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
              {t('zone.acc')}
              {draft.accessories.length > 0 && <span className="du__extras-count">{draft.accessories.length}</span>}
            </button>
          </>
        )}
      </div>

      {wornEntry && !open && (
        <span className="du__stamp"><Stamp animate={freshStamp}>{t('dressup.wornStamp')}</Stamp></span>
      )}

      {!open && (
        <section className="du__sheet paper-edge" aria-label={t('dressup.thisOutfit')}>
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
                <span className="tag du__tag">{matched ? matched.name : t('dressup.newCombination')}</span>
                {weather ? (
                  <span className="du__weather"><Icon name="weather" size={18} strokeWidth={1.7} />{t('dressup.weather', { t: weather.tempC, summary: weather.summary })}</span>
                ) : (
                  <span className="meta">{matched ? t('dressup.savedState') : t('dressup.notSaved')}</span>
                )}
              </div>
              <div className="du__actions">
                <button type="button" className="btn btn--primary du__save" aria-disabled={!!matched || empty}
                  onClick={() => { if (empty) setToast({ text: t('dressup.nothingOn') }); else if (!matched) setSaving(true); }}>
                  <Icon name={matched ? 'check' : 'outfits'} size={20} />{matched ? t('dressup.saved') : t('dressup.saveOutfit')}
                </button>
                <button type="button" className="btn btn--secondary du__wear" aria-pressed={!!wornEntry} onClick={() => void wearToday()}>
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
        <section className="du__row paper-edge" aria-label={rowTitle}>
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

      {saving && <SaveSheet draft={draft} items={wornItems ?? []} onCancel={() => setSaving(false)} onSave={(n) => void saveOutfit(n)} />}
      {toast && (
        <Toast onDone={() => setToast(null)} action={toast.undo ? (
          <button type="button" className="text-action" onClick={() => { toast.undo?.(); setToast(null); }}>{t('dressup.undo')}</button>
        ) : undefined}>{toast.text}</Toast>
      )}
    </div>
  );
}

function SaveSheet({ draft, items, onCancel, onSave }: { draft: OutfitDraft; items: Item[]; onCancel: () => void; onSave: (name: string) => void }) {
  const { t } = useI18n();
  const byId = new Map(items.map((i) => [i.id, i]));
  const top = draft.slots.full ?? draft.slots.outer ?? draft.slots.mid ?? draft.slots.base;
  const suggestion = [top, draft.slots.full ? undefined : draft.slots.legs].map((id) => (id ? byId.get(id)?.name : undefined)).filter(Boolean).join(' + ');
  const [name, setName] = useState(suggestion);
  return (
    <Sheet onClose={onCancel} label={t('dressup.saveTitle')}>
      <form className="du__save-sheet" onSubmit={(e) => { e.preventDefault(); onSave(name); }}>
        <h2 className="h2">{t('dressup.saveTitle')}</h2>
        <label className="field">
          <span className="field__label">{t('dressup.outfitName')}</span>
          <input className="input" value={name} placeholder={t('dressup.outfitNameHint')} onChange={(e) => setName(e.target.value)} autoFocus maxLength={60} />
        </label>
        <div className="row gap-12">
          <button type="button" className="btn btn--secondary grow" onClick={onCancel}>{t('action.cancel')}</button>
          <button type="submit" className="btn btn--primary grow">{t('action.save')}</button>
        </div>
      </form>
    </Sheet>
  );
}
