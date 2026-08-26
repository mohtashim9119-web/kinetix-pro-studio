# Work In Progress

> **Purpose:** the active task ledger — one line per task, no narrative. **Line cap: 250.**
> Full history: `docs/history-2.md` (append-only). Standing reference material (frozen rulings,
> dead ends, not-yet-built specs): `sync-pipeline-v2-plan.md` Part AK. Overflow: move finished
> work to `docs/history-2.md`, reference material to the plan doc, then re-measure. Original
> header text: `sync-pipeline-v2-plan.md` Part AK.4.

---

> ⚠ **SINGLE-TRACKER RULE (covers every workstream):** No additional tracking or status files
> may be created for WS1, WS2, or any future workstream. All task progress, open decisions, and
> roadmap steps go directly in this file — each workstream under its own top-level section — or
> get appended to `sync-pipeline-v2-plan.md`.

---

## WS1 — Sync Pipeline Rewrite
Started: 2026-08-04 | Status: active — Phase 3 in progress, accuracy bar met (see below)

### Finished

*One-liners only — full detail for every item below: `docs/history-2.md`.*

- **Phase 1b** — `window.__transcriptInspector()` dev instrumentation, feeding Stage 1's numeric thresholds.
- **Phase 2a** — Whisper → `ggml-large-v3-turbo.bin` + `Project.language`/unsupported-language guard (2026-08-05).
- **Phase 2b** — DTW measured and abandoned; forced alignment chosen; Stage 1's 4 thresholds finalized (2026-08-05).
- **Phase 3b** — 5 fr/es/de/pt normalization rules shipped in `faTextNormalize.ts`; single-word-output ruled permanent (2026-08-15).
- **Phase 3c** — 19 compound-word cases audited; unfixed timing ruled correct, accepted Stage 1 defect (2026-08-15).
- **Phase 3d** — skipped per its own trigger (−45dB threshold not binding, 2026-08-05); dormant as of the 2026-08-25 freeze.
- **Sessions A–AN** — Phase 3's forced-alignment research arc (2026-08-15–24): rulings, rules R.5/R.10–R.15, Zero-Defect Register triage; chunk-edge research now frozen under the accuracy-bar ruling below.
- **Mover-audit dossier** — owner-scored 22/24 (Session K, 2026-08-18), both failures fixed via R.13; scored result recorded in `docs/history-2.md`, not the on-disk dossier file.
- **FA session-cache OOM fix** — root-caused (build-then-drop ONNX session eviction), fixed (drop-then-build, `6a1b939`), guardrail added (`c295cb3`), real-app confirmed. `docs/history-2.md#2026-08-25--6a1b939--6a1b939-fa-session-cache-oom-fix`

### In progress

We're in Phase 3 (Task 5), past 3b/3c (closed) and 3d (skipped, dormant). Chunking and
accuracy-improvement research is frozen under the 2026-08-25 accuracy-bar ruling (~97–98% of
boundaries correct on first sync, ≥95% accepted; remaining errors go through manual review in
the UI, not further pipeline changes — see Standing constraints).

*This section is updated at the end of every session.*

**Stage 1 lock**

* [IN-PROGRESS] Stage 1 lock
- End Goal: Stage 1 locks once the live acceptance run (prepared, not yet executed —
`stage1-live-run-prep.md`) has been run and passed by the owner; every other STAGE 1 LOCK GATE
criterion (Contract IN / Contract 1→2 owner inspection, determinism, the non-English written
acceptance, R.5/R.10, the mover-audit dossier, no Stage 1 defect deferred downstream) is already
satisfied or accepted in writing.

- [ ] Execute the live acceptance run and get an owner pass/fail verdict
  (`stage1-live-run-prep.md`).
- [ ] Flip `FA_PROJECT_DEFAULT_ON` once the live run passes.
- [ ] Ear-verify the 4 provisional R.12 closures (v6 boundaries 085/224/307/383) — move from
  structurally-correct to ear-verified.
- [ ] Ratify R.7 confidence-flag handling and build its two unbuilt failure paths
  (skip-and-flag, force-split).
