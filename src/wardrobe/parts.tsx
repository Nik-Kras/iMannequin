// Small pieces shared by the wardrobe screens: colour swatches, extra icons, pickers and sheets.
import { useEffect, useRef, useState, type ReactNode, type SVGProps } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../data/db';
import type { QueueRow } from '../data/queueView';
import { CATEGORIES } from '../domain/taxonomy';
import type { CategoryId, ColourName, Location, Photo, QueueState } from '../domain/types';
import { useI18n } from '../i18n';
import { useAction } from '../ui/action';
import { Sheet } from '../ui/parts';
import { Icon } from '../ui/icons';
import { CATEGORY_GROUPS, groupOf } from './filters';
import { addPlace } from './ops';

/** Swatch colours for the named palette. These are garment colours, so they may be shown (D27). */
export const COLOUR_HEX: Record<ColourName, string> = {
  black: '#1E1E1E', white: '#F4F2EC', grey: '#8E8C88', cream: '#EFE6D2', beige: '#C9B48E', brown: '#6E4A30', tan: '#B08A5A',
  red: '#A8323A', burgundy: '#6D1F2C', pink: '#D99AA5', orange: '#D9772B', rust: '#B5562F', yellow: '#E3C341', mustard: '#C9962F',
  green: '#4F7A4A', olive: '#6B6B3A', khaki: '#A39A6B', teal: '#2F7A7A', blue: '#3E6FB0', navy: '#2F3E5C', denim: '#4A6A8F',
  purple: '#6A4C8C', multi: '#B5562F',
};
export const COLOURS = Object.keys(COLOUR_HEX) as ColourName[];

export function Swatch({ colour, size = 24 }: { colour: ColourName; size?: number }) {
  const bg = colour === 'multi'
    ? 'conic-gradient(#A8323A 0 25%, #E3C341 0 50%, #4F7A4A 0 75%, #3E6FB0 0)'
    : COLOUR_HEX[colour];
  return <span className="wd-swatch" style={{ width: size, height: size, background: bg }} aria-hidden="true" />;
}

const EXTRA: Record<string, string> = {
  erase: 'M15 4l5 5-9.5 9.5H6L3.5 16Zm-5 5 5 5M6 20h14',
  restore: 'M4 20l3.5-1L18 8.5 15.5 6 5 16.5ZM14 7.5l2.5 2.5M17 3l1 2 2 1-2 1-1 2-1-2-2-1 2-1Z',
  pinch: 'M4 4l6 6M4 4v4.5M4 4h4.5M20 20l-6-6M20 20v-4.5M20 20h-4.5',
  arrowRight: 'M5 12h14M13 6l6 6-6 6',
  up: 'M6 15l6-6 6 6',
  down: 'M6 9l6 6 6-6',
  pencil: 'M4 20l3.5-1L18 8.5 15.5 6 5 16.5ZM14 7.5l2.5 2.5',
  box: 'M3.5 8 12 4l8.5 4v8L12 20l-8.5-4ZM3.5 8 12 12l8.5-4M12 12v8',
  clock: 'M12 6v6l3.5 2',
  zoomIn: 'M10.5 4a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13ZM15.5 15.5 20 20M8 10.5h5M10.5 8v5',
  zoomOut: 'M10.5 4a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13ZM15.5 15.5 20 20M8 10.5h5',
};
export type ExtraIcon = keyof typeof EXTRA;

export function XIcon({ name, size = 20, strokeWidth = 1.8, ...rest }: { name: ExtraIcon; size?: number; strokeWidth?: number } & SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true" fill="none" stroke="currentColor"
      strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" {...rest}>
      <path d={EXTRA[name]} />
    </svg>
  );
}

/** The AI's four-point star (R5): this value was suggested and can be changed. */
export function AiMark({ size = 13 }: { size?: number }) {
  const { t } = useI18n();
  return <Icon name="sparkle" size={size} className="wd-ai" role="img" aria-hidden={false} aria-label={t('ai.suggested')} />;
}

/** Photos by id, for grids and lists. */
export function usePhotos(ids: (string | undefined)[]): Map<string, Photo> {
  const key = ids.filter(Boolean).join(',');
  const photos = useLiveQuery(async () => {
    const list = ids.filter((x): x is string => !!x);
    const rows = await db.photos.bulkGet(list);
    return rows.filter((p): p is Photo => !!p);
  }, [key]);
  const m = new Map<string, Photo>();
  for (const p of photos ?? []) m.set(p.id, p);
  return m;
}

// Object URLs keyed by what the picture is (a queue job, a photo version), not by the Blob object: live
// queries re-read their rows on every change, and a new URL per Blob re-decoded every thumbnail (bug-audit #11).
interface KeyedUrl { url?: string; pending?: Promise<string | undefined>; users: number }
const keyedUrls = new Map<string, KeyedUrl>();

