/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// ---------------------------------------------------------------------------
// WS1 Task 5 Slice D14 A3 — residual diagnosis for index-45s.
//
// D13 §5 ASSERTED, without measuring it, that the gap between `index-45s`'s
// own disagreement (vs. the whole-file reference) and full oracle `B`'s is
// "attributable to a named, already-quantified cause (boundary placement,
// faAnchors.ts, out of scope)" — that is Step 5's own skipped question: does
// each chunk's OWN disagreement actually correlate with how imprecise ITS OWN
// bounding anchor is, or is the residual something else?
//
// "Anchor-time error" here means: the real anchor time an internal chunk
// boundary sits at (an R.1 boundary — the silence-agreement-derived onset
// `faAnchors.ts` assigns a script word, itself sourced from Whisper token
// times + silence detection, NOT from forced alignment) compared against the
// WHOLE-FILE FA REFERENCE's own measured onset for the nearest word in time.
// A chunk boundary's seconds value IS an anchor's own `timeSec` by
// construction — `coalesceRuns`/`coalesceRunQiRanges` only ever ADOPT an
// original run's own edge value, never interpolate a new one, and
// `attributeByIndex`'s degenerate-run folding only ever reassigns a chunk's
// edge to some OTHER already-existing run's own edge — so no translation
// through `FaAnchor`/`qi` is needed here at all. (An earlier version of this
// script tried to recover each chunk's `[qiLo, qiHi)` from cumulative
// per-token `normalizeSceneDoc` counts and index directly into the Rust FA
// output arrays — WRONG, caught by its own precondition check: `qi` lives in
// `normalizeSceneDoc`'s word space (589 words on this excerpt), but the FA
// output word arrays live in Rust's `normalize_for_forced_alignment` space
// (569 words) — the two do not share an index space, exactly the "text
// domain" gap D13 Step 3 already documented for a different reason. Matching
// by TIME instead sidesteps this entirely.)
//
// Inputs (all already produced by other scripts/tests in this same
// `$FA_CHUNK_PLAN_DIR`, nothing here runs ONNX itself):
//   - 173-excerpt-240s-index-45s.json         (chunk plan: startSec/endSec/text)
//   - 173-excerpt-240s-reference-words.json   (whole-file FA reference words)
//   - 173-excerpt-240s-index-45s-words.json   (index-45s windowed FA words)
//
// NOT part of npm test/build. Run via:
//   FA_CHUNK_PLAN_DIR=<dir> npx tsx scripts/fa-index-45s-residual-diagnosis.ts
// ---------------------------------------------------------------------------

import { readFileSync } from 'fs';

const PLAN_DIR = process.env.FA_CHUNK_PLAN_DIR;
if (!PLAN_DIR) {
  console.error('FA_CHUNK_PLAN_DIR must be set (same dir the Rust d13_measurement tests wrote into).');
  process.exit(1);
}
// A nearest-by-time match further than this from the anchor's own claimed
// time would suggest the wrong reference word was picked, not a genuine
// anchor-time error — worth a loud warning, not a silent number.
const NEAREST_MATCH_SANITY_SEC = 0.5;

interface RefWord { text: string; start: number; end: number }
interface PlanChunk { startSec: number; endSec: number; text: string }

function load<T>(filename: string): T {
  return JSON.parse(readFileSync(`${PLAN_DIR}/${filename}`, 'utf-8'));
}

function mean(xs: number[]): number {
  return xs.length === 0 ? NaN : xs.reduce((a, b) => a + b, 0) / xs.length;
}
function max(xs: number[]): number {
  return xs.length === 0 ? NaN : Math.max(...xs);
}

/** Pearson correlation coefficient. NaN if either series has zero variance
 *  (undefined correlation) rather than dividing by zero silently. */
function pearson(xs: number[], ys: number[]): number {
  const n = xs.length;
  if (n !== ys.length || n < 2) return NaN;
  const mx = mean(xs);
  const my = mean(ys);
  let cov = 0, vx = 0, vy = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i]! - mx;
    const dy = ys[i]! - my;
    cov += dx * dy;
    vx += dx * dx;
    vy += dy * dy;
  }
  if (vx === 0 || vy === 0) return NaN;
  return cov / Math.sqrt(vx * vy);
}

