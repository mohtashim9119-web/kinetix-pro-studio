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
| **1 — Prepare** | `:3820-3826` | Contract IN + 1→2 verified guarantee-by-guarantee; inspector run on ≥1 tight-pause + ≥1 long-pause project, thresholds met; determinism check passed; non-English corpus resolved or accepted in writing; no Stage 1 defect deferred downstream; cross-cutting regression checklist (D.-1) clean | **NOT MET** | Phase 0/1b/2a/2b done; Phase 3 (Task 5) dev-only, not production; Phase 3c not started | (a) smear thresholds still unmet until Phase 3 production-lands; (b) fr/de/pt corpus absent (Spanish partially accepted, reopens once Phase 3b ships Spanish-specific code); (d) Contract IN/1→2 verification not run; (e) regression checklist not run; Phase 3c (hyphen asymmetry, the last Stage-1 index-shifting event) not started — see §3 |
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
| **3 (= Task 5)** | 1 | **ALIGNER COMPLETE, dev-only — production wiring BLOCKED ON 3C BY DECISION** | — | Phase 3c landing (Option B gate sequencing, 2026-08-15 — §11 item 1) | D1–D25 shipped (D7 cancelled), `fa-inference` feature OFF by default, dev-only reachable — full detail §4/§5 |
| 3b | 1 | **NOT STARTED** | **unowned** | — | Language-keyed normalization (fr/de/pt contractions, numbers, currency) — no task on the ledger under its own name |
| 3c | 1 | **NOT STARTED** | **unowned** | — | Hyphen-asymmetry fix — the last Stage-1 index-shifting event; **directly blocks Stage 1 lock**, `sync-pipeline-v2-plan.md:3725-3726` |
| 3d | 1 | **SKIPPED** | — | Reopens only if Phase 3's post-FA measurement shows a silence-side cost | Phase 2b's own finding: fixed −45dB threshold isn't the binding constraint (spot-verified against a waveform; failure is entirely token-side) |
| 4 | 2 | **NOT STARTED** | — | Stage 1 lock | Restructure into 4 stages; timing-free Stage 2 return type; 5+3→5 change-detector |
| 5 | 3 | **NOT STARTED** | — | Stage 1 + 2 locks; heading-wildcard Option A logic (decided, not coded) | Replace `computeBoundarySearchWindow`/`isBoundarySilenceCandidate` with the fence |
| 6 | 3 | **NOT STARTED** | — | Phase 5 | Deprecate `isBreathSilence`/seam exemption/contention assignment, conditional on the 8 seam cases surviving without it |
| 6b | 3 | **NOT STARTED** | — | Phase 5 | Verify 173-project's `pairIdx-20` boundary defect |
| 7 | 4 | **NOT STARTED** | — | Stage 1/2/3 locks | Observability: clamp/floor/fallback logging, `boundaryUsedFallback` 4-arg bug fix |

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
| P6 | Same language-keyed normalizer, byte-identical English path | ❌ | Phase 3b/3c not started — see §3, §10 |
| P7 | Timing-source identified on output, type-level | ~ partial | `types.ts:223` `VideoSegment.anchorSource?: 'forced-alignment' \| 'whisper' \| 'estimate'` exists (ahead of schedule, includes `'forced-alignment'` per R-G) but lives on the *segment*, not per-token/per-Stage-1-output as the contract literally specifies |
| P8 | Tokens/silences/audioDuration/segments as ONE bundled, type-enforced object | ❌ | `project.transcriptTokens` (`types.ts:336`) remains separately reachable; `useWhisper.ts:44-51`'s own doc comment *warns* callers to use `AlignFromCacheResult.tokens` instead — discipline, not type enforcement. This is "old R7," scheduled for Phase 4 |

**5 of 8 met** (P1, P2, P3, P5, P7-partial); P4/P6/P8 open, all tied to phases not yet
started (3b/3c, 4) — consistent with Stage 1/2 both being unlocked (§2).

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
  consolidation pass). **Zero live callers anywhere in `src/`** — own header states "NOT
  WIRED INTO ANY PIPELINE."
- Rust port: `src-tauri/src/fa/text.rs:435`, byte-identical, 36 corpus entries, all 5
  languages (§4/§5).

**Action items before non-English FA can ship:**
1. Wire `faTextNormalize.ts` into `src/services/faChunkPlan.ts`'s chunk-building path so
   text handed to the Rust CTC decoder carries native diacritics instead of
   `textNormalize.ts`'s ASCII-stripped form.
