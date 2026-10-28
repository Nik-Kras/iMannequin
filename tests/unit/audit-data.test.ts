// Data, AI and memory items of docs/bug-audit.md, tested on fake IndexedDB and a stand-in AI worker.
// Synthetic blobs only (R2).
import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { db, IMannequinDB } from '../../src/data/db';
import {
  _resetRunnerForTests, enqueuePhotos, errorCodeOf, processBatch, processNextJob, removeJob, resumeQueue, retryJob, startQueueRunner, type QueueDeps,
} from '../../src/data/queue';
import type { CategoryId, QueueJob } from '../../src/domain/types';

const photo = (tag: string) => new Blob([tag], { type: 'image/jpeg' });
const png = (tag: string) => new Blob([`cut:${tag}`], { type: 'image/png' });

function deps(over: Partial<QueueDeps> = {}, log: string[] = []): QueueDeps {
  return {
    cutOut: vi.fn(async (p: Blob) => { const t = await p.text(); log.push(`cut ${t}`); return { cutout: png(t), width: 10, height: 12, model: 'plain-bg', ms: 1 }; }),
    analyse: vi.fn(async (c: Blob) => {
      log.push(`analyse ${(await c.text()).slice(4)}`);
      return { categories: [{ id: 'jeans' as CategoryId, score: 0.9 }], colours: ['navy' as const], seasons: ['autumn' as const], embedding: new Float32Array([1, 0]), embeddingModel: 'clip', model: 'clip' };
    }),
    findSame: vi.fn(async () => null),
    thumb: vi.fn(async () => undefined),
    lang: vi.fn(async () => 'en' as const),
    release: vi.fn(async () => { log.push('release'); }),
    ...over,
  };
}

const jobs = async () => db.queue.orderBy('createdAt').toArray();
const states = async () => (await jobs()).map((j) => j.state + (j.errorCode ? `:${j.errorCode}` : ''));
const waitFor = async (cond: () => Promise<boolean>, ms = 4000) => {
  const t0 = Date.now();
  while (!(await cond())) {
    if (Date.now() - t0 > ms) throw new Error('timed out');
    await new Promise((r) => setTimeout(r, 10));
  }
};

let stops: (() => void)[] = [];
beforeEach(async () => {
  _resetRunnerForTests();
  await Promise.all(db.tables.map((t) => t.clear()));
});
afterEach(() => {
  stops.forEach((s) => s());
  stops = [];
  vi.restoreAllMocks();
});

