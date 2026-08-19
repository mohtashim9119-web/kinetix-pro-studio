/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// ---------------------------------------------------------------------------
// WS1 Session Q — STEP 3. DOES SILENCE-MIDPOINT DISTANCE DISCRIMINATE?
//
// THE HYPOTHESIS UNDER TEST, stated so it can fail. Every ear-correct value
// recovered by this workstream has turned out to be the midpoint of a real
// detected silence. If that is a property of CORRECT boundaries rather than an
// artefact of how the corrections were built, then
//
//     d(t) = | t - midpoint of the silence nearest t |
//
// should be near zero on healthy committed boundaries and large on the nine
// known defects. This file measures d for ALL committed boundaries and reports
// the distribution, so the question is settled by separation-or-not rather
// than by the fact that the ear-correct values happen to be midpoints.
//
// This is a MEASUREMENT generator, not an assertion of the hypothesis. Exit Q1
// of the session brief is explicit: if d does not separate, the distribution is
// the deliverable and no detector gets built on it.
//
// "Nearest silence" is reported three ways so the answer cannot hide in the
// choice: the silence CONTAINING t (if any), the last one ENDING before t, and
// the first one STARTING after t.
// ---------------------------------------------------------------------------

import { describe, it, expect } from 'vitest';
import { writeFileSync, mkdirSync } from 'fs';
import { resolve } from 'path';
import { computeBoundarySearchWindow, boundaryUsedFallback } from '../src/services/snapBoundaries';
import { alignScenestoTranscript, distributeSegmentTimes } from '../src/services/whisperService';
import { applyAnchorBasedTiming } from '../src/services/syncEngine';
import { CORPORA, OUT_ROOT, runProductionPath, tagOf } from './ws1-session-p-pipeline.js';
import type { SilenceInterval } from '../src/services/silenceDetector';

const MEASURE = process.env.WS1_SESSION_Q_MEASURE === '1';

/** Session P's ear pass, as data. Committed value -> ear-correct value. */
const CLASS_A: Array<{ tag: string; committed: number; ear: number }> = [
  { tag: '152_frozen_brush_mice', committed: 449.20, ear: 450.99 },
  { tag: '214_solitary_fire', committed: 629.01, ear: 630.09 },
  { tag: '231_slowing_pace', committed: 681.63, ear: 682.74 },
  { tag: '447_scout_facing_dark', committed: 1417.12, ear: 1418.53 },
];
const CLASS_B: Array<{ committed: number; ear: number }> = [
  { committed: 167.03, ear: 167.70 },
  { committed: 494.43, ear: 494.75 },
  { committed: 856.09, ear: 856.52 },
  { committed: 1266.21, ear: 1266.66 },
  { committed: 1273.14, ear: 1273.55 },
];
/** The four already-fixed rows the ear scored CORRECT at their current value. */
const EAR_PASS_PINS = [571.07, 671.16, 684.09, 686.54];

interface Nearest {
  kind: 'containing' | 'previous' | 'next';
  startSec: number;
  endSec: number;
  mid: number;
  d: number;
}

export function nearestSilenceMidpoint(t: number, silences: readonly SilenceInterval[]): Nearest | undefined {
  const cands: Nearest[] = [];
  let containing: SilenceInterval | undefined;
  let prev: SilenceInterval | undefined;
  let next: SilenceInterval | undefined;
  for (const s of silences) {
    if (t >= s.startSec && t <= s.endSec) {
      if (!containing || s.endSec - s.startSec > containing.endSec - containing.startSec) containing = s;
    }
    if (s.endSec < t && (!prev || s.endSec > prev.endSec)) prev = s;
    if (s.startSec > t && (!next || s.startSec < next.startSec)) next = s;
  }
  const push = (s: SilenceInterval | undefined, kind: Nearest['kind']): void => {
    if (!s) return;
    const mid = (s.startSec + s.endSec) / 2;
    cands.push({ kind, startSec: s.startSec, endSec: s.endSec, mid, d: Math.abs(t - mid) });
  };
  push(containing, 'containing');
  push(prev, 'previous');
  push(next, 'next');
  if (cands.length === 0) return undefined;
  return cands.reduce((a, b) => (b.d < a.d ? b : a));
}

const near = (a: number, b: number, tol = 0.02): boolean => Math.abs(a - b) <= tol;

