// "To review" inbox (F2, F3): photos the AI has processed, the ones still in the queue, and the ones that failed.
import { useEffect, useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import '../styles/wardrobe.css';
import { goBack, navigate, useRoute } from '../app/router';
import { db } from '../data/db';
import { removeJob, retryJob } from '../data/queue';
import { useQueueView, type QueueRow } from '../data/queueView';
import { useReviewItems } from '../data/repo';
import type { Item, QueueError } from '../domain/types';
import { useI18n, type Key } from '../i18n';
import { useAction } from '../ui/action';
import { CutoutImg, Empty } from '../ui/parts';
import { Icon } from '../ui/icons';
import { AiMark, ConfirmSheet, QueuePhoto, usePhotos } from '../wardrobe/parts';
import { failureInfo, type FailAction } from '../wardrobe/queueErrors';

/** "Rust · Autumn, Winter": colours, then seasons ("All year" for all four). */
function useItemSummary() {
  const { t } = useI18n();
  return (it: Item) => {
    const colours = it.colours.map((c) => t(`colour.${c}`)).join(', ');
    const seasons = it.seasons.length === 4 ? t('wardrobe.review.allYear') : it.seasons.map((s) => t(`season.${s}`)).join(', ');
    return [colours, seasons].filter(Boolean).join(' · ');
  };
}

export default function ReviewInbox() {
  const { t, tn } = useI18n();
  const route = useRoute();
  const items = useReviewItems();
  const jobs = useQueueView();
  const sameIds = useLiveQuery(async () => {
    const ids = (items ?? []).map((it) => it.suggestion?.sameItemId).filter((x): x is string => !!x);
    const found = await db.items.bulkGet(ids);
    return new Set(found.filter((x) => x?.status === 'active').map((x) => x!.id));
  }, [items]);
  const photos = usePhotos((items ?? []).map((it) => it.tryOnPhotoId));
  const summary = useItemSummary();
  const [retake, setRetake] = useState<string | null>(null);
  const act = useAction('review.job', async (what: FailAction, id: string) => {
    if (what === 'retry') await retryJob(id);
    else await removeJob(id);
    if (what === 'retake') navigate('/add');
  }, { errorText: t('state.actionFailed'), retryLabel: t('action.retry') });

  if (!items || !jobs) return <div className="screen" />;
  const pending = jobs.filter((j) => j.state === 'waiting' || j.state === 'working');
  const failed = jobs.filter((j) => j.state === 'failed');
  const nothing = items.length === 0 && pending.length === 0 && failed.length === 0;
  const pendingLabel = tn('wardrobe.review.processing', pending.length);

  return (
    <div className="screen wd">
      <div className="header">
        <button type="button" className="back" onClick={() => goBack('/wardrobe')}><Icon name="back" size={20} strokeWidth={2} />{t('tab.wardrobe')}</button>
      </div>
      <div className="pad stack gap-4 wd-head">
        <h1 className="h1">{t('wardrobe.review.title')}</h1>
        {items.length > 0 && <p className="wd-sub">{tn('wardrobe.review.ready', items.length)}</p>}
      </div>

      <div className="stack gap-12 wd-col">
        {/* Each photo still in the queue, with its own state (bug-audit #16). */}
        {pending.length > 0 && (
          <section className="card wd-proc">
            <span className="title-card wd-proc__title" aria-hidden="true">{pendingLabel}</span>
            <ul className="wd-pending" aria-label={pendingLabel}>
              {pending.map((j) => <li key={j.id} className={`wd-jobthumb wd-jobthumb--${j.state}`}><QueuePhoto row={j} /></li>)}
            </ul>
            <span className="meta">{t('wardrobe.review.keepOpen')}</span>
          </section>
        )}

        {nothing ? (
          <Empty icon="check" action={<button type="button" className="btn btn--primary" onClick={() => navigate('/add')}><Icon name="camera" size={20} />{t('tab.add')}</button>}>
            {t('wardrobe.review.empty')}
          </Empty>
        ) : (items.length > 0 || failed.length > 0) && (
          <ul className="card wd-rows" aria-label={t('wardrobe.review.listLabel')}>
            {items.map((it) => {
              const p = it.tryOnPhotoId ? photos.get(it.tryOnPhotoId) : undefined;
              const same = !!it.suggestion?.sameItemId && sameIds?.has(it.suggestion.sameItemId);
              return (
                <li key={it.id}>
                  <a className="wd-rowlink" href={`#/item/${it.id}`}>
                    <span className="wd-thumb"><CutoutImg blob={p?.thumb ?? p?.cutout} alt="" style={{ width: 48, height: 44 }} /></span>
                    <span className="grow stack wd-rowtext">
                      <span className="wd-rowtitle">{it.name}{!!it.suggestion?.aiFields?.length && <AiMark />}</span>
                      <span className="wd-rowmeta">{summary(it)}</span>
                      {same && <span className="wd-minitag">{t('wardrobe.review.sameTag')}</span>}
                    </span>
                    <Icon name="chevron" size={20} strokeWidth={2} />
                  </a>
                </li>
              );
            })}
            {failed.map((j) => (
              <FailedRow key={j.id} job={j} target={route.query.get('job') === j.id} busy={act.busy}
                onAction={(what) => (what === 'retake' ? setRetake(j.id) : what === 'models' ? navigate('/models') : void act.run(what, j.id))} />
            ))}
          </ul>
        )}
      </div>

      {retake && (
        <ConfirmSheet title={t('wardrobe.review.retakeTitle')} confirm={t('wardrobe.review.retake')}
          onConfirm={() => void act.run('retake', retake)} onClose={() => setRetake(null)} />
      )}
    </div>
  );
}

const FAIL_TEXT: Record<QueueError, [Key, Key]> = {
  'no-garment': ['wardrobe.review.failed', 'wardrobe.review.failedHint'],
  models: ['wardrobe.review.notReady', 'wardrobe.review.notReadyHint'],
  network: ['wardrobe.review.failNetwork', 'wardrobe.review.failNetworkHint'],
  storage: ['wardrobe.review.failStorage', 'wardrobe.review.failStorageHint'],
  'photo-lost': ['wardrobe.review.failLost', 'wardrobe.review.failLostHint'],
  unreadable: ['wardrobe.review.failUnreadable', 'wardrobe.review.failUnreadableHint'],
  other: ['wardrobe.review.failOther', 'wardrobe.review.failOtherHint'],
};

/** A photo that didn't make it: the photo itself, why, and what to do about it (bug-audit #16). */
function FailedRow({ job, target, busy, onAction }: { job: QueueRow; target: boolean; busy: boolean; onAction: (what: FailAction) => void }) {
  const { t } = useI18n();
  const { kind, primary } = failureInfo(job);
  const [title, hint] = FAIL_TEXT[kind];
  const ref = useRef<HTMLLIElement>(null);
  // Opened from its thumbnail in the camera strip: bring the row into view.
  useEffect(() => { if (target) ref.current?.scrollIntoView({ block: 'center' }); }, [target]);
  const secondary: FailAction | null = primary === 'models' ? 'retry' : primary === 'remove' ? null : 'remove';
  const label: Record<FailAction, Key> = { retake: 'wardrobe.review.retake', models: 'wardrobe.review.downloadModels', retry: 'wardrobe.review.retry', remove: 'wardrobe.review.remove' };
  const icon = { retake: 'camera', models: 'download', retry: 'rotate', remove: 'trash' } as const;
  return (
    <li ref={ref} className={`wd-failrow${target ? ' wd-failrow--target' : ''}`}>
      <span className="wd-thumb wd-jobthumb wd-jobthumb--failed"><QueuePhoto row={job} /></span>
      <span className="grow stack gap-8">
        <span className="stack wd-rowtext">
          <span className="wd-rowtitle">{t(title)}</span>
          <span className="wd-rowmeta">{t(hint)}</span>
        </span>
        <span className="row gap-8 wd-failrow__actions">
          <button type="button" className="btn btn--secondary btn--sm wd-btn-sm" disabled={busy} onClick={() => onAction(primary)}>
            <Icon name={icon[primary]} size={18} />{t(label[primary])}
          </button>
          {secondary && <button type="button" className="text-action" disabled={busy} onClick={() => onAction(secondary)}>{t(label[secondary])}</button>}
        </span>
      </span>
    </li>
  );
}
