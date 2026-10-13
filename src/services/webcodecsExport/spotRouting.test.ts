/**
 * Spot-aware routing — a segment under a spot window is never plain.
 *
 * Field case (Avatar, 4 spots over plain IMAGE segments, captions off, no effects): the
 * router, blind to spots, planned those segments plain and the spot guard then refused the
 * export. The plan must instead send a spot-overlapped, gl-compositable segment to gl, and
 * keep refusing (naming it) where no spot-capable path exists.
 */
import { describe, it, expect } from 'vitest';
import { AnimationType, TransitionType, type Asset, type Project, type VideoSegment } from '../../types';
import { planWebCodecsExport, type WebCodecsRoutingSummary } from './exportPipelineWebCodecs';
import { evaluateSpotPathRefusal, type SpotRenderSpec } from './spotRenderSpec';

const FPS = 24;
const assets: Asset[] = [{ id: 'img', name: 'still.png', url: 'blob:img', type: 'image' }];

function seg(i: number, startTime: number, duration: number, extra: Partial<VideoSegment> = {}): VideoSegment {
  return {
    id: `s${i}`,
    text: 't',
    assetId: 'img',
    startTime,
    duration,
    transition: TransitionType.NONE,
    animation: AnimationType.NONE,
    order: i,
    showOverlay: false,
    ...extra,
  };
}

function project(segments: VideoSegment[]): Project {
  return {
    id: 'p',
    name: 't',
    script: '',
    sceneDetails: '',
    segments,
    assets,
    globalTransition: TransitionType.NONE,
    globalTransitionDuration: 0,
    globalAnimation: AnimationType.NONE,
    globalOverlayConfig: { color: '#fff', backgroundColor: '#000', fontFamily: 'Inter' },
  };
}

/** Six contiguous 4 s plain-image segments: [0,4) [4,8) [8,12) [12,16) [16,20) [20,24). */
const plainSix = (): VideoSegment[] => [0, 1, 2, 3, 4, 5].map((i) => seg(i, i * 4, 4));

function spec(startSec: number, durSec: number): SpotRenderSpec {
  return { assetId: 'spot', startSec, durSec, xPct: 0, yPct: 0, wPct: 50, hPct: 100 };
}

function plan(p: Project, specs?: SpotRenderSpec[]): WebCodecsRoutingSummary {
  const r = (planWebCodecsExport as unknown as (p: Project, fps: number, s?: SpotRenderSpec[]) => WebCodecsRoutingSummary | { error: unknown })(p, FPS, specs);
  if ('error' in r) throw new Error('plan error');
  return r;
}

const tierOfSegment = (r: WebCodecsRoutingSummary, index: number): string =>
  r.pieces.find((pc) => index >= pc.startIndex && index < pc.startIndex + pc.segmentCount)!.tier;

