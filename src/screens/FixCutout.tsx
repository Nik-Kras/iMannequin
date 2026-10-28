// Fix the cut-out (F4, D19): compare other background-removal models side by side, or brush by hand.
import { useEffect, useRef, useState } from 'react';
import '../styles/wardrobe.css';
import { goBack, navigate } from '../app/router';
import * as ai from '../ai';
import type { CutoutResult, ModelInfo } from '../ai';
import { getSettings, updateSettings } from '../data/db';
import { deleteItem, useItem, usePhoto } from '../data/repo';
import { useI18n } from '../i18n';
import { CutoutImg, Empty, PenCircle } from '../ui/parts';
import { Icon } from '../ui/icons';
import { BrushEditor, type BrushApi, type BrushTool } from '../wardrobe/BrushEditor';
import { makeThumb } from '../wardrobe/images';
import { saveCutout, setCutoutApproved } from '../wardrobe/ops';
import { XIcon } from '../wardrobe/parts';

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

export default function FixCutout({ itemId }: { itemId?: string }) {
  const { t } = useI18n();
  const item = useItem(itemId);
  const photo = usePhoto(item?.tryOnPhotoId);
  const [view, setView] = useState<'models' | 'brush'>('models');
  const [cands, setCands] = useState<Candidate[]>([]);
  const [picked, setPicked] = useState('current');
  const [tool, setTool] = useState<BrushTool>('erase');
  const [size, setSize] = useState(24);
  const [hist, setHist] = useState({ canUndo: false, canRedo: false });
  const [zoom, setZoom] = useState(1);
  const [busy, setBusy] = useState(false);
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

  if (!item || !photo) {
    return (
      <div className="screen screen--no-tabs wd">
        <div className="header"><button type="button" className="back" onClick={() => goBack('/wardrobe')}><Icon name="back" size={20} strokeWidth={2} />{t('action.back')}</button></div>
        {item === undefined ? null : <Empty icon="wardrobe">{t('wardrobe.item.notFound')}</Empty>}
      </div>
    );
  }

  const current = cands.find((c) => c.id === picked);
  const pickedBlob = picked === 'current' ? photo.cutout : current?.result?.cutout;
  const bigLabel = current?.label ?? t('wardrobe.fix.current');
  const otherCount = cands.length - 1;

  async function use() {
    if (!photo || !item) return;
    setBusy(true);
    try {
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
    } finally {
      setBusy(false);
    }
    goBack(`/item/${item.id}`);
  }

  async function retake() {
    if (!item) return;
    // A new photo of a saved item comes back through same-item detection (D43); a review photo is replaced.
    if (item.status === 'review') await deleteItem(item.id);
    navigate('/add', { replace: true });
  }

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
                  : c.state === 'done' ? t('wardrobe.fix.seconds', { s: ((c.result?.ms ?? 0) / 1000).toFixed(1) })
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
        <button type="button" className="btn btn--secondary grow" onClick={retake}>{t('wardrobe.fix.retake')}</button>
        <button type="button" className="btn btn--primary wd-grow12" disabled={busy || !pickedBlob} onClick={use}>{t('wardrobe.fix.use')}</button>
      </div>
    </div>
  );
}
