/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// ---------------------------------------------------------------------------
// WS1 Session AK — STEPS 4 AND 5. THE THREE-ARM ABLATION.
//
//   A — production baseline at HEAD (today's planner, each corpus's DEFAULT
//       stamped arm — which for 173 is now `fa_ah_*`, repointed in Step 0).
//   B — global S2, NO R.5 excision (`fa_ai_words.json`, Session AI's arm).
//   C — global S2 WITH R.5 excision (`fa_ak_words.json`, this session's arm).
//
// Same commit, same inputs, same run, all three corpora. Every boundary is
// machine-adjudicable against the AJ-0 live-export oracle, so nothing here
// needs a listening pass.
//
// THE GATE IS IMPORTED, NEVER RESTATED. `ws1-session-ak-step1-gate.ts` was
// committed before any arm ran (R-AS applied prospectively). This file reports
// itself against those constants; it does not define them.
//
// Gated: WS1_SESSION_AK_MEASURE=1 npx vitest run scripts/ws1-session-ak-step4-measure.test.ts
// ---------------------------------------------------------------------------

import { describe, it, expect } from 'vitest';
import { writeFileSync, readFileSync, mkdirSync, existsSync } from 'fs';
import { resolve } from 'path';

import { CORPORA, runProductionPath, tagOf, REPO, REPLAY_ROOT } from './ws1-session-p-pipeline.js';
import type { FaChunk } from '../src/services/faChunkPlan';
import { CONF_MIN_FALLBACK } from '../src/services/syncConstants';
import {
  earVerifiedControls, S1_KNOWN_BAD_MOVES, EAR_PIN_TOLERANCE_SEC,
} from './ws1-ear-pass-ledger.js';
import type { Corpus } from './ws1-ear-pass-ledger.js';
import {
  GATE, OPEN_DEFECTS, PREDICTIONS, STOP_CONDITION, HARD_FAIL_MOVE_SEC, DEFECT_LANDED_SEC,
  EAR_BILL_TOLERANCE_SEC, KNOWN_BAD_MATCH_SEC,
} from './ws1-session-ak-step1-gate.js';
import type { TranscriptToken } from '../src/types';
import type { SilenceInterval } from '../src/services/silenceDetector';

const MEASURE = process.env.WS1_SESSION_AK_MEASURE === '1';
const OUT = resolve(REPO, '.work-phase4/session-ak');
const CORPORA_KEYS = ['v6', '173', 'spanish'] as const;

type ProductionRun = Awaited<ReturnType<typeof runProductionPath>>;
type ArmName = 'A' | 'B' | 'C';

interface OracleBoundary {
  index: number; tag: string; startTime: number; duration: number;
  openDefect?: boolean; earTarget?: number; knownMicroDrift?: string;
}
const loadOracle = (key: string): { segmentCount: number; boundaries: OracleBoundary[] } =>
  JSON.parse(readFileSync(resolve(REPO, `scripts/fixtures/session-aj0-oracle-${key}.json`), 'utf-8'));

const confOf = (t: TranscriptToken | undefined): number =>
  t === undefined ? 0 : ((t as { confidence?: number }).confidence ?? 0);

function isPhantom(t: TranscriptToken, silences: readonly SilenceInterval[]): boolean {
  if (confOf(t) >= CONF_MIN_FALLBACK) return false;
  return silences.some(s => s.startSec <= t.startSec && t.endSec <= s.endSec);
}

/** The AG/AI phantom-tail funnel, definitions unchanged. */
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

/** Chunk-length distribution, reported per arm. */
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

