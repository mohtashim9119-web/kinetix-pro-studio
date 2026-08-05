Status: Accepted architecture — pending implementation
Date: 2026-08-03 (Revision 2, same day — stage contracts, stage locking, Stage 1 observability, Russian descope, adversarial audit; see Part K)
Verified-against-HEAD: 124ad3dd34a580cbfc0fb34b34d5c058338296d2
Live status: see `project-state.md`'s Active Tasks for current phase progress.

## Phase Status

Phases are grouped under the stage they build (Part D). A stage's phases may not begin until every earlier stage is LOCKED, with two stated exemptions (Part D's ordering rule): proven behaviour-neutral deletions/moves, and read-only measurement.

| Phase | Stage | Description | Status | Verified by | Date |
|---|---|---|---|---|---|
| 0 | Programme | Safety and instruments (corpus verification, determinism check, script-word-keyed verification set, baseline CSV) | DONE | Owner | 2026-08-04 |
| 1 | Stage 2 (neutrality-exempt; runs first) | Delete the duplicated gap-fill in `alignScenestoTranscript` | DONE | Owner | 2026-08-04 |
| 1b | Stage 1 | Transcript Inspector — dev-only, in-app; BLOCKING Stage 1 deliverable | DONE | Owner inspection — `window.__transcriptInspector()` run in-app on V6 (447-seg) and 173-seg, output captured to `docs/v6-smear-baseline.csv` / `docs/173-smear-baseline.csv` | 2026-08-04 |
| 2a | Stage 1 | Model swap — multilingual model, `-l auto`, per-project language override | **DONE** — gate passed: Phase 0 30/47 → phase-2a 38/44 verified (correct 38, word-shifted 5, FAIL 1; 2 N/A + 1 unverified named, not counted against the gate) | Owner ear-listening pass, `verification-baseline.csv` | 2026-08-05 |
| 2b | Stage 1 | Measure timing sources on the production model (turbo raw / turbo+DTW / large-v3 reference) — committed script | **DONE** — **DTW ABANDONED**: measured to change timestamps by exactly 0.000000000s vs a no-DTW control, on 4,579 + 2,080 tokens. Phase 3 = forced alignment. Script committed at `scripts/measure-word-onset.py` | Measurement (read-only; no owner listening required by this phase's own terms) | 2026-08-05 |
| 3 | Stage 1 | Upgrade the timing source — **forced alignment** (decided by 2b; DTW eliminated) | **Blockers 1/3 CLOSED, Blocker 2 MEASURED — gate verdict PENDING OWNER DECISION**; integration not started | Measurement (`scripts/measure-forced-alignment.py`); ratio analysis vs. Part L | 2026-08-05 |
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
> **MEASURED AND FALSIFIED — Phase 2b, 2026-08-05.** Two claims in the paragraph above are now known to be wrong, and one is confirmed:
> - **CONFIRMED:** `--dtw base.en` was indeed a silent no-op — whisper-cli's own stderr says so verbatim (`dtw_token_timestamps is not supported with flash_attn - disabling`).
> - **FALSIFIED — the “~190ms → ~80ms” estimate.** DTW, correctly enabled with `-nfa --dtw large.v3.turbo` (stderr `dtw = 1`), changes the timestamps by **exactly 0.000000000s** against a no-DTW control, over all 4,579 V6 and 2,080 173 tokens. It does not improve them by any amount.
> - **FALSIFIED — “`-nfa` broke stdout printing.”** `-nfa` without `-oj` produced 4,639 well-formed bracketed stdout lines → 4,579 tokens, parsed by the same logic `whisper.rs` uses. The stdout path is intact under `-nfa` on the currently bundled binary.
>
> The reason DTW cannot help is structural and is documented in Phase 2b's Finding 2: under `-ml 1` whisper emits **gapless** token spans (97.8% of V6 transitions), so a pause is necessarily absorbed into the following word's declared span — DTW refines alignment *within* that emission and never gets to dispute it. See Phase 2b's RESULTS section.
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

**Language coverage:** originally every project in the corpus was English; of the supported set (Part H.0: English, Spanish, French, Portuguese, German), all four non-English languages were missing. **Partially resolved 2026-08-04** — a `Spanish Project` (27 scene-doc segments) now exists and was transcribed cleanly on turbo (Phase 2a Step 5), satisfying H.8's minimum ("at least one Spanish-or-French project"). **French, Portuguese, and German remain completely absent** — no owner deliverable yet scheduled to acquire them (H.8's dormant-rules allowance covers this gap for Phase 3b, accepted in writing at Phase 2a's Stage 1 lock-gate entry). Spanish's own BOUNDARY correctness is still unverified — see Phase 2a's Step 5 entry.

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

**Record the baseline.** Listen to all forty on the current build and record a verdict for each — correct, word-shifted, or clipped — in **`docs/verification-baseline.csv`, tracked in git** (columns: script-word key, project, case_type, verdict, phase label, date). This is the baseline every later phase is measured against. It is the only trustworthy number this project will have. Superseded rows are never deleted — a new phase appends new rows with its phase label, so the history of every boundary’s verdict across the programme stays diffable in git.

**Results (closed 2026-08-04, verified by owner).**

- **Determinism: PASS.** The bundled whisper-cli sidecar invoked twice from a terminal, outside the app, against the same transcoded 16kHz mono WAV, identical args both runs. Re-runnable exactly as follows:
  ```bash
  # 1. Transcode the source audio to 16kHz mono WAV (same flags transcode_to_wav uses, whisper.rs:115-133)
  ffmpeg -hide_banner -y -i voiceover.m4a -ar 16000 -ac 1 input_16k.wav

  # 2. Run whisper-cli twice, identical args both times (whisper.rs:244-250; model_path resolves to
  #    src-tauri/binaries models/ggml-base.en.bin at HEAD)
  ./whisper-cli -m models/ggml-base.en.bin -f input_16k.wav -ml 1 -np -l en --dtw base.en > run1.txt
  ./whisper-cli -m models/ggml-base.en.bin -f input_16k.wav -ml 1 -np -l en --dtw base.en > run2.txt

  # 3. Diff
  diff run1.txt run2.txt   # PASS = empty
  md5 run1.txt run2.txt    # PASS = identical hash
  ```
  Both runs produced 4571 lines and MD5 `6321bb32a0a3e0aec34d5c191a94c168`, zero diff. **This result is model-specific to `base.en`** — it says nothing about turbo/large-v3 determinism and **MUST be re-run at Phase 2a** once the model swap lands.
- **Backups: counts confirmed** — 173-seg (173 segments / 1973 transcript tokens), V6 (447 segments / 4517 transcript tokens), matching `docs/boundary-drift-investigation.md`. `lastTranscribedFileIdentity` was missing from both JSON backups (restoring either would have triggered re-transcription and destroyed the frozen transcript); patched with the owner-extracted live values — `VO2.m4a|17151452|1784183884000` (173-seg) and `6.m4a|32851696|1785461360000` (V6) — and written alongside the originals as `project.backup2.json` / `project (1).backup2.json` in `All Projects Test Data/Projects Backend Data/`. The 173 project's audio is named `VO2.m4a` in-app while the corpus file is `voiceover.m4a` on disk — expected, since identity is `name|size|lastModified` as staged, not the corpus filename; not "corrected."
- **Audio blobs: PASS** — both projects' voiceover blobs confirmed present in IndexedDB (`kinetix-assets`, store `assets-v2`), owner-verified in-app.
- **Restore test: PASS** — a restored project loaded in 3-4s (waveforms rendering in 1-2s) with no re-transcription triggered (cache-valid on `lastTranscribedFileIdentity` match).
- **Interior skip: PASS** — a manufactured un-spoken mid-document paragraph was skipped cleanly with correct boundaries on both sides; the scene doc was restored afterward, leaving no permanent change to either corpus project. The corpus's only NATURAL skip is at position 1 (leading) — the interior case, which is the middle-gap drift class this program most needs to protect, is covered only by manufacture and must be **re-manufactured at each later stage lock**, not assumed present in the corpus.
- **Controls: 20/20 listened. 18 correct.** The 2 repaired keys ("lead hunter slows || every person slows", "wind || small animals" — see `case_type` breakdown in `verification-baseline.csv`) are word-shifted, not correct; see **Part L**, added at closure below, for the cascade mechanism found on re-listen.
- **Locked segment: FAIL** — see `project-state.md`'s Deferred Known Bugs and this document's **K13** for the full defect and mechanism. The locked-segment row's verdict in `verification-baseline.csv` was updated from its prior placeholder to this real FAIL.

**Phase 0 status: DONE, verified by owner, 2026-08-04.**

### Phase 1 — Delete the duplicated gap-fill (expected: zero behaviour change; neutrality-exempt from stage ordering)
The audit established that alignScenestoTranscript’s internal gap-fill is operationally redundant: snapCoveredBoundaries recomputes every boundary from token indices afterwards, nothing downstream ever reads t0/t1 again, the first segment’s start was never written by it anyway, locked segments were always excluded from it, and on the empty-token fallback path it early-returns before reaching the gap-fill at all.
Delete it. Delete the tests that exercise it — they test a function proven not to affect output, and keeping them would block the deletion for no reason. **Correction (recorded at closure):** this entry originally estimated 29 tests would be deleted; that number was a pre-deletion audit estimate, not a verified count. 14 were actually deleted. The estimate was wrong; the deletion itself was not.
I’m reversing my earlier position on sequencing here. I previously argued for behavioural fixes before structural ones to preserve bisectability. The audit changed that: this deletion **[UNVERIFIED — halves the code surface of the rewrite]** and it is provably behaviour-neutral. Doing it first is strictly cheaper. The "halves the code surface" claim is marked unverified pending a line-count check (165 lines removed from `whisperService.ts`) — verify by line count at Phase 4 or drop the claim.
Your verification: resync both projects with the frozen transcripts. Every segment’s start and duration should be byte-identical to the Phase 0 baseline. If anything moves, stop — the redundancy claim was wrong and we need to understand why before proceeding.

**Results (closed 2026-08-04, verified by owner).**
- **Code-level byte-identical harness: PASS** on both corpus projects, run against the frozen transcripts with silences held constant. Honest limitation stated: this is a code-level reproduction of the cached-token Apply Sync path, not an in-app A/B across the commit boundary.
- **Owner manual verification, all PASS:** in-app resync of the 173 project produced no console errors; the 5 verification-set boundaries spot-checked matched their Phase 0 verdicts; the sync log panel still populates; a no-voiceover project still produces a timeline; reload persists with no re-transcription.
- **Reinforcing argument:** because `locked` is structurally always `undefined` at snap time (K13), `snapCoveredBoundaries` recomputes EVERY boundary on every run, so the deleted gap-fill's output could not have survived to the timeline under any input. The byte-identical result is exactly what that predicts.

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

---

#### THRESHOLDS FINALIZED BY PHASE 2B (2026-08-05) — no longer provisional

Phase 2b's measurement is attached in its own entry below (and as `docs/phase2b-onset-*.csv`). The three provisional thresholds are **retained in value but re-scoped, re-prioritized, and joined by a fourth**. Each change is justified by a specific measured result rather than by preference.

**FIRST — a metric-comparability warning that must not be skipped.** Phase 1b's inspector "smear" and Phase 2b's "word-onset error" are **not the same metric and their numbers must never be compared directly.** The inspector scores EVERY token against its *nearest preceding* silence (which, for a token deep inside a pause-free run, can be many seconds back — this entry's own caveat above says so). Phase 2b scores only the word FOLLOWING each detected pause, which is exactly where a boundary decision gets made. Hence V6 turbo reads 33.6% negative smear under the inspector and 97.4% under Phase 2b — **both correct, different denominators.** The finalized thresholds below are stated in **Phase 2b's metric**, because that is the decision-relevant one; a future session applying them via the inspector will get wrong answers.

| # | Threshold | Value | Status | Why |
|---|---|---|---|---|
| 1 | Median absolute word-onset error | **≤ 100ms** | **KEPT, but demoted from primary** | It does discriminate (V6 fails at 500ms; 173 passes at 80ms) — but 173 PASSES this gate while still carrying real, ear-verified boundary defects (pairIdx-20; "They're the worst"). A gate that certifies a project known to be broken cannot be the primary gate. |
| 2 | p95 absolute word-onset error | **≤ 250ms** | **KEPT, PROMOTED to primary** | This is the binding constraint and the one that correctly refuses 173 (measured 0.497s — 2× over, while its median passes 5× under). **The brief's hypothesis that "the tail matters more than the median" is CONFIRMED**: boundary placement is destroyed by individual large errors, not by average ones. One 1.3s error annihilates a sub-second segment (Part L's governing ratio); a good median cannot compensate. |
| 3 | Negative-smear fraction | **< 1%** | **KEPT, re-scoped as a source-replacement test** | Measured 97.4% (V6) / 68.0% (173) — failing by 68–97×, not by a tunable margin. Phase 2b's mechanism finding explains why this can never be met by refining Whisper timestamps: under `-ml 1` tokens are 93–98% gapless, so a pause is *necessarily* absorbed into the following word's span. **This threshold is therefore not a tuning target — it is the test that distinguishes "Whisper timestamps, refined" from "timestamps replaced."** Only a non-gapless source can pass it. Keeping it at <1% is what forces Phase 3 to be forced alignment rather than a cheaper patch. |
| 4 | **Zero-duration real-word tokens** | **0** | **NEW — added by Phase 2b** | Measured 68 (V6) / 44 (173) under the shipped config. Each is a real spoken word emitted with `start == end`, silently discarded by `filterMalformedTokens`'s `t0 >= t1` branch (`whisperService.ts:1315`) before alignment. **None of the three original thresholds detects these at all** — a deleted word contributes no onset error to any percentile. This is the exact mechanism behind 173's segment-112 failure (Finding 4). A timing source that emits even one such token is silently deleting words from the alignment corpus, so the bar is zero, not a fraction. |

**How the gate is evaluated from here on:** all four must hold, on both a tight-pause and a long-pause project, measured with `scripts/measure-word-onset.py`. Threshold 2 (p95) is the primary read; threshold 3 is the structural test that the timing source is of the right *kind*; threshold 4 is a hard zero.

**Provenance correction, recorded 2026-08-05 (Phase 3, Blocker 2), so a future reader does not over-trust this threshold's pedigree:** the 250ms p95 figure was NOT calibrated against a measured negative-smear distribution — it was Phase 1b's own provisional judgment call, made before Phase 2b's measurement existed, and Phase 2b then promoted it from provisional to primary without independently deriving the 250ms value itself (only the *rank* — "tail matters more than median" — was validated by measurement). Phase 3's own ratio analysis (Part D's Phase 3 entry, Blocker 2) found MMS-FA failing this exact threshold on V6 (476ms measured p95) while its ratio-severity analysis showed zero unexplained failures above severity ratio 0.5 and none resembling a real cascade defect. Whether that evidence should revise this threshold, or whether 250ms should stand as written, is **left to the owner** — this document does not retune it unilaterally on a mechanism argument, per explicit instruction. See Phase 3's Blocker 2 entry for the full data.

**Current standing against the finalized gate (shipped config (a), turbo raw):**

| | V6 (long-pause) | 173 (tight-pause) | Gate |
|---|---|---|---|
| Median | 0.500s ✗ | 0.080s ✓ | ≤0.100s |
| **p95** | **1.283s ✗** | **0.497s ✗** | **≤0.250s** |
| Negative-smear | 97.4% ✗ | 68.0% ✗ | <1% |
| Zero-dur words | 68 ✗ | 44 ✗ | 0 |

**7 of 8 readings fail; the single pass (173's median) is precisely the reading demoted above for being non-discriminating.** Stage 1's smear blocker (item (a) on the lock list) is unchanged in substance and now has a sharper statement: it is not "smear is too high," it is **"the timing source is of the wrong kind — it emits gapless spans and deletes words."**

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

**Instrument validation (recorded at closure, 2026-08-04).** The inspector was validated against known ground truth: `docs/v6-smear-baseline.csv` row 807 reads `predator,289.260,289.800,0.540,0.000,289.960,-0.700`, reproducing the committed `c593f1d` seg-96 fixture (silence `[289.380, 289.960]`, token "predator" `[289.260, 289.800]`) exactly. This is the instrument's correctness check — it is what makes every other number the inspector produced trustworthy. Known limitation (already noted above, restated for emphasis): for a token whose nearest silence starts AFTER the token ends (e.g. "A" at 289.200-289.260, row 806, which matches an older silence at 287.860 and reports `+1.340`), the positive tail is inflated. This affects median/p95 but NOT the negative-smear count, which is the reading **Part L** depends on.

### Phase 2a — Model swap (supersedes old Phase 2 as written; see Part H)
Provision the multilingual model (H.1), re-enable `-l auto`, store detected language per project, make it user-overridable (H.7). No timing-source change. English projects re-verified against the Phase 0 baseline: boundaries WILL move (different model, different tokens); the gate is that the forty-boundary verdict does not get worse (count of correct verdicts in `verification-baseline.csv` ≥ the Phase 0 count).
**Blocked on corpus (K3):** H.8 requires at least one Spanish-or-French corpus project before this phase ships, and the D.0 inventory shows zero non-English projects exist. Acquiring one is an owner deliverable and a prerequisite of this phase. **Resolved 2026-08-04** — a `Spanish Project` folder (audio `Spanish VOiceover.m4a`, `Spanish Script.txt`, `Spanish Sync.txt`, plus an image asset zip) now exists in the corpus directory; confirmed present with all three required inputs.
This phase mints the second frozen-transcript era (turbo) for both corpus projects and re-establishes the baseline: fresh resync → inspector CSV → full forty listen → new rows in `verification-baseline.csv`.

**Implementation status (2026-08-04): CODE COMPLETE, owner verification (Step 5 below) NOT YET RUN.**

Prerequisites confirmed (Step 2): `ggml-large-v3-turbo.bin` was already provisioned in `src-tauri/models/` (owner download) and the Spanish corpus project is present (above). Model measured (H.9): 1,624,555,275 bytes on disk (~1.51 GiB), ~2.1-2.2 GiB peak/resident during inference — see H.9 for the full table and the resulting bundle-vs-download decision. Determinism re-verified on turbo with the exact Phase 0 command structure (only `-m` swapped): `diff` empty, MD5 identical across two runs (`6b7a53fffa540d32428997769bb1c962`), 106 lines each, against `14 Base Segs Project`'s 32.7s audio. A second determinism pair was ALSO run with `-l auto` (the actual shipped flag) as extra rigor beyond the literal instruction: also PASS, and byte-identical to the `-l en --dtw base.en` runs' output/MD5 on this English file — `-l auto` correctly auto-detected `en` at p=0.999905. **Both determinism results, and Phase 0's own, are specific to this one Intel x86_64 Mac with no GPU backend found (`whisper_backend_init_gpu: no GPU found` — BLAS/CPU fallback); not re-verified on arm64/Windows, same accepted gap as the rest of this document's WebCodecs verification.**

Decisions made and recorded (Step 3 — presented for owner acceptance, not unilaterally closed):
1. **Transcript-cache invalidation: NOT changed.** Verified directly against `App.tsx`/`syncEngine.ts` (not the CLAUDE.md citation): `getFileIdentity(file) = \`${file.name}|${file.size}|${file.lastModified}\`` (`syncEngine.ts:259`) carries no model identity, and the cache gate (`App.tsx:2137-2138`, `App.tsx:3270-3271`, `App.tsx:3275-3277`) is `lastTranscribedFileIdentity === incomingIdentity && transcriptTokens.length > 0` — also no model identity. Left unchanged deliberately: adding model identity to the key would invalidate EVERY existing project's cache the moment this code ships, silently triggering unbounded background re-transcription (turbo, at the measured ~1.6x-realtime-on-CPU-only rate, is not fast) with no user action and no warning — exactly the "must not silently auto-re-transcribe" risk this document flags. The existing mechanism already provides an explicit, owner-driven way to force re-transcription: delete the voiceover asset (clears `transcriptTokens`/`lastTranscribedAssetId`/`lastTranscribedFileIdentity` — `App.tsx`'s asset-delete handler, ~line 2991-2994) then re-stage the same file. Step 5 uses this for the two corpus projects.
2. **`--dtw base.en` flag: DROPPED, not carried forward under a new name.** It was already a silent no-op (flash attention on by default) and the preset name is model-specific (H.2) — carrying `base.en`'s name over to turbo would be actively wrong, and DTW itself is Phase 2b/3 work (`whisper.rs` no longer passes any `--dtw` flag).
3. **Language argument: `-l auto` when `Project.language` is unset, else the stored code directly (skips re-detection).** Matches H.1/H.7 exactly — detection only fills the gap once; an explicit or previously-detected value is sticky and always user-editable via Project Settings, never silently re-guessed on a later transcription of the same project.
4. **`unsupported-language` guard: built now, in this phase**, not deferred — `SyncLogEntryType`, `syncLog.ts`'s `buildUnsupportedLanguageEntry`, `SyncLogPanel.tsx`'s badge, and a persistent dismissible banner (`App.tsx`) all ship in this commit. Verified end-to-end in-app (dev server + a manually patched `Project.language`, see Step 4 below).
5. **R1 (drop-clustering thresholds) and R10 (run-survival calibration): rechecked, not retuned, per Part F's freeze.** Neither was touched. Both remain calibrated against `base.en`'s drop/match profile; Contract 1→2 P3's own table already flags R1 for recalibration "at Phase 2a" and Contract 2→3's R10 disposition already says "recheck at 2a" — both are explicitly carried forward as OPEN, not silently closed, pending Step 5's real-corpus resync data on the new model. No constant was changed in this phase.

Scope shipped (Step 4): `whisper.rs` — model path swapped to `ggml-large-v3-turbo.bin` (all 3 resolution branches + error message), `whisper_transcribe` takes a `language: String` param, `-np` dropped (stdout token-line output verified byte-identical with/without it — see determinism note above), stderr is now line-buffered and scanned for `auto-detected language: XX` (previously fully ignored), `WhisperEvent::Done` gained `detected_language: Option<String>`. `whisperService.ts`/`useWhisper.ts` thread the language through and write `Project.language` only when it was previously unset (detection never overwrites). `types.ts` gained `Project.language?: string` and `SyncLogEntryType`'s `'unsupported-language'` member. `constants.ts` gained `SUPPORTED_LANGUAGES`/`SUPPORTED_LANGUAGE_CODES` (en/es/fr/pt/de). `ProjectSettingsModal.tsx` gained a Language section (Auto-detect + the five, draft-then-commit like every other section in that modal). `App.tsx` wires the language into the transcription call site, and adds the H.4 guard (a `useEffect` keyed on `project.language`, independent of any specific Apply Sync branch — deliberately not threaded into the two `pendingLogEntries` branches directly, since a language-guard condition can also arise from a Settings-only edit with no sync run at all) plus the persistent banner. **No normalization-path code was touched** — `textNormalize.ts`/`whisperService.ts`'s canonicalizers are untouched, satisfying "the English normalization path must remain byte-identical."

Verified (Step 4, this session): `cargo check` clean (no warnings), `npx tsc --noEmit` clean, `npx vitest run` — 1281/1281 passing (unchanged — no new tests added, matching this document's own "tests are change-detectors only" stance and the absence of an easy real-corpus-driven harness for a thin Rust-IPC-parameter change). UI smoke-tested live in the Vite dev server: Project Settings' Language dropdown shows all 5 + Auto-detect, selection persists through Save + reload, and the full guard path was exercised by patching a live project's persisted `language` to `'zh'` and reloading — the `unsupported-language` log entry (correct message/severity/fixHint) and the red "LANGUAGE" badge in the Sync Log panel, plus the dismissible top banner, all rendered correctly with zero console errors. **What this does NOT verify:** the actual Tauri IPC round-trip (`isTauri()` gates the real transcription call off in a browser tab), and therefore the real `whisper_transcribe` invocation against turbo with a live audio file, are unverified in-app — confirmed instead by the standalone terminal `whisper-cli` runs above (Step 2), which exercise the identical args/model/stderr-parsing logic this session hand-verified matches `whisper.rs`'s new parser.

**Step 5 — real-corpus turbo resync + inspector pull: DONE (2026-08-04/05). Full forty-seven-boundary owner listen: DONE (2026-08-05, owner manual pass).** The owner ran a fresh in-app resync on turbo for V6, the 173-project, and the Spanish project, and pulled `window.__transcriptInspector()` CSVs for all three (`docs/V6-Smear-Phase2a.csv`, `docs/173-Smear-Phase2a.csv`, `docs/Spanish-Smear-Phase2a.csv`). What follows is the resulting analysis (code-side: CSV parsing, cross-era diffing, corpus text cross-referencing — not owner listening, which is explicitly out of scope for this pass and remains the blocking item before Stage 1 can lock).

**Turbo-era smear baseline (Phase 1b's table, re-measured on the model this programme actually ships).** Read directly from each inspector run's own aggregate log line (committed at the tail of each CSV):

| Metric | V6 base.en (Phase 1b) | V6 turbo | 173 base.en (Phase 1b) | 173 turbo | Spanish turbo |
|---|---|---|---|---|---|
| Raw transcript tokens | 4517 | 4556 | 1973 | 2082 | 399 |
| Malformed drops | 562 | 567 | 169 | 246 | 36 |
| Kept tokens fed to alignment | 3955 | 3989 | 1804 | 1836 | 363 |
| Median smear | 0.380s | 0.430s | 0.760s | 0.760s | 1.140s |
| p95 smear | 2.660s | 2.740s | 4.878s | 4.787s | 3.970s |
| Negative-smear count / fraction | 1359 / 34.4% | 1338 / 33.6% | 423 / 23.6% | 281 / **15.4%** | 61 / 16.9% |
| Audio duration | 1421.3s | 1421.28s | 709.0s | 709.01s | 92.02s |

Read with care: the turbo columns are NOT evidence the timing source improved — median/p95 smear are flat-to-slightly-worse on V6 and unchanged on 173; only the negative-smear fraction on 173 drops meaningfully (23.6%→15.4%), and one project's fraction moving is not a general claim about the timing source (Phase 2b, not this phase, measures that). The malformed-drop count rising on 173 (169→246, `inverted-or-zero-duration` alone 30→54) is consistent with K9's prediction that a model swap shifts the drop profile and needs Contract 1→2 P3's R1 thresholds rechecked — still open, not closed by this data. Both corpus projects ran to completion with no abort and no `silence-scan` error; the Spanish run likewise completed cleanly (399 raw tokens, 27 silences detected, no abort/error in the captured log) — see Step 5 (Spanish) below for what "completed cleanly" does and does not certify.

**Step 1 finding — a genuine content dropout, not a timing artifact (V6, 78.97–88.67s).** The turbo inspector CSV shows four tokens — `You` (78.97–80.57, 1.60s), `start` (80.57–83.05, 2.48s), `watching` (83.05–87.12, 4.07s), `the` (87.12–88.67, 1.55s) — spanning 9.7 seconds, an order of magnitude longer than any real spoken word in this narration (compare the immediately following `older`/`hunters`/`differently`, each 0.24–0.36s). The base.en CSV covering the identical span (`docs/v6-smear-baseline.csv`, rows 216–240) reads, verbatim, token-by-token:

> `...like(77.12–77.28) nothing(77.36–77.78) happened(77.78–78.69) But(78.83–79.06) something(79.06–79.83) stayed(79.83–80.34) in(80.34–80.58) you(80.58–80.76) Small(81.43–81.44) and(81.44–81.69) permanent(81.69–82.45) A(82.80–83.24) new(83.24–83.32) understanding(83.32–85.05) of(85.05–85.12) what(85.12–85.28) the(85.28–85.49) night(85.49–85.85) actually(85.85–86.46) is(86.46–86.69) You(86.83–87.02) start(87.02–87.38) watching(87.38–87.96) the(87.96–88.18) older(88.18–88.58) hunters(88.58–89.43) differently(89.43–89.85)...`

This is segments 27–29's full script text — "But something stayed in you." / "Small and permanent." / "A new understanding of what the night actually is." — captured cleanly by base.en with ordinary word-length tokens, immediately followed by segment 30's "You start watching the older hunters differently." Turbo's output has NO trace of "stayed," "permanent," or the correct-position "understanding" anywhere in its transcript — confirmed by a full-file search: `stayed` and `permanent` occur zero times in turbo's 4556-token output; the sole `understanding` token sits at 1384.59s, an unrelated later sentence, not this one. Turbo's four anomalously-long tokens are its honest best fit of the words it DID hear ("You start watching the") stretched across the 9.7s window that also contains the three sentences it silently failed to transcribe at all.

**Classification: a model-swap accuracy regression, not an alignment failure.** The Hirschberg aligner cannot recover text that was never emitted as tokens — there is nothing for it to align against. This is not a timing-source problem either (Phase 3's DTW/forced-alignment work refines WHERE an emitted token's audio begins; it cannot invent a token turbo never emitted). **Consequence for Phase 2b:** large-v3 (non-turbo) must be measured as a genuine timing-source CANDIDATE in its own right, not merely retained as the reference ceiling H.2 originally scoped it as — if large-v3 captures this dropout where turbo does not, that is a real accuracy data point Phase 2b's decision gate needs, independent of its DTW-vs-forced-alignment timing question. This does not roll back the Phase 2a model choice (H.2's scope tradeoff — turbo's 6-8x speed for near-large-v3 accuracy on high-resource languages — stands on its own reasoning), but it does mean Phase 2b's brief is now explicitly "measure whether large-v3 also drops this passage" alongside its existing DTW-error measurement, and Phase 2b's report must say so either way.

**Step 2 findings — the three other 173-project skip candidates.**
- **Segment 1 ("The Hardest Warhammer 40K Environments to Fight In") — confirmed correct skip, unspoken title card.** Turbo's transcript begins at t=0.16s with "Some places in the 41st millennium don't just kill soldiers" — segment 2's text, verbatim. A full-file search for `warhammer`/`hardest`/`fight` returns zero matches; `environments` occurs once, at 683.88s, an unrelated later sentence. Not a defect.
- **Segment 13 ("The blue monkey jumped over the moon") — confirmed correct skip, planted test string.** A full-file search for `blue`/`monkey`/`jumped` in the turbo transcript returns zero matches anywhere. Not a defect.
- **Segment 112 ("Some don't emerge.") — turbo-era regression, mechanism identified: a compound of a genuine word drop and a pre-existing normalization asymmetry, most likely resolved by the run-survival gate (Bug C).** Three findings together explain the reported "matched 1 of 4, longest run 1":
  1. **Turbo drops the word "Some" here; base.en does not.** Turbo's tokens at this position read `don(443.82–443.95) 't(443.95–443.99) emerge(443.99–444.41)` — no token for "Some" at all (the preceding token, `course`, ends at 442.94, an 0.88s silent gap directly into `don`). Base.en's tokens for the identical audio position read `Some(443.84–443.97) don(443.97–444.22) 't(444.22–444.33) emerge(444.33–444.76)` — "Some" present and correctly timed. This is the same class of finding as Step 1, at much smaller scale.
  2. **A pre-existing, model-independent normalization asymmetry compounds it.** `textNormalize.ts`'s `CONTRACTION_RE` expands "don't"→"do not" only when the literal substring "don't" appears in one contiguous run of text — true of the SCRIPT side (`canonicalizeSceneDoc` operates on the whole scene-doc string before any word-splitting, so "Some don't emerge." always becomes "some do not emerge" pre-tokenization, 4 normalized words). It is never true of the TRANSCRIPT side here, because Whisper — both base.en and turbo, confirmed identically at this exact position and elsewhere in the same file (e.g. segment 2's "don't just kill soldiers" also splits `don`+`t`) — emits the contraction as two separate sub-word tokens, each normalized independently; neither `don` nor `'t` alone ever matches the `don't` substring pattern, so this half never expands to "do"/"not" on the transcript side, in either model era. This asymmetry is NOT new to turbo — the existing `verification-baseline.csv` row for this exact boundary (`do not emerge || for ground forces`, case_type `control`) was verified CORRECT at Phase 0 on base.en, proving the segment survived there despite the asymmetry, because "Some" was present to anchor a 4-token hole-tolerant run (`Some`-hole-hole-`emerge`, contiguous transcript indices 1148→1151, within `RUN_SURVIVAL_MAX_HOLE`'s tolerance of 2) — sufficient to clear the ≥2 run requirement for the 4-10-word band the normalized 4-word query falls into.
  3. **Turbo's missing "Some" removes exactly that anchor.** With "Some" absent, the only literal match against the 4-word normalized query ("some","do","not","emerge") is "emerge" alone — matched=1, longest run=1, which fails both the run-survival gate's required run (≥2 for a 4-word-band query) and its density fallback (confidence 1/4=0.25, below the 0.5 floor). This is presented as the most likely mechanism, not a certainty — it was not verified by running the actual pipeline against this project, only by reconstructing the token evidence and cross-checking it against the documented gate constants (`syncConstants.ts`). It is NOT a case of a neighbouring segment claiming the tokens: segment 111's own true match ends at `course` (idx 1165), three token-indices before `don` begins (idx 1166), so no neighbour theft occurred.
- **Corpus drift note.** The 173-project's scene doc (`sync.txt`) now contains **175** bracket-tagged segments, not 173, as of this session — 2 more than the count Phase 0 locked (173 segments / 1973 transcript tokens). Segment 112 ("shadow_loss", "Some don't emerge.") still sits at raw scene-doc position 112, so this session's numbering and Phase 0's numbering agree at least through that position, but the doc has drifted since Phase 0's interior-skip test (which was supposed to restore the doc to its original state after manufacturing a test skip) — recorded here as a flag, not resolved. Any future phase relying on "173-project, segment N" by position should re-verify the count first.

**Step 3 finding — cross-era boundary listen candidates.** Cross-era diff (word-text-keyed per K9, never token-index-keyed) of the base.en and turbo inspector CSVs, run for every boundary in the current `verification-baseline.csv` set plus every boundary the two sync logs flagged via `validateBoundaryQuality`. **Caveat, stated up front and again in `verification-baseline.csv`'s own new rows: `validateBoundaryQuality`'s `boundaryUsedFallback` helper has the known 4-argument bug (`project-state.md`'s Deferred Known Bugs) that silently disables the seam exemption on every reading, so a flagged pair may simply be a normal seam-exempted boundary being mis-read as a fallback — these flags are a pointer for where to listen, not a verdict on any boundary's correctness.** Ranked by |Δ inter-segment token gap| (turbo − base.en), non-exhaustive top entries (full per-pair gap/smear numbers for all 46 flagged/candidate boundaries are in the working notes; every one of them now has a `phase-2a` row in `verification-baseline.csv` for the owner to fill by ear):

| Rank | Project | Boundary (script-word key or pair#) | base.en gap | turbo gap | Δ | Note |
|---|---|---|---|---|---|---|
| — | V6-447 | `small and permanent \|\| a new understanding` | 0.35s | N/A | — | **Step 1's dropout** — turbo has no tokens for this segment pair at all |
| — | 173-seg | `do not emerge \|\| for ground forces` (seg 112–113) | 0.29s | 0.83s | +0.54s | **Step 2's seg-112 regression** — turbo drops "Some"; segment likely fails the run-survival gate |
| — | V6-447 | pair 307–308 (`are forty nine \|\| three of your`) | 0.25s | N/A | — | turbo drops "Three of your old" entirely before "scouts" — a third, smaller Step-1-class dropout |
| 1 | 173-seg | `a corrupted interior \|\| pocket instabilities isolated` | 0.00s | 0.89s | +0.89 | |
| 2 | 173-seg | pair 96–97 (`and resumed patrol \|\| progress measured in`) | 0.00s | 0.76s | +0.76 | |
| 3 | 173-seg | pair 64–65 (`thick rockcrete everywhere \|\| deep vaults below`) | 0.08s | 0.86s | +0.78 | turbo also renders "Thick" as bare "ick" (drops the "Th") |
| 3 | 173-seg | `just kill soldiers \|\| they take apart` (skip-adjacent) | 0.00s | 0.78s | +0.78 | |
| 5 | 173-seg | `demolition target instead \|\| the environment did` (locked-segment, K13) | 0.21s | 0.87s | +0.66 | already a known-FAIL case for an unrelated reason (lock loss) |
| 6 | 173-seg | `establish a perimeter \|\| you cannot hold` | 0.21s | 0.85s | +0.64 | |
| 7 | V6-447 | `never far \|\| never alone` (control) | 0.40s | 1.00s | +0.60 | |
| 8 | 173-seg | pair 88–89 (`dimensionally compressed architecture \|\| rooms that register`) | 0.46s | 1.03s | +0.57 | |
| 9 | 173-seg | pair 21–22 (`decides to engage \|\| catachan devil ants`) | 0.32s | 0.80s | +0.48 | turbo also renders "Catachan" missing its leading "C" |
| 9 | 173-seg | `a maintenance fault \|\| squad formations built` (control) | 0.17s | 0.65s | +0.48 | |
| 11 | 173-seg | pair 166–167 (`not a given \|\| some environments kill`) | 0.47s | 0.94s | +0.47 | |
| 12 | V6-447 | `on your shoulder \|\| not hard` (word-shift-11) | 0.50s | 0.09s | −0.41 | |
| 13 | V6-447 | pair 147–148 (`in the cold \|\| sleeping people breathing`) | 1.42s | 0.13s | −1.29 | |
| 14 | V6-447 | pair 266–267 (`are forty one \|\| there are children`) | 1.61s | 0.37s | −1.24 | age spoken as digit "41"/"49" in both eras |
| 15 | V6-447 | `sleep \|\| three hours at` (short-segment-run) | 0.00s | 0.42s | +0.42 | |
| 16 | V6-447 | `a long time \|\| you carry it` (word-shift-11) | 0.35s | 0.00s | −0.35 | |

Also visible in the working data, worth the owner's attention independent of ranking: **turbo drops short function/lead words scattered across many boundaries beyond Step 1's single large case** — "The" (seg 129/130 region — though base.en drops its OWN "The" at the same spot, a rare base.en-side miss), "No" (before "signal", seg ~79), "afraid" (seg ~316, rendering "but is afraid of fear" as "but is of fear"), and "Fen's" lead-in (seg ~412, "Fen's youngest scout" → bare "youngest scout"). None of these is individually as large as Step 1's 9.7s case, but the pattern — turbo silently omitting short words base.en captured — recurs often enough across this listen-candidate set that it should be read as a systemic accuracy trait of this model on this corpus, not a one-off.

**Step 4 — `verification-baseline.csv` phase-2a rows appended (2026-08-04/05).** All 47 existing verification-set boundaries plus 22 new candidates from Step 3's sync-log-flagged pairs (24 flagged, 2 already coincide with existing verification-set keys — V6 pair 130–131 and 173 pair 132–133 — so no duplicate rows were added) now carry a blank-verdict `phase-2a` row for the owner to fill by ear; append-only, no Phase 0 row edited or removed. **Phase 0's correct-verdict count, computed directly from the file (most recent verdict per key, honoring the two Part-L-repaired duplicate rows): 30 of 47.** The Phase 2a gate (this phase's own text, above: "the gate is that the forty-boundary verdict does not get worse") is therefore measurable the moment the owner's listening pass lands a `correct`/`word-shifted`/`clipped` verdict in each blank cell: **phase-2a passes this gate at ≥30 correct.**

**Step 5 (Spanish) — run completed cleanly; boundary quality UNVERIFIED; written acceptance.** The Spanish corpus project (`Spanish Project/`, 27 scene-doc segments, genuine Spanish narration confirmed by spot-reading both the scene doc and the transcript — e.g. tokens `S`+`illa` reconstructing "Silla") was transcribed on turbo and produced a complete inspector run with no abort and no error: 399 raw tokens, 36 dropped, 363 kept, 27 silences detected, `audioDuration=92.02s` — all read directly from the run's own committed log line in `docs/Spanish-Smear-Phase2a.csv`. This satisfies H.8's letter (at least one Spanish-or-French project exists and was exercised by the pipeline) but not its spirit in full: **no boundary-quality or listening verification has been performed on the Spanish run** — no Spanish boundaries are in `verification-baseline.csv`, and this session did not attempt to construct any (doing so would require a Spanish speaker's ear, which this session does not have and should not simulate). **Written acceptance, recorded here per K3/H.8's own allowance for dormant language-keyed rules landing before their corpus arrives:** the Stage 1 lock gate's non-English requirement is accepted as partially, not fully, satisfied — Spanish corpus exists and the pipeline runs cleanly on it (a real, positive data point: no crash, no silence-scan error, a plausible token/silence count for a 92s clip), but its boundary correctness is unknown, and French, Portuguese, and German corpus material remains completely absent from D.0's inventory with no owner deliverable yet scheduled to acquire it. Per H.5/Phase 3b's own stated allowance, French/Portuguese/German's language-keyed normalization rules may land and stay dormant behind their language keys until corpus material arrives to verify them — this acceptance extends the same allowance to Spanish's BOUNDARY verification specifically (as opposed to its normalization rules, which Phase 3b has not yet touched for any language). **Reopening trigger:** this acceptance is voided, and Spanish boundary listening becomes mandatory before Stage 1 can lock, the moment any Spanish-specific normalization or alignment code ships (Phase 3b) — an untested language must not carry untested rules into a locked stage.

**Step 6 — owner ear-listening pass and gate result (2026-08-05). PHASE 2a DONE.** The owner listened to all 47 boundaries in the verification set (dated rows appended, append-only, to `verification-baseline.csv`; no Phase 0 row edited). Per-bucket breakdown: **38 correct, 5 word-shifted, 1 FAIL, 2 N/A (excluded from the gate — transcription loss, not a boundary failure), 1 unverified (excluded — not listened this pass).** Against the 44 rows that received a real placement verdict (correct/word-shifted/FAIL): **38/44**. Gate text (this phase's own wording, above): "the gate is that the forty-boundary verdict does not get worse (count of correct verdicts ≥ the Phase 0 count)." Phase 0's count was 30/47. **38 ≥ 30 — gate PASSED.** (39/44 if the owner reclassifies `seasons than you || can count and` as correct rather than word-shifted — see Step 7 below; does not change the pass/fail outcome either way.)

- **N/A (2):** `small and permanent || a new understanding` (V6) and `do not emerge || for ground forces` (173-seg) — both correct at Phase 0, both lost to Step 1/2's confirmed turbo content dropouts (the segment's script text was never transcribed at all, so there is no audio for either boundary to place against). Loss is transcription, not placement — excluded from the gate rather than counted as a regression.
- **Unverified (1):** `the fire settling || branches pulling tight` — left blank by the owner this pass; excluded from the gate, not a verdict.
- **FAIL (1):** `demolition target instead || the environment did` (173-seg, locked-segment) — unchanged from Phase 0's FAIL; K13 (lock preservation) is unchanged in code this phase, so this is not a regression, just a still-open pre-existing defect.
- **Word-shifted (5):** `does the same || what the job`, `s youngest scout || a girl of` (both word-shift-11/seam-exemption-8, consistent with Phase 0), plus two **new phase-2a control regressions** — `and fat-soaked moss || bound with sinew` and `when you report || but your hands` — both verified CORRECT at Phase 0 on base.en, now word-shifted on turbo. Below the systemic-regression threshold (2 of 20 sampled controls) but recorded, not waved away — see Step 7's R10 finding.

**Step 7 — three findings recorded from this pass.**

1. **`seasons than you || can count and` — a new, third failure class, distinct from smear and picker over-reach.** The cut itself is clean and lands at a genuine acoustic pause — but two words ("can count") land on the wrong side of it. Neither Part L's smear mechanism (a token timestamped inside the wrong segment's slot) nor Part A's picker over-reach (a widened search window stealing a silence) describes this: here the acoustic pause is placed correctly, but the *narrator's actual pause* disagrees with where the *script* breaks the sentence. **A timing-source upgrade (Phase 3) will NOT fix this class** — better timestamps make an already-correctly-placed pause no more correct. Added to Part L alongside the forward-cascade and backward-smear classes already recorded there as a third, independent failure mode this program must track separately.

2. **pairIdx-20 ("...chitin thick enough") now places correctly in production, but the pinned unit-test fixture (`syncTiming.test.ts:3010`, "KNOWN DEFECT") still asserts the old broken output (75.660, not the correct 76.470) and was re-verified passing, unchanged, on current HEAD.** These two facts do not contradict each other: the fixture is a hand-authored, frozen SYNTHETIC token array reproducing base.en-era timestamp geometry at this boundary — it is not live turbo output, and nothing in this phase touched it or the algorithm it exercises (`snapCoveredBoundaries`/`extractSegmentAlignments`). The underlying algorithmic defect the fixture pins (curr-side breath silence winning over the correct next-side boundary) is still present in code, unchanged. What changed is that turbo's real token timestamps at this real audio position now happen to fall outside the geometry that triggers the defect — a change in the model's output, not a fix to the algorithm. **The fixture does not need updating in this commit** — it still correctly locks the code's behavior against its own frozen synthetic input, and that input was never claimed to represent turbo's tokens. **Phase 6b's scope does NOT shrink to a confirmation** — the defect the fixture documents is still live in code and could still manifest on a different real occurrence (a different audio position, a different model, or if turbo's output drifts on a re-run); Phase 6b still needs to fix the underlying curr-side-breath-vs-next-side-boundary selection, not merely re-verify this one now-quiet instance. Recorded as a finding, not acted on — no code or fixture changed this commit.

3. **R10 (run-survival calibration) — partial regression, recheck-and-record per Part F, NOT retuned.** 2 seam-related regressions surfaced this pass across both projects — `youngest scout || a girl of` (V6, part of the original seam-exemption-8 set) and the newly-added `they're the || worst` (173-seg, Step 8 below) — out of roughly 9 seam-class boundaries tracked across both projects, plus the 2 control regressions noted in Step 6. This is below the systemic-regression threshold and is not blocking Phase 2a's gate, but it is a real signal: `RUN_SURVIVAL_*`/breath-discrimination constants in `syncConstants.ts` were calibrated against `base.en`'s token/drop geometry, and turbo's token geometry differs (Phase 2a's own smear-baseline table above shows shifted drop counts and smear distributions). Per Part F's freeze and R10's own disposition in the R1–R14 mapping ("recheck at 2a; close-or-accept at Stage 2 lock"), this is recorded here as an open recheck item — **no constant was retuned this commit.**

**Net improvement, Phase 0 → phase-2a:** 9 of the original 11 ear-verified word-shift cases resolved (the 2 remaining are `does the same || what the job` and `s youngest scout || a girl of`, both still word-shifted). All 5 of Part L's short-segment-run cases resolved (`small animals || the fire settling`, `sleep || three hours at`, `no signal || no sound`, `no sound || the shift moves` all now correct; `the fire settling || branches pulling tight` unverified this pass, not a regression).

**Step 8 — missing regression row added, not backfilled to Phase 0.** `They're the worst` (173-seg, segment 5–6 boundary) was never in the original 47-boundary verification set — it slipped through Phase 0's sampling entirely, which is why its regression went unnoticed until this pass. Added as a new `phase-2a`-only row in `verification-baseline.csv` (case_type `seam-exemption`, verdict word-shifted), noting it was correct pre-swap per the `c593f1d` fixture record and that it is the exact fixture the curr-side seam exemption was permanently disabled over (`snapBoundaries.ts`'s own doc comment, `docs/boundary-drift-investigation.md`, and CLAUDE.md's entry all cite it). Per K9's append-only baseline discipline, **no Phase 0 row was created for it** — it was never verified at Phase 0, so there is nothing to backfill.

### Phase 2b — Measure the timing sources, ON THE PRODUCTION MODEL (read-only; measurement-exempt from stage ordering)
Entirely outside the app for the ground-truth half, plus the in-app inspector for the smear half. Run the bundled whisper-cli from a terminal against V6’s audio, three ways: turbo raw; turbo + `-nfa --dtw large.v3.turbo` with JSON output; and large-v3 (non-turbo) as a reference ceiling. (The reasoning for measuring on turbo rather than base.en is H.2’s: DTW reads model-specific alignment heads, so a base.en measurement does not describe turbo.)
For each, measure word-onset error against ground truth. Ground truth comes from ffmpeg’s silencedetect: a word that follows a pause must begin when the pause ends. This is the method already used in the investigation, and it produced the 190ms figure we’re trying to beat.
**Deliverable added by the adversarial audit (K8): the measurement script is COMMITTED** (e.g. `scripts/measure-word-onset.md` + the script itself) — the original investigation’s harness lived in `/tmp` and was lost (`docs/audit-verification-2026-08-03.md` §C.7); this measurement must be re-runnable without archaeology.
Decision gate unchanged in form: under ~100ms median error, DTW is adopted in Phase 3. Above that, DTW is abandoned permanently and Phase 3 becomes forced alignment. Note the expected shift: turbo’s weaker timestamp head makes forced alignment MORE likely to win, not less. If turbo’s DTW is materially worse than large-v3’s, that is an explicit accuracy-vs-speed product decision to be made with the number in hand.
Your verification: none needed — this phase produces a number, not a behaviour. It also finalizes Phase 1b’s provisional lock thresholds.

---

## Phase 2b — RESULTS (closed 2026-08-05)

**DECISION: DTW IS ABANDONED PERMANENTLY. Phase 3 becomes FORCED ALIGNMENT (H.3).**

The decision does not rest on the median-error gate at all. It rests on a stronger, simpler measurement: **DTW changes the timestamps that reach the pipeline by exactly zero.**

### Deliverable

`scripts/measure-word-onset.py` + `scripts/measure-word-onset.md` (committed, K8 satisfied). Per-pause raw output committed as `docs/phase2b-onset-{v6,173}-turbo-{raw,dtw}.csv`. Method: ground truth is ffmpeg `silencedetect` (`-45dB`/`0.25s`, matching `silenceDetector.ts`'s production defaults) on the SAME 16kHz mono WAV whisper-cli consumes; for each detected pause, `onset_error = word.start − silence.end`.

### The configurations actually run

The plan specified three; the owner's brief extended it to four (adding large-v3+DTW). **Five were run, and two of the planned four were skipped** — both deviations are recorded here rather than silently absorbed:

- **(a) turbo raw** — exactly the shipped `whisper.rs` invocation. RUN.
- **(b) turbo `-nfa --dtw large.v3.turbo` + JSON.** RUN.
- **(e) turbo `-nfa` alone, NO DTW — a control NOT in the plan, added during execution.** RUN. Config (b) changes two variables at once (`-nfa` and `--dtw`); without this control, every difference between (a) and (b) would have been wrongly attributed to DTW. This control is what actually decided the phase.
- **(c) large-v3 raw / (d) large-v3 + DTW — SKIPPED by owner decision (2026-08-05).** Rationale: the (e)-vs-(b) control settles the DTW question as a property of the `-ml 1` emission format, not of any particular model, so (c)/(d) could not overturn it. **Consequence, stated plainly: the ACCURACY question these two were meant to answer — does large-v3 avoid turbo's content dropout and its zero-duration tokens? — is UNMEASURED and remains open.** See "What this phase did NOT measure" below.

### Measured results

Wall-clock on this machine (Intel i9-9980HK, 16 threads, no GPU backend); `xRT` = audio seconds per wall-clock second.

| Project | Config | Wall-clock | xRT | Tokens | Zero-dur real words | Pauses scored | Median abs err | p95 abs err | Neg-smear |
|---|---|---|---|---|---|---|---|---|---|
| V6 (1421.3s) | (a) turbo raw | 834.9s | 1.70 | 4556 | 68 | 533 | **0.500s** | 1.283s | 97.4% |
| V6 | (e) turbo `-nfa` | 1108.6s | 1.28 | 4579 | 52 | 537 | 0.513s | 1.280s | 96.3% |
| V6 | (b) turbo `-nfa`+DTW | 1049.0s | 1.35 | 4579 | 52 | 537 | 0.513s | 1.280s | 96.3% |
| 173 (709.0s) | (a) turbo raw | 452.3s | 1.57 | 2082 | 44 | 194 | **0.080s** | 0.497s | 68.0% |
| 173 | (e) turbo `-nfa` | 607.3s | 1.17 | 2080 | 41 | 194 | 0.079s | 0.536s | 65.5% |
| 173 | (b) turbo `-nfa`+DTW | 537.7s | 1.32 | 2080 | 41 | 194 | 0.079s | 0.536s | 65.5% |

**Wall-clock carries ≥5.7% run-to-run noise on this machine** — config (b) timed FASTER than config (e) (1049.0s vs 1108.6s) while producing byte-identical output. Do not read small timing deltas in this table as real. The one robust timing statement: `-nfa` costs roughly 25–33% (it disables flash attention).

### Finding 1 — DTW's effect is exactly zero (the decision)

Config (e) (`-nfa`, no DTW) vs config (b) (`-nfa` + `--dtw large.v3.turbo`):

```
max timestamp delta = 0.000000000s   over all 4,579 V6 tokens AND all 2,080 173 tokens
tokens differing by >0.5ms or in text: 0 / 4579   and   0 / 2080
```

DTW was genuinely ENABLED, not silently ignored — verified directly from whisper-cli's own stderr:

```
# with -nfa -dtw large.v3.turbo
whisper_init_with_params_no_state: flash attn = 0
whisper_init_with_params_no_state: dtw        = 1
# with -dtw but no -nfa (the pre-Phase-2a shipped shape)
whisper_init_with_params_no_state: dtw_token_timestamps is not supported with flash_attn - disabling
whisper_init_with_params_no_state: dtw        = 0
```

(The second block is also the first direct, captured evidence for this project's long-standing claim that `--dtw base.en` was a silent no-op. That claim was correct.)

So: DTW runs, reports itself active, and refines nothing that reaches the pipeline. **A timing-source upgrade that changes no timestamps cannot fix a timestamp defect.** This is not a marginal-benefit judgement or a threshold argument — there is no effect to weigh.

### Finding 2 — WHY DTW cannot win here (the mechanism)

Whisper's declared word start is not a noisy estimate of the true onset. It is, systematically, **the start of the preceding pause**:

| V6, config (a) | Median error | Median absolute error |
|---|---|---|
| vs silence **END** (the correct onset) | −0.500s | 0.500s |
| vs silence **START** | **+0.038s** | **0.111s** |

The word's declared start lands 38ms after the pause BEGINS — i.e. essentially at the pause's leading edge, with the entire pause absorbed into the word's own span.

The cause is structural, and it is the emission format rather than the model's timestamp head: **under `-ml 1`, tokens are gapless.** Every token's start equals the previous token's end — 97.8% of transitions on V6, 93.4% on 173. Silence therefore has nowhere to live except *inside* some word's declared span. This predicts, correctly, that smear magnitude tracks how much silence a voice contains:

| | Silence as % of audio | Median abs onset error |
|---|---|---|
| V6 (long-pause voice) | **25.6%** (364.5s of 1421.3s, 539 pauses) | 0.500s |
| 173 (tight-pause voice) | **10.5%** (74.2s of 709.0s, 195 pauses) | 0.080s |

It also predicts the error should scale with each individual pause's length, which it does — stratified on V6 config (a):

| Pause duration bucket | n | Median abs error | Neg-smear |
|---|---|---|---|
| 0.25–0.50s | 191 | 0.358s | 97.9% |
| 0.50–0.75s | 165 | 0.559s | 95.2% |
| 0.75–1.00s | 87 | 0.721s | 100.0% |
| 1.00–2.00s | 90 | 1.092s | 97.8% |

Median error ≈ pause duration, across the whole range. DTW refines attention alignment *within* this gapless emission; it does not get to dispute a span the output format has already fixed. **This is why no DTW preset, on any model, recovers this — and it is a stronger conclusion than the plan's original expectation** (which anticipated DTW losing because turbo prunes the timestamp-bearing decoder — a model-capacity argument that would have left "maybe large-v3's DTW is better" genuinely open).

This measurement independently re-derives, at scale and with a precise mechanism, Part C's segment-96 walkthrough — and Part L's governing ratio (defect severity ≈ smear / segment duration) now has its numerator explained: the smear a segment suffers is approximately the duration of the pause preceding it.

### Instrument validation (how we know these numbers aren't an artifact)

Stated because this document's own Part F forbids trusting a metric that has not been checked against known ground truth:

1. **The measurement reproduces the committed segment-96 fixture.** Silence `[289.380, 289.960]`, token "predator" `[289.260, 289.800]` — the token's midpoint (289.530) correctly falls inside the silence, so it is selected as the pause-following word exactly as the `c593f1d` fixture and §D.12 describe.
2. **The error distribution is tightly clustered around a real reference point.** Median absolute error vs silence START is 0.111s on V6 — a tight cluster. A broken token-selection or a time-base mismatch between ground truth and tokens could not produce tight clustering against ANY reference; it would produce noise against all of them.
3. **Config (a)'s token count (4556) matches Phase 2a's independently-produced in-app turbo count (4556) exactly** — confirming this out-of-app harness reproduces the real pipeline's transcription faithfully.
4. **Two real bugs were found and fixed in the harness before these numbers were taken**, both recorded in the script's own docstrings so they cannot silently return: (i) pure-punctuation tokens (`.`, `,` — whisper emits these as their own timestamped entries under `-ml 1`) were winning the "word following the pause" slot ahead of the real word; production's `filterMalformedTokens` drops these too, so the fix matches pipeline behaviour. (ii) A token whose declared END trivially overlapped a pause's start by ~13ms was being selected as the *following* word when it was really the *preceding* word's tail — fixed by selecting on token midpoint rather than raw overlap.

### Finding 3 — the V6 dropout is caused by FLASH ATTENTION, not by turbo's accuracy

Phase 2a Step 1 recorded a genuine ~9.7s content dropout on V6 (78.97–88.67s), classified there as "a model-swap accuracy regression." That classification is now **refined, and partly corrected**: the passage is recovered by disabling flash attention, on the same turbo model.

| Config | V6 76.5–90.5s transcript |
|---|---|
| (a) turbo raw (**shipped**) | `out into the frost like nothing happened . You start watching the older hunters differently . You` |
| (e) turbo `-nfa`, no DTW | `into the frost like nothing happened . But something stayed in you . Small and permanent . A new understanding of what the night actually is . You start watching the older hunters differently . You notice` |

All three sentences (segments 27–29) return verbatim. **Attribution is certain: config (e) has no DTW at all**, so this is `-nfa` alone, and DTW cannot be credited for it. Flash attention is silently losing real speech in the shipped configuration.

This is a live production accuracy issue, **recorded as a finding only — no code changed** (Phase 2b is read-only; owner decision 2026-08-05). It is not free to act on: `-nfa` costs roughly 25–33% wall-clock, and adopting it would need its own verification pass (a fresh transcript era, per K9, and a re-listen). Left for a future phase to weigh deliberately.

### Finding 4 — 173 segment 112: Phase 2a's mechanism was wrong in an important way

Phase 2a Step 2 concluded "turbo drops the word 'Some'; base.en does not," and built a run-survival-gate explanation on top of that. **Turbo does not drop it.** It emits it — with a zero-duration timestamp:

```
config (a):  Some  443.82-443.82   duration = 0.000s
config (e):  Some  443.82-443.82   duration = 0.000s
config (b):  Some  443.82-443.82   duration = 0.000s
```

`filterMalformedTokens` then discards it as `inverted-or-zero-duration` (`whisperService.ts:1315`, the `t0 >= t1` branch) before alignment ever sees it. The downstream reasoning in Phase 2a Step 2 (run-survival gate fails at matched=1, longest run 1) still holds — but the ROOT CAUSE is a degenerate timestamp, not a transcription failure. That distinction matters for Phase 3: **a timing-source that assigns this word a real duration recovers this segment**, whereas a genuine transcription loss could never be recovered downstream. It moves segment 112 from "unfixable by this programme" to "fixed by Phase 3."

Zero-duration real-word tokens are not rare: **68 on V6 and 44 on 173** under the shipped config (a). Each is a word silently deleted from the alignment corpus. DTW does not fix them either (52 / 41 under `-nfa`, and identical between (e) and (b)).

### Finding 5 — `-nfa` does NOT break stdout printing (a documented "fact" is false)

Four places state, as established fact, that `-nfa` breaks whisper-cli's stdout printing: Part C above ("in this build broke stdout printing"), Part E's progress-reporting row, `docs/boundary-drift-investigation.md`'s DO NOT RE-INVESTIGATE list, and `whisper.rs`'s own in-code comment.

**This is false on the currently bundled binary.** Config (e) ran `-nfa` with NO `-oj`, parsed from stdout exactly as `whisper.rs` does, and produced **4,639 well-formed bracketed lines → 4,579 tokens** with no loss.

Consequence: the Phase 3 cost estimate that flowed from it ("JSON output is new code, not a flag flip, and the progress bar becomes an elapsed-time indicator") **was never actually required by `-nfa`.** This is moot for the DTW decision — DTW lost on its own zero-effect evidence, not on implementation cost — but the claim is corrected here, in `docs/boundary-drift-investigation.md`, and in `whisper.rs`'s comment, so no future phase budgets work against a false premise. The stdout/JSON coupling in `whisper.rs` is real and was re-confirmed by direct source read (`parse_stdout_tokens` at `whisper.rs:450` and `parse_progress_line` at `whisper.rs:438` both consume the same bracketed lines); what is false is that `-nfa` forces a move off that path.

### What this phase did NOT measure — stated so it is not later assumed

- **large-v3 (non-turbo) accuracy: UNMEASURED.** Configs (c)/(d) were skipped by owner decision. Whether large-v3 avoids the V6 dropout, or emits fewer zero-duration tokens, is unknown. The dropout's cause is now known to be flash attention rather than model capacity, which weakens (though does not eliminate) the original reason for suspecting turbo here.
- **Forced alignment's actual accuracy on this corpus: UNMEASURED.** The ~20ms figure in Part C remains a published-literature number, not a local measurement. Phase 3 must measure it with this same script before its own gate is judged.
- **Threshold sensitivity of the ground truth.** `-45dB`/`0.25s` mirrors production, but was not swept. A different threshold finds different pauses and could shift the distribution.
- **Determinism of these specific runs.** Phase 0/2a's determinism checks stand; individual Phase 2b runs were not repeated. The (e)-vs-(b) zero-delta result is itself strong evidence of run-to-run stability in the token output.
- **Machine scope.** Intel x86_64, no GPU backend. Same accepted gap as the rest of this document.

### Consequences for the rest of the programme

1. **Phase 3 is forced alignment (H.3).** Before implementing, H.3's own instruction stands and is now doubly load-bearing: **verify MMS-FA's romanization/CTC mechanics against the actual MMS-FA documentation** — that description is flagged as model recall, not a local read.
2. **Phase 3 must produce word spans that are NOT gapless.** This is the specific, measurable property the current source lacks, and it is what makes Part C's fence buildable. A forced aligner that emitted gapless spans would reproduce this defect exactly; this is now a stated acceptance criterion for Phase 3, not an implicit hope.
3. **Part C's "~190ms → ~80ms" DTW estimate is retired as FALSIFIED** (measured: 0ms change). The "~190ms" baseline it was measured against is also not reproduced here — this measurement finds 500ms median on V6 and 80ms on 173 — but those are different corpora slices and possibly a different selection rule, so the older figure is marked superseded rather than declared wrong.
4. **Phase 3d (adaptive silence thresholds) — evidence now available.** 2b's brief included deciding whether the fixed −45dB threshold is costing us. It is NOT the binding constraint: the ground-truth pauses it finds are real (verified against the waveform) and the failure is on the token side, not the silence side. **Phase 3d should be skipped unless Phase 3's post-forced-alignment measurement shows a silence-side cost** — recorded here per that phase's own "record the finding and skip" instruction.

### Phase 3 — Upgrade the timing source
**DECIDED BY PHASE 2B (2026-08-05): FORCED ALIGNMENT. The DTW branch below is closed — do not revisit it without new evidence that overturns the zero-delta measurement.**
Whichever won. If DTW: switch the Rust side to JSON output, which the audit confirmed is new code rather than a flag flip, and replace the progress bar with an elapsed-time indicator since progress currently scrapes the same stdout lines that -nfa breaks. If forced alignment: bundle ONNX Runtime and the CTC model (multilingual per H.3), implement the Viterbi pass, and slot it behind the Stage 1 timing interface.

**Phase 2b's additions to this phase's brief:**
1. **Verify MMS-FA's romanization/CTC mechanics against the real MMS-FA documentation BEFORE implementing** — H.3 flags its own description as model recall, not a local read. This is now on the critical path, not a nicety.
2. **Acceptance criterion, new and explicit: the new source must emit NON-GAPLESS word spans.** Gaplessness is the measured root cause (Phase 2b Finding 2). A forced aligner that emitted gapless spans would reproduce this defect exactly, so this must be checked, not assumed.
3. **Acceptance criterion: zero zero-duration real-word tokens** (finalized threshold 4 in Phase 1b's entry). Today: 68 on V6, 44 on 173.
4. **Measure with the committed script** (`scripts/measure-word-onset.py`) against the finalized four thresholds, on both a tight-pause and a long-pause project, before the phase's own listening pass. Part C's ~20ms forced-alignment figure is a published number and is UNVERIFIED locally — this is where it gets verified.

**Blockers 1, 2, and 3 — recorded 2026-08-05.** Blockers 1 and 3 are resolved and closed. Blocker 2 (measuring MMS-FA itself against the finalized gate) is measured below; **its gate verdict is left PENDING OWNER DECISION** — this session stops after the measurement and ratio analysis to report back, per explicit instruction, rather than self-certifying a pass/fail or proceeding to integration.

**Blocker 1 — model/license selection, verified against the real candidate set, not recall.** `wav2vec2-large-xlsr-53` (the bare Meta/Facebook checkpoint) is **CONFIRMED pretrain-only**: it carries no CTC head and cannot forced-align text out of the box — it is a self-supervised feature extractor, not a fine-tuned ASR/alignment model; using it here would require fine-tuning a classifier head first, which is out of scope. **MMS-FA (torchaudio's `MMS_FA` bundle) is CC-BY-NC-4.0** — approved for personal/testing use only under that license; a commercial ship of this app cannot bundle it as-is. Two commercial-license candidates exist for a future production swap, neither adopted now: the **jonatasgrosman per-language `wav2vec2-large-xlsr-53` fine-tunes** (Apache-2.0, real CTC heads, one model per language rather than one multilingual model) and **`nvidia/parakeet-tdt-0.6b-v3`** (commercially licensed). **Parakeet's CTC-extractability outside NeMo is explicitly UNVERIFIED** — its TDT (token-and-duration transducer) decoder is not natively a CTC emission source, and whether a usable frame-level emission matrix can be pulled out of it without the NeMo toolkit has not been checked. **Not on this session's critical path** — no Parakeet spike is being built now (see this phase's own scaffolding scope below); it belongs in its own future task if a commercial-license swap is ever pursued. Consequence for H.3: its "language code selects a romanization strategy" premise is corrected in place (see H.3) — it holds only for MMS-FA, not for forced alignment generally.

**Blocker 1 de-risking follow-up (2026-08-05) — jonatasgrosman/wav2vec2-large-xlsr-53-english measured, not just licence-checked.** Before spending a run on it, verified this is a real, usable CTC model, not just an Apache-2.0 label: `config.json` shows `architectures: ["Wav2Vec2ForCTC"]` with a real 33-symbol vocab (`a`-`z`, `'`, `-`, `|` word-delimiter, blank/specials) — a genuine fine-tuned English CTC decoder, structurally unlike the bare Meta pretrain checkpoint this same Blocker already ruled out. The downloaded weight blob is exactly **1,261,942,732 bytes**, confirmed by direct `os.path.getsize`. A live load + greedy CTC decode (no forced alignment, just `argmax` over logits) against the first 5 seconds of project 173's own audio produced *"some places in the forty-first millennium don't just kill soldiers they take up"* — an accurate transcription of the real script text, proving the CTC head produces genuine usable output on this corpus, not merely that the model object loads. One load-time warning was investigated rather than waved off: `wav2vec2.encoder.pos_conv_embed.conv.weight_g`/`weight_v` are reported unused and reinitialized under a different parametrization name — a torch/transformers-version weight-norm naming mismatch affecting one positional-conv layer, not the CTC head; the greedy-decode check above still produced accurate output with this warning present, so it is not judged to meaningfully degrade usable accuracy here, though it was not rigorously ablated (single spot-check only). Full verification detail: `scripts/measure-forced-alignment-hf.md`.

Measured on project 173 only, per instruction — a new script, `scripts/measure-forced-alignment-hf.py` (committed alongside its own `.md`, mirroring the `measure-forced-alignment.py`/`.md` precedent), reuses the exact same per-segment windowed-alignment shape (same clamp, same pad default, same `tokens_<label>.json`/`meta_<label>.json` output) so `measure-word-onset.py`'s `score`/`report` subcommands consume it completely unchanged, and the two models are scored against identical ground truth (`silences.json`). Only the alignment mechanics differ: `torchaudio.functional.forced_align` called directly against this model's own log-softmax output (the same CTC primitive `MMS_FA`'s own aligner wraps), instead of `MMS_FA`'s bundled romanizer + aligner.

| | MMS-FA (`fa2`, CC-BY-NC-4.0) | jonatasgrosman (`hf`, Apache-2.0) | Gate |
|---|---|---|---|
| Median abs error | 22.3ms ✓ | 27.5ms ✓ | ≤100ms |
| **p95 abs error (PRIMARY)** | 69.9ms ✓ | 89.7ms ✓ | ≤250ms |
| Negative-smear fraction | 42.3% ✗ | 44.8% ✗ | <1% |
| Zero-duration real-word tokens | 0 ✓ | 0 ✓ | 0 |
| Wall-clock (173, 709.0s audio) | 112.7s real (≈6.29× realtime) | 143.97s real (≈4.93× realtime) | — |
| Peak RSS (`/usr/bin/time -l`) | 3.98 GiB | 3.19 GiB (peak memory footprint 1.57 GiB) | — |

**Reading the comparison.** Median and p95 both pass their gates for both models, and the two models sit within 5–20ms of each other — noise-level on this project, not a material accuracy gap. Negative-smear fails identically on both, for the same reason already established for MMS-FA (Blocker 2's own finding above): the metric was built to discriminate gapless-vs-non-gapless sources, and both of these are genuinely non-gapless — it does not discriminate ordinary small alignment noise the way it was designed to once errors are small. Zero zero-duration tokens on both — clean pass. jonatasgrosman is **~28% slower** wall-clock but uses **~20% less peak RSS** (a smaller, monolingual model with no romanizer/multilingual-vocab overhead). Full per-word CSV: `docs/phase3-onset-173-hf.csv` (compare against `docs/phase3-onset-173-fa.csv`).

**Consequence for H.3's commercial path.** jonatasgrosman's numbers are within noise of MMS-FA's on this project — the commercial-license path is **numerically viable**, at two real, stated costs neither present with MMS-FA: (a) one ~1.2GB model **per language** rather than one multilingual checkpoint, so H.0's five supported languages would need ≈6GB total, not ≈1.2GB (only English is measured here — the other four are unmeasured, each its own future per-language model and its own accuracy question); (b) no digit-reading capability, degrading (not dropping) any word containing digits (e.g. "41st"→"st") absent production's own `NUMBER_WORDS` normalization layer, which this measurement does not invoke. Given this candidate measures viable, **Parakeet's CTC-extractability remains correctly out of scope** — it is not needed as a fallback investigation unless jonatasgrosman is rejected on some other ground (e.g. the ~6GB multi-language footprint, or non-English accuracy once measured).

**Blocker 2 — measured 2026-08-05.**

*Recovery.* A prototype session had produced real artifacts at `/tmp/phase3/{v6,173}/` (`tokens_fa.json`, `emission.pt`, `onset_errors_fa.csv`, `meta_fa.json`, `silences.json`, `audio_16k.wav`) — checked before concluding anything, per instruction. **The DATA survived; the SCRIPT that produced it did not** — no venv, no stray `.py`, nothing in git status, confirmed by direct search. This is K8's exact `/tmp`-loss pattern recurring one phase later. Per K8's own non-negotiable precedent, the driver script was rebuilt from scratch and is now committed regardless: `scripts/measure-forced-alignment.py` + `scripts/measure-forced-alignment.md` (exact invocation, setup, and a real bug found and fixed while validating it — a neighbour-bleed in the per-segment windowing, see the `.md`). It reuses `measure-word-onset.py`'s `prepare` and `score`/`report`/`check-word` subcommands **unchanged** — only the FA-specific `align` step is new, producing `tokens_<label>.json`/`meta_<label>.json` in the exact shape those subcommands already consume. A fresh, honestly-timed run (label `fa2`, torch/torchaudio 2.2.2 — the last release with macOS x86_64 wheels — CPU-only, no GPU backend, same as every other measurement in this document) was executed on both corpus projects to (a) cross-validate the recovered `fa` data was trustworthy, since its own `meta_fa.json` elapsed_sec (3.4s) was implausible for a real end-to-end run and could not be used for the cost report, and (b) produce the wall-clock/peak-RSS figure Blocker 3 needed.

*Cross-validation.* The recovered `fa` data (509 V6 pauses, 194 173 pauses, produced by the lost script) and this session's fresh `fa2` data (502 V6 pauses — one segment's own alignment failed, see below; 194 173 pauses) agree closely on 173 (median 22.0ms→22.3ms, p95 75.4ms→69.9ms) and agree on ORDER OF MAGNITUDE on V6 (median 19.6ms→21.2ms) but diverge more on V6's tail (p95 396ms→476ms, negative-smear 36.7%→49.0%). The divergence is attributable to a real, documented difference in method, not noise: this session's per-segment windows are clamped to the midpoint of the gap to each neighbour (`measure-forced-alignment.md`'s neighbour-bleed fix), and since this corpus's committed segments are perfectly gapless (`startTime[i]+duration[i]===startTime[i+1]`, Key Invariant (f)), that clamp degenerates to **zero padding** for every interior segment — the window is exactly the segment's own committed span, with no slack at all. Wherever that committed span was already wrong (the lost prototype's own windowing is unknown and may have used non-zero padding), FA gets no room to find the real audio. This is examined directly, not hand-waved, in the ratio analysis below. `docs/phase3-onset-v6-fa.csv` / `docs/phase3-onset-173-fa.csv` are this session's fresh, reproducible numbers — the ones used throughout the rest of this entry.

*Wall-clock and peak RSS — the other half of Blocker 3's honest cost, measured via `/usr/bin/time -l` (same tool/flag as H.9's own whisper-cli measurement).* **Full V6 (1421.3s audio, 447 segments, one segment skipped — see below): 349.5s real wall-clock** (script's own internal timing agrees: 346.3s, of which 12.1s is model load and 332.2s is alignment) — **≈4.07× realtime**, actually faster than Whisper turbo's own 1.70× on this same machine, because FA is one forward pass + a cheap Viterbi pass per segment with no autoregressive decoding loop, unlike transcription. **Maximum resident set size: 4.01 GiB; peak memory footprint: 2.49 GiB** (both reported, matching H.9's own dual-figure convention — user 3503.85s / sys 184.31s CPU-seconds across threads). 173 (709.0s audio): 112.7s real (≈6.29× realtime), peak RSS 3.98 GiB — confirming peak RSS is dominated by the model's own weights/working set, not audio length, since both projects land within 1% of each other despite a 2× duration difference.
**Combined cost, architecture (A):** Whisper turbo (834.9s, Phase 2b) + FA (349.5s) = **1184.4s total, a 41.9% latency increase over today's Whisper-only 834.9s.** Memory is not simply additive: since the two models run sequentially (Blocker 3), the honest peak for the whole sync is `max(Whisper's ~2.1–2.2 GiB, FA's 4.01 GiB) ≈ 4.01 GiB` **if** an implementation releases Whisper's memory before loading FA — not the sum — though this is a design assumption about the eventual Rust integration, not something this measurement can confirm on its own.

*The four finalized Stage 1 thresholds (Phase 1b's entry), MMS-FA (this session's fresh `fa2` run) vs. the shipped Whisper-turbo config (Phase 2b's own table, repeated for direct comparison):*

| | V6 (long-pause) | 173 (tight-pause) | Gate | Whisper turbo (Phase 2b, for comparison) |
|---|---|---|---|---|
| Median abs error | **21.2ms ✓** | **22.3ms ✓** | ≤100ms | 500ms ✗ / 80ms ✓ |
| **p95 abs error (PRIMARY)** | **476ms ✗** | **69.9ms ✓** | ≤250ms | 1283ms ✗ / 497ms ✗ |
| Negative-smear fraction | 49.0% ✗ | 42.3% ✗ | <1% | 97.4% ✗ / 68.0% ✗ |
| Zero-duration real-word tokens | **0 ✓** | **0 ✓** | 0 | 68 ✗ / 44 ✗ |

**3 of 8 readings fail (vs. Whisper's 7 of 8)** — a large, measured improvement, not a clean pass. Two findings on the two failing rows, both evidence-based rather than assumed:

1. **Negative-smear fraction fails on both projects, but not for the reason the threshold was built to catch.** Phase 2b's own text: "Only a non-gapless source can pass it" — i.e. the fraction was meant as a structural gapless-vs-non-gapless test. Splitting FA's errors by sign shows why that assumption doesn't transfer: median |negative error| is **18.6ms (V6) / 11.7ms (173)**, 90th-percentile |negative error| is **39.1ms / 24.1ms** — nothing like Whisper's whole-pause-absorption pattern (V6 median magnitude ~500ms). FA's negative smears are ordinary, small, roughly-symmetric alignment noise (median |positive error| is comparably small: 27.2ms / 34.0ms) — the sign splits roughly evenly simply because noise scatters both directions around a near-zero true error, not because pauses are being absorbed. **Measured correction to Phase 2b's own stated assumption:** a genuinely non-gapless source can still read well over 1% negative-smear; the fraction alone does not discriminate what it was designed to discriminate once errors are small. This is a factual correction to the metric's behaviour, not a threshold retune — the number in the gate is unchanged.
2. **p95 fails on V6 (476ms vs. 250ms) — this is the reading the ratio analysis below directly addresses.** 173 passes p95 outright (69.9ms).

*Ratio analysis — Part L's governing relation, applied to every V6 failure (the task set for this session).* Every V6 scored pause with `|onset_error| > 250ms` (61 of 502; one segment, order 320, failed to align entirely — see below) joined to the committed segment its word-start timestamp falls inside (`v6-segments-full.json` — the most recent full per-segment duration snapshot that exists; base.en-era, pre-Phase-2a, since no turbo-era equivalent was ever exported — affects only how exactly "committed duration" matches today's HEAD, not the onset errors themselves, which never read segment timing). Full 61-row table, including each row's own FA confidence score: `docs/phase3-onset-v6-fa-ratio.csv`.

- **Only 6 of 61 exceed ratio 0.5. Only 2 exceed ratio 1.0** (segment 61 "Not hard." at 1.36, segment 144 "Wind." at 1.01). (Calibration: Whisper's confirmed audible defect, segment 144 "Wind.", ~0.6s slot, −0.610s smear, sits at ratio ≈1.0 — the SAME segment appears in FA's own worst cases, and the reason why is the finding below, not a coincidence.)
- **Every one of the 6 ratio>0.5 rows is fully accounted for, and none is a case of FA confidently producing a large, real timing error.** Cross-referencing each against FA's own per-word confidence score (0–1, reported by the aligner itself) and against this document's own previously-catalogued defect lists (the 11 original word-shift cases, Part L's short-segment-run additions) gives a clean three-way split:
  - **3 are the "it"-scorer-artifact** (next finding) — FA's own confidence on these is 0.94–1.00 (it was *not* confused); the scoring methodology misattributed the word to the wrong pause.
  - **2 are LOW FA-confidence (0.01–0.05) on segments THIS DOCUMENT ALREADY DOCUMENTS as pre-existing base.en-era Whisper timing defects**: segment 61 ("Not hard.") is word-shift-11 case `on your shoulder || not hard`; segment 144 ("Wind.") is Part L's own governing-ratio example; segment 80 ("No sound.", ratio 0.58) is Part L's amendment's bidirectional-cascade case. **Because this measurement's window IS that committed (already-wrong) span with zero padding** (see "Cross-validation" above), FA is being asked to align against a window that may not even contain the word's true audio — and FA's own confidence score correctly flags exactly this, rather than confidently hallucinating an answer.
  - **1 is LOW FA-confidence (0.04) on a segment not on the previously-catalogued list** — segment 303, "You rebuild." (0.47s, zero padding, ratio 0.86). Plausibly an uncatalogued instance of the same short-segment/legacy-timing class Part L describes (it sits in the same dense short-segment run as segments 300–310, which this session's own CTC-crash investigation already touched — see `measure-forced-alignment.md`); **not independently confirmed by ear**, stated as a hypothesis, not a fact.
  - **Zero of the 6 are a case where FA was both confident (score ≥0.3) and wrong by a large margin at ratio>0.5.** Two high-confidence cases (segments 383 "You are sixty-four.", 307 "You are forty-nine.") sit just under the line at ratio 0.49/0.48 — see the next paragraph for what these most likely are.
- **No cascade-class failures found.** Every failure is a single isolated word on a single segment — nothing resembling Whisper's confirmed segment 144→147 forward-displacement chain (Part L) appears anywhere in FA's V6 output.

*The "4 of 50 are the scorer's own midpoint edge case" claim — investigated directly against the actual data, not assumed.* **The claim undercounts: 8, not 4, share the identical signature**, all the word **"it."**: `score_onset_errors`' selection rule (first token whose declared MIDPOINT ≥ the silence's start) picks "it" — which is actually the last word *before* the pause, not the first word *after* it — because "it."'s very short span (~60–100ms) means its own midpoint sits only 2–35ms past the silence's start, just barely crossing the selection threshold. All eight carry FA confidence ≥0.94 (FA itself was not confused) and large, consistent negative errors (−0.41s to −1.44s) that are a property of the scorer's word-selection rule on an ultra-common short word, not of MMS-FA's own alignment accuracy for that word. (A margin cutoff of ~12ms yields exactly 4; every one of the 8 shares the same mechanism, so the discrepancy is where the line was drawn, not a different phenomenon for the other 4.)

*The remaining ~42 high-confidence, large-margin failures — reported, not overclaimed.* Beyond the 8 tiny-margin "it." cases and the 11 low-confidence cases above, the other ~42 of the 61 raw failures are high-FA-confidence (median ≥0.95, overwhelmingly the words "You"/"It"/"The"/"When"/etc. — the most frequent short words in this second-person narration) with LARGE scorer margins (0.7–2.9s), meaning the selected "following word" sits well past where the walk's own bookkeeping placed the pause. Unlike the tiny-margin cases, this is not yet a fully diagnosed mechanism — plausibly it reflects real micro-pause/breath structure between a detected `silencedetect` interval and the true next content word (a documented limitation of this exact scoring method: "pause-following" only means "some earlier silence exists," per Phase 1b's own caveat) rather than an FA timing defect, since FA's own confidence stays high throughout — but this is stated as an open question, not a settled finding. **It does not change the severity conclusion**: none of these ~42 rows reaches ratio 0.5 (the two closest, at 0.48–0.49, are named above), because they land on longer, ordinary-duration segments rather than the sub-second segments where severity concentrates.

*Zero-duration tokens: clean pass, and it fixes a named Phase 2b defect.* 0 of 3857 (V6) / 0 of 1648 (173) FA-produced words have `start == end` — directly resolving Phase 2b's Finding 4 (173 segment 112's "Some", emitted by turbo with a degenerate `443.82–443.82` timestamp and discarded by `filterMalformedTokens` before alignment ever saw it).

*One segment failed to align entirely, and why — a real engineering finding, handled the way this codebase already handles this class of failure.* Segment 320 ("The problem is what happens when the body's warning triggers a second signal that overrides the first.", 102 characters, only 1.27s committed duration) raised a CTC constraint violation (`targets length is too long for CTC` — 63 target symbols need more emission frames than a 1.27s/zero-padding window provides) and was skipped, contributing zero words, rather than crashing the run — matching this codebase's own established philosophy (`filterMalformedTokens`, the coverage gate, the silence-scan-error fallback) of never aborting a whole run over one segment's bad input. This is itself informative: it is a direct, measured demonstration that this corpus's base.en-era committed durations can be too tight even for correctly-transcribed text, independent of any Whisper timestamp-accuracy question — a real production windowing strategy cannot use "the committed duration, zero padding" as its window either, for exactly this reason.

**Gate verdict: left to the owner.** The literal four-threshold table shows 3 of 8 fails; the ratio analysis the owner asked for shows those fails do not correspond to real, unexplained perceptible severity — every ratio>0.5 case is either a scoring-methodology artifact (confirmed by FA's own high confidence) or a case FA itself flags as low-confidence, concentrated on segments this document already knew had legacy timing problems (confirmed by FA's own low confidence on exactly those segments). Zero cascade-class failures exist anywhere in FA's V6 output, versus Whisper's confirmed ratio≈1.0 segment-144→147 cascade. Per explicit instruction, this document does **not** retune the 250ms p95 threshold on this reasoning alone — the reasoning and the data are recorded here and cross-referenced from Phase 1b's entry for the owner to rule on.

**Blocker 2 follow-up — harness-artifact hypothesis, tested and CONFIRMED (2026-08-05).** Task: separate "the window handed to FA didn't contain the true audio, so FA is correctly refusing" from a genuine FA timing defect, for the 6 V6 rows at ratio>0.5. Corrected identification of the 6 rows (the ratio CSV's own `is_it_scorer_artifact` flag, checked directly rather than trusting the earlier prose summary of "3 are it-artifact / 3 are low-confidence"): only **1** row (segment 171, "it.") is the it-scorer artifact; the other **5** rows (segment 61 × 2 words "Not"/"hard.", segment 144 "Wind.", segment 80 "No", segment 303 "You") are the low-FA-confidence (0.006–0.053) cases. This is a factual correction to the earlier summary's count, not a re-derivation of the underlying data — the CSV itself (`docs/phase3-onset-v6-fa-ratio.csv`) was unchanged and correct throughout.

*Method 1 — widen `pad_sec` to 1.5s and bypass the neighbour-midpoint clamp (`floor_bound=0.0`, `ceil_bound=audio_duration_sec`) for exactly these 5 rows' segments, reusing `align_segment()` from the committed `measure-forced-alignment.py` unchanged as a library call (not a script/default edit — the committed script's own `--pad-sec 3.0` default and clamp behaviour are untouched).* Result: **3 of 5 resolve cleanly** — segment 61's "Not" (err +0.411s→+0.017s, conf 0.048→1.00), segment 61's "hard." (err −0.597s→−0.002s, conf 0.036→1.00), and segment 303's "You" (err −0.410s→−0.005s, conf 0.041→0.99) all land within milliseconds of a real detected silence at near-1.0 confidence once given room to look. **2 of 5 got WORSE, not better** — segment 144's "Wind." (err −0.554s→−2.095s) and segment 80's "No" (err −0.477s, reattaching to a different silence entirely once unclamped) — despite confidence rising (144: 0.053→0.779). Root-caused, not left as a puzzle: both segments sit in perfectly gapless back-to-back short-segment runs (143/144/145 and 79/80/81) where the neighbour-midpoint clamp for a single-segment window is **already identical to the segment's own committed boundary** — there is zero legal room to widen without reaching into a neighbour's real speech. Bypassing the clamp for these two didn't find room to look further, it let `with_star` reach into an adjacent segment's real content and misattribute it — exactly the neighbour-bleed failure mode `measure-forced-alignment.md` already documents as `with_star`'s known limitation. Confirmed directly: segment 80's new "No" landed at 236.582s, **inside segment 79's own committed span** (236.41–237.76s).

*Method 2 — joint multi-segment context, to remove the neighbour-bleed confound entirely.* One alignment pass per group (segments 78–82, and 142–146), giving MMS-FA the full correct multi-segment text against the exact audio span those segments jointly occupy — no ambiguity for `with_star` to resolve, since there is no "neighbour" outside the window; the window *is* the neighbours, with their own real transcript. Both previously-unresolved cases **now resolve cleanly**: segment 80's "No" at err +0.019s / conf 0.995 (correctly separated from segment 79's own "No" in "No signal." two words earlier — a real monotonic CTC disambiguation, not a coincidence); segment 144's "Wind." at err +0.038s / conf 0.911.

**Verdict: the hypothesis is CONFIRMED for all 5 of 5 low-confidence rows tested.** Every one resolves to near-zero onset error and near-1.0 confidence once FA is given a window that actually contains the true audio — FA was correctly refusing (low confidence) on the committed, zero-padding window, not producing a confident wrong answer. This is a harness artifact of measuring a forced aligner against a gapless corpus's own (possibly stale, base.en-era) committed boundaries with no padding room, not a genuine MMS-FA timing defect, on these 5 boundaries specifically.

*Recomputed V6 p95, corrected rows spliced into the full 502-pause dataset (`onset_errors` re-scored via `measure-word-onset.py`'s own `score_onset_errors`, completely unmodified — only the 4 affected segments' word tokens were replaced, everything else byte-identical):* median 21.2ms→20.8ms, **p95 476.2ms→442.2ms**, negative-smear 49.0%→48.6%. **The corrected p95 still fails the 250ms gate.** This is expected, not a contradiction of the finding above: p95 over 502 pauses is dominated by rank/count among all 61 raw >250ms failures, and this diagnostic corrected only 4 of those 61 segments. The remaining large errors are concentrated in two clusters this diagnostic did not touch — the already-documented "it." scorer-artifact (recurs 8 times in the raw >250ms list, each individually >250ms in raw terms despite near-zero severity ratio on long segments) and the still-open "~42 high-confidence, large-scorer-margin" cluster (Blocker 2's own text above). **Two independent methods — severity-ratio classification and targeted re-measurement with corrected windowing — now agree**: none of the failures examined by either method is a genuine FA timing defect. The raw p95 *statistic* remains above 250ms because most of its contributing rows are artifacts neither method has individually corrected yet, not because a corrected p95 was computed and still failed on its own merits. Per the same explicit instruction as before, this document does not retune the 250ms threshold on this reasoning — the corrected and uncorrected numbers are both recorded here for the owner to weigh.

**Phase 3 data-cleaning pass (2026-08-05) — four steps, run strictly in order, measurement-only (no Rust/Viterbi/integration/contract-amendment touched, 250ms threshold not retuned).** Full data for every step: `scripts/phase3-data-cleaning.md` documents the three new committed scripts (`measure-forced-alignment-joint-context.py`, `measure-forced-alignment-whisper-text.py`, `extract-full-transcript.py`) and exact invocations.

*Step 1 — the "it." scorer bug, fixed in the measurement script.* `measure-word-onset.py`'s `score_onset_errors` selected "the word following a pause" by testing whether a candidate token's declared MIDPOINT crossed the silence's start — a test that doesn't scale with token duration. For a very short sentence-final word (~60–100ms, e.g. "it."), a few tens of milliseconds of completely ordinary trailing edge-blur is enough to push its own midpoint past a silence's start, misattributing the PRECEDING sentence's last word to the pause that came AFTER it (mirroring, at a shorter token duration, the exact "The" failure mode the midpoint test was originally built to reject — see the function's own docstring). Fixed by adding an overlap gate: a candidate must also reach at least the silence's own midpoint (i.e. cover ≥50% of the detected pause) — "it." (~3% of its 1.35s silence) and the original "The" case (~2% of its silence) both fail this gate exactly as before; the segment-96 "predator" fixture (72% of its silence) still clears it, unchanged. Re-scoring the fixed function against the full V6 `fa2` dataset: 490 of 502 rows are byte-identical (zero regressions); **12 rows change, all improving** — not just the 8 "it."/"It" cases the ratio CSV already flagged (matching the earlier "8, not 4" correction), but 4 more short trailing words sharing the identical mechanism: "hard.", "Yaro", "temporary.", "right." (this last one triggers the existing adjacent-silence dedup rule, correctly collapsing two blips sharing one real following word, 502→501 scored pauses). All 12 flip from large fabricated negative errors (−0.44s to −1.44s) to near-zero (±40ms) attributed to the correct real word — e.g. silence `[65.101, 66.452]`: "it." `[65.067, 65.147]` (46ms/3% overlap, old error −1.385s) → correctly excluded, the silence now resolves to "You" 1.37s later at −0.017s. On 173 only 1 row changes with no effect on median/p95 (a tight-pause corpus rarely triggers this pattern). Corrected data: `docs/phase3-onset-v6-fa-corrected.csv`, `docs/phase3-onset-173-fa-corrected.csv`.

**Consequence for prior classifications**: two cases the Blocker 2 follow-up above treated as genuine low-FA-confidence measurement artifacts were actually THIS scorer bug wearing a different word — segment 61's "hard." (the single highest severity-ratio row in the entire V6 dataset, 1.356) is fixed by Step 1 alone (err −0.597s→−0.002s), not by Method 1/2's wide-window remeasurement as previously believed; same for "Yaro" and "temporary.", never previously flagged as it.-style artifacts at all.

*Step 2 — joint multi-segment context on the remaining ~42 unexplained cases.* Re-deriving the raw >250ms failure list against Step 1's corrected scorer (joining each scored token to the committed segment its start falls inside, same methodology as the original ratio analysis): **61→49 raw failures** (the 12 Step-1 fixes all dropped below threshold). Ran `measure-forced-alignment-joint-context.py` (Method 2 exactly — merged ±2-segment windows, one MMS-FA pass per window giving the full correct multi-segment text, NOT Method 1's flat wide-padding bypass, which the Blocker 2 follow-up above already showed suffers `with_star` neighbour-bleed on segments 144/80) over all 49 targets — 29 merged windows, 634.5s of audio, 139.5s wall-clock. Critically, this re-scored EVERY silence in each window fresh against the (Step-1-fixed) scorer, not merely the originally-flagged word — necessary because a badly-windowed original per-segment alignment can misplace the WRONG word onto a pause in the first place: V6 segment 79/80's "No" case originally scored err=−0.477s because the zero-padded per-segment alignment placed "No" at 237.925s (far from where it's actually spoken, ~236.6s); re-scoring only that mis-placed token's new position would have missed that the pause's real following word is "The" at 238.387s, not "No" at all.

**Result: 9 of 49 resolve cleanly** (near-zero error, high confidence) — confirmed harness artifacts of the zero-padding window: "person"→"No" (−0.873s→+0.012s), "It" (−0.683s→+0.020s), "every" (+0.572s→+0.037s), "Wind." (−0.554s→+0.038s, matching the already-published 144 result), "permanent."→"and" (−0.504s→+0.008s), "No"→"The" (−0.477s→−0.015s), "The" (−0.445s→−0.016s), "Not" (+0.411s→+0.024s), "You" (−0.410s→+0.017s). **40 of 49 remain unresolved** — every one moved by less than 30ms from its original value despite full correct multi-segment context and high FA confidence on both passes (median ≈0.97 both before and after). Per instruction, this is reported as still-failing, not softened: two independent, methodologically distinct alignment strategies (zero-padded single-segment, and joint multi-segment) now agree on the same placement for these 40 words, which is the strongest evidence available in this measurement that they are NOT a windowing/harness artifact. One structural pattern, newly observed and worth recording precisely: **all 40 unresolved errors share the same sign** — FA places the word LATER than silencedetect's declared pause end, by 0.28–2.1s, never earlier — and cluster heavily on sentence-initial pronouns ("You"/"It"/"When"/"They"/"That"/"The"). This is consistent with, but does not confirm, the "real micro-pause/breath structure between a detected `silencedetect` interval and the true next content word" hypothesis this document already flagged as an open question (Blocker 2's own text above) — a uniform-sign, high-confidence, reproducible-under-two-methods discrepancy of this shape is not what a random alignment error would look like, but this measurement cannot distinguish "FA is right and `silencedetect`'s boundary is early" from "FA has some other, harder-to-characterize bias" without independent ground truth (e.g. an ear-listened set), which is out of this pass's scope. Full 49-row table (old error, new error, old confidence, new confidence): `docs/phase3-step2-joint-context-results.csv`. Target set used: `docs/phase3-step2-targets-v6.json`.

*Step 3 — recomputed V6 gate number, Steps 1+2 applied, nothing from Step 4.* Splicing the 9 Step-2-resolved rows into the Step-1-corrected 501-pause dataset:

| | Phase 3 original | Steps 1+2 applied | Gate |
|---|---|---|---|
| Median abs error | 21.2ms | **19.7ms** ✓ | ≤100ms |
| **p95 abs error (PRIMARY)** | 476ms | **338.2ms** ✗ | ≤250ms |
| Negative-smear fraction | 49.0% | 46.9% ✗ | <1% |

**p95 still fails the 250ms gate (338.2ms) — improved from 476ms but not passing.** **40 genuine, unresolved >250ms failures remain** (of the original 61), each confirmed by two independent alignment methods to not be a windowing artifact — see Step 2's uniform-sign observation above for the one available characterization of their shape. Corrected full dataset: `docs/phase3-onset-v6-fa-step1-2-corrected.csv`. Per explicit instruction, the 250ms threshold itself is not retuned by this finding — the corrected number and the remaining-failure count are recorded here for the owner to weigh, same as every other Phase 3 gate reading.

*Step 4 — script-as-ground-truth, a separate arm, not evidence for the Step 3 gate number.* **WER/CER classification (faithful vs. drifted), computed before any FA run**: naive per-token word-level WER is unusable for cross-project comparison — Whisper's `-ml 1` word-level tokenizer still splits some words into sub-word fragments in English (`"41st"`→`"41"`+`"st"`, `"millennium"`→`"millenn"`+`"ium"`, `"don't"`→`"don"`+`"'t"`) and far more aggressively in the Spanish run (`"Scylla"`→`"S"`+`"illa"`), inflating naive WER without reflecting real content mismatch — measured directly: 173 reads 24.8%, Spanish reads 86.3%, both dominated by fragmentation. Substituted character-level CER (lowercased, letters+digits+apostrophe only, tokenization-boundary-agnostic) at the same 5% threshold:

| Project | Script words | Turbo transcript words | Naive WER (unusable) | CER | Classification |
|---|---|---|---|---|---|
| V6 | 3874 | 3989 | 9.9% | **4.4%** | Faithful |
| 173 | 1648 | 1836 | 24.8% | **2.2%** | Faithful |
| Spanish | 249 | 363 | 86.3% | **5.5%** | Faithful (see below) |

Spanish's raw CER sits just over the 5% line; traced directly against a character-level diff (not asserted) rather than waved through: **>65% of the 66-character edit distance is explained by two systematic, non-drift writing-convention patterns** — Whisper consistently transcribes the proper noun "Scylla" as "Silla" (8 occurrences, ~16 chars) and consistently writes spoken number-words "seis"/"tres" as digits "6"/"3" (9 occurrences, ~27 chars) — plus one genuine but minor content gap (the name "Odiseo"/Odysseus dropped once, 6 chars) and a handful of 1-2 char artifacts. None of this reflects the narrator deviating from the script; it reflects Whisper's own transcription/writing conventions for proper nouns and numbers. Classified faithful on this evidence. Full transcript extraction methodology (the Phase 2a CSVs' full token list lives in a second, console-log-dump section past a UI table capped at exactly 1000 rows — reading only the first section silently truncates V6/173's transcripts to 1000 words): `scripts/extract-full-transcript.py`. Table: `docs/phase3-step4-wer-cer.csv`.

**Script-text mode vs. Whisper-text mode, on the faithful subset (V6 + 173 only — Spanish excluded, no persisted per-segment timing backup for it, declined to reconstruct).** "Script-text mode" is what every other Phase 3 measurement already does (`measure-forced-alignment.py` aligns each segment's real script text against its own audio window). "Whisper-text mode" (`measure-forced-alignment-whisper-text.py`, new) instead aligns whichever Whisper turbo tokens fall inside that same time window — FA refining Whisper's own transcript rather than assuming the narrator read the script verbatim; the candidate safe default for genuinely drifted audio, where script-text mode would force FA to place words nobody spoke.

| | V6 script-text | V6 whisper-text | 173 script-text | 173 whisper-text |
|---|---|---|---|---|
| Median abs error | 19.7ms | 118.9ms | 22.3ms | 38.4ms |
| p95 abs error | 338.2ms | 633.8ms | 69.9ms | 520.8ms |
| Negative-smear fraction | 46.9% | 23.7% | 41.8% | 29.5% |
| Zero-duration tokens | 0 | 0 | 0 | 0 |
| Low-confidence (<0.5) words | 2.1% (81/3857) | **13.1% (518/3969)** | 1.7% (28/1648) | **7.7% (142/1834)** |

**On verified-faithful content, script-text mode is substantially more accurate than whisper-text mode on every reading except negative-smear** — median 6.0x/1.7x worse, p95 1.9x/7.5x worse, low-confidence rate 6.2x/4.5x higher, on V6/173 respectively, when driven by Whisper's own transcript instead of the true script. Whisper-text mode also has a structural failure mode script-text mode does not: 3 V6 segments (0-based indices 27/61/302 — segment 27 sits inside the already-documented flash-attention content dropout region, 78.97–88.67s; segment 302, "You rebuild.", is the same segment Step 2 already resolved as a script-mode harness artifact) produced ZERO Whisper words in their time window, so whisper-text mode cannot align them at all — script-text mode succeeds on all of these because it never depends on Whisper having transcribed anything correctly. **This confirms the instructed design**: whisper-text mode should remain the drifted-audio fallback, not become a general default — using it even on content already verified faithful measurably degrades alignment quality. Full data: `docs/phase3-step4-script-vs-whisper.csv`, `docs/phase3-onset-v6-wtext.csv`, `docs/phase3-onset-173-wtext.csv`.

**Blocker 3 — architecture confirmed: (A), forced alignment supplies timing only.** Whisper's transcript and the Hirschberg alignment are **retained unchanged** for matching (which script word maps to which audio position) and skip detection (which segments have no audio match) — FA's only job is producing better word-level timestamps for spans Hirschberg already decided are real. **Part B's Stage 1 output contract (`{text, start, end}` per token) needs no amendment under this architecture** — FA is a drop-in replacement for the timing values behind that same contract shape, not a new pipeline stage or a new field.

**Honest cost, stated plainly, per the owner's explicit instruction not to bury it:** architecture (A) means **both models run on every sync** — Whisper first (transcript + rough timestamps, needed for Hirschberg matching), then FA second (real timestamps for the same audio). This is strictly additive to today's single-pass pipeline: **total sync latency increases, not decreases, versus today.** On top of Whisper turbo's already-measured 834.9s wall-clock and ~2.2 GiB peak RSS on V6 (Phase 2b), FA adds its own full pass over the same audio — see Blocker 2 above for FA's own measured number, the other half of this cost that Phase 2b's brief left unmeasured.

Either way the interface is identical and the pipeline below is untouched.
Your verification: resync both projects. Expect boundaries to move (this phase shifts token indices — fewer timestamp-based malformed drops — so the baseline is re-established: fresh resync → inspector → full forty listen → new `verification-baseline.csv` rows). Listen to the full forty-boundary set. Record the new verdict. Some of the eleven word-shift cases may already resolve here, because the gaps become real. Some of the eight may regress, because the seam exemption was tuned to compensate for smear that no longer exists. Both outcomes are informative and neither blocks the phase — what blocks it is a control boundary regressing, because that means the new timings are worse somewhere we weren’t looking.

### Phase 3b — Language-keyed normalization (moved from old Phase 8 / H.5 — see K1)
The main multilingual work item — full specification in H.5 (per-language number words and reading rules, currency equivalents, the inverted thousands separators, French elision vs. English contraction expansion; every rule additive and language-keyed).
GATE: the English path must be provably byte-identical to today’s, verified against the frozen English baseline — so this phase does NOT shift English indices. Non-English rule verification requires the non-English corpus (K3); if only one non-English project exists by this point, the others’ rules land dormant behind their language keys and are verified when corpus material arrives — recorded as an explicit written acceptance at the Stage 1 lock.

### Phase 3c — Hyphen asymmetry (moved from old Phase 8 — see K1)
textNormalize.ts glues mid-call into one alignment word while Whisper emits two tokens, so neither matches and the segment’s end is understated. Six occurrences on V6, timing impact on one. This rewrites the alignment corpus on both sides and interacts with the deliberate NUMBER_WORDS carve-out, so it’s its own commit with its own re-listen of the set. It shifts English token/word indices — the last index-shifting event of Stage 1, after which baselines are stable for the rest of the programme (K9).

### Phase 3d — Adaptive silence thresholds (conditional; moved from old Phase 8 — see K1)
Replacing the fixed −45dB scan with noise-floor estimation, ONLY if Phase 2b’s measurements show the fixed threshold is costing us (it changes the silence array, which the fence consumes — so under stage locking it is Stage 1 work, not an afterthought). If 2b shows no cost, record that finding here and skip this phase.

**PHASE 2B FINDING — SKIP THIS PHASE (recorded 2026-08-05, per this entry's own instruction).** The fixed −45dB / 0.25s threshold is NOT the binding constraint. Evidence: (a) the pauses it detects are real — spot-verified against a rendered waveform of V6's 14–26s range, where the detected intervals line up with visibly silent stretches between speech bursts; (b) the measured failure is entirely on the TOKEN side — word starts land at the *pause's own start* (median +0.038s from it on V6), meaning the silence detector correctly identified a pause that the timestamp source then absorbed into a word; (c) 173, with the identical threshold, measures a 0.080s median error, so the threshold cannot be what makes V6 read 0.500s. **Reopening trigger:** re-evaluate ONLY if Phase 3's post-forced-alignment measurement shows a silence-side cost (e.g. real pauses going undetected once token timing is trustworthy). Threshold sensitivity was not swept — see Phase 2b's "What this phase did NOT measure."

### STAGE 1 LOCK GATE
- Contract IN and Contract 1→2 (Part J) verified guarantee-by-guarantee by owner inspection.
- Inspector inspected across ≥1 tight-pause and ≥1 long-pause project; smear distribution recorded in Phase 1b’s entry; numeric thresholds met (as finalized by 2b).
- Determinism check passed (Phase 0).
- Non-English corpus status resolved: either H.8’s minimum corpus exists and was exercised, or the specific gap is accepted in writing here with a reason and a reopening trigger.
- No Stage 1 defect deferred downstream (the hyphen asymmetry and threshold questions are closed inside Stage 1 by 3c/3d — that is why they moved).
- Cross-cutting regression checklist (D.-1) run and clean.

**Status as of 2026-08-05: NOT PASSED.** Explicit blocking list, recorded so the next session doesn't re-derive it:
  (a) smear thresholds unmet → needs Phase 3. **Sharpened by Phase 2b (2026-08-05):** the thresholds are now FINALIZED (four of them, see Phase 1b's entry) and the shipped config fails **7 of 8 readings** across the two projects. The blocker is no longer "smear is too high" — it is **"the timing source is of the wrong kind": it emits gapless word spans (93–98% of transitions) and silently deletes words via zero-duration timestamps (68 on V6, 44 on 173).** DTW is eliminated as a remedy (measured zero effect); only forced alignment can clear this;
  (b) ~~no non-English corpus project exists~~ **PARTIALLY RESOLVED 2026-08-04/05** — Spanish corpus project exists, transcribed cleanly on turbo (Phase 2a Step 5), but its boundaries are unlistened; accepted in writing at Phase 2a's entry above, reopens the moment Spanish-specific code ships (Phase 3b). French/Portuguese/German remain completely absent from the corpus — also accepted in writing there, per H.8's dormant-rules allowance;
  (c) ~~3 short-segment-run boundaries not yet in the verification set~~ **RESOLVED 2026-08-04** — 5 added, see Part L;
  (d) Contract IN / 1→2 not yet verified guarantee-by-guarantee;
  (e) cross-cutting regression checklist (D.-1) not yet run;
  (f) **NEW 2026-08-05** — Phase 2a's own gate is unmet: `verification-baseline.csv` carries 69 blank `phase-2a` verdict cells (47 existing boundaries + 22 new sync-log-flagged candidates) awaiting the owner's ear. Phase 2a cannot be marked DONE, and Stage 1 cannot lock, until those verdicts land and the correct-count gate (≥30 of 47, Phase 0's baseline) is checked.

Near-term sequence: Phase 2b is read-only and measurement-exempt from stage ordering, so it can proceed in parallel with the owner's Phase 2a listening pass.

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
Progress reporting breaks at Phase 3. parse_progress_line scrapes the same stdout that -nfa breaks. Accepted, planned: elapsed-time indicator instead of percentage. A 21-minute transcription with no progress bar is a real UX regression, and it only lands if DTW actually wins the Phase 2b measurement. **— MOOT AND PARTLY FALSIFIED (Phase 2b, 2026-08-05): DTW did NOT win (zero measured effect), so this risk does not land via that route at all; and its premise is false anyway — `-nfa` does not break stdout printing on the bundled binary (4,639 clean bracketed lines measured). The stdout coupling itself is real and re-confirmed by source read (`whisper.rs:438`/`:450` both consume the bracketed lines), so a FUTURE change that genuinely moves off stdout still owes a progress-bar answer — but `-nfa` is not such a change.**
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

  H.2 RESOLVED — 2026-08-05. DTW ABANDONED; Phase 3 = forced alignment (H.3).
    The gate was not decided on the median at all. DTW, verifiably enabled
    (stderr `dtw = 1`), changed timestamps by EXACTLY 0.000000000s versus a
    no-DTW control across 4,579 + 2,080 tokens. The reasoning above — that
    turbo's pruned decoder would weaken its DTW relative to large-v3's — is
    superseded by a stronger, model-independent finding: whisper's `-ml 1`
    output is GAPLESS (each token starts where the previous ended), so a pause
    is structurally absorbed into the following word's span and DTW has nothing
    to dispute. This is a property of the emission format, not of any model, so
    the large-v3 DTW comparison this section anticipated could not have
    overturned it. The accuracy-vs-speed product decision this section
    envisioned did NOT need to be made for the timing question. (It remains
    open for the SEPARATE accuracy question — see Phase 2b Finding 3: flash
    attention, not turbo's capacity, is what dropped V6's 9.7s passage.)
    See Phase 2b's RESULTS section for the full measurement.

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

  **H.3 AMENDED — 2026-08-05 (Phase 3, Blocker 1).** Verified against the real
  candidate set: `wav2vec2-large-xlsr-53` (bare) is CONFIRMED pretrain-only —
  no CTC head, cannot forced-align. MMS-FA is CC-BY-NC-4.0 (personal/testing
  use only, not a commercial-ship license). Two commercial candidates for a
  future swap, neither adopted now: jonatasgrosman's per-language Apache-2.0
  wav2vec2-large-xlsr-53 fine-tunes, and nvidia/parakeet-tdt-0.6b-v3
  (Parakeet's CTC-extractability outside NeMo is explicitly UNVERIFIED — its
  TDT decoder is not natively a CTC emission source; not on the critical path
  here, no spike built this phase).
  **Correction to this section's premise:** "language code selects a
  romanization strategy" holds only for MMS-FA (one multilingual CTC head
  over uroman-romanized text) — it is not a general property of forced
  alignment. A jonatasgrosman/Parakeet swap would select a per-language
  model/vocab with no romanization step at all. **The Stage 1 timing-source
  interface is therefore shaped one level more abstract than stated above:
  (language → model, vocab, decode strategy), not (language → romanization
  strategy) alone.** MMS-FA is one point in that space; nothing else about
  this section's guidance changes. Full record: Phase 3's own entry (Part D).

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

H.9 Model size / memory — MEASURED (closed 2026-08-04, Phase 2a Step 2)
  **Superseded the prior UNVERIFIED recall figures below with real measurements.**
  Method: `ls -la` on the downloaded `ggml-large-v3-turbo.bin`, plus one local
  `/usr/bin/time -l` run of the bundled `whisper-x86_64-apple-darwin` sidecar
  against a real corpus WAV (14 Base Segs Project, 32.7s, transcoded to 16kHz
  mono) — both done outside the app, on the same machine used for Phase 0's
  determinism check.

  | Metric | Measured | Prior UNVERIFIED recall |
  |---|---|---|
  | File size on disk | **1,624,555,275 bytes (~1.51 GiB / 1.62 GB decimal)** | ~1.6GB unquantized |
  | whisper.cpp's own self-reported model size | **1623.92 MB** (`whisper_model_load: model size`, matches file size almost exactly — decimal-MB accounting) | — |
  | Peak memory footprint during inference | **2,218,381,312 bytes (~2.07 GiB)** | roughly 2GB resident |
  | Maximum resident set size | **2,275,602,432 bytes (~2.12 GiB)** | roughly 2GB resident |

  The UNVERIFIED recall was accurate to within rounding — both the size and
  memory figures land almost exactly where recalled. This is the UNQUANTIZED
  variant (not the ~574MB q5 recalled as an alternative); no quantized variant
  was downloaded or evaluated.

  **Bundle-vs-download-on-first-use decision: DOWNLOAD-ON-FIRST-USE, recommended,
  not yet built.** `tauri.conf.json`'s `bundle.resources: {"models/*": "models/"}`
  glob-bundles every file in `src-tauri/models/` into the installer today — with
  both `ggml-base.en.bin` (141MB) and the new turbo model (~1.51 GiB) present on
  disk, an unmodified build would ship ~1.65 GiB of model weight alone, before
  ffmpeg (76-101MB) and the rest of the app. This is a real DMG-size problem (was
  a few hundred MB total before this phase). Per this document's own prior
  reasoning (unchanged by the measurement): a ~1.5 GiB single download is a poor
  fit for `bundle.resources`, which has no progress UI, no resumability, and no
  integrity check — a corrupted/truncated bundled file fails silently at
  first-run rather than at build/install time. **Scope note: implementing the
  actual download-on-first-use mechanism (fetch + progress + SHA256 checksum
  verification + storage-path resolution) is NOT part of Phase 2a** — it is a
  distribution-time concern, and Phase 2a's own verification runs against a
  manually-provisioned model file (same as `ggml-base.en.bin` was), matching
  `models/README.md`'s existing re-provisioning-instructions pattern. Recorded
  here as an accepted follow-up, not silently deferred: tracked in
  `project-state.md`'s SaaS Readiness Tasks. Until it lands, a real distribution
  build MUST NOT ship with both models present in `src-tauri/models/` — remove
  `ggml-base.en.bin` from that directory before running `tauri build` for
  distribution (development/testing may keep it; nothing in code references it
  anymore after this phase's `whisper.rs` swap).

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
| A4 | Locks are decided here and only here (single lock-handling site; the lock-toggle UI reuses this same function — K4) — **BUILDS, not carried (K13): today's Stage 1 mint drops `locked` before any lock-handling site runs, so there is nothing for a single site to preserve yet** | Manually-verified at Stage 3 lock (TS cannot prevent a second lock check elsewhere) + the K13 repro (lock two overlapping segments, Apply Sync, verify position AND lock flag both survive) | Divergent lock behaviour (today's five-site risk) **plus today's total lock loss (K13)** | Phase 3 (carry-forward) + Phase 4 (single-site decision) |

Type-level limits: P1 is fully type-enforceable and is the contract's backbone; index validity (P2), ordering (P3), and single-site lock handling (A4) are not expressible in TS — runtime asserts + owner inspection.

### Contract 3 → 4 (Stage 3 → Stage 4: boundaries + derived timeline → finalization)

| # | Producer guarantees (Stage 3) | Enforcement | Failure mode if violated | Phase |
|---|---|---|---|---|
| P1 | One cut per adjacent survivor pair, and every cut lies inside its pair's token gap `[end(A.last), start(B.first)]` — or the pair is flagged degenerate | Runtime-checked (the fence rule IS the check) + log | Word theft — made structurally impossible for non-degenerate pairs | Phase 5 |
| P2 | Contiguity: `duration[i] := boundary[i+1] − boundary[i]` | **Construction-level (arithmetic)** — strongest enforcement in the plan; no post-hoc `if` | Cannot occur | Phase 4 |
| P3 | Boundaries are monotonically non-decreasing (backstop clamp lives here, moved from `applyAnchorBasedTiming` — syncEngine.ts:215-223 at HEAD) | Runtime-checked; every clamp reported to Stage 4 | SILENT DEGRADATION → surfaced by `monotonic-clamp` entry (**REQUIRED ADDITION** — today DEV-console-only, old R9) | Phases 4/7 |
| P4 | Locked segments' startTime/duration are unchanged; every lock-forced adjustment is reported — **BUILDS, not carried (K13): on current HEAD, locking a segment then resyncing resets its position AND clears its lock flag** (owner repro, `docs/verification-baseline.csv`'s locked-segment row) | Runtime-checked in the single lock site + the K13 repro as a Stage 3 lock-gate case | SILENT DEGRADATION → surfaced by `lock-preserved-adjustment` INFO (**REQUIRED ADDITION**) | Phase 3 (carry-forward) + Phases 4/7 (reporting) |
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

**K13 — Lock preservation is not carried behaviour; it does not currently work.** Break: Contract 2→3 A4 and Contract 3→4 P4 (above) were written as if a locked segment's `locked` flag and position simply arrive at Stage 3 intact, needing only a single decision site (A4) and a reported-adjustment guarantee (P4). Owner repro on the 173-seg project (2026-08-04): moved segment 27 to overlap segment 28, locked BOTH, ran Apply Sync — both segments reset to their original unlocked positions AND the lock flag itself was cleared. Root cause traced read-only against HEAD: clean-slate resync's Stage 1 (`parseProjectData`, `App.tsx:318`) mints every segment fresh from a `RawSegment` (`App.tsx:161-172`) that has no `locked` field at all, then constructs the final `VideoSegment` via `{ ...s, id: crypto.randomUUID(), ... }` (`App.tsx:513-528`) — never reading `project.segments` or any prior segment. This is the same clean-slate discipline already documented for `anchorStart`/`anchorSource` (the stableKey merge loop that used to restore fields by matching `assetId` or heading text was deleted in step 3a, commit `452e1eb` — see CLAUDE.md's Anchor-Based Segment Timing section) — except no equivalent merge was ever built for `locked`, so it was never carried even before that deletion made carry-forward-by-id impossible (new segments get fresh `crypto.randomUUID()` ids every run, so an id-keyed restore couldn't work today regardless). Confirmed: none of the five sites that *read* `locked` (`syncEngine.ts:217,232,300`; `snapBoundaries.ts:697,899`; `whisperService.ts:1364,1369,1488`; `syncContracts.ts:295`) ever runs against a segment that could carry `true` into a fresh Apply Sync — they are all checking a flag that is structurally always `undefined` at that point. **Hypothesis confirmed.** Fix: Contract 2→3 A4 and Contract 3→4 P4 above are restated as behaviour Stage 3 must BUILD (a carry-forward step — by script-position/order, not id, since ids churn every run — from the pre-sync `project.segments` into the freshly parsed array, before any of the five lock-consuming sites run), not behaviour that is merely being consolidated into one site. The Stage 3 lock gate (Part D) must verify it with this exact repro: lock two overlapping segments, Apply Sync, confirm both position and lock flag survive. **Changes Contract 2→3 A4 and Contract 3→4 P4's status from "carried" to "built at Phase 3"; adds a mandatory Stage 3 lock-gate test case; no stage-boundary or order change.** Also corrects `docs/sync-pipeline-contract-plan.md:359`'s "Locks are authoritative everywhere" claim (the closest existing statement of this invariant — CLAUDE.md carries no equivalent line to correct) and `project-state.md`'s Deferred Known Bugs, both updated alongside this entry.

**Found sound (attacked, no revision needed):** the Phase 3-before-Phase 5 ordering (segment 96's fixture numbers hold at §D.12/§D.13); Phase 1's redundancy claim (audit §B.4's trace confirmed the gap-fill's output is overwritten on every real path, including the first-segment, locked, and empty-token cases); the coverage-partition move to Stage 2's end; keeping the two duration-floor constants separate (rename, not merge); and the decision to keep `isBreathSilence` through Phase 5 into its own deprecation phase rather than deleting it with the picker.

Part L — Short-Segment Cascade (Phase 0 finding, 2026-08-04)

Owner listening of the two repaired control boundaries in `verification-baseline.csv` (key "lead hunter slows || every person slows" and key "wind || small animals", both V6-447) found something larger than word-shift: a multi-segment cascade, not a single stolen word at one boundary.

**MECHANISM, with the arithmetic.** Segment 144's committed slot is roughly 427.7-428.3s (its script text is "Wind."). `docs/v6-smear-baseline.csv`, row 1179 (the V6 CSV — begins "Level 1 The child who does not yet know what dark means"; the 173-seg CSV, which begins "Some places in the 41st millennium," was checked and does not contain this token): `Wind,427.690,428.110,0.420,0.130,428.300,-0.610`. Whisper timestamps "Wind" at 427.690-428.110. The inspector reports, for that same token, `nearestSilenceEndSec=428.300` and `smearSec=-0.610` — i.e. the detected silence actually ENDS 0.61s after Whisper's claimed word start, so the word is really articulated after 428.300 and segment 144's entire ~0.6s committed slot sits in silence. The word therefore plays under segment 145. Each following segment inherits the displacement until a long segment absorbs it (segment 147, 4.2s duration).

**THE GOVERNING RATIO.** Defect severity ≈ smear / segment duration. A ~0.6s smear annihilates a 0.6s segment and is imperceptible on a 4s one. Both owner-verified cases are dense runs of 1-3 word sub-second segments ("No signal.", "No sound.", "Wind.", "Small animals.", "The fire settling.").

**THE PREDICTOR.** V6's 34.4% and the 173 project's 23.6% negative-smear rates (Phase 1b, recorded above) are now the leading indicator for this defect class, not a curiosity. Roughly one word in three (V6) is timestamped before its real onset.

**CONSEQUENCE FOR PHASE ORDERING.** No boundary rule can repair a span whose tokens are timestamped ~0.6s off. Phase 5's fence makes NEW word theft structurally impossible but cannot recover displacement already baked into the token timestamps. Therefore Phase 3 (timing source upgrade), not Phase 5, is the fix for this class. Phase 5's stated expectation is downgraded from "the eleven word-shift cases should be zero" to: **cases caused by picker over-reach resolve at Phase 5; cases caused by token smear do not and must resolve at Phase 3.** The inspector's per-token smear column is what distinguishes the two, per case.

**NOT A BUG.** The self-correction at the first long segment (segment 147 absorbing the accumulated displacement) is the contiguity invariant (Contract 3→4 P2) behaving correctly. Do not let a future change "fix" it.

**VERIFICATION-SET AMENDMENT (extends Phase 0 / K11).** The forty-boundary verification set must include at least 3 boundaries drawn from short-segment runs (any segment under 1.0s with 3 or fewer words). The current set samples almost none of these, which is why this class was invisible until manual listening. Adding them is an owner listening task, not a docs task — recorded here as a prerequisite of the Stage 1 lock (see the Stage 1 lock blocking list, Part D).

**AMENDMENT — bidirectionality and the governing ratio, confirmed (owner listening, 2026-08-04, pre-Phase-2a).** This section originally described forward displacement only (segment N's audio playing under segment N+1). A second listening pass on V6, recorded in `docs/verification-baseline.csv` under five new `short-segment-run` rows (Phase 0 label, 2026-08-04), extends the finding:

- **The 145-146 and 146-147 boundaries confirm the 144-147 cascade end to end.** Segments 144, 145, and 146 each produce a clean cut whose audio content is the PREVIOUS segment's true words, not its own — three consecutive forward-displaced boundaries, not the single boundary originally sampled. Segment 147 (4.2s) absorbs the backlog and plays correctly, exactly as the contiguity-invariant self-correction already described above predicts.
- **The failure has at least two directions, not one.** At segments 79-80-81 ("No signal." / "No sound." / "The shift moves..."), segment 80's own words ("No sound.") play under the PRECEDING segment (79) — audio arriving early relative to video, the opposite direction from the 144-147 cascade. The boundary picker and the smear mechanism are not direction-locked; a segment can lose its audio to either neighbour depending on which side the timestamp error falls on.
- **The 80-81 boundary shows the two defect classes can sit adjacent to each other.** Unlike every other boundary in this set, the cut at 80-81 is not clean — a word lands mid-boundary, chopped. That is the picker-over-reach signature (Part A), not the smear signature (clean cut, wrong content) seen at every other boundary in this run. The two classes are not mutually exclusive within one short-segment run, which is a reason Phase 5 (fence) and Phase 3 (timing upgrade) are both necessary and neither alone is sufficient here.
- **The sleep-vs-no-sound pair isolates the governing signal.** Segment 134 ("sleep.") and segment 80 ("No sound.") are both ~0.8s, both 1-3 words, both drawn from the same voice and project — and one is correct while the other is badly displaced. Duration alone does not predict failure. This confirms the governing ratio stated above (defect severity ≈ smear / segment duration): segment 134 happens to sit in a low-smear region of the timeline, segment 80 does not. The inspector's per-token smear column, not segment duration, is the reliable predictor.

These five boundaries give the short-segment-run category 6 total members in the verification set (144-145, 145-146, 146-147, 79-80, 80-81, plus the 134-135 control), satisfying the ≥3 requirement above with margin and covering both directions plus both defect signatures. This is a pre-swap (Phase 0) baseline — comparison after Phase 2a's model swap requires these same script-word keys to be re-listened and appended under the `phase-2a` label, per the standard baseline re-establishment procedure (K9).

**RE-OPENS.** This finding partially contradicts `docs/boundary-drift-investigation.md`'s conclusion that the defect was "localized to the boundary picker" and that "the aligner is exonerated." The aligner's SPANS may still be correct while the TIMESTAMPS those spans point at are not — both statements can hold. A pointer to this Part is added at that document's conclusion so nobody re-derives the picker-only conclusion.

---

> Bug & task tracking lives in `project-state.md`. `docs/sync-pipeline-contract-plan.md` remains the authority on the OLD pipeline's assumption tables and the R1-R14 register text; Part J owns their v2 mapping. `docs/verification-baseline.csv` (created at Phase 0) is the programme's verdict record.
