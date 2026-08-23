/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// ---------------------------------------------------------------------------
// WS1 Session AI — STEP 4. MEASURE S2 ON ALL THREE CORPORA.
//
// Reads `fa_ai_words.json` (aligned by `fa_onnx.rs`'s `session_p_regen`
// harness against `fa_ai_chunks.json`, Step 3's real S2 planner output) and
// drives it through the SAME production rule stage `runProductionPath` runs
// for every other WS1 measurement. Compares against today's PRODUCTION arm
// (`fa_live_words.json` / today's planner) — never against S1, which no
// longer exists in this tree.
//
// PHANTOM CENSUS FUNNEL, reused verbatim from `ws1-session-ag-census.test.ts`
// (condition 1: chunk trailing phantom tail; condition 2: tail coincides with
// a segment seam; condition 3: pre-rule boundary lands inside the collapsed
// gap) — same definitions, applied to the S2 arm's own chunk plan
// (`fa_ai_chunks.json`, loaded explicitly — `ProductionRun.chunks` always
// recomputes TODAY's planner regardless of which FA-words arm was loaded, so
// scoring condition 1/2 against it would silently score the wrong chunk plan).
//
// Gated: WS1_SESSION_AI_MEASURE=1 npx vitest run scripts/ws1-session-ai-step4-measure.test.ts
// ---------------------------------------------------------------------------

import { describe, it } from 'vitest';
import { writeFileSync, readFileSync, mkdirSync } from 'fs';
import { resolve } from 'path';

import { CORPORA, runProductionPath, tagOf, REPO, REPLAY_ROOT } from './ws1-session-p-pipeline.js';
import type { FaChunk } from '../src/services/faChunkPlan';
import { CONF_MIN_FALLBACK } from '../src/services/syncConstants';
import {
  earHistory, earVerifiedControls, S1_KNOWN_BAD_MOVES, EAR_PIN_TOLERANCE_SEC,
} from './ws1-ear-pass-ledger.js';
import type { Corpus } from './ws1-ear-pass-ledger.js';
import type { TranscriptToken } from '../src/types';
import type { SilenceInterval } from '../src/services/silenceDetector';

const MEASURE = process.env.WS1_SESSION_AI_MEASURE === '1';
const OUT = resolve(REPO, '.work-phase4/session-ai');
const TOL = EAR_PIN_TOLERANCE_SEC;

const confOf = (t: TranscriptToken | undefined): number =>
  t === undefined ? 0 : ((t as { confidence?: number }).confidence ?? 0);

function isPhantom(t: TranscriptToken, silences: readonly SilenceInterval[]): boolean {
  if (confOf(t) >= CONF_MIN_FALLBACK) return false;
  return silences.some(s => s.startSec <= t.startSec && t.endSec <= s.endSec);
}

/** The five open defects (Session AI Step 0's restated list) plus the two
 *  rule-dependent rows, for the pre-registered-prediction comparison. */
const SEVEN_ROWS: Array<{ corpus: Corpus; tag: string; ear: number; kind: string }> = [
  { corpus: 'v6', tag: '214_solitary_fire', ear: 630.09, kind: 'OPEN' },
  { corpus: 'v6', tag: '231_slowing_pace', ear: 682.74, kind: 'OPEN' },
  { corpus: 'v6', tag: '447_scout_facing_dark', ear: 1418.53, kind: 'OPEN' },
  { corpus: '173', tag: 'lethal_nature_hazard', ear: 19.27, kind: 'OPEN' },
  { corpus: '173', tag: 'gadget_decay', ear: 427.60, kind: 'OPEN' },
  { corpus: 'v6', tag: '152_frozen_brush_mice', ear: 451.03, kind: 'RULE-DEPENDENT (R.14)' },
  { corpus: '173', tag: 'iron_bounce', ear: 76.59, kind: 'RULE-DEPENDENT (R.15)' },
];

/** Seam-scoped phantom census funnel — IDENTICAL definitions to
 *  `ws1-session-ag-census.test.ts`, applied to one (chunks, tokens, silences,
 *  committed, preRule, keptAlignments) tuple. */
type ProductionRun = Awaited<ReturnType<typeof runProductionPath>>;

function phantomFunnel(
  chunks: readonly FaChunk[], toks: readonly TranscriptToken[], sil: readonly SilenceInterval[],
  committed: ProductionRun['committed'],
  preRuleSegments: ProductionRun['preRuleSegments'],
  keptAlignments: ProductionRun['keptAlignments'],
): { cond1: number; cond12: number; cond123: number; rows: Array<{ tag: string; segIndex: number }> } {
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

  let cond12 = 0;
  let cond123 = 0;
  const rows: Array<{ tag: string; segIndex: number }> = [];
  for (let c = 0; c < chunks.length; c++) {
    const tail = phantomTail[c]!;
    if (tail.length === 0) continue;
    const hit = tail.map(idx => firstIdxToSeg.get(idx)).find(v => v !== undefined);
    if (hit === undefined) continue;
    cond12++;
    const i = hit;
    const seg = committed[i]!;
    const lAlign = keptAlignments[i - 1]!;
    const rAlign = keptAlignments[i]!;
    const lTok = toks[lAlign.lastTokenIdx];
    const rTok = toks[rAlign.firstTokenIdx];
    if (lTok === undefined || rTok === undefined) continue;
    const gapStart = lTok.endSec, gapEnd = rTok.startSec;
    const pre = preById.get(seg.id) ?? seg.startTime;
    const inGap = pre >= gapStart - 1e-9 && pre <= gapEnd + 1e-9;
    if (inGap) { cond123++; rows.push({ tag: tagOf(seg), segIndex: i }); }
  }

  return { cond1, cond12, cond123, rows };
}

