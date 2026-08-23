/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// ---------------------------------------------------------------------------
// WS1 Session AM — STEP 5. SIX-ARM ACCURACY MEASUREMENT, v6 ONLY.
//
//   A — production baseline at HEAD (v6's default stamped arm).
//   B — global S2, no excision, 10-30s            (`fa_ai_words.json`, AI).
//   C — global S2 WITH R.5 excision, 10-30s       (`fa_ak_words.json`, AK).
//   D — period-strict, R.5 excision ON, 1-15s     (`fa_al_words.json`, AL).
//   F — ARM C with ANCHOR-PLACED chunk edges      (`fa_am_f_words.json`, this).
//   G — ARM C with ORACLE-PLACED chunk edges      (`fa_am_g_words.json`, this).
//       *** DIAGNOSTIC ONLY. CAN NEVER SHIP. ***
//
// ARM E WAS NEVER TRIGGERED AND ITS LABEL STAYS RETIRED — it is deliberately
// absent from the arm list rather than reused.
//
// Every v6 boundary is machine-adjudicable against the AJ-0 live-export oracle,
// so no listening pass is involved and none is claimed.
//
// THE GATE IS IMPORTED, NEVER RESTATED — `ws1-session-am-step1-gate.ts` was
// committed as its own SHA before either planner existed and before any
// alignment ran. Step 6's conclusion is likewise SELECTED from the gate's
// pre-committed table by `adjudicate()`, never composed here.
//
// Gated: WS1_SESSION_AM_MEASURE=1 npx vitest run scripts/ws1-session-am-step5-measure.test.ts
// ---------------------------------------------------------------------------

import { describe, it, expect } from 'vitest';
import { writeFileSync, readFileSync, mkdirSync, existsSync } from 'fs';
import { resolve } from 'path';

import { CORPORA, runProductionPath, tagOf, REPO, REPLAY_ROOT } from './ws1-session-p-pipeline.js';
import { parseProjectData } from '../src/App';
import { applyAnchorBasedTiming } from '../src/services/syncEngine';
import type { FaChunk } from '../src/services/faChunkPlan';
import { CONF_MIN_FALLBACK } from '../src/services/syncConstants';
import { earVerifiedControls, S1_KNOWN_BAD_MOVES, EAR_PIN_TOLERANCE_SEC } from './ws1-ear-pass-ledger.js';
import {
  AM_GATE, V6_OPEN_DEFECTS, HARD_FAIL_MOVE_SEC, DEFECT_LANDED_SEC, EAR_BILL_TOLERANCE_SEC,
  KNOWN_BAD_MATCH_SEC, MIN_DEFECTS_REQUIRED, MIN_IMPLIED_PRECISION, ARM_C_V6_REGRESSIONS,
  WORSE_THAN_ARM_C_ABOVE, WORSE_THAN_PRODUCTION_ABOVE, MATERIALLY_BETTER_AT_OR_BELOW,
  PREDICTIONS_F, PREDICTIONS_G, FALSIFIER_F, FALSIFIER_G, archVerdict, adjudicate,
  ARCH_DIED_AT_OR_BELOW_SEC, ARCH_SURVIVED_AT_OR_ABOVE_SEC, AL_V6_PRECISION,
  AL_V6_MEDIAN_WIDTH_SEC, AL_V6_ESTIMATE_R, ESTIMATE_PEAK_ABS_SEC, ARM_C_RESOURCES,
  ARM_G_SHIP_GATE_APPLIES,
} from './ws1-session-am-step1-gate.js';
import type { Prediction } from './ws1-session-am-step1-gate.js';
import type { TranscriptToken } from '../src/types';
import type { SilenceInterval } from '../src/services/silenceDetector';

const MEASURE = process.env.WS1_SESSION_AM_MEASURE === '1';
const OUT = resolve(REPO, '.work-phase4/session-am');
const DOCS = resolve(REPO, 'docs/ws1-sync-pipeline');
const KEY = 'v6';

type ProductionRun = Awaited<ReturnType<typeof runProductionPath>>;
type ArmName = 'A' | 'B' | 'C' | 'D' | 'F' | 'G';
const ARMS: readonly ArmName[] = ['A', 'B', 'C', 'D', 'F', 'G'];

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

/** The AG/AI phantom-tail funnel, definitions unchanged from Sessions AK/AL. */
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

/** Prediction adjudication, so HELD/MISSED is mechanical rather than narrated. */
const scorePrediction = (p: Prediction, measured: number | undefined): string =>
  measured === undefined ? 'NOT MEASURED'
    : measured >= p.lo && measured <= p.hi ? 'HELD' : 'MISSED';

