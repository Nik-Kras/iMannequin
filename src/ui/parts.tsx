// Paper components shared by every screen. Styling lives in styles/global.css.
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { goBack, sheetEntry } from '../app/router';
import { useI18n } from '../i18n';
import { Icon, type IconName } from './icons';

export function Header({ title, back, backLabel, actions, sub }: {
  title?: ReactNode;
  /** Path to go back to when there is no history (the label names the previous screen). */
  back?: string;
  backLabel?: string;
  actions?: ReactNode;
  sub?: ReactNode;
}) {
  const { t } = useI18n();
  return (
    <div className="stack gap-8">
      {back !== undefined && (
        <div className="header">
          <button type="button" className="back" onClick={() => goBack(back)}>
            <Icon name="back" size={20} strokeWidth={2} />
            {backLabel ?? t('action.back')}
          </button>
          <div className="header__actions">{title ? null : actions}</div>
        </div>
      )}
      {title && (
        <div className="header">
          <h1 className="h1">{title}</h1>
          {actions && <div className="header__actions">{actions}</div>}
        </div>
      )}
      {sub && <div className="pad meta">{sub}</div>}
    </div>
  );
}

export function IconButton({ icon, label, onClick, href, variant }: {
  icon: IconName; label: string; onClick?: () => void; href?: string; variant?: 'ink' | 'tissue';
}) {
  const cls = `icon-btn${variant ? ` icon-btn--${variant}` : ''}`;
  if (href) return <a className={cls} href={href} aria-label={label}><Icon name={icon} /></a>;
  return <button type="button" className={cls} aria-label={label} onClick={onClick}><Icon name={icon} /></button>;
}

export function Chip({ pressed, onClick, children, ai, variant }: {
  pressed?: boolean; onClick?: () => void; children: ReactNode; ai?: boolean; variant?: 'soft' | 'dashed';
}) {
  const { t } = useI18n();
  return (
    <button type="button" className={`chip${variant ? ` chip--${variant}` : ''}`} aria-pressed={pressed} onClick={onClick}>
      {ai && <Icon name="sparkle" size={12} className="chip__ai" aria-label={t('ai.suggested')} role="img" aria-hidden={false} />}
      {children}
    </button>
  );
}

export function Segmented<T extends string>({ value, options, onChange, label, onPaper }: {
  value: T; options: { value: T; label: string }[]; onChange: (v: T) => void; label: string; onPaper?: boolean;
}) {
  return (
    <div role="group" aria-label={label} className={`seg${onPaper ? ' seg--on-paper' : ''}`}>
      {options.map((o) => (
        <button key={o.value} type="button" aria-pressed={o.value === value} onClick={() => onChange(o.value)}>{o.label}</button>
      ))}
    </div>
  );
}

export function Switch({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: ReactNode }) {
  return (
    <button type="button" role="switch" aria-checked={checked} className="switch" onClick={() => onChange(!checked)}>
      <span className="switch__track" />
      {label}
    </button>
  );
}

/** The control last pressed: WebKit doesn't focus a button that is tapped or clicked, so the focus can't tell. */
let lastPressed: HTMLElement | null = null;
if (typeof document !== 'undefined') {
  document.addEventListener('pointerdown', (e) => { lastPressed = (e.target as Element).closest?.<HTMLElement>('button, a[href], input, [tabindex]') ?? null; }, true);
}

