# Kinetix Pro Studio — Implementation History

> Archived implementation history — moved out of project-state.md 2026-06-22. See project-state.md for current state.

This file is a chronological archive: the old phase roadmap, the full completed-work log, every phase-summary writeup, and every per-task deep-dive that used to live in `project-state.md`. Nothing here is current-state tracking — for that, see `project-state.md`. Content below is preserved verbatim from the pre-2026-06-22 version of that file except where noted.

---

## Roadmap & Meta Snapshot (as of 2026-06-19, superseded)

> Carried over from the old `project-state.md` "Meta," "Roadmap Phases," and "Current Sprint" sections, which were replaced by the phase-free "Current State" section on 2026-06-22. Kept here so the phase-by-phase framing isn't lost.

### Meta (snapshot)

| Field | Value |
|---|---|
| Last updated | 2026-06-19 |
| Current phase | Phase 7 — Active (3 pending tasks) |
| Hosting target | Desktop app (Tauri DMG/installer) · no web hosting needed for export |
| Target users | YouTube creators — initial internal use across 5–10 channels |
| Repo | TBD |

### Roadmap Phases

| Phase | Description | Status |
|---|---|---|
| Phase 0 | Audit & baseline | ✅ Complete |
| Phase 1 | Foundation refactor | ✅ Complete |
| Phase 2 | Persistence — localStorage + IndexedDB | ✅ Complete |
| Phase 3 | Export pipeline — ffmpeg.wasm in browser | ✅ Complete |
| Phase 4 | Polish — filters, transitions, Safari, error handling | ✅ Complete |
| Phase 5 | Production hardening — tests, accessibility (responsive deferred) | ✅ Complete (2026-05-19) |
| Fidelity Polish | Canvas animations, trimEnd, drag overlays, preview transitions, KEN_BURNS picker fix, Path B export cross-fade | ✅ Complete (2026-05-25) |
| Phase 6 | Desktop app — Tauri wrap with native ffmpeg | ✅ Complete (2026-05-27) |
| Phase 7 | Multi-project + bug fixes + features | ⬜ Active (3 pending) |

### Current Sprint (snapshot)

Heading system stable after 9 rounds of fixes. Three pending tasks remain in Phase 7: auto-captions, export profiling, export implementation.

---

## Completed Work Log