describe.skipIf(!MEASURE)('WS1 Session Q — silence-midpoint distance over every committed boundary (Step 3)', () => {
  it('computes d for all 447 committed boundaries and labels the known rows', async () => {
    const r = await runProductionPath(CORPORA.v6!);
    mkdirSync(OUT_ROOT, { recursive: true });

    // SECOND AXIS, carried alongside d because it costs nothing and is the
    // obvious fallback discriminator if d does not separate: did this pair have
    // ANY assignable silence candidate, or was `snapCoveredBoundaries` always
    // going to use the plain spoken-edge midpoint for it?
    const spec = CORPORA.v6!;
    const usable = r.usableFaTokens;
    const alignedSegments = applyAnchorBasedTiming(
      distributeSegmentTimes(
        r.anchorTimed,
        alignScenestoTranscript(r.anchorTimed, usable, r.silences, spec.audioDuration),
        'forced-alignment',
      ),
      spec.audioDuration,
    );
    const alignments = alignScenestoTranscript(alignedSegments, usable, r.silences, spec.audioDuration);
    const fallbackOfBoundary = new Map<number, boolean>();
    for (let i = 0; i + 1 < r.committed.length; i++) {
      const ca = alignments[i]; const na = alignments[i + 1];
      if (!ca || !na || ca.firstTokenIdx < 0 || ca.lastTokenIdx < 0 || na.firstTokenIdx < 0 || na.lastTokenIdx < 0) continue;
      const w = computeBoundarySearchWindow(
        usable[ca.lastTokenIdx]!.endSec, usable[na.firstTokenIdx]!.startSec,
        usable[ca.firstTokenIdx]!.startSec, usable[na.lastTokenIdx]!.endSec,
      );
      fallbackOfBoundary.set(i + 1, boundaryUsedFallback(
        usable, r.silences, w, ca.firstTokenIdx, ca.lastTokenIdx, na.firstTokenIdx, na.lastTokenIdx,
      ));
    }

    const rows = r.committed.map((s, i) => {
      const t = s.startTime;
      const n = nearestSilenceMidpoint(t, r.silences);
      const tag = tagOf(s);
      const a = CLASS_A.find(x => x.tag === tag);
      const b = CLASS_B.find(x => near(x.committed, t, 0.011));
      const pin = EAR_PASS_PINS.find(p => near(p, t, 0.011));
      // The ear-correct value's OWN distance, for the defect rows: if the
      // hypothesis holds, this is ~0 while the committed value's is not.
      const ear = a?.ear ?? b?.ear;
      const nEar = ear !== undefined ? nearestSilenceMidpoint(ear, r.silences) : undefined;
      return {
        index: i, tag, committed: t,
        d: n?.d ?? null, kind: n?.kind ?? null,
        silenceStart: n?.startSec ?? null, silenceEnd: n?.endSec ?? null,
        silenceMid: n?.mid ?? null,
        silenceWidth: n ? n.endSec - n.startSec : null,
        usedFallback: fallbackOfBoundary.get(i) ?? null,
        label: a ? 'class-A' : b ? 'class-B' : pin !== undefined ? 'ear-pass-pin' : 'unlabelled',
        earCorrect: ear ?? null,
        earD: nEar?.d ?? null,
        earKind: nEar?.kind ?? null,
      };
    });

    const ds = rows.map(x => x.d).filter((x): x is number => x !== null).sort((p, q) => p - q);
    const q = (f: number): number => ds[Math.min(ds.length - 1, Math.floor(f * (ds.length - 1)))]!;
    const hist: Record<string, number> = {};
    const bins = [0.001, 0.01, 0.025, 0.05, 0.1, 0.2, 0.3, 0.5, 1, 2, 5, Infinity];
    for (const d of ds) {
      const bin = bins.find(bb => d <= bb)!;
      const key = bin === Infinity ? '>5' : `<=${bin}`;
      hist[key] = (hist[key] ?? 0) + 1;
    }

    const labelled = (l: string): typeof rows => rows.filter(x => x.label === l);
    const summary = {
      runId: r.runId,
      boundaries: rows.length,
      distribution: {
        n: ds.length, min: ds[0], p10: q(0.10), p25: q(0.25), median: q(0.50),
        p75: q(0.75), p90: q(0.90), p95: q(0.95), p99: q(0.99), max: ds[ds.length - 1],
        histogram: hist,
      },
      classA: labelled('class-A').map(x => ({ tag: x.tag, committed: x.committed, d: x.d, kind: x.kind, ear: x.earCorrect, earD: x.earD, usedFallback: x.usedFallback })),
      classB: labelled('class-B').map(x => ({ tag: x.tag, committed: x.committed, d: x.d, kind: x.kind, ear: x.earCorrect, earD: x.earD, usedFallback: x.usedFallback })),
      pins: labelled('ear-pass-pin').map(x => ({ tag: x.tag, committed: x.committed, d: x.d, kind: x.kind, usedFallback: x.usedFallback })),
      fallbackCounts: {
        fallback: rows.filter(x => x.usedFallback === true).length,
        snapped: rows.filter(x => x.usedFallback === false).length,
        notApplicable: rows.filter(x => x.usedFallback === null).length,
      },
      unlabelledCount: labelled('unlabelled').length,
    };

    writeFileSync(resolve(OUT_ROOT, 'stepQ3-silence-distance.json'), JSON.stringify({ ...summary, rows }, null, 2));
    // eslint-disable-next-line no-console
    console.log('[STEP Q3]', JSON.stringify(summary, null, 2));

    expect(rows.length).toBe(447);
  }, 900_000);
});