describe('#1 queue photos and a runner that keeps going', () => {
  it('#1 stores the photo once in its own table; job records hold no Blob', async () => {
    const [id] = await enqueuePhotos([photo('a')]);
    const job = await db.queue.get(id);
    expect(job).toMatchObject({ id, state: 'waiting' });
    expect(Object.values(job!).some((v) => v instanceof Blob)).toBe(false);
    expect(await (await db.queuePhotos.get(id))!.blob.text()).toBe('a');
    await processNextJob(deps());
    // Every state change rewrote only the small record; the bytes moved to the Photo.
    expect(Object.values((await db.queue.get(id))!).some((v) => v instanceof Blob)).toBe(false);
    const p = (await db.photos.toArray())[0];
    expect(await p.original.text()).toBe('a');
    expect(await db.queuePhotos.count()).toBe(0);
  });

  it('#1 a photo that can no longer be read fails its job as "photo-lost", and the next job still runs', async () => {
    const [lost, ok] = await enqueuePhotos([photo('lost'), photo('ok')]);
    await db.queuePhotos.delete(lost);
    stops.push(startQueueRunner(deps()));
    await waitFor(async () => (await states()).join() === 'failed:photo-lost,done');
    expect((await db.queue.get(ok))?.itemId).toBeTruthy();
  });

  it('#1 a job whose own "failed" write throws doesn\'t stop the runner', async () => {
    await enqueuePhotos([photo('bad'), photo('good')]);
    const update = db.queue.update.bind(db.queue);
    vi.spyOn(db.queue, 'update').mockImplementation(((key: string, changes: Partial<QueueJob>) =>
      changes.state === 'failed' ? Promise.reject(new DOMException('Error preparing Blob/File data to be stored in object store', 'DataError')) : update(key, changes)) as typeof db.queue.update);
    const d = deps({ cutOut: async (p) => { if ((await p.text()) === 'bad') throw new Error('boom'); return { cutout: png('good'), width: 1, height: 1, model: 'plain-bg', ms: 1 }; } });
    stops.push(startQueueRunner(d));
    await waitFor(async () => (await states())[1] === 'done');
  });

  it('#1 a failed start is tried again instead of being remembered', async () => {
    await enqueuePhotos([photo('x')]);
    const real = db.transaction.bind(db);
    vi.spyOn(db, 'transaction').mockImplementationOnce((() => Promise.reject(new Error('resume failed'))) as unknown as typeof db.transaction)
      .mockImplementation(real as typeof db.transaction);
    stops.push(startQueueRunner(deps()));
    await waitFor(async () => (await states()).join() === 'done', 5000);
  });

  it('#1 a job left "working" waits again when the runner starts', async () => {
    const [id] = await enqueuePhotos([photo('w')]);
    await db.queue.update(id, { state: 'working' });
    await resumeQueue();
    expect(await states()).toEqual(['waiting']);
  });

  it('#1 removing a job removes its photo and cut-out', async () => {
    const [id] = await enqueuePhotos([photo('r')]);
    await db.queueCuts.put({ jobId: id, cutout: png('r'), width: 1, height: 1, model: 'plain-bg' });
    await removeJob(id);
    expect([await db.queue.count(), await db.queuePhotos.count(), await db.queueCuts.count()]).toEqual([0, 0, 0]);
  });

  it('#1 a job record from before database v3 keeps its photo: moved to queuePhotos at start', async () => {
    await db.queue.put({ id: 'old', kind: 'garment', blob: photo('legacy'), state: 'working', createdAt: 1 });
    await resumeQueue();
    const job = await db.queue.get('old');
    expect(job?.state).toBe('waiting');
    expect('blob' in job!).toBe(false);
    expect(await (await db.queuePhotos.get('old'))!.blob.text()).toBe('legacy');
    await processNextJob(deps());
    expect(await states()).toEqual(['done']);
  });

  it('#1 a database written by the previous version opens, with its queue intact', async () => {
    const name = `imq-v2-${Math.random()}`;
    const v2 = new Dexie(name);
    v2.version(1).stores({ items: 'id, status, category, locationId, createdAt, updatedAt, lastWornAt', photos: 'id, itemId', body: 'id', locations: 'id, order', outfits: 'id, createdAt', wear: 'id, date, outfitId', trips: 'id, start, archived', queue: 'id, state, createdAt', settings: 'id', calibration: 'id, task, modelId, createdAt' });
    v2.version(2).stores({ anchors: 'photoId' });
    await v2.table('queue').put({ id: 'q', kind: 'garment', blob: photo('kept'), state: 'waiting', createdAt: 1 });
    v2.close();
    const v3 = new IMannequinDB(name);
    const job = await v3.queue.get('q');
    expect(await job!.blob!.text()).toBe('kept');
    expect(await v3.queuePhotos.count()).toBe(0);
    v3.close();
  });
});