| Date | Work |
|---|---|
| 2026-05-16 | Extracted project from Google AI Studio ZIP, initialized git repo on `main` |
| 2026-05-16 | Wrote comprehensive codebase audit covering architecture, bugs, missing features, and risks |
| 2026-05-16 | Created `CLAUDE.md` — architectural reference with conventions, do-not-do list, known limitations, refactor status |
| 2026-05-16 | Created `project-state.md` — this file |
| 2026-05-16 | Initial commit pushed to GitHub (15 files, 8,254 insertions) |
| 2026-05-16 | Git identity configured (Mohtashim / mohtashim9119@gmail.com) |
| 2026-05-16 | Created and pushed `phase-1-foundation` branch — Phase 1 work begins here |
| 2026-05-16 | **Phase 1 Step 1:** Enabled strict TS (strict, noUncheckedIndexedAccess, noImplicitOverride, noFallthroughCasesInSwitch). Installed @types/react + @types/react-dom. Fixed all 82 type errors in App.tsx and stockService.ts. Added immutable update helpers. 0 tsc errors. |
| 2026-05-16 | **Phase 1 Step 2:** Replaced all Math.random().toString(36) IDs with crypto.randomUUID(). |
| 2026-05-16 | **Phase 1 Step 3:** Fixed stale closure in keyboard listener, dead audio sync branch, .mp4→.webm export, index.html title, stripped AI Studio artifacts from vite.config.ts, removed unused storyMap state. |
| 2026-05-16 | **Phase 1 Step 4:** Removed dead deps (@google/genai, express, dotenv, tsx, @types/express). Moved @types/jszip, vite, @tailwindcss/vite, @vitejs/plugin-react to devDependencies. |
| 2026-05-16 | **Phase 1 Step 5:** Extracted 7 components from App.tsx: StockSearchModal, SyncReviewModal, SegmentEditorPanel, Timeline, PreviewStage, SyncWizard, SettingsPanel. Also extracted syncEngine.ts and constants.ts. App.tsx reduced from 3,167 → 1,449 LOC. 0 tsc errors throughout. |
| 2026-05-16 | **Phase 1 Verification fixes:** Caught two layout regressions during post-extraction browser testing. (1) Timeline not visible at 100% zoom — fixed by adding `min-h-0` to PreviewStage's `flex-1` root so the Timeline's `h-72` is respected by the flex container. (2) Fullscreen CSS specificity conflict — `relative` (in base className) was overriding `fixed` (in conditional classes) due to Tailwind utility ordering. This was a pre-existing bug in the original code, discovered during verification. Fixed by splitting the className into a ternary so position utilities are mutually exclusive. Both verified at 1280×800 using browser preview. |
| 2026-05-16 | **Phase 1 complete.** Branch `phase-1-foundation` pushed and PR opened for review. |
| 2026-05-16 | **Phase 2 Step 1:** Created `src/services/assetStore.ts` — pure IndexedDB service exposing `putAsset`, `getAsset`, `getAllAssets`, `deleteAsset`, `clearAllAssets`. No React, no `any`. (5ff4edd) |
| 2026-05-16 | **Phase 2 Step 2:** Created `src/services/projectStore.ts` — localStorage serializer with versioned key `kinetix:project:v1`. Strips `url` and `file` from assets before save; loads and returns typed `StoredProject`. (c18ac91) |
| 2026-05-16 | **Phase 2 Step 3:** Created `src/hooks/usePersistProject.ts` — debounced (500ms) save hook that skips the first render and accepts an `enabled` flag to suppress saves during hydration. (b04a37c) |
| 2026-05-16 | **Phase 2 Step 4:** Wired `putAsset` into all asset-add paths (`handleFileUpload`, `handleZipUpload`, stock `onSelect`). Stock assets now fetch to blob first. Wired `deleteAsset` + `URL.revokeObjectURL` into gallery delete. Bail-on-failure pattern: if `putAsset` throws, asset is not added to project state. (8bfbc52) |
| 2026-05-16 | **Phase 2 Step 5:** Wired rehydration mount effect into `App.tsx`. On load: reads localStorage → fetches all IDB blobs → reconstructs `blob:` URLs. Orphaned assets dropped with `console.warn`; referencing segments and `voiceoverId` cleared. `isHydrating` flag gates UI and suppresses premature saves. (ca7447d) |
| 2026-05-16 | **Phase 2 Step 6:** Added "New Project" button in Settings panel Danger Zone. Confirm → revoke all blob URLs → clear localStorage → clear IndexedDB → reset React state to `DEFAULT_PROJECT`. Cancel path is a no-op. (b782072) |
| 2026-05-16 | **Phase 2 complete.** Branch `phase-2-persistence` pushed. `tsc --noEmit` 0 errors, `npm run build` clean. Full smoke test passed: upload → refresh → rehydration → "New Project" → post-reset upload all verified. |
| 2026-05-17 | **Phase 3 commit `6e06f86`:** Install `@ffmpeg/ffmpeg@0.12.15` + `@ffmpeg/util@0.12.2`; create `ffmpegLoader.ts` (lazy-loads + caches FFmpeg instance, warns if not `crossOriginIsolated`); add COOP/COEP headers to Vite dev server and `public/_headers` for Cloudflare Pages. |
| 2026-05-17 | **Phase 3 commit `94cb4af`:** Create `src/services/frameRenderer.ts` — pure canvas pipeline that renders one frame for any segment type (image/video/color) with CSS filters, text overlays, and extra overlays applied via 2D context. |
| 2026-05-17 | **Phase 3 commit `99f8e55`:** Fix video seek race condition (stale `seeked` event) and resolve `rgba()` color warning in `<input type="color">` binding — `shadowColor` set to `rgba(0,0,0,0)` instead of `'transparent'`. |
| 2026-05-17 | **Phase 3 commit `db02b85`:** Resolve residual `rgba()` console warning in live preview playback path — all three default `backgroundColor` values (`DEFAULT_PROJECT`, extra-overlay default, 'cyber' preset) changed from `rgba(0,0,0,0.5)` to `#000000`. |
| 2026-05-17 | **Phase 3 commit `95c799b`:** Create `src/services/segmentEncoder.ts` — renders every frame of a segment to PNG via `frameRenderer`, writes frames to ffmpeg virtual FS, encodes with libx264 (fast preset, crf 23, yuv420p, faststart); returns raw MP4 `Uint8Array`. |
| 2026-05-17 | **Phase 3 commit `40bd5de`:** Add diagnostic logging to seek + encoder paths to diagnose intermittent video seek timeouts observed in checkpoint testing (target/currentTime/readyState/duration printed per seek). |
| 2026-05-17 | **Phase 3 commit `e884fd0`:** Fix two seek edge cases: (1) `ensureMetadata()` waits for `loadedmetadata` before seeking; (2) nudge pattern avoids browser no-op when target === currentTime; (3) duration clamping for stretched segments; (4) timeout raised to 5s. |
| 2026-05-17 | **Phase 3 commit `eb9eae7`:** Add transition blending in `segmentEncoder.ts` — for frames in the last `transitionDuration` seconds, the incoming segment's first frame is rendered to a blend canvas; `applyTransitionBlend()` in `frameRenderer.ts` composites FADE/SLIDE/ZOOM/BLUR families via canvas `globalAlpha` + `drawImage`. |
| 2026-05-17 | **Phase 3 commit `76da1f8`:** Create `src/services/exportPipeline.ts` — orchestrates the full export: encode all segments → concat with ffmpeg concat demuxer → mux voiceover AAC audio → output final MP4 blob. |
| 2026-05-17 | **Phase 3 commit `65a6dd4`:** Create `src/workers/exportWorker.ts` — Comlink-exposed `FfmpegWorkerService` class; define `FfmpegLike` interface so both direct `FFmpeg` and Comlink proxy satisfy the same contract; update `segmentEncoder` + `exportPipeline` to accept `FfmpegLike`. |
| 2026-05-17 | **Phase 3 commit `a1e9425`:** Wire new export pipeline into UI — replace MediaRecorder/canvas-stream `handleExport` with Comlink worker spawn + `exportProject()` call; add real-time stage labels and per-segment progress to export modal; add resolution (1080p/4K) and fps (24/30/60) selectors to SettingsPanel; remove hidden canvas, Web Audio node refs, canvas mirror `useEffect`. |
| 2026-05-17 | **Phase 3 commit `338bb9a`:** Stage orphaned `comlink` entry in `package.json` + `package-lock.json` (was installed to `node_modules` in Step 6 but never committed). |
| 2026-05-17 | **Phase 3 complete.** Branch `phase-3-export` pushed. `tsc --noEmit` 0 errors, `npm run build` clean (537 kB main bundle). E2E export verified: multi-segment + voiceover + FADE transition + main Export button + VLC playback confirmed H.264/AAC. |
| 2026-05-17 | **Phase 4 commit `ce50e1e`:** Close out Phase 3 E2E verification in project-state.md. |
| 2026-05-17 | **Phase 4 commit `a42ed66`:** Add `ErrorBoundary` component (class-based, `getDerivedStateFromError`) wrapping left panel, PreviewStage, and Timeline. Structured export errors via `ExportResult` discriminated union in `exportPipeline.ts` — `exportProject()` now returns `ExportResult`, never throws. `ExportErrorKind`: `ffmpeg_load | encode | concat | mux | asset_missing | unknown`. |
| 2026-05-17 | **Phase 4 commit `a27efe5`:** Revert dev-only `ffmpeg_load` throw; correct `CLAUDE.md` export pipeline diagram (ffmpegLoader.ts is dev-only, not in the worker chain). |
| 2026-05-17 | **Phase 4 commit `c7515e5`:** Clean up dangling asset references at delete time — segments with the deleted `assetId` are immediately unlinked; `voiceoverId` cleared if it matched. Previously relied on hydration-time cleanup only. |
| 2026-05-17 | **Phase 4 commit `ab8d4d9`:** Extract `useExport` hook — lazy worker lifecycle, snapshot semantics for retry, `ExportSnapshot` frozen at `startExport` time. |
| 2026-05-17 | **Phase 4 commit `e7e0bbc`:** Extract `getExportErrorSummary` function above `App` component; re-export `ExportError` from `useExport.ts` so App.tsx doesn't import `exportPipeline` directly. |
| 2026-05-17 | **Phase 4 commit `f9704ee`:** Code-split `StockSearchModal` and `SyncReviewModal` via `React.lazy` + `Suspense`; worker chunk properly isolated. |
| 2026-05-17 | **Phase 4 commit `3e1fd2c`:** Lazy-load jszip on ZIP upload — dynamic `import('jszip')` inside `handleZipUpload`; jszip (96 kB) removed from main bundle. Main: 542 kB → 433 kB. |
| 2026-05-17 | **Phase 4 commit `cdb2296`:** Prune phantom filter/transition/animation options from UI — `FILTERS` 57→27, `TEXT_ANIMATIONS` 49→27; add `TRANSITION_OPTIONS` (10 implemented) and `ANIMATION_OPTIONS` (11 implemented); dev-only `console.assert` guards added to `constants.ts`. |
| 2026-05-17 | **Phase 4 commit `3a370e6`:** Clarify dev guard exclusion comments in `constants.ts` (Step 6 fixup). |
| 2026-05-17 | **Phase 4 commit `97821cd`:** Add Safari validation test procedure (`docs/phase-4-safari-test.md`) [file deleted 2026-07-07 — described the ffmpeg.wasm/Safari browser export path, dead since Phase 6.4]. Safari E2E result: **PASS** — `crossOriginIsolated=true`, `SharedArrayBuffer` available, COOP/COEP headers correct, export completes, MP4 plays in VLC with H.264/AAC. |
| 2026-05-17 | **Phase 4 commit `ea18635`:** Fix fade transition global fallback — `segmentEncoder.ts` now uses `project.globalTransition` when a segment's own `transition` field is NONE. Previously, users who set the global transition without clicking "Override all per-segment transitions" got hard cuts. |
| 2026-05-21 | **Fidelity Polish commit `c6fcc64`:** Remove stale Known Bugs entries from CLAUDE.md — verified all three (togglePlay churn, dead audio-sync branch, storyMap param) were already fixed in Phase 1; replaced with strikethrough resolution notes. |
| 2026-05-21 | **Fidelity Polish commit `b3f09b9`:** Gate trimStart UI on video segments only — `asset.type === 'video'` guard prevents showing a seek-point control for image/color segments that have no media timeline. |
| 2026-05-21 | **Fidelity Polish commit `0f4016c`:** Add trimEnd UI control — slider (video-only, same guard) with "end of media" default display and × reset button that clears `trimEnd` back to `undefined`. Clamped `trimEnd > trimStart`. |
| 2026-05-21 | **Fidelity Polish commit `e7a5134`:** Wire trimEnd through renderer and preview — `frameRenderer.ts` clamps `videoTime = Math.min(rawTime, segment.trimEnd)` before seek; `PreviewStage.tsx` respects the same clamp for live preview. Encoder path is unchanged (flows through frameRenderer). |
| 2026-05-21 | **Fidelity Polish commit `ee5ea67`:** Scaffold `canvasAnimations.ts` — easing primitives (`easeLinear`, `easeOutQuad`, `easeInOutSine`, `springApprox`, `oscillate`, `interpKeyframes`); `AnimationFrameInput`/`AnimationFrameResult` interfaces; `applySegmentAnimation()` with cases for all 12 AnimationType values; dev-only assert guard via lazy import of ANIMATION_OPTIONS. |
| 2026-05-21 | **Fidelity Polish commit `33d5840`:** Add `AnimationType.KEN_BURNS` to `ANIMATION_OPTIONS` in `constants.ts` — it was the default for new segments but missing from the picker, making it unselectable once changed away. |
| 2026-05-21 | **Fidelity Polish commit `7dfd934`:** Wire `segment.animation` into live preview — `PreviewStage.tsx` wraps media in a `motion.div` driven by `getAnimationWrapperProps(animation, segmentDuration)`. Removed hardcoded Ken Burns scale from `motion.img`. |
| 2026-05-21 | **Fidelity Polish commit `cf2e3aa`:** Pointer-driven drag for extra overlays — `PreviewStage.tsx` adds `onPointerDown/Move/Up` handlers on draggable overlay divs; hard-clamp to `[halfW/2, 100-halfW/2]` in both axes; `updateExtraOverlayPosition(segmentId, overlayId, x, y)` callback added to App.tsx with `useCallback` + immutable `setProject` update. |
| 2026-05-21 | **Fidelity Polish commit `94f8a37`:** Add `useTransitionPreview` hook — pre-roll snapshot approach; renders outgoing+incoming frames to offscreen 960×540 canvases ~400ms before transition window; `pendingKeyRef` prevents concurrent renders; keyed by `"${outId}:${inId}"` for stale-snapshot safety. |
| 2026-05-21 | **Fidelity Polish commit `0c49339`:** Render preview transitions via canvas overlay — `PreviewStage.tsx` adds a `<canvas>` overlay at z-index 45 driven by `useTransitionPreview`; calls `applyTransitionBlend` each animation frame during the transition window; opacity fade in/out at window edges. |
| 2026-05-21 | **Fidelity Polish commit `ea5ba65`:** Cleanup pass on `useTransitionPreview` — sort `nextSeg` by `startTime` for robust lookup on unsorted segment arrays; add `mountedRef` guard so async `renderSegmentFrame` never calls `setSnapshots` after hook unmounts. |
| 2026-05-21 | **Fidelity Polish commit `136b1ac`:** Update CLAUDE.md — add `canvasAnimations.ts` and `useTransitionPreview.ts` to File Map; resolve Known Bugs (trimEnd) and Known Limitations (AnimationType canvas, overlay drag); add 9 rows to Current Refactor Status; create `docs/fidelity-polish-smoke-tests.md` with 14 test procedures [moved to docs/archived/fidelity-polish-smoke-tests.md, 2026-07-07]. |
| 2026-05-21 | **Pre-merge cleanup commit `0465996`:** Document NEON_FLICKER glow-pass decision — Path A (full glow: `ctx.shadowBlur` + `ctx.shadowColor`) currently ships; comment added above case in `canvasAnimations.ts` so the choice is recoverable. |
| 2026-05-21 | **Pre-merge cleanup commit `533315e`:** Cross-reference comments linking preview and export animation paths — reciprocal comments added above `getAnimationWrapperProps` in `PreviewStage.tsx` and above `applySegmentAnimation` in `canvasAnimations.ts`. |
| 2026-05-25 | **Path B implementation — true cross-fade in export.** `segmentEncoder.ts` accepts `startTimeOffset` + `trailingExtension`; outgoing extends past boundary, incoming skips head, advancing `timeInSegment` on both sides during the fade. `exportPipeline.ts` computes both offsets per segment via `effectiveTransitionOut` helper. Bundle: +9.77 kB / +3.03 kB gzip. Commit `261936f`. |
| 2026-05-26 | **Phase 6.1–6.3 — Tauri scaffold, Rust IPC bridge, export wired.** `tauri init`, `src-tauri/src/ffmpeg.rs` (7 commands), `TauriFfmpeg` class, `ffmpegBackend.ts`, `rfd::AsyncFileDialog` save dialog. E2E export verified in Tauri dev window (~8 min for 4-segment project). |
| 2026-05-26 | **Phase 6.3.1 — Base64 IPC speedup (ba87174).** `bytesToBase64` helper (32 KB chunks; avoids stack overflow); `ffmpeg_write_file` and `save_bytes_to_disk` both use base64. Export time 551s → 120s (4.6× speedup). |
| 2026-05-26 | **Phase 6.4 — wasm path removed (55ba298).** Deleted `@ffmpeg/ffmpeg`, `@ffmpeg/util`, `@ffmpeg/core`, `comlink`; deleted `exportWorker.ts`, `ffmpegLoader.ts`, dev test buttons (handleRenderTestFrame, handleEncodeTestSegment). COOP/COEP headers removed from `vite.config.ts` and `public/_headers`. |
| 2026-05-27 | **Phase 6.5 — ffmpeg sidecar bundled (c567d5e).** Replaced Homebrew-linked binary (385 kB, dynamic) with evermeet.cx 8.1.1 static build (76 MB, system-libs-only). `tauri.conf.json` `externalBin: ["binaries/ffmpeg"]`; `capabilities/default.json` `shell:allow-execute { name: "ffmpeg", sidecar: true }`. Portability verified: renamed `/usr/local/bin/ffmpeg` symlink; app exported successfully from installed .dmg; symlink restored. |
| 2026-05-27 | **Phase 6.6 — Close-out.** CLAUDE.md Export Pipeline section rewritten (native Tauri diagram). project-state.md fully updated. Build verified (`tsc --noEmit`, `npm run build`, `cargo build` all clean on main). `phase-6-tauri` merged to main via `--no-ff`. Branch deleted. |
| 2026-05-27 | **Phase 6.7 — Windows CI.** GitHub Actions matrix build added: `windows-latest` runner, ffmpeg provisioned from gyan.dev essentials build. Produced NSIS `.exe` (~28 MB) and MSI (~39 MB) artifacts. Brother's smoke-test: all UI flows functional; export performance noted as slow (logged to Deferred List). Concurrency guard added. Commits: 64fc98b, d86228e, 4d4cce7. |
| 2026-06-01 | **chore: GitHub Actions Node 24 bump.** Bumped `actions/checkout` v4→v5, `actions/setup-node` v4→v6, `actions/upload-artifact` v4→v6. CI verified on `chore/actions-node24-bump` — zero deprecation warnings in logs. Merge commit 25a3475. Resolves June 2026 deadline item from Deferred List. |
| 2026-05-31 | **Phase 6.8 — arm64 macOS CI.** Switched CI macOS job from `macos-13` (Intel runner, hit 24h queue timeout on first run) to `macos-latest` (arm64 runner — first build completed in 3m 25s). Static arm64 ffmpeg from osxexperts.net 7.1.1 (48 MB, system-libs-only, verified via `otool -L`). Intel macOS binary (`ffmpeg-x86_64-apple-darwin`) retained in repo for local fallback. Merged `phase-6.8-macos-arm64` → `phase-6-windows` → `main`. Merge commit c7982e1. |
| 2026-06-02 | **Phase 7 Batch A — `90bfa71`.** Playback interval no longer tears down on segment edits (finding 13). `project.segments` and `currentSegment` removed from interval dep array; both read via `segmentsRef` / `currentSegmentRef` refs updated in a no-dep sync effect. Drag-resize during playback no longer freezes the playhead. |
| 2026-06-02 | **Phase 7 Batch B commit 1 — `f7e48ba`.** Heading-pause semantics removed; ratio-correction `useEffect` deleted (findings 3, 6, 7, 12, 22, 27). `HEADING_ONLY_DURATION_SECONDS = 1.5` added to `constants.ts`; heading-only scenes get fixed 1.5s slice, text-bearing scenes split remaining audio budget by char-count weight. `currentSegmentRef` removed (was only needed for the deleted `inHeading` check). Audio plays continuously through headings, matching export pipeline behaviour. |
| 2026-06-02 | **Phase 7 Batch B commit 2 — `6395862`.** Drag handler attaches `window` listeners on `mousedown` (audit Q1). Replaces the conditional `fixed inset-0` overlay div with `window.addEventListener('mousemove'/'mouseup')` calls that fire immediately on resize-handle `mousedown`. `onResizeMove` and `onResizeEnd` removed from Timeline props interface. `body.resizing` CSS class added for viewport-wide col-resize cursor coverage during drag. |
| 2026-06-02 | **Phase 7 Batch B commit 3 — `7a4e737`.** Segment width updates instantly during drag (audit Q6). `transition-all duration-300` on segment div replaced with `transition-[opacity,filter,transform,box-shadow,border-color,background-color] duration-300` — excludes `width` so drag updates are synchronous; intentional aesthetic animations (trim-mode fade, active-segment highlight) preserved. |
| 2026-06-02 | **Phase 7 Batch C commit 1 — `e961110`.** `setInterval` playback replaced with rAF + audio master clock (findings 9, 10). Four focused effects: pause `[isPlaying, exportState.isExporting]`; rAF loop `[isPlaying, voiceover]` reading `audio.currentTime` every frame (~16ms); no-voiceover `setInterval` `[isPlaying, voiceover, globalPlaybackSpeed]` (unchanged); playbackRate sync `[isPlaying, globalPlaybackSpeed]`. `onTimeUpdate` handler removed — rAF loop is sole writer of `setCurrentTime`. `audio.ended` used for end-of-audio detection; defensive `.play()` guard carried into tick with `!audio.ended` guard. |
| 2026-06-02 | **Phase 7 Batch C commit 2 — `e8869d9`.** Block stray click on resize handles from seeking segment (Batch B regression). After Commit 2 removed the overlay div, native browser `click` events could bubble from a resize handle through to the segment div's `onClick` handler, triggering `onSeek(s.startTime)` and jumping playback backwards. Fixed by adding `onClick={e => e.stopPropagation()}` to all four resize handle divs (two visual track, two audio track). |
| 2026-06-04 | **Task 9b-0 commit `4ed6a04`.** Unified drop zone + bottom drawer segment editor. Replaced 4-tab left panel with 2-state DropZonePanel (pre-sync drop zone / post-sync mapping list with lock icons). Added BottomDrawer slide-up segment editor (editor fields copied verbatim from SegmentEditorPanel). Added `VideoSegment.locked` field; `finalizeSync` preserves locked durations by order-index match during re-sync. Extracted `processMediaFile` helper (eliminates as-any synthetic event casts). SyncWizard and sidebar nav hidden via `{false && ...}` (code preserved). Settings accessible via modal overlay gated on `showSettings` state. tsc/lint/build clean; 439.90 kB / 134.58 kB gzip. Branch `task-9b-0-unified-ux` merged to main. |
| 2026-06-09 | **Task 9b-2 — Background Transcription Pipeline + Progress Bar.** WhisperState streaming via Tauri Channel; TranscriptionBar animated progress strip; character-walk RTF parser replacing iterative brace-regex; 4-slot staged-file UX with FILES/SEGMENTS tabs; filenames persisted in project state; × clear buttons fixed; inline error banner for script-slot mis-drop. Branch `task-9b-2-transcription-pipeline` merged to main. |
| 2026-06-09 | **Task 9b-3 — Wire Whisper Timestamps into Segment Timing.** TranscriptToken moved to types.ts (canonical); Project extended with lastTranscribedAssetId + transcriptTokens; Option A skip logic in useWhisper (same audio → instant re-align, no Whisper run); handleApplySyncFromFiles + finalizeSync both call startTranscription; stray call in processMediaFile removed. Branch `task-9b-3-whisper-timestamps` merged to main. |
| 2026-06-09 | **Task 9b-4 — Accurate Whisper Alignment.** --dtw base.en flag for frame-accurate timestamps; alignScenestoTranscript rewritten as sliding-window text matcher; infinite loop fix (maxStart floor-clamped to searchStart); audio format detection from magic bytes (WAV/MP3/M4A/OGG); parseWhisperStdout dead code removed; zero-segment guard prevents timeline wipe on failed parse; projectRef fixes stale closure reads in handleApplySyncFromFiles + finalizeSync. Branch `task-9b-4-whisper-alignment` merged to main. |
| 2026-06-09 | Task 9b complete. 9b-0 through 9b-4 shipped; 9b-5 closed as no-op. Whisper pipeline fully operational: DTW alignment, Option A caching, text-matching aligner, audio format detection, zero-segment guard, stale closure fixes. |
| 2026-06-10 | Bundle 1 complete — Task 3 (video pause sync) + Task 6 (pre-render save dialog, last path memory, post-export toast, Show in Finder). Branch task-bundle-1-bug-fixes merged to main. |
| 2026-06-11 | Priority 1 complete — whisper alignment fixes: token expansion, normalize punctuation, wider search window, dual persistent video elements + preload + seek-after-canplay, silence-aware boundary detection using Whisper token gaps. Branch task-priority-1-video-preview-fix merged to main. |
| 2026-06-11 | Priority 2 — Multi-project dashboard: full-screen swap, confirmed flag, lastOpenedProjectId (sessionStorage), clear-on-dashboard-nav, image-only thumbnails, base64 thumbnail on asset change, ← Projects nav link. All tests passed. |
| 2026-06-12 | Priority 3 — Stock footage APIs: Coverr adapter added (Bearer auth, api.coverr.co); Pexels + Pixabay keys wired via .env.local; stock downloads routed through Rust fetch_url_bytes command to bypass CORS; trimStart/trimEnd/playbackSpeed/assetId preserved across re-sync in both handleApplySyncFromFiles and finalizeSync; CSP updated for production builds. |
| 2026-06-12 | Task 9c — Style preset library: presetService.ts with localStorage CRUD; PresetPicker component; per-category presets (transition, animation, overlayFilter, overlayConfig); 3 built-in overlay presets (Cyber/Retro/Bold); wired into SettingsPanel with save/apply/delete; global across all projects; customOverlayText dead field removed. |
| 2026-06-12 | Task 9a — Independent text layers: textLayers[] added to Project; TextLayersPanel component (collapsible, inline editors, per-segment hide toggle); wired into DropZonePanel segments tab; global layers rendered in PreviewStage at z-45; export pipeline extended (FrameGlobalConfig.globalTextLayers, frameRenderer draws per-frame); collapsible left panel with ChevronLeft/Right toggle strip. |
| 2026-06-12 | Layout redesign — 3-column percentage layout (20/65/15vw), collapsible left+right panels, full-width header removed (nav lives in panels), Effects tab in left panel (all SettingsPanel controls moved inline), Timeline cleanup (sub-toolbar removed, floating pills, fixed dead rows), real Web Audio API waveform, audio track full-width scroll fix, draggable preview/timeline divider clamped to 16:9 ratio, preview height-driven aspect-video. |
| 2026-06-17 | Sync engine hardening — whisperService.ts alignScenesToTranscript() sliding-window matcher + applyHeadingTiming() fixed 1.0s with 50/50 neighbor absorption; silenceDetector.ts Web Audio API silence scan for gap-fill; timeline manual-adjustment isolation with cascade + auto-lock; [HEADING:] scene proper timing + rendering; Whisper segment timing decoupled from description text; tag-primary asset matching. BottomDrawer redesign — reduced from ~38 controls to 8; slip-trim visual bar (fixed-width orange window slides over source clip); click-outside backdrop closes drawer; timeline-click opens drawer; reset-button scrolls timeline to 0. playbackSpeed UI hidden (code preserved). |
| 2026-06-18 | **Bug 3 fix — anchor-based segment timing.** VideoSegment gains anchorStart (audio position) + anchorSource ('whisper' \| 'estimate'). parseProjectData and applyAnchorBasedTiming PASS 2 write 'estimate'; distributeSegmentTimes writes 'whisper'. Both stableKey loops carry anchorSource across re-sync. New applyAnchorBasedTiming in syncEngine.ts recomputes durations from anchors with one-directional locked-segment exemption (locks expand backward over removal gaps but never shrink). New alignScenesToTranscriptAnchorAware in whisperService.ts respects 'whisper' anchors as fixed positions and realigns only 'estimate' segments within gaps. useWhisper.ts skip-guard fires when allWhisperAnchored AND audio unchanged; otherwise Option A routes through anchor-aware aligner when any 'whisper' anchor exists, full aligner otherwise. Fixes the bug where removing middle segments redistributed durations proportionally across the audio. Manual tests A (removal-only), B (mid-removal), C (insertion), and F (restore-after-removal) all pass. |
| 2026-06-18 | **Deferred audit — `finalizeSync` redundant second-pass startTime accumulation** — Confirmed replaced by `applyAnchorBasedTiming` during Bug 3 fix; no separate action needed. Removed from deferred list. |
| 2026-06-18 | Manual tests passed for deferred batch (Tasks 1, 2, 3): playback hook regression, stableKey content-hash, audioRef await fix. Commits 85fa111, e89ea59, d5def92. |
| 2026-06-18 | **Deferred audit — Audio waveform `Math.random()` heights** — Confirmed shipped as real Web Audio API amplitude analysis in Layout Redesign (2026-06-12); removed from deferred list. |
| 2026-06-18 | **`usePlayback` hook extraction (85fa111)** — rAF loop, setInterval, audio-pause, and playbackRate sync effects extracted from App.tsx to `src/hooks/usePlayback.ts`. Hook owns `rafRef` and `segmentsRef`. Zero behavior change. |
| 2026-06-18 | **Segment lock order-index matching (e89ea59)** — `getSegmentStableKey()` added to `syncEngine.ts`. Fallback chain: `asset:id` → `heading:text` → `order:N\|text:first40`. Text-only segments now survive adjacent scene insert/remove without stale lock state. |
| 2026-06-18 | **`audioRef.current.duration` sync read in `finalizeSync` (d5def92)** — Replaced bare sync read with two-stage approach: use loaded value if non-zero, else `await getAudioDuration()`; abort with toast if still 0. |
| 2026-06-18 | Heading system Round 1: 5-commit implementation (isHeading + headingConfig data model, migration, parser updates, "+ Add Heading" UI, BottomDrawer editor). Commits: 9415a4a, 456982d, 7a00004, 39b99b0, 991c769 |
| 2026-06-18 | Heading system Round 2: 5 bug fixes (BottomDrawer assetId emit, PreviewStage asset+text decoupling, insertion absorption, sceneDetails persistence, splitAudio mechanics). Commits: dab1787, 9904458, 03604c1, 3e017cd, e603c2f |
| 2026-06-18 | Heading system Round 3: 3 follow-up fixes — applyHeadingTiming in finalizeSync, anchorSource='whisper' on insert, nextSeg.anchorStart shift on insert. Commits: a9df569, e844f53, 55f49c5 |
| 2026-06-18 | Heading system Round 4: heading video background respects isPlaying. Commit: 35d262a |
| 2026-06-19 | Heading system Round 5 (splitAudio removal): ripped out splitAudio entirely. Broke total-duration invariant, produced 4 rounds of drift bugs. Headings now pure overlays with 50/50 absorption only. Commit 26fe2cb |
| 2026-06-19 | Heading system Round 6 (sync corruption root cause): duplicate "New Heading" text caused prevByKey collision, assigning multiple headings the same anchorStart. Fix: handleInsertHeading auto-names "Heading 1", "Heading 2"... SHRINK pass splits excess 50/50 with availability clamping. Commit 17269fb |
| 2026-06-19 | Heading system Round 7 (× delete button): per-segment delete button on heading tiles (Timeline + DropZonePanel). Reverses insertion atomically: returns duration to neighbors, removes [HEADING:] tag from sceneDetails. Commit 7a348f8 |
| 2026-06-19 | Heading system Round 8 (delete anchor math fix): handleDeleteHeading was subtracting headingDur from next.anchorStart, reproducing the heading's own anchor instead of next's pre-insertion anchor. Fixed to derive next.anchorStart from prev.anchorStart + prev.duration. Apply Sync now recovers cleanly after delete. Diagnostic [DEL-DIAG] logs removed. Commit d224ba6 |
| 2026-06-19 | Heading system Round 9 (UI polish): heading delete button repositioned to left of row (next to lock icon), × replaced with Trash2 icon, hover-only opacity. Same Trash2 in Timeline heading tile. Also fixed pre-existing bug where heading rows/tiles showed yellow/red "missing asset" warning icon instead of an orange Heading1 indicator (isMissing check now evaluated AFTER isHeading check). Commit 70e2285 |
| 2026-06-20 | Phase 7 — Option C (Apply Sync gated on transcription) shipped. Auto-transcribe on voiceover stage; Apply Sync disabled until cached tokens are ready. Single click produces correct alignment on first try. Approach B (ephemeral pre-commit asset). Commit `e56be04`. |
| 2026-06-20 | Phase 7 — Sync regression fix (`d445d09`). Option C accidentally dropped `applyAnchorBasedTiming` from the cached-token path, leaving anchors un-normalized. Restored the call. Regression found by bisecting against known-good baselines `bb14d31` and `26fe2cb`. |
| 2026-06-20 | Phase 7 — Single-click correct alignment (`1eb7738`). `applyAnchorBasedTiming` now runs inside `alignSegmentsFromCachedTranscript` between `distributeSegmentTimes` and `applyHeadingTiming`. Click 1 and click 2 now produce identical output — single click is correct, second click is a no-op. Removed obsolete `clampFirstSegmentAnchor` helper (subsumed by `applyAnchorBasedTiming`). |
| 2026-06-22 | Phase 7 — Per-Slot Re-Sync series COMPLETE. All 6 plan changes shipped (commits 81e6841, 258def1, 36f9b06). Plus two hardening fixes the plan's edge cases required: transcription ownership race (4270add) and re-stage sync drift (cb3a5e8, debug-logging cleanup bab79b0). Verified on live A→B→C→re-stage→swap-back repro — no fallback warning, all segments anchorSource=whisper. 8 vitest regression tests green. Restore tag sync-known-good-2026-06-20 intact. |

