/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// ---------------------------------------------------------------------------
// WS1 Session P — STEP 5b. R.12 ROOT CAUSE.
//
// R.12 reports ZERO findings on the live bundle while committed boundaries sit
// STRICTLY INSIDE R.5 unscripted runs — the exact condition R.12 exists to
// correct. That is a detection failure, not idleness, and its own invariant
// currently fails in production.
//
// This file re-walks `detectRunPlacementDefects`'s decision procedure step for
// step over the SAME live inputs and records, for every committed boundary
// found strictly inside a run, which condition declined and with what margin.
// The walk is a transcription of the real function (faRunPlacementGate.ts
// lines 167-239) — it computes nothing the rule does not, and the rule itself
// is called alongside it so the two firing counts can be compared.
// ---------------------------------------------------------------------------

import { describe, it, expect } from 'vitest';
import { writeFileSync, mkdirSync } from 'fs';
import { resolve } from 'path';
import { R12_MIN_CORRECTION_SEC } from '../src/services/syncConstants';
import { CORPORA, OUT_ROOT, runProductionPath, tagOf } from './ws1-session-p-pipeline.js';

type Decline =
  | 'no-prev-token'          // run at corpus start
  | 'empty-gap'              // prevToken.endSec >= run.startSec
  | 'h7-corrected-in-run'    // the correction would land inside another run
  | 'below-min-correction'   // |corrected - committed| <= R12_MIN_CORRECTION_SEC
  | 'FIRES';

// GENERATOR / MEASUREMENT — NOT part of the default `npm test` sweep.
// Set WS1_SESSION_P_MEASURE=1 to run. Same convention as the Rust
// `#[ignore]`d measurement modules: these write into `.work-phase4/` and take
// minutes, and one of them REWRITES a bundle arm — letting that happen inside
// a plain `npm test` un-stamps the bundle and breaks every consumer, which is
// exactly what it did once before this gate existed.
const MEASURE = process.env.WS1_SESSION_P_MEASURE === '1';

describe.skipIf(!MEASURE)('WS1 Session P — R.12 root cause (Step 5b)', () => {
  it('traces every boundary strictly inside an R.5 run', async () => {
    const r = await runProductionPath(CORPORA.v6!);
    mkdirSync(OUT_ROOT, { recursive: true });

    const tokens = r.whisperTokens;
    const silences = r.silences;
    const runs = r.r5runs;
    // R.12 detects against the array it is GIVEN — post-R.11 in App.tsx's
    // order. `preRuleSegments` is pre-R.11; use the same array the real call
    // saw, which is the R.11-corrected one.
    const committed = r.committed;

    const rows: Array<Record<string, unknown>> = [];

    for (let ri = 0; ri < runs.length; ri++) {
      const run = runs[ri]!;
      const prevToken = tokens[run.tokenLo - 1];
      const gapStartSec = prevToken ? prevToken.endSec : Number.NaN;
      const gapEndSec = run.startSec;

      // Reproduce the clamped-midpoint candidate exactly.
      let best: { silence: { startSec: number; endSec: number }; lo: number; hi: number } | undefined;
      if (prevToken && gapEndSec - gapStartSec > 0) {
        for (const s of silences) {
          const lo = Math.max(s.startSec, gapStartSec);
          const hi = Math.min(s.endSec, gapEndSec);
          if (!(hi - lo > 1e-9)) continue;
          if (
            best === undefined ||
            hi - lo > best.hi - best.lo + 1e-12 ||
            (Math.abs((hi - lo) - (best.hi - best.lo)) <= 1e-12 &&
              (s.startSec > best.silence.startSec ||
                (s.startSec === best.silence.startSec && s.endSec > best.silence.endSec)))
          ) best = { silence: { startSec: s.startSec, endSec: s.endSec }, lo, hi };
        }
      }
      const correctedValue = best ? (best.lo + best.hi) / 2 : gapEndSec;
      const h7Blocked = runs.some(u => correctedValue > u.startSec + 1e-9 && correctedValue < u.endSec - 1e-9);

      // Which silence, if any, LEADS the run (the one the rule is trying to
      // place the boundary in). Reported for every row whether or not the rule
      // found it, because a row where the leading silence exists and the rule
      // still declined is the interesting shape.
      const leadingSilence = [...silences]
        .filter(s => s.endSec <= run.startSec + 1e-9)
        .sort((a, b) => b.endSec - a.endSec)[0];

      for (let i = 1; i < committed.length; i++) {
        const committedValue = committed[i]!.startTime;
        if (!(committedValue > run.startSec + 1e-9 && committedValue < run.endSec - 1e-9)) continue;

        let decline: Decline = 'FIRES';
        if (!prevToken) decline = 'no-prev-token';
        else if (!(gapEndSec - gapStartSec > 0)) decline = 'empty-gap';
        else if (h7Blocked) decline = 'h7-corrected-in-run';
        else if (Math.abs(correctedValue - committedValue) <= R12_MIN_CORRECTION_SEC) decline = 'below-min-correction';

        rows.push({
          segmentIndex: i,
          tag: tagOf(committed[i]!),
          runIndex: ri,
          runStartSec: run.startSec,
          runEndSec: run.endSec,
          runTokenLo: run.tokenLo,
          runTokenHi: run.tokenHi,
          prevTokenText: prevToken?.text ?? null,
          prevTokenEndSec: prevToken?.endSec ?? null,
          gapStartSec: prevToken ? gapStartSec : null,
          gapEndSec,
          gapWidth: prevToken ? gapEndSec - gapStartSec : null,
          leadingSilence: leadingSilence ? { startSec: leadingSilence.startSec, endSec: leadingSilence.endSec, mid: (leadingSilence.startSec + leadingSilence.endSec) / 2 } : null,
          overlapSilence: best ? { startSec: best.silence.startSec, endSec: best.silence.endSec, clampLo: best.lo, clampHi: best.hi } : null,
          clampedMidpoint: correctedValue,
          committedValue,
          correction: correctedValue - committedValue,
          absCorrection: Math.abs(correctedValue - committedValue),
          minCorrectionThreshold: R12_MIN_CORRECTION_SEC,
          h7Blocked,
          decline,
        });
      }
    }

    const declineCounts: Record<string, number> = {};
    for (const row of rows) declineCounts[row.decline as string] = (declineCounts[row.decline as string] ?? 0) + 1;

    writeFileSync(resolve(OUT_ROOT, 'step5b-r12-rootcause.json'), JSON.stringify({
      runId: r.runId,
      r5RunCount: runs.length,
      interiorBoundaryCount: rows.length,
      r12ActualFindings: r.r12.length,
      declineCounts,
      rows,
    }, null, 2));

    // eslint-disable-next-line no-console
    console.log('[STEP 5b]', JSON.stringify({
      r5Runs: runs.length, interiorBoundaries: rows.length,
      r12Fired: r.r12.length, declineCounts,
    }, null, 2));
    for (const row of rows) {
      // eslint-disable-next-line no-console
      console.log(`  seg ${String(row.segmentIndex).padStart(3)} ${String(row.tag).padEnd(24)} run[${row.runStartSec},${row.runEndSec}] committed=${row.committedValue} clampedMid=${(row.clampedMidpoint as number).toFixed(4)} |corr|=${(row.absCorrection as number).toFixed(4)} -> ${row.decline}`);
    }

    expect(rows.length).toBeGreaterThan(0);
  }, 900_000);
});
