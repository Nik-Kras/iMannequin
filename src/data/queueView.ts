// What the queue UI shows for each job (Add clothes strip, review inbox). The data module may change how
// photo bytes are stored; screens read jobs only through this hook.
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from './db';
import type { QueueError, QueueState } from '../domain/types';

export interface QueueRow {
  id: string;
  state: QueueState;
  error?: string;
  errorCode?: QueueError;
  itemId?: string;
  createdAt: number;
  /** A small preview of the photo when there is one, otherwise the photo itself; a finished job shows its item. */
  image?: Blob;
}

export function useQueueView(): QueueRow[] | undefined {
  return useLiveQuery(async () => {
    const jobs = await db.queue.orderBy('createdAt').toArray();
    const photos = await db.queuePhotos.bulkGet(jobs.map((j) => j.id));
    // A finished job's photo has moved to its item: show the item's thumbnail.
    const doneIds = jobs.filter((j) => j.state === 'done' && j.itemId).map((j) => j.itemId!);
    const items = (doneIds.length ? await db.items.bulkGet(doneIds) : []).filter((it) => it?.tryOnPhotoId);
    const thumbs = items.length ? await db.photos.bulkGet(items.map((it) => it!.tryOnPhotoId!)) : [];
    const done = new Map<string, Blob>();
    items.forEach((it, i) => {
      const blob = thumbs[i]?.thumb ?? thumbs[i]?.cutout;
      if (blob) done.set(it!.id, blob);
    });
    return jobs.map((j, i): QueueRow => ({
      id: j.id, state: j.state, error: j.error, errorCode: j.errorCode, itemId: j.itemId, createdAt: j.createdAt,
      image: photos[i]?.preview ?? photos[i]?.blob ?? j.blob ?? (j.itemId ? done.get(j.itemId) : undefined),
    }));
  }, []);
}