describe.skipIf(!MEASURE)('WS1 Session AK Steps 4-5 — three-arm ablation', () => {
  it('runs A/B/C on all three corpora and reports every required table', async () => {
    mkdirSync(OUT, { recursive: true });
    const L: string[] = [];
    const json: Record<string, unknown> = {};

    L.push('# WS1 Session AK Steps 4-5 — three-arm ablation (MEASURED)');
    L.push('');
    L.push('## The pre-registered gate (imported verbatim from `ws1-session-ak-step1-gate.ts`)');
    L.push('');
    L.push('```json');
    L.push(JSON.stringify(GATE, null, 2));
    L.push('```');
    L.push('');
    L.push(`**Stop condition.** ${STOP_CONDITION}`);
    L.push('');

    const controls = earVerifiedControls();
    const wall: Record<string, unknown> = existsSync(resolve(OUT, 'fa-run-resources.json'))
      ? JSON.parse(readFileSync(resolve(OUT, 'fa-run-resources.json'), 'utf-8'))
      : {};

    for (const key of CORPORA_KEYS) {
      const spec = CORPORA[key]!;
      const oracle = loadOracle(key);
      const oracleByTag = new Map(oracle.boundaries.map(b => [b.tag, b]));

      const A = await runProductionPath(spec);
      const B = await runProductionPath(spec, true, undefined, 'fa_ai_words.json');
      const C = await runProductionPath(spec, true, undefined, 'fa_ak_words.json');
      const planOf = (f: string): FaChunk[] =>
        (JSON.parse(readFileSync(resolve(REPLAY_ROOT, key, f), 'utf-8')) as { chunks: FaChunk[] }).chunks;
      const chunksA = A.chunks;
      const chunksB = planOf('fa_ai_chunks.json');
      const chunksC = planOf('fa_ak_chunks.json');

      const arms: Record<ArmName, { run: ProductionRun; chunks: readonly FaChunk[] }> = {
        A: { run: A, chunks: chunksA }, B: { run: B, chunks: chunksB }, C: { run: C, chunks: chunksC },
      };
      const byTag = (r: ProductionRun): Map<string, number> =>
        new Map(r.committed.map(s => [tagOf(s), s.startTime]));
      const vA = byTag(A), vB = byTag(B), vC = byTag(C);

      // THE STRUCTURAL-NULL CHECK. On a corpus with zero R.5 runs the arm-C
      // PLAN is byte-identical to arm B's (Step 3 measured this), so a
      // deterministic aligner must return byte-identical WORDS. Checking the
      // words rather than inferring them from the plan is what turns the
      // pre-registered prediction into a measurement — and it doubles as an
      // empirical check on the `with_deterministic_compute(true)` pinning.
      const wordsOf = (f: string): Array<{ word: string; startSec: number; endSec: number; confidence: number }> =>
        (JSON.parse(readFileSync(resolve(REPLAY_ROOT, key, f), 'utf-8')) as {
          words: Array<{ word: string; startSec: number; endSec: number; confidence: number }>;
        }).words;
      const wB = wordsOf('fa_ai_words.json');
      const wC = wordsOf('fa_ak_words.json');
      const wordsIdentical = wB.length === wC.length && wB.every((w, i) =>
        w.word === wC[i]!.word && w.startSec === wC[i]!.startSec
        && w.endSec === wC[i]!.endSec && w.confidence === wC[i]!.confidence);
      const planIdentical = chunksB.length === chunksC.length && chunksB.every((c, i) =>
        c.startSec === chunksC[i]!.startSec && c.endSec === chunksC[i]!.endSec && c.text === chunksC[i]!.text);

      L.push(`# ${key}`);
      L.push('');
      L.push(`- R.5 runs on this corpus: **${A.r5runs.length}**`);
      L.push(`- arm B vs arm C **chunk plan** byte-identical: **${planIdentical ? 'YES' : 'no'}** `
        + `| **FA words** byte-identical: **${wordsIdentical ? 'YES' : 'no'}** (${wB.length} vs ${wC.length} words)`);
      if (A.r5runs.length === 0) {
        expect(planIdentical, `${key}: zero R.5 runs must leave the plan untouched`).toBe(true);
        expect(wordsIdentical, `${key}: identical plan through a deterministic aligner must give identical words`).toBe(true);
      }
      L.push('');
      L.push('| arm | chunks | committed | rules fired |');
      L.push('|---|---|---|---|');
      for (const a of ['A', 'B', 'C'] as const) {
        L.push(`| ${a} | ${arms[a].chunks.length} | ${arms[a].run.committed.length} | \`${JSON.stringify(arms[a].run.fired)}\` |`);
      }
      L.push('');

      // ================= STEP 5: FULL ORACLE DIFF PER ARM ==================
      L.push('## Oracle diff per arm (every moved boundary in exactly one category)');
      L.push('');
      L.push('| arm | compared | unchanged | repaired | regressed | unadjudicable | moved total |');
      L.push('|---|---|---|---|---|---|---|');
      const diffJson: Record<string, unknown> = {};
      for (const a of ['A', 'B', 'C'] as const) {
        const vals = a === 'A' ? vA : a === 'B' ? vB : vC;
        let unchanged = 0, repaired = 0, regressed = 0, unadj = 0;
        const unadjReasons: Record<string, number> = {};
        const regressedRows: Array<Record<string, unknown>> = [];
        const repairedRows: Array<Record<string, unknown>> = [];
        for (const b of oracle.boundaries) {
          const v = vals.get(b.tag);
          if (v === undefined) { unadj++; unadjReasons['absent-from-arm'] = (unadjReasons['absent-from-arm'] ?? 0) + 1; continue; }
          const d = v - b.startTime;
          if (Math.abs(d) < 1e-9) { unchanged++; continue; }
          if (b.openDefect) {
            if (b.earTarget !== undefined && Math.abs(v - b.earTarget) <= DEFECT_LANDED_SEC) {
              repaired++; repairedRows.push({ tag: b.tag, oracle: b.startTime, arm: v, ear: b.earTarget });
            } else {
              unadj++; unadjReasons['open-defect-moved-without-landing'] = (unadjReasons['open-defect-moved-without-landing'] ?? 0) + 1;
            }
            continue;
          }
          // Spanish has no operator full pass — out of register (Step 0 scoping).
          if (key === 'spanish') { unadj++; unadjReasons['spanish-out-of-register'] = (unadjReasons['spanish-out-of-register'] ?? 0) + 1; continue; }
          if (Math.abs(d) <= EAR_BILL_TOLERANCE_SEC) {
            unadj++; unadjReasons['within-ledger-pin-tolerance'] = (unadjReasons['within-ledger-pin-tolerance'] ?? 0) + 1; continue;
          }
          regressed++;
          regressedRows.push({ tag: b.tag, oracle: b.startTime, arm: v, delta: +d.toFixed(4), beyondHardFail: Math.abs(d) > HARD_FAIL_MOVE_SEC });
        }
        const moved = repaired + regressed + unadj;
        expect(unchanged + moved, `${key}/${a}: categories must sum to the compared total`).toBe(oracle.boundaries.length);
        L.push(`| ${a} | ${oracle.boundaries.length} | ${unchanged} | **${repaired}** | **${regressed}** | ${unadj} | ${moved} |`);
        diffJson[a] = { unchanged, repaired, regressed, unadjudicable: unadj, unadjReasons, moved, regressedRows, repairedRows };
      }
      L.push('');
      for (const a of ['A', 'B', 'C'] as const) {
        const d = diffJson[a] as { unadjReasons: Record<string, number>; regressedRows: unknown[] };
        L.push(`- arm ${a} unadjudicable breakdown: \`${JSON.stringify(d.unadjReasons)}\``);
      }
      L.push('');

      // Hard-fail check.
      for (const a of ['A', 'B', 'C'] as const) {
        const d = diffJson[a] as { regressedRows: Array<{ beyondHardFail: boolean }> };
        const beyond = d.regressedRows.filter(r => r.beyondHardFail).length;
        L.push(`- **arm ${a}: attested-correct boundaries moved beyond ±${HARD_FAIL_MOVE_SEC * 1000}ms — ${beyond}** `
          + `(${beyond === 0 ? 'HARD FAIL 1 clear' : '**HARD FAIL 1 TRIPPED**'})`);
      }
      L.push('');

      // ================= STEP 4: ARM-B CONTROL REGRESSIONS =================
      const ctlTags = controls.filter(c => c.corpus === (key as Corpus)).map(c => c.tag);
      const bRegressions = ctlTags.filter(t => {
        const a = vA.get(t), b = vB.get(t);
        return a !== undefined && b !== undefined && Math.abs(a - b) >= 1e-9;
      });
      L.push(`## Step 4 — arm-B ear-verified control regressions, and their arm-C status`);
      L.push('');
      L.push(`- ear-verified controls in this corpus: **${ctlTags.length}**`);
      L.push(`- of which arm B moves off the arm-A value: **${bRegressions.length}**`);
      L.push('');
      const attrib = { repaired: 0, unchanged: 0, worsened: 0, partial: 0 };
      const attribRows: Array<Record<string, unknown>> = [];
      if (bRegressions.length > 0) {
        L.push('| tag | arm A | arm B | arm C | |B-A| | |C-A| | arm-C status |');
        L.push('|---|---|---|---|---|---|---|');
        for (const t of bRegressions) {
          const a = vA.get(t)!, b = vB.get(t)!, c = vC.get(t);
          const dB = Math.abs(b - a);
          const dC = c === undefined ? NaN : Math.abs(c - a);
          let status: keyof typeof attrib;
          if (c === undefined) status = 'worsened';
          else if (dC < 1e-9) status = 'repaired';                 // back to the arm-A (attested) value
          else if (dC > dB + 1e-9) status = 'worsened';
          else if (dC < dB - 1e-9) status = 'partial';             // moved toward, not all the way
          else status = 'unchanged';
          attrib[status]++;
          L.push(`| \`${t}\` | ${a.toFixed(3)} | ${b.toFixed(3)} | ${c?.toFixed(3) ?? 'ABSENT'} `
            + `| ${dB.toFixed(3)} | ${Number.isFinite(dC) ? dC.toFixed(3) : '—'} | ${status.toUpperCase()} |`);
          attribRows.push({ tag: t, armA: a, armB: b, armC: c ?? null, deltaB: +dB.toFixed(4), deltaC: Number.isFinite(dC) ? +dC.toFixed(4) : null, status });
        }
        L.push('');
        L.push(`- **repaired (back to the attested value): ${attrib.repaired}** | partial (closer, not exact): ${attrib.partial} `
          + `| unchanged: ${attrib.unchanged} | worsened: ${attrib.worsened}`);
        L.push('');
      }

      // ---- drift profile along the timeline --------------------------------
      L.push('### Drift profile along the timeline (arm value − arm A value)');
      L.push('');
      L.push('| decile of corpus | n | arm B mean Δ | arm B max |Δ| | arm C mean Δ | arm C max |Δ| |');
      L.push('|---|---|---|---|---|---|');
      const driftJson: Array<Record<string, unknown>> = [];
      for (let d = 0; d < 10; d++) {
        const lo = spec.audioDuration * d / 10, hi = spec.audioDuration * (d + 1) / 10;
        const inBand = A.committed.filter(s => s.startTime >= lo && s.startTime < hi).map(tagOf);
        const dB: number[] = [], dC: number[] = [];
        for (const t of inBand) {
          const a = vA.get(t), b = vB.get(t), c = vC.get(t);
          if (a !== undefined && b !== undefined) dB.push(b - a);
          if (a !== undefined && c !== undefined) dC.push(c - a);
        }
        const mean = (xs: number[]): number => xs.length === 0 ? 0 : xs.reduce((p, q) => p + q, 0) / xs.length;
        const maxAbs = (xs: number[]): number => xs.length === 0 ? 0 : Math.max(...xs.map(Math.abs));
        L.push(`| ${(lo).toFixed(0)}-${(hi).toFixed(0)}s | ${inBand.length} | ${mean(dB).toFixed(3)} | ${maxAbs(dB).toFixed(3)} `
          + `| ${mean(dC).toFixed(3)} | ${maxAbs(dC).toFixed(3)} |`);
        driftJson.push({ decile: d, loSec: +lo.toFixed(2), hiSec: +hi.toFixed(2), n: inBand.length, armBMean: +mean(dB).toFixed(4), armBMaxAbs: +maxAbs(dB).toFixed(4), armCMean: +mean(dC).toFixed(4), armCMaxAbs: +maxAbs(dC).toFixed(4) });
      }
      L.push('');

      // ---- is the drift CUMULATIVE or PER-CHUNK? ---------------------------
      // A cumulative (accumulating) drift is MONOTONE in timeline position and
      // ends at its extreme. A per-region displacement that gets re-anchored
      // returns toward zero. Distinguishing them decides whether the mechanism
      // is an accumulating index/time error or a local one, so it is measured
      // rather than eyeballed off the decile table.
      for (const a of ['B', 'C'] as const) {
        const means = driftJson.map(d => (a === 'B' ? d.armBMean : d.armCMean) as number);
        const firstNZ = means.findIndex(m => Math.abs(m) > 0.05);
        const peakIdx = means.reduce((best, m, i) => Math.abs(m) > Math.abs(means[best]!) ? i : best, 0);
        const last = means[means.length - 1]!;
        const monotone = means.every((m, i) => i === 0 || Math.abs(m) >= Math.abs(means[i - 1]!) - 1e-9);
        const shape = monotone ? 'CUMULATIVE (monotone, ends at its extreme)'
          : Math.abs(last) < Math.abs(means[peakIdx]!) * 0.1
            ? 'ARCH — rises, peaks mid-corpus, RETURNS TO ~ZERO. Not cumulative: a drift that '
              + 'accumulated could not come back without something re-anchoring it.'
            : 'neither cleanly monotone nor fully returning';
        L.push(`- **arm ${a} drift shape: ${shape}** — first non-zero decile ${firstNZ < 0 ? 'none' : firstNZ}, `
          + `peak decile ${peakIdx} (${means[peakIdx]!.toFixed(3)}s), final decile ${last.toFixed(3)}s`);
      }
      L.push('');

      // ================= THE FIVE OPEN DEFECTS PER ARM ====================
      const defectsHere = OPEN_DEFECTS.filter(d => d.corpus === (key as Corpus));
      const defectJson: Array<Record<string, unknown>> = [];
      if (defectsHere.length > 0) {
        L.push('## The open defects, per arm');
        L.push('');
        L.push('| tag | boundary | ear | operator-targeted | arm A | arm B | arm C | Δ(C−ear) | C CORRECT (±50ms) | C DIRECTION-CORRECT | conf A | conf B | conf C |');
        L.push('|---|---|---|---|---|---|---|---|---|---|---|---|---|');
        for (const dRow of defectsHere) {
          const cell = (r: ProductionRun): { v: number | undefined; conf: number } => {
            const i = r.committed.findIndex(s => tagOf(s) === dRow.tag);
            return { v: i >= 0 ? r.committed[i]!.startTime : undefined, conf: i > 0 ? confOf(r.usableFaTokens[r.keptAlignments[i]?.firstTokenIdx ?? -1]) : NaN };
          };
          const ca = cell(A), cb = cell(B), cc = cell(C);
          const landed = cc.v !== undefined && Math.abs(cc.v - dRow.ear) <= DEFECT_LANDED_SEC;
          const toward = cc.v !== undefined && ca.v !== undefined && Math.abs(cc.v - dRow.ear) < Math.abs(ca.v - dRow.ear);
          L.push(`| \`${dRow.tag}\` | ${dRow.boundary} | ${dRow.ear.toFixed(2)} | ${dRow.operatorTargeted ? 'YES' : 'no'} `
            + `| ${ca.v?.toFixed(3) ?? '—'} | ${cb.v?.toFixed(3) ?? '—'} | ${cc.v?.toFixed(3) ?? '—'} `
            + `| ${cc.v !== undefined ? ((cc.v - dRow.ear) >= 0 ? '+' : '') + (cc.v - dRow.ear).toFixed(3) : '—'} `
            + `| ${landed ? '**YES**' : 'no'} | ${landed ? 'YES (also CORRECT)' : toward ? 'YES' : 'NO'} `
            + `| ${ca.conf.toExponential(2)} | ${cb.conf.toExponential(2)} | ${cc.conf.toExponential(2)} |`);
          defectJson.push({
            tag: dRow.tag, boundary: dRow.boundary, ear: dRow.ear, operatorTargeted: dRow.operatorTargeted,
            armA: ca.v, armB: cb.v, armC: cc.v, confA: ca.conf, confB: cb.conf, confC: cc.conf,
            landedC: landed, directionCorrectC: landed || toward,
            landedB: cb.v !== undefined && Math.abs(cb.v - dRow.ear) <= DEFECT_LANDED_SEC,
          });
        }
        L.push('');
      }

      // ================= KNOWN-BAD REPRODUCTION ============================
      const kb = S1_KNOWN_BAD_MOVES.filter(m => m.corpus === (key as Corpus));
      L.push('## `S1_KNOWN_BAD_MOVES` reproduction');
      L.push('');
      L.push('| arm | in-corpus known-bad values | reproduced (±5ms) |');
      L.push('|---|---|---|');
      const kbJson: Record<string, unknown> = {};
      for (const a of ['A', 'B', 'C'] as const) {
        const vals = a === 'A' ? vA : a === 'B' ? vB : vC;
        const hits = kb.filter(m => {
          const v = vals.get(m.tag);
          return v !== undefined && Math.abs(v - m.proposedValue) < KNOWN_BAD_MATCH_SEC;
        });
        L.push(`| ${a} | ${kb.length} | **${hits.length}**${hits.length ? ` (${hits.map(h => h.tag).join(', ')})` : ''} |`);
        kbJson[a] = { inCorpus: kb.length, reproduced: hits.length, tags: hits.map(h => h.tag) };
      }
      L.push('');

      // ================= PHANTOM FUNNEL ====================================
      L.push('## Phantom-tail funnel (AG definitions)');
      L.push('');
      L.push('| arm | chunks | (1) trailing phantom | (1)∧(2) at a seam | (1)∧(2)∧(3) in collapsed gap | rows |');
      L.push('|---|---|---|---|---|---|');
      const funnelJson: Record<string, unknown> = {};
      for (const a of ['A', 'B', 'C'] as const) {
        const { run, chunks } = arms[a];
        const f = phantomFunnel(chunks, run.usableFaTokens, run.silences, run.committed, run.preRuleSegments, run.keptAlignments);
        L.push(`| ${a} | ${chunks.length} | ${f.cond1} | ${f.cond12} | **${f.cond123}** | ${f.rows.join(', ') || '(none)'} |`);
        funnelJson[a] = f;
      }
      L.push('');

      // ================= RULE FIRINGS + STRUCTURAL VERDICT =================
      L.push('## R.14 / R.15 firings and the rule-dependent rows');
      L.push('');
      L.push('Two double-correction counts, because they answer different questions and Session AI');
      L.push('reported the first. **AI definition** (comparable to AI\'s own 96): the arm\'s chunk-plan');
      L.push('change already moved the PRE-RULE value off arm A\'s pre-rule value, AND some rule');
      L.push('(R.11-R.15) still fires on that segment. **Stacked definition**: two DIFFERENT rule');
      L.push('families (the R.11/R.12/R.13 stage and the R.14/R.15 anchor-trust gate) both claim the');
      L.push('same boundary in one run.');
      L.push('');
      L.push('| arm | R.14 | R.15 | double-corrected (AI defn) | double-corrected (stacked) |');
      L.push('|---|---|---|---|---|');
      const ruleJson: Record<string, unknown> = {};
      const preByTagA = new Map(A.preRuleSegments.map(s => [tagOf(s), s.startTime]));
      for (const a of ['A', 'B', 'C'] as const) {
        const r = arms[a].run;
        const preById = new Map(r.preRuleSegments.map(s => [s.id, s.startTime]));
        const trustIds = new Set(r.anchorTrust.map(f => f.segmentId));
        const stageIds = new Set([
          ...r.r11Kept.map(f => f.segmentId), ...r.r12.map(f => f.segmentId), ...r.r13Kept.map(f => f.segmentId),
        ]);
        let stacked = 0;
        for (const s of r.committed) {
          if (!trustIds.has(s.id) || !stageIds.has(s.id)) continue;
          if (Math.abs(s.startTime - (preById.get(s.id) ?? s.startTime)) > 1e-9) stacked++;
        }
        // AI's own definition, recomputed so the 96 is comparable.
        const firedIds = new Set([...stageIds, ...trustIds]);
        let aiDbl = 0;
        for (const seg of r.preRuleSegments) {
          const basePre = preByTagA.get(tagOf(seg));
          if (basePre === undefined || Math.abs(seg.startTime - basePre) < EAR_PIN_TOLERANCE_SEC) continue;
          if (!firedIds.has(seg.id)) continue;
          aiDbl++;
        }
        L.push(`| ${a} | ${r.fired['R.14']} | ${r.fired['R.15']} | **${aiDbl}** | ${stacked} |`);
        ruleJson[a] = { r14: r.fired['R.14'], r15: r.fired['R.15'], doubleCorrectedAI: aiDbl, doubleCorrectedStacked: stacked, fired: r.fired };
      }
      L.push('');

      // The four rule-dependent rows: is each still correct WITHOUT its owning
      // rule having moved it in this arm?
      const RULE_DEPENDENT: Array<{ corpus: Corpus; tag: string; value: number; rule: string }> = [
        { corpus: 'v6', tag: '152_frozen_brush_mice', value: 451.03, rule: 'R.14' },
        { corpus: 'v6', tag: '400_endless_dark', value: 1266.75, rule: 'R.14' },
        { corpus: '173', tag: 'iron_bounce', value: 76.58, rule: 'R.15' },
        { corpus: '173', tag: 'logic_clash', value: 418.14, rule: 'R.15' },
      ];
      const rdHere = RULE_DEPENDENT.filter(r => r.corpus === (key as Corpus));
      const rdJson: Array<Record<string, unknown>> = [];
      if (rdHere.length > 0) {
        L.push('### Rule-dependent rows — structurally correct without the rule firing?');
        L.push('');
        L.push('| tag | owning rule | attested value | arm | pre-rule | committed | rule moved it? | pre-rule already correct? |');
        L.push('|---|---|---|---|---|---|---|---|');
        for (const rd of rdHere) {
          for (const a of ['A', 'B', 'C'] as const) {
            const r = arms[a].run;
            const seg = r.committed.find(s => tagOf(s) === rd.tag);
            const pre = seg ? r.preRuleSegments.find(s => s.id === seg.id) : undefined;
            const movedByRule = seg && pre ? Math.abs(seg.startTime - pre.startTime) > 1e-9 : false;
            const preCorrect = pre !== undefined && Math.abs(pre.startTime - rd.value) <= EAR_PIN_TOLERANCE_SEC;
            L.push(`| \`${rd.tag}\` | ${rd.rule} | ${rd.value.toFixed(2)} | ${a} | ${pre?.startTime.toFixed(3) ?? '—'} `
              + `| ${seg?.startTime.toFixed(3) ?? 'ABSENT'} | ${movedByRule ? 'yes' : 'no'} | ${preCorrect ? '**YES**' : 'no'} |`);
            rdJson.push({ tag: rd.tag, rule: rd.rule, attested: rd.value, arm: a, preRule: pre?.startTime ?? null, committed: seg?.startTime ?? null, movedByRule, preRuleAlreadyCorrect: preCorrect });
          }
        }
        L.push('');
      }

      // ================= RESOURCES =========================================
      L.push('## Chunk-length distribution and FA-run resources');
      L.push('');
      L.push('| arm | n | min | p25 | median | p75 | max | mean | wall clock | peak RSS |');
      L.push('|---|---|---|---|---|---|---|---|---|---|');
      const resJson: Record<string, unknown> = {};
      for (const a of ['A', 'B', 'C'] as const) {
        const s = lengthStats(arms[a].chunks);
        const w = (wall as Record<string, Record<string, Record<string, string>>>)[key]?.[a];
        L.push(`| ${a} | ${s.n} | ${s.min ?? '—'} | ${s.p25 ?? '—'} | ${s.median ?? '—'} | ${s.p75 ?? '—'} | ${s.max ?? '—'} | ${s.mean ?? '—'} `
          + `| ${w?.wallClock ?? 'n/a (stored arm)'} | ${w?.peakRssMB ? `${w.peakRssMB} MB` : 'n/a (stored arm)'} |`);
        resJson[a] = { lengths: s, resources: w ?? null };
      }
      L.push('');

      json[key] = {
        armChunks: { A: chunksA.length, B: chunksB.length, C: chunksC.length },
        armCommitted: { A: A.committed.length, B: B.committed.length, C: C.committed.length },
        oracleDiff: diffJson,
        controlRegressions: { armBCount: bRegressions.length, tags: bRegressions, attribution: attrib, rows: attribRows },
        drift: driftJson,
        openDefects: defectJson,
        knownBad: kbJson,
        phantomFunnel: funnelJson,
        rules: ruleJson,
        ruleDependent: rdJson,
        resources: resJson,
      };
    }

    // ================= R-AS PRECISION + GATE VERDICT ======================
    L.push('# Implied boundary-improvement precision (R-AS), and the gate verdict');
    L.push('');
    L.push('Precision = repaired / (repaired + regressed), where `repaired` is an open defect landed');
    L.push('within ±50ms of its ear target and `regressed` is an attested-correct boundary moved more');
    L.push(`than ${EAR_BILL_TOLERANCE_SEC * 1000}ms off its attested value. Both halves are machine-adjudicated`);
    L.push('against the AJ-0 oracle — no listening pass is involved.');
    L.push('');
    L.push('| corpus | arm | repaired | regressed | implied precision |');
    L.push('|---|---|---|---|---|');
    const precision: Record<string, Record<string, number | null>> = {};
    for (const key of CORPORA_KEYS) {
      const d = (json[key] as { oracleDiff: Record<string, { repaired: number; regressed: number }> }).oracleDiff;
      precision[key] = {};
      for (const a of ['A', 'B', 'C'] as const) {
        const { repaired, regressed } = d[a]!;
        const denom = repaired + regressed;
        const p = denom === 0 ? null : repaired / denom;
        precision[key]![a] = p;
        L.push(`| ${key} | ${a} | ${repaired} | ${regressed} | ${p === null ? 'n/a (nothing moved)' : `**${(100 * p).toFixed(2)}%**`} |`);
      }
    }
    L.push('');
    L.push('For scale, both MEASURED in prior sessions: **S1 ≈7%** (rejected 18/18 on ear audit, ruling R-AS)');
    L.push('and **arm B ≈0.3% on v6** (1 improvement / 331 moved).');
    L.push('');

    // ---- the gate, adjudicated -------------------------------------------
    const attested = ['v6', '173'] as const;   // spanish is OUT OF REGISTER (Step 0 scoping)
    let hardFail1 = 0, hardFail2 = 0, defectsLanded = 0, defectsLandedTargeted = 0, earBill = 0;
    for (const key of attested) {
      const c = json[key] as {
        oracleDiff: Record<string, { regressedRows: Array<{ beyondHardFail: boolean }>; regressed: number }>;
        knownBad: Record<string, { reproduced: number }>;
        openDefects: Array<{ landedC: boolean; operatorTargeted: boolean }>;
      };
      hardFail1 += c.oracleDiff.C!.regressedRows.filter(r => r.beyondHardFail).length;
      hardFail2 += c.knownBad.C!.reproduced;
      earBill += c.oracleDiff.C!.regressed;
      for (const d of c.openDefects) {
        if (d.landedC) { defectsLanded++; if (d.operatorTargeted) defectsLandedTargeted++; }
      }
    }
    hardFail2 += (json.spanish as { knownBad: Record<string, { reproduced: number }> }).knownBad.C!.reproduced;
    const impliedPrecision = earBill + defectsLanded === 0 ? null : defectsLanded / (defectsLanded + earBill);

    L.push('## The pre-registered gate, adjudicated against arm C');
    L.push('');
    L.push('| condition | bar | arm C | verdict |');
    L.push('|---|---|---|---|');
    L.push(`| HARD FAIL 1 — attested-correct boundaries moved >${HARD_FAIL_MOVE_SEC * 1000}ms | 0 | **${hardFail1}** | ${hardFail1 === 0 ? 'PASS' : '**FAIL**'} |`);
    L.push(`| HARD FAIL 2 — known-bad values reproduced | 0 | **${hardFail2}** | ${hardFail2 === 0 ? 'PASS' : '**FAIL**'} |`);
    L.push(`| SUCCESS BAR — operator-targeted open defects landed | >=${GATE.minDefectsRequired} of 4 | **${defectsLandedTargeted}** | ${defectsLandedTargeted >= GATE.minDefectsRequired ? 'PASS' : '**FAIL**'} |`);
    L.push(`| SHIP CAP — implied precision (all 5 defects vs ear bill) | >=${(100 * GATE.minImpliedPrecision).toFixed(0)}% | **${impliedPrecision === null ? 'n/a' : `${(100 * impliedPrecision).toFixed(2)}%`}** (${defectsLanded} landed / ${earBill} ear bill) | ${impliedPrecision !== null && impliedPrecision >= GATE.minImpliedPrecision ? 'PASS' : '**FAIL**'} |`);
    L.push('');
    const gateVerdict = hardFail1 === 0 && hardFail2 === 0
      && defectsLandedTargeted >= GATE.minDefectsRequired
      && impliedPrecision !== null && impliedPrecision >= GATE.minImpliedPrecision;
    L.push(`**GATE VERDICT: ${gateVerdict ? 'PASS' : 'FAIL'}**`);
    L.push('');
    json.precision = precision;
    json.gateVerdict = {
      pass: gateVerdict, hardFail1, hardFail2, defectsLanded, defectsLandedTargeted, earBill, impliedPrecision,
    };

    // ================= PREDICTION ADJUDICATION =============================
    L.push('# Pre-registered predictions — adjudicated');
    L.push('');
    L.push('| corpus | R.5 runs | prediction | held? |');
    L.push('|---|---|---|---|');
    const predJson: Array<Record<string, unknown>> = [];
    for (const p of PREDICTIONS) {
      const c = json[p.corpus] as { oracleDiff: Record<string, { unchanged: number }> } | undefined;
      let held: string;
      if (p.corpus === 'v6') {
        held = 'see drift + control tables above';
      } else {
        const b = c!.oracleDiff.B!, cc = c!.oracleDiff.C!;
        held = b.unchanged === cc.unchanged ? 'PENDING bit-identity check below' : '**FALSIFIED**';
      }
      L.push(`| ${p.corpus} | ${p.r5Runs} | ${p.prediction.slice(0, 110)}… | ${held} |`);
      predJson.push({ corpus: p.corpus, r5Runs: p.r5Runs, held });
    }
    L.push('');

    json.gate = GATE;
    json.predictions = predJson;
    writeFileSync(resolve(OUT, 'step4-measure.md'), `${L.join('\n')}\n`);
    writeFileSync(resolve(OUT, 'step4-measure.json'), JSON.stringify(json, null, 2));
    // eslint-disable-next-line no-console
    console.log(L.join('\n'));
  }, 900_000);
});
