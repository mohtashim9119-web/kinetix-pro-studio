/**
 * WS3 Defect 1 — the encoder-session cap in `buildPiecePlans`.
 *
 * Field evidence this pins: a 334-segment 1080p30 export collapsed to a single
 * `pieceIndex 0` and ran ONE VideoEncoder session across 38061 frames
 * (1268.7s of timeline) before the watchdog fired in `encoder-flush`. There
 * was no bound of any kind on piece duration, frame count, or encoder-session
 * length.
 *
 * These are STRUCTURAL tests of the planner only — they run no encoder, no
 * worker, and no export. What they can prove is exactly what the cap claims by
 * construction: pieces are bounded, per-piece frame counts telescope to the
 * unsplit total, and every boundary lands on a hard cut.
 */
import { describe, it, expect } from 'vitest';
import { AnimationType, TransitionType, type Asset, type Project, type VideoSegment } from '../../types';
import { planWebCodecsExport, MAX_ENCODER_SESSION_FRAMES } from './exportPipelineWebCodecs';

const asset: Asset = { id: 'a0', name: 'still.png', url: 'blob:img', type: 'image' };

/** GL-tier by construction: an image with a rendered caption (see
 *  planWebCodecsExport.test.ts — showOverlay + text is the minimum change that
 *  moves an image out of Tier 1 and into GL). */
function glSegment(i: number, startTime: number, duration: number, transition?: { slug: string; sec: number }): VideoSegment {
  return {
    id: `s${i}`,
    text: 'caption',
    assetId: 'a0',
    startTime: Number(startTime.toFixed(3)),
    duration: Number(duration.toFixed(3)),
    transition: TransitionType.NONE,
    animation: AnimationType.NONE,
    order: i,
    showOverlay: true,
    ...(transition ? { effectTransition: transition.slug, effectTransitionDuration: transition.sec } : {}),
  };
}

function makeProject(segments: VideoSegment[]): Project {
  return {
    id: 'p',
    name: 't',
    script: '',
    sceneDetails: '',
    segments,
    assets: [asset],
    globalTransition: TransitionType.NONE,
    globalTransitionDuration: 0,
    globalAnimation: AnimationType.NONE,
    globalOverlayConfig: { color: '#fff', backgroundColor: '#000', fontFamily: 'Inter' },
  };
}

/** N contiguous hard-cut GL segments of `dur` seconds each, starting at 0. */
function hardCutRun(n: number, dur: number): VideoSegment[] {
  const out: VideoSegment[] = [];
  let t = 0;
  for (let i = 0; i < n; i++) {
    out.push(glSegment(i, t, dur));
    t = Number((t + dur).toFixed(3));
  }
  return out;
}

const FPS = 30;

describe('encoder-session cap — piece planning', () => {
  it('a run under the cap is still exactly one piece, on its own origin (pre-cap behaviour preserved)', () => {
    const segments = hardCutRun(10, 3);
    const plan = planWebCodecsExport(makeProject(segments), FPS);
    expect('error' in plan).toBe(false);
    if ('error' in plan) return;
    expect(plan.pieceCounts.gl).toBe(1);
    expect(plan.pieces[0]!.gridBaseFrame).toBe(0);
    expect(plan.pieces[0]!.gridOriginSec).toBe(0);
    expect(plan.pieces[0]!.expectedFrames).toBe(Math.round(30 * FPS));
  });

  it('bounds every GL piece at MAX_ENCODER_SESSION_FRAMES (the 334-segment/38061-frame shape)', () => {
    // 334 segments x 3.799s ~= 1268.7s ~= 38061 frames at 30fps — the field run.
    const segments = hardCutRun(334, 3.799);
    const totalSec = segments[333]!.startTime + segments[333]!.duration;
    const plan = planWebCodecsExport(makeProject(segments), FPS);
    expect('error' in plan).toBe(false);
    if ('error' in plan) return;

    // Destructive-probe posture: assert the split actually HAPPENS, so a green
    // run here cannot be the vacuous "one piece, trivially under the cap".
    expect(plan.pieceCounts.gl).toBeGreaterThan(1);
    for (const piece of plan.pieces) {
      expect(piece.expectedFrames).toBeLessThanOrEqual(MAX_ENCODER_SESSION_FRAMES);
    }
    // The whole timeline is still covered, once.
    expect(plan.pieces.reduce((n, p) => n + p.segmentCount, 0)).toBe(334);
    // Frame counts TELESCOPE to the single number the unsplit run produced.
    const unsplitTotal = Math.round(totalSec * FPS);
    expect(plan.pieces.reduce((n, p) => n + p.expectedFrames, 0)).toBe(unsplitTotal);
  });

  it('every piece begins on the shared absolute grid at its own segment start (no re-rounding)', () => {
    const segments = hardCutRun(334, 3.799);
    const plan = planWebCodecsExport(makeProject(segments), FPS);
    if ('error' in plan) throw new Error('unexpected routing error');
    let expectedBase = 0;
    for (const piece of plan.pieces) {
      expect(piece.gridOriginSec).toBe(0);
      expect(piece.gridBaseFrame).toBe(expectedBase);
      expectedBase += piece.expectedFrames;
    }
    expect(expectedBase).toBe(Math.round((segments[333]!.startTime + segments[333]!.duration) * FPS));
  });

  it('never cuts where a transition straddles the boundary — the boundary moves, not the transition', () => {
    // Alternating: every ODD-indexed segment carries a real cross-dissolve out
    // of it, so index i+1 is an ILLEGAL boundary for every odd i. Legal
    // boundaries are therefore only the odd indices themselves.
    const segments: VideoSegment[] = [];
    let t = 0;
    for (let i = 0; i < 334; i++) {
      const withTransition = i % 2 === 1;
      segments.push(glSegment(i, t, 3.799, withTransition ? { slug: 'cross-dissolve', sec: 0.5 } : undefined));
      t = Number((t + 3.799).toFixed(3));
    }
    const plan = planWebCodecsExport(makeProject(segments), FPS);
    if ('error' in plan) throw new Error('unexpected routing error');
    expect(plan.pieceCounts.gl).toBeGreaterThan(1);
    for (const piece of plan.pieces.slice(1)) {
      const prev = segments[piece.startIndex - 1]!;
      // The segment BEFORE every boundary must have no outgoing transition.
      expect(prev.effectTransition).toBeUndefined();
    }
  });

  it('a run with no legal boundary anywhere stays ONE piece (stated limit of the fix)', () => {
    // Every segment carries a real transition out of it, so no index is a hard
    // cut and the run cannot be split output-neutrally.
    const segments: VideoSegment[] = [];
    let t = 0;
    for (let i = 0; i < 334; i++) {
      segments.push(glSegment(i, t, 3.799, { slug: 'cross-dissolve', sec: 0.5 }));
      t = Number((t + 3.799).toFixed(3));
    }
    const plan = planWebCodecsExport(makeProject(segments), FPS);
    if ('error' in plan) throw new Error('unexpected routing error');
    expect(plan.pieceCounts.gl).toBe(1);
    expect(plan.pieces[0]!.expectedFrames).toBeGreaterThan(MAX_ENCODER_SESSION_FRAMES);
  });

  it('a single segment longer than the cap is still one piece (nothing to cut inside a segment)', () => {
    const segments = [glSegment(0, 0, 300)];
    const plan = planWebCodecsExport(makeProject(segments), FPS);
    if ('error' in plan) throw new Error('unexpected routing error');
    expect(plan.pieceCounts.gl).toBe(1);
    expect(plan.pieces[0]!.expectedFrames).toBe(300 * FPS);
  });
});
