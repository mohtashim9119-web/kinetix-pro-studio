/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import type { TranscriptToken, VideoSegment } from '../types';
import type { SilenceInterval } from './silenceDetector';
import { coalesceRuns, computeFaChunkPlan, computeFaChunkPlanCoalesced, computeFaChunkPlanS2, computeFaChunkPlanWithAttribution, computeRuns, detectUnscriptedRuns } from './faChunkPlan';
import type { FaRun } from './faAnchors';
import { MAX_RUN_SEC } from './syncConstants';
import { vocabCharsFromRawVocab } from './faTextNormalize';

function seg(id: string, text: string, startTime: number, duration: number): VideoSegment {
  return {
    id,
    text,
    startTime,
    duration,
    transition: 'none',
    animation: 'none',
    order: 0,
  } as VideoSegment;
}

function token(text: string, startSec: number, endSec: number): TranscriptToken {
  return { text, startSec, endSec };
}

// A distinctive (>=3 chars, not glide-initial), silence-agreeing word inside
// a >=4-word contiguous match run — the R.1/R-O admissibility bar every
// synthetic anchor below is built to clear, mirroring faAnchors.test.ts's
// own fixture-construction technique.
function silence(endSec: number): SilenceInterval {
  // Width 0.6s, not 0.3s, because of R-U (WS1 Session B): a silence must SPAN
  // a token seam to be admissible at all, and every token fixture below uses a
  // stride of 0.4-0.5s, so a 0.3s-wide silence reaches back past no seam and
  // would now be vetoed outright. Reaching 0.6s back puts the PRECEDING
  // token's onset strictly inside it — a real seam — while leaving `endSec`,
  // and therefore every anchor time pinned in this file, exactly unchanged.
  //
  // Note which seam does the work: it is the preceding token's, not the
  // anchored token's own. That is the real shape too — the silence sits
  // BEFORE the word it anchors, so the seam it spans belongs to an earlier
  // token, and the anchored token's onset is what `ANCHOR_AGREEMENT_SEC`
  // matches against `endSec` afterwards.
  return { startSec: endSec - 0.6, endSec };
}

describe('computeFaChunkPlan', () => {
  it('attributes every segment to exactly one chunk, in order, no gaps', () => {
    // Six short segments, six matching tokens, a silence agreeing with each
    // token's onset (word 4/5/6 are the ones long+distinctive enough — 3+
    // chars, not w/y-initial — to admit as anchors per R-O; "at"/"in"/"on"
    // are deliberately short/inadmissible filler so only real anchors fire).
    const segments = [
      seg('s0', 'kittens likes purple hats', 0, 2),
      seg('s1', 'dragons chase silver moons', 2, 2),
      seg('s2', 'wizards brew golden potions', 4, 2),
      seg('s3', 'falcons guard hidden castles', 6, 2),
    ];
    const words = segments.flatMap(s => s.text.split(' '));
    const tokens: TranscriptToken[] = words.map((w, i) => token(w, i * 0.5, i * 0.5 + 0.4));
    // Agree a silence right at each 4th word's boundary (indices 3, 7, 11 —
    // "hats"/"moons"/"potions" onsets) so real R.1 anchors exist and split
    // the run into multiple chunks, exercising the multi-chunk path.
    const silences: SilenceInterval[] = [3, 7, 11].map(i => silence(tokens[i]!.startSec));

    // Pinned to 'segment-start-time' (WS1 Task 5 Slice D23): this assertion's
    // "whole segment's text lands in exactly one chunk" claim is a
    // segment-start-time-specific guarantee — index attribution can (and, per
    // the anchor placement below, does) cut a segment's own last word into
    // the NEXT chunk instead, by design (see the "cuts text at an anchor
    // even when it falls mid-segment" test below).
    const chunks = computeFaChunkPlan(segments, tokens, silences, 8, 'segment-start-time');

    // Total time coverage is gapless and spans the full audio.
    expect(chunks[0]!.startSec).toBe(0);
    expect(chunks[chunks.length - 1]!.endSec).toBe(8);
    for (let i = 0; i < chunks.length - 1; i++) {
      expect(chunks[i]!.endSec).toBe(chunks[i + 1]!.startSec);
    }
    // Every chunk's text is non-empty.
    for (const c of chunks) expect(c.text.length).toBeGreaterThan(0);
    // Every segment's text appears in exactly one chunk.
    for (const s of segments) {
      const owners = chunks.filter(c => c.text.includes(s.text));
      expect(owners.length).toBe(1);
    }
  });

  it('never produces a chunk longer than MAX_RUN_SEC when anchors are dense enough', () => {
    // 20 short segments across a fully anchor-dense 40s span (an admissible
    // anchor every 2s) — no chunk should need force-splitting, and none
    // should exceed MAX_RUN_SEC regardless.
    const segments: VideoSegment[] = [];
    const tokens: TranscriptToken[] = [];
    for (let i = 0; i < 20; i++) {
      const start = i * 2;
      segments.push(seg(`s${i}`, `falcons guard castle${i} tower${i}`, start, 2));
      const words = `falcons guard castle${i} tower${i}`.split(' ');
      for (let w = 0; w < words.length; w++) {
        tokens.push(token(words[w]!, start + w * 0.4, start + w * 0.4 + 0.3));
      }
    }
    const silences: SilenceInterval[] = tokens
      .filter((_, i) => i % 4 === 3)
      .map(t => silence(t.startSec));

    // Pinned to 'segment-start-time' (WS1 Task 5 Slice D23): this fixture's
    // anchor density was calibrated against runsToChunks's own (time-
    // attribution) empty-run merge rule; index attribution's empty-qi-range
    // merge rule can legitimately merge differently for the same fixture.
    const chunks = computeFaChunkPlan(segments, tokens, silences, 40, 'segment-start-time');
    for (const c of chunks) expect(c.endSec - c.startSec).toBeLessThanOrEqual(MAX_RUN_SEC);
  });

  it('merges a run with no owning segment into an adjacent chunk rather than emitting empty text', () => {
    // One segment spans 0-35s (crosses a forced MAX_RUN_SEC=30 split with no
    // anchor anywhere), so the run [30, ...) that "force-splits" out of the
    // middle of that segment owns no segment startTime at all. The merged
    // output must still cover [0, 35) with no empty-text chunk.
    const segments = [seg('s0', 'a very long single segment of narration', 0, 35)];
    const words = segments[0]!.text.split(' ');
    const tokens: TranscriptToken[] = words.map((w, i) => token(w, i * 4, i * 4 + 3.5));
    const chunks = computeFaChunkPlan(segments, tokens, [], 35);

    expect(chunks.every(c => c.text.length > 0)).toBe(true);
    expect(chunks[0]!.startSec).toBe(0);
    expect(chunks[chunks.length - 1]!.endSec).toBe(35);
  });

  it('returns [] when every segment has empty text', () => {
    const segments = [seg('s0', '', 0, 5), seg('s1', '   ', 5, 5)];
    const chunks = computeFaChunkPlan(segments, [], [], 10);
    expect(chunks).toEqual([]);
  });
});

