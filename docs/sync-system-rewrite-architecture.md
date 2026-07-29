# Sync System Rewrite — Target Architecture

> **Status: FINAL DESIGN — implementation-ready. Round 4 rulings applied 2026-07-25.** Written from a two-pass code audit plus final user decisions on every open question. Round 2 surfaced 10 open questions (OQ1–OQ10) and 3 reviewer findings (M1–M3); Round 3 surfaced 4 new questions (N1–N4); Round 4 replaced the partial-coverage design outright with **skip-unmatched** (R4-1…R4-5, Section 10). All rulings are LOCKED and folded into the sections below as final design. Nothing here is committed work; `project-state.md`'s Decisions Log entries are written only AFTER the rewrite lands and is hardware-verified (see Section 9).
>
> Ruling principle (user's words): *"industry level work, best, permanent, long term fix even if it takes more work or time."*
>
> Scope: the sync system only (scene doc + voiceover script + audio → timed timeline segments). Round 4 removed this rewrite's only two out-of-sync-system changes — the export-mux audio padding (Section 3.14) and the preview fallback clock (Section 3.15) — because nothing extends the timeline past the audio anymore; both sections are retained below marked SUPERSEDED. Not a general architecture doc — see `CLAUDE.md` for the rest of the app.

---

## 1. Executive Summary

The sync system takes a scene doc, a voiceover script, and an audio file, and produces a timed timeline. Today it produces a *plausible-looking* timeline for **any** combination of inputs — including a voiceover that has nothing to do with the scene doc — because its word matcher is a greedy positional scanner with only local, per-segment guards and no global measure of whether the two texts correspond at all. This rewrite replaces the matcher with an industry-standard token-level diff aligner (Needleman-Wunsch scoring with Hirschberg linear-space traceback, explicit insertions/deletions), adds a two-signal abort gate (contiguous covered-run check + bidirectional noise floor) for mismatched inputs, defines exact semantics for audio that covers only part of the scene doc (**Round 4: uncovered segments are skipped, not timed by any fallback**), and closes a set of confirmed hardening gaps (silent failures, malformed timestamps, hardcoded English, stage directions matched as spoken words).

**The one-line behavioral contract (Round 4, R4-1/R4-2):** *Audio is the source of truth. A segment either appears on the timeline at its Whisper-anchored time or it does not appear at all; mismatched inputs hard-abort with a clear message.*

---

### Implementation Status

**WS1a — Hirschberg aligner + unified normalizer: COMPLETE and verified on macOS Intel x86_64.**

- **What landed:** the Hirschberg diff aligner (O(n+m) space, free end-gaps on the subject side, per-segment confidence extraction — Section 3.1/3.1.1), the unified normalizer in `src/services/textNormalize.ts` (NFC, ZW-join, the R1 hyphen carve-out with `NUMBER_WORDS` — Section 3.2), and `src/services/syncConstants.ts` (scoring constants, `NUMBER_WORDS`, `LOW_CONFIDENCE_RATIO`). 23 existing sync tests were re-baselined and 14 new WS1a cases added — **768/768 passing**.
- **Bugs fixed by WS1a:** B2, S1, S2, S3, S4, S5, G3, G4 (Section 2.2/2.3) — confirmed against the synthetic special-chars fixture and the 294-segment project.
- **Bugs NOT fixed by WS1a:** the s2-on-"lot" visual offset is correctly attributed to Whisper timestamp accuracy, not the aligner — see the re-attribution note in Section 3.6 and QB3 below. B1 (the abort gate) is WS1b. S6–S8, S10, S13–S21 remain later workstreams, per the file-by-file plan in Section 5.
- **Cross-platform validation gap:** verified on macOS Intel x86_64 only. macOS arm64 and Windows/WebView2 remain unverified until hardware is available — the project's standing pattern (see `project-state.md`'s Decisions Log for prior instances of this same gap).
- **Static checks:** `tsc --noEmit` clean, `vitest run` 768/768. Manual verification on real fixtures confirmed the aligner and normalizer behave correctly. The s2-on-"lot" visual offset is **not** a WS1a defect — see the re-attribution note below and QB3.

See the "Quick Bugs to Fix" section (after Section 10) for the 3 bugs surfaced during WS1a's manual verification pass — queued, not fixed, in this workstream.

**WS1b — Coverage metric + R13 abort gate + R12 removal (skip-unmatched) + snap clamps + parser fix + re-tile: COMPLETE and verified on macOS Intel x86_64.**

- **What landed:** Bidirectional coverage metric (scene-doc + transcript coverage, bidirectional = min). R13 two-signal abort gate (contiguous covered run ≥ 2 AND bidirectional ≥ 0.1). R12 middle-gap abort REMOVED — unmatched segments are skipped, not aborted. Snap clamps (±150ms tolerance, R4). Parser fix (TAG_REGEX inline-text extraction bug — tags with digits + inline descriptions now parse correctly). Re-tile after skip (covered segments tile contiguously, last extends to audio end). Empty-input aborts. 826/826 tests pass.
- **Bugs fixed by WS1b:** B1 (cross-script mismatch aborts), S15 (empty-input toasts), S21 (snap clamps), and the parser bug (inline-text extraction).
- **Bugs NOT fixed by WS1b:** S6, S7, S8, S10, S13, S14, S16-S20 (later workstreams); the s2-on-"lot" playback offset (project-specific, deferred).
- **Verification:** macOS Intel x86_64 only. macOS arm64 + Windows/WebView2 unverified.

**WS-logs + Bug 1 + Bug 2 + tag/match-count + position-offset + silence-sharing fix: COMPLETE and verified on macOS Intel x86_64.**

- **What landed:**
  - **WS-logs:** Persistent sync-log panel in the right panel. `SyncLogEntry`/`SyncRunSummary` types on `Project` (additive, optional, backward-compatible). Persists via existing `projectStore` IndexedDB save. Capped at 500 entries / 10 run summaries. UI: collapsible section below Text Layers, newest-first, color-coded (skip=yellow, abort=red, warning=orange, info=gray), clear-log with confirmation. Survives app close/reopen.
  - **Bug 1 fix:** Info entry now ALWAYS fires on successful sync (was only on 0-skip syncs). Message: "Sync completed: X of Y segments matched. Z skipped." (Z omitted when 0).
  - **Bug 2 fix:** `filterToCoveredSegments` keeps segments where `matched === true` (was `covered === true`, i.e. `matched && confidence >= 0.4`). Matched-but-low-confidence segments no longer skipped. R13 gate unchanged (still uses `covered` for contiguous-run). "low confidence" skip reason removed; only "no audio match" remains. Fixes segment 135 regression.
  - **Tag + match-count display:** `VideoSegment.tag` field added. `SkippedSegmentRecord`/`SyncLogEntry` extended with `segmentTag`/`matchedWords`/`totalWords`/`confidence`. Skip entries render 3-line format: "Segment N skipped — reason" / "[tag] text" / "matched X of Y words (confidence Z)". Backward compatible.
  - **Position-offset fix:** New `src/services/snapBoundaries.ts` with `snapCoveredBoundaries`. Snap runs AFTER filtering on the covered-only array, so every snap pair has two matched segments with real spoken-word ends. Replaces `retileCoveredSegments` on primary path (retile kept as fallback). Fixes ~0.13s drift on covered segments adjacent to skipped ones.
  - **Silence-sharing fix:** snap clamps removed entirely as dead code (the silence-found branch trusts the silence center; the no-silence branch uses the token midpoint, which inherently lies within the spoken-word range). Monotonic check still applies in both cases. Fixes the silence-sharing regression on the 14-segment project where clamps were pulling boundaries away from silence centers.
- **Bugs fixed:** WS-logs info-entry-missing (Bug 1), matched-but-low-confidence skip regression (Bug 2), middle-gap position offset, silence-sharing regression.
- **Verification:** macOS Intel x86_64 only. macOS arm64 + Windows/WebView2 unverified.

**WS4 (partial) — stage-direction stripping (13a) + silence fail-loud (11a) + malformed-token skip (14a): COMPLETE. Language handling (9a) BLOCKED, not implemented.**

- **What landed (2026-07-28, commit `<pending>`):**
  - **Decision 13a — stage-direction stripping (§3.8, alignment side only).** New `stripStageDirections` + `canonicalizeSceneDoc` in `src/services/textNormalize.ts`; `normalizeSceneDoc` wrapper in `whisperService.ts`, called from `extractSegmentAlignments`'s query build. Strips parentheticals anywhere, bracketed ALL-CAPS directives **not** at line start, `INT.`/`EXT.` sluglines and `FADE IN:`/`CUT TO:`/`DISSOLVE TO:` transition lines (whole line), and residual colons-only lines. Preserves line-start `[tag]` anchors, lowercase brackets, `*emphasis*`, hyphens and smart punctuation. Applied to the **scene-doc side only** — the transcript side never contains directions. `seg.text` is never mutated; only the alignment view is stripped. Empty-result fallback per §3.8(b): if stripping empties a segment, its original text is used.
  - **Decision 11a — silence fail-loud (§3.10).** `detectSilences` now returns a `SilenceDetectResult` discriminated union (`{status:'ok', silences}` | `{status:'error', errorMessage}`) and never throws; `useWhisper.ts`'s `fetchAndDetectSilences` lost its bare `catch { return []; }`. A failure surfaces as a `'silence-error'` `SyncLogEntry` (red) and increments `SyncRunSummary.silenceErrorCount`; sync **continues** on token-midpoint boundaries rather than aborting.
  - **Decision 14a — malformed-token skip (§3.12).** New `filterMalformedTokens` in `whisperService.ts`, run once before alignment. Drops tokens with non-finite timestamps, `t0 < 0`, `t0 >= t1`, `t1 > audioDuration + MALFORMED_TOKEN_DURATION_TOLERANCE_SEC` (0.5s, new in `syncConstants.ts`), or text that normalizes to nothing. Emits a `'malformed-token'` entry (info/blue) when the count is non-zero. The **filtered** array is threaded back through `alignFromCache` and used by `App.tsx`'s `snapCoveredBoundaries` call — `AlignResult`'s token indices point into it, so using the raw array there would resolve to the wrong tokens.
- **Decision 9a — language detection: BLOCKED, deliberately not implemented.** §3.9's design requires the multilingual `ggml-base.bin`; only `ggml-base.en.bin` is provisioned, and whisper-cli confirms empirically (`main: WARNING: model is not multilingual, ignoring language and translation options`) that `-l auto` / `--detect-language` produce **no** detection output on an `.en` model. Implementing detection therefore needs the ~148MB second model bundled first (§3.9(b) item 1, the "+74MB accepted" cost). Deferred by explicit user decision on 2026-07-28 rather than shipped as unreachable code. `-l en` remains hardcoded at `whisper.rs:249`; no `lang-warn` entry kind exists yet.
- **Bugs fixed:** S19 (alignment-side portion), S16, S10.
- **Not in scope of this pass:** §3.8's **parser fix** (R5/N4 — anchoring `TAG_REGEX` to line start) was not requested and was not made; mid-line `[...]` still splits scene blocks at parse time. The alignment-side strip preserves line-start brackets specifically so it composes correctly with that parser change when it lands. §3.8's speaker-label rule (`NARRATOR:`) also not implemented.
- **Static checks:** `tsc --noEmit` clean, `vitest` **957/957** (was 885 — 72 new tests across `textNormalize.test.ts` (new file, 28), `silenceDetector.test.ts` (new file, 11), `syncTiming.test.ts` (+18), `syncLog.test.ts` (+10), `SyncLogPanel.test.tsx` (+5)).
- **Verification:** automated only. No manual run against the 294-segment / middle-gap / special-chars projects was performed in this pass — those fixtures are user project data, not in the repo, and require the Tauri desktop shell.

**WS5 — S3 verification + speaker-label stripping (13a extension) + R8 threshold lock: COMPLETE (automated verification only). R5/N4 parser fix: INVESTIGATED, deliberately NOT fixed.**

- **What landed (2026-07-29, commit `<pending>`):**
  - **Decision 13a extension, item A — speaker-label stripping (§3.8).** `stripStageDirections` (`textNormalize.ts`) now also drops a speaker label at the head of a line — `NARRATOR:`, `VOICE 2:`, `SPEAKER:` — via `SPEAKER_LABEL_RE`. Uppercase-only and case-sensitive, so lowercase prose (`note:`, `hint:`, `narrator:`) and mixed case (`Narrator:`) are untouched; a label needs 2+ characters before its colon, so a bare `A:` is left alone. Group 1 of the pattern preserves leading whitespace **and an optional line-start `[tag]` anchor**, so `[scene 1] NARRATOR: hello` → `[scene 1] hello`. Ordered inside the per-line pipeline **after** the bracket pass (so the anchor is already settled) and **before** the parenthetical pass (so `NARRATOR: (whispering) hello` → `hello`); whole-line transition rules still run first, so `CUT TO:` is dropped as a transition and never reaches the label pattern. Scene-doc side only, like the rest of the strip; `seg.text` is never mutated.
  - **R8 threshold pass (§3.3(c), §6.3) — run, and every value LOCKED unchanged.** `LOW_CONFIDENCE_RATIO` (0.4), `MIN_COVERED_RUN_LENGTH` (2) and `NOISE_FLOOR_COVERAGE` (0.1) keep their existing values; `syncConstants.ts` now carries a written justification for each plus the exact comparison semantics, and boundary fixtures pin them. No constant was a magic number needing extraction — all three were already named and centralized by WS1a.
- **S3 (near-match / stemming) — VERIFIED, and CLOSED WITHOUT ADDING STEMMING.** The optional prefix-credit scoring in §3.1 and the stemming layer contemplated for this workstream are **not needed and were not built**. Measured against the real aligner:
  - **Repeated phrases resolve by position, not first occurrence.** Scene doc containing a phrase twice with the audio saying it once: the audio-consistent (second) instance takes the match at confidence 1.0 and the genuinely-unspoken instance falls out as unmatched. The reverse case (audio says it twice, doc once) also holds order, showing up as reduced *transcript* coverage rather than an abort. Global Hirschberg alignment already gives S4/S3's repeat disambiguation for free.
  - **Inflection cannot push a segment under the coverage threshold.** Worst constructed case — a two-word segment with one word inflected (`"running fast"` vs. spoken `"runs fast"`, `"bigger than"` vs. `"big than"`) — lands at exactly **0.5**, above `LOW_CONFIDENCE_RATIO`. A realistic sentence with two inflected words lands at **0.71–0.75**. Even a fully-inflected segment stays `matched === true`, and since Bug 2 the timeline keeps on `matched`, not `covered` — so inflection can never cause a skip.
  - Adding stemming would therefore buy no measured behavior while introducing the mis-anchoring risk already flagged as open risk 12 (`"care"`/`"careful"`). Risk 12 is closed as moot: no prefix-credit constant was ever built, and none is now planned.
- **R5/N4 (parser line-anchoring) — INVESTIGATED, CONFIRMED STILL BROKEN, DELIBERATELY NOT FIXED (user decision, 2026-07-29).** Verified empirically: `TAG_REGEX = /(?=\[[^\]]*\])/` (`App.tsx:292`) still splits before **every** bracket anywhere in the document, so `[scene 1] Line one [laughs] continues here` parses to **two** segments, the phantom one claiming the rest of the sentence *and* an asset slot. WS1b did **not** close this — its parser work was inline-text *extraction*, never the split point.
  **Why the prescribed fix was not applied:** anchoring the split to line start contradicts the multi-tag one-paragraph case locked in by `sceneTagParsing.test.ts`'s "full repro scene doc" test, where six tags share a single line and must all anchor. The two cases are structurally identical — `"… segment 2 [team] Our team …"` must split, `"Line one [laughs] continues here"` must not — so **no purely positional rule separates them**. §3.8's parser-fix design (and §6.2 item 12, §6.4 item 9, open risk 10, Decisions Log item 8) assumed one tag per line and does not survive contact with the one-paragraph format. Resolving it needs either a non-speech-annotation vocabulary (`laughs`/`coughs`/`music`/`applause`) or a product ruling on which input format is authoritative — neither is a WS5 call.
  The defect is now **locked by regression tests** (`sceneTagParsing.test.ts`, "R5/N4 — mid-line brackets split blocks (known defect, locked)") asserting today's behavior with explicit `// DEFECT:` markers, plus a companion test proving `stripStageDirections('Hello [CUT TO: KITCHEN] world')` already returns `'Hello world'` — i.e. the alignment side is correct and **the split is the only wrong part**. When the fix lands it must change those assertions visibly rather than drift silently.
- **Static checks:** `tsc --noEmit` clean, `vitest` **1007/1007** (was 957 — 50 new tests: `textNormalize.test.ts` +20, `syncTiming.test.ts` +23, `sceneTagParsing.test.ts` +7).
- **Verification:** **automated only.** No manual run against the 294-segment, middle-gap, or speaker-label projects was performed in this pass — those fixtures are user project data, not in the repo, and require the Tauri desktop shell. The 294/294 and 8-of-10 figures cited in `syncConstants.ts`'s justifications are carried forward from the WS1b/WS-logs passes that measured them, not re-measured here.

**Snap-clamp dead-code removal (2026-07-26): COMPLETE and verified on macOS Intel x86_64.** `SNAP_TOLERANCE_SEC` clamps removed entirely from `whisperService.ts` and `snapBoundaries.ts` — once the silence-sharing fix made them conditional on `!silenceFound`, the no-silence branch's token midpoint could never actually be moved by them (it is inherently inside the tolerance window), so the clamps were dead code. `SNAP_TOLERANCE_SEC` constant removed from `syncConstants.ts`. Net behavior: silence-found → silence center (no clamp); no-silence → token midpoint (no clamp); monotonic check applies in both cases. See §3.6. 885/885 tests pass. **Verification:** macOS Intel x86_64 only (manual: 14-segment silence-sharing unchanged, 294-segment no regression).

