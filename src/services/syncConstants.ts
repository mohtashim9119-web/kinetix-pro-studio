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
//
// KNOWN DIVERGENCE (not consolidated here, timeline visual-drift fix,
// 2026-07-31): `MIN_SEGMENT_DURATION` exists as TWO separate, unsynchronized
// local constants — snapBoundaries.ts's copy (0.1s), a real engine floor on
// computed segment duration, and App.tsx/Timeline.tsx's copy (0.3s), a
// display-only floor for resize-drag UX. They are NOT merged into one
// exported constant here because doing so risks changing engine behavior
// (snapBoundaries.ts's floor) as a side effect of a UI-only constant tweak,
// or vice versa — deliberately left as a documented gap, not an oversight.
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
// timeline on `matched === false`, NOT on falling under this ratio. See
// filterToCoveredSegments in App.tsx and its Bug 2 note. So lowering or
// raising this value changes ABORT sensitivity (via the covered-run scan),
// never which segments get skipped BY THIS RATIO — but as of the Bug C fix
// (2026-08-02), `matched` itself is no longer just `matchedCount > 0`; see
// RUN_SURVIVAL_* below. A segment can now fail to be `matched` — and so get
// skipped — for a reason entirely independent of this ratio.
//
// WS5 justification for 0.4 — verified, not assumed:
//   - Clean 294-segment project: 294/294 covered at this value.
//   - Middle-gap project: correctly covers 8 of 10, the 2 genuinely-unspoken
//     scenes falling out as unmatched.
//   - Cross-script mismatch (0% overlap): correctly aborts.
//   - Ordinary English inflection cannot push a segment's RATIO under it. The
//     worst constructed case — a two-word segment with one word inflected
//     ("running fast" vs. spoken "runs fast") — lands at exactly 0.5; a
//     realistic sentence with two inflected words lands at 0.71-0.75. This is
//     why audit finding S3 closed WITHOUT adding a stemming layer; the
//     fixtures proving it are the "WS5/S3" describes in syncTiming.test.ts.
//
//     UPDATED CONTRACT (Bug C, 2026-08-02): clearing this ratio is no longer
//     sufficient for a segment to survive — it must ALSO form a qualifying
//     contiguous run (RUN_SURVIVAL_* below). The two-word inflected case
//     above ("running fast") clears 0.5 on THIS ratio and produces a longest
//     run of exactly 1 (a lone matched anchor can't start-and-end a longer
//     run by itself).
//
//     RECALIBRATED (threshold recalibration, second pass, 2026-08-02): under
//     the ORIGINAL Bug C bands, a run of 1 fell under RUN_SURVIVAL_MIN_RUN_SHORT's
//     floor of 2, so this case SKIPPED despite clearing LOW_CONFIDENCE_RATIO —
//     verified on a real 174-segment project to be miscalibrated (7 short,
//     genuinely-spoken segments rejected on exactly this shape: 1-2 true
//     matches out of 2-3 words, an ASR vocabulary gap, not a mismatch). The
//     bands now give a 1-3-word segment a required run of 1
//     (`requiredRunLength`, whisperService.ts), so a single true match once
//     again SURVIVES for a segment this short — the same trade-off a genuine
//     1-word segment always accepted, just widened to 2-3 words. This is a
//     deliberate, user-approved reopening of a narrow slice of Bug 2's
//     permissiveness (see the RUN_SURVIVAL_* header below for the full
//     accepted-trade-off writeup), not a regression of the S3 finding: a
//     MULTI-word segment (4+) with an inflected word surrounded by other true
//     matches (the "realistic sentence" case) still forms a real run through
//     its other matched words and survives fine regardless of this change —
//     only the 1-3-word band's required-run value moved.
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
// entries (appendSyncLogEntries, services/syncLog.ts, keeps the tail).
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

