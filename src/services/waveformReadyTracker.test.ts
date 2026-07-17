import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  beginGeneration,
  getCurrentGeneration,
  markSegmentReady,
  markSegmentFailed,
  getSnapshot,
  subscribe,
  onAllReady,
  _resetWaveformReadyTrackerForTests,
} from './waveformReadyTracker';

beforeEach(() => {
  _resetWaveformReadyTrackerForTests();
});

afterEach(() => {
  _resetWaveformReadyTrackerForTests();
  delete (globalThis as unknown as { __WF_INSTRUMENT__?: boolean }).__WF_INSTRUMENT__;
  delete (globalThis as unknown as { __wfReadyEvents?: unknown[] }).__wfReadyEvents;
});

describe('waveformReadyTracker — registering a generation', () => {
  it('registers the expected count, starting at zero ready/failed', () => {
    beginGeneration(294);
    const snap = getSnapshot();
    expect(snap.expected).toBe(294);
    expect(snap.ready).toBe(0);
    expect(snap.failed).toBe(0);
    expect(snap.settled).toBe(0);
    expect(snap.allReady).toBe(false);
  });

  it('bumps the generation on every call, even with the same expected count', () => {
    const g1 = beginGeneration(10);
    const g2 = beginGeneration(10);
    expect(g2).toBe(g1 + 1);
    expect(getCurrentGeneration()).toBe(g2);
  });

  it('an expected count of 0 is trivially all-ready immediately', () => {
    beginGeneration(0);
    const snap = getSnapshot();
    expect(snap.allReady).toBe(true);
  });

  it('a negative expected count is clamped to 0', () => {
    beginGeneration(-5);
    expect(getSnapshot().expected).toBe(0);
    expect(getSnapshot().allReady).toBe(true);
  });
});

describe('waveformReadyTracker — marking segments ready/failed', () => {
  it('marking a segment ready increments the ready count', () => {
    const gen = beginGeneration(3);
    markSegmentReady(gen, 'seg-1');
    const snap = getSnapshot();
    expect(snap.ready).toBe(1);
    expect(snap.settled).toBe(1);
    expect(snap.allReady).toBe(false);
  });

  it('marking a segment failed counts toward settlement, not toward ready', () => {
    const gen = beginGeneration(2);
    markSegmentReady(gen, 'seg-1');
    markSegmentFailed(gen, 'seg-2');
    const snap = getSnapshot();
    expect(snap.ready).toBe(1);
    expect(snap.failed).toBe(1);
    expect(snap.settled).toBe(2);
    expect(snap.allReady).toBe(true); // a failure still settles the segment
  });

  it('marking the same segment id twice is idempotent (Set semantics)', () => {
    const gen = beginGeneration(2);
    markSegmentReady(gen, 'seg-1');
    markSegmentReady(gen, 'seg-1');
    expect(getSnapshot().ready).toBe(1);
  });

  it('a later failed report for a previously-ready id moves it to failed (mutual exclusivity)', () => {
    const gen = beginGeneration(1);
    markSegmentReady(gen, 'seg-1');
    markSegmentFailed(gen, 'seg-1');
    const snap = getSnapshot();
    expect(snap.ready).toBe(0);
    expect(snap.failed).toBe(1);
    expect(snap.settled).toBe(1);
  });

  it('a later ready report for a previously-failed id moves it to ready', () => {
    const gen = beginGeneration(1);
    markSegmentFailed(gen, 'seg-1');
    markSegmentReady(gen, 'seg-1');
    const snap = getSnapshot();
    expect(snap.ready).toBe(1);
    expect(snap.failed).toBe(0);
  });
});

