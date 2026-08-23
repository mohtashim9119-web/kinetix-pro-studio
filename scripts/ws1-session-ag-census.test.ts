/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// ---------------------------------------------------------------------------
// WS1 Session AG — STEP 1. THE SEAM-SCOPED PHANTOM CENSUS.
//
// WHY. `docs/ws1-sync-pipeline/fa-chunk-phantom-root-cause.md` §4 measured that
// a phantom chunk tail is PERVASIVE (66% of v6's chunks) while the defect is
// rare, and named the coincidence of three conditions as what separates them:
//
//   (1) the chunk's TRAILING text has no audio behind it — its last word is
//       both sub-reliability and wholly inside a detected silence;
//   (2) that phantom tail coincides with a SEGMENT SEAM — the incoming
//       segment's own first claimed word IS one of the phantom tokens;
//   (3) `snapCoveredBoundaries` then places the committed boundary INSIDE the
//       collapsed gap between the outgoing segment's last real word and that
//       phantom.
//
// This file measures the funnel chunks -> (1) -> (1)^(2) -> (1)^(2)^(3) on all
// three corpora, and lists the surviving set row by row. It is the BILL for the
// S1 fix: every row in the final set is a boundary S1 will move, and the ones
// with no ear evidence are listening work S1 incurs.
//
// READ-ONLY. Computes nothing the production path does not already compute; it
// re-reads `runProductionPath`'s own chunk plan, FA tokens, silences,
// alignments and PRE-RULE boundaries. It ships no rule and changes no output.
//
// WHY PRE-RULE BOUNDARIES FOR CONDITION 3. Condition (3) is a claim about what
// `snapCoveredBoundaries` DID, and R.11/R.12/R.13/R.14/R.15 all run after it.
// Testing containment against the post-rule array would score R.14's own
// corrections as evidence about snap. `preRuleSegments` is exactly the
// post-snap/post-head-extend array, so that is what condition (3) reads;
// the post-rule value is reported alongside, never substituted.
//
// GENERATOR — gated off the default sweep. Run:
//   WS1_SESSION_AG_MEASURE=1 npx vitest run scripts/ws1-session-ag-census.test.ts
// ---------------------------------------------------------------------------

import { describe, it } from 'vitest';
import { writeFileSync, mkdirSync } from 'fs';
import { resolve } from 'path';

import { readFileSync } from 'fs';
import { CORPORA, runProductionPath, tagOf, REPO, REPLAY_ROOT } from './ws1-session-p-pipeline.js';
import type { FaChunk } from '../src/services/faChunkPlan';
import { CONF_MIN_FALLBACK } from '../src/services/syncConstants';
import { EAR_PASS_LEDGER, earHistory } from './ws1-ear-pass-ledger.js';
import type { Corpus } from './ws1-ear-pass-ledger.js';
import type { TranscriptToken } from '../src/types';
import type { SilenceInterval } from '../src/services/silenceDetector';

const MEASURE = process.env.WS1_SESSION_AG_MEASURE === '1';
const OUT = resolve(REPO, '.work-phase4/session-ag');

// WS1 Session AG Step 5: the SAME funnel, re-run over the S1 arm. `WS1_AG_ARM`
// selects the FA word file and `WS1_AG_PLAN` the chunk plan it was aligned
// against — they must be set together or the census would score S1's words
// against the baseline's chunk boundaries. Unset = the baseline census.
const ARM = process.env.WS1_AG_ARM;
const PLAN = process.env.WS1_AG_PLAN;
const LABEL = process.env.WS1_AG_LABEL ?? 'baseline';

const confOf = (t: TranscriptToken | undefined): number =>
  t === undefined ? 0 : ((t as { confidence?: number }).confidence ?? 0);

/** The 13 rows `fa-chunk-phantom-root-cause.md` §3 ATTRIBUTES to the phantom
 *  mechanism — v6's ten Class A/B rows plus three of 173's five. The two it
 *  explicitly attributes elsewhere (`iron_bounce` wrong-silence selection,
 *  `gadget_decay` no chunk edge and no silence) are listed separately so the
 *  census can report on them without counting them as misses. */
const ATTRIBUTED: Array<{ corpus: Corpus; tag: string }> = [
  { corpus: 'v6', tag: '008_unknown_void' },
  { corpus: 'v6', tag: '056_dropping_torch' },
  { corpus: 'v6', tag: '152_frozen_brush_mice' },
  { corpus: 'v6', tag: '167_smell_of_butchery' },
  { corpus: 'v6', tag: '214_solitary_fire' },
  { corpus: 'v6', tag: '231_slowing_pace' },
  { corpus: 'v6', tag: '286_fact_to_act' },
  { corpus: 'v6', tag: '400_endless_dark' },
  { corpus: 'v6', tag: '403_vigilant_embers' },
  { corpus: 'v6', tag: '447_scout_facing_dark' },
  { corpus: '173', tag: 'lethal_nature_hazard' },
  { corpus: '173', tag: 'wall_split_path' },
  { corpus: '173', tag: 'logic_clash' },
];

