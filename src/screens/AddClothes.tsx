// Add clothes (F2, D20): a camera loop. Each snap joins the processing queue at once and the camera stays open.
// Falls back to the phone's own camera (file input) when the live camera isn't available or allowed.
import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import '../styles/wardrobe.css';
import { goBack } from '../app/router';
import { db, withReopen } from '../data/db';
import { enqueuePhotos } from '../data/queue';
import { useQueueView, type QueueRow } from '../data/queueView';
import { useItem, usePhoto, useReviewItems } from '../data/repo';
import { reportError } from '../diag/diagnostics';
import { useI18n } from '../i18n';
import { notify } from '../ui/action';
import { Icon } from '../ui/icons';
import { captureFrame, downscaleToJpeg } from '../wardrobe/images';
import { QueuePhoto, TitledSheet } from '../wardrobe/parts';
import { ModelsNeeded } from '../ai/ui';

type CamState = 'starting' | 'live' | 'denied' | 'unavailable';
const IOS = /iPhone|iPad|iPod/.test(navigator.userAgent);
const TIPS = ['wardrobe.add.tip.tops', 'wardrobe.add.tip.bottoms', 'wardrobe.add.tip.shoes'] as const;

export default function AddClothes() {
  const { t, tn } = useI18n();
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const stripRef = useRef<HTMLUListElement>(null);
  const [cam, setCam] = useState<CamState>('starting');
  const [tip, setTip] = useState(0);
  const [flash, setFlash] = useState(0);
  const [guide, setGuide] = useState(false);
  const [importing, setImporting] = useState<{ i: number; n: number }>();
  const jobs = useQueueView();
  const review = useReviewItems();
  const noItems = useLiveQuery(async () => (await db.items.count()) === 0, []);
  const firstVisit = noItems && jobs?.length === 0;

  // Live rear camera; stopped when leaving the screen.
  useEffect(() => {
    let cancelled = false;
    async function start() {
      if (!navigator.mediaDevices?.getUserMedia) { setCam('unavailable'); return; }
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1440 } }, audio: false,
        });
        if (cancelled) { stream.getTracks().forEach((tr) => tr.stop()); return; }
        streamRef.current = stream;
        setCam('live');
      } catch (e) {
        if (cancelled) return;
        setCam(e instanceof DOMException && (e.name === 'NotAllowedError' || e.name === 'SecurityError') ? 'denied' : 'unavailable');
      }
    }
    void start();
    // iPhone stops the camera in the background; start it again when the app comes back.
    const onVisible = () => {
      if (document.visibilityState !== 'visible') return;
      const live = streamRef.current?.getVideoTracks().some((tr) => tr.readyState === 'live');
      if (!live && streamRef.current) { streamRef.current = null; setCam('starting'); void start(); }
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', onVisible);
      streamRef.current?.getTracks().forEach((tr) => tr.stop());
      streamRef.current = null;
    };
  }, []);
  // The stream plays once the video is shown: a video started while hidden can stay paused with no frames, and the
  // shutter then does nothing (WebKit on Linux did).
  useEffect(() => {
    const v = videoRef.current;
    const stream = streamRef.current;
    if (cam !== 'live' || !v || !stream) return;
    if (v.srcObject !== stream) v.srcObject = stream;
    void v.play().catch(() => {});
  }, [cam]);

  useEffect(() => {
    const id = setInterval(() => setTip((i) => (i + 1) % TIPS.length), 5000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => { if (firstVisit) setGuide(true); }, [firstVisit]);

  // Keep the newest thumbnail in view.
  const count = jobs?.length ?? 0;
  useEffect(() => {
    const el = stripRef.current;
    if (el) el.scrollTo({ left: el.scrollWidth, behavior: 'smooth' });
  }, [count]);

  /** Puts photos in the queue. A write can fail on iOS (bug-audit #3): the caller says so and offers Retry. */
  async function store(blobs: Blob[]): Promise<boolean> {
    try {
      await withReopen(() => enqueuePhotos(blobs));
      return true;
    } catch (err) {
      reportError(err, 'add.store');
      return false;
    }
  }
  const storeFailed = (retry: () => void) =>
    notify({ text: t('wardrobe.add.photoFailed'), actionLabel: t('action.retry'), action: retry, ms: 8000 });

  async function snap() {
    const v = videoRef.current;
    if (!v || cam !== 'live' || !v.videoWidth) return;
    let blob: Blob;
    try {
      blob = await captureFrame(v);
    } catch (err) {
      reportError(err, 'add.capture');
      notify({ text: t('wardrobe.add.photoFailed'), ms: 8000 });
      return;
    }
    // The flash means "kept": it fires only once the photo is in the queue.
    const keep = async () => { if (await store([blob])) setFlash((n) => n + 1); else storeFailed(() => void keep()); };
    await keep();
  }

  async function onFiles(e: ChangeEvent<HTMLInputElement>) {
    const all = [...(e.target.files ?? [])];
    e.target.value = '';
    // HEIC from some pickers has no type; anything else that isn't an image is counted, not dropped silently.
    const files = all.filter((f) => f.type.startsWith('image/') || f.type === '');
    await importFiles(files, all.length - files.length);
  }

  /** Each photo joins the queue as soon as it's scaled down, so the strip fills while the rest follow (bug-audit #11). */
  async function importFiles(files: File[], notPhotos: number) {
    let added = 0;
    try {
      for (let i = 0; i < files.length; i++) {
        setImporting({ i: i + 1, n: files.length });
        const blob = await downscaleToJpeg(files[i]);
        if (!(await store([blob]))) { storeFailed(() => void importFiles(files.slice(i), 0)); return; }
        added++;
      }
    } finally {
      setImporting(undefined);
    }
    const said = [added ? tn('wardrobe.add.added', added) : '', notPhotos ? tn('wardrobe.add.notPhotos', notPhotos) : ''].filter(Boolean);
    if (said.length) notify({ text: said.join(' · '), ms: 4000 });
  }

  const left = (jobs ?? []).filter((j) => j.state === 'waiting' || j.state === 'working').length;
  const reviewN = review?.length ?? 0;
  const recent = (jobs ?? []).slice(-20);
  const fallback = cam === 'denied' || cam === 'unavailable';

  return (
    <div className="wd-cam">
      <ModelsNeeded where="camera" />
      <div className="wd-cam__view">
        <video ref={videoRef} className="wd-cam__video" playsInline muted autoPlay aria-hidden="true" hidden={cam !== 'live'} />
        {fallback && (
          <div className="wd-cam__fallback">
            <Icon name="camera" size={34} />
            <p className="body">{cam === 'denied' ? t(IOS ? 'wardrobe.add.deniedIos' : 'wardrobe.add.denied') : t('wardrobe.add.noCamera')}</p>
            {cam === 'unavailable' && <p className="wd-cam__hint">{t('wardrobe.add.noCameraHint')}</p>}
            <label className="btn btn--primary">
              <input type="file" accept="image/*" capture="environment" className="sr-only" onChange={onFiles} />
              <Icon name="camera" size={20} />{t('wardrobe.add.takePhoto')}
            </label>
          </div>
        )}
        {cam === 'starting' && <div className="wd-cam__fallback"><span className="spinner" /><p className="body">{t('wardrobe.add.starting')}</p></div>}
        <svg className="wd-cam__frame" viewBox="0 0 322 420" preserveAspectRatio="none" aria-hidden="true">
          <path d="M2 34V2h32M288 2h32v32M320 386v32h-32M34 418H2v-32" fill="none" stroke="#fff" strokeWidth="3.5" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
        </svg>
        {flash > 0 && <span key={flash} className="wd-cam__flash" aria-hidden="true" />}
        <span className="wd-cam__tip" aria-hidden="true">{t(TIPS[tip])}</span>
      </div>

      <div className="wd-cam__top">
        <button type="button" className="wd-cam__close" aria-label={t('wardrobe.add.close')} onClick={() => goBack('/wardrobe')}>
          <Icon name="close" size={20} strokeWidth={2} />
        </button>
        <button type="button" className="wd-cam__pill" aria-haspopup="dialog" onClick={() => setGuide(true)}>{t('wardrobe.add.guidePill')}</button>
        <span className="wd-cam__spacer" />
      </div>

      <section className="wd-cam__panel" aria-label={t('wardrobe.add.queueLabel')}>
        <div className="wd-cam__status">
          <span className="wd-cam__left" aria-live="polite">
            {importing ? t('wardrobe.add.importing', importing)
              : left > 0 ? t('wardrobe.add.left', { n: left }) : count > 0 ? t('wardrobe.add.allDone') : t('wardrobe.add.idle')}
          </span>
          {(left > 0 || importing) && <span className="meta">{t('wardrobe.add.keepOpen')}</span>}
        </div>
        <ul className="wd-cam__strip" ref={stripRef}>
          {recent.map((j) => <JobThumb key={j.id} job={j} />)}
          {recent.length === 0 && Array.from({ length: 4 }, (_, i) => <li key={i} className="wd-jobthumb wd-jobthumb--empty" aria-hidden="true" />)}
        </ul>
        <div className="wd-cam__controls">
          <label className="wd-cam__side">
            <input type="file" accept="image/*" multiple className="sr-only" onChange={onFiles} />
            <span className="wd-cam__sidebox"><Icon name="gallery" size={22} /></span>
            {t('wardrobe.add.gallery')}
          </label>
          {cam === 'live' ? (
            <button type="button" className="wd-cam__shutter" aria-label={t('wardrobe.add.shutter')} onClick={snap}><span /></button>
          ) : (
            <label className="wd-cam__shutter" aria-label={t('wardrobe.add.shutter')}>
              <input type="file" accept="image/*" capture="environment" className="sr-only" onChange={onFiles} disabled={cam === 'starting'} />
              <span />
            </label>
          )}
          <a className="wd-cam__side" href="#/review" aria-label={t('wardrobe.add.reviewAria', { n: reviewN })}>
            <span className="wd-cam__sidebox wd-cam__sidebox--ink num">{reviewN}</span>
            {t('wardrobe.add.review')}
          </a>
        </div>
      </section>

      {guide && (
        <TitledSheet title={t('wardrobe.add.guide.title')} onClose={() => setGuide(false)}
          footer={<button type="button" className="btn btn--primary btn--block" onClick={() => setGuide(false)}>{t('action.continue')}</button>}>
          <ul className="wd-guide">
            {(['flat', 'above', 'tops', 'bottoms', 'shoes', 'loop'] as const).map((k) => <li key={k}>{t(`wardrobe.add.guide.${k}`)}</li>)}
          </ul>
        </TitledSheet>
      )}
    </div>
  );
}

/** One photo in the queue strip. A finished one opens its review item, a failed one its row in the inbox (bug-audit #16). */
function JobThumb({ job }: { job: QueueRow }) {
  const { t } = useI18n();
  const item = useItem(job.state === 'done' ? job.itemId : undefined);
  const photo = usePhoto(item?.tryOnPhotoId);
  const cut = photo?.thumb ?? photo?.cutout;
  const body = <QueuePhoto row={job} cutout={job.state === 'done' && photo ? { key: `photo:${photo.id}:${cut?.size}`, blob: cut } : undefined} />;
  const href = job.state === 'done' && item ? `#/item/${item.id}` : job.state === 'failed' ? `#/review?job=${job.id}` : undefined;
  return (
    <li className={`wd-jobthumb wd-jobthumb--${job.state}`}>
      {href ? <a className="wd-jobthumb__link" href={href} aria-label={t(`wardrobe.add.state.${job.state}`)}>{body}</a> : body}
    </li>
  );
}
