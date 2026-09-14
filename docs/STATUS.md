# Project Status

> Source SHA: `831c872` (branch `ws3-export-integration`, Round 27 merged). Compiled 2026-09-14.
> **This file is the single source of truth for project tracking.**
> `work-in-progress.md` and `project-state.md` are retired — both now live, unedited except
> for a pointer line, under `docs/archive/history/`. Do not create a new tracking file for
> any workstream; update this one.

---

## WS1: Sync Pipeline

### In Progress
Phase 3 (Task 5), past 3b/3c (closed), 3d dormant. Chunking/accuracy research frozen under
the 2026-08-25 accuracy-bar ruling (~97-98% boundaries correct, ≥95% accepted). FA default
toggle (`FA_PROJECT_DEFAULT_ON`, [faGate.ts:91](../src/services/faGate.ts)) is gated behind three
unmet preconditions: two further disjoint 12/12 blind ear-pass verdicts, an EMPTY Zero-Defect
Register (currently 5 open rows), and a runtime-cost ruling for FA-enabled Apply Sync. 0 of 4
stage locks passed. Backend wiring also incomplete: `fa-inference` is a non-default Cargo
feature, so `tauri:build` never compiles it in — every FA run falls back to Whisper timing in a
shipped build.
**END GOAL:** every STAGE 1 LOCK GATE criterion satisfied (live acceptance run passed by the
owner, Contract IN/1→2 inspection, determinism, non-English written acceptance, R.5/R.10,
mover-audit dossier, no Stage 1 defect deferred downstream) and `FA_PROJECT_DEFAULT_ON` → ON.

### Next Tasks
- [OPEN] Execute the live acceptance run, owner pass/fail verdict — `docs/ws1-sync-pipeline/stage1-live-run-prep.md`
- [OPEN] Flip `FA_PROJECT_DEFAULT_ON` once all three preconditions above are met
- [OPEN] Ratify R.7 confidence-flag handling; build skip-and-flag and force-split failure paths
- [OPEN] Produce real `fa-vocab-<lang>.json` production files; wire `project.language`/`vocabChars` into both `computeFaChunkPlan` call sites
- [OPEN] Task 2 — re-derive the 50/50 silence-split rule in `snapBoundaries.ts` against current `main` (deliberately breaks golden replay)
- [OPEN] Task 3 — dedicated test for stale-anchor scroll degradation (currently code-read only)
- [OPEN] Wire `FaEvent` to a UI progress consumer (none exists yet)
- [OPEN] Give the rule stage its own fixture-backed regression coverage (golden replay stops at `snapCoveredBoundaries`)
- [OPEN] Make forced alignment reachable in a shipped build — `fa-inference` non-default Cargo feature; gated behind Stage 1 preconditions above
- [OPEN] Pillar 2 passive detector (4 rules, gated on `MIN_IMPLIED_PRECISION = 0.50`) — `docs/ws1-sync-pipeline/sync-pipeline-v2-plan.md` Part AK.2
- [OPEN] Sync log revamp (6 collapsible groups) — Part AK.3
- [OPEN] Phase 4-7 (Stage 2 Align&Select, Stage 3 Place, Stage 4 Finalize&Report restructure)
- [OPEN] Rule-stage propose/arbitrate rebuild (root cause of R.11/R.12 collision; would absorb ~2.70s/Apply Sync R-AP cost on v6)

### Open Bugs
- [OPEN · NON-BLOCKING] 5 open Zero-Defect Register rows (boundary-placement defects, ear-verified wrong, no rule fixes yet): `214_solitary_fire`, `231_slowing_pace`, `447_scout_facing_dark`, `173/lethal_nature_hazard`, `173/gadget_decay` — live list `scripts/ws1-session-ak-step1-gate.ts:59`
- [OPEN · NON-BLOCKING] Alignment cost has no enforced bound for real inputs (Contract A4, `__ALIGN_INSTRUMENT__` dormant) — an unbounded input can hang the UI with no error surfaced

### Deferred Tasks
- [DEFERRED · ASR ENGINE LIMITATION] Row 52 ("Llívia") fails because Whisper never transcribed the isolated token — not a normalization issue, do not patch (owner ruling 2026-09-03). Revisit trigger: an ASR/G2P change only.
- [DEFERRED] Bounded-memory options for residual OOM footprint (capped `FaModelCache` session cache or process isolation per sync) — may already be superseded by the shipped drop-then-build fix; pending explicit owner call
- [DEFERRED] Full standing-constraints list (oracle, golden replay scope, rule-dependent closures, dead-end register, terminology glossary, frozen-file list, R.3/R.8/R.9 backlog) — relocated to `sync-pipeline-v2-plan.md` Part AK.1

---

## WS2: Editing Pipeline

### In Progress
(none)
**END GOAL:** (none active — next implementation is Transcription Req 2 from Next Tasks below)

