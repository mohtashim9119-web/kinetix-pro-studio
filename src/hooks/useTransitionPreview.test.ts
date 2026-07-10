import { describe, it, expect } from 'vitest';
import { resolveRetainedBlend, type RetainedBlend } from './useTransitionPreview';
import { TransitionType } from '../types';

/**
 * resolveRetainedBlend — the fix for the video-video pre-boundary blend gap
 * on the legacy preview path (docs/webgl-architecture-plan.md's
 * "video-video transition blend gap" closeout entry). Pure and generic over
 * the canvas type, so it's directly unit-testable with plain sentinel
 * objects standing in for HTMLCanvasElement (this repo has no jsdom — same
 * no-DOM-runtime precedent as every other pure helper in this file/
 * useWebCodecsPreview.ts). Simulates a "snapshotsReady deferred" video-video
 * boundary by driving the same (prevRetained, input) sequence the hook
 * itself would produce tick by tick.
 */
describe('resolveRetainedBlend', () => {
  const canvasA = { id: 'canvas-a' };
  const canvasB = { id: 'canvas-b' };
  const canvasC = { id: 'canvas-c' };
  const canvasD = { id: 'canvas-d' };

  it('first transition ever, nothing retained yet, snapshots not ready: no fallback available — reports inactive (same as pre-fix behavior)', () => {
    const result = resolveRetainedBlend(null, {
      inTransitionWindow: true,
      snapshotsReady: false,
      outgoing: null,
      incoming: null,
      progress: 0.1,
      effectiveTransition: 'cross-dissolve',
    });
    expect(result.isActive).toBe(false);
    expect(result.outgoing).toBeNull();
    expect(result.incoming).toBeNull();
    expect(result.nextRetained).toBeNull();
  });

  it('once snapshots are ready inside the window, composites live and captures the retained state', () => {
    const result = resolveRetainedBlend(null, {
      inTransitionWindow: true,
      snapshotsReady: true,
      outgoing: canvasA,
      incoming: canvasB,
      progress: 0.3,
      effectiveTransition: 'cross-dissolve',
    });
    expect(result.isActive).toBe(true);
    expect(result.outgoing).toBe(canvasA);
    expect(result.incoming).toBe(canvasB);
    expect(result.progress).toBe(0.3);
    expect(result.nextRetained).toEqual({
      outgoing: canvasA,
      incoming: canvasB,
      progress: 0.3,
      effectiveTransition: 'cross-dissolve',
    });
  });

  it('THE FIX — video-video pre-boundary: entering a NEW boundary window before its own snapshot pair lands retains and freezes the PREVIOUS boundary\'s last good composited frame instead of dropping to inactive', () => {
    // Tick 1: previous boundary (A->B) was fully live and composited.
    const tick1 = resolveRetainedBlend(null, {
      inTransitionWindow: true,
      snapshotsReady: true,
      outgoing: canvasA,
      incoming: canvasB,
      progress: 0.9,
      effectiveTransition: 'cross-dissolve',
    });

    // Tick 2: currentTime has entered a NEW boundary (B->C, video-video) whose
    // own snapshot pair hasn't landed yet — this is exactly the miss-the-lead
    // scenario the audit found (up to 4 concurrent decode/seek ops racing
    // PRE_ROLL_LEAD_S on constrained hardware).
    const tick2 = resolveRetainedBlend(tick1.nextRetained, {
      inTransitionWindow: true,
      snapshotsReady: false,
      outgoing: null,
      incoming: null,
      progress: 0.05, // the new boundary's own live progress — must NOT leak into the retained output
      effectiveTransition: 'dip-black', // the new boundary's own type — must NOT leak into the retained output either
    });

    expect(tick2.isActive).toBe(true); // overlay stays visible — no hard cut to bare A
    expect(tick2.outgoing).toBe(canvasA); // frozen at the PREVIOUS boundary's last good frame
    expect(tick2.incoming).toBe(canvasB);
    expect(tick2.progress).toBe(0.9); // frozen, not the new boundary's half-formed live progress
    expect(tick2.effectiveTransition).toBe('cross-dissolve'); // frozen, matches the frozen canvases
  });

  it('resumes live blending seamlessly the instant the new boundary\'s real snapshot pair lands — no separate "was retained" flag or pop-triggering state', () => {
    const retained: RetainedBlend<{ id: string }> = {
      outgoing: canvasA,
      incoming: canvasB,
      progress: 0.9,
      effectiveTransition: TransitionType.NONE,
    };
    const result = resolveRetainedBlend(retained, {
      inTransitionWindow: true,
      snapshotsReady: true,
      outgoing: canvasC,
      incoming: canvasD,
      progress: 0.15,
      effectiveTransition: 'light-leak',
    });
    expect(result.isActive).toBe(true);
    expect(result.outgoing).toBe(canvasC);
    expect(result.incoming).toBe(canvasD);
    expect(result.progress).toBe(0.15);
    expect(result.effectiveTransition).toBe('light-leak');
    expect(result.nextRetained).toEqual({
      outgoing: canvasC,
      incoming: canvasD,
      progress: 0.15,
      effectiveTransition: 'light-leak',
    });
  });

  it('leaving the transition window entirely (normal mid-segment playback) reports inactive regardless of retained state, without discarding it', () => {
    const retained: RetainedBlend<{ id: string }> = {
      outgoing: canvasA,
      incoming: canvasB,
      progress: 1,
      effectiveTransition: 'cross-dissolve',
    };
    const result = resolveRetainedBlend(retained, {
      inTransitionWindow: false,
      snapshotsReady: false,
      outgoing: null,
      incoming: null,
      progress: 0,
      effectiveTransition: TransitionType.NONE,
    });
    expect(result.isActive).toBe(false);
    expect(result.outgoing).toBeNull();
    expect(result.incoming).toBeNull();
    // Retained state is preserved (not cleared) — a later boundary re-entering
    // the window while its own snapshot is still loading can still fall back
    // to it rather than to nothing.
    expect(result.nextRetained).toBe(retained);
  });

  it('a retained frame from a much earlier boundary is still preferred over bare-outgoing when a later boundary is also slow to snapshot', () => {
    const veryOldRetained: RetainedBlend<{ id: string }> = {
      outgoing: canvasA,
      incoming: canvasB,
      progress: 0.7,
      effectiveTransition: 'dip-white',
    };
    const result = resolveRetainedBlend(veryOldRetained, {
      inTransitionWindow: true,
      snapshotsReady: false,
      outgoing: null,
      incoming: null,
      progress: 0.4,
      effectiveTransition: 'cross-dissolve',
    });
    expect(result.isActive).toBe(true);
    expect(result.outgoing).toBe(canvasA);
    expect(result.incoming).toBe(canvasB);
  });

  it('only ONE side ready (e.g. outgoing snapshot landed, incoming did not) does not count as freshly active — still falls back to retention rather than compositing a half-populated pair', () => {
    const retained: RetainedBlend<{ id: string }> = {
      outgoing: canvasA,
      incoming: canvasB,
      progress: 0.5,
      effectiveTransition: 'cross-dissolve',
    };
    const result = resolveRetainedBlend(retained, {
      inTransitionWindow: true,
      snapshotsReady: false,
      outgoing: canvasC,
      incoming: null,
      progress: 0.05,
      effectiveTransition: 'dip-black',
    });
    expect(result.isActive).toBe(true);
    expect(result.outgoing).toBe(canvasA); // retained pair, not the half-populated live one
    expect(result.incoming).toBe(canvasB);
  });
});
