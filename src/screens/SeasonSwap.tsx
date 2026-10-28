// Seasonal swap (F10): put a season's clothes away into one place, in one go.
import { useMemo, useState } from 'react';
import '../styles/wardrobe.css';
import { goBack } from '../app/router';
import { useActiveItems, useLocations } from '../data/repo';
import { SEASONS, type Season } from '../domain/types';
import { useI18n } from '../i18n';
import { useAction } from '../ui/action';
import { CutoutImg, Empty, Toast } from '../ui/parts';
import { Icon } from '../ui/icons';
import { moveItems } from '../wardrobe/ops';
import { tiltFor, usePhotos, XIcon } from '../wardrobe/parts';
import { defaultPutAway, nextSeason, preselect, selection, swapCandidates } from '../wardrobe/seasonSwap';

export default function SeasonSwap() {
  const { t, tn } = useI18n();
  const items = useActiveItems();
  const places = useLocations();
  const [season, setSeason] = useState<Season>(() => defaultPutAway());
  const [dest, setDest] = useState<string>();
  const [overrides, setOverrides] = useState<Record<string, boolean>>({});
  const [toast, setToast] = useState<string>();
  const move = useAction('swap.move', async (ids: string[], to: string, place: string) => {
    await moveItems(ids, to);
    setOverrides({});
    setToast(tn('wardrobe.swap.moved', ids.length, { place }));
  }, { errorText: t('state.saveFailed'), retryLabel: t('action.retry') });

  const order = useMemo(() => (places ?? []).map((p) => p.id), [places]);
  const candidates = useMemo(() => swapCandidates(items ?? [], season, order), [items, season, order]);
  const pre = useMemo(() => preselect(items ?? [], season, dest), [items, season, dest]);
  const selected = selection(pre, overrides, candidates);
  const photos = usePhotos(candidates.map((it) => it.tryOnPhotoId));

  if (!items || !places) return <div className="screen screen--no-tabs" />;
  const placeName = (id?: string) => places.find((p) => p.id === id)?.name;
  const destName = placeName(dest);
  const n = selected.length;
  const setAll = (v: boolean) => setOverrides(Object.fromEntries(candidates.map((it) => [it.id, v])));

  return (
    <div className="screen screen--no-tabs wd wd-swap">
      <div className="header">
        <button type="button" className="back" onClick={() => goBack('/places')}><Icon name="back" size={20} strokeWidth={2} />{t('wardrobe.places.title')}</button>
      </div>
      <div className="pad stack gap-4 wd-head">
        <h1 className="h1">{t('wardrobe.swap.title')}</h1>
        <p className="wd-sub">{t('wardrobe.swap.sub')}</p>
      </div>

      <section className="card card--pad wd-swapbox">
        <h2 className="wd-boxtitle">{t('wardrobe.swap.putAway')}</h2>
        <div className="wd-seasonseg" role="group" aria-label={t('wardrobe.swap.seasonLabel')}>
          {SEASONS.map((s) => (
            <button key={s} type="button" aria-pressed={season === s} onClick={() => { setSeason(s); setOverrides({}); }}>{t(`season.${s}`)}</button>
          ))}
        </div>
        <h2 className="wd-boxtitle">{t('wardrobe.swap.into')}</h2>
        {places.length ? (
          <div className="wd-chips wd-chips--tags" role="group" aria-label={t('wardrobe.swap.destLabel')}>
            {places.map((p, i) => (
              <button key={p.id} type="button" className="wd-tagbtn" aria-pressed={dest === p.id} style={{ transform: `rotate(${tiltFor(i) * 1.4}deg)` }}
                onClick={() => { setDest(p.id); setOverrides({}); }}>{p.name}</button>
            ))}
          </div>
        ) : <p className="wd-note">{t('wardrobe.swap.noPlaces')}</p>}
      </section>

      {candidates.length === 0 ? (
        <Empty icon="calendar">{t('wardrobe.swap.empty', { season: t(`season.${season}`).toLocaleLowerCase() })}</Empty>
      ) : (
        <>
          <div className="wd-selbar">
            <span className="wd-selbar__n" aria-live="polite">{t('wardrobe.swap.selected', { n, total: candidates.length })}</span>
            <button type="button" className="text-action" onClick={() => setAll(true)}>{t('wardrobe.swap.selectAll')}</button>
            <button type="button" className="text-action" onClick={() => setAll(false)}>{t('wardrobe.swap.clear')}</button>
          </div>
          <p className="wd-note pad wd-leftout">{t('wardrobe.swap.leftOut', { season: t(`wardrobe.swap.in.${nextSeason(season)}`) })}</p>
          <ul className="wd-swapgrid">
            {candidates.map((it) => {
              const on = selected.includes(it.id);
              const p = it.tryOnPhotoId ? photos.get(it.tryOnPhotoId) : undefined;
              return (
                <li key={it.id}>
                  <button type="button" className="wd-swapcard-item" aria-pressed={on} onClick={() => setOverrides((o) => ({ ...o, [it.id]: !on }))}>
                    <CutoutImg blob={p?.thumb ?? p?.cutout} alt="" style={{ width: '100%', height: 62 }} />
                    <span className="wd-card__name">{it.name}</span>
                    {placeName(it.locationId) && <span className="wd-card__place">{placeName(it.locationId)}</span>}
                    <span className="wd-check" aria-hidden="true">{on && <Icon name="check" size={14} strokeWidth={3} />}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </>
      )}

      <section className="wd-movebar" aria-label={t('wardrobe.swap.title')}>
        <button type="button" className="btn btn--primary btn--block wd-btn-lg" disabled={!n || !dest || !destName || move.busy}
          onClick={() => dest && destName && void move.run(selected, dest, destName)}>
          <XIcon name="box" size={20} />
          <span className="wd-ellipsis">{!n ? t('wardrobe.swap.choose') : !destName ? t('wardrobe.swap.choosePlace') : tn('wardrobe.swap.move', n, { place: destName })}</span>
        </button>
      </section>
      {toast && <Toast className="toast--above-bar" onDone={() => setToast(undefined)}>{toast}</Toast>}
    </div>
  );
}