- [ ] Produce real `fa-vocab-<lang>.json` production files and wire
  `project.language`/`vocabChars` into both `computeFaChunkPlan` call sites.
- [ ] Task 2 — re-derive the 50/50 silence-split rule in `snapBoundaries.ts` against current
  `main` (independent of the above; will deliberately break golden replay — needs per-boundary
  review, not a blind re-baseline).
- [ ] Task 3 — a dedicated test for stale-anchor scroll degradation (currently only asserted
  correct by code reading).
- [ ] Wire `FaEvent` to a UI progress consumer (no hook/component consumes it yet).

### Open bugs

Audited 2026-08-25 against `main` — full mechanism/fix-design detail for every row: Part AI. Two
rows closed that day (chunk-plan non-determinism, OOM crash — `docs/history-2.md` / "Finished").

**Tag vocabulary (file-wide):** `[OPEN]` = unresolved, no fix built. `[IN-PROGRESS]` = actively
worked. `[DEFERRED]` = real defect, work explicitly paused by an operator decision.
`[OPEN · NON-BLOCKING]` = real, confirmed-open defect that doesn't block the Stage 1 lock gate —
NOT "accepted" or "not a bug"; see Part AI's sequencing table for why. `[CLAIM-UNVERIFIED]` = not
a code defect — an operational task/claim not yet confirmed by direct evidence.

* [CLOSED] `boundaryUsedFallback`'s 4-arg `isBreathSilence` call fixed to 5-arg (WS2 Step 11,
  `src/services/snapBoundaries.ts:381`), matching the correct pattern at `:744-745`. Diagnostic-
  only, confirmed no committed-timing change: golden replay v6/173/spanish byte-identical
  (`scripts/phase4-handoff-replay-sync.test.ts`, 6/6). Regression test:
  `src/services/syncTiming.test.ts`'s seam-exemption case reusing the real V6 "predator" fixture.
  `docs/history-2.md#2026-08-26--ws2-step11-boundaryUsedFallback-fix`.
* [OPEN · NON-BLOCKING] 5 open Zero-Defect Register rows — boundary-placement defects,
  ear-verified wrong, with no rule that fixes them yet: `214_solitary_fire`, `231_slowing_pace`,
  `447_scout_facing_dark`, `173/lethal_nature_hazard`, `173/gadget_decay` (live list:
  `scripts/ws1-session-ak-step1-gate.ts:59`'s `OPEN_DEFECTS`, matching the AJ-0 oracle's
  `openDefect` rows). `400_endless_dark` is closed at 1266.75, ear-verified by the `full-pass-aj0`
  sitting (`scripts/ws1-ear-pass-ledger.ts:907`). Accepted as residual defects under the accuracy
  bar rather than pursued further; no owner. Audit: Part AI §4 — no fixable design slot without
  contradicting the accuracy-bar ruling; the permanent path is the already-planned Pillar 2
  detector. Non-blocking because already accepted in writing under that ruling.
* [OPEN · NON-BLOCKING] Alignment cost has no enforced bound for real inputs — (Contract A4;
  `__ALIGN_INSTRUMENT__` dormant) — an unbounded input can hang the UI behind the loading overlay
  with no error surfaced. No owner; disposition deferred to Stage 2 lock. Needs a cost-vs-input-
  size measurement before a fix can be designed: Part AI §5. Non-blocking because the live run's
  3 corpora are already known-safe sizes.
* [OPEN · NON-BLOCKING] React "Maximum update depth exceeded" render loop — surfaced during the
  2026-08-25 real-app V8 corpus run (`npm run tauri:dev:fa`, see `sync-pipeline-v2-plan.md`'s
  AI.1 Addendum). Not yet isolated to a specific effect: `src/hooks/usePlayback.ts:80-94`'s rAF
  tick already carries a delta guard for this exact failure mode (QB2 fix), so this is a
  distinct, unlocated trigger elsewhere in the render tree, not a QB2 regression. No owner.
  Non-blocking because neither the OOM fix nor the live acceptance run touches this path.

