/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// ---------------------------------------------------------------------------
// Sync-system tuning constants — the single exported home for every constant
// the sync pipeline tunes (architecture doc §3 preamble, R8 point 5). No sync
// constant is defined inline at its use site.
//
// The WS5 threshold-tuning pass (doc §3.3(c), §6.3) will finalize the coverage
// thresholds against the four named fixtures; the values here are the LOCKED
// STARTING values for the WS1 foundation. Only the aligner-scoring and
// normalizer constants are consumed today (WS1a) — the coverage/partial-
// coverage/snap constants are declared here now so later workstreams add no
// new constant modules, matching the doc's "one exported module" rule.
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
// its match fraction clears this ratio. Relocated here verbatim from its former
// inline definition in whisperService.ts; its VALUE is unchanged in WS1a (WS5
// R8 tunes it). Consumed starting WS1b: whisperService.ts's classifyCoverage/
// computeCoverageSummary derive "covered" from this ratio, feeding the two-
// signal gate below.
export const LOW_CONFIDENCE_RATIO = 0.4;

// --- Two-signal abort gate (doc §3.3, §3.4, R13) — consumed WS1b ------------
// Primary signal: the longest contiguous run of covered segments must reach
// this length, else the inputs don't correspond (the B1 mismatch case).
export const MIN_COVERED_RUN_LENGTH = 2;
// Secondary anti-noise signal: bidirectional coverage below this floor aborts
// even when a technically-contiguous run exists (matched-on-noise).
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