---

## Phase Summaries

### Previous Sprint (Phase 3 steps)

| Step | Description | Status |
|---|---|---|
| Step 1 | Install ffmpeg.wasm, configure COOP/COEP headers (`ffmpegLoader.ts`) | ✅ Done |
| Step 2 | Frame renderer — pure canvas pipeline for image/video/overlay (`frameRenderer.ts`) | ✅ Done |
| Step 3 | Segment encoder — render frames → ffmpeg → MP4 (`segmentEncoder.ts`) | ✅ Done |
| Step 4 | Transition blending — crossfade/slide/zoom at segment boundaries | ✅ Done |
| Step 5 | Export pipeline — concat demuxer + audio mux (`exportPipeline.ts`) | ✅ Done |
| Step 6 | Comlink Web Worker wrapper — ffmpeg runs off main thread (`exportWorker.ts`) | ✅ Done |
| Step 7 | Wire pipeline into UI — remove MediaRecorder, add progress modal + quality settings | ✅ Done |
| Step 8 | Docs + PR | ✅ Done |

### Phase 4 Summary

| Step | Description | Commits |
|---|---|---|
| Step 1 | Skipped — Phase 3 E2E already verified before merge | — |
| Step 2 | Error boundaries + structured export errors | a42ed66, a27efe5 |
| Step 3 | Dangling asset reference cleanup at delete time | c7515e5 |
| Step 4 | Extract `useExport` hook + `getExportErrorSummary` | ab8d4d9, e7e0bbc |
| Step 5 (5+5.1) | Code-split lazy modals; lazy-load jszip | f9704ee, 3e1fd2c |
| Step 6 (7) | Enum prune — phantom filters/transitions/animations removed from UI | cdb2296, 3a370e6 |
| Step 7 (8) | Safari validation handoff doc + test run | 97821cd — **PASS** |
| Step 9 | ffmpeg console noise — handler already at `exportWorker.ts:35`; no commit needed | — |
| Step 10 | Fade transition global fallback in segment encoder | ea18635 |

**Bundle size:** 542 kB → 433 kB main (−109 kB / −28 kB gzip) via lazy-loading jszip, StockSearchModal, SyncReviewModal.

#### Smoke Test Results

> **Historical note:** Validated at end of Phase 4. The wasm/browser path was removed in Phase 6.4; rows referencing `crossOriginIsolated`, Safari, and COOP/COEP are preserved for history only and no longer reflect the shipping product.

| Test | Result | Notes |
|---|---|---|
| Test 1 — `crossOriginIsolated` | ✅ PASS | `true` in both Chrome and Safari; `SharedArrayBuffer` available; COOP/COEP headers correct |
| Test 2 — Console hygiene | ✅ PASS | ffmpeg stderr routed to `console.debug`; no spurious `console.error` from pipeline |
| Test 3 — Lazy modal loading | ✅ PASS | `StockSearchModal-*.js` loaded on demand; no lazy chunks in initial network request |
| Test 4 — Dangling asset cleanup | ✅ PASS | `c7515e5` clears `assetId` correctly; `autoMatchAssets` re-assignment regression **fixed Phase 5 step 1** — `autoMatchSegments` now imperative-only |
| Test 5 — `asset_missing` error path | ⚠️ NOT REACHED via reload | Hydration cleanup clears orphaned `assetId`s before export; `ExportError` infrastructure verified by code review; deeper trigger deferred |
| Test 6 — Fade transition | ✅ PASS | Verified during Path B export work (commit 261936f); 6-A through 6-D all verified |
| Safari validation | ✅ PASS | `crossOriginIsolated=true`, full export, MP4 plays in VLC with H.264/AAC |

#### Mux "Failed to fetch" investigation (Phase 5 Step 4, resolved)

> Originally tracked under "Known Cosmetic Issues" in project-state.md; moved here on 2026-06-22 since it's a closed investigation with no outstanding action, not a current issue.

The one observed failure (Phase 4 smoke test, heavily-mutated state) was traced to `exportPipeline.ts:198` — `fetchFile(voiceoverAsset.url)` where the blob URL had already been revoked. The pre-c7515e5 delete handler called `URL.revokeObjectURL(asset.url)` synchronously but did NOT clear `voiceoverId`, leaving the export pipeline holding a revoked URL. c7515e5 (Phase 4 Step 3) fixed the root cause by clearing `voiceoverId` on delete — the mux step now routes to the no-audio branch when `voiceoverId` is absent. Not reproducible with current code. No further action needed.

### Phase 5 Summary

| Step | Description | Commits |
|---|---|---|
| Step 1+2 | Fix autoMatchAssets delete regression; confirm asset_missing reachability | 75be8dd |
| Step 3 | Real mid-export cancellation — worker.terminate() + generation counter | (multiple) |
| Step 4 | Mux failure investigation (30-min timebox) — no repro; root cause pre-existing c7515e5 fix | — |
| Step 5 | JSZip type cleanup — destructure { default: JSZip }; @types/jszip removed | (commit) |
| Step 6 | Relabel Apply Transition button; add title tooltip | (commit) |
| Step 7 | Stock API 429 handling — fetchWithRetry exp backoff; discriminated union StockSearchResult | (commit) |
| Step 8a | ARIA labels on icon-only buttons throughout app | (commit) |
| Step 8b+8c | Global focus rings (CSS :focus-visible); aria-live on export stage label | (commit) |
| Step 8c | Timeline scrubber — role="slider", full ARIA attributes, arrow-key navigation | (commit) |
| Step 8d | useFocusTrap hook — Tab/Shift+Tab cycle in all 4 modals, focus restore on close | e49c28d |

**Bundle size:** 435 kB / 133 kB gzip (negligible change vs Phase 4 433 kB / 132 kB — no new heavy deps added).

### Fidelity Polish Summary

| Step | Description | Commits |
|---|---|---|
| Item 1 — trimEnd UI + renderer | trimStart/trimEnd UI gated on video assets; frameRenderer + PreviewStage respect trimEnd; encoder unchanged | b3f09b9, 0f4016c, e7a5134 |
| Item 4 — Canvas animations | canvasAnimations.ts with 12 AnimationTypes (incl. KEN_BURNS); frameRenderer integration; PreviewStage live preview via motion.div wrappers | ee5ea67, 33d5840, 7dfd934 |
| Item 2 — Overlay drag | Pointer events drag on extra overlays in PreviewStage; hard-clamp to [halfW/2, 100-halfW/2]; updateExtraOverlayPosition callback in App.tsx | cf2e3aa |
| Item 3 — Preview transitions | useTransitionPreview hook pre-rolls outgoing+incoming snapshots; canvas overlay blends via applyTransitionBlend; mounted-ref guard for unmount safety | 94f8a37, 0c49339, ea5ba65 |
| Item 5 — Stale Known Bugs cleanup | Verified bugs already fixed in Phase 1; removed stale entries from CLAUDE.md | (CLAUDE.md only) |
| Docs | CLAUDE.md status + Known Limitations updates; new docs/fidelity-polish-smoke-tests.md (14 procedures) [moved to docs/archived/fidelity-polish-smoke-tests.md, 2026-07-07] | c6fcc64, 136b1ac |
| Pre-merge cleanup | NEON_FLICKER decision comment; preview ↔ export cross-reference comments; project-state.md updates | 0465996, 533315e, (this commit) |

**Bundle size:** 442.18 kB / 134.73 kB gzip (measured post-Phase 6.4 wasm removal) — delta vs Phase 5 baseline (435.88 / 133.19): +6.3 kB / +1.5 kB. Within the ≤+20 kB / +5 kB budget.

**Items delivered vs kickoff:**
- trimEnd field wired through UI + export ✓
- All 12 AnimationType values render in export ✓ (was 0 before — phase audit caught the no-op gap)
- KEN_BURNS added to ANIMATION_OPTIONS (was a phantom default) ✓
- Drag-to-position UI for extra overlays ✓
- **Preview transitions** (canvas blend): partial, ships with documented ~100-200ms black flash on video boundaries (see Deferred).
- **Export transitions:** Path A landed (commit 4b75737) — fixes double-emission, animation snap-back, and trimStart leak by holding incoming segment at its first frame during fade. Audio sync preserved. ACCEPTANCE PENDING — user reviewed and rejected the static-frame aesthetic. Path B (true cross-fade with advancing incoming video, Premiere/CapCut style) is the immediate next work.
- Stale bugs purged from CLAUDE.md ✓

### Path B (Export Cross-Fade) — Complete

Path B landed in commit `261936f`. All four Test 6 gates verified manually:

- 6-A: no doubled content
- 6-B: no animation snap-back
- 6-C: audio sync preserved
- 6-D: true cross-fade aesthetic confirmed

**Key insight:** In/out transition overlaps cancel pairwise across the timeline, so `Σ encoded = Σ duration = voiceoverDuration` is preserved without any `App.tsx` changes. Only `segmentEncoder.ts` and `exportPipeline.ts` were modified. The pre-audit predicted App.tsx would need updating at four `startTime` accumulator sites — this was not required because the algebraic invariant held by construction.

### Phase 6 Summary

| Sub-phase | Description | Commits |
|---|---|---|
| 6.1 — Tauri scaffold | `tauri init`, `tauri.conf.json`, `npm run tauri:dev` smoke test | — |
| 6.2 — Rust IPC bridge | `ffmpeg.rs` (7 commands); `TauriFfmpeg` class; `bytesToBase64`; IPC smoke test 10/10 | — |
| 6.3 — Wire Tauri into export | `isTauri()` branch in `useExport`; `ffmpegBackend.ts`; `rfd` save dialog; E2E verified (~8 min) | 3b61ec3 |
| 6.3.1 — Base64 IPC | 32 KB-chunked `bytesToBase64`; b64 write_file + save_bytes_to_disk; 551s → 120s (4.6× speedup) | ba87174 |
| 6.4 — Remove wasm path | Delete `@ffmpeg/*`, `comlink`, `exportWorker.ts`, `ffmpegLoader.ts`, dev test buttons; COOP/COEP headers removed | 55ba298 |
| 6.5 — Bundle sidecar | evermeet.cx 8.1.1 static build (76 MB, system-libs-only); `externalBin: ["binaries/ffmpeg"]`; portability verified | c567d5e |
| 6.7 — Windows CI | GitHub Actions matrix build; `windows-latest` runner; ffmpeg from gyan.dev; NSIS .exe (~28 MB) + MSI (~39 MB); brother's smoke-test passed (functionality OK; export performance issue logged to Deferred List) | 64fc98b, d86228e, 4d4cce7 |
| 6.8 — arm64 macOS CI | Switched `macos-13` (Intel, 24h queue timeout) → `macos-latest` (arm64 runner, 3m 25s build); static arm64 ffmpeg from osxexperts.net 7.1.1 (48 MB, system-libs-only); Intel binary retained in repo | fe0734a |

**Key decisions:**
- **Tauri v2** + `tauri-plugin-shell` for sidecar spawning. `sidecar("ffmpeg")` resolves to `{exe_dir}/ffmpeg` — bare name (no path prefix, no triple) — because `tauri-build` strips both when copying from `src-tauri/binaries/ffmpeg-x86_64-apple-darwin`.
- **Static evermeet.cx build** — zero Homebrew dylib deps (only `/System/Library/` + `/usr/lib/` via `otool -L`). Committed to `.gitignore`; `binaries/README.md` documents re-provisioning.
- **Base64 IPC** — per-frame PNG writes base64-encoded; Rust `STANDARD.decode()` on arrival. Eliminated JSON-array-of-numbers bottleneck.
- **Session-scoped temp dirs** — `$TMPDIR/kinetix-export-<uuid>/` per export; destroyed via `ffmpeg_destroy_session` after each run.
- **Native save dialog** — `rfd::AsyncFileDialog` (dispatch to main thread internally on macOS/AppKit); no download-link workaround needed.
- **SaaS readiness deferred** — GPL-licensed sidecar (libx264) acceptable for internal distribution. Before public launch: swap for LGPL-only build (OpenH264 or commercial x264 license); add auth layer; proxy API keys. Tracked in CLAUDE.md Known Limitations.

**Performance (post Phase 6.3.1):** macOS Intel: ~10× realtime (120s for 12s of 1080p/30fps). Windows: ~6× realtime (6 min per 1 min of video). macOS arm64: pending measurement.

---

## Per-Task Deep Dives

### Task 9b-2 — Background Transcription Pipeline + Progress Bar
Status: COMPLETE — merged to main

#### What was built
- Rust: WhisperState<Mutex<Option<CommandChild>>>; streaming via Channel<WhisperEvent>;
  cancellation via whisper_cancel command; silent exit codes 130/143
- TypeScript: transcribeWithProgress(); AbortController cancellation pattern (same as useExport)
- TranscriptionBar: animated indigo progress strip; green done flash (3s); red error banner
- App.tsx: startTranscription() triggered on audio upload when isTauri()

#### Upload/Sync flow (also stabilised in this task)
- 4 explicit file slots: Script, Scene Details, Voiceover, Images & Videos
- FILES / SEGMENTS two-tab layout in left panel
- RTF stripping: character-walk parser (brace-depth tracking); bracket tag placeholder protection;
  preamble trimmed before first [IMAGE:] tag
- Content detection: ≥3 bracket tags → Scene Details; Script slot actively rejects scene files
  with inline error banner (4s auto-dismiss)
- Filenames persisted in project state (scriptFileName, sceneDetailsFileName) — survive reload
- × buttons work for both staged and persisted data on all 4 slots
- Asset dedup: no duplicates on re-upload; audio replace: max 1 voiceover at all times
- Persistence (usePersistProject): isSynced restored on hydration when segments.length > 0

#### Key files changed
- src-tauri/src/whisper.rs
- src-tauri/src/lib.rs
- src/types.ts
- src/services/whisperService.ts
- src/services/textUtils.ts
- src/hooks/useWhisper.ts
- src/components/TranscriptionBar.tsx
- src/components/DropZonePanel.tsx
- src/App.tsx

### Task 9b-3 — Wire Whisper Timestamps into Segment Timing
Status: COMPLETE — merged to main

#### What was built
- TranscriptToken interface moved to types.ts as canonical definition;
  re-exported from whisperService.ts for backward compatibility
- Project interface extended: lastTranscribedAssetId, transcriptTokens
- Option A skip logic in useWhisper.ts: if voiceoverId matches
  lastTranscribedAssetId and cached tokens exist, skip Whisper entirely
  and run alignment directly — no progress bar, near instant
- Fresh Whisper run stores tokens + asset ID back into project state
  via onProjectUpdated callback
- handleApplySyncFromFiles and finalizeSync both use startTranscription;
  stray call in processMediaFile removed to prevent double-triggering
- distributeSegmentTimes confirmed to skip locked segments

#### Verified behaviors
- Re-sync with same audio: no transcription bar, cached tokens reused
- New audio: full Whisper run triggers correctly
- Locked segments: timing preserved across re-sync
- Scene edits with same audio: instant re-sync, correct timing

### Task 9b-4 — Accurate Whisper Alignment
Status: COMPLETE — merged to main

#### What was built
- --dtw base.en flag added to Whisper CLI args for frame-accurate
  per-token timestamps via Dynamic Time Warping
- alignScenestoTranscript rewritten: sliding-window text matcher
  with monotonic searchStart, gap-fill pass, last segment clamped
  to audio end; replaces token-count distribution
- Infinite loop fix: maxStart floor-clamped to searchStart;
  loop condition changed from wi <= Math.max(wi, maxStart) to
  wi <= maxStart
- Audio format detection from magic bytes: WAV/MP3/M4A/OGG
  auto-detected; correct extension written so whisper-cli
  format detection works; no more false WAV rejections
- parseWhisperStdout dead code removed
- Zero-segment guard: if parseProjectData returns 0 segments
  and existing segments exist, sync aborts — existing timeline
  never wiped by a failed parse
