# Sync Pipeline Contract Plan — Working Document

> **Status:** Working plan. Nothing here has been implemented yet — no code changed to produce this
> document. It is a map of the sync pipeline as it exists at `clean-baseline-2026-07-31`, the six
> handoffs between its stages (plus one input annex, contract 0→2), and the program for hardening
> each one.
>
> **Verified-against-HEAD: `30a32cd`** (Pair 1, Contract 1→2, shipped; boundary-quality checker,
> Contract 5→6, shipped out-of-order — see that section's 2026-08-02 addendum; a Contract 3→4
> `low-word-coverage` checker also shipped out-of-order, 2026-08-03, UNVERIFIED — see
> `docs/history.md` and `project-state.md`). Every `file:line` citation in this document was read at
> a commit no later than this one. **Re-stamp this field at every pair completion.** Governance rule:
> any change that touches a pipeline stage (any file named in a §1.3 table) must re-verify the
> affected §2 assumption rows and re-stamp this field before merging — a stale citation in this
> document is treated as a doc bug, same as a stale `CLAUDE.md` entry. This governance rule itself
> moves into `CLAUDE.md` when Pair 1 closes.
>
> **PROGRAM PAUSED (2026-08-03).** Pair 1's own R2/floor-clamp analysis below is superseded by the
> boundary-drift investigation (`docs/boundary-drift-investigation.md`) — the investigation found and
> fixed a real defect (`isBreathSilence`'s multi-fragment override, index-based seam exemption,
> commit `c593f1d`) that this program's own Pair 1 analysis had not surfaced, and also surfaced a
> second, still-open defect (word-shift) that takes priority over resuming this program. The program
> stays paused pending a fix for the word-shift defect — see `project-state.md`'s Active Tasks.
> **`docs/sync-pipeline-v2-plan.md` (accepted 2026-08-03) supersedes this program's sequencing** —
> its Phase 7 absorbs this document's contract/validator concepts. This document remains the
> authority on the §2 assumption tables and the risk register (R1-R14) — v2 does not restate them.
> v2's Revision 2 (2026-08-03) additionally writes NEW stage contracts for the 4-stage architecture
> (its Part J), maps R1-R14 onto them (structurally-impossible vs. surviving), and absorbs this
> document's §4 severity taxonomy into its Contract OUT — the register text itself still lives here.
>
> **Distinct from:** `CLAUDE.md` (architecture/conventions/invariants), `project-state.md` (current
> status + active tasks), `docs/history.md` (chronological record of shipped work). This file is a
> *plan*; when a pair is completed, its outcome moves to `docs/history.md` and the resulting
> invariants move to `CLAUDE.md`.
>
> **Grounding rule:** every claim below is either (a) read directly out of the source at the cited
> file/function, (b) a cited test name from an existing test file, or (c) explicitly labelled
> `UNVALIDATED` / `USER-REPORTED`. Claims of type (c) are the ones this program exists to convert
> into type (a) or (b). This document is meant to be audited against the code — if a line here
> disagrees with the code, the code is right and this file is stale.

---

## 0. Why This Program Exists

The sync system works. It has 1165 passing tests, a regression-locked timing path
(`project-state.md` Key Invariant (a)), and a year of shipped fixes behind it. What it does not
have is **stated contracts between its stages**.

Every incident in the recent record has the same shape: one stage produced output that was
*technically valid* but violated something the next stage silently assumed.

| Incident | Producer did | Consumer assumed | Result |
|---|---|---|---|
| Middle-gap position offset (2026-07-25) | Emitted `-1` sentinel token indices for unmatched segments | `tokens[idx]?.endSec` resolves to a real spoken edge | 0.13s drift on covered segments adjacent to skipped ones |
| Token-stealing (2026-07-29, WS6) | Global Hirschberg consumed a neighbour's words as substitutions | Every segment's own words remain available to it | Wronged neighbour got zero true matches |
| False-positive rescue (2026-07-31) | Rescue claimed a token ~412s away | Rescue claims are temporally plausible | ~206s phantom first segment, real successor collapsed |
| Window-overlap regression (2026-07-31) | `isBoundarySilenceCandidate` rejected on a 0.3s timestamp tolerance | Whisper trailing-word blur stays under 0.3s | Genuine boundary silences rejected wholesale on a 173/174-segment project |
| Contiguity break (2026-07-31) | `snapCoveredBoundaries` wrote `next.startTime` while `curr.duration` was floored | `startTime[i] + duration[i] === startTime[i+1]` | Visible overlapping segment cards once Timeline went absolute-positioned |

None of these were bugs in the math. Each was a **contract violation across a handoff** — and each
was found by a user watching a broken timeline, not by a test. The program below inverts that:
write the contract down, build a validator that checks it at runtime, then deliberately break the
producer and prove the validator catches it.

---

## 1. Pipeline Map

### 1.1 The linear model

```
   ┌─────────────────────────────────────────────────────────────────────────┐
   │  INPUTS: voiceover blob · script text · scene-doc text · staged assets  │
   └─────────────────────────────────────────────────────────────────────────┘
                                       │
   ╔═══════════════════════════════════▼═══════════════════════════════════════╗
   ║ ① VAD / TRANSCRIPTION                                                     ║
   ║   whisper.rs (sidecar) · silenceDetector.ts · tauriFfmpeg.probeAudioDuration║
   ║   OUT: TranscriptToken[] · SilenceDetectResult · audioDuration            ║
   ╚═══════════════════════════════════╤═══════════════════════════════════════╝
                                       │  ── CONTRACT 1→2 ──
   ╔═══════════════════════════════════▼═══════════════════════════════════════╗
   ║ ② NORMALIZATION                                                           ║
   ║   filterMalformedTokens · canonicalize · normalizeSceneDoc                ║
   ║   parseProjectData (scene-doc side: numbered segments + estimate anchors)  ║
   ║   OUT: filtered tokens[] · queryWords[] + segRanges[] · VideoSegment[]     ║
   ╚═══════════════════════════════════╤═══════════════════════════════════════╝
                                       │  ── CONTRACT 2→3 ──
   ╔═══════════════════════════════════▼═══════════════════════════════════════╗
   ║ ③ GLOBAL ALIGNMENT (Hirschberg, semi-global, free subject end-gaps)       ║
   ║   alignQueryToSubject → TokenAlignment { ops, matchedSubjectOf, score }    ║
   ║   OUT: matchedSubjectOf: Int32Array (query idx → subject idx | -1)         ║
   ╚═══════════════════════════════════╤═══════════════════════════════════════╝
                                       │  ── CONTRACT 3→4 ──
   ╔═══════════════════════════════════▼═══════════════════════════════════════╗
   ║ ④ RESCUE + SURVIVAL GATES                                                 ║
   ║   Pass 1 windowed · Pass 2 global · Pass 3 concat · forward-ordering bound ║
   ║   hasQualifyingRun (run gate + density fallback) · adopt-or-discard        ║
   ║   OUT: AlignResult[] { t0,t1,firstTokenIdx,lastTokenIdx,matched,           ║
   ║                        confidence,matchedWords,totalWords,longestRun,      ║
   ║                        audioRegion?,recoveredVia?,recoveredRegion? }       ║
   ╚═══════════════════════════════════╤═══════════════════════════════════════╝
                                       │  ── CONTRACT 4→5 ──
                                       │   (evaluateCoverageGate · filterToCoveredSegments)
   ╔═══════════════════════════════════▼═══════════════════════════════════════╗
   ║ ⑤ BOUNDARY SNAPPING                                                       ║
   ║   3-pass: window+candidacy → contention assignment → left-to-right resolve ║
   ║   fillsTokenGapWithinSpan · isBreathSilence · isBoundarySilenceCandidate   ║
   ║   degenerate-pair guard · monotonic check + re-check                       ║
   ║   OUT: one boundary per adjacent covered pair                             ║
   ╚═══════════════════════════════════╤═══════════════════════════════════════╝
                                       │  ── CONTRACT 5→6 ──
   ╔═══════════════════════════════════▼═══════════════════════════════════════╗
   ║ ⑥ FINALIZATION                                                            ║
   ║   distributeSegmentTimes · applyAnchorBasedTiming · headExtendFirstSegment ║
   ║   contiguity invariant · duration floors                                   ║
   ║   OUT: VideoSegment[] with final startTime/duration/anchorStart            ║
   ╚═══════════════════════════════════╤═══════════════════════════════════════╝
                                       │  ── CONTRACT 6→7 ──
   ╔═══════════════════════════════════▼═══════════════════════════════════════╗
   ║ ⑦ PRESENTATION                                                            ║
   ║   Timeline.tsx (absolute positioning, computeTotalDuration, lanes)         ║
   ║   SyncLogPanel.tsx (SyncLogEntry[] rendering) · PreviewStage · playback    ║
   ╚═══════════════════════════════════════════════════════════════════════════╝
```

### 1.2 The real execution order (the 5/6 interleave)

**The linear model above is a simplification and this program must not pretend otherwise.**
Stages 5 and 6 each run **twice**, on different arrays, with the coverage filter between them.
Read `useWhisper.ts`'s `alignSegmentsFromCachedTranscript` and `App.tsx`'s
`handleApplySyncFromFiles` together and the true order is:

```
  alignFromCache (hooks/useWhisper.ts:64)
    1. fetchAndDetectSilences                     ← stage ①
    2. filterMalformedTokens                      ← stage ②
    3. alignScenestoTranscript                    ← stages ③ + ④ + ⑤ᴬ
         ├ extractSegmentAlignments               ← ③ + ④
         ├ Step 2: t1 := next.t0 (unlocked only)
         ├ gap-fill 3-pass snap  ON THE FULL ARRAY ← ⑤ᴬ  (sees -1 sentinels)
         └ last segment t1 := audioEnd
    4. distributeSegmentTimes                     ← ⑥ᴬ
    5. applyAnchorBasedTiming                     ← ⑥ᴬ
                                                  ↓
  App.tsx handleApplySyncFromFiles (~2410-2538)
    6. evaluateCoverageGate                       ← 4→5 gate (abort or proceed)
    7. filterToCoveredSegments                    ← 4→5 partition
    8. snapCoveredBoundaries  ON THE COVERED ARRAY ← ⑤ᴮ  (no sentinels by construction)
         (or retileCoveredSegments when tokens.length === 0)
    9. headExtendFirstSegment                     ← ⑥ᴮ
   10. autoMatchSegments + preserveEffectFields
   11. setProject (atomic; log entries folded in first)
```

`⑤ᴬ` exists because `alignScenestoTranscript` is also a standalone public function with its own
test surface; `⑤ᴮ` exists because `⑤ᴬ` computes boundaries against `-1` sentinels for unmatched
segments (that *is* the middle-gap defect, `snapBoundaries.ts` header). `⑥ᴬ`'s output is
therefore **provisional** — it is the input `⑤ᴮ` refines, not the final timing. Any 5→6 contract
validator must state which of the two passes it is validating.

### 1.3 Per-stage detail

#### ① VAD / Transcription

| | |
|---|---|
| **Inputs** | `Asset` (voiceover), `durationSecs`, `AbortSignal` |
| **Key files** | `src-tauri/src/whisper.rs`, `services/whisperService.ts`, `services/silenceDetector.ts`, `services/tauriFfmpeg.ts` |
| **Key functions** | `transcribeWithProgress`, `detectSilences`, `probeAudioDuration`, `fetchAndDetectSilences` (`useWhisper.ts:22`) |
| **Outputs** | `TranscriptToken[]` `{text,startSec,endSec}` · `SilenceDetectResult` · `audioDuration: number` |

**Invariants it guarantees today** — verified:

- `whisper_transcribe` pre-transcodes to 16kHz mono WAV via the ffmpeg sidecar before whisper-cli
  runs, so any container the user uploads decodes (`whisper.rs`; whisper.cpp's miniaudio backend
  otherwise exits 0 with zero tokens on M4A/AAC).
- `detectSilences` **never throws** — every failure is `{status:'error', errorMessage}`
  (`silenceDetector.ts:37-62`). "Scan failed" and "no silence found" are type-level distinct.