export function Sheet({ onClose, children, label }: { onClose: () => void; children: ReactNode; label: string }) {
  const ref = useRef<HTMLElement>(null);
  const scrim = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  close.current = onClose;
  // Read before the children mount: an autofocused field takes the focus first.
  const [opener] = useState(() => (document.activeElement && document.activeElement !== document.body ? document.activeElement as HTMLElement : lastPressed));
  const kbd = useKeyboardLift(ref);
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') close.current(); };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, []);
  // Back and the iPhone edge swipe close the sheet, not the screen under it (bug-audit #24).
  useEffect(() => sheetEntry(() => close.current()), []);
  // VoiceOver (bug-audit #43): the focus moves into the sheet and the screen behind it is out of reach;
  // on close the focus goes back where it was. The sheet slides out instead of vanishing (#48).
  useLayoutEffect(() => {
    const el = ref.current!;
    const back = scrim.current!;
    const hash = location.hash;
    if (!el.contains(document.activeElement)) {
      const title = el.querySelector<HTMLElement>('h1, h2') ?? el;
      title.tabIndex = -1;
      title.focus({ preventScroll: true });
    }
    const restore = inertOutside(el, back);
    return () => {
      restore();
      if (location.hash !== hash) return; // left the screen: the next one takes the focus
      slideOut(el, back);
      if (opener?.isConnected && opener !== document.body) opener.focus({ preventScroll: true });
    };
  }, [opener]);
  const style = kbd ? ({ bottom: kbd.lift, '--sheet-max': `${kbd.max}px` } as CSSProperties) : undefined;
  return (
    <>
      <div ref={scrim} className="scrim" onClick={onClose} />
      <section ref={ref} className={`sheet${kbd ? ' sheet--kbd' : ''}`} style={style} role="dialog" aria-modal="true" aria-label={label}>{children}</section>
    </>
  );
}

/**
 * While a field in the sheet has the focus and the iOS keyboard covers the bottom of the screen, the sheet sits on
 * top of the keyboard and fits the visible area (bug-audit #32). iOS shrinks only the visual viewport.
 */
function useKeyboardLift(ref: RefObject<HTMLElement | null>): { lift: number; max: number } | null {
  const [kbd, setKbd] = useState<{ lift: number; max: number } | null>(null);
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const update = () => {
      const a = document.activeElement;
      const typing = !!a && !!ref.current?.contains(a) && a.matches('input, textarea, select, [contenteditable]');
      const lift = Math.max(0, Math.round(innerHeight - vv.height - vv.offsetTop));
      setKbd(typing && lift > 0 ? { lift, max: Math.round(vv.height) - 24 } : null);
    };
    update();
    vv.addEventListener('resize', update);
    vv.addEventListener('scroll', update);
    return () => {
      vv.removeEventListener('resize', update);
      vv.removeEventListener('scroll', update);
    };
  }, [ref]);
  return kbd;
}

/** Makes everything outside `el` inert (out of reach of taps, Tab and VoiceOver); returns the undo. */
function inertOutside(el: Element, keep: Element): () => void {
  const done: Element[] = [];
  for (let node: Element = el; node.parentElement && node !== document.body; node = node.parentElement) {
    for (const sib of node.parentElement.children) {
      if (sib === node || sib === keep || sib.hasAttribute('inert') || sib.matches('script, .toast, [aria-live]')) continue;
      sib.setAttribute('inert', '');
      done.push(sib);
    }
  }
  return () => done.forEach((s) => s.removeAttribute('inert'));
}

/** Plays the sheet sliding down on a copy, since the real one is already being removed. */
function slideOut(el: HTMLElement, back: HTMLElement) {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const ghosts = [back, el].map((n) => {
    const g = n.cloneNode(true) as HTMLElement;
    for (const a of ['role', 'aria-modal', 'aria-label', 'id']) g.removeAttribute(a);
    g.setAttribute('aria-hidden', 'true');
    g.setAttribute('inert', '');
    g.classList.add(n === el ? 'sheet--closing' : 'scrim--closing');
    document.body.appendChild(g);
    return g;
  });
  setTimeout(() => ghosts.forEach((g) => g.remove()), 200);
}

export function Tag({ children, ink }: { children: ReactNode; ink?: boolean }) {
  return <span className={`tag${ink ? ' tag--ink' : ''}`}>{children}</span>;
}

export function Stamp({ children, animate }: { children: ReactNode; animate?: boolean }) {
  return <span className={`stamp${animate ? ' stamp--in' : ''}`}>{children}</span>;
}

