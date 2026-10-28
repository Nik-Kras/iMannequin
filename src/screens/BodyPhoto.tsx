// Body photo (F1, D13, D14, boards BodyGuide guide/check): the A-pose guide, a photo from the camera (10 s self-timer
// when the browser allows it) or the gallery, then the check screen with the key points drawn over the cut-out.
import { useEffect, useMemo, useRef, useState } from 'react';
import { goBack, navigate, useRoute } from '../app/router';
import { updateSettings } from '../data/db';
import { record, reportError, risky } from '../diag/diagnostics';
import type { BodyRecord } from '../domain/types';
import { useI18n, type Key } from '../i18n';
import { armAngles, DESIGN_BODY_PATH, DESIGN_HEAD, POSE_LIMITS, prepareBodyPhoto, processBodyPhoto, saveBodyRecord, type PoseIssue } from '../tryon';
import { useAction } from '../ui/action';
import { Icon } from '../ui/icons';
import { Header, useBlobUrl } from '../ui/parts';
import { captureFrame } from '../wardrobe/images';
import '../styles/body.css';

type Step = 'guide' | 'camera' | 'processing' | 'check' | 'error';
type CamFail = 'denied' | 'unavailable';

const SKELETON: [number, number][] = [
  [11, 12], [11, 13], [13, 15], [12, 14], [14, 16], [11, 23], [12, 24], [23, 24],
  [23, 25], [25, 27], [27, 29], [29, 31], [24, 26], [26, 28], [28, 30], [30, 32],
  [8, 5], [5, 0], [0, 2], [2, 7],
];
const DOTS = [0, 2, 5, 7, 8, 11, 12, 13, 14, 15, 16, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32];

const hasCamera = () => typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia;

// The picked photo is kept for the session until it's used or retaken, so a reload (or iOS reloading the app)
// on the check screen processes it again instead of starting over (bug-audit #14).
const PENDING = 'imq.body.pending';
const keepPending = (b: Blob) => new Promise<void>((resolve) => {
  const r = new FileReader();
  r.onload = () => { try { sessionStorage.setItem(PENDING, String(r.result)); } catch { /* full or blocked: a reload starts over */ } resolve(); };
  r.onerror = () => resolve();
  r.readAsDataURL(b);
});
const dropPending = () => { try { sessionStorage.removeItem(PENDING); } catch { /* blocked */ } };
function readPending(): Blob | undefined {
  try {
    const url = sessionStorage.getItem(PENDING);
    const m = url?.match(/^data:([^;,]*);base64,(.*)$/);
    if (!m) return undefined;
    const bin = atob(m[2]);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new Blob([bytes], { type: m[1] || 'image/jpeg' });
  } catch {
    return undefined;
  }
}