// --- Token-gap epsilon (token-gap silence discrimination, 2026-08-01) -------
// The tolerance above is a TIMESTAMP heuristic — it corrects Whisper's
// timestamp error using Whisper's own timestamps, so inside its 0.30s band it
// genuinely cannot tell a mid-sentence breath from a boundary pause that a
// stretched token smeared over. snapBoundaries.ts's `fillsTokenGapWithinSpan`
// supplies a second, INDEPENDENT evidence source: the Hirschberg text
// alignment, which decides word ownership without consulting a timestamp at
// all. A silence that fits between two consecutive tokens of ONE segment's
// matched span is that segment's own breath — rejected as a boundary
// candidate however shallow its intrusion.
//
// This epsilon absorbs quantization on that fit test, nothing more. It is
// tied to silenceDetector.ts's frameSizeMs (20ms): silence edges are computed
// per analysis frame, so a reported edge is only known to ±1 frame. Whisper's
// own token times are quantized more finely, so 20ms dominates.
//
// It is deliberately NOT a tolerance. Every fixture in syncTiming.test.ts
// fires this rule at EXACT equality between a token edge and a silence edge —
// ε = 0 would pass all of them — and the nearest non-firing fixture misses by
// 0.5s+. Widening this constant does not buy sensitivity; it only risks the
// one structural guarantee below.
//
// THE GUARANTEE: ε must stay far below silenceDetector.ts's minDurationSec
// (0.25s). Whisper sometimes emits overlapping tokens (endSec > the next
// token's startSec). For such a negative gap the fit test can only succeed on
// a silence shorter than 2ε, so at 0.02s no real detected silence — floored at
// 0.25s, a 12x margin — can ever misfire on overlapping tokens. Raising ε past
// ~0.12s would erode that margin and make the rule reachable by duplicate-token
// noise.
export const TOKEN_GAP_EPSILON_SEC = 0.02;

// --- Coverage-composite breath discrimination (2026-08-01, iteration 3) -----
// TOKEN_GAP_EPSILON_SEC above (iteration 1, containment) is a faithful,
// still-correct predicate for the ONE shape it targets — but real Whisper
// output routinely produces a shape it structurally cannot see: a breath
// filled with several MICRO-tokens, or flanked by tokens stretched across its
// edges, so no clean two-token gap exists for it to fit. isBreathSilence
// below (snapBoundaries.ts) is the second, independent evidence source that
// covers that gap.
//
// The first formulation tried was a bare coverage ratio (covered speech time
// inside the silence, divided by the silence's own duration) with no other
// signal. It is provably insufficient on its own: this file's "stretched
// word" fixture (a silence sitting entirely inside one long token) computes
// to ratio 1.0 and MUST accept; the real pair-4 breath (the same silence
// width, now spanning three touching micro-tokens) also computes to ratio
// 1.0 and MUST reject. No single ratio cutoff can separate two fixtures that
// land on the exact same ratio.
//
// The discriminator that does separate them is WHICH tokens the silence
// touches, not how much of them it touches: a breath sits between two or
// more of a segment's own words, so it always straddles at least one
// INTERIOR token of the matched span — a token with real matched speech on
// BOTH sides of it, inside the same span. A stretched-word silence lies
// inside a single token with nothing else of the span touching it, so it can
// never manufacture an interior token. And a short, two-token span (a
// two-word segment's own full text — the shape of this file's "does NOT
// clamp" fixture) has NO interior token at all: its first and last token
// are the same two tokens, so it cannot manufacture the "multiple sandwiched
// fragments" signal a breath requires, no matter how much of the silence
// those two edge tokens individually cover.
//
// This interior-only restriction is itself a correction, not the first
// draft: counting every span token (edges included) against
// BREATH_TOKEN_OVERLAP_FLOOR_SEC below gives the "does NOT clamp" fixture's
// two-token span a significant-count of 2 — both of ITS tokens clear the
// floor by a wide margin (0.3-0.5s each, against a 0.09s floor) — which trips
// the multi-fragment override and incorrectly rejects a boundary this suite
// has pinned as ACCEPTED since before this feature existed. Because that
// fixture's overlaps are already larger than pair-4's, no floor value could
// exclude one without excluding the other; only restricting the count to
// INTERIOR tokens closes the gap, and it does so structurally — a two-token
// span can never have an interior token, so it is immune to the override by
// construction, independent of the floor's exact value.
//
// BREATH_MAX_SPEECH_COVERAGE_RATIO is the other, independent branch: a
// silence whose span-token coverage sits at or under this ratio is
// predominantly true silence, not speech with a pause carved out of it — a
// breath, regardless of the interior-token signal. This is what closes the
// merged-interval case `fillsTokenGapWithinSpan` deliberately leaves open
// (see that predicate's own doc comment): that fixture's silence computes to
// a 0.293 coverage ratio, just under this 0.3 threshold, so isBreathSilence
// rejects it on this branch alone — even though the silence still fails
// fillsTokenGapWithinSpan's own containment test (it still runs past the
// span's last token). That limitation of that ONE function is unchanged and
// still directly unit-tested; what changes is that the composed Pass 1
// filter no longer depends on it alone to catch this shape.
export const BREATH_MAX_SPEECH_COVERAGE_RATIO = 0.3;
// A token counts toward the interior multi-fragment override only once its
// overlap with the silence reaches this floor. Calibrated to admit pair-4's
// own confirmed production interior overlaps (0.09s and 0.14s) — the smaller
// landing EXACTLY on the floor, deliberately, not approximately (see
// isBreathSilence's own doc comment) — while excluding a plausible sub-floor
// artifact overlap (0.05s, exercised directly by isBreathSilence's "sigCount
// floor edge" unit test): a 0.04s margin, stated honestly rather than
// padded, on the one side of this floor an actual fixture exercises. The
// interior-only restriction above is what does the real work of protecting
// short spans regardless of this value — this floor's job is narrower: only
// separating a genuine interior speech fragment from a sub-floor artifact
// WITHIN a span that already has interior tokens to weigh.
export const BREATH_TOKEN_OVERLAP_FLOOR_SEC = 0.09;

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

