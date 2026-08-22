/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// ---------------------------------------------------------------------------
// WS1 Session AE — STEP 1: THE INTERVAL WORD CENSUS.
//
// Generator, not a regression test: gated behind `WS1_SESSION_AE_MEASURE=1`
// so it never runs in the default sweep (same pattern as Session AD Step 6).
//
//   WS1_SESSION_AE_MEASURE=1 npx vitest run scripts/ws1-session-ae-census.test.ts
//
// Emits `.work-phase4/session-ae/step1-census-<corpus>.json`: one row per
// COMMITTED BOUNDARY (index >= 1) in v6 and 173, carrying every column the
// session brief's Step 1 table asks for. Rows are classified against
// `ws1-ear-pass-ledger.ts` — a row is a DEFECT iff the ledger's latest
// sitting rejects the committed value AND names a target; an EAR_CONTROL iff
// the ledger's latest sitting authorises the committed value; UNVERIFIED
// otherwise. Nothing here decides anything; it measures.
//
// TOKEN SPACE. Every ordinal below indexes `usableFaTokens` — the FILTERED FA
// array `alignScenestoTranscript` itself was given, which is what
// `AlignResult.firstTokenIdx` / `lastTokenIdx` index. Using the raw array
// would silently shift every ordinal.
// ---------------------------------------------------------------------------

import { mkdirSync, writeFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { describe, it } from 'vitest';

import { CORPORA, runProductionPath, tagOf } from './ws1-session-p-pipeline';
import { earHistory, type Corpus } from './ws1-ear-pass-ledger';

const MEASURE = process.env.WS1_SESSION_AE_MEASURE === '1';
const OUT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '.work-phase4', 'session-ae');

/** The FA reliability line Session AB derived and Session AD carried. */
const CONF_RELIABILITY_LINE = 0.056;
/** Ledger match tolerance for "is this the value the sitting scored". */
const TOL = 0.005;

interface CensusWord { text: string; startSec: number; endSec: number; confidence: number; ordinal: number; ownerTag: string | null; }

interface CensusRow {
  corpus: Corpus;
  index: number;
  tag: string;
  leftTag: string;
  committed: number;
  earCorrect: number | null;
  delta: number | null;
  cls: 'DEFECT' | 'EAR_CONTROL' | 'UNVERIFIED';
  /** FA word ONSETS strictly inside (committed, earCorrect) — the census. */
  intervalWords: CensusWord[];
  intervalWordCount: number | null;
  /** Hirschberg ordinals. */
  leftLastTokenIdx: number;
  rightFirstTokenIdx: number;
  lastFaWordBeforeCommitted: number;
  /** `lastFaWordBeforeCommitted - leftLastTokenIdx`. 0 == placement class. */
  ordinalDelta: number | null;
  /** The word gap the boundary is supposed to live in. */
  gapStart: number | null;
  gapEnd: number | null;
  gapWidth: number | null;
  committedInGap: boolean | null;
  earCorrectInGap: boolean | null;
  earCorrectFraction: number | null;
  committedFraction: number | null;
  leftAnchorConf: number | null;
  rightAnchorConf: number | null;
  leftAnchorBelowLine: boolean | null;
  rightAnchorBelowLine: boolean | null;
  /** Direction of the correction, when one is known. */
  direction: 'EARLY' | 'LATE' | null;
}

/** The ledger's verdict on the value production commits today, plus the
 *  target the latest sitting names for the same (corpus, tag) if any. */
function ledgerVerdict(corpus: Corpus, tag: string, committed: number):
  { cls: CensusRow['cls']; earCorrect: number | null } {
  const h = earHistory(corpus, tag);
  if (h.length === 0) return { cls: 'UNVERIFIED', earCorrect: null };
  const onCommitted = h.find(r => r.scoredValue !== null && Math.abs(r.scoredValue - committed) < TOL);
  if (onCommitted && onCommitted.verdict === 'CORRECT') return { cls: 'EAR_CONTROL', earCorrect: committed };
  if (onCommitted && onCommitted.verdict !== 'CORRECT') {
    // Latest CORRECT row for the same tag names the target.
    const target = h.find(r => r.verdict === 'CORRECT' && r.scoredValue !== null);
    return { cls: 'DEFECT', earCorrect: target?.scoredValue ?? null };
  }
  return { cls: 'UNVERIFIED', earCorrect: null };
}

