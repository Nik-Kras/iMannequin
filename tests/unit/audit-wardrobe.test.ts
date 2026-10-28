// Adding, reviewing and browsing clothes (docs/bug-audit.md): the parts testable without a browser.
import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// The search model's worker and downloads are stubbed: the test checks the policy, not the model.
const calls: string[] = [];
const device = { value: 'webgpu' as 'webgpu' | 'wasm' };
vi.mock('../../src/ai/client', () => ({
  exclusive: <T,>(job: () => Promise<T>) => job(),
  failKey: (id: string, d: string) => `${id}@${d}`,
  guarded: <T,>(_k: string, job: () => Promise<T>) => job(),
  deviceFor: async () => device.value,
  isNetworkError: () => false,
  run: vi.fn(async () => { calls.push('generate'); return '{"categories":["dress"]}'; }),
  releaseAi: vi.fn(() => { calls.push('release'); }),
}));
vi.mock('../../src/ai/embed', () => ({
  usableModel: async (_s: unknown, task: string) => (task === 'search' ? { id: 'qwen3-0.6b', task: 'search' } : null),
  withModel: <T,>(_s: unknown, fn: () => Promise<T>) => fn(),
  textEmbeddings: async () => [],
}));
vi.mock('../../src/ai/downloads', () => ({ isDownloaded: async () => true }));

const { searchDetailed } = await import('../../src/ai/search');
const { needsLanguageModel, parseQuery } = await import('../../src/ai/query');
const { db } = await import('../../src/data/db');
const { en, uk } = await import('../../src/i18n');
const { failureInfo } = await import('../../src/wardrobe/queueErrors');

const FREE_TEXT = 'щось для пікніка з друзями';

describe('#10 the search model runs only when asked, never on WebAssembly, and is released after', () => {
  beforeEach(async () => {
    calls.length = 0;
    device.value = 'webgpu';
    await db.items.clear();
  });

  it('#10 the query needs the language model (precondition)', () => {
    expect(needsLanguageModel(parseQuery(FREE_TEXT, []))).toBe(true);
  });

  it('#10 a plain search never runs it, even when it is downloaded', async () => {
    const r = await searchDetailed(FREE_TEXT);
    expect(r.needsLlm).toBe(true);
    expect(r.llmDownloaded).toBe(true);
    expect(calls).toEqual([]);
  });

  it('#10 an explicit tap runs it once and releases the worker right after', async () => {
    const r = await searchDetailed(FREE_TEXT, { llm: 'run' });
    expect(calls).toEqual(['generate', 'release']);
    expect(r.usedLlm).toBe(true);
  });

  it('#10 never on WebAssembly, even when asked', async () => {
    device.value = 'wasm';
    const r = await searchDetailed(FREE_TEXT, { llm: 'run' });
    expect(calls).toEqual([]);
    expect(r.llmUsable).toBe(false);
  });

  it('#10 the download screen doesn’t promise an automatic download', () => {
    expect(en['ai.dl.searchLater']).not.toMatch(/when a search needs it/);
    expect(en['ai.dl.searchLater']).toMatch(/Model lab/);
    expect(uk['ai.dl.searchLater']).toMatch(/Лабораторі/);
  });
});

describe('#16 each failed photo gets its own message and action', () => {
  const row = (errorCode?: string, error?: string) => ({ id: 'j', state: 'failed' as const, createdAt: 0, errorCode: errorCode as never, error });

  it('#16 by error code', () => {
    expect(failureInfo(row('no-garment'))).toMatchObject({ kind: 'no-garment', primary: 'retake' });
    expect(failureInfo(row('models'))).toMatchObject({ kind: 'models', primary: 'models' });
    expect(failureInfo(row('network'))).toMatchObject({ kind: 'network', primary: 'retry' });
    expect(failureInfo(row('storage'))).toMatchObject({ kind: 'storage', primary: 'retry' });
    expect(failureInfo(row('photo-lost'))).toMatchObject({ kind: 'photo-lost', primary: 'retake' });
    expect(failureInfo(row('unreadable'))).toMatchObject({ kind: 'unreadable', primary: 'remove' });
  });

  it('#16 old jobs without a code: a lost connection or a full disk is not blamed on the photo', () => {
    expect(failureInfo(row(undefined, 'Failed to fetch')).kind).toBe('network');
    expect(failureInfo(row(undefined, 'Load failed')).kind).toBe('network');
    expect(failureInfo(row(undefined, 'QuotaExceededError: The quota has been exceeded.')).kind).toBe('storage');
    expect(failureInfo(row(undefined, 'Connection to Indexed Database server lost. Refresh the page to try again')).kind).toBe('storage');
    expect(failureInfo(row(undefined, 'std::bad_alloc')).kind).toBe('other');
    expect(failureInfo(row(undefined, 'The source image could not be decoded.')).kind).toBe('unreadable');
    expect(failureInfo(row(undefined, 'No garment found in the photo')).kind).toBe('no-garment');
    expect(failureInfo(row(undefined, 'Model not downloaded')).kind).toBe('models');
  });
});

describe('#50 copy', () => {
  it('#50 Ukrainian wording', () => {
    expect(uk['wardrobe.item.looksGood']).not.toBe('Гаразд');
    expect(uk['wardrobe.add.left']).toBe('Обробляю: ще {n}');
    expect(uk['dressup.fit.reset']).toBe('Скинути до автоматичного');
    expect(uk['wardrobe.review.notReadyHint']).not.toMatch(/Спробуйте трохи згодом/);
  });
});