// --- Consecutive-run survival requirement (Bug C permanent fix, 2026-08-02) -
// Root cause: pre-fix, `matched` was `matchedCount > 0` — ANY single true
// word match, however isolated, kept a segment on the timeline (the Bug 2
// "any real match keeps it" doctrine). That is too permissive: a 9-word
// heading whose words are scattered as coincidental single-word matches
// across an unrelated document (no two of them adjacent in either the query
// or the transcript) passed `matched` even though nothing about its actual
// CONTENT was spoken together — confirmed in production as a heading
// surviving sync on isolated single-word coincidences. The fix requires a
// segment's matched words to form at least one CONTIGUOUS run — consecutive
// query positions whose transcript-side token indices are themselves
// consecutive — of a length scaled to the segment's own word count, not just
// a bare non-zero count. This supersedes Bug 2's doctrine; see
// whisperService.ts's `hasQualifyingRun`/`computeLongestRunWithHoles` and
// their call site in `extractSegmentAlignments`.
//
// A run may tolerate up to RUN_SURVIVAL_MAX_HOLE consecutive unmatched query
// words in its interior (the narrator may have paraphrased a word or two)
// PROVIDED the transcript-side token indices stay contiguous across the gap
// — i.e. the words immediately before and after the hole are themselves
// adjacent in the audio, so the hole is genuinely a paraphrase/deletion
// inside one continuous utterance, not two unrelated coincidental matches
// bridged by an accounting trick. A run can never start or end on a hole.
export const RUN_SURVIVAL_MAX_HOLE = 2;

