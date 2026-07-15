import { describe, it, expect } from 'vitest';
import { computeAutoGrade } from './autoGrade';
import { brightnessFromOffset, contrastFromGain } from './compositeParams';

/**
 * Pure-function tests, mock-free — same discipline as compositeParams.test.ts.
 * computeAutoGrade reads only ImageData's data/width/height, so tests build a
 * plain object with a Uint8ClampedArray (node has no ImageData constructor) and
 * cast it to ImageData.
 */

/** Build an ImageData-shaped object from a list of [r,g,b] pixels (0..255). */
function img(pixels: [number, number, number][]): ImageData {
  const data = new Uint8ClampedArray(pixels.length * 4);
  pixels.forEach(([r, g, b], i) => {
    data[i * 4] = r;
    data[i * 4 + 1] = g;
    data[i * 4 + 2] = b;
    data[i * 4 + 3] = 255;
  });
  return { data, width: pixels.length, height: 1 } as unknown as ImageData;
}

/** N copies of a single [r,g,b] pixel. */
const fill = (rgb: [number, number, number], count: number): [number, number, number][] =>
  Array.from({ length: count }, () => rgb);

/** Two-value image: `count` of each of two pixels. */
const twoTone = (a: [number, number, number], b: [number, number, number], count = 50): [number, number, number][] => [
  ...fill(a, count),
  ...fill(b, count),
];

describe('computeAutoGrade — degenerate / guarded frames', () => {
  it('returns neutral for a flat mid-gray frame (no luma spread)', () => {
    const result = computeAutoGrade(img(fill([128, 128, 128], 100)));
    expect(result).toEqual({ brightness: 0, contrast: 0, saturation: 0, temperature: 0 });
  });

  it('returns neutral for a near-black frame (spread below MIN_LUMA_RANGE)', () => {
    const result = computeAutoGrade(img(fill([5, 5, 5], 100)));
    expect(result).toEqual({ brightness: 0, contrast: 0, saturation: 0, temperature: 0 });
  });

  it('returns neutral for an empty frame', () => {
    const result = computeAutoGrade(img([]));
    expect(result).toEqual({ brightness: 0, contrast: 0, saturation: 0, temperature: 0 });
  });
});

describe('computeAutoGrade — brightness / contrast stretch', () => {
  it('brightens a dark (but not near-black) frame', () => {
    // Two dark grays: luma ≈ 0.05 and ≈ 0.25, midpoint 0.15 → wants an additive
    // +0.35, which exceeds the ±0.25 effective range → clamps to slider +1.
    const result = computeAutoGrade(img(twoTone([13, 13, 13], [64, 64, 64])));
    expect(result.brightness).toBeGreaterThan(0.2);
    expect(result.contrast).toBeGreaterThan(0); // narrow range → positive contrast boost
    expect(result.saturation).toBe(0);
  });

  it('boosts contrast on a washed-out (low-contrast) frame', () => {
    // Two mid grays: luma 0.4 and 0.6 → range 0.2 → strong contrast, ~0 brightness.
    const result = computeAutoGrade(img(twoTone([102, 102, 102], [153, 153, 153])));
    expect(result.contrast).toBeGreaterThan(0.5);
    expect(Math.abs(result.brightness)).toBeLessThan(0.05);
  });

  it('leaves a full-range high-contrast frame ~neutral in brightness/contrast', () => {
    // Pure black + pure white → range ≈ 1 → contrast ≈ 0, brightness ≈ 0.
    const result = computeAutoGrade(img(twoTone([0, 0, 0], [255, 255, 255])));
    expect(Math.abs(result.contrast)).toBeLessThan(0.05);
    expect(Math.abs(result.brightness)).toBeLessThan(0.05);
    expect(result.saturation).toBe(0);
  });

  it('clamps contrast to +1 on an extremely narrow range', () => {
    // Luma ≈ 0.35 and ≈ 0.45 → range ≈ 0.098 → wants gain ~10×, far past the
    // 1.6× ceiling → clamps to +1.
    const result = computeAutoGrade(img(twoTone([90, 90, 90], [115, 115, 115])));
    expect(result.contrast).toBe(1);
  });

  it('solves contrast through contrastFromGain — the same inverse the compositor remaps forward with, so Auto lands where the manual slider would', () => {
    // p2 = 26/255 ≈ 0.102, p98 = 230/255 ≈ 0.902 → range = 0.8 exactly, wanting
    // gain 1.25×. Chosen to sit INSIDE the tightened 0.625×–1.6× span so the
    // result doesn't clamp and the exact value is observable — the old 0.6-range
    // case now clamps to +1 under this curve and could no longer tell the
    // formulas apart. Superseded formulas rejected explicitly: the original
    // linear 1/0.8 − 1 = 0.25, and the untightened log2(1.25) ≈ 0.322, vs.
    // contrastFromGain(1.25) ≈ 0.475. Every other case in this file clamps to
    // the same ±1/0 under all three and wouldn't catch a regression.
    const result = computeAutoGrade(img(twoTone([26, 26, 26], [230, 230, 230])));
    expect(result.contrast).toBeCloseTo(contrastFromGain(1.25), 3);
    expect(result.contrast).not.toBeCloseTo(1 / 0.8 - 1, 2);
    expect(result.contrast).not.toBeCloseTo(Math.log2(1.25), 2);
    expect(result.brightness).toBeCloseTo(0, 1); // midpoint ≈ 0.5 → nothing to correct
  });

  it('solves brightness through brightnessFromOffset — a correction inside the ±0.25 effective range comes back scaled into slider terms, not raw', () => {
    // p2=0.4 (102,102,102), p98=0.6 (153,153,153) → midpoint 0.5 ± 0… use an
    // offset frame instead: p2=0.3, p98=0.6 → midpoint 0.45 → wants +0.05
    // additive → slider +0.05/0.25 = +0.2. The raw (pre-remap) formula would
    // have returned +0.05, a 4× weaker correction on the same range.
    const result = computeAutoGrade(img(twoTone([77, 77, 77], [153, 153, 153])));
    expect(result.brightness).toBeCloseTo(brightnessFromOffset(0.5 - (0.3 + 0.6) / 2), 1);
    expect(result.brightness).not.toBeCloseTo(0.5 - (0.3 + 0.6) / 2, 2);
  });

  it('a clamped correction is a partial correction toward the target, never an overshoot past neutral', () => {
    // The tightened ranges mean Auto clamps on frames it could once correct
    // exactly. A clamped result must still point the right way.
    const dark = computeAutoGrade(img(twoTone([13, 13, 13], [64, 64, 64])));
    expect(dark.brightness).toBe(1); // wants +0.35 additive, capped at +0.25
    const bright = computeAutoGrade(img(twoTone([191, 191, 191], [242, 242, 242])));
    expect(bright.brightness).toBe(-1); // symmetric on the bright side
  });
});

