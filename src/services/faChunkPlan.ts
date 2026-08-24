/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// ---------------------------------------------------------------------------
// Forced-alignment CHUNK PLAN (WS1 Task 5 Slice D11).
//
// D10 (`docs/ws1-sync-pipeline/measurements/d10-runtime-observations-
// 2026-08-13.md`) proved a whole-file FA pass is infeasible at production
// audio length (240s already peaks at 19.5GiB, accelerating; a 709s project
// extrapolates to 60-154GB). Windowing is mandatory. `faAnchors.ts`'s
// `computeFaAnchors` (unmodified, untouched by this module) already computes
// the R.0/R.1/R.4 run structure — maximal `MAX_RUN_SEC`-bounded audio windows
// bounded by three-source-agreement anchors or a force-split — but its
// returned `FaRun`/`Boundary` shape carries no `qi` (script-word index), so
// it cannot itself answer "what TEXT does chunk k get aligned against."
//
// STEP 0 DESIGN REVIEW RESOLUTION (this slice, owner-approved): chunk TEXT is
// derived from `project.segments`' own `startTime` — a segment belongs to
// exactly the run whose `[windowStart, windowEnd)` contains that segment's
// `startTime` — NOT from `qi`. This works uniformly for every run boundary
// provenance (agreed-anchor, corpus-start/end, AND forced-split alike, where
// no `qi` exists at all by construction) and needs no new heuristic: it
// reuses Model P (`project.segments` gaplessly and monotonically partitions
// `[0, audioDuration)` — `CLAUDE.md` §4) and `faAnchors.ts`'s own I1/I2
// guarantee that `runs[]` does the same, so every segment's `startTime` lands
// in exactly one run. R.0's own text licenses this directly: "a run is a
// maximal contiguous group of committed SEGMENTS" (`sync-pipeline-v2-plan.md`).
//
// `queryWords`/`subjectWords`/`subjectTokenIdx` construction below mirrors
// `whisperService.ts`'s `extractSegmentAlignments` (its own `tokenWords`
// expansion at lines ~799-805 and `queryWords`/segment-range construction at
// ~811-821) byte-for-byte in technique — NOT a call into that function
// (unmodified, untouched, scope-prohibited) — because `computeFaAnchors`
// needs the same `qi` space (`alignment.ops[].qi`) that construction produces
// for its OWN internal R.1 admissibility test (contiguous-match-run length,
// silence agreement). This module never reads `qi` back out for chunk text —
// only `computeFaAnchors`'s `runs[]` (time windows) is consumed downstream.
// ---------------------------------------------------------------------------

import type { TranscriptToken, VideoSegment } from '../types';
import type { SilenceInterval } from './silenceDetector';
import { alignQueryToSubject, normalize, normalizeSceneDoc } from './whisperService';
import { computeFaAnchors, type FaAnchor, type FaRun } from './faAnchors';
import { normalizeForForcedAlignment, type FaLanguageCode } from './faTextNormalize';

/** One forced-alignment chunk: an audio time window (raw, unpadded — R.2
 *  padding is out of scope for this slice) and the script text to align
 *  against it. `endSec - startSec <= MAX_RUN_SEC` for every chunk except a
 *  degenerate merge (see module doc comment on empty-run merging below). */
export interface FaChunk {
  startSec: number;
  endSec: number;
  text: string;
}

/** One raw (whitespace-split, UNNORMALIZED) script token, tagged with the
 *  half-open `queryWords` index range it contributed. `qiStart === qiEnd` for a
 *  token that normalizes to nothing (a stage direction, a punctuation-only
 *  token) — such a token still carries real text that must survive into some
 *  chunk, so it is placed by `qiStart` alone (see `attributeByIndex`). */
interface RawScriptToken {
  text: string;
  qiStart: number;
  qiEnd: number;
}

/**
 * One maximal stretch of transcribed audio that no committed segment's script
 * accounts for — R.5's unit of work. `[tokenLo, tokenHi]` are inclusive Whisper
 * token indices; `[startSec, endSec]` is the audio span they cover; `qiSplit`
 * is the first script-word (`qi`) index whose matched token lies AFTER the run,
 * i.e. the exact point in the script at which the run interrupts it.
 */
export interface UnscriptedRun {
  tokenLo: number;
  tokenHi: number;
  startSec: number;
  endSec: number;
  qiSplit: number;
}

/** Everything one pass over the alignment produces. `computeRuns` returns only
 *  `runs` from this (its historical shape); index attribution additionally
 *  needs `anchors` (for their `qi`) and the raw-token/`qi` correspondence. */
interface RunContext {
  runs: FaRun[];
  anchors: readonly FaAnchor[];
  rawTokens: RawScriptToken[];
  totalQi: number;
  unscripted: UnscriptedRun[];
}

/**
 * Computes the raw `FaRun[]` window structure for a forced-alignment run —
 * the shared first half of `computeFaChunkPlan`, `computeFaChunkPlanCoalesced`
 * and the index-attribution variants below (`computeFaAnchors` itself, and the
 * `tokenWords`/`queryWords` alignment construction feeding it, are identical
 * for all of them; only what happens to `runs` afterward differs).
 *
 * PER-TOKEN NORMALIZATION FAITHFULNESS (WS1 Task 5 Slice D13 Step 3): the
 * `rawTokens` map below normalizes each whitespace token INDIVIDUALLY, while
 * `queryWords` normalizes each segment WHOLE. These agree only if
 * `normalizeSceneDoc` never lets one raw token's normalization depend on a
 * neighboring one — not guaranteed in general, since `stripStageDirections`
 * works over a whole string and a stage direction can span tokens. Measured on
 * the real 173 corpus (`scripts/fa-run-distribution.ts`'s sibling probe, Slice
 * D13): 63/63 segments agree. Rather than trust that, `assertQiMapConsistent`
 * below re-derives the whole-segment normalization and rejects a mismatch, so
 * a corpus where the two diverge fails loudly instead of silently mis-cutting
 * text.
 */
function computeRunContext(
  segments: readonly VideoSegment[],
  tokens: readonly TranscriptToken[],
  silences: readonly SilenceInterval[],
  audioDuration: number,
  languageCode?: FaLanguageCode,
): RunContext {
  // Mirrors whisperService.ts's extractSegmentAlignments `tokenWords`
  // expansion: a Whisper token may canonicalize to multiple (or zero) words.
  // `languageCode` (Phase 3c, qi-bookkeeping-only — see textNormalize.ts's
  // own doc comment): omitted by every call site except this one's own
  // caller, so the frozen English path never takes the non-English branch.
  const tokenWords: Array<{ word: string; tokenIdx: number }> = [];
  for (let i = 0; i < tokens.length; i++) {
    for (const word of normalize(tokens[i]!.text, languageCode)) {
      if (word.length > 0) tokenWords.push({ word, tokenIdx: i });
    }
  }

  // Mirrors extractSegmentAlignments's `queryWords` construction — every
  // segment's scene-doc-normalized words, concatenated in segment order.
  const queryWords: string[] = [];
  const rawTokens: RawScriptToken[] = [];
  const segQiRanges: Array<{ start: number; end: number }> = [];
  for (const seg of segments) {
    const words = seg.text && seg.text.trim() ? normalizeSceneDoc(seg.text, languageCode) : [];
    const segQiStart = queryWords.length;
    for (const w of words) if (w.length > 0) queryWords.push(w);
    segQiRanges.push({ start: segQiStart, end: queryWords.length });

    if (!seg.text || !seg.text.trim()) continue;
    let qi = segQiStart;
    for (const raw of seg.text.split(/\s+/)) {
      if (raw.length === 0) continue;
      const produced = normalizeSceneDoc(raw, languageCode).filter(w => w.length > 0).length;
      rawTokens.push({ text: raw, qiStart: qi, qiEnd: qi + produced });
      qi += produced;
    }
    assertQiMapConsistent(qi, queryWords.length, seg.id);
  }

  const subjectWords = tokenWords.map(t => t.word);
  const subjectTokenIdx = tokenWords.map(t => t.tokenIdx);
  const alignment = alignQueryToSubject(queryWords, subjectWords);

  const { anchors, runs } = computeFaAnchors(alignment, tokens, silences, audioDuration, subjectTokenIdx);
  const unscripted = detectUnscriptedRuns(alignment.matchedSubjectOf, subjectTokenIdx, segQiRanges, tokens);

  return { runs, anchors, rawTokens, totalQi: queryWords.length, unscripted };
}

// ---------------------------------------------------------------------------
// R.5 — UNSCRIPTED AUDIO (WS1 Session D).
//
// BOTH SIDES (ruling R-AO — every rule states and tests both sides of what it
// constrains, and the statement is enforced by `ruleBothSides.test.ts`):
//   START of the excision — the run's own `startSec`, the first transcribed
//     token no scene's script accounts for.
//   END of the excision — the run's own `endSec` together with `qiSplit`, the
//     script word index at which the script resumes. Both edges are carried on
//     `UnscriptedRun` and both are exercised by `faChunkPlan.test.ts`'s R.5
//     block; neither edge is inferred from the other.
//   NOT COVERED BY THIS RULE, stated so the gap is deliberate rather than
//     assumed: where the COMMITTED BOUNDARY lands relative to the excised run.
//     That is R.12 (opening edge) and R.13 (closing edge) in
//     `faRunPlacementGate.ts`, and it is a separate rule because the boundary
//     does not exist yet when R.5 runs.
//
// THE DEFECT. Between two committed segments the narrator can say something
// that appears in NO segment's script — V6's ten spoken "Level N ..." chapter
// recitations are the measured instance (2.79-5.58s each). Forced alignment
// must place every target token somewhere, so a chunk window that spans such a
// recitation hands the neighbouring segments' words audio that is not theirs:
// measured, FA puts `042_eleven_years` ("You are eleven.") onto the Level-two
// recitation at [125.96, 128.34] and the following boundary lands at 128.43
// against an ear-correct 130.96 (ear-pass items 4 and 5).
//
// DETECTION — TWO STRUCTURAL TESTS, NO THRESHOLD. WS1 Session C specified a
// fuzzy-containment cut at 0.65 measured with a Python `SequenceMatcher`
// stand-in, and flagged that the number had to be re-derived against
// production code. Session D re-derived it and the stand-in does NOT transfer:
// against the production matcher the ten true recitations score 0.2500-0.6000
// and the 38 false candidates 0.0000-0.4000 — overlapping, and inverted
// relative to the proxy, so no threshold separates them at all. What separates
// them exactly is a pair of INDEX-SPACE tests, which is what `CLAUDE.md` §4's
// "timestamps may measure distance; they must never decide identity" asks for:
//
//   unscripted-audio run  <=>  run length >= MIN_UNSCRIPTED_RUN_TOKENS
//                         AND  no unmatched SCRIPT word lies opposite it
//
// The second test is the whole rule. A false candidate is a MIS-TOKENIZATION of
// a word that IS in the script ("Catachan" arriving as `Cat`+`ac`+`an`,
// "Scylla" as `S`+`illa`), so the script word it fragments necessarily failed
// to match — the script side shows a hole. Genuinely unscripted audio has no
// script counterpart to fail, so every script word bracketing it matched and
// the hole is EXACTLY ZERO. Measured over all three corpora: 48 raw runs, and
// `qiHole === 0` selects 10 of them — the ten recitations Step K counted
// independently — with ZERO false positives (the next-best candidate sits at
// 1, so this is a structural zero and not a tuned edge, the same shape as
// R-U's zero-seam veto).
//
// BEHAVIOUR — EXCISION, the realisable form of R.5's "CTC wildcard". The
// original spec called for a wildcard token absorbing the span at zero
// alignment cost. `fa_viterbi.rs` implements standard CTC with a blank symbol
// and has no wildcard label, so that form is not reachable from this module.
// Excising the span from the chunk window is the same thing acoustically —
// the neighbouring segments' words are never offered those frames — and it is
// reachable here: the containing chunk is split into the part before the run
// and the part after it, cut in the SCRIPT at `qiSplit`. `align_chunked`
// (`fa_onnx.rs`) processes each chunk independently and offsets its words by
// `chunk.start_sec`, so a gap between chunk windows is legal there; the chunk
// plan has never been required to partition `[0, audioDuration)` (that is
// Model P, which governs `project.segments`, not this array). Per ruling R-E
// the excised seconds belong to the PRECEDING segment, which is what falls out
// of leaving the boundary between the two split chunks unclaimed.
//
// AMENDED for the COMMITTED-BOUNDARY case (owner ruling 3, WS1 Session H).
// This applies to the CHUNK-PLAN excision above and is unchanged and correct.
// It does NOT extend to where `snapCoveredBoundaries` later snaps the
// committed segment boundary — nine of V6's ten runs turned out to hold a
// committed boundary on a silence strictly inside the run, and the
// ear-correct destination for THAT boundary is the FOLLOWING segment, not the
// preceding one. `faRunPlacementGate.ts` (R.12) owns the correction; see its
// own header for the full amendment text and `sync-pipeline-v2-plan.md`'s R-E
// entries for the ruling record.
// ---------------------------------------------------------------------------

/** R.5's length floor: a run must be at least this many Whisper tokens to be
 *  considered unscripted at all. Not a tuned threshold — it is the shortest
 *  run that can carry a recitation, and it is inherited unchanged from WS1
 *  Session C's spec, which measured it as sufficient (the ten true positives
 *  run 4-12 tokens; the floor never binds on them). Its only job is to keep
 *  one- and two-token transcription hiccups out of the candidate set before
 *  the zero-hole test runs. */
const MIN_UNSCRIPTED_RUN_TOKENS = 3;

/**
 * Every maximal run of Whisper tokens that no matched segment's span claims AND
 * that no unmatched script word sits opposite — see the R.5 section header for
 * why those two tests, and only those two, are the rule.
 *
 * "Claimed" is the SPAN rule, matching `whisperService.ts`'s
 * `extractSegmentAlignments`: a token is claimed if it lies anywhere inside
 * some segment's `[firstTokenIdx, lastTokenIdx]`, interior non-matches
 * included. A token that merely failed to match INSIDE a segment its
 * neighbours bracket is that segment's problem, not surplus audio.
 */
export function detectUnscriptedRuns(
  matchedSubjectOf: ArrayLike<number>,
  subjectTokenIdx: ArrayLike<number>,
  segQiRanges: readonly { start: number; end: number }[],
  tokens: readonly TranscriptToken[],
): UnscriptedRun[] {
  if (tokens.length === 0) return [];

  // Each segment's matched token span, derived from the alignment already
  // computed rather than from a second `extractSegmentAlignments` pass (V6's
  // Hirschberg pass costs seconds; running it twice for the same answer is not
  // worth it).
  const claimed = new Uint8Array(tokens.length);
  for (const range of segQiRanges) {
    let lo = -1;
    let hi = -1;
    for (let qi = range.start; qi < range.end; qi++) {
      const sj = matchedSubjectOf[qi];
      if (sj === undefined || sj < 0) continue;
      const ti = subjectTokenIdx[sj];
      if (ti === undefined || ti < 0) continue;
      if (lo < 0 || ti < lo) lo = ti;
      if (ti > hi) hi = ti;
    }
    if (lo < 0) continue;
    for (let i = lo; i <= hi && i < tokens.length; i++) claimed[i] = 1;
  }

  // `qi -> token index` for every matched script word, so the script-side hole
  // and the split point are both read off the index space directly.
  const qiToken = new Int32Array(matchedSubjectOf.length).fill(-1);
  for (let qi = 0; qi < matchedSubjectOf.length; qi++) {
    const sj = matchedSubjectOf[qi];
    if (sj === undefined || sj < 0) continue;
    const ti = subjectTokenIdx[sj];
    if (ti !== undefined && ti >= 0) qiToken[qi] = ti;
  }

  const out: UnscriptedRun[] = [];
  for (let scan = 0; scan < tokens.length; scan++) {
    if (claimed[scan]) continue;
    const lo = scan;
    let hi = scan;
    while (hi + 1 < tokens.length && !claimed[hi + 1]) hi++;
    scan = hi; // maximal run consumed either way

    if (hi - lo + 1 < MIN_UNSCRIPTED_RUN_TOKENS) continue;

    // Bracket the run in script space: the last script word matched strictly
    // before it, and the first matched strictly after it.
    let qiBefore = -1;
    let qiAfter = qiToken.length;
    for (let qi = 0; qi < qiToken.length; qi++) {
      const ti = qiToken[qi]!;
      if (ti < 0) continue;
      if (ti < lo) qiBefore = qi;
      else if (ti > hi) { qiAfter = qi; break; }
    }

    // THE RULE: is any script word opposite this audio unmatched?
    let hole = 0;
    for (let qi = qiBefore + 1; qi < qiAfter; qi++) if (qiToken[qi]! < 0) hole++;
    if (hole !== 0) continue;

    out.push({
      tokenLo: lo, tokenHi: hi,
      startSec: tokens[lo]!.startSec, endSec: tokens[hi]!.endSec,
      qiSplit: qiAfter,
    });
  }
  return out;
}