const NOT_ATTRIBUTED: Array<{ corpus: Corpus; tag: string; why: string }> = [
  { corpus: '173', tag: 'iron_bounce', why: 'wrong-silence selection; FA timing is CORRECT here' },
  { corpus: '173', tag: 'gadget_decay', why: 'no chunk edge and no detected silence within seconds' },
];

/** A token is a PHANTOM iff FA could not find it (sub-reliability posterior)
 *  AND the instant it was placed at carries no speech (wholly inside a
 *  detected silence). Both halves are existence tests against already-shipped
 *  quantities — `CONF_MIN_FALLBACK` is `syncConstants.ts`'s, and the silence
 *  array is the production detector's. No new threshold is introduced here. */
function isPhantom(t: TranscriptToken, silences: readonly SilenceInterval[]): boolean {
  if (confOf(t) >= CONF_MIN_FALLBACK) return false;
  return silences.some(s => s.startSec <= t.startSec && t.endSec <= s.endSec);
}

/** Ear status for one boundary, from the ledger's own supersession order. */
function earStatus(corpus: Corpus, tag: string, value: number): string {
  const h = earHistory(corpus, tag);
  if (h.length === 0) return 'unaudited';
  const atValue = h.filter(r => r.scoredValue !== null && Math.abs(r.scoredValue - value) < 0.005);
  if (atValue.length > 0) {
    return atValue[0]!.verdict === 'CORRECT' ? 'verified-correct' : `verified-defect(${atValue[0]!.verdict})`;
  }
  // The tag has been heard, but not at THIS value. That is not the same as
  // unaudited and must not be reported as if it were.
  const target = h.find(r => r.verdict === 'CORRECT' && r.scoredValue !== null);
  return target
    ? `heard-elsewhere(target ${target.scoredValue!.toFixed(3)})`
    : 'heard-elsewhere(no target)';
}

interface Row {
  corpus: string;
  chunkIndex: number;
  chunkStart: number;
  chunkEnd: number;
  chunkTailText: string;
  phantomCount: number;
  phantomFirstIdx: number;
  phantomLastIdx: number;
  /** condition 2's segment: the incoming segment whose first claimed word is a phantom. */
  segIndex: number;
  tag: string;
  preRuleBoundary: number;
  committedBoundary: number;
  gapStart: number;
  gapEnd: number;
  gapWidth: number;
  inGap: boolean;
  earStatus: string;
  /** The first RELIABLE token at or after the phantom tail — where the incoming
   *  segment's speech actually starts, and therefore where S1 moves this
   *  boundary toward. */
  realOnsetAfterPhantom: number | null;
  predictedDirection: string;
}

