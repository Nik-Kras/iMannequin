// Places (F10, D22): where clothes are kept. Add, rename, reorder, delete; entry to the seasonal swap.
import { useMemo, useState } from 'react';
import '../styles/wardrobe.css';
import { goBack } from '../app/router';
import { useActiveItems, useLocations } from '../data/repo';
import type { Item, Location } from '../domain/types';
import { useI18n } from '../i18n';
import { CutoutImg } from '../ui/parts';
import { Icon } from '../ui/icons';
import { deletePlace, movePlace, renamePlace } from '../wardrobe/ops';
import { ConfirmSheet, NewPlaceForm, PlaceTag, TitledSheet, tiltFor, usePhotos, XIcon } from '../wardrobe/parts';

export default function Places() {
  const { t, tn } = useI18n();
  const places = useLocations();
  const items = useActiveItems();
  const [editing, setEditing] = useState(false);
  const [sheet, setSheet] = useState<{ kind: 'add' } | { kind: 'edit'; place: Location } | { kind: 'delete'; place: Location } | null>(null);

  const byPlace = useMemo(() => {
    const m = new Map<string, Item[]>();
    for (const it of items ?? []) {
      const k = it.locationId ?? '';
      m.set(k, [...(m.get(k) ?? []), it]);
    }
    for (const list of m.values()) list.sort((a, b) => b.updatedAt - a.updatedAt);
    return m;
  }, [items]);
  const thumbIds = [...byPlace.values()].flatMap((l) => l.slice(0, 3).map((it) => it.tryOnPhotoId));
  const photos = usePhotos(thumbIds);

  if (!places || !items) return <div className="screen screen--no-tabs" />;
  const known = new Set(places.map((p) => p.id));
  const unplaced = items.filter((it) => !it.locationId || !known.has(it.locationId));
  const total = items.length;

  const thumbs = (list: Item[]) => (
    <span className="wd-placerow__thumbs" aria-hidden="true">
      {list.slice(0, 3).map((it) => {
        const p = it.tryOnPhotoId ? photos.get(it.tryOnPhotoId) : undefined;
        return <CutoutImg key={it.id} blob={p?.thumb ?? p?.cutout} alt="" style={{ width: 38, height: 40 }} />;
      })}
    </span>
  );

  return (
    <div className="screen screen--no-tabs wd">
      <div className="header">
        <button type="button" className="back" onClick={() => goBack('/settings')}><Icon name="back" size={20} strokeWidth={2} />{t('action.settings')}</button>
        {places.length > 0 && (
          <button type="button" className="text-action" aria-pressed={editing} onClick={() => setEditing((v) => !v)}>
            {editing ? t('action.done') : t('wardrobe.places.edit')}
          </button>
        )}
      </div>
      <div className="pad wd-titlerow wd-head">
        <h1 className="h1">{t('wardrobe.places.title')}</h1>
        <span className="wd-count">{tn('wardrobe.places.count', places.length)} · {tn('count.items', total)}</span>
      </div>

      <div className="wd-col stack gap-10">
        <a className="wd-swapcard" href="#/season-swap">
          <span className="grow stack gap-4">
            <span className="wd-swapcard__title">{t('wardrobe.places.swap')}</span>
            <span className="wd-swapcard__sub">{t('wardrobe.places.swapSub')}</span>
          </span>
          <XIcon name="arrowRight" size={22} strokeWidth={2} />
        </a>

        {places.length === 0 && <p className="wd-note pad">{t('wardrobe.places.empty')}</p>}

        <ul className="wd-places">
          {places.map((p, i) => {
            const list = byPlace.get(p.id) ?? [];
            const label = tn('count.items', list.length);
            return (
              <li key={p.id}>
                {editing ? (
                  <div className="card wd-placerow">
                    <span className="grow stack gap-4 wd-placerow__text">
                      <PlaceTag name={p.name} tilt={tiltFor(i) * 1.4} />
                      <span className="meta">{label}</span>
                    </span>
                    <button type="button" className="icon-btn icon-btn--tissue" aria-label={t('wardrobe.places.up', { name: p.name })} disabled={i === 0} onClick={() => movePlace(p.id, -1)}><XIcon name="up" /></button>
                    <button type="button" className="icon-btn icon-btn--tissue" aria-label={t('wardrobe.places.down', { name: p.name })} disabled={i === places.length - 1} onClick={() => movePlace(p.id, 1)}><XIcon name="down" /></button>
                    <button type="button" className="icon-btn icon-btn--tissue" aria-label={t('wardrobe.places.editPlace', { name: p.name })} onClick={() => setSheet({ kind: 'edit', place: p })}><XIcon name="pencil" /></button>
                  </div>
                ) : (
                  <a className="card wd-placerow" href={`#/wardrobe?place=${p.id}`}>
                    <span className="grow stack gap-4 wd-placerow__text">
                      <PlaceTag name={p.name} tilt={tiltFor(i) * 1.4} />
                      <span className="meta">{label}</span>
                    </span>
                    {thumbs(list)}
                    <Icon name="chevron" size={18} strokeWidth={2} />
                  </a>
                )}
              </li>
            );
          })}
          {!editing && unplaced.length > 0 && (
            <li>
              <a className="card wd-placerow wd-placerow--none" href="#/wardrobe?place=none">
                <span className="grow stack gap-4 wd-placerow__text">
                  <span className="row-text">{t('wardrobe.places.none')}</span>
                  <span className="meta">{tn('count.items', unplaced.length)}</span>
                </span>
                {thumbs(unplaced)}
                <Icon name="chevron" size={18} strokeWidth={2} />
              </a>
            </li>
          )}
        </ul>

        <button type="button" className="wd-add-dashed" onClick={() => setSheet({ kind: 'add' })}>
          <Icon name="plus" size={20} strokeWidth={2} />{t('wardrobe.places.add')}
        </button>
      </div>

      {sheet?.kind === 'add' && (
        <TitledSheet title={t('wardrobe.places.add')} onClose={() => setSheet(null)}>
          <NewPlaceForm onDone={() => setSheet(null)} />
        </TitledSheet>
      )}
      {sheet?.kind === 'edit' && (
        <TitledSheet title={sheet.place.name} onClose={() => setSheet(null)}>
          <NewPlaceForm initial={sheet.place.name} submitLabel={t('wardrobe.places.rename')}
            onDone={async (_id, name) => { if (name) await renamePlace(sheet.place.id, name); setSheet(null); }} />
          <button type="button" className="btn btn--danger btn--block" onClick={() => setSheet({ kind: 'delete', place: sheet.place })}>
            <Icon name="trash" size={20} />{t('wardrobe.places.delete')}
          </button>
        </TitledSheet>
      )}
      {sheet?.kind === 'delete' && (() => {
        const n = byPlace.get(sheet.place.id)?.length ?? 0;
        return (
          <ConfirmSheet title={t('wardrobe.places.confirmDelete', { name: sheet.place.name })}
            body={n ? tn('wardrobe.places.deleteHint', n) : t('wardrobe.places.deleteEmpty')}
            confirm={t('action.delete')} onConfirm={() => deletePlace(sheet.place.id)} onClose={() => setSheet(null)} />
        );
      })()}
    </div>
  );
}