- projectRef added: all post-await reads in handleApplySyncFromFiles
  and finalizeSync use projectRef.current to avoid stale closure bugs
- Option A skip logic confirmed working: re-sync with same audio
  uses cached tokens, no Whisper re-run

#### Verified behaviors
- Timestamps are speech-accurate (DTW), not character-count based
- Timeline is contiguous with no gaps between segments
- Locked segments preserve timing across re-sync
- Re-syncing images only does not wipe segments
- Assets cleared + reload: segments persist, re-attaching works
- Slot UX: immediate green ✓ after sync; single × click clears both
  staged and persisted; no two-step clear behavior

### Task 9b-5
Status: NO-OP — all originally planned items already delivered

- Apply Sync commits whisper timings: ✅ delivered in 9b-2/9b-3
- Hide SyncWizard: ✅ delivered in 9b-0 ({false && ...} preserved)
- Bracket-only scene format: deferred — old format still accepted and
  works correctly; no change needed since Whisper handles timing
  independently of description text

### Bundle 1 — Bug Fixes (Task 3 + Task 6)
Status: COMPLETE — merged to main

#### Task 3 — Video plays when timeline paused
- isPlaying prop added to PreviewStage
- useEffect syncs video element play/pause to isPlaying
- autoPlay removed — playback fully explicit
- videoRef callback syncs on segment change

#### Task 6 — Post-export save dialog + popup
- Save dialog now appears BEFORE rendering starts
- Cancel before render wastes nothing — no render triggered
- pick_save_path Rust command opens rfd dialog, returns path only
- save_bytes_to_disk now takes explicit path, no dialog
- lastExportPath persisted in Project state — dialog remembers last folder
- Bottom-right success toast: filename, Show in Finder, Dismiss, 10s auto-dismiss
- reveal_in_finder command: open -R on macOS, explorer /select on Windows

### Priority 1 — Whisper Alignment + Video Preview Fix
Status: COMPLETE — merged to main

#### Alignment fixes
- Token expansion: each Whisper token expanded into all its words (was taking only first word)
- normalize() punctuation → space instead of strip
- Search window multiplier 3→5
- Proportional DTW offset (later replaced)
- Silence-aware boundary detection: reads actual token gaps from Whisper output, splits silence 50/50 at each segment boundary — replaces all previous offset/gap-fill heuristics

#### Video preview fixes
- Dual persistent video elements (slot A + slot B) — no more mount/unmount per segment
- preload="auto" on both slots
- seekToTime() helper waits for canPlay before seeking
- currentTimeRef fixes callback ref churn (was recreating every 100ms)
- key={currentSegment.id} removed from motion.div wrapper

### Priority 2 — Multi-Project Dashboard
Status: COMPLETE — merged to main

#### What was built

**Persistence layer (Task 2):**
- Project registry: kinetix:projects:v1 in localStorage holding ProjectMeta[]
- Per-project storage: kinetix:project:{id}:v1 key per project
- IndexedDB assets store upgraded to v2 with projectId scoping and compound keyPath ['projectId', 'id']
- migrateLegacyIfNeeded() copies v1 IDB assets and v1 localStorage project to new scoped keys on first launch

**Multi-project picker (Task 5):**
- Full-screen dashboard (not overlay): renders as top-level return swap, editor fully unmounted when dashboard is active
- Grid layout: project cards with thumbnail, name, scene count, last saved date
- Three-dot menu per card: rename, delete with confirmation dialog
- Search bar: real-time filter by project name
- + New Project button: top-right, opens NewProjectModal for name entry before project is created
- Current project card: green "Current" badge
- ← Projects button: top-left in editor, saves if confirmed then navigates to dashboard

**Session and launch behaviour:**
- sessionStorage lastOpenedProjectId: reload (Cmd+R) reopens last active project; full app close + reopen shows dashboard
- clearLastOpenedProjectId() called on all three user-initiated dashboard navigation sites; hydration fallback intentionally excluded
- confirmed flag on Project: gates usePersistProject debounce and saveNow; prevents unconfirmed makeDefaultProject() from auto-saving as "Untitled Project"
- handleNewProjectConfirm: sets confirmed = true and calls saveProject immediately before setProject
- handleSwitchProject: pre-switch save only if project.confirmed; loaded project marked confirmed = true

**Thumbnails:**
- buildThumbnailBase64(): draws blob URL onto 320×180 offscreen canvas, exports as JPEG at 0.7 quality (~15–25 KB per project)
- Written to meta immediately via useEffect watching project.assets — not deferred to debounced save
- image-type assets only (no audio/zip blobs as thumbnails)
- Survives app restart because base64 data URL is plain text in localStorage

#### Key files changed
- src/types.ts — ProjectMeta (thumbnailUrl, thumbnailAssetId), Project.confirmed
- src/services/projectStore.ts — registry, per-project keys, lastOpenedProjectId helpers (sessionStorage)
- src/services/assetStore.ts — projectId scoping, v2 IDB upgrade, getLegacyAssets()
- src/hooks/usePersistProject.ts — confirmed gate, buildThumbnailBase64 (exported), persistMeta async helper
- src/components/ProjectDashboard.tsx — full redesign (grid, search, three-dot menu, badges)
- src/components/NewProjectModal.tsx — new file
- src/App.tsx — hydration rewrite, handleSwitchProject, handleNewProjectConfirm, ← Projects button, thumbnail useEffect

#### Verified behaviours
- Dashboard appears on fresh app launch; last project reopens on reload
- No duplicate "Untitled Project" on new project creation
- Thumbnails load correctly on fresh launch (base64, not blob URL)
- Deleting a project removes card and all associated localStorage + IDB data
- Search filters projects in real time
- Confirmed flag prevents blank projects from polluting the registry

### Priority 3 — Stock Footage APIs
Status: COMPLETE — merged to main

#### What was built
- Coverr adapter: Bearer token auth via VITE_COVERR_API_KEY; endpoint api.coverr.co/videos with urls=true; video-only; thumbnail from Coverr CDN
- Pexels and Pixabay keys: wired via VITE_PEXELS_API_KEY and VITE_PIXABAY_API_KEY in .env.local
- searchAllStock: fans out to all three providers via Promise.all; any rate-limit short-circuits; partial failures surface remaining results
- fetch_url_bytes Rust command: downloads external URLs server-side via reqwest to bypass CORS restrictions in Tauri webview; returns base64-encoded bytes; registered in generate_handler!
- Stock download flow: isTauri() branch uses invoke('fetch_url_bytes'); non-Tauri falls back to direct fetch
- stockError state: dismissible red banner with 5s auto-dismiss on download failure
- CSP: tauri.conf.json updated with connect-src + img-src + media-src entries for api.coverr.co, storage.coverr.co, coverr.co (production builds)
- StockSearchModal subtitle updated to "Pexels · Pixabay · Coverr"
- trimStart/trimEnd/playbackSpeed/isMuted/assetId preserved across re-sync in both handleApplySyncFromFiles and finalizeSync

#### Key files changed
- src/services/stockService.ts — Coverr adapter, provider union extended, searchAllStock updated
- src-tauri/src/lib.rs — fetch_url_bytes command
- src-tauri/Cargo.toml — reqwest dependency added
- src-tauri/tauri.conf.json — CSP entries for Coverr domains
- src/App.tsx — fetch_url_bytes invoke, stockError state, trimStart/trimEnd preservation
- src/components/StockSearchModal.tsx — subtitle updated

#### Verified behaviours
- Search returns results from Pexels, Pixabay, and Coverr simultaneously
- Clicking a stock video downloads and assigns to segment correctly
- trimStart/trimEnd survive re-sync — video timing preserved after scene edits
- CORS bypass works for all three providers via Rust fetch
- Stock error banner appears on download failure instead of silent failure

#### Environment variables required
- VITE_PEXELS_API_KEY — free key from pexels.com/api
- VITE_PIXABAY_API_KEY — free key from pixabay.com/api/docs
- VITE_COVERR_API_KEY — free key from coverr.co/developers
- All three go in .env.local (gitignored)

### Task 9c — Style Preset Library
Status: COMPLETE — merged to main

#### What was built
- presetService.ts: localStorage CRUD under kinetix:stylePresets:v1; loadPresets/savePreset/deletePreset/renamePreset; built-in presets are code-defined and never written to storage
- PresetPicker.tsx: reusable chip-based picker component; inline save-with-name (Enter or click Save); trash icon on user presets; built-in badge on non-deletable presets; re-exports OverlayConfigPreset type
- Four preset categories: transition (string), animation (string), overlayFilter (string), overlayConfig (OverlayConfigPreset object)
- Three built-in overlayConfig presets: Cyber (green/black/Bangers/glitch), Retro (magenta/white/Monoton/neon-flicker), Bold (black/orange/Anton/slide-up)
- SettingsPanel: 8 new props wired; PresetPicker inserted after each relevant control section
- Both SettingsPanel renders in App.tsx wired with all 8 props
- Presets are global — shared across all projects via localStorage
- customOverlayText dead field removed from VideoSegment in types.ts

#### Key files changed
- src/services/presetService.ts — new file
- src/components/PresetPicker.tsx — new file
- src/components/SettingsPanel.tsx — 8 new props, 4 PresetPicker insertions
- src/App.tsx — both SettingsPanel renders wired
- src/types.ts — customOverlayText removed

#### Verified behaviours
- Preset pickers visible under all four setting sections
- Save current → named preset → persists after reload
- Apply preset → settings update immediately
- Delete user preset → removed; built-in presets undeletable
- Global: presets survive project switching and app restart

### Task 9a — Independent Text Layers + Collapsible Left Panel
Status: COMPLETE — merged to main

#### What was built
- types.ts: TextOverlay gains hiddenOnSegments?: string[]; Project gains textLayers?: TextOverlay[]
- makeDefaultProject: textLayers: [] initialised
- App.tsx handlers: handleAddTextLayer, handleUpdateTextLayer, handleDeleteTextLayer, handleToggleTextLayerOnSegment — all useCallback, immutable setProject patterns
- TextLayersPanel.tsx (new): collapsible section at top of Segments tab; per-layer inline editors (text, X/Y %, color, bg-color, font size, font family); per-segment hide/show toggle list; expand/collapse toggle
- DropZonePanel.tsx: TextLayersPanel rendered at top of Segments tab; 5 new props threaded through interface
- PreviewStage.tsx: global text layers rendered at z-45, filtered by hiddenOnSegments; textLayers prop wired from App.tsx
- frameRenderer.ts: FrameGlobalConfig.globalTextLayers added; second draw loop after extraOverlays; skips layers where segment id is in hiddenOnSegments
- exportPipeline.ts: passes project.textLayers ?? [] as globalTextLayers into FrameGlobalConfig
- App.tsx (collapsible panel): leftPanelCollapsed state; panel div uses width: 0/380 with transition-[width] duration-300 overflow-hidden; 4px-wide toggle strip with ChevronLeft/ChevronRight between panels

#### Key files changed
- src/types.ts
- src/App.tsx
- src/components/TextLayersPanel.tsx — new file
- src/components/DropZonePanel.tsx
- src/components/PreviewStage.tsx
- src/services/frameRenderer.ts
- src/services/exportPipeline.ts

#### Verified behaviours
- TextLayersPanel collapses/expands cleanly at top of Segments tab
- Add text layer → appears in PreviewStage immediately at global z-level
- Per-segment toggle → layer hidden on that segment only in preview and export
- Collapsible left panel → full-width preview on collapse; panel restores on expand
- tsc --noEmit clean on commit 7efc295

### Layout Redesign
Status: COMPLETE — merged to main

#### What was built
- 3-column percentage layout: left 20vw / center flex-1 / right 15vw; both panels independently collapsible with ChevronLeft/Right toggle strips
- Full-width header removed: ← Projects button lives in left panel header; project name + save status live in right panel header
- Preview: height-driven aspect-video with explicit previewHeight state (px); always fully visible at 16:9; never crops
- Draggable divider between preview and timeline: mousedown/mousemove/mouseup on window; upper clamp = centerColWidth × 9/16 (recalculated on every mousemove from centerColRef); lower clamp = 180px
- Timeline cleanup: sub-toolbar row removed; floating pill controls removed from Timeline and moved to absolute bottom corners of preview wrapper in App.tsx; dead padding rows collapsed (pt-8 → pt-5, flex-1 tracks div → flex-shrink-0)
- Real waveform: Web Audio API decodes voiceover blob URL (voiceoverUrl prop) into 300 normalized amplitude bars; distributed proportionally across segment cells; orange bars sized by amplitude; falls back to flat line if no audio
- Audio track full-width scroll fix: removed w-full + overflow-hidden from audio track wrapper; changed inner div to w-max so it grows with content and scrolls with the visual track
- Effects tab: all SettingsPanel controls moved inline into DropZonePanel third tab; SettingsPanel tombstoned
- TranscriptionBar: conditional on phase !== idle; zero height when not active
- SettingsPanel: tombstoned with {false && ...} comment

#### Key files changed
- src/App.tsx — layout skeleton, header removal, pills, divider, previewHeight state, centerColRef
- src/components/Timeline.tsx — cleanup, waveform, audio track fix, pills removed
- src/components/DropZonePanel.tsx — Effects tab, ← Projects button, onOpenSettings removed
- src/components/PreviewStage.tsx — isMidView removed, fixed pixel sizes removed, rounded-xl
- src/components/SettingsPanel.tsx — tombstoned

#### Verified behaviours
- 3-column layout renders correctly at all screen sizes tested
- Both panels collapse/expand cleanly; nav elements hide with their panel
- Preview always fully visible at 16:9; no cropping at any panel state
- Draggable divider respects 16:9 max when panels open or closed
- Real waveform shows amplitude from voiceover audio
- Audio track scrolls full width with segments
- Effects tab contains all transition/animation/filter/overlay/export controls

### Effects Tab Rebuild — Plan (Archived, complete 2026-06-29)
Status: COMPLETE — all 8 steps shipped; plan retired from project-state.md 2026-07-08 (moved here for historical record)

Guided rebuild of the Effects tab (from mockup.tsx, design-locked UI) from a global-only stub to a fully functional per-segment effects system.

#### Key decisions (locked)
- "Apply to selected" = true multi-select of segments (`selectedSegmentId` became a Set).
- Per-segment effect fields survive both reload AND Apply Sync — `parseProjectData` patched to preserve them (fixes clean-slate wipe of per-segment fields).
- Dropdowns/randomize-pools/presets all read ONE shared option source (`effectsOptions.ts`) — no entry ever wired to a renderer case that does nothing (no phantom enums).
- Accent color canonicalized to `#e07c3a`, reconciling the `#F27D26`/`#ee8b3f` variants that existed before.
- Presets = combined look: one option from each of the 3 dropdowns (transition + animation + overlay) + custom name, up to 20; own dedicated store (`src/services/lookPresetService.ts`) rather than bending the legacy single-category `presetService.ts`.

#### Overlay background handling
Stock overlays ship with a black/white/green background, not removed automatically. Asset-backed overlays must be sourced as black-background screen-blend footage; the renderer removes the black via `ctx.globalCompositeOperation='screen'` in export (frameRenderer) and `mix-blend-mode:screen` in preview (PreviewStage) — pure black becomes transparent, bright areas show through. Each asset overlay carries a blend-mode setting (default `screen`; `multiply` available for white-background assets). Green-screen/chroma-key removal was explicitly out of scope (per-pixel keying, dropped earlier).

#### Effect lists (final, feasibility-resolved)
- **Transitions (10, all buildable):** Hard Cut, Cross Dissolve, Dip to Black, Dip to White, Wipe, Slide/Push, Glitch/RGB Split, Whip Pan, Zoom, Light Leak (procedural radial-gradient flash if no asset).
- **Clip Effects (10 planned, 7 shipped):** Color Correction/Grading, Zoom In, Zoom Out, Ken Burns, Gaussian Blur, Duotone/Color Wash, Sepia/Vintage, Invert shipped; Speed Ramping and Pixelate/Mosaic dropped (pixelate unsupported in WebKit preview, speed-ramp excluded by design).
- **Overlays (10):** 4 procedural (Letterbox, Vignette, CRT/Scanlines, Viewfinder) + 6 asset-backed (Film Grain, Light Leaks, Film Damage, Atmospheric Particles, Weather, Fire/Embers) — both groups moved to Deferred Polish Features (procedural renderer not yet wired; asset-backed blocked on user-supplied footage).
- **Dropped as non-feasible in this engine:** Match Cut, Morph Cut, Crop, Masking & Tracking, Warp Stabilizer, Chroma Key.

#### Step completion
1. UI mount (`3bbd926`) — EffectsPanel from mockup.tsx replaces the inline stub in DropZonePanel.tsx; accent retoken; no-op stubs.
2. Real option arrays (`3c0d3af`) — shared `effectsOptions.ts` source; asset-backed overlays marked disabled.
3. Multi-select model (`330c79e`) — `selectedSegmentId` (single) → Set; wired into segment list/timeline.
4. Per-segment persistence (`f2dd193`) — `parseProjectData` preserves effect fields across reload AND Apply Sync.
5. Apply to selected/all (`dd903b2`) — real handlers writing to the selected Set or all segments.
6. Randomize across segments (`d0d8ca2`) — per-block randomize from checked pool.
7. Combined-look presets (`4b13cb0`) — `lookPresetService.ts` (localStorage `kinetix:lookPresets:v1`, cap 20); bonus read-only drawer effect-pills (`d750ce3`).
8. Renderer implementation — transitions 10/10 (commits `675e322`…`76ccf16`), clip effects 7/7 (`e748345`, `8d98365`, `34910de`).

Plan fully complete as of Step 8. See `project-state.md` Completed Work ("Effects Step 8 — transitions complete", "Effects Tab Rebuild — Steps 5–7 + drawer pills") for the still-current shipped-commit record — that entry is distinct from this plan writeup and was left in place.

