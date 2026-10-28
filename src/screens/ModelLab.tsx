// Model lab (architecture §5, D12; board ModelLab.dc.html): the candidates per task with licence, size and
// download state; choose one, delete a download, calibrate on the wardrobe's photos, export the timings.
import '../styles/ai.css';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useI18n, type Key } from '../i18n';
import { db, updateSettings } from '../data/db';
import { useSettings } from '../data/repo';
import { Header, Stamp, CutoutImg } from '../ui/parts';
import type { AiTask, CalibrationRun } from '../domain/types';
import {
  chosenModel, deleteDownload, downloadModel, downloadSize, effectiveModel, isDownloaded, MODEL_SPECS, resetFailures, unusableHere, type ModelSpec,
} from '../ai';
import { calibrate, calibrationPhotos, exportCalibration, SEARCH_TESTS, type CalibrationOutcome, type CalibrationStep } from '../ai/calibrate';
import { AiIcon, useSize } from '../ai/ui';
import { useAction } from '../ui/action';
import { reportError } from '../diag/diagnostics';

const TASKS: AiTask[] = ['cutout', 'classify', 'search', 'describe', 'pose'];

interface ModelState { downloaded: boolean; bytes: number; unusable: 'device' | 'failed' | null }

export default function ModelLab() {
  const { t, date } = useI18n();
  const size = useSize();
  const settings = useSettings();
  const runs = useLiveQuery(() => db.calibration.orderBy('createdAt').toArray(), []);
  const [states, setStates] = useState<Record<string, ModelState>>({});
  const [busy, setBusy] = useState<Record<string, number | 'deleting'>>({});
  const [step, setStep] = useState<CalibrationStep | null>(null);
  const [outcome, setOutcome] = useState<CalibrationOutcome | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const stopper = useRef<AbortController | null>(null);

  const [effective, setEffective] = useState<Partial<Record<AiTask, string>>>({});
  const refresh = useCallback(async () => {
    try {
      const next: Record<string, ModelState> = {};
      for (const s of MODEL_SPECS) {
        next[s.id] = { downloaded: await isDownloaded(s.id), bytes: await downloadSize(s.id), unusable: await unusableHere(s) };
      }
      setStates(next);
    } catch (err) {
      reportError(err, 'lab.refresh');
    }
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);
  const choice = JSON.stringify(settings?.models ?? {});
  useEffect(() => {
    if (!settings) return;
    void (async () => {
      const e: Partial<Record<AiTask, string>> = {};
      for (const task of TASKS) e[task] = (await effectiveModel(settings, task)).id;
      setEffective(e);
    })().catch((err) => reportError(err, 'lab.effective'));
  }, [choice, states, !!settings]);
  useEffect(() => () => stopper.current?.abort(), []);

  const latest = latestByModel(runs ?? []);
  const lastBatch = lastRun(runs ?? []);

  // Every handler reports a failure instead of leaving a silent rejection (bug-audit #3).
  const failed = { errorText: t('state.actionFailed'), retryLabel: t('action.retry') };
  const choose = useAction('lab.use', async (s: ModelSpec) => {
    await updateSettings({ models: { ...(settings?.models ?? {}), [s.task]: s.id } });
    return true;
  }, { errorText: t('state.saveFailed'), retryLabel: t('action.retry') });
  const removeAction = useAction('lab.delete', (s: ModelSpec) => remove(s), failed);
  const resetAction = useAction('lab.reset', () => reset(), { errorText: t('state.saveFailed'), retryLabel: t('action.retry') });
  const exportAction = useAction('lab.export', () => exportResults(), failed);

  async function use(s: ModelSpec) {
    if (!(await choose.run(s))) return;
    if (s.runtime === 'transformers' && !states[s.id]?.downloaded) await download(s);
  }

  async function download(s: ModelSpec) {
    setBusy((b) => ({ ...b, [s.id]: 0 }));
    try {
      await downloadModel(s.id, (d, tot) => setBusy((b) => ({ ...b, [s.id]: d / Math.max(1, tot) })));
    } catch (err) {
      reportError(err, 'lab.download');
      setMessage(t('ai.dl.failed'));
    } finally {
      setBusy(({ [s.id]: _, ...rest }) => rest);
      await refresh();
    }
  }

  async function remove(s: ModelSpec) {
    setBusy((b) => ({ ...b, [s.id]: 'deleting' }));
    try {
      await deleteDownload(s.id);
    } finally {
      setBusy(({ [s.id]: _, ...rest }) => rest);
      await refresh();
    }
  }

  async function runCalibration() {
    setMessage(null);
    const ctl = new AbortController();
    stopper.current = ctl;
    setOutcome(null);
    try {
      if (!(await calibrationPhotos()).length) { setMessage(t('ai.lab.noPhotos')); return; }
      setOutcome(await calibrate(setStep, ctl.signal));
    } catch (err) {
      // Stopped, or a model crashed: the rows saved so far stay.
      if (!ctl.signal.aborted) reportError(err, 'lab.calibrate');
    } finally {
      setStep(null);
      stopper.current = null;
      await refresh();
    }
  }

  async function exportResults() {
    const blob = await exportCalibration();
    const name = `imannequin-model-lab-${new Date().toISOString().slice(0, 10)}.json`;
    const file = new File([blob], name, { type: 'application/json' });
    const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
    if (nav.canShare?.({ files: [file] })) {
      try { await nav.share({ files: [file] }); return; } catch { /* cancelled: fall back to a download */ }
    }
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }

  async function reset() {
    resetFailures();
    await updateSettings({ models: {} });
    await refresh();
  }

  const resultLine = (s: ModelSpec): { text: string; idle: boolean } => {
    const st = states[s.id];
    if (st?.unusable === 'device') return { text: t('ai.lab.needsGpu'), idle: true };
    if (st?.unusable === 'failed') return { text: t('ai.lab.failedHere'), idle: false };
    const r = latest.get(s.id);
    if (!r) return { text: t('ai.lab.notTried'), idle: true };
    const sec = (r.msPerPhoto / 1000).toLocaleString(undefined, { maximumFractionDigits: r.msPerPhoto < 10_000 ? 1 : 0 });
    const right = (rate?: number) => Math.round(r.photos * (1 - (rate ?? 0)));
    switch (r.task) {
      case 'cutout': return { text: s.runtime === 'code' ? t('ai.lab.res.cutoutPlain', { n: r.photos, clean: right(r.editedRate), sec }) : t('ai.lab.res.cutoutModel', { n: r.photos, sec }), idle: false };
      case 'classify': return { text: t('ai.lab.res.classify', { n: r.photos, right: right(r.editedRate), sec }), idle: false };
      case 'search': return { text: t('ai.lab.res.search', { n: r.photos, uk: SEARCH_TESTS.slice(0, r.photos).filter((x) => x.uk).length, ok: right(r.editedRate), sec }), idle: false };
      default: return { text: t('ai.lab.res.describe', { n: r.photos, sec }), idle: false };
    }
  };

  const meta = (s: ModelSpec) => {
    if (s.runtime === 'code') return `${s.licence} · ${t('ai.lab.builtIn')}`;
    const bytes = s.runtime === 'mediapipe' ? (s.sizeMb ?? 0) * 1024 * 1024 : states[s.id]?.bytes;
    return bytes ? `${s.licence} · ${size(bytes)}` : s.licence;
  };

  /** Where the model's files are: built in, with the app, on this phone or not downloaded yet. */
  const where = (s: ModelSpec) => {
    if (s.runtime === 'code') return null;
    if (s.runtime === 'mediapipe') return t('ai.lab.withApp');
    const st = states[s.id];
    if (!st) return null;
    return st.downloaded ? t('ai.lab.onPhone') : t('ai.lab.notDownloaded');
  };

  const running = !!step;
  const pct = step ? (step.done + 0.5) / Math.max(1, step.total) : 0;

  return (
    <div className="screen screen--no-tabs ai-lab">
      <Header back="/settings" backLabel={t('ai.lab.back')} />
      <div className="ai-lab__intro">
        <h1 className="h1">{t('ai.lab.title')}</h1>
        <p>{t('ai.lab.lead')}</p>
      </div>

      <section className="ai-lab__hero" aria-label={t('ai.lab.calibrate')}>
        <p>{t('ai.lab.calibrateText')}</p>
        {running ? (
          <div className="ai-lab__run" aria-live="polite">
            <div className="ai-lab__runline">
              <span>{t('ai.lab.trying', { model: step.label })}</span>
              <button type="button" className="text-action" onClick={() => stopper.current?.abort()}>{t('ai.lab.stop')}</button>
            </div>
            <div className="ai-bar" role="progressbar" aria-label={step.label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(pct * 100)}>
              <span style={{ width: `${pct * 100}%` }} />
            </div>
          </div>
        ) : (
          <button type="button" className="ai-lab__calibrate" onClick={() => void runCalibration()}>
            <AiIcon name="camera" size={20} />{t('ai.lab.calibrate')}
          </button>
        )}
        <span className="meta">
          {lastBatch
            ? lastBatch.min >= 1 ? t('ai.lab.lastRun', { date: date(lastBatch.at), min: Math.round(lastBatch.min) }) : t('ai.lab.lastRunShort', { date: date(lastBatch.at) })
            : t('ai.lab.never')}
        </span>
      </section>
      {message && <p className="ai-error" role="alert">{message}</p>}

      {TASKS.map((task) => (
        <section key={task} className="card ai-task" aria-labelledby={`ai-task-${task}`}>
          <h2 id={`ai-task-${task}`}>{t(`ai.task.${task}` as Key)}</h2>
          <p className="meta ai-task__what">{t(`ai.task.${task}.what` as Key)}</p>
          <ul>
            {MODEL_SPECS.filter((s) => s.task === task).map((s) => {
              const inUse = (effective[task] ?? chosenModel(settings, task).id) === s.id;
              const st = states[s.id];
              const b = busy[s.id];
              const res = resultLine(s);
              const thumbs = outcome?.cutouts[s.id];
              const note = outcome?.descriptions[s.id]?.[0];
              return (
                <li key={s.id} className="ai-model">
                  <div className="ai-model__main">
                    <div className="ai-model__text">
                      <span className="ai-model__name">{s.label}<span className="meta">{meta(s)}</span></span>
                      <span className={`ai-model__result${res.idle ? ' ai-model__result--idle' : ''}`}>{res.text}</span>
                    </div>
                    {inUse
                      ? <Stamp>{t('ai.lab.inUse')}</Stamp>
                      : (
                        <button type="button" className="ai-model__use" disabled={b !== undefined || running || st?.unusable === 'device'}
                          aria-label={t('ai.lab.useLabel', { model: s.label, task: t(`ai.task.${task}` as Key) })} onClick={() => void use(s)}>
                          {t('ai.lab.use')}
                        </button>
                      )}
                  </div>
                  {typeof b === 'number' && (
                    <div className="ai-minibar" role="progressbar" aria-label={t('ai.lab.downloading', { model: s.label })} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(b * 100)}>
                      <span style={{ width: `${b * 100}%` }} />
                    </div>
                  )}
                  {thumbs && thumbs.length > 0 && (
                    <div className="ai-model__thumbs" aria-label={t('ai.lab.results')}>
                      {thumbs.map((blob, i) => (
                        <span key={i} className="ai-model__thumb"><CutoutImg blob={blob} alt={t('ai.lab.resultAlt', { model: s.label })} size={44} /></span>
                      ))}
                    </div>
                  )}
                  {note && <p className="ai-model__note">“{note}”</p>}
                  {where(s) && b === undefined && (
                    <div className="ai-model__extra">
                      <span className="meta">{where(s)}</span>
                      {s.runtime === 'transformers' && st?.downloaded && !running && (
                        <button type="button" className="text-action" aria-label={t('ai.lab.deleteLabel', { model: s.label })} onClick={() => void removeAction.run(s)}>
                          <AiIcon name="trash" size={16} />{t('ai.lab.delete')}
                        </button>
                      )}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      ))}

      <div className="ai-lab__foot">
        <span className="meta">{t('ai.lab.footer')}</span>
        <button type="button" className="text-action" onClick={() => void resetAction.run()} disabled={running}>{t('ai.lab.reset')}</button>
      </div>
      <div className="ai-lab__export">
        <button type="button" className="btn btn--secondary btn--block btn--sm" onClick={() => void exportAction.run()} disabled={!runs?.length}>
          <AiIcon name="share" size={18} />{t('ai.lab.export')}
        </button>
        <span className="meta">{t('ai.lab.exportNote')}</span>
      </div>
    </div>
  );
}

function latestByModel(runs: CalibrationRun[]): Map<string, CalibrationRun> {
  const m = new Map<string, CalibrationRun>();
  for (const r of runs) if (!m.has(r.modelId) || m.get(r.modelId)!.createdAt <= r.createdAt) m.set(r.modelId, r);
  return m;
}

/** The latest calibration (rows share a createdAt) and roughly how long it took. */
function lastRun(runs: CalibrationRun[]): { at: number; min: number } | null {
  if (!runs.length) return null;
  const at = Math.max(...runs.map((r) => r.createdAt));
  const ms = runs.filter((r) => r.createdAt === at).reduce((a, r) => a + r.msPerPhoto * r.photos, 0);
  return { at, min: ms / 60_000 };
}
