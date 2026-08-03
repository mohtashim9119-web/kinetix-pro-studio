Status: Accepted architecture — pending implementation
Date: 2026-08-03
Verified-against-HEAD: 8587cac21eff7057fa0af78914ad2bf99a8fd859
Live status: see `project-state.md`'s Active Tasks for current phase progress.

## Phase Status

| Phase | Description | Status | Verified by | Date |
|---|---|---|---|---|
| 0 | Safety and instruments (backups, frozen transcripts, determinism check, inspector, verification set) | NOT STARTED | — | — |
| 1 | Delete the duplicated gap-fill in `alignScenestoTranscript` | NOT STARTED | — | — |
| 2a | Model swap — provision multilingual model, re-enable `-l auto`, per-project language override | NOT STARTED | — | — |
| 2b | Measure timing sources on the production model (turbo raw / turbo+DTW / large-v3 reference) | NOT STARTED | — | — |
| 3 | Upgrade the timing source (DTW or forced alignment, per Phase 2b's decision gate) | NOT STARTED | — | — |
| 4 | Restructure into four stages (Prepare / Align and Select / Place / Finalize and Report) | NOT STARTED | — | — |
| 5 | Replace the boundary picker with the fence (Part C's four-line rule) | NOT STARTED | — | — |
| 6 | Deprecate the compensation layer (`isBreathSilence`, seam exemption, contention assignment) | NOT STARTED | — | — |
| 7 | Observability (clamp/floor/fallback logging, `boundaryUsedFallback` argument-count fix) | NOT STARTED | — | — |
| 8 | Remaining known defects (hyphen asymmetry, pairIdx-20, adaptive silence thresholds, R5/N4 note) | NOT STARTED | — | — |

---

Sync Pipeline v2 — Final Architecture Plan
Status: Accepted architecture, pending implementation. Supersedes the 4-Stage proposal by adopting its structure with one ordering change and eight added safeguards.
Date: 2026-08-03
Verification model: manual, per phase, by the project owner. Automated tests are permitted only as change-detectors, never as evidence of correctness.
The one-sentence version
The proposal is right about the destination and wrong about the order: fencing the boundary picker to the token seam is the correct fix, but it cannot ship before the token timestamps are accurate enough for the fence to be built out of them. Fix the timing source first, then the fence works and half the pipeline’s complexity can be deleted.
Part A — What is actually broken, in plain language
Imagine you have a recording of someone reading a script, and you need to find the exact moment where sentence 4 ends and sentence 5 begins, so you can cut the video there.
Whisper gives you the words and a rough time for each word. The problem is that “rough” is worse than it sounds. When there’s a pause in the speech, Whisper often reports the next word as starting when the pause started, not when the word was actually spoken. The measured error is about 190 milliseconds on average, and on individual words it reaches 900 milliseconds. Nearly a full second.
So the app is trying to find a gap that is often 300ms wide, using measurements that are wrong by up to 900ms. That is like trying to park a car in a space narrower than your measurement error.
Everything else in the pipeline is a coping mechanism for this one problem. Fourteen tuned constants, five predicate functions, a three-pass contention-assignment algorithm, a breath detector with a coverage-ratio override, and an index-based seam exemption — all of it exists to guess around bad numbers. Each piece fixed one real project and then made the next fix harder.
And here’s the tell you found yourself: on audio with clear, obvious pauses, the 24 July build — which has none of this machinery — performs just as well as today’s build. All the complexity is invisible on easy audio and only load-bearing on hard audio. That is the signature of compensation, not of design.
The word-shift bug is the clearest symptom. When the picker can’t find a pause where it expects one, it widens its search to look further out. Its minimum search radius is 0.5 seconds in each direction. At normal speaking pace a word plus its following gap is roughly 0.4 seconds. So the picker is always permitted to reach at least one full word past the boundary — on every single cut, by construction. It usually doesn’t matter, because there’s no attractive pause one word over. In dense staccato script sections there often is, and it grabs it, and a word ends up on the wrong side. That’s your eleven cases.
The plan below removes the reason to guess.
Part B — The pipeline: four stages
Four stages, each with one job. The current pipeline has seven conceptual stages, two of which run twice on different arrays — the “5/6 interleave” — which is why fixes drift between two copies of the same logic.
One change from your proposal: the coverage partition moves out of Stage 3 and into the end of Stage 2. That way Stage 3 never receives a segment without real audio, so it never needs to check — its precondition is guaranteed by what it’s handed, not by a defensive branch inside it. This matters more than it sounds; the original middle-gap drift bug existed precisely because boundary logic ran on an array containing unmatched segments.

Stage 1 — Prepare
Turn the audio into words-with-times, and the script into words. Nothing else.
Transcode to 16kHz mono WAV. Transcribe. Get word timings from the best available source (this is the pluggable part — see Part C). Detect silences. Drop malformed tokens. Normalize text on both sides using the same normalizer.
Stage 1’s output is: an array of tokens, each with text, start, end; an array of detected silence intervals; the audio duration; and the script split into segments with normalized words.
Critical design decision: the source of word timings is behind an interface. Today it’s Whisper’s stdout timestamps. Tomorrow it may be DTW-refined timestamps or forced alignment. Everything downstream reads the same shape and does not know or care which produced it. This is what makes the timing upgrade a swap rather than a rewrite, and it’s what lets us measure a new source against the old one on the same project.

Stage 2 — Align and Select
Match script words to token positions. Decide which segments survive.
The global Hirschberg alignment runs once, unchanged. The three-pass rescue for zero-match segments runs, unchanged. The run-survival gates run, unchanged. Then the coverage gate decides whether to abort the whole sync, and the partition drops segments with no audio match.
Stage 2’s output is: the surviving segments, each carrying firstTokenIdx and lastTokenIdx — nothing else.
Critical design decision: Stage 2’s return type contains no time fields at all. No t0, no t1, no startTime, no duration. This is how the duplicated gap-fill is prevented from ever coming back — not by a convention or a comment, but because there is no field to write it into. If someone later tries to add boundary logic to Stage 2, the code won’t compile. The duplication you identified is a real architectural flaw, and a type is the only durable fix for it.
This means distributeSegmentTimes and applyAnchorBasedTiming no longer live here. Their two genuinely necessary behaviors — lock preservation and the backstop monotonic clamp — move into Stage 3 where timing is actually decided.

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
Look at those numbers. Whisper says the next segment starts at 289.200. The actual silence starts at 289.380 and runs to 289.960. Whisper’s reported start for A is before the pause even begins, and the real speech starts somewhere after 289.960. The reported timestamp is nearly 800ms early.
So the fence’s window is [289.090, 289.200] — 110 milliseconds wide, and it doesn’t overlap the real pause at all. The fence excludes the correct answer. Widening it by one full token on each side still excludes it, by 120ms. There is no fixed token-count tolerance that recovers this, because the smear crossed two tokens.
This is not bad luck at one boundary. Whisper’s error is directional — it systematically assigns a pause’s onset to the following word. So any window built from Whisper’s raw timestamps systematically undershoots on the right edge. Segment 96 is the expected case, not the exception.
Conclusion: the fence is correct architecture with an unmet prerequisite. It needs word timings whose error is small relative to the gaps it must resolve. Fix the timings and the fence works, the seam exemption becomes unnecessary, and roughly 60% of the sync pipeline’s code can be deleted rather than maintained.

The prerequisite
Three options, cheapest first.
Whisper’s own DTW. whisper.cpp can refine timestamps by dynamic time warping against its attention weights. Your build already passes --dtw base.en — and it has been a silent no-op the entire time, because flash attention is on by default and silently disables DTW. Turning it on requires -nfa, which in this build broke stdout printing, which is where both the tokens and the progress bar come from. Estimated result: ~190ms → ~80ms error.
Forced alignment. Throw Whisper’s timestamps away entirely. Take the known script text — which we already have, that’s the whole premise of this app — and align it to the audio at the phoneme level using a CTC acoustic model. This is what WhisperX does and it reaches roughly 20ms. It needs ONNX Runtime (mature Rust bindings exist) and a wav2vec2-CTC model of comparable size to the whisper model already bundled.
Neither, and live with a fence built on 190ms error. Honest assessment: this makes word-shift better than today (no more one-word reaches) but introduces a new failure where the fence excludes the real pause, exactly as at segment 96, producing cuts inside the pause’s leading edge. Better than today, not correct.
The plan measures option one before committing to anything, because it’s an afternoon of read-only work and it might be enough.

The safety property that makes this whole plan tractable
Changing the timing source does not change the text. The Hirschberg alignment is a pure text match. So Stage 2’s output — which script word maps to which token position — is invariant under Stage 1 timing changes. Alignment correctness, which the investigation already confirmed at 447/447 on V6, does not need re-verification when we swap timing sources.
With one exception, which is a genuine trap: filterMalformedTokens drops tokens based on their timestamps. Better timestamps mean fewer drops, which means the token array is longer, which means every token index shifts. On your 173-segment project, 30 of the 169 drops were timestamp-based.
This has a direct consequence for verification, covered in Part D and worth stating twice: the boundaries we verify must be identified by their words, never by their index. “Segment 96” will not mean the same thing after a timing upgrade. “The seam between ...look and A predator...” will.
Part D — Phases, in order, with the verification gate for each
One phase, one commit, one behaviour change, independently revertable. No phase begins until the previous one’s manual verification passes.

Phase 0 — Safety and instruments (no behaviour change)
Nothing in this phase touches the pipeline. It exists because every comparison we make later is worthless without it.
Back up both projects — V6 (447 segments) and the 173-segment project — via the console technique already documented, and store them outside the app. Both are needed; the curr-side false positive was only detectable on the second one.
Freeze the transcripts. Export each project’s token array to a file and add a way to load it back. Every A/B comparison from here on runs against a frozen transcript, so we are always comparing pipeline changes and never accidentally comparing two different transcriptions.
Verify determinism. Transcribe the same file twice and diff the tokens. If whisper-cli is not deterministic, every scored comparison in this project’s history is suspect and we need to know that now rather than discovering it as noise later. This is a one-time, blocking check.
Build the inspector. A read-only tool that dumps, for every boundary in a project: the committed cut time, the words on either side with their timestamps, every detected silence nearby, and the waveform amplitude at the cut. Output CSV. This is not a test — it is a tool that lets you check 40 boundaries in fifteen minutes instead of two hours, by telling you exactly where to look and what you should hear.
Define the verification set, keyed by words, not indices. The eleven ear-verified word-shift pairs, the eight seam-exemption pairs, the 173-project’s known-broken pairIdx-20 boundary, and roughly twenty randomly chosen controls that are currently correct. About forty boundaries. The controls are the important half — they’re what catches a fix that improves its targets while quietly breaking something else, which is how segment 60 slipped through as a false success.
Your verification: listen to all forty on the current build and record a verdict for each — correct, word-shifted, or clipped. This is the baseline every later phase is measured against. It is the only trustworthy number this project will have.

Phase 1 — Delete the duplicated gap-fill (expected: zero behaviour change)
The audit established that alignScenestoTranscript’s internal gap-fill is operationally redundant: snapCoveredBoundaries recomputes every boundary from token indices afterwards, nothing downstream ever reads t0/t1 again, the first segment’s start was never written by it anyway, locked segments were always excluded from it, and on the empty-token fallback path it early-returns before reaching the gap-fill at all.
Delete it. Delete the 29 tests that exercise it — they test a function proven not to affect output, and keeping them would block the deletion for no reason.
I’m reversing my earlier position on sequencing here. I previously argued for behavioural fixes before structural ones to preserve bisectability. The audit changed that: this deletion halves the code surface of everything we’re about to rewrite, and it is provably behaviour-neutral. Doing it first is strictly cheaper.
Your verification: resync both projects with the frozen transcripts. Every segment’s start and duration should be byte-identical to the Phase 0 baseline. If anything moves, stop — the redundancy claim was wrong and we need to understand why before proceeding.

Phase 2 — Measure the timing sources (read-only, no app changes) — see Part H (Multilingual Production Support) for the phase reorder (2a/2b) that supersedes this phase as originally written
Entirely outside the app. Run the bundled whisper-cli from a terminal against V6’s audio, three ways: current args as shipped; with -nfa --dtw base.en and JSON output; and if we want the ceiling, a forced-alignment reference.
For each, measure word-onset error against ground truth. Ground truth comes from ffmpeg’s silencedetect: a word that follows a pause must begin when the pause ends. This is the method already used in the investigation, and it produced the 190ms figure we’re trying to beat.
Decision gate. Under ~100ms median error, DTW is adopted in Phase 3. Above that, DTW is abandoned permanently and Phase 3 becomes forced alignment. This is one measurement that decides a week of work in either direction.
Your verification: none needed — this phase produces a number, not a behaviour.

Phase 3 — Upgrade the timing source — see Part H for the multilingual model swap (H.1-H.3) that this phase now runs against, not base.en
Whichever won. If DTW: switch the Rust side to JSON output, which the audit confirmed is new code rather than a flag flip, and replace the progress bar with an elapsed-time indicator since progress currently scrapes the same stdout lines that -nfa breaks. If forced alignment: bundle ONNX Runtime and the CTC model, implement the Viterbi pass, and slot it behind the Stage 1 timing interface.
Either way the interface is identical and the pipeline below is untouched.
Your verification: resync both projects. Expect boundaries to move. Listen to the full forty-boundary set. Record the new verdict. Some of the eleven word-shift cases may already resolve here, because the gaps become real. Some of the eight may regress, because the seam exemption was tuned to compensate for smear that no longer exists. Both outcomes are informative and neither blocks the phase — what blocks it is a control boundary regressing, because that means the new timings are worse somewhere we weren’t looking.

Phase 4 — Restructure into four stages (structural only, timing held identical)
Reorganize into the four stages of Part B. Move the coverage partition to the end of Stage 2. Make Stage 2’s return type timing-free. Collapse distributeSegmentTimes and applyAnchorBasedTiming into Stage 3, carrying forward their lock handling and backstop monotonic clamp. Rename the two colliding MIN_SEGMENT_DURATION constants to ENGINE_MIN_SEGMENT_DURATION_SEC and UI_MIN_SLOT_DURATION_SEC — rename, do not merge, do not change either value. syncConstants.ts documents the non-consolidation as deliberate and it is correct: one governs timing output, the other governs drag-handle UX, and 0.15 would silently move both.
The boundary logic in this phase is a move, not a change. Same algorithm, new location.
Your verification: resync both projects. Byte-identical to Phase 3. Any movement is a bug in the move.

Phase 5 — Replace the picker with the fence
Now it works, because Phase 3 gave it real gaps. Implement Part C’s four-line rule. Delete computeBoundarySearchWindow, isBoundarySilenceCandidate, fillsTokenGapWithinSpan, the three-pass contention assignment, and the degenerate-pair guard — the last one because an inverted gap is now handled explicitly by the rule’s third clause rather than by a 5-second escape hatch.
Keep isBreathSilence and the seam exemption for now. Do not delete them in the same commit. They exist to recover a pause outside the timestamp gap, which better timings should make impossible — but “should” isn’t “did.” They get their own deprecation phase.
Your verification: the full forty. The eleven word-shift cases should be zero, because theft is now structurally impossible. If any remain, the boundary was not the problem there and we need to look at the alignment span instead — the inspector will show which.

Phase 6 — Deprecate the compensation layer
Now the eight stop being a benchmark and become what they should have been: a regression check on a deletion.
Turn the seam exemption off. Resync. If the eight are still correct without it, delete isBreathSilence, the multi-fragment override, the seam exemption, and the four constants behind them. If any of the eight regress, the exemption is still load-bearing and stays — and we’ve learned something specific about where Phase 3’s timings are still insufficient, which is a real finding rather than an argument.
Your verification: the eight, plus the twenty controls.

Phase 7 — Observability
Every clamp, floor, fallback, degenerate boundary, and estimated-timing decision emits a log entry with a plain-language fix hint. The boundaryUsedFallback bug the audit found gets fixed here — it calls isBreathSilence with four arguments instead of five, defaulting the seam exemption off, so every boundary-quality reading on a seam-exempted pair has been wrong since it shipped. If Phase 6 deleted the exemption, this bug deletes itself.
Your verification: resync, read the log panel, confirm you can understand every entry without opening a source file.

Phase 8 — Remaining known defects, each separately — see Part H (H.5-H.6) for the language-keyed normalization and character-weight proportioning work this phase now also carries
The hyphen asymmetry: textNormalize.ts glues mid-call into one alignment word while Whisper emits two tokens, so neither matches and the segment’s end is understated. Six occurrences on V6, timing impact on one. This rewrites the alignment corpus on both sides and interacts with the deliberate NUMBER_WORDS carve-out, so it’s its own commit with its own re-listen of the set.
The 173-project’s pairIdx-20 boundary, currently pinned as a known defect at 75.660 against a correct target of 76.470 — likely resolved by Phase 5, verified here.
Adaptive silence thresholds, replacing the fixed −45dB scan, if Phase 3’s measurements show the fixed threshold is costing us.
The R5/N4 mid-line bracket split stays deferred — it needs a product ruling on the input format, not a code fix. Worth noting one interaction the docs don’t: a mid-line [laughs] creates a segment with no corresponding audio, which then enters the rescue path as a false-positive candidate. The forward-ordering bound handles it today. Under the new architecture it will simply fail the coverage gate and be dropped, which is the correct outcome.
Part E — Every way this plan can break, and how the architecture prevents it
This is the section you asked for, and it is the reason this document is long.
The fence reverts the eight. Prevented by ordering: Phase 3 before Phase 5, and Phase 6 as an explicit deprecation gate rather than a silent deletion. Proven with real segment-96 numbers rather than assumed.
A comparison is made against a different transcript. Prevented by Phase 0’s frozen transcripts. Without this, getFileIdentity — name, size, mtime — can silently invalidate on a re-stage and trigger re-transcription mid-programme, making two phases incomparable with no visible signal.
Index-keyed references break after Phase 3. Prevented by content-keying the verification set from the start. filterMalformedTokens drops on timestamps; better timestamps mean fewer drops mean every index shifts. Thirty of the 173-project’s 169 drops were timestamp-based, so this shift is certain, not hypothetical. Every existing reference to “segment 96” in every document becomes wrong at Phase 3.
whisper-cli isn’t deterministic. Caught by Phase 0’s double-transcribe. If it isn’t, we stop and reconsider the entire A/B method before spending a week on it.
Manual verification becomes too expensive to actually do. Prevented by the fixed forty-boundary set plus the inspector. Verifying 447 boundaries per phase is not going to happen, so a plan that requires it is a plan that gets skipped. Forty, content-keyed, with a tool pointing at exactly where to listen, is fifteen minutes.
A fix improves its targets and breaks something unwatched. Prevented by the twenty controls in the verification set. This is precisely how segment 60 was counted as a success — its corrupted boundary happened to land inside a detected silence, so a silence-containment metric scored it as improved. Controls are the only defence against a metric measuring the wrong thing.
Locked segments get moved. Locks are now checked in exactly one place — Stage 3, where all timing is decided. Today they’re checked in five places across two files. One place cannot disagree with itself.
Skipped segments change behaviour. Today filterToCoveredSegments drops uncovered segments entirely: five covered plus three uncovered commits five segments. That’s product behaviour, not an accident. Preserved explicitly in Stage 2, and stated here so nobody “fixes” it later.
Kept segments aren’t adjacent in the original array. After the partition, kept segments 5 and 9 are neighbours in the surviving array but had three dropped segments between them in the script. Stage 3 must treat the gap between them as a real gap and not assume contiguous original indices. Stated as a Stage 3 precondition.
The contiguity invariant breaks. Structurally impossible now: Stage 3 derives each duration as nextBoundary − thisBoundary, so start[i] + duration[i] === start[i+1] is arithmetic, not a property to be maintained by a post-hoc check. Today it’s enforced by an appended if that was added after overlapping cards appeared in the timeline.
The no-voiceover path breaks. Stage 3 has an explicit character-weight mode with the same output shape. Today this path fabricates a duration of five seconds per scene with no log entry saying the timeline length is invented; Stage 4 now logs it.
The silence-scan-failed path breaks. Distinct from “no silence found” — they have opposite consequences and the type system already keeps them distinct. Stage 3 falls back to gap centres and Stage 4 logs it. Sync continues; it never aborts on a failed scan.
Headings get disturbed. Headings are a separate top-level overlay layer with fixed absolute times and no participation in segment timing math. No stage touches them. Stated so the rewrite doesn’t quietly re-couple them.
Head and tail extension get lost in the move. Segment one stretches back to zero, the last segment runs to the audio end. Both are Stage 4, both explicit.
Two silences sit in one gap. Rule: longest silence, intersected with the gap, cut at the intersection’s centre. Deterministic and stated, so it isn’t decided ad hoc during implementation.
A silence extends beyond the gap on either side. Intersect first, then take the centre. Never cut outside the gap, even if the silence continues.
Progress reporting breaks at Phase 3. parse_progress_line scrapes the same stdout that -nfa breaks. Accepted, planned: elapsed-time indicator instead of percentage. A 21-minute transcription with no progress bar is a real UX regression, and it only lands if DTW actually wins the Phase 2 measurement.
The ONNX path is bigger than estimated. Mitigated by Phase 2’s decision gate — we only take that path if the cheap one measurably fails — and by the timing interface, which means the model is swappable and a failure there doesn’t strand the rest of the plan.
Better timings don’t fix word-shift. Possible, and handled: Phase 5’s fence removes theft regardless of timing quality, because it removes the permission to reach past a word. Phase 3 and Phase 5 attack the problem independently. If Phase 3 disappoints, Phase 5 still lands.
Some of the eleven turn out to be alignment errors, not picker errors. The investigation reports the aligner exonerated at 447/447, but doesn’t state how that was verified. The inspector’s output distinguishes the two directly: a wrong span shows as the wrong words attributed to a segment, a wrong cut shows as correct words with the cut misplaced inside a correct span. If any of the eleven are span errors, Phase 5 won’t fix them and we’ll know immediately rather than after a failed phase.
Rollback is needed mid-programme. One phase, one commit, one behaviour change. Any phase reverts alone.
A phase both fixes and breaks. Rule, stated now to avoid negotiating it under pressure: any regression on the verification set blocks the phase until explained. Not “net positive.” Explained. Every incident in this project’s history was a net-positive change with an unexplained regression inside it.
The plan itself becomes stale. Every phase updates CLAUDE.md’s invariants, project-state.md’s status, and this document’s phase status before the next phase begins. A stale architecture document is treated as a bug of the same severity as stale code.
Part F — Explicitly not doing
Not merging the duration floors into a single 0.15. They govern different concerns and the merge changes both values.
Not retuning any existing constant. Every one carries a documented calibration story derived from a specific production project; retuning without that project’s evidence is how the window-overlap regression happened. The plan deletes constants; it does not adjust them.
Not touching the Hirschberg alignment, the rescue passes, the forward-ordering bound, or the run-survival gates. The aligner is exonerated. Leave it alone.
Not resolving the R5/N4 bracket split. Product ruling, not a code fix.
Not using unit tests as evidence of correctness. They may exist as change-detectors — “this value moved, is that intended?” — and that is their entire permitted role. Three fixes shipped broken this month with green tests, because the fixtures used synthetic token geometry that real Whisper output never produces. Any test written from here on uses real token data from V6 or the 173-project, drives the complete pipeline including filterMalformedTokens, and is understood to be a tripwire rather than a proof.
Part G — What “100%” means, and why it’s reachable
Two numbers, because they’re different problems and merging them is how a real defect gets closed as acceptable.
Structural correctness — 100% is the bar and it’s achievable. No word on the wrong side of any cut. No silent clamp, floor, or fallback anywhere. Contiguity, monotonicity, and lock preservation hold unconditionally on every path including fallbacks. This is a logic property, provable by construction — Part C’s rule makes theft impossible arithmetically rather than statistically — and checkable on both projects. Every one of the four open bugs lives in this class.
Perceptual placement — 100% means every cut is either correct or correctly flagged. When the script genuinely doesn’t match the audio, there is no correct boundary, and pretending otherwise is what produces the worst failures. But with accurate word timings that case becomes detectable: a segment whose words don’t appear in the audio, or a seam with no gap at all, can be flagged rather than guessed. A flagged unknown is a solved case. That’s the honest version of your belief that every bug is fixable — the bugs are fixable, and the genuinely ambiguous inputs become visible instead of silently wrong.
The current 96.2% figure should be retired. It was measured as “the cut landed inside a detected silence,” which is one of the four metrics that lied this month — it scored a corrupted boundary as an improvement. Phase 0’s baseline replaces it with a number derived from your ears on a fixed, content-keyed set. That number will probably be lower than 96.2% and it will be the first trustworthy one this project has had.
Summary of changes from your proposal
Adopted essentially whole: the four-stage collapse, the removal of the duplicated gap-fill, the fence on the boundary picker, the elimination of silent fallbacks, and Objection 2’s principle that when there is no pause the correct behaviour is to cut at the seam and stop searching.
Changed: the fence moves from first to Phase 5, behind the timing upgrade, because segment 96’s real numbers show it reverts eight boundaries otherwise. The coverage partition moves from Stage 3 to the end of Stage 2. The floor consolidation becomes a rename rather than a merge. The hyphen fix becomes its own phase rather than a line item. Stage 2’s return type loses its time fields so the duplication cannot return.
Added: Phase 0’s safety and instrument layer; content-keyed verification; the determinism check; the frozen-transcript requirement; the timing-source interface; the seam-exemption deprecation gate; and the boundaryUsedFallback fix the audit uncovered.
Corrected in your proposal: the narrow-gap expansion you identified is real and verbatim in the code — but the <0.1s → 1.0s branch is not the main culprit. The Math.max(0.5, …) floor is, because a 0.5s minimum radius always reaches past at least one word at normal speech rate. Your instinct was right; the mechanism is one line over.

Part H — Multilingual Production Support

Requirement: native sync across a DEFINED set of production languages.
English-only binaries (base.en / small.en) are not viable.

H.0 SUPPORTED LANGUAGE SET — this scopes everything below
  Supported, must work perfectly: English, Spanish, French, Portuguese,
  Russian, German.
  All six are whitespace-delimited (five Latin script, one Cyrillic). All six
  are top-tier resource languages in Whisper's training data.
  EXPLICITLY OUT OF SCOPE: Chinese, Japanese, Thai, Vietnamese, and any other
  language without whitespace word boundaries; any RTL language. Not "untested"
  — descoped by product decision, because no content is produced in them.
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
  low-resource languages. All six supported languages are high-resource, so
  the narrowed scope makes this model choice SAFER, not riskier.

H.2 PHASE REORDER — this supersedes Part D's Phase 2 as written
  large-v3-turbo is a pruned-decoder distillation. whisper.cpp's DTW reads
  model-specific cross-attention alignment heads (hence a separate --dtw preset
  per model), and timestamp prediction lives in the decoder that turbo prunes.
  Therefore a DTW measurement taken on base.en does not describe turbo.

  Phase 2 splits:
    Phase 2a — Model swap. Provision the multilingual model, re-enable -l auto,
      store detected language per project, make it user-overridable (H.7).
      No timing-source change. English projects re-verified against the Phase 0
      baseline: boundaries WILL move (different model, different tokens); the
      gate is that the forty-boundary verdict does not get worse.
    Phase 2b — Timing measurement, ON THE PRODUCTION MODEL. Measure word-onset
      error three ways: turbo raw, turbo + `-nfa --dtw large.v3.turbo`, and
      large-v3 (non-turbo) as a reference ceiling. Ground truth = ffmpeg
      silencedetect, same method that produced the 190ms figure.
    Decision gate unchanged in form: under ~100ms median -> adopt DTW in Phase 3.
      Above -> forced alignment. Note the expected shift: turbo's weaker
      timestamp head makes forced alignment MORE likely to win, not less. If
      turbo's DTW is materially worse than large-v3's, that is an explicit
      accuracy-vs-speed product decision to be made with the number in hand.

H.3 Forced alignment, if Phase 2b triggers it
  Multilingual acoustic backbone (MMS / wav2vec2-multilingual), not an
  English-only wav2vec2. All six supported languages are well covered by MMS-FA,
  including Cyrillic via romanization.
  CORRECTION to the original spec: MMS forced alignment does not select a
  per-language phoneme set. It romanizes text to a shared token inventory
  (uroman) and aligns against one multilingual CTC head. So Stage 1's timing
  interface passes the language code to select a ROMANIZATION/TOKENIZATION
  strategy, not a phoneme inventory. Functionally similar, materially different
  to implement.

H.4 NO segmentation-strategy interface — plus the guard that replaces it
  All six supported languages are whitespace-delimited, so the whitespace split
  Stage 2 already relies on is correct for all of them. Do NOT build a
  per-language segmentation abstraction; it is speculative generality for a
  descoped case.
  REQUIRED GUARD instead: when the detected or user-set language is outside the
  supported six, the pipeline must WARN LOUDLY (a Stage 4 log entry at error
  severity, plus a visible banner) stating the language is unsupported and sync
  accuracy is not guaranteed. Rationale: whitespace-splitting a Mandarin script
  yields a handful of enormous tokens, and Hirschberg will align them into
  confident garbage with no other signal that anything is wrong. Silent
  degradation on an unsupported language is the one failure mode this narrowed
  scope introduces, and the guard is what closes it.

H.5 Language-keyed normalization (Phase 8) — THE MAIN MULTILINGUAL WORK ITEM
  textNormalize.ts's 13-step canonicalizer is English-specific. Under the
  narrowed scope the segmentation problem disappears but this one gets WORSE,
  because it silently inverts the D16 equivalence class it was built to serve:
    - Digit-run expansion reads "37" as "thirty seven". Spanish Whisper output
      is "treinta y siete". The script side canonicalizes to English words and
      the transcript side to Spanish words, guaranteeing a mismatch on every
      number in five of six languages. Needs per-language number words and
      reading rules, following exactly the existing D16 pattern (canonicalize
      BOTH forms to one, both directions, since Whisper emits digits sometimes
      and words other times depending on context).
    - Currency/symbol expansion ($ -> dollars) is English-only; needs per-language
      equivalents (EUR/euros, etc.).
    - THOUSANDS SEPARATORS ARE INVERTED: "1.234,56" in German/Spanish/
      Portuguese/Russian means English's "1,234.56". The current separator step
      actively mangles these. Not cosmetic — it corrupts the token.
    - French elision (l'homme, qu'il, j'ai): the apostrophe fold is safe only
      if symmetric; the English CONTRACTION EXPANSION list must not fire on
      French.
    - Russian needs an e/yo fold (Whisper frequently emits "е" where a script
      has "ё"). Cyrillic case folding via toLowerCase() is already correct.
    - The R1 NUMBER_WORDS hyphen carve-out is English-only by construction.
  GATE on this change: the English path must be provably byte-identical to
  today's, verified against the frozen English baseline. Every non-English rule
  is additive and language-keyed.

H.6 Character-weight proportioning — minor under the narrowed scope
  parseProjectData's character-weight estimate assumes characters approximate
  speech time. Across the six supported languages this varies roughly 15-20%
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
  Both current corpus projects are English. Required additions before Phase 2a
  ships, at minimum:
    - One Spanish or French project — French preferred for elision, Spanish
      preferred for number-word coverage; ideally one of each.
    - One Russian project — Cyrillic script, different acoustics, the e/yo fold.
  No CJK/Thai project is needed (descoped, H.0). The verification set may start
  English-only at Phase 0 and be populated before Phase 2a, but multilingual
  MUST NOT ship verified only against English — same class of error as scoring
  a fix against synthetic fixtures.

H.9 Open operational decision (not architectural — flagged for the owner)
  large-v3-turbo is ~1.6GB unquantized, ~574MB at q5. Current bundle ships a
  141MB base.en. Turbo wants roughly 2GB resident during inference alongside a
  WebView and a GL preview. This is a DMG-size and minimum-RAM decision and
  likely means download-on-first-use with a checksum rather than bundling.
  Record the decision here when made; do not assume one during implementation.

Part I — Reviewer Notes

Transcription-only pass; the following are flagged for the owner's attention, not corrected in the text above.

1. Part C's "Why it cannot ship yet" section states Whisper reports segment 96's word "A" starting at 289.200, before the confirmed silence [289.380, 289.960] even begins, and asserts the fence window [289.090, 289.200] "doesn't overlap the real pause at all." Taking these numbers at face value, 289.200 < 289.380 is correct and the non-overlap claim checks out arithmetically — no citation to a source file/line is given for these specific timestamps anywhere in the pasted plan, so this note only confirms internal arithmetic consistency, not that the numbers themselves are accurate. Flag for the owner: verify these figures against the actual V6 transcript/inspector output before treating them as load-bearing, since no `file:line` grounds them here (unlike the rest of `CLAUDE.md`'s convention of citing exact locations).

2. H.3's claim that "MMS forced alignment does not select a per-language phoneme set" and instead romanizes to a shared token inventory via `uroman` is presented as a correction to an unstated "original spec." No prior spec is included in this document for comparison, so the correction cannot be verified against what it's correcting — flagged as an orphaned reference, not a factual objection.

3. H.9's size figures (large-v3-turbo "~1.6GB unquantized, ~574MB at q5") and the "~2GB resident during inference" estimate are stated without a citation. `CLAUDE.md`'s existing convention for the ffmpeg/whisper binaries (`src-tauri/binaries/README.md` entries) gives exact file sizes with provenance (e.g. "76 MB, Intel macOS"). This addendum's model-size claims carry no equivalent sourcing — flag for the owner to confirm against the actual model file before this becomes a bundling decision.
