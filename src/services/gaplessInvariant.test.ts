import { describe, it, expect } from 'vitest';
import {
  computeDragCascade,
  resolveDragPreview,
  DRAG_CASCADE_OPTIONS,
  MIN_SEGMENT_DURATION,
} from './dragCascade';
import { applyAnchorBasedTiming } from './syncEngine';
import { findPartitionViolations, checkTimelineIsGapless, PARTITION_EPSILON_SEC } from './timelinePartition';
import { snapCoveredBoundaries } from './snapBoundaries';
import { extractSegmentAlignments } from './whisperService';
import type { VideoSegment, TranscriptToken } from '../types';
import { TransitionType, AnimationType } from '../types';

/**
 * THE REGRESSION NET for the Model P gapless invariant.
 *
 *     startTime[i] + duration[i] === startTime[i+1]
 *
 * Ruling: `docs/decisions/2026-08-07-model-p-ruling.md`. The compliance
 * backlog this file closes is enumerated in `project-state.md`'s Open
 * Decisions.
 *
 * Every other Model P test pins ONE named scenario. This file instead sweeps
 * the two writers that can move a boundary — `computeDragCascade` (the drag
 * path) and `applyAnchorBasedTiming` (the sync path) — across a wide matrix of
 * inputs and asserts only the invariant. It exists to catch the case nobody
 * thought to name, which is precisely how K14's gap survived review: every
 * targeted test passed, because none of them asked this question.
 *
 * Deliberately asserts the invariant DIRECTLY (arithmetic on the array) as
 * well as via `findPartitionViolations`, so the net does not depend on the
 * checker being correct — if the two ever disagree, that is itself a defect
 * worth failing on.
 */

const seg = (
  id: string,
  startTime: number,
  duration: number,
  extra: Partial<VideoSegment> = {},
): VideoSegment => ({
  id,
  text: `text-${id}`,
  startTime,
  duration,
  transition: TransitionType.NONE,
  animation: AnimationType.NONE,
  order: 0,
  anchorStart: startTime,
  ...extra,
});

/** Builds a contiguous, gapless array of `n` segments each `dur` long. */
function gaplessArray(n: number, dur = 5): VideoSegment[] {
  return Array.from({ length: n }, (_, i) => seg(String.fromCharCode(65 + i), i * dur, dur));
}

/** One token per whole second in [from, to), 0.4s long. */
function tokens(from: number, to: number): TranscriptToken[] {
  const out: TranscriptToken[] = [];
  for (let t = from; t < to - 1e-9; t += 1) {
    out.push({ startSec: Number(t.toFixed(3)), endSec: Number((t + 0.4).toFixed(3)), text: 'w' });
  }
  return out;
}

/**
 * The invariant, asserted arithmetically and independently of any production
 * helper. Returns nothing; throws with the offending pair named.
 */
function assertGapless(segments: VideoSegment[], context: string): void {
  for (let i = 0; i < segments.length - 1; i++) {
    const end = segments[i]!.startTime + segments[i]!.duration;
    const nextStart = segments[i + 1]!.startTime;
    expect(
      Math.abs(end - nextStart),
      `${context}: segment ${i} ends ${end.toFixed(3)} but segment ${i + 1} starts ${nextStart.toFixed(3)}`,
    ).toBeLessThanOrEqual(PARTITION_EPSILON_SEC);
  }
  // Cross-check the independent checker agrees with the arithmetic above.
  const adjacencyViolations = findPartitionViolations(segments)
    .filter(v => v.kind === 'lock-lock-gap' || v.kind === 'lock-lock-overlap');
  expect(adjacencyViolations, `${context}: findPartitionViolations disagrees with direct arithmetic`).toEqual([]);
}

const noBlock = (): void => {};