describe('spot-aware routing', () => {
  it('(1) Avatar-shaped: segments under spots plan as gl and the refusal does not fire', () => {
    const p = project(plainSix());
    const specs = [spec(4, 3.5), spec(12, 3.5)];
    const r = plan(p, specs);
    expect(tierOfSegment(r, 1)).toBe('gl');
    expect(tierOfSegment(r, 3)).toBe('gl');
    expect(tierOfSegment(r, 0)).toBe('plain');
    expect(tierOfSegment(r, 2)).toBe('plain');
    expect(evaluateSpotPathRefusal(p, specs, { gateOpen: true, routing: r })).toBeNull();
  });

  it('(2) zero spots: the plan of a mixed spot-free project is pinned', () => {
    const segs = [
      seg(0, 0, 4),
      seg(1, 4, 4, { showOverlay: true }),
      seg(2, 8, 4, { effectAnimation: 'sepia' }),
      seg(3, 12, 4),
    ];
    const expected = [
      { tier: 'plain', startIndex: 0, segmentCount: 1, expectedFrames: 96, gridOriginSec: 0, gridBaseFrame: 0 },
      { tier: 'gl', startIndex: 1, segmentCount: 1, expectedFrames: 96, gridOriginSec: 4, gridBaseFrame: 0 },
      { tier: 'canvas', startIndex: 2, segmentCount: 1, expectedFrames: 96, gridOriginSec: 8, gridBaseFrame: 0 },
      { tier: 'plain', startIndex: 3, segmentCount: 1, expectedFrames: 96, gridOriginSec: 12, gridBaseFrame: 0 },
    ];
    expect(plan(project(segs)).pieces).toEqual(expected);
    expect(plan(project(segs), []).pieces).toEqual(expected);
    expect(plan(project(segs)).segmentCounts).toEqual({ plain: 2, gl: 1, canvas: 1 });
  });

  it('(3) a spot over a non-gl-compositable segment still refuses', () => {
    const segs = plainSix();
    segs[2] = seg(2, 8, 4, { effectAnimation: 'sepia' });
    const p = project(segs);
    const specs = [spec(8, 2)];
    const r = plan(p, specs);
    expect(tierOfSegment(r, 2)).toBe('canvas');
    const refusal = evaluateSpotPathRefusal(p, specs, { gateOpen: true, routing: r });
    expect(refusal?.path).toBe('canvas');
  });

  it('(4) a spot spanning two segments promotes both', () => {
    const r = plan(project(plainSix()), [spec(6, 4)]); // 6..10 covers s1 [4,8) and s2 [8,12)
    expect(tierOfSegment(r, 1)).toBe('gl');
    expect(tierOfSegment(r, 2)).toBe('gl');
    expect(tierOfSegment(r, 0)).toBe('plain');
    expect(tierOfSegment(r, 3)).toBe('plain');
  });

  it('(5) a spot that only touches a segment boundary does not promote', () => {
    const r = plan(project(plainSix()), [spec(4, 4)]); // exactly [4,8) = s1; s0 and s2 only touch
    expect(tierOfSegment(r, 1)).toBe('gl');
    expect(tierOfSegment(r, 0)).toBe('plain');
    expect(tierOfSegment(r, 2)).toBe('plain');
  });

  it('(6) a spot over an already-gl segment changes nothing', () => {
    const segs = plainSix();
    segs[1] = seg(1, 4, 4, { showOverlay: true });
    const before = plan(project(segs));
    const after = plan(project(segs), [spec(4, 3)]);
    expect(after).toEqual(before);
  });

  it('(7) EVERY segment overlapping ANY spec is promoted, not just the first', () => {
    const specs = [spec(1, 1), spec(9, 6), spec(21, 2)]; // s0 | s2,s3 | s5
    const r = plan(project(plainSix()), specs);
    const tiers = [0, 1, 2, 3, 4, 5].map((i) => tierOfSegment(r, i));
    expect(tiers).toEqual(['gl', 'plain', 'gl', 'gl', 'plain', 'gl']);
  });

  it('(8) planner and guard share one spec set: no spec shape both plans and refuses a gl-eligible project', () => {
    const p = project(plainSix());
    for (const specs of [[spec(0, 24)], [spec(3.9, 0.2)], [spec(7.99, 0.02)], [spec(23, 1)]]) {
      const r = plan(p, specs);
      expect(evaluateSpotPathRefusal(p, specs, { gateOpen: true, routing: r })).toBeNull();
    }
  });

  it('(9) a spot changes the piece plan itself, so a checkpoint cut from a spot-blind plan cannot be matched piece for piece', () => {
    const p = project(plainSix());
    const blind = plan(p);
    const aware = plan(p, [spec(4, 3.5)]);
    expect(aware.pieces.map((x) => x.tier)).not.toEqual(blind.pieces.map((x) => x.tier));
    // resume discovery compares per-piece expected frames and piece count against the checkpoint
    expect(aware.pieces.map((x) => x.startIndex)).toEqual(blind.pieces.map((x) => x.startIndex));
    expect(aware.pieceCounts).toEqual({ plain: 5, gl: 1, canvas: 0 });
  });
});