describe('waveformReadyTracker — all-ready fires exactly once per generation', () => {
  it('fires the all-ready callback exactly once when settled reaches expected', () => {
    const gen = beginGeneration(3);
    const cb = vi.fn();
    onAllReady(cb);

    markSegmentReady(gen, 'a');
    expect(cb).not.toHaveBeenCalled();
    markSegmentReady(gen, 'b');
    expect(cb).not.toHaveBeenCalled();
    markSegmentReady(gen, 'c');
    expect(cb).toHaveBeenCalledTimes(1);
    expect(cb).toHaveBeenCalledWith(expect.objectContaining({ generation: gen, ready: 3, expected: 3, allReady: true }));
  });

  it('does not re-fire when additional (redundant) reports land after all-ready', () => {
    const gen = beginGeneration(1);
    const cb = vi.fn();
    onAllReady(cb);

    markSegmentReady(gen, 'a');
    expect(cb).toHaveBeenCalledTimes(1);

    // A resize-drag redraw of the same already-settled segment re-reports —
    // must not re-fire all-ready for the same generation.
    markSegmentReady(gen, 'a');
    markSegmentFailed(gen, 'a');
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it('fires immediately for a 0-expected generation (no voiceover)', () => {
    const cb = vi.fn();
    onAllReady(cb);
    beginGeneration(0);
    expect(cb).toHaveBeenCalledTimes(1);
    expect(cb).toHaveBeenCalledWith(expect.objectContaining({ expected: 0, allReady: true }));
  });

  it('a mix of ready and failed reaching expected fires all-ready once', () => {
    const gen = beginGeneration(2);
    const cb = vi.fn();
    onAllReady(cb);
    markSegmentReady(gen, 'a');
    markSegmentFailed(gen, 'b');
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it('unsubscribing onAllReady stops future callbacks', () => {
    const gen = beginGeneration(2);
    const cb = vi.fn();
    const unsubscribe = onAllReady(cb);
    unsubscribe();
    markSegmentReady(gen, 'a');
    markSegmentReady(gen, 'b');
    expect(cb).not.toHaveBeenCalled();
  });
});

describe('waveformReadyTracker — stale-generation completions are ignored', () => {
  it('a completion tagged with a previous generation does not affect the current count', () => {
    const staleGen = beginGeneration(5);
    const currentGen = beginGeneration(5); // a resync started before the first batch finished

    markSegmentReady(staleGen, 'from-old-sync');

    const snap = getSnapshot();
    expect(snap.generation).toBe(currentGen);
    expect(snap.ready).toBe(0);
    expect(snap.settled).toBe(0);
  });

  it('stale completions cannot trigger a false all-ready for the new generation', () => {
    const staleGen = beginGeneration(1);
    const cb = vi.fn();
    beginGeneration(3); // new, larger batch
    onAllReady(cb);

    // All 1 of the stale generation's segments "complete" — must not satisfy
    // the new generation's expected count of 3.
    markSegmentReady(staleGen, 'old-a');
    markSegmentFailed(staleGen, 'old-b');

    expect(cb).not.toHaveBeenCalled();
    expect(getSnapshot().settled).toBe(0);
  });

  it('a stale failed report is also ignored', () => {
    const staleGen = beginGeneration(2);
    beginGeneration(2);
    markSegmentFailed(staleGen, 'old-a');
    expect(getSnapshot().failed).toBe(0);
  });
});

describe('waveformReadyTracker — reset and re-fire on a second sync', () => {
  it('a second beginGeneration resets ready/failed/expected and re-arms all-ready', () => {
    const gen1 = beginGeneration(2);
    const cb = vi.fn();
    onAllReady(cb);
    markSegmentReady(gen1, 'a');
    markSegmentReady(gen1, 'b');
    expect(cb).toHaveBeenCalledTimes(1);

    const gen2 = beginGeneration(4);
    expect(getSnapshot()).toEqual(
      expect.objectContaining({ generation: gen2, expected: 4, ready: 0, failed: 0, settled: 0, allReady: false }),
    );

    markSegmentReady(gen2, 'c');
    markSegmentReady(gen2, 'd');
    markSegmentReady(gen2, 'e');
    expect(cb).toHaveBeenCalledTimes(1); // not yet — only 3 of 4
    markSegmentReady(gen2, 'f');
    expect(cb).toHaveBeenCalledTimes(2); // fired again, for the new generation
    expect(cb).toHaveBeenLastCalledWith(expect.objectContaining({ generation: gen2, allReady: true }));
  });

  it('does not leak ready ids across generations even when segment ids are reused', () => {
    const gen1 = beginGeneration(1);
    markSegmentReady(gen1, 'seg-shared-id');
    expect(getSnapshot().ready).toBe(1);

    beginGeneration(2); // fresh generation; same id may appear again this batch
    expect(getSnapshot().ready).toBe(0);
  });
});

describe('waveformReadyTracker — general subscribe()', () => {
  it('notifies subscribers on begin/ready/failed', () => {
    const cb = vi.fn();
    const unsubscribe = subscribe(cb);
    const gen = beginGeneration(2);
    markSegmentReady(gen, 'a');
    markSegmentFailed(gen, 'b');
    expect(cb.mock.calls.length).toBeGreaterThanOrEqual(3);
    unsubscribe();
  });

  it('unsubscribe stops further notifications', () => {
    const cb = vi.fn();
    const unsubscribe = subscribe(cb);
    unsubscribe();
    const gen = beginGeneration(1);
    markSegmentReady(gen, 'a');
    expect(cb).not.toHaveBeenCalled();
  });

  it('does not notify subscribers for an ignored stale report', () => {
    const staleGen = beginGeneration(1);
    beginGeneration(1);
    const cb = vi.fn();
    subscribe(cb);
    markSegmentReady(staleGen, 'old');
    expect(cb).not.toHaveBeenCalled();
  });
});

describe('waveformReadyTracker — dormant instrumentation', () => {
  it('is silent by default (no console output, no globalThis event log)', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const gen = beginGeneration(1);
    markSegmentReady(gen, 'a');
    expect(spy).not.toHaveBeenCalled();
    expect((globalThis as unknown as { __wfReadyEvents?: unknown[] }).__wfReadyEvents).toBeUndefined();
    spy.mockRestore();
  });

  it('logs event records when __WF_INSTRUMENT__ is enabled, without throwing', () => {
    (globalThis as unknown as { __WF_INSTRUMENT__?: boolean }).__WF_INSTRUMENT__ = true;
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});

    expect(() => {
      const gen = beginGeneration(1);
      markSegmentReady(gen, 'a');
    }).not.toThrow();

    expect(spy).toHaveBeenCalled();
    const events = (globalThis as unknown as { __wfReadyEvents?: Record<string, unknown>[] }).__wfReadyEvents;
    expect(events?.some((e) => e.event === 'begin')).toBe(true);
    expect(events?.some((e) => e.event === 'ready')).toBe(true);
    expect(events?.some((e) => e.event === 'all-ready')).toBe(true);
    spy.mockRestore();
  });
});
