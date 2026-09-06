import { describe, it, expect } from 'vitest';
import {
  ExportPhaseTracker,
  PHASE_THROTTLE_MS,
  type ExportPhaseToken,
} from './exportPhaseTracker';

function collect(now: { t: number }): { posted: ExportPhaseToken[]; tracker: ExportPhaseTracker } {
  const posted: ExportPhaseToken[] = [];
  const tracker = new ExportPhaseTracker((msg) => posted.push(msg), 3, () => now.t);
  return { posted, tracker };
}

describe('ExportPhaseTracker', () => {
  it('posts phase tokens in enter() order with a monotonic seq', () => {
    const now = { t: 0 };
    const { posted, tracker } = collect(now);
    tracker.enter('gl-context');
    now.t = 5;
    tracker.enter('shader-compile');
    now.t = 15;
    tracker.enter('font-init');
    now.t = 40;
    tracker.enter('encoder-ladder');
    now.t = 80;
    tracker.enter('frame-loop');
    now.t = 180;
    const breakdown = tracker.finish();

    expect(posted.map((p) => p.phase)).toEqual([
      'gl-context',
      'shader-compile',
      'font-init',
      'encoder-ladder',
      'frame-loop',
    ]);
    expect(posted.map((p) => p.seq)).toEqual([1, 2, 3, 4, 5]);
    expect(posted.every((p) => p.pieceIndex === 3)).toBe(true);
    expect(breakdown.phaseMs['gl-context']).toBe(5);
    expect(breakdown.phaseMs['shader-compile']).toBe(10);
    expect(breakdown.phaseMs['font-init']).toBe(25);
    expect(breakdown.phaseMs['encoder-ladder']).toBe(40);
    expect(breakdown.phaseMs['frame-loop']).toBe(100);
  });

  it('includes per-phase totals in finish() including add() sub-timers', () => {
    const now = { t: 0 };
    const { tracker } = collect(now);
    tracker.enter('frame-loop');
    now.t = 50;
    tracker.add('wait-dequeue', 12);
    tracker.recordDemuxSplit('asset-a', 8, 20);
    const breakdown = tracker.finish();
    expect(breakdown.phaseMs['frame-loop']).toBe(50);
    expect(breakdown.phaseMs['wait-dequeue']).toBe(12);
    expect(breakdown.demuxSplit).toEqual([{ assetId: 'asset-a', fetchMs: 8, parseMs: 20 }]);
  });

  it(`throttles pulse() to at most one post per ${PHASE_THROTTLE_MS} ms`, () => {
    const now = { t: 0 };
    const { posted, tracker } = collect(now);
    tracker.enter('frame-loop');
    expect(posted).toHaveLength(1);
    tracker.pulse();
    expect(posted).toHaveLength(1);
    now.t = PHASE_THROTTLE_MS - 1;
    tracker.pulse();
    expect(posted).toHaveLength(1);
    now.t = PHASE_THROTTLE_MS;
    tracker.pulse();
    expect(posted).toHaveLength(2);
    expect(posted[1]!.phase).toBe('frame-loop');
    expect(posted[1]!.seq).toBe(2);
  });

  it('enter() posts immediately even inside the throttle window', () => {
    const now = { t: 0 };
    const { posted, tracker } = collect(now);
    tracker.enter('gl-context');
    now.t = 10;
    tracker.enter('shader-compile');
    expect(posted.map((p) => p.phase)).toEqual(['gl-context', 'shader-compile']);
  });

  it('nests demux inside frame-loop and reports innermost phase (destructive probe)', () => {
    const now = { t: 0 };
    const { posted, tracker } = collect(now);
    tracker.enter('frame-loop');
    now.t = 100;
    tracker.enter('demux');
    expect(posted[posted.length - 1]!.phase).toBe('demux');
    now.t = 500;
    tracker.leave();
    expect(posted[posted.length - 1]!.phase).toBe('frame-loop');
    now.t = 600;
    const breakdown = tracker.finish();
    expect(breakdown.phaseMs['frame-loop']).toBe(200);
    expect(breakdown.phaseMs['demux']).toBe(400);
  });
});

describe('ExportPhaseTracker instrumentation overhead', () => {
  it('measures per-call cost of pulse() (FA-timing analogue)', () => {
    const posted: ExportPhaseToken[] = [];
    const tracker = new ExportPhaseTracker((msg) => posted.push(msg), 0);
    tracker.enter('frame-loop');
    const N = 200_000;
    const start = performance.now();
    for (let i = 0; i < N; i++) tracker.pulse();
    const elapsedMs = performance.now() - start;
    const perCallNs = (elapsedMs * 1e6) / N;
    // eslint-disable-next-line no-console
    console.log(
      `=== EXPORT PHASE TRACKER OVERHEAD (MEASURED) === ${N} pulse() calls in ${elapsedMs.toFixed(2)}ms => ${perCallNs.toFixed(1)} ns per call`,
    );
    const breakdown = tracker.finish();
    // pulse() is once per encoded frame. Fraction of a 30fps frame budget
    // (33.33ms) — the FA analogue is "well under 0.1% of run time".
    const fractionOf30fpsFrame = perCallNs / (33.33 * 1e6);
    // eslint-disable-next-line no-console
    console.log(
      `=== EXPORT PHASE TRACKER OVERHEAD FRACTION === ${perCallNs.toFixed(1)} ns / 33.33ms frame => ${(fractionOf30fpsFrame * 100).toFixed(6)}% ; instrumentationMs=${breakdown.instrumentationMs.toFixed(3)}`,
    );
    expect(perCallNs).toBeLessThan(2_000);
    expect(fractionOf30fpsFrame).toBeLessThan(0.001);
  });
});