describe('gapless invariant — the drag path (computeDragCascade / restackWindow)', () => {
  // Sweep: every segment index, both edges, growing and shrinking, across
  // several magnitudes — including magnitudes large enough to exhaust a
  // neighbour and trip the MIN_SEGMENT_DURATION floor.
  const deltas = [-4.9, -2.5, -0.7, -0.1, 0.1, 0.7, 2.5, 4.9, 40];

  for (const direction of ['right', 'left'] as const) {
    for (const delta of deltas) {
      it(`stays gapless: ${direction}-edge drag of ${delta >= 0 ? '+' : ''}${delta}s at every index`, () => {
        for (let idx = 0; idx < 5; idx++) {
          const arr = gaplessArray(5);
          const target = Math.max(MIN_SEGMENT_DURATION, arr[idx]!.duration + delta);
          const out = computeDragCascade(arr, idx, target, 0, direction, noBlock);
          if (out === null) continue; // blocked by a lock — nothing committed
          assertGapless(out, `${direction} drag ${delta}s at index ${idx}`);
        }
      });
    }
  }

  it('stays gapless when the K15b word-onset floor refuses part of the shrink', () => {
    // The floor hands refused shrink BACK to the dragged segment, which is what
    // conserves the touched window's total duration — and total conservation is
    // exactly what keeps restackWindow's [lo, hi] edge flush with hi+1.
    const arr = gaplessArray(4, 10);
    const tk = tokens(0, 40); // every segment densely owns words: little silence to yield
    for (let idx = 0; idx < 4; idx++) {
      for (const direction of ['right', 'left'] as const) {
        const out = computeDragCascade(arr, idx, arr[idx]!.duration + 6, 0, direction, noBlock, tk);
        if (out === null) continue;
        assertGapless(out, `${direction} drag at ${idx} against the word floor`);
      }
    }
  });

  it('stays gapless when a locked neighbour bounds the cascade', () => {
    for (let lockIdx = 0; lockIdx < 5; lockIdx++) {
      const arr = gaplessArray(5);
      arr[lockIdx] = { ...arr[lockIdx]!, locked: true };
      for (let idx = 0; idx < 5; idx++) {
        for (const direction of ['right', 'left'] as const) {
          const out = computeDragCascade(arr, idx, arr[idx]!.duration + 2, 0, direction, noBlock);
          if (out === null) continue; // the lock blocked it — nothing committed
          assertGapless(out, `drag ${direction} at ${idx} with lock at ${lockIdx}`);
        }
      }
    }
  });

  it('the LIVE PREVIEW path agrees with the commit path, and is itself gapless', () => {
    // resolveDragPreview delegates to computeDragCascade precisely so the two
    // cannot drift (K17). Pinning that here means a future "preview-only
    // shortcut" optimisation cannot silently reintroduce a preview-side gap.
    //
    // The commit side must pass DRAG_CASCADE_OPTIONS (owner ruling 2026-08-08)
    // because that is what the REAL commit path passes: `dragSession.ts`'s
    // `handleUp` hands the same object to `applyDurationChange`. Comparing the
    // preview against an option-less cascade call would be comparing it against
    // the playback-speed slider's semantics, not the drag's — and the two now
    // differ at the last index, which is exactly where this loop reaches.
    const arr = gaplessArray(5);
    for (let idx = 0; idx < 5; idx++) {
      for (const direction of ['right', 'left'] as const) {
        const preview = resolveDragPreview(arr, idx, arr[idx]!.duration + 1.5, 0, direction);
        const commit = computeDragCascade(
          arr, idx, arr[idx]!.duration + 1.5, 0, direction, noBlock, undefined, DRAG_CASCADE_OPTIONS,
        );
        expect(preview).toEqual(commit);
        if (preview) assertGapless(preview, `preview ${direction} at ${idx}`);
      }
    }
  });

  it('a two-segment array — the minimum where a boundary exists at all — stays gapless', () => {
    for (const direction of ['right', 'left'] as const) {
      for (const delta of [-2, -0.1, 0.1, 2]) {
        const arr = gaplessArray(2);
        const out = computeDragCascade(arr, 0, Math.max(MIN_SEGMENT_DURATION, arr[0]!.duration + delta), 0, direction, noBlock);
        if (out) assertGapless(out, `2-segment ${direction} ${delta}`);
      }
    }
  });
});