/**
 * Splits any chunk that wholly contains an unscripted run into the part before
 * the run and the part after it, excising the run's own seconds from both.
 *
 * A side that would carry NO text is not emitted — the window is trimmed
 * instead. That is not an edge case bolted on: V6's first recitation sits at
 * corpus start with no preceding segment at all, so its "before" side is
 * legitimately empty, and Rust's `text_to_token_ids` rejects an empty-text
 * chunk outright (`EmptyTokenization`). A run that is not wholly inside one
 * chunk is left alone rather than guessed at; measured on the real corpora all
 * ten are wholly contained, so this is a correctness guard, not a tuned path.
 */
function exciseUnscriptedRuns(
  chunks: readonly FaChunk[],
  unscripted: readonly UnscriptedRun[],
  textQi: ReadonlyMap<FaChunk, Array<{ text: string; qiStart: number }>>,
): FaChunk[] {
  if (unscripted.length === 0) return chunks as FaChunk[];

  const out: FaChunk[] = [];
  for (const chunk of chunks) {
    const inside = unscripted.filter(u => u.startSec >= chunk.startSec && u.endSec <= chunk.endSec);
    const toks = textQi.get(chunk);
    if (inside.length === 0 || toks === undefined) { out.push(chunk); continue; }

    // Left to right: emit [cursor, run.startSec] with the script up to
    // `qiSplit`, then resume after the run.
    let cursor = chunk.startSec;
    let taken = 0;
    for (const u of inside) {
      const before = toks.slice(taken).filter(t => t.qiStart < u.qiSplit);
      taken += before.length;
      if (before.length > 0 && u.startSec > cursor) {
        out.push({ startSec: cursor, endSec: u.startSec, text: before.map(t => t.text).join(' ') });
      }
      cursor = u.endSec;
    }
    const rest = toks.slice(taken);
    if (rest.length > 0) out.push({ startSec: cursor, endSec: chunk.endSec, text: rest.map(t => t.text).join(' ') });
  }
  return out;
}

/** Per-token and whole-segment normalization must land on the same `qi` count —
 *  otherwise every downstream index cut in this segment is off by the
 *  difference. Throwing beats silently mis-attributing text. */
function assertQiMapConsistent(perTokenQi: number, wholeSegmentQi: number, segId: string): void {
  if (perTokenQi !== wholeSegmentQi) {
    throw new Error(
      `faChunkPlan: per-token normalization disagrees with whole-segment normalization for segment ${segId} ` +
        `(${perTokenQi} vs ${wholeSegmentQi} words) — index attribution cannot cut this segment's text safely.`,
    );
  }
}

export function computeRuns(
  segments: readonly VideoSegment[],
  tokens: readonly TranscriptToken[],
  silences: readonly SilenceInterval[],
  audioDuration: number,
): FaRun[] {
  return computeRunContext(segments, tokens, silences, audioDuration).runs;
}

/**
 * The unscripted-audio runs R.5 excises, surfaced from the SAME
 * `computeRunContext` pass that produces them for the chunk plan — the
 * sibling of `computeRuns` above, and additive: nothing about the chunk plan,
 * the anchor set or the run partition changes by exporting this (verified by
 * chunk-plan byte equality on all three corpora, the M4 discipline).
 *
 * Added by R.12 (WS1 Session H, `faRunPlacementGate.ts`), which needs the run
 * SPANS in audio time to decide whether a committed boundary fell inside one.
 * Deriving them a second time in the gate would mean re-running V6's
 * Hirschberg pass and, worse, re-deriving a quantity production already
 * computes — the exact "measure through production" discipline this
 * workstream runs under. R.5's own deferred `unscripted-gap` sync-log entry
 * (ruling R-E) has the same need and can use this too.
 */
export function computeUnscriptedRuns(
  segments: readonly VideoSegment[],
  tokens: readonly TranscriptToken[],
  silences: readonly SilenceInterval[],
  audioDuration: number,
): UnscriptedRun[] {
  return computeRunContext(segments, tokens, silences, audioDuration).unscripted;
}

/**
 * Attributes each segment's raw text (unnormalized — Rust's own
 * `normalize_for_forced_alignment` handles that, same convention the
 * existing single-pass `FaSegmentInput.text` already used) to exactly one
 * run, by a single forward two-pointer scan: both `segments` (Model P) and
 * `runs` (gapless, monotonic by construction — true of `computeFaAnchors`'s
 * own I1/I2 output, and preserved by `coalesceRuns` below, since merging
 * adjacent intervals of a gapless monotonic partition yields another one) are
 * gapless, monotonic partitions of `[0, audioDuration)`, so `startTime` is
 * non-decreasing across `segments` and `windowEnd` is non-decreasing across
 * `runs` — no per-segment search. A run can end up with NO owning segment
 * (e.g. one segment's own `startTime` precedes a run that a later,
 * force-split boundary carved out of that same segment's span) — merge its
 * audio window into an adjacent chunk that DOES have text rather than ever
 * sending Rust an empty-text chunk (which `text_to_token_ids` would reject as
 * `EmptyTokenization`). Prefer extending the previous chunk forward; an empty
 * run before any chunk has been emitted instead defers its own `startSec`
 * onto the next chunk that does have text.
 */
function runsToChunks(runs: readonly FaRun[], segments: readonly VideoSegment[]): FaChunk[] {
  if (runs.length === 0) return [];

  const textsByRun: string[][] = runs.map(() => []);
  let runIdx = 0;
  for (const seg of segments) {
    if (!seg.text || !seg.text.trim()) continue;
    while (runIdx < runs.length - 1 && seg.startTime >= runs[runIdx]!.windowEnd) runIdx++;
    textsByRun[runIdx]!.push(seg.text);
  }

  const chunks: FaChunk[] = [];
  let pendingStart: number | undefined;
  for (let i = 0; i < runs.length; i++) {
    const run = runs[i]!;
    const text = textsByRun[i]!.join(' ');
    if (text.length === 0) {
      if (chunks.length > 0) {
        chunks[chunks.length - 1]!.endSec = run.windowEnd;
      } else {
        pendingStart = pendingStart ?? run.windowStart;
      }
      continue;
    }
    chunks.push({ startSec: pendingStart ?? run.windowStart, endSec: run.windowEnd, text });
    pendingStart = undefined;
  }

  return chunks;
}

/**
 * Builds the ordered chunk plan for a forced-alignment run: `computeFaAnchors`
 * (unmodified) supplies the audio-time windows; `attribution` decides how
 * each window's TEXT is assigned (see module doc comment for the original
 * segment-`startTime` design, and the INDEX ATTRIBUTION section below for the
 * `qi`-derived alternative).
 *
 * Preconditions (caller's responsibility, matching `App.tsx`'s existing
 * `__faDevAlign` guards): `segments.length > 0`, `tokens.length > 0`. Returns
 * `[]` only in the degenerate case where no segment has non-empty text.
 *
 * THE PRODUCTION/LIVE ENTRY POINT — WS1 Task 5 Slice D23. Every function in
 * this codebase that anything (production, script, or test) actually calls
 * for real chunk-plan work goes through this one. D22 flipped
 * `computeFaChunkPlanWithAttribution`'s own internal default to
 * `'script-word-index'` but candidly reported that this function was a
 * SEPARATE code path, hardcoded to segment-start-time, and therefore
 * unaffected — "the flip changed zero existing call sites' behavior" (D22's
 * own gate table). This slice closes that gap: `computeFaChunkPlan` now
 * DELEGATES to `computeFaChunkPlanWithAttribution`, with the identical
 * `'script-word-index'` default, so every existing 4-argument call site
 * (`App.tsx`'s dev-only `__faDevAlign` path included) picks up index
 * attribution without its own call changing at all. `'segment-start-time'`
 * (the pre-D23 behavior, still exactly what `runsToChunks` below computes)
 * remains fully reachable by passing it as the 5th argument explicitly —
 * nothing removes the old rule, and `computeFaChunkPlanWithAttribution`'s own
 * `'segment-start-time'` branch was already proven byte-identical to this
 * function's pre-D23 body (`faChunkPlan.test.ts`'s
 * `'is byte-identical to computeFaChunkPlan under segment-start-time
 * attribution'`, since Slice D13).
 */
export function computeFaChunkPlan(
  segments: readonly VideoSegment[],
  tokens: readonly TranscriptToken[],
  silences: readonly SilenceInterval[],
  audioDuration: number,
  attribution: FaTextAttribution = 'script-word-index',
  languageCode?: FaLanguageCode,
  vocabChars?: ReadonlySet<string>,
): FaChunk[] {
  return computeFaChunkPlanWithAttribution(
    segments, tokens, silences, audioDuration, attribution, undefined, languageCode, vocabChars,
  );
}

// ---------------------------------------------------------------------------
// Run coalescing (WS1 Task 5 Slice D12) — measurement-only today. No
// production caller (`App.tsx`'s `__faDevAlign`) calls
// `computeFaChunkPlanCoalesced`; it exists for the Step 5 window-size-ladder
// harness (`fa_onnx.rs`'s `real_corpus_measurement` module, `#[ignore]`d)
// to dump coalesced chunk plans at several target sizes via
// `scripts/dump-fa-chunk-plan.ts`. `coalesceTargetSec` is a required
// parameter with no default — nothing bakes a target into a production path
// by forgetting to pass one.
// ---------------------------------------------------------------------------

/**
 * Greedily merges adjacent runs, left to right, as long as the MERGED span's
 * duration stays `<= targetSec` — a hard ceiling, not a target average. This
 * applies uniformly to every boundary type, `'agreed-anchor'` included: an
 * agreed anchor is a real R.1 three-source-agreement point, but coalescing's
 * whole purpose is trading boundary precision for a bigger forward-pass
 * window, so a boundary being "real" (as opposed to a forced split) is not
 * by itself a reason to keep it — the target is the only thing that decides
 * whether a merge happens. A run already `>= targetSec` on its own (never
 * happens today per Step 3(a)'s measurement — every real run in this corpus
 * sits far under `MAX_RUN_SEC` — but not assumed here) is never merged with
 * a neighbor, since doing so could only grow it further past the ceiling.
 *
 * The resulting run's `startProvenance`/`endProvenance` are the OUTER edges'
 * own provenance (first run absorbed / last run absorbed) — an internal,
 * absorbed boundary's provenance is discarded, since after coalescing it is
 * no longer a chunk edge at all.
 *
 * Preserves Model P (gapless, monotonic partition of `[0, audioDuration)`):
 * merging adjacent intervals of a gapless monotonic partition yields another
 * gapless monotonic partition, by construction — no boundary is ever moved,
 * only some are dropped.
 */
export function coalesceRuns(runs: readonly FaRun[], targetSec: number): FaRun[] {
  if (runs.length === 0) return [];

  const out: FaRun[] = [];
  let current: FaRun = { ...runs[0]! };
  for (let i = 1; i < runs.length; i++) {
    const next = runs[i]!;
    const mergedDuration = next.windowEnd - current.windowStart;
    if (mergedDuration <= targetSec) {
      current = { ...current, windowEnd: next.windowEnd, endProvenance: next.endProvenance };
    } else {
      out.push(current);
      current = { ...next };
    }
  }
  out.push(current);
  return out;
}

/**
 * `computeFaChunkPlan`, with an added coalescing pass: adjacent runs are
 * merged (via `coalesceRuns`) up to `coalesceTargetSec` before text
 * attribution, so a chunk's own forward-pass window can be wider than a
 * single R.0 run. `coalesceTargetSec` has no default — every caller states
 * its own target explicitly (see module doc comment above).
 */
export function computeFaChunkPlanCoalesced(
  segments: readonly VideoSegment[],
  tokens: readonly TranscriptToken[],
  silences: readonly SilenceInterval[],
  audioDuration: number,
  coalesceTargetSec: number,
): FaChunk[] {
  const runs = computeRuns(segments, tokens, silences, audioDuration);
  const coalesced = coalesceRuns(runs, coalesceTargetSec);
  return runsToChunks(coalesced, segments);
}

// ---------------------------------------------------------------------------
// INDEX ATTRIBUTION (WS1 Task 5 Slice D13 Step 3) — the planner's own
// internal default since Slice D22 (`computeFaChunkPlanWithAttribution`'s
// `attribution` parameter default, below), and — since WS1 Task 5 Slice D23
// — the LIVE default too: `computeFaChunkPlan`, the only function any
// production/script caller actually invokes, now delegates straight to
// `computeFaChunkPlanWithAttribution` and inherits this same default.
//
// D12 proved that ATTRIBUTION, not window size, dominates chunked-alignment
// disagreement: at matched ~6-7s granularity, chunks whose text was correct by
// construction (assigned from whole-file word membership — an ORACLE
// production cannot have, since it presupposes the whole-file answer) reached
// 0.08s max start disagreement, against 7.54s for the same-granularity ladder
// rung using today's `segment.startTime` rule. This section asks whether an
// INDEX-DERIVED rule — available without the oracle — reaches the same bound.
//
// The rule: a chunk's text is the script-word (`qi`) range between its two
// bounding anchors, rather than the set of segments whose `startTime` happens
// to fall in its audio window. `faAnchors.ts`'s `FaAnchor` already carries both
// `qi` and `tokenIdx` (faAnchors.ts:57-62) — `computeRuns` simply discarded
// them by taking `.runs` off `computeFaAnchors`'s result. Nothing in
// `faAnchors.ts` or `syncConstants.ts` needs to change.
//
// WHY THIS SHOULD HELP: `segment.startTime` is the OLD, pre-alignment timing —
// exactly the quantity forced alignment is being run to correct. D11 §4's two
// CTC-infeasibility cases are the extreme form: a 0.62s window inherited a
// segment whose committed duration is 4.65s, purely because that segment's
// stale `startTime` landed inside the window. `qi`, by contrast, comes from the
// Hirschberg alignment against the actual Whisper transcript, so it says where
// a word IS rather than where it was last laid out.
//
// TEXT DOMAIN (the reason this is not simply "emit queryWords"): chunk text is
// RAW segment text, which Rust's own `normalize_for_forced_alignment` then
// normalizes. That normalizer and this module's `normalizeSceneDoc` do NOT
// agree — measured on the real 240s excerpt (Slice D13 Step 3), raw text yields
// 569 representable words (matching the whole-file FA reference exactly) while
// `queryWords.join(' ')` yields 589, because `normalizeSceneDoc` expands
// "41st" to "forty one st" and splits contractions where the FA normalizer
// drops the unrepresentable token and keeps "don't" whole. Emitting
// `queryWords` would therefore change WHAT IS ALIGNED, not just where it is
// cut, and would make any comparison against the whole-file reference
// apples-to-oranges. So index attribution cuts the RAW token stream at
// `qi`-derived boundaries, via `RawScriptToken`'s per-token `qi` range.
// ---------------------------------------------------------------------------

/** Which rule assigns a chunk its text. `'segment-start-time'` is the D11
 *  production rule (unchanged, still the default everywhere); `'script-word-
 *  index'` is Slice D13's index-derived rule. No production path passes
 *  `'script-word-index'` in this slice — it is a measurement knob. */
export type FaTextAttribution = 'segment-start-time' | 'script-word-index';

/** A run paired with the half-open `queryWords` range its two bounding anchors
 *  delimit. */
interface RunQiRange {
  run: FaRun;
  qiLo: number;
  qiHi: number;
}