### Next Tasks
- [OPEN · BLOCKED] Transcription Req 2: incremental draft save — blocked on Rust `WhisperEvent` partial-token IPC variant; progress is percent-only ([whisper.rs:572](../src-tauri/src/whisper.rs)), tokens only arrive on Done ([whisper.rs:632](../src-tauri/src/whisper.rs))
- [OPEN] Raw IPC for ffmpeg probes — `tauriFfmpeg.ts:45-72` base64 IPC brief-estimated ~2.33x peak inflation on a ~73MiB voiceover (not measured). Duplicated at `App.tsx:3168/3399`, `fa-dev:4846`

### Open Bugs
(none)

### Deferred Tasks
- [DEFERRED] [CONSOLIDATED] Non-English Localization & C3 Policy — French cardinal/elision rules plus C3 fixture ceiling beyond 1,998
- [DEFERRED] [CONSOLIDATED] Video Engine — 120fps preview buffer byte-capping plus native asset export frame rates

---

## WS3: Export & Storage Pipeline

### In Progress
Status: **Round 27 (Steps 4-7 plus the self-audit pass) landed** — fast-forward merged from
`ws3-round27` @ `831c872` into `ws3-export-integration` @ `831c872` (2026-09-14, no rebuild, ff-only
verified via `git merge-base --is-ancestor`). Evidence of live wiring: `ExportFailureMessage`
imported and rendered at [App.tsx:294](../src/App.tsx),[App.tsx:7169](../src/App.tsx) (previously
cherry-picked but unwired); `applySilentProvenanceResolution` (provenance ladder) imported and
called at [App.tsx:223](../src/App.tsx),[App.tsx:6446](../src/App.tsx); `StorageSettingsSection`
mounted at [AppSettingsModal.tsx:219](../src/components/AppSettingsModal.tsx); bounded asset loads
via `withAssetLoadTimeout` imported at [App.tsx:224](../src/App.tsx). Gate totals at `831c872`
(fresh worktree): tsc clean, lint clean, vitest 3823 passed/78 skipped/33 failed (all 33 are
`.work-phase4/replay/`-dependent fixture tests, gitignored and expected absent in a fresh
worktree — every other test green), `cargo test --test-threads=1` 400 passed/0 failed/6 ignored,
`cargo test --features fa-inference --test-threads=1` 486 passed/0 failed/36 ignored. Also
closed this round: the "double save-dialog/double-picker" `[CLAIM-UNVERIFIED]` item (no such
commands exist; `startExport` opens exactly one dialog, `pick_save_path` at
[useExport.ts:1036](../src/hooks/useExport.ts) — see `history-2.md`'s Round 27 entry) and the
WS3 lane doc-count overage (now exactly 7 docs post-rebase, rename detection carried Round 27's
new docs along automatically).
Remaining gaps found on the merged tip (not closed by Round 27):
- [OPEN] `ExportFinishShortfallCard` and `StorageRootRelocationView` are still defined and
  exported (`src/components/recovery/index.ts`) but not imported/rendered anywhere in `App.tsx`
  or the export overlay — unwired, same as before Round 27.
- [OPEN] `estimateExportDestinationDiskBytes` ([diskFull.ts:546](../src/services/webcodecsExport/diskFull.ts))
  is defined and unit-tested (`diskFull.test.ts`) but has zero call sites in
  `ExportSettingsModal.tsx` — the modal's live size badge does not use it.
- [OPEN] `StorageSettingsSection.tsx:105` calls `invoke('relink_pick_folder')` directly instead
  of the `relinkPickFolder()` wrapper in [relinkNative.ts:28](../src/services/relinkNative.ts) —
  bypasses the wrapper's single point of change for that IPC call.
- [OPEN] UNSEEN item U36 (`.cursor/ws3-export-failure-unseen.md`): the distinction between an
  export-session reclaim and a storage-root reclaim is not yet drawn — both currently share
  reclamation logic without a documented boundary.
**END GOAL:** the four gaps above closed, then re-run the Machine 1 hardware validation below
against the merged build.

Also open, both landed but **unverified live** (`af6a300`/`6930b1d`, 2026-09-07):
1. [OPEN] Append-path batching (`docs/archive/ws3/append-path-audit.md`) — 1-per-chunk `appendFileRaw` IPC batched 100:1, 256MB queue ceiling. No export has been run post-fix; throughput claim is arithmetic on call count only.
2. [OPEN] Part C 500-segment live export shows intermittent multi-second silent gaps mid-run — reproduced in 1 of 3 live runs 2026-09-07 (15 intervals >5s, longest 10.74s), never crosses either watchdog. Root cause not isolated.

Coordination notes from Cursor (`.cursor/`), relevant to the in-flight Round 27 work:
- `ws3-export-failure-unseen.md`: Prompt-37 UNSEEN register continues at U25 on this slice (U25-U29, `ExportErrorKind` total-record contract, resume gating, `disk_full` two-card split, raw-error redaction) — wiring into `App.tsx`/`useExport` is explicitly deferred rebase work, not done by this slice.
- `ws3-size-estimators.md`: three parallel disk-size estimators exist (badge, CC's dead destination module, live session preflight `diskFull.ts`) — consolidation to one source of truth is not yet done; do not add a fourth.

### Next Tasks
- [OPEN] Execute `docs/ws3-export-pipeline/windows-validation.md` — Windows long-path delivery checklist and installer build validation
- [OPEN] Machine 1 hardware validation of `ws3-round27` (now merged @ `831c872`) — pending, eight tests per `docs/ws3-export-pipeline/w23-machine1-validation.md`: (1) mux-stage disk-full retain, (2) mux-stage disk-full resume, (3) provenance-ladder silent resolution on a degraded project, (4) storage settings relink via folder pick, (5) export-failure message surfaces on a forced ffmpeg failure, (6) bounded asset load timeout under a slow/missing native asset, (7) pre-installer path hardening (long-path Windows delivery), (8) cold-launch `navigator.storage.persist()` return value (W24, still unrecorded — see Open Bugs)
- [OPEN] Part C 500-segment live export — reproduce/attribute the silent-gap defect (see In Progress item 2)

### Open Bugs
- [OPEN] Stale error string at [fa.rs:596-599](../src-tauri/src/fa.rs) still calls the FA model downloader "a separate, later task (ruling R-D)" — confirmed still present verbatim
- [OPEN] Whisper-cache flake currently bounded only by `cargo test -- --test-threads=1`; real fix is injectable `IN_FLIGHT`/`TERMINAL_BUFFER` ([whisper.rs:109](../src-tauri/src/whisper.rs), [whisper.rs:235](../src-tauri/src/whisper.rs)) or a serialized eviction test
- [OPEN · NON-BLOCKING] ~33-35 cloud CI test failures caused by the private corpus and git-ignored `.work-phase4/replay/` fixtures not being present in the cloud environment — root cause matches the WIP backlog item on `.work-phase4/replay/` (~85M, restored via `scripts/phase4-restore-replay-inputs.py`); exact 33-35 count not independently re-verified this session
- [OPEN] `navigator.storage.persist()` WebView2 return value is unrecorded — [windows-validation.md](ws3-export-pipeline/windows-validation.md) row W24: plumbing shipped, only the cold-launch/after-use measurement is missing

### Deferred Tasks
(none beyond the two items folded into Open Bugs above)

---

## Backlog Items

- [OPEN · NON-BLOCKING] ORT intra-op thread ceiling undecided; 32 recommended, not applied. `fa_onnx.rs:503`
- [OPEN · NON-BLOCKING] `fa_cancel` has zero frontend callers; FA cancellation unreachable from the UI. `fa.rs:296`
- [OPEN · NON-BLOCKING] `faBoundaryTypes.ts` missing one-way drift entries for Timing and `alreadyRunning`. `faBoundaryTypes.ts:64`
- [OPEN · NON-BLOCKING] `.digest.json` files not removed by `models.rs` on model delete. `models.rs:664`
- [OPEN · NON-BLOCKING] Two `fa_dev` digest tests share a process-global memo and are latently racy. `fa_dev.rs:731`
- [OPEN · NON-BLOCKING] Whisper attach buffer has a 30s stale-replay window; its panic path can orphan a registry key. `whisper.rs:172`
- [OPEN · NON-BLOCKING] React maximum update depth exceeded during a V8 FA run; distinct from guarded `usePlayback.ts:80-94` rAF tick. Trigger unlocated.
- [OPEN · NON-BLOCKING] Dev-profile WebKit IDB holds 469MB legacy v1 data; packaged build is 15.7MB. Non-shipping cleanup.
- [OPEN · NON-BLOCKING] Export ffmpeg concat/mux paths outside the annexb-piece path (legacy `exportPipeline.ts` concat demuxer, video/audio mux step) are unbounded/unaudited, unlike `TauriFfmpeg.concatAnnexbPieces`. `exportPipeline.ts:263`
- [OPEN · NON-BLOCKING] macOS `VideoEncoder` output is not byte-reproducible run to run (76/1200 annexb chunks matched across 2 identical runs) — `pieceSha256` cannot gate output equivalence; use `FrameContentDigest` instead
- [OPEN · NON-BLOCKING] Part C live export's longest silent interval (10.26s) lacks phase attribution — diagnostics report `phase:null` for most intervals >5s. `exportWorkerDiagnostics.ts`
- [OPEN · NON-BLOCKING] `GL_TRANSITION_SLUGS` is duplicated instead of sharing one source. `compositeParams.ts:34`, `decodeCursorLifetime.ts:26`
- [OPEN · NON-BLOCKING] (needs triage) 10 local `archive/wt-*-2026-09-14` branches exist (e.g. `archive/wt-final-crash-audit-2026-09-14`, `archive/wt-ws3-recovery-ui-2026-09-14`) — confirmed **none are pushed to origin** (`git ls-remote --heads origin` returns zero matches); local-only, disposition undecided