// ---------------------------------------------------------------------------
// Threshold recalibration (second pass, 2026-08-02) — the ratio-scaled bands
// above (RUN_SURVIVAL_RATIO_SHORT/RUN_SURVIVAL_RATIO_LONG, RATIO_SHORT=0.5,
// RATIO_LONG=0.4, RUN_SURVIVAL_LONG_BAND_MIN_WORDS=11 — all now REMOVED, do
// not reintroduce) were the FIRST calibration of this fix, chosen from
// synthetic fixtures alone (the 9-word heading repro, the WS5/S3 inflected-
// word cases). Verified against a REAL 174-segment production project, they
// were a calibration failure, not a mechanism failure: 15 of 16 segments the
// run requirement skipped were genuinely spoken, not false positives —
//   - 7 short segments (2-6 scene-doc words) where Whisper mis-transcribed an
//     uncommon word ("las-charge", "rockcrete", "Necron", ...) down to only
//     1-2 true matches out of the segment's small word count — a vocabulary
//     gap in the ASR, not evidence the segment wasn't spoken.
//   - 8 segments with 60-81% of their words genuinely matched, where the SAME
//     kind of vocabulary miss fragmented what would otherwise be one long run
//     into several shorter ones (worst case: 21 words, 17 matched, longest
//     surviving run only 7 — against the OLD ratio-scaled requirement of 9,
//     ceil(0.4*21)). The ratio's own growth with segment length was the
//     problem here: a long, mostly-intact segment needs proportionally MORE
//     contiguous words than a short one under the old formula, exactly
//     backwards from how ASR errors actually distribute (a handful of missed
//     words matter less, not more, the longer the surrounding true content is).
// Only the ONE genuine false positive (a heading whose content never occurs
// in the audio at all, 0 of 9 words matched) is untouched by anything below —
// a segment with matchedCount 0 fails RUN_SURVIVAL_DENSITY_MIN_CONFIDENCE
// outright (confidence 0), so no threshold change here can ever resurrect it.
//
// Two changes, both replacing the OLD length-scaling ratios with flat,
// length-independent minimums:
//   1. A new tiny band, 1-3 words, requires a run of only 1 — folding what
//      used to be `hasQualifyingRun`'s separate `totalWords === 1` special
//      case into the same band formula (a single true match trivially
//      qualifies a segment this short; see `requiredRunLength`,
//      whisperService.ts) rather than special-casing exactly one word count.
//      RUN_SURVIVAL_LONG_BAND_MIN_WORDS's old 11-word split point is gone as
//      an exported constant — the split is now inline in
//      `requiredRunLength`'s own band check.
//   2. A density-based fallback (RUN_SURVIVAL_DENSITY_MIN_CONFIDENCE/
//      RUN_SURVIVAL_DENSITY_MAX_MEDIAN_GAP below, whisperService.ts's
//      `isLocallyClustered`) catches the fragmented-but-mostly-matched shape
//      a flat run minimum alone still misses: a segment whose true matches
//      never form ONE run long enough, but are collectively substantial
//      (most of the segment's words matched) AND tightly grouped (not
//      smeared end-to-end across the transcript), is accepted as genuinely
//      spoken even without a single qualifying run.
//
// Accepted trade-off (tiny band): a 2- or 3-word segment can now survive on
// a SINGLE matched word — the same permissiveness Bug 2's "any real match
// keeps it" doctrine had, narrowed to segments so short that "a run" and "a
// single match" are nearly the same concept (a 2-word segment's only
// possible non-trivial run IS both words matching). The theoretical phantom
// case — a short segment whose sole matched word is a coincidental
// common-word collision with unrelated audio — is real but bounded to at
// most 3 words, stays fully visible in the sync log's per-segment
// confidence/longestRun fields, and the user reviewed and accepted this
// specific trade-off in exchange for eliminating the 7 false-positive
// short-segment skips above.
export const RUN_SURVIVAL_MIN_RUN_SHORT = 2;  // totalWords 4-10
export const RUN_SURVIVAL_MIN_RUN_LONG = 4;   // totalWords >= 11

// Density fallback: a segment whose matches don't form one qualifying
// contiguous run (above) can still survive when the matches are BOTH:
//   (a) collectively substantial — at least this fraction of the segment's
//       words matched overall. 0.5 mirrors LOW_CONFIDENCE_RATIO's own order
//       of magnitude ("about half the segment") rather than introducing an
//       unrelated third calibration point; and
//   (b) tightly grouped rather than scattered end-to-end across the
//       transcript — the median gap, in transcript-token positions, between
//       consecutive matched words stays at or under
//       RUN_SURVIVAL_DENSITY_MAX_MEDIAN_GAP (whisperService.ts's
//       `isLocallyClustered`).
// Verified against the production project's worst fragmented case (21 words,
// 17 matched in clusters, longest run 7) and confirmed NOT to reopen the
// heading false positive: the heading's scattered coincidental matches have
// confidence well under 0.5 in the real production case (0 of 9 — the
// content never occurs at all) — signal (a) alone rejects it before
// clustering is ever evaluated. The FLAGSHIP synthetic fixture in
// syncTiming.test.ts (2 of 9 matched, confidence 2/9) is rejected the same
// way; a dedicated fixture with confidence artificially raised ABOVE 0.5 but
// still scattered (huge median gap) is also pinned, to verify clustering —
// not just confidence — is doing real work here, not just duplicating
// LOW_CONFIDENCE_RATIO under a new name.
export const RUN_SURVIVAL_DENSITY_MIN_CONFIDENCE = 0.5;
export const RUN_SURVIVAL_DENSITY_MAX_MEDIAN_GAP = 4;