- `probeAudioDuration` throws on failure; there is no fake-duration fallback. `App.tsx:2346-2358`
  aborts the whole sync on a probe failure rather than proportioning every segment wrong.
- Silences are non-overlapping, ascending, each `>= minDurationSec` (0.25s default) — implied by
  the single forward scan in `detectSilences:80-107`.

**Invariants it does NOT guarantee** — verified absent:

- Token timestamps are **not** validated here. **Correction (Pair 1 audit):** the timestamp
  parser this row originally cited, JS `parseTimestamp` (`whisperService.ts:42`), had zero
  references anywhere in the codebase and was dead code — deleted in Pair 1 (commit `c7db7cc`).
  The live parser is Rust `parse_timestamp` (`whisper.rs`), which this document had not
  previously cited; negative, inverted, non-finite, and past-end timestamps all still reach
  stage ② from it, unvalidated.
- Tokens are **not** guaranteed monotonic or non-overlapping. `fillsTokenGapWithinSpan`'s
  `TOKEN_GAP_EPSILON_SEC` doc comment explicitly exists to survive overlapping tokens.
- A token's `text` may contain multiple words, or normalize to nothing.

#### ② Normalization

| | |
|---|---|
| **Inputs** | raw `TranscriptToken[]`, `audioDuration`, scene-doc text, script text, assets |
| **Key files** | `services/whisperService.ts`, `services/textNormalize.ts`, `App.tsx` (`parseProjectData`) |
| **Key functions** | `filterMalformedTokens`, `canonicalize`, `canonicalizeForAlignment`/`normalize`, `normalizeSceneDoc`, `stripStageDirections`, `parseProjectData` |
| **Outputs** | filtered `TranscriptToken[]` + `{skippedCount,totalTokens}` · `VideoSegment[]` with estimate anchors |

**Invariants it guarantees today** — verified:

- `filterMalformedTokens` is **pure** and runs **once, before alignment**
  (`whisperService.ts:1282`). It drops non-finite, `t0 < 0`, `t0 >= t1`,
  `t1 > audioDuration + 0.5`, and text-normalizes-to-nothing tokens.
- The **filtered array is the array every downstream stage must use** —
  `AlignResult.firstTokenIdx`/`lastTokenIdx` index into it. `AlignFromCacheResult.tokens`
  (`useWhisper.ts:49`) exists solely to carry it, and `App.tsx:2529` reads
  `aligned.tokens`, never `project.transcriptTokens`.
- The end-of-audio check is skipped entirely when `audioDuration` is not positive-finite, so an
  unknown duration cannot discard every token (`whisperService.ts:1286`).
- One normalizer, two entry points: `canonicalize` (alignment) and `canonicalizeForFilename`
  (asset matching) share the Unicode-hygiene layer (`textNormalize.ts`) — they cannot drift.
- Stage directions / speaker labels are stripped on the **scene-doc side only**, never the
  transcript side, and never mutate `seg.text` — only the alignment *view*
  (`normalizeSceneDoc`, `whisperService.ts:102`).
- Empty-strip guard: a fully-parenthesized scene falls back to its unstripped text rather than
  becoming a zero-word "neutral" segment.
- `parseProjectData` gives every segment a character-weight `anchorStart` and
  `anchorSource: 'estimate'` — so **every parsed segment has a defined `anchorStart`**
  (this is load-bearing for stage ④'s rescue gate, and is exactly why a no-audio heading passes
  it; see `whisperService.ts:856-869`).

**Known defect carried at this stage** (documented, deliberately unfixed): `parseProjectData`'s
`TAG_REGEX = /(?=\[[^\]]*\])/` splits before *every* bracket anywhere in the text, so a mid-line
annotation is promoted to a scene anchor. Pinned by `sceneTagParsing.test.ts` with explicit
`// DEFECT:` markers. See `CLAUDE.md` → `App.tsx` entry. **Out of scope for this program** — it is
a parser/product-ruling question, not a handoff contract.

#### ③ Global Alignment

| | |
|---|---|
| **Inputs** | `queryWords: string[]` (all segments concatenated), `subjectWords: string[]` (all token-words), optional per-subject-position bonus |
| **Key files** | `services/whisperService.ts` |
| **Key functions** | `alignQueryToSubject`, `hirschbergGlobal`, `nwForwardRow`, `nwForwardRowFreeLead`, `nwBackwardRowToFixedEnd`, `pairScore` |
| **Outputs** | `TokenAlignment { ops, matchedSubjectOf: Int32Array, score }` |

**Invariants it guarantees today** — verified:

- Produces the **optimal** semi-global alignment (free end-gaps on the subject side only), in
  `O(n+m)` space via Hirschberg divide-and-conquer. Property-tested against a full-matrix NW
  reference: *"matches the reference score on 300 random small fixtures"*.
- `matchedSubjectOf[i] >= 0` **iff** query word `i` is a *true textual equality* match. A
  substitution never enters it (`hirschbergGlobal:302-307`) — this is the single most
  load-bearing fact in the whole pipeline, and it is what makes stage ④'s `globallyClaimed` set
  safe.
- Match set is structurally sound: equal words, strictly increasing subject indices — test
  *"returned matches are structurally sound (equal words, strictly increasing)"*.
- The temporal bonus can only rank competing **correct-word** matches — `pairScore` adds it to
  the match branch only, so a bonus can never turn a wrong word into a match
  (`whisperService.ts:181`).
- Omitting `subjectBonus` yields an all-zero `Float64Array`, so every pre-WS6 caller and test is
  byte-identical (`alignQueryToSubject:362`).
- `ops` is sorted by `qi` defensively before return.

#### ④ Rescue + Survival Gates

| | |
|---|---|
| **Inputs** | `matchedSubjectOf`, `segRanges`, `tokenWords`, `tokens`, each segment's `anchorStart` |
| **Key files** | `services/whisperService.ts`, `services/syncConstants.ts` |
| **Key functions** | `extractSegmentAlignments`, `findExactSequentialMatches`, `findConcatenatingMatches`, `computeForwardBoundStartSec`, `earliestClaimStartSec`, `computeLongestRunWithHoles`, `requiredRunLength`, `isLocallyClustered`, `hasQualifyingRun`, `buildOccArrayFromGlobalMatches` |
| **Outputs** | `AlignResult[]`, index-parallel to `segments` |

**Invariants it guarantees today** — verified:

- **The global pass is never modified.** Rescue is layered on top; every pre-WS6 test depends on
  the global pass's whole-document optimality (`whisperService.ts:770-789`).
- **Can only add, never steal.** Every pass filters against `globallyClaimed` — the set of every
  subject index any segment truly matched in the global pass. Test *"3) monotonic exclusivity: a
  segment cannot recover a word another segment genuinely, globally matched"*.
- **Rescue fires only for a segment that fails `hasQualifyingRun` AND has a defined
  `anchorStart`** (`whisperService.ts:996`). Gate and `matched` share one function, so a
  density-qualifying segment skips the rescue block entirely.
- **Forward-ordering bound**: a claim's *earliest* token must sit strictly before the first token
  any *later* segment truly matched globally. Computed once, before any rescue runs, from the
  unchanged global pass — so every segment's bound is order-independent. Applied to Pass 1, 2,
  and 3 alike. Tests: whole `rescue forward-ordering bound (false-positive rejection)` block,
  including *"boundary: a claim whose earliest token startSec exactly equals the forward bound is
  rejected (>=, not >)"*.
- **Adopt-or-discard**: a literal zero-match rescue adopts unconditionally; a widened-gate rescue
  adopts only if it produces a qualifying run, else the original global-pass result stands
  (`whisperService.ts:1163`). Tests: *"accepts: ..."* / *"discards: ..."* under
  `rescue-gate widening under Bug C`.
- `matchedWords`/`confidence` are the **real** counts even when `matched === false` — never
  zeroed, because `computeCoverageSummary` reads them regardless (`whisperService.ts:1191-1196`).
  Test: *"a segment failing the run check still contributes its real matchedWords to
  computeCoverageSummary (audit Q8)"*.
- `matched === true` ⟹ `firstTokenIdx >= 0 && lastTokenIdx >= 0 && audioRegion` present.
  `matched === false` ⟹ both are `-1`, no `audioRegion`, and `t0 === t1 === prevAnchor`.
- `t1 >= t0 + 0.05` on a matched result (`whisperService.ts:1203`).
- `recoveredVia`/`recoveredRegion` are present **iff** a rescue claim was *accepted* — undefined
  both for a direct global match and for a rejected claim (`AlignResult` doc comment).

#### ⑤ Boundary Snapping

