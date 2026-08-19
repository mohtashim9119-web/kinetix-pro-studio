/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// ---------------------------------------------------------------------------
// WS1 Session Q — PRODUCTION INVARIANTS, second set.
//
// `ws1-session-p-invariants.test.ts` asserts R.12's own invariant (no
// committed boundary strictly inside an unscripted run) against the real
// production path. This file asserts R.13's — the CLOSING half of the same
// pair, which `sync-pipeline-v2-plan.md` Part N(e) left explicitly unaudited:
//
//   CLOSING (R.13) — the boundary that CLOSES the segment carrying a run may
//   not lie before that segment's own utterance has finished.
//
// Stated over the run's ACOUSTIC extent for the same reason Session P states
// R.12's that way: a run's raw token span begins on the punctuation token
// representing the pause before the utterance and can end on the punctuation
// token representing the pause after it, so neither raw edge is where the
// unscripted speech actually is. The invariant is about speech, so it is
// stated over speech.
//
// RED BEFORE GREEN: with R.13 reading the RAW run end (its state at HEAD
// e7e4f9a), this assertion fails on the live v6 bundle while R.13 reports
// zero findings — the tail-side twin of Session P's head-side detection
// failure.
// ---------------------------------------------------------------------------

import { describe, it, expect } from 'vitest';
import { normalize, alignScenestoTranscript } from '../src/services/whisperService';
import { CORPORA, runProductionPath, tagOf } from './ws1-session-p-pipeline.js';
import type { TranscriptToken, VideoSegment } from '../src/types';

const substantive = (t: TranscriptToken | undefined): boolean =>
  t !== undefined && normalize(t.text).length > 0;

describe('WS1 Session Q — R.13 production invariant (v6 live bundle)', () => {
  const TIMEOUT = 900_000;

  it('R.13 invariant: no run-carrying segment is closed before its own utterance ends', async () => {
    const spec = CORPORA.v6!;
    const r = await runProductionPath(spec);

    const alignments = alignScenestoTranscript(
      r.anchorTimed as VideoSegment[], r.whisperTokens as TranscriptToken[], r.silences, spec.audioDuration,
    );
    const alignById = new Map<string, (typeof alignments)[number]>();
    r.anchorTimed.forEach((s, i) => { const a = alignments[i]; if (a) alignById.set(s.id, a); });

    const violations: string[] = [];
    for (const run of r.r5runs) {
      // Acoustic onset — the first token in the run that carries speech.
      let lo = run.tokenLo;
      while (lo <= run.tokenHi && !substantive(r.whisperTokens[lo])) lo++;
      const acousticStart = r.whisperTokens[lo]?.startSec ?? run.startSec;

      const ci = r.committed.findIndex(
        s => acousticStart >= s.startTime && acousticStart < s.startTime + s.duration,
      );
      if (ci < 0 || ci + 1 >= r.committed.length) continue;
      const carrier = r.committed[ci]!;
      const a = alignById.get(carrier.id);
      if (!a || !a.matched || a.lastTokenIdx < 0) continue;
      const utteranceEndSec = r.whisperTokens[a.lastTokenIdx]!.endSec;

      // Only the shape R.13 describes: the carrier's own line comes AFTER the
      // run it carries. Otherwise there is no closing edge to protect.
      let hi = run.tokenHi;
      while (hi >= run.tokenLo && !substantive(r.whisperTokens[hi])) hi--;
      const acousticEnd = r.whisperTokens[hi]?.endSec ?? run.endSec;
      if (!(utteranceEndSec > acousticEnd + 1e-9)) continue;

      const successor = r.committed[ci + 1]!;
      if (successor.startTime < utteranceEndSec - 1e-9) {
        violations.push(
          `carrier ${ci} ${tagOf(carrier)} closes at ${successor.startTime.toFixed(3)} ` +
          `but its own utterance runs to ${utteranceEndSec.toFixed(3)} ` +
          `(short by ${(utteranceEndSec - successor.startTime).toFixed(3)}s; run acoustic [${acousticStart.toFixed(3)}, ${acousticEnd.toFixed(3)}])`,
        );
      }
    }

    expect(violations, 'R.13 exists to make this set empty').toEqual([]);
  }, TIMEOUT);
});