2. Do NOT touch `textNormalize.ts`/`canonicalize` — must stay byte-identical.
3. Land Phase 3b (language-keyed normalization: contractions, numbers, currency for
   fr/de/pt) — **NOT STARTED, unowned** (§3).
4. Land Phase 3c (hyphen-asymmetry fix) — **NOT STARTED, unowned**; also directly blocks
   Stage 1 lock regardless of FA.
5. Source real `fa-vocab-<lang>.json` files for the production build path (today only
   under `scripts/fixtures/`) and wire them into `faTextNormalize.ts` at the eventual
   chunk-building call site.

**fr/de/pt corpus status:** Spanish exists and is verified (§6). French/Portuguese/German
narration-script corpus remains completely absent — the fr/de/pt e2e alignment *fixtures*
(D5, `scripts/fixtures/fa-e2e-alignment-{fr,de,pt}-*.json`) used real `google/fleurs`
public-corpus audio for engine-parity testing, which is a different thing from a real
narration-script corpus for boundary-quality verification. Accepted in writing under H.8's
dormant-rules allowance (`sync-pipeline-v2-plan.md`) — reopens the moment fr/de/pt-specific
code ships (Phase 3b).

---

### §11. Terminal Path to WS1 Completion

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

1. **Capability-gated production wiring slice.** *Goal:* a non-dev, `isFaGateOpen()`-gated
   caller of `fa_align` reachable from the real running app, replacing the
   DEV-only-`fa_align_dev` path for real Apply-Sync timing. *Files:* `App.tsx` (new branch
   at `:2792-2837`, §8), a new production Tauri command mirroring `fa_align_dev`'s already-
   proven `AppHandle`-resolution path minus the dev wrapper, `faWordTimings` writer into
   `Project` (`types.ts:401`, schema exists, unused). *Exit criteria:* a real
   `invoke('fa_align', ...)` call exists in `src/`, gated by `isFaGateOpen()`; toggling the
   Settings control changes which timing source Apply Sync actually uses; golden replay
   still 3/3 with the gate OFF (byte-identical default behavior). *Discharges:* the
   "capability-gated production wiring" item named throughout §4/§6/§7. *Depends on:* §7
   item 2 (R.5 whether/when) — affects this slice's shape (does the production command need
   to surface per-word confidence/wildcard data, or just a single `t0`?) but does not block
   starting it. **Sequencing block (Option B, 2026-08-15):** does not start until Phase 3b
   and 3c (items 7-8 below) both land — the gate stays off through both and flips once,
   after 3c, so the boundary set is measured exactly once. This is a decision-imposed
   block, not a technical one — see the Phase 3 row (`sync-pipeline-v2-plan.md`, §3 above).
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
6. **R-H second-baseline pass.** *Goal:* run the golden-baseline replay a second time
   against real jonatasgrosman per-language model output (not the MMS-FA-derived first
   baseline) and review per-boundary. *Exit criteria:* `scripts/phase4-handoff-replay-sync.test.ts`
   gains a second FA pass; per-boundary diff reviewed, not blindly re-baselined. *Depends
   on (hard precondition, not a scoping gap):* slice 1 landing a real per-language model
   caller.
7. **Phase 3b — language-keyed normalization (fr/de/pt).** *Goal:* per-language number
   words, currency, thousands separators, French elision. *Files:* new normalizer rules,
   `sync-pipeline-v2-plan.md` Part H.5 full spec. *Exit criteria:* English path provably
   byte-identical to today's baseline (gate); fr/de/pt rules land, dormant behind language
   keys until corpus material arrives to verify them. **Needs an owner.**
8. **Phase 3c — hyphen-asymmetry fix.** *Goal:* fix `textNormalize.ts` gluing a
   mid-call hyphenated word into one alignment word while Whisper emits two tokens. *Exit
   criteria:* the fix lands, its own re-listen of the affected set completes, tokens/word
   indices shift one final time (the last Stage-1 index-shifting event). **Directly gates
   Stage 1 lock — needs an owner.**
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
    export/preview consumers, DEV harnesses). *Depends on:* items 1 (Phase 3 production
    landing) and 8 (Phase 3c) both landing first.
13. **STAGE 1 LOCK.** *Exit criteria:* §2's Stage 1 row, all criteria met. *Depends on:*
    items 1, 8, 12.
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
