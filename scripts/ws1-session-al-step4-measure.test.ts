/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// ---------------------------------------------------------------------------
// WS1 Session AL — STEP 4. FOUR-ARM ACCURACY MEASUREMENT, v6 ONLY.
//
//   A — production baseline at HEAD (v6's default stamped arm).
//   B — global S2, no excision, 10-30s      (`fa_ai_words.json`, Session AI).
//   C — global S2 WITH R.5 excision, 10-30s (`fa_ak_words.json`, Session AK).
//   D — PERIOD-STRICT, R.5 excision ON, 1-15s (`fa_al_words.json`, this
//       session). A ONE-VARIABLE change from C: measured in Step 2, the
//       period-strict rule selects exactly the same 368 sentence ends on v6 as
//       `s2EndsSentence` does, so the only thing that differs is the BAND (and
//       the bounded silence search the band makes reachable).
//
// Every v6 boundary is machine-adjudicable against the AJ-0 live-export
// oracle, so no listening pass is involved and none is claimed.
//
// THE GATE IS IMPORTED, NEVER RESTATED — `ws1-session-al-step1-gate.ts` was
// committed before the planner existed and before any alignment ran.
//
// Gated: WS1_SESSION_AL_MEASURE=1 npx vitest run scripts/ws1-session-al-step4-measure.test.ts
// ---------------------------------------------------------------------------

import { describe, it, expect } from 'vitest';
import { writeFileSync, readFileSync, mkdirSync, existsSync } from 'fs';
import { resolve } from 'path';

import { CORPORA, runProductionPath, tagOf, REPO, REPLAY_ROOT, loadLiveBundle } from './ws1-session-p-pipeline.js';
import { parseProjectData } from '../src/App';
import { applyAnchorBasedTiming } from '../src/services/syncEngine';
import type { FaChunk } from '../src/services/faChunkPlan';
import { CONF_MIN_FALLBACK } from '../src/services/syncConstants';
import { earVerifiedControls, S1_KNOWN_BAD_MOVES, EAR_PIN_TOLERANCE_SEC } from './ws1-ear-pass-ledger.js';
import {
  AL_GATE, V6_OPEN_DEFECTS, HARD_FAIL_MOVE_SEC, DEFECT_LANDED_SEC, EAR_BILL_TOLERANCE_SEC,
  KNOWN_BAD_MATCH_SEC, MIN_DEFECTS_REQUIRED, MIN_IMPLIED_PRECISION, ARM_C_V6_REGRESSIONS,
  WORSE_THAN_ARM_C_ABOVE, WORSE_THAN_PRODUCTION_ABOVE, MATERIALLY_BETTER_AT_OR_BELOW,
  PREDICTION_CHUNK_COUNT, PREDICTION_RESOURCES, SHAPE_IF_WIDTH_CAUSES, SHAPE_IF_WIDTH_IRRELEVANT,
  AK_V6_DRIFT_MEAN, AK_V6_MEDIAN_WIDTH_SEC, ESTIMATE_TRACKING_R_AT_LEAST, ESTIMATE_TRACKING_R_BELOW,
  WIDTH_FALSIFIER,
} from './ws1-session-al-step1-gate.js';
import type { TranscriptToken } from '../src/types';
import type { SilenceInterval } from '../src/services/silenceDetector';

const MEASURE = process.env.WS1_SESSION_AL_MEASURE === '1';
const OUT = resolve(REPO, '.work-phase4/session-al');
const KEY = 'v6';

type ProductionRun = Awaited<ReturnType<typeof runProductionPath>>;
type ArmName = 'A' | 'B' | 'C' | 'D';
const ARMS: readonly ArmName[] = ['A', 'B', 'C', 'D'];

interface OracleBoundary {
  index: number; tag: string; startTime: number; duration: number;
  openDefect?: boolean; earTarget?: number; knownMicroDrift?: string;
}

const confOf = (t: TranscriptToken | undefined): number =>
  t === undefined ? 0 : ((t as { confidence?: number }).confidence ?? 0);

function isPhantom(t: TranscriptToken, silences: readonly SilenceInterval[]): boolean {
  if (confOf(t) >= CONF_MIN_FALLBACK) return false;
  return silences.some(s => s.startSec <= t.startSec && t.endSec <= s.endSec);
}

/** The AG/AI phantom-tail funnel, definitions unchanged from Session AK. */
function phantomFunnel(
  chunks: readonly FaChunk[], toks: readonly TranscriptToken[], sil: readonly SilenceInterval[],
  committed: ProductionRun['committed'], preRuleSegments: ProductionRun['preRuleSegments'],
  keptAlignments: ProductionRun['keptAlignments'],
): { cond1: number; cond12: number; cond123: number; rows: string[] } {
  const tokensOfChunk: number[][] = chunks.map(() => []);
  let ci = 0;
  for (let t = 0; t < toks.length; t++) {
    const onset = toks[t]!.startSec;
    while (ci < chunks.length && onset >= chunks[ci]!.endSec) ci++;
    if (ci >= chunks.length || onset < chunks[ci]!.startSec) continue;
    tokensOfChunk[ci]!.push(t);
  }
  const phantomTail: number[][] = chunks.map(() => []);
  let cond1 = 0;
  for (let c = 0; c < chunks.length; c++) {
    const ts = tokensOfChunk[c]!;
    const tail: number[] = [];
    for (let k = ts.length - 1; k >= 0; k--) {
      if (!isPhantom(toks[ts[k]!]!, sil)) break;
      tail.unshift(ts[k]!);
    }
    phantomTail[c] = tail;
    if (tail.length > 0) cond1++;
  }
  const firstIdxToSeg = new Map<number, number>();
  for (let i = 1; i < committed.length; i++) {
    const fi = keptAlignments[i]?.firstTokenIdx ?? -1;
    if (fi >= 0 && !firstIdxToSeg.has(fi)) firstIdxToSeg.set(fi, i);
  }
  const preById = new Map(preRuleSegments.map(s => [s.id, s.startTime]));
  let cond12 = 0, cond123 = 0;
  const rows: string[] = [];
  for (let c = 0; c < chunks.length; c++) {
    const tail = phantomTail[c]!;
    if (tail.length === 0) continue;
    const hit = tail.map(idx => firstIdxToSeg.get(idx)).find(v => v !== undefined);
    if (hit === undefined) continue;
    cond12++;
    const seg = committed[hit]!;
    const lTok = toks[keptAlignments[hit - 1]!.lastTokenIdx];
    const rTok = toks[keptAlignments[hit]!.firstTokenIdx];
    if (lTok === undefined || rTok === undefined) continue;
    const pre = preById.get(seg.id) ?? seg.startTime;
    if (pre >= lTok.endSec - 1e-9 && pre <= rTok.startSec + 1e-9) { cond123++; rows.push(tagOf(seg)); }
  }
  return { cond1, cond12, cond123, rows };
}

