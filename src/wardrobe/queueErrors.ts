// Why a queue photo failed, and what the review inbox offers for it (bug-audit #16).
import type { QueueRow } from '../data/queueView';
import type { QueueError } from '../domain/types';

export type FailAction = 'retake' | 'models' | 'retry' | 'remove';
export interface FailureInfo { kind: QueueError; primary: FailAction }

const PRIMARY: Record<QueueError, FailAction> = {
  'no-garment': 'retake', models: 'models', network: 'retry', storage: 'retry', 'photo-lost': 'retake', unreadable: 'remove', other: 'retry',
};

/** Jobs stored before errorCode existed only have the error text. Storage and network come first: they aren't the photo's fault. */
function fromText(error = ''): QueueError {
  if (/indexed ?db|indexed database|quota|storage|disk/i.test(error)) return 'storage';
  if (/fetch|network|load failed|offline|connection/i.test(error)) return 'network';
  if (/decod|unsupported image|source image|InvalidStateError/i.test(error)) return 'unreadable';
  if (/WebKitBlobResource|NotReadableError|blob/i.test(error)) return 'photo-lost';
  if (/no garment/i.test(error)) return 'no-garment';
  if (/not (implemented|ready|downloaded)|model/i.test(error)) return 'models';
  return 'other';
}

export function failureInfo(row: Pick<QueueRow, 'errorCode' | 'error'>): FailureInfo {
  const kind = row.errorCode ?? fromText(row.error);
  return { kind, primary: PRIMARY[kind] };
}
