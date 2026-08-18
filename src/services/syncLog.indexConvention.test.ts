/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// RULING R-AO, SECOND HALF (WS1 Session K) — A FIX APPLIED TO DOCUMENTATION
// MUST BE CHECKED IN CODE.
//
// WS1 Session J corrected an off-by-two between the parse and committed index
// spaces in a DOCUMENTATION table (`stage1-live-run-prep.md` §5.3) and recorded
// in `types.ts` that "every rule detector already returns a `segmentIndex` on
// this same PRE-filter convention". The claim was never run against the code
// and it was FALSE: `UnspokenScriptFinding` and `SeamFitFinding` are
// parse-indexed, `RunPlacementFinding` and `UtterancePlacementFinding` are
// committed-indexed, and `SyncLogPanel` rendered both as "Scene N + 1". On 173
// — the only corpus where R.10 drops a scene — R.11 named `abysmal_opinion`
// "scene 6" for a scene the timeline shows as scene 5.
//
// This file is the check that documentation alone could not provide. It is a
// SOURCE assertion on purpose: the defect was not that a value was wrong at
// runtime on some input, it was that a builder was allowed to copy a
// detector's own index onto a user-facing entry at all.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import {
  buildSeamFitLogEntries,
  buildRunPlacementLogEntries,
  buildUtterancePlacementLogEntries,
  buildUnspokenScriptLogEntries,
  buildUnscriptedRunLogEntries,
} from './syncLog';
import type { VideoSegment } from '../types';

const SRC = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), './syncLog.ts'), 'utf-8');

/** A committed array whose ids match the findings below, and whose POSITIONS
 *  deliberately disagree with every finding's own `segmentIndex`. */
const committed = [
  { id: 'a', tag: 'first' },
  { id: 'b', tag: 'second' },
  { id: 'c', tag: 'third' },
] as unknown as VideoSegment[];

