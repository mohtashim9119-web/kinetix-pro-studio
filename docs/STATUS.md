# Project Status

Last updated: Round 28, SHA bad0882

> **Single source of truth for project tracking.** Retired trackers live under
> `docs/archive/history/` (`work-in-progress.md`, `project-state.md`). Update this file only;
> do not create a parallel tracking doc.

---

## WS1: Sync Pipeline

### In Progress
Phase 3 (Task 5); 3b/3c closed, 3d dormant. FA default toggle gated at [faGate.ts:91](../src/services/faGate.ts) — 0/4 stage locks passed; `fa-inference` non-default so shipped builds fall back to Whisper timing.
**END GOAL:** all Stage 1 lock gates satisfied and `FA_PROJECT_DEFAULT_ON` → ON — `docs/ws1-sync-pipeline/stage1-live-run-prep.md`

### Next Tasks
- [OPEN] Live acceptance run, owner verdict — `docs/ws1-sync-pipeline/stage1-live-run-prep.md`
- [OPEN] Flip `FA_PROJECT_DEFAULT_ON` once three preconditions met (two 12/12 ear passes, empty Zero-Defect Register, runtime-cost ruling) — [faGate.ts:91](../src/services/faGate.ts)
- [OPEN] Ratify R.7 confidence-flag handling; build skip-and-flag and force-split failure paths — `docs/ws1-sync-pipeline/sync-pipeline-v2-plan.md`
- [OPEN] Produce `fa-vocab-<lang>.json` files; wire `project.language`/`vocabChars` into both `computeFaChunkPlan` call sites
- [OPEN] Task 2 — re-derive 50/50 silence-split rule in `snapBoundaries.ts` (breaks golden replay by design)
- [OPEN] Task 3 — stale-anchor scroll degradation test (code-read only today)
- [OPEN] Wire `FaEvent` to a UI progress consumer (none exists)
- [OPEN] Rule-stage fixture-backed regression (golden replay stops at `snapCoveredBoundaries`)
- [OPEN] Make FA reachable in shipped build — `fa-inference` non-default Cargo feature — `src-tauri/Cargo.toml`
- [OPEN] Pillar 2 passive detector (4 rules, `MIN_IMPLIED_PRECISION = 0.50`) — `sync-pipeline-v2-plan.md` Part AK.2
- [OPEN] Sync log revamp (6 collapsible groups) — Part AK.3
- [OPEN] Phases 4–7 (Align&Select, Place, Finalize&Report restructure) — `sync-pipeline-v2-plan.md`
- [OPEN] Rule-stage propose/arbitrate rebuild (R.11/R.12 collision root cause)

### Open Bugs
- [OPEN · NON-BLOCKING] 5 Zero-Defect Register rows, no rule fix yet — `scripts/ws1-session-ak-step1-gate.ts:59`
- [OPEN · NON-BLOCKING] Alignment cost unbounded for real inputs (Contract A4, `__ALIGN_INSTRUMENT__` dormant)

### Deferred Tasks
- [DEFERRED · ASR ENGINE LIMITATION] Row 52 ("Llívia") — Whisper never transcribed isolated token; owner ruling 2026-09-03
- [DEFERRED] Bounded-memory options for residual OOM (capped `FaModelCache` or process isolation) — pending owner call
- [DEFERRED] Full standing-constraints list — `sync-pipeline-v2-plan.md` Part AK.1

---

## WS2: Editing Pipeline

### In Progress
(none)
**END GOAL:** (none active — next work is Transcription Req 2)

### Next Tasks
- [OPEN · BLOCKED] Transcription Req 2: incremental draft save — blocked on Rust `WhisperEvent` partial-token IPC ([whisper.rs:572](../src-tauri/src/whisper.rs), [whisper.rs:632](../src-tauri/src/whisper.rs))
- [OPEN] Raw IPC for ffmpeg probes — base64 IPC at [tauriFfmpeg.ts:45](../src/services/tauriFfmpeg.ts); duplicated [App.tsx:3168](../src/App.tsx)

### Open Bugs
(none)