async function censusFor(key: 'v6' | '173' | 'spanish'): Promise<CensusRow[]> {
  const run = await runProductionPath(CORPORA[key]!, false);
  const toks = run.usableFaTokens;
  const corpus = key as Corpus;

  // Ordinal -> owning scripted segment, per the Hirschberg path's own
  // per-segment claim window. Read-only use of the aligner's output.
  const owner = new Map<number, string>();
  run.keptAlignments.forEach((a, i) => {
    if (a.firstTokenIdx < 0 || a.lastTokenIdx < 0) return;
    for (let t = a.firstTokenIdx; t <= a.lastTokenIdx; t++) if (!owner.has(t)) owner.set(t, tagOf(run.committed[i]!));
  });

  const rows: CensusRow[] = [];
  for (let i = 1; i < run.committed.length; i++) {
    const seg = run.committed[i]!;
    const tag = tagOf(seg);
    const leftTag = tagOf(run.committed[i - 1]!);
    const committed = seg.startTime;
    const { cls, earCorrect } = ledgerVerdict(corpus, tag, committed);

    const lA = run.keptAlignments[i - 1]!;
    const rA = run.keptAlignments[i]!;
    const lIdx = lA.lastTokenIdx;
    const rIdx = rA.firstTokenIdx;
    const lTok = lIdx >= 0 ? toks[lIdx] : undefined;
    const rTok = rIdx >= 0 ? toks[rIdx] : undefined;

    let lastBefore = -1;
    for (let t = 0; t < toks.length; t++) { if (toks[t]!.startSec < committed) lastBefore = t; else break; }

    let intervalWords: CensusWord[] = [];
    if (earCorrect !== null && Math.abs(earCorrect - committed) > 1e-9) {
      const lo = Math.min(committed, earCorrect), hi = Math.max(committed, earCorrect);
      intervalWords = toks
        .map((w, ordinal) => ({ ...w, ordinal }))
        .filter(w => w.startSec > lo && w.startSec < hi)
        .map(w => ({
          text: w.text, startSec: w.startSec, endSec: w.endSec,
          confidence: (w as { confidence?: number }).confidence ?? NaN,
          ordinal: w.ordinal, ownerTag: owner.get(w.ordinal) ?? null,
        }));
    }

    const gapStart = lTok ? lTok.endSec : null;
    const gapEnd = rTok ? rTok.startSec : null;
    const gapWidth = gapStart !== null && gapEnd !== null ? gapEnd - gapStart : null;
    const frac = (v: number | null): number | null =>
      v === null || gapStart === null || gapWidth === null || gapWidth <= 0 ? null : (v - gapStart) / gapWidth;

    rows.push({
      corpus, index: i, tag, leftTag, committed, earCorrect,
      delta: earCorrect === null ? null : earCorrect - committed,
      cls, intervalWords,
      intervalWordCount: earCorrect === null ? null : intervalWords.length,
      leftLastTokenIdx: lIdx, rightFirstTokenIdx: rIdx, lastFaWordBeforeCommitted: lastBefore,
      ordinalDelta: lIdx < 0 ? null : lastBefore - lIdx,
      gapStart, gapEnd, gapWidth,
      committedInGap: gapStart === null || gapEnd === null ? null : committed >= gapStart && committed <= gapEnd,
      earCorrectInGap: earCorrect === null || gapStart === null || gapEnd === null ? null
        : earCorrect >= gapStart && earCorrect <= gapEnd,
      earCorrectFraction: frac(earCorrect), committedFraction: frac(committed),
      leftAnchorConf: lTok ? ((lTok as { confidence?: number }).confidence ?? null) : null,
      rightAnchorConf: rTok ? ((rTok as { confidence?: number }).confidence ?? null) : null,
      leftAnchorBelowLine: lTok ? (((lTok as { confidence?: number }).confidence ?? 1) < CONF_RELIABILITY_LINE) : null,
      rightAnchorBelowLine: rTok ? (((rTok as { confidence?: number }).confidence ?? 1) < CONF_RELIABILITY_LINE) : null,
      direction: earCorrect === null ? null : earCorrect > committed ? 'EARLY' : 'LATE',
    });
  }
  return rows;
}

describe.skipIf(!MEASURE)('WS1 Session AE — Step 1 interval word census', () => {
  for (const key of ['v6', '173', 'spanish'] as const) {
    it(`censuses ${key}`, async () => {
      const rows = await censusFor(key);
      mkdirSync(OUT, { recursive: true });
      writeFileSync(resolve(OUT, `step1-census-${key}.json`), JSON.stringify({ corpus: key, rows }, null, 1));
      const defects = rows.filter(r => r.cls === 'DEFECT');
      const controls = rows.filter(r => r.cls === 'EAR_CONTROL');
      console.log(`[${key}] boundaries=${rows.length} defects=${defects.length} earControls=${controls.length} unverified=${rows.filter(r => r.cls === 'UNVERIFIED').length}`);
      for (const d of defects) {
        console.log(`  DEFECT ${d.tag} committed=${d.committed.toFixed(3)} ear=${d.earCorrect?.toFixed(3)} delta=${d.delta?.toFixed(3)} words=${d.intervalWordCount} ordDelta=${d.ordinalDelta} gap=[${d.gapStart?.toFixed(3)},${d.gapEnd?.toFixed(3)}] fracEar=${d.earCorrectFraction?.toFixed(3)}`);
      }
    }, 600_000);
  }
});
