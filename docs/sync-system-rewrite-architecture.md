# Sync System Rewrite — Target Architecture

> **Status: FINAL DESIGN — implementation-ready. Round 3 rulings applied 2026-07-24.** Written from a two-pass code audit plus final user decisions on every open question. Round 2 surfaced 10 open questions (OQ1–OQ10) and 3 reviewer findings (M1–M3); Round 3 surfaced 4 new questions (N1–N4). The user has ruled on all 17 — see Section 10's rulings tables. Every ruling is LOCKED and folded into the sections below as final design; the closing re-analysis found no remaining open questions. Nothing here is committed work; `project-state.md`'s Decisions Log entries are written only AFTER the rewrite lands and is hardware-verified (see Section 9).
>
> Ruling principle (user's words): *"industry level work, best, permanent, long term fix even if it takes more work or time."*
>
> Scope: the sync system only (scene doc + voiceover script + audio → timed timeline segments), plus the two changes the partial-coverage design forces outside it — export-mux audio padding (Section 3.14) and the preview fallback clock (Section 3.15). Not a general architecture doc — see `CLAUDE.md` for the rest of the app.

---

## 1. Executive Summary

The sync system takes a scene doc, a voiceover script, and an audio file, and produces a timed timeline. Today it produces a *plausible-looking* timeline for **any** combination of inputs — including a voiceover that has nothing to do with the scene doc — because its word matcher is a greedy positional scanner with only local, per-segment guards and no global measure of whether the two texts correspond at all. This rewrite replaces the matcher with an industry-standard token-level diff aligner (Needleman-Wunsch scoring with Hirschberg linear-space traceback, explicit insertions/deletions), adds a two-signal abort gate (contiguous covered-run check + bidirectional noise floor) for mismatched inputs, defines exact semantics for audio that covers only part of the scene doc (including export-side audio padding and a preview fallback clock), and closes a set of confirmed hardening gaps (silent failures, malformed timestamps, hardcoded English, stage directions matched as spoken words).

**The one-line behavioral contract:** *Audio is the source of truth for what it covers; unmatched segments use character-based timing; mismatched inputs hard-abort with a clear message.*

---

### Implementation Status

**WS1a — Hirschberg aligner + unified normalizer: COMPLETE and verified on macOS Intel x86_64.**

- **What landed:** the Hirschberg diff aligner (O(n+m) space, free end-gaps on the subject side, per-segment confidence extraction — Section 3.1/3.1.1), the unified normalizer in `src/services/textNormalize.ts` (NFC, ZW-join, the R1 hyphen carve-out with `NUMBER_WORDS` — Section 3.2), and `src/services/syncConstants.ts` (scoring constants, `NUMBER_WORDS`, `LOW_CONFIDENCE_RATIO`). 23 existing sync tests were re-baselined and 14 new WS1a cases added — **768/768 passing**.
- **Bugs fixed by WS1a:** B2, S1, S2, S3, S4, S5, G3, G4 (Section 2.2/2.3) — confirmed against the synthetic special-chars fixture and the 294-segment project.
- **Bugs NOT fixed by WS1a:** the s2-on-"lot" visual offset is correctly attributed to Whisper timestamp accuracy, not the aligner — see the re-attribution note in Section 3.6 and QB3 below. B1 (the abort gate) is WS1b. S6–S8, S10, S13–S21 remain later workstreams, per the file-by-file plan in Section 5.
- **Cross-platform validation gap:** verified on macOS Intel x86_64 only. macOS arm64 and Windows/WebView2 remain unverified until hardware is available — the project's standing pattern (see `project-state.md`'s Decisions Log for prior instances of this same gap).
- **Static checks:** `tsc --noEmit` clean, `vitest run` 768/768. Manual verification on real fixtures confirmed the aligner and normalizer behave correctly. The s2-on-"lot" visual offset is **not** a WS1a defect — see the re-attribution note below and QB3.

See the "Quick Bugs to Fix" section (after Section 10) for the 3 bugs surfaced during WS1a's manual verification pass — queued, not fixed, in this workstream.

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
| **S3** | Greedy positional match, no partial-word/stemming; "world"≠"worlds". | `whisperService.ts:334` |
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

All tuning constants introduced below (`LOW_CONFIDENCE_RATIO`, `MIN_COVERED_RUN_LENGTH`, `NOISE_FLOOR_COVERAGE`, `SNAP_TOLERANCE_SEC`, `MAX_INTERPOLABLE_GAP`, `FALLBACK_RATE_MIN_CHARS`, `FALLBACK_RATE_MIN_SECONDS`, `DEFAULT_CHARS_PER_SEC`, `NUMBER_WORDS`) live in **one new exported module, `src/services/syncConstants.ts`** (R8 point 5, R3, R12, R13) — no constant is defined inline at its use site.

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
4. **Zero-token segments** — text that is empty or normalizes to zero words (including text fully consumed by stage-direction stripping where the keep-original guard of 3.8 doesn't apply because the raw text itself was empty; today's handling at `whisperService.ts:301-311`): classification-**neutral**. They are neither covered nor uncovered — they are excluded from the covered-run scan (3.4), the gap scan (3.5/R12), and both coverage denominators (3.3), and they keep today's behavior of anchoring at the previous segment's boundary (`:303,310`). Rationale: an intentionally-textless segment must not be able to trigger a 2-consecutive-gap abort or dilute the coverage metrics.
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

**(d) Files/lines.** `whisperService.ts` (aligner return type + computation), `useWhisper.ts:27-48` (threads the coverage result), `App.tsx:1806-1826` (orchestrator consumes it), `syncConstants.ts`.

**(e) Why two signals.** Run-length is robust to document length (a 3-segment project and a 300-segment project both prove correspondence with one real contiguous run), while an aggregate-only gate mis-scales: 14 covered segments out of 51 is a legitimate partial-coverage project at ~27% scene-doc coverage — an aggregate-0.4 gate would wrongly abort it. The noise floor covers the opposite failure: a couple of coincidental function-word matches forming a tiny "run" over essentially-zero real overlap.

### 3.4 Abort gate + plain-language error messages (R9, R13)

**(a) Today.** No gate. `applySyncDisabled` (`App.tsx:2177`) only requires that a transcript *exists*; the commit at `App.tsx:1838-1850` happens unconditionally once timing is computed.

**(b) After.** A gate in `handleApplySyncFromFiles` between alignment and commit (immediately after the `alignFromCache` call at `App.tsx:1809-1814`, before `preserveEffectFields`/`setProject` at `:1829-1850`). On abort: the failure surfaces through the unified `SyncWarning` surface (R10, severity `'error'`), `setIsProcessing(false)`, `return` — **no partial timeline is committed; the pre-sync project state is untouched** (free today because the commit is already a single atomic `setProject`).

**(c) The gate — two-signal flow (R13), exact order:**

1. **Align** (Hirschberg) → per-segment `matched`/`confidence`/`t0`/`t1` (3.1.1); zero-token segments excluded from all scans below.
2. **Middle-gap check (R12):** if any run of **2+ consecutive uncovered segments** exists between covered segments → **abort**:
   `"Audio does not exist for segments X to Y. Cannot create timeline."` (X/Y 1-based; first offending run named if several exist). **If any segment in the run is locked (R9)**, the message is the specific variant:
   `"Segment X is locked but has no audio coverage. The audio does not cover segments Y to Z. Cannot create timeline."`
   (A single uncovered segment between covered neighbors does NOT abort — it interpolates, 3.5.)
3. **Contiguous covered-run check (Signal 1, primary):** compute all maximal contiguous runs of covered segments. If the longest run < `MIN_COVERED_RUN_LENGTH` (start 2; tuned per R8) — i.e., 0 or 1 covered segments — this is near-zero coverage (the B1 case) → **abort**:
   `"This voiceover doesn't match your scene doc. No timeline will be created."`
