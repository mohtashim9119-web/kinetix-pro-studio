/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// ---------------------------------------------------------------------------
// WS1 Session T — STEP 0 AND STEP 1 MEASUREMENT.
//
// Step 0: print `266_forty_one_burden`'s POST-R-AP committed value. Session S
// shipped R-AP and predicted 788.65; nothing printed the value the production
// path actually commits. This does.
//
// Step 1: the blast radius of dropping R.12's clamp, computed BEFORE the
// production edit, against the same live-fidelity bundle the app runs on. For
// every R.12 finding it reports the shipped (clamped) value, the unclamped
// value, and whether the unclamped value would be rejected by R.12's own H7
// atomic-run guard as it stands.
//
// GATED (`WS1_SESSION_T_MEASURE=1`) per the repo rule that generators never
// run in the default sweep. Reads only; changes no production code.
// ---------------------------------------------------------------------------

import { describe, it } from 'vitest';
import { CORPORA, runProductionPath, tagOf } from './ws1-session-p-pipeline.js';
import { acousticRunExtent } from '../src/services/faRunPlacementGate';
import { normalize } from '../src/services/whisperService';
import type { TranscriptToken } from '../src/types';

const MEASURE = process.env.WS1_SESSION_T_MEASURE === '1';
const f3 = (n: number): string => n.toFixed(3);

const isSubstantive = (t: TranscriptToken | undefined): boolean =>
  t !== undefined && normalize(t.text).length > 0;

describe.runIf(MEASURE)('WS1 Session T — measurement', () => {
  it('Step 0 + Step 1', async () => {
    for (const key of ['v6', '173', 'spanish'] as const) {
      const run = await runProductionPath(CORPORA[key]!);
      console.log(`\n================ ${key}  (runId ${run.runId}) ================`);
      console.log(`fired: ${JSON.stringify(run.fired)}  kept=${run.kept} skipped=${run.skipped}`);

      if (key === 'v6') {
        // ---- STEP 0 ----
        const l7 = run.committed.find(s => tagOf(s) === '266_forty_one_burden');
        console.log(`\n--- STEP 0: 266_forty_one_burden ---`);
        console.log(`  committed startTime = ${l7 ? l7.startTime.toFixed(5) : '(ABSENT)'}`);
        const pre = run.preRuleSegments.find(s => tagOf(s) === '266_forty_one_burden');
        console.log(`  pre-rule origin     = ${pre ? pre.startTime.toFixed(5) : '(ABSENT)'}`);
        console.log(`  r11 excluded rows   = ${JSON.stringify(run.r11Excluded.map(e => e.reason ?? e))}`);
        const r12row = run.r12.find(x => x.segmentTag === '266_forty_one_burden');
        console.log(`  R.12 row present    = ${r12row ? `yes -> ${r12row.correctedValue.toFixed(5)} (${r12row.placement})` : 'no'}`);
      }

      // ---- STEP 1: clamp blast radius ----
      console.log(`\n--- STEP 1: R.12 clamp blast radius (${run.r12.length} findings) ---`);
      const extents = run.r5runs.map(r => acousticRunExtent(r, run.whisperTokens));
      for (const fnd of run.r12) {
        const bs = fnd.backingSilence;
        const unclamped = bs ? (bs.startSec + bs.endSec) / 2 : undefined;
        const h7 = unclamped !== undefined
          ? extents.some(u => unclamped > u.startSec + 1e-9 && unclamped < u.endSec - 1e-9)
          : false;
        console.log(
          `  ${String(fnd.segmentTag).padEnd(26)} run=${fnd.runIndex}` +
          ` gap=[${f3(fnd.gapStartSec)}, ${f3(fnd.gapEndSec)}]` +
          ` sil=${bs ? `[${f3(bs.startSec)}, ${f3(bs.endSec)}]` : '(none)'}` +
          ` path=${fnd.placement}` +
          ` clamped=${f3(fnd.correctedValue)}` +
          ` UNCLAMPED=${unclamped !== undefined ? f3(unclamped) : '(n/a — fallback)'}` +
          ` H7rejects=${h7}`,
        );
      }

      // ---- run extents, and where Whisper's onset sits vs the silence ----
      console.log(`\n--- run extents (acoustic, Whisper-derived) ---`);
      run.r5runs.forEach((r, i) => {
        const e = extents[i]!;
        // The silence (if any) containing the Whisper-derived onset.
        const containing = run.silences.find(
          s => e.startSec > s.startSec - 1e-9 && e.startSec < s.endSec + 1e-9,
        );
        // Substantive token indices for provenance.
        let lo = r.tokenLo;
        while (lo <= r.tokenHi && !isSubstantive(run.whisperTokens[lo])) lo++;
        console.log(
          `  run ${i}: raw=[${f3(r.startSec)}, ${f3(r.endSec)}]` +
          ` acoustic=[${f3(e.startSec)}, ${f3(e.endSec)}]` +
          ` onsetTok=${lo} "${run.whisperTokens[lo]?.text?.trim().slice(0, 22)}"` +
          ` onsetInSilence=${containing ? `[${f3(containing.startSec)}, ${f3(containing.endSec)}] -> end ${f3(containing.endSec)}` : 'NO'}`,
        );
      });
    }
  }, 600_000);
});

