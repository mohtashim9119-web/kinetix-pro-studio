Status: Accepted architecture — pending implementation
Date: 2026-08-03 (Revision 2, same day — stage contracts, stage locking, Stage 1 observability, Russian descope, adversarial audit; see Part K)
Verified-against-HEAD: 53ff4557e308776085ecfa448279cc2b02bb2641
Live status: see `project-state.md`'s Active Tasks for current phase progress.

## Phase Status

Phases are grouped under the stage they build (Part D). A stage's phases may not begin until every earlier stage is LOCKED, with two stated exemptions (Part D's ordering rule): proven behaviour-neutral deletions/moves, and read-only measurement.

| Phase | Stage | Description | Status | Verified by | Date |
|---|---|---|---|---|---|
| 0 | Programme | Safety and instruments (corpus verification, determinism check, script-word-keyed verification set, baseline CSV) | NOT STARTED | — | — |
| 1 | Stage 2 (neutrality-exempt; runs first) | Delete the duplicated gap-fill in `alignScenestoTranscript` | NOT STARTED | — | — |
| 1b | Stage 1 | Transcript Inspector — dev-only, in-app; BLOCKING Stage 1 deliverable | DONE | Owner inspection — `window.__transcriptInspector()` run in-app on V6 (447-seg) and 173-seg, output captured to `docs/v6-smear-baseline.csv` / `docs/173-smear-baseline.csv` | 2026-08-04 |
| 2a | Stage 1 | Model swap — multilingual model, `-l auto`, per-project language override | NOT STARTED | — | — |
| 2b | Stage 1 | Measure timing sources on the production model (turbo raw / turbo+DTW / large-v3 reference) — committed script | NOT STARTED | — | — |
| 3 | Stage 1 | Upgrade the timing source (DTW or forced alignment, per 2b's decision gate) | NOT STARTED | — | — |
| 3b | Stage 1 | Language-keyed normalization (moved here from old Phase 8 / H.5 — Part K, K1) | NOT STARTED | — | — |
| 3c | Stage 1 | Hyphen asymmetry fix (moved here from old Phase 8 — Part K, K1) | NOT STARTED | — | — |
| 3d | Stage 1 | Adaptive silence thresholds (conditional on 2b evidence; moved from old Phase 8 — Part K, K1) | NOT STARTED | — | — |
| — | **STAGE 1 LOCK** | Gate in Part D | NOT PASSED | — | — |
| 4 | All stages (structural; byte-identical gate) | Restructure into four stages (Prepare / Align and Select / Place / Finalize and Report) | NOT STARTED | — | — |
| — | **STAGE 2 LOCK** | Gate in Part D | NOT PASSED | — | — |
| 5 | Stage 3 | Replace the boundary picker with the fence (Part C's four-line rule) | NOT STARTED | — | — |
| 6 | Stage 3 | Deprecate the compensation layer (`isBreathSilence`, seam exemption, contention assignment) | NOT STARTED | — | — |
| 6b | Stage 3 | pairIdx-20 boundary verification (moved from old Phase 8) | NOT STARTED | — | — |
| — | **STAGE 3 LOCK** | Gate in Part D | NOT PASSED | — | — |
| 7 | Stage 4 | Observability — Contract OUT gap list, `boundaryUsedFallback` fix, rubric gate | NOT STARTED | — | — |
| — | **STAGE 4 LOCK** | = programme close | NOT PASSED | — | — |

The R5/N4 mid-line bracket split remains deferred on a product ruling (Part F) — recorded as a written acceptance at Contract IN (Part J), not a phase.

## Stage Lock Status

| Stage | Contract written | Verified | Locked | Date |
|---|---|---|---|---|
| Stage 1 — Prepare | Yes (Part J, 2026-08-03) | No | No | — |
| Stage 2 — Align and Select | Yes (Part J, 2026-08-03) | No | No | — |
| Stage 3 — Place | Yes (Part J, 2026-08-03) | No | No | — |
| Stage 4 — Finalize and Report | Yes (Part J, 2026-08-03) | No | No | — |

---

Sync Pipeline v2 — Final Architecture Plan
Status: Accepted architecture, pending implementation. Supersedes the 4-Stage proposal by adopting its structure with one ordering change and eight added safeguards. Revision 2 adds stage contracts (Part J), stage locking (Part D), the Stage 1 Transcript Inspector (Phase 1b), the Russian descope (Part H), and the adversarial-audit revisions (Part K).
Date: 2026-08-03
Verification model: manual, per phase, by the project owner. Automated tests are permitted only as change-detectors, never as evidence of correctness.
The one-sentence version
The proposal is right about the destination and wrong about the order: fencing the boundary picker to the token seam is the correct fix, but it cannot ship before the token timestamps are accurate enough for the fence to be built out of them. Fix the timing source first, then the fence works and half the pipeline’s complexity can be deleted.
Part A — What is actually broken, in plain language
Imagine you have a recording of someone reading a script, and you need to find the exact moment where sentence 4 ends and sentence 5 begins, so you can cut the video there.
Whisper gives you the words and a rough time for each word. The problem is that “rough” is worse than it sounds. When there’s a pause in the speech, Whisper often reports the next word as starting when the pause started, not when the word was actually spoken. The measured error is about 190 milliseconds on average, and on individual words it reaches 900 milliseconds. Nearly a full second.
So the app is trying to find a gap that is often 300ms wide, using measurements that are wrong by up to 900ms. That is like trying to park a car in a space narrower than your measurement error.
Everything else in the pipeline is a coping mechanism for this one problem. Fourteen tuned constants, five predicate functions, a three-pass contention-assignment algorithm, a breath detector with a coverage-ratio override, and an index-based seam exemption — all of it exists to guess around bad numbers. Each piece fixed one real project and then made the next fix harder.
And here’s the tell you found yourself: on audio with clear, obvious pauses, the 24 July build — which has none of this machinery — performs just as well as today’s build (USER-REPORTED observation, not independently measured). All the complexity is invisible on easy audio and only load-bearing on hard audio. That is the signature of compensation, not of design.
The word-shift bug is the clearest symptom. When the picker can’t find a pause where it expects one, it widens its search to look further out. Its minimum search radius is 0.5 seconds in each direction. At normal speaking pace a word plus its following gap is roughly 0.4 seconds (an estimate, not a measurement — the inspector’s per-token gap column, Phase 1b, will replace it with a measured distribution). So the picker is always permitted to reach at least one full word past the boundary — on every single cut, by construction. It usually doesn’t matter, because there’s no attractive pause one word over. In dense staccato script sections there often is, and it grabs it, and a word ends up on the wrong side. That’s your eleven cases.
The plan below removes the reason to guess.
Part B — The pipeline: four stages
Four stages, each with one job. The current pipeline has seven conceptual stages, two of which run twice on different arrays — the “5/6 interleave” — which is why fixes drift between two copies of the same logic.
One change from your proposal: the coverage partition moves out of Stage 3 and into the end of Stage 2. That way Stage 3 never receives a segment without real audio, so it never needs to check — its precondition is guaranteed by what it’s handed, not by a defensive branch inside it. This matters more than it sounds; the original middle-gap drift bug existed precisely because boundary logic ran on an array containing unmatched segments.

Stage 1 — Prepare
Turn the audio into words-with-times, and the script into words. Nothing else.
Transcode to 16kHz mono WAV. Transcribe. Get word timings from the best available source (this is the pluggable part — see Part C). Detect silences. Drop malformed tokens. Normalize text on both sides using the same normalizer.
Stage 1’s output is: an array of tokens, each with text, start, end; an array of detected silence intervals; the audio duration; and the script split into segments with normalized words. It is returned as ONE object, and Stages 2–4 receive tokens and silences only through that object — this is what closes the “same filtered array” convention risk (old R7) at the type level rather than by discipline.
Critical design decision: the source of word timings is behind an interface. Today it’s Whisper’s stdout timestamps. Tomorrow it may be DTW-refined timestamps or forced alignment. Everything downstream reads the same shape and does not know or care which produced it. This is what makes the timing upgrade a swap rather than a rewrite, and it’s what lets us measure a new source against the old one on the same project.

Stage 2 — Align and Select
Match script words to token positions. Decide which segments survive.
The global Hirschberg alignment runs once, unchanged. The three-pass rescue for zero-match segments runs, unchanged. The run-survival gates run, unchanged. Then the coverage gate decides whether to abort the whole sync, and the partition drops segments with no audio match.
Stage 2’s output is: the surviving segments, each carrying firstTokenIdx and lastTokenIdx — nothing else.
Critical design decision: Stage 2’s return type contains no timeline-authoritative fields at all. No t0, no t1, no startTime, no duration. This is how the duplicated gap-fill is prevented from ever coming back — not by a convention or a comment, but because there is no field to write it into. If someone later tries to add boundary logic to Stage 2, the code won’t compile. The duplication you identified is a real architectural flaw, and a type is the only durable fix for it. (Precision added by the adversarial audit, K5: today’s `AlignResult` also carries `audioRegion`/`recoveredRegion` — diagnostic time ranges consumed only by the rescue log entry. Those do not survive on Stage 2’s type either; Stage 4 derives the displayed ranges from token indices, where the tokens are in scope. The rule is stated exactly: Stage 2’s type carries token indices, match counts, and provenance enums — zero fields measured in seconds.)
This means distributeSegmentTimes and applyAnchorBasedTiming no longer live here. Their two genuinely necessary behaviors — lock preservation and the backstop monotonic clamp — move into Stage 3 where timing is actually decided. (A third consumer exists outside the sync pipeline entirely — see K4.)

Stage 3 — Place
Decide every boundary. Produce the complete timeline.
Given survivors with token index spans, plus tokens, plus silences, plus audio duration: compute one cut point per adjacent pair, then derive every segment’s start and duration from those cut points. Contiguous by construction — each segment’s duration is literally nextBoundary - thisBoundary, so start[i] + duration[i] === start[i+1] cannot fail arithmetically.
The boundary rule itself is Part C.
Stage 3 also owns the no-audio path: when there is no voiceover, boundaries come from character-weight proportions instead of silences. Same output shape, different input signal, explicitly logged as estimated rather than measured.

Stage 4 — Finalize and Report
Extend segment one back to time zero. Extend the last segment to the audio end. Apply the duration floor. Run the contract validators. Emit log entries for every clamp, fallback, and estimate. Commit atomically in one state update.
Critical design decision: Stage 4 is the only place in the pipeline permitted to clamp a value, and every clamp it performs emits a log entry. No silent floors anywhere. This is the direct answer to Risk R2 — five silent floor sites today, zero warnings between them.
Part C — The boundary rule, and the prerequisite it depends on
This is the heart of the plan, so it gets stated precisely.

The rule
For an adjacent pair of surviving segments A and B, let gapStart = end(A's last token) and gapEnd = start(B's first token). This interval is the only place a cut may land. Ever. No radius, no expansion, no widening.
If the gap is positive and one or more detected silences overlap it, take the longest overlapping silence, intersect it with the gap, and cut at the centre of that intersection. If the gap is positive and no silence overlaps, cut at the gap’s centre — this is continuous speech with no pause, and the correct behaviour is to split the words exactly and stop looking. If the gap is zero or inverted, cut at the midpoint of the two edges and log it as a degenerate boundary.
That’s the whole rule. Four lines. It replaces computeBoundarySearchWindow, isBoundarySilenceCandidate, fillsTokenGapWithinSpan, isBreathSilence including its multi-fragment override and index-based seam exemption, the three-pass contention assignment, and the degenerate-pair guard.
Word theft becomes structurally impossible, because a cut inside the gap between two words cannot, by definition, place either word on the wrong side. Not “unlikely.” Not “below threshold.” Impossible.

Why it cannot ship yet
The fence was already tried, on 2026-08-03, and it reverted eight boundaries the seam exemption had fixed. I want to show you exactly why, using real numbers from your V6 project, because this is the single most important fact in the plan.
At V6 segment 96, the words are look (288.750–289.090), then A (289.200–289.260), then predator (289.260–289.800). The real pause — confirmed by the silence detector — is [289.380, 289.960].
Source for these numbers (added in Revision 2, Task 6a): the test fixtures committed in `c593f1d` (`syncTiming.test.ts`, the “seg 96→97” fixture and its five siblings), reported at `docs/audit-verification-2026-08-03.md` §C.8 and walked through arithmetically at §D.12 (two-token clamp) and §D.13 (one-token-wider clamp). Note the coverage limit that comes with the citation: segments 34 and 412 have NO equivalent committed fixture anywhere in the repo — only bare index citations survive for them (§C.8) — which is why this ordering argument rests on segment 96 alone, plus the five other fixtures (162, 316, 338, 352, 405) that share its shape.
Look at those numbers. Whisper says the next segment starts at 289.200. The actual silence starts at 289.380 and runs to 289.960. Whisper’s reported start for A is before the pause even begins, and the real speech starts somewhere after 289.960. The reported timestamp is nearly 800ms early.
So the fence’s window is [289.090, 289.200] — 110 milliseconds wide, and it doesn’t overlap the real pause at all. The fence excludes the correct answer. Widening it by one full token on each side still excludes it, by 120ms (§D.13). There is no fixed token-count tolerance that recovers this, because the smear crossed two tokens.
This is not bad luck at one boundary. Whisper’s error is directional — it systematically assigns a pause’s onset to the following word. So any window built from Whisper’s raw timestamps systematically undershoots on the right edge. Segment 96 is the expected case, not the exception.
Conclusion: the fence is correct architecture with an unmet prerequisite. It needs word timings whose error is small relative to the gaps it must resolve. Fix the timings and the fence works, the seam exemption becomes unnecessary, and a large fraction of the sync pipeline’s code can be deleted rather than maintained (the “roughly 60%” figure previously stated here is an UNVERIFIED estimate — verify by line count when Phase 6’s deletions actually land).

The prerequisite
Three options, cheapest first.
Whisper’s own DTW. whisper.cpp can refine timestamps by dynamic time warping against its attention weights. Your build already passes --dtw base.en — and it has been a silent no-op the entire time, because flash attention is on by default and silently disables DTW. Turning it on requires -nfa, which in this build broke stdout printing, which is where both the tokens and the progress bar come from. Estimated result: ~190ms → ~80ms error (UNVERIFIED — a recall-based estimate, not a measurement; Phase 2b is what measures it).
Forced alignment. Throw Whisper’s timestamps away entirely. Take the known script text — which we already have, that’s the whole premise of this app — and align it to the audio at the phoneme level using a CTC acoustic model. This is what WhisperX does and it reaches roughly 20ms (published figure, not locally verified). It needs ONNX Runtime (mature Rust bindings exist) and a wav2vec2-CTC model of comparable size to the whisper model already bundled.
Neither, and live with a fence built on 190ms error. Honest assessment: this makes word-shift better than today (no more one-word reaches) but introduces a new failure where the fence excludes the real pause, exactly as at segment 96, producing cuts inside the pause’s leading edge. Better than today, not correct.
The plan measures option one before committing to anything, because it’s an afternoon of read-only work and it might be enough.

The safety property that makes this whole plan tractable
Changing the timing source does not change the text. The Hirschberg alignment is a pure text match. So Stage 2’s output — which script word maps to which token position — is invariant under Stage 1 timing changes. Alignment correctness, which the investigation already confirmed at 447/447 on V6, does not need re-verification when we swap timing sources.
With one exception, which is a genuine trap: filterMalformedTokens drops tokens based on their timestamps. Better timestamps mean fewer drops, which means the token array is longer, which means every token index shifts. On your 173-segment project, 30 of the 169 drops were timestamp-based.
This has a direct consequence for verification, covered in Part D and worth stating twice: the boundaries we verify must be identified by their SCRIPT-side words, never by their index and never by transcript-side words. “Segment 96” will not mean the same thing after a timing upgrade, and the transcript text itself changes at Phase 2a’s model swap — only the authored script text is fixed for the programme’s duration. A verification-set key is: the last 3 normalized words of segment N’s script text plus the first 3 normalized words of segment N+1’s script text.
Part D — Phases, grouped by stage, with a lock gate per stage

## D.0 — The verification corpus (real test data, inventoried 2026-08-03)

The corpus lives at `/Users/mohtashim/Downloads/All Projects Test Data` — OUTSIDE the repo, and it stays there (never copied in; the audio alone is ~140 MB). Inventoried read-only:

| Project (directory) | Audio file | Size | Duration | Script | Scene doc | Language | Voice style | Role in this programme |
|---|---|---|---|---|---|---|---|---|
| `14 Base Segs Project` | `3. Voiceover.mp3` | 1.3 MB | 32.7s | ✓ | ✓ (`2. Scene Details.txt` is RTF) | English | not determinable from files | Small smoke fixture; RTF-stripping + numbers-heavy script (“$11,000”, “two thousand and three”) |
| `Missing Segs Project` | `Audio.m4a` | 0.5 MB | 21.4s | ✓ | ✓ (+ `Scene Doc copy.txt`, `NEW Sync.rtf`) | English | not determinable | Hand-built normalization/skip fixture — D16 shapes on display: “thirty-seven”↔“thirty seven”, café/cafe, `SPEAKER 2:`/`NARRATOR:` labels, a zero-width character in “wor​ld” |
| `100 Segs Project` | `100 AUDIO.mp3` | 4.1 MB | 254.7s | ✓ | ✓ | English | not determinable | Mid-size project; scene doc contains malformed tag lines in the wild (`[ armband_detail]`, `[: twenty_one_reflection]`) — real Contract IN evidence, not synthetic |
| `173 Segs Project` | `voiceover.m4a` | 17.2 MB | 709.0s | ✓ | ✓ (`sync.txt`) + `assets.zip` | English | tight-pause **(CONFIRMED by Phase 1b inspector, 2026-08-04 — only 1.1% of tokens follow an audible >0.3s inter-token gap, vs. 4.2% for V6)** | THE 173/174-segment project: window-overlap regression bisect, curr-side false positive, pairIdx-20 known defect, 169/1973 token drops |
| `294 Segs Project` | `3. Voiceover.m4a` | 30.6 MB | 1265.1s | ✓ | ✓ + `4. Assets/` | English | not determinable | The contention/starvation-cascade project (segments 249–251) |
| `V6 Natural Long Pause Segs` | `6.m4a` | 32.9 MB | 1421.3s | ✓ (`All Text Files/Script.txt`) | ✓ (`All Text Files/Sync.txt`) | English | **natural / long-pause** (named in the directory) | THE V6 447-segment project — the 11 word-shift cases, the 8 seam-exemption fixes, segment 96 |
| `V8 Lin-en Fl-ax Concate Segs` | `V.8.m4a` | 31.4 MB | 1296.2s | ✓ (`Humanized Scripts.txt`) | ✓ (`Sync.txt`) + asset zips + a finished MP4 | English | not determinable | The Pass-3 sub-word concatenation evidence project (“lin”+“en”, “fl”+“ax”) |
| `Projects Backend Data` | `voiceover.m4a` (byte-identical to 173’s), `voiceover (1).m4a` (byte-identical to V6’s) | 17.2 / 32.9 MB | 709.0s / 1421.3s | — | — | English | — | **Phase 0’s backups already exist here**: `project.json` = 173 segments / 1973 transcript tokens, `project (1).json` = 447 segments / 4517 tokens — both matching the counts in `docs/boundary-drift-investigation.md`, both carrying `transcriptTokens` (i.e. the frozen transcripts), plus `v6-segments.json` / `v6-segments-full.json` |

(The V6 directory also contains creator-workflow files — `Prompts.txt`, `Description.txt`, `Agent File.txt` (instructions for the owner’s image-generation agents) — that are not sync inputs and play no role here.)

**Language coverage:** every project in the corpus is English. Of the supported set (Part H.0: English, Spanish, French, Portuguese, German), **Spanish, French, Portuguese, and German are all missing** — zero non-English material exists. H.8 requires at least one Spanish-or-French project before Phase 2a ships; acquiring it is an owner deliverable and currently blocks that phase (see K3).

**Voice-style coverage:** one confirmed long-pause project (V6, named) and, as of Phase 1b (2026-08-04), one confirmed tight-pause project (173) — the inspector measured 173’s tokens as only 1.1% likely to follow an audible (>0.3s) inter-token gap versus 4.2% for V6, resolving the earlier presumption. See Phase 1b’s entry for the full measured baseline.

## D.-1 — Lock gates: definition and the hard rule

One phase, one commit, one behaviour change, independently revertable. No phase begins until the previous one’s manual verification passes. In addition, phases are grouped by the stage whose behaviour they change, and each stage has a LOCK GATE.

**A stage is LOCKED when all four hold:**
1. Its contract (Part J) is written.
2. Every producer guarantee in that contract has been verified by owner inspection (not asserted from memory, not inferred from green tests).
3. Every UNENFORCED consumer assumption is either closed (an enforcement now exists) or explicitly accepted in writing, in this document, with a reason.
4. No known defect in that stage is deferred to a later stage.

**Ordering rule:** no phase that changes stage N’s behaviour begins until every stage before N is locked. Two exemptions, both stated here so they are not negotiated later: (i) a phase proven behaviour-neutral by a byte-identical resync gate (Phase 1, Phase 4) may run at any point; (ii) read-only measurement (Phase 2b) may run at any point.

**The hard rule:** a defect found in a locked stage REOPENS that stage and blocks all later work until the defect is closed or explicitly accepted in writing with a reason recorded here. “We’ll handle it downstream” is forbidden — that is precisely how the current compensation stack was built: a timestamp defect in transcription was handled downstream by a picker heuristic, whose failures were handled downstream by a breath detector, whose failures were handled downstream by a seam exemption.

**Cross-cutting regression checklist** — run at every stage lock, because these are the classes the phase gates themselves don’t individually watch (K11):
- Locks: toggle a lock on a corpus project, resync, confirm the locked segment’s startTime/duration unchanged. (The verification set gains one locked-segment scenario — the current forty contain none.)
- Skipped segments: confirm one boundary adjacent to a skipped segment is in the listened set and correct (the middle-gap class).
- Headings: a project with heading overlays resyncs with heading times untouched.
- No-voiceover path: a no-voiceover resync produces a character-weight timeline and the Stage 4 “estimated timeline” entry (once it exists).
- Silence-scan failure: the `{status:'error'}` path still falls back to gap centres and logs, never aborts.
- Empty-token fallback: a zero-token resync still takes the arithmetic retile path (Stage 3’s no-token mode after Phase 4).
- Persistence/reload: save, reload, confirm timeline identical and no re-transcription triggered (`lastTranscribedFileIdentity` intact).
- Export/preview consumers: spot-check that Timeline and export read the committed segments correctly (shape invariants, Contract OUT).
- DEV harnesses: `window.__calibrateBoundaryQuality` and `__ALIGN_INSTRUMENT__` (and Phase 1b’s inspector) still run, or are explicitly retired in the same commit that broke them.

## Programme phases (pre-stage)

### Phase 0 — Safety and instruments (no behaviour change)
Nothing in this phase touches the pipeline. It exists because every comparison we make later is worthless without it.

**Back up both projects — substantially already done.** The console-extraction backups for V6 (447 segments / 4517 tokens) and the 173-segment project (173 / 1973) already exist outside the app at `All Projects Test Data/Projects Backend Data/` (see D.0 — counts verified against the investigation record). Phase 0’s remaining work is to verify their completeness (segments + `transcriptTokens` + `lastTranscribedFileIdentity` present) rather than re-extract. Both are needed; the curr-side false positive was only detectable on the second one.

**Freeze the transcripts — NO new code (correction, Revision 2).** `project.transcriptTokens` already persists in the project JSON; the documented console backup captures it, and `lastTranscribedFileIdentity` prevents re-transcription on restore. There is no export/import feature to build. Every A/B comparison from here on runs against a frozen transcript, so we are always comparing pipeline changes and never accidentally comparing two different transcriptions. Note there will be two frozen-transcript eras per project: the current `base.en` transcript (baseline for Phases 1–2a) and the post-swap turbo transcript (minted at Phase 2a, baseline for everything after). Cross-era comparisons are word-keyed only, never index-keyed.
**WARNING, stated plainly:** the audio blob lives in IndexedDB keyed `[projectId, assetId]`, and deleting a project in-app deletes its blob. **Neither corpus project may be deleted from the app for the programme’s duration.** The blob is not in the JSON backup; losing it means re-staging the audio, which mints a new file identity and can trigger re-transcription.

**Verify determinism — OUTSIDE the app (correction, Revision 2).** Invoke the bundled whisper-cli twice from a terminal on the same 16kHz WAV with identical args and diff the token output. Not through the UI — that would require cache-invalidation games against `lastTranscribedFileIdentity`. PASS = byte-identical token text and timestamps across the two runs. Any diff = stop and reconsider the entire A/B method before spending a week on it. This is a one-time, blocking check.

**Define the verification set — keyed by SCRIPT-side words (correction, Revision 2).** Each boundary’s key is the last 3 normalized words of segment N’s script text plus the first 3 normalized words of segment N+1’s script text. Script text is authored and fixed for the programme; transcript text changes at Phase 2a’s model swap, so transcript-side keying would break exactly when it is most needed. The set: the eleven ear-verified word-shift pairs, the eight seam-exemption pairs, the 173-project’s known-broken pairIdx-20 boundary, roughly twenty randomly chosen controls that are currently correct, plus (added by the adversarial audit, K11) at least one boundary pair involving a locked segment and at least one boundary adjacent to a skipped segment. About forty boundaries. The controls are the important half — they’re what catches a fix that improves its targets while quietly breaking something else, which is how segment 60 slipped through as a false success.

**Record the baseline.** Listen to all forty on the current build and record a verdict for each — correct, word-shifted, or clipped — in **`docs/verification-baseline.csv`, tracked in git** (columns: script-word key, project, verdict, phase label, date). This is the baseline every later phase is measured against. It is the only trustworthy number this project will have. Superseded rows are never deleted — a new phase appends new rows with its phase label, so the history of every boundary’s verdict across the programme stays diffable in git.

### Phase 1 — Delete the duplicated gap-fill (expected: zero behaviour change; neutrality-exempt from stage ordering)
The audit established that alignScenestoTranscript’s internal gap-fill is operationally redundant: snapCoveredBoundaries recomputes every boundary from token indices afterwards, nothing downstream ever reads t0/t1 again, the first segment’s start was never written by it anyway, locked segments were always excluded from it, and on the empty-token fallback path it early-returns before reaching the gap-fill at all.
Delete it. Delete the 29 tests that exercise it — they test a function proven not to affect output, and keeping them would block the deletion for no reason.
I’m reversing my earlier position on sequencing here. I previously argued for behavioural fixes before structural ones to preserve bisectability. The audit changed that: this deletion halves the code surface of everything we’re about to rewrite, and it is provably behaviour-neutral. Doing it first is strictly cheaper.
Your verification: resync both projects with the frozen transcripts. Every segment’s start and duration should be byte-identical to the Phase 0 baseline. If anything moves, stop — the redundancy claim was wrong and we need to understand why before proceeding.

## Stage 1 — Prepare (Phases 1b, 2a, 2b, 3, 3b, 3c, 3d)

### Phase 1b — Transcript Inspector (dev-only, in-app; BLOCKING Stage 1 deliverable)
A dev-only, in-app tool whose purpose is letting the owner SEE the raw material — the tokens and silences exactly as the pipeline receives them — not scoring it. This is the instrument that proves or disproves the whole Phase 3 premise, so it lands before the model comparisons it serves (2a/2b), and Stage 1 cannot lock without its output having been inspected.

**Form:** follows `window.__calibrateBoundaryQuality`’s precedent exactly — a DEV-gated global (`window.__transcriptInspector`), invoked from the devtools console, emitting CSV (and a console.table view). It must run IN-APP: silences are never persisted and are recomputed per sync from the audio blob via Web Audio, which does not exist outside the WebView. A terminal script cannot see what the pipeline sees.

**Per-token columns:**
- text, declared start, declared end, duration, gap to the previous token.
- **SMEAR ESTIMATE** — the delta between the token’s declared start and the end of the nearest preceding detected silence. This is the number that proves or disproves the Phase 3 premise, so it must be directly visible per word, not only as an aggregate. (Sign convention: negative = the declared start precedes the end of the pause before it — the segment-96 pathology, where Whisper assigns the pause’s onset to the following word.)

**Aggregate rows:**
- Median and p95 smear (over tokens that follow a detected silence).
- Count of tokens whose declared start precedes the end of the silence before them (the segment-96 pathology), as a count and as a fraction of pause-following tokens.
- Malformed-token drop count broken down by reason (the five `TokenDrop` reasons).

**Comparison modes:**
- Side-by-side of two runs on the SAME audio (e.g. current args vs turbo vs turbo+DTW), keyed by word text/script position — never by token index, since the index space differs between runs.
- Side-by-side of DIFFERENT audio styles — at minimum one tight-pause and one long-pause project from the D.0 corpus (V6 confirmed long-pause; 173 presumed tight-pause, which this tool itself confirms or refutes).

**Explicit gate:** Stage 1 cannot be locked until the owner has inspected inspector output across at least one tight-pause and one long-pause project, and the smear distribution is understood and recorded in this document (append the measured numbers to this phase’s entry when done). What “good enough” means numerically for Stage 1 to lock, stated plainly and **provisional until Phase 2b measures it**: median smear ≤ 100ms, p95 smear ≤ 250ms, and the segment-96 pathology (negative smear) on fewer than 1% of pause-following tokens, on both inspected projects. If Phase 2b’s measurements show these thresholds were the wrong shape (e.g. the tail matters more than the median), Phase 2b revises them here, in writing, with the measurement attached.

**Measured baseline (recorded 2026-08-04, current bundled model — `base.en`, no DTW, pre-Phase-2a).** `window.__transcriptInspector()` run in-app against the persisted `transcriptTokens` and a fresh Web-Audio silence scan of the voiceover blob, for both corpus projects named in D.0. Full per-token output: `docs/v6-smear-baseline.csv` (V6, 447-seg, long-pause), `docs/173-smear-baseline.csv` (173-seg, presumed tight-pause). Every number below was independently recomputed from the raw CSV rows and matches the console-printed aggregate line exactly (data integrity cross-check); the kept/dropped token split also reconciles exactly against D.0’s own corpus-inventory counts (4517 and 1973 raw transcript tokens).

| Metric | V6 (447-seg) | 173-seg | Provisional gate | Result |
|---|---|---|---|---|
| Raw transcript tokens | 4517 | 1973 | — | matches D.0 |
| Malformed drops (`inverted-or-zero-duration` / `empty-text`) | 562 (114 / 448) | 169 (30 / 139) | — | matches D.0 (169/1973) |
| Kept tokens fed to alignment | 3955 | 1804 | — | — |
| Pause-following tokens (defined smear) | 3954 | 1793 | — | — |
| Median smear | **0.380s** | **0.760s** | ≤ 0.100s | **FAIL (both)** |
| p95 smear | **2.660s** | **4.878s** | ≤ 0.250s | **FAIL (both)** |
| Negative-smear count / fraction (segment-96 pathology) | 1359 / **34.4%** | 423 / **23.6%** | < 1% | **FAIL (both, by ~24–34×)** |
| Tokens following an audible (>0.3s) inter-token gap | 167 / 4.2% | 19 / 1.1% | — (voice-style signal) | V6 ≈4× denser in audible pauses than 173 |

**Voice-style confirmation:** D.0 presumed 173 as the tight-pause contrast project to V6’s long-pause voice, UNVERIFIED. The inspector confirms it — 173’s tokens are only 1.1% likely to follow an audible (>0.3s) inter-token gap, versus 4.2% for V6, a ~4× difference in how often either voice actually pauses between words. (D.0’s corpus table and Part D.0’s voice-style-coverage note are updated to reflect this below.)

**Gate verdict:** both projects fail the provisional Stage 1 lock thresholds by a wide margin — not a measurement defect, but the expected result given Part A’s headline claim (≈190ms average Whisper timestamp error, up to 900ms on individual words). The negative-smear fraction is the cleanest signal here, since a token can only register negative smear when it sits close enough to (or inside) a real preceding silence for its declared start to still precede that silence’s end — a stale, distant “nearest preceding silence” always yields a large *positive* delta, never negative. Read literally, **23–34% of tokens across both projects show Whisper assigning a pause’s onset to the following word** — the segment-96 pathology is not a rare edge case, it is roughly one word in three (V6) or one in four (173). This is the load-bearing evidence for Part C’s ordering argument (fence after timing upgrade, not before) and for Phase 2a/2b/3 being mandatory before Stage 1 can lock — nothing here suggests skipping them.

Caveat on median/p95, stated for future readers of this baseline: “pause-following” here means “some earlier-in-time detected silence exists” (the nearest preceding one by chronological order), not “a silence within some fixed distance.” For a token deep inside a long pause-free run, its “nearest preceding silence” can be seconds or tens of seconds in the past (173’s own max smear reaches 12.08s), which inflates the *positive* tail and therefore the median/p95 upward relative to what a proximity-windowed version of this metric would show. It does not affect the negative-count/fraction reading above, which is only ever triggered by a genuinely nearby (or overlapping) silence. Phase 2b, which measures word-onset error against ffmpeg `silencedetect` ground truth directly, is the more precise successor measurement; this baseline’s job — done — was to make the scale of the problem visible in-app, on real projects, before committing to that work.

### Phase 2a — Model swap (supersedes old Phase 2 as written; see Part H)
Provision the multilingual model (H.1), re-enable `-l auto`, store detected language per project, make it user-overridable (H.7). No timing-source change. English projects re-verified against the Phase 0 baseline: boundaries WILL move (different model, different tokens); the gate is that the forty-boundary verdict does not get worse (count of correct verdicts in `verification-baseline.csv` ≥ the Phase 0 count).
**Blocked on corpus (K3):** H.8 requires at least one Spanish-or-French corpus project before this phase ships, and the D.0 inventory shows zero non-English projects exist. Acquiring one is an owner deliverable and a prerequisite of this phase.
This phase mints the second frozen-transcript era (turbo) for both corpus projects and re-establishes the baseline: fresh resync → inspector CSV → full forty listen → new rows in `verification-baseline.csv`.

### Phase 2b — Measure the timing sources, ON THE PRODUCTION MODEL (read-only; measurement-exempt from stage ordering)
Entirely outside the app for the ground-truth half, plus the in-app inspector for the smear half. Run the bundled whisper-cli from a terminal against V6’s audio, three ways: turbo raw; turbo + `-nfa --dtw large.v3.turbo` with JSON output; and large-v3 (non-turbo) as a reference ceiling. (The reasoning for measuring on turbo rather than base.en is H.2’s: DTW reads model-specific alignment heads, so a base.en measurement does not describe turbo.)
For each, measure word-onset error against ground truth. Ground truth comes from ffmpeg’s silencedetect: a word that follows a pause must begin when the pause ends. This is the method already used in the investigation, and it produced the 190ms figure we’re trying to beat.
**Deliverable added by the adversarial audit (K8): the measurement script is COMMITTED** (e.g. `scripts/measure-word-onset.md` + the script itself) — the original investigation’s harness lived in `/tmp` and was lost (`docs/audit-verification-2026-08-03.md` §C.7); this measurement must be re-runnable without archaeology.
Decision gate unchanged in form: under ~100ms median error, DTW is adopted in Phase 3. Above that, DTW is abandoned permanently and Phase 3 becomes forced alignment. Note the expected shift: turbo’s weaker timestamp head makes forced alignment MORE likely to win, not less. If turbo’s DTW is materially worse than large-v3’s, that is an explicit accuracy-vs-speed product decision to be made with the number in hand.
Your verification: none needed — this phase produces a number, not a behaviour. It also finalizes Phase 1b’s provisional lock thresholds.

### Phase 3 — Upgrade the timing source
Whichever won. If DTW: switch the Rust side to JSON output, which the audit confirmed is new code rather than a flag flip, and replace the progress bar with an elapsed-time indicator since progress currently scrapes the same stdout lines that -nfa breaks. If forced alignment: bundle ONNX Runtime and the CTC model (multilingual per H.3), implement the Viterbi pass, and slot it behind the Stage 1 timing interface.
Either way the interface is identical and the pipeline below is untouched.
Your verification: resync both projects. Expect boundaries to move (this phase shifts token indices — fewer timestamp-based malformed drops — so the baseline is re-established: fresh resync → inspector → full forty listen → new `verification-baseline.csv` rows). Listen to the full forty-boundary set. Record the new verdict. Some of the eleven word-shift cases may already resolve here, because the gaps become real. Some of the eight may regress, because the seam exemption was tuned to compensate for smear that no longer exists. Both outcomes are informative and neither blocks the phase — what blocks it is a control boundary regressing, because that means the new timings are worse somewhere we weren’t looking.

### Phase 3b — Language-keyed normalization (moved from old Phase 8 / H.5 — see K1)
The main multilingual work item — full specification in H.5 (per-language number words and reading rules, currency equivalents, the inverted thousands separators, French elision vs. English contraction expansion; every rule additive and language-keyed).
GATE: the English path must be provably byte-identical to today’s, verified against the frozen English baseline — so this phase does NOT shift English indices. Non-English rule verification requires the non-English corpus (K3); if only one non-English project exists by this point, the others’ rules land dormant behind their language keys and are verified when corpus material arrives — recorded as an explicit written acceptance at the Stage 1 lock.

### Phase 3c — Hyphen asymmetry (moved from old Phase 8 — see K1)
textNormalize.ts glues mid-call into one alignment word while Whisper emits two tokens, so neither matches and the segment’s end is understated. Six occurrences on V6, timing impact on one. This rewrites the alignment corpus on both sides and interacts with the deliberate NUMBER_WORDS carve-out, so it’s its own commit with its own re-listen of the set. It shifts English token/word indices — the last index-shifting event of Stage 1, after which baselines are stable for the rest of the programme (K9).

### Phase 3d — Adaptive silence thresholds (conditional; moved from old Phase 8 — see K1)
Replacing the fixed −45dB scan with noise-floor estimation, ONLY if Phase 2b’s measurements show the fixed threshold is costing us (it changes the silence array, which the fence consumes — so under stage locking it is Stage 1 work, not an afterthought). If 2b shows no cost, record that finding here and skip this phase.

### STAGE 1 LOCK GATE
- Contract IN and Contract 1→2 (Part J) verified guarantee-by-guarantee by owner inspection.
- Inspector inspected across ≥1 tight-pause and ≥1 long-pause project; smear distribution recorded in Phase 1b’s entry; numeric thresholds met (as finalized by 2b).
- Determinism check passed (Phase 0).
- Non-English corpus status resolved: either H.8’s minimum corpus exists and was exercised, or the specific gap is accepted in writing here with a reason and a reopening trigger.
- No Stage 1 defect deferred downstream (the hyphen asymmetry and threshold questions are closed inside Stage 1 by 3c/3d — that is why they moved).
- Cross-cutting regression checklist (D.-1) run and clean.

## Phase 4 — Restructure into four stages (structural only, timing held identical; neutrality-gated)
Reorganize into the four stages of Part B. Move the coverage partition to the end of Stage 2. Make Stage 2’s return type timing-free (as precisely scoped in Part B / K5 — token indices, counts, and provenance enums only; `audioRegion`/`recoveredRegion` do not survive; Stage 4 derives display ranges from indices). Thread Stage 1’s output as one object so tokens/silences cannot be sourced from anywhere else (closes R7 at the type level). Collapse distributeSegmentTimes and applyAnchorBasedTiming into Stage 3, carrying forward their lock handling and backstop monotonic clamp — and preserving the one consumer OUTSIDE the sync pipeline: `App.tsx`’s `handleToggleLock` (App.tsx:1686) re-derives timing via `applyAnchorBasedTiming` on every lock toggle, so Stage 3’s placement must remain callable as a pure function from that handler (K4). Add the cheap Stage 2 output-order assertion (closes R13). Rename the two colliding MIN_SEGMENT_DURATION constants to ENGINE_MIN_SEGMENT_DURATION_SEC and UI_MIN_SLOT_DURATION_SEC — rename, do not merge, do not change either value. syncConstants.ts documents the non-consolidation as deliberate and it is correct: one governs timing output, the other governs drag-handle UX, and 0.15 would silently move both. Delete the statically-dead staging-path consumer (`useWhisper.ts:286` runs only with `segments: []` — audit §B.4). Update or retire the DEV harnesses (`__calibrateBoundaryQuality`, `__ALIGN_INSTRUMENT__`, the Phase 1b inspector) in this same commit — they read pipeline internals and a silent break here is how instrument rot starts (K11).
The boundary logic in this phase is a move, not a change. Same algorithm, new location.
Your verification: resync both projects. Byte-identical to Phase 3c’s baseline. Any movement is a bug in the move.

### STAGE 2 LOCK GATE
- Contract 2→3 (Part J) verified guarantee-by-guarantee: the timing-free type compiles the duplication away; partition order preserved; skip semantics (5+3→5) pinned by a change-detector.
- The three surviving Stage 2 risks — R6 (vacuous forward bound on a zero-match tail), R10 (run-survival calibration, now including the new model’s output and eventually non-English), R12 (no DP cost bound) — each closed or explicitly accepted in writing here with a reason.
- Cross-cutting regression checklist run and clean.

## Stage 3 — Place (Phases 5, 6, 6b)

### Phase 5 — Replace the picker with the fence
Now it works, because Phase 3 gave it real gaps. Implement Part C’s four-line rule. Delete computeBoundarySearchWindow, isBoundarySilenceCandidate, fillsTokenGapWithinSpan, the three-pass contention assignment (which also deletes the silence-identity `Map` and with it Risk R8, structurally), and the degenerate-pair guard — the last one because an inverted gap is now handled explicitly by the rule’s third clause rather than by a 5-second escape hatch.
Keep isBreathSilence and the seam exemption for now. Do not delete them in the same commit. They exist to recover a pause outside the timestamp gap, which better timings should make impossible — but “should” isn’t “did.” They get their own deprecation phase.
Your verification: the full forty. The eleven word-shift cases should be zero, because theft is now structurally impossible. If any remain, the boundary was not the problem there and we need to look at the alignment span instead — the inspector will show which.

### Phase 6 — Deprecate the compensation layer
Now the eight stop being a benchmark and become what they should have been: a regression check on a deletion.
Turn the seam exemption off. Resync. If the eight are still correct without it, delete isBreathSilence, the multi-fragment override, the seam exemption, and the four constants behind them. If any of the eight regress, the exemption is still load-bearing and stays — and we’ve learned something specific about where Phase 3’s timings are still insufficient, which is a real finding rather than an argument.
Your verification: the eight, plus the twenty controls.

### Phase 6b — pairIdx-20 verification (moved from old Phase 8)
The 173-project’s pairIdx-20 boundary, currently pinned as a known defect at 75.660 against a correct target of 76.470 — likely resolved by Phase 5, verified here (it is a Stage 3 defect and must be closed or accepted before Stage 3 locks, per the hard rule).

### STAGE 3 LOCK GATE
- Contract 3→4 (Part J) verified: fence-inside-gap property, contiguity-by-arithmetic, single lock-handling site, no clamps in Stage 3.
- pairIdx-20 closed or accepted in writing.
- The eight and the controls hold per Phase 6.
- Cross-cutting regression checklist run and clean.

## Stage 4 — Finalize and Report (Phase 7)

### Phase 7 — Observability
Every clamp, floor, fallback, degenerate boundary, and estimated-timing decision emits a log entry with a plain-language fix hint — the concrete work list is Contract OUT’s “required additions” table in Part J. The boundaryUsedFallback bug the audit found gets fixed here — it calls isBreathSilence with four arguments instead of five, defaulting the seam exemption off, so every boundary-quality reading on a seam-exempted pair has been wrong since it shipped. If Phase 6 deleted the exemption, this bug deletes itself.
Your verification (rewritten by the adversarial audit, K7 — the old “confirm you can understand every entry” gate was unfalsifiable): resync a corpus project that produces at least one WARNING and one ERROR, then run the six-question reader rubric absorbed into Contract OUT (Part J). PASS = all six questions pass. Any FAIL names the specific entry, and that entry’s message or hint is rewritten before this phase closes.

### STAGE 4 LOCK GATE (= programme close)
- Contract OUT verified, including the severity taxonomy and the emptied gap list.
- The reader rubric passes.
- The 96.2% figure formally retired in favour of the `verification-baseline.csv` verdict counts (Part G).
- Cross-cutting regression checklist run and clean.
- All standing docs updated (CLAUDE.md invariants, project-state.md, this file’s tables).

Part E — Every way this plan can break, and how the architecture prevents it
This is the section you asked for, and it is the reason this document is long. (Part K extends it with the breaks found by the 2026-08-03 adversarial audit.)
The fence reverts the eight. Prevented by ordering: Phase 3 before Phase 5, and Phase 6 as an explicit deprecation gate rather than a silent deletion. Proven with real segment-96 numbers rather than assumed.
A comparison is made against a different transcript. Prevented by Phase 0’s frozen transcripts — which need no new code; `project.transcriptTokens` persists and the console backups capture it. Without this, getFileIdentity — name, size, mtime — can silently invalidate on a re-stage and trigger re-transcription mid-programme, making two phases incomparable with no visible signal.
Index-keyed references break after Phase 3. Prevented by script-side word-keying the verification set from the start. filterMalformedTokens drops on timestamps; better timestamps mean fewer drops mean every index shifts. Thirty of the 173-project’s 169 drops were timestamp-based, so this shift is certain, not hypothetical. Every existing reference to “segment 96” in every document becomes wrong at Phase 3 — and transcript-side words become wrong at Phase 2a, which is why the keys are script-side (Task 5c correction).
whisper-cli isn’t deterministic. Caught by Phase 0’s double-transcribe (run from the terminal, outside the app). If it isn’t, we stop and reconsider the entire A/B method before spending a week on it.
Manual verification becomes too expensive to actually do. Prevented by the fixed forty-boundary set plus the inspector. Verifying 447 boundaries per phase is not going to happen, so a plan that requires it is a plan that gets skipped. Forty, script-word-keyed, with a tool pointing at exactly where to listen, is fifteen minutes. Total listen budget across the programme: five full passes (Phase 0 baseline, 2a, 3, 3c re-listen, 5) plus Phase 6’s twenty-eight — bounded and stated up front.
A fix improves its targets and breaks something unwatched. Prevented by the twenty controls in the verification set. This is precisely how segment 60 was counted as a success — its corrupted boundary happened to land inside a detected silence, so a silence-containment metric scored it as improved. Controls are the only defence against a metric measuring the wrong thing.
Locked segments get moved. Locks are now checked in exactly one place — Stage 3, where all timing is decided. Today they’re checked in five places across two files. One place cannot disagree with itself. (And the lock-toggle UI handler keeps working because Stage 3’s placement stays callable — K4.)
Skipped segments change behaviour. Today filterToCoveredSegments drops uncovered segments entirely: five covered plus three uncovered commits five segments. That’s product behaviour, not an accident. Preserved explicitly in Stage 2, and stated here so nobody “fixes” it later.
Kept segments aren’t adjacent in the original array. After the partition, kept segments 5 and 9 are neighbours in the surviving array but had three dropped segments between them in the script. Stage 3 must treat the gap between them as a real gap and not assume contiguous original indices. Stated as a Stage 3 precondition.
The contiguity invariant breaks. Structurally impossible now: Stage 3 derives each duration as nextBoundary − thisBoundary, so start[i] + duration[i] === start[i+1] is arithmetic, not a property to be maintained by a post-hoc check. Today it’s enforced by an appended if that was added after overlapping cards appeared in the timeline.
The no-voiceover path breaks. Stage 3 has an explicit character-weight mode with the same output shape. Today this path fabricates a duration of five seconds per scene with no log entry saying the timeline length is invented; Stage 4 now logs it.
The silence-scan-failed path breaks. Distinct from “no silence found” — they have opposite consequences and the type system already keeps them distinct. Stage 3 falls back to gap centres and Stage 4 logs it. Sync continues; it never aborts on a failed scan.
Headings get disturbed. Headings are a separate top-level overlay layer with fixed absolute times and no participation in segment timing math. No stage touches them. Stated so the rewrite doesn’t quietly re-couple them.
Head and tail extension get lost in the move. Segment one stretches back to zero, the last segment runs to the audio end. Both are Stage 4, both explicit.
Two silences sit in one gap. Rule: longest silence, intersected with the gap, cut at the intersection’s centre. Deterministic and stated, so it isn’t decided ad hoc during implementation.
A silence extends beyond the gap on either side. Intersect first, then take the centre. Never cut outside the gap, even if the silence continues.
Progress reporting breaks at Phase 3. parse_progress_line scrapes the same stdout that -nfa breaks. Accepted, planned: elapsed-time indicator instead of percentage. A 21-minute transcription with no progress bar is a real UX regression, and it only lands if DTW actually wins the Phase 2b measurement.
The ONNX path is bigger than estimated. Mitigated by Phase 2b’s decision gate — we only take that path if the cheap one measurably fails — and by the timing interface, which means the model is swappable and a failure there doesn’t strand the rest of the plan.
Better timings don’t fix word-shift. Possible, and handled: Phase 5’s fence removes theft regardless of timing quality, because it removes the permission to reach past a word. Phase 3 and Phase 5 attack the problem independently. If Phase 3 disappoints, Phase 5 still lands.
Some of the eleven turn out to be alignment errors, not picker errors. The investigation reports the aligner exonerated at 447/447, but doesn’t state how that was verified. The inspector’s output distinguishes the two directly: a wrong span shows as the wrong words attributed to a segment, a wrong cut shows as correct words with the cut misplaced inside a correct span. If any of the eleven are span errors, Phase 5 won’t fix them and we’ll know immediately rather than after a failed phase.
Rollback is needed mid-programme. One phase, one commit, one behaviour change. Any phase reverts alone in code; the honest caveats are in K10 (baseline rows invalidated by reverting 2a/3, and stacked commits unwind top-down).
A phase both fixes and breaks. Rule, stated now to avoid negotiating it under pressure: any regression on the verification set blocks the phase until explained. Not “net positive.” Explained. Every incident in this project’s history was a net-positive change with an unexplained regression inside it.
The plan itself becomes stale. Every phase updates CLAUDE.md’s invariants, project-state.md’s status, and this document’s phase status before the next phase begins. A stale architecture document is treated as a bug of the same severity as stale code.
Part F — Explicitly not doing
Not merging the duration floors into a single 0.15. They govern different concerns and the merge changes both values.
Not retuning any existing constant. Every one carries a documented calibration story derived from a specific production project; retuning without that project’s evidence is how the window-overlap regression happened. The plan deletes constants; it does not adjust them.
Not touching the Hirschberg alignment, the rescue passes, the forward-ordering bound, or the run-survival gates. The aligner is exonerated. Leave it alone.
Not resolving the R5/N4 bracket split. Product ruling, not a code fix. (Recorded as a written acceptance at Contract IN — Part J.)
Not using unit tests as evidence of correctness. They may exist as change-detectors — “this value moved, is that intended?” — and that is their entire permitted role. Three fixes shipped broken this month with green tests, because the fixtures used synthetic token geometry that real Whisper output never produces. Any test written from here on uses real token data from V6 or the 173-project, drives the complete pipeline including filterMalformedTokens, and is understood to be a tripwire rather than a proof.
Part G — What “100%” means, and why it’s reachable
Two numbers, because they’re different problems and merging them is how a real defect gets closed as acceptable.
Structural correctness — 100% is the bar and it’s achievable. No word on the wrong side of any cut. No silent clamp, floor, or fallback anywhere. Contiguity, monotonicity, and lock preservation hold unconditionally on every path including fallbacks. This is a logic property, provable by construction — Part C’s rule makes theft impossible arithmetically rather than statistically — and checkable on both projects. Every one of the four open bugs lives in this class.
Perceptual placement — 100% means every cut is either correct or correctly flagged. When the script genuinely doesn’t match the audio, there is no correct boundary, and pretending otherwise is what produces the worst failures. But with accurate word timings that case becomes detectable: a segment whose words don’t appear in the audio, or a seam with no gap at all, can be flagged rather than guessed. A flagged unknown is a solved case. That’s the honest version of your belief that every bug is fixable — the bugs are fixable, and the genuinely ambiguous inputs become visible instead of silently wrong.
The current 96.2% figure should be retired. It was measured as “the cut landed inside a detected silence,” which is one of the four metrics that lied this month — it scored a corrupted boundary as an improvement. Phase 0’s baseline replaces it with a number derived from your ears on a fixed, script-word-keyed set, recorded in `docs/verification-baseline.csv`. That number will probably be lower than 96.2% and it will be the first trustworthy one this project has had.
Summary of changes from your proposal
Adopted essentially whole: the four-stage collapse, the removal of the duplicated gap-fill, the fence on the boundary picker, the elimination of silent fallbacks, and Objection 2’s principle that when there is no pause the correct behaviour is to cut at the seam and stop searching.
Changed: the fence moves from first to Phase 5, behind the timing upgrade, because segment 96’s real numbers show it reverts eight boundaries otherwise. The coverage partition moves from Stage 3 to the end of Stage 2. The floor consolidation becomes a rename rather than a merge. The hyphen fix becomes its own phase rather than a line item. Stage 2’s return type loses its time fields so the duplication cannot return.
Added: Phase 0’s safety and instrument layer; script-word-keyed verification; the determinism check; the frozen-transcript requirement; the timing-source interface; the seam-exemption deprecation gate; and the boundaryUsedFallback fix the audit uncovered. Revision 2 additionally adds: stage contracts (Part J), stage locking with lock gates (Part D), the Transcript Inspector as a blocking Stage 1 deliverable (Phase 1b), the Russian descope (Part H), and the adversarial-audit revisions (Part K).
Corrected in your proposal: the narrow-gap expansion you identified is real and verbatim in the code — but the <0.1s → 1.0s branch is not the main culprit. The Math.max(0.5, …) floor is, because a 0.5s minimum radius always reaches past at least one word at normal speech rate. Your instinct was right; the mechanism is one line over.

Part H — Multilingual Production Support

Requirement: native sync across a DEFINED set of production languages.
English-only binaries (base.en / small.en) are not viable.

H.0 SUPPORTED LANGUAGE SET — this scopes everything below
  Supported, must work perfectly: English, Spanish, French, Portuguese,
  German.
  Five languages, all Latin script, all whitespace-delimited, all top-tier
  resource languages in Whisper's training data.
  RUSSIAN WAS DESCOPED 2026-08-03 by product decision — it was in this set in
  Revision 1 of this plan. It is now unsupported like any other language
  outside the five; H.4's guard covers it. Do not reintroduce it as an
  oversight: readding Russian means re-adding the Cyrillic normalization work
  (e/yo fold, Cyrillic-aware rules) that Revision 2 deleted from H.5, plus a
  Russian verification project in H.8 — a deliberate product decision, not a
  line edit.
  EXPLICITLY OUT OF SCOPE: Russian (descoped above), Chinese, Japanese, Thai,
  Vietnamese, and any other language without whitespace word boundaries; any
  RTL language. Not "untested" — descoped by product decision, because no
  content is produced in them.
  CONSEQUENCE: Stage 2's whitespace word-splitting assumption HOLDS for the
  supported set, so no per-language segmentation-strategy interface is built.
  See H.4 for the guard that keeps this from failing silently if the set is
  ever widened.

H.1 Target model
  ggml-large-v3-turbo.bin. 99+ languages, near-large-v3 accuracy, 6-8x faster
  and roughly half the memory of large-v3. -l auto re-enabled in whisper.rs
  once loaded (today it is deliberately absent because the bundled model is
  .en-only and whisper-cli silently ignores -l auto on an .en model).
  Scope note: turbo's known accuracy degradation is concentrated on
  low-resource languages. All five supported languages are high-resource, so
  the narrowed scope makes this model choice SAFER, not riskier.

H.2 PHASE REORDER — this supersedes the original Phase 2 as written
  large-v3-turbo is a pruned-decoder distillation. whisper.cpp's DTW reads
  model-specific cross-attention alignment heads (hence a separate --dtw preset
  per model), and timestamp prediction lives in the decoder that turbo prunes.
  Therefore a DTW measurement taken on base.en does not describe turbo.

  Phase 2 splits (now formalized in Part D's Stage 1 group):
    Phase 2a — Model swap. Provision the multilingual model, re-enable -l auto,
      store detected language per project, make it user-overridable (H.7).
      No timing-source change. English projects re-verified against the Phase 0
      baseline: boundaries WILL move (different model, different tokens); the
      gate is that the forty-boundary verdict does not get worse.
    Phase 2b — Timing measurement, ON THE PRODUCTION MODEL. Measure word-onset
      error three ways: turbo raw, turbo + `-nfa --dtw large.v3.turbo`, and
      large-v3 (non-turbo) as a reference ceiling. Ground truth = ffmpeg
      silencedetect, same method that produced the 190ms figure. The
      measurement script is committed (Part D, Phase 2b).
    Decision gate unchanged in form: under ~100ms median -> adopt DTW in Phase 3.
      Above -> forced alignment. Note the expected shift: turbo's weaker
      timestamp head makes forced alignment MORE likely to win, not less. If
      turbo's DTW is materially worse than large-v3's, that is an explicit
      accuracy-vs-speed product decision to be made with the number in hand.

H.3 Forced alignment, if Phase 2b triggers it
  Multilingual acoustic backbone (MMS / wav2vec2-multilingual), not an
  English-only wav2vec2. All five supported languages are well covered by
  MMS-FA.
  The MMS fact, stated positively: MMS forced alignment romanizes input text to
  a shared token inventory (uroman) and aligns against ONE multilingual CTC
  head. Therefore Stage 1's timing interface passes the language code to select
  a ROMANIZATION/TOKENIZATION strategy — that is the entire per-language
  surface of the forced-alignment path.
  (One line of history, kept so the correction isn't lost: an earlier framing
  of this section wrongly assumed MMS selects a per-language phoneme set —
  functionally similar, materially different to implement.)
  Verify the romanization/CTC mechanics against the MMS-FA documentation before
  Phase 3-FA implementation begins — the description above is from model
  recall, not from a local read of the MMS docs (same UNVERIFIED discipline as
  H.9).

H.4 NO segmentation-strategy interface — plus the guard that replaces it
  All five supported languages are whitespace-delimited, so the whitespace
  split Stage 2 already relies on is correct for all of them. Do NOT build a
  per-language segmentation abstraction; it is speculative generality for a
  descoped case.
  REQUIRED GUARD instead: when the detected or user-set language is outside the
  supported five, the pipeline must WARN LOUDLY (a Stage 4 log entry at error
  severity, plus a visible banner) stating the language is unsupported and sync
  accuracy is not guaranteed. This guard now covers Russian too (descoped,
  H.0). Rationale: whitespace-splitting a Mandarin script yields a handful of
  enormous tokens, and Hirschberg will align them into confident garbage with
  no other signal that anything is wrong. Silent degradation on an unsupported
  language is the one failure mode this narrowed scope introduces, and the
  guard is what closes it.

H.5 Language-keyed normalization (Phase 3b, Stage 1) — THE MAIN MULTILINGUAL WORK ITEM
  textNormalize.ts's 13-step canonicalizer is English-specific. Under the
  narrowed scope the segmentation problem disappears but this one gets WORSE,
  because it silently inverts the D16 equivalence class it was built to serve:
    - Digit-run expansion reads "37" as "thirty seven". Spanish Whisper output
      is "treinta y siete". The script side canonicalizes to English words and
      the transcript side to Spanish words, guaranteeing a mismatch on every
      number in four of five languages. Needs per-language number words and
      reading rules, following exactly the existing D16 pattern (canonicalize
      BOTH forms to one, both directions, since Whisper emits digits sometimes
      and words other times depending on context).
    - Currency/symbol expansion ($ -> dollars) is English-only; needs per-language
      equivalents (EUR/euros, etc.).
    - THOUSANDS SEPARATORS ARE INVERTED: "1.234,56" in German/Spanish/
      Portuguese means English's "1,234.56". The current separator step
      actively mangles these. Not cosmetic — it corrupts the token.
    - French elision (l'homme, qu'il, j'ai): the apostrophe fold is safe only
      if symmetric; the English CONTRACTION EXPANSION list must not fire on
      French.
    - The R1 NUMBER_WORDS hyphen carve-out is English-only by construction.
  (The Cyrillic e/yo fold and Cyrillic case-folding items that appeared here in
  Revision 1 were deleted with the Russian descope — H.0.)
  GATE on this change: the English path must be provably byte-identical to
  today's, verified against the frozen English baseline. Every non-English rule
  is additive and language-keyed.

H.6 Character-weight proportioning — minor under the narrowed scope
  parseProjectData's character-weight estimate assumes characters approximate
  speech time. Across the five supported languages this varies roughly 15-20%
  (German's longer orthographic words vs. Spanish's higher syllable rate), not
  the ~3x a CJK script would have introduced. It affects only estimate anchors
  and the no-voiceover path, both overwritten by real alignment on the audio
  path. Downgraded to a footnote: optionally add a per-language weight; at
  minimum Stage 4 logs that a no-voiceover timeline is estimated. Do not treat
  this as blocking.

H.7 Language detection is a suggestion, not a fact — STRONGER in this set
  -l auto detects from the first 30 seconds. Two compounding problems:
    - A voiceover opening with music, room tone or a stinger will misdetect.
    - Spanish/Portuguese confusion is a classic Whisper -l auto failure — they
      are acoustically close, and BOTH are in the supported set. French/
      Portuguese misdetection also occurs.
  Therefore: store language per project, expose it as an explicit override in
  project settings, default to detection but treat it as a suggestion. A
  misdetected language now selects the wrong normalization rules (H.5), so the
  cost of misdetection is higher than it was when everything was English.
  Mixed-language audio within one project is explicitly out of scope for v2.

H.8 Verification set must include non-English projects (amends Phase 0)
  Every current corpus project is English (D.0's inventory — Spanish, French,
  Portuguese, and German are ALL absent). Required additions before Phase 2a
  ships, at minimum:
    - One Spanish or French project — French preferred for elision, Spanish
      preferred for number-word coverage; ideally one of each.
  (The "one Russian project" requirement from Revision 1 is deleted with the
  Russian descope, H.0.) No CJK/Thai project is needed (descoped, H.0). The
  verification set may start English-only at Phase 0 and be populated before
  Phase 2a, but multilingual MUST NOT ship verified only against English —
  same class of error as scoring a fix against synthetic fixtures. Acquiring
  this corpus is an owner deliverable and currently BLOCKS Phase 2a (K3).

H.9 Open operational decision (not architectural — flagged for the owner)
  **The three model-size figures below are UNVERIFIED — MEASURE BEFORE
  DECIDING.** They came from a model's recall with a May 2026 knowledge
  cutoff, not from measurement, and a bundling/minimum-RAM decision must not
  be made from them. How to verify: HuggingFace's model repos list exact file
  sizes for every ggml quantization (check `ggerganov/whisper.cpp`'s model
  listing for `large-v3-turbo` variants); resident inference memory is
  measurable with one local run (Activity Monitor / `time -l` against
  whisper-cli on a corpus WAV).
  As recalled (UNVERIFIED): large-v3-turbo ~1.6GB unquantized, ~574MB at q5;
  roughly 2GB resident during inference. Current bundle ships a 141MB base.en
  (that figure IS verified — `src-tauri/models/README.md`). If the measured
  numbers are of this order, this is a DMG-size and minimum-RAM decision and
  likely means download-on-first-use with a checksum rather than bundling.
  Record the decision here when made; do not assume one during implementation.

Part I — Reviewer Notes

Transcription-only pass (Revision 1); each flag now carries its Revision 2 resolution.

1. ~~Part C's segment-96 numbers lack a source citation.~~ **RESOLVED (Revision 2, Task 6a):** Part C now cites the numbers to the test fixtures committed in `c593f1d` (`syncTiming.test.ts`), reported at `docs/audit-verification-2026-08-03.md` §C.8 and calculated at §D.12/§D.13 — and states the accompanying limit: segments 34 and 412 have no equivalent fixture, so the ordering argument rests on segment 96 (plus the five sibling fixtures) alone.

2. ~~H.3's MMS "correction" referenced an unstated original spec.~~ **RESOLVED (Revision 2, Task 6b):** H.3 now states the MMS fact positively (romanization to a shared token inventory, one multilingual CTC head, language code selects a romanization strategy) with a single line of history noting the earlier per-language-phoneme-set framing was wrong, plus a verify-before-implementation pointer.

3. ~~H.9's size figures carry no sourcing.~~ **RESOLVED (Revision 2, Task 6c):** H.9 now marks all three figures UNVERIFIED — MEASURE BEFORE DECIDING, names their provenance (model recall, May 2026 cutoff), and states the verification method (HuggingFace file listings; one-run resident-memory measurement).

Part J — Stage Contracts

Adopts the concept from `docs/sync-pipeline-contract-plan.md` — producer guarantees / consumer assumptions / enforcement / failure mode — rewritten for the NEW 4-stage architecture. That document remains the authority on the OLD pipeline's §2 assumption tables; its R1-R14 risk register is not restated here — it is MAPPED here (end of this part) onto the new contracts.

Enforcement vocabulary, in order of preference: **type-level** (violation cannot compile — Stage 2's timing-free return type is the model; prefer this wherever the type system can express the rule) > **runtime-checked** (violation detected in a cheap linear scan and logged) > **manually-verified** (owner inspection at the stage lock) > **UNENFORCED** (must be closed or accepted in writing before the owning stage locks). Per contract, what the type system CAN and CANNOT enforce is stated explicitly. Every SILENT-DEGRADATION failure mode names the Stage 4 log entry that surfaces it; where none exists yet, the entry is listed in Contract OUT's REQUIRED ADDITIONS table and building it is Phase 7 work.

### Contract IN → Stage 1 (user inputs: audio, script, scene doc, assets)

The "producer" is the user plus the staging UI, so guarantees are what the app enforces on intake.

| # | Producer guarantees | Enforcement | Failure mode if violated | Phase that makes it true |
|---|---|---|---|---|
| P1 | Voiceover duration is positive-finite or the sync hard-aborts (native probe throws; abort logged + toast) | Runtime-checked | Crash-equivalent (clean abort), never a wrong number | True today (carried) |
| P2 | Scene doc parses to ≥1 segment or hard abort | Runtime-checked | Clean abort | True today (carried) |
| P3 | A staged voiceover with zero cached transcript tokens hard-aborts; NO voiceover at all is valid (character-timed project) | Runtime-checked | Clean abort / valid path | True today (carried) |
| P4 | A file dropped on the Voiceover slot classifies as audio or raises a slot error | Runtime-checked | Slot error, never silent misroute | True today (carried) |
| P5 | Each project carries a language (detected, user-overridable) | Type-level (field on Project) + runtime (detection) | Wrong normalization rules selected — SILENT DEGRADATION → surfaced by `unsupported-language` ERROR entry when outside the supported five (H.4); a *misdetected supported* language has no automatic detector — mitigated by the visible override (H.7) | Phase 2a |

| # | Consumer assumptions (Stage 1) | Enforcement | Failure mode if violated | Phase |
|---|---|---|---|---|
| A1 | The audio container is decodable (ffmpeg pre-transcode accepts virtually anything) | Runtime-checked (transcode failure → real error) | Clean error | True today |
| A2 | Bracket tags delimit scenes as the author intended | **UNENFORCED — accepted in writing** (R5/N4 mid-line split; product ruling required, Part F). Real-world evidence the acceptance is load-bearing: the 100 Segs corpus scene doc contains `[ armband_detail]` / `[: twenty_one_reflection]` malformations (D.0) | Wrong segmentation — SILENT DEGRADATION → partially surfaced by `skip` entries when the phantom segment fails coverage (the v2 partition drops it — the correct outcome); no dedicated entry, and none planned until the product ruling | Accepted; reopening trigger = product ruling |
| A3 | The script/scene language matches the project's language setting | UNENFORCED (nothing compares script language to the setting) | Wrong normalization — SILENT DEGRADATION → no direct entry; indirect signal via coverage-gate WARNING/abort. Listed as a required-addition candidate (`language-mismatch`, heuristic, LOW priority) in Contract OUT | Close-or-accept at Stage 1 lock |
| A4 | An asset tag resolves to at most one asset; an asset feeds at most one segment | Runtime-detected but console-only today | SILENT DEGRADATION → **no entry exists — REQUIRED ADDITION** `ambiguous-tag` / `duplicate-asset` (Contract OUT) | Phase 7 |

Type-level limits: TS can carry the language field and make "no voiceover" a typed state (optional `voiceoverId`); it cannot validate tag grammar or that audio content matches the script — those stay runtime/manual.

### Contract 1 → 2 (Stage 1 → Stage 2: prepared tokens/silences/normalized text → alignment)

| # | Producer guarantees (Stage 1) | Enforcement | Failure mode if violated | Phase |
|---|---|---|---|---|
| P1 | Every token has finite timestamps, 0 ≤ start < end ≤ audioDuration + tolerance, and text that normalizes non-empty (malformed tokens dropped, drops recorded with reasons) | Runtime-checked (`filterMalformedTokens`, exists) | Wrong number downstream if unfiltered | True today (carried) |
| P2 | Tokens are ascending in time | Runtime-checked (`validateTokenOrdering`, exists) → WARNING entry | SILENT DEGRADATION → surfaced by the existing contract-violation WARNING entry | True today (carried) |
| P3 | Drop distribution is reported; clustering flagged | Runtime-checked (`analyzeDropDistribution`, exists) → WARNING entry | SILENT DEGRADATION → surfaced by existing `malformed-token` entry + clustering WARNING. Note: thresholds recalibrate at Phase 2a — a new model has a new drop profile | Carried; recalibrated Phase 2a |
| P4 | Silences are ascending, disjoint, each ≥ minimum duration | By construction today; runtime assertion is a **REQUIRED ADDITION** (cheap linear scan → WARNING) | Wrong boundary placement — SILENT DEGRADATION → no entry today; add `silence-scan-anomaly` WARNING (Contract OUT) | Phase 4 |
| P5 | "Silence scan failed" and "no silence found" are distinct states | Type-level (discriminated union, exists) | Cannot compile away the distinction | True today |
| P6 | Both text sides pass through the SAME language-keyed normalizer; English path byte-identical to pre-v2 | Type-level partially (one module, one entry point); symmetry property manually-verified | Alignment corpus asymmetry — SILENT DEGRADATION → no direct entry; indirect via coverage WARNING. The hyphen asymmetry (Phase 3c) is exactly this failure mode, live today | Phases 3b/3c |
| P7 | The timing source that produced the timestamps is identified on the output | Type-level (interface field) | Cannot mix eras unknowingly; log states the source | Phases 3/4 |
| P8 | Tokens, silences, audioDuration, and normalized script segments are returned as ONE object | Type-level (Stage 1 output type) — this is what retires the "same filtered array" convention (old R7): consumers cannot reach for `project.transcriptTokens` if the API only accepts the Stage 1 output object | Silently wrong boundaries (the old R7 failure) — made unrepresentable | Phase 4 |

| # | Consumer assumptions (Stage 2) | Enforcement | Failure mode | Phase |
|---|---|---|---|---|
| A1 | Whitespace splitting yields words for the project language | Manually-verified for the supported five (H.0); guarded outside it (H.4 → ERROR entry + banner) | Confident garbage alignment — SILENT DEGRADATION → surfaced by `unsupported-language` ERROR | Phase 2a |
| A2 | A token's text may hold multiple words / normalize oddly | Runtime (token-word expansion, exists) | Handled today | Carried |
| A3 | Every parsed segment has an estimate `anchorStart` (rescue windows key off it) | Runtime (parseProjectData assigns it) | Rescue gate misfires (the 2026-07-31 heading incident class) — bounded by the forward-ordering bound; skip surfaced via `skip` entry | Carried |
| A4 | Alignment cost is bounded for real inputs | **UNENFORCED** (old R12; `__ALIGN_INSTRUMENT__` dormant) | UI hang behind the loading overlay — SILENT DEGRADATION → no entry; required-addition candidate `alignment-cost` WARNING | Close-or-accept at Stage 2 lock |

Type-level limits: TS cannot express numeric range invariants (ascending order, disjointness) — those are runtime scans; it CAN force single-sourcing of the token array (P8) and the ok/error silence distinction (P5).

### Contract 2 → 3 (Stage 2 → Stage 3: survivors with token index spans → placement)

| # | Producer guarantees (Stage 2) | Enforcement | Failure mode if violated | Phase |
|---|---|---|---|---|
| P1 | The return type carries NO fields measured in seconds — token indices, match counts, provenance enums only (K5's precise scoping; `audioRegion`/`recoveredRegion` do not survive) | **Type-level — the model contract.** Re-adding boundary logic to Stage 2 cannot compile | The 5/6 interleave / duplicated gap-fill — made unrepresentable | Phase 4 |
| P2 | Every survivor has `matched === true` and valid `firstTokenIdx ≤ lastTokenIdx` into Stage 1's token array | Runtime-checked (cheap assert; TS cannot type index validity or non-negativity) | Wrong boundary (reads a wrong token's timestamps) | Phase 4 |
| P3 | Survivors preserve original script order | By construction (single-pass partition) + runtime assert (retires old R13) | Every-pair monotonic fallback → timeline collapses to floors — SILENT DEGRADATION → after Phase 7, surfaced by `duration-floored`/`monotonic-clamp` entries; the assert makes it loud earlier | Phase 4 |
| P4 | Skipped segments are dropped entirely; 5 covered + 3 uncovered commits 5 (product behaviour) | Manually-verified + change-detector test | Product behaviour change | Carried |
| P5 | The coverage gate ran; a below-gate project aborted before Stage 3 | Runtime (gate, exists) | Clean abort | Carried (moves to end of Stage 2) |
| P6 | Real matchedWords/confidence are reported even for non-survivors (coverage summary + skip entries read them) | Runtime (carried) | Misleading skip diagnostics | Carried |

| # | Consumer assumptions (Stage 3) | Enforcement | Failure mode | Phase |
|---|---|---|---|---|
| A1 | Survivors may be non-adjacent in the original array; the gap between them is real | Manually-verified (stated Stage 3 precondition) | The original middle-gap drift class | Phase 4 |
| A2 | Tokens/silences come from the same Stage 1 output object the indices point into | Type-level (P8 of Contract 1→2) | Old R7 — made unrepresentable | Phase 4 |
| A3 | Survivor spans may abut or invert (smeared/rescued edges) — the fence's third clause handles inversion explicitly and logs it | Runtime + log | SILENT DEGRADATION if unlogged → surfaced by `degenerate-boundary` entry (**REQUIRED ADDITION**, Phase 7) | Phases 5/7 |
| A4 | Locks are decided here and only here (single lock-handling site; the lock-toggle UI reuses this same function — K4) | Manually-verified at Stage 3 lock (TS cannot prevent a second lock check elsewhere) | Divergent lock behaviour (today's five-site risk) | Phase 4 |

Type-level limits: P1 is fully type-enforceable and is the contract's backbone; index validity (P2), ordering (P3), and single-site lock handling (A4) are not expressible in TS — runtime asserts + owner inspection.

### Contract 3 → 4 (Stage 3 → Stage 4: boundaries + derived timeline → finalization)

| # | Producer guarantees (Stage 3) | Enforcement | Failure mode if violated | Phase |
|---|---|---|---|---|
| P1 | One cut per adjacent survivor pair, and every cut lies inside its pair's token gap `[end(A.last), start(B.first)]` — or the pair is flagged degenerate | Runtime-checked (the fence rule IS the check) + log | Word theft — made structurally impossible for non-degenerate pairs | Phase 5 |
| P2 | Contiguity: `duration[i] := boundary[i+1] − boundary[i]` | **Construction-level (arithmetic)** — strongest enforcement in the plan; no post-hoc `if` | Cannot occur | Phase 4 |
| P3 | Boundaries are monotonically non-decreasing (backstop clamp lives here, moved from `applyAnchorBasedTiming` — syncEngine.ts:215-223 at HEAD) | Runtime-checked; every clamp reported to Stage 4 | SILENT DEGRADATION → surfaced by `monotonic-clamp` entry (**REQUIRED ADDITION** — today DEV-console-only, old R9) | Phases 4/7 |
| P4 | Locked segments' startTime/duration are unchanged; every lock-forced adjustment is reported | Runtime-checked in the single lock site | SILENT DEGRADATION → surfaced by `lock-preserved-adjustment` INFO (**REQUIRED ADDITION**) | Phases 4/7 |
| P5 | The no-voiceover path emits the same output shape, flagged estimated (`anchorSource: 'estimate'`) | Type-level (same return type) + provenance field | SILENT DEGRADATION → surfaced by `estimated-timeline` entry (**REQUIRED ADDITION** — today the fabricated 5s/scene duration is fully silent) | Phases 4/7 |
| P6 | `anchorSource` provenance is set correctly and only ever demotes (`whisper`→`estimate`, never promoted) — Key Invariant (e), written today by `distributeSegmentTimes` (whisperService.ts:1662), which this stage absorbs | Runtime + change-detector test | Provenance lies; cache/realign decisions degrade | Phase 4 |
| P7 | Stage 3 performs NO clamping — floors are Stage 4's exclusive right | Manually-verified (code review at Stage 3 lock; not typeable) | A silent floor reappears (old R2's mechanism) | Phase 4 |

| # | Consumer assumptions (Stage 4) | Enforcement | Failure mode | Phase |
|---|---|---|---|---|
| A1 | Segment 1 may start after 0 and the last segment may end before audioDuration (head/tail extension is Stage 4's job) | Runtime (explicit steps) | Lead-in silence lost / short tail | Phase 4 |
| A2 | A duration below the floor signals a degenerate boundary upstream — floor it AND log it | Runtime + log | SILENT DEGRADATION → surfaced by `duration-floored` WARNING (**REQUIRED ADDITION** — today five silent sites, old R2) | Phase 7 |
| A3 | The validators receive everything needed to explain the run (drops, clamps, estimates, degenerates) | Type-level (Stage 3 output carries the incident list) | Unexplainable log | Phase 4 |

Type-level limits: contiguity is enforced by arithmetic (better than types); "no clamps in Stage 3" and "floors only in Stage 4" are code-review disciplines TS cannot express — they are what the stage lock's owner inspection is FOR.

### Contract OUT (Stage 4 → UI / preview / export / persistence)

| # | Producer guarantees (Stage 4) | Enforcement | Failure mode if violated | Phase |
|---|---|---|---|---|
| P1 | Committed segments are contiguous, monotonic, floored, 3-decimal-rounded; Σ content durations = audioDuration (Key Invariant (b)); first starts at 0; last ends at audioDuration | Construction (P2 above) + runtime final validation | Timeline overlap/gap — surfaced by a final-validation ERROR entry (`finalization-invariant` — **REQUIRED ADDITION**; "should be impossible" = a real regression when it fires) | Phases 4/7 |
| P2 | Log entries commit atomically WITH the segments they describe (one state update) | Runtime (single `setProject`, carried) | Log describes a state that never existed | Carried |
| P3 | Every clamp, fallback, estimate, and degenerate boundary in the run has a log entry with severity + fix hint — NO silent degradation survives Stage 4 | Runtime + the rubric gate (Phase 7) | The §0 incident class (user discovers a broken timeline the log never mentioned) | Phase 7 |
| P4 | Headings are untouched by sync (separate overlay layer, Key Invariant (c)) | Manually-verified per stage lock | Heading drift | Carried |
| P5 | Persistence shape is unchanged (`transcriptTokens`, `lastTranscribedFileIdentity`, segments) — internal stage types are never persisted | Manually-verified at Phase 4 | Reload breaks / forced re-transcription | Phase 4 |
| P6 | Staging-time (non-Apply-Sync) findings also reach the log with their own run id | Runtime (carried — old R11's fix) | Console-only staging failures | Carried |

**Severity taxonomy (absorbed from `docs/sync-pipeline-contract-plan.md` §4 — this contract owns it now):**

| Severity | Meaning | User action | Panel treatment |
|---|---|---|---|
| **INFO** | The pipeline did something worth recording. Output is correct. | None. | Collapsed by default; grey. |
| **WARNING** | Output usable but measurably degraded from a clean run. | Optional — something the user can change to improve it. | Always visible; amber; **carries a fix hint**. |
| **ERROR** | Output is wrong, or a stage failed outright and continued on a fallback. | Required — don't trust the result as-is. | Always visible, expanded; red; **carries a fix hint**. |

**The rule:** every WARNING and every ERROR carries a plain-language, user-facing fix hint — something the USER can do ("re-export the voiceover as WAV"), never developer vocabulary ("check snapBoundaries.ts:699" belongs in `detail`). No console-only failure survives Stage 4; a DEV-gated console line is acceptable in addition to a log entry, never instead of one.

**Reader rubric (Phase 7's gate — replaces the unfalsifiable "confirm you understand every entry"):** a reader who has not worked on the pipeline reads one full log (≥1 WARNING, ≥1 ERROR) with no console/debugger/source and must correctly answer: (1) what did the run do (committed vs skipped counts), (2) did anything go wrong (separates INFO from WARNING/ERROR), (3) what happened, per WARNING/ERROR, in their own words, (4) what should they do (from the hint), (5) which part of THEIR project is affected (segment/time/asset — not a file or function), (6) zero unglossed internal vocabulary in any message or hint. PASS = all six.

| # | Consumer assumptions (Timeline / preview / export / persistence) | Enforcement | Failure mode | Phase |
|---|---|---|---|---|
| A1 | Contiguity holds, so absolute positioning cannot overlap | Upstream construction (Contract 3→4 P2) — including the no-token retile path once it is Stage 3's explicit mode (closes the old retile gap) | Overlapping cards | Phase 4 |
| A2 | Segments arrive in ascending startTime order | Upstream (Contract 2→3 P3 + monotonic P3) | Broken markers/lanes | Phase 4 |
| A3 | Every `SyncLogEntryType` has a badge | Type-level (`Record<SyncLogEntryType, …>`, carried) | Compile error, not an unstyled badge | Carried |
| A4 | Every meaningful failure produced a log entry | P3 above — currently FALSE; becomes true when the gap list empties | The §0 class | Phase 7 |

**REQUIRED ADDITIONS — Stage 4 log entries that do not exist today.** Every silent-degradation row above resolves to one of these; building them is Phase 7's concrete work list:

| Entry (proposed rule id) | Surfaces | Today | Severity |
|---|---|---|---|
| `duration-floored` | Any duration clamped to the floor (one rule, per-site detail) | 5 silent sites (old R2) | WARNING |
| `monotonic-clamp` | A boundary clamped to preserve monotonicity | DEV console only (old R9) | WARNING |
| `degenerate-boundary` | Zero/inverted gap cut at edge-midpoint (fence clause 3) | DEV console only | WARNING |
| `estimated-timeline` | No-voiceover character-weight timeline; fabricated total duration | Fully silent | INFO (prominent) |
| `clip-speed-compressed` | A video asset slowed/compressed to fill its slot | Fully silent | INFO |
| `ambiguous-tag` / `duplicate-asset` | Intake resolution surprises (Contract IN A4) | console.warn only | WARNING |
| `stale-alignment-discarded` | A finished alignment thrown away because segments changed (old R14) | console.warn only | WARNING |
| `zero-token-transcription` | Transcription exited 0 with zero tokens | Transient banner only | WARNING |
| `unsupported-language` | Detected/set language outside the supported five (H.4) | Does not exist | ERROR + banner |
| `silence-scan-anomaly` | Non-ascending/overlapping silence intervals (Contract 1→2 P4) | Does not exist | WARNING |
| `finalization-invariant` | Final validation caught an impossible state | Does not exist | ERROR |
| `lock-preserved-adjustment` | A boundary moved to respect a lock | Silent | INFO |

### R1–R14 mapping (the old risk register onto the new contracts)

The register itself lives in `docs/sync-pipeline-contract-plan.md` §5 and is not restated. Disposition under the 4-stage restructure:

**Made structurally impossible by the restructure:** the contiguity break (Contract 3→4 P2 — arithmetic, not a maintained property; this also closes R3's contract half including the retile path), the 5/6 interleave and two-snap-path drift (Phase 1 deletes the duplicate; Contract 2→3 P1's timing-free type prevents recurrence), R7 (same-filtered-array coupling — Contract 1→2 P8's single output object), and R8 (silence-identity Map keys — the fence has no contention assignment; the Map is deleted at Phase 5).

| Risk | New home | Disposition |
|---|---|---|
| R1 (drop clustering) | Contract 1→2 P3 | Survives, instrumented; **recalibrate at Phase 2a** (new model, new drop profile) |
| R2 (silent floors) | Contract 3→4 A2 / OUT `duration-floored` | Structurally consolidated (one clamp site) + logged at Phase 7 |
| R3 (presentation) | Contract OUT A1/A2 | Test-debt half closed pre-v2 (`7e6309f`); contract half structurally impossible (above) |
| R4 (two MIN_SEGMENT_DURATION constants) | Contract 3→4 | Resolved by Phase 4's rename (rename, not merge) |
| R5 (token ordering) | Contract 1→2 P2 | Already enforced; carried as a producer guarantee |
| R6 (vacuous forward bound on a zero-match tail) | Contract 2→3 | **Survives — still needs work**; close or accept in writing at Stage 2 lock |
| R7 (filtered-array coupling) | Contract 1→2 P8 | Structurally impossible at Phase 4 |
| R8 (silence identity) | — | Structurally impossible at Phase 5 |
| R9 (DEV-gated degenerate/clamp warnings) | Contract OUT | Closed by Phase 7 (`monotonic-clamp`, `degenerate-boundary`) |
| R10 (run-survival calibration) | Contract 2→3 | **Survives — worse under v2**: thresholds were calibrated on base.en English output; Phase 2a's model swap and eventual non-English input both invalidate the calibration story. Recheck at 2a; close-or-accept at Stage 2 lock |
| R11 (staging-path logging) | Contract OUT P6 | Resolved pre-v2; carried |
| R12 (DP cost bound) | Contract 1→2 A4 | **Survives**; close-or-accept at Stage 2 lock |
| R13 (kept ordering) | Contract 2→3 P3 | Closed by construction + assert at Phase 4 |
| R14 (stale-alignment discard) | Contract OUT `stale-alignment-discarded` | **Survives**; closed at Phase 7 |

Part K — Revisions From Adversarial Audit (2026-08-03)

Each break found during the Revision 2 self-audit, its fix, and whether the fix moved a stage boundary, a contract, or a phase order. Nothing here silently rewrote the architecture; every structural consequence is stated.

**K1 — Old Phase 8 deferred Stage 1 defects past Stage 1's lock.** Break: stage locking (Part D) forbids locking a stage with known in-stage defects deferred downstream, but old Phase 8 held three Stage 1 items — the hyphen asymmetry (normalization), language-keyed normalization (H.5), and adaptive silence thresholds (silence detection) — scheduled after Stages 2-4 work. Stage 1 could never have locked. Fix: all three move into Stage 1's phase group as Phases 3b/3c/3d; old Phase 8's remaining item (pairIdx-20) moves to Stage 3 as Phase 6b; R5/N4 stays deferred as a written Contract IN acceptance. **Changes phase order** (Phase 8 dissolved). Side benefit: every index-shifting event (2a, 3, 3c) now completes before Stage 1 locks, so Stages 2-4 verify against a stable token space.

**K2 — The inspector was needed before the phases it serves.** Break: Task-4's inspector must compare current-model vs turbo vs turbo+DTW runs, but no phase slot existed before 2a/2b for it. Fix: new Phase 1b, before 2a, blocking for Stage 1's lock. **Changes phase order** (new phase inserted).

**K3 — H.8's non-English corpus does not exist.** Break: H.8 requires a Spanish-or-French project before Phase 2a ships; the D.0 inventory shows the corpus is 100% English — Spanish, French, Portuguese, and German are all absent. Phase 2a (and Stage 1's lock) were gated on evidence that cannot currently be produced. Fix: stated as an explicit owner deliverable blocking Phase 2a (D.0, H.8, Phase 2a's entry); Phase 3b additionally allows non-verifiable languages' rules to land dormant with a written acceptance and reopening trigger. **No boundary change** — a lock-gate prerequisite made explicit.

**K4 — `applyAnchorBasedTiming` has a consumer outside the sync pipeline.** Break: the plan said distributeSegmentTimes and applyAnchorBasedTiming "no longer live here" and collapse into Stage 3 — but `App.tsx:1686` (`handleToggleLock`) calls `applyAnchorBasedTiming` on every lock toggle, entirely outside Apply Sync. A naive collapse breaks lock toggling. Fix: Phase 4 must keep Stage 3's placement callable as a pure function and re-wire the lock-toggle handler to it (Part D Phase 4; Contract 2→3 A4). **Changes a contract statement** (single-timing-authority now explicitly includes the UI's lock-toggle re-derivation); no stage-boundary or order change.

**K5 — "No time fields at all" was imprecise and collided with real consumers.** Break: today's `AlignResult` carries `audioRegion` and `recoveredVia`/`recoveredRegion` — time-valued provenance consumed by `buildRescueLogEntries` (App.tsx:2440-2445) to render the 'rescue' log entry's time range. A literal "no time fields" type deletes data an existing user-facing entry displays. Fix: the rule is restated precisely (Part B, Contract 2→3 P1): Stage 2's type carries token indices, counts, and provenance ENUMS — zero fields measured in seconds; Stage 4 derives the rescue entry's displayed range from token indices, where tokens are in scope. **Changes a contract statement** (2→3 P1's precise scoping); the architecture is unchanged.

**K6 — The full consumer trace for Stage 2's timing-free type (required by this audit; verified at HEAD `53ff455`).** Every current reader of `AlignResult.t0/.t1` and both timing functions, with where each behaviour lands:

| Consumer at HEAD | file:line | What breaks / where it lands |
|---|---|---|
| `distributeSegmentTimes` — reads `a.t0/a.t1`, writes `startTime`/`duration`/`anchorStart` and `anchorSource: 'whisper'`, skips locked segments; bare `Math.max(0.1, …)` floor | `whisperService.ts:1648-1665` (floor at `:1656`, provenance at `:1661-1662`) | Function deleted at Phase 4. Lock skip → Stage 3's single lock site; `anchorSource: 'whisper'` → Stage 3 (Contract 3→4 P6); the 0.1 floor → Stage 4's logged floor (`duration-floored`) |
| `applyAnchorBasedTiming` (⑥ᴬ call after distribute) | `useWhisper.ts:112` (import `:11`) | Dies with the Stage 3 collapse; its backstop monotonic clamp (`syncEngine.ts:215-223`) moves to Stage 3 (Contract 3→4 P3); its estimate-default write (`syncEngine.ts:188`) moves with the character-weight mode |
| `applyAnchorBasedTiming` (Branch A pre-align; Branch B no-cache fallback) | `App.tsx:2387`, `App.tsx:2549` | 2387: estimate anchors feeding Stage 2's rescue windows — stays as Stage 1/parse output (Contract 1→2 A3). 2549: becomes Stage 3's character-weight mode + `estimated-timeline` entry |
| `applyAnchorBasedTiming` (lock-toggle UI handler — OUTSIDE sync) | `App.tsx:1686` | K4 above — Stage 3's placement stays callable |
| `distributeSegmentTimes` (staging path, called with `segments: []`) | `useWhisper.ts:286` | Statically dead for timing (audit §B.4); deleted at Phase 4 |
| Unmatched-segment default `t0 === t1 === prevAnchor` | `whisperService.ts:925` | Dies with the type — unmatched segments carry no time; the partition drops them before Stage 3 |
| Step-2 override `t1 := next.t0` + the gap-fill's own reads/writes | `whisperService.ts:1372`, `:1421-1428`, `:1522`, `:1529-1530`, `:1535` | All deleted at Phase 1 (the duplicated gap-fill) |
| Coverage gate inputs (`computeCoverageSummary` via `App.tsx:711/2401`) and syncContracts validators (`validateWordCoverage` reads `matchedWords/totalWords`; `validateBoundaryQuality` reads `firstTokenIdx/lastTokenIdx`) | `App.tsx:711`, `syncContracts.ts` | Read no t0/t1 — unaffected by the type change; coverage gate moves to end of Stage 2 unchanged |
| ~29+ test call sites exercising t0/t1 | `syncTiming.test.ts` | Change-detector updates at Phases 1/4 (their permitted role, Part F) |

**No boundary change** — this trace confirms the collapse is complete as specified once K4/K5 are honoured.

**K7 — Phase 7's gate was unfalsifiable.** Break: "resync, read the log panel, confirm you can understand every entry" cannot be decided pass/fail by inspection. Fix: replaced with the six-question reader rubric (absorbed into Contract OUT from the contract-plan's §6.3(c3)); any FAIL names the entry to rewrite. **Changes a phase gate**, not order.

**K8 — Phase 2b required a tool that does not exist and was lost once before.** Break: the word-onset-error measurement harness was never committed (`docs/audit-verification-2026-08-03.md` §C.7 — the original lived in `/tmp` and is unrecoverable), yet Phase 2b's decision gate depends on re-running it. Fix: Phase 2b's deliverable now includes the committed measurement script; the in-app half of the measurement is Phase 1b's inspector. **No order change** — a required deliverable added.

**K9 — Two-plus phases shift indices; the plan never said which baselines die when.** Break: Phase 2a (new model → entirely new token array AND new transcript text), Phase 3 (fewer timestamp-based malformed drops → index shift), and Phase 3c (normalization corpus change → alignment shift) each invalidate index- and transcript-keyed references; the plan said "content-keyed" without stating the schedule or the re-establishment procedure — and transcript-side content keys break at 2a too. Fix: (a) verification keys are SCRIPT-side words (Task 5c, Phase 0); (b) baseline re-establishment procedure stated at each shifting phase: fresh resync → inspector CSV → full forty listen → new rows appended to `verification-baseline.csv` (old rows retained; git history is the archive); (c) frozen transcripts are per-model-era — base.en era for Phases 1-2a, turbo era after — and cross-era comparisons are word-keyed only. **Changes contract/procedure statements**, no order change (K1 already consolidated the shifts into Stage 1).

**K10 — Rollback honesty.** Break: "any phase reverts alone" is true of code but not of evidence: reverting Phase 2a or 3 invalidates every baseline row established after them, and once Phase 5 lands, reverting Phase 4 requires reverting 5 (and 6) first — stacked structural commits unwind top-down only. Phase 4 is the single largest commit and the highest-rollback-cost point. Fix: stated here and in Part E's rollback row; mitigations: Phase 4's byte-identical gate on both corpus projects before anything stacks on it, and `verification-baseline.csv`'s append-only history making baseline rollback a git operation. **No change to boundaries or order** — the claim is corrected, not the structure.

**K11 — Regression classes the plan did not protect.** Break: locks, skipped-segment-adjacent boundaries, headings, the no-voiceover path, silence-scan failure, the empty-token retile fallback, export/preview consumers, persistence/reload, and the DEV harnesses (`__calibrateBoundaryQuality`, `__ALIGN_INSTRUMENT__`) appear nowhere in any phase gate — and the forty-boundary verification set contains no locked-segment or skip-adjacent case at all. Fix: the cross-cutting regression checklist (D.-1) runs at every stage lock; the verification set gains one locked-segment and one skip-adjacent boundary (Phase 0); Phase 4 explicitly updates-or-retires the DEV harnesses in the same commit. **Changes Phase 0's set composition and every lock gate**; no order change.

**K12 — Claims that were stated as facts.** Break: several load-bearing numbers were model-recall or single-observation claims presented without flags. Fix: marked UNVERIFIED in place — the “~60% deletable” estimate and the “~190ms → ~80ms” DTW estimate (Part C), the “word + gap ≈ 0.4s” speech-rate figure (Part A), the 24-July-build parity observation (Part A, USER-REPORTED), H.9's three model-size figures (Task 6c), and H.3's MMS mechanics (verify against MMS-FA docs before implementation). whisper-cli determinism remains an open question that Phase 0 answers by measurement. **No structural change** — epistemic labels only.

**Found sound (attacked, no revision needed):** the Phase 3-before-Phase 5 ordering (segment 96's fixture numbers hold at §D.12/§D.13); Phase 1's redundancy claim (audit §B.4's trace confirmed the gap-fill's output is overwritten on every real path, including the first-segment, locked, and empty-token cases); the coverage-partition move to Stage 2's end; keeping the two duration-floor constants separate (rename, not merge); and the decision to keep `isBreathSilence` through Phase 5 into its own deprecation phase rather than deleting it with the picker.

---

> Bug & task tracking lives in `project-state.md`. `docs/sync-pipeline-contract-plan.md` remains the authority on the OLD pipeline's assumption tables and the R1-R14 register text; Part J owns their v2 mapping. `docs/verification-baseline.csv` (created at Phase 0) is the programme's verdict record.
