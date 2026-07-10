import { describe, it, expect } from 'vitest';
import { computeObjectCoverRect } from './useGlPreview';

/**
 * Pure-function tests, mock-free — the useGlPreview hook itself can't be
 * unit-tested (this repo has no jsdom/@testing-library/react, same precedent
 * as useWebCodecsPreview.test.ts / compositeParams.test.ts), so its pure,
 * export-reusable helper is tested directly against inputs/outputs. This is
 * the object-cover crop math both PreviewCanvas.tsx and the legacy
 * `<video className="object-cover">` use, ported into the GL pre-fit step —
 * the piece that keeps the GL path filling the stage identically to the
 * legacy path.
 */

describe('computeObjectCoverRect', () => {
  it('same aspect (16:9 source into 16:9 destination): no crop — full source rect', () => {
    const r = computeObjectCoverRect(1280, 720, 1920, 1080);
    expect(r).toEqual({ sx: 0, sy: 0, sw: 1280, sh: 720 });
  });

  it('wider-than-destination source: crops horizontally, keeps full height, centered', () => {
    // 2:1 source (2000x1000) into 1:1 destination (1000x1000): keep height,
    // crop width to 1000, offset 500 to center.
    const r = computeObjectCoverRect(2000, 1000, 1000, 1000);
    expect(r.sh).toBe(1000);
    expect(r.sw).toBeCloseTo(1000, 6);
    expect(r.sx).toBeCloseTo(500, 6);
    expect(r.sy).toBe(0);
  });

  it('taller-than-destination source: crops vertically, keeps full width, centered', () => {
    // 1:2 source (1000x2000) into 1:1 destination: keep width, crop height to
    // 1000, offset 500 to center.
    const r = computeObjectCoverRect(1000, 2000, 1000, 1000);
    expect(r.sw).toBe(1000);
    expect(r.sh).toBeCloseTo(1000, 6);
    expect(r.sy).toBeCloseTo(500, 6);
    expect(r.sx).toBe(0);
  });

  it('portrait source into landscape destination: keeps full width, crops top/bottom', () => {
    // 720x1280 (9:16) into 1920x1080 (16:9): srcRatio 0.5625 < dstRatio 1.777,
    // so keep width 720, crop height to 720/1.777 = 405, offset (1280-405)/2.
    const r = computeObjectCoverRect(720, 1280, 1920, 1080);
    expect(r.sw).toBe(720);
    expect(r.sh).toBeCloseTo(405, 3);
    expect(r.sx).toBe(0);
    expect(r.sy).toBeCloseTo((1280 - 405) / 2, 3);
  });

  it('matches PreviewCanvas.tsx\'s own cover math exactly (frameRatio vs canvasRatio branch, same crop), so the GL path and the legacy canvas fill the stage identically', () => {
    // Reproduce PreviewCanvas.tsx's inline computation for the same inputs.
    const frameW = 1600;
    const frameH = 900;
    const canvasW = 800;
    const canvasH = 800;
    const canvasRatio = canvasW / canvasH;
    const frameRatio = frameW / frameH;
    let sx = 0;
    let sy = 0;
    let sw = frameW;
    let sh = frameH;
    if (frameRatio > canvasRatio) {
      sw = frameH * canvasRatio;
      sx = (frameW - sw) / 2;
    } else {
      sh = frameW / canvasRatio;
      sy = (frameH - sh) / 2;
    }
    expect(computeObjectCoverRect(frameW, frameH, canvasW, canvasH)).toEqual({ sx, sy, sw, sh });
  });
});