function lengthStats(chunks: readonly FaChunk[]): Record<string, number> {
  const xs = chunks.map(c => c.endSec - c.startSec).sort((a, b) => a - b);
  if (xs.length === 0) return { n: 0 };
  return {
    n: xs.length,
    min: +xs[0]!.toFixed(3),
    p25: +xs[Math.floor(xs.length * 0.25)]!.toFixed(3),
    median: +xs[Math.floor(xs.length / 2)]!.toFixed(3),
    p75: +xs[Math.floor(xs.length * 0.75)]!.toFixed(3),
    max: +xs[xs.length - 1]!.toFixed(3),
    mean: +(xs.reduce((a, b) => a + b, 0) / xs.length).toFixed(3),
  };
}

/** Pearson r, for the estimate-tracking diagnostic. */
function pearson(xs: readonly number[], ys: readonly number[]): number {
  const n = xs.length;
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let num = 0, dx = 0, dy = 0;
  for (let i = 0; i < n; i++) {
    const a = xs[i]! - mx, b = ys[i]! - my;
    num += a * b; dx += a * a; dy += b * b;
  }
  return dx === 0 || dy === 0 ? 0 : num / Math.sqrt(dx * dy);
}

describe.skipIf(!MEASURE)('WS1 Session AL Step 4 — four-arm v6 accuracy against the AJ-0 oracle', () => {
  it('reports arms A/B/C/D side by side and adjudicates every pre-registered claim', async () => {
    mkdirSync(OUT, { recursive: true });
    const L: string[] = [];
    const json: Record<string, unknown> = {};
    const spec = CORPORA[KEY]!;
    const oracle = JSON.parse(readFileSync(
      resolve(REPO, `scripts/fixtures/session-aj0-oracle-${KEY}.json`), 'utf-8',
    )) as { segmentCount: number; boundaries: OracleBoundary[] };

    L.push('# WS1 Session AL Step 4 — v6 four-arm measurement (MEASURED)');
    L.push('');
    L.push('## The pre-registered gate (imported verbatim from `ws1-session-al-step1-gate.ts`)');
    L.push('');
    L.push('```json');
    L.push(JSON.stringify(AL_GATE, null, 2));
    L.push('```');
    L.push('');

    const A = await runProductionPath(spec);
    const B = await runProductionPath(spec, true, undefined, 'fa_ai_words.json');
    const C = await runProductionPath(spec, true, undefined, 'fa_ak_words.json');
    const D = await runProductionPath(spec, true, undefined, 'fa_al_words.json');
    const planOf = (f: string): FaChunk[] =>
      (JSON.parse(readFileSync(resolve(REPLAY_ROOT, KEY, f), 'utf-8')) as { chunks: FaChunk[] }).chunks;
    const arms: Record<ArmName, { run: ProductionRun; chunks: readonly FaChunk[] }> = {
      A: { run: A, chunks: A.chunks },
      B: { run: B, chunks: planOf('fa_ai_chunks.json') },
      C: { run: C, chunks: planOf('fa_ak_chunks.json') },
      D: { run: D, chunks: planOf('fa_al_chunks.json') },
    };
    const byTag = (r: ProductionRun): Map<string, number> => new Map(r.committed.map(s => [tagOf(s), s.startTime]));
    const vals: Record<ArmName, Map<string, number>> = { A: byTag(A), B: byTag(B), C: byTag(C), D: byTag(D) };

    L.push('| arm | plan | chunks | committed | rules fired |');
    L.push('|---|---|---|---|---|');
    const planName: Record<ArmName, string> = {
      A: 'production (`fa_live_chunks.json`)', B: 'S2 10-30s', C: 'S2+R.5 excision 10-30s',
      D: '**period-strict 1-15s +R.5**',
    };
    for (const a of ARMS) {
      L.push(`| ${a} | ${planName[a]} | ${arms[a].chunks.length} | ${arms[a].run.committed.length} `
        + `| \`${JSON.stringify(arms[a].run.fired)}\` |`);
    }
    L.push('');

    // ================= ORACLE DIFF PER ARM ==================================
    L.push('## Oracle diff per arm — the headline number, four arms side by side');
    L.push('');
    L.push('| arm | compared | unchanged | repaired | **regressed** | unadjudicable | moved total |');
    L.push('|---|---|---|---|---|---|---|');
    const diffJson: Record<string, {
      unchanged: number; repaired: number; regressed: number; unadjudicable: number;
      unadjReasons: Record<string, number>; moved: number;
      regressedRows: Array<Record<string, unknown>>; repairedRows: Array<Record<string, unknown>>;
    }> = {};
    for (const a of ARMS) {
      const v = vals[a];
      let unchanged = 0, repaired = 0, regressed = 0, unadj = 0;
      const unadjReasons: Record<string, number> = {};
      const regressedRows: Array<Record<string, unknown>> = [];
      const repairedRows: Array<Record<string, unknown>> = [];
      for (const b of oracle.boundaries) {
        const x = v.get(b.tag);
        if (x === undefined) { unadj++; unadjReasons['absent-from-arm'] = (unadjReasons['absent-from-arm'] ?? 0) + 1; continue; }
        const d = x - b.startTime;
        if (Math.abs(d) < 1e-9) { unchanged++; continue; }
        if (b.openDefect) {
          if (b.earTarget !== undefined && Math.abs(x - b.earTarget) <= DEFECT_LANDED_SEC) {
            repaired++; repairedRows.push({ tag: b.tag, oracle: b.startTime, arm: x, ear: b.earTarget });
          } else {
            unadj++; unadjReasons['open-defect-moved-without-landing'] = (unadjReasons['open-defect-moved-without-landing'] ?? 0) + 1;
          }
          continue;
        }
        if (Math.abs(d) <= EAR_BILL_TOLERANCE_SEC) {
          unadj++; unadjReasons['within-ledger-pin-tolerance'] = (unadjReasons['within-ledger-pin-tolerance'] ?? 0) + 1; continue;
        }
        regressed++;
        regressedRows.push({ tag: b.tag, oracle: b.startTime, arm: x, delta: +d.toFixed(4), beyondHardFail: Math.abs(d) > HARD_FAIL_MOVE_SEC });
      }
      const moved = repaired + regressed + unadj;
      expect(unchanged + moved, `${a}: the census must sum to the compared total`).toBe(oracle.boundaries.length);
      L.push(`| ${a} | ${oracle.boundaries.length} | ${unchanged} | **${repaired}** | **${regressed}** | ${unadj} | ${moved} |`);
      diffJson[a] = { unchanged, repaired, regressed, unadjudicable: unadj, unadjReasons, moved, regressedRows, repairedRows };
    }
    L.push('');
    L.push('Every arm\'s five categories sum to 447 — asserted, not asserted-in-prose.');
    L.push('');
    for (const a of ARMS) L.push(`- arm ${a} unadjudicable breakdown: \`${JSON.stringify(diffJson[a]!.unadjReasons)}\``);
    L.push('');
    for (const a of ARMS) {
      const beyond = diffJson[a]!.regressedRows.filter(r => r.beyondHardFail).length;
      L.push(`- **arm ${a}: attested-correct boundaries moved beyond ±${HARD_FAIL_MOVE_SEC * 1000}ms — ${beyond}** `
        + `(${beyond === 0 ? 'HARD FAIL 1 clear' : '**HARD FAIL 1 TRIPPED**'})`);
    }
    L.push('');
    L.push('### Against the thresholds fixed in Step 1');
    L.push('');
    const dReg = diffJson.D!.regressed;
    L.push(`| statement | threshold | arm D | verdict |`);
    L.push('|---|---|---|---|');
    L.push(`| worse than arm C | > ${WORSE_THAN_ARM_C_ABOVE} | ${dReg} | ${dReg > WORSE_THAN_ARM_C_ABOVE ? '**WORSE THAN ARM C**' : 'not worse than arm C'} |`);
    L.push(`| worse than production | > ${WORSE_THAN_PRODUCTION_ABOVE} | ${dReg} | ${dReg > WORSE_THAN_PRODUCTION_ABOVE ? '**WORSE THAN PRODUCTION**' : 'not worse than production'} |`);
    L.push(`| materially better than arm C (arm-E trigger) | <= ${MATERIALLY_BETTER_AT_OR_BELOW} | ${dReg} | ${dReg <= MATERIALLY_BETTER_AT_OR_BELOW ? '**TRIGGERED — run arm E**' : 'NOT triggered — no arm E'} |`);
    L.push('');

    // ================= EAR-VERIFIED CONTROLS ================================
    const ctlTags = earVerifiedControls().filter(c => c.corpus === 'v6').map(c => c.tag);
    const moves = (a: ArmName): string[] => ctlTags.filter(t => {
      const x = vals.A.get(t), y = vals[a].get(t);
      return x !== undefined && y !== undefined && Math.abs(x - y) >= 1e-9;
    });
    L.push('## Ear-verified controls (the 42 v6 rows the operator listened to)');
    L.push('');
    L.push('| arm | controls moved off the arm-A value |');
    L.push('|---|---|');
    const ctlJson: Record<string, unknown> = {};
    for (const a of ARMS) {
      const m = moves(a);
      L.push(`| ${a} | **${m.length}** / ${ctlTags.length} |`);
      ctlJson[a] = { moved: m.length, of: ctlTags.length, tags: m };
    }
    L.push('');
    const bMoved = moves('B');
    L.push('### The 30 arm-B control regressions, per arm');
    L.push('');
    L.push('| tag | arm A | arm B | arm C | arm D | |D−A| | arm-D status |');
    L.push('|---|---|---|---|---|---|---|');
    const attribD = { repaired: 0, unchanged: 0, worsened: 0, partial: 0, absent: 0 };
    const ctlRows: Array<Record<string, unknown>> = [];
    for (const t of bMoved) {
      const a = vals.A.get(t)!, b = vals.B.get(t)!, c = vals.C.get(t), d = vals.D.get(t);
      const dB = Math.abs(b - a);
      const dD = d === undefined ? NaN : Math.abs(d - a);
      let status: keyof typeof attribD;
      if (d === undefined) status = 'absent';
      else if (dD < 1e-9) status = 'repaired';
      else if (dD > dB + 1e-9) status = 'worsened';
      else if (dD < dB - 1e-9) status = 'partial';
      else status = 'unchanged';
      attribD[status]++;
      L.push(`| \`${t}\` | ${a.toFixed(3)} | ${b.toFixed(3)} | ${c?.toFixed(3) ?? 'ABSENT'} | ${d?.toFixed(3) ?? 'ABSENT'} `
        + `| ${Number.isFinite(dD) ? dD.toFixed(3) : '—'} | ${status.toUpperCase()} |`);
      ctlRows.push({ tag: t, armA: a, armB: b, armC: c ?? null, armD: d ?? null, deltaD: Number.isFinite(dD) ? +dD.toFixed(4) : null, status });
    }
    L.push('');
    L.push(`- arm D vs the arm-B regression set: **repaired ${attribD.repaired}** | partial ${attribD.partial} `
      + `| unchanged ${attribD.unchanged} | worsened ${attribD.worsened} | absent ${attribD.absent} `
      + `(arm C's own split, MEASURED Session AK: repaired 14, partial 4, unchanged 11, worsened 1)`);
    L.push('');

    // ================= DRIFT PROFILE ========================================
    L.push('## Drift profile along the timeline (arm value − arm A value)');
    L.push('');
    L.push('| decile | n | arm B mean Δ | arm C mean Δ | **arm D mean Δ** | arm D max abs | estimate error mean |');
    L.push('|---|---|---|---|---|---|---|');

    // The anchor-based ESTIMATE's own error — no FA, no chunk plan, no band, so
    // it is identical for arms B, C and D by construction. Registered in Step 1
    // as the independent discriminator.
    const segsRaw = await parseProjectData(
      readFileSync(spec.scriptPath, 'utf-8'), readFileSync(spec.sceneDetailsPath, 'utf-8'), [], spec.audioDuration,
    );
    const anchorTimed = applyAnchorBasedTiming(segsRaw, spec.audioDuration);
    const estByTag = new Map(anchorTimed.map(s => [tagOf(s), s.startTime]));
    const oracleByTag = new Map(oracle.boundaries.map(b => [b.tag, b.startTime]));

    const driftJson: Array<Record<string, number>> = [];
    for (let dec = 0; dec < 10; dec++) {
      const lo = spec.audioDuration * dec / 10, hi = spec.audioDuration * (dec + 1) / 10;
      const inBand = A.committed.filter(s => s.startTime >= lo && s.startTime < hi).map(tagOf);
      const per: Record<ArmName, number[]> = { A: [], B: [], C: [], D: [] };
      const est: number[] = [];
      for (const t of inBand) {
        const a = vals.A.get(t);
        if (a === undefined) continue;
        for (const arm of ARMS) { const x = vals[arm].get(t); if (x !== undefined) per[arm].push(x - a); }
        const e = estByTag.get(t), o = oracleByTag.get(t);
        if (e !== undefined && o !== undefined) est.push(e - o);
      }
      const mean = (xs: number[]): number => xs.length === 0 ? 0 : xs.reduce((p, q) => p + q, 0) / xs.length;
      const maxAbs = (xs: number[]): number => xs.length === 0 ? 0 : Math.max(...xs.map(Math.abs));
      L.push(`| ${lo.toFixed(0)}-${hi.toFixed(0)}s | ${inBand.length} | ${mean(per.B).toFixed(3)} | ${mean(per.C).toFixed(3)} `
        + `| **${mean(per.D).toFixed(3)}** | ${maxAbs(per.D).toFixed(3)} | ${mean(est).toFixed(3)} |`);
      driftJson.push({
        decile: dec, n: inBand.length,
        armBMean: +mean(per.B).toFixed(4), armCMean: +mean(per.C).toFixed(4),
        armDMean: +mean(per.D).toFixed(4), armDMaxAbs: +maxAbs(per.D).toFixed(4),
        estimateErrorMean: +mean(est).toFixed(4),
      });
    }
    L.push('');
    L.push('The last column is the ANCHOR-BASED ESTIMATE\'s own error against the oracle');
    L.push('(`applyAnchorBasedTiming(anchorTimed).startTime − oracle.startTime`). It involves no FA, no chunk');
    L.push('plan and no band, so it is identical for arms B, C and D by construction — which is exactly what');
    L.push('makes it usable as a reference independent of the arm under test.');
    L.push('');

    const shapeOf = (means: readonly number[]): { shape: string; peakIdx: number; peak: number; last: number; monotone: boolean } => {
      const peakIdx = means.reduce((best, m, i) => Math.abs(m) > Math.abs(means[best]!) ? i : best, 0);
      const last = means[means.length - 1]!;
      const monotone = means.every((m, i) => i === 0 || Math.abs(m) >= Math.abs(means[i - 1]!) - 1e-9);
      const shape = monotone ? 'CUMULATIVE (monotone, ends at its extreme)'
        : Math.abs(last) < Math.abs(means[peakIdx]!) * 0.1 ? 'ARCH (rises, peaks mid-corpus, returns to ~zero)'
          : 'neither cleanly monotone nor fully returning';
      return { shape, peakIdx, peak: means[peakIdx]!, last, monotone };
    };
    const dMeans = driftJson.map(x => x.armDMean!);
    const eMeans = driftJson.map(x => x.estimateErrorMean!);
    const dShape = shapeOf(dMeans);
    const eShape = shapeOf(eMeans);
    for (const a of ['B', 'C', 'D'] as const) {
      const ms = driftJson.map(x => (a === 'B' ? x.armBMean : a === 'C' ? x.armCMean : x.armDMean)!);
      const s = shapeOf(ms);
      L.push(`- **arm ${a} drift shape: ${s.shape}** — peak decile ${s.peakIdx} (${s.peak.toFixed(3)}s), final decile ${s.last.toFixed(3)}s`);
    }
    L.push(`- **anchor-estimate error shape: ${eShape.shape}** — peak decile ${eShape.peakIdx} (${eShape.peak.toFixed(3)}s), final decile ${eShape.last.toFixed(3)}s`);
    L.push('');

    // ---- the pre-registered shapes, adjudicated ---------------------------
    const widthsMeasured = { ...AK_V6_MEDIAN_WIDTH_SEC, D: lengthStats(arms.D.chunks).median! };
    const peakAbs = (a: ArmName): number => {
      const ms = driftJson.map(x => (a === 'A' ? 0 : a === 'B' ? x.armBMean : a === 'C' ? x.armCMean : x.armDMean)!);
      return Math.max(...ms.map(Math.abs));
    };
    const dPeakAbs = peakAbs('D');
    const widthCauses = dPeakAbs <= SHAPE_IF_WIDTH_CAUSES.peakAbsMeanAtMostSec
      && peakAbs('B') > peakAbs('C') && peakAbs('C') > dPeakAbs
      && Math.abs(dShape.last) < SHAPE_IF_WIDTH_CAUSES.finalDecileAbsAtMostSec;
    const widthIrrelevant = dPeakAbs >= SHAPE_IF_WIDTH_IRRELEVANT.peakAbsMeanAtLeastSec
      && SHAPE_IF_WIDTH_IRRELEVANT.peakDecileIn.includes(dShape.peakIdx)
      && Math.abs(dShape.last - SHAPE_IF_WIDTH_IRRELEVANT.finalDecileSec) <= SHAPE_IF_WIDTH_IRRELEVANT.finalDecileToleranceSec;
    const estR = pearson(dMeans, eMeans);

    L.push('### The two pre-registered drift shapes, adjudicated');
    L.push('');
    L.push('| arm | median chunk width | peak abs mean Δ |');
    L.push('|---|---|---|');
    for (const a of ARMS) L.push(`| ${a} | ${(widthsMeasured as Record<string, number>)[a]!.toFixed(2)}s | ${peakAbs(a).toFixed(3)}s |`);
    L.push('');
    L.push('| pre-registered shape | condition | measured | matched? |');
    L.push('|---|---|---|---|');
    L.push(`| WIDTH CAUSES THE ARCH | peak abs mean Δ <= ${SHAPE_IF_WIDTH_CAUSES.peakAbsMeanAtMostSec}s, monotone in width, arch retained `
      + `| ${dPeakAbs.toFixed(3)}s | ${widthCauses ? '**MATCHED**' : 'no'} |`);
    L.push(`| WIDTH IS IRRELEVANT | peak abs mean Δ >= ${SHAPE_IF_WIDTH_IRRELEVANT.peakAbsMeanAtLeastSec}s, peak decile in `
      + `[${SHAPE_IF_WIDTH_IRRELEVANT.peakDecileIn.join(',')}], final decile ${SHAPE_IF_WIDTH_IRRELEVANT.finalDecileSec}±`
      + `${SHAPE_IF_WIDTH_IRRELEVANT.finalDecileToleranceSec}s | ${dPeakAbs.toFixed(3)}s, decile ${dShape.peakIdx}, `
      + `${dShape.last.toFixed(3)}s | ${widthIrrelevant ? '**MATCHED**' : 'no'} |`);
    L.push(`| linear-in-width point estimate | ${SHAPE_IF_WIDTH_CAUSES.linearInterpolationPointSec}s | ${dPeakAbs.toFixed(3)}s | — |`);
    L.push('');
    L.push(`- **estimate-tracking diagnostic: Pearson r(arm D decile drift, anchor-estimate decile error) = ${estR.toFixed(4)}** `
      + `— TRACKING at >= ${ESTIMATE_TRACKING_R_AT_LEAST}, NOT TRACKING below ${ESTIMATE_TRACKING_R_BELOW}. `
      + `Verdict: ${estR >= ESTIMATE_TRACKING_R_AT_LEAST ? '**TRACKING**' : estR < ESTIMATE_TRACKING_R_BELOW ? 'NOT TRACKING' : 'INDETERMINATE (between the two registered thresholds)'}`);
    L.push(`- r for arm B: ${pearson(driftJson.map(x => x.armBMean!), eMeans).toFixed(4)} | arm C: ${pearson(driftJson.map(x => x.armCMean!), eMeans).toFixed(4)}`);
    L.push('');
    L.push(`- **The registered falsifier.** ${WIDTH_FALSIFIER}`);
    L.push(`- **Did it fire? ${widthIrrelevant ? 'YES' : 'no'}**`);
    L.push('');

    // ================= THE THREE OPEN DEFECTS ===============================
    L.push('## v6\'s three open defects, per arm');
    L.push('');
    L.push('| tag | boundary | ear | arm | committed | Δ(arm−ear) | CORRECT (±50ms) | DIRECTION-CORRECT | incoming anchor confidence |');
    L.push('|---|---|---|---|---|---|---|---|---|');
    const defectJson: Array<Record<string, unknown>> = [];
    for (const dRow of V6_OPEN_DEFECTS) {
      const cell = (r: ProductionRun): { v: number | undefined; conf: number } => {
        const i = r.committed.findIndex(s => tagOf(s) === dRow.tag);
        return { v: i >= 0 ? r.committed[i]!.startTime : undefined, conf: i > 0 ? confOf(r.usableFaTokens[r.keptAlignments[i]?.firstTokenIdx ?? -1]) : NaN };
      };
      const cells: Record<ArmName, { v: number | undefined; conf: number }> = {
        A: cell(A), B: cell(B), C: cell(C), D: cell(D),
      };
      for (const a of ARMS) {
        const cc = cells[a];
        const landed = cc.v !== undefined && Math.abs(cc.v - dRow.ear) <= DEFECT_LANDED_SEC;
        const toward = cc.v !== undefined && cells.A.v !== undefined && Math.abs(cc.v - dRow.ear) < Math.abs(cells.A.v - dRow.ear);
        L.push(`| \`${dRow.tag}\` | ${dRow.boundary} | ${dRow.ear.toFixed(2)} | ${a} | ${cc.v?.toFixed(3) ?? '—'} `
          + `| ${cc.v !== undefined ? ((cc.v - dRow.ear) >= 0 ? '+' : '') + (cc.v - dRow.ear).toFixed(3) : '—'} `
          + `| ${landed ? '**YES**' : 'no'} | ${landed ? 'YES (also CORRECT)' : toward ? 'YES' : 'NO'} | ${cc.conf.toExponential(2)} |`);
      }
      defectJson.push({
        tag: dRow.tag, boundary: dRow.boundary, ear: dRow.ear,
        arms: Object.fromEntries(ARMS.map(a => [a, { value: cells[a].v ?? null, conf: cells[a].conf,
          landed: cells[a].v !== undefined && Math.abs(cells[a].v! - dRow.ear) <= DEFECT_LANDED_SEC }])),
      });
    }
    L.push('');
    const slowing = defectJson.find(d => d.tag === '231_slowing_pace') as
      { arms: Record<string, { conf: number }> } | undefined;
    if (slowing) {
      const cA = slowing.arms.A!.conf, cB = slowing.arms.B!.conf, cC = slowing.arms.C!.conf, cD = slowing.arms.D!.conf;
      const verdict = cD > cC + 1e-12 ? (cD >= cA ? 'REVERSES (back to or above the arm-A confidence)' : 'PARTIALLY REVERSES (above arm C, still below arm A)')
        : cD === cC ? 'HOLDS (identical to arm C\'s 0.00e+0)' : 'WORSENS';
      L.push(`- **\`231_slowing_pace\` incoming-anchor confidence: A ${cA.toExponential(2)} → B ${cB.toExponential(2)} `
        + `→ C ${cC.toExponential(2)} → D ${cD.toExponential(2)}. VERDICT: ${verdict}.**`);
      L.push('');
      json.slowingPaceVerdict = { armA: cA, armB: cB, armC: cC, armD: cD, verdict };
    }

    // ================= KNOWN-BAD ============================================
    const kb = S1_KNOWN_BAD_MOVES.filter(m => m.corpus === 'v6');
    L.push('## `S1_KNOWN_BAD_MOVES` reproduction');
    L.push('');
    L.push('| arm | in-corpus known-bad values | reproduced (±5ms) |');
    L.push('|---|---|---|');
    const kbJson: Record<string, unknown> = {};
    for (const a of ARMS) {
      const hits = kb.filter(m => {
        const x = vals[a].get(m.tag);
        return x !== undefined && Math.abs(x - m.proposedValue) < KNOWN_BAD_MATCH_SEC;
      });
      L.push(`| ${a} | ${kb.length} | **${hits.length}**${hits.length ? ` (${hits.map(h => h.tag).join(', ')})` : ''} |`);
      kbJson[a] = { inCorpus: kb.length, reproduced: hits.length, tags: hits.map(h => h.tag) };
    }
    L.push('');

    // ================= PHANTOM FUNNEL =======================================
    L.push('## Phantom-tail funnel (AG definitions, unchanged)');
    L.push('');
    L.push('| arm | chunks | (1) trailing phantom | (1)∧(2) at a seam | (1)∧(2)∧(3) in collapsed gap | rows |');
    L.push('|---|---|---|---|---|---|');
    const funnelJson: Record<string, unknown> = {};
    for (const a of ARMS) {
      const { run, chunks } = arms[a];
      const f = phantomFunnel(chunks, run.usableFaTokens, run.silences, run.committed, run.preRuleSegments, run.keptAlignments);
      L.push(`| ${a} | ${chunks.length} | ${f.cond1} | ${f.cond12} | **${f.cond123}** | ${f.rows.join(', ') || '(none)'} |`);
      funnelJson[a] = f;
    }
    L.push('');

    // ================= RULES ================================================
    L.push('## R.14 / R.15 firings and double-corrections');
    L.push('');
    L.push('Double-correction uses **Session AK\'s recomputed "AI definition"**: the arm\'s chunk-plan change');
    L.push('already moved the PRE-RULE value off arm A\'s pre-rule value, AND some rule (R.11-R.15) still fires');
    L.push('on that segment. Arm C\'s measured value under this definition is 45; arm B\'s is 74.');
    L.push('');
    L.push('| arm | R.11 | R.12 | R.13 | R.14 | R.15 | double-corrected (AI defn) | double-corrected (stacked) |');
    L.push('|---|---|---|---|---|---|---|---|');
    const ruleJson: Record<string, unknown> = {};
    const preByTagA = new Map(A.preRuleSegments.map(s => [tagOf(s), s.startTime]));
    for (const a of ARMS) {
      const r = arms[a].run;
      const preById = new Map(r.preRuleSegments.map(s => [s.id, s.startTime]));
      const trustIds = new Set(r.anchorTrust.map(f => f.segmentId));
      const stageIds = new Set([...r.r11Kept.map(f => f.segmentId), ...r.r12.map(f => f.segmentId), ...r.r13Kept.map(f => f.segmentId)]);
      let stacked = 0;
      for (const s of r.committed) {
        if (!trustIds.has(s.id) || !stageIds.has(s.id)) continue;
        if (Math.abs(s.startTime - (preById.get(s.id) ?? s.startTime)) > 1e-9) stacked++;
      }
      const firedIds = new Set([...stageIds, ...trustIds]);
      let aiDbl = 0;
      for (const seg of r.preRuleSegments) {
        const basePre = preByTagA.get(tagOf(seg));
        if (basePre === undefined || Math.abs(seg.startTime - basePre) < EAR_PIN_TOLERANCE_SEC) continue;
        if (!firedIds.has(seg.id)) continue;
        aiDbl++;
      }
      L.push(`| ${a} | ${r.fired['R.11']} | ${r.fired['R.12']} | ${r.fired['R.13']} | ${r.fired['R.14']} | ${r.fired['R.15']} | **${aiDbl}** | ${stacked} |`);
      ruleJson[a] = { fired: r.fired, doubleCorrectedAI: aiDbl, doubleCorrectedStacked: stacked };
    }
    L.push('');

    const RULE_DEPENDENT = [
      { tag: '152_frozen_brush_mice', value: 451.03, rule: 'R.14' },
      { tag: '400_endless_dark', value: 1266.75, rule: 'R.14' },
    ];
    L.push('### Rule-dependent rows — structurally correct without the rule firing?');
    L.push('');
    L.push('| tag | owning rule | attested | arm | pre-rule | committed | rule moved it? | pre-rule already correct? |');
    L.push('|---|---|---|---|---|---|---|---|');
    const rdJson: Array<Record<string, unknown>> = [];
    for (const rd of RULE_DEPENDENT) {
      for (const a of ARMS) {
        const r = arms[a].run;
        const seg = r.committed.find(s => tagOf(s) === rd.tag);
        const pre = seg ? r.preRuleSegments.find(s => s.id === seg.id) : undefined;
        const movedByRule = seg && pre ? Math.abs(seg.startTime - pre.startTime) > 1e-9 : false;
        const preCorrect = pre !== undefined && Math.abs(pre.startTime - rd.value) <= EAR_PIN_TOLERANCE_SEC;
        L.push(`| \`${rd.tag}\` | ${rd.rule} | ${rd.value.toFixed(2)} | ${a} | ${pre?.startTime.toFixed(3) ?? '—'} `
          + `| ${seg?.startTime.toFixed(3) ?? 'ABSENT'} | ${movedByRule ? 'yes' : 'no'} | ${preCorrect ? '**YES**' : 'no'} |`);
        rdJson.push({ tag: rd.tag, rule: rd.rule, arm: a, preRule: pre?.startTime ?? null, committed: seg?.startTime ?? null, movedByRule, preRuleAlreadyCorrect: preCorrect });
      }
    }
    L.push('');

    // ================= RESOURCES ============================================
    const wall: Record<string, { wallClockSec?: number; peakRssMB?: number }> =
      existsSync(resolve(OUT, 'fa-run-resources.json'))
        ? JSON.parse(readFileSync(resolve(OUT, 'fa-run-resources.json'), 'utf-8'))
        : {};
    L.push('## Chunk-length distribution and FA-run resources');
    L.push('');
    L.push('| arm | n | min | p25 | median | p75 | max | mean | wall clock | peak RSS |');
    L.push('|---|---|---|---|---|---|---|---|---|---|');
    const resJson: Record<string, unknown> = {};
    for (const a of ARMS) {
      const s = lengthStats(arms[a].chunks);
      const w = wall[a];
      L.push(`| ${a} | ${s.n} | ${s.min ?? '—'} | ${s.p25 ?? '—'} | ${s.median ?? '—'} | ${s.p75 ?? '—'} | ${s.max ?? '—'} | ${s.mean ?? '—'} `
        + `| ${w?.wallClockSec ? `${w.wallClockSec}s` : 'n/a (stored arm)'} | ${w?.peakRssMB ? `${w.peakRssMB} MB` : 'n/a (stored arm)'} |`);
      resJson[a] = { lengths: s, resources: w ?? null };
    }
    L.push('');
    L.push(`- Prediction 1 (chunk count): point ${PREDICTION_CHUNK_COUNT.point}, band `
      + `[${PREDICTION_CHUNK_COUNT.lo}, ${PREDICTION_CHUNK_COUNT.hi}] — MEASURED **${arms.D.chunks.length}**, `
      + `${arms.D.chunks.length >= PREDICTION_CHUNK_COUNT.lo && arms.D.chunks.length <= PREDICTION_CHUNK_COUNT.hi ? '**HELD**' : '**MISSED**'}`);
    const wD = wall.D;
    L.push(`- Prediction 1 (wall clock): band [${PREDICTION_RESOURCES.wallClockLoSec}, ${PREDICTION_RESOURCES.wallClockHiSec}]s `
      + `vs arm C's ${PREDICTION_RESOURCES.armCWallClockSec}s — MEASURED **${wD?.wallClockSec ?? 'n/a'}s**, `
      + `${wD?.wallClockSec === undefined ? 'not measured' : wD.wallClockSec >= PREDICTION_RESOURCES.wallClockLoSec && wD.wallClockSec <= PREDICTION_RESOURCES.wallClockHiSec ? '**HELD**' : '**MISSED**'}`);
    L.push(`- Prediction 1 (peak RSS): band [${PREDICTION_RESOURCES.peakRssLoMB}, ${PREDICTION_RESOURCES.peakRssHiMB}] MB `
      + `vs arm C's ${PREDICTION_RESOURCES.armCPeakRssMB} MB — MEASURED **${wD?.peakRssMB ?? 'n/a'} MB**, `
      + `${wD?.peakRssMB === undefined ? 'not measured' : wD.peakRssMB >= PREDICTION_RESOURCES.peakRssLoMB && wD.peakRssMB <= PREDICTION_RESOURCES.peakRssHiMB ? '**HELD**' : '**MISSED**'}`);
    L.push('');

    // ================= R-AS PRECISION + GATE ================================
    L.push('## Implied boundary-improvement precision (R-AS) and the gate verdict');
    L.push('');
    L.push('| arm | repaired (defect landed) | regressed (attested-correct moved >5ms) | implied precision |');
    L.push('|---|---|---|---|');
    const precision: Record<string, number | null> = {};
    for (const a of ARMS) {
      const { repaired, regressed } = diffJson[a]!;
      const denom = repaired + regressed;
      const p = denom === 0 ? null : repaired / denom;
      precision[a] = p;
      L.push(`| ${a} | ${repaired} | ${regressed} | ${p === null ? 'n/a (nothing moved)' : `**${(100 * p).toFixed(2)}%**`} |`);
    }
    L.push('');
    L.push('For scale, all MEASURED: **S1 ≈7%** (rejected 18/18 on ear audit, ruling R-AS), **arm B ≈0.3% on v6**,');
    L.push('**arm C 0.36% on v6**.');
    L.push('');

    const hardFail1 = diffJson.D!.regressedRows.filter(r => r.beyondHardFail).length;
    const hardFail2 = (kbJson.D as { reproduced: number }).reproduced;
    const defectsLanded = defectJson.filter(d => (d.arms as Record<string, { landed: boolean }>).D!.landed).length;
    const impliedPrecision = precision.D ?? null;
    L.push('### The pre-registered gate, adjudicated against arm D');
    L.push('');
    L.push('| condition | bar | arm D | verdict |');
    L.push('|---|---|---|---|');
    L.push(`| HARD FAIL 1 — attested-correct moved >${HARD_FAIL_MOVE_SEC * 1000}ms | 0 | **${hardFail1}** | ${hardFail1 === 0 ? 'PASS' : '**FAIL**'} |`);
    L.push(`| HARD FAIL 2 — known-bad reproduced | 0 | **${hardFail2}** | ${hardFail2 === 0 ? 'PASS' : '**FAIL**'} |`);
    L.push(`| SUCCESS BAR — v6 open defects landed | >= ${MIN_DEFECTS_REQUIRED} of 3 | **${defectsLanded}** | ${defectsLanded >= MIN_DEFECTS_REQUIRED ? 'PASS' : '**FAIL**'} |`);
    L.push(`| SHIP CAP — implied precision | >= ${(100 * MIN_IMPLIED_PRECISION).toFixed(0)}% | **${impliedPrecision === null ? 'n/a' : `${(100 * impliedPrecision).toFixed(2)}%`}** | ${impliedPrecision !== null && impliedPrecision >= MIN_IMPLIED_PRECISION ? 'PASS' : '**FAIL**'} |`);
    L.push('');
    const gateVerdict = hardFail1 === 0 && hardFail2 === 0 && defectsLanded >= MIN_DEFECTS_REQUIRED
      && impliedPrecision !== null && impliedPrecision >= MIN_IMPLIED_PRECISION;
    L.push(`**GATE VERDICT: ${gateVerdict ? 'PASS' : 'FAIL'}**`);
    L.push('');
    L.push(`**ARM E TRIGGER (Step 5): arm D regressions ${dReg} vs the pre-registered <= ${MATERIALLY_BETTER_AT_OR_BELOW} — `
      + `${dReg <= MATERIALLY_BETTER_AT_OR_BELOW ? 'TRIGGERED, run arm E' : 'NOT TRIGGERED, no arm E; report the negative'}.** `
      + `Arm C's own count for reference: ${ARM_C_V6_REGRESSIONS}.`);
    L.push('');

    json.armChunks = Object.fromEntries(ARMS.map(a => [a, arms[a].chunks.length]));
    json.armCommitted = Object.fromEntries(ARMS.map(a => [a, arms[a].run.committed.length]));
    json.oracleDiff = diffJson;
    json.controls = { byArm: ctlJson, armBRegressionRows: ctlRows, armDAttribution: attribD };
    json.drift = driftJson;
    json.driftShapes = {
      armD: dShape, estimate: eShape, peakAbs: Object.fromEntries(ARMS.map(a => [a, +peakAbs(a).toFixed(4)])),
      medianWidths: widthsMeasured, widthCausesMatched: widthCauses, widthIrrelevantMatched: widthIrrelevant,
      estimateTrackingR: +estR.toFixed(4), falsifierFired: widthIrrelevant,
    };
    json.openDefects = defectJson;
    json.knownBad = kbJson;
    json.phantomFunnel = funnelJson;
    json.rules = ruleJson;
    json.ruleDependent = rdJson;
    json.resources = resJson;
    json.precision = precision;
    json.gateVerdict = { pass: gateVerdict, hardFail1, hardFail2, defectsLanded, impliedPrecision, regressions: dReg };
    json.gate = AL_GATE;

    writeFileSync(resolve(OUT, 'step4-measure.md'), `${L.join('\n')}\n`);
    writeFileSync(resolve(OUT, 'step4-measure.json'), JSON.stringify(json, null, 2));
    // eslint-disable-next-line no-console
    console.log(L.join('\n'));
  }, 900_000);
});
