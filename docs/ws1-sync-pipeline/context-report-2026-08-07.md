# Kinetix Pro Studio — Full-Context Project Investigation Report

**Generated:** 2026-08-07 · **Mode:** read-only forensic reconstruction · **Subject:** current uncommitted working tree (detached `HEAD` at `8d83358`, tag `clean-baseline-2026-07-31`)

This report is graph-assisted (`graphify-out/GRAPH_REPORT.md`, `graph.json`, `manifest.json`) but every claim in §1–§11 was independently verified by opening the cited file or running the cited command. The graph is a routing index, not evidence — see §2 and §12.5 for where it was wrong or unconfirmable.

---

## 0. How to read the tags

- **[MEASURED]** — file opened / command run, cited `path:Lstart-Lend` or a shell command.
- **[ASSERTED]** — a human claim in CLAUDE.md / project-state.md / docs/history.md / a code comment, cited verbatim.
- **[ASSUMED]** — my inference; falsification condition stated.
- **[GRAPH-EXTRACTED]** / **[GRAPH-INFERRED]** — only appear in §12.5 (leads not promoted).

---

## §1. Executive State

1. **Current checkout is `HEAD` (detached, `8d83358`, tag `clean-baseline-2026-07-31`), not `main`.** `main` sits at `d8cc5db`, 134 commits behind `HEAD`. [MEASURED: `git rev-parse HEAD main`, `git log --oneline main..HEAD | wc -l` → 134]
2. **The sync engine (Hirschberg diff aligner, rescue passes, run-survival gates, breath discrimination) is shipped and stable on `HEAD`.** `tsc --noEmit` clean, `vitest` 1165/1165 as of this commit. [ASSERTED: project-state.md:13,19]
3. **A large follow-on effort ("Model P") was built on top of `HEAD` and then fully reverted the same day this report was requested.** 48 commits / 137 files / +57,423 −1,438 lines on `model-p-editor-work` beyond `HEAD`; commit `210855d` ("park") captured the discarded working tree "immediately before `src/` was reverted to `18f5734`." [MEASURED: `git log --oneline HEAD..model-p-editor-work | wc -l` → 48; `git show --stat 210855d`]
4. **`main` itself is stale by an entire generation of work** — it predates not only Model P but the sync-rewrite-adjacent UI polish, timeline redesign, and Bug C fixes that are already shipped on `HEAD`. Anyone building from `main` today gets neither WS1's finished state nor Model P. [MEASURED: `git merge-base main HEAD` = `d8cc5db` = `main`'s own tip]
5. **Export runs via one of two gated paths, decided fresh per run**: default is the WebCodecs+WebGL2 worker path; fallback is the legacy ffmpeg-canvas path. Real-world speedup is measured at ~2.3×, not the synthetic ~28× figure. [ASSERTED: project-state.md:84-86]
6. **Export is desktop-only** — no server, no ffmpeg.wasm; the sidecar binaries are gitignored and CI-provisioned. [ASSERTED: CLAUDE.md "What This App Does"; MEASURED: `.github/workflows/build.yml` downloads ffmpeg from `osxexperts.net`/`evermeet.cx`/`gyan.dev`]
7. **CI never runs tests.** `.github/workflows/build.yml` is `workflow_dispatch`-only (no push/PR trigger) and contains no `npm test`/`vitest`/`cargo test`/`tsc` step anywhere in its 9,722-byte body — it only cross-builds installers. [MEASURED: `.github/workflows/build.yml:1-9`, grep for test-related `run:` steps → 0 hits]
8. **Rust test coverage is 4 unit tests, all for one function** (`ffmpeg_concat_annexb_pieces`, the macOS EMFILE fix). `whisper.rs` and the other 15 `ffmpeg.rs` IPC commands have zero Rust tests. [MEASURED: `src-tauri/src/ffmpeg.rs:684-784`]
9. **The current working tree carries five untracked directories** (`.answer-keys/`, `.listening-clips/`, `.work-phase4/`, `graphify-out/`, `scripts/`) — the first three are leftover data artifacts from the reverted Model P listening-test/forced-alignment work (Spanish audio clips, answer keys, breath-onset measurements); `scripts/` retains only Python `__pycache__` files with no tracked `.py` source. [MEASURED: `git status --porcelain`; `find scripts -type f`]
10. **CLAUDE.md's File Map, despite being extremely detailed, omits several current, substantial, non-trivial files** — `videoDecoderPool.ts` (915 lines), `videoDemuxer.ts`, `useWebCodecsPreview.ts` (723 lines), `useFirstFrameCache.ts`, `ReviewMappingModal.tsx`, `SegmentControls.tsx`, `TextLayersPanel.tsx`, `DevTestPanel.tsx`, `headingLayer.ts` — none have their own File Map entry despite CLAUDE.md's own `mtime` being today's. [MEASURED: `grep -n "ReviewMappingModal\|SegmentControls\|TextLayersPanel\|useFirstFrameCache\|headingLayer.ts\|DevTestPanel" CLAUDE.md` → only incidental mentions, no entries]

---

## §2. Architecture & Module Map

### 2.1 Seed: the 78 communities, corrected

`graphify-out/GRAPH_REPORT.md` reports 1,751 nodes / 4,306 edges / 78 communities (66 shown, 12 thin omitted) over a 175-file, ~410,705-word corpus, extracted 100% at confidence EXTRACTED with 12 INFERRED edges (avg 0.68). [MEASURED: `graphify-out/GRAPH_REPORT.md:3-10`]

The community list is a reasonable first pass but the names are LLM-generated labels, not architecture — four distinct communities are independently named "Package Manifest" (communities 34, 43, 50, 63 all resolve to slices of `package.json`), and several "communities" are in fact a single oversized file (see §3.5). [MEASURED: `graphify-out/GRAPH_REPORT.md:47,56,63,77,83-87` list "Package Manifest" five times total across the community list]

### 2.2 Corrected module map (by what actually runs)

```
Frontend (React 19 + Vite, TypeScript strict)
├─ App.tsx (4,369 LOC)               — top-level state, orchestration, playback wiring, export trigger
├─ types.ts (464 LOC)                — the shared contract (§3)
├─ components/                       — 30+ files; UI panels, modals, Timeline, PreviewStage
├─ hooks/                            — usePlayback, useExport, useWhisper, useGlPreview,
│                                       useWebCodecsPreview, useFirstFrameCache
├─ services/
│  ├─ Sync engine: syncEngine.ts, whisperService.ts, snapBoundaries.ts,
│  │  syncConstants.ts, textNormalize.ts, silenceDetector.ts       (§4)
│  ├─ Legacy export: exportPipeline.ts, segmentEncoder.ts,
│  │  frameRenderer.ts, frameEncodeWorker.ts, plainSegment.ts       (§6)
│  ├─ WebCodecs export: services/webcodecsExport/*
│  │  (exportPipelineWebCodecs.ts, exportWorker.ts, glCompositable.ts,
│  │   sequentialDecode.ts, textRenderer.ts, fontResolver.ts, muxOnly.ts) (§6)
│  ├─ WebCodecs preview: videoDecoderPool.ts, videoDemuxer.ts,
│  │  useWebCodecsPreview.ts, useFirstFrameCache.ts                (undocumented in CLAUDE.md — §1.10)
│  ├─ gl/ (WebGL2 preview+export shared engine): glCompositor.ts,
│  │  compositeParams.ts, shaders.ts, glContext.ts, uvRect.ts, autoGrade.ts
│  └─ Persistence: assetStore.ts (IndexedDB), projectStore.ts (localStorage),
│     waveformStore.ts (IndexedDB), lookPresetService.ts / presetService.ts (localStorage)
└─ dev/                              — 7 throwaway spike harnesses + fixture builders (§7)

Tauri v2 shell (Rust, src-tauri/)
├─ ffmpeg.rs   — 16 IPC commands, session-scoped temp dirs, 4 unit tests (all for concat)
├─ whisper.rs  — 2 IPC commands (transcribe + cancel), streams progress via Channel, 0 tests
└─ lib.rs      — Builder registration, fetch_url_bytes CORS proxy
```

[MEASURED: file existence/line counts via `wc -l` and `Read` throughout this session; CLAUDE.md File Map cross-checked against actual tree]

### 2.3 The dual export architecture

CLAUDE.md and project-state.md both independently assert, in prose (not just the graph), that export runs through exactly two gated paths chosen fresh every run by `useExport.ts`'s `isWebCodecsExportGateOpen()` — capability probe AND persisted toggle, both required, toggle defaults ON. [ASSERTED: CLAUDE.md "WebCodecs + WebGL2 Worker Export Path" section; project-state.md:84]

The graph's hyperedge `webcodecs_webgl2_export_path` / `legacy_ffmpeg_export_pipeline` asserting this same dual structure carries `[GRAPH-INFERRED 0.85]` (GRAPH_REPORT.md:118). **Independently confirmed**: `src/hooks/useExport.ts` contains `isWebCodecsExportGateOpen()` which branches `runExport` to either `exportProjectWebCodecs` (`services/webcodecsExport/exportPipelineWebCodecs.ts`) or the legacy `exportProject` (`services/exportPipeline.ts`) — both return the identical `ExportResult` union. [MEASURED: `src/services/webcodecsExport/exportPipelineWebCodecs.ts:825` `export async function exportProjectWebCodecs`; CLAUDE.md's `useExport.ts` file-map entry cross-referenced against the actual gate logic described]

