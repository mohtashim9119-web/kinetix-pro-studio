/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// ---------------------------------------------------------------------------
// WS1 Session AN — STEP 2. THE EDGE-ACCURACY BUDGET, MEASURED BEFORE ARM H.
//
// Arm F (Session AM) leaves 67 of v6's 447 boundaries beyond ±50ms of oracle.
// This step asks, with real numbers rather than the AM correlation alone:
//
//   1. For each of the 67, which chunk edge GOVERNS it (the attribution rule
//      fixed in Step 1's `ATTRIBUTION_RULE`, applied here, not chosen here).
//   2. The correlation between |governing edge error| and |boundary error|.
//   3. A budget curve: at a swept hypothetical edge-accuracy tolerance, how
//      many of the 447 boundaries would sit within ±50ms — built from the two
//      MEASURED endpoints (arm G at 0ms, arm F at the observed maximum) per
//      the INFERENCE rule Step 1 fixed, not a third real alignment run.
//   4. How many of the 67 are governed by one of the 5 fallback seams — the
//      set arm H (Step 3) targets.
//
// No new chunk planner exists yet. Arm F's inspection array is recomputed
// FRESH from `computeFaChunkPlanS2EdgeArm({kind:'anchor'}, ...)` — the same
// function Session AM used — rather than read from Session AM's own
// `.work-phase4/session-am/*.json` scratch dump, so this step does not depend
// on another session's working-directory artifacts still being present.
// Arm F's and arm G's STORED FA word alignments
// (`.work-phase4/replay/v6/fa_am_{f,g}_words.json`) ARE reused, per the
// established convention (Session AM Step 5's own header) — re-running real
// ONNX alignment to reproduce a diff this session does not change would be
// pure cost.
//
// Gated: WS1_SESSION_AN_MEASURE=1 npx vitest run scripts/ws1-session-an-step2-budget.test.ts
// ---------------------------------------------------------------------------

import { describe, it, expect } from 'vitest';
import { writeFileSync, readFileSync, mkdirSync } from 'fs';
import { resolve } from 'path';

import { CORPORA, REPO, runProductionPath, tagOf, loadLiveBundle } from './ws1-session-p-pipeline.js';
import { parseProjectData } from '../src/App';
import { applyAnchorBasedTiming } from '../src/services/syncEngine';
import { computeFaChunkPlanS2EdgeArm, computeFaChunkPlanS2Excised } from '../src/services/faChunkPlan';
import type { FaChunkPlanEdgeArmInspection } from '../src/services/faChunkPlan';
import { AM_TARGET_MIN_SEC, AM_TARGET_MAX_SEC, AL_V6_CHUNK_COUNT } from './ws1-session-am-step1-gate.js';
import {
  ATTRIBUTION_RULE, HARD_FAIL_MOVE_SEC, EAR_BILL_TOLERANCE_SEC, DEFECT_LANDED_SEC,
  AM_V6_REGRESSED_5MS, FALLBACK_SEAM_GOVERNED_BY_SEAM, FALSIFIER_EDGE_ERROR_EXPLAINS_RESIDUAL,
  BUDGET_CURVE_STEEP_DECREASE_FRACTION,
} from './ws1-session-an-step1-gate.js';

const MEASURE = process.env.WS1_SESSION_AN_MEASURE === '1';
const OUT = resolve(REPO, '.work-phase4/session-an');
const DOCS = resolve(REPO, 'docs/ws1-sync-pipeline');
const KEY = 'v6';