describe.skipIf(!MEASURE)('WS1 Session AG Step 1 — seam-scoped phantom census', () => {
  it('reports the three-stage funnel and the (1)^(2)^(3) set for all three corpora', async () => {
    mkdirSync(OUT, { recursive: true });
    const L: string[] = [];
    const allRows: Row[] = [];
    const summary: Record<string, unknown> = {};

    L.push(`WS1 SESSION AG — SEAM-SCOPED PHANTOM CENSUS   label="${LABEL}" ` +
      `arm=${ARM ?? '(baseline)'} plan=${PLAN ?? '(recomputed baseline)'}`);
    L.push(`reliability line: CONF_MIN_FALLBACK = ${CONF_MIN_FALLBACK} (syncConstants.ts, unchanged)`);
    L.push('');

    for (const key of ['v6', '173', 'spanish'] as const) {
      const run = await runProductionPath(CORPORA[key]!, true, undefined, ARM);
      const toks = run.usableFaTokens;
      const sil = run.silences;
      const chunks: readonly FaChunk[] = PLAN === undefined
        ? run.chunks
        : (JSON.parse(readFileSync(resolve(REPLAY_ROOT, key, PLAN), 'utf-8')) as { chunks: FaChunk[] }).chunks;

      // ---- Attribute FA tokens to chunks by ONSET containment. -------------
      // `align_chunked` emits each chunk's words inside that chunk's own
      // window, in order, so onset containment is a partition here. Tokens
      // matching no chunk are counted and reported rather than dropped
      // silently.
      const tokensOfChunk: number[][] = chunks.map(() => []);
      let unattributed = 0;
      let ci = 0;
      for (let t = 0; t < toks.length; t++) {
        const onset = toks[t]!.startSec;
        while (ci < chunks.length && onset >= chunks[ci]!.endSec) ci++;
        if (ci >= chunks.length || onset < chunks[ci]!.startSec) { unattributed++; continue; }
        tokensOfChunk[ci]!.push(t);
      }

      // ---- Condition 1 -----------------------------------------------------
      // The maximal SUFFIX of a chunk's tokens that are all phantom. Condition
      // (1) is "the chunk's last word is a phantom", i.e. that suffix is
      // non-empty; the whole suffix is carried because it is exactly the text
      // S1 folds.
      const phantomTail: Array<number[]> = chunks.map(() => []);
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

      // ---- Conditions 2 and 3 ---------------------------------------------
      // (2) some committed segment's own FIRST claimed token index lies inside
      //     this chunk's phantom tail;
      // (3) the PRE-RULE boundary for that segment lies inside the collapsed
      //     gap [outgoing segment's last claimed word END, that phantom's
      //     ONSET].
      const firstIdxToSeg = new Map<number, number>();
      for (let i = 1; i < run.committed.length; i++) {
        const fi = run.keptAlignments[i]?.firstTokenIdx ?? -1;
        if (fi >= 0 && !firstIdxToSeg.has(fi)) firstIdxToSeg.set(fi, i);
      }

      const preById = new Map(run.preRuleSegments.map(s => [s.id, s.startTime]));
      let cond12 = 0;
      const rows: Row[] = [];

      for (let c = 0; c < chunks.length; c++) {
        const tail = phantomTail[c]!;
        if (tail.length === 0) continue;
        const hit = tail.map(idx => firstIdxToSeg.get(idx)).find(v => v !== undefined);
        if (hit === undefined) continue;
        cond12++;

        const i = hit;
        const seg = run.committed[i]!;
        const lAlign = run.keptAlignments[i - 1]!;
        const rAlign = run.keptAlignments[i]!;
        const lTok = toks[lAlign.lastTokenIdx];
        const rTok = toks[rAlign.firstTokenIdx];
        if (lTok === undefined || rTok === undefined) continue;
        const gapStart = lTok.endSec, gapEnd = rTok.startSec;
        const pre = preById.get(seg.id) ?? seg.startTime;
        const inGap = pre >= gapStart - 1e-9 && pre <= gapEnd + 1e-9;

        // Where S1 sends this boundary: the first token at or after the
        // phantom tail whose posterior reaches the reliability line — the
        // instant FA actually has evidence the incoming segment is speaking.
        let realOnset: number | null = null;
        for (let t = tail[tail.length - 1]! + 1; t < toks.length; t++) {
          if (confOf(toks[t]) >= CONF_MIN_FALLBACK) { realOnset = toks[t]!.startSec; break; }
        }

        const tag = tagOf(seg);
        rows.push({
          corpus: key,
          chunkIndex: c,
          chunkStart: chunks[c]!.startSec,
          chunkEnd: chunks[c]!.endSec,
          chunkTailText: tail.map(idx => toks[idx]!.text).join(' '),
          phantomCount: tail.length,
          phantomFirstIdx: tail[0]!,
          phantomLastIdx: tail[tail.length - 1]!,
          segIndex: i,
          tag,
          preRuleBoundary: pre,
          committedBoundary: seg.startTime,
          gapStart, gapEnd, gapWidth: gapEnd - gapStart,
          inGap,
          earStatus: earStatus(key as Corpus, tag, seg.startTime),
          realOnsetAfterPhantom: realOnset,
          predictedDirection: realOnset === null
            ? 'LATER (no reliable onset found after the tail — target undetermined)'
            : `LATER, toward [${gapStart.toFixed(3)}, ${realOnset.toFixed(3)}] ` +
              `(gap widens ${(gapEnd - gapStart).toFixed(3)}s -> ${(realOnset - gapStart).toFixed(3)}s)`,
        });
      }

      const final = rows.filter(r => r.inGap);
      allRows.push(...final);

      L.push(`######## ${key}`);
      L.push(`  FUNNEL: chunks=${chunks.length} -> (1)=${cond1} -> (1)^(2)=${cond12} -> (1)^(2)^(3)=${final.length}`);
      L.push(`  (1) rate ${(100 * cond1 / chunks.length).toFixed(1)}%   ` +
        `FA tokens=${toks.length} unattributed-to-any-chunk=${unattributed}   ` +
        `committed boundaries=${run.committed.length - 1}`);
      L.push(`  (1)^(2) that FAIL (3): ${cond12 - final.length}`);
      L.push('');
      for (const r of final) {
        L.push(`   ${r.tag.padEnd(30)} pre=${r.preRuleBoundary.toFixed(3)} committed=${r.committedBoundary.toFixed(3)} ` +
          `gap=[${r.gapStart.toFixed(3)},${r.gapEnd.toFixed(3)}] w=${r.gapWidth.toFixed(3)} ` +
          `phantoms=${r.phantomCount} "${r.chunkTailText}"`);
        L.push(`   ${''.padEnd(30)} ear=${r.earStatus}  predicted: ${r.predictedDirection}`);
      }
      L.push('');

      summary[key] = {
        chunks: chunks.length, cond1, cond12, cond123: final.length,
        faTokens: toks.length, unattributed, boundaries: run.committed.length - 1,
      };
    }

    // ---- FINDING 1: does the set contain all 13 attributed defects? --------
    L.push('=== FINDING 1 — does (1)^(2)^(3) contain all 13 attributed defects? ===');
    const inSet = (corpus: string, tag: string): Row | undefined =>
      allRows.find(r => r.corpus === corpus && r.tag === tag);
    let hits = 0;
    for (const d of ATTRIBUTED) {
      const r = inSet(d.corpus, d.tag);
      if (r) hits++;
      L.push(`  ${r ? 'IN ' : 'OUT'}  ${d.corpus.padEnd(8)} ${d.tag}` +
        (r ? ` (gap ${r.gapWidth.toFixed(3)}s, ${r.phantomCount} phantom(s))` : ''));
    }
    L.push(`  -> ${hits}/13 attributed defects are in the set.`);
    L.push('  Rows the root-cause report attributes ELSEWHERE (not expected in the set):');
    for (const d of NOT_ATTRIBUTED) {
      const r = inSet(d.corpus, d.tag);
      L.push(`  ${r ? 'IN ' : 'OUT'}  ${d.corpus.padEnd(8)} ${d.tag} — ${d.why}`);
    }
    L.push('');

    // ---- FINDING 2: ear-verified-correct boundaries in the set -------------
    L.push('=== FINDING 2 — ear-verified-CORRECT boundaries in the set (S1 will move these) ===');
    const correctInSet = allRows.filter(r => r.earStatus === 'verified-correct');
    if (correctInSet.length === 0) L.push('  NONE.');
    for (const r of correctInSet) {
      L.push(`  ${r.corpus.padEnd(8)} ${r.tag.padEnd(30)} committed=${r.committedBoundary.toFixed(3)} ` +
        `gap=[${r.gapStart.toFixed(3)},${r.gapEnd.toFixed(3)}] w=${r.gapWidth.toFixed(3)} ` +
        `predicted: ${r.predictedDirection}`);
    }
    L.push(`  -> ${correctInSet.length} ear-verified-correct boundaries are in the set.`);
    L.push('');

    // ---- FINDING 3: the unaudited bill ------------------------------------
    L.push('=== FINDING 3 — unaudited boundaries in the set (the ear-listening bill) ===');
    const unaudited = allRows.filter(r => r.earStatus === 'unaudited');
    const heardElsewhere = allRows.filter(r => r.earStatus.startsWith('heard-elsewhere'));
    const defects = allRows.filter(r => r.earStatus.startsWith('verified-defect'));
    L.push(`  unaudited=${unaudited.length}  heard-elsewhere=${heardElsewhere.length} ` +
      `verified-defect=${defects.length}  verified-correct=${correctInSet.length}  TOTAL=${allRows.length}`);
    L.push('');

    // ---- THE GATE ---------------------------------------------------------
    const ratio = allRows.length / ATTRIBUTED.length;
    L.push('=== GATE — collateral ratio ===');
    L.push(`  |(1)^(2)^(3)| = ${allRows.length}, |attributed defects| = ${ATTRIBUTED.length}, ` +
      `ratio = ${ratio.toFixed(2)}:1`);
    L.push(`  Brief's stop threshold is "more than roughly triple" (3:1). ` +
      `VERDICT: ${ratio > 3 ? 'STOP AND REPORT' : 'PROCEED'}`);

    console.log(L.join('\n'));
    writeFileSync(resolve(OUT, `census-${LABEL}.txt`), L.join('\n') + '\n');
    writeFileSync(resolve(OUT, `census-${LABEL}.json`),
      JSON.stringify({ summary, rows: allRows, ledgerRows: EAR_PASS_LEDGER.length }, null, 2) + '\n');
  }, 1_800_000);
});
