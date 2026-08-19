/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// ---------------------------------------------------------------------------
// WS1 Session R — STEP 1. DOES WORD CONTAINMENT DISCRIMINATE?
//
// WHY THIS QUESTION, AND WHY IT IS NOT THE PREVIOUS ONE. Session Q measured
// `d = |committed - nearest silence midpoint|` over all 447 v6 boundaries and
// found the 403 SNAPPED, rule-untouched controls sit at d <= 2.27e-13 —
// exactly zero. Two of the four Class A rows (214, 447) sit at d = 0 as well.
// So the defect is NOT "the boundary is not at a silence"; it is "the boundary
// is at the midpoint of the WRONG silence." Silence geometry cannot separate
// those two statements, and Session Q's own negative result
// (`ws1-session-q-detector-validate.test.ts`) is the record of that.
//
// THE NEW SIGNAL, and why it is structurally capable of being different.
// `snapCoveredBoundaries` picks the silence whose CENTRE is closest to the
// pair's spoken midpoint among the silences merely OVERLAPPING its search
// window, and then — deliberately, documented in that file — never clamps the
// result to the pair's own spoken edges ("the silence is acoustic ground truth
// and outranks Whisper's ~300ms-error word timestamps"). The search window's
// outer bounds are `currFirstSpokenStart` / `nextLastSpokenEnd`, which are the
// segments' OWN far edges, not the adjacent pair `[lastSpokenEnd,
// nextSpokenStart]`. A chosen silence's midpoint can therefore legally land
// BEFORE the outgoing segment's last word has finished, or AFTER the incoming
// segment's first word has begun. Word containment asks exactly that:
//
//   lastWordEnd    = FA end   of the OUTGOING segment's final word
//   firstWordStart = FA start of the INCOMING segment's first word
//   violationTail  = lastWordEnd  > boundary   (boundary EARLY — it cuts the
//                                               outgoing segment's last word)
//   violationHead  = firstWordStart < boundary (boundary LATE — it swallows
//                                               the incoming segment's first)
//
// This is NOT a restatement of the silence-distance signal: containment is a
// TOKEN-INDEX fact (which words the Hirschberg pass gave each segment) tested
// against one timestamp, whereas `d` was a timestamp-to-timestamp distance.
// The two can disagree, and the whole point of Step 1 is to find out whether
// they do on the rows that matter.
//
// EXIT CONDITION, pre-registered. If containment does not separate the 9 open
// defect rows from the 403 healthy controls, this file's distribution IS the
// deliverable and no fix is designed on it. That is asserted below rather than
// left to prose: `separates` records the verdict either way.
//
// CONFIDENCE FILTER. FA per-word confidence varies by orders of magnitude, and
// a garbage low-confidence word at a segment edge could manufacture a
// violation out of nothing. The primary arm therefore selects each segment's
// final/first word from words at or above the CORPUS MEDIAN confidence,
// walking inward from the edge. The unfiltered arm is measured alongside it
// and the row-level delta reported, so the filter's own influence is visible
// rather than assumed.
//
// MEASUREMENT ONLY — this file builds no detector and ships no correction.
// ---------------------------------------------------------------------------

import { describe, it, expect } from 'vitest';
import { writeFileSync, mkdirSync } from 'fs';
import { resolve } from 'path';
import { computeBoundarySearchWindow, boundaryUsedFallback } from '../src/services/snapBoundaries';
import { CORPORA, OUT_ROOT, runProductionPath, tagOf } from './ws1-session-p-pipeline.js';
import type { TranscriptToken } from '../src/types';

const MEASURE = process.env.WS1_SESSION_R_MEASURE === '1';

/** The 4 Class A rows (committed value wrong, boundary SNAPPED to a real
 *  silence). Ear-correct targets are Session P's ear pass, re-stated in the
 *  session brief. */
const CLASS_A: Array<{ tag: string; ear: number }> = [
  { tag: '152_frozen_brush_mice', ear: 450.99 },
  { tag: '214_solitary_fire', ear: 630.09 },
  { tag: '231_slowing_pace', ear: 682.74 },
  { tag: '447_scout_facing_dark', ear: 1418.53 },
];