### Deferred Tasks
- [DEFERRED] Non-English Localization & C3 Policy — French cardinal/elision rules, C3 fixture ceiling beyond 1,998
- [DEFERRED] Video Engine — 120fps preview buffer byte-capping, native asset export frame rates

---

## WS3: Export & Storage Pipeline

### In Progress
Round 28 hardware findings (build `831c872`, branch `ws3-export-integration`) assigned to CC — see Open Bugs D1–D2, D4–D9.
**END GOAL:** Round 28 open bugs closed; remaining `windows-validation.md` hardware rows (W1–W24, E1–E12) executed on Machine 1.

### Next Tasks
- [OPEN] Complete remaining `windows-validation.md` hardware rows — nine Round 27 smoke checks recorded @ `831c872`; W23 partial (retention pass, resume fail) — `docs/ws3-export-pipeline/windows-validation.md`
- [OPEN] Append-path batching (`af6a300`) — 100:1 IPC batching shipped; no post-fix export run, throughput claim is call-count arithmetic only — `docs/archive/ws3/append-path-audit.md`
- [OPEN] Part C 500-segment export — intermittent multi-second silent gaps (1/3 live runs 2026-09-07, longest 10.74s); root cause not isolated — `docs/ws3-export-pipeline/silent-gaps-diagnosis.md`

