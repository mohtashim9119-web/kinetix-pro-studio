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
// R8 tunes it). Not yet consumed as a gate in WS1a — the aligner emits the raw
// per-segment confidence and matched flag; WS1b wires the two-signal gate.
export const LOW_CONFIDENCE_RATIO = 0.4;

// --- Two-signal abort gate (doc §3.3, §3.4, R13) — declared for WS1b --------
// Primary signal: the longest contiguous run of covered segments must reach
// this length, else the inputs don't correspond (the B1 mismatch case).
export const MIN_COVERED_RUN_LENGTH = 2;
// Secondary anti-noise signal: bidirectional coverage below this floor aborts
// even when a technically-contiguous run exists (matched-on-noise).
export const NOISE_FLOOR_COVERAGE = 0.1;

// --- Partial-coverage sync (doc §3.5, R3, R12) — declared for WS2 -----------
export const MAX_INTERPOLABLE_GAP = 1;
export const SNAP_TOLERANCE_SEC = 0.15;
export const FALLBACK_RATE_MIN_CHARS = 100;
export const FALLBACK_RATE_MIN_SECONDS = 30;
export const DEFAULT_CHARS_PER_SEC = 15;

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