/**
 * Pairs each run with its bounding anchors' `qi`, WITHOUT joining on time.
 *
 * A time join would be ambiguous: two anchors may agree with the SAME silence
 * and therefore share a `timeSec`, producing zero-duration runs (measured on
 * the real corpus: 8 of 46 runs at 240s, 31 of 149 at full length). Instead
 * this walks `runs` in order and consumes one anchor each time a run's
 * `endProvenance` is `'agreed-anchor'` — exact, because `computeFaAnchors`
 * builds its boundary list as `[corpus-start, ...anchors (in qi order),
 * corpus-end]` and emits runs in that same order, interleaving only
 * force-split boundaries, which are labeled distinctly (faAnchors.ts:206-240).
 *
 * FORCED-SPLIT BOUNDARIES carry no `qi` by construction (no anchor exists
 * there). Such a boundary does not advance `qi`, so the run it ends receives an
 * EMPTY range and its audio window is folded into a neighbor by
 * `attributeByIndex`'s empty handling — i.e. a force-split subdivides the
 * WINDOW but never the TEXT. This is the honest fallback: the alternative would
 * be inventing a `qi` by time interpolation, which is precisely the stale-time
 * inference this rule exists to remove. It never fires on the real 173 corpus
 * (measured: 0 forced splits at both 240s and 709s — every internal boundary is
 * an `agreed-anchor`), so it is a correctness guard, not a tuned path.
 *
 * CALLER CONTRACT — UNCOALESCED `runs` ONLY: the one-anchor-per-'agreed-anchor'-
 * run correspondence this function relies on holds only for `computeRunContext`'s
 * own, original `ctx.runs` — NOT for a `coalesceRuns`-merged array. Coalescing
 * discards an absorbed internal boundary's provenance (`coalesceRuns`'s own doc
 * comment), so a merged run that swallowed several anchors still ends in
 * `'agreed-anchor'` and would silently desync `anchorCursor` from the anchors
 * it actually spans — measured, Slice D13 Step 4: this exact bug, caught only
 * by a real-corpus run (not the narrower unit tests below), inflated START p50
 * to 45.9s. `coalesceRunQiRanges` below is the only supported way to combine
 * coalescing with index attribution — it merges qi bounds in lockstep with
 * time bounds instead of re-deriving them from a coalesced array.
 */
function runQiRanges(runs: readonly FaRun[], anchors: readonly FaAnchor[], totalQi: number): RunQiRange[] {
  const out: RunQiRange[] = [];
  let anchorCursor = 0;
  let qiLo = 0;
  for (const run of runs) {
    let qiHi: number;
    if (run.endProvenance === 'agreed-anchor') {
      qiHi = anchors[anchorCursor]?.qi ?? qiLo;
      anchorCursor++;
    } else if (run.endProvenance === 'corpus-end') {
      qiHi = totalQi;
    } else {
      qiHi = qiLo; // forced split — see doc comment
    }
    if (qiHi < qiLo) qiHi = qiLo; // anchors are qi-ordered; defensive only
    out.push({ run, qiLo, qiHi });
    qiLo = qiHi;
  }
  // The final run must always close out the script, whatever its provenance —
  // otherwise trailing words would be silently dropped.
  const last = out[out.length - 1];
  if (last) last.qiHi = totalQi;
  return out;
}

/**
 * Merges adjacent `RunQiRange`s in lockstep with `coalesceRuns`'s own greedy
 * left-to-right, `<= targetSec`-ceiling algorithm — SAME merge predicate
 * (`next.run.windowEnd - current.run.windowStart <= targetSec`), applied to
 * the SAME input sequence in the SAME order, so it makes IDENTICAL merge/
 * no-merge decisions and produces a run array `coalesceRuns(runs, targetSec)`
 * would also produce — but carries each merged run's qi bounds along as the
 * UNION of every absorbed range's own bounds (`qiLo` of the first, `qiHi` of
 * the last), rather than re-deriving them from the merged array's own
 * (provenance-lossy) `endProvenance` after the fact. This is the fix for the
 * bug `runQiRanges`'s own doc comment describes: qi and time must be
 * coalesced TOGETHER, in one pass over the ORIGINAL per-anchor ranges, never
 * separately.
 */
function coalesceRunQiRanges(ranges: readonly RunQiRange[], targetSec: number): RunQiRange[] {
  if (ranges.length === 0) return [];

  const out: RunQiRange[] = [];
  let current: RunQiRange = { run: { ...ranges[0]!.run }, qiLo: ranges[0]!.qiLo, qiHi: ranges[0]!.qiHi };
  for (let i = 1; i < ranges.length; i++) {
    const next = ranges[i]!;
    const mergedDuration = next.run.windowEnd - current.run.windowStart;
    if (mergedDuration <= targetSec) {
      current = {
        run: { ...current.run, windowEnd: next.run.windowEnd, endProvenance: next.run.endProvenance },
        qiLo: current.qiLo,
        qiHi: next.qiHi,
      };
    } else {
      out.push(current);
      current = { run: { ...next.run }, qiLo: next.qiLo, qiHi: next.qiHi };
    }
  }
  out.push(current);
  return out;
}

/**
 * Assigns raw script tokens to runs by `qi` range, then emits chunks.
 *
 * Every raw token is placed by its own `qiStart` into the LAST run whose
 * `qiLo <= qiStart` — a single monotonic scan. Placing by `qiStart` alone (not
 * by containment of the whole `[qiStart, qiEnd)` range) is what makes this a
 * partition: each token lands in exactly one run, none is duplicated, none is
 * dropped, and a token that normalizes to nothing (`qiStart === qiEnd` — a
 * stage direction, a punctuation-only token) still has a well-defined home
 * rather than vanishing.
 *
 * TWO KINDS OF DEGENERATE RUN are folded into a neighbor rather than emitted:
 *  - a run with text but NO AUDIO (zero-duration — the shared-silence case
 *    above). Sending Rust text with an empty window is a guaranteed
 *    CTC-infeasibility, the exact failure D11 §4 recorded; its text merges
 *    FORWARD into the next run, which is the run that actually contains that
 *    audio.
 *  - a run with audio but NO TEXT. Its window folds into whichever neighbor
 *    received the text that window's audio actually carries — FORWARD for an
 *    empty `qi` range (a forced split, whose text the scan above pools into the
 *    next range), BACKWARD otherwise (a non-empty range that drew no token: the
 *    token covering those `qi` began earlier and is already attributed back).
 *    `runsToChunks`, whose text flows the other way, folds backward in both
 *    cases — the two modes are mirror images here, not identical.
 */
function attributeByIndex(
  ranges: readonly RunQiRange[],
  rawTokens: readonly RawScriptToken[],
  /** R.5: filled with each emitted chunk's own raw tokens, still carrying their
   *  `qiStart`, so `exciseUnscriptedRuns` can cut a chunk's TEXT at a script
   *  index without re-deriving the attribution it just performed. */
  textQiOut?: Map<FaChunk, Array<{ text: string; qiStart: number }>>,
): FaChunk[] {
  if (ranges.length === 0) return [];

  const textsByRun: Array<Array<{ text: string; qiStart: number }>> = ranges.map(() => []);
  let rangeIdx = 0;
  for (const tok of rawTokens) {
    while (rangeIdx < ranges.length - 1 && tok.qiStart >= ranges[rangeIdx + 1]!.qiLo) rangeIdx++;
    textsByRun[rangeIdx]!.push({ text: tok.text, qiStart: tok.qiStart });
  }

  // ---- THE TOTAL CASE: a run with text but a ZERO-DURATION window --------
  // Emitting that as a chunk sends the aligner an empty window — measured:
  // ONNX Runtime fails the very first Conv node with "Invalid input shape:
  // {0}". Its text folds FORWARD into the next run, which is the run that
  // actually contains that audio. Shipped, tested, and load-bearing: it
  // guards a real CTC-infeasibility crash.
  //
  // THE PARTIAL CASE IS DELIBERATELY NOT HANDLED HERE (WS1 Session AH). A
  // window with audio whose TRAILING text has none produces the same phantom,
  // and Session AG built exactly that fold (S1). It was ROLLED BACK as a
  // permanent negative: the phantom-tail existence test fires on 183 of 277
  // v6 chunks against ~13 true defects (~7% precision), and a repair keyed on
  // it moved 18 boundaries an operator ear audit confirmed were ALREADY
  // CORRECT. Do not reintroduce a cleanup keyed on this test. See
  // `docs/history-2.md`'s Session AH entry (ruling R-AS).
  // Fold zero-duration runs' text forward into the next run that has audio.
  for (let i = 0; i < ranges.length - 1; i++) {
    const r = ranges[i]!.run;
    if (r.windowEnd - r.windowStart > 0) continue;
    const carried = textsByRun[i]!;
    if (carried.length === 0) continue;
    textsByRun[i + 1]!.unshift(...carried);
    textsByRun[i] = [];
  }


  const chunks: FaChunk[] = [];
  let pendingStart: number | undefined;
  for (let i = 0; i < ranges.length; i++) {
    const range = ranges[i]!;
    const run = range.run;
    const text = textsByRun[i]!.map(t => t.text).join(' ');
    if (text.length === 0) {
      // WHICH WAY A TEXT-LESS WINDOW FOLDS DEPENDS ON WHERE ITS TEXT WENT.
      // An EMPTY qi range (`qiHi === qiLo` — a forced split, `runQiRanges`'s
      // own rule) did not lose its text: the placement scan above always steps
      // PAST an empty range, because the following range shares its `qiLo`, so
      // those words are pooled into the NEXT chunk. The window must travel
      // forward with them. Extending the previous chunk instead (the branch
      // below) strands this run's audio in a chunk that holds none of its text
      // while those words wait in a chunk whose window starts after they were
      // spoken — the ear-pass item 9 defect. A NON-empty range that still drew
      // no token is the opposite case (the token covering those `qi` began
      // earlier and is already attributed backward), so it keeps the backward
      // fold, matching `runsToChunks`'s rule for its own mode. Either way no
      // gap is emitted (R-E): the shared boundary moves for both neighbors at
      // once, never for one alone.
      const foldsForward = range.qiHi === range.qiLo && i < ranges.length - 1;
      if (foldsForward || chunks.length === 0) pendingStart = pendingStart ?? run.windowStart;
      else chunks[chunks.length - 1]!.endSec = run.windowEnd;
      continue;
    }
    const chunk: FaChunk = { startSec: pendingStart ?? run.windowStart, endSec: run.windowEnd, text };
    chunks.push(chunk);
    textQiOut?.set(chunk, textsByRun[i]!);
    pendingStart = undefined;
  }
  return chunks;
}

/**
 * The one entry point that takes an explicit attribution rule and an optional
 * coalesce target — the measurement surface for Slice D13 Step 4.
 *
 * WS1 Task 5 Slice D22: `attribution` DEFAULTS to `'script-word-index'` — the
 * planner's own internal default, per the owner ruling recorded in
 * `docs/work-in-progress.md` §6's "R.7 CONF_MIN" and "CTC-infeasibility"
 * paragraphs (original sources `d21-attribution-confmin-2026-08-14.md` Step 2
 * and `d22-attribution-default-tail-2026-08-14.md`, this slice, were deleted
 * 2026-08-14, `9cf5867`; retrieve: `git show
 * 251be64:docs/ws1-sync-pipeline/d21-attribution-confmin-2026-08-14.md` /
 * `git show 251be64:docs/ws1-sync-pipeline/d22-attribution-default-tail-2026-08-14.md`):
 * index attribution
 * eliminates the only reachable CTC-infeasibility case found on real corpus
 * data and cuts the fraction of words below `CONF_MIN` from 62.75% to 9.43%
 * (D21 Step 1). `'segment-start-time'` (the D11 production rule) remains
 * fully reachable by passing it explicitly — nothing about this default
 * removes the old rule, and no caller anywhere in this codebase is forced
 * onto the new one.
 *
 * WS1 Task 5 Slice D23 UPDATE: `computeFaChunkPlan` (the function any
 * production/script caller actually invokes) now DELEGATES here — see that
 * function's own doc comment. This function's `'segment-start-time'` branch
 * remains byte-identical to the pre-D23 `computeFaChunkPlan` body (still
 * `computeRunContext` + `runsToChunks`, untouched), so passing
 * `'segment-start-time'` explicitly is still the exact pre-D23 behavior; the
 * FA capability gate is per-project (`isFaGateOpenForProject()`, D17/R-AK), so this
 * whole module stays production-inert either way. `coalesceTargetSec` is
 * optional; omitting it runs the unmerged R.0 plan.
 *
 * `languageCode`/`vocabChars` (Phase 3b Slice 1, plumbing only): when BOTH are
 * supplied, each emitted chunk's `text` is additionally passed through
 * `faTextNormalize.ts`'s `normalizeForForcedAlignment` — the vocab-aware
 * normalizer that preserves native diacritics, as opposed to this module's
 * pre-existing raw-text passthrough (Rust's own `normalize_for_forced_alignment`
 * port already normalizes raw chunk text safely today — see
 * `docs/work-in-progress.md` §10 — so this is an additive JS-side capability,
 * not a fix to a live bug). Omitting either parameter (every call site today,
 * `App.tsx`'s dev path included) leaves `runsToChunks`/`attributeByIndex`'s
 * output completely untouched — this parameter pair has no effect unless a
 * caller opts in.
 */
export function computeFaChunkPlanWithAttribution(
  segments: readonly VideoSegment[],
  tokens: readonly TranscriptToken[],
  silences: readonly SilenceInterval[],
  audioDuration: number,
  attribution: FaTextAttribution = 'script-word-index',
  coalesceTargetSec?: number,
  languageCode?: FaLanguageCode,
  vocabChars?: ReadonlySet<string>,
): FaChunk[] {
  // `languageCode` also drives `computeRunContext`'s qi bookkeeping (Phase 3c) —
  // not just `applyFaTextNormalization` below, which is a separate, later step
  // over the already-cut chunk text (see that function's own doc comment).
  const ctx = computeRunContext(segments, tokens, silences, audioDuration, languageCode);

  let chunks: FaChunk[];
  if (attribution === 'segment-start-time') {
    const runs = coalesceTargetSec === undefined ? ctx.runs : coalesceRuns(ctx.runs, coalesceTargetSec);
    chunks = runsToChunks(runs, segments);
  } else {
    // Index attribution: qi ranges must be derived from the UNCOALESCED runs
    // (one-to-one with `anchors`, `runQiRanges`'s own contract) and THEN
    // coalesced in lockstep via `coalesceRunQiRanges` — never by coalescing
    // the runs first and re-deriving qi from the merged array (see both
    // functions' doc comments for the bug that approach produces).
    const uncoalescedRanges = runQiRanges(ctx.runs, ctx.anchors, ctx.totalQi);
    const ranges = coalesceTargetSec === undefined ? uncoalescedRanges : coalesceRunQiRanges(uncoalescedRanges, coalesceTargetSec);
    // R.5 (WS1 Session D): excise unscripted audio from the windows it would
    // otherwise force a neighbouring segment's words onto. Index attribution
    // only — `'segment-start-time'` below is the pre-D23 rule, kept reachable
    // purely as the byte-identical historical comparison
    // (`faChunkPlan.test.ts`), and it carries no `qi` to cut a chunk's text at.
    const textQi = new Map<FaChunk, Array<{ text: string; qiStart: number }>>();
    chunks = exciseUnscriptedRuns(
      attributeByIndex(ranges, ctx.rawTokens, textQi),
      ctx.unscripted, textQi,
    );
  }

  return languageCode !== undefined && vocabChars !== undefined
    ? applyFaTextNormalization(chunks, languageCode, vocabChars)
    : chunks;
}

/** Post-processes an already-built chunk plan's `text` through
 *  `normalizeForForcedAlignment`, leaving `startSec`/`endSec` untouched — see
 *  `computeFaChunkPlanWithAttribution`'s `languageCode`/`vocabChars` doc
 *  comment. Applied after chunk assembly so it can never influence the `qi`
 *  index arithmetic (`computeRunContext`/`runQiRanges`), which is computed
 *  entirely from raw text beforehand and stays untouched by this step. */
function applyFaTextNormalization(
  chunks: readonly FaChunk[],
  languageCode: FaLanguageCode,
  vocabChars: ReadonlySet<string>,
): FaChunk[] {
  return chunks.map(chunk => ({
    ...chunk,
    text: normalizeForForcedAlignment(chunk.text, languageCode, vocabChars).text,
  }));
}

