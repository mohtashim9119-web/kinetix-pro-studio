/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import type { TranscriptToken, VideoSegment } from '../types';
import type { SilenceInterval } from './silenceDetector';
import { coalesceRuns, computeFaChunkPlan, computeFaChunkPlanCoalesced } from './faChunkPlan';
import type { FaRun } from './faAnchors';
import { MAX_RUN_SEC } from './syncConstants';

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
  return { startSec: endSec - 0.3, endSec };
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

    const chunks = computeFaChunkPlan(segments, tokens, silences, 8);

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

    const chunks = computeFaChunkPlan(segments, tokens, silences, 40);
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

    const baseline = computeFaChunkPlan(segments, tokens, silences, 40);
    const coalesced = computeFaChunkPlanCoalesced(segments, tokens, silences, 40, 10);

    // Coalescing actually did something (fewer, larger chunks).
    expect(coalesced.length).toBeLessThan(baseline.length);
    for (const c of coalesced) expect(c.endSec - c.startSec).toBeLessThanOrEqual(10);

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