describe('coalesceRuns', () => {
  function run(
    start: number,
    end: number,
    startProv: FaRun['startProvenance'] = 'agreed-anchor',
    endProv: FaRun['endProvenance'] = 'agreed-anchor',
  ): FaRun {
    return { windowStart: start, windowEnd: end, startProvenance: startProv, endProvenance: endProv };
  }

  it('preserves exact contiguity (gapless, monotonic) after merging, and never exceeds the target', () => {
    // Every individual run here is well under the 7s target, so the target
    // is the only thing gating each merge decision (not a pre-existing
    // oversized run).
    const runs = [run(0, 3), run(3, 5), run(5, 6), run(6, 8.5), run(8.5, 9), run(9, 15.5)];
    const coalesced = coalesceRuns(runs, 7);

    expect(coalesced[0]!.windowStart).toBe(0);
    expect(coalesced[coalesced.length - 1]!.windowEnd).toBe(15.5);
    for (let i = 0; i < coalesced.length - 1; i++) {
      expect(coalesced[i]!.windowEnd).toBe(coalesced[i + 1]!.windowStart);
    }
    for (const r of coalesced) expect(r.windowEnd - r.windowStart).toBeLessThanOrEqual(7);
    // Coalescing actually merged something — otherwise this isn't exercising
    // the merge path at all.
    expect(coalesced.length).toBeLessThan(runs.length);
  });

  it('is idempotent when the target is below every individual run length', () => {
    const runs = [run(0, 3), run(3, 5), run(5, 6), run(6, 12)]; // shortest run is 1s
    const target = 0.5; // below every run's own duration
    const once = coalesceRuns(runs, target);
    const twice = coalesceRuns(once, target);
    expect(twice).toEqual(once);
    expect(once).toEqual(runs.map(r => ({ ...r }))); // no merges happened at all
  });

  it('merges across an agreed-anchor boundary exactly like any other, gated only by the target', () => {
    // The middle boundary (t=2) is 'agreed-anchor' on both sides — proves
    // coalescing does not special-case or protect that provenance; only
    // the target decides.
    const runs = [run(0, 2, 'corpus-start', 'agreed-anchor'), run(2, 4, 'agreed-anchor', 'corpus-end')];
    const coalesced = coalesceRuns(runs, 4);
    expect(coalesced).toEqual([
      { windowStart: 0, windowEnd: 4, startProvenance: 'corpus-start', endProvenance: 'corpus-end' },
    ]);
  });

  it('returns [] for an empty input', () => {
    expect(coalesceRuns([], 10)).toEqual([]);
  });
});

describe('computeFaChunkPlanCoalesced', () => {
  it('preserves segment membership (no word gained or lost) relative to the unmerged plan', () => {
    // 20 segments, each ending on a distinct, R-O-admissible anchor word (no
    // digits — a digit-bearing word like "tower0" is dropped wholesale by
    // the normalizer, D3/D5's contract, and would never admit as an anchor)
    // so the unmerged plan has one small agreed-anchor-bounded chunk per
    // segment for coalescing to actually merge.
    const pool = [
      'hats', 'moons', 'potions', 'castles', 'rivers', 'mountains', 'forests', 'oceans',
      'deserts', 'islands', 'valleys', 'canyons', 'glaciers', 'volcanoes', 'meadows', 'swamps',
      'tundras', 'prairies', 'jungles', 'caves',
    ];
    const segments: VideoSegment[] = [];
    const tokens: TranscriptToken[] = [];
    for (let i = 0; i < 20; i++) {
      const start = i * 2;
      const text = `falcons guard silver ${pool[i]}`;
      segments.push(seg(`s${i}`, text, start, 2));
      const words = text.split(' ');
      for (let w = 0; w < words.length; w++) {
        tokens.push(token(words[w]!, start + w * 0.4, start + w * 0.4 + 0.3));
      }
    }
    const silences: SilenceInterval[] = tokens
      .filter((_, i) => i % 4 === 3)
      .map(t => silence(t.startSec));

    // Pinned to 'segment-start-time' (WS1 Task 5 Slice D23): computeFaChunkPlanCoalesced
    // is exclusively segment-start-time (own doc comment, unaffected this
    // slice) — the baseline it's compared against must use the same rule.
    const baseline = computeFaChunkPlan(segments, tokens, silences, 40, 'segment-start-time');
    const coalesced = computeFaChunkPlanCoalesced(segments, tokens, silences, 40, 10);

    // Coalescing actually did something (fewer, larger chunks).
    expect(coalesced.length).toBeLessThan(baseline.length);
    // The `<= target` ceiling is `coalesceRuns`'s OWN contract (its doc
    // comment: "a hard ceiling, not a target average"), so assert it against
    // `coalesceRuns`'s own output. The finished CHUNK plan may exceed it
    // legitimately: `runsToChunks` folds a run that owns no segment text into
    // its neighbour AFTER coalescing, and that fold has no ceiling of its own.
    for (const r of coalesceRuns(computeRuns(segments, tokens, silences, 40), 10)) {
      expect(r.windowEnd - r.windowStart).toBeLessThanOrEqual(10);
    }

    // Gapless, spans the same full range as the unmerged plan.
    expect(coalesced[0]!.startSec).toBe(baseline[0]!.startSec);
    expect(coalesced[coalesced.length - 1]!.endSec).toBe(baseline[baseline.length - 1]!.endSec);
    for (let i = 0; i < coalesced.length - 1; i++) {
      expect(coalesced[i]!.endSec).toBe(coalesced[i + 1]!.startSec);
    }

    // Every segment's text still appears in exactly one coalesced chunk — no
    // word gained or lost, only regrouped into fewer/larger chunks.
    for (const s of segments) {
      const owners = coalesced.filter(c => c.text.includes(s.text));
      expect(owners.length).toBe(1);
    }
    // Same total word count as the unmerged baseline.
    const baselineWordCount = baseline.reduce((n, c) => n + c.text.split(' ').length, 0);
    const coalescedWordCount = coalesced.reduce((n, c) => n + c.text.split(' ').length, 0);
    expect(coalescedWordCount).toBe(baselineWordCount);
  });

  it('returns the same plan as computeFaChunkPlan when the target is huge (single chunk)', () => {
    const segments = [
      seg('s0', 'kittens likes purple hats', 0, 2),
      seg('s1', 'dragons chase silver moons', 2, 2),
    ];
    const words = segments.flatMap(s => s.text.split(' '));
    const tokens: TranscriptToken[] = words.map((w, i) => token(w, i * 0.5, i * 0.5 + 0.4));
    const coalesced = computeFaChunkPlanCoalesced(segments, tokens, [], 4, 1000);
    expect(coalesced.length).toBe(1);
    expect(coalesced[0]!.startSec).toBe(0);
    expect(coalesced[0]!.endSec).toBe(4);
  });
});

// ---------------------------------------------------------------------------
// Index attribution (WS1 Task 5 Slice D13 Step 3)
// ---------------------------------------------------------------------------