export function useKeyedBlobUrl(key: string | undefined, blob: Blob | undefined): string | undefined {
  const [url, setUrl] = useState(() => (key ? keyedUrls.get(key)?.url : undefined));
  const has = !!blob;
  useEffect(() => {
    if (!key || !blob) { setUrl(undefined); return; }
    let e = keyedUrls.get(key);
    if (!e) keyedUrls.set(key, (e = { users: 0 }));
    const entry = e;
    entry.users++;
    let live = true;
    // WebKit can fail object URLs of Blobs that IndexedDB keeps on disk, so the bytes are copied first.
    entry.pending ??= blob.arrayBuffer().then((buf) => {
      const u = URL.createObjectURL(new Blob([buf], { type: blob.type || 'image/jpeg' }));
      if (keyedUrls.get(key) !== entry) { URL.revokeObjectURL(u); return undefined; }
      return (entry.url = u);
    }, () => { entry.pending = undefined; return undefined; });
    void entry.pending.then((u) => { if (live) setUrl(u); });
    return () => {
      live = false;
      entry.users--;
      // Released a little later: the next screen often shows the same picture.
      setTimeout(() => {
        if (entry.users > 0 || keyedUrls.get(key) !== entry) return;
        keyedUrls.delete(key);
        if (entry.url) URL.revokeObjectURL(entry.url);
      }, 4000);
    };
    // Follows the key: a re-read of the same picture is a new Blob object with the same bytes.
  }, [key, has]);
  return url;
}

const STATE_ICON: Record<QueueState, ReactNode> = {
  waiting: <XIcon name="clock" size={13} strokeWidth={2.4} />,
  working: <Icon name="scissors" size={13} strokeWidth={2.2} />,
  done: <Icon name="check" size={13} strokeWidth={2.6} />,
  failed: <Icon name="warning" size={13} strokeWidth={2.2} />,
};

/** A queue photo (its small preview) with its state as a badge; the state is also said in words for VoiceOver. */
export function QueuePhoto({ row, cutout }: { row: QueueRow; cutout?: { key: string; blob?: Blob } }) {
  const { t } = useI18n();
  const photoUrl = useKeyedBlobUrl(cutout ? undefined : `job:${row.id}`, row.image);
  const cutUrl = useKeyedBlobUrl(cutout?.key, cutout?.blob);
  return (
    <>
      {cutout ? cutUrl && <img className="cutout" src={cutUrl} alt="" style={{ width: 48, height: 44 }} draggable={false} />
        : photoUrl && <img src={photoUrl} alt="" draggable={false} />}
      <span className="wd-jobthumb__badge" aria-hidden="true">{STATE_ICON[row.state]}</span>
      <span className="sr-only">{t(`wardrobe.add.state.${row.state}`)}</span>
    </>
  );
}

/** A luggage tag with a place name (design: places are written by hand, in Caveat). */
export function PlaceTag({ name, tilt = -1.2, small }: { name: string; tilt?: number; small?: boolean }) {
  return <span className={`wd-tag${small ? ' wd-tag--sm' : ''}`} style={{ transform: `rotate(${tilt}deg)` }}>{name}</span>;
}

const TILTS = [-0.8, 0.6, -0.3, 0.9, -0.6, 0.4, 0.7, -0.9, 0.3, -0.4, 0.8, -0.7];
export const tiltFor = (i: number) => TILTS[i % TILTS.length];

/** Bottom sheet with the Prata title row and a close button. */
export function TitledSheet({ title, onClose, children, footer }: { title: string; onClose: () => void; children: ReactNode; footer?: ReactNode }) {
  const { t } = useI18n();
  return (
    <Sheet onClose={onClose} label={title}>
      <div className="wd-sheet">
        <div className="wd-sheet__head">
          <h2 className="h2">{title}</h2>
          <button type="button" className="icon-btn icon-btn--tissue" aria-label={t('action.close')} onClick={onClose}><Icon name="close" size={20} /></button>
        </div>
        <div className="wd-sheet__body">{children}</div>
        {footer && <div className="wd-sheet__foot">{footer}</div>}
      </div>
    </Sheet>
  );
}

export function CategorySheet({ value, onPick, onClose }: { value?: CategoryId; onPick: (c: CategoryId) => void; onClose: () => void }) {
  const { t } = useI18n();
  return (
    <TitledSheet title={t('wardrobe.item.category')} onClose={onClose}>
      {CATEGORY_GROUPS.map((g) => (
        <div key={g} className="stack gap-8">
          <h3 className="wd-label">{t(`wardrobe.group.${g}`)}</h3>
          <div className="wd-chips">
            {CATEGORIES.filter((c) => groupOf(c.id) === g).map((c) => (
              <button key={c.id} type="button" className="wd-opt" aria-pressed={c.id === value} onClick={() => { onPick(c.id); onClose(); }}>
                {t(`cat.${c.id}`)}
              </button>
            ))}
          </div>
        </div>
      ))}
    </TitledSheet>
  );
}