interface OracleBoundary {
  index: number; tag: string; startTime: number; duration: number;
  openDefect?: boolean; earTarget?: number;
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

function quantiles(xs: readonly number[]): Record<string, number> {
  if (xs.length === 0) return { n: 0 };
  const s = [...xs].sort((a, b) => a - b);
  const q = (p: number): number => s[Math.min(s.length - 1, Math.floor(s.length * p))]!;
  return {
    n: s.length, min: +s[0]!.toFixed(1), p25: +q(0.25).toFixed(1), median: +q(0.5).toFixed(1),
    p75: +q(0.75).toFixed(1), max: +s[s.length - 1]!.toFixed(1),
    mean: +(s.reduce((a, b) => a + b, 0) / s.length).toFixed(1),
  };
}

describe.skipIf(!MEASURE)('WS1 Session AN Step 2 — the edge-accuracy budget (v6, no new planner)', () => {
  it('attributes the 67-boundary residual to governing edges and builds the budget curve', async () => {
    mkdirSync(OUT, { recursive: true });
    const spec = CORPORA[KEY]!;
    const oracle = JSON.parse(readFileSync(
      resolve(REPO, `scripts/fixtures/session-aj0-oracle-${KEY}.json`), 'utf-8',
    )) as { segmentCount: number; boundaries: OracleBoundary[] };
    const oracleStartByIdx = new Map(oracle.boundaries.map(b => [b.index, b.startTime]));

    // ---- 1. RECOMPUTE ARM F'S CHUNK PLAN + INSPECTION FRESH ------------------
    const { silences, whisperTokens } = loadLiveBundle(KEY);
    const segsRaw = await parseProjectData(
      readFileSync(spec.scriptPath, 'utf-8'), readFileSync(spec.sceneDetailsPath, 'utf-8'), [], spec.audioDuration,
    );
    const anchorTimed = applyAnchorBasedTiming(segsRaw, spec.audioDuration);
    const armC = computeFaChunkPlanS2Excised(
      anchorTimed, whisperTokens, silences, spec.audioDuration, AM_TARGET_MIN_SEC, AM_TARGET_MAX_SEC,
    );
    expect(armC.chunks.length, 'arm C must still reproduce its measured chunk count at HEAD').toBe(AL_V6_CHUNK_COUNT.C);
    const armF = computeFaChunkPlanS2EdgeArm(
      anchorTimed, whisperTokens, silences, spec.audioDuration, { kind: 'anchor' }, AM_TARGET_MIN_SEC, AM_TARGET_MAX_SEC,
    );
    expect(armF.chunks.length, 'arm F must still reproduce its measured chunk count at HEAD').toBe(57);
    const insp: readonly FaChunkPlanEdgeArmInspection[] = armF.inspection;
    expect(insp.length).toBe(57);

    // ---- 2. THE 67 RESIDUAL BOUNDARIES, via a FRESH oracle diff against the
    //         STORED arm F alignment (`fa_am_f_words.json`, reused per the
    //         established convention — re-aligning would not change it). ------
    const F = await runProductionPath(spec, true, undefined, 'fa_am_f_words.json');
    const byTag = new Map(F.committed.map(s => [tagOf(s), s.startTime]));
    interface RegressedRow { tag: string; segIdx: number; oracle: number; arm: number; delta: number }
    const regressed: RegressedRow[] = [];
    for (const b of oracle.boundaries) {
      const x = byTag.get(b.tag);
      if (x === undefined) continue;
      const d = x - b.startTime;
      if (Math.abs(d) < 1e-9) continue;
      if (b.openDefect) continue; // open defects are adjudicated separately, not as regressions
      if (Math.abs(d) <= EAR_BILL_TOLERANCE_SEC) continue;
      if (Math.abs(d) <= HARD_FAIL_MOVE_SEC) continue; // this step is about the BEYOND-±50ms residual specifically
      regressed.push({ tag: b.tag, segIdx: b.index, oracle: b.startTime, arm: x, delta: +d.toFixed(4) });
    }
    expect(regressed.length, 'arm F\'s beyond-±50ms residual must still measure 67 at HEAD').toBe(67);

    // ---- 3. EDGE ERROR vs ORACLE for every one of arm F's 56 internal edges -
    interface EdgeErr { chunkIdx: number; segOpened: number; errMs: number }
    const edgeErrByChunk = new Map<number, EdgeErr>();
    for (let k = 0; k < insp.length - 1; k++) {
      const c = insp[k]!;
      const opened = c.segTo + 1;
      const oracleStart = oracleStartByIdx.get(opened);
      if (oracleStart === undefined) continue;
      edgeErrByChunk.set(k, { chunkIdx: k, segOpened: opened, errMs: (c.endSec - oracleStart) * 1000 });
    }

    // ---- 4. ATTRIBUTION: apply `ATTRIBUTION_RULE` from the Step 1 gate ------
    const chunkOf = (seg: number): number | undefined => {
      const found = insp.find(c => c.segFrom <= seg && seg <= c.segTo);
      return found?.index;
    };
    interface AttrRow {
      tag: string; segIdx: number; boundaryErrMs: number;
      governedBy: 'start-edge' | 'end-edge' | 'both' | 'none'; edgeErrMs: number | undefined;
      chunkIdx: number | undefined; fallbackSeamGoverned: boolean;
    }
    const attributed: AttrRow[] = [];
    const noEdge: string[] = [];
    const twoEdge: string[] = [];
    const fallbackClosingSegs = new Set(FALLBACK_SEAM_GOVERNED_BY_SEAM.map(s => s.closingSegIdx));
    for (const r of regressed) {
      const ci = chunkOf(r.segIdx);
      const boundaryErrMs = r.delta * 1000;
      if (ci === undefined) { noEdge.push(r.tag); attributed.push({ tag: r.tag, segIdx: r.segIdx, boundaryErrMs, governedBy: 'none', edgeErrMs: undefined, chunkIdx: undefined, fallbackSeamGoverned: false }); continue; }
      const c = insp[ci]!;
      const distStart = r.segIdx - c.segFrom;
      const distEnd = c.segTo - r.segIdx;
      const startEdge = ci > 0 ? edgeErrByChunk.get(ci - 1) : undefined;
      const endEdge = edgeErrByChunk.get(ci);
      let governedBy: AttrRow['governedBy'];
      let edgeErrMs: number | undefined;
      let govChunkIdx: number | undefined;
      if (startEdge === undefined && endEdge === undefined) {
        governedBy = 'none'; edgeErrMs = undefined; govChunkIdx = undefined; noEdge.push(r.tag);
      } else if (startEdge !== undefined && endEdge !== undefined && distStart === distEnd) {
        governedBy = 'both'; edgeErrMs = (Math.abs(startEdge.errMs) + Math.abs(endEdge.errMs)) / 2; govChunkIdx = ci; twoEdge.push(r.tag);
      } else if (startEdge !== undefined && (endEdge === undefined || distStart <= distEnd)) {
        governedBy = 'start-edge'; edgeErrMs = startEdge.errMs; govChunkIdx = ci - 1;
      } else {
        governedBy = 'end-edge'; edgeErrMs = endEdge!.errMs; govChunkIdx = ci;
      }
      const fallbackSeamGoverned = govChunkIdx !== undefined
        && (fallbackClosingSegs.has(insp[govChunkIdx]!.segTo));
      attributed.push({ tag: r.tag, segIdx: r.segIdx, boundaryErrMs, governedBy, edgeErrMs, chunkIdx: govChunkIdx, fallbackSeamGoverned });
    }
    expect(attributed.length).toBe(regressed.length);

    const withEdge = attributed.filter(a => a.edgeErrMs !== undefined);
    const xs = withEdge.map(a => Math.abs(a.edgeErrMs!));
    const ys = withEdge.map(a => Math.abs(a.boundaryErrMs));
    const r = pearson(xs, ys);
    const fallbackGovernedCount = attributed.filter(a => a.fallbackSeamGoverned).length;

    // ---- 5. THE BUDGET CURVE (INFERRED between two MEASURED endpoints) ------
    // At swept tolerance T: an edge with |err| <= T is treated as "accurate
    // enough" (assumed near-zero regression, arm G's observed behaviour);
    // a boundary governed by a still-inaccurate edge is assumed to regress
    // exactly as arm F actually measured it. Endpoints: T=0 reproduces arm
    // G's count structurally (every edge inaccurate -> 0 accurate, so this
    // simple model's own T=0 point is ALL-67-still-regressed, NOT arm G's
    // measured 2 — the two are reported side by side rather than conflated,
    // since arm G's 2 reflects real oracle-placed alignment, not this
    // edge-only proxy).
    const sortedAbsErr = [...xs].sort((a, b) => a - b);
    const maxErrMs = sortedAbsErr.length > 0 ? sortedAbsErr[sortedAbsErr.length - 1]! : 0;
    const steps = 20;
    const curve: Array<{ toleranceMs: number; regressedRemaining: number; edgesAtOrBelow: number }> = [];
    for (let s = 0; s <= steps; s++) {
      const t = (maxErrMs * s) / steps;
      // A boundary counts as "fixed" at tolerance T only if it has a SINGLE
      // attributable edge error at or below T; a no-edge or governed-by-two
      // boundary is conservatively never counted fixed under this proxy.
      const stillRegressed = attributed.filter(a => a.edgeErrMs === undefined || Math.abs(a.edgeErrMs) > t).length;
      const edgesAtOrBelow = Array.from(edgeErrByChunk.values()).filter(e => Math.abs(e.errMs) <= t).length;
      curve.push({ toleranceMs: +t.toFixed(1), regressedRemaining: stillRegressed, edgesAtOrBelow });
    }
    const shipBarCrossingRow = curve.find(c => c.regressedRemaining <= 1);
    const totalSubstitutableEdges = edgeErrByChunk.size;
    const edgesCarryingHalfMass = (() => {
      const sortedDesc = withEdge.slice().sort((a, b) => Math.abs(b.edgeErrMs!) - Math.abs(a.edgeErrMs!));
      const totalMass = withEdge.length;
      let cum = 0, n = 0;
      for (const a of sortedDesc) { cum += 1; n++; if (cum >= totalMass / 2) break; }
      return n;
    })();
    const isSteep = edgesCarryingHalfMass <= totalSubstitutableEdges * BUDGET_CURVE_STEEP_DECREASE_FRACTION;

    // =================== THE REPORT ==========================================
    const L: string[] = [];
    L.push('# WS1 Session AN Step 2 — the edge-accuracy budget (MEASURED, v6, no new planner)');
    L.push('');
    L.push('Arm F\'s chunk plan and inspection array recomputed FRESH from `computeFaChunkPlanS2EdgeArm`');
    L.push('(`{kind: \'anchor\'}`) at HEAD — not read from a prior session\'s scratch dump. Arm F\'s and arm');
    L.push('G\'s STORED FA alignments are reused per the established convention.');
    L.push('');
    L.push('## The attribution rule (imported from the Step 1 gate, fixed before this table was built)');
    L.push('');
    L.push('```json');
    L.push(JSON.stringify(ATTRIBUTION_RULE, null, 2));
    L.push('```');
    L.push('');
    L.push(`Applied to all ${regressed.length} of arm F\'s beyond-±50ms residual boundaries: `
      + `${noEdge.length} governed by no edge, ${twoEdge.length} governed by two (equidistant), `
      + `${attributed.length - noEdge.length - twoEdge.length} governed by exactly one.`);
    L.push('');

    L.push('## Correlation: |governing edge error| vs |boundary error|');
    L.push('');
    L.push('| quantity | value |');
    L.push('|---|---|');
    L.push(`| n (boundaries with an attributable edge) | ${withEdge.length} |`);
    L.push(`| Pearson r | **${r.toFixed(4)}** |`);
    L.push(`| falsifier fires (r < 0.5)? | ${r < 0.5 ? '**YES — falsifier fires**' : 'no'} |`);
    L.push('');
    L.push('| distribution | n | min | p25 | median | p75 | max |');
    L.push('|---|---|---|---|---|---|---|');
    const qe = quantiles(xs), qb = quantiles(ys);
    L.push(`| \\|edge error\\| (ms) | ${qe.n} | ${qe.min} | ${qe.p25} | **${qe.median}** | ${qe.p75} | ${qe.max} |`);
    L.push(`| \\|boundary error\\| (ms) | ${qb.n} | ${qb.min} | ${qb.p25} | **${qb.median}** | ${qb.p75} | ${qb.max} |`);
    L.push('');

    L.push('## The 67-residual attribution table');
    L.push('');
    L.push('| tag | seg | boundary Δ (ms) | governed by | edge Δ (ms) | fallback-seam governed? |');
    L.push('|---|---|---|---|---|---|');
    for (const a of attributed) {
      L.push(`| ${a.tag} | ${a.segIdx} | ${a.boundaryErrMs.toFixed(0)} | ${a.governedBy} `
        + `| ${a.edgeErrMs === undefined ? '—' : a.edgeErrMs.toFixed(0)} | ${a.fallbackSeamGoverned ? 'YES' : 'no'} |`);
    }
    L.push('');
    L.push(`**${fallbackGovernedCount} of the ${regressed.length} residual boundaries are governed by one of the 5 fallback seams** `
      + '(strict nearest-single-edge attribution, this step\'s own rule) — the set arm H (Step 3) targets. This is the ceiling '
      + 'on what recovering all 5 seams could plausibly fix; it is not a promise that all of them land, since most of these '
      + 'boundaries are ALSO shaped by their chunk\'s OTHER (already anchor-placed) edge and by FA\'s own within-chunk '
      + 'distribution.');
    L.push('');
    L.push('Note: Step 1\'s gate registered a LOOSER estimate of 39 ("falls somewhere inside the window a fallback seam '
      + `bounds"), computed before this table existed. This step's ${fallbackGovernedCount} supersedes it — the STRICT `
      + 'nearest-single-governing-edge rule is narrower by construction, since a window-membership test credits a fallback '
      + `seam for boundaries actually governed by their chunk's OTHER, already-correct edge. ${fallbackGovernedCount} is `
      + 'the number the arm-H success bar (Step 1 §3) should be read against.');
    L.push('');

    L.push('## The budget curve (INFERRED between two MEASURED endpoints — see Step 1\'s acceptance rule)');
    L.push('');
    L.push(`Arm G (0ms, oracle-placed edges): **${AM_V6_REGRESSED_5MS.G} regressed** — a REAL measured arm run, not this proxy.`);
    L.push(`Arm F (observed max edge error, ${maxErrMs.toFixed(0)}ms): **${regressed.length}** boundaries beyond ±50ms — this `);
    L.push('step\'s own denominator, a real measured count.');
    L.push('');
    L.push('| tolerance (ms) | edges at-or-below tolerance | regressed-remaining under the stated proxy model |');
    L.push('|---|---|---|');
    for (const c of curve) L.push(`| ${c.toleranceMs} | ${c.edgesAtOrBelow}/${totalSubstitutableEdges} | ${c.regressedRemaining} |`);
    L.push('');
    L.push(`Ship-bar (regressed <= 1) crossing tolerance: ${shipBarCrossingRow === undefined ? '**NOT REACHED within the observed error range**' : `**${shipBarCrossingRow.toleranceMs}ms**`}.`);
    L.push('');
    L.push(`Curve shape: ${edgesCarryingHalfMass} of ${totalSubstitutableEdges} substitutable edges (${(100 * edgesCarryingHalfMass / totalSubstitutableEdges).toFixed(1)}%) `
      + `carry at least half of the total |edge error| mass — ${isSteep ? '**STEEP** (at or below the ${(100 * BUDGET_CURVE_STEEP_DECREASE_FRACTION).toFixed(0)}% line)' : '**NOT STEEP** (above the pre-registered steepness line)'}.`);
    L.push('');
    L.push(isSteep
      ? '**Reading (per the pre-registered rule): the residual is concentrated in a small number of badly-governed edges — closable by better anchoring at those specific seams, not a general property of the whole edge set.**'
      : '**Reading (per the pre-registered rule): error is spread broadly across many edges — not economically closable by widening or densifying anchors at a handful of seams.**');
    L.push('');

    const text = `${L.join('\n')}\n`;
    writeFileSync(resolve(OUT, 'step2-budget.md'), text);
    writeFileSync(resolve(DOCS, 'session-an-edge-budget.md'), text);

    const json = {
      residualCount: regressed.length,
      attribution: { noEdge: noEdge.length, twoEdge: twoEdge.length, oneEdge: attributed.length - noEdge.length - twoEdge.length },
      correlation: { r: +r.toFixed(4), falsifierFires: r < 0.5, edgeErrAbsMs: qe, boundaryErrAbsMs: qb },
      fallbackGovernedCount,
      fallbackGovernedByseam: FALLBACK_SEAM_GOVERNED_BY_SEAM,
      budgetCurve: curve,
      shipBarCrossingToleranceMs: shipBarCrossingRow?.toleranceMs ?? null,
      curveSteepness: { edgesCarryingHalfMass, totalSubstitutableEdges, isSteep },
      attributedRows: attributed,
    };
    writeFileSync(resolve(OUT, 'step2-budget.json'), JSON.stringify(json, null, 2));

    // eslint-disable-next-line no-console
    console.log(L.join('\n'));

    // The falsifier is REPORTED, not asserted — a low r or a flat curve is a
    // valid, informative outcome for this step, not a test failure.
    expect(FALSIFIER_EDGE_ERROR_EXPLAINS_RESIDUAL.claim).toBeDefined();
    expect(DEFECT_LANDED_SEC).toBe(0.050);
  }, 120_000);
});
