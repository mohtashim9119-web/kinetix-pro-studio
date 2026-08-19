/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// ---------------------------------------------------------------------------
// WS1 Session Q — STEP 2. R.13 TAIL AUDIT.
//
// `sync-pipeline-v2-plan.md` Part N(e) left this open: R.12's zero findings
// were a raw-token-inflation detection failure at the run's HEAD, and R.13
// sits in the same file, reads the same raw array, and also reports zero. Its
// admission guard is `utteranceEndSec > run.endSec + 1e-9`, and `run.endSec`
// is the RAW run end — which, when a run terminates in a punctuation token,
// sits LATER than the last spoken word. The question Part N(e) poses is
// whether R.13's zero is genuine idleness or a tail-side suppression of the
// same kind.
//
// This file re-walks `detectUtterancePlacementDefects`'s decision procedure
// step for step over the SAME live inputs and records, per run, every quantity
// the rule reads and the exact condition that declined — including, at each
// tail, the RAW-vs-ACOUSTIC run end and the inflation between them. It is a
// transcription of the real function; the rule itself is called alongside so
// the two firing counts can be compared.
// ---------------------------------------------------------------------------

import { describe, it, expect } from 'vitest';
import { writeFileSync, mkdirSync } from 'fs';
import { resolve } from 'path';
import { R12_MIN_CORRECTION_SEC } from '../src/services/syncConstants';
import { alignScenestoTranscript, normalize } from '../src/services/whisperService';
import { CORPORA, OUT_ROOT, runProductionPath, tagOf } from './ws1-session-p-pipeline.js';
import type { TranscriptToken, VideoSegment } from '../src/types';

const MEASURE = process.env.WS1_SESSION_Q_MEASURE === '1';

const substantive = (t: TranscriptToken | undefined): boolean =>
  t !== undefined && normalize(t.text).length > 0;

type Decline =
  | 'no-carrier'                 // run onset in no committed segment, or carrier is last
  | 'carrier-unmatched'          // carrier has no own words to protect
  | 'guard-utterance-not-after-run'
  | 'already-legal'              // committedValue >= utteranceEndSec
  | 'h7-corrected-in-run'
  | 'would-pass-successor-end'
  | 'below-min-correction'
  | 'FIRES';