// ---------------------------------------------------------------------------
// S2 — SENTENCE-BOUNDED CHUNK PLAN (WS1 Session AI, MEASUREMENT ARM ONLY).
//
// S1 (WS1 Session AG/AH) tried to CLEAN UP the phantom-tail defect after the
// fact, keyed on a ~7% precision detector, and was rejected 18/18 on ear
// audit (ruling R-AS: `docs/history-2.md`'s Session AH entry). S2 tries to
// PREVENT it instead, at the layer where it is created: today's planner
// (`computeFaChunkPlanWithAttribution` above) cuts the raw token stream at
// `qi`-derived indices with no awareness of sentence structure, which is what
// lets a chunk window end mid-sentence and hand a neighbour's silent tail
// someone else's words (`docs/history-2.md`'s Session AH entry — text filed
// into a window's silent tail).
//
// PRODUCTION DEFAULT UNCHANGED. This is a SEPARATE, explicitly-named function
// — `computeFaChunkPlanS2` — not a flag on `computeFaChunkPlan`. No caller in
// `App.tsx` or anywhere in the production path invokes it; it exists for the
// Session AI measurement harness (`scripts/ws1-session-ai-step3-*`,
// `scripts/ws1-session-ai-step4-*`) the same way `computeFaChunkPlanCoalesced`
// exists for the Step-5 window-size-ladder harness. THE SHIP DECISION — ever
// wiring this into `App.tsx`'s live FA path — is a separate, operator-signed
// step this module does not take. Do not add a boolean default-true OR a
// dead default-false flag to gate this: that indirection was exactly S1's
// failure mode when it was rolled back (`faChunkPlan.ts`'s own S1 removal
// note, above, on `attributeByIndex`).
//
// FIVE INVARIANTS, in this precedence order — a later one may only act where
// an earlier one is silent:
//   1. A chunk's text is a WHOLE NUMBER OF SCRIPT SEGMENTS. Never a fragment.
//   2. A chunk edge NEVER falls inside a sentence, including one that spans a
//      segment seam (173's segments 5-6 — "They're the worst" / "because the
//      environment..." — one sentence, two segments — is the reason rule 1
//      alone is insufficient; a segment-only cut could still separate two
//      halves of the same sentence into different chunks).
//   3. Whisper timestamps are EXCLUDED ENTIRELY from deciding which text
//      belongs to which chunk (rules 1-2 are decided from `segment.text` and
//      punctuation alone). They may still inform WHERE in time the audio is
//      sliced (rule 4) — `CLAUDE.md`'s "timestamps may measure distance; they
//      must never decide identity" applied at the layer S1 broke it at.
//   4. The audio cut is taken at the detected silence nearest the chosen
//      sentence seam's ESTIMATED time (`segment.startTime`, whatever timing
//      stage supplied it — anchor-based estimate in every call site today) —
//      informing WHERE, per rule 3, never WHICH TEXT.
//   5. Target 10-30s (`S2_TARGET_MIN_SEC`/`S2_TARGET_MAX_SEC`, GEOMETRIC:
//      operator-directed parameters from the WS1 Session AI brief, NOT
//      derived from or fitted to any corpus row — see that session's Step 1
//      dry run for the full distribution this band produces). A seam with no
//      nearby silence never blocks rule 2 — `nearestSilenceCut` always finds
//      SOME silence in every corpus measured (Session AI Step 1: zero corpus
//      has an empty silence array) — so growing toward the cap only matters
//      for an unbreakable group that is ALREADY oversize on its own, which
//      rule 2 forbids splitting regardless of the cap. Every seam where
//      invariant 2 cannot be satisfied cleanly (an oversize unbreakable group,
//      or a chosen cut sitting outside `S2_SILENCE_SEARCH_WINDOW_SEC` of the
//      ideal seam) emits a first-class `FaChunkPlanS2Violation` — never a
//      silent mid-sentence split.
//
// EXPLICITLY OUT OF SCOPE THIS SESSION, named rather than silently absorbed:
// R.5 unscripted-run excision (`exciseUnscriptedRuns` above) is NOT applied
// to S2's output. `computeUnscriptedRuns`'s own bookkeeping is qi-indexed —
// built from the SAME raw-token/anchor machinery invariant 3 asks this planner
// to stay clear of — and folding it in is real, separable follow-on work, not
// attempted here. v6 carries ~10 genuinely unscripted recitations
// (`docs/history-2.md`'s Session AH entry, R.5 recitation-census note); a wide S2 chunk that
// wholly contains one is therefore NOT excised and the recitation's audio
// stays inside whatever chunk contains it, unlike the production path. This
// is a real, measured gap (Session AI Step 4 checks the recitation-adjacent
// controls specifically), not a claim that S2 is R.5-safe.
// ---------------------------------------------------------------------------

/** GEOMETRIC — operator-directed (WS1 Session AI brief), not fitted to any
 *  corpus row. See that session's Step 1 dry run for the full distribution. */
export const S2_TARGET_MIN_SEC = 10;
/** GEOMETRIC — also the hard cap invariant 5 grows an unbreakable group
 *  toward, never past. */
export const S2_TARGET_MAX_SEC = 30;
/** GEOMETRIC — the silence-search window a violation is classified against.
 *  Never REJECTS a candidate cut (see invariant 5's own note: some silence
 *  always exists in every corpus measured) — only reports one as suspect. */
export const S2_SILENCE_SEARCH_WINDOW_SEC = 5.0;

/** Sentence terminator: `.`/`!`/`?`/`…`, optionally followed by a run of
 *  closing quotes/brackets. Punctuation-only, matching the WS1 Session AH/AI
 *  dry-run harnesses exactly — the script is authored prose with real
 *  punctuation, and any ML-based sentence guess would reintroduce exactly the
 *  kind of inference S2 exists to remove (invariant 3). */