describe('gapless invariant — the sync path (applyAnchorBasedTiming)', () => {
  const AUDIO = 100;

  it('stays gapless with a lock at every possible index', () => {
    for (let lockIdx = 0; lockIdx < 5; lockIdx++) {
      // Anchors deliberately scattered AWAY from a contiguous layout, so each
      // run genuinely exercises the fill rule rather than a no-op.
      const arr = [
        seg('A', 0, 10, { anchorStart: 0 }),
        seg('B', 18, 5, { anchorStart: 18 }),
        seg('C', 40, 5, { anchorStart: 40 }),
        seg('D', 62, 5, { anchorStart: 62 }),
        seg('E', 85, 15, { anchorStart: 85 }),
      ];
      arr[lockIdx] = { ...arr[lockIdx]!, locked: true };

      const out = applyAnchorBasedTiming(arr, AUDIO);
      assertGapless(out, `sync with lock at index ${lockIdx}`);

      // The lock itself is honoured exactly — position and length both.
      expect(out[lockIdx]!.startTime).toBe(arr[lockIdx]!.startTime);
      expect(out[lockIdx]!.duration).toBe(arr[lockIdx]!.duration);
    }
  });

  it('stays gapless with TWO locks at every non-adjacent pair of indices', () => {
    for (let a = 0; a < 5; a++) {
      for (let b = a + 2; b < 5; b++) {
        const arr = [
          seg('A', 0, 10, { anchorStart: 0 }),
          seg('B', 18, 5, { anchorStart: 18 }),
          seg('C', 40, 5, { anchorStart: 40 }),
          seg('D', 62, 5, { anchorStart: 62 }),
          seg('E', 85, 15, { anchorStart: 85 }),
        ];
        arr[a] = { ...arr[a]!, locked: true };
        arr[b] = { ...arr[b]!, locked: true };
        assertGapless(applyAnchorBasedTiming(arr, AUDIO), `sync with locks at ${a} and ${b}`);
      }
    }
  });

  it('stays gapless with no locks at all (the ordinary Apply Sync case)', () => {
    const arr = [
      seg('A', 0, 10, { anchorStart: 0 }),
      seg('B', 18, 5, { anchorStart: 18 }),
      seg('C', 40, 5, { anchorStart: 40 }),
      seg('D', 85, 15, { anchorStart: 85 }),
    ];
    const out = applyAnchorBasedTiming(arr, AUDIO);
    assertGapless(out, 'sync, no locks');
    // ...and covers the whole timeline, head and tail (Key Invariant (b)).
    expect(out[0]!.startTime).toBe(0);
    expect(out.at(-1)!.startTime + out.at(-1)!.duration).toBeCloseTo(AUDIO, 3);
  });

  it('is idempotent — re-running on its own output changes nothing and stays gapless', () => {
    // A real risk: Apply Sync, a lock toggle, and a drag can each re-run this
    // pass over an already-timed array. A pass that were not idempotent would
    // drift a boundary a little further on every user interaction.
    const arr = [
      seg('A', 0, 10, { anchorStart: 0 }),
      seg('B', 18, 5, { anchorStart: 18, locked: true }),
      seg('C', 40, 5, { anchorStart: 40 }),
      seg('D', 85, 15, { anchorStart: 85 }),
    ];
    const once = applyAnchorBasedTiming(arr, AUDIO);
    const twice = applyAnchorBasedTiming(once, AUDIO);
    assertGapless(once, 'sync pass 1');
    assertGapless(twice, 'sync pass 2');
    expect(twice.map(s => [s.startTime, s.duration])).toEqual(once.map(s => [s.startTime, s.duration]));
  });
});

// ---------------------------------------------------------------------------
// Compliance backlog item 4 — the export guard.
// ---------------------------------------------------------------------------