Promoted from [GRAPH-INFERRED] to **[MEASURED]** — the dual-path claim is real, not a text-embedding artifact.

### 2.4 Tier routing (WebCodecs path only)

Every segment is routed to Tier 1 (plain video/image, `plainSegment.ts`, shared with the legacy path), Tier GL (`glCompositable.ts`'s `isGlCompositableSegment`), or Tier C (canvas fallback, `segmentEncoder.ts`, shared with the legacy path). `groupConnectedComponents` (Union-Find over segment indices) forces a whole connected component to Tier C if any member is disqualified, so a real GL-slug transition between a GL-eligible and a non-eligible segment can't be silently dropped or double-rendered. [MEASURED: `src/services/webcodecsExport/exportPipelineWebCodecs.ts:270-374` `groupConnectedComponents`, `routeSegments`, `buildPiecePlans`]

### 2.5 Tauri sidecar boundary

Two sidecar binaries (`ffmpeg`, `whisper`), both gitignored and provisioned at CI/build time. `ffmpeg.rs` exposes 16 commands including `write_file_raw`/`append_file_raw` (raw-body IPC, no base64), `concat_annexb_pieces` (the macOS EMFILE fix — §6), `probe_audio_duration`, `save_session_file` (native `fs::copy`, bytes never enter the renderer). `whisper.rs` exposes 2 commands (`whisper_transcribe`, `whisper_cancel`) and pre-transcodes uploads to 16kHz mono WAV via the ffmpeg sidecar before invoking `whisper-cli`, because whisper.cpp's miniaudio backend silently produces zero tokens on M4A/AAC. [ASSERTED: CLAUDE.md's `ffmpeg.rs`/`whisper.rs` file-map entries; MEASURED: `src-tauri/src/ffmpeg.rs:684-784` for the concat tests, function count cross-checked against `grep -c "pub fn"` — see §9]

### 2.6 Preview path

Two live preview mechanisms coexist: the WebGL2 compositor (`gl/glCompositor.ts`, production-default since the Phase 5 cutover) for the 4 scoped transitions/2 zooms/color-grading, and a WebCodecs `VideoDecoder`-based frame source (`videoDecoderPool.ts`, `videoDemuxer.ts`, `useWebCodecsPreview.ts`) feeding it real decoded frames instead of `<video>` elements. `PreviewCanvas.tsx` and `PreviewStage.tsx` are the DOM-facing consumers. [MEASURED: file headers of `videoDecoderPool.ts:1-8`, `videoDemuxer.ts:1-9`, `useWebCodecsPreview.ts:1-9`]

### 2.7 Persistence

IndexedDB (`kinetix-assets` v2, store `assets-v2`, compound keyPath `['projectId','id']`, legacy v1 retained for migration) holds asset blobs; a second IndexedDB (`kinetix-waveforms`) holds built peak arrays; localStorage holds per-project JSON under `kinetix:project:{id}:v1` plus a registry `kinetix:projects:v1` (legacy single-project key retained for one-time migration). [ASSERTED: project-state.md:80-81; CLAUDE.md's Persistence Model section]

---

## §3. The Shared Contract (`src/types.ts`, 464 lines, read in full)

`types.ts` is the one file every subsystem in §2.2 ultimately imports from. It declares `TransitionType` (49 enum members), `AnimationType` (52 enum members), `AspectRatio`/`ResolutionTier` (string-literal unions), `Asset`, `SegmentGrade`, `TextOverlay`, `VideoSegment`, `HeadingOverlay`, `TranscriptToken`, `Project`, the `SyncLogEntry`/`SyncRunSummary` WS-logs types, `ProjectMeta`, `TranscriptionStatus`. [MEASURED: `src/types.ts:1-465`, read in full]

### 3.1 `VideoSegment` (84 graph edges — the single highest-degree node)

Independently confirmed as a genuine cross-community bridge, not a graph artifact: its consumers span App.tsx orchestration, every export tier (legacy Tier C, WebCodecs Tier 1/GL/C, all three export spike variants), the preview path (PreviewStage, useGlPreview, useWebCodecsPreview), the sync engine (syncEngine.ts, whisperService.ts, snapBoundaries.ts), the timeline UI, and 10+ test files. [MEASURED: `graph.json` query over `src_types_videosegment`'s 84 edges, grouped by consumer community — full list in §12]

**Field-by-field bearing, verified by grep**:
- **Load-bearing across timing/sync** (both WS1 and the reverted Model P line touch these): `startTime`, `duration`, `anchorStart`, `anchorSource`, `locked`, `text`, `assetId`. `anchorSource` is explicitly documented as *effectively write-only*: "no production code branches on this value post-3c" [ASSERTED: `src/types.ts:205-208`], and project-state.md's Key Invariant (e) independently confirms the same: "confirmed effectively write-only... Still written by `parseProjectData`, `applyAnchorBasedTiming` PASS 1, `distributeSegmentTimes`, and `handleInsertHeading`." [ASSERTED: project-state.md:63]
- **Written-but-never-consumed by a renderer**: `effectOverlay`. The graph's rationale node at `src/effectsOptions.ts:98` claims this field is "written by App.tsx's apply handler and read ONLY by BottomDrawer's display pill — there is no renderer for it on either path." **Independently verified**: `effectOverlay` is written at `src/App.tsx:630,1796,1834` and read only at `src/components/BottomDrawer.tsx:67-68` (an icon-label pill). Grep across `frameRenderer.ts`, `textRenderer.ts`, `glCompositor.ts`, `compositeParams.ts`, `exportWorker.ts` for `effectOverlay` returns zero hits. **[MEASURED — promoted from GRAPH-EXTRACTED]**: `src/effectsOptions.ts:96-101`, `src/App.tsx:630,1796,1834`, `src/components/BottomDrawer.tsx:67-68`.
- **`tag`** — "Display-only — nothing downstream branches on it." [ASSERTED: `src/types.ts:238-242`]
- **`unmatchedExplicitTag`** — internal gating flag for `autoMatchSegments`, recomputed every sync, not surfaced to the user. [ASSERTED: `src/types.ts:209-214`]

### 3.2 `Asset` (59 edges)

Consumer set nearly mirrors `VideoSegment`'s (App.tsx, every export tier, preview path, sync engine) plus `projectStore.ts` and `Timeline.tsx` directly. `nativeFps?` is explicitly scoped: "Used only to auto-suggest exportFps; never fed into per-segment retiming." [ASSERTED: `src/types.ts:131-136`]

### 3.3 Other god nodes, verified

- **`App()` (75 edges)** — `src/App.tsx`, 4,369 lines [MEASURED: `wc -l`]. Not fully read line-by-line this session (see §12.6); its role as top-level orchestrator is confirmed by CLAUDE.md's own extensive in-file-map documentation (~250 lines of prose describing its keyboard-shortcut effect, resize-drag guard rails, export-trigger-count double-render workaround, sliderT persistence, etc.) and by the fact every god node above routes through it.
- **`MockWebGL2` (43 edges)** — **not** an architectural hub. It is a `WebGL2RenderingContext` mock class defined and used entirely inside one test file, `src/services/gl/glCompositor.test.ts:46`. Its 43 edges are all internal references from that single file's own test bodies. **[MEASURED — confirms the task brief's own hint]**: `python3` query over `graph.json` for the `MockWebGL2` node → `source_file: src/services/gl/glCompositor.test.ts`, only one file matches `grep -rl "class MockWebGL2"`.
- **`resolveEffectiveTransition()` (28 edges)** — `src/services/transitionResolver.ts`. [ASSERTED: CLAUDE.md's `transitionResolver.ts` file-map entry] — not independently re-verified beyond the file-map description this session.

---

## §4. WS1 — Sync System (Sync-Related Working Set, "WS1a" through "WS6" + the token-stealing fix and its 2026-07-29→2026-08-02 follow-ons)

**WS = "Work Stream"**, this project's own label for a named batch of sync-engine changes (WS1a, WS1b, WS4, WS5, WS6 are sequential sub-phases of one rewrite; WS-logs and WS6 are separate late additions). [ASSERTED: docs/history.md:2093 "What shipped, in order: WS1a... → QB1/QB2 → ... → WS1b → WS-logs → ... → WS4 → WS5 → the token-stealing bug-class fix → WS6"]

### 4.1 What's implemented, on `HEAD`, today

- **Hirschberg diff aligner** — replaced a "greedy positional matcher." [ASSERTED: docs/history.md:2093]
- **Rescue passes** (3-pass per-segment temporal-bounding rescue in `whisperService.ts`) for a segment that scored zero true matches in the single global alignment pass. Pass 1: bounded search around the segment's own `anchorStart`. Pass 2: unbounded exact-text scan over unclaimed tokens (fires only if Pass 1 finds nothing). Pass 3: multi-token concatenation for sub-word-split tokens (fires only if Pass 2 finds nothing). [ASSERTED: CLAUDE.md's `whisperService.ts` entry, "Per-segment temporal-bounding RESCUE"]
  - **Forward-ordering bound** (2026-07-31 fix) — closes a false-positive where a no-audio heading's rescue claim could steal a much-later segment's real match by pure text collision. Fixed by requiring a rescue claim's earliest token sit strictly before the first token any *later* segment truly matched in the global pass — order, not distance, since a legitimate rescue can recover a word 44s from its slot. [ASSERTED: CLAUDE.md whisperService.ts entry, "Rescue forward-ordering bound"]
- **Bug C — consecutive-run survival gates** — `computeLongestRunWithHoles` (tolerates up to `RUN_SURVIVAL_MAX_HOLE=2` non-matched positions inside a run) plus a density fallback (`RUN_SURVIVAL_DENSITY_MIN_CONFIDENCE=0.5`, `RUN_SURVIVAL_DENSITY_MAX_MEDIAN_GAP=4`) for a segment whose matches are scattered rather than contiguous. Replaced an earlier ratio-scaled formulation calibrated wrong on a real 174-segment project. [ASSERTED: CLAUDE.md whisperService.ts entry; constants confirmed at `src/services/syncConstants.ts:323,382-383,407-408`]
- **Breath discrimination** — three iterations documented in full in docs/history.md:2229-2251 (§4 "Intra-segment silence rejection"): (1) window/span/tolerance — deleted in the 2026-07-31 regression fix below; (2) token-gap discrimination (`fillsTokenGapWithinSpan`, `TOKEN_GAP_EPSILON_SEC=0.02s`); (3) coverage-composite (`isBreathSilence`, `BREATH_MAX_SPEECH_COVERAGE_RATIO=0.3`, `BREATH_TOKEN_OVERLAP_FLOOR_SEC=0.09s`). [MEASURED constants: `src/services/syncConstants.ts:215,273,286`]
- **Contention-aware silence claiming** — replaced first-come-first-served `usedSilences` with a 3-pass assign-by-closest-midpoint scheme in `snapBoundaries.ts`, later ported verbatim into `whisperService.ts`'s own gap-fill so both snap paths stay in parity. [ASSERTED: CLAUDE.md `snapBoundaries.ts` entry; docs/history.md §5 "Aligner gap-fill fix port"]
- **Clean-slate re-sync** — "anchors are never restored from previous segments... every anchor is re-derived fresh each sync from `parseProjectData`'s character-weight estimates." [ASSERTED: CLAUDE.md "Anchor-Based Segment Timing" section]
- **Window-overlap regression fix (2026-07-31)** — a real production bisect (173/174-segment project) against pre-regression commit `0c83a06` found the SPAN/tolerance test in `isBoundarySilenceCandidate` was rejecting genuine boundary silences wholesale because real Whisper trailing-word timestamps blur past the old 0.3s tolerance routinely. Deleted, not re-tuned, because breath rejection is independently covered by `fillsTokenGapWithinSpan`/`isBreathSilence` (alignment evidence, not a timestamp guess). `BOUNDARY_SILENCE_INTRUSION_TOLERANCE_SEC` was deleted from `syncConstants.ts` entirely — confirmed absent: `grep -n BOUNDARY_SILENCE_INTRUSION_TOLERANCE_SEC src/services/syncConstants.ts` returns 0 hits (only a REMOVED note remains). [MEASURED]

### 4.2 "Ready but gated" — what this phrase does NOT describe

Nothing in the currently-checked-out `HEAD` tree is behind a feature flag for the sync engine itself — clean-slate re-sync, the rescue passes, and Bug C run-survival gates all run unconditionally on every Apply Sync. The only *export-side* gate is `isWebCodecsExportGateOpen()` (§2.3, §6), which is unrelated to sync. project-state.md is explicit: **"No open sync items remain tracked. Active work is feature tasks only."** [ASSERTED: project-state.md:19] There is no gate to name for the sync engine because there is nothing gated — the task brief's framing ("what 'ready but gated' means concretely") does not describe this codebase's actual sync-engine state as of `HEAD`; it may describe a hypothetical the task author expected to find. Flagged here rather than silently invented.

### 4.3 A notable rejected-then-revisited decision

WS1's own design phase explicitly considered and dropped wav2vec2 forced alignment: **"wav2vec2 forced alignment — removed from tracking (never scheduled; considered and dropped during the rewrite's design phase)."** [ASSERTED: docs/history.md:2130] The later, fully-reverted Model P effort (§5) spent its "Phase 2b/3" (`adad783`, `d4e6c0b`, `1f5de51`, etc.) re-investigating exactly this approach (HuggingFace CTC forced-alignment scripts under `scripts/measure-forced-alignment*.py`, DTW, breath-aware reference correction) before it too was abandoned. [MEASURED: `git log --oneline HEAD..model-p-editor-work` commit subjects; `git diff --stat HEAD...model-p-editor-work` lists `scripts/measure-forced-alignment*.py`]

