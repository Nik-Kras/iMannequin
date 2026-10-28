// Body photo and try-on items of docs/bug-audit.md, at the unit level.
import { describe, expect, it } from 'vitest';
import { maskToImageData } from '../../src/ai/pose';

// Node has no ImageData; a minimal stand-in with the same shape.
class FakeImageData {
  data: Uint8ClampedArray;
  constructor(public width: number, public height: number) { this.data = new Uint8ClampedArray(width * height * 4); }
}
(globalThis as { ImageData?: unknown }).ImageData ??= FakeImageData;

describe('#9 body photo memory', () => {
  it('#9 the pose mask stays at the model’s resolution, not the photo’s', () => {
    const mw = 64, mh = 48;
    const values = new Float32Array(mw * mh).map((_, i) => (i % mw > 20 && i % mw < 40 ? 1 : 0));
    // A 48 MP photo: the old code built an 8000 × 6000 ImageData (192 MB) from this 64 × 48 mask.
    const img = maskToImageData(values, mw, mh);
    expect([img.width, img.height]).toEqual([mw, mh]);
    expect(img.data[(10 * mw + 30) * 4 + 3]).toBe(255);
    expect(img.data[(10 * mw + 5) * 4 + 3]).toBe(0);
  });
});
