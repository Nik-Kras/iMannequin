// Item form (F3, F11): reviews a new photo the AI filled in, or edits a saved item.
import { useEffect, useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import '../styles/wardrobe.css';
import { goBack, navigate } from '../app/router';
import { db } from '../data/db';
import { deleteItem, saveItem, useActiveItems, useLocations, useReviewItems } from '../data/repo';
import { CATEGORY } from '../domain/taxonomy';
import { SEASONS, type CategoryId, type ColourName, type Item, type Lang, type Photo, type Season, type Zone } from '../domain/types';
import { useI18n, type Key } from '../i18n';
import { useAction } from '../ui/action';
import { CutoutImg, Empty, useBlobUrl } from '../ui/parts';
import { Icon } from '../ui/icons';
import { usedBrands } from '../wardrobe/filters';
import { autoName, lowerNoun } from '../wardrobe/naming';
import { dismissSameItem, mergeIntoExisting, setCutoutApproved } from '../wardrobe/ops';
import { AiMark, CategorySheet, ColourSheet, ConfirmSheet, PlaceSheet, Swatch, tiltFor } from '../wardrobe/parts';
import { clearDraft, lastReviewPlace, readDraft, recentPlaces, setLastReviewPlace, usedPlace, writeDraft } from '../wardrobe/session';

interface Form {
  id: string;
  name: string;
  /** The name still follows category and colour (D38) until the user types their own. */
  nameAuto: boolean;
  /** Undefined when the AI didn't recognise the garment: the user must choose (bug-audit #20). */
  category?: CategoryId;
  colours: ColourName[];
  seasons: Season[];
  locationId?: string;
  brand: string;
  notes: string;
  /** The place is the one given to the previous garment in the review pile, shown with ✦ (bug-audit #17). */
  placeSuggested?: boolean;
  placeOffered?: boolean;
  /** The user changed something: the form is kept as a draft and Back asks first (bug-audit #18). */
  touched?: boolean;
}

/** The AI found no category for a review photo (its suggestion recorded none). */
const unrecognised = (item: Item) => item.status === 'review' && !!item.suggestion && !item.suggestion.categories?.length;

function formOf(item: Item, lang: Lang): Form {
  return {
    // An unrecognised garment's name is a placeholder too: it follows the category the user picks.
    id: item.id, name: item.name, nameAuto: unrecognised(item) || item.name === autoName(lang, item.category, item.colours[0]),
    category: unrecognised(item) ? undefined : item.category, colours: item.colours, seasons: item.seasons, locationId: item.locationId,
    brand: item.brand ?? '', notes: item.notes ?? '',
  };
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
  const placeList = useLocations();
  const places = placeList ?? [];
  const sameId = item?.status === 'review' ? item.suggestion?.sameItemId : undefined;
  const sameItem = active?.find((it) => it.id === sameId);
  const samePhoto = useLiveQuery(async () => (sameItem?.tryOnPhotoId ? db.photos.get(sameItem.tryOnPhotoId) : undefined), [sameItem?.tryOnPhotoId]);

  const [form, setForm] = useState<Form>();
  const [viewId, setViewId] = useState<string>();
  const [showOriginal, setShowOriginal] = useState(false);
  const [sheet, setSheet] = useState<'category' | 'colour' | 'place' | 'newPlace' | 'delete' | 'discard' | null>(null);

  useEffect(() => {
    if (item && form?.id !== item.id) {
      // Unsaved edits come back after Back, the edge swipe, Fix or Adjust fit, or iOS reloading the page.
      setForm(readDraft<Form>(item.id) ?? formOf(item, lang));
      setViewId(undefined);
      setShowOriginal(false);
    }
  }, [item, form?.id, lang]);
  useEffect(() => { if (form?.touched) writeDraft(form.id, form); }, [form]);

  // Reviewing a pile: the place given to the previous garment is offered for this one, as a suggestion.
  useEffect(() => {
    if (!form || form.placeOffered || form.locationId || item?.status !== 'review' || !placeList) return;
    const last = lastReviewPlace();
    const ok = !!last && placeList.some((p) => p.id === last);
    setForm((f) => f && { ...f, placeOffered: true, ...(ok ? { locationId: last, placeSuggested: true } : {}) });
  }, [form, item?.status, placeList]);

  const saveFailed = { errorText: t('state.saveFailed'), retryLabel: t('action.retry') };
  const actionFailed = { errorText: t('state.actionFailed'), retryLabel: t('action.retry') };
  const saveAct = useAction('item.save', async () => {
    if (!form?.category || !item) return;
    const isReview = item.status === 'review';
    const tryOn = photos?.find((p) => p.id === item.tryOnPhotoId) ?? photos?.[0];
    const next: Item = {
      ...item, name: form.name.trim() || autoName(lang, form.category, form.colours[0]), category: form.category,
      colours: form.colours, seasons: form.seasons, locationId: form.locationId,
      brand: form.brand.trim() || undefined, notes: form.notes.trim() || undefined,
      status: 'active', tryOnPhotoId: item.tryOnPhotoId ?? tryOn?.id,
    };
    await saveItem(next);
    // Saving approves the cut-out: "Looks good" is optional.
    if (isReview && tryOn && !tryOn.cutoutApproved) await setCutoutApproved(tryOn.id, true);
    clearDraft(item.id);
    if (form.locationId) usedPlace(form.locationId);
    if (isReview) {
      setLastReviewPlace(form.locationId);
      nextReview(review, item.id, '/wardrobe');
    } else goBack('/wardrobe');
  }, saveFailed);
  const approve = useAction('item.approve', (photoId: string, on: boolean) => setCutoutApproved(photoId, on), actionFailed);
  const useForTryOn = useAction('item.tryOn', async (it: Item, photoId: string) => {
    await saveItem({ ...it, tryOnPhotoId: photoId });
    setViewId(undefined);
  }, saveFailed);
  const merge = useAction('item.merge', async (reviewId: string, existingId: string) => {
    await mergeIntoExisting(reviewId, existingId);
    clearDraft(reviewId);
    nextReview(review, reviewId, `/item/${existingId}`);
  }, actionFailed);
  const notSame = useAction('item.notSame', (it: Item) => dismissSameItem(it), actionFailed);
  const remove = useAction('item.delete', async (it: Item) => {
    await deleteItem(it.id);
    clearDraft(it.id);
    if (it.status === 'review') nextReview(review, it.id, '/review');
    else navigate('/wardrobe', { replace: true });
  }, actionFailed);

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
    const next = { ...f, ...patch, touched: true };
    if ('locationId' in patch) next.placeSuggested = false;
    if (next.nameAuto && next.category && ('category' in patch || 'colours' in patch)) next.name = autoName(lang, next.category, next.colours[0]);
    return next;
  });
  const leave = () => { clearDraft(item.id); goBack(isReview ? '/review' : '/wardrobe'); };

  const topAi = sug?.categories?.[0]?.id;
  let catChips: CategoryId[] = (sug?.categories ?? []).map((c) => c.id).slice(0, 3);
  if (form.category && !catChips.includes(form.category)) catChips = [form.category, ...catChips.slice(0, 2)];
  // Places used in this session come first (bug-audit #17).
  const recent = recentPlaces();
  const byUse = [...places].sort((a, b) => (recent.indexOf(a.id) + 1 || 99) - (recent.indexOf(b.id) + 1 || 99));
  const quickPlaces = byUse.filter((p) => p.id !== form.locationId).slice(0, 3);
  const placeName = places.find((p) => p.id === form.locationId)?.name;
  const brandHits = brands.filter((b) => b.toLocaleLowerCase().startsWith(form.brand.trim().toLocaleLowerCase()) && b.toLocaleLowerCase() !== form.brand.trim().toLocaleLowerCase()).slice(0, 4);
  const lastWorn = Math.max(item.lastWornAt ?? 0, wear?.[0] ? Date.parse(`${wear[0].date}T12:00`) : 0) || undefined;

  const [sameBefore, sameAfter] = t('wardrobe.item.same').split('{name}');
  // "Looks like your olive skirt": an automatic name reads as a description (bug-audit #50).
  const sameName = sameItem && (sameItem.name === autoName(lang, sameItem.category, sameItem.colours[0]) ? lowerNoun(sameItem.name) : sameItem.name);
  const saveLabel = !isReview ? t('wardrobe.item.saveEdit')
    : reviewCount > 1 && reviewIndex >= 0 ? t('wardrobe.item.saveNext', { i: reviewIndex + 1, n: reviewCount }) : t('wardrobe.item.saveNew');

  return (
    <div className="screen screen--no-tabs wd wd-form">
      <h1 className="sr-only">{form.name || item.name}</h1>
      <div className="header wd-form__nav">
        <button type="button" className="back" onClick={() => (form.touched ? setSheet('discard') : leave())}>
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
              {/* A quiet tick that also shows the approval: Save approves the cut-out anyway (bug-audit #17). */}
              <button type="button" className="text-action wd-tick" aria-pressed={!!tryOn?.cutoutApproved} disabled={!tryOn || approve.busy}
                onClick={() => tryOn && void approve.run(tryOn.id, !tryOn.cutoutApproved)}>
                <span className="wd-tick__box" aria-hidden="true">{tryOn?.cutoutApproved && <Icon name="check" size={15} strokeWidth={2.8} />}</span>
                {t('wardrobe.item.looksGood')}
              </button>
              <a className="btn btn--secondary btn--sm wd-btn-sm" href={`#/item/${item.id}/fix?from=item`}><Icon name="brush" size={18} />{t('wardrobe.item.fix')}</a>
            </div>
          ) : (
            <div className="wd-photo__row">
              <span className="grow" />
              <button type="button" className="btn btn--secondary btn--sm wd-btn-sm" disabled={useForTryOn.busy}
                onClick={() => viewed && void useForTryOn.run(item, viewed.id)}><Icon name="dressup" size={18} />{t('wardrobe.item.useForTryOn')}</button>
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
              <p className="wd-same__text">{sameBefore}<b>{sameName}</b>{sameAfter}</p>
            </div>
            <div className="row gap-8">
              <button type="button" className="btn btn--secondary btn--sm grow wd-btn-sm" disabled={merge.busy}
                onClick={() => void merge.run(item.id, sameItem.id)}>{t('wardrobe.item.sameYes')}</button>
              <button type="button" className="btn btn--secondary btn--sm grow wd-btn-sm" disabled={notSame.busy}
                onClick={() => void notSame.run(item)}>{t('wardrobe.item.sameNo')}</button>
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
              onChange={(e) => set({ name: e.target.value, nameAuto: false })} />
          </label>

          <div className="wd-field" role="group" aria-label={t('wardrobe.item.category')}>
            <span className="wd-label">{t('wardrobe.item.category')}{form.category && <> · <span className="wd-label__ink">{t(zoneKey(form.category))}</span></>}</span>
            {!form.category && <p className="wd-note wd-note--ink">{t('wardrobe.item.noCategory')}</p>}
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
                <button key={c} type="button" className="wd-colour wd-colour--on"
                  aria-label={t(ai('colours') && sug?.colours?.includes(c) ? 'wardrobe.item.removeColourAi' : 'wardrobe.item.removeColour', { colour: t(`colour.${c}`) })}
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
                <Icon name="pin" size={18} />{placeName ?? t('wardrobe.item.choosePlace')}{placeName && form.placeSuggested && <AiMark />}
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
                onChange={(e) => set({ brand: e.target.value })} />
            </label>
            {brandHits.length > 0 && (
              <div className="wd-chips wd-chips--tight" role="group" aria-label={t('wardrobe.item.brandUsed')}>
                {brandHits.map((b) => <button key={b} type="button" className="wd-opt wd-opt--soft" onClick={() => set({ brand: b })}>{b}</button>)}
              </div>
            )}
          </div>

          <label className="wd-field">
            <span className="wd-label">{t('wardrobe.item.notes')}</span>
            <textarea className="wd-notes" rows={2} value={form.notes} maxLength={500} placeholder={t('wardrobe.item.notesPh')}
              onChange={(e) => set({ notes: e.target.value })} />
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
              <p className="wd-muted">{lastWorn ? oneStop(t('wardrobe.item.lastWornOn', { date: date(lastWorn, { day: 'numeric', month: 'short', year: 'numeric' }) })) : t('wardrobe.item.neverWorn')}</p>
            )}
          </section>
        )}

        <div className="stack gap-8 wd-form__actions">
          <button type="button" className="text-action wd-delete" onClick={() => setSheet('delete')}>
            {isReview ? t('wardrobe.item.deletePhoto') : t('wardrobe.item.deleteItem')}
          </button>
        </div>
      </div>

      {/* Always in reach: the next garment is one tap away (bug-audit #17). */}
      <div className="wd-form__foot">
        <button type="button" className="btn btn--primary btn--block wd-btn-lg" disabled={saveAct.busy || !form.category} onClick={() => void saveAct.run()}>
          {saveLabel}
        </button>
      </div>

      {sheet === 'category' && <CategorySheet value={form.category} onPick={(c) => set({ category: c })} onClose={() => setSheet(null)} />}
      {sheet === 'colour' && <ColourSheet value={form.colours} onChange={(colours) => set({ colours })} onClose={() => setSheet(null)} />}
      {(sheet === 'place' || sheet === 'newPlace') && (
        <PlaceSheet places={places} value={form.locationId} startNew={sheet === 'newPlace'} onPick={(id) => set({ locationId: id })} onClose={() => setSheet(null)} />
      )}
      {sheet === 'delete' && (
        <ConfirmSheet title={t('wardrobe.item.confirmDelete', { name: form.name || item.name })} body={t('wardrobe.item.confirmDeleteBody')}
          confirm={t('action.delete')} onConfirm={() => void remove.run(item)} onClose={() => setSheet(null)} />
      )}
      {sheet === 'discard' && (
        <ConfirmSheet title={t('wardrobe.item.discardTitle')} body={t('wardrobe.item.discardBody')}
          confirm={t('wardrobe.item.discard')} onConfirm={leave} onClose={() => setSheet(null)} />
      )}
    </div>
  );
}

/** "…12 жовт. 2026 р.." → a single full stop after a date that ends with an abbreviation. */
const oneStop = (s: string) => s.replace(/\.\.$/, '.');

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
