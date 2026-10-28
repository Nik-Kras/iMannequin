// F1 step 2: download the default AI models (board ModelDownload.dc.html). Route #/models; onboarding
// passes ?onboarding=1 and continues to the body photo. The search model is not fetched here (D32).
import '../styles/ai.css';
import { useEffect, useRef, useState } from 'react';
import { useI18n } from '../i18n';
import { navigate, goBack, useRoute } from '../app/router';
import { useSettings } from '../data/repo';
import { updateSettings } from '../data/db';
import { Icon } from '../ui/icons';
import { Stamp } from '../ui/parts';
import { chosenModel, downloadModel, downloadSize, effectiveModel, remainingBytes, type ModelSpec } from '../ai';
import { reportError } from '../diag/diagnostics';
import { AiIcon, useSize } from '../ai/ui';

type RowState = { done: number; total: number; ready: boolean };
type Phase = 'checking' | 'idle' | 'downloading' | 'paused' | 'error' | 'done';

export default function ModelDownload() {
  const { t } = useI18n();
  const route = useRoute();
  const onboarding = route.query.has('onboarding');
  const settings = useSettings();
  const size = useSize();
  const [phase, setPhase] = useState<Phase>('checking');
  const [rows, setRows] = useState<Record<string, RowState>>({});
  const [searchBytes, setSearchBytes] = useState(0);
  const abort = useRef<AbortController | null>(null);

  // The models this phone will really use (the chosen one, or the next candidate where it can't run).
  const [picked, setPicked] = useState<{ cutout: ModelSpec; classify: ModelSpec; search: ModelSpec } | null>(null);
  const cutout = picked?.cutout ?? chosenModel(settings, 'cutout');
  const classify = picked?.classify ?? chosenModel(settings, 'classify');
  const search = picked?.search ?? chosenModel(settings, 'search');
  const toFetch: ModelSpec[] = [cutout, classify];
  const choice = JSON.stringify(settings?.models ?? {});

  useEffect(() => {
    if (!settings) return;
    let live = true;
    void (async () => {
      try {
        const [c, k, q] = await Promise.all([effectiveModel(settings, 'cutout'), effectiveModel(settings, 'classify'), effectiveModel(settings, 'search')]);
        const toFetch = [c, k];
        const next: Record<string, RowState> = {};
        for (const m of toFetch) {
          // Files finished before a reload or a pause count as done (bug-audit #19).
          const { total, remaining } = await remainingBytes([m.id]);
          next[m.id] = { done: total - remaining, total, ready: remaining === 0 };
        }
        const sb = await downloadSize(q.id);
        if (!live) return;
        setPicked({ cutout: c, classify: k, search: q });
        setRows(next);
        setSearchBytes(sb);
        setPhase(Object.values(next).every((r) => r.ready) ? 'done' : 'idle');
      } catch (err) {
        reportError(err, 'models.check');
        if (live) setPhase('error');
      }
    })();
    return () => { live = false; };
  }, [choice, !!settings]);

  useEffect(() => () => abort.current?.abort(), []);

  useEffect(() => {
    if (phase === 'done') updateSettings({ modelsReady: true }).catch((err) => reportError(err, 'models.ready'));
  }, [phase]);

  const total = Object.values(rows).reduce((a, r) => a + r.total, 0);
  const done = Object.values(rows).reduce((a, r) => a + r.done, 0);
  const remaining = total - done;

  async function start() {
    const ctl = new AbortController();
    abort.current = ctl;
    setPhase('downloading');
    try {
      for (const m of toFetch) {
        if (rows[m.id]?.ready) continue;
        await downloadModel(m.id, (d, tot) => setRows((r) => ({ ...r, [m.id]: { done: d, total: tot, ready: false } })), ctl.signal);
        setRows((r) => ({ ...r, [m.id]: { ...r[m.id], done: r[m.id].total, ready: true } }));
      }
      setPhase('done');
    } catch (err) {
      if (!ctl.signal.aborted) reportError(err, 'models.download');
      setPhase(ctl.signal.aborted ? 'paused' : 'error');
    }
  }

  function pause() {
    abort.current?.abort();
  }

  const next = () => (onboarding ? navigate('/body?onboarding=1') : goBack('/settings'));

  const rowRight = (m: ModelSpec) => {
    const r = rows[m.id];
    if (!r) return '';
    if (r.ready) return phase === 'idle' ? size(r.total) : t('ai.dl.done');
    if (r.done > 0) return `${Math.floor((100 * r.done) / Math.max(1, r.total))}%`;
    if (phase === 'idle') return size(r.total);
    return t('ai.dl.waiting');
  };

  const list = [
    { m: cutout, icon: 'scissors' as const, title: t('ai.task.cutout'), what: t('ai.task.cutout.what') },
    { m: classify, icon: 'tag' as const, title: t('ai.task.classify'), what: t('ai.task.classify.what') },
  ];

  return (
    <div className="screen screen--no-tabs ai-dl">
      <div className="ai-dl__top">
        {onboarding && (
          <div className="ai-steps" role="img" aria-label={t('ai.dl.steps')}>
            <span className="on" /><span className="on" /><span />
          </div>
        )}
        {!onboarding && (
          <button type="button" className="back" onClick={() => goBack('/settings')}>
            <Icon name="back" size={20} strokeWidth={2} />{t('ai.lab.back')}
          </button>
        )}
        <div className="stack gap-8">
          <h1 className="h1">{t('ai.dl.title')}</h1>
          <p className="body">{t('ai.dl.lead')}</p>
        </div>

        <div className="card ai-dl__total">
          <div className="stack">
            <span className="meta">{t('ai.dl.total')}</span>
            <span className="ai-dl__size num">{phase === 'checking' ? '…' : size(total)}</span>
          </div>
          <span className="ai-dl__wifi"><Icon name="wifi" size={22} /><span>{t('ai.dl.wifi')}</span></span>
        </div>

        <ul className="card ai-dl__rows" aria-label={t('ai.dl.models')}>
          {list.map(({ m, icon, title, what }) => {
            const r = rows[m.id];
            const showBar = (phase === 'downloading' || phase === 'paused') && r && !r.ready;
            return (
              <li key={m.id} className="ai-dl__row">
                <AiIcon name={icon} />
                <div className="ai-dl__text">
                  <div className="ai-dl__line">
                    <span className="ai-dl__title">{title}</span>
                    <span className="ai-dl__right num">{rowRight(m)}</span>
                  </div>
                  <span className="ai-dl__what">{what}</span>
                  <span className="meta">{m.label} · {m.licence}</span>
                  {showBar && <span className="ai-minibar" aria-hidden="true"><span style={{ width: `${(100 * r.done) / Math.max(1, r.total)}%` }} /></span>}
                </div>
              </li>
            );
          })}
          <li className="ai-dl__row">
            <AiIcon name="search" />
            <div className="ai-dl__text">
              <div className="ai-dl__line">
                <span className="ai-dl__title">{t('ai.task.search')}</span>
                <span className="ai-dl__right num">{phase === 'idle' || phase === 'checking' ? size(searchBytes) : t('ai.dl.later')}</span>
              </div>
              <span className="ai-dl__what">{t('ai.task.search.what')}</span>
              <span className="meta">{search.label} · {search.licence} · {t('ai.dl.searchLater')}</span>
            </div>
          </li>
        </ul>
      </div>

      <div className="ai-dl__bottom">
        {(phase === 'idle' || phase === 'error') && (
          <>
            {phase === 'error' && <p className="ai-error" role="alert">{t('ai.dl.failed')}</p>}
            <button type="button" className="btn btn--primary btn--block ai-dl__cta" onClick={() => void start()}>
              <Icon name="download" size={20} strokeWidth={2} />
              {phase === 'error' ? t('action.retry') : t('ai.dl.download', { size: size(remaining) })}
            </button>
            <div className="ai-dl__later">
              <span className="meta">{t('ai.dl.needThem')}</span>
              <button type="button" className="text-action" onClick={next}>{t('ai.dl.notNow')}</button>
            </div>
          </>
        )}
        {(phase === 'downloading' || phase === 'paused') && (
          <>
            <div className="stack gap-8">
              <div className="ai-dl__progress num">
                <span>{phase === 'paused' ? t('ai.dl.paused') : t('ai.dl.downloading')}</span>
                <span>{t('ai.dl.ofTotal', { done: size(done), total: size(total) })}</span>
              </div>
              <div className="ai-bar" role="progressbar" aria-label={t('ai.dl.downloading')} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round((100 * done) / Math.max(1, total))}>
                <span style={{ width: `${(100 * done) / Math.max(1, total)}%` }} />
              </div>
              <span className="meta">{t('ai.dl.keepOpen')}</span>
            </div>
            {phase === 'downloading'
              ? <button type="button" className="btn btn--secondary btn--block" onClick={pause}>{t('ai.dl.pause')}</button>
              : <button type="button" className="btn btn--primary btn--block" onClick={() => void start()}>{t('ai.dl.resume')}</button>}
            {phase === 'paused' && (
              <div className="ai-dl__later">
                <span className="meta">{t('ai.dl.needThem')}</span>
                <button type="button" className="text-action" onClick={next}>{t('ai.dl.notNow')}</button>
              </div>
            )}
          </>
        )}
        {phase === 'done' && (
          <>
            <div className="ai-dl__ready">
              <Stamp animate>{t('ai.dl.stamp')}</Stamp>
              <span className="ai-dl__readytext">{t('ai.dl.readyText')}</span>
            </div>
            <button type="button" className="btn btn--primary btn--block ai-dl__cta" onClick={next}>
              {onboarding ? t('ai.dl.next') : t('action.done')}
              {onboarding && <AiIcon name="arrow" size={20} />}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