---

## §5. WS2 — The "Model P" Effort (reverted 2026-08-07)

**Important correction to the task's framing**: `model-p-editor-work` is **not** an independent parallel branch competing with `HEAD` for merge order. It is a direct, linear *continuation* of `HEAD` — `git merge-base HEAD model-p-editor-work` returns `HEAD`'s own commit hash (`8d83358`), i.e. `HEAD` is an ancestor of `model-p-editor-work`. [MEASURED: `git merge-base HEAD model-p-editor-work` = `8d833580c327eebef4fb17dff926160e007bc2db`; `git merge-base --is-ancestor 8d83358 model-p-editor-work` → exit 0 (true)]

The true topology is a single line: `main (d8cc5db)` → 134 commits (WS1 sync rewrite + UI polish) → `HEAD (8d83358, tag clean-baseline-2026-07-31)` → 48 more commits (the "Model P" effort, tag `model-p-parked-2026-08-07`) → `model-p-editor-work` tip (`210855d`, "park" commit). [MEASURED: full `git log --oneline --decorate` graph traversal, §investigation above]

### 5.1 What Model P actually was

Despite the branch name ("editor-work"), the bulk of the 48 commits are a second, much larger sync-accuracy research program, not primarily export or editor work:

- **Sync Pipeline Contract Program** (`1758c4b`, `3e66828`) — a v1 plan (6 contracts, 14 risks) then superseded by a v2 plan (`d09a976`, `53ff455`, `c522248` — "stage contracts, stage locking, Stage 1 observability, RU descope, adversarial audit").
- **Phases 0 through 4** of an empirical forced-alignment research track: Phase 0 baseline lock, Phase 1 in-app transcript inspector, Phase 1b smear-metric baselines (V6 and 173-segment projects), Phase 2a multilingual model swap + language override, Phase 2b word-onset measurement + DTW (**"DTW abandoned (measured zero effect)"** [ASSERTED: commit subject `adad783`]), Phase 3 forced-alignment scoring against human ground truth with a stated result improvement **"p95 338ms→82ms"** [ASSERTED: commit subject `1f5de51` — unitless-context is "sync boundary error, milliseconds, p95, this project's own scoring harness" — no independent corroboration found beyond the commit message itself, tag [ASSERTED] only], Phase 4 baseline methodology + Spanish-language listening batches + K14–K17 timeline drag/lock UI fixes.
- **New production-shaped modules** (per the `HEAD...model-p-editor-work` diff, `src/` and `src-tauri/` only): `syncContracts.ts`, `syncLog.ts` (extracting log-entry builders out of `App.tsx` — CLAUDE.md notes on `HEAD` this extraction was explicitly *not* done: "that file was never extracted, only its TEST file lives under `services/`" [ASSERTED: CLAUDE.md `SyncLogPanel.tsx` entry] — confirming the extraction happened on Model P and was reverted), `projectFingerprint.ts` (lock lifecycle fingerprinting, SHA-256 of a 4-field input tuple), `dragCascade.ts`/`dragGeometry.ts` (timeline drag physics), `timelineLayout.ts`/`timelinePartition.ts` ("gapless timeline partition"), `transcriptInspector.ts`, `boundaryQuality.ts` (a waveform-verified boundary-quality checker).
- **`types.ts` additions** (from the `HEAD...model-p-editor-work` diff, `src/types.ts:+102/-?` lines): `Project.language?: string` (multilingual support, directly reversing project-state.md's own Deferred Polish Feature "Multi-language support" [ASSERTED: project-state.md:33]) and `Project.syncFingerprint?: { hash, input: SyncFingerprintInput }`. [MEASURED: `git diff HEAD...model-p-editor-work -- src/types.ts`]

### 5.2 What survives on `main` vs. `HEAD` vs. the branch

| Line of work | On `main` (`d8cc5db`) | On `HEAD` (`8d83358`, current checkout) | On `model-p-editor-work` (`210855d`) |
|---|---|---|---|
| WS1 sync rewrite (Hirschberg, rescue, Bug C) | ✗ absent | ✓ shipped | ✓ (inherited) |
| Timeline absolute positioning, lane redesign | ✗ absent | ✓ shipped | ✓ (inherited) |
| Model P forced-alignment/DTW research | ✗ absent | ✗ absent | ✓ present (parked, not reviewed) |
| K14–K17 drag/lock/cascade fixes | ✗ absent | ✗ absent | ✓ present |
| `Project.language`, `Project.syncFingerprint` | ✗ absent | ✗ absent | ✓ present |
| `syncLog.ts` extraction | ✗ absent | ✗ absent (inline in App.tsx) | ✓ present |

[MEASURED: `git diff --stat` in each pairwise direction, this session]

### 5.3 Why it was reverted

The commit message on `210855d` states the revert's *mechanics* but not its *rationale*: **"Captures the working-tree state as of 2026-08-07, immediately before `src/` was reverted to `18f5734`. Not a reviewed commit -- a preservation snapshot so nothing is lost by the revert."** [ASSERTED: `git show 210855d` commit message, full text] No decision document, ADR, or docs/history.md entry justifying the revert exists anywhere in the reachable history as of this report (`docs/history.md` on `HEAD` ends at the 2026-07-31 window-overlap entry, §4.1, and was never updated to describe Model P at all, since Model P postdates `HEAD`). **This is a genuine, unresolved evidence gap — flagged, not guessed at.**

### 5.4 Leftover artifacts in the current working tree

Three of the five untracked directories in the current tree are load-bearing evidence that Model P's data-collection apparatus was not fully cleaned up on revert: `.answer-keys/` (`step_q_answer_key.json`, `step_q_transcripts.json` — matches Model P commit `040cc63`'s "Spanish listening batch"), `.listening-clips/spanish-batch/` (audio clips), `.work-phase4/` (`spanish-16k.wav`, `spanish-breath-ref.json`, `spanish-targets-all22.json`, `step-aa-c13-live-repro.json`, `step-w-c11-live-repro.json`, a `replay/` subdirectory, and a `step-x-clips/` subdirectory). All are untracked (never committed) and postdate the revert commit's own timestamp in some cases (`step-aa-c13-live-repro.json` mtime 2026-08-07 17:21, an hour *after* the 16:44:07 park commit). [MEASURED: `git status --porcelain`; `find .work-phase4 .answer-keys .listening-clips -type f` with `ls -la` timestamps]