### Not started

- **Pillar 2 passive detector** — read-only boundary-quality post-processor, 4 rules, gated on
  R-AS's precision bar (`MIN_IMPLIED_PRECISION = 0.50`). Full spec: `sync-pipeline-v2-plan.md` Part AK.2.
- **Sync log revamp** — 6 collapsible groups replacing dev telemetry; Group 6 depends on Pillar 2's
  output. Full spec: `sync-pipeline-v2-plan.md` Part AK.3.
- **Phase 4** (Stage 2 — Align & Select) — restructure the pipeline into the four formal
  stages: Stage 2's return type becomes timing-free, Stage 1's output bundles into one object,
  `distributeSegmentTimes`/`applyAnchorBasedTiming` collapse into Stage 3. Structural only,
  timing held identical.
- **Phase 5** (Stage 3 — Place) — replace the boundary picker with the four-line fence rule;
  delete `computeBoundarySearchWindow`, `isBoundarySilenceCandidate`, `fillsTokenGapWithinSpan`,
  the three-pass contention assignment, and the degenerate-pair guard.
- **Phase 6** (Stage 3 — Place) — deprecate the compensation layer: turn off the seam
  exemption, and if the eight verification pairs still pass, delete `isBreathSilence`, the
  multi-fragment override, the seam exemption, and its four constants.
- **Phase 6b** (Stage 3 — Place) — verify the 173-project's pairIdx-20 boundary (defect at
  75.660 vs. target 76.470), likely resolved by Phase 5.
- **Phase 7** (Stage 4 — Finalize & Report) — observability: log entries with plain-language fix
  hints for every clamp/floor/fallback/degenerate-boundary/estimated-timing decision; fix the
  `boundaryUsedFallback` argument-count bug (see Open bugs).
- **Bounded-memory options for the residual OOM footprint** — a capped `FaModelCache` session
  cache, or process isolation per sync. Unbuilt. **Flag for owner review:** `sync-pipeline-v2-plan.md`'s
  AI.1 Addendum says the shipped drop-then-build fix already "produces a bounded profile" and this
  option "was therefore not built" — may be superseded, not merely unbuilt; kept, not removed
  unilaterally, pending an explicit owner call.

Sequencing: Stage 1 lock → Phase 4 → Stage 2 lock → Phase 5 → Phase 6 → Phase 6b → Stage 3 lock
→ Phase 7 → Stage 4 lock.

### Standing constraints

* [OPEN] Spanish corpus acceptance lapse — **UNRESOLVED OWNER DECISION**, drifting since
  2026-08-15: the acceptance's reopening trigger ("voids the moment Spanish-specific
  normalization/alignment code ships") was satisfied in literal text by Phase 3b's Spanish
  cardinals (2026-08-15); no session has ruled whether it actually reopens the acceptance. 3
  options + costs: `sync-pipeline-v2-plan.md` Part AK.1 / AI §AI.8. **Flagged — needs a ruling.**
- **FA default toggle** (`Project.faHighPrecisionSync` / `FA_PROJECT_DEFAULT_ON`): currently
  **OFF**, pending the live acceptance run (see In progress checklist).
- **Stage lock status:** 0 of 4 stage locks passed.

Full standing-constraints list (oracle, golden replay scope, rule-dependent closures, dead-end
register, `S1_KNOWN_BAD_MOVES`, arms F/G/H, terminology glossary, frozen-file list, Contract 1→2
compliance, R.3/R.8/R.9 backlog): relocated verbatim to `sync-pipeline-v2-plan.md` Part AK.1.

---

## WS2 — Video Ingest & Distribution Bugs
Started: 2026-08-26 (Step 3) | Status: 3 of 4 bugs closed (1/2/4 code-fixed, machine-verified;
3 closed did-not-reproduce, no code fix). CI-installer verification + 120fps decode lag remain open.

### Finished

*One-liners only — full detail for every item below: `docs/history-2.md`.*