---

## Historical Quick Stats (superseded)

> These lines were dropped from the current "Quick Stats" in `project-state.md` on 2026-06-22 because they're pure historical trivia (not current state) or fully duplicated by the sections above. Kept here so the numbers aren't lost.

| Metric | Value |
|---|---|
| Critical bugs (Phase 1 audit) | 5 identified, all resolved (stale closure in playback, `togglePlay` listener churn, dead branch in audio sync, `trimEnd` unimplemented, `storyMap` param unused) |
| Safari support (historical) | ✅ Verified Phase 4 — wasm path (now removed). Native sidecar path is macOS-only (DMG). |

---

## Completed Work Log — 2026-06-24 to 2026-07-11

> Moved from CLAUDE.md's "Current Refactor Status" table and project-state.md's "Completed Work" section during the 2026-07-12 Stage 2 documentation cleanup. Terse items use the same `date | work` table format as the 2026-05-16–06-22 log above; items with substantial root-cause/implementation narrative are kept as full write-ups below, matching this file's "Per-Task Deep Dives" convention. Where a terse CLAUDE.md changelog row and a fuller project-state.md write-up covered the same commit(s), only the fuller write-up is kept here.

### Quick log

| Date | Work |
|---|---|
| 2026-05-19 | Phase 5 smoke test doc created (`docs/phase-5-smoke-tests.md`); later archived to `docs/archived/phase-5-smoke-tests.md` on 2026-07-07. |
| 2026-06-17 | Divider panel + preview height fixes — `previewHeight` initializer reads from viewport; panel-toggle clamps via a `useEffect` (310ms delay); timeline floor of 140px enforced both during drag and on panel toggle. |
| 2026-06-25 | Heading-tag detection false-positive fix (`cf75695`) — `isHeadingTag` used a bare `.includes('HEADING')`, so a scene tag like `[IMAGE: heading_shot.jpg]` false-matched and the whole scene vanished from the timeline. Tightened to `/^\[HEADING\s*:/i`, matching how IMAGE/VIDEO tags are anchored. 17/17 vitest, `tsc` clean, manually verified in the Tauri app. |
| 2026-06-25 | Orphaned voiceover blob on re-stage fix (`3b0593c`) — the `oldIdx` splice in `handleApplySyncFromFiles` now pairs with `URL.revokeObjectURL` + fire-and-forget `deleteAsset(projectId, oldId)`, mirroring the existing `processMediaFile` pattern. 17/17 vitest, `tsc` clean. |
| 2026-06-26 | Review Mapping popup — post-ship polish (commits `55aacc1`, `88169fd`, `603a268`, `5bb778e`, `df52dc1`, `1447813`, `67c4547`) — scene overlay x/y wiring (lower-third default y=78, preview+export), swatch/toggle/stock-split + bg-color editor + None option, font-size/bubble-width/quote fixes, square toggle + scene row reorder + X/Y sliders, PreviewStage edge-to-edge X/Y positioning + content-based width fix (heading + scene), scene row consolidation (italic moved into formatting row, color+XY rows merged, shadow swatch removed, ban toggle relocated, toggle thumb sizing fixed), Review Mapping control converted from icon to a centered text button. Refinement of the already-delisted task 7 feature, not a new Active Task. Pushed to `origin/main` (billing block resolved; CI now manual-only `workflow_dispatch`, `e725a46`). |
| 2026-07-05 | WebCodecs preview migration (Phases 0–8) complete (branch `webcodecs-api`) — `VideoDecoder`-based decode pool + windowed decode-ahead/LRU replaced the dual-`<video>`-slot preview path; cutover to default on all WebCodecs-capable runtimes, legacy `<video>` path retained as capability-gated fallback. Full plan/evidence in `docs/webcodecs-architecture-plan.md`. |

### Full write-ups

<details>
<summary>Architecture shift — ✅ COMPLETE 2026-06-24 (Step 7, commit 254ef1b)</summary>

- **Scene editor read-only:** NOT IMPLEMENTED — superseded. No `readOnly`/disabled gate on the Scene Details editor. Corruption was solved by clean-slate re-sync + confirm-dialog/auto-snapshot instead. Edits remain possible; just not preserved across re-sync.
- ✅ Done (Step 5) — Headings live array-only, never serialized to sceneDetails text.
- ✅ Done — `DropZonePanel.tsx`'s `isStagedEmpty` gate disables Apply Sync unless a file is newly staged.
- **Auto-recalc: PARTIAL.** `applyAnchorBasedTiming()` runs on lock toggle, heading insert/delete, and inside the sync pipeline. But timeline drag-resize uses `applyDurationChange`/`computeDragCascade` — a separate path.
- Direction changed to CLEAN-SLATE RE-SYNC — Apply Sync wipes all derived state and re-derives fresh from audio; nothing carried forward.

**Clean-slate steps (all done):** 3a (`452e1eb`) delete merge loops; 3b regression tests; 3c (`5da64df`/`8523f39`) delete anchor-aware aligner + skip-guard; 3d-1 (`eb7fc8e`) anchor fallback; 3d-2 (`f27d557`) delete PASS 2; 3e (`6090250`) dead anchorSource demotion; Step 5 5.1–5.4 headings array-only; Step 7 (`254ef1b`) final regression.

**Restore tags:** `sync-known-good-2026-06-20` → `bab79b0`; `sync-known-good-2026-06-23` → `a1a326d`.
</details>

<details>
<summary>Bottom drawer + shared controls — ✅ DONE 2026-06-27 (commit 4887d33)</summary>

- ✅ **Shared `SegmentControls` extraction** — the controls portion of `ReviewMappingRow` (both scene-card and heading-card layouts, the field/button/swatch style consts, `updateHC`, and the `.rm-slider`/`.rm-swatch` `<style>` block) is now `src/components/SegmentControls.tsx`. `ReviewMappingModal` renders thumbnail + `<SegmentControls/>` (modal appearance/behavior unchanged — pure move); the bottom drawer renders `<SegmentControls/>` only (no thumbnail, full width). Non-audio asset filtering lives once, inside `SegmentControls`. The drawer's old `<textarea>` overlay input became the shared single-line input, and its phantom shadow control (export never applied it) was dropped.
- ✅ **Bottom drawer centered at 50vw, viewport-anchored** — wrapper switched from `absolute bottom-0 left-0 right-0` to `fixed bottom-0` with `left: 50%`, `width: 50vw`; centering expressed through Framer Motion (`x: '-50%'` on all three keyframes) since motion owns the element transform. Drawer position is now independent of side-panel collapse state.
- ✅ **Mute toggle moved to drawer header** — sits to the left of the lock icon, scene-only (headings have no embedded audio); the old body mute row was removed so scene and heading drawers are the same height. *(The mute toggle itself — and the underlying `isMuted` field — was removed entirely on 2026-07-01 as dead code with no consumer; formerly tracked as D3.)*
- ✅ **Left-panel segment click syncs preview + timeline** — clicking a row now calls `handleSegmentClick` (App.tsx), which sets `selectedSegmentId` AND seeks the time-driven preview to the segment's `startTime` (mirrors the timeline onSeek pattern). `Timeline.tsx` gained an effect that auto-scrolls the active segment into view on `currentSegmentId` change (only when off-screen, so it never fights manual scrubbing).
</details>

<details>
<summary>Effects Tab Rebuild — Steps 5–7 + drawer pills — DONE 2026-06-27 (commits dd903b2, d0d8ca2, d750ce3, 4b13cb0)</summary>

- Step 5 — Apply to selected/all (`dd903b2`) — EffectsPanel's Apply buttons now write real segment effect fields (`effectTransition`/`effectTransitionDuration`, `effectAnimation`/`effectAnimationDuration`, `effectOverlay`) via `setProject(...map...)` in `App.tsx`'s `handleApplyEffect`, scoped to the multi-select Set ("selected") or every non-heading segment ("all"). Headings are always skipped.
- Step 6 — Randomize across segments (`d0d8ca2`) — per-segment random slug pulled from the checked pool, written the same way as Step 5; existing per-segment duration preserved; headings skipped.
- Step 7 — Combined-look presets (`4b13cb0`) — new dedicated service `src/services/lookPresetService.ts` (localStorage key `kinetix:lookPresets:v1`, global across projects, cap `MAX_LOOK_PRESETS = 20`). `EffectsPanel.tsx`'s preset UI (save/restore/delete, name input, "Restored {name}" panel) round-trips through `DropZonePanel.tsx`'s `handleLookPresetsChange`, which diffs the incoming list against the previously-known ids to add/remove only what changed, then re-reads the authoritative list back down as `initialPresets`. `App.tsx`'s preset branch in `handleApplyEffect` writes all five effect fields from the preset in one pass, respecting the same selected/all + heading-skip rules as Steps 5–6. Fixed same-session: the service originally re-minted a `crypto.randomUUID()` on every save, orphaning the id `EffectsPanel` had already generated and breaking the "Restored" active-row highlight right after saving — `saveLookPreset` now accepts and persists the caller-supplied id as-is (with a same-id guard against duplicate rows on a re-fired save). Legacy `presetService.ts` (single-category `StylePreset`, used for overlay-config font presets) is untouched — combined-look presets got their own store rather than bending that shape to fit three slugs + two durations.
- Bonus — drawer header effect-pills (`d750ce3`) — read-only pill row in the bottom drawer header surfaces the currently-applied transition/animation/overlay per segment (icon + label, centered grid, off-states hidden).
- `tsc --noEmit` clean and 17/17 vitest passing after each commit. All four commits are local on `main`, **not yet pushed** — `origin/main` is still at `1e249df`.
</details>

<details>
<summary>Review Mapping modal — feature-complete — ✅ DONE 2026-06-27 (commit 23c8227)</summary>

The Review Mapping modal (task 7, shipped then delisted) reached feature-complete status. Final follow-up: live per-segment thumbnail renders the overlay/heading text layer (font, weight, italic, size, color, bg, bg-None, x/y) scaled proportionally to the thumbnail box, updating in real time as the row is edited. Positioning math mirrored locally in the modal — `PreviewStage`, `frameRenderer`, and `types.ts` untouched. Heading italic intentionally not rendered (unwired everywhere). Commit `23c8227`.
</details>

<details>
<summary>Effects Step 8 — transitions complete (10/10, commit 76ccf16)</summary>

All 10 transition slugs rendered in `frameRenderer.ts` (`applyTransitionBlend`)
and `useTransitionPreview.ts`/`PreviewStage.tsx`:
- Batch A: hard-cut, cross-dissolve, zoom, dip-black, dip-white, slide-push,
  whip-pan, wipe (commits 3779222, f928546, c0ab24f range)
- Batch B: glitch-rgb (lazy scratch-canvas compositing, screen blend, no
  getImageData), light-leak (radial gradient bloom, screen blend, peaks at
  alpha=0.5) — commit 76ccf16
- Caption fixes landed alongside: 6c88da0, 4a65379, f1676a9, a61bfe8
- First use of globalCompositeOperation='screen' in frameRenderer.ts
- Known issue logged: transition timing is 100/0 split, not true 50/50
  (D7) — **fixed 2026-07-10, see the "Transition-centering fix (D7)"
  entry below**
</details>

<details>
<summary>Caption rendering fidelity — ✅ DONE 2026-06-30 (commits 60aa676, ae6165a, and this commit)</summary>

Export caption now honors `fontWeight`/`fontStyle`/`textShadow` (D1, commit `60aa676`); preview caption scales font/padding/radius proportionally to stage height, mirroring `frameRenderer`'s `refScale` (commit `ae6165a`); caption max-width unified to 70% of render width in BOTH preview (CSS `maxWidth: '70%'`) and export (`frameRenderer` `w * 0.7`) for wrap parity. Preview and export now match. Manual export + preview tests passed.
</details>

<details>
<summary>D10 fixed — preview transition black flash on video boundaries — ✅ DONE 2026-06-30</summary>

D10 fixed — preview transition black flash on video→video boundaries eliminated. Root cause: the idle video slot was preloaded (bytes buffered) but never pre-seeked, so seek+first-paint was deferred to the swap moment; the prior canvas-hold attempt gated on 'canplay' (fires before paint). Fix (`PreviewStage.tsx`): warm the idle dual-video slot ahead of time (seek to `nextSeg.trimStart||0` during preload) and gate the reveal on an actual painted frame via `requestVideoFrameCallback`, with a 'seeked'+rAF fallback and 400ms failsafe; warmed common path reveals synchronously (no added latency); existing canvas-hold retained as fallback for unwarmed edge cases (short segments/scrubbing). Image/color paths untouched. Verified acceptable on macOS; Windows/WebView2 spot-check not separately performed (rVFC+fallbacks are engine-agnostic).
</details>

<details>
<summary>D6 fixed — kinetix:ui:v1 lost-update race closed — ✅ DONE 2026-06-30 (commit 3b0702f)</summary>

D6 fixed — kinetix:ui:v1 lost-update/structural race closed by consolidating the three read-modify-write writers (2 in App.tsx, 1 in Timeline.tsx) plus all 7 lazy-initializer reads into a single standalone module `src/services/uiStateStore.ts` (`readUiState`/`patchUiState`). Behavior unchanged (same fields, same write timing, same isPlaying gating, same 300ms scroll-restore); only the read-merge-write mechanics are now centralized and atomic per call. Manually verified: reload preserves panel/scroll/playhead/tab; dashboard project-switch resets to 0:00. Commit `3b0702f`.
</details>

<details>
<summary>Left-panel UI restructure — ✅ DONE 2026-06-30 (commits 0c577e9, f0ee59c, 65d5d66, 8fe8a78)</summary>

- Files tab redesign — compact headers, metadata rows, timestamps, Apply Sync gradient (`0c577e9`).
- Apply Sync stuck-in-syncing fix — clear pending voiceover on project switch and cache-hit re-stage (`f0ee59c`).
- Left panel redesign — heading rows, accent bar, Files tab polish, sync button fix (`65d5d66`).
- Segments tab header restructured into two rows: count/runtime + search input on row 1, the three unified action buttons (lock/unlock all, review, select-all/clear) stretched `flex-1` across row 2 (`8fe8a78`). Added `segmentSearch` state filtering the segment list by `seg.text`, preserving the original array index (`i`) through a `return null` guard inline in the existing `.map()` so `rowRefs`, `dropTargetIdx`, and `onMoveHeading` heading-drag logic stay correct while filtered.
- Recycle bin permanently dropped (no longer present in DropZonePanel.tsx).
- `tsc --noEmit` clean and 17/17 vitest passing.
</details>

<details>
<summary>Four UI bugs fixed — ✅ DONE 2026-06-30 (commits 66fdabf, e967a8d, ddfde06)</summary>

* ✅ Bug 1 — Cancel on new-project popup no longer creates a ghost project. Mount effect zero-projects branch now shows empty dashboard instead of auto-opening the modal.
* ✅ Bug 2 — Project name is inline editable from top-left panel (click to edit, blur/Enter saves, Escape discards). Top-right display is read-only and updates reactively.
* ✅ Bug 3 — UI state fully persists on reload: active tab, left/right panel collapse state, preview divider height, currentTime, selectedSegmentId, timeline horizontal scroll. handleSwitchProject gained a preserveUiState flag — reload preserves position, dashboard switch resets to 0:00.
* ✅ Bug 4 — Left panel segment list auto-scrolls to active segment during playback AND on manual timeline click while paused. Timeline horizontal scroll persists via debounced listener in Timeline.tsx, restored at 300ms after mount.
</details>

<details>
<summary>D12 fixed — preview/playhead jump on timeline resize-drag — ✅ DONE 2026-07-01 (commit be45b07)</summary>

Root cause was a native ghost click, not the derived-state race originally suspected. A resize-drag ends with the cursor away from the left-edge handle's DOM position (segment rows are flex items — a row's on-screen left edge is the sum of every preceding row's width, which never changes while that row is being resized, so the fixed `left-0` handle never tracks the cursor the way the `right-0` handle does). The browser's native `click`, synthesized immediately after `mouseup` and hit-tested at the release position, was landing on the segment row body instead of the handle — firing `onClick`'s `onSeek(s.startTime)` (`Timeline.tsx`) directly, moving the real playhead. Fixed with a one-time, capture-phase `window` `click` listener armed in `handleUp` only when the drag actually moved the mouse (`App.tsx`).

Three secondary issues surfaced and were fixed along the way, kept in the codebase as real (if now largely redundant) hardening: (1) `PreviewStage.tsx`'s dual-slot video seek effect now skips reseeking while `isResizingRef.current` is true, cleared deterministically by a `resizingId`-keyed effect (child-before-parent commit ordering) instead of a racy `requestAnimationFrame` clear; (2) `useTransitionPreview.ts` forces `inTransitionWindow`/`needsPreRoll`/`isActive` false during a drag, so the transition-preview canvas can't swap in a snapshot of the wrong segment's frame; (3) `App.tsx`'s `currentSegment` is frozen at the source during a drag (`lastStableSegmentRef` + one-shot `resizeSettleTick` recompute on release), since `PreviewStage` reads `currentSegment` directly in many ungated places beyond the seek effect (image src, captions, Ken Burns transform, cross-segment transition props). `tsc --noEmit` clean and 17/17 vitest passing throughout. Manually verified across left/right-edge drags, both directions, segments near and far from the playhead.
</details>

<details>
<summary>Timeline smoothness — reload scroll + drag perf — ✅ DONE 2026-07-02 (commits fb6abbb, f4da926, 34206ee)</summary>