---

## §6. Export Pipeline Deep Dive

### 6.1 Legacy path

`exportPipeline.ts` → per-segment `segmentEncoder.ts` (frame render via `frameRenderer.ts` → PNG-encode off-thread via `frameEncodeWorker.ts`'s pool → raw-binary IPC write → ffmpeg `libx264 crf16 yuv420p bt709` per-segment MP4) → concat demuxer → audio mux. Tier 1 fast path (`plainSegment.ts`'s `isPlainVideoSegment`/`isPlainImageSegment`) skips per-frame rendering entirely for segments with no compositing. [ASSERTED: CLAUDE.md "Export Pipeline" section, full chain diagram — not independently re-traced line-by-line this session beyond confirming the files exist]

### 6.2 WebCodecs path — tier routing (independently confirmed, §2.4)

`exportPipelineWebCodecs.ts:825` `exportProjectWebCodecs` orchestrates: route (Tier 1/GL/C) → split into pieces (maximal contiguous GL runs; one-piece-per-segment for Tier 1/C) → encode each piece (GL pieces via `exportWorker.ts`'s dedicated Worker; Tier 1/C pieces via the existing encoders, remuxed MP4→AnnexB) → concat via `TauriFfmpeg.concatAnnexbPieces` → frame-count guard (`countAnnexbFrames`) → mux (`muxOnly.ts`). [MEASURED: `src/services/webcodecsExport/exportPipelineWebCodecs.ts:140-1059`, function-signature grep confirms all named stages exist]

### 6.3 The macOS EMFILE fix

`ffmpeg_concat_annexb_pieces` (Rust) stream-copies AnnexB piece files with at most 2 file descriptors open at any time, replacing an earlier `ffmpeg -i concat:a|b|c|...` invocation that opened every piece simultaneously and exceeded macOS's default 256-per-process FD limit — reproduced at 407 segments, `Too many open files`, exit code 232. [ASSERTED: CLAUDE.md `ffmpeg.rs` entry and DO NOT DO table] **Independently verified via the only Rust tests in the codebase**: `concat_annexb_pieces_produces_exact_byte_concatenation`, `concat_annexb_pieces_handles_larger_than_chunk_input` (a >64KB piece to prove the streaming copy doesn't lose bytes at a buffer boundary), `concat_annexb_pieces_missing_piece_errors_and_leaves_no_partial_output`, `concat_annexb_pieces_rejects_traversal_paths` (path-traversal hardening on the piece filename). [MEASURED: `src-tauri/src/ffmpeg.rs:684-784`, read in full]

### 6.4 The triplicated `computeIndividualTier`/`buildPiecePlans`/`driveGlRun`/`encodeCanvasPiece`/`countAnnexbFrames`

Three files define all five: production `src/services/webcodecsExport/exportPipelineWebCodecs.ts` (1,059 lines), and two spike copies under `src/dev/webcodecsStep2Spike/`: `exportPipelineWebCodecsSoftwareSpike.ts` (1,041 lines) and `exportPipelineWebCodecsInstrumentedSpike.ts` (918 lines). [MEASURED: `grep -n "^function\|^export function\|^async function\|^export async function"` on all three files]

**This is not silent drift — it is self-documented, and verified byte-identical where it claims to be.** Both spike files open with an explicit header: *"THROWAWAY [...] SPIKE FILE — byte-for-byte a copy of the real `src/services/webcodecsExport/exportPipelineWebCodecs.ts` (production, UNTOUCHED) with exactly [N] change(s)."* [MEASURED: `src/dev/webcodecsStep2Spike/exportPipelineWebCodecsSoftwareSpike.ts:1-13`, `exportPipelineWebCodecsInstrumentedSpike.ts:1-20`]

Directly diffed `computeIndividualTier` (production lines 200-270 vs. softwareSpike lines 224-294): **zero-line diff, byte-identical.** Directly diffed `driveGlRun`: the *only* difference across 143 lines is the `new Worker(...)` target URL — `'./exportWorker.ts'` in production vs. `'./exportWorkerSoftwareSpike.ts'` in the spike, exactly matching the header's stated single change. [MEASURED: `diff` command output, this session]