describe('computeFaChunkPlanWithAttribution', () => {
  /** The same four-segment / three-anchor fixture the suite above uses — real
   *  R.1 anchors fire at words 3/7/11, so runs really are subdivided and the
   *  two attribution rules have something to disagree about. */
  function fixture() {
    const segments = [
      seg('s0', 'kittens likes purple hats', 0, 2),
      seg('s1', 'dragons chase silver moons', 2, 2),
      seg('s2', 'wizards brew golden potions', 4, 2),
      seg('s3', 'falcons guard hidden castles', 6, 2),
    ];
    const words = segments.flatMap(s => s.text.split(' '));
    const tokens: TranscriptToken[] = words.map((w, i) => token(w, i * 0.5, i * 0.5 + 0.4));
    const silences: SilenceInterval[] = [3, 7, 11].map(i => silence(tokens[i]!.startSec));
    return { segments, tokens, silences, audioDuration: 8, words };
  }

  it('is byte-identical to computeFaChunkPlan(..., "segment-start-time") under segment-start-time attribution', () => {
    const { segments, tokens, silences, audioDuration } = fixture();
    const legacy = computeFaChunkPlan(segments, tokens, silences, audioDuration, 'segment-start-time');
    const viaParam = computeFaChunkPlanWithAttribution(segments, tokens, silences, audioDuration, 'segment-start-time');
    expect(viaParam).toEqual(legacy);
  });

  it('WS1 Task 5 Slice D22: defaults to script-word-index attribution when no rule is passed', () => {
    const { segments, tokens, silences, audioDuration } = fixture();
    const omitted = computeFaChunkPlanWithAttribution(segments, tokens, silences, audioDuration);
    const explicitIndex = computeFaChunkPlanWithAttribution(segments, tokens, silences, audioDuration, 'script-word-index');
    const explicitTime = computeFaChunkPlanWithAttribution(segments, tokens, silences, audioDuration, 'segment-start-time');
    expect(omitted).toEqual(explicitIndex);
    expect(omitted).not.toEqual(explicitTime);
  });

  it('WS1 Task 5 Slice D23: computeFaChunkPlan itself defaults to script-word-index (the flip is live)', () => {
    const { segments, tokens, silences, audioDuration } = fixture();
    const omitted = computeFaChunkPlan(segments, tokens, silences, audioDuration);
    const explicitIndex = computeFaChunkPlan(segments, tokens, silences, audioDuration, 'script-word-index');
    const explicitTime = computeFaChunkPlan(segments, tokens, silences, audioDuration, 'segment-start-time');
    const viaWithAttribution = computeFaChunkPlanWithAttribution(segments, tokens, silences, audioDuration, 'script-word-index');
    expect(omitted).toEqual(explicitIndex);
    expect(omitted).toEqual(viaWithAttribution);
    expect(omitted).not.toEqual(explicitTime);
  });

  it('is byte-identical to computeFaChunkPlanCoalesced under segment-start-time attribution', () => {
    const { segments, tokens, silences, audioDuration } = fixture();
    const legacy = computeFaChunkPlanCoalesced(segments, tokens, silences, audioDuration, 5);
    const viaParam = computeFaChunkPlanWithAttribution(segments, tokens, silences, audioDuration, 'segment-start-time', 5);
    expect(viaParam).toEqual(legacy);
  });

  it('places every script word in exactly one chunk, none duplicated or dropped', () => {
    const { segments, tokens, silences, audioDuration, words } = fixture();
    const chunks = computeFaChunkPlanWithAttribution(segments, tokens, silences, audioDuration, 'script-word-index');

    const emitted = chunks.flatMap(c => c.text.split(' ').filter(w => w.length > 0));
    expect(emitted.length).toBe(words.length);
    expect([...emitted].sort()).toEqual([...words].sort());
  });

  it('preserves script word order across chunks', () => {
    const { segments, tokens, silences, audioDuration, words } = fixture();
    const chunks = computeFaChunkPlanWithAttribution(segments, tokens, silences, audioDuration, 'script-word-index');
    const emitted = chunks.flatMap(c => c.text.split(' ').filter(w => w.length > 0));
    expect(emitted).toEqual(words);
  });

  it('emits the same word multiset as the unmerged time-attributed plan', () => {
    const { segments, tokens, silences, audioDuration } = fixture();
    const byTime = computeFaChunkPlan(segments, tokens, silences, audioDuration, 'segment-start-time')
      .flatMap(c => c.text.split(' ').filter(w => w.length > 0))
      .sort();
    const byIndex = computeFaChunkPlanWithAttribution(segments, tokens, silences, audioDuration, 'script-word-index')
      .flatMap(c => c.text.split(' ').filter(w => w.length > 0))
      .sort();
    expect(byIndex).toEqual(byTime);
  });

  it('keeps chunk windows gapless and spanning the full audio', () => {
    const { segments, tokens, silences, audioDuration } = fixture();
    const chunks = computeFaChunkPlanWithAttribution(segments, tokens, silences, audioDuration, 'script-word-index');
    expect(chunks[0]!.startSec).toBe(0);
    expect(chunks[chunks.length - 1]!.endSec).toBe(audioDuration);
    for (let i = 0; i < chunks.length - 1; i++) {
      expect(chunks[i]!.endSec).toBe(chunks[i + 1]!.startSec);
    }
  });

  it('never emits a chunk with text but a zero-length audio window', () => {
    const { segments, tokens, silences, audioDuration } = fixture();
    for (const target of [undefined, 3, 5, 1000] as const) {
      const chunks = computeFaChunkPlanWithAttribution(segments, tokens, silences, audioDuration, 'script-word-index', target);
      for (const c of chunks) {
        expect(c.text.length).toBeGreaterThan(0);
        expect(c.endSec).toBeGreaterThan(c.startSec);
      }
    }
  });

  it('holds the word-conservation invariant under coalescing too', () => {
    const { segments, tokens, silences, audioDuration, words } = fixture();
    for (const target of [3, 5, 1000]) {
      const chunks = computeFaChunkPlanWithAttribution(segments, tokens, silences, audioDuration, 'script-word-index', target);
      const emitted = chunks.flatMap(c => c.text.split(' ').filter(w => w.length > 0));
      expect(emitted).toEqual(words);
    }
  });

  it('cuts text at an anchor even when it falls mid-segment', () => {
    // One long segment spanning the whole corpus, with an anchor in its
    // middle. Time attribution can only put the entire segment in the run
    // containing startTime=0; index attribution must split it at the anchor.
    const segments = [seg('s0', 'kittens likes purple hats dragons chase silver moons', 0, 8)];
    const words = segments[0]!.text.split(' ');
    const tokens: TranscriptToken[] = words.map((w, i) => token(w, i, i + 0.8));
    // This fixture's token stride is 1.0s, wider than `silence()`'s 0.6s
    // reach-back, so it needs its own width to span a seam at all under R-U
    // (see `silence()`'s comment). `endSec` — and therefore the anchor time —
    // is the same value `silence(tokens[4].startSec)` would have produced.
    const silences: SilenceInterval[] = [{ startSec: tokens[4]!.startSec - 1.5, endSec: tokens[4]!.startSec }];

    const byTime = computeFaChunkPlan(segments, tokens, silences, 8, 'segment-start-time');
    const byIndex = computeFaChunkPlanWithAttribution(segments, tokens, silences, 8, 'script-word-index');

    // Time attribution: all 8 words land in one chunk.
    expect(byTime.filter(c => c.text.split(' ').length === 8).length).toBe(1);
    // Index attribution: the anchor splits them across two chunks.
    expect(byIndex.length).toBeGreaterThan(1);
    expect(byIndex.flatMap(c => c.text.split(' '))).toEqual(words);
  });
});

