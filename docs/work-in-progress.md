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
| **3 (= Task 5)** | 1 | **PRODUCTION PATH WIRED, gate OFF — not yet turned on** | — | None; the FA-on measurement session (§11 item 6) is next | D1–D25 shipped (D7 cancelled), `fa-inference` feature OFF by default. **2026-08-15 (this session): `fa_align_production` (`fa_production.rs`) is now a real, reachable, `isFaGateOpen()`-gated production caller** — see §11 item 1's own entry and the changelog below. Gate stays OFF by default (owner ruling D2); golden replay proven byte-identical gate-off (6/6, unchanged) |
| 3b | 1 | **DONE, 2026-08-15 — PHASE CLOSED** (Rules 1-5 done — French elision, Spanish cardinals 0-30, German cardinals 0-30, Portuguese cardinals 0-20/30 PT-BR, French cardinals 0-30 minus 21; currency/thousands-separator expansion, Portuguese 21-29, and French 21 PERMANENTLY out of scope, decision (b)) | project owner (assigned 2026-08-15) | — | Language-keyed normalization (fr/de/pt contractions, numbers, currency) — see `sync-pipeline-v2-plan.md`'s H.5 decision block for the full per-rule classification |
| 3c | 1 | **CLOSED, 2026-08-15 — PHASE FULLY CLOSED.** The two reassigned qi-bookkeeping sub-items (diacritic-preserving fold, thousands/decimal separator inversion) are DONE (prior pass). The phase's original scope, hyphen-asymmetry, is CLOSED BY WRITTEN ACCEPTANCE, no code change — owner ear-test confirmed the only measured effect of fixing it (V6 seg 150, 457.83→458.12) is a regression, so it is accepted as a documented Stage 1 defect under D.-1 criterion 3 rather than fixed | project owner (assigned 2026-08-15) | — | Written acceptance ruling: `sync-pipeline-v2-plan.md`'s Phase 3c entry (measured scope 19 compounds/8 clean-fixable/1 boundary-affecting; mechanism — anchored-only midpoint, no silence snap; ear-test result; revisit trigger = Phase 5 fence changing this seam's anchor derivation). qi-bookkeeping fixes: `canonicalize()`'s language-gated `languageCode` parameter, prior changelog entry |
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
| P6 | Same language-keyed normalizer, byte-identical English path | ❌ | Phase 3b DONE, Phase 3c CLOSED (2026-08-15, by written acceptance — the hyphen-asymmetry manifestation of this requirement is accepted, not fixed); not yet owner-verified guarantee-by-guarantee as P6 itself requires — see §3, §10 |
| P7 | Timing-source identified on output, type-level | ~ partial | `types.ts:223` `VideoSegment.anchorSource?: 'forced-alignment' \| 'whisper' \| 'estimate'` exists (ahead of schedule, includes `'forced-alignment'` per R-G) but lives on the *segment*, not per-token/per-Stage-1-output as the contract literally specifies |
| P8 | Tokens/silences/audioDuration/segments as ONE bundled, type-enforced object | ❌ | `project.transcriptTokens` (`types.ts:336`) remains separately reachable; `useWhisper.ts:44-51`'s own doc comment *warns* callers to use `AlignFromCacheResult.tokens` instead — discipline, not type enforcement. This is "old R7," scheduled for Phase 4 |

**5 of 8 met** (P1, P2, P3, P5, P7-partial); P4/P8 tied to Phase 4 (not started); P6 is
open on process (owner guarantee-by-guarantee verification, item 12) even though the
phases it names (3b, 3c) have both now landed — consistent with Stage 1/2 both being
unlocked (§2).

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
  `Done`, wall-clock ~231s for 447 chunks over ~1421s of audio. All 447 segments committed
  `anchorSource: 'forced-alignment'`; `Project.faWordTimings` persisted, 3874 words (vs.
  4517 raw Whisper tokens — expected, FA's output has no punctuation-only tokens). 0/3874
  monotonicity violations, 0 negative-duration words, first word at 0.24s, last at 1420.38s
  (project audio duration 1421.26s) — both inside bounds. 596/3874 words (~15%) flagged
  `needsReview` (confidence < 0.3), concentrated in a few short low-confidence spans (e.g.
  first word "you": confidence 0.00075) — a real quality signal, not investigated further
  per this session's scope. Spot check against the cached Whisper tokens: ballpark-consistent
  word-for-word in the 452–460s window checked, off by tens to a few hundred ms per word
  (expected — two different alignment methods), no wild divergence. **V6 seam observation
  (array index 153→154 in this project's current numbering, not "150" — this project has
  been resynced/renumbered since the historical measurement docs were written): FA gave
  457.81s. Known owner-ear-tested-correct value (§11 item 8 above): 457.83s (0.02s off).
  Documented Whisper baseline: 457.72s "call" end (0.09s off). Observation only — no
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