- **WS2 bug 1** — rescued-segment anchor ordering; fixed via a trusted spine. `2ae4d18`+`1e5deb7`,
  on `origin/main`. `docs/history-2.md#2026-08-26--2ae4d18--2ae4d18-ws2-bug1-trusted-spine`
- **WS2 bug 2** — FA silently unavailable/silent gate in desktop builds; compiled in + Sync Log
  signal added. `main`, `d8baef5`.
  `docs/history-2.md#2026-08-26--d8baef5--d8baef5-ws2-bug2-fa-compiled-into-installer`
- **WS2 bug 4** — 4.7 GB installer bloat, model placed by hand; in-app resumable/checksummed
  download. `main`, `8c6e4e8`.
  `docs/history-2.md#2026-08-26--8c6e4e8--8c6e4e8-ws2-bug4-in-app-model-download`
- **WS2 bug 3** — closed as DID-NOT-REPRODUCE on a HEAD build; no code fix exists.
  `docs/history-2.md#2026-08-26--no-fix--ws2-bug3-closed-did-not-reproduce`
- **WS2 Step 10 — FA error serialization** — `invoke()` rejections that are plain objects (any
  `#[tauri::command]` returning `Err(struct)`) no longer stringify to `[object Object]` in the
  Sync Log; new shared `describeInvokeError` helper, wired into `forcedAlignmentRun.ts` and
  `faPreflight.ts`. `docs/history-2.md#2026-08-26--88ff701--88ff701-ws2-step10-error-serialization`

### Open bugs