Three-part fix for a UI "jump then settle" feel on reload and laggy timeline drag:
- **Reload jump (`fb6abbb`):** the `previewHeight` measurement effect and the timeline `scrollLeft` restore both moved from post-paint `useEffect`/`setTimeout` to pre-paint `useLayoutEffect`, so the corrected preview height and saved scroll position apply before first paint instead of visibly snapping into place after.
- **Timeline drag perf (`f4da926`):** segment-resize and divider drags no longer call `setProject` on every `mousemove` (which rebuilt the whole segments array and re-rendered the full app every frame, with no memoized children). Live width during a drag is now written directly to the DOM via `data-seg-id`-tagged elements; `mousemove` is coalesced into one `requestAnimationFrame` per frame; the timeline rect and pixels-per-second are cached once at drag start instead of re-measured (`getBoundingClientRect`) on every move. The real state change still commits exactly once, on mouseup, through the existing `applyDurationChange` cascade — final drop values are unchanged from before.
- **Scroll-restore race (`34206ee`):** the `fb6abbb` restore ran while `containerWidth` was still 0 (Timeline's 800px zoom-formula fallback before its `ResizeObserver` first fires), so the browser clamped `scrollLeft` to 0 at restore time; two auto-scroll effects (segment-follow, zoom-center) then re-scrolled to the current position shortly after the real width landed, producing a visible "0 then scroll" flash. Fixed by deferring the one-shot restore until the `ResizeObserver`'s first real measurement, and gating both auto-scroll effects on a `didRestoreRef` so neither can fire before the restore has applied.

`tsc --noEmit` clean and 56/56 vitest after each commit. Drag feel and the reload flash can't be proven by automated tests — flagged for manual verification (drag smoothness + exact drop values; reload with a non-zero saved scroll position; playback/zoom/segment-select auto-scroll still work post-restore).
</details>

<details>
<summary>App-wide native selection disabled — ✅ DONE 2026-07-02 (commit b62bd95)</summary>

Click-drag gestures in the timeline and dashboard were triggering native text selection. `#root` now sets `user-select: none`, re-enabled for `input`/`textarea`/`[contenteditable="true"]` and, individually, the transcription-error message (`TranscriptionBar.tsx`) so users can still copy it. `draggable={false}` added to Timeline segment thumbnails and dashboard project thumbnails — the two primary drag surfaces — to stop native ghost-image drag. Review Mapping / preview / dropzone / stock-search thumbnails intentionally left untouched (lower drag-surface risk, out of scope for this pass).
</details>

<details>
<summary>Export quality raise + Tier 1 fast-path speedup — ✅ DONE 2026-07-02 (commits fbc96db, e8eba95, bf003d1)</summary>

- **Quality (`fbc96db`):** removed the unconditional edge-darkening vignette burn-in from both the export canvas path (`frameRenderer.ts`, `drawGradientVignette`) and the preview-only CSS scrim (`PreviewStage.tsx`), restoring preview/export parity. `libx264 -crf 23` → `-crf 16` (visually-lossless YouTube master, per the CRF-16 decision below). `imageSmoothingQuality: 'high'` set on both the main and blend canvases. Pinned `-colorspace`/`-color_primaries`/`-color_trc bt709` on export for consistent color reproduction.
- **Tier 1 fast path — plain video (`e8eba95`):** segments with no caption/overlay/transition/filter/animation/speed change (`isPlainVideoSegment`) bypass the per-frame canvas/PNG/IPC pipeline entirely — one direct ffmpeg trim + cover-fit encode at CRF 16, flags matched to the canvas path (`-an`, bt709, CFR, `setsar`) so concat still seams cleanly.
- **Tier 1 fast path — plain image (`bf003d1`):** plain image segments (`isPlainImageSegment`, sharing a common `isPlainMediaSegment` predicate core with the video check) render ONE frame and encode with `-loop 1 -frames:v N` at CRF 16, `N = segmentFrameCount` for byte-exact duration parity under `-shortest` (no audio drift). Desktop-verified: **3m44s → 40s** on a 4-video/10-image project, output correct (A/V sync, no boundary seam) on both fast-path commits.

New service: `src/services/plainSegment.ts` — the shared `isPlainMediaSegment`/`isPlainVideoSegment`/`isPlainImageSegment` predicates, with dedicated test coverage (`plainSegment.test.ts`).
</details>

<details>
<summary>Locked-overlap early-cutoff fix — ✅ DONE 2026-07-03 (commit 202f31b)</summary>

`fix: thread real audio duration into heading/lock re-timing (no early cutoff)` — `resolveAudioDuration` now threads the real decoded audio duration through heading/lock re-timing instead of an approximated value, closing an early-cutoff bug surfaced while investigating an unrelated preview issue (the original hypothesis — a boundary-rounding gap — was itself rejected as IEEE-754 noise, but chasing it down turned up this genuine, unrelated fix). Regression tests added. `tsc --noEmit` clean, `vitest` 60/60.
</details>

<details>
<summary>First-frame cache + cover layer for preview segment boundaries — ✅ DONE 2026-07-04 (commit 213c3e1)</summary>

Phase 1 of the preview-video quality effort: a `useFirstFrameCache.ts` hook precomputes and caches each segment's first frame; `PreviewStage.tsx` draws it as a static cover layer over the live `<video>` element at segment boundaries, hiding the frozen/blank frame that a cold video element shows before its clock actually starts. `tsc --noEmit` clean, `vitest` 60/60.
</details>

<details>
<summary>D16 — script→Whisper alignment cascade on number/contraction/symbol mismatches, + overshoot follow-up — ✅ FIXED, verified against real project data, committed (`cdc1eb1`, `aa12206`) — 2026-07-07</summary>

**Root cause:** `alignScenestoTranscript`'s word-matching cursor (`src/services/whisperService.ts`) is forward-only and greedy. A script's spelled-out number ("thirty seven") against Whisper's digit output ("37") — and likewise contractions ("don't" vs "do not") and symbols ("%" vs "percent") — scored as a mismatch, degrading that segment's match confidence enough to let a coincidental wrong-position match win, which then permanently desynced the cursor for every following segment. Confirmed against the user's real 251-segment project: drift began exactly at a spoken "thirty-seven" and cascaded forward from there; removing the word eliminated it. Full audit in this session's history.

**Fix (two parts, both in `src/services/whisperService.ts`):**
- **Part A — `canonicalizeForAlignment`** (new exported pure function; `normalize` now delegates to it, so it applies symmetrically to BOTH script segment text and Whisper token text before matching): integers 0–9999 (cardinal reading), 4-digit years (pair reading, e.g. "2024" → "twenty twenty four"), simple decimals ("3.5" → "three point five"), thousands separators, 44 common contractions (expanded before apostrophe stripping), and common spoken symbols (% → percent, & → and, @ → at, $N → "N dollars"). A script's "thirty seven" and Whisper's "37" now collapse to the same word sequence.
- **Part C — cursor confidence guard:** when a segment's best match covers fewer than 40% of its words (`bestScore / targetWords.length < 0.4`), the monotonic search cursor advances only minimally (by 1) instead of by the matched span, so a low-confidence/spurious match can no longer over-advance the cursor and strand every following segment. Dev-only `console.warn` flags each low-confidence segment. Contains any residual mismatch class Part A doesn't canonicalize.

**Tests:** 11 new tests in `src/services/syncTiming.test.ts` (6 canonicalization-equivalence + 5 alignment/cascade, incl. the "thirty-seven" regression and the Part-C safety-net). Full suite **216/216**, `tsc --noEmit` clean.

**Known residual risk:** the "years" spoken-form convention (pair reading, e.g. "2024" → "twenty twenty four") was chosen from general whisper.cpp behavior, NOT confirmed against real transcripts in this repo (none were available) — flag for confirmation on the first real-world test. Digit-vs-digit years are unaffected (both sides canonicalize identically regardless of convention). Still open — see Active Tasks.

**Follow-up — overshoot into next segment's word range (commit `aa12206`):** manual verification of D16 against a real project surfaced a second, distinct failure mode — a specific segment (and its immediate neighbor) collapsing to ~0.1–0.2s duration, without the cascading-forward-drift symptom D16's Part C guard was built to contain. Root-caused via temporary, fully-removed instrumentation (`TEMP-D16-AUDIT`/`TEMP-D16-DETAIL`, added and stripped across three audit-only turns): when a low-confidence match's `bestStart` (its best-scoring candidate position) lands more than 3 words *ahead* of the search cursor — a coincidental match against text that never actually occurs in the transcript, e.g. a burned-in on-screen caption like "you are twenty seven" — that segment's `t1` gets anchored to the overshot position's timestamp, landing after the *next* segment's real, higher-confidence match and collapsing both to a near-zero or negative span. The existing Part C guard correctly holds the forward cursor in this case (preventing a cascade), but did nothing to correct the corrupted segment's own `t0`/`t1`. Distinguished from the 8 already-safe low-confidence cases in the same real project, where `bestStart` stays at/near the cursor and no collapse occurs.

**Fix (two parts):**
- **Primary — overshoot guard** (`src/services/whisperService.ts`, `alignScenestoTranscript`): when confidence `< 0.4` AND `bestStart` is more than 3 words past the entry cursor, re-anchor `bestStart`/`bestEnd` to the cursor before deriving `t0`/`t1` — so an overshooting low-confidence match behaves like the already-safe at-cursor case instead of stealing a bogus forward position. In-tolerance low-confidence matches are untouched (byte-identical output).
- **Backstop — monotonic clamp** (`src/services/syncEngine.ts`, `applyAnchorBasedTiming`): a backward pass pulls any still-inflated non-locked anchor down to its successor's anchor before durations are derived. No-op when anchors are already monotonic (did not fire on the real verification data) — defense-in-depth against any overshoot pattern the primary guard doesn't catch.

**Verified against the user's real transcript (13-segment low-confidence set):** overshoot warning fires on exactly the 5 genuinely-broken segments (48, 65, 152, 173, 183 — note 65 was a newly-caught latent case that hadn't visibly collapsed before but was a genuine overshoot); zero false positives on the 8 previously-safe low-confidence segments (8, 40, 82, 97, 116, 119, 125); zero `[anchor] out-of-order` warnings post-fix (previously 2, at i=153 and i=175) — confirms the primary guard resolves the issue upstream and the backstop clamp is pure safety net on real data. 4 new regression tests added to `src/services/syncTiming.test.ts` (at-cursor case unaffected, far-ahead overshoot resolves, consecutive-overshoot pair resolves without mutual corruption, backstop clamp exercised directly). One pre-existing Part C test assertion updated (`t0[2] > 4.0` → `> 3.0`) — that fixture's own `s1` segment was itself a genuine overshoot case; the old threshold encoded the pre-fix collapsed placement (~5s), the new one reflects the correct uncollapsed placement (~3.75s) the fix now produces.

**Status:** Both D16 (`cdc1eb1`) and this follow-up (`aa12206`) FIXED, committed, and verified against real project data. `tsc --noEmit` clean, `vitest` **220/220** (216 baseline + 4 new). The years-spoken-form residual risk above is the only open item.

**Second follow-up — mixed alnum token digit-extraction gap ("ninety seven percent", 2026-07-08):** a real end-to-end test containing many spoken-number forms passed on every case (years, dollar amounts, plain cardinals, "forty five minutes") EXCEPT "ninety seven percent" — that segment and the one after it collapsed/misplaced and the final segment in the run clamped to ~0.2s. Audited (audit-only turn, `TEMP-AUDIT-PERCENT` instrumentation added and fully removed, confirmed via grep). **Root cause — DISTINCT from the aa12206 overshoot, upstream of it:** `canonicalizeForAlignment`'s per-token digit expansion was gated on a whole-token `/^\d+$/` test (`src/services/whisperService.ts` ~line 185). whisper.cpp's `-ml 1` word-boundary heuristic can fuse a short preceding function word onto a following number with no space — e.g. it emits `to97%`, which (after the `%`→"percent" split that already works) tokenizes to `["to97", "percent"]`. `"to97"` fails the whole-token digit test, so the number never expands and the script's spelled-out `"to ninety seven percent"` cannot match — a genuine canonicalization miss (the `%` handling itself was never the problem: `canon("97%")` already returns `["ninety","seven","percent"]` correctly). This is upstream of aa12206: aa12206 contains the blast radius *after* a match is already low-confidence with an overshot `bestStart`; this is the earlier miss that produces the bad match. Percent phrasing is disproportionately exposed because it's commonly preceded by a tightly-coupled preposition ("to X%", "at X%") with no pause — plain cardinals and `$`-prefixed amounts in the same test kept their space and passed.

**Fix (strict additive extension, `src/services/whisperService.ts` `canonicalizeForAlignment`):** a token that fails `/^\d+$/` but still contains a digit (`/\d/`) is split into contiguous digit / non-digit runs (`/\d+|\D+/g` — non-alnum is already stripped by this point, so a non-digit run is pure letters), each digit run expanded through the existing `digitTokenToWords` path and each letter run emitted as its own word, preserving left-to-right order. Pure-digit tokens, pure-alpha tokens, and the already-working symbol-attached case (`"97%"`) all keep the identical existing code paths — byte-identical output. NOTE: the exact glued token whisper.cpp emitted for the user's real audio was NOT captured (no transcript/log was saved and the audio isn't in the repo); `"to97%"` is a representative shape, and the fix is deliberately general — it handles any function-word+digit gluing, not just `"to"`.

**Tests (2 new in `src/services/syncTiming.test.ts`):** (1) canonicalization unit test — glued `"to97%"` === spelled `"to ninety seven percent"`, plus `at97`/`was2024`/`a1b2` multi-run cases, plus a NEGATIVE no-regression block asserting `97`/`97%`/`hello`/`ninety seven percent` are untouched. This test is the strict regression guard: verified it FAILS when the source fix is reverted. (2) end-to-end aligner coverage on the glued token asserting no segment collapses — integration coverage only (with no silences supplied the synthetic aligner self-corrects even pre-fix; the real collapse needed the full silences + anchor pipeline over ~200 segments, not reproducible synthetically without overfitting). `tsc --noEmit` clean, `vitest` **229/229** (227 baseline + 2 new).

**Status: FIXED and manually verified end-to-end on real audio (2026-07-08).** After the additive fix landed, the user re-ran the same real-project end-to-end flow (real voiceover, Whisper transcription, full silences + anchor pipeline) and confirmed the "ninety seven percent" segment — and the segment after it, and the final segment in the run — now align and hold their durations correctly, with no collapse or ~0.2s clamp. The synthetic-repro caveat above (glued-token shape not captured from the real transcript) is superseded by this pass: the general fix resolves the real failure regardless of the exact function word whisper.cpp glued on. This closes the "ninety seven percent" investigation thread.
</details>

<details>
<summary>Universal audio-format support for voiceover upload + transcription — ✅ DONE (4 parts) — 2026-07-08</summary>

**Root cause (two prior audits this session):** four independent gates each defined "allowed audio" differently and none converted the file to what the next stage needed. (1) file-picker `accept` advertised 10 formats but enforced nothing; (2) the extension router in `DropZonePanel.addFiles` hardcoded `['mp3','wav','m4a','ogg']`, silently dumping flac/aac/wma/opus/aiff into the image-asset bucket with no error; (3) the duration probe used a hidden `<audio>` element — WebView-codec-dependent (OGG fails on macOS WKWebView) with a silent 60 s fallback; (4) whisper-cli got raw, unconverted bytes — its miniaudio backend decodes only wav/mp3/ogg/flac and fails M4A/AAC **silently** (exit 0, zero tokens, degrades to estimate timing with no indication). Binary capability confirmed by direct execution of the bundled `whisper-x86_64-apple-darwin` (miniaudio build; `supported audio formats: flac, mp3, ogg, wav`; auto-resamples any rate/layout to 16 kHz mono; M4A → `failed to read audio data` but exit 0).

**Fix:**
- **Part 1 — universal ffmpeg pre-transcode (core).** `whisper.rs` now transcodes the upload to 16 kHz mono WAV via the ffmpeg sidecar (`transcode_to_wav`, `ffmpeg -hide_banner -y -i <in> -ar 16000 -ac 1 <out>`) before whisper-cli runs, pointing `-f` at the WAV. ffmpeg reads virtually any container/codec, so whisper's format limitation is now irrelevant. Transcode failure cleans the temp dir and emits a real `Error` event.
- **Part 2 — widened extension router.** New `src/services/audioFormats.ts` (`AUDIO_EXTENSIONS` + `isAudioFile`, extension list + `audio/*` MIME fallback). `addFiles` uses it; a file dropped/browsed **onto the Voiceover slot** that doesn't classify as audio now raises a `setSlotError` instead of silently misrouting. New `forceSlot: 'voiceover'` path.
- **Part 3 — ffprobe-style duration via IPC.** New `probe_audio_duration` command (`ffmpeg -i <file>`, parses `Duration:` from stderr — no separate ffprobe binary is bundled) + `probeAudioDuration(blob)` in `tauriFfmpeg.ts`. App's `resolveVoiceoverDuration` replaces the `<audio>`/60 s-fallback `getAudioDuration`; on failure it shows a toast and aborts the sync (no fake duration).
- **Part 4 — visible zero-token warning.** New `TranscriptionStatus` `'warning'` phase; `useWhisper`'s empty-token branch surfaces an amber non-blocking `TranscriptionBar` warning (sync still proceeds on estimate timing). `transcriptionReady` treats `'warning'` as terminal so Apply Sync re-enables.
- **UI copy:** Voiceover subtitle now "MP3, WAV, M4A, OGG, FLAC, AAC, WMA, Opus, AIFF".

**Verification:** `tsc --noEmit` clean; `cargo check` clean (14 s); vitest **220 → 227** (new `audioFormats.test.ts`, 7 cases incl. the FLAC-routes-to-voiceover regression). No existing test asserted the old 60 s-fallback or 4-format behavior, so none needed updating. Runtime end-to-end (real M4A/FLAC transcription in the Tauri app) not yet exercised — pending manual smoke test.

