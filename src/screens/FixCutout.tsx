// Fix the cut-out (F4, D19): compare other background-removal models side by side, or brush by hand.
import { useEffect, useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import '../styles/wardrobe.css';
import { goBack, navigate, useRoute } from '../app/router';
import * as ai from '../ai';
import type { CutoutResult, ModelInfo } from '../ai';
import { db, getSettings, updateSettings } from '../data/db';
import { deleteItem } from '../data/repo';
import { useI18n } from '../i18n';
import { useAction } from '../ui/action';
import { CutoutImg, Empty, PenCircle } from '../ui/parts';
import { Icon } from '../ui/icons';
import { BrushEditor, type BrushApi, type BrushTool } from '../wardrobe/BrushEditor';
import { makeThumb } from '../wardrobe/images';
import { saveCutout, setCutoutApproved } from '../wardrobe/ops';
import { ConfirmSheet, XIcon } from '../wardrobe/parts';
import { clearDraft } from '../wardrobe/session';

interface Candidate {
  id: string;
  label: string;
  /** idle = the model isn't on the phone yet; it runs (and downloads) only when tapped. */
  state: 'current' | 'idle' | 'waiting' | 'running' | 'done' | 'failed';
  sizeMb?: number;
  result?: CutoutResult;
}

/** Whether a model is already on the phone (an extra the AI module exports; assume yes if it's missing). */
async function onPhone(m: ModelInfo): Promise<boolean> {
  if (!m.sizeMb) return true;
  const check = (ai as { isDownloaded?: (id: string) => Promise<boolean> }).isDownloaded;
  return check ? check(m.id).catch(() => false) : true;
}

/** Goes back one screen, then runs `then` once the previous screen is current (a sheet's own entry is skipped). */
function stepBackThen(then: () => void) {
  const from = location.hash;
  const on = () => {
    if (location.hash === from) return;
    window.removeEventListener('popstate', on);
    then();
  };
  window.addEventListener('popstate', on);
  history.back();
}

export default function FixCutout({ itemId }: { itemId?: string }) {
  const { t, lang } = useI18n();
  const route = useRoute();
  // null = not in the database (a deleted item, an old link), undefined = still loading (bug-audit #25).
  const item = useLiveQuery(async () => (itemId ? (await db.items.get(itemId)) ?? null : null), [itemId]);
  const photo = useLiveQuery(async () => (item?.tryOnPhotoId ? (await db.photos.get(item.tryOnPhotoId)) ?? null : item === undefined ? undefined : null), [item?.tryOnPhotoId, item === undefined]);
  const [view, setView] = useState<'models' | 'brush'>('models');
  const [cands, setCands] = useState<Candidate[]>([]);
  const [picked, setPicked] = useState('current');
  const [tool, setTool] = useState<BrushTool>('erase');
  const [size, setSize] = useState(24);
  const [hist, setHist] = useState({ canUndo: false, canRedo: false });
  const [zoom, setZoom] = useState(1);
  const [confirmRetake, setConfirmRetake] = useState(false);
  const brush = useRef<BrushApi>(null);
  const photoRef = useRef(photo);
  photoRef.current = photo;
  const tRef = useRef(t);
  tRef.current = t;
  // Models run one after another (one model in memory at a time, architecture §3).
  const chain = useRef<Promise<void>>(Promise.resolve());
  const alive = useRef(0);

  const runModel = (id: string) => {
    const gen = alive.current;
    setCands((cs) => cs.map((c) => (c.id === id ? { ...c, state: 'waiting' } : c)));
    chain.current = chain.current.then(async () => {
      const p = photoRef.current;
      if (gen !== alive.current || !p) return;
      setCands((cs) => cs.map((c) => (c.id === id ? { ...c, state: 'running' } : c)));
      try {
        const result = await ai.cutOutGarment(p.original, { model: id });
        if (gen === alive.current) setCands((cs) => cs.map((c) => (c.id === id ? { ...c, state: 'done', result } : c)));
      } catch {
        if (gen === alive.current) setCands((cs) => cs.map((c) => (c.id === id ? { ...c, state: 'failed' } : c)));
      }
    });
  };

  // Every other cut-out model runs on the original photo; models not yet on the phone wait for a tap.
  const photoId = photo?.id;
  useEffect(() => {
    const photo = photoRef.current;
    if (!photo) return;
    const gen = ++alive.current;
    const models = ai.MODELS.filter((m) => m.task === 'cutout' && m.id !== photo.cutoutModel);
    setCands([
      { id: 'current', label: ai.MODELS.find((m) => m.id === photo.cutoutModel)?.label ?? tRef.current('wardrobe.fix.current'), state: 'current' },
      ...models.map((m) => ({ id: m.id, label: m.label, sizeMb: m.sizeMb, state: 'idle' as const })),
    ]);
    void (async () => {
      for (const m of models) {
        if (gen !== alive.current) return;
        if (await onPhone(m)) runModel(m.id);
      }
    })();
    return () => { alive.current++; };
    // runModel only reads refs and state setters.
  }, [photoId]);

  // The brush edits a snapshot: blobs re-read from the database are new objects and would reset the canvas.
  const [brushSrc, setBrushSrc] = useState<{ key: string; cutout: Blob; original?: Blob }>();
  const brushKey = `${photoId}:${picked}`;
  useEffect(() => {
    if (view !== 'brush' || brushSrc?.key === brushKey) return;
    const p = photoRef.current;
    const cut = picked === 'current' ? p?.cutout : cands.find((c) => c.id === picked)?.result?.cutout;
    if (p && cut) setBrushSrc({ key: brushKey, cutout: cut, original: p.original });
  }, [view, brushKey, picked, cands, brushSrc?.key]);

  const use = useAction('fix.use', async () => {
    if (!photo || !item) return;
    const current = cands.find((c) => c.id === picked);
    if (view === 'brush') {
      const out = await brush.current?.export();
      if (out) await saveCutout(photo.id, { cutout: out.blob, thumb: await makeThumb(out.blob), width: out.width, height: out.height, model: picked === 'current' ? photo.cutoutModel : picked });
    } else if (picked !== 'current' && current?.result) {
      const r = current.result;
      await saveCutout(photo.id, { cutout: r.cutout, thumb: await makeThumb(r.cutout), width: r.width, height: r.height, model: r.model });
      // The board promises the pick is remembered in Model lab: it becomes the cut-out model.
      const s = await getSettings();
      await updateSettings({ models: { ...s.models, cutout: r.model } });
    } else {
      await setCutoutApproved(photo.id, true);
    }
    goBack(`/item/${item.id}`);
  }, { errorText: t('state.saveFailed'), retryLabel: t('action.retry') });

  // A new photo of a saved item comes back through same-item detection (D43); a review photo is replaced.
  const retake = useAction('fix.retake', async () => {
    if (!item) return;
    if (item.status !== 'review') { navigate('/add', { replace: true }); return; }
    await deleteItem(item.id);
    clearDraft(item.id);
    // The item screen behind this one is gone: replace it, so Close in the camera returns to the inbox (bug-audit #21).
    if (route.query.get('from') === 'item') stepBackThen(() => navigate('/add', { replace: true }));
    else navigate('/add', { replace: true });
  }, { errorText: t('state.actionFailed'), retryLabel: t('action.retry') });

  if (!item || !photo) {
    return (
      <div className="screen screen--no-tabs wd">
        <div className="header"><button type="button" className="back" onClick={() => goBack('/wardrobe')}><Icon name="back" size={20} strokeWidth={2} />{t('action.back')}</button></div>
        {item === undefined || photo === undefined ? null : <Empty icon="wardrobe">{t('wardrobe.item.notFound')}</Empty>}
      </div>
    );
  }

  const current = cands.find((c) => c.id === picked);
  const pickedBlob = picked === 'current' ? photo.cutout : current?.result?.cutout;
  const bigLabel = current?.label ?? t('wardrobe.fix.current');
  const otherCount = cands.length - 1;
  const seconds = new Intl.NumberFormat(lang, { minimumFractionDigits: 1, maximumFractionDigits: 1 });

  return (
    <div className="screen screen--no-tabs wd wd-fix">
      <div className="header">
        <button type="button" className="back" onClick={() => goBack(`/item/${item.id}`)}><Icon name="back" size={20} strokeWidth={2} />{item.name}</button>
      </div>
      <div className="wd-fix__body">
        <h1 className="h1">{t('wardrobe.fix.title')}</h1>
        <div className="wd-tabs" role="group" aria-label={t('wardrobe.fix.how')}>
          <button type="button" aria-pressed={view === 'models'} onClick={() => setView('models')}>{t('wardrobe.fix.models')}</button>
          <button type="button" aria-pressed={view === 'brush'} onClick={() => setView('brush')}>{t('wardrobe.fix.brush')}</button>
        </div>

        {view === 'models' ? (
          <div className="stack gap-12">
            <div className="wd-preview checker">
              {pickedBlob ? <CutoutImg blob={pickedBlob} alt={item.name} style={{ width: '86%', height: 222 }} /> : <span className="spinner" />}
              <span className="wd-preview__label">{bigLabel}</span>
            </div>
            <div className="wd-models" role="group" aria-label={t('wardrobe.fix.chooseModel')}>
              {cands.map((c) => {
                const blob = c.id === 'current' ? photo.cutout : c.result?.cutout;
                const ready = c.state === 'current' || c.state === 'done';
                const note = c.state === 'current' ? t('wardrobe.fix.inUse')
                  : c.state === 'done' ? t('wardrobe.fix.seconds', { s: seconds.format((c.result?.ms ?? 0) / 1000) })
                  : c.state === 'failed' ? t('wardrobe.fix.failed') : c.state === 'running' ? t('wardrobe.fix.running')
                  : c.state === 'idle' ? (c.sizeMb ? t('wardrobe.fix.download', { mb: c.sizeMb }) : t('wardrobe.fix.tapToRun')) : t('wardrobe.fix.waiting');
                return (
                  <button key={c.id} type="button" className="wd-model" aria-pressed={picked === c.id}
                    disabled={!ready && c.state !== 'idle' && c.state !== 'failed'}
                    onClick={() => (ready ? setPicked(c.id) : runModel(c.id))}>
                    <span className="wd-model__well checker">
                      {blob ? <CutoutImg blob={blob} alt="" style={{ width: '88%', height: 70 }} />
                        : c.state === 'failed' ? <Icon name="warning" size={22} />
                        : c.state === 'idle' ? <Icon name="download" size={22} /> : <span className="spinner" />}
                    </span>
                    {picked === c.id && <span className="wd-model__circle"><PenCircle /></span>}
                    <span className="wd-model__name">{c.label}</span>
                    <span className="wd-model__note">{note}</span>
                  </button>
                );
              })}
            </div>
            <p className="wd-note">{otherCount > 0 ? t('wardrobe.fix.modelsNote') : t('wardrobe.fix.noModels')}</p>
          </div>
        ) : (
          <div className="stack gap-12">
            <div className="wd-brushwrap">
              {brushSrc && (
                <BrushEditor ref={brush} cutout={brushSrc.cutout} original={brushSrc.original} tool={tool} size={size} label={t('wardrobe.fix.canvas')}
                  onHistory={setHist} onZoom={setZoom} />
              )}
              <span className="wd-preview__label wd-preview__label--right num">{Math.round(zoom * 100)}%</span>
              <span className="wd-zoombtns">
                <button type="button" className="icon-btn" aria-label={t('wardrobe.fix.zoomOut')} disabled={zoom <= 1} onClick={() => brush.current?.zoomBy(1 / 1.5)}><XIcon name="zoomOut" /></button>
                <button type="button" className="icon-btn" aria-label={t('wardrobe.fix.zoomIn')} disabled={zoom >= 8} onClick={() => brush.current?.zoomBy(1.5)}><XIcon name="zoomIn" /></button>
              </span>
            </div>
            <div className="row gap-8">
              <div className="wd-tabs wd-tabs--tools grow" role="group" aria-label={t('wardrobe.fix.tool')}>
                <button type="button" aria-pressed={tool === 'erase'} onClick={() => setTool('erase')}><XIcon name="erase" size={18} />{t('wardrobe.fix.erase')}</button>
                <button type="button" aria-pressed={tool === 'restore'} onClick={() => setTool('restore')}><XIcon name="restore" size={18} />{t('wardrobe.fix.restore')}</button>
              </div>
              <button type="button" className="icon-btn wd-round48" aria-label={t('wardrobe.fix.undo')} disabled={!hist.canUndo} onClick={() => brush.current?.undo()}><Icon name="undo" size={20} /></button>
              <button type="button" className="icon-btn wd-round48" aria-label={t('wardrobe.fix.redo')} disabled={!hist.canRedo} onClick={() => brush.current?.redo()}><Icon name="redo" size={20} /></button>
            </div>
            <label className="wd-range">
              <span>{t('wardrobe.fix.size')}</span>
              <input type="range" min={8} max={64} step={2} value={size} onChange={(e) => setSize(Number(e.target.value))} />
              <span className="wd-range__val num">{t('wardrobe.fix.px', { n: size })}</span>
            </label>
            <p className="wd-note row gap-8"><XIcon name="pinch" size={20} />{t('wardrobe.fix.pinch')}</p>
          </div>
        )}
      </div>

      <div className="wd-fix__actions">
        <button type="button" className="btn btn--secondary grow" disabled={retake.busy}
          onClick={() => (item.status === 'review' ? setConfirmRetake(true) : void retake.run())}>{t('wardrobe.fix.retake')}</button>
        <button type="button" className="btn btn--primary wd-grow12" disabled={use.busy || !pickedBlob} onClick={() => void use.run()}>{t('wardrobe.fix.use')}</button>
      </div>
      {confirmRetake && (
        <ConfirmSheet title={t('wardrobe.review.retakeTitle')} body={t('wardrobe.review.retakeBody')} confirm={t('wardrobe.review.retake')}
          onConfirm={() => void retake.run()} onClose={() => setConfirmRetake(false)} />
      )}
    </div>
  );
}