export function ColourSheet({ value, onChange, onClose, only }: {
  value: ColourName[]; onChange: (v: ColourName[]) => void; onClose: () => void; only?: ColourName[];
}) {
  const { t } = useI18n();
  const list = only ?? COLOURS;
  const toggle = (c: ColourName) => onChange(value.includes(c) ? value.filter((x) => x !== c) : [...value, c]);
  return (
    <TitledSheet title={t('wardrobe.item.colours')} onClose={onClose}
      footer={<button type="button" className="btn btn--primary btn--block" onClick={onClose}>{t('action.done')}</button>}>
      <div className="wd-chips">
        {list.map((c) => (
          <button key={c} type="button" className="wd-colour" aria-pressed={value.includes(c)} onClick={() => toggle(c)}>
            <Swatch colour={c} />{t(`colour.${c}`)}
            {value.includes(c) && <Icon name="check" size={16} strokeWidth={2.4} />}
          </button>
        ))}
      </div>
    </TitledSheet>
  );
}

/** Pick a place from the list, "no place", or write a new one. */
export function PlaceSheet({ places, value, onPick, onClose, allowNone = true, startNew = false }: {
  places: Location[]; value?: string; onPick: (id: string | undefined) => void; onClose: () => void; allowNone?: boolean; startNew?: boolean;
}) {
  const { t } = useI18n();
  const [adding, setAdding] = useState(startNew);
  return (
    <TitledSheet title={t('wardrobe.item.place')} onClose={onClose}>
      <div className="wd-chips">
        {places.map((p, i) => (
          <button key={p.id} type="button" className="wd-tagbtn" aria-pressed={p.id === value} style={{ transform: `rotate(${tiltFor(i)}deg)` }}
            onClick={() => { onPick(p.id); onClose(); }}>{p.name}</button>
        ))}
        {allowNone && (
          <button type="button" className="wd-opt" aria-pressed={!value} onClick={() => { onPick(undefined); onClose(); }}>{t('wardrobe.item.noPlace')}</button>
        )}
      </div>
      {adding ? (
        <NewPlaceForm onDone={(id) => { if (id) { onPick(id); onClose(); } else setAdding(false); }} />
      ) : (
        <button type="button" className="wd-add-dashed" onClick={() => setAdding(true)}><Icon name="plus" size={20} strokeWidth={2} />{t('wardrobe.item.newPlace')}</button>
      )}
    </TitledSheet>
  );
}

/** Inline form: name a new place and add it at the end of the list. */
export function NewPlaceForm({ onDone, initial = '', submitLabel }: { onDone: (id?: string, name?: string) => void; initial?: string; submitLabel?: string }) {
  const { t } = useI18n();
  const [name, setName] = useState(initial);
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => { ref.current?.focus(); }, []);
  // One place per tap, however fast the second tap comes (bug-audit #23).
  const add = useAction('places.add', async (n: string) => onDone(await addPlace(n), n), { errorText: t('state.saveFailed'), retryLabel: t('action.retry') });
  return (
    <form className="stack gap-8" onSubmit={(e) => {
      e.preventDefault();
      const n = name.trim();
      if (!n || add.busy) return;
      if (submitLabel) { onDone(undefined, n); return; }
      void add.run(n);
    }}>
      <label className="field">
        <span className="field__label">{t('wardrobe.item.newPlaceName')}</span>
        <input ref={ref} className="input wd-hand-input" value={name} maxLength={40} placeholder={t('wardrobe.places.namePh')} onChange={(e) => setName(e.target.value)} />
      </label>
      <div className="row gap-8">
        <button type="button" className="btn btn--secondary btn--sm grow" onClick={() => onDone()}>{t('action.cancel')}</button>
        <button type="submit" className="btn btn--primary btn--sm grow" disabled={!name.trim() || add.busy}>{submitLabel ?? t('action.add')}</button>
      </div>
    </form>
  );
}

export function ConfirmSheet({ title, body, confirm, onConfirm, onClose }: {
  title: string; body?: ReactNode; confirm: string; onConfirm: () => void; onClose: () => void;
}) {
  const { t } = useI18n();
  return (
    <TitledSheet title={title} onClose={onClose}
      footer={
        <div className="row gap-8">
          <button type="button" className="btn btn--secondary grow" onClick={onClose}>{t('action.cancel')}</button>
          <button type="button" className="btn btn--danger grow" onClick={() => { onConfirm(); onClose(); }}>{confirm}</button>
        </div>
      }>
      {body && <p className="body wd-muted">{body}</p>}
    </TitledSheet>
  );
}