Tag definitions: WS1's "Open bugs" section above (file-wide vocabulary).
* [IN-PROGRESS] Windows voiceover `fetch(blob:)` failure — Windows installer's Apply Sync run
  reported `voiceover fetch failed: Failed to fetch` from `useWhisper.ts`'s
  `fetchAndDetectSilences`, degrading every boundary to a token-midpoint fallback (117 cuts landed
  on still-playing audio, a consequence, not a separate defect). Root cause NOT fully determined
  down to the exact WebView2 mechanism (no Windows hardware this session) but narrowed hard: `Asset.url`
  is always a `blob:` object URL, never the Tauri asset protocol or a filesystem path (ruled out
  by grep — no `asset://`/`assetProtocol` capability exists anywhere in this codebase), and the
  same-run video preview (`<video src={asset.url}>`) decoded fine on the identical URL scheme —
  the concrete difference is DOM-native media loading vs. an explicit `fetch()` call. Fix applied:
  `fetchAndDetectSilences` now prefers the already-in-memory `asset.file` (present for a
  freshly-staged voiceover, the operator's exact scenario) and only falls back to
  `fetch(asset.url)` when `.file` is absent — the same precedented pattern `App.tsx`'s
  `resolveVoiceoverDuration` already used. Machine-verified (new regression test, `tsc`, full
  vitest, `cargo test`); **NOT YET verified on real Windows hardware** — tag stays IN-PROGRESS
  until the operator confirms. WS2 Step 11: Step 10's A6 sweep actually lists 9 sibling
  `fetch(asset.url)` sites (its own "8 other" count is off by one) — 6 now fixed with the same
  `asset.file ??` guard (`App.tsx` ×2 dev-only, `segmentEncoder.ts`, `exportPipeline.ts`,
  `exportPipelineWebCodecs.ts`, `exportWorker.ts` — the last runs inside a Web Worker; `.file`
  survives via structured clone). `waveformPipeline.ts:81` was already guarded (stale A6 entry).
  `whisperService.ts:1686` untouched — FROZEN this session. `videoDemuxer.ts:66`'s `demux(url)` NOT
  fixed — its only production caller, `videoDecoderPool.ts`, is also frozen and takes a bare URL
  string; flagged, not forced. Regression tests added per fixed site except the two App.tsx
  dev-only sites and exportWorker.ts (worker-entry module, same accepted DOM/worker-testing gap as
  `usePlayback.ts`/`useGlPreview.ts`). Full list: `step10-windows-fetch-diagnosis.md`.
  `docs/history-2.md#2026-08-26--56e2116--56e2116-ws2-step10-windows-voiceover-fetch`
  `docs/history-2.md#2026-08-26--ws2-step11-fetch-sites`
* [DEFERRED] 120fps preview decode lag — operator-deprioritised, real code-level defect found
  while diagnosing bug 3, not itself closed by bug 3's non-repro: `videoDecoderPool.ts`'s
  90-frame decode-ahead cap (`MAX_BUFFERED_FRAMES_PER_SESSION`) is sized against a fixed ~1.5s
  window (`WINDOW_AHEAD_SEC`) tuned for 24-30fps content; at 120fps the first decode-ahead batch
  needs ~180 frames, overflows the cap, and the excess is dropped PERMANENTLY (`feedCursor` has
  already advanced past those chunks, so they're never re-fed). Reproduced against the real,
  unmodified `videoDecoderPool.ts` with the asset's actual measured profile (mock-`VideoDecoder`
  harness); never confirmed on-screen in a live app (blocked twice — no UI driver reachable, then
  `request_access` denied). Candidate directions: backpressure vs. fps-proportional sizing; any
  bound must be in BYTES not frame count (preserves the prior 4.0→2.8 GB / 1300→137 MB
  spike-memory work). Preview only — export uses a separate, non-windowed sequential decoder
  (`sequentialDecode.ts`) and is unaffected. Full diagnosis: `docs/ws2-video-ingest/bug3-diagnosis.md`.

### Operational / verification tasks (not code defects)

* [CLAIM-UNVERIFIED] CI-installer verification of WS2 bugs 2+4 — not proven on a CI-built
  artifact; `build.yml` carries both fixes on `origin/main` but arm64/Windows have never been
  built (CI or local — Intel dev machine only). Separately, MEASURED 2026-08-26 (WS2 Step 11, A5):
  FA DOES run end-to-end on the operator's own local .app build with the gate manually flipped ON,
  but the 5 per-language `model.onnx` files it used were a **P2 hand-placed dev-session artifact**
  with no canonical hosted source and no acquisition UI at the time. Full A5 evidence and
  P1/P2/P3 classification: `docs/history-2.md#2026-08-26--ws2-step11-fa-model-provenance-a5`.
* [DONE] Manage Models & Add-ons modal (WS2 Step 12/13, A3) — closes A5's "no acquisition UI" gap
  fully: import AND a REAL, working Download for both whisper and FA packs (WS2 Step 13 Phase 3
  ported `model_download.rs`'s resumable engine rather than duplicating it), against the owner's
  now-public `mohtashim9/kinetix-fa-models` HF repo, pinned to its post-upload commit. A real
  end-to-end download + a real cancel-then-resume cycle were both run against production
  (`en`, 1,262,512,711 bytes, 2026-08-27) — full detail:
  `docs/history-2.md#2026-08-27--ws2-step13-fa-download-engine-ort-provisioning`. A genuine
  status-check bug (a failed `check_installed_models` call was silently swallowed, rendering every
  row as "missing" with no visible signal) was found and fixed in the same session — the backend
  check itself was never wrong (LIVE-PROBE-CONFIRMED against real files:
  `src-tauri/tests/models_status_live.rs`).
* [OPEN] FA onnxruntime runtime provisioning for Windows + macOS arm64 — WS2 Step 13 Phase 4
  provisioned and checksum-verified onnxruntime for BOTH gaps (`build.yml` now lipos a universal
  macOS x86_64+arm64 dylib and downloads+verifies the two Windows DLLs;
  `fa_onnx.rs::SUPPORTED_ORT_TARGETS` replaces the old macOS-x86_64-only hard gate), but NEITHER
  is runtime-verified — no Apple Silicon or Windows hardware available. Windows additionally needs
  the MSVC Visual C++ Redistributable on the end-user machine (not bundled, not yet chain-installed
  by the installer) before `onnxruntime.dll` can load at all. Full detail, including what remains
  unverified per target: `docs/ws2-fa-models/ort-provisioning.md`.

---

*Full history: `docs/history-2.md`. Standing reference material: `sync-pipeline-v2-plan.md` Part AK.*
