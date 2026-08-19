/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// ---------------------------------------------------------------------------
// WS1 Session R — THE NEXT CANDIDATE DISCRIMINATOR, MEASURED (Exit R1's
// "propose the next measurable discriminator", answered with numbers rather
// than with a suggestion).
//
// NO RULE IS BUILT HERE. Step 1 (`ws1-session-r-containment.test.ts`) failed
// its exit condition, which forbids designing a fix on containment. This file
// measures a DIFFERENT candidate so the next session inherits a tested
// proposal instead of another untested hypothesis — the same mistake Session Q
// and Session R have now each made once.
//
// WHAT STEP 1 ACTUALLY FOUND, and why it points here. Containment returned
// ZERO violations on all 446 boundaries because the disputed words are
// attributed to the INCOMING segment on every one of the 9 open rows, and the
// boundary sits before them — which is exactly what containment demands. The
// defect is therefore NOT boundary placement given the attribution; it is the
// ATTRIBUTION. Containment tests the boundary against the attribution, so when
// the attribution is the thing that is wrong, containment is blind BY
// CONSTRUCTION. That is a structural blindness, not a tuning failure, and no
// threshold on containment could have rescued it.
//
// THE CANDIDATE. Every disputed span dumped in Step 1 is a leading run of FA
// words at the INCOMING segment's head carrying essentially no acoustic
// support — 1e-8 to 1e-3 — with the ear-correct boundary sitting at or past
// the end of that run. That is the same evidentiary shape R.10 already uses
// ("was this text spoken at all?", `R10_MAX_WORD_CONF` = 5e-4, DERIVED from an
// 850x measured gap, not fitted), applied at a segment head rather than over a
// whole segment. So the signal measured here is:
//
//   leadingGarbageRun = the incoming segment's leading run of FA words whose
//                       confidence is below R10_MAX_WORD_CONF
//
// reported as a word COUNT and as the time from the boundary to the end of the
// run. No new constant is introduced; the floor is R.10's existing derived one,
// reused so this measurement cannot be accused of being fitted to the 9 rows.
//
// THE KNOWN RISK, PRE-REGISTERED so it cannot be quietly dropped: two of the
// four ear-verified-CORRECT pins (`192_scout_listening`, `226_four_scouts`)
// also carry low-confidence words at both edges (Step 1's audit block). If
// this signal fires on them it is a false positive on ground truth, and the
// candidate is dead in the same way containment is. That is the measurement's
// whole point — it is reported either way, and `separates` records the verdict.
// ---------------------------------------------------------------------------

import { describe, it, expect } from 'vitest';
import { writeFileSync, mkdirSync } from 'fs';
import { resolve } from 'path';
import { computeBoundarySearchWindow, boundaryUsedFallback } from '../src/services/snapBoundaries';
import { R10_MAX_WORD_CONF } from '../src/services/syncConstants';
import { CORPORA, OUT_ROOT, runProductionPath, tagOf } from './ws1-session-p-pipeline.js';

const MEASURE = process.env.WS1_SESSION_R_MEASURE === '1';

const CLASS_A = ['152_frozen_brush_mice', '214_solitary_fire', '231_slowing_pace', '447_scout_facing_dark'];
const CLASS_B_COMMITTED = [167.03, 494.43, 856.09, 1266.21, 1273.14];
const EAR_PASS_PINS = ['192_scout_listening', '226_four_scouts', '232_sudden_halt', '233_firelight_speech'];
const R12_CORRECTED = [
  '042_eleven_years', '125_night_circle', '176_twenty_six_scout', '224_thirty_three',
  '307_forty_nine_years', '340_fifty_eight', '383_sixty_four',
];