`exportPipelineWebCodecsSoftwareSpike.ts` exists to force `HARDWARE_LADDER = ['prefer-software']` (vs. production's `['prefer-hardware', 'no-preference', 'prefer-software']`, confirmed identical at `src/services/webcodecsExport/exportWorker.ts:331`) so Step 8's quality comparison could produce a genuine software-encoded reference export. `exportPipelineWebCodecsInstrumentedSpike.ts` exists to add per-phase wall-clock timing (`instrumentFfmpeg`, `summarizeIpcTiming`) to diagnose a real user-reported slowdown (a 14-segment/33s project measured 116s against an expected ~30-40s). [MEASURED: file headers, `src/dev/webcodecsStep2Spike/exportWorkerSoftwareSpike.ts:1-14`, `exportPipelineWebCodecsInstrumentedSpike.ts:1-20`]

**Verdict**: authoritative implementation is unambiguously `src/services/webcodecsExport/exportPipelineWebCodecs.ts`. The two spikes are deliberate, labeled forks kept only as reproducible A/B evidence for two already-closed investigations (Step 8 quality comparison, a real-project slowdown diagnosis), both explicitly marked "Delete alongside the rest of this spike directory once Step 8 is reviewed" / "delete when done" — **and neither has been deleted**, meaning cleanup is outstanding but the duplication itself is not a maintenance hazard (they are never imported by production code — confirmed no production file imports from `src/dev/`). [MEASURED: `grep -rn "from.*dev/webcodecsStep2Spike" src/services src/components src/hooks src/App.tsx` → 0 hits]

---

## §7. Spike / Evidence Chain

All 7 `spike-*.html` files map 1:1 to a TS entrypoint under `src/dev/`, confirmed via direct grep of each HTML file's `<script type="module" src="...">` tag: [MEASURED]

| HTML harness | TS entrypoint | Question answered | Still reachable? |
|---|---|---|---|
| `spike-webgl.html` | `src/dev/webglFeasibilitySpike/main.ts` | Does WebGL2 create on real Tauri WKWebView; does a WebCodecs `VideoFrame` upload cleanly to a GL texture; do the 6 scoped shaders compile/render correctly (pixel readback) | Yes — file present, `vite` dev server would serve it; not run this session (§1.3) |
| `spike-webcodecs.html` | `src/dev/webcodecsSpike/main.ts` | Phase 0: does `VideoDecoder` decode a real MP4 via mp4box.js demux, paint to canvas, preserve B-frame presentation order | Yes, not run |
| `spike-webcodecs-audit.html` | `src/dev/webcodecsAuditSpike/main.ts` | Does `VideoDecoder.isConfigSupported()`/`VideoEncoder.isConfigSupported()` agree with a real configure/decode/encode/flush cycle for the app's exact H.264 High/1080p30/yuv420p codec profile | Yes, not run |
| `spike-webcodecs-worker.html` | `src/dev/webcodecsWorkerSpike/main.ts` (+ `worker.ts`) | The "one true blocker": does the full Worker+OffscreenCanvas+WebGL2+`GlCompositor`+`VideoFrame`-transfer+hardware `VideoEncoder` chain work together on real macOS WKWebView (previously proven only on Chromium/Electron, 600/600 chunks/87fps) | Yes, not run |
| `spike-webcodecs-muxproof.html` | `src/dev/webcodecsMuxProof/main.ts` | End-to-end encode→decode round-trip→AnnexB concat→ffmpeg mux→playable-MP4 proof (60 frames, 1080p30) | Yes, not run |
| `spike-webcodecs-b0repro.html` | `src/dev/webcodecsB0Repro/main.ts` | Reconstructs an unrecoverable-from-git original spike ("B0", commit `1cd8d03` was docs-only) to find which config sweep reproduces a historical `flush()`-hang signature | Yes, not run |
| `spike-webcodecs-step2.html` | `src/dev/webcodecsStep2Spike/main.ts` (3,587 lines — the largest single file in the repo) | Step 3/4: does the real `exportWorker.ts` + AnnexB streaming + `muxOnly.ts` mux actually work end-to-end; caught a real bug (`-framerate` producing a 1.67s file instead of 10s — see §9) | Yes, not run |

Every harness's own header self-labels "THROWAWAY" and instructs deletion once its review closes; none have been deleted. All conclusions are recorded durably in `docs/history.md`'s archived sections (WebGL2 Effects Engine — Full Plan; WebCodecs Preview Migration Phases 0-8; WebCodecs + WebGL2 Worker Export — Implementation Record) rather than living only in the spike files. [ASSERTED: CLAUDE.md cross-references each spike to its docs/history.md record]

**Divergence check**: `exportPipelineWebCodecsSoftwareSpike.ts`/`Instrumented Spike.ts` (§6.4) are the only spike-adjacent files independently confirmed to have NOT diverged from production (byte-identical except their documented deltas). The 7 HTML-driven spikes above were not diffed against current production code this session — flagged in §12.6 as unread.

---

## §8. Test & Verification Inventory

**44 `*.test.ts`/`*.test.tsx` files** under `src/`. [MEASURED: `git ls-files | grep -E '\.test\.(ts|tsx)$' | wc -l`]

Full list (grouped by subsystem, all confirmed present via `git ls-files`):
- **Sync engine**: `sceneTagParsing.test.ts`, `syncTiming.test.ts`, `syncLog.test.ts`, `lockedOverlap.test.ts`, `silenceDetector.test.ts`, `textNormalize.test.ts`, `textUtils.test.ts`, `headingLayer.test.ts`, `segmentSearch.test.ts`
- **Export (legacy + WebCodecs)**: `segmentEncoder.test.ts`, `frameRenderer.blendCache.test.ts`, `plainSegment.test.ts`, `transitionResolver.test.ts`, `canvasAnimations.test.ts`, `animBlend.test.ts`, `webcodecsExport/exportPipelineWebCodecs.test.ts`, `webcodecsExport/glCompositable.test.ts`, `webcodecsExport/muxOnly.test.ts`, `webcodecsExport/sequentialDecode.test.ts`, `webcodecsExport/textRenderer.test.ts`, `webcodecsExport/fontResolver.test.ts`
- **GL engine**: `gl/glCompositor.test.ts`, `gl/glContext.test.ts`, `gl/compositeParams.test.ts`, `gl/autoGrade.test.ts`
- **Preview**: `hooks/useGlPreview.test.ts`, `hooks/useWebCodecsPreview.test.ts`, `hooks/usePlayback.test.ts`, `hooks/useExport.test.ts`, `services/videoDecoderPool.test.ts`, `services/videoDemuxer.test.ts`
- **Waveform**: `waveformPeaks.test.ts`, `waveformPipeline.test.ts`, `waveformStore.test.ts`
- **Misc**: `resolutionConfig.test.ts`, `rangeCompact.test.ts`, `timeFormat.test.ts`, `audioFormats.test.ts`, `zoomScale.test.ts`, `lookPresetService.test.ts`, `notificationSound.test.ts`, `effectsOptions.test.ts`, `components/SyncLoadingOverlay.test.tsx`, `components/SyncLogPanel.test.tsx`

project-state.md asserts the vitest run total as **1165/1165**, and explicitly documents the two most recent deltas: "up from 1133 via the Bug C run-survival-gates regression coverage (commit `4fcf676`, 1133 → 1163) and 4 new `headExtendFirstSegment` tests this session (1163 → 1165)." [ASSERTED: project-state.md:87] **This was not re-run this session (§1.3) — the 1165 figure is [ASSERTED], not [MEASURED].**

**Rust**: exactly 4 `#[test]` functions, all in `src-tauri/src/ffmpeg.rs:684-784`, all exercising `ffmpeg_concat_annexb_pieces` (§6.3). **Zero tests** exist for `whisper.rs`'s 2 IPC commands or for any of `ffmpeg.rs`'s other 15 commands (`create_session`, `write_file`, `write_file_raw`, `append_file_raw`, `read_file`, `count_annexb_frames`, `delete_file`, `exec`, `kill_session`, `destroy_session`, `pick_save_path`, `save_session_file`, `probe_audio_duration`, `probe_video_fps`, `reveal_in_finder`). [MEASURED: `grep -n "#\[test\]"` across all three Rust source files → 4 total, all in `ffmpeg.rs`]

**Conspicuously not covered**: the 7 spike HTML harnesses have no automated test runner integration (they require a manual browser/WKWebView load); `App.tsx` itself has no dedicated `App.test.tsx`; CI runs none of the above (§1.7).

---

## §9. Measured Data Ledger

All values below are quoted verbatim with file:line provenance. Units and measurement context are preserved exactly as found; anything without an attached unit is marked `[UNITLESS]`.

### 9.1 Sync engine constants (`src/services/syncConstants.ts`, 435 lines, read in full)

| Constant | Value | Line |
|---|---|---|
| `ALIGN_MATCH_SCORE` | `1` [UNITLESS — Hirschberg/Needleman-Wunsch score unit] | 37 |
| `ALIGN_MISMATCH_SCORE` | `-1` | 38 |
| `ALIGN_GAP_SCORE` | `-1` | 39 |
| `LOW_CONFIDENCE_RATIO` | `0.4` | 92 |
| `MIN_COVERED_RUN_LENGTH` | `2` | 109 |
| `NOISE_FLOOR_COVERAGE` | `0.1` | 119 |
| `MAX_LOG_ENTRIES` | `500` | 137 |
| `MAX_SYNC_RUN_SUMMARIES` | `10` | 138 |
| `TEMPORAL_TOLERANCE_RATIO` | `0.1` | 152 |
| `TEMPORAL_TOLERANCE_MIN_SEC` | `1.5` s | 153 |
| `TEMPORAL_TOLERANCE_MAX_SEC` | `5.0` s | 154 |
| `MONOTONIC_CARRY_FORWARD_GAP_SEC` | `0.1` s | 168 |
| `TEMPORAL_BONUS_MAX` | `0.3` [UNITLESS — alignment score bonus] | 174 |
| `TEMPORAL_BONUS_CENTRAL_FRACTION` | `0.5` | 175 |
| `MALFORMED_TOKEN_DURATION_TOLERANCE_SEC` | `0.5` s | 184 |
| `TOKEN_GAP_EPSILON_SEC` | `0.02` s | 215 |
| `BREATH_MAX_SPEECH_COVERAGE_RATIO` | `0.3` | 273 |
| `BREATH_TOKEN_OVERLAP_FLOOR_SEC` | `0.09` s | 286 |
| `MAX_CONCAT_TOKENS` | `3` | 297 |
| `MAX_CONCAT_GAP_SEC` | `0.3` s | 298 |
| `RUN_SURVIVAL_MAX_HOLE` | `2` | 323 |
| `RUN_SURVIVAL_MIN_RUN_SHORT` | `2` (segments 4-10 words) | 382 |
| `RUN_SURVIVAL_MIN_RUN_LONG` | `4` (segments ≥11 words) | 383 |
| `RUN_SURVIVAL_DENSITY_MIN_CONFIDENCE` | `0.5` | 407 |
| `RUN_SURVIVAL_DENSITY_MAX_MEDIAN_GAP` | `4` [UNITLESS — token index gap] | 408 |

`BREATH_TOKEN_OVERLAP_FLOOR_SEC`'s doc comment states its own calibration margin explicitly: **"calibrated to admit pair-4's confirmed production overlaps (0.09s, 0.14s)... while excluding a sub-floor artifact (0.05s) — a stated, honest 0.04s margin, not padded."** [ASSERTED: CLAUDE.md's `syncConstants.ts` file-map entry, corroborated by the constant's own value at line 286]

`BOUNDARY_SILENCE_INTRUSION_TOLERANCE_SEC` (formerly 0.3s) — **confirmed deleted**, zero hits on `grep -n BOUNDARY_SILENCE_INTRUSION_TOLERANCE_SEC src/services/syncConstants.ts`. Do-not-reintroduce note present in CLAUDE.md's DO NOT DO list (implicitly, via the REMOVED note in the `syncConstants.ts` file-map entry).

**Drift note**: `MONOTONIC_CARRY_FORWARD_GAP_SEC` still exists at `src/services/syncConstants.ts:168` on `HEAD`. The reverted `model-p-editor-work` line contains a commit explicitly titled `chore: remove dead MONOTONIC_CARRY_FORWARD_GAP_SEC and textMateriallyChanged` (`292d7a5`) — i.e., Model P judged this constant dead and removed it, but since Model P was reverted, `HEAD` still carries it. Whether it is in fact dead on `HEAD` was not independently re-derived this session. [MEASURED: constant present at cited line; commit subject from `git log --oneline HEAD..model-p-editor-work`]

### 9.2 Resolution table (`src/services/resolutionConfig.ts`)

| Aspect ratio | 720p | 1080p |
|---|---|---|
| 16:9 | 1280×720 | 1920×1080 |
| 9:16 | 720×1280 | 1080×1920 |
| 1:1 | 720×720 | 1080×1080 |

[MEASURED: `src/services/resolutionConfig.ts:22-25`] `DEFAULT_ASPECT_RATIO = '16:9'` (line 28); `DEFAULT_RESOLUTION_TIER` asserted `'1080p'` per CLAUDE.md, not independently re-confirmed at its own line this session.

### 9.3 WebCodecs export encoder ladder

`HARDWARE_LADDER: HardwareAcceleration[] = ['prefer-hardware', 'no-preference', 'prefer-software']` — confirmed byte-identical at `src/services/webcodecsExport/exportWorker.ts:331` (production) and `src/dev/webcodecsStep2Spike/exportWorkerInstrumentedSpike.ts:279` (spike, unmodified per its own header). The `exportWorkerSoftwareSpike.ts` variant forces this to `['prefer-software']` only, at line 355. [MEASURED]

### 9.4 Preview blend timing

`SNAP_RELEASE_BLEND_S = 0.12` s — defined at `src/hooks/useWebCodecsPreview.ts:369`, consumed by `src/components/PreviewStage.tsx:28,693` (`computeBlendProgress(snapReleaseRef.current, currentTime, SNAP_RELEASE_BLEND_S)`). [MEASURED] **Note**: the task brief's example cited this constant as though defined in a dedicated constants file; it is in fact defined inline in `useWebCodecsPreview.ts`, not a separate module — corrected here rather than silently accepted.

### 9.5 Performance figures (all [ASSERTED], none re-measured this session — §1.3)

| Path | Figure | Context | Source |
|---|---|---|---|
| WebCodecs export, synthetic | 194s → 6.8s (~28×) | Step 8 synthetic effects-heavy benchmark | project-state.md:85 |
| WebCodecs export, real projects | ~2.3× | "the honest number, not the synthetic one" | project-state.md:85 |
| WebCodecs `desynchronized:true` | ~12% additional speedup | OffscreenCanvas GL context flag | CLAUDE.md's `glContext.ts` entry |
| Legacy export, macOS Intel x86_64 | ~10× realtime (120s for 12s of 1080p30 output) | **Stale — pending re-measurement**, predates the 2026-07-09 worker-pool PNG encode speedup | project-state.md:86 |
| Legacy export, Windows | ~6× realtime (6 min per 1 min of video) | "measured on brother's PC" [UNITLESS/informal provenance, quoted verbatim] | project-state.md:86 |
| Legacy export, macOS arm64 | pending measurement | — | project-state.md:86 |
| WebCodecs verification platform | macOS Intel x86_64 only | "macOS arm64 and Windows/WebView2 remain UNVERIFIED (no hardware access during implementation)" | CLAUDE.md's WebCodecs export path section |
| Frontend bundle | 505.86 kB / 152.74 kB gzip | measured 2026-06-22, no wasm in bundle | project-state.md:88 |
| whisper.cpp build flags | `GGML_NATIVE=OFF`, AVX/AVX2/FMA/F16C on, AVX-512 off | "a runner-native build with AVX-512 faults with STATUS_ILLEGAL_INSTRUCTION on consumer CPUs (confirmed on Alder Lake i3-12100F)" | `graphify-out/GRAPH_REPORT.md:153` (rationale node, itself quoting a project doc — not independently traced to its original source file this session, flagged in §12.5) |

### 9.6 Numbers in docs but not (re-)confirmed in code this session

The Model P "p95 338ms→82ms" and "38/44 gate pass" and similar figures (§5.1) exist only as commit-subject text on the reverted branch — no corresponding CSV/measurement file was opened to verify the arithmetic, since doing so would require checking out `model-p-editor-work` content, which is outside this report's read-only/HEAD-focused scope by design (§1.4 directs analysis of the current uncommitted working tree as the primary subject). Flagged as **[ASSERTED, unverified arithmetic]**.

---

## §10. Risks, Defects, Open Questions

1. **`main` is 134 commits stale** relative to the actual best-known-good state (`HEAD`). Anyone cloning `origin/main` gets neither WS1's finished sync engine nor any UI work since. No open PR or fast-forward plan was found in the reachable refs. [MEASURED — §5, §1.4]
2. **The Model P revert has no recorded rationale.** The `210855d` commit message documents *what* was preserved, not *why* the whole line was abandoned. This is the single largest unresolved question this report surfaces — see §5.3, §11. [MEASURED — absence confirmed by `grep`-scanning `docs/history.md`, `project-state.md`, and the commit itself for a decision rationale]
3. **CLAUDE.md's File Map has a real, non-trivial documentation gap** — 9 confirmed files (§1.10) with zero File Map entry, several exceeding 200-900 lines and load-bearing per the graph's own edge counts (`videoDecoderPool.ts` sits in `Asset`'s 59-edge consumer set, §3.2). This is surprising given CLAUDE.md's mtime is today's and its other entries are unusually exhaustive — suggests the WebCodecs-preview-migration and a handful of UI-decomposition files were never folded back into the living doc after their initial `docs/history.md` archival entries. [MEASURED]
4. **Independent re-check of "0 import cycles" (GRAPH_REPORT.md:113-114) finds one, but it is compile-time-erased, not a real risk.** A file-level DFS over the graph's `imports`/`imports_from` edges surfaces exactly one 2-node cycle: `whisperService.ts → snapBoundaries.ts → whisperService.ts`. Traced to source: `snapBoundaries.ts:214` does `import type { SegmentAlignment } from './whisperService'` (TypeScript `import type`, erased at compile time — no runtime module graph edge), while `whisperService.ts:19` does a real value import of `snapBoundaries.ts`'s three candidacy predicates. **Net verdict: the graph's "None detected" claim is correct for the risk that matters (runtime circularity); a naive AST-only cycle check would incorrectly flag this pair.** Both readings are now on record. [MEASURED: custom DFS script over `graph.json`'s `imports`/`imports_from` edges; `grep` confirms the `import type` keyword at the specific line]
5. **The graph's "328 isolated nodes" figure could not be reproduced.** An independent recount of nodes with degree ≤1 over the full multigraph gives **497** (or higher — 804/865 — when `contains`/`method` structural edges are excluded from the degree count). No combination of edge-type exclusion tried this session reproduces exactly 328. **Left as an open discrepancy, not resolved** — the report's summary number and an independent recount disagree by a wide margin, and the exact isolation definition the summary generator used is not documented in `GRAPH_REPORT.md` itself. [MEASURED: three independent Python `degree` computations over `graph.json`, none matching 328]
6. **Zero CI test gating** (§1.7, §8) — the only CI workflow builds installers on manual dispatch; nothing runs `vitest`, `tsc --noEmit`, or `cargo test` automatically on any push or PR. The 1165/1165 vitest figure and "tsc --noEmit clean" claim in project-state.md are therefore asserted by whoever ran them locally, with no automated corroboration path. [MEASURED: `.github/workflows/build.yml` full content]
7. **Rust test coverage is a single function** (§6.3, §8) — 15 of 18 total Tauri IPC commands (all of `whisper.rs`, most of `ffmpeg.rs`) have no automated test at all, including security-relevant surfaces like `write_file_raw`/`append_file_raw`'s path-traversal validation (asserted in CLAUDE.md to exist, "validates the header-supplied path the same way `write_file` does" — not independently verified by a test, since only `concat_annexb_pieces`'s traversal case has a test).
8. **`fetch_url_bytes` SSRF exposure is a tracked, unresolved item**, not something this session discovered new: "currently fetches any URL passed from the webview; acceptable for internal single-user use, required before public launch." [ASSERTED: project-state.md:50]
9. **Leftover Model-P data directories are untracked and unaddressed** (§5.4) — `.answer-keys/`, `.listening-clips/`, `.work-phase4/` contain no `.gitignore` entry found for them (not verified against `.gitignore` contents this session — flagged as unconfirmed) and sit in the working tree with no cleanup commit.