describe('computeFaChunkPlanWithAttribution — forced-split attribution (ear-pass item 9)', () => {
  /**
   * A forced split that is NOT the first run — the shape the whole existing
   * suite misses. `computeFaChunkPlan`'s own "merges a run with no owning
   * segment" test above also force-splits, but its split run is run 0, so
   * `attributeByIndex` takes the `chunks.length === 0` / `pendingStart` branch,
   * which was always correct. The defect only appears once a chunk has already
   * been emitted before the split.
   *
   * Fixture: one real R.1 anchor at t=1.5 ("hats", qi 3), then a 38.5s
   * anchor-free stretch that R-P must force-split at 1.5 + MAX_RUN_SEC = 31.5
   * (no detected silence lies fully inside that window, so it is a
   * `'forced-split-max-run'`). Runs: [0,1.5) agreed-anchor, [1.5,31.5)
   * forced-split, [31.5,40) corpus-end.
   *
   * `runQiRanges` gives the middle run an EMPTY qi range, so all of its text is
   * pooled into the [31.5,40) run. Before the fix `attributeByIndex` folded
   * that run's WINDOW backward onto chunk 0 instead, leaving 9 of the 12 words
   * in a chunk whose audio window starts at 31.5 — the Spanish
   * `023_scylla_six_sailors` failure in miniature.
   */
  function forcedSplitAfterAnchorFixture() {
    const segments = [
      seg('s0', 'kittens likes purple hats', 0, 6),
      seg('s1', 'dragons chase silver moons', 6, 24),
      seg('s2', 'falcons guard hidden castles', 30, 10),
    ];
    const words = segments.flatMap(s => s.text.split(' '));
    const onsets = [0, 0.5, 1.0, 1.5, 6, 12, 18, 24, 30, 33, 36, 38];
    const tokens: TranscriptToken[] = words.map((w, i) => token(w, onsets[i]!, onsets[i]! + 0.4));
    // Exactly one admissible anchor: "hats" at 1.5. Every other token sits far
    // more than ANCHOR_AGREEMENT_SEC (0.15) from this silence's endSec.
    const silences: SilenceInterval[] = [silence(1.5)];
    return { segments, tokens, silences, audioDuration: 40, words, onsets };
  }

  it('keeps a forced-split run\'s window with the text that window\'s audio actually carries', () => {
    const { segments, tokens, silences, audioDuration, words, onsets } =
      forcedSplitAfterAnchorFixture();
    const chunks = computeFaChunkPlanWithAttribution(
      segments, tokens, silences, audioDuration, 'script-word-index',
    );

    // The property under test, stated semantically: every script word's REAL
    // audio onset must fall inside the window of the chunk that holds it.
    // Forced-split mis-attribution violates this and nothing else in the suite
    // checks it.
    let wordIdx = 0;
    for (const chunk of chunks) {
      for (const w of chunk.text.split(' ').filter(x => x.length > 0)) {
        const onset = onsets[wordIdx]!;
        expect(
          onset >= chunk.startSec && onset < chunk.endSec,
          `word ${wordIdx} ("${w}") has onset ${onset}s but its chunk covers ` +
            `[${chunk.startSec}, ${chunk.endSec})`,
        ).toBe(true);
        wordIdx++;
      }
    }
    expect(wordIdx).toBe(words.length);
  });

  it('folds the empty-qi-range window FORWARD onto the chunk that received its text', () => {
    const { segments, tokens, silences, audioDuration } = forcedSplitAfterAnchorFixture();
    const chunks = computeFaChunkPlanWithAttribution(
      segments, tokens, silences, audioDuration, 'script-word-index',
    );

    expect(chunks).toEqual([
      { startSec: 0, endSec: 1.5, text: 'kittens likes purple' },
      { startSec: 1.5, endSec: 40, text: 'hats dragons chase silver moons falcons guard hidden castles' },
    ]);
  });

  it('still covers the full audio gaplessly across the forced split (R-E)', () => {
    const { segments, tokens, silences, audioDuration, words } = forcedSplitAfterAnchorFixture();
    const chunks = computeFaChunkPlanWithAttribution(
      segments, tokens, silences, audioDuration, 'script-word-index',
    );

    expect(chunks[0]!.startSec).toBe(0);
    expect(chunks[chunks.length - 1]!.endSec).toBe(audioDuration);
    for (let i = 0; i < chunks.length - 1; i++) {
      expect(chunks[i]!.endSec).toBe(chunks[i + 1]!.startSec);
    }
    // No word gained, lost, or reordered by the fold.
    expect(chunks.flatMap(c => c.text.split(' ').filter(w => w.length > 0))).toEqual(words);
    for (const c of chunks) expect(c.endSec).toBeGreaterThan(c.startSec);
  });

  it('leaves segment-start-time attribution\'s own backward fold untouched', () => {
    // The two modes need OPPOSITE fold directions: in segment-start-time an
    // empty run's audio belongs to a segment that started earlier and is
    // already attributed backward, so extending the previous chunk is correct
    // there. This fixture's empty run under that mode is the LAST one,
    // [31.5, 40) — s2's startTime (30) falls in [1.5, 31.5), so s2's text sits
    // behind its own audio and the backward fold reunites them. Pinned at the
    // pre-fix value; the fix must not move it.
    const { segments, tokens, silences, audioDuration } = forcedSplitAfterAnchorFixture();
    const byTime = computeFaChunkPlanWithAttribution(
      segments, tokens, silences, audioDuration, 'segment-start-time',
    );
    expect(byTime).toEqual([
      { startSec: 0, endSec: 1.5, text: 'kittens likes purple hats' },
      { startSec: 1.5, endSec: 40, text: 'dragons chase silver moons falcons guard hidden castles' },
    ]);
  });
});