describe.skipIf(!MEASURE)('WS1 Session Q — R.13 tail audit (Step 2)', () => {
  it('reports, per run tail, the gap R.13 sees and the exact declining condition', async () => {
    const r = await runProductionPath(CORPORA.v6!);
    mkdirSync(OUT_ROOT, { recursive: true });

    const tokens = r.whisperTokens;
    const silences = r.silences;
    const runs = r.r5runs;
    // R.13 detects against the array it is GIVEN — post-R.12 in App.tsx's
    // order, which is exactly `r.committed` after R.12's corrections.
    const committed = r.committed;
    const parsed = r.anchorTimed;

    const alignments = alignScenestoTranscript(
      parsed as VideoSegment[], tokens as TranscriptToken[], r.silences, CORPORA.v6!.audioDuration,
    );
    const alignById = new Map<string, (typeof alignments)[number]>();
    parsed.forEach((s, i) => { const a = alignments[i]; if (a) alignById.set(s.id, a); });

    const rows: Array<Record<string, unknown>> = [];

    for (let ri = 0; ri < runs.length; ri++) {
      const run = runs[ri]!;

      // The run's ACOUSTIC extent, the same view R.12's fix reads.
      let lo = run.tokenLo;
      while (lo <= run.tokenHi && !substantive(tokens[lo])) lo++;
      let hi = run.tokenHi;
      while (hi >= run.tokenLo && !substantive(tokens[hi])) hi--;
      const acousticStart = lo <= hi && tokens[lo] ? tokens[lo]!.startSec : run.startSec;
      const acousticEnd = lo <= hi && tokens[hi] ? tokens[hi]!.endSec : run.endSec;

      const ci = committed.findIndex(
        s => run.startSec >= s.startTime && run.startSec < s.startTime + s.duration,
      );
      const ciAcoustic = committed.findIndex(
        s => acousticStart >= s.startTime && acousticStart < s.startTime + s.duration,
      );

      const base: Record<string, unknown> = {
        runIndex: ri,
        runTokenLo: run.tokenLo,
        runTokenHi: run.tokenHi,
        rawRunStartSec: run.startSec,
        rawRunEndSec: run.endSec,
        acousticRunStartSec: acousticStart,
        acousticRunEndSec: acousticEnd,
        headInflationSec: acousticStart - run.startSec,
        tailInflationSec: run.endSec - acousticEnd,
        lastRawTokenText: tokens[run.tokenHi]?.text ?? null,
        lastSubstantiveTokenText: tokens[hi]?.text ?? null,
        carrierIndexRaw: ci,
        carrierIndexAcoustic: ciAcoustic,
        carrierTagRaw: ci >= 0 ? tagOf(committed[ci]!) : null,
        carrierTagAcoustic: ciAcoustic >= 0 ? tagOf(committed[ciAcoustic]!) : null,
      };

      if (ci < 0 || ci + 1 >= committed.length) {
        rows.push({ ...base, decline: 'no-carrier' satisfies Decline });
        continue;
      }
      const carrier = committed[ci]!;
      const a = alignById.get(carrier.id);
      if (!a || !a.matched || a.lastTokenIdx < 0) {
        rows.push({ ...base, carrierTag: tagOf(carrier), decline: 'carrier-unmatched' satisfies Decline });
        continue;
      }

      const utteranceEndSec = tokens[a.lastTokenIdx]!.endSec;
      const guardMarginRaw = utteranceEndSec - run.endSec;
      const guardMarginAcoustic = utteranceEndSec - acousticEnd;

      const successor = committed[ci + 1]!;
      const committedValue = successor.startTime;

      let best: { startSec: number; endSec: number } | undefined;
      for (const s of silences) {
        if (!(s.startSec >= utteranceEndSec - 1e-9)) continue;
        if (best === undefined || s.startSec < best.startSec - 1e-12 ||
            (Math.abs(s.startSec - best.startSec) <= 1e-12 && s.endSec < best.endSec)) {
          best = { startSec: s.startSec, endSec: s.endSec };
        }
      }
      const correctedValue = best ? (best.startSec + best.endSec) / 2 : utteranceEndSec;
      const h7Raw = runs.some(u => correctedValue > u.startSec + 1e-9 && correctedValue < u.endSec - 1e-9);
      const nextBoundary = committed[ci + 2]?.startTime ?? CORPORA.v6!.audioDuration;

      let decline: Decline = 'FIRES';
      if (!(guardMarginRaw > 1e-9)) decline = 'guard-utterance-not-after-run';
      else if (!(committedValue < utteranceEndSec - 1e-9)) decline = 'already-legal';
      else if (h7Raw) decline = 'h7-corrected-in-run';
      else if (!(correctedValue < nextBoundary - 1e-9)) decline = 'would-pass-successor-end';
      else if (Math.abs(correctedValue - committedValue) <= R12_MIN_CORRECTION_SEC) decline = 'below-min-correction';

      // The counterfactual: same walk, with the ACOUSTIC run end in the guard
      // and in H7 — i.e. R.12's fix mirrored to the tail.
      let declineAcoustic: Decline = 'FIRES';
      const h7Acoustic = runs.some((u, ui) => {
        const uLo = ui === ri ? acousticStart : u.startSec;
        const uHi = ui === ri ? acousticEnd : u.endSec;
        return correctedValue > uLo + 1e-9 && correctedValue < uHi - 1e-9;
      });
      if (!(guardMarginAcoustic > 1e-9)) declineAcoustic = 'guard-utterance-not-after-run';
      else if (!(committedValue < utteranceEndSec - 1e-9)) declineAcoustic = 'already-legal';
      else if (h7Acoustic) declineAcoustic = 'h7-corrected-in-run';
      else if (!(correctedValue < nextBoundary - 1e-9)) declineAcoustic = 'would-pass-successor-end';
      else if (Math.abs(correctedValue - committedValue) <= R12_MIN_CORRECTION_SEC) declineAcoustic = 'below-min-correction';

      rows.push({
        ...base,
        carrierTag: tagOf(carrier),
        successorIndex: ci + 1,
        successorTag: tagOf(successor),
        carrierLastTokenIdx: a.lastTokenIdx,
        carrierLastTokenText: tokens[a.lastTokenIdx]?.text ?? null,
        utteranceEndSec,
        guardMarginRawSec: guardMarginRaw,
        guardMarginAcousticSec: guardMarginAcoustic,
        committedValue,
        backingSilence: best ?? null,
        correctedValue,
        correctionSec: correctedValue - committedValue,
        h7BlockedRaw: h7Raw,
        h7BlockedAcoustic: h7Acoustic,
        nextBoundary,
        decline,
        declineAcoustic,
      });
    }

    const counts: Record<string, number> = {};
    const countsAcoustic: Record<string, number> = {};
    for (const row of rows) {
      counts[row.decline as string] = (counts[row.decline as string] ?? 0) + 1;
      if (row.declineAcoustic) {
        countsAcoustic[row.declineAcoustic as string] = (countsAcoustic[row.declineAcoustic as string] ?? 0) + 1;
      }
    }

    writeFileSync(resolve(OUT_ROOT, 'stepQ2-r13-tail.json'), JSON.stringify({
      runId: r.runId, runCount: runs.length, r13ActualFindings: r.r13.length,
      declineCounts: counts, declineCountsUnderAcousticTail: countsAcoustic, rows,
    }, null, 2));

    // eslint-disable-next-line no-console
    console.log('[STEP Q2]', JSON.stringify({
      runs: runs.length, r13Fired: r.r13.length, counts, countsAcoustic,
    }, null, 2));
    for (const row of rows) {
      // eslint-disable-next-line no-console
      console.log(
        `  run ${row.runIndex} rawEnd=${(row.rawRunEndSec as number).toFixed(3)} acEnd=${(row.acousticRunEndSec as number).toFixed(3)} ` +
        `tailInflation=${(row.tailInflationSec as number).toFixed(3)} carrier=${row.carrierTagRaw} ` +
        `guardRaw=${row.guardMarginRawSec === undefined ? 'n/a' : (row.guardMarginRawSec as number).toFixed(3)} ` +
        `-> ${row.decline} | acoustic -> ${row.declineAcoustic ?? 'n/a'}`,
      );
    }

    expect(rows.length).toBe(runs.length);
  }, 900_000);
});