---

## §11. Sequencing Analysis — WS1 vs. "WS2"

**This section's central finding overturns the task brief's own framing.** The brief asks "which should come first, WS1 or WS2" as if choosing between two competing, not-yet-built options. The actual history is not a choice to be made — it already happened, sequentially, and was already decided:

### 11.a File-set intersection

Between `HEAD` (WS1's finished state) and `model-p-editor-work` (Model P / "WS2"), restricted to `src/` and `src-tauri/`: **38 files**, +7,953/−1,421 lines. [MEASURED: `git diff --stat HEAD...model-p-editor-work -- src/ src-tauri/`] The full list includes the entire sync-engine core (`syncEngine.ts`, `syncConstants.ts`, `snapBoundaries.ts`, `whisperService.ts`, `useWhisper.ts`), the shared contract (`types.ts`), the top-level orchestrator (`App.tsx`, +1,228/− lines — more than a quarter of the file's total 4,369 lines touched), the sync-log UI (`SyncLogPanel.tsx`), the timeline UI (`Timeline.tsx`, `TimelineWaveform.tsx`), and — notably — two export files: `exportPipeline.ts` (+61 lines, "export gap guard" per the park commit message) and `exportPipelineWebCodecs.ts` (+11 lines). Model P touched almost none of the WebGL2/GL compositor, preview, or Rust sidecar code — it is overwhelmingly a sync/editor-timeline change, not an export change, despite the branch's name suggesting "editor work" broadly.

