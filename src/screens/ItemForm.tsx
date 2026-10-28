// Item form (F3, F11): reviews a new photo the AI filled in, or edits a saved item.
import { useEffect, useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import '../styles/wardrobe.css';
import { goBack, navigate } from '../app/router';
import { db } from '../data/db';
import { deleteItem, saveItem, useActiveItems, useLocations, useReviewItems } from '../data/repo';
import { CATEGORY } from '../domain/taxonomy';
import { SEASONS, type CategoryId, type ColourName, type Item, type Photo, type Season, type Zone } from '../domain/types';
import { useI18n, type Key } from '../i18n';
import { CutoutImg, Empty, useBlobUrl } from '../ui/parts';
import { Icon } from '../ui/icons';
import { usedBrands } from '../wardrobe/filters';
import { autoName } from '../wardrobe/naming';
import { dismissSameItem, mergeIntoExisting, setCutoutApproved } from '../wardrobe/ops';
import { AiMark, CategorySheet, ColourSheet, ConfirmSheet, PlaceSheet, Swatch, tiltFor } from '../wardrobe/parts';

interface Form {
  id: string;
  name: string;
  /** The name still follows category and colour (D38) until the user types their own. */
  nameAuto: boolean;
  category: CategoryId;
  colours: ColourName[];
  seasons: Season[];
  locationId?: string;
  brand: string;
  notes: string;
}

function zoneKey(category: CategoryId): Key {
  const d = CATEGORY[category];
  if (d.zone === 'torso') return `wardrobe.zone.${d.layer ?? 'base'}`;
  return `wardrobe.zone.${d.zone as Exclude<Zone, 'torso'>}`;
}

const sameSet = <T,>(a: T[], b: T[]) => a.length === b.length && a.every((x) => b.includes(x));

/** Moves on after a review item is saved, merged or deleted: the next one waiting, or the wardrobe. */
function nextReview(list: Item[] | undefined, currentId: string, emptyTo: string) {
  const rest = (list ?? []).filter((it) => it.id !== currentId);
  const i = (list ?? []).findIndex((it) => it.id === currentId);
  const next = rest[Math.max(0, i)] ?? rest[0];
  navigate(next ? `/item/${next.id}` : emptyTo, { replace: true });
}

export default function ItemForm({ itemId }: { itemId?: string }) {
  const { t, tn, lang, date } = useI18n();
  const item = useLiveQuery(async () => (itemId ? (await db.items.get(itemId)) ?? null : null), [itemId]);
  const photos = useLiveQuery(async () => (itemId ? db.photos.where('itemId').equals(itemId).sortBy('createdAt') : []), [itemId]);
  const wear = useLiveQuery(async () => (itemId ? (await db.wear.orderBy('date').reverse().toArray()).filter((w) => w.itemIds.includes(itemId)) : []), [itemId]);
  const review = useReviewItems();
  const active = useActiveItems();
  const places = useLocations() ?? [];
  const sameId = item?.status === 'review' ? item.suggestion?.sameItemId : undefined;
  const sameItem = active?.find((it) => it.id === sameId);
  const samePhoto = useLiveQuery(async () => (sameItem?.tryOnPhotoId ? db.photos.get(sameItem.tryOnPhotoId) : undefined), [sameItem?.tryOnPhotoId]);

  const [form, setForm] = useState<Form>();
  const [viewId, setViewId] = useState<string>();
  const [showOriginal, setShowOriginal] = useState(false);
  const [sheet, setSheet] = useState<'category' | 'colour' | 'place' | 'newPlace' | 'delete' | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (item && form?.id !== item.id) {
      setForm({
        id: item.id, name: item.name, nameAuto: item.name === autoName(lang, item.category, item.colours[0]),
        category: item.category, colours: item.colours, seasons: item.seasons, locationId: item.locationId,
        brand: item.brand ?? '', notes: item.notes ?? '',
      });
      setViewId(undefined);
      setShowOriginal(false);
    }
  }, [item, form?.id, lang]);

  const brands = useMemo(() => usedBrands(active ?? []), [active]);

  if (item === undefined || photos === undefined) return <div className="screen screen--no-tabs" />;
  if (item === null || !form) {
    return (
      <div className="screen screen--no-tabs wd">
        <div className="header"><button type="button" className="back" onClick={() => goBack('/wardrobe')}><Icon name="back" size={20} strokeWidth={2} />{t('tab.wardrobe')}</button></div>
        <Empty icon="wardrobe">{t('wardrobe.item.notFound')}</Empty>
      </div>
    );
  }

  const isReview = item.status === 'review';
  const sug = item.suggestion;
  const ai = (f: 'name' | 'category' | 'colours' | 'seasons') => isReview && !!sug?.aiFields?.includes(f);
  const tryOn = photos.find((p) => p.id === item.tryOnPhotoId) ?? photos[0];
  const viewed: Photo | undefined = photos.find((p) => p.id === viewId) ?? tryOn;
  const viewingTryOn = viewed?.id === tryOn?.id;
  const reviewIndex = review?.findIndex((it) => it.id === item.id) ?? -1;
  const reviewCount = review?.length ?? 0;

  const set = (patch: Partial<Form>) => setForm((f) => {
    if (!f) return f;
    const next = { ...f, ...patch };
    if (next.nameAuto && ('category' in patch || 'colours' in patch)) next.name = autoName(lang, next.category, next.colours[0]);
    return next;
  });

  const topAi = sug?.categories?.[0]?.id;
  let catChips: CategoryId[] = (sug?.categories ?? []).map((c) => c.id).slice(0, 3);
  if (!catChips.length) catChips = [form.category];
  if (!catChips.includes(form.category)) catChips = [form.category, ...catChips.slice(0, 2)];
  const quickPlaces = places.filter((p) => p.id !== form.locationId).slice(0, 3);
  const placeName = places.find((p) => p.id === form.locationId)?.name;
  const brandHits = brands.filter((b) => b.toLocaleLowerCase().startsWith(form.brand.trim().toLocaleLowerCase()) && b.toLocaleLowerCase() !== form.brand.trim().toLocaleLowerCase()).slice(0, 4);
  const lastWorn = Math.max(item.lastWornAt ?? 0, wear?.[0] ? Date.parse(`${wear[0].date}T12:00`) : 0) || undefined;

  async function save() {
    if (!form || !item) return;
    setBusy(true);
    const next: Item = {
      ...item, name: form.name.trim() || autoName(lang, form.category, form.colours[0]), category: form.category,
      colours: form.colours, seasons: form.seasons, locationId: form.locationId,
      brand: form.brand.trim() || undefined, notes: form.notes.trim() || undefined,
      status: 'active', tryOnPhotoId: item.tryOnPhotoId ?? tryOn?.id,
    };
    await saveItem(next);
    if (isReview && tryOn && !tryOn.cutoutApproved) await setCutoutApproved(tryOn.id, true);
    setBusy(false);
    if (isReview) nextReview(review, item.id, '/wardrobe');
    else goBack('/wardrobe');
  }

  async function remove() {
    if (!item) return;
    await deleteItem(item.id);
    if (isReview) nextReview(review, item.id, '/review');
    else navigate('/wardrobe', { replace: true });
  }

  const [sameBefore, sameAfter] = t('wardrobe.item.same').split('{name}');

  return (
    <div className="screen screen--no-tabs wd wd-form">
      <div className="header wd-form__nav">
        <button type="button" className="back" onClick={() => goBack(isReview ? '/review' : '/wardrobe')}>
          <Icon name="back" size={20} strokeWidth={2} />{isReview ? t('wardrobe.item.backReview') : t('tab.wardrobe')}
        </button>
        {isReview && reviewCount > 1 && reviewIndex >= 0 && (
          <>
            <ReviewDots i={reviewIndex} n={reviewCount} label={t('wardrobe.item.position', { i: reviewIndex + 1, n: reviewCount })} />
            <button type="button" className="text-action wd-skip" onClick={() => {
              const next = review![(reviewIndex + 1) % reviewCount];
              navigate(`/item/${next.id}`, { replace: true });
            }}>{t('wardrobe.item.skip')}</button>
          </>
        )}
      </div>

      <div className="wd-form__body">
        {/* The cut-out, approved with "Looks good" or sent to Fix (D19). */}
        <section className="wd-paper wd-photo" aria-label={t('wardrobe.item.bgRemoved')}>
          <div className="wd-photo__well">
            {showOriginal ? <OriginalImg blob={viewed?.original} alt={t('wardrobe.item.original')} />
              : <CutoutImg blob={viewed?.cutout} alt={form.name} style={{ width: '76%', height: 192 }} />}
            <span className="wd-photo__badge">
              {showOriginal ? <><Icon name="gallery" size={15} />{t('wardrobe.item.original')}</> : <><Icon name="scissors" size={15} />{t('wardrobe.item.bgRemoved')}</>}
            </span>
            {viewed && (
              <button type="button" className="wd-photo__swap" aria-label={showOriginal ? t('wardrobe.item.showCutout') : t('wardrobe.item.showOriginal')}
                aria-pressed={showOriginal} onClick={() => setShowOriginal((v) => !v)}>
                {showOriginal ? <CutoutImg blob={viewed.thumb ?? viewed.cutout} alt="" style={{ width: 36, height: 30 }} /> : <OriginalImg blob={viewed.original} alt="" />}
              </button>
            )}
          </div>
          {viewingTryOn ? (
            <div className="wd-photo__row">
              <span className="wd-photo__q">{tryOn?.cutoutApproved ? t('wardrobe.item.cutoutOk') : t('wardrobe.item.cutoutQ')}</span>
              <a className="btn btn--secondary btn--sm wd-btn-sm" href={`#/item/${item.id}/fix`}><Icon name="brush" size={18} />{t('wardrobe.item.fix')}</a>
              <button type="button" className="btn btn--primary btn--sm wd-btn-sm" aria-pressed={!!tryOn?.cutoutApproved}
                onClick={() => tryOn && setCutoutApproved(tryOn.id, !tryOn.cutoutApproved)}>
                {tryOn?.cutoutApproved && <Icon name="check" size={18} strokeWidth={2.4} />}{t('wardrobe.item.looksGood')}
              </button>
            </div>
          ) : (
            <div className="wd-photo__row">
              <span className="grow" />
              <button type="button" className="btn btn--primary btn--sm wd-btn-sm" onClick={async () => {
                if (!viewed) return;
                await saveItem({ ...item, tryOnPhotoId: viewed.id });
                setViewId(undefined);
              }}><Icon name="dressup" size={18} />{t('wardrobe.item.useForTryOn')}</button>
            </div>
          )}
        </section>

        {photos.length > 1 && (
          <section className="stack gap-8" aria-label={t('wardrobe.item.photos')}>
            <span className="wd-label">{t('wardrobe.item.photos')}</span>
            <div className="wd-gallery">
              {photos.map((p, i) => (
                <button key={p.id} type="button" className="wd-gallery__cell" aria-pressed={p.id === viewed?.id}
                  aria-label={t('wardrobe.item.photoN', { n: i + 1 }) + (p.id === tryOn?.id ? `, ${t('wardrobe.item.tryOnTag')}` : '')}
                  onClick={() => { setViewId(p.id); setShowOriginal(false); }}>
                  <CutoutImg blob={p.thumb ?? p.cutout} alt="" style={{ width: 52, height: 48 }} />
                  {p.id === tryOn?.id && <span className="wd-gallery__on" aria-hidden="true"><Icon name="dressup" size={13} strokeWidth={2.2} /></span>}
                </button>
              ))}
            </div>
          </section>
        )}

        {/* Same-item hint (D9, D43). */}
        {sameItem && (
          <section className="wd-paper wd-same" aria-label={t('wardrobe.review.sameTag')}>
            <span className="wd-tape" aria-hidden="true" />
            <div className="row gap-12">
              <span className="wd-same__thumb"><CutoutImg blob={samePhoto?.thumb ?? samePhoto?.cutout} alt="" style={{ width: 56, height: 48 }} /></span>
              <p className="wd-same__text">{sameBefore}<b>{sameItem.name}</b>{sameAfter}</p>
            </div>
            <div className="row gap-8">
              <button type="button" className="btn btn--primary btn--sm grow wd-btn-sm" onClick={async () => {
                await mergeIntoExisting(item.id, sameItem.id);
                nextReview(review, item.id, `/item/${sameItem.id}`);
              }}>{t('wardrobe.item.sameYes')}</button>
              <button type="button" className="btn btn--secondary btn--sm grow wd-btn-sm" onClick={() => dismissSameItem(item)}>{t('wardrobe.item.sameNo')}</button>
            </div>
          </section>
        )}

        <section className="wd-paper wd-fields">
          {isReview && !!sug?.aiFields?.length && (
            <div className="wd-aihead"><Icon name="sparkle" size={14} />{t('wardrobe.item.aiFilled')}</div>
          )}

          <label className="wd-field">
            <span className="wd-label">{t('wardrobe.item.name')}{ai('name') && form.nameAuto && <AiMark />}</span>
            <input className="input wd-name" value={form.name} maxLength={60}
              onChange={(e) => setForm({ ...form, name: e.target.value, nameAuto: false })} />
          </label>

          <div className="wd-field" role="group" aria-label={t('wardrobe.item.category')}>
            <span className="wd-label">{t('wardrobe.item.category')} · <span className="wd-label__ink">{t(zoneKey(form.category))}</span></span>
            <div className="wd-chips">
              {catChips.map((c) => (
                <button key={c} type="button" className="wd-opt" aria-pressed={form.category === c} onClick={() => set({ category: c })}>
                  {ai('category') && c === topAi && <AiMark />}{t(`cat.${c}`)}
                </button>
              ))}
              <button type="button" className="wd-opt wd-opt--dashed" aria-haspopup="dialog" onClick={() => setSheet('category')}>{t('wardrobe.item.allCategories')}</button>
            </div>
          </div>

          <div className="wd-field" role="group" aria-label={t('wardrobe.item.colours')}>
            <span className="wd-label">{t('wardrobe.item.colours')}</span>
            <div className="wd-chips">
              {form.colours.map((c) => (
                <button key={c} type="button" className="wd-colour" aria-pressed="true" aria-label={t('wardrobe.item.removeColour', { colour: t(`colour.${c}`) })}
                  onClick={() => set({ colours: form.colours.filter((x) => x !== c) })}>
                  <Swatch colour={c} />{t(`colour.${c}`)}{ai('colours') && sug?.colours?.includes(c) && <AiMark />}
                </button>
              ))}
              <button type="button" className="wd-opt wd-opt--dashed" aria-haspopup="dialog" onClick={() => setSheet('colour')}>
                <Icon name="plus" size={15} strokeWidth={2} />{t('wardrobe.item.addColour')}
              </button>
            </div>
          </div>

          <div className="wd-field" role="group" aria-label={t('wardrobe.item.seasons')}>
            <span className="wd-label">{t('wardrobe.item.seasons')}{ai('seasons') && sameSet(form.seasons, sug?.seasons ?? []) && <AiMark />}</span>
            <div className="wd-seasons">
              {SEASONS.map((s) => (
                <button key={s} type="button" className="wd-opt" aria-pressed={form.seasons.includes(s)}
                  onClick={() => set({ seasons: form.seasons.includes(s) ? form.seasons.filter((x) => x !== s) : SEASONS.filter((x) => x === s || form.seasons.includes(x)) })}>
                  {t(`season.${s}`)}
                </button>
              ))}
            </div>
          </div>

          <div className="wd-field">
            <span className="wd-label" id="wd-place-label">{t('wardrobe.item.place')}</span>
            <button type="button" className="wd-placefield" aria-labelledby="wd-place-label wd-place-value" aria-haspopup="dialog" onClick={() => setSheet('place')}>
              <span id="wd-place-value" className={placeName ? 'wd-placefield__name' : 'wd-placefield__empty'}>
                <Icon name="pin" size={18} />{placeName ?? t('wardrobe.item.choosePlace')}
              </span>
              <Icon name="down" size={18} strokeWidth={2} />
            </button>
            <div className="wd-chips wd-chips--tight">
              {quickPlaces.map((p, i) => (
                <button key={p.id} type="button" className="wd-tagbtn wd-tagbtn--quiet" style={{ transform: `rotate(${tiltFor(i + 1) / 2}deg)` }}
                  onClick={() => set({ locationId: p.id })}>{p.name}</button>
              ))}
              <button type="button" className="wd-tagbtn wd-tagbtn--add" onClick={() => setSheet('newPlace')}>+ {t('wardrobe.item.newPlace')}</button>
            </div>
          </div>

          <div className="wd-field">
            <label className="wd-field">
              <span className="wd-label">{t('wardrobe.item.brand')}</span>
              <input className="wd-underline" value={form.brand} maxLength={40} placeholder={t('wardrobe.item.brandPh')} autoCapitalize="words"
                onChange={(e) => setForm({ ...form, brand: e.target.value })} />
            </label>
            {brandHits.length > 0 && (
              <div className="wd-chips wd-chips--tight" role="group" aria-label={t('wardrobe.item.brandUsed')}>
                {brandHits.map((b) => <button key={b} type="button" className="wd-opt wd-opt--soft" onClick={() => setForm({ ...form, brand: b })}>{b}</button>)}
              </div>
            )}
          </div>

          <label className="wd-field">
            <span className="wd-label">{t('wardrobe.item.notes')}</span>
            <textarea className="wd-notes" rows={2} value={form.notes} maxLength={500} placeholder={t('wardrobe.item.notesPh')}
              onChange={(e) => setForm({ ...form, notes: e.target.value })} />
          </label>
        </section>

        {!isReview && (
          <section className="wd-paper wd-wear" aria-label={t('wardrobe.item.wear')}>
            <div className="row gap-8">
              <h2 className="title-card grow">{t('wardrobe.item.wear')}</h2>
              <a className="text-action wd-fitlink" href={`#/fit/${item.id}`}><Icon name="fit" size={18} />{t('wardrobe.item.adjustFit')}</a>
            </div>
            {wear && wear.length > 0 ? (
              <>
                <p className="wd-muted">
                  {tn('wardrobe.item.wornTimes', wear.length)}{lastWorn ? `, ${t('wardrobe.item.lastWorn', { date: date(lastWorn, { day: 'numeric', month: 'short', year: 'numeric' }) })}` : ''}
                </p>
                <div className="wd-chips wd-chips--tight">
                  {wear.slice(0, 8).map((w) => <span key={w.id} className="wd-datechip num">{date(`${w.date}T12:00`)}</span>)}
                </div>
              </>
            ) : (
              <p className="wd-muted">{lastWorn ? t('wardrobe.item.lastWornOn', { date: date(lastWorn, { day: 'numeric', month: 'short', year: 'numeric' }) }) : t('wardrobe.item.neverWorn')}</p>
            )}
          </section>
        )}

        <div className="stack gap-8 wd-form__actions">
          <button type="button" className="btn btn--primary btn--block wd-btn-lg" disabled={busy} onClick={save}>
            {isReview ? t('wardrobe.item.saveNew') : t('wardrobe.item.saveEdit')}
          </button>
          <button type="button" className="text-action wd-delete" onClick={() => setSheet('delete')}>
            {isReview ? t('wardrobe.item.deletePhoto') : t('wardrobe.item.deleteItem')}
          </button>
        </div>
      </div>

      {sheet === 'category' && <CategorySheet value={form.category} onPick={(c) => set({ category: c })} onClose={() => setSheet(null)} />}
      {sheet === 'colour' && <ColourSheet value={form.colours} onChange={(colours) => set({ colours })} onClose={() => setSheet(null)} />}
      {(sheet === 'place' || sheet === 'newPlace') && (
        <PlaceSheet places={places} value={form.locationId} startNew={sheet === 'newPlace'} onPick={(id) => set({ locationId: id })} onClose={() => setSheet(null)} />
      )}
      {sheet === 'delete' && (
        <ConfirmSheet title={t('wardrobe.item.confirmDelete', { name: form.name || item.name })} body={t('wardrobe.item.confirmDeleteBody')}
          confirm={t('action.delete')} onConfirm={remove} onClose={() => setSheet(null)} />
      )}
    </div>
  );
}

/** The photo as taken, before the background was removed. */
function OriginalImg({ blob, alt }: { blob?: Blob; alt: string }) {
  const url = useBlobUrl(blob);
  if (!url) return null;
  return <img className="wd-original" src={url} alt={alt} draggable={false} />;
}

/** Where this photo is in the review pile, as dots (or a bar when the pile is long). */
function ReviewDots({ i, n, label }: { i: number; n: number; label: string }) {
  if (n > 8) {
    return <span className="wd-dots" role="img" aria-label={label}><span className="wd-dots__bar"><span style={{ width: `${((i + 1) / n) * 100}%` }} /></span></span>;
  }
  return (
    <span className="wd-dots" role="img" aria-label={label}>
      {Array.from({ length: n }, (_, k) => <span key={k} className={k === i ? 'wd-dot wd-dot--on' : k < i ? 'wd-dot wd-dot--past' : 'wd-dot'} />)}
    </span>
  );
}