/** The 5 Class B rows, identified by their committed value (they live in the
 *  FALLBACK population and are named in the register by index pair). */
const CLASS_B: Array<{ label: string; committed: number; ear: number }> = [
  { label: '055/056_dropping_torch', committed: 167.03, ear: 167.70 },
  { label: '166/167_smell_of_butchery', committed: 494.43, ear: 494.75 },
  { label: '285/286_fact_to_act', committed: 856.09, ear: 856.52 },
  { label: '399/400_endless_dark', committed: 1266.21, ear: 1266.66 },
  { label: '402/403_vigilant_embers', committed: 1273.14, ear: 1273.55 },
];

/** The 4 rows the owner's ear scored CORRECT at their current value. These
 *  must NOT violate, or the signal is flagging correct boundaries. */
const EAR_PASS_PINS = ['192_scout_listening', '226_four_scouts', '232_sudden_halt', '233_firelight_speech'];

/** R.12's 7 post-fix corrected rows (`ws1-session-q-production-pins.test.ts`).
 *  Also must NOT violate — they are corrected, not defective. */
const R12_CORRECTED = [
  '042_eleven_years', '125_night_circle', '176_twenty_six_scout', '224_thirty_three',
  '307_forty_nine_years', '340_fifty_eight', '383_sixty_four',
];

const near = (a: number, b: number, tol = 0.011): boolean => Math.abs(a - b) <= tol;

/**
 * The outgoing segment's final word and the incoming segment's first word,
 * selected by walking INWARD from each span's own edge until a word at or above
 * `minConf` is found. Returns `undefined` when the whole span is below the
 * floor — reported as `noUsableWord` rather than silently falling back to a
 * low-confidence word, so the filter cannot manufacture a result either way.
 */
function edgeWord(
  tokens: readonly TranscriptToken[],
  firstIdx: number,
  lastIdx: number,
  side: 'last' | 'first',
  minConf: number,
): { idx: number; startSec: number; endSec: number; confidence: number } | undefined {
  if (firstIdx < 0 || lastIdx < 0 || lastIdx < firstIdx) return undefined;
  const step = side === 'last' ? -1 : 1;
  const from = side === 'last' ? lastIdx : firstIdx;
  const to = side === 'last' ? firstIdx : lastIdx;
  for (let j = from; side === 'last' ? j >= to : j <= to; j += step) {
    const t = tokens[j];
    if (!t) continue;
    const c = typeof t.confidence === 'number' && Number.isFinite(t.confidence) ? t.confidence : undefined;
    if (c === undefined || c < minConf) continue;
    return { idx: j, startSec: t.startSec, endSec: t.endSec, confidence: c };
  }
  return undefined;
}

interface Row {
  boundaryIndex: number;
  tag: string;
  committed: number;
  label: string;
  earCorrect: number | null;
  usedFallback: boolean | null;
  ruleTouched: boolean;
  /** Primary (confidence-filtered) arm. */
  lastWordEnd: number | null;
  firstWordStart: number | null;
  overhangTail: number | null;   // lastWordEnd - boundary; > 0 means boundary EARLY
  overhangHead: number | null;   // boundary - firstWordStart; > 0 means boundary LATE
  violationTail: boolean;
  violationHead: boolean;
  violation: boolean;
  noUsableWord: boolean;
  /** Unfiltered arm, for the filter-sensitivity delta. */
  violationUnfiltered: boolean;
  overhangTailUnfiltered: number | null;
  overhangHeadUnfiltered: number | null;
}

