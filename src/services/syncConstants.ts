/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// ---------------------------------------------------------------------------
// Sync-system tuning constants — the single exported home for every constant
// the sync pipeline tunes (architecture doc §3 preamble, R8 point 5). No sync
// constant is defined inline at its use site.
//
// WS5 (2026-07-29) ran the threshold pass (doc §3.3(c), §6.3) and LOCKED every
// coverage threshold at its existing value — no constant below was re-tuned.
// The values earned that by evidence, not by default: see the per-constant
// justifications, and the boundary tests in syncTiming.test.ts ("WS5 —
// LOW_CONFIDENCE_RATIO boundary is inclusive", "WS5 — R13 gate Signal 1/2
// boundary") that now pin each comparison's exact semantics. Re-tune only with
// fixture evidence that a real project is misclassified, and update those tests
// in the same change — they are deliberately constructed to sit ON the
// boundaries, so any move makes them fail loudly.
// ---------------------------------------------------------------------------

// --- Hirschberg diff-aligner scoring (doc §3.1(c), WS1a) --------------------
// Needleman-Wunsch scoring recurrence: a token match scores +1, a mismatch
// (substitution) −1, and either kind of gap (a transcript word with no
// scene-doc counterpart = insertion, or a scene-doc word with no transcript
// counterpart = deletion) −1. Starting values; the R8 fixture pass (WS5) is
// the only place these are re-tuned.
export const ALIGN_MATCH_SCORE = 1;
export const ALIGN_MISMATCH_SCORE = -1;
export const ALIGN_GAP_SCORE = -1;

// --- Per-segment coverage threshold (doc §3.1.1, §3.3(c)) -------------------
// A segment is "covered" when it has at least one matched transcript word AND
// its match fraction clears this ratio (`>=`, inclusive — locked by test).
// Consumed by whisperService.ts's classifyCoverage/computeCoverageSummary,
// which feed the two-signal gate below.
//
// IMPORTANT — what this does NOT control: a segment is dropped from the
// timeline on `matched === false` (no transcript word matched at all), NOT on
// falling under this ratio. See filterToCoveredSegments in App.tsx and its Bug 2
// note. So lowering or raising this value changes ABORT sensitivity (via the
// covered-run scan), never which segments get skipped.
//
// WS5 justification for 0.4 — verified, not assumed:
//   - Clean 294-segment project: 294/294 covered at this value.
//   - Middle-gap project: correctly covers 8 of 10, the 2 genuinely-unspoken
//     scenes falling out as unmatched.
//   - Cross-script mismatch (0% overlap): correctly aborts.
//   - Ordinary English inflection cannot push a segment under it. The worst
//     constructed case — a two-word segment with one word inflected
//     ("running fast" vs. spoken "runs fast") — lands at exactly 0.5; a
//     realistic sentence with two inflected words lands at 0.71-0.75. This is
//     why audit finding S3 closed WITHOUT adding a stemming layer; the
//     fixtures proving it are the "WS5/S3" describes in syncTiming.test.ts.
export const LOW_CONFIDENCE_RATIO = 0.4;

// --- Two-signal abort gate (doc §3.3, §3.4, R13) — consumed WS1b ------------
//
// NOTE ON NAMING: there is no single "R13 abort threshold" scalar, and never
// has been. R13 is these TWO signals, evaluated by evaluateCoverageGate in
// App.tsx; a full-mismatch abort fires when EITHER trips. Anything describing
// the abort as one 0.4-valued threshold is confusing it with
// LOW_CONFIDENCE_RATIO above, which is a per-segment classification ratio.
//
// Primary signal: the longest contiguous run of covered segments must reach
// this length, else the inputs don't correspond (the B1 mismatch case).
// Justification for 2: one isolated covered segment is exactly what coincidental
// word overlap produces between two unrelated scripts, whereas two ADJACENT
// covered segments require the overlap to also be in the right order — a far
// stronger signal. Comparison is `< MIN_COVERED_RUN_LENGTH` ⇒ abort, so a run of
// exactly 2 passes (locked by test).
export const MIN_COVERED_RUN_LENGTH = 2;
// Secondary anti-noise signal: bidirectional coverage below this floor aborts
// even when a technically-contiguous run exists (matched-on-noise).
// Justification for 0.1: bidirectional coverage is min(sceneDocCoverage,
// transcriptCoverage), so it only collapses when one SIDE is almost entirely
// unaccounted for — the real failure mode being a short genuine run buried in a
// document (or an audio file) that is otherwise about something else. It is set
// deliberately low because Signal 1 is the primary gate; this one only has to
// catch what a contiguous-run check structurally cannot. Comparison is
// `< NOISE_FLOOR_COVERAGE` ⇒ abort, so exactly 0.1 passes (locked by test).
export const NOISE_FLOOR_COVERAGE = 0.1;

// --- Deleted by the Round 4 skip-unmatched ruling (doc §10) ------------------
// MAX_INTERPOLABLE_GAP (R12) is gone with the middle-gap abort: an uncovered
// segment is SKIPPED from the timeline regardless of how many of them are
// adjacent (R4-1), so there is no gap length to compare against.
// FALLBACK_RATE_MIN_CHARS / FALLBACK_RATE_MIN_SECONDS / DEFAULT_CHARS_PER_SEC
// (R3's three-tier char-rate) are gone with character-based fallback timing
// itself (R4-2): a segment is either audio-covered or absent, so no segment
// ever needs a rate-derived duration. Do not reintroduce any of the four —
// see the doc's §3.5 for why fallback timing is not coming back.

