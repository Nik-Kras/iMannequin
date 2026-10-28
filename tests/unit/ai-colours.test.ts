import { describe, expect, it } from 'vitest';
import { coloursAgree, garmentColours, hexToRgb, kmeans, nameColour, rgbToLab } from '../../src/ai/colours';
import { SAMPLES } from '../../src/dev/samples';

/** A synthetic cut-out: transparent background with a garment of the given colours (shares of the area). */
function cutout(parts: [string, number][], size = 64): Uint8ClampedArray {
  const px = new Uint8ClampedArray(size * size * 4);
  const inner = size * size * 0.5; // half the pixels are garment, the rest transparent
  let i = 0;
  for (const [hex, share] of parts) {
    const [r, g, b] = hexToRgb(hex);
    const n = Math.round(inner * share);
    for (let k = 0; k < n; k++, i++) px.set([r, g, b, 255], i * 4);
  }
  return px;
}

describe('colour naming', () => {
  it('names the sample wardrobe colours the way the samples do', () => {
    for (const [, hex, name, , colours] of SAMPLES) {
      expect(nameColour(hexToRgb(hex)), name).toBe(colours[0]);
    }
  });

  it('names common garment colours', () => {
    expect(nameColour([20, 20, 20])).toBe('black');
    expect(nameColour([250, 250, 250])).toBe('white');
    expect(nameColour([128, 128, 128])).toBe('grey');
    expect(nameColour([200, 30, 40])).toBe('red');
    expect(nameColour([30, 40, 80])).toBe('navy');
    expect(nameColour([240, 210, 60])).toBe('yellow');
    expect(nameColour([100, 50, 140])).toBe('purple');
  });

  it('Lab of white is about L=100, a=b=0', () => {
    const [L, a, b] = rgbToLab(255, 255, 255);
    expect(L).toBeCloseTo(100, 0);
    expect(Math.abs(a)).toBeLessThan(0.5);
    expect(Math.abs(b)).toBeLessThan(0.5);
  });
});

describe('garment colours (k-means over opaque pixels)', () => {
  it('ignores transparent pixels and finds one main colour', () => {
    expect(garmentColours(cutout([['#2F3E5C', 1]]))).toEqual(['navy']);
  });

  it('merges shadows of the same fabric', () => {
    // navy with darker and lighter folds
    expect(garmentColours(cutout([['#2F3E5C', 0.6], ['#253250', 0.25], ['#36466a', 0.15]]))).toEqual(['navy']);
  });

  it('returns two colours for a two-colour garment, biggest first', () => {
    expect(garmentColours(cutout([['#F5F5F2', 0.55], ['#A8323A', 0.45]]))).toEqual(['white', 'red']);
  });

  it('says multi for four or more clear colours', () => {
    expect(garmentColours(cutout([['#A8323A', 0.25], ['#3a6fc4', 0.25], ['#f2d23c', 0.25], ['#3f8f4a', 0.25]]))).toEqual(['multi']);
  });

  it('is deterministic', () => {
    const px = cutout([['#B5562F', 0.7], ['#EFE6D2', 0.3]]);
    expect(garmentColours(px)).toEqual(garmentColours(px));
  });

  it('k-means returns shares that add up to 1', () => {
    const pts = [rgbToLab(0, 0, 0), rgbToLab(255, 255, 255), rgbToLab(10, 10, 10), rgbToLab(250, 250, 250)];
    const k = kmeans(pts, 2);
    expect(k.length).toBe(2);
    expect(k.reduce((a, c) => a + c.share, 0)).toBeCloseTo(1);
  });
});

describe('colour agreement for same-item checks', () => {
  it('treats denim and blue as one family', () => expect(coloursAgree(['denim'], ['blue'])).toBe(true));
  it('separates red and green', () => expect(coloursAgree(['red'], ['green'])).toBe(false));
  it('does not block when a side has no colours', () => expect(coloursAgree([], ['red'])).toBe(true));
});