// ---------------------------------------------------------------------------
// STEP 1b — SIMULATION of the two proposed changes, computed against the same
// live bundle BEFORE any production edit. Prints, per R.12 row, the value the
// pipeline would commit under:
//    (1) corrected acoustic onset  — a run's onset may not lie at or before
//        the end of the measured pause separating it from preceding speech;
//    (2) the clamp dropped         — the value is the WHOLE silence's midpoint.
// ---------------------------------------------------------------------------
describe.runIf(MEASURE)('WS1 Session T — Step 1b simulation', () => {
  it('predicts the committed value under both changes', async () => {
    const run = await runProductionPath(CORPORA['v6']!);
    const toks = run.whisperTokens;
    const sil = run.silences;

    /** The proposed predicate, standalone. */
    const correctedOnset = (rawOnset: number, prevWordEnd: number | undefined): { v: number; via: string } => {
      if (prevWordEnd === undefined) return { v: rawOnset, via: 'no-prev-token' };
      let first: { startSec: number; endSec: number } | undefined;
      for (const s of sil) {
        if (s.startSec < prevWordEnd - 1e-9) continue;
        if (first === undefined || s.startSec < first.startSec) first = s;
      }
      if (first && first.endSec > rawOnset + 1e-9) return { v: first.endSec, via: `pause[${first.startSec.toFixed(3)},${first.endSec.toFixed(3)}]` };
      return { v: rawOnset, via: 'raw-onset-kept' };
    };

    const isSub = (t: TranscriptToken | undefined): boolean => t !== undefined && normalize(t.text).length > 0;

    console.log('\n=== STEP 1b: simulated post-change R.12 table (v6) ===');
    console.log('tag                        prevEnd    rawOnset  newOnset  via                      gap                    silence                 SHIPPED   NEW       H7ok');
    run.r5runs.forEach((r, ri) => {
      let lo = r.tokenLo;
      while (lo <= r.tokenHi && !isSub(toks[lo])) lo++;
      let hi = r.tokenHi;
      while (hi >= r.tokenLo && !isSub(toks[hi])) hi--;
      const rawOnset = toks[lo]?.startSec ?? r.startSec;
      const rawEnd = toks[hi]?.endSec ?? r.endSec;
      let pi = r.tokenLo - 1;
      while (pi >= 0 && !isSub(toks[pi])) pi--;
      const prevEnd = toks[pi]?.endSec;
      const co = correctedOnset(rawOnset, prevEnd);
      console.log(`  run ${ri}: prevEnd=${prevEnd?.toFixed(3) ?? '(none)'} raw=[${rawOnset.toFixed(3)}, ${rawEnd.toFixed(3)}] -> newOnset=${co.v.toFixed(3)} via ${co.via}`);
    });

    // Now re-derive R.12's whole table under both changes.
    const newExtents = run.r5runs.map(r => {
      let lo = r.tokenLo; while (lo <= r.tokenHi && !isSub(toks[lo])) lo++;
      let hi = r.tokenHi; while (hi >= r.tokenLo && !isSub(toks[hi])) hi--;
      const rawOnset = toks[lo]?.startSec ?? r.startSec;
      const endSec = toks[hi]?.endSec ?? r.endSec;
      let pi = r.tokenLo - 1; while (pi >= 0 && !isSub(toks[pi])) pi--;
      return { startSec: correctedOnset(rawOnset, toks[pi]?.endSec).v, endSec };
    });

    console.log('\n=== simulated committed values ===');
    run.r5runs.forEach((r, ri) => {
      let pi = r.tokenLo - 1; while (pi >= 0 && !isSub(toks[pi])) pi--;
      const prev = toks[pi];
      if (!prev) { console.log(`  run ${ri}: no preceding substantive token — R.12 declines (unchanged)`); return; }
      const gapStart = prev.endSec;
      const gapEnd = newExtents[ri]!.startSec;
      if (!(gapEnd - gapStart > 0)) { console.log(`  run ${ri}: empty gap — declines`); return; }
      let best: { s: { startSec: number; endSec: number }; ov: number } | undefined;
      for (const s of sil) {
        const lo2 = Math.max(s.startSec, gapStart), hi2 = Math.min(s.endSec, gapEnd);
        if (!(hi2 - lo2 > 1e-9)) continue;
        if (best === undefined || hi2 - lo2 > best.ov + 1e-12) best = { s, ov: hi2 - lo2 };
      }
      const value = best ? (best.s.startSec + best.s.endSec) / 2 : gapEnd;
      const h7 = newExtents.some(u => value > u.startSec + 1e-9 && value < u.endSec - 1e-9);
      // which committed segment is inside this run today?
      const carriers = run.preRuleSegments
        .map((s, i) => ({ s, i }))
        .filter(({ s, i }) => i > 0 && s.startTime > newExtents[ri]!.startSec + 1e-9 && s.startTime < newExtents[ri]!.endSec - 1e-9);
      console.log(
        `  run ${ri}: gap=[${gapStart.toFixed(3)}, ${gapEnd.toFixed(3)}]` +
        ` sil=${best ? `[${best.s.startSec.toFixed(3)}, ${best.s.endSec.toFixed(3)}]` : '(none->fallback)'}` +
        ` NEWVALUE=${value.toFixed(3)} H7rejects=${h7}` +
        ` origin-carriers=${JSON.stringify(carriers.map(c => `${tagOf(c.s)}@${c.s.startTime.toFixed(2)}`))}`,
      );
    });
  }, 600_000);
});