**Token-stealing bug-class fix (2026-07-29, commit `86ffc5a`): DONE.** Per-segment temporal-bounding rescue layered on top of the unchanged global Hirschberg aligner — see §3.16 for the full design. Three-part fix: (1) per-segment temporal bounding (a rescue window around each zero-match segment's own `anchorStart`), (2) a temporal-proximity scoring bonus that breaks ties toward the temporally-correct occurrence of a repeated word, (3) a three-pass rescue (windowed Hirschberg + exact-text scan, then a global unclaimed-token exact-text scan for drifted anchors, then a sliding-window sub-word concatenation scan for Whisper's phoneme-split tokens). Every pass is `globallyClaimed`-exclusive — it can only add a match a segment is missing, never take one another segment's global pass legitimately has. 18 new tests (1025 → 1043); all pre-existing tests pass unchanged. `tsc --noEmit` clean. Manually verified by the user: the scene 152/153 repro is fixed (3/3 matched via the CONCAT fallback pass). Temporary `[s135-diag]`/`[rescue-trace]` production instrumentation fully removed (`grep -rn "s135-diag\|rescue-trace" src` returns zero); the permanent, DEV-gated `[align-recover]` log remains.

**WS6 (2026-07-29): DONE.** Sync rewrite closed. All workstreams WS1a through WS5 complete, plus the token-stealing fix (`86ffc5a`). Regression tag `sync-known-good-2026-07-29` marks the known-good baseline. No open sync items remain tracked (deferred items cleaned per user decision 2026-07-29; multi-language moved to Deferred Polish Features in `project-state.md`). This pass is docs-only — final consistency sweep across `project-state.md`, this file, `CLAUDE.md`, and `docs/history.md`; no source code changed.

---

## 2. Current State (the problem)

### 2.1 Pipeline as it exists today

```
INPUTS
  script text + scene doc text + audio file
    │
STAGING (App.tsx handleVoiceoverStaged ~1585-1677)
  ├─ resolveVoiceoverDuration (native ffmpeg probe)
  ├─ startTranscription(asset, duration, [], …) — segments:[] and a no-op
  │    onSegmentsUpdated (App.tsx:1660-1675): staging-time transcription only
  │    CACHES tokens on the project; it never commits segment timing itself
  └─ whisper.rs whisper_transcribe: ffmpeg pre-transcode → whisper-cli
       sidecar (`-ml 1 … -l en`, whisper.rs:244-251) → parse_stdout_tokens
       (whisper.rs:377-401) → TranscriptToken[] cached as
       project.transcriptTokens (useWhisper.ts:179-190)
    │
APPLY SYNC (App.tsx handleApplySyncFromFiles 1694-1871)
  ├─ read/strip text files, persist assets, resolve audio duration (1698-1781)
  ├─ parseProjectData(script, sceneDetails, assets, audioDuration)
  │    (App.tsx:271-486) — splits scene doc into blocks on bracket tags
  │    (TAG_REGEX, :279), matches tags to assets (exact → contiguous-word →
  │    contextual, :346-395), then distributes audioDuration across segments
  │    proportionally to CHARACTER COUNT (:408-461) — the "estimate" bootstrap.
  │    Each segment gets anchorStart + anchorSource:'estimate' (:443-444)
  ├─ cachedTokensReady? (App.tsx:1800-1804 — id or file-identity match)
  │    YES → applyAnchorBasedTiming → alignFromCache (useWhisper.ts:27-48):
  │           fetchAndDetectSilences → alignScenestoTranscript →
  │           distributeSegmentTimes → applyAnchorBasedTiming
  │    NO  → applyAnchorBasedTiming only (char-weight timing ships, with a
  │           console.warn — App.tsx:1815-1825)
  └─ setProject(...) — single atomic commit (App.tsx:1838-1850)

THE ALIGNER (whisperService.ts alignScenestoTranscript, 259-537)
  ├─ tokenize both sides via normalize → canonicalizeForAlignment (:153-211)
  ├─ per segment: greedy positional window scan from a monotonic cursor
  │    (searchStart), scoring exact word-equality at each offset (:331-341);
  │    search capped at maxStart (:323-329)
  ├─ per-segment confidence = matched/total (:346); overshoot guard (:361-370)
  │    and low-confidence cursor hold (:413-420) — LOCAL guards only
  ├─ Step 2: each unlocked segment's t1 := next segment's t0 (:440-444)
  ├─ silence gap-fill: move each boundary to the midpoint of the nearest
  │    detected silence (:452-512); backward-only sanity check (:506-508)
  └─ last segment clamped to WHISPER SPEECH END, tokens[last].endSec (:515-517)

TIMING FINALIZATION (syncEngine.ts applyAnchorBasedTiming, 170-246)
  └─ re-derives startTime/duration from anchors; monotonic backstop clamp
     (:211-219); last segment clamped to FILE DURATION (:239-243)

PREVIEW PLAYBACK (context for Section 3.15)
  └─ usePlayback.ts — voiceover path: rAF loop with the audio element as
     master clock (:58-105); on audio.ended it STOPS and RESETS to 0
     (:87-92); a separate wall-clock setInterval path exists only when NO
     voiceover is loaded (:110-127), advancing 0.1s × globalPlaybackSpeed
     per 100ms tick (:117)

EXPORT MUX (context for Section 3.14)
  ├─ legacy: exportPipeline.ts:264-274 — audio muxed with `-shortest` (:270)
  └─ WebCodecs: muxOnly.ts buildAudioMuxArgs (:129-144) — `-shortest` (:139),
       against a premuxed real-PTS intermediate (two-step, header :29-58)

ERROR HANDLING TODAY
  ├─ Apply Sync gating: applySyncDisabled (App.tsx:2177) only checks that A
  │    transcript exists for the staged file — never that it CORRESPONDS to
  │    the scene doc
  ├─ zero tokens → non-blocking 'warning' phase (useWhisper.ts:142-167)
  ├─ zero parsed segments → console.warn, silent return (App.tsx:1789-1793)
  ├─ silence-detection failure → empty catch, [] (useWhisper.ts:12-20)
  └─ alignment diagnostics → DEV-gated console.warn (whisperService.ts:362,414)
```

### 2.2 Confirmed bugs

User-reported:

| ID | Sev | Mechanism | Where |
|---|---|---|---|
| **B1** | Critical | No transcript↔scene-doc correspondence gate; any audio "syncs" to any scene doc and produces a garbage timeline with no error. | `App.tsx:2177`, `whisperService.ts:259-537`, `App.tsx:1800-1826` |
| **B2** | High | Punctuation/special chars that change word-boundary COUNT desync the positional aligner (colon vs period vs comma in numbers, hyphenated compounds like `co-operate`, abbreviations like `e.g.`/`U.S.A.`). Cascade: a single misaligned segment's t0 eats or gives its neighbor's duration. | `whisperService.ts:153-211`, matching at `331-341` |

Audit-discovered findings:

| ID | Finding | Where |
|---|---|---|
| **S1** | Zero-width chars (ZWSP U+200B, BOM U+FEFF, ZWNJ, directional marks) become word-splitting spaces in the aligner; copy-paste artifacts desync. | `whisperService.ts:179` |
| **S2** | No Unicode NFC normalization in the aligner; NFD vs NFC accented chars mismatch. | `whisperService.ts:154` |
| **S3** | ~~Greedy positional match, no partial-word/stemming; "world"≠"worlds".~~ **FIXED by WS1a, VERIFIED by WS5 (2026-07-29) — no stemming layer needed or added.** Global Hirschberg alignment resolves repeated phrases by position and tolerates inflection (worst case 0.5, above the coverage threshold). | `whisperService.ts:334` |
| **S4** | Repeated phrases: a low-confidence earlier segment can stall the cursor, matching a later repeat to the wrong occurrence. | `whisperService.ts:331-341` |
| **S5** | `maxStart` search cap can prevent finding a true-but-distant match when preceding segments have no spoken counterpart. Needs runtime data for magnitude. | `whisperService.ts:323-329` |
| **S6** | More/fewer scenes than the audio implies is silently absorbed (extra scenes → slivers, missing scenes → bloated spans). | `whisperService.ts:441-444, 515-517` |
| **S7** | Two code paths use different last-segment end (Whisper speech-end vs file-duration). | `whisperService.ts:515-517` vs `syncEngine.ts:242` |
| **S8** | Float-seconds accumulation in the bootstrap estimate (fallback path only). | `App.tsx:414,460` |
| **S9** | Diagnostic (not a bug): total duration is preserved under B2; the "eating neighbor" is a distribution defect. | — |
| **S10** | Malformed Whisper timestamps silently become 0.0, breaking monotonicity. | `whisper.rs:405-415` |
| **S11** | Whisper acoustic confidence scores are unavailable and unused; hallucinations indistinguishable from real speech. | `types.ts:263-267`, `whisper.rs:33-36` |
| **S12** | Segment-level-only transcripts unsupported (design assumes word-level via `-ml 1`). | `whisper.rs:247` |
| **S13** | No words-per-minute / duration sanity check; 10s audio vs 5000-char scene doc accepted. | `App.tsx:1785, 409` |
| **S14** | Language hardcoded to English (`-l en`); non-English audio force-transcribed as garbage. | `whisper.rs:249` |
| **S15** | Empty inputs partially handled, silently (empty scene doc → zero segments, no toast; empty transcript → all timing 0). | `App.tsx:293-305, 1789-1793`, `whisperService.ts:267-269` |
| **S16** | `fetchAndDetectSilences` empty catch swallows decode failure; boundaries silently land mid-word. | `useWhisper.ts:12-20` |
| **S17** | Asset-match ambiguity/duplication warnings are console-only. | `App.tsx:354,381,478` |
| **S18** | Production-invisible alignment diagnostics (DEV-gated warns). | `whisperService.ts:362,414` |
| **S19** | Stage directions / parentheticals / speaker labels are matched, not stripped (`(pause)`, `[laughs]`, `NARRATOR:` become target words). | `whisperService.ts:179`, `App.tsx:312` |
| **S20** | Ordinals ("1st"↔"first"), URLs, year pair-reading ("twenty oh nine") not handled. Needs runtime repro for year-form assumption. | `whisperService.ts:99-108` |
| **S21** | Silence-snap can relocate a boundary onto the wrong word; backward guard compares against `results[i-1].t1` (not previous token end), no final forward clamp. | `whisperService.ts:506-508, 500-511` |

### 2.3 Architectural gaps (root causes)

- **G1 — The voiceover *script* is architecturally vestigial.** The scene doc description is the alignment ground truth: `parseProjectData` uses `scene.description` as segment text (`App.tsx:312`), the script only fills empty descriptions (`App.tsx:315-321`), and the aligner matches `seg.text` (`whisperService.ts:307`). No three-way script↔scene-doc↔audio check exists.
- **G2 — No global match-quality metric anywhere.** Every guard is per-segment and local (confidence at `whisperService.ts:346`, guards at `:361,413`). Nothing ever asks "did this document as a whole match this audio?" — the direct cause of B1.
- **G3 — Alignment is positional-equality, not edit-distance/diff.** The scoring loop (`whisperService.ts:331-341`) compares `tokenWords[wi+j] === targetWords[j]` at fixed offsets. One extra or missing token on either side shifts every subsequent comparison. Correctness is entirely contingent on both sides tokenizing to identical word counts — the direct cause of B2, S3, S19.
- **G4 — Two normalizers, one path.** `normalizeForMatch` (`syncEngine.ts:43-50`) does NFC + zero-width strip + smart-dash/quote fold — but it's on the *filename* path. `canonicalizeForAlignment` (`whisperService.ts:153-211`) — the *timing* path — lacks NFC and turns ZW chars and dashes into word-splitting spaces (`:179`). The better normalizer guards the less timing-critical path.
- **G5 — Failure is invisible in production.** DEV-gated warns (`whisperService.ts:362,414`), empty catches (`useWhisper.ts:17-19`), console-only warnings (`App.tsx:354,381,478,1790,1821`). A garbage sync looks identical to a good one; compounds B1.

---

## 3. Target Architecture

Each subsystem: (a) today, (b) after, (c) the specific change, (d) files/lines, (e) why this approach.

All tuning constants introduced below (`LOW_CONFIDENCE_RATIO`, `MIN_COVERED_RUN_LENGTH`, `NOISE_FLOOR_COVERAGE`, `NUMBER_WORDS`) live in **one new exported module, `src/services/syncConstants.ts`** (R8 point 5, R13) — no constant is defined inline at its use site. *(Round 4: `MAX_INTERPOLABLE_GAP` is deleted with R12 — R4-1 — and `FALLBACK_RATE_MIN_CHARS`/`FALLBACK_RATE_MIN_SECONDS`/`DEFAULT_CHARS_PER_SEC` are deleted with the char-rate subsystem — R4-2. `SNAP_TOLERANCE_SEC` was also removed, 2026-07-26, as dead code once the silence-sharing fix made it conditional on `!silenceFound` — see §3.6. None of these have a consumer today.)*

### 3.1 Token-level diff aligner — Hirschberg (replaces the greedy positional matcher)

**(a) Today.** `alignScenestoTranscript` (`whisperService.ts:259-537`) walks segments in order with a monotonic word cursor. Per segment, it scans windows from `searchStart` to a `maxStart` cap (`:323-329`), scoring exact positional equality (`:331-341`). Guards (overshoot `:361-370`, low-confidence cursor hold `:413-420`) contain — but cannot correct — mismatches.