describe('computeFaChunkPlanWithAttribution — coalesced index attribution', () => {
  // Regression test for the Slice D13 Step 4 bug: qi ranges MUST be coalesced
  // in lockstep with time ranges, not re-derived from an already-coalesced
  // run array (which has lost internal boundary provenance). This fixture's
  // target=5 coalesce specifically forces one merged chunk to absorb an
  // internal anchor (the [0,1.5) and [1.5,3.5) raw runs merge into [0,3.5),
  // swallowing the qi=3 anchor) — the exact shape that desynced
  // `anchorCursor` from which anchors a merged run actually spans, and that
  // a purely global (order + count) conservation check does not catch.
  it('gives each coalesced chunk exactly the text between its OWN bounding anchors', () => {
    const segments = [
      seg('s0', 'kittens likes purple hats', 0, 2),
      seg('s1', 'dragons chase silver moons', 2, 2),
      seg('s2', 'wizards brew golden potions', 4, 2),
      seg('s3', 'falcons guard hidden castles', 6, 2),
    ];
    const words = segments.flatMap(s => s.text.split(' '));
    const tokens: TranscriptToken[] = words.map((w, i) => token(w, i * 0.5, i * 0.5 + 0.4));
    const silences: SilenceInterval[] = [3, 7, 11].map(i => silence(tokens[i]!.startSec));

    const chunks = computeFaChunkPlanWithAttribution(segments, tokens, silences, 8, 'script-word-index', 5);

    expect(chunks).toEqual([
      { startSec: 0, endSec: 3.5, text: 'kittens likes purple hats dragons chase silver' },
      { startSec: 3.5, endSec: 8, text: 'moons wizards brew golden potions falcons guard hidden castles' },
    ]);
  });

  it('agrees with unmerged index attribution on which anchor closes out each surviving chunk', () => {
    // A target wide enough to merge everything into ONE chunk must still
    // contain every word in original order — the coalesced degenerate case
    // of the property above.
    const segments = [
      seg('s0', 'kittens likes purple hats', 0, 2),
      seg('s1', 'dragons chase silver moons', 2, 2),
      seg('s2', 'wizards brew golden potions', 4, 2),
      seg('s3', 'falcons guard hidden castles', 6, 2),
    ];
    const words = segments.flatMap(s => s.text.split(' '));
    const tokens: TranscriptToken[] = words.map((w, i) => token(w, i * 0.5, i * 0.5 + 0.4));
    const silences: SilenceInterval[] = [3, 7, 11].map(i => silence(tokens[i]!.startSec));

    const chunks = computeFaChunkPlanWithAttribution(segments, tokens, silences, 8, 'script-word-index', 1000);
    expect(chunks).toEqual([{ startSec: 0, endSec: 8, text: words.join(' ') }]);
  });
});

// ---------------------------------------------------------------------------
// faTextNormalize.ts wiring (WS1 Phase 3b Slice 1) — plumbing only. See
// computeFaChunkPlanWithAttribution's `languageCode`/`vocabChars` doc
// comment: omitting either leaves every pre-existing call path (including
// computeFaChunkPlan's own default, App.tsx's exact production call shape)
// byte-identical to before this slice landed.
// ---------------------------------------------------------------------------

describe('computeFaChunkPlan / computeFaChunkPlanWithAttribution — Phase 3b Slice 1 (faTextNormalize wiring)', () => {
  const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
  const EN_VOCAB: ReadonlySet<string> = (() => {
    const raw = JSON.parse(
      readFileSync(resolve(REPO, 'scripts', 'fixtures', 'fa-vocab-en.json'), 'utf-8'),
    ) as { vocab: Record<string, number> };
    return vocabCharsFromRawVocab(raw.vocab);
  })();

  // Mixed case + trailing punctuation, unlike every fixture above — chosen so
  // a normalization pass (lowercase, boundary-punctuation strip) is visibly
  // distinguishable from raw passthrough, proving the wiring is a real call
  // site rather than plumbing that happens to no-op on already-clean text.
  function englishFixture() {
    const segments = [
      seg('s0', 'Kittens Likes Purple Hats', 0, 2),
      seg('s1', 'Dragons Chase Silver Moons', 2, 2),
      seg('s2', 'Wizards Brew Golden Potions', 4, 2),
      seg('s3', 'Falcons Guard Hidden Castles.', 6, 2),
    ];
    const words = segments.flatMap(s => s.text.split(' '));
    const tokens: TranscriptToken[] = words.map((w, i) => token(w, i * 0.5, i * 0.5 + 0.4));
    const silences: SilenceInterval[] = [3, 7, 11].map(i => silence(tokens[i]!.startSec));
    return { segments, tokens, silences, audioDuration: 8 };
  }

  it('production call shape (computeFaChunkPlan, 4 args, exactly App.tsx\'s own call) is unaffected by this slice', () => {
    const { segments, tokens, silences, audioDuration } = englishFixture();
    const productionShape = computeFaChunkPlan(segments, tokens, silences, audioDuration);
    const viaAttribution = computeFaChunkPlanWithAttribution(segments, tokens, silences, audioDuration, 'script-word-index');
    expect(productionShape).toEqual(viaAttribution);
    // Raw casing/punctuation survives untouched — the default path was never
    // routed through normalizeForForcedAlignment.
    expect(productionShape.some(c => /[A-Z]/.test(c.text))).toBe(true);
    expect(productionShape.some(c => c.text.includes('.'))).toBe(true);
  });

  it('is byte-identical to the pre-slice call signature when languageCode/vocabChars are explicitly undefined', () => {
    const { segments, tokens, silences, audioDuration } = englishFixture();
    const omitted = computeFaChunkPlanWithAttribution(segments, tokens, silences, audioDuration, 'script-word-index');
    const explicitUndefined = computeFaChunkPlanWithAttribution(
      segments, tokens, silences, audioDuration, 'script-word-index', undefined, undefined, undefined,
    );
    expect(explicitUndefined).toEqual(omitted);
  });

  it('opting in with languageCode+vocabChars actually normalizes chunk text (proves the wiring is real, not dead code)', () => {
    const { segments, tokens, silences, audioDuration } = englishFixture();
    const raw = computeFaChunkPlanWithAttribution(segments, tokens, silences, audioDuration, 'script-word-index');
    const normalized = computeFaChunkPlanWithAttribution(
      segments, tokens, silences, audioDuration, 'script-word-index', undefined, 'en', EN_VOCAB,
    );

    // Windows (startSec/endSec) are untouched — only text changes.
    expect(normalized.length).toBe(raw.length);
    for (let i = 0; i < raw.length; i++) {
      expect(normalized[i]!.startSec).toBe(raw[i]!.startSec);
      expect(normalized[i]!.endSec).toBe(raw[i]!.endSec);
    }
    // Normalized text is lowercase and free of the trailing period.
    expect(normalized.some(c => /[A-Z]/.test(c.text))).toBe(false);
    expect(normalized.some(c => c.text.includes('.'))).toBe(false);
    // Same underlying words, modulo case/punctuation — nothing was dropped or
    // reordered by the normalization pass on this all-representable fixture.
    expect(normalized.map(c => c.text.toLowerCase().replace(/[.,]/g, ''))).toEqual(
      raw.map(c => c.text.toLowerCase().replace(/[.,]/g, '')),
    );
  });
});

