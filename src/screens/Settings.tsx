// F15: Settings (board Settings.dc.html / SettingsUK.dc.html). Opens from the Dress-up header (D29).
import '../styles/life.css';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, updateSettings, withFreshBlobs } from '../data/db';
import { useLocations, useSettings } from '../data/repo';
import { applyBackup, BackupError, BACKUP_MIME, backupFileName, exportBackup, readBackup, type ParsedBackup } from '../data/backup';
import { requestRoundedLocation, useWeather } from '../data/weather';
import { MODELS } from '../ai';
import { useI18n } from '../i18n';
import { navigate, useRoute } from '../app/router';
import { Header, ProgressBar, Segmented, Sheet, Switch, Toast } from '../ui/parts';
import { Icon } from '../ui/icons';
import type { AiTask } from '../domain/types';
import { switchLanguage } from '../life/lang';
import { sessionCode } from '../diag/diagnostics';
import { ConfirmSheet, downloadBlob, formatBytes, LIcon, SheetHead, shareFile } from '../life/ui';

const BODY = 'M93 50L93 62C86 66 74 66 69 71C64 75 62 80 61 84L38 126L16 172L10 188L16 196L24 192L27 175L49 131L73 98L80 140L74 178L77 270L80 352L74 366L72 374L93 376L92 362L90 352L95 272L100 205L105 272L110 352L108 362L107 376L128 374L126 366L120 352L123 270L126 178L120 140L127 98L151 131L173 175L176 192L184 196L190 188L184 172L162 126L139 84C138 80 136 75 131 71C126 66 114 66 107 62L107 50Z';
const MONTH_OPTIONS = [3, 6, 9, 12];
const TASKS: { task: AiTask; key: 'settings.task.cutout' | 'settings.task.pose' | 'settings.task.classify' }[] = [
  { task: 'cutout', key: 'settings.task.cutout' },
  { task: 'pose', key: 'settings.task.pose' },
  { task: 'classify', key: 'settings.task.classify' },
];
const FONTS = ['Prata', 'Onest', 'Caveat'];
const LIBRARIES: [string, string][] = [
  ['React', 'MIT'], ['Dexie', 'Apache-2.0'], ['fflate', 'MIT'], ['Transformers.js', 'Apache-2.0'],
  ['ONNX Runtime Web', 'MIT'], ['MediaPipe Tasks Vision', 'Apache-2.0'], ['Workbox', 'MIT'], ['Vite PWA', 'MIT'], ['Sentry SDK', 'MIT'],
];
const REPO = 'https://github.com/Nik-Kras/iMannequin';

type Panel = 'months' | 'about' | 'deleteOriginal' | undefined;
type Backup = { state: 'idle' } | { state: 'building'; progress: number } | { state: 'ready'; file: File } | { state: 'restoring' };

function Figure({ outline }: { outline?: boolean }) {
  return (
    <svg viewBox="0 0 200 400" className="set-figure" aria-hidden="true">
      <ellipse cx="100" cy="33" rx="15" ry="19" fill={outline ? '#FFFFFF' : '#CDBFAD'} stroke={outline ? '#141414' : 'none'} strokeWidth="6" />
      <path d={BODY} fill={outline ? '#FFFFFF' : '#CDBFAD'} stroke={outline ? '#141414' : 'none'} strokeWidth="6" strokeLinejoin="round" />
    </svg>
  );
}

function Row({ label, value, onClick }: { label: string; value?: string; onClick: () => void }) {
  return (
    <button type="button" className="set-row" onClick={onClick}>
      <span className="grow">{label}</span>
      {value && <span className="set-row__value">{value}</span>}
      <Icon name="chevron" size={18} strokeWidth={2} />
    </button>
  );
}

const modelLabel = (id: string | undefined, task: AiTask): string | undefined =>
  (id ? MODELS.find((m) => m.id === id) : undefined)?.label ?? MODELS.find((m) => m.task === task && m.default)?.label ?? MODELS.find((m) => m.task === task)?.label;