describe('#6 / #8 one model at a time, loaded once per batch', () => {
  it('#6 a batch cuts out every photo before analysing any', async () => {
    const log: string[] = [];
    await enqueuePhotos([photo('a'), photo('b'), photo('c')]);
    stops.push(startQueueRunner(deps({}, log)));
    await waitFor(async () => (await states()).join() === 'done,done,done');
    expect(log.filter((l) => l !== 'release')).toEqual(['cut a', 'cut b', 'cut c', 'analyse a', 'analyse b', 'analyse c']);
  });

  it('#6 a cut-out stored before the app closed is analysed without cutting again', async () => {
    const log: string[] = [];
    await enqueuePhotos([photo('a'), photo('b')]);
    const d = deps({}, log);
    // Session 1 cuts both out, then the page dies before the analysis.
    d.analyse = vi.fn(async () => new Promise(() => {})) as QueueDeps['analyse'];
    void processBatch(d);
    await waitFor(async () => (await jobs()).every((j) => j.cut));
    _resetRunnerForTests();
    await resumeQueue();
    expect(await states()).toEqual(['waiting', 'waiting']);
    const log2: string[] = [];
    await processBatch(deps({}, log2));
    expect(log2).toEqual(['analyse a', 'analyse b']);
  });

  it('#8 the AI models are freed once the queue has nothing left, not between photos', async () => {
    const log: string[] = [];
    await enqueuePhotos([photo('a'), photo('b')]);
    stops.push(startQueueRunner(deps({}, log)));
    await waitFor(async () => log.includes('release'));
    expect(log).toEqual(['cut a', 'cut b', 'analyse a', 'analyse b', 'release']);
  });
});

describe('#16 / #20 what a job leaves behind', () => {
  it('#16 a failed job says why', async () => {
    const tagged = (code: string) => Object.assign(new Error(code), { code });
    const cases: [unknown, string][] = [
      [tagged('no-garment'), 'no-garment'],
      [tagged('models'), 'models'],
      [new TypeError('Failed to fetch'), 'network'],
      [new DOMException('The quota has been exceeded.', 'QuotaExceededError'), 'storage'],
      [new DOMException('Connection to Indexed Database server lost. Refresh the page to try again', 'UnknownError'), 'storage'],
      [tagged('unreadable'), 'unreadable'],
      [new Error('std::bad_alloc'), 'other'],
    ];
    for (const [err, code] of cases) expect([String(err), errorCodeOf(err)]).toEqual([String(err), code]);

    const [id] = await enqueuePhotos([photo('n')]);
    await processNextJob(deps({ cutOut: async () => { throw tagged('no-garment'); } }));
    expect(await db.queue.get(id)).toMatchObject({ state: 'failed', errorCode: 'no-garment' });
    await retryJob(id);
    expect(await db.queue.get(id)).toMatchObject({ state: 'waiting' });
    expect((await db.queue.get(id))?.errorCode).toBeUndefined();
  });

  it('#20 when no category is recognised, the item says so and the AI claims neither category nor name', async () => {
    await enqueuePhotos([photo('?')]);
    await processNextJob(deps({ analyse: async () => ({ categories: [], colours: ['red'], seasons: [], model: 'plain' }) }));
    const item = (await db.items.toArray())[0];
    expect(item.suggestion?.categories).toEqual([]);
    expect(item.suggestion?.aiFields).toEqual(['colours']);
    expect(item.status).toBe('review');
  });
});