// ---------------------------------------------------------------------------
// STRADDLE-INVARIANT GUARD (WS2 T3.2 Step 3a-ii). `fa_onnx.rs`'s
// `collapse_word_fragments` (the Rust-side half of the multi-word tokenizer
// capability) depends on a chunk boundary NEVER being able to fall between
// two fragments of one FA-expanded source word. Proved structurally in WS2
// T3.2 Step 3a-i (`.work-phase4/session-ws2-35/
// t32-step3a-i-chunk-straddle-precheck.md`) because chunk assignment
// (`attributeByIndex`/`runsToChunks` above) is computed entirely from RAW,
// pre-normalization script tokens, and FA text normalization
// (`applyFaTextNormalization` above) is applied strictly AFTER chunks are
// already built — it can never feed back into `qi`/boundary arithmetic.
//
// This test is the STANDING CODE-LEVEL GUARD for that precondition — not
// just a session artifact, which isn't durable enough for something this
// load-bearing (a session directory can be deleted; this test cannot be,
// without deliberately removing a passing regression test). If a future
// change ever moved chunk-boundary decisions to run AFTER normalization —
// so a chunk's window could depend on which words normalization drops or
// expands — this test fails FIRST, before `fa_onnx.rs`'s collapse could
// ever silently misattribute a straddling fragment across a chunk seam.
// ---------------------------------------------------------------------------
describe('computeFaChunkPlanWithAttribution — chunk boundaries are independent of FA text normalization (WS2 T3.2 Step 3a-ii straddle-invariant guard)', () => {
  const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
  const EN_VOCAB: ReadonlySet<string> = (() => {
    const raw = JSON.parse(
      readFileSync(resolve(REPO, 'scripts', 'fixtures', 'fa-vocab-en.json'), 'utf-8'),
    ) as { vocab: Record<string, number> };
    return vocabCharsFromRawVocab(raw.vocab);
  })();

  it('chunk count and every startSec/endSec are byte-identical with and without FA normalization applied, even when normalization changes representable-word count', () => {
    // "42"/"7" are digit-bearing and English has no cardinal-expansion table
    // (faTextNormalize.ts's normalizeWord: cardinalExpansion is undefined
    // for 'en'), so FA normalization DROPS them entirely — this fixture
    // deliberately changes representable-word count under normalization,
    // the case where boundary-derivation leaking into normalized text would
    // most plausibly show up as a moved window.
    const segments = [
      seg('s0', 'Kittens Likes 42 Purple Hats', 0, 2),
      seg('s1', 'Dragons Chase Silver Moons', 2, 2),
      seg('s2', 'Wizards Brew 7 Golden Potions', 4, 2),
      seg('s3', 'Falcons Guard Hidden Castles', 6, 2),
    ];
    const words = segments.flatMap(s => s.text.split(' '));
    const tokens: TranscriptToken[] = words.map((w, i) => token(w, i * 0.5, i * 0.5 + 0.4));
    const silences: SilenceInterval[] = [3, 7, 11].map(i => silence(tokens[i]!.startSec));

    const raw = computeFaChunkPlanWithAttribution(segments, tokens, silences, 8, 'script-word-index');
    const normalized = computeFaChunkPlanWithAttribution(
      segments, tokens, silences, 8, 'script-word-index', undefined, 'en', EN_VOCAB,
    );

    // Sanity: normalization actually dropped the digit tokens, so this test
    // is exercising the word-count-changing case it claims to, not a no-op.
    expect(raw.some(c => /\d/.test(c.text))).toBe(true);
    expect(normalized.some(c => /\d/.test(c.text))).toBe(false);

    // THE GUARD: chunk windows never move and chunk count never changes,
    // regardless of what normalization did to the TEXT inside them —
    // boundary decisions are made before, and independently of, whatever
    // this pass drops or expands.
    expect(normalized.length).toBe(raw.length);
    for (let i = 0; i < raw.length; i++) {
      expect(normalized[i]!.startSec).toBe(raw[i]!.startSec);
      expect(normalized[i]!.endSec).toBe(raw[i]!.endSec);
    }
  });
});

// Phase 3c (sync-pipeline-v2-plan.md H.5/:3821-3839 scope addition) — the
// `languageCode` argument also threads into `computeRunContext`'s qi
// bookkeeping (textNormalize.ts's `canonicalize`), not just the post-cut
// `applyFaTextNormalization` step the Slice 1 tests above cover. These tests
// verify the wiring is real (not dead code) and that omitting it — every
// call site today — stays byte-identical to the pre-Phase-3c plan.
describe('computeFaChunkPlan / computeFaChunkPlanWithAttribution — Phase 3c (qi-bookkeeping languageCode)', () => {
  function nonEnglishNumberFixture() {
    // "3.456,78" (es/fr/de/pt convention) is a single space-delimited raw
    // token. Under the pre-fix English-rules parse it garbles to 7 words
    // ("three point four five six seven eight"); correctly parsed it's 9
    // ("three thousand four hundred fifty six point seven eight") — a real
    // qi/word-count difference `computeRunContext` must pick up.
    const segments = [
      seg('s0', 'kittens likes purple 3.456,78', 0, 2),
      seg('s1', 'dragons chase silver moons', 2, 2),
      seg('s2', 'wizards brew golden potions', 4, 2),
      seg('s3', 'falcons guard hidden castles', 6, 2),
    ];
    const words = segments.flatMap(s => s.text.split(' '));
    const tokens: TranscriptToken[] = words.map((w, i) => token(w, i * 0.5, i * 0.5 + 0.4));
    const silences: SilenceInterval[] = [3, 7, 11].map(i => silence(tokens[i]!.startSec));
    return { segments, tokens, silences, audioDuration: 8 };
  }

  it('is byte-identical whether languageCode is omitted or explicitly "en"', () => {
    const { segments, tokens, silences, audioDuration } = nonEnglishNumberFixture();
    const omitted = computeFaChunkPlan(segments, tokens, silences, audioDuration, 'script-word-index');
    const explicitEnglish = computeFaChunkPlan(segments, tokens, silences, audioDuration, 'script-word-index', 'en');
    expect(explicitEnglish).toEqual(omitted);
  });

  it('a non-English languageCode does not throw and produces a well-formed plan (diacritics + inverted separators)', () => {
    const segments = [
      seg('s0', 'café garçon straße 2.500,50', 0, 2),
      seg('s1', 'dragons chase silver moons', 2, 2),
      seg('s2', 'wizards brew golden potions', 4, 2),
      seg('s3', 'falcons guard hidden castles', 6, 2),
    ];
    const words = segments.flatMap(s => s.text.split(' '));
    const tokens: TranscriptToken[] = words.map((w, i) => token(w, i * 0.5, i * 0.5 + 0.4));
    const silences: SilenceInterval[] = [3, 7, 11].map(i => silence(tokens[i]!.startSec));

    for (const lang of ['es', 'fr', 'de', 'pt'] as const) {
      const chunks = computeFaChunkPlan(segments, tokens, silences, 8, 'script-word-index', lang);
      expect(chunks.length).toBeGreaterThan(0);
      expect(chunks.every(c => c.text.trim().length > 0)).toBe(true);
    }
  });
});

