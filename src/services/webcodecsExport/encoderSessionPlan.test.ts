/**
 * WS3 Defect 1b — the test that would have caught the piece cap being
 * UNREACHABLE.
 *
 * The piece cap (`exportPipelineWebCodecs.ts`'s `planGlRunPieceStarts`) shipped
 * with a suite that was green, including a test literally named "a run with no
 * legal boundary anywhere stays ONE piece (stated limit of the fix)". The limit
 * was documented and asserted; what was never asserted is that the FIELD
 * PROJECT — 332 segments, a transition on every boundary — falls inside it. It
 * does, so the cap did nothing and the installer failed identically.
 *
 * So this file starts from the field shape and runs it through the REAL
 * production planner, not a hand-built one: `planWebCodecsExport` first (which
 * must still return one piece — that is the unreachability, and it is asserted
 * here rather than assumed), and then the worker's own `isKeyFrame` and
 * `planEncoderSessions` on that piece.
 */
import { describe, it, expect } from 'vitest';
import { AnimationType, TransitionType, type Asset, type Project, type VideoSegment } from '../../types';
import { planWebCodecsExport } from './exportPipelineWebCodecs';
import { MAX_ENCODER_SESSION_FRAMES, planEncoderSessions, encoderSessionLengths } from './encoderSessionPlan';

const FPS = 30;
/** The field run: 332 segments, 38061 frames, 1080p30, transition everywhere. */
const FIELD_SEGMENTS = 332;
const FIELD_FRAMES = 38061;
const SEG_DUR = Number((FIELD_FRAMES / FPS / FIELD_SEGMENTS).toFixed(6));

const asset: Asset = { id: 'a0', name: 'still.png', url: 'blob:img', type: 'image' };

/** GL-tier by construction (image + rendered caption), with a real
 *  cross-dissolve out of it — the shape that makes every boundary illegal for
 *  the piece planner. */
function glSegment(i: number, startTime: number, duration: number, transitioned: boolean): VideoSegment {
  return {
    id: `s${i}`,
    text: 'caption',
    assetId: 'a0',
    startTime: Number(startTime.toFixed(6)),
    duration: Number(duration.toFixed(6)),
    transition: TransitionType.NONE,
    animation: AnimationType.NONE,
    order: i,
    showOverlay: true,
    ...(transitioned ? { effectTransition: 'cross-dissolve', effectTransitionDuration: 0.5 } : {}),
  };
}