describe('#5 backup', () => {
  const img = (...b: number[]) => new Blob([new Uint8Array([0x89, 0x50, 0x4e, 0x47, ...b])], { type: 'image/png' });
  const bytes = async (b: Blob) => Array.from(new Uint8Array(await b.arrayBuffer()));
  async function seed() {
    await db.items.put({ id: 'it1', name: 'Navy jeans', category: 'jeans', colours: ['navy'], seasons: [], tryOnPhotoId: 'ph1', status: 'active', createdAt: 1, updatedAt: 1 });
    await db.photos.put({ id: 'ph1', itemId: 'it1', original: img(1), cutout: img(2), thumb: img(3), width: 9, height: 9, cutoutApproved: true, createdAt: 1 });
    await db.photos.put({ id: 'ph2', itemId: 'it1', original: img(4), cutout: img(5), width: 9, height: 9, cutoutApproved: true, createdAt: 2 });
    await db.body.put({ id: 'current', photo: img(7), cutout: img(8), mask: img(9), canonical: { width: 1, height: 2 }, landmarks: [], createdAt: 1 });
  }
  /** WebKit's dead Blob: reading its bytes fails. Marked by its type. */
  const dead = (b: Blob) => new Blob([b], { type: 'image/x-dead' });
  function deadReads() {
    const read = Blob.prototype.arrayBuffer;
    vi.spyOn(Blob.prototype, 'arrayBuffer').mockImplementation(function (this: Blob) {
      return this.type === 'image/x-dead' ? Promise.reject(new DOMException('The object can not be found here.', 'NotFoundError')) : read.call(this);
    });
  }

  it('#5 restore keeps this phone\'s crash-report choice, weather location and models, and clears the anchors cache', async () => {
    const { applyBackup, exportBackup, readBackup } = await import('../../src/data/backup');
    const { updateSettings, getSettings } = await import('../../src/data/db');
    await seed();
    await updateSettings({ diagnostics: false, weather: { enabled: true, lat: 50.4, lon: 30.5 }, models: { cutout: 'birefnet-lite' }, lang: 'uk' });
    const file = await exportBackup();
    await Promise.all(db.tables.map((t) => t.clear()));
    await updateSettings({ diagnostics: true, weather: { enabled: false }, models: { cutout: 'plain-bg' } });
    await db.anchors.put({ photoId: 'ph1', anchors: { group: 'bottom', points: {}, width: 1, height: 1 } });
    await applyBackup(await readBackup(file));
    const s = await getSettings();
    expect({ diagnostics: s.diagnostics, weather: s.weather, models: s.models, lang: s.lang })
      .toEqual({ diagnostics: true, weather: { enabled: false }, models: { cutout: 'plain-bg' }, lang: 'uk' });
    expect(await db.anchors.count()).toBe(0);
  });

  it('#5 an unreadable image is left out: the backup finishes, says how many, and restores', async () => {
    const backup = await import('../../src/data/backup');
    await seed();
    await db.photos.update('ph2', { cutout: dead(img(5)) });
    deadReads();
    const file = await backup.exportBackup();
    expect(file.size).toBeGreaterThan(0);
    expect((await backup.exportBackupFile()).skipped).toBe(1);
    vi.restoreAllMocks();
    await Promise.all(db.tables.map((t) => t.clear()));
    await backup.applyBackup(await backup.readBackup(file));
    expect(await bytes((await db.photos.get('ph1'))!.cutout!)).toEqual([0x89, 0x50, 0x4e, 0x47, 2]);
    const ph2 = (await db.photos.get('ph2'))!;
    expect(ph2.cutout).toBeUndefined();
    expect(await bytes(ph2.original)).toEqual([0x89, 0x50, 0x4e, 0x47, 4]);
  });

  it('#5 restore reads images as slices of the file, never the whole file at once', async () => {
    const { exportBackup, readBackup, applyBackup } = await import('../../src/data/backup');
    await seed();
    const file = await exportBackup();
    const whole = vi.spyOn(file, 'arrayBuffer');
    const parsed = await readBackup(file);
    expect(whole).not.toHaveBeenCalled();
    await Promise.all(db.tables.map((t) => t.clear()));
    await applyBackup(parsed);
    expect(await bytes((await db.body.get('current'))!.mask)).toEqual([0x89, 0x50, 0x4e, 0x47, 9]);
  });

  it('#5 the format stays compatible both ways', async () => {
    const { unzipSync, zipSync, strToU8, strFromU8 } = await import('fflate');
    const { exportBackup, readBackup, applyBackup, BACKUP_VERSION } = await import('../../src/data/backup');
    await seed();
    // A new backup opens with the previous version's reader: unzip it all, and every image it names is there.
    const files = unzipSync(new Uint8Array(await (await exportBackup()).arrayBuffer()));
    const manifest = JSON.parse(strFromU8(files['manifest.json']));
    expect(manifest.version).toBe(BACKUP_VERSION);
    const refs = JSON.stringify(manifest.tables).match(/"\$blob":"[^"]+"/g)!.map((r) => r.slice(9, -1));
    expect(refs.length).toBe(8);
    for (const r of refs) expect(files[r], r).toBeDefined();
    // A backup laid out like the previous version's (manifest first) restores.
    await Promise.all(db.tables.map((t) => t.clear()));
    const old = zipSync({ 'manifest.json': strToU8(JSON.stringify(manifest)), ...Object.fromEntries(refs.map((r) => [r, [files[r], { level: 0 }]])) } as never);
    await applyBackup(await readBackup(new Blob([old as BlobPart])));
    expect(await bytes((await db.photos.get('ph1'))!.thumb!)).toEqual([0x89, 0x50, 0x4e, 0x47, 3]);
  });
});