// --- Persistent sync-log caps (WS-logs, R4-4) -------------------------------
// The log lives ON the Project (types.ts's SyncLogEntry/SyncRunSummary) and is
// persisted by the existing localStorage serializer, so it shares that store's
// quota with the rest of the project. These caps keep an old, heavily re-synced
// project from growing the blob without bound; pruning always drops the OLDEST
// entries (appendSyncLogEntries in App.tsx keeps the tail).
export const MAX_LOG_ENTRIES = 500;
export const MAX_SYNC_RUN_SUMMARIES = 10;

// --- Per-segment temporal bounding (token-stealing fix, WS6, 2026-07-29) ----
// Root cause: pure global Hirschberg alignment has no temporal awareness — a
// segment whose narration overflows its expected slot can consume the NEXT
// segment's transcript words as substitution candidates, starving it of
// matches (verified via temporary production instrumentation, scene 152/153 repro).
// The fix bounds each segment's alignment search to a time window around its
// own expected slot (extractSegmentAlignments in whisperService.ts) instead
// of letting every segment compete for the entire transcript.
//
// Window = [expectedStart - tolerance, expectedEnd + tolerance], where
// expectedStart/expectedEnd are the segment's own anchor and the next
// segment's anchor (or audio end for the last segment).
export const TEMPORAL_TOLERANCE_RATIO = 0.1;
export const TEMPORAL_TOLERANCE_MIN_SEC = 1.5;
export const TEMPORAL_TOLERANCE_MAX_SEC = 5.0;
// Monotonic carry-forward gap (spec default, kept for interface completeness
// — NOT used by the current rescue implementation). The original design used
// this to push a segment's window past the previous segment's own committed
// t1 (`prevAnchor + this gap`). That was tried and REJECTED: in exactly the
// overflow scenario the rescue targets, the previous (overflowing) segment's
// own true trailing match can itself land AFTER the tokens the rescue needs
// to recover (that IS the bug — see whisperService.ts's `extractSegmentAlignments`
// doc comment) — a t1-based floor would re-exclude the very words it exists
// to rescue. The rescue instead gets the same "never double-claim a token"
// guarantee, at the exact token level rather than a coarser time cutoff, from
// `globallyClaimed` (every transcript word ANY segment truly matched in the
// unchanged global pass) — see whisperService.ts. Left here in case a future
// revision wants a hybrid floor; not wired in today.
export const MONOTONIC_CARRY_FORWARD_GAP_SEC = 0.1;
// Temporal-proximity scoring bonus: within a segment's window, a token whose
// timestamp falls in the CENTRAL 50% gets an additive bonus (max at dead
// center, linear decay to 0 at the 50% mark), added ONLY to a true textual
// match — it can never turn a wrong word into a match, only rank competing
// correct-word matches (breaks ties toward the temporally-correct one).
export const TEMPORAL_BONUS_MAX = 0.3;
export const TEMPORAL_BONUS_CENTRAL_FRACTION = 0.5;

// --- Malformed-token filter (WS4 Feature 4, decision 14a) -------------------
// A whisper token whose end lands past the end of the audio is malformed — but
// "past the end" needs slack: the container's reported duration and the decoded
// sample count routinely disagree by a frame or two of codec padding (AAC/MP3
// encoder delay), and whisper's own word-boundary timestamps carry ~300ms of
// error besides. This tolerance is what keeps a legitimate final word from
// being discarded for ending a few milliseconds "after" the file does.
export const MALFORMED_TOKEN_DURATION_TOLERANCE_SEC = 0.5;

// --- Sub-word concatenation rescue (Pass 3, token-stealing fix follow-up,
// 2026-07-29) ---------------------------------------------------------------
// Whisper occasionally splits a single word across multiple sub-word tokens
// on a phoneme boundary ("linen" -> "lin"+"en", "flax" -> "fl"+"ax"). Pass
// 2's single-token exact match can never find these — no individual token
// equals the full word — so Pass 3 tries concatenating up to
// MAX_CONCAT_TOKENS consecutive, still-unclaimed tokens whose timestamps
// touch within MAX_CONCAT_GAP_SEC of each other. D1/D2, verified via the
// scene 153 repro ("linen"/"flax" both split into exactly 2 fragments).
export const MAX_CONCAT_TOKENS = 3;
export const MAX_CONCAT_GAP_SEC = 0.3;

// ---------------------------------------------------------------------------
// NUMBER_WORDS — the R1 hyphen carve-out set (doc §3.2, R1).
//
// A hyphenated token is split on its hyphens IFF every sub-part is a number
// word (this set) OR a digit run (/^[0-9]+$/); otherwise the hyphen is
// preserved and the token stays one unit. Compound forms like "thirty-seven"
// resolve BY CONSTRUCTION — the split produces ["thirty","seven"], each of
// which is itself in this set — so the set need only hold the atomic number
// words, not every compound. Consequences: `thirty-seven` → ['thirty','seven']
// (≡ '37'); `co-operate` → ['co-operate']; `3-4` → ['three','four'];
// `twenty-first` stays whole ('first' is an ordinal, not a number word).
// ---------------------------------------------------------------------------
const NUMBER_ONES = [
  'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine',
  'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen',
  'seventeen', 'eighteen', 'nineteen',
];
const NUMBER_TENS = ['twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];
const NUMBER_SCALES = ['hundred', 'thousand', 'million', 'billion'];

export const NUMBER_WORDS: ReadonlySet<string> = new Set<string>([
  'zero',
  ...NUMBER_ONES,
  ...NUMBER_TENS,
  ...NUMBER_SCALES,
]);
