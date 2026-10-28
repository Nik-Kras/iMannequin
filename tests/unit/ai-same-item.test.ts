import { describe, expect, it } from 'vitest';
import { categoryPrompts, categoryVectors, cosine, decideSameItem, meanUnit, suggestSeasons, TEMPLATES, topCategories, zeroShot } from '../../src/ai/classify';
import { CATEGORIES } from '../../src/domain/taxonomy';
import { chosenModel, defaultModel, MODEL_SPECS, modelBytes, specsFor } from '../../src/ai/registry';

const unit = (...v: number[]) => { const n = Math.hypot(...v); return Float32Array.from(v, (x) => x / n); };

describe('same-item decision (D9)', () => {
  it('flags a clear, colour-consistent match', () => {
    expect(decideSameItem([{ itemId: 'a', score: 0.96, colours: ['navy'] }, { itemId: 'b', score: 0.85, colours: ['navy'] }], ['navy'], 0.93))
      .toEqual({ itemId: 'a', score: 0.96 });
  });

  it('says nothing below the threshold', () => {
    expect(decideSameItem([{ itemId: 'a', score: 0.92, colours: ['navy'] }], ['navy'], 0.93)).toBeNull();
  });

  it('says nothing when the colours disagree', () => {
    expect(decideSameItem([{ itemId: 'a', score: 0.97, colours: ['red'] }], ['green'], 0.93)).toBeNull();
  });

  it('accepts colour names of one family (denim vs blue)', () => {
    expect(decideSameItem([{ itemId: 'a', score: 0.95, colours: ['denim'] }], ['blue'], 0.93)?.itemId).toBe('a');
  });

  it('says nothing when two items are equally close (two identical black T-shirts)', () => {
    expect(decideSameItem([{ itemId: 'a', score: 0.96, colours: ['black'] }, { itemId: 'b', score: 0.955, colours: ['black'] }], ['black'], 0.93)).toBeNull();
  });

  it('is stricter when the new photo has no colours yet', () => {
    expect(decideSameItem([{ itemId: 'a', score: 0.94, colours: ['black'] }], [], 0.93)).toBeNull();
    expect(decideSameItem([{ itemId: 'a', score: 0.96, colours: ['black'] }], [], 0.93)?.itemId).toBe('a');
  });

  it('handles an empty wardrobe', () => expect(decideSameItem([], ['red'], 0.93)).toBeNull());
});

describe('zero-shot helpers', () => {
  it('cosine of unit vectors', () => {
    expect(cosine(unit(1, 0), unit(1, 0))).toBeCloseTo(1);
    expect(cosine(unit(1, 0), unit(0, 1))).toBeCloseTo(0);
  });

  it('one prompt per category and template', () => {
    expect(categoryPrompts().length).toBe(CATEGORIES.length * TEMPLATES.length);
    expect(categoryPrompts()[0]).toBe('a photo of a t-shirt');
  });

  it('picks the top-3 categories from averaged prompt vectors', () => {
    const dim = CATEGORIES.length;
    const flat: Float32Array[] = [];
    CATEGORIES.forEach((_, i) => TEMPLATES.forEach(() => { const v = new Float32Array(dim); v[i] = 1; flat.push(v); }));
    const img = new Float32Array(dim);
    img[5] = 0.9; img[6] = 0.4; img[8] = 0.2; // sweater, then hoodie, then jacket
    const top = topCategories(meanUnit([img]), categoryVectors(flat));
    expect(top.map((t) => t.id)).toEqual(['sweater', 'hoodie', 'jacket']);
    expect(top[0].score).toBeGreaterThan(top[1].score);
  });

  it('zeroShot sums to one', () => {
    const p = zeroShot(unit(1, 1), [unit(1, 0), unit(0, 1), unit(1, 1)]);
    expect(p.reduce((a, b) => a + b, 0)).toBeCloseTo(1);
    expect(p[2]).toBeGreaterThan(p[0]);
  });
});

describe('season suggestions', () => {
  it('uses the category prior', () => {
    expect(suggestSeasons('coat')).toEqual(['autumn', 'winter']);
    expect(suggestSeasons('shorts')).toEqual(['summer']);
  });

  it('adds winter for a warm-looking garment and drops summer', () => {
    expect(suggestSeasons('shirt', [0.8, 0.05, 0.15])).toEqual(['spring', 'autumn', 'winter']);
  });

  it('adds summer for a light-looking garment and drops winter', () => {
    expect(suggestSeasons('trousers', [0.05, 0.8, 0.15])).toEqual(['spring', 'summer', 'autumn']);
  });

  it('keeps all-year accessories all year', () => {
    expect(suggestSeasons('bag', [0.9, 0.05, 0.05])).toEqual(['spring', 'summer', 'autumn', 'winter']);
  });
});

describe('model registry', () => {
  it('has one default per task and only permissive licences', () => {
    for (const task of ['cutout', 'classify', 'search', 'describe', 'pose'] as const) {
      expect(specsFor(task).filter((s) => s.default).length, task).toBe(1);
    }
    for (const s of MODEL_SPECS) expect(['MIT', 'Apache-2.0']).toContain(s.licence);
  });

  it('defaults follow the brief and decisions', () => {
    expect(defaultModel('cutout').id).toBe('birefnet-lite');
    expect(defaultModel('classify').id).toBe('clip-b32');
    expect(defaultModel('search').id).toBe('qwen3-1.7b'); // D32
    expect(defaultModel('pose').id).toBe('pose-lite');
  });

  it('does not ship IS-Net (AGPL on the Hub)', () => {
    expect(MODEL_SPECS.some((s) => s.source === 'onnx-community/ISNet-ONNX')).toBe(false);
  });

  it('settings choose a model per task, falling back to the default', () => {
    expect(chosenModel({ models: { cutout: 'ormbg' } }, 'cutout').id).toBe('ormbg');
    expect(chosenModel({ models: { cutout: 'clip-b32' } }, 'cutout').id).toBe('birefnet-lite'); // wrong task
    expect(chosenModel({ models: {} }, 'search').id).toBe('qwen3-1.7b');
  });

  it('knows download sizes per device', () => {
    const b = MODEL_SPECS.find((s) => s.id === 'birefnet-lite')!;
    expect(modelBytes(b, 'webgpu')).toBeLessThan(modelBytes(b, 'wasm'));
    expect(b.sizeMb).toBe(109);
  });
});