describe('#3 data writes survive iOS dropping the connection', () => {
  it('#3 saving an item, a place or a merge is retried once after the connection is lost', async () => {
    const { saveItem } = await import('../../src/data/repo');
    const { addPlace, mergeIntoExisting } = await import('../../src/wardrobe/ops');
    const lost = (() => Promise.reject(new DOMException('Connection to Indexed Database server lost. Refresh the page to try again', 'UnknownError'))) as never;
    const item = { id: 'i', name: 'Tee', category: 'tshirt' as const, colours: [], seasons: [], status: 'active' as const, createdAt: 1, updatedAt: 1 };
    vi.spyOn(db.items, 'put').mockImplementationOnce(lost);
    await saveItem(item);
    expect((await db.items.get('i'))?.name).toBe('Tee');
    vi.spyOn(db.locations, 'put').mockImplementationOnce(lost);
    const id = await addPlace(' Shelf ');
    expect((await db.locations.get(id))?.name).toBe('Shelf');
    await db.items.put({ ...item, id: 'r', status: 'review' });
    await db.photos.put({ id: 'p', itemId: 'r', original: photo('o'), width: 1, height: 1, cutoutApproved: false, createdAt: 1 });
    vi.spyOn(db.photos, 'bulkPut').mockImplementationOnce(lost);
    await mergeIntoExisting('r', 'i');
    expect((await db.photos.get('p'))?.itemId).toBe('i');
  });
});

describe('#7 the default cut-out model', () => {
  it('#7 ORMBG is the default and the onboarding download; BiRefNet-lite stays selectable', async () => {
    const { defaultModel, chosenModel, specsFor, ONBOARDING_MODELS } = await import('../../src/ai/registry');
    expect(defaultModel('cutout').id).toBe('ormbg');
    expect(ONBOARDING_MODELS).toEqual(['ormbg', 'clip-b32']);
    expect(specsFor('cutout').map((s) => s.id)).toContain('birefnet-lite');
    expect(chosenModel({ models: { cutout: 'birefnet-lite' } }, 'cutout').id).toBe('birefnet-lite');
  });
});

// ---- The AI worker's life (bug-audit #6, #8): a stand-in Worker that logs what it is told ----
const events: string[] = [];
const running = () => globalThis.localStorage.getItem('imq-ai-running');
class FakeWorker {
  static count = 0;
  n = ++FakeWorker.count;
  onmessage: ((e: MessageEvent) => void) | null = null;
  onerror: ((e: ErrorEvent) => void) | null = null;
  private listeners = new Set<(e: MessageEvent) => void>();
  constructor() { events.push(`spawn w${this.n}`); }
  addEventListener(_t: string, f: (e: MessageEvent) => void) { this.listeners.add(f); }
  removeEventListener(_t: string, f: (e: MessageEvent) => void) { this.listeners.delete(f); }
  postMessage(m: { type: string; id: number }) {
    if (m.type === 'init') return;
    events.push(`w${this.n} ${m.type} running=${running()}`);
    setTimeout(() => {
      const e = { data: { type: 'done', id: m.id, result: m.type === 'embed-text' ? [new Float32Array([1])] : null } } as MessageEvent;
      this.onmessage?.(e);
      for (const f of this.listeners) f(e);
    }, 5);
  }
  terminate() { events.push(`w${this.n} terminate running=${running()}`); }
}