</details>

<details>
<summary>Transition-blend video-element thrashing fix — ✅ DONE 2026-07-09 (commit d033cb1)</summary>

Same-URL transitions (outgoing and incoming segment sharing one source video) were thrashing a single shared `<video>` element: `frameRenderer.ts`'s `videoCache` handed both the outgoing (primary) render and the incoming (transition-blend) render the SAME cached element, so every frame in the transition window seeked it back and forth between two different timestamps. Fixed by adding a second, isolated `blendVideoCache` and a `useBlendVideoCache` param on `renderSegmentFrame` — the transition-blend render (only) routes to the isolated cache; `segmentEncoder.ts`'s `encodeSegment` calls the new `releaseBlendVideo(url)` in a `finally` once the segment's transition window finishes encoding, so at most one blend element is ever live and the incoming segment's own primary render (which becomes CURRENT on the next call) isn't left holding a stale duplicate. 3 new tests in `src/services/frameRenderer.blendCache.test.ts` (element isolation, per-cache dedup, release-only-affects-blend-cache). `tsc --noEmit` clean, `vitest` 277/277. Not independently exportable/testable outside a real Tauri export run with a same-URL transition — verified by code trace + the new unit tests rather than an observed export.
</details>

<details>
<summary>Export pipelining speedup — worker-pool PNG encode + raw-binary IPC write — ✅ DONE 2026-07-09 (commit cd7ea2b)</summary>