describe.skipIf(!MEASURE)('WS1 Session AM Step 5 — six-arm v6 measurement against the AJ-0 oracle', () => {
  it('reports A/B/C/D/F/G side by side and adjudicates every pre-registered claim', async () => {
    mkdirSync(OUT, { recursive: true });
    const L: string[] = [];
    const json: Record<string, unknown> = {};
    const spec = CORPORA[KEY]!;
    const oracle = JSON.parse(readFileSync(
      resolve(REPO, `scripts/fixtures/session-aj0-oracle-${KEY}.json`), 'utf-8',
    )) as { segmentCount: number; boundaries: OracleBoundary[] };

    L.push('# WS1 Session AM Step 5 — v6 six-arm measurement (MEASURED)');
    L.push('');
    L.push('Arm E was never triggered and its label stays retired — it is absent by design, not by oversight.');
    L.push('');
    L.push('## The pre-registered gate (imported verbatim from `ws1-session-am-step1-gate.ts`)');
    L.push('');
    L.push('```json');
    L.push(JSON.stringify(AM_GATE, null, 2));
    L.push('```');
    L.push('');

    const A = await runProductionPath(spec);
    const B = await runProductionPath(spec, true, undefined, 'fa_ai_words.json');
    const C = await runProductionPath(spec, true, undefined, 'fa_ak_words.json');
    const D = await runProductionPath(spec, true, undefined, 'fa_al_words.json');
    const F = await runProductionPath(spec, true, undefined, 'fa_am_f_words.json');
    const G = await runProductionPath(spec, true, undefined, 'fa_am_g_words.json');
    const planOf = (f: string): FaChunk[] =>
      (JSON.parse(readFileSync(resolve(REPLAY_ROOT, KEY, f), 'utf-8')) as { chunks: FaChunk[] }).chunks;
    const arms: Record<ArmName, { run: ProductionRun; chunks: readonly FaChunk[] }> = {
      A: { run: A, chunks: A.chunks },
      B: { run: B, chunks: planOf('fa_ai_chunks.json') },
      C: { run: C, chunks: planOf('fa_ak_chunks.json') },
      D: { run: D, chunks: planOf('fa_al_chunks.json') },
      F: { run: F, chunks: planOf('fa_am_f_chunks.json') },
      G: { run: G, chunks: planOf('fa_am_g_chunks.json') },
    };
    const byTag = (r: ProductionRun): Map<string, number> => new Map(r.committed.map(s => [tagOf(s), s.startTime]));
    const vals: Record<ArmName, Map<string, number>> = {
      A: byTag(A), B: byTag(B), C: byTag(C), D: byTag(D), F: byTag(F), G: byTag(G),
    };

    const planName: Record<ArmName, string> = {
      A: 'production (`fa_live_chunks.json`)', B: 'S2 10-30s', C: 'S2+R.5 excision 10-30s',
      D: 'period-strict 1-15s +R.5', F: '**anchor-placed edges, 10-30s +R.5**',
      G: '**oracle-placed edges, 10-30s +R.5** — DIAGNOSTIC ONLY',
    };
    L.push('| arm | plan | chunks | committed | rules fired |');
    L.push('|---|---|---|---|---|');
    for (const a of ARMS) {
      L.push(`| ${a} | ${planName[a]} | ${arms[a].chunks.length} | ${arms[a].run.committed.length} `
        + `| \`${JSON.stringify(arms[a].run.fired)}\` |`);
    }
    L.push('');

    // ================= ORACLE DIFF PER ARM ==================================
    L.push('## Oracle diff per arm — the headline number, six arms side by side');
    L.push('');
    L.push('| arm | compared | unchanged | repaired | **regressed** | unadjudicable | moved total | beyond ±50ms |');
    L.push('|---|---|---|---|---|---|---|---|');
    const diffJson: Record<string, {
      unchanged: number; repaired: number; regressed: number; unadjudicable: number;
      unadjReasons: Record<string, number>; moved: number; beyondHardFail: number;
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
      const beyondHardFail = regressedRows.filter(r => r.beyondHardFail).length;
      expect(unchanged + moved, `${a}: the census must sum to the compared total`).toBe(oracle.boundaries.length);
      L.push(`| ${a} | ${oracle.boundaries.length} | ${unchanged} | **${repaired}** | **${regressed}** | ${unadj} | ${moved} | **${beyondHardFail}** |`);
      diffJson[a] = { unchanged, repaired, regressed, unadjudicable: unadj, unadjReasons, moved, beyondHardFail, regressedRows, repairedRows };
    }
    L.push('');
    L.push('Every arm\'s five categories sum to 447 — asserted, not asserted-in-prose.');
    L.push('');
    for (const a of ARMS) L.push(`- arm ${a} unadjudicable breakdown: \`${JSON.stringify(diffJson[a]!.unadjReasons)}\``);
    L.push('');

    // ================= DRIFT PROFILE ========================================
    const segsRaw = await parseProjectData(
      readFileSync(spec.scriptPath, 'utf-8'), readFileSync(spec.sceneDetailsPath, 'utf-8'), [], spec.audioDuration,
    );
    const anchorTimed = applyAnchorBasedTiming(segsRaw, spec.audioDuration);
    const estByTag = new Map(anchorTimed.map(s => [tagOf(s), s.startTime]));
    const oracleByTag = new Map(oracle.boundaries.map(b => [b.tag, b.startTime]));

    L.push('## Drift profile along the timeline (arm value − arm A value)');
    L.push('');
    L.push('| decile | n | B | C | D | **F** | **G** | estimate error |');
    L.push('|---|---|---|---|---|---|---|---|');
    const driftJson: Array<Record<string, number>> = [];
    for (let dec = 0; dec < 10; dec++) {
      const lo = spec.audioDuration * dec / 10, hi = spec.audioDuration * (dec + 1) / 10;
      const inBand = A.committed.filter(s => s.startTime >= lo && s.startTime < hi).map(tagOf);
      const per: Record<ArmName, number[]> = { A: [], B: [], C: [], D: [], F: [], G: [] };
      const est: number[] = [];
      for (const t of inBand) {
        const a = vals.A.get(t);
        if (a === undefined) continue;
        for (const arm of ARMS) { const x = vals[arm].get(t); if (x !== undefined) per[arm].push(x - a); }
        const e = estByTag.get(t), o = oracleByTag.get(t);
        if (e !== undefined && o !== undefined) est.push(e - o);
      }
      const mean = (xs: number[]): number => xs.length === 0 ? 0 : xs.reduce((p, q) => p + q, 0) / xs.length;
      L.push(`| ${lo.toFixed(0)}-${hi.toFixed(0)}s | ${inBand.length} | ${mean(per.B).toFixed(3)} | ${mean(per.C).toFixed(3)} `
        + `| ${mean(per.D).toFixed(3)} | **${mean(per.F).toFixed(3)}** | **${mean(per.G).toFixed(3)}** | ${mean(est).toFixed(3)} |`);
      driftJson.push({
        decile: dec, n: inBand.length,
        armBMean: +mean(per.B).toFixed(4), armCMean: +mean(per.C).toFixed(4),
        armDMean: +mean(per.D).toFixed(4), armFMean: +mean(per.F).toFixed(4),
        armGMean: +mean(per.G).toFixed(4),
        armFMaxAbs: +(per.F.length ? Math.max(...per.F.map(Math.abs)) : 0).toFixed(4),
        armGMaxAbs: +(per.G.length ? Math.max(...per.G.map(Math.abs)) : 0).toFixed(4),
        estimateErrorMean: +mean(est).toFixed(4),
      });
    }
    L.push('');
    L.push('The last column is the ANCHOR-BASED ESTIMATE\'s own error against the oracle');
    L.push('(`applyAnchorBasedTiming(anchorTimed).startTime − oracle.startTime`). It involves no FA, no chunk');
    L.push('plan and no band, so it is identical for every arm by construction — which is exactly what makes');
    L.push('it usable as a reference independent of the arm under test, and why it is retained here.');
    L.push('');

    const meansOf = (a: ArmName): number[] => driftJson.map(x =>
      a === 'A' ? 0 : x[`arm${a}Mean`]!);
    const eMeans = driftJson.map(x => x.estimateErrorMean!);
    const shapeOf = (means: readonly number[]): { shape: string; peakIdx: number; peak: number; last: number; monotone: boolean } => {
      const peakIdx = means.reduce((best, m, i) => Math.abs(m) > Math.abs(means[best]!) ? i : best, 0);
      const last = means[means.length - 1]!;
      const monotone = means.every((m, i) => i === 0 || Math.abs(m) >= Math.abs(means[i - 1]!) - 1e-9);
      const shape = monotone ? 'CUMULATIVE (monotone, ends at its extreme)'
        : Math.abs(last) < Math.abs(means[peakIdx]!) * 0.1 ? 'ARCH (rises, peaks mid-corpus, returns to ~zero)'
          : 'neither cleanly monotone nor fully returning';
      return { shape, peakIdx, peak: means[peakIdx]!, last, monotone };
    };

    L.push('### Arch verdicts, against the bands fixed numerically in Step 1');
    L.push('');
    L.push(`DIED at peak |mean decile Δ| <= **${ARCH_DIED_AT_OR_BELOW_SEC}s**; SURVIVED at >= **${ARCH_SURVIVED_AT_OR_ABOVE_SEC}s**;`);
    L.push('anything strictly between is **PARTIAL** and is reported as partial. These were fixed before the');
    L.push('planners existed and are not retro-fitted.');
    L.push('');
    L.push('| arm | median chunk width | peak abs mean Δ | peak decile | final decile | shape | **arch verdict** | r vs estimate |');
    L.push('|---|---|---|---|---|---|---|---|');
    const shapes: Record<string, ReturnType<typeof shapeOf>> = {};
    const peakAbsOf: Record<string, number> = {};
    const rOf: Record<string, number> = {};
    for (const a of ARMS) {
      const ms = meansOf(a);
      const s = shapeOf(ms);
      const peak = Math.max(...ms.map(Math.abs));
      const r = pearson(ms, eMeans);
      shapes[a] = s; peakAbsOf[a] = peak; rOf[a] = r;
      const width = lengthStats(arms[a].chunks).median ?? 0;
      L.push(`| ${a} | ${width.toFixed(2)}s | **${peak.toFixed(3)}s** | ${s.peakIdx} | ${s.last.toFixed(3)}s `
        + `| ${s.shape} | **${a === 'A' ? 'n/a (baseline)' : archVerdict(peak)}** | ${r.toFixed(4)} |`);
    }
    const eShape = shapeOf(eMeans);
    L.push(`| _estimate itself_ | — | ${Math.max(...eMeans.map(Math.abs)).toFixed(3)}s | ${eShape.peakIdx} `
      + `| ${eShape.last.toFixed(3)}s | ${eShape.shape} | — | 1.0000 |`);
    L.push('');
    L.push(`Sessions AK/AL measured the same r for arms B/C/D at ${AL_V6_ESTIMATE_R.B} / ${AL_V6_ESTIMATE_R.C} / `
      + `${AL_V6_ESTIMATE_R.D}, and the estimate's own peak at ${ESTIMATE_PEAK_ABS_SEC}s. Median widths then: `
      + `A ${AL_V6_MEDIAN_WIDTH_SEC.A} / B ${AL_V6_MEDIAN_WIDTH_SEC.B} / C ${AL_V6_MEDIAN_WIDTH_SEC.C} / D ${AL_V6_MEDIAN_WIDTH_SEC.D}.`);
    L.push('');

    const verdictF = archVerdict(peakAbsOf.F!);
    const verdictG = archVerdict(peakAbsOf.G!);

    // ================= EAR-VERIFIED CONTROLS ================================
    const ctlTags = earVerifiedControls().filter(c => c.corpus === 'v6').map(c => c.tag);
    const moves = (a: ArmName): string[] => ctlTags.filter(t => {
      const x = vals.A.get(t), y = vals[a].get(t);
      return x !== undefined && y !== undefined && Math.abs(x - y) >= 1e-9;
    });
    L.push('## Ear-verified controls (the v6 rows the operator listened to)');
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
    L.push('| tag | A | B | C | D | F | G | arm-F status | arm-G status |');
    L.push('|---|---|---|---|---|---|---|---|---|');
    const attrib = (a: ArmName): Record<string, number> => ({ repaired: 0, unchanged: 0, worsened: 0, partial: 0, absent: 0 });
    const attribF = attrib('F'), attribG = attrib('G');
    const ctlRows: Array<Record<string, unknown>> = [];
    const statusOf = (aVal: number, bVal: number, x: number | undefined): string => {
      if (x === undefined) return 'absent';
      const dB = Math.abs(bVal - aVal), dX = Math.abs(x - aVal);
      if (dX < 1e-9) return 'repaired';
      if (dX > dB + 1e-9) return 'worsened';
      if (dX < dB - 1e-9) return 'partial';
      return 'unchanged';
    };
    for (const t of bMoved) {
      const a = vals.A.get(t)!, b = vals.B.get(t)!;
      const c = vals.C.get(t), d = vals.D.get(t), f = vals.F.get(t), g = vals.G.get(t);
      const sF = statusOf(a, b, f), sG = statusOf(a, b, g);
      attribF[sF]!++; attribG[sG]!++;
      L.push(`| \`${t}\` | ${a.toFixed(3)} | ${b.toFixed(3)} | ${c?.toFixed(3) ?? 'ABSENT'} | ${d?.toFixed(3) ?? 'ABSENT'} `
        + `| ${f?.toFixed(3) ?? 'ABSENT'} | ${g?.toFixed(3) ?? 'ABSENT'} | ${sF.toUpperCase()} | ${sG.toUpperCase()} |`);
      ctlRows.push({ tag: t, armA: a, armB: b, armC: c ?? null, armD: d ?? null, armF: f ?? null, armG: g ?? null, statusF: sF, statusG: sG });
    }
    L.push('');
    L.push(`- **arm F vs the arm-B regression set: repaired ${attribF.repaired} | partial ${attribF.partial} `
      + `| unchanged ${attribF.unchanged} | worsened ${attribF.worsened} | absent ${attribF.absent}**`);
    L.push(`- **arm G vs the same set: repaired ${attribG.repaired} | partial ${attribG.partial} `
      + `| unchanged ${attribG.unchanged} | worsened ${attribG.worsened} | absent ${attribG.absent}**`);
    L.push('- for reference, MEASURED: arm C repaired 14 / partial 4 / unchanged 11 / worsened 1; arm D repaired 14.');
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
        A: cell(A), B: cell(B), C: cell(C), D: cell(D), F: cell(F), G: cell(G),
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
        arms: Object.fromEntries(ARMS.map(a => [a, {
          value: cells[a].v ?? null, conf: cells[a].conf,
          landed: cells[a].v !== undefined && Math.abs(cells[a].v! - dRow.ear) <= DEFECT_LANDED_SEC,
        }])),
      });
    }
    L.push('');
    const slowing = defectJson.find(d => d.tag === '231_slowing_pace') as
      { arms: Record<string, { conf: number }> } | undefined;
    if (slowing) {
      const c = (a: string): number => slowing.arms[a]!.conf;
      const describe = (x: number): string =>
        x === 0 ? '**COLLAPSED (0.00e+0)**' : x > c('C') ? 'recovered above arm C' : 'below or equal to arm C';
      L.push('### `231_slowing_pace`\'s confidence collapse — the cleanest marker available');
      L.push('');
      L.push(`Arm A ${c('A').toExponential(2)} → B ${c('B').toExponential(2)} → C ${c('C').toExponential(2)} `
        + `→ D ${c('D').toExponential(2)} → **F ${c('F').toExponential(2)}** → **G ${c('G').toExponential(2)}**.`);
      L.push('');
      L.push(`- **In arm F the collapse ${c('F') === 0 ? 'PERSISTS' : 'DOES NOT PERSIST'}** — ${describe(c('F'))}.`);
      L.push(`- **In arm G the collapse ${c('G') === 0 ? 'PERSISTS' : 'DOES NOT PERSIST'}** — ${describe(c('G'))}.`);
      L.push('');
      L.push('It held identically at 0.00e+0 in arms C and D. A collapse that survives even ORACLE-PLACED');
      L.push('edges cannot be caused by where the chunk edge sits; one that clears under them can.');
      L.push('');
      json.slowingPace = Object.fromEntries(ARMS.map(a => [a, c(a)]));
    }

    // ================= KNOWN-BAD ============================================
    const kb = S1_KNOWN_BAD_MOVES.filter(m => m.corpus === 'v6');
    L.push('## `S1_KNOWN_BAD_MOVES` reproduction');
    L.push('');
    L.push('| arm | in-corpus known-bad values | reproduced (±5ms) |');
    L.push('|---|---|---|');
    const kbJson: Record<string, { inCorpus: number; reproduced: number; tags: string[] }> = {};
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
    L.push('| arm | R.11 | R.12 | R.13 | **R.14** | **R.15** | double-corrected (AI defn) | double-corrected (stacked) |');
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
      L.push(`| ${a} | ${r.fired['R.11']} | ${r.fired['R.12']} | ${r.fired['R.13']} | **${r.fired['R.14']}** | **${r.fired['R.15']}** | **${aiDbl}** | ${stacked} |`);
      ruleJson[a] = { fired: r.fired, doubleCorrectedAI: aiDbl, doubleCorrectedStacked: stacked };
    }
    L.push('');

    const RULE_DEPENDENT = [
      { tag: '152_frozen_brush_mice', value: 451.03, rule: 'R.14' },
      { tag: '400_endless_dark', value: 1266.75, rule: 'R.14' },
    ];
    L.push('### Rule-dependent rows — structurally correct without the rule firing?');
    L.push('');
    L.push('**`iron_bounce` and `logic_clash` are 173-corpus rows.** This session is v6-only by operator');
    L.push('direction and runs no 173 alignment, so their structural correctness is **NOT MEASURED and NOT');
    L.push('MEASURABLE within this scope** — stated rather than silently omitted. The two v6 rows follow.');
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

    // ================= CHUNKS, VIOLATIONS, RESOURCES ========================
    const wall: Record<string, {
      wallClockSec?: number; peakRssMB?: number; ctcInfeasibleChunks?: number;
      words?: number; needsReview?: number;
    }> = existsSync(resolve(OUT, 'fa-run-resources.json'))
      ? JSON.parse(readFileSync(resolve(OUT, 'fa-run-resources.json'), 'utf-8'))
      : {};
    L.push('## Chunk-length distribution, FA-run resources, and alignment health');
    L.push('');
    L.push('| arm | n | min | p25 | median | p75 | max | mean | wall clock | peak RSS | CTC-infeasible chunks | needs_review words |');
    L.push('|---|---|---|---|---|---|---|---|---|---|---|---|');
    const resJson: Record<string, unknown> = {};
    for (const a of ARMS) {
      const s = lengthStats(arms[a].chunks);
      const w = wall[a];
      L.push(`| ${a} | ${s.n} | ${s.min ?? '—'} | ${s.p25 ?? '—'} | ${s.median ?? '—'} | ${s.p75 ?? '—'} | ${s.max ?? '—'} | ${s.mean ?? '—'} `
        + `| ${w?.wallClockSec ? `${w.wallClockSec}s` : 'n/a (stored arm)'} | ${w?.peakRssMB ? `${w.peakRssMB} MB` : 'n/a (stored arm)'} `
        + `| ${w?.ctcInfeasibleChunks ?? 'n/a'} | ${w?.needsReview ?? 'n/a'}${w?.words ? ` / ${w.words}` : ''} |`);
      resJson[a] = { lengths: s, resources: w ?? null };
    }
    L.push('');
    L.push(`Arm C's own MEASURED resources, for scale: ${ARM_C_RESOURCES.wallClockSec}s, ${ARM_C_RESOURCES.peakRssMB} MB.`);
    L.push('');
    L.push('### Violation events, in full');
    L.push('');
    for (const a of ['F', 'G'] as const) {
      const p = JSON.parse(readFileSync(resolve(OUT, a === 'F' ? 'step3-armf.json' : 'step4-armg.json'), 'utf-8')) as
        { violations: Array<{ cause: string; segIdx: number; idealSec: number; seamSec?: number; durationSec?: number; fallback: string }> };
      L.push(`**Arm ${a} — ${p.violations.length} event(s).**`);
      L.push('');
      if (p.violations.length === 0) { L.push('_None._'); L.push(''); continue; }
      L.push('| # | cause | segIdx | ideal | seam | dur | what the planner did |');
      L.push('|---|---|---|---|---|---|---|');
      p.violations.forEach((v, i) => {
        L.push(`| ${i} | \`${v.cause}\` | ${v.segIdx} | ${v.idealSec.toFixed(3)} | ${v.seamSec?.toFixed(3) ?? '—'} `
          + `| ${v.durationSec?.toFixed(3) ?? '—'} | ${v.fallback.replace(/\|/g, '\\|')} |`);
      });
      L.push('');
    }

    // ================= R-AS PRECISION =======================================
    L.push('## Implied boundary-improvement precision (R-AS)');
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
    L.push(`For scale, all MEASURED: **S1 ≈${(100 * AL_V6_PRECISION.S1).toFixed(0)}%** (rejected 18/18 on ear audit, `
      + `ruling R-AS), **arm B ${(100 * AL_V6_PRECISION.B).toFixed(2)}%**, **arm C ${(100 * AL_V6_PRECISION.C).toFixed(2)}%**, `
      + `**arm D ${(100 * AL_V6_PRECISION.D).toFixed(2)}%** on v6.`);
    L.push('');

    // ================= THE GATE, ADJUDICATED ================================
    L.push('## The pre-registered gate, adjudicated');
    L.push('');
    L.push('Arm G is DIAGNOSTIC ONLY, so the SUCCESS BAR and SHIP CAP are **not applied to it** — that was');
    L.push(`fixed in Step 1 (\`ARM_G_SHIP_GATE_APPLIES = ${ARM_G_SHIP_GATE_APPLIES}\`). Its hard-fail rows are still`);
    L.push('reported, because a ceiling arm reproducing a known-bad value would mean the harness is broken.');
    L.push('');
    L.push('| condition | bar | arm F | verdict | arm G | verdict |');
    L.push('|---|---|---|---|---|---|');
    const hf1 = (a: ArmName): number => diffJson[a]!.beyondHardFail;
    const hf2 = (a: ArmName): number => kbJson[a]!.reproduced;
    const landed = (a: ArmName): number => defectJson.filter(d => (d.arms as Record<string, { landed: boolean }>)[a]!.landed).length;
    L.push(`| HARD FAIL 1 — attested-correct moved >${HARD_FAIL_MOVE_SEC * 1000}ms | 0 | **${hf1('F')}** | ${hf1('F') === 0 ? 'PASS' : '**FAIL**'} | **${hf1('G')}** | ${hf1('G') === 0 ? 'PASS' : '**FAIL**'} |`);
    L.push(`| HARD FAIL 2 — known-bad reproduced | 0 | **${hf2('F')}** | ${hf2('F') === 0 ? 'PASS' : '**FAIL**'} | **${hf2('G')}** | ${hf2('G') === 0 ? 'PASS' : '**FAIL**'} |`);
    L.push(`| SUCCESS BAR — open defects landed | >= ${MIN_DEFECTS_REQUIRED} of 3 | **${landed('F')}** | ${landed('F') >= MIN_DEFECTS_REQUIRED ? 'PASS' : '**FAIL**'} | **${landed('G')}** | n/a (not applied) |`);
    const pF = precision.F ?? null, pG = precision.G ?? null;
    L.push(`| SHIP CAP — implied precision | >= ${(100 * MIN_IMPLIED_PRECISION).toFixed(0)}% | **${pF === null ? 'n/a' : `${(100 * pF).toFixed(2)}%`}** | ${pF !== null && pF >= MIN_IMPLIED_PRECISION ? 'PASS' : '**FAIL**'} | **${pG === null ? 'n/a' : `${(100 * pG).toFixed(2)}%`}** | n/a (not applied) |`);
    L.push('');
    const gateF = hf1('F') === 0 && hf2('F') === 0 && landed('F') >= MIN_DEFECTS_REQUIRED
      && pF !== null && pF >= MIN_IMPLIED_PRECISION;
    L.push(`**GATE VERDICT, ARM F: ${gateF ? 'PASS' : 'FAIL'}.** Arm G is not gated.`);
    L.push('');
    L.push('| statement | threshold | arm F | verdict |');
    L.push('|---|---|---|---|');
    const fReg = diffJson.F!.regressed;
    L.push(`| worse than arm C | > ${WORSE_THAN_ARM_C_ABOVE} | ${fReg} | ${fReg > WORSE_THAN_ARM_C_ABOVE ? '**WORSE THAN ARM C**' : 'not worse than arm C'} |`);
    L.push(`| worse than production | > ${WORSE_THAN_PRODUCTION_ABOVE} | ${fReg} | ${fReg > WORSE_THAN_PRODUCTION_ABOVE ? '**WORSE THAN PRODUCTION**' : 'not worse than production'} |`);
    L.push(`| materially better than arm C | <= ${MATERIALLY_BETTER_AT_OR_BELOW} | ${fReg} | ${fReg <= MATERIALLY_BETTER_AT_OR_BELOW ? '**MATERIALLY BETTER — S2 family continues**' : 'NOT materially better'} |`);
    L.push('');

    // ================= PREDICTIONS VS OUTCOMES ==============================
    L.push('## Predictions versus outcomes');
    L.push('');
    const measuredF: Record<string, number | undefined> = {
      chunkCount: arms.F.chunks.length,
      medianWidthSec: lengthStats(arms.F.chunks).median,
      peakAbsMeanDecileSec: peakAbsOf.F,
      peakDecileIndex: shapes.F!.peakIdx,
      finalDecileSec: shapes.F!.last,
      regressed: diffJson.F!.regressed,
      wallClockSec: wall.F?.wallClockSec,
      peakRssMB: wall.F?.peakRssMB,
      estimateTrackingR: rOf.F,
    };
    const measuredG: Record<string, number | undefined> = {
      chunkCount: arms.G.chunks.length,
      medianWidthSec: lengthStats(arms.G.chunks).median,
      peakAbsMeanDecileSec: peakAbsOf.G,
      peakDecileIndex: shapes.G!.peakIdx,
      finalDecileSec: shapes.G!.last,
      regressed: diffJson.G!.regressed,
      wallClockSec: wall.G?.wallClockSec,
      peakRssMB: wall.G?.peakRssMB,
      estimateTrackingR: rOf.G,
    };
    for (const [name, preds, measured, verdict] of [
      ['F', PREDICTIONS_F, measuredF, verdictF], ['G', PREDICTIONS_G, measuredG, verdictG],
    ] as const) {
      L.push(`### Arm ${name}`);
      L.push('');
      L.push('| quantity | point | band | MEASURED | verdict |');
      L.push('|---|---|---|---|---|');
      for (const [k, p] of Object.entries(preds)) {
        const m = measured[k];
        const notScored = k === 'peakDecileIndex' && verdict === 'DIED';
        L.push(`| ${k} | ${p.point} | [${p.lo}, ${p.hi}] | ${m === undefined ? 'not measured' : (+m.toFixed(4))} `
          + `| ${notScored ? 'NOT SCORED (registered as conditional on amplitude >= 5.0s)' : scorePrediction(p, m)} |`);
      }
      L.push('');
    }

    L.push('## The named falsifiers');
    L.push('');
    // DERIVED from each arm's own emitted edge census, never transcribed — a
    // falsifier whose precondition is a hand-copied number is a falsifier that
    // can drift away from the arm it is supposed to constrain.
    const censusOf = (a: 'F' | 'G'): Record<string, number> =>
      (JSON.parse(readFileSync(resolve(OUT, a === 'F' ? 'step3-armf.json' : 'step4-armg.json'), 'utf-8')) as
        { edgeCensus: Record<string, number> }).edgeCensus;
    const censusF = censusOf('F'), censusG = censusOf('G');
    const internalEdges = (c: Record<string, number>): number =>
      Object.entries(c).reduce((n, [k, v]) => n + (k === 'corpus-end' ? 0 : v), 0);
    // Substitutable = every internal edge that is NOT a run edge (a run edge is
    // not estimate-derived in any arm, so it was never a candidate).
    const substitutableF = internalEdges(censusF) - (censusF['excision-run-edge'] ?? 0);
    const subF = (censusF.anchor ?? 0) / internalEdges(censusF);
    const subFOfSubstitutable = (censusF.anchor ?? 0) / substitutableF;
    const subG = (censusG.attested ?? 0) / internalEdges(censusG);
    const subGOfSubstitutable = (censusG.attested ?? 0)
      / (internalEdges(censusG) - (censusG['excision-run-edge'] ?? 0));
    const firedF = peakAbsOf.F! >= FALSIFIER_F.firesAtOrAbove && subF >= FALSIFIER_F.requiresSubstitutionAtLeast;
    const firedG = peakAbsOf.G! >= FALSIFIER_G.firesAtOrAbove
      && subGOfSubstitutable >= FALSIFIER_G.requiresSubstitutionAtLeast;
    L.push(`**Arm F.** _${FALSIFIER_F.statement}_`);
    L.push('');
    L.push(`- MEASURED peak: ${peakAbsOf.F!.toFixed(3)}s (fires at >= ${FALSIFIER_F.firesAtOrAbove}s).`);
    L.push(`- MEASURED substitution: ${censusF.anchor ?? 0} of ${internalEdges(censusF)} internal edges = `
      + `**${(100 * subF).toFixed(1)}%** (precondition >= ${(100 * FALSIFIER_F.requiresSubstitutionAtLeast).toFixed(1)}%); `
      + `${(100 * subFOfSubstitutable).toFixed(1)}% of the ${substitutableF} substitutable ones. Derived from arm F's `
      + `own emitted edge census \`${JSON.stringify(censusF)}\`, not transcribed.`);
    L.push(`- **DID IT FIRE? ${firedF ? 'YES' : 'NO'}.**`);
    L.push('');
    L.push(`**Arm G.** _${FALSIFIER_G.statement}_`);
    L.push('');
    L.push(`- MEASURED peak: ${peakAbsOf.G!.toFixed(3)}s (fires at >= ${FALSIFIER_G.firesAtOrAbove}s).`);
    L.push(`- MEASURED substitution: ${censusG.attested ?? 0} of ${internalEdges(censusG) - (censusG['excision-run-edge'] ?? 0)} `
      + `substitutable edges = **${(100 * subGOfSubstitutable).toFixed(1)}%** (precondition `
      + `${(100 * FALSIFIER_G.requiresSubstitutionAtLeast).toFixed(1)}%); ${(100 * subG).toFixed(1)}% of all `
      + `${internalEdges(censusG)} internal edges. Derived from arm G's own emitted edge census `
      + `\`${JSON.stringify(censusG)}\`, not transcribed.`);
    L.push(`- **DID IT FIRE? ${firedG ? 'YES' : 'NO'}.**`);
    L.push('');

    // ================= STEP 6: THE PRE-COMMITTED ADJUDICATION ================
    const ruling = adjudicate(verdictF, verdictG);
    L.push('## Step 6 — adjudication, applying the pre-committed conclusion VERBATIM');
    L.push('');
    L.push(`| arm | peak abs mean decile Δ | **arch verdict** |`);
    L.push('|---|---|---|');
    L.push(`| F | ${peakAbsOf.F!.toFixed(3)}s | **${verdictF}** |`);
    L.push(`| G | ${peakAbsOf.G!.toFixed(3)}s | **${verdictG}** |`);
    L.push('');
    L.push(`**Outcome row selected: _${ruling.outcome}_.**`);
    L.push('');
    L.push(`**CONCLUSION, quoted verbatim from the Step 1 gate's table:**`);
    L.push('');
    L.push(`> ${ruling.conclusion}`);
    L.push('');

    json.armChunks = Object.fromEntries(ARMS.map(a => [a, arms[a].chunks.length]));
    json.armCommitted = Object.fromEntries(ARMS.map(a => [a, arms[a].run.committed.length]));
    json.oracleDiff = diffJson;
    json.controls = { byArm: ctlJson, armBRegressionRows: ctlRows, attributionF: attribF, attributionG: attribG };
    json.drift = driftJson;
    json.driftShapes = { shapes, peakAbs: peakAbsOf, r: rOf, estimate: eShape };
    json.archVerdicts = { F: verdictF, G: verdictG };
    json.openDefects = defectJson;
    json.knownBad = kbJson;
    json.phantomFunnel = funnelJson;
    json.rules = ruleJson;
    json.ruleDependent = rdJson;
    json.ruleDependent173NotMeasurable = ['iron_bounce', 'logic_clash'];
    json.resources = resJson;
    json.precision = precision;
    json.predictions = { F: { predicted: PREDICTIONS_F, measured: measuredF }, G: { predicted: PREDICTIONS_G, measured: measuredG } };
    json.falsifiers = { F: { ...FALSIFIER_F, fired: firedF }, G: { ...FALSIFIER_G, fired: firedG } };
    json.gateVerdictF = { pass: gateF, hardFail1: hf1('F'), hardFail2: hf2('F'), defectsLanded: landed('F'), impliedPrecision: pF, regressions: fReg };
    json.adjudication = { verdictF, verdictG, ...ruling };
    json.gate = AM_GATE;
    json.armCRegressionsReference = ARM_C_V6_REGRESSIONS;

    writeFileSync(resolve(OUT, 'step5-measure.md'), `${L.join('\n')}\n`);
    writeFileSync(resolve(DOCS, 'session-am-six-arm-measurement.md'), `${L.join('\n')}\n`);
    writeFileSync(resolve(OUT, 'step5-measure.json'), JSON.stringify(json, null, 2));
    // eslint-disable-next-line no-console
    console.log(L.join('\n'));
  }, 900_000);
});