/** Nearest reference word to `t` by |start - t|, plus the gap — used to look
 *  up "what the whole-file reference itself says" at a chunk-boundary anchor
 *  time, without needing a shared index space with the FA output arrays. */
function nearestByStart(words: RefWord[], t: number): { idx: number; gap: number } {
  let bestIdx = 0;
  let bestGap = Infinity;
  for (let i = 0; i < words.length; i++) {
    const gap = Math.abs(words[i]!.start - t);
    if (gap < bestGap) {
      bestGap = gap;
      bestIdx = i;
    }
  }
  return { idx: bestIdx, gap: bestGap };
}

function main() {
  const chunkPlan = load<{ audioDuration: number; chunks: PlanChunk[] }>('173-excerpt-240s-index-45s.json');
  const referenceWords = load<RefWord[]>('173-excerpt-240s-reference-words.json');
  const windowedWords = load<RefWord[]>('173-excerpt-240s-index-45s-words.json');

  if (referenceWords.length !== windowedWords.length) {
    console.error(
      `A3 precondition failed: reference has ${referenceWords.length} words, index-45s windowed output has ` +
      `${windowedWords.length} — Step 4's own matched=569/569 result assumed equal length/order. Re-run ` +
      'whisper_triage_index (or index_45s) before trusting this diagnosis.',
    );
    process.exit(1);
  }
  for (let i = 0; i < referenceWords.length; i++) {
    if (referenceWords[i]!.text !== windowedWords[i]!.text) {
      console.error(
        `A3 precondition failed: word ${i} text mismatch ("${referenceWords[i]!.text}" vs. "${windowedWords[i]!.text}") — ` +
        'reference and windowed word arrays are not the same ordered sequence; cannot pair them positionally.',
      );
      process.exit(1);
    }
  }
  console.log(`Precondition OK: reference and index-45s windowed output are ${referenceWords.length} words, identical text/order.`);

  // --- Bucket words into their own chunk BY TIME (windowed word's own
  // start), not by any qi/index-space translation. ---
  const chunks = chunkPlan.chunks;
  const bucket: number[][] = chunks.map(() => []);
  for (let i = 0; i < windowedWords.length; i++) {
    const t = windowedWords[i]!.start;
    let c = 0;
    while (c < chunks.length - 1 && t >= chunks[c]!.endSec) c++;
    bucket[c]!.push(i);
  }
  const totalBucketed = bucket.reduce((n, b) => n + b.length, 0);
  if (totalBucketed !== windowedWords.length) {
    console.error(`A3 internal error: bucketed ${totalBucketed} words, expected ${windowedWords.length}.`);
    process.exit(1);
  }

  type Row = {
    chunk: number; startSec: number; endSec: number; words: number;
    meanStartDiff: number; maxStartDiff: number; meanEndDiff: number; maxEndDiff: number;
    edgeStartDiff: number; edgeEndDiff: number;
    leftAnchorError: number | null; leftMatchGap: number | null;
    rightAnchorError: number | null; rightMatchGap: number | null;
  };

  // Anchor-time error at each of the 6 internal boundaries, shared between
  // the chunk that ends there and the one that starts there (same value both
  // sides — one anchor, two neighbors, mirroring the gapless-partition
  // invariant itself).
  const boundaryError: Array<{ error: number; gap: number } | null> = [null]; // index 0 unused (before chunk 0)
  for (let c = 0; c < chunks.length - 1; c++) {
    const boundaryTime = chunks[c]!.endSec; // === chunks[c+1].startSec
    const { idx, gap } = nearestByStart(referenceWords, boundaryTime);
    if (gap > NEAREST_MATCH_SANITY_SEC) {
      console.warn(
        `WARNING: boundary ${c}/${c + 1} at t=${boundaryTime.toFixed(4)}s — nearest reference word ` +
        `("${referenceWords[idx]!.text}" at ${referenceWords[idx]!.start.toFixed(4)}s) is ${gap.toFixed(4)}s away, ` +
        `over the ${NEAREST_MATCH_SANITY_SEC}s sanity threshold — likely picked the wrong word, not a genuine anchor error.`,
      );
    }
    boundaryError.push({ error: Math.abs(referenceWords[idx]!.start - boundaryTime), gap });
  }

  const rows: Row[] = [];
  for (let c = 0; c < chunks.length; c++) {
    const idxs = bucket[c]!;
    const startDiffs = idxs.map(i => Math.abs(referenceWords[i]!.start - windowedWords[i]!.start));
    const endDiffs = idxs.map(i => Math.abs(referenceWords[i]!.end - windowedWords[i]!.end));
    const left = c === 0 ? null : boundaryError[c];
    const right = c === chunks.length - 1 ? null : boundaryError[c + 1];

    rows.push({
      chunk: c,
      startSec: chunks[c]!.startSec,
      endSec: chunks[c]!.endSec,
      words: idxs.length,
      meanStartDiff: mean(startDiffs),
      maxStartDiff: max(startDiffs),
      meanEndDiff: mean(endDiffs),
      maxEndDiff: max(endDiffs),
      edgeStartDiff: startDiffs[0] ?? NaN,
      edgeEndDiff: endDiffs[endDiffs.length - 1] ?? NaN,
      leftAnchorError: left?.error ?? null,
      leftMatchGap: left?.gap ?? null,
      rightAnchorError: right?.error ?? null,
      rightMatchGap: right?.gap ?? null,
    });
  }

  console.log('\n=== A3 per-chunk residual diagnosis (index-45s) ===');
  console.log(
    'chunk\t[start,end)\twords\tmeanStartD\tmaxStartD\tmeanEndD\tmaxEndD\tedgeStartD\tedgeEndD\tleftAnchorErr\trightAnchorErr',
  );
  for (const r of rows) {
    console.log(
      `${r.chunk}\t[${r.startSec.toFixed(2)},${r.endSec.toFixed(2)})\t${r.words}\t` +
      `${r.meanStartDiff.toFixed(4)}\t${r.maxStartDiff.toFixed(4)}\t${r.meanEndDiff.toFixed(4)}\t${r.maxEndDiff.toFixed(4)}\t` +
      `${r.edgeStartDiff.toFixed(4)}\t${r.edgeEndDiff.toFixed(4)}\t` +
      `${r.leftAnchorError === null ? 'corpus-start' : r.leftAnchorError.toFixed(4)}\t` +
      `${r.rightAnchorError === null ? 'corpus-end' : r.rightAnchorError.toFixed(4)}`,
    );
  }

  const startPairs = rows.filter(r => r.leftAnchorError !== null);
  const endPairs = rows.filter(r => r.rightAnchorError !== null);
  const rEdgeStart = pearson(startPairs.map(r => r.edgeStartDiff), startPairs.map(r => r.leftAnchorError!));
  const rEdgeEnd = pearson(endPairs.map(r => r.edgeEndDiff), endPairs.map(r => r.rightAnchorError!));
  const rMeanStart = pearson(startPairs.map(r => r.meanStartDiff), startPairs.map(r => r.leftAnchorError!));
  const rMeanEnd = pearson(endPairs.map(r => r.meanEndDiff), endPairs.map(r => r.rightAnchorError!));
  const rMaxStart = pearson(startPairs.map(r => r.maxStartDiff), startPairs.map(r => r.leftAnchorError!));
  const rMaxEnd = pearson(endPairs.map(r => r.maxEndDiff), endPairs.map(r => r.rightAnchorError!));

  console.log('\n=== A3 correlation (chunk disagreement vs. its own bounding anchor-time error) ===');
  console.log(`n(start pairs, excludes the corpus-start chunk) = ${startPairs.length}`);
  console.log(`n(end pairs, excludes the corpus-end chunk)     = ${endPairs.length}`);
  console.log(`pearson(edgeStartDiff, leftAnchorError)  = ${rEdgeStart.toFixed(4)}  (boundary word only)`);
  console.log(`pearson(edgeEndDiff,   rightAnchorError) = ${rEdgeEnd.toFixed(4)}  (boundary word only)`);
  console.log(`pearson(meanStartDiff, leftAnchorError)  = ${rMeanStart.toFixed(4)}  (whole-chunk mean)`);
  console.log(`pearson(meanEndDiff,   rightAnchorError) = ${rMeanEnd.toFixed(4)}  (whole-chunk mean)`);
  console.log(`pearson(maxStartDiff,  leftAnchorError)  = ${rMaxStart.toFixed(4)}  (whole-chunk max)`);
  console.log(`pearson(maxEndDiff,    rightAnchorError) = ${rMaxEnd.toFixed(4)}  (whole-chunk max)`);
}

main();