4. **Noise-floor check (Signal 2, anti-noise):** if bidirectional coverage (3.3) < `NOISE_FLOOR_COVERAGE` (start 0.1; tuned per R8) → **abort** with the same full-mismatch message. Catches a technically-contiguous run built on coincidental word overlap.
5. **Proceed** with partial-coverage sync (leading/trailing fallback + single-segment interpolation, 3.5).

Plus the empty-input checks (3.11), which run before alignment:

- **Empty scene doc** (parse produced zero segments, `App.tsx:1789-1793` — today a console.warn; also the fresh-project case that currently falls through silently):
  `"Your scene doc has no scenes to sync. Add scene tags and try again."`
- **Empty transcript** (zero tokens on the cached path — today only the fresh-transcription path warns, `useWhisper.ts:142-167`):
  `"No speech was found in the audio. No timeline will be created."`

Note on the staging path: `startTranscription` is invoked at staging time with `segments: []` and a no-op `onSegmentsUpdated` (`App.tsx:1660-1675`), so it caches tokens but never commits timing — the orchestrator gate above covers every commit path that exists today. The alignment code inside `useWhisper.ts:170-197` (fresh-path alignment) is retained and gains the same coverage plumbing for consistency, but the gate's enforcement point is the orchestrator.

**(d) Files/lines.** `App.tsx:1806-1850` (gate + messages), `useWhisper.ts` (plumbing), `whisperService.ts` (inputs), `syncConstants.ts`.

**(e) Why hard-stop (Decision 1).** No partial timelines, no escape hatch: a garbage timeline costs the user more than a blocked sync, and every "proceed anyway" path becomes a support burden. Messages are plain language by design — the audience is YouTube creators, not developers. The locked-segment variant (R9) exists because "your locked segment is inside the uncovered region" is actionable in a way the generic gap message is not.

### 3.5 Partial-coverage sync logic (R2, R3, R9, R12, N1, N3)

**(a) Today.** Every segment gets *some* Whisper-derived window no matter what; segments with no spoken counterpart get near-zero slivers at the cursor (overshoot guard `:361-370`) or absorb neighbors (S6). There is no concept of "this segment has no audio."

**(b) After — classification and gap rule (R12).** Using per-segment covered flags from 3.1.1 (zero-token segments excluded/neutral throughout; **classification ignores locked status** — a gap is a gap whether or not a segment in it is locked, R9):

- **0 uncovered segments between covered regions:** normal flow.
- **Exactly 1 uncovered segment between two covered segments (≤ `MAX_INTERPOLABLE_GAP` = 1): INTERPOLATE, don't abort.** The segment takes the window between its covered neighbors: `t0 = prev.t1`, `t1 = next.t0` (timeline contiguity — `applyAnchorBasedTiming` derives durations as next-anchor − this-anchor, `syncEngine.ts:221-237`, so the window must be filled exactly; with a single segment, R12's "proportion the window by char-rate" degenerates to the segment occupying the whole window — the shared char-rate helper still owns the math so multi-segment windows, if `MAX_INTERPOLABLE_GAP` is ever raised, proportion correctly). `anchorSource = 'fallback'`. This absorbs Whisper's routine single-word drops without killing the sync.
- **2+ consecutive uncovered segments between covered regions: HARD ABORT** (gate step 2 in 3.4, with the R9 locked-segment message variant when applicable).
- **Leading-unmatched** (before the first covered segment): character-based timing packed into `[0, t0(firstCovered))` — the audio-covered region starts at `firstCovered`'s Whisper t0, not 0:00 (Decision 5; the window interpretation is confirmed by R3's own text, "interpolated into the window `[0, t0(firstCoveredSegment)]`"). `anchorSource = 'fallback'`.
- **Trailing-unmatched** (after the last covered segment): character-based durations appended after `lastCovered`'s end; the timeline extends past the audio file's duration. `anchorSource = 'fallback'`. **Hard dependencies, shipped in the same workstream:** the export-mux audio-padding change (3.14/R2) and the preview fallback clock (3.15/N2) — both are "timeline extends past audio" concerns; without them, trailing segments are silently truncated at export and unreachable in preview.

**Duration floors (N1 — final).** The `MIN_SEGMENT_DURATION` floor (0.3s, `App.tsx:263`) applies to **`anchorSource:'whisper'` segments only**. **`anchorSource:'fallback'` segments have NO minimum duration floor** — their duration is whatever the interpolation window (R12) or char-rate (R3) produces, clamped only at ≥0 for degenerate inputs. Concretely, the code-level 0.1s floors at `whisperService.ts:552` (`Math.max(0.1, …)` in `distributeSegmentTimes`) and `syncEngine.ts:235` (`Math.max(0.1, …)` in `applyAnchorBasedTiming`) are made conditional on the segment's classification: retained for whisper-anchored segments, relaxed to a non-negative guard for fallback segments. Rationale: audio truth must not be distorted to satisfy a cosmetic floor — widening a sliver requires moving an audio-anchored neighbor's boundary off its measured position, corrupting real timing. A visually-tiny fallback segment is correct data; Phase 2's UI will flag it visually (deferred, not Phase 1).

**Character-rate — three-tier strategy (R3), shared by leading, trailing, and interpolation windows:**

1. **Observed rate** — seconds-per-character computed from the audio-covered segments of *this* sync. Used when the covered region is statistically significant: ≥ `FALLBACK_RATE_MIN_CHARS` (100) characters of scene-doc text AND ≥ `FALLBACK_RATE_MIN_SECONDS` (30) seconds of audio. Most accurate — reflects the actual narration pace.
2. **Project historical rate** — when this sync's covered region is too small, use `Project.lastSyncObservedRate` (N3 — accepted; Section 4): the observed rate persisted from the project's most recent sync whose covered region *did* clear the tier-1 thresholds. Written on every successful qualifying sync. Handles short-audio edge cases without collapsing to a global default. Absent on old projects → tier 2 falls through to tier 3 until the first qualifying sync under the new system.
3. **Global default** — `DEFAULT_CHARS_PER_SEC` (15 chars/sec, ~average English narration pace). Used only when neither tier above is available.

All three tier constants live in `syncConstants.ts`. Leading segments proportion their char-rate-implied durations *into* the fixed window `[0, t0(firstCovered))` (scaled to fit exactly); trailing segments use the rate directly (no bounding window). The earlier "no Project changes" posture is amended to: **one additive scalar field, no structural changes** (N3; Section 4).

**(c) The change — where each piece lives.**

- The aligner emits classification per segment (3.1.1 + a ~10-line contiguity scan).
- `distributeSegmentTimes` (`whisperService.ts:543-562`) is the insertion seam: its map (`:548-560`) currently writes `anchorStart`/`anchorSource:'whisper'` unconditionally; it gains the per-segment classification and writes `anchorSource:'fallback'` + char-based/interpolated anchors for leading/trailing/interpolated segments (char-weight math extracted from the bootstrap at `App.tsx:417-422` into a shared helper), with the N1 conditional floor.
- `applyAnchorBasedTiming`'s PASS 3 (`syncEngine.ts:239-243`) clamps the LAST segment to `audioDuration` — with trailing fallback segments this would crush them. The clamp moves to the last *audio-covered* segment; trailing fallback segments keep their char-based durations after it. Conditional on fallback segments existing, so fully-covered projects are byte-identical. The `:235` floor becomes classification-conditional (N1).
- **Timeline UI changes are POSTPONED** (Decision 5): audio-offset rendering, hiding the waveform under non-audio segments, visible coverage affordances, and the N1 short-segment visual flag — all Phase 2. Phase 1 delivers correct per-segment timings, coverage marks (`anchorSource:'fallback'`), correct export (3.14), and reachable preview (3.15).

**(d) Files/lines.** `whisperService.ts:543-562`, `syncEngine.ts:170-246` (incl. `:235` floor), `App.tsx:417-422` (helper extraction), `types.ts` (`anchorSource` union + `Project.lastSyncObservedRate`, Section 4), `syncConstants.ts`, plus the 3.14 export files and 3.15's `usePlayback.ts`.

