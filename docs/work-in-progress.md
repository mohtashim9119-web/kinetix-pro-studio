# Work In Progress

> **Purpose:** the active task ledger. Historically "one line per task, no narrative" —
> that rule stays the default for small/simple workstreams. **WS1 is the documented
> exception**: on 2026-08-14 its 29 scattered tracking/slice/decision/measurement files
> were consolidated here, into the structured §1–§11 tracker below, specifically so a
> single reader in a single file can reconstruct full WS1 status without following
> cross-references into files that no longer exist. Detail below this rule still avoids
> restating what the code or `git log` already shows — every claim carries a file:line or
> commit-sha citation, verified against the live tree during the consolidation pass
> (2026-08-14, `main` at `251be64` at pass start), not copied on faith from a deleted doc.
> On completion or abandonment, a block (or the relevant rows within one) moves verbatim
> to `docs/history.md` under a dated heading and is deleted here.
>
> **This is a summarization, not a lossless merge — stated plainly per the 2026-08-15
> close-out audit.** The 29 source files totaled 625,715 bytes (git show
> `251be64:<path> | wc -c`, summed); this tracker's WS1 section is 57,967 bytes — roughly
> 9% of the source material by byte count. Load-bearing conclusions, figures, and rulings
> were carried forward (verified line-by-line during the 2026-08-14 pass); narrative,
> intermediate reasoning, and superseded working notes were not. Full original text of
> every source file remains retrievable verbatim from git — §12 below is the per-file
> index with commit hash and copy-pasteable retrieval command for all 29.

> **Correction, 2026-08-15 close-out audit:** this document's own header and consolidation
> note (below) previously said "Part Z" for `sync-pipeline-v2-plan.md`'s append-only
> addendum — the addendum actually landed as **Part M** (`sync-pipeline-v2-plan.md:4410`,
> "Task 5 (Phase 3) Status Addendum"). Both occurrences below are corrected in place rather
> than left to mislead a reader who greps the plan doc for a section that doesn't exist.

---

> ⚠ **SINGLE-TRACKER RULE:** No additional tracking or status files may be created for
> Workstream 1. All task progress, slice outcomes, open decisions, and roadmap steps must
> be recorded directly in this file or appended to `sync-pipeline-v2-plan.md`.

---

## WS1 — Sync Pipeline Rewrite
Started: 2026-08-04 | Status: active | Consolidated into this single tracker: 2026-08-14

**Consolidation note.** This section replaces 29 files formerly under
`docs/ws1-sync-pipeline/`: `ws1-master-roadmap.md`, `task5-status-board.md`,
`task5-slice-ledger.md`, `task5-open-decisions.md`, `task5-integration-scope.md`,
`spanish-gate-scoring.md`, `d17`–`d25` design memos (9 files), `fa-text-to-spans-seam-d5-2026-08-12.md`,
`boundary-drift-investigation.md`, `context-report-2026-08-07.md`, `roadmap-2026-08-07.md`,
`ws1-readiness-2026-08-08.md`, `measurements/README.md`, and 8 `measurements/*.md` reports
(`d10`, `d11`, `d13`, `d14`, `d15`, `fa-vocab-representability`, `runtime-spike`,
`runtime-unblock`). Two files under `docs/ws1-sync-pipeline/` were deliberately **not**
deleted and are not restated here: `sync-pipeline-v2-plan.md` (the design/contract source
of truth — see its own append-only Part M, dated 2026-08-14) and `watcher-revert-2026-08-03.diff`
(a literal diff, not prose — remains the resumption pointer for task 7 below). Raw
`.csv`/`.json` measurement exports in `measurements/` and the `rescued-2026-08-07-model-p-park/`
evidence subtree are explicitly out of scope for this consolidation (data assets, not
tracking docs — `CLAUDE.md` §7 governs their location) and were left untouched.

---

### §1. Terminology & Stage Mapping

The plan document's real four stages (`docs/ws1-sync-pipeline/sync-pipeline-v2-plan.md:63-84`,
Part B):

| Stage | Name | Phases inside it |
|---|---|---|
| **Stage 1** | Prepare | 1b, 2a, 2b, 3, 3b, 3c, 3d |
| **Stage 2** | Align and Select | 4 (the structural restructure) |
| **Stage 3** | Place | 5, 6, 6b (the boundary "fence") |
| **Stage 4** | Finalize and Report | 7 (observability) |

**Task 5 (the MMS-FA/jonatasgrosman ONNX Rust engine, slices D1–D25) = Phase 3, which
lives entirely inside Stage 1.** Confirmed at `sync-pipeline-v2-plan.md:184` (phase table)
and restated with intent at the file's own append-only Part M below. There is no "Stage 3
= forced alignment" and no "Stage 4 = production integration/UI/release" anywhere in the
source plan — Stage 3 is the boundary-picker replacement (not started), Stage 4 is
clamp/floor/fallback logging (not started). State this once here so no future session
re-derives or re-invents the wrong mapping.

---

### §2. Master Stage Board

**Current truth: 0 of 4 stage locks passed** (`ws1-master-roadmap.md:166` at time of its
deletion — re-derived and confirmed here directly from `sync-pipeline-v2-plan.md`'s own
lock-gate text, not copied from the deleted file uncritically).

| Stage | Lock-gate text (plan.md line range) | Criteria | Met? | Evidence | Blocker |
|---|---|---|---|---|---|
| **1 — Prepare** | `:3820-3826` | Contract IN + 1→2 verified guarantee-by-guarantee; inspector run on ≥1 tight-pause + ≥1 long-pause project, thresholds met; determinism check passed; non-English corpus resolved or accepted in writing; no Stage 1 defect deferred downstream; cross-cutting regression checklist (D.-1) clean | **NOT MET** | Phase 0/1b/2a/2b done; Phase 3 (Task 5) dev-only, not production; **Phase 3c CLOSED 2026-08-15** (qi-bookkeeping sub-items DONE; hyphen-asymmetry CLOSED by written acceptance, no code change — `sync-pipeline-v2-plan.md`'s Phase 3c entry) | (a) smear thresholds still unmet until Phase 3 production-lands; (b) fr/de/pt corpus absent (Spanish partially accepted, reopens once Phase 3b ships Spanish-specific code); (d) Contract IN/1→2 verification not run; (e) regression checklist not run — see §3. Phase 3c is no longer a blocker |
| **2 — Align and Select** | `:3843-3846` | Contract 2→3 verified (timing-free type, partition order, skip semantics pinned); R6/R10/R12 closed or accepted in writing; regression checklist clean | **NOT MET** | Only the neutrality-exempt Phase 1 sub-item shipped (deleted a redundant gap-fill in `alignScenestoTranscript`, `whisperService.ts:1342`) | Phase 4 (the literal restructure) not started — blocked on Stage 1 lock |
| **3 — Place** | `:3863-3867` | Contract 3→4 verified (fence-inside-gap, contiguity-by-arithmetic, single lock-handling site, no clamps); `pairIdx-20` closed or accepted; the 8 seam-exemption cases + 20 controls hold; regression checklist clean | **NOT MET** | Nothing shipped | Phases 5/6/6b not started — blocked on Stage 1 + Stage 2 locks |
| **4 — Finalize and Report** | `:3875-3880` | Contract OUT verified (severity taxonomy, gap list); 6-question reader rubric passes; 96.2% figure retired in favor of `verification-baseline.csv`; regression checklist clean; all standing docs updated | **NOT MET** | Nothing shipped | Phase 7 not started — blocked on Stage 1/2/3 locks |

---

### §3. Master Phase Board

| Phase | Stage | Status | Owner | Blocking dependency | Evidence |
|---|---|---|---|---|---|
| 0 | pre-stage | **DONE** | — | — | `sync-pipeline-v2-plan.md:207` |
| 1 | 2 (neutrality-exempt) | **DONE** | — | — | `alignScenestoTranscript` gap-fill deleted, byte-identical harness pass; `whisperService.ts:1342` |
| 1b | 1 | **DONE** | — | — | Transcript Inspector, both corpus projects, 2026-08-04 |
| 2a | 1 | **DONE** | — | — | Multilingual model swap, 38/44 verified |
| 2b | 1 | **DONE** | — | — | DTW measured zero effect, permanently abandoned |
| **3 (= Task 5)** | 1 | **PRODUCTION PATH WIRED; gate PER-PROJECT, DEFAULT REVERTED TO OFF** (WS1 Session H, value-only revert of R-AK's ON) | — | **SUPERSEDED 2026-08-18 (WS1 Session I, owner rulings 2 and 4): the two blind 12/12 passes are replaced by ONE exhaustive mover audit (`stage1-mover-audit.md`, 24 rows — every never-scored and structurally-derived mover plus a 10-row blinded control arm), with the owner's live walkthrough serving as the second independent pass.** **2026-08-18 (WS1 Session J): the logging blocker is CLOSED** — rule-firing / engine / FA-fallback entries ship, so the acceptance run can produce durable evidence of what the rules did; the audit's I4 exit is ratified and the 24-row list is drawn, verified against HEAD and ready to score. **2026-08-18 (WS1 Session K): the 24 rows WERE scored — 22/24.** Both failures were root-caused. Clip 1 (173 `protection_failure` 603.69) is **NOT a defect** — it is the exact midpoint of the FA gap between two confidence-1.000 words at a scripted mid-sentence split with no detected silence in [598.04, 604.82]; the owner verified it CORRECT in the app and ruled such rows STAY in future ear draws. Clip 12 (v6 `225_night_scouts` 667.47) IS a defect and is fixed by **R.13**, the closing half of R.12 — blast radius 1 of 649. A THIRD, independent defect was found while tracing the index convention: R.11's log entries carried a PARSE index while R.12's carried a COMMITTED one, both rendered as "Scene N", so on 173 the Sync Log named `abysmal_opinion` scene 6 for a scene the timeline shows as scene 5 — display-only, no committed value affected, now fixed and machine-checked (ruling **R-AO**). **Remaining gate to the run: the owner scoring `stage1-session-k-ear-list.md`'s 28 rows.** `faGate.ts`'s `FA_PROJECT_DEFAULT_ON` doc comment still carries the pre-Session-I wording and should be re-worded when the flip is next attempted — note that the STALE COPY of its value in `types.ts` is fixed and can no longer drift (`faDefaultDrift.test.ts` fails the build on any disagreeing restatement in `src/`) | D1–D25 shipped (D7 cancelled), `fa-inference` feature OFF by default. `fa_align_production` (`fa_production.rs`) is a real, reachable, gated production caller. 2026-08-17 (WS1 Session G): the gate moved from a per-MACHINE `uiStateStore` key to the per-PROJECT `Project.faHighPrecisionSync`, default OFF → ON (owner ruling R-AK, resolving F6). **2026-08-18 (WS1 Session H): R.12 (the atomic-run invariant, `faRunPlacementGate.ts`) landed and closed nine defects it found on v6 — none visible to any rule built before it — and the default was reverted ON → OFF, value-only.** Everything R-AK built (per-project field, absent-key semantics, G1 proof, migration handling, fail-clean precheck) is unchanged; see `faGate.test.ts` for the re-pinned assertions. Golden replay 6/6, unchanged |
| 3b | 1 | **DONE, 2026-08-15 — PHASE CLOSED** (Rules 1-5 done — French elision, Spanish cardinals 0-30, German cardinals 0-30, Portuguese cardinals 0-20/30 PT-BR, French cardinals 0-30 minus 21; currency/thousands-separator expansion, Portuguese 21-29, and French 21 PERMANENTLY out of scope, decision (b)) | project owner (assigned 2026-08-15) | — | Language-keyed normalization (fr/de/pt contractions, numbers, currency) — see `sync-pipeline-v2-plan.md`'s H.5 decision block for the full per-rule classification |
| 3c | 1 | **CLOSED, 2026-08-15 — PHASE FULLY CLOSED.** The two reassigned qi-bookkeeping sub-items (diacritic-preserving fold, thousands/decimal separator inversion) are DONE (prior pass). The phase's original scope, hyphen-asymmetry, is CLOSED BY WRITTEN ACCEPTANCE, no code change — owner ear-test confirmed the only measured effect of fixing it (V6 seg 150, 457.83→458.12) is a regression, so it is accepted as a documented Stage 1 defect under D.-1 criterion 3 rather than fixed | project owner (assigned 2026-08-15) | — | Written acceptance ruling: `sync-pipeline-v2-plan.md`'s Phase 3c entry (measured scope 19 compounds/8 clean-fixable/1 boundary-affecting; mechanism — anchored-only midpoint, no silence snap; ear-test result; revisit trigger = Phase 5 fence changing this seam's anchor derivation). qi-bookkeeping fixes: `canonicalize()`'s language-gated `languageCode` parameter, prior changelog entry |
| 3d | 1 | **SKIPPED** | — | Reopens only if Phase 3's post-FA measurement shows a silence-side cost | Phase 2b's own finding: fixed −45dB threshold isn't the binding constraint (spot-verified against a waveform; failure is entirely token-side) |
| 4 | 2 | **NOT STARTED** | — | Stage 1 lock | Restructure into 4 stages; timing-free Stage 2 return type; 5+3→5 change-detector |
| 5 | 3 | **NOT STARTED** | — | Stage 1 + 2 locks; heading-wildcard Option A logic (decided, not coded) | Replace `computeBoundarySearchWindow`/`isBoundarySilenceCandidate` with the fence |
| 6 | 3 | **NOT STARTED** | — | Phase 5 | Deprecate `isBreathSilence`/seam exemption/contention assignment, conditional on the 8 seam cases surviving without it |
| 6b | 3 | **NOT STARTED** | — | Phase 5 | Verify 173-project's `pairIdx-20` boundary defect |
| 7 | 4 | **NOT STARTED** | — | Stage 1/2/3 locks | Observability: clamp/floor/fallback logging, `boundaryUsedFallback` 4-arg bug fix |

**2026-08-16 (WS1 Session B.1) — NOTHING ON THIS BOARD ADVANCES EITHER.** Stated
explicitly, same as Session B below and for the same reason: owner ruling R-AA narrowed
R-U's seam definition (16 moved boundaries → 4) and changed real production code in
`faAnchors.ts`, but Phase 3/Task 5 stays **"PRODUCTION PATH WIRED, gate OFF"** — the FA
gate is still OFF by default and neither R-X tier has been listened to, so no exit
criterion moves. No other row changes. `snapBoundaries.ts` was again not touched, so §3
row 2 (Task 2, 50/50 silence-split) is again unaffected.

**2026-08-16 (WS1 Session B) — NOTHING ON THIS BOARD ADVANCES.** Stated explicitly rather
than left to inference: owner ruling R-U (the zero-seam rejection rule) landed real
production code in `faAnchors.ts` and moved 16 committed FA boundaries, but Phase 3/Task 5
stays **"PRODUCTION PATH WIRED, gate OFF"** — the FA gate is still OFF by default and
neither R-X tier has been listened to, so no phase's exit criteria are met. No other row
changes either. The one row-adjacent fact worth recording: §3 row 2 (Task 2, 50/50
silence-split) is unaffected — `snapBoundaries.ts` was not touched this session.

**2026-08-17 (WS1 Session E) — NOTHING ON THIS BOARD ADVANCES. Stated explicitly.** R.10
(scripted-text-never-spoken) was BUILT and landed real production code in a new service,
`src/services/faUnspokenGate.ts`, closing ear-pass items 10 and 11 and changing 3 committed
FA boundaries. Phase 3/Task 5 nevertheless stays **"PRODUCTION PATH WIRED, gate OFF"**:
ruling R-AD keeps the FA default flip as the final act of Stage 1, released only by an EMPTY
Zero-Defect Register, and the register still holds **3** open entries — all R.11, all
Session F's. No other row changes. Row-adjacent facts: §3 row 2 (Task 2, 50/50
silence-split) is unaffected — `snapBoundaries.ts` was not touched; `faAnchors.ts` is
byte-identical (sha256 `b61e94cb…`); and `faChunkPlan.ts` production code is untouched too,
which the gate proves independently by all three chunk digests being unchanged.

**2026-08-17 (WS1 Session D) — NOTHING ON THIS BOARD ADVANCES. Stated explicitly.** R.5
(unscripted-audio) was BUILT and landed real production code in `faChunkPlan.ts`, closing
ear-pass items 4 and 5 and moving 8 committed FA boundaries. Phase 3/Task 5 nevertheless stays
**"PRODUCTION PATH WIRED, gate OFF"**: ruling R-AD keeps the FA default flip as the final act
of Stage 1, released only by an EMPTY Zero-Defect Register, and the register still holds 5 open
entries. No other row changes. Row-adjacent facts worth recording: §3 row 2 (Task 2, 50/50
silence-split) is unaffected — `snapBoundaries.ts` was not touched; and `faAnchors.ts` is
byte-identical (sha256 `b61e94cb…`), which the replay gate proves independently by its
`anchorDigest`/`runDigest` being unchanged on all three corpora.

**2026-08-16 (owner ruling R4, WS1 Session A):** R.5 (unscripted-audio wildcard, row "3" above
via §7 item 2) and its newly-specified companion R.10 (scripted-text-never-spoken,
`sync-pipeline-v2-plan.md`) are now pulled into Stage 1's own lock gate — see §11 item 13's
amended dependency list and `sync-pipeline-v2-plan.md`'s STAGE 1 LOCK GATE. Neither changes
status in this row (Phase 3/Task 5 stays "PRODUCTION PATH WIRED, gate OFF"); this is a Stage-1
lock-gate criteria change, not a Phase 3 implementation change.

**2026-08-16/17 (WS1 Session C): NOTHING ADVANCES on this board — stated explicitly.** The
ear pass closed and both R-X tiers passed, which discharges R-S(i)/R-X Tier 1 and Tier 2 as
*acceptance criteria* — but Phase 3/Task 5 stays **"PRODUCTION PATH WIRED, gate OFF"**, and
no other row changes. The reason is ruling **R-AD**: the FA default flip is deferred to the
final act of Stage 1, gated on an empty Zero-Defect Register (5 open entries today), so
passing the listening bar does not by itself move any phase. §3 row 2 (Task 2, 50/50
silence-split) is again unaffected — `snapBoundaries.ts` was not touched. The only committed
code change this session is `scripts/phase4-fa-replay.test.ts` (the register).

**Other WS1 tasks, outside the phase/stage numbering** (carried from the pre-consolidation
ledger, still live):

| # | Task | Status | Note |
|---|---|---|---|
| 1 | Apply Sync history-entry fix | **DONE** | commit `1b16a50` |
| 2 | Slice 2 — re-derive the 50/50 silence-split rule | **NOT STARTED** | `snapBoundaries.ts` + Apply-Sync plumbing, park-commit `210855d`, against current `main`. Will deliberately break the golden replay — budget a per-boundary review, never a blind re-baseline |
| 3 | Verify stale-anchor scroll degradation with a dedicated test | **NOT STARTED** | currently asserted correct by code reading only |
| 4 | Word-shift defect — 2 remaining v2-fixable cases | **NOT STARTED**, not standalone work | Expected to resolve as a side effect of Task 5 landing production timing; the 3rd case (`seasons than you‖can count and`) is a script-vs-narration authority conflict, unfixable by any timing-source change. Evidence: `boundary-drift-investigation.md` (deleted this pass — see conclusion note below) |
| 6 | Resume Pipeline Contract Program | **BLOCKED**, behind task 5 | Part J, `sync-pipeline-v2-plan.md` |
| 7 | Re-attempt the boundary-quality watcher | **REFERENCE-ONLY** | prior attempt reverted (safety-bound failure, React render loop, uncalibrated formula); resumption pointer `docs/ws1-sync-pipeline/watcher-revert-2026-08-03.diff` — not source to reintroduce as-is |
| 8 | K13 fix — lock preservation across resync | **DONE, 2026-08-11** | Owner ruling R-C: fixed fresh against `main`. `preserveSegmentLocks` (`App.tsx`) restores `locked`/`startTime`/`duration` by `assetId` after `autoMatchSegments`/`preserveEffectFields`, validated against `findPartitionViolations`. Verified: 11 unit tests (`preserveSegmentLocks.test.ts`), inverted `scripts/phase4-step-w-k13-repro.test.ts` (3/3), 5 manual tests |

**Correction found during this consolidation pass:** the pre-consolidation WIP doc listed a
"Stuck `resizingId` on an early-bail drag start (`src/services/dragSession.ts`)" bug inside
the WS1 block. `dragSession.ts` is a WS2 (editor/drag) module, not WS1 (sync pipeline) —
per `CLAUDE.md`'s own architecture map, `dragSession.ts` is Timeline/drag territory,
unrelated to sync timing. That entry was misfiled under WS1 and is **not** carried forward
into this WS1-dedicated tracker; it is not lost (`git log` on the old file preserves it),
but it needs its own home — a WS2 block, which doesn't currently exist in this doc —
before it's fully accounted for. Flagged rather than silently dropped or silently kept
under the wrong heading.

**`boundary-drift-investigation.md`'s conclusion** (deleted this pass, content folded here
since task 4 above still cites it): its own DO-NOT-RE-INVESTIGATE list — DTW (confirmed
dead twice over, see Phase 2b above), `--vad` (needs an unbundled model, not pursued), the
curr-side seam-exemption variant (confirmed unsound on real data twice, permanently
disabled), FENCE/QUIET as word-shift fixes (both tried, both failed structurally), and the
"246 PICK-WRONG" figure (overcounts by ≥45; only 11 ear-verified cases are trustworthy).
The plan document's own Part L (`sync-pipeline-v2-plan.md`) partially contradicts this
document's "aligner is exonerated, defect is picker-only" conclusion — the aligner's spans
can be correct while the timestamps those spans point at are not; both can hold at once.

**2026-08-16, WS1 Session A.5 — NO PHASE ADVANCED THIS SESSION.** Stated explicitly rather
than left to inference: every row of this board is unchanged. The session was feasibility
and instrumentation only (R-R buildability, FA-gate mutation test, blast-radius sizing,
fixture hygiene, doc integrity). Phase 3 does not advance because Session B — the
`findAgreeingSilence` rewrite — is now blocked on an owner ruling, not on engineering time;
see §11 item 6's ADDENDUM 4 and `sync-pipeline-v2-plan.md`'s "R-R FEASIBILITY FINDINGS"
block for the open question. No `src/`/`src-tauri/` behavior-bearing file changed.

**2026-08-18 (WS1 Session M) — the Task 5 row's status text ("PRODUCTION PATH WIRED") is
now KNOWN TO HAVE NEVER RUN IN THE APP.** Every FA measurement/fixture in this board and the
plan document was produced through the `cargo test`/spike-driver path, which set
`ORT_DYLIB_PATH` outside the app's control; the app itself never set it, so
`load_session` failed on line one of every in-app attempt and every run fell back to
Whisper timing. R-N (Session G's ruling, `sync-pipeline-v2-plan.md:2641`) is now
IMPLEMENTED — the onnxruntime dylib is bundled as a real Tauri resource and the app resolves
it itself, no shell dependency, nothing resolving into `.work-phase4/` (two new guard tests
lock the class shut). The FA-fallback entry now surfaces the underlying error verbatim
instead of discarding it; auto-detect is fixed (Whisper's detected language now reaches the
gate); a pre-flight readiness check reports capability/language/model/runtime up front. Full
detail: this document's own Changelog entry and `sync-pipeline-v2-plan.md`'s new "WS1 SESSION
M" section. **No phase on this board moves** — Task 5 stays "PRODUCTION PATH WIRED" as a
description of the CODE PATH's shape, and that description was already correct; what changes
is that the path can now actually execute, which the live acceptance run (owed, Steps 5-6)
must confirm before any fixture-based claim elsewhere in this document is trusted at face
value.

---

### §4. Phase 3 (Task 5) Component Ledger

Re-verified live against `main` during this consolidation pass (2026-08-14). Status values:
`done-and-verified`, `in-progress`, `not-started`, `closed-negative` (built, measured,
deliberately removed).

| Component | File:line | Status | Evidence |
|---|---|---|---|
| ONNX forward pass | `src-tauri/src/fa_onnx.rs:264` (`run_forward_pass_with_session`), `:300` (`run_forward_pass`) | done-and-verified | 0/577 argmax mismatches vs. real jonatasgrosman ONNX models, 3 fixtures |
| Text normalization (Rust port) | `src-tauri/src/fa/text.rs:435` (`normalize_for_forced_alignment`) | done-and-verified | Unconditional (not feature-gated), byte-identical port of `src/services/faTextNormalize.ts`; 36 corpus entries, all 5 languages |
| Viterbi DP / char→word merge | `src-tauri/src/fa_viterbi.rs:140` (`forced_align`), `:275` (`merge_tokens`); `fa_onnx.rs:570` (`merge_char_spans_to_words`) | done-and-verified | Zero-tolerance e2e parity vs. real torchaudio, all 5 languages, 0 divergences |
| Frame→time conversion | `fa_onnx.rs:397` (`frame_to_seconds`) | done-and-verified | stride = 320 samples/16kHz, sourced from all 5 languages' own HF `config.json`, byte-identical before being written as a constant |
| Chunked windowing (execution) | `fa_onnx.rs:768` (`align_chunked_for_language`), `:875` (`align_chunked`) | in-progress | D11 built real per-chunk execution on top of R.0/R.1/R.4 (landed in TS at D1, `faAnchors.ts`). R.3/R.7–R.9 remain design-only in `sync-pipeline-v2-plan.md`. R.2 closed-negative (below). R.5 not-started-but-reachable (below) |
| Model caching | `fa_onnx.rs:688` (`CachedSession`), `:700` (`with_cached_session`) | done-and-verified | One loaded ONNX session per `(language, resolved model path/size/mtime)` key, reused across every chunk in a run and across later in-process calls, evicted only on key mismatch |
| Cancellation | `fa_onnx.rs:884` (checked before chunk 0), `:896` (before every subsequent chunk) | done-and-verified | Returns `Err(FaOnnxError::Cancelled)` immediately, no partial word list; deterministic test proves it stops mid-loop, not merely "eventually" |
| Index attribution (`qi`) | `src/services/faChunkPlan.ts:247` | done-and-verified | `'script-word-index'` is `computeFaChunkPlanWithAttribution`'s own internal default since D22 (`a013329`); 0/1643 fallback fires on the real 709s corpus (regression-guarded), down from 2/97 CTC-infeasible chunks under the prior `segment-start-time` default |
| Word-timing schema | `src-tauri/src/fa.rs:288` (`FaWordSpan`, index-keyed struct), `src/services/faBoundaryTypes.ts:132` (`faWordSpansToTranscriptTokens` reshape) | done-and-verified (**no production writer**) | One caller anywhere in the codebase: `src/App.tsx`'s DEV-only `__faDevAlign` harness (`invoke('fa_align_dev', ...)` at `App.tsx:3598`) — zero production `invoke('fa_align')` calls exist |
| R.7 confidence flag | `fa.rs:303` (`const CONF_MIN: f32 = 0.3`), `:322` (`needs_review: confidence < CONF_MIN`) | in-progress | Flag built and wired (D19). Two of R.7's three failure paths (skip-and-flag on non-fitting text; force-split LOW-CONFIDENCE marking) remain unbuilt. No fixture in the repo exercises a genuine sub-0.3 case — every committed e2e fixture's `exp(score)` sits in [0.730, 1.0] |
| Durable 16kHz WAV cache | `fa.rs:736` (`ensure_durable_wav`), `:591` (`evict_lru_until_under_cap`), `:516` (2 GiB cap rationale) | done-and-verified (built + live-wired; **still no production caller**) | Wired into `fa_align_dev`, live-verified against a real `AppHandle<Wry>` (D25 A1, `src-tauri/tests/fa_durable_wav_live.rs`) — cache path matches production's `app_local_data_dir()` exactly; cache hit 1538× faster, byte-identical |
| R.2 (padding) | — | **closed-negative, deleted** | D23 built `align_chunked_with_padding`/`FA_R2_DEFAULT_PADDING_SEC` (0.5s default). D24 measured net-unfavorable (below-CONF_MIN tail 155→164, seam concentration 83.9%→85.4%) and falsified the smear hypothesis it was built on (0/236 edge-word checks show a timestamp escaping its own chunk's window — architecturally impossible). Deleted, not left as dead code — confirmed by direct grep, zero hits |
| R.5 (wildcard) | — | **not-started, reachable** | No wildcard/star-token mechanism exists anywhere in `fa_viterbi.rs`/`fa_onnx.rs` (grepped). D25 B1 scoped reachability only: **verdict (i) — still fully reachable** under index attribution (172 segments across 118 real chunks means most chunks already concatenate multiple segments' text). Destination is decided (R-E: "Model P outranks R.5," the wildcard span is assigned to the preceding segment) — what's open is *whether/when* to build it (§7, item 2) |
| R.1/R.4 | `src/services/faAnchors.ts` (`computeFaAnchors`) | done-and-verified | Implemented at Slice D1, ruled by R-O (anchor admissibility test) / R-P (force-split selection) |
| R.3/R.8/R.9 | — | design-only | `sync-pipeline-v2-plan.md`'s Step R (`:1447-1460`, `:1535-1567`) — no owner decision blocking, genuinely just unbuilt |
| Capability gate | `src/services/faGate.ts:69` (`isFaGateOpen`), `ProjectSettingsModal.tsx:18,172` | done-and-verified (**inert, OFF by default**) | `isTauri()` runtime probe AND a persisted `faHighPrecisionSyncEnabled` toggle, default OFF, combined. Own header states "NOTHING RUNS BEHIND THIS GATE YET" — zero call sites in `App.tsx`/`src/hooks/` |
| IPC registration | `src-tauri/src/lib.rs:144-146` | done-and-verified | `fa::fa_align`, `fa::fa_cancel`, `fa_dev::fa_align_dev` all registered in `invoke_handler!` since D1's command skeleton |
| `FaEvent` streaming | `fa.rs:372` (enum), `:807/:822/:827` (Progress/Done/Error emission); TS mirror `src/services/faBoundaryTypes.ts:64` | done-and-verified (backend); **no production consumer** | Mirrors `whisper.rs`'s `WhisperEvent` pattern. Grepped `src/hooks/` and `src/components/` for a consumer — none exists; only the DEV harness in `App.tsx` reads it |
| Production writer | — | **not-started** | Grepped: no `invoke('fa_align')` call exists anywhere in `src/` outside the DEV-gated harness. No Apply-Sync path calls `fa_align` for real segment timing |
| CI ORT matrix | `.github/workflows/fa-ort-matrix.yml` | done-and-verified | Runs on push/PR touching the FA Rust surface; green on all 4 cells, confirmed non-flaky by a second independent run |
| Production `AppHandle` coverage | — | in-progress | D10 exercised a real `AppHandle` only via `fa_align_dev`. D25 A1 extended this to the durable-cache path specifically via `tauri::test::mock_context`. Still missing: a non-dev, capability-gated command reachable from the live running app |

---

### §5. Full Slice Ledger (D1–D25)

Source: `task5-slice-ledger.md` §1 (deleted this pass; table reproduced in full below —
nothing compressed away). All commits dated 2026-08-12 except D10 onward (2026-08-13/14).

| Slice | What it built | Commit(s) |
|---|---|---|
| D1 | Foundation, two parallel tracks: TS-side `faAnchors.ts`'s pure `computeFaAnchors` (R.0/R.1/R.4, ruled by R-O/R-P), unwired; Rust-side `fa_align`/`fa_cancel` command surface (typed `NotImplemented`, no model) + Viterbi DP port + FA text-normalizer foundations | `7f74c39`, `e0c9c89`, `5f4f0da`, `42bd708`, `9f70f8f`, `fc0e756`, `0589239`, `eda3f7d`, `4b64c28`, `9461c0a`, `49b0acd`, `6a0ac21` |
| D2 | Real ONNX forward pass wired into `fa_align` behind OFF-by-default `fa-inference` feature (`ort = "=2.0.0-rc.13"`); 0/577 argmax mismatches vs. real jonatasgrosman models | `49e233a` |
| D3 | Vocab-aware FA text normalizer ported to Rust (`fa/text.rs`, unconditional), replacing D2's ASCII placeholder; hand-rolled ~54-entry NFC table + ECMA-262 `\s`-set whitespace split (two deliberate, tested deviations from a literal port) | `997102e` |
| D4 | `FA_REQUIRE_ORT=1` skip hardening; re-ran D2's parity tests for real post-D3 (0/577, unchanged); NFC-completeness guard vs. an independent 230-entry table; first end-to-end parity harness — **0 divergences, zero tolerance, all 3 fixtures, 73 combined tokens/spans** | `e1f6e57` |
| D5 | Closed the text→spans seam (already closed at `e1f6e57` for en/es, re-verified live); extended zero-tolerance e2e parity to fr/de/pt using real `google/fleurs` (CC-BY-4.0) audio, owner-approved after the private corpus was confirmed to lack fr/de/pt material | `c7834cd` |
| D6 | Frame→time conversion (stride=320 samples/16kHz, sourced from all 5 languages' HF `config.json`); closed `EmptyTokenization`, missing-dylib `OrtInit`, and a live TS/Rust `FaErrorKind` drift (`'inferenceFailed'` was missing from the TS union) | `b879ed5` |
| D7 | **CANCELLED as scoped — not completed.** No commit exists under this name (Step 0 review found the originally-planned work already done elsewhere or built on an invalid reference); Slices D8–D10 shipped the remaining planned scope under their own numbers | — |
| D8 | Pure `merge_char_spans_to_words`: character-level `TokenSpan`s → word-level spans on the vocab word-delimiter id. Established (later formalized as rulings, see below) that `TokenSpan.score` is a mean log-probability, not directly comparable to `CONF_MIN`, and word-level score is frame-length-weighted, not unweighted. No IPC/`FaEvent`/TS change | `20588db` |
| D9 | Wired D8's word-merge into the real `fa_align` path: returns `Vec<WordSpan>`; `FaEvent::Done{words}` DTO applies `exp(score)` at the IPC boundary. TS `TranscriptToken` gained optional `confidence`; `faWordSpansToTranscriptTokens` reshape added — established but unwired | `49dce01` |
| D10 | Live-`AppHandle` composition trace confirmed the full typed chain lines up, with one real gap: nothing in production leaves a durable WAV on disk. Closed with DEV-only `fa_align_dev`; added a pre-use SHA-256 model-manifest check; **fixed a real bug**: `fa_align`'s error arm was flattening every `ModelNotFound` into generic `InferenceFailed`. Produced the memory/duration ladder (§6 below) | `3787b11` |
| D11 | Replaced infeasible whole-file `fa_align` with per-CHUNK windowing (`faChunkPlan.ts`'s `computeFaChunkPlan`, `fa_onnx.rs`'s `align_chunked`/`align_chunked_for_language`); session-scoped `FaModelCache`; real cancellation; `FaEvent::Progress`; hard structural invariant checkers (the Automated Agreement Budget's structural leg) | `eda13b1` |
| D12 | Run coalescing (`coalesceRuns`); window-size-ladder + attribution-isolation + Whisper-triage measurement harness over the real 240s excerpt. **Finding that reframed the workstream: ATTRIBUTION, not window size, dominates chunked-alignment disagreement** — oracle-text chunks reached 0.08s max start disagreement vs. 7.54s under `segment.startTime` attribution at matched granularity | `dda07b7` |
| D13 | Index-derived text attribution (`FaTextAttribution = 'script-word-index'`) — cuts chunk text at an anchor's own `qi` instead of `segment.startTime` membership; measurement-only at this point. **Provenance repair**: fixed a real desync bug where coalescing qi ranges from a coalesced run array inflated START p50 to 45.9s (`coalesceRunQiRanges` fix) | `1bc4523` |
| D14 | Measurement closure: verified D13's Whisper-triage coincidence directly (ruled out a self-comparison artifact); added `B-control-45s` oracle-time counterpart; weak per-chunk correlation found (\|r\|≤0.24, later superseded by D15's direct diagnostic). **B1**: shipped `.github/workflows/fa-ort-matrix.yml` — first run failed all 4 cells on two environment bugs, fixed same-day, re-run green | `450ad60` + `8889a2e` |
| D15 | Direct word-by-word mis-assignment diagnostic (no ONNX run, reconstructed from on-disk JSON): **5/569 words (0.9%) mis-assigned at 45s; 28/569 (4.9%) at 7s** — the mis-assigned set alone carries the entire START/END max error. Replaced D14's degenerate budget derivation with an explicit, sign-off-pending 0.3s product-decision gate. Reconciled the known-gap register | `8975316` |
| D16 | **Docs-only slice — no `src`/`src-tauri` commit.** A0: audited all 11 commit hashes D1–D15 claimed — all real, all correctly attributed. A1: traced the D15 mis-assignment set's root cause — classified **Whisper-intrinsic token-boundary disagreement (0.1–0.7s), not a local chunk-plan bug** — a STOP, no code change. A3: retired the whole-file-agreement proxy. A4: scoped integration (`task5-integration-scope.md`). B1: confirmed CI non-flaky on a second independent run | — |
| D17 | Track A: capability gate (`faGate.ts` + `ProjectSettingsModal.tsx`). Track B: schema/history/golden-replay/R.5/R.7 design memo — design only, nothing else built | `6e3293c` |
| D18 | Index-keyed word-timing schema (`FaWordSpan`, `faBoundaryTypes.ts`) | `78a0d4d` |
| D19 | R.7 confidence fallback — `needsReview` flag built and wired (`CONF_MIN`, `needs_review`) | `b7f1d0a` |
| D20 | CTC-infeasible chunks skip+flag instead of aborting the run (2 real cases at 709s); root cause (attribution) left unaddressed at this slice | `13c4f97` |
| D21 | Index attribution measured to remove both real CTC-infeasibility cases outright (0/1643 fallback vs. 2/97 prior); Youden's-J CONF_MIN re-derivation (§6) | `aa5708e` |
| D22 | Made `'script-word-index'` attribution the chunked-path planner's own internal default; re-verified the zero-fallback regression guard post-flip | (folded into the session's own commit sequence around `aa5708e`/`a013329`) |
| D23 | Made the D22 flip live end-to-end; race guard (`ORT_ENV_LOCK`-adjacent determinism fix); **built** R.2 padding (`align_chunked_with_padding`, 0.5s default) | `3f2b9e6` |
| D24 | **R.2 padding post-mortem**: measured net-unfavorable, falsified the untokenized-pad-speech hypothesis (0/236 edge-word checks), **deleted** the padding mechanism. Track B: built durable FA audio cache (`ensure_durable_wav`, 2 GiB LRU) | `a89f70a` |
| D25 | A1: wired `ensure_durable_wav` into `fa_align_dev`, live-verified against a real `AppHandle<Wry>` (1538× cache-hit speedup); fixed 2 real bugs live (`.tmp` filename defeating ffmpeg auto-detection; concurrent-miss filename collision). A3: reconciled 118 real chunks under index attribution. B1 (read-only): scoped R.5 reachability — **verdict (i), still fully reachable** | `1cde438` |

**On D8/D9's missing aggregate gate numbers**: unlike D2–D6 and D10, those two commits'
messages report validation results (fixture parity, drop-path coverage) rather than full
`cargo test`/`npm test`/golden-replay figures — this ledger states what each commit's
checked-out source actually contains rather than inventing numbers the commits themselves
never recorded.

**Gates at D10 close** (re-verified live 2026-08-13): `npm run lint` clean; `npm test` 76
files/1898 passed/1 skipped; golden replay 6/6; `cargo check` clean both configs; `cargo
test` feature-off 60 passed; `cargo test --features fa-inference` (ORT set,
`FA_REQUIRE_ORT=1`) 109 passed, 0 skipped.

**Gates at D25 close**: `cargo check` clean both configs; `cargo test --lib` 76 (unconditional);
`cargo test --lib --features fa-inference` 150 passed, 0 failed, 19 ignored; `cargo clippy
--all-targets --features fa-inference` 4 pre-existing warnings, 0 new; `npm run lint` clean;
`npm test` 79 files/1942 passed/1 skipped; golden replay 6/6; live zero-fallback regression
guard: `wall_clock=74.4s chunks=118 words=1643 fallback=0`.

---

### §6. Measurement & Gate Archive

Grouped by topic. Every figure below was directly grepped/read from its source file during
this consolidation pass before that file was deleted.

**Spanish language gate — CLOSED.** Raw (uncorrected) reference: p95 61.2ms/282.1ms — this
read as a FAIL against the 250ms limit, but was reference bias, not a real FA defect.
Corrected against a human-validated, breath-aware reference: **p95 = 50.4ms** (median
30.3ms, max 1183.7ms), **1 of 22 pauses over** the 250ms gate. `spanish-gate-scoring.md`
(deleted): *"Step F breath-aware | 30.3ms | 50.4ms | 1183.7ms | 1 of 22 | PASS."* One
genuine FA error remains, `clip3_06`, −1084ms, covered by risk R.6. Also documented in
`sync-pipeline-v2-plan.md:1914,2079,2411,2680`.

**R.7 CONF_MIN — Youden's-J validation (D21/D22).** Best Youden's J = 0.9176 at confidence
threshold = **0.3112**, essentially identical to the shipped `CONF_MIN = 0.3`
(`syncConstants.ts:536`, `fa.rs:303`). Robustness check across three independent tolerance
definitions — the threshold lands at the **identical 0.3112** each time:

| Tolerance | Violators | Non-violators | Best Youden's J | Threshold | TPR | FPR |
|---|---|---|---|---|---|---|
| 0.15s | 352 | 204 | 0.9337 | 0.3112 | 96.3% | 2.9% |
| 0.3s | 347 | 209 | 0.9176 | 0.3112 | 96.5% | 4.8% |
| 0.5s | 343 | 213 | 0.9069 | 0.3112 | 96.8% | 6.1% |

Verdict: validates the existing `CONF_MIN` value — no change proposed. Coverage gap
(distinct from the value question): every committed e2e fixture's `exp(score)` sits in
[0.730, 1.0], so no existing test exercises the gate's reject branch on real model output.

**CTC-infeasibility (D11→D20→D21/D22).** Original: 2/97 chunks failed at 709s under
`segment-start-time` attribution (`fa_onnx.rs`'s `TooManyRepeats` case). D20 added a
skip+flag fallback (doesn't fix root cause). D21 measured that switching to
`script-word-index` attribution removes both cases outright: **0/1643 fallback fires**,
regression-guarded (`assert_eq!(fallback_count, 0, ...)`), and drops the below-`CONF_MIN`
fraction from 62.75% (1014/1616, "close to uninformative" by D20's own wording) to **9.43%
(155/1643)**. D22 made index attribution the chunked planner's own internal default.

**Attribution isolation (D12/D13).** Oracle-cut, oracle-text construction ("B (full)"):
max start disagreement **0.08s** vs. the whole-file reference (38 boundaries, 569/569
words matched). Real, anchor-derived, 7s-coalesced boundaries with oracle text
("B-control"): max **0.54s**. Switching only the text source (segment-start-time →
oracle) at fixed boundaries cuts disagreement from ~7.5s to 0.54s; switching only the
boundary source (real anchors → oracle-cut) at fixed oracle text cuts it further, 0.54s →
0.08s — confirming attribution, not window size, is what dominates.

**Mis-assignment diagnostic (D15).** Direct word-by-word comparison, index-45s vs.
B-control-45s (oracle-time) attribution, reconstructed from on-disk JSON, no new ONNX run:
**5/569 words (0.9%) mis-assigned at 45s**; **28/569 words (4.9%) mis-assigned at 7s**
(the two window sizes are not directly comparable — D15 found index-7s and its
B-control-7s counterpart don't share identical chunk boundaries, unlike at 45s). The
mis-assigned set alone carries the entire START/END max error and ~100× the
correctly-assigned set's mean error.

**R.2 padding — CLOSED-NEGATIVE (D23 built, D24 post-mortem + deletion).** Built:
`align_chunked_with_padding` / `FA_R2_DEFAULT_PADDING_SEC` (0.5s default). Measured:
below-`CONF_MIN` tail grew 155→164 words; seam concentration worsened 83.9%→85.4%. D24's
own diagnostic then falsified the mechanism padding was built to fix: **0/236 edge-word
checks show a timestamp escaping its own chunk's window**, in either the padded or
unpadded run — confirmed architecturally (padded emission is sliced back to the exact
unpadded frame count before Viterbi decode; smear is structurally impossible, not merely
unobserved) and empirically. Real effect: ordinary acoustic-context-sensitivity near a
hard edge, not pad-speech contamination. Deleted entirely — confirmed by direct grep, zero
hits for any of the three removed symbols. **Does not need re-attempting under the
falsified hypothesis** — a future slice would need a genuinely new mechanism.

**Durable audio cache (D24/D25).** 2 GiB LRU cap (`fa.rs:591,516`). Reuse proven three
ways: byte-identical content, mtime re-stamped past artificial aging, and **1538× wall-clock
speedup** on a cache hit vs. a miss (isolated from D10's own unrelated ~74–78s
model-manifest-SHA-256 fixed cost). Live-verified against a real `AppHandle<Wry>`
(D25 A1) — resolved cache path matches production's `app_local_data_dir()` exactly.

**Whole-file memory ladder (D10) — the finding that made windowing mandatory.** Real
project audio, increasing clip length, peak memory (Rust/ONNX path, whole-file, no
chunking):

| Clip length | Wall-clock | Peak memory |
|---|---|---|
| 30s | 7.64s | 1.94 GiB |
| 60s | 14.18s | 3.45 GiB |
| 120s | 34.53s | 7.79 GiB |
| 240s | 117.72s | 19.52 GiB (independently re-measured at D11: 20.31 GiB RSS, ~0.8 GiB env-attributable diff) |

Super-linear growth, extrapolating to an estimated 60–150GB at a real 709s voiceover
against a 32GB machine ceiling — infeasible. This is why chunked windowing (D11+) was
built, and is a **different measurement from the number below.**

**⚠ Do not conflate with the above:** the *original*, pre-Task-5 Python/MMS-FA feasibility
spike (`sync-pipeline-v2-plan.md:592`, predates the Rust engine entirely) measured **peak
memory footprint 2.49 GiB, max RSS 4.01 GiB** on the full V6 project (1421.3s audio,
349.5s wall-clock, ≈4.07× realtime) and peak RSS 3.98 GiB on the 173 project (709.0s
audio, 112.7s, ≈6.29× realtime). That figure is real and citable, but describes a
different implementation (the Python reference used to prove FA was feasible at all) than
the Rust/ONNX engine's own whole-file mode measured explosively worse above — the two are
not in conflict, they measure different code paths, and neither supersedes the other.

**709s chunked run, pre-attribution-fix (D11):** `wall_clock=132.1s chunks_ok=95/97
chunks_failed=2 words=1616 audio_duration=709.01s`. **Post-fix (D22/D25):**
`wall_clock=74.4s chunks=118 words=1643 fallback=0`.

**Non-English vocab-representability (pre-existing, legacy normalizer, not `faTextNormalize.ts`).**
`textNormalize.ts`'s ASCII-only `canonicalize()` step 10 destroys non-English diacritics
for all 4 non-English supported languages: **es 8/34, fr 26/52, de 5/31, pt 13/39** letters
lost. This is the Phase 3b prerequisite gap — see §10.

---

### §7. Open Decisions

Numbered, none left as a bare TBD. Source: `task5-open-decisions.md` (deleted this pass —
full text folded in below).

**1. The proposed 0.3s per-word display-timing gate (D15).**
*Question:* should per-word timing error ≤0.3s (start and end) be ratified as the display
tolerance for a future word-level highlight/caption feature?
*Not the same number as `CONF_MIN`* — that's a confidence probability; this is a
timing-error-in-seconds threshold for a feature that doesn't exist yet. Coincidentally
identical value, unrelated units.
*Evidence:* D15's exceedance table — only oracle-text rows clear it outright; the
production-realistic index-45s row exceeds on ~1% of words (the same 5-6/569 D15's own
diagnostic explains).
*Options:* (a) ratify now — gives future windowing work (R.3/R.7-R.9) a concrete target,
risk is committing to an "engineering judgment" number, not a measured or user-tested one;
(b) defer — costs nothing today (no consumer feature exists to block), risk is windowing
work proceeding without a stated target.
*Recommendation:* none stated by the source document (deliberately, "deciding is the
owner's call"). *Owner, trigger:* project owner; before any R.3/R.7-R.9 windowing-precision
work is scoped in detail.

**2. R.5 — build now, later, or not at all. DECIDED 2026-08-15: DEFER (option b).**
Full decision text: `sync-pipeline-v2-plan.md` Part M (appended 2026-08-15, after
the durable-cache paragraph). Ship the production-wiring slice (item 1 below)
without R.5; build R.5 afterward, before Phase 4. Reopens when item 1 or item 6
below starts. Does not descope — owner ruling D1 still mandates it in-scope.
*What's already decided, not open:* the wildcard-gap *destination* (R-E: "Model P outranks
R.5," assigned to the preceding segment) — ruled 2026-08-11, a day before Task 5's first
commit.
*What's actually open:* whether/when to build R.5's implementation, given (1) it's
mandated in-scope by owner ruling D1 ("Option B... with R.5 wildcards,"
`task5-integration-scope.md` §0), (2) D25 B1's verdict (i) — the condition it exists to
handle is still fully reachable (118 real chunks, most already concatenating multiple
segments' text), and (3) its real implementation cost is a two-layer change:
`faChunkPlan.ts` would need to carry per-segment text spans per chunk instead of one
joined string (an IPC shape change), and `fa_viterbi.rs`/`fa_onnx.rs` would need a genuine
zero-cost wildcard state in the Viterbi DP.
*Options:* (a) build now, alongside the capability-gated production-wiring slice —
front-loads the IPC-shape change while that slice already touches `FaChunkInput`, likely
cheaper combined; delays production wiring's own landing; (b) ship production wiring
without it, add later — gets FA to a real production timing source sooner (segment-level
timing doesn't need R.5 at all), but per-word display (D1's actual mandated scope) ships
with a known, architecturally-guaranteed gap; (c) descope permanently — would contradict
owner ruling D1's explicit scope, not a default any doc can make unilaterally.
*Owner, trigger:* project owner; before or during the capability-gated production-wiring
slice (§11, item 4) — the slice's own shape depends on the answer.
*NEW EVIDENCE, 2026-08-16 (ear-pass root-cause session, §11 item 6's addendum below) —
R.5's value is now MEASURED, and it is partial, not a cure-all.* R.5 would have prevented
exactly **2 of the 7** ear-verified FA failures (items 4 and 5, the unscripted "Level N …"
recitations) — established by a real FA re-run, not by argument: giving that audio its own
segment (a manual stand-in for R.5's wildcard, identical in effect under R-E since the
wildcard span goes to the preceding segment) moved both boundaries onto the ear-correct
value exactly, 130.96 and 931.40, with no other boundary in the project disturbed. R.5
would NOT have prevented items 6, 7, 9, 10 or 11 — those are a false-anchor defect, a
chunk-plan attribution bug, and the mirror-image case (scripted text that is never spoken,
which a wildcard absorbs audio for but never drops text for). **Implication for this
decision:** R.5 is confirmed real and worth building, but it does not by itself make FA
reliable, so "build R.5" cannot substitute for the confidence-gate / false-anchor /
forced-split work the addendum identifies. Sequencing it ahead of those is a choice, not
an obvious win.

**3. Branch protection on `main`.**
*Current state (live-verified):* `main` has no branch protection (`gh api .../branches/main/protection`
→ 404). `fa-ort-matrix.yml` has been green on every run since its D14 B1 fix, confirmed
non-flaky by a second independent D16 run.
*Options:* (a) add branch protection (`fa-ort-matrix.yml` as a required check, minimum) —
prevents a future push from silently breaking the FA CI matrix; blast radius beyond Task
5, since protection gates *every* future push/PR to `main`, not just FA-Rust-surface
changes; (b) leave unprotected — costs nothing today, but a regression in the FA matrix
(or any future workflow) can land unnoticed.
*Recommendation:* none stated (explicitly left to the owner — a repo-settings change with
blast radius beyond this workstream). *Owner, trigger:* project owner; no forcing deadline,
but should be decided before Task 5's production-wiring slice ships if that slice adds
more required-check candidates.

**4. R-M/R-N ratification into `project-state.md`.**
*What it is:* `project-state.md`'s **R-M** currently reads "accepted cost: a from-source
onnxruntime build for `x86_64-apple-darwin`" — superseded by the runtime-unblock
investigation (`measurements/runtime-unblock-2026-08-12.md`, commit `55e2ad5`): disabling
`ort`'s `api-NN` Cargo features drops the onnxruntime floor from 27 to 17, which the
prebuilt 1.23.2 binary satisfies; no from-source build needed. `src-tauri/Cargo.toml`'s
current `ort` dependency already reflects this. **R-N** (static-link vs.
load-dynamic+bundled-dylib packaging) is unaffected and remains genuinely undecided.
*Why not fixed directly:* `project-state.md` is out of scope for this consolidation pass
(protected; requires explicit owner approval per the standing process rule below) — this
is the second documentation pass in a row where the correction is identified but not
applied. **Proposed diff below, for you to apply.**
*Options:* (a) ratify now — low cost, well-evidenced, already implemented in code; (b)
defer again — costs nothing functionally (code already reflects the unblocked state), but
`project-state.md` keeps asserting a stale, more pessimistic constraint than reality.
*Owner, trigger:* project owner; recommended before the next full WS1 documentation
pass, so the correction doesn't get lost a third time.

> **Proposed `project-state.md` diff (NOT applied — protected file, requires your
> approval):**
> - **R-M**, current text: *"`ort` (ONNX Runtime) is the forced-alignment runtime.
>   `candle` is rejected... Accepted cost: a from-source onnxruntime build for
>   `x86_64-apple-darwin` in CI, following the existing whisper-cli from-source pattern."*
> - **Proposed replacement**: *"`ort` (ONNX Runtime) is the forced-alignment runtime.
>   `candle` is rejected — no wav2vec2/CTC implementation exists in `candle-transformers`.
>   **Superseded 2026-08-12**: the original "from-source onnxruntime build required" cost
>   was based on an incomplete reading of `ort`'s version floor — disabling all `api-NN`
>   Cargo features drops the minimum onnxruntime version from ≥1.27 to 17, which the
>   prebuilt `onnxruntime-osx-x86_64` 1.23.2 binary satisfies. No from-source build is
>   needed; `src-tauri/Cargo.toml` ships the unblocked configuration. Detail: runtime-unblock
>   investigation, commit `55e2ad5`, folded into `docs/work-in-progress.md` §6 (WS1
>   consolidation, 2026-08-14)."*
> - **R-N**: no change proposed — still genuinely open, unaffected by the above.

**5. R-N — fa-inference production packaging: static-link vs. load-dynamic+bundled
onnxruntime dylib.** Distinct from item 4 above — item 4 is whether to ratify R-N's
*wording* into `project-state.md`; this is the underlying packaging decision R-N itself
names, restated here as its own tracked item since it has its own trigger independent of
any documentation pass.
*What it is:* `ort` (R-M) currently compiles `load-dynamic` — no onnxruntime dylib bundled
or statically linked into the app today (confirmed live this session: `npm run
tauri:dev:fa`'s only obligation is that the Cargo feature compiles; a real `ORT_DYLIB_PATH`
is still unset in dev, and any FA call fails cleanly rather than crashing). Production
packaging has two live options: (a) static-link onnxruntime into a single fat binary, or
(b) stay load-dynamic and bundle a separate onnxruntime dylib as a Tauri resource. The
choice determines model-bundling shape, the onnxruntime distribution mechanism, and final
installer/binary size — none of which is decided.
*Why not decided now:* R-K (no release build until WS1 completes) means no build is being
cut yet, and load-dynamic already satisfies R-L's in-process requirement for local dev —
not urgent today, but not free to leave open indefinitely either.
*Decision required:* static-link vs. load-dynamic+bundled-dylib for the production
onnxruntime dependency.
*Phase that must answer it:* before Step T (model distribution/on-demand-download, R-D)
and before any release build (R-K) — i.e., it gates the release-build phase, not Task
5/Phase 3's production-wiring slice itself.
*Owner, trigger:* project owner; originally recorded 2026-08-11 as R-N
(`project-state.md` §5); restated here 2026-08-15 after last session's `tauri:dev:fa`
work surfaced it again in the `fa-inference` build-flag context (see the 2026-08-15
"Gate sequencing decided" changelog entry below) — confirming it was written down, not
only discussed.

**6. Portuguese cardinal numbers — PT-PT vs PT-BR spelling fork. RESOLVED 2026-08-15:
PT-BR.**
*What it is:* Rules 1-3 (French elision, Spanish/German cardinals) are done; a Phase 3b
remainder audit (2026-08-15) found Portuguese cardinal digits are the same shape of gap,
but with a caveat this item's original wording missed: Portuguese 21-29 is a three-word
"vinte e X" compound (e.g. "vinte e três"), the same permanent multi-word wall as Spanish
31+ under decision (b) — so only 0-20 and 30 (22 of the 31 values originally scoped) are
actually single-word-representable; 21-29 is out of reach regardless of which spelling
variant is chosen. Of those 22, four fork by variant: 14 catorze/quatorze, 16
dezasseis/dezesseis, 17 dezassete/dezessete, 19 dezanove/dezenove (PT-PT first, PT-BR
second in each pair). The other 18 are spelled identically in both variants.
*Checked before asking, per this pass's own instruction not to guess:* the committed
`scripts/fixtures/fa-vocab-pt.json` is a CTC character-vocabulary export (which letters
the model can emit), not a word list — it cannot settle a whole-word spelling choice by
construction, confirmed by direct read of the file. The one real Portuguese text fixture
in the repo, `scripts/fixtures/fa-e2e-alignment-pt-site-publico.json`, carries a single
sourced sentence ("O resultado da análise do gráfico será disponibilizado no site
público.") with no cardinal number in it and no variant-distinguishing vocabulary either
way — it settles nothing. Its audio is sourced from `google/fleurs`, whose only
Portuguese configuration is Brazilian (`pt_br`) — noted for completeness, but this is
about the *audio corpus*, not the jonatasgrosman model's training-vocab bias or a
project convention for spelled-out numbers, so it does not resolve the spelling question
either. No prior Portuguese narration-script corpus exists in this repo (§10 above: fr/de/pt
narration corpus is completely absent). **Conclusion: not settled by anything in-repo —
put to the owner this session.**
*Owner decision (2026-08-15): PT-BR* (quatorze/dezesseis/dezessete/dezenove). Implemented
as Rule 4 — see this session's changelog entry below.
*Options:* (a) PT-PT (catorze/dezasseis/dezassete/dezanove); (b) PT-BR
(quatorze/dezesseis/dezessete/dezenove); (c) support both, keyed off a variant flag not
currently in `Project`/`SUPPORTED_LANGUAGES` (bigger change, new field, deferred unless
requested).
*Owner, trigger:* project owner; blocks Rule 4 (Portuguese cardinals 0-30) starting.

**Decisions already ruled (closed) — WS1-specific, not restated as open work.** Carried
forward from the deleted `ws1-master-roadmap.md` §8 and the pre-consolidation WIP doc's own
Rulings block, since both are now gone and these still govern live code:

- **R-A** — 22 blank `boundary-quality-flag` rows in `scripts/fixtures/verification-baseline.csv`
  deferred, non-blocking (2026-08-11). WS1 does not pause for an ear-listening pass.
- **R-B** — the fr/de/pt "unvalidated language" warning (Step T.7) ships with Phase 3/Task
  5, same release, not after.
- **R-C** — `model-p-editor-work` stays permanently unmerged; K13 fixed fresh against
  `main`, porting only the logic/idea, never the stale branch code. **CLOSED**, task 8
  above.
- **R-E** — "Model P outranks R.5" (destination decided, see item 2 above).
- **R.5 timing** — DEFERRED, 2026-08-15 (item 2 above): build after production
  wiring (§11 item 1), not bundled with it. Not a Stage 1 lock criterion.
- **R-G** — `anchorSource` gains `'forced-alignment'`, ordered above `'whisper'`
  (forced-alignment > whisper > estimate); demote-only ordering preserved.
- **Heading-wildcard Option A** — unscripted audio absorbed entirely by the preceding
  segment, logged as `unscripted-gap`. Owner decision 8. Blocks Phase 5, not Phase 3.
- **D1 (owner ruling, `task5-integration-scope.md` §0, 2026-08-14, PERMANENT)** — "D1 SCOPE
  = Option B, full word-level timings, persisted in project data, with R.5 wildcards and
  R.7 CONF_MIN fallback." Resolves which consumer Task 5's word-level output is for: (2)
  per-word display, not (1) segment-level-only.
- **D2 (owner ruling, same source)** — "D2 GATE = Settings toggle, persistent, DEFAULTS
  OFF." Implemented at Slice D17 (`faGate.ts`).
- **Spanish gate** — CLOSED, see §6.
- **ort/onnxruntime runtime blocker** — RESOLVED per R-M above; not yet ratified into
  `project-state.md` (item 4 above).

---

### §8. FA Production Writer Merge Path

The exact commit chain (traced live through `src/App.tsx`'s `handleApplySyncFromFiles`):

1. `App.tsx:2833` — `applyAnchorBasedTiming(newSegmentsRaw, audioDuration)` (`syncEngine.ts:225`) — seeds estimate anchors.
2. `App.tsx:2834-2839` — `alignFromCache(...)`, i.e. `useWhisper.ts`'s exported name for `alignSegmentsFromCachedTranscript` (`useWhisper.ts:66-122`), which internally calls `alignScenestoTranscript` (`whisperService.ts:1342`) for per-segment `firstTokenIdx`/`lastTokenIdx`, then `distributeSegmentTimes`, then `applyAnchorBasedTiming` again.
3. `App.tsx:2864` — `filterToCoveredSegments` drops unmatched segments.
4. `App.tsx:2969` — **`snapCoveredBoundaries(kept, keptAlignments, transcriptTokens, aligned.silences, audioDuration)`** (`snapBoundaries.ts:653`) — indexes into the `tokens` array via each segment's `firstTokenIdx`/`lastTokenIdx` (`snapBoundaries.ts:710-717`).
5. **`snapBoundaries.ts:882-883` (`curr.duration = ...`, `next.startTime = snapped`) and `:900`** — the literal mutation of `startTime`/`duration` onto committed segment objects. The single point where `t0`/`t1` become what Timeline/preview/export read.
6. `App.tsx:2983` — `headExtendFirstSegment` stretches segment 0 back to 0.

**Exact insertion point for a production FA writer (does not exist today):** between
`App.tsx:2792` (`cachedTokensReady` gate) and `App.tsx:2834` (`alignFromCache` call) —
specifically the `tokens` argument at **`App.tsx:2837`** (currently
`projectRef.current.transcriptTokens!`). A branch on `isFaGateOpen()` (`faGate.ts:69`,
**zero call sites today** in `App.tsx`/`src/hooks/`) would produce an FA-derived
`TranscriptToken[]` via `faWordSpansToTranscriptTokens` (`faBoundaryTypes.ts:132`, built
from a real `invoke('fa_align', ...)` — only `invoke('fa_align_dev', ...)` exists today, at
`App.tsx:3598`, DEV-gated) and substitute it for `projectRef.current.transcriptTokens!` at
that line. Everything downstream is timing-source-agnostic — `snapCoveredBoundaries` only
ever indexes into whichever `tokens` array it's handed, confirmed by direct reading.

---

### §9. Contract 1→2 Compliance Checklist

Quoted from `sync-pipeline-v2-plan.md:4199-4219` (Contract 1→2, Stage 1 → Stage 2),
cross-referenced against `src/types.ts` live:

| # | Requirement | Met? | Evidence |
|---|---|---|---|
| P1 | Malformed-token filtering | ✅ | `whisperService.ts:1288` `filterMalformedTokens` |
| P2 | Token ordering (ascending) | ✅ | `syncContracts.ts:152` `validateTokenOrdering` |
| P3 | Drop-distribution reporting | ✅ | `syncContracts.ts:102` `analyzeDropDistribution` |
| P4 | Silence ascending/disjoint runtime assertion | ❌ | grepped `silence-scan-anomaly` across `src/` — zero hits; Phase 4, REQUIRED ADDITION, not built |
| P5 | Silence-scan-failed vs. no-silence-found, type-level | ✅ | `silenceDetector.ts:21-22` — `{status:'ok', silences}` \| `{status:'error', errorMessage}` |
| P6 | Same language-keyed normalizer, byte-identical English path | ✅ **2026-08-18 (WS1 Session J); Spanish vacuity closed WS1 Session M** | **MEASURED, zero asymmetries.** `src/services/normalizerSymmetry.test.ts` (in the standing `npm test` pass) drives the production `canonicalize`/`stripStageDirections`/`normalize`/`normalizeSceneDoc` over the committed en/es fixtures. Cross-side lexical agreement: no raw word reaches two normalized forms. Compositionality (the untested risk — transcript side normalizes per TOKEN, script side per SEGMENT, and `canonicalize` does multi-word rewrites like `1985`→nineteen eighty five): per-token and whole-text streams are byte-identical, v6 3998=3998 / 173 1837=1837 / spanish 363=363. **Session M closed the debt Session L was left holding open (reconciled into this session's commit):** the Spanish CORPUS has zero expanding tokens (vacuous on real material, unchanged), but the property is NOT non-falsifiable in Spanish — a new test runs the `es`-keyed normalizer on constructed digit material (the digit→words reading is language-independent) and confirms both expansion and compositionality. What stays corpus-vacuous is only what a digit-free Spanish corpus can reach; the machinery itself is now exercised. `stripStageDirections` still fires on 0 segments of all three corpora. Phase 3c's accepted hyphen class remains excluded by construction |
| P7 | Timing-source identified on output, type-level | ~ partial | `types.ts:223` `VideoSegment.anchorSource?: 'forced-alignment' \| 'whisper' \| 'estimate'` exists (ahead of schedule, includes `'forced-alignment'` per R-G) but lives on the *segment*, not per-token/per-Stage-1-output as the contract literally specifies |
| P8 | Tokens/silences/audioDuration/segments as ONE bundled, type-enforced object | ❌ | `project.transcriptTokens` (`types.ts:336`) remains separately reachable; `useWhisper.ts:44-51`'s own doc comment *warns* callers to use `AlignFromCacheResult.tokens` instead — discipline, not type enforcement. This is "old R7," scheduled for Phase 4 |

**6 of 8 met as of 2026-08-18 (WS1 Session J)** — P1, P2, P3, P5, **P6**, P7-partial. P6 moved
❌ → ✅ by measurement, not by acceptance: it was the one row that could not be scheduled away,
because the plan's own enforcement text for it is "symmetry property manually-verified", i.e.
the verification IS the enforcement. There is now an automated gate to point at. P4/P8 remain
tied to Phase 4 (not started).

On the wider twelve-row table (`stage1-lock-contract-1to2.md`), Session J's result moves the
tally from **5 DIRECT / 4 PARTIAL / 3 ABSENT** to **6 DIRECT / 3 PARTIAL / 3 ABSENT**: P6
leaves the PARTIAL set. A4 and Contract IN A3 are now ACCEPTED IN WRITING (see the Session J
entry below), so this contract's *blocking* set for the Stage 1 lock is empty — P2/P3's
reachability defect and P7's narrower-than-worded scope are recorded, scheduled, and not
Stage 1 regressions.

**2026-08-18 (WS1 Session K) — NO P-ITEM MOVED, and that is the reported result rather than
an omission.** P1/P2/P3/P5/P6 stay ✅, P4/P8 stay ❌ (Phase 4, not started), P7 stays partial.
R.13 adds a boundary correction and changes no Stage-1→Stage-2 handoff type.

**One finding of this contract's CLASS was found and closed, outside P1–P8.** The
index-convention defect (see §11's Session K entry) is the same failure mode P7 and P8
describe — an identity carried on an output with no type enforcement, kept correct by
discipline alone. `SyncLogEntry.segmentIndex` had **two live conventions and a `types.ts`
comment asserting there was one**. It is not a P-row because it is a LOG output, not the
Stage-1→Stage-2 bundle, and adding it to the table would misrepresent the contract's scope.
It is recorded here because the next session to work P7/P8 should know the class has already
produced one shipped defect: "documented as uniform, never checked" is the exact shape P8 warns
about, and `syncLog.indexConvention.test.ts` is the pattern P8's own fix should follow — a test
that makes the convention unfalsifiable rather than a comment that asserts it.

**2026-08-18 (WS1 Session J) — P6 is BUILT AND PASSES; A4 and Contract IN A3 are ACCEPTED IN
WRITING. This contract's blocking set for the Stage 1 lock is now EMPTY.**

- **P6 — measured, not accepted.** `src/services/normalizerSymmetry.test.ts`. **Zero
  asymmetries** across all three corpora. Full result in the P6 row above and in
  `stage1-non-ear-remainder.md`'s sign-off block. Stage 1 does NOT reopen on this item.
- **The substantive thing it checked, which nothing had:** the two sides normalize at
  different GRANULARITY — transcript per token, script per whole segment — and `canonicalize`
  performs real multi-word rewrites (digit-as-words, contraction expansion, hyphen splitting).
  Had any of those reached across a whitespace boundary, the Hirschberg aligner would have been
  matching two streams that disagreed about their own vocabulary, invisibly, since each side is
  individually self-consistent. They do not; every rewrite is intra-token.
- **Two coverage limits reported rather than absorbed** (neither is an asymmetry; both bound
  the claim): the **Spanish corpus exercises the property not at all** — 363 tokens, zero
  expanding, so its pass is vacuously true and P6's es half rests on material that cannot
  falsify it; and **`stripStageDirections` never fires** on any corpus in scope (0/444, 0/172,
  0/26), so the one deliberate script-side-exclusive step contributes no asymmetry because it
  never runs, not because it was shown benign. Both are pinned as assertions so they fail
  loudly rather than outliving their truth.
- **A4 ACCEPTED as written**, scoped to Stage 1 only — it returns as a close-or-accept decision
  at the Stage 2 lock, where alignment is the stage under test rather than a dependency of it.
- **Contract IN A3 ACCEPTED as written**, with the fr/de/pt carve-out intact: R-T's deferred
  non-English work must state whether a script-language check becomes a requirement there.
- **`validate1to2`'s reachability defect (P2/P3) is UNCHANGED and still recorded.** Session G's
  severity escalation stays reverted — the default is OFF, so the unvalidated array is not the
  default array.

**2026-08-18 (WS1 Session I) — P6, A4 and Contract IN A3 are now ANSWERABLE, and no row
changes.** All three of this contract's remaining open items are assembled into one
owner-answerable dossier, `docs/ws1-sync-pipeline/stage1-non-ear-remainder.md`, each with a
recommended answer: **P6** gets the exact measurement that would move it DIRECT (push both the
script side and the transcript side through `textNormalize.ts`'s `canonicalize` at the project
language, over the existing committed fixtures, and report every asymmetry outside the accepted
Phase 3c hyphen class — one test file, ~120 lines, 1–2 h, recommended BUILD); **A4** and
**Contract IN A3** get verbatim acceptance text to sign or reject (both recommended ACCEPT,
A4 scoped to Stage 1 only, A3 with an explicit fr/de/pt carve-out). Nothing was built and no
row's Met? value changes this session — the dossier is a decision sheet, not a fix.

**2026-08-18 (WS1 Session H) — the exposure claim below is REVERTED.** Session G's own entry
(next) says "with Session G's per-project default now ON, the unvalidated array is the DEFAULT
array" — that is no longer true. R.12 (`faRunPlacementGate.ts`) landed and found nine real
defects on v6 that no rule built before it could see, and `FA_PROJECT_DEFAULT_ON` was reverted
ON → OFF, value-only (`faGate.ts`'s own doc comment carries the exact flip-back condition: two
fresh blind 12/12 listening passes on disjoint rows, then the live acceptance run). A new
project is Whisper-only again until that condition is met; an existing project that explicitly
opted in stays in. This contract table's own rows are otherwise untouched by this session — R.12
runs after `headExtendFirstSegment`, exactly where R.11 runs, for the identical reason, and its
own mutual-exclusion measurement (`faRunPlacementGate.test.ts`) confirms chunk-plan byte
equality on all three corpora. No row changes. Golden replay 6/6.

**2026-08-17 (WS1 Session G) — the twelve-row pass is now a WORKING DOCUMENT, and one row's
SEVERITY changed.** The full guarantee-by-guarantee pass (P1–P8 + A1–A4, every row re-grepped
live at HEAD rather than transcribed from the uncommitted `0d8420f` dossier) is committed at
`docs/ws1-sync-pipeline/stage1-lock-contract-1to2.md`. Tally: **5 DIRECT (P1, P5, A1, A2, A3)
/ 4 PARTIAL (P2, P3, P6, P7) / 3 ABSENT (P4, P8, A4)** — consistent with this section's own
"5 of 8" on the narrower P1–P8 table, and refining it: P2/P3 are *built but unreachable from
the committed path*, while P6/P7 are *built and reachable but narrower than the contract's
wording*. **The escalation:** `validate1to2` (wrapping P2/P3) is invoked only from
`useWhisper.ts:290` and never from `alignFromCache`, the function Apply Sync actually commits
through — already recorded 2026-08-16, but while the FA gate defaulted OFF it described a path
almost nobody took. **With Session G's per-project default now ON, the unvalidated array is
the DEFAULT array** on any Tauri-capable machine with a model and a supported language. The
contract did not change; its exposure did. **Session G's own toggle change is otherwise a
no-op on this contract** — it decides only WHETHER `runForcedAlignmentForSync` is called, and
touches no file participating in token preparation, normalization, or silence detection. No
row changes. Golden replay 6/6.

**2026-08-17 (WS1 Session F) — R.11's effect on Contract 1→2: NONE. Measured, not assumed.**
R.11 runs even later than R.10 — after the fully-committed, `headExtendFirstSegment`-ed
segment array exists — and only ever rewrites `startTime`/`duration` on already-committed
segments; it adds no segment, drops none, and reads `faChunkPlan.ts`/`faAnchors.ts` output
without re-invoking either with different arguments. `normalizeSceneDoc` word counts,
`computeRunContext` offsets, `assertQiMapConsistent`, and all three anchor/run/chunk digests
are bit-identical before and after (verified: `git diff --stat src-tauri/` empty, and the
FA replay gate's `ANCHOR_PATH` block — which pins those exact digests — required zero re-pin
this session). No row in the table above changes. Golden replay 6/6.

**2026-08-17 (WS1 Session E) — R.10's effect on Contract 1→2: NONE. Measured, not assumed.**
R.10 runs AFTER inference, on FA's output, so nothing upstream of it moves: `normalizeSceneDoc`
word counts, `computeRunContext` offsets and `faChunkPlan.ts`'s indexing are all bit-identical,
and `assertQiMapConsistent` is untouched and still passing on all three corpora. Proof rather
than argument — all three anchor digests, run digests and chunk digests are unchanged. Session C
predicted the qi contract would be "the single highest-risk part of building R.10"; that was
true only of a design that drops the segment BEFORE chunk planning, which this one does not.
The one downstream change is that a corpus can now commit fewer segments than it parsed
(173: 175 parsed → 173 committed + 2 skipped) — the same shape the Whisper path has always
produced, handled by the same `filterToCoveredSegments`/`snapCoveredBoundaries` pair, with
Model P and Σ-duration verified intact. No row in the table above changes. Golden replay 6/6.

**2026-08-17 (WS1 Session D) — R.5's effect on Contract 1→2: NONE. Measured, not assumed.**
R.5 changes where the chunk plan is CUT, never how many script words exist or what `qi` index
any of them carries: `normalizeSceneDoc` word counts are unchanged, `computeRunContext`'s
offsets are unchanged, and `assertQiMapConsistent` — the guard that would fire if per-token and
whole-segment normalization disagreed — is untouched and still passing on all three corpora.
The one structural change is that the chunk plan's WINDOWS are no longer contiguous (an
excised span leaves a gap). That is legal and was checked against the consumer rather than
assumed: `fa_onnx.rs`'s `align_chunked` processes each chunk independently and offsets its
words by `chunk.start_sec`, and its windowed-output invariants (non-decreasing times,
non-overlap, each word inside its own chunk window) all hold across a gap. Chunk-window
contiguity was never a contract row; **Model P** governs `project.segments`, which R.5 does not
touch. No row in the table above changes. Golden replay 6/6 is the canary and it stayed 6/6.

**2026-08-16 — D.-1 criterion 2 evidence dossier assembled (no ruling).** Full
guarantee-by-guarantee evidence (code file:line, mechanism, named tests, DIRECT/
PARTIAL/ABSENT/CHANGED label per item) for Contract IN's 9 rows and Contract 1→2's
12 rows delivered in-chat for owner inspection — not committed as a repo file per
task constraints (owner inspection, not a doc artifact). Extends this section's P1-P8
table above to producer+consumer rows on both contracts, with stricter per-item test
labels. Key findings beyond the table above:
- **CHANGED (new, not previously itemized):** `validate1to2` (wraps P2/P3 —
  `validateTokenOrdering`/`analyzeDropDistribution`) is invoked only from
  `useWhisper.ts:290`, inside `startTranscription`'s fresh-transcription staging
  path — never from `alignSegmentsFromCachedTranscript`/`alignFromCache`, the
  function the Apply-Sync commit path (including the FA branch, `App.tsx:2869`)
  actually calls. P2/P3 therefore never validate the array Apply Sync commits
  from — true before FA landed too, but FA sharpens the gap since the
  FA-substituted token array is never validated by either check, at any point.
- **P8 (bundled Stage 1 output object) and P4 (silence ascending/disjoint runtime
  assertion):** confirmed absent by direct grep, consistent with the table above —
  both remain Phase 4 scope, not a Stage 1 regression.
- **Contract IN A4** (asset-tag ≤1-asset / asset-feeds-≤1-segment): console-only
  warning path is test-covered for the collision-detection half; the
  "asset feeds at most one segment" half is untested for the exact-match tier.
- D.-1's 9-item regression checklist: none of the 9 items have been run as
  literally specified (real corpus project, running app) — matches the plan's
  own "(e) not yet run" status. Automated proxy tests exist and pass for locks,
  skipped-segment boundaries, headings, export/preview consumers; weak-to-no
  proxy coverage for the no-voiceover path, empty-token fallback,
  `lastTranscribedFileIdentity` persistence, and the three DEV harness globals.
- Two of three contract-table UNENFORCED assumptions have no written
  acceptance yet: Contract IN A3 (script/scene language vs. `Project.language`)
  and Contract 1→2 A4 (alignment cost bound / `__ALIGN_INSTRUMENT__` dormant).
  Draft acceptance text for both was prepared for the owner to adopt or edit,
  not recorded here as fact.
- `npm test` (2107/2107 + 1 skip), `npm run lint`, `cargo check --features
  fa-inference`, and the golden replay (`phase4-handoff-replay-sync.test.ts`,
  6/6) all re-confirmed clean during dossier assembly — no code touched.
- **Net effect on Stage 1 lock blocking list (line ~3876 of the plan doc):**
  item (d) is now a short owner read instead of an open-ended dig; items (a),
  (b), (e) remain open and are not resolved by this pass. Longest remaining
  pole: (b), the fr/de/pt corpus gap — data acquisition in three languages,
  not verification of data that already exists.

**FA replay gate — mutation test and extension (WS1 Session A.5, 2026-08-16).**
The gate R10 asked for was supposed to replay derived boundaries through
`faAnchors.ts`'s `findAgreeingSilence`. What shipped at 37e9271 imported
nothing from `src/` at all — it read `scripts/fixtures/` CSVs and asserted
values inside them. Measured, not assumed: five temporary mutations of
`findAgreeingSilence` (each applied alone and reverted) were run against both
the original gate and an extended one.

| Mutation | What it does | Original gate (8 tests) | Extended gate (12 tests) |
|---|---|---|---|
| M1 | anchor shifted +1 token index | 🟢 8/8 pass | 🔴 4 fail |
| M2 | anchor time shifted +0.3s | 🟢 8/8 pass | 🔴 4 fail |
| M3 | agreement check disabled (nearest silence at any distance) | 🟢 8/8 pass | 🔴 4 fail |
| M4 | selection preference inverted (furthest within tolerance) | 🟢 8/8 pass | 🟢 12/12 pass — see below |
| M5 | **items-6/7 error class reproduced at a currently-correct boundary** (v6 anchor 460.56, the chunk holding the ear-verified 457.83 seam) | 🟢 8/8 pass | 🔴 2 fail |

**M4 is not a gate hole — it is unexercisable on this corpus, proved rather
than argued.** Session A measured 0/481 anchors with more than one competing
silence within `ANCHOR_AGREEMENT_SEC` of the same token; where there is
exactly one candidate, "nearest" and "furthest" select it identically. Run
under M4, the anchor/run/chunk digests come back byte-identical on all three
corpora. Only new corpus material with genuinely competing silences could
exercise it.

**Extension (`scripts/phase4-fa-replay.test.ts`, third describe block, +4
tests → 12).** Replays the anchor path through the REAL production functions
(`computeRuns`/`computeFaChunkPlan` → `computeFaAnchors` →
`findAgreeingSilence`), still fully offline from committed fixtures — no
model, no `ORT_DYLIB_PATH`, no network. Pins per corpus: run count, accepted
anchor count, chunk count, Model P gaplessness over the run partition, and
sha256 digests of the anchor time set / run partition / chunk plan; plus four
NAMED chunk windows spelled out in full (the two windows that produce items 6
and 7, and the V6 seam 150/151 control). **Why the chunk plan is the complete
cut:** `findAgreeingSilence` reaches a committed boundary through exactly one
channel — anchors → runs → chunk plan → Rust — and ONNX inference is
deterministic in (audio window, text), so identical chunk plans give identical
FA words. Any boundary movement this function causes must first appear as a
chunk-plan diff. **Fidelity measured, not assumed:** the offline
reconstruction matches the real production capture
(`.work-phase4/replay/*/fa_production_chunks.json`) 280/280 (v6) and 118/118
(173) chunks byte-identical; Spanish differs at one forced-split boundary
(recon 61.36 vs captured 65.58) precisely because that capture predates
616abb2 — the same staleness item 9's manifest note records. **Still a change
detector, not a correctness assertion:** the pinned values include the
known-bad windows exactly as they are wrong today. **What it still cannot
do:** replay the inference leg itself (chunk plan → FA words →
`snapCoveredBoundaries` → boundary). Session B still owes a real FA
re-capture. Cost: the gate goes from 0.3s to ~11s (V6's Hirschberg pass over
3900×3998 words dominates), so its two heaviest tests carry an explicit
120s timeout.

**Second re-pin and second mutation re-run (WS1 Session B.1, 2026-08-16, owner ruling
R-AA).** The gate was pinned to the instant reading's 16 movers; R-AA moves 4, so 4 of its
13 tests went red on rows this session expected by name (item 11's revert, the two
anchor-path digest sets, and the NAMED_WINDOWS indices). Re-pinned in the same commit as
the code, with the movement recorded in §11 — full before/after row diff there. **The
mutation matrix was re-run against the re-pinned values, because a second consecutive
re-pin is exactly when a gate gets quietly de-fanged:** M1, M2, M3 and — the one that
matters — **M5, the items-6/7 error class reproduced at a currently-correct boundary, all
still go RED** (M5 on 2 tests, the others on 4). **M4 remains a true no-op, reconfirmed by
chunk-plan equality on all three corpora rather than by the gate staying green** — the
candidate set changed again with this ruling, so inheriting A.5's conclusion would have
been unsafe. Chunk-plan fidelity against the real production capture re-verified unchanged
(v6 280/280, 173 118/118 rows identical at HEAD's own plan; spanish 3/5, the documented
pre-616abb2 staleness). The item-6 positive assertion at 174.74 has now survived BOTH
re-pins untouched.

---

### §10. Non-English Normalizer Gap

**Legacy path — `src/services/textNormalize.ts`** (used by `alignScenestoTranscript`'s
Hirschberg matching on both sides — scene-doc words and Whisper tokens):
- `foldUnicodeHygiene` (`:157-164`) only NFC-normalizes and standardizes quotes/dashes/
  zero-width chars — does NOT ASCII-fold diacritics (é/ñ/ç/ß survive this step).
- **`canonicalize()` step 10, `textNormalize.ts:247`: `t.replace(/[^a-z0-9\s-]/g, ' ')`**
  — the actual destruction point. Any character outside `a-z0-9\s-` is stripped to a
  space, including every native diacritic for es/fr/de/pt. Applied symmetrically to both
  Hirschberg-matching sides, so it doesn't break alignment internally — but the output can
  never carry the diacritics a CTC vocab needs.
- **Must stay byte-identical** — frozen English alignment baseline invariant (`CLAUDE.md`
  Testing section). Do not touch as part of any FA work.

**FA path — `src/services/faTextNormalize.ts`:**
- Deliberately parallel, not built on `canonicalize`.
- Per-character, per-language vocab-membership check against the real jonatasgrosman model
  vocabs; vocab-conditional typographic folding (a smart quote folds to `'` only if `'` is
  actually in that language's vocab, otherwise dropped, never substituted outside-vocab);
  German `ß`→`ss` applied before the vocab check (German vocab has no `ß` at all).
- Pure function, no I/O — caller supplies `vocabChars` (sourced today from
  `scripts/fixtures/fa-vocab-<lang>.json`). 40/40 unit tests pass (live-verified this
  consolidation pass). **Real caller since 2026-08-15 (Phase 3b Slice 1):**
  `computeFaChunkPlanWithAttribution`'s optional `languageCode`/`vocabChars` params
  (`faChunkPlan.ts`) — opt-in only, no production/dev path passes them yet, so this
  remains production-inert; own header's "NOT WIRED INTO ANY PIPELINE" now describes
  only the live production/dev call path, not the module's reachability.
- Rust port: `src-tauri/src/fa/text.rs:435`, byte-identical, 36 corpus entries, all 5
  languages (§4/§5).

**Correction (2026-08-15, Phase 3b Slice 1 investigation):** item 1 below, as
originally worded, overstated the gap — `FaChunk.text` was traced end to end and
found to already carry RAW (un-ASCII-stripped) `seg.text`/token text in both
attribution modes, never routed through `canonicalize`. Diacritics already reach
Rust's `fa_align_dev` intact; Rust's own port normalizes them there. `canonicalize`
is used inside `faChunkPlan.ts` only for `qi` word-count bookkeeping, never for the
`chunk.text` payload. Item 1 is now DONE as plumbing (see changelog below); it was
additive, not a fix to a live diacritic-loss bug.

**Action items before non-English FA can ship:**
1. ~~Wire `faTextNormalize.ts` into `src/services/faChunkPlan.ts`'s chunk-building
   path~~ — **DONE, 2026-08-15 (Phase 3b Slice 1, plumbing only, see changelog and
   the correction above).**
2. Do NOT touch `textNormalize.ts`/`canonicalize` — must stay byte-identical.
3. Land Phase 3b (language-keyed normalization: contractions, numbers, currency for
   fr/de/pt) — **IN PROGRESS — owner: project owner** (§3; ownership assigned
   2026-08-15). **Rule 1 (French elision) DONE, 2026-08-15 (Phase 3b Slice 2, see
   changelog).** **Rule 2 (Spanish cardinals 0-30) DONE, 2026-08-15 (Phase 3b
   Slice 3, see changelog) — 31+/other-languages/decimals/currency/thousands
   separators remain unstarted.**
4. Phase 3c (hyphen-asymmetry) — **CLOSED, 2026-08-15, by written acceptance, no code
   change** (§3, §11 item 8) — no longer blocks Stage 1 lock. `textNormalize.ts` is
   unchanged by this closure, consistent with item 2's byte-identical constraint.
5. Source real `fa-vocab-<lang>.json` files for the production build path (today only
   under `scripts/fixtures/`) and wire them into `faTextNormalize.ts` at the eventual
   chunk-building call site.
6. **Wire `project.language`/`vocabChars` into the two real `computeFaChunkPlan(
   WithAttribution)` call sites so `normalizeForForcedAlignment` gets a production
   caller (today: neither site passes the optional params Slice 1 added — see the
   2026-08-15 Phase 3b Slice 1 changelog entry).** Answered and logged here per this
   session's own bookkeeping-drift close-out, so it isn't silently wired later without
   a record of why it waited:
   - **Which call site(s):** BOTH, eventually. `App.tsx`'s `fa_align_dev` handler
     (`:3540` resolves `language`, `:3569` calls `computeFaChunkPlan` two lines later —
     mechanically trivial to wire) and the future capability-gated production-wiring
     slice (§11 item 1), whose real `fa_align` caller will mirror the same call shape.
   - **Where the language value comes from:** `project.language` — the same field in
     both cases, not a separate value. Set by Whisper's `-l auto` detection or an
     explicit user override and sticky once set (`CLAUDE.md`'s Sync/Whisper
     invariants) — there is no separate "2a auto-detect result" distinct from
     `project.language`; that detection IS what populates the field.
   - **Which phase owns making the connection:** the capability-gated production
     wiring slice (§11 item 1) — itself sequenced (Option B, 2026-08-15 changelog
     entry) to not start until Phase 3b and 3c both land. The `App.tsx` dev-path half
     is technically unblocked today, but was deliberately left unwired at Slice 1 (its
     own scope note: "No fr/de/pt rules added") and stays that way here too: wiring it
     now would only ever exercise `scripts/fixtures/fa-vocab-<lang>.json` test data,
     since item 5 above (real vocab files for the production build path) hasn't
     landed — wiring the dev path ahead of item 5 would not unblock anything real, so
     both halves of this item wait on item 5 and/or §11 item 1, not on each other.

**fr/de/pt corpus status:** Spanish exists and is verified (§6). French/Portuguese/German
narration-script corpus remains completely absent — the fr/de/pt e2e alignment *fixtures*
(D5, `scripts/fixtures/fa-e2e-alignment-{fr,de,pt}-*.json`) used real `google/fleurs`
public-corpus audio for engine-parity testing, which is a different thing from a real
narration-script corpus for boundary-quality verification. Accepted in writing under H.8's
dormant-rules allowance (`sync-pipeline-v2-plan.md`) — reopens the moment fr/de/pt-specific
code ships (Phase 3b).

---

### §11. Terminal Path to WS1 Completion

**2026-08-18 (WS1 SESSION M) — THE MOST MATERIAL DISCOVERY OF THE PROGRAMME: FORCED ALIGNMENT
HAD NEVER ONCE EXECUTED INSIDE THE APPLICATION. RUNTIME BUNDLED PER R-N, ERROR SURFACED,
AUTO-DETECT FIXED, PRE-FLIGHT SHIPS, THE CLASS IS SHUT.**

**(a) The finding, and why it outranks item 1's own "PRODUCTION PATH WIRED" status below.**
Three live app runs (v6 auto-detect, v6 English, spanish) all produced an FA fallback. The
first was `unsupported-language` (the auto-detect gap, (c) below); the other two were
`inference-error` with a discarded detail. Reproducing directly against the code: `load_session`
(`fa_onnx.rs`) reads `ORT_DYLIB_PATH` first and returns `OrtInit("ORT_DYLIB_PATH not set")` when
absent — and the app process never sets it. Every fixture, every mutation-matrix number
(M1-M8), every measurement this document cites for FA was produced by the `cargo test`/Python-
spike driver, which set that variable to a dylib inside `.work-phase4/spike-runtime`, gitignored
scratch outside the repo's control. **Everything "PRODUCTION PATH WIRED" (item 1's own status
line, §3's Task 5 row) has meant, up to this session, is that the code compiles and the IPC
plumbing is reachable — never that it has run.** This is stated as MEASURED fact (the error is
reproduced from the code path directly), not inferred.

**(b) Runtime version, resolved authoritatively.** ort-sys `=2.0.0-rc.13`'s `version.rs`
(read directly, not from memory): `ORT_API_VERSION = 17` under this crate's feature set (no
`api-NN` enabled). Requires onnxruntime C-API **≥ 17 (≥ 1.17.0)**. Both dylibs on the
investigating machine (1.22.0, 1.23.2) clear it. **The version pair was never the cause** —
confirmed by the fact that `load_session` fails on the `ORT_DYLIB_PATH` line, before any
dylib is opened or its version read.

**(c) Auto-detect was throwing away information Whisper already had.** `runForcedAlignmentForSync`
read `project.language` alone; an auto-detect run's detection lands there only when the STICKY
field was previously unset (H.7's "written once" rule), so a project could carry a correct
detection the gate never saw. Fixed with a new non-sticky `Project.detectedLanguage` (written
unconditionally by every `-l auto` run) and `faGate.ts::resolveFaLanguage` feeding it to the
gate as a fallback behind the sticky choice.

**(d) R-N (Session G's ruling, `sync-pipeline-v2-plan.md:2641`, "ship and sign the dylib as a
bundled resource, and set `ORT_DYLIB_PATH` at runtime to that resource path") is IMPLEMENTED.**
`src-tauri/onnxruntime/` bundles `libonnxruntime.1.23.2.dylib` (osx-x86_64, sha256
`8c9c78de65ea3786f987c0d980e9c1b13a3a5fbc6b3e2965ba05b450e6e4c054`) via `tauri.conf.json`'s
`bundle.resources`; `fa_onnx.rs::ensure_ort_dylib` resolves it from `resource_dir()` (dev/exe-dir
fallbacks mirroring `whisper.rs::model_path`), hard-gates architecture (macOS x86_64 only; any
other target fails loudly, never silently), and sets `ORT_DYLIB_PATH` only when unset —
preserving the entire existing `ORT_DYLIB_PATH`-based test-skip convention as an override, not
replacing it. `ensure_ort_dylib` runs from `align_chunked_for_language`, the one production
choke point holding a live `AppHandle`.

**(e) A new pre-flight (`fa_preflight.rs` + `faPreflight.ts`) reports FA readiness** —
capability, resolved language, runtime library load, model presence — as a durable
`fa-preflight` sync-log entry BEFORE inference, so a doomed run is visible before several
minutes of Whisper work rather than after. The FA-fallback entry itself now surfaces its
backend `errorMessage`/`fixHint` in the Sync Log panel — `SyncLogPanel.tsx`'s
`formatDetailLine` silently dropped it for this one entry type before this session.

**(f) The class is shut.** `scripts/onnxruntimeBundle.guard.test.ts`: GUARD 1 fails the build
if any shipped runtime resolver or bundle config names throwaway scratch
(`.work-phase4`/`spike-runtime`/the phase-4 venvs/listening-clip stores); GUARD 2 fails if the
committed manifest's onnxruntime API version drifts from what the pinned `ort` computes, or the
pin itself moves without a re-derivation. Same shape as `faDefaultDrift.test.ts`.

**(g) Four debts Session L left open are disposed, reconciled into this session's commit (not
reverted):** M8-B (R.13's carrier-line guard, green/uncovered → red/covered, both
`faRunPlacementGate.ts`/`.test.ts` and `scripts/phase4-fa-replay.test.ts`); the R.5
parse/committed index-convention divergence (measured with a constructed dropped-scene input,
`syncLog.indexConvention.test.ts`); Contract 1→2 P6's Spanish-corpus vacuity (closed above,
§9's P6 row); the runtime's own scratch-directory dependency (this session, (d)/(f) above).

**Status: Steps 1-4 and 7-8 of this session's brief are DONE. Steps 5-6 — prove FA runs
end-to-end in the app with per-project wall-clock, and compare live boundaries against the
frozen fixtures — are OWED to the owner's own hands (no GUI automation used).** Full numbers,
file list and exact click steps: this document's Changelog entry and
`docs/ws1-sync-pipeline/stage1-live-run-prep.md`.

---

**2026-08-18 (WS1 SESSION K) — THE 24-ROW MOVER AUDIT SCORED 22/24; BOTH FAILURES
ROOT-CAUSED; R.13 SHIPPED; A THIRD DEFECT FOUND IN THE DISPLAY PATH; RULING R-AO RECORDED.**

**(a) Clip 1 — 173 `protection_failure` @ 603.69 — NOT A DEFECT, and the contradiction with the
earlier pass is resolved.** The committed value is the exact millisecond midpoint of the
forced-alignment gap between `on` [603.600, 603.660] and `for` [603.720, 603.800], **both at
confidence 1.000** (`.work-phase4/replay/173/fa_production_words.json`, the
`fa_align_production` capture). The two scenes split ONE sentence mid-way ("…everything a
military force depends on" ‖ "for sustained operation, ceases to function…") and there is **no
detected silence anywhere in [598.04, 604.82]** — one continuous 6.8 s utterance. The ear
question therefore has no answer at 603.69 or at any other value in that span.

*The contradiction, settled by git and by neither of the two proposed branches.* `git show`
across `580ba0f → 55301be` on `phase4-fa-second-baseline-173-segments.csv`: the value is
**603.69 at every commit** (R-U moved it to 612.51, R-AA reverted it in `52140e5`, before the
OV3 triage scored it). The text never changed either. What changed at `3faf0ea` is the `order`
field, **146 → 144**, R.10's two-drop reindex — and, decisively, **the presentation**: the OV3
triage (§11(i), Session D) showed *window + boundary only, no text at all* and was scored
Correct; the mover audit quotes both sides and was scored NO. Without text, the nearest audible
pause is 605.06, 1.37 s away, and reads as "the boundary". Both verdicts are honest; the earlier
one answered a weaker question. **Owner ruling: verified CORRECT in the app, and mid-sentence /
no-silence splits STAY in future ear draws** — no exclusion rule — so that FA's handling of
boundary edge cases keeps being checked. Pinned as a control in `phase4-fa-replay.test.ts`.

**(b) Clip 12 — v6 `225_night_scouts` @ 667.47 — A REAL DEFECT. Exit K2 does NOT fire.** All
ten v6 recitations were measured on **both** edges through production `computeUnscriptedRuns` +
`alignScenestoTranscript` — a measurement no session had taken. **Ten of ten opening edges are
clean** (R.12's half holds, including the four provisional closures the owner has now
ear-verified — rows 13/14/23/24 of the audit, so the provisional label is dropped). **One of
ten closing edges is wrong.** R.12 is not broadly half-built.

| run | recitation | carrier | opening | closing | carrier's own line ends | closing defective? |
|---|---|---|---|---|---|---|
| 0 | Level one… | `001_child_seven` | 0.000 | 5.640 | 5.050 | no |
| 1 | Level two… | `042_eleven_years` | 125.540 | 130.960 | 130.140 | no |
| 2 | Level three… | `085_the_spear_bearer` | 250.690 | 256.740 | 256.200 | no |
| 3 | Level four… | `125_night_circle` | 370.750 | 378.900 | 377.990 | no |
| 4 | Level 5… | `176_twenty_six_scout` | 521.710 | 528.090 | 527.110 | no |
| **5** | **Level 6…** | **`224_thirty_three`** | **663.785** | **667.470** | **667.730** | **YES** |
| 6 | Level 7… | `266_forty_one_burden` | 788.650 | 794.190 | 793.030 | no |
| 7 | Level 8… | `307_forty_nine_years` | 924.920 | 931.400 | 930.310 | no |
| 8 | Level 9… | `340_fifty_eight` | 1044.670 | 1051.650 | 1051.020 | no |
| 9 | Level 10… | `383_sixty_four` | 1188.950 | 1193.770 | 1193.220 | no |

**(c) THE MATERIAL FINDING — the root cause is NOT "R.12's missing half".** The exact mirror of
R.12 is buildable and threshold-free, and **it does not fix the defect**: its legal interval is
`[667.730, 668.010]`, no detected silence intersects it, and the fallback lands at **667.73 —
a +0.26 s move that is still audibly wrong**. The reason is that **both token streams are
unreliable in the region immediately after an unscripted run**, while the detected-silence
stream is accurate:

* Whisper gives token 1832 `"the"` the span **[668.650, 669.400]** — it **swallows the entire
  silence the boundary belongs in**, so no token-index construction can locate that seam.
* FA's confidences there collapse to **1e-5 … 1e-4 against a corpus median of 0.9985**
  (`you` 9.95e-06, `are` 3.58e-04, `thirty-three` 2.46e-05, `night` 9.96e-07), because R.5
  excised the run using Whisper's own smeared span — computed **[663.910, 666.480]** vs the
  owner's ear **[664.99, 667.31]**, ~1.0 s off — so FA was never offered the right frames.
* Confidences are **continuous, not zero** (0 occurs 0 times in 3874 words; <1e-6 occurs 337),
  so no threshold-free `== 0` test exists the way R.5's `qiHole == 0` did.

R.12's opening edge works precisely because it anchors on `prevToken.endSec`, a token **before**
the run, outside the unreliable region.

**(d) R.13 — THE ATOMIC-UTTERANCE INVARIANT, built.** In `faRunPlacementGate.ts`, deliberately
the same file as R.12 (R-AO). Detection: the closing boundary of a run-carrying scene may not
lie before that scene's own utterance ends. Placement: the midpoint of the **first detected
silence starting at or after the carrier's own last matched token ends**. No threshold anywhere;
`R12_MIN_CORRECTION_SEC` is reused only as the shared don't-churn epsilon.
**Predicted blast radius 1 of 649, before implementation. Actual 1 of 649** — v6
`225_night_scouts` **667.47 → 669.05 (+1.580 s)**, the midpoint of detected silence
[668.700, 669.400], which brackets the owner's ear ("…till 668.85s, then at 669.37s started
'You lead the night scouts'"). The fixture diff is **2 insertions, 2 deletions**. 173 and
spanish have zero unscripted runs and are untouched.

*A rejected design, recorded because it was measured and is wrong:* a silence-ORDINAL rule
("skip the first silence after the run") fires on **6 of 10** recitations, five of them
boundaries the owner has already verified — stop-and-rule exit K3 by construction. The
discriminator is the carrier's own-utterance END, not a count.

**(e) THE THIRD DEFECT — the index convention, in shipped code, not in a document.** Found
while tracing parse → drop → commit → display as Step 1 required. **R.10's and R.11's findings
are PARSE-indexed; R.12's and R.13's are COMMITTED-indexed; `syncLog.ts` rendered both as
"Scene N + 1".** Measured through the production detectors and the shipped log builders against
the pre-correction fixtures: on 173, R.11 emits *"R.11 moved scene **6** (abysmal_opinion)"* for
a scene the timeline shows as **scene 5** (+1 before `blue_monkey`, +2 after it). Invisible on
v6 and spanish, which have zero drops — which is why no earlier session saw it.

**Committed timings are unaffected**: `applySeamFitCorrections` and
`applyRunPlacementCorrections` both match by `segmentId`, never by index. This is display-only —
and it is the WORSE class the brief named, because `types.ts` had *recorded the claim* that the
conventions were uniform and that claim had never been executed. Session J fixed the identical
off-by-two in `stage1-live-run-prep.md` §5.3 and did not check the code.

*Fixed:* one resolver, `syncLog.ts`'s `committedIndexOf`, by segment id; every rule-correction
entry now carries a COMMITTED index or **none at all** (R.10's scenes are dropped and have no
committed index — the script position moves into the message). R.5's owning-scene containment
scan moved from `anchorTimed` (pre-snap estimates, parse indices) to the final committed array,
with its log entries staged and spliced so the documented R.5→R.10→R.11→R.12→R.13 order is
unchanged. `types.ts`'s false claim is replaced by the two real conventions.
*Verified NOT a defect, rather than assumed:* `buildLockFindingLogEntries` also assigns
`segmentIndex: f.segmentIndex`, and its `LockFinding` comes from
`applyAnchorBasedTiming(prev.segments, …)` in `handleToggleLock` — already committed. Recorded
so it is not re-audited blind.

**(f) Ruling R-AO — the both-sides rule, with a machine check.** Full text in
`sync-pipeline-v2-plan.md`. Enforced by `ruleBothSides.test.ts` (every rule module must declare
BOTH SIDES with real content, or SINGLE-SIDED plus why and who owns the other side) and
`syncLog.indexConvention.test.ts` (no rule-correction builder may copy a detector index).

**(g) Register.** REOPENED at 1 and closed in the same commit: `r13-225-night-scouts`,
`earCorrect: 669.05`, **`verification: 'structural'`** — the owner scored the OLD value wrong,
which is not the same as scoring the NEW one right. It is row 4 of
`stage1-session-k-ear-list.md`. `REGISTER_HIGH_WATER` 0 → 1 → 0. Clip 1 is **not** a register
entry (it is not a defect); the display defect is **not** a register entry (the register is for
committed boundary defects, and no committed value moved) — both stated so the omissions are
deliberate rather than overlooked.

**(h) Mutation matrix, run this session, reported including the green one.**
M5 (drop R-U's structural veto in `faAnchors.findAgreeingSilence`) **RED, 3 failures** —
fifth consecutive re-pin; `faAnchors.ts` sha256 `b61e94cb…` unchanged, verified after restore.
M6 (drop R.11's conjunct 3) **RED, 1 failure**. M7 (drop R.12's clamp) **RED, 9 failures**.
M8-A (replace R.13's anchor with the next scene's first-token onset — the naive R.12 mirror)
**RED, 5 failures**. **M8-B (drop R.13's after-the-run guard) GREEN — reported as green.** That
guard is provably unreachable once R.12 has run (proof in its own comment); it is kept as a
defensive restatement of R.12's precedence for callers passing an uncorrected array, and is
**not claimed to be covered**. M9 (reintroduce the index-convention defect) **RED, 4 failures**.
M10 (delete a BOTH SIDES declaration) **RED, 1 failure**.

**(i) One process defect this session produced and fixed in itself.** The first R.13 prediction
harness mapped committed segments into the aligner by their `order` column — the committed
index — and so reproduced the very off-by-two under investigation, reporting 170 of 172 173
boundaries as defective. Caught by the result being implausible, not by a test. Recorded because
it is direct evidence for R-AO: the two index spaces are easy to confuse even while actively
looking for confusions between them. Separately, the fixture re-pin turned five tests red until
`V6_PRE_R12` was extended with `225_night_scouts` — the reset table listed only R.12's movers,
and R.13 added one. Both are now covered by comments at the sites.


Ordered by real dependency, not convenience. Owner rulings D1/D2 (§7) already fixed the
first sequencing question (`task5-integration-scope.md` §4's own recommended order):
ruling → R.2 padding → R.5 destination ruling → capability-gated production wiring →
R-H judgement. R.2 is done (closed-negative); R.5's destination is decided; what's left
starts at production wiring — itself now re-sequenced by the Option B gate-sequencing
decision (2026-08-15, item 1 below) to start only after Phase 3b/3c land, not immediately.

**Already complete, not on the critical path:** task 1 (Apply Sync history-entry fix),
task 8 (K13 fix) — see §3.

**Ready now, in parallel (nothing blocking any of them, except item 1 — see its
sequencing note):**

1. **Capability-gated production wiring slice. DONE — WIRED, GATE OFF, 2026-08-15.** *Goal:*
   a non-dev, `isFaGateOpen()`-gated caller of `fa_align` reachable from the real running
   app, replacing the DEV-only-`fa_align_dev` path for real Apply-Sync timing.
   *What actually shipped (this session, scope deliberately bounded — does NOT turn FA on,
   does NOT produce the R-H second golden baseline, does NOT measure FA timing quality; see
   item 6 below for what's still needed):*
   - **Rust:** `fa_dev.rs`'s `fa_align_dev` body extracted into `pub(crate) async fn
     resolve_wav_and_align(...)` (model-manifest verify, content-addressed audio decode,
     `fa::ensure_durable_wav`, delegate to `fa_align` — unchanged behavior, byte-identical);
     new `src-tauri/src/fa_production.rs`'s `fa_align_production` is a thin wrapper calling
     the same helper under its own temp-cache namespace (`kinetix-fa-production-inputs`, vs.
     `fa_align_dev`'s `kinetix-fa-dev-inputs` — a real production call and a devtools call
     against the same audio content can never collide). Registered in `lib.rs`'s
     `invoke_handler!`. No gate on the Rust side — exactly like `fa_align`/`whisper_transcribe`,
     gating is the frontend's job.
   - **TS:** new `src/services/forcedAlignmentRun.ts`'s `runForcedAlignmentForSync` — mirrors
     `__faDevAlign`'s own audio-fetch/chunk-plan/`Channel<FaEvent>` steps, calls
     `invoke('fa_align_production', ...)`, reshapes a successful `Done` via
     `faWordSpansToTranscriptTokens`. **Fail-clean contract: never throws** — unsupported
     language, empty chunk plan, any IPC rejection (`ModelNotFound`/`InferenceFailed`/
     `ModelHashMismatch`/`Cancelled`), or an `FaEvent::Error` all resolve to `null`, not a
     thrown error.
   - **App.tsx** (`:2792-2837` insertion point, §8 — confirmed accurate at this session's
     start, unchanged by this session): between `applyAnchorBasedTiming` (anchor-timed,
     not-yet-committed segments) and the `alignFromCache` call, a new branch calls
     `runForcedAlignmentForSync` iff `isFaGateOpen()`; its result (or `null`) replaces
     `projectRef.current.transcriptTokens!` at the `tokens` argument exactly as §8 described.
   - **R-G (anchorSource):** `distributeSegmentTimes` (`whisperService.ts`) and
     `alignFromCache`/`alignSegmentsFromCachedTranscript` (`useWhisper.ts`) each gained an
     optional `anchorSource: 'whisper' | 'forced-alignment'` parameter, defaulting to
     `'whisper'` — both pre-existing call sites (this function's own live Option-A path,
     and `useWhisper.ts:294`'s other `distributeSegmentTimes` call) are byte-identical by
     construction (untouched, default parameter). The new FA branch passes
     `'forced-alignment'` explicitly only when `runForcedAlignmentForSync` actually
     succeeded — never inferred, exactly as R-G requires.
   - **`faWordTimings` writer** (`types.ts:401`, schema existed, unused): now written on the
     single Apply-Sync commit (`App.tsx`'s `setProject` call) — set to the FA word tokens
     when FA succeeded this run, explicitly cleared (`undefined`) otherwise, per the
     clean-slate re-sync invariant (CLAUDE.md) — a project never carries a prior run's stale
     FA word timings forward.
   - **R-E / Model P:** untouched by this slice — no new gap-emission path was introduced;
     `computeFaChunkPlan`'s existing empty-run-folding behavior (assigns a textless/wildcard
     span to the preceding chunk) is reused unmodified.
   - **R-J (`preserveSegmentLocks`):** untouched — still called at its existing
     post-`autoMatchSegments` site (`App.tsx:3071`, shifted only by this session's earlier
     line insertions, not moved into `applyAnchorBasedTiming` or anywhere else).
   - **Tests:** `src/services/forcedAlignmentRun.test.ts` (9 tests — every fail-clean branch:
     unsupported language, undefined language, empty chunk plan, IPC rejection, `FaEvent::Error`,
     zero-word `Done`, synchronous-throw safety, plus 2 success-path tests) and
     `src/services/whisperService.anchorSource.test.ts` (5 tests — default/explicit `'whisper'`,
     explicit `'forced-alignment'`, uniform application across segments, locked-segment
     exemption). Deliberately separate files from the regression-locked `syncTiming.test.ts`
     (CLAUDE.md's Testing invariant) — this session touches none of its cases.
   - **Follow-on, 2026-08-15 (smoke-test session): real end-to-end run DONE — quality
     review (item 6) still NOT done.** `fa_align_production` reached and returned `Done` for
     real, against the real V6 corpus project (447 segments, `en`) via the actual Apply Sync
     UI path (gate flipped on through `ProjectSettingsModal.tsx`'s real toggle, not a test
     harness): all 447 segments committed with `anchorSource: 'forced-alignment'`,
     `Project.faWordTimings` persisted (3874 words), wall-clock ~231s for the full chunked
     run. Full provisioning trail (model/dylib discovery, the two failed attempts and their
     root causes, exact reproduction steps) recorded in the changelog entry below — the
     short version: a prior session had already fully provisioned all 5 `model.onnx` files
     and a matching `libonnxruntime.dylib` existed in an unrelated project venv; the only
     real blocker was operational (`ORT_DYLIB_PATH` not reaching the actual running process),
     not a code or provisioning gap. **Still NOT done, still needs item 6:** no second golden-
     baseline pass, no per-boundary quality review, no judgement on whether FA timing is
     better or worse than Whisper's — this session was reachability/plumbing only, explicitly
     out of scope for quality. Zero `src/`/`src-tauri/` changes — see the changelog entry.
   *Exit criteria (met):* a real `invoke('fa_align_production', ...)` call exists in `src/`,
   gated by `isFaGateOpen()`; toggling the existing Settings control (ProjectSettingsModal.tsx,
   already wired since D17 — no new UI needed this session) changes which timing source Apply
   Sync uses; golden replay still 6/6 with the gate OFF (byte-identical default behavior — the
   "3/3" this criterion was originally written against is stale wording predating the replay's
   growth to 6 cases, corrected here in passing). *Discharges:* the "capability-gated
   production wiring" item named throughout §4/§6/§7. *Verified this session:* `npm test`
   82 files/2107 passed/1 skipped (was 80/2093/1, +2 files/+14 tests, 0 regressions); `npm run
   lint` clean; `cargo check` clean both configs; `cargo test` 132 passed (unconditional,
   unchanged); `cargo test --features fa-inference` 206 passed/19 ignored (unchanged — 0 new
   Rust tests, since `fa_align_production` has no testable surface beyond what
   `fa_align_dev`'s existing tests already cover through the shared `resolve_wav_and_align`
   helper); `cargo clippy --features fa-inference` 4 pre-existing warnings, 0 new (the
   refactor's two new multi-argument Tauri-command-shaped functions were
   `#[allow(clippy::too_many_arguments)]`-annotated, matching `fa_align`/`fa_align_dev`'s own
   already-accepted shape, rather than left as new warnings); golden replay
   (`scripts/phase4-handoff-replay-sync.test.ts`) 6/6, unchanged — the core proof that gate-off
   is byte-identical to `a5d7ca1`. *Depends on:* §7 item 2 (R.5 whether/when) — DEFERRED
   2026-08-15 (see that item), so this slice shipped without R.5, matching that ruling exactly.
   **Sequencing block (Option B, 2026-08-15): LIFTED, 2026-08-15,** satisfied before this
   session started (Phase 3b/3c both landed) — see the Phase 3 row (§3 above).
2. **`FaEvent` → UI progress consumer.** *Goal:* a real progress bar/status consumer for
   `FaEvent::Progress`/`Done`/`Error`, mirroring `useWhisper.ts`'s existing pattern for
   `WhisperEvent`. *Files:* new hook (e.g. `useForcedAlignment.ts`) consuming
   `Channel<FaEvent>`; a UI component. *Exit criteria:* a real component in
   `src/components/` or hook in `src/hooks/` imports `FaEvent`/`Channel` (today: zero,
   grepped). *Depends on:* slice 1 landing a real caller to report progress for.
3. **R.7 threshold ratification + the two unbuilt failure paths.** *Goal:* close the R.7
   coverage gap (§4/§6) and build the skip-and-flag / force-split failure paths R.7's spec
   names but no code implements. *Files:* `fa.rs` (the two new match arms), a deliberately
   low-confidence fixture (none exists today). *Exit criteria:* a fixture exercises the
   reject branch below `CONF_MIN`; both failure paths have a passing test. *Depends on:*
   nothing technical — engineering work only, per the known-gap register.
4. **R.3/R.8/R.9 build-out.** *Goal:* implement the clamp-reference-point change (R.3) and
   the two documented-but-unbuilt design sections. *Files:* `fa_onnx.rs`/`faChunkPlan.ts`.
   *Exit criteria:* `sync-pipeline-v2-plan.md`'s Step R design for R.3/R.8/R.9 has a
   corresponding implementation, tested against the same zero-tolerance standard the rest
   of Task 5 holds itself to. *Depends on:* nothing named as blocking — design-only today,
   genuinely just unbuilt.
5. **R.5 build (if the owner rules "build now" at §7 item 2).** *Goal:* the two-layer
   wildcard mechanism (`faChunkPlan.ts` per-segment text spans + `fa_viterbi.rs` zero-cost
   wildcard DP state). *Exit criteria:* a real unscripted-audio test case (segment boundary
   inside a chunk with genuine off-script speech) resolves via the wildcard rather than
   silent absorption. *Depends on:* the §7 item 2 owner ruling; naturally combines with
   slice 1 if built, since both touch `FaChunkInput`.
6. **R-H second-baseline pass. DONE — MEASUREMENT COMPLETE, 2026-08-16.** *Goal:* run the
   golden-baseline replay a second time against real jonatasgrosman per-language model
   output and review per-boundary. *What ran:* a real Rust `fa::fa_align` capture — the
   exact same function `fa_align_dev`/`fa_align_production` delegate to — called directly
   against real corpus audio (`.work-phase4/replay/<key>/audio_16k.wav`) and the real
   production chunk plan (`computeFaChunkPlan`, script-word-index attribution, the same
   call `runForcedAlignmentForSync` makes), via a scratch `tauri::test::mock_context`
   harness mirroring `fa_durable_wav_live.rs`'s own pattern (not committed — removed after
   use, per this session's own scope discipline). Bypassed only the base64-encode/durable-
   WAV-cache plumbing layer (`resolve_wav_and_align`), a disclosed simplification — the
   audio fed in is already the exact 16kHz mono WAV that layer itself produces. Output fed
   through the identical production pipeline the golden-replay harness itself runs
   (`filterMalformedTokens` → `alignScenestoTranscript` → `distributeSegmentTimes`
   (`anchorSource='forced-alignment'`) → `applyAnchorBasedTiming` → coverage gate →
   `filterToCoveredSegments` → `snapCoveredBoundaries` → `headExtendFirstSegment`), matching
   `App.tsx`'s own FA substitution point (§8) exactly. **All three corpus projects
   captured** (not just V6): V6 (280 chunks, 133.1s wall-clock, 3874 words, 447/447
   segments committed, 0 skipped), 173 (118 chunks, 75.7s, 1660 words, 175/175 committed, 0
   skipped), Spanish (5 chunks, 13.6s, 249 words, 27/27 committed, 0 skipped). Output:
   `scripts/fixtures/phase4-fa-second-baseline-{v6,173,spanish}-{segments,skipped}.csv`
   (additive — the existing `phase4-baseline-*-segments.csv` Whisper golden stays
   byte-identical, confirmed by golden replay staying 6/6 below).
   **Per-boundary diff** (642 tag-matched boundaries across all three projects — skip-set
   membership differs between the two runs, see below, so matching is by segment `tag`,
   not array order): median |Δ|=0.00s, p90 0.285s(v6)/0.270s(173)/0.105s(spanish),
   max=8.67s; 45/642 boundaries moved >0.5s, 25/642 moved >1.0s. **Coverage finding:** FA
   produced **zero skipped segments on all three projects**, recovering the 3 V6 + 3 173 +
   1 Spanish segments Whisper's turbo transcript could never match at all (the historical
   "V6 skips exactly 27-29" / "173 skips exactly 0,12,111" finding — those very words are
   now covered). The single largest mover (v6 `030_watching_older_hunters`, Δ+8.67s) is
   explained by exactly this: FA's recovery of the immediately-preceding 3 skipped
   segments (`027_internal_change_face`/`028_small_permanent_flake`/
   `029_night_understanding`) shifts where the FOLLOWING segment's start boundary falls —
   not a standalone FA error. **V6 seam 153→154 reproduced on this fresh run:** FA
   457.81s vs. committed/owner-correct 457.83s (Δ0.02s) — matches the prior smoke-test
   session's own figure exactly. **Confidence characterization:** `needsReview` (< `CONF_MIN`)
   word rate 15.2%(v6)/10.5%(173)/10.0%(spanish); skews toward SHORT/function words (mean
   length 3.71 vs. 4.24 chars overall on v6), not proper nouns broadly. Bucketing matched
   segments by their own worst (min) word confidence shows **no clean monotonic
   relationship** to boundary displacement (<0.05 conf: mean |Δ|=0.120s, n=316; ≥0.9 conf:
   mean |Δ|=0.112s, n=216) — stated as a genuine non-finding, not massaged into one.
   Hyphenated-compound segments show a small but statistically thin gap (mean
   |Δ|=0.145s, n=28 vs. 0.107s, n=614 non-hyphenated) — plausible, not conclusive at this
   n. *Explicitly out of scope, not done:* no FA parameter tuning; no default-gate flip
   (`isFaGateOpen()` stays OFF); no fix attempted for anything found. *Exit criteria met:*
   per-boundary diff produced and reviewed, not blindly re-baselined — the Whisper baseline
   is untouched. *Remaining, genuinely the owner's:* the ear-verification listening list
   below (12 items) is the input the owner needs before ruling on whether FA becomes the
   default timing source.

   **Ear-verification listening list (12 items, capped per this session's own scope),
   prioritized by how much the answer would change the ruling, not purely by delta size**
   — `whisper`/`fa` are each candidate's committed-vs-fresh-FA start time; listen window is
   [start−2s, end+2s] of the relevant span:

   | # | Project | Segment | Text | Whisper | FA | Listen window | Why it matters |
   |---|---|---|---|---|---|---|---|
   | 1 | v6 | `030_watching_older_hunters` (ord 26) | "You start watching the older hunters differently." | 78.56 | 87.23 | 76.5–92.1 | Largest single mover (Δ+8.67s) — explained on paper as FA recovering 3 preceding skipped segments, not a standalone error; the one case most likely to flip the ruling if the explanation is wrong |
   | 2 | v6 | `027_internal_change_face` (whisper-skipped) | "But something stayed in you." | — (dropped) | 78.56–80.74 | 76.5–82.7 | No Whisper timestamp exists at all — is FA's placement even sane for genuinely unmatched audio? |
   | 3 | v6 | `029_night_understanding` (whisper-skipped) | "A new understanding of what the night actually is." | — (dropped) | 83.53–87.23 | 81.5–89.2 | Other end of the same recovered 3-segment run — brackets item 2 |
   | 4 | v6 | `308_scouts_leading` (ord 304) | "Three of your old scouts lead their own groups now in differ[ent parts]" | 931.40 | 928.67 | 926.7–938.3 | Second-largest mover (Δ−2.73s), no coverage-recovery explanation available |
   | 5 | v6 | `043_night_migration` (ord 39) | "On nights when the band moves between camps" | 130.96 | 128.43 | 126.4–136.0 | Δ−2.53s, part of a 2-segment consecutive-mover run with `042_eleven_years` |
   | 6 | 173 | `vessel_damage_clue` (ord 45) | "of whatever the last crew left behind, which includes whatev[er finishe]" | 174.74 | 172.91 | 170.9–181.3 | Largest 173-project mover, different corpus/register from v6 |
   | 7 | v6 | `152_frozen_brush_mice` (ord 148) | "When the brush mice stop moving through dry leaves" | 451.03 | 449.20 | 447.2–456.3 | Sits inside the same 151→153 consecutive-mover cluster as the already owner-ruled 154 seam (item 8 below) — tests whether that seam's known defect extends to its neighbours |
   | 8 | v6 | `154_silent_night_birds` / `155_predator_passing_under` seam | boundary between them | 457.83 | 457.81 | 455.8–459.9 | The owner-ear-tested seam (Phase 3c) — reproduced fresh this session (Δ0.02s); listed for completeness, already resolved (457.83 ruled correct) |
   | 9 | spanish | `023_scylla_six_sailors` (ord 21) | "Navegar cerca de Scylla cuesta seis marineros." | 65.12 | 66.73 | 63.1–70.3 | Largest Spanish mover — the only non-English check on this list |
   | 10 | 173 | `hostile_landscape` (ord 0) | "Some places in the 41st Millennium don't just kill soldiers." | 0.00 | 1.36 | 0.0–6.2 | Segment 0 / start-of-audio edge case — a boundary type none of the other movers test |
   | 11 | 173 | `blue_monkey` (whisper-skipped) | "\"The blue monkey jumped over the moon\"." | — (dropped) | 36.96–37.73 | 34.96–39.73 | The planted known-skip test string, recovered by FA — short segment, tests placement precision on a recovered case |
   | 12 | spanish | `001_scylla_intro` (whisper-skipped) | "Scylla." | — (dropped) | 0.00–1.06 | 0.0–3.1 | Single-word recovered segment at the very start of the Spanish file — smallest/hardest recovered case |

   All 12 timestamps are against each project's own `audio_16k.wav`
   (`.work-phase4/replay/<key>/`) — the same audio the app itself plays, just pre-transcoded
   to 16kHz mono. Full underlying data (all 642 matched boundaries, top-20 movers, skip-set
   diff): reconstructable from `scripts/fixtures/phase4-fa-second-baseline-*-segments.csv`
   diffed against `scripts/fixtures/phase4-baseline-*-segments.csv` by `tag` — not persisted
   as a separate report file per the single-tracker rule.

   **R-H / R-Q status, this session.** Both are defined and tracked authoritatively in
   `project-state.md` (protected file — this session does not edit it, per the standing
   process rule §7 item 4 already established). Recorded here instead, alongside a
   proposed diff for a future owner-approved pass:
   - **R-H — now FULLY SATISFIED** (was "HALF SATISFIED" as of 2026-08-12). The second
     pass ("FA swap run and reviewed per-boundary against that baseline") ran this
     session — see item 6 above for the full measurement.
   - **R-Q — RESOLVED.** `scripts/fixtures/phase4-fa-tokens-{v6,173,spanish}.json` /
     `phase4-fa-baseline-{v6,173,spanish}-words.csv` (the fixtures `scripts/phase4-
     handoff-replay-sync.test.ts`'s "R-H — forced-alignment fixture" describe block
     reads) were regenerated this session against the real jonatasgrosman per-language
     models (`measure-forced-alignment-hf.py`, Apache-2.0), superseding the barred MMS-FA
     (CC-BY-NC-4.0, Decision 3) capture — see this session's changelog entry for exact
     figures and the golden-replay re-verification (still 6/6, per-boundary reviewed, not
     blindly re-baselined — the R-H describe block's own internal-consistency assertions,
     not the segment-timing golden diff, are what this fixture pair feeds).

   > **Proposed `project-state.md` diff (NOT applied — protected file, requires owner
   > approval, same pattern as §7 item 4 above):**
   > - **R-H**, current text ends: *"Amended 2026-08-12 (R-Q): HALF SATISFIED — the input
   >   set/first baseline landed, but the second pass ("FA swap run and reviewed
   >   per-boundary against that baseline") can't happen until Task 5 wires a real model;
   >   recorded as a hard precondition on that slice."*
   > - **Proposed replacement**: *"Amended 2026-08-16: FULLY SATISFIED. The second pass
   >   ran — a real Rust `fa::fa_align` capture (jonatasgrosman ONNX, real production chunk
   >   plans) against all three corpus projects, fed through the identical production
   >   pipeline Apply Sync itself runs, reviewed per-boundary (not blindly re-baselined):
   >   `docs/work-in-progress.md` §11 item 6, 2026-08-16."*
   > - **R-Q**, current text: *"...Regenerating them against jonatasgrosman is an
   >   obligation on the FA wiring slice (Task 5), not on the text normalizer."*
   > - **Proposed replacement**: *"...RESOLVED 2026-08-16: `phase4-fa-tokens-{v6,173,
   >   spanish}.json`/`phase4-fa-baseline-{v6,173,spanish}-words.csv` regenerated against
   >   the real jonatasgrosman/wav2vec2-large-xlsr-53-{english,spanish} models via
   >   `measure-forced-alignment-hf.py`, superseding the barred MMS-FA capture. Detail:
   >   `docs/work-in-progress.md` §11 item 6 changelog, 2026-08-16."*
   **ADDENDUM to item 6 — ear-pass root-cause diagnosis, 2026-08-16 (diagnosis only; no
   `src/`/`src-tauri/` change, no tuning, gate stays OFF).** The owner completed the 12-item
   ear pass above: **5 correct, 7 wrong**. This pass attributes a mechanism to each of the
   12 and answers three specific leads. All instrumentation was reverted (working tree
   clean; `npm test` 2107 passed, `npm run lint` clean, `cargo check --features
   fa-inference` clean, golden replay 6/6 — all unchanged).

   *Evidence base:* the second baseline's own gitignored per-word artifacts
   (`.work-phase4/replay/<key>/fa_production_words.json` / `fa_production_chunks.json` /
   `fa_second_baseline_analysis.json`), each project's `transcript_tokens.json` and
   `silences_app.json`, direct RMS envelopes off `audio_16k.wav`, and two fresh real
   `fa_onnx::align_chunked` passes over V6.

   **Four mechanisms cover all 7 failures. None is unexplained.**
   1. **Unscripted audio the scene doc has no segment for — items 4, 5 (v6).** Whisper's
      own transcript shows "Level two. The boy who carries fire." at 125.54–129.01 and
      "Level 8. The one who teaches what cannot be taught easily." at 925.14–928.93; neither
      is in the scene doc. Forced alignment must place every scripted word somewhere, so the
      following scripted words are dragged backward onto that audio ("are" stretched to
      1.42s at confidence 0.0002). Whisper's matcher is free to leave those words unmatched
      and therefore is not dragged. **Confirmed by experiment, not argument** — see the
      item-5 experiment below.
   2. **Scripted text that is never spoken — items 10, 11 (173).** `perilous_realms` ("The
      Hardest Warhammer 40K Environments to Fight In", the on-screen title) and the planted
      `blue_monkey` string are both absent from the audio (RMS + Whisper transcript both
      confirm). FA has no drop path, so it carved 0–1.36s and 36.96–37.73s out of the
      neighbouring real speech to host them. Whisper's coverage gate dropped both correctly.
      This is the exact mirror image of mechanism 1, and R.5 does not address it.
   3. **False anchor from Whisper timestamp smear — items 6, 7.** Both chunk seams here are
      well-formed on paper (anchor skew 0.06s and 0.10s, well inside `ANCHOR_AGREEMENT_SEC`),
      and both are wrong. Direct RMS shows v6 has real silence at 450.40–451.70 and 173 at
      174.55–174.95, while Whisper's tokens ("brush"@451.24, "the"@174.51) sit *inside* those
      silences — smear of ~1.0–1.2s. `faAnchors.ts`'s `findAgreeingSilence` matches a
      detected silence against a raw Whisper token **timestamp**, so the "three-source
      agreement" is really two sources: the alignment op and the token onset both come from
      the same smeared Whisper output, and only the silence is independent. The seam
      therefore lands 5 script words (v6) / 2 script words (173) out of register, and FA is
      forced to cram those words into the preceding silence at ~0 confidence.
      Independently corroborated by FA itself: the *next* chunk places "moving" at 452.92 and
      "crew" at 176.04 at confidence 1.0000 / 0.9990 — i.e. FA agrees with the RMS, not with
      Whisper. This is the same failure `CLAUDE.md`'s standing invariant already forbids
      elsewhere ("never build a boundary search window from raw token *timestamps*"), applied
      to a code path that predates it.
   4. **`faChunkPlan.ts` forced-split attribution bug — item 9 (spanish). An ordinary bug,
      not an FA limitation.** `runQiRanges` gives a `'forced-split-*'`-terminated run an
      empty `qi` range by design ("a force-split subdivides the WINDOW but never the TEXT"),
      and `attributeByIndex` then folds that run's *window* backward into the previous chunk.
      The text whose audio lives in that window stays with the *next* chunk. Measured on the
      Spanish corpus: anchors are correct (qi 179 `que` ↔ 61.36) and runs are correct, but
      run 4 `[61.36, 65.58)` is forced-split, so chunk 3 becomes `[34.46, 65.58)` ending at
      "…por lo" while chunk 4 becomes `[65.58, 92.04)` starting at "que" — whose real onset
      is 61.35. FA had no window containing that audio and crammed 8 words into 1.14s at
      0.0000 confidence. **Census across the whole corpus: exactly one forced split exists
      (v6 0/330 runs, 173 0/149, spanish 1/6) and it produces exactly one of the seven
      failures.** The module's own doc comment states this path "never fires on the real 173
      corpus … so it is a correctness guard, not a tuned path" — it fires on Spanish, and
      when it fires it mis-attributes a whole run. It will fire on any project with a >30s
      (`MAX_RUN_SEC`) anchor-free stretch, which is a low-anchor-density condition, not a
      language condition.

   **12-item mechanism table** (FA/Whisper = committed start of the named boundary;
   `L`/`R` = FA's own confidence on the last word before / first word after the boundary):

   | # | Proj | Segment (boundary) | FA | Whisper | Ear | L conf | R conf | Mechanism |
   |---|---|---|---|---|---|---|---|---|
   | 1 | v6 | `030_watching_older_hunters` start | 87.23 | 78.56 | FA ✓ | 0.9999 | 0.9935 | Well-formed chunk; FA recovered 3 segments Whisper dropped, so the Δ+8.67s is bookkeeping, not error |
   | 2 | v6 | `027_internal_change_face` start | 78.56 | (dropped) | FA ✓ | 0.9997 | 0.9618 | Coverage recovery — the plan doc's "flash-attention content dropout, V6 segs 27-29" case |
   | 3 | v6 | `029_night_understanding` start | 83.53 | (dropped) | FA ✓ | 0.9988 | 0.9993 | Same recovered run |
   | 4 | v6 | `308_scouts_leading` start | 928.67 | 931.40 | W ✓ | 0.0001 | 0.0128 | (1) unscripted "Level 8 …" 925.14–928.93 |
   | 5 | v6 | `043_night_migration` start | 128.43 | 130.96 | W ✓ | 0.0000 | 0.0000 | (1) unscripted "Level two …" 125.54–129.01 |
   | 6 | 173 | `vessel_damage_clue` start | 172.91 | 174.74 | W ✓ | 0.0011 | 0.0000 | (3) false anchor; Whisper "the/last" smeared into real silence 174.55–174.95 |
   | 7 | v6 | `152_frozen_brush_mice` start | 449.20 | 451.03 | W ✓ | 0.0006 | 0.0015 | (3) false anchor; Whisper "brush/mice/stop" smeared into real silence 450.40–451.70 |
   | 8 | v6 | `155_predator_passing_under` start | 457.81 | 457.83 | both ✓ | 0.6814 | 0.9979 | Well-formed chunk, clean silence, high confidence — the "FA working as designed" control |
   | 9 | es | `023_scylla_six_sailors` start | 66.73 | 65.12 | W ✓ | 0.0000 | 0.0000 | (4) forced-split chunk-plan bug |
   | 10 | 173 | `perilous_realms` / head | 1.36 | 0.00 | W ✓ | (start) | 0.0000 | (2) scripted title never spoken |
   | 11 | 173 | `blue_monkey` span | 36.96–37.73 | (dropped) | W ✓ | 0.0000 | 0.0000 | (2) planted string never spoken |
   | 12 | es | `001_scylla_intro` span | 0.00–1.06 | (dropped) | FA ✓ | (start) | 0.0147 | Coverage recovery — "Scylla." IS spoken twice (0.12–0.64, 0.84–1.21); Whisper wrongly dropped it |

   **Item 11's confidence, asked explicitly: FA was NOT confidently wrong.** All 7
   `blue_monkey` words scored below `CONF_MIN`, `minWordConfidence` 1.9e-08,
   `needsReviewCount` 7/7. Same for `perilous_realms` (7/7, 1.3e-06). The segment-level
   `alignConfidence` of 1.000 those rows also carry is the *text-match* confidence (every
   script word found a token), not an acoustic one — the two must not be conflated.

   **Confidence is a strong but imperfect predictor, stated with its exception.** Taking the
   two words immediately adjacent to each tested boundary: all 7 failures have BOTH below
   0.013; 4 of the 5 correct have BOTH at or above 0.68. The single false positive is item
   12 (0.0147, correct anyway) — a one-word segment at corpus start, R.6's own known edge
   case. So `needsReview` had **perfect recall (7/7) and one false positive out of 5** on
   this sample. A corpus-wide chunk census adds context: 13.7% of all 5783 words are
   flagged, and the flag rate falls monotonically with chunk length (42.5% in sub-2s chunks
   → 5.1% in ≥12s chunks; all 19 chunks where *every* word is flagged have median duration
   1.58s). *Correlation only* — R.2 padding was already built and measured net-unfavorable
   (D24), so the naive "short chunks starve the model of context" reading is not supported
   by the one experiment that tested it. Counter-example from this session's own re-run:
   after the item-5 fix, "on nights when" still scores 0.0000 while landing within 0.08s of
   the truth — a low score marks risk, not error.

   **THE OWNER'S ITEM-5 EXPERIMENT — RUN, AND IT CORRECTS.** Method: rebuild the V6 scene
   doc with one added segment carrying the unscripted "Level Two. The Boy Who Carries Fire."
   text (and, in a second variant, "Level Eight. …" for item 4), regenerate the production
   chunk plan through the real `computeFaChunkPlan`, re-run the real
   `fa_onnx::align_chunked` against the real 16 kHz audio, and push the result through the
   identical post-FA pipeline the second baseline used.
   - *Harness fidelity proven first:* the unmodified control reproduces the committed
     second baseline exactly — 280/280 identical chunks and **0 of 3874 word rows differing**
     from `fa_production_words.json`, committing `043_night_migration` at 128.43 as recorded.
   - *Result:* `043_night_migration` moves to **130.96** and `308_scouts_leading` to
     **931.40** — the ear-correct values for items 5 and 4, exactly, to the centisecond.
     At the word level "you are eleven" moves from 125.96–128.34 (confidence 0.0000/0.0002/
     0.0000) to 129.54–130.34 (0.9984/1.0000/0.9351), and "you are forty-nine" from
     927.28–928.64 to 929.72–930.78 (0.9620/1.0000/0.9993).
   - *No collateral damage:* of 447 boundaries shared with the control, **4 moved** — the two
     tested ones and the two segments whose text the insertion displaced. 443 unchanged.
   - *Answer to the owner's hypothesis:* **no, FA does not still misalign.** Given a segment
     for the extra audio, FA places it correctly and the tested boundary is exact.

   **LEAD B — the repeated 1.83s is a COINCIDENCE, shown by construction, not by hand-waving.**
   Across all 642 boundaries FA and Whisper share, |Δ| = 1.83s occurs exactly twice — and
   several other 2-decimal values collide just as often (0.30s ×4, 0.23s ×4, 0.27s ×3) among
   the 81 non-zero deltas, so a 2× collision is unremarkable. Decisively, the two 1.83s are
   arrived at by *different arithmetic*: in 173, both boundaries are silence midpoints and
   1.83s is simply the distance between two adjacent ones (172.91 = mid of [172.700,173.120),
   174.74 = mid of [174.520,174.960)); in v6, Whisper's 451.03 is a silence midpoint but FA's
   449.20 is an unsnapped word onset, so the same number is a midpoint-minus-onset. It is
   also not a frame constant: 1.83s is 91.5 frames at the model's 20 ms stride — not an
   integer, so no stride, padding, resample or index off-by-N can produce it. **Not one bug.
   Do not spend on it.** The one real finding underneath it is worth keeping: `snapBoundaries`
   *amplifies* sub-second word error into multi-second boundary error by snapping to a
   different silence — 173's raw FA onset was only 0.55s early, which was enough to select
   the previous silence instead of the next.

   **LEAD C — both "FA later" items are misfiled; neither is a head/warmup or a Spanish
   effect.** Item 10 is not leading silence, music, breath or first-chunk warmup: the 173
   audio simply begins with "Some places in the 41st millennium…" at 0.16s and the scene
   doc's first segment is an unspoken on-screen title — mechanism (2), Lead A's mirror
   image, not a distinct failure. Item 9 is not language- or model-specific either: it is the
   forced-split attribution bug, mechanism (4), which fires on any project whose anchor
   density leaves a >`MAX_RUN_SEC` gap. **Implication for the fr/de/pt gap:** the Spanish
   result carries no evidence of a Spanish-model weakness — where the chunk plan was sound,
   Spanish FA scored 0.94–1.00 throughout, and it recovered a real segment (item 12) Whisper
   dropped. The transferable risk to fr/de/pt is *low anchor density* (Spanish produced 4
   anchors over 92s), not the acoustic model.

   **Grouping — one mechanism explains more than one failure in every case:** (1) → items
   4, 5. (2) → items 10, 11. (3) → items 6, 7. (4) → item 9. Four mechanisms, seven failures,
   nothing left over and nothing manufactured.

   **Inherent vs. missing-feature vs. bug — the categorisation the ruling actually turns on:**
   - *Inherent to forced alignment (2 of 7: items 10, 11).* FA's defining property is that
     every target token gets a position. "This scripted line is not in the audio" has no
     representation in a CTC forced-alignment objective, so FA cannot drop it. This is not
     tunable. It is, however, **detectable** — FA flagged 7/7 words on both — so the honest
     framing is "inherent to alignment, fixable at the layer above it (a drop/skip gate on
     acoustic confidence, which is what Whisper's coverage gate already is)."
   - *Missing feature, R.5 (2 of 7: items 4, 5).* Measured, not assumed — the experiment
     above corrects both exactly. See §7 item 2's new-evidence paragraph.
   - *Ordinary bugs (3 of 7: items 6, 7, 9).* The false-anchor timestamp dependency
     (`faAnchors.ts`'s `findAgreeingSilence`, items 6 and 7) and the forced-split empty-`qi`
     attribution (`faChunkPlan.ts`'s `runQiRanges`/`attributeByIndex`, item 9) are defects in
     the chunk-plan layer, not in forced alignment. Both are Whisper-side inputs to FA: FA
     was handed the wrong window and did the best a forced aligner can with it. **Neither is
     a reason to judge FA itself.**
   - *Honest read on "can FA ever be perfect":* on this evidence, **no single-source pipeline
     can be**, and FA's failures are more repairable than they first look — 3 of 7 are bugs
     in code FA doesn't own, 2 are a feature already scoped and now measured to work, and
     only 2 are inherent, with a detection signal already present in the wire format. What
     the evidence does *not* support is that fixing all of this makes FA perfect: item 8's
     0.02s and item 6's amplification-through-snapping both show the last few hundred
     milliseconds are governed by `snapBoundaries`, not by the timing source at all.
   - *Nothing in the 12 is unexplained.* Two residual uncertainties are stated rather than
     resolved: (a) why the model's confidence collapses across a whole short chunk rather
     than only at its edges is correlational here, and R.2's negative result rules out the
     obvious explanation; (b) item 6's ear-correct 174.74 sits ~0.7s after Whisper's own
     "of" onset, so what the ear is judging there is the snapped silence midpoint, not the
     word onset — worth remembering before treating any single boundary as word-level truth.

   **Hybrid — presented as an option, not a recommendation.** The data does line up with a
   split rather than one winner: FA skipped 0 segments where Whisper skipped 3/3/1, and 4 of
   the 5 ear-correct items are FA recovering segments Whisper wrongly dropped (items 2, 3, 12)
   or the bookkeeping consequence of that (item 1) — coverage is FA's clear strength.
   Meanwhile every FA failure is flagged by FA's own `needsReview`, which is already on the
   wire (`FaWordSpan.needsReview`, `fa.rs`), so a per-boundary source choice is available
   today without new plumbing: take FA's boundary when its two adjacent words clear
   `CONF_MIN`, fall back to Whisper's when they do not. On this sample that rule yields 12/12
   — it accepts all 5 correct FA boundaries (item 12's 0.0147 is a *span* FA supplies and
   Whisper has no candidate for, so there is nothing to fall back to) and rejects all 7 wrong
   ones. **Caveats the owner should weigh before reading that as a plan:** n = 12, chosen by
   this programme as the *most interesting* boundaries rather than at random, so 12/12 is not
   a generalisation; a mixed-source project has no single `anchorSource` provenance, which
   §4's word-timing schema and the R-E/Model P rulings would both need to absorb; and fixing
   mechanisms (3) and (4) would change which boundaries are low-confidence in the first
   place, so the rule should be re-measured after those, not before.

   **ADDENDUM 2 to item 6 — items 6/7 false-anchor circularity, independent re-derivation
   checkpoint, 2026-08-16 (diagnosis + proposal only; no `src/`/`src-tauri/` change, no fix,
   gate stays OFF).** Owner asked for an independent mechanism trace of ear-pass items 6
   (173, `vessel_damage_clue`) and 7 (v6, `152_frozen_brush_mice`), a population scope, and
   fix options — explicitly a checkpoint, not a fix. **Evidence base: the same committed
   second-baseline artifacts `b36f6c2` used** (`.work-phase4/replay/{173,v6}/{transcript_tokens,
   silences_app,golden_baseline_segments,fa_production_chunks,fa_production_words,
   fa_second_baseline_analysis}.json`) — no FA re-run. Disposable analysis scripts lived only
   in the session scratchpad, never in the repo; `git status` clean, verified.

   **Item 6, independently traced.** Two real silences bracket the true boundary: A =
   [172.70,173.12] (mid 172.91) and B = [174.52,174.96] (mid 174.74, the ear-correct value —
   also what the non-FA golden path already commits, `golden_baseline_segments.json`).
   `findAgreeingSilence` fires on the Hirschberg-matched word "residue" — LAST word of the
   PRECEDING segment `pungent_vapor` — whose Whisper token starts at 173.18, 0.06s from
   silence A's `endSec` (173.12), inside `ANCHOR_AGREEMENT_SEC` (0.15s). This mints a
   chunk-plan boundary at 173.12 with no relation to the real segment boundary: "residue" is
   textually the correct last word of its own segment, but the silence the algorithm keyed
   off is a Whisper micro-timing artifact — silence A sits INSIDE the Whisper-reported span
   of "chemical," an earlier word, i.e. that word's own timestamp is smeared. A second,
   separately-formed anchor fires on "crew" (4 words into the FOLLOWING segment's own text) —
   token start 175.02, 0.06s from silence B's `endSec` (174.96) — correctly landing near the
   true boundary. Net effect, confirmed directly in `fa_production_chunks.json`: the chunk
   plan carves an unwanted extra 1.84s micro-chunk `[173.12,174.96]` holding "of whatever the
   last" (4 words belonging entirely to `vessel_damage_clue`), which FA must force-align with
   none of its own real acoustic content there. Confidence for those 4 words: 0.0/0.0001/
   0.0001/0.0 (`fa_production_words.json`) — matches `b36f6c2`'s table (L=0.0011, R=0.0000)
   exactly.

   **Item 7, independently traced.** Real silences: A = [447.70,448.34] (mid 448.02), B =
   [450.36,451.70] (mid 451.03, ear-correct). `fa_production_chunks.json`'s actual boundary
   sequence: `…448.34 | "for the absence of one. When the brush mice stop" | 451.70 |
   "moving through dry leaves…"`. The false anchor sits at 451.70, triggered by "moving" — the
   SIXTH word of the CORRECT segment's own text ("When the brush mice stop moving…") — whose
   token starts at 451.80, 0.10s from silence B's `endSec` (451.70). The segment's first five
   words get trapped in the preceding chunk and crammed into a window ending at 451.70 when
   their real spoken content (Whisper's own times: "brush" 451.24, "mice" 451.32, "stop"
   451.51) barely fits before that edge — confidence 0.0006/0.0015, matching `b36f6c2`'s table.
   Same shape as item 6: the anchor fires on a word deep inside the CORRECT segment's own
   text, not its first word, because that word's Whisper timestamp coincides with a
   real-but-unrelated silence. FA's own committed 449.20 (`fa_second_baseline_analysis.json`)
   is confirmed NOT a silence-derived value at all (no silence in this project has that
   midpoint or endpoint) — **re-confirms, does not re-litigate, Lead B's closed 1.83s
   coincidence finding**; that arithmetic was not re-chased per the brief.

   **Residual not fully re-derived — stated as inference, not measurement.** The exact
   arithmetic converting the false micro-chunk into `vessel_damage_clue`'s final committed
   172.91 was run by a now-deleted scratch harness in `b36f6c2`'s own session and is not
   reproducible from the committed JSON alone. What IS confirmed: 172.91 is silence A's
   midpoint, so some downstream step re-selects silence A once the false micro-chunk has
   corrupted nearby word-level positions — the same amplification `b36f6c2` named, now traced
   to originate in `faAnchors.ts`, not in the downstream snap step. **Phase 5 implication:**
   treat the false ANCHOR as root cause and the snap's wrong-silence pick as amplification of
   an already-corrupted input, not an independent defect.

   **Invariant verdict — differs from `b36f6c2` on one material point.** Quote, `CLAUDE.md`
   §4: *"Boundary/breath classification must use token indices … never raw Whisper
   timestamps — timestamps can smear 100–900ms across a real silence seam."* Do-not list:
   *"Classify breath-vs-boundary silence, or build a boundary search window, from raw token
   timestamps | … (`snapBoundaries.ts`)."* Quote, `faAnchors.ts`'s `findAgreeingSilence`
   (~line 114-128): tests `Math.abs(tokenStartSec - s.endSec) <= ANCHOR_AGREEMENT_SEC` — a raw
   Whisper token TIMESTAMP compared to a silence, exactly the named pattern. `b36f6c2` called
   this "the same failure CLAUDE.md's standing invariant already forbids elsewhere … applied
   to a code path that predates it" — treating `faAnchors.ts` as legacy code written before
   the rule existed. **`git log` shows the opposite: the invariant line landed 2026-08-09
   (`53b26ee`); `faAnchors.ts` was authored 2026-08-12 (`e0c9c89`) — three days AFTER.** Not a
   grandfather case. Not a clean violation either, though: the invariant's own text and its
   Do-Not-list citation both name `snapBoundaries.ts` and "boundary/breath classification"
   specifically — deciding whether a detected silence is a segment boundary or an internal
   breath — a different operation from `findAgreeingSilence`'s job (deciding whether a
   Hirschberg-matched word's reported time corroborates a nearby silence closely enough to
   mint an R.1 anchor). `snapBoundaries.ts` itself still uses raw timestamps for its own
   window/distance test (`computeBoundarySearchWindow`, `isBoundarySilenceCandidate`) — only
   its breath/boundary *classification* is index-based — so the invariant's "never raw
   timestamps" line is already narrower in practice than its literal wording, in the very file
   it cites. **Verdict: not a clean invariant violation as literally scoped, but new code
   (written after the rule existed) repeating the exact failure mode the invariant exists to
   prevent, in a sibling subsystem the invariant's text doesn't name — a grey area leaning
   toward "should have been caught," not a sanctioned exception.** Nothing in `faAnchors.ts`'s
   header or the R-O/R-P ruling record argues the timestamp comparison was a deliberate,
   considered exception. **This materially updates `b36f6c2` and should be weighed in the
   ruling.**

   **Population scope — heuristic, inference not a certified count.** No committed artifact
   preserves the real R.1 anchor set (needs the real Hirschberg `TokenAlignment`, not saved in
   the second-baseline JSON; re-running FA/alignment was out of scope). Proxy built from
   committed data only: replicate `isDistinctive` + `findAgreeingSilence` over every Whisper
   token (over-counts vs. the real algorithm, which also requires a real Hirschberg match and
   `RUN_SURVIVAL_MIN_RUN_LONG`'s 4-word contiguous run), attribute each candidate anchor to
   its nearest true (golden-baseline) segment boundary, flag a boundary when a candidate
   anchor OTHER than the one whose silence actually contains it is also nearest to it. Result
   across 173 + v6 + spanish (639 true boundaries): **116/639 (18.2%)** carry this structural
   precondition — 52/171 (173, 30.4%), 62/443 (v6, 14.0%), 2/25 (spanish, 8.0%). Both items 6
   and 7 appear in the underlying anchor data (confirmed by direct inspection, not just the
   aggregate) — 173's `pungent_vapor`→`vessel_damage_clue` boundary is one of the 52; v6's
   flagged set independently reproduces the same anchor ("for"@448.34) implicated in item 7's
   fragmentation, though the proxy's nearest-boundary attribution assigns it to the PRECEDING
   boundary (150→151) rather than 151→152 — a known limitation (the real algorithm doesn't
   attribute anchors to a "nearest" true boundary at all; every anchor is a run boundary
   regardless), stated rather than smoothed over. **Reading:** items 6/7 were not statistically
   unlucky — the structural precondition is common (~1 in 5 boundaries in this sample), driven
   by silence density (~one every 2.5-3s) relative to `ANCHOR_AGREEMENT_SEC`'s 0.15s tolerance
   and ordinary Whisper micro-timing noise. Whether a given precondition actually flips the
   FINAL committed boundary depends on the downstream snap step this session did not fully
   re-derive (see residual above), so 116 is an EXPOSURE upper bound, not a confirmed-wrong
   count — only 2 of 116 are ear-verified wrong today. **Given the exposure rate this reads as
   urgent-if-FA-ships, not a two-boundary curiosity — but the true failure rate inside the 116
   is unmeasured.**

   **Fix options — proposed, not implemented, no ruling made:**
   1. *Match on token indices, not timestamps, per the invariant* — require the silence to
      fall in an actual token-to-token gap for the matched word, `fillsTokenGapWithinSpan`-
      style evidence, instead of raw-timestamp proximity. Most consistent with the standing
      invariant and this codebase's own precedent for the identical problem in
      `snapBoundaries.ts`. *Risk:* `faAnchors.ts`'s anchors are single-word, not adjacent-pair
      boundaries — porting the idea needs a real design pass, and may sharply cut the anchor
      count (many CORRECT anchors likely rely on the same shortcut). *Golden replay impact:*
      zero by construction (gate off, module unwired). *Needs an owner design pass, not a
      same-session fix.*
   2. *Require genuinely independent corroboration* before accepting an anchor (e.g. a second
      non-Whisper-timing signal). *Risk:* circular as stated — FA's own confidence doesn't
      exist yet when anchors are being built (anchors are what construct FA's chunk plan);
      would need a two-pass build-anchors/run-FA/re-validate restructure. *Owner ruling
      needed:* yes, Phase-5-adjacent scope change.
   3. *Tighten `ANCHOR_AGREEMENT_SEC` or require minimum spacing between adjacent anchors* —
      cheapest change, directly targets the "two anchors bracket one true boundary" shape both
      items exhibit, doesn't touch the timestamp-vs-index question. *Risk:* arbitrary
      threshold, no principled derivation yet, could suppress correct closely-spaced anchors
      in fast dialogue; needs tuning against the 116-boundary proxy set (or a real re-run)
      before trusting it. *Golden replay impact:* zero (unwired). Smallest and most testable
      of the four — not the same as obviously correct, since it doesn't address the invariant
      question, only the symptom.
   4. *Defer wholly to Phase 5* — Phase 5 (§11 item 16) already deletes
      `computeBoundarySearchWindow`/`isBoundarySilenceCandidate`/`fillsTokenGapWithinSpan` and
      replaces the picker with "the fence." *Against deferring:* `faAnchors.ts` is Phase
      3/Task 5 scope (R.1), not Phase 5's stated scope (`snapBoundaries.ts` specifically) —
      nothing in the plan doc says Phase 5 subsumes R.1's anchor computation, so deferring may
      just leave this broken indefinitely with no committed owner.

   **No option here is a clean, no-ruling-needed bug fix** — all four touch either the
   invariant's practical boundary or the R.1 anchor design the plan doc already specifies.
   If forced to rank: option 1 is the most principled, but needs a design pass before coding.
   **Waiting for a ruling before any code change — none made this session.**

   **ADDENDUM 3 — WS1 Session A, 2026-08-16: nine owner rulings recorded, items 6/7
   RULED (fix scoped, implementation pending Session B), true anchor exposure measured
   (owner ruling R8). No `src/`/`src-tauri/` file changed; gate stays OFF.** Closes the
   "waiting for a ruling" line immediately above for items 6/7 specifically (R1/R2 of
   the nine rulings below); the four fix options ADDENDUM 2 listed are resolved:

   - **Items 6, 7 status: RULED, fix scoped, implementation pending Session B** (owner
     ruling R-R, `sync-pipeline-v2-plan.md`, next to R.1(c)). Decided: merge options 1
     (token-index matching) and 2 (independent two-pass corroboration) — rewrite
     `findAgreeingSilence` so corroboration is evidence of an actual token-to-token gap,
     not raw-timestamp proximity, restructured into two passes so the corroborating
     source is genuinely independent of the Whisper output that produced the candidate.
     Options 3 (tighten `ANCHOR_AGREEMENT_SEC`) and 4 (defer to Phase 5) explicitly
     REJECTED, not deferred — reasons recorded in the ruling. No code changed.
   - **FA-default acceptance bar fixed now** (owner ruling R-S): 12/12 on a FRESH
     listening list (not the 12-item list already used to diagnose this), zero
     boundaries >1.0s from ear-correct, and runtime resolved.
   - **Runtime note, updated per R7:** V6's ~231s wall-clock is accepted AS-IS for the
     existing opt-in toggle — no optimization scoped or needed to ship the toggle. It
     remains a blocker only for flipping the DEFAULT, separately from (and in addition
     to) the 12/12 and 1.0s criteria above.
   - **CLAUDE.md invariant sharpened** (owner ruling R2): the "token indices, never raw
     timestamps" invariant is now scope-global (was `snapBoundaries.ts`-only) and
     reframed as "timestamps may measure, never decide identity" — `faAnchors.ts`'s
     `findAgreeingSilence` is the worked violation cited inline.
   - **New FA replay gate** (owner ruling R10): `scripts/phase4-fa-replay.test.ts`,
     offline, fixtures-only, pinning current FA behavior (including the known-bad items
     4/5/6/7/10/11) so Session B's fix shows as a named, expected diff instead of a
     silent drift only the owner's ear would catch. Golden replay untouched, still 6/6.
   - **R.5/R.10 pulled into Stage 1 scope** (owner ruling R4) — see §3's 2026-08-16 note
     and §11 item 13's amended dependency list. R.10 (companion to R.5, "scripted text
     never spoken") is newly specified in `sync-pipeline-v2-plan.md`, next to R.5.
   - **fr/de/pt corpus formally deferred out of Stage 1** (owner ruling R-T,
     `sync-pipeline-v2-plan.md`, next to Phase 3b) — the Rules 1-5 unexercised-against-
     real-audio risk is carried forward explicitly for whichever later stage takes
     non-English.
   - **`DOCUMENTATION_AUDIT_REPORT.md` stays untracked** (owner ruling R9) — a
     deliberate scratch working file, not committed, not flagged as a problem.

   **True anchor exposure — measured (owner ruling R8), replacing the 116/639 proxy.**
   Temporary instrumentation was added to `faAnchors.ts`'s `computeAnchors`/
   `findAgreeingSilence` (an exported `__DEBUG_ANCHOR_LOG` array + a per-accepted-anchor
   competing-silence count), driven by the REAL `computeFaAnchors`/`alignQueryToSubject`
   against the real `anchorTimed` parse (the same array `App.tsx`'s
   `runForcedAlignmentForSync(voiceoverAsset, anchorTimed, ...)` call passes — not the
   post-skip/post-snap `finalSegments` array `fa-run-distribution.ts` uses for its own,
   different purpose) and the real committed `transcript_tokens.json`/`silences_app.json`
   fixtures, all three corpora, fully offline. Reverted before this session finished —
   `git diff src/services/faAnchors.ts` is empty, confirmed byte-identical.
   - **(a) Total anchors accepted: 481** (v6 329, 173 148, spanish 4) — out of 447/175/27
     parsed segments per corpus. This is the REAL R.1-admissible set (real Hirschberg
     match + real 4-word run-survival gate), materially smaller than the proxy's
     over-counted candidate pool (the proxy admitted it "over-counts vs. the real
     algorithm, which also requires a real Hirschberg match and
     `RUN_SURVIVAL_MIN_RUN_LONG`'s 4-word contiguous run").
   - **(b) Anchors with >1 competing silence within `ANCHOR_AGREEMENT_SEC` of the SAME
     token: 0 of 481 (0.0%), all three corpora.** Measured, not assumed — and it directly
     falsifies the "two silences compete for one token" mental model: items 6 and 7 each
     have `competingSilenceCount=1` (their own chosen silence is the ONLY one within
     0.15s of that specific token's onset — no literal competition).
   - **(c) Anchors with ≥2 of 3 sources tracing to the same Whisper output: 481 of 481
     (100%), structural, not probabilistic — this is the ACTUAL circularity condition,
     and it is universal, not a minority.** By construction: `computeAnchors` resolves
     `subjectIdx → tokenIdx → token`, then calls `findAgreeingSilence(token.startSec,
     silences)` — R.1(a) (the Hirschberg match) and R.1(b) (that match's own token onset)
     are reading the SAME single Whisper token twice, for every anchor, unconditionally.
     Only R.1(c) (the RMS silence) is a genuinely independent source. This matches
     ADDENDUM 2's qualitative claim exactly ("the alignment op and the token onset both
     come from the same smeared Whisper output, and only the silence is independent") —
     now a certified count, not an inference.
   - **(d) Overlap with the known movers (45/642 >0.5s, 25/642 >1.0s): inconclusive, and
     said so rather than forced.** (b)'s literal signal (competing silences at one token)
     has zero overlap with the movers, by construction of (b)=0 — it does not discriminate.
     (c) is present on 100% of anchors including every mover — it also does not
     discriminate, because it is universal. **What actually produces items 6/7 is a
     CROSS-anchor pattern**, not a per-anchor one: TWO SEPARATE, individually-unambiguous
     anchors (each with `competingSilenceCount=1`, from two DIFFERENT smeared tokens)
     jointly bracket a spurious short run between them. An attempt to measure this
     directly (flagging interior runs under 3.0s between two `agreed-anchor` boundaries,
     then mapping each to its nearest FA-committed segment tag for a mover lookup)
     produced 142/72/0 candidate short runs per corpus — too noisy to trust: a 3.0s
     threshold flags a large fraction of ALL runs in this corpus (silence density here
     runs ~one every 2.5-3s per the plan doc's own Part K measurement, so "short run" at
     that threshold is closer to "typical run"), and the nearest-committed-segment tag
     lookup mostly failed to resolve (chunk-plan attribution, not raw anchor windows,
     determines the FINAL committed segment starts, so the two don't line up 1:1). This
     attempt was discarded rather than reported as a real number — **flagged as a genuine
     open item for Session B**, which will need exactly this kind of cross-anchor analysis
     to validate its own two-pass corroboration design.
   - **(e) Items 6 and 7 in the at-risk set: YES, confirmed directly** —
     173 item 6: `qi=434 tokenIdx=465 tokenStartSec=173.18 chosenSilence=[172.70,173.12]
     competingSilenceCount=1`; v6 item 7: `qi=1190 tokenIdx=1217 tokenStartSec=448.32
     chosenSilence=[447.70,448.34] competingSilenceCount=1`. Both present in the real
     accepted-anchor log, both with `competingSilenceCount=1` (consistent with (b)'s 0%
     finding — neither item is a "competing silence" case; both are the universal (c)
     structural case).
   - **Measured N vs. the 116 estimate: not directly comparable, stated as such rather
     than forced into a single "high/low/close" verdict.** The proxy's 116/639 measured
     "candidate anchors whose nearest true boundary is contested by another candidate" —
     a different unit (boundary-level, over-counted) from this session's 481 (real,
     admissible, anchor-level) and 0/481 or 481/481 (per-anchor structural counts). What
     the real measurement adds: the proxy's implied ~18.2% "at risk" rate is, if anything,
     an UNDER-estimate of the true structural-precondition population — (c) shows the
     precondition is 100% of real anchors, not 18%. But 100%-universal is also a WEAKER
     signal for predicting which specific anchor breaks a boundary (2 of 481, both found)
     than a discriminating ~18% figure would be, if that figure had been measuring the
     real risk driver — which, per (d), it wasn't; the real driver is the unmeasured
     cross-anchor pattern.
   - **642 vs. 639 boundary-count discrepancy — resolved, both figures correct for what
     they each individually measure; no error found.** 642 = the sum of Whisper's own
     KEPT segment counts across the three corpora (v6 444 + 173 172 + spanish 26 = 642) —
     used wherever the R-H second baseline compares FA against Whisper BY TAG (one
     comparable value per kept segment, i.e. per "boundary" in the sense of "this
     segment's own start"). 639 = 642 − 3, the number of INTERIOR pairwise boundaries
     between adjacent kept segments (N−1 per corpus, since each corpus's very first kept
     segment's start isn't "between" two segments — summed: 171+443+25=639) — used
     wherever the anchor-exposure proxy counts boundary PAIRS. Both are internally
     consistent with their own stated definition; the discrepancy was ambiguous labeling
     ("boundaries" used for two different countable quantities across two sessions), not
     a computational error in either one. Recommend, going forward: "642 committed
     segments (tag-matched)" and "639 interior boundaries" as disambiguated names.
     **Completed 2026-08-16 (Session A.5) — there is a THIRD quantity, 649, and all
     three now reconcile arithmetically.** 649 = FA's own committed segment count
     (v6 447 + 173 175 + spanish 27), the correct denominator for anything measured on
     the FA side, because FA skips nothing. 642 = the tag-matched subset comparable
     against Whisper, i.e. 649 − 7, where the 7 are exactly the segments Whisper skipped
     and FA recovered (v6 447−444=3, 173 175−172=3, spanish 27−26=1 — the same "3 V6 +
     3 173 + 1 Spanish" this item records above). 639 = 642 − 3 interior boundaries.
     Disambiguated names going forward: **"649 FA-committed segments", "642 tag-matched
     boundaries", "639 interior boundaries"** — and cite this line rather than
     re-deriving. Verified this session by recomputing the FA-vs-Whisper per-tag diff
     from the committed fixtures: 642 shared tags, 45 moved >0.5s, 25 moved >1.0s, max
     8.67s at `030_watching_older_hunters` — reproducing 580ba0f's figures exactly.
     **CORRECTED 2026-08-16 (WS1 Session B.1): the >0.5s / >1.0s counts are 44 / 24, not
     45 / 25.** 642 is unaffected, and so is everything else in this entry. The one row
     that leaves both sets is spanish `023_scylla_six_sailors`, which cleared the
     thresholds only because the fixture still carried its stale pre-616abb2 66.73; at the
     live 65.12 it clears neither. Session A.5 reproduced 580ba0f exactly because it read
     the same stale fixture 580ba0f did. Cite **44 / 24** going forward.

   **ADDENDUM 4 — WS1 Session A.5, 2026-08-16: R-R's decided fix is NOT buildable as
   written; Session B remains BLOCKED on an owner ruling. Items 6 and 7 have DIFFERENT
   mechanisms. No `src/`/`src-tauri/` file changed; gate stays OFF.**

   - **Items 6, 7 status: still RULED (R-R), still UNIMPLEMENTED, now BLOCKED — and the
     block is an owner decision, not engineering time.** R-R amends R.1(c) to require
     "evidence that the silence actually falls in the matched word's own token-to-token
     gap." Measured: **that gap does not exist in this token stream.** Whisper turbo
     emits a gapless partition — adjacent-token gap is exactly 0.000s for 3451/3988 (v6),
     1635/1835 (173), 331/362 (spanish) pairs, p50 0.000s on all three — and 451 of the
     481 accepted anchors (93.8%) have no silence anywhere in their own token gap. Items
     6 and 7 are both in that 451 (`gapSec === 0` at each). Weaker index rules that decide
     identity by *seam containment* rather than by a gap DO work and DO reject both
     culpable anchors; the full inventory, the four-tier independence definition, the
     provenance map and the owner's options are in `sync-pipeline-v2-plan.md`'s
     **"R-R FEASIBILITY FINDINGS"** block, placed directly after R-R itself.
   - **Blast radius — measured, and it is large.** A committed boundary can only move if
     the chunk carrying its words changed (ONNX inference is deterministic in (audio
     window, text)), so a chunk-plan diff is an exact upper bound with no FA run needed.
     Over 649 FA-committed segments: **179 (27.6%)** could move under the narrowest rule
     (reject a silence containing zero token seams), **460 (70.9%)** under seam-ownership
     rejection, **610 (94.0%)** and **636 (98.0%)** under the two full-selection rewrites.
     Only the narrowest leaves the ear-verified V6 seam 150/151 control untouched.
     **Magnitude buckets could NOT be produced and no number is invented here:** the only
     rigorous offline bound is the candidate chunk window itself, which is seconds wide,
     so it classifies essentially every at-risk boundary as ">1.0s possible" and
     discriminates nothing. Producing real buckets needs a real FA re-capture under the
     candidate rule (a `tauri:dev:fa` build plus the `tauri::test::mock_context` harness
     Session A used; ~320s of inference across the three corpora).
   - **Overlap with the known movers (45/642 >0.5s): weak, and reported as weak.** Against
     the narrowest rule 19/45 known movers fall in the at-risk set against 12.4 expected
     by chance (1.53x, one-sided p=0.024) — a real but modest signal at n=45. The three
     broader rules touch so much of the corpus that their overlap is statistically
     indistinguishable from chance (1.10x p=0.198; 0.99x p=0.715; 1.00x p=0.772). The
     8.67s `030_watching_older_hunters` outlier is at-risk under all four — which,
     given at-risk fractions of 28-98%, carries almost no information.
   - **R-S's 12/12 fresh-listening bar does NOT survive (exit E3), except for the
     narrowest option.** A 12-item sample cannot validate a change that may move 179-636
     boundaries. Restructuring options for the owner — **not a decision**, and the
     estimate assumes ~25s of listening per boundary (locate, play in context, judge),
     the rate the 12-item pass actually ran at:
       - *(i) keep 12/12* — defensible ONLY for the narrowest rule if it is additionally
         proved to leave every >0.5s known mover untouched. ~5 min.
       - *(ii) full census of the >0.5s known movers (45)* — ~20 min. Catches regressions
         where they are already worst, misses new movers in the currently-clean 597.
       - *(iii) stratified sample by movement magnitude*, drawn AFTER an FA re-capture
         makes magnitudes knowable: all >1.0s movers plus n=15 sampled from 0.1-1.0s plus
         n=10 from the unchanged set as a control. ~35-45 min, and the control arm is what
         makes a "no collateral damage" claim mean anything.
       - *(iv) two-tier bar* — tier 1 (12/12 fresh list) gates merging behind the OFF
         toggle; tier 2 (option iii) gates flipping the default. Spreads the ear cost
         across two sessions and matches R7's existing split between the toggle and the
         default.
     **Recommended for the owner's consideration: (iv), with (iii) as its tier 2.** The
     scarce resource is the owner's ears, and a control arm costs 10 boundaries.
   - **Cross-anchor mechanism (Session A's open item): CONFIRMED for item 6, REFUTED for
     item 7 — they are not one mechanism.** The hypothesis was "two independently-clean
     anchors bracketing a spuriously short run."
       - *Item 6 — confirmed in structure, corrected in detail.* Run 38 is
         `[173.12, 174.96]`, 1.84s, bracketed by two `agreed-anchor` boundaries, carrying
         5 script words ("residue of whatever the last") whose audio actually runs to
         ~176.0s. Inside it every FA word collapses (confidences 1.4e-5 to 1.1e-3,
         `needsReview` on all five) while the words on either side score 0.995 and 0.999.
         The bracketing anchors are NOT "independently clean": the early one comes from
         silence `[172.70, 173.12]`, which lies **wholly inside** Whisper token 464
         ("chemical", `[172.57, 173.18]`) and contains no token seam at all; the late one
         (`[174.52, 174.96]`, token 470 "crew") contains one seam that is not its own.
         Both are exactly what a seam-containment test rejects.
       - *The 0.55s → 1.83s amplification is REAL, and it is item 6's alone.* Full
         arithmetic: FA places "of" (the segment's first word) at **173.32**; Whisper
         places it at **173.87**; the FA onset is **0.55s early**. `snapBoundaries.ts`
         then snaps from that onset to the nearest detected silence — from 173.32 the
         distances are 0.20s back to `[172.70,173.12]` and 1.20s forward to
         `[174.52,174.96]`, so it takes the earlier one and commits its midpoint
         **172.91**; from Whisper's 173.87 the distances are 0.75s back and 0.65s forward,
         so it would have taken the later one and committed **174.74** — the ear-correct
         value. The 1.83s error is precisely the gap between two adjacent silence
         midpoints (174.74 − 172.91), and a 0.55s onset error is what flips the choice
         between them. **`snapBoundaries.ts` is the amplifier here**, exactly as §11's
         Lead B recorded; it is out of scope for the R-R fix and must not be touched, but
         it is why a sub-second FA error surfaces as a multi-second boundary error.
       - *Item 7 — the amplification does NOT apply, and the brief's premise that it does
         is wrong.* Item 7's committed 449.20 is **not a silence midpoint** — no snap
         participates. It is the midpoint of FA's own word seam: FA ends "one" at 449.18
         and starts "when" at 449.22. The word error IS the boundary error (~1.81s), with
         no amplification step. This confirms Lead B's earlier finding ("in v6, FA's
         449.20 is an unsnapped word onset") against fresh measurement. Item 7's cause is
         upstream: chunk 80 is `[448.34, 451.70]`, 3.36s carrying 8 words whose audio runs
         past 452s, and its END anchor comes from silence `[450.36, 451.70]` — which
         swallows **three** token seams (1222/1223/1224), so by index it identifies none of
         them and is accepted purely on the 0.10s proximity to token 1225's onset.
       - *Consequence:* the two items share a SHAPE (a too-short, too-early chunk window
         produced by an anchor that timestamp-proximity accepted and index-identity would
         reject) but not a mechanism (snap-flip amplification vs. direct FA misplacement),
         and not a culpable anchor (item 6's is the run's START, item 7's is the run's
         END). Any fix must be validated against both separately.
   - **R.10's detection signal does NOT separate item 10 — reported, not rewritten (the
     rule is the owner's).** R.10 keys on per-word FA confidence collapse against a
     segment-level `alignConfidence` of 1.000 (item 11, `blue_monkey`: 7/7 words
     `needsReview`, min raw confidence 1.9e-08, `alignConfidence` 1.000). Spot-checked
     against items 9 and 10 using the committed second-baseline analysis:
       - *item 11* — 7/7 `needsReview`, min 1.88e-08, `alignConfidence` 1.000. **Fires.**
       - *item 10* (`hostile_landscape`) — 4/9 `needsReview`, min 4.8e-06,
         `alignConfidence` **0.769, not 1.000**. **Does not fire.** The segment R.10 must
         actually catch for item 10 is its neighbour `perilous_realms` (the unspoken
         on-screen title that steals the onset): 7/7 `needsReview`, min 1.35e-06 — but
         `alignConfidence` **0.778**, so the conjunction still fails on its second half.
       - *item 9* (`023_scylla_six_sailors`) — 6/7 `needsReview`, min 6.8e-07,
         `alignConfidence` 1.000. **Fires — and should not:** item 9 is the forced-split
         attribution bug, already closed by 616abb2, not scripted-text-never-spoken. A
         false positive for R.10's stated purpose.
       - *Discrimination:* "every word `needsReview`" is genuinely rare (16/649 segments,
         2.5%) and is the load-bearing half. The `alignConfidence == 1.000` half is
         **degenerate on v6** — all 447 v6 segments have `alignConfidence` exactly 1.000,
         so on that corpus the conjunct carries zero information. `minWordConfidence <
         1e-6` alone fires on 23.4% (173) and 42.1% (v6) of segments and is far too broad
         to be part of a gate.
       - *Conclusion:* R.10's spec needs revisiting before it is built — the signal as
         written catches item 11, misses item 10 (both halves of the conjunction fail on
         the segment that matters), and mis-fires on item 9. **Flagged for the owner. Not
         rewritten here.**
   - **Documentation integrity sweep (Step 5).** (a) *item 8 vs item 9 mislabel:* **no
     occurrence found in any committed doc.** Every "item 8" reference in
     `docs/work-in-progress.md`, `project-state.md`, `CLAUDE.md` and
     `scripts/phase4-fa-replay.test.ts` correctly denotes the V6 seam 150/151 control,
     and 616abb2's own commit message and this document's line ~1595 both correctly
     attribute the forced-split fix to item 9. The mislabel existed only in Session A's
     brief, never in the repository — nothing to correct. (b) *642/639:* already recorded
     durably at this item's (f) bullet above; extended this session with the third
     quantity, 649. (c) *457.72 vs 457.83:* unambiguous in the gate (its V6-seam block
     spells out all three quantities explicitly) and in the Phase 3c entry; one loose
     phrasing corrected below. (d) *One error found and fixed:* Session A's changelog
     entry cited "`scripts/fixtures/README.md`'s changelog" — that file has no changelog
     section and never has; the provenance it meant is the "Forced-alignment fixture
     (R-H...)" section. Corrected in place.
   - **All measurements are offline and reproducible from committed fixtures.** The
     reconstruction of the production chunk plan was validated against the real capture
     (v6 280/280, 173 118/118 byte-identical) and reproduces Session A's 481 anchors
     (329/148/4) exactly. Temporary mutations used for the candidate-rule measurements
     were reverted; `git diff` over `src/` and `src-tauri/` is empty.

7. **Phase 3b — language-keyed normalization (fr/de/pt).** *Goal:* per-language number
   words, currency, thousands separators, French elision. *Files:* new normalizer rules,
   `sync-pipeline-v2-plan.md` Part H.5 full spec. *Exit criteria:* English path provably
   byte-identical to today's baseline (gate); fr/de/pt rules land, dormant behind language
   keys until corpus material arrives to verify them. **Needs an owner.**
8. **Phase 3c — hyphen-asymmetry.** **CLOSED, 2026-08-15 — by written acceptance, no code
   change.** The fix (splitting hyphenated compounds on the script side) was measured
   against both corpus projects: 19 genuine compounds, 8 clean-split-fixable, but splitting
   produced exactly one boundary change in the entire corpus (V6 seg 150, 457.83→458.12),
   and the owner's ear-test confirmed 457.83 (current, unfixed) is correct and 458.12 is
   wrong — no silence snap involved, a pure anchored-only midpoint shift. Fixing it would
   make one boundary worse for no corpus-wide gain, so it is accepted as a documented Stage
   1 defect under D.-1 criterion 3 rather than fixed. Full ruling, mechanism, and revisit
   trigger (Phase 5's fence changing this seam's anchor derivation): `sync-pipeline-v2-plan.md`'s
   Phase 3c entry. **No longer gates Stage 1 lock** — item 12 below is unblocked on this item.
9. **Task 2 — Slice 2, re-derive the 50/50 silence-split rule.** Independent of Task 5;
   cleanly decoupled from the editor path (verified twice per the pre-consolidation
   record). *Exit criteria:* `snapBoundaries.ts` + Apply-Sync plumbing re-derived against
   current `main`; golden replay diff reviewed per-boundary, never blindly re-baselined.
10. **Task 3 — stale-anchor scroll degradation test.** Independent test-debt item. *Exit
    criteria:* a dedicated test exists (today: code-reading assertion only).

**Sequenced — do not start yet:**

11. **Contract 1→2 gaps** (§9: P4 silence assertion, P6 normalizer symmetry, P8 bundled
    Stage-1 output object). *Depends on:* Phase 4 (item 14) being the phase that actually
    builds P8's type; P6 depends on Phase 3b/3c (items 7-8).
12. **Stage 1 lock procedures.** Contract IN + 1→2 guarantee-by-guarantee verification
    (owner inspection); determinism check (Phase 0, likely already satisfied, re-confirm);
    cross-cutting regression checklist (D.-1, 9 items: locks, skipped segments, headings,
    no-voiceover path, silence-scan failure, empty-token fallback, persistence/reload,
    export/preview consumers, DEV harnesses). *Depends on:* item 1 (Phase 3 production
    landing) — item 8 (Phase 3c) is CLOSED as of 2026-08-15 (by written acceptance, not code)
    and no longer blocks this item.
13. **STAGE 1 LOCK.** *Exit criteria:* §2's Stage 1 row, all criteria met. *Depends on:*
    items 1, 8, 12, **and — added 2026-08-16, owner ruling R4, WS1 Session A — R.5
    (unscripted-audio wildcard) and R.10 (scripted-text-never-spoken, R.5's companion)
    each built and verified, or explicitly accepted in writing with a reason and a
    reopening trigger.** Reverses the 2026-08-15 "R.5 is not a Stage 1 lock criterion"
    ordering decision (`sync-pipeline-v2-plan.md:4618`) — both rules address 4 of the 7
    ear-pass failures (items 4/5/10/11) found after that decision was written. Full
    ruling: `sync-pipeline-v2-plan.md`'s amended STAGE 1 LOCK GATE and its R4/R-T entries.
14. **Phase 4 — the Stage 2 restructure.** Timing-free Stage 2 return type; single Stage 1
    output object (closes P8); 5+3→5 skip-semantics change-detector; R6/R10/R12 closed or
    accepted in writing; `App.tsx:1686`'s `handleToggleLock` re-wired to the collapsed
    `applyAnchorBasedTiming`. *Depends on:* item 13 (Stage 1 lock).
15. **STAGE 2 LOCK.** *Depends on:* item 14 landing + its own Contract 2→3 verification.
16. **Phase 5 — replace the picker with the fence.** Part C's 4-line rule; deletes
    `computeBoundarySearchWindow`/`isBoundarySilenceCandidate`/`fillsTokenGapWithinSpan`;
    also builds heading-wildcard Option A's actual on-screen logic (decided, not yet
    coded). *Depends on:* item 15 (Stage 2 lock).
17. **Phase 6 — deprecate the compensation layer**, conditional on the 8 seam-exemption
    cases surviving without `isBreathSilence`/the seam exemption. **Phase 6b** — verify
    `pairIdx-20`. *Depends on:* item 16.
18. **STAGE 3 LOCK.** *Depends on:* items 16-17.
19. **Phase 7 — observability.** Clamp/floor/fallback logging; fixes the
    `boundaryUsedFallback` 4-arg bug (moot if Phase 6 already deleted the exemption it's
    about). *Depends on:* item 18 (Stage 3 lock).
20. **STAGE 4 LOCK — programme close.** *Depends on:* item 19, plus retiring the 96.2%
    figure in favor of `verification-baseline.csv` verdict counts and updating all standing
    docs.

**Definition of done for WS1:** all four stage-lock gates in §2 pass; all five open
decisions in §7 are closed (ratified or explicitly re-deferred with a new trigger); the
production writer at `App.tsx:2837` is real and gated; `FaEvent` has a real UI consumer;
CI is green (existing 4 gates run clean, `fa-ort-matrix.yml` still green).

---

Full record for cross-cutting (non-WS1-specific) rulings: `docs/history.md`'s "Decisions
Log — Dissolved from `docs/decisions/`" section, indexed at `project-state.md` §5.

**WS1 SESSION B (2026-08-16) — R-U implemented, R-Y re-capture measured, gate re-pinned.**
Six owner rulings recorded (`sync-pipeline-v2-plan.md`): **R-U** zero-seam rejection rule,
**R-V** unbundling item 7 into new defect class **R.11**, **R-W** rejecting the two-pass T1
design, **R-X** the two-tier acceptance bar amending R-S(i), **R-Y** authorising the
pre-implementation re-capture, **R-Z** reopening R.10's detector as an independent track.
Identifiers R-U…R-Z were the next free letters after R-T; R.11 the next free rule number
after R.10. **The letter series is now exhausted through Z** — the next ruling needs a new
convention.

**(a) Path exposure, established from the code before anything was written (exit S5,
clear).** `findAgreeingSilence` is FA-ONLY. It is module-private in `faAnchors.ts` and has
exactly one caller, `computeAnchors`, which has exactly one caller, `computeFaAnchors`,
whose only production caller is `faChunkPlan.ts`'s `computeRuns`. That reaches production
through exactly two paths: `forcedAlignmentRun.ts:81`, called only from `App.tsx:2854`
behind `isFaGateOpen() ? … : null`, and `App.tsx:3612`'s `__faDevAlign`, a DEV-only
devtools-console global that never writes to the project. **The Whisper anchoring path
never imports `faAnchors.ts` at all.** The `anchorSource` parameter
(`useWhisper.ts:77` → `distributeSegmentTimes`, `whisperService.ts:1495`) gates NOTHING —
it is written verbatim onto each segment as a provenance label and read nowhere in the
timing arithmetic; what actually differs between the two paths is the token array
substituted at `App.tsx:2871` (`faTokens ?? transcriptTokens`).

**(b) R-Y re-capture — real ONNX inference, not a reconstruction.** Method, in the order
that makes it trustworthy: (1) a Node driver was built that reproduces `App.tsx`'s FA
branch end to end minus the Rust leg; (2) it was fed the PREVIOUS capture's own words and
reproduced all three committed `phase4-fa-second-baseline-*-segments.csv` fixtures
**byte-for-byte**, which is what licenses reading its later output as measurement; (3) a
scratch `harness = false` Tauri binary re-ran the real `fa::fa_align` over the post-R-U
chunk plans (173 77.7s / 81 chunks, v6 154.1s / 251 chunks, spanish unchanged at 5 chunks
so not re-run); (4) a determinism control re-ran 173 at HEAD's own plan and reproduced the
original capture's 1660 word texts and timings bit-identically (confidences differ by
≤3e-8, a float-serialization artifact; `needsReview` identical on all 1660).

  **(a) TOTAL MOVED: 16 / 649 boundaries (2.5%)** — v6 6/447, 173 10/175, spanish 0/27.
  Against A.5's 179/649 upper bound: **well under, and every one of the 16 is inside the
  at-risk set** that bound describes, so the bound's derivation holds. Exit S1 clear.

  **(b) magnitude buckets:** `<0.1s` 0, `0.1–0.5s` 0, `0.5–1.0s` 4 (2 v6, 2 173), `>1.0s`
  12 (4 v6, 8 173). The rule does not make small adjustments — it either leaves a boundary
  alone or moves it a long way. That is expected of a veto that deletes an anchor outright
  rather than nudging one.

  **(c) direction:** 15 later, 1 earlier (v6 `340_fifty_eight`, −1.95s). Max +20.23s, max
  −1.95s. Strongly one-directional, which is itself worth the ear's attention.

  **(d) overlap with the 580ba0f FA-vs-Whisper movers** (re-derived independently this
  session and reproducing 580ba0f exactly: 642 shared tags, 45 moved >0.5s, 25 >1.0s):
  **6 of the 45 are in this rule's moved set against 1.1 expected under uniform placement
  — 5.4× enrichment**; 3 of the 25 >1.0s movers against 0.6 expected, 4.9×. A.5 predicted
  1.53× against the 179-boundary at-risk set; the realised set is 16 boundaries, so the
  concentration is far higher than predicted. The 8.67s v6 `030_watching_older_hunters`
  outlier is **UNMOVED**.

  **(e) item 6 — RESOLVED.** 173 `vessel_damage_clue` 172.91 → **174.74**, the ear-correct
  value, residual **0.000s** (tolerance used: 0.005s, the gate's own per-row tolerance and
  finer than the 0.01s the CSVs carry — an exact hit needs no looser one). Exit S3 clear.

  **(f) item 7 — UNCHANGED at 449.20**, bit-identical, exactly as R-V predicts. Reported,
  not celebrated: this is the mechanism model being confirmed, and it is why item 7 became
  R.11 rather than staying bundled with R-R.

  **(g) V6 seam 150/151 — UNMOVED.** `155_predator_passing_under` still 457.81; its chunk
  `[451.70, 460.56]` is bit-identical (index 81 → 73 only because earlier windows merged).
  Exit S2 clear.

  **(h) the 7 Whisper-skipped, FA-recovered boundaries: 1 of 7 moved.** 173 `blue_monkey`
  36.96 → 37.73 (+0.77). That is ear-pass item 11 — a segment the ear agreed should be
  DROPPED entirely, not retimed — so the movement changes numbers on a span that is
  wrong by construction either way; R.10 still owns it. The other six (v6
  `027_internal_change_face`, `028_small_permanent_flake`, `029_night_understanding`; 173
  `perilous_realms`, `shadow_loss`; spanish `001_scylla_intro`) are unmoved.

  **Every moved boundary, by name:**

   | project | idx | segment | pre-R-U | post-R-U | Δ | bucket |
   |---|---|---|---|---|---|---|
   | 173 | 5 | `abysmal_opinion` | 16.50 | 17.88 | +1.38 | >1.0s |
   | 173 | 12 | `blue_monkey` | 36.96 | 37.73 | +0.77 | 0.5-1.0s |
   | 173 | 13 | `eternal_focus` | 37.73 | 38.50 | +0.77 | 0.5-1.0s |
   | 173 | 47 | `vessel_damage_clue` | 172.91 | 174.74 | +1.83 | >1.0s |
   | 173 | 143 | `unstable_spirit_journey` | 586.28 | 606.51 | +20.23 | >1.0s |
   | 173 | 144 | `broken_link` | 593.88 | 609.24 | +15.36 | >1.0s |
   | 173 | 145 | `battle_network` | 597.83 | 609.99 | +12.16 | >1.0s |
   | 173 | 146 | `protection_failure` | 603.69 | 612.51 | +8.82 | >1.0s |
   | 173 | 147 | `entry_clash` | 609.24 | 613.57 | +4.33 | >1.0s |
   | 173 | 148 | `unstable_energy_consequence` | 612.51 | 615.30 | +2.79 | >1.0s |
   | v6 | 59 | `060_reassuring_hand` | 183.03 | 184.02 | +0.99 | 0.5-1.0s |
   | v6 | 223 | `224_thirty_three` | 664.33 | 666.08 | +1.75 | >1.0s |
   | v6 | 224 | `225_night_scouts` | 667.47 | 669.05 | +1.58 | >1.0s |
   | v6 | 225 | `226_four_scouts` | 670.24 | 671.18 | +0.94 | 0.5-1.0s |
   | v6 | 241 | `242_fen_excited_run` | 708.95 | 710.11 | +1.16 | >1.0s |
   | v6 | 339 | `340_fifty_eight` | 1047.57 | 1045.62 | -1.95 | >1.0s |

  **Read the 173 143–148 cluster first.** Six consecutive boundaries in the 586–615s
  region move together, and `view_trapped_warrior` (ord 142) absorbs the slack as a
  **26.80s** segment against that project's ~4s norm. It is the single riskiest thing in
  this change set and the reason R-X's control arm exists.

**(c) Implementation.** `src/services/faAnchors.ts` only, ~55 lines: `tokenSeamTimes`
(interior seams, sorted defensively), `spansATokenSeam` (binary search for a seam strictly
inside the silence), and the veto placed FIRST inside `findAgreeingSilence`'s candidate
loop. **What each surviving numeric now decides:** `ANCHOR_AGREEMENT_SEC` (0.15s) decides
only SELECTION among structurally admissible survivors — how far to look, which survivor
to prefer; `SEAM_INTERIOR_EPSILON` (1e-9, local to `faAnchors.ts`, deliberately not in
`syncConstants.ts`) is a strict-inequality guard against float equality, not a tolerance —
there is no distance below which a seam "counts as" spanned. **No distance comparison is
left deciding identity.** No tuning constant was added.

  Two things were verified rather than assumed. The shipped form (veto-then-select, binary
  search) produces a **byte-identical chunk plan on all three corpora** to the linear-scan,
  select-then-veto variant A.5 measured — so Step 3's numbers describe the shipped code,
  and M4's premise (no anchor has a competing candidate within tolerance) still holds under
  the new candidate set. Tests: 6 new cases (zero seams rejected; one seam accepted; ≥2
  seams accepted — 460/98/22 of real silences do this, so it must not be collateral; the
  item-6 configuration with its real numbers; no-surviving-candidate, where the fallback is
  that the run simply is not split and R-P force-splits instead; and the first-token case).
  13 pre-existing fixtures in `faAnchors.test.ts`/`faChunkPlan.test.ts` needed their
  silences widened to actually span a seam — they had modelled a silence ABUTTING a token
  start, which real Whisper output does not produce. Every pinned anchor time is unchanged
  by those edits, deliberately; the one expectation that genuinely changed is that the
  first token of a transcript can no longer anchor (there is no seam before it).

**(d) Gate re-pin (§9 cross-reference).** `scripts/phase4-fa-replay.test.ts` went red on 4
tests, all expected per the measurement, none unexplained; re-pinned to 13 tests (+1). The
`phase4-fa-second-baseline-*-segments.csv` fixtures were regenerated from the R-Y capture
(v6 10 changed rows, 173 14, spanish 2 — more rows than boundaries because Model P's
gapless partition means moving a boundary also rewrites the preceding segment's duration;
spanish's 2 are 616abb2's fix, nothing new). KNOWN_BAD before: items 4, 5, 6, 7, 9, 10, 11.
After: items **4, 5, 7, 10, 11** — item 6 left for a POSITIVE assertion pinned at its
ear-correct 174.74 (the only correctness assertion in the file; red there means
regression), item 9 left because 616abb2 closed it and the refreshed Spanish fixture now
shows the live 65.12, and item 11's value re-pinned 36.96 → 37.73. **M1–M5 re-run against
the re-pinned gate: M1, M2, M3, M5 RED; M4 green.** M5 — the items-6/7 error class
reproduced at a currently-correct boundary — is caught twice, by the v6 anchor digest and
by the V6-seam NAMED_WINDOWS row naming the boundary: the gate was not de-fanged by
re-pinning. M4 was reconfirmed a TRUE no-op by chunk-plan equality on all three corpora,
not merely by the gate staying green.

**(e) R-X listening lists — DRAWN, NOT LISTENED TO. ~~Session C, owner.~~ SUPERSEDED
2026-08-16 (WS1 Session B.1): both tables below were drawn from the instant reading's 16
movers, 12 of which R-AA does not move. They are left standing as the record of what was
drawn under R-U; the lists Session C actually listens to are the REDRAWN ones in the
Session B.1 block below. Do not listen to these.**

**Tier 1 — TOGGLE gate (R-X tier 1, superseding R-S(i)'s flat 12/12). 12/12 required.**
The 12 largest-magnitude boundaries R-U moved, after excluding every tag that
appears on §11 item 6's original 12-item ear list — R-S(i) requires a list drawn
fresh from the post-fix run, and scoring a fix against boundaries chosen before it
existed is exactly what that criterion rules out. (`vessel_damage_clue`, item 6, is
excluded for that reason and needs no re-listen: it is already ear-verified at
174.74 and now carries a positive assertion in the FA replay gate.)
For each: is the PROPOSED boundary where the scene change belongs?

| # | project | idx | segment | current | proposed | Δ | bucket | audio window |
|---|---|---|---|---|---|---|---|---|
| 1 | 173 | 143 | `unstable_spirit_journey` | 586.28 | 606.51 | +20.23 | >1.0s | `ffplay -ss 584.28 -t 24.23 -autoexit .work-phase4/replay/173/audio_16k.wav` |
| 2 | 173 | 144 | `broken_link` | 593.88 | 609.24 | +15.36 | >1.0s | `ffplay -ss 591.88 -t 19.36 -autoexit .work-phase4/replay/173/audio_16k.wav` |
| 3 | 173 | 145 | `battle_network` | 597.83 | 609.99 | +12.16 | >1.0s | `ffplay -ss 595.83 -t 16.16 -autoexit .work-phase4/replay/173/audio_16k.wav` |
| 4 | 173 | 146 | `protection_failure` | 603.69 | 612.51 | +8.82 | >1.0s | `ffplay -ss 601.69 -t 12.82 -autoexit .work-phase4/replay/173/audio_16k.wav` |
| 5 | 173 | 147 | `entry_clash` | 609.24 | 613.57 | +4.33 | >1.0s | `ffplay -ss 607.24 -t 8.33 -autoexit .work-phase4/replay/173/audio_16k.wav` |
| 6 | 173 | 148 | `unstable_energy_consequence` | 612.51 | 615.30 | +2.79 | >1.0s | `ffplay -ss 610.51 -t 6.79 -autoexit .work-phase4/replay/173/audio_16k.wav` |
| 7 | v6 | 339 | `340_fifty_eight` | 1047.57 | 1045.62 | -1.95 | >1.0s | `ffplay -ss 1043.62 -t 5.95 -autoexit .work-phase4/replay/v6/audio_16k.wav` |
| 8 | v6 | 223 | `224_thirty_three` | 664.33 | 666.08 | +1.75 | >1.0s | `ffplay -ss 662.33 -t 5.75 -autoexit .work-phase4/replay/v6/audio_16k.wav` |
| 9 | v6 | 224 | `225_night_scouts` | 667.47 | 669.05 | +1.58 | >1.0s | `ffplay -ss 665.47 -t 5.58 -autoexit .work-phase4/replay/v6/audio_16k.wav` |
| 10 | 173 | 5 | `abysmal_opinion` | 16.50 | 17.88 | +1.38 | >1.0s | `ffplay -ss 14.50 -t 5.38 -autoexit .work-phase4/replay/173/audio_16k.wav` |
| 11 | v6 | 241 | `242_fen_excited_run` | 708.95 | 710.11 | +1.16 | >1.0s | `ffplay -ss 706.95 -t 5.16 -autoexit .work-phase4/replay/v6/audio_16k.wav` |
| 12 | v6 | 59 | `060_reassuring_hand` | 183.03 | 184.02 | +0.99 | 0.5-1.0s | `ffplay -ss 181.03 -t 4.99 -autoexit .work-phase4/replay/v6/audio_16k.wav` |

**Tier 2 — DEFAULT gate (R-X tier 2). BLINDED, 32 boundaries.** 16 boundaries R-U
moved and 16 it did not touch, presented identically and in mixed order. The window
is a FIXED ±4s on every row on purpose: a window sized to each boundary's own delta
would have announced the arm before a note was played. **Score all 32 before opening
the key.** For each: is the boundary under test where the scene change belongs?

| # | project | idx | segment | boundary under test | audio window |
|---|---|---|---|---|---|
| 1 | 173 | 5 | `abysmal_opinion` | 17.88 | `ffplay -ss 13.88 -t 8.00 -autoexit .work-phase4/replay/173/audio_16k.wav` |
| 2 | 173 | 72 | `poisonous_terrain_shift` | 276.28 | `ffplay -ss 272.28 -t 8.00 -autoexit .work-phase4/replay/173/audio_16k.wav` |
| 3 | v6 | 28 | `029_night_understanding` | 83.53 | `ffplay -ss 79.53 -t 8.00 -autoexit .work-phase4/replay/v6/audio_16k.wav` |
| 4 | 173 | 47 | `vessel_damage_clue` | 174.74 | `ffplay -ss 170.74 -t 8.00 -autoexit .work-phase4/replay/173/audio_16k.wav` |
| 5 | 173 | 44 | `wall_split_path` | 161.33 | `ffplay -ss 157.33 -t 8.00 -autoexit .work-phase4/replay/173/audio_16k.wav` |
| 6 | spanish | 20 | `021_charybdis_whirlpool` | 58.69 | `ffplay -ss 54.69 -t 8.00 -autoexit .work-phase4/replay/spanish/audio_16k.wav` |
| 7 | v6 | 224 | `225_night_scouts` | 669.05 | `ffplay -ss 665.05 -t 8.00 -autoexit .work-phase4/replay/v6/audio_16k.wav` |
| 8 | v6 | 364 | `365_recurrent_storytelling` | 1132.87 | `ffplay -ss 1128.87 -t 8.00 -autoexit .work-phase4/replay/v6/audio_16k.wav` |
| 9 | v6 | 241 | `242_fen_excited_run` | 710.11 | `ffplay -ss 706.11 -t 8.00 -autoexit .work-phase4/replay/v6/audio_16k.wav` |
| 10 | 173 | 99 | `reveal_secret_chamber` | 389.34 | `ffplay -ss 385.34 -t 8.00 -autoexit .work-phase4/replay/173/audio_16k.wav` |
| 11 | 173 | 145 | `battle_network` | 609.99 | `ffplay -ss 605.99 -t 8.00 -autoexit .work-phase4/replay/173/audio_16k.wav` |
| 12 | v6 | 308 | `309_wide_river_meeting` | 936.25 | `ffplay -ss 932.25 -t 8.00 -autoexit .work-phase4/replay/v6/audio_16k.wav` |
| 13 | v6 | 419 | `420_silent_watch` | 1331.90 | `ffplay -ss 1327.90 -t 8.00 -autoexit .work-phase4/replay/v6/audio_16k.wav` |
| 14 | 173 | 126 | `policy_check` | 508.83 | `ffplay -ss 504.83 -t 8.00 -autoexit .work-phase4/replay/173/audio_16k.wav` |
| 15 | 173 | 143 | `unstable_spirit_journey` | 606.51 | `ffplay -ss 602.51 -t 8.00 -autoexit .work-phase4/replay/173/audio_16k.wav` |
| 16 | v6 | 253 | `254_main_observing_fen` | 741.44 | `ffplay -ss 737.44 -t 8.00 -autoexit .work-phase4/replay/v6/audio_16k.wav` |
| 17 | 173 | 12 | `blue_monkey` | 37.73 | `ffplay -ss 33.73 -t 8.00 -autoexit .work-phase4/replay/173/audio_16k.wav` |
| 18 | v6 | 59 | `060_reassuring_hand` | 184.02 | `ffplay -ss 180.02 -t 8.00 -autoexit .work-phase4/replay/v6/audio_16k.wav` |
| 19 | v6 | 225 | `226_four_scouts` | 671.18 | `ffplay -ss 667.18 -t 8.00 -autoexit .work-phase4/replay/v6/audio_16k.wav` |
| 20 | v6 | 84 | `085_the_spear_bearer` | 252.74 | `ffplay -ss 248.74 -t 8.00 -autoexit .work-phase4/replay/v6/audio_16k.wav` |
| 21 | 173 | 159 | `nature_hazard` | 662.98 | `ffplay -ss 658.98 -t 8.00 -autoexit .work-phase4/replay/173/audio_16k.wav` |
| 22 | v6 | 139 | `140_sudden_alertness` | 416.13 | `ffplay -ss 412.13 -t 8.00 -autoexit .work-phase4/replay/v6/audio_16k.wav` |
| 23 | 173 | 147 | `entry_clash` | 613.57 | `ffplay -ss 609.57 -t 8.00 -autoexit .work-phase4/replay/173/audio_16k.wav` |
| 24 | v6 | 223 | `224_thirty_three` | 666.08 | `ffplay -ss 662.08 -t 8.00 -autoexit .work-phase4/replay/v6/audio_16k.wav` |
| 25 | 173 | 148 | `unstable_energy_consequence` | 615.30 | `ffplay -ss 611.30 -t 8.00 -autoexit .work-phase4/replay/173/audio_16k.wav` |
| 26 | v6 | 339 | `340_fifty_eight` | 1045.62 | `ffplay -ss 1041.62 -t 8.00 -autoexit .work-phase4/replay/v6/audio_16k.wav` |
| 27 | 173 | 144 | `broken_link` | 609.24 | `ffplay -ss 605.24 -t 8.00 -autoexit .work-phase4/replay/173/audio_16k.wav` |
| 28 | v6 | 194 | `195_unseen_woods` | 580.16 | `ffplay -ss 576.16 -t 8.00 -autoexit .work-phase4/replay/v6/audio_16k.wav` |
| 29 | spanish | 7 | `008_heads_moving` | 17.27 | `ffplay -ss 13.27 -t 8.00 -autoexit .work-phase4/replay/spanish/audio_16k.wav` |
| 30 | 173 | 17 | `sight_blur` | 52.19 | `ffplay -ss 48.19 -t 8.00 -autoexit .work-phase4/replay/173/audio_16k.wav` |
| 31 | 173 | 13 | `eternal_focus` | 38.50 | `ffplay -ss 34.50 -t 8.00 -autoexit .work-phase4/replay/173/audio_16k.wav` |
| 32 | 173 | 146 | `protection_failure` | 612.51 | `ffplay -ss 608.51 -t 8.00 -autoexit .work-phase4/replay/173/audio_16k.wav` |

<details><summary><b>Tier 2 KEY — do not open until all 32 rows are scored</b></summary>

| # | segment | arm | pre-R-U | post-R-U | Δ | bucket |
|---|---|---|---|---|---|---|
| 1 | `abysmal_opinion` | MOVED | 16.50 | 17.88 | +1.38 | >1.0s |
| 2 | `poisonous_terrain_shift` | CONTROL | 276.28 | 276.28 | +0.00 | — |
| 3 | `029_night_understanding` | CONTROL | 83.53 | 83.53 | +0.00 | — |
| 4 | `vessel_damage_clue` | MOVED | 172.91 | 174.74 | +1.83 | >1.0s |
| 5 | `wall_split_path` | CONTROL | 161.33 | 161.33 | +0.00 | — |
| 6 | `021_charybdis_whirlpool` | CONTROL | 58.69 | 58.69 | +0.00 | — |
| 7 | `225_night_scouts` | MOVED | 667.47 | 669.05 | +1.58 | >1.0s |
| 8 | `365_recurrent_storytelling` | CONTROL | 1132.87 | 1132.87 | +0.00 | — |
| 9 | `242_fen_excited_run` | MOVED | 708.95 | 710.11 | +1.16 | >1.0s |
| 10 | `reveal_secret_chamber` | CONTROL | 389.34 | 389.34 | +0.00 | — |
| 11 | `battle_network` | MOVED | 597.83 | 609.99 | +12.16 | >1.0s |
| 12 | `309_wide_river_meeting` | CONTROL | 936.25 | 936.25 | +0.00 | — |
| 13 | `420_silent_watch` | CONTROL | 1331.90 | 1331.90 | +0.00 | — |
| 14 | `policy_check` | CONTROL | 508.83 | 508.83 | +0.00 | — |
| 15 | `unstable_spirit_journey` | MOVED | 586.28 | 606.51 | +20.23 | >1.0s |
| 16 | `254_main_observing_fen` | CONTROL | 741.44 | 741.44 | +0.00 | — |
| 17 | `blue_monkey` | MOVED | 36.96 | 37.73 | +0.77 | 0.5-1.0s |
| 18 | `060_reassuring_hand` | MOVED | 183.03 | 184.02 | +0.99 | 0.5-1.0s |
| 19 | `226_four_scouts` | MOVED | 670.24 | 671.18 | +0.94 | 0.5-1.0s |
| 20 | `085_the_spear_bearer` | CONTROL | 252.74 | 252.74 | +0.00 | — |
| 21 | `nature_hazard` | CONTROL | 662.98 | 662.98 | +0.00 | — |
| 22 | `140_sudden_alertness` | CONTROL | 416.13 | 416.13 | +0.00 | — |
| 23 | `entry_clash` | MOVED | 609.24 | 613.57 | +4.33 | >1.0s |
| 24 | `224_thirty_three` | MOVED | 664.33 | 666.08 | +1.75 | >1.0s |
| 25 | `unstable_energy_consequence` | MOVED | 612.51 | 615.30 | +2.79 | >1.0s |
| 26 | `340_fifty_eight` | MOVED | 1047.57 | 1045.62 | -1.95 | >1.0s |
| 27 | `broken_link` | MOVED | 593.88 | 609.24 | +15.36 | >1.0s |
| 28 | `195_unseen_woods` | CONTROL | 580.16 | 580.16 | +0.00 | — |
| 29 | `008_heads_moving` | CONTROL | 17.27 | 17.27 | +0.00 | — |
| 30 | `sight_blur` | CONTROL | 52.19 | 52.19 | +0.00 | — |
| 31 | `eternal_focus` | MOVED | 37.73 | 38.50 | +0.77 | 0.5-1.0s |
| 32 | `protection_failure` | MOVED | 603.69 | 612.51 | +8.82 | >1.0s |

</details>


  **Estimated listening time** at A.5's ~25s/boundary: Tier 1 12 × 25s ≈ **5 min**; Tier 2
  32 × 25s ≈ **13 min**, of which Tier 1's rows are not reused (the two lists are disjoint
  in presentation — Tier 2 is blinded and single-valued), so budget **~18 min total**.

**(f) R-Z — R.10 detector, open independent track.** Documented only; full text in
`sync-pipeline-v2-plan.md` beside R.10. Not a Session C blocker.

**(g) Side-task sweep — nothing obsoleted, one item newly informed.**
  - §11 item 9 / §3 row 2 (**Task 2, 50/50 silence-split re-derivation**): unaffected.
    `snapBoundaries.ts` was untouched. Worth flagging that this session confirmed
    `snapBoundaries.ts` is the AMPLIFIER behind item 6 — from the false 173.12 anchor it
    picked `[172.70,173.12]`→172.91 where from a correct anchor it picks
    `[174.52,174.96]`→174.74, and that 1.83s is the distance between two adjacent silence
    midpoints. That is context for Slice 2, not a change to its scope.
  - §11 item 10 (**Task 3, stale-anchor scroll degradation test**): the suspected overlap
    does not exist. That item is about anchor STALENESS across re-syncs; R-U changes which
    silences may become anchors within a single run. Neither obsoletes nor blocks it.
  - §11 item 11 (**Contract 1→2 gaps**, §9 P4/P6/P8): unaffected. P4's silence assertion
    concerns the Stage-1 output contract, not R.1's admissibility test.
  - **Word-shift leftovers**: unaffected — none of the 16 moved boundaries is a word-shift
    case, and the word-shift harness reads the Whisper path, which R-U cannot reach (see
    (a)).

**(h) PREMISE CHECK — the seam DEFINITION is unruled and it matters. ~~Owner decision needed
before Session C listens.~~ RULED 2026-08-16 (WS1 Session B.1): the seam-REGION reading is
ADOPTED as R-AA; everything below is the evidence that ruling was taken on, and the
16-mover numbers above are superseded by the 4 recorded in the Session B.1 block.** Full
evidence and table in `sync-pipeline-v2-plan.md` under "OPEN AGAINST R-U" / R-AA. In short: R-U says "spans a token seam"; the shipped reading treats a
seam as the instant `tokens[i].startSec` and requires strict containment, which is right
where Whisper is gapless (86–91% of pairs) and over-rejects where it is not — a silence
sitting cleanly inside a real inter-word GAP spans no instant and is vetoed, which is the
opposite of the intent A.5 stated. The seam-REGION reading was measured this session:
**69/649 upper bound and 4/649 actual movers** (a strict subset of the shipped 16), reaching
the **same** ear-correct 174.74 on item 6 and leaving item 7 and the V6 seam alone. It was
NOT shipped because R-U was ruled on the 179/649 profile and every stop-and-rule exit was
calibrated to it. Its FA inference is already captured
(`.work-phase4/recap/words-VG-*.json`), so adopting it is a re-measure, not a re-derivation.


**WS1 SESSION B.1 (2026-08-16) — R-AA adopted: the seam-REGION reading. Re-measured,
re-implemented, gate re-pinned a second time, R-X lists redrawn.**
One owner ruling recorded (`sync-pipeline-v2-plan.md`): **R-AA**, amending R-U's seam
DEFINITION only. **Identifier convention change, recorded once so it is not rediscovered:
the single-letter series is exhausted at R-Z; rulings continue R-AA, R-AB, R-AC, … The
rule-number series (`R.1`…`R.11`) is separate and unaffected — next free is R.12.**
Session B's own final report flagged the instant reading as a wrong premise inherited from
its brief; this session is the consequence of that flag being right.

**(a) The shipped predicate, and what degenerates.**

```ts
// seam i (between token i-1 and token i) as an INTERVAL, min/max-guarded
// against a negative gap (0/3988, 0/1835, 0/362 measured — none exists).
const seam = prevEnd <= thisStart ? [prevEnd, thisStart] : [thisStart, prevEnd];
// spans === closed-interval overlap with the silence
spansATokenSeam(s) === ∃ seam [a, b] : a <= s.endSec && b >= s.startSec
```

Implemented as one binary search over seam starts plus a prefix-max of seam ends
(`faAnchors.ts`'s `tokenSeamIndex`/`spansATokenSeam`), because sorting by start alone is
not sufficient — a wide early seam can overlap a silence a later, narrower one does not.

  - **(a) Degeneracy — and here the brief's premise was WRONG, stated plainly.** Where
    Whisper is gapless the seam interval collapses to the instant `tokens[i].startSec`, so
    the region reading becomes a POINT-IN-INTERVAL test — but a CLOSED one, where the
    instant reading was STRICT. The two therefore do NOT behave identically on gapless
    pairs: they differ exactly on coincidence, and coincidence occurs in this corpus.
    Measured over the distinct detected silences: the region reading accepts 24 (v6), 79
    (173) and 2 (spanish) silences the instant reading vetoed, of which **7 (6 v6, 1 173,
    0 spanish) are gapless-seam coincidences** and the other 98 are positive-gap overlaps.
    At anchor level: accepted R.1 anchors go 296 → 312 (v6), 107 → 142 (173), 4 → 4
    (spanish); the closed-instant reading alone (no gap regions) would give 307/119/4, so
    both halves of the widening are load-bearing. The coincidence half is not an accident
    of the implementation — it is the case where a silence's `endSec` IS the token onset,
    i.e. R.1(c) agreement at distance **0.000s**, the strongest agreement obtainable,
    rejected by the instant reading for touching rather than containing.
  - **(b) Accepts a silence wholly inside a positive gap** — the case the instant reading
    wrongly vetoed. Unit-tested (`faAnchors.test.ts`, "ACCEPTS a silence lying wholly
    INSIDE a positive inter-token gap"), and RED against the instant implementation.
  - **(c) Still rejects a silence wholly inside one token's span** — R-U's whole purpose.
    Unit-tested next to a real gap so it is not trivially true, and green under both
    readings. Ear-pass item 6's own configuration (silence `[172.70, 173.12]` inside token
    464 "chemical" `[172.57, 173.18]`) is still vetoed, which is why 174.74 survives.

  **Predicate drift check (the class Session B caught by testing both orderings).** The
  shipped code vetoes per candidate BEFORE selecting (`findAgreeingSilence`'s loop); the
  variant Session B measured selected first and vetoed the winner. Measured, not argued:
  **0 candidates differ** between the two orderings, under every reading tested (none/
  instant-strict/instant-closed/region), on all three corpora — and the shipped code's
  production chunk plan is digest-identical to the captured `plan-VG-*.json` the real ONNX
  inference was actually run over (v6 `14fbd829e54f0869`, 173 `b4c4611508f7b58e`, spanish
  `c7e4be33cf7ab3c7`). The measurement therefore describes the shipped code.

  **`SEAM_INTERIOR_EPSILON` (1e-9) REMOVED, not kept.** Under the instant reading it was a
  strict-inequality float guard. Under closed-interval overlap it can only widen an
  already-inclusive comparison, i.e. it would be a tolerance — the thing R-U exists to
  remove. Verified behaviour-identical with and without it (identical anchor counts on all
  three corpora), then deleted rather than left as a constant that no longer earns its
  place. Surviving numerics in this file: `ANCHOR_AGREEMENT_SEC` (0.15s), which selects
  among structurally admissible survivors and never decides identity;
  `MIN_ANCHOR_WORD_CHARS`, `GLIDE_INITIAL_CHARS`, `RUN_SURVIVAL_MIN_RUN_LONG` (R-O/R.1(b)
  admissibility, text-shape not time), `MAX_RUN_SEC` (R.4). **No distance comparison
  decides identity anywhere in the module.**

**(b) THE DROPPED 12 — does the enrichment survive the narrowing? (stop-and-rule exit S6:
CLEAR.)** Method identical to Session B's, so the numbers are comparable.

  - **Subset:** the region reading's 4 movers are a strict subset of the instant reading's
    16, verified row-for-row (`VG \ VE = ∅`). The readings are nested; the comparison
    stands.
  - **Reference-set correction, found while re-deriving.** The "45 >0.5s / 25 >1.0s"
    FA-vs-Whisper movers quoted since 580ba0f are **44 / 24** against the current
    fixtures. The single difference is spanish `023_scylla_six_sailors`, which cleared
    both thresholds only at its stale pre-616abb2 66.73; at the live 65.12 it clears
    neither. Everything below uses 44/24 and also reports the instant reading against the
    same corrected sets, so the two are like-for-like.
  - **Enrichment** (hypergeometric, population 649):

    | mover set | in the 44 (>0.5s) | expected | ratio | p | in the 24 (>1.0s) | expected | ratio | p |
    |---|---|---|---|---|---|---|---|---|
    | instant, 16 movers | 6 | 1.08 | 5.5× | 0.0003 | 3 | 0.59 | 5.1× | 0.0182 |
    | **region, 4 movers** | **3** | 0.27 | **11.1×** | 0.0011 | **2** | 0.15 | **13.5×** | 0.0075 |

  - **Interpretation, and it is a direction rather than a proof.** The enrichment does not
    concentrate in the dropped 12 — it splits 3/3, but across arms of very different size:
    **3 of the 4 surviving movers are in the 44 (75%), against 3 of the 12 dropped (25%)**.
    Per boundary asked of the ear, the narrower rule is three times as likely to be
    pointing at a boundary independently suspected of being wrong. Nine of the twelve
    dropped are in neither set — no independent evidence against them at all. So the
    narrowing is not trading correctness for a smaller listening bill on this evidence.
    **Said honestly: n = 4.** Two of the four p-values rest on 2-3 observations, and no
    number here says the dropped 12 are all fine — only that most of them were never
    suspect on any evidence outside the instant reading itself.
  - **The 12 dropped, in full — NAMED CANDIDATE DEFECTS, left unfixed by this ruling.**
    "Membership" is against the corrected 44/24 sets.

    | project | idx | segment | pre-R-U baseline | instant reading gave | Δ | membership |
    |---|---|---|---|---|---|---|
    | 173 | 143 | `unstable_spirit_journey` | 586.28 | 606.51 | +20.23 | neither |
    | 173 | 144 | `broken_link` | 593.88 | 609.24 | +15.36 | neither |
    | 173 | 145 | `battle_network` | 597.83 | 609.99 | +12.16 | neither |
    | 173 | 146 | `protection_failure` | 603.69 | 612.51 | +8.82 | **in the 44** |
    | 173 | 147 | `entry_clash` | 609.24 | 613.57 | +4.33 | neither |
    | 173 | 148 | `unstable_energy_consequence` | 612.51 | 615.30 | +2.79 | neither |
    | v6 | 223 | `224_thirty_three` | 664.33 | 666.08 | +1.75 | neither |
    | v6 | 224 | `225_night_scouts` | 667.47 | 669.05 | +1.58 | neither |
    | 173 | 5 | `abysmal_opinion` | 16.50 | 17.88 | +1.38 | **in the 44 and the 24** |
    | v6 | 225 | `226_four_scouts` | 670.24 | 671.18 | +0.94 | **in the 44** |
    | 173 | 12 | `blue_monkey` | 36.96 | 37.73 | +0.77 | neither |
    | 173 | 13 | `eternal_focus` | 37.73 | 38.50 | +0.77 | neither |

    The three in the 44 — `protection_failure`, `abysmal_opinion` (also in the 24) and
    `226_four_scouts` — are the named candidates a later rule should revisit. They are not
    fixed by R-AA and are not silently gone.
  - **Item 11 (`blue_monkey`) does NOT move under the region reading.** It stays at its
    pre-Session-B 36.96, so its KNOWN_BAD pin in the FA replay gate reverts to 36.96. The
    mechanism (R.10, scripted text never spoken) is untouched either way — the span is
    wrong by construction, not by 0.77s.
  - **The 173 ord 143-148 cluster is entirely DROPPED** — all six boundaries unmoved, and
    `view_trapped_warrior` was never moved by either reading (579.71 throughout; its 26.80s
    duration is a pre-existing property of the FA baseline, not something this rule
    created). Session B's riskiest row is gone: the six-boundary cascade in 586-615s that
    the instant reading produced does not exist under R-AA.

**(c) Implementation and fixture reverts.**
  - `src/services/faAnchors.ts` only, as scoped: `tokenSeamTimes` → `tokenSeamIndex`
    (intervals + prefix-max), `spansATokenSeam` rewritten to closed-interval overlap,
    `SEAM_INTERIOR_EPSILON` deleted, the veto's position in `findAgreeingSilence`'s
    candidate loop unchanged. `snapBoundaries.ts` (the confirmed item-6 amplifier),
    `faChunkPlan.ts`, `syncConstants.ts`, `silenceDetector.ts` and the Hirschberg aligner
    untouched.
  - **Exit S5 re-confirmed after the edit:** `findAgreeingSilence` is still module-private
    with exactly one caller (`computeAnchors` → `computeFaAnchors` →
    `faChunkPlan.ts`'s `computeRuns`), reaching production only through
    `forcedAlignmentRun.ts:81` behind `App.tsx:2854`'s gate check and the DEV-only
    `__faDevAlign`. No new export leaves the module except the `SeamIndex` type, which is
    a type, not a value.
  - **12 of Session B's 13 fixture edits reverted.** `phase4-fa-second-baseline-v6-segments.csv`
    and `-173-segments.csv` were replaced with the region reading's own captured output.
    Verified against pre-Session-B (`7468ff3`): the v6 fixture now differs from it at
    exactly **3 boundaries (6 rows)** and the 173 fixture at exactly **1 boundary (2
    rows)** — every other row byte-identical, i.e. all 12 dropped boundaries carry their
    exact pre-Session-B values again. The spanish fixture keeps Session B's item-9 refresh
    (65.12, not the stale 66.73): that came from 616abb2, not from the seam rule, and the
    region reading leaves spanish untouched.
  - **Tests:** Session B's five R-U cases all still pass unchanged; three new cases in a
    `R-AA seam REGION reading` block cover the positive-gap acceptance, the touching-at-
    `endSec` acceptance, and the still-rejected inside-one-token case. Red-then-green
    verified: the first two FAIL against the instant implementation and pass against this
    one.

**(d) Re-measurement (reusing Session B's captured FA inference for this reading).**

  **Every moved boundary, by name — 4 of them:**

  | project | idx | segment | pre-R-U | post-R-AA | Δ | bucket |
  |---|---|---|---|---|---|---|
  | 173 | 47 | `vessel_damage_clue` | 172.91 | 174.74 | +1.83 | >1.0s |
  | v6 | 59 | `060_reassuring_hand` | 183.03 | 184.02 | +0.99 | 0.5-1.0s |
  | v6 | 241 | `242_fen_excited_run` | 708.95 | 710.11 | +1.16 | >1.0s |
  | v6 | 339 | `340_fifty_eight` | 1047.57 | 1045.62 | −1.95 | >1.0s |

  - **(a) TOTAL MOVED: 4 / 649 (0.6%)** — v6 3/447, 173 1/175, spanish 0/27. Against the
    region reading's own **69/649** upper bound: well under. Exit S1 clear.
  - **(b) magnitude buckets:** `<0.1s` 0, `0.1–0.5s` 0, `0.5–1.0s` 1 (v6), `>1.0s` 3 (2
    v6, 1 173). Same character as the instant reading — a veto deletes an anchor outright,
    so a boundary either stays put or moves a long way — but the tail is gone with the
    dropped cluster: max |Δ| is 1.95s, against 20.23s.
  - **(c) direction:** 3 later, 1 earlier (v6 `340_fifty_eight`, −1.95s). The instant
    reading's 15:1 one-directional character does NOT survive at this n — 3:1 on four
    observations is not evidence of a direction, and should not be reported as one.
  - **(d) item 6 — RESOLVED, identically.** 173 `vessel_damage_clue` 172.91 → **174.74**,
    residual **0.000s** at the gate's own 0.005s per-row tolerance. Exit S3 clear.
    Item 7 (v6 `152_frozen_brush_mice`) **unmoved at 449.20**, as R-V predicts. V6 seam
    150/151 **unmoved**: `155_predator_passing_under` still 457.81, its chunk
    `[451.70, 460.56]` bit-identical (index 73 → 77 only). Exit S2 clear.
  - **(e) the 7 Whisper-skipped, FA-recovered boundaries: 0 of 7 move.** Under the instant
    reading one did (`blue_monkey`); under the region reading none does.
  - **(f) chunk-plan equality between veto-then-select and select-then-veto: confirmed** on
    all three corpora (see (a) above). The measurement describes the shipped code.

**(e) FA replay gate — the SECOND re-pin, and proof it still bites.**

  Row diff before re-pinning: 4 of 13 tests red, every one EXPECTED-PER-(d), none
  UNEXPECTED — (1) `173` KNOWN-BAD: `blue_monkey` 37.73 → 36.96, the item-11 revert;
  (2) `v6` anchor path: run count 297 → 313, anchors 296 → 312, chunks 251 → 264, all three
  digests; (3) `173` anchor path: 110 → 143 runs, 107 → 142 anchors, 81 → 112 chunks, all
  three digests; (4) NAMED_WINDOWS: chunk indices 22 → 31 (173) and 72 → 76 / 73 → 77 (v6).
  **The three named windows' BOUNDS did not move at all** — `[161.46, 174.96]`,
  `[448.34, 451.70]`, `[451.70, 460.56]` are bit-identical to the instant reading's — only
  their indices shifted, because the region reading restores anchors earlier in each
  corpus. Nine tests stayed green throughout, item 6's positive assertion at 174.74 among
  them: it has now survived both re-pins, which is the whole reason it is pinned at the
  ear-correct value rather than the current one.

  KNOWN_BAD before → after: items 4, 5, 7, 10 unchanged at 928.67 / 128.43 / 449.20 / 1.36;
  item 11 `blue_monkey` **37.73 → 36.96**; item 6 stays OUT (positive assertion, 174.74);
  item 9 stays OUT (closed by 616abb2). Manifest still covers exactly {4, 5, 7, 10, 11}.

  | Mutation | Re-pinned gate (13 tests) |
  |---|---|
  | M1 anchor shifted +1 token index | 🔴 4 fail |
  | M2 anchor time shifted +0.3s | 🔴 4 fail |
  | M3 agreement check disabled | 🔴 4 fail |
  | M4 selection preference inverted | 🟢 13/13 — true no-op, see below |
  | M5 **items-6/7 error class at a currently-correct boundary** | 🔴 2 fail |

  **M5 red is the number that matters:** this is the second consecutive re-pin, and a gate
  that only proves itself against superseded fixtures proves nothing. **M4 reconfirmed a
  TRUE no-op by chunk-plan equality, not by colour:** run under M4, the anchor/run/chunk
  digests come back byte-identical on all three corpora (v6 `f3f469a68664596a` /
  `4d95968b519576da` / `14fbd829e54f0869`, and likewise 173 and spanish). The candidate set
  changed again with this ruling, so this was re-measured rather than inherited. Chunk-plan
  fidelity against the real production capture re-verified unchanged: **v6 280/280, 173
  118/118** rows identical at HEAD's own plan, spanish 3/5 (the documented pre-616abb2
  staleness).

**(f) R-X listening lists — REDRAWN (R-X amendment, WS1 Session B.1). NOT LISTENED TO;
Session C, owner.** These supersede Session B's 12+32; those were drawn from movers this
ruling does not move.

**Tier 1 — TOGGLE gate (R-X tier 1, superseding R-S(i)'s flat 12/12). 12/12 required.**
Twelve SCORED rows, all drawn fresh from the post-R-AA run: the **3 boundaries R-AA
moves** that are not already ear-verified, plus **9 boundaries it does not move**,
stratified by corpus and by FA-vs-Whisper disagreement so the list is not all
large-delta cases. Ear-pass item 6 is the 4th mover and is listed separately below
as a disclosed, UNSCORED positive control: it is already ear-verified at 174.74, and
R-S(i) forbids scoring the toggle gate against a boundary chosen before the fix
existed. For each: is the PROPOSED boundary where the scene change belongs?

**Score Tier 2 BEFORE this table if both are run in one sitting** — this one
discloses which rows moved, and four of them reappear blinded in Tier 2.

| # | project | idx | segment | current | proposed | Δ | arm | audio window |
|---|---|---|---|---|---|---|---|---|
| 1 | v6 | 339 | `340_fifty_eight` | 1047.57 | 1045.62 | -1.95 | MOVED | `ffplay -ss 1043.62 -t 5.95 -autoexit .work-phase4/replay/v6/audio_16k.wav` |
| 2 | v6 | 241 | `242_fen_excited_run` | 708.95 | 710.11 | +1.16 | MOVED | `ffplay -ss 706.95 -t 5.16 -autoexit .work-phase4/replay/v6/audio_16k.wav` |
| 3 | v6 | 59 | `060_reassuring_hand` | 183.03 | 184.02 | +0.99 | MOVED | `ffplay -ss 181.03 -t 4.99 -autoexit .work-phase4/replay/v6/audio_16k.wav` |
| 4 | 173 | 19 | `ancient_schematic_view` | 59.59 | 59.59 | +0.00 | UNMOVED | `ffplay -ss 55.59 -t 8.00 -autoexit .work-phase4/replay/173/audio_16k.wav` |
| 5 | 173 | 101 | `explosive_focus` | 399.29 | 399.29 | +0.00 | UNMOVED | `ffplay -ss 395.29 -t 8.00 -autoexit .work-phase4/replay/173/audio_16k.wav` |
| 6 | 173 | 105 | `void_boundary` | 413.69 | 413.69 | +0.00 | UNMOVED | `ffplay -ss 409.69 -t 8.00 -autoexit .work-phase4/replay/173/audio_16k.wav` |
| 7 | spanish | 1 | `002_scylla_cliff_passage` | 1.06 | 1.06 | +0.00 | UNMOVED | `ffplay -ss 0.00 -t 8.00 -autoexit .work-phase4/replay/spanish/audio_16k.wav` |
| 8 | v6 | 27 | `028_small_permanent_flake` | 80.74 | 80.74 | +0.00 | UNMOVED | `ffplay -ss 76.74 -t 8.00 -autoexit .work-phase4/replay/v6/audio_16k.wav` |
| 9 | v6 | 212 | `213_pensive_stare` | 626.77 | 626.77 | +0.00 | UNMOVED | `ffplay -ss 622.77 -t 8.00 -autoexit .work-phase4/replay/v6/audio_16k.wav` |
| 10 | v6 | 321 | `322_body_readiness` | 986.71 | 986.71 | +0.00 | UNMOVED | `ffplay -ss 982.71 -t 8.00 -autoexit .work-phase4/replay/v6/audio_16k.wav` |
| 11 | v6 | 405 | `406_listening_darkness` | 1289.74 | 1289.74 | +0.00 | UNMOVED | `ffplay -ss 1285.74 -t 8.00 -autoexit .work-phase4/replay/v6/audio_16k.wav` |
| 12 | v6 | 413 | `414_past_firelight` | 1315.70 | 1315.70 | +0.00 | UNMOVED | `ffplay -ss 1311.70 -t 8.00 -autoexit .work-phase4/replay/v6/audio_16k.wav` |

| — | project | idx | segment | current | proposed | Δ | arm | audio window |
|---|---|---|---|---|---|---|---|---|
| C | 173 | 47 | `vessel_damage_clue` | 172.91 | 174.74 | +1.83 | MOVED, ear-verified, **not scored** | `ffplay -ss 170.91 -t 5.83 -autoexit .work-phase4/replay/173/audio_16k.wav` |

**Tier 2 — DEFAULT gate (R-X tier 2). BLINDED, 8 boundaries.** The 4 boundaries R-AA
moves and 4 it does not, presented identically and in mixed order. The window is a
FIXED ±4s on every row on purpose: a window sized to each boundary's own delta would
announce the arm before a note was played. **Score all 8 before opening the key.**
For each: is the boundary under test where the scene change belongs?

| # | project | idx | segment | boundary under test | audio window |
|---|---|---|---|---|---|
| 1 | 173 | 47 | `vessel_damage_clue` | 174.74 | `ffplay -ss 170.74 -t 8.00 -autoexit .work-phase4/replay/173/audio_16k.wav` |
| 2 | 173 | 9 | `historical_visual` | 30.06 | `ffplay -ss 26.06 -t 8.00 -autoexit .work-phase4/replay/173/audio_16k.wav` |
| 3 | v6 | 339 | `340_fifty_eight` | 1045.62 | `ffplay -ss 1041.62 -t 8.00 -autoexit .work-phase4/replay/v6/audio_16k.wav` |
| 4 | v6 | 241 | `242_fen_excited_run` | 710.11 | `ffplay -ss 706.11 -t 8.00 -autoexit .work-phase4/replay/v6/audio_16k.wav` |
| 5 | v6 | 412 | `413_fifteen_girl` | 1314.27 | `ffplay -ss 1310.27 -t 8.00 -autoexit .work-phase4/replay/v6/audio_16k.wav` |
| 6 | spanish | 12 | `013_no_fighting_strategy` | 34.21 | `ffplay -ss 30.21 -t 8.00 -autoexit .work-phase4/replay/spanish/audio_16k.wav` |
| 7 | v6 | 343 | `344_marked_palms` | 1061.00 | `ffplay -ss 1057.00 -t 8.00 -autoexit .work-phase4/replay/v6/audio_16k.wav` |
| 8 | v6 | 59 | `060_reassuring_hand` | 184.02 | `ffplay -ss 180.02 -t 8.00 -autoexit .work-phase4/replay/v6/audio_16k.wav` |

<details><summary><b>Tier 2 KEY — do not open until all 8 rows are scored</b></summary>

| # | segment | arm | pre-R-AA | post-R-AA | Δ | bucket |
|---|---|---|---|---|---|---|
| 1 | `vessel_damage_clue` | MOVED | 172.91 | 174.74 | +1.83 | >1.0s |
| 2 | `historical_visual` | CONTROL | 30.06 | 30.06 | +0.00 | — |
| 3 | `340_fifty_eight` | MOVED | 1047.57 | 1045.62 | -1.95 | >1.0s |
| 4 | `242_fen_excited_run` | MOVED | 708.95 | 710.11 | +1.16 | >1.0s |
| 5 | `413_fifteen_girl` | CONTROL | 1314.27 | 1314.27 | +0.00 | — |
| 6 | `013_no_fighting_strategy` | CONTROL | 34.21 | 34.21 | +0.00 | — |
| 7 | `344_marked_palms` | CONTROL | 1061.00 | 1061.00 | +0.00 | — |
| 8 | `060_reassuring_hand` | MOVED | 183.03 | 184.02 | +0.99 | 0.5-1.0s |

</details>

  **Estimated listening time** at ~25s/boundary: Tier 1 13 rows ≈ **5.5 min** (12 scored +
  1 disclosed control), Tier 2 8 rows ≈ **3.5 min** — **~9 min total**, against ~18-19 min
  for Session B's draw.

**(g) Documentation hygiene (Session B findings, closed here).**
  - **v6 audio length: 1421.29 is correct; the single `1421.26` was wrong and is fixed.**
    Measured directly from the replay WAV header: 22,740,695 frames at 16 kHz =
    **1421.2934s**. The golden baseline's last segment ends at 1421.29, and every fixture,
    the golden replay and the FA gate already used 1421.29 — one prose line in this file
    (§11 item 1's smoke-test follow-on) carried 1421.26 and now does not. Same line called
    the run "447 chunks"; 447 is the SEGMENT count (the plan was 280 chunks), corrected in
    passing.
  - **`_provenance.chunk_count` in the captured FA word files is a WORD count** (v6 3874,
    173 1660, spanish 249 — spanish's plan has 5 chunks, not 249). The key is renamed to
    `word_count` in `.work-phase4/recap/words-*.json`, and recorded here because those
    captures are gitignored scratch and cannot carry their own correction into the repo.
  - **649 / 642 / 639 reconciliation:** already stated once, durably, at this file's
    "642 vs. 639 boundary-count discrepancy" entry, which everything else should cite
    rather than re-derive. Confirmed still the only statement of it; its own trailing
    "45 moved >0.5s, 25 moved >1.0s" figures are corrected to **44 / 24** there, for the
    reason recorded in (b) above.


---

**WS1 SESSION C (2026-08-16/17) — the ear pass closes; the ZERO-DEFECT PROGRAM opens.
Five rulings recorded, three of them OVERRIDES; the Zero-Defect Register built and made
machine-checkable; two blocking diagnoses measured. NO production code changed —
`git diff` over `src/` and `src-tauri/` is empty except `scripts/phase4-fa-replay.test.ts`.
FA gate stays OFF.**

**(a) Rulings — R-AB..R-AF, recorded in `sync-pipeline-v2-plan.md`'s "WS1 SESSION C
RULINGS" block.** Owner aliases in brackets. Rule-number series untouched; next free
rule number is still **R.12**.

| id | alias | what | overrides |
|---|---|---|---|
| **R-AB** | RC1 | Tier 2 satisfied; the ordering defect recorded (Tier 1 scored first, spending Tier 2's blinding). Result stands; blinded-tier-first is binding on the next draw. | — |
| **R-AC** | RC4 | Unscored disclosed control accepted; Tier 1 12/12 stands. | — |
| **R-AD** | OV1 | **FA default flip DEFERRED to the final act of Stage 1, gated on an EMPTY register.** | owner's RC2 ("FA default ON now") |
| **R-AE** | OV2 | **Item 7 / R.11 PULLED INTO Stage 1.** | R-V's "*Placement:* after Stage 1" |
| **R-AF** | OV3 | **The three RC3 candidates TRIAGED, not parked.** | owner's RC3 ("park them") |

Each override is reachable from what it overrides: R-AD from R-S(iii)'s runtime paragraph
and from the STAGE 1 LOCK GATE; R-AE from R-V/R.11; R-AF from R-AA's "12 dropped"
paragraph; R-AB from R-AA's Tier-ordering amendment. **RC2 and RC3 had never been written
into any document** — both are now recorded verbatim inside the ruling that overrides
them, because an override pointing at nothing is not an override.

**Scope, written into the lock gate rather than a footnote:** Stage 1's "zero defects" is
**en/es only**. R-T defers fr/de/pt and that corpus does not exist. Carried risk, recorded
against whichever later stage takes non-English: **text-normalization Rules 1-5 shipped
for French, Portuguese and German and have never once been exercised against real audio.**

**(b) THE ZERO-DEFECT REGISTER — reconciled across four sources.** Sources: the plan doc's
rule text, this ledger's 12-item mechanism table, the FA gate's `KNOWN_BAD` manifest, and
the ear-pass results. All four agree on the five open entries; no source carried an entry
the others lacked.

| ear item | corpus / tag | current | ear-correct | owning rule | in Stage 1 via | status |
|---|---|---|---|---|---|---|
| 4 | v6 `308_scouts_leading` | 928.67 | 931.40 | R.5 | R4 | OPEN |
| 5 | v6 `043_night_migration` | 128.43 | 130.96 | R.5 | R4 | OPEN |
| 7 | v6 `152_frozen_brush_mice` | 449.20 | 451.03 | R.11 | **R-AE** | OPEN |
| 10 | 173 `hostile_landscape` | 1.36 | 0.00 | R.10 | R4 | OPEN |
| 11 | 173 `blue_monkey` | 36.96 | *(drop, no numeric target)* | R.10 | R4 | OPEN |
| 6 | 173 `vessel_damage_clue` | — | **174.74 asserted** | R-U/R-AA | — | CLOSED `92746cf` |
| 9 | spanish `023_scylla_six_sailors` | — | **65.12 asserted** | forced-split | — | CLOSED `616abb2` |

Item 9 was CONVERTED this session: it had been carried as a note only, and the Session B
fixture refresh means the Spanish baseline now shows the live 65.12, so it can carry a
real positive assertion. **Register: 5 open, 2 closed, roster 7.**

**Exit status: X1 clear, X2 FLAGGED, X3 clear-but-qualified, X4 clear.** See (c)/(d).

**(c) Enforcement — how each requirement is actually held** (`scripts/phase4-fa-replay.test.ts`,
new `describe('WS1 Session C — the Zero-Defect Register')`):

| requirement | mechanism |
|---|---|
| a test asserting the manifest is empty, skipped with a reason naming the open items | `it.skip('the Zero-Defect Register is EMPTY — SKIPPED: 5 open defects (item 4 R.5, …)')`. Skipped rather than red so a red suite always means REGRESSION, never "work not done". Un-skipping it is the Stage 1 lock's machine check, and it is now a criterion in the plan doc's STAGE 1 LOCK GATE. |
| the manifest may only ever shrink, loudly | `REGISTER_HIGH_WATER = 5` + a test asserting `open.length <= REGISTER_HIGH_WATER`, whose failure message demands the constant, the roster and this ledger all be updated together. Growth cannot be a silent one-line diff. |
| each entry carries item, rule, current, ear-correct, closing commit | `KnownBadRow` gained `owningRule` and `closingCommit` (empty until closed) as typed fields; `item`/`faValue`/`earCorrect` already existed. A bookkeeping test enforces that open rows have no closing commit and closed rows have one. |
| removing an entry requires a positive assertion replacing it | `REGISTER_ROSTER` (append-only, all 7 items ever registered) + `CLOSED_BY_POSITIVE_ASSERTION`. Every roster member must be open in `KNOWN_BAD` **or** present in the closed list, and each closed entry generates its own `it` asserting the committed fixture at the **ear-correct** value. Deleting a row without converting it fails the roster test. This generalizes the pattern item 6 already followed at 174.74 so a future session cannot forget to copy it. |

Gate size: **13 → 19 passing + 1 skipped.** M5 re-proved RED after the extension (2 failed
/ 17 passed / 1 skipped) — the register did not weaken the gate. Mutation applied and
reverted by explicit snapshot copy, never `git checkout`; `faAnchors.ts` sha256
`b61e94cb…` identical before and after.

**(d) DIAGNOSIS A — the R.10 detector respec. A clean discriminant EXISTS. Two premises in
R-Z are WRONG on measurement.**

*Method.* The real production aligner (`alignScenestoTranscript` after
`filterMalformedTokens`) run over all three corpora from committed fixtures, joined to the
R-AA FA word capture (`.work-phase4/recap/words-VG-*.json`, byte-identical `segs-VG-*` to
the committed fixtures) with FA words attributed to segments by sequence alignment
(monotonic, 0 unattributed, 649/649 segments).

*Premise failures, measured against four independent input variants (filtered/raw tokens,
with/without silences+duration, FA-baseline/Whisper-baseline segment arrays) — every
variant gives the same answer:*

| R-Z claim | measured |
|---|---|
| `perilous_realms` scores `alignConfidence` **0.778**, 0.009 from its victim | **0.0000** (0/9), `matched: false`. It is **0.769 away**, not 0.009. |
| `blue_monkey` scores `alignConfidence` **1.000** | **0.0000** (0/7), `matched: false` |
| item 9 `023_scylla_six_sailors` scores **1.000** and false-fires | **0.2857** (2/7) — it does **not** false-fire on the corrected signal |
| the `alignConfidence == 1.000` conjunct is **degenerate on v6** (all 447 exactly 1.000) | **331/447 (74%)**, not 447. Informative, not constant. |
| `hostile_landscape` 0.769 | **0.7692** ✓ — the one figure that reproduces |

**The thief/victim adjacency that motivated R-Z does not exist.** It was an artifact of
those numbers. The victim keeps most of its tokens (10/13); the thief has **none** — the
two are maximally separated, not adjacent, and the asymmetry is structural, not a
threshold to tune.

*Also measured: R.10's own spec signal has a base rate its spec never checked.* "Every word
`needsReview`" fires on **16 of 649** segments (2.5%), and 14 of those are perfectly
ordinary short spoken lines — `150_listening_intent` ("You are not listening for a sound."),
`013_silent_prehistoric_night` ("The night goes quiet."), `042_eleven_years` ("You are
eleven."). FA's per-word confidence is near-zero across large parts of the corpus, so
"7/7 below `CONF_MIN`" is **not** diagnostic on its own. The spec calls this signal
"measured not assumed"; it was measured on the positives only.

***The discriminant.*** A segment is scripted-text-never-spoken when **all three** hold:

```
  (1) the Whisper alignment REFUSED it        alignResult.matched === false
  (2) FA had no acoustic support anywhere      max(word.confidence) < 5e-4
  (3) it is not a single-word segment          wordCount >= 2
```

*Performance over all 649 segments: fires on exactly 2 — `perilous_realms` and
`blue_monkey`. **2/2 true positives, 0 false positives.*** Every conjunct is load-bearing
and each alone over-fires:

| rule | fires | TP | FP |
|---|---|---|---|
| (1) alone | 8 | 2 | 6 |
| (2) alone | 10 | 2 | 8 |
| "all words `needsReview`" (R.10 as specified) | 16 | 2 | 14 |
| (1) ∧ "all words `needsReview`" | 3 | 2 | 1 |
| **(1) ∧ (2) ∧ (3)** | **2** | **2** | **0** |

*Separation margin.* Highest positive `maxWordConfidence` **1.725e-05** (`perilous_realms`);
lowest negative **1.465e-02** (spanish `001_scylla_intro`) — a **850×** gap with nothing
inside it. Against the segments that matter most — the 5 genuinely-spoken lines Whisper
missed and FA correctly recovered — the gap is **~58,000×** (they sit at 0.99–1.00). The
threshold `5e-4` is the **geometric midpoint** of the two nearest points (√(1.725e-05 ×
1.465e-02) = 5.03e-04), i.e. derived, not fitted — 30× clear on both sides.

*Conjunct (3) adjudicated, not assumed.* The only thing (3) removes is spanish
`001_scylla_intro` ("Scylla.", 1 word). It is **not** a never-spoken case: Whisper
transcribes `S`+`illa` at [0.12, 0.64] **and again** at [0.84, 1.21] — the word is spoken
twice, and `matched: false` is a subword-tokenization artifact (script "Scylla" vs a
Spanish narrator's pronunciation), while its 1.5e-02 confidence is FA correctly signalling
orthographic uncertainty. Either (2) or (3) excludes it; both are kept because they
exclude it for different and independently correct reasons.

*Behaviour at the adjacency:* `hostile_landscape` (victim) `matched: true`, does not fire.
Item 9 `matched: true`, does not fire. Both correct.

***R.10 RESPEC, to buildable depth.***
  - **Trigger.** Evaluated once per segment, on FA's output, after `alignScenestoTranscript`
    and after the FA word timings return — a drop/skip gate layered on FA's output, not a
    change to the alignment computation. Unchanged from the original spec on this point.
  - **Signal.** `alignResult.matched === false` **∧** `max(faWords.confidence) < R10_MAX_WORD_CONF`
    **∧** `faWords.length >= 2`. **`alignConfidence` is not used at all** — the original
    spec was right that it is text-match confidence and blind to this; R-Z was right to
    reopen the signal; the fix is to delete the conjunct, not re-threshold it.
  - **Threshold.** `R10_MAX_WORD_CONF = 5e-4`, derived above. **It is NOT `CONF_MIN`** —
    `CONF_MIN` (0.3) over-fires 16/649. Give it its own constant in `syncConstants.ts`;
    do not reuse `CONF_MIN`, and do not let the two drift into each other.
  - **Expected behaviour.** Treat the segment as unmatched and drop it (R.7's
    skip-and-flag), emit an `unspoken-script` sync-log finding naming the segment. Under
    Model P the dropped span is absorbed by the preceding segment exactly as R-E already
    rules for R.5's wildcard.
  - **Interaction with R.5 — they cannot both fire.** R.5 triggers on *audio with no
    script counterpart* (an unclaimed Whisper-token run); R.10 on a *segment with no audio
    counterpart* (`matched === false`). A segment cannot simultaneously have zero matched
    tokens and be the owner of a surplus token run. Measured: the R.5 candidate set and
    the R.10 firing set are **disjoint** on all three corpora. No arbitration rule needed;
    an assertion that they never both fire on the same segment is cheap and worth adding.
  - **Effect on the qi contract.** Dropping a segment removes its words from
    `normalizeSceneDoc`'s sequence, so `computeRunContext`'s offsets and `faChunkPlan.ts`'s
    indexing must be computed **after** the drop, not before — the same ordering
    requirement item 9's forced-split attribution bug (`616abb2`) already established.
    This is the single highest-risk part of building R.10 and is where session E's
    `assertQiMapConsistent` should bite first.

**(e) DIAGNOSIS B — item 7 root cause. It is NOT a word-seam-midpoint defect; that is the
symptom. R-V's reachability claim is too strong.**

*What was already known:* the boundary 449.20 is the midpoint of FA's own word seam ("one"
ends 449.18, "when" starts 449.22), no silence and no anchor participates. That says where
the number comes from.

*(a) The drift, traced across the whole region.* Ground truth (Whisper, unforced):

```
  You are not listening for a sound   [444.38 … 446.31]     -> seg 150
  You are listening for the absence of one [447.09 … 449.64] -> seg 151
  <<< 1.60s with NO transcribed speech at all >>>
  brush mice stop moving through dry leaves [451.24 … 453.03] -> seg 152
```

The script for segment 152 is *"**When the** brush mice stop moving through dry leaves"* —
and **Whisper never transcribed "When the"** anywhere in that hole. (It transcribes "When
the" perfectly 6 seconds later at 455.44 for `154_silent_night_birds`, so this is not a
systematic Whisper failure on those words.)

FA's placement of segment 152, with confidences:

```
  when[449.22-449.30] 1.5e-03   the[449.32-449.44] 3.0e-06   brush[449.52-449.82] 1.4e-05
  mice[449.86-449.96] 1.4e-06   stop[450.18-451.68] 5.2e-07   <-- 1.50s long, spans the silence
  moving[452.92-453.18] 1.0e+00 through 9.7e-01  dry 1.0e+00  leaves 1.0e+00
```

Five words crushed into the front at 1e-03…1e-07, then confidence snaps to 1.0 at
"moving". **The drift starts at segment 149 and recovers fully by segment 152's sixth
word** — bounded, non-compounding, exactly as R.8 Case 3 predicts.

*(b) The mechanism, established by evidence rather than assumed.* The R.1 anchor at
**451.70** (the end of detected silence [450.36, 451.70]) cuts the chunk plan **mid-segment**:
segment 152's 9 words are split 5/4 across chunks `[448.34, 451.70]` and `[451.70, 460.56]`.
The first window is handed "when the brush mice stop" — but the audio for those words
(`brush` 451.24, `mice` 451.32, `stop` 451.51 per Whisper) lies **at or beyond that window's
END**, and 1.34s of the window's 3.36s is detected silence. FA, required to place every
target token somewhere, crushes them into the only frames available. **Cause: a chunk
window whose attributed text does not fit its audio. The word-seam midpoint is what
`snapBoundaries.ts` correctly computes from that wrong input.**

Candidates eliminated: *text-side mismatch* — the script text is correct and normalizes
correctly; *genuine acoustic ambiguity* — refuted by confidence snapping to 1.0 within the
same segment; *Viterbi pathology* — the path is monotonic and recovers, so it is behaving
as designed on a bad window. *Chunk-window edge effect* — **confirmed, this is it.** An
R.5/R.6 wildcard covering the 1.60s hole would also relieve it, which is why the two rules
must be built in the order given in (g).

*(c) Siblings — a small CLASS, not a one-off.* Boundaries that are an FA word-seam
midpoint **and** back-to-back (seam gap ≤ 0.05s) **and** have no detected silence spanning
them: **10 of 646 internal boundaries.**

| corpus | tag | boundary |
|---|---|---|
| 173 | `blue_monkey` | 36.96 |
| v6 | `056_dropping_torch` | 167.03 |
| 173 | `rugged_landscape` | 228.48 |
| v6 | `087_throwing_spear_poise` | 259.47 |
| 173 | `ancient_guardian_mechanism` | 382.20 |
| **v6** | **`152_frozen_brush_mice` (item 7)** | **449.20** |
| v6 | `167_smell_of_butchery` | 494.43 |
| v6 | `231_slowing_pace` | 681.63 |
| v6 | `403_vigilant_embers` | 1273.14 |
| v6 | `406_listening_darkness` | 1289.74 |

For contrast, **39** boundaries are word-seam midpoints *with* a silence spanning them
(median seam gap 0.52s) — those are the rule working correctly. None of the other 9 is
ear-verified; they are candidates, not confirmed defects, and must not be added to the
register on this evidence alone.

*(d) Where the fix lands: `faChunkPlan.ts` (R.7's fit precheck / text attribution), with a
possible companion in `faAnchors.ts` (anchor admissibility). **Exit X1 does NOT fire.***
`snapBoundaries.ts` is **not** required: its spoken-edge-midpoint fallback
(`snapBoundaries.ts:336`) is behaving correctly given the inputs it receives — feed FA's
"when" its true ~451.1 onset and the same untouched code lands near the ear-correct 451.03.
The Hirschberg aligner is not implicated either.

*(e) Interaction with R-AA: confirmed neither causes nor masks it.* Item 7's end anchor
comes from silence [450.36, 451.70], which **swallows** three token seams — many, not zero
— so R-U/R-AA's zero-seam veto structurally cannot fire there, and item 7 is bit-identical
under both readings. **Warning for session F, measured so the R-U mistake is not repeated a
third time: the tempting symmetric fix — "veto a silence that swallows token seams" — is
catastrophically broad. 62.9% of v6 silences (344/547), 22.2% of 173 and 63.0% of spanish
swallow at least one whole Whisper token.** A blanket multi-seam veto is not the fix.

*Starting signal for session F, measured, offered as a starting point and explicitly not a
rule:* chunk "fit" = attributed script words ÷ Whisper token onsets inside the window.
Corpus median **1.00**, p90 **1.12**; item 7's chunk is **1.43**, ranking **10th of 381
chunks**. Real signal, top-3% outlier, but **not** self-sufficient — it must be combined
with the per-word confidence collapse. Session F measures that combination before ruling.

**(f) R.5 SPEC — brought to buildable depth, grounded in both real cases.**

*The two cases, measured (not previously written down at this resolution):*

| item | unscripted audio actually present in the WAV | span | consequence |
|---|---|---|---|
| 5 | *"Level two. The boy who carries fire."* | [125.54, 129.01] | FA put `042_eleven_years` ("You are eleven.") onto it at [125.96, 128.34]; boundary 128.43 vs ear 130.96 |
| 4 | *"Level 8. The one who teaches what cannot be taught easily."* | [925.14, 928.93] | FA put `307_forty_nine_years` ("You are forty-nine.") onto it at [927.28, 928.64]; boundary 928.67 vs ear 931.40 |

Both victim segments are in the 16 all-words-`needsReview` set — that is the *effect*, and
it is why the R.10 signal must not be keyed on it.

***Detection — how unscripted audio is recognised with no script counterpart.*** Not by
timestamps. **By unclaimed Whisper-token RUNS in the token index space**: tokens covered by
no matched segment's `[firstTokenIdx, lastTokenIdx]` span, grouped into maximal runs of
≥3 tokens. Measured recall: this surfaces **all 10** of v6's unscripted "Level N"
recitations — Level one/two/three/four/5/6/7/8/9/10 — matching Step K's independently
counted 10 headings exactly. **10/10 recall.**

*Precision needs a second term, and it was measured, not guessed.* Raw runs: 48 across the
three corpora (13 v6 / 22 173 / 13 spanish); most are subword-fragment noise from the
matcher ("Cat ac an" = Catachan, "bulk head ions press ur ize"). Exact-substring rejection
against the script is too weak (leaves 32). **Fuzzy containment against the flattened
script separates cleanly:** every one of the 10 true headings scores **0.58–0.60**, and
every false candidate scores **≥ 0.67** — no points between.

```
  unscripted-audio run  <=>  run length >= 3 tokens
                        AND  bestFuzzyContainment(run, script) < 0.65
```

**At 0.65: 10/10 recall, 0 false positives across all three corpora.** *Measured caveat,
stated because it is the part that must be re-derived:* the containment ratio above is a
Python `SequenceMatcher` **proxy**. Session D must re-derive the threshold against the
production `isFuzzyMatch`/`canonicalizeForAlignment`. What transfers is the **shape** —
headings sit well below the noise floor with a clear gap — not the literal 0.65.

***Behaviour.*** The run's span becomes a CTC wildcard between the two neighbouring
segments inside the R.0 run, absorbing that audio at zero alignment cost. Per **R-E**
(already ruled, 2026-08-11) the wildcard span is assigned to the **preceding** segment, so
Model P and Σ-duration are preserved unchanged; logged as an `unscripted-gap` sync-log
entry so it is inspectable rather than silent.

***Contract effects.*** `normalizeSceneDoc` word counts are **unchanged** (the wildcard adds
no script words); `computeRunContext` offsets are unchanged for the same reason;
`faChunkPlan.ts` gains a wildcard element in the chunk text that must **not** consume a qi
index — this is the qi-contract risk and where `assertQiMapConsistent` must bite.
**R.10 interaction:** disjoint by construction and measured disjoint (see (d)).
**R-AA interaction:** none — R.5 operates on unclaimed token runs; R-AA operates on
silence-vs-seam containment for anchor admissibility. Different inputs, different stage.

***Expected blast radius, with the method for measuring it before building.*** A.5's
already-run experiment for item 5 (adding a segment for the extra "Level Two…" audio)
produced **0/3874 differing FA word rows and 4/447 moved boundaries** — so the mechanism is
local. Method for session D, to be run *before* the build: insert wildcard spans at the 10
detected v6 runs into the chunk plan only, re-run `computeFaChunkPlan` offline, and diff
the plan row-for-row against the committed pins. Anything beyond the chunks adjacent to the
10 runs is unexpected and stops the build.

**(g) X2 — FLAGGED. R.10 and R.11 interact; sequencing needs the ruling below.** Two
measured couplings, both one-directional:
  1. `blue_monkey` (item 11, R.10) is **a member of item 7's 10-boundary sibling class**.
     Building R.10 drops that segment, so the class census changes from 10 to 9 **before
     session F measures it**.
  2. 173's worst chunk-fit outlier (ratio **2.14**, the highest of all 381 chunks) is the
     chunk containing `blue_monkey` — the same never-spoken text inflating the fit signal
     session F intends to use.

Neither changes item 7 itself; both change the *population* session F must measure against.
**Consequence: R.10 (session E) must land before R.11 (session F) measures its class.**
That is the order the spine already had, so no re-sequencing is required — but it is now a
dependency with a reason, not an accident, and session F must **re-run the sibling census
after E lands** rather than reusing the 10 above.

**(h) X3 — clear, with one qualification the owner should see.** Reconciliation found no
defect class missing from the register. But the 8 Whisper-unmatched segments include 6 that
are **not** defects — they are the segments FA correctly **recovers** (v6
`027_internal_change_face`, `028_small_permanent_flake`, `029_night_understanding`; 173
`shadow_loss`; spanish `001_scylla_intro`, `003_scylla_six_necks`), all at FA confidence
0.99–1.00. This ledger's §11 item 6 records that recovery as "3 V6 + 3 173 + **1** Spanish";
measured today it is **3 + 3 + 2**. The extra Spanish row is `003_scylla_six_necks`, and the
discrepancy is consistent with the post-`616abb2` fixture refresh. **Not a defect, not a
register entry — a stale count, corrected here.**

**(i) OV3 TRIAGE LIST — 5 rows, blinded, ~2 minutes. DO NOT open the key until scored.**
Three RC3 candidates plus two unmoved controls, mixed, uniform columns, one boundary value
per row, fixed ±4s window. Question per row: *is the boundary at the stated time correct?*

| # | window (copy-paste) | boundary |
|---|---|---|
| 1 | `173` @ **599.69 – 607.69** | **603.69** |
| 2 | `v6` @ **431.15 – 439.15** | **435.15** |
| 3 | `173` @ **12.50 – 20.50** | **16.50** |
| 4 | `v6` @ **666.24 – 674.24** | **670.24** |
| 5 | `173` @ **324.38 – 332.38** | **328.38** |

<details><summary><b>OV3 KEY — do not open until all 5 rows are scored</b></summary>

Row 1 = 173 `protection_failure` (RC3 candidate; in the 44). Row 2 = v6
`148_breathing_clan` (**control**, unmoved, not on any prior ear list). Row 3 = 173
`abysmal_opinion` (RC3 candidate; in the 44 **and** the 24). Row 4 = v6 `226_four_scouts`
(RC3 candidate; in the 44). Row 5 = 173 `celestial_behemoth` (**control**, unmoved).

Each RC3 row resolves to exactly one of: **correct as-is** → closed on the record;
**defective** → enters the register (raise `REGISTER_HIGH_WATER`, extend `REGISTER_ROSTER`,
add the row); **undecidable by ear** → closed with a named further step. A control scored
"wrong" invalidates the sitting.
</details>

**(j) THE PROGRAM — ordered path from here to Stage 1 lock.** Standing requirements for
**every** build session D–F, stated once and binding on all three: the FA replay gate will
go red; every changed row classified **EXPECTED or UNEXPECTED before re-pinning**; M1–M5
re-run after re-pinning with **M5 RED**; M4 reconfirmed a no-op **by chunk-plan equality,
not by colour**; the V6 seam 150/151 unmoved at **457.83** with chunk `[451.70, 460.56]`
bit-identical; item 6's positive assertion at **174.74** surviving; **golden replay 6/6**;
`scripts/fixtures/phase4-baseline-*.csv` byte-identical.

| session | builds | depends on | closes | gate behaviour | acceptance test |
|---|---|---|---|---|---|
| **D** ✅ **DONE 2026-08-17** | **R.5** unscripted-audio EXCISION (the wildcard is unreachable — see R.5's final spec) | Session C spec (f), whose 0.65 threshold did NOT survive re-derivation; replaced by the threshold-free `qiHole == 0` test | items **4, 5** ✅ + absorbed the OV3 triage | red at 8 boundaries, all v6; 173/spanish chunk plans bit-identical | ✅ items 4/5 converted at 931.40 / 130.96, residual 0.000s; blast radius 8/649, inside the envelope |
| **E** ✅ **DONE 2026-08-17** | **R.10** drop gate — shipped as a new pure service `faUnspokenGate.ts`, NOT `faChunkPlan.ts` (structurally impossible: the signal needs FA's per-word confidence, which the chunk planner runs before) | Session C respec (d), re-validated unchanged on the post-R.5 capture (2/2, 0 FP, 850×); the owner's `R10_MAX_WORD_CONF` directive; **R.5 landed** ✅ | items **10, 11** ✅ | red at 173's first two boundaries; segment count 175 → **173** (TWO drops — the pre-session "→ 174" was wrong) | ✅ item 10 converts at 0.00, residual 0.000s; item 11 converts to an ABSENCE assertion; R.5/R.10 measured disjoint, 0 overlap; blast radius 3/649 |
| **F** ← NEXT | **R.11** item-7 fix — owns **3** register entries, and is now the WHOLE register | Session C diagnosis (e) + Session D's two triage diagnoses; **E landed** ✅ so X2 is discharged — `blue_monkey` has left the corpus and the sibling census MUST be re-derived from the FIT signal, not the seam signature | item **7**, `ov3-abysmal-opinion`, `ov3-226-four-scouts` | red at 449.20 → 451.03, 16.50 → 17.88, 670.24 → 671.18 | all three convert; the re-derived sibling class each classified EXPECTED/UNEXPECTED |
| **G** ✅ **DONE 2026-08-17** | **PER-PROJECT FA toggle** (`Project.faHighPrecisionSync`, default ON — R-AK) + **fail-clean precheck** (`fa_dev.rs` size precheck + digest memo) — Session G was scoped "no code" and took code, because F6 was a design defect, not a documentation gap | D–F landed | **F6** ✅ (the blocker on the default flip); **R-N** ✅ decided | green at rest, RED under M5 (2) and M6 (6) | ✅ 5 of D-1's 9 automated for real (`d1RegressionChecklist.test.ts`); Contract 1→2 pass + fresh 12/12 ear list delivered as working documents |
| **H** | no code | **register EMPTY**; G's ear list drawn ✅ | — | green, `register is EMPTY` un-skipped | run `docs/ws1-sync-pipeline/stage1-lock-ear-list.md` — fresh blinded draw, single blinded tier (R-AB satisfied by construction) |
| **I** | FA default flip **already landed in G** — I is now Step T + runtime only | H passed; Step T + runtime resolved (**R-N resolved in G**) | — | green | Stage 1 LOCK |

*Session G's 9 checklist items — automatable now vs. needs a human:* the numeric/structural
ones (determinism, contiguity, coverage, qi consistency, chunk-plan equality) are
automatable today from committed fixtures; **Contract IN and Contract 1→2's
guarantee-by-guarantee verification is explicitly owner inspection** per the lock gate's own
wording and cannot be automated away. Session G must report the split rather than quietly
automating the human half.

*Still unresolved for session I beyond the register, all three re-opened by R-AD:*
**R-N** static-link vs `load-dynamic` packaging; **Step T** model download; and the
**~231s V6 runtime**, which R-S(iii) and R7 both leave open for the DEFAULT specifically
and which RC2 would have overridden silently.

---

**WS1 SESSION D (2026-08-17) — R.5 BUILT; the OV3 triage absorbed; the owner's Level-N
hypothesis pre-registered and REFUTED.** First BUILD session of the Zero-Defect Program.
Rulings: **R-AG** (triage outcome + register schema), R-AD/R-AE/R-AF ratified, R.5's final
spec as built, and the finding that both triage defects are **R.11** so **R.12 stays free**.

**(a) The OV3 triage, absorbed.** Identity mapping was re-verified against §11(i)'s collapsed
key BEFORE acting on it — all 5 rows match the owner's table, and both controls (row 2 v6
`148_breathing_clan`, row 5 173 `celestial_behemoth`) scored CORRECT, so the sitting stands.

| row | project | boundary | identity | verdict | disposition |
|---|---|---|---|---|---|
| 1 | 173 | 603.69 | `protection_failure` (candidate, in the 44) | **Correct** | closed on the record |
| 2 | v6 | 435.15 | `148_breathing_clan` (**control**) | Correct | control passed |
| 3 | 173 | 16.50 | `abysmal_opinion` (candidate, in the 44 **and** the 24) | **WRONG** | register, R.11 |
| 4 | v6 | 670.24 | `226_four_scouts` (candidate, in the 44) | **WRONG** | register, R.11 |
| 5 | 173 | 328.38 | `celestial_behemoth` (**control**) | Correct | control passed |

**CORROBORATION FINDING, recorded because it cuts against the natural suspicion:** a member of
the 44 known >0.5s FA-vs-Whisper movers was scored CORRECT by ear. **Membership in the 44 is
suspicion, not guilt** — the 44 is a set of disagreements between two imperfect sources, not a
defect list. This is direct corroborating evidence for R-AA's narrowing of 16 movers to 4: a
boundary R-AA declined to move turns out not to have needed moving.

**The register, before and after.**

| | open | roster | high-water | membership |
|---|---|---|---|---|
| before Session D | 5 | 7 | 5 | items 4, 5, 7, 10, 11 |
| after the triage absorbed | 7 | 9 | **7** | items 4, 5, 7, 10, 11 + `ov3-abysmal-opinion`, `ov3-226-four-scouts` |
| after R.5 landed | **5** | 9 | **5** | item 7 (R.11), item 10 (R.10), item 11 (R.10), `ov3-abysmal-opinion` (R.11), `ov3-226-four-scouts` (R.11) |

Schema extension: rows carry a stable string `id` and `origin: 'ear-12' | 'ov3-triage'`;
`REGISTER_ROSTER` holds ids rather than numbers; a test asserts an `ear-12` row has its item
number and an `ov3-triage` row has NOT acquired one. Exit **D5** did not fire — no other check
was weakened to accommodate the growth.

**(b) STEP 2 — the owner's Level-N hypothesis, PRE-REGISTERED and then REFUTED BY THE BUILD.**
The claim: v6 `226_four_scouts` @670.24 is wrong because a "Level N" heading precedes it, i.e.
it is an R.5 case rather than its own defect.

*Adjacency: TRUE, with one correction.* The "Level 6. The one they follow" recitation sits at
`[663.91, 666.48]`, 3.76s before the boundary — but it precedes `224_thirty_three`, **two**
segments earlier, not the immediately preceding `225_night_scouts`. The mechanism looked right:
FA had put "you are thirty-three" ON the heading at `[665.46, 667.20]` (confidences 1.0e-05,
3.6e-04, 2.5e-05) and the degradation ran forward through 225 and into 226's first three words,
recovering at "besides" (671.96, confidence 0.995).

*Prediction, written down BEFORE the build:* **671.18** — the Whisper-committed value, chosen
because items 4 and 5's ear-correct values are exactly their Whisper-committed values (931.40
and 130.96, verified in the fixture).

*Result: REFUTED. Predicted 671.18, actual 670.24, difference −0.94s — the boundary did not
move at all.* Not a partial result; a null one. R.5 fired on that exact recitation and excised
it. What the word timings show is why: R.5 re-seated "you"(224) and "you"(225), and **every word
from "are" onward is bit-identical**, because 670.24 is decided inside chunk `[669.40, 671.50]`,
which R.5 never touched. Adjacency to an unscripted run was a red herring, and building the
rule was the only thing that could have shown it.

**(c) STEP 3 — root cause of both triage defects: R.11. No new rule; R.12 stays free.** Full
write-up at the plan doc's "BOTH TRIAGE DEFECTS ARE R.11" block. Headline numbers:

| defect | chunk | script words | token onsets | fit | rank of 381 | direction |
|---|---|---|---|---|---|---|
| 173 `abysmal_opinion` @16.50 | `[16.64, 18.08]` "the numbers. They're" | 4 | 2 | **2.000** | **2** (top 0.5%) | text surplus |
| v6 `226_four_scouts` @670.24 | `[669.40, 671.50]` "night scouts now. Four of them" | 6 | 8 | **0.750** | 355 (bottom 7%) | audio surplus |
| v6 item 7 @449.20 (for scale) | `[448.34, 451.70]` | 10 | 7 | 1.429 | 11 (top 2.9%) | text surplus |

Both are item 7's root cause — *a chunk window whose attributed text does not fit its audio* —
and in both cases the ear-correct value is sitting in the data as the midpoint of a real
silence the pipeline passed over (17.88 from `[17.68, 18.08]`; 671.18 from `[670.86, 671.50]`).

*Eliminated by measurement:* NOT R.5 (173 has zero unscripted runs; `226_four_scouts` was
tested by building R.5 and watching it not move). NOT R.10 (`matched === true`, max word
confidence 1.0 / 0.999). NOT a new spurious-silence rule — the tempting "reject a silence
containing no real inter-token gap" veto covers **142 of 649** committed boundaries, including
item 6 @174.74 and item 9 @65.12, both ear-confirmed CORRECT and both CLOSED positive
assertions. Recorded so a later session does not rediscover it as an idea.

> **X3 QUALIFIED, not broken.** Session C's "no defect class is missing from the register" holds
> — the class was already there as R.11. What is wrong is Session C's *census method*: its
> 10-member sibling list was drawn on the SYMPTOM signature (word-seam midpoint + back-to-back
> seam + no spanning silence), and BOTH new entries fail that signature while being the class.
> **Session F must re-derive the census from the FIT signal, not the seam signature.**

**(d) STEP 4 — the R.5 detector, re-derived against production code. Session C's threshold does
not survive.**

| | Session C proxy (Python `SequenceMatcher`) | production matcher |
|---|---|---|
| 10 true recitations | 0.58 – 0.60 | **0.2500 – 0.6000** |
| 38 false candidates | ≥ 0.67 | **0.0000 – 0.4000** |
| separation | clean gap at 0.65 | **none — overlapping, and INVERTED** |

Both the number and the direction fail. `isFuzzyMatch`, the other production candidate, is
boolean and fires on 6/48 runs, none of them a recitation. **There is no production containment
threshold — a finding, not a tuning failure.** Session C's own caveat ("what transfers is the
shape, not the literal 0.65") turns out to have been too optimistic: the shape does not
transfer either.

*What does separate them, with no threshold at all:* `qiHole == 0` — zero UNMATCHED SCRIPT
words lying opposite the run. **10/10 recall, 0/38 false positives, over all three corpora.**
Every true positive is exactly 0; the nearest false positive is 1. A structural zero of the
same kind as R-U's zero-seam veto, not a tuned edge. The reasoning is mechanical: a false
candidate is a mis-tokenization of a word that IS in the script, so the script word it
fragments necessarily failed to match; genuinely unscripted audio has no script counterpart to
fail. 48 raw runs total (13 v6 / 22 173 / 13 spanish), reproducing Session C's count exactly.

*Mutual exclusion with R.10 (exit D4): CLEAR, 0 overlap.* Session C's R.10 discriminant
(`matched === false` ∧ `maxWordConfidence < 5e-4` ∧ `wordCount >= 2`) was re-run independently
and reproduces 2/2 true positives, 0 false positives over 649 — `perilous_realms` and
`blue_monkey`, both in 173. 173 has **zero** R.5 runs, so the two rules cannot co-fire on any
segment of any committed corpus.

*Production surface (exit D1): `faChunkPlan.ts` alone.* Not `faAnchors.ts` (sha256 unchanged,
and the gate's `anchorDigest`/`runDigest` prove it independently), not `snapBoundaries.ts`, not
`silenceDetector.ts`, not the Hirschberg aligner, not `faGate.ts`, not `fa/text.rs`.

*Predicted blast radius vs. actual.* Prior: A.5's item-5 experiment moved 4/447 with 0/3874
differing word rows. Predicted "the chunks adjacent to the 10 runs, and nothing else"; actual
**8/649 boundaries, all v6**, with 173 and spanish chunk plans **bit-identical**. Under the D2
trigger (an order of magnitude beyond 4) by a wide margin.

**(e) STEP 5/6 — the built rule, measured.** Real ONNX re-capture, not a reconstruction. Method,
in the order that makes it trustworthy: (1) a Node driver reproducing `App.tsx`'s FA branch end
to end minus the Rust leg was fed the PREVIOUS capture's own words and reproduced both committed
fixtures **byte-for-byte** (v6 447/447 rows, 173 175/175, zero diffs) — that is what licenses
reading its later output as measurement; (2) a scratch `#[ignore]`d harness appended to a
snapshot copy of `fa_onnx.rs` ran the real `align_chunked`; (3) a **determinism control** re-ran
three UNCHANGED chunks and reproduced the existing capture bit-identically before any new number
was read; (4) the harness was removed and `fa_onnx.rs` restored to its snapshot, sha256 verified.

*Which chunks needed fresh inference, and which did not:* HEAD's 264 chunks → R.5's 273. Exactly
**10 removed and 19 added**; **254 of 273 are unchanged**. The full 273-chunk plan was re-run
anyway (136.9s, 3874 words, zero CTC-infeasibility fallbacks), which doubles as an independent
check that the 254 unchanged chunks reproduce.

**(a) TOTAL MOVED: 8 / 649 boundaries (1.2%)** — v6 8/447, 173 0/175, spanish 0/27.

| project | idx | segment | old | new | Δ | Whisper |
|---|---|---|---|---|---|---|
| v6 | 41 | `042_eleven_years` | 125.76 | 127.17 | +1.41 | 127.17 |
| v6 | 42 | `043_night_migration` | 128.43 | **130.96** | +2.53 | 130.96 |
| v6 | 86 | `087_throwing_spear_poise` | 259.47 | 259.88 | +0.41 | 259.88 |
| v6 | 124 | `125_night_circle` | 370.75 | 372.35 | +1.60 | 372.35 |
| v6 | 175 | `176_twenty_six_scout` | 526.09 | 524.39 | −1.70 | 524.39 |
| v6 | 265 | `266_forty_one_burden` | 792.18 | 790.33 | −1.85 | 790.33 |
| v6 | 307 | `308_scouts_leading` | 928.67 | **931.40** | +2.73 | 931.40 |
| v6 | 339 | `340_fifty_eight` | 1045.62 | 1047.57 | +1.95 | 1047.57 |

**Every one of the 8 lands exactly on the Whisper-committed value.** That was not an input to
the rule — R.5 never reads a Whisper boundary — so it is independent corroboration that the
excision puts FA back on the audio the script actually describes.

**(b) magnitude buckets (v6):** `<0.1s` 0, `0.1–0.5s` 1, `0.5–1.0s` 0, `>1.0s` 7. Direction: 6
later, 2 earlier. 173 and spanish: all-zero buckets, nothing moved.

**(c) items 4 and 5 — BOTH RESOLVE, residual 0.000s.** Item 5 `043_night_migration`
128.43 → **130.96**; item 4 `308_scouts_leading` 928.67 → **931.40**. The confidence recovery is
the proof the fix is real rather than coincidental: "eleven" moves 127.96 → 129.99 and its
confidence goes **5.9e-07 → 1.0**. Both converted from KNOWN_BAD to positive assertions.

**(d) the Step 2 prediction — DID NOT LAND.** Predicted 671.18, actual 670.24, difference
−0.94s; the boundary did not move. See (b) above.

**(e) controls, all held.** Item 6 unmoved at 174.74 (positive assertion, third consecutive
re-pin survived); item 7 unmoved at 449.20; V6 seam 150/151 unmoved at 457.81 with chunk
`[451.70, 460.56]` bit-identical (exit S2 cleared a third time); 173's chunk `[161.46, 174.96]`
bit-identical; chunk fidelity v6 and 173 both reproduce their pinned structure.

**(f) the FA-recovered boundaries: 0 of 7 moved.** v6's three (`027_internal_change_face`,
`028_small_permanent_flake`, `029_night_understanding`) are bit-identical; 173's and spanish's
sit in corpora R.5 does not touch at all.

**(g) word-row diff: 88 / 3874 differ** (2.3%), all inside or adjacent to the 19 changed chunks.
A.5's much narrower experiment gave 0/3874; this is larger because R.5 re-cuts ten windows
rather than one, and it is reported as measured rather than compared away.

**(f2) gate re-pin.** Full row diff: **31 changed fields across 16 rows, every one classified
EXPECTED-PER-STEP-6, ZERO unexpected.** Rows exceed boundaries exactly as Model P requires — each
moved boundary rewrites the preceding segment's `duration`/`endTime`, so 8 boundaries produce 16
touched rows. Re-pinned: v6 `chunkCount` 264 → 273, `chunkDigest` → `d5dc8d7924dc8402`
(`anchorDigest`/`runDigest` **unchanged**, 173 and spanish unchanged on all three); NAMED_WINDOWS
v6 indices 76 → 79 and 77 → 80 with BOUNDS unmoved. Gate 19+1skip → **21 passing + 1 skipped**.

**M1–M5 re-run after re-pinning: M1 RED, M2 RED, M3 RED, M4 green, M5 RED.** M5 — the items-6/7
error class reproduced at a currently-correct boundary — is the one that matters and it is red
for the third consecutive re-pin. **M4 reconfirmed a TRUE no-op by chunk-plan equality across
all three corpora**, byte-comparing the serialized plans, not by the gate's colour.

**Verification: `npm test` 83 files / 2148 passed / 2 skipped** (floor 2139 + 7 new R.5 tests +
2 new positive assertions); `npm run lint` clean; `cargo check --features fa-inference` clean;
`cargo test --features fa-inference` **206 passed / 19 ignored**; **golden replay 6/6, unmodified**
(`phase4-baseline-*.csv` byte-identical — exit D3 canary clear); FA replay gate green at rest and
RED under M5.

---

**WS1 SESSION E (2026-08-17) — R.10 BUILT; items 10 and 11 CLOSED; the register is down to
3, all R.11.** Second BUILD session of the Zero-Defect Program. Ruling: **R-AH** (R.10 as
built, the behaviour decision, the R-Z reconciliation, and the gate defect R.10 exposed).

**(a) STEP 1 — the Session C discriminant RE-VALIDATED on the post-R.5 capture. It
survives, unchanged.** This was the session's real risk: `maxWordConfidence` reads FA output
directly, and R.5 had moved 88/3874 v6 word rows at fixture resolution and **224 word
confidences** at full precision. Re-run over all 649 boundaries against the post-R.5 capture:

| | Session C (pre-R.5) | Session E (post-R.5) |
|---|---|---|
| true positives | 2/2 | **2/2** (`perilous_realms`, `blue_monkey`, both 173) |
| false positives | 0/649 | **0/649** |
| margin | 850× | **850×** — 1.7248e-05 (`perilous_realms`) vs 1.4653e-02 (spanish `001_scylla_intro`) |
| vs. the genuine FA recoveries | ~58,000× | **5.76e+4×** |
| segments that CROSSED the discriminant | — | **0** |

*(b) What R.5 touched, precisely.* All eight `matched === false` segments have a
**bit-identical** `maxWordConfidence` before and after R.5 — including the three that live
in v6, which sit ~2000× above the threshold. The structural reason matters more than the
measurement: **conjunct (1) reads only Whisper tokens and script text, and R.5 changes
neither**, so the eligible population is invariant under R.5 by construction.

*Reconciling Session D's "88 / 3874".* That figure is the **2-decimal-place TIMING** diff,
which is the resolution the fixtures record. At full float precision 857 rows have moved
timing and **224 have a changed confidence** — the number that actually matters to R.10,
and none of them belongs to a segment near the threshold. Both figures are correct
measurements of different things; this is recorded so a later session does not read "88" as
"only 88 numbers changed".

*(c) Conjunct load-bearing, honestly reported.* Post-R.5, over 649: (1) alone fires **8**,
(2) alone **8** (9 pre-R.5), "every word `needsReview`" **15** (16 pre-R.5 — reproducing
Session C's figure exactly on the pre-R.5 capture), (1)∧needsReview **3**, **(1)∧(2) = 2**,
(1)∧(2)∧(3) = **2**. So **conjunct (3) is INERT on the committed corpora** — it removes
nothing (2) has not already removed. Session C said as much; this states plainly that it is
defence-in-depth, not a load-bearing term.

*(d) The `001_scylla_intro` near-miss holds, and is blocked twice over* — 1.4653e-02 is 29×
above the threshold, and it is a single-word segment. Both exclusions are asserted
independently in the tests.

*(e) R.5/R.10 disjointness on the post-R.5 capture: **0 overlap**. Exit E4 clear.* v6 has 10
R.5 runs and 0 R.10 fires; 173 has 0 R.5 runs and 2 R.10 fires; spanish neither.

**THE R-Z 0.769 / 0.778 PAIR — RESOLVED, AND R-Z WAS RIGHT. This ledger's own §11(d)
Session C entry is corrected.** Measured on the same segments against both token arrays:

| segment | vs WHISPER tokens | vs FA tokens |
|---|---|---|
| `hostile_landscape` | **0.7692** | **0.7692** |
| `perilous_realms` | 0.0000 (`matched:false`) | **0.7778** |
| `blue_monkey` | 0.0000 (`matched:false`) | **1.0000** |

All three R-Z figures reproduce exactly — against the **FA-token** alignment, which is the
right array for diagnosing an FA defect. Session C measured the **Whisper-token** alignment
and wrote them up as premise failures. Both were sound measurements of different quantities.
R-Z's substantive claim also survives: thief and victim are **0.0086 apart** on FA-token
`alignConfidence`, so a detector keyed on it genuinely cannot separate them, and deleting
the conjunct was right for the right reason. Session C's discriminant is unaffected.

**A PATTERN, NAMED BECAUSE THIS IS THE SECOND INSTANCE (third, counting one inside this
session).** (i) Session C's R.5 threshold 0.65, measured with a Python `SequenceMatcher`
proxy, inverted against production (Session D). (ii) The R-Z refutation above, measured
against a different token array. (iii) This session's own Step 5 harness fed the gate FA
words through a scratch helper that drops `confidence`; R.10 detected nothing, and the null
result was a harness artifact — caught in minutes only because the rule treats a missing
confidence as *unusable evidence* rather than as zero, which is itself an asserted test.
**The rule: a measurement only refutes another measurement if it was taken on the same
artifact — same token array, same normalizer, same segment array, same capture — and the
artifact must be named next to the number.**

**(f) STEP 2 — THE BEHAVIOUR DECISION: drop, by forcing `matched: false` and letting the
EXISTING skip path run.** Options weighed and the reasoning are in ruling **R-AH(d)**;
headline: this needed no new machinery, because `filterToCoveredSegments` →
`snapCoveredBoundaries` → `headExtendFirstSegment` is the same sequence every Whisper run
already exercises. Measured consequences, verified not asserted, across all three corpora:
**0 partition violations**, max `|end[i] − start[i+1]|` **1.14e-13**, first segment at
0.0000, last at `audioDuration`, Σ duration = `audioDuration` exactly. The preceding
survivor absorbs the span (`ancient_nature_thriving` 2.34 → 3.11, exactly `blue_monkey`'s
0.77s). **Exit E2 does not fire.** The qi contract is untouched — see §9's Session E entry.

*The locked-segment answer, which is a subset property rather than a mitigation.* Conjunct
(1) is `matched === false` under Whisper, so **R.10's firing set is a strict subset of what
the shipped default (FA gate OFF) already drops** — it cannot cost a user a lock the default
keeps. Independent, pre-existing corroboration:
`scripts/fixtures/phase4-baseline-173-skipped.csv`, committed long before this session,
lists exactly `perilous_realms` and `blue_monkey` at exactly indices 0 and 12.

**(g) STEP 3 — surface and constant. `faChunkPlan.ts` was the WRONG expectation** (the
session brief's, and it is structurally impossible: `computeFaChunkPlan` runs before
inference and has no per-word confidence). Final surface: **`src/services/faUnspokenGate.ts`
(new, pure)**, `syncConstants.ts` (`R10_MAX_WORD_CONF = 5e-4`, `R10_MIN_WORD_COUNT = 2`),
`App.tsx` (wiring + the new skip reason `'scripted text never spoken'`). The threshold is
the **geometric midpoint** √(1.7248e-05 × 1.4653e-02) = 5.0273e-04 rounded to one
significant figure — derived, not fitted, ~29× clear on both sides.

**(h) STEP 5 — the built rule, measured through the real production functions.** R.10 needs
**no new inference**: it never changes the chunk plan, and FA output is deterministic given
(audio, chunk plan), so the frozen capture IS the post-R.10 capture.

**(a) TOTAL CHANGED: 3 / 649 boundaries** — 2 dropped, 1 moved, all 173. v6 0/447, spanish
0/27, both bit-identical.

| project | idx | segment | old | new | Δ |
|---|---|---|---|---|---|
| 173 | 0 | `perilous_realms` | 0.00 | **DROPPED** | — |
| 173 | 1 | `hostile_landscape` | 1.36 | **0.00** | −1.36 |
| 173 | 12 | `blue_monkey` | 36.96 | **DROPPED** | — |

**(b) magnitude buckets:** 173 `>1.0s` 1, all others 0; v6 and spanish all-zero.
**(c) items 10 and 11 BOTH RESOLVE.** Item 10 `hostile_landscape` 1.36 → **0.00**, residual
**0.000s** (once the never-spoken title is refused, this becomes segment 0 and
`headExtendFirstSegment` stretches it back). Item 11 `blue_monkey` is **not committed at
all**, which was always its ear-correct outcome and why it never had a numeric target.
**(d) controls, all held:** item 6 174.74 (fourth consecutive re-pin survived); item 7
449.20; V6 seam 150/151 457.81 with chunk `[451.70, 460.56]` bit-identical (exit S2 cleared
a fourth time); items 4/5 at 931.40/130.96.
**(e) the three R.11 register entries UNCHANGED** — item 7 449.20, `abysmal_opinion` 16.50,
`226_four_scouts` 670.24. **Session F's scope does not change**, except that its X2
dependency is now discharged: `blue_monkey` has left the corpus, so the sibling census must
be re-derived after this commit — which it had to be anyway, from the FIT signal.
**(f) the FA-recovered boundaries: 0 of 6 moved** (all bit-identical; note this ledger's own
"3+3+1 → 3+3+2" correction, so six, not seven).
**(g) word-row diff: 0 / 3874 v6, 0 / 1660 173, 0 / 249 spanish** — no re-inference.
**(h) contiguity and no-gaps VERIFIED on all three corpora**, numbers in (f) above.

**(i) STEP 6 — gate re-pin, and ONE GATE DEFECT R.10 EXPOSED.** Full row diff: **6 changed
fields/rows, every one EXPECTED-PER-STEP-5, ZERO unexpected** (2 dropped rows;
`hostile_landscape` startTime+duration; `ancient_nature_thriving` duration+endTime — Model
P, the preceding segment absorbs the span). 173's remaining rows shift index by 1 or 2,
which is structural, not a value change.

*The defect.* The gate's `loadAnchorPathInputs` fed `computeFaChunkPlan` the
`-segments.csv` fixture, relying on it being the COMPLETE pre-skip parse — true only while FA
skipped nothing on every corpus. With 173 down to 173 committed rows it would have silently
fed a shorter array and flipped 173's chunk digest to `b24e4e63bae5f2b3` — **a false alarm
pointing at `faAnchors.ts` for a change two stages downstream of it.** Both readings were
measured before the fix was written. `-segments.csv` and `-skipped.csv` are now merged by
`segmentIndex` back into the real 447/175/27 parse (the same split the Whisper-side baseline
pair has always used), and the skipped fixture gained `startTime`/`duration` columns as
frozen inputs for that reconstruction. `src/services/faChunkPlan.test.ts`'s corpus loader
took the identical fix. **With the merge, all nine digests are bit-identical — which is the
proof that R.10 does not touch the chunk plan.**

*Re-pin.* `EXPECTED_SHAPE['173']` 175 → 173 committed, 0 → 2 skipped, plus new
`parsedSegmentCount` (447/175/27) and `skippedTags` fields — the latter pins R.10's FIRING
SET, not just its size. Items 10 and 11 CONVERTED from KNOWN_BAD to positive assertions;
item 11 is the register's **first ABSENCE assertion** (`earCorrect: null`, asserted in both
directions: gone from the timeline AND present in the skip fixture, so "dropped" can never
degrade into "lost from both files"). `REGISTER_HIGH_WATER` **5 → 3** — R.10 owned exactly
those two entries, and the 3 that remain are exactly R.11. Gate 21+1skip → **23 passing + 1
skipped**.

**M1–M5 re-run after re-pinning: M1 RED, M2 RED, M3 RED, M4 green, M5 RED.** M5 is red for
the **fourth** consecutive re-pin. **M4 reconfirmed a TRUE no-op by chunk-plan BYTE equality
across all three corpora**, using the same merged complete-parse reconstruction the gate now
uses. `faAnchors.ts` sha256 `b61e94cb…`, unmodified vs HEAD before and after the matrix.

**The register, before and after.**

| | open | roster | high-water | membership |
|---|---|---|---|---|
| before Session E | 5 | 9 | 5 | item 7, item 10, item 11, `ov3-abysmal-opinion`, `ov3-226-four-scouts` |
| after R.10 landed | **3** | 9 | **3** | item 7, `ov3-abysmal-opinion`, `ov3-226-four-scouts` — **all R.11** |

**Verification: `npm test` 84 files / 2173 passed / 2 skipped** (floor 2148 + 23 new R.10
tests + 2 new positive assertions); `npm run lint` clean; `cargo check --features
fa-inference` clean; `cargo test --features fa-inference` **206 passed / 19 ignored**;
**golden replay 6/6, unmodified** (`phase4-baseline-*.csv` byte-identical); FA replay gate
green at rest and RED under M5.

**Deferred / Known Bugs (WS1, non-Task-5):**
- `boundaryUsedFallback` calls `isBreathSilence` with 4 arguments instead of 5
  (`src/services/snapBoundaries.ts`) — the omitted 5th parameter silently defaults to
  disabling the seam exemption, so every `validateBoundaryQuality` reading on a
  seam-exempted pair has been wrong since it shipped. Diagnostic-only — never affects a
  committed boundary. Scheduled for Phase 7 (§11 item 19); self-resolves if Phase 6
  deletes the exemption first.
- 22 blank `boundary-quality-flag` rows in `scripts/fixtures/verification-baseline.csv` —
  deferred, non-blocking (R-A, §7).

---

**WS1 SESSION F (2026-08-17) — R.11 BUILT; the register reaches ZERO; F6 blocks the FA
default flip this session.** Third BUILD session of the Zero-Defect Program, and the one
that closes it. Ruling: **R-AI** (R.11 as built, its two-conjunct-plus-structural-test
detection, the false-positive it took two iterations to exclude, and the F6 finding).

**(a) STEP 1 — the sibling census, re-derived from the FIT signal over the CURRENT chunk
plan (390 chunks — 273 v6 + 112 173 + 5 spanish, not the stale "381" figure Session D's own
prose cited, which predates R.5's chunk-plan growth 264→273; both `chunkCount` fields in
this ledger's own ANCHOR_PATH tables have said 273/112/5 since Session D's own build,
so the 381 in prose was already inconsistent with the committed pins it sat next to).**
Attribution must be by SCRIPT-WORD INDEX, not time containment — FA's crushed output can
land outside its own chunk's nominal time window (measured directly: `abysmal_opinion`'s
committed 16.50 sits inside chunk 4's raw window, not chunk 5's, even though chunk 5's TEXT
is what produced it), which is the mechanism itself, not an artifact of the census method.
A structural (fit-deviation + chunk-edge-silence + FA-confidence-in-span) test, run over
all 649 boundaries, converges on exactly **4 candidates**: the three register members plus
one new, unverified sibling, v6 `192_scout_listening` (committed 570.18) — see (c) below.
**N = 4, not "wildly off" the old ~10-member symptom-based estimate in the direction Session
D's own X3 finding predicted (undercounted), though the specific old number does not survive
re-derivation either way** — the symptom census and the fit census are simply different
instruments.

**(b) STEP 2 — root cause, independently re-measured against the real captured FA word/
silence output (`.work-phase4/replay/*/fa_production_words.json`, `silences_app.json` —
gitignored, present on the machine that ran this session's measurements) for all three
register members. One mechanism, confirmed numerically, not cited from Session D's prose:**

| defect | chunk | fit | committed (wrong) | evidence | ear-correct = real silence midpoint |
|---|---|---|---|---|---|
| item 7 `152_frozen_brush_mice` | v6 [448.34, 451.70] | 10/7 = 1.4286 | 449.20 (FA word-seam midpoint, zero real gap) | span [449.20,451.03] max FA conf 1.490e-3 | **451.03** = mid([450.36, 451.70]) |
| `abysmal_opinion` | 173 [16.64, 18.08] | 3/2 = 1.5 | 16.50 (midpoint of the WRONG nearby silence [16.36,16.64]) | span [16.50,17.88] max FA conf 3.895e-3 | **17.88** = mid([17.68, 18.08]) |
| `226_four_scouts` | v6 [669.40, 671.50] | 6/8 = 0.75 | 670.24 (FA word-seam midpoint, zero real gap) | span [670.24,671.18] max FA conf 9.693e-4 | **671.18** = mid([670.86, 671.50]) |

In every case the real silence backing the correction is the SAME silence that already,
correctly, anchors the containing chunk's own edge (an untouched R.1 three-source-agreement
anchor — `faAnchors.ts`'s I6 invariant, "an agreed anchor's time is always a detected
silence's `endSec`") — the anchor path was never wrong; the defect is that the FINAL
per-segment boundary, computed downstream from FA's own crushed word timings inside a
badly-fit chunk, never consults it. Selection-order was already refuted for
`abysmal_opinion` at 0 flips (Session C measurement, unrepeated here) — not re-proposed.
**One mechanism for all three; F2 does not fire.**

**(c) THE FALSE POSITIVE THAT FORCED A THIRD CONJUNCT.** Fit-deviation alone (even gated at
the worst known case, `226_four_scouts`'s 1.3333) also fires on v6 `125_night_circle`,
proposing 372.35 → 373.70. Checked against the real capture: **372.35 is R.5's OWN
already-correct output**, sitting exactly on a real, SEPARATE silence's midpoint
(`[371.94, 372.76]`) — chunk-fit extremity elsewhere in the same chunk does not make this
specific boundary wrong. The fix, mirroring R.10's own evidentiary shape: require every FA
word inside `[min(committed,corrected), max(committed,corrected)]` to carry no real
acoustic support. `125_night_circle`'s span holds "are" at confidence 0.0301 — genuine
support, ~7.7x above the worst true positive's 0.0039 — while all three register members'
spans are uniformly near-zero. **`R11_MAX_SPAN_WORD_CONF = 1.0835e-2`**
(`syncConstants.ts`), the geometric midpoint of those two, ~2.8x clear on each side —
narrower than R.10's 850x margin, stated as such rather than dressed up.

**(d) STEP 3 — spec, surface, and the two derived constants.** Production surface:
**`src/services/faSeamFitGate.ts` (new, pure)**, `syncConstants.ts`
(`R11_MIN_FIT_DEVIATION = 1.3093`, `R11_MAX_SPAN_WORD_CONF = 1.0835e-2`,
`R11_MIN_CORRECTION_SEC = 0.05`), `App.tsx` wiring (post-`headExtendFirstSegment`, gated on
`faTokens` truthy — mirrors R.10's own gating). **NOT `faChunkPlan.ts`/`faAnchors.ts`**: both
are read (their real output — the chunk plan, the run provenance — is required detection
input) but detection is only meaningful once the COMMITTED boundary exists to compare
against a chunk edge's silence midpoint, which is FA's own inference OUTPUT, produced
downstream of both modules — the same "signal's availability point, not convenience"
finding R.10 established, re-derived independently rather than assumed to transfer.
`R11_MIN_FIT_DEVIATION` is the geometric midpoint of the worst known-bad chunk-fit deviation
(`226_four_scouts`, 4/3) and the nearest negative comparable (v6 `444_scout_past_watch`,
9/7) — **a real margin, but a narrow one**: 173 `architectural_pivot` (deviation 1.3077)
sits 0.0016 below the threshold and structurally resembles a candidate; R.11's own header
states plainly that this is suspicion, not the structural-zero R.5/R.10 achieved.
**Predicted and measured blast radius: 4/649** — 3 register members + 1 new unverified
(v6 `192_scout_listening`), matching the R.5 (8/649) / R.10 (3/649) order of magnitude, no
surprise growth. **Mutual exclusion, measured:** R.10 — 173 `hostile_landscape` (item 10's
own scope) structurally resembles a candidate at the detector level (its containing chunk is
contaminated by `perilous_realms`' own never-spoken title text) but becomes the FINAL
array's own segment 0 after R.10 drops `perilous_realms`, and `applySeamFitCorrections`
explicitly declines any correction at final-array index 0 (`headExtendFirstSegment` already
forces it to 0 regardless) — **0 real overlap**, verified by a dedicated test. R.5 — the
false positive in (c) above IS the measured overlap point; the third conjunct closes it,
**0 overlap after the fix**. R-U — unrelated signal spaces (R-U tests Whisper-token seam
zero-width; R.11 tests FA-crushed-span confidence), **0 overlap by construction**, not
separately measured. **Two adjacent R.11 corrections** compose left-to-right against a
mutable working copy (tested); **zero Whisper tokens across a span** is handled by conjunct
(3) declining for lack of usable evidence (never vacuously passing), matching R.10's own
"missing confidence is unusable evidence, never zero" rule exactly.

**(e) STEP 4 — build, tests first.** `src/services/faSeamFitGate.test.ts` (16 tests): the
derived-constant geometric-midpoint checks; all three register members firing at their
EXACT ear-correct value against real corpus fixtures + real FA-confidence literals; the
125_night_circle false-positive guard; the 192_scout_listening new-candidate case;
threshold-strictness sanity; the 001_scylla_intro near-miss (segment-0 exclusion, distinct
from R.10's own near-miss reasoning); Model P contiguity (gapless partition, adjacent
corrections compose, a dropped-upstream finding is silently skipped, a final-index-0 finding
is declined). **Two real bugs were caught and fixed by these tests, not found by inspection:**
(1) an edge-selection bug — testing a single-boundary chunk's boundary against BOTH its
start and end edges rather than only the one it is actually WORD-ALIGNED to (cumulative
script-word-offset test) produced a meaningless "corrected" value from an unrelated earlier
silence for item 7/`226_four_scouts`; (2) a Model P bug in `applySeamFitCorrections` —
adjusting only the predecessor's duration without also shrinking the corrected segment's OWN
duration by the same delta silently opened a gap/overlap at its OWN far boundary. Both fixed
in the same session before any fixture was touched.

**(f) STEP 5 — measured through the real production function** (`detectSeamFitDefects`,
imported not reimplemented) against the full real FA word captures, all three corpora:
**4/649 total**, v6 3 + 173 1 + spanish 0. All three register members land EXACTLY on their
ear-correct pins (451.03, 671.18, 17.88); the new candidate corrects 570.18 → 571.07. The
frozen `phase4-fa-second-baseline-{v6,173}-segments.csv` fixtures were regenerated via the
real `applySeamFitCorrections` (R.11 needs no new inference, same precedent as R.10 — it
never touches the chunk plan) — **only the 8 affected rows (6 v6 + 2 173) changed, byte-for-
byte identical elsewhere**, verified by diff against the pre-regeneration originals.
Controls held: item 6 174.74, V6 seam 150/151 457.81, items 4/5 (931.40/130.96), items 10/11
(0.00/dropped) — all re-asserted in a dedicated test block. Golden replay 6/6, unchanged.

**(g) STEP 6 — gate re-pin, register EMPTY.** `KNOWN_BAD` is now `[]`. Item 7,
`ov3-abysmal-opinion` and `ov3-226-four-scouts` converted to `CLOSED_BY_POSITIVE_ASSERTION`
at their exact ear-correct values. **`REGISTER_HIGH_WATER` 3 → 0.** The Stage-1-lock machine
check (`the Zero-Defect Register is EMPTY`) is **UN-SKIPPED and passing** for the first time.
v6 `192_scout_listening` is pinned as its own change detector (NOT a positive/correctness
assertion — it came from neither the 12-item ear pass nor an owner triage sitting, so
entering it as verified would misrepresent suspicion as guilt, the same distinction R-AG
drew for the 44-mover set) — flagged explicitly for Step 8's fresh ear list. **M1–M5 held
green at rest**; **M6 (R.11-specific: `R11_MIN_FIT_DEVIATION` raised above all three known-bad
deviations) verified RED** — 6 assertions fail across two independent files (the gate's own
ear-correct pins and the unit suite's own real-fixture detection tests), then reverted and
reconfirmed green. `npm test` **85 files / 2195 passed / 1 skipped** (the 1 skip is
`dragSessionHarness.test.ts`'s own pre-existing, unrelated skip — the register-empty skip is
GONE); `npm run lint` clean; `cargo check --features fa-inference` clean; `cargo test
--features fa-inference` **206 passed / 19 ignored, unchanged** (R.11 is TS-only — zero Rust
files touched, confirmed by an empty `git diff --stat src-tauri/`); golden replay 6/6.

**The register, before and after.**

| | open | roster | high-water | membership |
|---|---|---|---|---|
| before Session F | 3 | 9 | 3 | item 7, `ov3-abysmal-opinion`, `ov3-226-four-scouts` — all R.11 |
| after R.11 landed | **0** | 9 | **0** | — EMPTY |

**(h) STEP 7 — Stage 1 lock package. F6 FIRES: the FA default flip does NOT ship this
session.** `isFaToggleOn()` (`faGate.ts`) is a GLOBAL, per-machine `uiStateStore` key, not a
per-project field — `isFaGateOpen()` is read fresh on every single Apply Sync
(`cachedTokensReady`'s branch, `App.tsx:2875`), so flipping its stored-`undefined` default
from `false` to `true` would, on the VERY NEXT Apply Sync of ANY existing project, engage FA
for any user whose machine has both Tauri capability and a real `model.onnx` already placed
— a real, silent retime with no per-project or explicit-consent gate, regardless of whether
that user ever chose FA for that project. This is exactly the condition the session brief
names as F6. **The flip is not implemented this session.**

*Fail-clean measurements, real, not estimated* (this machine has real local models + a real
ORT dylib provisioned from a prior session — `~/Library/Application Support/com.kinetix.
pro-studio/fa-models/*/model.onnx`, `.work-phase4/spike-runtime/onnxruntime-osx-x86_64-*`):
- **Missing `ORT_DYLIB_PATH`:** near-instant — `fa_onnx.rs`'s `run_forward_pass` reads the
  env var as its own first line and returns before opening any file (existing test
  `missing_dylib_returns_ort_init_error`, part of the standard 206-test sweep at 0.16s total).
- **Absent model file:** **266.7µs** — `verify_model_manifest`'s `hash_file` fails at the
  file-open step; no hashing attempted (scratch-measured, real path, this session).
- **Corrupted model file, REAL SIZE** (a full-size ~1.26 GiB copy of the real `en` model
  with one byte flipped mid-file, not the existing unit test's 19-byte synthetic fixture,
  which says nothing about realistic cost since `hash_file` must stream whatever bytes ARE
  present): **77.43s in a DEBUG build** — the ONLY build `npm run tauri:dev`/`tauri:dev:fa`
  produces, and therefore the only mode FA can currently run in at all (Step T/release
  packaging remains unresolved) — versus **5.25s in a RELEASE build**. **This is a real,
  previously unmeasured cost**: every FA call, model-corrupted or not, pays `verify_model_
  manifest`'s full-file SHA-256 EVERY invocation (no caching), so a genuinely healthy debug-
  build FA run pays roughly this same ~5-8s-per-language tax (release-mode-equivalent; the
  corrupted case's 77s is DEBUG-specific and would apply identically to a healthy model too)
  on top of the already-documented ~231s v6 / ~76s 173 inference wall-clock — non-trivial for
  173 specifically (~7-10% overhead) if measured in debug mode, negligible in release.
  **Runtime restated (not re-measured this session — citing the existing measured figures):**
  ~231s v6, ~76s 173, both smoke-tested 2026-08-15 (§11 item 1's own entry above).
- **Detection cost of the model-presence check:** the same `hash_file` call above IS the
  presence+integrity check (a file that doesn't exist fails in µs before hashing; a file
  that exists but doesn't match the manifest pays the full hash regardless of size) — so
  "detection cost" and "corrupted-model cost" are the same measurement.

Since F6 fires, the flip's own tests (model-present, model-absent, explicit-on,
explicit-off) are not built this session — building tests for a change that does not ship
would be dead code exercising a decision not taken.

**Deferred / Known items (WS1 Session F):**
- v6 `192_scout_listening` — a real, structurally well-evidenced, UNVERIFIED R.11 candidate
  (committed 570.18 → 571.07 in the regenerated fixture, pinned as a change detector, not a
  correctness claim). Owes an owner ear pass before it can be treated as confirmed — folded
  into Step 8's fresh ear list below, not the Zero-Defect Register (it has neither an
  ear-pass item number nor a triage-sitting origin).
- The per-machine (not per-project) shape of `isFaToggleOn()` is itself worth a design
  decision before any future default-flip attempt: a per-project field (stored in
  `Project.faHighPrecisionSyncEnabled` or similar) would let a flip apply only to NEWLY
  synced projects without silently reaching backward into existing ones. Not designed or
  built this session — flagged as the actual blocker a future flip session needs to clear.

---

**WS1 SESSION G (2026-08-17) — F6 RESOLVED; the FA default flip SHIPS as a per-project
toggle; fail-clean brought under budget; R-N decided; 5 of D-1's 9 automated.** Ruling:
**R-AK** (per-project toggle, default ON) and **R-AL** (R-N: load-dynamic + bundled dylib).
Session G was boarded as "no code" — it took code, because F6 turned out to be a design
defect in the gate's SHAPE, not a documentation gap, and the owner's ruling resolved it.

**(a) STEP 1 — the register's last unverified row is SCORED. G2 does NOT fire.** The ear
artifact for v6 `192_scout_listening` (570.18 → 571.07) was produced through the production
detector `detectSeamFitDefects`, imported not reimplemented, over the PRE-correction arrays
(`git show 3faf0ea:…-segments.csv`) with the real FA word capture — the three closed defects
rendered in the identical shape as blind controls, plus the known false positive
(`125_night_circle`) as a NEGATIVE control. **The discriminator, measured:** the committed
570.18 is the exact midpoint of the FA word seam "still"(ends 570.14) → "you"(starts 570.22),
a **0.080 s non-silence** — the same signature as the two ear-verified word-seam members
(item 7: 0.040 s; `226_four_scouts`: 0.160 s), and its gap sits BETWEEN theirs. No real
detected silence contains it. Its span confidence is **4.0732e-5 — 266× below
`R11_MAX_SPAN_WORD_CONF`, the widest margin of all four findings** (item 7 7.3×,
`226_four_scouts` 11.2×, `abysmal_opinion` 2.8×) and **740× below the known FP's 3.0145e-2**.
Corroboration that needs no ears: the segment's text is "You listen.", and the only
acoustically-confident words in the ±2 s window are "stop" (0.994) and **"listen" (0.989 at
571.52)** — the corrected 571.07 sits in the silence immediately before "listen", while the
committed 570.18 would start it **1.34 s before the word is acoustically present**.
**Verdict: true positive on every measurable structural axis; the register's empty state
survives.** Stated limitation: this is STRUCTURAL confirmation, not auditory — the row stays
a change detector, not a positive assertion, and is row 2 of the Step 6 ear list. Full
artifact: `docs/ws1-sync-pipeline/stage1-lock-ear-list.md` §4.

**(b) STEP 2 — the inferred premise re-measured, and it MOVED AGAIN: the FA-recovery set is
5, not 6 and not 7.** Re-derived at HEAD from the frozen production outputs of both paths
(Whisper `phase4-baseline-*-{segments,skipped}.csv` vs FA `phase4-fa-second-baseline-*`),
across four commits:

| commit | recovery set | membership |
|---|---|---|
| 40a12cf (pre-R.5) | 7 | v6 ×3, 173 ×3, spanish ×1 |
| a0ff7c0 (post-R.5) | 7 | unchanged |
| 3faf0ea (post-R.10) | **5** | 173 loses `perilous_realms` + `blue_monkey` |
| f7fb9d0 (post-R.11) | **5** | unchanged |

Membership at HEAD: v6 `027_internal_change_face` (78.56), `028_small_permanent_flake`
(80.74), `029_night_understanding` (83.53); 173 `shadow_loss` (443.57); spanish
`001_scylla_intro` (0.00). **R.5 moved none and changed no membership. R.10 changed
MEMBERSHIP by −2 — tied to the production function that caused it:
`detectUnspokenScriptSegmentsFromWhisper` fires on exactly `perilous_realms`
(conf 1.7248e-5) and `blue_monkey` (6.4257e-6) over the pre-R.10 173 array, and 0/447 on v6.
R.11 moved none. 0 of the 5 survivors has moved in value across all four commits** —
startTime AND endTime bit-identical throughout. **CORRECTION: this ledger's own Session E
entry (f)'s "0 of 6 moved … so six, not seven" is WRONG; the correct figure is 5, because
R.10 dropped TWO recovery-set members, not one.**

**(c) STEP 3 — F6 RESOLVED. The toggle is now PER-PROJECT and defaults ON (R-AK).** Owner
ruling: *"keep toggle default ON for all projects. in case i wanna turn it off, i'll go to
specific project settings and turn it off myself."* Built:
`Project.faHighPrecisionSync?: boolean` (`types.ts`), `isFaEnabledForProject` /
`isFaGateOpenForProject` / `shouldPersistFaChoice` / `FA_PROJECT_DEFAULT_ON` (`faGate.ts`,
replacing the retired global `isFaToggleOn`/`setFaToggle`), `App.tsx`'s Apply-Sync branch
reading `projectRef.current`, and `ProjectSettingsModal` editing the project field.

The four required answers:
- *Where it persists:* inline on `Project`, through `projectStore.ts`'s existing
  serialization. No schema change, no migration, no new storage mechanism.
- *An existing project with no key on load:* resolves to **ON at READ time** and is **never
  written back**. Loading is not a retime and does not create a preference.
- *Apply Sync on a Whisper-synced project:* FA engages and re-times it — the owner's
  explicit ruling. Two conditions still gate it independently: the runtime must be
  Tauri-capable, and `Project.language` must be one of the 5 FA-supported codes, so a
  project that never set a language never engages FA regardless of this field.
- *Can an explicit choice be silently overwritten:* **No.** The only writer is Project
  Settings' Save, and only when the control actually moved (`shouldPersistFaChoice`).
  Every other function in `faGate.ts` is pure.

**G1 does not fire, proved rather than argued** (`faGate.test.ts`, 27 tests): a pre-change
project fixture loads with every `startTime`/`duration` byte-identical, does not acquire
`faHighPrecisionSync`, still lacks it after the gate is read, and still lacks it after a
save/load round-trip; an explicit `false` round-trips and is never repaired towards the
default. Tests cover model-present/model-absent (the gate is model-INDEPENDENT by
construction — model presence is `runForcedAlignmentForSync`'s fail-clean concern),
explicit-on, explicit-off, and the migration path.

**The migration finding that simplified the design, measured not assumed:** the retired
global key carried **no recoverable intent**, because the pre-change `handleSave` wrote
`setFaToggle(draftFaEnabled)` UNCONDITIONALLY on every Settings save. A stored `false` is
therefore indistinguishable from "this user once changed their resolution tier", while the
only unambiguous value (`true`) agrees with the new default anyway. Consulting it would let
an incidental Save silently veto the owner's chosen default, so it is **not consulted, and
not deleted** (`LEGACY_GLOBAL_FA_TOGGLE_KEY`).

**(d) STEP 4 — fail-clean budget SET and MET; the healthy-path tax is the real finding.**
Budget stated in three tiers; precheck = manifest **`byteSize`** size check (already
recorded per language — exact, not a heuristic) + an in-process digest memo keyed on
(path, size, mtime), the same identity technique `fa.rs::source_identity_key` already uses.
The memo caches the **digest, never the verdict**, so the manifest comparison still runs
every call and a cache hit can never accept a mismatched model. Measured through the real
production `verify_model_manifest` against the real 1.26 GiB `en` model:

| case | DEBUG before | DEBUG after | RELEASE before | RELEASE after | tier / budget |
|---|---|---|---|---|---|
| absent model | 266.7 µs | **0.201 ms** | — | **0.078 ms** | A, <50 ms ✅ |
| corrupt: truncated / wrong size | full hash of whatever is present | **0.265 ms** | — | **0.092 ms** | A, <50 ms ✅ |
| corrupt: same-size byte flip, 1st | 77.43 s | 77.98 s | 5.25 s | 5.06 s | B, one hash by design — NOT accelerated, and not claimed to be |
| corrupt: same-size byte flip, repeat | 77.43 s **every call** | **0.236 ms** | 5.25 s **every call** | **0.077 ms** | B, <50 ms ✅ |
| healthy model, 1st | ~77 s (inferred) | **76.51 s (MEASURED)** | ~5.25 s | **4.99 s** | C, once per process ✅ |
| healthy model, repeat | ~77 s **every call** | **0.254 ms** | ~5.25 s **every call** | **0.099 ms** | C, <50 ms ✅ |

**Session F's inference that a HEALTHY model pays the same tax is now MEASURED, not
inferred: 76.51 s debug / 4.99 s release, per Apply Sync, every time.** That per-call tax is
what the memo removes; it was the larger defect, and it was invisible because the only
previously-measured case was a corrupt one. Verification of the good case is not weakened —
a healthy model is still hashed in full and compared in full, once per file identity per
process, and the memo is never persisted so every app start re-verifies. **Known limitation,
stated:** a replacement preserving both size and mtime is not detected within a process.

**(e) STEP 4b — R-N DECIDED (R-AL): stay `load-dynamic` + bundle the onnxruntime dylib as a
Tauri resource.** The measurements are what decide it, and they decide it by **neutralising
the criterion the decision was waiting on**: fail-clean behaviour no longer discriminates
between the options. Missing `ORT_DYLIB_PATH` already fails in µs with a typed `OrtInit`
error (load-dynamic's only extra failure mode, and it is cheap and clean); the expensive
path was model verification, which is now bounded and is **identical under both options**
because it concerns the model file, not onnxruntime. With that tie broken elsewhere:
(1) FA's actual bulk — a 1.26 GiB per-language model — is downloaded on demand (Step T), so
statically linking the runtime forces every user to carry inference machinery for a feature
whose payload they may never fetch; (2) load-dynamic is the status quo, and the entire
existing test-skip convention (`ORT_DYLIB_PATH`, `ort_dylib_or_skip`, the 19 ignored tests)
is built on it — static-linking invalidates that convention wholesale; (3) a bundled dylib
is an ordinary Tauri resource covered by the app bundle's signature, whereas static-linking
`ort =2.0.0-rc.13` with `default-features = false` means enabling its
download/compile-onnxruntime machinery, a materially larger and less reversible change.
**Remaining work this decision creates** (release-build phase, R-K — not Stage 1): ship and
sign the dylib as a resource, and set `ORT_DYLIB_PATH` at runtime to that resource path.
Today it is unset, which is exactly why FA fails clean in dev. **Reversible until a release
build is cut.** Recorded as a measured recommendation taken under delegation, not an owner
sitting.

**(f) STEP 5 — D-1: FIVE of nine automated FOR REAL, four stated honestly.**
`src/services/d1RegressionChecklist.test.ts`, 23 tests. Built for real, through production
functions against real corpus fixtures: **item 1 locks** (a locked segment survives
`applyAnchorBasedTiming` with deliberately disturbed neighbours; a companion test proves an
unlocked neighbour DOES move, so the item cannot pass vacuously), **item 2
skipped-segment-adjacent boundaries** (real 173 skip sites, gapless partition across every
one), **item 3 headings** (`clampHeadingsToDuration` keeps absolute times; a shrinking
re-sync clamps and flags `needsReview` rather than dropping), **item 6 empty-token
fallback**, **item 7 persistence/reload** (save→load bit-identical timeline,
`lastTranscribedFileIdentity` intact, and `getFileIdentity` re-derived from a reloaded file
MATCHES it — so no re-transcription triggers — with a negative case proving the check
discriminates).

*The remaining four, stated as they actually are (and asserted as executable documentation
in the same file, so the split rots loudly):* **item 4 no-voiceover** — WEAK PROXY; half of
it is untestable because the thing it names does not exist (`grep "estimated timeline"
src/` → 0 hits). **item 5 silence-scan failure** — WEAK PROXY; the error SHAPE is a tested
discriminated union, but the fallback lives in `useWhisper.ts`, a hook, inside CLAUDE.md
§6's accepted manual-verification gap. **item 8 export/preview consumers** — WEAK PROXY;
shape invariants are covered, "reads correctly" is a render claim needing the running app.
**item 9 DEV harnesses — NO PROXY AT ALL**; the globals are attached by DEV-gated App.tsx
effects and nothing short of mounting App exercises them.

*A real finding fell out of building item 6:* **`applyAnchorBasedTiming` is NOT a standalone
retile.** Handed segments with no `anchorStart` at all it resolves every anchor to 0 and
collapses the array onto the 0.1 s duration floor. Production never reaches it in that state
because `parseProjectData`'s character-weight bootstrap runs first — so the bootstrap is
load-bearing, not decorative. Pinned as its own regression guard, and the reason item 4's
proxy is weak rather than absent.

**(g) STEP 6 — two working dossiers, committed as documents.**
`docs/ws1-sync-pipeline/stage1-lock-ear-list.md` (fresh 12/12, 7 MOVED / 5 UNMOVED,
v6 9 / 173 2 / spanish 1, uniform **4.00 s** windows) and
`docs/ws1-sync-pipeline/stage1-lock-contract-1to2.md` (the twelve-row pass, **5 DIRECT /
4 PARTIAL / 3 ABSENT**, every row re-grepped live rather than transcribed from `0d8420f`).
**Blinding is preserved by construction, not by instruction:** max |Δ| in the set is
**1.95 s < 2 s**, so a ±2 s window centred on the proposed value always contains the old
value too — which means every row can carry an IDENTICAL 4.00 s window and the owner hears
both candidates without learning which rows moved. A varying window length is what leaked
the arm in earlier draws. Row order is `sha256(tag)` ascending; the arm key is sealed in §3.
Control draw excludes duration-only movers, ±2-index mover neighbours (this is what removed
`151_scout_listening_void`, which sits immediately before item 7), Session C's tags, and
anything within 5 s of a previously scored value (which removed `156_scout_deep_realization`
at 459.87, too close to the scored 457.83 seam). R-T's non-English risk carried verbatim at
the head of the ear list. **One severity escalation recorded in the Contract pass:**
`validate1to2` (wrapping P2/P3) is invoked only from `useWhisper.ts:290` and never from the
commit path — true before FA, but with the gate now defaulting ON, **the unvalidated array
is the DEFAULT array**. Exposure changed, not the contract.

**(h) STEP 7 — verification.** `npm test` **86 files / 2234 passed / 1 skipped** (the 1 skip
is `dragSessionHarness.test.ts`'s pre-existing unrelated skip); `npm run lint` clean;
`cargo check --features fa-inference` clean; `cargo test --features fa-inference`
**209 passed / 20 ignored** (was 206/19 — +3 fail-clean tests, +1 env-gated `#[ignore]`
benchmark); **golden replay 6/6**, `scripts/fixtures/phase4-baseline-*.csv` byte-identical;
FA replay gate **29/29, 0 skipped**. `faAnchors.ts` sha256 **b61e94cb…** unchanged at rest
(verified after the M5 mutation was reverted). **M5 verified RED (2 tests)** then reverted
and reconfirmed green; **M6 verified RED (6 assertions across 2 independent files)** then
reverted and reconfirmed green.

**Deferred / Known items (WS1 Session G):**
- `192_scout_listening` remains a CHANGE DETECTOR, not a positive correctness assertion,
  until row 2 of the ear list is scored. Structural confirmation is not auditory
  confirmation.
- **R-N's implementation** (bundle + sign the dylib, set `ORT_DYLIB_PATH` at runtime) is
  release-build-phase work created by this session's decision, not done in it.
- The **~231 s v6 / ~76 s 173 FA runtime** is untouched and still open for the DEFAULT
  specifically (R-S(iii), R7) — the memo removes the verification tax, not the inference
  cost.
- D-1 items 4, 5, 8, 9 remain unautomated; item 9 has no proxy at all.
- Contract 1→2 **A4** and Contract IN **A3** still lack written acceptance; **P6** is the
  one row this pass cannot schedule away, because the pass IS its enforcement.

**WS1 SESSION H — R.12, THE ATOMIC-RUN INVARIANT (2026-08-18).** Full detail; the Changelog
entry above is the summary. Standing constraints held throughout: `faAnchors.ts` sha256
`b61e94cb…` unchanged; no edits to `snapBoundaries.ts`, `silenceDetector.ts`, the Hirschberg
aligner, `project-state.md`, `docs/history.md`, or `scripts/fixtures/phase4-baseline-*.csv`
(golden replay byte-identical 6/6 throughout); `DOCUMENTATION_AUDIT_REPORT.md` stays
untracked; no new repo-root files.

- **The spec (Step 4), proven not assumed.** No fitted threshold: a committed boundary either
  lies strictly inside an unscripted run (`computeUnscriptedRuns`) or it does not. Surface
  measured before building: blast radius exactly **9/649**; R0 (corpus-start run) structurally
  excluded (no preceding token — the interval `[prevToken.endSec, run.startSec]` does not
  exist); no adjacent-run collision possible (measured minimum inter-run gap 115.79s on v6,
  the only corpus with runs); no proposed value lands inside any run (H7); the smallest
  Model P absorption leaves 1.235s of predecessor duration (H8's non-positive-duration exit
  never approached). Mutual-exclusion matrix built BEFORE the build, all four rows measured:
  R.5 (chunk-plan byte equality under re-feed), R.10 (disjoint corpora), R.11 (disjoint
  firing sets, conjunct 3 keeping R.11 off 372.35 — H6 closed by construction), R-U/R-AA
  (173-only, no runs).
- **RED before GREEN.** `src/services/faRunPlacementGate.test.ts` written and run against a
  nonexistent module first (`Cannot find module './faRunPlacementGate'`), THEN
  `faRunPlacementGate.ts` was written. 32 tests: 9 corpus rows named individually, the R1
  fallback, a healthy adjacent boundary that must not move, R0 exclusion, adjacent-run
  independence, mutual exclusion against R.5/R.10/R.11/R-U, Model P contiguity through the
  real `applyRunPlacementCorrections` partition path, and H7 as a permanent assertion (not a
  one-off check) that no corrected value lands inside any run.
- **Step 6 measurements, through production, in full.** `detectRunPlacementDefects` +
  `applyRunPlacementCorrections` (the exact pair `App.tsx` calls) run against the real
  fixtures: 9 corrections on v6, 0 on 173/spanish. All nine land EXACTLY on their measured
  values (bit-for-bit, not merely `toBeCloseTo`): 125.54, 250.69, 370.75, 521.71, 663.785,
  788.65, 924.92, 1044.67, 1188.95 (`224_thirty_three`'s own value is not a round 2dp number —
  the clamp's own signature). Direction: all nine earlier, max |Δ| 2.90s (`340_fifty_eight`),
  min |Δ| 0.545s (`224_thirty_three`). Controls verified unmoved on the CORRECTED arrays: the
  seven ear-verified-correct rows (173 507.01, v6 571.07/466.09/969.30/259.88, 173 256.33,
  spanish 44.90), item 6 (174.74), item 7 (451.03), V6 seam 150/151 (committed 457.83 /
  FA 457.81, distinct quantities, both pinned), items 4/5 (931.40/130.96), items 10/11
  (0.00/absent). Model P verified through the real partition, not asserted: worst gap
  2.27e-13s (float noise), Σduration conserved to 1e-6, last segment end matches
  `audioDuration` exactly, on all three corpora. Chunk-plan digests bit-identical before/after
  on all three corpora (`d5dc8d7924dc8402`/`b4c4611508f7b58e`/`c7e4be33cf7ab3c7`), proving R.12
  cannot be a false alarm against `faAnchors.ts`/`faChunkPlan.ts` the same way the Session A.5
  anchor-path replay proves it for every other rule. 173 (173 rows) and spanish (27 rows)
  fixtures untouched, byte-identical.
- **The R-E amendment.** Ruling R-E ("Model P outranks R.5," `sync-pipeline-v2-plan.md`)
  assigned the excised run's seconds to the PRECEDING segment. Owner ruling 3 REVERSES this
  for the COMMITTED BOUNDARY specifically: the run belongs to the FOLLOWING segment, matching
  what the ear scored correct on all twelve Session H rows. Recorded as an amendment, not a
  silent contradiction, at R-E's own site (`sync-pipeline-v2-plan.md`'s R.5 destination
  entries — see that file's own Session H addendum) and at each of the three code citations
  (`faChunkPlan.ts:211`'s R.5 header, `faRunPlacementGate.ts`'s own header, and this ledger's
  §3/§7 R-E citations). R-E's ORIGINAL scope — where R.5 excises the run from the CHUNK
  PLAN, before inference — is UNCHANGED and correct; the amendment is narrow, about where the
  COMMITTED boundary lands after the fact, not about chunk-plan excision.
- **The register, reopened and closed.** `REGISTER_HIGH_WATER` 0 → 9 → 0 in one commit — the
  same RAISE-then-LOWER pattern Session D used, and for the identical reason: growth cost a
  deliberate edit, **ten** roster appends (R.12's nine, plus `h-192-scout-listening`
  closed-on-arrival — corrected from "nine" 2026-08-18, WS1 Session J), nine `KNOWN_BAD`
  entries (closed in the same commit
  by R.12 landing), and this ledger's own table. Verification split explicitly: five rows
  ear-scored wrong by Session H's 12-row pass (042, 125, 176, 266, 340); four structurally
  derived, no ear pass (085, 224, 307, 383) — marked `verification: 'structural'` in the
  fixture, never dressed up as ear-verified. `192_scout_listening` promoted from an
  unverified change-detector pin to a positive assertion at 571.07 — G2 closes.
- **FA default reversion.** `FA_PROJECT_DEFAULT_ON` `true → false`, value-only — see the
  Changelog entry above for the full accounting and the exact flip-back condition, which now
  also lives in `faGate.ts`'s own doc comment as the durable source.
- **The fresh blind 12, drawn and sealed, not scored.** Window ≥ 5.80s (2× the measured max
  |Δ| 2.90s, so no arm can leak by proximity to a known mover). Stratified: an unmoved-control
  arm, drawn clear of every previously scored region (all twelve prior rows) and of
  mover-adjacent boundaries (the ±2-index exclusion Session C's own draw used). At least two
  of the four structurally-derived rows (085/224/307/383) included, so they get ear-verified
  on the next pass. Sealed key — not scored this session, input to the next pass only.
- **Register state, before and after.** Before: EMPTY (Session F's zero). After: EMPTY again,
  with **ten** more roster members and **ten** more closed entries than before — **19 roster
  members total**, all accounted for. *(Corrected 2026-08-18, WS1 Session J: this line
  originally read "nine more … 20 roster members total". Both halves were wrong in the same
  direction. Session H appended TEN roster members — R.12's nine plus `h-192-scout-listening`,
  which entered closed-on-arrival — onto a pre-existing nine, giving **19**, which is what
  `REGISTER_ROSTER` and `CLOSED_BY_POSITIVE_ASSERTION` have both actually held since that
  commit. Session I found the slip and recorded the right number at the foot of its own entry
  without editing this line; Session J edits it here so the wrong number is not carried by the
  paragraph a future session reads first. The gate was never affected — it asserts the two
  lists are equal length, and they always were.)*
- **Verification, six numbers with status changes:** `npm test` 86 → **87 files**,
  2234 → **2283 passed**, 1 skipped unchanged; `npm run lint` clean (unchanged); `cargo check
  --features fa-inference` clean (unchanged); `cargo test --features fa-inference`
  **209 passed / 20 ignored** (unchanged — zero Rust files touched this session); golden
  replay **6/6** (unchanged); FA replay gate green at rest, **M7 verified RED** (new this
  session — dropping the clamp reproduces `224_thirty_three`'s exact committed defect and
  moves 176/307/340 back inside their runs), reverted and reconfirmed green; **M5/M6
  re-verified RED** on the current codebase (mutating `R11_MIN_FIT_DEVIATION` and
  `R12_MIN_CORRECTION_SEC` respectively), reverted and reconfirmed green.
- **Readiness for the live acceptance run: NO.** The ordered remainder is exactly the three
  conditions in `FA_PROJECT_DEFAULT_ON`'s own doc comment: (1) a fresh blind 12-row pass
  scored 12/12 (this session sealed the draw, did not score it); (2) a second, disjoint clean
  draw, also 12/12; (3) the live acceptance run, with the default staying OFF until both
  passes land clean.

---

**WS1 SESSION I — THE EXHAUSTIVE MOVER AUDIT, AND R-AM (2026-08-18).** Documentation-only
session by design: **zero production-code change**. The whole `src/` + `src-tauri/` diff is
empty; the only non-`docs/` edit is three allowlist entries in
`scripts/ws1-single-tracker.test.ts`, which that test's own failure message asks for by name.
Standing constraints held: `faAnchors.ts` sha256 `b61e94cb…` unchanged; no edits to
`snapBoundaries.ts`, `silenceDetector.ts`, the Hirschberg aligner, `project-state.md`,
`docs/history.md`, or `scripts/fixtures/phase4-baseline-*.csv` (golden replay 6/6
byte-identical); `DOCUMENTATION_AUDIT_REPORT.md` untracked; no new repo-root files.

- **Ruling R-AM recorded** (`sync-pipeline-v2-plan.md`, the new "WS1 SESSION I RULINGS"
  block): no register entry may be closed until that rule's own movers have been ear-scored.
  Stated as an invariant on the register *mechanism*, not on any one rule. **The motivating
  evidence was measured this session, not recalled:** R.5 moved 8 boundaries on v6, closed
  items 4 and 5 on a 0.000 s residual, and **worsened exactly three of its other six** against
  the values R.12 later established — `042_eleven_years` (error 0.220 → 1.630 s),
  `125_night_circle` (**0.000 → 1.600 s**, i.e. moved off an exactly correct value) and
  `340_fifty_eight` (0.950 → 2.900 s). `125_night_circle`'s wrong value was then cited for two
  sessions as R.11's third-conjunct justification before Session H retired the claim.
  R-AM(c) makes the four structurally-derived R.12 closures (`085`, `224`, `307`, `383`)
  **PROVISIONAL** until scored — open count stays 0, `REGISTER_HIGH_WATER` unchanged.
- **The mover population is exhaustively enumerated, and it closes.** The committed value of
  every boundary is `scripts/fixtures/phase4-fa-second-baseline-{corpus}-segments.csv`, and
  that file's git history *is* the rule history. Diffing all eight commits pairwise by tag
  yields **31 unique movers — 16 ear-verified, 4 structurally-derived, 11 never scored** —
  across 53 transition events. Exit **I1 does not fire**. Session G's commit (`5959430`) was
  included as a control and is confirmed to move nothing. Nine of the 31 are **net-unmoved**
  (R-U moved them, R-AA reverted them); two are dropped (`perilous_realms`, `blue_monkey`).
- **Reconciliation, including one discrepancy resolved rather than absorbed.** R.5 (8, v6),
  R.10 (1 moved + 2 dropped, 173), R.11 (4 = 3 v6 + 1 173) and R.12 (9, v6) match their
  documented counts exactly. R-U measures 17 against a documented 16, and R-AA 5 against a
  documented 4 — **the same single row in both cases**, spanish `023_scylla_six_sailors`
  (66.73 → 65.12 at `92746cf`). That is not a rule move: `92746cf`'s own commit message says
  "0 spanish" and separately records clearing A.5's KNOWN-STALE marker on the Spanish fixture.
  The row is the stale-fixture clearance, and it is register member `item-9`, ear-verified,
  closed at `616abb2`. Every one of the 31 has a named owner, so exit **I2 does not fire** —
  reported explicitly rather than passed over, since `item-9`'s owner is a documented cause
  and not one of the five named rules.
- **The audit document** (`stage1-mover-audit.md`): **24 rows — 14 audit + 10 blinded controls
  (41.7%)**, uniform **5.80 s** window on every row, order `sha256(tag)` ascending, sealed key
  in §4. Estimated **~20 minutes** including scoring and one re-listen. **Exit I3 does not
  fire** (24 < 40). Controls drawn by evenly-spaced deterministic pick over clean pools of
  342 / 136 / 15, excluding every start-or-duration mover, ±2-index neighbours, anything within
  5 s of a previously scored value *or* of this audit's own audit arm, sub-3.00 s starts,
  sub-1.2 s segments, and any row whose window would fall outside its corpus.
  `perilous_realms` is excluded with its reason recorded: it is an absence assertion whose ear
  verification already exists as `item-10` (`hostile_landscape` 0.00).
- **Exit I4 FIRES, and is reported rather than worked around.** The brief requires the uniform
  window to contain both candidate values; at 5.80 s that holds on 9 of 14 audit rows and fails
  on 5 — the 173 index-141–146 cascade, where R-U shifted a contiguous run forward by up to
  **20.23 s** and R-AA reverted all of it. Containing those would need a ≈40.5 s uniform
  window. Proposed resolution, **not self-approved**: keep 5.80 s and score those five as
  stated, because their competing value is a *reverted transient* no rule proposes at HEAD, and
  blinding is unaffected either way since the window is uniform. The document is built under
  that assumption and says so at the top.
- **The twelve previously scored rows re-verified at HEAD: 12/12 consistent, no drift, exit
  I5 does not fire.** The seven Session H scored YES still hold their exact values (507.01,
  571.07, 466.09, 256.33, 44.90, 969.30, 259.88); the five scored NO were all corrected away by
  R.12 exactly as designed (1047.57→1044.67, 524.39→521.71, 790.33→788.65, 127.17→125.54,
  372.35→370.75). A NO row still holding its scored value would have been the worse failure and
  was checked for explicitly.
- **The non-ear remainder dossier** (`stage1-non-ear-remainder.md`): nine items, one sitting,
  a recommended answer each — **eight accepts and one build**. Build: P6's normalizer-symmetry
  measurement. Accepts: Contract 1→2 A4 and Contract IN A3 (verbatim text supplied),
  R-S(iii)/R7 (accept-for-toggle, defer for default, with the uncached per-call
  `verify_model_manifest` digest named as the flip's precondition — ~77 s/call debug, ~5.25 s
  release, on top of ~231 s v6 / ~76 s 173 inference), Step T (confirm out of Stage 1;
  **≈10.5 engineer-days** + ~1 day for R-AL's dylib work), and D-1 items 4/5/8/9 — item 4
  re-worded (it names a surface the app does not implement), item 5 inside CLAUDE.md §6's
  accepted hooks gap, item 8 discharged by the live run's preview walkthrough, **item 9
  accepted as PERMANENTLY UNAUTOMATED** rather than left open every session.
- **Live acceptance run prepared, not executed** (`stage1-live-run-prep.md`). `npm run
  tauri:dev:fa` builds clean at this HEAD. All three source projects verified present and
  complete at `/Users/mohtashim/Downloads/All Projects Test Data`, with **no fixture, capture
  or harness anywhere in the in-app path**. The real user path is recorded (default is OFF, so
  FA must be enabled per project in Project Settings; `shouldPersistFaChoice` means the first
  Whisper-only run does not silently opt the project in), and **enabling it triggers real
  inference — verified by reading `forcedAlignmentRun.ts`, which has no result memo, no cache
  read and no stored-artifact branch on any path**. Walkthrough index produced: V6's ten
  "Level N" recitations with the boundary R.12 corrected in each, plus every mover, audit row
  and previously scored row by segment index, per project.
- **ONE LOGGING GAP FOUND — described, NOT written, stopped for approval.** The requirement is
  every warning, fallback, skip and rule firing with timestamp, segment index and owning rule.
  Skips, warnings and the character-timing fallback are fully covered by `SyncLogEntry`.
  **Rule firings are not logged at all** — R.10/R.11/R.12 emit `console.warn` only
  (`App.tsx:2957`, `:3113`, `:3140`), R.5 fires inside `computeFaChunkPlan` and logs nothing —
  and **`SyncLogEntry` has no field that can name an owning rule**. The FA fallback is equally
  invisible: a run where FA silently failed is indistinguishable in the log from one where it
  succeeded. The additive change is specified in five numbered parts in
  `stage1-live-run-prep.md` §4.4 (two new `SyncLogEntryType` members, `owningRule`/`ruleDetail`
  optional fields, widening `segmentIndex`'s contract, three call-site emissions that need no
  detector change, plus R.5's excision list and a discriminated FA result). Items 1–3 ≈ 2 h and
  are recommended before the run; items 4–5 are a separate decision. **Nothing written.**
- **Verification, six numbers — no status changes, as expected for a zero-code session:**
  `npm test` **87 files / 2283 passed / 1 skipped**; `npm run lint` clean; `cargo check
  --features fa-inference` clean; `cargo test --features fa-inference` **209 passed /
  20 ignored**; **golden replay 6/6**; FA replay gate **45/45 green at rest**. **M5/M6/M7 were
  NOT re-run this session** — stated rather than inherited silently: zero production files
  changed, `faAnchors.ts`'s sha256 and every fixture are byte-identical, so their Session H
  RED results cannot have moved. If the next session touches production code, re-run them.
- **One documentation defect found in passing.** Session H's own §11 entry says "20 roster
  members total"; the register actually has **19** (`REGISTER_ROSTER` 19, matching
  `CLOSED_BY_POSITIVE_ASSERTION` 19 — **15 ear-verified + 4 structurally-derived**). Session H
  added ten, not nine (R.12's nine plus `h-192-scout-listening`). The gate is unaffected —
  the test asserts the two lists are equal length, and they are — so this is an arithmetic slip
  in prose, corrected here rather than propagated. **CLOSED by WS1 Session J**, which edited
  Session H's own two lines in place so the wrong number is not carried by the paragraph a
  future session reads first.

---

**WS1 SESSION J — THE LOGGING HOLE CLOSED, P6 MEASURED, THE REMAINDER ANSWERED (2026-08-18).**
Full detail in the Changelog entry; §11-relevant items only here.

**(a) R-AN — the standing autonomy directive.** Technical and architectural calls are
delegated; the single boundary is that autonomy covers **how**, not **what is true**. Recorded
at `sync-pipeline-v2-plan.md`'s R-AN — the next free identifier, verified against the plan's
full ruling set rather than assumed. It is standing, and governs every session from J forward.

**(b) The acceptance run's evidence hole is closed.** This was the one blocker Session I
reported and deliberately did not fix. `SyncLogEntry` now carries `owningRule` and
`ruleDetail`; `'rule-correction'` and `'fa-fallback'` are real entry types; every audio-timed
run records **which engine produced its timing**, unconditionally. Before this, a run where FA
silently fell back was byte-indistinguishable in `project.syncLog` from a clean FA run — the
user got Whisper timing under an explicit high-precision-sync choice and nothing persisted
disagreed. Fail-clean stays; fail-*silent* is gone.

**(c) The FA entry point's signature changed, and the fail-clean contract did not.**
`runForcedAlignmentForSync` returns a discriminated `FaRunResult` instead of
`TranscriptToken[] | null`. It still never throws and the caller still has exactly one branch.
What changed is that `null` no longer has to mean five different things. A silence-detection
failure *inside* the FA pass now rides on the SUCCESS result — it degrades the chunk plan
without preventing alignment, and a run degraded that way used to record as clean.

**(d) Contract 1→2 P6: MEASURED, PASSES, moves ❌ → ✅.** See §9. The contract's blocking set
for the Stage 1 lock is now empty. Two coverage limits recorded rather than absorbed, both
pinned as assertions: the Spanish corpus cannot falsify the property (zero expanding tokens),
and `stripStageDirections` never fires on any corpus in scope.

**(e) The mutation matrix, re-run because production code was touched.** M1/M2/M3 RED, M4 a
true no-op **proven by chunk-plan byte equality rather than by a green gate**, M5/M6/M7 each
RED then reverted and reconfirmed green. **M5 had to be re-derived:** its historical target
(v6 anchor 460.56) carries no R-U-vetoed candidate at this HEAD — R-U vetoes exactly 17
candidates within tolerance on v6 and the nearest to 460.56 is 504.08, with no vetoed site
between ~184 s and ~504 s. Consequence recorded: no v6 vetoed site now falls inside any
NAMED_WINDOWS row, so this mutation class is caught by the whole-corpus digest alone.

**(f) The register is UNCHANGED and the four R.12 closures stay PROVISIONAL.** 19 roster, 19
closed, 0 open, high-water 0. `085`/`224`/`307`/`383` remain provisional under R-AM(c) until
the 24 rows are scored. Nothing this session closed them.

**(g) What now gates the live acceptance run.** Only the owner scoring the 24 audit rows. The
code side is ready: logging lands durable evidence, the audit is ratified and re-verified
24/24 against HEAD, every previously scored row holds in both directions, and the walkthrough
index is complete and correctly indexed.

---

### §12. Deleted File Archive (2026-08-14 consolidation, indexed 2026-08-15)

Every file the 2026-08-14 consolidation commit (`9cf5867`) deleted, with its pre-deletion
commit (`251be64`, the commit immediately before `9cf5867`) and a copy-pasteable retrieval
command. This is the C1/C5 "historical/archive block" every remaining in-repo reference to
one of these filenames should be read against — a mention elsewhere that says "(deleted
this pass)" without repeating the command below is still covered by this index, not a
dangling reference. Where a file's load-bearing conclusions were carried forward, the
surviving section is named; `context-report-2026-08-07.md` did not have WS1-tracking
content to carry forward (see its own row) and is the one file in this list whose
disposition is "superseded snapshot," not "folded in."

Retrieval command pattern: `git show 251be64:<old path> > <old path>` (recreates the file
at its old location with its pre-deletion content; run from the repo root).

| # | Old path | Surviving content / disposition |
|---|---|---|
| 1 | `docs/ws1-sync-pipeline/ws1-master-roadmap.md` | §2 (Master Stage Board), §3 (Master Phase Board), §7 (ruled decisions R-A–R-G, D1/D2) |
| 2 | `docs/ws1-sync-pipeline/task5-status-board.md` | §4 (Phase 3 Component Ledger), §5 (Slice Ledger) |
| 3 | `docs/ws1-sync-pipeline/task5-slice-ledger.md` | §5 (Full Slice Ledger D1–D25, reproduced in full) |
| 4 | `docs/ws1-sync-pipeline/task5-open-decisions.md` | §7 (Open Decisions 1–4) |
| 5 | `docs/ws1-sync-pipeline/task5-integration-scope.md` | §7 item 2 (R.5), §11 (Terminal Path sequencing) |
| 6 | `docs/ws1-sync-pipeline/spanish-gate-scoring.md` | §6 ("Spanish language gate — CLOSED") |
| 7 | `docs/ws1-sync-pipeline/d17-schema-capability-design-memo-2026-08-14.md` | §4 (Capability gate row), §5 (D17 row) |
| 8 | `docs/ws1-sync-pipeline/d18-index-trace-2026-08-14.md` | §4 (Word-timing schema row), §5 (D18 row) |
| 9 | `docs/ws1-sync-pipeline/d19-r7-fallback-2026-08-14.md` | §4 (R.7 confidence flag row), §5 (D19 row) |
| 10 | `docs/ws1-sync-pipeline/d20-ctc-infeasibility-2026-08-14.md` | §5 (D20 row), §6 (CTC-infeasibility paragraph) |
| 11 | `docs/ws1-sync-pipeline/d21-attribution-confmin-2026-08-14.md` | §5 (D21 row), §6 (R.7 CONF_MIN + CTC-infeasibility paragraphs) |
| 12 | `docs/ws1-sync-pipeline/d22-attribution-default-tail-2026-08-14.md` | §5 (D22 row) |
| 13 | `docs/ws1-sync-pipeline/d23-live-flip-race-guard-r2-padding-2026-08-14.md` | §5 (D23 row), §6 (R.2 padding paragraph, build half) |
| 14 | `docs/ws1-sync-pipeline/d24-r2-post-mortem-durable-audio-path-2026-08-14.md` | §5 (D24 row), §6 (R.2 padding paragraph, post-mortem half; durable audio cache paragraph) |
| 15 | `docs/ws1-sync-pipeline/d25-durable-cache-live-wired-r5-scoping-2026-08-14.md` | §4 (Durable WAV cache row, R.5 row), §5 (D25 row), §6 (durable audio cache paragraph) |
| 16 | `docs/ws1-sync-pipeline/fa-text-to-spans-seam-d5-2026-08-12.md` | §5 (D5 row) |
| 17 | `docs/ws1-sync-pipeline/boundary-drift-investigation.md` | §3 (task 4 row), its DO-NOT-RE-INVESTIGATE conclusion folded into the paragraph immediately below that table |
| 18 | `docs/ws1-sync-pipeline/context-report-2026-08-07.md` | **Superseded snapshot, not folded in.** One-time full-repo forensic audit of a since-abandoned detached-HEAD state (`8d83358`, pre-dating `main`'s current tip by 134+ commits at the time); not WS1 sync-pipeline tracking data. Its actionable findings (dual export-path structure, CLAUDE.md File Map gaps) are either already reflected in CLAUDE.md's current File Map or concern branches/commits no longer relevant to `main`. No WS1 status claim in this tracker depends on it |
| 19 | `docs/ws1-sync-pipeline/roadmap-2026-08-07.md` | Superseded by `ws1-master-roadmap.md` (row 1 above), itself now superseded by this tracker |
| 20 | `docs/ws1-sync-pipeline/ws1-readiness-2026-08-08.md` | §6 (50/50 silence-split reference, cross-cited from `docs/history.md:4108`) |
| 21 | `docs/ws1-sync-pipeline/measurements/README.md` | **Restored** (this pass, 2026-08-15) at its original path — see that file directly; not deleted after all, see C3/C4 finding in the 2026-08-15 close-out audit |
| 22 | `docs/ws1-sync-pipeline/measurements/d10-runtime-observations-2026-08-13.md` | §5 (D10 row), §6 (whole-file memory ladder table) |
| 23 | `docs/ws1-sync-pipeline/measurements/d11-chunked-alignment-2026-08-13.md` | §5 (D11 row), §6 (attribution isolation paragraph) |
| 24 | `docs/ws1-sync-pipeline/measurements/d13-index-attribution-2026-08-13.md` | §5 (D13 row), §6 (attribution isolation, CTC-infeasibility paragraphs) |
| 25 | `docs/ws1-sync-pipeline/measurements/d14-measurement-closure-2026-08-13.md` | §5 (D14 row) |
| 26 | `docs/ws1-sync-pipeline/measurements/d15-mis-assignment-diagnostic-2026-08-13.md` | §5 (D15 row), §6 (mis-assignment diagnostic paragraph) |
| 27 | `docs/ws1-sync-pipeline/measurements/fa-vocab-representability-2026-08-12.md` | §10 (Non-English Normalizer Gap — vocab-representability figures) |
| 28 | `docs/ws1-sync-pipeline/measurements/runtime-spike-2026-08-11.md` | §7 item 4 (R-M/R-N ratification proposal) |
| 29 | `docs/ws1-sync-pipeline/measurements/runtime-unblock-2026-08-12.md` | §7 item 4 (R-M/R-N ratification proposal, primary source) |

---

Full state: [`docs/ws1-sync-pipeline/`](ws1-sync-pipeline/) — two top-level tracked files
(`sync-pipeline-v2-plan.md` design doc, `watcher-revert-2026-08-03.diff` resumption
pointer) plus this section for execution/status, plus the `measurements/` data directory
(raw CSV/JSON exports and the restored `measurements/README.md` index, §12 row 21).

---

## Changelog

- **2026-08-18 — WS1 Session M: THE MOST MATERIAL DISCOVERY OF THE PROGRAMME —
  forced alignment had never once executed inside the application. The runtime
  is now bundled and app-resolved (R-N), the FA error is surfaced to the user,
  auto-detect is fixed, a pre-flight readiness check ships, and two guard tests
  shut the class. The four Session L debts are disposed. Live acceptance run is
  now UNBLOCKED pending the owner's one-click walkthrough.**
  - **THE FINDING, stated plainly.** Every FA measurement, capture and fixture in
    the record was produced through the `cargo test` / Python-spike driver, which
    sets `ORT_DYLIB_PATH` to a dylib inside `.work-phase4/spike-runtime` — a
    gitignored scratch directory outside the repo's control and never on a
    shipped code path. The app process never set that variable. So
    `fa_onnx.rs::load_session`'s first line failed on every in-app FA run with
    `failed to initialize onnxruntime: ORT_DYLIB_PATH not set`, the run fell back
    to Whisper timing, and the fallback's underlying error was rendered nowhere.
    This changes the standing of every fixture-based FA claim until the live run
    reproduces it — **flagged: the fixtures are MEASURED under the spike driver,
    INFERRED to hold under the bundled runtime until the live run confirms.**
  - **The verbatim error (MEASURED from code + the fail path).**
    `failed to initialize onnxruntime: ORT_DYLIB_PATH not set` for the two runs
    that fell back with "the alignment engine reported an error"; the auto-detect
    run fell back earlier with `unsupported-language` because `project.language`
    was undefined at the gate (Step 4). The English/Spanish explicit-language
    runs prove the language wiring is correct when a language is set — their
    fallback was purely the runtime.
  - **Required vs available runtime (MEASURED from the crate).** ort-sys
    `=2.0.0-rc.13` with our feature set (`default-features=false`, no `api-NN`
    feature) computes `ORT_API_VERSION = 17` (`version.rs`: `17 + Σ api-NN`). It
    therefore requires onnxruntime C-API **≥ 17 (≥ 1.17.0)**. Both dylibs present
    (1.22.0 → minor 22, 1.23.2 → minor 23) clear it; onnxruntime's C API is
    backward-compatible. **The version mismatch was NOT the cause** — the env var
    was unset, so no dylib version was ever consulted.
  - **R-N implemented.** `load-dynamic` PLUS bundle the dylib. `libonnxruntime.1.23.2.dylib`
    (osx-x86_64, sha256 `8c9c78de…`, 39,742,608 B) lives under `src-tauri/onnxruntime/`
    (gitignored + committed manifest/README, same policy as the whisper `.bin`),
    bundled via `tauri.conf.json`'s `bundle.resources` (`onnxruntime/*`).
    `fa_onnx.rs::ensure_ort_dylib` (called from `align_chunked_for_language`,
    the one production choke point with an `AppHandle`) resolves it from
    `resource_dir()` with dev/exe-dir fallbacks mirroring `whisper.rs::model_path`,
    HARD-gates the arch (macOS x86_64 only; any other target fails loudly, never
    silently loads an incompatible binary), and sets `ORT_DYLIB_PATH` only when a
    shell has not already set it — the env var survives as a test/override
    escape hatch, which the entire existing test-skip convention rests on.
    Nothing resolves into `.work-phase4/`.
  - **Step 1 — the FA error is surfaced.** `SyncLogPanel.tsx`'s `formatDetailLine`
    now renders `fa-fallback` (and `fa-preflight`) entries' `errorMessage`
    (verbatim backend text) and `fixHint`. `buildFaFallbackEntry` already carried
    the detail into `errorMessage`; the render layer had silently dropped it for
    exactly the one entry a user most needs the cause of.
  - **Step 4 — auto-detect fixed + pre-flight.** New non-sticky `Project.detectedLanguage`
    (written unconditionally from every `-l auto` run, `useWhisper.ts`) + `faGate.ts::resolveFaLanguage`
    (`language ?? detectedLanguage`) feed the gate the detection instead of
    throwing it away. New `fa_preflight.rs` command + `faPreflight.ts::runFaPreflight`
    report FA readiness — capability, resolved language, runtime library load,
    model presence — as a durable `fa-preflight` sync-log entry (info when ready,
    warning + verbatim blocking cause when not) BEFORE inference, so a doomed run
    is visible as such up front. Observational: it never changes whether FA is
    attempted; `runForcedAlignmentForSync` stays the fail-clean authority.
  - **Step 7 — the class is shut.** `scripts/onnxruntimeBundle.guard.test.ts`:
    GUARD 1 fails if any production runtime-resolver body or the bundle config
    names a throwaway scratch dir; GUARD 2 fails if the manifest's onnxruntime
    API version drifts from what the pinned `ort` computes (or the pin moves).
    Same shape as `faDefaultDrift.test.ts`.
  - **Four Session L debts disposed (reconciled into this commit, not reverted).**
    (1) **M8-B** (R.13's carrier-line guard) — Session K reported it green/uncovered;
    Session L built the equality-boundary fixture in `faRunPlacementGate.test.ts`,
    corrected the reachability comment in `faRunPlacementGate.ts`, and flipped
    M8-B RED in `scripts/phase4-fa-replay.test.ts`. (2) **R.5 index-convention
    divergence** — the committed-array move was never measured against a live
    parse/committed disagreement (v6 drops zero scenes); `syncLog.indexConvention.test.ts`
    now constructs the dropped-scene input v6 cannot and measures it. (3) **P6
    Spanish-half vacuity** — the Spanish corpus carries no expanding token;
    `normalizerSymmetry.test.ts` now exercises the `es` normalizer on constructed
    digit material with the precise bound on what it can claim. (4) The
    `.gitignore` + bundle wiring for the runtime (this session) closes the last
    "runtime lives only in scratch" debt the driver era left.
  - **Production code:** `src-tauri/src/fa_onnx.rs` (`ensure_ort_dylib`,
    `resolve_bundled_ort_dylib`, `probe_ort_runtime`, wired into
    `align_chunked_for_language`), `src-tauri/src/fa_preflight.rs` (new command),
    `src-tauri/src/lib.rs` (module + handler), `src-tauri/tauri.conf.json`
    (resource), `.gitignore`, `src-tauri/onnxruntime/` (manifest + README + dylib),
    `src/components/SyncLogPanel.tsx`, `src/services/faGate.ts` (`resolveFaLanguage`),
    `src/services/faPreflight.ts` (new), `src/services/syncLog.ts`
    (`buildFaPreflightEntry`), `src/hooks/useWhisper.ts`, `src/App.tsx`
    (pre-flight wiring + durable language resolution), `src/types.ts`
    (`detectedLanguage`, `fa-preflight` entry type).
    New tests: `scripts/onnxruntimeBundle.guard.test.ts`, `src/services/faPreflight.test.ts`,
    plus additions to `faGate.test.ts`, `syncLog.test.ts`, `SyncLogPanel.test.tsx`.
  - **No changes to** `snapBoundaries.ts`, `silenceDetector.ts`, the Hirschberg
    aligner, `faAnchors.ts` (hash `b61e94cb…` unchanged), `project-state.md`,
    `docs/history.md`, or `scripts/fixtures/phase4-baseline-*.csv`.
  - **Numbers:** 93 files / 2387 passed / 1 skipped; lint clean;
    `cargo check --features fa-inference` clean; `cargo test --features fa-inference`
    209 passed / 20 ignored; golden replay 6/6; FA replay gate 50/50 green at rest, RED
    under M5/M6/M7/M8-A/M8-B/M9/M10 (M8-B now RED after Session L).
  - **STILL OWED (owner's hands only, no GUI automation this session):** Step 5
    (prove FA runs end-to-end in the app, per-project wall-clock) and Step 6
    (first fixture-vs-live boundary comparison; R.5/R.10/R.11/R.12/R.13 fire on the
    predicted segments; whether the ten "landed on audio still playing" warnings
    shrink). Exact click steps are in `docs/ws1-sync-pipeline/stage1-live-run-prep.md`.

- **2026-08-18 — WS1 Session K: the 24-row mover audit scored 22/24; both failures root-caused;
  R.13 (the atomic-utterance invariant) ships and closes the one real defect; a THIRD defect
  found in the shipped display path; ruling R-AO recorded with two machine checks.**
  Rulings: **R-AO** (the both-sides rule) and the owner's disposition of clip 1 (verified
  CORRECT in the app; mid-sentence / no-silence splits STAY in future ear draws, no exclusion
  rule). Full detail in §11's Session K entry.
  - **Clip 1 is NOT a defect.** 603.69 is the exact midpoint of the FA gap between two
    confidence-1.000 words at a scripted mid-sentence split with no detected silence in
    [598.04, 604.82]. Git shows the committed value never moved (603.69 at every commit) and
    the text never changed — what changed was the `order` field (146→144 at R.10) and, decisively,
    the PRESENTATION: the earlier pass showed no text at all.
  - **Clip 12 IS a defect, and the exact mirror of R.12 does not fix it.** Both token streams
    are unreliable right after an unscripted run (Whisper's token "the" spans [668.650, 669.400]
    and swallows the correct silence; FA's confidence collapses to 1e-5..1e-4 vs a 0.9985 median).
    R.13 anchors on the carrier's own-utterance END and places on the first detected silence at
    or after it. **Predicted blast radius 1 of 649 before building; actual 1 of 649.**
  - **Production code:** `src/services/faRunPlacementGate.ts` (R.13 + a shared Model-P
    `applyBoundaryMoves` both halves use), `src/services/syncLog.ts` (`committedIndexOf`; R.5
    scans the committed array; R.10 emits no committed index; R.11/R.12/R.13 resolve by id),
    `src/App.tsx` (R.13 wiring; R.5's entries staged and spliced), `src/types.ts` (the false
    uniform-convention claim replaced by the two real conventions).
    New tests: `ruleBothSides.test.ts`, `syncLog.indexConvention.test.ts`.
  - **Fixture:** `phase4-fa-second-baseline-v6-segments.csv`, 2 insertions / 2 deletions —
    `225_night_scouts` 667.47 → 669.05, `224_thirty_three` duration 3.685 → 5.265. Golden replay
    fixtures byte-identical.
  - **Numbers:** 91 files / 2354 passed / 1 skipped; lint clean; `cargo check --features
    fa-inference` clean; `cargo test --features fa-inference` 209 passed / 20 ignored; golden
    replay 6/6; FA replay gate 50/50 green at rest, RED under M5/M6/M7/M8-A/M9/M10 (M8-B green
    and reported as green).
  - **Deliverable:** `docs/ws1-sync-pipeline/stage1-session-k-ear-list.md` — 28 fully annotated
    blinded rows (1 moved, 9 recitation opening edges, 9 recitation closing edges, 9 controls),
    uniform 5.80 s window (3.67x the largest delta), sealed key, ~25 minutes.

- **2026-08-18 — WS1 Session J: the STANDING AUTONOMY DIRECTIVE is recorded as R-AN; the
  RULE-FIRING LOGGING ships and closes the acceptance run's evidence hole; Contract 1→2 **P6**
  is MEASURED and PASSES; the nine non-ear remainder items are all ANSWERED; the 24-row mover
  audit is ratified, re-verified and ready to score.** Ruling: **R-AN** (owner) — technical and
  architectural calls are delegated (implementation shape, naming, test structure, file layout,
  refactor scope), with one boundary: **autonomy covers HOW, never WHAT IS TRUE** — a new
  defect, a shipped rule proven wrong, a control moving, or a measurement contradicting the
  record is still reported the moment it is found. Recorded at
  `sync-pipeline-v2-plan.md`'s R-AN, the next free identifier (verified against the plan's
  full ruling set, which ended at R-AM).
  - **Production code:** `src/types.ts` (two `SyncLogEntryType` members `'rule-correction'` /
    `'fa-fallback'`; `owningRule?: string` + `ruleDetail?`; `segmentIndex`'s contract widened;
    the stale `FA_PROJECT_DEFAULT_ON` prose removed), `src/services/syncLog.ts` (six builders),
    `src/services/forcedAlignmentRun.ts` (discriminated `FaRunResult`),
    `src/App.tsx` (five wiring sites), `src/components/SyncLogPanel.tsx` (two badges).
    New tests: `faDefaultDrift.test.ts`, `normalizerSymmetry.test.ts`.
  - **The hole the logging closes, stated as what was previously unanswerable:** a run where FA
    silently fell back to Whisper timing was **indistinguishable in `project.syncLog`** from a
    clean FA run. Rule firings were `console.warn`-only — absent from the log, the panel and
    the Copy export, and gone when the window closed. All five specified items were taken.
    Item 4 (R.5) did NOT need the proposed `computeFaChunkPlan` signature change:
    `computeUnscriptedRuns` was already exported (Session H added it for R.12, and its own doc
    comment names R.5 as a future caller), so `runForcedAlignmentForSync` calls it with the
    **identical four arguments** it gave the chunk planner — which matters, because `App.tsx`'s
    `aligned.silences` is a *separate detection pass* and logging R.5 against those would have
    reported spans R.5 never acted on. That provenance requirement is asserted, not commented.
  - **Inertness of the logging change, proven not asserted:** all 31 `scripts/fixtures/*.csv`
    byte-identical before and after; all nine anchor/run/chunk digests byte-identical on all
    three corpora (v6 `f3f469a68664596a`/`4d95968b519576da`/`d5dc8d7924dc8402`, 173
    `d2e3f269cd884a26`/`4e9af8b426d90c3d`/`b4c4611508f7b58e`, spanish
    `ac2408783c30f62f`/`41a72024d26d3389`/`c7e4be33cf7ab3c7`); FA replay gate 45/45; golden
    replay 6/6; `faAnchors.ts` sha256 `b61e94cb…` unchanged. **Exit J1 does not fire.**
  - **P6 BUILT AND PASSING — zero asymmetries.** See §9. The substantive check was
    compositionality (transcript side normalizes per TOKEN, script side per SEGMENT, and
    `canonicalize` does real multi-word rewrites); every rewrite is intra-token, so the streams
    agree byte-for-byte. **Exit J2 does not fire.** Two coverage limits reported rather than
    absorbed: the Spanish corpus has zero expanding tokens (vacuous pass) and
    `stripStageDirections` fires on zero segments corpus-wide. Both pinned as assertions.
  - **The two ledger debts closed, and the drift made impossible.** The roster count is
    corrected to **19** where Session H wrote 20 (and "nine roster appends" to **ten** — R.12's
    nine plus `h-192-scout-listening`); `types.ts`'s `faHighPrecisionSync` doc comment no longer
    asserts a value for the FA default at all, naming `faGate.ts` as the sole owner. **The
    permanent fix is `faDefaultDrift.test.ts`**, which scans `src/` for every prose restatement
    of the default and fails the build on any that disagrees with the runtime constant — the
    value has moved twice and a prose copy was left behind both times. It earned its keep
    immediately: it caught a live instance in this session's own first edit.
  - **Mutation matrix re-run in full** (production code was touched, which is the condition
    Session I named). **M1/M2/M3 RED** (4 gate tests each); **M4 a true no-op, proven by
    chunk-plan byte equality** — all nine digests identical under mutation, not merely a green
    gate; **M5 RED** (1), **M6 RED** (6 across 2 independent files), **M7 RED** (6 across 2),
    each reverted and reconfirmed green. `faAnchors.ts` sha256 verified `b61e94cb…` after every
    revert, and both mutation targets are byte-identical to their pre-session state.
  - **M5 had to be RE-DERIVED, and this is a finding about the matrix rather than the code.**
    Its historical target (v6 anchor 460.56) carries **no R-U-vetoed candidate at this HEAD**.
    Measured through production: R-U vetoes exactly **17** candidate silences within tolerance
    on v6, and the nearest to 460.56 is **504.08** — there is no vetoed site anywhere between
    ~184 s and ~504 s. M5 was re-derived against 504.08 and goes RED there. Consequence worth
    recording: **no v6 vetoed site now falls inside any of the gate's NAMED_WINDOWS rows**, so
    this mutation class is caught by the whole-corpus digest alone rather than also by a
    named-row assertion. Not a defect — the gate's own argument is that the chunk plan is the
    complete cut — but the named rows no longer corroborate this class independently.
  - **Also corrected in passing:** Session I's verification line attributes M5/M6 to
    `R11_MIN_FIT_DEVIATION` and `R12_MIN_CORRECTION_SEC` "respectively". Those are **M6 and
    M7**; M5 is the items-6/7 anchor-class mutation. The earlier, more specific entries
    (Session F defining M6 as R.11-specific, Session H introducing M7 as R.12-specific) are the
    consistent record and are what this session used.
  - **All nine non-ear remainder items ANSWERED as recommended** and signed off at the head of
    `stage1-non-ear-remainder.md`: P6 built; A4 and Contract IN A3 accepted as written;
    R-S(iii) accepted-for-toggle and deferred-for-default with the digest memo as the flip's
    precondition; Step T confirmed out of Stage 1 (release-phase, ≈10.5 days + ≈1 day R-N);
    D-1 items 4/5/8 accepted at their automated subset; **D-1 item 9 accepted as PERMANENTLY
    UNAUTOMATED** — a deliberate permanent exclusion, not a deferral. D-1 stands at 5 of 9
    automated, remaining four accepted rather than pending.
  - **Audit I4 RATIFIED and the 24 rows re-verified.** The five 173 cascade rows (committed
    indices 141–146) are scored with the uniform 5.80 s window; the exit is closed. All 24
    boundary values re-read from the committed fixtures at this HEAD: **24/24 match, 0
    mismatches.** Every previously ear-scored row re-verified **in both directions** — 7 YES
    rows still hold their scored value, all 5 NO rows have been corrected away and **none still
    holds its wrong value**, the 8 earlier-sitting ear-verified movers hold, and both dropped
    rows (`perilous_realms`, `blue_monkey`) are still absent from the committed array.
    **Exit J3 does not fire. Exit J4 does not fire** — the mover population is unchanged at 31
    and every one is accounted for in the refreshed walkthrough index.
  - **`stage1-live-run-prep.md` refreshed:** §4's logging gap closed and rewritten as what
    ships; real inference re-confirmed by reading `forcedAlignmentRun.ts` (no memo, no cache
    read, no stored-artifact branch — the Session J signature change added neither); §5 now
    complete rather than representative. **One real defect fixed there:** the 173 table mixed
    *committed* indices with *parse* indices, which differ by 2 after R.10's two drops, so half
    that table pointed at the wrong row. Both columns are now given explicitly, per project,
    with the convention stated. `computeUnscriptedRuns` measured at 10 / 0 / 0 runs across the
    three corpora, v6's ten spans exactly matching the ten recitation intervals.
  - **Verification, six numbers with status changes:** `npm test` 87 → **89 files**,
    2283 → **2314 passed**, 1 skipped unchanged; `npm run lint` clean (unchanged);
    `cargo check --features fa-inference` clean (unchanged); `cargo test --features
    fa-inference` **209 passed / 20 ignored** (unchanged — zero Rust files touched); golden
    replay **6/6** (unchanged, fixtures byte-identical); FA replay gate **45/45 green at rest**,
    RED under M5/M6/M7.
  - **Register state: unchanged.** 19 roster members, 19 closed, 0 open, `REGISTER_HIGH_WATER`
    0. **The four R.12 structurally-derived closures (`085`, `224`, `307`, `383`) remain
    PROVISIONAL** under R-AM(c) and stay provisional until the 24 rows are scored. Nothing this
    session closed them or was entitled to.
  - **Readiness for the live acceptance run: the code side is READY; the gate is the owner's
    ear.** The logging blocker Session I reported is closed, so the run can now produce durable
    evidence. What remains before it: the owner scores the 24 rows clean.

- **2026-08-18 — WS1 Session I: R-AM RULED (no register closure without an ear pass on that
  rule's own movers); the mover population enumerated EXHAUSTIVELY at 31 and reconciled; the
  blind-12 sample superseded by a 24-row audit; the non-ear remainder reduced to nine
  answerable decisions; the live run prepared with one logging gap reported.**
  Documentation-only — **zero production-code change**, the `src/` + `src-tauri/` diff is
  empty. Ruling **R-AM** (`sync-pipeline-v2-plan.md`) attaches to the register *mechanism*:
  no entry closes until every boundary its owning rule moves has been ear-scored. Motivating
  evidence measured this session — R.5 closed items 4/5 on a 0.000 s residual while
  **worsening three of its other six movers**, including `125_night_circle`, which it moved
  **off an exactly correct value** (error 0.000 → 1.600 s) and whose wrong value was then
  cited for two sessions as R.11's third-conjunct justification. R-AM(c) makes the four
  structurally-derived R.12 closures PROVISIONAL; open count stays 0 and `REGISTER_HIGH_WATER`
  is unchanged. **Population:** the committed-value fixture's git history is the rule history;
  eight commits diffed pairwise give **31 unique movers / 53 transitions — 16 ear-verified,
  4 structural, 11 never scored** (exit I1 clear). Per-rule counts reconcile exactly for
  R.5/R.10/R.11/R.12; R-U and R-AA are each one high against their documented figures, and it
  is **the same row both times** — spanish `023_scylla_six_sailors`, the stale-fixture
  clearance `92746cf` carried alongside R-U ("0 spanish" in its own commit message), already
  closed as register `item-9`. Every mover has a named owner, so exit I2 is clear.
  **Audit** (`stage1-mover-audit.md`): 24 rows, 14 audit + 10 blinded controls, uniform 5.80 s
  windows, `sha256(tag)` order, sealed key, ~20 min (exit I3 clear). **Exit I4 FIRES** — five
  173 cascade rows carry a reverted-transient competing value up to 20.23 s away, which no
  uniform window under ~40.5 s can contain; resolution proposed, not self-approved.
  **Twelve prior rows re-verified 12/12 with no drift** (exit I5 clear): seven YES rows hold
  exactly, five NO rows corrected away by R.12 exactly as designed. **Remainder dossier**
  (`stage1-non-ear-remainder.md`): nine items, eight accepts and one build (P6's
  normalizer-symmetry measurement, ~1–2 h), with verbatim acceptance text for A4 and Contract
  IN A3, Step T scoped at ≈10.5 engineer-days, and D-1 item 9 recommended PERMANENTLY
  UNAUTOMATED. **Live run prepared, not executed** (`stage1-live-run-prep.md`):
  `tauri:dev:fa` builds clean, all three source projects present with no fixture/capture/
  harness in the in-app path, the real per-project toggle path recorded, and real inference
  confirmed by reading `forcedAlignmentRun.ts` (no memo, no cache read, no stored-artifact
  branch). **One logging gap reported and deliberately NOT fixed:** rule firings are
  `console.warn`-only and `SyncLogEntry` cannot name an owning rule, so a run where FA silently
  fell back is indistinguishable from one where it succeeded — the additive change is specified
  in five parts and stopped for approval. Verification unchanged: 87 files / 2283 passed /
  1 skipped; lint clean; `cargo check --features fa-inference` clean; `cargo test --features
  fa-inference` 209/20; golden replay 6/6; FA gate 45/45 green at rest (M5/M6/M7 not re-run,
  and said so — no production file changed). Also corrected: Session H's "20 roster members"
  is **19** (15 ear + 4 structural).

- **2026-08-18 — WS1 Session H: R.12 BUILT (the atomic-run invariant) — register reopens at
  9 and closes again in the same commit; FA default reverted ON → OFF, value-only; two
  falsified R.11 justifications retired.** Ruling: owner ruling 3 (a deliberate REVERSAL of
  R-E — the excised run belongs to the FOLLOWING segment, not the preceding one, for the
  committed-boundary correction; recorded as an amendment at R-E's own site and all three
  citations). Production code: `src/services/faRunPlacementGate.ts` (new, pure —
  `detectRunPlacementDefects`/`applyRunPlacementCorrections`), `src/services/faChunkPlan.ts`
  (additive-only: exports `computeUnscriptedRuns`, proven a no-op — chunk-plan byte equality,
  all three corpora), `syncConstants.ts` (`R12_MIN_CORRECTION_SEC`), `App.tsx` (wiring, LAST
  in the correction chain, after R.11, gated on `faTokens` truthy). `faAnchors.ts` byte-
  identical (sha256 `b61e94cb…`, untouched); `snapBoundaries.ts`, `silenceDetector.ts`, the
  Hirschberg aligner and all Rust untouched.
  - **The mechanism**: `snapCoveredBoundaries` snaps a seam onto the nearest detected
    silence, and a recitation's own internal breath pauses are real detected silences — so on
    nine of V6's ten unscripted "Level N" recitations, the nearest one to the seam is INSIDE
    the recitation. All nine committed values are exact midpoints of real silences strictly
    inside a run; eight of nine are bit-identical to Whisper's own value (both engines share
    the defect) — v6 `085_the_spear_bearer` is the one exception, where Whisper alone is
    correct at 250.81 and FA alone is wrong at 252.74.
  - **Clamped-midpoint placement, forced by measurement, not taste**: the corrected value is
    the midpoint of (the leading silence ∩ `[prevToken.endSec, run.startSec]`), falling back
    to `run.startSec` when no silence overlaps the gap. Unclamped placement lands back inside
    the run on four of the nine rows (176/307/340/224) and, on 224 (`224_thirty_three`),
    reproduces the exact committed defect value — the clamp's own proof.
  - **Blast radius exactly 9/649, proven not assumed** — 173 and spanish have zero unscripted
    runs and zero effect; R0 (the tenth recitation, corpus start) structurally cannot fire
    (no preceding token, no legal interval).
  - **Mutual exclusion measured, not argued**: R.5 (chunk-plan byte equality after re-feeding
    R.12's output); R.10 (disjoint corpora — 173 only, zero runs); R.11 (disjoint firing sets;
    v6 `125_night_circle` is the one boundary both rules' fit signal would touch, and R.11's
    third conjunct declining it on real 0.0301 span confidence is what keeps them exclusive —
    now load-bearing for exclusion, not merely precision).
  - **Two falsified R.11 justifications retired, all four citation sites corrected**:
    `faSeamFitGate.ts`'s header/third-conjunct comment, `syncConstants.ts`'s
    `R11_MAX_SPAN_WORD_CONF` doc comment, `faSeamFitGate.test.ts`'s false-positive-guard test
    comment, and this ledger's own WS1 Session F entry (correction appended above, not
    edited in place) — all previously claimed v6 `125_night_circle`'s 372.35 was "R.5's own
    already-correct value." It never was; R.12 owns it. The conjunct's real, unchanged
    justification is the measured 0.0301 span confidence.
  - **Register reopened 0 → 9 and closed 9 → 0 in the SAME commit** (`REGISTER_HIGH_WATER`,
    `scripts/phase4-fa-replay.test.ts`) — nine new `CLOSED_BY_POSITIVE_ASSERTION` entries,
    five `verification: 'ear'` (Session H's own 12-row listening pass scored them wrong) and
    four `verification: 'structural'` (the same mechanism, no ear pass, admitted as such —
    085/224/307/383). `192_scout_listening` — carried outside the register since Session F
    as an explicitly unverified change detector — is promoted to a positive assertion at
    571.07 on the same ear pass; open gate item G2 closes with it.
  - **FA default reverted ON → OFF, value-only** (`faGate.ts`'s `FA_PROJECT_DEFAULT_ON`).
    Everything R-AK built in Session G — the per-project field, absent-key semantics, the G1
    load-path proof, migration handling, `runForcedAlignmentForSync`'s fail-clean precheck —
    is unchanged; only the literal moves. Exact flip-back condition recorded in the constant's
    own doc comment: two fresh blind 12/12 listening passes on rows drawn clear of every
    boundary any rule has touched, then the live acceptance run. Session H's own sealed,
    unscored Step 12 draw (window ≥ 5.80 s = 2× max |Δ| 2.90 s, stratified, an unmoved-control
    arm, at least two of the four structurally-derived rows) is the first of the two.
  - **Verification:** `npm test` **87 files / 2283 passed / 1 skipped** (unrelated
    pre-existing skip); `npm run lint` clean; `cargo check --features fa-inference` clean;
    `cargo test --features fa-inference` **209 passed / 20 ignored** (zero Rust files
    touched — figure unchanged from Session G); golden replay **6/6**, byte-identical;
    `faAnchors.ts` sha256 `b61e94cb…` unchanged; FA replay gate green at rest, **M7
    (R.12-specific) verified RED** (dropping the clamp reproduces the 224 defect and moves
    176/307/340 back inside their runs) then reverted and reconfirmed green; **M5/M6 (prior
    sessions' mutations) re-verified RED**, reverted, reconfirmed green. Full write-up: §11's
    WS1 Session H entry (this changelog block is the summary).
  - **Readiness for the live acceptance run: NO.** Ordered remainder: (1) a fresh blind
    12-row pass, 12/12, on rows clear of every rule's own boundaries; (2) a second, disjoint
    12-row pass, also 12/12; (3) the live acceptance run itself, with the default still OFF
    until (1) and (2) both land.

- **2026-08-17 — WS1 Session G: F6 RESOLVED — the FA default flip SHIPS as a PER-PROJECT
  toggle (default ON); fail-clean brought under budget; R-N decided; 5 of D-1's 9
  automated.** Rulings **R-AK** (per-project toggle, default ON — owner) and **R-AL**
  (R-N: `load-dynamic` + bundled dylib — taken under delegation with measurements in hand).
  Production code: `src/types.ts` (`Project.faHighPrecisionSync`), `src/services/faGate.ts`
  (`isFaEnabledForProject`/`isFaGateOpenForProject`/`shouldPersistFaChoice`/
  `FA_PROJECT_DEFAULT_ON`; retires the global `isFaToggleOn`/`setFaToggle`), `src/App.tsx`
  (per-project gate read + modal wiring), `src/components/ProjectSettingsModal.tsx`
  (edits the project field; writes only on an actual change),
  `src-tauri/src/fa_dev.rs` (manifest `byteSize` size precheck + in-process digest memo
  keyed on path/size/mtime), `src-tauri/src/fa_production.rs` (comment accuracy).
  Tests: `faGate.test.ts` rewritten (27, incl. the **G1 load-path proof**),
  `src/services/d1RegressionChecklist.test.ts` (new, 23 — D-1 items 1/2/3/6/7 for real,
  items 4/5/8/9 recorded as executable documentation of what they actually have), 3 new
  Rust fail-clean tests + 1 env-gated `#[ignore]` real-model benchmark.
  Docs: `docs/ws1-sync-pipeline/stage1-lock-ear-list.md` and
  `docs/ws1-sync-pipeline/stage1-lock-contract-1to2.md` (both new, both runnable without
  further setup). **Headline measurements:** the FA-recovery set is **5, not 6 or 7** (R.10
  dropped two members — Session E's "six, not seven" corrected); `192_scout_listening` is a
  **true positive** on structure (word-seam midpoint over 0.080 s of non-silence; span conf
  4.0732e-5, 266× below threshold, 740× below the known FP) so **G2 does not fire**; and a
  **healthy** model's per-Apply-Sync verification tax — Session F could only infer it — is
  **measured at 76.51 s debug / 4.99 s release and now paid once per process** instead of
  every call. `npm test` **86 files / 2234 passed / 1 skipped**; `npm run lint` clean;
  `cargo check --features fa-inference` clean; `cargo test --features fa-inference`
  **209/20** (was 206/19); golden replay **6/6**; FA replay gate **29/29**;
  `faAnchors.ts` sha256 `b61e94cb…` unchanged; **M5 RED (2), M6 RED (6)**, both reverted
  and reconfirmed green. Full write-up: §11's WS1 SESSION G entry.

- **2026-08-17 — WS1 Session F: R.11 BUILT, the Zero-Defect Register reaches ZERO;
  F6 blocks the FA-default flip this session.** Production code:
  `src/services/faSeamFitGate.ts` (new, pure — `detectSeamFitDefects`/
  `applySeamFitCorrections`), `syncConstants.ts` (`R11_MIN_FIT_DEVIATION`,
  `R11_MAX_SPAN_WORD_CONF`, `R11_MIN_CORRECTION_SEC`), `App.tsx` (wiring, post-
  `headExtendFirstSegment`, gated on `faTokens` truthy). `faAnchors.ts` byte-identical
  (sha256 `b61e94cb…`, untouched); `faChunkPlan.ts`, `snapBoundaries.ts`, `silenceDetector.ts`,
  the Hirschberg aligner and all Rust untouched (`git diff --stat src-tauri/` empty). FA gate
  stays OFF (R-AD unaffected — see F6 below, a SEPARATE finding about the default's own
  future flip, not this session's build). Full write-up: §11's Session F block; ruling
  **R-AI** in `sync-pipeline-v2-plan.md`.
  - **Census re-derived from the FIT signal, not the stale seam signature**: 390 chunks at
    current HEAD (not the "381" Session D's own prose cited, predating R.5's chunk-plan
    growth), attribution by script-word index (time-containment attribution mis-locates the
    defect itself — FA's crushed output lands outside its own chunk's nominal window).
    Converges on 4 real candidates: the 3 register members + 1 new unverified
    (v6 `192_scout_listening`).
  - **One mechanism for all three register defects, independently re-measured against the
    real captured FA word/silence output**: a chunk's attributed text doesn't fit its audio;
    FA crushes word timings into a garbage span; the ear-correct value is always the midpoint
    of the real silence that already, correctly, anchors the containing chunk's own edge (an
    untouched R.1 anchor). All three land EXACTLY on their ear-correct pins (451.03, 17.88,
    671.18).
  - **A real false positive (v6 `125_night_circle`, an already-correct R.5 output) forced a
    third conjunct** — every FA word in the correction span must carry no real acoustic
    support (`R11_MAX_SPAN_WORD_CONF`, geometric midpoint, ~2.8x margin — narrower than
    R.10's 850x, stated plainly rather than dressed up). Two real implementation bugs (an
    edge-selection error, a Model P duration error) were caught and fixed by the test suite
    before any fixture was touched.
  - **Blast radius 4/649, measured through the real production function against the full
    real FA captures** — matches the R.5 (8/649) / R.10 (3/649) order of magnitude. Frozen
    fixtures regenerated with only the 8 affected rows changed, byte-identical elsewhere.
    All controls (item 6, V6 seam 150/151, items 4/5, items 10/11) held.
  - **Register: `REGISTER_HIGH_WATER` 3 → 0. The Stage-1-lock machine check is UN-SKIPPED
    and PASSING for the first time.** `npm test` 85 files / 2195 passed / 1 skipped
    (unrelated pre-existing skip); lint clean; `cargo check`/`cargo test --features
    fa-inference` unchanged (206/19, zero Rust files touched); golden replay 6/6; M1-M5 green
    at rest, M6 (R.11-specific) verified RED then reverted.
  - **CORRECTION (WS1 Session H, 2026-08-18):** the bullet above calling v6
    `125_night_circle` "an already-correct R.5 output" is FALSE and is retired at this site,
    the constant's own doc comment (`syncConstants.ts`), the module header (`faSeamFitGate.ts`),
    and the test comment (`faSeamFitGate.test.ts`) — all four citations, per the amendment
    discipline this ledger holds itself to. 372.35 is the exact midpoint of a silence lying
    strictly inside an unscripted run; R.12 (`faRunPlacementGate.ts`) corrects it to 370.75.
    The third conjunct itself was never wrong — its real justification, unchanged by this
    correction, is the measured 0.0301 span confidence that R.11 has no evidence to act on at
    that boundary.
  - **F6 fires on the FA-default flip: NOT shipped this session.** `isFaToggleOn()` is a
    GLOBAL per-machine setting, not per-project — flipping its default would silently retime
    every existing project's next Apply Sync for any user with FA capability and a model
    already present, with no per-project consent gate. Real fail-clean measurements taken
    anyway: absent model 266.7µs, missing `ORT_DYLIB_PATH` near-instant, corrupted model
    (real 1.26 GiB size) 77.43s in the DEBUG build `tauri:dev` actually uses (5.25s release)
    — a previously unmeasured, non-trivial per-call tax on top of the existing ~231s v6/~76s
    173 inference figures (restated, not re-measured this session).

- **2026-08-17 — WS1 Session E: R.10 BUILT, items 10 and 11 CLOSED, the Zero-Defect
  Register down to 3 — all R.11.** Production code: `src/services/faUnspokenGate.ts` (new,
  pure), `syncConstants.ts` (the named constant), `App.tsx` (wiring + one new skip reason).
  `faAnchors.ts` byte-identical (sha256 `b61e94cb…`); `faChunkPlan.ts`, `snapBoundaries.ts`,
  `silenceDetector.ts`, `faGate.ts`, the Hirschberg aligner and all Rust untouched. FA gate
  stays OFF (R-AD). Full write-up: §11's Session E block; ruling **R-AH** in
  `sync-pipeline-v2-plan.md`.
  - **Step 1 re-validated Session C's discriminant before anything was built on it**, since
    R.5 had moved 224 v6 word confidences. It survives unchanged: 2/2 true positives, 0
    false positives over 649, an 850× margin — and all eight `matched === false` segments
    have a bit-identical `maxWordConfidence`. The structural reason is the durable one:
    conjunct (1) reads only Whisper tokens and script text, which R.5 does not touch. The
    0.65 inversion did not repeat.
  - **`faChunkPlan.ts` was the wrong expected surface and it is structurally impossible** —
    R.10's signal is FA's per-word confidence, and the chunk planner runs before inference.
    The rule ships as a new pure service instead, exactly as its own spec always said ("a
    drop/skip gate layered on FA's output").
  - **Behaviour: drop, by forcing `matched: false` and letting the EXISTING skip path run.**
    No new machinery — `filterToCoveredSegments` → `snapCoveredBoundaries` →
    `headExtendFirstSegment` is the sequence every Whisper run already exercises. Verified,
    not asserted: 0 partition violations, max boundary gap 1.14e-13, Σ duration =
    `audioDuration` on all three corpora. The preceding survivor absorbs the span. The qi
    contract is untouched because the gate runs after inference — refuting Session C's
    prediction that this would be the build's highest-risk part.
  - **Locked user work is not at risk, by a subset property rather than a mitigation:**
    conjunct (1) makes R.10's firing set a strict subset of what the shipped FA-gate-OFF
    default already drops. `phase4-baseline-173-skipped.csv`, committed long before this
    session, already lists exactly these two segments at exactly these indices.
  - `R10_MAX_WORD_CONF = 5e-4`, its own constant per the owner directive, derived as the
    geometric midpoint √(1.7248e-05 × 1.4653e-02) = 5.0273e-04 — not fitted.
  - **RESULT.** 649 → 647 committed boundaries; 3 changed (2 dropped, 1 moved), all 173; v6
    and spanish bit-identical. Item 10 resolves at **0.00**, residual 0.000s; item 11 is not
    committed at all, which was always its ear-correct outcome. **0 FA word rows differ** —
    R.10 needs no new inference. All three R.11 register entries unmoved.
  - **THE R-Z 0.769/0.778 PAIR IS RESOLVED, AND R-Z WAS RIGHT.** Every figure reproduces
    exactly — against the FA-token alignment. Session C measured the Whisper-token alignment
    and recorded them as premise failures. Both measurements were sound; they were of
    different quantities, and §11's Session C entry is corrected accordingly. This is the
    **second instance** (third counting one inside this session) of the same failure mode as
    the 0.65 inversion, so it is now a named rule: *a measurement only refutes another
    measurement if it was taken on the same artifact, and the artifact must be named next to
    the number.*
  - **One gate defect R.10 exposed, fixed in the same commit.** `loadAnchorPathInputs` had
    been relying on `-segments.csv` being the complete pre-skip parse — true only while FA
    skipped nothing. It would have fed a shorter array and flipped 173's chunk digest: a
    false alarm blaming `faAnchors.ts` for a change two stages downstream. Both readings were
    measured before the fix was written; the fixture pair is now merged by `segmentIndex`.
  - Register: items 10 and 11 converted to positive assertions — item 11 is the register's
    first **ABSENCE** assertion, checked in both directions. `REGISTER_HIGH_WATER` 5 → 3.
    Gate 21+1skip → **23 + 1 skipped**. M1/M2/M3/M5 RED (M5 for the fourth consecutive
    re-pin), M4 a true no-op by chunk-plan byte equality on all three corpora.
  - Verification: `npm test` 84 files / 2173 passed / 2 skipped; lint clean; `cargo check`
    and `cargo test --features fa-inference` clean, 206 passed / 19 ignored; golden replay
    6/6 with `phase4-baseline-*.csv` byte-identical.

- **2026-08-17 — WS1 Session D: R.5 BUILT (first build session of the Zero-Defect Program),
  the OV3 triage absorbed, and a pre-registered owner hypothesis refuted by the build.**
  Production code: `src/services/faChunkPlan.ts` only — `faAnchors.ts` byte-identical
  (sha256 `b61e94cb…`), `snapBoundaries.ts`/`silenceDetector.ts`/`faGate.ts`/`fa/text.rs`
  untouched. FA gate stays OFF (R-AD). Full write-up: §11's Session D block; rulings in
  `sync-pipeline-v2-plan.md`'s "WS1 SESSION D RULINGS".
  - **Session C's R.5 detection threshold did not survive contact with production code.**
    The 0.65 fuzzy-containment cut was measured with a Python `SequenceMatcher` proxy;
    against the production matcher the ten true recitations score 0.2500–0.6000 and the 38
    false candidates 0.0000–0.4000 — overlapping AND inverted. No threshold exists. Replaced
    by a threshold-free structural test, `qiHole == 0` (zero unmatched SCRIPT words opposite
    the run): **10/10 recall, 0/38 false positives** across all three corpora, with every
    true positive at exactly 0 and the nearest false positive at 1.
  - **The specced "CTC wildcard" is not reachable** — `fa_viterbi.rs` is standard CTC with a
    blank symbol and no wildcard label. R.5 ships as EXCISION of the span from the chunk
    window, which is acoustically the same thing and lives entirely in `faChunkPlan.ts`.
    Chunk windows stop being contiguous; verified legal against `align_chunked`'s own
    windowed-output invariants rather than assumed. Model P is untouched.
  - **Items 4 and 5 RESOLVE, residual 0.000s** at 931.40 and 130.96, and converted from
    KNOWN_BAD to positive assertions. 8/649 boundaries move, all v6; 173 and spanish chunk
    plans bit-identical; **all 8 land exactly on the Whisper-committed value**, which R.5
    never reads. Word rows 88/3874. Real ONNX re-capture, driver validated byte-for-byte
    against the previous capture first, determinism control bit-identical.
  - **The owner's Level-N hypothesis for `226_four_scouts` was pre-registered at 671.18 and
    REFUTED** — R.5 fired on the adjacent recitation and the boundary did not move (actual
    670.24, difference −0.94s). Reported as the null result it is.
  - **Both OV3 triage defects are R.11, not R.5 and not a new rule — R.12 stays free.** Both
    are item 7's root cause (a chunk window whose text does not fit its audio):
    `abysmal_opinion`'s chunk ranks **2nd of 381** on fit, worse than item 7's own 11th.
    Consequence: Session C's 10-member sibling census used the SYMPTOM signature and misses
    both, so **Session F must re-derive it from the FIT signal**.
  - **`protection_failure` scored CORRECT by ear** — a member of the 44 movers that is not a
    defect. Membership in the 44 is suspicion, not guilt; corroborates R-AA's narrowing.
  - Register schema gains `id` + `origin`; `REGISTER_HIGH_WATER` 5 → 7 → 5 in one commit
    (raised for the two new defects, lowered when items 4/5 closed); roster 7 → 9.
  - Gate re-pinned: 31 changed fields / 16 rows, **0 unexpected**; 19+1skip → 21+1skip.
    M1/M2/M3/M5 RED, M4 a true no-op by chunk-plan equality. `npm test` 83/2148/2 skipped;
    lint clean; `cargo check`/`cargo test --features fa-inference` clean, 206 passed / 19
    ignored; **golden replay 6/6, `phase4-baseline-*.csv` byte-identical**.

- **2026-08-16/17 — WS1 Session C: the ear pass closes, three owner decisions overridden,
  the Zero-Defect Register built and made machine-checkable, two blocking diagnoses
  measured.** No production code: `git diff` over `src/`/`src-tauri/` is empty except
  `scripts/phase4-fa-replay.test.ts`. FA gate stays OFF. Full write-up: §11's Session C
  block; rulings R-AB..R-AF in `sync-pipeline-v2-plan.md`'s "WS1 SESSION C RULINGS".
  - **R-AB/R-AC (aliases RC1/RC4)** — Tier 2 satisfied, Tier 1 12/12 with the disclosed
    unscored control accepted. The **ordering defect is recorded**: Tier 1 was scored
    first, spending Tier 2's blinding. Result stands; blinded-tier-first is binding on the
    next draw (session H).
  - **R-AD (OV1) overrides RC2 — the FA default flip is DEFERRED**, not cancelled, to the
    final act of Stage 1, released by an **empty register**. Defaulting onto five known ear
    failures contradicts the zero-defect goal (the same pattern R4 already ruled against one
    level down); RC2 also silently overrode R7 and R-S(iii) on the ~231s runtime, now
    re-opened; and R-N/Step T mean the flip is inert today anyway.
  - **R-AE (OV2) overrides R-V's placement — item 7 / R.11 is pulled INTO Stage 1.**
  - **R-AF (OV3) overrides RC3 — the three candidates are TRIAGED, not parked.** ~75s of
    listening; blinded 5-row list (3 candidates + 2 controls) drawn in §11.
  - **Stage 1's "zero defects" is scoped to en/es, in the lock gate text itself** — fr/pt/de
    normalization Rules 1-5 have never been exercised against real audio.
  - **The register is now a test.** `KNOWN_BAD` IS the Zero-Defect Register: a skipped
    `register is EMPTY` test is the Stage 1 lock's machine check; `REGISTER_HIGH_WATER`
    makes growth loud; `REGISTER_ROSTER` + `CLOSED_BY_POSITIVE_ASSERTION` make an entry
    convertible but not deletable. Item 9 converted to a real positive assertion at 65.12.
    Gate **13 → 19 passing + 1 skipped**, and **M5 re-proved RED** after the extension.
  - **Diagnosis A — R.10 has a clean discriminant, and two R-Z premises are wrong.**
    Measured on the real production aligner across four input variants: `perilous_realms`
    scores `alignConfidence` **0.000**, not 0.778, and `blue_monkey` **0.000**, not 1.000 —
    so the thief/victim adjacency that motivated R-Z **does not exist**; and the
    `== 1.000` conjunct is **331/447 on v6**, not degenerate. R.10's own "7/7 words
    `needsReview`" signal has an unmeasured base rate of **16/649**. New rule —
    `matched === false` ∧ `maxWordConfidence < 5e-4` ∧ `wordCount >= 2` — fires on
    **exactly 2 of 649, 2/2 TP, 0 FP**, margin **850×**, threshold derived as the geometric
    midpoint. Respec written to buildable depth.
  - **Diagnosis B — item 7 is a chunk-window defect, not a word-seam defect.** Whisper
    transcribes **nothing** in the 1.60s between "one" (449.64) and "brush" (451.24); the
    R.1 anchor at 451.70 splits segment 152's words 5/4 across two chunks, handing the first
    window text whose audio lies past its end. **Sibling class: 10 of 646** (vs 39 healthy
    midpoint boundaries that do sit in a silence). **Fix lands in `faChunkPlan.ts` —
    X1 does NOT fire**; `snapBoundaries.ts` is computing correctly from bad input.
    Measured warning for session F: a symmetric "veto multi-seam silences" rule would hit
    **62.9% of v6 silences**.
  - **R.5 spec to buildable depth.** Detection is unclaimed Whisper-token runs — **10/10
    recall on v6's ten "Level N" recitations**, matching Step K's independent count — plus
    a fuzzy-containment term that gives **0 false positives** across all three corpora.
    Both real cases measured end-to-end for the first time.
  - **X2 FLAGGED:** `blue_monkey` sits in item 7's sibling class and in the worst chunk-fit
    outlier, so R.10 (session E) must land before R.11 (session F) re-measures. X1, X3, X4
    clear. Stale count corrected: FA recovers **3+3+2** Whisper-unmatched segments, not
    3+3+1.
  - **Program to Stage 1 lock sequenced D→I** with per-session dependencies, register
    entries closed, gate behaviour and acceptance tests, plus the standing D–F requirements.

- **2026-08-16 — WS1 Session B.1: the seam-REGION reading adopted (R-AA), 16 moved
  boundaries narrowed to 4, gate re-pinned a second time and re-proved against M5.** The
  session Session B's own premise check asked for. Full write-up: §11's Session B.1 block;
  R-AA and the amendments to R-U and R-X in `sync-pipeline-v2-plan.md`.
  - **R-AA amends R-U's seam DEFINITION only** — a seam is the interval
    `[tokens[i-1].endSec, tokens[i].startSec]`, spanned when it overlaps the silence as a
    closed interval, replacing the instant `tokens[i].startSec` under strict containment.
    R-U's mechanism (structural veto before any distance is computed) is unchanged and was
    not reopened; the three wider rules R-U rejected stay rejected. `src/services/
    faAnchors.ts` only. `SEAM_INTERIOR_EPSILON` removed — under closed-interval overlap it
    could only act as a tolerance, which is the thing this rule exists to remove.
  - **Why it is the more faithful reading, not just the cheaper one.** The instant is an
    artifact of gapless decoding; where a real inter-token gap exists (537/200/31 adjacent
    pairs) the seam IS the gap, and a silence sitting cleanly inside it — the ideal
    boundary marker — spanned no instant and was vetoed. So was a silence whose `endSec`
    is exactly the token onset, i.e. R.1(c) agreement at distance 0.000s.
  - **Blast radius: 4/649 (0.6%) against a 69/649 bound**, a strict subset of the instant
    reading's 16, re-measured from Session B's own captured FA inference for this reading —
    which the shipped veto-then-select code reproduces chunk-for-chunk on all three
    corpora. Item 6 still resolves to **174.74** exactly; item 7 and the V6 seam control
    still unmoved; item 11 `blue_monkey` no longer moves at all. 12 of Session B's 13
    fixture edits reverted to their pre-Session-B values.
  - **Exit S6 cleared on measurement.** The enrichment survives the narrowing and
    concentrates in what survives: 3 of the 4 movers are in the known >0.5s FA-vs-Whisper
    disagreement set (11.1×, p = 0.0011) against 3 of the 12 dropped. The 12 dropped are
    recorded as named candidate defects, three of them in that set, left unfixed on the
    record rather than vanishing.
  - **Premise corrections found while measuring, both stated in §11.** (1) The seam-region
    reading does NOT degenerate to the instant-strict reading on gapless pairs — it
    degenerates to the CLOSED instant test, and the difference is real on this corpus (7
    coincidence acceptances). (2) The "45 >0.5s / 25 >1.0s" FA-vs-Whisper sets quoted since
    580ba0f are **44 / 24**; the extra row cleared its threshold only on the stale
    pre-616abb2 spanish fixture.
  - **Gate: 13/13 green at rest after the second re-pin, RED under M5** (and M1/M2/M3);
    M4 reconfirmed a true no-op by chunk-plan equality on all three corpora, not by colour.
    Item 6's positive assertion at 174.74 has survived both re-pins untouched.
  - **R-X lists redrawn** (12 scored + 1 disclosed control; 8 blinded, 1:1 arms) and
    Session B's superseded. ~9 min of listening. FA gate stays OFF; not listened to.
  - Verification: `npm test` 83 files / 2133 passed / 1 skipped (+3 new); lint clean;
    `cargo check --features fa-inference` clean; `cargo test --features fa-inference` 206
    passed / 19 ignored; golden replay 6/6 unchanged and unmodified; FA replay gate 13/13.

- **2026-08-16 — WS1 Session B: the zero-seam rejection rule (R-U) implemented, measured
  before it was built, and the FA replay gate re-pinned without being de-fanged.** First
  session since `616abb2` authorised to write production code, and it wrote it in exactly
  one file. Full write-up: §11's Session B block; six rulings (R-U, R-V + new rule R.11,
  R-W, R-X, R-Y, R-Z) in `sync-pipeline-v2-plan.md`.
  - **R-U replaces R-R's unbuildable clause with a structural VETO.** A silence spanning
    no token seam is rejected as a boundary candidate regardless of proximity.
    `ANCHOR_AGREEMENT_SEC` keeps only its selection job; **no distance comparison decides
    identity any more**. This is the worked example of `CLAUDE.md` §4's "timestamps may
    measure distance; they must never decide identity" — the invariant named this failure
    class before the measurement found it. `src/services/faAnchors.ts` only; no tuning
    constant added.
  - **Measured with real ONNX inference BEFORE implementation (R-Y), and the measurement
    describes the shipped code.** 16/649 boundaries moved (6 v6, 10 173, 0 spanish) against
    A.5's 179/649 upper bound, all inside the at-risk set that bound describes. **Item 6
    resolves to 174.74 exactly** — the ear-correct value, residual 0.000s. Item 7 is
    bit-identical at 449.20 (R-V predicted it; `faAnchors.ts` cannot reach it, hence new
    defect class R.11). The V6 seam 150/151 control did not move. All five stop-and-rule
    exits clear. Buckets: 0 under 0.5s, 4 at 0.5–1.0s, 12 above 1.0s; 15 later, 1 earlier;
    5.4× enriched against the 45 known >0.5s FA-vs-Whisper movers.
  - **The re-capture driver was validated against the fixtures it was about to overwrite.**
    Fed the previous capture's own words it reproduced all three committed
    `phase4-fa-second-baseline-*-segments.csv` files byte-for-byte, and a determinism
    control reproduced 1660 word timings bit-identically. Only then were the fixtures
    regenerated. A.5's KNOWN-STALE marker on the Spanish file is cleared — it now shows the
    live 65.12.
  - **Gate re-pinned to 13 tests and re-mutated: M1/M2/M3/M5 still RED.** M5 is the one
    that matters (the items-6/7 error class at a currently-correct boundary) and it is now
    caught twice, including by a NAMED_WINDOWS row that names the boundary. M4 reconfirmed
    a true no-op by chunk-plan equality, not by the gate staying green. Item 6 left
    KNOWN_BAD for a POSITIVE assertion pinned at 174.74 — the file's only correctness
    assertion; item 9 left because 616abb2 closed it and the fixture finally shows it.
  - **PREMISE CHECK, unresolved and owner-facing: R-U's seam DEFINITION was never ruled
    on.** The shipped instant-and-strict reading over-rejects a silence sitting cleanly in
    a real inter-word gap — the opposite of the stated intent. The seam-REGION reading was
    measured this session at **69/649 upper bound and 4/649 actual movers, a strict subset
    of the shipped 16**, reaching the same 174.74 on item 6. Shipped as measured anyway,
    deliberately, because R-U was ruled on the 179/649 profile and every exit was
    calibrated to it. §11(h).
  - **R-X's two listening lists are drawn but NOT listened to** — that is Session C's, and
    the owner's. ~18 min. FA gate stays OFF; golden replay 6/6 unchanged.

- **2026-08-16 — WS1 Session A.5: R-R found not buildable as written, FA replay gate made
  to bite, blast radius measured, items 6/7 separated (no fix, no tuning, gate stays OFF).**
  Feasibility and instrumentation checkpoint per owner brief. **Session B is now BLOCKED on
  an owner ruling, not on engineering time.** Full write-up: §11 item 6's ADDENDUM 4;
  independence definition, provenance map and the owner's four options in
  `sync-pipeline-v2-plan.md`'s "R-R FEASIBILITY FINDINGS" block, placed directly after R-R.
  - **R-R's amended R.1(c) is not satisfiable against this token stream (exit E1).** It
    requires the silence to fall in "the matched word's own token-to-token gap"; Whisper
    turbo emits a gapless partition — adjacent-token gap is exactly 0.000s for 3451/3988
    (v6), 1635/1835 (173), 331/362 (spanish) pairs — and 451 of 481 accepted anchors
    (93.8%) have no silence in their own gap, items 6 and 7 among them. Seam-CONTAINMENT
    rules do work and reject both culpable anchors; the genuinely independent third source
    R-R(2) presupposes exists only as FA's own output, i.e. only in a two-pass design at
    ~2x FA wall-clock. **Nothing implemented; the owner rules.**
  - **The FA replay gate did not cover the code it names.** M1-M5 mutations of
    `findAgreeingSilence` all left it green, M5 (the items-6/7 regression, reproduced at a
    currently-correct boundary) included, because the gate imported nothing from `src/`.
    Extended (+4 tests, 8 → 12) to replay the anchor path through the real
    `computeRuns`/`computeFaChunkPlan`, still fully offline. M1/M2/M3/M5 now go red; M4 is
    proved to be an unexercisable no-op on this corpus rather than a hole. Matrix and
    design rationale in §9.
  - **Blast radius: 179 (27.6%) to 636 (98.0%) of 649 FA-committed boundaries** depending
    on which index rule is chosen — exact upper bounds from a chunk-plan diff, no FA run
    needed. **R-S's 12/12 fresh-listening bar does not survive (exit E3)** except for the
    narrowest option; four restructuring options with listening-time estimates offered to
    the owner, none taken. Magnitude buckets deliberately NOT produced — the only rigorous
    offline bound is non-discriminating, and inventing one would be worse than saying so.
  - **Items 6 and 7 are two mechanisms, not one.** Item 6: cross-anchor bracketing
    CONFIRMED (run 38 = `[173.12, 174.96]`, 1.84s for 5 words), with the full 0.55s → 1.83s
    arithmetic closed end-to-end — FA puts "of" at 173.32 vs Whisper's 173.87, and that
    0.55s flips `snapBoundaries.ts`'s choice between two adjacent silences whose midpoints
    are 172.91 and 174.74. Item 7: the amplification does NOT apply — 449.20 is FA's own
    word-seam midpoint with no snap involved, so the word error IS the boundary error.
    The bracketing anchors are also not "independently clean" in either case; both are
    exactly what a seam-containment test rejects.
  - **Fixture disposition:** the `phase4-fa-second-baseline-*` family (6 CSVs) RETAINED,
    not deleted or refreshed — it is load-bearing for the gate, and only one row of one
    file (Spanish `023_scylla_six_sailors`, 66.73 vs current 65.12) is stale. Marked in
    `scripts/fixtures/README.md`, which also had its now-false "read by nothing" note
    corrected.
  - **Doc sweep:** the item-8/item-9 mislabel does NOT exist in any committed doc (Session
    A's brief only). 642/639 extended with the reconciling third quantity, **649**.
    Session A's citation of a non-existent `scripts/fixtures/README.md` changelog, and one
    loose 457.72-vs-457.83 phrasing, both corrected. **R.10's detection signal spot-checked
    and found not to separate item 10** (its `alignConfidence == 1.000` conjunct is
    degenerate on v6 — constant across all 447 segments) while mis-firing on item 9;
    flagged for the owner, not rewritten.
  - **No `src/`/`src-tauri/` behavior-bearing file changed.** All temporary mutations
    reverted; `git diff` over `src/` and `src-tauri/` empty. Only
    `scripts/phase4-fa-replay.test.ts` (the gate) changed on the code side.

- **2026-08-16 — WS1 Session A: nine owner rulings recorded, CLAUDE.md invariant
  sharpened, FA replay gate built, true anchor exposure measured (no fix, no tuning,
  gate stays OFF).** Checkpoint task per owner brief — record rulings and build the
  regression gate the items-6/7 fix (Session B) needs to exist before it lands; does
  NOT implement that fix. Full write-up: §11 item 6's ADDENDUM 3 (rulings + anchor
  exposure); `sync-pipeline-v2-plan.md`'s R-R/R-S/R-T/R4/R.10 entries; `CLAUDE.md` §4.
  Summary:
  - **Nine owner rulings recorded** (R1-R9 in the owner's own numbering; R-R/R-S/R-T
    in `sync-pipeline-v2-plan.md`'s own ruling-letter sequence, next free after R-Q):
    items 6/7 fix decided (rewrite `findAgreeingSilence` on token indices, two
    independent passes — merges the plan doc's fix-options 1+2, explicitly rejects
    3 and 4); CLAUDE.md's timestamp invariant sharpened and made scope-global; a
    companion rule to R.5 specified as **R.10** (scripted text never spoken — items
    10/11's mechanism); both R.5 and R.10 pulled into Stage 1's lock gate (reverses a
    2026-08-15 decision); fr/de/pt corpus formally deferred out of Stage 1 with the
    Rules-1-5-unexercised risk carried forward explicitly; an FA-default acceptance
    bar fixed (12/12 fresh listen, zero >1.0s boundaries, runtime resolved); V6's
    ~231s runtime accepted for the opt-in toggle, not the default;
    `DOCUMENTATION_AUDIT_REPORT.md` confirmed to stay untracked.
  - **FA baselines validated at HEAD, not refreshed — the task's own premise that
    Spanish would be stale was checked and found not to hold.** Re-ran
    `measure-forced-alignment-hf.py` (the same capture path 580ba0f used, confirmed
    from `scripts/fixtures/README.md`'s "Forced-alignment fixture (R-H)" section — that
    file has no changelog section; corrected 2026-08-16, Session A.5) for all three corpora against the
    committed `phase4-baseline-*-segments.csv` windows. Result: **0/3857 (v6),
    0/1645 (173), 0/247 (spanish) differing word rows — all three byte-identical to
    the committed fixtures, including Spanish.** Reason: this fixture family
    (`phase4-fa-baseline-*-words.csv`/`phase4-fa-tokens-*.json`, "port-fidelity
    reference") uses fixed per-segment pad-sec-3.0 windows and never calls
    `faChunkPlan.ts`'s `attributeByIndex` at all — 616abb2's fix cannot have touched
    it. The Spanish movement 616abb2 actually measured (66.73→65.12) was in the
    OTHER FA fixture family (`phase4-fa-second-baseline-spanish-segments.csv`, "R-H
    second baseline," a real production-chunk-plan capture) — that fixture predates
    616abb2 and, being "read by nothing" per its own README section until this
    session's new gate, was never regenerated; it still shows the pre-fix 66.73.
    Not refreshed (would need a real Rust ONNX capture, out of this session's scope)
    — documented as a known-stale evidence artifact instead, in the new gate's own
    KNOWN_BAD manifest (item 9, `status: 'fixed'`, not asserted against the stale
    fixture value).
  - **New FA replay gate: `scripts/phase4-fa-replay.test.ts`** (8 tests, all passing,
    fully offline). Pins the `phase4-fa-second-baseline-*` fixtures' structural shape
    (row/skip counts, Model P contiguity, corpus-start/end) and a KNOWN_BAD manifest
    (items 4/5/6/7/10/11, current FA value vs. ear-correct, sourced from `docs/work-
    in-progress.md`'s own mechanism table) so Session B's fix shows as a named,
    expected diff. V6 seam 150/151 (154/155, the Phase 3c control) represented with
    all three quantities (committed-correct 457.83, raw Whisper token 457.72,
    FA 457.81). Golden replay untouched, confirmed still 6/6.
  - **True anchor exposure measured, replacing the 116/639 heuristic proxy** — full
    numbers in §11 item 6's ADDENDUM 3. Headline: 481 real accepted anchors across all
    three corpora (not the proxy's over-counted candidate pool); 0/481 have a literally
    competing silence at the same token (falsifies the "two silences compete" mental
    model); 481/481 (100%, structural) have R.1(a)/(b) tracing to the identical single
    Whisper token — the real, universal circularity condition, now a certified count.
    Mover-overlap ((d) in the ruling) is stated as genuinely inconclusive — the real
    items-6/7 driver is an unmeasured cross-anchor pattern (two independently-clean
    anchors bracketing a spurious short run), flagged as open work for Session B rather
    than forced into a number a noisy first attempt didn't support. The 642-vs-639
    boundary-count discrepancy is resolved: both are correct for different countable
    quantities (642 = Σ Whisper-kept segments per corpus; 639 = 642 − 3 interior
    pairwise boundaries), not a computational error.
  - **Verification:** `npm test`, `npm run lint`, `cargo check --features fa-inference`,
    `cargo test --features fa-inference`, golden replay (6/6) and the new FA replay
    gate (8/8) all re-run clean after this session's edits — exact counts in this
    session's own commit message. No `src/`/`src-tauri/` behavior-bearing file changed;
    the one temporary instrumentation edit (`faAnchors.ts`, Step 5) was reverted —
    `git diff src/services/faAnchors.ts` empty, confirmed.

- **2026-08-16 — FA ear-pass root-cause diagnosis (diagnosis only; no fix, no tuning,
  gate stays OFF).** The owner's 12-item ear pass came back 5 correct / 7 wrong. This pass
  attributes a mechanism to all 12 and chases the three named leads. Full write-up: §11
  item 6's addendum above; R.5 consequence recorded at §7 item 2. Summary:
  - **Four mechanisms, seven failures, none unexplained.** (1) unscripted audio with no
    segment → items 4, 5; (2) scripted text never spoken → items 10, 11; (3) false anchor
    from Whisper timestamp smear across a real silence (`faAnchors.ts`'s
    `findAgreeingSilence` agrees on a raw token *timestamp*, so two of the "three sources"
    are the same Whisper output) → items 6, 7; (4) `faChunkPlan.ts` forced-split
    empty-`qi` attribution bug → item 9.
  - **Owner's item-5 experiment: RUN, and it corrects.** Control reproduces the committed
    second baseline exactly (280/280 chunks, 0/3874 word rows differing). With a segment
    added for the extra audio, `043_night_migration` commits at **130.96** and
    `308_scouts_leading` at **931.40** — the ear-correct values exactly; 4 of 447 shared
    boundaries moved, 443 unchanged.
  - **Lead B closed: the repeated 1.83s is coincidence.** 2 occurrences in 642 shared
    boundaries (0.30s and 0.23s each occur 4×); the two are reached by different arithmetic
    (silence-midpoint minus silence-midpoint vs. silence-midpoint minus unsnapped onset);
    and 1.83s is 91.5 model frames, not an integer. Real finding underneath it:
    `snapBoundaries` amplifies a 0.55s word error into a 1.83s boundary error by selecting
    a different silence.
  - **Lead C closed: both "FA later" items were misfiled.** Item 10 is mechanism (2), not a
    head/warmup case; item 9 is mechanism (4), not a Spanish-model effect — forced splits
    are 1/6 runs on Spanish and 0/330, 0/149 on v6/173. Transferable fr/de/pt risk is low
    anchor density, not the acoustic model.
  - **R.5 IMPLICATION (may promote it from deferred):** measured to prevent **2 of 7**
    failures, and measured NOT to prevent items 6, 7, 9, 10, 11. Real and worth building;
    not a cure-all, and not a substitute for the confidence-gate / false-anchor /
    forced-split work.
  - **Categorisation:** 2 of 7 inherent to forced alignment (but detectable — FA flagged
    7/7 words on both), 2 of 7 missing-feature (R.5), 3 of 7 ordinary bugs in the
    chunk-plan layer FA does not own.
  - **Hybrid assessed as an option, not recommended:** FA's own `needsReview` separates the
    sample perfectly (all 7 failures have both boundary-adjacent words < 0.013; 4 of 5
    correct have both ≥ 0.68; item 12 the sole false positive at 0.0147), so a per-boundary
    source choice needs no new plumbing — but n=12, non-randomly chosen, and fixing
    mechanisms (3)/(4) would change the confidence landscape it keys off.
  - *Method/verification:* all instrumentation reverted (a temporary `#[ignore]`d
    `fa_onnx.rs` runner and a temporary vitest harness, both deleted). Two real
    `align_chunked` passes over V6 audio via `ORT_DYLIB_PATH` set inline. `npm test` 2107
    passed / 1 skipped, `npm run lint` clean, `cargo check --features fa-inference` clean,
    golden replay 6/6 — all unchanged. No `src/`/`src-tauri/` file touched; no fixture
    re-baselined; `isFaGateOpen()` still OFF.

- **2026-08-16 — D.-1 criterion 2 evidence dossier assembled (evidence only, no
  ruling).** Contract IN + Contract 1→2 (Part J) verified guarantee-by-guarantee
  is one of five items blocking Stage 1's lock (plan doc line ~3876). This pass
  assembled the code/test/measurement evidence for all 21 rows (9 in Contract IN,
  12 in Contract 1→2) so the owner's own inspection (D.-1 criterion 2 requires
  it be by owner, not inferred from green tests) is a short read instead of a
  fresh dig — delivered in-chat, not committed as a repo file (task constraint).
  Full summary and key findings: §9 above, entry dated 2026-08-16. No `src/` or
  `src-tauri/` file touched; verification suite re-run clean (see §9 entry).
  Does not change the Stage 1 lock status — still NOT PASSED, still blocked on
  (a) smear thresholds, (b) fr/de/pt corpus, (e) regression checklist, per the
  plan doc's own blocking list.

- **2026-08-16 — FA quality measurement: R-H second-baseline pass + R-Q fixture
  regeneration.** Scope: measure and report only — no `src/`/`src-tauri/` change, no
  parameter tuning, no default-gate flip (`isFaGateOpen()` stays OFF). Full write-up:
  §11 item 6 above (measurement) and the R-H/R-Q status block immediately after it
  (fixture regeneration). Summary:
  - **R-H second baseline (item 6):** real Rust `fa::fa_align` capture (jonatasgrosman
    ONNX, real production `computeFaChunkPlan` chunk plans, script-word-index
    attribution) against all three corpus projects' real audio, via a scratch
    `tauri::test::mock_context` harness mirroring `fa_durable_wav_live.rs`'s own pattern
    (not committed). V6: 280 chunks/133.1s/3874 words/447 kept/0 skipped. 173: 118
    chunks/75.7s/1660 words/175 kept/0 skipped. Spanish: 5 chunks/13.6s/249 words/27
    kept/0 skipped. Output run through the real production pipeline
    (`filterMalformedTokens`→`alignScenestoTranscript`→`distributeSegmentTimes`
    (`'forced-alignment'`)→`applyAnchorBasedTiming`→coverage gate→
    `filterToCoveredSegments`→`snapCoveredBoundaries`→`headExtendFirstSegment`), written
    additively to `scripts/fixtures/phase4-fa-second-baseline-{v6,173,spanish}-
    {segments,skipped}.csv` — the existing Whisper `phase4-baseline-*-segments.csv`
    stays byte-identical (confirmed: golden replay 6/6, unchanged).
    Per-boundary diff (642 tag-matched boundaries): median |Δ|=0.00s, p90
    0.285s/0.270s/0.105s (v6/173/spanish), max=8.67s, 45 boundaries >0.5s, 25 >1.0s.
    FA produced 0 skips on all three projects, recovering 7 segments Whisper's turbo
    transcript never matched at all (V6 ×3, 173 ×3, Spanish ×1) — explains the single
    largest mover (v6 `030_watching_older_hunters`, Δ+8.67s: FA's recovery of the 3
    immediately-preceding skipped segments shifts where this segment's own start falls,
    not a standalone FA error). V6 seam 153→154 reproduced fresh: FA 457.81s vs.
    committed/owner-correct 457.83s (Δ0.02s) — matches the prior smoke-test session's
    figure exactly. `needsReview` word rate 15.2%/10.5%/10.0% (v6/173/spanish), skewed
    toward short function words; bucketed by min-segment-word-confidence, boundary
    displacement shows NO clean monotonic relationship to confidence (<0.05 conf mean
    |Δ|=0.120s n=316 vs. ≥0.9 conf mean |Δ|=0.112s n=216) — a genuine non-finding, stated
    as such rather than massaged. Hyphenated-compound segments: mean |Δ|=0.145s (n=28)
    vs. 0.107s (n=614 non-hyphenated) — thin signal, not conclusive at this n. A 12-item
    ear-verification listening list (§11, after item 6) is queued for the owner —
    prioritized by ruling impact, not raw delta size.
  - **R-Q (fixture regeneration):** `scripts/fixtures/phase4-fa-tokens-{v6,173,
    spanish}.json`/`phase4-fa-baseline-{v6,173,spanish}-words.csv` (the R-H
    port-fidelity fixture pair `phase4-handoff-replay-sync.test.ts`'s own describe block
    reads) regenerated via `scripts/measure-forced-alignment-hf.py` against the real
    jonatasgrosman/wav2vec2-large-xlsr-53-{english,spanish} models (Apache-2.0),
    superseding the original MMS-FA (CC-BY-NC-4.0, barred by Decision 3) capture. Same
    pad-sec-3.0/neighbour-midpoint measurement convention as the original — model
    backend only changed. V6: 444 segments/384.2s (154.6s one-time model load + 229.2s
    align)/3857 words/0 failed/0 dropped. 173: 172 segments/120.9s (3.8s load, HF cache
    warm)/1645 words/0 failed/0 dropped. Spanish: 26 segments/242.9s (228.5s load, first
    Spanish-model load this session)/247 words/0 failed/1 segment with an unrepresentable
    word. Golden replay re-run after the swap: still 6/6, including the R-H describe
    block's own internal-consistency assertions (CSV-matches-JSON, required caveat
    substrings) against the new jonatasgrosman-derived pair.
  - **Not done, explicitly out of scope:** low-confidence characterization beyond the
    correlation stated above; any FA parameter change; any default-gate flip. Runtime UX
    (~231s smoke-test / ~133-243s this session's per-project figures, no progress UI) is
    a separate, already-known deferred item (the sync loading screen), not a new finding.
  Verified: `npm test`, `npm run lint`, `cargo check --features fa-inference`, golden
  replay 6/6 (all confirmed after fixture regeneration and scratch-file cleanup — see
  this commit's own numbers).

- **2026-08-15 — FA-on smoke test: first real forced-alignment run, end to end.**
  Scope: prove ONE real `fa_align_production` call completes against real audio through the
  real running app — not a quality assessment, not the R-H second baseline (§11 item 6,
  still open). **Zero `src/`/`src-tauri/` changes.**
  **Provisioning inventory (all found already in place from a prior session — nothing
  downloaded this session):** all 5 `fa-models/<lang>/model.onnx` already sat at
  `fa_model_path`'s resolved location (`~/Library/Application Support/com.kinetix.pro-studio/
  fa-models/<lang>/model.onnx`, per `fa.rs`'s `app_local_data_dir` ladder); `en`'s SHA-256
  matched `scripts/fixtures/fa-onnx-manifest.json` exactly (`48a3c2e1…6240f`,
  `jonatasgrosman/wav2vec2-large-xlsr-53-english` @ revision `569a6236…`). No onnxruntime
  dylib in Homebrew/system, but `libonnxruntime.1.23.2.dylib` (x86_64, matching this
  machine) existed inside `.work-phase4/spike-runtime/venv/lib/python3.11/site-packages/
  onnxruntime/capi/` — an unrelated prior-session Python venv, gitignored. The V6 corpus
  project itself was already loaded in the app's own WebKit localStorage (`kinetix:project:
  77d465c0-…`, 447 segments, cached Whisper transcript) from prior work; its `project.language`
  was unset (predates the field) — set to `en` via the Settings language dropdown this
  session, a real one-time UI action, not a code change.
  **Two real failures hit and fixed, both operational, neither a code bug:**
  (1) `npm run tauri:dev:fa`'s window belonged to a *different*, stale pre-existing
  `target/release/bundle/macos/Kinetix Pro Studio.app` process that macOS kept
  auto-relaunching by bundle id (`com.kinetix.pro-studio`) whenever the computer-use tooling
  touched it — the actual `tauri dev` debug process never got a window under the granted
  bundle identity. Fixed by building a real bundle (`npx tauri build --debug -f
  fa-inference`, ~53s) and driving that .app directly instead of the raw `cargo run` binary.
  (2) First real Apply Sync attempt reached `fa_align_production` and failed clean —
  `Error: failed to initialize onnxruntime: ORT_DYLIB_PATH not set` (surfaced via
  `forcedAlignmentRun.ts`'s `console.warn`, caught in WKWebView devtools) — because the
  app process had been launched raw via Bash *before* `ORT_DYLIB_PATH` was set in that
  shell; `runForcedAlignmentForSync`'s fail-clean contract worked exactly as designed
  (silent fallback to Whisper timing, `anchorSource: 'whisper'` on all 447 segments, sync
  still completed 447/447 — no half-committed state, no crash). Fixed by relaunching the
  same `.app/Contents/MacOS/app` binary with `ORT_DYLIB_PATH=<path> ` prefixed directly on
  the exec line, then re-triggering Apply Sync (re-staging `Script.txt` via the file-replace
  picker, since `isStagedEmpty` disables the button once a project has nothing newly staged).
  **Reproduction, exact commands:**
  ```
  npx tauri build --debug -f fa-inference   # ~53s, produces src-tauri/target/debug/bundle/macos/Kinetix Pro Studio.app
  ORT_DYLIB_PATH="<repo>/.work-phase4/spike-runtime/venv/lib/python3.11/site-packages/onnxruntime/capi/libonnxruntime.1.23.2.dylib" \
    "<repo>/src-tauri/target/debug/bundle/macos/Kinetix Pro Studio.app/Contents/MacOS/app"
  ```
  **Result (second attempt, ORT_DYLIB_PATH correctly set):** `fa_align_production` returned
  `Done`, wall-clock ~231s for 447 segments over ~1421s of audio (the chunk plan that run
  actually sent to Rust was 280 chunks — "447 chunks" here was a mislabel, corrected
  2026-08-16, WS1 Session B.1). All 447 segments committed
  `anchorSource: 'forced-alignment'`; `Project.faWordTimings` persisted, 3874 words (vs.
  4517 raw Whisper tokens — expected, FA's output has no punctuation-only tokens). 0/3874
  monotonicity violations, 0 negative-duration words, first word at 0.24s, last at 1420.38s
  (project audio duration 1421.29s — the WAV is 22,740,695 frames at 16 kHz = 1421.2934s;
  this line read 1421.26 until it was corrected 2026-08-16, WS1 Session B.1) — both inside
  bounds. 596/3874 words (~15%) flagged
  `needsReview` (confidence < 0.3), concentrated in a few short low-confidence spans (e.g.
  first word "you": confidence 0.00075) — a real quality signal, not investigated further
  per this session's scope. Spot check against the cached Whisper tokens: ballpark-consistent
  word-for-word in the 452–460s window checked, off by tens to a few hundred ms per word
  (expected — two different alignment methods), no wild divergence. **V6 seam observation
  (array index 153→154 in this project's current numbering, not "150" — this project has
  been resynced/renumbered since the historical measurement docs were written): FA gave
  457.81s. Known owner-ear-tested-correct value (§11 item 8 above): 457.83s (0.02s off).
  Documented Whisper baseline: 457.72s "call" end — the raw per-word Whisper token END for
  "call", a WORD-level quantity, NOT a competing candidate for this segment boundary (the
  0.09s below is a distance between two different kinds of number, not a boundary error).
  Observation only — no
  conclusion about which method is "better," per this session's explicit scope.**
  Gates run this session (confirming zero regressions from zero `src/`/`src-tauri/` changes):
  `npm test`, `npm run lint`, `cargo check --features fa-inference`, golden replay — all
  unchanged from `e6c0e29`'s baseline (see this session's own commit for exact numbers).
  **Follow-on:** §11 item 1's own entry above records this run inline. Item 6 (R-H second
  golden-baseline pass, per-boundary quality review) is next and still fully open — this
  session proves the plumbing works, not that the timing is good.

- **2026-08-15 — WS1 consolidation close-out audit.** Full
  audit-fix-reaudit pass against the 2026-08-14 consolidation (`9cf5867`).
  Iteration 1 found FAILs across 8 of 12 checks (~35 dangling references to
  the 29 deleted files across source comments/plan doc/tracker; `CLAUDE.md`
  asserting a since-deleted `measurements/README.md`; no archive-retrieval
  section; no stated summarization-vs-lossless-merge disclosure; no
  single-tracker enforcement test; a "Part Z"/"Part M" naming error; a
  "30 files"/29-actual miscount; a stale `sync-pipeline-v2-plan.md` Phase
  Status row contradicting Part M). All were fixed except one: `project-state.md`
  (protected, out of scope for this pass) still points its Task 5 rulings at
  the deleted `ws1-master-roadmap.md` — a genuine, permanent blocker under this
  pass's hard constraints, not a partial pass being declared clean. Iteration 2
  re-audit: that one FAIL only. Added: `docs/work-in-progress.md` §12 (deleted-
  file archive, all 29 files, retrieval commands), a summarization-transform
  disclosure in this file's header, restored and corrected
  `docs/ws1-sync-pipeline/measurements/README.md`, `scripts/ws1-single-tracker.test.ts`
  (C7 guard, allowlist of 3). Gates: `cargo test` 76 (unconditional) + 150
  (fa-inference, 19 ignored) passed 0 failed; `cargo clippy --features
  fa-inference` 4 pre-existing warnings, 0 new; `npm run lint` clean; `npm
  test` 80 files/1943 passed/1 skipped; golden replay 6/6. All non-doc changes
  were comments-only (`git diff --stat 9cf5867 -- src/ src-tauri/`: 7 files,
  93 insertions/34 deletions, zero logic lines).

- **2026-08-15 — Phase 3b/3c ownership assigned.** Phases 3b (multilingual
  text cleaner: FR/DE/PT, §10) and 3c (hyphen tokenisation mismatch, §11 item
  8) now have an owner: the project owner. Intended execution order: 3b → 3c
  → Phase 3 production wiring (§11 item 1) → Stage 1 lock (§11 item 12-13).
  Recorded on both rows of `sync-pipeline-v2-plan.md`'s Phase Status table
  (lines 23-24). No change to either phase's NOT STARTED status or scope.

- **2026-08-15 — R.5 decision: DEFER.** Closed the "whether/when" half of §7
  item 2 (destination was already closed, R-E). Ship the capability-gated
  production-wiring slice (§11 item 1) without R.5; build R.5 next, before
  Phase 4. Reopens when §11 item 1 or item 6 starts. Full reasoning appended
  to `sync-pipeline-v2-plan.md` Part M. Does not touch scope (owner ruling D1
  still mandates R.5 for Task 5) — only sequencing.

- **2026-08-15 — Gate sequencing decided (Option B); `fa-inference` dev
  build flag wired.** Owner chose Option B for §11 item 1's production-wiring
  slice: gate stays off through 3b/3c, flips once after 3c lands, boundary
  set measured exactly once. Item 1 itself (the `App.tsx:2792-2837` branch on
  `isFaGateOpen()`, the `faWordTimings` writer) is therefore **not started
  this pass** — it is blocked on Phase 3c by the owner's own sequencing
  choice, not by any remaining technical gap. Separately, discovered that
  `isFaGateOpen()` alone is insufficient even for local testing: `fa_align`
  (`fa.rs:806`) is compiled out entirely unless the `fa-inference` Cargo
  feature is enabled, and neither `tauri:dev` nor `tauri:build` (`package.json`)
  passed it. Owner approved enabling it for local dev only (not production
  builds, which stay decided separately per R-N). Added `npm run tauri:dev:fa`
  (`tauri dev -f fa-inference`, `package.json`), documented in `CLAUDE.md` §2.
  `ort` uses `load-dynamic` (`Cargo.toml:39-41`) so this compiles with no
  onnxruntime dylib present; an FA call at runtime with `ORT_DYLIB_PATH` unset
  fails cleanly. Verified: `cargo test` 76 passed (unconditional, unchanged);
  `cargo test --features fa-inference` 150 passed/19 ignored (unchanged);
  `cargo clippy --features fa-inference` 4 pre-existing warnings, 0 new
  (unchanged); `npm run lint` clean; `npm test` 80 files/1943 passed/1 skipped
  (unchanged). All four counts match the 2026-08-15 close-out audit baseline
  exactly — this pass added a dev script and doc lines only, no logic changed.

- **2026-08-15 — Phase 3b Slice 1: `faTextNormalize.ts` wired into
  `faChunkPlan.ts` (plumbing only, zero behavior change).** Gives
  `faTextNormalize.ts` its first real caller (previously 40/40 tests, zero
  callers — §10). `computeFaChunkPlanWithAttribution` (and `computeFaChunkPlan`,
  which delegates to it) gained two new trailing optional parameters,
  `languageCode`/`vocabChars`: when BOTH are supplied, the assembled chunk
  plan's `text` is additionally passed through
  `normalizeForForcedAlignment`; when either is omitted — every call site
  today, `App.tsx`'s dev-only production-shaped call included — the code path
  is untouched. Applied as a single post-process step after chunk assembly,
  so it cannot influence the `qi` word-index arithmetic
  (`computeRunContext`/`runQiRanges`), which is computed beforehand from raw
  text via the (untouched) `textNormalize.ts`/`canonicalize` path.
  **Pre-wiring investigation finding (see below), not a fix:** traced
  `FaChunk.text` end to end and found it was already built from RAW
  `seg.text`/raw token text in both attribution modes, never routed through
  `canonicalize` — diacritics already reach Rust's `fa_align_dev` call
  intact, and Rust's own `src-tauri/src/fa/text.rs` (a committed
  byte-identical port of this same TS module) already normalizes it
  correctly there. §10's action-item wording ("text handed to the Rust CTC
  decoder... instead of `textNormalize.ts`'s ASCII-stripped form") overstates
  what was actually happening — `canonicalize` is used inside
  `faChunkPlan.ts` only for `qi` word-count bookkeeping, never for the
  `chunk.text` payload. This slice is therefore additive (a new JS-side
  capability), not a live-bug fix. **No ASCII-only downstream assumption
  found** — no byte-vs-char offset field exists on `FaChunk` (only
  `startSec`/`endSec`/`text`), and `qi` arithmetic is word-count-based via
  JS's own `\s+` splitting, decoupled from `chunk.text`'s content. **Files:**
  `src/services/faChunkPlan.ts`, `src/services/faChunkPlan.test.ts` (3 new
  tests: production call shape unaffected; explicit-`undefined` byte-
  identical to omitted; opt-in path actually normalizes, proving the wiring
  is a real call site). **No fr/de/pt rules added** — out of scope for this
  slice per H.5. **Verified:** `cargo test` 76/76 (unchanged); `cargo test
  --features fa-inference` 150/19 ignored (unchanged); `cargo clippy
  --features fa-inference` 4 pre-existing warnings, 0 new (unchanged); `npm
  run lint` clean; `npm test` 80 files/1946 passed/1 skipped (+3 new tests
  over the 1943/1 baseline, zero regressions); `scripts/phase4-step-x-verify.py`
  re-run: 13 recommended for CI / 1 kept out (C10, unchanged — the harness
  has grown since the C1-C12 shorthand this task was briefed against to
  C01a/C01b through C13, but the invariant it protects, "only C10 stays
  CI-out," is exactly what was found, so nothing regressed). `git diff
  --stat`: 2 files (`faChunkPlan.ts`, `faChunkPlan.test.ts`), no other file
  touched, no protected file implicated.

- **2026-08-15 — Verification-harness vocabulary corrected (bookkeeping, no
  harness change).** `scripts/phase4-step-x-verify.py`'s real checks are
  **C01a, C01b, C02, C03, C04, C05, C06, C07, C08, C09, C10, C11, C12, C13 —
  14 checks total**, not "C1-C12." **Correct expected result, live-verified
  this pass:** 13 of the 14 (C01a, C01b, C02-C09, C11, C12, C13) pass BOTH
  halves (poison + real) and are RECOMMENDED FOR CI; **C10 is the one
  permitted non-passer** — its poison half passes but its recall half fails
  by design (0/4 against the owner's own word-shift verdicts; the harness's
  own HONEST EVIDENCE RANKING grades it D, "failed validation — do not put
  it in CI"), so it is deliberately KEPT OUT, not blocked/erroring. The
  script's own exit code is 1 on a clean run for this exact reason (C10's
  known-failing recall half), and that is the correct, expected exit code —
  not a harness malfunction. The "C1-C12, expect 11 pass and C1 blocked"
  phrasing that has circulated in recent task prompts is **stale shorthand**
  predating the harness's growth to its current C01a/C01b-split, C13-added
  shape (`scripts/phase4-step-x-verify.py:633-634` dates the split/addition
  itself) — it does not match any real run of the script and forces a
  mismatch report every time it's quoted. Future sessions: quote this entry
  (or re-run the script and read its own "RECOMMENDED FOR CI (13)" / "KEPT
  OUT (1)" summary lines), not the old shorthand. No change to
  `scripts/phase4-step-x-verify.py` itself.

- **2026-08-15 — Phase 3b Slice 2: French elision, Part H.5 Rule 1
  (`src/services/faTextNormalize.ts` + `src-tauri/src/fa/text.rs`).**
  **Decision, stated before implementation:** an elided word (`l'oiseau`,
  `l'homme`, `qu'il`, ...) stays ONE token, never split at the apostrophe.
  Justified from the Rust port (the byte-identical-port authority, per this
  slice's own hard constraint): neither `normalizeForForcedAlignment`'s
  `/\s+/` split nor `text.rs`'s `is_js_whitespace`-based
  `split_js_whitespace` treats apostrophe as a separator — an elided form
  was already one token before this rule (the pre-existing fixture entry
  `"l'élève où était-il"` already round-tripped unchanged). Splitting would
  insert a synthetic CTC word-delimiter (`|`) where French speech has no
  pause. **What actually changed:** a straight apostrophe (already in every
  vocab) and a curly one (already generically folded by `FOLD_TARGETS`) both
  already worked with zero code change — the one real gap was a grave accent
  (`` ` ``, U+0060) used as an apostrophe typo/OCR substitute, which nothing
  previously folded. Added a French-only (language-keyed, per H.5's own
  mandate), shape-gated fold: prefix ∈ {qu, l, d, j, n, s, t, m, c} +
  backtick + a vowel-or-mute-h (the grammatical elision shape) folds the
  backtick to `'`; anything not matching that exact shape (wrong position,
  wrong following character, or non-French) is left untouched, so it cannot
  misfire on a fixed compound like `aujourd'hui` (apostrophe not word-
  initial) or on non-French text. **Both sides changed together, same
  commit, proven to agree**: `text.rs` gained the identical
  `fold_french_elision_backtick`/`is_french_elision_follower`/
  `FRENCH_ELISION_PREFIXES` port, operating on `char`s (not bytes) to avoid a
  multi-byte slice panic on an accented follower. Agreement is enforced by
  the existing `fixture_parity` hard gate (`text.rs`), not asserted only in
  prose: 12 new corpus cases added to `scripts/generate-fa-text-fixture.ts`
  (positives — straight/curly/backtick apostrophe parity, mute-h `l'homme`,
  the full 9-prefix set in one phrase, the two-letter `qu` prefix; negatives
  — aspirate-h `le hibou` staying two tokens, the `aujourd'hui`/`aujourd`hui`
  mid-word-apostrophe non-elision pair, a consonant-follower non-shape
  `j`veux`, and an `en`-language-gated non-fold), fixture regenerated from
  the live TS module (`npx tsx scripts/generate-fa-text-fixture.ts`,
  48 entries), and `fa::text::fixture_parity::
  fixture_matches_rust_port_for_every_entry_all_five_languages` passes
  against all 48 including the 12 new ones. **Files:**
  `src/services/faTextNormalize.ts`, `src-tauri/src/fa/text.rs`,
  `src/services/faTextNormalize.test.ts` (+9 unit tests),
  `scripts/generate-fa-text-fixture.ts` (+12 corpus cases, +1 required-
  coverage substring), `scripts/fixtures/fa-text-normalize-fixture.json`
  (regenerated). **Untouched, verified:** `textNormalize.ts`/`canonicalize`
  (not imported by this diff); the Slice 1 byte-identical chunk-plan test
  (`faChunkPlan.test.ts`, unrelated call path, still passes). **No
  contractions/numbers/currency** — out of scope per this slice's own
  boundary; Phase 3b's remaining rules stay unstarted (§10 item 3).
  **Verified:** `cargo test` 84/84 (was 76/76, +8 new Rust unit tests, 0
  regressions); `cargo test --features fa-inference` 158/19 ignored (was
  150/19 ignored, +8, 0 regressions); `cargo clippy --features fa-inference`
  4 pre-existing warnings, 0 new (unchanged); `npm run lint` clean; `npm
  test` 80 files/1968 passed/1 skipped (was 1946/1, +22: 9 explicit TS unit
  tests + 12 fixture-driven drift-guard cases + 1 coverage-cross-check
  addition, 0 regressions); golden replay
  (`scripts/phase4-handoff-replay-sync.test.ts`) 6/6, unchanged;
  `scripts/phase4-step-x-verify.py` re-run: 13 recommended for CI / 1 kept
  out (C10), unchanged from the corrected baseline above — this slice
  touches neither sync timing nor the structural-check harness's own
  inputs. `git diff --stat`: `faTextNormalize.ts`, `text.rs`,
  `faTextNormalize.test.ts`, `generate-fa-text-fixture.ts`,
  `fa-text-normalize-fixture.json` — 5 files, no protected file touched.

- **2026-08-15 — Phase 3b Slice 3: Spanish cardinal numbers 0-30, Part H.5
  Rule 2 (`src/services/faTextNormalize.ts` + `src-tauri/src/fa/text.rs`).**
  **Gap verified empirically before any code was written**, per this slice's
  own instruction: ran `"23"`, `"1,5"`, `"2.5"`, `"100 %"`, `"5"` through both
  `normalizeWord` (TS) and `normalize_word` (Rust) for en/fr/de/pt against
  the real committed vocabs. Result, byte-identical on both sides: every
  digit-bearing word is unconditionally DROPPED (not passed through, not
  altered) in all four languages, with `text: ""` — confirming the reason
  string already baked into both implementations
  (`"contains a digit — number expansion is Phase 3b, out of scope"`) was a
  live, not stale, TODO. **Correction to H.5's own framing:** H.5 describes
  this as an English-vs-others asymmetry (digit expansion works for English,
  breaks other languages) — that's true of the OLD `textNormalize.ts`
  canonicalizer, but `faTextNormalize.ts` has never had digit expansion for
  ANY language, including English; it is a universal drop, not an asymmetry.
  Traced the consumers (`fa_onnx.rs`'s `word_merge_e2e`/`words_per_chunk`):
  internally self-consistent today (nothing crashes), but unlike R.5 (where
  D25 found a real product rule — wildcard span assigned to the preceding
  segment — already absorbs the reachable case), there is no compensating
  mechanism for a dropped digit word — a real spoken number is audible in
  the recording but absent from forced alignment's target text, which can
  smear a neighboring word's timestamp. Currently invisible in production
  (FA has zero production callers, gated off until Phase 3b+3c both land —
  §11 item 1), but a genuine gap Phase 3b exists to close before that gate
  flips. **Scope, proposed and approved before coding (owner sign-off,
  2026-08-15):** bare cardinal integers 0-30, Spanish (`es`) only — every
  one of these is a SINGLE Spanish orthographic word (`dieciséis`,
  `veintitrés`, `treinta`); 31+ requires a space-linked `"y"` compound
  (`treinta y uno`), i.e. one input token expanding into MULTIPLE output
  words, which would break the one-`FaWordResult`/`WordResult`-per-CTC-word
  invariant `word_merge_e2e`/`words_per_chunk` already rely on — deferred to
  a later slice pending a separate decision on multi-word output, not
  implemented here. **Language justified by "unblocks real content," not
  "hardest shape":** Spanish is the only FA language with a real corpus
  today (`Spanish Project/`, 27 segments, already transcribed), and
  `sync-pipeline-v2-plan.md` H.8 states explicitly "Spanish preferred for
  number-word coverage." German compound cardinals, French's 70/80/90
  irregularities, and Portuguese gender agreement are harder and are exactly
  what later slices are for. **Explicitly out of scope, who owns it:** 31-99
  and all multi-word compounds (a later Spanish slice, pending the
  multi-word-output decision above); decimals, thousands separators,
  currency, `%`, ordinals, negative numbers (later slices, no owner
  assigned yet); en/fr/de/pt (dormant, per H.5's own stated allowance, no
  owner assigned yet). Contractions/currency untouched per this slice's own
  hard constraint. **Consequence logged, not silently skipped:**
  `sync-pipeline-v2-plan.md:381` has a standing trigger — Spanish boundary
  listening becomes mandatory before Stage 1 can lock the moment any
  Spanish-specific normalization code ships. This slice trips it. Does not
  block Phase 3b (Stage 1 lock is already blocked on several other things —
  §1), but is now an owner obligation, not a silent gap. **Implementation:**
  `expandSpanishCardinal`/`SPANISH_CARDINALS_0_30` (TS) and
  `expand_spanish_cardinal`/`SPANISH_CARDINALS_0_30` (Rust) — a bare
  all-digit token (no sign, no separators, no leading zero beyond a literal
  `"0"`) in range 0-30 is looked up and substituted for `stripped` BEFORE
  the existing digit-check-drop, so the vocab-membership check runs on the
  spelled word instead; anything not matching (31+, decimals, leading
  zeros, non-Spanish) falls through to the pre-existing drop path,
  byte-for-byte unchanged. **Both sides changed together, same commit,
  proven to agree** via the existing `fixture_parity` hard gate: 8 new
  corpus cases added to `scripts/generate-fa-text-fixture.ts` (positives —
  `"23"`, boundary `"0"`, boundary `"30"`, expansion inside a phrase;
  negatives — `"31"` multi-word compound, `"2.5"` decimal, `"05"` leading
  zero, `"23"` under `fr` as an unaffected-language control), fixture
  regenerated from the live TS module (56 entries), and
  `fa::text::fixture_parity::fixture_matches_rust_port_for_every_entry_all_five_languages`
  passes against all 56 including the 8 new ones. **Files:**
  `src/services/faTextNormalize.ts`, `src-tauri/src/fa/text.rs`,
  `src/services/faTextNormalize.test.ts` (+12 unit tests, table-driven),
  `scripts/generate-fa-text-fixture.ts` (+8 corpus cases, +1
  required-coverage substring), `scripts/fixtures/fa-text-normalize-fixture.json`
  (regenerated). **Untouched, verified:** `textNormalize.ts`/`canonicalize`
  (not imported by this diff, not in `git diff --stat`); the Slice 1
  byte-identical English chunk-plan test (`faChunkPlan.test.ts`) still
  passes unchanged. **No 31+/decimals/thousands-separators/currency/
  contractions** — out of scope per this slice's own boundary; Phase 3b's
  remaining rules stay unstarted. **Verified:** `cargo test` 92/92 (was
  84/84, +8 new Rust unit tests, 0 regressions); `cargo test --features
  fa-inference` 166/19 ignored (was 158/19 ignored, +8, 0 regressions);
  `cargo clippy --all-targets` 4 pre-existing warnings, 0 new (unchanged);
  `npm run lint` clean; `npm test` 80 files/1988 passed/1 skipped (was
  1968/1, +20: 12 explicit TS unit tests + 8 fixture-driven drift-guard
  cases, 0 regressions); golden replay
  (`scripts/phase4-handoff-replay-sync.test.ts`) 6/6, unchanged;
  `scripts/phase4-step-x-verify.py` re-run: 13 recommended for CI / 1 kept
  out (C10), exit code 1 — unchanged, this slice touches neither sync timing
  nor the structural-check harness's own inputs. `git diff --stat`:
  `faTextNormalize.ts`, `text.rs`, `faTextNormalize.test.ts`,
  `generate-fa-text-fixture.ts`, `fa-text-normalize-fixture.json` — 5 files,
  no protected file touched.

- **2026-08-15 — Part H.5 framing correction (docs-only, follow-up to Phase 3b
  Slice 3).** The prior slice's changelog entry (above) had already concluded
  H.5 misdescribes the digit-expansion defect as an English-vs-others
  asymmetry when `faTextNormalize.ts` never had digit expansion for any
  language — but only updated the "Rule 2 unstarted" forward-references
  (`sync-pipeline-v2-plan.md`'s status table, line 23); the underlying framing
  prose in Part H.5 itself (`sync-pipeline-v2-plan.md:4087-4112`, shifted
  +20 from the original `4067-4092` by the 2026-08-15 Phase 3c scope-addition
  insertion, see this changelog's own later entry) was left
  unedited. Verified by direct code inspection this run: `textNormalize.ts`
  genuinely has all five capabilities H.5 attributes to it (`digitTokenToWords`,
  `$`->`dollars` currency expansion, a thousands-separator strip, an English
  `CONTRACTIONS` list, and the `NUMBER_WORDS` hyphen carve-out — all real,
  grep-confirmed) — H.5 is not wrong about that module. The error is that
  Phase 3b's actual Rules (1: French elision, 2: Spanish cardinals) land in
  `faTextNormalize.ts`, a module its own header comment calls "DELIBERATELY
  PARALLEL to `textNormalize.ts`'s `canonicalize`, not built on top of it"
  (created 2026-08-12, R-Q, predates H.5's prose) — which started with NONE of
  those five capabilities, for ANY language including English (grep-confirmed:
  no `CONTRACTIONS`, no currency symbol handling, no `NUMBER_WORDS`/hyphen
  logic anywhere in the file; every digit-bearing word uniformly dropped
  pre-Rule-2). **All four content bullets (digit expansion, currency,
  thousands separators, contractions) plus the closing byte-identical GATE
  line were misframed the same way** — each correctly describes
  `textNormalize.ts` but was being read as the capability baseline for the
  module Phase 3b is actually extending, which has no such baseline. The
  thousands-separator bullet differs in failure mode, not just module: in
  `textNormalize.ts` a non-English separator format is actively MANGLED
  (corrupted token); in `faTextNormalize.ts` it is dropped wholesale
  (unrepresentable, not mangled) — same missing capability, different symptom.
  **Fix applied:** appended a correction block directly under H.5's existing
  GATE line in `sync-pipeline-v2-plan.md`, naming each bullet's real referent
  module and stating `faTextNormalize.ts`'s actual (empty) starting state per
  capability, without deleting or rewriting the original prose (same
  preserve-original-append-correction convention already used elsewhere in
  that document, e.g. row 3's STALE/Part-M pattern). No code changed this
  entry — docs-only. `git diff --stat`: `sync-pipeline-v2-plan.md`,
  `work-in-progress.md` (this entry) — 2 files, no protected file touched,
  no test suite affected (cargo 92/92, `--features fa-inference` 166/19
  ignored, clippy 4 pre-existing/0 new, `npm test` 1988/1 skipped, golden
  replay 6/6, `phase4-step-x-verify.py` 13 in/C10 out/exit 1 — all identical
  to Phase 3b Slice 3's baseline, unaffected by a docs-only change).

- **2026-08-15 — Phase 3b remainder audit, one bundled pass (decision +
  audit + Rule 3).** Three parts, same session, same commit.

  **1. Multi-word-output decision recorded (owner sign-off): (b), single-
  word-output only, permanently.** Before recording it, surfaced a
  consequence not present in the original 31+/French scoping and confirmed
  it against code: `textNormalize.ts`'s own currency rule
  (`t.replace(/\$\s?(\d+)/g, ' $1 dollars ')`, `textNormalize.ts:239`) turns
  a single glued token (`"$5"`) into 2 output words (`"5 dollars"`) — an
  architecture `faTextNormalize.ts`'s 1:1-per-token `normalizeWord` cannot
  replicate. So decision (b) forecloses currency expansion too, not just
  Spanish 31+/French "et"-numbers. Recorded in full in H.5
  (`sync-pipeline-v2-plan.md:4156-4186`, shifted +20 for the same reason)
  and the Phase 3b tracker row, with
  a reopening criterion (only if a concrete forcing need justifies reworking
  the `FaWordResult`/`WordResult` 1:1 contract and its `fa_onnx.rs`
  consumers together).

  **2. Audit — real inputs through both `canonicalize` and
  `normalizeForForcedAlignment`, all 5 languages, before writing any code.**

  | Category | Tested | Classification |
  |---|---|---|
  | Currency (`$5`, `€10`, `R$5`, `5%`, all 5 langs) | yes | REAL GAP, PERMANENTLY blocked by decision (b) — every glued symbol+digit token needs ≥2 output words in `faTextNormalize.ts`; no code |
  | Contractions (es `del`/`al`, fr `du`, de `zum`/`zur`/`im`/`am`, pt `do`/`da`/`no`/`na`) | yes | NOT A GAP — both normalizers already leave them as one unexpanded token; verified acoustically correct (spoken as one word) and neither's English-only contraction list fires on them; no code |
  | Thousands separators — `faTextNormalize.ts` (`1.234,56` etc, all 5 langs) | yes | REAL GAP, PERMANENTLY blocked by decision (b) — any thousands-separated number is ≥1000, always multi-word; no code |
  | Thousands separators — `textNormalize.ts` (`canonicalize`) | yes | REAL GAP, confirmed still MANGLED (`"1.234,56"` reads digit-by-digit as `"one point two three four five six"`, silently wrong for es/fr/de/pt) — blocked by this pass's own hard constraint (`textNormalize.ts`/`canonicalize` untouched), no owner assigned; no code |
  | French 70-99 hyphen/"et" forms already spelled as words (`quatre-vingt-dix-neuf`, `soixante et onze`) | yes | NOT A GAP — already representable, unchanged; no raw digit is present so no expansion is needed; no code |
  | German compound cardinals already spelled as words (`einunddreißig`, `zweihundertfünfzig`) | yes | NOT A GAP — already representable, unchanged (existing ß->ss substitution handles it); no code |
  | German cardinal DIGITS 0-30 (new finding) | yes | REAL GAP, IN SCOPE under decision (b) — German has no structural multi-word wall at 30 (every German cardinal is one concatenated word, arbitrarily far up), so single-word output suffices — **IMPLEMENTED as Rule 3** |
  | Portuguese cardinal DIGITS 0-20ish (new finding) | yes | REAL GAP, blocked — PT-PT/PT-BR spelling fork for 14/16/17/19 (catorze/quatorze, dezasseis/dezesseis, dezassete/dezessete, dezanove/dezenove) is unresolved and no prior project convention exists; not a decision (b) block, a distinct undecided sub-question; no code, no owner |
  | French cardinal digits beyond Rule 1 (new finding) | yes | REAL GAP, blocked — French's "et"-exception structure (21/31/41/51/61/71 use "et", but 81/91 don't) is irregular, not a flat 0-N lookup like Rule 2/3, and needs its own design pass; not safe to freelance under audit-pass time pressure; no code, no owner |
  | Ordinals/percent/decimals/negatives (all langs) | yes (spot-checked) | Not a new finding — already correctly tracked as out-of-scope by `faTextNormalize.ts`'s own SCOPE comment; not one of this audit's 4 named categories; no code |

  **3. Implemented: Rule 3, German cardinal numbers 0-30
  (`src/services/faTextNormalize.ts` + `src-tauri/src/fa/text.rs`).** Same
  shape as Rule 2 (`GERMAN_CARDINALS_0_30`/`expandGermanCardinal`,
  `expand_german_cardinal`), same guard contract (bare digits only, no
  leading zero beyond a literal `"0"`, no sign, no separators, n ≤ 30). Table
  values are the PRE-substitution vocab-safe spelling (`"dreissig"`, not
  `"dreißig"` — German vocab has no `ß`, and the ß->ss substitution runs on
  the raw input only, never on a generated candidate). Cap of 30 is a scope
  choice mirroring Rule 2's already-reviewed shape, not a structural one —
  German has no wall at 30 the way Spanish does at 31; going higher needs
  algorithmic compound generation (hundreds/thousands rules), deferred to a
  future slice as real design work, not a same-pattern extension.
  **Both sides changed together, same commit, proven to agree** via the
  existing `fixture_parity` hard gate: 8 new corpus cases added to
  `scripts/generate-fa-text-fixture.ts` (positives — `"23"`, boundary `"0"`,
  boundary `"30"`, expansion inside a phrase; negatives — `"31"` past the
  scope cap, `"2.5"` decimal, `"05"` leading zero, `"23"` under `pt` as an
  unaffected-language control), fixture regenerated from the live TS module
  (64 entries total, was 56), and
  `fa::text::fixture_parity::fixture_matches_rust_port_for_every_entry_all_five_languages`
  passes against all 64. **Files:** `src/services/faTextNormalize.ts`,
  `src-tauri/src/fa/text.rs`, `src/services/faTextNormalize.test.ts` (+12
  unit tests, table-driven, mirroring Rule 2's exactly),
  `scripts/generate-fa-text-fixture.ts` (+8 corpus cases, +1
  required-coverage substring), `scripts/fixtures/fa-text-normalize-fixture.json`
  (regenerated), plus the two docs above. **Untouched, verified:**
  `textNormalize.ts`/`canonicalize` (not imported by this diff, not in
  `git diff --stat`); the Slice 1 byte-identical English chunk-plan test
  (`faChunkPlan.test.ts`) still passes unchanged.

  **Phase 3b status: NOT COMPLETE.** Rules 1-3 done; currency and thousands
  separators (in `faTextNormalize.ts`) are now closed as PERMANENTLY out of
  scope rather than silently unstarted. Four items remain, none with an
  owner: Portuguese cardinal expansion (locale-variant decision needed),
  French cardinal expansion beyond Rule 1 (irregular-exception design
  needed), the pre-existing Task 5 prerequisite
  (`sync-pipeline-v2-plan.md:3800-3809` — `textNormalize.ts`'s ASCII-only
  fold destroying native diacritic letters for es/fr/de/pt, explicitly
  scoped into Phase 3b by the plan itself, never started), and
  `textNormalize.ts`'s thousands-separator mangling bug (confirmed still
  live this pass). **Phase 3c's first task** (per
  `sync-pipeline-v2-plan.md:3818-3819`, unchanged by this pass): the hyphen-
  asymmetry fix in `textNormalize.ts` (glued mid-call vs. Whisper's two
  tokens) — its own commit, its own re-listen of the verification set, since
  it rewrites the alignment corpus on both sides. **`languageCode` still has
  no production caller, re-confirmed this pass** — `App.tsx`'s only call
  site (`faDevAlign`, `App.tsx:3569`, a `DEV`-gated devtools-only hook) calls
  `computeFaChunkPlan` with 4 arguments, never passing the 5th/6th
  (`languageCode`/`vocabChars`) that would route text through
  `normalizeForForcedAlignment` at all — confirmed by direct read, not
  memory. This is not a silently-dropped item: it is tracked, with an owner,
  as `docs/work-in-progress.md` §11 item 1 (capability-gated production
  wiring), explicitly sequenced to start only after Phase 3b AND 3c both
  land (Option B, 2026-08-15).
  **Verified:** `cargo test` 100/100 (was 92/92, +8 new Rust unit tests, 0
  regressions); `cargo test --features fa-inference` 174/19 ignored (was
  166/19 ignored, +8, 0 regressions); `cargo clippy --all-targets` 4
  pre-existing warnings (2 distinct warnings × 2 build targets), 0 new
  (unchanged); `npm run lint` clean; `npm test` 80 files/2008 passed/1
  skipped (was 1988/1, +20: 12 explicit TS unit tests + 8 fixture-driven
  drift-guard cases, 0 regressions); golden replay
  (`scripts/phase4-handoff-replay-sync.test.ts`) 6/6, unchanged;
  `scripts/phase4-step-x-verify.py` re-run: 13 recommended for CI / 1 kept
  out (C10), exit code 1 — unchanged. `git status`: 7 files changed
  (`docs/work-in-progress.md`, `docs/ws1-sync-pipeline/sync-pipeline-v2-plan.md`,
  `scripts/fixtures/fa-text-normalize-fixture.json`,
  `scripts/generate-fa-text-fixture.ts`, `src-tauri/src/fa/text.rs`,
  `src/services/faTextNormalize.test.ts`, `src/services/faTextNormalize.ts`),
  no protected file touched, no new doc file, scratch audit test file
  (`src/services/__scratch_h5_audit.test.ts`, used to print real normalizer
  outputs during the audit) deleted before this commit.

- **2026-08-15 — Ownership-contradiction fix + Phase 3b scope correction
  (docs-only, follow-up to Rule 3 / commit `06c2bb4`).** Two parts.

  **1. Ownership contradiction, resolved.** The Rule 3 changelog entry above
  said "Four items remain, none with an owner." §3's Master Phase Board and
  `sync-pipeline-v2-plan.md`'s own status table both already carry
  `project owner (assigned 2026-08-15)` in Phase 3b's Owner column — so the
  phase itself was never unowned; the "no owner" wording was describing
  something narrower (no owner distinct from the phase-level assignment)
  but read as a contradiction against the tracker. Fixed by editing §3's 3b
  row (above) and adding an explicit note that remaining sub-items inherit
  Phase 3b's existing phase-level owner rather than being separately
  unowned — no 3b item now reads as unowned. `sync-pipeline-v2-plan.md`'s
  3b status-table cell gets the equivalent correction in the same commit as
  this entry (see its own diff).

  **2. Phase 3b scope correction — code evidence for whether the two
  `textNormalize.ts` items actually belong in 3b.** Rule 3's audit filed
  "the pre-existing Task 5 prerequisite" (diacritic destruction) and
  "`textNormalize.ts`'s thousands-separator MANGLING bug" as open 3b items.
  Traced both through `src/services/faChunkPlan.ts` end to end before
  accepting that framing, per this pass's own instruction to verify rather
  than assume:
    - `chunk.text` — the string that actually reaches forced alignment — is
      RAW `seg.text`, never routed through `canonicalize`/`canonicalizeSceneDoc`.
      Confirmed at the call site, `faChunkPlan.ts:628`
      (`normalizeForForcedAlignment(chunk.text, languageCode, vocabChars).text`),
      and stated as a deliberate design choice in the module's own "TEXT
      DOMAIN" comment (`faChunkPlan.ts:360-371`): raw text yields 569
      representable words matching the whole-file FA reference exactly,
      while `queryWords.join(' ')` (the canonicalize-derived path) yields
      589 because `normalizeSceneDoc` expands "41st" and splits contractions
      differently — routing FA text through `canonicalize` was explicitly
      rejected as changing WHAT IS ALIGNED, not just where it's cut.
    - `canonicalize` (via `normalizeSceneDoc`/`normalize`, both imported
      from `whisperService.ts` at `faChunkPlan.ts:44`) IS reached, but only
      for `qi` word-count bookkeeping — `computeRunContext`'s `tokenWords`
      (`faChunkPlan.ts:106-111`, transcript side) and `queryWords`/`rawTokens`
      (`:117-130`, script side), which decide where a chunk's raw text gets
      CUT, not what the cut text contains.
  **Conclusion, per item:**
    - Diacritic destruction (`textNormalize.ts` `canonicalize` step 10,
      ASCII-fold) does NOT reach the FA model's input text — confirmed, not
      assumed. It CAN shift `qi` word-count boundaries for non-English
      segments (a diacritic mid-word becomes a space, splitting one
      orthographic word into two counted words), which is a chunk-cut-point
      risk, not an FA-input-corruption risk.
    - `textNormalize.ts`'s thousands-separator mangling is the same shape:
      unreachable as FA-input corruption (chunk text is raw), reachable
      only as a `qi`-bookkeeping risk via the same `canonicalize` path.
  **Neither is a Phase 3b item.** Phase 3b's actual surface is
  `faTextNormalize.ts`/`text.rs` — additive, language-keyed rules that never
  touch `canonicalize`. Both items live entirely inside `textNormalize.ts`,
  the file every 3b slice has correctly treated as hard-untouchable (frozen
  English baseline, `CLAUDE.md` Testing section). **Reassigned to Phase 3c.**
  Phase 3c is the one phase already scoped to edit `canonicalize` (the
  hyphen-asymmetry fix, `sync-pipeline-v2-plan.md:3818-3819`) and already
  budgets the cost that any `canonicalize` change requires: "this rewrites
  the alignment corpus on both sides... its own commit with its own
  re-listen of the set. It shifts English token/word indices — the last
  index-shifting event of Stage 1." Bundling these two qi-bookkeeping items
  into that same commit/re-listen avoids paying the index-shift-plus-
  re-listen cost twice; leaving them as standalone Phase 3b items would
  either strand them behind 3b's byte-identical-English gate (which they
  cannot clear without touching `canonicalize`) or force a second,
  redundant corpus re-listen. `sync-pipeline-v2-plan.md`'s Phase 3c section
  gets a correction paragraph recording this in the same commit as this
  entry.
  **Phase 3b's real remaining scope, after this correction:** two items,
  both already covered by Phase 3b's existing phase-level ownership, not
  unowned — Portuguese cardinal expansion (§7 item 6 above, PT-PT/PT-BR
  fork put to the owner this session) and French cardinal expansion beyond
  Rule 1 (irregular "et"-exception design, no code attempted this pass per
  this pass's own instruction not to freelance a design under audit-pass
  time pressure).
  **No code changed by this entry** — `textNormalize.ts` was read, not
  edited, consistent with this pass's explicit constraint not to touch it.
  `git diff --stat` for this entry: `docs/work-in-progress.md`,
  `docs/ws1-sync-pipeline/sync-pipeline-v2-plan.md` — 2 files, no protected
  file touched, no new doc file. Suite baselines unaffected (docs-only,
  same as the Rule 3 commit's own verified numbers: cargo 100/100, `cargo
  test --features fa-inference` 174/19 ignored, clippy 4 pre-existing/0
  new, `npm test` 80 files/2008 passed/1 skipped, golden replay 6/6,
  `phase4-step-x-verify.py` 13 in/C10 out/exit 1).

- **2026-08-15 — Portuguese cardinal numbers 0-20 and 30, Part H.5 Rule 4
  (Phase 3b remainder audit follow-up, PT-BR).** Same shape as Rules 2/3.

  **Owner decision, this session:** the PT-PT/PT-BR spelling fork (§7 item
  6 above) resolved PT-BR. Implemented as
  `PORTUGUESE_CARDINALS_0_30`/`expandPortugueseCardinal` in
  `src/services/faTextNormalize.ts` + `src-tauri/src/fa/text.rs`.

  **Real finding during implementation, not present in the original
  scoping:** Portuguese 21-29 is a THREE-WORD space-linked "e" compound
  (`"vinte e três"`, 23), the same permanent multi-word wall as Spanish
  31+ and French "et"-numbers under decision (b) — Portuguese's wall
  starts at 21, not 31 like Spanish (`"veintitrés"` is one word up to 29).
  So Rule 4's real scope is 0-20 and 30 (22 of the 31 values §7 item 6
  originally described), not the full 0-30 range. §7 item 6 and the H.5
  decision-(b) block are both corrected in this commit to record this,
  rather than silently shipping a narrower rule than what was asked.
  21-29 stays dropped exactly as before, for the same permanent reason
  Spanish 31+ does — verified with a dedicated negative test at both ends
  of the gap (21, 29), not just asserted.

  **Both sides changed together, proven to agree** via the existing
  `fixture_parity` hard gate: 15 new corpus cases added to
  `scripts/generate-fa-text-fixture.ts` (positives — 0, 3, 10, 14, 16, 17,
  19, 20, 30, expansion inside a phrase; negatives — 21 and 29 the
  three-word wall, 31 past the scope cap, 2.5 decimal, 05 leading zero;
  plus one unaffected-language control under fr), fixture regenerated from
  the live TS module (79 entries total, was 64), and
  `fa::text::fixture_parity::fixture_matches_rust_port_for_every_entry_all_five_languages`
  passes against all 79.

  **Housekeeping, same commit:** Rule 3's own "unaffected language"
  control test (TS and Rust) used `pt` as the control — no longer valid
  now that `pt` has its own cardinal rule (coincidentally still passed,
  since `"23"` falls in Portuguese's own 21-29 gap, but for the wrong
  reason). Switched to `fr`, which has no cardinal rule of any kind.

  **Files:** `src/services/faTextNormalize.ts`, `src-tauri/src/fa/text.rs`,
  `src/services/faTextNormalize.test.ts` (+18 unit tests: 9 positive
  table-driven, 1 phrase-survival, 2 negative-wall spot-checks, 1
  scope-cap negative, 1 decimal negative, 1 leading-zero negative, 1
  language-gate negative, plus the Rule 3 control-language fix),
  `scripts/generate-fa-text-fixture.ts` (+15 corpus cases, +1
  required-coverage substring, 1 control-language fix),
  `scripts/fixtures/fa-text-normalize-fixture.json` (regenerated), plus
  the docs above (§7 item 6 resolved, §3 board, plan doc's 3b row and H.5
  decision-(b) block). **Untouched, verified:** `textNormalize.ts`/
  `canonicalize` (not imported by this diff, not in `git diff --stat`);
  the Slice 1 byte-identical English chunk-plan test
  (`faChunkPlan.test.ts`) still passes unchanged.

  **Phase 3b status after this slice: NOT COMPLETE.** One item remains,
  owned (project owner, inherits Phase 3b's existing assignment): French
  cardinal expansion beyond Rule 1, blocked on its own irregular
  "et"-exception design (21/31/41/51/61/71 use "et", 81/91 don't) — not a
  flat lookup like Rules 2-4, not attempted this pass per the explicit
  instruction not to freelance a design under audit-pass time pressure.
  **3b does not close this run.** The pre-existing Task 5 prerequisite
  (diacritic destruction) and `textNormalize.ts`'s thousands-separator
  mangling remain reassigned to Phase 3c (this session's earlier commit),
  not 3b's own exit criterion. `languageCode` still has no production
  caller (§11 item 1, unchanged, sequenced behind Phase 3b AND 3c both
  landing).

  **Verified:** `cargo test` 114/114 (was 100/100, +14 new Rust unit
  tests, 0 regressions); `cargo test --features fa-inference` 188/19
  ignored (was 174/19 ignored, +14, 0 regressions); `cargo clippy
  --all-targets` 4 pre-existing warnings, 0 new (unchanged — re-verified
  against the pre-edit tree via `git stash` to confirm none of the 4 are
  newly introduced); `npm run lint` clean; `npm test` 80 files/2038
  passed/1 skipped (was 2008/1, +30: 18 explicit TS unit tests + 12
  fixture-driven drift-guard cases, 0 regressions); golden replay
  (`scripts/phase4-handoff-replay-sync.test.ts`) 6/6, unchanged;
  `scripts/phase4-step-x-verify.py` re-run: 13 recommended for CI / 1 kept
  out (C10), exit code 1 — unchanged. `git status`: 5 files changed this
  slice plus the same 2 doc files from this session's earlier B/C commit
  — `docs/work-in-progress.md`, `docs/ws1-sync-pipeline/sync-pipeline-v2-plan.md`,
  `scripts/fixtures/fa-text-normalize-fixture.json`,
  `scripts/generate-fa-text-fixture.ts`, `src-tauri/src/fa/text.rs`,
  `src/services/faTextNormalize.test.ts`, `src/services/faTextNormalize.ts`
  — 7 files, no protected file touched, no new doc file.

- **2026-08-15 — French cardinal numbers 0-30 minus 21, Part H.5 Rule 5
  (Phase 3b close).** Same shape as Rules 2-4. Last owned Phase 3b item.

  **Scope surfaced and put to the owner before any code was written, per
  this slice's own instruction.** Two questions, both answered before
  implementation: (1) scope — 0-30 minus 21, vs. Rule 4's 0-20+30
  precedent, vs. 0-20-only; owner chose **0-30 minus 21**. (2) how to treat
  21 — traditional "vingt et un" (3 words, excluded) vs. the 1990-reform
  "vingt-et-un" (1 hyphenated token, includable); owner chose **exclude,
  traditional spelling**, keeping this project off reform orthography with
  no other precedent for it anywhere in this module.

  **The multi-token-output worry that stalled this item since Rule 4 shipped
  is a false alarm — traced through both consumers before implementation,
  not assumed away.** French 17-19 and 22-29 are hyphenated single words
  ("dix-sept", "vingt-trois"), not two-token expansions. Word splitting is
  whitespace-only (`/\s+/` / `is_js_whitespace`) on both sides — hyphen was
  never a separator, so a hyphenated cardinal was always going to be one
  token in. On the decode side, `fa_onnx.rs`'s `merge_char_spans_to_words`
  splits only on the vocab's `|` word-delimiter id, and `-` is an ordinary
  character in the fr vocab (confirmed live: `fa-vocab-fr.json`'s vocab
  object contains `-`) — so a hyphenated cardinal merges back into exactly
  one `WordSpan`. The one-`FaWordResult`/`WordResult`-per-input-token
  contract (decision (b)) holds; `qi` word-count attribution is untouched
  either way, since it derives from `canonicalize`/`normalizeSceneDoc` on
  RAW segment text, never from this module's output
  (`faChunkPlan.ts:360-371,628`, re-confirmed this pass). **Net: no reason
  found to exclude 17-19/22-29, and no reason for this rule to land after
  Phase 3c** — checked directly, not inferred.

  **Phase 3c hyphen-emission interaction — checked, no ordering
  dependency.** The committed fixture already contained hyphenated FA
  output before this rule (`well-known`, `arbeits-platz`, `était-il`, an
  em-dash-to-hyphen fold) — Rule 5 is not the first rule to emit a hyphen.
  Phase 3c's scope is `textNormalize.ts`'s `canonicalize`, a module FA input
  never routes through. 3b → 3c sequencing is unaffected.

  **Rule 1 x Rule 5 ordering — structurally disjoint, no interaction
  possible.** Elision fold fires only on a `prefix + backtick + vowel-or-
  mute-h` shape; cardinal expansion fires only on an all-digit `stripped`
  token. No input can match both shapes at once, so pipeline order between
  them is a non-issue by construction — verified with two co-fire fixture/
  test cases in the same phrase (`` j`ai 17 ans `` -> `j'ai dix-sept ans`;
  `` qu`il a 22 ans `` -> `qu'il a vingt-deux ans`), not just argued in
  prose.

  **No PT-PT/PT-BR-style regional fork exists in French 0-30** (Belgian/
  Swiss "septante"/"huitante"/"nonante" only diverge at 70/80/90, outside
  this scope) — nothing else to decide at this scope beyond the 21 call
  above. "un" is the bare-cardinal citation form (mirrors "uno"/"um"), not
  the feminine "une".

  **Both sides changed together, proven to agree** via the existing
  `fixture_parity` hard gate: 18 new corpus cases added to
  `scripts/generate-fa-text-fixture.ts` (positives — 0, 1, 16, 17, 18, 19,
  20, 22, 29, 30, expansion inside a phrase; negatives — 21 the three-word
  wall, 31 past the scope cap, 2.5 decimal, 05 leading zero; one
  unaffected-language control under `en`; two Rule-1-x-Rule-5 co-fire
  phrases), fixture regenerated from the live TS module (97 entries total,
  was 79), and
  `fa::text::fixture_parity::fixture_matches_rust_port_for_every_entry_all_five_languages`
  passes against all 97.

  **Housekeeping, same commit — continues the pattern Rule 4's own
  housekeeping note already flagged.** Rules 2, 3, and 4's "other languages
  are unaffected" witness tests (TS: `faTextNormalize.test.ts`; Rust:
  `text.rs`'s three `negative_*_expansion_is_language_gated` tests) all used
  `fr` as the control digit's language — valid when written, but Rule 5
  makes `fr` stop being neutral (e.g. `"23"` under `fr` now expands to
  `"vingt-trois"` instead of dropping). All three switched to `en`, plus
  Rule 5's own new control test uses `en` too. Chose `en` specifically
  (not just "whichever language is untaken today") because it is the one
  language this module's own H.5 module comment states will structurally
  never get a cardinal rule — a more durable witness than `fr` or `pt` were,
  which were each eventually claimed by their own rule.

  **Files:** `src/services/faTextNormalize.ts`, `src-tauri/src/fa/text.rs`,
  `src/services/faTextNormalize.test.ts` (+19 unit tests: 10 positive
  table-driven, 1 hyphenated-stays-one-word regression guard, 1
  phrase-survival, 1 negative-wall (21), 1 scope-cap negative (31), 1
  decimal negative, 1 leading-zero negative, 1 language-gate negative
  (switched to `en`), 2 Rule-1 x Rule-5 co-fire, plus the 3 Rule 2/3/4
  control-language fixes), `scripts/generate-fa-text-fixture.ts` (+18
  corpus cases, +1 required-coverage substring, 2 control-language fixes),
  `scripts/fixtures/fa-text-normalize-fixture.json` (regenerated).
  **Untouched, verified:** `textNormalize.ts`/`canonicalize` (not imported
  by this diff, not in `git diff --stat`); the Slice 1 byte-identical
  English chunk-plan test (`faChunkPlan.test.ts`) still passes unchanged.

  **Phase 3b status: DONE — PHASE CLOSED.** Every H.5 rule assigned to this
  phase is now either shipped (Rules 1-5) or permanently out of scope under
  decision (b) (currency, thousands separators, Portuguese 21-29, French
  21). No open Phase 3b item remains. The pre-existing Task 5 prerequisite
  (diacritic destruction) and `textNormalize.ts`'s thousands-separator
  mangling stay reassigned to Phase 3c (prior session's commit) — not a 3b
  exit criterion, unaffected by this closure. **Unblocks Phase 3c**
  (hyphen-asymmetry fix, `sync-pipeline-v2-plan.md:3818-3819`), whose entry
  and the Stage 1 lock gate this closure feeds into are intentionally left
  untouched by this pass — this slice's hard constraint scopes the
  ledger-doc edit to Phase 3b's own row plus this changelog entry only, not
  a re-derivation of every doc that cites Phase 3b's status.

  **Verified:** `cargo check` clean (default + `--features fa-inference`);
  `cargo test` 132/132 (was 114/114, +18 new Rust unit tests, 0
  regressions); `cargo test --features fa-inference` 206 passed/19 ignored
  (was 188/19 ignored, +18, 0 regressions); `cargo clippy --all-targets
  --features fa-inference` 4 pre-existing warnings, 0 new (unchanged); `npm
  run lint` clean; `npm test` 80 files/2075 passed/1 skipped (was 2038/1,
  +37: 19 explicit TS unit tests + 18 fixture-driven drift-guard cases, 0
  regressions); golden replay (`scripts/phase4-handoff-replay-sync.test.ts`)
  6/6, unchanged — did not move, not re-baselined. `git status`: 6 files
  changed — `docs/work-in-progress.md`, `scripts/fixtures/fa-text-normalize-fixture.json`,
  `scripts/generate-fa-text-fixture.ts`, `src-tauri/src/fa/text.rs`,
  `src/services/faTextNormalize.test.ts`, `src/services/faTextNormalize.ts`
  — no protected file touched, no new doc file, nothing moved into or out
  of `scripts/fixtures/`.

- **2026-08-15 — Phase 3c qi-bookkeeping fixes: diacritic-preserving fold +
  thousands/decimal separator inversion, es/fr/de/pt** (the two items
  reassigned here by the Phase 3b remainder audit — `sync-pipeline-v2-plan.md`
  H.5/:3821-3839 scope addition, this doc's own §3/§10). **Hyphen-asymmetry
  itself — Phase 3c's original scope and the actual Stage 1 lock blocker —
  is explicitly OUT OF SCOPE this pass and stays NOT STARTED.**

  **Owner decision surfaced before any code was written.** This session's
  task description framed the hyphen fix as aligning `textNormalize.ts` vs.
  `faTextNormalize.ts` hyphen handling — checked against
  `sync-pipeline-v2-plan.md` directly and found not to match: the real bug is
  `canonicalize()`'s own hyphen-splitting (`resolveHyphen`, the pre-existing
  R1 NUMBER_WORDS carve-out — WS1a, `a3494d4`) vs. real Whisper transcript
  tokenization; it deliberately shifts English token/word indices ("the last
  index-shifting event of Stage 1" — directly in tension with the task's own
  stated byte-identical-English constraint); it has no algorithm specified
  anywhere in the plan yet; and its own process requires a human re-listen of
  the affected boundary set before it's considered safe, which this session
  cannot perform. Put to the owner directly rather than guessed at or
  designed unilaterally. **Decision: skip hyphen-asymmetry this pass** —
  leave it NOT STARTED, as the ledger already and correctly stated. Also
  confirmed with the owner: do NOT implement `faTextNormalize.ts`'s
  thousands-separator gap — permanently foreclosed by the 2026-08-15
  multi-word-output decision (b); no override requested.

  **What shipped: two qi-bookkeeping-only fixes in `textNormalize.ts`'s
  `canonicalize()`**, gated behind a new optional `languageCode?: 'en' |
  'es' | 'fr' | 'de' | 'pt'` parameter — omitted or `'en'` is the exact
  pre-existing code path, byte-for-byte, so the frozen English alignment
  baseline (`CLAUDE.md` Testing invariant) is untouched by construction:
    1. **Thousands/decimal separator inversion.** es/fr/de/pt read
       "1.234,56" as English's "1,234.56"; the prior code applied English's
       rules unconditionally and misread it digit-by-digit ("one point two
       three four five six"). Fixed by swapping which punctuation mark plays
       which role when `languageCode` is one of the four, ahead of the
       existing (untouched) `digitTokenToWords`/`cardinalToWords` expansion.
       Per-language number-WORD translation stays a separate, unstarted gap —
       this fix corrects separator PARSING only, matching the module's
       pre-existing English-words-regardless-of-language convention.
    2. **Diacritic-preserving fold.** Step 10's ASCII-only strip
       (`[^a-z0-9\s-]`) destroyed every native accent for es/fr/de/pt
       ("café" -> "caf"). Broadened to a Unicode-letter-aware class
       (`[^\p{L}0-9\s-]`) under the same language gate.

  **Threaded through to the actual qi-computation call site, not just the
  normalizer.** `languageCode` was already plumbed as far as
  `computeFaChunkPlanWithAttribution`'s post-cut `applyFaTextNormalization`
  step (Phase 3b Slice 1), but never reached `computeRunContext`'s
  `normalize`/`normalizeSceneDoc` calls — the ones that actually produce the
  `qi` word counts chunk boundaries are cut on. Added the same optional
  `languageCode` parameter to `whisperService.ts`'s `canonicalizeForAlignment`/
  `normalize`/`normalizeSceneDoc` and to `faChunkPlan.ts`'s
  `computeRunContext`, and wired `computeFaChunkPlanWithAttribution`'s
  existing `languageCode` argument into that call too. No other call site —
  `whisperService.ts`'s own production Hirschberg matching engine
  (`extractSegmentAlignments`) included — passes a `languageCode` today, so
  live sync matching for any of the 5 supported languages is unaffected; this
  stays exactly the qi-bookkeeping-only fix the plan doc scoped it as.

  **No Rust changes.** `faTextNormalize.ts`/`text.rs` already preserve
  diacritics correctly (a per-character vocab-aware normalizer, not an ASCII
  fold), and its own thousands-separator gap is the permanently-foreclosed
  one above — neither file needed editing.

  **Files:** `src/services/textNormalize.ts` (+`languageCode` param on
  `canonicalize`/`canonicalizeSceneDoc`, language-gated steps 5/6/10),
  `src/services/whisperService.ts` (+`languageCode` param threaded through
  `canonicalizeForAlignment`/`normalize`/`normalizeSceneDoc`),
  `src/services/faChunkPlan.ts` (+`languageCode` param on `computeRunContext`,
  wired from `computeFaChunkPlanWithAttribution`), `src/services/textNormalize.test.ts`
  (+16 unit tests: English-baseline-unchanged guards, separator-inversion
  cases including a combined thousands+decimal case and a digit-by-digit-
  mangling regression guard, diacritic-preservation cases for all 4
  languages), `src/services/faChunkPlan.test.ts` (+2 wiring tests:
  byte-identical when `languageCode` is omitted or explicitly `'en'`; a
  non-English `languageCode` produces a well-formed plan for diacritic +
  inverted-separator text without throwing).

  **Verified:** `npm run lint` clean; `npm test` 80 files/2093 passed/1
  skipped (was 2075/1, +18: 16 in `textNormalize.test.ts` + 2 in
  `faChunkPlan.test.ts`, 0 regressions); `cargo check --features fa-inference`
  clean, `cargo test --features fa-inference` 206 passed/19 ignored,
  unchanged (no Rust file touched, re-run anyway); golden replay
  (`scripts/phase4-handoff-replay-sync.test.ts`) 6/6, unchanged — cannot move,
  since the golden-replay corpus is all-English and no call site in its path
  ever passes a non-`'en'` `languageCode`.

  **Phase 3c status: qi-bookkeeping sub-items DONE. Hyphen-asymmetry — the
  phase's original scope and the actual Stage 1 lock blocker
  (`sync-pipeline-v2-plan.md:3725-3726`) — remains NOT STARTED, unchanged by
  this pass**, owner-deferred (see decision note above; also §3's Master
  Phase Board row, updated in this same commit). `git status`: 5 files
  changed (3 source, 2 test) — no protected file touched, no new doc file,
  nothing moved into or out of `scripts/fixtures/`.

- **2026-08-15 — Phase 3c CLOSED by written ruling: hyphen-asymmetry accepted,
  NO CODE CHANGE. Phase 3c fully closed.** Closes the one remaining Phase 3c
  sub-item left open by the qi-bookkeeping pass above, under D.-1's own
  allowance ("closed OR explicitly accepted in writing with a reason
  recorded here") — the same allowance Phase 2a's Step 5 used for Spanish
  boundary verification (`sync-pipeline-v2-plan.md:381`).

  **Basis, established across three prior sessions plus this session's
  owner ear-test:** 19 genuine hyphenated compounds across the V6 + 173
  corpus; 8 clean-split-fixable, 11 permanently blocked by Whisper's own
  sub-word fragmentation regardless of script-side normalization. Splitting
  the 8 fixable compounds produced exactly ONE boundary change in the
  entire corpus: V6 segment 150 (`154_silent_night_birds`)'s end, moving
  from 457.83s to 458.12s. The owner ear-tested both candidates: **457.83
  (current, unfixed) is correct; 458.12 (post-split) is WRONG.** Variants A
  and B (two candidate splitting strategies) were replay-identical on this
  corpus, so reducing scope between them buys nothing.

  **Mechanism — measured, not inferred: no silence snap participates.**
  Zero silence-detector candidates exist in the window on either side of
  this boundary, both before and after the change. The boundary is the
  plain midpoint of segment 150's last-matched word and segment 151's
  first-matched word. Unsplit, "mid-call" fails to match, so the anchor
  falls back to "cut" (ending 457.14) instead of "call" (ending 457.72);
  midpointing against segment 151's first match (458.52) gives 457.83.
  Split, "call" matches and the same arithmetic gives 458.12. The
  tokenizer defect is producing the better answer by arithmetic
  coincidence, not by correctness — the load-bearing detail of this
  ruling, not a footnote.

  **Ruling: no code change.** Fixing 8-of-19 compounds to make the corpus's
  one measured boundary worse is not worth the index-shift-plus-re-listen
  cost 3c's own scope already priced in. The defect is accepted as a known,
  documented Stage 1 defect under D.-1 criterion 3. **Revisit trigger:** the
  moment Phase 5's fence changes how this seam's anchor is derived (no
  longer a last-match/first-match midpoint), this acceptance is voided and
  V6 seg 150 must be re-listened to before Phase 5 can claim the eleven
  word-shift cases are its only regression surface.

  **Phase 5 warning pinned forward (highest-shelf-life output of this
  investigation).** Added a standing-counterexample warning at Phase 5's
  own entry, plus short cross-reference notes at Phase 6 and 6b: any future
  change that recovers more true word matches at a compound-hyphen seam
  will silently reproduce this regression unless that seam is specifically
  re-listened to — "the fence recovers more matches" is not, by itself,
  evidence of a better boundary. Also recorded, explicitly marked as a
  hypothesis from one data point and not a rule: the last-matched-word /
  first-matched-word midpoint may not be the right placement model in
  general, since the owner's ear preferred the earlier cut over the more
  central one — a cut may belong nearer the end of speech than the centre
  of a pause. Phase 5 is directed to test this, not adopt it.

  **Cross-references updated:** `sync-pipeline-v2-plan.md`'s Contract 1→2
  P6 row (hyphen-asymmetry manifestation now closed by acceptance) and the
  Stage 1 lock gate's blocking-list section (Phase 3c removed as an
  outstanding blocker). This doc's §2 (Stage 1 row), §3 (Phase 3/3c rows),
  §9 (P6), §10 (item 4), and §11 (items 1, 8, 12) updated to match — Option
  B's gate-sequencing block on item 1 (capability-gated production wiring)
  is LIFTED, since its condition ("3b and 3c both land") is now satisfied.

  **No code changed.** `src/` and `src-tauri/` untouched, zero new files,
  `project-state.md`/`docs/history.md` untouched (known stale by owner
  decision), golden replay not re-baselined. Verification run this pass:
  `npm test`, `npm run lint`, and the golden replay (`scripts/phase4-handoff-replay-sync.test.ts`)
  — all unchanged from the current baseline, as expected for a doc-only
  ruling.

  **Phase 3c status: FULLY CLOSED.** Both sub-items (qi-bookkeeping,
  hyphen-asymmetry) are closed — the former by code, the latter by written
  acceptance. This unblocks §11 item 1 (capability-gated production wiring,
  no longer sequencing-blocked) and removes Phase 3c from Stage 1's
  outstanding blocker list (§2).

- **2026-08-15 — Phase 3 production wiring: `fa_align_production` reachable,
  gated, GATE STAYS OFF.** Closes §11 item 1's "not yet started" status —
  see that item's own entry above for the full breakdown; summarized here.
  **Explicit scope boundary honored:** this session wires the path and
  leaves it off — it does NOT turn FA on, does NOT produce the R-H second
  golden baseline, and does NOT measure FA timing quality (all three remain
  §11 item 6, blocked on a real `ORT_DYLIB_PATH` + `model.onnx`, neither
  present anywhere this session ran). **Rust:** `fa_dev.rs`'s `fa_align_dev`
  body extracted into `pub(crate) async fn resolve_wav_and_align` (behavior
  unchanged); new `fa_production.rs`'s `fa_align_production` is a thin
  wrapper over the same helper, its own temp-cache namespace
  (`kinetix-fa-production-inputs`), registered in `lib.rs`. **TS:** new
  `src/services/forcedAlignmentRun.ts`'s `runForcedAlignmentForSync` —
  fail-clean (never throws; every failure mode resolves to `null`) —
  wired into `App.tsx`'s `cachedTokensReady` branch at the exact `:2792-2837`
  insertion point §8 named, gated by `isFaGateOpen()`. **R-G:**
  `distributeSegmentTimes`/`alignFromCache` gained an optional
  `anchorSource` parameter (default `'whisper'`, both pre-existing call
  sites untouched); the new branch passes `'forced-alignment'` only on a
  real FA success. **`faWordTimings`** (`types.ts:401`) now has its first
  writer — set on FA success, explicitly cleared otherwise (clean-slate
  re-sync). R-E/Model P and R-J (`preserveSegmentLocks`'s call site)
  untouched by construction — no new gap-emission path, no call-site move.
  **Tests:** 14 new (`forcedAlignmentRun.test.ts` ×9 — every fail-clean
  branch plus 2 success-path cases, `whisperService.anchorSource.test.ts`
  ×5), both files deliberately separate from the regression-locked
  `syncTiming.test.ts`. **Verified:** `npm test` 82 files/2107 passed/1
  skipped (was 80/2093/1, +2 files/+14 tests, 0 regressions); `npm run lint`
  clean; `cargo check` clean both configs; `cargo test` 132 passed
  (unconditional, unchanged); `cargo test --features fa-inference` 206
  passed/19 ignored (unchanged, 0 new Rust tests — `fa_align_production` has
  no testable surface beyond what `fa_align_dev`'s existing tests already
  cover through the shared helper); `cargo clippy --features fa-inference`
  4 pre-existing warnings, 0 new (2 new `too_many_arguments` warnings from
  the refactor were `#[allow]`-annotated, matching `fa_align`/`fa_align_dev`'s
  own already-accepted signature shape); golden replay
  (`scripts/phase4-handoff-replay-sync.test.ts`) **6/6, unchanged — the core
  proof that gate-off is byte-identical to `a5d7ca1`.** No UI work needed —
  `ProjectSettingsModal.tsx`'s High-Precision Auto-Sync toggle (D17) already
  exists and already drives `isFaToggleOn()`. **Preconditions for the
  FA-on session (§11 item 6):** a real per-language `model.onnx` placed
  where `fa_model_path` resolves it (`app_local_data_dir()`, R-D, manual-
  placement fallback — see `fa.rs`'s model-path resolver), a matching
  entry in `scripts/fixtures/fa-onnx-manifest.json` (or the SHA-256 check
  in `verify_model_manifest`/`resolve_wav_and_align` rejects it as
  `ModelHashMismatch`), `ORT_DYLIB_PATH` pointing at a real onnxruntime
  dylib (R-N packaging still undecided — §7 item 5 — but any dylib
  satisfying `ort`'s `load-dynamic` load works for local dev/measurement),
  running under `npm run tauri:dev:fa` (the `fa-inference` Cargo feature),
  and flipping the Settings toggle (High-Precision Auto-Sync) on in a real
  running app. **Not verified this session, stated explicitly rather than
  inferred:** the success path (`Done` event → `faWordSpansToTranscriptTokens`
  → `alignFromCache` → committed segments) is proven only against mocked
  IPC responses in `forcedAlignmentRun.test.ts` — no real ONNX forward pass
  has been run through `fa_align_production` by this session, and no claim
  is made about FA output quality, timing accuracy, or the R-H baseline.

- **2026-08-16 — Fix: `faChunkPlan.ts` forced-split attribution bug, ear-pass
  item 9. CLOSES ear-pass item 9 (mechanism (4), `b36f6c2`'s diagnosis).
  Items 6/7 (false-anchor timestamp-smear, `faAnchors.ts`'s
  `findAgreeingSilence`) remain open, next session. Gate stays OFF.**
  Independently re-derived the diagnosis before coding, per this session's
  own brief: agreed with `b36f6c2` in full, and sharpened one point —
  `attributeByIndex`'s empty-run handling was documented as "mirroring
  `runsToChunks`'s own empty-run rule," but the two modes need OPPOSITE fold
  directions (text flows backward in `runsToChunks`, forward in
  `attributeByIndex`'s placement scan for an empty-`qi` range specifically),
  so applying the same backward fold to both was the bug itself, not an
  unrelated regression.
  **Fix (`src/services/faChunkPlan.ts`, `attributeByIndex`):** a text-less
  run now folds its window in the direction its text actually went — FORWARD
  (via the existing `pendingStart` mechanism) when `qiHi === qiLo` (a forced
  split, whose text the placement scan always pools into the NEXT range),
  BACKWARD (extend the previous chunk, unchanged) otherwise. One `if` added;
  `runsToChunks`/segment-start-time attribution untouched. R-P (split
  selection), R-E (no gap — the shared boundary still moves for both
  neighbors in the same step, never independently), Model P, and the
  demote-only `anchorSource` ordering are all unaffected by construction.
  **Red-then-green:** `src/services/faChunkPlan.test.ts` gained 4 tests in a
  new forced-split-after-a-real-anchor fixture (the shape the existing suite
  missed — every prior forced-split fixture had the split as run 0, where
  `attributeByIndex`'s `chunks.length === 0` branch was already correct).
  Confirmed red at HEAD first (`word 3 ("hats") has onset 1.5s but its chunk
  covers [31.5, 40)`), then green after the fix — 32/32 in the file.
  **Real-corpus measurement** (scratch harness: TS replay of
  `parseProjectData` → `applyAnchorBasedTiming` → `computeFaChunkPlan`,
  scratch Rust `fa_onnx::align_chunked` call, both reverted before this
  commit — not part of the diff): harness fidelity proven first (unmodified
  pre-fix regeneration reproduces the committed R-H second-baseline chunk
  plans exactly — 280/280 v6, 118/118 173, 5/5 spanish, byte-identical).
  Post-fix: **`023_scylla_six_sailors` moves from 66.73 to 65.12 — the
  ear-correct value, exactly, to the centisecond.** Its neighbor
  `022_ship_trapped`'s end moves in lockstep to the same 65.12 (the shared
  boundary) — 2 of Spanish's 27 boundaries moved, both the same seam, 25
  unchanged. **V6 (447 boundaries) and 173 (175 boundaries): zero movement**,
  as predicted for a corpus with no forced split — chunk plans and FA word
  output are byte-identical old vs. new (0/3874 v6 word rows differ, 0/1660
  173 word rows differ). **Confidence:** the 9 words between the "que"
  anchor and the next real anchor flip from ~0.0000 (`needsReview`) to
  ~0.99+ (not flagged) — they were previously being aligned against the
  wrong 4.2s-displaced window. Net Spanish `needsReview` count drops 25→14.
  **One side effect, reported not fixed (out of scope):** the now-correctly-
  shortened preceding chunk's last two words ("por"/"lo") flip from high to
  ~0.0000 confidence — a tighter, un-padded window (R.2 padding is this
  module's own documented out-of-scope item, `faChunkPlan.ts:48-51`) leaves
  less slack at the chunk's tail. Does not move the `022`/`023` boundary
  itself (driven by `023`'s own first word + silence-snap, not by `022`'s
  internal word confidences) and does not regress: this is a word newly and
  correctly flagged `needsReview`, not a wrong commit.
  **Verification:** `npm test` 82 files/2111 passed/1 skipped (unchanged
  count, +4 new tests replacing headroom — see file-level diff); `npm run
  lint` clean; `cargo check --features fa-inference` clean; `cargo test
  --features fa-inference` 206 passed/19 ignored (unchanged); golden replay
  (`scripts/phase4-handoff-replay-sync.test.ts`) **6/6, unchanged — default
  (gate-off) path is byte-identical.** No R-H fixture rows touched (this
  session's FA re-run was a scratch harness against `.work-phase4/replay/`,
  not a fixture regeneration — `scripts/fixtures/phase4-fa-baseline-*`
  untouched, confirmed by golden replay's own R-H describe block staying
  green).

- **2026-08-16 — Ear-pass items 6/7 false-anchor circularity: independent
  re-derivation checkpoint (diagnosis + proposal only; no fix, no tuning, gate
  stays OFF).** Full write-up: §11 item 6's "ADDENDUM 2" above. Owner asked
  for an independent mechanism trace, population scope, and fix options for
  the two remaining ear-pass failures `b36f6c2` attributed to `faAnchors.ts`'s
  `findAgreeingSilence`. Summary:
  - **Mechanism independently confirmed for both items**, from the committed
    second-baseline artifacts (no FA re-run). Item 6: `findAgreeingSilence`
    fires on "residue" (last word of the PRECEDING segment) because its
    Whisper token timestamp sits 0.06s from an unrelated silence, minting a
    spurious chunk boundary that strands "of whatever the last" (4 words
    belonging to the FOLLOWING segment) in a 1.84s micro-chunk at ~0
    confidence. Item 7: same shape — the false anchor fires on "moving," the
    SIXTH word of the correct segment's own text, stranding its first five
    words in the preceding chunk.
  - **Invariant verdict differs from `b36f6c2` on one material point:**
    `b36f6c2` called `faAnchors.ts` "a code path that predates" the
    CLAUDE.md timestamp invariant; `git log` shows the opposite —
    the invariant landed 2026-08-09 (`53b26ee`), `faAnchors.ts` was authored
    2026-08-12 (`e0c9c89`), three days later. Not a grandfather case. Still
    not a clean violation as literally scoped (the invariant's own text names
    `snapBoundaries.ts` and "boundary/breath classification" specifically, a
    different operation from anchor corroboration) — verdict: new code
    repeating the invariant's exact failure mode in a sibling subsystem the
    invariant's text doesn't name. Grey area leaning toward "should have been
    caught," not a sanctioned exception.
  - **Population scope (heuristic proxy, not a certified count):** 116/639
    (18.2%) true boundaries across 173/v6/spanish carry the same structural
    precondition (a competing false anchor near a true boundary) items 6/7
    exhibit. Items 6 and 7 both independently reproduce in the underlying
    data. Reading: not statistically unlucky — the precondition is common;
    whether it flips a FINAL committed boundary depends on an unmeasured
    downstream step, so 116 is an exposure upper bound, not a confirmed-wrong
    count.
  - **Four fix options proposed, none implemented:** (1) match on token
    indices per the invariant, most principled, needs a design pass; (2)
    require independent corroboration, circular as stated, needs a two-pass
    restructure; (3) tighten `ANCHOR_AGREEMENT_SEC`/minimum anchor spacing,
    cheapest and most testable, doesn't address the invariant question; (4)
    defer to Phase 5, but `faAnchors.ts` is Phase 3/Task 5 scope, not named
    in Phase 5's stated scope. **No ruling made — waiting on the owner.**
  - *Method/verification:* all analysis via disposable scratch scripts in the
    session scratchpad only, never in the repo — `git status` clean
    throughout, no `src/`/`src-tauri/` file touched. `npm test` 2111
    passed/1 skipped, `npm run lint` clean, `cargo check --features
    fa-inference` clean, golden replay 6/6 — all unchanged (no code changed
    to change them). `isFaGateOpen()` still OFF.