describe('R-AO — rule-correction entries carry a COMMITTED index, resolved in one place', () => {
  it('no RULE-CORRECTION builder copies a detector segmentIndex onto an entry', () => {
    // Scoped to rule-correction builders by their `owningRule` marker. The
    // lock family (`buildLockFindingLogEntries`) legitimately assigns
    // `segmentIndex: f.segmentIndex`: its `LockFinding` comes from
    // `applyAnchorBasedTiming(prev.segments, ...)` in `handleToggleLock`, so
    // that index is ALREADY the committed one. Verified, not assumed — which
    // is the point of this file.
    const blocks = SRC.split('owningRule:').slice(1)
      .map(b => b.slice(0, 400));
    for (const b of blocks) {
      expect(
        /segmentIndex:\s*f\.segmentIndex/.test(b),
        'a rule-correction builder assigns `segmentIndex: f.segmentIndex` — that ' +
          'copies a DETECTOR index (parse space for R.10/R.11) onto a user-facing ' +
          'entry the panel renders as a timeline scene number. Resolve it with ' +
          'committedIndexOf instead. Ruling R-AO — do not delete this assertion.',
      ).toBe(false);
    }
    expect(blocks.length, 'no rule-correction builders found — the scan is broken').toBeGreaterThanOrEqual(5);
  });

  it('the lock family is committed-indexed already — recorded so it is not re-audited blind', () => {
    // `handleToggleLock` builds its findings from `prev.segments`, the
    // committed array, so "Segment N" there needs no conversion.
    expect(SRC).toContain('segmentIndex: f.segmentIndex');
    expect(SRC).toContain('buildLockFindingLogEntries');
  });

  it('the resolver exists and is the only place an entry index is derived', () => {
    expect(SRC).toContain('function committedIndexOf(');
    const uses = SRC.match(/committedIndexOf\(/g) ?? [];
    // One definition + one use per rule-correction builder that can carry an index.
    expect(uses.length).toBeGreaterThanOrEqual(4);
  });

  it('R.11 reports the COMMITTED position, not its own parse index', () => {
    const [e] = buildSeamFitLogEntries('run', [{
      segmentIndex: 191, segmentId: 'c', segmentTag: 'third',
      chunkIndex: 1, chunkStartSec: 0, chunkEndSec: 1, fit: 1, fitDeviation: 1.5,
      edge: 'end', committedValue: 1, correctedValue: 2, delta: 1, spanMaxConfidence: 1e-6,
    }], committed, 0);
    expect(e!.segmentIndex).toBe(2);        // committed position of id 'c'
    expect(e!.message).toContain('scene 3'); // never "scene 192"
    expect(e!.message).not.toContain('192');
  });

  it('R.12 and R.13 report the COMMITTED position too — one convention, not two', () => {
    const [r12] = buildRunPlacementLogEntries('run', [{
      segmentIndex: 999, segmentId: 'b', segmentTag: 'second',
      runIndex: 0, runStartSec: 0, runEndSec: 1, runTokenLo: 0, runTokenHi: 1,
      gapStartSec: 0, gapEndSec: 1, placement: 'run-start-fallback',
      committedValue: 1, correctedValue: 0.5, delta: -0.5,
    }], committed, 0);
    const [r13] = buildUtterancePlacementLogEntries('run', [{
      segmentIndex: 999, segmentId: 'b', segmentTag: 'second',
      carrierIndex: 0, carrierId: 'a', carrierTag: 'first',
      runIndex: 0, runStartSec: 0, runEndSec: 1, utteranceEndSec: 2,
      placement: 'utterance-end-fallback', committedValue: 1.5, correctedValue: 2, delta: 0.5,
    }], committed, 0);
    expect(r12!.segmentIndex).toBe(1);
    expect(r13!.segmentIndex).toBe(1);
    expect(r12!.message).toContain('scene 2');
    expect(r13!.message).toContain('scene 2');
  });

  it('a scene that is NOT on the committed timeline carries NO index at all', () => {
    // R.10's scenes are dropped. An absent index is honest; a parse index
    // rendered as a timeline scene number is not.
    const [r10] = buildUnspokenScriptLogEntries('run', [{
      segmentIndex: 12, segmentId: 'gone', segmentTag: 'blue_monkey',
      maxWordConfidence: 4e-5, faWordCount: 3,
    }], 0);
    expect(r10!.segmentIndex).toBeUndefined();
    expect(r10!.message).toContain('blue_monkey');
    expect(r10!.message).toContain('script position 13');

    // And a rule-correction finding whose id is missing from the committed
    // array degrades the same way rather than guessing a number.
    const [orphan] = buildSeamFitLogEntries('run', [{
      segmentIndex: 5, segmentId: 'not-here', segmentTag: 'ghost',
      chunkIndex: 1, chunkStartSec: 0, chunkEndSec: 1, fit: 1, fitDeviation: 1.5,
      edge: 'start', committedValue: 1, correctedValue: 2, delta: 1, spanMaxConfidence: 1e-6,
    }], committed, 0);
    expect(orphan!.segmentIndex).toBeUndefined();
    expect(orphan!.message).toContain('a scene');
  });

  it('R.5 resolves its owning scene against the COMMITTED array, not a pre-commit one', () => {
    // The parameter name is the contract. `anchorTimed`'s timings are pre-snap
    // estimates and its indices are the parse space; scanning it could name a
    // different scene than the timeline holds.
    expect(SRC).toContain('committedSegments: readonly VideoSegment[]');
    expect(SRC).not.toContain('const owner = idx >= 0 ? segments[idx] : undefined;');
  });

  // WS1 Session L — THE R.5 DIVERGENCE, CONSTRUCTED AND MEASURED.
  //
  // The debt Session K left open, stated plainly: R.5's containment scan was
  // MOVED to the committed array, but the move was never measured for a live
  // divergence, because R.5 only fires on v6 — and v6 drops zero scenes, so on
  // v6 the parse and committed index spaces COINCIDE and the change is a no-op
  // by input. The source assertion above pins that the code reads
  // `committedSegments`; it cannot show the two conventions actually disagree
  // on a real run, because no real corpus makes them.
  //
  // This test builds the input v6 cannot: an earlier scene is dropped (as R.10
  // drops two on 173), so the owning scene's committed index (2) is strictly
  // less than its parse index (3). An unscripted run sits inside the owning
  // scene. We run R.5's real builder AND a parse-space scan of the identical
  // shape, and require them to DISAGREE — 2 vs 3 — with R.5 reporting the
  // committed 2. The claim stops being inferred from the parameter name.
  it('on a dropped-scene input, R.5 reports the COMMITTED index and it DIVERGES from the parse index', () => {
    const sc = (id: string, tag: string, startTime: number, duration: number): VideoSegment =>
      ({ id, tag, text: `${tag} words`, startTime, duration, transition: 'none', animation: 'none' }) as unknown as VideoSegment;

    // PARSE array — the pre-skip order, five scenes. `p_drop` is R.10-refused.
    const parse: VideoSegment[] = [
      sc('p0', 'intro', 0, 10),
      sc('p1', 'second', 10, 10),
      sc('p_drop', 'dropped', 20, 10), // never reaches the timeline
      sc('p3', 'carrier', 30, 10),     // parse index 3
      sc('p4', 'last', 40, 10),
    ];
    // COMMITTED array — `p_drop` gone, the rest re-timed into a gapless
    // partition. `p3` (the carrier) is now at committed index 2, and its
    // committed span is [22.5, 33.75).
    const committedArr: VideoSegment[] = [
      sc('p0', 'intro', 0, 11.25),
      sc('p1', 'second', 11.25, 11.25),
      sc('p3', 'carrier', 22.5, 11.25), // committed index 2
      sc('p4', 'last', 33.75, 11.25),
    ];

    // A run whose onset falls inside the carrier's span under BOTH timings —
    // committed p3 is [22.5, 33.75), parse p3 is [30, 40), overlap [30, 33.75).
    // 31.0 sits in the carrier either way, so the two scans name the SAME
    // scene (p3) and differ ONLY in the index number they give it. That is the
    // 173 mechanism exactly: `abysmal_opinion` was one scene reported under two
    // numbers, not two scenes.
    const run = { tokenLo: 40, tokenHi: 44, startSec: 31.0, endSec: 33.4, qiSplit: 30 };

    const [entry] = buildUnscriptedRunLogEntries('run-L', [run], committedArr, 0);
    expect(entry).toBeDefined();
    expect(entry!.owningRule).toBe('R.5');

    // What R.5 actually reports: the committed position of the carrier.
    expect(entry!.segmentIndex).toBe(2);

    // The SAME containment scan over the PARSE array (its `startTime`s are the
    // parse-space estimates) names parse index 3 — because `p_drop` still sits
    // between `p1` and the carrier there. This is the number the pre-Session-K
    // code produced.
    const parseIdx = parse.findIndex(s => run.startSec >= s.startTime && run.startSec < s.startTime + s.duration);
    expect(parseIdx).toBe(3);

    // THE DIVERGENCE, asserted rather than assumed: on this input the two
    // conventions give different scene NUMBERS for the same carrier, and R.5
    // takes the committed one.
    expect(entry!.segmentIndex).not.toBe(parseIdx);
    expect(parse[parseIdx]!.id).toBe('p3');            // parse #3 IS the carrier...
    expect(committedArr[entry!.segmentIndex!]!.id).toBe('p3'); // ...and committed #2 is too.

    // THE HARM, made concrete: the log renders `segmentIndex` against the
    // COMMITTED timeline the user is looking at. Had R.5 emitted the parse
    // number 3, the reader would have been pointed at committed scene 3 —
    // `p4`, the WRONG scene. Committed 2 points at the carrier they can see.
    expect(committedArr[parseIdx]!.id).toBe('p4');     // parse number vs committed timeline → wrong scene
    expect(committedArr[parseIdx]!.id).not.toBe('p3');
  });
});