**(e) Why the contiguous invariant with a 1-segment tolerance.** A 2+ segment gap means the scene doc and audio disagree about *structure* — silently bridging it is the garbage-timeline class the user reported. A 1-segment gap is overwhelmingly a Whisper transcription artifact (a dropped word or two), not a structural disagreement — aborting on it would make the gate brittle against routine ASR noise. Leading/trailing coverage has an obvious correct interpretation (intro/outro scenes without narration) and degrades gracefully.

### 3.6 Silence-snap guards with bounded tolerance (S21, R4)

**(a) Today.** The gap-fill (`whisperService.ts:452-512`) moves each boundary to a chosen silence's midpoint. Its only sanity check is backward-facing and weak: `boundary < results[i-1].t1` (`:506-508`) — comparing against the *previous boundary* (which the same loop may itself have moved), not real spoken-word extents; no forward check at all. A snap can relocate a boundary past the next segment's first spoken word (or before the current segment's last one), starting/cutting a segment mid-word.

**(b) After — clamps with ±150ms tolerance (R4).** The chosen `boundary` is clamped before assignment (`:500-511`):

- **Backward clamp:** `boundary ≥ tokens[curr.lastTokenIdx].endSec − SNAP_TOLERANCE_SEC` — the current segment's last *matched word's* end (the `lastSpokenEnd` value already computed at `:458`) minus the tolerance.
- **Forward clamp:** `boundary ≤ tokens[next.firstTokenIdx].startSec + SNAP_TOLERANCE_SEC` — the next segment's first matched word's start (`nextSpokenStart`, `:459`) plus the tolerance.
- **`SNAP_TOLERANCE_SEC = 0.150`** (`syncConstants.ts`) — half of Whisper's known ~300ms word-timestamp inaccuracy (the code's own comment, `:468-470`).
- If the clamp window is inverted or empty (degenerate timestamps), fall back to the token-boundary midpoint exactly as the existing fallback does (`:500-502`).

**Rationale for tolerance over exact bounds (R4):** exact clamps would forbid correct snaps that *compensate* for Whisper's timestamp error — the runtime diagnostic showed snaps of 0.44s/0.48s/0.47s that were all plausibly correct. ±150ms lets the snap correct for timestamp inaccuracy while preventing the unbounded relocation of S21.

**(c/d) Change + files.** ~8 lines in `whisperService.ts:500-511`; both clamp inputs already exist in scope; constant from `syncConstants.ts`. The existing `usedSilences` set and candidate-window logic are untouched.

**(e) Scope honesty — what these guards do NOT fix.** They do **not** fix the s2-on-"lot" case (Section 4.5): the runtime diagnostic proved that snap innocent. The guards fix *other* cases where a chosen silence genuinely relocates a boundary across a spoken word.

### 3.7 Coverage metadata storage — sidecar `CoverageMap`, not persisted

**(a) Today.** Nothing is stored; confidence is discarded.

**(b) After.** A `CoverageMap` (type in Section 4) lives only in the sync run's in-memory scope: produced by the aligner, consumed by the orchestrator's abort gate and `distributeSegmentTimes`' classification, then dropped. It is **not** written to `VideoSegment`, `Project`, localStorage, or IndexedDB. The "never persisted" framing refers to per-segment coverage metadata — confidence, matched flags, audio regions — which remain transient. `Project.lastSyncObservedRate` (N3, Section 4) is **not** coverage metadata: it is a single scalar narration-rate characteristic of the project, and persisting it does not create the staleness class this section guards against (a stale rate degrades a fallback *estimate* gracefully; stale per-segment coverage would misdescribe specific segments).

**(e) Rationale.** Sync metadata is transient — it describes one alignment run against one transcript, invalidated by any re-sync, text edit, or audio change. The durable per-segment signal is `anchorSource` (`'whisper' | 'estimate' | 'fallback'`), which already survives persistence and is enough for any future UI (Phase 2) to distinguish audio-backed from fallback segments. Persisting a richer map would create a staleness class of bugs for no current consumer.

### 3.8 Stage-direction / speaker-label stripping + parser fix (S19, R5, N4)

**(a) Today.** `(pause)`, `[laughs]`, `NARRATOR:` in a scene description become alignment target words (`App.tsx:312` feeds description text through; `whisperService.ts:179` tokenizes them like any word). Worse — and this is why the parser change is in scope — `TAG_REGEX` (`App.tsx:279`, also used by the backup pass at `:294`) splits scene blocks on **any** `[...]` occurrence via the lookahead `(?=\[[^\]]*\])`, so `[laughs]` mid-description creates a bogus new scene at parse time, *before* the aligner ever sees it. Aligner-side stripping alone cannot fix that.

**(b) After — two coordinated changes.**

**Parser fix (R5, in scope for WS4):** `TAG_REGEX` is anchored to **line start** — a `[` at the start of a line (optionally after whitespace) opens a scene tag; a `[` mid-line does not (e.g., split pattern anchored with `^`/`m`-flag semantics: a lookahead requiring start-of-line before the bracket). Behavior change, deliberate: a description line containing `[laughs]` no longer splits into two scenes. Both `TAG_REGEX` use sites (`App.tsx:279-280, 294`) change together.

**Re-parse of existing scene docs (N4 — final: ship silent).** A previously-saved scene doc containing mid-line `[...]` text parses to **fewer** scenes after this change (under clean-slate re-sync, `parseProjectData` rebuilds all segments from the stored `sceneDetails` on every Apply Sync). This is the **correct** behavior — mid-line brackets were incorrectly treated as scene tags before — and **no `SyncWarning` is surfaced for the re-parse discrepancy**: the coverage gate (R13) catches genuinely wrong outcomes, and correctly-authored docs (tags at line start) are entirely unaffected. The behavior change is documented in the post-implementation Decisions Log entry (Section 9, item 8) so it is recorded in project history.

**Alignment-side stripping grammar (Decision 13), conservative by construction:**

- Strip text inside `(...)` and `[...]` anywhere in the description text (mid-line brackets now reach the aligner thanks to the parser fix, and are stripped here).
- Strip an ALL-CAPS word (≥2 letters, allowing digits/spaces/periods between words) followed by a colon at the **start of a description line** — speaker labels like `NARRATOR:`, `VOICE 2:`. Mixed-case (`Narrator:`) is deliberately not stripped.
- If stripping would empty a segment's text entirely, keep the original text unstripped — a fully-parenthesized line is more likely a legitimate spoken aside than an empty scene.

**(c) Where it runs.** The strip is a pre-align text transform inside the aligner's target-side tokenization (a small pure function applied to `seg.text` before `normalize` at `whisperService.ts:307`) — **not** mutating `seg.text`: the displayed/edited segment text keeps the author's original; only the alignment view is stripped. The parser fix is in `parseProjectData`.

**(d) Files.** `whisperService.ts` (strip function + call site), `App.tsx:279-280, 294` (`TAG_REGEX`); tests in `syncTiming.test.ts` + a parser test (Section 6).

### 3.9 Language handling — dual-model detect-then-transcribe (S14, R6)

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

**(a) Today.** `fetchAndDetectSilences` (`useWhisper.ts:12-20`) catches everything and returns `[]`; a decode failure silently degrades every boundary to token-midpoint placement.

**(b) After.** The catch logs the real error and emits a `SyncWarning` (R10); additionally, a `[]` result for non-trivial audio (> ~30s — real narration always has pauses) emits the same warning (Decision 11). Message: `"Couldn't analyze pauses in the audio — segment boundaries may be slightly off."` Sync proceeds (quality degradation, not a correctness failure).

**(c/d) Change + files.** `fetchAndDetectSilences` gains an `onWarning?: (w: SyncWarning) => void` parameter threaded from both call sites (`useWhisper.ts:33, 170`); both funnel into the hook's single `onSyncWarning` dispatcher (R10, Section 4).

