/**
 * The spot refusal must let the operator act: it names the segment number(s) the spot sits on
 * and the spot clip, not just an asset id.
 */
import { describe, it, expect } from 'vitest';
import { evaluateSpotPathRefusal, type SpotRenderSpec } from './spotRenderSpec';

const spec: SpotRenderSpec = { assetId: '76bc5e61-0aeb', startSec: 6, durSec: 4, xPct: 0, yPct: 0, wPct: 50, hPct: 100 };
const project = {
  segments: [
    { startTime: 0, duration: 4 },
    { startTime: 4, duration: 4 },
    { startTime: 8, duration: 4 },
    { startTime: 12, duration: 4 },
  ],
  assets: [{ id: '76bc5e61-0aeb', name: 'avatar-02.mp4' }],
};
const canvasOn = (...idx: number[]) => ({
  gateOpen: true,
  routing: {
    pieces: [0, 1, 2, 3].map((i) => ({ tier: idx.includes(i) ? ('canvas' as const) : ('gl' as const), startIndex: i, segmentCount: 1 })),
  },
});

describe('spot refusal message', () => {
  it('names the 1-based segment numbers and the spot clip', () => {
    const r = evaluateSpotPathRefusal(project, [spec], canvasOn(1, 2));
    expect(r?.message).toContain('avatar-02.mp4');
    expect(r?.message).toMatch(/segments 2, 3\b/);
    expect(r?.path).toBe('canvas');
  });

  it('a single segment reads singular', () => {
    const r = evaluateSpotPathRefusal(project, [{ ...spec, startSec: 8, durSec: 1 }], canvasOn(2));
    expect(r?.message).toMatch(/segment 3\b/);
    expect(r?.message).not.toMatch(/segments/);
  });

  it('falls back to the asset id when the clip name is unknown', () => {
    const r = evaluateSpotPathRefusal({ segments: project.segments }, [spec], canvasOn(1));
    expect(r?.message).toContain('76bc5e61-0aeb');
    expect(r?.message).toMatch(/segment 2\b/);
  });
});