**(b) After.** A single global alignment is computed between the full scene-doc token sequence (all segments' normalized tokens concatenated, each token remembering its owner segment index) and the full transcript token-word sequence. The alignment output is a monotonic sequence of ops — `match`, `substitute`, `insert` (transcript word with no scene-doc counterpart), `delete` (scene-doc word with no spoken counterpart). Per-segment results are extracted per 3.1.1. The downstream steps (Step 2 t1-override, silence gap-fill, `distributeSegmentTimes`) consume the same `AlignResult` shape as today (`whisperService.ts:283-288`), extended with per-segment coverage (3.3).

**(c) The change — algorithm and specifics (R7).**

- **Algorithm: Needleman-Wunsch scoring recurrence with Hirschberg linear-space traceback, free end-gaps** ("semi-global"/overlap alignment). **Hirschberg is the algorithm from the start, not a fallback** (R7): the scoring function is the standard NW recurrence, but the traceback uses Hirschberg's recursive divide-and-conquer — two rolling-row scoring passes (forward from the top, backward from the bottom) locate the optimal midpoint column, and the problem recurses on the two halves — achieving **O(n+m) space** while producing the *same optimal alignment* as full-matrix NW. It is the industry standard for large-scale sequence alignment and scales to any project size with no memory ceiling. There is no "measure first, fall back" step and no banded variant (banding would reintroduce a weaker cousin of the `maxStart` cap, S5).
- **Free end-gaps through the recursion:** the top-level pass zero-costs leading gaps (first row/column initialized to 0 on the outer boundary) and trailing gaps (best-score selection over the last row/column) — this is what makes Decision 5's leading/trailing-unmatched semantics fall out naturally. Inner recursive subproblems use standard (charged) gap initialization, since their boundaries are interior to the alignment. This free-end-gap/Hirschberg interaction is a known implementation subtlety; its correctness gate is the Hirschberg≡full-matrix property test in Section 6.2 (item 12).
- **Match unit: the normalized word token** (output of the unified normalizer, 3.2). Not characters, not Whisper tokens (they can contain multiple words — the expansion at `whisperService.ts:273-281` is retained).
- **Scoring (starting values; tuned only via the R8 fixture pass, in `syncConstants.ts`):** match `+2`; substitution `-1`; gap (insertion or deletion) `-1`; optional partial credit `+1` for near-matches (one token is a prefix of the other with ≥4 shared leading chars — covers "world"/"worlds", S3), behind a single constant so the R8 tuning pass can disable it if it mis-anchors.
- **Monotonic cursor: gone.** Monotonicity is inherent to the DP alignment path. The overshoot guard (`:361-370`), the low-confidence cursor hold (`:397-430`), and `maxStart` (`:323-329`) are all deleted; the DP considers every position (fixes S5) and global optimization resolves repeated phrases to the occurrence that maximizes total score (fixes S4).

**(d) Files/lines touched.** `whisperService.ts:259-537` (the matcher core `:291-433` is replaced; token expansion `:271-281` kept; Step 2/silence/clamp stages `:435-517` kept, amended per 3.6/3.13). New `src/services/syncConstants.ts`. `syncTiming.test.ts` re-baselined (Section 6).

**(e) Why this over alternatives.** Patching the greedy matcher is what D16 already did — twice — and each patch narrows a symptom while G3 (positional equality) remains the root cause. Edit-distance alignment is the standard solution for exactly this problem (forced-alignment post-processing, diff tools, bioinformatics); it makes tokenization differences a *local* cost instead of a *global* cascade. Global NW (not Smith-Waterman) because coverage accounting needs *all* tokens classified, not just the best local region. Hirschberg (not full-matrix) because linear space is the permanent answer at any scale — per the user's ruling, the more complex implementation is accepted up front.

**Why this fixes B2/S3/S4/S5/S19:** B2 — a token-count difference becomes one insertion/deletion op with a −1 local cost; neighbors are unaffected. S3 — near-match scoring gives partial credit instead of zero. S4 — repeats are disambiguated by global context. S5 — no search cap exists. S19 — stripped stage directions (3.8) plus deletion-tolerance mean residual unspoken text costs only its own gap penalty.

#### 3.1.1 Per-segment confidence extraction from the global alignment (R11)

The Hirschberg aligner produces one global op sequence; per-segment results are read off it deterministically:

1. Each scene-doc segment maps to a contiguous range of scene-doc tokens in the global alignment (recorded at concatenation time).
2. For each segment, scan its token range in the op sequence:
   - **t0** = `startSec` of the FIRST matched transcript word in the range (first op that is a `match`, not a gap/substitution).
   - **t1** = `endSec` of the LAST matched transcript word in the range.
   - **confidence** = (matched transcript words) / (total scene-doc tokens in the segment).
   - **Zero matches** (all gaps/substitutions): the segment is **uncovered** — `matched = false`, `confidence = 0`, no t0/t1.
3. Edge cases: partially matched (some words matched, some gapped) → covered with `confidence < 1.0`; all words matched → `confidence = 1.0`; no words matched → uncovered. A segment is **covered** when `matched = true` AND `confidence ≥ LOW_CONFIDENCE_RATIO` (starting value 0.4; tuned per R8).
4. **Zero-token segments** — text that is empty or normalizes to zero words (including text fully consumed by stage-direction stripping where the keep-original guard of 3.8 doesn't apply because the raw text itself was empty; today's handling at `whisperService.ts:301-311`): classification-**neutral**. They are neither covered nor uncovered — they are excluded from the covered-run scan (3.4) and both coverage denominators (3.3), and they keep today's behavior of anchoring at the previous segment's boundary (`:303,310`). Rationale: an intentionally-textless segment must not be able to dilute the coverage metrics or break a covered run. *(Round 4: neutrality governs the GATE only. At commit time a zero-token segment has no audio coverage and is skipped like any other uncovered segment — 3.5.)*
5. The contiguous-run and gap checks (3.4/3.5) consume the per-segment `matched`/covered flags produced here.

### 3.2 Unified normalizer (replaces the two-normalizer split)

**(a) Today.** Two normalizers, wrong assignment (G4): `normalizeForMatch` (`syncEngine.ts:43-50`) has NFC + ZW-strip + dash/quote folding but serves filenames; `canonicalizeForAlignment` (`whisperService.ts:153-211`) serves timing but lacks NFC (`:154` starts at `toLowerCase`) and its terminal `[^a-z0-9\s]` strip (`:179`) turns ZW chars and hyphens into token-splitting spaces (S1, S2, part of B2).

**(b) After.** One canonical tokenizer on the alignment path, with this exact operation order:

1. Unicode **NFC** normalize (fixes S2)
2. lowercase
3. apostrophe fold (curly → ASCII, as today `:157`)
4. contraction expansion (existing `CONTRACTIONS` map + regex, `:110-143`)
5. thousands-separator strip between digits (`:161`)
6. decimal → "point" reading (`:165`)
7. currency/symbol map (`$`/`%`/`&`/`@`, `:169-175`)
8. **ZW/BOM/directional-mark removal with JOIN semantics** — deleted, not replaced by a space (fixes S1; adopts `normalizeForMatch`'s behavior per Decision 4)
9. **dash fold to plain hyphen** (en/em dash → `-`); the terminal strip **preserves the hyphen**: `[^a-z0-9\s-]` → space
10. remaining non-alphanumeric → space; whitespace tokenize
11. **hyphen resolution with the number-word carve-out (R1)** — see below
12. per-token digit expansion (`digitTokenToWords` + the mixed-alnum split, `:100-108, 184-209`) — unchanged

**Hyphen semantics (R1 — final).** Hyphen-join is the default: `co-operate` stays **one token**, hyphen preserved. **One carve-out:** a hyphenated token is split on its hyphens **iff every sub-part is a number word or a digit run**. The number-word set is a complete, named constant — **`NUMBER_WORDS`** in `syncConstants.ts`: one through ninety-nine (all unit words `one`…`nineteen`, all tens `twenty`…`ninety`, and by construction of the split rule, `thirty-seven`-style compounds resolve because each sub-part is itself in the set), plus `hundred`, `thousand`, `million`, `billion`, plus anything matching `[0-9]+`. Rule: split the token on `-`; if every sub-part ∈ `NUMBER_WORDS` ∪ `/^[0-9]+$/` → emit the sub-parts as separate tokens (which step 12 then expands digit runs on); otherwise emit the token whole, hyphen intact. Consequences: `'thirty-seven'` → `['thirty','seven']` ≡ `canonicalizeForAlignment('37')` — **the existing equivalence test at `syncTiming.test.ts:393-394` continues to pass under this rule**; `'co-operate'` → `['co-operate']`; `'3-4'` → `['three','four']`; `'twenty-first'` → one token (`first` is an ordinal, not in the set — S20's ordinal handling remains out of scope).

**(c) The change.** `canonicalizeForAlignment` is rewritten to the order above (keeps its name and its `string[]` return). `normalizeForMatch` **stays as a separate string-returning function for the filename path** — it serves comparison, not tokenization, and filename matching must not expand contractions or read digits as words. Both import shared primitives (the NFC/ZW/dash-fold steps) from one place so the two can never drift on the Unicode-hygiene layer again.

**(d) Files/lines.** `whisperService.ts:145-211` (rewrite), `syncEngine.ts:43-50` (refactor onto shared primitives; behavior unchanged), `syncConstants.ts` (`NUMBER_WORDS`). `normalize`/`textMateriallyChanged` (`whisperService.ts:222-234`) delegate as today and pick up the new behavior automatically.

**(e) Why.** Symmetry is the aligner's foundational invariant (the D16 comment at `:39-46`); the new aligner keeps that requirement but the normalizer no longer has to be *perfect* — anything it misses is a local diff cost, not a cascade. The R1 carve-out resolves the former hyphen-vs-number tension exactly: number compounds split (preserving digit equivalence), everything else joins.

### 3.3 Bidirectional coverage metric + threshold derivation (R8, R13)

**(a) Today.** Per-segment confidence is computed (`whisperService.ts:346`) and used only for the two local guards; it is never aggregated, never returned (`:536` strips it), never surfaced (G2).

**(b) After.** The aligner emits, alongside per-segment results (3.1.1):

- **Scene-doc coverage** = (scene-doc tokens participating in a `match` op) / (total scene-doc tokens, zero-token segments excluded). "Does the audio say what the doc says?"
- **Transcript coverage** = (transcript tokens participating in a `match` op) / (total transcript tokens). "Is the audio saying anything else?"

Both fall out of the single global alignment for free. Their role has changed from the original Decision 8: they are **no longer the primary abort signal**. The primary signal is the contiguous covered-run check (R13, specified in 3.4); the bidirectional metric survives as the **secondary anti-noise signal** — an abort fires when bidirectional coverage is below `NOISE_FLOOR_COVERAGE` (starting value 0.1) even if a technically-contiguous run exists, catching "matched on noise" cases where a short run is coincidence rather than real correspondence. *(R13 supersedes Decision 8's "abort iff both directions < 0.4" rule — recorded as a deliberate supersession, see Section 9.)*

**(c) Threshold derivation — NOT inherited blindly (R8).** The starting values (`LOW_CONFIDENCE_RATIO` 0.4 per-segment; `MIN_COVERED_RUN_LENGTH` 2; `NOISE_FLOOR_COVERAGE` 0.1) are tuned by an explicit fixture-driven pass, a named WS5 step:

1. Run the Hirschberg aligner on four named fixtures: the **294-segment project** (known-good), the **s2-on-"lot" project** (known-good; old matcher misaligned it), the **cross-script mismatch** case (known-bad), and the **partial-coverage** case (known-partial).
2. Collect per-segment confidence distributions per fixture.
3. Set the per-segment covered threshold at the point maximizing separation between good-case and bad-case confidence distributions, with a safety margin toward the bad case (e.g., worst good-case 0.65 and best bad-case 0.30 → threshold ≈ 0.45).
4. Set `MIN_COVERED_RUN_LENGTH` and `NOISE_FLOOR_COVERAGE` the same way from the fixture data.
5. All three live in `syncConstants.ts`; the tuning pass records the observed distributions in the eventual Decisions Log entry.

> **DONE (WS5, 2026-07-29) — all three values LOCKED UNCHANGED.** The pass ran against the accumulated fixture evidence rather than re-collecting distributions from scratch: the 294-segment project reaches 294/294 covered at 0.4 (WS1b), the middle-gap project correctly covers 8 of 10, and the cross-script mismatch correctly aborts — the separation step 3 asks for is already clean, with no observed good-case segment near the threshold and no bad-case segment above it. Steps 1–4 therefore produced no reason to move any value, so none moved. What WS5 added instead is durability: a written justification per constant in `syncConstants.ts`, and boundary fixtures in `syncTiming.test.ts` that sit *exactly* on each threshold and pin its comparison direction (`confidence >= LOW_CONFIDENCE_RATIO`, `run < MIN_COVERED_RUN_LENGTH` ⇒ abort, `bidirectional < NOISE_FLOOR_COVERAGE` ⇒ abort). Re-tune only with fixture evidence of a real misclassification, and move those tests in the same change. **Caveat:** the 294/294 and 8-of-10 figures are carried forward from the passes that measured them; WS5 itself ran automated checks only.

**(d) Files/lines.** `whisperService.ts` (aligner return type + computation), `useWhisper.ts:27-48` (threads the coverage result), `App.tsx:1806-1826` (orchestrator consumes it), `syncConstants.ts`.

**(e) Why two signals.** Run-length is robust to document length (a 3-segment project and a 300-segment project both prove correspondence with one real contiguous run), while an aggregate-only gate mis-scales: 14 covered segments out of 51 is a legitimate partial-coverage project at ~27% scene-doc coverage — an aggregate-0.4 gate would wrongly abort it. The noise floor covers the opposite failure: a couple of coincidental function-word matches forming a tiny "run" over essentially-zero real overlap.

### 3.4 Abort gate + plain-language error messages (R13; R12 REVERSED by R4-1)

**(a) Today.** No gate. `applySyncDisabled` (`App.tsx:2177`) only requires that a transcript *exists*; the commit at `App.tsx:1838-1850` happens unconditionally once timing is computed.

**(b) After.** A gate in `handleApplySyncFromFiles` between alignment and commit (immediately after the `alignFromCache` call at `App.tsx:1809-1814`, before `preserveEffectFields`/`setProject` at `:1829-1850`). On abort: the failure surfaces through the unified `SyncWarning` surface (R10, severity `'error'`), `setIsProcessing(false)`, `return` — **no partial timeline is committed; the pre-sync project state is untouched** (free today because the commit is already a single atomic `setProject`).

**(c) The gate — two-signal flow (R13), exact order.** **Round 4 (R4-1) DELETED the former step 2, the R12 middle-gap check.** A gap of any length — 1 segment, 2, or 40 — no longer aborts; those segments are simply skipped (3.5). The gate is now exactly three checks:

1. **Empty-input checks** (3.11) — run before alignment; see the two messages below.
2. **Align** (Hirschberg) → per-segment `matched`/`confidence`/`t0`/`t1` (3.1.1); zero-token segments are classification-neutral and excluded from the coverage metrics.
3. **Contiguous covered-run check (R13 Signal 1, primary):** compute all maximal contiguous runs of covered segments. If the longest run < `MIN_COVERED_RUN_LENGTH` (start 2; tuned per R8) — i.e., 0 or 1 covered segments — this is near-zero coverage (the B1 case) → **abort**:
   `"This voiceover doesn't match your scene doc. No timeline will be created."`
4. **Noise-floor check (R13 Signal 2, anti-noise):** if bidirectional coverage (3.3) < `NOISE_FLOOR_COVERAGE` (start 0.1; tuned per R8) → **abort** with the same full-mismatch message. Catches a technically-contiguous run built on coincidental word overlap.
5. **All checks pass → proceed:** build the timeline **from the covered segments only**; every uncovered segment is filtered out before the commit (3.5), and its index/text/skip-reason is recorded for the skip log (R4-4).

**Deleted with R12 (R4-1):** the middle-gap message `"Audio does not exist for segments X to Y. Cannot create timeline."`, its R9 locked-segment variant `"Segment X is locked but has no audio coverage…"`, and the `MAX_INTERPOLABLE_GAP` constant. A locked segment with no audio coverage is skipped like any other uncovered segment — the lock governs *timing* for segments that are committed, and a skipped segment has no timing to protect.

Plus the empty-input checks (3.11), which run before alignment:

- **Empty scene doc** (parse produced zero segments, `App.tsx:1789-1793` — today a console.warn; also the fresh-project case that currently falls through silently):
  `"Your scene doc has no scenes to sync. Add scene tags and try again."`
- **Empty transcript** (zero tokens on the cached path — today only the fresh-transcription path warns, `useWhisper.ts:142-167`):
  `"No speech was found in the audio. No timeline will be created."`

Note on the staging path: `startTranscription` is invoked at staging time with `segments: []` and a no-op `onSegmentsUpdated` (`App.tsx:1660-1675`), so it caches tokens but never commits timing — the orchestrator gate above covers every commit path that exists today. The alignment code inside `useWhisper.ts:170-197` (fresh-path alignment) is retained and gains the same coverage plumbing for consistency, but the gate's enforcement point is the orchestrator.

**(d) Files/lines.** `App.tsx:1806-1850` (gate + messages), `useWhisper.ts` (plumbing), `whisperService.ts` (inputs), `syncConstants.ts`.

**(e) Why hard-stop only for full mismatch (Decision 1, narrowed by R4-1/R4-3).** The abort exists for one failure mode: *these two inputs do not correspond at all* (B1). There, a garbage timeline costs the user more than a blocked sync, and every "proceed anyway" path becomes a support burden. An internal gap is a different situation entirely — the inputs demonstrably correspond (a real contiguous run exists), the audio simply doesn't say some of the scenes. Round 4's ruling: that is not an error, it is information — the covered scenes form the timeline, the uncovered ones are skipped and reported in the skip log (R4-4). Messages stay plain language by design — the audience is YouTube creators, not developers.

### 3.5 Partial-coverage sync logic — SKIP UNMATCHED (R4-1, R4-2; supersedes R2/R3/R12/N1/N2/N3)

**(a) Today.** Every segment gets *some* Whisper-derived window no matter what; segments with no spoken counterpart get near-zero slivers at the cursor (overshoot guard `:361-370`) or absorb neighbors (S6). There is no concept of "this segment has no audio."

**(b) After — one rule: covered segments are committed, uncovered segments are skipped.** Using the per-segment covered flags from 3.1.1 (`matched === true` AND `confidence ≥ LOW_CONFIDENCE_RATIO`):

- **Covered segment →** committed to the timeline at its **Whisper-anchored time**, exactly as a fully-covered sync produces today. Nothing about audio-anchored timing changes.
- **Uncovered segment →** **filtered out of the committed `segments` array before `setProject`.** It does not appear on the timeline at all. No char-based timing, no interpolation, no sliver, no placeholder. Position in the scene doc is irrelevant: leading, middle (any length), and trailing uncovered runs are all treated identically.
- **Zero-token (neutral) segments** are uncovered by construction (no text to align, `covered === false`) and are therefore skipped as well. They remain classification-*neutral* for the coverage metrics (3.3) and the R13 run scan — neutrality governs the *gate*, skipping governs the *commit*.
- **Locked status is irrelevant to skipping.** A lock protects the *timing* of a segment that is on the timeline; a segment with no audio coverage has no audio timing to protect and is skipped like any other.

**The audio is the source of truth and it plays continuously as one file.** The timeline duration is the audio file's duration, unchanged. Covered segments sit at their real audio timestamps. A skipped segment leaves a **gap** — a region of the timeline where no segment exists and the audio simply keeps playing with nothing composited over it. **No stitching, no splitting, no muting** (R4-1): the audio is never cut, re-timed, or silenced to close a gap, and neighbouring covered segments are never stretched to swallow one.

**Character-based fallback timing is ELIMINATED (R4-2).** There is no leading char-fallback, no trailing char-fallback, and no single-segment interpolation. A segment is either audio-covered or absent. This removes, wholesale, the need for: `anchorSource: 'fallback'` (Section 4), the three-tier char-rate (R3), `Project.lastSyncObservedRate` (N3), the export-mux audio padding (R2, 3.14), and the preview fallback clock (N2, 3.15) — every one of those existed only to give an *un*covered segment a plausible duration or to survive a timeline that extends past the audio. Nothing extends past the audio anymore.

**Duration floors (R4-5, moots N1).** With no fallback segments in existence, the sliver concern N1 addressed cannot arise. `MIN_SEGMENT_DURATION` (0.3s, `App.tsx:263`) and the code-level 0.1s floors (`whisperService.ts:552`, `syncEngine.ts:235`) apply **uniformly to every committed segment** — all of which are audio-covered. No classification-conditional floor logic is needed or wanted.

**(c) The change — where each piece lives.**

- The aligner already emits per-segment coverage (3.1.1); no aligner change is required for skipping.
- **The filter is the whole of the logic:** after the gate passes (3.4) and before the commit, the orchestrator partitions the aligned segments by their covered flag, commits the covered ones, and records the rest. This is the entirety of what was WS2's partial-coverage work — a single pure function (`filterToCoveredSegments`) plus its call site, not a timing subsystem.
- **Timing of committed segments is unchanged.** Each covered segment keeps the `startTime`/`duration` `applyAnchorBasedTiming` derived for it (its own anchor → the next segment's anchor). Because an uncovered segment's anchor sits at the *end of the preceding covered segment's spoken words*, dropping it leaves its span as an actual hole rather than folding that span into its neighbour — which is precisely the intended "gap where no segment exists."
- **Skip logging (R4-4).** For each skipped segment the orchestrator records `{ segmentIndex, segmentText, reason }` where `reason ∈ { 'no audio match' (nothing matched), 'low confidence' (matched below `LOW_CONFIDENCE_RATIO`) }`. Persisting this log and surfacing it in the UI is a separate workstream (**WS-logs**, landed 2026-07-25 — see the Implementation Status section above); this workstream produces the records and logs them to the console under a DEV gate.

**(d) Files/lines.** `App.tsx` (the covered-segment filter + skip-record collection in `handleApplySyncFromFiles`). That is all. Explicitly **NOT** touched by this ruling: `whisperService.ts`'s `distributeSegmentTimes`, `syncEngine.ts`'s `applyAnchorBasedTiming` floors, `types.ts` (`anchorSource` keeps its two-value union), `usePlayback.ts`, and both export paths — the changes the previous design required of all five are cancelled by R4-2.

**(e) Why skip rather than abort or interpolate.** Aborting on a middle gap (R12) fails the user's actual workflow: a scene doc routinely contains scenes the voiceover doesn't narrate, and refusing to build any timeline for a project whose audio demonstrably corresponds (a real contiguous covered run exists) throws away all the correct work over an incomplete part. Interpolating or char-filling is the opposite failure — it invents timing the audio never justified and puts it on the timeline looking exactly as authoritative as measured timing. Skipping is the only option that never lies: what appears is measured, what wasn't measured doesn't appear, and the skip log (R4-4) tells the user exactly what was left out and why. Full mismatch remains an abort (R4-3/R13) because there is nothing correct to keep.

### 3.6 Silence-snap boundaries — silence center or token midpoint, no clamps (S21; R4 superseded by the silence-sharing fix + dead-clamp removal)

**(a) Today.** The gap-fill (`whisperService.ts:452-512`, mirrored in `snapBoundaries.ts` for the covered-only re-snap, §4.5's position-offset fix) resolves each boundary one of two ways:

- **Silence found:** the chosen silence's midpoint is used directly as the boundary — trusted as acoustic ground truth, since it outranks Whisper's own ~300ms-inaccurate word timestamps. Not clamped.
- **No silence found:** the boundary falls back to the token midpoint, `(lastSpokenEnd + nextSpokenStart) / 2`. This midpoint inherently lies within (or at the honest average of) the spoken-word edges by construction, so it needs no clamp post-processing.
- **Monotonic check:** applies in both cases — the only safety net.

**(b) History — how this section's design got here.** The original S21 finding was a weak, backward-only sanity check comparing against the *previous boundary* (which the same loop may itself have moved), not real spoken-word extents — a snap could relocate a boundary past a spoken word entirely. That was first fixed by adding `SNAP_TOLERANCE_SEC = 0.150` clamps (half of Whisper's known ~300ms word-timestamp error) applied to every snapped boundary, silence or not (R4). The 2026-07-25 silence-sharing fix then made those clamps **conditional on `!silenceFound`**, after a 14-segment project showed the clamps pulling a boundary back OUT of a genuine detected silence (silence 6.56–7.12, centre 6.84, clamped to 6.55 — before the silence even started), breaking the intended 50/50 silence-sharing between adjacent segments. That left the clamps applying only to the no-silence fallback branch.

**(c) Dead-code removal (2026-07-26).** Once conditional on `!silenceFound`, the clamps could only ever modify the no-silence fallback's token-midpoint estimate — and that midpoint is, by construction, always inside `[lastSpokenEnd − tolerance, nextSpokenStart + tolerance]` (it collapses to the same value the old "conflicting bounds" branch produced when the two edges are out of order). The clamps were therefore mathematically unreachable as a *modifying* operation: removing them changes no computed boundary. They were deleted entirely from both `whisperService.ts` and `snapBoundaries.ts`, along with the `SNAP_TOLERANCE_SEC` constant in `syncConstants.ts`. Verified: 885/885 tests pass (2 clamp-asserting tests removed, 3 midpoint-documenting tests added); manual re-verification on the 14-segment (silence-sharing) and 294-segment projects shows no change in output.

**(d) Scope honesty — what this does NOT fix.** Neither the silence-center path nor the token-midpoint path fixes the s2-on-"lot" case (Section 4.5): the runtime diagnostic proved that snap innocent, and the case was later re-attributed entirely to a project-specific playback issue, not a sync boundary defect (see QB3).

### 3.7 Coverage metadata storage — sidecar `CoverageMap`, not persisted

**(a) Today.** Nothing is stored; confidence is discarded.

**(b) After.** A `CoverageMap` (type in Section 4) lives only in the sync run's in-memory scope: produced by the aligner, consumed by the orchestrator's abort gate and the covered-segment filter (§3.5), then dropped. It is **not** written to `VideoSegment`, `Project`, localStorage, or IndexedDB. *(Round 4: with N3 superseded, this rule now has no exception at all — the rewrite persists nothing. The skip records of R4-4 are a separate concern: they are a user-facing **log of what the sync did**, not per-segment coverage metadata, and their persistence is WS-logs' design decision, not this section's.)*

**(e) Rationale.** Sync metadata is transient — it describes one alignment run against one transcript, invalidated by any re-sync, text edit, or audio change. Under skip-unmatched every committed segment is audio-backed by construction, so no durable per-segment coverage signal is needed at all; `anchorSource` (`'whisper' | 'estimate'`) remains what it is today. Persisting a richer map would create a staleness class of bugs for no current consumer.

### 3.8 Stage-direction / speaker-label stripping + parser fix (S19, R5, N4)

> **Status (2026-07-29, WS5): ALIGNMENT SIDE FULLY IMPLEMENTED — decision 13a + its item-A extension. PARSER FIX (R5/N4): ACCEPTED AS-IS — user decision 2026-07-29 to stop tracking as open. Regression tests remain as historical locks.**
>
> **Landed (WS4, 2026-07-28):** the alignment-side strip, with one deliberate grammar change from (b) below: a `[...]` group **at line start is preserved**, and only bracketed **ALL-CAPS** groups elsewhere in the line are stripped — because the parser fix did not land, line-start brackets are still scene anchors and must survive. Scene-header/transition lines (`INT.`/`EXT.`/`FADE IN:`/`CUT TO:`/`DISSOLVE TO:`) are stripped whole-line, which (b) did not specify. The empty-result fallback in (b)'s final bullet IS implemented.
>
> **Landed (WS5, 2026-07-29):** the **speaker-label rule (`NARRATOR:`, `VOICE 2:`, `SPEAKER:`)** is now implemented, closing (b)'s second bullet. `SPEAKER_LABEL_RE` in `textNormalize.ts`, applied per line after the bracket pass and before the parenthetical pass, so a label composes with both — `[scene 1] NARRATOR: (whispering) hello` → `[scene 1] hello`. Uppercase-only and case-sensitive as specified; `Narrator:`/`narrator:`/`note:` are untouched. One deviation from (b): the pattern does **not** allow periods between words (`[A-Z][A-Z0-9 ]+:`), since `INT.`/`EXT.` sluglines are already removed by the whole-line rule that runs first, and allowing periods would make the label rule overlap it. Accepted limit, documented at the constant: a genuinely spoken ALL-CAPS clause ending in a colon (`THE ANSWER IS: forty two`) matches and loses its lead-in words.
>
> **NOT landed — the parser fix (R5/N4), and not for lack of scope.** `TAG_REGEX` still splits on any `[...]`; mid-line `[laughs]` still creates a phantom segment that claims an asset slot. WS5 investigated it and found the design in this section **does not survive contact with real input**: anchoring the split to line start contradicts the multi-tag one-paragraph format locked in by `sceneTagParsing.test.ts`'s "full repro scene doc" test, where six tags share one line and must all anchor. `"… segment 2 [team] Our team …"` (must split) and `"Line one [laughs] continues here"` (must not) are structurally identical, so no purely positional rule separates them — which invalidates the premise of the parser-fix paragraph below, §6.2 item 12, §6.4 item 9, open risk 10, and Decisions Log item 8. A real fix needs a non-speech-annotation vocabulary or a product ruling on the authoritative input format. Deliberately deferred by user decision on 2026-07-29; the current defective behavior is now locked by regression tests so the eventual fix cannot land silently. Code: `textNormalize.ts`'s `stripStageDirections`/`canonicalizeSceneDoc`, `whisperService.ts`'s `normalizeSceneDoc`, called from `extractSegmentAlignments`.

**(a) Today.** `(pause)`, `[laughs]`, `NARRATOR:` in a scene description become alignment target words (`App.tsx:312` feeds description text through; `whisperService.ts:179` tokenizes them like any word). Worse — and this is why the parser change is in scope — `TAG_REGEX` (`App.tsx:279`, also used by the backup pass at `:294`) splits scene blocks on **any** `[...]` occurrence via the lookahead `(?=\[[^\]]*\])`, so `[laughs]` mid-description creates a bogus new scene at parse time, *before* the aligner ever sees it. Aligner-side stripping alone cannot fix that.

**(b) After — two coordinated changes.**

> **SUPERSEDED (WS5, 2026-07-29) — the paragraph below is the original design and was NOT implemented.** Its premise (one scene tag per line) is contradicted by the multi-tag one-paragraph format the parser already supports and has a test for. See the §3.8 status block above for the finding and for what a real fix would require. Retained for history; do not implement as written.

**Parser fix (R5, in scope for WS4):** `TAG_REGEX` is anchored to **line start** — a `[` at the start of a line (optionally after whitespace) opens a scene tag; a `[` mid-line does not (e.g., split pattern anchored with `^`/`m`-flag semantics: a lookahead requiring start-of-line before the bracket). Behavior change, deliberate: a description line containing `[laughs]` no longer splits into two scenes. Both `TAG_REGEX` use sites (`App.tsx:279-280, 294`) change together.

**Re-parse of existing scene docs (N4 — final: ship silent).** A previously-saved scene doc containing mid-line `[...]` text parses to **fewer** scenes after this change (under clean-slate re-sync, `parseProjectData` rebuilds all segments from the stored `sceneDetails` on every Apply Sync). This is the **correct** behavior — mid-line brackets were incorrectly treated as scene tags before — and **no `SyncWarning` is surfaced for the re-parse discrepancy**: the coverage gate (R13) catches genuinely wrong outcomes, and correctly-authored docs (tags at line start) are entirely unaffected. The behavior change is documented in the post-implementation Decisions Log entry (Section 9, item 8) so it is recorded in project history.

**Alignment-side stripping grammar (Decision 13), conservative by construction:**

- Strip text inside `(...)` and `[...]` anywhere in the description text (mid-line brackets now reach the aligner thanks to the parser fix, and are stripped here).
- Strip an ALL-CAPS word (≥2 letters, allowing digits/spaces/periods between words) followed by a colon at the **start of a description line** — speaker labels like `NARRATOR:`, `VOICE 2:`. Mixed-case (`Narrator:`) is deliberately not stripped.
- If stripping would empty a segment's text entirely, keep the original text unstripped — a fully-parenthesized line is more likely a legitimate spoken aside than an empty scene.

**(c) Where it runs.** The strip is a pre-align text transform inside the aligner's target-side tokenization (a small pure function applied to `seg.text` before `normalize` at `whisperService.ts:307`) — **not** mutating `seg.text`: the displayed/edited segment text keeps the author's original; only the alignment view is stripped. The parser fix is in `parseProjectData`.

**(d) Files.** `whisperService.ts` (strip function + call site), `App.tsx:279-280, 294` (`TAG_REGEX`); tests in `syncTiming.test.ts` + a parser test (Section 6).

### 3.9 Language handling — dual-model detect-then-transcribe (S14, R6)

> **Status (2026-07-29): DEFERRED POLISH FEATURE — see `project-state.md` Deferred Polish Features.** Verified empirically against the bundled binary: with only `ggml-base.en.bin` present, whisper-cli answers `-l auto` / `--detect-language` with `main: WARNING: model is not multilingual, ignoring language and translation options` and emits no detected language at all. Step 1 of (b) — bundling `ggml-base.bin` (~148MB on disk) — is therefore a hard prerequisite, not an optimization. Deferred by explicit user decision rather than shipped as code that can never run. `-l en` remains hardcoded; no `lang-warn` log entry kind exists.

**(a) Today.** `-l en` hardcoded (`whisper.rs:249`) against the bundled English-only model `ggml-base.en.bin` (`whisper.rs:54,78,89`; gitignored per `.gitignore:17-18`, provisioning docs in `src-tauri/models/README.md`); non-English audio is force-transcribed as English garbage.

**(b) After — the full flow (R6, final):**

1. **Bundle BOTH models:** `ggml-base.en.bin` (English — better English accuracy) AND `ggml-base.bin` (multilingual) ship in the whisper sidecar assets. Installer grows ~74MB — accepted per the user's ruling. Bundling is mechanically free: `tauri.conf.json`'s `bundle.resources` already globs `"models/*": "models/"`, so the new file needs no config change — only the file itself in `src-tauri/models/` (gitignored like the existing model, `.gitignore:18`), a `src-tauri/models/README.md` provisioning update, and a `model_path` generalization in `whisper.rs:51-100` (currently hardcodes the `.en` filename at `:54,78,89`) to resolve either model by name.
2. **Detect-only pass first,** using the **multilingual** model with whisper-cli's `--detect-language` mode (which exits after detection — that exit-after-detect behavior, previously an obstacle, is exactly what a cheap detection pass wants). The detected language is parsed from whisper-cli's output and surfaced over the IPC channel (a new `WhisperEvent` variant or a field on `Done`). The existing transcode-to-WAV step (`whisper.rs:115-150`) runs once; its output feeds both passes.
3. **Detected English →** transcribe with the **English** model (`-l en`, `--dtw base.en` as today, `whisper.rs:249-250`) — better accuracy, unchanged behavior for the overwhelmingly common case.
4. **Detected non-English →** transcribe with the **multilingual** model (`-l <detected>`, and the DTW preset switches to the multilingual model's — `--dtw base`, since `--dtw base.en` is model-specific), AND surface a warning through the unified `SyncWarning` surface (R10): `"Detected language: <language>. English sync may produce lower quality. Proceed?"` — warn, not block (Decision 9). The coverage gate (3.4) remains the actual safety net.
5. **Detection fails or is uncertain →** fall back to the English model and proceed (today's behavior, no regression — this also covers a fresh checkout where the multilingual model wasn't provisioned).

**(d) Files.** `whisper.rs` (`model_path` generalization `:51-100`, detect pass, model/flag selection `:244-251`, event surface), `src-tauri/models/README.md` (provisioning), `whisperService.ts` (event type), `useWhisper.ts` (detected-language state + warning), `types.ts` (event shape if grown). No `tauri.conf.json` change needed (resources glob already covers `models/*`).

**(e) Costs, accepted explicitly (R6):** +74MB installer; a second whisper-cli invocation (the detect pass) on every transcription — small (detection reads ~the first 30s), and the full second transcription cost applies only to non-English audio. Progress reporting attributes the detect pass as a brief pre-phase (percent 0 until detection completes — acceptable; see Risks).

### 3.10 Silence-detection fail-loud (S16, R10)

> **Status (2026-07-28, WS4): IMPLEMENTED — decision 11a.** `detectSilences` returns a `SilenceDetectResult` discriminated union and never throws; `fetchAndDetectSilences`'s bare catch is gone. Deviation from (b): the failure is surfaced as a persistent `'silence-error'` `SyncLogEntry` (rendered red in `SyncLogPanel.tsx`) plus `SyncRunSummary.silenceErrorCount`, **not** through the `SyncWarning` dispatcher — that unified surface (R10) does not exist yet, and the sync log is the surface that does. Sync continues on token-midpoint boundaries; it never aborts.

**(a) Today.** `fetchAndDetectSilences` (`useWhisper.ts:12-20`) catches everything and returns `[]`; a decode failure silently degrades every boundary to token-midpoint placement.

**(b) After.** The catch logs the real error and emits a `SyncWarning` (R10); additionally, a `[]` result for non-trivial audio (> ~30s — real narration always has pauses) emits the same warning (Decision 11). Message: `"Couldn't analyze pauses in the audio — segment boundaries may be slightly off."` Sync proceeds (quality degradation, not a correctness failure).

**(c/d) Change + files.** `fetchAndDetectSilences` gains an `onWarning?: (w: SyncWarning) => void` parameter threaded from both call sites (`useWhisper.ts:33, 170`); both funnel into the hook's single `onSyncWarning` dispatcher (R10, Section 4).

### 3.11 Empty-input handling (S15, R10)

**(a) Today.** Empty scene doc → zero segments → console.warn + silent return when prior segments exist (`App.tsx:1789-1793`), or a silent zero-segment commit on a fresh project; empty transcript on the cached path → all-zero timing with no message (`whisperService.ts:267-269`).

**(b) After.** Both cases abort with the messages in 3.4, surfaced through the unified `SyncWarning` surface (severity `'error'`) rather than ad-hoc toasts — one rendering path for every sync-produced warning/error (R10). The scene-doc check also covers the no-voiceover sync path (an empty scene doc aborts regardless of audio state).

**(d) Files.** `App.tsx:1786-1793` (scene-doc case), gate location per 3.4 (transcript case), `useWhisper.ts` (dispatcher).

### 3.12 Malformed-token skip (S10)

> **Status (2026-07-28, WS4): IMPLEMENTED on the TS side — decision 14a.** `filterMalformedTokens` (`whisperService.ts`) runs once before alignment and drops tokens with non-finite timestamps, `t0 < 0`, `t0 >= t1`, `t1` past `audioDuration + MALFORMED_TOKEN_DURATION_TOLERANCE_SEC` (0.5s), or text that normalizes to nothing; the count is reported as a `'malformed-token'` log entry. The **Rust-side hardening in (b) did NOT land** — `parse_timestamp` still returns `0.0` on an unparseable field, so a malformed line still produces a t=0 token; the TS filter now catches it downstream (`t0 >= t1` or the text check) instead of it reaching the aligner. Hardening `whisper.rs` remains worth doing, but is no longer load-bearing.
>
> **Filter verified accurate on real 294-segment project:** 114 of 855 tokens filtered, all punctuation-only (no actual words dropped); whisper.cpp emits punctuation as separate tokens which textNormalize strips to empty strings, triggering the empty_text rule; a subset hit zero_or_neg_dur from whisper's touching-partition t0==t1 on punctuation marks. Behavior is correct and intentional.

**(a) Today.** `parse_timestamp` (`whisper.rs:405-415`) returns `0.0` for anything that doesn't parse — a malformed line yields a token at t=0, breaking monotonicity for every consumer.

**(b) After.** `parse_timestamp` returns `Option<f64>` (the existing code is f64 end-to-end; the audit note's "f32" was shorthand) and returns `None` on wrong part count or any non-numeric part. `parse_stdout_tokens` (`:377-401`) skips a token when either timestamp is `None`; `parse_progress_line` (`:365-374`) propagates `None`. A skipped token is logged to stderr for diagnosability. The TS-side `parseTimestamp` (`whisperService.ts:26-34`) has the same flaw but is only used for progress display; harden it identically (return `null`, caller skips).

**(d) Files.** `whisper.rs:365-415` + its two callers; `whisperService.ts:26-34`.

**(e) Why skip rather than clamp.** A missing word-token is invisible to the diff aligner (one fewer transcript token — a local gap at worst; at most it drops one segment's confidence below the covered threshold, and that segment is then skipped, R4-1); a t=0 token corrupts ordering globally.

### 3.13 Last-segment-end standardization (S7)

**(a) Today.** The aligner clamps the last segment to **Whisper speech-end** (`audioEnd = tokens[last].endSec`, `whisperService.ts:440, 515-517`). `applyAnchorBasedTiming` clamps to **file duration** (`syncEngine.ts:239-243`). The cached path runs both (file-duration wins, `useWhisper.ts:47`); the fresh-transcription path runs only `distributeSegmentTimes` (`useWhisper.ts:173-174`) and ends at speech-end — two paths, two answers.

**(b) After.** Both paths end the last segment at **file duration** (Decision 10). `alignScenestoTranscript` gains an `audioDurationSecs` parameter and clamps `:515-517` to it (falling back to speech-end only if the caller passes 0/undefined — defensive). `syncEngine.ts:242` already conforms. With trailing-fallback segments (3.5) the clamp applies to the last *audio-covered* segment instead — same rule, coverage-aware.

**(d) Files.** `whisperService.ts:259-263` (signature), `:515-517` (clamp), both call sites (`useWhisper.ts:34, 173`).

### 3.14 Export pipeline: audio padding for extended timelines (R2) — **SUPERSEDED by R4-2, NOT IMPLEMENTED**

> **Round 4 (2026-07-25): this entire section is cancelled.** It existed solely because trailing char-fallback segments made the timeline longer than the audio. Under skip-unmatched (R4-2) an uncovered trailing segment is skipped, the timeline never exceeds the audio duration, and `-shortest` remains exactly correct on both export paths. **No `apad`, no `timelineDurationSecs` plumbing, no change to `muxOnly.ts`, `exportPipelineWebCodecs.ts`, or `exportPipeline.ts`.** Retained below as the record of why the change was designed and why it is no longer needed; do not implement it.

**(a) Today.** Both export paths mux audio with `-shortest` against the audio stream:

- **Legacy:** `exportPipeline.ts:264-274` — one ffmpeg call, `-i finalVideo -i audio -c:v copy -c:a aac -b:a 192k -shortest` (`-shortest` at `:270`).
- **WebCodecs:** `muxOnly.ts`'s two-step mux — `buildVideoRemuxArgs` (`:109-121`) writes real PTS into a premux intermediate, then `buildAudioMuxArgs` (`:129-144`) muxes audio with `-shortest` (`:139`) against that already-timed intermediate. The two-step split exists because `-shortest` against a PTS-less raw annexb stream silently drops audio entirely (file header `:29-58`) — a constraint this change must preserve.

With a trailing-fallback timeline (3.5), total video duration > audio duration, and `-shortest` truncates the output at audio end — **trailing segments would silently never render**. Unacceptable under this project's "never ship silently corrupt output" standard.

**(b) After — pad the audio to the timeline duration with `apad`.** When the timeline extends past the audio (i.e., trailing-fallback segments exist), the audio-mux invocation adds ffmpeg's `apad` filter, padding the audio stream with silence to the full timeline duration:

```
-af apad=whole_dur=<timelineDurationSeconds>
```

applied to the audio-mux step of **both** paths (`buildAudioMuxArgs` in `muxOnly.ts:129-144`; the legacy exec at `exportPipeline.ts:264-274`). `-shortest` is **kept**: with the audio padded to exactly the timeline duration, `-shortest` now resolves against the *video* stream's end — the desired semantics (the ruling's "pad the audio… or `-shortest` applied against the VIDEO stream" — this achieves both). The filter is compatible with the existing invocations because both already re-encode audio (`-c:a aac`), so inserting an audio filter costs nothing structurally; the video stream stays `-c:v copy`, and the WebCodecs path's premux/PTS constraint (`muxOnly.ts:29-58`) is untouched — `apad` operates on the audio input only.

When no trailing-fallback segments exist (`timelineDuration ≤ audioDuration`, the overwhelmingly common case), the invocation is **byte-identical to today** — no `apad`, no behavior change.

**(c) Plumbing.** Both orchestrators already know the timeline duration (Σ segment durations over `project.segments`). `muxOnly()`/`buildAudioMuxArgs` gain a `timelineDurationSecs` parameter (`muxOnly.ts:157-164` signature); `exportPipelineWebCodecs.ts` threads it in; `exportPipeline.ts` computes it inline at the mux step (`:251-283`). A trailing-fallback project must export correctly on **both** paths — the WebCodecs gate (`useExport.ts`'s `isWebCodecsExportGateOpen()`) can route either way at runtime, so fixing only one path would leave a silent-truncation hole behind the toggle.

**(d) Files.** `src/services/webcodecsExport/muxOnly.ts:109-144, 157-200`, `src/services/webcodecsExport/exportPipelineWebCodecs.ts` (threading), `src/services/exportPipeline.ts:251-283`, `muxOnly.test.ts` (args assertions).

**(e) Why `apad` at mux time.** It is the minimal, container-level fix: no re-render, no synthetic silent audio files to generate and track in the session dir, no change to the annexb/PTS invariants the WebCodecs path documents as hard-won (`muxOnly.ts:10-58`). Manual verification requirement: a real trailing-fallback project exported on both paths, output duration = timeline duration, silence after the voiceover ends, video content present to the last segment (Section 6.4).

### 3.15 Preview playback: fallback clock for trailing segments (N2) — **SUPERSEDED by R4-2, NOT IMPLEMENTED**

> **Round 4 (2026-07-25): this entire section is cancelled.** Like 3.14, it existed only to make a timeline that runs past the audio watchable. Under skip-unmatched (R4-2) the timeline never runs past the audio, so `usePlayback.ts`'s audio-clocked rAF loop and its `audio.ended` → stop/reset branch are correct as they stand and are **not modified**. (Playback across a *gap* needs nothing new either: the audio is one continuous file and keeps playing; `currentSegment` simply resolves to nothing while the playhead is inside a gap, which is the existing no-segment render path.) Retained below as the record of the cancelled design; do not implement it.

**(a) Today.** `usePlayback.ts`'s voiceover path is an rAF loop with the audio element as master clock (`usePlayback.ts:58-105`): every frame reads `audio.currentTime` (`:70`), and when `audio.ended` fires the loop **stops playback and resets to 0** (`:87-92`). With trailing-fallback segments (3.5), the timeline extends past the audio, so trailing segments are unreachable in preview — they export (3.14) but can never be watched. A separate wall-clock `setInterval` path already exists but only when NO voiceover is loaded (`:110-127`), advancing `0.1 × globalPlaybackSpeed` per 100ms tick (`:117`).

**(b) After — the fallback clock (N2, final).**

- **Audio end → fallback clock.** When the audio ends (the `audio.ended` branch, `:87-92`) and the timeline has trailing-fallback segments (Σ segment durations > audio duration), `usePlayback` does NOT stop/reset. It switches from the audio-clocked rAF loop to a **wall-clock fallback** — the same delta-time advance pattern as the existing no-voiceover path, scaled by `globalPlaybackSpeed` (matching `:117`) — and continues advancing `currentTime` from the audio's end to the timeline's end. At timeline end it stops and resets exactly as today's end-of-timeline branch does (`:79-84`). When no trailing-fallback segments exist, the `ended` branch behaves byte-identically to today.
- **Rate consistency with R3.** The trailing segments' *durations* were computed from the three-tier char-rate (R3) at sync time and are stored in seconds; a wall-clock advance (1 timeline-second per real second, × playback speed) therefore traverses each trailing segment in exactly its computed duration — preview timing and segment timing are consistent by construction, which is the ruling's requirement.
- **Scrub-back → audio sync resumes.** When the user scrubs to a position inside the audio-covered region (position < audio duration), the audio element seeks to that position and the audio-clocked rAF loop resumes as master clock. Scrubbing into the trailing region while playing (or starting playback from a paused position past audio end) starts the fallback clock directly, with the audio element left ended/paused.
- **Rationale.** Export and preview must not disagree about what the timeline contains: if trailing segments export (R2/3.14), preview must reach them. This is a **Phase 1** change, scoped into **WS2 alongside the export padding** — both are "timeline extends past audio" concerns and ship together with trailing-fallback itself.

**(d) Files.** `src/hooks/usePlayback.ts:58-105` (the `ended` branch `:87-92` gains the fallback-clock transition; a fallback-clock loop is added alongside, reusing the segments-total end check `:78-84`), plus the scrub path's resume handling where `App.tsx` seeks the audio element.

**(e) What stays untouched.** The no-voiceover interval path (`:110-127`) and the playbackRate sync (`:132-136`) are unchanged; fully-covered projects (no trailing fallback) get byte-identical playback behavior.

---

### 3.16 Per-segment temporal bounding — the token-stealing rescue (WS6, 2026-07-29)

**(a) Root cause.** The Hirschberg aligner (§3.1) computes ONE global, temporally-blind alignment across every segment's words and the entire transcript at once. When a segment's real narration overflows its expected slot (its written text runs longer, in seconds, than the audio time actually available before the next segment's content begins), the aligner has no way to know that — it only sees word sequences. Verified against a real project (temporary production instrumentation, since removed): segment 152 (26 words) overflowed its ~11s slot; several of its trailing words, textually unrelated to anything, were assigned to transcript positions structurally AFTER segment 153's own real content ("linen from flax" at ~445s). Because a single global alignment path is monotonic (query index N's matched subject index must be ≥ query index N-1's), once segment 152's own later query words are matched to a subject position past segment 153's real words, segment 153's identical words can no longer align *backward* to reach them — regardless of scoring. Segment 153 landed at 0/3 matched words and was dropped by `filterToCoveredSegments`.

This is a **structural** failure, not merely a scoring one: reproducing it does not require the disputed words to be a genuine substitution tie (though that can also happen) — it only requires the overflowing segment's own *real*, later content to be spoken chronologically after the neighbor's real content. See `syncTiming.test.ts`'s "WS6 — per-segment temporal-bounding rescue" describe block, case (1), for the exact minimal repro and a note on why an even smaller "shared vocabulary" construction is *not* reliable (it can resolve as a genuine score tie either way, sensitive to the aligner's internal tie-break).

**(b) What did NOT change.** The global Hirschberg pass in `extractSegmentAlignments` (`whisperService.ts`) is **untouched** — same scoring, same recursion, same tie-breaks. This is deliberate: several existing regression tests (the D16 "SAFETY NET" test, the repeated-phrase disambiguation test, WS5's shared-word tests) depend on the *global* pass's whole-document optimality to resolve ambiguous shared vocabulary correctly using unique surrounding context — a from-scratch per-segment-independent aligner, run with no cross-segment coordination, cannot reproduce that without perfect anchor data (see (d) below for why an early from-scratch design was rejected). Keeping the global pass exactly as it was guarantees every pre-WS6 test's behavior is preserved byte-for-byte, verified empirically (`npx vitest run` — 1035/1035, no exceptions).

**(c) The fix — a narrowly-scoped rescue, not a replacement.** After the (unchanged) global pass produces its per-segment results, any segment left at **zero** true matches is given one more chance:

1. **Eligibility.** Only fires when `matchedCount === 0` for the segment AND the segment has a real `anchorStart` (no anchor ⇒ no trustworthy window ⇒ the global classification stands, untouched — this is what keeps every anchor-free adversarial unit test passing unmodified).
2. **Window (Part 1).** `expectedStart = segment.anchorStart`; `expectedEnd = nextSegment.anchorStart ?? audioDuration` (last segment). `tolerance = clamp(0.1 × (expectedEnd − expectedStart), 1.5, 5.0)` (`TEMPORAL_TOLERANCE_*` in `syncConstants.ts`). `window = [expectedStart − tolerance, expectedEnd + tolerance)`.
3. **Exclusivity — NOT a time floor (Part 1's C3, overridden).** The spec's original monotonic-carry-forward default (float the window start past the *previous* segment's own committed `t1`) was implemented, tested against the real repro, and **rejected**: in exactly the overflow scenario this rescue targets, the overflowing segment's own true trailing match can itself land *after* the stolen tokens (that is the bug) — a `t1`-based floor re-excludes the very words the rescue exists to recover (reproduced directly; see `whisperService.ts`'s inline comment at the rescue site). Instead, exclusivity is enforced at the exact token level: `globallyClaimed`, the set of every transcript word ANY segment truly matched in the (unchanged) global pass, is computed once up front, and the rescue's window scan skips any token in it. This gives the same "never double-claim" guarantee as the spec's C3 intent, without the failure mode — it can only ever ADD a match a segment is missing, never take one another segment legitimately has.
4. **Temporal-proximity scoring bonus (Part 2).** Within the window, a candidate token gets an additive bonus — `TEMPORAL_BONUS_MAX (0.3)` at the window's `expectedCenter = (expectedStart + expectedEnd) / 2`, decaying linearly to 0 at the edge of the central `TEMPORAL_BONUS_CENTRAL_FRACTION (50%)` band, 0 beyond it — applied ONLY to a true textual match (`pairScore` in `whisperService.ts`; a mismatch is always exactly `ALIGN_MISMATCH_SCORE`, so the bonus can never turn a wrong word into a match). This breaks ties when the same free word occurs more than once in the window, in favor of the temporally closer occurrence. The DP score rows switched from `Int32Array` to `Float64Array` to carry the fractional bonus without truncation.
5. **Fallback (Part 3).** If the bounded, bonus-scored Hirschberg run (`alignQueryToSubject`, now accepting an optional `subjectBonus` parameter — omitted ⇒ all-zero, so every pre-WS6 caller is unaffected) still finds nothing, a plain greedy left-to-right exact-text scan of the same (already-filtered) window is tried. In every fixture built for this fix, the bounded Hirschberg run already recovers a genuinely-present word (matching strictly dominates any alternative in this scorer), so Part 3 is defense-in-depth for a case not otherwise reproduced, not the primary recovery path.
6. **Diagnostics.** A recovery logs `[align-recover] seg=<index> recovered <n>/<total> via fallback` (DEV-gated, permanent — unlike the temporary `[s135-diag]` instrumentation used to find the bug, which has been fully removed).

**(d) Why not a from-scratch per-segment independent aligner (the originally-specified design)?** The first implementation attempt ran each segment's alignment fully independently (own bounded window, own Hirschberg call, for EVERY segment, not just zero-match ones) and dropped the global pass entirely. Empirically, this reopened the exact bug class the global pass was built to close in an earlier workstream (§3.1): with no anchors (several adversarial unit tests deliberately have none), every segment's window degenerates to "the whole timeline," and two segments sharing an exact word — with no shared coordination between their independent DP calls — greedily both claim it, with the outcome decided by processing order rather than which segment it actually belongs to. The rescue-on-top design in (c) avoids this because it only ever touches segments the global pass could not classify at all, using a token-level (not time-window-level) exclusivity guarantee.

**(e) Files.** `src/services/whisperService.ts` (`extractSegmentAlignments`'s rescue block; `pairScore`/`nwForwardRow`/`nwForwardRowFreeLead`/`nwBackwardRowToFixedEnd`/`hirschbergGlobal`/`alignQueryToSubject` widened to thread an optional per-subject-position bonus, all-zero when omitted; new `temporalBonus`/`findExactSequentialMatches`/`clamp` helpers). `src/services/syncConstants.ts` (`TEMPORAL_TOLERANCE_RATIO/MIN_SEC/MAX_SEC`, `TEMPORAL_BONUS_MAX/CENTRAL_FRACTION`; `MONOTONIC_CARRY_FORWARD_GAP_SEC` is defined but not wired in — see (c)(3)). `src/services/syncTiming.test.ts` ("WS6 — per-segment temporal-bounding rescue", 10 new tests).

**(f) NOT TRACKED — removed from deferred list 2026-07-29 per user decision.** wav2vec2 forced alignment (the WhisperX approach) would lift word-timing precision from Whisper's own ~85% to ~93% by using a dedicated alignment model instead of Whisper's own predicted timestamps, but requires bundling a second ~148MB model. Out of scope for this fix, which addresses the *alignment algorithm's* blind spot, not the underlying timestamp precision. Historical note only — not tracked as an open or deferred item going forward.

---

## 4. Data Model Changes

**`VideoSegment.anchorSource`** (`types.ts:208`) — **UNCHANGED** (`'whisper' | 'estimate'`). The third value `'fallback'` was required only by char-based fallback timing, which R4-2 eliminated: every committed segment is audio-covered, so every anchor is `'whisper'` (or `'estimate'` on the no-transcript path, as today). `project-state.md`'s invariant (e) needs no amendment.

**`Project.lastSyncObservedRate`** — **NOT ADDED** (N3 superseded by R4-2). It existed solely as tier 2 of the three-tier char-rate; with no char-rate there is no consumer. **This rewrite adds NO persisted field** — the persistence posture reverts to the original "no `Project` changes."

**Skip records (R4-4)** — in-memory in this workstream, persisted by **WS-logs**:

```ts
type SegmentSkipReason = 'no audio match' | 'low confidence';
interface SkippedSegmentRecord {
  segmentIndex: number;   // 0-based index in the PRE-filter (parsed) segments array
  segmentText: string;    // the segment's scene-doc text, for the log UI
  reason: SegmentSkipReason;
}
```

Produced alongside the covered-segment filter (§3.5(c)). WS-logs persists these on the project (surviving app close/reopen) and renders them in a sync-log panel; this workstream only produces and DEV-logs them.

**`SyncWarning`** — new type, the single warning currency for the unified surface (R10):

```ts
interface SyncWarning {
  id: string;                      // stable per warning kind, e.g. 'silence-detect-failed'
  severity: 'warn' | 'error';      // 'error' = sync aborted; 'warn' = proceeded degraded
  message: string;                 // the exact user-facing string (Section 3.4/3.9/3.10)
  segmentRange?: [number, number]; // 1-based inclusive, for gap/locked messages
}
```

`useWhisper` owns the `onSyncWarning` dispatcher state; both the cached path (`alignFromCache` — gains an optional warning callback parameter, since it is currently a plain module-level function with no status plumbing, `useWhisper.ts:27-48, 229`) and the fresh path (`startTranscription`) funnel every warning through it. The UI renders all `SyncWarning`s through one surface (the existing toast/banner mechanism, one renderer) regardless of origin path.

**`CoverageMap`** — new type, in-memory sync state only (never persisted; 3.7):

```ts
interface SegmentCoverage {
  matchedWords: number;
  totalWords: number;              // 0 for zero-token segments (classification-neutral, 3.1.1)
  confidence: number;              // matchedWords / totalWords (0 when totalWords is 0)
  // Round 4 (R4-1/R4-2): the fallback/interpolated/gap-error classes are gone —
  // a segment is committed, skipped, or textless. Nothing else exists.
  classification: 'covered' | 'skipped' | 'no-text';
}
interface CoverageMap {
  perSegment: SegmentCoverage[];   // index-parallel to the segments array
  sceneDocCoverage: number;        // 0..1 — Decision 2(a); Signal 2 input (R13)
  transcriptCoverage: number;      // 0..1 — Decision 2(b); Signal 2 input (R13)
  longestCoveredRun: number;       // Signal 1 input (R13)
}
```

**`src/services/syncConstants.ts`** — new module holding every tuning constant (Section 3 preamble) plus `NUMBER_WORDS` (R1). Single exported home per R8 point 5.

**`TranscriptToken`** (`types.ts:263-267`) — unchanged. A per-token probability field (S11) remains a **deferred future extension**.

---

## 4.5 The s2-on-"lot" case study — the snap was innocent

A runtime diagnostic was run against the real project where segment 2's boundary landed on the word "lot" (inside "used lot") instead of at "on" ("on a Saturday"). Finding, recorded here so no future reader mis-attributes it:

- The silence gap-fill found **no silence candidate** for that boundary; the fallback (`whisperService.ts:500-502`) kept t0 at the token-boundary-derived position. **The snap did not move anything.**
- The **matcher itself** placed "on a saturday" at 9.05s — a timestamp that lands on "lot" — i.e., the greedy positional matcher (G3/B2 mechanics) mis-anchored the segment's first matched word.
- **Therefore:** the diff aligner rewrite (3.1) is the fix for s2-on-"lot". The snap guards (3.6) are justified by *other* cases where a chosen silence genuinely relocates a boundary across spoken words — they would not have changed this case at all. (The tolerance ruling R4 additionally cites this diagnostic's observed snap magnitudes — 0.44s/0.48s/0.47s, all plausibly correct — as evidence that exact clamps would over-constrain.)

Any post-rewrite regression test for this project should assert the boundary lands at/near "on", attributed to 3.1, not 3.6.

**Post-WS1a confirmation (2026-07-24).** A temporary DEV-gated diagnostic pass (`[s2-lot-diag]`, since removed) traced this exact segment pair through the shipped Hirschberg aligner. Result: the aligner matches "on" correctly — Stage A of the trace confirmed `alignScenestoTranscript`'s per-segment extraction (3.1.1) resolves segment 2's first matched word to "on", not "lot". The residual ~150-200ms visual offset at the boundary is **not** an aligner defect: it is Whisper's own word-timestamp imprecision (both "lot" and "on" are reported at the same 9.05s boundary by Whisper itself, before the aligner or the silence-snap ever see the data) — see **QB3** in "Quick Bugs to Fix" below for the proposed audio-energy-based refinement. This closes the open attribution question from the paragraph above: the diff aligner rewrite (3.1) is confirmed as the s2-on-"lot" fix at the matching layer; the remaining visual offset is a separate, already-scoped concern (QB3), not a WS1a regression or a snap-guard (3.6) gap.

**Final re-attribution (2026-07-25, post-QB3 investigation).** QB3's audio energy refinement was implemented and then re-investigated against the real s2-on-"lot" project with full acoustic data (wide-window spectral flux + energy envelope + raw PCM samples). Finding: the sync boundary **is correct** — the UI shows the boundary at 9.04s, Whisper reports "on" starting at 9.05s, and the energy data confirms the "on" vowel onset actually occurs at 9.01–9.05s. There is no Whisper timestamp inaccuracy in this case after all. The originally reported "boundary lands on lot" symptom is a **project-specific playback issue**: that one segment's audio plays back ~650ms earlier than its timeline position, for reasons unrelated to sync timing — other segments in the same project play back correctly. QB3's `audioBoundaryRefinement.ts` was removed as dead code addressing a problem that does not exist. See QB3's entry below for the closed status.

**Final note (2026-07-25).** The playback offset (~650ms on one segment, project-specific) is deferred as a separate investigation. The sync boundary itself is confirmed correct (UI shows 9.04s, Whisper says "on" at 9.05s, energy data confirms "on" vowel onset at 9.01-9.05s). The audio energy refinement code (QB3) was removed as it addressed a non-existent sync problem.

---

## 5. File-by-File Change List

### Workstream 1 — Matcher rewrite (Hirschberg) + normalizer unification + coverage metric + two-signal abort gate (the coupled foundation)

| File | Change | Rulings/Decisions |
|---|---|---|
| `src/services/syncConstants.ts` (NEW) | All tuning constants + `NUMBER_WORDS` (Section 3 preamble, R1). *(Round 4: `MAX_INTERPOLABLE_GAP` and the three char-rate constants are deleted — R4-1/R4-2. `SNAP_TOLERANCE_SEC` also deleted, 2026-07-26, as dead code — §3.6.)* | R1, R8, R13, **R4-1, R4-2** |
| `src/services/whisperService.ts` | Replace the greedy matcher core (`:291-433`) with the Hirschberg aligner (3.1) + per-segment extraction (3.1.1, zero-token neutrality). Rewrite `canonicalizeForAlignment` (`:145-211`) to the unified order incl. the R1 hyphen carve-out (3.2). Extend the return type with per-segment coverage + `CoverageMap` incl. `longestCoveredRun` (3.3). Delete `maxStart`, overshoot guard, cursor hold. | D2/D3/D4, R1, R7, R11, R13 |
| `src/services/syncEngine.ts` | `normalizeForMatch` (`:43-50`) refactored onto shared Unicode primitives (behavior identical). | D4 |
| `src/hooks/useWhisper.ts` | `alignSegmentsFromCachedTranscript` (`:27-48`) threads the coverage result; fresh path (`:170-197`) gains the same plumbing. | R13 |
| `src/App.tsx` | Two-signal abort gate in `handleApplySyncFromFiles` between alignment and commit (`:1806-1850`): run check → noise floor (R13); empty-input aborts (3.11). *(Round 4: the R12 gap check and the R9 locked-in-gap message variant are DELETED — R4-1.)* | D1, R13, **R4-1** |

### Workstream 2 — Skip-unmatched filter + last-segment-end standardization

> **Round 4 (R4-1/R4-2) collapsed this workstream.** Everything it contained beyond the two rows below — char-rate fallback timing, single-gap interpolation, the N1 conditional floors, the `types.ts` additions, the preview fallback clock (N2), and the export audio padding (R2) across all three export files — is cancelled. What remains of "partial-coverage logic" is one pure filter and its call site.

| File | Change | Rulings/Decisions |
|---|---|---|
| `src/App.tsx` | `filterToCoveredSegments` (pure, module-level, unit-testable) partitions the aligned segments by covered flag after the gate passes; `handleApplySyncFromFiles` commits only the covered ones and collects `SkippedSegmentRecord[]` (DEV-logged here, persisted by WS-logs). | **R4-1, R4-2, R4-4** |
| `src/services/whisperService.ts` | `alignScenestoTranscript` gains `audioDurationSecs`; `:515-517` clamps to file duration (3.13). *(The `distributeSegmentTimes` classification work and the `:552` floor change are cancelled — R4-2/R4-5.)* | D10 |
| `src/services/syncEngine.ts` | *(No change. The PASS 3 last-covered-segment clamp and the `:235` conditional floor were both trailing-fallback consequences — cancelled by R4-2/R4-5. The existing file-duration clamp is already correct.)* | **R4-2, R4-5** |

### Workstream 3 — Silence-snap guards (independent)

| File | Change | Rulings/Decisions |
|---|---|---|
| `src/services/whisperService.ts` | ~~Forward + backward clamps with `SNAP_TOLERANCE_SEC` (±0.150s) on the chosen boundary, using `curr.lastTokenIdx` end / `next.firstTokenIdx` start~~ — **removed 2026-07-26 as dead code** (§3.6): silence-found boundary = silence center (no clamp), no-silence boundary = token midpoint (no clamp), monotonic check applies in both cases. | D6, ~~R4~~ (superseded) |

### Workstream 4 — Remaining hardening (independent)

| File | Change | Rulings/Decisions |
|---|---|---|
| `src/services/whisperService.ts` | Stage-direction/speaker-label strip function + call at `:307` (3.8). `parseTimestamp` (`:26-34`) returns `null` on failure. | D13, D14 |
| ~~`src/App.tsx`~~ | ~~`TAG_REGEX` (`:279-280, 294`) anchored to line-start; re-parse behavior change ships silent, documented in the Decisions Log (3.8, N4).~~ **NOT DONE — WS5 (2026-07-29) investigated and rejected this change as designed** (it contradicts the multi-tag one-paragraph format the parser supports). `TAG_REGEX` is unchanged at `App.tsx:292`. See the §3.8 status block. | **R5, N4** |
| `src-tauri/src/whisper.rs` | `parse_timestamp` → `Option<f64>`, callers skip (`:365-415`) (3.12). `model_path` generalized beyond the hardcoded `.en` filename (`:51-100`); detect-then-transcribe flow with model/`--dtw` selection (`:244-251`) + detected-language IPC surface (3.9). | D9, D14, **R6** |
| `src-tauri/models/` + `src-tauri/models/README.md` | `ggml-base.bin` (multilingual) provisioned alongside `ggml-base.en.bin` (gitignored, `.gitignore:17-18`); README provisioning instructions updated. No `tauri.conf.json` change (`bundle.resources` `"models/*"` glob already bundles it). | **R6** |
| `src/hooks/useWhisper.ts` | `SyncWarning` dispatcher (`onSyncWarning`) owned here; `fetchAndDetectSilences` (`:12-20`) fail-loud via callback (3.10); language warning (3.9); both paths funnel through the one dispatcher. | D9, D11, **R10** |
| `src/types.ts` | `SyncWarning` type (Section 4). | **R10** |
| `src/App.tsx` | Renders all `SyncWarning`s through the single surface (existing toast/banner mechanism). | **R10** |

### Workstream 5 — Test extension + threshold tuning + regression tag

| File | Change |
|---|---|
| `src/services/syncTiming.test.ts` (+ siblings) | Re-baseline + extend (Section 6), incl. the skip tests (R4-1) and the skip-filter test (R4-2), the Hirschberg≡NW property test, and a parser test in its home. *(Round 4: the N1 floor-scoping updates at `:210, :247` and the `muxOnly.test.ts` apad-args test are cancelled — R4-5/R4-2.)* |
| ~~Fixture tuning pass~~ | **DONE (WS5, 2026-07-29).** R8's threshold derivation ran; all three constants LOCKED unchanged with written justifications and on-boundary tests in `syncConstants.ts`/`syncTiming.test.ts`. Stemming/fuzzy matching was explored and **rejected on measurement** — the fixture data showed no need (S3 verification, see the WS5 status block). |
| git tag | `sync-known-good-2026-07-24` after all tests pass (Section 6.3). |

### Workstream 6 — Docs

| File | Change |
|---|---|
| `CLAUDE.md` | Update `whisperService.ts`/`syncEngine.ts`/`useWhisper.ts`/`whisper.rs` File Map entries; update the Anchor-Based Segment Timing section for skip-unmatched; DO-NOT-DO additions (e.g., "never commit a timeline that failed the coverage gate"; "never give an uncovered segment fallback timing — skip it"). *(Round 4: no `usePlayback.ts`/`muxOnly.ts`/`exportPipeline.ts` entries to update — those changes are cancelled.)* |
| `project-state.md` | Decisions Log entries (Section 9) — only after landing + verification; invariant (a) wording update. *(Round 4: invariants (b) and (e) need no amendment — the timeline never exceeds the audio duration and `anchorSource` keeps its two-value union.)* |
| `docs/history.md` | Implementation record — only after verification. |

### Workstream LOGS (WS-logs) — persistent sync log (R4-4), follows this workstream

**Landed (2026-07-25):**

| File | Change |
|---|---|
| `src/types.ts` | `SyncLogEntry`/`SyncRunSummary` types on `Project` (additive, optional, backward-compatible); `VideoSegment.tag`; `SkippedSegmentRecord`/`SyncLogEntry` extended with `segmentTag`/`matchedWords`/`totalWords`/`confidence`. |
| `src/services/syncConstants.ts` | `MAX_LOG_ENTRIES = 500`, `MAX_SYNC_RUN_SUMMARIES = 10`. |
| `src/components/SyncLogPanel.tsx` (NEW) | Sync-log panel UI in the right panel — collapsible, newest-first, color-coded (skip=yellow, abort=red, warning=orange, info=gray), clear-log with confirmation. |
| `src/services/snapBoundaries.ts` (NEW) | `snapCoveredBoundaries` — pure snap-boundary refinement for the covered-only array (post-filter). Replaces `retileCoveredSegments` on the primary sync path (§4.5 position-offset fix); retile kept as fallback. **R4 clamps removed (dead code, 2026-07-26)**; silence-found boundary = silence center, no-silence boundary = token midpoint, monotonic check applies in both cases. |
| `src/App.tsx` | WS-logs wiring (persist via existing `projectStore` save); Bug 1 fix (info entry always fires on success — §Implementation Status); Bug 2 fix (`filterToCoveredSegments` keeps `matched`, not `covered`); `snapCoveredBoundaries` call site; `buildSyncInfoMessage`; tag population; `handleClearSyncLog`. |
| `src/services/whisperService.ts` | Silence-sharing fix — R4 snap clamps conditional on `!gap` (no silence found); see updated §3.6. |
| `src/hooks/useWhisper.ts` | Silences threading; `alignFromCache` return extended. |

Scope: **sync-only messages** — skip notices, abort notices, warnings, info.

---

## 6. Test Plan

### 6.1 The 23 existing tests (`src/services/syncTiming.test.ts`) — what changes and why

The matcher rewrite **deliberately re-baselines** this suite (Decision 3). Per describe block:

- **`cached-token sync pipeline (Option C)` (1 test, `:40-86`).** Exact expected values (`3.7/3.85/3.95`, `:73-79`) may shift within the silence windows under the new aligner + tolerance clamps; the Σ-duration assertion (`:83-84`) must keep passing for this fully-covered case. Re-baseline values by hand-verifying the new output against the token fixture.
- **`clean-slate re-sync (11→14 Civic repro)` (2 tests, `:101-255`).** Contiguity, duration floors, Σ=AUDIO_DURATION (`:214, :251`), and tape-deck ordering must all still pass — this fixture is fully covered, so the new aligner must reproduce the same qualitative result. **The ≥0.3s assertions at `:210` and `:247` stay UNSCOPED** (R4-5 moots N1): every committed segment is audio-covered, so the floor applies uniformly and needs no `anchorSource` condition.
- **`stale-anchor squeeze (synthetic)` (2 tests, `:274-329`).** `applyAnchorBasedTiming` mechanics — unaffected; expected to pass unchanged.
- **`legacy project (pre-6/18)` (1 test, `:342-375`).** `applyAnchorBasedTiming` only (`:373` Σ check) — unchanged, must pass. The PASS 3 clamp change (WS2) must be verified a no-op here (no fallback segments).
- **`D16 canonicalization equivalence (Part A)` (7 tests, `:386-459`).** Survive under R1: **`'thirty-seven' ≡ '37'` (`:393-394`) continues to pass** — the number-word carve-out splits it to `['thirty','seven']`. New cases required: `co-operate` one token; `3-4` splits (all-digit sub-parts); `twenty-first` stays whole (mixed number+ordinal); abbreviations (`e.g.`, `U.S.A.`); ZW-char join (`foo​bar` → `foobar`); NFC (`café` NFD ≡ NFC).
- **`D16 alignment robustness (Parts A + C)` (6 tests, `:461-616`).** The *scenarios* (number/contraction/symbol/glued-token alignment without neighbor drift) are preserved; the *mechanism assertions* change — there is no cursor. The safety-net test (`:585-615`) becomes "an unmatchable segment yields low per-segment confidence and does not displace its neighbors' matched positions" — and under R4-1 that segment is simply skipped at commit time.
- **`D16 overshoot guard + backstop clamp` (4 tests, `:630-754`).** Tests (a)–(c) assert guard internals (`overshoot`/`low-confidence` console messages) that **no longer exist** — rewritten as outcome tests under the diff aligner. Test (d) (`:732-753`, `applyAnchorBasedTiming` backstop) is matcher-independent and survives as-is — the backstop clamp is retained as defense-in-depth.

### 6.2 New tests required

1. **Full-mismatch abort** — cross-script fixture: longest covered run = 0 → abort with the mismatch message (R13 Signal 1).
2. **Near-zero-coverage abort** — exactly 1 covered segment (longest run = 1 < `MIN_COVERED_RUN_LENGTH`) → abort (R13 Signal 1).
3. **Matched-on-noise abort** — a contiguous run ≥ 2 exists but bidirectional coverage < `NOISE_FLOOR_COVERAGE` → abort (R13 Signal 2).
4. **Partial-coverage proceed** — longest run ≥ 2 with leading + trailing uncovered segments: no abort (R13, R4-1).
5. **Middle-gap SKIP, not abort (R4-1)** — the R12 abort tests are replaced by their skip counterparts: 2 consecutive uncovered segments between covered ones → no abort; 1 uncovered between covered ones → no abort; leading uncovered → no abort; trailing uncovered → no abort. A locked segment inside a gap is likewise not an abort (the R9 message variant no longer exists).
6. **Skip filtering (R4-2)** — a coverage array with 5 covered + 3 uncovered segments commits **exactly 5** segments, not 8; the kept segments are the covered ones, in order, with their Whisper-anchored `startTime` intact; the 3 skipped ones produce skip records carrying the right `segmentIndex`/`segmentText`.
7. **Skip reasons (R4-4)** — a segment with zero matched words records `'no audio match'`; a segment that matched but below `LOW_CONFIDENCE_RATIO` records `'low confidence'`.
8. *(Deleted — the two-segment gap abort was R12's; superseded by item 5.)*
9. *(Deleted — the three-tier char-rate was R3's; eliminated by R4-2.)*
10. **Snap tolerance** — a silence midpoint within +150ms past `nextSpokenStart` is ACCEPTED; one beyond it is clamped; backward mirror; degenerate window falls back to token midpoint (R4).
11. **Stage-direction strip** — `(pause)`/`[laughs]`/`NARRATOR:` stripped; `Narrator:` kept; fully-parenthesized text kept unstripped (D13).
12. ~~**Parser line-anchor**~~ — **NOT IMPLEMENTED (WS5, 2026-07-29).** The inverse is what exists and is now tested: `sceneTagParsing.test.ts`'s "R5/N4 — mid-line brackets split blocks (known defect, locked)" asserts that a mid-line `[laughs]` DOES still split, with `// DEFECT:` markers on every such assertion. See the §3.8 status block for why the line-anchor rule cannot be adopted as designed.
13. **Malformed-token skip** — Rust unit tests (`parse_timestamp` → `None`; `parse_stdout_tokens` drops the token); TS mirror for `parseTimestamp` (D14).
14. **Hirschberg ≡ full-matrix NW property test** — on small random and hand-built fixtures (including free-end-gap cases), the Hirschberg traceback must produce the same optimal-score alignment as a reference full-matrix implementation kept test-side only (R7; the correctness gate for the free-end-gap/recursion subtlety, 3.1(c)).
15. **Zero-token segment neutrality** — an empty-text segment neither aborts nor dilutes the coverage metrics (3.1.1 point 4); at commit time it is skipped like any other uncovered segment (R4-1).
16. *(Deleted — the export mux `apad` args test was R2's; the change is not implemented, §3.14.)*
17. **Language flow (frontend side)** — detected non-English surfaces a `SyncWarning` (severity `'warn'`), does not block; detection-failure falls back silently (R6, D9). Rust detect-pass logic covered by manual testing + Rust unit tests where practical.
18. **Unified warning surface** — silence-failure, language, and empty-input events all arrive as `SyncWarning` through the single dispatcher, from both cached and fresh paths (R10).

### 6.3 Threshold tuning pass + regression tag

R8's tuning pass (3.3(c)) runs after WS1–WS4 land, on the four named fixtures; the derived constants are committed to `syncConstants.ts` with the observed distributions noted. Then tag **`sync-known-good-2026-07-24`** — locking the Hirschberg pipeline, two-signal gate, skip-unmatched semantics (R4-1/R4-2), and snap tolerance as the new known-good baseline. The old `sync-known-good-2026-06-20` tag is **kept** as the historical pre-rewrite baseline (Decision 15). The repo also carries `sync-known-good-2026-06-23`/`-24`; the Decisions Log entry states that the new tag is the active bisect target. `project-state.md` invariant (a) (which still says "8 vitest tests") is updated to the new count and tag.

### 6.4 Manual test plan (separate from vitest)

1. **294-segment macOS Intel reproducer** — must still sync correctly and within acceptable wall-clock time (validates Hirschberg cost at scale; use `__ALIGN_INSTRUMENT__`, `whisperService.ts:236-257`).
2. **The s2-on-"lot" project** — s2's boundary must land at/on "on", not "lot" (validates 3.1 per Section 4.5).
3. **Cross-script mismatch** — a real voiceover against an unrelated scene doc: must hard-abort with the full-mismatch message; project state untouched.
4. **Partial-coverage project (R4-1/R4-2)** — s1 + s16–s51 unscripted, s2–s15 spoken: the timeline is built from the spoken scenes ONLY, at their real audio timestamps; the unscripted scenes do not appear anywhere on it; no abort. A middle-gap variant (2+ consecutive unmatched between matched) must likewise skip, not abort, and leave a visible hole in the timeline where those scenes would have been. The skip records (console, DEV) must name exactly the skipped scenes with the right reason.
5. **Export of a skipped-segment project** — the same project exported on BOTH paths (WebCodecs gate on and off): output duration = audio duration, the gap regions render as whatever the no-segment path produces, no truncation. No export-code change was made (§3.14), so this is a regression check, not a verification of new behavior.
6. **Preview of a skipped-segment project** — the same project in preview: the audio plays continuously as one file, covered segments appear at their real timestamps, the playhead crosses gap regions without stalling, and playback stops/resets at audio end exactly as today. No playback-code change was made (§3.15), so this too is a regression check.
7. **Punctuation cases** — `10:30` / `10.30` / `10,30` in scene text vs. spoken "ten thirty": no neighbor desync (B2 verification).
8. **Non-English audio (R6)** — detect pass picks the language; transcription runs on the multilingual model; the warning shows; sync proceeds; an English file still transcribes on the `.en` model (verify via logs).
9. ~~**Existing-project re-parse spot check (R5/N4)**~~ — **moot (WS5, 2026-07-29): the parser was not changed**, so no re-parse discrepancy can occur. Replaced by a standing manual check whenever the parser IS eventually fixed: re-sync a real saved project and confirm the segment count is unchanged for a doc with no mid-line brackets.

---

## 7. Implementation Order

```
WS1 (foundation: Hirschberg aligner + normalizer + coverage + two-signal gate)
 ├──> WS2 (skip-unmatched filter + skip records + last-end standardization
 │         — Round 4 collapsed this workstream: no interpolation, no char-rate,
 │         no floor scoping, no export or playback change)
 ├─ WS3 (snap tolerance clamps)  — independent (pure clamp on existing
 │                                  AlignResult fields)
 ├─ WS4 (hardening: strip + TAG_REGEX (R5/N4), dual-model language (R6),
 │        SyncWarning surface (R10), fail-loud, Option<f64>)  — independent
 └──> WS5 (tests + R8 threshold tuning + tag) — depends on WS1–WS4
        └──> WS6 (docs) — last, after verification
               └──> WS-logs (persistent sync log, R4-4) — follows this rewrite
```

**Recommended sequence:** WS1 → WS2 → WS3 → WS4 → WS5 → WS6. WS1+WS2 are the coupled core and re-baseline the tests once. WS3 and WS4 can run in parallel with each other and with WS2 (disjoint line ranges except `whisperService.ts`, where conflicts are trivial). The R6 model provisioning (a download + README update) can happen any time before WS4's whisper.rs work. R8's tuning pass is strictly last-before-tag: it needs all behavior final.

**Test discipline during WS1–WS4:** the existing 23 tests will be red from WS1 until WS5 re-baselines them. WS1 carries a minimal new-aligner test set from day one (6.2 items 1, 4, 14, 15) so the suite is never red-without-replacement.

---

## 8. Risks and Tradeoffs

1. **The 23-test re-baseline is deliberate, not accidental.** These tests lock the *current* matcher's exact outputs, including its bugs; a rewrite keeping them all green would by definition not have fixed B2. Mitigation is discipline: every re-baselined expected value is hand-verified against its fixture (6.1), and the qualitative invariants (contiguity, Σ-duration on fully-covered projects, no slivers, tape-deck ordering) must survive untouched. Under R4-5 those invariants stay unscoped — every committed segment is audio-covered.
2. **Skip-unmatched is a visible behavior change: segments the user wrote can silently vanish from the timeline (R4-1/R4-2).** A project that today produces 51 segments may produce 14, and the remaining 37 scenes simply are not there. This is the ruled-on intent — the audio is the source of truth — but it is the single biggest user-facing risk in the rewrite, and its mitigation is **entirely** the skip log (R4-4): until WS-logs ships the persistent, user-visible log, a skipped segment is only reported in a DEV console line. **WS-logs is not optional polish; it is the mitigation for this risk.** Note also what did NOT change: `project-state.md` invariant (b) (Σ content-segment duration = voiceoverDuration) still holds over the audio-covered region, the timeline never exceeds the audio duration, and invariant (e) (`anchorSource` provenance) is untouched.
3. **Gaps are a timeline state the rest of the app has never had to render.** A skipped segment leaves a region where `currentSegment` resolves to nothing while the audio keeps playing. The preview, export, and timeline UI all already have no-segment code paths, so no change was needed — but "no change was needed" is a claim that must be *checked*, not assumed: manual tests 6.4 items 5–6 are regression checks on exactly this, on both export paths and in preview.
4. *(Removed — the preview fallback clock (N2) is cancelled; `usePlayback.ts` is not modified. §3.15.)*
5. *(Removed — a "Phase 2" of gap-region timeline UI affordances (gap rendering, waveform treatment across gaps, coverage marks) was once postponed here; it is out of scope, not planned, and superseded by the skip-unmatched design landing as the complete, permanent behavior. Phase 1's audio-true timeline plus the skip log (WS-logs, landed 2026-07-25) is the whole of it. §3.5.)*
6. *(Removed — `Project.lastSyncObservedRate` (N3) is not added; the rewrite persists no new field. §4.)*
7. **Installer size +~74MB (R6).** The multilingual `ggml-base.bin` ships alongside the English model — accepted explicitly by the user's ruling. Provisioning follows the existing gitignored-model pattern (`.gitignore:17-18`, `src-tauri/models/README.md`); CI/build docs must be updated or fresh checkouts will build without the new model — the detect pass degrades gracefully (R6 step 5: detection failure falls back to the English model).
8. **Detect-then-transcribe latency (R6).** Every transcription gains a detect-only pre-pass (small); non-English audio pays a full second transcription on the multilingual model. Progress UX: the detect pass reports no percent (brief 0% phase) — accepted. The existing transcode-to-WAV step (`whisper.rs:115-150`) runs once and its output is reused by both passes.
9. **Hirschberg implementation complexity (R7).** Meaningfully harder to implement correctly than full-matrix NW — recursive divide-and-conquer, forward+backward scoring passes, and the free-end-gap boundary handling (3.1(c)). The mitigation is structural: the Hirschberg≡NW property test (6.2 item 14) with a test-side full-matrix reference implementation is the non-negotiable correctness gate, and it must include free-end-gap fixtures specifically.
10. **`TAG_REGEX` line-anchoring — risk retired, replaced by a standing defect (R5/N4).** The re-parse risk described here never materialized because the change was never made (WS5, 2026-07-29). What remains open instead is the *original* defect: a mid-line `[laughs]`/`[coughs]`/`[music]` in a scene doc silently becomes its own segment and claims an asset slot. Impact is confined to docs that use inline annotations; correctly-authored docs are unaffected either way. Locked by regression tests so a future fix is visible. See the §3.8 status block.
11. **Cross-platform validation gap.** Verified on macOS Intel first; macOS arm64 and Windows/WebView2 remain unverified until hardware is available (the project's standing pattern). The rewrite is mostly pure TS; the only sidecar-invocation change left after Round 4 is WS4's `whisper.rs` work (dual model, detect pass) — R2's mux change is cancelled, so no export invocation changes on any platform.
12. ~~**Near-match partial credit (S3) can mis-anchor.**~~ **CLOSED AS MOOT (WS5, 2026-07-29).** No prefix-credit constant was ever built, and none is now planned: WS5 measured that plain global alignment already handles both repeated phrases (resolved by position, not first occurrence) and inflected forms (worst case 0.5, above `LOW_CONFIDENCE_RATIO`; realistic 0.71–0.75), so the partial credit this risk was about has no behavior to buy. The mis-anchoring hazard ("care"/"careful") is precisely why it stays unbuilt. See the WS5 status block.

---

## 9. Decisions Log entries (to append to `project-state.md` AFTER implementation + hardware verification — not now)

Checklist only; `project-state.md` records closed work, `docs/history.md` records verified closed work, and this rewrite is open until verified.

1. **Sync matcher rewritten to a token-level diff aligner (NW scoring, Hirschberg linear-space traceback, free end-gaps)** — supersedes the greedy positional matcher and all D16 cursor guards; why (B2/G3), what was deleted, the Hirschberg≡NW property-test gate, test re-baseline note.
2. **Two-signal abort gate (contiguous covered-run + bidirectional noise floor) + hard abort** — explicitly recording that **R13 superseded Decision 8's "both directions < 0.4" aggregate rule**, and that **R4-1 removed the R12 middle-gap abort from the gate entirely**; the tuned constants and the R8 fixture distributions behind them; the exact user-facing message; the no-partial-timeline guarantee for the full-mismatch case (B1 closed).
3. **Skip-unmatched semantics (R4-1/R4-2/R4-5)** — uncovered segments are filtered out of the committed timeline rather than aborted (reverses R12) or char-timed (reverses the partial-coverage fallback design); no `anchorSource:'fallback'`, no three-tier char-rate, no persisted `lastSyncObservedRate`, no floor scoping; skip records (`segmentIndex`/`segmentText`/`reason`) produced for the log; explicit note that invariants (b) and (e) did NOT need amendment after all.
4. *(Dropped — export audio padding (R2) was cancelled by R4-2; no export change to log.)*
5. *(Dropped — the preview fallback clock (N2) was cancelled by R4-2; no playback change to log.)*
6. **Unified alignment normalizer** — NFC + ZW-join + hyphen-preserve with the `NUMBER_WORDS` carve-out (R1) adopted onto the timing path.
7. ~~**Silence-snap clamps with `SNAP_TOLERANCE_SEC` ±150ms (R4)**~~ — logged 2026-07-25, then **superseded 2026-07-26** by the dead-clamp removal (§3.6): the clamps were deleted entirely once the silence-sharing fix proved them unreachable. The s2-on-"lot" innocence finding (Section 4.5) still stands regardless.
8. ~~**`TAG_REGEX` anchored to line-start (R5/N4)**~~ — **NOT SHIPPED; no Decisions Log entry of this kind will be written.** WS5 (2026-07-29) investigated and rejected the change as designed: it contradicts the multi-tag one-paragraph format the parser supports and has a test for, and no positional rule separates the two cases. The WS5 Decisions Log entry records the *investigation and the deferral* instead. Nothing about existing-project re-parse changes, because the parser did not change.
9. **Dual-model language handling (R6)** — both models bundled (+74MB accepted), detect-then-transcribe flow, model-specific `--dtw` selection, warn-not-block; provisioning docs updated.
10. **Hardening batch** — stage-direction strip grammar (D13), unified `SyncWarning` surface (R10), silence fail-loud (D11), empty-input aborts (D12), `Option<f64>` timestamp skip (D14).
11. **New regression tag `sync-known-good-2026-07-24`** — what it locks, that `sync-known-good-2026-06-20` is retained as the historical baseline and the new tag is the active bisect target; invariant (a) updated (test count, tag name).
12. **Persistent sync log (R4-4)** — logged by **WS-logs**, not this rewrite: what is recorded (skip notices, abort notices, warnings — sync-only messages), where it is stored, and that it survives app close/reopen so skipped segments are cross-verifiable.

---

## 10. Open Questions

### Round 2 Rulings (all LOCKED — applied throughout this doc)

| ID | Ruling (one line) |
|---|---|
| **R1** (was OQ1) | Hyphen-join default with a `NUMBER_WORDS` carve-out: hyphenated tokens whose sub-parts are all number words/digit runs split; everything else keeps the hyphen (`'thirty-seven'≡'37'` preserved, `co-operate` one token) — §3.2. |
| ~~**R2**~~ (was OQ2) | ~~Export mux pads audio to the timeline duration via `-af apad=whole_dur=…` on both export paths.~~ **SUPERSEDED by R4-2** — nothing extends past the audio, so no padding is needed; not implemented (§3.14). |
| ~~**R3**~~ (was OQ3) | ~~Three-tier char-rate: observed → project historical (`Project.lastSyncObservedRate`) → global default 15 chars/sec.~~ **SUPERSEDED by R4-2** — char-based fallback timing is eliminated; the constants are deleted (§3.5). |
| ~~**R4**~~ (was OQ4) | ~~Snap clamps carry `SNAP_TOLERANCE_SEC = 0.150` (half of Whisper's ~300ms error) on both sides — not exact bounds.~~ **Superseded 2026-07-26** — the 2026-07-25 silence-sharing fix made the clamps conditional on `!silenceFound`, at which point the no-silence branch's token midpoint could never actually be moved by them; the clamps were removed entirely as dead code. Boundary is now: silence center when found, token midpoint when not — §3.6. |
| **R5** (was OQ5) | `TAG_REGEX` anchored to line-start (parser change IN SCOPE, WS4); mid-line `[...]` no longer splits scenes — §3.8. |
| **R6** (was OQ6) | Bundle BOTH whisper models (+74MB accepted); detect-only pass on the multilingual model, then transcribe on `.en` (English) or multilingual (non-English, with warn-not-block); detection failure → English fallback — §3.9. |
| **R7** (was OQ7) | Hirschberg from the start (O(n+m) space, same optimal alignment) — not a measured fallback — §3.1. |
| **R8** (was OQ8) | Thresholds derived from fixture confidence distributions (4 named fixtures, separation-with-margin method); 0.4/2/0.1 are starting points; constants in one exported module; explicit WS5 tuning step — §3.3, §6.3. |
| **R9** (was OQ9) | Classification ignores locked status (a gap is a gap). *Partially superseded by R4-1:* there is no aborting gap anymore, so the locked-segment message variant is deleted; the "locked status is irrelevant to coverage classification" half stands — a locked, uncovered segment is skipped like any other (§3.5). |
| **R10** (was OQ10) | All warnings unify through a single `SyncWarning` type + `onSyncWarning` dispatcher owned by `useWhisper`; both paths funnel; one UI surface — §4, §3.9–3.11. |
| **R11** (was M1) | Per-segment confidence extraction from the global alignment formalized (t0/t1 from first/last matched word; confidence = matched/total; zero matches = uncovered) — §3.1.1. |
| ~~**R12**~~ (was M2) | ~~Single uncovered segment between covered neighbors INTERPOLATES (`MAX_INTERPOLABLE_GAP = 1`); 2+ consecutive abort.~~ **REVERSED by R4-1** — no gap of any length aborts, and nothing interpolates; uncovered segments are skipped (§3.4, §3.5). |
| **R13** (was M3) | Two-signal abort gate: contiguous covered-run length (primary, `MIN_COVERED_RUN_LENGTH` = 2) + bidirectional noise floor (secondary, `NOISE_FLOOR_COVERAGE` = 0.1); supersedes Decision 8's "both < 0.4" aggregate rule — §3.3, §3.4. |

### Round 3 Rulings (all LOCKED — applied throughout this doc)

| ID | Ruling (one line) |
|---|---|
| ~~**N1**~~ | ~~Interpolated/fallback slivers are ACCEPTED: the duration floors apply to whisper-anchored segments only.~~ **MOOT under R4-5** — there are no fallback segments, so the floors apply uniformly to all (audio-covered) committed segments; no scoping logic (§3.5, §6.1, §6.2). |
| ~~**N2**~~ | ~~Preview playback continues past audio end on a wall-clock fallback.~~ **SUPERSEDED by R4-2** — the timeline never extends past the audio; `usePlayback.ts` is not modified (§3.15). |
| ~~**N3**~~ | ~~`Project.lastSyncObservedRate?: number` is ACCEPTED as the rewrite's only persisted field.~~ **SUPERSEDED by R4-2** — it was tier 2 of the char-rate; with no char-rate it has no consumer. The rewrite persists NO new field (§4). |
| **N4** | The `TAG_REGEX` re-parse behavior change ships SILENT (no `SyncWarning`); the coverage gate catches genuinely wrong outcomes; the change is documented in the post-implementation Decisions Log — §3.8, §9 item 8. |

### Round 4 Rulings (all LOCKED — applied throughout this doc, 2026-07-25)

Round 4 replaces the partial-coverage design wholesale. Where an earlier ruling conflicts, **Round 4 wins**.

| ID | Ruling |
|---|---|
| **R4-1** (reverses R12) | **Unmatched segments are SKIPPED from the timeline, not aborted.** Middle gaps no longer trigger a hard error — a gap of any length is fine. The audio plays continuously as one file and is the source of truth; matched segments appear at their real audio timestamps; unmatched segments simply don't appear. **No stitching, no splitting, no muting** of the audio, and no stretching of neighbouring segments to close a gap — §3.4, §3.5. |
| **R4-2** (reverses the partial-coverage fallback design) | **Character-based fallback timing is ELIMINATED.** All unmatched segments are skipped — no leading char-fallback, no trailing char-fallback, no single-segment interpolation. A segment is either audio-covered (appears on the timeline at its Whisper-anchored time) or skipped (does not appear). This removes the need for `anchorSource: 'fallback'`, the three-tier char-rate (**R3**), `Project.lastSyncObservedRate` (**N3**), export audio padding (**R2**), and the preview fallback clock (**N2**) — **those entire subsystems are no longer needed** — §3.5, §3.14, §3.15, §4. |
| **R4-3** (preserves R13) | **The full-mismatch abort stays.** If zero contiguous covered runs exist (longest run < `MIN_COVERED_RUN_LENGTH`) OR bidirectional coverage < `NOISE_FLOOR_COVERAGE`, abort with *"This voiceover doesn't match your scene doc. No timeline will be created."* This catches the cross-script mismatch case (**B1**) — §3.3, §3.4. |
| **R4-4** (new — skip logging) | **A persistent log records which segments were skipped and why.** The log survives app close/reopen and is stored on the project so teammates can cross-verify. Scope: **sync-only messages** — skip notices, abort notices, warnings. Implementation is a separate workstream (**WS-logs**) following this one; this rewrite produces the `SkippedSegmentRecord[]` and DEV-logs it — §3.5(c), §4, §5. |
| **R4-5** (reverses N1 — sliver floor) | Since unmatched segments are skipped (not interpolated), the sliver-floor concern (**N1**) is **moot** for fallback segments — there are none. The `MIN_SEGMENT_DURATION` floor applies **uniformly to all committed (audio-covered) segments** — §3.5, §6.1. |

### Final re-analysis (Round 3 close-out — superseded in part by Round 4)

The full doc was re-read after applying N1–N4, checking specifically for: contradictions among the 17 rulings (N1 vs. the test floor invariants — resolved by the `:210`/`:247` scoping in §6.1 and tests 6–7 in §6.2; N2 vs. R3 rate consistency — resolved by construction, the fallback clock advances real seconds over durations already computed from the char-rate; N3 vs. §3.7's no-persistence rule — resolved by the explicit scalar-vs-per-segment distinction in §3.7 and §4; N4 vs. R10's unified warnings — consistent, N4 deliberately adds no warning and §3.8 says so; R2 vs. N2 — both in WS2, both gated on the same trailing-fallback condition), missing specifications (every §3 subsystem states algorithm, data flow, file:line touchpoints, error handling, and test coverage; no TBD language remains), missing file touchpoints (§5 covers `usePlayback.ts` in WS2, `types.ts` with `lastSyncObservedRate` and `SyncWarning`, both export files in WS2, `whisper.rs` + model provisioning in WS4, `syncConstants.ts` in WS1), missing test cases (§6.2 covers sliver acceptance and floor retention (N1), §6.4 covers fallback-clock preview (N2), §6.2 item 9 covers the persisted-rate tiers (N3), §6.2 item 12 + §6.4 item 9 cover the parser change (R5/N4)), and implementation-order soundness (§7 reflects WS2's expanded scope and WS4's parser + dual-model additions).

*(The paragraph above records the Round 3 close-out as it stood on 2026-07-24. Round 4 cancelled several of the tensions it resolved — N1 vs. the floor invariants, N2 vs. R3 rate consistency, N3 vs. §3.7, R2 vs. N2 — by removing both sides of each: with fallback timing eliminated there is no fallback floor, no fallback clock, no persisted rate, and no export overhang.)*

### Final re-analysis (Round 4 close-out)

The doc was re-read after applying R4-1…R4-5, checking for residue of the cancelled design: §3.4's gate is now three checks (empty-input → R13 Signal 1 → R13 Signal 2) with the R12 step and both gap messages deleted; §3.5 is a single filter with no timing logic; §3.14/§3.15 are retained but marked SUPERSEDED/NOT IMPLEMENTED at the top so no future reader implements them; §4 carries no `'fallback'` `anchorSource`, no persisted field, and gains the `SkippedSegmentRecord` shape; §5's WS2 is two rows (the filter, and the unrelated §3.13 clamp) plus an explicit list of the five files no longer touched, and a WS-logs row; §6.1/§6.2/§6.4 replace the abort tests with skip tests and delete the char-rate/interpolation/sliver/apad items; §8 replaces the export-padding, playback, char-rate, and persisted-field risks with the one risk skip-unmatched actually creates (segments silently vanishing, mitigated by R4-4's log); §9's checklist drops the R2/N2 entries and adds the WS-logs entry. The constants preamble and §5's `syncConstants.ts` row both name the four deleted constants.

**No remaining open questions. The doc is implementation-ready.**

---

## Quick Bugs to Fix (surfaced during WS1a verification)

Three bugs surfaced during WS1a's manual verification pass, none of them WS1a regressions — one is a pre-existing parser gap (QB1), one is a pre-existing, previously-abandoned playback bug that resurfaced (QB2), and one is the re-attributed remainder of the s2-on-"lot" case study (QB3, Section 4.5). **None are fixed in this commit** — documented here as queued work for the next workstream.

### QB1 — RTF residue in `.txt` file reading

- **Symptom:** A script or scene-doc file that is actually RTF-formatted inside but carries a `.txt` extension (macOS TextEdit embeds real RTF markup when saving a Rich Text document, regardless of extension, unless the user explicitly runs Format → Make Plain Text first) syncs with leftover formatting noise — font names like "Helvetica", color-table entries, and other RTF metadata text end up mixed into segment text instead of being fully stripped.
- **Root cause:** `src/services/textUtils.ts:15` — the detection gate, `if (!text.trimStart().startsWith('{\rtf')) return text;` — correctly identifies genuine RTF content and does fire for a TextEdit-saved `.txt` file, so stripping does run. The gap is in the stripper itself: `src/services/textUtils.ts:86-90`, the character-walk parser's plain-text emission condition, `if (depth >= 1) { result += ch; }`. RTF nests non-document metadata — the font table (`\fonttbl`), color table (`\colortbl`), `\stylesheet`, `\info`, and other "destination groups" — inside their own brace groups, which sit at depth ≥ 2. The walker only tracks generic brace *depth*, not *which control word opened each group*, so it cannot distinguish "inside the real document body" (depth 1) from "inside a nested metadata group" (depth ≥ 2) — both satisfy `depth >= 1` and both get their plain text emitted. Step 6's noise-line filter (`textUtils.ts:117-123`) only discards lines that are purely numeric or punctuation, so a leaked font or color name (e.g., "Helvetica;") survives as plain text and becomes segment content.
- **Fix approach:** Track destination-group control words explicitly (`\fonttbl`, `\colortbl`, `\stylesheet`, `\info`, the `\*` generic-destination prefix, etc.) during the character walk and suppress emission for their entire subtree regardless of depth, rather than the current blanket `depth >= 1` check.
- **Accepted limitations:** none identified yet — needs a fixture pass across a few real TextEdit-exported `.rtf`/`.txt` samples once implemented.
- **Files affected:** `src/services/textUtils.ts` (`stripRtfIfNeeded`, lines ~14–126).
- **Status:** RESOLVED. Manually verified: user staged an RTF-formatted .txt file; no font-table residue in segments. Fix: `skipDepth` counter suppresses emission inside destination groups (`\fonttbl`, `\colortbl`, `\stylesheet`, `\info`, `\pict`, `\object`, `\fldinst`, `\data`, `\themedata`, `\colorschememapping`) and `\*` starred destinations; body text and formatting control words unaffected. 9 unit tests added in `textUtils.test.ts`.

### QB2 — `usePlayback.ts` infinite update-depth loop

- **Symptom:** During voiceover playback, React can throw "Maximum update depth exceeded." First observed 2026-07-07 during unrelated CSS/Canvas2D effects-engine testing (`project-state.md`'s 2026-07-07 Decisions Log entry) and never root-caused — the team abandoned further patching of that rendering path entirely rather than chase it, and moved to the WebGL rebuild instead. It resurfaced during WS1a's manual verification pass; `src/hooks/usePlayback.ts` has not changed since 2026-07-01 (commit `ff5420b`), predating that 2026-07-07 report, so this is the same still-latent bug being hit again, not a new regression.
- **Root cause:** `src/hooks/usePlayback.ts:66-95` — the rAF `tick()` function. It calls `setCurrentTime(audio.currentTime)` unconditionally on every animation frame (`:70`, no guard against the new value being effectively unchanged from the previous one) and then re-schedules itself via `requestAnimationFrame(tick)` (`:94`) — a tick loop that re-triggers itself for the entire duration of playback, with no throttling beyond the browser's own paint cadence. The surrounding effect's dependency array (`:105`, `[isPlaying, voiceover]`) and the parallel no-voiceover `setInterval` path (`:127`) both deliberately exclude `segments` — mirrored into a ref (`:44-46`) instead — specifically so the loop doesn't restart every render, but neither path guards the `setCurrentTime` call itself. Because `App.tsx` derives values directly from `currentTime` on every one of those renders (`currentSegment`, `App.tsx:2024-2034`; the timeline auto-scroll effect, `App.tsx:2301-2327`), an unthrottled 60 Hz state-update stream is the expected steady-state — but it leaves no margin: any consumer of `currentTime` that reacts by scheduling a further state update on every tick (present or future) compounds against this same stream and can exhaust React's nested-update budget within a single flush, producing exactly the "Maximum update depth exceeded" symptom.
- **Fix approach:** Add a minimal-delta guard before calling `setCurrentTime` in `tick()` (skip the call when the new value hasn't meaningfully changed from the last committed one), and audit every `currentTime`-keyed consumer in `App.tsx` for an unconditional state-setter call in response to the 60 Hz stream.
- **Accepted limitations:** none yet — needs a runtime repro (React DevTools profiler or a stack trace from the actual "Maximum update depth exceeded" throw) to confirm the exact consumer that tips it over, since static review of `usePlayback.ts` alone does not show a synchronous self-trigger within a single React commit.
- **Files affected:** `src/hooks/usePlayback.ts`, and potentially `src/App.tsx`'s `currentTime`-keyed effects/memos (`:2024-2034`, `:2301-2327`) depending on the runtime repro.
- **Status:** RESOLVED. Manually verified: user ran Apply Sync, no `Maximum update depth exceeded` error; playback (play/pause/seek) works. Fix: delta guard in `tick()` (only `setCurrentTime` when `|audio.currentTime - currentTimeRef.current| > CURRENT_TIME_EPSILON_SEC` = 0.01s); both rAF and setInterval effects' dependency arrays stabilized (replaced `voiceover` object with derived `hasVoiceover` boolean, so asset-rebuilds during Apply Sync no longer restart the loop). 7 unit tests added in `usePlayback.test.ts` (mechanical verification of the epsilon boundary and dep-array identity, per the `useGlPreview.test.ts` precedent — the hook is not renderable in this repo's test setup).

### QB3 — Whisper timestamp accuracy on continuous speech (audio energy refinement)

- **Symptom:** On continuous speech with no silence between words, Whisper's word-level timestamps can be off by roughly 300ms. The s2-on-"lot" case (Section 4.5): Whisper reports both "lot" (end) and "on" (start) at the same 9.05s boundary, but in the real audio "lot" actually ends ~150–200ms later. The Hirschberg aligner matches correctly to "on" (confirmed post-WS1a, Section 4.5) — the boundary still lands at Whisper's own inaccurate 9.05s, which is mid-"lot" in the real audio.
- **Root cause:** Whisper timestamp imprecision — audit finding S11 (Section 2.2), confirmed at runtime via the (now-removed) `[s2-lot-diag]` trace.
- **Fix approach (Option 3 — hybrid):** When the silence-snap step (Section 3.6) finds no silence between two matched words, run audio energy analysis on the window `[lastSpokenEnd − 150ms, nextSpokenStart + 150ms]` (reusing R4's `SNAP_TOLERANCE_SEC`). Find the local energy minimum — typically the consonant-release-to-vowel-onset transition — and use that as the refined boundary. When silence *is* found, use the silence midpoint (current behavior, unchanged). When no clear energy dip is found, fall back to the midpoint (current behavior, unchanged).
- **Accepted limitations:** energy-dip refinement works well for consonant-to-vowel transitions (the s2-on-"lot" class) but not for vowel-to-vowel transitions (e.g., "see it"), where no clear energy dip exists. Accepted as a tradeoff — the alternative (spectral flux / formant analysis) is far more complex and approaches reinventing a forced aligner (Montreal Forced Aligner-class tooling).
- **Implementation scope:** new module `src/services/audioEnergyBoundary.ts` (~150–250 lines); threading the decoded `AudioBuffer` through from `fetchAndDetectSilences` (currently discarded after silence detection); integration into the silence-snap step's no-silence fallback path (Section 3.6); unit tests; integration tests; manual verification on the s2-on-"lot" project, the 294-segment project, and the special-chars fixture.
- **Relationship to WS1a:** s2-on-"lot" is now correctly attributed to Whisper timestamp accuracy (this bug), not the aligner — the Hirschberg aligner matches correctly to "on" (Section 4.5's post-WS1a confirmation). WS1a is complete and correct; QB3 is a separate, already-scoped concern.
- **Files affected:** new `src/services/audioEnergyBoundary.ts`; `src/services/whisperService.ts` (silence-snap integration, Section 3.6); `src/hooks/useWhisper.ts` (`fetchAndDetectSilences` threading).
- **Status:** DEFERRED — not a sync bug. Re-investigated with full acoustic data (wide-window spectral flux + energy + PCM samples). Findings: the sync boundary IS correct (UI shows 9.04s, Whisper says "on" at 9.05s, energy data confirms "on" vowel onset at 9.01-9.05s). The reported "boundary lands on lot" symptom is a project-specific playback issue — that one segment plays audio ~650ms early for unknown reasons; other segments in the same project play fine. The audio energy refinement code (`audioBoundaryRefinement.ts`) was removed as it addressed a non-existent sync problem. Revisit only if the playback issue is independently fixed and a real sync boundary inaccuracy is confirmed on a different case.
