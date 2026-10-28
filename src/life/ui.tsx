// Small parts shared by the outfits, wear log, trips, settings and onboarding screens.
import type { CSSProperties, ReactNode } from 'react';
import { Mannequin } from '../tryon';
import { usePhoto, useSettings } from '../data/repo';
import { CutoutImg, Sheet } from '../ui/parts';
import { useI18n } from '../i18n';
import type { Item, OutfitDraft } from '../domain/types';

/** Icons this module needs that the shared set doesn't have (same 24 × 24 grid, 1.8 stroke). */
const P = {
  dots: 'M5.5 12h.01M12 12h.01M18.5 12h.01',
  arrow: 'M5 12h14M13 6l6 6-6 6',
  noAccount: 'M12 4a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7ZM5 20c.8-3.6 3.6-6 7-6s6.2 2.4 7 6M4 4l16 16',
  phoneCheck: 'M8 3h8a1.5 1.5 0 0 1 1.5 1.5v15A1.5 1.5 0 0 1 16 21H8a1.5 1.5 0 0 1-1.5-1.5v-15A1.5 1.5 0 0 1 8 3ZM10.5 18h3M9.5 9.5l2 2 3.5-3.5',
  offline: 'M3 9.5a13 13 0 0 1 18 0M6 13a8.5 8.5 0 0 1 12 0M9.2 16.4a4 4 0 0 1 5.6 0M12 20h.01M3 3l18 18',
  compass: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18ZM15.5 8.5l-2 5-5 2 2-5Z',
  iosShare: 'M12 3v11M8 7l4-4 4 4M7 10H5v11h14V10h-2',
  addHome: 'M4.5 4.5h15v15h-15ZM12 8.5v7M8.5 12h7',
  globe: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18ZM3.5 12h17M12 3c2.4 2.5 3.5 5.5 3.5 9s-1.1 6.5-3.5 9c-2.4-2.5-3.5-5.5-3.5-9S9.6 5.5 12 3Z',
  menu: 'M12 5h.01M12 12h.01M12 19h.01',
  install: 'M8 3h8a1.5 1.5 0 0 1 1.5 1.5v15A1.5 1.5 0 0 1 16 21H8a1.5 1.5 0 0 1-1.5-1.5v-15A1.5 1.5 0 0 1 8 3ZM12 7.5v7M9 11.5l3 3 3-3',
  okCircle: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18ZM8 12.5l2.7 2.7L16 9.8',
} as const;
export type LifeIconName = keyof typeof P;

export function LIcon({ name, size = 22, strokeWidth, style }: { name: LifeIconName; size?: number; strokeWidth?: number; style?: CSSProperties }) {
  const sw = strokeWidth ?? (name === 'dots' || name === 'menu' ? 3.2 : 1.8);
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true" fill="none" stroke="currentColor" strokeWidth={sw}
      strokeLinecap="round" strokeLinejoin="round" style={{ flex: 'none', ...style }}>
      <path d={P[name]} />
    </svg>
  );
}

/** The mannequin, small, in the user's chosen mode (D13). */
export function MiniMannequin({ draft, height, mode }: { draft: OutfitDraft; height: number; mode?: 'photo' | 'outline' }) {
  const settings = useSettings();
  return <Mannequin draft={draft} height={height} mode={mode ?? settings?.mannequin ?? 'outline'} className="life-mini" />;
}

/** An item's cut-out (thumbnail when there is one). */
export function PieceImg({ item, size, style }: { item: Item; size: number; style?: CSSProperties }) {
  const photo = usePhoto(item.tryOnPhotoId);
  return <CutoutImg blob={photo?.thumb ?? photo?.cutout} alt="" size={size} style={style} />;
}

/** Keeps "T-shirt" on one line in narrow tiles (non-breaking hyphen). */
export const nbHyphen = (s: string): string => s.replace(/-/g, '\u2011');

/** "**bold**" markers in a translated string become <b>. */
export function Rich({ text }: { text: string }) {
  const parts = text.split('**');
  return <>{parts.map((p, i) => (i % 2 ? <b key={i}>{p}</b> : p))}</>;
}

/** A yes/no question in a bottom sheet. */
export function ConfirmSheet({ title, text, confirm, danger, onConfirm, onClose, busy }: {
  title: string; text?: ReactNode; confirm: string; danger?: boolean; onConfirm: () => void; onClose: () => void; busy?: boolean;
}) {
  const { t } = useI18n();
  return (
    <Sheet onClose={onClose} label={title}>
      <div className="life-sheet">
        <div className="life-sheet__head">
          <h2 className="h2">{title}</h2>
        </div>
        {text && <p className="body life-muted">{text}</p>}
        <div className="life-pair">
          <button type="button" className="btn btn--secondary" onClick={onClose}>{t('action.cancel')}</button>
          <button type="button" className={`btn ${danger ? 'btn--danger' : 'btn--primary'}`} onClick={onConfirm} disabled={busy}>
            {busy && <span className="spinner" aria-hidden="true" />}{confirm}
          </button>
        </div>
      </div>
    </Sheet>
  );
}

/** Sheet header: a Prata title and the round close button. */
export function SheetHead({ title, onClose }: { title: string; onClose: () => void }) {
  const { t } = useI18n();
  return (
    <div className="life-sheet__head">
      <h2 className="h2">{title}</h2>
      <button type="button" className="icon-btn icon-btn--tissue" aria-label={t('action.close')} onClick={onClose}>
        <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><path d="M6 6l12 12M18 6 6 18" /></svg>
      </button>
    </div>
  );
}

/** Formats bytes as "12 MB" / "1.4 GB". */
export function formatBytes(n: number, lang: 'en' | 'uk'): string {
  const units = lang === 'uk' ? ['Б', 'КБ', 'МБ', 'ГБ'] : ['B', 'KB', 'MB', 'GB'];
  let i = 0;
  let v = n;
  while (v >= 1000 && i < units.length - 1) { v /= 1000; i++; }
  const s = new Intl.NumberFormat(lang === 'uk' ? 'uk-UA' : 'en-GB', { maximumFractionDigits: v < 10 && i > 0 ? 1 : 0 }).format(v);
  return `${s} ${units[i]}`;
}

/** Saves a Blob as a file through a temporary link. */
export function downloadBlob(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

/** Opens the share sheet with a file. Returns 'shared', 'cancelled', or 'unsupported' (the caller falls back to a download). */
export async function shareFile(file: File, title?: string): Promise<'shared' | 'cancelled' | 'unsupported' | 'blocked'> {
  const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
  if (!nav.share || !nav.canShare?.({ files: [file] })) return 'unsupported';
  try {
    await nav.share({ files: [file], title });
    return 'shared';
  } catch (e) {
    const name = (e as DOMException)?.name;
    if (name === 'AbortError') return 'cancelled';
    if (name === 'NotAllowedError') return 'blocked';
    return 'unsupported';
  }
}