describe.skipIf(!MEASURE)('WS1 Session R — word containment over every committed boundary (Step 1)', () => {
  it('computes containment for all 447 boundaries and reports separation-or-not', async () => {
    const spec = CORPORA.v6!;
    const r = await runProductionPath(spec);
    mkdirSync(OUT_ROOT, { recursive: true });

    const usable = r.usableFaTokens;
    const aligns = r.keptAlignments;

    // Corpus median FA confidence, over the tokens actually in play.
    const confs = usable
      .map(t => t.confidence)
      .filter((c): c is number => typeof c === 'number' && Number.isFinite(c))
      .sort((a, b) => a - b);
    const medianConf = confs.length === 0 ? 0 : confs[Math.floor(confs.length / 2)]!;

    // Rows R.11/R.12/R.13 moved this run — excluded from the healthy control
    // population for the same structural reason Session Q excluded them.
    const ruleTouched = new Set<string>([
      ...r.r11.map(f => f.segmentId), ...r.r12.map(f => f.segmentId), ...r.r13.map(f => f.segmentId),
    ]);

    const rows: Row[] = [];
    for (let i = 1; i < r.committed.length; i++) {
      const seg = r.committed[i]!;
      const boundary = seg.startTime;
      const ca = aligns[i - 1]; const na = aligns[i];

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

      const tag = tagOf(seg);
      const a = CLASS_A.find(x => x.tag === tag);
      const b = CLASS_B.find(x => near(x.committed, boundary));
      const label = a ? 'class-A'
        : b ? 'class-B'
        : EAR_PASS_PINS.includes(tag) ? 'ear-pass-pin'
        : R12_CORRECTED.includes(tag) ? 'r12-corrected'
        : 'control';

      const measure = (minConf: number): {
        lastWordEnd: number | null; firstWordStart: number | null;
        tail: number | null; head: number | null; missing: boolean;
      } => {
        const lw = ca ? edgeWord(usable, ca.firstTokenIdx, ca.lastTokenIdx, 'last', minConf) : undefined;
        const fw = na ? edgeWord(usable, na.firstTokenIdx, na.lastTokenIdx, 'first', minConf) : undefined;
        return {
          lastWordEnd: lw?.endSec ?? null,
          firstWordStart: fw?.startSec ?? null,
          tail: lw ? lw.endSec - boundary : null,
          head: fw ? boundary - fw.startSec : null,
          missing: !lw || !fw,
        };
      };

      const p = measure(medianConf);
      const u = measure(Number.NEGATIVE_INFINITY);

      const violationTail = p.tail !== null && p.tail > 0;
      const violationHead = p.head !== null && p.head > 0;

      rows.push({
        boundaryIndex: i, tag, committed: boundary, label,
        earCorrect: a?.ear ?? b?.ear ?? null,
        usedFallback, ruleTouched: ruleTouched.has(seg.id),
        lastWordEnd: p.lastWordEnd, firstWordStart: p.firstWordStart,
        overhangTail: p.tail, overhangHead: p.head,
        violationTail, violationHead, violation: violationTail || violationHead,
        noUsableWord: p.missing,
        violationUnfiltered: (u.tail !== null && u.tail > 0) || (u.head !== null && u.head > 0),
        overhangTailUnfiltered: u.tail, overhangHeadUnfiltered: u.head,
      });
    }

    // ---- (a) violation count + overhang distribution --------------------
    const violations = rows.filter(x => x.violation);
    const overhangs = violations
      .map(x => Math.max(x.overhangTail ?? -Infinity, x.overhangHead ?? -Infinity))
      .filter(v => Number.isFinite(v)).sort((p2, q2) => p2 - q2);
    const quant = (f: number): number | null =>
      overhangs.length === 0 ? null : overhangs[Math.min(overhangs.length - 1, Math.floor(f * (overhangs.length - 1)))]!;

    // ---- (d) control population + separation margins ---------------------
    // The control population is Session Q's own: SNAPPED (not fallback) and
    // untouched by any rule this run. Class B lives in the FALLBACK population,
    // so it is scored against its own arm too.
    const controls = rows.filter(x => x.label === 'control' && x.usedFallback === false && !x.ruleTouched);
    const controlsFallback = rows.filter(x => x.label === 'control' && x.usedFallback === true && !x.ruleTouched);
    const controlViolations = controls.filter(x => x.violation);
    const controlFallbackViolations = controlsFallback.filter(x => x.violation);

    const byLabel = (l: string): Row[] => rows.filter(x => x.label === l);
    const detail = (x: Row): Record<string, unknown> => ({
      tag: x.tag, committed: x.committed, ear: x.earCorrect, usedFallback: x.usedFallback,
      lastWordEnd: x.lastWordEnd, firstWordStart: x.firstWordStart,
      overhangTail: x.overhangTail, overhangHead: x.overhangHead,
      violationTail: x.violationTail, violationHead: x.violationHead, violation: x.violation,
      violationUnfiltered: x.violationUnfiltered, noUsableWord: x.noUsableWord,
    });

    const classA = byLabel('class-A'); const classB = byLabel('class-B');
    const defects = [...classA, ...classB];
    const defectsViolating = defects.filter(x => x.violation);
    const pins = byLabel('ear-pass-pin'); const r12 = byLabel('r12-corrected');
    const pinsViolating = pins.filter(x => x.violation);
    const r12Violating = r12.filter(x => x.violation);

    // Separation margin, BOTH sides: the smallest defect overhang against the
    // largest control overhang. A margin only means something if the control
    // side has no violations at all; when it does, the "margin" is reported as
    // null and `separates` is false.
    const defectOverhangs = defectsViolating
      .map(x => Math.max(x.overhangTail ?? -Infinity, x.overhangHead ?? -Infinity))
      .filter(v => Number.isFinite(v));
    const controlMaxOverhang = controls.reduce((m, x) => {
      const v = Math.max(x.overhangTail ?? -Infinity, x.overhangHead ?? -Infinity);
      return Number.isFinite(v) && v > m ? v : m;
    }, -Infinity);

    const separates =
      defectsViolating.length === defects.length &&
      controlViolations.length === 0 &&
      pinsViolating.length === 0 &&
      r12Violating.length === 0;

    const filterChangedRows = rows.filter(x => x.violation !== x.violationUnfiltered);

    // AUDIT TRAIL — the actual words at each labelled row's two edges, with
    // their indices and confidences. A null `lastWordEnd`/`firstWordStart` in
    // the primary arm must be explainable as "the whole span is below the
    // median", not as a broken attribution, and a reader must be able to check
    // that the words named here really are the segment's own first/last.
    const audit = rows.filter(x => x.label !== 'control').map(x => {
      const ca = aligns[x.boundaryIndex - 1]; const na = aligns[x.boundaryIndex];
      const show = (idx: number | undefined): unknown => {
        if (idx === undefined || idx < 0) return null;
        const t = usable[idx];
        return t ? { idx, text: t.text, startSec: t.startSec, endSec: t.endSec, confidence: t.confidence } : null;
      };
      return {
        tag: x.tag, label: x.label, committed: x.committed,
        outgoingSpan: ca ? { first: ca.firstTokenIdx, last: ca.lastTokenIdx, matched: ca.matched } : null,
        incomingSpan: na ? { first: na.firstTokenIdx, last: na.lastTokenIdx, matched: na.matched } : null,
        outgoingLastWordRaw: show(ca?.lastTokenIdx),
        incomingFirstWordRaw: show(na?.firstTokenIdx),
      };
    });

    // WHY THE ZERO HAPPENS — the disputed span, dumped. For each row with an
    // ear-correct target, every FA word between the committed value and the
    // ear value, with the span each word was ATTRIBUTED to. Containment tests
    // the boundary against the attribution; if the attribution itself is what
    // is wrong, containment is structurally blind and must return zero. This
    // block is the evidence for which of those two is happening.
    const disputed = rows.filter(x => x.earCorrect !== null).map(x => {
      const lo = Math.min(x.committed, x.earCorrect!); const hi = Math.max(x.committed, x.earCorrect!);
      const ca = aligns[x.boundaryIndex - 1]; const na = aligns[x.boundaryIndex];
      const inSpan: unknown[] = [];
      for (let j = 0; j < usable.length; j++) {
        const t = usable[j]!;
        if (t.endSec < lo - 1e-9 || t.startSec > hi + 1e-9) continue;
        inSpan.push({
          idx: j, text: t.text, startSec: t.startSec, endSec: t.endSec, confidence: t.confidence,
          attributedTo: ca && j >= ca.firstTokenIdx && j <= ca.lastTokenIdx ? 'outgoing'
            : na && j >= na.firstTokenIdx && j <= na.lastTokenIdx ? 'incoming' : 'neither',
        });
      }
      return {
        tag: x.tag, label: x.label, committed: x.committed, ear: x.earCorrect,
        earIsLater: x.earCorrect! > x.committed,
        disputedWidthSec: hi - lo, wordsInDisputedSpan: inSpan.length, words: inSpan,
      };
    });

    const out = {
      runId: r.runId,
      boundaries: rows.length,
      disputed,
      committedCount: r.committed.length,
      keptAlignmentCount: aligns.length,
      indexParity: r.committed.length === aligns.length,
      skippedSegments: r.skipped,
      medianConfidence: medianConf,
      confidenceTokens: confs.length,
      confidenceQuantiles: confs.length === 0 ? null : {
        min: confs[0], p10: confs[Math.floor(0.10 * (confs.length - 1))],
        p25: confs[Math.floor(0.25 * (confs.length - 1))],
        p50: confs[Math.floor(0.50 * (confs.length - 1))],
        p75: confs[Math.floor(0.75 * (confs.length - 1))],
        max: confs[confs.length - 1],
      },
      unfilteredViolationCount: rows.filter(x => x.violationUnfiltered).length,
      audit,
      // (a)
      violationCount: violations.length,
      violationTailCount: rows.filter(x => x.violationTail).length,
      violationHeadCount: rows.filter(x => x.violationHead).length,
      overhangDistribution: overhangs.length === 0 ? null : {
        n: overhangs.length, min: overhangs[0], p25: quant(0.25), median: quant(0.50),
        p75: quant(0.75), p90: quant(0.90), max: overhangs[overhangs.length - 1],
      },
      // (b)
      classA: classA.map(detail),
      classB: classB.map(detail),
      defectsViolating: defectsViolating.length,
      defectsTotal: defects.length,
      // (c)
      earPassPins: pins.map(detail),
      earPassPinsViolating: pinsViolating.length,
      r12Corrected: r12.map(detail),
      r12CorrectedViolating: r12Violating.length,
      // (d)
      controlPopulation: {
        snapped: controls.length, snappedViolating: controlViolations.length,
        fallback: controlsFallback.length, fallbackViolating: controlFallbackViolations.length,
        snappedMaxOverhang: Number.isFinite(controlMaxOverhang) ? controlMaxOverhang : null,
        snappedViolatingSample: controlViolations.slice(0, 25).map(detail),
      },
      separationMargin: {
        smallestDefectOverhang: defectOverhangs.length ? Math.min(...defectOverhangs) : null,
        largestControlOverhang: Number.isFinite(controlMaxOverhang) ? controlMaxOverhang : null,
      },
      // confidence-filter sensitivity
      confidenceFilter: {
        rowsChangedByFilter: filterChangedRows.length,
        changed: filterChangedRows.slice(0, 40).map(detail),
        noUsableWordRows: rows.filter(x => x.noUsableWord).length,
      },
      separates,
      verdict: separates
        ? 'SEPARATES: every open defect row violates, and no control / pin / corrected row does — Step 2 may proceed'
        : 'DOES NOT SEPARATE CLEANLY — see counts; Exit R1 applies unless the failure is confined to a stated sub-population',
    };

    writeFileSync(resolve(OUT_ROOT, 'stepR1-word-containment.json'), JSON.stringify({ ...out, rows }, null, 2));
    // eslint-disable-next-line no-console
    console.log('[STEP R1]', JSON.stringify(out, null, 2));

    expect(rows.length).toBe(446);
  }, 900_000);
});
