// "To review" inbox (F2, F3): photos the AI has processed, the ones still in the queue, and the ones that failed.
import { useLiveQuery } from 'dexie-react-hooks';
import '../styles/wardrobe.css';
import { goBack, navigate } from '../app/router';
import { db } from '../data/db';
import { removeJob, retryJob } from '../data/queue';
import { useReviewItems } from '../data/repo';
import type { Item, QueueJob } from '../domain/types';
import { useI18n } from '../i18n';
import { CutoutImg, Empty, ProgressBar } from '../ui/parts';
import { Icon } from '../ui/icons';
import { AiMark, usePhotos } from '../wardrobe/parts';

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
  const items = useReviewItems();
  const jobs = useLiveQuery(() => db.queue.orderBy('createdAt').toArray(), []);
  const sameIds = useLiveQuery(async () => {
    const ids = (items ?? []).map((it) => it.suggestion?.sameItemId).filter((x): x is string => !!x);
    const found = await db.items.bulkGet(ids);
    return new Set(found.filter((x) => x?.status === 'active').map((x) => x!.id));
  }, [items]);
  const photos = usePhotos((items ?? []).map((it) => it.tryOnPhotoId));
  const summary = useItemSummary();

  if (!items || !jobs) return <div className="screen" />;
  const pending = jobs.filter((j) => j.state === 'waiting' || j.state === 'working');
  const failed = jobs.filter((j) => j.state === 'failed');
  const finished = jobs.length - pending.length;
  const nothing = items.length === 0 && pending.length === 0 && failed.length === 0;

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
        {pending.length > 0 && (
          <section className="card wd-proc" aria-label={tn('wardrobe.review.processing', pending.length)}>
            <span className="wd-proc__stack" aria-hidden="true">
              <span /><span><Icon name="scissors" size={22} /></span>
            </span>
            <div className="grow stack gap-4">
              <span className="title-card wd-proc__title">{tn('wardrobe.review.processing', pending.length)}</span>
              <ProgressBar value={Math.max(0.06, jobs.length ? finished / jobs.length : 0)}
                label={t('wardrobe.review.progressLabel', { i: Math.min(finished + 1, jobs.length), n: jobs.length })} />
              <span className="meta">{t('wardrobe.review.keepOpen')}</span>
            </div>
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
            {failed.map((j) => <FailedRow key={j.id} job={j} />)}
          </ul>
        )}
      </div>
    </div>
  );
}

function FailedRow({ job }: { job: QueueJob }) {
  const { t } = useI18n();
  const notReady = /not (implemented|ready|downloaded)|model/i.test(job.error ?? '');
  return (
    <li className="wd-failrow">
      <span className="wd-thumb wd-thumb--fail" aria-hidden="true"><Icon name="warning" size={26} /></span>
      <span className="grow stack gap-8">
        <span className="stack wd-rowtext">
          <span className="wd-rowtitle">{notReady ? t('wardrobe.review.notReady') : t('wardrobe.review.failed')}</span>
          <span className="wd-rowmeta">{notReady ? t('wardrobe.review.notReadyHint') : t('wardrobe.review.failedHint')}</span>
        </span>
        <span className="row gap-8">
          <button type="button" className="btn btn--secondary btn--sm wd-btn-sm" onClick={async () => { await removeJob(job.id); navigate('/add'); }}>
            <Icon name="camera" size={18} />{t('wardrobe.review.retake')}
          </button>
          <button type="button" className="btn btn--secondary btn--sm wd-btn-sm" onClick={() => retryJob(job.id)}>
            <Icon name="rotate" size={18} />{t('wardrobe.review.retry')}
          </button>
        </span>
      </span>
    </li>
  );
}