/** Hand-drawn pen circle drawn over a selected cell (design: one selection mark for "chosen"). */
export function PenCircle() {
  return (
    <svg viewBox="0 0 112 112" preserveAspectRatio="none" aria-hidden="true"
      style={{ position: 'absolute', inset: -6, width: 'calc(100% + 12px)', height: 'calc(100% + 12px)', pointerEvents: 'none', overflow: 'visible' }}>
      <path d="M62 5C30 2 5 20 5 56c0 34 26 52 55 51 30-1 48-22 47-52C106 26 86 6 54 8" fill="none" stroke="#141414" strokeWidth="2.2" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

export function Empty({ icon = 'wardrobe', children, action }: { icon?: IconName; children: ReactNode; action?: ReactNode }) {
  return (
    <div className="empty">
      <Icon name={icon} size={32} />
      <div className="body">{children}</div>
      {action}
    </div>
  );
}

export function ProgressBar({ value, label }: { value: number; label?: string }) {
  const pct = Math.max(0, Math.min(100, Math.round(value * 100)));
  return (
    <div className="bar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-label={label}>
      <span style={{ width: `${pct}%` }} />
    </div>
  );
}

/** Object URL for a Blob, revoked when the blob changes or the component unmounts. */
export function useBlobUrl(blob?: Blob | null): string | undefined {
  const [url, setUrl] = useState<string>();
  useEffect(() => {
    if (!blob) { setUrl(undefined); return; }
    let u: string | undefined;
    let live = true;
    // WebKit can fail object URLs made from Blobs that IndexedDB keeps on disk
    // ("WebKitBlobResource error 1"), so the bytes are copied into memory first.
    void blob.arrayBuffer().then((buf) => {
      if (!live) return;
      u = URL.createObjectURL(new Blob([buf], { type: blob.type || 'image/png' }));
      setUrl(u);
    }).catch(() => { if (live) setUrl(undefined); });
    return () => {
      live = false;
      const old = u;
      // Revoke a little later: the <img> keeps the old URL until the next render.
      if (old) setTimeout(() => URL.revokeObjectURL(old), 4000);
    };
  }, [blob]);
  return url;
}

/** A garment cut-out on transparent background, with the white scissor margin and paper shadow. */
export function CutoutImg({ blob, alt, size, style }: { blob?: Blob | null; alt: string; size?: number; style?: React.CSSProperties }) {
  const url = useBlobUrl(blob);
  if (!url) return <span className="inset" style={{ display: 'block', width: size, height: size, ...style }} />;
  return <img className="cutout" src={url} alt={alt} width={size} height={size} style={{ width: size, height: size, ...style }} draggable={false} />;
}

/** The live region every toast is drawn into; set by ToastHost. */
let toastHost: HTMLElement | null = null;

/**
 * One polite live region, always in the page, that every toast is drawn into (bug-audit #44): VoiceOver can miss a
 * region that appears together with its text. Rendered once by the app shell.
 */
export function ToastHost() {
  return <div className="toast-host" role="status" aria-live="polite" ref={(el) => { toastHost = el; }} />;
}

/**
 * Short-lived message at the bottom; pass an action for "Undo"-style follow-ups. A toast with an action stays at
 * least 6 s and waits while it is touched. It is drawn into the shell's live region, so VoiceOver reads it out.
 * The toast sits outside the screen's own markup: place it with `className`, not with a screen-scoped selector.
 */
export function Toast({ children, action, onDone, ms = 3500, className }: { children: ReactNode; action?: ReactNode; onDone: () => void; ms?: number; className?: string }) {
  const left = useRef(action ? Math.max(ms, 6000) : ms);
  const [held, setHeld] = useState(false);
  useEffect(() => {
    if (held) return;
    const start = Date.now();
    const id = setTimeout(onDone, Math.max(left.current, 1500));
    return () => {
      clearTimeout(id);
      left.current -= Date.now() - start;
    };
  }, [held, onDone]);
  const hold = () => setHeld(true);
  const release = () => setHeld(false);
  const box = (
    <div className={`toast${className ? ` ${className}` : ''}`} onPointerDown={hold} onPointerUp={release} onPointerCancel={release} onFocus={hold} onBlur={release}>
      <span className="grow">{children}</span>{action}
    </div>
  );
  return toastHost?.isConnected ? createPortal(box, toastHost) : box;
}