### Open Bugs
- CLOSED (WS3 Batch 2, 3A) — `StorageRootRelocationView` now mounted from `App.tsx` as the modal target for `StorageSettingsSection`'s "Move storage root…", fed via a new `useStorageRootRelocation` hook — [App.tsx](../src/App.tsx), [useStorageRootRelocation.ts](../src/hooks/useStorageRootRelocation.ts).
- [OPEN · BLOCKED ON D7 FRAME ACCOUNTING] `ExportFinishShortfallCard` exported ([recovery/index.ts:29-32](../src/components/recovery/index.ts)) but deliberately not rendered — owner ruling (WS3 Batch 2, Ruling D): wiring it needs a `producedFrames`/`expectedFrames` producer, which does not exist anywhere in `src/` and is explicitly out of scope this batch (collides with D7's own frame-accounting work, `ExportLivenessSnapshot.framesEncodedCumulative` — [exportPipeline.ts](../src/services/exportPipeline.ts)). Do not wire without that producer.
- [OPEN · NON-BLOCKING] `IdbToNativeMigrationView` exported ([recovery/index.ts:14-18](../src/components/recovery/index.ts)) but has ZERO render call sites anywhere outside its own file/tests/the barrel — found during WS3 Batch 2's 3.2 orphan grep, not previously tracked here or in Ruling D's exit-condition list (which named only `ExportFinishShortfallCard`/`StorageRootRelocationView`). Not fixed this batch — scope/intended integration point unknown; flagging for a separate pass rather than guessing at wiring.
- D6 CLOSED (Round 28) — a degraded project (unresolved assets) now opens directly into the editor instead of a blocking recovery modal; unresolved assets show an Offline badge (`DropZonePanel.tsx`), autosave stays blocked via the existing `saveProject` Guard 2 poison (`canPersistRecoveredProject`, `assetRecovery.ts`), and the recovery screen is reachable on demand via Files ▸ Relink Media…. See `App.tsx`'s `handleSwitchProject`.
- D7 CLOSED (Round 28) — `ExportLivenessSnapshot.framesEncodedCumulative` added alongside the existing per-session `framesEncoded`, summed across every completed piece in the run — [exportPipeline.ts](../src/services/exportPipeline.ts), wired in [exportPipelineWebCodecs.ts](../src/services/webcodecsExport/exportPipelineWebCodecs.ts).
- CLOSED (Round 28) — `estimateExportDestinationDiskBytes` wired into `ExportSettingsModal.tsx`'s live size badge — [diskFull.ts:546](../src/services/webcodecsExport/diskFull.ts).
- CLOSED (Round 28) — `StorageSettingsSection.tsx:105` now routes through `relinkPickFolder()` — [relinkNative.ts:28](../src/services/relinkNative.ts).
- CLOSED (Round 28) — stale FA downloader string updated to describe the implemented, registered `fa_model_download` — [fa.rs:596-599](../src-tauri/src/fa.rs).
- [OPEN] Whisper-cache flake bounded only by `--test-threads=1`; needs injectable `IN_FLIGHT`/`TERMINAL_BUFFER` — [whisper.rs:109](../src-tauri/src/whisper.rs), [whisper.rs:235](../src-tauri/src/whisper.rs)
- [OPEN] `navigator.storage.persist()` WebView2 return value unrecorded — `windows-validation.md` W24
- [OPEN] D1 Resume mints a new session folder instead of adopting the retained one — Round 28, assigned to CC
- [OPEN] D2 Two resume surfaces; four equal-weight buttons on the failure overlay — Round 28, assigned to CC
- D4 CLOSED (Round 28, Batch 3) — export session temp now resolves under the configured storage
  root's `export-sessions/` subtree instead of a hardcoded `std::env::temp_dir()`
  (`ffmpeg.rs::session_dir`/`session_dir_under`, `storage_root::export_sessions_dir`); the
  create/list/sweep/reclaim commands and the resume-adoption path (`ffmpeg_reenter_session`)
  all route through the same resolver — proven by
  `session_dir_storage_root_routing::session_dir_always_nests_under_the_given_root_never_under_os_temp`,
  `...session_dir_under_a_relocated_root_is_disjoint_from_os_temp_dir`, and
  `...resume_and_session_management_commands_never_call_os_temp_dir_directly` (`src-tauri/src/ffmpeg.rs`).
  Whisper/FA models now resolve their install target through `storage_root::models_dir` first
  (`model_download.rs::models_dir`, `fa.rs::fa_model_candidate_paths`/`fa_model_path`), with the
  pre-Round-28 `app_local_data_dir` location kept as a read-only fallback so an existing install
  is still found without a migration step. `models` is now a fifth relocation subtree in
  `storage_root.rs`'s `MANAGED_RELOCATION_SUBTREES`, moved by the same copy-verify-commit flow and
  the same insufficient-space rejection as `assets`/`projects`/`cache`/`project-store-backups`
  (`relocation_moves_models_alongside_the_other_managed_subtrees`). A model download in flight
  refuses relocation outright (`model_download::any_download_in_flight`,
  `relocate_refuses_outright_while_a_model_download_is_in_flight`) rather than moving files out
  from under a live writer. Remaining hardware confirmation (relocation + a live export actually
  landing on the new volume, Resume adopting the same directory on real Windows) is unit/
  integration-covered only — see the new "Machine 1 checklist" in `windows-validation.md`.
- CLOSED (WS3 Batch 2, 3B/3C) — D5 was never a wiring gap (`StorageSettingsSection.tsx:130` genuinely called `storage_root_reclaim` all along — STEP 0b re-grep). Three separate defects fixed instead: D5a `reclaimable_dirs`'s backups path was discarded (`storage_root.rs`); D5b `sweep_stale_project_backups`'s freed-byte total was thrown away (now returns `u64`, `project_mirror.rs`); D5c (the one that mattered) — `size_report` advertised the ENTIRE backups directory as reclaimable regardless of staleness, a number that was never true. Now advertises exactly what the sweep would free (`project_mirror::store_backups_stale_bytes`), proven byte-exact-equal to what the sweep actually frees by a mixed aged/fresh fixture test. U36 (the export-failure modal's separate "Reclaim {bytes}" mechanism) is untouched, by design — see `docs/ws3-export-pipeline/reclaim-mechanisms.md` for which root each mechanism covers.
- [OPEN] D9 Twenty encoder sessions with eighteen restarts on RX 580 in one piece — Round 28, assigned to CC
- D8 CLOSED (Round 28, addendum scope) — added `export_log_event` (Rust, `ffmpeg.rs`) and `logExportEvent` (TS, `exportDiagnosticLog.ts`), a general-purpose door into `kinetix-diagnostic.log` for the export lifecycle, wired at init, cancellation, disk-full-preflight, and session-cleanup (`exportPipelineWebCodecs.ts`). Flush: routes through the same `tauri_plugin_log` `Folder` target the pre-existing `ffmpeg_log_disk_preflight`/`ffmpeg_retain_session_for_resume` commands already use, backed by an unbuffered `std::fs::File::write_all` (no `BufWriter`) — verified by reading `tauri-plugin-log 2.8.0`'s file-target implementation, not assumed. NOT wired: encoder-config, frame-loop progress pulses, and watchdog-update events, which originate inside the WebCodecs Worker (a separate global scope with no direct IPC access) and would need `postMessage`-to-main-thread plumbing this pass didn't build — left for a future pass; see `App.tsx`/`exportWorker.ts` for where that would attach.
- D8 FOLLOW-UP FIX (Round 28, same session) — the new in-app diagnostic log viewer (`DiagnosticLogModal.tsx`, App Settings → Diagnostics) surfaced that `lib.rs`'s `setup` debug-build branch (`cfg!(debug_assertions)`) attached `tauri_plugin_log` with its OWN DEFAULT targets (`Stdout`, `Webview`, `LogDir`) rather than the pinned `Folder` target at `diagnostic-logs/kinetix-diagnostic.log` — that pinned path was only ever written to by a release build launched with `KINETIX_DIAGNOSTIC_LOG=1`. Every `tauri:dev` session before this fix therefore had `export_log_event`/`ffmpeg_log_disk_preflight` calls succeeding (no error) while writing to a file `get_diagnostic_log_text`/the viewer never reads, so the log always read back empty under `tauri:dev` regardless of export activity — not a viewer bug, a debug-build target mismatch. Fixed by swapping `LogDir` for the same pinned `Folder` target in the debug branch too (keeping `Stdout`/`Webview` for DevTools/console visibility); debug logging itself was never gated, only its destination. `kinetix-diagnostic.log` is now populated live under `tauri:dev` as well as in an opted-in release build.

### Deferred Tasks
(none)

---

## Backlog Items

- [OPEN · NON-BLOCKING] ORT intra-op thread ceiling undecided (32 recommended) — `fa_onnx.rs:503`
- [OPEN · NON-BLOCKING] `fa_cancel` has zero frontend callers — `fa.rs:296`
- [OPEN · NON-BLOCKING] `faBoundaryTypes.ts` missing one-way drift entries — `faBoundaryTypes.ts:64`
- [OPEN · NON-BLOCKING] `.digest.json` not removed on model delete — `models.rs:664`
- [OPEN · NON-BLOCKING] Two `fa_dev` digest tests share process-global memo — `fa_dev.rs:731`
- [OPEN · NON-BLOCKING] Whisper attach buffer 30s stale-replay window; panic path can orphan registry key — `whisper.rs:172`
- [OPEN · NON-BLOCKING] React max update depth during V8 FA run; trigger unlocated
- [OPEN · NON-BLOCKING] Dev-profile WebKit IDB holds 469MB legacy v1 data; packaged build 15.7MB
- [OPEN · NON-BLOCKING] Legacy export ffmpeg concat/mux paths unbounded vs `concatAnnexbPieces` — `exportPipeline.ts:263`
- [OPEN · NON-BLOCKING] macOS `VideoEncoder` output not byte-reproducible (76/1200 chunks matched) — use `FrameContentDigest`
- [OPEN · NON-BLOCKING] Part C longest silent interval (10.26s) lacks phase attribution — `exportWorkerDiagnostics.ts`
- [OPEN · NON-BLOCKING] `GL_TRANSITION_SLUGS` duplicated — `compositeParams.ts:34`, `decodeCursorLifetime.ts:26`
- [OPEN · NON-BLOCKING] Three parallel disk-size estimators (badge, dead destination module, live preflight) — consolidate to one — `diskFull.ts`
- [OPEN · NON-BLOCKING] ~33 cloud CI test failures from missing `.work-phase4/replay/` fixtures — `scripts/phase4-restore-replay-inputs.py`
- [OPEN · NON-BLOCKING] 10 local `archive/wt-*-2026-09-14` branches, none pushed to origin
