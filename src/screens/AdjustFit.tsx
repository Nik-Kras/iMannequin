// Adjust fit (F7, D15, board AdjustFit): drag a garment's anchor handles, or move, scale and turn it as a whole.
// The correction is saved on the item in reference lengths, so it applies in every outfit and survives a new body
// photo (try-on §5). Every drag has a button alternative (WCAG 2.2, 2.5.7).
import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as RPointerEvent } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { goBack } from '../app/router';
import { db } from '../data/db';
import { useSettings } from '../data/repo';
import { CATEGORY } from '../domain/taxonomy';
import type { FitAdjustment, Item, OutfitDraft } from '../domain/types';
import { useI18n, type Key } from '../i18n';
import { isNeutralFit, MannequinStage, NEUTRAL_FIT, offsetForHandle, type Handle, type StageLayout } from '../tryon';
import { putOn, useViewport } from '../tryon/ui';
import { attempt, useAction } from '../ui/action';
import { Icon } from '../ui/icons';
import { Empty, Header, Segmented } from '../ui/parts';
import '../styles/dressup.css';

type Mode = 'points' | 'whole';
const EMPTY_DRAFT: OutfitDraft = { slots: {}, accessories: [], toggles: { tuckIn: false, intoBoots: false } };
const STEP = 0.025; // nudge, in reference lengths
const SCALE_STEP = 1.03;
const TURN_STEP = 2; // degrees

const clone = (f: FitAdjustment): FitAdjustment => ({ ...f, points: f.points ? Object.fromEntries(Object.entries(f.points).map(([k, v]) => [k, { ...v }])) : undefined });
/** Stores the correction on the item (only that field, so nothing else is overwritten). */
const storeFit = (id: string, fit: FitAdjustment) => db.items.update(id, { fit: isNeutralFit(fit) ? undefined : fit, updatedAt: Date.now() });