// ===========================================================================
// R.5 — UNSCRIPTED AUDIO (WS1 Session D).
//
// Both real configurations (ear-pass items 4 and 5) are exercised against the
// committed corpus fixtures rather than synthetic text, because the whole
// question R.5 answers — "is this audio a mis-tokenization of the script, or
// is it not in the script at all?" — only has a meaningful answer on real
// Whisper output. The synthetic cases below cover the shapes the corpora do
// not contain (a clean scripted run, an empty corpus).
// ===========================================================================
describe('computeFaChunkPlan — R.5 unscripted-audio excision (WS1 Session D)', () => {
  const FIX = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', 'scripts', 'fixtures');

  function csv(name: string): Record<string, string>[] {
    const text = readFileSync(resolve(FIX, name), 'utf-8');
    const rows: string[][] = [];
    let row: string[] = []; let field = ''; let q = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (q) { if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else q = false; } else field += c; }
      else if (c === '"') q = true;
      else if (c === ',') { row.push(field); field = ''; }
      else if (c === '\n') { row.push(field); field = ''; rows.push(row); row = []; }
      else if (c !== '\r') field += c;
    }
    if (field.length > 0 || row.length > 0) { row.push(field); rows.push(row); }
    const h = rows.shift() ?? [];
    return rows.filter(r => r.length === h.length)
      .map(r => Object.fromEntries(h.map((x, i) => [x, r[i] ?? ''])) as Record<string, string>);
  }

  function corpus(key: 'v6' | '173' | 'spanish') {
    const tokens: TranscriptToken[] = csv(`phase4-baseline-${key}-words.csv`)
      .map(r => ({ text: r.text!, startSec: Number(r.startSec), endSec: Number(r.endSec) }));
    const silences: SilenceInterval[] = csv(`phase4-baseline-${key}-silences.csv`)
      .map(r => ({ startSec: Number(r.startSec), endSec: Number(r.endSec) }));
    // The COMPLETE, pre-skip-filter parse — the array production hands
    // `computeFaChunkPlan`, built before any skip decision exists. Until WS1
    // Session E the `-segments.csv` fixture WAS that array, but only because FA
    // skipped nothing; R.10 now drops two 173 scenes into `-skipped.csv`, so the
    // two files have to be merged back by `segmentIndex` to rebuild it. Same
    // reconstruction, and the same reason, as `scripts/phase4-fa-replay.test.ts`'s
    // own `loadAnchorPathInputs`.
    const mk = (r: Record<string, string>, text: string, order: number): VideoSegment => ({
      id: r.segmentTag ?? r.tag!, text, startTime: Number(r.startTime), duration: Number(r.duration),
      transition: 'none', animation: 'none', order,
    }) as unknown as VideoSegment;
    const committedRows = csv(`phase4-fa-second-baseline-${key}-segments.csv`);
    const skippedRows = csv(`phase4-fa-second-baseline-${key}-skipped.csv`);
    const skippedByIndex = new Map(skippedRows.map(r => [Number(r.segmentIndex), r]));
    const segments: VideoSegment[] = [];
    let nextCommitted = 0;
    for (let i = 0; i < committedRows.length + skippedRows.length; i++) {
      const sk = skippedByIndex.get(i);
      if (sk) { segments.push(mk(sk, sk.segmentText!, i)); continue; }
      const c = committedRows[nextCommitted++]!;
      segments.push(mk(c, c.text!, i));
    }
    const audioDuration = { v6: 1421.29, '173': 709.01, spanish: 92.04 }[key];
    return { tokens, silences, segments, audioDuration };
  }

  /** Spans present in the plan's windows at HEAD but absent under R.5. */
  function excisedSpans(chunks: readonly { startSec: number; endSec: number }[]): Array<[number, number]> {
    const out: Array<[number, number]> = [];
    for (let i = 1; i < chunks.length; i++) {
      const gap = chunks[i]!.startSec - chunks[i - 1]!.endSec;
      if (gap > 1e-9) out.push([chunks[i - 1]!.endSec, chunks[i]!.startSec]);
    }
    return out;
  }

  const CORPUS_TIMEOUT_MS = 120_000;

  it('item 5: the "Level two" recitation [125.54, 129.01] is excised, and "You are eleven." is no longer offered its frames', () => {
    const { tokens, silences, segments, audioDuration } = corpus('v6');
    const chunks = computeFaChunkPlan(segments, tokens, silences, audioDuration);

    const before = chunks.find(c => Math.abs(c.endSec - 125.54) < 0.005);
    const after = chunks.find(c => Math.abs(c.startSec - 129.01) < 0.005);
    expect(before, 'the chunk ENDING at the recitation onset').toBeDefined();
    expect(after, 'the chunk RESUMING after the recitation').toBeDefined();
    // The cut is in the SCRIPT, not just in time: "…what it means." closes the
    // preceding segment and "You are eleven." opens the following one.
    expect(before!.text.endsWith('means.')).toBe(true);
    expect(after!.text.startsWith('You are eleven.')).toBe(true);
    // ...and nothing is aligned against the recitation itself.
    expect(chunks.some(c => c.startSec < 129.01 - 1e-9 && c.endSec > 125.54 + 1e-9)).toBe(false);
  }, CORPUS_TIMEOUT_MS);

  it('item 4: the "Level 8" recitation [925.14, 928.93] is excised, and "You are forty-nine." is no longer offered its frames', () => {
    const { tokens, silences, segments, audioDuration } = corpus('v6');
    const chunks = computeFaChunkPlan(segments, tokens, silences, audioDuration);

    const before = chunks.find(c => Math.abs(c.endSec - 925.14) < 0.005);
    const after = chunks.find(c => Math.abs(c.startSec - 928.93) < 0.005);
    expect(before, 'the chunk ENDING at the recitation onset').toBeDefined();
    expect(after, 'the chunk RESUMING after the recitation').toBeDefined();
    expect(before!.text.endsWith('working.')).toBe(true);
    expect(after!.text.startsWith('You are forty-nine.')).toBe(true);
    expect(chunks.some(c => c.startSec < 928.93 - 1e-9 && c.endSec > 925.14 + 1e-9)).toBe(false);
  }, CORPUS_TIMEOUT_MS);

  it('all ten V6 recitations are handled — nine splits plus one corpus-start trim — and nothing else is', () => {
    const { tokens, silences, segments, audioDuration } = corpus('v6');
    const chunks = computeFaChunkPlan(segments, tokens, silences, audioDuration);

    // The tenth recitation opens the file, so its "before" side carries no
    // script at all: its window is TRIMMED rather than split, which is why
    // there are nine gaps and not ten.
    expect(chunks[0]!.startSec, 'the corpus-start recitation is trimmed off the first window').toBeCloseTo(3.40, 2);

    expect(excisedSpans(chunks).map(([a, b]) => [Number(a.toFixed(2)), Number(b.toFixed(2))])).toEqual([
      [125.54, 129.01], [251.56, 253.11], [371.54, 373.27], [522.00, 525.63], [663.91, 666.48],
      [789.26, 791.69], [925.14, 928.93], [1044.72, 1050.00], [1189.76, 1192.17],
    ]);
  }, CORPUS_TIMEOUT_MS);

  it('SUBWORD-FRAGMENTATION NEAR-MISS: spanish 001_scylla_intro does NOT fire R.5, and neither does anything else in 173/spanish', () => {
    // The false-positive R.5 must never make. Whisper tokenizes "Scylla" as
    // `S` + `illa`, leaving an unclaimed token run that looks exactly like
    // unscripted audio by LENGTH — Session C measured it as the case a
    // fuzzy-containment threshold gets wrong. The zero-script-hole test
    // rejects it structurally: the script word it fragments is itself
    // unmatched, so the script side is NOT clean opposite that audio.
    for (const key of ['spanish', '173'] as const) {
      const { tokens, silences, segments, audioDuration } = corpus(key);
      const chunks = computeFaChunkPlan(segments, tokens, silences, audioDuration);
      expect(excisedSpans(chunks), `${key}: R.5 must not fire anywhere in this corpus`).toEqual([]);
      expect(chunks[0]!.startSec, `${key}: no corpus-start trim either`).toBe(0);
    }
  }, CORPUS_TIMEOUT_MS);

  it('R.10 MUTUAL EXCLUSION: neither 173 segment R.10 claims sits opposite an R.5 run', () => {
    // R.5 fires on audio with no script counterpart; R.10 on a segment with no
    // audio counterpart. They are disjoint by construction, and measured
    // disjoint: R.10's two firing segments (`perilous_realms`, `blue_monkey`)
    // are both in 173, and 173 has zero R.5 runs — so the two rules cannot
    // co-fire on any segment of any committed corpus.
    //
    // WS1 Session E: R.10 has since LANDED, so both segments now live in
    // `phase4-fa-second-baseline-173-skipped.csv` rather than the committed
    // one. `corpus()` merges the pair back into the complete pre-skip parse, so
    // this test still asks its original question — the chunk plan R.5 acts on
    // is built BEFORE R.10 runs, and R.10 must not have changed it.
    const { tokens, silences, segments, audioDuration } = corpus('173');
    const chunks = computeFaChunkPlan(segments, tokens, silences, audioDuration);
    expect(excisedSpans(chunks)).toEqual([]);
    for (const tag of ['perilous_realms', 'blue_monkey']) {
      const seg = segments.find(s => String(s.id) === tag)!;
      expect(seg, `${tag} must exist in the 173 fixture`).toBeDefined();
      const covering = chunks.filter(c => c.endSec > seg.startTime && c.startSec < seg.startTime + seg.duration);
      expect(covering.length, `${tag}: still covered by a contiguous plan, so R.5 took nothing from it`).toBeGreaterThan(0);
    }
  }, CORPUS_TIMEOUT_MS);

  it('a fully scripted corpus is untouched — R.5 emits the identical plan', () => {
    // The synthetic fixture every other block in this file uses: every token
    // is some segment's own word, so there is no unclaimed run at all and R.5
    // must be a byte-for-byte no-op.
    const segments = [
      seg('s0', 'Kittens like purple hats', 0, 2),
      seg('s1', 'Dragons chase silver moons', 2, 2),
      seg('s2', 'Wizards brew golden potions', 4, 2),
      seg('s3', 'Falcons guard hidden castles', 6, 2),
    ];
    const words = segments.flatMap(s => s.text.split(' '));
    const tokens: TranscriptToken[] = words.map((w, i) => token(w, i * 0.5, i * 0.5 + 0.4));
    const silences: SilenceInterval[] = [3, 7, 11].map(i => silence(tokens[i]!.startSec));

    const chunks = computeFaChunkPlan(segments, tokens, silences, 8);
    expect(excisedSpans(chunks)).toEqual([]);
    expect(chunks[0]!.startSec).toBe(0);
    expect(chunks[chunks.length - 1]!.endSec).toBe(8);
    // Every segment's text still reaches exactly one chunk.
    const all = chunks.map(c => c.text).join(' ');
    for (const s of segments) expect(all).toContain(s.text);
  });

  it('detectUnscriptedRuns is inert on an empty transcript', () => {
    expect(detectUnscriptedRuns([], [], [], [])).toEqual([]);
  });
});