export default function Settings() {
  const { t, tn, lang, date } = useI18n();
  const route = useRoute();
  const settings = useSettings();
  const places = useLocations();
  const body = useLiveQuery(() => db.body.get('current'), []);
  const weather = useWeather();
  const [panel, setPanel] = useState<Panel>();
  const [wx, setWx] = useState<'idle' | 'asking' | 'denied'>('idle');
  const [backup, setBackup] = useState<Backup>({ state: 'idle' });
  const [pending, setPending] = useState<ParsedBackup>();
  const [error, setError] = useState<string>();
  const [toast, setToast] = useState<string>();
  const [storage, setStorage] = useState<{ usage?: number; quota?: number; persisted?: boolean }>();
  const fileInput = useRef<HTMLInputElement>(null);
  const backupCard = useRef<HTMLElement>(null);
  const clearToast = useCallback(() => setToast(undefined), []);

  useEffect(() => {
    void (async () => {
      const est = await navigator.storage?.estimate?.().catch(() => undefined);
      const persisted = await navigator.storage?.persisted?.().catch(() => undefined);
      setStorage({ usage: est?.usage, quota: est?.quota, persisted });
    })();
  }, [settings?.lastBackupAt]);

  // "Back up" in the reminder banner lands here.
  const section = route.query.get('section');
  useEffect(() => {
    if (section === 'backup' && settings) backupCard.current?.scrollIntoView({ block: 'center' });
  }, [section, settings === undefined]);

  if (!settings) return <div className="screen screen--no-tabs" />;

  const setWeather = async (on: boolean) => {
    if (!on) {
      setWx('idle');
      await updateSettings({ weather: { enabled: false } });
      return;
    }
    setWx('asking');
    try {
      const { lat, lon } = await requestRoundedLocation();
      await updateSettings({ weather: { enabled: true, lat, lon } });
      setWx('idle');
    } catch {
      setWx('denied');
    }
  };

  const finishBackup = async (file: File) => {
    const r = await shareFile(file);
    if (r === 'shared' || r === 'unsupported') {
      if (r === 'unsupported') { await downloadBackup(file); return; }
      await updateSettings({ lastBackupAt: Date.now() });
      setBackup({ state: 'idle' });
      setToast(t('settings.exportDone'));
    } else {
      // Cancelled, or the share sheet needs a fresh tap after the file took a while to build.
      setBackup({ state: 'ready', file });
    }
  };

  const downloadBackup = async (file: File) => {
    downloadBlob(file, file.name);
    await updateSettings({ lastBackupAt: Date.now() });
    setBackup({ state: 'idle' });
    setToast(t('settings.exportDone'));
  };

  const startExport = async () => {
    setError(undefined);
    setBackup({ state: 'building', progress: 0 });
    try {
      const blob = await exportBackup((progress) => setBackup({ state: 'building', progress }));
      await finishBackup(new File([blob], backupFileName(), { type: BACKUP_MIME }));
    } catch {
      setBackup({ state: 'idle' });
      setError(t('settings.exportFailed'));
    }
  };

  const pickRestore = async (file?: File) => {
    if (!file) return;
    setError(undefined);
    try {
      setPending(await readBackup(file));
    } catch (e) {
      setError(e instanceof BackupError && e.code === 'newer' ? t('settings.restoreNewer') : t('settings.restoreBad'));
    } finally {
      if (fileInput.current) fileInput.current.value = '';
    }
  };

  const restore = async () => {
    if (!pending) return;
    setBackup({ state: 'restoring' });
    try {
      await applyBackup(pending);
      document.documentElement.lang = (pending.manifest.tables.settings?.[0] as { lang?: string } | undefined)?.lang ?? lang;
      setToast(t('settings.restored'));
    } catch {
      setError(t('settings.restoreBad'));
    } finally {
      setPending(undefined);
      setBackup({ state: 'idle' });
    }
  };

  const deleteOriginal = async () => {
    // D48: the original photo goes; the cut-out and mask stay, so the mannequin keeps working.
    const b = await db.body.get('current');
    if (b) await db.body.put(await withFreshBlobs({ ...b, photo: new Blob([], { type: b.photo.type }) }));
    setPanel(undefined);
    setToast(t('settings.originalDeleted'));
  };

  const busy = backup.state === 'building' || backup.state === 'restoring';
  const counts = pending?.manifest.counts;

  return (
    <div className="screen screen--no-tabs settings">
      <Header back="/dressup" backLabel={t('tab.dressup')} title={t('action.settings')} />

      <div className="settings__cards">
        <section className="card card--pad set-card" aria-labelledby="set-lang">
          <h2 id="set-lang" className="title-card">{t('settings.language')}</h2>
          <div className="set-seg">
            <Segmented label={t('settings.language')} value={settings.lang} onChange={(v) => void switchLanguage(v)}
              options={[{ value: 'en', label: 'English' }, { value: 'uk', label: 'Українська' }]} />
          </div>
        </section>

        <section className="card card--pad set-card" aria-labelledby="set-mq">
          <h2 id="set-mq" className="title-card">{t('settings.mannequin')}</h2>
          <div className="set-modes" role="group" aria-label={t('settings.mannequinAs')}>
            <button type="button" className="set-mode" aria-pressed={settings.mannequin === 'photo'} onClick={() => void updateSettings({ mannequin: 'photo' })}>
              <Figure />{t('settings.myPhoto')}
            </button>
            <button type="button" className="set-mode" aria-pressed={settings.mannequin === 'outline'} onClick={() => void updateSettings({ mannequin: 'outline' })}>
              <Figure outline />{t('settings.outline')}
            </button>
          </div>
          <div className="set-rows">
            <Row label={t('settings.retake')} onClick={() => navigate('/body')} />
            {body && body.photo.size > 0 && (
              <button type="button" className="set-row set-row--danger" onClick={() => setPanel('deleteOriginal')}>
                <span className="grow">{t('settings.deleteOriginal')}</span>
                <Icon name="trash" size={18} />
              </button>
            )}
          </div>
        </section>

        <section className="card card--pad set-card" aria-labelledby="set-wx">
          <div className="set-card__row">
            <h2 id="set-wx" className="title-card grow">{t('settings.weather')}</h2>
            <Switch checked={settings.weather.enabled} onChange={(v) => void setWeather(v)} label={<span className="sr-only">{t('settings.weather')}</span>} />
          </div>
          <p className="set-text">{settings.weather.enabled ? t('settings.weatherOn') : t('settings.weatherOff')}</p>
          {wx === 'asking' && <p className="set-text set-text--ink" role="status"><span className="spinner" aria-hidden="true" />{t('settings.weatherAsking')}</p>}
          {wx === 'denied' && <p className="set-text set-text--error" role="alert">{t('settings.weatherDenied')}</p>}
          {settings.weather.enabled && weather && (
            <p className="set-text set-text--ink"><Icon name="weather" size={20} />{t('settings.weatherToday', { temp: weather.tempC, summary: weather.summary })}</p>
          )}
        </section>

        <section className="card set-card set-card--rows">
          <Row label={t('settings.places')} value={places ? tn('settings.placesCount', places.length) : undefined} onClick={() => navigate('/places')} />
          <Row label={t('settings.notWornAfter')} value={tn('settings.months', settings.notWornMonths)} onClick={() => setPanel('months')} />
        </section>

        <section className="card card--pad set-card" aria-labelledby="set-ai">
          <h2 id="set-ai" className="title-card">{t('settings.models')}</h2>
          <dl className="set-models">
            {TASKS.map(({ task, key }) => (
              <div key={task}>
                <dt>{t(key)}</dt>
                <dd>{modelLabel(settings.models[task], task) ?? t('settings.modelNone')}</dd>
              </div>
            ))}
          </dl>
          <button type="button" className="btn btn--secondary btn--block btn--sm" onClick={() => navigate('/model-lab')}>
            <Icon name="flask" size={18} />{t('settings.modelLab')}
          </button>
        </section>

        <section ref={backupCard} className={`card card--pad set-card${section === 'backup' ? ' set-card--focus' : ''}`} aria-labelledby="set-bk">
          <h2 id="set-bk" className="title-card">{t('settings.backup')}</h2>
          <p className="set-status">
            {settings.lastBackupAt
              ? <><LIcon name="okCircle" size={20} />{t('settings.lastBackup', { date: date(settings.lastBackupAt, { day: 'numeric', month: 'short', year: 'numeric' }) })}</>
              : <><Icon name="warning" size={20} />{t('settings.neverBacked')}</>}
          </p>
          <p className="set-text">{t('settings.backupText')}</p>
          {backup.state === 'building' && (
            <div className="stack gap-8" role="status">
              <span className="set-text set-text--ink">{t('settings.exporting')}</span>
              <ProgressBar value={backup.progress} label={t('settings.exporting')} />
            </div>
          )}
          {backup.state === 'restoring' && <p className="set-text set-text--ink" role="status"><span className="spinner" aria-hidden="true" />{t('settings.restoring')}</p>}
          {backup.state === 'ready' && (
            <div className="stack gap-8">
              <p className="set-text set-text--ink">{t('settings.exportReady', { size: formatBytes(backup.file.size, lang) })}</p>
              <button type="button" className="btn btn--primary btn--block" onClick={() => void finishBackup(backup.file)}>
                <Icon name="share" size={18} />{t('settings.saveFile')}
              </button>
              <button type="button" className="text-action set-download" onClick={() => void downloadBackup(backup.file)}>{t('settings.downloadInstead')}</button>
            </div>
          )}
          {error && <p className="set-text set-text--error" role="alert">{error}</p>}
          <div className="life-pair">
            <button type="button" className="btn btn--primary" disabled={busy} onClick={() => void startExport()}>
              <Icon name="download" size={18} />{t('settings.export')}
            </button>
            <button type="button" className="btn btn--secondary" disabled={busy} onClick={() => fileInput.current?.click()}>{t('settings.restore')}</button>
          </div>
          <input ref={fileInput} type="file" accept=".imannequin,.zip,application/zip,application/octet-stream" hidden
            onChange={(e) => void pickRestore(e.target.files?.[0])} />
        </section>

        <section className="card card--pad set-card" aria-labelledby="set-diag">
          <div className="set-card__row">
            <h2 id="set-diag" className="title-card grow">{t('settings.diagnostics')}</h2>
            <Switch checked={settings.diagnostics} onChange={(v) => void updateSettings({ diagnostics: v })} label={<span className="sr-only">{t('settings.diagnostics')}</span>} />
          </div>
          <p className="set-text">{t('settings.diagnosticsText')}</p>
          <p className="set-text set-text--ink" style={{ userSelect: 'all', WebkitUserSelect: 'all' }}>{t('settings.diagnosticsCode', { code: sessionCode() })}</p>
        </section>

        <section className="card set-card set-card--rows">
          <div className="set-row set-row--static">
            <span className="grow">{t('settings.storage')}</span>
            <span className="set-row__value">
              {storage?.usage !== undefined && storage.quota
                ? t('settings.storageUse', { used: formatBytes(storage.usage, lang), quota: formatBytes(storage.quota, lang) })
                : t('settings.storageUnknown')}
            </span>
          </div>
          {storage?.persisted !== undefined && <p className="set-text set-row__note">{storage.persisted ? t('settings.persisted') : t('settings.notPersisted')}</p>}
          <Row label={t('settings.about')} onClick={() => setPanel('about')} />
        </section>
      </div>

      {panel === 'months' && (
        <Sheet onClose={() => setPanel(undefined)} label={t('settings.notWornAfter')}>
          <div className="life-sheet">
            <SheetHead title={t('settings.notWornAfter')} onClose={() => setPanel(undefined)} />
            <p className="set-text">{t('settings.notWornHint')}</p>
            <div className="set-chips" role="group" aria-label={t('settings.notWornAfter')}>
              {MONTH_OPTIONS.map((m) => (
                <button key={m} type="button" className="chip" aria-pressed={settings.notWornMonths === m}
                  onClick={() => { void updateSettings({ notWornMonths: m }); setPanel(undefined); }}>
                  {tn('settings.months', m)}
                </button>
              ))}
            </div>
          </div>
        </Sheet>
      )}

      {panel === 'about' && <About onClose={() => setPanel(undefined)} />}

      {panel === 'deleteOriginal' && (
        <ConfirmSheet title={t('settings.deleteOriginal')} text={<>{t('settings.deleteOriginalConfirm')}<br /><br />{t('settings.deleteOriginalNote')}</>}
          confirm={t('action.delete')} danger onClose={() => setPanel(undefined)} onConfirm={() => void deleteOriginal()} />
      )}

      {pending && counts && (
        <ConfirmSheet title={t('settings.restoreTitle')} confirm={t('settings.restoreConfirm')} danger busy={backup.state === 'restoring'}
          text={t('settings.restoreText', {
            date: date(pending.manifest.createdAt, { day: 'numeric', month: 'short', year: 'numeric' }),
            items: tn('count.items', counts.items ?? 0),
            outfits: tn('settings.outfitsCount', counts.outfits ?? 0),
            trips: tn('settings.tripsCount', counts.trips ?? 0),
          })}
          onClose={() => setPending(undefined)} onConfirm={() => void restore()} />
      )}

      {toast && <Toast onDone={clearToast}>{toast}</Toast>}
    </div>
  );
}