### 3.11 Empty-input handling (S15, R10)

**(a) Today.** Empty scene doc → zero segments → console.warn + silent return when prior segments exist (`App.tsx:1789-1793`), or a silent zero-segment commit on a fresh project; empty transcript on the cached path → all-zero timing with no message (`whisperService.ts:267-269`).

**(b) After.** Both cases abort with the messages in 3.4, surfaced through the unified `SyncWarning` surface (severity `'error'`) rather than ad-hoc toasts — one rendering path for every sync-produced warning/error (R10). The scene-doc check also covers the no-voiceover sync path (an empty scene doc aborts regardless of audio state).

**(d) Files.** `App.tsx:1786-1793` (scene-doc case), gate location per 3.4 (transcript case), `useWhisper.ts` (dispatcher).

### 3.12 Malformed-token skip (S10)

**(a) Today.** `parse_timestamp` (`whisper.rs:405-415`) returns `0.0` for anything that doesn't parse — a malformed line yields a token at t=0, breaking monotonicity for every consumer.

**(b) After.** `parse_timestamp` returns `Option<f64>` (the existing code is f64 end-to-end; the audit note's "f32" was shorthand) and returns `None` on wrong part count or any non-numeric part. `parse_stdout_tokens` (`:377-401`) skips a token when either timestamp is `None`; `parse_progress_line` (`:365-374`) propagates `None`. A skipped token is logged to stderr for diagnosability. The TS-side `parseTimestamp` (`whisperService.ts:26-34`) has the same flaw but is only used for progress display; harden it identically (return `null`, caller skips).

**(d) Files.** `whisper.rs:365-415` + its two callers; `whisperService.ts:26-34`.

**(e) Why skip rather than clamp.** A missing word-token is invisible to the diff aligner (one fewer transcript token — a local gap at worst; at most it turns one covered segment into an interpolable single-segment gap, R12); a t=0 token corrupts ordering globally.

### 3.13 Last-segment-end standardization (S7)

**(a) Today.** The aligner clamps the last segment to **Whisper speech-end** (`audioEnd = tokens[last].endSec`, `whisperService.ts:440, 515-517`). `applyAnchorBasedTiming` clamps to **file duration** (`syncEngine.ts:239-243`). The cached path runs both (file-duration wins, `useWhisper.ts:47`); the fresh-transcription path runs only `distributeSegmentTimes` (`useWhisper.ts:173-174`) and ends at speech-end — two paths, two answers.

**(b) After.** Both paths end the last segment at **file duration** (Decision 10). `alignScenestoTranscript` gains an `audioDurationSecs` parameter and clamps `:515-517` to it (falling back to speech-end only if the caller passes 0/undefined — defensive). `syncEngine.ts:242` already conforms. With trailing-fallback segments (3.5) the clamp applies to the last *audio-covered* segment instead — same rule, coverage-aware.

**(d) Files.** `whisperService.ts:259-263` (signature), `:515-517` (clamp), both call sites (`useWhisper.ts:34, 173`).

### 3.14 Export pipeline: audio padding for extended timelines (R2)

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

### 3.15 Preview playback: fallback clock for trailing segments (N2)

**(a) Today.** `usePlayback.ts`'s voiceover path is an rAF loop with the audio element as master clock (`usePlayback.ts:58-105`): every frame reads `audio.currentTime` (`:70`), and when `audio.ended` fires the loop **stops playback and resets to 0** (`:87-92`). With trailing-fallback segments (3.5), the timeline extends past the audio, so trailing segments are unreachable in preview — they export (3.14) but can never be watched. A separate wall-clock `setInterval` path already exists but only when NO voiceover is loaded (`:110-127`), advancing `0.1 × globalPlaybackSpeed` per 100ms tick (`:117`).

**(b) After — the fallback clock (N2, final).**

- **Audio end → fallback clock.** When the audio ends (the `audio.ended` branch, `:87-92`) and the timeline has trailing-fallback segments (Σ segment durations > audio duration), `usePlayback` does NOT stop/reset. It switches from the audio-clocked rAF loop to a **wall-clock fallback** — the same delta-time advance pattern as the existing no-voiceover path, scaled by `globalPlaybackSpeed` (matching `:117`) — and continues advancing `currentTime` from the audio's end to the timeline's end. At timeline end it stops and resets exactly as today's end-of-timeline branch does (`:79-84`). When no trailing-fallback segments exist, the `ended` branch behaves byte-identically to today.
- **Rate consistency with R3.** The trailing segments' *durations* were computed from the three-tier char-rate (R3) at sync time and are stored in seconds; a wall-clock advance (1 timeline-second per real second, × playback speed) therefore traverses each trailing segment in exactly its computed duration — preview timing and segment timing are consistent by construction, which is the ruling's requirement.
- **Scrub-back → audio sync resumes.** When the user scrubs to a position inside the audio-covered region (position < audio duration), the audio element seeks to that position and the audio-clocked rAF loop resumes as master clock. Scrubbing into the trailing region while playing (or starting playback from a paused position past audio end) starts the fallback clock directly, with the audio element left ended/paused.
- **Rationale.** Export and preview must not disagree about what the timeline contains: if trailing segments export (R2/3.14), preview must reach them. This is a **Phase 1** change, scoped into **WS2 alongside the export padding** — both are "timeline extends past audio" concerns and ship together with trailing-fallback itself.

**(d) Files.** `src/hooks/usePlayback.ts:58-105` (the `ended` branch `:87-92` gains the fallback-clock transition; a fallback-clock loop is added alongside, reusing the segments-total end check `:78-84`), plus the scrub path's resume handling where `App.tsx` seeks the audio element.

**(e) What stays untouched.** The no-voiceover interval path (`:110-127`) and the playbackRate sync (`:132-136`) are unchanged; fully-covered projects (no trailing fallback) get byte-identical playback behavior.

---

## 4. Data Model Changes

**`VideoSegment.anchorSource`** (`types.ts:208`) — union extended additively:

```ts
anchorSource?: 'whisper' | 'estimate' | 'fallback';
```

`'fallback'` = char-based or interpolated timing for a segment the audio does not cover (leading, trailing, or an R12-interpolated single-gap segment) — distinct from `'estimate'` ("the whole project was timed by character weight because no transcript existed"). `project-state.md`'s invariant (e) ("anchorSource provenance only ever moves one direction") gains a third state — ordering becomes `whisper > fallback ≈ estimate`; the invariant's wording is updated when the Decisions Log entry is written (Section 9).

**`Project.lastSyncObservedRate`** — new optional scalar field (N3 — accepted; the ONLY persisted field added by this rewrite):

```ts
/** Observed seconds-per-character narration rate from the most recent sync
 *  whose covered region cleared the tier-1 significance thresholds
 *  (syncConstants.ts: ≥100 chars AND ≥30s). Tier-2 char-rate fallback input
 *  for partial-coverage syncs (§3.5). Absent until the first qualifying sync
 *  (old projects: tier 2 falls through to tier 3). */
lastSyncObservedRate?: number;
```

Additive, optional, invisible to old projects (absent → tier 3 default; same invisible-migration pattern as `aspectRatio`/`resolutionTier`, `types.ts:313-319`). Updated on every successful sync whose covered region meets the tier-1 thresholds. This does not contradict §3.7's "coverage metadata is never persisted" rule — that rule covers per-segment confidence/matched/audio-region data, which remain transient; a scalar narration rate is a project-level characteristic, not transient sync metadata. The rewrite's persistence posture is: **one additive scalar field, no structural changes.**

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
  classification: 'covered' | 'leading-fallback' | 'trailing-fallback'
                | 'interpolated' | 'gap-error' | 'no-text';
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

---

## 5. File-by-File Change List

### Workstream 1 — Matcher rewrite (Hirschberg) + normalizer unification + coverage metric + two-signal abort gate (the coupled foundation)

| File | Change | Rulings/Decisions |
|---|---|---|
| `src/services/syncConstants.ts` (NEW) | All tuning constants + `NUMBER_WORDS` (Section 3 preamble, R1). | R1, R8, R12, R13 |
| `src/services/whisperService.ts` | Replace the greedy matcher core (`:291-433`) with the Hirschberg aligner (3.1) + per-segment extraction (3.1.1, zero-token neutrality). Rewrite `canonicalizeForAlignment` (`:145-211`) to the unified order incl. the R1 hyphen carve-out (3.2). Extend the return type with per-segment coverage + `CoverageMap` incl. `longestCoveredRun` (3.3). Delete `maxStart`, overshoot guard, cursor hold. | D2/D3/D4, R1, R7, R11, R13 |
| `src/services/syncEngine.ts` | `normalizeForMatch` (`:43-50`) refactored onto shared Unicode primitives (behavior identical). | D4 |
| `src/hooks/useWhisper.ts` | `alignSegmentsFromCachedTranscript` (`:27-48`) threads the coverage result; fresh path (`:170-197`) gains the same plumbing. | R13 |
| `src/App.tsx` | Two-signal abort gate in `handleApplySyncFromFiles` between alignment and commit (`:1806-1850`): gap check (R12) → run check → noise floor (R13); locked-in-gap message variant (R9); empty-input aborts (3.11). | D1, R9, R12, R13 |

### Workstream 2 — Partial-coverage sync logic + last-segment-end standardization + export audio padding + preview fallback clock

| File | Change | Rulings/Decisions |
|---|---|---|
| `src/services/whisperService.ts` | `distributeSegmentTimes` (`:543-562`) consumes classification: `anchorSource:'fallback'` + three-tier char-rate anchors (R3) for leading/trailing, window-fill for interpolated single gaps (R12); the `:552` 0.1s floor becomes classification-conditional (N1). `alignScenestoTranscript` gains `audioDurationSecs`; `:515-517` clamps to file duration (3.13). | D5, D10, R3, R12, N1 |
| `src/services/syncEngine.ts` | `applyAnchorBasedTiming` PASS 3 (`:239-243`) clamps the last *audio-covered* segment; trailing fallback segments exempt. The `:235` 0.1s floor becomes classification-conditional (N1). No-op when no fallback segments exist. | D5, D10, N1 |
| `src/App.tsx` | Char-weight proportioning (`:417-422`) extracted to a shared helper used by the bootstrap, the fallback classifier, and the interpolation window math. Writes `Project.lastSyncObservedRate` after a tier-1-qualifying sync (N3). | R3, R12, N3 |
| `src/types.ts` | `anchorSource` + `'fallback'` (`:208`); `Project.lastSyncObservedRate?: number`; `CoverageMap` types (Section 4). | D5, R3, N3 |
| `src/hooks/usePlayback.ts` | Audio-`ended` branch (`:87-92`) transitions to the wall-clock fallback loop when trailing-fallback segments exist (advance × `globalPlaybackSpeed`, end check per `:78-84`); scrub-back into the audio-covered region resumes audio-clocked sync (3.15). | **N2** |
| `src/services/webcodecsExport/muxOnly.ts` | `buildAudioMuxArgs` (`:129-144`) + `muxOnly` (`:157-200`) gain `timelineDurationSecs`; conditional `-af apad=whole_dur=…` when timeline > audio (3.14). | **R2** |
| `src/services/webcodecsExport/exportPipelineWebCodecs.ts` | Threads timeline duration into `muxOnly`. | **R2** |
| `src/services/exportPipeline.ts` | Audio-mux exec (`:264-274`) gains the same conditional `apad` (3.14). | **R2** |

### Workstream 3 — Silence-snap guards (independent)

| File | Change | Rulings/Decisions |
|---|---|---|
| `src/services/whisperService.ts` | Forward + backward clamps with `SNAP_TOLERANCE_SEC` (±0.150s) on the chosen boundary (`:500-511`), using `curr.lastTokenIdx` end / `next.firstTokenIdx` start (3.6). | D6, **R4** |

### Workstream 4 — Remaining hardening (independent)

| File | Change | Rulings/Decisions |
|---|---|---|
| `src/services/whisperService.ts` | Stage-direction/speaker-label strip function + call at `:307` (3.8). `parseTimestamp` (`:26-34`) returns `null` on failure. | D13, D14 |
| `src/App.tsx` | `TAG_REGEX` (`:279-280, 294`) anchored to line-start; re-parse behavior change ships silent, documented in the Decisions Log (3.8, N4). | **R5, N4** |
| `src-tauri/src/whisper.rs` | `parse_timestamp` → `Option<f64>`, callers skip (`:365-415`) (3.12). `model_path` generalized beyond the hardcoded `.en` filename (`:51-100`); detect-then-transcribe flow with model/`--dtw` selection (`:244-251`) + detected-language IPC surface (3.9). | D9, D14, **R6** |
| `src-tauri/models/` + `src-tauri/models/README.md` | `ggml-base.bin` (multilingual) provisioned alongside `ggml-base.en.bin` (gitignored, `.gitignore:17-18`); README provisioning instructions updated. No `tauri.conf.json` change (`bundle.resources` `"models/*"` glob already bundles it). | **R6** |
| `src/hooks/useWhisper.ts` | `SyncWarning` dispatcher (`onSyncWarning`) owned here; `fetchAndDetectSilences` (`:12-20`) fail-loud via callback (3.10); language warning (3.9); both paths funnel through the one dispatcher. | D9, D11, **R10** |
| `src/types.ts` | `SyncWarning` type (Section 4). | **R10** |
| `src/App.tsx` | Renders all `SyncWarning`s through the single surface (existing toast/banner mechanism). | **R10** |

### Workstream 5 — Test extension + threshold tuning + regression tag

| File | Change |
|---|---|
| `src/services/syncTiming.test.ts` (+ siblings) | Re-baseline + extend (Section 6), incl. the N1 floor-scoping updates at `:210, :247`, the Hirschberg≡NW property test, and parser/mux-args tests in their homes (`muxOnly.test.ts`, a `parseProjectData` test). |
| Fixture tuning pass | R8's threshold derivation on the four named fixtures; final constants recorded in `syncConstants.ts`. |
| git tag | `sync-known-good-2026-07-24` after all tests pass (Section 6.3). |

### Workstream 6 — Docs

| File | Change |
|---|---|
| `CLAUDE.md` | Update `whisperService.ts`/`syncEngine.ts`/`useWhisper.ts`/`usePlayback.ts`/`whisper.rs`/`muxOnly.ts`/`exportPipeline.ts` File Map entries; update the Anchor-Based Segment Timing section; DO-NOT-DO additions (e.g., "never commit a timeline that failed the coverage gate"; "never mux a trailing-fallback timeline without `apad`"; "never apply the 0.3s/0.1s duration floors to fallback-classified segments"). |
| `project-state.md` | Decisions Log entries (Section 9) — only after landing + verification; invariant (a)/(b)/(e) wording updates. |
| `docs/history.md` | Implementation record — only after verification. |

---

## 6. Test Plan

### 6.1 The 23 existing tests (`src/services/syncTiming.test.ts`) — what changes and why

The matcher rewrite **deliberately re-baselines** this suite (Decision 3). Per describe block:

- **`cached-token sync pipeline (Option C)` (1 test, `:40-86`).** Exact expected values (`3.7/3.85/3.95`, `:73-79`) may shift within the silence windows under the new aligner + tolerance clamps; the Σ-duration assertion (`:83-84`) must keep passing for this fully-covered case. Re-baseline values by hand-verifying the new output against the token fixture.
- **`clean-slate re-sync (11→14 Civic repro)` (2 tests, `:101-255`).** Contiguity, duration floors, Σ=AUDIO_DURATION (`:214, :251`), and tape-deck ordering must all still pass — this fixture is fully covered, so the new aligner must reproduce the same qualitative result. **The ≥0.3s assertions at `:210` and `:247` are updated to apply only to segments where `anchorSource !== 'fallback'`** (N1) — a no-op for these fully-covered fixtures (every segment is whisper-anchored), but the scoping keeps the invariant honest once partial-coverage fixtures share the helpers.
- **`stale-anchor squeeze (synthetic)` (2 tests, `:274-329`).** `applyAnchorBasedTiming` mechanics — unaffected; expected to pass unchanged.
- **`legacy project (pre-6/18)` (1 test, `:342-375`).** `applyAnchorBasedTiming` only (`:373` Σ check) — unchanged, must pass. The PASS 3 clamp change (WS2) must be verified a no-op here (no fallback segments).
- **`D16 canonicalization equivalence (Part A)` (7 tests, `:386-459`).** Survive under R1: **`'thirty-seven' ≡ '37'` (`:393-394`) continues to pass** — the number-word carve-out splits it to `['thirty','seven']`. New cases required: `co-operate` one token; `3-4` splits (all-digit sub-parts); `twenty-first` stays whole (mixed number+ordinal); abbreviations (`e.g.`, `U.S.A.`); ZW-char join (`foo​bar` → `foobar`); NFC (`café` NFD ≡ NFC).
- **`D16 alignment robustness (Parts A + C)` (6 tests, `:461-616`).** The *scenarios* (number/contraction/symbol/glued-token alignment without neighbor drift) are preserved; the *mechanism assertions* change — there is no cursor. The safety-net test (`:585-615`) becomes "an unmatchable segment yields low per-segment confidence and does not displace its neighbors' matched positions" — and under R12 it now classifies as an interpolable single gap.
- **`D16 overshoot guard + backstop clamp` (4 tests, `:630-754`).** Tests (a)–(c) assert guard internals (`overshoot`/`low-confidence` console messages) that **no longer exist** — rewritten as outcome tests under the diff aligner. Test (d) (`:732-753`, `applyAnchorBasedTiming` backstop) is matcher-independent and survives as-is — the backstop clamp is retained as defense-in-depth.

### 6.2 New tests required

1. **Full-mismatch abort** — cross-script fixture: longest covered run = 0 → abort with the mismatch message (R13 Signal 1).
2. **Near-zero-coverage abort** — exactly 1 covered segment (longest run = 1 < `MIN_COVERED_RUN_LENGTH`) → abort (R13 Signal 1).
3. **Matched-on-noise abort** — a contiguous run ≥ 2 exists but bidirectional coverage < `NOISE_FLOOR_COVERAGE` → abort (R13 Signal 2).
4. **Partial-coverage proceed** — longest run ≥ 2, leading + trailing uncovered: proceeds; s1 char-timed in `[0, t0(firstCovered))`, trailing char-timed after the last covered segment, `anchorSource:'fallback'` on exactly the unmatched set, covered segments unchanged vs. a fully-covered control (R13, D5).
5. **Single-segment interpolation** — one uncovered segment between covered neighbors: no abort; `t0 = prev.t1`, `t1 = next.t0`, `anchorSource:'fallback'`, duration = the window (R12).
6. **Sliver acceptance (N1)** — a single-segment interpolation whose window is sub-0.3s: the fallback segment keeps the sub-0.3s duration (not clamped to 0.1/0.3, not errored); neighbors' audio-anchored boundaries unmoved.
7. **Whisper floor retained (N1)** — a whisper-anchored segment that would fall below the floor still triggers it (the floor is scoped, not removed).
8. **Two-segment gap abort** — 2 consecutive uncovered segments → abort with "segments X to Y" (R12); locked-segment variant asserts the R9 message.
9. **Three-tier char-rate** — tier 1 (big covered region → observed rate, and `lastSyncObservedRate` written), tier 2 (small region + `lastSyncObservedRate` present → historical), tier 3 (neither → 15 chars/sec) (R3, N3).
10. **Snap tolerance** — a silence midpoint within +150ms past `nextSpokenStart` is ACCEPTED; one beyond it is clamped; backward mirror; degenerate window falls back to token midpoint (R4).
11. **Stage-direction strip** — `(pause)`/`[laughs]`/`NARRATOR:` stripped; `Narrator:` kept; fully-parenthesized text kept unstripped (D13).
12. **Parser line-anchor** — a description line containing `[laughs]` mid-line does NOT split into a new scene; a line-start `[IMAGE: x]` still does (R5); covers both `TAG_REGEX` sites (`App.tsx:279, 294`).
13. **Malformed-token skip** — Rust unit tests (`parse_timestamp` → `None`; `parse_stdout_tokens` drops the token); TS mirror for `parseTimestamp` (D14).
14. **Hirschberg ≡ full-matrix NW property test** — on small random and hand-built fixtures (including free-end-gap cases), the Hirschberg traceback must produce the same optimal-score alignment as a reference full-matrix implementation kept test-side only (R7; the correctness gate for the free-end-gap/recursion subtlety, 3.1(c)).
15. **Zero-token segment neutrality** — an empty-text segment between covered neighbors neither aborts (not a gap member) nor dilutes coverage; anchors at the previous boundary (3.1.1 point 4).
16. **Export mux args** — `buildAudioMuxArgs` with `timelineDurationSecs` > audio duration includes `apad=whole_dur=…`; without trailing overhang, args are byte-identical to today (R2; in `muxOnly.test.ts`).
17. **Language flow (frontend side)** — detected non-English surfaces a `SyncWarning` (severity `'warn'`), does not block; detection-failure falls back silently (R6, D9). Rust detect-pass logic covered by manual testing + Rust unit tests where practical.
18. **Unified warning surface** — silence-failure, language, and empty-input events all arrive as `SyncWarning` through the single dispatcher, from both cached and fresh paths (R10).

### 6.3 Threshold tuning pass + regression tag

R8's tuning pass (3.3(c)) runs after WS1–WS4 land, on the four named fixtures; the derived constants are committed to `syncConstants.ts` with the observed distributions noted. Then tag **`sync-known-good-2026-07-24`** — locking the Hirschberg pipeline, two-signal gate, partial-coverage semantics (incl. the N1 floor scoping), snap tolerance, export padding, and preview fallback clock as the new known-good baseline. The old `sync-known-good-2026-06-20` tag is **kept** as the historical pre-rewrite baseline (Decision 15). The repo also carries `sync-known-good-2026-06-23`/`-24`; the Decisions Log entry states that the new tag is the active bisect target. `project-state.md` invariant (a) (which still says "8 vitest tests") is updated to the new count and tag.

### 6.4 Manual test plan (separate from vitest)

1. **294-segment macOS Intel reproducer** — must still sync correctly and within acceptable wall-clock time (validates Hirschberg cost at scale; use `__ALIGN_INSTRUMENT__`, `whisperService.ts:236-257`).
2. **The s2-on-"lot" project** — s2's boundary must land at/on "on", not "lot" (validates 3.1 per Section 4.5).
3. **Cross-script mismatch** — a real voiceover against an unrelated scene doc: must hard-abort with the full-mismatch message; project state untouched.
4. **Partial-coverage project** — s1 + s16–s51 unscripted, s2–s15 spoken: char-fallback on the edges, audio timing in the middle; a middle-gap variant (2+ segments) must abort naming the run; a single-gap variant must interpolate, not abort.
5. **Trailing-fallback export (R2)** — the partial-coverage project exported on BOTH paths (WebCodecs gate on and off): output duration = timeline duration, silence after voiceover end, video renders to the last segment.
6. **Trailing-fallback preview (N2)** — the same project in preview: playback continues past audio end on the fallback clock, trailing segments are reachable and play at their computed durations, scrubbing back into the audio region resumes audio-synced playback, and playback stops/resets at timeline end.
7. **Punctuation cases** — `10:30` / `10.30` / `10,30` in scene text vs. spoken "ten thirty": no neighbor desync (B2 verification).
8. **Non-English audio (R6)** — detect pass picks the language; transcription runs on the multilingual model; the warning shows; sync proceeds; an English file still transcribes on the `.en` model (verify via logs).
9. **Existing-project re-parse spot check (R5/N4)** — re-sync a real saved project and confirm segment count is unchanged (its scene doc has no mid-line brackets); the mid-line-bracket behavior change itself ships silent by ruling.

---

## 7. Implementation Order

```
WS1 (foundation: Hirschberg aligner + normalizer + coverage + two-signal gate)
 ├──> WS2 (partial coverage + interpolation + N1 floor scoping + last-end
 │         standardization + EXPORT APAD (R2) + PREVIEW FALLBACK CLOCK (N2)
 │         — the export and playback changes are WS2 dependencies of
 │         trailing-fallback, shipped together, never separately)
 ├─ WS3 (snap tolerance clamps)  — independent (pure clamp on existing
 │                                  AlignResult fields)
 ├─ WS4 (hardening: strip + TAG_REGEX (R5/N4), dual-model language (R6),
 │        SyncWarning surface (R10), fail-loud, Option<f64>)  — independent
 └──> WS5 (tests + R8 threshold tuning + tag) — depends on WS1–WS4
        └──> WS6 (docs) — last, after verification
```

**Recommended sequence:** WS1 → WS2 → WS3 → WS4 → WS5 → WS6. WS1+WS2 are the coupled core and re-baseline the tests once. WS3 and WS4 can run in parallel with each other and with WS2 (disjoint line ranges except `whisperService.ts`, where conflicts are trivial). The R6 model provisioning (a download + README update) can happen any time before WS4's whisper.rs work. R8's tuning pass is strictly last-before-tag: it needs all behavior final.

**Test discipline during WS1–WS4:** the existing 23 tests will be red from WS1 until WS5 re-baselines them. WS1 carries a minimal new-aligner test set from day one (6.2 items 1, 4, 14, 15) so the suite is never red-without-replacement.

---

## 8. Risks and Tradeoffs

1. **The 23-test re-baseline is deliberate, not accidental.** These tests lock the *current* matcher's exact outputs, including its bugs; a rewrite keeping them all green would by definition not have fixed B2. Mitigation is discipline: every re-baselined expected value is hand-verified against its fixture (6.1), and the qualitative invariants (contiguity, Σ-duration on fully-covered projects, no whisper-anchored slivers, tape-deck ordering) must survive untouched. The N1 floor scoping deliberately narrows the sliver invariant to whisper-anchored segments — recorded in the tests themselves, not just here.
2. **The contiguous-audio invariant is stricter than current behavior — by explicit user decision, softened by R12's 1-segment interpolation tolerance.** Projects that today "work" by silently bridging a multi-segment gap will start hard-aborting; single-segment Whisper drop-outs no longer abort (they interpolate), which keeps the gate robust against routine ASR noise. Trailing-fallback timelines extend past the audio duration, which amends `project-state.md` invariant (b) (Σ content-segment duration = voiceoverDuration → holds for the audio-covered region; total may exceed it when trailing fallback exists) — the wording change is part of the Section 9 log entry.
3. **The export-mux change (R2) is in WS2 and touches both export paths.** `apad` is added to the legacy exec (`exportPipeline.ts:264-274`) and the WebCodecs `buildAudioMuxArgs` (`muxOnly.ts:129-144`) — the second inside a mux step whose current shape was hard-won against real VideoToolbox streams (`muxOnly.ts:29-58`). The change is audio-side only and preserves the premux/PTS structure, but it MUST be manually verified with a real trailing-fallback export on both paths (6.4 item 5) before the tag — an args-level unit test is not sufficient proof for this file, per its own header's warning.
4. **The preview fallback clock (N2) modifies the playback engine's most-trodden path.** The audio-clocked rAF loop (`usePlayback.ts:58-105`) is behaviorally byte-identical for fully-covered projects (the fallback branch is gated on trailing-fallback segments existing), but the ended-branch transition and scrub-back resume are real state-machine additions to a hook that has historically produced subtle bugs (the "Maximum update depth" incident, `project-state.md` 2026-07-07 Decisions Log entry). Manual test 6.4 item 6 is the gate.
5. **Phase 1 / Phase 2 split.** Phase 1 delivers correct per-segment timings + `anchorSource:'fallback'` marks + correct export (3.14) + reachable preview (3.15). Phase 2 (deferred): timeline UI for audio offset, waveform dimming under non-audio segments, visible coverage affordances, and the N1 short-segment visual flag. Accepted.
6. **One additive persisted field (N3).** `Project.lastSyncObservedRate?: number` is the rewrite's only persistence-model change — additive, optional, backward-compatible (old projects load unchanged; the field is absent until the first tier-1-qualifying sync writes it; no `projectStore.ts` version bump needed, same pattern as `aspectRatio`/`resolutionTier`). The risk is negligible by construction, listed here so the persistence surface is complete.
7. **Installer size +~74MB (R6).** The multilingual `ggml-base.bin` ships alongside the English model — accepted explicitly by the user's ruling. Provisioning follows the existing gitignored-model pattern (`.gitignore:17-18`, `src-tauri/models/README.md`); CI/build docs must be updated or fresh checkouts will build without the new model — the detect pass degrades gracefully (R6 step 5: detection failure falls back to the English model).
8. **Detect-then-transcribe latency (R6).** Every transcription gains a detect-only pre-pass (small); non-English audio pays a full second transcription on the multilingual model. Progress UX: the detect pass reports no percent (brief 0% phase) — accepted. The existing transcode-to-WAV step (`whisper.rs:115-150`) runs once and its output is reused by both passes.
9. **Hirschberg implementation complexity (R7).** Meaningfully harder to implement correctly than full-matrix NW — recursive divide-and-conquer, forward+backward scoring passes, and the free-end-gap boundary handling (3.1(c)). The mitigation is structural: the Hirschberg≡NW property test (6.2 item 14) with a test-side full-matrix reference implementation is the non-negotiable correctness gate, and it must include free-end-gap fixtures specifically.
10. **`TAG_REGEX` line-anchoring is a parse behavior change on existing data (R5/N4).** A saved scene doc containing mid-line brackets parses to *fewer* scenes after the fix — shipped silent by explicit ruling (N4): it is the corrected interpretation, the coverage gate protects against genuinely wrong outcomes, and the change is recorded in the Decisions Log (Section 9, item 8). Correctly-authored docs are unaffected.
11. **Cross-platform validation gap.** Verified on macOS Intel first; macOS arm64 and Windows/WebView2 remain unverified until hardware is available (the project's standing pattern). The rewrite is mostly pure TS, but WS4's whisper.rs changes (dual model, detect pass) and R2's mux change alter sidecar invocations on all platforms.
12. **Near-match partial credit (S3) can mis-anchor.** Prefix-stem credit ("world"/"worlds") also matches unrelated pairs ("care"/"careful"). Ships behind a single constant; the R8 fixture pass decides whether it stays on.

---

## 9. Decisions Log entries (to append to `project-state.md` AFTER implementation + hardware verification — not now)

Checklist only; `project-state.md` records closed work, `docs/history.md` records verified closed work, and this rewrite is open until verified.

1. **Sync matcher rewritten to a token-level diff aligner (NW scoring, Hirschberg linear-space traceback, free end-gaps)** — supersedes the greedy positional matcher and all D16 cursor guards; why (B2/G3), what was deleted, the Hirschberg≡NW property-test gate, test re-baseline note.
2. **Two-signal abort gate (contiguous covered-run + bidirectional noise floor) + hard abort** — explicitly recording that **R13 superseded Decision 8's "both directions < 0.4" aggregate rule**; the tuned constants and the R8 fixture distributions behind them; the exact user-facing messages incl. the R9 locked-segment variant; the no-partial-timeline guarantee (B1 closed).
3. **Partial-coverage semantics** — contiguous-audio invariant with `MAX_INTERPOLABLE_GAP = 1` interpolation; leading/trailing three-tier char-fallback (R3) incl. the new persisted `Project.lastSyncObservedRate` (N3); `anchorSource:'fallback'`; the N1 floor scoping (duration floors apply to whisper-anchored segments only); explicit note that invariant (b) (Σ=voiceoverDuration) and invariant (e) (anchorSource one-directional) were amended, with the new wording.
4. **Export audio padding (`apad`) for trailing-fallback timelines (R2)** — both paths (`exportPipeline.ts`, `muxOnly.ts`), byte-identical when no overhang; manual both-path verification record.
5. **Preview fallback clock for trailing-fallback timelines (N2)** — `usePlayback`'s audio-ended branch transitions to a wall-clock loop instead of stop/reset when the timeline extends past the audio; scrub-back resumes audio sync; byte-identical for fully-covered projects; manual verification record.
6. **Unified alignment normalizer** — NFC + ZW-join + hyphen-preserve with the `NUMBER_WORDS` carve-out (R1) adopted onto the timing path.
7. **Silence-snap clamps with `SNAP_TOLERANCE_SEC` ±150ms (R4)** — with the s2-on-"lot" innocence finding recorded (Section 4.5) so the attribution survives.
8. **`TAG_REGEX` anchored to line-start (R5/N4)** — *"TAG_REGEX anchored to line-start; mid-line `[...]` no longer splits scenes. Existing scene docs with mid-line brackets parse to fewer scenes after this change. This is the corrected interpretation; the coverage gate protects against genuinely wrong outcomes."* Shipped silent by explicit ruling (no re-parse `SyncWarning`).
9. **Dual-model language handling (R6)** — both models bundled (+74MB accepted), detect-then-transcribe flow, model-specific `--dtw` selection, warn-not-block; provisioning docs updated.
10. **Hardening batch** — stage-direction strip grammar (D13), unified `SyncWarning` surface (R10), silence fail-loud (D11), empty-input aborts (D12), `Option<f64>` timestamp skip (D14).
11. **New regression tag `sync-known-good-2026-07-24`** — what it locks, that `sync-known-good-2026-06-20` is retained as the historical baseline and the new tag is the active bisect target; invariant (a) updated (test count, tag name).

---

## 10. Open Questions

### Round 2 Rulings (all LOCKED — applied throughout this doc)

| ID | Ruling (one line) |
|---|---|
| **R1** (was OQ1) | Hyphen-join default with a `NUMBER_WORDS` carve-out: hyphenated tokens whose sub-parts are all number words/digit runs split; everything else keeps the hyphen (`'thirty-seven'≡'37'` preserved, `co-operate` one token) — §3.2. |
| **R2** (was OQ2) | Export mux pads audio to the timeline duration via `-af apad=whole_dur=…` on both export paths; scoped into WS2 as a hard dependency of trailing-fallback — §3.14. |
| **R3** (was OQ3) | Three-tier char-rate: observed (≥100 chars AND ≥30s covered) → project historical (`Project.lastSyncObservedRate`) → global default 15 chars/sec; named constants — §3.5. |
| **R4** (was OQ4) | Snap clamps carry `SNAP_TOLERANCE_SEC = 0.150` (half of Whisper's ~300ms error) on both sides — not exact bounds — §3.6. |
| **R5** (was OQ5) | `TAG_REGEX` anchored to line-start (parser change IN SCOPE, WS4); mid-line `[...]` no longer splits scenes — §3.8. |
| **R6** (was OQ6) | Bundle BOTH whisper models (+74MB accepted); detect-only pass on the multilingual model, then transcribe on `.en` (English) or multilingual (non-English, with warn-not-block); detection failure → English fallback — §3.9. |
| **R7** (was OQ7) | Hirschberg from the start (O(n+m) space, same optimal alignment) — not a measured fallback — §3.1. |
| **R8** (was OQ8) | Thresholds derived from fixture confidence distributions (4 named fixtures, separation-with-margin method); 0.4/2/0.1 are starting points; constants in one exported module; explicit WS5 tuning step — §3.3, §6.3. |
| **R9** (was OQ9) | Classification ignores locked status (a gap is a gap); a locked segment inside an aborting gap gets a specific message naming it — §3.4, §3.5. |
| **R10** (was OQ10) | All warnings unify through a single `SyncWarning` type + `onSyncWarning` dispatcher owned by `useWhisper`; both paths funnel; one UI surface — §4, §3.9–3.11. |
| **R11** (was M1) | Per-segment confidence extraction from the global alignment formalized (t0/t1 from first/last matched word; confidence = matched/total; zero matches = uncovered) — §3.1.1. |
| **R12** (was M2) | Single uncovered segment between covered neighbors INTERPOLATES (`MAX_INTERPOLABLE_GAP = 1`); 2+ consecutive abort; leading/trailing char-fallback never abort — §3.5. |
| **R13** (was M3) | Two-signal abort gate: contiguous covered-run length (primary, `MIN_COVERED_RUN_LENGTH` = 2) + bidirectional noise floor (secondary, `NOISE_FLOOR_COVERAGE` = 0.1); supersedes Decision 8's "both < 0.4" aggregate rule — §3.3, §3.4. |

### Round 3 Rulings (all LOCKED — applied throughout this doc)

| ID | Ruling (one line) |
|---|---|
| **N1** | Interpolated/fallback slivers are ACCEPTED: the 0.3s/0.1s duration floors (`App.tsx:263`, `whisperService.ts:552`, `syncEngine.ts:235`) apply to whisper-anchored segments only; fallback segments have no floor (≥0 guard only); audio-anchored boundaries are never moved to widen a sliver; Phase 2 UI flags short segments visually — §3.5, §6.1, §6.2 items 6–7. |
| **N2** | Preview playback continues past audio end on a wall-clock fallback (× `globalPlaybackSpeed`) when trailing-fallback segments exist; scrub-back resumes audio-clocked sync; Phase 1, scoped into WS2 alongside R2 — new §3.15, §5 WS2, §6.4 item 6. |
| **N3** | `Project.lastSyncObservedRate?: number` is ACCEPTED — the rewrite's only persisted field, additive/optional/backward-compatible; §3.7's "coverage metadata never persisted" rule is unchanged (it covers per-segment data, not a scalar project characteristic) — §4, §3.5 tier 2, §8 item 6. |
| **N4** | The `TAG_REGEX` re-parse behavior change ships SILENT (no `SyncWarning`); the coverage gate catches genuinely wrong outcomes; the change is documented in the post-implementation Decisions Log — §3.8, §9 item 8. |

### Final re-analysis (Round 3 close-out)

The full doc was re-read after applying N1–N4, checking specifically for: contradictions among the 17 rulings (N1 vs. the test floor invariants — resolved by the `:210`/`:247` scoping in §6.1 and tests 6–7 in §6.2; N2 vs. R3 rate consistency — resolved by construction, the fallback clock advances real seconds over durations already computed from the char-rate; N3 vs. §3.7's no-persistence rule — resolved by the explicit scalar-vs-per-segment distinction in §3.7 and §4; N4 vs. R10's unified warnings — consistent, N4 deliberately adds no warning and §3.8 says so; R2 vs. N2 — both in WS2, both gated on the same trailing-fallback condition), missing specifications (every §3 subsystem states algorithm, data flow, file:line touchpoints, error handling, and test coverage; no TBD language remains), missing file touchpoints (§5 covers `usePlayback.ts` in WS2, `types.ts` with `lastSyncObservedRate` and `SyncWarning`, both export files in WS2, `whisper.rs` + model provisioning in WS4, `syncConstants.ts` in WS1), missing test cases (§6.2 covers sliver acceptance and floor retention (N1), §6.4 covers fallback-clock preview (N2), §6.2 item 9 covers the persisted-rate tiers (N3), §6.2 item 12 + §6.4 item 9 cover the parser change (R5/N4)), and implementation-order soundness (§7 reflects WS2's expanded scope and WS4's parser + dual-model additions).

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
- **Status:** Not started. Queued for next workstream.
