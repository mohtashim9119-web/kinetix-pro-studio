# WS1 Task 5 — Status Board

> **Purpose.** One canonical table answering "what state is each piece of
> Task 5 (Phase 3, forced alignment) actually in, right now." Every row was
> re-verified live against `main` at commit `1cde438` (2026-08-14) — grep,
> direct file reads, and (for the CI/branch-protection rows) a live
> `gh api` call — not copied from a prior status claim. Where a fact
> disagrees with an older doc, that doc is corrected in the same pass that
> added this board (see `docs/history.md`-bound commit for the list).
>
> **Scope note.** This board's rows are Task 5 / Phase 3's own internal
> decomposition. Task 5 is one phase (Phase 3) inside WS1's larger
> Phase 0–7 / Stage 1–4 programme structure — that broader structure is
> `ws1-master-roadmap.md` §2's job, not restated here; this board only
> drills into Phase 3 itself, at the granularity the phase's own execution
> actually happened (D-slices), not the plan document's original Step-R
> lettering alone.
>
> **Status values.** `done-and-verified` (built, tested, confirmed present
> by direct reading this pass), `in-progress` (partially built, real gap
> remains), `not-started` (no code exists), `blocked` (cannot proceed until
> something specific resolves), `closed-negative` (built, measured, and
> deliberately removed — not a gap to reopen).

---

## Board

