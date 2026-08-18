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
    chunks = exciseUnscriptedRuns(attributeByIndex(ranges, ctx.rawTokens, textQi), ctx.unscripted, textQi);
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