| | |
|---|---|
| **Inputs** | segment pairs + their alignments, `tokens[]` (filtered), `silences[]`, `audioDuration` |
| **Key files** | `services/snapBoundaries.ts`, `services/whisperService.ts` (`alignScenestoTranscript`'s gap-fill) |
| **Key functions** | `snapCoveredBoundaries`, `fillsTokenGapWithinSpan`, `isBreathSilence`, `isBoundarySilenceCandidate` |
| **Outputs** | one boundary per adjacent pair, written as `curr.duration` + `next.startTime`/`anchorStart` |

**Invariants it guarantees today** — verified:

- **Three passes, in this order, and the ordering is load-bearing**: (1) compute every pair's
  window + candidate set from a *pre-mutation snapshot*; (2) assign each contested silence to the
  single pair whose spoken midpoint it is closest to (ties → later pair); (3) resolve
  left-to-right reading only each pair's own assigned candidates. The old `usedSilences`
  first-come-first-served set is gone.
- **Candidacy is composed in exactly one place** (Pass 1's filter), so Pass 2's assignment can
  never disagree with Pass 1's candidacy (`snapBoundaries.ts:182-187`).
- **Predicate order**: `fillsTokenGapWithinSpan` (alignment evidence, short-circuits) →
  `isBreathSilence` (coverage-composite) → `isBoundarySilenceCandidate` (pure window overlap).
  An alignment fact must not be forgivable by a timestamp guess.
- `isBoundarySilenceCandidate` is **pure window overlap** as of the 2026-07-31 regression fix —
  no span/tolerance test. `BOUNDARY_SILENCE_INTRUSION_TOLERANCE_SEC` was deleted, not re-tuned.
  Tests: *"accepts a silence deep inside where the CURRENT segment's speech used to be ... no
  longer rejected on edge-distance alone"* (+ the mirrored NEXT-segment case).
- Both breath predicates guard the `-1` sentinel (`firstTokenIdx < 0 → false`), which is what
  makes them safe to reuse on the aligner's full-array path.
- **Degenerate-pair guard**: an inversion beyond `DEGENERATE_PAIR_INVERSION_THRESHOLD_SEC`
  (= `TEMPORAL_TOLERANCE_MAX_SEC`, 5.0s) writes **no boundary at all** and does not update
  `prevBoundary`. A mild inversion still falls through to the plain-midpoint fallback unchanged.
- **Monotonic check + re-check**: a backwards boundary falls back to the token midpoint; if that
  is *still* backwards it clamps to `prevBoundary` rather than committing backwards silently
  (`snapBoundaries.ts:666-692`).
- **Parity** between `alignScenestoTranscript`'s gap-fill and `snapCoveredBoundaries` holds
  *including under contention* since the 2026-08-02 port — pinned by *"parity: a contested
  silence resolves identically via alignScenestoTranscript's own gap-fill and via
  snapCoveredBoundaries, when nothing is skipped"*. Two deliberate differences remain: the
  degenerate-pair guard and the monotonic re-check exist only in `snapCoveredBoundaries`.
- **Pure** — copies its input, never mutates. Test: *"does not mutate the input segments"*.

#### ⑥ Finalization

| | |
|---|---|
| **Inputs** | segments + alignments (⑥ᴬ) / snapped segments (⑥ᴮ), `audioDuration` |
| **Key files** | `services/whisperService.ts`, `services/syncEngine.ts`, `App.tsx` |
| **Key functions** | `distributeSegmentTimes`, `applyAnchorBasedTiming`, `headExtendFirstSegment`, `retileCoveredSegments` |
| **Outputs** | `VideoSegment[]` with final `startTime`/`duration`/`anchorStart`/`anchorSource` |

**Invariants it guarantees today** — verified:

- `applyAnchorBasedTiming` postconditions (its own doc comment, `syncEngine.ts:166-172`): every
  segment has `anchorStart`/`startTime`/`duration`; startTimes monotonically non-decreasing and
  contiguous; `first.startTime === 0`; `last.duration === audioDuration - last.startTime`.
- **Backstop monotonic clamp** (D16 defense-in-depth): a backward walk pulls any inflated
  non-locked anchor down to its successor before durations are derived. No-op on already-monotonic
  input. Test: *"(d) backstop clamp: an inverted anchor is clamped, later segment protected"*.
- **Locks are authoritative everywhere *once a segment reaches these five sites carrying `locked:
  true`* — CORRECTED 2026-08-04, this guarantee is NOT currently met**: locked segments never move
  or shrink, in `distributeSegmentTimes`, `applyAnchorBasedTiming`, `snapCoveredBoundaries`,
  `headExtendFirstSegment`, and both gap-fill passes — but clean-slate resync's Stage-1 mint
  (`parseProjectData`, `App.tsx:318`, building each fresh `VideoSegment` from a `RawSegment` that
  has no `locked` field at all, `App.tsx:161-172`/`513-528`) drops the flag before any of these
  five sites ever runs, so none of them is actually checking a segment that could carry `true`.
  Owner-reproduced defect: locking two overlapping segments and running Apply Sync resets both
  positions AND clears both lock flags. See `project-state.md`'s Deferred Known Bugs and
  `docs/sync-pipeline-v2-plan.md`'s K13 for the full mechanism and the fix (Stage 3 must BUILD
  carry-forward, not merely consolidate the five checks into one).
- **Contiguity invariant** — `startTime[i] + duration[i] === startTime[i+1]` for every adjacent
  covered pair produced by `snapCoveredBoundaries`. Enforced unconditionally
  (`snapBoundaries.ts:703-709`); `project-state.md` Key Invariant (f).
- `headExtendFirstSegment` grows segment 1 backwards to `startTime 0` **without moving its end**,
  so it can never ripple into segment 2 — no contiguity re-check needed. No-op on a locked or
  already-at-0 first segment. Four tests under `headExtendFirstSegment`.
- All timing values are rounded to 3 decimals uniformly (`round3` / `.toFixed(3)`).

#### ⑦ Presentation

| | |
|---|---|
| **Inputs** | `project.segments`, `project.headings`, `project.syncLog`, `project.syncRunSummaries` |
| **Key files** | `components/Timeline.tsx`, `components/SyncLogPanel.tsx`, `components/PreviewStage.tsx`, `hooks/usePlayback.ts` |
| **Key functions** | `computeTotalDuration`, `useTimelineWaveform`, `formatEntryText`, `formatMatchLine`, `TYPE_STYLES` |
| **Outputs** | rendered timeline + log panel |

**Invariants it guarantees today** — verified:

- `computeTotalDuration` uses `max(startTime + duration)`, falling back to the duration sum only
  when there are no segments — lane width, `pixelsPerSecond`, and every `left`/`width` style key
  off this one function (`Timeline.tsx:23`).
- Every segment card is absolutely positioned as a direct function of **its own** `startTime`,
  not an accumulated sum of prior siblings' widths — required once the contiguity invariant
  became snap-produced rather than flexbox-implied.
- `TYPE_STYLES` is a `Record<SyncLogEntryType, …>`, so a new entry type is a **compile error**
  here rather than an unstyled badge at runtime (`SyncLogPanel.tsx:19`).
- `formatEntryText` is the **same** formatter the panel renders on screen, reused by the Copy
  button — copied text cannot drift from displayed text.
- Every optional `SyncLogEntry` field is read defensively; a pre-WS4 entry renders as a plain
  message line rather than printing `undefined`.

---

## 2. The Six Contracts (+ Input Annex)

Each section states what the producer **promises**, what the consumer **assumes** (read out of the
consumer's code, not out of intent), and what evidence exists that the two agree. Assumptions with
no enforcing code and no test are tagged `UNVALIDATED` — those are the work.

> **Citation audit (`8d83358`):** every `file:line` in this section was re-read against the code
> at this commit. Two drifted since first writing and are corrected: the fabricated no-voiceover
> duration is `App.tsx:453` (was cited as `:468`), and `appendSyncLogEntries` is `App.tsx:1118`
> (was `:1116`). All other citations verified unchanged.

There are six numbered pairs, plus one annex: **Contract 0→2** covers the user's own inputs
(script, scene doc, staged assets), which feed stage ② without passing through any producing
stage. It is not a seventh pair — it has no producer to harden — but its receiving contract is
real and is **audited within Pair 1** (both hand data to stage ②, and both share the same
validator wiring).

---

### Contract 0→2 · User Inputs → Normalization (annex — audited within Pair 1)

**"Producer" guarantees** — here the producer is the user plus the staging UI, so the guarantees
are only what the app *enforces on intake*, verified:

1. Voiceover duration is positive-finite or the sync aborts with a toast + abort log entry — no
   fake-duration fallback (`App.tsx:2346-2358`; the old silent 60s fallback is gone).
2. Zero parsed segments (empty/tagless scene doc) is a hard abort
   (`emptySceneDocAbortMessage`, `App.tsx:653`) — including the fresh-project case.
3. A staged voiceover that transcribed to zero tokens is a hard abort
   (`emptyTranscriptAbortMessage`, `App.tsx:660`); no voiceover at all is *not* an error
   (character-timed projects are valid).
4. A file dropped on the Voiceover slot that doesn't classify as audio raises a slot error
   instead of misrouting to the image bucket (`audioFormats.ts` `isAudioFile`).

**Consumer assumptions** (`parseProjectData`, the orchestrator):

| # | Assumption | Enforced? |
|---|---|---|
| 1 | Bracket tags delimit scenes as the author intended | ⚠️ known defect (R5/N4 mid-line split) — documented, deliberately deferred, §7 |
| 2 | `voiceoverDuration > 0` on the audio path | ✅ probe abort above |
| 3 | The no-voiceover path's synthetic budget is acceptable | ⚠️ `UNVALIDATED` **and silent** — `voDuration = rawSegments.length * 5` fabricates a total duration (`parseProjectData`, `App.tsx:453`) with no log entry saying the timeline length is invented |
| 4 | A video asset shorter than its slot is handled | ✅ `playbackSpeed = sourceDuration / targetDuration` compression (`App.tsx:478`) — but silent: nothing tells the user a clip was slowed to fill its slot |
| 5 | An explicit tag resolves to at most one asset | ⚠️ console-only — an ambiguous exact/word match leaves the segment unmatched with `console.warn` (`App.tsx:398`, `:425`); already in the §5 inventory |
| 6 | An asset is assigned to at most one segment | ⚠️ console-only data-quality warning (`App.tsx:522`); already in the §5 inventory |

**Known evidence:** `sceneTagParsing.test.ts` (incl. the `// DEFECT:`-pinned split behaviour);
`WS1b — empty-input hard aborts` (5 tests); `audioFormats.test.ts`.

**Gap summary:** the synthetic no-voiceover duration and the playback-speed compression are
silent; the two intake warnings (5, 6) are console-only. Assumption 1 stays deferred (§7).

---

### Contract 1→2 · Transcription → Normalization

**Producer guarantees** (`whisper.rs`, `silenceDetector.ts`, `tauriFfmpeg.probeAudioDuration`):

1. `TranscriptToken[]` is emitted in whisper-cli's own emission order.
2. `detectSilences` never throws; failure is a typed `{status:'error'}`.
3. Silences are ascending, non-overlapping, each `>= 0.25s`.
4. `audioDuration` is a positive finite number, or the sync already aborted (`App.tsx:2346`).
5. A zero-token result is possible on exit code 0 and is *not* an exception.

**Consumer assumptions** (`filterMalformedTokens`, `extractSegmentAlignments`,
`fetchAndDetectSilences`):

| # | Assumption | Enforced? |
|---|---|---|
| 1 | Tokens may be malformed in any of 5 ways | ✅ `filterMalformedTokens` |
| 2 | Everything downstream uses the **filtered** array | ✅ by construction (`AlignFromCacheResult.tokens`); tested indirectly |
| 3 | `audioDuration` may be unusable | ✅ `checkAgainstEnd` guard |
| 4 | A token's `text` may hold multiple words | ✅ `tokenWords` expansion, `whisperService.ts:821-827` |
| 5 | **Tokens are in ascending time order after filtering** | ✅ asserted — `validateTokenOrdering` (`syncContracts.ts`) walks the filtered array and reports every inversion as a WARNING; wired into both the Apply Sync and staging-transcription paths (Pair 1, Step 3) |
| 6 | **The drop set is unbiased w.r.t. position** | ✅ instrumented — `filterMalformedTokens` now records a `TokenDrop` (index/reason/raw values) per rejection, and `analyzeDropDistribution` (`syncContracts.ts`, Risk R1) flags a WARNING when more than `DROP_CLUSTERING_RATIO_THRESHOLD` of drops cluster inside one `DROP_CLUSTERING_WINDOW_SEC` window. The three thresholds are the task's stated starting values, not yet calibrated against production drop distributions |
| 7 | Silences are ascending and disjoint | ⚠️ `UNVALIDATED` at the consumer, **confirmed-in-practice by identity trace** (Pair 1 audit: every producer call site was read and the invariant holds by construction today) — no runtime assertion exists yet; adding one is deferred to Pair 6, which already owns the `Map<SilenceInterval,…>` identity-coupling risk (R8) this assumption feeds |
| 8 | `tokens[tokens.length-1].endSec` is the audio end (`whisperService.ts:926`, `audioEnd` at 1333) | ⚠️ **VIOLATED, partially fixed** — `extractSegmentAlignments` now accepts an optional true probed `audioDuration` and uses it for the last-segment rescue window (`rescueWindowAudioEnd`) when a caller supplies it; both production call sites (`useWhisper.ts`) now pass it. The token-derived fallback remains for callers that don't (documented residual, ~105 existing test call sites kept byte-identical). `alignScenestoTranscript`'s own separate `audioEnd` local (`whisperService.ts:1333`) is UNCHANGED and still token-derived — listed here as the remaining gap, not yet corrected |

**Known evidence:**

- `syncTiming.test.ts` → `filterMalformedTokens (WS4 Feature 4)` — 14 tests covering each drop
  reason, the tolerance boundary, the unusable-`audioDuration` skip, purity, and
  *"leaves alignment unchanged when the filter drops the bad tokens first"*.
- `silenceDetector.test.ts` — the `{status:'ok'|'error'}` discrimination.
- `textNormalize.test.ts` + `syncTiming.test.ts` → `WS1a — unified normalizer (R1 carve-out,
  ZW-join, NFC)`.
- **Production evidence (`USER-REPORTED`, this month):** a run dropped **169 of 1973 tokens
  (~8.6%)** at this handoff. What the code *does* surface for that: one `'malformed-token'`
  SyncLogEntry on the Apply Sync path with the raw counts
  (`buildMalformedTokenEntry`, `App.tsx:1007`). What it does **not** surface, verified:
  *which* of the five drop reasons fired, *where* in the timeline the drops clustered, and — on
  the **staging-time** fresh-transcription path (`useWhisper.ts:278-283`) — anything at all
  beyond a `console.warn`, because that path has no `syncRunId` to attach an entry to.
- **Pair 1 follow-up (this run, re-analyzed with the new `TokenDrop` capture):** the same
  production run's 169 drops break down as **139 `empty-text` + 30
  `inverted-or-zero-duration`** — zero `non-finite`, `negative-start`, or `past-audio-end` drops.
  Neither `analyzeDropDistribution` nor `validateTokenOrdering` fired against this project's real
  data (no clustering above the 40% threshold, no ordering inversions) — a clean pass, not an
  absence of checking.

**Gap summary for this pair:** assumptions 5 and 6 now enforced (`validateTokenOrdering`,
`analyzeDropDistribution`); assumption 7 confirmed-in-practice, runtime assertion deferred to
Pair 6; assumption 8 partially fixed (rescue-window site corrected, `alignScenestoTranscript`'s
own `audioEnd` local remains token-derived). Staging-path drops/silence-failures/violations now
reach the log (R11, resolved with corrections — see §5).

---

### Contract 2→3 · Normalization → Global Alignment

**Producer guarantees:**

1. `queryWords` is the concatenation of every segment's canonicalized words in segment order, with
   `segRanges[i] = {start,end}` recording each segment's contiguous half-open range.
2. Zero-word segments get an **empty** range (`start === end`) and are classification-neutral.
3. `subjectWords` is the token-word expansion, empty words filtered out.
4. Both sides went through the **same** canonicalizer, so a spelled number and its digit form
   collapse to the same token.
5. Scene-doc side only is stage-direction/speaker-label stripped; `seg.text` is never mutated.

**Consumer assumptions** (`alignQueryToSubject`):

| # | Assumption | Enforced? |
|---|---|---|
| 1 | Both arrays may be empty | ✅ explicit `n===0` / `m===0` branches |
| 2 | No word is the empty string | ✅ producer filters `word.length > 0` on both sides |
| 3 | `segRanges` partitions `queryWords` with no gaps or overlaps | ⚠️ `UNVALIDATED` — true by construction of the build loop, never asserted. A future edit to that loop breaks per-segment extraction silently |
| 4 | Sequence lengths are small enough for `O(n·m)` time | ⚠️ `UNVALIDATED` in production. `__ALIGN_INSTRUMENT__` exists (`whisperService.ts:117-137`) but is dormant by default; no size guard, no timing budget, no warning |
| 5 | `Int32Array` indices suffice (< 2³¹ words) | ✅ trivially true |
| 6 | Canonicalization is symmetric — an asymmetry becomes a **local** diff cost, never a cascade | ⚠️ partially validated: the D16 equivalence block tests specific pairs, but nothing asserts the general property |

**Known evidence:**

- `D16 — canonicalization equivalence (Part A)` — 8 tests (spelled↔digits, single digit↔word,
  year pair-reading, contraction↔expansion, `%`/`&`/`$`, decimals, glued mixed-alnum).
- `D16 — alignment robustness (Parts A + C)` — the equivalences driven **through the full
  aligner**, incl. *"REGRESSION: script 'thirty seven' aligns to Whisper '37'; next segment does
  NOT drift"*.
- `WS1a — Hirschberg ≡ full-matrix NW (property)` — *"matches the reference score on 300 random
  small fixtures"*, *"matches the reference score AND match set on hand-built free-end-gap
  fixtures"*, *"returned matches are structurally sound"*.
- `stage-direction stripping through the aligner (WS4 Feature 1)` — 5 tests incl.
  *"falls back to the original text when stripping would empty a segment"* and *"does not strip
  the transcript side"*.
- `WS5 — speaker-label stripping through the aligner` — 4 tests, same shape.

**Gap summary for this pair:** `segRanges` partition unasserted; no runtime cost bound on the
`O(n·m)` DP; canonicalization symmetry tested by example, not as a property.

---

### Contract 3→4 · Global Alignment → Rescue + Gates

**Producer guarantees:**

1. `matchedSubjectOf[i] >= 0` **iff** query word `i` is a true textual-equality match.
2. Matched subject indices are strictly increasing across the query (monotonic DP path).
3. The alignment is globally optimal, hence reproducible for a fixed `(query, subject)` pair.
4. No subject index is claimed by two query positions.

**Consumer assumptions** (`extractSegmentAlignments`'s rescue block):

| # | Assumption | Enforced? |
|---|---|---|
| 1 | `globallyClaimed` = every truly-matched subject index, so an unclaimed token belongs to nobody | ✅ built directly from `matchedSubjectOf` (`whisperService.ts:850-854`) |
| 2 | Zero true matches for a segment is a **symptom**, not necessarily ground truth | ✅ that is the rescue's whole premise |
| 3 | Every segment has a defined `anchorStart` | ✅ producer-side (`parseProjectData`) — but note this is what lets a *no-audio heading* pass the rescue gate, the root of the 2026-07-31 incident |
| 4 | `anchorStart` may be badly drifted (verified live at 7.6s) | ✅ Pass 2/3 are unbounded in time |
| 5 | An unbounded scan needs an ordering constraint | ✅ forward-ordering bound, applied to all three passes |
| 6 | **`firstGlobalMatchSubjectOf` is a valid ordering signal** | ⚠️ `UNVALIDATED` for the case where *no* later segment has a true global match — the bound is then `undefined` and **every** claim is accepted. Test *"last-segment case: no successor means no bound"* covers the legitimate use; the pathological use (a long tail of zero-match segments at the end of a project) is not covered |
| 7 | Adopt-or-discard preserves the global result on discard | ✅ tested both directions |
| 8 | **`longestRun` thresholds are calibrated for the corpus** | ⚠️ `UNVALIDATED` beyond the two production projects named in `syncConstants.ts`. The constants file itself documents an accepted phantom-match risk on the new tiny band |
| 9 | `hasQualifyingRun` is called with a `totalWords > 0` | ⚠️ `UNVALIDATED` — `confidence = matchedCount / totalWords` would be `NaN` at 0. Unreachable today (the `totalWords === 0` branch returns early at `:940`) but nothing in `hasQualifyingRun` itself guards it |

**Known evidence:**

- `WS6 — per-segment temporal-bounding rescue` — 10 numbered tests + the `[align-recover]` log
  test, covering the token-stealing repro, bounding, monotonic exclusivity, temporal-bonus tie
  breaks, no-false-positives, the no-regression case, tolerance scaling, the last-segment window,
  and the global fallback for a drifted anchor.
- `rescue forward-ordering bound (false-positive rejection)` — 6 tests incl. the heading
  regression, the `>=`-not-`>` boundary, the zero-match successor chain, and
  *"all existing WS6 rescue tests are unaffected by the forward-ordering bound"*.
- `Pass 3 — sliding-window concatenation match (sub-word merge)` — 7 tests.
- `Bug C — contiguous-run survival requirement` — the flagship 9-word scattered-match skip, the
  linen-from-flax preservation, plus `computeLongestRunWithHoles` (10 tests),
  `requiredRunLength / hasQualifyingRun band boundaries` (4), `density fallback` (3),
  `isLocallyClustered` (7), `buildOccArrayFromGlobalMatches` (1), `rescue-gate widening` (2).

**Gap summary for this pair:** the "no later true match anywhere" degenerate bound; threshold
calibration beyond two projects; `hasQualifyingRun`'s unguarded division.

---

### Contract 4→5 · Rescue Results → Boundary Snapping

This handoff has a **gate and a partition in the middle** — `evaluateCoverageGate` then
`filterToCoveredSegments` — and they are part of the contract.

**Producer guarantees** (`AlignResult[]` + `filterToCoveredSegments`):

1. `AlignResult[]` is index-parallel to the pre-filter segments array.
2. `matched === true` ⟹ `firstTokenIdx >= 0 && lastTokenIdx >= 0`.
3. `kept` and `keptAlignments` are index-parallel and collected in **one pass**, so they cannot
   fall out of step (`CoveredSegmentFilter` doc comment, `App.tsx:734-744`).
4. Every member of `keptAlignments` has `matched === true`, hence real token indices — this is the
   entire reason `snapCoveredBoundaries` exists.
5. A skipped segment leaves a real gap; no neighbour is stretched to cover it.

**Consumer assumptions** (`snapCoveredBoundaries`):

| # | Assumption | Enforced? |
|---|---|---|
| 1 | Every pair has two matched segments → no `-1` sentinels | ✅ by construction of `filterToCoveredSegments`; the `??` fallbacks in Pass 1 exist only to avoid `NaN`, **not** as a sentinel path (`snapBoundaries.ts:526-528`) |
| 2 | Array lengths match | ✅ defensive `!currAlign || !nextAlign → plans.push(null)` |
| 3 | `kept` is in ascending `startTime` order | ⚠️ `UNVALIDATED` — `snapCoveredBoundaries` never sorts (unlike `retileCoveredSegments`, which sorts defensively at `App.tsx:839`). Pass 3's monotonic check would then fire on *every* pair |
| 4 | Token indices point into the **same filtered array** the caller passes as `tokens` | ⚠️ `UNVALIDATED` at the boundary — correct today only because `App.tsx:2529` reads `aligned.tokens`. Nothing detects a caller passing `project.transcriptTokens` instead; the failure would be a silently wrong boundary, not a crash |
| 5 | Spoken edges may be inverted | ✅ mild → plain midpoint; large → degenerate-pair guard |
| 6 | `silences` array identity is stable (used as `Map` keys) | ⚠️ `UNVALIDATED` — works because the same array flows through; a `.map()` copy anywhere upstream silently breaks assignment |
| 7 | `audioDuration` ≥ last survivor's `startTime` | ⚠️ `UNVALIDATED` — `Math.max(MIN_SEGMENT_DURATION, …)` absorbs a violation into a 0.1s tail segment, silently |

**Known evidence:**

- `R4-2 — filterToCoveredSegments` — 7 tests incl. *"5 covered + 3 uncovered commits exactly 5
  segments, not 8"*, *"kept segments carry their Whisper-anchored startTime through untouched"*,
  the Bug 2→Bug C isolated-match skip, and the *"never produces a 'low confidence' skip reason"*
  regression guard.
- `filterToCoveredSegments — keptAlignments` — *"returns the kept segments' alignments, in the
  same order and the same length as kept"*.
- `R4-1 — middle gaps SKIP instead of aborting` — 8 tests (leading/trailing/interior skips, the
  locked-uncovered case, neutral segments, and *"all unmatched (full mismatch): STILL aborts"*).
- `WS1b — evaluateCoverageGate: R13 two-signal abort gate` (4) + `WS5 — R13 gate Signal 1/2
  boundary` (4) + `R13 gate is unaffected by the Bug 2 skip-filter change` (2).
- `fillsTokenGapWithinSpan — alignment-evidence predicate` (9), `isBoundarySilenceCandidate —
  plain window-overlap predicate` (6), `isBreathSilence — coverage-composite predicate
  (iteration 3)` (6) — all with hand-written numbers, no fixtures.
- `snapCoveredBoundaries — degenerate-pair guard` — 2 tests, incl. the real ~412s inversion.

**Gap summary for this pair:** ordering of `kept` unasserted; the "same filtered array" coupling
is convention-only; silence-array identity coupling undocumented at the type level.

---

### Contract 5→6 · Boundary Snapping → Finalization

**Producer guarantees** (`snapCoveredBoundaries`):

1. Writes `curr.duration`, `next.startTime`, `next.anchorStart` per resolved pair.
2. Boundaries are **monotonically non-decreasing** across the array (check + re-check + clamp).
3. **Contiguity**: `startTime[i] + duration[i] === startTime[i+1]` for every adjacent pair.
4. The last survivor runs to `audioDuration` unless locked.
5. Locked segments are never moved or shrunk.
6. Pure — input array not mutated.
7. A degenerate pair writes **nothing**, leaving upstream's timing intact.

**Consumer assumptions** (`headExtendFirstSegment`, then `autoMatchSegments` /
`preserveEffectFields` / `setProject`; and on the ⑥ᴬ side, `distributeSegmentTimes` /
`applyAnchorBasedTiming`):

| # | Assumption | Enforced? |
|---|---|---|
| 1 | `segments[0]` is the timeline's true first segment | ✅ enforced by *call site*, not by the function — `headExtendFirstSegment` is deliberately a post-pass for exactly this reason (`syncEngine.ts:274-286`) |
| 2 | Extending segment 1 backwards cannot ripple | ✅ its end is held fixed |
| 3 | Every duration is ≥ the floor | ✅ — but see below |
| 4 | **A floored duration means the boundary was degenerate** | ⚠️ `UNVALIDATED` **and silent**. `Math.max(MIN_SEGMENT_DURATION, snapped - curr.startTime)` at `snapBoundaries.ts:699` and `:717`, `Math.max(0.1, …)` at `whisperService.ts:1612` and `syncEngine.ts:239/246` — five floor sites, **zero warnings**, no counter, no log entry. Risk R2 |
| 5 | Two different `MIN_SEGMENT_DURATION` constants are intended | ⚠️ `UNVALIDATED` — `snapBoundaries.ts:230` defines `0.1`; `App.tsx:278` defines `0.3` ("minimum timeline slot width"). Same name, different files, different values, different purposes. Nothing documents the relationship |
| 6 | `retileCoveredSegments`'s degenerate branch (keep original duration) is rare | ⚠️ `UNVALIDATED` and silent (`App.tsx:846`) |
| 7 | `applyAnchorBasedTiming`'s out-of-order warning is actionable | ⚠️ console-only, not DEV-gated, no log entry (`syncEngine.ts:200`) |

**Known evidence:**

- `snapCoveredBoundaries — covered-only boundary snap` — 14 tests: silence-midpoint placement,
  no-silence fallback, the no-clamp-beyond-±0.15s pair, the 14-segment 6.56–7.12 regression,
  contention-aware assignment, four breath/intra-segment rejection cases, the pair-4 production
  geometry, the residual-closed case, last-segment extension, lock preservation, non-mutation.
- `snapCoveredBoundaries — monotonic fallback re-check (2026-08-02 fix)` — *"a still-backwards
  fallback midpoint clamps to prevBoundary instead of committing backwards"*.
- `contention-aware silence claiming (no starvation cascade)` — *"a long segment then two short
  segments then a normal one: no boundary starves its rightful successor"*.
- `middle-gap position offset — unmatched neighbours no longer shift covered segments` — 4 tests
  incl. *"with nothing skipped, the covered-only re-snap reproduces the aligner's own
  boundaries"* and the parity test.
- `alignScenestoTranscript — ported gap-fill candidacy (breath/gap rejection)` — 4 tests (a–d),
  incl. *"(d) a sentinel (-1) alignment on one side of a pair"*.
- `headExtendFirstSegment` (4), `R4-1 — retileCoveredSegments` (6),
  `clean-slate re-sync (real 11→14 scene repro)` (3), `legacy project — anchorStart undefined`
  (1), `WS1b — silence-snap boundaries` (6).

**Gap summary for this pair:** five silent floor sites; two same-named constants with different
values; the degenerate retile branch is silent; the anchor-order warning never reaches the user.

**2026-08-02 addendum — boundary-quality checker shipped out-of-pair-order:** the R2-adjacent
"floored/fallback boundary is silent" gap (row 4 above) has a Phase 1 fix
(`validateBoundaryQuality`, `syncContracts.ts`, rule `loud-fallback-boundary`) landed ahead of this
pair's formal turn — justified by the user-reported long-pause-voice regression, not a change of
audit order. It is observability only (`info` severity): flags a fallback boundary whose waveform
amplitude is loud relative to a real, farther-away quiet region, via a calibrated dual gate
(absolute floor + min distance + K-ratio; see `syncConstants.ts`). Per §3 Step 2, a Phase 2 that
would *move* the boundary (not just report on it) is scope creep for a hardening pass — "changing
what the alignment or snapping math computes is out of scope... a real math defect is written up
and scheduled separately, not folded into the hardening pass." That watcher is tracked as its own
queued item (`project-state.md` Active Tasks), not folded into this pair's Step 3 validator work.

---

### Contract 6→7 · Finalization → Presentation

**Producer guarantees:**

1. Contiguous, monotonic, floored, 3-decimal-rounded segments.
2. `syncLog`/`syncRunSummaries` are appended **atomically with the segments they describe** — one
   `setProject`, log folded in first (`App.tsx:2602-2617`).
3. Logs are capped: `MAX_LOG_ENTRIES = 500`, `MAX_SYNC_RUN_SUMMARIES = 10`, pruned from the
   **front** so the most recent survive.
4. Every log entry carries a `syncRunId` grouping it with its run.

**Consumer assumptions** (`Timeline.tsx`, `SyncLogPanel.tsx`):

| # | Assumption | Enforced? |
|---|---|---|
| 1 | Contiguity holds, so absolute positioning cannot overlap | ✅ producer-side (`snapBoundaries.ts:703`), Key Invariant (f). ⚠️ **but not on the `retileCoveredSegments` fallback path**, which has no equivalent contiguity write |
| 2 | `computeTotalDuration` covers every card | ✅ it takes the max right edge |
| 3 | Segments are in ascending `startTime` order for rendering + `segments.slice(1)` boundary markers | ⚠️ `UNVALIDATED` — Timeline never sorts |
| 4 | Every `SyncLogEntryType` has a badge | ✅ compile-enforced by the `Record` |
| 5 | Optional entry fields may be absent | ✅ every read is defensive |
| 6 | **Every meaningful failure produced a log entry** | ❌ `FALSE` today — see §4 and the Risk Register. Degenerate-pair skips, monotonic clamps, floor clamps, anchor inversions, and discarded stale alignments are all console-only |
| 7 | Segment durations are large enough to render | ⚠️ `UNVALIDATED` — a 0.1s segment at low zoom is a sub-pixel card |

**Known evidence:**

- `SyncLogPanel.test.tsx` — the panel's rendering, incl. skip-entry 3-line format and backward
  compatibility with pre-WS4 entries.
- `syncLog.test.ts` — the pure builders (`makeSyncLogEntry`, `buildSkipLogEntries`,
  `buildSyncInfoEntry`, `buildSilenceErrorEntry`, `buildMalformedTokenEntry`,
  `buildNoAssetSummaryEntry`, `buildRescueLogEntries`, `appendSyncLogEntries`, `clearSyncLog`).
- `rangeCompact.test.ts`, `timeFormat.test.ts`, `segmentSearch.test.ts` — display helpers.
- **`Timeline.tsx` has no test file.** Verified: `src/components/` contains only
  `SyncLoadingOverlay.test.tsx` and `SyncLogPanel.test.tsx`. The stage rebuilt most recently
  (absolute positioning, lane redesign, boundary markers, 2026-07-31) is the one with **zero**
  automated coverage.

**Gap summary for this pair:** no Timeline test coverage at all; ordering unasserted; the "every
failure is visible" assumption is currently false; the `retileCoveredSegments` path does not carry
the contiguity guarantee the renderer now depends on.

---

## 3. Per-Pair Workflow

Every pair goes through the same four steps, in this order, and **no pair advances while a known
gap exists in it.** A gap is any row tagged `⚠️ UNVALIDATED` or `❌ FALSE` in §2, plus anything the
audit turns up. "Known gap" means *recorded* — discovering a gap and deferring it is allowed only
by moving it to §7 (Out of Scope) with a written reason, never by leaving it open and proceeding.

### Step 1 — Audit

Read the producer and the consumer end to end. Do not read the doc comments and stop; the doc
comments are what this pipeline is *best* at and they still missed every incident in §0.

Produce:

- The full assumption table (the §2 tables are the starting draft, not the finished audit).
- For each assumption: the exact line that relies on it, and the exact line that enforces it — or
  the note that none does.
- The **failure mode** if the assumption is violated: crash, wrong number, or silent degradation.
  Silent degradation is the interesting one; it is what every incident in §0 was.

### Step 2 — Fix

Close whatever the audit found that is genuinely broken. Constraint: **fixes at this step are
limited to making an existing implicit guarantee explicit** — a missing guard, a missing early
return, an unhandled degenerate input. Changing what the alignment or snapping math *computes* is
out of scope (§7). If the audit finds a real math defect, it is written up and scheduled
separately, not folded into the hardening pass.

### Step 3 — Contract validator (pure function, zero behavior change)

Each pair gets one exported pure function, e.g.:

```ts
// services/syncContracts.ts
export interface ContractViolation {
  contract: '1->2' | '2->3' | '3->4' | '4->5' | '5->6' | '6->7';
  rule: string;              // stable machine-readable id, e.g. 'tokens-ascending'
  severity: 'warning' | 'error';
  message: string;           // user-facing, includes the fix hint (§4)
  detail?: Record<string, unknown>;  // numbers for the log, never for control flow
}

export function validate1to2(
  tokens: TranscriptToken[],
  filtered: MalformedTokenFilterResult,
  silences: SilenceInterval[],
  audioDuration: number,
): ContractViolation[];
```

Rules for every validator, without exception:

- **Pure.** No I/O, no DOM, no React, no `Date.now()`, no randomness. Same inputs → same output.
- **Zero behavior change, stated precisely.** A validator returns violations; it never mutates,
  never throws, never short-circuits the pipeline. With every validator call site deleted, the
  pipeline's **output segments and timing** (`startTime`/`duration`/`anchorStart`/`anchorSource`,
  the kept/skipped partition, the abort decision) are byte-identical. **Additional log entries
  are the single sanctioned behavioral delta** — that is the validators' entire purpose, so
  "byte-identical" deliberately does not extend to `syncLog`/`syncRunSummaries`. The
  no-behavior-change injection test (§3 Step 4) asserts segment-level identity, not whole-project
  identity.
- **Cheap enough to always run.** No second `O(n·m)` pass. If a check cannot be done in a linear
  scan over data already in hand, it is a diagnostic, not a validator.
- **Directly unit-testable with hand-written numbers** — the same standard
  `fillsTokenGapWithinSpan` / `isBoundarySilenceCandidate` / `isBreathSilence` already meet.
- **Every violation carries a fix hint** (§4). A violation the user cannot act on is an `INFO`,
  not a `WARNING`.

**Noise policy** (what happens after a rule ships):

- Validator wiring must be **one-line removable** per call site — one call, one spread into the
  entry list, nothing threaded through intermediate state. Disabling a misbehaving rule in an
  emergency must never require touching pipeline logic.
- A rule that **false-positives on a real project is downgraded to INFO, never silently
  deleted.** The downgrade is recorded in this document (rule id + the project/fixture that
  triggered it + why the rule's premise was wrong or too strict). Outright deletion requires an
  audit note proving the rule itself was *incorrect* — "noisy" alone only ever downgrades.
- **No rule ships without its injection test.** A rule with no test that proves it fires is not a
  contract check; it is a hope.

**Wiring — Apply Sync path:** the orchestrator calls the validator at the handoff point and folds
the violations into `pendingLogEntries` alongside the existing skip/rescue/no-asset entries — the
same staging mechanism, committed in the same atomic `setProject`.

**Wiring — staging path (the R11 hole, mechanism decided now):** the staging-time transcription
flow (`useWhisper.ts`'s `startTranscription`, both the fresh-transcription branch and the Option A
cached branch) has no Apply Sync `syncRunId`, which is why its failures are console-only today.
**Decision: staging mints its own run id** — reuse the transcription `jobId` where one is minted
(`useWhisper.ts:214`), mint a fresh UUID on the Option A branch — and appends its entries through
the already-available `onProjectUpdated` callback via `appendSyncLogEntries` (`App.tsx:1118`) with **no summary**.
Three reasons this beats the buffered-until-next-Apply-Sync alternative:

1. `appendSyncLogEntries`' `summary` parameter is *already optional*, with a doc comment written
   for exactly this: "so a future caller can log a standalone warning without inventing a run
   rollup for it" (`App.tsx:1118`, verified). The type system anticipated summary-less runs; no
   new shape is needed.
2. Buffering violations across runs creates cross-run mutable state with staleness rules — what
   happens if the user re-stages different audio, switches projects, or reloads before the next
   Apply Sync? Every one of those questions is a new bug surface, and the buffer's answer can be
   *wrong* (surfacing a stale violation against data that no longer exists). A per-staging run id
   has no staleness problem: the entry describes the staging event itself, timestamped.
3. `SyncLogPanel` already groups entries by `syncRunId`; staging entries render as their own
   group with zero panel changes.

Consequence: `SyncLogEntry.syncRunId`'s doc comment ("groups every entry emitted by one Apply
Sync run", `types.ts:379-380`) widens to "one run — Apply Sync or staging-time transcription" when
Pair 1 lands. The Apply Sync path is unchanged; it will usually re-report the same silence/token
findings via `alignFromCache`, and that duplication is acceptable — the two runs can legitimately
see different data (R11's residual), so each reports what *it* saw.

**Program-wide law — no new console-only failures (hybrid-state rule):** from the moment this
program starts, **no change — sync-related or not — may introduce a new console-only failure path
into the sync pipeline's stages or orchestration.** Any new failure path ships with its log entry
(severity + hint per §4) on day one, even while older console-only failures from the §5 inventory
are still being worked off pair by pair. The §5 inventory is a fixed work-down list; this law is
what keeps it from growing while the program runs. (For code outside the sync path, the same rule
is strongly recommended wherever a user-facing surface exists, but only the sync path is bound by
this program.)

### Step 4 — Failure-injection tests

For each rule in the validator, a test that **deliberately violates it** and asserts the violation
is produced, with the right severity and a non-empty hint. Then a test that the *clean* case
produces zero violations, and a test that the validator's presence changes nothing (same output
segments with and without it).

This is the step that would have caught §0's incidents: each one is a one-line fixture away from
being a permanent regression lock.

### Step 5 — Advance

A pair is DONE per §6's exit criteria. Only then does the next pair start. Pairs are not
parallelised — a contract written against a producer that the previous pair is still changing is a
contract written against a moving target.

---

## 4. Severity Taxonomy

The log panel today has 8 `SyncLogEntryType` values with ad-hoc colours (`SyncLogPanel.tsx`'s
`TYPE_STYLES`): `skip` yellow, `abort` red, `warning` orange, `info` grey, `silence-error` red,
`malformed-token` blue, `no-asset` orange, `rescue` grey. The *type* says what happened; nothing
says **how bad it is** or **what to do**. The eventual panel upgrade adds an orthogonal severity
axis.

### The three levels

| Severity | Meaning | User action | Panel treatment |
|---|---|---|---|
| **INFO** | The pipeline did something worth recording. Output is correct. | None. | Collapsed by default; grey. |
| **WARNING** | Output is usable but **measurably degraded** from what a clean run would produce. | Optional — there is something the user can change to improve it. | Always visible; amber; **carries a fix hint**. |
| **ERROR** | Output is wrong, or a stage failed outright and the pipeline continued on a fallback. | Required — the result should not be trusted as-is. | Always visible, expanded; red; **carries a fix hint**. |

### The rule

> **Every WARNING and every ERROR carries a user-facing fix hint.**
>
> A hint names something the *user* can do — not something the developer could do. "Re-export the
> voiceover as WAV" is a hint. "Check `snapBoundaries.ts:699`" is not; that belongs in `detail`.
>
> **No silent `console.warn`-only failure may survive the program.** By the end, every warn/error
> in the sync path either becomes a log entry, or is deleted because the audit proved it
> unreachable. A DEV-gated console line is acceptable **in addition to** a log entry, never
> instead of one.

### Examples per stage

| Stage | INFO | WARNING | ERROR |
|---|---|---|---|
| ① VAD/Transcription | Transcription completed, N tokens | Zero-token result on exit 0 — *hint: check the audio contains clear speech; try re-exporting as 16-bit WAV*<br>(today: `useWhisper.ts:248` console + a transient status banner, **no log entry**) | `probeAudioDuration` failed — *hint: re-add the audio file* (today: aborts with a toast, ✅ logged)<br>Silence scan failed — *hint: boundaries fell back to spoken-word midpoints; re-add the audio* (today: ✅ `'silence-error'`) |
| ② Normalization | N of M tokens filtered (today: ✅ `'malformed-token'`, blue) | Drop rate above threshold, or drops **clustered** in one region — *hint: that stretch of audio may be corrupted; check it plays cleanly* (**today: does not exist** — Risk R1) | Every token dropped → empty usable transcript |
| ③ Global alignment | Alignment completed, coverage X% | Alignment cost above the time budget — *hint: very long scene docs slow sync; consider splitting the project* (**today: does not exist**) | — (this stage cannot fail; it can only produce a poor alignment, which surfaces at ④) |
| ④ Rescue + gates | Segment N recovered via `<pass>` (today: ✅ `'rescue'`, grey) | Segment N skipped — no audio match, matched X of Y, longest run Z — *hint: check this scene's text matches what is spoken* (today: ✅ `'skip'` yellow, with the counts; **hint missing**) | Coverage gate aborted — full mismatch (today: ✅ `'abort'`) |
| ⑤ Boundary snapping | Boundary placed in detected silence for N of M pairs | Pair (i,i+1) fell back to a token midpoint because no silence was assignable — *hint: boundary may be slightly off; nudge it on the timeline*<br>Monotonic fallback clamped (**today: DEV console only**, `snapBoundaries.ts:685`) | Degenerate pair skipped — inverted by >5s (**today: DEV console only**, `snapBoundaries.ts:639`). This is the signature of a false-positive rescue and should be loud |
| ⑥ Finalization | N segments finalized, total = audio duration | Duration floored to the minimum on segment N — *hint: two scenes were placed almost on top of each other; check their text* (**today: five silent floor sites** — Risk R2)<br>Out-of-order anchor clamped (**today: bare console.warn**, `syncEngine.ts:200`) | Contiguity invariant violated after finalization (should be impossible — an ERROR here means a real regression) |
| ⑦ Presentation | — | Segment N is narrower than 1px at current zoom — *hint: zoom in to edit it* | Timeline received non-contiguous or unordered segments (should be impossible) |

### Mapping onto the existing type system

Severity is **additive**, not a replacement: `SyncLogEntry` gains an optional
`severity?: 'info' | 'warning' | 'error'` and an optional `fixHint?: string`, following the exact
optionality convention every later-added field already uses (`matchedWords`, `longestRun`,
`rescueCount` — "undefined on entries logged before this field existed"). Existing entry types map
to a default severity so a persisted pre-upgrade log renders sensibly:
`abort`/`silence-error` → ERROR, `skip`/`warning`/`no-asset` → WARNING,
`info`/`malformed-token`/`rescue` → INFO.

---

## 5. Risk Register

Honest assessment of today's soft spots. "Confidence" is confidence in the *current behaviour
being correct*, not in the description being accurate.

| ID | Pair | Risk | Evidence | Confidence | Detection today |
|---|---|---|---|---|---|
| **R1** | 1→2 | **INSTRUMENTED (was: token-drop clustering unknown).** `filterMalformedTokens` now records a `TokenDrop` per rejection (index/reason/raw values) and `analyzeDropDistribution` (`syncContracts.ts`) flags a WARNING when drops cluster inside one `DROP_CLUSTERING_WINDOW_SEC` window above `DROP_CLUSTERING_RATIO_THRESHOLD`. Re-run against the original 169/1973-drop production project: breakdown is 139 `empty-text` + 30 `inverted-or-zero-duration`, zero clustering violation fired (drops were not concentrated in one stretch on this project). The three constants are the task's stated starting values — **not yet calibrated** against a real corrupted-stretch case, since this project's own drops happened not to cluster. | `USER-REPORTED` count; drop-reason breakdown now captured directly; `analyzeDropDistribution`/`validateTokenOrdering` unit-tested in `syncContracts.test.ts` | **Low** (mechanism); **calibration unverified** | Distribution + reason breakdown, both logged |
| **R2** | 5→6 | **Floor clamps fire silently.** Five sites: `snapBoundaries.ts:699`, `:717`, `whisperService.ts:1612`, `syncEngine.ts:239`, `:246`. A clamped duration is the *symptom* of a degenerate boundary — the 2026-07-30 starvation cascade produced exactly this and was found only because a user saw a collapsed segment. No warning, no counter, no entry. | Verified by reading all five sites | **Low** | None |
| **R3** | 6→7 | **Presentation is freshly rebuilt with shallow mileage.** Absolute positioning, lane redesign, cross-lane boundary markers, and the border-as-overlay WebKit workaround all landed 2026-07-31. `Timeline.tsx` has **no test file**. Its correctness now depends on Key Invariant (f), which the fallback `retileCoveredSegments` path does not enforce. **Split for scheduling: test-debt half CLOSED (`7e6309f`); contract half (log-truthfulness / `retileCoveredSegments` contiguity write) remains open — deferred to Pair 6 as planned.** | Verified: `timelineLayout.ts`/`timelineLayout.test.ts`/`timeline.render.test.tsx` land in `7e6309f`; `retileCoveredSegments` (`App.tsx:836-849`) still has no contiguity write | **Low** | Visual only |
| **R4** | 5→6 | **Two `MIN_SEGMENT_DURATION` constants.** `0.1` in `snapBoundaries.ts:230`, `0.3` in `App.tsx:278`. Same name, different values, different purposes (pipeline floor vs. timeline slot width), no cross-reference. A future edit to one will look like it fixed both. | Verified by reading both | **Medium** (both are individually correct today) | None |
| **R5** | 1→2 | **Token ordering never asserted.** `fillsTokenGapWithinSpan` walks `j → j+1` assuming ascending time; `earliestClaimStartSec` exists precisely because list order ≠ time order elsewhere. Nothing checks that the filtered array is ascending. | Verified | **Medium** | None |
| **R6** | 3→4 | **Forward-ordering bound is vacuous when no later segment has a true global match.** `computeForwardBoundStartSec` returns `undefined` and every claim is accepted. A project ending in a long tail of zero-match segments has no bound on any of their rescues. | Verified at `whisperService.ts:905-911`; the legitimate last-segment case is tested, the tail case is not | **Medium** | None |
| **R7** | 4→5 | **The "same filtered array" coupling is convention-only.** `keptAlignments[i].firstTokenIdx` indexes `aligned.tokens`. Passing `project.transcriptTokens` instead produces wrong boundaries with no crash. One call site is correct today; nothing prevents a second. | Verified at `App.tsx:2524-2531` | **Medium** | None |
| **R8** | 4→5 | **Silence-array identity coupling.** `snapCoveredBoundaries` and the ported gap-fill both key a `Map` on `SilenceInterval` **object identity**. Any `.map()` copy upstream silently breaks contention assignment (every silence becomes its own key). | Verified at `snapBoundaries.ts:582-601` | **Medium** | None |
| **R9** | 5→6 | **Degenerate-pair skip and monotonic clamp are DEV-gated console warnings.** Both fire on exactly the corrupted-data shape that caused the 2026-07-31 phantom-segment incident. In a production build they are invisible. | Verified: `import.meta.env.DEV` guards at `snapBoundaries.ts:638` and `:684` | **Low** | None in production |
| **R10** | 3→4 | **Run-survival thresholds calibrated against two projects.** `RUN_SURVIVAL_*` were recalibrated once already after the first (ratio-scaled) formulation miscalibrated on a real 174-segment project. `syncConstants.ts` itself documents an accepted phantom-match risk on the new 1–3-word band. | Verified in `syncConstants.ts`'s own header | **Medium** | Skip entries show `longest run N` (good), but nothing aggregates across runs |
| **R11** | 1→2 | **RESOLVED WITH CORRECTIONS (was: staging-path failures never reach the log).** The fresh-transcription path (`useWhisper.ts`) now mints/reuses `jobId` as its `syncRunId` and appends summary-less silence/malformed-token/contract-violation entries via `appendSyncLogEntries` (`services/syncLog.ts`) on the live path. **Corrections to this row's original plan:** (1) the "Option A branch" mentioned as needing a fresh UUID was proven statically unreachable and was DELETED, not wired — there is no second branch to mint an id for; (2) `SyncLogPanel.tsx` does **not** group entries by `syncRunId` — it renders a flat, reverse-chronological list with zero references to that field, so this fix's practical effect is that staging-path findings now appear in that list at all, not that they render in a grouped view; (3) the `syncLog.ts` extraction (moving `makeSyncLogEntry`/`appendSyncLogEntries`/etc. out of `App.tsx`) was a **prerequisite** this row's original plan didn't mention — `useWhisper.ts` cannot import from `App.tsx` without a circular dependency. | Verified at `useWhisper.ts`'s staging path and `services/syncLog.ts`; `SyncLogPanel.tsx` read end-to-end, confirmed no `syncRunId` reference | **Medium → Low** | Full log entries (severity + fix hint), same as the Apply Sync path |
| **R12** | 2→3 | **No cost bound on the `O(n·m)` DP.** `__ALIGN_INSTRUMENT__` exists but is dormant. A pathological scene doc has no guard and no warning; the UI shows the blocking `SyncLoadingOverlay` with no indication anything is wrong. | Verified | **Medium** | None |
| **R13** | 4→5 | **`kept` ordering unasserted in `snapCoveredBoundaries`.** `retileCoveredSegments` sorts defensively; `snapCoveredBoundaries` does not. Out-of-order input would make the monotonic check fire on every pair, silently collapsing the timeline to floors. | Verified | **Medium** | None (would present as R2) |
| **R14** | 6→7 | **Discarded stale alignments are silent no-ops.** `segmentSetStillValid` fails → `console.warn` + `return` (`useWhisper.ts:203`, `:304`). The user sees a sync that appears to have done nothing. | Verified | **Medium** | Console only |

### Cross-cutting

- **The 5/6 interleave (§1.2) is undocumented outside this file.** Anyone reading `CLAUDE.md`'s
  file map would reasonably conclude snapping happens once. It happens twice, on different arrays,
  with different sentinel guarantees.
- **Console-only failure inventory** (the §4 "no silent warn survives" target list), verified by
  grep across `whisperService.ts` / `snapBoundaries.ts` / `syncEngine.ts` / `useWhisper.ts` /
  `silenceDetector.ts` / the sync region of `App.tsx`:
  `syncEngine.ts:200` (anchor out of order) ·
  `snapBoundaries.ts:639` (degenerate pair, DEV) ·
  `snapBoundaries.ts:685` (monotonic clamp, DEV) ·
  `useWhisper.ts:77` + `:273` (silence failure — logged on the Apply Sync path only) ·
  `useWhisper.ts:86` + `:280` (malformed drops — logged on the Apply Sync path only) ·
  `useWhisper.ts:204` + `:307` (discarded stale alignment) ·
  `useWhisper.ts:248` (zero tokens) ·
  `App.tsx:398` + `:425` (ambiguous tag → multiple/word matches) ·
  `App.tsx:522` (one asset assigned to several segments).
  Plus the **fully silent** sites, which produce no console output at all: the five floor clamps
  (R2 — `snapBoundaries.ts:699`, `:717`, `whisperService.ts:1612`, `syncEngine.ts:239`, `:246`),
  `App.tsx:846` (degenerate retile keeps the original duration), `App.tsx:453` (fabricated
  no-voiceover duration, contract 0→2), and `App.tsx:478` (a video clip silently slowed to fill
  its slot, contract 0→2).
- **This inventory is frozen as of `8d83358`.** It is the work-down list; the §3 hybrid-state law
  is what prevents it from growing while the program runs. If an entry is added here mid-program,
  that is a law violation and should be treated as a regression, not as a discovery.

---

## 6. Execution Order + Exit Criteria

### 6.0 Prerequisite (NOT a contract pair) — Timeline smoke tests

**DONE (`7e6309f`, 2026-08-01).** 1165 → 1199 tests (34 new). Extracted pure layout math into
`src/services/timelineLayout.ts` — segment/heading/marker positions, zoom pps, seek time, trim
drag, waveform tile specs, duration-bar clamp, drop-gap resolution, plus `computeTotalDuration`
(re-exported in place). Pinned with `timelineLayout.test.ts` (pure geometry) and
`timeline.render.test.tsx` (static markup). Zero behavior change — manually verified in the dev
app: segment positions, zoom, seek, trim drag, boundary markers, waveform tiling, and
segments-panel layout all identical to pre-refactor.

Accepted limitation: the render test only exercises the static-markup / 800px zoom-fallback path
— it does not drive the `ResizeObserver`-measured-width path, and it does not cover WebKit
compositing/stacking, hover transitions, or drag feel. Those stay manual-only; see §6.0 audit note
below.

**Do this first, before Pair 1, and do not couple it to the contract program.**

R3 is the freshest code in the pipeline (absolute positioning, lane redesign, cross-lane boundary
markers, the border-as-overlay WebKit workaround — all landed 2026-07-31) and it has **zero**
automated coverage. Pipeline order legitimately places contract 6→7 last; leaving
`Timeline.tsx` untested for the duration of five pairs is a separate and unjustifiable risk. The
resolution is to recognise what R3 actually is: **test debt, not a contract gap.** It needs no
contract, no validator, and no producer analysis — it needs tests that should already exist.

Immediate scope, decoupled and shippable on its own:

- `computeTotalDuration` — max-right-edge vs. duration-sum fallback, empty array, single segment,
  a deliberately non-contiguous array (the two formulas diverge — that divergence is the reason
  the function exists and nothing pins it today).
- **Absolute positioning math** — `left = startTime * pixelsPerSecond`,
  `width = duration * pixelsPerSecond` for a known segment array at a known zoom; the assertion
  that card position is a function of the card's *own* `startTime`, not of prior siblings.
- **Boundary-marker alignment** — one marker per interior boundary (`segments.slice(1)`), each at
  `startTime * pixelsPerSecond`, index 0 skipped so the lane border isn't doubled.

Extraction may be required to test this without a DOM harness (this repo has no
jsdom/testing-library — the same gap `usePlayback.test.ts` and `useGlPreview.test.ts` already
document). Prefer pulling the pure geometry into exported module-level functions and testing those
directly, which is exactly the precedent `computeTotalDuration` already sets by being module-level
and pure.

This work does **not** satisfy any part of contract 6→7 and does not let Pair 6 start early. It
removes the "newest code, zero tests" exposure while the program runs. R3's *contract* portion —
the "every meaningful failure produced a log entry" assumption, and the `retileCoveredSegments`
path's missing contiguity guarantee — stays in Pair 6.

### 6.1 Order

Pairs are audited in **pipeline order**: 1→2, 2→3, 3→4, 4→5, 5→6, 6→7. Not by risk score.
(Contract 0→2 is an annex audited inside Pair 1 — see §2 — not a separate pair.)

The reason is causal, not procedural: a violation at 1→2 manifests as a symptom at 5→6. Auditing
5→6 first means auditing a stage whose inputs are still unverified, which is how you end up
tuning a threshold to compensate for an upstream defect — precisely what happened with
`BOUNDARY_SILENCE_INTRUSION_TOLERANCE_SEC` (a timestamp tolerance introduced to compensate for
breath discrimination the alignment layer should have provided, later deleted wholesale).

Two consequences of pipeline order worth stating up front:

- The highest-confidence-of-defect item (R2, the silent floor clamps) sits in the **second-to-last**
  pair. That is deliberate, and it means the program's most visible payoff comes late. Do not
  reorder to get it earlier — reordering trades a late payoff for the exact failure mode described
  above.
- R3's *exposure* is removed up front by §6.0 rather than by reordering, which is what lets
  pipeline order stand without leaving untested new code in production for the whole program.

### 6.2 Exit criteria — per pair

A pair is **DONE** when all five hold:

1. **Contract written** — producer guarantees and consumer assumptions enumerated in this file,
   every assumption traced to the line that relies on it, and every unenforced one either closed
   or explicitly moved to §7 with a reason.
2. **Validator implemented** — one pure function, zero behavior change (deleting every call site
   leaves the pipeline byte-identical), directly unit-tested with hand-written inputs, wired into
   the orchestrator's existing log-staging.
3. **Injection tests green** — one deliberate-violation test per rule asserting the violation,
   its severity, and a non-empty fix hint; plus a clean-case zero-violations test; plus a
   no-behavior-change test.
4. **Zero known gaps** — no `⚠️ UNVALIDATED` or `❌ FALSE` row remains for this pair in §2, and no
   console-only failure from the §5 inventory remains in this pair's stages.
5. **Docs updated** — `CLAUDE.md` gains the new invariants and the validator's file entry;
   `project-state.md` records the pair as closed; `docs/history.md` gets the implementation
   record; this file's §2 row set is marked DONE with the date.

Additionally, at every pair: `tsc --noEmit` clean and the full `vitest` suite green (1165 at
baseline, monotonically increasing), and the **§6.3 measurements recorded for that pair**.

### 6.3 Measurement — how "done" is demonstrated, not asserted

The criteria above are structural: they say what was *built*. This section says how we show it
**works**. Three measurements, each with a stated denominator, because an unqualified percentage
is not a target.

#### (a) Injection coverage — per contract, per pair

The primary quantitative gate. For each contract:

```
  rules_implemented   = number of distinct `rule` ids the validator can emit
  injection_tests     = number of tests that deliberately violate exactly one rule
                        and assert (violation fired) ∧ (correct severity) ∧ (fixHint non-empty)
  REQUIRED:  injection_tests == rules_implemented      (1:1, no exceptions)
  REQUIRED:  1 clean-case test asserting zero violations
  REQUIRED:  1 no-behavior-change test (§3 Step 3: output segments/timing identical
             with and without the validator; log entries excluded from that comparison)
```

Minimum rule counts, derived from the `⚠️ UNVALIDATED` / `❌ FALSE` rows already in §2. These are
**floors, not targets** — an audit that finds more gaps raises the number, and finding more is
success, not scope creep:

| Contract | Gap rows in §2 today | Minimum rules | Notes |
|---|---|---|---|
| 0→2 (annex, in Pair 1) | 4 actionable (1 deferred) | 4 | synthetic duration, speed compression, ambiguous tag, duplicate asset |
| 1→2 | 4 | 4 | + drop-clustering (R1) is a 5th rule with no §2 row — it is a new check, not a gap closure |
| 2→3 | 3 | 3 | incl. the `segRanges` partition assertion |
| 3→4 | 3 | 3 | incl. the vacuous-forward-bound case (R6) |
| 4→5 | 4 | 4 | incl. token-array identity (R7), silence identity (R8) |
| 5→6 | 4 | 4 | incl. all five floor sites as one `duration-floored` rule with a per-site `detail` |
| 6→7 | 4 | 4 | incl. ordering, and contiguity-on-the-retile-path |
| **Total** | **26** | **26** | ⇒ **≥26 injection tests**, plus 7 clean-case + 7 no-behavior-change = **≥40 new tests** |

Recorded per pair in this document as `rules: N · injection: N · clean: 1 · nbc: 1`.

#### (b) Real-project verification protocol

Validators prove that a *rule* fires. They do not prove the pipeline is correct. That needs real
audio against real scene docs.

**Corpus** — the projects already named in the record as having produced or pinned real defects,
because a corpus of clean projects measures nothing:

| Project | Why it's in the corpus | Source |
|---|---|---|
| 174-segment production project | Bug C run-survival calibration; 16 skips, 15 of them wrong | `syncConstants.ts` RUN_SURVIVAL header |
| 173/174-segment project | Window-overlap regression bisect (vs. `0c83a06`) | `snapBoundaries.ts` REGRESSION FIX note |
| 294-segment project | Contention/starvation cascade (segments 249–251) | `snapBoundaries.ts` SILENCE CLAIMING RULE |
| The rescue-false-positive project | ~206s phantom first segment | `docs/history.md`, 2026-07-31 |
| The ~8.6% token-drop project (169/1973) | R1's evidence | `USER-REPORTED` |
| ≥1 clean project | Regression control — must stay silent | any passing project |

**Pass criteria per project, per pair** — all four must hold:

1. **Zero ERROR violations** on a project that produced a correct timeline before the pair's
   changes. An ERROR on known-good input is a false positive and blocks the pair (§3 noise policy:
   downgrade to INFO and record, or prove the rule wrong).
2. **Timing unchanged.** Committed `startTime`/`duration` for every segment is byte-identical to
   the pre-pair run on the same inputs. This is the no-behavior-change guarantee measured on real
   data rather than fixtures. Any diff blocks the pair until explained.
3. **The known defect is now named.** For each project whose defect the pair's contract covers, the
   log must contain a WARNING or ERROR that identifies it — e.g. the 294-segment project's
   starved boundary should surface as a `duration-floored` WARNING at the right segment index, not
   as a collapsed card the user notices.
4. **No new console-only output** appears during the run (§3 hybrid-state law), checked by reading
   the devtools console for the full run.

Recorded per pair as a 6-row table: project · ERROR count · timing diff (must be 0) · defect named
(Y/N/NA) · console-only lines (must be 0).

#### (c) The ">99%" target — pinned denominator

The program's headline goal is stated as ">99%". That number is meaningless without a denominator,
so this is the definition it is measured against, and it is **two** numbers, not one:

> **(c1) Contract compliance: >99% of stage handoffs across the verification corpus emit zero
> ERROR violations.**
> Denominator = (number of handoffs evaluated) × (number of corpus runs). With 7 contracts and 6
> corpus projects that is 42 handoff-evaluations per full pass; >99% means **at most 0 ERRORs**
> in a pass (0.4 expected failures at 99% ⇒ any single ERROR fails the target). The target is
> therefore effectively *zero unexplained ERRORs*, which is the honest reading and should be
> stated that way rather than hiding behind a percentage.
>
> **(c2) Explained-failure rate: 100% of emitted WARNINGs and ERRORs are diagnosable from the log
> alone.**
> Denominator = every WARNING/ERROR emitted across the corpus. "Diagnosable" = criterion (c3)
> below returns PASS. This is the goal that actually matters — the §0 incidents were not detection
> failures, they were *explanation* failures.

**Baseline caveat, stated plainly:** (c1) cannot be measured before validators exist — you cannot
count violations you have no detector for. The first pair's measurement is therefore a *baseline*,
not a score, and the ">99%" gate only becomes meaningful from the pair where the corpus is first
run end to end. Do not report a pre-validator compliance number; there isn't one.

#### (c3) "A non-developer can read the log" — checkable rubric

Replaces the unfalsifiable version of this criterion. Take one full sync log from a corpus project
that produced at least one WARNING and at least one ERROR. A reviewer who has **not** worked on
the sync pipeline reads it with no console, no debugger, and no source access, and answers:

| # | Question | PASS requires |
|---|---|---|
| 1 | What did this run do? | Identifies segment counts committed vs. skipped, from the log alone |
| 2 | Did anything go wrong? | Correctly separates INFO from WARNING/ERROR without asking what the badges mean |
| 3 | For each WARNING/ERROR: what happened? | Restates the problem in their own words, correctly |
| 4 | For each WARNING/ERROR: what should you do? | Names the action from the fix hint, without guessing |
| 5 | Which part of *your project* is affected? | Names the segment number / time range / asset — not a file or function |
| 6 | Is anything here jargon you can't act on? | **Zero** instances of internal vocabulary (`anchorStart`, `Hirschberg`, `firstTokenIdx`, `occ`, `prevBoundary`, `globallyClaimed`, `longestRun` unglossed) in any WARNING/ERROR *message* or *hint*. Such terms may appear in `detail` only |

**PASS = all six.** Any FAIL identifies the specific entry, and that entry's message or hint is
rewritten before the program can be declared done. Run this once at program close, and once per
pair for the entries that pair introduced (the per-pair run may use the pair's own injection-test
fixtures rather than a full corpus run).

### 6.4 Exit criteria — program

The program is **DONE** when:

- §6.0's Timeline smoke tests are landed (prerequisite; not a pair).
- All six pairs meet the §6.2 criteria, with §6.3(a) and §6.3(b) recorded for each.
- The log panel surfaces all three severities with the visual treatment in §4, and every WARNING
  and ERROR carries a fix hint.
- The §5 console-only inventory is empty — every entry either became a log entry or was deleted
  as proven-unreachable by an audit — and the §3 hybrid-state law has held (no new console-only
  failure introduced during the program).
- §6.3(c1) holds on a full corpus pass: **zero unexplained ERRORs**.
- §6.3(c2)/(c3): the rubric returns PASS on all six questions.

### 6.5 Suggested sequencing note

§6.0 (Timeline smoke tests) is small, independent, and unblocks nothing — do it first anyway, so
the newest untested code stops being untested while everything else proceeds.

Pair 1 is the heaviest of the "early" pairs despite looking additive: it carries the 0→2 annex,
the R11 staging-run-id mechanism, and the R1 drop-clustering rule, and it is where the
`syncContracts.ts` module, the severity/`fixHint` fields, and the panel's severity rendering are
first built. Budget accordingly; everything after it reuses that scaffolding.

2→3 is genuinely light. 3→4 and 4→5 are where the interesting assumption gaps live (R6, R7, R8,
R10). 5→6 is where the silent-degradation work is (R2, R4, R9, R13). 6→7 is the contract portion
of R3 plus whatever §6.0 didn't cover.

Do not use "it should be fast" as a reason to skip the audit step on the early pairs — the audit
is the deliverable, the validator is just its executable form.

---

## 7. Out of Scope — Explicit

These are **not** part of this program. Anything below that turns out to be a real problem gets
written up and scheduled separately; it does not get folded into a hardening pass.

**No behavior changes to alignment or snapping math.**

- The Hirschberg scoring recurrence, the constants `ALIGN_MATCH_SCORE`/`ALIGN_MISMATCH_SCORE`/
  `ALIGN_GAP_SCORE`, the free-end-gap model, and the temporal-bonus shape are frozen.
- Rescue Pass 1/2/3 semantics, the forward-ordering bound's rule, and the adopt-or-discard rule
  are frozen.
- `RUN_SURVIVAL_*`, `BREATH_*`, `TOKEN_GAP_EPSILON_SEC`, `TEMPORAL_*`, `LOW_CONFIDENCE_RATIO`,
  `MIN_COVERED_RUN_LENGTH`, `NOISE_FLOOR_COVERAGE` are frozen. **Threshold retuning is explicitly
  not a hardening activity** — every one of these carries a documented calibration story in
  `syncConstants.ts`, and retuning without the production evidence that produced them is how the
  window-overlap regression happened.
- The three candidacy predicates and their evaluation order are frozen.
- The degenerate-pair guard's threshold and the monotonic re-check's clamp behaviour are frozen.
- Adding a validator that *reports* a boundary looks wrong is in scope. Changing where the
  boundary lands is not.

**No new features.**

- No new sync capabilities, no new UI surfaces beyond the log-panel severity upgrade in §4, no new
  entry types beyond what a contract violation needs.
- The severity/fix-hint upgrade is in scope because it is the *delivery mechanism* for contract
  violations — without it, a validator has nowhere to report to.

**Performance work only if an audit proves a problem.**

- R12 (no cost bound on the DP) is in scope **as a measurement and a warning**, not as an
  optimisation. If the audit measures a real production project exceeding a budget, the
  optimisation is a separate, separately-justified task.
- Do not optimise `filterMalformedTokens`, the token-word expansion, the predicate filters, or the
  three-pass snap on suspicion. `__ALIGN_INSTRUMENT__` exists; use it to produce a number before
  proposing a change.

**Explicitly deferred, with reasons:**

- **The `parseProjectData` mid-line bracket split (R5/N4)** — contract 0→2, consumer assumption 1.
  A parser/product-ruling question: it needs an annotation vocabulary or a decision on the
  authoritative input format, not a contract. No validator can help — the two structurally
  identical cases ("… segment 2 [team] Our team …", which must split, and "Line one [laughs]
  continues here", which must not) cannot be told apart by any positional rule, so a checker would
  have to encode the very ruling that doesn't exist yet. Accepted as-is by user decision
  2026-07-29 and pinned by `sceneTagParsing.test.ts`'s `// DEFECT:` markers. See `CLAUDE.md` →
  `App.tsx`.
- **Everything upstream of contract 0→2** — file staging, ZIP extraction, IndexedDB asset
  persistence, project load/save. Real failure surfaces, but they are storage/intake concerns with
  their own error paths, not sync-pipeline handoffs. The sync program's boundary is the point
  where user data enters `parseProjectData` / `transcribeWithProgress`.
- **Unifying `alignScenestoTranscript`'s gap-fill with `snapCoveredBoundaries`.** Parity holds and
  is test-pinned; the two remaining differences (degenerate-pair guard, monotonic re-check) are
  deliberate defense-in-depth. Merging them is a refactor, not a hardening step.
- **The 5/6 interleave itself.** Collapsing the two snap passes into one would be a large,
  behaviour-affecting restructure. This program documents the interleave; it does not remove it.
- **Multi-language / model changes.** Bundled model is English-only; see `project-state.md`
  Deferred Polish Features.

---

## Appendix A — Evidence Index

Test files that carry sync-pipeline evidence, and which contracts they bear on.

| File | Bears on | Notes |
|---|---|---|
| `services/syncTiming.test.ts` | 1→2 … 5→6 | The primary lock. `project-state.md` Key Invariant (a). 231 `it()` blocks (measured). |
| `services/sceneTagParsing.test.ts` | 2→3 | Pins `parseProjectData`, incl. the documented R5/N4 defect. |
| `services/textNormalize.test.ts` | 2→3 | The shared normalizer's own surface. |
| `services/silenceDetector.test.ts` | 1→2 | The `{status:'ok'\|'error'}` discrimination. |
| `services/syncLog.test.ts` | 6→7 | The pure log builders (note: `services/syncLog.ts` does not exist — the builders live in `App.tsx`). |
| `components/SyncLogPanel.test.tsx` | 6→7 | Panel rendering + backward compatibility. |
| `services/lockedOverlap.test.ts` | 5→6 | Lock-related overlap behaviour. |
| **(missing)** `components/Timeline.test.tsx` | 6→7 | **Does not exist.** Risk R3. |

## Appendix B — Constants Index

Every tuning constant the pipeline reads, and where its derivation is written down. All are frozen
for the duration of this program (§7).

| Constant | Value | Home | Stage |
|---|---|---|---|
| `ALIGN_MATCH_SCORE` / `MISMATCH` / `GAP` | +1 / −1 / −1 | `syncConstants.ts:37-39` | ③ |
| `LOW_CONFIDENCE_RATIO` | 0.4 | `:92` | ④ (coverage classification only) |
| `MIN_COVERED_RUN_LENGTH` | 2 | `:109` | 4→5 gate |
| `NOISE_FLOOR_COVERAGE` | 0.1 | `:119` | 4→5 gate |
| `MAX_LOG_ENTRIES` / `MAX_SYNC_RUN_SUMMARIES` | 500 / 10 | `:137-138` | ⑦ |
| `TEMPORAL_TOLERANCE_RATIO` / `MIN_SEC` / `MAX_SEC` | 0.1 / 1.5 / 5.0 | `:152-154` | ④ (and ⑤'s degenerate threshold) |
| `TEMPORAL_BONUS_MAX` / `CENTRAL_FRACTION` | 0.3 / 0.5 | `:174-175` | ④ |
| `MALFORMED_TOKEN_DURATION_TOLERANCE_SEC` | 0.5 | `:184` | ② |
| `TOKEN_GAP_EPSILON_SEC` | 0.02 | `:215` | ⑤ |
| `BREATH_MAX_SPEECH_COVERAGE_RATIO` | 0.3 | `:273` | ⑤ |
| `BREATH_TOKEN_OVERLAP_FLOOR_SEC` | 0.09 | `:286` | ⑤ |
| `MAX_CONCAT_TOKENS` / `MAX_CONCAT_GAP_SEC` | 3 / 0.3 | `:297-298` | ④ |
| `RUN_SURVIVAL_MAX_HOLE` | 2 | `:323` | ④ |
| `RUN_SURVIVAL_MIN_RUN_SHORT` / `_LONG` | 2 / 4 | `:382-383` | ④ |
| `RUN_SURVIVAL_DENSITY_MIN_CONFIDENCE` / `MAX_MEDIAN_GAP` | 0.5 / 4 | `:407-408` | ④ |
| `DEGENERATE_PAIR_INVERSION_THRESHOLD_SEC` | = `TEMPORAL_TOLERANCE_MAX_SEC` (5.0) | `snapBoundaries.ts:250` | ⑤ |
| `MIN_SEGMENT_DURATION` | 0.1 | `snapBoundaries.ts:230` | ⑤/⑥ |
| `MIN_SEGMENT_DURATION` | **0.3** | `App.tsx:278` | UI — **name collision, Risk R4** |
| silence defaults (`thresholdDb` / `minDurationSec` / `frameSizeMs`) | −45dB / 0.25s / 20ms | `silenceDetector.ts:45-47` | ① |
| `SYNC_LOG_TEXT_PREVIEW_CHARS` | 80 | `App.tsx:866` | ⑦ |
