// Paper components shared by every screen. Styling lives in styles/global.css.
import { useEffect, useState, type ReactNode } from 'react';
import { goBack } from '../app/router';
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

export function Sheet({ onClose, children, label }: { onClose: () => void; children: ReactNode; label: string }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onClose]);
  return (
    <>
      <div className="scrim" onClick={onClose} />
      <section className="sheet" role="dialog" aria-modal="true" aria-label={label}>{children}</section>
    </>
  );
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

/** Short-lived message at the bottom; pass an action for "Undo"-style follow-ups. */
export function Toast({ children, action, onDone, ms = 3500 }: { children: ReactNode; action?: ReactNode; onDone: () => void; ms?: number }) {
  useEffect(() => { const id = setTimeout(onDone, ms); return () => clearTimeout(id); }, [onDone, ms]);
  return <div className="toast" role="status"><span className="grow">{children}</span>{action}</div>;
}
