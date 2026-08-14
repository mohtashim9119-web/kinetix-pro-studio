# WS1 Task 5 — Rust Forced-Alignment Integration: Slice Ledger & Rulings

> **Purpose.** Canonical home for everything about *how* Task 5 (Phase 3, Rust
> forced-alignment integration) was actually built, slice by slice: what each
> slice shipped, why D7 was cancelled instead of completed, assumptions that
> turned out false and how that was established, the rulings that resolved
> open spec questions, and the register of what's still not done. Built
> 2026-08-13 from `git log`, direct source reading (`src-tauri/src/fa*.rs`,
> `src/services/faAnchors.ts`, `src/services/faBoundaryTypes.ts`), and the
> commit messages/comments those commits themselves left as their own record.
> Where a fact already has a home elsewhere (`sync-pipeline-v2-plan.md`'s
> Step R design, `ws1-master-roadmap.md`'s phase/stage status,
> `docs/work-in-progress.md`'s task ledger), this document points there
> instead of restating it — see "Cross-references," bottom.
>
> **Status this document does NOT change:** Task 5 is implemented and
> verified only behind the OFF-by-default `fa-inference` Cargo feature, and
> only reachable in the running app via the DEV-only `fa_align_dev` /
> `window.__faDevAlign` path (Slice D10). No production UI, Settings toggle,
> or Apply-Sync wiring exists yet — see "Known-gap register" and the
> capability-gate ruling below.

---

## 1. Slice ledger

All commits below are dated 2026-08-12 except D10 (2026-08-13); this reflects
this project's own commit history, not a documentation error.

| Slice | What it built | Commit(s) | Gates (from the commit's own record, where stated) |
|---|---|---|---|
| **D1** | Foundation, two parallel tracks that don't yet touch each other: (a) TS-side — `faAnchors.ts`'s pure `computeFaAnchors` (R.0/R.1/R.4, ruled by R-O/R-P after a genuine spec-hole hard-stop — see `docs/history.md`'s "R.1 spec holes ruled" entry), unwired, no caller; (b) Rust-side — the `fa_align`/`fa_cancel` command surface (`fa.rs`, no model, no inference, typed `NotImplemented` error) and the CTC Viterbi DP port (`fa_viterbi.rs`), plus the vocab-aware FA text normalizer ported to Rust foundations. | `7f74c39`, `e0c9c89`, `5f4f0da`, `42bd708`, `9f70f8f`, `fc0e756`, `0589239`, `eda3f7d`, `4b64c28`, `9461c0a`, `49b0acd`, `6a0ac21` | `npm run lint` clean; `npm test` 72→~74 files, 1803→~1857 passed, 1 skipped; golden replay 3/3→6/6 (extended with the FA input set, R-H); `cargo check` clean. (Exact per-commit deltas not individually re-derived here — see each commit's own message; the D2 entry below states the cumulative baseline this slice left behind: `cargo test` 31/31.) |
| **D2** | Real ONNX forward pass wired into `fa_align` behind the new, OFF-by-default `fa-inference` Cargo feature. `ort = "=2.0.0-rc.13"` (optional, `default-features = false`, `["std", "load-dynamic"]`, no `api-NN` feature) added to `Cargo.toml`; new `fa_onnx.rs` (WAV decode, zero-mean/unit-var normalization, ONNX session + forward pass via `ORT_DYLIB_PATH`, placeholder ASCII tokenizer, wired into `fa_viterbi`). | `49e233a` | `cargo check` clean both configs; `cargo test` feature-off 31/31 unchanged; feature-on 49 (+18); `npm run lint` clean; `npm test` 74 files/1857 passed/1 skipped; golden replay 6/6. Parity: 0/577 argmax mismatches vs. real jonatasgrosman ONNX models across 3 fixtures, max abs diff 0.0003–0.0012. |
| **D3** | Vocab-aware FA text normalizer ported to Rust (`fa/text.rs`, unconditional — not behind `fa-inference`), replacing D2's ASCII-only placeholder tokenizer. Byte-identical port of `src/services/faTextNormalize.ts`, with two documented, tested deviations forced by Rust's lack of Unicode-normalization stdlib (hand-rolled NFC table; ECMA-262 `\s`-set whitespace split). | `997102e` | `cargo check` clean both configs; `cargo test` feature-off 31→46 (+15); feature-on 49→66 (+17); `npm run lint` clean; `npm test` 74→75 files, 1857→1894 (+37), 1 skipped unchanged; golden replay 6/6 unchanged. |
| **D4** | Skip hardening (`FA_REQUIRE_ORT=1` turns a silent ORT-missing skip into a hard failure); re-ran D2's parity tests for real for the first time since D3's tokenizer swap (0/577 mismatches, unchanged); NFC-completeness guard against an independently-generated 230-entry reference table; first end-to-end parity harness (real torchaudio `forced_align`/`merge_tokens` vs. the full Rust path) — **0 divergences, zero tolerance, across all 3 fixtures and 73 combined tokens/spans.** | `e1f6e57` | `cargo check` clean both configs; feature-off 46→47 (+1); feature-on ORT set+`FA_REQUIRE_ORT=1` 66→70 (+4), 0 skips; ORT unset/unset → 70 passed, 6 clean skips; ORT unset+`FA_REQUIRE_ORT=1` → 6 hard failures/64 passed; `npm run lint` clean; `npm test` 75 files/1894/1 skipped unchanged; golden replay 6/6. |
| **D5** | Closed the text→spans seam (already-closed-at-`e1f6e57` finding for en/es, re-verified live) and extended zero-tolerance e2e parity to fr/de/pt using real `google/fleurs` (CC-BY-4.0) audio, owner-approved after the private corpus was confirmed to have no fr/de/pt audio. | `c7834cd` | `cargo check` clean both configs; feature-off 47 unchanged; feature-on ORT set+`FA_REQUIRE_ORT=1` 70→73 (+3), 0 skipped; ORT unset/unset → 73 passed/9 clean skips; ORT unset+`FA_REQUIRE_ORT=1` → 64 passed/9 hard failures; `npm run lint` clean; `npm test` 75 files/1894/1 skipped unchanged; golden replay 6/6. Zero divergences on all three new languages (fr 65/230/65 tokens/frames/spans, de 61/269/61, pt 70/281/70). |
| **D6** | Frame→time conversion (`frame_to_seconds`, stride = 320 samples/16kHz — the product of the shared Wav2Vec2 `conv_stride`, sourced from each of the 5 languages' own HF `config.json`, confirmed byte-identical across all five). Closed 3 verification gaps: `EmptyTokenization`, missing-dylib `OrtInit`, and a live TS/Rust `FaErrorKind` drift (`'inferenceFailed'` was missing from `faBoundaryTypes.ts`'s union). **Recorded, not fixed, a doc-omission finding**: `fa.rs`'s own header comment was already stale as of this slice (see §6 below). | `b879ed5` | `cargo check` clean both configs; feature-off 47→48 (+1); feature-on ORT set+`FA_REQUIRE_ORT=1` 73→76 (+3), 0 skips confirmed across 6 repeated concurrent runs (caught and fixed a real test-order race, `ORT_ENV_LOCK`); ORT unset/unset → 76 passed/10 clean skips; ORT unset+`FA_REQUIRE_ORT=1` → 66 passed/10 hard failures; `npm run lint` clean; `npm test` 75 files/1894/1 skipped unchanged; golden replay 6/6. |
| **D7** | **CANCELLED as scoped — see §2.** No commit exists under this name. | — | — |
| **D8** | Pure `merge_char_spans_to_words`: groups `merge_tokens`' character-level `TokenSpan`s into word-level spans on the vocab word-delimiter id. Established, in code comments, that (a) `TokenSpan.score` is a mean LOG-probability, not directly comparable to `CONF_MIN`, and (b) word-level score is the per-character-span-frame-length-WEIGHTED mean, not an unweighted one — both later formalized as rulings, §4. Validated against all 6 e2e fixtures (word text + seconds, ~1e-16 max deviation) plus a hand-built drop-path case. No IPC/`FaEvent`/TS change — `align()`/`align_with_model_path` still return the pre-D8 shape. | `20588db` | `fa_onnx.rs` gained 17 `#[test]` functions (29→46, directly grep-verified against the commit's checked-out source), all feature-gated (`fa-inference`-only); feature-off count unaffected. Commit message states validation results only (no aggregate `cargo test`/`npm test` figures recorded in this commit) — this ledger does not restate a number the commit itself didn't record. |
| **D9** | Wired D8's word-merge into the real `fa_align` path: `align()`/`align_with_model_path` now return `Vec<WordSpan>` (word-level). `fa.rs`'s `fa_align` converts each into an `FaWordSpan` DTO sent as `FaEvent::Done { words }`, applying `exp(score)` at the IPC boundary — the confidence-unit ruling, §4. TS: `TranscriptToken` gained an optional `confidence` field; `faBoundaryTypes.ts` gained a pure `faWordSpansToTranscriptTokens` reshape producing exactly the shape `extractSegmentAlignments` already consumes — established but unwired (no `invoke()`, no hook, no component, no capability gate). | `49dce01` | `fa.rs` gained 4 `#[test]` functions (16→20, directly grep-verified), one unconditional (`fa_word_span_serializes_camelcase_field_names`), the rest feature-gated. New `faBoundaryTypes.test.ts` (44 lines). Ruling sanity-check recorded in the commit message itself: exponentiating D8's six fixture score ranges lands entirely in **[0.730, 1.0]** — see the confidence-unit finding, §5. |
| **D10** | Live-`AppHandle` composition trace confirmed the full typed chain (project audio → `fa_align` → D9's reshape → `extractSegmentAlignments`/`alignScenestoTranscript`) lines up, with one real gap: nothing in production leaves a durable WAV on disk for `fa_align` to consume (`whisper.rs`'s `transcode_to_wav` output is deleted moments after `whisper_transcribe` uses it). Closed with a new **dev-only** `fa_align_dev` (`fa_dev.rs`) that prepares its own throwaway WAV via the same helper and delegates to the real, unmodified `fa_align`. Added a pre-use SHA-256 manifest check (`sha256.rs`, hand-rolled to avoid a new `Cargo.lock` entry) against `fa-onnx-manifest.json`. **Fixed a real bug this slice's own trace surfaced**: `fa_align`'s error arm was flattening every `FaOnnxError::ModelNotFound` into `FaErrorKind::InferenceFailed`, discarding the more specific kind before it reached the frontend. Dev-only TS entry point `window.__faDevAlign` follows the `__transcriptInspector` precedent (DEV-gated, no UI control). Produced the duration-ladder and delta measurements — see `docs/ws1-sync-pipeline/measurements/d10-runtime-observations-2026-08-13.md`. | `3787b11` | `fa.rs` gained 2 `#[test]` functions (20→22, grep-verified); new `fa_dev.rs` (5 tests) and `sha256.rs` (5 tests), both **unconditionally compiled** (not behind `fa-inference` — confirmed via `lib.rs`'s `mod fa_dev;`/`mod sha256;` having no `#[cfg(feature = ...)]` guard, unlike `mod fa_onnx;`). Current `HEAD` (verified live during this documentation pass, 2026-08-13): `cargo test` feature-off **60 passed** (was 48 after D6; D8 added 0 to feature-off, D9 added 1 unconditional, D10 added 1 fa.rs + 10 fa_dev.rs/sha256.rs — reconciles to 48+1+11=60); `cargo test --features fa-inference` with `ORT_DYLIB_PATH` set + `FA_REQUIRE_ORT=1` **109 passed, 0 failed, 0 skipped**; `cargo check` clean both configs; `npm run lint` clean; `npm test` 76 files/1898 passed/1 skipped; golden replay 6/6. All match this task's own stated starting baseline exactly — re-verified live, not assumed. |
| **D11** | Replaced whole-file `fa_align` (infeasible at production length per D10) with per-CHUNK windowing: `src/services/faChunkPlan.ts`'s `computeFaChunkPlan` attributes each of `faAnchors.ts`'s unmodified `runs[]` a text via segment-`startTime` membership; `fa_onnx.rs`'s `align_chunked`/`align_chunked_for_language` loop the resulting `FaChunkInput[]`, one forward pass per chunk, reusing a session-scoped `FaModelCache` (`fa.rs`) instead of reloading the 1.2+GiB model per chunk. Added real cancellation (`FaErrorKind::Cancelled`, checked at every chunk boundary), `FaEvent::Progress{index,total}` per completed chunk, and a set of hard structural invariant checkers over the stitched output (monotonic times, no overlap, chunk-window containment, word-count-vs-normalizer, bounds, confidence range) — the "hard structural invariants" leg of the Automated Agreement Budget (§4 below). Shipped two `#[ignore]`d real-corpus measurement tests (`real_corpus_measurement` module) establishing the budget's other two legs (bounded-agreement, full-length sanity) but **deliberately did not draw a conclusion from running them** — that's Slice D12's job, not D11's. Still only reachable via `fa_align_dev`/`__faDevAlign` — no production wiring. | `eda13b1` | `cargo check` clean both configs; `cargo test` feature-off 60→**63** (+3, `fa.rs`'s unconditional `is_cancelled` state tests); `cargo test --features fa-inference` ORT set+`FA_REQUIRE_ORT=1` 109→**126 passed, 0 failed, 2 ignored** (+17: 14 invariant-checker tests, 2 cancellation-determinism tests, 1 net camelCase-shape rename); ORT unset/unset → 126 passed (clean skips folded in, unchanged pass count); ORT unset+`FA_REQUIRE_ORT=1` → 108 passed/18 failed (hard failures, as designed); `npm run lint` clean; `npm test` 76→**77 files, 1898→1902 passed, 1 skipped**; golden replay 6/6. Re-run live at Slice D12 landing (2026-08-13), not assumed from the commit message. |
| **D12** | Run coalescing (`coalesceRuns`, `faChunkPlan.ts`) merges adjacent R.0 runs up to a `coalesceTargetSec` ceiling ahead of text attribution; `computeFaChunkPlanCoalesced` is the coalesced sibling of D11's `computeFaChunkPlan`, still measurement-only (no production caller passes a target). Shipped the window-size-ladder (7/20/45/90s), attribution-isolation, and Whisper-triage measurement scripts/tests over the real 240s excerpt of the 173-project fixture. **Finding that reframed the rest of the workstream: ATTRIBUTION (which chunk a segment's text is assigned to), not window size, dominates chunked-alignment disagreement** — oracle-text chunks reached 0.08s max start disagreement at matched granularity, vs. 7.54s for the same granularity under the production `segment.startTime` rule. Full detail: `docs/ws1-sync-pipeline/measurements/d11-chunked-alignment-2026-08-13.md` (produced at this slice's landing pass, not D11's own commit). | `dda07b7` | `npm run lint` clean; gate figures not independently re-derived for this ledger row — see the commit's own message and the linked measurement doc. |
| **D13** | Index-derived text attribution (`FaTextAttribution = 'script-word-index'`, `faChunkPlan.ts`'s `runQiRanges`/`attributeByIndex`/`computeFaChunkPlanWithAttribution`): cuts chunk text at an anchor's own `qi` (script-word index) instead of `segment.startTime` membership — still measurement-only, `'segment-start-time'` remains the sole production default. **Provenance repair**: found and fixed a real bug where coalescing qi ranges by re-deriving them from a coalesced (provenance-lossy) run array desynced `qi` from time, inflating START p50 to 45.9s; fixed by `coalesceRunQiRanges`, which coalesces qi bounds in lockstep with time bounds in one pass over the original per-anchor ranges. Index attribution at 45s reached the D12 oracle-text bound closely (0.76s max vs. B-control-45s's 0.30s) without needing the oracle. Full detail: `docs/ws1-sync-pipeline/measurements/d13-index-attribution-2026-08-13.md`. | `1bc4523` | `npm run lint` clean; gate figures not independently re-derived for this ledger row — see the commit's own message and the linked measurement doc. |
| **D14** | Measurement closure: verified D13's Whisper-triage coincidence directly (SHA-256 + per-word tail, ruling out a self-comparison artifact); added `B-control-45s` (oracle-time attribution at 45s) so every combined-table row has a matched-window-size oracle counterpart; a per-chunk residual correlation against bounding-anchor timing error (weak, \|r\|≤0.24 — later superseded by D15's direct mis-assignment diagnostic, see below); **B1: shipped `.github/workflows/fa-ort-matrix.yml`**, automating the four-way `fa-inference`/ORT gate matrix previously run by hand — first real run failed all 4 cells on two environment bugs (missing `externalBin` sidecar placeholder, a macOS-`bsdtar` `--strip-components` miscount), fixed same-day in `8889a2e`, re-run green on all 4 cells. Full detail: `docs/ws1-sync-pipeline/measurements/d14-measurement-closure-2026-08-13.md`. | `450ad60` (+ `8889a2e` CI fix follow-up) | `npm run lint` clean; CI: first run (`31731286244`) failed all 4 cells, fix run (`31731983204`) green on all 4 cells. |
| **D15** | Direct word-by-word mis-assignment diagnostic (not correlation) between index-45s and B-control-45s, reconstructed from D13/D14's own on-disk JSON — no ONNX run. **5/569 words (0.9%) are assigned to a different chunk between the two rules; that set alone carries the entire START/END max and ~100x the correctly-assigned set's mean error.** Corrected the task's own boundary-sharing premise at 7s (index-7s has 29 chunks, its would-be B-control boundary source has 28 — they do not share identical boundaries, unlike at 45s) and flagged a data gap (no per-word aligned output for index-7s persisted to disk). Replaced D14's degenerate "B-control-as-budget" derivation with an explicit, owner-sign-off-pending 0.3s product-decision gate. Reconciled this ledger's own §6 known-gap register against current code (file:line, done/open per row) and recorded the Spanish gate as CLOSED / R-H as BLOCKED so neither is carried as open work again. Full detail: `docs/ws1-sync-pipeline/measurements/d15-mis-assignment-diagnostic-2026-08-13.md`. | `8975316` | `npm run lint` clean; protected files (`faAnchors.ts`, `faTextNormalize.ts`, `syncConstants.ts`, `Cargo.lock`, `scripts/fixtures/`, `fa-e2e-alignment-*.json`, `project-state.md`, `CLAUDE.md`, `docs/history.md`) empty diff, verified. |
| **D16** | **A0**: audited all 11 commit hashes claimed across D1-D15 (`49e233a`…`450ad60`) — all exist on `main`, all messages match their claimed slice, all changed-file sets match what each slice reported shipping. No phantom commits found; `dda07b7`/D12 and `1bc4523`/D13 are correctly attributed everywhere in the repo's own docs (no in-repo document was found asserting the reverse). **A1**: traced the D15 mis-assignment set's root cause directly against real corpus data (Whisper token timestamps, silence intervals, live `computeFaAnchors` output) — for all 5 mis-assigned words, the anchor governing the seam is a DIFFERENT word than the mis-assigned one (the next admissible word in script order), and that anchor's own Whisper token `startSec` sits on the SAME (near) side of the boundary as where production placed the mis-assigned word in every case — never the far side. Classified **cause (iii): Whisper's own token-boundary placement near these seams disagrees with the true acoustic onset (per the whole-file FA reference) by 0.1-0.7s, and nothing available to `faChunkPlan.ts`/`faAnchors.ts` before running alignment reveals this — the residual is Whisper-intrinsic, not a local chunk-plan bug.** Per the task's own constraint, this is a STOP: no code change, no overlap/padding/tolerance mechanism added. **A3**: retires the whole-file-agreement-proxy measurement effort (`docs/ws1-sync-pipeline/measurements/README.md`) since D13's own Whisper-triage finding already showed index-45s is statistically indistinguishable from the whole-file reference against real, independent (Whisper) ground truth. **A4**: `docs/ws1-sync-pipeline/task5-integration-scope.md` — integration is not yet scoped; names the blocking product decision (no consumer of FA word timings exists in any active roadmap item today). **B1**: confirmed `fa-ort-matrix` green on a second, independent (`workflow_dispatch`) run (`31733694464`) — not a one-off. | (docs-only slice — no `src`/`src-tauri` commit; this row's own commit is the D16 doc/ledger update) | `npm run lint` clean; CI: `31733694464` green on all 4 cells (second independent run, confirming `31731983204`). |

**On D8/D9's missing aggregate gate numbers.** Unlike D2–D6 and D10, the D8 and
D9 commit messages do not restate full `cargo test`/`npm test`/golden-replay
figures — they describe validation results (fixture parity, drop-path
coverage) instead. This ledger reports what each commit's checked-out source
actually contains (test-function counts, grep-verified) rather than
inventing aggregate numbers the commits themselves never recorded.

---

## 2. D7 — cancelled, not completed

**D7 does not exist as a commit.** Its planned scope — per D6's own closing
line ("No windowing/chunking/stitching/cancellation/span-consumption/
asset-resolution work — out of scope, deferred to D7 per the slice's own
boundary") — was to build the production windowing/stitching path (Step R,
`sync-pipeline-v2-plan.md`) and a verification method for it. That slice's
own **Step 0 review** (scoping-before-building, per this project's standing
practice) found three things that together made the originally-scoped D7
un-buildable as planned, and it was cancelled rather than reshaped
silently:

1. **Step R's boundary logic was already landed in TS, not still "design
   only."** `faAnchors.ts` (Slice D1, `e0c9c89`) directly implements R.0 (the
   run/anchor governing change), R.1 (three-source-agreement anchors, with
   the R-O/R-P admissibility rulings), and R.4 (`MAX_RUN_SEC` force-split,
   including the R-P longest-silence-in-window selection rule) — verified by
   direct reading of `computeFaAnchors`, `isDistinctive`,
   `contiguousMatchRunLength`, `findAgreeingSilence`, and
   `longestSilenceInWindow` in `src/services/faAnchors.ts`. R.6's boundary
   shape (corpus-start/corpus-end sentinels) is also present in the same
   function's `boundaries` array construction. What remains genuinely
   design-only is R.2 (padding), R.3 (the clamp's reference-point change),
   R.5 (the CTC wildcard for unscripted audio), and R.7–R.9 (failure paths,
   the cascade-safety argument, the case-by-case prevention table) — none of
   which exist in any TS or Rust source as of this documentation pass. D7 as
   originally scoped ("build the production windowing path") would have
   redone work already done and left the actually-undone pieces unscoped.
2. **`scripts/measure-forced-alignment.py` is the superseded per-segment
   anti-pattern, not a stitching reference.** Verified directly: its own
   `align` subparser aligns each segment's own text against "a padded window
   of the audio around that segment's own already-committed
   [startTime, startTime+duration) window" (`measure-forced-alignment.py`'s
   own docstring/help text) — this is exactly the "the window is exactly the
   committed span, which is the very quantity under repair" failure mode
   Step R's opening paragraph (`sync-pipeline-v2-plan.md`) was written to
   replace. A D7 that used this script as its "known good" reference would
   have measured windowing correctness against the mechanism windowing
   exists to eliminate.
3. **Windowed multi-pass and whole-file single-pass are different
   algorithms with no guaranteed frame equivalence.** This is a reasoned
   architectural conclusion from the Step 0 review, not a repo-measured
   fact: a CTC forward pass's emission at a given frame is a function of
   everything the acoustic model's receptive field can see at that frame,
   which differs between a run-scoped window (R.0's bounded, padded span)
   and a whole-file pass — and the Viterbi DP's chosen path additionally
   depends on the full target-token sequence length being aligned in that
   pass. Two runs of the same audio at different window scopes are not
   guaranteed to agree on a shared boundary to the frame, even when both are
   individually correct. This directly rules out the originally-implicit
   idea of using a whole-file single pass as a **zero-tolerance** ground
   truth to diff windowed output against, the same zero-tolerance bar D4/D5
   already established between Rust and torchaudio for a *fixed* window.
   D10's own finding (a whole-file pass is infeasible at production length,
   60–150 GB projected vs. 32 GB available — see the measurements doc) makes
   this doubly moot: there will never be a whole-file pass on real audio to
   diff against, even if the equivalence problem above didn't exist.

**Disposition:** the windowing/stitching verification problem D7 was meant
to solve is real and still open (see "Known-gap register," §6), but "diff
windowed output against a whole-file pass, byte for byte" is not a coherent
verification method for it. The replacement standard — the **Automated
Agreement Budget** — is recorded as a new ruling, §5.

---

## 3. Corrected assumptions

Each of these was believed at some point in Task 5 and established false by
direct reading during this documentation pass (or, where noted, at the
slice that found it).

1. **The "no prebuilt onnxruntime ≥1.27 for macOS x86_64" blocker was a
   default Cargo feature, not a real constraint.** `ort`'s `api-NN` features
   are a configurable minimum-version floor; disabling them (as D2's
   `Cargo.toml` entry does — `default-features = false`, `["std",
   "load-dynamic"]`, no `api-NN` feature) drops the floor to 17, which
   onnxruntime-osx-x86_64 1.23.2 satisfies. R-M's "from-source onnxruntime
   build required" premise is therefore void. Established at the
   runtime-unblock investigation (`docs/ws1-sync-pipeline/measurements/
   runtime-unblock-2026-08-12.md`, commit `55e2ad5`) and confirmed still the
   live configuration by reading `src-tauri/Cargo.toml` and `fa_onnx.rs`
   during this pass. **R-M's status in `project-state.md` remains formally
   unratified** — that file is out of scope for this documentation pass
   (see `docs/work-in-progress.md`'s permanent process rule) and is not
   touched here.
2. **`faAnchors.ts` is strictly UPSTREAM of FA, not a consumer of
   `TokenSpan`.** Confirmed by direct reading: `faAnchors.ts` imports only
   `TranscriptToken`, `TokenAlignment`/`TokenAlignmentOp`, `SilenceInterval`,
   `canonicalize`, and `syncConstants` — no import of `fa_onnx`, `TokenSpan`,
   `WordSpan`, or anything FA-output-shaped anywhere in the file. Its own
   header comment states the reason directly: it "runs strictly before any
   FA pass and has no FA-confidence input in its stated shape." This
   resolves any suspicion that `faAnchors.ts` and the FA pipeline overlap in
   responsibility — they are sequential (anchors first, FA second), not
   peers.
3. **`anchorSource` is effectively write-only; nothing in production
   branches on it.** Confirmed: `anchorSource` is *set* at 3 call sites
   (`App.tsx:3606` → `'forced-alignment'`, `whisperService.ts:1501` →
   `'whisper'`, `syncEngine.ts:241` → `'estimate'`) but grepping every
   production file for a read of the field that branches on its value
   returns nothing — the one place a demotion used to happen was removed
   in slice "3e," with the removal's own comment (`App.tsx:2591`) stating
   plainly: "nothing branches on `anchorSource` post-clean-slate, and the
   next sync rebuilds segments from scratch via `parseProjectData` anyway,
   so demoting the outgoing segments was dead work." The field is populated
   for provenance/debugging and future use, not consulted by any runtime
   decision today.
4. **Multi-segment attribution does not need building in Rust.** Hirschberg
   alignment (`whisperService.ts`'s `alignQueryToSubject`, already shipped)
   already provides script-word-to-transcript-token attribution with fuzzy
   tolerance a Rust-side exact/positional attribution scheme would lack.
   `fa_onnx.rs`'s own scope-boundary comment states this directly:
   "multi-segment span attribution beyond simple token-count bookkeeping" is
   listed as deliberately out of scope, "later, separately-decided slices."
   No Task 5 slice has built a competing Rust-side attribution mechanism.
5. **`fa_align` and `fa_cancel` were already registered in `lib.rs`.**
   Confirmed: `src-tauri/src/lib.rs`'s `invoke_handler!` list includes
   `fa::fa_align`, `fa::fa_cancel`, and (since D10) `fa_dev::fa_align_dev`
   directly — this was not an outstanding wiring task at any point in
   D1–D10; the commands have been IPC-reachable (module-registered) since
   the D1 command-surface skeleton landed.
6. **`measure-forced-alignment.py` is not an authoritative reference for
   production windowing/stitching.** See §2, point 2 — it is the
   per-segment measurement convenience Step R's own R.0 was written to
   replace, confirmed by direct reading of its `align` subcommand's own
   docstring.

---

## 4. Rulings

### Span consumption — Option 2 (word-merged spans over `FaEvent::Done`, TS reshape)

**Decided:** character-level `TokenSpan`s are merged to word-level `WordSpan`s
in Rust (D8's `merge_char_spans_to_words`), sent across IPC as `FaEvent::Done
{ words: Vec<FaWordSpan> }` (D9), and reshaped in TS
(`faBoundaryTypes.ts`'s `faWordSpansToTranscriptTokens`) into exactly the
`TranscriptToken[]` shape `extractSegmentAlignments`/
`alignScenestoTranscript` already consume — those two functions are
UNCHANGED by Task 5.

**Rejected alternatives, and what would have to be true for each to become
preferable:**
- **Option 1 — ship raw character-level `TokenSpan`s across IPC, reshape
  characters into words in TS.** Would move the word-boundary-detection
  logic (splitting on the delimiter id, reconstructing word text) to the TS
  side, duplicating vocab knowledge (`char_to_id`/`word_delim_id`) that
  otherwise lives only in Rust. Would become preferable only if a future
  consumer needed character-level timing directly (none does today).
- **Option 3 — do the TS reshape work in Rust and hand TS a
  `TranscriptToken[]`-shaped payload directly, skipping the intermediate
  `FaWordSpan` DTO.** Would couple the IPC wire type to a TS-only interface
  shape and lose the `confidence`-as-probability boundary conversion's
  natural home (see the confidence-unit ruling below). Would become
  preferable only if `FaWordSpan` and `TranscriptToken` converge to
  identical fields with no future divergence expected — not true today
  (`TranscriptToken` carries fields FA has no opinion on, e.g. token
  indices used elsewhere in the sync pipeline).

### Confidence unit — resolved SPEC DEFECT, not an implementation detail

**The defect:** `fa_viterbi.rs`'s `merge_tokens`/`log_softmax_row` produce
`TokenSpan.score`/`WordSpan.score` as a **mean LOG-probability** — always
`<= 0`, unbounded below. `syncConstants.ts`'s `CONF_MIN = 0.3` is written and
consumed everywhere else as a **probability** in `[0, 1]`. These are
incompatible units; comparing a log-probability directly against `CONF_MIN`
would never trip the gate (a genuine probability of 0.3 is a log-probability
of roughly -1.2, and most real log-probabilities near correct alignments sit
close to 0). This was found at D8, explicitly deferred ("this slice
deliberately does not perform" the conversion), and resolved at D9.

**Ruling:** `exp(score)` is applied exactly once, at the IPC boundary
(`fa.rs`'s `word_span_to_dto`), converting the internal log-probability into
a `[0, 1]` probability (`FaWordSpan.confidence`) before it ever reaches TS.
`CONF_MIN` itself is unchanged — the fix is entirely on the producer side of
the boundary, so nothing downstream needs to know `WordSpan` ever carried a
log-probability. Verified directly: `word_span_to_dto` computes
`w.score.exp()`, unit-tested against both the `score = 0.0 → confidence =
1.0` and `score = -1.0 → confidence = 1/e` cases.

This is recorded as a **resolved spec defect** (the original design implied
a unit that never existed in the data), not an implementation detail,
because it would have produced a gate that could never fire — a silent
correctness bug, not a style choice.

### Score aggregation across a word — weighted by frame length

**Decided (D8):** a word's score is the mean of its constituent character
spans' scores, **weighted by each character span's own frame length**
(`end - start`), not an unweighted mean across characters. Justification
recorded in `fa_onnx.rs`'s own comment: each character span's score is
already a mean over its own frame extent, so a length-weighted mean across
characters is what directly averaging the underlying per-frame log-probs
across the word's whole character-bearing frame range would give — an
unweighted mean would over-count short characters relative to long ones.

### Capability gate — dev-only is a phase, not the endpoint

**Ruling:** the current dev-only reachability (`fa_align_dev`/
`window.__faDevAlign`, DEV-gated, no UI control — Slice D10) is acceptable
as an interim verification vehicle but is **not sufficient** for FA to
become the production timing source. A user-visible, capability-probed
Settings toggle — following `useExport.ts`'s WebCodecs-capability-probe
precedent (probe once, expose a toggle only when the probe succeeds, degrade
to the existing path otherwise) — is **required** before any Apply-Sync code
path may call `fa_align` for real segment timing. This is a new ruling,
recorded here for the first time; no prior WS1 document states it. Rationale:
FA depends on a multi-gigabyte per-language model an operator must place by
hand today (Step T's on-demand downloader doesn't exist yet, R-D), a
degraded/unavailable state needs a discoverable, revocable control, and every
other heavyweight-optional feature in this codebase (WebCodecs export) is
already gated the same way — introducing a second gating pattern for FA
would be an unforced inconsistency.

### Caching — deferred at D2, now justified by D10's own measurement

`fa_onnx.rs`'s own header comment has recorded since D2 that "a 1.2+ GiB
ONNX file is reloaded on every `align()` call today — a real cost, deferred"
— deferred at the time for lack of a concrete latency number to weigh
against the implementation cost. **D10 supplies that number**: peak memory
during a single `fa_align_dev` run scales super-linearly with clip length
(see the measurements doc), and repeated whole-model reloads on a run-scoped
(post-windowing) calling pattern would multiply both the reload cost and the
peak-memory cost across every run in a project. **Ruling:** this now
justifies building a session-scoped model cache (one loaded ONNX session per
language, held for the lifetime of a sync run or an explicit
Settings-toggle-driven "FA enabled" session, evicted on language change or
app/session end) as part of the windowing-and-wiring slice that eventually
lands R.0-R.9 for real — not before, since caching a model that's reloaded
once per dev-invocation today has no measurable payoff yet.

### R.5 wildcards — ship without them initially

**Ruling:** the first production-facing FA windowing implementation ships
**without** R.5's CTC-wildcard mechanism for unscripted audio, relying
instead on Hirschberg's own existing degradation behavior (an unscripted
heading recitation simply fails to match any script word and is absorbed by
whichever neighboring segment's boundary placement already handles it today
— the same behavior the shipped pipeline has now, pre-FA). This is
**revisitable, because it is gated**: R.5 sits behind the same
capability-gated Settings toggle as the rest of FA (see above), so adding it
later is an additive change behind an already-off-by-default surface, not a
breaking one. Rationale: R.5's own text already flags its output-destination
question (which segment absorbs the wildcard gap) as needing an owner ruling
before implementation, and Step R.9's own table shows R.5 as only a
**partial** fix for the unscripted-heading case even once built — shipping
the simpler, already-working degradation first and layering the wildcard
mechanism in later is lower-risk than blocking the rest of FA on it.

### Windowing verification standard — the Automated Agreement Budget (NEW)

D7's cancellation (§2) established that a zero-tolerance fixture diff
against a whole-file pass is not a coherent verification method for
windowed production output — no whole-file pass is even computable at
production audio length (D10), and even where one is computable, windowed
and whole-file are different algorithms with no guaranteed frame-level
equivalence. The replacement standard, ruled here for the first time:
**three independent automated checks**, none of which is a byte-for-byte
diff against an unwindowed reference:

1. **Bounded-agreement check.** At a duration where BOTH a windowed pass and
   a whole-file pass are computable (short clips — the existing 3.6–5.64s
   e2e fixtures qualify), windowed output must agree with the whole-file
   pass within a budget **derived from measurement**, not asserted — e.g.
   the D4/D5 zero-tolerance bar applies only within a single fixed window;
   a budget for cross-window agreement must be measured fresh once
   windowing exists, the same way `PAD_BASE`/`ANCHOR_AGREEMENT_SEC` were
   derived from the corpus's own silence statistics rather than chosen.
2. **Hard structural invariants**, checked at any audio length regardless of
   whether a reference pass exists: Model P's no-gap guarantee
   (`faAnchors.ts`'s own I1/I2 comment: "this function never produces a
   gap... a run boundary belongs to both the run that ends there and the
   run that starts there"), monotonic run ordering, and R.8's bounded
   (not zero) cross-word coupling claim within a run.
3. **FA-vs-Whisper delta distribution as a full-length sanity check.** D10's
   own observational measurement (anchorStart delta over 64 real segments,
   see the measurements doc) is the first instance of exactly this check —
   not a pass/fail gate on its own, but a distribution that should stay
   stable (not develop new outliers) as windowing is layered in.

No fourth check substitutes a whole-file pass at production length for
anything — that comparison is permanently unavailable per D10's own memory
finding, not merely deferred.

---

## 5. Findings referenced above, stated once

- **`exp(score)` fixture range: [0.730, 1.0], all six e2e fixtures** (D9
  commit message). Consequence: **R.7's `CONF_MIN` (0.3) gate is untestable
  on any fixture this repo currently has** — every committed fixture's
  confidence sits far above the floor, so no existing test exercises the
  gate's reject branch on real model output. This is a coverage gap, not a
  defect in the gate itself.
- **`conv_stride` = 320 samples → exactly 0.02s/frame at 16kHz** (D6),
  sourced from each of the five jonatasgrosman languages' own HF
  `config.json`, confirmed byte-identical across all five before being
  written as a constant — deliberately not derived from the unrelated
  MMS_FA-based `fa-emission-*.json` fixtures' own empirically-measured (and
  per-clip-drifting) frame rate.

Full duration-ladder and delta measurements:
`docs/ws1-sync-pipeline/measurements/d10-runtime-observations-2026-08-13.md`.

---

## 6. Known-gap register

| Gap | Status | What unblocks it |
|---|---|---|
| **Windowing (R.0/R.1/R.4 landed in TS; R.3/R.5/R.7-R.9 not implemented anywhere; R.2 CLOSED-NEGATIVE)** | **Open (R.3/R.5/R.7-R.9), R.2 CLOSED-NEGATIVE (D24)** | D11-D14 built real windowing EXECUTION on top of R.0/R.1/R.4 (`faChunkPlan.ts`'s `computeFaChunkPlan`/`computeFaChunkPlanWithAttribution`, `fa_onnx.rs`'s `align_chunked`) plus measurement-only index-attribution and B-control legs. **R.2 (padding)**: D23 implemented `align_chunked_with_padding` (evidence-backed default 0.5s, from D22 Step 4's seam-proximity finding) and measured a net-UNFAVORABLE result (below-CONF_MIN tail 155→164, seam concentration 83.9%→85.4%). D24's own A1 diagnostic then tested the specific mechanism D23's implementation was built on — untokenized pad-region speech smearing into decoded edge-word timing — directly against the on-disk padded/unpadded per-word JSON: **0/236 edge-word checks show a timestamp escaping its own chunk's window in either run**, confirmed both architecturally (the padded forward pass's emission is sliced back to the exact unpadded frame count before Viterbi decode — smear is structurally impossible, not just unobserved) and empirically. The real effect is ordinary acoustic-context-sensitivity of the emission distribution near a hard edge (sometimes un-railing a word from the artificial boundary, sometimes not), not pad-speech contamination. No fixable cause was identified, so `align_chunked_with_padding`/`align_chunk_samples_padded`/`FA_R2_DEFAULT_PADDING_SEC` and their `d23_measurement` harness (`full_709s_padding_before_after`) were DELETED (`fa_onnx.rs`) rather than kept as unwired dead code — full evidence: `docs/ws1-sync-pipeline/d24-r2-post-mortem-durable-audio-path-2026-08-14.md`. **R.2 does not need to be re-attempted under the untokenized-pad-speech hypothesis by a future slice — that hypothesis is falsified, not merely unconfirmed.** R.3/R.7/R.8/R.9 remain design-only in `sync-pipeline-v2-plan.md`; R.5 is tracked separately below. None of this work is production-wired regardless (still `fa-inference`-feature-gated, dev-only `__faDevAlign`). |
| **CTC-infeasibility under production windowing (2/97 chunks at 709s, D11/D20)** | **CLOSED (D21/D22)** | D20 shipped a skip+flag fallback (`align_chunked`'s `TooManyRepeats` match arm) so a CTC-infeasible chunk no longer aborts the whole run — but D20 itself left the ROOT CAUSE (`segment.startTime` text attribution assigning an entire stale segment's text to a too-narrow real window) unaddressed, and found `CONF_MIN` flagged 62.75% (1014/1616) of the real corpus's genuinely-aligned words, "close to uninformative" by its own Step 6 wording. D21 measured that switching to `'script-word-index'` attribution (D13, previously measurement-only) removes BOTH real CTC-infeasibility cases outright (0/1643 fallback fires on the same real 709s corpus, regression-guarded by `full_length_709s_index_attribution_single_call`'s own `assert_eq!(fallback_count, 0, ...)`) and drops the below-`CONF_MIN` fraction to 9.43% (155/1643) — see `d21-attribution-confmin-2026-08-14.md`. D22 made `'script-word-index'` the chunked-path planner's own internal default (`computeFaChunkPlanWithAttribution`'s `attribution` parameter now defaults to it; `'segment-start-time'` stays reachable by explicit parameter, and `computeFaChunkPlan` — the only function any current script/test caller actually invokes — is unchanged) and re-verified the zero-fallback regression guard still holds after the flip. The D20 fallback itself is UNCHANGED and stays in place as a safety net for whatever index attribution doesn't cover — this is a root-cause fix layered under it, not a replacement. Still gated OFF and inert in production either way (`isFaGateOpen()`, D17) — closing this gap changes no shipped behavior. See also D20's own doc, dated-correction block. |
| **Model caching** | **Done (D11)** — verified accurate here | `fa_onnx.rs`'s `CachedSession` struct (`fa_onnx.rs:688`) and `with_cached_session` (`fa_onnx.rs:700`) hold one loaded ONNX `Session` per `(language, resolved model path/size/mtime)` key; `align_chunked` (`fa_onnx.rs:798-836`) calls it once per run, reusing the same session across every chunk in that run and across later calls in the same process, evicting only on a key mismatch (language change or a different model file) — confirmed by direct reading, matching this document's own §1 D11 entry ("reusing a session-scoped `FaModelCache`... instead of reloading the 1.2+GiB model per chunk"), which this row previously failed to reflect. |
| **Cancellation is inert** | **Done (D11)** — verified accurate here | Stale as of this row's original wording (pre-D11). `align_chunked` (`fa_onnx.rs:798`) now checks `is_cancelled` before chunk 0 (`fa_onnx.rs:807`) and again before every subsequent chunk (`fa_onnx.rs:819`), returning `Err(FaOnnxError::Cancelled)` immediately with no partial word list. Proven by a real, deterministic test — `mod cancellation`'s `cancellation_stops_before_completing_all_chunks_deterministically` (`fa_onnx.rs:3631+`) scripts a cancel that fires after exactly 2 of 4 chunks and asserts the loop stops there, not merely "eventually." |
| **Production audio path (the dev tool makes its own WAV)** | **Durable cache built (D24 B1/B2), still UNWIRED — no production caller** | `fa_align_dev` exists precisely because no production caller leaves a durable WAV on disk. Still true after D11-D14: `faWordSpansToTranscriptTokens` (`src/services/faBoundaryTypes.ts:117`) has exactly one caller, `src/App.tsx`'s DEV-only `__faDevAlign` harness (`App.tsx:3498-3499`, `import.meta.env.DEV`-gated, no UI, no production `invoke()`). **D24** built the missing piece the capability-gated Settings-toggle wiring will need: `fa.rs`'s new `ensure_durable_wav` transcodes via `whisper.rs::transcode_to_wav` UNCHANGED into a durable, LRU-retained cache under `app_local_data_dir()/fa-audio-cache/` (key = source-file identity, name+size+mtime hashed, mirroring `syncEngine.ts`'s existing `getFileIdentity` precedent; 2 GiB LRU eviction cap) instead of `whisper_transcribe`'s delete-on-exit temp scope — full design/evidence: `docs/ws1-sync-pipeline/d24-r2-post-mortem-durable-audio-path-2026-08-14.md`. **Still has no caller anywhere** — the capability-gated Settings-toggle slice (§4's ruling) is what will actually invoke `ensure_durable_wav` from a real Apply-Sync path; this slice only proves the function is reachable and correct via direct tests of its pure core (no `AppHandle` test-mocking precedent exists in this codebase to exercise the async wrapper itself). |
| **R.7 gate untestable** | **Open, re-confirmed (D15)** | `CONF_MIN = 0.3` (`syncConstants.ts:536`) is still defined but unconsumed by any test — grepped, no fixture in the repo constructs a deliberately low-confidence case. Needs either a deliberately-constructed low-confidence fixture or real-world low-confidence audio; none exists in the repo today. Unchanged by D11-D14 (real-corpus measurement work, not synthetic fixture work). |
| **R.5 wildcards** | Deliberately deferred (§4 ruling) | Ships after the capability-gated toggle, additive, once an owner ruling on wildcard-gap destination lands (R.5's own open question). |
| **CI automation of the four-way ORT matrix** (feature off / feature-on×ORT-set / feature-on×ORT-unset / feature-on×`FA_REQUIRE_ORT`) | **Done (D14 B1), confirmed non-flaky (D16 B1)** | `.github/workflows/fa-ort-matrix.yml` runs all four cells on every push/PR touching the FA Rust surface. First real run (`31731286244`) failed all 4 cells on two bugs never reproduced locally (a missing `externalBin` sidecar-resource placeholder that `tauri-build`'s `build.rs` requires unconditionally, and a macOS-`bsdtar`-specific `--strip-components` miscount on the onnxruntime release tarball); both fixed, re-run (`31731983204`) is green on all 4 cells — https://github.com/mohtashim9119-web/kinetix-pro-studio/actions/runs/31731983204. **D16**: triggered a second, independent run via `workflow_dispatch` (`31733694464`) to rule out a one-off — also green on all 4 cells. **Not added to required status checks**: `main` currently has no branch protection at all (`GET /branches/main/protection` → 404 "Branch not protected"), so there is no existing required-checks list to append to; creating branch protection from scratch is a repo-settings change with a blast radius beyond this workflow (it would start gating every future push/PR to `main`) and was left to the owner rather than done unilaterally. |
| **R-H judgement** (the FA-swap-reviewed-against-baseline half of ruling R-H) | **BLOCKED on a per-language model, not merely Open (D15 restatement)** | `ws1-master-roadmap.md:108-113`: "the FA swap itself is then run and reviewed per-boundary against that new baseline... cannot happen until Task 5 wires a real per-language model, so it is recorded here as a hard precondition on that slice." Still true after D11-D14 (no production per-language-model wiring landed) — do not carry this as generically "Open" work again; it is specifically blocked on the capability-gated production wiring slice, not on anything achievable within a measurement-only slice. |
| **Spanish gate signoff** | **CLOSED, not a gap (D15 citation added)** | Cleared 2026-08-11 — `docs/ws1-sync-pipeline/spanish-gate-scoring.md:40`: "Step F breath-aware \| 30.3ms \| **50.4ms** \| 1183.7ms \| 1 of 22 \| PASS" (p95 50.4ms vs. the 250ms gate). Listed here only to confirm it is not accidentally re-opened by this register. |
| **Live-`AppHandle` coverage** | **Partially closed by D10** — verified accurate here | Before D10, every FA test drove either a hand-rolled path (`fa_models_dir()`-style helpers) or `align_with_model_path` directly, never a real `tauri::AppHandle`. D10's `fa_align_dev` is the first exercise of `fa_model_path`'s real `AppHandle`-based resolution (`app.path().app_local_data_dir()`) outside a test double — confirmed by reading `fa_dev.rs`'s own header comment and `fa_model_path`'s signature. Still not covered: a **production** (non-dev, capability-gated) call path through a live `AppHandle` — D10 closes the dev-tool half of this gap, not the production half. Unchanged by D11-D14. |

---

## 6a. Track ownership (for a future two-agent split)

Not previously recorded anywhere in the repo — added at D16 so a future
parallel-track split doesn't collide by omission. Reflects how D16 itself was
scoped:

- **Track A** — git/commit-history audits of this workstream; `src/services/
  faChunkPlan.ts` and `faChunkPlan.test.ts`; **`src-tauri/src/fa_onnx.rs`
  (explicit — the ONNX/inference Rust surface belongs to Track A, not Track
  B)**; `scripts/fa-*` (the measurement/dumper scripts under that prefix);
  `docs/ws1-sync-pipeline/measurements/`.
- **Track B** — `.github/workflows/` (the FA CI matrix and any future FA
  workflow); `docs/ws1-sync-pipeline/` documentation other than
  `measurements/` (roadmap, plan, this ledger's prose sections).

`src-tauri/src/fa.rs`/`fa_dev.rs`/`fa_viterbi.rs`/`fa/text.rs` are not yet
assigned to either track by name — the only prior collision risk identified
was `fa_onnx.rs`, now resolved above.

---

## 7. Cross-references

- **Windowing design itself (R.0–R.9), the full spec text** — owned by
  `sync-pipeline-v2-plan.md`'s Step R section. This document does not
  restate the design, only which pieces are implemented and the ledger of
  what shipped around it.
- **Phase/stage status, NEXT UP block** — owned by `ws1-master-roadmap.md`.
- **Task-level one-line status** — owned by `docs/work-in-progress.md`'s
  task 5 entry, which now points here for slice-level detail rather than
  carrying it inline (D1–D6 remain inline there as previously recorded;
  D7–D10 are recorded only here, to avoid the same fact living in two
  places going forward).
- **Duration ladder, memory, and delta measurements** — owned by
  `docs/ws1-sync-pipeline/measurements/d10-runtime-observations-2026-08-13.md`.
- **D11's real-corpus chunked-alignment measurements** (240s agreement table,
  per-chunk word-density breakdown, 709s memory/wall-clock, the 2/97
  CTC-infeasibility cases, and an explicit "conclusions NOT yet supported"
  section) — owned by `docs/ws1-sync-pipeline/measurements/
  d11-chunked-alignment-2026-08-13.md`. Produced at Slice D12's landing pass,
  not at D11's own commit.
- **D12's window-size-ladder/attribution-isolation/Whisper-triage
  measurements** (the finding that attribution, not window size, dominates
  chunked-alignment disagreement) and **D13's index-attribution measurements**
  (whether an index-derived rule reaches D12's oracle bound without the
  oracle; `faChunkPlan.ts`'s `computeFaChunkPlanWithAttribution`, a
  measurement-only `'script-word-index'` text-attribution mode alongside the
  unchanged production `'segment-start-time'` one) — owned by
  `docs/ws1-sync-pipeline/measurements/d13-index-attribution-2026-08-13.md`,
  which also carries the D12-vs-D13 combined agreement table.
- **D14's measurement closure** (Whisper-triage plumbing verification,
  `B-control-45s`, the anchor-time-error residual correlation, and a
  since-superseded budget derivation) and **D15's mis-assignment
  diagnostic** (the direct word-by-word mechanism behind D14's own
  correlation finding, a replacement product-decision timing gate, and a
  sample-adequacy scope) — owned by
  `docs/ws1-sync-pipeline/measurements/d14-measurement-closure-2026-08-13.md`
  and `docs/ws1-sync-pipeline/measurements/d15-mis-assignment-diagnostic-2026-08-13.md`
  respectively.
- **The ort/onnxruntime runtime-unblock investigation** — owned by
  `docs/ws1-sync-pipeline/measurements/runtime-unblock-2026-08-12.md`.
- **R-M/R-N ratification into `project-state.md`** — still pending owner
  approval per the permanent process rule (`docs/work-in-progress.md`,
  `ws1-master-roadmap.md` §9); untouched by this documentation pass, which
  is explicitly scoped away from `project-state.md`.