const S2_SENTENCE_TERMINATOR = /[.!?…]["'”’)\]]*\s*$/;
const s2EndsSentence = (text: string | undefined): boolean => S2_SENTENCE_TERMINATOR.test((text ?? '').trim());

interface S2Group {
  /** Indices into `segments`. Always contiguous, length >= 1. */
  segIdx: number[];
  startSec: number;
  endSec: number;
  durationSec: number;
}

/** Invariants 1+2: the atoms a chunk edge may fall between. A seam is legal
 *  only where the preceding segment ends a sentence (or is the corpus's last
 *  segment). Whisper tokens never enter this decision — only `segment.text`'s
 *  own punctuation and `segment.startTime`/`.duration` (the timing estimate,
 *  used only for the group's own span, never to decide grouping). */
function s2UnbreakableGroups(segments: readonly VideoSegment[]): S2Group[] {
  const groups: S2Group[] = [];
  let cur: number[] = [];
  for (let i = 0; i < segments.length; i++) {
    cur.push(i);
    if (s2EndsSentence(segments[i]!.text) || i === segments.length - 1) {
      const first = segments[cur[0]!]!;
      const last = segments[cur[cur.length - 1]!]!;
      groups.push({
        segIdx: cur,
        startSec: first.startTime,
        endSec: last.startTime + last.duration,
        durationSec: (last.startTime + last.duration) - first.startTime,
      });
      cur = [];
    }
  }
  return groups;
}

/** Greedy left-to-right packing over GROUPS, never segments — a group is
 *  never split (invariant 2). Targets `[targetMinSec, targetMaxSec]`; an
 *  already-oversize group is emitted alone (invariant 5's growth clause
 *  cannot rescue a group that exceeds the cap by itself). */
function s2PackGroups(groups: readonly S2Group[], targetMinSec: number, targetMaxSec: number): S2Group[][] {
  const chunks: S2Group[][] = [];
  let cur: S2Group[] = [];
  let acc = 0;
  for (const g of groups) {
    if (cur.length > 0 && acc + g.durationSec > targetMaxSec && acc >= targetMinSec) {
      chunks.push(cur); cur = []; acc = 0;
    }
    cur.push(g); acc += g.durationSec;
  }
  if (cur.length > 0) chunks.push(cur);
  return chunks;
}

/** Invariant 4: the audio cut for an internal seam is the detected silence's
 *  own `endSec` nearest the ideal (estimate-based) seam time — the same
 *  landmark `faAnchors.ts` already uses for every anchor. Never returns
 *  `undefined` in any corpus measured (Session AI Step 1: every silence array
 *  is non-empty), but the caller still checks `silences.length` defensively
 *  rather than assume that holds forever. */
function s2NearestSilenceCut(idealSec: number, silences: readonly SilenceInterval[]): { cutSec: number; offsetSec: number } | undefined {
  let best: { cutSec: number; offsetSec: number } | undefined;
  for (const s of silences) {
    const off = s.endSec - idealSec;
    if (best === undefined || Math.abs(off) < Math.abs(best.offsetSec)) best = { cutSec: s.endSec, offsetSec: off };
  }
  return best;
}

/** A seam where invariant 2 could not be satisfied cleanly at the target
 *  band, carrying enough to explain WHY and WHAT the planner did instead —
 *  invariant 5's "first-class violation event", never a silent mid-sentence
 *  split. */
export interface FaChunkPlanS2Violation {
  /** The script-segment index this seam sits immediately BEFORE (seam is
   *  between `segIdx - 1` and `segIdx`), or the first segment of an oversize
   *  group for the `'oversize-unbreakable-group'` cause. */
  segIdx: number;
  cause: 'oversize-unbreakable-group' | 'no-usable-silence-nearby' | 'unexcised-run';
  /** The ideal (estimate-based) seam/group-start time in seconds. */
  idealSec: number;
  /** What the planner actually did about it, in words. */
  fallback: string;
}

export interface FaChunkPlanS2Result {
  chunks: FaChunk[];
  violations: FaChunkPlanS2Violation[];
}

/**
 * S2's own entry point — see the module section header above for the five
 * invariants this implements and their precedence. `targetMinSec`/
 * `targetMaxSec` default to the Session AI GEOMETRIC constants but are
 * explicit parameters (not baked in) so the measurement harness can vary the
 * band without editing this function, the same discipline
 * `computeFaChunkPlanCoalesced`'s `coalesceTargetSec` already uses.
 *
 * NOT called by any production path (see module header). `languageCode`/
 * `vocabChars`, when both supplied, apply the SAME post-assembly
 * normalization pass `computeFaChunkPlanWithAttribution` does — see that
 * function's own doc comment for why this happens after chunk text is fixed,
 * never before.
 */
export function computeFaChunkPlanS2(
  segments: readonly VideoSegment[],
  silences: readonly SilenceInterval[],
  audioDuration: number,
  targetMinSec: number = S2_TARGET_MIN_SEC,
  targetMaxSec: number = S2_TARGET_MAX_SEC,
  languageCode?: FaLanguageCode,
  vocabChars?: ReadonlySet<string>,
): FaChunkPlanS2Result {
  if (segments.length === 0) return { chunks: [], violations: [] };

  const groups = s2UnbreakableGroups(segments);
  const packed = s2PackGroups(groups, targetMinSec, targetMaxSec);
  const violations: FaChunkPlanS2Violation[] = [];

  for (const g of groups) {
    if (g.durationSec > targetMaxSec) {
      violations.push({
        segIdx: g.segIdx[0]!,
        cause: 'oversize-unbreakable-group',
        idealSec: g.startSec,
        fallback: `emitted whole as one ${g.durationSec.toFixed(2)}s chunk (segments `
          + `${g.segIdx[0]}-${g.segIdx[g.segIdx.length - 1]}); rule 2 forbids splitting a sentence group `
          + `regardless of the ${targetMaxSec}s cap`,
      });
    }
  }

  const chunks: FaChunk[] = [];
  for (let i = 0; i < packed.length; i++) {
    const gs = packed[i]!;
    const last = gs[gs.length - 1]!;
    const startSec = i === 0 ? 0 : chunks[chunks.length - 1]!.endSec;

    let endSec: number;
    if (i === packed.length - 1) {
      endSec = audioDuration;
    } else {
      const idealEnd = last.endSec;
      const cut = s2NearestSilenceCut(idealEnd, silences);
      if (cut === undefined) {
        violations.push({
          segIdx: last.segIdx[last.segIdx.length - 1]! + 1,
          cause: 'no-usable-silence-nearby',
          idealSec: idealEnd,
          fallback: `no detected silence exists in this corpus's silence array at all; used the `
            + `estimated seam time ${idealEnd.toFixed(3)} directly`,
        });
        endSec = idealEnd;
      } else {
        endSec = cut.cutSec;
        if (Math.abs(cut.offsetSec) > S2_SILENCE_SEARCH_WINDOW_SEC) {
          violations.push({
            segIdx: last.segIdx[last.segIdx.length - 1]! + 1,
            cause: 'no-usable-silence-nearby',
            idealSec: idealEnd,
            fallback: `nearest silence end is ${cut.offsetSec >= 0 ? '+' : ''}${cut.offsetSec.toFixed(3)}s from `
              + `the ideal seam, outside the ${S2_SILENCE_SEARCH_WINDOW_SEC}s search window; accepted anyway `
              + `per invariant 4 (some silence always exists) rather than split mid-sentence`,
          });
        }
      }
    }

    const text = gs.flatMap(g => g.segIdx).map(idx => segments[idx]!.text ?? '').filter(t => t.length > 0).join(' ');
    if (text.length === 0) continue; // Mirrors runsToChunks/attributeByIndex — never an empty-text chunk.
    chunks.push({ startSec, endSec, text });
  }

  return {
    chunks: languageCode !== undefined && vocabChars !== undefined
      ? applyFaTextNormalization(chunks, languageCode, vocabChars)
      : chunks,
    violations,
  };
}

// ---------------------------------------------------------------------------
// S2 + R.5 EXCISION (WS1 Session AK, MEASUREMENT ARM ONLY).
//
// WHAT THIS CLOSES. `computeFaChunkPlanS2` above names R.5 unscripted-run
// excision as EXPLICITLY OUT OF SCOPE, and WS1 Session AI measured the
// consequence: S2 drives the phantom funnel to a structural zero on all three
// corpora but regresses 30 ear-verified v6 controls with up to -27.7s of
// systematic negative drift, while 173 and spanish show far less or none. v6 is
// also the only corpus that carries recitations at all — MEASURED this session,
// `computeUnscriptedRuns` finds TEN runs on v6 (41.31s, 2.91% of the audio) and
// ZERO on both 173 and spanish. That correlation is what this arm tests.
//
// A SIBLING FUNCTION, NOT A FLAG ON `computeFaChunkPlanS2`. The S2 section
// header forbids adding a boolean to gate a measurement arm, and the module
// already establishes the sibling pattern (`computeFaChunkPlan` /
// `computeFaChunkPlanCoalesced` / `computeFaChunkPlanS2`). A sibling also keeps
// the un-excised arm REPRODUCIBLE at HEAD, which an in-place edit would have
// destroyed — the Session AK ablation needs both arms computable from the same
// commit or the comparison has a moving baseline.
//
// WHAT EXCISION ACTUALLY REMOVES, stated explicitly because getting this wrong
// is precisely the shape of defect that produces cumulative drift:
//
//   AUDIO — YES. The run's `[startSec, endSec]` is left unclaimed by any chunk.
//   SCRIPT TEXT — NOTHING. By R.5's own zero-hole rule a run has NO unmatched
//     script word opposite it, so there is no script text belonging to the run
//     to delete. `qiSplit` is a PARTITION POINT in the script, never a deletion:
//     every script word before it stays with the preceding chunk and every word
//     from it onward stays with the following one. Total word count across the
//     plan is therefore IDENTICAL with and without excision.
//   DOWNSTREAM BOUNDARY INDICES — NOTHING SHIFTS, and nothing needs to be
//     "accounted for". `align_chunked` (`fa_onnx.rs`) aligns each chunk
//     independently against its own audio slice and offsets the words it
//     returns by that chunk's own `start_sec`, so every emitted word carries an
//     ABSOLUTE time regardless of what the previous chunk covered. A hole in
//     the plan is legal there (the R.5 section header states this directly) and
//     costs no index correction: word ordinals are assigned in emission order
//     over an unchanged text, so ordinal k means the same script word in both
//     arms. This is why excision cannot itself introduce the cumulative drift
//     it is being tested against.
//
// WHERE THE CUT GOES — DERIVED FROM TWO RULES ALREADY IN FORCE, NOT TUNED.
// MEASURED this session: ZERO of v6's ten runs land cleanly between two
// adjacent sentence groups, and five land strictly inside one group's ESTIMATED
// span (which is itself displaced by the recitation, since the anchor-based
// estimate distributes script text across audio that includes the recitation).
// So the cut point cannot be read off the run's timestamps without violating S2
// invariant 3, and it cannot be assumed to fall at a group seam. It is read off
// R.5's own `qiSplit` instead — a SCRIPT-WORD index, i.e. exactly the
// index-space quantity `CLAUDE.md` §4 requires for an identity decision — and
// then moved to the start of the sentence group containing that word, because
// S2 invariant 2 admits no other legal chunk edge. Both steps are consequences
// of stated rules; neither introduces a constant.
//
// TEXT DENSITY. A group's packing weight is its span NET of any excised run
// overlapping it, so a recitation's seconds never inflate the chunk the packer
// builds around it — the brief's "never contribute to text density".
//
// NO NEW CONSTANTS. `S2_TARGET_MIN_SEC`/`S2_TARGET_MAX_SEC`/
// `S2_SILENCE_SEARCH_WINDOW_SEC` are unchanged and remain GEOMETRIC
// operator-directed parameters. This function adds none of its own.
// ---------------------------------------------------------------------------

/** One run's forced chunk break: the group that must START a new chunk, and the
 *  run whose audio is excised at that seam. `trailing` marks a run with no
 *  script after it at all — the plan's last chunk ends at the run instead. */
interface S2ExcisionSeam {
  groupIdx: number;
  run: UnscriptedRun;
  trailing: boolean;
}

/** Per-segment `queryWords` index ranges, rebuilt with the SAME construction
 *  `computeRunContext` uses — so `qiSplit` is read in the index space that
 *  produced it, not a lookalike. */
function s2SegQiRanges(
  segments: readonly VideoSegment[], languageCode?: FaLanguageCode,
): Array<{ start: number; end: number }> {
  const ranges: Array<{ start: number; end: number }> = [];
  let qi = 0;
  for (const seg of segments) {
    const start = qi;
    if (seg.text && seg.text.trim()) {
      for (const w of normalizeSceneDoc(seg.text, languageCode)) if (w.length > 0) qi++;
    }
    ranges.push({ start, end: qi });
  }
  return ranges;
}

/** Total excised-run seconds overlapping `[a, b]`. */
function s2ExcisedWithin(a: number, b: number, runs: readonly UnscriptedRun[]): number {
  let acc = 0;
  for (const u of runs) acc += Math.max(0, Math.min(b, u.endSec) - Math.max(a, u.startSec));
  return acc;
}

/** Greedy packing, as `s2PackGroups` — plus the forced breaks excision
 *  requires, and group weights taken NET of excised time. A forced break always
 *  wins over the size target: it is an invariant, the band is a preference. */
function s2PackGroupsExcised(
  groups: readonly S2Group[],
  runs: readonly UnscriptedRun[],
  forcedBreakAt: ReadonlySet<number>,
  targetMinSec: number,
  targetMaxSec: number,
): S2Group[][] {
  const chunks: S2Group[][] = [];
  let cur: S2Group[] = [];
  let acc = 0;
  for (let i = 0; i < groups.length; i++) {
    const g = groups[i]!;
    const weight = Math.max(0, g.durationSec - s2ExcisedWithin(g.startSec, g.endSec, runs));
    const mustBreak = forcedBreakAt.has(i);
    if (cur.length > 0 && (mustBreak || (acc + weight > targetMaxSec && acc >= targetMinSec))) {
      chunks.push(cur); cur = []; acc = 0;
    }
    cur.push(g); acc += weight;
  }
  if (cur.length > 0) chunks.push(cur);
  return chunks;
}

/**
 * S2 with R.5 unscripted-run excision folded in — see the section header above
 * for what excision removes, what it does not, and why the cut point comes from
 * `qiSplit` rather than from the run's timestamps.
 *
 * Takes `tokens` (the RAW Whisper array, the same one `computeUnscriptedRuns`
 * is given everywhere else in the pipeline) in addition to
 * `computeFaChunkPlanS2`'s arguments. NOT called by any production path.
 *
 * The returned plan is a partition of `[0, audioDuration)` MINUS the excised
 * runs — deliberately NOT gapless, which is legal for a chunk plan (see the R.5
 * section header) and is the entire mechanism.
 */
export function computeFaChunkPlanS2Excised(
  segments: readonly VideoSegment[],
  tokens: readonly TranscriptToken[],
  silences: readonly SilenceInterval[],
  audioDuration: number,
  targetMinSec: number = S2_TARGET_MIN_SEC,
  targetMaxSec: number = S2_TARGET_MAX_SEC,
  languageCode?: FaLanguageCode,
  vocabChars?: ReadonlySet<string>,
): FaChunkPlanS2Result {
  if (segments.length === 0) return { chunks: [], violations: [] };

  const groups = s2UnbreakableGroups(segments);
  const violations: FaChunkPlanS2Violation[] = [];

  // R.5, reused unchanged — the shipped detector, not a reimplementation.
  const runs = computeUnscriptedRuns(segments, tokens, silences, audioDuration);

  // `qiSplit` -> segment -> group. This is the whole placement rule.
  const qiRanges = s2SegQiRanges(segments, languageCode);
  const totalQi = qiRanges[qiRanges.length - 1]?.end ?? 0;
  const groupOfSeg = new Map<number, number>();
  groups.forEach((g, gi) => { for (const si of g.segIdx) groupOfSeg.set(si, gi); });

  const seams: S2ExcisionSeam[] = [];
  for (const run of runs) {
    if (run.qiSplit >= totalQi) { seams.push({ groupIdx: groups.length, run, trailing: true }); continue; }
    const segIdx = qiRanges.findIndex(r => run.qiSplit >= r.start && run.qiSplit < r.end);
    const gi = segIdx >= 0 ? groupOfSeg.get(segIdx) : undefined;
    if (gi === undefined) {
      violations.push({
        segIdx: segIdx >= 0 ? segIdx : 0,
        cause: 'unexcised-run',
        idealSec: run.startSec,
        fallback: `R.5 run [${run.startSec.toFixed(2)}, ${run.endSec.toFixed(2)}] has qiSplit ${run.qiSplit}, which `
          + 'maps to no segment in this script; the run is left INSIDE whatever chunk contains it rather than '
          + 'guessed at, matching production exciseUnscriptedRuns\'s own not-wholly-contained behaviour',
      });
      continue;
    }
    seams.push({ groupIdx: gi, run, trailing: false });
  }

  const forcedBreakAt = new Set(seams.filter(s => !s.trailing).map(s => s.groupIdx));
  const packed = s2PackGroupsExcised(groups, runs, forcedBreakAt, targetMinSec, targetMaxSec);

  for (const g of groups) {
    if (g.durationSec > targetMaxSec) {
      violations.push({
        segIdx: g.segIdx[0]!,
        cause: 'oversize-unbreakable-group',
        idealSec: g.startSec,
        fallback: `emitted whole as one ${g.durationSec.toFixed(2)}s chunk (segments `
          + `${g.segIdx[0]}-${g.segIdx[g.segIdx.length - 1]}); rule 2 forbids splitting a sentence group `
          + `regardless of the ${targetMaxSec}s cap`,
      });
    }
  }

  // A run whose seam group opens a packed chunk cuts that chunk's own start,
  // and the PREVIOUS chunk's end, to the run's own edges — production's
  // `exciseUnscriptedRuns` shape (`endSec = run.startSec`, `cursor = run.endSec`),
  // with no silence search involved: the run's boundaries ARE the cut.
  const runOpening = new Map<number, UnscriptedRun>();
  for (let ci = 0; ci < packed.length; ci++) {
    const firstGroupIdx = groups.indexOf(packed[ci]![0]!);
    const seam = seams.find(s => !s.trailing && s.groupIdx === firstGroupIdx);
    if (seam) runOpening.set(ci, seam.run);
  }
  const trailingRun = seams.find(s => s.trailing)?.run;

  const chunks: FaChunk[] = [];
  let cursor = runOpening.get(0)?.endSec ?? 0;
  for (let i = 0; i < packed.length; i++) {
    const gs = packed[i]!;
    const startSec = cursor;

    let endSec: number;
    const nextOpening = runOpening.get(i + 1);
    if (i === packed.length - 1) {
      endSec = trailingRun !== undefined ? trailingRun.startSec : audioDuration;
      cursor = endSec;
    } else if (nextOpening !== undefined) {
      endSec = nextOpening.startSec;
      cursor = nextOpening.endSec;
    } else {
      const idealEnd = gs[gs.length - 1]!.endSec;
      const cut = s2NearestSilenceCut(idealEnd, silences);
      if (cut === undefined) {
        violations.push({
          segIdx: gs[gs.length - 1]!.segIdx[gs[gs.length - 1]!.segIdx.length - 1]! + 1,
          cause: 'no-usable-silence-nearby',
          idealSec: idealEnd,
          fallback: `no detected silence exists in this corpus's silence array at all; used the `
            + `estimated seam time ${idealEnd.toFixed(3)} directly`,
        });
        endSec = idealEnd;
      } else {
        endSec = cut.cutSec;
        if (Math.abs(cut.offsetSec) > S2_SILENCE_SEARCH_WINDOW_SEC) {
          violations.push({
            segIdx: gs[gs.length - 1]!.segIdx[gs[gs.length - 1]!.segIdx.length - 1]! + 1,
            cause: 'no-usable-silence-nearby',
            idealSec: idealEnd,
            fallback: `nearest silence end is ${cut.offsetSec >= 0 ? '+' : ''}${cut.offsetSec.toFixed(3)}s from `
              + `the ideal seam, outside the ${S2_SILENCE_SEARCH_WINDOW_SEC}s search window; accepted anyway `
              + `per invariant 4 (some silence always exists) rather than split mid-sentence`,
          });
        }
      }
      cursor = endSec;
    }

    const text = gs.flatMap(g => g.segIdx).map(idx => segments[idx]!.text ?? '').filter(t => t.length > 0).join(' ');
    if (text.length === 0) continue; // Mirrors runsToChunks/attributeByIndex — never an empty-text chunk.
    // A degenerate window (the excised run consumed it entirely) is dropped
    // rather than emitted inverted; Rust would reject it and a zero-length
    // window aligns nothing.
    if (endSec <= startSec) {
      violations.push({
        segIdx: gs[0]!.segIdx[0]!,
        cause: 'unexcised-run',
        idealSec: startSec,
        fallback: `excision collapsed this chunk's window to [${startSec.toFixed(3)}, ${endSec.toFixed(3)}]; `
          + 'dropped rather than emitted inverted',
      });
      continue;
    }
    chunks.push({ startSec, endSec, text });
  }

  return {
    chunks: languageCode !== undefined && vocabChars !== undefined
      ? applyFaTextNormalization(chunks, languageCode, vocabChars)
      : chunks,
    violations,
  };
}

// ---------------------------------------------------------------------------
// PERIOD-STRICT PLANNER (WS1 Session AL, MEASUREMENT ARM ONLY — "arm D").
//
// ONE VARIABLE FROM ARM C. `computeFaChunkPlanS2Excised` above is arm C: S2's
// five invariants plus R.5 excision, at the operator-directed 10-30s band.
// This function is the SAME thing at a 1-15s band with a STRICTER sentence-end
// rule and a BOUNDED silence search. Everything else — the group atoms, the
// excision placement rule, `silence.endSec` as the cut landmark, greedy
// packing — is inherited unchanged and deliberately not re-derived, because a
// second simultaneous change would make the width result uninterpretable.
//
// SEPARATE FUNCTION, NO FLAG, NO PRODUCTION CALLER, and every band parameter
// REQUIRED rather than defaulted — the brief's "explicitly-parameterised
// path". Arms A/B/C stay byte-reproducible at this commit because nothing
// above this line is touched.
//
// THE PERIOD RULE, stated once and quoted verbatim in the session report:
//
//   A segment ENDS A SENTENCE iff, after trimming trailing whitespace and then
//   stripping any run of closing quotation/bracket characters (" ' " ' » ) ] }),
//   the final character is `.`, `!` or `?`, AND that terminator is not
//   disqualified by one of three exclusions:
//
//     E1 ELLIPSIS. The stop is the last of a run of two or more consecutive
//        `.` characters, or the character is `…`. An ellipsis marks
//        CONTINUATION, not a full stop, so it is not a legal chunk edge. This
//        is the substantive tightening over `S2_SENTENCE_TERMINATOR`, whose
//        `[.!?…]` class accepts both `…` and `...`.
//     E2 ABBREVIATION. The final `.` is immediately preceded by a token from
//        the closed list below, or by a single capital letter (an initial),
//        matched case-sensitively at a word boundary.
//     E3 DECIMAL. The final `.` is preceded by a digit AND followed by a
//        digit. At segment-final position nothing follows, so a trailing
//        `<digit>.` is a full stop and never a decimal — the exclusion is
//        stated so that this is a decision rather than an accident.
//
//   Everything else — comma, colon, semicolon, dash, or no punctuation at all
//   — is NOT a sentence end. A mis-detected period is a mid-sentence split
//   wearing a disguise, so every exclusion resolves toward FEWER legal seams.
//
// MEASURED ON v6 (Session AL Step 2 census): the script contains 368 periods,
// 95 commas and NOTHING ELSE — zero `!`, `?`, `…`, `...`, quotes, brackets,
// colons, semicolons, digits and abbreviations, at any position. So all three
// exclusions are STRUCTURALLY INERT on v6 and this rule selects exactly the
// same 368 sentence ends as `s2EndsSentence` does. Arm D is therefore a PURE
// WIDTH change from arm C on this corpus — cleaner than the brief assumed,
// and asserted rather than assumed by the Step 2 census test.
// ---------------------------------------------------------------------------

/** Closing quotation/bracket characters strippable after a terminator. Superset
 *  of `S2_SENTENCE_TERMINATOR`'s own class (adds `»` and `}`). */
const PS_CLOSERS = /["'”’»\)\]\}]+$/;

/** E2's closed abbreviation list. A CLOSED list, never a heuristic: an
 *  ML/statistical sentence guess would reintroduce exactly the inference S2
 *  exists to remove (invariant 3). */
const PS_ABBREVIATIONS = [
  'Mr', 'Mrs', 'Ms', 'Dr', 'Prof', 'St', 'Jr', 'Sr', 'vs', 'etc', 'approx',
  'Fig', 'No', 'Vol', 'Inc', 'Ltd', 'Co', 'Ave', 'Rd', 'Mt', 'Gen', 'Capt',
  'Sgt', 'Lt', 'e.g', 'i.e', 'cf', 'al',
];
const PS_ABBREV_RE = new RegExp(
  `(?:^|\\s)(?:${PS_ABBREVIATIONS.map(a => a.replace(/\./g, '\\.')).join('|')})\\.$`,
);
const PS_INITIAL_RE = /(?:^|\s)[A-Z]\.$/;

/** Why a candidate sentence end was rejected — reported per segment by the
 *  Step 2 census so every ambiguous case can be named. */
export type PeriodStrictRejection = 'no-terminator' | 'ellipsis' | 'abbreviation' | 'decimal' | 'empty';

export interface PeriodStrictVerdict {
  endsSentence: boolean;
  /** Present only when `endsSentence` is false. */
  rejectedAs?: PeriodStrictRejection;
  /** The terminator character actually found, for the census table. */
  terminator?: string;
  /** Closing characters stripped before the terminator was read. */
  closersStripped: string;
}

/** THE PERIOD RULE, executable. See the section header for the prose form. */
export function periodStrictEndsSentence(text: string | undefined): PeriodStrictVerdict {
  const trimmed = (text ?? '').trim();
  if (trimmed.length === 0) return { endsSentence: false, rejectedAs: 'empty', closersStripped: '' };

  const closerMatch = PS_CLOSERS.exec(trimmed);
  const closers = closerMatch ? closerMatch[0] : '';
  const core = closers.length > 0 ? trimmed.slice(0, -closers.length) : trimmed;
  const last = core.slice(-1);

  if (last === '…') return { endsSentence: false, rejectedAs: 'ellipsis', terminator: '…', closersStripped: closers };
  if (last === '!' || last === '?') return { endsSentence: true, terminator: last, closersStripped: closers };
  if (last !== '.') return { endsSentence: false, rejectedAs: 'no-terminator', terminator: last, closersStripped: closers };

  // E1 — a run of two or more dots is an ellipsis, not a full stop.
  if (core.slice(-2) === '..') {
    return { endsSentence: false, rejectedAs: 'ellipsis', terminator: '...', closersStripped: closers };
  }
  // E2 — abbreviation or single-capital initial.
  if (PS_ABBREV_RE.test(core) || PS_INITIAL_RE.test(core)) {
    return { endsSentence: false, rejectedAs: 'abbreviation', terminator: '.', closersStripped: closers };
  }
  // E3 — a decimal needs a digit on BOTH sides; nothing follows a segment-final
  // stop, so this can never fire here. Kept as an explicit branch so the rule
  // is complete rather than silently relying on position.
  if (/\d\.\d$/.test(core)) {
    return { endsSentence: false, rejectedAs: 'decimal', terminator: '.', closersStripped: closers };
  }
  return { endsSentence: true, terminator: '.', closersStripped: closers };
}

/** Period-strict unbreakable groups. Identical construction to
 *  `s2UnbreakableGroups` except for which predicate decides a sentence end. */
function periodStrictGroups(segments: readonly VideoSegment[]): S2Group[] {
  const groups: S2Group[] = [];
  let cur: number[] = [];
  for (let i = 0; i < segments.length; i++) {
    cur.push(i);
    if (periodStrictEndsSentence(segments[i]!.text).endsSentence || i === segments.length - 1) {
      const first = segments[cur[0]!]!;
      const last = segments[cur[cur.length - 1]!]!;
      groups.push({
        segIdx: cur,
        startSec: first.startTime,
        endSec: last.startTime + last.duration,
        durationSec: (last.startTime + last.duration) - first.startTime,
      });
      cur = [];
    }
  }
  return groups;
}

/**
 * Invariant 4, BOUNDED. Unlike `s2NearestSilenceCut` (which searches the whole
 * corpus and always accepts, flagging a far result as a violation after the
 * fact), this returns `undefined` when the nearest silence end is further than
 * `windowSec` from the ideal seam — the brief's "if no silence exists within
 * the search window". The caller then takes the geometric fallback rather than
 * accepting an arbitrarily distant silence.
 */
function periodStrictSilenceCut(
  idealSec: number, silences: readonly SilenceInterval[], windowSec: number,
): { cutSec: number; offsetSec: number } | undefined {
  let best: { cutSec: number; offsetSec: number } | undefined;
  for (const s of silences) {
    const off = s.endSec - idealSec;
    if (Math.abs(off) > windowSec) continue;
    if (best === undefined || Math.abs(off) < Math.abs(best.offsetSec)) best = { cutSec: s.endSec, offsetSec: off };
  }
  return best;
}

/**
 * The geometric fallback: the MIDPOINT of the inter-word gap straddling the
 * ideal seam — `(lastTokenEndingBefore.endSec + firstTokenStartingAfter.startSec) / 2`.
 *
 * GEOMETRIC, not fitted: a midpoint has no free parameter. Whisper timestamps
 * decide only WHERE the audio is sliced, never WHICH TEXT belongs to which
 * chunk (invariant 3 is untouched — the text was already fixed by the packer
 * before this is called). Falls back to the ideal seam itself when no token
 * straddles it, which cannot happen on a non-empty transcript but is not
 * assumed.
 */
function periodStrictGeometricCut(idealSec: number, tokens: readonly TranscriptToken[]): { cutSec: number; gapSec: number } {
  let prevEnd: number | undefined;
  let nextStart: number | undefined;
  for (const t of tokens) {
    if (t.endSec <= idealSec) { if (prevEnd === undefined || t.endSec > prevEnd) prevEnd = t.endSec; }
    if (t.startSec >= idealSec) { if (nextStart === undefined || t.startSec < nextStart) nextStart = t.startSec; }
  }
  if (prevEnd === undefined || nextStart === undefined || nextStart < prevEnd) {
    return { cutSec: idealSec, gapSec: 0 };
  }
  return { cutSec: (prevEnd + nextStart) / 2, gapSec: nextStart - prevEnd };
}

/** A period-strict plan's first-class violation events. A superset of S2's
 *  causes; a SEPARATE type so `FaChunkPlanS2Violation` — which arms B and C
 *  are reported against — is not perturbed. */
export interface FaChunkPlanPeriodStrictViolation {
  segIdx: number;
  cause:
    | 'oversize-unbreakable-group'
    | 'cap-exceeded'
    | 'geometric-fallback-cut'
    | 'degenerate-final-chunk-merged'
    | 'unexcised-run'
    | 'excision-collapsed-chunk';
  idealSec: number;
  /** Seam time actually committed, where the event concerns a cut. */
  seamSec?: number;
  /** Chunk duration, where the event concerns a chunk's size. */
  durationSec?: number;
  fallback: string;
}

/** One row of the chunk inspection dump — everything the brief's table needs,
 *  produced by the planner itself so the dump cannot drift from the plan. */
export interface PeriodStrictChunkInspection {
  index: number;
  startSec: number;
  endSec: number;
  durationSec: number;
  /** The chunk's final ~80 characters, punctuation included. */
  endingText: string;
  sentenceCount: number;
  segFrom: number;
  segTo: number;
  /** How the chunk's END was placed. */
  cutKind: 'detected-silence' | 'geometric-fallback' | 'excision-run-edge' | 'corpus-end';
  /** Signed offset of the committed cut from the ideal (estimate) seam. */
  cutOffsetSec: number;
  exceededCap: boolean;
}

export interface FaChunkPlanPeriodStrictResult {
  chunks: FaChunk[];
  violations: FaChunkPlanPeriodStrictViolation[];
  inspection: PeriodStrictChunkInspection[];
}

/**
 * ARM D. Period-strict grouping, operator-directed `[targetMinSec,
 * targetMaxSec]` band with `targetMaxSec` as a HARD CAP, bounded silence
 * search with a geometric-midpoint fallback, and R.5 excision ON (matching arm
 * C, so this is a one-variable change from it).
 *
 * INVARIANTS, in the brief's strict precedence order:
 *   1. A chunk's text is a whole number of script segments and never splits a
 *      sentence. INVIOLABLE — nothing below may override it.
 *   2. Chunks end only at a full stop (`periodStrictEndsSentence`). Never at a
 *      comma, colon or semicolon.
 *   3. Whisper timestamps are excluded ENTIRELY from deciding which text
 *      belongs to which chunk. They inform only WHERE audio is sliced.
 *   4. The audio cut is the detected silence corresponding to the chosen
 *      period; with none inside `silenceWindowSec`, the chunk still ends at
 *      that period and the cut is the geometric midpoint of the inter-word
 *      gap, LOGGED — never slid to the next period.
 *   5. Target `[targetMinSec, targetMaxSec]`, hard cap `targetMaxSec`. A
 *      single sentence or unbreakable group that exceeds the cap exceeds it,
 *      with a first-class violation carrying the seam, duration and cause.
 *      Never a mid-sentence split to satisfy the cap.
 *
 * PACKING — greedy left-to-right over groups, never balanced, and stated
 * rather than left implicit. A break is taken immediately before group g iff
 * (i) an R.5 excision seam forces one there — a forced break always wins over
 * the band, because it is an invariant and the band is a preference — or
 * (ii) `acc + weight(g) > targetMaxSec` and `acc >= targetMinSec`, where
 * `weight(g)` is the group's estimated span NET of any excised run overlapping
 * it. Greedy rather than balanced because balancing needs a global objective,
 * and every objective function is a knob whose weight would have to be fitted
 * to a corpus — which R-AS forbids. Greedy adds no free parameter beyond the
 * operator-directed band.
 *
 * DEGENERATE FINAL CHUNK — after packing, a last chunk whose net weight is
 * below `targetMinSec` is merged back into its predecessor and a
 * `degenerate-final-chunk-merged` event is emitted, UNLESS a forced excision
 * break separates them (invariant precedence again). If the merge pushes the
 * predecessor past the cap, a `cap-exceeded` event is emitted too: the cap
 * yields to anti-degeneracy, never the reverse, because a sub-`targetMinSec`
 * window cannot be aligned meaningfully while an oversize one merely costs
 * memory.
 *
 * NO PRODUCTION CALLER, NO FLAG, NO DEFAULTS. Every band parameter is
 * required. THE SHIP DECISION remains a separate, operator-signed step.
 */
export function computeFaChunkPlanPeriodStrict(
  segments: readonly VideoSegment[],
  tokens: readonly TranscriptToken[],
  silences: readonly SilenceInterval[],
  audioDuration: number,
  targetMinSec: number,
  targetMaxSec: number,
  silenceWindowSec: number,
  languageCode?: FaLanguageCode,
  vocabChars?: ReadonlySet<string>,
): FaChunkPlanPeriodStrictResult {
  if (segments.length === 0) return { chunks: [], violations: [], inspection: [] };

  const groups = periodStrictGroups(segments);
  const violations: FaChunkPlanPeriodStrictViolation[] = [];

  // R.5, reused unchanged — the shipped detector, as arm C uses it.
  const runs = computeUnscriptedRuns(segments, tokens, silences, audioDuration);

  // `qiSplit` -> segment -> group, exactly as arm C places an excision seam.
  const qiRanges = s2SegQiRanges(segments, languageCode);
  const totalQi = qiRanges[qiRanges.length - 1]?.end ?? 0;
  const groupOfSeg = new Map<number, number>();
  groups.forEach((g, gi) => { for (const si of g.segIdx) groupOfSeg.set(si, gi); });

  const seams: S2ExcisionSeam[] = [];
  for (const run of runs) {
    if (run.qiSplit >= totalQi) { seams.push({ groupIdx: groups.length, run, trailing: true }); continue; }
    const segIdx = qiRanges.findIndex(r => run.qiSplit >= r.start && run.qiSplit < r.end);
    const gi = segIdx >= 0 ? groupOfSeg.get(segIdx) : undefined;
    if (gi === undefined) {
      violations.push({
        segIdx: segIdx >= 0 ? segIdx : 0,
        cause: 'unexcised-run',
        idealSec: run.startSec,
        fallback: `R.5 run [${run.startSec.toFixed(2)}, ${run.endSec.toFixed(2)}] has qiSplit ${run.qiSplit}, which `
          + 'maps to no segment in this script; left INSIDE whatever chunk contains it rather than guessed at',
      });
      continue;
    }
    seams.push({ groupIdx: gi, run, trailing: false });
  }

  const forcedBreakAt = new Set(seams.filter(s => !s.trailing).map(s => s.groupIdx));
  const weightOf = (g: S2Group): number =>
    Math.max(0, g.durationSec - s2ExcisedWithin(g.startSec, g.endSec, runs));

  // ---- greedy pack, groups only ------------------------------------------
  const packed: S2Group[][] = [];
  {
    let cur: S2Group[] = [];
    let acc = 0;
    for (let i = 0; i < groups.length; i++) {
      const g = groups[i]!;
      const w = weightOf(g);
      if (cur.length > 0 && (forcedBreakAt.has(i) || (acc + w > targetMaxSec && acc >= targetMinSec))) {
        packed.push(cur); cur = []; acc = 0;
      }
      cur.push(g); acc += w;
    }
    if (cur.length > 0) packed.push(cur);
  }

  // ---- anti-degeneracy on the FINAL chunk only ----------------------------
  if (packed.length >= 2) {
    const lastPack = packed[packed.length - 1]!;
    const lastWeight = lastPack.reduce((a, g) => a + weightOf(g), 0);
    const firstGroupIdxOfLast = groups.indexOf(lastPack[0]!);
    const separatedByForcedBreak = forcedBreakAt.has(firstGroupIdxOfLast);
    if (lastWeight < targetMinSec && !separatedByForcedBreak) {
      const prev = packed[packed.length - 2]!;
      const mergedWeight = prev.reduce((a, g) => a + weightOf(g), 0) + lastWeight;
      violations.push({
        segIdx: lastPack[0]!.segIdx[0]!,
        cause: 'degenerate-final-chunk-merged',
        idealSec: lastPack[0]!.startSec,
        durationSec: +lastWeight.toFixed(3),
        fallback: `final chunk's net weight ${lastWeight.toFixed(3)}s is below targetMin ${targetMinSec}s; merged `
          + `back into its predecessor (merged net weight ${mergedWeight.toFixed(3)}s)`,
      });
      prev.push(...lastPack);
      packed.pop();
    }
  }

  for (const g of groups) {
    if (g.durationSec > targetMaxSec) {
      violations.push({
        segIdx: g.segIdx[0]!,
        cause: 'oversize-unbreakable-group',
        idealSec: g.startSec,
        durationSec: +g.durationSec.toFixed(3),
        fallback: `single unbreakable group spans ${g.durationSec.toFixed(2)}s (segments ${g.segIdx[0]}-`
          + `${g.segIdx[g.segIdx.length - 1]}); invariant 1 forbids splitting a sentence regardless of the `
          + `${targetMaxSec}s cap, so the cap is exceeded deliberately`,
      });
    }
  }

  // ---- emit ---------------------------------------------------------------
  const runOpening = new Map<number, UnscriptedRun>();
  for (let ci = 0; ci < packed.length; ci++) {
    const firstGroupIdx = groups.indexOf(packed[ci]![0]!);
    const seam = seams.find(s => !s.trailing && s.groupIdx === firstGroupIdx);
    if (seam) runOpening.set(ci, seam.run);
  }
  const trailingRun = seams.find(s => s.trailing)?.run;

  const chunks: FaChunk[] = [];
  const inspection: PeriodStrictChunkInspection[] = [];
  let cursor = runOpening.get(0)?.endSec ?? 0;
  // Script segments carried over from a chunk whose audio window collapsed —
  // see `excision-collapsed-chunk` below. NEVER dropped: the plan as a whole
  // must carry every segment exactly once, which is what makes the text
  // conservation check against arm C meaningful.
  let carried: number[] = [];
  let carriedFrom: number | undefined;
  for (let i = 0; i < packed.length; i++) {
    const gs = packed[i]!;
    const startSec = cursor;
    const lastGroup = gs[gs.length - 1]!;
    const idealEnd = lastGroup.endSec;
    const seamSegIdx = lastGroup.segIdx[lastGroup.segIdx.length - 1]!;

    let endSec: number;
    let cutKind: PeriodStrictChunkInspection['cutKind'];
    let nextCursor: number;
    const nextOpening = runOpening.get(i + 1);
    if (i === packed.length - 1) {
      endSec = trailingRun !== undefined ? trailingRun.startSec : audioDuration;
      cutKind = trailingRun !== undefined ? 'excision-run-edge' : 'corpus-end';
      nextCursor = endSec;
    } else if (nextOpening !== undefined) {
      endSec = nextOpening.startSec;
      cutKind = 'excision-run-edge';
      nextCursor = nextOpening.endSec;
    } else {
      const cut = periodStrictSilenceCut(idealEnd, silences, silenceWindowSec);
      if (cut === undefined) {
        const geo = periodStrictGeometricCut(idealEnd, tokens);
        endSec = geo.cutSec;
        cutKind = 'geometric-fallback';
        violations.push({
          segIdx: seamSegIdx + 1,
          cause: 'geometric-fallback-cut',
          idealSec: idealEnd,
          seamSec: +geo.cutSec.toFixed(3),
          fallback: `no detected silence within \u00b1${silenceWindowSec}s of the ideal seam ${idealEnd.toFixed(3)}; `
            + `chunk still ends at THIS period (never slid to the next) and the audio is cut at the geometric `
            + `midpoint of the ${geo.gapSec.toFixed(3)}s inter-word gap, ${geo.cutSec.toFixed(3)}`,
        });
      } else {
        endSec = cut.cutSec;
        cutKind = 'detected-silence';
      }
      nextCursor = endSec;
    }

    const segIdxThisChunk = [...carried, ...gs.flatMap(g => g.segIdx)];
    const text = segIdxThisChunk.map(idx => segments[idx]!.text ?? '').filter(t => t.length > 0).join(' ');

    // A COLLAPSED WINDOW. `cursor` sits at an excised run's far edge while this
    // chunk's own estimate-derived seam lies BEHIND it — the arm-C section
    // header's own observation that a recitation displaces the estimate, made
    // visible by a narrow band where one chunk no longer spans the whole
    // displacement. Two conservation properties are enforced here, neither of
    // them a new rule:
    //   TEXT — this chunk's segments are CARRIED FORWARD into the next emitted
    //     chunk, never dropped. Invariant 1 still holds (whole segments) and so
    //     does invariant 2 (the carrying chunk still ends at a full stop).
    //   TIME — `cursor` is NOT advanced to a value behind itself. A chunk plan
    //     that walked backwards would emit overlapping windows, which
    //     `align_chunked` would align twice.
    if (endSec <= startSec || text.length === 0) {
      if (text.length > 0) {
        violations.push({
          segIdx: segIdxThisChunk[0]!,
          cause: 'excision-collapsed-chunk',
          idealSec: idealEnd,
          seamSec: +endSec.toFixed(3),
          durationSec: +(endSec - startSec).toFixed(3),
          fallback: `window collapsed to [${startSec.toFixed(3)}, ${endSec.toFixed(3)}] because an excised run `
            + `left the cursor past this chunk's own seam; segments ${segIdxThisChunk[0]}-${seamSegIdx} carried `
            + 'forward into the next emitted chunk rather than dropped, and the cursor held rather than moved back',
        });
        if (carriedFrom === undefined) carriedFrom = segIdxThisChunk[0]!;
        carried = segIdxThisChunk;
      }
      // Monotone non-decreasing, always. A collapsed silence cut holds the
      // cursor where it is; a collapsed run edge still advances past the run,
      // because the run's audio must be excised either way.
      cursor = Math.max(cursor, nextCursor);
      continue;
    }
    carried = [];

    const durationSec = endSec - startSec;
    const exceededCap = durationSec > targetMaxSec;
    if (exceededCap) {
      violations.push({
        segIdx: segIdxThisChunk[0]!,
        cause: 'cap-exceeded',
        idealSec: startSec,
        seamSec: +endSec.toFixed(3),
        durationSec: +durationSec.toFixed(3),
        fallback: `emitted chunk spans ${durationSec.toFixed(3)}s, over the ${targetMaxSec}s cap (segments `
          + `${segIdxThisChunk[0]}-${seamSegIdx}); invariant 1 forbids the mid-sentence split that would avoid it`,
      });
    }
    inspection.push({
      index: chunks.length,
      startSec: +startSec.toFixed(6),
      endSec: +endSec.toFixed(6),
      durationSec: +durationSec.toFixed(6),
      endingText: text.slice(-80),
      sentenceCount: gs.length,
      segFrom: carriedFrom ?? segIdxThisChunk[0]!,
      segTo: seamSegIdx,
      cutKind,
      cutOffsetSec: +(endSec - idealEnd).toFixed(6),
      exceededCap,
    });
    carriedFrom = undefined;
    chunks.push({ startSec, endSec, text });
    cursor = nextCursor;
  }

  // Anything still carried at the end of the loop would be lost text. There is
  // no legal plan that drops it, so this is an assertion, not a fallback.
  if (carried.length > 0) {
    violations.push({
      segIdx: carried[0]!,
      cause: 'excision-collapsed-chunk',
      idealSec: audioDuration,
      fallback: `segments ${carried[0]}-${carried[carried.length - 1]} were carried past the final chunk and `
        + 'have no window; the plan is INCOMPLETE and must not be aligned',
    });
  }

  return {
    chunks: languageCode !== undefined && vocabChars !== undefined
      ? applyFaTextNormalization(chunks, languageCode, vocabChars)
      : chunks,
    violations,
    inspection,
  };
}

// ---------------------------------------------------------------------------
// EDGE-PLACEMENT SUBSTITUTION SURFACE (WS1 Session AM, MEASUREMENT ONLY).
//
// WHAT THIS IS FOR. Every S2-family arm (B, C, D) places an internal chunk edge
// by taking the closing sentence group's ESTIMATE-DERIVED end time and snapping
// a detected silence to it. Production does not: `runQiRanges` above pairs each
// chunk edge with a `faAnchors.ts` three-source-agreement anchor BY SCRIPT-WORD
// INDEX, never by time. Session AL measured production's per-decile drift at
// identically zero and every S2 arm's at an arch tracking the estimate's own
// error at r >= 0.973. This accessor exposes, WITHOUT ALIGNING ANYTHING, how
// much of the S2 edge set could actually be re-placed the production way — the
// coverage question that decides whether arm F is a full or partial
// substitution, asked BEFORE the arm is built or run.
//
// READ-ONLY AND ADDITIVE. It computes no plan, emits no chunk, and is called by
// no production path. `computeRunContext` is reused unchanged, so the anchors
// reported here are bit-for-bit the anchors production would use.
//
// INDEX SPACE, NOT TIME. `pickSeamAnchor` decides WHICH anchor IS a given seam
// by comparing script-word indices — `CLAUDE.md` §4's rule that timestamps may
// measure distance but never decide identity, whose named worked violation is
// `faAnchors.ts`'s own `findAgreeingSilence` matching by timestamp proximity. A
// time-radius search would additionally be self-defeating: the ideal seam time
// is READ OFF THE ESTIMATE, so searching near it in time re-imports exactly the
// error the substitution exists to remove. `anchorMinusIdealSec` below is
// therefore a REPORTED MEASUREMENT and never a decision input.
// ---------------------------------------------------------------------------

/** The anchor an index-space search selected for one seam, or the reason none
 *  was admissible. */
export interface SeamAnchorPick {
  anchorIdx: number;
  qi: number;
  tokenIdx: number;
  timeSec: number;
  /** `anchor.qi - seamQi`. Zero means the anchor IS the seam: `faAnchors.ts`
   *  defines an anchor's time as the END of the detected silence spanning the
   *  token seam immediately before script word `qi`, i.e. the instant word `qi`
   *  begins. */
  deltaQi: number;
}

/**
 * The one anchor-selection rule, shared by the surface accessor and by arm F's
 * planner so the two can never disagree about what "the anchor for this seam"
 * means.
 *
 * Nearest anchor to `seamQi` by |Δqi|, admissible only while its own `qi` lies
 * in `[windowQiLo, windowQiHi)` — the half-open script-word span of the two
 * sentence groups the seam separates. That window is STRUCTURAL, not a
 * tolerance: sentence groups are the planner's own atoms and the only place
 * invariant 2 permits an edge, so an anchor outside the pair belongs to a
 * DIFFERENT legal seam and committing it here would place this chunk's edge at
 * another chunk's boundary. There is no millisecond radius and no tunable.
 *
 * TIE-BREAK on equal |Δqi|: prefer `qi >= seamQi`. A chunk's TEXT is fixed by
 * packing, so an edge placed late leaves the closing chunk holding audio for
 * words whose text it also holds, while an edge placed early hands the opening
 * chunk audio for words whose text stayed behind. Late is the recoverable
 * direction. Stated so it is a decision rather than an accident.
 *
 * `anchors` must be ascending in `qi` — `computeAnchors` emits them in query
 * order, and this function asserts nothing about it because a violation would
 * only ever pick a farther-but-still-admissible anchor, never an inadmissible
 * one: the window test is applied per candidate, not to a range.
 */
export function pickSeamAnchor(
  anchors: readonly FaAnchor[],
  seamQi: number,
  windowQiLo: number,
  windowQiHi: number,
): SeamAnchorPick | undefined {
  let best: SeamAnchorPick | undefined;
  for (let i = 0; i < anchors.length; i++) {
    const a = anchors[i]!;
    if (a.qi < windowQiLo || a.qi >= windowQiHi) continue;
    const deltaQi = a.qi - seamQi;
    if (best === undefined
      || Math.abs(deltaQi) < Math.abs(best.deltaQi)
      || (Math.abs(deltaQi) === Math.abs(best.deltaQi) && deltaQi > best.deltaQi)) {
      best = { anchorIdx: i, qi: a.qi, tokenIdx: a.tokenIdx, timeSec: a.timeSec, deltaQi };
    }
  }
  return best;
}

/** One sentence-group end — a place the S2 planner is permitted to break —
 *  paired with what each edge-placement rule would commit there. */
export interface S2SeamSurfaceRow {
  /** Index into the group array; the seam sits between this group and the next. */
  groupIdx: number;
  firstSegIdx: number;
  /** The segment whose end IS the seam. */
  lastSegIdx: number;
  /** The script-word index at the seam — the identity coordinate. */
  seamQi: number;
  /** The estimate-derived ideal seam time (`applyAnchorBasedTiming`'s own group
   *  end). What arms B/C/D snap a silence to. */
  idealSec: number;
  /** What arm C commits here: the nearest detected silence END to `idealSec`. */
  silenceCutSec?: number;
  /** `silenceCutSec - idealSec`. */
  silenceOffsetSec?: number;
  /** The structural admissibility window, in script-word indices. */
  windowQiLo: number;
  windowQiHi: number;
  /** The anchor an index-space search selects, when one is admissible. */
  pick?: SeamAnchorPick;
  /** REPORTED ONLY, never a decision input: how far the selected anchor's time
   *  sits from the estimate-derived ideal seam. This is the "substitution
   *  surface" the session brief asks for in milliseconds. */
  anchorMinusIdealSec?: number;
}

export interface S2SeamSurface {
  /** Every anchor `computeFaAnchors` emits for this corpus. */
  anchors: readonly FaAnchor[];
  /** Anchors carrying THREE-SOURCE AGREEMENT. Equal to `anchors.length` by
   *  construction, not by coincidence: `computeAnchors` emits an anchor only
   *  when the Hirschberg op is a `'match'` (script agrees with Whisper), the
   *  token is R-O-distinctive inside a long enough match run, AND a detected
   *  silence spans the token seam before it (R.1(c)/I6). There is no
   *  weaker-provenance anchor to filter out — reported explicitly so "how many
   *  carry three-source agreement" is answered by the code path rather than
   *  assumed. */
  threeSourceAnchors: number;
  totalQi: number;
  groupCount: number;
  /** One row per sentence-group end the planner may break at, excluding the
   *  corpus's final group (which has no seam after it). */
  rows: S2SeamSurfaceRow[];
  /** Provenance census of `computeFaAnchors`'s own run partition, so a forced
   *  split is never miscounted as an anchor. */
  runBoundaryProvenance: Record<string, number>;
}

/**
 * Enumerates every sentence-group end on a corpus and reports, per seam, what
 * arm C's silence rule commits and what an index-space anchor search would
 * commit instead. Computes no chunk plan and runs no alignment.
 */
export function computeS2SeamSurface(
  segments: readonly VideoSegment[],
  tokens: readonly TranscriptToken[],
  silences: readonly SilenceInterval[],
  audioDuration: number,
  languageCode?: FaLanguageCode,
): S2SeamSurface {
  const ctx = computeRunContext(segments, tokens, silences, audioDuration, languageCode);
  const groups = s2UnbreakableGroups(segments);
  const qiRanges = s2SegQiRanges(segments, languageCode);

  const runBoundaryProvenance: Record<string, number> = {};
  for (const r of ctx.runs) {
    runBoundaryProvenance[r.endProvenance] = (runBoundaryProvenance[r.endProvenance] ?? 0) + 1;
  }

  const rows: S2SeamSurfaceRow[] = [];
  for (let gi = 0; gi < groups.length - 1; gi++) {
    const g = groups[gi]!;
    const next = groups[gi + 1]!;
    const firstSegIdx = g.segIdx[0]!;
    const lastSegIdx = g.segIdx[g.segIdx.length - 1]!;
    const seamQi = qiRanges[lastSegIdx]!.end;
    const windowQiLo = qiRanges[firstSegIdx]!.start;
    const windowQiHi = qiRanges[next.segIdx[next.segIdx.length - 1]!]!.end;

    const cut = s2NearestSilenceCut(g.endSec, silences);
    const pick = pickSeamAnchor(ctx.anchors, seamQi, windowQiLo, windowQiHi);
    rows.push({
      groupIdx: gi,
      firstSegIdx,
      lastSegIdx,
      seamQi,
      idealSec: g.endSec,
      silenceCutSec: cut?.cutSec,
      silenceOffsetSec: cut?.offsetSec,
      windowQiLo,
      windowQiHi,
      pick,
      anchorMinusIdealSec: pick === undefined ? undefined : pick.timeSec - g.endSec,
    });
  }

  return {
    anchors: ctx.anchors,
    threeSourceAnchors: ctx.anchors.length,
    totalQi: ctx.totalQi,
    groupCount: groups.length,
    rows,
    runBoundaryProvenance,
  };
}

// ---------------------------------------------------------------------------
// EDGE-PLACEMENT ARMS F AND G (WS1 Session AM, MEASUREMENT ARMS ONLY).
//
// ONE VARIABLE FROM ARM C — and ARM C, NOT ARM D, IS THE BASE. Everything
// except WHERE an internal chunk edge is cut is inherited from
// `computeFaChunkPlanS2Excised` unchanged and deliberately not re-derived: the
// same `s2UnbreakableGroups` atoms, the same R.5 excision placement rule via
// `qiSplit`, the same net-of-excision greedy packing, the same 10-30s
// operator-directed band, the same `s2NearestSilenceCut` used as the fallback,
// the same invariants in the same precedence order. A second simultaneous
// change would make the edge-placement result uninterpretable, which is the
// whole lesson of Session AL's width arm.
//
// WHY EDGE PLACEMENT IS THE VARIABLE. Session AL eliminated chunk width
// (halving the band RAISED peak drift and broke monotonicity) and found the
// same arch in `applyAnchorBasedTiming`'s OWN per-decile error against the
// oracle, correlating with every S2 arm at r >= 0.973. What survives that
// elimination is the one thing every S2-family arm shares and production does
// NOT: an S2 edge is a detected silence snapped to a seam time READ OFF THE
// CHARACTER-WEIGHT ESTIMATE, whereas `runQiRanges` above pairs each production
// edge with a three-source-agreement anchor BY SCRIPT-WORD INDEX.
//
//   ARM F — `{ kind: 'anchor' }`. The estimate-derived cut is replaced by the
//     `pickSeamAnchor` selection above: nearest anchor to the seam's own script
//     word index, admissible only inside the two sentence groups the seam
//     separates. GEOMETRIC, zero numeric constants, and index-space by
//     necessity — see `pickSeamAnchor`'s doc comment for why a time-radius
//     search would both violate CLAUDE.md §4 and re-import the very estimate
//     error the arm exists to remove.
//
//   ARM G — `{ kind: 'attested' }`. THE CEILING, AND DIAGNOSTIC-ONLY: IT CAN
//     NEVER SHIP. It places every internal edge at the ORACLE's own attested
//     boundary time for the segment that opens the next chunk, i.e. it consumes
//     ground truth, and exists solely to answer "if chunk edges were PERFECT,
//     would the arch go away?". It is unreachable from production by
//     CONSTRUCTION, not by convention: the attested table is a REQUIRED field
//     with no default and no fixture read anywhere in `src/`, so an arm-G plan
//     is unconstructible without a caller that already holds every oracle value
//     and passes them in explicitly. Nothing in `src/` can supply one.
//
// NO PRODUCTION CALLER, NO FLAG ON AN EXISTING FUNCTION, AND ARMS A/B/C/D STAY
// BYTE-REPRODUCIBLE at this commit because nothing above this line is touched.
// `{ kind: 'silence' }` reproduces `computeFaChunkPlanS2Excised` exactly and is
// asserted to, so "held identical to arm C" is a measured claim rather than a
// promise.
// ---------------------------------------------------------------------------

/** How an internal chunk edge is placed. The discriminant IS the arm. */
export type S2EdgePlacement =
  /** ARM C's rule, reproduced exactly — the control for the other two. */
  | { kind: 'silence' }
  /** ARM F. */
  | { kind: 'anchor' }
  /**
   * ARM H (WS1 Session AN). ONE VARIABLE FROM ARM F: identical to `{kind:
   * 'anchor'}` in every respect, EXCEPT that when arm F's own immediate
   * two-group window (`pickSeamAnchor`'s `[windowQiLo, windowQiHi)`, the
   * closing group and the opening group only) admits no anchor, arm H makes
   * exactly ONE additional attempt — the SAME search, widened by exactly one
   * more sentence group on each side (the group immediately before the
   * closing group, and the group immediately after the opening group) — before
   * falling back to arm C's own silence cut. Still GEOMETRIC and zero
   * numeric constants: "one more of the planner's own atoms" is not a
   * millisecond radius. See `computeFaChunkPlanS2EdgeArm`'s arm-H branch for
   * why the widening stops at one group rather than searching further.
   */
  | { kind: 'anchor-widened' }
  /**
   * ARM G. DIAGNOSTIC ONLY — CONSUMES GROUND TRUTH AND CAN NEVER SHIP.
   * `attestedStartBySegIdx` maps a segment index to its attested boundary time;
   * a seam takes the attested start of the segment that OPENS the next chunk.
   * Required, with no default: this is what makes arm G unreachable from any
   * production path.
   */
  | { kind: 'attested'; attestedStartBySegIdx: ReadonlyMap<number, number> };

export interface FaChunkPlanEdgeArmInspection {
  index: number;
  startSec: number;
  endSec: number;
  durationSec: number;
  segFrom: number;
  /** The segment whose end IS this chunk's closing seam. */
  segTo: number;
  /** How this chunk's END was placed. `'anchor-widened'` (arm H only) means
   *  the immediate two-group window found nothing and the one-group-wider
   *  search is what actually supplied the anchor. */
  cutKind: 'anchor' | 'anchor-widened' | 'attested' | 'detected-silence' | 'excision-run-edge' | 'corpus-end';
  /** The estimate-derived ideal seam this chunk would have been cut at under
   *  arm C — retained on EVERY row, including substituted ones, so the size of
   *  the substitution is visible per edge rather than only in aggregate. */
  idealSec: number;
  /** Committed cut minus `idealSec`. */
  cutOffsetSec: number;
  /** Arm F only: `anchor.qi - seamQi`. Zero means the anchor IS the seam. */
  deltaQi?: number;
  /** Arm F only: the anchor's own script-word index. */
  anchorQi?: number;
  exceededCap: boolean;
}

export interface FaChunkPlanEdgeArmViolation {
  segIdx: number;
  cause:
    | 'oversize-unbreakable-group'
    | 'no-usable-silence-nearby'
    | 'unexcised-run'
    | 'no-admissible-anchor'
    | 'no-attested-time'
    | 'excision-collapsed-chunk'
    | 'cap-exceeded';
  idealSec: number;
  seamSec?: number;
  durationSec?: number;
  fallback: string;
}

export interface FaChunkPlanEdgeArmResult {
  chunks: FaChunk[];
  violations: FaChunkPlanEdgeArmViolation[];
  inspection: FaChunkPlanEdgeArmInspection[];
  /** How many internal edges each placement route actually produced — the
   *  substitution rate, measured on the emitted plan rather than predicted. */
  edgeCensus: Record<string, number>;
}

/**
 * ARMS F AND G, and arm C as their control, behind one placement discriminant.
 *
 * INVARIANTS — arm C's, unchanged and in arm C's own precedence order:
 *   1. A chunk's text is a whole number of script segments and never splits a
 *      sentence group. INVIOLABLE.
 *   2. A chunk edge falls only at a sentence-group boundary.
 *   3. Whisper timestamps never decide which text belongs to which chunk; they
 *      inform only where audio is sliced.
 *   4. The audio cut is placed by `placement`. This is the ONLY line that
 *      differs between the three arms.
 *   5. Target `[targetMinSec, targetMaxSec]`; an unbreakable group that exceeds
 *      the cap exceeds it, with a first-class violation.
 *
 * CONSERVATION, carried forward from Session AL's arm D because an edge that
 * moves by a measured median of eleven seconds can collapse a window exactly as
 * a narrow band could:
 *   TEXT — a chunk whose audio window collapses has its segments CARRIED
 *     FORWARD into the next emitted chunk, never dropped, so the plan still
 *     carries every segment exactly once and text conservation against arm C
 *     stays a meaningful check.
 *   TIME — `cursor` is never advanced to a value behind itself. A plan that
 *     walked backwards would emit overlapping windows, which `align_chunked`
 *     would align twice.
 * Both are reported per run rather than assumed inert.
 */
export function computeFaChunkPlanS2EdgeArm(
  segments: readonly VideoSegment[],
  tokens: readonly TranscriptToken[],
  silences: readonly SilenceInterval[],
  audioDuration: number,
  placement: S2EdgePlacement,
  targetMinSec: number,
  targetMaxSec: number,
  languageCode?: FaLanguageCode,
  vocabChars?: ReadonlySet<string>,
): FaChunkPlanEdgeArmResult {
  const empty: FaChunkPlanEdgeArmResult = { chunks: [], violations: [], inspection: [], edgeCensus: {} };
  if (segments.length === 0) return empty;

  const groups = s2UnbreakableGroups(segments);
  const violations: FaChunkPlanEdgeArmViolation[] = [];

  // ---- arm C's own preamble, verbatim in behaviour ------------------------
  const runs = computeUnscriptedRuns(segments, tokens, silences, audioDuration);
  const qiRanges = s2SegQiRanges(segments, languageCode);
  const totalQi = qiRanges[qiRanges.length - 1]?.end ?? 0;
  const groupOfSeg = new Map<number, number>();
  groups.forEach((g, gi) => { for (const si of g.segIdx) groupOfSeg.set(si, gi); });

  const seams: S2ExcisionSeam[] = [];
  for (const run of runs) {
    if (run.qiSplit >= totalQi) { seams.push({ groupIdx: groups.length, run, trailing: true }); continue; }
    const segIdx = qiRanges.findIndex(r => run.qiSplit >= r.start && run.qiSplit < r.end);
    const gi = segIdx >= 0 ? groupOfSeg.get(segIdx) : undefined;
    if (gi === undefined) {
      violations.push({
        segIdx: segIdx >= 0 ? segIdx : 0,
        cause: 'unexcised-run',
        idealSec: run.startSec,
        fallback: `R.5 run [${run.startSec.toFixed(2)}, ${run.endSec.toFixed(2)}] has qiSplit ${run.qiSplit}, which `
          + 'maps to no segment in this script; the run is left INSIDE whatever chunk contains it rather than '
          + 'guessed at, matching production exciseUnscriptedRuns\'s own not-wholly-contained behaviour',
      });
      continue;
    }
    seams.push({ groupIdx: gi, run, trailing: false });
  }

  const forcedBreakAt = new Set(seams.filter(s => !s.trailing).map(s => s.groupIdx));
  const packed = s2PackGroupsExcised(groups, runs, forcedBreakAt, targetMinSec, targetMaxSec);

  for (const g of groups) {
    if (g.durationSec > targetMaxSec) {
      violations.push({
        segIdx: g.segIdx[0]!,
        cause: 'oversize-unbreakable-group',
        idealSec: g.startSec,
        durationSec: +g.durationSec.toFixed(3),
        fallback: `emitted whole as one ${g.durationSec.toFixed(2)}s chunk (segments `
          + `${g.segIdx[0]}-${g.segIdx[g.segIdx.length - 1]}); rule 2 forbids splitting a sentence group `
          + `regardless of the ${targetMaxSec}s cap`,
      });
    }
  }

  const runOpening = new Map<number, UnscriptedRun>();
  for (let ci = 0; ci < packed.length; ci++) {
    const firstGroupIdx = groups.indexOf(packed[ci]![0]!);
    const seam = seams.find(s => !s.trailing && s.groupIdx === firstGroupIdx);
    if (seam) runOpening.set(ci, seam.run);
  }
  const trailingRun = seams.find(s => s.trailing)?.run;

  // Anchors are computed ONCE, and only for the arm that needs them — arm C's
  // and arm G's plans must not pay for, or be perturbed by, a pass they do not
  // use.
  const anchors: readonly FaAnchor[] = placement.kind === 'anchor' || placement.kind === 'anchor-widened'
    ? computeRunContext(segments, tokens, silences, audioDuration, languageCode).anchors
    : [];

  const chunks: FaChunk[] = [];
  const inspection: FaChunkPlanEdgeArmInspection[] = [];
  const edgeCensus: Record<string, number> = {};
  let cursor = runOpening.get(0)?.endSec ?? 0;
  let carried: number[] = [];
  let carriedFrom: number | undefined;

  for (let i = 0; i < packed.length; i++) {
    const gs = packed[i]!;
    const startSec = cursor;
    const lastGroup = gs[gs.length - 1]!;
    const idealEnd = lastGroup.endSec;
    const seamSegIdx = lastGroup.segIdx[lastGroup.segIdx.length - 1]!;

    let endSec: number;
    let cutKind: FaChunkPlanEdgeArmInspection['cutKind'];
    let nextCursor: number;
    let deltaQi: number | undefined;
    let anchorQi: number | undefined;
    const nextOpening = runOpening.get(i + 1);

    if (i === packed.length - 1) {
      // The corpus's last edge is not an internal seam and is not substituted
      // in any arm — there is nothing after it for an anchor or an attested
      // time to mark.
      endSec = trailingRun !== undefined ? trailingRun.startSec : audioDuration;
      cutKind = trailingRun !== undefined ? 'excision-run-edge' : 'corpus-end';
      nextCursor = endSec;
    } else if (nextOpening !== undefined) {
      // An excision seam's cut is the RUN'S OWN edge in every arm — it is not
      // estimate-derived, so there is nothing here to substitute. Held
      // identical to arm C deliberately.
      endSec = nextOpening.startSec;
      cutKind = 'excision-run-edge';
      nextCursor = nextOpening.endSec;
    } else {
      // ================= THE ONE LINE THAT DIFFERS =======================
      const nextPack = packed[i + 1]!;
      const openingSegIdx = nextPack[0]!.segIdx[0]!;
      let placed: { cutSec: number; kind: FaChunkPlanEdgeArmInspection['cutKind'] } | undefined;

      if (placement.kind === 'anchor' || placement.kind === 'anchor-widened') {
        const seamQi = qiRanges[seamSegIdx]!.end;
        const windowQiLo = qiRanges[lastGroup.segIdx[0]!]!.start;
        const openingGroup = nextPack[0]!;
        const windowQiHi = qiRanges[openingGroup.segIdx[openingGroup.segIdx.length - 1]!]!.end;
        let pick = pickSeamAnchor(anchors, seamQi, windowQiLo, windowQiHi);
        let viaWidenedWindow = false;

        // ==== ARM H'S ONE VARIABLE FROM ARM F ================================
        // Tried ONLY when arm F's own immediate two-group window admits
        // nothing — the 42 edges arm F already substitutes are reached by the
        // line above, byte-identically, before this branch is ever entered.
        // Widen by exactly ONE more sentence group on each side — the group
        // immediately before the closing group, and the group immediately
        // after the opening group — and search again. This is STILL the
        // planner's own atoms, not a tolerance: `s2UnbreakableGroups` never
        // splits a group, so "one group wider" is as structural a step as the
        // two-group window itself, just one unit larger.
        //
        // WHY IT STOPS AT ONE GROUP. `s2SegQiRanges`/`qiRanges` is strictly
        // increasing in segment order, so an anchor admitted by the widened
        // window can, by construction, only ever sit BEFORE `windowQiLo` or
        // AFTER `windowQiHi` — never behind this chunk's own `startSec`
        // (`cursor`) in a way `pickSeamAnchor`'s nearest-by-|Δqi| rule would
        // prefer over a nearer, admissible in-window anchor, because a
        // same-or-closer candidate inside the original window would already
        // have been picked above. Going a SECOND group wider would start
        // admitting anchors from groups two seams away from the one being
        // placed — i.e. anchors that legitimately belong to an ADJACENT
        // chunk's OWN seam — which is exactly the failure `pickSeamAnchor`'s
        // own doc comment names ("committing it here would place this
        // chunk's edge at another chunk's boundary"). One group of slack is
        // the largest widening that cannot yet cross a second seam; a further
        // widening is REJECTED for that reason, not attempted and found
        // wanting — the two-group-plus-one-slack bound is where the
        // structural argument stops applying, so arm H does not iterate past
        // it. Any residual `no-admissible-anchor` after this one extra try
        // falls through to arm C's own silence cut exactly as arm F does.
        if (pick === undefined) {
          const closingGroupIdx = groups.indexOf(lastGroup);
          const openingGroupIdx = groups.indexOf(openingGroup);
          const widenedLo = closingGroupIdx > 0
            ? qiRanges[groups[closingGroupIdx - 1]!.segIdx[0]!]!.start
            : windowQiLo;
          const widenedHi = openingGroupIdx >= 0 && openingGroupIdx < groups.length - 1
            ? qiRanges[groups[openingGroupIdx + 1]!.segIdx[groups[openingGroupIdx + 1]!.segIdx.length - 1]!]!.end
            : windowQiHi;
          if (placement.kind === 'anchor-widened' && (widenedLo !== windowQiLo || widenedHi !== windowQiHi)) {
            pick = pickSeamAnchor(anchors, seamQi, widenedLo, widenedHi);
            viaWidenedWindow = pick !== undefined;
          }
        }
        // ======================================================================

        if (pick !== undefined) {
          placed = { cutSec: pick.timeSec, kind: viaWidenedWindow ? 'anchor-widened' : 'anchor' };
          deltaQi = pick.deltaQi;
          anchorQi = pick.qi;
        } else {
          violations.push({
            segIdx: seamSegIdx + 1,
            cause: 'no-admissible-anchor',
            idealSec: idealEnd,
            fallback: `no three-source-agreement anchor lies inside the two sentence groups this seam `
              + `separates (script-word window [${windowQiLo}, ${windowQiHi}), seam at qi ${seamQi})`
              + (placement.kind === 'anchor-widened'
                ? ', nor inside the one-group-wider search arm H also tries'
                : '')
              + '; fell back to arm C\'s own nearest-detected-silence cut, so this edge is NOT substituted '
              + 'and remains an arm-C edge',
          });
        }
      } else if (placement.kind === 'attested') {
        const t = placement.attestedStartBySegIdx.get(openingSegIdx);
        if (t !== undefined) {
          placed = { cutSec: t, kind: 'attested' };
        } else {
          violations.push({
            segIdx: openingSegIdx,
            cause: 'no-attested-time',
            idealSec: idealEnd,
            fallback: `no attested boundary time was supplied for segment ${openingSegIdx}; fell back to arm C's `
              + 'own nearest-detected-silence cut rather than interpolating a ground-truth value that was '
              + 'not given',
          });
        }
      }

      if (placed === undefined) {
        const cut = s2NearestSilenceCut(idealEnd, silences);
        if (cut === undefined) {
          violations.push({
            segIdx: seamSegIdx + 1,
            cause: 'no-usable-silence-nearby',
            idealSec: idealEnd,
            fallback: `no detected silence exists in this corpus's silence array at all; used the estimated `
              + `seam time ${idealEnd.toFixed(3)} directly`,
          });
          placed = { cutSec: idealEnd, kind: 'detected-silence' };
        } else {
          placed = { cutSec: cut.cutSec, kind: 'detected-silence' };
          if (Math.abs(cut.offsetSec) > S2_SILENCE_SEARCH_WINDOW_SEC) {
            violations.push({
              segIdx: seamSegIdx + 1,
              cause: 'no-usable-silence-nearby',
              idealSec: idealEnd,
              fallback: `nearest silence end is ${cut.offsetSec >= 0 ? '+' : ''}${cut.offsetSec.toFixed(3)}s from `
                + `the ideal seam, outside the ${S2_SILENCE_SEARCH_WINDOW_SEC}s search window; accepted anyway `
                + `per invariant 4 (some silence always exists) rather than split mid-sentence`,
            });
          }
        }
      }
      endSec = placed.cutSec;
      cutKind = placed.kind;
      nextCursor = endSec;
      // ====================================================================
    }

    const segIdxThisChunk = [...carried, ...gs.flatMap(g => g.segIdx)];
    const text = segIdxThisChunk.map(idx => segments[idx]!.text ?? '').filter(t => t.length > 0).join(' ');

    if (endSec <= startSec || text.length === 0) {
      if (text.length > 0) {
        violations.push({
          segIdx: segIdxThisChunk[0]!,
          cause: 'excision-collapsed-chunk',
          idealSec: idealEnd,
          seamSec: +endSec.toFixed(3),
          durationSec: +(endSec - startSec).toFixed(3),
          fallback: `window collapsed to [${startSec.toFixed(3)}, ${endSec.toFixed(3)}] because the cursor already `
            + `sat past this chunk's own committed cut; segments ${segIdxThisChunk[0]}-${seamSegIdx} carried `
            + 'forward into the next emitted chunk rather than dropped, and the cursor held rather than moved back',
        });
        if (carriedFrom === undefined) carriedFrom = segIdxThisChunk[0]!;
        carried = segIdxThisChunk;
      }
      cursor = Math.max(cursor, nextCursor);
      continue;
    }
    carried = [];

    const durationSec = endSec - startSec;
    const exceededCap = durationSec > targetMaxSec;
    if (exceededCap) {
      violations.push({
        segIdx: segIdxThisChunk[0]!,
        cause: 'cap-exceeded',
        idealSec: startSec,
        seamSec: +endSec.toFixed(3),
        durationSec: +durationSec.toFixed(3),
        fallback: `emitted chunk spans ${durationSec.toFixed(3)}s, over the ${targetMaxSec}s cap (segments `
          + `${segIdxThisChunk[0]}-${seamSegIdx}); invariant 1 forbids the mid-sentence split that would avoid it`,
      });
    }

    edgeCensus[cutKind] = (edgeCensus[cutKind] ?? 0) + 1;
    inspection.push({
      index: chunks.length,
      startSec: +startSec.toFixed(6),
      endSec: +endSec.toFixed(6),
      durationSec: +durationSec.toFixed(6),
      segFrom: carriedFrom ?? segIdxThisChunk[0]!,
      segTo: seamSegIdx,
      cutKind,
      idealSec: +idealEnd.toFixed(6),
      cutOffsetSec: +(endSec - idealEnd).toFixed(6),
      deltaQi,
      anchorQi,
      exceededCap,
    });
    carriedFrom = undefined;
    chunks.push({ startSec, endSec, text });
    cursor = nextCursor;
  }

  return {
    chunks: languageCode !== undefined && vocabChars !== undefined
      ? applyFaTextNormalization(chunks, languageCode, vocabChars)
      : chunks,
    violations,
    inspection,
    edgeCensus,
  };
}