describe('computeAutoGrade — gray-world temperature', () => {
  it('cools a warm-skewed (red-heavy) frame (temperature < 0)', () => {
    // meanR > meanB → correction is toward cool (negative temperature).
    const result = computeAutoGrade(img(twoTone([200, 120, 40], [60, 40, 10])));
    expect(result.temperature).toBeLessThan(0);
  });

  it('warms a cool-skewed (blue-heavy) frame (temperature > 0)', () => {
    // meanB > meanR → correction is toward warm (positive temperature).
    const result = computeAutoGrade(img(twoTone([40, 120, 200], [10, 40, 60])));
    expect(result.temperature).toBeGreaterThan(0);
  });

  it('leaves temperature at 0 for a neutral (gray) frame with spread', () => {
    const result = computeAutoGrade(img(twoTone([64, 64, 64], [192, 192, 192])));
    expect(result.temperature).toBe(0);
  });

  it('the nudge is solved through the temperature remap — the slider value is 2.5× hotter than the pre-remap formula, which is what keeps the VISUAL nudge identical now that ±1 means a ±0.04 channel shift instead of ±0.1', () => {
    // meanB − meanR = Δ = 0.04 exactly (B 128+10.2, R 128−10.2 over one tone).
    // Half-strength gray-world: slider = 6.25·Δ = 0.25. The pre-remap formula
    // (2.5·Δ = 0.1) would now under-correct by 2.5×, since a slider unit buys
    // 2.5× less tint than it used to.
    const px: [number, number, number][] = [
      ...fill([113, 128, 143], 50),
      ...fill([59, 74, 89], 50), // spread, so the frame isn't guarded as flat
    ];
    const result = computeAutoGrade(img(px));
    const meanR = (113 + 59) / 2 / 255;
    const meanB = (143 + 89) / 2 / 255;
    expect(result.temperature).toBeCloseTo(6.25 * (meanB - meanR), 2);
    expect(result.temperature).not.toBeCloseTo(2.5 * (meanB - meanR), 2);
  });
});

describe('computeAutoGrade — output bounds', () => {
  it('always clamps every channel to [-1, 1] and keeps saturation 0', () => {
    const cases: [number, number, number][][] = [
      twoTone([0, 0, 0], [255, 255, 255]),
      twoTone([200, 120, 40], [60, 40, 10]),
      twoTone([40, 120, 200], [10, 40, 60]),
      twoTone([90, 90, 90], [115, 115, 115]),
    ];
    for (const px of cases) {
      const g = computeAutoGrade(img(px));
      for (const v of [g.brightness, g.contrast, g.saturation, g.temperature]) {
        expect(v).toBeGreaterThanOrEqual(-1);
        expect(v).toBeLessThanOrEqual(1);
      }
      expect(g.saturation).toBe(0);
    }
  });
});