// --- Drop-clustering validator (Pipeline Contract Program, Pair 1, Risk
// Register R1 — docs/sync-pipeline-contract-plan.md §5; UNRELATED to this
// file's own "architecture doc §3.2, R1" hyphen carve-out referenced below,
// a different numbering scheme from the earlier sync rewrite) -------------
// Risk R1: a production run dropped 169/1973 (~8.6%) malformed tokens
// (whisperService.ts's filterMalformedTokens) and the count was logged, but
// its DISTRIBUTION was not — 169 drops spread evenly across a long transcript
// is noise; 169 drops inside one 20-second stretch is a corrupted region that
// will misplace a boundary and produce an unexplained skip nearby. Nothing
// distinguished the two before this validator (syncContracts.ts's
// analyzeDropDistribution).
//
// These three are the task's own stated starting values, not yet calibrated
// against a real project's drop distribution the way RUN_SURVIVAL_* above
// was — stated honestly rather than dressed up as measured. Re-tune only with
// fixture/production evidence that the rule false-fires or misses a real
// corrupted stretch (see this file's own WS5 preamble on how the OTHER
// thresholds here were locked, as the model to follow).
export const DROP_CLUSTERING_WINDOW_SEC = 10;
// A window's share of all drops strictly above this ratio is a violation.
export const DROP_CLUSTERING_RATIO_THRESHOLD = 0.4;
// Below this many total drops, a single window can cross the ratio threshold
// on pure small-sample noise (e.g. 2 of 3 drops sharing a window is 67% but
// tells you nothing) — the check is skipped entirely below this floor.
export const DROP_CLUSTERING_MIN_DROPS = 5;

// --- Boundary-quality checker (waveform-watcher program, Phase 1,
// Contract 5→6, rule 'loud-fallback-boundary') — calibrated 2026-08-02 -----
// `validateBoundaryQuality` (syncContracts.ts) flags a fallback boundary
// (one `snapCoveredBoundaries` placed at the plain spoken-edge midpoint
// because no silence was assignable in its search window) whose actual
// waveform amplitude at the committed boundary time is more than
// `BOUNDARY_QUALITY_LOUDNESS_RATIO_K` times louder than the quietest
// `BOUNDARY_QUALITY_SUSTAINED_WINDOW_SEC`-wide span anywhere in that same
// search window — i.e. a real, quieter gap existed nearby and the fallback
// landed in the middle of ongoing speech instead.
//
// Dual gate, calibrated 2026-08-02 against 447-seg long-pause project (29
// true positives incl. all 5 diagnostic-proven boundaries) and 174-seg older
// project (0 false positives). A violation requires ALL THREE: the
// boundary's own amplitude clears `BOUNDARY_QUALITY_ABSOLUTE_AMPLITUDE_FLOOR`
// (below this floor the "loud" boundary is itself near-silent — a ratio
// computed off near-zero noise floor amplitudes is meaningless and fires on
// pure sample noise), the quietest point sits at least
// `BOUNDARY_QUALITY_MIN_DISTANCE_SEC` away (a quiet point immediately
// adjacent to the boundary is the same mid-sentence dip, not a real
// alternative placement — this is what discriminates a genuine missed
// silence from a mid-word amplitude wobble, per the user's listening-check
// false-positive class), and the loudness ratio clears
// `BOUNDARY_QUALITY_LOUDNESS_RATIO_K`.
export const BOUNDARY_QUALITY_LOUDNESS_RATIO_K = 2;
export const BOUNDARY_QUALITY_SUSTAINED_WINDOW_SEC = 0.15;
// Below this amplitude the boundary itself is already near-silent — no
// violation regardless of ratio. Calibrated 2026-08-02 (see file header).
export const BOUNDARY_QUALITY_ABSOLUTE_AMPLITUDE_FLOOR = 0.05;
// The quietest region found must sit at least this far from the boundary to
// count as a genuinely different placement, not the same dip. Calibrated
// 2026-08-02 (see file header).
export const BOUNDARY_QUALITY_MIN_DISTANCE_SEC = 0.10;
export const BOUNDARY_QUALITY_K_SWEEP = [1.5, 2, 3] as const;
export const BOUNDARY_QUALITY_WINDOW_SWEEP = [0.10, 0.15, 0.20, 0.25] as const;

