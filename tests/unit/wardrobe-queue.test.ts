import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '../../src/data/db';
import {
  _resetRunnerForTests, enqueuePhotos, processNextJob, resumeQueue, retryJob, startQueueRunner, type QueueDeps,
} from '../../src/data/queue';

// Synthetic stand-ins for photos (R2): plain blobs, no images of real clothes.
const photo = (tag: string) => new Blob([tag], { type: 'image/jpeg' });
const png = (tag: string) => new Blob([`cut:${tag}`], { type: 'image/png' });

function mockDeps(over: Partial<QueueDeps> = {}): QueueDeps {
  return {
    cutOut: vi.fn(async (p: Blob) => ({ cutout: png(await p.text()), width: 100, height: 120, model: 'plain-bg', ms: 5 })),
    analyse: vi.fn(async () => ({
      categories: [{ id: 'jeans' as const, score: 0.8 }, { id: 'trousers' as const, score: 0.1 }, { id: 'leggings' as const, score: 0.05 }, { id: 'shorts' as const, score: 0.05 }],
      colours: ['navy' as const], seasons: ['autumn' as const, 'winter' as const],
      embedding: new Float32Array([1, 0, 0]), embeddingModel: 'clip', model: 'clip',
    })),
    findSame: vi.fn(async () => null),
    thumb: vi.fn(async () => undefined),
    lang: vi.fn(async () => 'en' as const),
    ...over,
  };
}

const states = async () => (await db.queue.orderBy('createdAt').toArray()).map((j) => j.state);
const waitFor = async (cond: () => Promise<boolean>, ms = 3000) => {
  const t0 = Date.now();
  while (!(await cond())) {
    if (Date.now() - t0 > ms) throw new Error('timed out');
    await new Promise((r) => setTimeout(r, 10));
  }
};

beforeEach(async () => {
  _resetRunnerForTests();
  await Promise.all([db.queue.clear(), db.items.clear(), db.photos.clear(), db.settings.clear()]);
});

describe('processing queue', () => {
  it('turns a waiting photo into a review item with AI suggestions and an auto-name', async () => {
    const [id] = await enqueuePhotos([photo('a')]);
    const deps = mockDeps({ lang: async () => 'uk', findSame: vi.fn(async () => ({ itemId: 'old', score: 0.97 })) });
    expect(await processNextJob(deps)).toBe(true);

    const job = await db.queue.get(id);
    expect(job?.state).toBe('done');
    const item = await db.items.get(job!.itemId!);
    expect(item).toMatchObject({ status: 'review', name: 'Темно-сині джинси', category: 'jeans', colours: ['navy'], seasons: ['autumn', 'winter'] });
    expect(item?.suggestion?.categories?.map((c) => c.id)).toEqual(['jeans', 'trousers', 'leggings']);
    expect(item?.suggestion).toMatchObject({ sameItemId: 'old', sameItemScore: 0.97, aiFields: ['name', 'category', 'colours', 'seasons'] });
    const p = await db.photos.get(item!.tryOnPhotoId!);
    expect(p).toMatchObject({ itemId: item!.id, cutoutModel: 'plain-bg', cutoutApproved: false, width: 100, height: 120, embeddingModel: 'clip' });
    expect(deps.findSame).toHaveBeenCalledWith(expect.any(Float32Array), 'jeans', item!.id, ['navy']);
    expect(await processNextJob(deps)).toBe(false);
  });

  it('marks a job failed with the message, and a retry runs it again', async () => {
    const [id] = await enqueuePhotos([photo('b')]);
    await processNextJob(mockDeps({ cutOut: async () => { throw new Error('AI module: cutOutGarment not implemented yet'); } }));
    expect(await db.queue.get(id)).toMatchObject({ state: 'failed', error: 'AI module: cutOutGarment not implemented yet' });
    expect(await db.items.count()).toBe(0);

    await retryJob(id);
    expect((await db.queue.get(id))?.state).toBe('waiting');
    await processNextJob(mockDeps());
    expect((await db.queue.get(id))?.state).toBe('done');
    expect(await db.items.count()).toBe(1);
  });

  it('still adds the item when the same-item check fails', async () => {
    await enqueuePhotos([photo('c')]);
    await processNextJob(mockDeps({ findSame: async () => { throw new Error('no model'); } }));
    expect(await states()).toEqual(['done']);
    expect((await db.items.toArray())[0].suggestion?.sameItemId).toBeUndefined();
  });

  it('processes the oldest photo first', async () => {
    await enqueuePhotos([photo('first'), photo('second')]);
    const deps = mockDeps();
    await processNextJob(deps);
    expect(await states()).toEqual(['done', 'waiting']);
    expect(await (deps.cutOut as ReturnType<typeof vi.fn>).mock.calls[0][0].text()).toBe('first');
  });

  it('resumes after a reload: interrupted jobs wait again, finished ones are cleared', async () => {
    await db.queue.bulkAdd([
      { id: 'w', kind: 'garment', blob: photo('w'), state: 'working', createdAt: 1 },
      { id: 'd', kind: 'garment', blob: photo('d'), state: 'done', itemId: 'x', createdAt: 2 },
      { id: 'f', kind: 'garment', blob: photo('f'), state: 'failed', error: 'e', createdAt: 3 },
    ]);
    await resumeQueue();
    expect((await db.queue.orderBy('createdAt').toArray()).map((j) => [j.id, j.state])).toEqual([['w', 'waiting'], ['f', 'failed']]);
  });

  it('runs jobs one at a time while started, and picks up new photos', async () => {
    let active = 0;
    let peak = 0;
    const gates: (() => void)[] = [];
    const deps = mockDeps({
      cutOut: async (p) => {
        active++;
        peak = Math.max(peak, active);
        await new Promise<void>((r) => gates.push(r));
        active--;
        return { cutout: png(await p.text()), width: 1, height: 1, model: 'plain-bg', ms: 1 };
      },
    });
    await enqueuePhotos([photo('1'), photo('2')]);
    const stop = startQueueRunner(deps);
    const stop2 = startQueueRunner(deps); // StrictMode starts effects twice
    await waitFor(async () => gates.length === 1);
    expect(await states()).toEqual(['working', 'waiting']);
    gates.shift()!();
    await waitFor(async () => gates.length === 1);
    expect(await states()).toEqual(['done', 'working']);
    await enqueuePhotos([photo('3')]);
    gates.shift()!();
    await waitFor(async () => gates.length === 1);
    gates.shift()!();
    await waitFor(async () => (await states()).every((s) => s === 'done'));
    expect(peak).toBe(1);
    expect(await db.items.count()).toBe(3);
    stop();
    stop2();
  });
});
