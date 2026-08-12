/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import type { TranscriptToken, VideoSegment } from '../types';
import type { SilenceInterval } from './silenceDetector';
import { computeFaChunkPlan } from './faChunkPlan';
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
