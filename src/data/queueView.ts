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
  /** A small preview of the photo when there is one, otherwise the photo itself. */
  image?: Blob;
}

export function useQueueView(): QueueRow[] | undefined {
  return useLiveQuery(async () => {
    const jobs = await db.queue.orderBy('createdAt').toArray();
    return jobs.map(({ blob, ...j }) => ({ ...j, image: blob }));
  }, []);
}