describe('computeFaChunkPlanS2 (WS1 Session AI — measurement arm, not called by production)', () => {
  it('never places a chunk edge inside a sentence, including one spanning a segment seam', () => {
    // s0+s1 are one sentence across two segments ("They're the worst" +
    // "because...showed up.") — the exact 173 segments-5/6 shape. A
    // segment-only cut (invariant 1 alone) could still separate them; S2
    // must not.
    const segments = [
      seg('s0', 'They are the worst', 0, 2),
      seg('s1', 'because the trap was already set.', 2, 3),
      seg('s2', 'The second sentence stands alone.', 5, 3),
      seg('s3', 'And so does the third one here.', 8, 3),
    ];
    const silences: SilenceInterval[] = [silence(2), silence(5), silence(8)];
    const { chunks, violations } = computeFaChunkPlanS2(segments, silences, 11, 1, 30);
    // No chunk boundary may fall between s0 and s1 (mid-sentence).
    const cutTimes = new Set(chunks.slice(0, -1).map(c => c.endSec));
    expect(cutTimes.has(2)).toBe(false);
    expect(violations).toEqual([]);
    // Every segment's text reaches exactly one chunk.
    const all = chunks.map(c => c.text).join(' ');
    for (const s of segments) expect(all).toContain(s.text);
  });

  it('a chunk is always a whole number of script segments — never a fragment', () => {
    const segments = [
      seg('s0', 'First sentence here.', 0, 2),
      seg('s1', 'Second sentence here.', 2, 2),
      seg('s2', 'Third sentence here.', 4, 2),
    ];
    const silences: SilenceInterval[] = [silence(2), silence(4)];
    const { chunks } = computeFaChunkPlanS2(segments, silences, 6, 1, 30);
    for (const c of chunks) {
      for (const s of segments) {
        // A segment's text is either wholly inside this chunk's text or
        // wholly absent — never a partial-word overlap.
        expect(c.text.includes(s.text) || !c.text.includes(s.text.split(' ')[0]!)).toBe(true);
      }
    }
  });

  it('emits a first-class violation, not a silent split, for an unbreakable group over the cap', () => {
    const segments = [
      seg('s0', 'A short lead-in sentence.', 0, 2),
      // No terminator until segment 2 — s1+s2 form one unbreakable group
      // whose span (2 to 40) is 38s, over a 30s cap.
      seg('s1', 'A very long run-on clause that keeps going', 2, 20),
      seg('s2', 'and keeps going until it finally ends.', 22, 18),
    ];
    const silences: SilenceInterval[] = [silence(2)];
    const { chunks, violations } = computeFaChunkPlanS2(segments, silences, 40, 10, 30);
    expect(violations.some(v => v.cause === 'oversize-unbreakable-group')).toBe(true);
    // The oversize group is still emitted WHOLE, in one chunk — never split.
    const bigChunk = chunks.find(c => c.text.includes('run-on clause'));
    expect(bigChunk?.text).toContain('and keeps going until it finally ends.');
  });

  it('excludes Whisper timestamps entirely from the text-partition decision (no token/alignment argument exists)', () => {
    // The function signature itself is the invariant: no TranscriptToken[]
    // parameter exists to pass one. `.length` only counts params BEFORE the
    // first one with a default (JS semantics), so this pins the three
    // required params — segments, silences, audioDuration — none of which is
    // a token/alignment array. Documented here as a standing check that a
    // future edit does not quietly add one back.
    expect(computeFaChunkPlanS2.length).toBe(3);
  });

  it('is a pure measurement arm: does not mutate its inputs', () => {
    const segments = [
      seg('s0', 'One sentence stands here.', 0, 3),
      seg('s1', 'Another sentence follows it.', 3, 3),
    ];
    const silences: SilenceInterval[] = [silence(3)];
    const before = JSON.stringify(segments);
    computeFaChunkPlanS2(segments, silences, 6, 1, 30);
    expect(JSON.stringify(segments)).toBe(before);
  });
});