| Item | Status | Evidence | What unblocks it |
|---|---|---|---|
| **ONNX forward pass** | done-and-verified | `src-tauri/src/fa_onnx.rs:264` (`run_forward_pass_with_session`), `:300` (`run_forward_pass`) — real `ort` session + forward pass, `fa-inference`-feature-gated. D2 (`49e233a`). Parity: 0/577 argmax mismatches vs. real jonatasgrosman ONNX models, 3 fixtures. | — |
| **Text normalization (Rust port)** | done-and-verified | `src-tauri/src/fa/text.rs:435` (`normalize_for_forced_alignment`) — unconditional (not feature-gated), byte-identical port of `src/services/faTextNormalize.ts`. D3 (`997102e`). Fixture-parity tested against 36 corpus entries across all 5 languages (`fixture_parity` tests). | — |
| **Viterbi DP / char→word span merge** | done-and-verified | `src-tauri/src/fa_viterbi.rs:140` (`forced_align`), `:275` (`merge_tokens`) — D1 port (`6a0ac21`). `src-tauri/src/fa_onnx.rs:570` (`merge_char_spans_to_words`) — D8 (`20588db`). Zero-tolerance e2e parity vs. real torchaudio across all 5 languages, 0 divergences (D4/D5). | — |
| **Frame→time conversion** | done-and-verified | `src-tauri/src/fa_onnx.rs:397` (`frame_to_seconds`), stride = 320 samples/16kHz, sourced from all 5 languages' own HF `config.json`, confirmed byte-identical before being written as a constant. D6 (`b879ed5`). | — |
| **Chunked windowing (execution)** | in-progress | `src-tauri/src/fa_onnx.rs:768` (`align_chunked_for_language`), `:875` (`align_chunked`) — D11 (`eda13b1`) built real per-chunk windowing execution on top of R.0/R.1/R.4 (already landed in TS at D1, `faAnchors.ts`). R.2 is closed-negative (below); R.3, R.7–R.9 remain design-only in `sync-pipeline-v2-plan.md`; R.5 remains not-started (below, verdict (i) still reachable). | R.3/R.7–R.9: engineering work, no owner decision blocking. R.5: see its own row. |
| **Model caching** | done-and-verified | `src-tauri/src/fa_onnx.rs:688` (`CachedSession` struct), `:700` (`with_cached_session`) — one loaded ONNX session per `(language, resolved model path/size/mtime)` key, reused across every chunk in a run and across later calls in-process, evicted only on key mismatch. D11. | — |
| **Cancellation** | done-and-verified | `src-tauri/src/fa_onnx.rs:884` (checked before chunk 0), `:896` (checked before every subsequent chunk) — returns `Err(FaOnnxError::Cancelled)` immediately, no partial word list. D11. Proven by a deterministic test (`cancellation_stops_before_completing_all_chunks_deterministically`). | — |
| **Index attribution** | done-and-verified | `src/services/faChunkPlan.ts:247` — `'script-word-index'` is `computeFaChunkPlanWithAttribution`'s own internal default since D22 (`a013329`); `'segment-start-time'` stays reachable by explicit parameter. D21 (`aa5708e`) measured 0/1643 fallback fires on the real 709s corpus (regression-guarded, `assert_eq!(fallback_count, 0, ...)`), down from 2/97 CTC-infeasible chunks under the prior `segment-start-time` default. | — |
| **Word-timing schema** | done-and-verified (no production writer) | `src-tauri/src/fa.rs:288` (`FaWordSpan` struct, index-keyed), `src/services/faBoundaryTypes.ts:132` (`faWordSpansToTranscriptTokens` reshape). D9 wiring (`49dce01`), D18 schema (`78a0d4d`). One caller anywhere in the codebase: `src/App.tsx`'s DEV-only `__faDevAlign` harness (`App.tsx:3609`) — no production `invoke()` of `fa_align`/`fa_align_dev` exists (grepped, zero hits outside the dev path and comments). | Capability-gated production wiring slice (below). |
| **R.7 flagging** | in-progress | `src-tauri/src/fa.rs:303` (`CONF_MIN: f32 = 0.3`), `:322` (`needs_review: confidence < CONF_MIN`) — the confidence-fallback flag itself is built and wired (D19, `b7f1d0a`). Built: only the CONF_MIN-below-threshold flag. Not built anywhere in Rust or TS: R.7's other two failure paths (skip-and-flag when target text can't fit the window; force-split LOW-CONFIDENCE marking distinguishable downstream). Untested: no fixture in the repo constructs a deliberately low-confidence case — every committed e2e fixture's `exp(score)` confidence sits in [0.730, 1.0], never tripping the gate's reject branch (D9 finding, restated D15). | A deliberately-constructed low-confidence fixture or real low-confidence audio (neither exists today) closes the test gap; the two un-built failure paths are pure engineering work, no owner decision blocking. |
| **Capability gate** | done-and-verified (inert, OFF by default) | `src/services/faGate.ts:69` (`isFaGateOpen`) — memoized runtime probe (`isTauri()`) AND a persisted, OFF-by-default Settings toggle, combined. D17 (`6e3293c`). Nothing executes behind it — confirmed, zero `fa_align` invocation reachable from any code path this gate guards. | — |
| **Durable audio cache** | done-and-verified (built + live-wired; still no production caller) | `src-tauri/src/fa.rs:736` (`ensure_durable_wav`) built D24 (`a89f70a`), LRU-evicted at a 2 GiB cap (`fa.rs:591` `evict_lru_until_under_cap`, `:516` cap rationale). Wired into `fa_align_dev` and live-verified against a real `AppHandle<Wry>` D25 A1 (`1cde438`, `src-tauri/tests/fa_durable_wav_live.rs`) — resolved cache path matches production's `app_local_data_dir()` exactly, cache hit confirmed 1538x faster + byte-identical. | Capability-gated production wiring slice — `ensure_durable_wav` has no caller outside `fa_align_dev` today. |
| **R.2 (padding)** | closed-negative | D23 (`3f2b9e6`) built `align_chunked_with_padding`/`FA_R2_DEFAULT_PADDING_SEC` (0.5s default). D24 (`a89f70a`) measured a net-unfavorable result (below-CONF_MIN tail 155→164, seam concentration 83.9%→85.4%) and falsified the smear hypothesis it was built on (0/236 edge-word checks show a timestamp escaping its own chunk's window — architecturally impossible, not just unobserved). **Deleted**, not left as unwired dead code — confirmed by direct grep: `align_chunked_with_padding`/`align_chunk_samples_padded`/`FA_R2_DEFAULT_PADDING_SEC` return zero hits in `fa_onnx.rs` today. | Does not need re-attempting under the falsified hypothesis — a future slice would need a genuinely new mechanism, not a retry. |
| **R.5 (wildcard)** | not-started, owner-decision-blocked on whether/when (not on destination — see note) | No wildcard/star-token mechanism exists anywhere in `fa_viterbi.rs`/`fa_onnx.rs` (grepped, zero hits). D25 B1 (`1cde438`) scoped reachability only (no code): **verdict (i) — still fully reachable** under index attribution; D21 fixed a different, coarser bug and does not touch R.5's within-window content gap. Mandated in-scope by owner ruling D1 (`task5-integration-scope.md` §0, "Option B... with R.5 wildcards"). **Correction this pass:** `task5-slice-ledger.md`'s R.5 ruling section and `task5-integration-scope.md` §2/§4 both describe the wildcard-gap *destination* as still needing an owner ruling — this is stale. `project-state.md`'s **R-E** ("Model P outranks R.5" — assigns the wildcard span to the preceding segment) already settled that specific question, recorded `2026-08-11` (commit `ba05be6`), a full day before Task 5's first commit (`7f74c39`, `2026-08-12`). Destination is decided; what remains open is only *whether/when* to build R.5 at all, given D25's 2-layer implementation sketch (`faChunkPlan.ts` per-segment text spans + a genuine Rust-side wildcard state) — see Open Decisions doc. | Owner call on build timing (see Open Decisions doc) — not blocked on any further scoping or a destination ruling. |
| **R-H** | blocked | `ws1-master-roadmap.md:108-113`. Half-satisfied: the FA input set + first baseline (MMS-FA-derived, Viterbi/windowing-fidelity-scoped only) landed at `42bd708`. The second half — "the FA swap itself is then run and reviewed per-boundary against that new baseline" — cannot happen until a real per-language model reaches the golden-replay path via production wiring. Unchanged through D11-D25 (no production per-language-model wiring has landed). | Capability-gated production wiring slice landing (below) — hard precondition, not a scoping gap. |
| **CI ORT matrix** | done-and-verified | `.github/workflows/fa-ort-matrix.yml` exists, runs on push/PR touching the FA Rust surface. D14 B1 (`450ad60` + CI-bug follow-up `8889a2e`) — first run failed all 4 cells on two environment bugs, fixed same-day, re-run green on all 4. D16 B1 confirmed non-flaky via a second independent `workflow_dispatch` run. Not re-triggered this pass (docs-only, no source touched) — file presence and prior green runs re-confirmed by direct read, not re-run. | — |
| **Production writer** | not-started | Grepped: no `invoke('fa_align')`/`invoke('fa_align_dev')` call exists anywhere in `src/` outside `App.tsx`'s DEV-gated `__faDevAlign` harness. No Apply-Sync code path calls `fa_align` for real segment timing. | Capability-gated production wiring slice — required before any Apply-Sync path may call `fa_align` (ruling recorded `task5-slice-ledger.md` §4, "Capability gate — dev-only is a phase, not the endpoint"). |
| **IPC wiring** | done-and-verified | `src-tauri/src/lib.rs:144-146` — `fa::fa_align`, `fa::fa_cancel`, `fa_dev::fa_align_dev` all registered in `invoke_handler!`. Commands have been IPC-reachable since D1's command-surface skeleton (confirmed: this was never an outstanding wiring task at any point D1-D25). | — |
| **Production `AppHandle` coverage** | in-progress | D10 (`3787b11`) exercised a real `AppHandle` only via the DEV-only `fa_align_dev`/`fa_dev.rs` path — the first exercise of `fa_model_path`'s real `app.path().app_local_data_dir()` resolution outside a test double. D25 A1 extended this to a real `AppHandle<Wry>` (via `tauri::test::mock_context`, no running app needed) for the durable-cache path specifically. **Still not covered:** a production (non-dev, capability-gated) call path through a live `AppHandle` — every `AppHandle` exercise to date is dev-tool-initiated. | Capability-gated production wiring slice — same slice as "production writer," above; these are naturally one piece of work, not independent gaps. |

---

## Owner-decision-blocked vs. engineering-blocked, at a glance

**Owner-decision-blocked** (no amount of coding resolves these without a ruling):
- **R.5 build timing** — destination is settled (R-E), but *whether/when* to build R.5 given D1's mandate + D25's reachability finding + the 2-layer implementation cost is still an open call. See Open Decisions doc.
- Branch protection on `main` (not itself a Task 5 row above, but gates how confidently the CI ORT matrix row can be relied on as a merge gate — see Open Decisions doc).
- The proposed 0.3s per-word display-timing-error gate (D15) — product decision, explicitly pending sign-off, not wired to anything yet.
- R-M/R-N ratification into `project-state.md` (ort/onnxruntime runtime-unblock finding, native-packaging reading) — deferred to this documentation pass per the process rule (`docs/work-in-progress.md`), but `project-state.md` itself is out of scope for this pass's edits (see constraints) — carried forward to Open Decisions doc, not resolved here.

**Engineering-blocked** (a scoping/prerequisite chain, not a pending ruling):
- **Chunked windowing's R.3/R.7-R.9** — design exists (`sync-pipeline-v2-plan.md`'s Step R), no owner decision is named as blocking; genuinely just unbuilt.
- **R.7's two un-built failure paths + its untested CONF_MIN branch** — needs a fixture or real low-confidence audio, not a ruling.
- **Durable audio cache / production writer / IPC-to-production / production `AppHandle` coverage** — all four converge on the same single next slice (capability-gated production wiring), already scoped in `task5-integration-scope.md` §3-4; no open ruling blocks starting it besides the R.5 build-timing question above (which affects that slice's shape, not whether it can start).
- **R-H** — mechanically blocked on the production-wiring slice landing; no independent ruling needed beyond that.

---

## Cross-references

- Full slice-by-slice build record — `task5-slice-ledger.md` §1.
- Full known-gap register (this board's source material, reconciled against it row-for-row) — `task5-slice-ledger.md` §6.
- R.5 reachability scoping (verdict (i)) — `d25-durable-cache-live-wired-r5-scoping-2026-08-14.md`.
- The proposed 0.3s display-timing gate — `measurements/d15-mis-assignment-diagnostic-2026-08-13.md` §2.2-2.3.
- Broader WS1 phase/stage structure (Task 5 = Phase 3 inside it) — `ws1-master-roadmap.md` §2.
- Open decisions awaiting the owner — `task5-open-decisions.md`.