// --- Word-coverage validator (Stage-4 output validation, Contract 3→4, rule
// 'low-word-coverage', 2026-08-03) ------------------------------------------
// Production evidence: segment 28 ("Small and permanent.") matched only 1 of
// its 3 scene-doc words — `hasQualifyingRun`'s tiny-band rule
// (`requiredRunLength`, whisperService.ts) gives a 1-3-word segment a
// required run of just 1, so it survives `matched: true` and its remaining
// 2 words are silently absorbed into the NEXT segment's span. Nothing in the
// pipeline previously checked word coverage as its own signal — the boundary
// checker above audits waveform loudness, not text completeness, and the
// run-survival gate is a SURVIVAL decision (stay on the timeline vs. get
// skipped), not a completeness measurement of a segment that DID survive.
// This validator is that missing signal: read-only, Stage-4 (post-alignment)
// output validation, same Phase-1-checker philosophy as
// `validateBoundaryQuality` above (pure, zero behavior change, additive log
// entries only).
//
// A segment is flagged when it matches FEWER than this fraction of its own
// words. 0.6 is a starting value, not yet calibrated against a real project's
// distribution the way LOW_CONFIDENCE_RATIO/RUN_SURVIVAL_* were (see this
// file's own WS5 preamble for that calibration bar) — re-tune only with
// fixture/production evidence that this rule false-fires or misses a real
// case, per the same DROP_CLUSTERING_* honesty note above.
export const WORD_COVERAGE_MIN_RATIO = 0.6;
// Below this many missing words, a borderline ratio miss is noise, not
// signal: a 1-of-2 segment (50%, under the ratio) is missing only ONE word —
// the same single-word gap a 2-3 word segment's run-survival tiny band
// (`requiredRunLength`) already treats as an accepted trade-off, not a defect
// to re-flag one layer up. Requiring the ratio failure AND at least this many
// actually-missing words stops that one class of borderline case from crying
// wolf on every short segment with a single inflected/mistranscribed word,
// while still catching the s28 shape (1 of 3 — 2 missing words, well past
// this floor).
export const WORD_COVERAGE_MIN_MISSING = 2;

// --- Forced-alignment anchor computation (`faAnchors.ts`) — R.1/R.4/R.7,
// `sync-pipeline-v2-plan.md`, R-O/R-P rulings (`docs/history.md`, 2026-08-12)
// --------------------------------------------------------------------------
// A time `t` is an anchor for script word `w` only when three independent
// sources agree within this tolerance: the Hirschberg alignment maps `w` to a
// specific Whisper token, that token's declared onset, and a detected silence
// interval ending immediately before it. 0.15s, R.1's own stated value.
export const ANCHOR_AGREEMENT_SEC = 0.15;

// R-O (i): `w` must be at least this many characters after `canonicalize()`
// to be admissible as an anchor. Seeded from C10's own "≥3 chars" half of its
// (lexical, C10-only) distinctiveness definition — the only length threshold
// this project has any evidence for. Not reused for any lexical/stopword
// purpose; R.1(a) admissibility is phonetic, per R-O.
export const MIN_ANCHOR_WORD_CHARS = 3;

// R-O (ii): a word whose first canonicalized character is in this set is
// inadmissible as an anchor, regardless of length. Seeded from the
// word-initial glides Step B actually measured failing worst in the corpus
// ("You"/"Your"/"When"/"We" — 14.1% >250ms, p95 368.8ms, vs. a clean 0.0% for
// plosive/affricate-initial boundaries). English-measured, applied to all 5
// supported languages deliberately: conservative (can only reject a real
// anchor, never admit a bad one) — widening or narrowing per language needs
// measurement, not intuition.
export const GLIDE_INITIAL_CHARS: ReadonlySet<string> = new Set(['w', 'y']);

// R.1(b): `w`'s Hirschberg match must sit inside a contiguous matched run of
// at least this many words. Reuses RUN_SURVIVAL_MIN_RUN_LONG (above) rather
// than minting a second, independently-tuned constant — the plan's own
// instruction, confirmed by the R-O/R-P ruling pass. Callers should import
// RUN_SURVIVAL_MIN_RUN_LONG directly for this purpose; no MIN_ANCHOR_RUN
// alias is exported.

// R.4: the maximum span, in seconds, a run may grow to before R-P's
// force-split selection applies. wav2vec2-class encoders are O(n^2) in
// attention; 30s is the standard chunk length for this model family.
export const MAX_RUN_SEC = 30;

// R.7: FA per-word confidence below this floor, on a run's first or last
// word, means that word is not used as a boundary — the same line Blocker 2's
// own analysis used to separate "FA was confident and wrong" from "FA
// correctly refused." Defined here per the plan's own value; consumed by a
// later (post-FA) phase, not by faAnchors.ts's own pre-FA computation — see
// that module's header comment for the scope boundary.
export const CONF_MIN = 0.3;

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