describe('gapless invariant — the export guard (checkTimelineIsGapless)', () => {
  it('passes a contiguous timeline', () => {
    expect(checkTimelineIsGapless(gaplessArray(4))).toBeNull();
  });

  it('passes a single-segment and an empty timeline', () => {
    expect(checkTimelineIsGapless(gaplessArray(1))).toBeNull();
    expect(checkTimelineIsGapless([])).toBeNull();
  });

  it('refuses a timeline with a gap, naming the size and the segment', () => {
    const reason = checkTimelineIsGapless([
      seg('A', 0, 5),
      seg('B', 8, 5), // 3.000s hole
    ]);
    expect(reason).not.toBeNull();
    expect(reason).toContain('3.000s gap');
    expect(reason).toContain('segment 2');
  });

  it('refuses a timeline with an overlap too — illegal under BOTH models', () => {
    const reason = checkTimelineIsGapless([
      seg('A', 0, 7),
      seg('B', 5, 5),
    ]);
    expect(reason).toContain('overlap');
  });

  it('reports how many further violations follow the first', () => {
    const reason = checkTimelineIsGapless([
      seg('A', 0, 5),
      seg('B', 8, 5),
      seg('C', 20, 5),
    ]);
    expect(reason).toContain('+1 more');
  });

  it('does NOT depend on audioDuration — a no-voiceover project still exports', () => {
    // Sum of durations legitimately differs from any audio length here; the
    // guard checks adjacency only, so this must pass.
    expect(checkTimelineIsGapless([seg('A', 0, 3), seg('B', 3, 4)])).toBeNull();
  });

  it('tolerates sub-epsilon rounding noise rather than blocking a valid export', () => {
    expect(checkTimelineIsGapless([seg('A', 0, 5.0004), seg('B', 5, 5)])).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// restackWindow's locality PRECONDITION (Stage 3b).
//
// `restackWindow`'s doc comment states it restacks only `[lo, hi]` and leaves
// everything outside untouched, "which is what preserves a pre-existing gap
// (K15a)". Under Model P that justification is retired: a gap is illegal, so
// the property that actually matters is that its locality is EQUIVALENT to a
// full re-flow — which holds exactly while nothing upstream can hand it a
// gapped array (ruling §2, and `segments-invariant-ruling.md` §6.3's
// "K15a survives as an optimisation").
//
// These tests pin that precondition end to end, by chaining the real editor
// operations in the order a user performs them, rather than asserting it in
// prose.
// ---------------------------------------------------------------------------

describe('restackWindow locality precondition — a full editor session stays gapless', () => {
  const AUDIO = 100;

  it('sync -> drag -> drag -> sync keeps the array gapless at every step', () => {
    let arr = applyAnchorBasedTiming(
      [
        seg('A', 0, 10, { anchorStart: 0 }),
        seg('B', 18, 5, { anchorStart: 18 }),
        seg('C', 40, 5, { anchorStart: 40 }),
        seg('D', 70, 5, { anchorStart: 70 }),
      ],
      AUDIO,
    );
    assertGapless(arr, 'after initial sync');

    arr = computeDragCascade(arr, 1, arr[1]!.duration + 3, 0, 'right', noBlock)!;
    assertGapless(arr, 'after drag 1');

    arr = computeDragCascade(arr, 2, arr[2]!.duration - 2, 0, 'left', noBlock)!;
    assertGapless(arr, 'after drag 2');

    // A re-sync over the dragged array — the case K14's stale-anchor family
    // lived in, since a drag writes startTime and anchorStart in lockstep.
    arr = applyAnchorBasedTiming(arr, AUDIO);
    assertGapless(arr, 'after re-sync');
  });

  it('locking a segment mid-session, then dragging around it, stays gapless', () => {
    let arr = applyAnchorBasedTiming(
      [
        seg('A', 0, 10, { anchorStart: 0 }),
        seg('B', 18, 5, { anchorStart: 18 }),
        seg('C', 40, 5, { anchorStart: 40 }),
        seg('D', 70, 5, { anchorStart: 70 }),
      ],
      AUDIO,
    );

    // The user locks segment C, exactly as handleToggleLock does: flip the
    // flag, then re-derive the whole array.
    arr = applyAnchorBasedTiming(arr.map((s, i) => (i === 2 ? { ...s, locked: true } : s)), AUDIO);
    assertGapless(arr, 'after locking C');
    const lockedStart = arr[2]!.startTime;
    const lockedDuration = arr[2]!.duration;

    // Drag either side of the wall; the wall must not move, and no gap may open.
    for (const idx of [1, 3]) {
      const out = computeDragCascade(arr, idx, arr[idx]!.duration + 1.5, 0, 'right', noBlock);
      if (!out) continue; // the lock legitimately blocked this drag
      assertGapless(out, `after dragging index ${idx} beside the lock`);
      expect(out[2]!.startTime).toBe(lockedStart);
      expect(out[2]!.duration).toBe(lockedDuration);
    }
  });

  it('unlocking is never refused and leaves the array gapless', () => {
    // Unlocking removes a wall, so it can only make the partition more
    // satisfiable — canLockSegment is deliberately not consulted for it.
    const locked = applyAnchorBasedTiming(
      [
        seg('A', 0, 10, { anchorStart: 0, locked: true }),
        seg('B', 18, 5, { anchorStart: 18 }),
        seg('C', 40, 60, { anchorStart: 40 }),
      ],
      AUDIO,
    );
    const unlocked = applyAnchorBasedTiming(
      locked.map((s, i) => (i === 0 ? { ...s, locked: false } : s)),
      AUDIO,
    );
    assertGapless(unlocked, 'after unlocking');
  });
});

// ===========================================================================
// WS3 Defect 4 — the THIRD boundary writer.
//
// Everything above sweeps `computeDragCascade` and `applyAnchorBasedTiming`.
// `snapCoveredBoundaries` (services/snapBoundaries.ts) also writes
// `startTime`/`duration` — it is the Whisper path's boundary writer, and
// CLAUDE.md's §4 invariant asserts adjacency "holds unconditionally after
// snapCoveredBoundaries". It was not in this net at all, which is why 36/36
// green shipped alongside a real 0.200s hole at segment 99 of a 424-segment
// project.
//
// THE UNCOVERED CASE, precisely: `snapCoveredBoundaries` SKIPS a pair whose
// `plans[i]` is null — a locked segment on either side, or missing alignment
// data (snapBoundaries.ts:705) — and skips the degenerate-pair case
// (snapBoundaries.ts:829). Its comment says a skipped pair is left "exactly as
// the caller supplied them", but that is not what happens: the PREVIOUS pair
// has already overwritten `out[i].startTime` in place, while `out[i].duration`
// and `out[i+1].startTime` still hold their pre-snap values. The adjacency is
// then broken by exactly the distance the previous pair moved segment i's
// start. The contiguity repair at snapBoundaries.ts:896-900 only ever runs on
// the WRITE path, never for a skipped pair.
// ===========================================================================

const snapSeg = (
  id: string,
  text: string,
  startTime: number,
  duration: number,
  extra: Partial<VideoSegment> = {},
): VideoSegment => ({
  id,
  text,
  startTime,
  duration,
  transition: TransitionType.NONE,
  animation: AnimationType.NONE,
  order: 0,
  anchorStart: startTime,
  anchorSource: 'whisper',
  ...extra,
});

/** One token per word, `dur` long, starting at `from` on 1s centres. */
function wordTokensAt(text: string, from: number, dur: number): TranscriptToken[] {
  return text.split(' ').map((w, i) => ({
    startSec: Number((from + i).toFixed(3)),
    endSec: Number((from + i + dur).toFixed(3)),
    text: w,
  }));
}

describe('gapless invariant — the Whisper path (snapCoveredBoundaries)', () => {
  it('a pair skipped for a LOCKED neighbour, right after a written pair, leaves a real hole', () => {
    // s0/s1 are an ordinary written pair. s2 is LOCKED, so pair (1,2) is
    // skipped. The silence at [1.7, 1.9] puts the (0,1) boundary at 1.8 —
    // 0.200s earlier than s1's pre-snap start of 2.0 — so the hole this
    // produces is exactly the 0.200s the field report named.
    const segments = [
      snapSeg('s0', 'alpha bravo', 0, 2),
      snapSeg('s1', 'charlie delta', 2, 2),
      snapSeg('s2', 'echo foxtrot', 4, 2, { locked: true }),
    ];
    const toks = [
      ...wordTokensAt('alpha bravo', 0, 0.5),
      ...wordTokensAt('charlie delta', 2, 0.5),
      ...wordTokensAt('echo foxtrot', 4, 0.5),
    ];
    const alignments = extractSegmentAlignments(segments, toks);
    expect(alignments.every(a => a.matched)).toBe(true);

    const out = snapCoveredBoundaries(segments, alignments, toks, [{ startSec: 1.7, endSec: 1.9 }], 6);

    // The written pair moved s1's start back by exactly 0.200s...
    expect(out[1]!.startTime).toBeCloseTo(1.8, 6);
    // ...and the locked segment is correctly untouched.
    expect(out[2]!.startTime).toBeCloseTo(4, 6);
    // The invariant must still hold across BOTH pairs.
    assertGapless(out, 'snapCoveredBoundaries with a locked third segment');
  });

  it('a 0.200s hole at segment 99 of 424 — the field shape, at field scale', () => {
    // 424 contiguous 2s segments, three spoken words each on 1s centres;
    // segment index 99 (the 100th) is LOCKED, so pair (98, 99) is skipped
    // while pair (97, 98) is written. `checkTimelineIsGapless` is the export
    // preflight that refused the operator's project, so it is asserted here
    // directly alongside the arithmetic.
    const N = 424;
    const LOCKED_INDEX = 99;
    const segments: VideoSegment[] = [];
    const toks: TranscriptToken[] = [];
    for (let i = 0; i < N; i++) {
      const start = i * 2;
      segments.push(
        snapSeg(`s${i}`, `w${i}a w${i}b`, start, 2, i === LOCKED_INDEX ? { locked: true } : {}),
      );
      toks.push(...wordTokensAt(`w${i}a w${i}b`, start, 0.5));
    }
    // Alignments are built directly rather than via `extractSegmentAlignments`:
    // this test is about `snapCoveredBoundaries`, and running the real aligner
    // over 424 segments costs ~20s under full-suite load for no added reach.
    // Two tokens per segment, in order, so `firstTokenIdx`/`lastTokenIdx` are
    // exactly what the aligner would produce for this fixture.
    const alignments = segments.map((sg, i) => ({
      t0: sg.startTime,
      t1: sg.startTime + sg.duration,
      firstTokenIdx: i * 2,
      lastTokenIdx: i * 2 + 1,
      confidence: 1,
      matched: true,
      matchedWords: 2,
      totalWords: 2,
      longestRun: 2,
    })) as unknown as ReturnType<typeof extractSegmentAlignments>;

    // One silence, positioned to pull the (98, 99) boundary 0.200s earlier
    // than segment 99's pre-snap start (198.0). The resulting hole is the same
    // CLASS as the field 0.200s, not necessarily the same magnitude — what is
    // pinned is that a skipped pair beside a written one leaves one at all.
    const silences = [{ startSec: 197.7, endSec: 197.9 }];
    const out = snapCoveredBoundaries(segments, alignments, toks, silences, N * 2);

    expect(out[LOCKED_INDEX]!.startTime).toBeCloseTo(LOCKED_INDEX * 2, 6); // lock honoured
    assertGapless(out, '424 segments, lock at 99');
    expect(checkTimelineIsGapless(out)).toBeNull();
  });

  it('a pair skipped for MISSING alignment data is repaired the same way', () => {
    // The other `plans[i] === null` branch (snapBoundaries.ts:705): a caller
    // that hands in fewer alignments than segments. Same skip, same hole.
    const segments = [
      snapSeg('s0', 'alpha bravo', 0, 2),
      snapSeg('s1', 'charlie delta', 2, 2),
      snapSeg('s2', 'echo foxtrot', 4, 2),
    ];
    const toks = [
      ...wordTokensAt('alpha bravo', 0, 0.5),
      ...wordTokensAt('charlie delta', 2, 0.5),
      ...wordTokensAt('echo foxtrot', 4, 0.5),
    ];
    const alignments = extractSegmentAlignments(segments, toks);
    // Drop the LAST alignment so pair (1,2) has no `nextAlign` and is skipped.
    const truncated = alignments.slice(0, 2);

    const out = snapCoveredBoundaries(segments, truncated, toks, [{ startSec: 1.7, endSec: 1.9 }], 6);

    expect(out[1]!.startTime).toBeCloseTo(1.8, 6);
    assertGapless(out, 'snapCoveredBoundaries with a truncated alignments array');
  });

  it('an ordinary all-written run is untouched by the repair (no output change)', () => {
    // The repair must be a no-op wherever Pass 3 already wrote a boundary —
    // Pass 3 maintains contiguity exactly, so there is nothing to repair. This
    // is what keeps the change confined to the skip paths.
    const segments = [
      snapSeg('s0', 'alpha bravo', 0, 2),
      snapSeg('s1', 'charlie delta', 2, 3),
    ];
    const toks = [...wordTokensAt('alpha bravo', 0, 0.5), ...wordTokensAt('charlie delta', 2, 0.5)];
    const alignments = extractSegmentAlignments(segments, toks);

    const out = snapCoveredBoundaries(segments, alignments, toks, [{ startSec: 1.6, endSec: 1.9 }], 5);

    // Byte-for-byte the values the pre-repair implementation produced.
    expect(out[1]!.startTime).toBeCloseTo(1.75, 6);
    expect(out[0]!.duration).toBeCloseTo(1.75, 6);
    expect(out[1]!.duration).toBeCloseTo(3.25, 6);
    assertGapless(out, 'all-written run');
  });
});