Implements the OffscreenCanvas/Worker speedup `docs/phase-7-task-1-export-profiling.md` had already identified as the next export-speed candidate (per-frame `canvas.toBlob('image/png')` was ~47% of per-frame wall time, blocking the next frame's render). Two changes, both additive with a sequential fallback:
- **Worker-pool PNG encode:** new `src/services/frameEncodeWorker.ts` — a small pool of dedicated workers (capped at 4, `hardwareConcurrency - 1`) each own a reused `OffscreenCanvas`; `segmentEncoder.ts`'s `encodeSegment` now renders frame N+1 on the main thread while a worker PNG-encodes frame N, transferring the `ImageData` buffer zero-copy, with a bounded in-flight queue (`pool.size + 1`) for backpressure. Frames complete out of order but are written to their own indexed filename, so ordering doesn't depend on completion order. Falls back to the original fully-sequential main-thread `canvas.toBlob` loop when `Worker`/`OffscreenCanvas`/`convertToBlob` is unavailable — byte-identical output either way.
- **Raw-binary IPC write:** new Rust command `ffmpeg_write_file_raw` (`ffmpeg.rs`) takes the frame bytes as a Tauri v2 raw invoke body (session id + path as headers) instead of a base64-encoded JSON field, and `TauriFfmpeg.writeFileRaw()` (`tauriFfmpeg.ts`) calls it. `segmentEncoder.ts` prefers `ffmpeg.writeFileRaw` when the `FfmpegLike` implementer provides it (optional on the interface), falling back to the existing base64 `writeFile` otherwise — removes the per-frame base64 encode (JS) + inflated-string IPC transfer + base64 decode (Rust) that was layered on top of the original 2026-05-27 base64-IPC speedup (`551s → 120s`, Decisions Log).

`tsc --noEmit` clean, `vitest` 277/277 (no test-count change — scheduling/transport change only, behavior-identical). Not yet benchmarked end-to-end in a real Tauri export — the Quick Stats export-speed figures below predate this change and should be treated as pending re-measurement, not as still-current numbers for this path.
</details>

<details>
<summary>Path B — separate heading layer refactor — ✅ COMPLETE (Phases 0–7) — 2026-07-09</summary>

Full plan: `docs/archived/path-b-heading-layer-plan.md`. Resolved deferred bugs D4 + D5 structurally by lifting headings out of the segments array into a dedicated, absolute-time-addressed overlay layer (`Project.headings: HeadingOverlay[]`), fully independent of segment timing math. Phases 1–6 built the new system alongside the old in-array system (`isHeading`/`headingConfig`) to protect the regression-locked `syncTiming.test.ts` suite during the transition; Phase 7 (final) deleted the legacy system entirely once the Phase 6 manual gate passed.

**Phase 7 (final deletion):** removed `isHeading`/`headingConfig` from `VideoSegment` (`types.ts`); deleted `computeHeadingAnchors`, `reinsertHeadings`, `stealDurationFromNeighbors`, `giveDurationToNeighbors` (`syncEngine.ts`) and `applyHeadingTiming` (`whisperService.ts`); simplified `applyAnchorBasedTiming` to content-only; swept every remaining `isHeading` reference out of `App.tsx`, `PreviewStage.tsx`, `Timeline.tsx`, `DropZonePanel.tsx`, `ReviewMappingModal.tsx`, `SegmentControls.tsx`, `BottomDrawer.tsx`, `useFirstFrameCache.ts`, `useWebCodecsPreview.ts`, `frameRenderer.ts`, `plainSegment.ts`. Rewrote `syncTiming.test.ts`'s Σ-duration invariant tests as content-only and updated `lockedOverlap.test.ts`/`plainSegment.test.ts` to drop in-array-heading fixtures.

Key invariants updated: (b) Σ **content**-segment duration = voiceoverDuration (headings excluded, own no timeline seconds); (c) headings are the separate top-level `HeadingOverlay[]` layer (`project.headings`), not segment-array entries — see Key Invariants section below.

`tsc --noEmit` clean, `vitest` 263/263. Manually verified end-to-end in the Tauri app: create/edit/drag-resize heading, re-sync clamp+`needsReview` badge, export with headings over both plain and composited (overlapping) segments.

</details>

D4 + D5 converted into the Path B: Separate Heading Layer roadmap (`docs/archived/path-b-heading-layer-plan.md`) — they were symptoms of heading/segment coupling that Path B removed. Not fixed individually (targeted fixes rejected as low-value). Deferred as of 2026-07-02; Path B was subsequently completed on 2026-07-09 (Phases 0–7) — see the "Path B — separate heading layer refactor — ✅ COMPLETE" Completed Work entry above.
<details>
<summary>Exported-video judder — ✅ FIXED, two contributing causes (commits `f39e23f`, `8ecf5ef`) — 2026-07-09</summary>

Investigation (audit-only turns) found two independent, additive contributors to the reported judder, both on the canvas/composited export path (Tier 1/Tier 2 plain-segment fast paths were never affected):

- **Cause 1 — fps mismatch:** `exportFps` was a fixed 30fps default with no knowledge of the source clip's native frame rate, so the canvas path's fixed-interval `<video>` seeks resampled every source clip to an arbitrary rate regardless of what it was actually shot/encoded at. **Fix (`f39e23f`):** new `probe_video_fps` Rust command (mirrors `probe_audio_duration`) probes each video asset's native fps at stage/import time (Apply Sync, zip import, stock search) and stores it as `Asset.nativeFps`; a new effect in `App.tsx` auto-sets `exportFps` to the staged videos' native rate when they all agree (bucketed to the nearest of `{24, 30, 60}`), deferring permanently to the user's own choice the moment they touch the Frame Rate dropdown, and flagging (not guessing) when native fps values are mixed. No per-segment retiming; Tier-1's ffmpeg `-r` fast path was untouched.
- **Cause 2 — seek/paint race:** even after the fps fix, `frameRenderer.ts`'s `seekVideo` only awaited the DOM `seeked` event before `drawImage`, which doesn't guarantee the decoder has actually submitted the target frame for compositing — the same race `PreviewStage.tsx` had already proven out for the preview path (D10 fix) via a `requestVideoFrameCallback`-based wait. A `seeked`-only wait can silently capture the still-resident previous frame, producing irregular duplicate-frame judder independent of any fps setting. **Fix (`8ecf5ef`):** extracted the proven `waitForVideoFrame` helper (rVFC primary, `seeked`+rAF fallback, timeout failsafe) out of `PreviewStage.tsx` into a shared `src/services/waitForVideoFrame.ts`, and layered it onto `seekVideo`'s existing `awaitSeeked` step — `awaitSeeked`'s own error/5s-timeout handling is kept, so a genuinely broken seek still surfaces as a real `'encode'` error via `exportPipeline.ts` instead of silently producing wrong frames.

**Verification:** `tsc --noEmit` clean and `vitest` 263/263 after both commits (no test count change — neither fix touched `segmentEncoder.ts`'s frame-loop timing math or the Tier-1/Tier-2 fast paths). Dev-preview regression check confirmed the `PreviewStage.tsx` extraction is behavior-identical (no console errors, Export Quality UI unchanged). The seek/paint race fix itself can't be exercised outside a real Tauri export run (native ffmpeg sidecar), so it's verified by code trace + the first-party precedent (`PreviewStage.tsx`'s own D10 fix) rather than an observed before/after export.

**Residual, not fixed:** a much lower-amplitude version of Cause 1 remains — `nearestExportFps` rounds to exact `{24, 30, 60}`, not true NTSC rates (23.976/29.97/59.94), so a ~0.1%/frame phase drift can still recur over long segments. Logged as **D17** in Ignored Low Risk Bugs rather than pursued further; the larger structural fix (ffmpeg-driven frame-accurate decode feeding the canvas compositor, eliminating `<video>`-element seeking entirely) was scoped in the audit but deliberately deferred — see Decisions Log.
</details>

<details>
<summary>Transition-centering fix (D7) — ✅ DONE 2026-07-10 (commit 94b42e4)</summary>

**Deliberate semantic change, not a bug patch:** the transition window used to play entirely AFTER the A/B boundary (`[B.start, B.start+duration)` — a 100%-after/0%-before split, logged as the D7 "not true 50/50" issue when Effects Step 8 shipped and again deferred at `docs/webgl-architecture-plan.md`'s Phase 3 writeup). Now centered on the boundary: `[B.start - duration/2, B.start + duration/2)`, progress 0→1 linear, exactly 0.5 at the boundary — applied identically to preview and export so the two stay in parity.

- New shared helper `resolveTransitionProgress(boundaryTime, duration, currentTime)` in `src/services/transitionResolver.ts` — the single source of the centered-window arithmetic, used by GL preview (`compositeParams.ts`), legacy preview (`useTransitionPreview.ts`, the shipped default), and native export (`segmentEncoder.ts`, via a new `resolveBlendFrameParams` wrapper).
- `compositeParams.ts`: `resolveTransition`/`findPrevSegment` replaced by `resolveActiveBoundary` (iterates adjacent segment pairs directly via a new `findNextSegment`, since bounds-containment alone can no longer identify which side of a centered window `currentTime` is on). `deriveSlotPlan` gained a required 4th `config` param as a consequence.
- `useTransitionPreview.ts`: the old "candidate A = pre-roll only" / "candidate B = the real window" split is now symmetric — candidate A becomes genuinely active (blending) for its own last `duration/2` seconds, not just pre-roll.
- `segmentEncoder.ts`/`exportPipeline.ts`: `startTimeOffset`/`trailingExtension` halved; incoming segment content is held at its own true t=0 through the entire pre-boundary half (matching the legacy preview's static-snapshot design) and advances forward from 0 only post-boundary — no source "handle" past `trimStart` required.
- Two PreviewStage.tsx consumers needed matching fixes (found by tracing what moving the window actually breaks, not part of the original 4-file task scope but required for correctness): the caption-hold logic (`captionSegment`) assumed `currentSegment` was always the incoming side for a window's whole active life — fixed via new `outgoingSegmentId`/`incomingSegmentId` fields on `useTransitionPreview`'s return value. The WebCodecs live-incoming-frame upgrade had the same latent assumption — without a guard it would have silently blitted the OUTGOING segment's own live frame onto the incoming snapshot canvas for the entire pre-boundary half of every transition; fixed with an explicit segment-id gate.
- **Follow-up gap this change left in `useGlPreview.ts` (no incoming-side live-pull, hence no blend during the pre-boundary half of the centered window) is now CLOSED — commit `1121b76`.** See the dedicated **"Bug 1 — WebGL2 preview video-video transition blend gap"** entry below for the mechanism and verification.
- Every existing test asserting the old anchored-at-B-start timing was rewritten (not relaxed) for the centered spec; new tests added explicitly pinning 50/50 centering (progress exactly 0.5 at the boundary) in `compositeParams.test.ts` and two new test files, `transitionResolver.test.ts` and `segmentEncoder.test.ts`. `tsc --noEmit` clean, `vitest` 401/401. Files touched: `src/services/transitionResolver.ts` (+test), `src/services/gl/compositeParams.ts` (+test), `src/hooks/useGlPreview.ts`, `src/hooks/useTransitionPreview.ts`, `src/services/segmentEncoder.ts` (+test), `src/services/exportPipeline.ts`, `src/components/PreviewStage.tsx`.
</details>

<details>
<summary>Bug 1 — WebGL2 preview video-video transition blend gap — ✅ DONE 2026-07-11 (commit 1121b76)</summary>

**Disambiguation:** distinct from the two other "Bug 1"s in these docs — NOT the WebCodecs cross-dissolve flash-back (S2→S1→S2, fixed `3022706`) and NOT the dashboard cancel/ghost-project bug. This is the WebGL2 dev-toggle preview path's video↔video transition failure. **This entry is the single source of truth for the mechanism; other mentions cross-reference it.**

**Symptom (real Tauri app, WebGL2 Preview toggle ON):** across a video→video transition, segment A's tail showed zero blend and segment B's head played the remaining half alone — a deterministic 0-then-50 split (not the originally-assumed 0-100). Image↔image and video↔image transitions were already clean. Not caught by the mock-based unit suite; only real-app manual testing (no browser-preview equivalent — no Whisper, no real decoder-pool behavior) surfaced it.

**Root cause:** in `src/hooks/useGlPreview.ts` the OUTGOING segment had a live chase-pull for freshly-decoded frames, but the INCOMING segment had no equivalent. For the entire pre-boundary half of D7's centered transition window, the incoming frame source resolved to `null` and the render fell back to "segment A alone, zero blend." This is exactly the "known follow-up gap" the D7 entry below had flagged as deferred — now closed.

**Fix (`1121b76`):** added a symmetric incoming-side chase-pull mirroring the pre-existing outgoing-side one. Two follow-up refinements in the same commit removed a flicker the initial addition introduced on its own: (1) stabilized the new `incoming` state's object identity via a functional-updater bail-out, preventing redundant render-effect fires; (2) retain the last valid composited blend on a transient closed-frame read instead of popping back to "segment A solo."

**Verified:** manually confirmed working in the real Tauri app on the WebGL2 dev-toggle preview path — video↔video transitions now blend smoothly and stably, no flicker, no dropout. Closes **only** this one case; the broader Phase 3 manual verification checklist remains un-run (see Active Tasks).

**Earlier abandoned attempts (historical context):** two prior commits (`65b84ee`, and WIP checkpoint `0fd2b53`) claimed to fix this from mock-based tests alone; real-app testing showed they did not fix it and turned the symptom from deterministic to intermittent. Both were reverted (`git reset --hard` to `09cf2e5`) before the real fix above. Discarded work is preserved in local unpushed tags `bug1-suspect-patches-backup` (→ `0fd2b53`) and `bug1-65b84ee-cherry-pick-backup`.

**Race hypotheses (unresolved, not closed by this work):** three hypotheses from earlier diagnostic logging — a double-`-ENTER` frame-pull burst, N+2 decoder-pool prefetch contention, and playhead/decoder-settle decoupling — were re-audited against current code and found NOT to be the cause of this specific gap. Note that the N+2 hypothesis was simply inaccurate (prefetch has always been N+1). The playhead genuinely has no decoder-state awareness (`usePlayback.ts`, unchanged), and whether the frame-pull effect double-fires per tick could not be confirmed or ruled out statically — these remain open/unaddressed in general, not resolved here.
</details>

---

## Decisions Log — moved from project-state.md (2026-07-12)

> The 38 purely-retrospective entries below were moved out of project-state.md's Decisions Log during the 2026-07-12 Stage 2 documentation cleanup — either superseded by later work, or fully absorbed into CLAUDE.md's architecture/conventions sections, or otherwise no longer decision-points a future session needs to weigh. The 6 entries judged to retain forward-looking relevance (environment setup, an active architectural decision, a reusable debugging pattern, an operative branch/CI convention, and a standing "don't delete this" rule) remain in project-state.md's own Decisions Log.

| Date | Decision |
|---|---|
| 2026-05-16 | **Hosting:** Cloudflare Pages for frontend. Free tier, edge CDN, unlimited bandwidth. Render backend deferred to Phase 3. |
| 2026-05-16 | **Target users:** YouTube creators. Initial private use across 5–10 channels owned by user's team. |
| 2026-05-16 | **Export approach:** ffmpeg.wasm in browser for Phase 3. Slower than native (3-5×) but $0 infra, works offline, no server. Pipeline code will port to native ffmpeg in Phase 6 with minimal changes. |
| 2026-05-16 | **Long-term distribution:** Desktop app via Tauri (Phase 6). Web app remains the development target through Phases 3-5; desktop wrap converts the same codebase. Native ffmpeg replaces ffmpeg.wasm for full-speed renders. |
| 2026-05-16 | **Branch strategy:** `main` is the stable branch. Feature work goes on short-lived branches, merged via PR. |
| 2026-05-16 | **Output format:** MP4 required for YouTube upload. Current WebM output is unacceptable for production — this is a Phase 3 blocker. |
| 2026-05-17 | **ffmpeg.wasm encode speed:** ~25s wall-clock per 1s of 1080p output (≈1.35s per frame at 30fps). Acceptable for Phase 3 validation; production-grade speed requires Phase 6 native ffmpeg via Tauri. |
| 2026-05-17 | **(Historical — wasm path removed in Phase 6.4) Safari export verified:** `crossOriginIsolated=true`, `SharedArrayBuffer` available, COOP/COEP headers correct, export completes, MP4 plays in VLC with H.264 + AAC. No code changes required for Safari support. |
| 2026-05-17 | **Global transition fallback:** `segmentEncoder.ts` now falls back to `project.globalTransition` when a segment's own `transition` field is NONE. Per-segment overrides take precedence. "Override all per-segment transitions" button in Settings still materializes the global value onto segments for per-segment overrides. UX revisit deferred to Phase 5. |
| 2026-05-21 | **Item 3 approach (preview transitions):** Pre-roll snapshot blend (option b). When playhead enters transition window, snapshot outgoing + incoming first frame to offscreen canvases, blend over transition duration via applyTransitionBlend. Universal coverage across image/video, single seek cost lands during pre-roll (before transition visually starts). Rejected option (a) image-only canvas overlay (asset-type branching complexity) and option (c) skip-and-document (would leave preview-vs-export gap user said to close). |
| 2026-05-21 | **NEON_FLICKER glow:** Implemented as ctx.shadowBlur + shadowColor pass on top of keyframe alpha pulse. Documented fallback path if visual quality regresses on dark backgrounds. |
| 2026-05-21 | **Overlay drag clamp policy:** Hard-clamp drag to [halfW/2, 100-halfW/2] (percent). Off-canvas positioning explicitly rejected — overlay drag is positioning, not animation authoring; off-screen reveal effects belong to AnimationType, not overlay position. |
| 2026-05-25 | **Path B over Path A:** The export pipeline now renders true cross-fades (both segments advance during the fade window) rather than holding the incoming segment static. Mechanism: outgoing segment encodes `trailingExtension` seconds past its boundary; incoming segment skips its first `transitionDuration` seconds via `startTimeOffset`. Overlap contributions cancel pairwise on the timeline, so `Σ duration = voiceoverDuration` invariant is preserved without changing `App.tsx`. Commit `261936f`. |
| 2026-05-26 | **Tauri v2 desktop wrap:** Chose Tauri (not Electron) for desktop packaging — smaller bundle, native WebKit, Rust backend. `tauri-plugin-shell` v2.3.5 provides the sidecar API. |
| 2026-05-26 | **Sidecar name resolution:** `sidecar("ffmpeg")` must use the bare name (no `binaries/` prefix). `tauri-build` copies `src-tauri/binaries/ffmpeg-<triple>` → `target/debug/ffmpeg` (strips both triple AND path prefix via `file_name()`). Runtime `relative_command_path()` constructs `{exe_dir}/ffmpeg` — exact match. Using `sidecar("binaries/ffmpeg")` resolves to `{exe_dir}/binaries/ffmpeg` which doesn't exist. |
| 2026-05-27 | **Static evermeet.cx ffmpeg build over Homebrew:** Homebrew binary (385 kB) was dynamically linked to `/usr/local/Cellar/ffmpeg/…/lib/` — not portable to machines without Homebrew. evermeet.cx 8.1.1 static build (76 MB) links only `/System/Library/` and `/usr/lib/` (verified via `otool -L`). Binary is gitignored; `src-tauri/binaries/README.md` documents re-provisioning. |
| 2026-05-27 | **Base64 IPC for frame writes:** Encoding `Uint8Array` as base64 before IPC and decoding on the Rust side eliminates the JSON-array-of-numbers serialization bottleneck. Speedup: 551s → 120s for a 4-segment project (4.6×). Further optimizations (Tauri Channel API binary IPC) deferred to Phase 7 if needed. |
| 2026-05-27 | **GPL sidecar for internal distribution:** evermeet.cx build compiled with `--enable-gpl` (includes libx264). GPL is acceptable for internal distribution (closed, no redistribution). Before public SaaS launch: swap for LGPL-only build (OpenH264 or commercial x264 license). Tracked as SaaS readiness item in `src-tauri/binaries/README.md`. |
| 2026-06-26 | **Draggable headings (task 6):** heading rows drag to any position via Pointer Events + setPointerCapture (no new dependency). Duration give-back/steal factored into shared syncEngine helpers (stealDurationFromNeighbors / giveDurationToNeighbors). Post-drag recompute uses anchor-free recomputeStartTimes, not applyAnchorBasedTiming. Stale-anchor behavior on pre-existing projects (locked neighbor edge case) is consistent with clean-slate philosophy — fresh sync resolves it. |
| 2026-06-26 | **Review Mapping popup (task 7):** new ReviewMappingModal at z-[150] with per-segment thumbnail, horizontal asset bar, stock search trigger (reuses existing StockSearchModal at z-[200] after bump), time range display. Mounted in App.tsx sibling to StockSearchModal. StockSearchModal z-index bumped from z-[100] to z-[200] to clear the new popup. *(The initial ship also had a mute toggle; it was removed in the `947082c` card-layout redesign and is not present in the current modal.)* |
| 2026-06-26 | **Review Mapping popup — post-ship polish (this session):** refinement of the already-delisted task 7 feature, not a new backlog item. Scene overlay x/y position wiring, lower-third default y=78, preview+export (`55aacc1`). Swatch/toggle/stock-split polish + overlay bg-color editor (`88169fd`). Overlay caption font-size wiring, bubble auto-width, bg-None option, removed auto-quotes (`603a268`). Square toggle, scene row reorder, scene X/Y sliders (`5bb778e`). Scene overlay + heading text edge-to-edge X/Y positioning + width fix in PreviewStage (`df52dc1`). Scene row consolidation — italic moved into formatting row, color+XY rows merged into one, shadow swatch removed, ban toggle relocated next to bg swatch, square toggle thumb sizing fixed (`1447813`). Review Mapping control converted from icon to a centered text button in the Segments tab header (`67c4547`). |
| 2026-06-27 | **Shared SegmentControls + drawer/preview/timeline sync (commit `4887d33`).** Extracted the Review Mapping card's controls into a shared `SegmentControls` component reused by both the modal and the bottom drawer (modal unchanged — pure move; drawer is controls-only, no thumbnail). Bottom drawer recentered to a viewport-anchored 50vw block (motion-owned `x: '-50%'`), independent of side-panel state. Mute toggle relocated to the drawer header (scene-only); body mute row removed so scene/heading drawers match height. Left-panel segment click now seeks the time-driven preview to the segment and auto-scrolls the timeline to bring it into view. Closes backlog item 2 (bottom drawer redesign). |
| 2026-06-27 | **Effects Tab Rebuild Steps 5–7 + drawer effect-pills (commits `dd903b2`, `d0d8ca2`, `d750ce3`, `4b13cb0`).** Apply-to-selected/all and randomize now write real per-segment effect fields; combined-look presets (transition + animation + overlay slugs + 2 durations) persist globally via a new `src/services/lookPresetService.ts` (dedicated localStorage store, 20-cap, kept separate from the legacy single-category `presetService.ts`). Mid-session fix: preset ids are now preserved end-to-end through the service round-trip (the service no longer re-mints its own id), so the active "Restored" highlight survives a save. Bottom drawer header also gained a read-only effect-pills row. Step 8 (renderer implementation) is now the only remaining step in the Effects Tab Rebuild plan. All four commits are local-only — not yet pushed to `origin/main` (still at `1e249df`). |
| 2026-06-29 | **Effects Step 8 — transition renderer (Batch A + B):** All 10 transitions implemented in `applyTransitionBlend` (frameRenderer.ts) via pure canvas compositing — no getImageData/pixel readback anywhere. glitch-rgb uses lazy module-level scratch canvases + screen blend (cheap fake, visually indistinguishable at transition speeds). light-leak uses radial gradient bloom + screen blend, opacity shaped by alpha*(1-alpha)*4. Transition timing is Path B (100/0 split — entire window on A's trailing extension in export, last D seconds of A in preview) — documented as deferred known issue, not a regression. |
| 2026-06-30 | UI state persistence: kinetix:ui:v1 localStorage key stores activeLeftTab, leftPanelCollapsed, rightPanelCollapsed, previewHeight, currentTime, selectedSegmentId, timelineScrollLeft. handleSwitchProject preserveUiState flag distinguishes reload (preserve) from dashboard switch (reset). Timeline scroll listener lives in Timeline.tsx because timeline-scroll-area does not exist in DOM when App.tsx mounts. Restore deferred 300ms via setTimeout to let layout settle after double-mount caused by unbatched async hydration state updates. |
| 2026-06-30 | Caption max-width = 70% of render width (was 768px @1080p ≈40%). Applied identically in PreviewStage (CSS `maxWidth: '70%'`, resolves against inset-0 stage box, no JS) and frameRenderer (`w * 0.7`). Font-size/padding/radius remain height-scaled via refScale. Long captions now wrap later than before; preview/export parity preserved. |
| 2026-06-30 | UI-state persistence consolidated into `src/services/uiStateStore.ts` — single source for `kinetix:ui:v1` read/merge/write. Closes D6 and the structural risk of independent RMW writers (future async storage backend would otherwise reintroduce a real clobber). No behavior change. |
| 2026-06-30 | D10 fixed via pre-seek + requestVideoFrameCallback reveal-gating in PreviewStage dual-video slots (was: canplay-gated, which fires before paint). Canvas-hold kept as fallback. Preview-only; export untouched. |
| 2026-07-02 | D4/D5 will NOT get targeted fixes. Both fold into Path B (separate heading layer, `docs/archived/path-b-heading-layer-plan.md`), deferred at the time. (Path B was subsequently completed 2026-07-09 — see the Path B Completed Work entry.) Active-bug list now empty; next focus = export speed + app performance. |
| 2026-07-02 | **CRF 16 for export, not pixel-identical:** chose `libx264 -crf 16` (visually-lossless YouTube master) over chasing a pixel-identical re-encode. A truly pixel-identical path would require JPEG-frame passthrough or a hardware encoder, both ruled out — JPEG intermediates reintroduce generational loss before libx264 ever sees the frame, and hardware encoders (VideoToolbox/NVENC/QSV) aren't guaranteed present or bit-consistent across the Windows/macOS Intel/macOS arm64 targets this app ships to. CRF 16 gets visual quality close enough for the intended use (YouTube upload) without either tradeoff. |
| 2026-07-02 | **Two-tier export: plain segments bypass canvas entirely.** Any segment with no per-frame compositing (no caption, overlay, transition edge, filter, animation, or speed change) now skips the canvas/PNG/IPC render pipeline and goes through ffmpeg directly — one trim+encode for video (`e8eba95`), one frame + `-loop`/`-frames:v` for images (`bf003d1`). Composited segments (anything with an active effect) still render through the full per-frame `frameRenderer.ts` canvas path unchanged. The predicate (`isPlainMediaSegment` in `src/services/plainSegment.ts`) is deliberately conservative — anything it isn't certain is plain falls back to the canvas path, so quality/correctness never regresses, only speed varies. |
| 2026-07-02 | **Live timeline drag stays off React state.** Resize/divider drags no longer route their per-`mousemove` live-preview through `setProject` — App.tsx isn't decomposed/memoized, so any state update during a drag re-rendered the entire tree every frame. Live visual feedback is now a direct DOM write (`el.style.width` via `data-seg-id`, rAF-coalesced); the real state commit still happens exactly once, on mouseup, through the pre-existing `applyDurationChange` cascade — so final dropped values are provably unchanged (Phase A audit confirmed mouseup already fully committed independent of the per-move state, `f4da926`). Memoizing the heavy children (`PreviewStage`, `DropZonePanel`, `Timeline`, `BottomDrawer`) so `setProject` mid-drag would be cheap was considered and deliberately deferred — the ref/DOM approach is a superset fix that also eliminates the per-frame reflow width causes, not just the re-render cost. |
| 2026-07-07 | **Scene-tag/asset-matching fixes (`9b15a59`):** extension-agnostic exact match (strip file extensions on both sides before comparing, so `photo.jpg` matches an uploaded `photo.png`-renamed-to-`.jpg` case that previously failed), RTF bare-tag support (paste-from-RTF scene lists that lose their bracket formatting still resolve), and a new `unmatchedExplicitTag` flag that stops a failed *explicit* tag match from silently falling back to fuzzy-matching some other, wrong asset — an explicit tag that can't resolve now surfaces as genuinely unmatched instead of guessing. Informed by two read-only audits this session (`docs/archived/audit-scene-sync-flow.md`, now-deleted `docs/audit-tag-format-change.md`). `tsc --noEmit` clean, `vitest` 205/205 at the time. |
| 2026-07-07 | **D16 — script/Whisper alignment cascade fix (`cdc1eb1`):** root-caused a Whisper-alignment desync triggered by spoken numbers (e.g. script says "37," Whisper transcribes "thirty-seven") and similar contraction/symbol mismatches — one mismatched token was throwing off the sliding-window cursor for every subsequent word, cascading into wrong segment boundaries later in the transcript. Fixed via `canonicalizeForAlignment` (normalizes numbers/contractions/symbols before comparison) plus a cursor confidence guard in `src/services/whisperService.ts`, plus 11 new tests. `tsc --noEmit` clean, `vitest` 216/216. **Residual risk, not yet closed:** the "years spoken-form" convention used by `canonicalizeForAlignment` (pair-reading, e.g. "2024" → "twenty twenty four") was chosen from general whisper.cpp behavior, not confirmed against a real transcript in this repo — see Active Tasks. |
| 2026-07-07 | **D16 follow-up — overshoot into next segment's word range (`aa12206`):** real-project verification of D16 surfaced a second, non-cascading failure mode — a low-confidence match's `bestStart` landing far ahead of the search cursor (a spurious match against unspoken caption-style text) anchored that segment's `t1` past the *next* segment's true start, collapsing both to near-zero/negative duration, without triggering D16's cascade guard (which only protects the forward cursor, not the corrupted segment's own span). Root-caused via temporary instrumentation (added and fully removed across three audit-only turns, confirmed via grep). Fixed by (1) an overshoot guard in `whisperService.ts` that re-anchors an overshooting low-confidence match to the cursor, and (2) a backstop monotonic-anchor clamp in `syncEngine.ts`'s `applyAnchorBasedTiming`. Verified against the user's real transcript: fires on exactly the 5 genuinely-broken segments (of 13 low-confidence total), zero false positives on the 8 safe ones, zero `[anchor] out-of-order` warnings post-fix (previously 2). 4 new regression tests, 1 pre-existing Part C assertion updated (reflects the fix's correct, uncollapsed placement, not a masking change — see the D16 Completed Work entry for the full trace). `tsc --noEmit` clean, `vitest` 220/220. |
| 2026-07-08 | **D16 pair-reading years convention CONFIRMED — Active Tasks item closed.** User ran a real end-to-end test (script + scene doc, real voiceover) containing three pair-reading-form years: "nineteen eighty seven" (1987), "twenty twenty four" (2024), "nineteen ninety nine" (1999). All three fall inside the existing pair-reading guard (4-digit token, `n % 100 >= 10`) and all three synced correctly. Combined with the earlier cardinal-form confirmation ("2003" / "two thousand and three"), both branches of `canonicalizeForAlignment`'s year-handling are now verified against real data — no further action needed on this item. |
| 2026-07-08 | **D16 second follow-up — mixed alnum token digit-extraction ("ninety seven percent"):** the same real test that closed the years item failed on exactly one phrase. Root cause (audited, `TEMP-AUDIT-PERCENT` instrumentation added + fully removed): `canonicalizeForAlignment` gated digit-to-words expansion on a *whole-token* `/^\d+$/` test, so a token where whisper.cpp's `-ml 1` boundary heuristic glued a preceding function word onto the number with no space (e.g. `to97%` → tokens `["to97","percent"]`) never expanded the number — `"to97"` stayed an unmatchable literal and the spelled-out script side couldn't match. DISTINCT from and upstream of the aa12206 overshoot (that guard contains a bad match's blast radius; this is the earlier miss that produces the bad match). The `%`→"percent" handling itself was never at fault (`canon("97%")` was always correct). Fixed as a strict additive extension: a token failing `/^\d+$/` but containing a digit is split on `/\d+|\D+/g`, each digit run expanded via the existing `digitTokenToWords` path, letter runs emitted as their own words in order; all previously-working token shapes keep byte-identical output. 2 new tests (unit test is the strict guard — verified it fails when the fix is reverted; plus an integration/no-collapse aligner test). The exact real-world glued token was not captured (no transcript saved, audio not in repo), so the fix is deliberately general across any function-word+digit gluing rather than special-cased to `"to"`. `tsc --noEmit` clean, `vitest` 229/229 (227 + 2). **User manually verified the fix end-to-end on real audio** — the "ninety seven percent" segment and its neighbours now align without collapse in the full real-project flow; investigation thread closed. |
| 2026-07-09 | **Exported-video judder — two-cause fix, structural rewrite deferred.** Root-caused to two additive causes on the canvas/composited export path: (1) fixed 30fps export default with no knowledge of source native fps, fixed via native-fps probing + auto-match (`f39e23f`); (2) `frameRenderer.ts`'s `seekVideo` awaiting only the `seeked` DOM event before `drawImage`, which doesn't guarantee the decoder actually submitted the frame for compositing — fixed by reusing `PreviewStage.tsx`'s proven `requestVideoFrameCallback`-based `waitForVideoFrame` (`8ecf5ef`). The audit's larger structural fix — replacing `<video>`-element seeking with ffmpeg-driven frame-accurate decode feeding the canvas compositor, which would also close the residual NTSC bucket-rounding drift (D17) — was deliberately deferred rather than pursued now: the two landed fixes address the dominant, evidenced causes at low risk/effort, while the structural rewrite is a larger effort better suited to (or superseded by) the planned WebCodecs preview/export unification (`docs/webcodecs-architecture-plan.md` Section 8). |