describe.skipIf(!MEASURE)('WS1 Session R — leading-garbage-run candidate, measured not shipped', () => {
  it('measures the incoming segment head-run of sub-R10 words on all 446 boundaries', async () => {
    const spec = CORPORA.v6!;
    const r = await runProductionPath(spec);
    mkdirSync(OUT_ROOT, { recursive: true });

    const usable = r.usableFaTokens;
    const aligns = r.keptAlignments;
    const ruleTouched = new Set<string>([
      ...r.r11.map(f => f.segmentId), ...r.r12.map(f => f.segmentId), ...r.r13.map(f => f.segmentId),
    ]);

    interface GarbageRow {
      boundaryIndex: number; tag: string; committed: number; label: string;
      usedFallback: boolean | null; ruleTouched: boolean;
      runLen: number; runEnd: number | null; runSpanSec: number | null;
      incomingSpanLen: number | null;
    }

    const rows: GarbageRow[] = [];
    for (let i = 1; i < r.committed.length; i++) {
      const seg = r.committed[i]!;
      const boundary = seg.startTime;
      const ca = aligns[i - 1]; const na = aligns[i];
      const tag = tagOf(seg);

      const label = CLASS_A.includes(tag) ? 'class-A'
        : CLASS_B_COMMITTED.some(c => Math.abs(c - boundary) <= 0.011) ? 'class-B'
        : EAR_PASS_PINS.includes(tag) ? 'ear-pass-pin'
        : R12_CORRECTED.includes(tag) ? 'r12-corrected'
        : 'control';

      let usedFallback: boolean | null = null;
      if (ca && na && ca.firstTokenIdx >= 0 && ca.lastTokenIdx >= 0 && na.firstTokenIdx >= 0 && na.lastTokenIdx >= 0) {
        const w = computeBoundarySearchWindow(
          usable[ca.lastTokenIdx]!.endSec, usable[na.firstTokenIdx]!.startSec,
          usable[ca.firstTokenIdx]!.startSec, usable[na.lastTokenIdx]!.endSec,
        );
        usedFallback = boundaryUsedFallback(
          usable, r.silences, w, ca.firstTokenIdx, ca.lastTokenIdx, na.firstTokenIdx, na.lastTokenIdx,
        );
      }

      // The leading run itself. A word with no numeric confidence is UNUSABLE
      // EVIDENCE and stops the run — never counted as zero, the same rule
      // R.10/R.11 already follow, so a harness bug cannot manufacture a run.
      let runLen = 0; let runEnd: number | null = null;
      if (na && na.firstTokenIdx >= 0 && na.lastTokenIdx >= 0) {
        for (let j = na.firstTokenIdx; j <= na.lastTokenIdx; j++) {
          const t = usable[j];
          if (!t) break;
          const c = typeof t.confidence === 'number' && Number.isFinite(t.confidence) ? t.confidence : undefined;
          if (c === undefined || c >= R10_MAX_WORD_CONF) break;
          runLen++; runEnd = t.endSec;
        }
      }

      rows.push({
        boundaryIndex: i, tag, committed: boundary, label, usedFallback,
        ruleTouched: ruleTouched.has(seg.id),
        runLen, runEnd, runSpanSec: runEnd === null ? null : runEnd - boundary,
        incomingSpanLen: na && na.firstTokenIdx >= 0 ? na.lastTokenIdx - na.firstTokenIdx + 1 : null,
      });
    }

    const by = (l: string): GarbageRow[] => rows.filter(x => x.label === l);
    const controls = rows.filter(x => x.label === 'control' && !x.ruleTouched);
    const controlsSnapped = controls.filter(x => x.usedFallback === false);

    const fires = (x: GarbageRow): boolean => x.runLen > 0;
    const stat = (set: GarbageRow[]): Record<string, unknown> => {
      const lens = set.map(x => x.runLen).sort((a, b) => a - b);
      return {
        n: set.length, firing: set.filter(fires).length,
        runLenMin: lens[0] ?? null, runLenMedian: lens[Math.floor(lens.length / 2)] ?? null,
        runLenMax: lens[lens.length - 1] ?? null,
      };
    };

    const classA = by('class-A'); const classB = by('class-B');
    const defects = [...classA, ...classB];
    const pins = by('ear-pass-pin');

    const detail = (x: GarbageRow): Record<string, unknown> => ({
      tag: x.tag, committed: x.committed, runLen: x.runLen, runEnd: x.runEnd,
      runSpanSec: x.runSpanSec, incomingSpanLen: x.incomingSpanLen, usedFallback: x.usedFallback,
    });

    const separates =
      defects.every(fires) && !pins.some(fires) && controlsSnapped.filter(fires).length === 0;

    const out = {
      runId: r.runId,
      floor: R10_MAX_WORD_CONF,
      floorProvenance: 'R10_MAX_WORD_CONF — existing DERIVED constant (850x measured gap), reused, not fitted here',
      boundaries: rows.length,
      classA: classA.map(detail),
      classB: classB.map(detail),
      earPassPins: pins.map(detail),
      r12Corrected: by('r12-corrected').map(detail),
      stats: {
        classA: stat(classA), classB: stat(classB),
        earPassPins: stat(pins), r12Corrected: stat(by('r12-corrected')),
        controlsAll: stat(controls), controlsSnapped: stat(controlsSnapped),
        controlsFallback: stat(controls.filter(x => x.usedFallback === true)),
      },
      defectsFiring: defects.filter(fires).length,
      defectsTotal: defects.length,
      pinsFiring: pins.filter(fires).length,
      controlSnappedFiring: controlsSnapped.filter(fires).length,
      controlSnappedFiringSample: controlsSnapped.filter(fires).slice(0, 30).map(detail),
      separates,
      verdict: separates
        ? 'CANDIDATE SURVIVES as a DETECTOR on this corpus — still needs a correction rule, a hold-out and a blast-radius prediction before any rule is designed'
        : 'CANDIDATE DOES NOT SEPARATE as specified — see per-label firing counts before pursuing it',
    };

    writeFileSync(resolve(OUT_ROOT, 'stepR1b-leading-garbage.json'), JSON.stringify({ ...out, rows }, null, 2));
    // eslint-disable-next-line no-console
    console.log('[STEP R1b]', JSON.stringify(out, null, 2));

    expect(rows.length).toBe(446);
  }, 900_000);
});