export default function AdjustFit({ itemId }: { itemId?: string }) {
  const { t } = useI18n();
  // undefined while loading, null when there's no such item (bug-audit #25).
  const item = useLiveQuery(async () => (itemId ? (await db.items.get(itemId)) ?? null : null), [itemId]);
  const settings = useSettings();
  const vp = useViewport();
  const [mode, setMode] = useState<Mode>('points');
  const [fit, setFitState] = useState<FitAdjustment>();
  const [layout, setLayout] = useState<StageLayout>();
  const [sel, setSel] = useState<string>();
  const [stageH, setStageH] = useState(0);
  const touched = useRef(false);
  const setFit = (f: FitAdjustment) => { touched.current = true; setFitState(f); };

  useEffect(() => { if (item && !fit) setFitState(clone(item.fit ?? NEUTRAL_FIT)); }, [item, fit]);

  // Back and the edge swipe keep the drags, as the note says (bug-audit #21): what's changed is saved on the way out.
  const latest = useRef<{ item?: Item | null; fit?: FitAdjustment }>({});
  latest.current = { item, fit };
  useEffect(() => () => {
    const { item: it, fit: f } = latest.current;
    if (touched.current && it && f) void attempt('fit.saveOnLeave', () => storeFit(it.id, f), t('state.saveFailed'));
  }, []);

  // The outfit on the mannequin, with this garment on it.
  const draft = useMemo(() => {
    const d = settings?.draft ?? EMPTY_DRAFT;
    return item ? putOn(d, item) : d;
  }, [settings?.draft, item]);
  const override = useMemo(() => (itemId ? { itemId, fit } : undefined), [itemId, fit]);

  const ro = useRef<ResizeObserver | null>(null);
  const stageRef = useCallback((el: HTMLDivElement | null) => {
    ro.current?.disconnect();
    if (!el) return;
    ro.current = new ResizeObserver(() => setStageH(el.clientHeight));
    ro.current.observe(el);
    setStageH(el.clientHeight);
  }, []);
  // No floor: on an iPhone SE a 280 px floor put the hem handles under the panel (bug-audit #27).
  const mh = Math.round(Math.max(160, Math.min(stageH - 16, 2 * (vp.w - 128), 560)));
  const mLeft = Math.round((vp.w - mh / 2) / 2);
  const scale = mh / 2000;

  const placement = itemId ? layout?.scene.placements[itemId] : undefined;
  const handles = placement?.handles ?? [];
  const selected = handles.find((h) => h.name === sel) ?? handles.find((h) => h.kind === 'point');
  const group = item ? CATEGORY[item.category].group : 'top';
  const hint: Key = mode === 'whole' ? 'dressup.fit.hint.whole'
    : group === 'top' ? 'dressup.fit.hint.top' : group === 'bottom' || group === 'skirt' ? 'dressup.fit.hint.bottom'
      : group === 'shoes' || group === 'gloves' ? 'dressup.fit.hint.pair' : 'dressup.fit.hint.other';
  const handleName = (h?: Handle) => (h ? t(`dressup.fit.h.${h.name}` as Key) : '');

  // ----- Changing the fit.
  const movePoint = (h: Handle, to: { x: number; y: number }) => {
    if (!placement || !fit) return;
    const o = offsetForHandle(placement, h.name, to);
    setFit({ ...fit, points: { ...(fit.points ?? {}), [h.name]: o } });
  };
  const moveWhole = (dxCanon: number, dyCanon: number) => {
    if (!placement || !fit) return;
    setFit({ ...fit, dx: fit.dx + dxCanon / placement.ref, dy: fit.dy + dyCanon / placement.ref });
  };
  const nudge = (dx: number, dy: number) => {
    if (!placement || !fit) return;
    if (mode === 'whole' || selected?.kind === 'move' || !selected) { setFit({ ...fit, dx: fit.dx + dx * STEP, dy: fit.dy + dy * STEP }); return; }
    movePoint(selected, { x: selected.at.x + dx * STEP * placement.ref, y: selected.at.y + dy * STEP * placement.ref });
  };
  const rescale = (k: number) => fit && setFit({ ...fit, scale: Math.max(0.4, Math.min(2.5, fit.scale * k)) });
  const turn = (deg: number) => fit && setFit({ ...fit, rotate: Math.max(-60, Math.min(60, fit.rotate + deg)) });

  // ----- Pointer drags on the overlay (canonical coordinates from the stage box).
  const box = useRef<HTMLDivElement>(null);
  const drag = useRef<{ kind: 'point' | 'move' | 'whole'; handle?: Handle; last: { x: number; y: number } } | null>(null);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const pinch = useRef<{ d: number; a: number; fit: FitAdjustment } | null>(null);
  const toCanon = (e: RPointerEvent) => {
    const r = box.current!.getBoundingClientRect();
    return { x: (e.clientX - r.left) / scale, y: (e.clientY - r.top) / scale };
  };
  const onDown = (e: RPointerEvent, h?: Handle) => {
    if (!placement) return;
    e.preventDefault();
    (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 2 && mode === 'whole' && fit) {
      const [p, q] = [...pointers.current.values()];
      pinch.current = { d: Math.hypot(q.x - p.x, q.y - p.y), a: Math.atan2(q.y - p.y, q.x - p.x), fit: clone(fit) };
      drag.current = null;
      return;
    }
    if (h) setSel(h.name);
    drag.current = { kind: mode === 'whole' ? 'whole' : h?.kind === 'point' ? 'point' : 'move', handle: h, last: toCanon(e) };
  };
  const onMove = (e: RPointerEvent) => {
    if (pointers.current.has(e.pointerId)) pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pinch.current && pointers.current.size >= 2) {
      const [p, q] = [...pointers.current.values()];
      const d = Math.hypot(q.x - p.x, q.y - p.y);
      const a = Math.atan2(q.y - p.y, q.x - p.x);
      const base = pinch.current.fit;
      setFit({ ...base, scale: Math.max(0.4, Math.min(2.5, base.scale * (d / Math.max(1, pinch.current.d)))), rotate: Math.max(-60, Math.min(60, base.rotate + ((a - pinch.current.a) * 180) / Math.PI)) });
      return;
    }
    const g = drag.current;
    if (!g) return;
    const at = toCanon(e);
    if (g.kind === 'point' && g.handle) movePoint(g.handle, at);
    else moveWhole(at.x - g.last.x, at.y - g.last.y);
    g.last = at;
  };
  const onUp = (e: RPointerEvent) => {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size < 2) pinch.current = null;
    if (pointers.current.size === 0) drag.current = null;
  };

  const done = useAction('fit.done', async () => {
    if (!item || !fit) return;
    await storeFit(item.id, fit);
    touched.current = false;
    goBack('/dressup');
  }, { errorText: t('state.saveFailed'), retryLabel: t('action.retry') });

  if (!itemId) return null;
  if (item === null) {
    return (
      <div className="screen screen--no-tabs">
        <Header back="/dressup" backLabel={t('tab.dressup')} />
        <Empty icon="search" action={<button type="button" className="btn btn--secondary btn--sm" onClick={() => goBack('/dressup')}>{t('action.back')}</button>}>
          {t('dressup.fit.notFound')}
        </Empty>
      </div>
    );
  }
  const what = item ? t(`cat.${item.category}`).toLowerCase() : '';
  const bbox = placement && layout ? bounds(handles) : undefined;
  // The label sits outside the handle, away from the body's middle so it never covers the head.
  const roomLeft = selected ? mLeft + selected.at.x * scale - 14 > 130 : false;
  const roomRight = selected ? mLeft + selected.at.x * scale + 14 + 130 < vp.w : false;
  const goLeft = selected ? (selected.at.x < 500 ? roomLeft || !roomRight : !roomRight && roomLeft) : false;
  const labelAt = selected && mode === 'points'
    ? { x: selected.at.x * scale + (goLeft ? -14 : 14), y: selected.at.y * scale - 36, left: goLeft }
    : undefined;

  return (
    <div className="af">
      <div className="af__top">
        <Header back="/dressup" backLabel={t('tab.dressup')} />
        <Segmented<Mode> value={mode} onChange={setMode} label={t('dressup.fit.what')} onPaper
          options={[{ value: 'points', label: t('dressup.fit.points') }, { value: 'whole', label: t('dressup.fit.whole') }]} />
      </div>
      <div className="af__title">
        <h1 className="h1">{t('dressup.fit.title')}</h1>
        {item && <span className="af__name">{item.name}</span>}
      </div>

      <div className="af__stage" ref={stageRef}>
        {stageH > 0 && fit && (
          <>
            <div className="af__mannequin" style={{ left: mLeft }} ref={box}>
              <MannequinStage draft={draft} height={mh} selectedItemId={itemId} fitOverride={override} onLayout={setLayout}>
                <svg className="af__overlay" width={mh / 2} height={mh}
                  onPointerDown={mode === 'whole' ? (e) => onDown(e) : undefined}
                  onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}
                  role="img" aria-label={t('dressup.fit.title')}>
                  {mode === 'whole' && bbox && (
                    <rect x={bbox.x0 * scale - 24} y={bbox.y0 * scale - 24} width={(bbox.x1 - bbox.x0) * scale + 48} height={(bbox.y1 - bbox.y0) * scale + 48} fill="transparent" style={{ cursor: 'move' }} />
                  )}
                  {mode === 'points' && handles.map((h) => {
                    const on = selected?.name === h.name;
                    const cx = h.at.x * scale;
                    const cy = h.at.y * scale;
                    return (
                      <g key={h.name} className="af-handle" onPointerDown={(e) => onDown(e, h)} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}>
                        <circle cx={cx} cy={cy} r={22} fill="transparent" />
                        {on ? (
                          <>
                            <circle cx={cx} cy={cy} r={7.5} fill="#141414" stroke="#fff" strokeWidth={1.5} />
                            <path d={`M${cx} ${cy - 4}V${cy + 4}M${cx - 4} ${cy}H${cx + 4}`} stroke="#fff" strokeWidth={1.4} />
                          </>
                        ) : (
                          <>
                            <circle cx={cx} cy={cy} r={h.name === 'hemC' ? 6.5 : 5.5} fill="#fff" stroke="#141414" strokeWidth={1.6} />
                            {h.name === 'hemC' && <path d={`M${cx - 2.6} ${cy - 1}l2.6 2 2.6-2`} fill="none" stroke="#141414" strokeWidth={1.2} />}
                            {h.kind === 'move' && <circle cx={cx} cy={cy} r={1.8} fill="#141414" />}
                          </>
                        )}
                      </g>
                    );
                  })}
                </svg>
                {labelAt && <span className="af-label" style={{ left: labelAt.x, top: labelAt.y, translate: labelAt.left ? '-100% 0' : undefined }}>{handleName(selected)}</span>}
              </MannequinStage>
            </div>
            <div className="af__pad" style={{ left: 12, top: '50%', transform: 'translateY(-50%)' }} role="group" aria-label={selected && mode === 'points' ? t('dressup.fit.selected', { name: handleName(selected) }) : t('dressup.fit.whole')}>
              <PadButton label={t('dressup.fit.up')} onClick={() => nudge(0, -1)}><Icon name="down" size={20} style={{ transform: 'rotate(180deg)' }} /></PadButton>
              <PadButton label={t('dressup.fit.left')} onClick={() => nudge(-1, 0)}><Icon name="back" size={20} /></PadButton>
              <PadButton label={t('dressup.fit.right')} onClick={() => nudge(1, 0)}><Icon name="chevron" size={20} /></PadButton>
              <PadButton label={t('dressup.fit.down')} onClick={() => nudge(0, 1)}><Icon name="down" size={20} /></PadButton>
            </div>
            {mode === 'whole' && (
              <div className="af__pad" style={{ right: 12, top: '50%', transform: 'translateY(-50%)' }} role="group" aria-label={t('dressup.fit.whole')}>
                <PadButton label={t('dressup.fit.bigger')} onClick={() => rescale(SCALE_STEP)}><Icon name="plus" size={20} /></PadButton>
                <PadButton label={t('dressup.fit.smaller')} onClick={() => rescale(1 / SCALE_STEP)}>
                  <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true"><path d="M5 12h14" /></svg>
                </PadButton>
                <PadButton label={t('dressup.fit.rotL')} onClick={() => turn(-TURN_STEP)}><Icon name="rotate" size={20} style={{ transform: 'scaleX(-1)' }} /></PadButton>
                <PadButton label={t('dressup.fit.rotR')} onClick={() => turn(TURN_STEP)}><Icon name="rotate" size={20} /></PadButton>
              </div>
            )}
          </>
        )}
        {item && !item.tryOnPhotoId && <p className="pad meta">{t('dressup.fit.missing')}</p>}
      </div>

      <section className="af__panel paper-edge" aria-label={t('dressup.fit.title')}>
        <p className="af__hint">{t(hint)}</p>
        <p className="af__note">
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="#141414" strokeWidth="1.8" strokeLinejoin="round" aria-hidden="true"><path d="M6 4h12v17l-6-4-6 4Z" /></svg>
          {t('dressup.fit.note', { what })}
        </p>
        <div className="af__buttons">
          <button type="button" className="btn btn--secondary" onClick={() => setFit(clone(NEUTRAL_FIT))} disabled={!fit || isNeutralFit(fit)}>
            <Icon name="undo" size={18} />{t('dressup.fit.reset')}
          </button>
          <button type="button" className="btn btn--primary" disabled={done.busy} onClick={() => void done.run()}>{t('action.done')}</button>
        </div>
      </section>
    </div>
  );
}

function PadButton({ label, onClick, children }: { label: string; onClick: () => void; children: React.ReactNode }) {
  return <button type="button" className="icon-btn" aria-label={label} onClick={onClick}>{children}</button>;
}

function bounds(hs: Handle[]) {
  if (!hs.length) return undefined;
  const xs = hs.map((h) => h.at.x);
  const ys = hs.map((h) => h.at.y);
  return { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) };
}