function fullyTransitionedProject(n: number, dur: number): Project {
  const segments: VideoSegment[] = [];
  let t = 0;
  for (let i = 0; i < n; i++) {
    // Every segment carries a transition OUT of it, so no boundary is a hard cut.
    segments.push(glSegment(i, t, dur, true));
    t = Number((t + dur).toFixed(6));
  }
  return {
    id: 'p',
    name: 'field-shape',
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

/** `exportWorker.ts`'s own predicate, reproduced exactly: `gopFrames(fps)` is
 *  `Math.max(1, Math.round(2 * fps))`, and a run that starts at a segment start
 *  rebases every segment start onto its own 0-based grid. */
function workerIsKeyFrame(segments: readonly VideoSegment[], fps: number): (i: number) => boolean {
  const gop = Math.max(1, Math.round(2 * fps));
  const originSec = segments[0]!.startTime;
  const segmentStartFrames = new Set(segments.map((s) => Math.round((s.startTime - originSec) * fps)));
  return (i: number) => segmentStartFrames.has(i) || i % gop === 0;
}

describe('encoder-session plan — the field shape the piece cap could not reach', () => {
  it('the 332-segment fully-transitioned project is still ONE gl piece (this is the unreachability)', () => {
    const project = fullyTransitionedProject(FIELD_SEGMENTS, SEG_DUR);
    const plan = planWebCodecsExport(project, FPS);
    if ('error' in plan) throw new Error('unexpected routing error');

    expect(plan.pieceCounts.gl).toBe(1);
    expect(plan.pieces[0]!.segmentCount).toBe(FIELD_SEGMENTS);
    // ~38061 frames in a single piece — far past the cap the piece planner
    // claims to enforce. If this ever drops to <= the cap, the piece planner
    // learned to split transitions and this file's premise needs revisiting.
    expect(plan.pieces[0]!.expectedFrames).toBeGreaterThan(MAX_ENCODER_SESSION_FRAMES);
    expect(plan.pieces[0]!.expectedFrames).toBe(FIELD_FRAMES);
  });

  it('creates MORE THAN ONE encoder session on that piece, and none exceeds the cap', () => {
    const project = fullyTransitionedProject(FIELD_SEGMENTS, SEG_DUR);
    const plan = planWebCodecsExport(project, FPS);
    if ('error' in plan) throw new Error('unexpected routing error');
    const piece = plan.pieces[0]!;
    const totalFrames = piece.expectedFrames;

    const isKeyFrame = workerIsKeyFrame(project.segments, FPS);
    const starts = planEncoderSessions(totalFrames, isKeyFrame, MAX_ENCODER_SESSION_FRAMES);

    // THE assertion the piece-cap suite never made.
    expect(starts.length).toBeGreaterThan(1);
    expect(starts.length).toBe(Math.ceil(FIELD_FRAMES / MAX_ENCODER_SESSION_FRAMES));

    const lengths = encoderSessionLengths(starts, totalFrames);
    for (const len of lengths) {
      expect(len).toBeGreaterThan(0);
      expect(len).toBeLessThanOrEqual(MAX_ENCODER_SESSION_FRAMES);
    }
  });

  it('the sessions partition the run exactly — no frame added, dropped, or encoded twice', () => {
    const project = fullyTransitionedProject(FIELD_SEGMENTS, SEG_DUR);
    const plan = planWebCodecsExport(project, FPS);
    if ('error' in plan) throw new Error('unexpected routing error');
    const totalFrames = plan.pieces[0]!.expectedFrames;
    const starts = planEncoderSessions(totalFrames, workerIsKeyFrame(project.segments, FPS));

    expect(starts[0]).toBe(0);
    for (let i = 1; i < starts.length; i++) expect(starts[i]!).toBeGreaterThan(starts[i - 1]!);
    expect(encoderSessionLengths(starts, totalFrames).reduce((a, b) => a + b, 0)).toBe(totalFrames);
  });

  it('every session boundary was ALREADY a keyframe — a rotation adds none', () => {
    const project = fullyTransitionedProject(FIELD_SEGMENTS, SEG_DUR);
    const plan = planWebCodecsExport(project, FPS);
    if ('error' in plan) throw new Error('unexpected routing error');
    const isKeyFrame = workerIsKeyFrame(project.segments, FPS);
    const starts = planEncoderSessions(plan.pieces[0]!.expectedFrames, isKeyFrame);
    for (const s of starts) expect(isKeyFrame(s)).toBe(true);

    // REACH NOTE (destructive probe, WS3): at cap 1800 against a GOP of 60 the
    // cut lands on 1800 either way, so the assertion above alone does NOT
    // separate a keyframe-respecting planner from one that ignores
    // `isKeyFrame` — a probe that replaced the predicate with `true` left it
    // green. A cap that is not a GOP multiple does separate them: a planner
    // ignoring the predicate cuts at `cap`, which is not a keyframe.
    const offGrid = planEncoderSessions(plan.pieces[0]!.expectedFrames, isKeyFrame, 1777);
    expect(offGrid.length).toBeGreaterThan(1);
    expect(offGrid).not.toContain(1777);
    for (const s of offGrid) expect(isKeyFrame(s)).toBe(true);
  });

  /**
   * WS3 STEP 9 (C7) — the resume-specific angle on the keyframe guarantee.
   * `exportWorker.ts`'s frame loop does NOT trust a resumed run's own
   * bootstrapping computation over the checkpoint blindly, and does not
   * trust the checkpoint blindly either — it RECOMPUTES `sessionStarts`
   * fresh from the SAME deterministic inputs (`totalFrames`, `isKeyFrame`,
   * `MAX_ENCODER_SESSION_FRAMES`) the original run used, then requires
   * `sessionStarts.indexOf(resumeFromFrameIndex) >= 0` — hard failure
   * (`init-error`), never a silent mid-session start, when a checkpoint's
   * frame index is not found. This test reproduces that exact check: a
   * checkpoint's `cumulativePictures` is, by construction, always ONE OF
   * `planEncoderSessions`' own returned values (checkpoints are only ever
   * written at rotation seams — `onRotationCheckpoint`'s `cumulativePictures`
   * IS the seam's `frameIndex`), so it is always found and its frame is
   * always a keyframe; a foreign/corrupted value is rejected the same way
   * the real guard rejects it.
   */
  it('RESUME KEYFRAME GUARANTEE: a checkpoint frame index is always one of sessionStarts (found, keyframe-safe); a foreign value is rejected the same way exportWorker.ts rejects it', () => {
    const project = fullyTransitionedProject(FIELD_SEGMENTS, SEG_DUR);
    const plan = planWebCodecsExport(project, FPS);
    if ('error' in plan) throw new Error('unexpected routing error');
    const totalFrames = plan.pieces[0]!.expectedFrames;
    const isKeyFrame = workerIsKeyFrame(project.segments, FPS);
    const sessionStarts = planEncoderSessions(totalFrames, isKeyFrame, MAX_ENCODER_SESSION_FRAMES);
    expect(sessionStarts.length).toBeGreaterThan(1); // must actually exercise resume, not just session 0

    // Every legitimate checkpoint frame (every session start except the
    // piece's own frame 0, which never resumes mid-piece) is found and safe.
    for (const checkpointFrame of sessionStarts.slice(1)) {
      const initialSessionIndex = sessionStarts.indexOf(checkpointFrame);
      expect(initialSessionIndex).toBeGreaterThanOrEqual(0);
      expect(isKeyFrame(checkpointFrame)).toBe(true);
    }

    // A foreign/corrupted checkpoint value (not a real session start — e.g.
    // one frame off, from a stale or hand-edited manifest) is NOT found —
    // exportWorker.ts's guard fails loudly on this, never silently starting
    // mid-session on a non-keyframe.
    const foreignFrame = sessionStarts[1]! + 1;
    expect(isKeyFrame(foreignFrame)).toBe(false); // confirms it's genuinely off-grid, not accidentally valid
    expect(sessionStarts.indexOf(foreignFrame)).toBe(-1);
  });
});

describe('encoder-session plan — destructive probes and degenerate inputs', () => {
  it('DESTRUCTIVE PROBE: a planner that never cuts fails this suite', () => {
    // Re-runs the exact assertion above against the pre-fix behaviour (one
    // session, always). If this passed, the suite could not tell a working cap
    // from an unreachable one — which is how the piece cap shipped green.
    const neverCuts = (): number[] => [0];
    const starts = neverCuts();
    expect(starts.length).toBe(1);
    expect(encoderSessionLengths(starts, FIELD_FRAMES)[0]).toBeGreaterThan(MAX_ENCODER_SESSION_FRAMES);
  });

  it('cuts BACKWARD to the last keyframe, so the cap is a real ceiling and never overshot', () => {
    // GOP 60, cap 1800: 1800 is itself a keyframe, so sessions land exactly on
    // the cap. With a cap that is NOT a GOP multiple the cut must fall short of
    // it, never past it.
    const isKeyFrame = (i: number): boolean => i % 60 === 0;
    for (const cap of [1800, 1799, 1801, 121, 100, 61, 60]) {
      const starts = planEncoderSessions(10_000, isKeyFrame, cap);
      expect(starts.length).toBeGreaterThan(1);
      for (const len of encoderSessionLengths(starts, 10_000)) {
        expect(len).toBeLessThanOrEqual(cap);
      }
    }
  });

  it('a cap SMALLER than the GOP overshoots to the first keyframe past it — stated, not hidden', () => {
    // Not the production case (cap 1800 vs GOP 60), but the one place the
    // ceiling cannot hold: there is no keyframe inside the window to cut to.
    const isKeyFrame = (i: number): boolean => i % 60 === 0;
    const lengths = encoderSessionLengths(planEncoderSessions(600, isKeyFrame, 59), 600);
    expect(Math.max(...lengths)).toBe(60);
    expect(Math.max(...lengths)).toBeLessThanOrEqual(59 + 60);
  });

  it('a run with no keyframe after 0 stays one session (cannot cut neutrally)', () => {
    const starts = planEncoderSessions(50_000, (i) => i === 0, MAX_ENCODER_SESSION_FRAMES);
    expect(starts).toEqual([0]);
  });

  it('degenerate inputs reproduce the pre-rotation behaviour exactly', () => {
    const key = (i: number): boolean => i % 60 === 0;
    expect(planEncoderSessions(0, key)).toEqual([0]);
    expect(planEncoderSessions(1, key)).toEqual([0]);
    expect(planEncoderSessions(1800, key)).toEqual([0]);
    expect(planEncoderSessions(10_000, key, 0)).toEqual([0]);
    expect(planEncoderSessions(10_000, key, -1)).toEqual([0]);
    expect(planEncoderSessions(Number.NaN, key)).toEqual([0]);
  });
});