export default function BodyPhoto() {
  const { t } = useI18n();
  const route = useRoute();
  const onboarding = route.query.get('onboarding') === '1';
  const [step, setStep] = useState<Step>('guide');
  const [camFail, setCamFail] = useState<CamFail>();
  const [photo, setPhoto] = useState<Blob>();
  const [result, setResult] = useState<{ body?: BodyRecord; issues: PoseIssue[] }>();
  const [saving, setSaving] = useState(false);
  const [saveFailed, setSaveFailed] = useState(false);
  const gallery = useRef<HTMLInputElement>(null);

  const run = async (picked: Blob, keep = true) => {
    setPhoto(undefined);
    setSaveFailed(false);
    setStep('processing');
    record('body.process', { kb: Math.round(picked.size / 1024), type: picked.type || 'none' });
    try {
      // 2048 px, in memory, right away (bug-audit #9).
      const blob = await prepareBodyPhoto(picked);
      setPhoto(blob);
      if (keep) await keepPending(blob);
      const r = await risky('body.process', () => processBodyPhoto(blob));
      record('body.checked', { body: !!r.body, issues: r.issues.map((i) => i.code).join(',') || 'none' });
      setResult(r);
      setStep('check');
    } catch (err) {
      reportError(err, 'body.process');
      setStep('error');
    }
  };
  // A reload on the check screen picks the same photo up again; leaving the screen forgets it.
  useEffect(() => {
    const pending = readPending();
    if (pending) void run(pending, false);
    return dropPending;
  }, []);

  const onFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (f) { setCamFail(undefined); void run(f); }
  };
  const retake = () => { dropPending(); setResult(undefined); setPhoto(undefined); setStep('guide'); };
  const finish = async () => {
    if (onboarding) {
      await updateSettings({ onboarded: true });
      navigate('/dressup', { replace: true });
    } else goBack('/settings');
  };
  const skip = useAction('body.skip', finish, { errorText: t('state.saveFailed'), retryLabel: t('action.retry') });
  const use = async () => {
    if (!result?.body || saving) return;
    setSaving(true);
    setSaveFailed(false);
    try {
      await saveBodyRecord(result.body);
      await finish();
    } catch (err) {
      reportError(err, 'body.save');
      setSaveFailed(true);
      setSaving(false);
    }
  };

  const checkStep = step === 'check' || step === 'error';
  const ok = !!result?.body && result.issues.length === 0;
  // R5: arm-angle and framing issues are advice; with no person found there's nothing to use (bug-audit #13).
  const canOverride = !!result?.body && result.issues.length > 0 && result.issues.every((i) => i.code === 'armAngle' || i.code === 'framing');
  const useButton = (label: string, cls: string) => (
    <button type="button" className={`btn btn--block ${cls}`} aria-busy={saving} disabled={saving} onClick={() => void use()}>
      {saving ? <><span className={`spinner${cls.includes('primary') ? ' spinner--on-ink' : ''}`} aria-hidden="true" />{t('body.saving')}</> : label}
    </button>
  );

  return (
    <>
      {/* Mounted once, whatever the step: a picker opened from an input that then unmounts drops the photo (bug-audit #12). */}
      <input ref={gallery} type="file" accept="image/*" hidden onChange={onFile} />
      {step === 'camera' ? (
        <Camera onShot={(b) => void run(b)} onCancel={() => setStep('guide')} onFail={(why) => { setCamFail(why); setStep('guide'); }} />
      ) : (
        <div className="screen screen--no-tabs bp">
          {onboarding ? (
            <div className="pad bp__steps">
              <span className="sr-only">{checkStep ? t('body.stepCheck') : t('body.step')}</span>
              <span aria-hidden="true" className="bp__dots"><span /><span /><span /></span>
            </div>
          ) : (
            <Header back="/settings" backLabel={t('body.back')} />
          )}

          {step === 'guide' && (
            <div className="pad bp__body">
              <h1 className="h1">{t('body.title')}</h1>
              {camFail && (
                <p className="bp__issue" role="alert"><Icon name="camera" size={20} />{t(camFail === 'denied' ? 'body.camera.denied' : 'body.camera.unavailable')}</p>
              )}
              <div className="card bp__guide">
                <svg viewBox="0 0 200 400" className="bp__figure" role="img" aria-label={t('body.guideAlt')}>
                  <ellipse cx={DESIGN_HEAD.cx} cy={DESIGN_HEAD.cy} rx={DESIGN_HEAD.rx} ry={DESIGN_HEAD.ry} className="bp__dash" />
                  <path d={DESIGN_BODY_PATH} className="bp__dash" />
                  <path d="M127 74L127 132M127 112A38 38 0 0 0 144 107" fill="none" stroke="#141414" strokeWidth="1.4" />
                  <path d="M88 386L112 386M88 382L88 390M112 382L112 390" stroke="#141414" strokeWidth="1.4" fill="none" />
                </svg>
                <span className="bp__arms">{t('body.armsNote', { min: POSE_LIMITS.armMin, max: POSE_LIMITS.armMax })}</span>
                <span className="bp__feet">{t('body.feetNote')}</span>
              </div>
              <ul className="bp__tips">
                {(['body.tip.clothes', 'body.tip.wall', 'body.tip.frame', 'body.tip.phone'] as Key[]).map((k) => (
                  <li key={k}>
                    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="#141414" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4.5 12.5c2 1.2 3.4 2.6 4.6 4.6C11.5 11.8 14.8 8 19.5 5.5" /></svg>
                    {t(k)}
                  </li>
                ))}
              </ul>
              <p className="bp__privacy"><Icon name="lock" size={18} />{t('body.privacy')}</p>
            </div>
          )}

          {step === 'processing' && (
            <div className="pad bp__body bp__processing" role="status">
              <h1 className="h1">{t('body.title')}</h1>
              <div className="card bp__check-card"><PhotoPreview blob={photo} /><span className="bp__scan" aria-hidden="true" /></div>
              <div className="row gap-12"><span className="spinner" aria-hidden="true" /><span className="body">{t('body.processing')}</span></div>
              <p className="meta">{t('body.processingNote')}</p>
            </div>
          )}

          {checkStep && (
            <div className="pad bp__body">
              <h1 className="h1">{result?.body ? t('body.checkTitle') : t('body.retryTitle')}</h1>
              <div className="card bp__check-card">
                {result?.body ? <Skeleton body={result.body} label={t('body.skeletonAlt')} /> : <PhotoPreview blob={photo} />}
              </div>
              {step === 'error' ? (
                <p className="bp__issue" role="alert"><Icon name="warning" size={20} />{t('body.failed')}</p>
              ) : result && <CheckList result={result} />}
              {saveFailed && <p className="bp__issue" role="alert"><Icon name="warning" size={20} />{t('body.saveFailed')}</p>}
            </div>
          )}

          <div className="bp__actions">
            {step === 'guide' && (
              <>
                {camFail || !hasCamera() ? (
                  // A real input under the finger: iOS opens the camera only from the tap itself (bug-audit #12).
                  <label className="btn btn--primary btn--block bp__primary">
                    <input type="file" accept="image/*" capture="environment" className="sr-only" onChange={onFile} />
                    <Icon name="camera" size={20} />{t('body.take')}
                  </label>
                ) : (
                  <button type="button" className="btn btn--primary btn--block bp__primary" onClick={() => setStep('camera')}>
                    <Icon name="timer" size={20} />{t('body.takeTimer')}
                  </button>
                )}
                <button type="button" className="btn btn--secondary btn--block" onClick={() => gallery.current?.click()}>
                  <Icon name="gallery" size={20} />{t('body.gallery')}
                </button>
                {onboarding && <button type="button" className="text-action bp__skip" disabled={skip.busy} onClick={() => void skip.run()}>{t('body.skip')}</button>}
              </>
            )}
            {checkStep && (
              <>
                {ok && useButton(t('body.use'), 'btn--primary bp__primary')}
                <button type="button" className={`btn btn--block ${ok ? 'btn--secondary' : 'btn--primary bp__primary'}`} disabled={saving} onClick={retake}>
                  {t('body.retake')}
                </button>
                {canOverride && useButton(t('body.useAnyway'), 'btn--secondary')}
                {onboarding && !ok ? <button type="button" className="text-action bp__skip" disabled={skip.busy || saving} onClick={() => void skip.run()}>{t('body.skip')}</button> : null}
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}

function PhotoPreview({ blob }: { blob?: Blob }) {
  const url = useBlobUrl(blob);
  return url ? <img src={url} alt="" className="bp__photo" /> : null;
}

/** The body cut-out with the key points joined into a skeleton (canonical 1000 × 2000 coordinates). */
function Skeleton({ body, label }: { body: BodyRecord; label: string }) {
  const url = useBlobUrl(body.cutout);
  const l = body.landmarks;
  // Crop to the body (the canonical canvas has room around it).
  const vb = '40 60 920 1900';
  return (
    <div className="bp__skeleton">
      {url && <svg viewBox={vb} className="bp__skeleton-img" aria-hidden="true"><image href={url} x="0" y="0" width="1000" height="2000" /></svg>}
      <svg viewBox={vb} className="bp__skeleton-lines" role="img" aria-label={label}>
        <path d={SKELETON.map(([a, b]) => `M${l[a].x} ${l[a].y}L${l[b].x} ${l[b].y}`).join('')} fill="none" stroke="#141414" strokeWidth="8" strokeLinecap="round" strokeLinejoin="round" />
        {DOTS.map((i) => <circle key={i} cx={l[i].x} cy={l[i].y} r="16" fill="#fff" stroke="#141414" strokeWidth="8" />)}
      </svg>
    </div>
  );
}

function CheckList({ result }: { result: { body?: BodyRecord; issues: PoseIssue[] } }) {
  const { t } = useI18n();
  const items = useMemo(() => {
    const out: { ok: boolean; text: string }[] = [];
    const by = (c: PoseIssue['code']) => result.issues.find((i) => i.code === c);
    const vis = by('visibility');
    if (vis?.detail === 'body' || !result.body) {
      out.push({ ok: false, text: t('body.issue.noBody') });
      return out;
    }
    const arm = by('armAngle');
    if (arm) {
      const [kind, deg] = (arm.detail ?? 'low:0').split(':');
      out.push({ ok: false, text: t(kind === 'high' ? 'body.issue.armHigh' : 'body.issue.armLow', { deg }) });
    } else {
      const [a, b] = armAngles(result.body.landmarks);
      out.push({ ok: true, text: t('body.ok.arms', { deg: Math.round((a + b) / 2) }) });
    }
    const facing = by('facing');
    if (facing) out.push({ ok: false, text: t(facing.detail?.includes('back') ? 'body.issue.back' : 'body.issue.turned') });
    else out.push({ ok: true, text: t('body.ok.facing') });
    const framing = by('framing');
    const parts = framing?.detail?.split(',') ?? [];
    if (parts.includes('head')) out.push({ ok: false, text: t('body.issue.headCut') });
    if (parts.includes('feet')) out.push({ ok: false, text: t('body.issue.feetCut') });
    if (parts.includes('sides')) out.push({ ok: false, text: t('body.issue.sidesCut') });
    if (vis) out.push({ ok: false, text: t('body.issue.unclear', { parts: (vis.detail ?? '').split(',').map((p) => t(`body.part.${p}` as Key)).join(', ') }) });
    if (!framing && !vis) out.push({ ok: true, text: t('body.ok.framing') });
    return out;
  }, [result, t]);
  return (
    <ul className="bp__checks">
      {items.map((c, i) => (
        <li key={i} className={c.ok ? undefined : 'is-issue'}>
          {c.ok
            ? <span className="bp__tick"><Icon name="check" size={13} strokeWidth={3} /></span>
            : <span className="bp__warn"><Icon name="warning" size={20} /></span>}
          {c.text}
        </li>
      ))}
    </ul>
  );
}

/** Short ticks for the last seconds of the self-timer (Web Audio, unlocked by the tap that starts it). */
function useTicks() {
  const ctx = useRef<AudioContext | null>(null);
  useEffect(() => () => { void ctx.current?.close().catch(() => {}); }, []);
  const arm = () => {
    try {
      const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!ctx.current && AC) ctx.current = new AC();
      void ctx.current?.resume().catch(() => {});
    } catch { /* no sound */ }
  };
  const tick = (hz: number) => {
    const a = ctx.current;
    if (!a) return;
    try {
      const o = a.createOscillator();
      const g = a.createGain();
      o.frequency.value = hz;
      g.gain.setValueAtTime(0.0001, a.currentTime);
      g.gain.exponentialRampToValueAtTime(0.3, a.currentTime + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, a.currentTime + 0.12);
      o.connect(g).connect(a.destination);
      o.start();
      o.stop(a.currentTime + 0.13);
    } catch { /* no sound */ }
  };
  return { arm, tick };
}

/** Live camera with a dashed A-pose outline and a 10-second self-timer. */
function Camera({ onShot, onCancel, onFail }: { onShot: (b: Blob) => void; onCancel: () => void; onFail: (why: CamFail) => void }) {
  const { t } = useI18n();
  const video = useRef<HTMLVideoElement>(null);
  const [facing, setFacing] = useState<'user' | 'environment'>('user');
  const [count, setCount] = useState<number | null>(null);
  const [ready, setReady] = useState(false);
  // The stream stops while the app is in the background and starts again when it's back (bug-audit #15).
  const [visible, setVisible] = useState(() => document.visibilityState !== 'hidden');
  const [restart, setRestart] = useState(0);
  const ticks = useTicks();
  const cb = useRef({ onShot, onFail });
  cb.current = { onShot, onFail };

  useEffect(() => {
    const on = () => {
      const v = document.visibilityState !== 'hidden';
      if (!v) setCount(null); // a frame taken in the background is black
      setVisible(v);
    };
    document.addEventListener('visibilitychange', on);
    return () => document.removeEventListener('visibilitychange', on);
  }, []);

  useEffect(() => {
    setReady(false);
    if (!visible) return;
    let stream: MediaStream | undefined;
    let live = true;
    navigator.mediaDevices.getUserMedia({ video: { facingMode: facing, width: { ideal: 1920 }, height: { ideal: 1920 } }, audio: false })
      .then((s) => {
        if (!live) { s.getTracks().forEach((tr) => tr.stop()); return; }
        stream = s;
        if (video.current) {
          video.current.srcObject = s;
          void video.current.play().then(() => setReady(true), () => setReady(true));
        }
      })
      .catch((e: unknown) => {
        if (!live) return;
        const name = (e as { name?: string })?.name;
        cb.current.onFail(name === 'NotAllowedError' || name === 'SecurityError' ? 'denied' : 'unavailable');
      });
    return () => { live = false; stream?.getTracks().forEach((tr) => tr.stop()); };
  }, [facing, visible, restart]);

  useEffect(() => {
    if (count === null) return;
    if (count === 0) {
      const v = video.current;
      const track = (v?.srcObject as MediaStream | null)?.getVideoTracks()[0];
      if (document.visibilityState === 'hidden' || track?.readyState === 'ended') { setCount(null); setRestart((n) => n + 1); return; }
      if (!v || !v.videoWidth) { cb.current.onFail('unavailable'); return; }
      captureFrame(v, 2048).then((b) => cb.current.onShot(b), () => cb.current.onFail('unavailable'));
      return;
    }
    if (count <= 3) ticks.tick(880);
    const id = setTimeout(() => setCount(count - 1), 1000);
    return () => clearTimeout(id);
  }, [count]);

  const start = () => { ticks.arm(); setCount(10); };

  return (
    <div className="bp-cam" role="dialog" aria-modal="true" aria-label={t('body.camera')}>
      <video ref={video} className={`bp-cam__video${facing === 'user' ? ' is-mirror' : ''}`} playsInline muted autoPlay />
      <svg viewBox="0 0 200 400" className="bp-cam__guide" aria-hidden="true">
        <ellipse cx={DESIGN_HEAD.cx} cy={DESIGN_HEAD.cy} rx={DESIGN_HEAD.rx} ry={DESIGN_HEAD.ry} />
        <path d={DESIGN_BODY_PATH} />
      </svg>
      <div className="bp-cam__top">
        <button type="button" className="bp-cam__close" aria-label={t('body.camera.cancel')} onClick={onCancel}>
          <Icon name="close" size={20} strokeWidth={2} />
        </button>
        <button type="button" className="icon-btn" aria-label={t('body.camera.flip')} onClick={() => setFacing(facing === 'user' ? 'environment' : 'user')} disabled={count !== null}>
          <Icon name="flip" />
        </button>
      </div>
      {count !== null && count > 0 && <div className="bp-cam__count" aria-hidden="true">{count}</div>}
      {/* Always mounted, so screen readers announce every change with the whole sentence. */}
      <p className="sr-only" role="status" aria-live="assertive">{count ? t('body.camera.countdown', { n: count }) : ''}</p>
      <div className="bp-cam__bottom">
        <p className="bp-cam__hint">{t('body.camera.hint')}</p>
        <button type="button" className="btn btn--secondary btn--block" disabled={!ready || count !== null} onClick={start}>
          <Icon name="timer" size={20} />{t('body.camera.start')}
        </button>
      </div>
    </div>
  );
}
