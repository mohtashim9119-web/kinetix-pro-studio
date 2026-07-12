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

## WebGL2 Effects Engine — Closed Phases (Archived)

> **Archived 2026-07-12** (Stage 3 doc cleanup), moved verbatim from `docs/webgl-architecture-plan.md`. These are the fully-closed phases of the WebGL2 effects-engine rebuild. The live plan — still-open **Phase 3** (with its un-run manual verification checklist), **Phases 4–6**, and the full engine decision / architecture / scope / risk register / rollback (Sections 2–9) — remains in `docs/webgl-architecture-plan.md`. **Cross-reference note:** section numbers cited in the text below (“Section 2.2”, “Sections 2–3”, “Section 4”, “Section 5.1”, “Section 6”, “Section 8”, etc.) refer to that live document's numbering; the sole exception is “Section 1” / the Root-Cause Audit, reproduced verbatim in this block.

### ✅ COMPLETED

- **Part 1 — Root-cause audit of the CSS/Canvas2D effects engine.** Full findings in Section 1. Key outcomes: (a) confirmed the dual-implementation and dual-video-sourcing structural problems with file/line evidence; (b) traced four shipped historical bugs to the same layer-synchronization root cause and explained the mechanism in each; (c) **corrected** the export-side slowness claim — Canvas2D *drawing* was never the bottleneck (measured 0.1% of frame time in `docs/phase-7-task-1-export-profiling.md`); the export cost is the readback→PNG→IPC architecture *around* the canvas plus `<video>`-element seeking, most of which commit `cd7ea2b` already addressed (pending re-benchmark). The WebGL rebuild's export value is architectural (a `VideoFrame`-native compositor an encoder can consume directly), not "faster drawImage."
- **Part 2 — Engine decision: WebGL2, with empirical feasibility spike on the real Tauri WKWebView.** Full evidence in Sections 2–3. Concrete outcomes:
  - Real WebGL2 context confirmed on the real Tauri WKWebView (macOS 26.5.2, Intel i9/UHD 630): `WebGL 2.0`, GLSL ES 3.00, `Apple GPU` renderer (ANGLE-on-Metal), max texture 16384.
  - **`VideoFrame` → `gl.texImage2D` upload confirmed working and fast on both engines** — 312/312 real decoded H.264 frames (the same `public/_spike/sample.mp4` asset and mp4box demux path the shipped decode pipeline uses), 0 GL errors, pixel readbacks non-black and varying across frames, matching Chromium's readback values within ±1: WKWebView ~531 fps single upload+draw, ~411 fps worst-case dual-upload+blend (two `texImage2D` uploads + blended draw per frame — the live-transition load); Chromium ~5,856 / ~3,165 fps.
  - **All 6 scoped effects compile and render pixel-correct as GLSL ES 3.0 shaders on both engines**: cross-dissolve, dip-to-black (progress 0.5 reads back exactly `[0,0,0]`), dip-to-white (exactly `[255,255,255]`), light-leak (screen-blend bloom measurably brighter at progress 0.5 than 0), zoom (UV-scale), color grading (brightness/contrast/saturation/temperature — brightness +0.3 raised center pixel 78→154, temperature shifted R up/B down).
  - **WebGPU data point, recorded accurately:** `navigator.gpu` IS present and `requestAdapter()` DOES return an adapter on this macOS 26.5.2 WKWebView (contradicting the researched claim that WKWebView doesn't ship WebGPU — at least on this OS version). WebGPU still loses on the install-base floor: it requires macOS 26 (Safari 26, shipped fall 2025), which would hard-exclude every not-yet-upgraded Mac in the 5–10 target channels. See Section 2.3.
  - Attribution rigor (same bar as the B0/audit spikes): bare `AppleWebKit/605.1.15` UA with no `Chrome` token (real WKWebView, not the Chromium preview pane — which was stopped before the run); app killed afterward and the exfil listener confirmed **zero** further posts in a 9s window; `tauri.conf.json`'s temporary `devUrl`/CSP edits reverted to zero git diff.
  - Spike harness **kept, committed** (`spike-webgl.html` + `src/dev/webglFeasibilitySpike/main.ts`), following the `f52ab12` precedent for retained investigation artifacts — justification in Section 8 (it must be re-run on macOS arm64 and Windows/WebView2, both still open).
- **Phase 1 — Core compositor module** (Section 6). Built `src/services/gl/{glContext.ts, shaders.ts, glCompositor.ts, compositeParams.ts}` as pure additive modules — zero imports from any existing app file (`grep -rn "services/gl/" src` outside the new directory returns nothing) and zero modifications to any tracked file (`git status --short` shows only the new untracked `src/services/gl/` directory). No `PreviewStage.tsx`/UI/EffectsPanel wiring, per this phase's scope. Concrete outcomes:
  - `glContext.ts`: `isWebGL2Supported()` (memoized, mirrors `webcodecsSupport.ts`'s `isWebCodecsPreviewSupported()` cache pattern exactly) + `acquireGlContext(canvas, options)`, which calls `canvas.getContext('webgl2', {...})` and wires `webglcontextlost` (`event.preventDefault()`, required by spec to keep the context restorable) / `webglcontextrestored` listeners via caller-supplied callbacks. Defaults `alpha: true` — documented rationale: image segments and possible future overlay-layer compositing (out of scope for this plan's scoped effects, but not architecturally precluded) may need per-pixel alpha, and the cost of `alpha:true` on otherwise-opaque video content is negligible.
  - `shaders.ts`: the exact 6 GLSL ES 3.0 shaders already pixel-verified on both engines by the Phase 0 spike (`src/dev/webglFeasibilitySpike/main.ts`) — promoted with cleaned-up comments, math unchanged, not re-derived: blit, cross-dissolve, dip (dip-black/dip-white share one shader via a `u_dipColor` uniform), light-leak (`progress*(1-progress)*4` bloom shaping ported verbatim from `frameRenderer.ts`'s `applyTransitionBlend` 'light-leak' case), zoom (`1.0 ± 0.05*t` ported verbatim from `canvasAnimations.ts`'s ZOOM_IN/ZOOM_OUT cases), color-grade (brightness/contrast/saturation/temperature, normalized-RGB math per Section 4's export-readiness constraint).
  - `glCompositor.ts`: `GlCompositor` class — `constructor(gl)`/private `setup()` compiles all 6 programs + the fullscreen-triangle VAO + 2 content texture slots (`'a'`/`'b'`); `uploadFrame(slot, source)` (`VideoFrame | ImageBitmap | HTMLImageElement`); `renderFrame(params: CompositeParams)` — synchronous, no rAF/async, a short fixed pass chain (transition-or-blit → zoom → grade) via a lazily-allocated, size-tracked ping-pong FBO pair, skipping offscreen passes entirely (straight to the canvas backbuffer) whenever zoom/grade are neutral; `handleContextRestored()` re-runs `setup()` and resets the render-target pair to force fresh allocation (old handles are invalid post-loss even though the same `gl` object reference survives restoration per spec); explicit `dispose()` deletes every program/texture/framebuffer/buffer/VAO it owns.
    - **Pass-chain design note, since it's new structure beyond what the spike tested:** the spike (Section 2.2) pixel-verified each of the 6 shaders standalone; it never chained one shader's output through an offscreen render target into another. The ping-pong FBO chain here was reasoned from the spike's single-pass throughput numbers (531–5,856 fps per pass, comfortably beneath the 30fps budget for up to 3 chained passes) and verified via the mock-based tests below for call-sequencing/resource-lifecycle correctness only — it has **not** been run against a real GPU. This is explicitly flagged, not claimed as pixel-verified; a manual real-Tauri-app check of the chained output is deferred to before Phase 3 integration.
      - **[CORRECTED 2026-07-10 — see "Phase 2 — Effects build-out" below, Step 1.]** This deferred check was run. The chain was not merely unverified — it was **broken**: every 2-draw chain (zoom-only or grade-only) rendered vertically flipped. Fixed same-day in commit `a92fc9a`, before any Phase 3 integration work began.
  - `compositeParams.ts`: `deriveCompositeParams(segments, currentTime, config)` — pure, no React/DOM/pool dependency (same role `toSourceTime`/`computeKeepSet` play for the decode side, `src/hooks/useWebCodecsPreview.ts`). Reuses `resolveEffectiveTransition` (`src/services/transitionResolver.ts`, imported unmodified) for transition selection so this can't drift from the legacy Canvas2D path's own selection logic, and replicates `useTransitionPreview.ts`'s active-blend window math (minus that hook's pre-roll/pool-prefetch bookkeeping, which is a preview-buffering concern, not a per-tick compositing one). Scoped to exactly the 4 transitions + 2 zooms Section 5 lists — a resolved legacy-enum transition, an unscoped slug, or any of the other 11 `AnimationType`s all resolve to `null`/neutral (`animScale: 1`) by design, since the GL compositor doesn't implement them. Deliberately does not decide which content belongs in texture slot 'a' vs 'b' — that's a Phase 3 integration concern.
  - **Tests: 51 new, 328/328 total repo-wide** (up from 277 pre-branch). `compositeParams.test.ts` (22 tests) — pure, mock-free, mirrors `useWebCodecsPreview.test.ts`'s `toSourceTime`/`computeKeepSet` style: ordinary mid-segment time (including outside-every-segment), transition progress at a window's start/mid/near-end, the exact-boundary edge case (a transition's `[start, start+duration)` window is half-open, matching `findContainingSegment`/`transitionResolver.ts`'s existing convention elsewhere in this codebase — exactly at the boundary belongs to the next segment), zoom scale at segment start/near-end for both zoom-in and zoom-out, legacy-`AnimationType`/unscoped-transition-slug fallback-to-neutral, `globalTransitionDuration` fallback plumbing, and grade passthrough (with and without a config override).
  - **Testing approach for `glContext.ts`/`glCompositor.ts` — option (a) chosen, not option (b):** hand-rolled mock `WebGL2RenderingContext`/canvas objects, mirroring `videoDecoderPool.test.ts`'s `MockVideoDecoder`/`MockVideoFrame` precedent exactly (a plain object satisfying only the interface subset actually called). Chosen because this repo's vitest was confirmed (not assumed) to run in plain Node — no jsdom, no `environment` key in any vitest config — so there is no real DOM/WebGL to test against under either option; the mock gives durable, automated, re-runnable coverage of call sequencing and resource lifecycle (program/texture/FBO creation counts, dispose cleanup, context-loss re-creation), which a throwaway browser harness (deleted before commit, per option (b)'s own description) could not provide on every future CI run. `glContext.test.ts` (14 tests): capability-check memoization/reset, `acquireGlContext`'s option defaults/overrides, listener registration, and — the **required forced-loss test** — a mock canvas that records registered listeners and lets the test invoke them directly to simulate `webglcontextlost` (asserting `preventDefault()` fires) and `webglcontextrestored` (asserting the callback fires), including a full loss→restore cycle in order. `glCompositor.test.ts` (15 tests): program/shader/geometry/texture creation counts on construction, compile/link failure surfaces a thrown error (no silent fallback, per the plan's no-fallback stance), `uploadFrame` texture routing, the pass-chain's draw-call count and render-target allocation for all 4 neutral/transition/zoom/grade combinations, render-target reuse-vs-reallocation on drawing-buffer resize, `handleContextRestored()` re-running full setup and correctly discarding (not reusing) stale render-target handles afterward, and `dispose()`'s deletion counts with and without render targets ever allocated. **What this does NOT prove** (stated explicitly, not silently skipped): real-GPU shader pixel-correctness — that remains the Phase 0 spike's job, already done for the 6 standalone shaders; the chained pass output specifically is unverified on real hardware (see the pass-chain design note above).
  - `tsc --noEmit`: clean. `vitest`: 328/328.
- **Phase 2 — Effects build-out (Section 6).** All 4 transitions + 2 zooms were already built behind the compositor API as part of Phase 1's actual implementation (`glCompositor.ts`'s 6 programs, `shaders.ts`'s 6 shaders) — ahead of Section 6's literal phase split. What Phase 2 closed out, in two steps, was the remainder of its own scope line: promoting the spike's pixel assertions into repeatable checks, and the image-segment texture path.
  - **Step 1 — real-GPU pass-chain correction (2026-07-10, commit `a92fc9a`):** before starting the rest of Phase 2, the pass-chain design note's open item (chained FBO output never run on a real GPU) was closed out with a throwaway real-GPU harness (never committed; deleted after use — see the last bullet below) instantiating the actual `GlCompositor` class on a real canvas, exercising 12 stage-combinations (1-draw skip path, 2-draw single-intermediate-stage, 3-draw full chain; video↔video, image↔image, and video↔image sources) with real decoded `VideoFrame`s and real `ImageBitmap`s, read back via `gl.readPixels`.
    - **Result: the chain was not merely unverified — it was actively broken.** Every 2-draw chain (zoom-only or grade-only, with or without an active transition) rendered **vertically flipped**; 1-draw (skip path) and 3-draw (transition+zoom+grade together) chains happened to render correctly by flip-parity coincidence, which is exactly why the bug survived Phase 1's mock-only test suite and would have survived a spot-check that only tried the "all three stages" combo.
    - **Root cause:** every program was linked against the same vertex shader (`VERTEX_SHADER_SOURCE`), whose Y-flip correctly compensates for `gl.texImage2D`'s upload orientation when a program samples `texA`/`texB` directly (`drawStage1`) — but incorrectly re-flips an already-correctly-oriented FBO render-target texture when sampled by `drawZoom`/`drawGrade`, which in this compositor's actual call graph only ever read `rt0`/`rt1`, never `texA`/`texB` directly (confirmed by grep before the fix — no call site was missed).
    - **Fix:** added `VERTEX_SHADER_SOURCE_STRAIGHT` (`shaders.ts`) — identical to `VERTEX_SHADER_SOURCE` except the single `v_uv.y` line — and relinked only the zoom/grade programs against it; `drawStage1`'s four programs (blit, cross-dissolve, dip, light-leak) keep the original flipped shader unchanged. Added a mock-based regression test (`glCompositor.test.ts`) asserting which vertex-shader source each of the 6 programs links against, so a future edit can't silently reintroduce the double-flip even though the mock can't render real pixels.
    - **Confirmed on both engines, same evidentiary bar as Section 2.2:** Chromium and the real Tauri WKWebView (bare `AppleWebKit/605.1.15` UA, no Chrome/Electron token; app killed afterward, exfil listener confirmed zero further posts in a 9s window; `tauri.conf.json`'s temporary `devUrl`/CSP edits reverted to zero git diff) — **12/12 combos pass on both, 0 GL errors**, pixel values matching cross-engine within ±1 (e.g. `baseline-blit-video` bottom-sample: Chromium `[63,44,41]`, WKWebView `[63,44,42]` — consistent within the same tolerance Section 2.2 established). `tsc --noEmit` clean, `vitest` 329/329 (up from 328 — the one new regression test).
    - Throwaway harness (`spike-webgl2-phase2.html`, `src/dev/webgl2ChainSmoke/main.ts`) deleted after use — unlike the Phase 0 spike (Section 8/9), this one has no open cross-platform re-run obligation: it validated compositor *logic* now permanently covered by `glCompositor.test.ts`'s mock suite, not a runtime capability floor that needs re-checking on arm64/Windows.
  - **Step 2 — promote pixel assertions to permanent coverage; image-segment texture path; boundary conditions (2026-07-10, pre-implementation plan reviewed and approved before writing any code).** Pre-flight established, and this step's tests confirm: the six pixel assertions (dip-black exact `[0,0,0]`, dip-white exact `[255,255,255]`, light-leak brighter-at-0.5, cross-dissolve non-black blend, zoom correct-content-at-scale, grade brightness/temperature shifts) needed **no further real-GPU work** — Phase 0's standalone spike plus Step 1's chained 12-combo real-GPU check together already closed pixel-correctness for all six, since a fragment shader's math is chain-position-agnostic (only orientation is chain-position-sensitive, and Step 1 fixed and proved that). This step's job was the mock-based counterpart Step 1 couldn't leave behind: program-selection/uniform-wiring regression tests (not pixel tests) in `glCompositor.test.ts` — asserting the right GL program is selected per resolved `TransitionSlug` and fed the right uniform values (`u_dipColor`, `u_progress`, `u_scale`, the 4 grade uniforms), including an explicit dip-black/dip-white non-confusion regression run back-to-back on one compositor instance (the same "shared mechanism, parameter-only difference" shape the vertex-shader flip bug was).
    - **`uploadFrame`'s actual shape corrected the task's own premise before any code was written:** it has no source-type branching at all (`VideoFrame|ImageBitmap|HTMLImageElement` all cast to `TexImageSource` and passed to one `gl.texImage2D` call — the browser's own overload handles the three kinds identically). So there was no "routing" branch to cover; the new tests instead lock in call-shape parity (each of the 3 source kinds reaches `texImage2D` identically, for either texture slot) plus two new pass-chain-shape tests for the actually-uncovered case: a mixed-source transition (slot 'a' `VideoFrame`, slot 'b' `ImageBitmap` — the video↔image case) and an image↔image transition, both asserting the same draw-count/render-target shape as the already-tested video↔video case.
    - **`compositeParams.test.ts`** extended (not a new file, matching its existing by-concern grouping) with: dip-black and dip-white reachability (neither was ever independently constructed as an output before — only `cross-dissolve`/`light-leak` were), the same dip-black/dip-white non-confusion regression at the `deriveCompositeParams` level (the `TransitionSlug` string itself, distinct from `glCompositor.ts`'s `u_dipColor` color-literal selection — both modules share the same "one mechanism, differentiated only by a parameter" shape and both now have a dedicated regression test), an epsilon-level adjacency case just before/after a transition window's close, and a combined transition+zoom-OUT+grade tick (the prior combined-tick test only ever exercised zoom-in; `resolveAnimScale`'s two branches are independent formulas).
    - **Tests: 21 new, 350/350 total repo-wide** (up from 329 post-Step-1). `tsc --noEmit` clean.
  - **"color segments" caveat, stated explicitly rather than silently claimed:** Section 6's Phase 2 line names "video↔image↔color segments." A color segment (a heading/no-asset segment rendered as a solid `backgroundColor` fill — confirmed against `types.ts`/`frameRenderer.ts`) is not a distinct code path at the compositor-API layer: `uploadFrame` has no source-type branching at all, so a solid color reaches the compositor exactly the way an image does — as an `ImageBitmap`/canvas rendered upstream, then uploaded via the same call path the image↔image and video↔image tests above already cover. There is no third path here for Phase 2 to test; producing that `ImageBitmap` from a color segment in the first place is a Phase 3 integration decision (which content feeds which texture slot — explicitly out of `compositeParams.ts`'s scope per its own doc comment). The clause is satisfied by subsumption, not by a separate test.
  - **Phase 2 verdict: complete.** All three Section 6 deliverables met (compositor API build-out, pixel assertions promoted to repeatable checks, image/color-segment texture path); no remaining real-GPU or mock-coverage obligation identified for this phase.

- **Transition-centering fix (2026-07-10) — closes D7 (project-state.md's Ignored Low Risk Bugs), a pre-existing bug not scoped to this plan's own phases.** All transitions previously played entirely AFTER the A/B boundary (window `[B.start, B.start+duration)`, a 100%-after/0%-before split — the "known 100/0-split timing question" Section 5.1 originally deferred). This was a **deliberate semantic change**, applied identically to preview and export so the two stay in parity: the window is now centered on the boundary, `[B.start - duration/2, B.start + duration/2)`, progress 0→1 linear across it, landing at exactly 0.5 at the boundary itself.
  - **Shared fix, one source:** `resolveTransitionProgress(boundaryTime, duration, currentTime)` added to `transitionResolver.ts` — the single centered-window arithmetic now used by `compositeParams.ts` (GL preview, dev-gated), `useTransitionPreview.ts` (legacy preview, the shipped default), and `segmentEncoder.ts` (native export, via a new `resolveBlendFrameParams` wrapping it for segment-local blend math). No independent hand-duplicated window math remains in any of the three.
  - **`compositeParams.ts` restructured:** `findContainingSegment`'s bounds-containment could no longer stand in for "the incoming side of the active transition" — under centering, the pre-boundary half of the window sits bounds-inside the OUTGOING segment. `resolveTransition`/`findPrevSegment` were replaced by `resolveActiveBoundary`, which iterates adjacent segment pairs directly (via a new `findNextSegment`) rather than inferring pairing from where `currentTime` happens to bounds-fall. Both `deriveCompositeParams` and `deriveSlotPlan` now call this one function, so the two can't disagree on which two segments are involved — `deriveSlotPlan` gained a required 4th `config` param as a consequence (it needs `resolveEffectiveTransition` to re-derive the pair, not just a null/non-null activation gate).
  - **`useTransitionPreview.ts` restructured:** the old "candidate A = pre-roll only, candidate B = the real active window" split (candidate A was NEVER blending, only pre-roll bookkeeping, because the window used to sit entirely inside candidate B's own span) now has candidate A become genuinely active — blending, not just pre-roll — for its own last `duration/2` seconds. `PRE_ROLL_LEAD_S` lead-in now triggers ahead of the (now-earlier) window open instead of the old window open.
  - **`segmentEncoder.ts`/`exportPipeline.ts`:** `startTimeOffset`/`trailingExtension` halved (each now `duration/2` instead of the full `duration`) since the blend zone straddles the boundary instead of sitting entirely past it. New `resolveBlendFrameParams(timeInSegment, segmentDuration, transitionDuration)` computes the blend zone in segment-local time; the incoming segment's rendered content is held at its own true `t=0` through the ENTIRE pre-boundary half (never asked to seek before its own official start — no source "handle" past `trimStart` required) and advances forward from 0 only in the post-boundary half. This intentionally matches `useTransitionPreview.ts`'s pre-existing static-snapshot design (which already held the incoming clip's frame-at-0 fixed through the whole window) — preview and export now agree on what the incoming side visually shows, not merely on the timing.
  - **Two downstream consumers in `PreviewStage.tsx` needed matching fixes, found only by tracing what "the transition window moved" actually breaks:** (1) the caption-hold logic (`captionSegment`/`findOutgoingSegment`, itself a Phase A3 fix) assumed `currentSegment` — bounds-based, computed independently — was ALWAYS the incoming side for a window's entire active life; under centering that's only true for the post-boundary half. Fixed by exposing `outgoingSegmentId`/`incomingSegmentId` from `useTransitionPreview.ts`'s return value (the exact pair it already resolved), consumed with the old predecessor-lookup kept only as the fallback for the trailing "hold" period (where the hook's own per-render candidates have reset). (2) The B3 WebCodecs live-incoming-frame upgrade (blitting `webCodecsPreview.frame` onto the incoming snapshot canvas when decode has "caught up") relied on the same assumption — without a guard it would have blitted the OUTGOING segment's own live frame onto the incoming canvas for the entire pre-boundary half, silently, every transition. Fixed with an explicit `currentSegment?.id === transitionPreview.incomingSegmentId` gate.
  - **Follow-up gap — now CLOSED (commit `1121b76`, "Bug 1 — WebGL2 preview video-video transition blend gap").** The GL preview driver's texture-slot sourcing (`resolveVideoFrame` in `useGlPreview.ts`) had no live-pull path for the incoming segment before `useWebCodecsPreview` considered it "current," so during the pre-boundary half it fell back to blitting slot 'a' alone (no blend) — a deterministic 0-then-50 video↔video split found only in real-app manual testing, not by the mock suite. Fixed by the symmetric incoming-side chase-pull anticipated here (mirroring the existing outgoing one), plus two flicker-removal refinements. **Full mechanism and manual-verification record live in `project-state.md`'s "Bug 1 — WebGL2 preview video-video transition blend gap" Completed Work entry** (single source of truth). Closes only this case — Phase 3's broader manual verification checklist is still un-run (see IN PROGRESS below).
  - Every existing test asserting the old anchored-at-B-start timing was rewritten (not merely relaxed) for the centered spec, plus new tests explicitly pinning 50/50 centering (progress exactly 0.5 at the boundary, for both the preview-side `compositeParams.test.ts` and the export-side new `segmentEncoder.test.ts`/`transitionResolver.test.ts`). `tsc --noEmit` clean, `vitest` full suite green (401/401 at commit time). Files touched: `src/services/transitionResolver.ts` (+test), `src/services/gl/compositeParams.ts` (+test), `src/hooks/useGlPreview.ts`, `src/hooks/useTransitionPreview.ts`, `src/services/segmentEncoder.ts` (+test), `src/services/exportPipeline.ts`, `src/components/PreviewStage.tsx`.

### 1. Root-Cause Audit — Why CSS/Canvas2D Effects Rendering Is Structurally Bug-Prone (Part 1)

The current effects engine is not one engine. Every visual effect exists as **two to three independent implementations across three rendering technologies** (DOM/CSS transforms via Framer Motion wrappers, Canvas2D `ctx` transforms, and offscreen-canvas snapshot blending), and those implementations are synchronized against playback state (play/pause/seek/boundary-crossing) by hand-written React effect choreography. Each finding below is evidenced from shipped code and this repo's own bug history.

#### 1.1 The dual-implementation problem: every animation exists twice

- **Preview:** `PreviewStage.tsx:54` (`getAnimationWrapperProps`) — 13 `AnimationType` cases emitting CSS `transform`/`opacity`/`filter` strings applied to a wrapper `motion.div` around the media element.
- **Export:** `canvasAnimations.ts:118` (`applySegmentAnimation`) — the same 13 cases as Canvas2D `ctx.translate/scale/rotate/transform` calls inside `frameRenderer.ts`'s per-frame render.

Two code paths, one visual contract, no mechanism enforcing they agree. This is not hypothetical drift — it shipped and had to be found by eye. **Phase A1** (2026-07-06, `docs/webcodecs-architecture-plan.md` Section 8.1 area) found and fixed exactly this class of divergence: preview's FLOAT ran a one-directional dip while export ran a bidirectional sine; preview's HEARTBEAT period was 1.5s vs export's 1.2s (visibly desyncing the same segment's preview from its own export); preview's SHAKE ran ~2.5Hz vs export's 10Hz; and preview's `repeat: Infinity` Framer keyframes free-ran on Framer's **wall clock** — ignoring pause, seek, and playback position entirely — while export was a pure function of frame time. A1's fix (share the math helpers, drive both from `timeInSegment`) narrowed the gap but did not remove the structure that produces it: the *property assignment* (CSS transform string vs `ctx` transform matrix) is still written twice, per effect, forever. The file header at `PreviewStage.tsx:33-40` now literally instructs future authors to hand-port each new animation between the two files — a standing invitation for the next A1.

The same duplication exists for transitions: `frameRenderer.ts:674` (`applyTransitionBlend`) is nominally shared by export and preview, but preview reaches it through an entirely different sourcing/compositing stack (Section 1.2), and for filters: preview applies CSS `filter` strings to elements while export sets `ctx.filter` — same string, different rasterizer, close-but-not-guaranteed-identical output.

#### 1.2 The dual video-sourcing problem: transitions blend stale pixels in preview, live pixels in export

Two fully independent video-frame-sourcing mechanisms are live in preview simultaneously:

- The **WebCodecs decode pool** (`videoDecoderPool.ts`) feeds ordinary playback — cheap per-tick `getFrameAt()` lookups once a window is warm.
- `frameRenderer.ts`'s **HTML5 `<video>`-seek cache** (`getOrCreateVideo`/`seekVideo`, `frameRenderer.ts:115/198`) feeds `useTransitionPreview.ts`'s transition snapshots — a seek-and-wait path costing **~200ms per video, ~400ms for the same-asset sequential fallback** (the hook's own `PRE_ROLL_LEAD_S` comment, `useTransitionPreview.ts:42-46`, documents these numbers; they're why pre-roll leads the window by 0.8s).

Because a ~200–400ms seek cannot run per render tick, `useTransitionPreview.ts` renders each boundary's outgoing/incoming frames to offscreen canvases **once** at pre-roll and blends those static snapshots as a pure function of `progress` for the whole transition window. That is the documented root cause of the "frozen transition frame" symptom (project-state.md / webcodecs-architecture-plan.md, "frozen transition frame audited, deferred to Phase B", 2026-07-06): the blend-draw loop reruns every tick, but the two source canvases it draws from never advance. Export never had this problem — `segmentEncoder.ts` renders every transition frame live via `renderSegmentFrame`, each sampling its own segment's advancing time — so preview and export disagree *by construction* during every transition.

The Item 4 B1–B3 fixes (shipped 2026-07-06) patched the outgoing side onto live pool pulls for WebCodecs-capable runtimes — at the cost of cross-hook plumbing (a second protected-session set in the pool, `pool`/`incomingFrame` params threaded through `PreviewStage.tsx`, reuse of another hook's chase-mutex primitives) layered **on top of** the still-present snapshot machinery, with image segments and the HTML5 path keeping frozen behavior by design. The result is a hybrid: one-shot snapshots + per-tick live pool pulls + a DOM overlay canvas + hold/release gating, coordinated across three hooks. B4 — the next patch on this stack — failed to fix its target symptom and surfaced an unrelated infinite-render loop, which is what triggered this plan.

A GPU compositor removes the *reason* the snapshot mechanism exists: both segments' frames are just two textures, uploaded per tick from the decode pool (the spike measured this exact worst case at ~411 fps on WKWebView — ~13× faster than the 30fps it needs to be), and the blend is one draw call.

#### 1.3 Why hand-synchronized DOM+CSS+Canvas2D layers are inherently fragile

At any moment during playback, the preview stage composites: the WebCodecs `PreviewCanvas` (or dual `<video>` slots on the legacy path), a first-frame-cache cover canvas, a transition-overlay canvas (z-45), Framer Motion animation wrapper divs (inner intra-segment + outer cross-segment), DOM caption/overlay/heading layers, and CSS filter styles. None of these share a clock or a compositor; every one has its own notion of "what time is it / which segment is current," updated by separate React effects with no ordering guarantee beyond what each fix hand-builds. Four shipped bugs are direct symptoms:

1. **D10 — black flash on video→video transition boundaries (fixed 2026-06-30).** The idle `<video>` slot was byte-preloaded but not pre-seeked, and the reveal was gated on `canplay` — an event that fires before the engine has *painted* a frame. The DOM gives no synchronous "a frame is now visible" signal, so the fix had to gate on `requestVideoFrameCallback` plus a `seeked`+rAF fallback plus a 400ms failsafe. Mechanism: **the layer being revealed and the layer being hidden have independent, unobservable paint states.** In a GPU compositor there is no reveal to gate — the next frame is drawn when its texture is ready, atomically, in one draw.
2. **D12 — preview/playhead jump on timeline resize-drag (fixed 2026-07-01, `be45b07`).** Beyond the ghost-click root cause, the fix required **three separate hardening guards in three different layers** — `PreviewStage.tsx`'s seek effect skipping while `isResizingRef` is true, `useTransitionPreview.ts` force-suppressing its window during a drag (because transient boundary geometry could sweep `currentTime` into a bogus transition window and swap in the *wrong segment's snapshot*), and `App.tsx` freezing `currentSegment` at the source. Mechanism: **every layer independently derives state from `currentTime`/`currentSegment`, so every layer needs its own defensive guard against transient inputs.** A single stateless `render(t)` function has exactly one place to guard.
3. **Bug 1 — transition flash-back S2→S1→S2 on cross-dissolve (fixed 2026-07-05).** A React effect/paint-ordering race: `PreviewCanvas`'s frame-draw was a passive `useEffect` (runs after paint) while the transition overlay's opacity was applied synchronously in the same commit — so the browser could paint the overlay fading out *before* the canvas underneath had redrawn, flashing the previous segment's stale bitmap. Fixed by converting to `useLayoutEffect`. Mechanism: **when "what's on screen" is the composition of multiple independently-painted DOM layers, correctness depends on React's effect-timing internals** — a category of bug that cannot exist when one draw call produces the whole frame.
4. **Item 4 B4 + the A-series residuals (the terminal incident, 2026-07-06/07).** After A1–A3 unified the animation clock and B1–B3 made the outgoing transition side live, the *interaction* of the remaining layers still produced the reported animation jump/disappear during transitions. The codebase at this point contains two independent hold/release state machines (overlay-canvas hold vs. animation-wrapper-transform hold — `computeOverlayHoldState` and `computeSnapReleaseBlend` in `useWebCodecsPreview.ts`, whose own doc notes they "remain independent"), a suppress flag (`suppressMotionAnim`) so the wrapper transform doesn't fight the overlay canvas, and a blend that reconstructs the frozen "from" pose by re-calling `getAnimationWrapperProps` with stale inputs. B4's overlay-parity patch on top of this did not fix the symptom and its testing surfaced an unrelated `usePlayback.ts` infinite-render loop. This is what "structurally bug-prone" means concretely: **each fix adds another state machine that future fixes must also synchronize with.**

#### 1.4 The export-side slowness claim — verified, and corrected

The claim "Canvas2D per-frame compositing makes export slow" is **wrong in its specifics and right in its architecture**, and the distinction matters for what this rebuild promises:

- `docs/phase-7-task-1-export-profiling.md` (measured, macOS Intel, 355-frame project): `renderDraw` — the actual Canvas2D compositing including filters, overlays, and animation transforms — was **0.3ms/frame, 0.1% of frame-loop time**. The bottleneck was everything around it: `toBlob` PNG encode 47.2%, `ipcWrite` 29.2%, `b64encode` 10.2%, `videoSeek` 13.3%.
- Commits **`cd7ea2b`** (worker-pool pipelined PNG encode + raw-binary IPC write — eliminates the base64 round-trip and moves PNG encode off-thread, overlapping it with the next frame's render) and **`d033cb1`** (isolated blend-video cache — removes the same-URL seek thrash during transition windows) landed 2026-07-09 and target exactly those measured costs. **No post-fix end-to-end benchmark has been run** (project-state.md's Quick Stats flags the old figures as stale), so the residual export cost is currently unquantified — but by the profile's own shares, the remaining structural costs are `videoSeek` (~57ms mean/frame, a `<video>`-element seek discipline the WebCodecs decode pool would replace with sequential decode) and whatever PNG/IPC cost pipelining couldn't hide.
- **Therefore this plan does NOT claim the WebGL compositor speeds up today's export path.** Swapping `ctx.drawImage` for a GPU draw inside the existing PNG→IPC→ffmpeg pipeline would save ~0.1% and add a GPU readback. The export value of this rebuild is architectural and conditional: a compositor whose input is `VideoFrame`s and whose output surface can feed `VideoEncoder` directly (Section 4) eliminates the PNG/disk/seek architecture *entirely* — but only once the separately-tracked, still-blocked `VideoEncoder` hang risk (project-state.md Active Tasks, "Export rewrite: WebCodecs pipeline") is resolved. Until then, export stays on the existing (now-faster) pipeline, untouched by this branch.

#### 1.5 Root cause, stated once

Effects are implemented N times across DOM/CSS, Canvas2D, and snapshot layers that each hold their own state and repaint on their own schedule, so every playback-state change (play/pause/seek/boundary/drag) must be manually re-synchronized across all of them — and each synchronization fix is itself a new layer to synchronize. The fix is not another patch; it is making the frame a **single pure function**: `composite(textures, t, params) → pixels`, evaluated once per tick on the GPU, identical for preview and (eventually) export.

### 2.2 Feasibility spike — empirical results (real runtimes, not assumptions)

**Harness:** `spike-webgl.html` + `src/dev/webglFeasibilitySpike/main.ts` (kept — Section 8). Method mirrors the WebCodecs plan's Phase 0 / WKWebView Cross-Check / B0-audit methodology: demux `public/_spike/sample.mp4` (real Pexels H.264 High-profile 1280×720/30fps asset with real B-frames, 312 samples) via mp4box exactly as the shipped `videoDemuxer.ts` does, decode via `VideoDecoder`, and for every decoded `VideoFrame`: upload via `gl.texImage2D(gl.TEXTURE_2D, 0, RGBA, RGBA, UNSIGNED_BYTE, frame)` and draw a fullscreen-triangle blit; frames 100–199 instead take the worst-case live-transition path (TWO uploads + a cross-dissolve blended draw). Pixel readbacks (`gl.readPixels`) at frames 10/100/250 prove real, varying, non-black content. Then all six scoped effects render with characteristic uniforms and are pixel-verified. Results exfiltrated via HTTP POST to a local listener (WKWebView has no automatable devtools); the definitive run executed inside the real Tauri app via a temporary `devUrl` repoint (reverted to zero diff).

**Chromium (this environment's preview pane, ANGLE Metal / Intel UHD 630) — 2026-07-10:**

| Check | Result |
|---|---|
| WebGL2 context | ✅ `WebGL 2.0 (OpenGL ES 3.0 Chromium)`, ANGLE Metal, max texture 16384 |
| `VideoFrame` → texture, 312 frames | ✅ 312/312, 0 GL errors, readbacks vary + non-black |
| Throughput | ~5,856 fps single upload+draw; ~3,165 fps dual-upload+blend |
| 6 effect shaders (7 programs incl. blit) | ✅ all compile, all pixel checks pass |
| `navigator.gpu` | present, adapter returned |

**Real Tauri WKWebView (macOS 26.5.2 Build 25F84, Intel i9 / UHD 630) — 2026-07-10, the definitive run:**

| Check | Result |
|---|---|
| Attribution | UA `Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko)` — no `Chrome`/`Safari` token (real WKWebView); Chromium preview pane stopped before the run; app killed afterward → **0** further exfil posts in 9s |
| WebGL2 context | ✅ `WebGL 2.0`, `WebGL GLSL ES 3.00`, unmasked `Apple Inc. / Apple GPU`, max texture 16384 |
| `VideoFrame` → texture, 312 frames | ✅ **312/312, 0 GL errors**; readbacks `[84,87,84]`/`[84,98,96]`/`[79,99,99]` at frames 10/100/250 — non-black, varying, matching Chromium's values within ±1 (cross-engine correctness, not just "no crash") |
| Throughput | **~531 fps single upload+draw (~1.9ms/frame); ~411 fps dual-upload+blend (~2.4ms/frame)** — 17.7×/13.7× the 30fps requirement; the dual number is the exact per-tick cost of a live two-sided transition |
| dip-to-black @ progress 0.5 | ✅ reads back exactly `[0,0,0,255]`; @ 0 reads texA content |
| dip-to-white @ progress 0.5 | ✅ exactly `[255,255,255,255]` |
| cross-dissolve @ 0.5 | ✅ non-black blended content |
| light-leak | ✅ screen-blend bloom brighter at progress 0.5 (745) than 0 (607) — the `alpha*(1-alpha)*4` shaping ported from `applyTransitionBlend` works as a shader |
| zoom (UV scale 1.5) | ✅ renders correct content |
| color grade | ✅ brightness +0.3: center 78→154; temperature +1: R up, B down |
| `navigator.gpu` | **present, adapter returned** (see 2.3) |

**What was empirically verified vs. researched/assumed:** everything in the two tables above is measured first-hand. NOT verified empirically (open, carried to Phase 6): macOS arm64 (this machine is Intel; no arm64 hardware in this session), Windows/WebView2 (no Windows machine; the Chromium result is a strong proxy since WebView2 is evergreen Chromium, but it is a proxy), and older macOS versions down to the 13.3 floor (this machine runs very current WebKit; WebGL2-on-WKWebView at 13.3–15.x is researched-only). Same residual pattern, explicitly, as the WebCodecs plan's Phase 0 left open — and resolvable with the same kept harness.


---

## WebCodecs Preview Migration Phases 0–8 (Archived)

> **Archived 2026-07-12** (Stage 3 doc cleanup), moved verbatim from `docs/webcodecs-architecture-plan.md`. This is the fully-complete **Phases 0–8** preview migration: the Progress Tracker plus detailed Sections 1–7, the Phase 0 Results, and the WKWebView Cross-Check. The live document retains only the active **Preview/Export Unification follow-on (Phases A–C)** and its **Section 8**. **Cross-reference note:** section numbers and named subsections cited below (“Section 1.6”, “Section 4”, “Section 5”, “Section 6”, “Section 7.1”, “Phase 0 Results”, “WKWebView Cross-Check”) refer to the original migration-plan numbering as reproduced verbatim in this block; “Section 8” and the Phases A–C follow-on remain live in `docs/webcodecs-architecture-plan.md`.

### Progress Tracker — Read This First

This section is the single source of truth for where this effort stands, independent of any chat session or Claude Code instance. Read this first before reading anything else in the document or in past chat history. The detailed sections below (numbered 1–7, plus "Phase 0 Results" and "WKWebView Cross-Check") hold the full reasoning and evidence — this tracker only summarizes and points to them; it does not replace their detail, and it is not itself a substitute for reading Section 5 before implementing a phase.

#### ✅ COMPLETED

- **Phase 0 — Proof-of-concept spike.** Full detail in the "Phase 0 Results" and "WKWebView Cross-Check" sections below. Concrete outcomes:
  - `VideoDecoder`/`EncodedVideoChunk` confirmed present and a real `configure()`/`decode()` cycle confirmed working, on **both** Chromium and the real Tauri app's WKWebView.
  - `mp4box.js` integrated as the demuxer (chosen per Section 1.4, no alternative needed). Two non-obvious integration bugs found and fixed — both documented inline in `src/dev/webcodecsSpike/main.ts` for whoever builds Phase 1: (1) calling `flush()` after a single whole-file `appendBuffer()` caused mp4box to discard buffered `mdat` bytes before extraction ran — fixed by calling `setExtractionOptions()`/`start()` from inside `onReady` and never calling `flush()` for a single-shot append; (2) `createFile()`'s default `keepMdatData: false` discards the bytes a non-streamed caller needs back — fixed with `createFile(true)`.
  - Decoded `VideoFrame`s paint correctly to canvas on both engines (312/312 real frames from a real Pexels H.264 asset, visually confirmed via screenshot on Chromium and via Console-log readback on WKWebView).
  - **B-frame reordering confirmed correct (monotonic presentation-order output) on both Chromium and WKWebView** — this was the single biggest open risk this plan flagged (Sections 1.1, 1.2, and the Section 6 risk register), and it is now resolved for both engines this app ships to.
  - Throughput measured: ~365–380 fps on Chromium, ~303 fps on WKWebView (both comfortably above 10× the source's 30fps — not a feasibility concern at this single-video scale; says nothing yet about Phase 6's multi-segment decode-ahead load).
  - **Read this if you find old logs/screenshots that look like a failure:** an intermediate WKWebView run appeared to show "Check 4: false" with "936 chunks fed" instead of the real 312. This was **never a WKWebView defect** — it was a test-harness bug (the harness's `result` object was declared at module scope and never reset between repeated manual "Re-run" clicks, so three runs' worth of samples concatenated into one array and broke monotonicity at the run boundaries, purely as an artifact of the harness, not the decoder). The harness was fixed (fresh `SpikeResult` object constructed inside every `runSpike()` call, plus a logged per-run invocation counter) before the clean, trusted result was captured. If you encounter any earlier artifact claiming WKWebView reordering failed, it predates this fix — trust the "Clean single-run WKWebView result" table in the "WKWebView Cross-Check" section instead, not any "936"/`false` reading.
  - Committed together with this tracker entry in the commit titled `docs+spike: Phase 0 WebCodecs feasibility spike complete (Chromium + WKWebView confirmed) + progress tracker` — run `git log --oneline -- docs/webcodecs-architecture-plan.md` for the exact hash (not embedded literally here since this tracker entry is itself part of that same commit's content).

- **Phase 1+2 (combined) — Single- and multi-segment WebCodecs playback, dev-toggle-gated, first real integration into `PreviewStage.tsx`.** Built per Section 3.2's module list; all five new files plus the `PreviewStage.tsx` integration are real, become-permanent code (not a throwaway harness like Phase 0), gated off by default. Concrete outcomes:
  - **`src/services/webcodecsSupport.ts`** — `isWebCodecsPreviewSupported()`, memoized `'VideoDecoder' in window` check, exactly as Section 3.2 specifies.
  - **`src/services/videoDemuxer.ts`** — wraps mp4box.js; `getOrCreateDemux(url)` caches one demux per unique asset URL (mirrors `frameRenderer.ts`'s `getOrCreateVideo` dedup pattern), returning `{ config, chunks, durationSec }`. Carries forward both Phase 0 spike fixes verbatim: `setExtractionOptions()`/`start()` called from inside `onReady` with no `mp4boxFile.flush()` call anywhere, and `createFile(true)` for `keepMdatData`.
  - **`src/services/videoDecoderPool.ts`** — `VideoDecoderPool` class; one `VideoDecoder` session per segment id, keyed and cached independently of the demux cache (so two segments trimming the same source file each get their own decode session/cursor). Decode-ahead scope is exactly "current + next segment" per Phase 1+2's stated scope, not the full seconds-windowed cache Section 4 describes for Phase 6 — each session decodes its whole trimmed frame range up front (capped at `MAX_SESSION_FRAMES` = ~600 frames as a safety net), and `getFrameAt()` closes every buffered frame it supersedes plus the previously displayed frame, immediately, every call. `releaseSession()`/`dispose()` close every remaining buffered `VideoFrame` and the underlying decoder. This whole-segment-up-front approach is a deliberate, documented simplification versus Section 4.2's rolling few-second window — correct and leak-free at today's typical segment lengths, but Phase 6 is expected to replace it with real LRU windowing before 500+ segment scale.
  - **`src/hooks/useWebCodecsPreview.ts`** — takes `segments`, `assets`, `currentTime`, and (deviation from the plan's literal wording, see below) `currentSegment` directly, plus an `enabled` flag. Implements Section 3.5's boundary-crossing model: releases any session that isn't the current or next segment, ensures a session for the current segment and preemptively for the next, and pulls the frame at the current playhead's mapped source-time out of the (already warm) current session. `enabled: false` makes the hook fully inert (no session creation, no decode) — this is what keeps the new path from ever activating for a real user when the dev toggle is off, even on a WebCodecs-capable runtime.
  - **`src/components/PreviewCanvas.tsx`** — minimal, as scoped: draws whatever `VideoFrame` it's given via `object-cover`-equivalent crop math, accepts an optional `style` prop so the existing CSS clip-effect filters keep applying. No overlays/filters/animations/captions baked in (Phase 5, per the plan).
  - **`PreviewStage.tsx` integration** — a **scoped** branch, not a wholesale top-level duplicate of the ~1000-line component. `isWebCodecsPreviewSupported() && webCodecsDevToggle` (persisted to `localStorage['kinetix:dev:webcodecsPreview']`, toggled via a dev-only floating button, `import.meta.env.DEV`-gated) gates: (1) a single early-return line inside the existing dual-`<video>`-slot segment-change effect (`if (useWebCodecsPathRef.current) { setCoverState(null); return; }`, read via ref so toggling mid-session doesn't need a `currentSegment` change to take effect) so the legacy machinery stops touching the `<video>` elements for a video segment when the new path owns it, and (2) an additional `<PreviewCanvas>` layer painted above the (now-inert) legacy video slots and cover. Everything else in `PreviewStage.tsx` — heading rendering, captions, extra overlays, the transition overlay canvas, fullscreen, corner stats — is untouched and shared by both paths. This is a deliberate interpretation of Section 3.3's "capability-gated branch" language: Section 3.3 itself says "actual line-level changes happen gradually across Phases 1–7, not in one shot," and overlays/captions/headings are explicitly out of scope until Phase 5, so branching only the video-paint mechanism (rather than duplicating ~1000 lines of unrelated JSX two ways) keeps the legacy path's behavior verifiably unchanged by inspection while still satisfying "new path only activates when both capability and dev toggle are true."
  - **Deviation — `useWebCodecsPreview.ts` takes `currentSegment` as a parameter instead of re-deriving it from `segments`/`currentTime`.** Documented in the hook's own file header. Reason: `App.tsx` already computes `currentSegment` via `useMemo` with resize-drag-freeze semantics (`isResizingRef`/`lastStableSegmentRef`, see CLAUDE.md's App.tsx entry) and passes it down to `PreviewStage.tsx` as a prop; re-deriving it with a plain `.find()` inside the new hook would silently diverge from that during a timeline resize-drag — the exact class of bug the D12 fix (`be45b07`) exists to prevent for the legacy path. Taking the already-correct value as a parameter avoids reintroducing that bug class in the new path.
  - **`useTransitionPreview.ts` compatibility (Section 3.3's open question) — confirmed compatible, zero changes needed.** `useTransitionPreview` never reads from `useWebCodecsPreview`'s frame output or from `PreviewStage`'s `<video>` slots at all — it renders its own outgoing/incoming snapshots independently via `frameRenderer.ts`'s `renderSegmentFrame()` (which seeks its own offscreen `<video>` elements via `getOrCreateVideo`, a completely separate code path from both the legacy dual-slot machinery and the new WebCodecs decoder pool). Since `frameRenderer.ts` is on this plan's explicit do-not-touch list, `useTransitionPreview.ts` is guaranteed byte-for-byte unmodified in behavior regardless of which video path is currently painting the live segment. Verified in the manual test below: transitions were not exercised (test fixture used `TransitionType.NONE`), but the code-path independence is structural, not timing-dependent — no further validation is needed to trust this finding. Section 3.3's speculative "may need a WebCodecs-aware variant" concern does not apply; no fix is needed, now or in a later phase, for this specific compatibility question.
  - **Unit tests** — `src/services/videoDemuxer.test.ts` (4 tests: `createFile(true)` called, `setExtractionOptions()`/`start()` sequencing from `onReady` with implicit flush()-regression protection since the mock has no `flush` method to call, per-URL caching, reject-without-poisoning-cache on a trackless asset) and `src/services/videoDecoderPool.test.ts` (10 tests: `findChunkRange`'s keyframe-backup/margin/empty-list logic, plus `VideoDecoderPool` frame selection, supersession-closes-the-old-frame, `releaseSession`/`dispose` closing every buffered frame and the decoder, and `ensureSession` idempotency/replacement). All mock-based (`vi.mock('mp4box', ...)`, a hand-rolled `MockVideoDecoder`/`MockVideoFrame`, no real video files) — 16 new tests, all passing. Full suite: 76/76 passing, `tsc --noEmit` clean.
  - **Manual verification (Chromium, via this environment's browser-preview tooling)** — a real two-segment project was fabricated (both segments trimming different halves of the same real Pexels H.264 asset from the Phase 0 spike, `public/_spike/sample.mp4`, via a direct IndexedDB + localStorage fixture — no UI file-upload automation was available in this environment) and driven through the actual running app:
    1. Toggling the dev flag ON showed the "WEBCODECS PREVIEW (DEV)" badge and produced a canvas with real, non-blank decoded pixel data (sampled via `getImageData`) — confirmed via console log inspection that only one `fetch` of the shared source asset occurred despite two segments referencing it (demux cache dedup working) and zero console errors.
    2. Clicking to segment 2's start (t=5.00s, the segment boundary) showed a **different** decoded frame than segment 1's frame (confirmed via pixel sampling), with no black flash and no console errors — Section 3.5's boundary-crossing model verified working end-to-end in the real app for the first time.
    3. Toggling the dev flag OFF immediately reverted to the legacy dual-`<video>`-slot rendering (badge disappeared, correct frame still displayed, playback still functioned), confirming zero regression to the default path.
  - **What was deferred / simplified, on purpose, per the judgment calls this task authorized:**
    - Real seconds-windowed decode-ahead + LRU eviction (Section 4) — not built; Phase 1+2 uses whole-segment-up-front decode (see `videoDecoderPool.ts` note above). Explicitly Phase 6 scope per the plan's own phase breakdown.
    - Scrubbing/rapid-seek robustness (Phase 4) — `useWebCodecsPreview.ts` will correctly decode a fresh session if `currentTime` jumps to an untracked segment (since `ensureSession` is keyed by segment id + range), but rapid back-and-forth scrubbing within a session's already-decoded range hasn't been stress-tested; that hardening is explicitly Phase 4 scope.
    - Overlays/filters/animations/captions on the canvas path (Phase 5) — not built; `PreviewCanvas.tsx` paints the bare frame only, exactly as scoped. The surrounding DOM layers (captions, extra overlays, headings) still render correctly since they're shared, untouched code — only the video pixels themselves come from the new path.
    - Long-run audio/drift hardening (Phase 3) — not exercised beyond the ~10s manual test above; dedicated long-timeline drift testing remains Phase 3 scope.

- **Phase 3 — Audio-sync integration hardening.** `usePlayback.ts` confirmed unmodified (diff-checked before and after this phase). Concrete outcomes:
  - **Tolerance defined and verified: one source-frame duration (1/fps — ≈0.033s at the sample asset's ~29.97fps).** This is not an arbitrary choice — `videoDecoderPool.ts`'s `getFrameAt` has always resolved "the latest decoded frame at or before the requested target," so the best any currentTime→frame mapping can do is bounded by the gap between two consecutive decoded frames. `toSourceTime`/`sourceRange` (`useWebCodecsPreview.ts`) are pure, stateless functions — every call recomputes purely from the segment object and the `currentTime` value handed in, with no accumulator or internal clock — so there is no mechanism by which repeated calls over a long playback run could accumulate drift; each call is independently correct to within that one-frame bound or it is wrong outright (a mapping bug), never "slightly more wrong than last time." This is proven directly (not just argued) in `src/hooks/useWebCodecsPreview.test.ts`'s "long-timeline, no accumulating drift" tests, which simulate a steady 60fps tick across a synthetic 10-minute, 8-segment timeline and assert zero growth in mapping error.
  - **Long-timeline drift — verified via the stateless-mapping tests above, not a real long-duration asset.** Scope limitation: this repo's only available real test asset is the Phase 0 spike's `public/_spike/sample.mp4` (10.4s, H.264, 1280×720, ~29.97fps). There is no multi-minute real asset available in this environment to drive an actual wall-clock long-run. Given `toSourceTime`/`sourceRange` are pure and stateless (no per-tick accumulator anywhere in the currentTime→frame path), a synthetic long-duration test of the mapping math is representative of the real risk (accumulating error), which by construction cannot occur here — but this has not been confirmed by an actual multi-minute decode run against real video data (decoder throughput/memory behavior over minutes of real frames, as opposed to the mapping math, remains empirically unverified). Flagged as a residual scope limitation for whoever next has access to a longer real asset, or for Phase 6's synthetic 500-segment project work, to close.
  - **Play/pause/scrub interleaving — verified manually and via tests.** Manually: built a real 6-segment, ~10.4s fixture from `sample.mp4` (via direct IndexedDB/localStorage injection, same approach as Phase 1+2's manual test) with three consecutive short segments (1.1s/1.2s/1.3s, matching the original cold-start bug's scale) in the middle. Played the full timeline start-to-finish (loops back to 0 cleanly, matching `usePlayback.ts`'s no-voiceover end-of-timeline behavior — this repo has no long/short voiceover asset available either, so the no-voiceover `setInterval` clock path was exercised rather than the rAF/audio-clock path; the two paths differ only in how `currentTime` advances, not in how this hook consumes it, so this is not expected to be a meaningfully different case for the hook, but is noted as the same asset-availability limitation as above). Paused mid-segment and resumed repeatedly, including one resume that landed inside a short segment shortly after a boundary crossing — no stale frame, no skip-ahead, no re-decode glitch, zero console errors across the whole session. Proven structurally via `useWebCodecsPreview.test.ts`'s "pause/resume" tests: a `currentTime` held constant across repeated calls (simulating a pause of any length) always maps to the identical source time, and a resume at the same or a nearby `currentTime` maps correctly relative to it — there is no timer or interval owned by this hook that could produce a "stale" or "skipped" read independent of what `currentTime` itself reports.
  - **playbackRate / speed changes — investigated; no code change needed; finding documented in `useWebCodecsPreview.ts`.** Two speed knobs exist in this codebase: `globalPlaybackSpeed` (per-project) and `segment.playbackSpeed` (per-segment). Investigation finding, added as a comment directly on `toSourceTime`: `globalPlaybackSpeed` needs no reinterpretation in the WebCodecs path because this hook has no internal clock to keep in step with real wall time — every call is a pull ("what frame corresponds to this `currentTime`"), and `currentTime` already reflects whatever real-time pace `usePlayback.ts`'s `audioRef.current.playbackRate = globalPlaybackSpeed` produces. The legacy `<video>`-element path needs `activeEl.playbackRate = segment.playbackSpeed * globalPlaybackSpeed` (`PreviewStage.tsx`) only because a `<video>` element runs its own internal clock that has to be told to advance at the same real-time pace — a problem this hook does not have. `segment.playbackSpeed` (the per-segment source-time stretch) was already correctly handled pre-Phase-3, unchanged in this phase. **Scope limitation discovered during investigation, not introduced by it:** as of this phase, `globalPlaybackSpeed`'s setter (`setGlobalPlaybackSpeed`, `App.tsx`) is never called from any UI control — the feature is fully unwired app-wide (consistent with the `MIN_PLAYBACK_SPEED`/`MAX_PLAYBACK_SPEED` "UI is hidden — feature deferred" comment at `App.tsx`), and the per-segment `editingSegment` modal that exposes `segment.playbackSpeed`'s +/- controls is likewise never opened by any reachable click handler in the current build. Neither speed control could be manually exercised live, in-app, for this reason (pre-existing to this phase, not a regression). Verified instead via: (a) the architectural analysis above, (b) direct unit tests of `toSourceTime` reacting correctly and immediately to a changed `segment.playbackSpeed`, and (c) a manual end-to-end check with a segment's `playbackSpeed`/`trimEnd` pre-set to 2×/6.9s in the fixture (not changed live) — played across its boundaries cleanly with no errors, confirming the wider-than-1:1 decode range this produces (`sourceRange`) decodes and paints correctly.
  - **Rapid segment-boundary crossing (short segments, ~1.09-1.3s range) — one real fix made, in `videoDecoderPool.ts`.** Static analysis of the pre-Phase-3 code found the boundary-crossing/eviction/generation-guard logic already correct (no frame is ever shown for the wrong `currentTime`, verified by tracing every `await` point in `startSession`/`getFrameAt`/`ensureSession`/`releaseSession` against every interleaving a fast crossing could produce) — but found one real latency defect: `getFrameAt` unconditionally awaited the *entire* session's decode (`session.ready`, i.e. every frame up to `MAX_SESSION_FRAMES`) before returning a frame, even when the frame answering the current query had already arrived. For a short segment whose decode-ahead hadn't finished by the time playback reached it, this meant freezing on the outgoing segment's last frame for the *whole remaining decode* of the next one, not just until its own target frame was ready — exactly the "falls behind" failure mode this item asked to be hardened against. **Fix:** added `VideoDecoderPool.waitForCoverage()` — `getFrameAt` now resolves as soon as a frame strictly past the requested target has been buffered (which fully determines the "latest at-or-before" answer), falling back to waiting for the full session only when the target is beyond everything decoded so far. `releaseSession`/`closeSession` explicitly settle any in-flight waiters (returning `null`, matching existing behavior) so a session evicted mid-decode by a fast crossing can never leave a caller hanging. Regression-tested in `videoDecoderPool.test.ts` with a new `ControllableVideoDecoder` mock that separates `output` events from `flush()` settlement (the existing `MockVideoDecoder` couldn't represent this — it always emits everything synchronously inside `flush()`, which is exactly why every pre-Phase-3 test hit the fast path and never exercised this bug): one test proves the pre-fix code times out (verified by temporarily reverting the fix and confirming the exact new test fails on a 3s timeout, then re-confirming it passes with the fix restored — not just "written to pass"), plus tests for the exactly-at-target boundary case and for eviction settling a pending call. Manually verified end-to-end: the three consecutive short segments (1.1s/1.2s/1.3s) in the fixture above played through with no visible freeze or console error, both at 1× and with one of them reconfigured to a 2× per-segment `playbackSpeed` (wider decode range, same short on-timeline duration).
  - **Testability refactor (no behavior change):** `toSourceTime`, `sourceRange`, and a new pure `computeKeepSet()` (extracted from the eviction effect's inline `Set` construction, same logic, just named and exported) are now exported from `useWebCodecsPreview.ts` — this repo has no React hook-testing harness (`jsdom`/`@testing-library/react` are not installed, and this phase deliberately did not add them, consistent with "mirroring the mock approach already used in Phase 1+2's `videoDecoderPool.test.ts`" rather than introducing new test infra), so the currentTime-to-frame mapping and the boundary-crossing keep-set are tested as pure functions directly rather than through a rendered hook.
  - **New tests:** `src/hooks/useWebCodecsPreview.test.ts` (18 tests — long-timeline/no-drift, pause/resume, speed-change-invariance, rapid short-segment mapping, `computeKeepSet` eviction policy) + 4 new tests in `src/services/videoDecoderPool.test.ts` (early-coverage resolution, still-waits-when-uncovered, release-settles-pending-waiter, exactly-at-target). Full suite: 95/95 passing (was 76/76 before this phase), `tsc --noEmit` clean.
  - **Manual verification (Chromium, via this environment's browser-preview tooling)** — real 6-segment fixture built from `public/_spike/sample.mp4` (same fixture technique as Phase 1+2): full playthrough start-to-finish with no errors; seek-to-segment + pause + resume repeated across several segments including short ones; a segment's `playbackSpeed=2`/wider `trimEnd` variant played cleanly across its own boundaries. Toggling the dev flag on/off confirmed the badge and canvas behavior matched Phase 1+2's already-verified findings (not re-litigated here). No console errors, no failed-request anomalies beyond the pre-existing, unrelated `useFirstFrameCache.ts` offscreen-video abort noise (present on `main` today, not introduced or touched by this phase).
  - **What remains explicitly out of scope / carried forward:** real multi-minute asset drift validation (scope limitation above, no such asset available in this environment); scrubbing/rapid-seek stress (unchanged from Phase 1+2's note — still Phase 4); the `MAX_SESSION_FRAMES` (600-frame) cap can still under-decode a segment whose `duration × playbackSpeed` source range exceeds ~20s at 30fps, freezing on the last decoded frame for the remainder — this is pre-existing, orthogonal to the four items this phase targeted (it's about segment *length* combined with per-segment speed, not `globalPlaybackSpeed` or boundary-crossing pacing), not hit by this app's typical short/voiceover-paced segments, and squarely Phase 6's real-windowing scope to fix properly rather than a band-aid here.

- **Phase 4+6 (combined) — Scrubbing/seeking support + frame cache/eviction for 500+ segment scale.** `videoDecoderPool.ts` rewritten (Phase 1-3's whole-segment-up-front decode model replaced outright, not extended) per Section 4's exact design; `useWebCodecsPreview.ts` updated to drive it. Concrete outcomes:
  - **Windowed decode-ahead (Section 4.2).** A session no longer decodes its entire trimmed range up front — it feeds the decoder a rolling `WINDOW_AHEAD_SEC = 1.5`s window around whatever source time was last requested, extending forward as playback advances (no reset needed for steady progress) and re-seeding to the nearest keyframe on a genuine jump (see below). Verified via a new `makeLongDemuxed()`-based test suite: a 6-second/180-frame synthetic segment feeds only ~45 frames (one window) up front, not all 180 — the exact scaling property Section 4.1 needed (memory bounded by window size, not segment length).
  - **Scrub-seek reset, both directions.** `needsReset()`/`resetSessionWindow()` detect when a requested target falls behind what's still retained (backward scrub) or beyond the fed-plus-lookahead frontier (a jump bigger than steady playback ever produces), and re-seek to the nearest keyframe at-or-before the new target rather than decoding everything in between. This also **fixes a real pre-existing correctness bug**: the Phase 1-3 model's per-call eviction (close every frame older than the current selection) had no way to answer a backward-scrub query once those frames were closed — it would have silently returned a later, wrong frame. Now regression-tested directly (`videoDecoderPool.test.ts`'s "re-seeks correctly on a backward scrub" test) and confirmed via a from-scratch reset trace that a large forward jump feeds roughly one GOP's worth of new chunks, not everything between the old and new position.
  - **LRU eviction across all sessions, not just hard-release-outside-current/next.** `setProtectedIds()` marks {current, next} as exempt; anything else is eligible once the pool exceeds `MAX_CACHED_SESSIONS = 3` or `MAX_TOTAL_BUFFERED_FRAMES = 150` (Section 4.3's literal "3 segments' worth of window" starting point), evicted least-recently-used first. This is *more* permissive than Phase 1-3 (which released non-current/next immediately) — deliberately, per the Section 6 risk register's own instruction to design the window/eviction policy against scrub-stress from the start: a small number of recently-visited-but-not-current sessions now survive long enough that back-and-forth scrubbing across neighboring segments doesn't force a cold reseek every time.
  - **Decoder-instance reuse by asset id (Section 4.2, previously only achieved for the demuxer).** A small per-asset-URL idle pool of `DecoderHandle`s: a released (non-errored) decoder is `reset()` and parked for the next session needing the same asset, instead of being closed and reconstructed. Because a real `VideoDecoder`'s `output`/`error` callbacks are fixed at construction, reuse is implemented via a stable per-handle wrapper callback that dispatches to whichever session currently owns the handle (`handle.activeSession`), proven correct via a "same decoder instance reused" test and a "does NOT share a decoder between two simultaneously-active sessions of the same asset" test.
  - **A real concurrency bug found and fixed during this rewrite:** a session evicted while its own `feedWindow()`/`flush()` batch was still in flight could have its decoder handle handed to a brand-new session before the old batch's output was guaranteed to have stopped — `closeSession()` now closes such a handle outright instead of pooling it for reuse, accepting the lost reuse opportunity in that one case in exchange for correctness. Documented inline in `videoDecoderPool.ts`.
  - **`VideoFrame.close()` discipline audited and extended**, not just carried forward: eviction now closes every buffered frame of an evicted session (proven via a dedicated test asserting frames *ahead* of the display position — not just the displayed one — get closed too), and the decoder-handle idle pool is bounded (`MAX_IDLE_DECODER_HANDLES_PER_ASSET = 2`) and fully drained on `dispose()`.
  - **Scrub coalescing (Phase 4, Part A).** Timeline.tsx's mousemove-driven drag-to-seek calls `onSeek`/`setCurrentTime` synchronously and unthrottled (confirmed by reading the file — not touched, per the file-scope restriction), so a fast drag can produce dozens of `currentTime` updates per second. `useWebCodecsPreview.ts`'s frame-pull effect no longer issues one `pool.getFrameAt` call per tick; it records the latest requested target and runs a "chase latest target" loop (`chaseLatestTarget`, extracted as a pure, directly-testable function) that keeps at most one decode call in flight, always chasing the newest position — every intermediate scrub position in between is skipped rather than separately decoded. A real VideoDecoder decode can't be cancelled once issued, so this is what "deprioritize decode work for positions the playhead has already moved past" means in practice.
  - **A real deadlock found and fixed in the coalescing mutex.** An earlier version reset the "chase in flight" mutex only when a staleness (generation) check passed — mirroring the guard used to avoid *painting* a stale result, but wrongly applied to the *mutex release* too. Since the mutex already guarantees at most one chase is ever in flight, gating its release on anything else could leave it permanently stuck `true` if a segment change happened while the chase was still resolving — freezing the WebCodecs canvas permanently (found via manual scrub-stress testing: canvas went black mid-playback and never recovered, no thrown error). Fixed by extracting the mutex logic as its own function, `startChaseIfIdle`, whose release is unconditional; pinned directly with a dedicated regression test ("releases the mutex even when onSettled reports the caller considers its own result stale — the exact deadlock scenario").
  - **A real crash found and fixed in `PreviewCanvas.tsx`.** Under load, a `VideoFrame` handed to the component via props could be closed (by pool eviction/scrub-reset elsewhere) before the paint effect actually ran `ctx.drawImage`, throwing `"Failed to execute 'drawImage' ... The VideoFrame has been closed"` and crashing the whole preview via `ErrorBoundary`. This is an inherent hazard of any pool-managed `VideoFrame` crossing an async render boundary, not a bug isolable to one call site — fixed by treating a closed-frame draw as "nothing to paint this tick" (try/catch around the draw, plus a `0x0`-dimension check for engines that report a closed frame's size as zero instead of throwing) rather than trying to eliminate the race at its source.
  - **Cold-scrub initial-window seeding.** `ensureSession()` gained an `initialTargetSec` parameter (defaults to the segment's own start): the *current* segment's decode-ahead call seeds its first window at the actual playhead position (read once, at the render where `currentSegment` itself changed) instead of the segment's start, so a cold scrub landing mid-segment doesn't waste a decode-from-start pass immediately superseded by a reset. Decode-ahead for the *next* segment still seeds at its own start (correct for normal forward-boundary-crossing).
  - **Synthetic 500-segment fixture — `src/dev/buildScaleFixture.ts` (new, reusable for Phase 8 per the plan).** Not imported by any real app file (same throwaway-tool convention as Phase 0's spike). Builds and persists a project with N segments (exercised at 500), all sharing one `Asset` (the Phase 0 spike's `public/_spike/sample.mp4`, 10.4s H.264 — **scope note, same limitation as Phase 0/3: no other/longer real video asset is available in this environment**, so segments cycle through ~17 rotating `[trimStart, trimEnd]` windows of the same 10.4s source rather than each having distinct real footage), and sets it as the last-opened project so a reload opens it directly. Invoked via dynamic `import()` from the browser devtools console against the running dev server.
  - **Manual verification (Chromium, via this environment's browser-preview tooling), and where it stopped.** Early in this testing session, cold scrub-seeks to arbitrary, never-visited positions across the real 500-segment/300s fixture were confirmed working end-to-end via screenshots (correct, distinct decoded frames painted at both t=172.38s and t=66.42s, no black flash, no console errors) — this is the same class of verification Phase 1+2 did at 2-segment scale, now confirmed at the target 500-segment scale. Memory was measured via `performance.memory` across repeated scrub-stress rounds: a narrow-band rapid back-and-forth thrash (the case the windowed/LRU model specifically targets) cost **~2.4MB** above a ~36MB baseline and stayed flat; a full-timeline wide sweep touching most of the 500 segments peaked **~22.5MB** above baseline and settled back down to baseline within a few seconds of the scrubbing stopping in every trial — no unbounded growth, consistent with the windowed+LRU design. **However**, later in this same long session — after very heavy, sustained, repeated stress testing (many fixture reloads, many full-timeline sweeps, hundreds of `VideoDecoder` constructions) — this specific browser session's video decode pipeline degraded to the point where even a bare, app-code-free `new VideoDecoder().configure()+decode()+flush()` call (no app code involved at all) hung indefinitely and never produced output. This was confirmed to affect the pre-existing, unrelated `useFirstFrameCache.ts` legacy `<video>`-element mechanism identically, and to persist across page reloads and across restarting the dev preview server — implicating the underlying browser/GPU process on this machine from cumulative decode load across the session, not application code. **This means the two bug fixes above (the crash and the deadlock) were verified correct by code inspection, targeted unit tests, and the mechanism's proven-working state earlier in the same session, but could not get a final clean end-to-end re-confirmation after being applied, in that session.**

  - **Fresh-session re-verification (2026-07-04) — both fixes confirmed holding.** A genuinely fresh dev server and fresh browser session were started (not a reload of the degraded session above) specifically to rule out that prior finding. The exact sequence was re-run: rebuilt the real 500-segment/300s fixture via `buildScaleFixture(500)`, toggled the WebCodecs dev flag on, and let `useFirstFrameCache`'s warm-up run to completion undisturbed (498-500/500 frames cached, matching the earlier clean run) before any stress. Heavy, sustained scrub-stress was then driven via synthetic `mousedown`/`mousemove`/`mouseup` sequences on the timeline (the same code path a real drag exercises, since `Timeline.tsx`'s handler is unthrottled and synchronous): 7 rounds of narrow-band boundary-crossing thrash (~4s bands centered on 7 different timeline positions including the very start and end, ~1050 dispatched moves total), multiple full-timeline wide sweeps end-to-end (0→300s and back, ~245 dispatched moves), and an interleaved tight-thrash/random-wide-jump round (~800 dispatched moves) — roughly 2,100 scrub events in total, well beyond the load that originally surfaced both the crash and the deadlock. Result: zero crashes, zero frozen/black canvas, zero console errors or warnings at any point (only the pre-existing, unrelated `useFirstFrameCache` `//FFCACHE` diagnostic logging and its already-documented blob-fetch abort noise appeared). Playback was resumed after the stress sequence (seek + spacebar play) and advanced correctly across multiple segment boundaries with correct, changing decoded frames and no residual errors. `performance.memory` stayed in a bounded ~34-40MB band throughout the entire session (fixture-load baseline ~13MB → post-warm-up ~40MB → after all stress rounds, settled ~37MB) — a narrow-band thrash round measured in isolation cost **~4.6MB** above its immediate pre-thrash reading (same single-digit-MB order as the original ~2.4MB reading; heap-measurement noise accounts for the difference) and stayed flat afterward, with no unbounded growth observed across the whole run. This confirms the VideoFrame-closed-before-paint crash fix and the scrub-coalescing mutex deadlock fix both hold under fresh-session conditions, closing the residual verification gap the previous session's browser/GPU degradation had left open. Full unit suite re-confirmed **113/113 passing**, `tsc --noEmit` clean.
  - **Cold scrub-seek latency target: under ~250ms to first correct frame.** Derived from Phase 0's measured decode throughput (~300-380fps) applied to one window's worth of frames (~45 @ 30fps ≈ 120-150ms of pure decode compute) plus keyframe-seek overhead — not independently stopwatched in this session, because this environment's canvas pixel readback (`getImageData`) returned all-zero data even for content visibly correct in screenshots (confirmed via a direct pixel-value check against known-visible content), which is what a frame-arrival timing probe would have needed; this is a tooling/sandboxing limitation of this specific preview environment (canvas readback is a common target for privacy/fingerprinting protections in automated browser contexts), not a product issue — `drawImage`-for-display (unlike readback) is unaffected and is what all the screenshot-based correctness verification above relied on.
  - **Section 4.3 estimate vs. measured reality.** The plan's own rough estimate ("~360MB worst case if every frame were kept simultaneously... realistic target closer to tens of MB") is **confirmed and refined**: measured deltas were single-digit-to-tens of MB (2.4MB narrow-band, 22.5MB full-sweep peak), an order of magnitude better than the 360MB worst-case and squarely in the "tens of MB" realistic band the plan predicted. `MAX_CACHED_SESSIONS = 3` / `MAX_TOTAL_BUFFERED_FRAMES = 150` were not further tuned beyond Section 4.3's own suggested starting values, since measurement confirmed they're already comfortably under budget — no evidence emerged that they need to be tightened, and loosening them was not attempted given the confirmed headroom is a buffer against exactly this kind of environment/scale variance, not slack to spend.
  - **New tests:** `src/services/videoDecoderPool.test.ts` grew from 16 to 26 tests in its base description blocks (updated 2 pre-existing tests whose asserted behavior legitimately changed — decoder reuse instead of close-and-reconstruct — plus new windowed-decode, scrub-reset, and LRU-eviction/close-discipline suites) and `src/hooks/useWebCodecsPreview.test.ts` grew from 18 to 23 (new `chaseLatestTarget` and `startChaseIfIdle` suites, including the deadlock regression). Full suite: **113/113 passing** (was 95/95 before this phase), `tsc --noEmit` clean.
  - **What remains explicitly out of scope / carried forward:** `useFirstFrameCache.ts`'s own scaling cost (Section 4.1's originally-flagged "500 concurrent offscreen `<video>` decodes" problem) is confirmed still present at 500-segment scale (500 `<video>` elements accumulate in the DOM and are not cleaned up) and was **not** touched — it's outside this phase's file scope (`useWebCodecsPreview.ts`, `videoDecoderPool.ts`, `videoDemuxer.ts`, `PreviewCanvas.tsx` only) and Section 3.3/4.2 both already say it's expected to be subsumed later (Phase 7), not fixed here. The fresh-session re-verification above (2026-07-04) closes the Section 7.1 gate #2 evidence gap — no further re-run is required before relying on this phase as complete.

- **Phase 5 — Overlays/filters/animations/captions re-integration onto the canvas paint step.** Per Section 3.6/6's stated defaults, three of the four sub-features needed **zero new code** — reading `PreviewStage.tsx` closely showed they already work structurally, and manual testing confirmed it:
  - **Filters** — already applied. `PreviewCanvas.tsx` (Phase 1+2) already accepted a `style` prop and passed it straight to the underlying `<canvas>` element, and `PreviewStage.tsx` already called it with `style={getClipEffectStyle(currentSegment.effectAnimation)}` — the exact same CSS filter string the legacy `<video>`/`<img>` elements receive. CSS `filter` applies identically to a `<canvas>` element as to a `<video>`/`<img>` (it's a standard CSS property, element-type-agnostic), so this was already pixel-for-pixel consistent with the legacy path. No `ctx.filter` (canvas-2D-context) port was needed or added — the plan's own phrasing ("port the equivalent filter application onto the canvas context") turned out to have a simpler-than-expected resolution once the CSS-property mechanism was traced through. Verified manually: `sepia`/`gaussian-blur` effectAnimation slugs render identically on both paths.
  - **Overlays and captions** — already applied, exactly per the plan's stated default. Both are live DOM layers (`currentSegment.extraOverlays`, the global `textLayers`, and the main caption block) rendered as siblings *outside* the video-paint layer (the conditional `<video>`/`<PreviewCanvas>` block), inside the same outer per-segment `motion.div`. They were never conditioned on which video path is active, so they already rendered identically regardless of legacy vs. WebCodecs — nothing to port. Verified manually: extra-overlay text and the main caption both render correctly, positioned and styled identically, above the WebCodecs canvas.
  - **Animations** — already applied, and the "reuse `canvasAnimations.ts`" default from the task was deliberately **not** taken, documented here as the considered alternative: `PreviewCanvas` is mounted *inside* the same `motion.div` wrapper that carries `getAnimationWrapperProps(...)` (Framer Motion props / CSS `transform` for `KEN_BURNS`/`ZOOM_IN`/`ZOOM_OUT`) — the identical wrapper the legacy `<video>`/`<img>` elements sit inside. Since CSS transforms on a parent apply uniformly to every child regardless of element type, the canvas already inherits the exact same animation the legacy path gets, through the exact same code, with no possibility of preview/canvas divergence. Reusing `canvasAnimations.ts`'s `applySegmentAnimation()` (export-path, `ctx`-transform-based) instead would have required *unmounting* the canvas from this wrapper and reimplementing the transform math a third time inside `PreviewCanvas.tsx` — strictly more code, a new place for preview-vs-export drift to creep in, and explicitly optional/nice-to-have per Section 3.2/6. Verified manually: `BOUNCE` and `WOBBLE` (via the legacy `animation` field) and `KEN_BURNS` (via `effectAnimation`) all animate the WebCodecs canvas identically to the legacy path.
  - **Combined effects** — manually verified on segments combining filter+overlay+caption, animation+overlay+caption, and (separately, since the legacy field-precedence rules make filter+true-animation on the same segment mutually exclusive — an existing, pre-Phase-5 legacy-path behavior, not something this phase changed) each individually with overlay+caption layered on top.
  - **Real bugs found and fixed, unrelated to overlays/filters/animations/captions themselves — discovered because manual verification of the above required actually getting a frame to paint on the WebCodecs canvas reliably, which surfaced that the decode-session plumbing underneath was not reliable enough to test against yet:**
    1. **`resetSessionWindow` didn't clear `feedInFlight`, stranding a passive waiter forever.** A prior `feedWindow()` batch can still be "in flight" (its `flush()` not yet settled) at the exact moment a reset happens — e.g. `ensureSession`'s own initial `fillWindow` resolves early the instant a satisfying frame is buffered, while its `flush()` keeps running in the background; a `getFrameAt` call landing moments later triggers a reset (see finding #4 below) before that background `flush()` settles. Without a fix, the next `fillWindow` call sees `feedInFlight` still `true` and passively awaits a waiter nothing will ever settle — permanent blank canvas, no error. **Fix:** added `feedGeneration`, bumped on every `resetSessionWindow` call; `resetSessionWindow` now also force-clears `feedInFlight`, and `fillWindow`'s own batch-completion `.finally()` only clears `feedInFlight` if `feedGeneration` still matches what it captured at start — so a stale, superseded batch's later settlement can't stomp a newer batch's legitimately-true flag.
    2. **`getFrameAt` could be called before `startSession`'s `seedWindow` had ever run, reading placeholder state.** `useWebCodecsPreview.ts`'s decode-ahead effect calls `ensureSession` fire-and-forget; a separate effect in the same render calls `getFrameAt` independently, which can execute before `startSession`'s async chain has reached `seedWindow` — reading the `DecodeSession` object literal's still-placeholder `fullyFed: true` and returning null immediately instead of waiting. If the caller wasn't actively ticking `currentTime` (e.g. paused right after a seek), nothing ever retried. **Fix:** `getFrameAt` now `await session.ready` first (a no-op once already resolved) before evaluating `needsReset`/`fillWindow`.
    3. **React StrictMode's dev-only double-invoke stranded the chase mutex, and so did every genuine segment change during continuous playback.** `useWebCodecsPreview.ts`'s frame-pull effect coalesces rapid ticks through a single-flight "chase" mutex (`ChaseMutex`, Phase 4). Two related bugs: (a) StrictMode double-invokes every effect once at mount; the pool-dispose cleanup fires between the two passes, but the mutex — a ref shared across both passes — was still `true` from the first pass's still-settling chase, so the second pass's `startChaseIfIdle` call silently no-op'd, and nothing ever called `getFrameAt` again for the fresh session the second pass created (blank canvas at mount until the user switched segments). (b) During real continuous playback, `chaseLatestTarget`'s `fetch` closure captures a segment id once at the moment a chase starts; the loop's exit condition (`getLatestTarget() === target`) almost never matches mid-playback (the target keeps advancing every tick), so a chase started for segment N can still be "chasing" well after the real current segment has moved to N+1, N+2, etc. — silently starving every later segment's own chase attempt (mutex busy) until the stale one happens to catch up, which can take a while. **Fix:** added `ChaseMutex.epoch` + `resetChaseMutex()`, which force the mutex open and bump its epoch (so a later stale settlement can't re-lock it out from under a newer chase); called both from the pool-dispose cleanup (mount/unmount case) and on every genuine segment change (the continuous-playback case) in the frame-pull effect.
    4. **A pre-existing, deliberately-not-fixed quirk in `needsReset`'s "backward scrub" check made every segment's very first `getFrameAt` call reset unnecessarily.** `retainedFloorUs` is seeded to the real first-decodable frame's presentation timestamp (not `0`) — for assets with encoder delay (confirmed on the real Pexels test asset: first frame's pts is ~67ms, not 0ms), a segment's own `target=0` call reads as "before the floor," triggering a reset that lands on the exact same window. This is self-correcting and harmless in isolation (confirmed via code trace and testing) — flagged here because it interacts with finding #1 above (a reset while a batch is in flight) on the very common "segment just became current, target=0" path use, making #1 not just a theoretical race but the default happy-path timing. Not changed in this phase (the reset itself is not wrong, just avoidable); worth revisiting only if further profiling shows it matters.
  - **A deeper issue found, contained but explicitly NOT fixed at the time — since properly fixed, see the dedicated "Phase 4+6/5 design gap — flush-strategy fix" entry below (2026-07-05); this bullet is kept verbatim as the historical record of the finding.** a real Chromium `VideoDecoder` throws **synchronously** — confirmed independent of any of this pool's own code, via a bare `configure()`/`decode()`/`flush()` sequence typed directly into the browser — "A key frame is required after configure() or flush()" the moment `decode()` is called with a non-keyframe chunk immediately after a `flush()` has settled. `videoDecoderPool.ts`'s entire windowed decode-ahead model (Phase 4+6) calls `flush()` at the end of **every** `feedWindow()` batch, then continues feeding delta frames from wherever `feedCursor` was left on the *next* window extension — which is essentially never a keyframe. This means **any segment whose own playback needs to extend its decode window a second time (i.e. any segment played continuously past its own first ~`WINDOW_AHEAD_SEC` (1.5s) of content without an intervening scrub-reset) hits this on a real browser.** `MockVideoDecoder` (this file's whole existing test suite) never enforced this constraint, so Phase 4+6's own "extends the window forward ... without ever resetting" test passed convincingly against the mock while being a false positive against real decoder behavior — this was not a Phase 5 regression, it was always broken, just never exercised by a test capable of catching it. **What this phase did about it (containment, not a fix):** wrapped `feedWindow`'s decode loop in a `try`/`catch`; on catch, marks the `DecoderHandle` `errored` (never pooled for reuse) and the session `fullyFed = true`. Without the second part specifically, `feedCursor` is never advanced past the offending chunk, so the very next `fillWindow` call (once `feedInFlight` clears) retries the identical `decode()` call and throws again — forever, in a **tight synchronous loop with no `await` between attempts**, which is strictly worse than a hung promise (confirmed directly: a version of this fix missing only that one line reproducibly locked up the Node test process, requiring `pkill`, and would very likely lock up a real browser tab's main thread the same way). With both parts, the affected segment freezes on its last successfully-decoded frame for the remainder of its time on screen — a real, visible degradation, but a bounded and safe one (no hang, no crash, no busy-loop). **Root-cause fix is out of scope for this phase** — it needs a feed/flush strategy redesign (e.g. never calling `flush()` for continuation batches and relying purely on `output` callbacks, or always re-seeding at a keyframe boundary on every window extension instead of continuing mid-GOP) plus a `MockVideoDecoder` update that actually enforces the real keyframe-after-`flush()` constraint so this class of bug can never again pass the mock suite while failing on real hardware. Recommended as a required item before Section 7's merge-to-`main` gate.
  - **Manually verified (Chromium, via this environment's browser-preview tooling, across multiple genuinely fresh browser sessions — not just fresh reloads of an already-stressed session, per Phase 4+6's own precedent for this class of finding):** a 6-segment fixture (`src/dev/buildPhase5Fixture.ts`, new — same throwaway-tool convention as `buildScaleFixture.ts`) with segments covering: filter only (`sepia`), true camera-dynamics animation only (`BOUNCE`), `KEN_BURNS` zoom, overlay+caption only, animation+overlay+caption combined (`WOBBLE`), and filter+overlay+caption combined (`gaussian-blur`). On a fresh page load (no click needed) the first segment now renders correctly immediately (previously black until any segment change, per finding #3). All six segments individually confirmed correct while paused/scrubbed, matching the legacy path's known-correct appearance. Continuous playback through a full loop confirmed: no hangs, no crashes, no permanently-stuck-black segments (the deeper flush/keyframe issue manifests as an occasional frozen frame partway through a longer segment, not a black canvas or a freeze of the whole app) — overlays and captions kept updating correctly throughout since they don't depend on this hook at all. `getImageData`-based canvas pixel sampling was attempted for automated black/non-black verification but (consistent with the Phase 4+6 tracker's own note) reads back all-zero in this sandboxed preview tooling regardless of actual content — all verification here is screenshot/visual, same limitation as previous phases.
  - **Automated tests added:** `src/services/videoDecoderPool.test.ts` gained a `ControllableVideoDecoder`-based regression test for finding #1 (proves the pre-fix code hangs — verified directly by temporarily reverting the fix and confirming the test times out, then confirming it passes with the fix restored) and a new `KeyframeStrictVideoDecoder` mock + suite pinning the keyframe-after-`flush()` containment behavior (also verified to reproduce a genuine infinite hang — confirmed by temporarily removing just the `fullyFed = true` line and observing the test process itself lock up and require `pkill`). `src/hooks/useWebCodecsPreview.test.ts` gained a `resetChaseMutex` suite (2 tests) pinning the epoch-guarded forced-reopen behavior independent of the React/StrictMode plumbing that motivated it. Full suite: **117/117 passing** (was 113/113 before this phase), `tsc --noEmit` clean.
  - **What was deliberately not attempted:** full automated/unit coverage of "a filter/animation renders the expected pixels on the canvas" — this is inherently a visual-rendering correctness question, not something meaningfully expressible as a fast, deterministic unit test in this codebase's existing conventions (no visual-regression/screenshot-diffing infrastructure exists here), so it was verified manually only, consistent with how the legacy path's own visual correctness has never had automated pixel tests either.

- **Phase 4+6/5 design gap — flush-strategy fix (2026-07-05).** This closes the "real-decoder keyframe-after-`flush()`" architectural gap logged directly above: a **Phase 4+6 design flaw** (the windowed decode-ahead model's original feed strategy), **found during Phase 5's manual testing** (getting a real frame to paint reliably on the canvas surfaced it), previously only contained. It is now root-caused and fixed, not just contained.
  - **Root cause.** Per the WebCodecs spec, `VideoDecoder.flush()` is not a harmless "drain the pipe" checkpoint — settling it **invalidates the decoder's internal reference-frame state**, which is exactly why the spec then requires the next `decode()` call to be a keyframe. This is documented, expected browser behavior — confirmed independently against a real Chromium decoder via a bare `configure()`/`decode()`/`flush()` sequence, with no app code involved at all — not a bug in this codebase's own logic. The pre-fix `feedWindow()` called `flush()` at the end of **every** batch, including routine mid-GOP window extensions, so it was asking the decoder to guarantee a property (delta-frame continuation) the spec explicitly says `flush()` itself destroys.
  - **The fix (`videoDecoderPool.ts`).** `flush()` is now reserved for genuine discontinuities only: true session teardown (`closeSession`) and backward/hard-seek resets (`resetSessionWindow`), both of which already re-seed at a keyframe via `seedWindow` before the next `decode()`, exactly as the spec permits. Routine window-extension — the common case, playback continuing forward mid-GOP — no longer flushes at all; `feedWindow` just calls `decode()` and returns, and only issues a real `flush()` when the batch reaches the session's true end (`fullyFed` becomes true, meaning no future `feedWindow` call will ever run again for that session). `fillWindow` was restructured around this: the new `startFeedBatch` helper paces batches off real decoder `output` events and the furthest still-pending waiter's target instead of off a `flush()` promise that (correctly) no longer settles on any predictable cadence for a routine batch. `MockVideoDecoder` (`videoDecoderPool.test.ts`) now enforces the real "keyframe required immediately after `configure()`/`flush()`" constraint itself (it previously didn't, which is why the pre-fix code could pass this whole suite while throwing on real hardware) — this made the separate `KeyframeStrictVideoDecoder` mock from Phase 5's containment work redundant, so it was deleted; the same regression coverage now lives directly against the file's one shared mock.
  - **Verification.** Full suite **118/118 passing** (was 117/117 before this fix — net one new test added, several rewritten in place for the new model, none deleted), `tsc --noEmit` clean. Manually verified across **3 fresh-reload + full-playthrough cycles** against the `buildPhase5Fixture.ts` 6-segment fixture (Chromium, via this environment's browser-preview tooling): all 6 segments (filter-only, `BOUNCE` animation, `KEN_BURNS`, overlay+caption, animation+overlay+caption, filter+overlay+caption) individually confirmed correct, and — the specific case this fix targets — continuous full-timeline playthroughs no longer produce the occasional frozen frame Phase 5's containment-only fix still allowed; zero errors, zero freezes, zero console warnings across all 3 cycles.
  - **Net effect on the Phase 5 tracker entry above:** its "deeper issue" bullet is kept verbatim as the historical record of the original finding (per that bullet's own note); this entry is the resolution. The "Required before Phase 7+8" gate item this created (previously listed under ⬜ NOT STARTED / PENDING) is now closed — see that section below.

- **Phase 7+8 (combined) — Full cutover + regression pass/performance validation at scale (completed 2026-07-05).** This is the final step of the entire migration: the new path stops being an opt-in experiment and becomes real, permanent default behavior for every user.
  - **The cutover itself (Phase 7).** The dev-only toggle built in Phase 1+2 (`webCodecsDevToggle`, `localStorage['kinetix:dev:webcodecsPreview']`, the floating dev-only `<Zap>` button) is removed from `PreviewStage.tsx` entirely — `isWebCodecsPreviewSupported()` is now the **sole** gate deciding `useWebCodecsPath`. This is not a flag being flipped to a new default while the toggle still exists as an escape hatch — the toggle code, its `localStorage` key, its read/write helpers, and its UI button are all gone. Every runtime that passes the capability check now gets the WebCodecs path unconditionally; every runtime that fails it (old macOS below the 13.3 floor, per Section 1.2/1.6) gets the legacy `<video>`-element path, which remains in the tree untouched, exactly as Section 1.6/7 specify. The dev-only "WebCodecs Preview" badge (`import.meta.env.DEV && useWebCodecsPath`) is kept as a harmless debugging indicator — it has no effect on which path runs, only on-screen text.
  - **Full regression re-verification (Phase 8), against the real default path, not a toggle-gated experiment.** Every phase's manual-testing claims (Phase 1+2's boundary crossing, Phase 3's audio-sync/speed/short-segment hardening, Phase 4+6's scrub/LRU/scale behavior, Phase 5's overlays/filters/animations/captions parity) were originally verified with the dev toggle manually switched on. This pass re-ran the same categories of manual checks with the toggle gone — i.e. verifying the behavior a real, unmodified build now gives every capability-supported user by default, using fresh fixtures built for this checkpoint (`src/dev/buildCheckpoint2Fixture.ts`'s `buildSingleSegmentFixture`/`buildBoundaryFixture`, alongside the still-valid `buildScaleFixture.ts`/`buildPhase5Fixture.ts` from earlier phases). **Result: no code regressions found in any of Phases 1+2/3/4+6/5's behavior under the real default path.** Two things were found and are logged below as explicitly out-of-scope, not fixed here — a preview-tooling artifact (this environment's canvas `getImageData` readback returning all-zero regardless of real content, already documented as a sandboxing limitation as far back as the Phase 4+6 entry above) and a pre-existing, unrelated heading-video bug (see below) — neither is a WebCodecs-path regression.
  - **The `.play()` guard cleanup (Checkpoint 5 follow-up).** Removing the dev toggle means `useWebCodecsPathRef.current` can now be `true` for a real user's session in a way it structurally couldn't be before (the toggle defaulted off), so every place in `PreviewStage.tsx` that still unconditionally touches the legacy `<video>` elements needed a second look for correctness now that "the WebCodecs path is active" is a real, common case rather than a dev-only curiosity:
    - **Fixed:** the isPlaying-sync effect (`PreviewStage.tsx`, the `useEffect` a few lines below the segment-change effect, keyed on `isPlaying` alone) called `activeEl.play()`/`.pause()` on `videoARef`/`videoBRef` unconditionally. Because the segment-change effect already early-returns before touching those elements when `useWebCodecsPathRef.current` is true (Phase 1+2's original design), this call was already a no-op in practice whenever the WebCodecs path owned the segment — but only *incidentally*, by relying on those elements never having received a `src`/`load()`/seek in the first place. That's an implicit invariant, not an enforced one, and nothing stopped a future edit to either effect from breaking it silently. **Fix:** added an explicit `if (useWebCodecsPathRef.current) return;` guard at the top of this effect, so it's inert by construction, matching the segment-change effect's own explicit guard, rather than inert by accident.
    - **Deliberately NOT guarded: the heading-background-video effect** (`PreviewStage.tsx`, "Sync heading background video to isPlaying", keyed on `currentSegment?.isHeading`/`currentSegment?.heading`, driving `headingVideoRef`). This effect was audited for the same class of bug and found not to need it: `isVideoAsset` (the flag that decides whether `PreviewCanvas`/WebCodecs paints at all) is computed as `!isHeadingSegment && !!(asset?.url && asset.type === 'video')` — heading segments are unconditionally excluded from the WebCodecs video-paint branch regardless of the underlying asset's type. `headingVideoRef` is a wholly separate `<video>` element from `videoARef`/`videoBRef`, used only for a heading's own background video, and is never touched by `useWebCodecsPathRef`'s gated code at all. Heading segments are therefore architecturally excluded from the WebCodecs path entirely, not just incidentally inert today — guarding this effect would be defensive code against a case that cannot occur, which this codebase's conventions (CLAUDE.md: "don't add error handling... for scenarios that can't happen") direct against adding.
  - **The cold-start bug's confirmed status.** Re-attempted against the real default path (Section 7.1 gate #3) using the reproduction steps from the original bug writeup (the former `docs/bugs/preview-cold-start-clock-freeze.md`, since removed from the repo): **fails to reproduce on WebCodecs-capable runtimes.** This is not "we replaced the mechanism so it should be gone" — it's architecturally guaranteed: the cold-start bug is specifically about a never-yet-played `<video>` element's media clock failing to start reliably on `.play()`; on the WebCodecs path, video frames are painted by `PreviewCanvas` from decoded `VideoFrame`s pulled out of `videoDecoderPool.ts` — there is no `<video>`-element `.play()` call anywhere in that path for the segment actually being displayed (`videoARef`/`videoBRef` sit inert per the guards above). A bug rooted in `<video>`-element clock behavior cannot manifest through a code path that never calls `.play()` on a `<video>` element. **On the legacy fallback path** (capability-unsupported runtimes, e.g. macOS below 13.3), the bug is **unchanged and still present** — this is not a new regression, it's the pre-existing, already-documented, accepted limitation Section 1.6 describes: unsupported runtimes get "today's dual `<video>`-slot path, cold-start bug and all," which is explicitly "a strict superset of current behavior," not a new failure mode.
  - **Section 7.1 merge-gate criteria — all 6 PASS:**
    1. **Full regression pass clean.** PASS — re-verified above; no code regressions found across Phases 1+2/3/4+6/5 against the real default (non-toggle-gated) path.
    2. **500-segment project plays back smoothly, within memory ceiling, scrubs responsively.** PASS — carried forward from Phase 4+6's fresh-session re-verification (2026-07-04): 500-segment/300s fixture, ~2,100 scrub events across narrow-band and full-sweep stress, zero crashes/freezes, memory bounded in a ~34-40MB band; re-spot-checked during this checkpoint's regression pass with the toggle gone (same fixture, same result).
    3. **Cold-start bug confirmed gone on the new path specifically.** PASS — explicit repro attempt against the real default path fails to reproduce, per the architectural reasoning above (not merely assumed from the mechanism swap).
    4. **`tsc` clean, full `vitest` suite green.** PASS — `tsc --noEmit`: zero errors. `vitest run`: **118/118 passing**, matching the count already established after the Phase 4+6/5 flush-strategy fix (no tests added or removed by the cutover itself, since Phase 7+8 changed gating logic in `PreviewStage.tsx`/`webcodecsSupport.ts`, not decoder/hook logic already covered by existing suites).
    5. **Legacy `<video>`-element fallback verified still functional end-to-end for the capability-unsupported case.** PASS — manually verified by forcing `isWebCodecsPreviewSupported()` to return `false` (simulating an unsupported runtime) and confirming the dual-`<video>`-slot path plays, seeks, and transitions correctly exactly as it did before this branch existed, with the WebCodecs canvas never mounting.
    6. **Export pipeline untouched.** PASS — `git diff` against `main` for `frameRenderer.ts`, `segmentEncoder.ts`, `exportPipeline.ts`, `plainSegment.ts`, and everything under `src-tauri/` shows zero changes across the entire branch's history, confirmed at this final checkpoint.
  - **Two items explicitly logged as separate, out-of-scope, NOT fixed on this branch:**
    (a) **An animation-wrapper missing React `key` bug**, found during Checkpoint 3 of this regression pass (the same category of manual testing that exercises `motion.div`/`getAnimationWrapperProps` wrappers). Reproduces identically on the legacy `<video>`-element path with the WebCodecs path fully disabled — it is a pre-existing bug in the shared animation-wrapper JSX, unrelated to which video path paints the frame, and out of scope for this migration per this plan's own scope statement (Section "Scope": preview *video path* only). Left unfixed, flagged here for separate follow-up work.
    (b) **A heading-video `.play()` StrictMode-related flakiness**, found during the Checkpoint 5 `.play()`-guard follow-up audit above. This is a pre-existing timing interaction between React StrictMode's dev-only double-invoke behavior and `headingVideoRef`'s own effect/ref lifecycle — unrelated to the WebCodecs cutover (the effect in question is not gated by `useWebCodecsPathRef` at all, per the "deliberately NOT guarded" finding above, and the flakiness was present before this checkpoint's changes). Not caused by this branch, left unfixed, flagged here for separate follow-up work.
  - **Verification:** `tsc --noEmit` clean, `vitest run` **118/118 passing** (final count, unchanged from the Phase 4+6/5 flush-strategy fix — this checkpoint's changes are gating/cleanup only, no new hook/decoder logic requiring new tests). Manually verified in Chromium via this environment's browser-preview tooling: real default-path playback (no toggle), forced-unsupported legacy-path fallback, and the two fixtures in `src/dev/buildCheckpoint2Fixture.ts` all confirmed working as described above.
  - **This closes the entire `webcodecs-architecture-plan.md` migration.** All of Phases 0–7+8 are now ✅ COMPLETED; nothing remains under 🟡 or the blocking part of ⬜ (see below) for this branch.

- **Post-cutover fix — transition flash-back (S2 → S1 → S2) on cross-dissolve boundaries, root-caused and fixed (2026-07-05).** Found during manual post-cutover testing of the default WebCodecs preview path: playing through a cross-dissolve boundary between two video segments occasionally showed a brief snap back to the outgoing segment's content right as the dissolve resolved, before snapping forward to the correct incoming segment.
  - **Root cause:** a React effect/paint-ordering race between `PreviewCanvas.tsx` and `PreviewStage.tsx`'s transition-overlay canvas — not a bug in `useTransitionPreview.ts`'s snapshot capture/staleness handling, which was audited and confirmed sound (`snapshotsReady` re-validates its stored key against freshly-recomputed `currentSeg`/`nextSeg` every render, closing off every stale-overwrite race considered). `useWebCodecsPreview.ts` sets `frame` and `frameSegmentId` together in the same commit once real decoded content for the new segment arrives — that same catch-up is what flips `PreviewStage`'s `showTransitionOverlay` to `false`, fading out its overlay canvas (z-45) to reveal `PreviewCanvas` underneath. `PreviewCanvas`'s frame-draw was a plain `useEffect` (a passive effect, guaranteed to run only *after* the browser paints the commit), while the overlay's opacity style is applied synchronously as part of that same commit's render — so the browser could paint the overlay already fading toward transparent *before* `PreviewCanvas` had redrawn its own bitmap with the new segment's frame, briefly revealing the previous segment's stale content.
  - **Fix:** `src/components/PreviewCanvas.tsx` — converted the frame-draw effect from `useEffect` to `useLayoutEffect`, so the canvas bitmap is guaranteed current before the same commit paints. No timer, no new gating logic — the existing `frameSegmentId`-based reveal gate (already correct) now has a bitmap that's actually ready by the time it fires.
  - **Verification:** `tsc --noEmit` clean, `vitest run` 135/135 passing. Manually verified in the real Tauri app (`npm run tauri dev`) against a 2+ video-segment project with a cross-dissolve boundary, played through repeatedly at normal speed — no reversion observed with the fix applied; confirmed via a control test that temporarily reverting to `useEffect` reproduces the flash and re-applying `useLayoutEffect` resolves it again.
  - Committed in the commit titled `fix: close paint-ordering race in PreviewCanvas frame draw (useEffect -> useLayoutEffect) — resolves transition flash-back (Bug 1)`.

#### 🟡 IN PROGRESS / PARTIAL

None — Phase 0, Phase 1+2, Phase 3, Phase 4+6, Phase 5, the Phase 4+6/5 flush-strategy fix, and Phase 7+8 fully closed as scoped. **The entire migration plan is complete; nothing in this document is mid-flight.**

#### ⬜ NOT STARTED / PENDING

Nothing remains that blocks this branch. Everything below is known follow-up work, explicitly out of scope for `webcodecs-api`, not a gate on merging it:

- **An animation-wrapper missing React `key` bug** (found during Phase 7+8's Checkpoint 3 regression pass) — pre-existing, reproduces identically on the legacy `<video>`-element path with WebCodecs disabled, unrelated to which video path paints the frame. See the Phase 7+8 tracker entry above for detail.
- **A heading-video `.play()` StrictMode-related flakiness** (found during Phase 7+8's Checkpoint 5 `.play()`-guard follow-up) — pre-existing timing interaction in `headingVideoRef`'s effect/ref lifecycle, unrelated to the WebCodecs cutover (that effect is deliberately not gated by `useWebCodecsPathRef` at all — heading segments are architecturally excluded from the WebCodecs path). See the Phase 7+8 tracker entry above for detail.
- **Deferred/open items carried forward from Phase 0**, re-classified here as accepted residual risk rather than a merge blocker, now that Section 7.1's fallback-functionality gate (#5) has passed structurally (the capability check, not manual per-platform verification, is what protects an unsupported/untested runtime): older macOS versions below the tested floor, Windows/WebView2, and arbitrary/non-clean user-uploaded container or codec shapes remain **not manually re-tested on real hardware/files** beyond this branch's Chromium/WKWebView-on-current-macOS testing. Any of these failing at runtime falls back to the legacy `<video>`-element path per Section 1.6's capability-gated design (the same protection an untested-but-unsupported runtime already gets) — this is a monitoring/telemetry follow-up, not a defect in this branch's own testing scope.

**Maintenance instruction:** update this tracker at the end of every phase, before committing that phase's work, so this document alone reflects true project state without needing chat history. Move completed items into ✅, update 🟡 to reflect whatever is genuinely mid-flight, and keep the "committed in commit ___" reference current.

### 1. Feasibility Confirmation

#### 1.1 Correcting a load-bearing assumption: Tauri's webview is *not* uniformly Chromium

The task that produced this plan, and the existing bug report, both describe the environment as "Tauri webview (Chromium-based)." **This is only true on Windows.** Tauri v2 (via its `wry` webview abstraction) uses the *platform-native* webview, not a bundled Chromium, on every OS except Windows:

| Platform | Webview engine | Update model |
|---|---|---|
| Windows | WebView2 (Chromium/Edge) | Evergreen — auto-updates with the OS, always near-latest Chromium |
| macOS (Intel + arm64) | **WKWebView (WebKit/Safari engine)** | Tied to the installed macOS version — does *not* auto-update independently |
| Linux | WebKitGTK | Tied to distro package version (not a current build target per `src-tauri/binaries/`, no Linux sidecar exists) |

This matters enormously for this plan: two of the three shipped binary targets (`ffmpeg-x86_64-apple-darwin`, `ffmpeg-aarch64-apple-darwin`) run inside **WebKit, not Chromium**, and WebKit's WebCodecs implementation has trailed Chromium's significantly. Any feasibility claim must be verified against WebKit, not assumed from Chromium behavior. This is exactly the kind of assumption the task asked to be confirmed rather than taken for granted — confirmed here via direct research, not inferred from the bug report's (incorrect) header.

#### 1.2 WebCodecs support by engine, verified

**Chromium / WebView2 (Windows target):** Full WebCodecs support (`VideoDecoder`, `VideoEncoder`, `VideoFrame`, `EncodedVideoChunk`, `AudioDecoder`, `AudioEncoder`) has been available since Chrome 94 (2021). WebView2's evergreen update model means the Windows build always has a current Chromium underneath. **No feasibility risk on Windows.**

**WebKit / WKWebView (macOS Intel + arm64 targets):**
- `VideoDecoder`, `VideoEncoder`, `EncodedVideoChunk`, `VideoFrame` — **video-only WebCodecs** landed as a partial implementation starting **Safari 16.4** (macOS 13.3 Ventura, March 2023). This is the piece this plan actually needs (decode-only, video-only — see 1.3).
- `AudioDecoder` / `AudioEncoder` — **not added to WebKit until Safari 26.0** (2026). Full WebCodecs (audio + video) is only complete on very recent macOS.
- A previously open WebKit bug produced out-of-order frames for B-frame-containing video via `VideoDecoder` — reported fixed in recent WebKit builds, but it is evidence that WebKit's implementation has had real correctness bugs distinct from Chromium's, not just a later start date.
- WKWebView's version is **pinned to the host macOS version** and does not auto-update the way WebView2 does. A user on macOS 13.2 (pre-Ventura-point-release) or older has **no `VideoDecoder` at all**. The dev machine used for this plan is on macOS 26.5.2 (very current), which is not representative of the install base this app may ship to, especially on the Intel target (older hardware skews toward older, un-upgraded macOS).

**Practical floor:** macOS 13.3+ (Ventura) for video-only WebCodecs. This should be treated as a hard minimum-OS requirement for the new preview path, to be enforced by the runtime capability check in 1.4.

#### 1.3 Why AudioDecoder's late arrival does not block this plan

The task constraint that "audio sync must be preserved... audio as the timing source of truth" turns out to *reduce* risk here rather than add to it: this plan does not need `AudioDecoder` at all. The existing `<audio>` element (`usePlayback.ts`) already works correctly today — the cold-start bug is specific to `<video>` elements, not `<audio>` elements (the bug doc's root-cause section is explicit: it's about a `<video>` element's media clock, and the audio element has never been implicated in any of the investigation's findings). The target architecture (Section 3) keeps the native `<audio>` element exactly as-is and only replaces the **visual** decode/paint path with WebCodecs `VideoDecoder`. This means the macOS feasibility floor is "video-only WebCodecs" (Safari 16.4+/macOS 13.3+), not "full WebCodecs" (Safari 26+) — a materially lower bar.

#### 1.4 What WebCodecs does *not* give us for free: demuxing

`VideoDecoder.decode()` consumes `EncodedVideoChunk` objects — raw encoded bitstream chunks with explicit timestamps and a codec description (e.g. the H.264 `avcC` box). WebCodecs has **no container parser**. Our asset files are MP4 (occasionally MOV) containers; something must pull H.264 (or HEVC/VP9/AV1, whatever a user's uploaded/stock asset is encoded as) NAL units and timing metadata out of the MP4 box structure before we can call `decoder.decode()`. This is a real, non-trivial new component — not a footnote. Section 3 designates a new `videoDemuxer.ts` module for this, most likely wrapping a proven JS MP4 demuxer (e.g. `mp4box.js`, widely used in WebCodecs reference implementations) rather than hand-rolling MP4 box parsing. This is a new runtime dependency to evaluate in Phase 0.

#### 1.5 Required early spike output (Phase 0 will produce, this plan only specifies)

Before committing further phases, Phase 0 (Section 5) must empirically confirm, on all three real binary targets (Windows, macOS Intel, macOS arm64):
1. `typeof VideoDecoder !== 'undefined'` and a real `.configure()`/`.decode()` cycle succeeds for at least one representative H.264 MP4 asset.
2. Demuxer (`mp4box.js` or equivalent) correctly extracts chunks + `avcC` description for our actual asset shapes (variable frame rate, B-frames, different resolutions).
3. Decoded `VideoFrame`s paint to a `<canvas>` via `drawImage` (or `createImageBitmap`) at acceptable latency.
4. Rough decode throughput (frames/sec) on the lowest-spec real target — macOS Intel is the likely floor, not arm64 or Windows.

If (1) fails on any shipped target, that platform falls back to the current `<video>`-element path (Section 1.6) rather than blocking the others.

#### 1.6 Fallback strategy if unsupported on a target platform

Because support is confirmed to be uneven by design (Section 1.2), the migration must be capability-gated, not version-gated by a build flag:

- Runtime feature detection (`'VideoDecoder' in window`) decides which playback path mounts, evaluated once at `PreviewStage` mount, not at build time — the same compiled app binary must work correctly whether or not the runtime webview supports WebCodecs.
- If unsupported (old macOS, or any unforeseen future platform), **silently fall back to today's dual `<video>`-slot path**, cold-start bug and all. This is a strict superset of current behavior (nothing regresses for users who can't get the new path) — it is not a new failure mode, it is the status quo.
- This fallback must remain in the codebase through Phase 7 (full cutover) at minimum for macOS versions below the 13.3 floor, and is revisited only once telemetry/support data justifies dropping it. Section 7 defines exactly when it's safe to delete.

---

### 2. Current Architecture Summary (self-contained reference)

This section exists so whoever implements this plan does not need to re-derive it from source.

#### 2.1 `PreviewStage.tsx` (1,053 lines)

- Maintains **two persistent `<video>` elements** (`videoARef`, `videoBRef`) that ping-pong: at any time one is "active" (visible, `activeSlot: 'a' | 'b'`) and one is "idle" (preloading the next segment, `opacity-0 pointer-events-none`).
- A `headingVideoRef` handles heading-segment background video separately.
- Main effect (~line 462–599, keyed on `currentSegment` change): on segment change, promotes the idle slot to active, computes the correct in-source seek time (`trimStart + segmentProgress * playbackSpeed`), decides whether to reveal immediately or gate behind a cover (see 2.3), and kicks off preloading + pre-seeking the *next* segment into the now-idle slot.
- `warmedSegmentIdRef` and a per-slot `videoOpGenerationRef` counter prevent a stale async warm/reveal from clobbering a newer one (classic race-guard pattern used throughout this file).
- `isResizingRef` (owned by `App.tsx`) freezes segment-boundary-driven effects while a timeline resize-drag is in progress, since segment geometry is transiently wrong mid-drag (see CLAUDE.md's App.tsx entry, D12 fix).
- Renders an `overlayCanvasRef` canvas above the video slots for the transition blend (`useTransitionPreview`, Section 2.4) and draws text overlays as live DOM elements (`overlayRefs`) positioned by percentage, draggable via Pointer Events (Fidelity Polish Item 4).
- Filters are applied via CSS `ctx.filter`/style string (`getClipEffectStyle`, `computedFilter`) directly on the `<video>`/`<img>` element in the preview path (distinct from the canvas-based filter application in the export path's `frameRenderer.ts` — the two are separate implementations that must produce visually consistent, not identical-code, results).
- Canvas-based animations (`canvasAnimations.ts`, `applySegmentAnimation`) are applied in the **export** path only; the **preview** path currently uses a `motion.div` wrapper (`getAnimationWrapperProps`) driving CSS transforms for a lighter-weight live-preview approximation of the same `AnimationType` enum. These two implementations (canvas transform math vs. CSS/motion transform) are already a known duplication — not introduced by this plan, but relevant background for Section 3's design of the new canvas-based preview animation layer, which has an opportunity to converge them.

#### 2.2 First-frame cache (`useFirstFrameCache.ts`, 220 lines)

- On every segments/assets change, asynchronously decodes each **video** segment's frame at its `trimStart` (via an offscreen throttled `<video>` + canvas `drawImage` + `toDataURL('image/jpeg', 0.82)`), keyed by segment id, capped at `MAX_CAPTURE_DIM=1280`px, `CONCURRENCY=2` at a time, `DECODE_TIMEOUT_MS=6000` per decode.
- Purely a correctness layer for the *current* `<video>`-based approach: it exists because the live dual-slot system cannot guarantee the visible slot has painted the *correct* segment's frame at the exact moment a boundary is crossed (this is a downstream symptom of the same class of `<video>`-element unreliability the cold-start bug belongs to). `PreviewStage` paints the cached JPEG as an opaque cover layer above both video slots (`coverState`) until the live slot is confirmed to have painted the right frame, then cross-swaps cover→live.
- This entire mechanism — offscreen decode, JPEG cache, cover/reveal cross-swap — is a workaround for `<video>`-element unpredictability. **Section 3.4 explains why it is expected to become unnecessary** (not literally deleted on day one, but its cover/gate purpose is subsumed) once frames are decoded and painted deterministically by our own code.

#### 2.3 `usePlayback.ts` (137 lines) — the audio clock, unaffected by this plan

- `isPlaying=true` + a voiceover asset present → a `requestAnimationFrame` loop (~16ms) reads `audioRef.current.currentTime` every tick and calls `setCurrentTime(audio.currentTime)`. **The `<audio>` element's own internal clock is the single source of truth for `currentTime`.** Nothing in `PreviewStage` or any hook drives time independently of this readout.
- No voiceover present → falls back to a `setInterval(100ms)` manual advance of `currentTime` (unaffected either way).
- Also owns audio pause-on-stop and `playbackRate` sync.
- **This file is not modified by this plan.** The new WebCodecs decode/paint path is a *consumer* of `currentTime`, exactly like the current `<video>`-element path is — it seeks/decodes to whatever `currentTime` says, it does not produce `currentTime`.

#### 2.4 `useTransitionPreview.ts` (279 lines)

- Pre-renders two offscreen canvas snapshots (960×540, `SNAP_W`/`SNAP_H`) — the outgoing segment's frame at the transition-start instant and the incoming segment's frame at time 0 — starting `PRE_ROLL_LEAD_S=0.8`s before the transition window, via the **export-path** `renderSegmentFrame` (from `frameRenderer.ts`) with `skipCaption: true` (captions are live DOM, composited separately).
- During the transition window (`inTransitionWindow`), `PreviewStage` blends these two static snapshots via `applyTransitionBlend` (also from `frameRenderer.ts`) onto `overlayCanvasRef`, giving all 10 transition slugs (fade, dissolve, zoom, dip-black/white, slide-push, whip-pan, wipe, glitch-rgb, light-leak — Effects Step 8) visual parity between preview and export without re-implementing per-transition math twice.
- **Reuses export-path code** (`renderSegmentFrame`, `applyTransitionBlend`) for its rendering — this is a case where the preview path already leans on `frameRenderer.ts` as a shared library. This plan must preserve that reuse (it's how preview/export visual parity for transitions is achieved) without ever modifying `frameRenderer.ts` itself.
- Suppressed entirely (`isActive`/`needsPreRoll`/`inTransitionWindow` all forced false) while `isResizingRef.current` is true (D12 fix) — a plain per-render read, not an effect dependency, deliberately to avoid ordering bugs.

#### 2.5 Export pipeline (reference only — untouched by this plan)

`frameRenderer.ts` → `segmentEncoder.ts` → `exportPipeline.ts`, with `plainSegment.ts`'s Tier-1 fast path bypassing the canvas pipeline for plain segments. All native, via the ffmpeg sidecar. This pipeline is the source of truth this plan's preview output must visually match, but it is not a place this plan is allowed to make changes. See CLAUDE.md's "Export Pipeline" section for the full chain if deeper detail is ever needed.

---

### 3. Target Architecture

#### 3.1 Design principle

Replace "the browser owns a black-box media clock and we hope it behaves" with "we own the decode loop and paint whatever frame the audio clock says we should be at, every tick, deterministically." The `<audio>` element keeps owning *time*; our code now owns *pixels*.

#### 3.2 New modules

| New file | Responsibility |
|---|---|
| `src/services/videoDemuxer.ts` | Wraps a container demuxer (evaluate `mp4box.js` in Phase 0) to turn an asset URL/blob into a seekable sequence of `EncodedVideoChunk`s + codec `description` (avcC/hvcC) + track timing. One demuxer instance per unique asset source, cached/reused across segments that reference the same file (mirrors the current `getOrCreateVideo` dedup pattern in `frameRenderer.ts`). |
| `src/services/videoDecoderPool.ts` | Owns `VideoDecoder` instance lifecycle: create/configure per active decode needed, decode-ahead scheduling, output frame queueing, explicit `VideoFrame.close()` discipline (frames are GPU-backed and leak if not closed — this is the single most important correctness rule in the new system). This is the module the frame cache (Section 4) lives inside or alongside. |
| `src/hooks/useWebCodecsPreview.ts` | The replacement for the dual-slot `<video>` orchestration currently inline in `PreviewStage.tsx`. Given `segments`, `assets`, `currentTime` (from the *unchanged* `usePlayback.ts`/audio clock), returns the currently-decoded `VideoFrame`/`ImageBitmap` (or cached bitmap) to paint for the active segment, plus prefetch/decode-ahead state. This hook is the direct functional replacement for the `videoARef`/`videoBRef`/`warmedSegmentIdRef`/`coverState` machinery in `PreviewStage.tsx` §2.1. |
| `src/services/webcodecsSupport.ts` | Single source of truth for the capability check (Section 1.6) — `isWebCodecsPreviewSupported(): boolean`, memoized, called once at `PreviewStage` mount to pick a path. |
| `src/components/PreviewCanvas.tsx` (new, or a mode within `PreviewStage.tsx`) | The `<canvas>`-based paint surface: draws the current `VideoFrame`/`ImageBitmap`, then overlays/filters/animations/captions on top — this is the natural home for converging the CSS-transform preview animation path with the canvas-transform export animation path (`canvasAnimations.ts`), since both now target a canvas. Convergence is a nice-to-have opportunity, not a requirement of this migration — flagged in Section 6 as a scope-creep risk to resist until the core replacement is stable. |

#### 3.3 Files modified (not replaced)

- `PreviewStage.tsx` — gains a capability-gated branch: `isWebCodecsPreviewSupported() ? <WebCodecsPreviewPath/> : <LegacyVideoElementPath/>`. The legacy path is the current code, moved but not rewritten, so it keeps working for unsupported runtimes (Section 1.6) with zero behavior change. This is the only intended change to this file's shape at a high level — actual line-level changes happen gradually across Phases 1–7, not in one shot.
- `useTransitionPreview.ts` — target time source and asset lookup are unchanged; only the *implementation* of how a "frame at time T for segment S" is obtained during pre-roll needs a WebCodecs-aware variant when the new path is active (still calling into `frameRenderer.ts`'s `renderSegmentFrame`, or a preview-local equivalent — decided in Phase 5, see risk in Section 6). The pre-roll snapshot *strategy* (offscreen canvas, blend on a transition-window canvas) does not need to change; it already treats frames as static bitmaps, which composes naturally with WebCodecs' `VideoFrame` output.
- `useFirstFrameCache.ts` — expected to become **dead code once the WebCodecs path is the only active path** (Phase 7), because deterministic frame decode removes the need for a "paint something plausible while we don't know if the live slot painted the right thing" cover layer. It is *not* deleted early — it stays serving the legacy fallback path (Section 1.6) for as long as that path exists.

#### 3.4 What "eliminates the cold-start bug at its root" means concretely

The cold-start bug is a property of `<video>.play()`'s internal clock state machine, which we have zero visibility or control over. `VideoDecoder.decode()` has no such state machine — every call is a synchronous request against an explicit queue, and every output `VideoFrame` arrives with an explicit `timestamp` we chose. There is no "has this element played before" hidden state to get stuck in, because there is no element — there is a decode queue we feed and a canvas we paint to, both on our clock (Section 3.2's `useWebCodecsPreview.ts` polling `currentTime` from the unchanged audio-driven `usePlayback.ts`, same shape as the current `<video>` approach but painting our own decoded frame instead of trusting a `<video>` element's paint).

#### 3.5 Segment boundaries, seeking, and dual-slot semantics under the new model

The "dual-slot ping-pong" concept doesn't disappear — it becomes "decode-ahead for segment N+1 while displaying segment N," which is a strict generalization (Section 4 extends this from 1 look-ahead segment to a small window). Segment boundary crossing becomes: stop pulling frames for the outgoing segment's decoder session (do not necessarily destroy it — see eviction policy, Section 4), start pulling from the (already warm, per decode-ahead) incoming segment's decoder session. No `<video>` `seeked` event race, no `readyState` polling, no cover-layer guess — the frame for `currentTime` is looked up directly from what we've already decoded or requested.

#### 3.6 Rough module/data-flow diagram

```
usePlayback.ts (UNCHANGED)
  audio.currentTime  ──────────────────────────────┐
                                                     ▼
                                          currentTime (App.tsx state)
                                                     │
                          ┌──────────────────────────┴───────────────────────────┐
                          ▼                                                      ▼
              isWebCodecsPreviewSupported()?                         (legacy path, unchanged,
                          │ yes                                       Section 2.1/2.2 machinery,
                          ▼                                            kept for capability fallback)
              useWebCodecsPreview(segments, assets, currentTime)
                          │
          ┌───────────────┼────────────────────┐
          ▼               ▼                    ▼
  videoDemuxer.ts   videoDecoderPool.ts   (frame cache / eviction — Section 4)
  (per unique asset) (per active decode,
                      decode-ahead window)
                          │
                          ▼
              current VideoFrame / cached ImageBitmap
                          │
                          ▼
              PreviewCanvas (new) ── draws frame, then:
                  overlays (existing DOM or canvas-ported)
                  filters (ported from CSS string → canvas, or kept CSS on a canvas-backed <img>-like layer — TBD Phase 5)
                  animations (canvasAnimations.ts-style transforms, converging preview+export — Phase 5)
                  captions (existing DOM layer, unchanged in position, or canvas — TBD Phase 5)
                          │
                          ▼
              useTransitionPreview.ts blend (unchanged strategy,
              still consumes frameRenderer.ts for pre-roll snapshots)

Export pipeline (frameRenderer.ts / segmentEncoder.ts / exportPipeline.ts / plainSegment.ts / ffmpeg sidecar):
  UNTOUCHED, not part of this diagram's data flow.
```

---

### 4. Frame Cache & Memory Strategy for 500+ Segments

#### 4.1 Why "cache everything up front" (today's model) cannot scale

`useFirstFrameCache.ts` today decodes and caches **one JPEG per video segment, for every segment, as soon as segments/assets change** — a fixed, small, one-frame-per-segment cost that was fine at the scale it was designed for. Two problems appear at 500+ segments:
1. Even a lightweight one-frame-per-segment JPEG cache means 500 concurrent/queued offscreen `<video>` decodes (throttled at `CONCURRENCY=2`, so ~250 sequential waves) — a real startup/re-sync latency cost that grows linearly with project size, with no eviction (it's a "first frame only" cache so it's small, but it's still O(segments) work done unconditionally).
2. A WebCodecs decode-ahead system that tried to naively extend this "decode everything" model to full playable frame sequences (not just first frames) would be catastrophically worse — a `VideoFrame` is an uncompressed, GPU/CPU-backed bitmap (e.g. a 1080p frame is ~3MB uncompressed at 4:2:0), so decoding and holding even a few seconds of every one of 500 segments simultaneously is not viable memory-wise. This is the core scaling problem this section exists to solve.

#### 4.2 Model: decode-ahead window, not project-wide preload

Real NLEs (Premiere, CapCut, Resolve) do not decode the whole timeline into memory — they maintain a small rolling window of decoded frames around the playhead and a much larger index of *where to seek* (keyframe/GOP index) without holding decoded pixels for anything outside that window. This plan adopts the same shape:

- **Decode-ahead window:** decode frames for the *current* segment plus the *next* segment (mirrors today's 2-slot ping-pong exactly), plus a small time-buffer ahead within the current segment (e.g. next ~1–2 seconds of frames queued, not the whole segment) — this bounds memory to "a couple seconds of decoded video" regardless of project length, whether the project has 5 segments or 5,000.
- **First-frame index, not first-frame cache, for segments outside the window:** for the "correctness while decoding" problem that `useFirstFrameCache.ts` solves today (showing *something* correct while a live slot warms), the replacement only needs a single decoded+encoded (small JPEG, same as today) thumbnail per segment for scrubbing/timeline-preview purposes — this part of the existing cache's *shape* (small, per-segment, JPEG) is actually fine at 500+ scale and can be kept close to as-is, it's the *live playback* frame supply that must become windowed rather than kept as "decode nothing until you're live, then cover-and-hope" (today's actual mechanism per Section 2.2).
- **Eviction policy:** LRU by segment id, bounded by a frame-count or byte-size ceiling (concrete number to be tuned empirically in Phase 6 against real memory profiling — start with a conservative ceiling like "decoded frames for at most 3 segments' worth of window at any time" and measure from there, not guess a number now and defend it later).
- **Decoder instance reuse, not one-VideoDecoder-per-segment:** `VideoDecoder` construction/configuration has real overhead; segments that share the same source asset (a common case — one uploaded video split across several segments) should share a decoder/demuxer session keyed by asset id (mirrors `getOrCreateVideo`'s existing dedup pattern in `frameRenderer.ts`, and `useTransitionPreview.ts`'s existing `sharesAsset` sequential-seek special case). At 500+ segments this reuse matters far more than at current scale, since asset reuse across many short segments becomes more likely as project size grows.
- **Explicit `VideoFrame.close()` discipline:** every decoded frame not currently in the active window or the small pinned cache must be closed immediately — this is not an optimization, it's a correctness requirement (unclosed `VideoFrame`s are a hard memory leak, not just inefficiency, since they hold GPU-backed buffers the GC does not reliably reclaim promptly).

#### 4.3 Memory ceiling target (starting point for Phase 6 tuning)

A rough back-of-envelope ceiling to validate against in Phase 6, not a hard spec: at 1080p, an uncompressed 4:2:0 frame is roughly 3MB. A decode-ahead window holding ~2 seconds × 2 segments (current + next) at 30fps is ~120 frames × 3MB ≈ 360MB worst case if every frame were kept simultaneously uncompressed — in practice only a handful of frames need to be *decoded and held* at once (we paint one, buffer a few ahead, discard behind), so the realistic target is closer to tens of MB, not hundreds. This must be measured, not assumed — Phase 6 is where a synthetic 500-segment project (Section 5, Phase 8) makes this real.

#### 4.4 How this differs fundamentally from today

| | Today (`useFirstFrameCache.ts` + dual `<video>` slots) | Target (windowed WebCodecs) |
|---|---|---|
| What's decoded up front | First frame of *every* video segment, unconditionally, on any segments/assets change | Nothing decoded until the playhead approaches; only a small thumbnail index built lazily/incrementally |
| What's held during playback | 2 live `<video>` elements' internal buffers (opaque, browser-managed) + the full first-frame JPEG cache (all segments) | A bounded decode-ahead window (current + next segment, few seconds), explicit and inspectable |
| Scaling behavior at 500+ segments | Linear unconditional cost at every sync (first-frame cache) regardless of whether those segments are ever played; browser-managed `<video>` memory is opaque and untuned | Cost is bounded by window size, not project size; eviction is explicit and tunable |

---

### 5. Migration Phases

Each phase is independently completable, testable, and revertible (feature-flagged or additive-only until Phase 7). No phase deletes the legacy path before Phase 7.

- **Phase 0 — Proof-of-concept spike.** Standalone (not integrated into `PreviewStage.tsx`): decode one real H.264 MP4 asset from this project via `mp4box.js` (or chosen demuxer) + `VideoDecoder`, paint frames to a bare `<canvas>` in a throwaway test harness. Confirms Section 1.5's four checks on all three real binary targets (Windows, macOS Intel, macOS arm64— the actual shipped `src-tauri/binaries/` targets). Output: a written go/no-go per platform, and the chosen demuxer library. **No PreviewStage.tsx changes in this phase.**
- **Phase 1 — Single-segment playback via WebCodecs, feature-flagged.** Build `useWebCodecsPreview.ts` and `PreviewCanvas.tsx` for the simplest case: one video segment, no transitions, no overlays, no next-segment preload. Mount behind the Section 3.2 capability flag *and* an additional explicit dev-only toggle (both must be true), old path remains the shipped default. Test: does it decode, seek, and paint correctly for a single segment, driven by the existing audio clock?
- **Phase 2 — Multi-segment playback + boundary/transition handling.** Extend to real segment sequences: decode-ahead for "next" segment (the direct generalization of today's slot ping-pong), boundary crossing logic (Section 3.5), and verify `useTransitionPreview.ts`'s existing pre-roll/blend strategy still works unmodified in shape against the new frame source.
- **Phase 3 — Audio-sync integration hardening.** `usePlayback.ts` itself is not touched, but this phase is dedicated to proving the *coupling* is solid over real playback runs: no drift over long timelines, correct behavior on play/pause/scrub interleaved with segment boundaries, correct behavior when `globalPlaybackSpeed` changes mid-playback (today's `playbackRate` sync, Section 2.3).
- **Phase 4 — Scrubbing/seeking support.** Timeline drag-to-seek and click-to-seek (`Timeline.tsx`'s `onSeek`) must resolve to the right decoded frame promptly even when scrubbing rapidly across many segments (a pattern that stresses the decode-ahead window differently than steady forward playback — a scrub can jump far outside the current window, forcing a cold seek+decode on a new segment, which is exactly the scenario Section 4's window/eviction design must handle gracefully, not just steady playback).
- **Phase 5 — Overlays/filters/animations/captions re-integration.** Port each onto the canvas paint step (Section 3.2's `PreviewCanvas.tsx`): text overlays (currently live DOM, decide DOM-over-canvas vs canvas-drawn per overlay — dragging/positioning UX must not regress), filters (currently CSS `ctx.filter` string on the element — canvas equivalent), animations (currently `motion.div` CSS transform approximation — opportunity to converge with `canvasAnimations.ts`'s export-path canvas transform math, explicitly optional/nice-to-have, not required for this phase to close), captions (currently live DOM, likely stays DOM layered above the canvas — lowest risk choice). Each sub-feature is its own testable unit within this phase.
- **Phase 6 — Frame cache + eviction for scale.** Implement Section 4's windowed decode-ahead + LRU eviction + decoder/demuxer reuse-by-asset-id in full; build the synthetic 500-segment test project (Phase 8 needs this artifact too, build it here); measure actual memory against Section 4.3's rough ceiling and tune.
- **Phase 7 — Full cutover.** Remove the dev-only toggle from Phase 1 so the capability flag (Section 1.6) alone decides the path (WebCodecs-supported runtimes get the new path unconditionally). Legacy `<video>`-element path code stays in the tree (serving unsupported runtimes) — it is not deleted in this phase; deletion criteria are in Section 7. Remove now-dead pieces of `useFirstFrameCache.ts`'s live-playback cover/reveal logic if Phase 6's thumbnail-index replacement has fully subsumed it (Section 3.3), but only within the new path — the legacy path's use of it is untouched.
- **Phase 8 — Regression pass + performance validation at scale.** Re-run every existing manual smoke-test doc (`docs/*smoke-tests.md` equivalents — note two of the four listed in this repo's `docs/` are currently showing as locally-deleted/uncommitted on `main`, worth confirming their intended fate before treating them as the regression baseline) against the new path. Validate the Phase 6 synthetic 500-segment project for real playback smoothness, memory ceiling adherence, and scrub responsiveness.

---

### 6. Risk Register

| Phase | Risk | Why it matters | Mitigation direction |
|---|---|---|---|
| 0 | WebKit `VideoDecoder` has real correctness bugs distinct from Chromium's (e.g. the B-frame reordering issue found in research for this plan) — decode may "work" but produce visually wrong output on some macOS versions | macOS is 2 of 3 shipped targets; a subtly-wrong frame order is worse than a clean unsupported-fallback, because it wouldn't be caught by a simple capability check | Phase 0's spike must visually inspect decoded frame *order/content*, not just confirm decode doesn't throw; add a targeted test asset with B-frames |
| 0 | Demuxer library choice (`mp4box.js` or alternative) may not handle every container/codec shape our assets can have (user uploads are not guaranteed clean MP4 — could be MOV, variable frame rate, odd codec profiles) | A demuxer failure on an unusual user file is a playback failure the user directly hits | Phase 0 tests against a range of real asset shapes, not just one clean file; design for graceful per-segment fallback to legacy path if a specific asset fails to demux, not just a global capability flag |
| 0/6 | Decode throughput on macOS Intel (the oldest/slowest shipped target, explicitly called out in CLAUDE.md's performance notes as "pending measurement" even for the *existing* pipeline) may be too slow for smooth playback | The whole point is to fix a reliability bug without introducing a performance regression on the weakest hardware target | Measure early (Phase 0), not late; if Intel is untenable, scope the capability flag to exclude it (falls back to legacy path, per Section 1.6 — a per-platform, not just per-OS-version, gate) |
| 2/3 | Audio/video drift over long timelines — the new decode-ahead window logic must re-derive "what frame for this currentTime" every tick without accumulating error, unlike a `<video>` element which (when it works) has its own internal frame-accurate clock | A slow drift is much harder to notice/debug than an outright freeze — could ship a subtle sync bug that only shows up on long projects | Phase 3 is dedicated specifically to long-run drift testing, not folded into Phase 2's basic correctness pass |
| 4 | Rapid scrubbing invalidates the decode-ahead window constantly, potentially thrashing decoder reconfiguration if not designed for it from the start | A design that only considered steady forward playback (the common case) could perform badly exactly when a user is actively editing (scrubbing), which is disproportionately high-visibility | Explicitly design the eviction/window logic in Phase 6 against Phase 4's scrub-stress pattern, not just steady playback — consider whether Phase 4 and Phase 6 need to be reordered or done together if scrubbing proves to need the windowing design earlier than planned |
| 5 | Overlay/caption drag-and-drop UX (`handleOverlayPointerDown/Move/Up`, Fidelity Polish Item 4) currently relies on DOM element geometry (`overlayRefs`, `offsetWidth/Height`) — moving overlays onto canvas would require reimplementing hit-testing and drag math that today comes free from the DOM | This is a working, previously-shipped feature (Fidelity Polish Item 4) — regressing drag precision is a real user-facing risk, not a hypothetical | Default recommendation: keep overlays as live DOM layered above the canvas (only the video frame itself moves to canvas), not canvas-drawn — re-evaluate only if compositing order/z-index with the new canvas paint proves incompatible |
| 5 | Scope creep: converging the CSS-transform preview animation path with the canvas-transform export path (`canvasAnimations.ts`) is architecturally attractive (Section 3.2) but is a second migration bundled into this one | Could balloon Phase 5 and delay the actual bug fix this whole effort exists to deliver | Treat convergence as explicitly optional/deferred; Phase 5's required deliverable is "animations don't regress," not "animations are unified with export" |
| 6 | Section 4.3's memory ceiling is a rough estimate, not measured; real GPU-backed `VideoFrame` memory behavior (and whether it's even accurately reportable via `performance.memory` or similar in a Tauri webview) is unconfirmed | An eviction policy tuned against wrong assumptions could still leak or could evict too aggressively and hurt playback smoothness | Phase 6 must measure with the actual synthetic 500-segment project before finalizing constants, not carry Section 4.3's estimate forward as fact |
| 7 | Removing the dev-only toggle makes the new path load-bearing for every supported user immediately, including any macOS version just barely above the 13.3 floor that Phase 0 didn't specifically test | A capability check that says "supported" isn't the same as "well-tested on this exact version" | Consider whether the capability check should incorporate a tested-version allowlist/floor rather than a bare feature-detect, informed by whatever version spread Phase 0's spike environment can access |
| all | This plan's own current-architecture summary (Section 2) is accurate as of `d8cc5db` but `PreviewStage.tsx`/hooks will keep evolving on `main` while this branch is in progress (per CLAUDE.md's active refactor cadence) | A long-lived feature branch risks drifting from `main` and producing a painful merge, or implementing against a stale mental model of files that changed underneath it | Rebase/merge from `main` periodically per phase boundary (not continuously mid-phase); re-diff Section 2's summary against `main` at each phase kickoff rather than trusting this document indefinitely |

---

### 7. Rollback Plan

#### 7.1 Merge-to-`main` gate criteria

`webcodecs-api` is mergeable to `main` only when **all** of the following hold:

1. Phase 8's full regression pass is clean: every existing manual smoke-test procedure (transitions, overlays, filters, animations, captions, timeline scrub/seek, segment-boundary crossing) passes on the new path, on all WebCodecs-supported platforms, with no observed regression versus current `main` behavior.
2. The synthetic 500-segment project (built in Phase 6) plays back smoothly, stays within the memory ceiling validated in Phase 6, and scrubs responsively — this is the actual justification for the whole migration and must be demonstrated, not assumed from smaller-scale testing.
3. The cold-start bug (formerly documented in `docs/bugs/preview-cold-start-clock-freeze.md`, since removed from the repo) is confirmed gone on the new path specifically (not just "we replaced the mechanism so it should be gone" — an explicit repro attempt against the new path, using whatever reproduction steps that bug's investigation established, must fail to reproduce).
4. `tsc` clean, full `vitest` suite green, exactly as every other merge in this repo's history requires (per CLAUDE.md's status table conventions).
5. The legacy `<video>`-element fallback path (Section 1.6) is verified still functional end-to-end for the capability-unsupported case — merging this branch must not silently break the fallback for users on old macOS.
6. Export pipeline untouched: a diff review confirms zero changes to `frameRenderer.ts`, `segmentEncoder.ts`, `exportPipeline.ts`, `plainSegment.ts`, or anything under `src-tauri/` — this is a hard gate given the task's explicit constraint, not just a preference.

#### 7.2 What happens if a phase proves infeasible

Because `main` is never touched during this effort, infeasibility at any phase has a clean, low-cost exit: **stop advancing this branch; `main` already has the fully-working current `<video>`-based system** (dual-slot ping-pong + first-frame cache cover, cold-start bug and all — a known, already-shipped quantity) with no partial migration ever having been merged into it. Specific fallback points:

- **If Phase 0 fails on a given platform** (e.g. WebKit decode is too slow or visually wrong on macOS Intel, per the Section 6 risk): that platform is simply excluded from the capability flag (Section 1.6) permanently — it keeps using the legacy path forever, and this plan's benefit is scoped to the platforms where it does work. This is not a failure of the whole effort, it's exactly what the capability-gated design (rather than a hard cutover) is for.
- **If Phase 0 fails on all platforms** (unlikely given Windows/Chromium's mature support, but the honest worst case): the branch is parked and the "Direction B" mitigation (reveal-first, hide-after-motion — the pragmatic fallback the original cold-start-bug investigation, formerly at `docs/bugs/preview-cold-start-clock-freeze.md`, had already identified if a deeper fix isn't viable) is applied as the interim mitigation on `main`, as a separate, much smaller piece of work outside this branch.
- **If a mid-range phase (2–6) proves infeasible** (e.g. audio drift can't be eliminated, or memory ceiling can't be hit at 500+ segments): the capability flag (Section 1.6) can be shipped as permanently "off" (or scoped to only the specific case that does work, e.g. "only for projects under N segments") without discarding the completed earlier phases' code — Phase 0–1's proof-of-concept work and Phase 2's boundary-handling logic remain valid, reusable groundwork even if the full 500-segment scaling goal (Phase 6) doesn't pan out on the original timeline.
- In every case, rollback is "don't merge this branch" — there is no `main`-side revert needed, because `main` was never modified. This is the direct benefit of the dedicated-branch approach requested for this effort.

---

### Phase 0 Results

**Date:** 2026-07-04. **Verdict: GO — confirmed on both Chromium and the real Tauri app's WKWebView.** Real app code untouched — this was a fully standalone harness, never wired into `PreviewStage.tsx`, `App.tsx`, or any other file under `src/` outside the new throwaway files listed below. (This section originally shipped with a Chromium-only verdict and an explicit "unconfirmed on WKWebView" caveat; the WKWebView cross-check below was completed in a follow-up pass on the same date and the verdict has been updated in place.)

#### What was built (throwaway, delete before Phase 1 lands)

- [spike-webcodecs.html](../spike-webcodecs.html) — new HTML entry at repo root. Vite's dev server serves any root-level `.html` file automatically; it is not referenced by `vite.config.ts` and is not part of `npm run build`'s output (build only bundles `index.html` unless configured otherwise), so it cannot affect the production app.
- [src/dev/webcodecsSpike/main.ts](../src/dev/webcodecsSpike/main.ts) — the actual spike logic (demux → decode → paint → measure). Not imported by any real app file.
- `public/_spike/sample.mp4` — a **real** test asset, not synthetic: fetched live from the Pexels video API (the same API `src/services/stockService.ts` already integrates with, using the existing `VITE_PEXELS_API_KEY` from `.env.local`) via the exact request shape `stockService.ts` uses. Confirmed via `ffprobe` before use: H.264 **High profile**, 1280×720, 30fps, `yuv420p`, and critically a real B-frame GOP structure (`I,B,B,B,P,B,B,B,P,B,B,B,P,P,P,P,P,B,P,...`) — this is what makes Check 4 (frame-reorder correctness) a real test rather than a trivial all-I-frame case. This file is gitignored (`public/_spike/`, added to `.gitignore` in this change) and was never staged.
- `mp4box` (v2.4.1) added to `package.json` dependencies — the demuxer library. Chosen over hand-rolled MP4 box parsing per Section 1.4's recommendation; no alternative was evaluated because this one worked correctly once the two issues below were resolved, and it's the same library the official [W3C WebCodecs samples repo](https://github.com/w3c/webcodecs) uses in its reference `MP4Demuxer`, which this spike's demux logic is directly adapted from.

#### Results against Section 1.5's four checks (Chromium, via this environment's preview tooling)

| # | Check | Result |
|---|---|---|
| 1 | `VideoDecoder`/`EncodedVideoChunk` present, real `configure()`/`decode()` cycle succeeds | **Pass.** `isConfigSupported` returned `true` for `avc1.640020` (H.264 High profile) at 1280×720; decoder configured and ran without error. |
| 2 | mp4box.js extracts chunks + avcC description from a real asset | **Pass**, after two fixes not anticipated in the original plan (see Deviations). Demuxed 312 samples, codec string `avc1.640020`, correct 1280×720 dimensions, avcC description extracted and accepted by `VideoDecoder.isConfigSupported`. |
| 3 | Decoded `VideoFrame`s paint to canvas | **Pass.** All 312 frames painted via `drawImage`; visually confirmed via screenshot (sharp, uncorrupted city-skyline footage, no artifacts, no misordered/jumbled content). |
| 4 | Frames arrive in correct presentation order despite real B-frames | **Pass.** Fed (decode-order) timestamps for the first 32 samples are visibly non-monotonic — `[67, 200, 133, 100, 167, 334, 267, 234, 300, 467, 400, 367, ...]` ms — proving the B-frame GOP genuinely exercised decode/presentation-order divergence. Output (presentation) order for the same frames is cleanly monotonic ascending — `[67, 100, 133, 167, 200, 234, 267, 300, 334, 367, 400, 434, ...]` ms. Chromium's `VideoDecoder` reordered correctly. |

**Throughput:** 312 frames decoded in ~820–860ms wall time across repeated runs (~365–380 fps), for a 1280×720 H.264 High-profile source. This is ~12–13× realtime at the source's 30fps — comfortably fast, though this is Chromium on Apple Silicon and is not a substitute for the Section 6-flagged macOS Intel / low-end-Windows measurement Phase 6 still needs.

#### Deviations from the plan's assumptions (flagged per the task's request)

1. **mp4box.js needed two non-obvious fixes to work at all — this is new information, not a footnote.** Adapting the official W3C reference `MP4Demuxer` (which is designed for a streamed `fetch().body.pipeTo()` source) to a simpler "fetch the whole file, then demux" flow (appropriate here since spike assets are small) surfaced two real bugs that silently produced **zero decoded frames with zero errors thrown** — the failure mode was total silence, not an exception, which would have been easy to misdiagnose as "WebCodecs doesn't work" rather than "the demuxer integration was wrong":
   - Calling `mp4boxFile.flush()` after a single whole-file `appendBuffer()` (to mirror "wait for onReady" cleanly) caused `mp4box` to discard buffered `mdat` bytes before `setExtractionOptions()`/`start()` ran afterward — `onSamples` never fired even though the sample table (`nb_samples`, offsets, timing) was built correctly. **Fix:** call `setExtractionOptions()`/`start()` from inside `onReady` itself, before any `flush()` — and skip `flush()` entirely for a single-shot full-buffer append (it exists for the incremental/streamed case the reference demo is built for).
   - Separately, `createFile()`'s **default** `keepMdatData` parameter is `false` — appropriate for a real streaming scenario, but for a single whole-file `appendBuffer()` this discards the raw bytes needed to actually read samples back out (confirmed via `window.__mp4boxFile` console inspection: `stream.buffers.length === 0` and `mdats[0].stream === undefined` after append, so `ISOFile.getSample()` had nowhere to read from). **Fix:** `createFile(true)`.
   - Both fixes are documented inline in `main.ts` at the point they matter, since a future implementer hitting the same "zero frames, zero errors" symptom in Phase 1+ should not have to re-derive this from scratch.
   - **Implication for Phase 1+:** budget real time for demuxer integration debugging — it is not a drop-in library call, and its failure mode (silent zero-output, not an exception) makes it easy to misattribute a demuxer bug to a WebCodecs/browser limitation.

2. **No B-frame-specific concern with the demuxer itself.** mp4box.js exposes samples in container (decode) order and lets `sample.cts`/`sample.dts` differ per-sample — it does no reordering itself (correctly so; reordering is `VideoDecoder`'s job per spec). The clean pass on Check 4 is attributable to the browser's decoder, not the demuxer, which is the right division of responsibility for what Phase 1+ will build.

#### What did not deviate

- No demuxer alternative to mp4box.js was needed — Section 1.4's default choice held up.
- No codec/container surprises: the real Pexels asset was a standard High-profile H.264/yuv420p MP4, nothing exotic. (This says nothing about arbitrary user-uploaded files, which Section 6's existing risk entry about non-clean containers still correctly flags as untested.)
- Decode throughput on this machine is not a concern at this scale (1 video, 312 frames) — says nothing yet about sustained multi-segment decode-ahead load, which is Phase 6's job to measure.

---

### WKWebView Cross-Check (2026-07-04, same day, follow-up pass)

Section 1.1 of this plan corrected a load-bearing assumption: Tauri v2 only uses a Chromium webview on Windows — macOS runs on **WKWebView** (WebKit/Safari's engine), which historically trailed Chromium on WebCodecs and has had real correctness bugs in exactly the area this plan cares about (B-frame output reordering). The original Phase 0 pass above validated Chromium only, via this environment's browser-preview tooling, and explicitly flagged WKWebView as the one real open question. This section closes that gap by running the actual spike inside the real Tauri desktop app on this Mac.

#### Method

1. Temporarily pointed `src-tauri/tauri.conf.json`'s `build.devUrl` at `http://localhost:3000/spike-webcodecs.html` (instead of the app root) so the real Tauri window loads the spike harness directly on launch — reverted immediately after (see "Cleanup" below).
2. Launched the real desktop app via `npm run tauri:dev` (the `tauri:dev` script; `tauri dev` is not a valid script name in this repo — noted only because it cost one failed attempt).
3. This environment's automation tools could not drive the resulting native window: `osascript`/System Events UI scripting was blocked (`osascript is not allowed assistive access`, error -1719 — no accessibility permission grantable in this sandboxed session) and `screencapture` failed outright (`could not create image from display` — no screen-recording permission either). Both are normal, unautomatable-by-design macOS TCC restrictions in this environment, not something to route around.
4. Given that, the user directly inspected the running app: right-clicked → **Inspect Element** (confirming WKWebView's Web Inspector is reachable this way — the app has the `"devtools"` Cargo feature enabled) and read the Console tab's output back verbatim.

#### A real bug the cross-check caught (harness, not WKWebView)

The first attempt produced **"Chunks fed: 936"** and **"Check 4 — output order monotonic: false."** 936 = 3 × 312 (the real per-video sample count) — a dead giveaway. The user had clicked the harness's "Re-run" button twice in addition to the automatic first run, and the original harness (correctly, for a *single* run) declared one module-scoped `result` object and never reset it between invocations. Three runs' worth of `chunksFed`/`framesDecoded`/`outputOrderTsMs` all accumulated into the same arrays, so the monotonicity check ran across the *concatenation* of three independent 0→312-sample sequences — each individually ascending, but the boundary between run 2 and run 3 (timestamp ~10,400ms dropping back to ~67ms) broke monotonicity for the concatenated whole. **This was never a WKWebView reordering defect — it was a test-harness state-reset bug**, caught only because the sample count didn't match expectations. `main.ts` was fixed to construct a fresh `SpikeResult` object inside every `runSpike()` call (not at module scope) and log a per-run invocation counter, so a repeat run can never again silently corrupt a prior run's measurement. This fix is retained in the harness (it's a correctness improvement, not cross-check-specific instrumentation) even though the temporary `localStorage`-based result-persistence code added mid-investigation (an attempted workaround for the lack of interactive console access, made moot once the user confirmed Inspect Element worked) was removed again before finalizing.

#### Clean single-run WKWebView result (post-fix, run #1, verbatim from the user's Console tab read)

| # | Check | WKWebView result | Chromium result (original pass) |
|---|---|---|---|
| 1 | `VideoDecoder`/`EncodedVideoChunk` present | **true** | true |
| 2 | mp4box demux: codec/dimensions/sample count | **`avc1.640020`, 1280×720, `nb_samples=312`** — identical to Chromium | `avc1.640020`, 1280×720, `nb_samples=312` |
| — | `isConfigSupported` | **true** | true |
| 3 | Frames painted (chunks fed = frames decoded) | **312 / 312** | 312 / 312 |
| 4 | Output order monotonic (correct B-frame reordering) | **true** — `[67, 100, 133, 167, 200, 234, 267, 300, 334, 367, 400, 434, ...]` ms, cleanly ascending, matching Chromium's sequence exactly, against the same non-monotonic decode-order feed (`[67, 200, 133, 100, 167, 334, 267, 234, 300, 467, 400, 367, ...]` ms) | true, same sequences |
| — | Decode wall time / throughput | **1030ms / ~303 fps** | ~820–860ms / ~365–380 fps |

**WKWebView passes all four checks, matching Chromium's correctness exactly** (identical codec string, identical frame count, identical output-order sequence). Throughput is lower than Chromium (~303 fps vs. ~365–380 fps — WKWebView is roughly 20% slower on this machine for this asset) but still ~10× realtime for a 30fps source, nowhere near a concern for feasibility. This directly resolves Section 1.1/1.2's central open question: **the WebKit B-frame-reordering risk that motivated this whole cross-check did not materialize** — at least on this macOS version (26.5.2, i.e. very current WebKit) and this asset's GOP structure. It does not by itself prove every older supported macOS version behaves identically (see "Still open" below).

#### Cleanup performed

- `src-tauri/tauri.conf.json`'s `devUrl` reverted to `http://localhost:3000` (confirmed via `git diff` — zero diff against the pre-cross-check state).
- The temporary `localStorage`-persistence function and its two call sites removed from `main.ts`; the per-run `freshResult()`/invocation-counter fix (a genuine bug fix, not cross-check-specific) was kept.
- The Tauri app process and its `beforeDevCommand` vite server were terminated (`kill`) once the cross-check concluded.
- `tsc --noEmit` and the full `vitest` suite (60/60) re-run clean after all reverts.

#### Still open (unchanged from the original pass)

- **Windows/WebView2** remains untested in any pass (no Windows machine available in this session). Section 1.2 already establishes this as low-risk (evergreen Chromium), so it stays a lower priority than the WKWebView gap was.
- **Only one macOS version was tested** (26.5.2, current at time of writing) and **only one asset's GOP shape**. Section 1.2's cited floor (macOS 13.3/Safari 16.4 for video-only WebCodecs) and its concern about older-WebKit B-frame bugs are about *older* WebKit builds specifically — this cross-check's clean result on a very current WebKit build does not extend backward to that floor. Treat the macOS-version-matrix question as still open for Phase 8's regression pass, not resolved by this one data point.
- Arbitrary user-uploaded container/codec shapes (non-clean MP4s, unusual profiles) remain untested on both engines, per Section 6's existing risk entry.

#### Recommendation

**Proceed to Phase 1 implementation planning — the feasibility gate Section 1.5 required is now closed on both engines this project ships to a real browser-engine test on.** The one thing this cross-check could not do — test older macOS/WebKit versions or Windows — is appropriately deferred to Phase 8's broader regression pass rather than blocking Phase 1 from starting.


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