### 11.b Shared-symbol intersection

Both efforts converge on the exact same god-node contract from §3: `VideoSegment` (via `anchorStart`, `locked`, `startTime`/`duration`), `Project` (Model P adds `language`, `syncFingerprint` as new optional fields — additive, not a breaking change to `HEAD`'s shape), and the `SyncLogEntry` type family (Model P extracts the log-builder logic that lives inline in `App.tsx` on `HEAD` into a new `syncLog.ts` module — a pure refactor, same data shape). No god-node field was redefined incompatibly between the two lines; Model P is additive at the type level. [MEASURED: `git diff HEAD...model-p-editor-work -- src/types.ts`, read in full]

### 11.c Genuinely independent, or coupled through a shared contract?

**Coupled, and inextricably so — not by accident but by construction.** Model P is not a fork that happens to touch the same files; it is a linear continuation built with `HEAD`'s sync engine as its literal starting point (§5, topology proof). Every one of its 38 touched `src/`/`src-tauri/` files already existed on `HEAD` before Model P's first commit. There is no meaningful sense in which "WS1" and "WS2" are two options to sequence — Model P's entire premise (fixing residual sync-accuracy issues via forced alignment, and fixing timeline-drag UX) presupposes WS1's Hirschberg aligner, run-survival gates, and absolute-positioned Timeline already existing. Quantified coupling: **38 shared files, ≥6 shared exported symbols/types at the contract layer** (`VideoSegment.anchorStart`/`locked`, `Project` itself, `SyncLogEntry`, `SyncRunSummary`, plus the `fillsTokenGapWithinSpan`/`isBreathSilence`/`isBoundarySilenceCandidate` predicate trio that Model P's `syncContracts.ts` and `boundaryQuality.ts` both build directly on top of, per their commit subjects referencing "waveform-verified fallback-boundary warnings" and "calibrated dual gate").

### 11.d Ordering implication

There is no forward-looking ordering decision left to make for *these two specific efforts* — WS1 shipped and stayed; Model P was built after it, atop it, and was reverted. The only live decision this analysis can inform is: **should Model P (or pieces of it) be re-attempted, and if so, on top of what base?** The evidence says: on top of `HEAD` again, since that is the only base Model P was ever actually built and tested against, and reverting to `HEAD` (rather than to `main`) was the choice actually made on 2026-08-07. Two specific Model P deliverables look separable and lower-risk to re-attempt independently of the abandoned forced-alignment research: (1) the `projectFingerprint.ts` lock-lifecycle fingerprint (a narrowly-scoped, additive `Project.syncFingerprint` field with a clear owner ruling cited in its own doc comment — "Model P, owner ruling 2026-08-07 task 2" [MEASURED: `git diff HEAD...model-p-editor-work -- src/types.ts`, comment text]), and (2) `Project.language`/multilingual support, which directly closes a long-standing Deferred Polish Feature (§5.1). Both are additive to `HEAD`'s existing types and don't require the DTW/forced-alignment machinery that was itself measured to have "zero effect" (§4.3) and dropped.

**What would reverse this recommendation**: discovery of a decision document explaining *why* Model P was reverted wholesale (§5.3, §10.2) that identifies a defect in one of these two specific pieces rather than in the forced-alignment research track — none was found this session, so this recommendation rests on the absence of a documented objection, not on a confirmed clean bill of health for `projectFingerprint.ts`/`Project.language` specifically. **This is stated as a gap, not resolved as a guess.**

---

## §12. Appendices

### 12.1 Coverage reconciliation (§Phase 0)

- `git ls-files`: 201 tracked files. `graphify-out/manifest.json`: 175 entries. `graph.json` unique `source_file` values: 174.
- **In git, absent from the graph** (26 files, all non-parseable asset/config types — expected, not a gap): `.cargo/config.toml`, `.env.example`, `.gitignore`, `dev.bat`, `metadata.json` (the AI-Studio-era root file — see below), `package-lock.json`, `src-tauri/.gitignore`, `src-tauri/Cargo.lock`, `src-tauri/Cargo.toml`, 13× `src-tauri/icons/*.png`/`.icns`/`.ico`, `src/assets/export-complete-chime.wav`, `src/index.css`.
- **In the graph, absent from git**: none. Every graph-covered file is tracked, consistent with the graph having been built at `HEAD`'s own commit (`built_at_commit: 8d833580c327eebef4fb17dff926160e007bc2db`, matching `git rev-parse HEAD` exactly).
- **`metadata.json` naming collision, resolved**: the task brief's "metadata.json (per-file manifest: mtime/ast_hash/semantic_hash)" is `graphify-out/manifest.json`, not the repository-root `metadata.json` (which is an unrelated Google-AI-Studio-era project descriptor, explicitly called out as "not used by Vite" in CLAUDE.md's own file map). The two were disambiguated by content inspection before use.
- **175 vs 174**: `manifest.json` has one entry (`metadata.json` itself) with no corresponding graph node — consistent with a JSON file producing no AST-extractable code/rationale nodes.

### 12.2 mtime strata (converted)

| Stratum | Epoch (top of range) | UTC-equivalent local timestamp | Confirmed against `git status`/`git diff`? |
|---|---|---|---|
| A | 1786107019.3 | 2026-08-07 17:50:19 | **Yes** — every Stratum A file is part of `HEAD`'s own last commit (`8d83358`, "Docs: sync CLAUDE.md/history.md/project-state.md..."); working tree is clean against `HEAD` (`git diff --stat HEAD` empty), so these mtimes reflect the last-commit checkout/write time, not uncommitted work. |
| B | 1786103640.5 / .4 | 2026-08-07 16:54:00 | Confirmed as the two named files (`exportPipelineWebCodecs.ts`, `exportPipeline.ts`) — both also appear in the Model P `HEAD...model-p-editor-work` diff (§5.1) as touched by the "export gap guard" addition, but since the *working tree* content matches `HEAD` exactly (clean `git diff`), Stratum B's mtime reflects a checkout/write ~56 minutes before Stratum A's commit-time write, not a distinct uncommitted edit. |
| C | 1785527854.3 down to ~1785502856.7 | 2026-08-01 00:57 down to 2026-07-31 18:00 | Not individually re-verified per file this session; consistent with the many 2026-07-31/08-01 dated `docs/history.md` entries (breath discrimination, window-overlap fix — §4.1). |
| D | ~1784826706–849 | ~2026-07-24 (14 days before Stratum A) | Not re-verified; consistent with `ffmpeg.rs`/`lib.rs` last substantive edits predating the sync-rewrite-era work by roughly two weeks. |

**Caveat, as required**: every mtime-derived claim above is [ASSUMED] unless the adjacent `git status`/`git diff` check is stated — filesystem mtime is destroyed by any fresh clone or checkout and is not authorship time. The Phase-0 hypothesis ("Stratum A is WS1 sync work, Stratum B is a WS2 revert") is **only half right**: Stratum A is correctly WS1-adjacent (the final docs-sync commit), but Stratum B is *not* a WS2 revert artifact in the working tree — the working tree was already clean at `HEAD` before this investigation began; Stratum B's timestamp gap is most simply explained by the git checkout process writing files in more than one pass, not by an uncommitted edit.

### 12.3 Glossary

| Term | Expansion |
|---|---|
| WS1 / WS1a / WS1b / WS4 / WS5 / WS6 | "Work Stream" 1 (and its lettered sub-phases) — this project's own internal label for sequential sub-phases of the 2026-07-24→07-29 sync system rewrite. WS4/WS5/WS6 are later, separately-numbered phases of the same rewrite, not later "work streams" in a different numbering scheme — numbering is historical, not hierarchical. |
| WS2 | Not a term this codebase uses internally. Adopted by the task brief to mean the "Model P" effort investigated in §5; renamed here for clarity since no such label exists in the repo's own history. |
| Model P | This repo's own name (branch `model-p-editor-work`, tag `model-p-parked-2026-08-07`) for the reverted post-`HEAD` effort described in §5. Meaning of "P" not stated anywhere in the reachable history — [UNDEFINED IN TREE]. |
| GL | WebGL2 — the browser 3D/compositing API used for the preview/export shared compositor (`glCompositor.ts`). |
| VO | Not used in this codebase — the closest analogue is "voiceover" (spelled out, e.g. `voiceoverId`), never abbreviated "VO" anywhere found. [UNDEFINED IN TREE as an abbreviation] |
| FD | File descriptor — used in the macOS EMFILE fix discussion (§6.3). |
| EMFILE | POSIX errno for "too many open files" — the macOS default-256-FD-limit bug fixed by `ffmpeg_concat_annexb_pieces` (§6.3). |
| GOP | Group of Pictures — H.264 term for a keyframe-anchored frame sequence; referenced in `sequentialDecode.ts`'s file-map entry re: keyframe-backed decode range selection. |
| Annex-B | The H.264 elementary-stream byte format using start-code-prefixed NAL units (vs. AVCC's length-prefixed format) — mandatory end-to-end in the WebCodecs export path (§6.2). |
| Tier routing / "the gate" | Tier routing: `plainSegment.ts`/`glCompositable.ts` classify each segment into Tier 1 (plain)/GL/C (canvas) for the WebCodecs export path (§2.4). "The gate": `useExport.ts`'s `isWebCodecsExportGateOpen()`, deciding legacy-vs-WebCodecs export per run (§2.3). |
| "parked" | This repo's own term (commit `210855d`'s subject line, tag `model-p-parked-2026-08-07`) for preserving an about-to-be-reverted working tree as a snapshot commit rather than deleting it outright. |
| Clean-slate re-sync | This repo's own architecture term: on every Apply Sync, every segment's `anchorStart`/`anchorSource` is re-derived from scratch rather than carried forward from the previous sync run (§4.1). |
| CTC | Connectionist Temporal Classification — the acoustic-model architecture underlying the "commercial CTC model de-risked" Model P commit (`e10cfb9`); not otherwise defined in the reachable tree beyond that commit subject — [UNDEFINED IN TREE beyond the acronym itself]. |
| DTW | Dynamic Time Warping — a sequence-alignment algorithm Model P's Phase 2b evaluated for word-onset correction and explicitly abandoned ("measured zero effect", commit `adad783`). |
| FA | Forced Alignment — the acoustic-to-text timestamp alignment technique (distinct from this project's own Hirschberg *text* aligner) that both WS1's design phase and Model P's Phase 3 separately considered; WS1 dropped it at design time (§4.3), Model P built and measured it before also being reverted. |

### 12.4 Evidence ledger

Approximate tag counts across §1–§11 of this report (hand-tallied from the tagged claims above, not machine-counted):

| Tag | Approx. count |
|---|---|
| [MEASURED] | ~85 |
| [ASSERTED] | ~35 |
| [ASSUMED] | ~6 |
| [GRAPH-EXTRACTED] promoted to MEASURED | 1 (`effectOverlay`, §3.1) |
| [GRAPH-INFERRED] promoted to MEASURED | 1 (dual export architecture, §2.3) |
| [GRAPH-INFERRED] left unpromoted | 12 (all listed in §12.5) |

### 12.5 Leads not confirmed — all 12 INFERRED edges accounted for

| # | Edge (source --relation--> target) | Confidence | Disposition |
|---|---|---|---|
| 1 | `App() --indirect_call--> makeDefaultProject()` | 0.5 | Not promoted — plausible (App.tsx almost certainly calls a project-factory helper) but not traced to a specific call site this session. Out of scope for the god-node analysis in §3.3, which focused on `VideoSegment`/`Asset`. |
| 2 | `SyncLogPanel() --indirect_call--> formatEntryText()` | 0.5 | Not promoted — consistent with CLAUDE.md's own assertion that `SyncLogPanel.tsx`'s copy-logs button "joins every entry... through `formatEntryText` — the SAME per-entry formatter the panel renders on screen" [ASSERTED, already captured under that citation], so independently re-tracing the call graph was redundant. |
| 3 | `saveProject() --indirect_call--> stripAsset()` | 0.5 | Not promoted — matches CLAUDE.md's Persistence Model description ("asset `url` and `file` fields stripped" before localStorage save) but the specific function name `stripAsset` was not grepped for confirmation this session. |
| 4 | `canonicalize() --indirect_call--> tok()` | 0.8 | Not promoted — highest-confidence INFERRED edge; very likely real (`textNormalize.ts`'s `canonicalize` is documented as a 13-step tokenizer pipeline), but the specific internal call was not opened this session — `textNormalize.ts` was not read in full. |
| 5 | `textNormalize.ts --indirect_call--> escapeRegExp()` | 0.5 | Not promoted — same reason as #4; `textNormalize.ts` not read in full this session. |
| 6 | `spike-webgl.html --semantically_similar_to--> WebCodecs Preview Migration` | 0.75 | **Explicitly the task brief's own example of a text-embedding coincidence, not an architectural relationship** — not promoted. The two do share a real *topical* connection (both are feasibility work for the preview-rendering stack, §7) but "semantically similar" is not the same claim as "architecturally related," and no direct code import or reference was found linking them. |
| 7 | `Clean-slate re-sync ... --conceptually_related_to--> Sync System Rewrite (WS1a–WS6)` | 0.85 | **Promoted in substance, not by citation mechanics** — §4.1 independently confirms clean-slate re-sync is part of the WS1a-WS6 rewrite via direct CLAUDE.md citation, making this edge correct but redundant with primary-source evidence already used. |
| 8 | `Timeline absolute positioning ... --conceptually_related_to--> Segment-1 head-extension` | 0.75 | Not independently re-verified this session — both are separately confirmed real (§4.1, docs/history.md's 2026-07-31 entry) but their causal/conceptual link to each other specifically was not re-traced. |
| 9 | `Waveform Rewrite ... --conceptually_related_to--> Timeline absolute positioning` | 0.75 | Not independently re-verified — plausible (both are Timeline-rendering changes) but out of this session's read scope (`waveformPeaks.ts`/`TimelineWaveform.tsx` not read in full). |
| 10 | `WebGL2 Effects Engine rebuild --conceptually_related_to--> WebCodecs Preview Migration` | 0.85 | Not independently re-verified — both are separately well-documented (§2.6) but their direct conceptual coupling was not re-derived from source this session. |
| 11 | `WebCodecs + WebGL2 Worker Export Path --conceptually_related_to--> Export UX (Live Timer/Chime)` | 0.65 | Not promoted — lowest-confidence-adjacent of the "related" edges; plausible only in the loose sense that both touch `useExport.ts`, not verified as a deliberate design coupling. |
| 12 | `whisper-cli sidecar provisioning --semantically_similar_to--> ffmpeg sidecar provisioning` | 0.75 | Not promoted — true at a description level (both are "gitignored, platform-specific, CI-provisioned static binaries," per CLAUDE.md's own file-map prose for each), but this is a shared *pattern*, not a code dependency; no import or shared provisioning script was found linking them this session. |

### 12.6 What I did not read, and why

- **`App.tsx` (4,369 lines)** — not read start-to-end. Relied on CLAUDE.md's own extensive (~250-line) prose description of its internals plus targeted `grep` for specific claims (`effectOverlay` write sites, §3.1). Risk: any App.tsx behavior not already documented in CLAUDE.md and not touched by my targeted greps is invisible to this report.
- **`docs/history.md` (2,312 lines)** — read via targeted `grep`/`tail`/`sed` for the sections cited (breath discrimination, window-overlap fix, WS6 close-out, the "wav2vec2... dropped" line) rather than end-to-end. The file's earlier sections (WebGL2 Effects Engine Closed Phases, WebCodecs Preview Migration Phases 0-8, Waveform Rewrite, Decisions Log) were not re-read this session — their content is taken on trust from CLAUDE.md's own summaries of them.
- **The 7 spike HTML/TS harnesses (§7)** — headers read, bodies not read in full (largest is 3,587 lines). Not run (§1.3 prohibits execution without explicit instruction).
- **`textNormalize.ts`, `waveformPeaks.ts`, `TimelineWaveform.tsx`, `transitionResolver.ts`, `segmentEncoder.ts`, `frameRenderer.ts`, and most of `services/gl/*`** — not opened this session; their descriptions in §2/§4/§6 come from CLAUDE.md's file-map prose, cross-checked only where a specific claim (constants, function existence) was independently grep-verified.
- **`model-p-editor-work`'s own file contents** (as opposed to its diff against `HEAD`) — deliberately not checked out or read in depth, consistent with §1.4's instruction to treat the current working tree as the primary subject; its existence, commit history, and diff-stat against `HEAD`/`main` were fully investigated via `git show`/`git diff --stat`/`git log`, which is sufficient for the §5/§11 analysis without inspecting every changed line of its 137 touched files.
- **`.answer-keys/`, `.listening-clips/`, `.work-phase4/` contents** — file *names* and *timestamps* enumerated (§5.4); file *contents* (audio, JSON answer keys) not opened, since they are Model-P-era research data outside this report's architecture-forensics scope.
- **Every `*.test.ts(x)` file's actual test bodies** — file existence and naming enumerated (§8) via `git ls-files`; individual test assertions not read. The 1165-test-count claim was not re-derived by running `vitest` (§1.3).
- **`vitest`/`tsc`/`cargo test` were never executed this session** — per §1.3, no test run was performed; all pass/fail claims in this report are [ASSERTED] from project-state.md, never [MEASURED] by this session's own execution.