function About({ onClose }: { onClose: () => void }) {
  const { t } = useI18n();
  return (
    <Sheet onClose={onClose} label={t('settings.about')}>
      <div className="life-sheet life-sheet--scroll">
        <SheetHead title={t('settings.about')} onClose={onClose} />
        <div className="about">
          <div className="about__brand">
            <img src={`${import.meta.env.BASE_URL}icon-192.png`} alt="" width={44} height={44} />
            <div className="stack">
              <span className="about__mark">iMannequin</span>
              <span className="meta">{t('settings.version', { version: __APP_VERSION__, build: __BUILD_ID__ })}</span>
            </div>
          </div>
          <p className="set-text">{t('settings.aboutApp')}</p>
          <a className="text-action about__link" href={REPO} target="_blank" rel="noreferrer">{t('settings.source')}</a>

          <h3 className="title-card">{t('settings.fonts')}</h3>
          <ul className="about__list">
            {FONTS.map((f) => <li key={f}><span>{f}</span><span>SIL OFL 1.1</span></li>)}
          </ul>

          <h3 className="title-card">{t('settings.aiModels')}</h3>
          {MODELS.length === 0 ? <p className="set-text">{t('settings.noModels')}</p> : (
            <ul className="about__list">
              {MODELS.map((m) => <li key={m.id}><span>{m.label}</span><span>{m.licence}</span></li>)}
            </ul>
          )}

          <h3 className="title-card">{t('settings.libraries')}</h3>
          <ul className="about__list">
            {LIBRARIES.map(([n, l]) => <li key={n}><span>{n}</span><span>{l}</span></li>)}
          </ul>

          <h3 className="title-card">{t('settings.weatherData')}</h3>
          <p className="set-text">{t('settings.weatherCredit')} <span className="about__lic">CC BY 4.0</span></p>
        </div>
      </div>
    </Sheet>
  );
}