describe.skipIf(!MEASURE)('WS1 Session AI Step 4 — measure S2', () => {
  it('runs the base and S2 arms on all three corpora and reports every required table', async () => {
    mkdirSync(OUT, { recursive: true });
    const L: string[] = [];
    const json: Record<string, unknown> = {};

    L.push('# WS1 Session AI Step 4 — S2 measurement (MEASURED)');
    L.push('');

    const controls = earVerifiedControls();
    const known18 = S1_KNOWN_BAD_MOVES.filter(m => m.provenance === 'ah-sitting');
    const known19 = S1_KNOWN_BAD_MOVES;

    for (const key of ['v6', '173', 'spanish'] as const) {
      const spec = CORPORA[key]!;
      const base = await runProductionPath(spec);
      const s2 = await runProductionPath(spec, true, undefined, 'fa_ai_words.json');
      const s2Chunks = (JSON.parse(readFileSync(resolve(REPLAY_ROOT, key, 'fa_ai_chunks.json'), 'utf-8')) as { chunks: FaChunk[] }).chunks;

      L.push(`## ${key}`);
      L.push('');
      L.push(`- base chunks (today's planner): ${base.chunks.length} | S2 chunks: ${s2Chunks.length}`);
      L.push(`- base committed: ${base.committed.length} | S2 committed: ${s2.committed.length}`);
      L.push(`- base fired: ${JSON.stringify(base.fired)}`);
      L.push(`- S2 fired: ${JSON.stringify(s2.fired)}`);
      L.push('');

      // ---- phantom-tail funnel, before/after -----------------------------
      const baseFunnel = phantomFunnel(base.chunks, base.usableFaTokens, base.silences, base.committed, base.preRuleSegments, base.keptAlignments);
      const s2Funnel = phantomFunnel(s2Chunks, s2.usableFaTokens, s2.silences, s2.committed, s2.preRuleSegments, s2.keptAlignments);
      const pct = (n: number, d: number): string => d === 0 ? 'n/a' : `${(100 * n / d).toFixed(1)}%`;
      L.push('### phantom-tail funnel (AG definitions, before/after)');
      L.push('');
      L.push('| stage | before (base) | after (S2) |');
      L.push('|---|---|---|');
      L.push(`| chunks | ${base.chunks.length} | ${s2Chunks.length} |`);
      L.push(`| (1) trailing phantom | ${baseFunnel.cond1} (${pct(baseFunnel.cond1, base.chunks.length)}) | ${s2Funnel.cond1} (${pct(s2Funnel.cond1, s2Chunks.length)}) |`);
      L.push(`| (1)^(2) coincides with seam | ${baseFunnel.cond12} | ${s2Funnel.cond12} |`);
      L.push(`| (1)^(2)^(3) in collapsed gap | ${baseFunnel.cond123} | ${s2Funnel.cond123} |`);
      L.push(`| rows: ${baseFunnel.rows.map(r => r.tag).join(', ') || '(none)'} | -> | ${s2Funnel.rows.map(r => r.tag).join(', ') || '(none)'} |`);
      L.push('');

      // ---- movement census -------------------------------------------------
      const baseByTag = new Map(base.committed.map(s => [tagOf(s), s.startTime]));
      const s2ByTag = new Map(s2.committed.map(s => [tagOf(s), s.startTime]));
      const controlTags = new Set(controls.filter(c => c.corpus === key).map(c => c.tag));
      const known18Tags = new Set(known18.filter(m => m.corpus === key).map(m => m.tag));
      const known19Tags = new Set(known19.filter(m => m.corpus === key).map(m => m.tag));
      const allTags = [...new Set([...baseByTag.keys(), ...s2ByTag.keys()])];

      let unchanged = 0, moved = 0, controlsMoved = 0, knownBadReproduced = 0;
      const movedRows: Array<{ tag: string; base: number | undefined; s2: number | undefined; delta: number | null; earStatus: string }> = [];
      for (const t of allTags) {
        const a = baseByTag.get(t); const b = s2ByTag.get(t);
        if (a !== undefined && b !== undefined && Math.abs(a - b) < 1e-9) { unchanged++; continue; }
        moved++;
        if (controlTags.has(t)) controlsMoved++;
        if (known19Tags.has(t) && b !== undefined) {
          const bad = known19.find(m => m.corpus === key && m.tag === t)!;
          if (Math.abs(b - bad.proposedValue) < TOL) knownBadReproduced++;
        }
        const h = earHistory(key as Corpus, t);
        const earStatus = h.length === 0 ? 'unaudited'
          : (b !== undefined && h.some(r => r.scoredValue !== null && Math.abs(r.scoredValue - b) < TOL && r.verdict === 'CORRECT'))
            ? 'S2-value-ear-verified-correct'
            : (b !== undefined && h.some(r => r.scoredValue !== null && Math.abs(r.scoredValue - b) < TOL))
              ? 'S2-value-ear-verified-defect'
              : 'moved-without-evidence-at-this-value';
        movedRows.push({ tag: t, base: a, s2: b, delta: a !== undefined && b !== undefined ? +(b - a).toFixed(6) : null, earStatus });
      }
      const noEvidence = movedRows.filter(r => r.earStatus === 'moved-without-evidence-at-this-value').length;

      L.push('### movement census');
      L.push('');
      L.push(`| quantity | value |`);
      L.push(`|---|---|`);
      L.push(`| boundaries compared | ${allTags.length} |`);
      L.push(`| unchanged | ${unchanged} |`);
      L.push(`| moved | ${moved} |`);
      L.push(`| of which: ear-verified controls moved (regression, zero tolerance) | **${controlsMoved}** |`);
      L.push(`| of which: known-bad values (of ${known19Tags.size} in-corpus) reproduced | **${knownBadReproduced}** |`);
      L.push(`| **moved WITHOUT ear evidence at the new value (the ear bill)** | **${noEvidence}** |`);
      L.push('');
      if (moved > 0) {
        L.push('| tag | base | S2 | delta | ear status |');
        L.push('|---|---|---|---|---|');
        for (const r of movedRows.sort((x, y) => Math.abs(y.delta ?? 0) - Math.abs(x.delta ?? 0))) {
          L.push(`| \`${r.tag}\` | ${r.base?.toFixed(3) ?? 'ABSENT'} | ${r.s2?.toFixed(3) ?? 'ABSENT'} `
            + `| ${r.delta === null ? '—' : (r.delta >= 0 ? '+' : '') + r.delta.toFixed(3)} | ${r.earStatus} |`);
        }
        L.push('');
      }

      // ---- seven-row prediction outcome -----------------------------------
      const rowsHere = SEVEN_ROWS.filter(r => r.corpus === key);
      if (rowsHere.length > 0) {
        L.push('### seven-row predicted-vs-measured outcome');
        L.push('');
        L.push('| tag | kind | base | S2 | ear | delta(S2) | CORRECT (<=50ms) | DIRECTION-CORRECT | incoming conf before | incoming conf after |');
        L.push('|---|---|---|---|---|---|---|---|---|---|');
        for (const r of rowsHere) {
          const idxB = base.committed.findIndex(s => tagOf(s) === r.tag);
          const idxS = s2.committed.findIndex(s => tagOf(s) === r.tag);
          const bVal = idxB >= 0 ? base.committed[idxB]!.startTime : undefined;
          const sVal = idxS >= 0 ? s2.committed[idxS]!.startTime : undefined;
          const confB = idxB > 0 ? confOf(base.usableFaTokens[base.keptAlignments[idxB]?.firstTokenIdx ?? -1]) : NaN;
          const confS = idxS > 0 ? confOf(s2.usableFaTokens[s2.keptAlignments[idxS]?.firstTokenIdx ?? -1]) : NaN;
          const deltaS = sVal !== undefined ? sVal - r.ear : NaN;
          const correct = sVal !== undefined && Math.abs(sVal - r.ear) <= 0.05;
          const towardEar = sVal !== undefined && bVal !== undefined && Math.abs(sVal - r.ear) < Math.abs(bVal - r.ear);
          const direction = correct ? 'YES (also CORRECT)' : towardEar ? 'YES' : 'NO';
          L.push(`| \`${r.tag}\` | ${r.kind} | ${bVal?.toFixed(3) ?? 'ABSENT'} | ${sVal?.toFixed(3) ?? 'ABSENT'} | ${r.ear.toFixed(3)} `
            + `| ${Number.isFinite(deltaS) ? (deltaS >= 0 ? '+' : '') + deltaS.toFixed(3) : '—'} | ${correct ? '**YES**' : 'no'} | ${direction} `
            + `| ${confB.toExponential(2)} | ${confS.toExponential(2)} |`);
        }
        L.push('');
      }

      json[key] = {
        baseChunks: base.chunks.length, s2Chunks: s2Chunks.length,
        baseCommitted: base.committed.length, s2Committed: s2.committed.length,
        baseFired: base.fired, s2Fired: s2.fired,
        phantomFunnel: { base: baseFunnel, s2: s2Funnel },
        movement: { compared: allTags.length, unchanged, moved, controlsMoved, knownBadReproduced, noEvidence, movedRows },
      };
    }

    writeFileSync(resolve(OUT, 'step4-measure.md'), L.join('\n'));
    writeFileSync(resolve(OUT, 'step4-measure.json'), JSON.stringify(json, null, 2));
    console.log('wrote step4-measure.md');
  }, 300_000);
});
