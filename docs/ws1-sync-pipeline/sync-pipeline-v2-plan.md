Status: Accepted architecture — pending implementation
Date: 2026-08-03 (Revision 2, same day — stage contracts, stage locking, Stage 1 observability, Russian descope, adversarial audit; see Part K)
Verified-against-HEAD: 124ad3dd34a580cbfc0fb34b34d5c058338296d2
Live status: see `docs/work-in-progress.md`'s "WS1 — Sync Pipeline Rewrite" section (§1–§11)
for Task 5 (Phase 3) granular status, updated per-slice — this document remains
design-of-record only (stages, phases, contracts, risk register); if the two ever disagree,
`work-in-progress.md` is newer and wins (see this document's own Part M). `project-state.md`'s
Next Action section tracks the rolling top-3 cross-workstream task queue.
**K13 correction (2026-08-11): CLOSED.** This document's Part K finding and every other K13 reference below describe the pre-fix defect, its discovery, and the original plan to fix it inside Stage 3 — that plan was superseded. K13 was fixed as an independent task directly against `main` (owner ruling R-C), not via the Stage 3 restructure this document describes; the restructure itself remains not-started. Current status/registry: `project-state.md` §4/§5, `docs/work-in-progress.md` §3 task 8 (`ws1-master-roadmap.md` §5, the original source, was deleted 2026-08-14, `9cf5867`; retrieve: `git show 251be64:docs/ws1-sync-pipeline/ws1-master-roadmap.md`). Read every present-tense "K13 is open" / "C11 must keep failing" statement below as historical, not current.

## Phase Status

Phases are grouped under the stage they build (Part D). A stage's phases may not begin until every earlier stage is LOCKED, with two stated exemptions (Part D's ordering rule): proven behaviour-neutral deletions/moves, and read-only measurement.

| Phase | Stage | Description | Status | Verified by | Date |
|---|---|---|---|---|---|
| 0 | Programme | Safety and instruments (corpus verification, determinism check, script-word-keyed verification set, baseline CSV) | DONE | Owner | 2026-08-04 |
| 1 | Stage 2 (neutrality-exempt; runs first) | Delete the duplicated gap-fill in `alignScenestoTranscript` | DONE | Owner | 2026-08-04 |
| 1b | Stage 1 | Transcript Inspector — dev-only, in-app; BLOCKING Stage 1 deliverable | DONE | Owner inspection — `window.__transcriptInspector()` run in-app on V6 (447-seg) and 173-seg, output captured to `docs/ws1-sync-pipeline/measurements/v6-smear-baseline.csv` / `docs/ws1-sync-pipeline/measurements/173-smear-baseline.csv` | 2026-08-04 |
| 2a | Stage 1 | Model swap — multilingual model, `-l auto`, per-project language override | **DONE** — gate passed: Phase 0 30/47 → phase-2a 38/44 verified (correct 38, word-shifted 5, FAIL 1; 2 N/A + 1 unverified named, not counted against the gate) | Owner ear-listening pass, `verification-baseline.csv` | 2026-08-05 |
| 2b | Stage 1 | Measure timing sources on the production model (turbo raw / turbo+DTW / large-v3 reference) — committed script | **DONE** — **DTW ABANDONED**: measured to change timestamps by exactly 0.000000000s vs a no-DTW control, on 4,579 + 2,080 tokens. Phase 3 = forced alignment. Script committed at `scripts/measure-word-onset.py` | Measurement (read-only; no owner listening required by this phase's own terms) | 2026-08-05 |
| 3 | Stage 1 | Upgrade the timing source — **forced alignment** (decided by 2b; DTW eliminated) | **STALE, describes this row's 2026-08-07 pre-Task-5 state — see Part M.** Original text, left as the historical readiness record: "IMPLEMENTATION-READY, not started. Blockers 1/2/3 CLOSED; all three Rust gates closed (Spanish accuracy — Step U, reference bias, corrected p95 50.4ms vs the approved 250ms gate; structural checks — Steps W/X, 12 in / C10 out by name; heading assignment — owner decision 8, Option A). Pre-implementation baseline (Steps M-P) captured, restored and proven faithful at Step Y; readiness statement at Step Z. Integration not started." **Current status (2026-08-15, Part M / `docs/work-in-progress.md` §3–§5, §11 item 1): ALIGNER COMPLETE, dev-only — Slices D1–D25 shipped (D7 cancelled as scoped), behind the `fa-inference` feature flag, zero production callers. The remaining work — the capability-gated production-wiring slice — is BLOCKED ON 3C BY DECISION (Option B, 2026-08-15): the gate stays off through Phase 3b/3c and flips once, after 3c lands. Not "not started"; not "in progress" either — what's left is sequencing-blocked by owner decision, not incomplete implementation.** | Owner ear-listening (Step U, 10 Spanish clips); measurement (`scripts/measure-forced-alignment.py`, `scripts/phase4-step-u-score-spanish.py`); structural-check harness (`scripts/phase4-step-x-verify.py`); golden-baseline replay (`scripts/phase4-handoff-replay-sync.test.ts`, per-boundary diff, 0 divergence) | 2026-08-07 |
| 3b | Stage 1 | Language-keyed normalization (moved here from old Phase 8 / H.5 — Part K, K1) | **IN PROGRESS, NOT COMPLETE** — Owner: project owner (assigned 2026-08-15, execution order 3b → 3c → Phase 3 production wiring → Stage 1 lock; the remaining sub-item below inherits this same assignment, it is not separately unowned). Rule 1 (French elision) DONE (Slice 2); Rule 2 (Spanish cardinals 0-30, 31+ PERMANENTLY out of scope under the multi-word-output decision (b)) DONE (Slice 3); Rule 3 (German cardinals 0-30, no structural wall but scope-capped to mirror Rule 2) DONE (remainder audit, 2026-08-15); Rule 4 (Portuguese cardinals 0-20 and 30, PT-BR spelling per owner decision 2026-08-15 — `docs/work-in-progress.md` §7 item 6, RESOLVED) DONE (remainder audit follow-up, 2026-08-15) — Portuguese 21-29 PERMANENTLY excluded, same three-word wall as Spanish 31+ ("vinte e X"), discovered during Rule 4's own implementation, not part of the original scoping; currency and thousands-separator expansion (in `faTextNormalize.ts`) audited and found PERMANENTLY blocked by decision (b) — every case needs multi-word output. **Still open:** French cardinal expansion beyond Rule 1 (blocked on its own irregular "et"-exception design, not a flat lookup like Rule 2/3/4 — not attempted this pass). **Reassigned OUT of Phase 3b, 2026-08-15 (code evidence, not assumption):** the pre-existing Task 5 prerequisite (`textNormalize.ts`'s ASCII-only fold destroying native diacritics) and `textNormalize.ts`'s thousands-separator MANGLING bug both moved to Phase 3c below — traced through `faChunkPlan.ts` and confirmed neither reaches the FA model's input text (`chunk.text` is raw, never routed through `canonicalize` — `faChunkPlan.ts:360-371,628`); both only affect `qi` word-count bookkeeping via `canonicalize`, which is `textNormalize.ts` territory, not `faTextNormalize.ts`'s. See Phase 3c's own entry below and `docs/work-in-progress.md`'s changelog for the full evidence trail. See H.5's decision block and `docs/work-in-progress.md`'s changelog for the full per-rule classification table. | `src/services/faTextNormalize.test.ts` + `src-tauri/src/fa/text.rs` fixture-parity gate (French elision + Spanish/German/Portuguese cardinals) | 2026-08-15 |
| 3c | Stage 1 | Hyphen asymmetry fix (moved here from old Phase 8 — Part K, K1) | NOT STARTED — Owner: project owner (assigned 2026-08-15, execution order 3b → 3c → Phase 3 production wiring → Stage 1 lock) | — | — |
| 3d | Stage 1 | Adaptive silence thresholds (conditional on 2b evidence; moved from old Phase 8 — Part K, K1) | **SKIPPED** | — | — |
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
| `Projects Backend Data` | `voiceover.m4a` (byte-identical to 173’s), `voiceover (1).m4a` (byte-identical to V6’s) | 17.2 / 32.9 MB | 709.0s / 1421.3s | — | — | English | — | **Phase 0’s backups already exist here**: `project.json` = 173 segments / 1973 transcript tokens, `project (1).json` = 447 segments / 4517 tokens — both matching the counts in `boundary-drift-investigation.md` (deleted 2026-08-14, `9cf5867`; retrieve: `git show 251be64:docs/ws1-sync-pipeline/boundary-drift-investigation.md`; conclusion folded into `docs/work-in-progress.md` §3/§12 row 17), both carrying `transcriptTokens` (i.e. the frozen transcripts), plus `v6-segments.json` / `v6-segments-full.json` |

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
- **Backups: counts confirmed** — 173-seg (173 segments / 1973 transcript tokens), V6 (447 segments / 4517 transcript tokens), matching `boundary-drift-investigation.md` (deleted 2026-08-14, `9cf5867`; retrieve: `git show 251be64:docs/ws1-sync-pipeline/boundary-drift-investigation.md`). `lastTranscribedFileIdentity` was missing from both JSON backups (restoring either would have triggered re-transcription and destroyed the frozen transcript); patched with the owner-extracted live values — `VO2.m4a|17151452|1784183884000` (173-seg) and `6.m4a|32851696|1785461360000` (V6) — and written alongside the originals as `project.backup2.json` / `project (1).backup2.json` in `All Projects Test Data/Projects Backend Data/`. The 173 project's audio is named `VO2.m4a` in-app while the corpus file is `voiceover.m4a` on disk — expected, since identity is `name|size|lastModified` as staged, not the corpus filename; not "corrected."
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

**Provenance, verified against git history (2026-08-05, Phase 3 reference-validity pass — not inferred, confirmed by `git log -S`):** all four thresholds (100ms median, 250ms p95, <1% negative-smear, the segment-96-pathology framing) were first written in commit `c522248` ("docs: v2 plan — stage contracts, stage locking, Stage 1 observability, RU descope, adversarial audit"), in the section that became Phase 1b's "Explicit gate" paragraph, explicitly labeled there **"provisional until Phase 2b measures it."** At that commit, the same file's own phase-status table lists Phase 1b and Phase 2b as **NOT STARTED** — i.e. these numbers were an author judgment call made before any measurement existed on this codebase, not a fit to an observed distribution. The reference METHOD they describe (ffmpeg `silencedetect` ground truth vs. a word's declared start) is older still and traces to "the original investigation" that produced the ~190ms-average/900ms-max figure cited earlier in Part C — that harness lived in `/tmp` and is confirmed unrecoverable (K8; `docs/audit-verification-2026-08-03.md` §C.7, `git fsck --dangling` checked, nothing recovered). **Correction to a plausible misreading:** the gate was never "set against Whisper timestamps rather than silencedetect" as two different reference systems — `silencedetect` has been the sole reference throughout every phase (the original investigation, Phase 1b's inspector, Phase 2b, Phase 3); what has changed phase to phase is only the CANDIDATE measured against that fixed reference (Whisper base.en → turbo → turbo+DTW → now MMS-FA). So this session's reference-validity question — is `silencedetect` itself biased? — has never been asked by any prior phase, because every prior phase treated it as ground truth by construction, not because it was cross-checked against something else and confirmed. See the new "Reference-validity pass" entry immediately below Step 4 for that question, asked directly for the first time.

**Current standing against the finalized gate (shipped config (a), turbo raw):**

| | V6 (long-pause) | 173 (tight-pause) | Gate |
|---|---|---|---|
| Median | 0.500s ✗ | 0.080s ✓ | ≤0.100s |
| **p95** | **1.283s ✗** | **0.497s ✗** | **≤0.250s** |
| Negative-smear | 97.4% ✗ | 68.0% ✗ | <1% |
| Zero-dur words | 68 ✗ | 44 ✗ | 0 |

**7 of 8 readings fail; the single pass (173's median) is precisely the reading demoted above for being non-discriminating.** Stage 1's smear blocker (item (a) on the lock list) is unchanged in substance and now has a sharper statement: it is not "smear is too high," it is **"the timing source is of the wrong kind — it emits gapless spans and deletes words."**

**Measured baseline (recorded 2026-08-04, current bundled model — `base.en`, no DTW, pre-Phase-2a).** `window.__transcriptInspector()` run in-app against the persisted `transcriptTokens` and a fresh Web-Audio silence scan of the voiceover blob, for both corpus projects named in D.0. Full per-token output: `docs/ws1-sync-pipeline/measurements/v6-smear-baseline.csv` (V6, 447-seg, long-pause), `docs/ws1-sync-pipeline/measurements/173-smear-baseline.csv` (173-seg, presumed tight-pause). Every number below was independently recomputed from the raw CSV rows and matches the console-printed aggregate line exactly (data integrity cross-check); the kept/dropped token split also reconciles exactly against D.0’s own corpus-inventory counts (4517 and 1973 raw transcript tokens).

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

**Instrument validation (recorded at closure, 2026-08-04).** The inspector was validated against known ground truth: `docs/ws1-sync-pipeline/measurements/v6-smear-baseline.csv` row 807 reads `predator,289.260,289.800,0.540,0.000,289.960,-0.700`, reproducing the committed `c593f1d` seg-96 fixture (silence `[289.380, 289.960]`, token "predator" `[289.260, 289.800]`) exactly. This is the instrument's correctness check — it is what makes every other number the inspector produced trustworthy. Known limitation (already noted above, restated for emphasis): for a token whose nearest silence starts AFTER the token ends (e.g. "A" at 289.200-289.260, row 806, which matches an older silence at 287.860 and reports `+1.340`), the positive tail is inflated. This affects median/p95 but NOT the negative-smear count, which is the reading **Part L** depends on.

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

**Step 1 finding — a genuine content dropout, not a timing artifact (V6, 78.97–88.67s).** The turbo inspector CSV shows four tokens — `You` (78.97–80.57, 1.60s), `start` (80.57–83.05, 2.48s), `watching` (83.05–87.12, 4.07s), `the` (87.12–88.67, 1.55s) — spanning 9.7 seconds, an order of magnitude longer than any real spoken word in this narration (compare the immediately following `older`/`hunters`/`differently`, each 0.24–0.36s). The base.en CSV covering the identical span (`docs/ws1-sync-pipeline/measurements/v6-smear-baseline.csv`, rows 216–240) reads, verbatim, token-by-token:

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

**Step 8 — missing regression row added, not backfilled to Phase 0.** `They're the worst` (173-seg, segment 5–6 boundary) was never in the original 47-boundary verification set — it slipped through Phase 0's sampling entirely, which is why its regression went unnoticed until this pass. Added as a new `phase-2a`-only row in `verification-baseline.csv` (case_type `seam-exemption`, verdict word-shifted), noting it was correct pre-swap per the `c593f1d` fixture record and that it is the exact fixture the curr-side seam exemption was permanently disabled over (`snapBoundaries.ts`'s own doc comment, `boundary-drift-investigation.md` — deleted 2026-08-14, `9cf5867`; retrieve: `git show 251be64:docs/ws1-sync-pipeline/boundary-drift-investigation.md` — and CLAUDE.md's entry all cite it). Per K9's append-only baseline discipline, **no Phase 0 row was created for it** — it was never verified at Phase 0, so there is nothing to backfill.

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

Four places state, as established fact, that `-nfa` breaks whisper-cli's stdout printing: Part C above ("in this build broke stdout printing"), Part E's progress-reporting row, `boundary-drift-investigation.md`'s DO NOT RE-INVESTIGATE list (deleted 2026-08-14, `9cf5867`; retrieve: `git show 251be64:docs/ws1-sync-pipeline/boundary-drift-investigation.md`), and `whisper.rs`'s own in-code comment.

**This is false on the currently bundled binary.** Config (e) ran `-nfa` with NO `-oj`, parsed from stdout exactly as `whisper.rs` does, and produced **4,639 well-formed bracketed lines → 4,579 tokens** with no loss.

Consequence: the Phase 3 cost estimate that flowed from it ("JSON output is new code, not a flag flip, and the progress bar becomes an elapsed-time indicator") **was never actually required by `-nfa`.** This is moot for the DTW decision — DTW lost on its own zero-effect evidence, not on implementation cost — but the claim is corrected here, in `boundary-drift-investigation.md` (deleted 2026-08-14, `9cf5867`; retrieve: `git show 251be64:docs/ws1-sync-pipeline/boundary-drift-investigation.md`), and in `whisper.rs`'s comment, so no future phase budgets work against a false premise. The stdout/JSON coupling in `whisper.rs` is real and was re-confirmed by direct source read (`parse_stdout_tokens` at `whisper.rs:450` and `parse_progress_line` at `whisper.rs:438` both consume the same bracketed lines); what is false is that `-nfa` forces a move off that path.

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

**Reading the comparison.** Median and p95 both pass their gates for both models, and the two models sit within 5–20ms of each other — noise-level on this project, not a material accuracy gap. Negative-smear fails identically on both, for the same reason already established for MMS-FA (Blocker 2's own finding above): the metric was built to discriminate gapless-vs-non-gapless sources, and both of these are genuinely non-gapless — it does not discriminate ordinary small alignment noise the way it was designed to once errors are small. Zero zero-duration tokens on both — clean pass. jonatasgrosman is **~28% slower** wall-clock but uses **~20% less peak RSS** (a smaller, monolingual model with no romanizer/multilingual-vocab overhead). Full per-word CSV: `docs/measurements/phase3-onset-173-hf.csv` (compare against `docs/phase3-onset-173-fa.csv`).

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

*Ratio analysis — Part L's governing relation, applied to every V6 failure (the task set for this session).* Every V6 scored pause with `|onset_error| > 250ms` (61 of 502; one segment, order 320, failed to align entirely — see below) joined to the committed segment its word-start timestamp falls inside (`v6-segments-full.json` — the most recent full per-segment duration snapshot that exists; base.en-era, pre-Phase-2a, since no turbo-era equivalent was ever exported — affects only how exactly "committed duration" matches today's HEAD, not the onset errors themselves, which never read segment timing). Full 61-row table, including each row's own FA confidence score: `docs/measurements/phase3-onset-v6-fa-ratio.csv`.

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

**Blocker 2 follow-up — harness-artifact hypothesis, tested and CONFIRMED (2026-08-05).** Task: separate "the window handed to FA didn't contain the true audio, so FA is correctly refusing" from a genuine FA timing defect, for the 6 V6 rows at ratio>0.5. Corrected identification of the 6 rows (the ratio CSV's own `is_it_scorer_artifact` flag, checked directly rather than trusting the earlier prose summary of "3 are it-artifact / 3 are low-confidence"): only **1** row (segment 171, "it.") is the it-scorer artifact; the other **5** rows (segment 61 × 2 words "Not"/"hard.", segment 144 "Wind.", segment 80 "No", segment 303 "You") are the low-FA-confidence (0.006–0.053) cases. This is a factual correction to the earlier summary's count, not a re-derivation of the underlying data — the CSV itself (`docs/measurements/phase3-onset-v6-fa-ratio.csv`) was unchanged and correct throughout.

*Method 1 — widen `pad_sec` to 1.5s and bypass the neighbour-midpoint clamp (`floor_bound=0.0`, `ceil_bound=audio_duration_sec`) for exactly these 5 rows' segments, reusing `align_segment()` from the committed `measure-forced-alignment.py` unchanged as a library call (not a script/default edit — the committed script's own `--pad-sec 3.0` default and clamp behaviour are untouched).* Result: **3 of 5 resolve cleanly** — segment 61's "Not" (err +0.411s→+0.017s, conf 0.048→1.00), segment 61's "hard." (err −0.597s→−0.002s, conf 0.036→1.00), and segment 303's "You" (err −0.410s→−0.005s, conf 0.041→0.99) all land within milliseconds of a real detected silence at near-1.0 confidence once given room to look. **2 of 5 got WORSE, not better** — segment 144's "Wind." (err −0.554s→−2.095s) and segment 80's "No" (err −0.477s, reattaching to a different silence entirely once unclamped) — despite confidence rising (144: 0.053→0.779). Root-caused, not left as a puzzle: both segments sit in perfectly gapless back-to-back short-segment runs (143/144/145 and 79/80/81) where the neighbour-midpoint clamp for a single-segment window is **already identical to the segment's own committed boundary** — there is zero legal room to widen without reaching into a neighbour's real speech. Bypassing the clamp for these two didn't find room to look further, it let `with_star` reach into an adjacent segment's real content and misattribute it — exactly the neighbour-bleed failure mode `measure-forced-alignment.md` already documents as `with_star`'s known limitation. Confirmed directly: segment 80's new "No" landed at 236.582s, **inside segment 79's own committed span** (236.41–237.76s).

*Method 2 — joint multi-segment context, to remove the neighbour-bleed confound entirely.* One alignment pass per group (segments 78–82, and 142–146), giving MMS-FA the full correct multi-segment text against the exact audio span those segments jointly occupy — no ambiguity for `with_star` to resolve, since there is no "neighbour" outside the window; the window *is* the neighbours, with their own real transcript. Both previously-unresolved cases **now resolve cleanly**: segment 80's "No" at err +0.019s / conf 0.995 (correctly separated from segment 79's own "No" in "No signal." two words earlier — a real monotonic CTC disambiguation, not a coincidence); segment 144's "Wind." at err +0.038s / conf 0.911.

**Verdict: the hypothesis is CONFIRMED for all 5 of 5 low-confidence rows tested.** Every one resolves to near-zero onset error and near-1.0 confidence once FA is given a window that actually contains the true audio — FA was correctly refusing (low confidence) on the committed, zero-padding window, not producing a confident wrong answer. This is a harness artifact of measuring a forced aligner against a gapless corpus's own (possibly stale, base.en-era) committed boundaries with no padding room, not a genuine MMS-FA timing defect, on these 5 boundaries specifically.

*Recomputed V6 p95, corrected rows spliced into the full 502-pause dataset (`onset_errors` re-scored via `measure-word-onset.py`'s own `score_onset_errors`, completely unmodified — only the 4 affected segments' word tokens were replaced, everything else byte-identical):* median 21.2ms→20.8ms, **p95 476.2ms→442.2ms**, negative-smear 49.0%→48.6%. **The corrected p95 still fails the 250ms gate.** This is expected, not a contradiction of the finding above: p95 over 502 pauses is dominated by rank/count among all 61 raw >250ms failures, and this diagnostic corrected only 4 of those 61 segments. The remaining large errors are concentrated in two clusters this diagnostic did not touch — the already-documented "it." scorer-artifact (recurs 8 times in the raw >250ms list, each individually >250ms in raw terms despite near-zero severity ratio on long segments) and the still-open "~42 high-confidence, large-scorer-margin" cluster (Blocker 2's own text above). **Two independent methods — severity-ratio classification and targeted re-measurement with corrected windowing — now agree**: none of the failures examined by either method is a genuine FA timing defect. The raw p95 *statistic* remains above 250ms because most of its contributing rows are artifacts neither method has individually corrected yet, not because a corrected p95 was computed and still failed on its own merits. Per the same explicit instruction as before, this document does not retune the 250ms threshold on this reasoning — the corrected and uncorrected numbers are both recorded here for the owner to weigh.

**Phase 3 data-cleaning pass (2026-08-05) — four steps, run strictly in order, measurement-only (no Rust/Viterbi/integration/contract-amendment touched, 250ms threshold not retuned).** Full data for every step: `scripts/phase3-data-cleaning.md` documents the three new committed scripts (`measure-forced-alignment-joint-context.py`, `measure-forced-alignment-whisper-text.py`, `extract-full-transcript.py`) and exact invocations.

*Step 1 — the "it." scorer bug, fixed in the measurement script.* `measure-word-onset.py`'s `score_onset_errors` selected "the word following a pause" by testing whether a candidate token's declared MIDPOINT crossed the silence's start — a test that doesn't scale with token duration. For a very short sentence-final word (~60–100ms, e.g. "it."), a few tens of milliseconds of completely ordinary trailing edge-blur is enough to push its own midpoint past a silence's start, misattributing the PRECEDING sentence's last word to the pause that came AFTER it (mirroring, at a shorter token duration, the exact "The" failure mode the midpoint test was originally built to reject — see the function's own docstring). Fixed by adding an overlap gate: a candidate must also reach at least the silence's own midpoint (i.e. cover ≥50% of the detected pause) — "it." (~3% of its 1.35s silence) and the original "The" case (~2% of its silence) both fail this gate exactly as before; the segment-96 "predator" fixture (72% of its silence) still clears it, unchanged. Re-scoring the fixed function against the full V6 `fa2` dataset: 490 of 502 rows are byte-identical (zero regressions); **12 rows change, all improving** — not just the 8 "it."/"It" cases the ratio CSV already flagged (matching the earlier "8, not 4" correction), but 4 more short trailing words sharing the identical mechanism: "hard.", "Yaro", "temporary.", "right." (this last one triggers the existing adjacent-silence dedup rule, correctly collapsing two blips sharing one real following word, 502→501 scored pauses). All 12 flip from large fabricated negative errors (−0.44s to −1.44s) to near-zero (±40ms) attributed to the correct real word — e.g. silence `[65.101, 66.452]`: "it." `[65.067, 65.147]` (46ms/3% overlap, old error −1.385s) → correctly excluded, the silence now resolves to "You" 1.37s later at −0.017s. On 173 only 1 row changes with no effect on median/p95 (a tight-pause corpus rarely triggers this pattern). Corrected data: `docs/phase3-onset-v6-fa-corrected.csv`, `docs/phase3-onset-173-fa-corrected.csv`.

**Consequence for prior classifications**: two cases the Blocker 2 follow-up above treated as genuine low-FA-confidence measurement artifacts were actually THIS scorer bug wearing a different word — segment 61's "hard." (the single highest severity-ratio row in the entire V6 dataset, 1.356) is fixed by Step 1 alone (err −0.597s→−0.002s), not by Method 1/2's wide-window remeasurement as previously believed; same for "Yaro" and "temporary.", never previously flagged as it.-style artifacts at all.

*Step 2 — joint multi-segment context on the remaining ~42 unexplained cases.* Re-deriving the raw >250ms failure list against Step 1's corrected scorer (joining each scored token to the committed segment its start falls inside, same methodology as the original ratio analysis): **61→49 raw failures** (the 12 Step-1 fixes all dropped below threshold). Ran `measure-forced-alignment-joint-context.py` (Method 2 exactly — merged ±2-segment windows, one MMS-FA pass per window giving the full correct multi-segment text, NOT Method 1's flat wide-padding bypass, which the Blocker 2 follow-up above already showed suffers `with_star` neighbour-bleed on segments 144/80) over all 49 targets — 29 merged windows, 634.5s of audio, 139.5s wall-clock. Critically, this re-scored EVERY silence in each window fresh against the (Step-1-fixed) scorer, not merely the originally-flagged word — necessary because a badly-windowed original per-segment alignment can misplace the WRONG word onto a pause in the first place: V6 segment 79/80's "No" case originally scored err=−0.477s because the zero-padded per-segment alignment placed "No" at 237.925s (far from where it's actually spoken, ~236.6s); re-scoring only that mis-placed token's new position would have missed that the pause's real following word is "The" at 238.387s, not "No" at all.

**Result: 9 of 49 resolve cleanly** (near-zero error, high confidence) — confirmed harness artifacts of the zero-padding window: "person"→"No" (−0.873s→+0.012s), "It" (−0.683s→+0.020s), "every" (+0.572s→+0.037s), "Wind." (−0.554s→+0.038s, matching the already-published 144 result), "permanent."→"and" (−0.504s→+0.008s), "No"→"The" (−0.477s→−0.015s), "The" (−0.445s→−0.016s), "Not" (+0.411s→+0.024s), "You" (−0.410s→+0.017s). **40 of 49 remain unresolved** — every one moved by less than 30ms from its original value despite full correct multi-segment context and high FA confidence on both passes (median ≈0.97 both before and after). Per instruction, this is reported as still-failing, not softened: two independent, methodologically distinct alignment strategies (zero-padded single-segment, and joint multi-segment) now agree on the same placement for these 40 words, which is the strongest evidence available in this measurement that they are NOT a windowing/harness artifact. One structural pattern, newly observed and worth recording precisely: **all 40 unresolved errors share the same sign** — FA places the word LATER than silencedetect's declared pause end, by 0.28–2.1s, never earlier — and cluster heavily on sentence-initial pronouns ("You"/"It"/"When"/"They"/"That"/"The"). This is consistent with, but does not confirm, the "real micro-pause/breath structure between a detected `silencedetect` interval and the true next content word" hypothesis this document already flagged as an open question (Blocker 2's own text above) — a uniform-sign, high-confidence, reproducible-under-two-methods discrepancy of this shape is not what a random alignment error would look like, but this measurement cannot distinguish "FA is right and `silencedetect`'s boundary is early" from "FA has some other, harder-to-characterize bias" without independent ground truth (e.g. an ear-listened set), which is out of this pass's scope. Full 49-row table (old error, new error, old confidence, new confidence): `docs/measurements/phase3-step2-joint-context-results.csv`. Target set used: `docs/measurements/phase3-step2-targets-v6.json`.

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

Spanish's raw CER sits just over the 5% line; traced directly against a character-level diff (not asserted) rather than waved through: **>65% of the 66-character edit distance is explained by two systematic, non-drift writing-convention patterns** — Whisper consistently transcribes the proper noun "Scylla" as "Silla" (8 occurrences, ~16 chars) and consistently writes spoken number-words "seis"/"tres" as digits "6"/"3" (9 occurrences, ~27 chars) — plus one genuine but minor content gap (the name "Odiseo"/Odysseus dropped once, 6 chars) and a handful of 1-2 char artifacts. None of this reflects the narrator deviating from the script; it reflects Whisper's own transcription/writing conventions for proper nouns and numbers. Classified faithful on this evidence. Full transcript extraction methodology (the Phase 2a CSVs' full token list lives in a second, console-log-dump section past a UI table capped at exactly 1000 rows — reading only the first section silently truncates V6/173's transcripts to 1000 words): `scripts/extract-full-transcript.py`. Table: `docs/measurements/phase3-step4-wer-cer.csv`.

**Script-text mode vs. Whisper-text mode, on the faithful subset (V6 + 173 only — Spanish excluded, no persisted per-segment timing backup for it, declined to reconstruct).** "Script-text mode" is what every other Phase 3 measurement already does (`measure-forced-alignment.py` aligns each segment's real script text against its own audio window). "Whisper-text mode" (`measure-forced-alignment-whisper-text.py`, new) instead aligns whichever Whisper turbo tokens fall inside that same time window — FA refining Whisper's own transcript rather than assuming the narrator read the script verbatim; the candidate safe default for genuinely drifted audio, where script-text mode would force FA to place words nobody spoke.

| | V6 script-text | V6 whisper-text | 173 script-text | 173 whisper-text |
|---|---|---|---|---|
| Median abs error | 19.7ms | 118.9ms | 22.3ms | 38.4ms |
| p95 abs error | 338.2ms | 633.8ms | 69.9ms | 520.8ms |
| Negative-smear fraction | 46.9% | 23.7% | 41.8% | 29.5% |
| Zero-duration tokens | 0 | 0 | 0 | 0 |
| Low-confidence (<0.5) words | 2.1% (81/3857) | **13.1% (518/3969)** | 1.7% (28/1648) | **7.7% (142/1834)** |

**On verified-faithful content, script-text mode is substantially more accurate than whisper-text mode on every reading except negative-smear** — median 6.0x/1.7x worse, p95 1.9x/7.5x worse, low-confidence rate 6.2x/4.5x higher, on V6/173 respectively, when driven by Whisper's own transcript instead of the true script. Whisper-text mode also has a structural failure mode script-text mode does not: 3 V6 segments (0-based indices 27/61/302 — segment 27 sits inside the already-documented flash-attention content dropout region, 78.97–88.67s; segment 302, "You rebuild.", is the same segment Step 2 already resolved as a script-mode harness artifact) produced ZERO Whisper words in their time window, so whisper-text mode cannot align them at all — script-text mode succeeds on all of these because it never depends on Whisper having transcribed anything correctly. **This confirms the instructed design**: whisper-text mode should remain the drifted-audio fallback, not become a general default — using it even on content already verified faithful measurably degrades alignment quality. Full data: `docs/measurements/phase3-step4-script-vs-whisper.csv`, `docs/measurements/phase3-onset-v6-wtext.csv`, `docs/measurements/phase3-onset-173-wtext.csv`.

**Reference-validity pass (2026-08-05) — four steps, run strictly in order, measurement-only (no Rust/Viterbi/integration/contract-amendment touched, 250ms threshold not retuned).** Full scripts and exact invocations: `scripts/phase3-reference-validity.md`, backing `phase3-reference-validity-step-{a,b,c}-*.py`. Task: the 40 unresolved Step-2 failures share one sign — FA places the word LATER than `silencedetect`'s declared pause end, 0.28–2.1s, never earlier, clustered on sentence-initial pronouns. A uniform-sign error is the signature of a biased reference (silencedetect exiting a soft onset ramp early), not random FA noise. Tested directly rather than assumed.

*Step A — threshold sweep on the reference.* Re-ran `silencedetect` over V6's full audio at noise floors -50/-45/-40/-35/-30dB, min-duration held fixed at 0.25s. For each of the 40 words, re-derived "pause end" at each floor (preferring the silence overlapping the original -45dB interval; falling back to the nearest prior silence only twice across the whole sweep, both at the strictest -50dB floor, flagged per-row) and recomputed `onset_error = token_start - silence_end`. Full table: `docs/measurements/phase3-step-a-threshold-sweep.csv`.

| Floor | -50dB | -45dB (orig) | -40dB | -35dB | -30dB |
|---|---|---|---|---|---|
| Silences detected (whole V6) | 505 | 539 | 568 | 565 | 575 |
| Median \|error\| (n=40, overlap-matched) | 397.7ms | 365.6ms | 323.8ms | **17.7ms** | 18.4ms |
| p95 \|error\| (n=40) | 1004.1ms | 1004.1ms | 1004.1ms | 985.6ms | 985.2ms |

**The errors shrink, sharply and mostly monotonically, as the floor rises from -45 to -30dB — stated plainly, per instruction: for the majority of the 40, the reference IS biased early.** Median collapses ~20x (365.6ms→17.7ms) between -45 and -35dB. **34 of 40 (85%) collapse to under 50ms absolute error by -35 or -30dB** — a more permissive noise floor lets `silencedetect` extend its detected "silence" interval further into what was previously classified as low-level speech-onset energy (breath, room tone, a soft voicing ramp), pushing the declared pause end later, closer to where FA (and, by construction, the true audio) actually places the word. 24 of 40 rows are strictly monotonic non-increasing across every step from -45 to -30dB; the other 16 are non-monotonic only in the sense of a few-tens-of-ms wobble AFTER already collapsing to near-zero (e.g. segment 130 "The": 374.5ms→374.4ms→28.9ms→50.1ms — the "regression" from -35 to -30 is 21ms, dwarfed by the 345ms drop that preceded it) — a floor pushed slightly too permissive for that specific word, not a failure to resolve. (The -50dB step is the one place the trend inverts for a couple of rows — expected, since -50 is a STRICTER floor than -45, moving the wrong direction for this hypothesis; excluded from the monotonicity count's headline reading for that reason, retained in the table for completeness.)

**But p95 barely moves (1004ms→985ms) because 6 of 40 (15%) are flat — threshold-invariant across the entire sweep, unresolved even at the most permissive floor tested:** segments 383/307/1/224/42 ("You", errors 1452/2139/1004/369/330ms, unchanged to within a few ms at every floor from -50 to -30dB) and segment 442 ("They", 321ms, likewise flat). **For these 6, the bias hypothesis is dead — say so plainly.** Whatever is wrong with these 6 is not a soft-onset-ramp artifact of a fixed -45dB floor; a floor 15dB more permissive finds no additional signal there at all, meaning either the true acoustic gap really is that large (a genuine long pause, script/narration mismatch, or a real editing gap) or the error has some other source Step A cannot see. **Net verdict: the reference-bias hypothesis is CONFIRMED for 34 of 40 rows and REFUTED for 6 of 40** — this pass does not retune the 250ms gate on either half of that finding, per instruction, but the 40-count itself is no longer a uniform population: use the 6 flat rows, not all 40, as the residual "genuine FA/unknown-cause failure" set going forward.

*Step B — onset phonetic class.* Looked up the following word for all 501 V6 boundaries (failing and passing) in the CMU Pronouncing Dictionary, bucketed by first-phoneme class. Full table: `docs/measurements/phase3-step-b-phoneme-bucket.csv`.

| Bucket | n | Median \|error\| | p95 \|error\| | >250ms rate |
|---|---|---|---|---|
| soft (vowel/glide/nasal/liquid) | 290 | 16.4ms | **368.3ms** | **10.3%** (30/290) |
| sharp (plosive/fricative/affricate) | 205 | 24.9ms | 248.2ms | 4.9% (10/205) |

Fine-grained, the gap is sharper still: **plosive (n=38) and affricate (n=4) both read 0.0% >250ms and p95 under 100ms** — every stop/affricate-initial boundary in the entire V6 corpus lands cleanly — while **glide (n=156, almost entirely "You"/"Your"/"When"/"We") reads 14.1% >250ms, p95 368.8ms**, the single worst fine-grained bucket, and fricative/vowel sit in between (6.1%/321.2ms, 7.1%/341.8ms). Among the 40 unresolved failures themselves: **30/40 (75%) are soft-onset, 10/40 (25%) are sharp — and every one of the 10 sharp cases is a fricative (`The`/`He`/`They`/`That`/`She`/`Certain`); zero are plosive or affricate**, the two classes that read a clean 0% corpus-wide. **A large soft-vs-sharp gap exists and supports Step A's mechanism** — a stop or affricate has a sharp acoustic onset (a burst or friction transient) that a fixed -45dB floor catches accurately regardless of where it sits; a glide or vowel has a gradual voicing ramp a fixed floor can exit early on, exactly the shape Step A's sweep demonstrated directly.

*Step C — real ground truth, exported for the owner.* 12 clips exported from V6's original source audio (not the 16kHz working copy), each padded 1.0s before the reference pause and 1.0s after the following word: 8 from the 40 unresolved (4 of Step A's threshold-invariant outliers — segments 383/307/1/442 — plus 2 that resolve cleanly by -35dB — segments 21/301 — plus 2 mid-range — segments 169/154), and 4 passing controls spanning the same phoneme classes (including a same-word "You" control for direct A/B against the many failing "You" cases). Files renamed to opaque `clip_01.wav`–`clip_12.wav` (`random.seed(42)` shuffle) with a manifest carrying ONLY clip name + script text (`docs/measurements/phase3-step-c-clips-manifest.csv`) — no timing, error, or pass/fail information, so a listen-through can't be biased by which ones "should" be wrong. Listening protocol: `docs/phase3-step-c-listening-protocol.md`. The private answer key (clip → segment/word/error/kind) is held at `/tmp/phase3/v6/step_c_answer_key.json`, deliberately not in `docs/`, for this session (or the next) to score the returned labels against once they come back — **this step is not scored yet; it is the only true reference this measurement has, and scoring it is future work pending the owner's listen.**

*Step D — negative-smear consistency audit.* `measure-word-onset.py`'s `summarize()` computes `negative_smear_fraction` and the median/p95 percentiles from the exact SAME `errors` list, over the exact SAME population (every scored pause on the SAME `silences.json` reference) — there is no different-reference or different-population divergence to find; both numbers come out of one function call in one script run. Verified directly against the corrected 501-row V6 dataset (Steps 1+2 applied — the dataset Step 3's 46.9% figure is drawn from):

| | count | fraction of 501 |
|---|---|---|
| Negative-sign rows | 235 | **46.9%** (matches the plan's own Step 3 figure exactly) |
| ...of which \|error\| < 50ms | 234 | 99.6% of the negative rows |
| ...of which \|error\| > 250ms | **0** | 0% of the negative rows |
| Positive-sign rows > 250ms (the 40 unresolved failures) | 40 | — |

**No inconsistency in the computation — the two readings are disjoint slices (sign × magnitude) of the identical distribution, not evidence of a definitional conflict.** Negative-smear counts sign alone, at ANY magnitude, so it is necessarily dominated by the bulk of the corpus's ordinary ±15-20ms alignment jitter (234 of 235 negative rows are sub-50ms noise) — a source with pure, accurate, symmetric-around-zero noise will ALWAYS read close to 50% by this literal definition, because roughly half of zero-centered noise falls on the negative side by definition, independent of how good the source actually is. The 40 unresolved failures are a magnitude-selected (>250ms), sign-selected (positive-only) tail of that same distribution — by construction, a row cannot be in both sets. **If one of the two metrics is "defined wrong," it is the <1% GATE, not either computation**: the gate was built (per the provenance entry above) to catch Whisper's whole-pause-absorption pathology (median ~500ms negative smear on V6, the original segment-96 mechanism) and is structurally incapable of being passed by an accurate-but-noisy source, since it does not weight by error magnitude at all. This is a re-statement, now with an exact population-level count behind it, of the correction Blocker 2 already flagged ("the fraction alone does not discriminate what it was designed to discriminate once errors are small") — not a new mechanism, but no longer just an assertion about medians/90th-percentiles, now a full accounting of all 501 rows.

**Step C — SCORED against real human ground truth (2026-08-06), C1-C5, measurement-only (no Rust/Viterbi/integration/contract-amendment touched, 250ms threshold not retuned).** The owner listened to all 12 clips and returned, per clip, the clip-relative timestamp where the preceding word's voice truly stops (A), the breath window if audible, and the clip-relative timestamp where the next word's speech genuinely begins (B). This is the only reference in the entire Phase 3 measurement program that is not itself a method under test — everything below is scored against it, not the other way around.

*C1 — integrity check, run BEFORE unblinding or scoring.* Clips are 1.0s-padded before the reference silence's start; 9 of 12 clips put human A within ~15-66ms of that 1.0s pad point, consistent with ordinary micro-pause structure right where expected. Three do not — clips 3, 10, 11 (A = 3.670s, 2.762s, 3.708s) — investigated individually, not fit to whichever reading makes the numbers work:

- **Clip 3 (segment 1, "You are seven years old.") — EXCLUDED, cannot be confidently matched to the intended boundary.** This is the FIRST segment of the entire V6 file. The FA token span recorded for the flagged word "You" is `[2.409, 4.275]` — 1.87s for a one-syllable word, which is not a plausible word duration and is independent, structural evidence that FA's alignment for this specific segment is broken (no real left-context exists before the first segment; the same class of edge-of-corpus artifact already documented for segment 320's total alignment failure earlier in this entry). The human's report (A=3.670, breath 3.735-4.003, B=4.142) sits entirely outside the flagged silencedetect interval `[0.647, 1.405]` (both absolute here, since `clip_start_abs=0.0`) — a gap of roughly 2.3-2.7s, far larger than any genuine onset-ramp bias measured anywhere else in this pass (max elsewhere is ~2.47s, see clip 11, but that case's FA onset lands within 335ms of human ground truth — this one does not, by 1.7s). Reading the numbers together: the human is almost certainly describing the real sentence-final pause between segment 1 ("...seven years old.") and segment 2 ("You live inside a skin-covered shelter..." — literally the next clip in this same batch, clip 4/control c1), not the tiny early blip the pipeline flagged near the very start of the file. **This is "the listener marking a different pause inside a multi-pause clip," compounded by a first-segment FA artifact that makes even the flagged token's own span untrustworthy. Excluded from all scoring below, per instruction — not fit to either boundary.**
- **Clip 10 (segment 383, "You are sixty-four.") — RETAINED.** silencedetect's flagged interval `[1190.602, 1191.070]` is a real but SPURIOUS earlier detection — most likely internal to the preceding segment's own speech — not the true segment-382→383 boundary, which the human places roughly 1.3s later in the clip (A=2.762, B=2.881, clip-relative). This is a case of the reference measuring the wrong pause among several in the clip, but the human and FA agree closely on which pause is the real one: FA's onset (`1192.522`) lands only **39ms** after the human's B (`1192.483`) — two orders of magnitude tighter than silencedetect's **1413ms** error against the same human B. Retained; scored below.
- **Clip 11 (segment 307, "You are forty-nine.") — RETAINED, same mechanism as clip 10.** silencedetect's flagged interval is again a stale/earlier pause, roughly 2.47s before the true boundary the human reports (A=3.708, B=3.904). FA's onset lands **335ms** after human B — the one case among these three where FA itself leaves a real, if much smaller, residual (silencedetect's error against the same human B is **2474ms** — FA is ~7x closer but does not clear the 250ms gate here). Retained; scored below, and flagged in C4/C5 as the one case that does not fully resolve.

None of the three is an export defect (all clip durations and paddings are exactly as designed) and none is "the listener marking a different pause" in a way that discredits the human labels — in 10 and 11 the human's own numbers are corroborated by FA's independent onset call; only clip 3's human report is disconnected from the flagged measurement entirely.

*C2 — unblind and score three-way (FA vs. silencedetect vs. human), all 12 clips, project-absolute time.* `FA-human` = FA token onset minus human B (absolute); `SD-human` = silencedetect's declared pause-end minus human B (absolute). Clip 3 shown for completeness, excluded from every aggregate below.

| Clip | Kind | Seg | Word | FA onset (abs) | silencedetect pause-end (abs) | Human B (abs) | FA − human | SD − human | FA confidence |
|---|---|---|---|---|---|---|---|---|---|
| 1 | failure | 154 | When | 456.245 | 455.846 | 456.280 | **−34.9ms** | −434.2ms | 0.9704 |
| 2 | failure | 301 | Accepting | 905.811 | 905.280 | 905.793 | **+18.3ms** | −512.2ms | 0.8260 |
| 3 | failure | 1 | You | 2.409 | 1.405 | 4.142 | −1733.0ms *(excluded, see C1)* | −2737.1ms *(excluded)* | 0.9984 |
| 4 | control | c1 | You | 5.961 | 5.960 | 5.955 | **+6.1ms** | +4.6ms | 0.9736 |
| 5 | control | c2 | The | 10.211 | 10.236 | 10.236 | **−24.8ms** | +0.7ms | 0.9494 |
| 6 | failure | 169 | He | 503.994 | 503.587 | 503.969 | **+24.6ms** | −382.8ms | 0.9998 |
| 7 | control | c4 | Behind | 154.991 | 155.018 | 155.017 | **−25.7ms** | +1.4ms | 0.9220 |
| 8 | failure | 442 | They | 1404.223 | 1403.902 | 1404.237 | **−14.3ms** | −335.5ms | 0.9998 |
| 9 | failure | 21 | It | 60.156 | 59.775 | 60.144 | **+12.3ms** | −368.6ms | 0.9989 |
| 10 | failure | 383 | You | 1192.522 | 1191.070 | 1192.483 | **+38.6ms** | −1413.3ms | 0.9396 |
| 11 | failure | 307 | You | 929.335 | 927.196 | 929.670 | **−335.2ms** | −2473.9ms | 0.9838 |
| 12 | control | c3 | and | 53.047 | 53.034 | 53.033 | **+13.7ms** | +1.2ms | 0.9973 |

**Controls (n=4, clips 4/5/7/12):** silencedetect is essentially exact against human here (0.7-4.6ms, sub-5ms) — actually TIGHTER than FA (6.1-25.7ms). This is expected and not a point against silencedetect generally: controls are ordinary, clean micro-pauses with no breath and no soft onset ramp — exactly the case a fixed-threshold energy detector handles best, and exactly the case this whole investigation is NOT about.

**Failures (n=7 scored, clips 1/2/6/8/9/10/11 — clip 3 excluded):** FA error ranges from 12.3ms to 335.2ms (median 24.6ms — indistinguishable from FA's own control-set noise floor); silencedetect error ranges from 335.5ms to 2473.9ms (median 434.2ms). **FA is closer to human than silencedetect on every single one of the 7 scored failures, by a factor of 6x (clip 6) to 78x (clip 9), median ~15x.** Stated directly, per instruction: **the 40 unresolved Phase 3 failures were never predominantly FA errors — the p95 figure that failed the 250ms gate was computed against a reference (`silencedetect`) that this 12-clip sample shows is itself biased by 335ms to 2474ms on real narration boundaries, while FA's own error against the same human ground truth stays in the 12-39ms range on 6 of 7 scored failures.** The one exception is stated just as directly: **clip 11 (segment 307) leaves FA itself 335ms off true ground truth — a real, if much smaller than reference-implied, FA residual that this sample does not explain away.**

*C3 — the breath mechanism, tested explicitly.* The human labels show **6 clips with an audible breath, not 7** — a correction to this pass's own working assumption, stated plainly per the instruction to report counts, not impressions (clips 1, 2, 3, 6, 8, 9; clips 4, 5, 7, 10, 11, 12 have none). In all 6, the breath ends 63-139ms before human B (clip 1: 129ms, clip 2: 120ms, clip 3: 139ms [excluded from every other count, included here only to note it still fits the pattern], clip 6: 63ms, clip 8: 116ms, clip 9: 136ms) — consistent with the 60-140ms range this pass was checking for.

Comparing silencedetect's declared pause-end against breath ONSET (not breath end, not human B) for the 5 scorable breath clips: clip 1 lands 0.19ms before breath onset, clip 2 lands 2.75ms after, clip 8 lands 0.50ms after, clip 9 lands 1.38ms after — **four of five within 3ms of breath onset, i.e. essentially exact.** Clip 6 lands 69.8ms before breath onset — close, but the loosest of the five. **This is the bias mechanism confirmed with direct evidence, not inference: silencedetect's −45dB/0.25s detector is measuring the START of the breath and calling it "speech resumed," because a breath's onset crosses the energy threshold before the actual next word's articulation does.** It is not detecting a wrong silence in the abstract — it is detecting the correct silence and then exiting it one event too early, at the breath, not at the word.

The 6 no-breath clips (not 5 — same count correction as above: 4, 5, 7, 10, 11, 12) split sharply into two groups, which is the real, sharper finding here: the 4 controls (4, 5, 7, 12) show silencedetect within 0.7-4.6ms of human B — essentially perfect, because there is no breath and no soft ramp for the fixed threshold to mistime. The 2 no-breath failures (10, 11 — both threshold-invariant residuals, see C4) show silencedetect off by 1413ms and 2474ms **despite no breath being present at all.** **A split result, exactly per instruction, but a three-way split rather than a clean two-way one: silencedetect is accurate on ordinary no-breath pauses (4/4 controls), biased toward breath onset on breath-containing pauses (5/5 scorable breath clips, 4 of them near-exact), and independently, catastrophically wrong on 2 of the 6 no-breath clips for a completely different reason the breath mechanism does not explain (stale/wrong-pause selection within a multi-pause clip — see C1).** Counts: 5/5 scorable breath clips show silencedetect biased toward breath onset (not human B); 4/4 no-breath controls show silencedetect accurate; 2/6 no-breath clips (both residuals) show silencedetect wrong by a different, unexplained mechanism.

*C4 — the 6 threshold-invariant residuals (segments 383, 307, 1, 224, 42, 442 — Step A).* **4 of the 6 are present in this 12-clip sample** (383→clip 10, 307→clip 11, 1→clip 3, 442→clip 8); segments 224 and 42 are absent and remain entirely unexamined by ground truth — stated plainly, not extrapolated. Of the 4 sampled:

- **Segment 442 (clip 8) — FULLY RESOLVED, and it is a breath case.** silencedetect's pause-end lands 0.50ms from human-reported breath onset (near-exact); FA lands 14.3ms from true human B. The "threshold-invariance" this segment showed under Step A's dB sweep is now explained end-to-end: no floor between −50 and −30dB can fix a bias mechanism rooted in breath acoustics rather than noise-floor placement, so of course the sweep never moved it. **Not a genuine FA defect — a reference (silencedetect) artifact, confirmed.**
- **Segment 383 (clip 10) — FULLY RESOLVED, and it is NOT a breath case.** No breath audible; silencedetect anchored to a stale, earlier pause inside the same multi-pause clip (see C1). FA lands 38.6ms from true human B. **Not a genuine FA defect — a different reference artifact (wrong-pause selection) than segment 442's, confirmed by the same method.**
- **Segment 307 (clip 11) — PARTIALLY RESOLVED.** Same stale-pause reference mechanism as segment 383, but FA itself still measures 335.2ms from true human B — smaller than the silencedetect-relative reading suggested by roughly 7x, but not inside the 250ms gate. **The one sampled residual that is not fully explained away; a real, smaller FA error remains.**
- **Segment 1 (clip 3) — UNCHARACTERIZED, excluded (C1).** Human ground truth cannot speak to this residual's true nature; the clip's labels describe a different acoustic event than the one under test.

Net: of the 4 threshold-invariant residuals ground truth could examine, human labeling resolves 2 completely as reference artifacts with FA accurate to <40ms, leaves 1 with a genuine but much-reduced FA residual (335ms), and leaves 1 uncharacterizable. The remaining 2 of the 6 (segments 224, 42) are untouched by this pass.

*C5 — the number the gate should rest on, using human labels as reference.* Sample size stated next to every figure; **n=11 scored clips (7 failures + 4 controls) is nowhere near enough to set or extrapolate a corpus-wide p95** — this section reports what the 12-clip sample itself shows, not a corpus estimate.

| | n | FA \|error\| median | FA \|error\| p95 | silencedetect \|error\| median | silencedetect \|error\| p95 |
|---|---|---|---|---|---|
| Failures | 7 | 24.6ms | 246.2ms | 434.2ms | 2155.7ms |
| Controls | 4 | 19.2ms | 25.6ms | 1.3ms | 4.1ms |
| All scored | 11 | 24.6ms | 186.9ms | 368.6ms | 1943.6ms |

Per-clip absolute FA error (ms), scored only, sorted: 12.3, 14.3, 18.3, 24.6, 24.8, 34.9, 38.6 (failures + controls interleaved by magnitude) ... 335.2 (clip 11, the one outlier). **6 of 7 scored failures pass the 250ms gate cleanly against human ground truth (12.3-38.6ms); 1 of 7 (clip 11 / segment 307) fails it at 335.2ms.** All 4 controls pass trivially. Against human ground truth, FA's failure-set p95 (246.2ms, n=7) sits just under the 250ms gate — a razor's edge on 7 points, not a verdict. **This is a sample, not a corpus figure: a defensible p95 needs on the order of several dozen to a low hundred ground-truthed boundaries (a rough rule of thumb for a stable tail estimate at the 95th percentile) before it should replace or adjust the 250ms gate — this pass recommends exporting a second blinded batch of at least 20-30 clips, weighted toward the phonetically-soft, sentence-initial-pronoun pattern Step B/the unresolved-40 list already flag as where residual risk concentrates, if the owner wants a number sized to actually move the gate.**

**Reference-correction pass (2026-08-06), Steps E-H — measurement only, no Rust/Viterbi/integration/contract-amendment, 250ms/1% thresholds not retuned.** Task: Step C's 12-clip sample showed FA tracking human to 12-39ms on 6 of 7 scored failures while `silencedetect` itself was biased 335-2474ms — the SCORING REFERENCE, not FA, is the dominant problem. Steps E-H fix the reference: audit and fix the harness's stale-pause selection (E), build a principled breath-aware corrected reference (F), explain the one confirmed genuine FA residual (G, segment 307), and re-score the corpus plus a fresh, non-overlapping 20-clip confirmation batch (H). Four new committed scripts: `scripts/phase3-stale-pause-audit.py`, `scripts/phase3-breath-aware-reference.py`, `scripts/phase3-step-h-fresh-batch-clips.py` (`.md` companion not written — see this entry and `scripts/phase3-reference-validity.md`'s existing convention for invocation shape; these three follow it directly).

*Step E — stale-pause selection audit, all 446 real V6 boundaries (audited, not "assumed pervasive").* The selection rule under audit is `measure-word-onset.py`'s `score_onset_errors`: an ORDINAL greedy walk over ffmpeg's 539 detected silences (V6, ascending time order) — for each silence, advance to the first not-yet-consumed token whose midpoint clears the silence's start and whose end reaches the silence's own midpoint (the it.-scorer overlap gate). **The walk has no cap on how far forward it may reach, and no check that its chosen silence is plausibly the one adjacent to the boundary it is being used to score** — that absence is the entire defect surface Step E tests.

Audit method (`phase3-stale-pause-audit.py`): for each of the 446 interior committed-segment boundaries (`v6-segments-full.json`, base.en-era but stable — same reference document already used by the original ratio analysis), take FA's own aligned onset of the next segment's first word (FA's accuracy against human ground truth is 12-39ms on 6 of 7 scored failures, Step C — a sound per-word anchor even where the SILENCE reference is not) and ask: is the harness's chosen silence really the last one ffmpeg detected before that true onset? Two committed-boundary-anchored variants were tried first and discarded as unsound before this one: "closest silence to the raw committed boundary time" over-fires (29 false positives corpus-wide, ALL cases where the walk's pick was actually correct and the committed-time anchor was wrong instead — committed timing is exactly the smeared quantity this whole investigation exists to fix, so it cannot serve as the audit's own ground truth); "closest silence to FA's own end-of-previous-segment token" also over-fires when the PRECEDING segment's own per-segment FA window is itself bad (confirmed on segment 383, where end-of-prev read 4.26s away from the true gap because segment 382's own alignment undershoots). The single-sided, FA-onset-anchored rule above avoids both failure modes.

**Result: the walk's selection is CORRECT (matches "last silence detected before the true onset") for 418 of 440 scored boundaries (95%). It is WRONG — a genuinely closer, more-plausible candidate silence existed and the walk picked a farther one instead — for exactly 5 boundaries in the ENTIRE 446-boundary corpus, and all 5 are ALREADY-KNOWN, ALREADY-RESOLVED Step-2 zero-padding-window artifacts (segments 80, 144, and three more sharing the identical mechanism), not new findings.** Critically: **zero of the 40 currently-unresolved failures exhibit this fixable selection-rule bug** — for every one of the 40, the harness's chosen silence already IS the last one ffmpeg detected before the true word, by this rigorous test. Full per-boundary output: `docs/measurements/phase3-step-e-stale-pause-audit.csv`.

What the 40's own error distribution shows instead: 37 of 40 sit in a smooth, continuous 279-592ms band; exactly 3 (segments 1, 307, 383 — errors 1004/2139/1452ms) are statistical outliers, 2-8x beyond that band's own maximum and structurally distinct — independently corroborated by Step A's own finding that these same 3 (plus 224, 42, 442) are flat across the ENTIRE -50dB-to-30dB sweep. For these 3, no closer silence exists ANYWHERE in the 539-silence corpus (confirmed directly: the closest available candidate to each of their true onsets is exactly the stale one the walk already picked) — this is a **detector-coverage gap** (the true pause was never independently detected at any threshold, per Step A), not a selection-algorithm defect a smarter picking rule could fix over the SAME candidate set. The corrected terminology, recorded so it isn't restated as a "bug" going forward: "stale pause selection" in the C1 sense (segments 383/307) is real and confirmed, but its mechanism is "no valid candidate silence exists near the true boundary, and the walk has no give-up path" — not "a better candidate existed and was skipped."

**Fix applied and re-scored:** a maximum-plausible-distance guard (1.0s — chosen from the p99 of the clean, correctly-matched population, ~530ms, doubled for margin; NOT fit to the 3 known outliers after the fact) rejects an attribution outright rather than silently keeping a stale, arbitrarily-distant one. Applied to the canonical Steps-1+2-corrected 501-row dataset (`docs/phase3-onset-v6-fa-step1-2-corrected.csv`): **3 rows excluded (segments 1, 307, 383); p95 338.2ms -> 331.3ms; n>250ms 40 -> 37.** Small movement, as expected — 3 of 40 rows, not the dozens the pervasive-bug hypothesis worried about. **Answer to the count asked for: 3 of the 40 unresolved failures were the stale-pause/detector-miss bug alone** (segments 1, 307, 383) — reported exactly, including that it is a much smaller number than the working hypothesis anticipated, not rounded up or softened.

*Step F — a breath-aware corrected reference, built on acoustic principle before any comparison to human labels.* Breath is low-energy, aperiodic, and broadband; voiced onset is higher-energy, periodic, and harmonically structured. `scripts/phase3-breath-aware-reference.py` computes four frame-level features (32ms Hann window, 8ms hop) per candidate interval: RMS-dB (file-ADAPTIVE silence-floor/speech-level bands — p10/p60 percentiles of the whole file's own frame-RMS distribution, not a fixed dB value tied to one recording's gain), spectral flatness (Wiener entropy, geometric/arithmetic mean of the 150-4000Hz power spectrum — near 1.0 is noise-like, near 0 is tonal), zero-crossing rate, and harmonicity (peak normalized autocorrelation in the 70-350Hz plausible-pitch lag range). A frame is BREATH when its energy sits between the silence floor and speech level (+6dB/-10dB margins) AND flatness > 0.35 AND harmonicity < 0.35; SPEECH when energy nears the speech level AND harmonicity > 0.5 AND flatness < 0.25. Thresholds are standard-literature round numbers (SFM noisy/tonal cut ~0.3-0.4; praat's own default voicing threshold is 0.45, comfortably inside the 0.35/0.5 breath/speech gap chosen here) — **fixed before this script was run against any human label**, not fit to this corpus.

**Disclosure, per instruction to state plainly whether tuning-after-looking occurred:** this session had already read Step C's published C2/C3 aggregate findings (breath-onset offsets 63-139ms before human B, per-clip SD/FA/human error tables) earlier in this same conversation, before designing this detector — full blindness on the ORIGINAL 12 clips cannot be claimed, only that the specific threshold VALUES were fixed from generic acoustic-phonetics convention, not reverse-fit to those published numbers, and were not adjusted after computing the comparison below. **One implementation bug WAS found and fixed after an initial run** (not a threshold retune): the speech-onset search initially scanned from slightly before the flagged silence's own start, which could pick up the PRECEDING word's own trailing voiced decay and misreport it as "the corrected onset" (segment 398 initially computed at −888ms error, worse than the original) — fixed by restricting the search to frames at or after the flagged silence's start; segment 398 then resolved to +8ms. This is a scope/correctness fix (a wrong search window), not a classification-threshold adjustment, and it was found via an internal consistency check (segment 398 is not one of the 12 human-labeled clips), not via the human comparison. The genuinely blind test is Step H's fresh batch below.

**Run against the 12 known clips (informational, not blind — see disclosure):** breath correctly detected on 5 of the 6 clips human labels confirm have audible breath (missed only clip 3, itself excluded from all scoring per C1's own independent FA-artifact finding), with one false positive on a control (clip 5, "The" — human reports no breath there; the correction pushed that control's error from a near-exact +0.7ms to +199.8ms, still comfortably under the 250ms gate but a real, disclosed regression, not hidden). On the corrected-onset accuracy itself, against human B: the 5 real breath failures improve from 335-512ms (silencedetect) to 1-232ms (breath-corrected) — clearing the 250ms gate on every one, several within single-digit ms of FA's own accuracy. Two controls regress modestly (199.8ms, 157.7ms) due to false-positive breath detection but stay under the gate; two controls are unaffected (near-exact, matching silencedetect). **Net: large, real improvement on genuine failures; a real, non-zero false-positive cost on ordinary clean pauses — reported as-is, not tuned away.**

**Run against the full 40 unresolved failures:** breath detected in exactly 37 of 40 — precisely the 37 NOT flagged by Step E as detector-misses (segments 1, 307, 383 show no breath/speech signal at all in the local window, consistent with "no candidate exists nearby" rather than "a breath was missed"). Applying the corrected onset to those 37: **35 of 40 total now resolve to ≤250ms** (median residual magnitude in the single digits to tens of ms; e.g. segment 154 −32.9ms, segment 21 +13.3ms, segment 301 −213.8ms — the one case that clears the gate but keeps a real, non-trivial residual, disclosed rather than rounded to "resolved cleanly"). **5 of 40 remain: the 3 Step E detector-misses (1, 307, 383) plus 2 that show NO breath signal and do not respond to this correction at all (segments 224, 42 — Step A's other 2 threshold-invariant residuals, still entirely unexamined by any ground truth, genuinely distinct from the breath mechanism).** Full per-row output: `/tmp/phase3/v6/step_f_breath_analysis_40.json` (not committed to `docs/` — regenerable from the committed script + the already-committed `docs/phase3-onset-v6-fa-step1-2-corrected.csv`/`unresolved_40.json`-equivalent inputs).

*Step G — segment 307 (clip 11), the one confirmed genuine FA residual, investigated on its own terms.* FA places "You" (segment 307, "You are forty-nine.") at 929.335s, confidence 0.9838 — 335ms before human B (929.670s). Neither Step E's exclusion nor Step F's breath correction touches this one (no breath, no closer silence candidate exists at all near the true onset) — a real, if much-reduced-from-`silencedetect`'s-2474ms, residual. Frame-level acoustic inspection (RMS/flatness/harmonicity, 924.6-929.7s) found NOT a soft glide ramp (the wider 37-case pattern) but a ~4.8-second stretch of substantial, harmonically-rich, clearly-voiced acoustic activity between the preceding segment's FA-declared end (924.766, "keep working.") and FA's own placement of "You" (929.335) — repeatedly classified SPEECH by this pass's own detector, not silence and not breath. Cross-checked against the raw turbo Whisper transcript (`docs/V6-Smear-Phase2a.csv`) for this exact window: **"Level 8 The one who teaches what cannot be taught easily"** (925.14-928.93s) — content that matches NEITHER segment 306's script ("...keep working.") NOR segment 307's ("You are forty-nine.") at all. Given the file's own very first transcribed words are "Level one" (a chapter marker), and `[HEADING:]` recitations are a real, established feature of this codebase's narration structure, the most likely explanation is a spoken heading/chapter-marker interposed in the recording between these two content segments, with no representation in either segment's own script text.

Whisper's own RAW transcript already places "You" at 929.330 — 5ms from FA's 929.335, i.e. essentially the SAME placement — a full 340ms before the human-confirmed true onset (929.670). Since FA's per-segment search window and text-matching inherit Whisper's own token positions (via the unchanged Hirschberg alignment) as their anchor, **FA reproduces rather than independently corrects Whisper's own pre-existing mistiming in the narrow window immediately after an interposed, unscripted heading recitation.** This is a genuine, distinct FA/pipeline defect — not the soft-onset-pronoun pattern the other 37 share, and not fixable by either the stale-pause fix or the breath correction, both of which correctly declined to touch it (they have no candidate acoustic event to offer instead). Per instruction, this single case is reported as its own explanation and is NOT generalized into a new corpus-wide class — segments 1 and 383 (the other two Step E detector-misses) were not re-examined for this same specific mechanism, and no claim is made about them either way.

*Step H — corpus re-score, and a fresh, non-overlapping confirmation batch.*

| | median (abs) | p95 (abs) | negative-smear | boundaries >250ms |
|---|---|---|---|---|
| BEFORE (Steps 1+2 corrected — existing Step 3 number) | 19.7ms | **338.2ms (fails 250ms gate)** | 46.9% (fails <1% gate) | 40 |
| AFTER Steps E+F applied | 18.3ms | **82.2ms (passes)** | 50.8% (still fails <1%, unchanged verdict — see below) | **2** |

Median is essentially unchanged (it was never the failing reading). **p95 drops from 338.2ms to 82.2ms — a 4x improvement, now comfortably inside the 250ms gate** — from correcting the reference alone, no change to FA, no threshold retuned. Negative-smear stays in the ~50% range under the literal sign-only gate definition; per Step D's own already-recorded finding, this is expected and not a new problem — an accurate, symmetric-noise source always reads ~50% by a sign-only test, and the gate (calibrated to catch Whisper's ~500ms whole-pause-absorption pathology) was never capable of discriminating a merely-noisy-but-accurate source from a good one. **Only 2 of 501 V6 boundaries now exceed 250ms: segments 42 ("You are eleven.", 323.9ms) and 224 ("You are thirty-three.", 367.8ms)** — both show no detectable breath signal and did not respond to the Step F correction at all; both were already flagged by Step A as threshold-invariant and remain, as stated there, entirely unexamined by any ground truth. Small enough now to name individually rather than characterize statistically — recorded here as the honest residual, not resolved by inference.

**Provisional, explicitly:** this rests on a corrected reference validated so far against only the original 12 human-labeled clips (Step F's disclosed non-blind check). The following fresh batch is the actual confirmation.

**Fresh blinded batch of 20 (`scripts/phase3-step-h-fresh-batch-clips.py`), NONE overlapping the original 12** (segments 154, 301, 1, 169, 442, 21, 383, 307 and controls c1-c4 all explicitly excluded from selection): 12 drawn from the current worst-remaining residuals under the corrected reference (segments 224, 42, 437, 293, 321, 89, 355, 108, 264, 24, 18, 319 — includes both segments still numerically >250ms, plus the next-closest ranked by |corrected error|, since only 2 boundaries technically exceed the line after Steps E+F); 8 controls spanning varied word-initial phonetic classes (segments 3, 6, 11, 16, 26, 33, 36, 43 — plosive/fricative "The"/"Certain", glide "You"/"Your", vowel-initial "and"/"On", nasal "Morning"/"Nobody", fricative "She"). Same protocol as Step C: 1.0s padding before the flagged silence's start and 1.0s after the flagged word's end, sourced from V6's original (non-16kHz-transcoded) audio, opaque `clip2_01`-`clip2_20` names (seed 99, distinct from Step C's seed 42), public manifest carrying script text only (`docs/measurements/phase3-step-h-batch2-manifest.csv`), listening protocol at `docs/phase3-step-h-listening-protocol.md`, private answer key held outside `docs/` (`/tmp/phase3/v6/step_h_answer_key.json`). **Padding and duration verified programmatically for all 20 before export, per the explicit instruction that three of the last batch had unexplained offsets: every clip's pre-pause and post-word padding measured exactly 1.000s and every file's actual duration (via `ffprobe`) matched its expected duration to within 5ms — all 20 PASS.** This batch is not yet scored — the owner's listen is future work, exactly as Step C's 12-clip batch was before it.

**Bottom line for E-H, stated plainly:** of the original 40 unresolved failures, 3 are a detector-coverage gap (no fixable selection-rule bug — Step E), 37 responded to a principled breath-aware correction (35 cleanly, to ≤250ms; Step F), and exactly 1 (segment 307) is a confirmed, explained, non-generalized genuine FA/pipeline residual (Step G) — a heading recitation interposed in the recording confuses Whisper's own transcript timing immediately after it, and FA inherits rather than corrects that error. Corpus-wide p95 against the corrected reference is 82.2ms (down from 338.2ms), with 2 of 501 boundaries (not yet explained by any mechanism this pass tested) still exceeding 250ms. This number is **provisional** until the fresh 20-clip batch confirms the corrected reference on genuinely unseen material.

**Blocker 3 — architecture confirmed: (A), forced alignment supplies timing only.** Whisper's transcript and the Hirschberg alignment are **retained unchanged** for matching (which script word maps to which audio position) and skip detection (which segments have no audio match) — FA's only job is producing better word-level timestamps for spans Hirschberg already decided are real. **Part B's Stage 1 output contract (`{text, start, end}` per token) needs no amendment under this architecture** — FA is a drop-in replacement for the timing values behind that same contract shape, not a new pipeline stage or a new field.

**Honest cost, stated plainly, per the owner's explicit instruction not to bury it:** architecture (A) means **both models run on every sync** — Whisper first (transcript + rough timestamps, needed for Hirschberg matching), then FA second (real timestamps for the same audio). This is strictly additive to today's single-pass pipeline: **total sync latency increases, not decreases, versus today.** On top of Whisper turbo's already-measured 834.9s wall-clock and ~2.2 GiB peak RSS on V6 (Phase 2b), FA adds its own full pass over the same audio — see Blocker 2 above for FA's own measured number, the other half of this cost that Phase 2b's brief left unmeasured.

Either way the interface is identical and the pipeline below is untouched.
Your verification: resync both projects. Expect boundaries to move (this phase shifts token indices — fewer timestamp-based malformed drops — so the baseline is re-established: fresh resync → inspector → full forty listen → new `verification-baseline.csv` rows). Listen to the full forty-boundary set. Record the new verdict. Some of the eleven word-shift cases may already resolve here, because the gaps become real. Some of the eight may regress, because the seam exemption was tuned to compensate for smear that no longer exists. Both outcomes are informative and neither blocks the phase — what blocks it is a control boundary regressing, because that means the new timings are worse somewhere we weren’t looking.

**Blinded-batch scoring pass (2026-08-06), Steps I-L — measurement only, no Rust/Viterbi/integration/contract-amendment, 250ms/1% thresholds not retuned.** Task: score the fresh 20-clip Step H confirmation batch against real human labels, but first audit the export path itself — the listener reported clip 11's audio doesn't match its manifest text, and the SAME export mechanism produced the original 12-clip batch underlying C1-C5. One new committed script, `scripts/phase3-step-i-l-audit.py` (four subcommands: `extract-raw-transcript`, `transcript-audit`, `heading-sweep`, `score-batch2`), reused for all four steps below.

*Step I — export integrity audit, run first, all 32 clips (both batches).* Root cause of clip 11 (segment 321, "That"), determined before re-exporting anything: **not** a wrong segment index, wrong source file, wrong offset, stale manifest write, or off-by-one in clip ordering — the padding/duration self-check the export script already runs (Step H's own entry) passed clean for all 20 clips, and the manifest's `script_text` for clip 11 (`"That young man needs to understand..."`) **is** segment 321's real, correct script text. The defect is upstream: segment 320 (`"The problem is what happens when the body's warning triggers a second signal that overrides the first."`, 102 characters) is confirmed by `tokens_fa2.json` to be the **only segment in the entire 447-segment V6 corpus with zero aligned FA tokens** — the already-documented CTC-constraint-violation skip from Blocker 2 (`targets length is too long for CTC`). Cross-referencing against the full, untruncated raw turbo transcript (`scripts/phase3-step-i-l-audit.py extract-raw-transcript`, pulling the console-dump section of `docs/V6-Smear-Phase2a.csv` past its 1000-row UI-table cap — the same trap Step 4 already flagged) shows segment 320's real content **is** spoken, in full, at 973.920-979.700s — a genuine ~5.8s of narration crammed into a committed slot of only **1.27s**, a 4.5x undercount that pre-dates Phase 3 entirely (Blocker 2's own text: "this corpus's base.en-era committed durations can be too tight even for correctly-transcribed text"). Deprived of any valid neighbour boundary by segment 320's total failure, segment 321's own windowed FA search misfired: it placed "That" at 975.89-977.352s — a span that the raw transcript shows is actually the middle of segment 320's own real, unrecovered speech (`"...happens when the body's warning triggers a second sig[nal]..."`), nearly 4 seconds before segment 321's true first word (`"That"` is really spoken at 979.900-980.070s). This is a **genuine FA-alignment cascade failure triggered by a pre-existing timing defect**, not an export-script bug — the clip extraction correctly rendered exactly the (wrong) coordinates it was handed.

Critically, this defect was **invisible to every numeric gate in this investigation**: segment 321's onset error against `silencedetect` was `975.89 - 975.663 = 227ms` — under the 250ms gate, in both the original Steps-1+2 dataset and the final Steps-E+F-corrected 501-row dataset (verified directly: `step_h_final_corrected_501.json` row 348 carries `onset_error_sec: 0.227`, unmodified by either correction, since segment 321 was never in the original 40-failure list). Both the reference and FA were wrong together, by similar amounts, in the same wrong place — a blind spot no distance-based or magnitude-based gate can catch on its own. Segment 321 only entered this investigation at all because Step H's fresh-batch export happened to sample it as a "next-closest by corrected error" filler item; only the human listener's direct audition caught it. **This is reported as a real, disclosed blind spot in the measurement methodology, not generalized** — it is structurally tied to segment 320 being the corpus's only total-alignment-failure segment, confirmed unique by the same zero-token sweep.

Programmatic verification of all 32 clips (`transcript-audit`, matching each clip's absolute time window against the raw transcript, ordered-prefix containment test against the manifest's claimed `script_text`; full table `docs/measurements/phase3-step-i-transcript-audit.csv`):

| Batch | Clips checked | Raw prefix-test FAIL | Genuine content mismatch |
|---|---|---|---|
| Batch 1 (Step C, 12 clips) | 12 | 2 (clip_10, clip_11) | **0** |
| Batch 2 (Step H, 20 clips) | 20 | 2 (clip2_02, clip2_11) | **1** (clip2_11 only) |

Four raw FAILs, but three are already-explained, benign instances of the SAME pattern this pass's own Step K formalizes below (an unscripted heading recitation precedes the flagged word inside the clip, so the manifest's segment text appears later in the heard audio than a naive first-4-words prefix test expects — not a mismatch, a truncation of where the correct content sits): clip_10 (segment 383, heard `"Level 10 The one the fire remembers You are 64..."` — "You are 64" is exactly right, just not first), clip_11 (segment 307, heard `"...The one who teaches what cannot be taught easily You are 49"` — same pattern, already explained by Step G), clip2_02 (segment 224, heard `"6 The one they follow you are 33..."` — same pattern, see Step K). **Only clip2_11 is a genuine mismatch** — its heard text (`"problem is what happens when the body's warning triggers a second sig[nal]..."`) contains zero of segment 321's own script words. **Consequence for C1-C5 and the FA-tracks-human finding: it survives intact.** Neither segment 320 nor 321 appears anywhere in the original 12-clip batch (confirmed: batch 1's flagged segments are 154/301/1/442/21/383/169/307 plus four early controls — none is 320 or 321), and the zero-FA-token sweep confirms segment 320 is the *only* segment in the whole corpus capable of producing this specific cascade. C1-C5's scoring, and the "FA tracks human to 12-39ms on 6 of 7" headline, are unaffected — the original 12-clip batch is clean.

*Step J — score the 17 valid, non-held-out clips (excludes clip 11 per Step I; clips 9 and 15 held aside per instruction, scored in Step K).* `score-batch2` reads the human labels, `step_h_answer_key.json`'s FA/silencedetect coordinates, and a fresh run of the already-committed `phase3-breath-aware-reference.py` against all 20 clips' silence windows (Step F's own corrected-reference method, applied here for the first time to genuinely unseen material). Full table: `docs/measurements/phase3-step-j-batch2-scored.csv`.

| Clip | Seg | Kind | Breath | FA onset | SD onset | F-corrected | Human B | FA−human | SD−human | F−human |
|---|---|---|---|---|---|---|---|---|---|---|
| clip2_01 | 24 | unresolved | no | 68.712 | 68.578 | 68.577 | 68.580 | **+131.6ms** | −2.7ms | −3.0ms |
| clip2_02 | 224 | unresolved | no | 666.765 | 666.396 | 666.397 | 667.647 | **−882.2ms** | −1251.0ms | −1250.0ms |
| clip2_03 | 6 | control | no | 19.814 | 19.799 | 19.801 | 19.798 | +16.2ms | +1.4ms | +3.0ms |
| clip2_04 | 26 | control | no | 74.141 | 74.123 | 74.099 | 74.120 | +20.9ms | +3.1ms | −21.0ms |
| clip2_05 | 16 | control | no | 42.362 | 42.331 | 42.438 | 42.340 | +22.3ms | −8.4ms | +98.0ms |
| clip2_06 | 11 | control | **yes** | 29.191 | 29.198 | 29.208 | 29.197 | −5.7ms | +1.2ms | +11.0ms |
| clip2_07 | 18 | unresolved | no | 48.772 | 48.668 | 48.842 | 48.667 | +105.4ms | +1.4ms | +175.0ms |
| clip2_08 | 319 | unresolved | no | 972.332 | 972.236 | 972.362 | 972.231 | +101.5ms | +5.0ms | +132.0ms |
| clip2_10 | 33 | control | no | 98.324 | 98.305 | 98.301 | 98.302 | +22.3ms | +3.1ms | −1.0ms |
| clip2_12 | 42 | unresolved | no | 128.153 | 127.823 | 127.829 | 129.451 | **−1298.1ms** | −1628.4ms | −1622.0ms |
| clip2_13 | 36 | control | **yes** | 106.073 | 105.631 | 106.139 | 106.022 | +50.8ms | −391.6ms | +117.0ms |
| clip2_14 | 437 | unresolved | **yes** | 1387.791 | 1387.543 | 1387.930 | 1387.809 | −18.3ms | −266.4ms | +121.0ms |
| clip2_16 | 108 | unresolved | **yes** | 328.842 | 328.657 | 328.923 | 328.852 | −10.1ms | −195.1ms | +71.0ms |
| clip2_17 | 89 | unresolved | **yes** | 268.993 | 268.778 | 269.028 | 269.014 | −20.8ms | −236.3ms | +14.0ms |
| clip2_18 | 355 | unresolved | **yes** | 1096.931 | 1096.737 | 1097.100 | 1096.943 | −11.6ms | −205.9ms | +157.0ms |
| clip2_19 | 43 | control | no | 131.564 | 131.538 | 131.526 | 131.536 | +28.3ms | +2.1ms | −10.0ms |
| clip2_20 | 3 | control | no | 10.211 | 10.236 | 10.436 | 10.236 | −24.8ms | +0.7ms | +200.0ms |

| | n | FA \|error\| median | FA \|error\| max | SD \|error\| median | SD \|error\| max | F-corrected \|error\| median | F-corrected \|error\| max |
|---|---|---|---|---|---|---|---|
| All 17 scored | 17 | 22.3ms | 1298.1ms | 5.0ms | 1628.4ms | 98.0ms | 1622.0ms |
| Breath (n=6) | 6 | 14.9ms | 50.8ms | 221.1ms | 391.6ms | 94.0ms | 157.0ms |
| No-breath (n=11) | 11 | 28.3ms | 1298.1ms | 3.1ms | 1628.4ms | 98.0ms | 1622.0ms |

**Two controls (clips 4, 7 by the failure/control split, i.e. the 8 clip2_0x/1x rows marked `control`) plus every genuinely ordinary boundary pass cleanly on all three references — the two catastrophic outliers (clip2_02/seg224 at −882ms to −1251ms, clip2_12/seg42 at −1298ms to −1628ms) are exactly the two boundaries Step H's corpus re-score already flagged as the final 2-of-501 unexplained residuals.** Excluding those two (both independently confirmed in Step K below to be a different, already-understood defect class, not a fresh FA failure): FA's worst remaining error across the other 15 scored clips drops to **131.6ms**, silencedetect's to 391.6ms, F-corrected's to 200.0ms — all comfortably under the 250ms gate. **The corrected breath-aware reference (Step F) does NOT hold up as an unqualified pass on this genuinely blind batch** — it is not tuned to these clips (Step F's thresholds were fixed from generic acoustic convention before Step C, and never touched again), but it is also not uniformly better than raw silencedetect here: on 8 of the 17 scored rows F's error exceeds SD's (e.g. clip2_05 +98.0ms vs SD's −8.4ms; clip2_20 +200.0ms vs SD's +0.7ms), because the acoustic breath/speech classifier occasionally fires past the TRUE onset into ordinary trailing consonant energy on a clean, non-breath control — a real, disclosed cost, not hidden. **On genuine breath clips it is a clear net win over SD** (6 clips: F median 94.0ms vs. SD's 221.1ms), consistent with Step F's own original 12-clip result, but it is not a strict improvement on every boundary, and per instruction this finding is reported as-is — **nothing was retuned after seeing these numbers.**

**Breath mechanism, re-tested on genuinely unseen material — holds, with one honest qualification.** Comparing silencedetect's declared pause-end against the human-reported breath ONSET (not human B) for the 6 scored breath clips, matching C3's exact methodology: clip2_13 (13.4ms from breath onset), clip2_14 (1.6ms) — both essentially exact, the classic Step-C-style bias; clip2_16 (204.9ms), clip2_17 (102.7ms), clip2_18 (91.1ms) — a real but looser bias, still landing inside or near the breath region rather than at the true onset; clip2_06 is the exception — silencedetect lands 406.2ms from breath onset but only **1.2ms from human B**, because this breath (only 126ms, entirely inside a wider 608ms silencedetect interval) never crosses the fixed −45dB floor at all, so the detector correctly runs through it to the true word onset. **5 of 6 scored breath clips show silencedetect biased toward the breath region (91-406ms from true onset); 1 of 6 shows no bias because the breath itself was too quiet to trip the fixed threshold.** The mechanism from Step C/F is confirmed as the dominant pattern, not universal — a breath's own loudness relative to the fixed floor determines whether it biases the detector at all, an honest refinement Step F's file-adaptive detector already handles correctly (breath=True on 5 of these 6, matching human ground truth on all but the untriggered case).

*Step K — unscripted spoken headings, treated as a class.* Searching the full raw V6 transcript for the literal token "Level" (`heading-sweep`, full table `docs/measurements/phase3-step-k-heading-sweep.csv`) finds **exactly 10 occurrences, one per chapter, spanning the entire file** — not 3, the number this investigation had accumulated incidentally before this sweep (segment 307 from Step G, segments 2/12 i.e. 224/42 flagged by the listener this round). All 10 sit precisely at a chapter boundary — the last word of one chapter's final segment, then the "Level N" recitation (itself absent from every segment's script text), then the first word of the next chapter's first segment:

| Heading time | Preceding segment | Following segment | Dead-audio gap |
|---|---|---|---|
| 0.08s | (file start) | seg 1 | — |
| 125.54s | seg 41 ("it.", ends 125.12) | seg 42 ("You", starts 128.15) | 3.03s |
| 251.56s | seg 84 ("asking.", ends 249.89) | seg 85 ("You", starts 253.97) | 4.09s |
| 371.54s | seg 124 ("hands.", ends 370.09) | seg 125 ("You", starts 373.99) | 3.89s |
| 522.00s | seg 175 ("arguing.", ends 521.51) | seg 176 ("You", starts 526.38) | 4.88s |
| 663.91s | seg 222 ("time.", ends 662.24) | seg 223 ("You", starts 665.03) | 2.79s |
| 789.26s | seg 265 ("end.", ends 788.00) | seg 266 ("You", starts 792.42) | 4.42s |
| 925.14s | seg 306 ("working.", ends 924.77) | seg 307 ("You", starts 929.34) | 4.57s |
| 1044.72s | seg 339 ("you.", ends 1044.64) | seg 340 ("You", starts 1050.22) | 5.58s |
| 1189.76s | seg 382 ("now.", ends 1188.26) | seg 383 ("You", starts 1192.52) | 4.26s |

**All 10 are absent from every segment's script text — confirmed directly for 5 (segments 1, 42, 224, 307, 383, all with either human ground truth or exact raw-transcript quotes above), presumed by structural uniformity for the other 5** (identical recitation pattern, identical chapter-boundary position, never independently checked by ear). **How the current pipeline attributes their 2.79-5.58s (median ~4.2s) of dead-to-the-script audio: split arbitrarily between the two neighbouring segments, at whatever point a spurious/stale silencedetect interval happens to land inside the heading recitation** — verified directly on the 4 sampled cases with known boundary coordinates: segment 42's committed boundary lands 63% through its "Level two" heading (absorbing the silence + "Level two The" into the PRECEDING segment 41's own duration, leaving segment 42 to start mid-recitation on "boy who carries fire"); segment 224's lands 92% through "Level 6" (nearly the whole heading absorbed by segment 223); segment 383's and 307's land roughly 47-49% through (near an even split). **Consequence for FA, stated plainly: FA has nothing to align to during a heading, because neither neighbouring segment's script text occurs there** — the boundary is decided entirely by silencedetect's own candidate silences, which are typically internal PAUSES WITHIN the heading itself (e.g. between "Level two" and "The boy who carries fire"), so the resulting cut lands at an essentially arbitrary point inside unscripted content, corrupting the ON-SCREEN TIMING of both neighbouring segments (the preceding segment's asset plays into part of the heading; the following segment's asset starts mid-recitation) in a way this investigation's word-onset-only scoring cannot see or penalize, since neither segment's OWN script word ever needs to be found inside the heading — only its own word's own placement is scored, and (per Step J) that placement is often still hundreds of milliseconds to over a second off, but for a different, correlated reason (the search window itself is corrupted by the same unscripted content).

**Clips 9 and 15, resolved — a different class, not headings.** Cross-referencing both against the raw transcript around their flagged windows: **clip2_09 (segment 264)** has no heading nearby; the true gap between "...temporary." (781.900s) and "The dark..." (781.960s) is only **60ms** — an ordinary fast, connected reading with essentially no real pause at all — while the flagged silencedetect interval (780.705-781.203s) sits stranded inside the PRECEDING sentence's own "is temporary" span, a stale-pause-selection instance (Step E's known mechanism, applied here to a target Step E's own 446-boundary sweep never covered, since segment 264 was never part of the original 40-failure list or Step A's 6 residuals). **clip2_15 (segment 293)** is a well-behaved breath case — FA (5.2ms), the F-corrected reference (2.0ms), and human B agree closely; the human's own perceived "A" endpoint (0.692s local, ~300ms earlier than the flagged pad point) reflects ordinary vocal trailing-decay ambiguity on "...yours", not a structural defect. **Neither is the heading class.** A targeted keyword sweep of the full raw transcripts for the 173-project (1836 tokens) and the Spanish project (363 tokens) — searching for "Level"/"Chapter"/"Part"/"Section" and the Spanish equivalents "Nivel"/"Capítulo"/"Parte" — found the two 173-project hits ("squad **level**", "familiar **part** ends") are ordinary in-sentence usage, not chapter markers, and zero hits in Spanish. **This specific defect class (spoken, unscripted chapter-heading recitations) appears to be a V6-specific narration-style artifact** (V6 alone uses a "Level N" chapter convention; neither other project does) — 10 confirmed/highly-likely occurrences in V6, none found in 173 or Spanish by this bounded keyword sweep. This is not an exhaustive script-vs-transcript diff for the other two projects (a much larger undertaking), so absence-of-evidence there is reported as exactly that, not as proof no other unscripted content exists in either.

*Step L — segments 42 and 224.* **Both appear in this batch** — segment 224 is clip2_02, segment 42 is clip2_12, both members of Step H's "worst-remaining residuals" selection (the same 2 boundaries that were still >250ms after Steps E+F, per Step H's corpus re-score). Human labelling: clip2_02 — A=2.529s, no breath, B=2.876s (local); clip2_12 — A=2.920s, no breath, B=3.144s (local). Both show the identical signature already explained by Step K above: the human's own A/B fall roughly 1.5-1.9s past the flagged silence's own pad point, because a full "Level N ..." heading recitation (Level 6 / Level two respectively) sits between the flagged (stale) silence and the segment's true content. **Segments 42 and 224 are now fully explained, not merely re-confirmed as unexplained** — they are the two most severe examples of the same heading-recitation class Step K formalizes, not a novel or mysterious residual as Step H's own text had to describe them at the time. This closes the "entirely unexamined by any ground truth" status Step A/H both assigned them.

### Phase 3 -> Phase 4 handoff — Steps M-P (pre-implementation baseline, 2026-08-06)

**Scope discipline, stated up front and honored throughout: no Rust changes, no timing-source swap, no Viterbi, no contract amendment. Everything below is capture and measurement, run against unmodified HEAD `c4fc289`.**

#### Step M — Golden baseline of current behaviour

Full methodology, provenance, and the exact real-code call sequence used:
`docs/measurements/phase4-baseline-methodology.md`. Summary: a vitest harness
(`scripts/phase4-handoff-replay-sync.test.ts`) replays the real, unmodified,
currently-shipped Apply-Sync pipeline (`App.tsx`'s `cachedTokensReady`
branch, `useWhisper.ts`'s `alignSegmentsFromCachedTranscript`, verbatim call
sequence — zero reimplementation) against each project's own scene doc/
script text and the already-captured turbo Whisper token output (unchanged
since Phase 2a Step 5's resync — no `src/` file the pipeline touches has
changed since, confirmed pass-by-pass through Phase 2b and every Phase 3
sub-pass). One disclosed substitution: `snapCoveredBoundaries` needs a
`SilenceInterval[]`, which in production comes from `silenceDetector.ts`'s
Web-Audio RMS/dB scan (unavailable outside a browser) — a line-for-line
Python port of that exact algorithm
(`scripts/phase4-handoff-app-silence.py`) was run against the same 16kHz WAV
transcode instead, a sub-frame-quantization-only approximation of decoding
the original file.

All three projects reproduced cleanly (no abort, `gate.aborted: false` on
all three) and independently cross-validated three already-published
findings without being told the answer in advance (see the methodology
doc's own section for detail) — the strongest available evidence this
replay is faithful, not silently wrong:

| Project | Parsed | Kept | Skipped | Total committed duration | audioDuration |
|---|---|---|---|---|---|
| V6 | 447 | 444 | 3 (segments 27,28,29 — the known flash-attention content dropout) | 1421.29s | 1421.29s |
| 173 | 175 | 172 | 3 (segments 0,12,111 — 0-indexed; segment 111 = 1-based segment 112, Phase 2b's Finding 2 hypothesis, now DIRECTLY CONFIRMED by running the real pipeline rather than inferred from token evidence) | 709.01s | 709.01s |
| Spanish | 27 | 26 | 1 (segment 0, "Scylla." alone, 0 of 1 words matched) | 92.04s | 92.04s |

Key Invariant (b) (`CLAUDE.md`) — sum of committed content-segment durations
equals `audioDuration` — holds exactly on all three, to the millisecond.

**Committed files** (versioned, diffable against a future post-Phase-4 run):
`docs/phase4-baseline-{v6,173,spanish}-segments.csv` (per-segment committed
start/end/text/tag), `docs/phase4-baseline-{v6,173,spanish}-words.csv`
(per-word Whisper token timings — the full, un-1000-row-capped transcript),
`docs/phase4-baseline-{v6,173,spanish}-skipped.csv` (skip records with
match/confidence/longest-run), `docs/phase4-baseline-{v6,173,spanish}-silences.csv`
(the RMS-detected silence array each project's boundaries were snapped
against). Model/commit/ffmpeg/hardware provenance recorded once at the top
of `docs/measurements/phase4-baseline-methodology.md` rather than repeated per file.

**One project could not be reproduced from committed inputs as originally
hoped, stated plainly rather than fabricated:** Spanish has no persisted
post-sync `project.json`-style backup (already flagged in this document's
Step 4 entry — "declined to reconstruct"). This handoff DID reconstruct it —
not by guessing, but by running the real `parseProjectData` against the
real `Spanish Sync.txt`/`Spanish Script.txt` and the real captured Spanish
Whisper tokens, i.e. exactly the same real-code replay used for V6/173. The
gap that remains open is narrower than the original one: no *independently
authored* committed-segment snapshot exists to diff this replay against, so
its correctness rests on the methodology doc's cross-validation evidence
(the V6/173 replays matching already-published findings) rather than a
direct Spanish-specific check. This is disclosed, not hidden.

#### Step N — Closing the two open measurement gaps

**N.1 — Spanish forced alignment, run for the first time.** MMS-FA
(`scripts/measure-forced-alignment.py`, `--language es`, `uroman`
romanization — language-agnostic by construction, per Blocker 1's own
finding) against the 26 kept segments from Step M's own committed timing
(a *tighter, more accurate* window than V6/173's original FA runs got,
which used stale base.en-era timings — noted as a methodology improvement,
not a like-for-like rerun) and Spanish's `silences.json` (ffmpeg
`silencedetect`, the same independent ground truth every other Phase 1b-3
measurement in this document uses — NOT the RMS silences Step M used for
the production replay; the two silence sources serve different purposes
and must not be conflated).

| | Spanish MMS-FA | Gate |
|---|---|---|
| n scored pauses | 22 | — |
| Median abs error | 61.2ms ✓ | ≤100ms |
| **p95 abs error (PRIMARY)** | **282.1ms ✗** | ≤250ms |
| Negative-smear fraction | 9.1% ✗ | <1% |
| Zero-duration real-word tokens | 0 ✓ | 0 |
| Wall-clock (92.04s audio) | 19.9s (≈4.62× realtime) | — |
| Peak RSS | 3.23 GiB | — |

**2 of 4 readings fail** — the same shape as V6 (3/8 fail) and better than
173 (which passed cleanly): p95 fails, but narrowly (282ms vs. 250ms, a
32ms miss on a 22-pause sample — this is well inside the kind of sampling
noise a 22-pause set can produce; V6's own p95 needed corpus-wide breath/
stale-pause correction across 501 pauses before it cleared the gate, and no
equivalent correction pass has been run for Spanish). Negative-smear fails
for the same already-established structural reason (Step D) — expected on
any accurate, symmetric-noise source, not evidence of a Spanish-specific
problem. Zero-duration tokens: clean pass. **One real, Spanish-specific
finding**: 1 segment ("y 12 patas debajo de su cuerpo", segment 005) had one
word — the digit "12" — dropped as unrepresentable by `uroman`'s
romanization (digits are not romanized to the 28-symbol vocab), the exact
digit-reading limitation Blocker 1's de-risking follow-up already
documented for jonatasgrosman on English; **now confirmed the same
limitation applies to MMS-FA itself, on a non-English project, for the
first time.** Full data: `docs/phase3-onset-spanish-fa.csv`.

**Spanish was the original reason for Phase 2a** (H.8's Spanish-or-French
corpus requirement) — this run means Spanish now has real forced-alignment
evidence, not zero. It is a favorable result (median passes, p95 misses
narrowly on a small sample, no cascade-class failure, no zero-duration
tokens) but it is **one 22-pause sample**, the same caveat Step C already
applied to V6's own 12-clip human-labeled sample — not enough to certify a
Spanish-specific gate pass on its own, and **still entirely unlistened** —
no Spanish speaker's ear has verified a single boundary. The Stage 1 lock
gate's existing written acceptance for Spanish (Phase 2a's entry, reopening
at Phase 3b) is unchanged by this measurement.

**N.2 — jonatasgrosman (Apache-2.0) run on V6 and Spanish, completing the
matrix Task 2 started on 173 alone.** `scripts/measure-forced-alignment-hf.py`
gained a `--model-id` parameter (additive, defaults to the English fine-tune
already used for 173 — every prior invocation of this script is
byte-unaffected) so the Spanish-language fine-tune
(`jonatasgrosman/wav2vec2-large-xlsr-53-spanish`) could be measured with
zero duplicated code. V6 used the same stale `v6-segments-full.json`
windows the original V6 MMS-FA run used, for a true apples-to-apples
comparison on identical boundaries (matching the precedent already set for
173's own fa-vs-hf comparison).

| | V6 MMS-FA (fa2) | V6 jonatasgrosman (hf) | 173 MMS-FA | 173 jonatasgrosman | Spanish MMS-FA | Spanish jonatasgrosman | Gate |
|---|---|---|---|---|---|---|---|
| Median abs error | 21.2ms ✓ | 25.8ms ✓ | 22.3ms ✓ | 27.5ms ✓ | 61.2ms ✓ | 61.2ms ✓ | ≤100ms |
| **p95 (PRIMARY)** | 476ms ✗ | 400.8ms ✗ | 69.9ms ✓ | 89.7ms ✓ | 282.1ms ✗ | 282.1ms ✗ | ≤250ms |
| Negative-smear | 49.0% ✗ | 49.7% ✗ | 42.3% ✗ | 44.8% ✗ | 9.1% ✗ | 9.1% ✗ | <1% |
| Zero-dur tokens | 0 ✓ | 0 ✓ | 0 ✓ | 0 ✓ | 0 ✓ | 0 ✓ | 0 |
| Wall-clock | 349.5s | 318.0s | 112.7s | 143.97s | 19.9s | 16.3s | — |
| Peak RSS | 4.01 GiB | 3.26 GiB | 3.98 GiB | 3.19 GiB | 3.23 GiB | 2.58 GiB | — |
| Failed segments (CTC) | 1 (seg 320) | 1 (seg 320) | 0 | 0 | 0 | 0 | — |

**Reading it: V6 confirms 173's finding, at scale.** jonatasgrosman is
within noise of MMS-FA on V6 too (25.8ms vs. 21.2ms median; 400.8ms vs.
476ms p95 — jonatasgrosman is actually slightly *better* on V6's p95, not
worse), and **both models fail on the exact same V6 segment** (320, "targets
length is too long for CTC") — independent, model-agnostic confirmation
that segment 320's problem is a pre-existing committed-duration defect (a
4.5x undercount, see Step O item 1), not an artifact of either aligner.
**Consequence for H.3's commercial path, now stated with V6 evidence
in hand, not just 173's:** jonatasgrosman remains numerically viable at
scale — the ~28% wall-clock cost and ~1.2GB-per-language footprint from the
173-only measurement hold on the 2x-larger V6 project too, and its
accuracy gap against MMS-FA is noise-level on both projects measured so
far. Parakeet's unverified CTC-extractability remains correctly out of
scope.

**Spanish: the two models converge almost exactly** (61.2ms/282.1ms/9.1%
identical to 1 decimal place on both). Verified this is genuine convergence,
not a scoring-script bug re-reading the same file: the raw per-word token
arrays differ between the two models on nearly every word (e.g. "Scylla"
resolves to `start=0.341, score=0.5163` under MMS-FA vs. `start=0.321,
score=0.0344` under jonatasgrosman — a real, if small, difference) — the
scored PAUSES the four-threshold table reads simply happen to select
near-identical words at near-identical positions on this particular
92-second, cleanly-recorded clip, at the resolution the two-decimal metrics
report. jonatasgrosman's Spanish weights (`pytorch_model.bin`, ~1.18GiB)
required a full cold download that stalled repeatedly on this session's
network (three automated attempts — `huggingface_hub`'s own downloader
twice, a bare `curl` once — all stalled indefinitely partway through
despite active TCP connections; a retry-hardened `curl` with a speed-floor
timeout made slow but genuine progress before the user completed the
download manually and supplied the file directly). Wall-clock/RSS above are
from a subsequent `HF_HUB_OFFLINE=1` run against the manually-placed weights
— the alignment itself is unaffected by how the weights arrived on disk.

#### Step O — Known-defect inventory (Phase 3, all passes)

Enumerated per instruction — specification of a structural check only,
nothing implemented. "Gate-catchable" means one of the four finalized Stage
1 numeric thresholds (median ≤100ms, p95 ≤250ms, negative-smear <1%,
zero-duration-tokens = 0) would flag the instance; several defect classes
below are invisible to all four by construction, which is exactly why this
inventory was asked for.

| # | Defect class | Instances found | Projects | Gate-catchable? | Structural check (spec only) |
|---|---|---|---|---|---|
| 1 | Zero-aligned-token / CTC-constraint-violation segment (committed slot too short for its real speech to fit any alignment window) | 1 (V6 segment 320: 1.27s slot, ~5.8s real speech, 4.5x undercount) — now confirmed model-independent (MMS-FA and jonatasgrosman both fail identically, Step N.2) | V6 only; 173/Spanish confirmed clean (0 failed segments each, checked directly) | **NO** — the cascade it caused on segment 321 scored 227ms, under the 250ms gate, in every dataset version before the human listener caught it (Step I) | Assert every segment has ≥1 aligned token after alignment; separately assert a segment's committed duration is plausible for its character count (a minimum-plausible-speaking-rate floor) |
| 2 | Unscripted spoken headings / chapter markers | 10 (5 directly confirmed, 5 by structural uniformity) — V6's "Level N" convention | V6 only; a bounded (not exhaustive) keyword sweep found none in 173 or Spanish | **PARTIALLY** — large raw errors were visible, but attributed to "FA inaccuracy" until Step K's transcript sweep found the real cause | Detect a sustained transcript-covered, zero-script-mapped gap between two segments' matched spans (a "dead-to-script" run check); optionally a project-configurable chapter-marker vocabulary scan |
| 3 | Stale-pause / detector-coverage-gap selection (no real candidate silence exists anywhere near the true onset) | 3 (V6 segments 1, 307, 383) | V6 only examined | **PARTIALLY** — large errors visible (1004-2139ms) but misattributed to FA rather than to a reference/detector gap without Step E's audit | Max-plausible-attribution-distance guard (already specified numerically: 1.0s, from the clean population's own p99 doubled) — reject an attribution beyond it rather than silently keeping a stale one |
| 4 | Breath-vs-boundary silence misclassification | Dominant mechanism behind 37 of the original 40 V6 failures; on the fresh genuinely-blind batch, silencedetect biased 91-406ms toward breath onset on 5 of 6 human-confirmed breath clips | V6 examined in depth; not characterized on 173/Spanish | **NO** without ear verification — raw onset-error numbers alone cannot distinguish "FA is wrong" from "the reference silence is a breath" | The acoustic breath classifier (Step F, 4 frame-level features) is a candidate signal, but does NOT hold up as an unconditional improvement (regressed 8 of 17 clean-control rows in the genuinely blind Step J batch) — spec as "flag for review," not "auto-correct," pending further calibration |
| 5 | "it."/short-trailing-word SCORER misattribution (measurement-harness bug, already fixed in the harness — listed so a future re-measurement doesn't rediscover it as new) | 12 (V6), fixed at Step 1 of the data-cleaning pass | V6 (173 negligibly affected — 1 row, no median/p95 change) | N/A — this is a bug in the measurement tool, not the production pipeline | Already fixed (`score_onset_errors`' overlap gate); no production check needed |
| 6 | ASR content dropout (flash-attention artifact) | 1 confirmed (V6 segments 27-29, ~9.7s) | V6 confirmed; not exhaustively checked elsewhere | **NO** — content is entirely absent from the transcript; no token exists to score | No threshold catches this by construction; production's own skip mechanism already surfaces it as a silent timeline gap (confirmed by this handoff's own Step M replay — segments 27-29 ARE skipped today) rather than a wrong timestamp |
| 7 | 173 segment 112 turbo-era word-drop / run-survival-gate failure | 1 — now DIRECTLY CONFIRMED by Step M's live-pipeline replay (Phase 2b had only hypothesized this from token evidence) | 173 | **YES** — this is the run-survival gate correctly catching a real defect, included for closure, not as an escaping case | None needed — already working as intended |
| 8 | Small-scale systemic word drops (turbo accuracy trait, beyond item 6) | Several named instances (Three, No, afraid, Fen's, part of Thick, part of Catachan) — not exhaustively counted in the source passes | V6 | **PARTIALLY** — visible only when the drop produces a zero-duration token (item 9's threshold), invisible when the word is dropped cleanly | Zero-duration real-word-token count (already one of the four finalized thresholds) |
| 9 | CTC constraint violations as a measurement-harness/integration-design concern (the mechanism behind item 1) | Same instance as item 1 | V6 | N/A (harness-level) | The eventual Rust integration needs an explicit skip-and-flag path for "target text doesn't fit the alignment window," matching this codebase's established graceful-degradation precedent (`filterMalformedTokens`, the coverage gate, the silence-scan-error fallback) — not a silent crash |
| 10 | Word-shift defect residuals (the original item motivating this programme) | 3: 2 unexplained-and-failing, 1 newly identified as structurally unfixable by a timing-source upgrade (`seasons than you \|\| can count and` — clean cut at a real pause that disagrees with the SCRIPT's own sentence break) | V6 | **NO**, by design — none of the four thresholds targets "does the cut match the script's intended break," only "does it match an acoustic pause" | None proposed; explicitly out of scope for a purely acoustic timing-source upgrade |
| 11 | Lock preservation broken across resync (K13) — unrelated to timing source, a Stage 3 concern surfaced during Phase 0 | 100% reproducible (any locked segment, any resync) | Confirmed on 173; presumed universal (root cause is structural, not project-specific) | **NO** — not covered by any Stage 1 timing threshold | Already specified (Part D/K13): a dedicated repro-based Stage 3 lock-gate test (lock two overlapping segments, Apply Sync, confirm both position and lock flag survive) — not yet built |
| 12 | Negative-smear gate is structurally non-discriminating (a gate-DESIGN defect, not a pipeline defect) | Confirmed analytically (Step D): an accurate, symmetric-noise source reads ~50% by the literal sign-only test, on every project/model measured in this document (Whisper, MMS-FA, jonatasgrosman, all three projects) | All | **N/A** — this IS one of the four gates, found to be unable to discriminate what it was built to catch | Needs a redesign (e.g. magnitude-weighted or distribution-shape-based), not a threshold retune — flagged for the owner, not actioned |

#### Step P — Cost and rollback

**Current end-to-end sync wall-clock and peak RSS, today's shipped pipeline
(Whisper turbo raw, config (a) — no FA, no DTW), grounded in numbers
measured on this machine, this commit lineage:**

| Project | Whisper wall-clock | xRT | Whisper peak RSS | Alignment+snap wall-clock |
|---|---|---|---|---|
| V6 (1421.3s audio) | 834.9s (Phase 2b, 2026-08-05) | 1.70× | ~2.1-2.2 GiB (H.9) | sub-second (Step M's replay: all 3 projects' full alignment+snap pipeline together = 3.69s vitest test time) |
| 173 (709.0s audio) | 452.3s (Phase 2b, 2026-08-05) | 1.57× | not separately captured in Phase 2b; consistent with the model-weight-dominated pattern confirmed on V6 and Spanish (below) — not re-measured here to avoid an ~8-minute rerun for a number already well-constrained by that pattern | sub-second |
| Spanish (92.04s audio) | **108.5s (measured fresh, this pass)** | 0.85× (fixed model-load cost dominates a short clip) | **2.18 GiB (measured fresh, this pass)** | sub-second |

Whisper transcription is >99% of current sync wall-clock on every project
measured — the entire alignment/Hirschberg/snap/head-extend pipeline (Step
M's replay) runs in low single-digit seconds for all three projects
combined, confirming the FA/HF cost comparisons below are the real
second-order cost, not a rounding error against something already slow.

**Cost of adding a forced-alignment pass (architecture (A) — both models
run every sync, sequential), per project, using the actual measured
numbers rather than V6's figure alone:**

| Project | Whisper only | + MMS-FA | Increase | + jonatasgrosman | Increase |
|---|---|---|---|---|---|
| V6 | 834.9s | 1184.4s | **+41.9%** | 1152.9s | +38.1% |
| 173 | 452.3s | 565.0s | **+24.9%** | 596.3s | +31.8% |
| Spanish | 108.5s | 128.4s | **+18.3%** | 124.8s | +15.0% |

**The percentage overhead is project-size- and pause-density-dependent, not
a fixed universal figure** — V6's own +41.9% (the number this document has
cited throughout Phase 3) is the LARGEST of the three measured, not
representative of the smaller projects. A short project like Spanish pays
proportionally less because Whisper's fixed per-run model-load cost (not
audio-length-dependent) is a larger fraction of its own already-slow
(sub-realtime) baseline, while FA's own per-segment cost scales more
directly with segment count. Stating a single "+42%" figure for the whole
programme, as prior passes have done informally, would be misleading for
anything other than V6-sized long-form content.

**Peak RSS is not additive.** Since Whisper and the forced aligner run
sequentially (Blocker 3's confirmed architecture), the honest combined peak
is `max(Whisper's ~2.1-2.2 GiB, FA/HF's own peak)` — not the sum — **only
if** the Rust integration releases Whisper's memory before loading the
second model; this is a design requirement of the integration, not
something already guaranteed. Measured FA/HF peaks range 3.19-4.01 GiB
across every (project, model) pair measured in this document — so the
practical memory floor rises from today's ~2.1-2.2 GiB to roughly 3.2-4.0
GiB regardless of which commercial-viable candidate is chosen.

**Reversibility.**

- **What is being replaced:** only the WORD-LEVEL TIMESTAMP VALUES inside
  Stage 1's `{text, start, end}` output contract — specifically, Whisper's
  own per-token `start`/`end` fields. Confirmed by Blocker 3: "Part B's
  Stage 1 output contract needs no amendment under this architecture — FA
  is a drop-in replacement for the timing values behind that same contract
  shape, not a new pipeline stage or a new field."
- **What stays unchanged:** Whisper's transcript (word identity and order —
  needed for the Hirschberg alignment's text matching and skip detection),
  the Hirschberg alignment itself, `snapCoveredBoundaries`, `headExtendFirstSegment`,
  and every downstream stage. None of these are aware of which model
  produced the timestamps they consume.
- **Can old and new run side by side for comparison?** Yes, both in
  measurement (already proven — this entire handoff, and every Phase 3
  pass before it, computed FA/HF timing independently of Whisper's own
  timestamps with zero `src/` changes) and, architecturally, in production:
  Stage 1's contract is timing-source-agnostic, so a runtime-gated dual
  path is structurally straightforward — this codebase already ships
  exactly this pattern for an unrelated concern (`useExport.ts`'s
  `isWebCodecsExportGateOpen()`, a capability-probe-plus-persisted-toggle
  gate deciding between two full implementations behind one contract). Not
  yet built for the timing source; noted as a low-risk precedent to follow
  if a gradual rollout is wanted.
- **What rollback looks like if it fails in use:** because architecture (A)
  makes FA a strictly ADDITIVE second pass after Whisper (Whisper still
  runs first, unconditionally, for transcript + matching), rollback is
  "skip the FA pass, use Whisper's own timestamps as today" — no schema
  change, no data migration, since the output contract shape is identical
  either way. This is materially lower-risk than Phase 4's own stage
  restructuring (which changes contracts, not just a timing source inside
  one stage already-fixed contract) — the FA swap is architecturally
  isolated to one step of Stage 1.

### Deliverable summary

Golden baselines captured and committed for all three corpus projects
(Step M); both open measurement gaps closed — Spanish forced alignment run
for the first time, jonatasgrosman completed on V6 and Spanish alongside
its existing 173 measurement (Step N); twelve defect classes inventoried
with instance counts, gate-catchability, and specified (unimplemented)
structural checks (Step O); current wall-clock/RSS cost re-grounded in
fresh measurement rather than V6's figure alone, plus a stated reversibility
plan (Step P). No `src/` file changed. Two Python scripts gained additive
parameters (`measure-forced-alignment-hf.py`'s `--model-id`); one new
Python script (`phase4-handoff-app-silence.py`) and one new TypeScript
harness (`phase4-handoff-replay-sync.test.ts`, vitest-only, not part of the
production build) were added under `scripts/`.

### Phase 4 pre-implementation — Steps Q-T (2026-08-06)

**Scope discipline, honored throughout: no production Rust, no timing-source
swap, no Viterbi, no contract amendment, no threshold retuned. Step Q exports
and integrity-checks a listening batch; Steps R and T are written design only;
Step S is a standalone harness under `scripts/`, outside the app.** Baseline:
HEAD `b49e5d3`, tag `phase3-4-handoff-baseline-2026-08-06`.

#### Owner decisions, recorded verbatim as instructed

1. **Gate:** 250ms p95 is APPROVED as the standard. Human ground truth put FA
   within 12-39ms on English; that is sufficient.
2. **Spanish:** 10-clip human listening pass, not 20.
3. **Models:** `jonatasgrosman/wav2vec2-large-xlsr-53` is the permanent
   standard, all 5 languages (en, es, fr, de, pt), ~1.26GB each, downloaded on
   demand and cached. Installer stays ~100-150MB. No non-commercial model
   ships, ever, not even temporarily.
4. **Windowing:** production-grade design, neighbor-midpoint clamping with
   bounded padding. No measurement-convenience shortcuts.
5. **Structural checks:** all 12 built and proven in an isolated harness before
   any Rust.
6. **fr/de/pt:** loading plumbing now, explicitly labelled UNVALIDATED.
   Real-corpus validation deferred until business demand.
7. **No production Rust in this pass.** Design and harness only.

**Consequence of decision 3, applied immediately across this section: MMS-FA is
now out.** Every MMS-FA number in this document (V6's 21.2ms/476ms, 173's
22.3ms/69.9ms, Spanish's 61.2ms/282.1ms, the whole Blocker 2 arc, Steps 1-4,
A-L) remains valid as *evidence about forced alignment as a technique*, and is
retained unedited for that reason — but it can never ship (CC-BY-NC-4.0). The
shipping numbers are jonatasgrosman's: V6 25.8ms/400.8ms, 173 27.5ms/89.7ms,
Spanish 61.2ms/282.1ms (Step N.2's table). Where the two differ the
jonatasgrosman column is now the one that counts.

**The tension, stated without softening, per instruction.** With 250ms
approved, **Spanish's p95 of 282.1ms FAILS the gate** — by 32.1ms, on 22 scored
pauses, on both candidate models identically. English showed that most of a gap
of this shape was `silencedetect` reference bias rather than FA error (Step C:
FA 12-39ms vs. reference 335-2474ms against human truth on 6 of 7 scored
failures; Step H: corpus p95 338.2ms → 82.2ms from correcting the reference
alone, with FA untouched). **Step Q is what settles whether Spanish is the same
story.** The Spanish number is not adjusted here, and no prediction is recorded
about which way it will go — the batch is exported blinded, the answer key is
held privately, and the verdict waits on the owner's ear. Two outcomes are both
live and both meaningful: if Spanish is reference bias, the gate passes on a
corrected reference and the English finding generalizes; if it is genuine FA
error, a per-language accuracy gap exists that decision 3's one-model-per-
language architecture will have to answer for.

---

#### Step Q — Spanish listening batch

**10 clips exported, blinded, integrity-checked, ready to send.** New committed
script: `scripts/phase4-step-q-spanish-clips.py` (two subcommands, `export` and
`integrity`). Public manifest: `docs/measurements/phase4-step-q-spanish-manifest.csv` (clip
name + script text only, nothing else). Protocol:
`docs/phase4-step-q-listening-protocol.md`. Integrity results:
`docs/measurements/phase4-step-q-integrity-check.csv`. Private answer key: `.answer-keys/`
(see the K8 note below), deliberately not in `docs/`.

**Selection.** 7 failures — every one of the 7 worst-scoring boundaries in the
Spanish MMS-FA dataset (`docs/phase3-onset-spanish-fa.csv`, 22 scored pauses)
by `|onset_error|`: 1085ms, 287ms, 193ms, 167ms, 166ms, 147ms, 141ms. 3
controls drawn from the cleanly-passing rows, chosen for phonetic spread rather
than by rank — a liquid-initial (`las`, +16ms), a vowel-initial (`Aún`, +27ms),
and a plosive-initial (`Cada`, −18ms) — mirroring Step B's finding that
soft-vs-sharp onset class is the strongest predictor of reference error.
Selection is hard-coded in the script by `silence_start` key, not recomputed at
run time, so the batch is reproducible and auditable.

**Protocol, identical to both English batches.** 1.0s padding before the flagged
silence's start, 1.0s after the flagged word's end, sourced from the original
`.m4a` (not the 16kHz working transcode). Opaque `clip3_01`-`clip3_10` names via
a seeded shuffle (seed 7, distinct from Step C's 42 and Step H's 99). Padding
and duration verified programmatically before export: **10/10 exact.** One
disclosed and correct deviation: `clip3_06` has 0.723s of pre-padding rather
than 1.000s, because its flagged silence starts at 0.723s — there is no more
audio before it. That is the clamp working, not a defect.

**Integrity check — run BEFORE sending, per instruction, all 10 clips.** Batch
2's clip 11 was a genuine content mismatch that only a human ear caught, so this
is now programmatic. Each clip was transcoded to 16kHz and transcribed with the
**production** whisper-cli sidecar (`ggml-large-v3-turbo.bin`, `-l es`) — the
same binary and model the app itself ships — then tested three ways:

  (a) **FIRST-WORD** — the manifest segment's own first word is present in the
      clip's heard audio;
  (b) **LEAD-IN** — the words heard *before* it match the tail of the previous
      committed segment's script text;
  (c) **FOREIGN-CONTENT** — every heard word is attributable to either the
      previous segment's tail or the manifest segment itself.

(c) is the sharpest and is the one that would have caught batch 2's clip 11,
whose heard content contained zero of its manifest segment's words.

| Clip | first-word | lead-in | foreign-content | heard (leading) |
|---|---|---|---|---|
| clip3_01 | PASS (exact) | PASS | PASS | "antes de llegar al PSO. Aún así, prepara" |
| clip3_02 | PASS (exact) | PASS | PASS | "aparecen en un solo ataque. El detalle importante" |
| clip3_03 | PASS (exact) | PASS | PASS | "alejarse más. Navegar cerca de silla" |
| clip3_04 | PASS (exact) | PASS | PASS | "La frase entre sillas" |
| clip3_05 | PASS (exact) | PASS | PASS | "suficientemente cerca, las seis cabezas se" |
| clip3_06 | PASS (fuzzy) | PASS | PASS | "Silla. Silla es un monstruo que vive" |
| clip3_07 | PASS (exact) | PASS | PASS | "cada cabeza atrapa a un hombre" |
| clip3_08 | PASS (exact) | PASS | PASS | "cerca del acantilado. Eso significa que la estrategia" |
| clip3_09 | PASS (exact) | PASS | PASS | "Tiene seis cuellos largos." |
| clip3_10 | PASS (exact) | PASS | PASS | "debajo de su cuerpo. Su ataque es sencillo." |

**10/10 pass all three tests.** One result is reported as a *qualified* pass
rather than a clean one: `clip3_06`'s first word is "Scylla", which whisper
consistently transcribes "Silla" — the exact writing convention Step 4's CER
analysis already documented (8 occurrences, ~16 chars of the Spanish edit
distance). The check reports this as `fuzzy:silla(0.73)` with the heard spelling
recorded, not as a silent equality and not as a failure; the content is
genuinely correct. Every other clip matched exactly.

**One structural risk disclosed without identifying the clip** (the protocol doc
carries the same warning): one of the seven failure clips sits at the very start
of the corpus, where no left context exists — the same edge-of-corpus condition
that forced batch 1's clip 3 to be excluded from scoring, and the same condition
behind V6 segment 1's implausible 1.87s one-word FA span. It may prove
unscoreable. Which clip it is stays in the private answer key so the listen is
not biased.

**K8 recurrence, third time, recorded rather than absorbed silently.**
`/tmp/phase3/` is **gone** — verified absent at the start of this session. That
directory held the private answer keys for both English batches
(`step_c_answer_key.json`, `step_h_answer_key.json`), the Spanish FA token
arrays, `emission.pt`, `silences.json`, and the 16kHz working transcodes for
every project. Nothing in `docs/` was lost (every published number is backed by
a committed CSV), and both English batches were already fully scored, so no
conclusion in this document is invalidated — but re-deriving anything that
needed the raw FA per-word arrays now requires re-running
`measure-forced-alignment.py`, and Step S below hit exactly that wall (see C05).
This is the same pattern K8 recorded once and the Blocker 2 recovery recorded
again. **Fix applied this pass, not merely noted:** blinded batches and their
answer keys now live in `.listening-clips/` and `.answer-keys/` at the repo root
— gitignored (so a key never reaches `docs/` where a listener would see it) but
outside `/tmp` (so OS cleanup cannot take them). Stated trade-off: gitignored
means not committed, so a fresh clone still would not have them; that is
accepted, since the observed failure mode is /tmp cleanup, not repo loss.

**Not scored.** This batch awaits the owner's listen, exactly as Step C's and
Step H's did before it.

---

#### Step R — Production windowing design

> **Status update, 2026-08-13 (WS1 Task 5 documentation pass).** This
> section's heading originally read "design only, not implemented" — stale
> as of Task 5 Slice D1 (`e0c9c89`): R.0, R.1 (with the R-O/R-P
> admissibility rulings), R.4, and R.6's boundary shape are implemented in
> `src/services/faAnchors.ts`'s `computeFaAnchors`, verified by direct
> reading. R.2 (padding), R.3 (the clamp's reference-point change), R.5 (the
> CTC wildcard), and R.7-R.9 (failure paths, cascade-safety argument,
> case-by-case prevention table) remain design-only below — genuinely not
> implemented anywhere in `src/` or `src-tauri/src/` as of this update. A
> planned slice (D7) to build the remainder and its own verification method
> was scoped, reviewed, and **cancelled** rather than completed — see
> `docs/work-in-progress.md` §5's D7 row for why (`task5-slice-ledger.md` §2,
> the original source, was deleted 2026-08-14, `9cf5867`; retrieve: `git show
> 251be64:docs/ws1-sync-pipeline/task5-slice-ledger.md`), and its §4 for
> the "Automated Agreement Budget" ruling that replaces the zero-tolerance
> verification approach this document's own text does not specify a
> replacement for.

Every number in Phase 3 came from a window this document itself calls a
measurement convenience: per-segment, `[committed startTime, committed endTime]`,
clamped to the midpoint of the gap to each neighbour. Because the corpus is
perfectly gapless (Key Invariant (f)), that clamp **degenerates to zero padding
on every interior segment** — the window is exactly the committed span, which is
the very quantity under repair. Five distinct failures in this document trace to
it: the 5 Blocker-2 low-confidence rows, segment 320's total CTC failure,
Method 1's neighbour-bleed regression on segments 144/80, segment 96's
window-construction defect (still on the DO-NOT list), and the 10 unscripted
headings. This section specifies the real one.

**R.0 — The governing change.** The unit of alignment stops being the SEGMENT
and becomes the RUN. A run is a maximal contiguous group of committed segments
bounded on both sides by an independently verified anchor. FA receives the
concatenated script text of the whole run against the audio span of the whole
run, in ONE pass; per-segment word attribution is then read off FA's own
word-level output rather than imposed by the input window. This is not a new
idea — it is precisely Method 2 (joint multi-segment context), which this
document already measured resolving cases Method 1's wide-padding bypass made
worse (segments 144 and 80, both from `+0.019s`/`+0.038s` error at ~0.9-1.0
confidence). Method 2 worked because there is no "neighbour" to bleed into when
the window *is* the neighbours, carrying their own real transcript.

**R.1 — Anchors: how a run's edges are chosen.** A time `t` is an anchor for
script word `w` only when **three independent sources agree within
`ANCHOR_AGREEMENT_SEC` (0.15s)**:

  (a) the Hirschberg alignment maps `w` to a specific Whisper token (unchanged
      — architecture (A) retains Whisper for matching and skip detection);
  (b) that token's declared onset;
  (c) a detected silence interval ends immediately before it.

Plus two admissibility rules, both derived from findings already in this
document rather than invented here:

  * `w` must be **distinctive** — not a function word. Step B measured
    glide-initial boundaries (almost entirely "You"/"Your"/"When"/"We") at
    14.1% >250ms and p95 368.8ms, the worst fine-grained bucket in the corpus,
    while plosive- and affricate-initial boundaries read a clean **0.0%**
    corpus-wide. Anchoring on the class that fails 14% of the time is the
    single most avoidable design error available here.
  * `w`'s Hirschberg match must sit inside a contiguous matched run of at least
    `MIN_ANCHOR_RUN` (4) words — the same evidence standard the shipped
    run-survival gate already applies to keep a segment at all
    (`RUN_SURVIVAL_MIN_RUN_LONG`, `syncConstants.ts`). Reusing the existing
    constant rather than minting a second, independently-tuned one is
    deliberate.

Anchors are computed **before any FA pass**, entirely from data that already
exists today (Whisper tokens, Hirschberg output, the RMS silence array).

**R-O ruling (owner, 2026-08-12) — "distinctive" was under-specified above and
is now a measurable test, not a lexical stopword list.** The bullet text above
said "not a function word" (LEXICAL — C10's own definition, `MIN_ANCHOR_WORD_CHARS`-adjacent
context below), while its own justification cited Step B's glide-initial
measurement, which is PHONETIC. Those are two different tests and the text
above conflated them. Ruled: the phonetic reading governs R.1(a); C10's
lexical (closed-class-function-word) definition governs C10 only and is not
reused here. `w` is admissible as an anchor only when BOTH hold:

  (i)  `w`, after `canonicalize()`, has at least `MIN_ANCHOR_WORD_CHARS` (3 —
       the only value this project has evidence for, taken directly from
       C10's own "≥3 chars" half of its definition, cited above) characters.
  (ii) `w`'s first canonicalized character is not in `GLIDE_INITIAL_CHARS` —
       seeded from the word-initial glides Step B actually observed in
       English ("You"/"Your"/"When"/"We"): `{w, y}`.

No stopword list is introduced, for English or any of the other 4 supported
languages. The English-measured glide set (`{w, y}`) is applied to all 5
languages deliberately — it is conservative (it can only reject a real anchor,
never admit a bad one), and widening or narrowing it per language needs
measurement this project doesn't have yet, not intuition. Rationale for
biasing toward rejection at all: a rejected anchor costs a longer run, bounded
by `MAX_RUN_SEC` (R.4) — recoverable. A wrong anchor corrupts timing —
unrecoverable without a second pass. The costs are not symmetric, so the test
is deliberately conservative in the rejection direction. Both constants live
in `syncConstants.ts`, never hardcoded at a call site.

**R-R ruling (owner, 2026-08-16) — R.1(c)'s corroboration test is unsound;
items 6/7 fix decided as a rewrite, two rejected alternatives named.** The
ear-pass root-cause diagnosis (`b36f6c2`, independently re-derived `f8250a3`,
both recorded in `docs/work-in-progress.md`'s §11 item 6 addenda) traced
ear-pass items 6 (173, `vessel_damage_clue`: FA 172.91 vs. ear-correct 174.74)
and 7 (v6, `152_frozen_brush_mice`: FA 449.20 vs. ear-correct 451.03) to the
same mechanism: `faAnchors.ts`'s `findAgreeingSilence` (R.1(c)'s
implementation) tests `Math.abs(tokenStartSec - s.endSec) <=
ANCHOR_AGREEMENT_SEC` — a raw Whisper token *timestamp* compared against a
detected silence, exactly the class of failure CLAUDE.md's standing invariant
exists to forbid. Both items share one shape: an anchor fires on a word deep
inside the CORRECT segment's own text (not its first word) because that
word's Whisper timestamp coincidentally sits within 0.15s of an unrelated
real silence, stranding the segment's opening words in the wrong FA chunk at
near-zero confidence.

Four options were on the table: (1) match on token indices instead of
timestamp proximity; (2) require genuinely independent corroboration (a
second, non-Whisper-timing signal) before accepting an anchor; (3) tighten
`ANCHOR_AGREEMENT_SEC` or require minimum spacing between adjacent anchors;
(4) defer wholly to Phase 5's fence.

**Decided: merge (1) and (2).** `findAgreeingSilence` is to be rewritten so
corroboration happens on TOKEN INDICES, not timestamp proximity, and
restructured into two passes so the corroborating source is genuinely
independent of the Whisper output that produced the candidate — a rewrite of
the function's evidence model, not a threshold tweak to its existing
single-pass shape. **Amends R.1(c)** as written above (the "(c) a detected
silence interval ends immediately before it" clause): the corroboration test
must be evidence that the silence actually falls in the matched word's own
token-to-token gap, not proximity between the silence and the word's
*reported* onset — the same precedent `snapBoundaries.ts`'s own
breath/boundary classification already set for the identical problem.
Implementation is Session B (`faAnchors.ts`); this ruling records the
decision only — no `src/`/`src-tauri/` file is touched this session.

**Options (3) and (4) explicitly rejected, not merely deferred.** (3) —
tightening `ANCHOR_AGREEMENT_SEC` — treats the symptom (two anchors
bracketing one true boundary) without touching the timestamp-vs-index root
cause the invariant already names; an arbitrary threshold with no principled
derivation risks suppressing correct closely-spaced anchors in fast dialogue.
(4) — deferring to Phase 5 — is rejected because `faAnchors.ts` is Phase
3/Task 5 (R.1) scope, not Phase 5's stated scope (`snapBoundaries.ts`
specifically); nothing in this document says Phase 5's fence subsumes R.1's
anchor computation, so deferring would leave a known-bad anchor mechanism
live and un-owned through however many further sessions elapse before Phase
5 starts.

**R-R FEASIBILITY FINDINGS (WS1 Session A.5, 2026-08-16) — FINDINGS ONLY, NOT
A RULING. Session B stays blocked.** Read immediately after R-R above; these
measure whether R-R's decided fix is buildable from the inputs it presupposes.
Every number below is measured offline from committed `scripts/fixtures/`
against the real, unmodified `computeFaAnchors`/`computeFaChunkPlan`; the
reconstruction was validated against the real production capture (v6 280/280
and 173 118/118 chunks byte-identical), and it reproduces Session A's 481
anchors (v6 329 / 173 148 / spanish 4) exactly.

*(a) Independence, defined.* A corroborating source is **independent** for
anchoring purposes iff no part of the evidence it contributes derives from the
same decode whose error it is meant to catch. Four tiers, in the order they
should be trusted:

| Tier | Source | Independent of a Whisper *timestamp* error? | Carries INDEX? | Carries TIME? |
|---|---|---|---|---|
| T0 | The Whisper decode — Hirschberg ops, token text, token timestamps | **No** (all one decode) | yes | yes, but unreliable |
| T1 | A different acoustic model over the same audio — FA/ONNX word spans + per-word confidence | yes | yes (conditioned on script `qi`) | yes |
| T2 | The audio signal, no ASR — `silenceDetector.ts`'s RMS scan | yes | **no** | yes |
| T3 | The script side, no audio — scene doc, `qi` ranges, `faChunkPlan.ts`'s `RawScriptToken` | yes | yes | **no** |

Only T1, T2, T3 count as independent. T2 and T3 are each independent but
*half-blind*: T2 knows when the room was quiet and nothing about which word
that was; T3 knows the word order and nothing about the clock. Deciding "this
silence IS the seam before script word *w*" needs one source carrying **both**
a trustworthy index and a trustworthy time. Only T1 does — and T1 is
downstream of the anchors.

*(b) Provenance map — the three "agreeing sources" are two, structurally.*
`syncConstants.ts:493-499` names three: the Hirschberg map from `w` to a
Whisper token, that token's onset, and a silence ending before it. In code
(`faAnchors.ts:140-153`) the first two are one lookup, not two sources:
`computeAnchors` resolves `op.qi → matchedSubjectOf → subjectTokenIdx →
tokens[tokenIdx]`, then passes **that same token's** `startSec` into
`findAgreeingSilence` (`faAnchors.ts:150`). No comparison is ever performed
between them — there is nothing to compare, they are one token read twice.
The single real test in the function is
`Math.abs(tokenStartSec - s.endSec) <= 0.15` (`faAnchors.ts:121-122`), i.e.
T0-timestamp against T2-silence. This is structural, true by construction for
every anchor, which is exactly Session A's 481/481 count read off the code
rather than off a log. **So the corroborator is not circular — T2 is genuinely
independent. What is unsound is that the test is a distance, and distance
cannot establish identity.**

*(c) The measured obstacle: R-R's amended R.1(c) is not satisfiable against
this token stream.* R-R amends R.1(c) to require "evidence that the silence
actually falls in the matched word's own token-to-token gap." Whisper turbo
emits a **gapless partition**, not spaced words: adjacent-token gap is exactly
zero for 3451/3988 (v6), 1635/1835 (173) and 331/362 (spanish) pairs — p50
gap 0.000s on all three. There is no interval to fall into. Measured
consequence: of the 481 accepted anchors, **30 (6.2%) have their chosen
silence inside the token-index gap and 451 (93.8%) have no silence there at
all.** Both ear-pass items are in the 451: items 6 and 7 each sit at a
`gapSec === 0` seam. Nor is this a property of the silences — of 547/239/27
detected silences, only 9/79/3 lie in a real inter-word gap; 460/98/22
straddle **two or more** token spans, i.e. the acoustic silence is inside
words that Whisper claims are being spoken.

*(d) Weaker index rules exist, and they do reject the two known-bad anchors.*
Two rules that decide identity by index without needing a gap were measured
(as temporary mutations, reverted):
  - **containment** — the silence must contain the token seam it claims
    (`tokens[T].startSec` strictly inside it): 220/481 of today's anchors
    survive;
  - **unique containment** — and that seam must be the only one it contains
    (a silence swallowing several seams identifies none of them): 70/481
    survive.
Both correctly reject item 6's culpable anchor (silence `[172.70, 173.12]`
lies **wholly inside** Whisper token 464 "chemical" `[172.57, 173.18]` — it
contains no token seam at all) and item 7's (silence `[450.36, 451.70]`
swallows **three** seams, 1222/1223/1224). So an index-based identity test is
constructible; it just cannot take the "token-to-token gap" form R-R's
amendment specifies.

*(e) The genuinely independent THIRD source does exist, but only in a
two-pass order.* T1 (FA's own per-word spans + confidence) is the only source
carrying both index and time. It is unavailable to a single-pass anchor
computation because the anchors are what build the chunk windows FA runs in.
A two-pass shape is therefore forced: pass 1 windows the audio **without
anchors** (the R-P forced-split machinery already does exactly this — longest
silence inside a `MAX_RUN_SEC` span, no anchor input); pass 2 re-anchors using
pass 1's FA word spans as the index-bearing, time-bearing corroborator against
T2's silences, with the R.7 `CONF_MIN` floor discriminating a trustworthy FA
word from a collapsed one. Estimated cost: **~2x FA wall-clock** (V6 ~231s ->
~460s), which collides with R7's runtime note.

*(f) Blast radius.* Because Rust ONNX inference is deterministic in (audio
window, text), a committed boundary can only move if the chunk carrying its
words changed — so a chunk-plan diff is an exact upper bound with no FA run
needed. Measured over all 649 FA-committed segments:

| Candidate rule | chunks (v6/173/es) | boundaries that COULD move | item 6 | item 7 | V6 seam 150/151 control |
|---|---|---|---|---|---|
| baseline | 280/118/5 | — | — | — | — |
| reject silence containing **zero** token seams | 251/81/5 | **179 (27.6%)** | window changes | unchanged | **unchanged** |
| reject silence not containing **its own** seam | 151/52/5 | **460 (70.9%)** | changes | changes | changes |
| select by seam containment | 406/97/6 | **610 (94.0%)** | changes | changes | changes |
| + unique containment | 111/65/2 | **636 (98.0%)** | changes | changes | changes |

*(g) OPEN QUESTION FOR THE OWNER — Session B cannot start until this is
ruled.* R-R decided "merge (1) token-index matching and (2) independent
two-pass corroboration". (2) is achievable only as T1, i.e. only by actually
running FA twice. (1) is achievable only in a containment form, not the
token-to-token-gap form the amendment specifies. And every variant except the
narrowest can move 70-98% of the corpus, including the one boundary the ear
has certified correct. Options, laid out — the choice is the owner's, and this
document records none of them as taken:

  1. **Amend R.1(c) to seam CONTAINMENT and stay single-pass.** Keeps T0xT2,
     drops the unbuildable gap clause, fixes both items. Cheapest; leaves the
     corroborator count at two independent tiers, not three.
  2. **Build the two-pass T1 design R-R(2) actually requires.** Genuinely
     three-source. Costs ~2x FA runtime and a new pass-1 windowing path.
  3. **Narrowest fix only** — reject a silence containing zero token seams.
     Fixes item 6, leaves item 7 open, and is the only variant measured to
     leave the V6 seam control untouched. Smallest acceptance burden by far.
  4. **Re-scope**: fix nothing in `faAnchors.ts` and route items 6/7 to
     Phase 5's fence — which R-R already rejected, and which this session
     surfaces no new evidence for.

---

> **SEAM DEFINITION SUPERSEDED by R-AA (owner, 2026-08-16, WS1 Session B.1),
> below.** R-U's MECHANISM below — a structural veto applied per candidate
> before any distance is computed — is unamended and was never reopened. What
> is superseded is the DEFINITION of a seam: R-U shipped with a seam as the
> INSTANT `tokens[i].startSec` under strict containment; R-AA reads it as the
> INTERVAL `[tokens[i-1].endSec, tokens[i].startSec]` under closed-interval
> overlap. Consequently the "179/649 upper bound, 16/649 actual" profile in
> this entry's *What was measured* paragraph is superseded by **69/649 upper
> bound, 4/649 actual**, and the 16 are superseded by a strict subset of
> themselves. Item 6 still resolves to 174.74; item 7 and the V6 seam control
> are still unmoved. The three REJECTED wider rules below stay rejected —
> R-AA narrows this rule, it does not reopen them.

**R-U ruling (owner, 2026-08-16) — the ZERO-SEAM REJECTION RULE, adopted as
R-R's replacement mechanism. IMPLEMENTED, WS1 Session B.** Read this
immediately after A.5's feasibility findings above: it takes option 3 of that
section's (g), and it is the reason options 1, 2 and 4 are now closed.

*The mechanism.* A silence that spans **no token seam** is rejected as a
boundary candidate, regardless of proximity. It is a **VETO** on structurally
impossible silences — not a SELECTOR among plausible ones. `faAnchors.ts`'s
`findAgreeingSilence` applies it per candidate, before any distance is
computed; `ANCHOR_AGREEMENT_SEC` keeps only its selection job (how far to
look, which structurally admissible survivor to prefer) and no longer decides
identity at all.

*Why this form, and not a better corroborator.* A.5 corrected the diagnosis
and the correction is the whole ruling. `silenceDetector.ts` was never
circular — it is genuinely signal-derived and independent of Whisper, so
R-R(b)'s independence problem did not exist. The real defect is that a
silence carries a trustworthy TIME but no INDEX, and `findAgreeingSilence`
bridged that gap with `|tokenStartSec - s.endSec| <= 0.15` — distance
deciding identity, which `CLAUDE.md` §4's Sync/Whisper invariant forbids in
those words: *timestamps may measure distance; they must never decide
identity*. **This ruling is the worked example of that invariant applied
correctly.** The fix is not better corroboration; it is to stop asking a
distance question and ask a structural one — does this silence span a token
seam at all? — which is a property of the silence itself, not a comparison
against a timestamp. The invariant predicted this failure class before the
measurement found it.

*R-R's token-to-token-gap clause is unbuildable and is superseded here.*
Whisper turbo emits a gapless partition: adjacent-token gap is 0.000s for
3451/3988 (v6), 1635/1835 (173), 331/362 (spanish). 451 of 481 anchors
(93.8%) have no silence in their own gap, items 6 and 7 included.

*The three wider rules are REJECTED.* They buy item 7 coverage they cannot
deliver, at a blast radius the ear cannot audit, and they move the V6 seam
control the ear has already certified:

| Rejected rule | Blast radius (upper bound) | V6 seam 150/151 |
|---|---|---|
| reject silence not containing **its own** seam | 460/649 (70.9%) | moves |
| select by seam containment | 610/649 (94.0%) | moves |
| + unique containment | 636/649 (98.0%) | moves |

*What was measured, and what it cost (WS1 Session B, R-Y re-capture).* Upper
bound 179/649 (27.6%); **actual movement 16/649 (2.5%)** — 6 v6, 10 173, 0
spanish, every one of them inside the upper-bound set. Item 6 (173
`vessel_damage_clue`) resolves to **174.74 exactly**, the ear-correct value,
residual 0.000s. Item 7 is bit-identical at 449.20, as R-V predicts. The V6
seam 150/151 control does not move. Per-boundary table:
`docs/work-in-progress.md` §11.

*One consequence, recorded because it is intended and not an oversight.* The
FIRST token of a transcript can never carry an R.1 anchor — there is no token
seam before it for a silence to span. The corpus start is already a boundary
(`'corpus-start'`); it does not need an anchor to also assert it.

*Scope, recorded for the same reason.* The veto applies to R.1's agreement
test only, NOT to R-P's `longestSilenceInWindow` (the R.4 forced split). Those
answer different questions — "is this silence the boundary between these two
words?" versus "where is the least-bad place to cut a run that has run too
long?" — and only the first is an identity claim.

**~~OPEN AGAINST R-U~~ — RULED, 2026-08-16, WS1 Session B.1: the seam-REGION
reading is ADOPTED (R-AA, immediately below). This block is left standing as
R-AA's evidence base.** R-U
says "spans a token seam". Session B implemented, and A.5 measured, the
reading in which a seam is the instant `tokens[i].startSec` and the silence
must contain it STRICTLY. That reading is exactly right where Whisper is
gapless (86-91% of adjacent pairs) and demonstrably over-rejects where it is
not: in the 537/200/31 pairs that DO carry a positive gap, the seam is not an
instant but the interval `[tokens[i-1].endSec, tokens[i].startSec]`, and a
silence sitting cleanly INSIDE that gap — the ideal boundary marker — spans
no instant and is vetoed. That is the opposite of the intent A.5 stated for
this rule ("it lies wholly inside one token's span").

The seam-REGION reading (silence overlaps `[tokens[i-1].endSec,
tokens[i].startSec]`) was measured this session and is strictly better on both
axes:

| reading | upper bound | measured movers | item 6 | item 7 | V6 seam |
|---|---|---|---|---|---|
| instant, strict (SHIPPED) | 179/649 (27.6%) | **16/649** | 174.74 ✓ | unmoved | unmoved |
| instant, closed | 132/649 (20.3%) | not run | — | — | — |
| seam REGION | 69/649 (10.6%) | **4/649** | 174.74 ✓ | unmoved | unmoved |

The region reading's 4 movers are a strict SUBSET of the shipped reading's 16.
It reaches the same ear-correct 174.74 on item 6, leaves item 7 and the V6
seam alone, and asks the ear to adjudicate a quarter as many boundaries.

**Shipped as measured anyway, deliberately.** R-U was ruled on the 179/649
profile, every stop-and-rule exit this session ran under was calibrated to it,
and switching readings unilaterally would have voided both the measurement and
R-X's sample. The owner rules; this entry is the evidence to rule on. If the
region reading is adopted, the R-Y re-capture, the gate re-pin and R-X's
listening sample must all be redrawn from it — the FA inference for it is
already captured (`.work-phase4/recap/words-VG-*.json`), so that is a
re-measure, not a re-derivation.

---

**IDENTIFIER CONVENTION, recorded so the next session does not rediscover it.**
The single-letter ruling series is EXHAUSTED at R-Z. Ruling identifiers
continue as **R-AA, R-AB, R-AC, …** — two letters, ASCII-sorting naturally
after R-Z, requiring no renumbering of anything already recorded. Rule numbers
(`R.1`, `R.11`, …) are a SEPARATE, unaffected series and continue as integers;
the next free rule number is R.12.

**R-AA ruling (owner, 2026-08-16, WS1 Session B.1) — the SEAM-REGION reading is
ADOPTED, amending R-U's seam definition only. IMPLEMENTED.**

*What changes.* A seam is the INTERVAL `[tokens[i-1].endSec, tokens[i].startSec]`
— everything between the end of one token and the start of the next — and a
silence spans it when the two overlap as closed intervals. R-U's mechanism (a
structural veto per candidate, before any distance is computed) is unchanged
and was not reopened; `ANCHOR_AGREEMENT_SEC` keeps its selection-only job.

*Why, and this is the load-bearing half: the region reading is the more
FAITHFUL application of the R2 invariant, not merely the cheaper one.* The
instant reading takes a seam to be `tokens[i].startSec`. That instant is an
ARTIFACT of gapless decoding, not a fact about the audio: it exists as the
seam only because Whisper turbo happens to emit `tokens[i-1].endSec ===
tokens[i].startSec` for most pairs. Where a real gap exists (537/3988 v6,
200/1835 173, 31/362 spanish adjacent pairs), the seam is the gap, and a
silence sitting cleanly INSIDE that gap — the single most convincing boundary
marker this pipeline can observe — contains no instant and was vetoed. The
instant reading also rejected a silence whose own `endSec` IS the token onset,
i.e. R.1(c) agreement at distance 0.000s, for touching rather than containing.
Both are the structural question answered against the wrong structure. R2 says
identity is token-INDEX business; the seam interval is exactly what the token
index space says lies between two tokens, whereas the instant is what one
token's timestamp says about itself.

*Blast radius, re-measured from Session B's own captured FA inference for this
reading (`.work-phase4/recap/{plan,words,segs}-VG-*`), which the shipped code
reproduces chunk-for-chunk on all three corpora:*

| | instant, strict (superseded) | seam REGION (adopted) |
|---|---|---|
| upper bound | 179/649 (27.6%) | **69/649 (10.6%)** |
| measured movers | 16/649 (2.5%) | **4/649 (0.6%)** — 3 v6, 1 173, 0 spanish |
| item 6 | 174.74 ✓ (residual 0.000s) | **174.74 ✓ (residual 0.000s)** |
| item 7 | unmoved, 449.20 | unmoved, 449.20 |
| V6 seam 150/151 | unmoved | unmoved |
| item 11 `blue_monkey` | moved 36.96 → 37.73 | **does not move** |
| pre-existing fixture rows disturbed | 13 | 1 |

The 4 are a strict subset of the 16, verified row-for-row (`VG \ VE = ∅`).

*The enrichment survives the narrowing — the one genuinely open question when
this ruling was taken, and it is answered on measurement, not assertion.*
Against the known FA-vs-Whisper disagreement set, the region reading's 4
movers contain **3 of the 44** boundaries that disagree by >0.5s (expected
0.27 under uniform placement, **11.1x**, p = 0.0011) and **2 of the 24** that
disagree by >1.0s (expected 0.15, **13.5x**, p = 0.0075). The instant reading's
16 contained 6 and 3 of the same sets (5.5x and 5.1x). So the DENSITY of
known-suspect boundaries roughly doubles under the narrower rule: 3 of the 4
surviving movers are in the 44, against 3 of the 12 dropped. The narrowing
keeps the arm where the signal is and discards mostly boundaries with no
independent evidence against them — 9 of the 12 dropped are in neither set.
Stated with its limit: n = 4, so this is a direction, not a proof.

*The 12 dropped boundaries are NAMED CANDIDATE DEFECTS, left unfixed by this
ruling on the record.* Full table in `docs/work-in-progress.md` §11. Three of
them are in the 44 (`173 protection_failure`, `173 abysmal_opinion` — also in
the 24 — and `v6 226_four_scouts`) and are the ones a later rule should
revisit — **those three are the RC3 candidates, and they are now TRIAGED, not
parked, by ruling R-AF (WS1 Session C, the "WS1 SESSION C RULINGS" block
above), which overrides the owner's ear-pass decision RC3 to park them; the
blinded triage list is drawn in `docs/work-in-progress.md` §11**; the other nine, including the entire 173 ord 143-148 cluster and item
11's `blue_monkey`, have no independent evidence against them and were moved
by the instant reading alone.

*What the numbers cost, stated because the 45/25 figures quoted since 580ba0f
are slightly wrong.* Re-derived this session from the current fixtures, the
FA-vs-Whisper disagreement sets are **44 (>0.5s) and 24 (>1.0s)**, not 45/25.
The difference is exactly one row — spanish `023_scylla_six_sailors` — which
cleared both thresholds only because its committed value was the stale
pre-616abb2 66.73; at the live 65.12 it clears neither. Anything citing 45/25
is citing a figure contaminated by the same staleness ear-pass item 9 records.

**R-V ruling (owner, 2026-08-16) — ear-pass item 7 is UNBUNDLED from R-R and
becomes defect class R.11.** Items 6 and 7 were bundled on a coincidence of
magnitude — both ~1.83s early — and they are different defects.

**R.11 — FA word-seam midpoint error (next free rule identifier; SCOPED,
NOT BUILT; placed AFTER Stage 1).**

> **BUILT — WS1 Session F, 2026-08-17. See ruling R-AI below (`:2489`-ish, after R-AH) for
> the final spec as built, the root cause on all three register members (item 7 plus the two
> OV3 triage entries — the "word-seam midpoint" framing below was right for item 7 but
> incomplete: the general mechanism is chunk-fit, of which the zero-real-silence word seam is
> one symptom, not the whole class), and the F6 finding on the FA-default flip.**

*Mechanism:* forced alignment's own
per-word timings put two adjacent words' spans back-to-back, and the boundary
commits at the midpoint of that FA-internal word seam. No detected silence
participates at any point. *Evidence:* v6 `152_frozen_brush_mice`, committed
449.20 — FA has "one" ending at 449.18 and "when" starting at 449.22, and
449.20 is exactly their midpoint; ear-correct is 451.03.

> **PLACEMENT OVERRIDDEN by R-AD's sibling R-AE (2026-08-16, WS1 Session C,
> above at the "WS1 SESSION C RULINGS" block) — R.11 is PULLED INTO STAGE 1.**
> This ruling's substance (item 7 is its own defect class, unbundled from R-R,
> a different mechanism from item 6) stands unchanged; only its "*Placement:*
> after Stage 1" clause below is superseded.
>
> **The reachability claim in the next paragraph is ALSO too strong, on
> measurement** — see WS1 Session C's Diagnosis B in
> `docs/work-in-progress.md` §11. It is true that `faAnchors.ts` never sees an
> FA word timing, and true that R-U/R-AA leave item 7 bit-identical. It does
> NOT follow that no anchor-side change can reach it: Session C measured that
> item 7's chunk window `[448.34, 451.70]` is cut by an R.1 anchor at 451.70
> that lands in the middle of the segment's own speech, and that the window is
> handed 5 script words whose audio (per Whisper: `brush` 451.24, `mice`
> 451.32, `stop` 451.51) lies at or beyond its END. The word-seam midpoint is
> the SYMPTOM; the too-short window is the mechanism, and that window is
> `faChunkPlan.ts`/`faAnchors.ts` territory.

*Why `faAnchors.ts`
cannot reach it:* that module runs strictly BEFORE any FA pass and consumes
only (Hirschberg output, Whisper tokens, silences, duration). It never sees an
FA word timing, so no change to it — R-U included — can move this boundary.
Confirmed by measurement, not argument: under R-U item 7 is bit-identical at
449.20. *Placement:* after Stage 1. Holding R-R open for item 7 blocked a
buildable fix for item 6, which is what this ruling ends.

**R-W ruling (owner, 2026-08-16) — the two-pass T1 design is REJECTED, on R7
grounds.** Option 2 of A.5's (g). ~460s for V6 against an already-accepted
231s opt-in ceiling (R-S), to buy a corroborator R-U does not need.

**R-Y ruling (owner, 2026-08-16) — the FA re-capture under the chosen rule was
AUTHORISED BEFORE implementation, read-only, to convert A.5's 179 upper bound
into real magnitudes.** This is what makes R-X's stratified sample drawable:
the magnitude buckets do not exist until it runs. Executed in WS1 Session B;
results in `docs/work-in-progress.md` §11. Method, recorded because the result
is only as trustworthy as it: the re-capture driver was validated by replaying
the PREVIOUS capture's own words through it and reproducing all three
committed `phase4-fa-second-baseline-*-segments.csv` fixtures byte-for-byte,
BEFORE the changed input was fed through it.

---

## WS1 SESSION C RULINGS (2026-08-16/17) — the ear pass closes, and the ZERO-DEFECT PROGRAM opens

**Identifier note.** Five rulings are recorded here under the two-letter series
this document's own IDENTIFIER CONVENTION block (`:1709`) established: **R-AB,
R-AC, R-AD, R-AE, R-AF**. The owner's session brief referred to them as RC1,
RC4, OV1, OV2, OV3; those aliases are kept inline so the brief and this
document can be read against each other. The rule-number series is untouched —
**next free rule number is still R.12**; nothing here creates a new `R.n`.

**R-AB ruling (owner, 2026-08-16) — TIER 2 IS SATISFIED; the ORDERING DEFECT is
recorded (alias RC1).** Both R-X tiers ran and both passed: Tier 1 12/12 scored
plus the disclosed unscored control, Tier 2 8/8. All 4 R-AA movers passed in
both tiers; 13 unmoved controls passed across both.

*The defect, recorded rather than smoothed over.* R-AA's amendment (`:2165`)
states in terms that **Tier 2 must be scored BEFORE Tier 1**, because Tier 1
discloses each row's arm and 4 of its rows reappear blinded in Tier 2. Tier 1
was scored first. That spent Tier 2's blinding on exactly the rows the control
experiment existed to test. **The result stands** — the owner rules it
accepted, and the unmoved-control arm passing is independent evidence against
the "this listener says yes to everything" failure R-X was written to catch.
But the blinding is spent, so Tier 2's 8/8 is corroboration, not the
independent confirmation its design intended. **Binding on the next draw: the
blinded tier is scored before any disclosing tier, without exception.** Session
H (`docs/work-in-progress.md` §11) inherits this as a hard precondition.

**R-AC ruling (owner, 2026-08-16) — the UNSCORED CONTROL is ACCEPTED (alias
RC4).** Tier 1's 12/12 stands with `vessel_damage_clue` (ear-pass item 6)
disclosed and unscored. R-S(i) bars scoring a boundary chosen before the fix
existed, and item 6 is exactly that; it was shown so the census of all 4 R-AA
movers is complete, not to be graded. See R-AA's amendment at `:2152`.

---

### The three overrides — recorded as overrides, on the owner's explicit authority

The owner's standing instruction, quoted because an override without its
warrant is just a contradiction: *"if my decisions are causing trouble, you can
override them — do what's best, permanent, long term."*

**R-AD ruling (2026-08-16) — the FA DEFAULT FLIP is DEFERRED, not cancelled
(alias OV1). OVERRIDES the owner's ear-pass decision RC2 ("FA default ON
now").** **RATIFIED by the owner 2026-08-17 (WS1 Session D).**

*The decision being overridden, recorded here because it was never written
into this document and an override must be readable next to what it
overrides.* **RC2 (owner, ear pass, 2026-08-16): flip `isFaGateOpen()`'s
default from OFF to ON now, on the strength of Tier 1 12/12 and Tier 2 8/8.**
RC2 also, by implication, overrode R7 and R-S(iii) — the ~231s V6 runtime that
both of those rulings hold open as an unresolved blocker for the DEFAULT
specifically (R-S's own "Runtime — accepted for an opt-in toggle; NOT resolved
for the default", `:2098`).

*What R-AD substitutes.* The flip becomes the **FINAL act of Stage 1**, and its
release condition is exact and machine-checkable: **the Zero-Defect Register is
empty** (`scripts/phase4-fa-replay.test.ts`'s `KNOWN_BAD` manifest at length 0,
with the currently-skipped `register is empty` test passing). Not "mostly
empty", not "empty except the deferred ones". Empty.

*Three reasons, in order of weight.*
  1. **It contradicts the owner's own stated end goal.** The goal is Stage 1
     locked with absolute zero bugs. Defaulting to a path that carries five
     known ear failures (items 4, 5, 7, 10, 11) makes those five the behaviour
     every user gets on every Apply Sync. R4 (`:4480`) already ruled on this
     exact pattern one level down — it pulled R.5 and R.10 *into* Stage 1
     precisely so the stage would not lock over defects scheduled for later.
     Flipping the default before those land is the same pattern one level up.
  2. **It silently re-decides the runtime question.** RC2 overrode R7 and
     R-S(iii) without re-arguing them. Deferring the flip means that override
     can be taken deliberately, once the register is closed and we know
     whether any optimisation happened. **The ~231s V6 wall-clock is recorded
     here as STILL UNRESOLVED for the default** — see R-S(iii) (`:2098`) and
     R7, neither of which this ruling discharges.
  3. **The flip is inert today anyway.** R-N packaging (static-link vs
     `load-dynamic`) and Step T model download are both unresolved, so a user
     without a `model.onnx` and an `ORT_DYLIB_PATH` gets a cleanly-failing FA
     call regardless of the default. Flipping a default that cannot engage is
     not a shipped feature.

**The owner's intent is preserved in full: FA becomes the default. It becomes
the default on a clean register.**

**R-AE ruling (2026-08-16) — ear-pass item 7 / R.11 is PULLED INTO STAGE 1
(alias OV2). OVERRIDES R-V's placement clause (`:1795`, "*Placement:* after
Stage 1").** **RATIFIED by the owner 2026-08-17 (WS1 Session D).** Zero defects means zero. A known ear failure sitting on the path
that is about to become the default cannot sit outside the lock scope. R-V's
*substance* is untouched — item 7 is still its own defect class R.11, still
unbundled from R-R, still a distinct mechanism from item 6. Only its schedule
moves. See also the Session C root-cause diagnosis
(`docs/work-in-progress.md` §11), which finds R-V's stated reachability claim
too strong.

**R-AF ruling (2026-08-16) — the three RC3 candidates are TRIAGED, not parked
(alias OV3). OVERRIDES the owner's ear-pass decision RC3 ("park them for
later").** **RATIFIED by the owner 2026-08-17 (WS1 Session D), and EXECUTED —
the triage ran; see R-AG below for its outcome.**

*The decision being overridden.* **RC3 (owner, ear pass, 2026-08-16): the three
named candidate defects R-AA left unfixed — `173 protection_failure`, `173
abysmal_opinion`, `v6 226_four_scouts` — are parked for a later rule.** They
are the three of R-AA's twelve dropped boundaries that carry independent
evidence against them (all three in the 44 >0.5s FA-vs-Whisper disagreement
set; `abysmal_opinion` also in the 24 >1.0s set) — see R-AA's own "12 dropped"
paragraph at `:1770` and the full table in `docs/work-in-progress.md` §11.

*Why the override.* Parking is the right call when triage is expensive. Here it
is three boundaries at ~25s of listening each — roughly **75 seconds**. The
owner's own "never ignore a defect" principle is honoured better by resolving
them now than by filing them where a later session must rediscover why they
were filed. Each resolves to exactly one of: **correct as-is** (closed on the
record), **defective** (enters the Zero-Defect Register), or **undecidable by
ear** (closed with a named further step). The triage list is drawn and ready in
`docs/work-in-progress.md` §11; running it is the owner's, and it is ~2 minutes.

---

## WS1 SESSION D RULINGS (2026-08-17) — the triage lands, and R.5 is BUILT

**R-AG ruling (2026-08-17) — the OV3 triage outcome, and the register grows to
7 before shrinking to 5.** R-AF's triage ran, blinded, five rows, both controls
scored CORRECT (so the sitting is trustworthy). Outcome:

| candidate | boundary | ear verdict | disposition |
|---|---|---|---|
| 173 `protection_failure` | 603.69 | **CORRECT** | closed on the record; never entered the register |
| 173 `abysmal_opinion` | 16.50 | **DEFECTIVE** | enters the register, owning rule **R.11** |
| v6 `226_four_scouts` | 670.24 | **DEFECTIVE** | enters the register, owning rule **R.11** |

*Three things this ruling fixes on the record.*

**(1) Membership in the 44 is suspicion, not guilt.** `protection_failure` is
in the 44 known >0.5s FA-vs-Whisper movers, and the ear says its boundary is
RIGHT. The 44 is a set of *disagreements between two imperfect sources*, not a
defect list, and R-AA's decision to narrow 16 movers to 4 is corroborated
rather than undermined by this — a boundary R-AA declined to move turns out not
to have needed moving.

**(2) The register schema gains an ORIGIN, not fake item numbers.** Both new
entries came from a blinded 5-row sitting, not the 12-item ear list, so they
have no item number and must not be given one. `KNOWN_BAD` rows now carry a
stable string `id` plus `origin: 'ear-12' | 'ov3-triage'`, `REGISTER_ROSTER`
holds ids, and a test asserts the pairing stays honest in both directions (an
ear-12 entry must have its item number; a triage entry must not have acquired
one).

**(3) `REGISTER_HIGH_WATER` moved 5 -> 7 -> 5 in one commit, and both halves
count.** It was RAISED because two new defects were confirmed — the guard doing
precisely its job, making growth cost four coordinated edits rather than one
silent line. It was then LOWERED because R.5 landed in the same commit and
closed items 4 and 5. The register is 5 open at the end of Session D, the same
number it was at the start, with a completely different membership.

---

**R.5 — FINAL SPEC AS BUILT (2026-08-17, WS1 Session D). Supersedes the
Session C spec's DETECTION term and its BEHAVIOUR term; the mechanism and the
R-E assignment are unchanged.**

*What Session C specified, and what measuring it against production code
found.* Session C's detector was "unclaimed Whisper-token runs of >= 3 tokens
AND `bestFuzzyContainment(run, script) < 0.65`", measured with a Python
`SequenceMatcher` proxy that put the ten true recitations at 0.58-0.60 and
every false candidate at >= 0.67, and it flagged the number as needing
re-derivation. Session D re-derived it. **The threshold does not transfer, and
neither does the direction.** Against the production matcher (the run's own
canonical words aligned to the flattened script by the same Hirschberg pass the
pipeline uses), the ten recitations score **0.2500-0.6000** and the 38 false
candidates **0.0000-0.4000** — overlapping across the whole 0.25-0.40 band, with
the true positives mostly ABOVE the false ones rather than below. No threshold
separates them. `isFuzzyMatch`, the other production candidate, is boolean and
fires on 6/48 runs, none of them a recitation. **There is no production
containment threshold. This is a finding, not a tuning failure.**

*What separates them exactly, with no threshold at all.* A second STRUCTURAL
test, in the index space the R2 invariant demands:

```
  unscripted-audio run  <=>  run length >= MIN_UNSCRIPTED_RUN_TOKENS (3)
                        AND  qiHole == 0
```

where `qiHole` counts the UNMATCHED script words lying opposite the run — i.e.
between the last script word whose matched token precedes the run and the first
whose matched token follows it. The reasoning is mechanical rather than fitted:
a false candidate is a **mis-tokenization of a word that IS in the script**
("Catachan" arriving as `Cat`+`ac`+`an`, "Scylla" as `S`+`illa`), so the script
word it fragments necessarily failed to match and the script side shows a hole.
Genuinely unscripted audio has no script counterpart to fail, so every script
word bracketing it matched and the hole is exactly zero.

**Measured over all three corpora: 48 raw runs; `qiHole == 0` selects 10, the
ten "Level N" recitations Step K counted independently — 10/10 recall, 0/38
false positives.** The margin is the minimum possible and that is the point:
every true positive is 0 and every false positive is >= 1, so this is a
STRUCTURAL zero of the same kind as R-U's zero-seam veto, not a threshold near
an edge. `001_scylla_intro`, the subword case Session C named as the one a
threshold gets wrong, is rejected correctly.

*BEHAVIOUR — EXCISION, because the specced CTC wildcard is not reachable.*
Session C specified the run's span becoming "a CTC wildcard ... absorbing that
audio at zero alignment cost". `fa_viterbi.rs` implements standard CTC with a
blank symbol and **has no wildcard label**, so that form cannot be built from
`faChunkPlan.ts` — it would need the Rust aligner, outside this session's
permitted surface and a far larger change. Excising the span from the chunk
window is the same thing acoustically (the neighbouring segments' words are
never offered those frames) and IS reachable here: the containing chunk splits
into the part before the run and the part after it, cut in the SCRIPT at
`qiSplit`. A side that would carry no text is not emitted — its window is
trimmed instead, which is what the corpus-start recitation needs and what keeps
Rust's `text_to_token_ids` from seeing an empty chunk.

*The chunk plan stops being contiguous, and that is legal.* `align_chunked`
(`fa_onnx.rs`) processes each chunk independently and offsets its words by
`chunk.start_sec`; its windowed-output invariants are non-decreasing times,
non-overlap, and each word inside its own chunk window — all satisfied by a gap
between windows. The chunk plan has never been required to partition
`[0, audioDuration)`; that is **Model P**, which governs `project.segments` and
is untouched. Per **R-E** the excised seconds belong to the PRECEDING segment,
which is exactly what leaving the inter-chunk span unclaimed produces.

> **AMENDMENT (owner ruling 3, WS1 Session H, 2026-08-18).** R-E's assignment
> above governs the CHUNK PLAN excision — where the run's seconds go BEFORE
> inference — and is unchanged and correct. It does NOT extend to where the
> COMMITTED BOUNDARY should land after `snapCoveredBoundaries` snaps a seam
> onto the nearest real silence, which is a separate question R-E never
> answered: nine of V6's ten unscripted runs turned out to hold a committed
> boundary landing on a real silence STRICTLY INSIDE the run (measured, not
> assumed — `docs/work-in-progress.md` §11's Session H entry). Owner ruling 3
> REVERSES the destination for that committed boundary specifically: it
> belongs to the FOLLOWING segment, in `[prevToken.endSec, run.startSec]`,
> matching what the ear scored correct on all twelve Session H listening-pass
> rows. R.12 (`src/services/faRunPlacementGate.ts`) is the rule that owns and
> corrects this. This is a recorded reversal, not a silent contradiction — see
> the same amendment at this document's second R-E citation below.

*Contract effects, as built.* `normalizeSceneDoc` word counts unchanged;
`computeRunContext` offsets unchanged; `assertQiMapConsistent` untouched and
still passing (R.5 adds no script words and consumes no `qi` index — it only
decides where an already-computed `qi` sequence is CUT). The R.1 anchor set and
the R.0 run partition are **bit-identical on all three corpora** (`anchorDigest`
and `runDigest` unchanged in the replay gate), which is the machine proof that
`faAnchors.ts` is not involved.

*Measured result.* v6 264 -> 273 chunks (nine splits + one corpus-start trim);
173 and spanish chunk plans bit-identical. **8 of 649 committed boundaries move,
all in v6, and every one of the 8 lands exactly on the Whisper-committed
value.** Ear-pass items 4 and 5 both resolve with residual **0.000s** at 931.40
and 130.96. Item 7 (449.20), the V6 seam 150/151 control (457.81) and all three
v6 FA-recovered boundaries are unmoved. Full tables:
`docs/work-in-progress.md` §11's Session D block.

*Not built, deliberately.* The `unscripted-gap` sync-log entry R-E calls for.
`faChunkPlan.ts` is a pure module with no logging surface, and the caller that
would emit it is the Phase 3 production-wiring slice
(`docs/work-in-progress.md` §11 item 1), which has not landed. `detectUnscripted
Runs` is exported so that caller can emit the entry without re-deriving
anything. Recorded as a deferral, not an omission.

---

**BOTH TRIAGE DEFECTS ARE R.11. No R.12 is created — R.12 remains the next free
rule number (2026-08-17, WS1 Session D).**

The session brief anticipated that `abysmal_opinion` might need a new rule, and
that `226_four_scouts` might be an R.5 case. Measurement says neither. Both are
**item 7's root cause**: *a chunk window whose attributed text does not fit its
audio.* Session C established that as item 7's real mechanism (its `(e)`
diagnosis: "the word-seam midpoint is what `snapBoundaries.ts` correctly
computes from that wrong input"), and both new entries reproduce it exactly.

*173 `abysmal_opinion` @16.50 — a text-SURPLUS window.* Chunk `[16.64, 18.08]`
is handed "the numbers. They're": **4 script words against 2 Whisper token
onsets, fit 2.000, rank 2 of all 381 chunks** — worse than item 7's own 1.429
at rank 11. "They're" is spoken at **18.10, beyond that window's end**, so FA
crushes it to `[17.08, 17.40]` at confidence 3.9e-03 and the boundary lands on
the midpoint of silence `[16.36, 16.64]` — an interval with **zero seconds
uncovered by speech**, lying wholly inside the continuous "because of the
numbers". The ear-correct **17.88** is available in the data as the midpoint of
the real 0.40s gap `[17.68, 18.08]`.

*v6 `226_four_scouts` @670.24 — an audio-SURPLUS window.* Chunk
`[669.40, 671.50]` carries "night scouts now. Four of them": 6 script words
against 8 token onsets, **fit 0.750**. FA crushes "four of them" to
`[670.32, 671.48]` at 9.7e-04/1.6e-06/3.7e-07 and the boundary falls on FA's own
word-seam midpoint 670.24 instead of the real silence `[670.86, 671.50]`, whose
midpoint is the ear-correct **671.18**.

*Three candidate classes eliminated by measurement, not assumption.* NOT R.5:
173 has zero unscripted-audio runs, and `226_four_scouts` was tested by BUILDING
R.5 and watching it not move (see the Step 2 pre-registration below). NOT R.10:
its discriminant does not fire on either (`matched === true`, max word
confidence 1.0 and 0.999). NOT a new spurious-silence rule: the tempting
"reject a silence with no real inter-token gap" veto covers **142 of 649
committed boundaries**, including item 6 @174.74 and item 9 @65.12 — two
positive assertions the ear has already confirmed CORRECT. That veto is
catastrophically broad, in the same way Session C warned the symmetric
multi-seam veto would be, and it is recorded here so a later session does not
rediscover it as an idea.

> **CONSEQUENCE FOR SESSION F, and it is a real one.** Session C's item-7
> sibling census (10 of 646) was drawn on the SYMPTOM signature — word-seam
> midpoint AND back-to-back seam AND no spanning silence. `abysmal_opinion`
> fails that signature (seam gap 0.260s; a silence DOES span it) and
> `226_four_scouts` fails it too (seam gap 0.160s), yet both are the class.
> **The symptom census under-counts. Session F must re-derive it from the FIT
> signal** — attributed script words / token onsets inside the window, which
> ranks both new entries in the top 1% and 7% respectively — and must do so
> AFTER R.10 lands (Session C's X2 dependency, unchanged).

---

**R.2 — Padding, and how it is bounded.** A run's audio window is

```
  windowStart = firstAnchor - padBefore
  windowEnd   = lastAnchor  + padAfter

  padBefore = min(PAD_BASE, PAD_SHARE * (firstAnchor - prevRunLastWordEnd))
  padAfter  = min(PAD_BASE, PAD_SHARE * (nextRunFirstWordStart - lastAnchor))
```

`PAD_BASE = 0.75s`. Derived, not chosen: the production RMS detector's own
silence durations across all three corpus projects run p50 0.40-0.70s with a
maximum of 2.08s (V6 0.700/2.080, 173 0.400/0.620, Spanish 0.500/0.920, measured
from `docs/phase4-baseline-*-silences.csv`). 0.75s therefore covers a typical
inter-sentence pause **in full**, which is all the room FA needs to recover a
word onset it currently misses by ≤300ms. It is deliberately **not** the
measurement script's own `--pad-sec 3.0` default: 3.0s reaches across an entire
neighbouring segment in the dense sub-1s runs where this corpus's worst cases
live (Part L), which is exactly how Method 1 produced its neighbour-bleed
regression.

`PAD_SHARE = 0.5`. A run may claim at most half the free audio between itself
and its neighbour, so **two adjacent runs' windows can never overlap** — the
same 50/50 idea as today's midpoint clamp, and this is the sense in which
decision 4's "neighbor-midpoint clamping with bounded padding" is honored.

**R.3 — The clamp's reference point changes, and that is the whole fix.** Today
the clamp is anchored to *the neighbouring segment's committed boundary*. That
boundary is the quantity under repair, so a mistimed neighbour poisons this
segment's window — the defect that produced 5 of the 6 ratio>0.5 rows. Under
R.2 the clamp is anchored to *the neighbouring run's own last verified word
end*, i.e. to a point with three-source agreement.

**What happens when a neighbour is itself mistimed** is therefore answered
structurally rather than by a tolerance: a mistimed segment, by definition, does
not have three-source agreement at its boundary, so **it never becomes an
anchor**. It is absorbed INTO the run and re-derived from FA's own output. A
segment whose committed timing is wrong contributes no constraint to anything.
That is the property today's design lacks and the reason it cascades.

**R.4 — Run length bounds.** `MAX_RUN_SEC = 30`. wav2vec2-class encoders are
O(n²) in attention, and 30s is the standard chunk length for this model family;
at 50 frames/sec that is 1500 emission frames against ≈450 target symbols for
30s of narration — **corrected 2026-08-11 (runtime spike, G6 read of torchaudio's
`forced_align`): the real DP table is T×S with expanded sequence S=2L+1≈901 for
L=450, i.e. ≈1.35M cells, not 675k (T×L) — feasibility verdict unchanged, both
figures are trivial to hold.** If no admissible
anchor exists within `MAX_RUN_SEC`, the run is **force-split at the best
available candidate and the split is marked LOW-CONFIDENCE** (R.6), rather than
growing unbounded or silently accepting a weak anchor. A run of one segment is
legal; it simply gets R.2's padding.

**R-P ruling (owner, 2026-08-12) — "the best available candidate" above was
under-specified; force-split selection is now a concrete rule.** When no
admissible R.1 anchor exists within `MAX_RUN_SEC` of the run's start: split at
the **longest** detected silence interval inside the window (`[runStart,
runStart + MAX_RUN_SEC]`); if the window contains no detected silence at all,
split at exactly `runStart + MAX_RUN_SEC`. Either way the resulting boundary's
provenance is recorded as a forced split, distinguishable downstream from an
agreed (three-source-agreement) anchor — so a later consumer can tell a
real anchor from a forced one without re-deriving it. A force-split boundary
may never produce a gap in `project.segments` — Model P (R-E) outranks R.4
the same way it outranks R.5's wildcard.

**R.5 — Unscripted audio inside a run.** Between consecutive segments inside a
run, insert a CTC wildcard (`<star>` in MMS-FA; the equivalent free blank-run
allowance in a `Wav2Vec2ForCTC` decode) that may absorb arbitrary audio at zero
alignment cost. Audio absorbed by a wildcard belongs to **no** segment: the
preceding segment ends at its own last word's end, the following segment starts
at its own first word's start, and the wildcard span becomes an explicit,
recorded gap.

**This collides with Key Invariant (b) (Σ committed durations = audioDuration)
and the collision is stated, not finessed.** Today that invariant *forces* a
heading's 2.79-5.58s onto one of the two neighbours, and the split point is
whichever spurious silence happens to land inside the recitation — measured at
47%, 63%, 92% and ~49% through the heading on the four sampled cases (Step K).
R.5 removes the **arbitrariness** but does not by itself decide where the seconds
go. **Recommendation, flagged for an owner ruling rather than assumed:** assign
the whole wildcard gap to the PRECEDING segment (its asset simply holds longer),
which preserves invariant (b) unchanged, is the least visible option on screen,
and is logged as an explicit `unscripted-gap` sync-log entry so it is
inspectable rather than silent.

**R.10 — Scripted text never spoken (companion to R.5, next free rule
identifier after R.9; the mirror-image direction — owner ruling R3, WS1
Session A, 2026-08-16).** R.5 covers real audio the script doesn't account
for. This rule covers the opposite: script words with no matching audio at
all — an on-screen-only title, a planted test string never voiced. Forced
alignment has no drop path for this: a CTC objective is required to place
every target token *somewhere*, so unspoken scripted words are carved out of
whichever real speech happens to be adjacent, stealing that speech's own
words into the same window at near-zero confidence (ear-pass items 10
`perilous_realms`, 11 `blue_monkey`, `docs/work-in-progress.md`'s 12-item
mechanism table).

**Detection signal, measured not assumed.** Both item 10 and item 11 score
7/7 words below `CONF_MIN` at the per-word ACOUSTIC confidence FA itself
already emits (`FaWordSpan.needsReview`) — item 11's minimum raw confidence
1.9e-08, item 10's 1.3e-06 — while each segment's own Hirschberg-derived
`alignConfidence` reads 1.000, because that figure is TEXT-match confidence
(every script word found a token), not acoustic. The two must not be
conflated: `alignConfidence` cannot see this failure at all; only FA's own
per-word confidence can.

**Expected behaviour, recommended, not yet ruled on implementation.** Mirror
Whisper's own existing coverage gate — the same graceful-degradation
precedent R.7 below already establishes for a different trigger: when a
matched segment's words are overwhelmingly below `CONF_MIN`, treat the
segment as unmatched and drop it, rather than committing timing an alignment
was forced into place with no real acoustic evidence behind it. This is
inherent to a forced-alignment objective, not a bug in `faAnchors.ts` or
`faChunkPlan.ts` (`docs/work-in-progress.md`'s "inherent vs. missing-feature
vs. bug" categorization) — so the fix is a drop/skip gate layered on FA's
output, not a change to the alignment computation itself.

**Relationship to R.5.** Exact mirror image: R.5 is audio the script doesn't
cover (absorbed via a CTC wildcard); R.10 is script the audio doesn't cover
(dropped via a confidence gate). Both are currently unimplemented in the
committed FA path, and both are pulled into Stage 1 scope together by the
amended STAGE 1 LOCK GATE below (owner ruling R4) rather than left for a
later phase to rediscover independently — Phase 3c's own history (above)
is exactly what happens when a stage locks around a known, scheduled-later
defect.

**Ruling status.** Specified here to the same depth R.5 carries, not yet
built, and its own implementation approach (the drop-gate threshold; whether
it reuses `CONF_MIN` as-is or needs its own constant) is still an open
decision, tracked in `docs/work-in-progress.md` — the same status R.5 held
before ruling R-E closed its destination question.

**R-Z ruling (owner, 2026-08-16) — R.10's RESPEC is an INDEPENDENT TRACK, not
a Session B dependency. OPEN.** The spec above is not rewritten by this
ruling; only its detection signal is reopened, and only as its own track.

*What fails.* R.10's detector as currently written cannot separate ear-pass
item 10, which is the case it most needs to catch. Measured, on v6/173:

  * `hostile_landscape` (item 10) scores `alignConfidence` **0.769**, and its
    own culprit `perilous_realms` scores **0.778**. The two are 0.009 apart —
    a detector keyed on this number cannot tell the stolen segment from the
    thief.
  * The `alignConfidence == 1.000` conjunct is **degenerate on v6**: constant
    across all 447 segments, so it contributes no discrimination at all there.
  * The same conjunction **false-fires on item 9**, which is a chunk-plan
    attribution defect (closed by `616abb2`), not a never-spoken-text defect.

*What a working signal would need.* It must separate a segment whose words
were STOLEN from the segment that stole them — and those two sit adjacent, at
nearly the same `alignConfidence`, by construction. `alignConfidence` is
TEXT-match confidence and is blind to this by definition (the spec above
already says so); the discriminating quantity has to come from FA's own
per-word ACOUSTIC confidence and from WHERE the low-confidence words sit
inside the segment, not from a per-segment scalar. Direction, not a design:
the thief's low-confidence words cluster at one end (the stolen span it was
forced to cover); the victim's are spread across its whole span. Nothing here
is measured yet.

*Status.* Documented only, this session. No respec written, no detector
built, not a Session B or Session C blocker.

*RESPEC — WS1 Session C (`docs/work-in-progress.md` §11(d)), plus the owner's
Session D directive.* Session C measured the two numbers above and found BOTH
premises wrong: `hostile_landscape` and `perilous_realms` score **0.000**, not
0.769/0.778, so the thief/victim adjacency this ruling was built on does not
exist. The working discriminant is `alignResult.matched === false` **∧**
`max(faWords.confidence) < R10_MAX_WORD_CONF` **∧** `faWords.length >= 2`
(2/2 true positives, 0 false positives over all 649 boundaries; re-confirmed
independently in Session D — it selects exactly `perilous_realms` and
`blue_monkey`, both in 173).

> **OWNER DIRECTIVE (2026-08-17, WS1 Session D): `R10_MAX_WORD_CONF` gets its
> OWN NAMED CONSTANT in `syncConstants.ts`. Do NOT reuse `CONF_MIN`, and do
> not let the two drift into each other.** `CONF_MIN` (0.3) over-fires 16/649;
> the R.10 threshold is 5e-4, three orders of magnitude away, and the two
> answer different questions ("is this word worth reviewing?" versus "was this
> text spoken at all?"). Session E builds it. Recorded here rather than only
> in the session brief so the constant's separateness survives the session
> that creates it.

> **BUILT — WS1 Session E, 2026-08-17. R.10 SHIPPED; see ruling R-AH below for
> the final spec as built, the behaviour decision, and the correction this
> ruling itself needs.** Production surface: `src/services/faUnspokenGate.ts`
> (new), `syncConstants.ts` (`R10_MAX_WORD_CONF = 5e-4`, `R10_MIN_WORD_COUNT`),
> and `App.tsx` wiring. **NOT `faChunkPlan.ts`** — the session brief expected
> it and the expectation was wrong; see R-AH(c). Items 10 and 11 both resolve
> and converted to positive assertions.

---

**R-AH ruling (2026-08-17, WS1 Session E) — R.10 IS BUILT. Its detection
signal survived re-validation unchanged; its BEHAVIOUR is "hand the segment to
the skip path that already exists"; and R-Z's own numbers turn out to have
been RIGHT, measured against a different token array than the session that
refuted them used.**

**(a) The Session C discriminant, re-validated on the POST-R.5 capture.** R.5
had since changed 88 of 3874 v6 word rows at fixture resolution (857 at full
float precision) and **224 word confidences**, and `maxWordConfidence` reads
FA output directly — so the whole discriminant was re-measured over all 649
boundaries before anything was built on it.

| | Session C (pre-R.5) | Session E (post-R.5) |
|---|---|---|
| true positives | 2/2 | **2/2** — `perilous_realms`, `blue_monkey` |
| false positives | 0/649 | **0/649** |
| separation margin | 850× | **850×** (1.7248e-05 vs 1.4653e-02) |
| vs. the genuine FA recoveries | ~58,000× | **5.76e+4×** |
| boundaries that CROSSED the discriminant | — | **0** |

Every one of the eight `matched === false` segments has a **bit-identical**
`maxWordConfidence` before and after R.5. That is not luck, and the structural
reason is worth keeping: **conjunct (1) reads only Whisper tokens and script
text, neither of which R.5 touches**, so the eligible population is invariant
under R.5 by construction; only conjunct (2) was ever at risk, and only for
the three members of the eight that live in v6 — all of which sit ~2000× above
the threshold. The 0.65 inversion does **not** repeat here.

*Conjunct (3) is honestly reported as INERT on the committed corpora.*
`(1) ∧ (2)` alone already gives 2/2 and 0 false positives; `wordCount >= 2`
removes nothing further, because the only case it speaks to (spanish
`001_scylla_intro`, one word) is already excluded by conjunct (2) at 1.4653e-02.
Session C said as much ("both are kept because they exclude it for different
and independently correct reasons") and that reading stands — it is kept as
defence-in-depth, not as a load-bearing term, and this document now says which
it is.

**(b) THE R-Z 0.769 / 0.778 PAIR IS RESOLVED — AND R-Z WAS RIGHT.** Session C
recorded both figures as premise failures ("`perilous_realms` scores 0.0000,
not 0.778 — the thief/victim adjacency does not exist"). Measured this session
against both token arrays on the same segments:

| segment | `alignConfidence` vs WHISPER tokens | vs FA tokens |
|---|---|---|
| `hostile_landscape` | **0.7692** | **0.7692** |
| `perilous_realms` | 0.0000 (`matched:false`) | **0.7778** |
| `blue_monkey` | 0.0000 (`matched:false`) | **1.0000** |

**Every number R-Z recorded is real and reproducible — 0.769, 0.778 and 1.000
— measured against the FA-token alignment**, which is the correct array to read
when diagnosing an FA defect. Session C measured the WHISPER-token alignment
and concluded the figures did not exist. Both measurements were sound; they
were of different quantities. R-Z's actual claim also holds: thief and victim
sit **0.0086 apart** on FA-token `alignConfidence`, so a detector keyed on that
number genuinely cannot separate them — and R-Z's conclusion (delete the
conjunct rather than re-threshold it) was right for the right reason.
**Session C's "two premises in R-Z are WRONG on measurement" is hereby
corrected to "measured on a different token array."** The discriminant it
produced is unaffected and stands.

**A SECOND INSTANCE OF THE SAME FAILURE MODE, named because two makes a
pattern.** Session D found Session C's R.5 threshold (0.65) had been measured
with a Python `SequenceMatcher` proxy and inverted against production. (b)
above is the same mode again: a measurement was compared against one taken on a
different artifact. A third instance occurred *inside* this session — the Step 5
harness fed the gate FA words through a scratch helper that drops `confidence`,
and R.10 silently detected nothing. **The rule this earns: a measurement only
refutes another measurement if it was taken on the same artifact — same token
array, same normalizer, same segment array, same capture — and the artifact must
be named alongside the number.** The Session E numbers above each name theirs.

**(c) THE PRODUCTION SURFACE — `faChunkPlan.ts` WAS THE WRONG EXPECTATION, and
it is structurally impossible.** R.10's signal requires FA's per-word
confidence. `computeFaChunkPlan` runs *before* inference and has no access to
it. The rule therefore lives in a new pure service,
`src/services/faUnspokenGate.ts`, exactly as R.10's own spec always said ("a
drop/skip gate layered on FA's output, not a change to the alignment
computation itself"). Final surface: `faUnspokenGate.ts` (new),
`syncConstants.ts` (the constant), `App.tsx` (orchestration + the skip
reason). `faAnchors.ts` is byte-identical, sha256 `b61e94cb…`; `faChunkPlan.ts`,
`snapBoundaries.ts`, `silenceDetector.ts`, `faGate.ts`, the Hirschberg aligner
and all Rust are untouched.

**(d) THE BEHAVIOUR DECISION — drop, by forcing `matched: false` and letting
the EXISTING skip path run.** Four options were considered; this one wins on
every axis and needed no new machinery at all.

| option | fixes | breaks |
|---|---|---|
| **drop via `filterToCoveredSegments` (CHOSEN)** | both items; neighbour absorbs the span; head-extend handles the index-0 case | nothing measured |
| zero-width segment | keeps the row | a 0s segment is not a thing this codebase has, and Model P's own DEV assertions would have to learn about it |
| merge into a neighbour | keeps the row | invents a scene the user did not write, and the merged text would be spoken by nobody |
| mark and leave in place | most visible | leaves the defective timing committed, which is the whole complaint |

*Model P (b) and R-E no-gaps: PRESERVED, verified rather than asserted.* Across
all three corpora after the drop: **0 partition violations**, max
`|end[i] − start[i+1]|` = 1.14e-13 (float noise), first segment at 0.0000, last
at `audioDuration`, and Σ duration = `audioDuration` exactly. The preceding
survivor absorbs the span — `ancient_nature_thriving` 2.34 → 3.11 (+0.77, which
is `blue_monkey`'s whole span). **Exit E2 does NOT fire.**

*The qi contract: UNTOUCHED, and Session C's prediction is refuted.* Session C
called this "the single highest-risk part of building R.10," reasoning that
dropping a segment removes its words from `normalizeSceneDoc`'s sequence so the
chunk plan must be rebuilt after the drop. That is true only if the drop
precedes chunk planning. **It does not** — the gate runs after inference, so
`normalizeSceneDoc` counts, `computeRunContext` offsets, `faChunkPlan.ts`
indexing and `assertQiMapConsistent` are all bit-identical. Proof, not
argument: all three anchor digests, all three run digests and all three chunk
digests are unchanged.

*Locked segments: no new exposure, and the reason is a subset property.*
`preserveSegmentLocks` treats a segment absent from the new array as "the user
deleted this scene" and discards the lock silently — an existing owner ruling
this rule does not reopen. It does not need to: **conjunct (1) is
`matched === false` under Whisper, so R.10's firing set is a strict subset of
the segments the shipped default path (FA gate OFF) already drops.** R.10
cannot cost a user a lock the default already keeps. Independent, pre-existing
corroboration: `scripts/fixtures/phase4-baseline-173-skipped.csv` — committed
long before this session — lists exactly `perilous_realms` and `blue_monkey`,
at exactly indices 0 and 12. R.10 removes a divergence, not a scene.

**(e) THE CONSTANT.** `R10_MAX_WORD_CONF = 5e-4` in `syncConstants.ts`, its own
constant per the owner directive above, plus `R10_MIN_WORD_COUNT = 2`. Derived,
not fitted: the **geometric midpoint** of the two nearest measured points,
√(1.7248e-05 × 1.4653e-02) = 5.0273e-04, rounded to one significant figure —
~29× clear on both sides. Re-derived on the post-R.5 capture and unmoved.

**(f) BLAST RADIUS — predicted and actual, and they are the same computation.**
R.10 needs **no new inference**: it never changes the chunk plan, and FA output
is a deterministic function of (audio, chunk plan), so the frozen word capture
IS the post-R.10 capture. **0 FA word rows differ** on any corpus. Committed
boundaries: **649 → 647**, with **3 changed** (2 dropped, 1 moved) — v6 and
spanish bit-identical, every value and every row. Full row diff at re-pin: **6
changed fields/rows, 0 UNEXPECTED**. Well inside exit E3.

**(g) R.5 ↔ R.10, both directions, with the order stated.** R.5 acts at
chunk-plan construction, strictly *before* inference; R.10 acts on FA's output,
strictly *after*. Within one Apply Sync there is no feedback path in either
direction. R.5 → R.10: can only move a member of the fixed eight across the
confidence threshold, and measured, it moved none. R.10 → R.5: the next run's
segments come from `parseProjectData`, so the chunk plan input is unchanged —
verified by digest. **Measured overlap on the post-R.5 capture: 0. Exit E4
clear.** No arbitration rule is needed and none was written; the detector
refuses any `matched === true` segment at any confidence, which is asserted as
a test.

**(h) ONE GATE DEFECT R.10 EXPOSED, fixed in the same commit.** The replay
gate's `loadAnchorPathInputs` fed `computeFaChunkPlan` the
`-segments.csv` fixture, relying on it being the COMPLETE pre-skip parse — true
only while FA skipped nothing on every corpus. With 173 down to 173 committed
rows it would have fed a shorter array and flipped 173's chunk digest to
`b24e4e63bae5f2b3`: **a false alarm pointing at `faAnchors.ts` for a change two
stages downstream of it.** Both readings were measured before the fix was
written. `-segments.csv` and `-skipped.csv` are now merged by `segmentIndex`
back into the real 447/175/27 parse — the same split the Whisper-side baseline
pair has always used — and the skipped fixture carries `startTime`/`duration`
as frozen inputs for that reconstruction. `src/services/faChunkPlan.test.ts`'s
own corpus loader took the identical fix.


---

**R-AI ruling (2026-08-17, WS1 Session F) — R.11 IS BUILT; the ZERO-DEFECT REGISTER REACHES
ZERO; F6 (FA-default flip) FIRES and the flip does not ship.**

**(a) Surface, as built — NOT `faChunkPlan.ts`/`faAnchors.ts`, the same finding R.10
established, re-derived rather than assumed to transfer.** `src/services/faSeamFitGate.ts`
(new, pure), `syncConstants.ts` (`R11_MIN_FIT_DEVIATION`, `R11_MAX_SPAN_WORD_CONF`,
`R11_MIN_CORRECTION_SEC`), `App.tsx` wiring after `headExtendFirstSegment`, gated on
`faTokens` truthy. Both `faChunkPlan.ts` and `faAnchors.ts` are READ (their output is
required detection input — the chunk plan's fit ratio, the run provenance) but detection is
only meaningful once the COMMITTED boundary exists to compare against a chunk edge's real
silence midpoint, which is FA's own inference OUTPUT. Full mechanism, root cause on all
three register members (re-measured against the real captured FA output, not cited),
the false positive that forced a third conjunct, and the measured 4/649 blast radius:
`docs/work-in-progress.md` §11's Session F block.

**(b) The signal is suspicion, not the structural zero R.5/R.10 achieved — stated as a
ruling, not a caveat.** `R11_MIN_FIT_DEVIATION`'s own margin (worst known-bad 1.3333 vs.
nearest negative 1.2857, geometric midpoint 1.3093) sits within 0.0016 of an unverified
structurally-similar candidate (173 `architectural_pivot`). This is why R.11's build is
scoped to what real evidence supports — the three register members plus the one new
candidate the detector itself surfaced (v6 `192_scout_listening`) — rather than to a wider,
unverified population. `192_scout_listening` is pinned as a change detector in the FA replay
gate, explicitly NOT as a positive/correctness assertion, and is carried forward to Step 8's
ear list rather than silently treated as confirmed.

**(c) The register is EMPTY.** `REGISTER_HIGH_WATER` 3 → 0
(`scripts/phase4-fa-replay.test.ts`); the Stage-1-lock machine check
(`the Zero-Defect Register is EMPTY`) is un-skipped and passing for the first time. This
closes the Zero-Defect Program R-AD opened (WS1 Session C).

**(d) F6 — the FA-default flip does NOT ship this session, and the reason is structural,
not a runtime or accuracy gap.** `isFaToggleOn()` (`faGate.ts`) persists a GLOBAL,
per-machine key via `uiStateStore` — it is not a per-project field, and `isFaGateOpen()` is
re-read on every single Apply Sync (`App.tsx:2875`'s `cachedTokensReady` branch). Flipping
its stored-`undefined` default from `false` to `true` would, on the very next Apply Sync of
ANY existing project, engage FA for any user whose machine has Tauri capability AND a real
`model.onnx` already placed — a real, silent retime with no per-project consent gate,
regardless of whether that user ever chose FA for that specific project. This is the exact
condition the session brief names F6 for. **The actual blocker a future flip session must
clear is a design one, not a measurement one: `isFaToggleOn()` needs a per-project
representation (e.g. a `Project.faHighPrecisionSyncEnabled` field) so a default change can
apply to newly-synced projects without reaching backward into ones already synced under the
old default.** Not designed or built this session.

**(e) Fail-clean measurements taken anyway, real, not estimated** (this machine carries real
local models and a real ORT dylib from a prior session): missing `ORT_DYLIB_PATH` —
near-instant, checked before any file I/O; absent model file — 266.7µs; corrupted model at
REAL SIZE (a full ~1.26 GiB copy of the real `en` model, one byte flipped mid-file, not the
existing unit test's 19-byte synthetic fixture) — **77.43s in the DEBUG build `npm run
tauri:dev`/`tauri:dev:fa` actually produces** (the only mode FA can currently run in at all —
release packaging/Step T remain unresolved), **5.25s in a RELEASE build**. This is a real,
previously unmeasured cost: `verify_model_manifest`'s full-file SHA-256 runs on EVERY FA
call with no caching, so even a healthy model pays roughly the release-mode-equivalent
figure (~5-8s/language) on top of the already-documented ~231s v6 / ~76s 173 inference
wall-clock (restated from the 2026-08-15 smoke test, not re-measured this session) — a
non-trivial overhead specifically in debug mode for the shorter 173 corpus.

---

## WS1 SESSION G RULINGS (2026-08-17) — F6 resolved; the flip ships per-project; R-N closed

**R-AJ ruling (2026-08-17, WS1 Session G) — the two measured corrections this session makes
to previously-recorded figures.** Both were inherited as premises and both moved when
re-derived through production rather than carried forward:

**(a) The FA-recovery set is 5, not 6 and not 7.** Re-derived at HEAD from the frozen
production outputs of both paths across four commits (`40a12cf` → `a0ff7c0` → `3faf0ea` →
`f7fb9d0`): 7 before R.10, **5 after**, unchanged by R.11. R.10 dropped **two** members —
`perilous_realms` and `blue_monkey` — not one, tied to the production function that did it
(`detectUnspokenScriptSegmentsFromWhisper` fires on exactly those two in 173 at confidences
1.7248e-5 and 6.4257e-6, and 0/447 in v6). Surviving membership: v6
`027_internal_change_face`, `028_small_permanent_flake`, `029_night_understanding`; 173
`shadow_loss`; spanish `001_scylla_intro`. **0 of the 5 has moved in value across all four
commits.** This supersedes `docs/work-in-progress.md` §11's Session E entry (f) — "0 of 6
moved … so six, not seven" — which was wrong.

**(b) A HEALTHY model's verification tax is measured, not inferred.** R-AI(e) inferred that
a healthy model pays roughly what the corrupted one does. It does: **76.51 s in debug,
4.99 s in release, on EVERY Apply Sync**, measured through the real `verify_model_manifest`
against the real 1.26 GiB `en` model. The corrupted-model figure was never the interesting
one; the healthy-path per-call tax was, and it was invisible because only a corrupt case had
ever been measured.

---

**R-AK ruling (2026-08-17, WS1 Session G, OWNER) — the FA toggle is PER-PROJECT and DEFAULTS
ON. This resolves F6 and ships the flip R-AD deferred.**

Owner's words: *"i wanna keep toggle default ON for all projects. in case i wanna turn it
off, i'll go to specific project settings and turn it off myself. otherwise it'll remain
default ON for all projects."*

R-AI(d) named the blocker exactly right — the problem was the gate's SHAPE, not its value.
This ruling adopts the per-project representation that entry called for, and the default
flip becomes shippable as a consequence rather than as a separate act:

- **Field:** `Project.faHighPrecisionSync?: boolean`, persisted inline through
  `projectStore.ts`'s existing serialization. Tri-state and the states are not
  interchangeable: `true` = explicitly on, `false` = explicitly off, **`undefined` = no
  preference**.
- **`undefined` resolves to ON at READ time and is NEVER written back.** This is the
  invariant the whole design rests on: the default is a read-time fallback, so "no
  preference" stays a durable state for the life of the project, and a future default change
  still reaches it. Every function in `faGate.ts` is pure and cannot persist anything.
- **An explicit choice can never be silently overwritten.** The only writer is Project
  Settings' Save, and only when the control actually moved (`shouldPersistFaChoice`).
- **G1 does not fire**, and is proved rather than argued: a pre-change project fixture loads
  with every `startTime`/`duration` byte-identical, acquires no key on load, acquires none
  after the gate is read, and acquires none across a save/load round-trip
  (`faGate.test.ts`).
- **The retired global key is not consulted and not deleted.** It carried no recoverable
  intent: the pre-change `handleSave` wrote it UNCONDITIONALLY on every Settings save, so a
  stored `false` cannot be distinguished from "this user once changed their resolution
  tier", while its only unambiguous value (`true`) agrees with the new default anyway.
- **What the default does NOT bypass:** FA still requires Tauri capability and a
  `Project.language` among the 5 FA-supported codes, so a project that never set a language
  never engages FA regardless of this field.
- **Overrides:** R-AD (OV1)'s deferral of the flip to "the final act of Stage 1", to the
  extent that the flip is now landed ahead of the ear pass — the register is EMPTY (R-AI(c)),
  which was R-AD's own release condition, and the per-project shape removes the silent-retime
  hazard that made ordering matter. The ear pass (`docs/ws1-sync-pipeline/stage1-lock-ear-list.md`)
  and Stage 1 lock are unchanged and still ahead.

---

**R-AL ruling (2026-08-17, WS1 Session G) — R-N CLOSED: stay `load-dynamic` and bundle the
onnxruntime dylib as a Tauri resource. Taken under delegation with measurements in hand, not
in an owner sitting; reversible until a release build is cut (R-K).**

**The measurements decide it by neutralising the criterion it was waiting on.** R-N was held
open on the expectation that fail-clean behaviour would separate the options. After Session
G's precheck it does not: a missing `ORT_DYLIB_PATH` (load-dynamic's only extra failure mode)
already fails in µs with a typed `OrtInit` error, and the expensive path — model verification
— is now bounded and is **identical under both options**, because it concerns the model file,
not onnxruntime. With that tie broken elsewhere:

1. FA's actual bulk is a 1.26 GiB per-language model fetched on demand (Step T). Statically
   linking the runtime makes every user carry inference machinery for a payload they may
   never download.
2. `load-dynamic` is the status quo and the entire existing test-skip convention
   (`ORT_DYLIB_PATH`, `ort_dylib_or_skip`, the 19 ignored tests) is built on it.
   Static-linking invalidates that convention wholesale.
3. A bundled dylib is an ordinary Tauri resource covered by the app bundle's signature.
   Static-linking `ort =2.0.0-rc.13` under `default-features = false` means enabling its
   download/compile-onnxruntime machinery — materially larger, and less reversible.

**Work this decision creates, belonging to the release-build phase and not to Stage 1:**
ship and sign the dylib as a bundled resource, and set `ORT_DYLIB_PATH` at runtime to that
resource path. It is unset today, which is exactly why FA fails clean in dev.

---

## WS1 SESSION I RULINGS (2026-08-18) — the register's closure mechanism gets an ear precondition

**R-AM ruling (2026-08-18, WS1 Session I, OWNER) — NO REGISTER ENTRY MAY BE CLOSED UNTIL
THAT RULE'S OWN MOVERS HAVE BEEN EAR-SCORED. An invariant on the register mechanism itself,
not on any one rule.**

**(a) The rule, stated as an invariant.** A Zero-Defect Register entry may leave `KNOWN_BAD`
for `CLOSED_BY_POSITIVE_ASSERTION` **only after every boundary the owning rule moves has been
scored by ear** — not only the boundary the entry names. Structural derivation, mechanism
agreement, residual-0.000s convergence and cross-engine agreement are all admissible
*evidence*, and none of them is admissible as *closure*. A rule that moves N boundaries owes N
ear scores before any of its entries close. Until those scores exist the entry stays open, or
closes **provisionally** and says so in the data.

**(b) The motivating evidence — R.5's three worsened boundaries, measured this session, not
recalled.** R.5 (unscripted-audio excision) moved 8 committed boundaries on v6. Its two
register entries — items 4 and 5 (`308_scouts_leading` 931.40, `043_night_migration` 130.96) —
both closed on a residual of 0.000s against an ear-correct value, and both are genuinely
correct. But the other six movers were never scored, and when Session H finally listened to
some of them, **three of R.5's eight movers had been made WORSE by the very commit that closed
items 4 and 5**, measured against the values R.12 later established and the ear confirmed:

| segment | pre-R.5 | post-R.5 | ear-correct | error before | error after |
|---|---|---|---|---|---|
| v6 `042_eleven_years` | 125.76 | 127.17 | 125.54 | 0.220 s | **1.630 s** |
| v6 `125_night_circle` | 370.75 | 372.35 | 370.75 | **0.000 s** | **1.600 s** |
| v6 `340_fifty_eight` | 1045.62 | 1047.57 | 1044.67 | 0.950 s | **2.900 s** |

`125_night_circle` is the sharpest case: R.5 moved it **off an exactly correct value**, and
that wrong value was then cited for two sessions as R.11's third-conjunct justification
("R.5's own already-correct value") until Session H measured it and retired the claim. A
register that scores only the boundary an entry names cannot see any of this. That is the
defect this ruling closes, and it is a defect in the *mechanism*, which is why the ruling
attaches to the register rather than to R.5.

**(c) It applies retroactively, and the four structurally-derived R.12 closures are
PROVISIONAL until scored.** `r12-085-the-spear-bearer` (250.69), `r12-224-thirty-three`
(663.785), `r12-307-forty-nine-years` (924.92) and `r12-383-sixty-four` (1188.95) carry
`verification: 'structural'` in `scripts/phase4-fa-replay.test.ts` and were admitted on R.12's
invariant with no ear pass. Under this ruling they are **provisionally closed**: the register's
open count stays 0 and `REGISTER_HIGH_WATER` is unchanged, but the register may not be
described as fully verified while they stand. Session I's mover audit
(`stage1-mover-audit.md`) scores all four. The distinction Session H already encoded in the
`verification` field is what makes this ruling checkable rather than aspirational — the data
already says which closures are which.

**(d) What it does NOT do.** It does not reopen any entry, does not raise the high-water mark,
does not invalidate the fifteen ear-verified closures, and does not make structural evidence
worthless — R.12's invariant is still what *found* the nine defects. It changes only the point
at which a closure may be called final.

**(e) Scope note, recorded rather than assumed.** The audit this ruling requires is drawn over
the *committed-fixture* mover population — every boundary whose committed value any rule has
ever changed — because that population is exhaustively enumerable from git history and the
per-rule counts reconcile against it. It is not drawn over the (unbounded) set of boundaries a
rule could hypothetically reach.

---

**R-AN ruling (2026-08-18, WS1 Session J, OWNER) — STANDING ENGINEERING AUTONOMY. Technical
and architectural calls are delegated; the boundary is that autonomy covers HOW, never WHAT IS
TRUE.**

**(a) The delegation.** The implementing session is authorised to make technical and
architectural decisions autonomously and to choose the most robust, permanent solution without
pausing for routine confirmation. This explicitly covers **implementation shape, naming, test
structure, file layout, refactor scope**, and anything else where a competent engineer would
simply decide. Stopping to ask on any of these is now the wrong behaviour, not the safe one:
the previous sessions' stop-and-rule exits had grown to cover choices with an obvious right
answer, which costs a round trip and buys nothing.

**(b) The one boundary, stated so it cannot be read away.** Autonomy covers **how**, not
**what is true**. A **material discovery** is still reported the moment it is found, and is
never absorbed into the work silently. Material means, non-exhaustively:

  * a new defect;
  * a shipped rule proven wrong;
  * a control moving;
  * a measurement contradicting the record.

The point of moving fast is to not miss anything — a session that decides quickly and reports
a contradiction immediately is behaving correctly; a session that decides quickly and folds a
contradiction into its own patch is not.

**(c) What this does to the stop-and-rule exits.** They narrow to the genuinely material.
Routine implementation questions are the session's to call and are recorded in the ledger
rather than raised as exits. An exit still fires for anything in (b).

**(d) What it does NOT do.** It does not delegate the ear scoring (that is the owner's, by
construction — R-AM), does not delegate acceptance of a contract guarantee, does not license
re-baselining a failing golden replay or a failing gate, and does not weaken the provenance
discipline: every number still comes from a production function, and every measurement block
still names the function that produced it. Autonomy over *how to measure* is not autonomy over
*what the measurement said*.

**(e) Recorded scope.** Standing — it governs every session from Session J forward until
explicitly revoked, and is not re-litigated per session.

---

**R-AO ruling (2026-08-18, WS1 Session K, OWNER + implementing session) — THE BOTH-SIDES RULE.
Every rule must state and test BOTH sides of whatever it constrains, and a fix applied to
documentation must be checked in code.**

**(a) Why this exists — three measured instances, not a principle invented in the abstract.**

  1. **R.5 constrained which audio is EXCISED but not where the committed boundary lands
     relative to it.** Closed by R.12 one session later, after the boundary defect was found
     independently.
  2. **R.12 constrained a run-carrying scene's OPENING edge but not its CLOSING edge.** Closed
     by R.13 two sessions later, after the owner's 24-row mover audit scored clip 12 NO. Nine
     of ten closing edges happened to be legal already, which is exactly why nothing noticed.
  3. **The 173 index convention was corrected in a DOCUMENTATION table**
     (`stage1-live-run-prep.md` §5.3, WS1 Session J) **while the identical off-by-N sat
     untouched in `syncLog.ts`**, where users could see it. Worse, `types.ts` recorded the
     claim that "every rule detector already returns a `segmentIndex` on this same PRE-filter
     convention" — a claim that was FALSE and had never been run against the code.

**(b) The rule, in two halves.**

  * **STATE BOTH SIDES.** A rule's header must name what it constrains on each side of the
    thing it acts on, or state `SINGLE-SIDED, BECAUSE:` and say what the other side would have
    been and who owns it. "We only thought about one edge" must become impossible to ship
    silently.
  * **A DOC FIX IS NOT A FIX.** When a correction is made to a table, a comment or a ledger,
    the same correction must be checked in the code that the document describes, in the same
    commit. A documented claim about code is a hypothesis until it is executed.

**(c) The machine-checkable form.** Both halves are enforced by tests, in the same spirit as
`faDefaultDrift.test.ts` making a class of drift impossible rather than merely discouraged:

  * `src/services/ruleBothSides.test.ts` — fails the build if any shipped rule module
    (`faChunkPlan.ts` R.5, `faUnspokenGate.ts` R.10, `faSeamFitGate.ts` R.11,
    `faRunPlacementGate.ts` R.12/R.13) lacks a `BOTH SIDES` declaration with real content, if a
    single-sided rule does not say why, or if the R.12/R.13 both-edges corpus assertion is
    removed. Verified RED by mutation M10.
  * `src/services/syncLog.indexConvention.test.ts` — fails the build if any rule-correction log
    builder copies a detector's own `segmentIndex` onto a user-facing entry, and asserts the
    committed-index convention against the builders themselves. Verified RED by mutation M9.

**(d) What it does NOT claim.** A declaration check cannot know whether a rule's second side is
CORRECT. It can only make it impossible to ship a rule that never says what its second side is.
That is precisely the failure mode in (a): in all three cases the missing side was never
written down anywhere, so nobody could have reviewed it.

**(e) Recorded scope.** Standing, from Session K forward. It binds new rules and any rule
touched by a later session.

---

**R.6 — Corpus start and end.**

  * **Start:** there is no previous run, so `padBefore = min(PAD_BASE,
    firstAnchor)` — the clamp against a non-existent neighbour degenerates to
    the file's own start, not to zero. The run's text is additionally prefixed
    with a wildcard, so the model is never *forced* to place the first script
    word onto unscripted lead-in. This is aimed directly at V6 segment 1 /
    batch-1 clip 3, where FA produced a 1.87s span for the one-syllable word
    "You" because it had no left context and an unscripted "Level one"
    recitation sat in front of it.
  * **End:** symmetric — `padAfter = min(PAD_BASE, audioDuration - lastAnchor)`,
    plus a trailing wildcard.
  * `headExtendFirstSegment` and the tail extension to `audioDuration` are
    Stage 4 FINALIZATION steps and are unchanged. FA never sees them, and they
    are applied after alignment exactly as today.

**R.7 — Failure paths (the skip-and-flag contract).** Matching this codebase's
established graceful-degradation precedent (`filterMalformedTokens`, the
coverage gate, the silence-scan-error fallback), never a crash:

  * target text cannot fit the window even at full run length → **skip the
    segment, insert a wildcard in its place, emit a structural finding** (Step S
    check C09). This is the segment-320 path.
  * no admissible anchor within `MAX_RUN_SEC` → force-split, mark
    LOW-CONFIDENCE, emit a finding.
  * FA per-word confidence below `CONF_MIN` (0.3 — the same line Blocker 2's own
    analysis used to separate "FA was confident and wrong" from "FA correctly
    refused") on a run's first or last word → do not use that word as a
    boundary; fall back to the run's own anchor.

**R.8 — The cascade-safety argument, stated at the strength it actually holds.**

*Claim:* an incorrect boundary at segment `i` cannot change the computed
boundary at segment `i±1`.

*Case 1 — `i` and `i±1` are in DIFFERENT runs.* The run edge between them is an
anchor with three-source agreement; each run is aligned independently; R.2's
`PAD_SHARE = 0.5` guarantees the two windows cannot overlap, so neither run's
audio contains the other's. **Full independence — a genuine no-propagation
guarantee.**

*Case 2 — `i` has no valid alignment at all* (the segment-320 case). It is
skipped-and-flagged and its span becomes a wildcard. Its neighbours' boundaries
are read off their own words. **The segment-321 cascade cannot occur**, because
321's window is never derived from 320's boundary.

*Case 3 — `i` and `i±1` are in the SAME run.* **This is where the guarantee is
weaker, and the honest statement is that it is bounded, not zero.** A monotonic
CTC alignment does couple neighbours: word `k`'s onset is constrained to be ≤
word `k+1`'s. A misplaced word can therefore displace its successor forward. What
it *cannot* do is compound: each word's placement is scored against its own
acoustic evidence, so the next word with strong evidence pulls the path back, and
the displacement does not accumulate across the run. What R.0 eliminates outright
is today's mechanism, which is categorically worse than a monotonic constraint:
today segment `i`'s committed boundary **is literally the input window** for
segment `i+1`'s alignment, so an error is not merely propagated, it is copied
verbatim and then compounded by the next segment's own window being wrong in the
same direction. **Claim as proved: no-propagation for cross-run neighbours and
for skipped segments; within a run, reduction from verbatim error-copying to a
bounded monotonic-ordering constraint.** Anything stronger would be an
overclaim.

**R.9 — Which Phase 3 cases this design would have prevented, named.**

| Case | Prevented? | By what |
|---|---|---|
| **Segment 320** (CTC constraint violation, 102 chars in a 1.27s slot) | **YES**, twice over | R.7's fit precheck skips-and-flags instead of the run dying; R.0's run structure means segment 321's window is never derived from 320's boundary, so the ~4s misplacement of "That" cannot happen. **But see the correction below — this defect is latent, not live.** |
| **The 10 unscripted headings** (2.79-5.58s each, split arbitrarily) | **PARTIALLY** | R.5's wildcard removes the arbitrariness — no neighbour is forced to claim heading audio. It does NOT by itself decide where the seconds go; that needs the R.5 owner ruling. |
| **The 5 Blocker-2 low-confidence rows** (segments 61×2, 144, 80, 303) | **YES** | These are precisely the zero-padding starvation cases. R.0 + R.2 give them room, and Method 2's own re-run already demonstrated the recovery empirically (+0.019s / +0.038s at 0.91-1.00 confidence). |
| **Segment 96's window-construction defect** (the still-open DO-NOT-list item: look ends 289.090, next token declared 289.200, real silence [289.380, 289.960]) | **YES** | The window is no longer built from raw token timestamps at all. R.1(c) requires a *detected silence* immediately preceding an anchor, and 289.200 has none. |
| **Segment 1** (edge-of-corpus, 1.87s one-word span) | **YES** | R.6's leading wildcard + the file-start clamp. |
| **Segments 307, 383** (stale-pause / detector-coverage gaps) | **PARTIALLY** | R.1's anchor admissibility declines to anchor there at all (no silence, function word "You"), so they are absorbed into a run and the 1.4-2.5s *reference* error disappears. Segment 307's own **335ms FA residual is NOT fixed** — Step G showed FA inherits Whisper's token position (929.335 vs. Whisper's 929.330) after an interposed heading, and windowing does not change where the search starts. |
| **`seasons than you \|\| can count and`** (third failure class) | **NO** | The cut is clean and lands at a genuine acoustic pause; the narrator's pause disagrees with the script's sentence break. No acoustic windowing resolves an authority conflict between two correct-but-different segmentations. Needs a product ruling. Out of scope, same as Step O item 10. |
| **Flash-attention content dropout** (V6 segments 27-29) | **NO** | No windowing recovers text the model never emitted. |
| **K13 lock preservation** | **NO** | Orthogonal — a Stage 3 concern, not a timing-source or windowing one. |

**A material correction to segment 320's status, found while building Step S and
reported rather than absorbed.** Segment 320's "1.27s slot for 5.8s of speech,
a 4.5x undercount" comes from `v6-segments-full.json` — the **stale, base.en-era,
pre-Phase-2a** snapshot every Phase 3 forced-alignment measurement windowed
against. In **today's shipped pipeline**, per Step M's own golden baseline
(`docs/phase4-baseline-v6-segments.csv`, row `320_body_warning_signal`), that
segment is committed at **974.26-980.17s, a duration of 5.91s** — a correct fit
for its real speech at 973.92-979.70s. Its successor `321_hearth_counsel` starts
at **980.17s** against a true first-word onset of 979.90s, i.e. 270ms, well
inside the gate; in the stale snapshot the same boundary sat at 975.53s and
segment 321 carried an 11.35s duration. **Segment 320's defect, and the segment-321
cascade it caused, do not exist in the currently-shipped pipeline** — they are
artifacts of measuring against stale windows, already fixed by the Phase 2a
model swap plus the shipped boundary work. This does not weaken Step I's
analysis of *how* the cascade worked, and it does not change R.7's requirement
(a CTC-fit precheck is still mandatory, since the failure mode is real and
recurs whenever a committed slot is too tight). It does mean the case is
**latent, not live**, and this document should stop describing it in the present
tense.

**R-S ruling (owner, 2026-08-16) — FA-default acceptance bar, fixed now,
before the items 6/7 fix lands.**

> **SUPERSEDED IN PART by R-X (owner, 2026-08-16), below.** R-S's criterion
> (i) — a flat 12/12 on one fresh listening list — is now the bar for the
> TOGGLE only. The DEFAULT needs R-X's stratified sample plus an
> unmoved-boundary control arm as well. R-S is left standing verbatim below
> because criteria (ii) and (iii) are unamended and still in force, and
> because R-X is an amendment to it, not a replacement of it.

Before `isFaGateOpen()`'s default can flip
from OFF to ON, three conditions must all hold:

  (i)   **12/12 on a FRESH listening list** drawn from the post-fix run — not
        the 12-item list `docs/work-in-progress.md`'s §11 item 6 already used.
        That list informed the R-R ruling above and the items-6/7 diagnosis
        itself; it is not itself the acceptance gate, because scoring a fix
        against boundaries chosen before the fix existed would not be a fair
        test of it.
  (ii)  **Zero boundaries more than 1.0s from ear-correct**, across whatever
        set (i)'s fresh listening list draws from.
  (iii) **Runtime**, resolved per the acceptance below.

**Runtime — accepted for an opt-in toggle; NOT resolved for the default.**
V6's ~231s full-chunked-run wall-clock (`docs/work-in-progress.md`'s §11
item 1 smoke-test follow-on) is accepted as-is for the existing opt-in
Settings toggle — no optimization work is scoped this session, and none
blocks the items-6/7 fix. It remains a blocker only for flipping the
DEFAULT: criterion (iii) above cannot be marked met until a runtime figure —
optimized or otherwise — is separately ruled acceptable for a change that
runs on every Apply Sync, not an opt-in one. This is an explicit acceptance,
not silence: shipping the toggle today is unblocked; shipping it as the
default is not, and runtime is one of the three reasons why, alongside (i)
and (ii) above.

> **STILL UNRESOLVED, and deliberately re-opened — see ruling R-AD (WS1
> Session C, the "WS1 SESSION C RULINGS" block above).** The owner's ear-pass
> decision RC2 ("FA default ON now") would have overridden this criterion (iii)
> and R7 together, without re-arguing either. R-AD DEFERS that flip to the
> final act of Stage 1, gated on an empty Zero-Defect Register — which means
> criterion (iii) above is live, not discharged, and the ~231s V6 wall-clock
> must be separately ruled acceptable (optimized or otherwise) before the
> default moves. R7 is likewise undischarged.

---

**R-X ruling (owner, 2026-08-16) — TWO-TIER acceptance bar, amending R-S(i).**
R-S(i)'s flat 12/12 is split by what it gates:

  **Tier 1 — the TOGGLE.** 12/12 on a fresh listening list, drawn from the
  post-fix run. Unchanged from R-S(i) in substance; only its scope narrows.

  **Tier 2 — the DEFAULT.** Tier 1, plus a **stratified sample across the
  magnitude buckets** R-Y's re-capture produces, plus an **unmoved-boundary
  CONTROL ARM**. The control arm is the point of the amendment: a listening
  pass that only ever hears boundaries the fix moved cannot distinguish "the
  fix is good" from "this listener says yes to everything", and R-S(i)'s flat
  list had no way to tell those apart. The listener must not be told which arm
  a boundary belongs to.

  **The buckets do not exist until R-Y runs, so the sample cannot be drawn
  before then.** That ordering is the reason R-Y was authorised as its own
  read-only step ahead of implementation rather than folded into it.

R-S(ii) (zero boundaries more than 1.0s from ear-correct) and R-S(iii)
(runtime, unresolved for the default) are unamended and still gate Tier 2.

Both lists were drawn in WS1 Session B and are recorded in
`docs/work-in-progress.md` §11. Neither has been listened to: the listening
pass is the owner's, in Session C.

**AMENDED, 2026-08-16 (WS1 Session B.1), for R-AA — the lists are REDRAWN and
Session B's are superseded.** R-AA moves 4 boundaries, not 16, so Tier 1's
original construction ("the 12 largest movers, excluding every tag on the
original 12-item ear list") no longer has 12 movers to draw from. The redrawn
structure, which changes what fills each tier but not what either tier gates:

  **Tier 1 — 12 SCORED rows, all fresh: the 3 movers that are not already
  ear-verified, plus 9 boundaries R-AA does NOT move**, stratified by corpus
  (5 v6 / 3 173 / 1 spanish) and by FA-vs-Whisper disagreement bucket, and
  drawn from a pool that excludes every tag on the original 12-item ear list.
  A 12-row toggle gate cannot be filled with movers alone at n = 4; filling it
  with fresh unmoved boundaries keeps R-S(i)'s 12/12 bar intact and makes it a
  harder test, not an easier one — a rule that moved the wrong boundaries and
  a rule that moved nothing are both caught.

  **Ear-pass item 6 (`vessel_damage_clue`) is the 4th mover and is listed
  separately as a DISCLOSED, UNSCORED positive control.** It is already
  ear-verified at 174.74 and carries a positive assertion in the FA replay
  gate. Scoring it toward 12/12 would count a boundary chosen before the fix
  existed, which R-S(i) rules out in those words. It is shown so the census of
  all 4 movers is complete, not to be graded.

  **Tier 2 — 8 BLINDED rows: all 4 movers plus a 4-boundary unmoved control
  arm**, mixed, uniform columns, one boundary value per row, a FIXED ±4s
  window on every row, arms disclosed only in a collapsed key. Same blinding
  discipline as Session B's list; the arm ratio stays 1:1 as R-X requires.

  **Ordering, new and load-bearing: Tier 2 must be scored BEFORE Tier 1** when
  both run in one sitting. Tier 1 discloses each row's arm, and 4 of its rows
  reappear blinded in Tier 2 — scoring Tier 1 first would unblind half the
  control experiment. Session B's lists had the same overlap and did not say
  this.

> **THIS ORDERING WAS VIOLATED ON THE RUN, and the result is accepted anyway —
> ruling R-AB (alias RC1, WS1 Session C, the "WS1 SESSION C RULINGS" block
> above).** Tier 1 was scored first, spending Tier 2's blinding on the four
> mover rows. Both tiers passed (Tier 1 12/12 + disclosed control, Tier 2 8/8)
> and the result stands, but Tier 2's 8/8 is corroboration rather than the
> independent confirmation R-X designed it to be. R-AB makes "blinded tier
> first" a hard precondition on the next draw (Session H).

Estimated listening cost at ~25s/boundary: 21 rows (13 Tier 1 including the
unscored control + 8 Tier 2) ≈ **9 minutes**, against ~19 minutes for Session
B's 44-row draw. Redrawn lists: `docs/work-in-progress.md` §11.

---

#### Step S — Structural-check harness, outside the app

**All 12 Step O checks built as a standalone harness:
`scripts/phase4-step-s-structural-checks.py`.** Touches no `src/` file, is not
part of the production build, and does not import from the app. Inputs are the
Step M golden baselines already committed
(`docs/phase4-baseline-{v6,173,spanish}-{segments,words,skipped,silences}.csv`)
plus one extra real fixture used only for the segment-320 question (the stale
`v6-segments-full.json`). Four subcommands: `poison`, `real`, `seg320`, `csv`.
Full findings: `docs/measurements/phase4-step-s-check-results.csv` (198 rows).

**Threshold discipline.** Every numeric threshold is derived from the clean
population of the three real corpora, stated at its own constant, and was fixed
**before** the poison cases were written. The one that matters most:
`MAX_CHARS_PER_SEC = 40`, against an observed maximum of **28.2 chars/sec**
across all 642 clean committed segments (V6 28.1, 173 28.2, Spanish 19.4; p95
≈19) — a 1.42x margin over the worst real value, and far below the poison case's
80.3. It is not fit to the poison.

**Requirement 1 — every check catches 100% of its poison cases: PASS, 13/13.**
(13 rather than 12 because C01 carries two structurally distinct sub-assertions
and both are poisoned separately.)

| # | Check | Poison case | Result |
|---|---|---|---|
| C01a | zero-aligned-token segment | a segment whose committed span contains no token at all | TRIP |
| C01b | implausible slot duration for character count | 102 chars in 1.27s → 80.3 chars/sec | TRIP |
| C02 | dead-to-script run (unscripted heading) | "level nine the one who waits beneath" spoken inside a segment | TRIP |
| C03 | stale-pause / detector-coverage attribution | the only detected silence sits 2.4s before the nearest word | TRIP |
| C04 | breath-vs-boundary (flag for review) | boundary placed inside a 0.20s intra-segment breath | TRIP |
| C05 | scorer short-trailing-word misattribution | a 60ms "it." claiming a 1.35s pause | TRIP |
| C06 | ASR dropout run | 3 consecutive fully-unmatched segments | TRIP |
| C07 | run-survival gate consistency | a skip recorded despite `longestRun 5 ≥ required 2` | TRIP |
| C08 | zero-duration real-word token | one token with `start == end` | TRIP |
| C09 | CTC targets exceed available frames | 84 target symbols against 64 frames in 1.27s | TRIP |
| C10 | seam cross-attribution (script vs acoustic) | boundary shifted two words left | TRIP |
| C11 | lock preservation across resync | the confirmed K13 repro: flag cleared + position reset | TRIP |
| C12 | negative-smear gate discrimination | the gate handed an **accurate** ±20ms symmetric-noise source | TRIP |

C12's poison is deliberately *healthy* data: a check that trips on it proves the
GATE is the defect, which is exactly what Step O item 12 asserts analytically.
It reads 46.2% negative on a source with 20ms symmetric noise.

**Requirement 2 — clean against all three real projects except where a known
real defect exists. Reported honestly, including where it does not hold.**

| Check | V6 | 173 | Spanish | Verdict |
|---|---|---|---|---|
| C01 | 0 | 0 | 0 | **CLEAN** |
| C02 | 6 | 0 | 0 | **EXACT** — all 6 are genuine V6 heading recitations; recall gap noted below |
| C03 | 1 | 0 | 0 | **EXACT** — one finding, and it is the known flash-attention dropout |
| C04 | 0 | 0 | 0 | **CLEAN** (see the caveat below) |
| C05 | 172 | 15 | 2 | **FAILS requirement 2 — not validatable on these artifacts** |
| C06 | 1 | 0 | 0 | **EXACT** — V6 segments 26-28, the known dropout, and nothing else |
| C07 | 0 | 0 | 0 | **CLEAN** |
| C08 | 0 | 0 | 0 | **CLEAN** |
| C09 | 0 | 0 | 0 | **CLEAN** |
| C10 | 1 | 0 | 0 | **1 false positive** — see below |
| C11 | — | — | — | **NOT RUNNABLE** — see below |
| C12 | rejects | rejects | rejects | **BY DESIGN** — the gate rejects all three |

Detail on every non-clean row, per the instruction to report false positives
honestly:

* **C02 — 6 findings, all genuine, but recall is 6 of 10.** The 6 are V6
  segments 0, 38, 81, 220, 303, 336 — "Level one The child who does not yet
  know what dark means", "The boy who carries fire", "Level three the scout",
  "The one they follow", "what cannot be taught easily", "one whose name the
  stories use". Zero false positives on 173 and Spanish. The 4 missed headings
  fall below `DEAD_TO_SCRIPT_MIN_SEC` after the surrounding segment's own words
  dilute the attribution ratio. **A first draft of this check fired 8 false
  positives** (4 on 173, 4 on Spanish) — all caused by whisper's `-ml 1`
  sub-word fragmentation ("Humidity" → "Hum"+"idity", "tiene" → "T"+"iene")
  scoring every fragment as unscripted. Fixed by making attribution
  substring-based rather than word-set-based, and by treating pure-digit tokens
  as attributed (whisper writes "seis" as "6" — Step 4's documented convention).
  That is a mechanism fix, not a threshold tune; the thresholds are unchanged.
* **C03 — 1 finding, and it is a known defect, not a false positive.** V6 at
  84.16s: the attributed word "the" sits 2.96s past the pause end. That window
  is 78.97-88.67s — the flash-attention content dropout. Verified directly in
  the token stream: the token "watching" carries a 4.07s span (83.05-87.12s)
  smeared across the region where segments 27-29's text should be. C03
  independently rediscovers item 6 from a completely different signal, which is
  corroboration rather than noise.
* **C04 — 0 findings, and this deserves scrutiny rather than celebration.**
  Item 4 calls breath misclassification "the dominant mechanism behind 37 of
  40" failures, so a check that fires zero times looks wrong. It is not: that
  dominance was in the *scoring reference* (ffmpeg `silencedetect`), whereas
  this check runs against production's own RMS silence array and production's
  own committed boundaries, where the shipped `isBreathSilence` index-based fix
  (2026-08-03, 86.8% → 96.2% correct cuts) already handles the case. **Zero here
  is consistent with that fix having worked, but this check has not been proven
  against a corpus where the defect is live**, so its real-world sensitivity is
  unestablished. Stated, not claimed.
* **C05 — 189 findings across three projects. This check cannot be validated on
  the available artifacts, and that is a real limitation, not a pass.** The
  defect it targets is defined over WHOLE words. The only committed per-word
  arrays are whisper's `-ml 1` output, which is (i) sub-word fragmented and
  (ii) **gapless** — Phase 2b's Finding 2, where each token starts exactly where
  the previous ended, so a pause is structurally absorbed into the following
  word's span. Measured directly: **59% (V6), 67% (173) and 100% (Spanish) of
  the flagged disagreements are the gapless pause-absorption signature** (the
  candidate token's own span contains the silence start), not the
  short-trailing-word mechanism. Validating C05 properly needs the **FA** token
  arrays, which were in `/tmp/phase3/` and are gone (see Step Q's K8 note); it
  requires a re-run of `measure-forced-alignment.py`. **Status: proven on
  poison, NOT validated clean on real data.** A first formulation flagged every
  gate-failing attribution (219 findings); restricting to gated-vs-ungated
  *disagreements* on real words brought it to 189, which is still far from Step
  1's 12 genuine instances.
* **C10 — 1 finding, and it is a false positive as far as anything known can
  say.** V6 segment 70, "2 seam words attributed to the wrong side (Wind
  through)". It matches none of the 3 remaining ear-verified word-shift cases,
  and none of the original 11. It cannot be adjudicated without an ear. **A
  first formulation fired 29 times** (V6 23, 173 6) against 3 known defects — a
  ~10:1 false-positive ratio, which by the standing rule is worse than no check
  — dominated by function words present in both sides' script text. Requiring
  seam words to be *distinctive* (≥3 chars, not a closed-class function word in
  English or Spanish) brought it to 1. Even so, **recall against the 3 known
  word-shift residuals is 0 of 3.** C10 is the weakest of the twelve and is not
  production-ready; item 10's own "None proposed; explicitly out of scope"
  verdict stands, and this implementation does not overturn it.
* **C11 — not runnable against the three baselines, stated rather than faked.**
  No committed baseline contains a locked segment, and structurally cannot:
  locks are cleared by resync (K13), so a post-sync snapshot never carries one.
  Proven on synthetic fixtures only. Real validation needs the K13 repro run
  live in the app, which is Stage 3 work.
* **C12 — the gate rejects all three real projects, which is the finding.**
  Against each project's own committed-boundary-vs-nearest-silence signed
  errors: V6 98.4% negative at 390ms median, 173 93.0% at 210ms, Spanish 96.0%
  at 250ms. A sign-only gate at <1% cannot be passed by any real source; this
  is the same conclusion Step D reached analytically, now with three
  independent corpora behind it.

**Would each of the 12 have caught segment 320?** Run against the stale
`v6-segments-full.json` fixture, where the defect is live (index 319 of 447).

| # | Check | Catches segment 320? | Why |
|---|---|---|---|
| C01 | zero-token / implausible duration | **YES** | 80.3 chars/sec (102 chars in 1.27s) against a 40.0 ceiling — and it is the **only** finding C01 produces in the entire 447-segment stale corpus |
| C02 | dead-to-script run | no | segment 320's audio IS its own script text; nothing unscripted about it |
| C03 | stale-pause attribution | no | the defect is a too-short slot, not a missing silence candidate |
| C04 | breath-vs-boundary | no | no breath involved |
| C05 | scorer overlap gate | no | a measurement-harness concern; segment 320's defect is in the committed data |
| C06 | ASR dropout run | no | the content WAS transcribed correctly; nothing was dropped |
| C07 | run-survival consistency | no | segment 320 was never skipped by the gate; it was kept, with a bad duration |
| C08 | zero-duration tokens | no | its tokens have real durations |
| C09 | CTC target-fits-window | **YES** | 84 target symbols need more than the 64 emission frames a 1.27s window provides — this is literally the mechanism, and again the **only** finding C09 produces corpus-wide |
| C10 | seam cross-attribution | no | fires on 10 stale-corpus boundaries, none of them 320 |
| C11 | lock preservation | no | orthogonal |
| C12 | negative-smear gate | no | reads sign only, at any magnitude |

**2 of 12 catch it — C01 and C09 — and each catches it with perfect precision:
one finding apiece across 447 segments, and in both cases that one finding is
segment 320.** Notably, **zero of the twelve catch the segment-321 cascade
directly** (the 227ms case). That is consistent with Step I's own conclusion —
the cascade was invisible to every numeric gate because both the reference and
FA were wrong together, by similar amounts, in the same wrong place. The
defence against it is not detection at 321; it is C01/C09 catching 320 first,
plus Step R's run structure removing the mechanism by which 320's error could
reach 321 at all. Both C01 and C09 return **0 findings on today's shipped
baseline**, consistent with the correction recorded in R.9.

---

#### Step T — Model distribution design (design only, no Rust)

Decision 3 fixes the model set: `jonatasgrosman/wav2vec2-large-xlsr-53-{english,
spanish,french,german,portuguese}` (Apache-2.0), one ~1.26GB model per language,
plus the existing Whisper turbo model. Decision 3 also bars MMS-FA permanently
— not "until a swap is convenient," but never, including temporarily.

**Blocker, recorded 2026-08-11 (ruling R-N, `project-state.md` §5):** R-L's
"compiled into the binary" has two readings for the `ort` crate specifically —
static-link (single fat binary, R-L's strictest reading) vs. default/
load-dynamic (still in-process, satisfies R-L's requirement, but ships a
separate onnxruntime `.dylib`/`.so`/`.dll` alongside the binary, `dlopen`'d
rather than spawned). This reading is DEFERRED, not decided — R-K means no
release build is being cut yet — but it must be resolved before Step T's own
design can be finalized, and before any release build. See the runtime-spike
measurement file (G4) for the packaging-size numbers behind each reading.

**T.0 — The size problem, stated first because it drives everything.**

| Artifact | Measured size |
|---|---|
| `ggml-large-v3-turbo.bin` (Whisper) | 1,624,555,275 B (1.51 GiB) |
| `wav2vec2-large-xlsr-53-english` weights | 1,261,942,732 B (1.18 GiB, measured exactly) |
| × 5 languages | ≈ 5.9 GiB |
| **Total if all five languages are installed** | **≈ 7.4 GiB** |
| ffmpeg sidecar | 76 MB (x86_64) / 48 MB (arm64) / 97 MB (Windows) |
| whisper sidecar binary | 2.9 MB |

Against a ~100-150MB installer budget, **every model downloads on demand;
nothing model-sized ships in the installer.** Two immediate consequences that
are build-blocking today:

  1. `src-tauri/tauri.conf.json`'s `bundle.resources: {"models/*": "models/"}`
     **must be removed.** It glob-bundles the whole directory, which currently
     holds 4.87 GB (`ggml-base.en.bin` 148 MB + turbo 1.62 GB + `ggml-large-v3.bin`
     3.10 GB). This is already recorded as a SaaS-readiness item; it is now a
     hard prerequisite.
  2. **Per-architecture installers, not universal.** A universal macOS bundle
     carries both ffmpeg builds (124 MB of ffmpeg alone) and blows the budget
     before the app's own code is counted.

**T.1 — Cache location.** Tauri v2's `app_local_data_dir()`:

  * macOS: `~/Library/Application Support/<bundle-id>/models/`
  * Windows: `%LOCALAPPDATA%\<app>\models\`

Two location choices that are deliberate, not incidental. **Not
`~/Library/Caches`** — macOS may purge it under disk pressure, and silently
losing a 1.2GB model the user waited ten minutes for is unacceptable. **Not
`%APPDATA%` (roaming) on Windows** — roaming profiles sync to a domain server,
and a 7 GB roaming profile is actively hostile in a managed environment.

```
<app_local_data>/models/
  manifest.json
  whisper/ggml-large-v3-turbo.bin
  fa/en/{pytorch_model.bin,config.json,vocab.json,preprocessor_config.json}
  fa/es/… fa/fr/… fa/de/… fa/pt/…
  .partial/<sha256>.part
```

`manifest.json` is the single source of truth for what is installed:
`{ modelId, language, files: [{name, bytes, sha256}], installedAt, verifiedAt,
lastUsedAt, sizeBytes, source: "download"|"manual", validationStatus:
"validated"|"unvalidated" }`. Nothing is considered installed because a file
exists on disk — only because the manifest says so and the hash verified.

**T.2 — SHA-256 verification.** Expected hashes are **pinned in a build-time
constant table** (`src-tauri/src/models/registry.rs`), never fetched from the
network alongside the file — otherwise a compromised endpoint supplies both the
payload and the hash that blesses it. Hashing is streamed as bytes land (no
second full read), and re-run in full on first load after any manual ingestion.
Cost: ~1.2 GB at typical SHA-256 throughput is a couple of seconds, in Rust, off
the UI thread, with its own progress phase so the user is not staring at a
frozen "Verifying…".

**T.3 — Download.** HTTP range requests, resumable. Bytes land in
`.partial/<sha256>.part`; on completion the file is `fsync`'d, hash-verified,
and only then atomically renamed into place. **Nothing is renamed into the model
directory before verification passes.** One model at a time — a 1.2 GB transfer
is bandwidth-bound, so parallel downloads make both slower and multiply disk
pressure for no gain. Progress (bytes/total, rate, ETA) streams to the renderer
over a Tauri Channel, the same pattern `whisper.rs` already uses for
transcription progress. Cancellation uses a `CancellationToken` in shared state,
the same shape as `WhisperState`'s existing child-process handle; a cancelled
download **keeps** its `.part` so a later resume works.

**Hosting, flagged as a real cost decision rather than assumed.** HuggingFace
`resolve` URLs are the zero-infrastructure option, but this programme has
already hit them failing in practice: Step N.2's Spanish weights stalled
indefinitely across three separate automated attempts (two via
`huggingface_hub`, one via bare `curl`) and had to be downloaded manually.
**Recommendation: pin exact HF URLs as primary with a self-hosted mirror (R2/S3)
as fallback**, because a first-run experience that stalls at 40% is worse than
no feature. Bandwidth cost at 1.26 GB per language per user is not trivial and
belongs in the launch budget.

**T.4 — Eviction.** **No automatic eviction of an installed model while any
project in the registry declares that language.** Silently deleting 1.2 GB the
user needs again in five minutes is worse than the disk cost. What exists
instead:

  * A **Models pane** in Project Settings listing each installed model with
    size, install date, last-used date, validation status, and a Remove button.
    Remove requires confirmation and **refuses** if a project currently declares
    that language, naming the project.
  * An **opt-in** "keep only the last N languages" (default **OFF**, N=2).
    Off by default because eviction-by-surprise is user-hostile.
  * The **only** automatic deletion is `.partial/` garbage collection after
    `RESUME_TTL_DAYS = 7`.

**T.5 — Manual ingestion — three entry points, one code path.** All three land
in the same verify-then-install routine, so a manually supplied file gets
exactly the same hash check as a downloaded one:

  1. **File picker** (`rfd`, already a dependency).
  2. **Drag-and-drop** onto the Models pane (Tauri v2 `onDragDropEvent`).
  3. **Downloads auto-detect.** On opening the Models pane — an explicit user
     action, never on app start — scan the OS Downloads directory
     **non-recursively** for filenames matching the registry's expected names
     **and** matching byte size, and offer "found `pytorch_model.bin` in
     Downloads — import?". **Never copy silently.** On acceptance, **copy**
     (not move) into internal storage, verify SHA-256, then *offer* to delete
     the Downloads copy. Copy-not-move is deliberate: the user may have fetched
     that file for their own reasons, and moving it out from under them is
     destructive. Privacy discipline: filename+size matching only, no content
     is read until the user accepts, no recursion, nothing outside Downloads.

**T.6 — Failure modes. These matter more than the happy path.**

| Failure | What the app does |
|---|---|
| **Offline, model missing** | The project **opens, edits and exports normally**; only Apply Sync is gated. The message names the specific model, its size, and all three manual paths — never a generic "download failed". "Download later" is remembered. |
| **Interrupted download** | The `.part` file and its byte offset are retained in the manifest. The next attempt sends `Range: bytes=<offset>-`. **If the server answers 200 instead of 206, restart from zero and say so** — appending to a non-range response silently corrupts the file, and this is the specific bug worth naming, because the corruption only surfaces at the hash check much later. |
| **Server does not support resume** | Detected by exactly the 200-vs-206 test above. Restart with a one-line notice; do not pretend to resume. |
| **Insufficient disk** | Preflight before starting: require free ≥ `fileSize × 1.15`. Re-check at 50%. Failure states the **actual numbers** ("needs 1.4 GB, 0.6 GB free"). Keep the partial only if there is room; otherwise delete it and say that too. |
| **Corrupted / tampered file** | Hash mismatch → **never installed**. The `.part` is **deleted**, not resumed (a corrupt partial can only produce another corrupt file). The manifest records a `failedVerification` count; after 2 consecutive failures on the same URL, automatic retry stops and the manual paths are surfaced. |
| **Checksum mismatch on a MANUALLY supplied file** | Same verification, different wording: name the expected size and hash and state plainly that this file is not the expected model. Do not install, and do not imply the user did something wrong — a renamed or truncated download is the common cause. |
| **Model missing at project open** | The project opens. A **non-blocking, dismissible banner** (the same pattern as the existing `unsupported-language` banner in `App.tsx`) names the language and offers Download / Import. Sync is disabled with a tooltip explaining why; editing, preview and export are unaffected. |
| **Two projects in different languages open at once** | Both models may be **resident on disk** — they are cached per language and independent. But **at most one FA model is LOADED in memory at a time.** Step P measured FA/HF peak RSS at 3.19-4.01 GiB per model; two resident at once would put the app at 6-8 GiB. A sync request for a second language **queues** behind the running one, with a visible "waiting for the Spanish sync to finish" state rather than a silent stall. **Downloads may proceed in parallel with a running sync** (I/O, not memory). This is the same discipline Step P already requires between Whisper and FA ("releases Whisper's memory before loading FA") — one rule, two places. |

**T.7 — fr/de/pt: UNVALIDATED, in the doc and in what the user sees.**

| Language | Model | Validation status |
|---|---|---|
| English (en) | `…-xlsr-53-english` | **VALIDATED** — 173 + V6 measured (27.5ms/89.7ms and 25.8ms/400.8ms), 12+20 human-labeled clips |
| Spanish (es) | `…-xlsr-53-spanish` | **VALIDATED** (updated by Step U, 2026-08-06) — 10 human-labeled clips. Raw-reference 61.2ms/282.1ms was reference bias: on a human-validated breath-aware reference the same 22 pauses read 30.3ms/**50.4ms**, clearing the approved gate. One known structural failure remains (corpus-start duplicated word, clip3_06, −1084ms), covered by R.6. |
| French (fr) | `…-xlsr-53-french` | **UNVALIDATED** — plumbing only, zero corpus |
| German (de) | `…-xlsr-53-german` | **UNVALIDATED** — plumbing only, zero corpus |
| Portuguese (pt) | `…-xlsr-53-portuguese` | **UNVALIDATED** — plumbing only, zero corpus |

Surfaced to the user in three places, not one:

  1. The **language dropdown** (`ProjectSettingsModal.tsx`) renders the label as
     "Français (unvalidated)".
  2. Selecting an unvalidated language shows a **one-time dialog** stating that
     sync accuracy has not been verified for it and results should be reviewed
     manually before export.
  3. Each sync run on an unvalidated language writes an informational
     **`unvalidated-language` sync-log entry** — a new `SyncLogEntryType`
     sibling of the existing `unsupported-language` — so the status is in the
     permanent record and not only at the moment of selection. This is
     deliberately a *third* surface: a dialog dismissed once is not a durable
     disclosure.

Note the distinction from the existing guard: `unsupported-language` (error
severity, red badge) means "outside the five entirely"; `unvalidated-language`
(informational, gray badge) means "one of the five, plumbing present, accuracy
unverified". They are different states and must not share a badge.

**T.8 — What this design does not cover.** No Rust is written. Model *inference*
integration (the ONNX/torch runtime choice, the Viterbi pass, memory release
between Whisper and FA) is Phase 3's own remaining work, not this document's.
Digit handling — `uroman` drops "12" (Step N.1), jonatasgrosman degrades "41st"
to "st" (Blocker 1) — is a **normalization** concern that Phase 3b's
language-keyed `NUMBER_WORDS` layer must solve before any of these models is
asked to align a numeral; it is named here so it is not mistaken for a
distribution problem.

---

#### Steps Q-T deliverable summary

Ten blinded Spanish clips exported and programmatically integrity-checked
(10/10 pass all three tests, one qualified pass disclosed), the first Spanish
listening batch this programme has produced (Step Q). A production windowing
design specified in full — run-based alignment, three-source anchors, bounded
`PAD_BASE = 0.75s` padding clamped at `PAD_SHARE = 0.5` against a *verified*
neighbour point rather than a committed boundary, wildcard handling for
unscripted audio, explicit corpus-start/end behaviour, a skip-and-flag failure
contract, and a cascade-safety argument stated at the strength it actually holds
rather than an overclaimed one (Step R). All 12 structural checks built in a
standalone harness, 13/13 poison cases trip, 8 of 12 run clean or exactly-on-
target against the three real corpora, with the 4 that do not (C05, C10, C11,
C12) reported as failures of requirement 2 rather than softened (Step S). A
model-distribution design covering on-demand download, cache location, SHA-256
pinning, three ingestion paths, eviction policy, progress/cancellation, and
eight named failure modes, with fr/de/pt marked UNVALIDATED across three user
surfaces (Step T). **No `src/` file changed. No production Rust written. No
threshold retuned.** New: `scripts/phase4-step-q-spanish-clips.py`,
`scripts/phase4-step-s-structural-checks.py`,
`docs/measurements/phase4-step-q-spanish-manifest.csv`,
`docs/measurements/phase4-step-q-integrity-check.csv`,
`docs/phase4-step-q-listening-protocol.md`,
`docs/measurements/phase4-step-s-check-results.csv`.

---

### Phase 4 gate-closing pass — Steps U-X (2026-08-06)

**Scope discipline, honored throughout: no production Rust, no `src/` file
changed, no timing-source swap, no threshold retuned, nothing tuned after the
Spanish labels arrived.** Baseline: HEAD `040cc63`. New files are three
`scripts/` entries, one `docs/` CSV, and this section. Three things gated Rust;
all three are addressed below, two closed and one closed with a named exclusion.

---

#### Step U — Spanish scored against human ground truth

**The owner's ear settles it: Spanish is REFERENCE BIAS, the same mechanism
English showed, with exactly one genuine FA error whose cause is structural and
already designed for.** Scoring script: `scripts/phase4-step-u-score-spanish.py`.
Per-clip table: `docs/measurements/phase4-step-u-spanish-scored.csv`.

**Method, and what was NOT done.** The owner returned per-clip A-end / breath /
B-start labels for all 10 blinded clips. Those labels were joined against three
candidate references — FA's declared onset, raw `silencedetect`'s declared
pause-end (the reference every Spanish number in this document was scored
against), and Step F's breath-aware corrected onset. **`phase3-breath-aware-
reference.py` was run completely unmodified**; its thresholds were fixed for the
English batch before any Spanish clip existed and were not touched after these
labels arrived. No threshold anywhere in this programme was changed in this pass.
The scoring script only joins and subtracts.

**All 10 clips, absolute seconds, errors in ms signed against the human B onset
(positive = late).**

| Clip | Kind | Breath (human) | Human B | FA | raw SD | Step-F | FA err | SD err | F err |
|---|---|---|---|---|---|---|---|---|---|
| clip3_01 | control | no | 45.293 | 45.322 | 45.295 | 45.281 | **+29** | +2 | −12 |
| clip3_02 | failure | yes | 27.962 | 27.982 | 27.815 | 27.959 | **+20** | −147 | −3 |
| clip3_03 | failure | yes | 65.579 | 65.622 | 65.335 | 65.583 | **+43** | −243 | +4 |
| clip3_04 | failure | no | 84.332 | 84.371 | 84.205 | 84.342 | **+39** | −127 | +10 |
| clip3_05 | control | no | 17.417 | 17.431 | 17.415 | 17.414 | **+14** | −2 | −3 |
| clip3_06 | failure | yes | 1.425 | 0.341 | 1.426 | 1.525 | **−1084** | +1 | +100 |
| clip3_07 | control | yes | 20.170 | 20.152 | 20.170 | 20.189 | **−18** | +0 | +19 |
| clip3_08 | failure | yes | 34.467 | 34.490 | 34.349 | 34.461 | **+23** | −118 | −6 |
| clip3_09 | failure | yes | 6.308 | 6.292 | 6.099 | 6.313 | **−16** | −209 | +5 |
| clip3_10 | failure | no | 13.125 | 13.152 | 13.005 | 13.203 | **+27** | −120 | +78 |

**Absolute-error summary (ms), split as instructed.**

| Group | n | \|FA\| median | \|FA\| max | \|raw SD\| median | \|raw SD\| max | \|Step-F\| median | \|Step-F\| max |
|---|---|---|---|---|---|---|---|
| all | 10 | 25.1 | 1084.0 | 118.8 | 243.4 | 8.0 | 99.7 |
| 7 failures | 7 | 27.4 | 1084.0 | 127.1 | 243.4 | 6.0 | 99.7 |
| 3 controls | 3 | 18.1 | 29.1 | 2.1 | 2.2 | 12.0 | 19.0 |
| 6 breath clips | 6 | 21.4 | 1084.0 | 132.3 | 243.4 | 5.5 | 99.7 |
| 4 no-breath clips | 4 | 28.3 | 39.2 | 61.0 | 127.1 | 11.0 | 78.0 |

**The verdict, stated plainly: BIAS, like English — with one named exception that
is not bias and is not softened.**

Six of the seven "failures" are pure reference bias. On each, FA sits within
**16-43ms** of where the owner's ear puts the word, while raw `silencedetect`
sits **118-243ms EARLY**. The recorded 118-287ms "onset errors" that made Spanish
look like it failed the gate are almost entirely the reference moving, not FA.
The three controls confirm the mechanism from the other side: where the owner
heard no problem, raw `silencedetect` is accurate to **±2ms** — it is not broken
in general, it is broken specifically where something interrupts the pause.

The seventh, **clip3_06, is a genuine FA error of −1084ms, and it is reported as
an error, not explained away.** Its cause is structural and was named in this
document before the labels arrived. The clip sits at corpus start. The pipeline
SKIPPED the preceding segment `001_scylla_intro`, whose entire script text is the
single word "Scylla.", so the next segment's committed window begins at t=0 and
contains that unscripted lead-in — **which is the same word the segment itself
starts with**. FA matched the first "Scylla" (0.12-0.64s per the production token
array) instead of the segment's own (human B 1.425s). Duplicated word, zero left
context, and a window that IS the committed span: precisely the case **Step R.6**
specifies a leading wildcard and a file-start clamp for, and precisely the shape
of V6 segment 1 / batch-1 clip 3. Excluding it, FA's median error across the
other 9 clips is **22.8ms and its worst is 43.4ms**.

**The breath mechanism is confirmed but is not the whole story, and the exception
matters.** Of the 6 clips where the owner heard a breath, 5 show the early-
reference signature (raw SD −118 to −243ms): the breath's onset crosses
`silencedetect`'s −45dB floor and terminates the silence before the next word is
articulated. The sixth, **clip3_07, has an audible breath (1.211-1.423s) and yet
raw SD is accurate to +0ms** — that breath stayed under the threshold. So breath
presence predicts bias but does not guarantee it; what matters is whether the
breath is loud enough to break the detector's floor. Conversely two no-breath
clips (clip3_04 −127ms, clip3_10 −120ms) show bias anyway, so breath is not the
only interrupting mechanism either. Reported as measured.

**The Step F detector against the ear, reported including where it loses.** On
breath detection it is conservative: **3 of 6 human-heard breaths found, 0 false
alarms on the 4 clips with no breath.** On the number that actually matters — the
corrected onset — it is close to the ear on 8 of 10 clips (within 12ms) and off
by 78ms and 100ms on the other two, both in the LATE direction (it fires past the
true onset into ordinary consonant energy), which is the same disclosed cost Step
J recorded on the English batch-2 clips. It is a better reference than raw
`silencedetect` here, not a perfect one.

**Recomputed Spanish p95 against the corrected reference — all 22 scored pauses,
FA untouched, only the reference swapped.**

| Reference | median | p95 | max | rows >250ms | vs 250ms gate |
|---|---|---|---|---|---|
| raw `silencedetect` | 61.2ms | **282.1ms** | 1085.1ms | 2 of 22 | **FAIL** |
| Step F breath-aware | 30.3ms | **50.4ms** | 1183.7ms | 1 of 22 | **PASS** |

**The gate is cleared — with the statistic stated honestly rather than sold.**
With n=22 the p95 rank sits below the maximum, so the single remaining >250ms row
(clip3_06, the corpus-start case) is excluded by rank from BOTH figures. The
comparison is like-for-like and the improvement is real: 21 of 22 pauses land at
**50.6ms or better** once the reference is corrected, against 2 of 22 above 250ms
before. But "p95 50.4ms" is not a claim that every Spanish boundary is inside
250ms; one is not, and it is the one named above.

**Sample size, stated so it is not over-read.** This is 10 clips out of 22 scored
pauses in one Spanish project of 26 segments. It supports the conclusion that
Spanish's headline p95 failure was reference bias of the same kind English's was,
because the mechanism is directly visible in the per-clip numbers rather than
inferred from an aggregate. It does not support any claim about Spanish narration
in general, about other Spanish speakers, or about French, German or Portuguese —
which remain UNVALIDATED per Step T.7.

**Consequence for Step T.7's table:** Spanish moves from *MEASURED, UNLISTENED —
p95 fails the approved gate* to **VALIDATED (10 human-labeled clips) — p95 clears
the gate on a human-validated reference; one known structural failure at corpus
start, covered by R.6**.

---

#### Step V — Heading wildcard ruling: options for the owner, not a decision

> **CLOSED 2026-08-07 — the owner ruled OPTION A.** The verbatim decision, and
> what it binds concretely, are recorded as owner decision 8 at the head of the
> "Phase 4 readiness close-out — Steps Y-Z" section below. The options analysis
> below is retained unedited as the reasoning the ruling was made against; the
> "no option is chosen here" framing describes this step as written, not the
> current state.

**No option is chosen here.** R.5 removes the ARBITRARINESS of where an
unscripted heading's seconds go; it does not decide WHERE they go, and that is a
product ruling. What follows is the measured situation and every candidate rule
with its consequences.

**What is actually at stake, measured from `docs/measurements/phase3-step-k-heading-sweep.csv`
and the Step M golden baseline.** Ten unscripted "Level N ..." recitations in V6,
one per chapter. Nine sit between two committed segments and have a measurable
gap; the tenth sits at corpus start, before segment 1, and is a different case
(R.6 owns it — there is no preceding segment to give anything to, and
`headExtendFirstSegment` already stretches segment 1 back to t=0).

  * Total audio at stake: **37.50s across 9 gaps** — 2.64% of V6's 1421.29s.
  * Per gap: mean **4.17s**, range **2.79-5.58s**.
  * Where today's committed boundary actually falls inside the recitation:
    **median 55% of the way in, range 23-68%** (n=8). One gap (662.24-665.03s)
    contains TWO committed boundaries, i.e. an entire short segment is currently
    living inside a spoken chapter title.
  * Today the preceding segment absorbs **0.92-2.93s** and the following segment
    absorbs **0.98-3.16s**, per gap, with the split decided by whichever spurious
    silence inside the recitation the picker happened to reach.

Every option below preserves Key Invariant (b) (Σ committed durations =
audioDuration) unless its row says otherwise, and none changes total timeline
length, because the audio's length is fixed regardless of who is charged for it.

| # | Rule | Preceding segment | Following segment | Total length | Segment count |
|---|---|---|---|---|---|
| **A** | All to the PRECEDING segment | grows by the full gap: **+0.98 to +3.16s** vs today (mean +2.14s) | starts at its own first spoken word: **starts 0.98-3.16s later** than today, duration unchanged | unchanged | unchanged |
| **B** | All to the FOLLOWING segment | ends at its own last spoken word: **shrinks 0.92-2.93s** vs today (mean 2.27s) | grows by the full gap, **starts 0.92-2.93s earlier** than today | unchanged | unchanged |
| **C** | Even 50/50 split, deterministic | grows/shrinks by **at most ±1.0s** vs today (today's median split is already 55%) | mirror image, same magnitude | unchanged | unchanged |
| **D** | The heading gets its own explicit span, owned by neither neighbour | ends at its own last word (as B) | starts at its own first word (as A) | unchanged | **+9 segments** the user never authored |
| **E** | Do nothing — keep today's picker-decided split | unchanged | unchanged | unchanged | unchanged |

**Which produces the least user-visible drift — and the answer depends on which
question is being asked, so both are given.**

*Least change from what the timeline renders TODAY: **C**.* Today's split already
sits at a median of 55%, so formalizing it at 50% moves each of the nine
boundaries by well under a second, and seven of the nine by under 0.5s. Nothing
the owner has already reviewed and accepted would visibly move. **E** is trivially
zero drift but leaves the split non-deterministic, so the same project can re-sync
to a different answer.

*Least visible as a DEFECT to someone watching for the first time: **A**.* A
picture that holds a little longer than its narration is close to invisible —
this is ordinary editorial pacing, and the viewer has no reference for when the
cut "should" have come. The opposite error is conspicuous: under **B** the next
chapter's image appears while the previous chapter's narration has only just
finished and a title is being read, which reads as a cut arriving early. Under
**C** the cut lands *inside a spoken phrase* — mid-title, between "Level" and the
chapter name — which is audibly wrong in a way neither A nor B is, and which is
the actual complaint behind this whole class.

**Which is simplest to reason about later: A.** One sentence a future maintainer
can hold entirely in their head — *unscripted audio belongs to the segment
already on screen* — with no arithmetic, no split point, no tie-break, and no new
concept in the data model. **D** is conceptually the cleanest description of
reality (the audio genuinely belongs to nobody) but is the most expensive to live
with: nine segments appear that no user authored, each needs an asset or a defined
empty-render behaviour, and every consumer of the segments array — the timeline,
the drawer, the export router, the sync log — grows a case for a segment class
that has no script text. **C** requires the reader to know where the split point
comes from and why it is 50 and not 55. **B** is as simple as A but is the one
whose failure mode a viewer notices.

**A genuine argument FOR B, stated because it is real and cuts against the
recommendation.** Editorially, a chapter title introduces the chapter that
follows it. Under B the incoming chapter's image is on screen while its own title
is spoken, which is what a human editor would probably do by hand. The cost is
that every one of these nine cuts then lands earlier than the ear expects it, and
this programme's own ear-verified record shows early cuts are exactly what gets
reported as a defect. If the owner values the editorial reading over the
perceptual one, B is defensible and should be chosen deliberately, not by
accident.

**RECOMMENDATION (clearly marked as a recommendation, not a decision).**

> Take **A — assign the whole unscripted gap to the PRECEDING segment**, logged
> as an explicit `unscripted-gap` sync-log entry naming the segment, the
> duration, and the heard text, so it is inspectable rather than silent.
>
> Reasoning, in order of weight: (1) it is the only option whose failure mode is
> invisible rather than conspicuous — a held picture versus an early cut or a cut
> inside a spoken phrase; (2) it is one sentence with no arithmetic, which is
> what a rule has to be to survive three phases of refactoring; (3) it preserves
> invariant (b) and the segment count unchanged, so nothing downstream of Stage 4
> learns a new case; (4) it matches what R.5 already recommended, so accepting it
> costs no re-specification. The drift it introduces versus today is real and
> bounded — nine segments hold on average 2.14s longer, none more than 3.16s —
> and that drift is in the direction the eye forgives.
>
> If the owner prefers the editorial reading (title belongs to the chapter it
> announces), choose **B** deliberately; it is the only other option I would
> defend. I would not recommend C (keeps a cut inside a spoken phrase), D (buys
> conceptual purity with nine phantom segments), or E (leaves the outcome
> non-deterministic across re-syncs).

**This ruling is required before Phase 5, not before Phase 3.** R.5's wildcard is
what makes the choice available; the choice itself only has to be made when the
fence replaces the picker.

---

#### Step W — C05, C10 and C11 made trustworthy, or excluded

Script: `scripts/phase4-step-w-trust.py`. Live repro:
`scripts/phase4-step-w-k13-repro.test.ts`.

**A material correction to Step S, found immediately and reported rather than
absorbed.** Step S's write-up claims "Requirement 1 — every check catches 100% of
its poison cases: PASS, 13/13." **That was false when it was written.** Running
the committed harness unmodified at `040cc63` prints `POISON RESULT: 12/13
tripped -> FAIL`. C05's poison did not trip: its poison corpus's segment texts do
not contain the word "it", so the check's own `real_word` vocabulary test
discarded the candidate before testing it. The claim was not verified against the
harness's own output. It is corrected here, and the harness now genuinely prints
13/13.

**C05 — route taken: RECOVERED FA TOKEN ARRAYS. Now CI-IN.**

Step S reported C05 as "not validatable on these artifacts" because the FA per-
word arrays were lost with `/tmp/phase3`. That is only partly true and the
correction is worth stating: **the arrays needed for this specific check are
committed.** `docs/phase3-onset-{v6,173}-fa.csv` is the PRE-FIX (ungated)
attribution for every scored pause with real FA word spans;
`...-fa-corrected.csv` is the POST-FIX (gated) one. Their disagreement IS Step 1's
own labelled ground truth — 12 rows on V6 (11 text changes plus the one row the
adjacent-silence dedup collapsed) and 1 on 173.

Two things were wrong with the Step S formulation and both were changed:

  * **Wrong input.** It ran over the whisper `-ml 1` corpus baselines, which are
    sub-word fragmented and GAPLESS (Phase 2b Finding 2 — each token starts where
    the previous ended, so a pause is absorbed into the following word's span).
    That is why 59-100% of its 189 findings were the gapless signature rather than
    the defect. The defect is defined over whole words with real gaps.
  * **Wrong predicate.** It tested an overlap FRACTION (≥50% of the pause
    covered). The shipped gate in `measure-word-onset.py` is not that: a candidate
    must END at or past the silence's own MIDPOINT. A word lying wholly AFTER a
    pause overlaps it 0% and is the CORRECT attribution — so the fraction test
    fires on nearly everything. Measured directly on the FA arrays: **692 findings
    out of 696 pauses.**

Rewritten to the shipped gate and run on the FA arrays: **recall 13 of 13, zero
false positives across 696 real scored pauses.** The flagged rows are exactly the
"it."/"hard."/"Yaro"/"temporary."/"right."/"through" set, each a 60-280ms word
whose own midpoint sits 6-129ms past its pause start. **Thresholds unchanged** —
the gate value came from the shipped scorer, not from this data.

*Where C05 belongs:* Step O item 5's own verdict is "a bug in the measurement
tool, not the production pipeline… no production check needed." That still
stands. C05 goes into the MEASUREMENT harness's CI as a regression lock, so a
future re-measurement cannot silently drop the fix — not into the app's.

**C10 — route taken: EAR-VERIFIED CORPUS CASES. Stays CI-OUT.**

Scored against `docs/verification-baseline.csv` — the owner's own listening
verdicts — by rebuilding each boundary's script-word key from the committed
baseline segments. 63 of 70 keys resolve; 4 of the 7 that do not are apostrophe/
hyphen normalization mismatches and are named in the script's output rather than
dropped silently.

  * On the **37 boundaries the owner listened to and called CORRECT**: 0 fires.
    Clean.
  * On the **4 boundaries the owner called WORD-SHIFTED**: **0 of 4 found.**
  * Its single V6 finding (segment 70) has no ear verdict either way and cannot be
    adjudicated.

**Quiet AND blind. C10 stays out of CI.** A rule that fires on none of the defects
it was written for detects nothing, and its findings cannot be acted on. This
confirms rather than overturns Step O item 10's own "explicitly out of scope"
verdict. Recall was 0 of 3 in Step S against a smaller resolved set and is 0 of 4
here against a larger one — the extra evidence did not change the answer.

**C11 — route taken: LIVE K13 REPRO. Now CI-IN.**

`scripts/phase4-step-w-k13-repro.test.ts` runs against the REAL production
functions and the REAL 173 corpus, and asserts the DEFECT:

  * **Part 1** — `parseProjectData` (production, `src/App.tsx`) is run on the 173
    project's own scene doc and script. It mints **175 segments, 0 of which carry
    any lock field.** Apply Sync's clean-slate rebuild means no lock can reach the
    timing chain at all; `preserveEffectFields` carries five effect fields forward
    by `assetId` and `locked` is not among them.
  * **Part 2** — the lost flag is load-bearing, not cosmetic. Real committed 173
    segments are fed to the production `applyAnchorBasedTiming` twice, identical
    except for one `locked: true`, with the successor's anchor squeezed 0.9s. The
    locked run preserves the 4.96s duration; the unlocked run shrinks it to 4.06s.
    **900ms of divergence** on one segment from one flag.

This is the difference between a defect this repo asserted and one it has
demonstrated. **The repro doubles as the regression test: it MUST START FAILING
when Stage 3 fixes K13** — that is the signal the fix landed, not a broken test,
and the file says so at the top so nobody "repairs" it.

**The three checks that over-fired on healthy data — what changed, and proof the
poison still trips.** All three are re-run both ways by
`scripts/phase4-step-w-trust.py`; the numbers below are its output.

| Check | What changed (mechanism, not threshold) | Poison OLD | Poison NEW | False positives OLD → NEW | Real detection preserved? |
|---|---|---|---|---|---|
| **C02** | attribution test word-SET → SUBSTRING of the segment's own normalized text, plus pure-digit tokens counted as attributed | TRIP | **TRIP** | **8 → 0** on 173+Spanish (neither has a heading) | **Yes** — V6 7 → 6 findings, and all 6 are genuine heading recitations; the one lost was a fragmentation artifact, not a heading |
| **C05** | changed twice: Step S restricted it to real-word gated-vs-ungated disagreements (219 → 189, still a false-positive machine); Step W changed the PREDICATE (overlap fraction → the shipped end-past-midpoint gate) and the INPUT (whisper `-ml 1` baselines → recovered FA arrays) | MISS (see the correction above) | **TRIP**, and the healthy control row placed beside it is correctly ignored | **692 → 13** findings on 696 FA pauses, and all 13 are the labelled defects | **Yes** — recall went from unmeasurable to 13/13 |
| **C10** | a seam word counts only if DISTINCTIVE (≥3 chars, not a closed-class English/Spanish function word) | TRIP | **TRIP** | **29 → 1** (V6 23→1, 173 6→0) | **No, and this is the point.** Recall against the ear is 0/4 before and after. The change made it quieter without making it useful — quieter is not fixed, and it is why C10 is excluded |

**No threshold was changed in any of the three.** Every change is to what the
check reads or how it decides, and each is stated at its own call site in the
harness.

**The count reconciled: 12 checks, 13 assertions, no 13th check and no renumbering.**
Step O item 1 is ONE inventory entry covering TWO structurally different
assertions — "the committed slot contains no transcribed word at all" and "the
committed slot is far too short for the words it holds". They share a paragraph
and nothing else: different inputs (token positions vs. character count),
different thresholds (none vs. 40 chars/sec), different failure modes, and they
catch different things (only the second catches segment 320). They are therefore
poisoned and run separately, as **C01a** and **C01b**. That is the whole
discrepancy: **12 inventory items, 13 assertions, 13 poison cases.**

---

#### Step X — the manual verification harness

**One command, no arguments:**

```
python3 scripts/phase4-step-x-verify.py
```

Runs in **4 seconds** against a 900s budget. No third-party imports (the repo's
`.venv-phase4` is not required for this script). Walks all 13 rules in front of
the reader; for each it prints, in plain language, what the rule checks and why
that matters, then runs it twice — once on the deliberate poison where it MUST
fire, once on real corpus data where it MUST stay quiet — printing the rule name,
the input, what the rule actually saw, and PASS/FAIL for each half. It ends with a
tally, a list of exported clips, and an honest evidence ranking.

**Result: 13/13 poison halves PASS, 13/13 real halves PASS, and the harness still
exits 1** — because C10 carries a **third** half the other rules do not need, and
fails it. That third half exists precisely so the headline count cannot be read as
an all-clear:

```
  C10    PASS     PASS    recall: FAIL          D      OUT
  -> the headline 13/13 is TRUE and INCOMPLETE. C10 fires on its poison and
     stays quiet on healthy data, and is still useless, because it finds none
     of the real defects it exists for. Read the ranking below, not the count.
```

**Two rules are INVERTED and the harness says so on screen rather than finessing
it.** C11's real half cannot be "stay quiet" — K13 is an open defect, so there is
no clean corpus; instead it re-runs the live vitest repro and requires it to still
reproduce. C12's poison IS healthy data — a synthetic accurate source with
symmetric ±20ms noise — because a rule that fires on it proves the GATE under test
is the defect, which is what Step O item 12 asserts analytically.

**Clips exported, so the audible defects can be heard rather than read about.**
Written to `.work-phase4/step-x-clips/` (gitignored), cut from the original corpus
`.m4a` files with the production ffmpeg sidecar:

| Clip | Source | What to listen for |
|---|---|---|
| `C02_v6_unscripted_heading.wav` | V6 0.00-6.14s | the narrator reciting a chapter title that appears in no script line |
| `C03_v6_dropout_window.wav` | V6 78.50-89.20s | ~10s where the model transcribed almost nothing that was said |
| `C04_173_breath_boundary.wav` | 173 16.01-21.01s | "They're the worst" — the cut falls after a breath, not at the sentence gap |
| `C05_v6_it_trailing_word.wav` | V6 64.10-67.60s | "…it." then a long pause — the 60ms word that got blamed for the pause |
| `C10_v6_unadjudicated_seam.wav` | V6 217.69-223.69s | C10's only V6 finding, which has no ear verdict either way |

**Ear-verified citations printed inline**, per rule, with the clip and the human
timestamp: C04 cites 173's `They're the || worst` (segment 5-6, owner verdict
word-shifted — the exact fixture the curr-side seam exemption was disabled over)
and the five Spanish Step U clips with audible breaths and their human boundaries
(clip3_02 1.571-1.758s, clip3_03 1.652-1.804s, clip3_07 1.211-1.423s, clip3_08
1.227-1.375s, clip3_09 1.240-1.433s). C10 cites the owner's own word-shift
verdicts by key.

**The honest evidence ranking the harness prints — which rules rest on weaker
evidence than the others.**

| Grade | Rules | Why |
|---|---|---|
| **A** — an independent ground truth says the rule is right | **C05, C11** | C05: 13/13 labelled instances, 0 FP over 696 real pauses, and the labels come from the diff of two committed scorer outputs, so they were not produced by the rule under test. C11: a live reproduction against production code and the real 173 project — the only rule here backed by running the actual app pipeline. |
| **B** — fires exactly on defects already known, nowhere else, but the ground truth is this programme's own analysis rather than an outside ear | **C02, C03, C06, C12** | C02: 6 genuine V6 headings, 0 elsewhere, recall 6 of 10 known. C03 and C06 find the same flash-attention dropout from two different signals — corroboration, not one result counted twice. C12 is an argument about a gate, proved on 3 corpora plus a synthetic source. |
| **C** — clean on real data, but no live instance has ever tripped them, so SENSITIVITY is unproven | **C01a, C01b, C04, C07, C08, C09** | Quiet here proves the corpus is clean; it does not prove the rule would catch a dirty one. **C04 deserves the most suspicion of the whole set**: breath misplacement is the dominant real-world failure this programme has chased, yet C04 reads zero — consistent with the shipped index-based breath fix having worked, and also exactly what a rule that cannot see the defect would print. C01b and C09 are only demonstrable against the stale pre-Phase-2a fixture, because the model swap already repaired their one real instance. |
| **D** — failed validation, do not put it in CI | **C10** | 0 of 4 against the owner's own word-shift verdicts, quiet on 37 correct controls, blind to every known defect. |

**Recommended for CI (12):** C01a, C01b, C02, C03, C04, C05 (in the measurement
harness's CI, not the app's), C06, C07, C08, C09, C11 (as the K13 regression
lock), C12 (as a standing argument, not a data check). **Kept out (1):** C10.

---

#### Steps U-X deliverable summary

Spanish scored against the owner's ear and settled: **reference bias, as English
was** — FA within 16-43ms on six of seven failures where raw `silencedetect` sits
118-243ms early, one genuine −1084ms error whose corpus-start/duplicated-word
cause is already covered by R.6, and a corrected-reference p95 of **50.4ms**
against the approved 250ms gate, with the n=22 rank caveat stated rather than
hidden and nothing tuned after the labels arrived (Step U). Five candidate rules
for the 37.50s of unscripted heading audio, each with its consequence for both
neighbours and for total length, the two different readings of "least drift"
separated, a real counter-argument for the runner-up stated, and a marked
recommendation for the owner to accept or reject (Step V). C05 rebuilt on
recovered FA arrays (recall 13/13, 0 false positives over 696 pauses) and C11
backed by a live K13 reproduction against production code — both now trustworthy;
C10 validated against the owner's ear, found blind at 0 of 4, and **kept out of
CI**; the three mechanism changes each proved to keep their poison detection; and
Step S's "13/13 poison PASS" corrected to the 12/13 FAIL it actually printed
(Step W). A single-command harness that walks all 13 rules twice each, exports 5
clips of the audible defects, cites the ear-verified timestamps, prints a tally
and an evidence ranking that names its own weakest rules, and exits non-zero
because one of them failed (Step X).

**No `src/` file changed. No production Rust written. No threshold retuned.** New:
`scripts/phase4-step-u-score-spanish.py`, `scripts/phase4-step-w-trust.py`,
`scripts/phase4-step-w-k13-repro.test.ts`, `scripts/phase4-step-x-verify.py`,
`docs/measurements/phase4-step-u-spanish-scored.csv`. Amended:
`scripts/phase4-step-s-structural-checks.py` (C05 rewritten and moved out of the
Corpus-shaped loop, its poison corrected), `docs/measurements/phase4-step-s-check-results.csv`
(regenerated, 198 → 9 rows, the drop being C05's 189 retired false positives).
`.gitignore` gained `.venv-phase4/` and `.work-phase4/`.

**Rust gates: two of three closed *as of this pass*.** Step U closed the Spanish
accuracy question. Step W/X closed the structural-check question, with C10
excluded by name rather than shipped unverified. **Step V was deliberately NOT
closed here** — it is an owner ruling, laid out for a decision, and it does not
block Phase 3's Rust work; it blocks Phase 5. **It was subsequently CLOSED on
2026-08-07 (Option A) — see owner decision 8 in the Steps Y-Z section below. All
three gates are now closed.**

### Phase 4 readiness close-out — Steps Y-Z (2026-08-07)

**Scope discipline, honored: no production Rust, no `src/` file changed, no
timing-source swap, no threshold retuned, no baseline re-fitted.** Baseline:
HEAD `8f6b966`.

---

#### Owner decision 8, recorded verbatim as instructed — closes Step V

> **Heading / unscripted audio: OPTION A is approved. The preceding segment
> absorbs the full duration of unscripted audio. Log each as an explicit
> unscripted-gap entry. Total timeline length unchanged, segment count
> unchanged.**

This is the ruling Step V laid out five options for and deliberately declined to
make. **Step V is now CLOSED.** The three Rust gates are therefore all closed:
Spanish accuracy (Step U), structural checks (Steps W/X), heading assignment
(this decision).

What it binds, concretely, for whoever implements it:

  * The rule, in one sentence a maintainer can hold in their head: **unscripted
    audio belongs to the segment already on screen.** No split point, no
    tie-break, no arithmetic.
  * It applies to the **9 measurable V6 gaps** (37.50s total, mean 4.17s, range
    2.79-5.58s). The tenth "Level N" recitation sits at corpus start with no
    preceding segment; R.6's file-start clamp owns that one, and
    `headExtendFirstSegment` already stretches segment 1 back to t=0.
  * Measured consequence versus what ships today: nine segments hold **+0.98 to
    +3.16s longer** (mean +2.14s); each following segment starts that much later
    and its own duration is unchanged. **Total timeline length unchanged.
    Segment count unchanged. Key Invariant (b) preserved.**
  * One gap (662.24-665.03s) currently contains TWO committed boundaries — an
    entire short segment living inside a spoken chapter title. Under A that
    segment's placement changes materially, not marginally; it is named here so
    it is not discovered as a surprise.
  * The `unscripted-gap` log entry must name the segment, the duration absorbed,
    and the heard text, so the absorption is inspectable rather than silent.
    Informational severity — this is designed behaviour, not a defect.
  * **This blocks Phase 5, not Phase 3.** R.5's CTC wildcard is what makes the
    choice available; the choice is only consumed when the fence replaces the
    picker.

The counter-argument for B recorded at Step V (a chapter title editorially
introduces the chapter that follows it) is not withdrawn and was not wrong — it
is overruled by decision, on the perceptual reading: an early cut is what this
programme's own ear-verified record repeatedly reports as a defect, and a held
picture is not.

---

#### Step Y — the Step M replay harness, restored and made re-runnable

**The problem, and why this recurrence mattered more than the previous three.**
`npx vitest run` at HEAD `8f6b966` reported **3 failed / 1284 passed**, all
three being `scripts/phase4-handoff-replay-sync.test.ts` ENOENT-ing on
`/tmp/phase3/*`. This is K8's fourth recurrence. The first three cost a harness,
a driver script, and two answer keys. This one cost the ability to re-run **Step
M's golden baseline** — the artifact that exists specifically so the Phase 3
timing-source swap can be diffed per boundary rather than in aggregate. A
baseline that cannot be re-run cannot prove anything: the committed CSVs would
still be readable, but nothing could be compared against them.

**What was restored, and from what.** Both missing inputs were regenerated from
sources committed to this repository. New script:
`scripts/phase4-restore-replay-inputs.py` (regenerate + self-verify; `--verify`
checks without regenerating).

| Input | Regenerated from | Tool |
|---|---|---|
| `transcript_tokens.json` (3989 / 1836 / 363 tokens) | `docs/{V6,173,Spanish}-Smear-Phase2a.csv` — the Phase 2a transcript-inspector exports, committed | the committed `scripts/extract-full-transcript.py` |
| `silences_app.json` (547 / 239 / 27 intervals) | the corpus `.m4a` → 16 kHz mono transcode via the bundled ffmpeg sidecar | the committed `scripts/phase4-handoff-app-silence.py` |

**Why a fresh whisper-cli run was deliberately NOT the restoration path, stated
because it looks like the obvious choice and is the wrong one.** The lost
`/tmp/phase3/*_raw_transcript*.json` files were, despite the name, the
**post-`filterMalformedTokens`** arrays extracted from the inspector CSV
exports — 3989/1836/363 tokens, not the pre-filter 4556/2082/399 whisper-cli
emits. Re-transcribing would have produced a *different array* from the one Step
M actually consumed, then re-filtered it live, and any edge-case disagreement
would have been indistinguishable from a real pipeline change. Reconstructing
from the committed CSV via the committed extractor reproduces the exact input.
It is also ~23 minutes cheaper, but that is not the reason.

**Where they now live: `.work-phase4/replay/<project>/` — gitignored, inside the
repo, durable.** Same pattern Step Q established for `.listening-clips/` and
`.answer-keys/`. The harness resolves this path relative to its own file
location, not to `cwd`.

**Proof the restoration is faithful, not merely present.** This was checked
three ways, in increasing strength:

1. **Input-level, value for value.** `phase4-restore-replay-inputs.py` diffs
   every regenerated token against `docs/phase4-baseline-<key>-words.csv` and
   every regenerated silence interval against
   `docs/phase4-baseline-<key>-silences.csv` — the committed Step M outputs —
   at 1e-9 tolerance. **0 differences across all 3 projects** (3989+1836+363
   tokens, 547+239+27 intervals). A mismatch is a hard failure *before* the
   replay harness runs, so a silently-wrong restoration cannot be mistaken
   downstream for a real pipeline change.
2. **Output-level, per boundary.** The harness was upgraded from "not a
   correctness test" (its original words — it wrote a summary and asserted
   almost nothing) to a **golden diff**. Every replayed segment's `order`,
   `tag`, `text`, `anchorSource`, `startTime`, `duration` and `endTime` is
   compared against `docs/phase4-baseline-<key>-segments.csv`; the skip set is
   compared against `-skipped.csv` by index, tag and match counts; the R13
   coverage gate must still not abort; Key Invariant (b) must still hold
   exactly. **All three projects reproduce the committed Step M values with zero
   divergence** — 444/172/26 segments, every boundary identical to 1e-9.
3. **Negative control, so "green" is not vacuous.** A deliberate +0.01s
   perturbation was injected into one segment's `startTime` and the suite
   re-run: all three project tests failed, each naming the boundary by index and
   tag (`seg 3 (004_grandmother_asleep) startTime: replay=14.35 baseline=14.34
   (Δ0.010000s)`). The perturbation was then removed. The diff is live, and it
   reports *which* boundary moved rather than a bare count — which is the whole
   point for a per-boundary swap comparison.

**Nothing was re-baselined.** No value in `docs/phase4-baseline-*.csv` was
touched. Had any differed, the instruction was to stop and report rather than
re-baseline; none did, so the question did not arise.

**Suite result: `npx vitest run` → 52 files, 1289 tests, 0 failures.** Up from
1284 passed / 3 failed. The +5 is the 3 now-passing replay tests plus 2 new
assertions from the K8 tripwire below. `npx tsc --noEmit` is clean.
`python3 scripts/phase4-step-x-verify.py` still runs and still exits 1 on C10 by
design, unchanged.

**What stops K8 recurring a fifth time: `scripts/no-tmp-artifacts.test.ts`.**
Not a note in a document — a test that runs on every `npx vitest run` and fails
at the moment someone writes a new `/tmp` artifact dependency, rather than weeks
later when the file is gone and the context with it. Two rules of deliberately
different strength:

  * **RULE 1 — hard zero, no allowlist.** No `*.test.ts` under `scripts/` or
    `src/` may reference `/tmp` in code. These are exactly the files that run on
    every suite invocation, which is exactly the failure mode that just cost
    three tests. Comments may still discuss `/tmp` (this file and the replay
    harness both do); the scan strips them.
  * **RULE 2 — a frozen per-file ceiling.** Each legacy `scripts/*.py`
    measurement tool's `/tmp` occurrence count is pinned in a committed table
    with a one-line reason. Adding one, or introducing `/tmp` in a new `.py`,
    fails. Removing one never fails — the numbers are ceilings, not equalities.
    The legacy scripts were **not** rewritten: they are point-in-time tools
    whose `/tmp` paths are part of the record of how an already-reported
    measurement was invoked, and rewriting them would buy nothing while
    rewriting history. That is a judgement, and it is stated rather than hidden.

Both rules assert their own scan is non-empty, so the guard cannot pass by
silently finding no files. The failure message names the durable locations and
points at `phase4-restore-replay-inputs.py` as the worked example, so the fix is
mechanical rather than archaeological.

**Honest limit of the tripwire.** It catches `/tmp` specifically. It would not
catch a harness depending on some *other* purgeable or machine-local location —
`~/Downloads/All Projects Test Data` being the obvious live example, which every
corpus-reading harness including this one depends on and which is not in the
repo. That dependency is real, known, and unaddressed here; it is a corpus
provisioning problem (Part D.0), not an artifact-storage one, and conflating
them would be the wrong fix.

---

#### Step Z — pre-implementation readiness statement

*Written for someone who was not present for Phases 0-4. Everything below is
either measured and cited, or explicitly flagged as unmeasured.*

##### What is being replaced, and what is not

**Replaced: one thing only — the per-token timestamp VALUES in Stage 1.** Today
those come from whisper.cpp's own `-ml 1` output. They will come from a forced
aligner (CTC), run as a second pass over the same audio.

**Not replaced, and this list is the reason the change is reversible:** the
Whisper transcript itself (the *words* stay Whisper's); the Hirschberg text
alignment; the run-survival gates; `filterToCoveredSegments`; the boundary
picker; `snapCoveredBoundaries`; `headExtendFirstSegment`; every downstream
stage; the persisted schema. The token contract `{text, start, end}` is
unchanged (Blocker 3). Architecture (A): FA supplies timing only.

**Why, in one paragraph.** Whisper's `-ml 1` output is **gapless** — each token
starts exactly where the previous ended (97.8% of V6 transitions, 93.4% of
173's) — so a pause is *structurally* absorbed into the following word's
declared span. A word's declared start sits a median of **+0.038s from the
pause's START**, versus −0.500s from its end, where the word is actually spoken.
This is not a tuning problem and no boundary rule can repair it: it is the wrong
*kind* of timing source. DTW was measured and changes timestamps by **exactly
0.000000000s** (against a purpose-built no-DTW control, over all 4,579 V6 and
2,080 173 tokens, with DTW verifiably enabled) — it is eliminated, not deferred.

##### The model

`jonatasgrosman/wav2vec2-large-xlsr-53-<lang>`, Apache-2.0, ~1.18-1.26 GB per
language, five languages (en, es, fr, pt, de), **downloaded on demand, never
bundled** (owner decision 3). MMS-FA is permanently out on licence (CC-BY-NC-4.0)
despite being the model most numbers in this document were measured on; where
the two differ, jonatasgrosman's column is the one that counts, and the two were
measured within noise of each other on both projects where both were run.

##### Evidence, per language — stated at the strength it actually holds

| Language | Human listening evidence | Corpus | Status |
|---|---|---|---|
| **English** | **Two batches, 32 clips total.** Batch 1: 12 clips (Step C), 11 scored. Batch 2: 20 clips (Steps H-J), 17 scored, genuinely blind — none reusing batch 1's segments, and the reference under test had never seen them. | V6 (447 segs, 23.7 min) + 173 (175 segs, 11.8 min) | **VALIDATED.** FA closer to human than `silencedetect` on all 7 batch-1 scored failures, by 6x-78x. On batch 2, excluding two now-explained heading-contaminated residuals, FA's worst error against human truth is **131.6ms**. |
| **Spanish** | **One batch, 10 clips** (Steps Q/U), all 10 scored. | Spanish project (26 segs, 92s) | **VALIDATED, on a small sample.** FA within 16-43ms on six of seven "failures"; one genuine −1084ms error, named below. |
| **French, Portuguese, German** | **None. Zero clips, zero corpus material, zero measurements.** | — | **UNVALIDATED. Plumbing only.** |

**The fr/de/pt position, stated bluntly because it is the largest silent risk in
this programme.** These three ship with loading plumbing and no accuracy
evidence of any kind — not a weak measurement, *no* measurement. Owner decision
6 accepted this deliberately, deferring real-corpus validation until business
demand. Step T requires them labelled UNVALIDATED on three separate user-facing
surfaces (dropdown label, one-time dialog, and a new informational
`unvalidated-language` sync-log entry, deliberately distinct from the
error-severity `unsupported-language` guard). **If those three surfaces are not
built, this decision becomes an undisclosed risk rather than an accepted one.**
That is the single most important implementation obligation on this page.

##### The gate, and Spanish's corrected number

**Approved standard (owner decision 1): p95 word-onset error ≤ 250ms.** The
median ≤100ms threshold is kept but demoted (it passes projects with known real
defects). The negative-smear <1% threshold is **retained on paper but is known
to be unpassable by any accurate source** — Step D proved analytically that a
source with symmetric noise around zero reads ~50% by that sign-only definition
regardless of quality; it was built to catch Whisper's whole-pause-absorption
pathology and cannot discriminate anything else. Zero-duration real-word tokens
must be 0; FA passes this cleanly where Whisper turbo produces 68 on V6 and 44
on 173.

| Project | p95 against raw `silencedetect` | p95 against the corrected reference | vs. 250ms gate |
|---|---|---|---|
| V6 (English) | 338.2ms | **82.2ms** | PASS — 2 boundaries remain >250ms, both explained as the heading-recitation class (segments 42, 224) |
| 173 (English) | 89.7ms | — (already passing) | PASS |
| **Spanish** | **282.1ms (FAIL)** | **50.4ms** | **PASS** |

**Spanish's corrected number carries a caveat that must travel with it.** At
n=22 scored pauses the p95 rank sits below the maximum, so the single remaining
>250ms row is excluded by rank from the figure. That row is real: **clip3_06,
−1084ms**, a genuine FA error at corpus start. Its cause is structural and was
named before the labels arrived — the pipeline skipped the preceding one-word
segment ("Scylla."), so the next segment's window begins at t=0 and contains an
unscripted lead-in that is *the same word* the segment itself starts with; FA
matched the wrong one. R.6's leading wildcard and file-start clamp exist for
exactly this shape. "p95 50.4ms" is not a claim that every Spanish boundary is
inside 250ms. One is not, and it is that one.

**What the gate rests on, said plainly:** a large share of the original
"failures" on both languages were the *reference* being wrong, not FA. Raw
`silencedetect`'s declared pause-end lands within 3ms of **breath onset** on 4
of 5 scorable breath clips — it measures the breath, not the word. This was
confirmed by human ear, not inferred.

##### Checks going into CI, and the ones deliberately excluded

Twelve inventory items, thirteen assertions (item 1 is two structurally
different assertions, run as C01a/C01b). All thirteen are built and proven in a
standalone harness outside the app: `python3 scripts/phase4-step-x-verify.py`,
one command, no arguments, ~4s. It runs each rule twice — once on deliberate
poison where it must fire, once on real corpus data where it must stay quiet —
and prints its own evidence ranking.

**IN (12):** C01a, C01b, C02, C03, C04, C05, C06, C07, C08, C09, C11, C12.

Two carry qualifications rather than plain membership. **C05** goes into the
*measurement harness's* CI, not the app's — Step O's own verdict is that it
describes a bug in the measurement tool, not the production pipeline; it is a
regression lock so a future re-measurement cannot silently drop the Step 1
scorer fix. **C11** is inverted: its "real" half cannot be "stay quiet", because
K13 (lock preservation broken across resync) is an *open* defect and there is no
clean corpus. It instead re-runs a live reproduction against production code and
requires the defect to still reproduce. **It MUST START FAILING when Stage 3
fixes K13** — that is the signal the fix landed, not a broken test, and the file
says so at the top.

**OUT (1): C10 (seam cross-attribution), excluded by name.** Scored against the
owner's own listening verdicts: **0 fires on the 4 boundaries the owner called
word-shifted**, 0 fires on the 37 he called correct, and its single V6 finding
has no ear verdict either way and cannot be adjudicated. Recall was 0-of-3
against a smaller set at Step S and 0-of-4 against a larger one at Step W — more
evidence did not change the answer. Requiring seam words to be phonetically
distinctive dropped its false positives 29 → 1; **quieter is not fixed**. A rule
that finds none of the defects it exists for detects nothing. `phase4-step-x-
verify.py` gives C10 a third half that it fails, and exits 1 as a result,
specifically so the headline "13/13" cannot be read as an all-clear.

##### The two known-weak items, stated as weak

**C04 (breath-vs-boundary misclassification) — grade C, and it deserves the most
suspicion of the entire set.** Breath misplacement is *the dominant real-world
failure this programme has spent months chasing*. C04 reads **zero** findings
across all three real corpora. Two readings fit that equally well: the shipped
index-based seam-exemption fix (2026-08-03, ear-verified 86.8% → 96.2% correct
cuts on V6) genuinely repaired the corpus — or C04 cannot see the defect it was
written for. **Nothing in this programme distinguishes those two.** It ships in
CI because a quiet check costs nothing and a live instance would be valuable;
its silence must not be read as evidence the class is closed.

**C10 — grade D, failed validation, excluded.** Covered above. It is named here
a second time because a future reader scanning only the CI list should not
discover the exclusion by its absence.

More generally, six of the thirteen (C01a, C01b, C04, C07, C08, C09) are grade
C: **clean on real data, but no live instance has ever tripped them, so their
sensitivity is unproven.** Quiet proves the corpus is clean; it does not prove
the rule would catch a dirty one. C01b and C09 are demonstrable only against the
stale pre-Phase-2a fixture, because the model swap already repaired their one
real instance.

##### The heading rule

**Option A, approved (decision 8, verbatim at the head of this section): the
preceding segment absorbs the full duration of unscripted audio, logged as an
explicit `unscripted-gap` entry. Total length unchanged, segment count
unchanged.** Nine V6 gaps, 37.50s, mean +2.14s onto the preceding segment.
Blocks Phase 5, not Phase 3. The one V6-specific caveat worth carrying: a
transcript sweep found this "Level N" chapter convention in V6 only — a bounded
keyword sweep of the 173 and Spanish transcripts found nothing comparable — so
the rule is being adopted on evidence from one narrator's convention.

##### Rollback

**Tag: `phase4-implementation-ready-2026-08-07`** (this commit). Rollback is
genuinely cheap, for structural reasons rather than optimistic ones:

  * FA is a **strictly additive second pass**. Rolling back is "skip the FA
    pass" — Whisper's own timestamps are still produced and still valid.
  * **No schema change.** The token contract is `{text, start, end}` before and
    after; nothing persisted changes shape, so no migration exists to reverse
    and no project saved under the new build is unreadable by the old one.
  * Old and new can run **side by side**, which is not a hope — it is what every
    Phase 2b/3 measurement already did. In production the same capability-gate
    pattern this codebase already ships (`useExport.ts`'s
    `isWebCodecsExportGateOpen()` — capability probe AND persisted user toggle,
    both required, decided fresh every run) applies directly.
  * `git revert` to the tag restores a suite that is green at **1289 tests**,
    and `python3 scripts/phase4-restore-replay-inputs.py` +
    `npx vitest run scripts/phase4-handoff-replay-sync.test.ts` re-proves the
    Step M baseline from committed sources on any machine with the corpus.

**The one thing rollback does not undo:** downloaded model weights and any
`manifest.json` written by the download-on-demand path (Step T). Those are
cache, not state, but a rollback should delete them rather than leave a newer
manifest for older code to read.

##### What could still go wrong after the swap, and what would show it early

Ordered by expected cost, not by likelihood. **Overstating these costs less than
understating them.**

1. **fr/de/pt are wrong in a way nobody measures for months.** Highest expected
   cost on this page: three languages ship with zero accuracy evidence. *Early
   signal:* the `unvalidated-language` log entry firing in a real user's project
   — which only works if Step T's three surfaces are actually built. If they are
   skipped, there is no early signal at all, and that is the failure this list
   most wants to prevent.
2. **Latency regression drives users off the feature.** Adding FA costs **+41.9%
   on V6, +24.9% on 173, +18.3% on Spanish** — project-size-dependent, not the
   universal "+42%" this document informally cited for a while. Peak RSS rises
   from ~2.1-2.2 GiB to **~3.2-4.0 GiB** (not additive if the two models run
   sequentially with memory released between them — *if*). *Early signal:*
   wall-clock and peak-RSS per sync run, logged from the first build; two FA
   models resident simultaneously is a real risk Step T specifies against, not a
   theoretical one.
3. **The corrected reference is right on 42 human-labelled clips and wrong in
   general.** Every gate number that passes does so against a *corrected*
   reference, and Step J found the Step F breath-aware corrector is **not an
   unqualified improvement**: on 8 of 17 blind rows its error exceeded raw
   `silencedetect`'s, occasionally firing past the true onset into ordinary
   trailing-consonant energy on a clean control. It is a clear net win on breath
   clips and a qualified one elsewhere. *Early signal:* boundaries that pass
   every numeric gate but get reported by ear — precisely the shape of the
   segment-321 defect below.
4. **A defect invisible to every numeric gate.** This has already happened once
   and will happen again. V6 segment 321's onset error was **227ms — under the
   gate** — in both the original and corrected datasets, while the cut was
   ~4s wrong, because an upstream segment (320) aligned to zero tokens and
   deprived it of a valid neighbour boundary. Only the human listener caught it.
   *Early signal:* C01a/C01b/C09 (the only checks that catch segment 320), plus
   R.5's run structure removing the propagation path. Neither is proven against
   a live instance — see the grade-C caveat above.
5. **Within-run cascade.** Step R's cascade-safety claim is stated at the
   strength it holds and no further: **full independence is proven for cross-run
   neighbours and skipped segments; within a run it is reduced from today's
   verbatim-error-copying to a bounded monotonic-ordering constraint — not
   zero.** *Early signal:* two or more adjacent boundaries in one run moving
   together in the same direction.
6. **Things the swap cannot fix, and will be blamed for.** Three named classes
   survive it: the flash-attention content dropout (V6 segments 27-29 — no
   timing source recovers text the model never emitted); `seasons than you ||
   can count and` (the narrator's pause genuinely disagrees with the script's
   sentence break — a script-vs-narration authority conflict); and K13 lock
   preservation (a Stage 3 concern, unrelated to timing). *Early signal:* a
   post-swap regression report matching one of these three — check them before
   suspecting FA.
7. **The corpus is one narrator per language.** V6 and 173 are English from a
   corpus assembled by one person; Spanish is 92 seconds. Breath loudness
   relative to the −45dB floor — the mechanism behind most of the reference
   bias — is a property of a voice and a microphone, not of a language. *Early
   signal:* a new project whose boundaries fail in a pattern none of the three
   corpus projects showed.

##### Does anything in Steps U-Z change the eight owner decisions?

**No.**

Checked one by one, and stated as a negative claim rather than an omission:
decision 1 (250ms gate) — Step U's Spanish result **satisfies** it on a
corrected reference rather than challenging it, and the corrected reference was
built and its thresholds fixed *before* the Spanish labels arrived. Decision 2
(10 Spanish clips, not 20) — executed exactly; the resulting n=22 rank caveat is
disclosed, not litigated. Decision 3 (jonatasgrosman, all 5 languages, no
non-commercial model ever) — untouched; nothing measured since gives any reason
to revisit MMS-FA. Decision 4 (production-grade windowing) — Step U's clip3_06
is additional *support*, being precisely the corpus-start case R.6 already
specifies. Decision 5 (all checks proven in an isolated harness before any Rust)
— Steps W/X/Y are that decision being carried out, including the parts that
failed. Decision 6 (fr/de/pt plumbing, labelled UNVALIDATED) — unchanged and
re-emphasised above as the largest silent risk. Decision 7 (no production Rust
in that pass) — honored again here. Decision 8 (Option A) — recorded verbatim
above and is itself the newest decision, not a modification of an older one.

**Two factual corrections were made across U-Z, neither decisional.** Step S's
claimed "13/13 poison PASS" was false when written — the committed harness
printed 12/13 FAIL, corrected at Step W and now genuinely 13/13. And segment
320's "4.5x duration undercount" is a stale pre-Phase-2a artifact: Step M's own
golden baseline shows it committed at 974.26-980.17s, a correct fit. The defect
is **latent, not live**, and this document should stop describing it in the
present tense.

---

#### Steps Y-Z deliverable summary

Option A recorded verbatim and Step V closed, making all three Rust gates
closed (Step V/decision 8). The Step M golden-baseline replay harness restored
from committed sources, repointed off `/tmp` to `.work-phase4/replay/`, upgraded
from a summary-writer to a per-boundary golden diff, and **proven faithful three
ways** — inputs value-for-value identical to the committed baseline, outputs
reproducing all 444/172/26 segments to 1e-9 with zero divergence, and a
negative-control perturbation confirming the diff actually fires and names the
boundary (Step Y). K8 given a tripwire that fails on every `npx vitest run`
rather than a fourth note in a document, with its own scope limit disclosed
(Step Y). A one-page readiness statement covering what changes and what does
not, per-language evidence at its real strength, the CI in/out list with C04 and
C10 stated weak, the approved gate and Spanish's corrected 50.4ms with its rank
caveat, the Option A rule, the rollback path, and seven ways this can still go
wrong with the signal that would reveal each (Step Z).

**Suite: `npx vitest run` → 52 files, 1289 tests, 0 failures.** `npx tsc
--noEmit` clean. `phase4-step-x-verify.py` unchanged (still exits 1 on C10, by
design). **No `src/` file changed. No production Rust written. No threshold
retuned. No baseline re-fitted.** New: `scripts/phase4-restore-replay-inputs.py`,
`scripts/no-tmp-artifacts.test.ts`. Amended:
`scripts/phase4-handoff-replay-sync.test.ts` (repointed + assertions added),
`scripts/phase4-handoff-app-silence.py` (usage example moved off `/tmp`).

---

### Phase 4 addendum — Manual lock semantics (Steps AA-AD, 2026-08-07)

**Owner verification of Step X, recorded verbatim as instructed.** The owner ran
`python3 scripts/phase4-step-x-verify.py` independently and confirmed: **13 of 13
poison halves FIRED, 13 of 13 real halves stayed QUIET.** C10's third half — the
recall check against the owner's own word-shift verdicts — **failed as designed**
(0 of 4). This matches Step X's own printed output exactly and is now recorded
here as owner-verified, not merely tool-reported. No numbers changed by this
verification; it is a second, independent confirmation of Step X's result.

**Scope discipline for this addendum, same terms as Steps Y-Z: design only, no
Rust, no `src/` file changed.** One new committed test file demonstrates the
Step AA defect against production code (the same convention Step W used for
K13) — it is a repro, not an implementation.

**New owner requirement — decision 9, recorded verbatim as instructed:**

> 1. Dragging or adjusting any segment boundary must NEVER auto-lock any
>    segment, neither the dragged one nor its neighbour.
> 2. Segments lock only when the user explicitly toggles them.
> 3. Manually locked segments are immovable anchors across pipeline re-sync:
>    their start and end are preserved exactly while unlocked segments adjust
>    around them.

This is a separate workstream from the timing-source swap and lands as its own
commit, not bundled with it.

---

#### Step AA — Diagnosing the existing defect

**The owner's report — "unlocking a neighbour currently ruins the timing of
adjacent segments" — is a real, distinct, second defect. It is not K13.** K13
(`docs/ws1-sync-pipeline/sync-pipeline-v2-plan.md` Part K) is Apply-Sync clean-slate rebuild
dropping the `locked` field entirely, every resync, unconditionally. This new
defect needs no resync at all — it fires **inside the editor**, on the lock
toggle, with no Apply Sync in between. Naming it **K14** so it has its own
identity in the register rather than being folded into K13's writeup, which
would misstate both.

**File and function: `src/App.tsx`, `handleToggleLock` (line 1692), calling
`applyAnchorBasedTiming` (`src/services/syncEngine.ts`, line 174).**

**The mechanism, traced end to end:**

1. **Auto-lock-on-drag happens in `computeDragCascade`** (`App.tsx:1106`). A
   segment-boundary drag sets `locked: true` on the dragged segment AND on every
   neighbour the cascade absorbed overflow into (`App.tsx:1115`, `:1129`,
   `:1133`) — this is the behaviour decision 9 point 1 now explicitly forbids.
   The cascade's own docstring already says so plainly: "Affected segments
   (dragged + all that absorbed any portion) are auto-locked" (`App.tsx:1102`).

2. **The cascade writes `startTime`/`duration` but never touches
   `anchorStart`.** `computeDragCascade` ends by calling the module-private
   `recomputeStartTimes` (`App.tsx:1072`), which derives every segment's
   `startTime` purely from the running sum of `duration` — a flexbox-style
   left-to-right accumulation. `anchorStart` is never read or written anywhere
   in the drag path. So after any drag, the segments the user sees are correct
   and contiguous, but their `anchorStart` fields — the pipeline's own record of
   "where the aligner actually placed this segment" — are now **stale**,
   silently disagreeing with `startTime` by exactly the cascaded delta.

3. **Unlocking mutates one flag and then re-derives the whole array from that
   stale record.** `handleToggleLock` flips `locked` on the target segment and
   immediately calls `applyAnchorBasedTiming(toggled, audioDuration)` — **over
   the entire `project.segments` array**, not just the toggled segment.
   `applyAnchorBasedTiming`'s PASS 2 (`syncEngine.ts:225-241`) sets
   `seg.startTime = anchorStart` unconditionally for every unlocked segment. The
   segment that was just unlocked snaps back onto its stale anchor — that part
   is at least explicable, if wrong. **The damage that is not explicable:**
   every OTHER unlocked segment in the array is re-derived the same way in the
   same pass, off anchors that a completely unrelated, earlier drag left stale.
   Nothing scopes the re-derivation to the one segment the user actually
   touched.

4. **Why the damage reaches segments that are themselves still locked.** PASS 2's
   locked branch (`syncEngine.ts:232-236`) is not the immovable-anchor guarantee
   decision 9 point 3 asks for — it only refuses to let `duration` *shrink*:
   `seg.startTime = anchorStart` runs unconditionally for locked segments too
   (`syncEngine.ts:233`), and `duration = max(preservedDuration, availableSpan)`
   (`:236`) only floors the duration, it does not pin the start. A locked
   segment therefore still SLIDES onto its own stale anchor whenever
   `applyAnchorBasedTiming` runs for any reason — including a lock toggle on a
   segment three positions away that this one never interacted with. `handleUp`
   commits a drag through the same `applyDurationChange` → `setProject` path
   (`App.tsx:1571`), so the identical stale-anchor snap-back can also fire off a
   completely ordinary resize-drag elsewhere in the timeline, not only off a
   lock toggle — the toggle is simply the shortest path to it and the one the
   owner named.

**Live repro against production code:** `scripts/phase4-step-aa-unlock-repro.test.ts`
(new, committed). Three parts, run with `npx vitest run
scripts/phase4-step-aa-unlock-repro.test.ts`:

  * **Part 1** reproduces steps 1-2 above: a drag leaves `startTime=23` next to
    a stale `anchorStart=20` on the very segment the cascade just repositioned,
    and confirms both cascade participants were auto-locked without being
    asked for.
  * **Part 2** reproduces steps 3-4: two independent drags, far apart on a
    6-segment, 60s timeline. Unlocking ONE segment from the first drag moves
    it back 3s onto its stale anchor (expected, if wrong) **and also moves a
    different, still-locked segment from the second, unrelated drag back 4s**
    (`expect(after[5]!.locked).toBe(true); expect(after[5]!.startTime -
    cur[5]!.startTime).toBeCloseTo(-4, ...)`) — leaving the timeline
    self-overlapping (segment 4 ends at 54, segment 5 now starts at 50). This
    is the owner's report, demonstrated: a segment neither dragged nor
    unlocked in this action moves anyway, and being locked did not save it.
  * **Part 3** shows a second consequence of the same stale-anchor mechanism:
    the backward monotonic clamp (`syncEngine.ts:215-223`) can destructively
    overwrite `anchorStart` itself when two stale anchors end up out of order,
    permanently losing the pipeline's own placement record for that segment,
    not merely mis-deriving its displayed position.

All three assertions pass today; they are written to assert the defect and
**must start failing** once Step AB's semantics are implemented — same
convention as the K13 repro, and stated at the top of the new file so it is not
"repaired" by mistake.

**Root cause, one sentence:** `anchorStart` is the sole timing authority
`applyAnchorBasedTiming` re-derives every `startTime` from, the drag path never
keeps it in sync with the `startTime`/`duration` it actually commits, and
nothing scopes a lock-toggle's re-derivation to the segment that was toggled —
so any stale anchor left behind by an earlier, unrelated drag can surface on
any later lock toggle anywhere in the timeline, moving segments — including
locked ones — that the current action never referenced.

---

#### Step AB — Lock semantics design (design only, not implemented)

**What a lock stores, and where it persists.** No new field is needed beyond
`VideoSegment.locked?: boolean` (`types.ts:199`) — the type already exists. What
changes is what MUST be true whenever `locked === true`: **`startTime` and
`duration` are the pinned values, and `anchorStart` is kept equal to `startTime`
at all times a lock is true** (a lock is defined in start/duration/timeline
terms — an editor-facing concept — not in anchor terms — the pipeline's own
placement-provenance concept; conflating the two is Step AA's root cause). This
persists exactly where `locked` already persists today: inline on the
`VideoSegment`, through `projectStore.ts`'s existing serialization (no schema
change — the field already round-trips). What is NEW is a discipline invariant,
enforced at every site that WRITES `startTime`/`duration`/`anchorStart`, not a
new stored shape:

  * **INVARIANT L1** — no write path may ever set `locked: true` as a side
    effect of any other action (drag, cascade, resync, lock-all). It is set
    ONLY by the explicit toggle handler and the explicit "Lock All" action —
    both already user-initiated UI affordances (`App.tsx:1692`, `:3696`); no
    new UI is needed, only the removal of the auto-lock writes named in Step
    AA.
  * **INVARIANT L2** — whenever a segment is locked, every OTHER write path
    (drag cascade, `applyAnchorBasedTiming`, resync's carry-forward) must treat
    its `startTime` and `duration` as read-only and its `anchorStart` as
    equal to `startTime` — not independently derived, not independently
    stale-able. This closes Step AA's mechanism at the root: there is no
    longer a "stale anchor vs. live position" pair to disagree, because a
    locked segment's anchor IS its position, always, by construction.

**What happens when re-sync wants to move a locked boundary but cannot.** It
does not move it, full stop — decision 9 point 3 is unconditional ("their start
and end are preserved exactly"), which is a small change from today's
Phase-3-era spec (`applyAnchorBasedTiming`'s own docstring: "duration is
preserved UNLESS removal opened a gap immediately after… in which case duration
grows to absorb it" — the one-directional lock exemption). **That exemption is
withdrawn by decision 9.** A locked segment's span is now a hard wall in BOTH
directions: it neither shrinks NOR grows to absorb a neighbour's removal.
Whatever content Apply Sync would have placed inside that exact span is
either (a) placed there anyway if it fits the same window R.0/R.2 would already
compute for an anchor with three-source agreement (a locked boundary trivially
qualifies — the user's own placement is stronger evidence than any acoustic
signal), or (b) if the new content genuinely cannot occupy the locked span (the
matched text is longer or shorter than the fixed window allows), the excess/
deficit is absorbed by the UNLOCKED neighbour(s) per the next answer below —
never by silently resizing the lock.

**What happens to an unlocked segment trapped between two locks whose fixed
span is too short or too long for its content.** This is the shape Step AC
below calls out explicitly for windowing, so the placement mechanism and this
answer must agree: the trapped segment's window is bounded by the two locks —
it can never see audio outside `[lockA.end, lockB.start]`, by construction,
because a lock is now a hard wall (see Step AC). Within that bounded window:

  * **Too short** (the trapped segment's real speech doesn't fit): the segment
    is placed at its best-fit alignment inside the available span and an
    explicit `lock-span-overflow` sync-log entry (informational→warning
    severity, matching the existing `unscripted-gap`/`monotonic-clamp`
    precedent) names the segment, the shortfall in seconds, and both bounding
    locks. **The content is never allowed to overflow past a lock** — that
    would silently move the lock, which decision 9 point 3 forbids outright.
    This mirrors R.7's existing skip-and-flag contract (never a crash, never a
    silent boundary violation) rather than inventing a new failure mode.
  * **Too long** (extra silence/slack in the fixed span): the trapped segment's
    own placement uses only what its aligned content needs; the remaining slack
    is absorbed the same way `headExtendFirstSegment`/the tail-extension
    already absorb lead-in/trail-out — attributed to whichever adjacent
    segment (the trapped one, by default, matching Option A's "the segment
    already on screen absorbs it" precedent) rather than left as an unaccounted
    gap. No new mechanism; the existing unscripted-audio precedent (owner
    decision 8) already covers this shape and is reused rather than
    re-litigated.
  * If the trapped span is bounded by a lock on ONLY one side (its other
    neighbour is unlocked), the unlocked side behaves exactly as it does today
    — only the locked side is a hard wall.

**Whether a lock pins start, end, or both independently.** **Both, and always
together — not independently settable.** A lock pins the segment's
`[startTime, startTime+duration]` interval as a single unit. Independent
start-only or end-only pinning was considered and rejected here: decision 9
point 3 says "their start and end are preserved exactly," not "either edge";
and independent-edge pinning reopens exactly Step AA's failure shape one edge
at a time (an unpinned edge is still derived from something else's stale
state). If a future need for one-sided pinning appears, it is a distinct
feature (a different field, e.g. `lockedEdge?: 'start' | 'end' | 'both'`), not
an extension of this boolean — flagged here so it is not silently smuggled in
as a "small" variant of `locked` later.

**What the user sees when a lock and the pipeline disagree.** Never silence —
that is the discipline this whole document has enforced everywhere else
(`unscripted-gap`, `monotonic-clamp`, `lock-preserved-adjustment`,
`estimated-timeline`), and Step AA's root cause is itself a case of a
disagreement (stale anchor vs. live position) that was allowed to resolve
silently. Three concrete surfaces, all additive to `SyncLogEntry`
(`types.ts`), all following the existing severity convention:

  * **`lock-span-overflow`** (warning) — a locked span could not hold its
    trapped or own content; per the "too short" case above.
  * **`lock-preserved-adjustment`** (info) — already specified at Contract 3→4
    P4 (`docs/ws1-sync-pipeline/sync-pipeline-v2-plan.md` line ~3266) as a REQUIRED ADDITION;
    this addendum confirms it is still the right surface under decision 9 and
    widens its trigger from "a lock forced a neighbour to grow/shrink" (the
    old one-directional exemption) to "a lock's hard-wall bounded a
    neighbour's placement in either direction" (the new one).
  * **A per-segment "locked" affordance already visible in the UI**
    (`BottomDrawer.tsx:128-130`, `DropZonePanel.tsx:1535-1541`) continues to be
    the passive, always-on signal that a given segment's position is
    authoritative — no new UI chrome is required, only correcting what
    `locked: true` actually guarantees once L1/L2 above are enforced.

**Silent failure is what produced the current bug — every one of the above is
answered because leaving any of them implicit is exactly how K14 happened.**

---

#### Step AC — Interaction with Step R windowing

**Step R's neighbour-midpoint clamp (R.2/R.3) and a lock are different
mechanisms, and R.2's own padding formula already tells you which one wins: a
lock is not a midpoint, it is a hard wall, and it must be substituted as such
rather than fed through the padding math as if it were an ordinary neighbour
boundary.**

**How FA windows are chosen next to a locked boundary.** R.1's anchor
admissibility test (three-source agreement, `ANCHOR_AGREEMENT_SEC`) is
unnecessary for a locked boundary — the user's own placement is a *stronger*
claim than three-source acoustic agreement, so **a locked segment's boundary is
always an anchor, unconditionally, regardless of what R.1(a)-(c) would say
about it.** This is a genuine, explicit AMENDMENT to R.1, stated here rather
than left implicit: R.1 as written only admits anchors derived from Hirschberg
+ token onset + silence agreement; it has no clause for a boundary the user
fixed by hand. Add one: **R.1(d) — a `locked` segment's `startTime` and
`startTime+duration` are anchors by construction, with no agreement check.**

Given that, R.2's padding formula needs exactly one substitution, not a
rewrite: wherever `prevRunLastWordEnd` or `nextRunFirstWordStart` would be
read from an adjacent run's own aligned output, and that adjacent boundary is
instead a LOCK, substitute the lock's own fixed edge directly and **set
`padBefore`/`padAfter` to 0 on that side**, not to `min(PAD_BASE, ...)` of
anything. A lock is not "the free audio up to the neighbour's last verified
word, shared 50/50" (R.2's `PAD_SHARE`) — it is a hard, user-declared boundary
with zero slack on the locked side. Padding past it would let a run's audio
window reach into a span the user has explicitly frozen, which is precisely
the word-theft shape this whole document exists to prevent, just committed by
the new mechanism instead of the old one.

**Whether a lock can starve a neighbour's window the way segment 320 starved
321.** **Structurally, no — and this is the reason locks are the SAFER
boundary type in this design, not merely a special case of an ordinary one.**
Segment 320 starved segment 321 because 320's own boundary was WRONG (a timing
defect) and 321's window was derived from it anyway, with no way to tell a bad
boundary from a good one. A lock cannot be "wrong" in that sense — it is a
declared fact, not a measurement, so there is nothing for R.7's fit-precheck to
disagree with. **The failure mode a lock CAN cause is different: it can make
the trapped segment's window too SHORT for its real content** — not because the
boundary is mistimed, but because the user genuinely fixed a span that doesn't
match the script's true duration for that stretch. This is exactly Step AB's
"too short" case above, and it routes through the SAME `lock-span-overflow`
finding R.7 already specifies for "target text cannot fit the window even at
full run length" (R.7, first bullet) — no new failure path, the existing one
already covers a fixed-too-small window; a lock is just one more way to
produce one.

**Whether locks can cascade.** **No, by the same argument as R.8 Case 1
(cross-run independence), extended.** Two locks bound every window between
them; R.2's padding under the R.1(d) amendment above never crosses a lock (zero
padding on the locked side, by construction). A segment between two locks can
therefore never influence alignment on the far side of either lock — the lock
is as strong an isolation boundary as R.1's three-source-agreement anchor, in
fact stronger, since it needs no agreement check to qualify. **No amendment to
R.8's cascade-safety argument is needed beyond restating that a lock is always
case-1-eligible (different-run boundary), never case-3 (same-run, bounded
monotonic coupling)** — a lock cannot sit inside a run's interior alignment the
way an ordinary word-level anchor can, because R.1(d) makes it a run boundary
by definition.

**Which part of the Step R design needs amending, stated exactly.** One
addition (R.1(d), above) and one clarification to R.2 (the zero-padding
substitution on a locked edge, above). **Nothing else in Step R (R.0, R.4-R.9)
changes.** R.5's wildcard-for-unscripted-audio mechanism composes with this
unchanged: a locked span simply has no wildcard applied to it from the outside
— it is not itself a run to align, it is a boundary between runs (or, per Step
AB, a fixed run of its own that supplies its own content verbatim without
needing FA to place it).

---

#### Step AD — Impact on C11 and the check suite

**C11 stays exactly as specified — CI-IN, grade A, a live K13 repro built on
lock fields — and decision 9 changes NOTHING about what it asserts, because
C11 tests K13, and K13 is untouched by this addendum.** This must be stated
precisely because the two defects are easy to conflate now that both are named
in the same document section: **K13 is Apply Sync's clean-slate rebuild
dropping `locked` entirely** (`App.tsx`'s `parseProjectData`/Stage-1 mint never
reads or writes it). **K14 (this addendum's defect) is the in-editor
propagation bug — it needs no resync.** Decision 9's carry-forward requirement
(point 3, "immovable anchors across pipeline re-sync") is in fact PRECISELY
what C11 already demands and today fails to find: the K13 repro
(`scripts/phase4-step-w-k13-repro.test.ts`) locks two overlapping segments,
runs `parseProjectData`, and asserts zero segments carry any lock field. That
assertion is completely orthogonal to K14's mechanism (`applyAnchorBasedTiming`
being called with a stale anchor grid, no `parseProjectData` involved) — fixing
K14 without fixing K13 leaves C11 exactly where it is today: TRIP, defect
confirmed. **C11 must keep failing until K13 specifically is fixed — decision 9
does not touch K13's fix, so C11's pass/fail state is unaffected by this
addendum landing.**

**What C11 should assert once the K13 fix DOES land, under decision 9's
semantics — stated now so nobody re-derives it later.** When Stage 3 builds the
carry-forward step K13 already specifies (Part K: "a carry-forward step — by
script-position/order, not id... from the pre-sync `project.segments` into the
freshly parsed array"), decision 9 point 3 adds ONE requirement to what that
carry-forward must do beyond restoring the `locked` flag and duration: **it
must restore `startTime` and `anchorStart` in lockstep, exactly, for every
locked segment** — not merely "the flag and position both survive" as Part K's
repro currently phrases it, but specifically that surviving position satisfies
the L1/L2 invariants from Step AB (locked segment's `anchorStart ===
startTime`, both frozen). The existing K13 repro's Part 2 assertion (`movedMs
>​ 1` — "the flag is load-bearing") remains valid and does not need rewriting;
what changes is that a THIRD part should be added when the fix lands: lock a
segment, drag an unrelated neighbour elsewhere in the timeline (the K14 shape),
confirm the locked segment's `startTime`/`anchorStart` are bit-for-bit
unchanged. That is a new assertion for the fix commit to add, not a retroactive
change to the currently-failing repro — adding it now, before K13 is fixed,
would just be another form of asserting the defect, which C11 already does.

**A new check is warranted for K14 specifically, and should be added at the
SAME commit that fixes it — not before, matching this document's own
convention that a repro-as-poison precedes its check** (Step W's own pattern
for C11: the repro existed before the check was trusted). **Recommended new
check, C13 — "lock isolation across unrelated edits":** run a drag+cascade on
segment A, then toggle the lock on unrelated segment B, and assert every
segment NOT dragged, absorbed, or toggled in this sequence is bit-for-bit
unchanged (`startTime`, `duration`, `anchorStart`, `locked`). This is
`scripts/phase4-step-aa-unlock-repro.test.ts`'s Part 2 promoted from a
demonstrated defect to a permanent regression lock, the same way C11 is Step
W's K13 repro promoted. **It does not exist yet — this addendum only asserts
the defect (Step AA) and specifies the fix (Step AB); C13 is scoped for the
implementation commit, per the instruction that this pass designs and does not
implement.**

**Are any of the other 12 checks affected? No, checked one by one against
decision 9's three points:** C01a/C01b (zero-token / implausible-duration) —
unaffected, both are Stage-1/2 checks with no lock dependency. C02
(dead-to-script run) — unaffected, headings are a separate overlay layer with
no lock field. C03/C06 (stale-pause, ASR dropout) — unaffected, timing-source
checks with no lock interaction. C04 (breath-vs-boundary) — unaffected,
acoustic classification only. C05 (scorer misattribution) — unaffected,
measurement-harness-only, no lock involvement by construction. C07
(run-survival consistency) — unaffected, reads `longestRun`, not `locked`.
C08/C09 (zero-duration token, CTC-fit) — unaffected, Stage-1/2 token-level
checks. **C10 (seam cross-attribution) — unaffected and stays OUT of CI**;
decision 9 changes nothing about its 0-of-4 recall against the owner's ear,
and it was excluded for a reason orthogonal to locking. C12 (negative-smear
gate discrimination) — unaffected, a Stage-1 gate-design argument with no lock
involvement. **Net: 11 of 12 IN checks unaffected, C11 unaffected in its
pass/fail state but its future-assertion scope is now specified above, and one
new check (C13) is recommended for the implementation commit.**

---

#### Addendum deliverable summary

Owner verification of Step X recorded verbatim (13/13 poison FIRED, 13/13 real
QUIET, C10's recall half FAILED as designed) — an independent confirmation,
not a new measurement. Decision 9 recorded verbatim. **Step AA** distinguished
a genuinely new defect (K14: in-editor lock-toggle propagation via a stale
`anchorStart` grid that drag operations never keep in sync) from the
previously-documented K13 (Apply-Sync clean-slate lock loss), traced it to
`computeDragCascade`'s auto-lock writes plus `handleToggleLock`'s whole-array
`applyAnchorBasedTiming` call, and demonstrated it live against production code
in a new committed repro (`scripts/phase4-step-aa-unlock-repro.test.ts`, 3
parts, all passing today, all required to start failing once fixed). **Step
AB** specified lock semantics answering all five required questions: storage
(existing `locked` field, no schema change, but a new discipline invariant
that a locked segment's `anchorStart` equals its `startTime` at all times);
re-sync behaviour when a lock blocks a move (never moves — the one-directional
growth exemption from the earlier Phase-3-era spec is withdrawn); the
too-short/too-long trapped-segment cases (best-fit-within-bounds with an
explicit finding, or slack absorbed by the adjacent segment per the existing
Option-A precedent); pinning granularity (both edges together, not
independently settable); and user-visible disagreement surfaces (two new
sync-log entry types plus the already-specified `lock-preserved-adjustment`,
widened). **Step AC** amended Step R's windowing design with one addition
(R.1(d) — a lock is always an anchor, no agreement check needed) and one
clarification (R.2's padding is zero on a locked edge, substituting the lock's
fixed boundary directly rather than treating it as an ordinary
three-source-agreement neighbour), and showed locks cannot starve a neighbour
the way segment 320 starved 321 (a lock cannot be "wrong," only sometimes
too-small for its trapped content, which routes through R.7's existing
fit-precheck finding) and cannot cascade (a locked boundary is always a
run-boundary case under R.8, never a same-run interior case). **Step AD**
confirmed C11 is untouched by decision 9 (it tests K13, not K14, and must keep
failing until K13 specifically is fixed), specified what C11's assertions
should grow to once the K13 fix lands under decision-9 semantics, recommended
a new check C13 scoped to the implementation commit rather than built now, and
confirmed the other 11 CI-IN/OUT checks are unaffected.

**No production Rust. No `src/` file changed. No threshold retuned. No baseline
re-fitted.** New: `scripts/phase4-step-aa-unlock-repro.test.ts` (live repro,
production code, 3 tests, all passing, all a designed-to-fail-later
regression lock). Amended: `docs/ws1-sync-pipeline/sync-pipeline-v2-plan.md` (this addendum,
Part K gains K14 by reference here rather than a full Part K entry, since
this addendum IS its full writeup), `project-state.md` (Deferred Known Bugs
gains K14 alongside K13; Phase 4 status updated).

**Suite: `npx vitest run` → 53 files, 1292 tests, 0 failures** (the +1 file /
+3 tests are the new K14 repro; nothing else changed).

---

#### K14 implementation (Steps AA-AD → shipped, 2026-08-07)

**K14 is FIXED.** Own commit, on top of the addendum above, per instruction —
not bundled with K13 or the timing-source swap. Mechanism, named per file:

  * **`computeDragCascade` (`App.tsx`) no longer writes `locked: true`
    anywhere** — INVARIANT L1. The three auto-lock sites (dragged segment,
    an absorbing neighbour, a MIN-clamped absorbing neighbour) are deleted;
    the pre-existing "an already-locked neighbour blocks the cascade" check
    is untouched (that was never auto-locking, it was respecting a manual
    lock, and decision 9 point 3 still requires it).
  * **`recomputeStartTimes` (`App.tsx`, the tail of `computeDragCascade`)
    now writes `anchorStart` in lockstep with every `startTime` it
    commits**, instead of leaving `anchorStart` untouched. This is the root-
    cause fix: Step AA traced K14 to the drag path never keeping the two in
    sync, and this is the single write site that closes it — a drag can no
    longer leave a stale anchor behind for a later, unrelated action to
    silently re-derive a position from.
  * **`applyAnchorBasedTiming`'s locked branch (`syncEngine.ts`) now PINS
    `startTime`/`duration`** — INVARIANT L2 — instead of snapping
    `startTime` to `anchorStart` and only flooring `duration`. A locked
    segment's `anchorStart` is forced to mirror its `startTime` on every
    call, never read as a separately-stale value. The prior one-directional
    growth exemption ("locked segments never shrink, but grow to absorb a
    removal gap") is WITHDRAWN, per Step AB — a lock is a hard wall in both
    directions, full stop. PASS 1 (first-segment-to-0) and PASS 3 (last-
    segment-to-audioDuration) both gained a `!locked` guard for the same
    reason — either could previously move a locked first/last segment.
  * **An unlocked segment can never start before an immediately preceding
    LOCKED segment's actual end**, and an unlocked segment immediately
    before a lock is bounded by the lock's own `startTime` (never its
    `anchorStart`) as its `nextAnchor` — the Step AC R.1(d)/R.2 substitution.
    This bound is DELIBERATELY LOCAL (read directly off `out[i-1]`/`out[i+1]`
    each iteration, never propagated through a running cursor) — a lock is a
    non-cascading, single-segment-deep wall (Step AC), and an ordinary
    unlocked-to-unlocked overshoot keeps its pre-existing, local collapse-
    to-floor behaviour (the D16 backstop clamp) rather than rippling into a
    later, correctly-anchored segment. **This scoping was found and fixed
    during implementation, not designed up front** — an early version
    applied the forward bound unconditionally (any preceding segment, locked
    or not) and broke `syncTiming.test.ts`'s existing "(d) backstop clamp"
    test, which depends on exactly this local-collapse behaviour for
    ordinary (non-lock) anchor disorder; see the regression accounting
    below.
  * **Two new sync-log surfaces** — `lock-span-overflow` (warning) and
    `lock-preserved-adjustment` (info), both new `SyncLogEntryType` members
    (`types.ts`), styled in `SyncLogPanel.tsx`, built by
    `syncLog.ts`'s new `buildLockFindingLogEntries` from
    `applyAnchorBasedTiming`'s new optional third parameter,
    `onLockFinding?: (finding: LockFinding) => void` — additive, so none of
    the ~30 existing call sites needed to change. Wired at `handleToggleLock`
    (`App.tsx`), the site Step AA's whole diagnosis is about, with a
    standalone `mintSyncLogId()` per toggle (same precedent as the H.4
    unsupported-language guard: a finding that isn't tied to an Apply Sync
    run gets its own run id). Not wired into the Apply Sync / staging-
    transcription call sites — deliberately, to keep this commit's blast
    radius to K14's own site; those paths are K13/timing-source-swap
    territory.

**Repro handling.** `scripts/phase4-step-aa-unlock-repro.test.ts` was NOT
deleted. Every assertion is inverted in place (proves the fix, not the
defect); the original buggy values are preserved in comments at each site,
per instruction. PART 3 (the D16 backstop-clamp destructive-overwrite case)
is unrelated to locking and its own numeric outcome is unchanged by this fix
— it is pinned as still-correct, adversarial-input behaviour, with a new
assertion added showing the specific drag sequence that used to feed it a
stale, out-of-order anchor no longer can. A PART 4 was added that writes
`.work-phase4/step-aa-c13-live-repro.json`, the live artifact C13's real half
consumes (same precedent as `phase4-step-w-k13-repro.test.ts` writing C11's).

**Regressions, sorted honestly (the two tests that changed, beyond the
repro file's own designed inversion):**

  * `src/services/lockedOverlap.test.ts`, "a locked segment can exceed its
    available span (overlap G)" — **INTENDED.** This test's own docstring
    said the overlap it asserted (`G ≈ 5`) was "intended behavior" under the
    Phase-3-era one-directional growth exemption Step AB explicitly
    withdraws. Post-fix the unlocked neighbour is pushed forward to the
    lock's exact end instead of overlapping it (`G ≈ 0`), and Σ duration is
    no longer inflated by a locked segment at all — the very mechanism the
    ORIGINAL `resolveAudioDuration` fix (this test's stated subject) existed
    to work around no longer produces inflation in the first place. Renamed
    and rewritten to assert the new, correct, non-overlapping outcome; the
    locked segment's own duration still never shrinking is unchanged and
    still asserted.
  * `src/services/syncTiming.test.ts`, "(d) backstop clamp: an inverted
    anchor is clamped, later segment protected" — **REGRESSION, caught and
    fixed in `syncEngine.ts`, not by editing the test.** An early
    implementation applied the new forward-start bound unconditionally
    (`effectiveStart = max(rawAnchor, prevSegmentEnd)` for every unlocked
    segment, not only one immediately after a lock), which made a floor-
    collapsed, non-lock-related segment's end push its own NEXT segment
    forward too — breaking this test's explicit contract ("d2, the correct,
    earlier segment, keeps its true anchor — not pushed forward"). Fixed by
    scoping the forward bound to fire ONLY when the immediately preceding
    segment is locked (see the local-vs-cursor point above); re-running the
    suite after the fix reproduced this test's original expected values
    exactly, with zero edits to the test itself.

**Suite: `npx vitest run` → 53 files, 1293 tests, 0 failures** (was 53/1292;
the +1 test is PART 4's artifact-writing test — the file's other 3 tests
were already counted). `tsc --noEmit` clean.

**C13 built** ("lock isolation across unrelated edits", Step AD's own
recommendation), in the same isolated-harness style as the other thirteen:
`c13_lock_anchor_consistency` (`scripts/phase4-step-s-structural-checks.py`)
— a poison case (a locked segment with `anchorStart` 3s stale relative to
its `startTime`, plus a healthy control row the check must correctly ignore)
that fires, and a live half wired into
`scripts/phase4-step-x-verify.py`'s `run_c13()` that re-runs
`phase4-step-aa-unlock-repro.test.ts` and reads its new PART 4 artifact —
unlike C11, C13's real half is NOT inverted: K14 is fixed, so it genuinely
stays quiet (`verdict: "FIX CONFIRMED"`). `python3 scripts/phase4-step-x-
verify.py` now walks **14** rules, 14/14 poison PASS, 14/14 real PASS
(headline still incomplete for the same reason as before — C10's third,
recall, half still FAILS and C10 stays OUT of CI; nothing about that
changed). C13 graded A (live reproduction against production code, same
tier as C11) with its own stated caveat: its scenario is a synthetic
6-segment timeline, not a real corpus project, because no committed baseline
carries a locked segment (locks are cleared by resync — K13, still open) —
the same structural reason C11's own real half can't run against a
baseline either.

**Verification.** `tsc --noEmit` clean. The Step Y replay harness
(`scripts/phase4-handoff-replay-sync.test.ts`) reproduces Step M's golden
values EXACTLY — 444/172/26 segments kept on v6/173/spanish, zero diff
against `docs/phase4-baseline-*.csv` — expected and unremarkable, since none
of the three replayed corpus projects contains a locked segment and this fix
only changes locked-segment-adjacent behaviour; recorded as confirmed, not
assumed. A manual end-to-end walkthrough against the real 173-project
baseline (`docs/phase4-baseline-173-segments.csv`, not a synthetic fixture)
confirmed: (1) a drag + an unrelated lock toggle moves nothing outside the
dragged/absorbed/toggled segments, anywhere in the 175-segment array; (2) an
explicitly-locked segment survives that same sequence with `startTime`,
`duration`, and `anchorStart` bit-for-bit intact; (3) a locked segment
survives an in-editor re-derive (`applyAnchorBasedTiming`) with start AND
end intact even when both neighbours' anchors are perturbed hard around it,
and the unlocked neighbour is pushed clear of the lock rather than
overlapping it. **Stated precisely, not implied:** "survives a re-sync" in
this walkthrough means the in-editor `applyAnchorBasedTiming` re-derivation
K14 lives in (drag commits, lock toggles) — NOT a full Apply Sync click
(`parseProjectData`'s clean-slate rebuild), which remains K13-broken by
design; a direct check against the real 173 project confirms Apply Sync
still mints 0 segments carrying any lock field, exactly as K13's own repro
already demonstrates. K13 is untouched, as instructed.

**No K13 change. No timing-source-swap change. No Rust.** New:
`scripts/phase4-step-s-structural-checks.py`'s `c13_lock_anchor_consistency`
+ poison case; `scripts/phase4-step-x-verify.py`'s `run_c13`. Amended:
`src/App.tsx` (`computeDragCascade`, `recomputeStartTimes`,
`handleToggleLock`), `src/services/syncEngine.ts`
(`applyAnchorBasedTiming`, new exported `LockFinding` type), `src/services/
syncLog.ts` (new `buildLockFindingLogEntries`), `src/types.ts` (two new
`SyncLogEntryType` members), `src/components/SyncLogPanel.tsx` (two new
badge styles), `src/services/lockedOverlap.test.ts` (one test rewritten,
intended), `scripts/phase4-step-aa-unlock-repro.test.ts` (inverted in
place, one test added).

---

#### K15 — drag over-absorption (owner report post-K14, fixed 2026-08-07)

**Owner's report:** "Dragging a segment a few hundred ms sometimes consumes a
neighbour's entire audio. Intermittent: sometimes correct, sometimes
catastrophic." The owner's hypothesis was that K14's removal of auto-lock-on-drag
had exposed unbounded absorption in `computeDragCascade`. **That hypothesis is
half right, and the half it misses is the catastrophic half.** There are two
independent defects here, with different origins, and they were separated by
measurement before anything was changed.

**Method.** `computeDragCascade` and `recomputeStartTimes` were module-private in
`App.tsx` and had never had a unit test. Both were copied verbatim — HEAD's
version and the version at tag `phase4-implementation-ready-2026-08-07` (the
pre-K14 baseline) — into a throwaway harness alongside the REAL
`applyAnchorBasedTiming` from each tree, and run over hand-built arrays. The
distinguishing condition was then read off the numbers, not guessed.

**K15a — gap collapse. INTRODUCED BY K14. This is the catastrophic case.**

The condition that distinguishes a working drag from a broken one is not
direction, not neighbour duration, and not zero-token segments. It is: **does the
segments array contain a gap — a pair where `startTime[i] + duration[i] <
startTime[i+1]` — anywhere at all.** If it does, EVERY drag anywhere in the
timeline is catastrophic; if it does not, no drag is. That is exactly the
intermittency the owner described, and it explains why the damage is wildly
disproportionate to the drag distance.

Two halves, and only one of them is new:

* The mechanism is old. `computeDragCascade` ended by calling
  `recomputeStartTimes(segs)`, which rebuilt EVERY segment's `startTime` from a
  running sum of durations starting at 0 — a flexbox-style global re-flow that
  deletes any gap in the array by construction. That code is original and K14
  did not touch its re-flow behaviour.
* The precondition is K14's. Pre-K14 no upstream stage could produce a gap:
  `applyAnchorBasedTiming`'s locked branch grew a locked segment to fill any span
  that opened after it (`duration = max(preservedDuration, availableSpan)`), so
  its output was contiguous by construction and the re-flow was a no-op on
  position. K14 withdrew that growth exemption deliberately, to make a lock a
  hard wall in both directions. A locked segment whose end now falls before the
  following segment's anchor leaves a REAL gap
  (`effectiveStart = max(rawAnchor, lockFloor)`, `syncEngine.ts`). **So K14
  turned dead code into a live defect. Honest answer: K14 introduced it.**

Measured, on the array `applyAnchorBasedTiming` itself produces for
`[A unlocked, B locked 10-12, C anchored 15, D anchored 18]` at
`audioDuration = 20` — a 3.000s gap between B's end and C's start:

| drag | pre-K15 result | displacement |
|---|---|---|
| C right edge, +0.2s | `C[12.00..15.20] D[15.20..17.00]` | C moved **-3.000s**, D **-2.800s** |
| D right edge, +0.2s (no neighbour at all) | `C[12.00..15.00] D[15.00..17.20]` | C moved **-3.000s** |

C's new slot contains none of C's own audio; D's contains C's. The second row is
the proof that this was never a cascade bug — the re-flow was unconditional, so
it fired with zero cascade work to do.

**Fix:** the cascade is now STRICTLY LOCAL. Only the contiguous index window the
cascade actually touched is restacked, anchored on whichever edge of that window
the drag does not move (the dragged segment's own start for a right-edge drag;
the far end of the cascade for a left-edge drag). Every segment outside the
window keeps `startTime`/`anchorStart` byte-identical, so a gap outside the
window survives. This is the same locality rule K14 already established for
`applyAnchorBasedTiming` ("DELIBERATELY LOCAL, never propagated through a running
cursor") — K15a is that rule reaching the one writer that had been exempt from
it. Contiguity inside the window is preserved because the cascade conserves the
window's total duration exactly (see the give-back below).

**K15b — unbounded neighbour absorption. PREDATES K14.**

The cascade floored an absorbing neighbour at `MIN_SEGMENT_DURATION` (0.3s) and
at nothing else, so a neighbour could be crushed from several seconds to 0.3s and
lose every word it owns. That floor is original; K14 did not change it, and a
FIRST drag behaves identically on both sides of K14 (verified: both trees return
`A[0.00..5.30] B[5.30..5.60] C[5.60..10.40]` for the same crush case).

What K14 did change is repeatability. Pre-K14 the cascade wrote `locked: true`
onto the dragged segment and every absorbing neighbour, so a SECOND drag into the
same neighbour hit the locked-neighbour guard and was refused with a toast — an
accidental one-shot circuit breaker, not a bound. Measured over three successive
+0.3s drags on `[A 5s, B 1s, C 5s]`:

| drag | pre-K14 (baseline tag) | post-K14 (HEAD) |
|---|---|---|
| #1 | `B[5.30..6.00]` | `B[5.30..6.00]` |
| #2 | **BLOCKED** (toast: "Segment 2 is locked") | `B[5.60..6.00]` |
| #3 | — | `B[5.90..6.20]` (B now at the 0.3s floor) |

Decision 9 point 1 forbids restoring auto-lock, so the bound has to be a real one.

**The floor, and where it comes from.** A neighbour's slot may never be moved past
its own outermost word: a head-yielding neighbour's start may not pass its own
FIRST word's onset, and a tail-yielding neighbour's end may not fall below its own
LAST word's offset. **A neighbour may yield its own silence, and nothing else.**
The floor is read from the project's own `transcriptTokens` — the same word-level
array the aligner and `snapBoundaries.ts` place every boundary against; nothing
new is measured or inferred. Ownership is by token MIDPOINT inside the
neighbour's slot, so a word straddling a slot edge counts as the neighbour it is
mostly inside and that edge yields nothing. Times, not indices, are what the floor
reads, so the persisted (unfiltered) array is the correct one at this call site —
unlike the index-based `snapCoveredBoundaries` call, which must use the filtered
array `useWhisper` returns; malformed tokens are skipped defensively regardless.

Two deliberate degradations, both preserving pre-K15 behaviour exactly: a project
with no transcript at all, and a **zero-token neighbour** (an unscripted heading,
or a scene the aligner skipped), both yield `Infinity` — no bound — leaving
`MIN_SEGMENT_DURATION` as the only clamp, because there are no words there to
protect and a larger floor would only refuse drags the user is entitled to make.

**The bound is a POSITION bound, not a duration floor.** A duration floor
(`slotEnd - firstWordOnset` as a minimum duration) was implemented first and is
wrong: it is only equivalent while the neighbour's far edge is pinned, and under a
multi-neighbour cascade it is not. It was caught by this commit's own tests,
which showed a two-neighbour cascade pushing a neighbour's start to 7.00s past its
own first word at 6.00s while its duration still satisfied the floor.

**Give-back.** Shrink demand the word bound refuses is handed BACK to the dragged
segment rather than dropped. Dropping it is what let a drag take time that no
neighbour ever gave up — the touched window's total duration would change and the
restack would have to push the difference into a segment the drag never touched.
Giving it back conserves the window's total exactly, so the drag simply stops
where the neighbour's words begin: the CapCut/Premiere behaviour. It is bounded by
construction (`refused` can never exceed the original delta, so the dragged
segment never ends below the duration it started at). The separate case of the
cascade running off the END of the array with demand outstanding is deliberately
left as it was — that is not over-absorption, and changing it would move unrelated
behaviour into this fix.

**Verification.** `computeDragCascade`/`recomputeStartTimes` moved out of
`App.tsx` into new `src/services/dragCascade.ts` (they were untestable where they
were; `App.tsx` imports `MIN_SEGMENT_DURATION` back from it). New
`src/services/dragCascade.test.ts`, 20 tests in three parts: PART 1 K15a, PART 2
K15b, PART 3 pre-K15 behaviour that must not change. **The 5 defect assertions
were confirmed FAILING against the pre-K15 cascade** (restored verbatim into the
module and re-run) **while all 15 unchanged-behaviour assertions passed on both
sides** — which is the evidence that the change is targeted rather than a rewrite.
Pre-K15 values are recorded inline next to every inverted assertion. Suite: 54
files / 1313 tests, 0 failures (was 53/1293). `tsc --noEmit` clean. Step Y replay
harness reproduces Step M's golden values exactly — expected, since none of the
three replayed corpus projects contains a locked segment, so none can contain a
gap.

**No K13 change. No timing-source-swap change. No Rust. No test expectation
edited** (the two files whose expectations changed at K14 are untouched here).
New: `src/services/dragCascade.ts`, `src/services/dragCascade.test.ts`. Amended:
`src/App.tsx` (two functions and one constant removed to the new service;
`applyDurationChange` forwards `transcriptTokens`).

---

#### K16 — drag pointer accuracy and smoothness (owner report, fixed 2026-08-07)

**Owner's report:** the dragged edge lags the pointer by roughly 100px,
sometimes less, and does not track live. Target: CapCut/Premiere feel — the
edge sits under the pointer exactly, every frame, both edges. Two candidates
were named to check: a stale/wrong px-to-seconds scale factor (would scale with
zoom), or a missing grab offset (would be a constant gap); scroll-offset and
container-origin error were also to be checked.

**Diagnosis, measured before anything was changed.** Three independent faults,
none of which is the scale-factor hypothesis:

1. **A stale container-origin constant, 24px, constant in pixels.** The
   pointer→content mapping was `clientX - rect.left + scrollLeft - 24`. That
   `- 24` is annotated `// 24 is padding` in the app's initial commit, where
   `#timeline-scroll-area` genuinely carried `p-6 pt-10` (24px of real
   horizontal padding). A later layout redesign changed the container to
   `p-0 pt-[15px]` and the constant was never removed. Measured live in the
   running app: the container's computed `paddingLeft` and `borderLeftWidth`
   are both `0px`, and its content origin sits exactly `0px` from
   `getBoundingClientRect().left`. So the term was a pure 24px error — constant
   in PIXELS, which is why it looked zoom-dependent: in SECONDS it is
   `24 / pixelsPerSecond`, so 0.24s at the default 100px/s and well over a
   second when zoomed out. This answers the owner's candidate (a) as stated —
   the scale factor itself was never wrong — but the container-origin term was.
2. **No grab offset, up to 8px.** `onResizeStart` never received the pointer
   position, so the edge snapped to wherever the pointer was rather than
   preserving where inside the handle the user grabbed. Measured: the handles
   are `w-2`, 8px wide.
3. **The dragged edge did not move at all on a left-edge drag — the owner's
   candidate (b), and the actual source of "roughly 100px."** Each segment
   card is absolutely positioned from React state (`left`/`width`); the drag
   loop wrote only `style.width`. On a right-edge drag that's correct — the
   left edge is meant to stay put. On a LEFT-edge drag it means the grabbed
   edge stayed pinned while the OPPOSITE edge moved in the opposite direction,
   so the lag equalled the full drag distance, unbounded — not a fixed gap.
   "Roughly 100px, sometimes less" is (3) on a left-edge drag and (1)+(2) on a
   right-edge one.

No scroll-offset or scale-factor error was found; `pixelsPerSecondRef` is read
live at drag start and used consistently throughout.

**Fix.** `src/services/dragGeometry.ts` (new, pure — no DOM/React) is the single
source of truth for what a dragged edge position means:
`timelineContentX` (pointer → content-space x, no padding correction — see
fault 1), `computeGrabOffsetPx` (fault 2), and `resolveDragEdge` (the duration/
trimStart/playbackSpeed math, unified — see below — plus `segmentLeftPx`, fault
3's fix: on a start-edge drag this is `(originalEnd - duration) * pps`, pinning
the right edge; on an end-edge drag it is the segment's own unchanged start).
`App.tsx`'s handler now: reads the grab offset once at pointerdown; on every
frame calls `resolveDragEdge` and writes `style.left`/`style.width` on BOTH the
thumbnail-lane card and (new) the waveform-lane cell — Timeline.tsx's waveform
sub-cell gained `data-seg-id={s.id}` so it tracks too, closing a smaller,
related bug where the two lanes visibly disagreed during a drag.

**Unification, not just relocation.** Pre-K16 the live-preview width
(`liveDurationForX`) and the committed width (`handleUp`) were two
hand-written copies of the same expression. Two copies of timing math that
must agree is a drift risk by construction. There is now exactly one function,
`resolveDragEdge`, called from both the per-frame preview and the commit —
verified in `dragGeometry.test.ts` ("the live-preview duration and the
committed duration are now one value, not two copies").

**Smoothness — pointer capture, rAF batching, no per-move recomputation.**
`onMouseDown`/`window.addEventListener('mousemove'/'mouseup')` replaced with
`onPointerDown` + `element.setPointerCapture(pointerId)` +
`window.addEventListener('pointermove'/'pointerup'/'pointercancel')` — capture
guarantees the element keeps receiving events for the whole gesture even if the
pointer leaves it, leaves the window, or the element re-renders underneath;
`pointercancel` is handled identically to `pointerup` so an OS gesture takeover
can't leave the drag armed forever. `touchAction: 'none'` on each handle stops
the browser claiming the gesture as a scroll before the first move arrives.
Moves are coalesced into a single `requestAnimationFrame` (unchanged pattern
from before K16) — the frame body is one `scrollLeft` read, one pure
`resolveDragEdge` call, and two `style` writes per element (four total, two
lanes). **No React state is touched during the drag** — no `setProject`, so no
re-render, no timing recomputation, no cascade — until `pointerup`, where the
real commit runs exactly once via the same `applyDurationChange` →
`computeDragCascade` path K15 already hardened.

**Per-move cost, stated:** pre-K16, one duration/trimStart/speed computation
(the live-preview copy) plus one `style.width` write per rAF frame; no
`style.left` write, no full pointer-capture guarantee, native `mousemove`
(bubble-only, droppable if the cursor left the handle). Post-K16: one
`resolveDragEdge` call (duration+trimStart+speed+left, all four values, one
function) plus two style writes (`left`+`width`) on up to two elements (two
lanes) per rAF frame, under captured pointer events. The added cost is one
extra property write per element per frame; the removed cost is a whole second
hand-written duration computation that used to live only in the commit path
and is now shared. Net: not more expensive in any way that matters at
one-write-per-frame scale, and the previous implementation was already
rAF-batched — K16 did not introduce batching, it removed the accuracy and
liveness bugs sitting inside it.

**Timing-neutrality proof (the owner's constraint).** `dragGeometry.test.ts`
PART 1 transcribes `App.tsx`'s pre-K16 `handleUp` expression verbatim into a
named reference function and asserts `resolveDragEdge` returns byte-identical
`duration`/`trimStart`/`playbackSpeed` across a sweep of edge positions (both
edges, five segment fixtures including video/non-video and an
already-at-minimum segment, three zoom levels, positions swept from 0 to past
the segment on both sides) — 30 sweep tests, all passing. **K16 changes which
`edgeContentX` a given pointer position produces (PART 2); it does not change
what a given `edgeContentX` means (PART 1).** That is the boundary the owner
asked for proof of, and it is enforced by a test, not by inspection.

**Verification.** New `src/services/dragGeometry.ts` + `dragGeometry.test.ts`
(38 tests: PART 1 timing neutrality as above, PART 2 the pointer-accuracy
fixes — the 24px constant reproduced and measured scaling in SECONDS not
pixels, the grab-offset snap reproduced, both-edges-track-the-pointer
assertions at three zoom levels). Also verified live in the running dev
server (`preview_start` + synthetic `PointerEvent` dispatch, since no fixture
project with real assets was available): a 3-segment project injected
directly into `localStorage`, a right-edge drag on segment A moved through
four pointer positions with the live DOM `style.width` matching the expected
value to within 0.002px (float-display noise, not a real gap — previously off
by tens of pixels) at every step, the COMMITTED result after `pointerup`
matched the live extrapolation exactly (A: 5→6.443s, B: 5→3.557s, conserving
the pair's total duration, C untouched — K15 locality holding in the real DOM
too), and a left-edge drag on segment B moved `style.left` while pinning the
opposite edge (`left + width` constant at 692.8px) — the direct fix for fault
3. No console errors either drag. Suite: 55 files / 1351 tests, 0 failures
(was 54/1313 after K15). `tsc --noEmit` clean. Step Y replay harness
(`phase4-handoff-replay-sync.test.ts`, part of the suite) still reproduces
Step M's golden values exactly — untouched, since nothing here runs outside an
interactive drag.

**No K13 change. No timing-source-swap change. No Rust. No test expectation
edited.** New: `src/services/dragGeometry.ts`, `src/services/dragGeometry.test.ts`.
Amended: `src/App.tsx` (drag handler rewritten on `resolveDragEdge`; two
constants moved to the new service), `src/components/Timeline.tsx`
(`onResizeStart` signature gains `clientX`; handles use `onPointerDown` +
pointer capture instead of `onMouseDown`; waveform-lane sub-cell gains
`data-seg-id`).

---

### Phase 3b — Language-keyed normalization (moved from old Phase 8 / H.5 — see K1)
The main multilingual work item — full specification in H.5 (per-language number words and reading rules, currency equivalents, the inverted thousands separators, French elision vs. English contraction expansion; every rule additive and language-keyed).
GATE: the English path must be provably byte-identical to today’s, verified against the frozen English baseline — so this phase does NOT shift English indices. Non-English rule verification requires the non-English corpus (K3); if only one non-English project exists by this point, the others’ rules land dormant behind their language keys and are verified when corpus material arrives — recorded as an explicit written acceptance at the Stage 1 lock.

**Task 5 prerequisite, found 2026-08-11 (runtime spike, G1):** `textNormalize.ts`'s
`canonicalize()` step 10 (`[^a-z0-9\s-]` → space) is ASCII-only and silently
destroys native vocab letters for all four non-English supported languages —
es 8/34, fr 26/52, de 5/31, pt 13/39 letters (full sets in the runtime-spike
measurement file). Applied symmetrically to both the scene-doc and transcript
sides today (`whisperService.ts`'s `normalize`/`normalizeSceneDoc`, both routed
through `canonicalize`), so it is not a live matching bug — but it is a
blocking prerequisite once forced alignment needs the native diacritic in a
script word to match the model's own vocab. Sized small; scope this into
Phase 3b's own rule set rather than as a separate Task 5 change.

**Per-language normalization risk, found 2026-08-11 (runtime spike, G1):**
German's vocab has no `ß` at all (confirmed via both `vocab.json` and live
decode) — any Phase 3b German rule must not assume `ß` survives normalization.
French's vocab additionally contains non-French letters (ć č ō œ š ș) — a
training-data hygiene oddity in the upstream model, footnote-only, no rule
implication.

**R-T ruling (owner, 2026-08-16) — non-English corpus deferred out of Stage 1
scope; fr/de/pt normalization-rule risk carried forward explicitly.** The
French/Portuguese/German corpus will not be supplied for Stage 1. Recorded
here as one explicit, dated ruling rather than left as the scattered
"corpus absent, accepted in writing" notes this document already carries —
Phase 2a's Step 5 (`:381` above, Spanish boundary-verification specifically)
and the STAGE 1 LOCK GATE's own blocking list (below, fr/de/pt corpus
absence generally). Those notes stand; this ruling is their explicit closure
going into Stage 1 lock, not a replacement for either.

**Carried-forward risk, stated so it is not silently assumed clean.** Phase
3b's Rules 1-5 (French elision; Spanish/German/Portuguese/French cardinal
numbers 0-20/30, §3b `docs/work-in-progress.md`) have **shipped**, but have
**never been exercised against real audio** for French, Portuguese, or
German — only Spanish has a real corpus project, and even Spanish's boundary
correctness remains unverified by ear (Phase 2a's Step 5 acceptance, `:381`
above). This risk does not resolve itself by Stage 1 locking; it lands,
explicitly, on whichever later stage first takes on non-English corpus
material — that stage's own entry must re-open this note rather than assume
Phase 3b's dormant rules are correct because they compiled and passed
English-only tests.

### Phase 3c — Hyphen asymmetry (moved from old Phase 8 — see K1)
textNormalize.ts glues mid-call into one alignment word while Whisper emits two tokens, so neither matches and the segment’s end is understated. Six occurrences on V6, timing impact on one. This rewrites the alignment corpus on both sides and interacts with the deliberate NUMBER_WORDS carve-out, so it’s its own commit with its own re-listen of the set. It shifts English token/word indices — the last index-shifting event of Stage 1, after which baselines are stable for the rest of the programme (K9).

**Scope addition (2026-08-15, Phase 3b remainder-audit follow-up — reassigned here, not
newly invented work):** two `textNormalize.ts`/`canonicalize` items previously filed
under Phase 3b belong here instead, confirmed by tracing `faChunkPlan.ts` end to end
(`docs/work-in-progress.md`'s changelog carries the full trace) — (1) `canonicalize`
step 10's ASCII-only fold destroying native diacritics for es/fr/de/pt (originally flagged
2026-08-11, runtime spike G1, `:3800-3809` above), and (2) `canonicalize`'s
thousands-separator step actively mangling a non-English-format number (e.g.
`"1.234,56"` reads digit-by-digit as `"one point two three four five six"`). Neither
reaches the forced-alignment model's own input text — `faChunkPlan.ts` cuts and feeds
RAW segment text to FA, never routed through `canonicalize` (`faChunkPlan.ts:360-371,628`)
— so neither is a Phase 3b (`faTextNormalize.ts`) blocker as originally framed. Both DO
reach `canonicalize`-derived `qi` word-count bookkeeping (`faChunkPlan.ts:106-130`, via
`normalizeSceneDoc`/`normalize`), which decides where a chunk's raw text gets cut — a
chunk-boundary-placement risk for non-English text, not a token-content-corruption risk.
Both require editing `canonicalize` itself, which only this phase is scoped to touch;
bundling them into 3c's own already-budgeted index-shift-plus-re-listen (above) avoids a
second, redundant corpus re-listen that treating them as separate Phase 3b work would
require. Not yet designed or estimated as part of this phase's own scope — folded in as a
scope note, not implemented.

**Ruling — hyphen-tokenization mismatch: CLOSED, NO CODE CHANGE, WRITTEN ACCEPTANCE (2026-08-15).** Per D.-1's own allowance ("closed OR explicitly accepted in writing with a reason recorded here") — the same allowance Phase 2a's Step 5 used for Spanish boundary verification (`:381` above) — this phase's original scope (the hyphen-tokenization mismatch itself, distinct from the qi-bookkeeping sub-items already closed above) is accepted as a known, documented Stage 1 defect rather than fixed.

**The defect, precisely.** `canonicalize()`'s existing hyphen-splitting path (`resolveHyphen`, the pre-existing R1 `NUMBER_WORDS` carve-out) glues a non-numeric hyphenated compound (e.g. "mid-call") into one alignment word on the SCRIPT side, while Whisper's real tokenizer always emits it as separate sub-word fragments on the TRANSCRIPT side. Neither side's tokenization can match the other's, so the Hirschberg alignment pass registers a guaranteed deletion at every occurrence — a structural miss, not a probabilistic one, because the two token streams can never agree on where the compound's boundary sits.

**Measured scope.** 19 genuine hyphenated compounds across the V6 + 173 corpus. 8 are clean-split-fixable (splitting the compound into two alignment words lets both sides match). 11 are blocked by Whisper's own sub-word fragmentation regardless of script-side normalization — no script-side change can fix a token the transcript side never emits as a clean unit. Splitting produced exactly ONE boundary change across the entire two-project corpus: V6 segment 150 (`154_silent_night_birds`)'s end, moving from 457.83s to 458.12s. Variants A and B (two candidate splitting strategies) were replay-identical on this corpus — reducing scope between them buys nothing.

**The mechanism — measured, not inferred.** No silence snap participates in this boundary, in either direction: zero silence-detector candidates exist in the window both before and after the change. The boundary is the plain midpoint of segment 150's last-matched word and segment 151's first-matched word, computed purely from anchor positions. Unsplit, "mid-call" fails to match anything, so the anchor falls back to the last word that DOES match — "cut" (ending 457.14) — instead of "call" (ending 457.72). Midpointing that anchor against segment 151's first match (458.52) gives 457.83. Split, "call" matches and the same midpoint arithmetic gives 458.12. **This detail is the load-bearing one, not a footnote: the fix under test does not make the alignment more correct — it moves which wrong-side word the midpoint is computed from, and in this one case that move landed on the wrong side of the true cut. The tokenizer defect is producing the better answer by arithmetic coincidence.**

**Ear-test result.** The owner listened to both candidates: 457.83 (current, unfixed code) is the correct cut; 458.12 (post-split) is WRONG. This reverses the naive expectation that recovering a genuine word match at a seam improves boundary placement — see Phase 5's standing-counterexample warning below, which generalizes this finding forward.

**Ruling: NO CODE CHANGE.** Accepted as a known, documented Stage 1 defect under D.-1 criterion 3 rather than closed by a fix, because the only measured effect of fixing it is a regression the owner's ear confirmed. Fixing 8-of-19 compounds to make one boundary worse is not worth the corpus re-listen and index-shift cost this phase's own scope already prices in.

**Revisit trigger.** This acceptance is voided the moment Phase 5's fence changes how this seam's anchor is derived (i.e., the fence no longer computes this boundary as a last-match/first-match midpoint) — at that point V6 seg 150 must be re-listened to before Phase 5 can claim the eleven word-shift cases are its only regression surface (Phase 5's own verification, below, checks only the eleven; this seam is not one of them today and must not be missed).

### Phase 3d — Adaptive silence thresholds (conditional; moved from old Phase 8 — see K1)
Replacing the fixed −45dB scan with noise-floor estimation, ONLY if Phase 2b’s measurements show the fixed threshold is costing us (it changes the silence array, which the fence consumes — so under stage locking it is Stage 1 work, not an afterthought). If 2b shows no cost, record that finding here and skip this phase.

**PHASE 2B FINDING — SKIP THIS PHASE (recorded 2026-08-05, per this entry's own instruction).** The fixed −45dB / 0.25s threshold is NOT the binding constraint. Evidence: (a) the pauses it detects are real — spot-verified against a rendered waveform of V6's 14–26s range, where the detected intervals line up with visibly silent stretches between speech bursts; (b) the measured failure is entirely on the TOKEN side — word starts land at the *pause's own start* (median +0.038s from it on V6), meaning the silence detector correctly identified a pause that the timestamp source then absorbed into a word; (c) 173, with the identical threshold, measures a 0.080s median error, so the threshold cannot be what makes V6 read 0.500s. **Reopening trigger:** re-evaluate ONLY if Phase 3's post-forced-alignment measurement shows a silence-side cost (e.g. real pauses going undetected once token timing is trustworthy). Threshold sensitivity was not swept — see Phase 2b's "What this phase did NOT measure."

### STAGE 1 LOCK GATE
- Contract IN and Contract 1→2 (Part J) verified guarantee-by-guarantee by owner inspection.
- Inspector inspected across ≥1 tight-pause and ≥1 long-pause project; smear distribution recorded in Phase 1b’s entry; numeric thresholds met (as finalized by 2b).
- Determinism check passed (Phase 0).
- Non-English corpus status resolved: either H.8’s minimum corpus exists and was exercised, or the specific gap is accepted in writing here with a reason and a reopening trigger (see the R-T ruling, above, for fr/de/pt).
- No Stage 1 defect deferred downstream (the hyphen asymmetry and threshold questions are closed inside Stage 1 by 3c/3d — that is why they moved).
- **R.5 (unscripted-audio wildcard) and R.10 (scripted-text-never-spoken, its
  companion) are each either built and verified, or explicitly accepted in
  writing here with a reason and a reopening trigger — amended 2026-08-16
  (owner ruling R4, WS1 Session A).** This reverses the 2026-08-15 decision
  below (`:4618` further down this document) that R.5 was not a Stage 1 lock
  criterion. Together the two rules address 4 of the 7 ear-pass failures
  (items 4, 5 → R.5; items 10, 11 → R.10, `docs/work-in-progress.md`'s
  mechanism table) found after that 2026-08-15 decision was written — locking
  Stage 1 with defects already known and scheduled for repair two stages
  later is the exact pattern the Phase 3c ruling (above) and D.-1's hard rule
  already warn against.
- Cross-cutting regression checklist (D.-1) run and clean.
- **The ZERO-DEFECT REGISTER is EMPTY — added 2026-08-16 (ruling R-AD, WS1
  Session C).** The register IS
  `scripts/phase4-fa-replay.test.ts`'s `KNOWN_BAD` manifest, and the check is
  the `the Zero-Defect Register is empty` test in that file, which is
  `it.skip`-ed today with the open items named in its skip reason. Stage 1 does
  not lock while that test is skipped or red. Entries may only ever be
  CONVERTED (deleted and replaced by a positive assertion at the ear-correct
  value, the pattern ear-pass item 6 follows at 174.74), never simply removed.
- ~~**FA default flip (`isFaGateOpen()` OFF → ON) is the FINAL act of Stage 1**,
  taken only once the register is empty — ruling R-AD, which defers the
  owner's ear-pass decision RC2.~~ **SUPERSEDED — LANDED 2026-08-17 (WS1 Session G,
  ruling R-AK).** The flip shipped as a PER-PROJECT switch
  (`Project.faHighPrecisionSync`, absent = ON, resolved at read time and never
  written back), which is what dissolved the hazard R-AD's ordering existed to
  contain: with a per-machine key, flipping the default silently retimed every
  existing project on the next Apply Sync (F6, R-AI(d)); with a per-project field
  it does not, and **G1 is proved rather than argued** (`faGate.test.ts`'s
  load-path block). R-AD's own release condition — an EMPTY register — was met by
  R-AI(c) before the flip landed. **Criterion R-S(iii) (runtime, ~231s on V6) and
  R7 remain undischarged and still gate the LOCK**, though no longer the flip.
  **R-N is CLOSED** by ruling R-AL (`load-dynamic` + bundled dylib); **Step T**
  (model download) remains open.
- **The 12/12 ear pass is DRAWN and ready to run:**
  `docs/ws1-sync-pipeline/stage1-lock-ear-list.md` — fresh, stratified, 7 MOVED /
  5 UNMOVED, uniform 4.00 s windows (blinding preserved by construction: max |Δ|
  1.95 s < 2 s, so every row's window contains both candidates), sealed arm key,
  R-AB satisfied by there being a single blinded tier. **The Contract 1→2
  guarantee-by-guarantee pass is likewise a working document:**
  `docs/ws1-sync-pipeline/stage1-lock-contract-1to2.md` — 5 DIRECT / 4 PARTIAL /
  3 ABSENT, with **P6** identified as the one row this gate cannot schedule away,
  because the pass IS its enforcement.

**SCOPE OF "ZERO DEFECTS" — en/es ONLY, stated here and not in a footnote.**
Ruling R-T (above, next to Phase 3b) defers French, Portuguese and German out
of Stage 1, and the owner has not supplied that corpus. So every zero-defect
claim in this gate is scoped to **English and Spanish** — the two languages the
verification corpus actually contains (v6 + 173 en, spanish es). **The carried
risk, recorded against whichever later stage takes non-English:
text-normalization Rules 1-5 shipped for fr/pt/de and have never once been
exercised against real audio in any of them.** "Stage 1 locked with zero
defects" must never be read, quoted, or summarised as unqualified — it means
*zero defects in en/es, with fr/pt/de untested by construction*.

**Status as of 2026-08-05: NOT PASSED.** Explicit blocking list, recorded so the next session doesn't re-derive it:
  (a) smear thresholds unmet → needs Phase 3. **Sharpened by Phase 2b (2026-08-05):** the thresholds are now FINALIZED (four of them, see Phase 1b's entry) and the shipped config fails **7 of 8 readings** across the two projects. The blocker is no longer "smear is too high" — it is **"the timing source is of the wrong kind": it emits gapless word spans (93–98% of transitions) and silently deletes words via zero-duration timestamps (68 on V6, 44 on 173).** DTW is eliminated as a remedy (measured zero effect); only forced alignment can clear this;
  (b) ~~no non-English corpus project exists~~ **PARTIALLY RESOLVED 2026-08-04/05** — Spanish corpus project exists, transcribed cleanly on turbo (Phase 2a Step 5), but its boundaries are unlistened; accepted in writing at Phase 2a's entry above, reopens the moment Spanish-specific code ships (Phase 3b). French/Portuguese/German remain completely absent from the corpus — also accepted in writing there, per H.8's dormant-rules allowance;
  (c) ~~3 short-segment-run boundaries not yet in the verification set~~ **RESOLVED 2026-08-04** — 5 added, see Part L;
  (d) Contract IN / 1→2 not yet verified guarantee-by-guarantee;
  (e) cross-cutting regression checklist (D.-1) not yet run;
  (f) ~~`verification-baseline.csv` carried 69 blank `phase-2a` verdict cells (47 existing boundaries + 22 new sync-log-flagged candidates) awaiting the owner's ear~~ **RESOLVED 2026-08-11.** All 69 are closed: the 47 existing boundaries were scored during Phase 2a's own listening pass, which passed its correct-count gate (38/44 verified, ≥30-of-47 threshold met — see Phase 2a's entry above); the remaining 22 new sync-log-flagged candidates are DEFERRED, non-blocking, by owner ruling R-A (2026-08-11) — WS1 does not pause for an ear-listening pass to fill them in.

**Update 2026-08-15: Phase 3c CLOSED, by written acceptance, no code change — see Phase 3c's own entry above.** The hyphen-tokenization mismatch was never separately itemized in this blocking list (K1's phase-move already folded it into criterion 3851's "no Stage 1 defect deferred downstream — closed inside Stage 1 by 3c/3d"), but is recorded here explicitly since the plan's own §3c row and `docs/work-in-progress.md`'s §2 cross-reference this section directly. Phase 3c is fully closed (qi-bookkeeping sub-items DONE 2026-08-15; hyphen-asymmetry CLOSED-by-acceptance 2026-08-15) and drops off the blocking list entirely. Outstanding: (a) smear thresholds (needs Phase 3 production landing), (b) fr/de/pt corpus absent (see the R-T ruling, above), (d) Contract IN/1→2 guarantee-by-guarantee verification not run, (e) regression checklist not run.

**Update 2026-08-16 (owner ruling R4, WS1 Session A): (f) R.5 and R.10 added
to the blocking list.** Reverses the 2026-08-15 "R.5 is not a Stage 1 lock
criterion" decision (`:4618` further down this document) — see the amended
STAGE 1 LOCK GATE criteria above and the R4 entry there for the reasoning.
Outstanding is now (a)-(e) as already listed, plus **(f) R.5 (unscripted-
audio wildcard) and R.10 (scripted-text-never-spoken) each unbuilt and not
yet accepted in writing.**

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

**Standing counterexample — read before touching any compound-hyphen seam (2026-08-15).** Phase 3c's ruling accepted the hyphen-tokenization defect specifically because fixing it regressed V6 segment 150's boundary from a confirmed-correct 457.83 to a confirmed-wrong 458.12, with NO silence snap involved — an anchored-only midpoint shift caused entirely by which word the alignment matched. **Any change in this phase that recovers more true word matches at a compound-hyphen seam will silently reproduce this regression unless that specific seam is re-listened to.** "The fence recovers more matches than the picker did" is not, by itself, evidence that a seam's boundary got better — V6 seg 150 is a standing, measured counterexample where more matches produced a worse cut. If this phase's fence changes how segment 150's boundary (or any other compound-hyphen seam) is derived, listen to it specifically before counting the change as an improvement; the full-forty verification above does not include this seam and will not catch a silent regression there on its own.

**Hypothesis, not a finding — a question for this phase to test, not a rule to adopt.** From this single data point, the last-matched-word / first-matched-word midpoint may not be the right placement model in general: the owner's ear preferred the earlier cut (457.83) over the later, more-central one (458.12), which suggests a cut may belong nearer the end of speech than the centre of a pause — the opposite of a naive silence-centred model. One data point cannot justify adopting this as a rule. Treat it as something the fence's own output can be checked against, not a design input.

### Phase 6 — Deprecate the compensation layer
Now the eight stop being a benchmark and become what they should have been: a regression check on a deletion.
Turn the seam exemption off. Resync. If the eight are still correct without it, delete isBreathSilence, the multi-fragment override, the seam exemption, and the four constants behind them. If any of the eight regress, the exemption is still load-bearing and stays — and we’ve learned something specific about where Phase 3’s timings are still insufficient, which is a real finding rather than an argument.
Your verification: the eight, plus the twenty controls.

**Note (2026-08-15):** if turning off the seam exemption changes the V6 seg 150 compound-hyphen boundary (Phase 3c's accepted defect; standing counterexample recorded at Phase 5 above), re-listen to it specifically before counting the removal as clean — "still correct without the exemption, and more tokens now match" is exactly the kind of match-recovery Phase 5's warning cautions against.

### Phase 6b — pairIdx-20 verification (moved from old Phase 8)
The 173-project’s pairIdx-20 boundary, currently pinned as a known defect at 75.660 against a correct target of 76.470 — likely resolved by Phase 5, verified here (it is a Stage 3 defect and must be closed or accepted before Stage 3 locks, per the hard rule).

**Note (2026-08-15):** unrelated seam, same caution as Phase 5's warning above — verifying pairIdx-20 by "more tokens now match near this boundary" alone is not sufficient; confirm the resulting timestamp by ear against the target 76.470, not just by match count.

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

  **Confirmed 2026-08-11 (runtime spike, G2):** uroman is empirically unnecessary
  — actively harmful if applied — for the jonatasgrosman per-language path.
  300 real Common Voice sentences/language measured uroman-vs-naive-lowercase
  disagreement: en 0.00%, es 7.02%, fr 14.08%, de 7.00%, pt 15.39%. Every
  disagreement is uroman stripping a diacritic the model's own vocab natively
  contains (é→e, ñ-pattern, ç→c, ü→ue, etc.). Quantifies what this section's
  own hedge already suspected but never measured; full data in
  `docs/ws1-sync-pipeline/measurements/runtime-spike-2026-08-11.md` (deleted
  2026-08-14, `9cf5867`; retrieve: `git show
  251be64:docs/ws1-sync-pipeline/measurements/runtime-spike-2026-08-11.md`;
  conclusions also carried in `docs/work-in-progress.md` §7 item 4).

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

  **Correction (2026-08-15, Phase 3b Slice 3 self-audit — `docs/work-in-progress.md`
  changelog): every claim above is accurate for `textNormalize.ts` but is NOT the
  starting-point capability inventory for Phase 3b's actual implementation
  target.** `textNormalize.ts` really does have working English digit expansion
  (`digitTokenToWords`), currency expansion (`$` -> `dollars`), a thousands-
  separator strip, an English `CONTRACTIONS` list, and the `NUMBER_WORDS` hyphen
  carve-out — all real, all English-only, all correctly described above for THAT
  module. But Rule 1 (French elision) and Rule 2 (Spanish cardinals) both landed
  in `faTextNormalize.ts` (created 2026-08-12, R-Q — `docs/history.md`), a module
  its own header comment states is **"DELIBERATELY PARALLEL to `textNormalize.ts`'s
  `canonicalize`, not built on top of it."** `faTextNormalize.ts` started with
  NONE of the five capabilities above, for ANY language, English included — every
  digit-bearing word, every currency symbol, every contraction was uniformly
  DROPPED regardless of language by construction. Per bullet, for the module
  Phase 3b actually touches:
    - Digit-run expansion: not an English-vs-others asymmetry — English never
      had it in this module either. Rule 2 gave Spanish integers 0-30 only;
      every other digit-bearing word, in every language including English, is
      still dropped.
    - Currency/symbol expansion: same gap — no language has it, not even
      English. Correctly tracked as unstarted in the Phase 3b status row above.
    - Thousands separators: `textNormalize.ts`'s bug is that its separator-strip
      step actively MANGLES the token (assumes English format, corrupts a
      non-English number that reaches it). `faTextNormalize.ts` has no separator
      step at all — a thousands-separated number is dropped wholesale as an
      unrepresentable digit-bearing word, not mangled. Different failure mode,
      same missing capability, no owner assigned yet either way.
    - Contractions / French elision: Rule 1 is a narrow apostrophe-shape fold for
      French elision, not a port of `textNormalize.ts`'s `CONTRACTIONS` list —
      `faTextNormalize.ts` has no English contraction-expansion list that could
      accidentally fire on French in the first place, so this bullet's concern
      doesn't transfer as written.
    - The `NUMBER_WORDS` hyphen carve-out: `faTextNormalize.ts` has no hyphen/
      `NUMBER_WORDS` logic of any kind yet — this bullet describes
      `textNormalize.ts` exclusively and has no current analog in the FA module.
    - The GATE line above ("byte-identical to today's [English path]") is
      `textNormalize.ts`'s gate — `faTextNormalize.ts` has no pre-existing
      English baseline to hold identical; its real regression gate is the
      `fixture_parity` TS/Rust-port equivalence test across all five languages
      (`faTextNormalize.test.ts`).
  Read the paragraph and bullets above as documenting `textNormalize.ts`'s real,
  separate, still-open defect (no owner assigned) — not as describing the
  capability baseline Phase 3b's Rules are extending in `faTextNormalize.ts`.

  **Decision (2026-08-15, multi-word-output scope — owner sign-off): (b) —
  `faTextNormalize.ts`/`text.rs` stay single-word-output only, PERMANENTLY.**
  The one-`FaWordResult`/`WordResult`-per-input-token contract (`normalizeWord`/
  `normalize_word`, relied on by `fa_onnx.rs`'s `word_merge_e2e`/
  `words_per_chunk` for per-chunk timestamp-window verification) will not be
  reworked to let one input token expand into a multi-word output sequence.
  **Full scope of what this forecloses, permanently, not just for now:**
    - Spanish cardinals 31+ (`"treinta y uno"` — a space-linked "y" compound,
      one input token needing 3 output words). Not deferred to a later slice;
      no future slice lands this under decision (b).
    - French numbers using "et" (`"soixante et onze"`, 71) — same shape, same
      permanent exclusion. (French 70-99 built purely on hyphens, e.g.
      `"quatre-vingt-dix-neuf"`, stays a SINGLE token/word and is NOT blocked
      by this decision — only the "et"-linked forms are.)
    - Currency expansion, in general — **consequence newly identified and
      confirmed against code this pass, not present in the original 31+/
      French scoping:** `textNormalize.ts`'s own currency rule
      (`t.replace(/\$\s?(\d+)/g, ' $1 dollars ')`, `textNormalize.ts:239`)
      takes a single glued token (`"$5"`) and produces 2 output words
      (`"5 dollars"`) by inserting a space during a whole-string regex pass —
      an architecture `faTextNormalize.ts`'s per-token `normalizeWord` cannot
      replicate under the 1:1 contract. Currency is foreclosed by this same
      decision, not merely unstarted-with-an-owner-pending: every currency
      amount written as a glued symbol+digits token (`"$5"`, `"€10"`,
      `"£20"`) needs multi-word output to read aloud correctly.
    - German compound cardinals are explicitly UNAFFECTED by this decision —
      `"einunddreißig"` (31) is a single concatenated orthographic word, so
      single-word output is structurally sufficient for it. They remain
      unimplemented for a separate reason (an algorithmic compound-generation
      rule, unlike Spanish's flat 0-30 lookup table), not blocked by (b).
    - **Portuguese cardinals 21-29 — discovered 2026-08-15 during Rule 4's
      own implementation, not part of the original 31+/French/currency
      scoping above:** `"vinte e três"` (23) is a three-word space-linked
      "e" compound, the same shape as Spanish's "y" and French's "et", and
      is foreclosed by this decision for the same reason. Unlike Spanish
      (wall at 31) and German (no wall), Portuguese's wall starts at 21 —
      Rule 4 covers 0-20 and 30 only.
  **Reopening criterion:** this decision is voided, and multi-word output
  goes back on the table, only if a future requirement needs it badly enough
  to justify reworking `FaWordResult`/`WordResult`'s 1:1 contract AND
  `fa_onnx.rs`'s `word_merge_e2e`/`words_per_chunk` consumers together — e.g.
  a corpus/production need for Spanish 31+, French "et"-numbers, or currency
  read-aloud that single-word output genuinely cannot serve any other way.
  Remaining coverage gaps alone do not reopen it; the rework cost is real and
  cross-file, so it needs a concrete forcing need.

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

Adopts the concept from `docs/sync-pipeline-contract-plan.md` (deleted; archived verbatim in `docs/history.md`'s "Sync Pipeline Contract Plan — Working Document" section) — producer guarantees / consumer assumptions / enforcement / failure mode — rewritten for the NEW 4-stage architecture. That archived document remains the authority on the OLD pipeline's §2 assumption tables; its R1-R14 risk register is not restated here — it is MAPPED here (end of this part) onto the new contracts.

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
| P6 | Both text sides pass through the SAME language-keyed normalizer; English path byte-identical to pre-v2 | Type-level partially (one module, one entry point); symmetry property manually-verified | Alignment corpus asymmetry — SILENT DEGRADATION → no direct entry; indirect via coverage WARNING. The hyphen asymmetry (Phase 3c) was exactly this failure mode, live — **now CLOSED by written acceptance, 2026-08-15 (Phase 3c's own entry above): no code change, defect documented, ear-tested as producing the better boundary by coincidence at its one measured occurrence.** The broader normalizer-symmetry guarantee otherwise remains manually-verified only | Phases 3b/3c |
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

**Severity taxonomy (absorbed from `docs/sync-pipeline-contract-plan.md` §4, deleted — archived in `docs/history.md`'s "Sync Pipeline Contract Plan — Working Document" section — this contract owns it now):**

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

The register itself lived in `docs/sync-pipeline-contract-plan.md` §5 (deleted; archived verbatim in `docs/history.md`'s "Sync Pipeline Contract Plan — Working Document" section) and is not restated. Disposition under the 4-stage restructure:

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

**K13 — Lock preservation is not carried behaviour; it does not currently work.** Break: Contract 2→3 A4 and Contract 3→4 P4 (above) were written as if a locked segment's `locked` flag and position simply arrive at Stage 3 intact, needing only a single decision site (A4) and a reported-adjustment guarantee (P4). Owner repro on the 173-seg project (2026-08-04): moved segment 27 to overlap segment 28, locked BOTH, ran Apply Sync — both segments reset to their original unlocked positions AND the lock flag itself was cleared. Root cause traced read-only against HEAD: clean-slate resync's Stage 1 (`parseProjectData`, `App.tsx:318`) mints every segment fresh from a `RawSegment` (`App.tsx:161-172`) that has no `locked` field at all, then constructs the final `VideoSegment` via `{ ...s, id: crypto.randomUUID(), ... }` (`App.tsx:513-528`) — never reading `project.segments` or any prior segment. This is the same clean-slate discipline already documented for `anchorStart`/`anchorSource` (the stableKey merge loop that used to restore fields by matching `assetId` or heading text was deleted in step 3a, commit `452e1eb` — see CLAUDE.md's Anchor-Based Segment Timing section) — except no equivalent merge was ever built for `locked`, so it was never carried even before that deletion made carry-forward-by-id impossible (new segments get fresh `crypto.randomUUID()` ids every run, so an id-keyed restore couldn't work today regardless). Confirmed: none of the five sites that *read* `locked` (`syncEngine.ts:217,232,300`; `snapBoundaries.ts:697,899`; `whisperService.ts:1364,1369,1488`; `syncContracts.ts:295`) ever runs against a segment that could carry `true` into a fresh Apply Sync — they are all checking a flag that is structurally always `undefined` at that point. **Hypothesis confirmed.** Fix: Contract 2→3 A4 and Contract 3→4 P4 above are restated as behaviour Stage 3 must BUILD (a carry-forward step — by script-position/order, not id, since ids churn every run — from the pre-sync `project.segments` into the freshly parsed array, before any of the five lock-consuming sites run), not behaviour that is merely being consolidated into one site. The Stage 3 lock gate (Part D) must verify it with this exact repro: lock two overlapping segments, Apply Sync, confirm both position and lock flag survive. **Changes Contract 2→3 A4 and Contract 3→4 P4's status from "carried" to "built at Phase 3"; adds a mandatory Stage 3 lock-gate test case; no stage-boundary or order change.** Also corrects `docs/sync-pipeline-contract-plan.md:359`'s (deleted; archived in `docs/history.md`'s "Sync Pipeline Contract Plan — Working Document" section) "Locks are authoritative everywhere" claim (the closest existing statement of this invariant — CLAUDE.md carries no equivalent line to correct) and `project-state.md`'s Deferred Known Bugs, both updated alongside this entry. **K13 itself is now CLOSED (2026-08-11) — see the header note at the top of this document; this paragraph is left as the historical finding record.**

**Found sound (attacked, no revision needed):** the Phase 3-before-Phase 5 ordering (segment 96's fixture numbers hold at §D.12/§D.13); Phase 1's redundancy claim (audit §B.4's trace confirmed the gap-fill's output is overwritten on every real path, including the first-segment, locked, and empty-token cases); the coverage-partition move to Stage 2's end; keeping the two duration-floor constants separate (rename, not merge); and the decision to keep `isBreathSilence` through Phase 5 into its own deprecation phase rather than deleting it with the picker.

Part L — Short-Segment Cascade (Phase 0 finding, 2026-08-04)

Owner listening of the two repaired control boundaries in `verification-baseline.csv` (key "lead hunter slows || every person slows" and key "wind || small animals", both V6-447) found something larger than word-shift: a multi-segment cascade, not a single stolen word at one boundary.

**MECHANISM, with the arithmetic.** Segment 144's committed slot is roughly 427.7-428.3s (its script text is "Wind."). `docs/ws1-sync-pipeline/measurements/v6-smear-baseline.csv`, row 1179 (the V6 CSV — begins "Level 1 The child who does not yet know what dark means"; the 173-seg CSV, which begins "Some places in the 41st millennium," was checked and does not contain this token): `Wind,427.690,428.110,0.420,0.130,428.300,-0.610`. Whisper timestamps "Wind" at 427.690-428.110. The inspector reports, for that same token, `nearestSilenceEndSec=428.300` and `smearSec=-0.610` — i.e. the detected silence actually ENDS 0.61s after Whisper's claimed word start, so the word is really articulated after 428.300 and segment 144's entire ~0.6s committed slot sits in silence. The word therefore plays under segment 145. Each following segment inherits the displacement until a long segment absorbs it (segment 147, 4.2s duration).

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

**RE-OPENS.** This finding partially contradicts `boundary-drift-investigation.md`'s conclusion (deleted 2026-08-14, `9cf5867`; retrieve: `git show 251be64:docs/ws1-sync-pipeline/boundary-drift-investigation.md`; also see `docs/work-in-progress.md` §3's paragraph immediately below the task-4 table, which already notes this same contradiction) that the defect was "localized to the boundary picker" and that "the aligner is exonerated." The aligner's SPANS may still be correct while the TIMESTAMPS those spans point at are not — both statements can hold.

---

> Bug & task tracking lives in `project-state.md`. `docs/sync-pipeline-contract-plan.md` (deleted; archived verbatim in `docs/history.md`'s "Sync Pipeline Contract Plan — Working Document" section) remains the authority on the OLD pipeline's assumption tables and the R1-R14 register text; Part J owns their v2 mapping. `docs/verification-baseline.csv` (created at Phase 0) is the programme's verdict record.

---

Part M — Task 5 (Phase 3) Status Addendum (2026-08-14, WS1 documentation consolidation)

> **Append-only, per this project's own line-citation-stability rule.** Nothing above this
> line was edited, reordered, or removed to write this Part — every existing line number in
> this document, and therefore every prior audit's citation against it, remains valid. This
> addendum exists because Task 5 (Phase 3) shipped 25 slices (D1–D25, D7 cancelled as
> scoped) between this document's own last self-correction (the 2026-08-13 callout under
> Step R, "Status update, 2026-08-13 (WS1 Task 5 documentation pass)") and today, and none
> of D2–D25 is reflected anywhere above. **Live, granular status for all of this — updated
> per-slice, not per-consolidation-pass — now lives in `docs/work-in-progress.md`'s
> "WS1 — Sync Pipeline Rewrite" section (§1–§11). This Part is a point-in-time pointer, not
> a replacement tracker; if the two ever disagree, `work-in-progress.md` is newer and wins.**
> This document remains design-of-record: stages, phases, contracts (Part J), and the risk
> register are unchanged and unrestated here.

**R.2 (context padding) — CLOSED-NEGATIVE, deleted.** Step R (`:1421-1446`) specifies R.2
as a padding mechanism bounding a run's audio window. It was built (Slice D23,
`align_chunked_with_padding`/`FA_R2_DEFAULT_PADDING_SEC`, 0.5s default), measured, and
found net-unfavorable: the below-`CONF_MIN` tail grew 155→164 words and seam concentration
worsened 83.9%→85.4% (Slice D24). D24's own diagnostic then falsified the mechanism's own
premise — 0/236 edge-word checks showed a timestamp escaping its own chunk's window, in
either the padded or unpadded run, confirmed both architecturally (padded emission is
sliced back to the exact unpadded frame count before Viterbi decode) and empirically. The
three symbols (`align_chunked_with_padding`, `align_chunk_samples_padded`,
`FA_R2_DEFAULT_PADDING_SEC`) were deleted from `src-tauri/src/fa_onnx.rs` rather than kept
as unwired dead code — confirmed by direct grep, zero hits. Does not need re-attempting
under the falsified untokenized-pad-speech hypothesis; a future slice would need a
genuinely new mechanism. Full record: `docs/work-in-progress.md` §4/§6, commits `3f2b9e6`
(build) / `a89f70a` (post-mortem + deletion).

**R.5 (unscripted-audio wildcard) — scoped, reachable, not built.** Step R (`:1485-1503`)
specifies R.5 as a CTC wildcard absorbing unscripted audio inside a run, with its
destination flagged there as needing an owner ruling. That destination question is now
closed: ruling R-E ("Model P outranks R.5," the wildcard span is assigned to the preceding
segment), recorded 2026-08-11, a day before Task 5's first commit — **AMENDED by owner
ruling 3 (WS1 Session H, 2026-08-18) for the COMMITTED-BOUNDARY case specifically: nine of
V6's ten unscripted runs held a committed boundary snapped onto a silence strictly inside
the run, and the ear-correct destination for THAT boundary is the FOLLOWING segment, not
the preceding one — R.12 (`src/services/faRunPlacementGate.ts`) owns the fix. R-E's chunk-
plan excision itself is untouched; see this document's first R-E citation above for the
full amendment text.** What R.5's own
reachability scoping (Slice D25 B1) found: the condition R.5 exists to handle — real
unscripted audio between two segments sharing a chunk — is **still fully reachable today**
under the shipped index-attribution chunked path (118 real chunks from 172 segments means
most chunks already concatenate multiple segments' text); index attribution (D21) fixed a
different, coarser-granularity bug and did not add any wildcard mechanism. No
wildcard/star-token state exists anywhere in `fa_viterbi.rs`/`fa_onnx.rs` today (grepped,
zero hits). What remains open is *whether/when* to build it, not where the gap goes — see
`docs/work-in-progress.md` §7 item 2 for the live open-decision framing.

**Spanish language gate — CLOSED**, unchanged from Step U's own finding above (this
document's Step U, Spanish accuracy: corrected p95 50.4ms vs. the approved 250ms gate, 1 of
22 pauses over) — noted here only to confirm Task 5's later slices (D1–D25) did not reopen
it. No Spanish-specific code has shipped in Task 5 to date, so the reopening trigger stated
at this document's own Phase 1b entry (Spanish boundary-listening acceptance voids "the
moment any Spanish-specific normalization or alignment code ships, Phase 3b") has not
fired.

**Durable 16kHz WAV audio cache — built, live-wired, not yet production-reachable.** Not
named anywhere in Step R's own design (R.0–R.9) — this is an implementation-layer addition
Task 5 needed once real per-chunk inference required durable, reusable transcoded audio
rather than the whisper.cpp sidecar's existing delete-on-exit temp WAV. `ensure_durable_wav`
(`src-tauri/src/fa.rs:736`), LRU-evicted at a 2 GiB cap (`fa.rs:591,516`), built at Slice
D24 and wired into `fa_align_dev` — the one real caller — at Slice D25, live-verified
against a real `AppHandle<Wry>` and the real 173-project corpus: resolved cache path
matches production's `app_local_data_dir()` exactly, cache hit 1538× faster and
byte-identical to a miss. Two real bugs were caught and fixed live in the same slice (a
`.tmp`-suffix filename defeating ffmpeg's own format auto-detection; a concurrent-miss
filename collision). Still has no production (non-dev, UI-reachable) caller — that slice is
the next item on the terminal path (`docs/work-in-progress.md` §11, item 1).

**R.5 (unscripted-audio wildcard) — DECISION: DEFERRED, 2026-08-15.** Closes the
"whether/when" question `docs/work-in-progress.md` §7 item 2 left open (the
*destination* question was already closed by ruling R-E; the *implementation*
timing is what this closes). **Decision: option (b)** — ship the capability-gated
production-wiring slice (`docs/work-in-progress.md` §11 item 1) without R.5, build
R.5 afterward. **Reasoning:** Stage 1 lock (§11 items 12-13) depends only on items
1 (production wiring) and 8 (Phase 3c) landing — R.5 is not a Stage 1 lock
criterion under any citation in this document or the tracker. D25 B1 already found
the condition R.5 exists to handle remains reachable and silently-absorbed (not
mis-attributed) under the shipped index-attribution path, so deferring costs
nothing correctness-wise before Stage 1 lock. **Does not descope R.5** — owner
ruling D1 (`docs/work-in-progress.md` §7, "PERMANENT") mandates it in Task 5's
scope; this decision only orders it after production wiring rather than bundled
into it, since both changes touch `FaChunkInput` and combining them would delay
production wiring's own landing for no Stage-1-lock benefit. **Reopen trigger:**
the next time work begins on `docs/work-in-progress.md` §11 item 1 (production
wiring) or item 6 (R-H second-baseline pass) — whichever lands first — R.5 (item
5) should be scoped concretely as the following slice, before Phase 4 begins.

**Superseded 2026-08-16 (owner ruling R4, WS1 Session A).** The "R.5 is not a
Stage 1 lock criterion" ordering decision above is reversed — R.5, together
with its newly-specified companion R.10 (scripted-text-never-spoken, `:1509`
above), is now a Stage 1 lock gate criterion (STAGE 1 LOCK GATE, `:3860`
above). Reasoning for the reversal: R.5/R.10 together address 4 of the 7
ear-pass failures found after this decision was originally written
(`docs/work-in-progress.md`'s 2026-08-16 root-cause diagnosis, items 4/5/10/
11) — locking Stage 1 with defects already known and scheduled for repair
two stages later is the exact pattern D.-1's hard rule and the Phase 3c
ruling already warn against. D25 B1's own finding above — the condition R.5
exists to handle remains reachable and silently-absorbed under the shipped
path — still holds and is why neither rule needed to ship before this
reversal was ruled; it means the reversal was safe to make late, not that it
should have stayed deferred indefinitely.