describe('#6 / #8 the AI worker is let go safely', () => {
  const spec = (id: string) => ({ id, task: 'cutout', label: id, licence: 'MIT', source: id, runtime: 'transformers' }) as never;
  const blob = new Blob(['x']);
  beforeEach(() => {
    const m = new Map<string, string>();
    vi.stubGlobal('localStorage', { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) });
    vi.stubGlobal('Worker', FakeWorker);
    events.length = 0;
    vi.resetModules(); // a fresh client (no kept worker) per test
  });
  afterEach(() => vi.unstubAllGlobals());

  it('#6 a WebGPU worker is never terminated: its models are disposed and it loads the next one; a crash meanwhile is blamed on the right model', async () => {
    const { guarded, run, releaseAi } = await import('../../src/ai/client');
    await guarded('ormbg@webgpu', () => run('ormbg@webgpu', { type: 'segment', blob, spec: spec('ormbg') }));
    await guarded('clip-b32@webgpu', () => run('clip-b32@webgpu', { type: 'embed-text', texts: ['a photo of jeans'], spec: spec('clip-b32') }));
    await guarded('clip-b32@webgpu', () => run('clip-b32@webgpu', { type: 'embed-image', blob, spec: spec('clip-b32') }));
    await releaseAi(); // the queue is idle
    const first = events[0].split(' ')[1];
    expect(events).toEqual([
      `spawn ${first}`, `${first} segment running=ormbg@webgpu`,
      // ORMBG is freed under its own name; then CLIP is marked and loads into the same worker.
      `${first} dispose running=ormbg@webgpu`, `${first} embed-text running=clip-b32@webgpu`,
      `${first} dispose running=clip-b32@webgpu`, `${first} embed-image running=clip-b32@webgpu`,
      `${first} dispose running=clip-b32@webgpu`,
    ]);
    expect(running()).toBeNull();
  });

  it('#6 a CPU worker disposes its models before it is terminated, and a crash meanwhile is blamed on that model', async () => {
    const { guarded, run, releaseAi } = await import('../../src/ai/client');
    await guarded('ormbg@wasm', () => run('ormbg@wasm', { type: 'segment', blob, spec: spec('ormbg') }));
    await guarded('clip-b32@wasm', () => run('clip-b32@wasm', { type: 'embed-image', blob, spec: spec('clip-b32') }));
    await releaseAi();
    expect(events.map((e) => e.replace(/w\d+/, 'w'))).toEqual([
      'spawn w', 'w segment running=ormbg@wasm',
      // ORMBG is freed first, under its own name; then CLIP is marked and runs.
      'w dispose running=ormbg@wasm', 'w terminate running=ormbg@wasm',
      'spawn w', 'w embed-image running=clip-b32@wasm',
      'w dispose running=clip-b32@wasm', 'w terminate running=clip-b32@wasm',
    ]);
    expect(running()).toBeNull();
  });

  it('#8 the text and image halves of CLIP never share a worker', async () => {
    const { guarded, run, releaseAi } = await import('../../src/ai/client');
    const k = 'clip-b32@wasm';
    await guarded(k, () => run(k, { type: 'embed-text', texts: ['a photo of jeans'], spec: spec('clip-b32') }));
    await guarded(k, () => run(k, { type: 'embed-image', blob, spec: spec('clip-b32') }));
    await guarded(k, () => run(k, { type: 'embed-image', blob, spec: spec('clip-b32') }));
    await releaseAi();
    expect(events.map((e) => e.replace(/w\d+/, 'w').replace(/ running=.*/, ''))).toEqual([
      'spawn w', 'w embed-text', 'w dispose', 'w terminate',
      'spawn w', 'w embed-image', 'w embed-image', 'w dispose', 'w terminate',
    ]);
  });

  it('#6 the worker disposes every loaded model once, whatever failed to load', async () => {
    const { disposeModels } = await import('../../src/ai/worker');
    const pipe = { dispose: vi.fn() };
    const clip = { dispose: vi.fn() };
    const pair = { processor: {}, model: clip };
    const failed = Promise.reject(new Error('failed to load'));
    failed.catch(() => {});
    expect(await disposeModels([Promise.resolve(pipe), Promise.resolve(pair), Promise.resolve(pair), failed])).toBe(2);
    expect([pipe.dispose.mock.calls.length, clip.dispose.mock.calls.length]).toEqual([1, 1]);
  });
});
