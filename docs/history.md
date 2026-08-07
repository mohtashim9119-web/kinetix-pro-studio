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
| 2026-05-21 | **Fidelity Polish commit `94f8a37`:** Add `useTransitionPreview` hook (file deleted in `2015218` at the WebGL2 Phase 5 cutover) — pre-roll snapshot approach; renders outgoing+incoming frames to offscreen 960×540 canvases ~400ms before transition window; `pendingKeyRef` prevents concurrent renders; keyed by `"${outId}:${inId}"` for stale-snapshot safety. |
| 2026-05-21 | **Fidelity Polish commit `0c49339`:** Render preview transitions via canvas overlay — `PreviewStage.tsx` adds a `<canvas>` overlay at z-index 45 driven by `useTransitionPreview`; calls `applyTransitionBlend` each animation frame during the transition window; opacity fade in/out at window edges. |
| 2026-05-21 | **Fidelity Polish commit `ea5ba65`:** Cleanup pass on `useTransitionPreview` — sort `nextSeg` by `startTime` for robust lookup on unsorted segment arrays; add `mountedRef` guard so async `renderSegmentFrame` never calls `setSnapshots` after hook unmounts. |
| 2026-05-21 | **Fidelity Polish commit `136b1ac`:** Update CLAUDE.md — add `canvasAnimations.ts` and `useTransitionPreview.ts` to File Map; resolve Known Bugs (trimEnd) and Known Limitations (AnimationType canvas, overlay drag); add 9 rows to Current Refactor Status; create `docs/fidelity-polish-smoke-tests.md` with 14 test procedures [moved to docs/archived/fidelity-polish-smoke-tests.md, 2026-07-07; deleted 2026-07-19 — fully superseded by the WebGL2/WebCodecs rebuilds, no live procedure survived]. |
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
| Item 3 — Preview transitions | useTransitionPreview hook (file deleted in `2015218` at the WebGL2 Phase 5 cutover) pre-rolls outgoing+incoming snapshots; canvas overlay blends via applyTransitionBlend; mounted-ref guard for unmount safety | 94f8a37, 0c49339, ea5ba65 |
| Item 5 — Stale Known Bugs cleanup | Verified bugs already fixed in Phase 1; removed stale entries from CLAUDE.md | (CLAUDE.md only) |
| Docs | CLAUDE.md status + Known Limitations updates; new docs/fidelity-polish-smoke-tests.md (14 procedures) [moved to docs/archived/fidelity-polish-smoke-tests.md, 2026-07-07; deleted 2026-07-19] | c6fcc64, 136b1ac |
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
| 2026-05-19 | Phase 5 smoke test doc created (`docs/phase-5-smoke-tests.md`); later archived to `docs/archived/phase-5-smoke-tests.md` on 2026-07-07; deleted 2026-07-19 (obsolete pre-Tauri export flow and UI, no live procedure survived). |
| 2026-06-17 | Divider panel + preview height fixes — `previewHeight` initializer reads from viewport; panel-toggle clamps via a `useEffect` (310ms delay); timeline floor of 140px enforced both during drag and on panel toggle. |
| 2026-06-25 | Heading-tag detection false-positive fix (`cf75695`) — `isHeadingTag` used a bare `.includes('HEADING')`, so a scene tag like `[IMAGE: heading_shot.jpg]` false-matched and the whole scene vanished from the timeline. Tightened to `/^\[HEADING\s*:/i`, matching how IMAGE/VIDEO tags are anchored. 17/17 vitest, `tsc` clean, manually verified in the Tauri app. |
| 2026-06-25 | Orphaned voiceover blob on re-stage fix (`3b0593c`) — the `oldIdx` splice in `handleApplySyncFromFiles` now pairs with `URL.revokeObjectURL` + fire-and-forget `deleteAsset(projectId, oldId)`, mirroring the existing `processMediaFile` pattern. 17/17 vitest, `tsc` clean. |
| 2026-06-26 | Review Mapping popup — post-ship polish (commits `55aacc1`, `88169fd`, `603a268`, `5bb778e`, `df52dc1`, `1447813`, `67c4547`) — scene overlay x/y wiring (lower-third default y=78, preview+export), swatch/toggle/stock-split + bg-color editor + None option, font-size/bubble-width/quote fixes, square toggle + scene row reorder + X/Y sliders, PreviewStage edge-to-edge X/Y positioning + content-based width fix (heading + scene), scene row consolidation (italic moved into formatting row, color+XY rows merged, shadow swatch removed, ban toggle relocated, toggle thumb sizing fixed), Review Mapping control converted from icon to a centered text button. Refinement of the already-delisted task 7 feature, not a new Active Task. Pushed to `origin/main` (billing block resolved; CI now manual-only `workflow_dispatch`, `e725a46`). |
| 2026-07-05 | WebCodecs preview migration (Phases 0–8) complete (branch `webcodecs-api`) — `VideoDecoder`-based decode pool + windowed decode-ahead/LRU replaced the dual-`<video>`-slot preview path; cutover to default on all WebCodecs-capable runtimes, legacy `<video>` path retained as capability-gated fallback. Full plan/evidence archived in this doc → *WebCodecs Preview Migration Phases 0–8 (Archived)*. |
| 2026-07-19 | Waveform rendered-image caching (`71fa4a0`) — two-tier cache (in-memory LRU + IndexedDB) for rendered per-segment waveform thumbnail PNGs, closing the redraw-on-every-remount gap `waveformStore.ts`'s existing peaks cache didn't cover. Verified via an instrumented trace: 294/294 cache hits on a cold app restart of the 294-segment reference project; Phase D cleanup (voiceover-replace/project-delete) user-confirmed in the real Tauri app. **The related ~4s reload-pacing problem on that same 294-segment project is NOT fixed by this work and remains open** — four hypotheses were tested and falsified this session; see `project-state.md` Active Tasks, "Waveform reload pacing," for the falsified-hypothesis record and next step (Safari Web Inspector profiling, not yet done). |

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
and `useTransitionPreview.ts` (file deleted in `2015218` at the WebGL2 Phase 5 cutover)/`PreviewStage.tsx`:
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
<summary>Export Rendering Profiling — Phase 7 Task 1 (Archived, migrated from the deleted docs/phase-7-task-1-export-profiling.md) — measured 2026-06 era, macOS Intel</summary>

Per-phase `performance.now()` instrumentation on a 4-video-segment (~3s each, 12s total), 1080p/30fps test project with FADE transitions, voiceover, and heading text, profiled via a Tauri dev build (`frameRenderer.ts` split into `videoSeek`/`renderDraw`; `segmentEncoder.ts`'s `toBlob`/`ffmpegExec`; `tauriFfmpeg.ts`'s `b64encode`/`ipcWrite`; `exportPipeline.ts`'s `concat`/`mux`).

**Per-frame phases (355 video frames):**

| Phase | Mean/frame (ms) | Share of frame loop |
|---|---|---|
| `toBlob` (canvas.toBlob + arrayBuffer) | 203.6 | **47.2%** |
| `ipcWrite` (Tauri invoke) | 123.8 | **29.2%** |
| `videoSeek` (await `seeked` event) | 57.4 | 13.3% |
| `b64encode` (bytesToBase64) | 43.3 | 10.2% |
| `renderDraw` (draw + filter + overlay + animation) | 0.3 | **0.1%** |

**Per-segment/per-export:** `ffmpegExec` (libx264) 2,737ms mean × 4 segments (10.9s of ~240s total); `concat` 156ms; `mux` 366ms; `saveDialog` 86,759ms (mostly user wait time for the native save dialog).

**Finding:** export was I/O-bound, not render-bound — the actual canvas rendering (`renderDraw`) was essentially free at 0.1% of frame time. The bottleneck was PNG encoding (`toBlob`) and writing PNGs through IPC (`ipcWrite`), together 76% of all per-frame work. This is the figure this file's WebGL2 Root-Cause Audit cites when correcting the assumption that Canvas2D drawing itself was the export bottleneck (it never was) — the WebGL rebuild's export value is architectural (a `VideoFrame`-native compositor an encoder can consume directly), not "faster drawImage."

**Recommendation:** OffscreenCanvas + Web Worker pipelined PNG encode (`convertToBlob` off the main thread, overlapping with next-frame render), projected 40–55% frame-loop reduction. **Shipped as recommended in commit `cd7ea2b`** — see the "Export pipelining speedup" entry immediately below. WebCodecs `VideoEncoder` was considered and rejected at the time (WebKit support recency/inconsistency, would require re-architecting the audio mux/concat steps) — kept in the back pocket, later became its own tracked effort (the WebCodecs architecture-shift plan, since archived/deleted — see the "WebCodecs + WebGL2 Worker Export — Implementation Record" section below for what actually shipped).

</details>

<details>
<summary>Export pipelining speedup — worker-pool PNG encode + raw-binary IPC write — ✅ DONE 2026-07-09 (commit cd7ea2b)</summary>

Implements the OffscreenCanvas/Worker speedup the Export Rendering Profiling record above had already identified as the next export-speed candidate (per-frame `canvas.toBlob('image/png')` was ~47% of per-frame wall time, blocking the next frame's render). Two changes, both additive with a sequential fallback:
- **Worker-pool PNG encode:** new `src/services/frameEncodeWorker.ts` — a small pool of dedicated workers (capped at 4, `hardwareConcurrency - 1`) each own a reused `OffscreenCanvas`; `segmentEncoder.ts`'s `encodeSegment` now renders frame N+1 on the main thread while a worker PNG-encodes frame N, transferring the `ImageData` buffer zero-copy, with a bounded in-flight queue (`pool.size + 1`) for backpressure. Frames complete out of order but are written to their own indexed filename, so ordering doesn't depend on completion order. Falls back to the original fully-sequential main-thread `canvas.toBlob` loop when `Worker`/`OffscreenCanvas`/`convertToBlob` is unavailable — byte-identical output either way.
- **Raw-binary IPC write:** new Rust command `ffmpeg_write_file_raw` (`ffmpeg.rs`) takes the frame bytes as a Tauri v2 raw invoke body (session id + path as headers) instead of a base64-encoded JSON field, and `TauriFfmpeg.writeFileRaw()` (`tauriFfmpeg.ts`) calls it. `segmentEncoder.ts` prefers `ffmpeg.writeFileRaw` when the `FfmpegLike` implementer provides it (optional on the interface), falling back to the existing base64 `writeFile` otherwise — removes the per-frame base64 encode (JS) + inflated-string IPC transfer + base64 decode (Rust) that was layered on top of the original 2026-05-27 base64-IPC speedup (`551s → 120s`, Decisions Log).

`tsc --noEmit` clean, `vitest` 277/277 (no test-count change — scheduling/transport change only, behavior-identical). Not yet benchmarked end-to-end in a real Tauri export — the Quick Stats export-speed figures below predate this change and should be treated as pending re-measurement, not as still-current numbers for this path.
</details>

<details>
<summary>Path B — separate heading layer refactor — ✅ COMPLETE (Phases 0–7) — 2026-07-09</summary>

Full design-decision record: see the "Path B — Separate Heading Layer — Design Decisions (Archived)" entry immediately below. Resolved deferred bugs D4 + D5 structurally by lifting headings out of the segments array into a dedicated, absolute-time-addressed overlay layer (`Project.headings: HeadingOverlay[]`), fully independent of segment timing math. Phases 1–6 built the new system alongside the old in-array system (`isHeading`/`headingConfig`) to protect the regression-locked `syncTiming.test.ts` suite during the transition; Phase 7 (final) deleted the legacy system entirely once the Phase 6 manual gate passed.

**Phase 7 (final deletion):** removed `isHeading`/`headingConfig` from `VideoSegment` (`types.ts`); deleted `computeHeadingAnchors`, `reinsertHeadings`, `stealDurationFromNeighbors`, `giveDurationToNeighbors` (`syncEngine.ts`) and `applyHeadingTiming` (`whisperService.ts`); simplified `applyAnchorBasedTiming` to content-only; swept every remaining `isHeading` reference out of `App.tsx`, `PreviewStage.tsx`, `Timeline.tsx`, `DropZonePanel.tsx`, `ReviewMappingModal.tsx`, `SegmentControls.tsx`, `BottomDrawer.tsx`, `useFirstFrameCache.ts`, `useWebCodecsPreview.ts`, `frameRenderer.ts`, `plainSegment.ts`. Rewrote `syncTiming.test.ts`'s Σ-duration invariant tests as content-only and updated `lockedOverlap.test.ts`/`plainSegment.test.ts` to drop in-array-heading fixtures.

Key invariants updated: (b) Σ **content**-segment duration = voiceoverDuration (headings excluded, own no timeline seconds); (c) headings are the separate top-level `HeadingOverlay[]` layer (`project.headings`), not segment-array entries — see Key Invariants section below.

`tsc --noEmit` clean, `vitest` 263/263. Manually verified end-to-end in the Tauri app: create/edit/drag-resize heading, re-sync clamp+`needsReview` badge, export with headings over both plain and composited (overlapping) segments.

</details>

<details>
<summary>Path B — Separate Heading Layer — Design Decisions (Archived, migrated from the deleted docs/archived/path-b-heading-layer-plan.md) — locked 2026-07-08, all phases complete 2026-07-09</summary>

**Goal:** Lift headings out of the segments array into a dedicated, absolute-time-addressed overlay layer (`Project.headings: HeadingOverlay[]`), so the sync/duration pipeline ignores headings entirely and invariant (b) (Σ segment duration = voiceoverDuration) applies to CONTENT ONLY.

**Why (root cause):** Headings were not pure overlays in code — they were first-class `VideoSegment` array members carrying real `startTime`/`duration`/`anchorStart`, occupying real timeline seconds stolen from neighbors via floating-point steal/give math (`.toFixed(3)` add/subtract across neighbors). That neighbor-perturbation was the structural root of D4 (lock/heading ops reverting manual drag edits) and D5 (locked-segment duration growing but never shrinking). Extraction dissolved both by removing the coupling rather than patching the math.

Six design decisions, locked 2026-07-08:

- **Decision 1 — Data model.** New top-level `Project.headings: HeadingOverlay[]` field (`types.ts`), fully separate from `segments` at every level — a genuinely independent array with its own complete styling shape (font, size, weight, color, background, x/y), not a flag on a segment. `HeadingOverlay` fields: `id`, `time` (absolute start seconds), `duration`, `text`, `fontFamily`, `fontSize`, `fontWeight`, `color`, `backgroundColor` (default opaque), `x`, `y`, `needsReview?`. Deliberately does not share shape with `TextOverlay`/`headingConfig` — independence is the point.
- **Decision 2 — Re-anchor rule.** Headings never move on re-sync, regardless of content/audio changes. If `heading.time` exceeds the new voiceoverDuration, clamp it and set `needsReview` so the user is flagged to review it — never auto-delete.
- **Decision 3 — Creation + display model.** "+ Add Heading" creates a `HeadingOverlay` at the boundary timestamp with no neighbor duration steal — overlays take no timeline seconds. The left-panel row position is derived from `heading.time` relative to segment boundaries, not stored as an array position. On the timeline/preview, a heading renders as an overlay compositing over whichever segment(s) fall within its time range, edge-draggable to grow/shrink duration, independent of segment boundaries. Headings are no longer scene boundaries (see Decision 6).
- **Decision 4 — Render model: composite-on-top.** A single shared helper `getActiveHeadingAt(headings, t)` (`src/services/headingLayer.ts`) is the one lookup used by both `PreviewStage.tsx` (preview) and `frameRenderer.ts`/`exportPipeline.ts` (export) — no per-caller reimplementation. Default `backgroundColor` stays opaque for visual parity with the old in-array heading segments. **Mandatory:** `plainSegment.ts`'s Tier 1 fast-path predicates gained a "no heading overlay intersects this segment's time range" check — a segment overlapped by a heading falls back to the canvas path (accepted perf cost; correctness first, the predicate change can only make exports slower, never wrong).
- **Decision 5 — Migration: none.** User discarded all existing test projects; no old-shape-to-new-shape migration code was built. `projectStore` defaults `headings` to `[]` when the key is absent (a default, not a migration).
- **Decision 6 — `[HEADING:]` tag: full immediate purge.** Unlike the original plan (cleanup deferred to the final phase), this was an early, explicit, standalone step (Phase 1): the parser completely ignores the `HEADING:` keyword and treats the remainder as a normal asset tag, matching and creating a normal segment exactly as `[IMAGE: filename.jpg]` would — no special-case recognition, no scene-boundary behavior, no heading creation from scene-doc text, ever. Retired `isHeadingTag` (`App.tsx`), the `/^\[HEADING\s*:/i` exclusion filter (`textUtils.ts`), and the old boundary-behavior fixtures in `sceneTagParsing.test.ts`.

**Approach:** built alongside the old in-array system through Phase 6 (justified only by protecting the regression-locked `syncTiming.test.ts` suite during the transition, not by data-migration safety — Decision 5 needed none); Phase 7 deleted the legacy system entirely once the Phase 6 manual verification gate passed. All 8 phases (0–7) completed 2026-07-08/09 — see the "Path B — separate heading layer refactor — ✅ COMPLETE" entry above for the phase-by-phase build/deletion log.

</details>

D4 + D5 converted into the Path B: Separate Heading Layer roadmap (see "Path B — Separate Heading Layer — Design Decisions (Archived)" above) — they were symptoms of heading/segment coupling that Path B removed. Not fixed individually (targeted fixes rejected as low-value). Deferred as of 2026-07-02; Path B was subsequently completed on 2026-07-09 (Phases 0–7) — see the "Path B — separate heading layer refactor — ✅ COMPLETE" Completed Work entry above.
<details>
<summary>Exported-video judder — ✅ FIXED, two contributing causes (commits `f39e23f`, `8ecf5ef`) — 2026-07-09</summary>

Investigation (audit-only turns) found two independent, additive contributors to the reported judder, both on the canvas/composited export path (Tier 1/Tier 2 plain-segment fast paths were never affected):

- **Cause 1 — fps mismatch:** `exportFps` was a fixed 30fps default with no knowledge of the source clip's native frame rate, so the canvas path's fixed-interval `<video>` seeks resampled every source clip to an arbitrary rate regardless of what it was actually shot/encoded at. **Fix (`f39e23f`):** new `probe_video_fps` Rust command (mirrors `probe_audio_duration`) probes each video asset's native fps at stage/import time (Apply Sync, zip import, stock search) and stores it as `Asset.nativeFps`; a new effect in `App.tsx` auto-sets `exportFps` to the staged videos' native rate when they all agree (bucketed to the nearest of `{24, 30, 60}`), deferring permanently to the user's own choice the moment they touch the Frame Rate dropdown, and flagging (not guessing) when native fps values are mixed. No per-segment retiming; Tier-1's ffmpeg `-r` fast path was untouched.
- **Cause 2 — seek/paint race:** even after the fps fix, `frameRenderer.ts`'s `seekVideo` only awaited the DOM `seeked` event before `drawImage`, which doesn't guarantee the decoder has actually submitted the target frame for compositing — the same race `PreviewStage.tsx` had already proven out for the preview path (D10 fix) via a `requestVideoFrameCallback`-based wait. A `seeked`-only wait can silently capture the still-resident previous frame, producing irregular duplicate-frame judder independent of any fps setting. **Fix (`8ecf5ef`):** extracted the proven `waitForVideoFrame` helper (rVFC primary, `seeked`+rAF fallback, timeout failsafe) out of `PreviewStage.tsx` into a shared `src/services/waitForVideoFrame.ts`, and layered it onto `seekVideo`'s existing `awaitSeeked` step — `awaitSeeked`'s own error/5s-timeout handling is kept, so a genuinely broken seek still surfaces as a real `'encode'` error via `exportPipeline.ts` instead of silently producing wrong frames.

**Verification:** `tsc --noEmit` clean and `vitest` 263/263 after both commits (no test count change — neither fix touched `segmentEncoder.ts`'s frame-loop timing math or the Tier-1/Tier-2 fast paths). Dev-preview regression check confirmed the `PreviewStage.tsx` extraction is behavior-identical (no console errors, Export Quality UI unchanged). The seek/paint race fix itself can't be exercised outside a real Tauri export run (native ffmpeg sidecar), so it's verified by code trace + the first-party precedent (`PreviewStage.tsx`'s own D10 fix) rather than an observed before/after export.

**Residual, not fixed:** a much lower-amplitude version of Cause 1 remains — `nearestExportFps` rounds to exact `{24, 30, 60}`, not true NTSC rates (23.976/29.97/59.94), so a ~0.1%/frame phase drift can still recur over long segments. Logged as **D17 — accepted won't-fix, not an open bug.** The larger structural fix (ffmpeg-driven frame-accurate decode feeding the canvas compositor, eliminating `<video>`-element seeking entirely) was scoped in the audit but deliberately deferred rather than pursued — a measured, permanent decision, not a placeholder pending someone getting to it — see Decisions Log. (The former project-state.md "Ignored Low Risk Bugs" section this was originally logged under was removed 2026-07-20 once D11/D13/D15 were fixed; D17 itself was never fixed and its status is unchanged — this entry is its sole surviving record.)
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

- **Part 1 — Root-cause audit of the CSS/Canvas2D effects engine.** Full findings in Section 1. Key outcomes: (a) confirmed the dual-implementation and dual-video-sourcing structural problems with file/line evidence; (b) traced four shipped historical bugs to the same layer-synchronization root cause and explained the mechanism in each; (c) **corrected** the export-side slowness claim — Canvas2D *drawing* was never the bottleneck (measured 0.1% of frame time — see the "Export Rendering Profiling — Phase 7 Task 1" archived entry above); the export cost is the readback→PNG→IPC architecture *around* the canvas plus `<video>`-element seeking, most of which commit `cd7ea2b` already addressed (pending re-benchmark). The WebGL rebuild's export value is architectural (a `VideoFrame`-native compositor an encoder can consume directly), not "faster drawImage."
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
  - `compositeParams.ts`: `deriveCompositeParams(segments, currentTime, config)` — pure, no React/DOM/pool dependency (same role `toSourceTime`/`computeKeepSet` play for the decode side, `src/hooks/useWebCodecsPreview.ts`). Reuses `resolveEffectiveTransition` (`src/services/transitionResolver.ts`, imported unmodified) for transition selection so this can't drift from the legacy Canvas2D path's own selection logic, and replicates `useTransitionPreview.ts` (file deleted in `2015218` at the WebGL2 Phase 5 cutover)'s active-blend window math (minus that hook's pre-roll/pool-prefetch bookkeeping, which is a preview-buffering concern, not a per-tick compositing one). Scoped to exactly the 4 transitions + 2 zooms Section 5 lists — a resolved legacy-enum transition, an unscoped slug, or any of the other 11 `AnimationType`s all resolve to `null`/neutral (`animScale: 1`) by design, since the GL compositor doesn't implement them. Deliberately does not decide which content belongs in texture slot 'a' vs 'b' — that's a Phase 3 integration concern.
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

- **Transition-centering fix (2026-07-10) — closes D7, a pre-existing bug not scoped to this plan's own phases.** (D7 was originally logged in project-state.md's now-removed "Ignored Low Risk Bugs" section — that section was deleted 2026-07-20 once D11/D13/D15 were fixed; D7 itself was already fixed here, well before that section's removal.) All transitions previously played entirely AFTER the A/B boundary (window `[B.start, B.start+duration)`, a 100%-after/0%-before split — the "known 100/0-split timing question" Section 5.1 originally deferred). This was a **deliberate semantic change**, applied identically to preview and export so the two stay in parity: the window is now centered on the boundary, `[B.start - duration/2, B.start + duration/2)`, progress 0→1 linear across it, landing at exactly 0.5 at the boundary itself.
  - **Shared fix, one source:** `resolveTransitionProgress(boundaryTime, duration, currentTime)` added to `transitionResolver.ts` — the single centered-window arithmetic now used by `compositeParams.ts` (GL preview — dev-gated through Phase 4; the gate was removed at the Phase 5 cutover (`2015218`) and it is now production-default), `useTransitionPreview.ts` (legacy preview, the shipped default at the time; file deleted in `2015218` at the WebGL2 Phase 5 cutover), and `segmentEncoder.ts` (native export, via a new `resolveBlendFrameParams` wrapping it for segment-local blend math). No independent hand-duplicated window math remains in any of the three.
  - **`compositeParams.ts` restructured:** `findContainingSegment`'s bounds-containment could no longer stand in for "the incoming side of the active transition" — under centering, the pre-boundary half of the window sits bounds-inside the OUTGOING segment. `resolveTransition`/`findPrevSegment` were replaced by `resolveActiveBoundary`, which iterates adjacent segment pairs directly (via a new `findNextSegment`) rather than inferring pairing from where `currentTime` happens to bounds-fall. Both `deriveCompositeParams` and `deriveSlotPlan` now call this one function, so the two can't disagree on which two segments are involved — `deriveSlotPlan` gained a required 4th `config` param as a consequence (it needs `resolveEffectiveTransition` to re-derive the pair, not just a null/non-null activation gate).
  - **`useTransitionPreview.ts` restructured:** the old "candidate A = pre-roll only, candidate B = the real active window" split (candidate A was NEVER blending, only pre-roll bookkeeping, because the window used to sit entirely inside candidate B's own span) now has candidate A become genuinely active — blending, not just pre-roll — for its own last `duration/2` seconds. `PRE_ROLL_LEAD_S` lead-in now triggers ahead of the (now-earlier) window open instead of the old window open.
  - **`segmentEncoder.ts`/`exportPipeline.ts`:** `startTimeOffset`/`trailingExtension` halved (each now `duration/2` instead of the full `duration`) since the blend zone straddles the boundary instead of sitting entirely past it. New `resolveBlendFrameParams(timeInSegment, segmentDuration, transitionDuration)` computes the blend zone in segment-local time; the incoming segment's rendered content is held at its own true `t=0` through the ENTIRE pre-boundary half (never asked to seek before its own official start — no source "handle" past `trimStart` required) and advances forward from 0 only in the post-boundary half. This intentionally matches `useTransitionPreview.ts`'s pre-existing static-snapshot design (which already held the incoming clip's frame-at-0 fixed through the whole window) — preview and export now agree on what the incoming side visually shows, not merely on the timing.
  - **Two downstream consumers in `PreviewStage.tsx` needed matching fixes, found only by tracing what "the transition window moved" actually breaks:** (1) the caption-hold logic (`captionSegment`/`findOutgoingSegment`, itself a Phase A3 fix) assumed `currentSegment` — bounds-based, computed independently — was ALWAYS the incoming side for a window's entire active life; under centering that's only true for the post-boundary half. Fixed by exposing `outgoingSegmentId`/`incomingSegmentId` from `useTransitionPreview.ts`'s return value (the exact pair it already resolved), consumed with the old predecessor-lookup kept only as the fallback for the trailing "hold" period (where the hook's own per-render candidates have reset). (2) The B3 WebCodecs live-incoming-frame upgrade (blitting `webCodecsPreview.frame` onto the incoming snapshot canvas when decode has "caught up") relied on the same assumption — without a guard it would have blitted the OUTGOING segment's own live frame onto the incoming canvas for the entire pre-boundary half, silently, every transition. Fixed with an explicit `currentSegment?.id === transitionPreview.incomingSegmentId` gate.
  - **Follow-up gap — now CLOSED (commit `1121b76`, "Bug 1 — WebGL2 preview video-video transition blend gap").** The GL preview driver's texture-slot sourcing (`resolveVideoFrame` in `useGlPreview.ts`) had no live-pull path for the incoming segment before `useWebCodecsPreview` considered it "current," so during the pre-boundary half it fell back to blitting slot 'a' alone (no blend) — a deterministic 0-then-50 video↔video split found only in real-app manual testing, not by the mock suite. Fixed by the symmetric incoming-side chase-pull anticipated here (mirroring the existing outgoing one), plus two flicker-removal refinements. **Full mechanism and manual-verification record live in this same document's "Bug 1 — WebGL2 preview video-video transition blend gap" entry above** (single source of truth — that content was moved from project-state.md to docs/history.md during the Stage 2 docs cleanup, 2026-07-12). Closes only this case — Phase 3's broader manual verification checklist is still un-run (see IN PROGRESS below).
  - Every existing test asserting the old anchored-at-B-start timing was rewritten (not merely relaxed) for the centered spec, plus new tests explicitly pinning 50/50 centering (progress exactly 0.5 at the boundary, for both the preview-side `compositeParams.test.ts` and the export-side new `segmentEncoder.test.ts`/`transitionResolver.test.ts`). `tsc --noEmit` clean, `vitest` full suite green (401/401 at commit time). Files touched: `src/services/transitionResolver.ts` (+test), `src/services/gl/compositeParams.ts` (+test), `src/hooks/useGlPreview.ts`, `src/hooks/useTransitionPreview.ts`, `src/services/segmentEncoder.ts` (+test), `src/services/exportPipeline.ts`, `src/components/PreviewStage.tsx`.

### 1. Root-Cause Audit — Why CSS/Canvas2D Effects Rendering Is Structurally Bug-Prone (Part 1)

The current effects engine is not one engine. Every visual effect exists as **two to three independent implementations across three rendering technologies** (DOM/CSS transforms via Framer Motion wrappers, Canvas2D `ctx` transforms, and offscreen-canvas snapshot blending), and those implementations are synchronized against playback state (play/pause/seek/boundary-crossing) by hand-written React effect choreography. Each finding below is evidenced from shipped code and this repo's own bug history.

#### 1.1 The dual-implementation problem: every animation exists twice

- **Preview:** `PreviewStage.tsx:54` (`getAnimationWrapperProps`) — 13 `AnimationType` cases emitting CSS `transform`/`opacity`/`filter` strings applied to a wrapper `motion.div` around the media element.
- **Export:** `canvasAnimations.ts:118` (`applySegmentAnimation`) — the same 13 cases as Canvas2D `ctx.translate/scale/rotate/transform` calls inside `frameRenderer.ts`'s per-frame render.

Two code paths, one visual contract, no mechanism enforcing they agree. This is not hypothetical drift — it shipped and had to be found by eye. **Phase A1** (2026-07-06, part of the now-superseded Preview/Export Unification follow-on plan, `docs/webcodecs-architecture-plan.md`, since archived/deleted) found and fixed exactly this class of divergence: preview's FLOAT ran a one-directional dip while export ran a bidirectional sine; preview's HEARTBEAT period was 1.5s vs export's 1.2s (visibly desyncing the same segment's preview from its own export); preview's SHAKE ran ~2.5Hz vs export's 10Hz; and preview's `repeat: Infinity` Framer keyframes free-ran on Framer's **wall clock** — ignoring pause, seek, and playback position entirely — while export was a pure function of frame time. A1's fix (share the math helpers, drive both from `timeInSegment`) narrowed the gap but did not remove the structure that produces it: the *property assignment* (CSS transform string vs `ctx` transform matrix) is still written twice, per effect, forever. The file header at `PreviewStage.tsx:33-40` now literally instructs future authors to hand-port each new animation between the two files — a standing invitation for the next A1.

The same duplication exists for transitions: `frameRenderer.ts:674` (`applyTransitionBlend`) is nominally shared by export and preview, but preview reaches it through an entirely different sourcing/compositing stack (Section 1.2), and for filters: preview applies CSS `filter` strings to elements while export sets `ctx.filter` — same string, different rasterizer, close-but-not-guaranteed-identical output.

#### 1.2 The dual video-sourcing problem: transitions blend stale pixels in preview, live pixels in export

Two fully independent video-frame-sourcing mechanisms are live in preview simultaneously:

- The **WebCodecs decode pool** (`videoDecoderPool.ts`) feeds ordinary playback — cheap per-tick `getFrameAt()` lookups once a window is warm.
- `frameRenderer.ts`'s **HTML5 `<video>`-seek cache** (`getOrCreateVideo`/`seekVideo`, `frameRenderer.ts:115/198`) feeds `useTransitionPreview.ts`'s transition snapshots — a seek-and-wait path costing **~200ms per video, ~400ms for the same-asset sequential fallback** (the hook's own `PRE_ROLL_LEAD_S` comment, `useTransitionPreview.ts:42-46`, documents these numbers; they're why pre-roll leads the window by 0.8s).

Because a ~200–400ms seek cannot run per render tick, `useTransitionPreview.ts` renders each boundary's outgoing/incoming frames to offscreen canvases **once** at pre-roll and blends those static snapshots as a pure function of `progress` for the whole transition window. That is the documented root cause of the "frozen transition frame" symptom (project-state.md, "frozen transition frame audited, deferred to Phase B", 2026-07-06 — originally also detailed in the now-deleted `webcodecs-architecture-plan.md`): the blend-draw loop reruns every tick, but the two source canvases it draws from never advance. Export never had this problem — `segmentEncoder.ts` renders every transition frame live via `renderSegmentFrame`, each sampling its own segment's advancing time — so preview and export disagree *by construction* during every transition.

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

- The "Export Rendering Profiling — Phase 7 Task 1" archived entry above (measured, macOS Intel, 355-frame project): `renderDraw` — the actual Canvas2D compositing including filters, overlays, and animation transforms — was **0.3ms/frame, 0.1% of frame-loop time**. The bottleneck was everything around it: `toBlob` PNG encode 47.2%, `ipcWrite` 29.2%, `b64encode` 10.2%, `videoSeek` 13.3%.
- Commits **`cd7ea2b`** (worker-pool pipelined PNG encode + raw-binary IPC write — eliminates the base64 round-trip and moves PNG encode off-thread, overlapping it with the next frame's render) and **`d033cb1`** (isolated blend-video cache — removes the same-URL seek thrash during transition windows) landed 2026-07-09 and target exactly those measured costs. **No post-fix end-to-end benchmark has been run** (project-state.md's Quick Stats flags the old figures as stale), so the residual export cost is currently unquantified — but by the profile's own shares, the remaining structural costs are `videoSeek` (~57ms mean/frame, a `<video>`-element seek discipline the WebCodecs decode pool would replace with sequential decode) and whatever PNG/IPC cost pipelining couldn't hide.
- **Therefore this plan does NOT claim the WebGL compositor speeds up today's export path.** Swapping `ctx.drawImage` for a GPU draw inside the existing PNG→IPC→ffmpeg pipeline would save ~0.1% and add a GPU readback. The export value of this rebuild is architectural and conditional: a compositor whose input is `VideoFrame`s and whose output surface can feed `VideoEncoder` directly (Section 4) eliminates the PNG/disk/seek architecture *entirely* — but only once the separately-tracked, still-blocked `VideoEncoder` hang risk (project-state.md Active Tasks, "Export rewrite: WebCodecs pipeline") is resolved. Until then, export stays on the existing (now-faster) pipeline, untouched by this branch. *(Historical claim, accurate as of this plan's 2026-07-10 writing — since superseded: the "still-blocked `VideoEncoder` hang risk" was never reproduced across Steps 1-8 of the WebCodecs + WebGL2 Worker Export implementation's real-WKWebView testing on macOS Intel x86_64, and that work reuses this very compositor unchanged as its GL composite stage. See `docs/history.md` → "WebCodecs + WebGL2 Worker Export — Implementation Record" and `project-state.md`'s Active Tasks for current status — 8 of 9 steps complete, only production-build verification (Step 9) and macOS arm64/Windows cross-platform verification remain open.)*

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

> **Archived 2026-07-12** (Stage 3 doc cleanup), moved verbatim from `docs/webcodecs-architecture-plan.md`. This is the fully-complete **Phases 0–8** preview migration: the Progress Tracker plus detailed Sections 1–7, the Phase 0 Results, and the WKWebView Cross-Check. The live document retains only the active **Preview/Export Unification follow-on (Phases A–C)** and its **Section 8**. **Cross-reference note:** section numbers and named subsections cited below (“Section 1.6”, “Section 4”, “Section 5”, “Section 6”, “Section 7.1”, “Phase 0 Results”, “WKWebView Cross-Check”) refer to the original migration-plan numbering as reproduced verbatim in this block; “Section 8” and the Phases A–C follow-on were tracked in `docs/webcodecs-architecture-plan.md`, since archived/deleted (2026-07-22, Step 9) once the WebCodecs + WebGL2 Worker Export pipeline shipped in its place (see that Implementation Record below) — Phase A shipped, Phase B was superseded by that pipeline, and Phase C (quality pass — real color-space conversion + drift correction) was folded into `project-state.md`'s Deferred Polish Features rather than lost.

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
  - **`useTransitionPreview.ts` (file deleted in `2015218` at the WebGL2 Phase 5 cutover) compatibility (Section 3.3's open question) — confirmed compatible, zero changes needed.** `useTransitionPreview` never reads from `useWebCodecsPreview`'s frame output or from `PreviewStage`'s `<video>` slots at all — it renders its own outgoing/incoming snapshots independently via `frameRenderer.ts`'s `renderSegmentFrame()` (which seeks its own offscreen `<video>` elements via `getOrCreateVideo`, a completely separate code path from both the legacy dual-slot machinery and the new WebCodecs decoder pool). Since `frameRenderer.ts` is on this plan's explicit do-not-touch list, `useTransitionPreview.ts` is guaranteed byte-for-byte unmodified in behavior regardless of which video path is currently painting the live segment. Verified in the manual test below: transitions were not exercised (test fixture used `TransitionType.NONE`), but the code-path independence is structural, not timing-dependent — no further validation is needed to trust this finding. Section 3.3's speculative "may need a WebCodecs-aware variant" concern does not apply; no fix is needed, now or in a later phase, for this specific compatibility question.
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

## Waveform Rewrite — Implementation Record (Archived)

> Archived 2026-07-19 (doc cleanup), migrated from the now-deleted `docs/waveform-rewrite-plan.md`. All 7 steps below shipped and are stable; nothing here is open. The still-open reload-pacing problem this rewrite's later caching follow-on surfaced is tracked separately — see `project-state.md` Active Tasks, "Waveform reload pacing."

Replaced the timeline's old fixed-300-bar, whole-track DOM waveform (mean-sampled, one bar per screen slice regardless of segment count — ~4 bars/segment on the 294-segment/21-minute reference project) with a per-segment, peak-based, Canvas 2D mirrored-fill waveform (CapCut/Premiere style), plus a new Apply-Sync loading screen that front-loads drawing every segment's waveform before the editable timeline is revealed.

| Step | What | Status |
|---|---|---|
| 1 | Chunked decode pipeline — `waveformPipeline.ts`'s yielding twin of the synchronous peak builder (`buildSourceChunked`), called once from Apply Sync + the reload effect, never from a render-triggered effect | ✅ `f3d429e` |
| 2 | Async draw queue — `waveformDrawQueue.ts` + `SegmentWaveform.tsx`'s off-screen-canvas → `<img>` draw, batched across frames instead of one synchronous flush | ✅ `f3d429e` |
| 3 | Peak density tuning — `PEAKS_PER_SECOND` retuned from the originally-planned 200 (`ppsMax(100) × DPR_CAP(2)`) to a shipped **10**, after the 200/sec design was diagnosed as the dominant cost in a ~2.5-minute Apply-Sync freeze on the 294-segment reference project. Evaluated 200/6/30/10; settled on 10/sec as good-enough visual fidelity at acceptable build cost — a deliberate, permanent product choice, decoupled from `WAVEFORM_MAX_PPS × WAVEFORM_DPR_CAP` on purpose. Accepted tradeoff: waveforms are visibly coarser at high timeline zoom (the "≥1 peak column per backing pixel at max zoom" guarantee no longer holds). | ✅ `f3d429e` |
| 4 | Ready-tracker — `waveformReadyTracker.ts`, a generation-tagged draw-completion registry (counter + promise, since canvases mount on the commit after `setProject` and don't exist yet when the wait starts) gating the loading overlay, with an 8s safety-valve timeout so a missed callback can never trap the user on the loading screen | ✅ `f3d429e` |
| 5 | Loading overlay — `SyncLoadingOverlay.tsx`, spanning both the pre-waveform sync phase and the waveform-draw phase, with stage-based rotating status text (including a live `drawn/expected` count) | ✅ `f3d429e` |
| 6 | Legacy 300-bar system removal — `ENABLE_LEGACY_BARS`, `buildLegacyBars`, `LEGACY_BAR_COUNT`, `waveformBars` state, and the DOM-bar lane JSX deleted outright, not flagged off | ✅ `f3d429e` |
| 7 | Waveform-peaks persistence (addendum beyond the original 6-step plan) — `waveformStore.ts`, an IndexedDB cache keyed by `[projectId, assetId]` + a blob-size invalidation guard, wired into the decode read/write paths and all three eviction points (voiceover replace ×2, project delete). Closed a real gap: every project reload previously re-ran the full decode + peak-extraction pass unconditionally, even for a byte-identical voiceover, because only the blob round-tripped through IndexedDB — the small `Float32Array` of reduced peaks never did. | ✅ committed `e7efce5` |

**Redraw-trigger discipline (the highest-risk area of this rewrite, worth preserving as a standing invariant):** a segment's canvas redraws **only** on (1) initial draw during the Apply-Sync loading phase, (2) reload draw when peaks first become available, and (3) resize-drag **commit** (mouseup, via `applyDurationChange` — never during the live drag itself, which only stretches the existing bitmap via the container's `style.width`). Scroll (manual, auto-scroll, zoom-center, persisted restore), the ~16ms playback tick, zoom-level change, window resize, and unrelated parent re-renders must **never** trigger a redraw — an earlier attempt this effort accidentally wired redraws to scroll events and had to be fully reverted before landing the discipline above. Enforced via a `React.memo` comparator on `SegmentWaveform` and a redraw effect whose dependency array is `[source, segment.id, segment.startTime, segment.duration]` only.

**Mitigation budgeted but not needed:** the plan flagged a risk that WKWebView's accelerated-canvas-count ceiling (294 simultaneous live canvases) could cause blanking/jank, with an `ImageBitmap`/`<img>` fallback budgeted as mitigation #1. Plain per-segment `<canvas>` shipped without hitting this ceiling in practice; the fallback was never needed.

The waveform rendered-image caching follow-on effort (`docs/waveform-image-cache-plan.md`, now deleted) is closed and already recorded in this file's 2026-07-19 Quick Log entry ("Waveform rendered-image caching..." above); its still-open reload-pacing investigation was migrated to `project-state.md` Active Tasks rather than staying in a standalone doc.

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
| 2026-07-02 | D4/D5 will NOT get targeted fixes. Both fold into Path B (separate heading layer — see "Path B — Separate Heading Layer — Design Decisions (Archived)"), deferred at the time. (Path B was subsequently completed 2026-07-09 — see the Path B Completed Work entry.) Active-bug list now empty; next focus = export speed + app performance. |
| 2026-07-02 | **CRF 16 for export, not pixel-identical:** chose `libx264 -crf 16` (visually-lossless YouTube master) over chasing a pixel-identical re-encode. A truly pixel-identical path would require JPEG-frame passthrough or a hardware encoder, both ruled out — JPEG intermediates reintroduce generational loss before libx264 ever sees the frame, and hardware encoders (VideoToolbox/NVENC/QSV) aren't guaranteed present or bit-consistent across the Windows/macOS Intel/macOS arm64 targets this app ships to. CRF 16 gets visual quality close enough for the intended use (YouTube upload) without either tradeoff. |
| 2026-07-02 | **Two-tier export: plain segments bypass canvas entirely.** Any segment with no per-frame compositing (no caption, overlay, transition edge, filter, animation, or speed change) now skips the canvas/PNG/IPC render pipeline and goes through ffmpeg directly — one trim+encode for video (`e8eba95`), one frame + `-loop`/`-frames:v` for images (`bf003d1`). Composited segments (anything with an active effect) still render through the full per-frame `frameRenderer.ts` canvas path unchanged. The predicate (`isPlainMediaSegment` in `src/services/plainSegment.ts`) is deliberately conservative — anything it isn't certain is plain falls back to the canvas path, so quality/correctness never regresses, only speed varies. |
| 2026-07-02 | **Live timeline drag stays off React state.** Resize/divider drags no longer route their per-`mousemove` live-preview through `setProject` — App.tsx isn't decomposed/memoized, so any state update during a drag re-rendered the entire tree every frame. Live visual feedback is now a direct DOM write (`el.style.width` via `data-seg-id`, rAF-coalesced); the real state commit still happens exactly once, on mouseup, through the pre-existing `applyDurationChange` cascade — so final dropped values are provably unchanged (Phase A audit confirmed mouseup already fully committed independent of the per-move state, `f4da926`). Memoizing the heavy children (`PreviewStage`, `DropZonePanel`, `Timeline`, `BottomDrawer`) so `setProject` mid-drag would be cheap was considered and deliberately deferred — the ref/DOM approach is a superset fix that also eliminates the per-frame reflow width causes, not just the re-render cost. |
| 2026-07-07 | **Scene-tag/asset-matching fixes (`9b15a59`):** extension-agnostic exact match (strip file extensions on both sides before comparing, so `photo.jpg` matches an uploaded `photo.png`-renamed-to-`.jpg` case that previously failed), RTF bare-tag support (paste-from-RTF scene lists that lose their bracket formatting still resolve), and a new `unmatchedExplicitTag` flag that stops a failed *explicit* tag match from silently falling back to fuzzy-matching some other, wrong asset — an explicit tag that can't resolve now surfaces as genuinely unmatched instead of guessing. Informed by two read-only audits this session (now-deleted `docs/archived/audit-scene-sync-flow.md`, now-deleted `docs/audit-tag-format-change.md`). `tsc --noEmit` clean, `vitest` 205/205 at the time. |
| 2026-07-07 | **D16 — script/Whisper alignment cascade fix (`cdc1eb1`):** root-caused a Whisper-alignment desync triggered by spoken numbers (e.g. script says "37," Whisper transcribes "thirty-seven") and similar contraction/symbol mismatches — one mismatched token was throwing off the sliding-window cursor for every subsequent word, cascading into wrong segment boundaries later in the transcript. Fixed via `canonicalizeForAlignment` (normalizes numbers/contractions/symbols before comparison) plus a cursor confidence guard in `src/services/whisperService.ts`, plus 11 new tests. `tsc --noEmit` clean, `vitest` 216/216. **Residual risk, not yet closed:** the "years spoken-form" convention used by `canonicalizeForAlignment` (pair-reading, e.g. "2024" → "twenty twenty four") was chosen from general whisper.cpp behavior, not confirmed against a real transcript in this repo — see Active Tasks. |
| 2026-07-07 | **D16 follow-up — overshoot into next segment's word range (`aa12206`):** real-project verification of D16 surfaced a second, non-cascading failure mode — a low-confidence match's `bestStart` landing far ahead of the search cursor (a spurious match against unspoken caption-style text) anchored that segment's `t1` past the *next* segment's true start, collapsing both to near-zero/negative duration, without triggering D16's cascade guard (which only protects the forward cursor, not the corrupted segment's own span). Root-caused via temporary instrumentation (added and fully removed across three audit-only turns, confirmed via grep). Fixed by (1) an overshoot guard in `whisperService.ts` that re-anchors an overshooting low-confidence match to the cursor, and (2) a backstop monotonic-anchor clamp in `syncEngine.ts`'s `applyAnchorBasedTiming`. Verified against the user's real transcript: fires on exactly the 5 genuinely-broken segments (of 13 low-confidence total), zero false positives on the 8 safe ones, zero `[anchor] out-of-order` warnings post-fix (previously 2). 4 new regression tests, 1 pre-existing Part C assertion updated (reflects the fix's correct, uncollapsed placement, not a masking change — see the D16 Completed Work entry for the full trace). `tsc --noEmit` clean, `vitest` 220/220. |
| 2026-07-08 | **D16 pair-reading years convention CONFIRMED — Active Tasks item closed.** User ran a real end-to-end test (script + scene doc, real voiceover) containing three pair-reading-form years: "nineteen eighty seven" (1987), "twenty twenty four" (2024), "nineteen ninety nine" (1999). All three fall inside the existing pair-reading guard (4-digit token, `n % 100 >= 10`) and all three synced correctly. Combined with the earlier cardinal-form confirmation ("2003" / "two thousand and three"), both branches of `canonicalizeForAlignment`'s year-handling are now verified against real data — no further action needed on this item. |
| 2026-07-08 | **D16 second follow-up — mixed alnum token digit-extraction ("ninety seven percent"):** the same real test that closed the years item failed on exactly one phrase. Root cause (audited, `TEMP-AUDIT-PERCENT` instrumentation added + fully removed): `canonicalizeForAlignment` gated digit-to-words expansion on a *whole-token* `/^\d+$/` test, so a token where whisper.cpp's `-ml 1` boundary heuristic glued a preceding function word onto the number with no space (e.g. `to97%` → tokens `["to97","percent"]`) never expanded the number — `"to97"` stayed an unmatchable literal and the spelled-out script side couldn't match. DISTINCT from and upstream of the aa12206 overshoot (that guard contains a bad match's blast radius; this is the earlier miss that produces the bad match). The `%`→"percent" handling itself was never at fault (`canon("97%")` was always correct). Fixed as a strict additive extension: a token failing `/^\d+$/` but containing a digit is split on `/\d+|\D+/g`, each digit run expanded via the existing `digitTokenToWords` path, letter runs emitted as their own words in order; all previously-working token shapes keep byte-identical output. 2 new tests (unit test is the strict guard — verified it fails when the fix is reverted; plus an integration/no-collapse aligner test). The exact real-world glued token was not captured (no transcript saved, audio not in repo), so the fix is deliberately general across any function-word+digit gluing rather than special-cased to `"to"`. `tsc --noEmit` clean, `vitest` 229/229 (227 + 2). **User manually verified the fix end-to-end on real audio** — the "ninety seven percent" segment and its neighbours now align without collapse in the full real-project flow; investigation thread closed. |
| 2026-07-09 | **Exported-video judder — two-cause fix, structural rewrite deferred.** Root-caused to two additive causes on the canvas/composited export path: (1) fixed 30fps export default with no knowledge of source native fps, fixed via native-fps probing + auto-match (`f39e23f`); (2) `frameRenderer.ts`'s `seekVideo` awaiting only the `seeked` DOM event before `drawImage`, which doesn't guarantee the decoder actually submitted the frame for compositing — fixed by reusing `PreviewStage.tsx`'s proven `requestVideoFrameCallback`-based `waitForVideoFrame` (`8ecf5ef`). The audit's larger structural fix — replacing `<video>`-element seeking with ffmpeg-driven frame-accurate decode feeding the canvas compositor, which would also close the residual NTSC bucket-rounding drift (D17) — was deliberately deferred rather than pursued now: the two landed fixes address the dominant, evidenced causes at low risk/effort, while the structural rewrite is a larger effort better suited to (or superseded by) the planned WebCodecs preview/export unification (originally tracked as Section 8 of `docs/webcodecs-architecture-plan.md`, since archived/deleted — see the WebCodecs + WebGL2 Worker Export Implementation Record below for what shipped in its place). |


---

## WebGL2 Effects Engine — Full Plan (Archived 2026-07-20)

> Archived from `docs/webgl-architecture-plan.md` on 2026-07-20 after the WebGL2 effects-engine rebuild completed all 6 phases. The plan doc is deleted from the repo after this archival. This record preserves the full plan, progress tracker, risk register, and merge-gate criteria for historical reference. Cross-references throughout the codebase that previously pointed to `docs/webgl-architecture-plan.md` now point to this archived section in `docs/history.md` instead.

**Original document title:** WebGL2 Effects Engine — Root-Cause Audit & Phased Migration Plan


**Status:** The WebGL2 effects-engine rebuild is mid-flight on branch `webgl2-effects-engine`, fully pushed to `origin` (verified — nothing unpushed as of commit `12a1c32`). **Phases 0–3 are ✅ COMPLETE** — Phases 0–2 archived to `docs/history.md` → *WebGL2 Effects Engine — Closed Phases (Archived)*, along with the D7 transition-centering fix and the Bug 1 video-video blend-gap fix. **Phase 3 (preview integration)** is now fully complete — code, automated tests (414/414), the real-WKWebView performance re-verification, and the full manual verification checklist (all 4 transitions, zoom-across-a-transitioning-boundary, pause/seek inside an active transition window, and drag-resize suppression) have all passed, confirmed by the user in the real Tauri app. Bugs 1, 2, and 4 found during this phase are all FIXED. **Phase 4 (color grading) is ✅ COMPLETE** (per-segment manual controls + one-shot auto-adjust, built additively on the grade shader Phases 1–2 already shipped). **Phase 5 (cutover) is ✅ COMPLETE** — the dev gate is removed, the WebGL2 path (the 4 transitions, both zoom animations, and color grading) is now the production default, and the legacy CSS/Canvas2D transition machinery is deleted for the scoped effects. **Phase 6 is ✅ COMPLETE (2026-07-20 — see "Phase 6 Completion + Archive Note" at the end of this section for the full verification record).** All 6 phases of the WebGL2 effects-engine rebuild are done. Verdict: rebuild the effects-rendering engine on **WebGL2**, not WebGPU — rationale in Section 2; GO confirmed empirically on both Chromium and this project's real Tauri WKWebView, including the WebCodecs `VideoFrame` → GPU texture upload.

**Branch:** `webgl2-effects-engine` (off `webcodecs-api` @ `fd6c1d2` — verified via `git log`, not trusted from any doc). `webcodecs-api`/`main` are not touched until this effort is reviewed and merged. This branch depends on the shipped WebCodecs decode work (`videoDecoderPool.ts`/`videoDemuxer.ts`), which is why it forks from `webcodecs-api`, not `main`.

**Scope:** The effects-rendering layer only — 4 transitions (dip-to-black, dip-to-white, cross-dissolve, light-leak), 2 animations (zoom in, zoom out), and a NEW color-grading feature area (auto-adjust + manual controls; the manual control set proposed in Section 5.3 is a **proposal, not a final spec**). Explicitly OUT of scope: the overlay text/positioning system (`SegmentControls.tsx`/`ReviewMappingModal.tsx`/the DOM caption+overlay layers in `PreviewStage.tsx`) — it stays as-is; GPU-compositing overlays is possible future work, not this plan. Also out of scope: the export pipeline files (`frameRenderer.ts`, `segmentEncoder.ts`, `exportPipeline.ts`, `plainSegment.ts`, anything under `src-tauri/`), `usePlayback.ts` (audio clock), sync/timeline, and the still-blocked WebCodecs `VideoEncoder` effort (referenced as a design constraint in Section 4, never touched). *(As of this plan's writing — see the superseding note on Section 4's own end-goal statement, below, for current status: the `VideoEncoder` effort is no longer blocked.)*

**Origin of this effort:** the 2026-07-07 decision (project-state.md Decisions Log; originally also detailed in the now-deleted `docs/webcodecs-architecture-plan.md`'s Item 4 B4 entry — see this doc's own Item 4 B1-B4 entries above for the substance) to stop patching the mixed DOM/CSS + Canvas2D effects engine. The precipitating incident: Item 4's B4 sub-fix (overlay parity during live transitions) was implemented and manually tested, did **not** fix the reported symptom (animation jump/disappear during transitions), and surfaced an unrelated React "Maximum update depth exceeded" infinite-render loop in `usePlayback.ts` — the second structural surprise from this rendering approach, after Phase B's `VideoEncoder` dead end. The Root-Cause Audit (former Section 1, now archived in `docs/history.md` → *WebGL2 Effects Engine — Closed Phases (Archived)*) documents *why* this architecture keeps producing these surprises, not just that it does.

**Hard constraint — no fallback path:** per explicit user decision, once this ships there is NO fallback to the current CSS/Canvas2D effects path. This is a controlled desktop app for 5–10 internal YouTube channel teams, not a public product. Section 3.4 documents the actual minimum runtime requirement this implies (short version: **WebGL2 adds no new floor — the already-shipped WebCodecs decode dependency's macOS 13.3 floor remains the binding constraint**; WebGPU would have raised it to macOS 26, which is why it lost).

---

### Progress Tracker — Read This First

This section is the single source of truth for where this effort stands, independent of any chat session. Update it at the end of every phase, before committing that phase's work.

> **Completed phases archived.** The Progress Tracker's ✅ COMPLETED entries — Part 1 (root-cause audit), Part 2 (engine decision + feasibility spike), Phase 1 (core compositor), Phase 2 (effects build-out), the D7 transition-centering fix, and the Bug 1 video-video blend-gap fix — plus the full Root-Cause Audit (former Section 1) now live in `docs/history.md` → *WebGL2 Effects Engine — Closed Phases (Archived)*. Only the still-open work remains below.

#### ✅ COMPLETED (this phase)

- **Phase 4 — Color grading. ✅ COMPLETE (dual-gated, additive).** Per-segment brightness/contrast/saturation/temperature (each −1..1, 0-neutral) plus a one-shot histogram auto-adjust, built on the grade shader + `CompositeParams.grade` that Phases 1–2 already shipped (only the value *source* and the UI were missing — the whole GPU path was already live but fed `NEUTRAL_GRADE`):
  - **Data model (`types.ts`)** — new `SegmentGrade` interface + `VideoSegment.effectGrade?` (object-valued, mirrors `overlayConfig?`; `undefined` = neutral; defined in `types.ts` rather than imported from the gl service to keep the services→types dependency direction). Carried across Apply Sync by unique-assetId match alongside the other `effect*` fields (`App.tsx`'s carry loop).
  - **Derivation (`compositeParams.ts`)** — `deriveCompositeParams` now resolves `grade` from the CONTAINING segment's `effectGrade` (the segment `currentTime` is literally inside), falling back to the flat project-level `config.grade`, then `NEUTRAL_GRADE`. Grade is a single post-blend op (one grade-shader pass over the already-composited RT), so it can't be per-slot the way `animScaleA/B` are — it **snaps at the transition midpoint** when the containing segment flips at progress 0.5. That midpoint-snap is the ACCEPTED Phase 4 limitation (no grade cross-fade — explicitly out of scope this pass). No new plumbing in the preview driver: `segments` already flow into `deriveCompositeParams` and are a render-effect dep in `useGlPreview.ts`, so an `effectGrade` edit produces a new `segments` array → redraw. `PreviewStage.tsx`'s `glConfig` deliberately omits a grade field (its comment updated to say so).
  - **UI (`EffectsPanel.tsx`)** — new GRADE section: 4 range sliders (−1..1, step 0.01, signed readout) + Reset-to-neutral + the standard Apply-to-selected/all pair, emitting a new `{ type: 'grade' }` `ApplyEvent`. `handleApplyEffect` writes `effectGrade` (no legacy-twin reset — grade is a brand-new feature area with no CSS/Canvas2D equivalent, unlike transition/animation/overlay). `FlashButton` extended to accept an async `onAction` (backward-compatible with every existing sync caller; shows a pending label until the promise resolves) for the Auto buttons. Presets deliberately untouched (`lookPresetService` grade fields are out of scope this pass).
  - **Auto-adjust (`services/gl/autoGrade.ts`, `computeAutoGrade`)** — pure, mock-free, DOM-free: p2–p98 luma-percentile stretch solved in the grade shader's ACTUAL op order (brightness added BEFORE contrast, pivot 0.5) AND in the EFFECTIVE ranges the compositor remaps each slider into (see "Range limits" below). Each channel is solved for the effective quantity the shader applies, then converted back to the −1..1 slider domain through `compositeParams.ts`'s matching inverse — `contrast = contrastFromGain(1/(p98−p2))`, `brightness = brightnessFromOffset(0.5 − (p2+p98)/2)` — plus a half-strength gray-world temperature nudge whose strength is DERIVED from the shader coefficient × the temperature remap (`1/(2·0.1·0.4)/2` = 6.25) rather than hard-coded. `autoGrade.ts` imports those constants/inverses rather than restating the numbers, so retuning a range in `compositeParams.ts` retunes Auto with it — the two cannot drift. Saturation left 0; all channels clamped to [−1,1]; flat / near-black frames (luma range < 0.02) return neutral. Note the tightened ranges mean Auto now clamps on frames it could previously correct exactly — a clamped result is a partial correction toward the target, never an overshoot. A one-shot parameter generator, NOT a per-tick pipeline stage — the result is written as ordinary `effectGrade` values the user can then edit. `PreviewStage.tsx` owns the sampler (it holds the decode pool + assets): pulls ONE clean source frame per segment at its own start time — video via the SAME pool useWebCodecsPreview owns (`ensureSession` + `getFrameAt`, ranges from `sourceRange`/`toSourceTime`), image via a direct load — samples the RAW source (never a transition-blended output), downsamples to 160×90, runs `computeAutoGrade`. Exposed to `App.tsx` via a sampler ref; `handleAutoGrade` samples each target segment SEQUENTIALLY (bounds decode-pool pressure — a one-shot user action, not the per-tick dual-pull the Risk Register warns about), writes all successes in one `setProject`, and reports applied/failed back to the Auto button's flash — a segment with no analyzable frame (color/audio/missing/decode-fail) is a non-blocking skip, never silently swallowed.
  - **⚠️ CAVEAT (historical, resolved at Phase 5) — was dev-gated, shipped inert through Phase 4.** Color grading (like the rest of the Phase 3/4 GL path) rendered only behind the dev-only WebGL2 preview toggle (`import.meta.env.DEV && glDevToggle`, `PreviewStage.tsx`) through Phase 4 — it did nothing in a production/packaged build. **The gate was removed at the Phase 5 cutover (`2015218`)** and grading is now production-default in every build. Manual controls, Auto-adjust, live preview, Reset, Clear, and persistence (`effectGrade`) were always plain project-state writes and worked regardless — only the shader pass that visually applies the grade was gated. This was the deliberate additive/dual-gated posture every phase since Phase 3 held: toggle off = byte-identical legacy path.
  - **Grade bug audit (post-implementation, uncommitted-at-the-time review) — 3 fixes:**
    - **Fix A (root cause of "solid brown at extreme values" + "moderate values feel like nothing").** The grade shader's `u_contrast` uniform is a LINEAR gain pivot (`1 + u_contrast`); feeding it the raw −1..1 slider value made `contrast = −1` collapse every pixel to flat mid-gray (gain 0, content-independent — brightness got erased too, since it's applied before this pivot), which temperature then tinted brown. Fixed via `compositeParams.ts`'s new `contrastGainUniform`, applied only at `glCompositor.ts`'s `drawGrade` call site right before `gl.uniform1f` — `shaders.ts` untouched, `GradeParams`/`effectGrade`/the slider domain all stay −1..1 raw values. `computeAutoGrade`'s contrast solve updated to the matching inverse so Auto stays consistent with the sliders. **[SUPERSEDED — the exponential curve is now `1.6^contrast − 1`, not the `2^contrast − 1` this fix originally shipped, and the same remap treatment was extended to the other three channels. See "Range limits" below.]**
    - **Fix B (sliders never reflected the active segment's stored grade).** `EffectsPanel` previously received no segment data at all — the GRADE section's `useState` was pure local-authoring state, so Reset/Auto-adjust/segment-switching never visibly synced. Added `activeGrade`/`activeGradeSegmentId` props (App.tsx: single-selected segment if exactly one is selected, else the playhead segment, else `NEUTRAL_GRADE`), threaded through `DropZonePanel.tsx`. `GradeSection`'s new sync effect compares by VALUE (not prop object identity) against a `lastSyncRef` snapshot, so an unrelated parent re-render can't clobber an in-progress, not-yet-applied slider drag — only a real segment switch or a committed Apply/Auto-adjust re-syncs.
    - **Fix C (no way to clear an applied grade).** Reset only ever touched local draft state, never called the apply path. Renamed to "Reset sliders" (behavior unchanged, now honestly labeled) and added a new "Clear grading" control — a new `{ type: 'grade-clear' }` `ApplyEvent` whose `handleApplyEffect` case sets `effectGrade: undefined` (not a neutral `{0,0,0,0}` object, so a cleared segment is indistinguishable from one never graded). `ApplyPair` gained an optional `variant: 'apply' | 'clear'` (default `'apply'`, so every pre-existing call site is unchanged) to reuse its selected/all + FlashButton-confirmation layout for Clear.
  - **Range + interaction audit (second review round, post-Fix-A/B/C) — 3 further fixes:**
    - **Range limits — all four channels remapped (`compositeParams.ts`, `glCompositor.ts`, `autoGrade.ts`).** Fix A removed contrast's dead flat-gray state but left the practical range unusable across the whole set: ±1 additive brightness is 100% of the channel range (+0.57 already blew toward white), and any two sliders near their ends drove the frame to solid white/black — the sliders were nominally −1..1 but only the middle ~quarter was useful. Fixed by extending Fix A's "remap once at the render boundary" pattern to every channel, as exported functions + constants beside `contrastGainUniform`: `brightnessOffsetUniform` (±0.25 additive), `contrastGainUniform` (now `1.6^contrast − 1` → **0.625×–1.6×** gain, tightening Fix A's 0.5×–2× span; `1.6` is one constant that fixes BOTH ends because the exponential is symmetric in log space, and it keeps a clean log inverse), `saturationMixUniform` (×0.6 → 0.4×–1.6× mix factor; −1 is a strong desaturation, NOT full grayscale — grayscale is a look, not a range endpoint), `temperatureTintUniform` (×0.4 → ±0.04 channel shift). `shaders.ts` still untouched; `GradeParams`, persistence, the slider UI's own −1..1 bounds, and `autoGrade.ts`'s output domain are all unchanged — only the values handed to the uniforms differ. Doing the remap CPU-side keeps it unit-testable and keeps the shader a plain color-space-agnostic transform (Section 4). Two inverses (`brightnessFromOffset`, `contrastFromGain`) exported for `autoGrade.ts` to solve through. **Neutral is still exactly neutral** (every remap maps 0→0), which is what makes `glCompositor.ts`'s existing `isNeutralGrade` skip-the-grade-pass optimization sound — the skip path and the grade path cannot disagree about what neutral looks like.
    - **Live preview while dragging (`EffectsPanel.tsx`, `App.tsx`, `DropZonePanel.tsx`).** Dragging a grade slider only updated local draft state, so nothing was visible until Apply was clicked. Added an `onGradeLive` prop: `GradeSection` debounces slider input (120ms) and write-throughs `effectGrade` onto the ACTIVE segment only (the same one Fix B's `activeGrade`/`activeGradeSegmentId` identify) via a new `handleGradeLive` in `App.tsx`. Deliberately a separate lightweight setter rather than another `ApplyEvent` — it writes exactly one segment and has no scope concept; Apply-to-selected/all remains the way to push a dialed-in grade elsewhere. No preview plumbing needed: `useGlPreview.ts`'s render effect already deps on `segments`, so the write alone redraws even while paused. **This fights Fix B's sync effect by construction** — the write echoes back through `project.segments` and the effect would snap the slider back to wherever the last debounced write landed, on every write. Guarded with a `selfWriteRef` echo check (matching segment id + value ⇒ record as synced, do NOT push back into the draft); a pending write is also cancelled when the active segment changes, so a queued value can't land on the segment the user just moved to.
    - **Reset sliders now live-writes (`EffectsPanel.tsx`).** Once dragging began committing to the segment, Fix C's draft-only "Reset sliders" became incoherent — sliders read 0 over a still-graded preview. Reset now cancels any pending debounced write, resets the draft, and immediately writes a neutral `effectGrade` to the active segment (immediate, not debounced — a click is one discrete event, nothing to coalesce; but the cancel is load-bearing, or the preceding drag's queued value fires ~120ms later and silently re-grades the segment). Its `aria-label` previously promised the exact opposite ("does not change the segment's applied grade") and was corrected. **"Clear grading" (Fix C) unchanged** — it still writes `effectGrade: undefined` over a selected/all scope. The two stay semantically distinct (Reset = "explicitly graded to nothing", Clear = "never graded"); today they look identical because `PreviewStage.tsx`'s `glConfig` deliberately leaves `config.grade` unset, so both resolve to `NEUTRAL_GRADE` — they would only diverge if a project-level grade fallback is ever wired up, at which point Reset would shadow it and Clear would fall through to it.
  - **Tests: 456/456** (up from 440). `tsc --noEmit` clean. New: per-channel remap + inverse round-trip cases and an 81-combo CPU simulation of the real shader math (`compositeParams.test.ts`); Auto's re-solved brightness/contrast/temperature formulas with the superseded ones explicitly rejected (`autoGrade.test.ts`); per-channel uniform-wiring + neutral-skip cases (`glCompositor.test.ts`). The UI changes (Fixes B/C, live preview, Reset) have no component-test harness — no jsdom/@testing-library, established repo precedent — so they were verified in the running app instead (below).
  - **Verification method — real-GPU pixel sweep + manual live-app testing. ⚠️ NOT literal WKWebView.** The range claim was proven by running the REAL `GRADE_FRAGMENT_SHADER_SOURCE` on a REAL WebGL2 context over a REAL decoded video frame, sweeping all 81 extreme slider combinations through the actual remap functions and reading back pixels — measuring per-combo luma spread and solid-black/solid-white pixel percentage. Result: **0/81 unusable** (min luma spread 0.603), versus **63/81** for the original raw feed and **36/81** for Fix A alone — confirming the problem was far broader than contrast, and that the check has teeth. Brightness +0.57 (the specific report) blew 33.8% of the frame to pure white before, 1.1% after. Live preview / Reset were verified in the running app against real video with the WebGL2 toggle ON, reading the live GL canvas's pixels: drag → segment graded, preview follows, Apply never clicked; Reset → preview returns bit-identically to the ungraded baseline mean RGB. Debounce-cancel-on-Reset and cancel-on-segment-switch were each tested explicitly against a deliberately in-flight write. **Caveat:** this all ran on **Chromium + ANGLE-Metal** (the same GPU and the same ANGLE-Metal backend WKWebView uses on macOS), **not literally WKWebView** at the time. The residual risk was `precision mediump float` behaving differently — low, since mediump is effectively highp on ANGLE-Metal, but unproven at the time. **Update 2026-07-19: the color grading controls (all four sliders, live preview, Reset, Clear, Auto-adjust, Apply-to-selected/all) were verified by the user on Windows/WebView2 in the real Tauri app.** **Update 2026-07-20: verified on macOS/WKWebView on 2026-07-20** in the real Tauri app, closing the literal-WKWebView verification gap — consistent with this plan's own precedent that real-WKWebView testing has twice caught what Chromium could not (Phase 2's flip-parity bug, Phase 3's `texImage2D` perf regression).

- **Phase 3 — Preview integration, dual-gated. ✅ COMPLETE.** Code + automated tests complete; a real WKWebView performance regression was found via manual real-app testing and fixed same-day (Step 2 below); the planned manual verification checklist has now fully passed (this repo can't unit-test `PreviewStage.tsx`-level behavior — no jsdom/@testing-library/react, established precedent, so this checklist was always the true completion gate). Built exactly per Section 6 Phase 3 + the pre-flight design:
  - **`deriveSlotPlan` (`src/services/gl/compositeParams.ts`)** — the pure slot-assignment decision that module deliberately reserved for Phase 3 (see its file header). Maps `(segments, currentTime, transition)` → `{ a, b }`: slot 'a' = outgoing (previous) segment / 'b' = incoming (containing) segment during a transition (matching the shader's `u_texA` progress-0 / `u_texB` progress-1 contract), slot 'a' = current segment / 'b' = null with no transition, both null outside every segment. Originally reused the module's own private `findContainingSegment`/`findPrevSegment` so the window math couldn't drift from `deriveCompositeParams`. **Updated 2026-07-10 (transition-centering fix):** `findPrevSegment` was removed and `deriveSlotPlan` now takes a 4th `config` param, re-deriving the active pair via the shared `resolveActiveBoundary` — see "Transition-centering fix" below for why bounds-containment alone stopped being sufficient once the window centered on the boundary.
  - **`useGlPreview.ts` (`src/hooks/`)** — thin driver: owns the GL context + `GlCompositor` (acquired in a `useLayoutEffect` so it exists before the render effect on the same commit; context-loss/restore wired to `handleContextRestored`), an image cache (image/color segments), and the per-tick render (`useLayoutEffect` — the Bug-1 paint-ordering lesson). The **current/incoming** frame is `useWebCodecsPreview`'s own exposed `frame`; the **outgoing** frame is pulled from that SAME pool via the Item-4 **B3 primitives reused unmodified** (`pool.setTransitionProtectedIds` + `pool.getFrameAt` + `startChaseIfIdle`/`resetChaseMutex` imported read-only from `useWebCodecsPreview.ts`) — no parallel pool. Render is a pure function of `currentTime` (no retained transition state / wall clock / hold-release), so pause freezes and seek snaps by construction (the D12/Item-4-B4 failure class is structurally absent, not merely tested); `isResizingRef` read directly at render forces `transition = null` during a drag (D12); a not-ready slot **retains the last GL draw** rather than clearing (D10/PreviewCanvas discipline).
  - **Object-cover pre-fit (Step 1, as originally implemented)** — CPU-side 2D-canvas fit per frame per slot (reused per-slot offscreen canvases, resized only on dimension change), uploaded via the additive `UploadSource` widening (`HTMLCanvasElement | OffscreenCanvas`) on `glCompositor.ts`. Full rationale + named future work (per-texture UV-crop shader uniforms, needing a fresh real-GPU pass) in the Section 7 risk-register row added this phase.
    - **[CORRECTED 2026-07-10 — see "Step 2" below.]** This approach caused a severe WKWebView-specific performance regression, found via real-app manual testing on the simplest possible case (single video segment, no transition, no zoom) and fixed same-day.
  - **Step 2 — WKWebView performance regression found and fixed (2026-07-10).** User-reported "severe preview lag when the WebGL2 Preview toggle is ON" on a fresh, no-transition project. Root-cause audit: a real in-app A/B measurement in Chromium (`requestAnimationFrame`-delta + `PerformanceObserver('longtask')`, using this repo's own `buildSingleSegmentFixture()`) showed **zero measurable regression** — ruling out every React/JS-level structural hypothesis (effect over-firing, dependency churn, redundant pool calls, context/canvas remounting). This pointed at a WKWebView-specific slow path, confirmed via the same real-WKWebView `devUrl`-repoint/attribution/kill-check methodology as Phase 0/Phase 2 Step 1: `gl.texImage2D(HTMLCanvasElement)` (the pre-fit's upload step) measured **36–58ms/frame** — **~1800–2900x slower than Chromium's ~0.02ms** for the identical call, and categorically different from (not a scaled-up version of) the ~42x slowdown measured for a direct `texImage2D(VideoFrame)` upload (2.82ms) on the same hardware — capping throughput at **17–27fps** before anything else in the render loop ran. `drawImage` alone was only ~5–10x slower than Chromium (unremarkable), isolating the canvas-sourced `texImage2D` sub-step specifically as the cause.
    - **Fix:** object-cover cropping moved into the shader as a UV-crop uniform (`u_texRectA`/`u_texRectB`, `shaders.ts`) on the 4 `drawStage1` programs only (blit, cross-dissolve, dip, light-leak — confirmed via grep the only ones that ever sample `u_texA`/`u_texB` directly; zoom/grade unchanged, they only ever sample `rt0`/`rt1`). `useGlPreview.ts` now uploads `VideoFrame`/`ImageBitmap`/`HTMLImageElement` **directly** to the GPU texture — no intermediate canvas anywhere in the per-tick path; `fitCanvasARef`/`fitCanvasBRef`/`fitAndUpload`/`getFitCanvas` deleted entirely, `computeObjectCoverRect` replaced by `computeObjectCoverUvRect` (UV-space output), `UploadSource` narrowed back to `VideoFrame | ImageBitmap | HTMLImageElement`. Identity default `(0,0,1,1)` keeps every Phase 0–2 pixel/uniform-wiring assertion passing unmodified (only mechanical mock update: `uniform4f` added to `MockWebGL2`).
    - **Re-verified on real WKWebView, same devUrl-repoint/attribution/kill-check rigor:** performance — real `GlCompositor.uploadFrame()` with a real crop rect measured **0.50ms/frame @ 1280×720, 0.43ms/frame @ 1920×1080** (matching/beating the 0.54ms direct-upload baseline, down from 36–58ms). Crop correctness — `gl.readPixels` on a synthesized 3-band test image (2:1 source into a 1:1 destination) confirmed all 4 `drawStage1` shaders sample only the correct kept region (no stretch, correctly centered). Light-leak bloom-invariance — identity-crop and a real crop produced **byte-identical** output on a uniform-color base, confirming the bloom falloff stays anchored to the visible frame and isn't shifted by the crop.
  - **`PreviewStage.tsx` dual-gate mount** — `glPathActive = import.meta.env.DEV && useWebCodecsPath && isWebGL2Supported() && glDevToggle` (persisted `localStorage['kinetix:dev:glPreview']`, dev-only floating toggle button, ref-gated for mid-session toggling — the WebCodecs Phase 1 pattern). One persistent GL `<canvas>` mounted inside the animation wrapper (correct z-order under the DOM overlay/caption/heading layers), mutually exclusive with `PreviewCanvas`/`<img>` when active, hidden via `display:none` on missing-asset segments (keeps the context alive). Scoped zoom suppressed on the CSS wrapper when GL active (`resolveWrapperAnimationType`) to avoid double-application; the other 11 animations stay CSS. **Toggle off = byte-identical legacy path** (every gate additive).
  - **`useTransitionPreview.ts`** — one additive `glPathActive` inert-guard: when true it reports `isActive:false`, renders no snapshots, and doesn't touch `transitionProtectedIds` (GL owns it). Undefined/false (the shipped default) = byte-identical to before Phase 3.
  - **Tests: 371/371 total.** Original implementation: 19 new (up from 350) — `deriveSlotPlan` (9, mock-free, `compositeParams.test.ts`), `computeObjectCoverRect` (5, mock-free, `useGlPreview.test.ts`), widened-`UploadSource` call-shape parity (5, mock-based, `glCompositor.test.ts`). Regression fix: 5 widened-`UploadSource` parity tests removed (type surface reverted), `computeObjectCoverUvRect` tests rewritten (5→6), 6 new `u_texRectA`/`u_texRectB` uniform-wiring tests added — net 369 → 371. `tsc --noEmit` clean throughout.
  - **Video↔video transition blend gap — fixed during this phase (commit `1121b76`).** Found during real-app manual testing (the incoming segment had no live frame-pull, so the pre-boundary half of a centered video↔video transition showed no blend); root-caused and fixed via a symmetric incoming-side chase-pull. Detail in `project-state.md`'s "Bug 1 — WebGL2 preview video-video transition blend gap" entry.
  - **Manual verification (2026-07-13).** All 4 transitions (dip-to-black, dip-to-white, cross-dissolve, light-leak) manually verified working correctly by the user in the real Tauri app — satisfies that portion of the checklist below. Zoom in/out animations were also manually tested and confirmed functionally working, but this pass surfaced a sudden/visible jump partway through the zoom (masked behind dip-to-black/dip-to-white's opaque cover, clearly visible during cross-dissolve/light-leak) — see project-state.md's Deferred Known Bugs entry for **Bug 2** for full detail, not re-described here. **[UPDATE 2026-07-13 — Bug 2 is now FIXED** via a per-layer zoom-transform restructure of the compositor's render pass chain, and manually re-verified by the user in the real Tauri app across cross-dissolve and light-leak with zoom segments on both sides of the transition. Full mechanism, the light-leak bloom-position side effect it surfaced and corrected, and the verification record live in `project-state.md`'s Decisions Log (2026-07-13 entry) — not duplicated here.]**
  - **Manual verification checklist — fully complete (2026-07-14).** The last two open items — pause + seek inside an active transition window, and drag-resize suppression — have now been manually verified passing by the user in the real Tauri app. (Zoom continuing across a transitioning boundary was confirmed via the Bug 2 fix and re-verification, noted above; all 4 transitions were confirmed 2026-07-13.) The perf/crop-correctness re-verification above (Step 2) was a separate, narrower synthetic check that did not substitute for this checklist — the checklist itself has now been run in full. **Bug 4 (black screen on project load) is FIXED** — root cause was a stale `useLayoutEffect` dependency array in `useGlPreview.ts` (canvas-mount ref-timing race, not a GPU/decoder cold-start issue); see project-state.md's Decisions Log (2026-07-13) for the full writeup. **Phase 3 is COMPLETE.** Bug 3 (combined lag) and the timeline edge-drag regression remain open and unaudited — see `project-state.md`'s Deferred Known Bugs; neither was ever a Phase 3 checklist item, so neither blocks this phase's completion.

- **Phase 5 — Cutover + legacy-path removal. ✅ COMPLETE.** The dev gate is removed: `PreviewStage.tsx`'s `glPathActive` is now `useWebCodecsPath && isWebGL2Supported()` only — no `import.meta.env.DEV`, no persisted `kinetix:dev:glPreview` toggle — so the WebGL2 path (the 4 transitions, both zoom animations, and color grading) is the production default for every build, not just dev. `isWebGL2Supported()` survives purely as a diagnostic (`glUnavailable` drives a visible error surface per Section 3.4's "no fallback" definition), not as a router to a second implementation. Legacy CSS/Canvas2D transition machinery deleted for the scoped effects: `useTransitionPreview.ts` removed entirely, along with `PreviewStage.tsx`'s transition-overlay canvas, `overlayHoldStateRef`/`OverlayHoldState`, the CSS `ZOOM_IN`/`ZOOM_OUT` animation-wrapper cases (the GL compositor owns both, per-layer, since the Bug 2 fix), and the now-unused `findOutgoingSegment` helper. Ken Burns and the other 9 non-scoped animations are untouched — they stay on the CSS wrapper, out of GL scope per Section 5.2. Five transition slugs the GL engine never implemented (`wipe`, `slide-push`, `glitch-rgb`, `whip-pan`, `zoom`) — previously selectable and rendered only by the now-deleted CSS/Canvas2D snapshot path — are removed from `effectsOptions.ts`'s `TRANSITIONS` list and fold to `cross-dissolve` via a new `RETIRED_TRANSITIONS` map in the shared `transitionResolver.ts`, so any already-saved segment carrying one of them resolves identically in preview and export — matching export behavior, since the export pipeline never implemented these five either. Fleet-floor confirmation (Section 3.4's one-question survey) and the merge-to-`main` gate criteria (Section 8) remain open items, tracked under Phase 6/merge, not blockers to this phase's own completion.

  **2026-07-16 — Effects-tab UI cleanup (same branch, on top of the Phase 5 cutover).** Three dropdown-scope changes in `effectsOptions.ts`/`EffectsPanel.tsx`, no data-model change:
  - **Transitions:** the off-state's label changed from "Hard Cut" to "None" (matching the Animations/Overlays off-state convention). The underlying slug is unchanged — `TRANSITION_NONE` is still `'hard-cut'`, still load-bearing in `transitionResolver.ts` and `App.tsx`'s legacy-twin reset.
  - **Animations:** the dropdown now offers only None / Zoom In / Zoom Out (`ANIMATIONS_VISIBLE`, a filtered view). Ken Burns and the 5 filter-type entries (`color-grade`, `gaussian-blur`, `duotone`, `sepia`, `invert`) are hidden from the picker, not deleted — the full `ANIMATIONS` catalog stays intact for label lookups (segment pills, presets) and existing segments render unchanged; both renderers (preview + export) still implement all of them. Marked `TODO(filters-tab)` pending a dedicated Filters tab.
  - **Overlays:** the dropdown is reduced to None only (`OVERLAYS_VISIBLE`), and the section is marked `aria-hidden` + non-interactive with a "Coming Soon" badge. No overlay slug was ever implemented by either renderer — `effectOverlay` has no rendering code path on preview or export — so this removes no working functionality, only a picker that previously no-op'd silently.

- **2026-07-16 — Zoom scale-rate control (post-Phase-5 follow-up, same branch, committed in `0338cc2`; manually verified on macOS and Windows on 2026-07-20).** Replaces the previously-audited no-op "timer" field for the two GL zoom animations — `effectAnimationDuration` was written, persisted, and carried across sync but never read by any render path (preview or export); it remains untouched and stays live for the TRANSITIONS control only — with a real per-segment zoom-rate control:
  - **Data model (`types.ts`)** — new `VideoSegment.effectAnimationScaleRate?: number` (per-second zoom rate; absent = render-time default `0.010`, never written to disk until the user changes it). Carried across Apply Sync by unique-assetId match alongside the other `effect*` fields.
  - **Shared module (`src/services/zoomScale.ts`, NEW) — closes the exact duplicated-constant parity risk the timer audit flagged.** The GL preview (`compositeParams.ts`'s `resolveAnimScale`) and the canvas export path (`canvasAnimations.ts`'s ZOOM_IN/ZOOM_OUT cases) each previously carried their OWN independent `0.05`/sec literal, kept in sync only by a comment ("matching the preview side") — with zero shared code and, on the export side, zero dedicated test coverage. Both call sites now import one `computeZoomScale({ rate, duration, elapsed, direction })`; the duplicated constants are deleted from both. **Formula: Peak Scale = min(1.99, 1 + rate × duration).** Zoom In interpolates `1.0 → Peak Scale` linearly over the segment's own duration; Zoom Out runs the reverse. The `1.99` cap (`MAX_PEAK_SCALE`) is a hard ceiling no frame's scale can cross regardless of rate/duration.
  - **Per-segment max-rate / min-floor logic.** `computeMaxRate(duration) = min(0.100, 0.99/duration)` — the largest rate whose UNCAPPED peak still stays at/under `MAX_PEAK_SCALE` for that segment's own length. Used both as the UI rate input's (`EffectsPanel.tsx`, `type="number"`, not a range slider) live per-segment upper bound, and, via `capRateForDuration`, as the per-segment clamp on Apply-to-all across mixed-duration segments (each segment independently gets `min(chosenRate, computeMaxRate(itsOwnDuration))`). A sufficiently long segment can push `computeMaxRate` below the input's fixed floor (`MIN_ZOOM_SCALE_RATE = 0.010`); `sliderMaxRate(duration) = max(MIN_ZOOM_SCALE_RATE, computeMaxRate(duration))` (function name predates the number-input conversion) is a UI-only floor keeping the control's own `max` from rendering below its `min` — the applied/written rate is still capped by the raw, unfloored `computeMaxRate`. `isRateCapped` flags a segment sitting at its own duration cap, driving a small "capped" indicator on the BottomDrawer's animation pill.
  - **Look presets (`lookPresetService.ts`, `EffectsPanel.tsx`) — additive schema, NO version bump.** `LookPreset`/`Preset` both gained an optional `scaleRate?: number`, captured only when the preset's animation is `zoom-in`/`zoom-out`. `kinetix:lookPresets:v1` is unchanged — an old stored preset simply parses with `scaleRate: undefined`, and applying it leaves a segment's existing/default rate untouched (`resolvePresetScaleRate` returns `undefined` for a rate-less preset); when a preset does carry a rate, it's capped to the target segment's own duration on apply, same as a direct Apply.
  - **UI sync (`EffectsPanel.tsx`).** The ANIMATIONS rate input's authoring value syncs FROM the newly-selected segment's stored rate (or the default) on a genuine segment-SELECTION change only — guarded by segment-id identity, mirroring the Phase 4 GRADE section's Bug B sync guard — so a live in-progress edit on the same segment is never clobbered by an unrelated re-render.
  - **Tests: 539/539, `tsc --noEmit` clean.** New: `zoomScale.test.ts` (formula, peak cap, `computeMaxRate`/`sliderMaxRate`/`capRateForDuration`/`isRateCapped`, the sync-guard helper), `canvasAnimations.test.ts` (NEW — the export zoom path previously had zero dedicated coverage), `lookPresetService.test.ts` (preset save/apply round-trip, including the old-preset-without-the-field case); the ~15 pre-existing GL zoom assertions in `compositeParams.test.ts` that hardcoded the old `0.05` constant were rewritten against explicit rate values.
  - **Status: code complete, fully tested, and committed (`0338cc2`) on `webgl2-effects-engine`. Manually verified on macOS and Windows on 2026-07-20** — the actual GL preview + export zoom rendering, per-segment rate cap behavior, and look-preset carry have now been exercised in the real Tauri app on both platforms.

#### 🟡 IN PROGRESS / PARTIAL

_None — Phases 3, 4, and 5 are complete (above); Phase 6 had not started as of this tracker snapshot (below). **Phase 6 subsequently completed 2026-07-20 — see "Phase 6 Completion + Archive Note" at the end of this section.**_

#### ⬜ NOT STARTED / PENDING (at the time this tracker was written — see completion note below)

- **Phase 6 — Export-readiness proof + regression/perf validation at scale**, including the runtime-floor re-verification on macOS arm64 and Windows/WebView2 that Phase 0's single-machine spike could not do. **✅ COMPLETE 2026-07-20 — see "Phase 6 Completion + Archive Note" at the end of this section.**

---

### 2. Engine Decision: WebGL2 over WebGPU (Part 2)

#### 2.1 Support floors — researched (sources cited; independently spot-verified where marked)

| Capability | WKWebView (macOS) | WebView2 (Windows) | Evidence class |
|---|---|---|---|
| WebGL2 | Safari 15 era WebKit (Sept 2021; ANGLE-on-Metal backend) — i.e. any macOS able to run Safari 15+, well below this app's existing floor | Chromium since 56 (2017); WebView2 is evergreen | Researched (khronos.org "WebGL 2.0 Achieves Pervasive Support", caniuse, webkit.org release notes) + **empirically verified on this machine's WKWebView (Section 2.2)** |
| WebGPU | Safari 26 / macOS Tahoe 26 (fall 2025) in Safari proper; third-party research claims WKWebView does *not* ship it by default | Chromium 113+ (2023) in-browser; default-enabled status **inside WebView2** historically unclear (MicrosoftEdge/WebView2Feedback #2233, tauri-apps/tauri #6381 discuss flags) | Researched (webkit.org Safari 26.0 release notes, gpuweb wiki, web.dev) + **one data point empirically corrected on this machine (Section 2.3)** |
| WebCodecs `VideoDecoder` (already shipped in this app) | macOS 13.3 / Safari 16.4 | evergreen Chromium | Established in `docs/webcodecs-architecture-plan.md`'s Section 1.2 (now archived/deleted; same fact restated at this doc's own Section 1.2 cross-references above) — **this is the app's existing runtime floor** |

The decisive structural fact: **this app's preview already requires WebCodecs (macOS 13.3+) on its default path, and the new compositor's native input is `VideoFrame` — so the effects engine can never be *more* available than WebCodecs. WebGL2's floor (Safari 15 / ~macOS 10.15–11) is strictly below that. WebGL2 therefore adds zero new runtime requirement.** WebGPU would raise the macOS floor from 13.3 (Ventura, 2022, runs on 2017+ hardware) to 26 (Tahoe, 2025) — on a fleet of 5–10 channels' machines that are explicitly not centrally managed or updated.

#### 2.2 Feasibility spike — empirical results (verdict)

The spike (harness `spike-webgl.html` + `src/dev/webglFeasibilitySpike/main.ts`, method mirroring the WebCodecs plan's Phase 0 / WKWebView cross-check) returned **GO on both engines**: the `VideoFrame`→`gl.texImage2D` upload passed **312/312 real decoded H.264 frames with 0 GL errors** (readbacks non-black, varying, matching cross-engine within ±1), and all six scoped-effect shaders compiled and pixel-verified. Headline throughput on the real Tauri WKWebView (macOS 26.5.2, Intel i9 / UHD 630): **~531 fps** single upload+draw, **~411 fps** dual-upload+blend (the live two-sided-transition load) — 17.7×/13.7× the 30fps budget; Chromium measured ~5,856 / ~3,165 fps. macOS arm64 and Windows/WebView2 remain unverified (carried to Phase 6 — see §2.3, §6, §9). **Full per-check result tables (Chromium + WKWebView) and the harness methodology are archived in `docs/history.md` → *WebGL2 Effects Engine — Closed Phases (Archived)* → the “2.2 Feasibility spike” subsection.**

#### 2.3 The WebGPU data point — recorded accurately, and why WebGPU still loses

The spike found `navigator.gpu` present with a working adapter on this macOS 26.5.2 WKWebView — **contradicting** the researched claim that WKWebView doesn't ship WebGPU by default. Record this honestly: on the very newest macOS, WebGPU appears reachable inside this app today. It changes nothing about the decision:

1. **Install-base floor.** WebGPU-in-WKWebView means macOS 26 at minimum (it shipped in Safari 26). The task's own constraint stands: the 5–10 channels' Macs are not centrally updated, and a hard macOS 26 requirement with **no fallback** would brick the effects engine on every Mac still on Sequoia/Sonoma/Ventura — machines that today run the app perfectly. WebGL2 requires nothing those machines don't already have. This is the flip-condition scenario already realized: the minimum viable WebGPU floor IS "newest macOS only," so WebGL2 is the only viable no-fallback choice.
2. **Windows uncertainty.** WebGPU default-enablement *inside WebView2* (vs. Edge the browser) has a history of flag-gating; verifying it would cost a Windows spike this session couldn't run. WebGL2 in WebView2 is unconditional.
3. **Maturity/precedent for this workload.** Two-texture dissolves, dip-throughs, screen-blend light leaks, UV zooms, and color matrices are the *canonical* WebGL tutorial workload — 10+ years of precedent (glsl-transitions/gl-transitions library, every WebGL video editor). WebGPU precedent for this exact niche is thinner and its WKWebView implementation is months old (and its `importExternalTexture` fast path matters for zero-copy, which WebKit's WebGL `VideoFrame` upload already provides internally where possible). Fewer novel failure modes on the engine this plan is specifically trying to de-risk.
4. **Nothing in scope needs WebGPU.** No compute shaders, no storage buffers — 6 fragment-shader effects and texture uploads. WebGPU's advantages are irrelevant at this scope.

**Recommendation: WebGL2.** Conditions under which this would flip: (a) the scoped effects grow to need compute (e.g. optical-flow-based transitions, real-time scopes/histograms for grading at scale) *and* (b) the actual fleet is confirmed all-macOS-26+/WebGPU-verified-on-WebView2 — both must hold, and neither holds today. Revisiting is cheap later because the compositor's public interface (Section 4) is engine-agnostic: `VideoFrame`s in, canvas surface out.

---

### 3. Target Architecture

#### 3.1 Design principle

One GPU compositor, one clock, zero retained per-layer state: `renderFrame({ textures, timelineTime, effectParams }) → drawn canvas`. Every scoped effect is a fragment shader selected + parameterized by uniforms derived purely from `(segment, currentTime)` — the same derivation for preview and, later, export. Pausing freezes it, seeking snaps it, and there is no second implementation to drift, no reveal to gate, no hold/release state machine to synchronize, because there are no layers: the transition, the animation transform, and the grade are applied in a single draw (or a short fixed chain) into one canvas.

#### 3.2 New modules (all additive until the Phase 5 cutover)

```
src/services/gl/
  glContext.ts        — WebGL2 context acquisition on a dedicated canvas; context-loss/restore
                        handling (webglcontextlost/restored — re-create programs+textures);
                        capability probe (isWebGL2Supported(), memoized, mirrors webcodecsSupport.ts)
  glCompositor.ts     — the compositor class: owns programs, textures (2 video slots + image
                        textures), the fullscreen-triangle VAO; public API:
                        uploadFrame(slot, source: VideoFrame|ImageBitmap|HTMLImageElement),
                        renderFrame(params: CompositeParams) — synchronous, one draw
  shaders.ts          — GLSL ES 3.0 sources: blit, cross-dissolve, dip (parameterized color),
                        light-leak, zoom (UV transform), color-grade (brightness/contrast/
                        saturation/temperature) — the exact shaders the spike already proved
  compositeParams.ts  — PURE derivation: (segments, currentTime, projectEffectConfig) →
                        CompositeParams {transition?, progress, animScale, grade}. This is the
                        unit-testable heart — the same role toSourceTime/computeKeepSet play for
                        the decode side, tested the same mock-free way. (Phase 4: grade resolves
                        from the containing segment's effectGrade, not the flat config passthrough.)
  autoGrade.ts        — PURE one-shot auto color-grade heuristic (Phase 4): computeAutoGrade(
                        ImageData) → SegmentGrade. p2–p98 luma-percentile brightness/contrast
                        stretch (solved in the grade shader's op order) + gray-world temperature
                        nudge; flat/near-black-guarded. Mock-free, DOM-free — same test discipline
                        as compositeParams.ts
src/hooks/
  useGlPreview.ts     — thin driver: pulls VideoFrames from the EXISTING videoDecoderPool
                        (unchanged), uploads to the compositor, calls renderFrame per tick;
                        replaces useTransitionPreview + the animation wrapper transform for
                        the scoped effects at cutover
```

#### 3.3 Files modified (not replaced) at integration/cutover

`PreviewStage.tsx` — mount the compositor's canvas where `PreviewCanvas` sits today; at Phase 5 cutover, remove the transition-overlay canvas, `useTransitionPreview` wiring, and the zoom cases from the animation wrapper for the scoped effects. `EffectsPanel.tsx`/`effectsOptions.ts` — the 4 transition + 2 animation slugs map onto the new engine; color-grade controls added (Phase 4). `videoDecoderPool.ts`/`videoDemuxer.ts`/`usePlayback.ts` — **reused as-is, unmodified**; the pool's `getFrameAt` is already the per-tick frame source, and Item 4 B1's `transitionProtectedIds` API already keeps the outgoing segment's session alive through a transition window — the compositor consumes both without new pool surface.

#### 3.4 Minimum runtime requirement (the no-fallback constraint, answered)

- **macOS: 13.3 (Ventura) — unchanged.** Set by the already-shipped WebCodecs decode dependency, not by WebGL2 (whose own floor is years lower). Machines below 13.3 today already don't get the WebCodecs preview path; after the no-fallback cutover the effects engine (like the default preview path before it) simply requires 13.3+. Ventura runs on ~2017+ Macs — a realistic floor for working YouTube-production machines, and one the fleet already lives under. **Flagged plainly:** if any of the 5–10 channels still runs a pre-2017 Mac / pre-Ventura macOS, it loses effects preview when the legacy CSS path is deleted; confirm the fleet before Phase 5's deletion step (this is a one-question survey, not telemetry).
- **Windows: any WebView2-capable Windows 10/11** — unchanged; WebGL2 is unconditional in evergreen Chromium.
- **GPU baseline:** anything with a working Metal/D3D11 driver (ANGLE's requirement — the same machines that run the app's existing GPU-accelerated `<video>`/canvas stack). Max-texture-size 16384 measured on the weakest current dev machine (Intel UHD 630) comfortably covers 4K.
- **What "no fallback" means precisely:** at Phase 5, the CSS/Framer transition+zoom preview paths and `useTransitionPreview.ts`'s snapshot machinery are **deleted** for the scoped effects, not gated. `isWebGL2Supported()` remains as a diagnostic (a clear error surface beats silent black), not as a router to a maintained second path.

---

### 4. Export-Readiness — Designing for the Unified WebCodecs Pipeline Without Building It (Part 4)

The end goal after this plan: decode (`VideoDecoder`, shipped) → composite (this engine) → encode (`VideoEncoder`, **BLOCKED** at the time this section was written — unresolved, unquantified WKWebView hang risk; originally detailed in `docs/webcodecs-architecture-plan.md`'s B0 entries + 2026-07-09 follow-ups, since archived/deleted — see project-state.md's "Export rewrite: WebCodecs pipeline" Active Task for current status). Sequencing this rebuild first only avoids building two rendering pipelines in parallel — **it does not reduce or resolve the `VideoEncoder` hang risk, which remains its own separately-tracked empirical problem.** This plan must not preclude the unification: *(Superseded 2026-07-22: the `VideoEncoder` hang risk described here was never reproduced during the WebCodecs + WebGL2 Worker Export implementation's Steps 1-8, real-WKWebView-tested on macOS Intel x86_64 — see `docs/history.md` → "WebCodecs + WebGL2 Worker Export — Implementation Record". That work is the unification this section anticipated, and it confirms the design constraints below held: it drives `GlCompositor`/`compositeParams.ts` — this exact engine — completely UNCHANGED as its GL composite stage, exactly per constraints (1)-(2) below. Only production-build verification (Step 9) and macOS arm64/Windows cross-platform verification remain open, not the encoder itself.)*

- **Input contract: `VideoFrame` (or `ImageBitmap`/`HTMLImageElement` for stills), never an HTML5 `<video>` seek.** Already satisfied by design — the spike proved the upload path, and the compositor takes decoded frames from the pool. This is the single property that makes the compositor reusable for export: an export orchestrator can drive the identical `uploadFrame`/`renderFrame` calls from a sequential decode loop instead of the playhead.
- **Output contract: a rendered canvas (WebGL2-backed) from which `new VideoFrame(canvas, {timestamp})` can be constructed** — the exact construction the B0-repro/mux-proof spikes already used successfully on this WKWebView to feed `VideoEncoder`. No PNG, no readback-to-CPU in the contract (readPixels exists for tests only).
- **What must be true for unmodified reuse once/if `VideoEncoder` unblocks** (design constraints actively adopted, not afterthoughts): (1) `renderFrame` stays synchronous and stateless per call — no internal rAF loop, no dependence on being driven at wall-clock rate, so an export loop can call it as fast as decode allows; (2) `compositeParams.ts` derivation depends only on `(segments, timelineTime, config)` — never on preview-only React state — so export derives identical params from the same function; (3) render resolution is a constructor/param concern (preview at stage size, export at 1920×1080), never hard-coded; (4) color: the compositor renders in sRGB exactly as the current canvas path does (export today *tags* bt709 without converting — `segmentEncoder.ts`; Phase C of the WebCodecs plan owns real color conversion, and this engine must simply not make that harder: keep the grade shader's math in normalized RGB so a color-managed variant can be slotted in).
- **Explicitly not built now:** no encoder wiring, no export orchestrator branch, no `useExport.ts` changes. Phase 6 includes a *proof* (composite a frame → construct a `VideoFrame` from the canvas → decode-verify its pixels) to keep the contract honest without touching export.

---

### 5. Feature Scope (Part 3 — confirmed, do not expand)

#### 5.1 Transitions (4)
dip-to-black, dip-to-white, cross-dissolve, light-leak — all four already compile and pixel-verify on both engines (Section 2.2). Timing/progress semantics: driven by the same `resolveEffectiveTransition` + window math preview uses today. **Update, 2026-07-10 (transition-centering fix):** the D7 100/0-split timing question referenced here has since been resolved — see "Transition-centering fix" under Progress Tracker below (D7's original log entry lived in project-state.md's "Ignored Low Risk Bugs" section, since removed 2026-07-20 once D11/D13/D15 were fixed; D7 itself was already fixed well before that). That fix is a standalone correctness change to the shared window/progress math (`resolveTransitionProgress`, `transitionResolver.ts`), not a new phase of this plan — it landed on top of Phase 3 alongside the rest of Phases 4-6, which have since also completed (Phase 6 completed 2026-07-20 — see "Phase 6 Completion + Archive Note" later in this section).

#### 5.2 Animations (2)
zoom in, zoom out — the `1.0 ± 0.05·t` scale math shared today by `getAnimationWrapperProps`/`canvasAnimations.ts`, as a UV transform (spike-verified). The other 11 `AnimationType`s stay on their current (post-A1, time-driven) implementations — out of scope for this cut.

#### 5.3 Color grading (NEW feature area) — ✅ SHIPPED (Phase 4)
- **Manual controls — SHIPPED as proposed:** brightness, contrast, saturation, temperature (each −1..+1, 0-neutral — the exact uniform set the spike's grade shader verified), as `VideoSegment.effectGrade` (`SegmentGrade` in `types.ts`), 4 sliders in `EffectsPanel`'s GRADE section with Reset sliders, Clear grading, and the standard apply-to-selected/all. Sliders live-preview onto the active segment while dragging (no Apply click needed). The −1..+1 slider domain is the USER-FACING range; each channel is remapped to a gentler EFFECTIVE range at the render boundary (`compositeParams.ts`) so every slider position is usable — see the Progress Tracker's "Range limits" entry. Candidates still deferred: tint (green–magenta), highlights/shadows, vibrance. Grade resolves from the containing segment; it snaps at the transition midpoint (single post-blend pass — accepted, no cross-fade this pass).
- **Auto-adjust — SHIPPED as proposed** (`services/gl/autoGrade.ts` `computeAutoGrade`): samples the segment's first source frame (a small readback at analysis time only, never per-tick — video via the decode pool, image via a direct load, downsampled to 160×90), computes luma percentiles, derives brightness/contrast that stretch p2–p98 toward full range (solved in the shader's actual brightness-before-contrast order AND in the same remapped effective ranges the manual sliders use, via imported inverses — the two cannot drift) plus a gray-world temperature nudge; stores the result as ordinary `effectGrade` values the user can then edit. A one-shot parameter generator, not a per-frame pipeline stage. Saturation intentionally left at 0 in the auto heuristic (manual only).

#### 5.4 Explicitly out of scope
Overlay text/positioning (existing `SegmentControls.tsx`/DOM system stays untouched); the remaining 11 animations; filters (`getFilterStyle` CSS filters); heading overlays; any export-pipeline change. **Exception, 2026-07-10:** the transition-centering fix (5.1) necessarily touched `segmentEncoder.ts`/`exportPipeline.ts` — the task explicitly required preview/export parity on the window-timing spec, which cannot be satisfied by touching preview alone. This is a narrow, orthogonal correctness fix to shared timing math, not a re-scoping of this plan's own export-pipeline boundary; Section 4's "export stays on the existing pipeline until VideoEncoder unblocks" stance is otherwise unchanged.

---

### 6. Migration Phases

Each phase independently completable, testable, revertible; nothing deletes the legacy path before Phase 5.

- **Phase 0 — Feasibility spike. ✅ COMPLETE** (Section 2.2; produced with this document). GO on Chromium + real WKWebView; harness kept for the arm64/Windows re-runs.
- **Phase 1 — Core compositor.** Build `glContext.ts`/`glCompositor.ts`/`shaders.ts`/`compositeParams.ts` as pure additive modules with unit tests on `compositeParams` (mock-free, same style as `toSourceTime`'s tests) and context-loss handling proven by a forced `WEBGL_lose_context` test. No `PreviewStage.tsx` changes.
- **Phase 2 — Effects build-out.** All 4 transitions + 2 zooms behind the compositor API, pixel-verified against the spike's assertions promoted into repeatable checks; image-segment (still) texture path included — transitions must blend video↔image↔color segments, not just video↔video.
- **Phase 3 — Preview integration, dual-gated.** `useGlPreview.ts` drives the compositor from the existing pool behind `isWebGL2Supported() && devToggle` (the WebCodecs migration's proven Phase 1 discipline). Legacy path remains the shipped default. Verify: boundary crossings, pause/seek inside a transition window (the exact D12/B4 failure surface), drag-resize suppression, image↔video boundaries.
- **Phase 4 — Color grading. ✅ COMPLETE.** Grade uniforms (already shipped Phases 1–2) + manual controls UI + auto-adjust one-shot; per-segment persistence field (`VideoSegment.effectGrade` / `SegmentGrade` in `types.ts`). Grade resolves from the containing segment (midpoint-snap across transitions, accepted). New pure `services/gl/autoGrade.ts`. See the Progress Tracker's Phase 4 entry above for the full shipped detail.
- **Phase 5 — Cutover + deletion (the no-fallback step). ✅ COMPLETE.** Dev toggle removed; `useTransitionPreview.ts` snapshot machinery, the transition-overlay canvas, and the wrapper zoom cases deleted for scoped effects. See the Progress Tracker's Phase 5 entry above for full detail, including the 5 retired transition slugs folding to `cross-dissolve`. Fleet confirmation (Section 3.4) and the full export-parity/merge-gate criteria (Section 8) remain open, carried into Phase 6/merge.
- **Phase 6 — Regression + perf validation + export-readiness proof. ✅ COMPLETE (2026-07-20).** Manual regression pass on the real app (transitions across asset-type pairs, zooms with grades stacked, 500-segment fixture scrub-stress via `buildScaleFixture.ts`); the Section 4 canvas→`VideoFrame` proof; re-run of the spike on macOS arm64 and Windows/WebView2 remained a documented-pending gap rather than a blocker — see "Phase 6 Completion + Archive Note" at the end of this section for the full verification record and per-platform status.

---

### 7. Risk Register

| Phase | Risk | Why it matters | Mitigation direction |
|---|---|---|---|
| 1 | WebGL context loss (GPU reset, memory pressure) has no Canvas2D analogue — an unhandled loss is a permanently black preview | No-fallback means no second path hides it | `glContext.ts` handles `webglcontextlost/restored` from day one; forced-loss test in Phase 1, not discovered in production |
| 1/3 | A second GPU consumer (compositor) alongside the decode pool changes memory behavior vs. today's measured ~40MB band | The pool's LRU tuning (MAX_TOTAL_BUFFERED_FRAMES=150) was validated without a texture-holding neighbor | Textures are overwritten in place (2 video slots), never accumulated; re-measure with the 500-segment fixture in Phase 6 |
| 2 | Shader output ≠ today's Canvas2D output for the same effect (e.g. light-leak gradient shape, blend precision) | Users know today's look; a silently different render is a regression even if "prettier" | Spike already ported `alpha*(1-alpha)*4` shaping; Phase 2 diffs stills against the Canvas2D render per effect and accepts/documents each delta explicitly (A1's "export is the reference" discipline, adapted) |
| 3 | Per-tick `VideoFrame` upload during transitions doubles pool pull rate (both segments live) — the B1 `transitionProtectedIds` path gets its first heavy consumer | A pool starvation/eviction edge under dual-pull was exactly the class B3's chase-mutex reuse guarded against | Reuse the existing chase/protected-set primitives (do not build parallel ones — the B3 lesson); scrub-stress inside transition windows in Phase 3 |
| 3/5 | Preview/export parity for scoped effects *changes shape*: preview moves to GPU while export stays Canvas2D until the (blocked) VideoEncoder unification | The whole point is fewer divergences, not a new one | Keep shader math byte-portable from the shared formulas; Phase 5's parity spot-check gates cutover; the divergence window closes when export unifies (Section 4) |
| 3 | **Object-cover fit — deliberate Phase 3 choice.** The pixel-verified shaders sample UV `[0,1]` (object-*fill*/stretch); the legacy `<video className="object-cover">`/`PreviewCanvas` path object-*covers* (scale-to-fill, center-crop the overflowing axis). To match without touching the shaders, `useGlPreview.ts` does a **CPU-side 2D-canvas pre-fit per frame per slot**: `computeObjectCoverRect` + one `drawImage` onto a reused per-slot offscreen canvas (allocated once, resized only on dimension change), then `uploadFrame` that canvas (hence the additive `UploadSource` widening to `HTMLCanvasElement | OffscreenCanvas`). | A silently different fill (stretch vs. cover) would read as a regression during manual verification, and modifying the pixel-verified shaders to crop would need a fresh real-GPU pass this phase deliberately avoids. The pre-fit also keeps the compositor operating in the exact matching-resolution regime Phases 0–2 verified. | Accepted for Phase 3 (dev-gated, reversible): ~1–2 cheap 2D draws/tick, compositor `VideoFrame`-native API unchanged, closed-frame `drawImage` wrapped in try/catch (retain-last on race). **Named future work, not silently deferred:** move object-cover into the shaders as per-texture UV-crop uniforms (`u_texRect` per slot) for a zero-copy, export-correct path — this replaces the CPU pre-fit but **requires a new real-GPU verification pass** (same throwaway-harness discipline as Phase 2 Step 1) before it can land, since it changes the verified shader sources. Not in Phase 3's scope. **[CORRECTED 2026-07-10 — the "accepted for Phase 3" CPU pre-fit above caused a severe WKWebView performance regression, found via real-WKWebView devUrl-repoint measurement on a fresh single-video-segment/no-transition project (the simplest possible case): `gl.texImage2D(HTMLCanvasElement)` measured 36–58ms/frame on WKWebView/ANGLE-Metal — ~1800–2900x slower than Chromium's ~0.02ms for the identical call, and categorically different from (not a scaled-up version of) the ~42x slowdown measured for a direct `texImage2D(VideoFrame)` upload (2.82ms) on the same hardware — capping throughput at 17–27fps before anything else in the render loop ran. Root cause isolated to the canvas-sourced `texImage2D` sub-step specifically (`drawImage` alone was only ~5–10x slower than Chromium, unremarkable). Fixed same-day by implementing exactly the "named future work" above: `u_texRectA`/`u_texRectB` UV-crop uniforms added to the 4 `drawStage1` programs only (`shaders.ts`; zoom/grade unchanged — confirmed via grep they only ever sample `rt0`/`rt1`, never `texA`/`texB`, same discipline as the Phase 2 Step 1 flip-fix), `useGlPreview.ts`'s CPU pre-fit (`fitCanvasARef`/`fitCanvasBRef`/`fitAndUpload`/`getFitCanvas`, and `computeObjectCoverRect`) deleted entirely, `UploadSource` narrowed back to `VideoFrame \| ImageBitmap \| HTMLImageElement`. Identity default `(0,0,1,1)` keeps every existing Phase 0–2 pixel/uniform-wiring assertion passing unmodified. Re-verified on real WKWebView with the same devUrl-repoint/attribution/kill-check methodology — see the Progress Tracker's Phase 3 entry for the confirmation numbers.]** |
| 5 | Deleting the CSS/Canvas2D path strands any fleet machine below macOS 13.3 | No-fallback is deliberate but must not be accidental for a real user | Section 3.4's one-question fleet survey is a hard Phase 5 gate |
| 6 | macOS arm64 / Windows WebView2 behavior unverified (this session: Intel Mac only) | 2 of 3 shipped binary targets lack first-hand GPU-path evidence | Kept spike harness re-run on both before merge — same closure path Phase 0's WKWebView gap used |
| all | `PreviewStage.tsx`/hooks keep evolving on `webcodecs-api`/`main` during this branch | Long-lived branch drift produced painful merges before | Rebase at phase boundaries; re-diff the Root-Cause Audit's file/line cites (Section 1, archived in `docs/history.md`) at each phase kickoff |

---

### 8. Rollback Plan

**What "rollback" means here — stated explicitly, since there is no fallback path once shipped:** through Phase 4, rollback is the same as the WebCodecs migration's: **don't merge the branch** — `webcodecs-api`/`main` still carry the fully-working current CSS/Canvas2D effects engine, untouched, and can stay on it indefinitely if this proves infeasible. The point of no return is **Phase 5's deletion commit**: after it, "rollback" means reverting that specific commit on this branch (the deleted code is additive-inverse recoverable from git), which is why Phase 5 is deliberately the *second-to-last* phase — cutover happens only after Phases 1–4 have run the new engine dual-gated against the old one in the real app, and Phase 6's validation runs against the post-cutover state before any merge.

**Merge-to-`webcodecs-api`/`main` gate criteria (all must hold):**
1. All 4 transitions + 2 zooms + grading verified in the real Tauri app across video↔video, video↔image, image↔image boundaries, including pause/seek/drag inside transition windows (the historical failure surface from Section 1.3).
2. The Item-4 symptom set (animation jump/disappear during transitions — the bug B4 could not fix) is confirmed **gone** on the new engine by explicit repro attempt.
3. 500-segment fixture: playback + scrub-stress with no context loss, no unbounded memory growth beyond the decode pool's established band.
4. Spike harness GO on macOS arm64 and Windows/WebView2 (or an explicit, documented decision to ship with one pending).
5. `tsc` clean, full `vitest` green, and a diff review confirming zero changes to the export pipeline files and `usePlayback.ts` (hard gate, as in the WebCodecs plan's 7.1 #6).
6. Fleet floor confirmed (Section 3.4).

---

### 9. Spike Artifacts — Kept, With Justification

**Kept and committed** (following the `f52ab12` precedent of retaining investigation harnesses): `spike-webgl.html` + `src/dev/webglFeasibilitySpike/main.ts`. Justification: (a) Section 2.2's GO verdict must be reproducible — the harness *is* the evidence chain; (b) Phase 6 and merge-gate #4 require re-running it unchanged on macOS arm64 and Windows/WebView2, exactly the role the retained B0-repro/mux-proof harnesses serve for the encoder question; (c) it is `tsc`-clean, imports nothing from app code paths, and is not part of any build output (root-level spike HTML files are dev-server-only, per the Phase 0 precedent). Deleted/not-committed: nothing else was created (the exfil listener + results live in the session scratchpad, outside the repo; the raw WKWebView result payloads are transcribed in Section 2.2's table).

**To re-run on a new platform:** start a local listener on `127.0.0.1:8799` (any HTTP server that logs POST bodies), temporarily set `tauri.conf.json`'s `devUrl` to `http://localhost:3000/spike-webgl.html` and add `http://127.0.0.1:8799` to the CSP's `connect-src`, run `npm run tauri:dev`, collect the `DONE` payload, kill the app, **revert both config edits** (verify zero git diff). On Chromium/WebView2 the on-page log + `window.__webglSpikeResult` suffice.


### Phase 6 Completion + Archive Note (2026-07-20)

Phase 6 — Export-readiness proof + regression/perf validation at scale. ✅ COMPLETE. The canvas→VideoFrame proof and platform spike were run via a new dev-only in-app test panel (Ctrl/Cmd+Shift+D, `src/components/DevTestPanel.tsx`) — no config editing or terminal scripts required, so a non-developer can run the full verification. The panel calls `src/dev/phase6Spike/runPhase6Spike.ts` (5 automated tests: WebGL2 support, all 6 shaders compile, VideoFrame→GPU texture upload, canvas→VideoFrame pixel round-trip proof, throughput) and `src/dev/phase6Spike/generateScaleFixture.ts` (synthesizes a 500-segment project with 20 colored-image assets, mixed transitions/zooms/grades, ~20min duration). Verification record:

* macOS Intel x86_64 (WKWebView, macOS 26.5.2, Intel i9 / UHD 630) — all PASS, 2026-07-20:
   * Spike: WebGL2 support ✅, all 6 shaders compile ✅, VideoFrame→GPU upload ✅, canvas→VideoFrame pixel proof ✅ (100% match within ±12/channel tolerance, max channel diff 0), throughput ✅ (5882 fps — 196× the 30fps budget).
   * 500-segment fixture: playback + aggressive scrub-stress, no WebGL context loss, no unbounded memory growth (leveled off).
   * Manual regression (real project): all 4 transitions smooth across video↔video boundaries, pause/seek inside transition windows correct, drag-resize suppression correct, zoom+grade stacked renders correctly, Item-4 symptom (animation jump/disappear during transitions) confirmed GONE — the original bug that motivated this entire rebuild is dead on the new engine.
   * Fleet floor confirmed: all 5-10 channel users on Windows, no pre-2017/pre-Ventura (13.3) Macs in the fleet — no machine loses effects preview from the Phase 5 no-fallback cutover.
* Windows/WebView2: ⚠️ PARTIALLY VERIFIED. Automated spike NOT run (the dev test panel only works in `npm run tauri:dev`, not in built installers — `import.meta.env.DEV` is false in production builds; user has no Windows dev environment). However, the same GL compositor code path WAS manually verified on Windows/WebView2 on 2026-07-19/20 for color grading (all 4 sliders, live preview, Reset, Clear, Auto-adjust, Apply-to-selected/all), zoom scale-rate control, and the F-key fullscreen feature. WebGL2 is unconditional in evergreen WebView2 (Chromium 56+, 2017). Per merge-gate criterion 4's explicit allowance ("an explicit, documented decision to ship with one pending"), the Windows spike is a documented decision to ship pending, not a silent skip.
* macOS arm64 (Apple Silicon): ⚠️ NOT VERIFIED. The user's Mac is Intel x86_64; no Apple Silicon machine was available. Same merge-gate allowance applies.

Merge-gate criteria status (Section 8 of the original plan):

1. ✅ All 4 transitions + 2 zooms + grading verified across boundaries with pause/seek/drag — macOS Intel x86_64 (re-confirmed 2026-07-20; originally Phase 3 2026-07-13/14). Windows/WebView2: color grading + zoom + fullscreen verified 2026-07-19/20; transitions/pause/seek/drag pending manual verification on Windows.
2. ✅ Item-4 symptom set confirmed GONE on the new engine — macOS Intel, 2026-07-20.
3. ✅ 500-segment fixture: playback + scrub-stress, no context loss, no unbounded memory — macOS Intel x86_64. Windows/WebView2 pending.
4. ⚠️ PARTIAL — spike GO on macOS Intel x86_64 (5882 fps, 100% pixel match). macOS arm64 + Windows/WebView2 spike PENDING per documented decision (gate's explicit allowance). Same GL code path Windows-verified 2026-07-19/20 for color grading/zoom/fullscreen.
5. ✅ tsc clean, vitest 632/632, cargo check clean.
6. ✅ Fleet floor confirmed — all Windows users, no pre-Ventura Macs.

All 6 merge-gate criteria met or documented-pending. The WebGL2 effects-engine rebuild is COMPLETE (all 6 phases). The plan doc is archived and deleted from the repo.

---

## WebCodecs + WebGL2 Worker Export — Implementation Record

> Added 2026-07-22. **Archived, 2026-07-22** — `docs/webcodecs-export-plan.md` (the live architecture reference this record was originally written alongside) has been deleted now that Step 9 (production-build verification) closed it out; this section is now the sole as-built record of what Steps 1-9 did, found, and verified. See `CLAUDE.md`'s **Export Pipeline** section (subsection "WebCodecs + WebGL2 Worker Export Path") for the architecture as it now stands in the codebase, and `project-state.md`'s Active Tasks for current status.

**Status: all 9 implementation steps complete. Steps 1-8 verified on macOS Intel x86_64 via `npm run tauri:dev`; Step 9 (production build) verified on macOS Intel x86_64 via `npm run tauri:build` on 2026-07-22.** The new path is the **default** (capability probe + persisted toggle, toggle defaults ON on every platform); the legacy canvas/ffmpeg export path is fully preserved, untouched, and remains the fallback when the gate is closed. macOS arm64 and Windows/WebView2 remain the only open gap (cross-platform validation, unverified — no hardware access during implementation).

### Architecture in one line

`sequentialDecode.ts` (decode) → `GlCompositor`/`compositeParams.ts` (composite, UNCHANGED — the same classes the WebGL2 preview uses) → `textRenderer.ts` (text, GL quad over a Canvas2D atlas) → `VideoEncoder` (encode, annexb) → `appendFileRaw` IPC (stream to disk) → `muxOnly.ts` (mux with bt709 tagging). Full per-tier routing/concat/guard chain is diagrammed in `CLAUDE.md`'s Export Pipeline section — not repeated here.

### The 9 implementation steps

| Step | What it built | Verified |
|---|---|---|
| 1 | **Sequential decode** — `sequentialDecode.ts`: one dedicated `VideoDecoder` per call, no pooling, walks a run's source range once start-to-end (export has none of preview's random-seek requirements `videoDecoderPool.ts` exists for). Reuses `getOrCreateDemux`/`findChunkRange` from the preview decode stack. `DECODE_AHEAD_CAP=8` bounds in-flight undelivered `VideoFrame`s. | Frame count + timestamps matched an mp4box sample count for a trimmed range; frames arrived in presentation order. |
| 2 | **uvRect extraction + worker composite skeleton** — `uvRect.ts` (verbatim move of `computeObjectCoverUvRect`/`computeObjectContainUvRect` out of `useGlPreview.ts`, re-exported so its public surface is unchanged — a worker can't import a React hook module) + `exportWorker.ts` skeleton + `acquireOffscreenGlContext` (`glContext.ts`, additive, `OffscreenCanvas`'s `contextlost`/`contextrestored` event names — deliberately a separate function from `acquireGlContext` rather than a widened signature, since the on-screen canvas fires differently-named events and a shared signature would wire dead listeners). | Preview unchanged (existing tests + manual check); worker composited one segment and transferred frames out; pixel-checked against the Phase 6 GL pixel-proof fixture; cover-fit frame geometry matched legacy export's `drawImageCover`. |
| 3 | **Worker encode + annexb streaming** — `VideoEncoder` with `avc:{format:'annexb'}` (WebCodecs defaults to AVCC; concatenating AVCC payloads as `.h264` is undecodable — the plan never specified the format until this step), backpressure (`encodeQueueSize`/`dequeue`), `TauriFfmpeg.appendFileRaw` + Rust `ffmpeg_append_file_raw` (`OpenOptions::append(true).create(true)`, same header-transport pattern as the existing `write_file_raw`). | ffprobe confirmed a valid annexb H.264 stream on real WKWebView, exact frame count, monotonic timing; kill/cancel mid-stream left no orphaned session files after teardown. |
| 4 | **Mux-only + orchestrator skeleton** — `muxOnly.ts` + `exportPipelineWebCodecs.ts` skeleton, treating the whole project as one GL-compositable run (a documented, temporary assumption Step 5 replaced). **Two bugs found here, both from testing against a real VideoToolbox-encoded stream rather than the plan's assumed single-command mux** (see "Key bugs" below): `-r` not `-framerate`, and audio muxed in a separate ffmpeg invocation, not combined with `-shortest`. | One run + voiceover → playable MP4 (QuickTime-verified), correct A/V sync, exact duration. |
| 5 | **Full-timeline routing + runs + concat** — `glCompositable.ts` (the routing predicate, conservative by design like `plainSegment.ts`'s Tier 1) + run splitting (maximal contiguous GL runs; one piece per segment for Tier 1/C) + Tier 1/C MP4→annexb remuxes + concat + the frame-count loud-failure guard + absolute (not accumulating) timestamps + per-segment keyframes. **Material refinement beyond the plan's own text, found while implementing:** the plan's per-segment routing predicate alone doesn't guarantee "the only cross-tier boundaries are hard cuts" — a segment can be individually GL-eligible with a real GL-slug transition into a neighbor disqualified for an unrelated reason (e.g. its own color filter), which would either drop or double-render that transition. Fixed with `groupConnectedComponents`, a small Union-Find over segment indices: segments joined by a real GL-slug transition are unioned into one component, and the whole component downgrades to Tier C if any member is disqualified. **The frame-count guard itself needed a native Rust NAL scanner** (`ffmpeg_count_annexb_frames`) rather than parsing `ffmpeg_exec`'s output, because `ffmpeg_exec` doesn't surface stderr on a successful run — there was nowhere in the existing IPC surface to read a frame count back from ffmpeg itself without a dedicated command. | Mixed project (GL + plain + canvas-fallback segments) A/B-matched legacy export frame-by-frame at tier boundaries; concat guard tripped correctly when fed a deliberately corrupted piece (negative test). |
| 6 | **GL text renderer** — `textRenderer.ts`'s `GLTextRenderer`: Canvas2D atlas (OffscreenCanvas, one per unique text config, bounded LRU) GPU-composited as an alpha-blended textured quad after the grade pass — a byte-for-byte parity port of `frameRenderer.ts`'s wrap/sizing/positioning math, not a reimplementation. `fontResolver.ts` added alongside it (see "Key bugs/amendments" below — fonts needed a follow-up fix after this step shipped). **Color space mismatch found and fixed in this step**: preview-vs-export pixel match was measured at 0.2% before the fix. Root cause: `VideoFrame`/`VideoEncoder` expose no `colorSpace` API for a canvas-source frame (only the buffer-source constructor overload has one — confirmed against MDN and a real TypeScript overload-rejection error), so color space has to be tagged at MUX time instead — `muxOnly.ts`'s `-colorspace`/`-color_primaries`/`-color_trc bt709` flags, mirroring `segmentEncoder.ts`'s own libx264 bt709 tagging on the legacy path. Also wired the orchestrator's text config (global overlay config, text layers, headings) through to the worker. | Captions/extra overlays/global layers/headings pixel-compared against legacy export; `hiddenOnSegments` respected; atlas LRU bounded on the existing 500-segment fixture (Ctrl/Cmd+Shift+D dev test panel). |
| 7 | **Gate + cancel + progress** — `useExport.ts`'s `isWebCodecsExportGateOpen()` (capability probe AND persisted toggle), `DropZonePanel.tsx`'s Export Engine toggle UI, `App.tsx`'s Cancel Export button, the path-aware cancel sequence (`activePathRef` picks `cancelExportWebCodecs()` vs. legacy `backend.cancel()`), frames-weighted progress. **Frame-count off-by-one found and fixed here**: `encodePlainVideoSegment` (Tier 1, legacy) produces `Math.ceil` frame counts due to ffmpeg's own `-t`/`-r` trim semantics, but the orchestrator's expected-count math assumed `Math.round` — a one-frame mismatch on some plain segments that the Step 5 guard correctly caught, tracing back to this discrepancy rather than a real corruption. | Toggle off ⇒ confirmed legacy byte-path (no behavior change); cancel confirmed to kill the worker + sidecar + session dir; progress confirmed monotonic across tiers. |
| 8 | **Quality + cutover** — the quality comparison (see Performance below), the cutover recommendation, and two same-step optimizations: `desynchronized: true` on the OffscreenCanvas GL context (~12% speedup, additive to `acquireOffscreenGlContext`), and moving the frame-count guard's frame-counting logic from a JS `ffmpeg.readFile`+scan (which cost ~5s per export moving the whole concatenated annexb file's bytes across IPC) to the dedicated Rust `ffmpeg_count_annexb_frames` command (Step 5's guard, optimized here). | Synthetic effects-heavy benchmark 194s → 6.8s (~28×), no regression vs. legacy on a byte-for-byte comparable project. See Cross-Platform Status below — macOS arm64/Windows quality comparison and cutover decision remain pending real hardware. |
| 9 | **Production-build verification** — confirmed the app actually builds, packages, and runs outside `npm run tauri:dev`, which every prior step's verification depended on. Preflight (`tsc --noEmit`, `vitest` 751/751, `cargo check`) clean; `npm run tauri:build` ran Vite production build → Rust release compile → macOS `.app`/`.dmg` bundling end-to-end with no changes needed (`tauri.conf.json`/`vite.config.ts` were already at baseline; no `src/dev/` imports in the production entry points). | Artifacts confirmed at `src-tauri/target/release/bundle/macos/Kinetix Pro Studio.app` (237 MB) and `.../dmg/Kinetix Pro Studio_0.1.0_x64.dmg` (163 MB). Launch-only smoke test: the packaged app opened without crashing, the project dashboard rendered with real project data (screenshot-verified), and it quit cleanly — proving the export worker's `worker:{format:'es'}` bundling loads correctly in a production build, which no prior step had tested. A full in-app export-flow walkthrough (triggering an actual WebCodecs export from the packaged app) was deliberately left as a separate manual step for the user rather than GUI-automated, since driving file-open/project-select/export/save-path dialogs through computer-use automation was judged too fragile to trust as verification. |

**Amendments landed alongside/after the numbered steps, not steps of their own:**
- **Fonts fix** — `FontFace.load(url)` inside the worker fails with a `NetworkError` against `fonts.gstatic.com` on real WKWebView (confirmed empirically during Step 6 verification, not a theoretical concern). Fixed by adding `fontResolver.ts`: it parses the same Google Fonts CSS `@import` `src/index.css:1` already loads, then fetches the actual font BYTES on the main thread and passes them into the worker as `FontConfig.bytes` — the worker builds real `FontFace` objects from bytes instead of a URL. Non-fatal on failure (falls back to a system font, matching the preview path's `ensureFont`).
- **Toggle default ON for all platforms** — a deliberate decision, not an oversight: macOS Intel is verified (including the Step 9 production build), macOS arm64/Windows are not, and shipping the toggle ON everywhere is an accepted risk pending future cross-platform verification (rather than gating the default per-platform with no way to test the ungated platforms' real behavior before shipping).

### Key bugs found and fixed (consolidated)

- **`-framerate` doesn't work for VideoToolbox-hardware-encoded annexb output (Step 4).** The plan specified `-framerate <fps>`; that flag only affects the demuxer's DISPLAYED `r_frame_rate`, not the per-packet duration the mp4 muxer writes into the track's `stts` table for PTS-less annexb packets. Reproduced against the bundled ffmpeg binary: a real `h264_videotoolbox`-encoded 300-frame/30fps stream muxed with `-framerate 30` produced a 1.67s (179.97fps) file — wrong by exactly 6×. `-r 30` in its place produced the correct 10.00s/30fps file. (A `libx264`-encoded stream happened to mux correctly under either flag, which is why this would not have surfaced without testing the real hardware-encoder output the production path actually uses.)
- **`-shortest` silently drops audio entirely when combined with a still-PTS-less `-c:v copy` stream in the same ffmpeg invocation (Step 4).** Reproduced repeatedly: muxing raw annexb + audio + `-shortest` in one command produced a file byte-for-byte identical in size to the no-audio case, even though ffmpeg's own log showed the AAC encoder ran (`audio:0KiB` in the muxing-overhead summary). Fixed with a two-step mux — video remux first, audio mux in a separate invocation second.
- **Frame-count guard couldn't read ffmpeg's own output (Step 5).** `ffmpeg_exec` doesn't surface stderr on a successful run, so there was no way to parse a frame count out of the existing exec IPC surface. Solved with a dedicated Rust command (`ffmpeg_count_annexb_frames`) that scans the annexb file for NAL unit type 1/5 directly, entirely server-side.
- **Per-segment routing predicate insufficient for transition safety (Step 5).** See the Step 5 row above — fixed with `groupConnectedComponents` (Union-Find over segment indices).
- **Color space mismatch, 0.2% preview-vs-export pixel match (Step 6).** `VideoFrame`/`VideoEncoder` have no `colorSpace` API for canvas-source frames. Fixed with mux-time bt709 tagging in `muxOnly.ts`.
- **Frame-count off-by-one on some plain segments (Step 7).** `encodePlainVideoSegment` produces `Math.ceil` frame counts (ffmpeg's own `-t`/`-r` trim semantics); the orchestrator's expected-count math is now consistent with that instead of assuming `Math.round`.
- **`FontFace.load(url)` fails inside the worker (amendment).** Fixed by fetching font bytes on the main thread and passing an `ArrayBuffer` into the worker — see `fontResolver.ts` above.

### Performance — honest numbers

- **Step 8 synthetic benchmark (effects-heavy):** 194s → 6.8s, **~28× speedup**.
- **Real projects:** roughly **~2.3×** — the gap between the synthetic and real numbers is GPU upload/readback cost in the Worker+OffscreenCanvas regime on WKWebView, which the synthetic effects-heavy benchmark's composition doesn't fully represent. This is the number to quote for user-facing expectations, not the 28× figure.
- **`desynchronized: true`** on the OffscreenCanvas GL context: ~12% additional speedup (Step 8).
- **Frame-count guard optimization:** eliminated ~5s per export previously spent moving the whole concatenated annexb file's bytes across IPC for a JS frame-count scan (Step 8, building on Step 5's guard).
- Tier 1/C segments (plain video/image, or anything not GL-expressible) run at the legacy pipeline's existing speed — this path doesn't touch their encoders at all.

### Cross-platform status (honest)

- **macOS Intel x86_64:** fully verified, Steps 0-8, real WKWebView. This is the only platform this implementation has been exercised on end-to-end.
- **macOS arm64 (Apple Silicon):** UNVERIFIED — no Apple Silicon hardware was available during implementation.
- **Windows/WebView2:** UNVERIFIED on real hardware — Step 0's capability gate passed only on a Chromium proxy, not a real Windows machine.
- **Production build (`tauri build`):** VERIFIED on macOS Intel x86_64, 2026-07-22 (Step 9). Steps 1-8 above were verified only against `npm run tauri:dev`; Step 9 confirmed the worker's ES-module bundling (`worker:{format:'es'}`) actually loads and the app runs inside a bundled installer — not a formality: the WebGL2 effects-engine rebuild's own Phase 6 record above notes the dev test panel doesn't work in built installers for exactly this reason (`import.meta.env.DEV` is false in production), so a dev-server-only verification history was a known-insufficient substitute for this check. Not yet verified: macOS arm64 and Windows/WebView2 production builds — no hardware access during implementation.

### What's NOT changed

- **Legacy export path** — `exportPipeline.ts`/`segmentEncoder.ts`/`frameRenderer.ts`/`frameEncodeWorker.ts` are untouched, and run byte-identical to before this work whenever the gate is closed (unsupported runtime, or the user toggles it off).
- **Preview** — `useGlPreview.ts` only gained the verbatim `uvRect.ts` extraction (re-exported, same public surface); `PreviewStage.tsx`, `PreviewCanvas.tsx`, `useWebCodecsPreview.ts`, `videoDecoderPool.ts`, `glCompositor.ts`, `compositeParams.ts` are untouched. Preview behavior is unaffected by any of this work.
- **Sync engine, timeline/editing, persistence, Tauri capabilities** (beyond the two new IPC commands) — all untouched.

Test count grew from 612 to **739** (127 new tests) across the 8 steps, primarily in `services/webcodecsExport/*.test.ts` (`fontResolver.test.ts`, `glCompositable.test.ts`, `muxOnly.test.ts`, `sequentialDecode.test.ts`, `textRenderer.test.ts`).

---

## macOS EMFILE Fix — AnnexB Concat (Implementation Record)

> Added 2026-07-23, commit `e11efcf`. Follow-up to the WebCodecs + WebGL2 Worker Export path above — fixes a piece-concat failure found on a large real-world export, not part of the original 9-step build. Cross-reference: `project-state.md`'s 2026-07-23 Decisions Log entry.

**What failed:** a 407-segment project export on macOS failed with `ffmpeg exited with code 232: Too many open files`, during the concat step that joins every piece's AnnexB stream into `video_all.h264` before mux.

**Root cause:** `exportPipelineWebCodecs.ts`'s original concat step invoked ffmpeg's concat protocol — `-i concat:piece_0.h264|piece_1.h264|...|piece_406.h264` — which opens every listed input file simultaneously before reading any of them. macOS's default per-process soft file-descriptor limit (`ulimit -n`) is 256; 407 piece files exceeded it during the open phase, well before any actual concatenation happened. Windows was never at risk from the same code path — Windows has no equivalent fixed per-process FD cap, and the team's existing 400-500 segment exports on Windows had already run fine.

Piece count in this project comes from `buildPiecePlans`: Tier 1 (plain video/image) and Tier C (canvas fallback) segments each produce their own single-segment piece by design — `groupConnectedComponents`'s Union-Find only groups *contiguous GL-tier* segments into a shared run. Incremental append is implemented within a GL run but not across separate Tier 1/C pieces, so a project with many non-GL segments accumulates one piece per segment. This is a design property of the existing routing, not something this fix touched — flagged as a possible future optimization (batching Tier 1/C encodes to reduce piece count) but not scheduled.

**Fix:** new Rust command `ffmpeg_concat_annexb_pieces` (`src-tauri/src/ffmpeg.rs`) stream-copies each piece file's bytes into the output file in order, one piece at a time — at most 2 file descriptors open at any instant (one read handle on the current piece, one write handle on the output), completely independent of piece count. AnnexB byte concatenation is spec-valid here because every NAL unit is start-code-prefixed, so a plain byte-for-byte join of correctly-formed AnnexB streams is itself a correctly-formed AnnexB stream — no re-muxing or re-encoding needed. `src/services/tauriFfmpeg.ts` gained a thin `concatAnnexbPieces(piecePaths, outputPath)` wrapper; `exportPipelineWebCodecs.ts`'s orchestrator now calls that instead of building a concat-protocol pipe-string and invoking `ffmpeg.exec`. The existing Step 5 frame-count guard (`countAnnexbFrames`, the native Rust NAL scanner) is unchanged and validates the Rust-concatenated output exactly as it validated the old ffmpeg-concatenated output — the guard doesn't care how the file was assembled, only what's in it.

**Verification:** a 294-segment export reproducer ran on macOS Intel x86_64 and completed successfully, with the output file confirmed to play correctly. 294 exceeds macOS's 256 FD limit, so the pre-fix code would have failed on this exact reproducer — a valid regression test in practice, even though it isn't (yet) encoded as an automated test. Windows is unaffected by construction: the new path opens strictly fewer file handles than the old one, on any OS.

**Files changed:** `src-tauri/src/ffmpeg.rs` (+`ffmpeg_concat_annexb_pieces` command, +4 unit tests: exact byte concatenation, larger-than-chunk input, missing-piece error with no partial output left behind, path-traversal rejection), `src-tauri/src/lib.rs` (command registration, IPC command count 15→16 in `ffmpeg.rs` / 18→19 total), `src/services/tauriFfmpeg.ts` (+`concatAnnexbPieces` wrapper), `src/services/webcodecsExport/exportPipelineWebCodecs.ts` (orchestrator: removed the concat-protocol pipe-string construction and the local `concatAnnexbPieces` helper that wrapped `ffmpeg.exec`, calls the new native wrapper instead), `src/services/webcodecsExport/exportPipelineWebCodecs.test.ts` (new, 3 orchestrator wiring tests), `src/dev/webcodecsStep2Spike/main.ts` (dev spike updated to import the relocated helper).

**Test counts:** `tsc --noEmit` clean, `vitest` **754/754** (was 751 — +3 new), `cargo check` clean, `cargo test` **4/4** new pass (all in `src-tauri/src/ffmpeg.rs`'s `concat_annexb_pieces_*` tests).

---

## Project Settings + Aspect Ratio + Bulk Delete — Implementation Record

> Added 2026-07-22, landed on top of the WebCodecs + WebGL2 Worker Export work above (same uncommitted tree). The original design doc (`docs/project-settings-plan.md`) was deleted after implementation completed — this section is now the full record. See `CLAUDE.md`'s File Map (`resolutionConfig.ts`, `ProjectSettingsModal.tsx`, `ExportSettingsModal.tsx`, `NewProjectModal.tsx`, `ProjectDashboard.tsx` entries) and Export Pipeline section for the architecture as it now stands, and `project-state.md`'s Active Tasks/Decisions Log for current status.

Three features, landed together in one session: **Project Settings + Aspect Ratio** (Steps 1-6), an **Export Settings dialog** (a same-day amendment to the first), and **Bulk Select + Delete Projects** (independent, self-contained).

### 1. The resolution model — aspectRatio + resolutionTier → derived dimensions

The core design decision: `Project` never stores pixel width/height directly. It stores two small categorical fields —

```ts
export type AspectRatio = '16:9' | '9:16' | '1:1';
export type ResolutionTier = '720p' | '1080p';
```

— and a single new pure module, `src/services/resolutionConfig.ts`, is the one place that maps `(AspectRatio, ResolutionTier)` to actual pixel dimensions:

```ts
export const RESOLUTION_TABLE: Record<AspectRatio, Record<ResolutionTier, FrameDimensions>> = {
  '16:9': { '720p': { width: 1280, height: 720 }, '1080p': { width: 1920, height: 1080 } },
  '9:16': { '720p': { width: 720, height: 1280 }, '1080p': { width: 1080, height: 1920 } },
  '1:1':  { '720p': { width: 720, height: 720 },  '1080p': { width: 1080, height: 1080 } },
};
```

`resolveDimensions(ratio, tier)` looks up the table; `aspectRatioToCss(ratio)` maps `'16:9' → '16 / 9'` for the preview wrapper's inline `aspectRatio` style. The `Record<AspectRatio, Record<ResolutionTier, FrameDimensions>>` shape makes the table **TypeScript-exhaustiveness-checked** — omitting a ratio or tier cell is a compile error, not a silent runtime hole. 12 tests in `resolutionConfig.test.ts` assert all 6 `(ratio, tier)` combinations, `aspectRatioToCss` for all 3 ratios, and both defaults (`DEFAULT_ASPECT_RATIO = '16:9'`, `DEFAULT_RESOLUTION_TIER = '1080p'`).

**Why this shape, not direct width/height fields on `Project`:** confirmed by reading the actual rendering/export code end to end that the preview and export pipelines were already width/height-agnostic — `frameRenderer.ts`'s `drawImageCover`, `gl/uvRect.ts`'s cover/contain math, and `glCompositor.ts`'s render-target allocation all take `width`/`height` as plain parameters with no embedded ratio assumption. The 16:9 assumption lived in exactly two places (`App.tsx`'s preview-wrapper inline style, `useExport.ts`'s resolution→dimensions ternary), so a lookup-table indirection was small, clean plumbing rather than a deep rewrite. Existing projects default to `aspectRatio: '16:9'`, `resolutionTier: '1080p'` at read time (both fields optional, undefined on pre-existing projects, no `projectStore.ts` version bump — the same pattern already used for `headings?: HeadingOverlay[]`) — this resolves to 1920×1080, i.e. today's actual behavior, so migration is invisible.

**4K removed, not merely left untested.** The old `ExportResolution = '1080p' | '4k'` union (`useExport.ts`) is gone — `ExportResolution` is now a type alias for the shared `ResolutionTier`. Only 720p and 1080p exist, across all 3 aspect ratios (6 combinations total). This is a deliberate scope decision: reinstating 4K later is additive at the type/table level (one new union member + 3 new lookup-table rows, one per aspect ratio — the exhaustiveness check forces all 3 to be filled in), but ships with a decision made per new cell (what does "4K, square" mean?), not automatically.

### 2. Project Settings modal + aspect ratio at creation (Steps 1-6)

**`NewProjectModal.tsx`** — beyond the existing project-name field, now collects aspect ratio (a 3-way segmented control, `16:9`/`9:16`/`1:1`, defaulting to `16:9`) and native resolution tier (a `<select>` offering `720p`/`1080p`, options showing derived dimensions for the currently-selected ratio via `resolveDimensions`, e.g. `"1080p — 1080 × 1920"` under `9:16`, defaulting to `1080p`). Aspect ratio is explicitly labeled "Locked forever once created — cannot be changed later." `onConfirm`'s signature widened to `(name, aspectRatio, resolutionTier)`; `App.tsx`'s `handleNewProjectConfirm` writes both onto the fresh `Project` before confirming it.

**New `ProjectSettingsModal.tsx`** — a blocking, draft-then-commit dialog (all edits are local `useState` draft, committed atomically on Save; Cancel/Escape discard everything, no backdrop-click-to-close, matching `NewProjectModal`'s existing precedent) opened from a new button in the right panel (`App.tsx`, `showProjectSettingsModal` state). Three sections:
1. **Project** (new) — the native resolution tier (editable `<select>`, `720p`/`1080p`) with derived dimensions shown as read-only helper text, and the locked aspect ratio (display only — "Aspect ratio is locked at project creation").
2. **Export Engine** — the WebCodecs export toggle, pulled out of `DropZonePanel.tsx`'s Effects tab (mirrors `isWebCodecsExportCapable()`/`isWebCodecsExportToggleOn()`/`setWebCodecsExportToggle()`, same persisted `uiStateStore` key, same capability-gated disabled state).
3. **Text Overlay** — the segments-default `showOverlay` cascade, also pulled out of the Effects tab.

**`DropZonePanel.tsx` cleanup** — the Effects tab's former Export Quality/Export Engine/Display sections and their supporting local state/props (`webcodecsExportEnabled`/`webcodecsExportCapable`/`handleToggleWebcodecsExport`, the `exportResolution`/`exportFps`/`mixedNativeFpsWarning`/`onSetAllOverlay` props, the `allOverlayOn` derivation) were deleted entirely — relocated, not duplicated. The Effects tab now mounts only `EffectsPanel.tsx` and owns `lookPresetService` persistence, same as before these sections existed.

**Preview wiring** — `App.tsx`'s preview-wrapper inline style changed from a hardcoded `aspectRatio: '16 / 9'` to `aspectRatio: aspectRatioToCss(project.aspectRatio ?? DEFAULT_ASPECT_RATIO)`. The preview canvas backing buffers (`PreviewCanvas.tsx`'s `width`/`height` props, `useGlPreview.ts`'s `nativeWidth`/`nativeHeight`, both threaded through `PreviewStage.tsx`) now come from `previewNativeDimensions = resolveDimensions(project.aspectRatio ?? DEFAULT_ASPECT_RATIO, project.resolutionTier ?? DEFAULT_RESOLUTION_TIER)` (memoized in `App.tsx`) instead of being measured from `canvas.clientWidth`/`clientHeight` every frame — the preview now renders at the project's actual native resolution, and the CSS aspect-ratio wrapper matches it by construction so there's no distortion at any panel size. The object-contain fit math in both files is unchanged; only the backing-buffer size source changed.

### 3. Export Settings dialog (same-day amendment)

**New `ExportSettingsModal.tsx`** — resolution + fps are chosen **at export time**, in a dialog that opens when the user clicks Export, before the native save-path dialog — not in Project Settings. This is the industry-standard pattern: Premiere, Resolve, and Final Cut all separate a project's native/working format from a per-export delivery format chosen at render time. `ProjectSettingsModal.tsx` was amended the same day to remove its own (just-added, never-shipped) Export Quality section once this landed, so the setting exists in exactly one place, not two.

Draft state is seeded from the current `exportResolution`/`exportFps` (so the last export's choice is remembered across runs); Continue commits the draft back into `App.tsx`'s existing state and proceeds to `pick_save_path` + the render; Cancel/Escape discard the draft, no export triggered. `useExport.ts`'s `runExport` derives export width/height via `resolveDimensions(snap.aspectRatio ?? DEFAULT_ASPECT_RATIO, resolution)` instead of the old hardcoded `resolution === '4k' ? 3840 : 1920` ternary.

**The stale-closure fix:** `ExportSettingsModal`'s `onContinue` commits `exportResolution`/`exportFps` via `setState`, then must trigger `startExport` — but `startExport` is a `useCallback` closed over the OLD values until the next render, so calling it synchronously in the same handler would export with stale settings. `App.tsx` gained a small `exportTriggerCount` counter + a dedicated effect (`useEffect(() => { if (exportTriggerCount === 0) return; startExport(); }, [exportTriggerCount])`) that fires only on the render where the counter changes, reading the freshly-closed-over `startExport` from that same render — never on resolution/fps changes coming from elsewhere (e.g. the native-fps auto-match effect).

### 4. Bulk Select + Delete Projects (independent, self-contained)

**`ProjectDashboard.tsx` only** — no `App.tsx` or service changes. Adds:
- A per-card hover checkbox (top-left, `opacity-0 group-hover:opacity-100` unless selected, then always visible with a `ring-2 ring-blue-500` card highlight) — `onClick` calls `e.stopPropagation()` so selecting a card doesn't also open the project.
- A header "Select All"/"Deselect All" toggle button — **filter-respecting**: it operates on `visibleIds` (the currently search-filtered set), not every project in the registry, so selecting-all while a search is active only selects the visible matches.
- A "Delete Selected (N)" button (disabled at `N=0`) opening a bulk confirm dialog, distinct from the existing single-project delete confirm (`confirmDeleteId` state stays separate from the new `showBulkConfirm`/`selectedIds` state).
- `handleBulkDelete()` sequentially awaits `deleteAllAssets` + `deleteAllWaveforms` + `deleteProjectData` per selected id — the exact same three calls the existing single-delete `handleDelete()` already made, just looped — then clears `selectedIds` and refreshes the metas list.

Selection state (`selectedIds: Set<string>`, `showBulkConfirm`) is local component state, not persisted — resets on remount, matching the existing (also-unpersisted) single-delete confirm state's precedent.

### Test count

Grew from 739 to **751** (12 new tests, all in `services/resolutionConfig.test.ts` — none of the other two features needed new test files: `ExportSettingsModal.tsx`/`ProjectSettingsModal.tsx`/`NewProjectModal.tsx`/`ProjectDashboard.tsx` are UI components with no existing test-harness precedent in this repo, per the same jsdom/testing-library gap noted elsewhere in this file for other hook/component work).

### What this does NOT change

- **The export pipeline itself** (`exportPipeline.ts`, `segmentEncoder.ts`, `frameRenderer.ts`, `exportPipelineWebCodecs.ts` and everything under `services/webcodecsExport/`) — untouched; only the `{ width, height }` values passed into it changed source (derived, not hardcoded).
- **The WebCodecs export gate logic** (`isWebCodecsExportCapable()`/`isWebCodecsExportGateOpen()` in `useExport.ts`) — untouched; only the toggle's on-screen location moved.
- **Sync engine, timeline/editing, Whisper alignment, silence detection** — none of these read aspect ratio or resolution.
- **`EffectsPanel.tsx` itself** — confirmed by reading it in full that none of the three relocated Effects-tab sections ever lived there; it needed zero changes.
- **Per-project delete plumbing** (`deleteAllAssets`/`deleteAllWaveforms`/`deleteProjectData`) — reused as-is by the bulk path, not modified.

## Export UX — Live Timer + Completion Toast/Chime (2026-07-29)

Two additive export-UX features, both scoped to `useExport.ts` + its one call site in `App.tsx`; no changes to the export pipelines themselves.

**1. Live elapsed-time timer.** `UseExportState` gains `elapsedSec: number`. A single `setInterval` per hook instance (`elapsedTimerRef`) ticks it once a second while `isExporting`; the tick's own `setState` guards on `prev.isExporting` so a tick that fires in the same macrotask as a stop can't resurrect the counter after the state that ends the export has already committed. Starts (reset to `0`) at the very top of `runExport`, alongside the same `setState` call that flips `isExporting: true` — i.e. the moment export begins, not when `ExportSettingsModal` opens or the save-path dialog resolves. Frozen (interval cleared, last value kept) on every exit path: `ffmpeg_load` failure, encode/mux failure (`!result.ok`), save-to-disk failure, `cancelExport`, and success. Reset to `0` again only happens on the *next* `runExport` call (including via `retryExport`, which is itself just another `runExport`). Rendered in the progress modal (`App.tsx`, the "Rendering Master MP4" view) via a new `formatElapsed(elapsedSec)` line under the stage label.

`formatElapsed(sec)` — pure, exported from `useExport.ts` — formats `"MM:SS"`, switching to `"HH:MM:SS"` at the one-hour mark, all segments zero-padded.

**2. Completion toast — chime + elapsed text + longer duration.** On the success path, `runExport` captures `prev.elapsedSec` into a new `lastExportElapsedSec` state field (separate from `elapsedSec`, which resets to `0` in that same `setState` via the `IDLE_STATE` spread) and fires-and-forgets `services/notificationSound.ts`'s `playExportCompleteChime()` — never awaited, never called on cancel or error. The toast's header text in `App.tsx` changed from the static "Export complete" to `` `Export completed in ${formatElapsedLong(lastExportElapsedSec ?? 0)}` `` — same green-checkmark styling, only the text changed. `formatElapsedLong(sec)` — the sibling pure formatter — renders `"45s"` / `"5m 23s"` / `"1h 5m 23s"`, dropping any unit that isn't needed at the top (no leading `"0h"` unless there's really an hour to show). The toast's auto-dismiss moved from a bare `10000` literal to a named `EXPORT_SUCCESS_TOAST_DURATION_MS = 15000` constant in `App.tsx`, referenced from the one `setTimeout` call that used the old literal.

**Sound asset.** `src/assets/export-complete-chime.wav` — an original two-tone chime (~1760 Hz then ~1318 Hz, ~0.53s total, short attack + release envelopes to avoid clicks), generated for this project with a small Python script (stdlib `wave`/`math`/`struct` only, no external samples). **Deliberate deviation from the task's stated default (B2)**: B2 asked for a *sourced* royalty-free chime file; this session had no reliable way to verify the license of an internet-downloaded audio file from within the sandbox, so an original WAV was synthesized offline as the *asset* instead — there is no third-party licensing to track because nothing was copied from anyone. This is different from *runtime tone synthesis* (an `OscillatorNode` built in the playback code), which B2 explicitly ruled out and which `notificationSound.ts` does not do: the file is bundled as a static asset and played by decoding it through the Web Audio API (`fetch` → `arrayBuffer` → `decodeAudioData` → `AudioBufferSourceNode`), same as if it had been sourced externally.

**`services/notificationSound.ts`** — `playExportCompleteChime()`: singleton `AudioContext` + decoded-`AudioBuffer` cache (reused across repeated exports in one session), always calls `ctx.resume()` before playing (idempotent if already running, covers the autoplay-suspended case), wrapped in one `try`/`catch` that never rethrows — a missing `AudioContext` constructor, a `resume()` rejection, or a `fetch`/`decodeAudioData` failure all fail silently so a sound glitch can never break the completion toast it accompanies.

**Test coverage added (18 new tests, 1007 → 1025):**
- `useExport.test.ts`: `formatElapsed` (7 tests — the task's own three examples plus zero-pad, the 59:59/3600 boundary, and floor/negative-clamp edge cases) and `formatElapsedLong` (6 tests — the task's own three examples plus the "no leading zero unit" cases).
- `notificationSound.test.ts` (new file, 5 tests): mocked `AudioContext`/`fetch` verify resume→decode→createBufferSource→start happens on success, the context is a true singleton across repeated calls, and none of "no `AudioContext` available," "`resume()` rejects," or "`fetch`/decode throws" ever reject the returned promise.

**Coverage gap, disclosed rather than worked around:** the hook's own start/tick/stop/reset timer behavior and the chime/toast integration were **not** exercised via a rendered hook — this repo has no jsdom/`@testing-library/react`/`react-test-renderer` (confirmed absent from `node_modules`, the same limitation `usePlayback.test.ts` and `useGlPreview.test.ts` already document in their own file headers), and adding those as new dependencies was out of scope for this change. Everything reachable as a pure function (`formatElapsed`, `formatElapsedLong`, the chime's own async logic via dependency-injected `AudioContext`/`fetch`) is unit-tested directly instead; the timer's live behavior and the sound/toast integration in the running app are proof-by-manual-verification only, per the feature's own validation checklist.

**What this does NOT change:** the export pipelines (`exportPipeline.ts`, `exportPipelineWebCodecs.ts`, `segmentEncoder.ts`, `frameRenderer.ts`) and the WebCodecs gate logic are untouched; `progressFor`/`stageLabelFor` and the existing progress-percentage/stage-label UI are untouched; the lock-block toast (`App.tsx`'s separate `toast`/`showToast`/`TOAST_DURATION` machinery, 5s auto-dismiss) is a distinct system and was not touched.

---

## Sync System Rewrite — Closing Record (WS1a through WS6, 2026-07-29)

The sync system rewrite is closed. Full technical detail for every workstream previously lived in `docs/sync-system-rewrite-architecture.md`'s Implementation Status section and per-decision `§3.x` writeups, and in `project-state.md`'s Decisions Log (2026-07-24 through 2026-07-29 entries) — both were migrated and removed 2026-07-30; see the "Sync System Rewrite (2026-07-24 to 2026-07-29) — Archived" section below for the surviving summary, or git history (commits `a3494d4` through `1fd9036`) for full original detail.

**What shipped, in order:** WS1a (Hirschberg diff aligner + unified normalizer, replacing the greedy positional matcher) → QB1/QB2 (RTF-residue `.txt` fix, `usePlayback.ts` infinite-loop fix) → QB3 (audio-energy boundary refinement investigated and removed as dead code — the reported boundary symptom was a project-specific playback bug, not a sync defect) → WS1b (bidirectional coverage metric + R13 two-signal abort gate + skip-unmatched semantics + snap clamps + parser fix + re-tile) → WS-logs (persistent sync-log panel + Bug 1/Bug 2 fixes + position-offset snap fix + silence-sharing fix) → snap-clamp dead-code removal → WS4 (stage-direction stripping + silence fail-loud + malformed-token filtering; language detection deferred, blocked on multilingual-model provisioning) → WS5 (speaker-label stripping + S3 stemming investigation closed without adding stemming + R8 threshold lock; the R5/N4 mid-line-bracket parser defect investigated and deliberately not fixed) → the **token-stealing bug-class fix** (commit `86ffc5a`, 2026-07-29) → **WS6** (this docs-only closing pass).

**Token-stealing bug-class fix (`86ffc5a`).** Root cause: a single global Hirschberg alignment has no temporal awareness, so an overflowing segment's own real trailing words can land, in the transcript, chronologically after a neighboring segment's real content — monotonicity then permanently blocks that neighbor from reaching backward to its own words. Fix: the global pass stays byte-identical; a targeted three-pass rescue runs afterward for any segment left at zero true matches (windowed Hirschberg + exact-text scan, then a global unclaimed-token exact-text scan for drifted anchors, then a sub-word concatenation scan for Whisper's phoneme-split tokens), exclusive on `globallyClaimed` tokens only — it can only add a match, never steal one. 18 new tests (1025 → 1043); manually verified by the user on the scene 152/153 repro. Full design: see the "Sync System Rewrite (2026-07-24 to 2026-07-29) — Archived" section below, or git history (commit `86ffc5a`).

**WS6 — final docs sweep, deferred-item cleanup, regression tag.** Corrected a stale "automated verification only" line in WS5's Decisions Log entry (manual verification of T1/T2 had since happened). Deferred-item cleanup per user decision 2026-07-29: multi-language support (S14) moved to `project-state.md`'s Deferred Polish Features; the R5/N4 parser defect, the s2-on-"lot" playback offset, and wav2vec2 forced alignment removed from open/deferred tracking (accepted as-is or not tracked, per each item's own status — regression tests for R5/N4 remain as historical locks). `project-state.md`'s Current State block, `docs/sync-system-rewrite-architecture.md`'s Implementation Status, and `CLAUDE.md`'s file-map entries (notably `whisperService.ts`'s rescue description, which had drifted to describe only 2 of the shipped fix's 3 passes) brought back in sync with the actual `86ffc5a` codebase. Regression tag `sync-known-good-2026-07-29` (the final WS6 docs-sweep commit, on top of the token-stealing fix `86ffc5a` — run `git log -1 sync-known-good-2026-07-29` for its exact hash) is the new active bisect target for the sync system, superseding `sync-known-good-2026-06-20` (retained as the historical pre-rewrite baseline). No source code changed in this pass. `tsc --noEmit` clean, `vitest` 1043/1043.

---

## Sync System Rewrite (2026-07-24 to 2026-07-29) — Archived

**Overview.** 11 commits (`a3494d4` through `daa34c6`, plus the follow-on token-stealing fix and export/heading polish that shipped in the same working window): WS1a → WS1b → WS-logs → WS4 → WS5 → WS6 (regression tag), plus the token-stealing fix, Export UX, and the heading text quality fix. Test count grew 754 → 1048 across the window. Regression tag `sync-known-good-2026-07-29` → `bd9e919` is the current active bisect target for the sync system (see `project-state.md`'s Key Invariants).

### What shipped

- **WS1a** — Hirschberg diff aligner + unified text normalizer, replacing the old greedy positional matcher and its two-normalizer split. Fixed bugs B2, S1–S5, G3, G4.
- **WS1b** — Bidirectional coverage metric + R13 two-signal abort gate; skip-unmatched semantics (Round 4 Ruling R4-1) replaced the old middle-gap abort; snap clamps; an inline-tag parser fix; covered-segment re-tiling after skip.
- **WS-logs** — Persistent `SyncLogPanel` (capped, reload-persistent sync log) + Bug 1 (info entry not firing) + Bug 2 (`filterToCoveredSegments` keeping `matched` not just `covered`) fixes + a position-offset snap fix (`snapBoundaries.ts`) + a silence-sharing regression fix (snap clamps made conditional on `!silenceFound`).
- **WS4** — Stage-direction stripping (`textNormalize.ts`'s `stripStageDirections`, scene-doc side only) + silence-detection fail-loud (`SilenceDetectResult` discriminated union, never throws) + malformed-token filtering (`filterMalformedTokens`, drops non-finite/out-of-range/empty tokens pre-alignment). Language auto-detection was investigated and explicitly **blocked**: the bundled Whisper model is English-only (`ggml-base.en.bin`), and whisper-cli silently ignores `-l auto` on an `.en` model — multilingual support needs the ~148MB `ggml-base.bin` bundled first, not scheduled.
- **WS5** — Speaker-label stripping (`SPEAKER_LABEL_RE`, uppercase-only/case-sensitive, preserves line-start `[tag]` anchors). S3 (stemming) investigated and closed **without** adding stemming — measured against the real aligner, no realistic inflected-word case pushes a segment below the confidence threshold. R8 thresholds (`LOW_CONFIDENCE_RATIO`, `MIN_COVERED_RUN_LENGTH`, `NOISE_FLOOR_COVERAGE`) audited and locked unchanged. The R5/N4 mid-line-bracket parser defect was investigated, confirmed real, and deliberately left unfixed — see `CLAUDE.md`'s `App.tsx` entry for the full root-cause writeup; the defect is pinned by regression tests in `sceneTagParsing.test.ts` carrying explicit `// DEFECT:` markers.
- **Export UX** — Live elapsed-time export timer (`useExport.ts`'s `elapsedSec`, ticked once/sec while exporting, frozen on every exit path) + a completion toast/chime (`formatElapsedLong` prose text + `notificationSound.ts`'s `playExportCompleteChime()`, fire-and-forget, success-only).
- **Token-stealing fix** (commit `86ffc5a`) — a per-segment temporal-bounding rescue layered on top of the unchanged global Hirschberg pass: Pass 1 windowed match (bounded to the segment's own anchor window, with a temporal-proximity bonus) → Pass 2 a global unclaimed-token exact-text scan (recovers past a drifted anchor) → Pass 3 a sub-word concatenation scan (recovers Whisper's phoneme-split tokens, e.g. "linen" → "lin"+"en"). Exclusive on `globallyClaimed` tokens only, so it can only add a match, never steal one.
- **Heading quality fix** (commit `1fd9036`) — headings previously had no 1080-reference scale on either the preview or export side (unlike body captions' existing `captionScale`/`refScale` convention), so the same authored `fontSize` produced very different on-screen proportions in each. Fixed with a shared `HEADING_REFERENCE_HEIGHT` (1080) scale correction across all three render call sites (`PreviewStage.tsx`, `frameRenderer.ts`, `webcodecsExport/textRenderer.ts`), plus 2x supersampled Canvas2D rasterization on both export paths for sharper glyph edges.
- **QB1/QB2** — RTF-residue fix in the `.txt` file reader (`textUtils.ts` now skips RTF destination groups) + a `usePlayback.ts` infinite-render-loop fix (`tick()` gated on a 10ms epsilon). **QB3** (audio-energy boundary refinement) was investigated in full, confirmed the reported "boundary lands on lot" symptom was a project-specific playback bug (not a sync defect), and was removed entirely as dead code rather than shipped.

### Key architectural decisions

- **Audio is the source of truth for timeline duration** — Σ content-segment duration always equals voiceover duration (Key Invariant (b), unaffected by the rewrite).
- **The global Hirschberg pass was kept unchanged throughout** — every targeted fix (WS4, WS5, the token-stealing rescue) layers on top of it rather than replacing it, to preserve the whole-document-optimality guarantees earlier tests already locked in.
- **Skip-unmatched replaces middle-gap abort** (Round 4 Ruling R4-1) — an unmatched segment is now skipped and covered segments re-tile contiguously, rather than aborting the whole sync run.
- **Silence-snap boundary rule**: silence found → snap to the silence center (trusted directly, no clamp); no silence found → fall back to the token midpoint. Monotonic-ordering is the only safety check — the R4 tolerance clamps were proven dead code (the token-midpoint fallback already lies within the spoken-word range by construction) and removed in commit `5952ea7`.
- **`filterMalformedTokens` verified accurate, not just plausible** — measured live against a real 294-segment project: 114 of 855 raw Whisper tokens filtered, all confirmed punctuation-only (zero real words dropped).

### Deferred items — final status

- **Multi-language support** — moved to `project-state.md`'s Deferred Polish Features (blocked on bundling the multilingual Whisper model).
- **R5/N4 inline-bracket parser defect** — accepted as-is; regression tests in `sceneTagParsing.test.ts` remain as permanent historical locks on current (defective) behavior.
- **s2-on-"lot" playback offset** — removed from tracking; re-attributed to a project-specific playback issue during QB3's investigation, not a sync defect.
- **wav2vec2 forced alignment** — removed from tracking (never scheduled; considered and dropped during the rewrite's design phase).

### Pointer

Full architectural detail — problem statement, the Hirschberg/coverage-metric/abort-gate design, section-by-section rationale (§3.1–§3.16), the full Decisions Log, and the Round 2–4 rulings — was in `docs/sync-system-rewrite-architecture.md`, deleted 2026-07-30 as part of this documentation cleanup. That detail, and the day-by-day Decisions Log entries this section summarizes, are preserved in git history: commits `a3494d4` through `1fd9036` on `webgl2-effects-engine`.

---

## Deep Segment Search + No-Asset Sync Summary + Contention-Aware Silence Claiming (2026-07-30)

Two additive features and one confirmed-production-bug fix, landed together in one session.

### 1. Deep segment search

The Segments-tab search box (`DropZonePanel.tsx`) previously substring-matched only `seg.text`. It now matches across the row's computed display title, its description text, and its matched asset's filename (all case-insensitive), OR'd with three exact-pattern matchers:

- a bare integer against the row's 1-based segment number ("12" / "08" / "008"),
- a decimal with an optional trailing "s" against the segment's displayed 1-decimal duration ("4.5" / "4.5s"),
- an MM:SS string against the segment's formatted start or end time ("00:12", minutes zero-pad tolerant).

Two small pure modules were extracted out of `DropZonePanel.tsx` to make this possible without duplicating logic the row display itself depends on: `src/services/timeFormat.ts` (`formatTime`, moved verbatim) and `src/services/segmentSearch.ts` (`matchesSegmentQuery` + `computeSegmentDisplayTitle`, also moved verbatim from the former inline `humanTitle`). Both the row's on-screen title and the search predicate's title-substring check now come from the same `computeSegmentDisplayTitle` call, and both the row's on-screen time codes and the search predicate's time-code matcher come from the same `formatTime` call — so neither matcher can silently drift from what the user is actually looking at. `DropZonePanel.tsx` also gained a memoized `assetsById` Map (keyed off `assets`), replacing a per-row `assets.find()` lookup that ran once per visible segment per render.

### 2. No-asset sync summary

Apply Sync now appends one summary `SyncLogEntry` per run when any committed segment ends up with no matched `assetId` — previously this state was silently visible only by scanning the Segments tab. New pieces:

- `SyncLogEntryType` gains `'no-asset'` (`types.ts`), rendered as an orange "NO ASSET" badge in `SyncLogPanel.tsx`'s `TYPE_STYLES`, alongside the existing skip/abort/warning/info/silence-error/malformed-token kinds.
- `App.tsx`'s `buildNoAssetSummaryEntry(syncRunId, noAssetSegmentNumbers, totalSegments, timestamp)` builds the entry at the `committedSegments` choke point (success paths only — the existing abort path returns before this point and owes no such entry), formatting a message like `"No asset matched for 33 of 294 segments: 7–18, 23, 78–97."`. Returns `undefined` when every segment has an asset, so the caller never appends a zero-count entry.
- `src/services/rangeCompact.ts` (new) — `compactRanges(numbers)` turns a list of 1-based positions into human-readable ranges: runs of 3 or more collapse to an en-dash range (`"7–18"`); runs of exactly 2 render as two singles (`"7, 8"`), not a 2-element range, since a range notation for two numbers reads worse than just listing them. Sorts and dedupes defensively regardless of input order.
- `SyncRunSummary` gains `noAssetCount?: number` (`types.ts`), same "optional because older persisted summaries genuinely lack it, treat undefined as 0" convention as the existing `silenceErrorCount?`.

### 3. Contention-aware silence claiming (`snapCoveredBoundaries` starvation-cascade fix)

**The bug.** `snapCoveredBoundaries` (`snapBoundaries.ts`) resolved adjacent-pair boundaries left-to-right, and each pair's silence candidates were filtered by a per-call `usedSilences` set — first pair to reach a silence claimed it, unconditionally, even when that silence sat far from its own search window's center and would have been a much better fit for the *next* pair. When an earlier pair's window was wide enough to reach into what was really a later pair's own trailing pause (the fixed 1.0s search radius used whenever two segments have touching/zero-gap tokens makes this easy), the later pair was left with zero unused candidates and fell back to the token-midpoint boundary — which, if the earlier pair's stolen silence happened to sit close to that midpoint, produced a segment duration at or near the `MIN_SEGMENT_DURATION` floor (0.1s). In other words: **greedy left-to-right claiming → a stolen silence starves a downstream pair → that pair collapses to the 0.1s floor**, even though every token was attributed correctly on both sides — this was a pure claiming-order defect, not an alignment bug.

**Confirmed trigger.** Reproduced live (via temporary `[diag-align]`/`[diag-snap]` console instrumentation, since removed) on a real 294-segment project: pair 248 claimed the pause that pair 249 needed, pair 249 in turn took pair 250's, and pair 250 — left with nothing — collapsed to the floor. The affected segments (249–251) were two short back-to-back lines ("It did." / "It always would.") immediately following a long segment.

**The fix — three passes, assignment instead of first-come-first-served:**
1. **Pass 1** computes every pair's search window up front, from a pristine pre-mutation snapshot of the `kept` array (never from the array being progressively written) — a prerequisite for Pass 2 to compare windows fairly, since the original single-pass loop's `??` fallbacks read `curr`/`next` fields that earlier iterations in the same call had already mutated.
2. **Pass 2** assigns each silence overlapped by more than one pair's window to whichever pair's own spoken midpoint (`spokenMid`) it sits closest to — not to whichever pair happens to run first. Exact ties go to the later pair (deterministic `<=` comparison). A silence overlapped by no window, or by exactly one, resolves the same as before.
3. **Pass 3** resolves boundaries left-to-right exactly as the original code did — closest-centre pick, token-midpoint fallback, monotonic safety-net check — except each pair now reads only its own Pass-2-assigned candidates instead of a shared mutable `usedSilences` set, which is deleted entirely.

Window math, the closest-centre selection rule, the no-silence token-midpoint fallback, and the monotonic check are all otherwise byte-identical to the pre-fix code.

**Test-count chain: 1048 → 1082 → 1083.** The two features above account for 34 new tests (7 in new `rangeCompact.test.ts`, 20 in new `segmentSearch.test.ts`, 2 in new `timeFormat.test.ts`, 5 for `buildNoAssetSummaryEntry` added to `syncLog.test.ts`), bringing the suite to 1082. The fix then adds one new regression test — `"contention-aware silence claiming (no starvation cascade)"` in `syncTiming.test.ts` — reproducing the confirmed real geometry (a long segment then two short segments then a normal one, only 2 real silences across 3 pairs, exactly the scarcity that lets an earlier wide window reach past its own best fit) with synthetic placeholder text, not the project's actual transcript. It asserts no segment collapses below 0.2s and that each boundary lands on the silence that genuinely borders it, bringing the suite to **1083**.

**One pre-existing test updated, not deleted.** `syncTiming.test.ts`'s `snapCoveredBoundaries` suite had a test (formerly titled "applies the monotonic check to a silence-derived boundary too") built on a fixture where one silence was contested between two pairs; under the *old* greedy claiming, pair 0 won it, pair 1 was starved onto a worse silence, and the monotonic fallback fired to resolve the resulting non-monotonicity. Under contention-aware assignment, that same contested silence is now assigned directly to pair 1 (the pair it's actually closer to) — pair 0 gets no assigned silence and honestly reports its own token midpoint, pair 1 lands on its closer silence with no fallback needed, and the monotonic-fallback branch this test existed to exercise never fires for this fixture anymore. The test was renamed to `"contention-aware assignment gives a contested silence to its better-fitting pair, needing no monotonic fallback here"`, its assertions updated to the new (strictly better — pair 1 gets its genuinely-closer silence instead of an unclamped fallback) outcome, with inline commentary explaining the before/after.

**Known coverage gap, disclosed rather than silently left.** The renamed test above was the *only* fixture in the suite exercising `snapCoveredBoundaries`'s monotonic-fallback branch on a silence-derived (not token-midpoint) proposal, and contention-aware assignment removes that fixture's ability to trigger it. No replacement fixture exists yet — one would need two genuinely non-shared, inverted-order silences (each visible only to its own pair), not a single contested one. Tracked in `project-state.md`'s Deferred Known Bugs.

**Separately surfaced, deliberately not fixed here.** The same audit found that the monotonic fallback substitutes a token-midpoint boundary *without re-checking that substituted value against `prevBoundary`* — so in principle a backwards boundary could still be written silently (and floored to 0.1s) if the token-midpoint fallback itself lands before the previous boundary. Never observed in production logs, and out of scope for a claiming-order fix; also tracked in `project-state.md`'s Deferred Known Bugs.

**Verification.** `tsc --noEmit` clean, `vitest` 1083/1083. Verification of the fix's real-world effect was manual only, on a macOS Intel dev build, against the same 294-segment project that surfaced the bug.

### Also in this pass: two stale `CLAUDE.md` file-map corrections

Unrelated to the three items above, found and fixed while touching nearby documentation: `CLAUDE.md`'s `SyncLogPanel.tsx` entry referenced a `services/syncLog.ts` module that has never existed — the entry-builder/append/cap logic it was describing lives in `App.tsx` (`makeSyncLogEntry`/`buildSkipLogEntries`/`appendSyncLogEntries` and siblings, ~lines 848–1043); only the *test* file lives under `services/` (`services/syncLog.test.ts`). And a standalone `SegmentEditorPanel.tsx` file-map entry described a file that doesn't exist — the Segments tab (list, search, lock/select/review) has always lived in `DropZonePanel.tsx`; the entry was removed and its content folded into `DropZonePanel.tsx`'s own entry, which now also documents the deep-search predicate and the `assetsById` Map from item 1 above.

### Test count

754 → 1048 across the sync rewrite window (see above) → **1083** after this session (1048 → 1082 via the two features, → 1083 via the fix's regression test — see the breakdown above).

---

## Rescue Forward Bound, Breath Discrimination, Aligner Snap Parity, Monotonic Re-Check (2026-08-02)

Six items landed together in one session, closing two confirmed production bugs and one previously-deferred residual, all in the sync timing pipeline (`whisperService.ts`, `snapBoundaries.ts`).

### 1. Rescue forward-ordering bound (`whisperService.ts`)

**The bug.** WS6's per-segment temporal-bounding rescue (`extractSegmentAlignments`) exists to recover a segment the global Hirschberg pass left with zero matches, by scanning every unclaimed token with no relation to the segment's own position (Passes 2/3). That is safe for a segment whose real speech genuinely exists somewhere in the audio, but a segment whose text *never occurs* — a heading, most commonly — still passes the rescue's gate (`matchedCount === 0 && anchorStart !== undefined`, true of every parsed segment, since `applyAnchorBasedTiming` forces the first segment's anchor to 0). Nothing stopped it from claiming a LATER segment's own genuine substitution material (words the global pass legitimately left unclaimed while preferring a longer, in-order match elsewhere). That flips `matched` to `true`, defeats `filterToCoveredSegments`' skip-unmatched classification, and the far-away token indices then flow into `snapCoveredBoundaries` as a real boundary.

**Confirmed in production**: a no-audio heading (first segment) was rescued from a word occurrence ~412s downstream, producing a ~206-second phantom first segment (`(412 + 0.5) / 2`) that collapsed its real second segment to near-zero duration.

**The fix.** A rescue claim's EARLIEST token must sit strictly before the first token any LATER segment truly matched in the (unchanged) global pass — skipping over intervening segments with no true match of their own, since those carry no ordering information. Order, not distance, is the signal: a fixed or slot-scaled distance/tolerance cap was considered and rejected, because WS6's own test 10 legitimately recovers a word 44s from a 3s slot — no distance threshold could exclude the 412s false positive without also excluding that legitimate case. `firstGlobalMatchSubjectOf` is computed once, before any rescue runs in the loop, from the global pass alone (never another segment's own — possibly not-yet-computed — rescue outcome), so every segment's bound is order-independent regardless of processing order. Applied identically to all three rescue passes (Pass 1's own window search is not immune either — it's anchored on the segment's own possibly-stale `anchorStart`, so a wide tolerance window can still reach past a later segment's true match).

**Observability.** `AlignResult` gains `recoveredVia?: 'windowed' | 'global' | 'concat'` and `recoveredRegion?: { startSec, endSec }` — present iff the rescue ran AND its claim was accepted (survived the bound). A rejected claim leaves the segment genuinely zero-matched with no provenance, same as a segment the rescue never touched. This is item 3 below.

### 2. Degenerate-pair guard (`snapBoundaries.ts`)

Defense-in-depth for the same false-positive shape: a pair whose spoken edges are inverted by more than `DEGENERATE_PAIR_INVERSION_THRESHOLD_SEC` (= `TEMPORAL_TOLERANCE_MAX_SEC`, 5.0s — this codebase's existing designated ceiling on plausible legitimate timing slop, reused rather than inventing a second uncoordinated constant) writes NO boundary for that pair — pre-snap timing (upstream's already-repaired numbers) is preserved untouched, rather than forcing `(lastSpokenEnd + nextSpokenStart) / 2` from corrupted indices. That forced-midpoint step is precisely what turned the 206s false-positive rescue claim into a phantom duration before this guard existed: it overwrote `applyAnchorBasedTiming`'s already-correct repair with one derived from the same corrupted indices. A MILD inversion (a few hundred ms — Whisper words spoken close together) is normal, pre-existing behavior and still falls through to the existing plain-midpoint fallback unchanged; `prevBoundary` is deliberately not updated for a skipped pair, so a later pair's monotonic check still compares against real committed ground truth.

### 3. Rescue observability (`whisperService.ts`, `App.tsx`, `types.ts`, `SyncLogPanel.tsx`)

`SyncLogEntryType` gains `'rescue'` (gray RESCUE badge — informational, not an error color, since this is the same WS6 rescue mechanism that has always existed, now surfaced to the user for the first time). `App.tsx`'s `buildRescueLogEntries(syncRunId, rescued, timestamp)` builds one entry per recovered segment from `AlignResult.recoveredVia`/`recoveredRegion`, formatted `"Segment N recovered via <pass> fallback — matched audio at MM:SS–MM:SS (anchor estimate MM:SS)."` (anchor clause omitted when the segment has no `anchorStart`, defensive — the rescue itself never runs without one). `SyncRunSummary` gains `rescueCount?: number`, same "optional, treat undefined as 0" convention as `silenceErrorCount?`/`noAssetCount?`.

### 4. Intra-segment silence rejection — three iterations (`snapBoundaries.ts`, `syncConstants.ts`)

**The bug.** A detected silence sitting INSIDE one segment's own speech (a breath) could still win the closest-centre pick for a pair's boundary if it happened to overlap the search window — placing the boundary mid-sentence and handing that segment's trailing words to its neighbor. Confirmed in production: a pair with `lastSpokenEnd` 18.87 chose the silence `[18.32, 18.70]` — entirely inside its own speech ("They're **[breath]** the worst") — producing boundary 18.51 and moving the trailing phrase "the worst" downstream into the next segment.

**Iteration 1 — window/span/tolerance (`isBoundarySilenceCandidate`).** A silence must not only overlap the pair's search window; it must also SPAN the gap between the two segments' speech, not sit inside either one's own. Both spoken edges are relaxed by `BOUNDARY_SILENCE_INTRUSION_TOLERANCE_SEC` (0.3s) first, because Whisper's word-boundary timestamps carry ~±0.3s of error and routinely stretch a word's span across the pause following it — testing exactly would reject genuine boundary pauses that merely overlap a stretched neighboring token (measured on the pinned 14-segment fixture: the real silence begins 0.16s after the next word nominally starts).

**Iteration 2 — token-gap discrimination (`fillsTokenGapWithinSpan`, `TOKEN_GAP_EPSILON_SEC`).** The tolerance above is a TIMESTAMP heuristic correcting Whisper's timestamp error using Whisper's own timestamps — inside its 0.30s band, a mid-sentence breath and a boundary pause smeared by a stretched token are genuinely indistinguishable to it. `fillsTokenGapWithinSpan` supplies independent evidence: the Hirschberg text alignment, which decided word ownership without consulting a timestamp at all. A silence that fits (within a 0.02s quantization epsilon, deliberately not a tolerance — every fixture in the suite fires at exact equality) entirely inside the gap between two consecutive tokens of ONE segment's own matched span is that segment's own breath, rejected however shallow its intrusion. This closed the exact production case above but left a structural gap: live Whisper output routinely fills a breath with several MICRO-tokens or flanks it with edge-stretched tokens, so no clean two-token gap exists for this test to fit against.

**Iteration 3 — coverage-composite discrimination (`isBreathSilence`, `BREATH_MAX_SPEECH_COVERAGE_RATIO`, `BREATH_TOKEN_OVERLAP_FLOOR_SEC`).** The first formulation tried was a bare speech-coverage ratio with no other signal — provably insufficient: a "stretched word" fixture (silence entirely inside one long token, must ACCEPT) and the real pair-4 breath geometry (same silence width, now spanning three touching micro-tokens, must REJECT) compute to the identical ratio (1.0), so no single cutoff can separate them. The discriminator that actually separates them is WHICH tokens the silence touches, not how much of them: a breath straddles at least one INTERIOR token of the matched span (real matched speech on BOTH sides, inside the same span) — a stretched-word silence lies inside a single token with nothing else touching it and can never manufacture one. `isBreathSilence`'s two branches: (a) coverage at or under `BREATH_MAX_SPEECH_COVERAGE_RATIO` (0.3) — predominantly true silence; (b) coverage ≥0.9 AND 2+ interior tokens each overlapped by at least `BREATH_TOKEN_OVERLAP_FLOOR_SEC` (0.09s) — multiple sandwiched speech fragments. The interior-only restriction (excluding the span's own edge tokens from the count) is itself a correction, not the first draft: counting edge tokens gave a legitimate short two-word-segment fixture a significant-count of 2 and incorrectly rejected a boundary the suite has pinned as ACCEPTED since before this feature existed — restricting to interior tokens closes that gap structurally (a two-token span can never have an interior token), independent of the floor's exact value. Branch (a) additionally closes a residual `fillsTokenGapWithinSpan` deliberately leaves open (a silence that starts in a token gap but runs past the segment's last word, so no following span token exists to complete containment) — that fixture computes to a 0.293 coverage ratio, just under the 0.3 threshold, so `isBreathSilence` catches it on the independent ratio branch even though the containment test still can't fire. **This residual is now CLOSED at the composed-filter level** (it was previously an accepted, documented limitation).

**Honest margin, stated not padded.** `BREATH_TOKEN_OVERLAP_FLOOR_SEC` (0.09s) is calibrated to admit pair-4's confirmed production interior overlaps (0.09s and 0.14s — the smaller landing EXACTLY on the floor, deliberately) while excluding a plausible sub-floor artifact (0.05s, exercised directly by a unit test) — a 0.04s margin on the one side an actual fixture exercises. Tracked as a watch item in `project-state.md`'s Deferred Known Bugs, not treated as fully closed.

**Order is deliberate and load-bearing.** Token-gap (1, alignment fact, short-circuits) → coverage-composite (2, independent alignment-adjacent evidence) → window/span/tolerance (3, timestamp evidence) — an alignment fact must not be forgivable by a timestamp tolerance. All three are composed in exactly one place (Pass 1's filter), so Pass 2's contention assignment can never disagree with Pass 1 about what a candidate is.

### 5. Aligner gap-fill fix port (`whisperService.ts`)

`alignScenestoTranscript`'s own internal silence-snap (used when nothing is skipped, so `snapCoveredBoundaries` never runs) still had the OLD first-come-first-served `usedSilences` claiming and none of the breath/intra-segment predicates above — a latent asymmetry between the two snap paths. Ported verbatim: the same 3-pass structure (Pass 1 candidacy via the same three predicates, imported from `snapBoundaries.ts`, which remains their canonical home; Pass 2 contention-aware assignment; Pass 3 left-to-right resolution), replacing `usedSilences` entirely. The two new predicates already guard on the -1 sentinel (`firstTokenIdx < 0`), which this full-array pass — unlike `snapBoundaries.ts`, which only ever sees covered/matched segments — can hand them directly for an unmatched/heading-only segment; they simply no-op to `false` and the pair falls through to the pre-existing window/tolerance test unaffected.

**Parity claim now holds under contention.** The file's own header previously caveated the "aligner reproduces `snapCoveredBoundaries`'s boundaries exactly" claim with "whenever there is no cross-pair silence contention," because the aligner's gap-fill still claimed greedily. A dedicated new "parity" test in `syncTiming.test.ts` constructs a contested silence and asserts both paths resolve it identically — the caveat is now removed from the header comment.

**Three pre-existing tests rewritten, not deleted, all visibly.** Two WS1b tolerance tests changed from asserting the OLD "no candidacy check, silence always wins if in-window" behavior to the new candidacy-aware behavior (`"a silence centre before lastSpokenEnd - tolerance is NOT clamped (silence wins)"` → `"a silence intruding past lastSpokenEnd - tolerance is rejected by candidacy, falling back to the token midpoint"`; similarly for the inverted-bounds companion fixture) — both now assert a rejection the old code didn't have. The pre-fix "middle-gap position offset" witness test (`"pre-fix witness: the aligner alone DOES shift the target when unmatched scenes precede it"`) stopped reproducing its own assertion once contention-aware assignment started running on the aligner's full array too — for that SPECIFIC shared-silences fixture, the silence in question happens to sit at an exact tie between the meaningless all-sentinel pair's placeholder midpoint and the real pair's midpoint, and "ties → later pair" happens to break in the correct direction for that fixture alone. Rather than silently accept the coincidence, the test was re-derived (`"witness (re-derived post-port, 2026-08-02): an off-centre silence closer to the placeholder pair than the real one still misattributes, proving snapCoveredBoundaries is not redundant"`) with a fresh, self-contained, deliberately OFF-tie silence that reproduces the original bug shape unconditionally — confirming `snapCoveredBoundaries` is still doing necessary work, not made redundant by the aligner port.

### 6. Monotonic fallback re-check (`snapBoundaries.ts` Pass 3)

Closes the gap tracked in `project-state.md`'s Deferred Known Bugs since the 2026-07-30 contention-aware-claiming session: when a chosen boundary would move backwards past `prevBoundary`, the fallback substitutes the pair's own token midpoint — but that substituted value was never itself re-checked against `prevBoundary`, so corrupted/overlapping upstream alignment data (the same shape the degenerate-pair guard exists for, just under its 5s threshold) could in principle leave the substitution backwards too, and the pre-fix code committed it silently. The fix re-checks: if the substituted midpoint is STILL backwards, it clamps to `prevBoundary` (DEV-gated warn) instead — collapsing that pair to the `MIN_SEGMENT_DURATION` floor, exactly what the pre-fix code would have produced anyway once the duration-floor `Math.max` absorbed the backwards value, but the written BOUNDARY itself is now always monotonic. One pre-existing test's title/behavior updated visibly to cover the re-check.

### Verification

`tsc --noEmit` clean. `vitest` **1083 → 1133** (all new tests; no existing test deleted — three were rewritten with justification, described in item 5 above). Manually verified in the Tauri dev app against real 174-segment and 294-segment projects, confirming: the previously-observed no-audio-heading phantom-segment behavior no longer reproduces, and the "They're the worst" mid-sentence breath boundary no longer steals the trailing phrase.

### Test count

1083 → **1133** this session (all new coverage — no test deleted; three pre-existing tests rewritten in place with inline commentary, see item 5's "Three pre-existing tests rewritten" note).

---

## Window-Overlap Silence Regression Fix, Timeline Redesign, Bug C Landed, Head-Extension, Copy-Logs, Panel Polish (2026-07-31)

One consolidated catch-up entry spanning two pieces of work that shipped without their own write-up at the time: commit `4fcf676` (Bug C's run-survival gates + copy-logs button, recovered from a dropped stash) and a same-day follow-on session (the window-overlap regression fix, the Timeline lane redesign, segment-1 head-extension, and Segments-panel polish). Both are folded into this one dated entry as part of a final documentation-sync pass, rather than split retroactively.

### 1. Window-overlap silence candidacy — regression fix (`snapBoundaries.ts`, `whisperService.ts`, `syncConstants.ts`)

**The regression.** `isBoundarySilenceCandidate` required a candidate silence to satisfy two conditions: overlap the pair's search window, AND span the gap between the two segments' own speech (each spoken edge relaxed by `BOUNDARY_SILENCE_INTRUSION_TOLERANCE_SEC`, 0.3s, on the theory that Whisper's word-boundary timestamps carry only that much error). The second condition was itself the 2026-08-01 breath-discrimination fix (iteration 1, see the prior entry above) — but bisected against a real 173/174-segment production project against the pre-regression build (`0c83a06`, pure window overlap, no SPAN test at all), real trailing-word timestamps were found to blur into the following pause by considerably MORE than the 0.3s budget routinely, not just in edge cases. The SPAN/tolerance condition was rejecting genuine boundary silences wholesale — every such pair fell back to the token midpoint, clamped hard against the blurred spoken edge — while `0c83a06`'s pure window-overlap test produced clean, correct boundaries on the same project and audio.

**The fix.** The SPAN/tolerance condition is deleted from `isBoundarySilenceCandidate` rather than re-tuned: it is a TIMESTAMP heuristic, and no fixed tolerance can both forgive ordinary trailing-word blur and still catch a genuine breath from edge-distance alone — the two aren't separable on timestamp distance alone. `isBoundarySilenceCandidate` is now pure window-overlap, matching pre-regression behavior. This does not reopen the original mid-sentence-breath production bug the SPAN condition was originally added for: that job is fully covered by `fillsTokenGapWithinSpan`/`isBreathSilence` (ALIGNMENT evidence, not a timestamp guess), which are composed ahead of `isBoundarySilenceCandidate` in Pass 1's filter and are unaffected by this deletion — the pair-4 word-theft regression fixture still rejects on `fillsTokenGapWithinSpan` alone. `BOUNDARY_SILENCE_INTRUSION_TOLERANCE_SEC` (`syncConstants.ts`) is now unused everywhere and was deleted, along with its own dedicated doc-comment block. `whisperService.ts`'s `alignScenestoTranscript` gap-fill calls the same (now pure-window) predicate, so both snap paths remain in parity.

**Contiguity invariant.** `snapCoveredBoundaries` only ever wrote `next.startTime = snapped`, but `curr.duration` is floored at `MIN_SEGMENT_DURATION` (0.1s) — when a floored `curr` extended past the just-written `snapped` boundary, `startTime[i] + duration[i] === startTime[i+1]` could break. This was previously invisible under the Timeline's old flexbox flow (each card's position was an accumulated sum of prior siblings' widths, which self-corrects any such gap/overlap), but became a visible card overlap once the Timeline switched to absolute positioning (item 3 below), where each card's position is a direct function of its own `startTime`. Fixed with one check appended after every boundary write: if `curr.startTime + curr.duration > next.startTime`, advance `next.startTime`/`next.anchorStart` to match. `startTime[i] + duration[i] === startTime[i+1]` now holds unconditionally on this function's output for every adjacent covered pair.

**Verification.** `tsc --noEmit` clean. Both pre-existing `isBoundarySilenceCandidate` unit-test fixtures that asserted rejection-by-tolerance were rewritten to assert acceptance instead (`"rejects an intrusion deeper than the tolerance..."` → `"accepts a silence deep inside where the ... segment's speech used to be ... no longer rejected on edge-distance alone"`), along with the two `WS1b` fixtures pinning the same old tolerance behavior. One monotonic-fallback re-check fixture's expected boundary shifted from 9.5 to 9.6 to reflect the contiguity fix cascading one step further than before.

### 2. Deferred bugs B, D, E — closed

Three items tracked in `project-state.md`'s Deferred Known Bugs list, investigated as part of the same production-log analysis behind item 1 above:

- **B (timeline segment edge-drag regression)** — re-investigated and confirmed a non-bug: current resize-drag behavior (`isResizingRef`, live-width-via-tagged-DOM-refs, single `applyDurationChange` commit on mouseup) tracks the mouse correctly. The original report's "jumps to a fixed length and locks both segments" symptom is consistent with normal lock/re-sync snap-back behavior, not a broken drag gesture.
- **D (quiet-pause detection gaps)** — confirmed via the same production-log review as item 1: `silenceDetector.ts`'s fixed threshold legitimately misses some quiet/short real pauses, and the midpoint fallback this triggers is correct, designed behavior, not a defect. (This matches the assessment `project-state.md` already carried pending confirmation — now confirmed, not merely assumed.)
- **E (`BREATH_TOKEN_OVERLAP_FLOOR_SEC` margin)** — re-assessed: if a future project's real Whisper output ever lands an interior-token overlap in the un-covered 0.05–0.09s band, the worst-case outcome is a boundary landing on a token midpoint instead of a silence center — ordinary, bounded visual drift of the same kind the no-silence fallback already produces routinely, not a functional or correctness defect. No longer tracked as an open bug.

All three are removed from `project-state.md`'s known-bugs list (now empty) — see the Docs entry below.

### 3. Timeline absolute positioning + lane redesign + boundary markers (`Timeline.tsx`, `waveformPeaks.ts`)

Every segment card (thumbnail track and waveform-lane sub-cells) moved from implicit flexbox flow to `position: absolute; left: startTime*pixelsPerSecond; width: duration*pixelsPerSecond`, keyed off a new `computeTotalDuration` helper (the actual rightmost segment edge, not a bare duration sum — the two only coincide when segments are gapless). This makes each card's position a direct function of its own `startTime` rather than an accumulated sum of every prior sibling's width, which is what surfaced the contiguity gap in item 1.

New thin (1px) boundary-marker lines span every lane (heading/segment/waveform) at once, one per interior segment boundary, at the lanes-wrapper level alongside the playhead — restoring the ability to track one boundary across lanes that a plain per-lane border couldn't provide after the redesign.

Each lane's border moved from a border-on-the-container to a separate `inset-0` overlay div painted last, working around a confirmed real-WKWebView bug where `overflow:hidden` + `border-radius` on a parent hides descendant content once a child uses `transform` (hit hardest by the segment lane's video/motion.img elements, which scale on hover/active). Each lane also gained an explicit `totalDuration*pixelsPerSecond` width instead of stretching to the scroll container's viewport width, fixing a border overlay that previously only matched the visible strip at low zoom and appeared to "vanish" while scrolling at higher zoom.

The waveform lane's inset-panel treatment (background + hairline border + radius) moved from the outer viewport-width wrapper onto the actual full-width tile container, fixing the same "border scrolls away" symptom; its background changed from semi-transparent black (which read as near-identical to the app's own near-black backgrounds) to a solid mid-grey (`#141414`) so the lane reads as a distinct surface. `waveformPeaks.ts`'s fill/stroke opacities were bumped toward full opacity to match, so waveform bars stay legible against the new panel background.

### 4. Bug C — consecutive-run survival gates, recovered from stash and landed (commit `4fcf676`)

Landed separately (commit `4fcf676`, recovered from stash `ad38fc5` after being dropped during a detached-HEAD bisect against `0c83a06` and a branch checkout sequence — recovered via `git reflog show --all`), documented here as part of this catch-up pass.

**The gap.** `project-state.md`'s tracked item (C): the Hirschberg global pass can accept a segment (`matchedCount > 0`, confidence above `LOW_CONFIDENCE_RATIO`) whose true matches are scattered, common-word collisions rather than one real contiguous run of the segment's own text. Verified against a real 174-segment production project: 15 of 16 segments an initial run-length requirement skipped were genuinely spoken, not false positives — 7 short segments where an uncommon word ("las-charge", "rockcrete", "Necron"...) caused a vocabulary-gap mis-transcription, and 8 longer segments where the same kind of miss fragmented one long run into several shorter ones.

**The fix — two layers, replacing an earlier miscalibrated ratio-scaled formulation.** `computeLongestRunWithHoles` (`whisperService.ts`) finds the longest run of consecutive true matches tolerating up to `RUN_SURVIVAL_MAX_HOLE` (2) non-matched positions inside it, provided the transcript-side token indices stay contiguous across the hole (a genuine paraphrase/deletion, not two unrelated matches bridged by accounting) — a run can never start or end on a hole. `requiredRunLength` bands the minimum qualifying run by flat, length-independent minimums (`RUN_SURVIVAL_MIN_RUN_SHORT`=2 for 4-10 word segments, `RUN_SURVIVAL_MIN_RUN_LONG`=4 for 11+, a 1-3 word segment needs only a run of 1) — replacing an earlier ratio-scaled formulation that grew the requirement WITH segment length, backwards from how ASR errors actually distribute. A segment that still fails the run requirement gets a density-based fallback, `isLocallyClustered`: survives when overall match confidence clears `RUN_SURVIVAL_DENSITY_MIN_CONFIDENCE` (0.5) AND matched words are tightly grouped (median transcript-token gap at or under `RUN_SURVIVAL_DENSITY_MAX_MEDIAN_GAP`, 4) rather than scattered end-to-end. The one genuine false positive in the production project (a heading whose content never occurs in the audio at all, 0 of 9 words matched) is untouched by either gate — it fails `RUN_SURVIVAL_DENSITY_MIN_CONFIDENCE` outright.

**Observability.** `AlignResult.longestRun` threads through both alignment call sites into `App.tsx`'s `SkippedSegmentRecord.longestRun` and `SyncLogPanel.tsx`'s skip-reason display (`, longest run N`), visible rather than silent — the accepted trade-off on the new 1-3 word band (a 2-word segment can now survive on a single matched word) is fully inspectable in the sync log.

**Also in this commit: copy-logs button** (`SyncLogPanel.tsx`) — a header button that copies the full sync log (every entry, newest-first, formatted exactly as displayed on screen) to the clipboard via `navigator.clipboard.writeText`, with a hidden-textarea `document.execCommand('copy')` fallback, for pasting into a bug report without manual transcription.

### 5. Segment-1 head-extension (`syncEngine.ts`, `App.tsx`)

The last segment already extends to `audioDuration` (`snapCoveredBoundaries`'s own tail extension, and `applyAnchorBasedTiming`'s PASS 3) — the audio is the source of truth for total length. Nothing gave the FIRST segment the equivalent treatment: `segments[0].startTime` passes through `snapCoveredBoundaries` untouched, still sitting at the aligner's first matched word rather than true t=0 (real lead-in silence before narration starts is common). New `headExtendFirstSegment` (`syncEngine.ts`) stretches `segments[0]` back to `startTime` 0 by growing its duration to absorb the lead-in — the segment's END is unchanged, so there is no contiguity ripple past segment 2, and no-op on a locked first segment or one already starting at 0. Called once by `App.tsx` immediately after `snapCoveredBoundaries`/`retileCoveredSegments`, deliberately not folded into `snapCoveredBoundaries` itself, which is pair-boundary logic exercised in tests on synthetic slices where index 0 isn't necessarily the timeline's real first segment.

### 6. Segments-panel spacing + hover-affordance centering (`DropZonePanel.tsx`)

Row spacing (the "+ Add Heading" button, heading rows, segment rows) now comes from exactly one place — the scroll container's own `flex flex-col gap-1.5` — replacing a per-row `mb-1.5` that measured visibly uneven around the heading row in the real Tauri/WKWebView shell (a margin-collapse quirk despite identical classes on both row types). A heading row gained an invisible `h-3` spacer beneath it so its visual gap matches a segment row's own hover-reveal "+ heading" gap-button height. That hover-reveal gap button itself is now sized to the FULL visual gap (its own height plus the container's trailing `gap-1.5`, `1.125rem` total, via `h-[1.125rem] -mb-1.5` so the extra height doesn't add real on-screen spacing) with `items-center` centering the button at the true gap midpoint — previously it centered within only its own `h-3` sliver, sitting 3px above the actual gap's center.

### Verification

`tsc --noEmit` clean. `vitest` **1133 → 1163** (commit `4fcf676`, Bug C regression coverage) **→ 1165** (this session — net new: 4 `headExtendFirstSegment` tests; the window-overlap/contiguity fix itself rewrote existing fixtures in place rather than adding new ones, per item 1's Verification note above).

### Test count

1133 → **1163** (`4fcf676`) → **1165** this session.

---

## Pipeline Contract Program §6.0 — Timeline Smoke Tests (2026-08-01, commit `7e6309f`)

R3 in `docs/sync-pipeline-contract-plan.md`'s risk register flagged `Timeline.tsx` as the freshest,
least-covered code in the pipeline — absolute positioning, lane redesign, cross-lane boundary
markers, and the border-as-overlay WebKit workaround all landed 2026-07-31 with zero automated
coverage. Rather than wait for contract pair 6→7 (last in pipeline order), §6.0 pulled the
test-debt half forward as an immediate, decoupled prerequisite: it needed tests, not a contract.

**What shipped.** Pure layout math extracted out of `Timeline.tsx`, `TimelineWaveform.tsx`, and
`DropZonePanel.tsx` into a new `src/services/timelineLayout.ts` — segment/heading/marker position
formulas, zoom-to-pixels-per-second conversion, seek-time-from-click math, trim-drag geometry,
waveform tile specs, the duration-bar clamp, and drop-gap resolution — plus `computeTotalDuration`
(already module-level and pure; re-exported from its original location rather than moved, so
existing importers are unaffected). Two new test files pin it: `timelineLayout.test.ts` (34 tests,
pure geometry — segment/marker positions at known zoom levels, the max-right-edge vs.
duration-sum divergence for a deliberately non-contiguous array, boundary-marker index-0 skip) and
`timeline.render.test.tsx` (static markup render checks against the extracted functions).

**Zero behavior change.** No production logic moved beyond straight extraction — verified manually
in the dev app: segment positions, zoom, seek, trim drag, boundary markers, waveform tiling, and
segments-panel layout all identical to pre-refactor.

**Accepted limitation — honest about what the tests do NOT cover.** The render test only exercises
static markup against the 800px zoom fallback; it does not drive the `ResizeObserver`-measured-width
path (this repo has no jsdom/testing-library, the same gap `usePlayback.test.ts` and
`useGlPreview.test.ts` already document, so there is no DOM harness to measure a real width
against). WebKit compositing/stacking behavior (the border-as-overlay workaround's actual reason
for existing), hover transitions, and drag feel all remain manual-only — no automated test can
observe them without a real WKWebView.

**Scope boundary.** This closes only the test-debt half of R3. The contract half — the "every
meaningful failure produced a log entry" assumption, and `retileCoveredSegments`'s missing
contiguity guarantee (`App.tsx:836-849`, the fallback path used when tokens/silences are
unavailable to snap against) — stays open, deferred to Pair 6 as originally planned. It does not
unblock or shorten the contract program; Pair 1 audit is next.

**Verification.** `tsc --noEmit` clean. `vitest` **1165 → 1199** (34 new tests, this commit).

---

## Pipeline Contract Program Pair 1 — Contract 1→2 Shipped (2026-08-01)

Pair 1 (Transcription → Normalization) closed out per `docs/sync-pipeline-contract-plan.md`'s §3
per-pair workflow. Three code commits, in order, plus this docs commit:

- `684060a` — `refactor(sync): extract log-entry builders from App.tsx into services/syncLog.ts`
  (pure move, prerequisite — see deviations below)
- `c7db7cc` — `chore(sync): remove dead code — unreachable alreadyTranscribed branch, dead
  parseTimestamp, unread _totalDuration param`
- `e7fb367` — `feat(sync): Contract 1→2 validators — drop-distribution + token-ordering,
  staging-path log reporting, rescue-window audioDuration fix`

Manually verified in the dev app today: staging-path log entries render with a drop-reason
breakdown on a real project, Apply Sync output is unchanged, and the new validators produced no
false positives against real data.

**What shipped.** `filterMalformedTokens` (`whisperService.ts`) now records a `TokenDrop`
(index/reason/raw values) per rejection instead of only a count. `services/syncContracts.ts` adds
two Contract 1→2 validators — `analyzeDropDistribution` (Risk R1: flags a WARNING when more than
`DROP_CLUSTERING_RATIO_THRESHOLD` of a run's drops cluster inside one
`DROP_CLUSTERING_WINDOW_SEC` window, skipped below `DROP_CLUSTERING_MIN_DROPS` total drops) and
`validateTokenOrdering` (assumption 5: flags a WARNING on any ascending-time inversion in the
filtered token array) — combined behind `validate1to2`. The staging-time transcription path
(`useWhisper.ts`'s `startTranscription`) now mints/reuses its transcription `jobId` as a
`syncRunId` and appends silence-failure / malformed-token / contract-violation entries to the
project's sync log via `appendSyncLogEntries`, same as the Apply Sync path already did — closing
R11 (staging-path findings were previously console-only). `extractSegmentAlignments` accepts an
optional true probed `audioDuration` and uses it for the last-segment rescue window instead of
the token-derived approximation (`tokens[tokens.length-1].endSec`, which misses trailing silence
after the last spoken word) — both production call sites in `useWhisper.ts` now pass it.
`SyncLogEntry` widens with `severity`/`fixHint` fields (plan §4: every WARNING/ERROR carries a
user-facing fix hint). Test count: 1199 → 1219.

**Four deviations from the implementation prompt, and why each was correct:**

1. **`audioDuration` made an optional param, not required.** `extractSegmentAlignments` gained
   `audioDuration?: number` rather than a required parameter, keeping the token-derived fallback
   for callers that don't supply it. Forcing it would have required inventing a synthetic duration
   at roughly 105 existing `syncTiming.test.ts` call sites that test this function directly against
   hand-built fixtures with no real probed duration — churn with no correctness upside, since those
   fixtures' token-derived approximation is already correct for their own synthetic audio. Both
   production call sites pass the real value; the fallback is a documented residual, not a silent
   gap (see the plan's assumption-8 row).
2. **`jobId` reused as `syncRunId` on the staging path, no fresh mint.** The plan's R11 entry left
   open whether a fresh UUID or the existing transcription job id should tag staging-path log
   entries. Reusing `jobId` was chosen because it already uniquely identifies one staging
   transcription attempt (it drives `TranscriptionStatus.jobId` and the abort/generation-counter
   machinery) — minting a second id would create two identifiers for the same event with no
   distinct purpose for either.
3. **Lowercase `severity` values and a plain `message` field**, per plan §3/§4's own examples,
   rather than inventing new casing or a differently-named field — `ContractViolation` and the
   `SyncLogEntry` fields it feeds were built to match the plan's stated shape exactly, not a
   reinterpretation of it.
4. **Row 8a (rescue-window `audioDuration`) tests use hand-built fixtures, not a captured
   production trace.** The plan's evidence for assumption 8 was a code-reading argument (token end
   ≠ probed duration), not a production repro with recorded numbers — so `syncTiming.test.ts`'s new
   Row 8a tests construct a minimal synthetic case (a last segment whose expected window only makes
   sense against the true audio length) rather than replaying an unavailable real trace.

**Plan-doc corrections applied in this commit** (full detail in
`docs/sync-pipeline-contract-plan.md` itself, not restated here): the §2 assumption table for
Contract 1→2 (rows 5–8) updated to the audit's verified verdicts; R1 marked INSTRUMENTED, not yet
production-calibrated; R11 marked RESOLVED WITH CORRECTIONS — the plan's own "Option A branch
needs a fresh UUID" text was wrong (that branch was proven dead and deleted, not wired), its claim
that `SyncLogPanel` groups by `syncRunId` was wrong (it's a flat reverse-chronological list, zero
references to the field), and the `syncLog.ts` extraction it never mentioned turned out to be a
hard prerequisite (`useWhisper.ts` cannot import from `App.tsx` without a circular dependency); the
dead-`parseTimestamp` citation was corrected (it was cited as live JS code but had zero references
— the Rust `parse_timestamp` in `whisper.rs` is the actual live parser); Row 7 (silence ordering)
recorded as confirmed-in-practice by reading every producer call site, with the runtime assertion
itself deferred to Pair 6; the `Verified-against-HEAD` stamp bumped to `e7fb367`.

**Observed production evidence.** Re-running the drop capture against the real project that
originally surfaced Risk R1 (169 of 1973 tokens dropped, ~8.6%) broke the count down for the first
time: **139 `empty-text` + 30 `inverted-or-zero-duration`**, zero `non-finite`/`negative-start`/
`past-audio-end` drops. Neither new validator fired against this project's real data — no
clustering above the 40% threshold, no token-ordering inversions — a clean pass that reflects this
particular project's drops not being concentrated in one corrupted stretch, not an absence of
checking. The `DROP_CLUSTERING_*` constants remain the plan's stated starting values, unvalidated
against a genuinely clustered case.

**Next.** A user-reported regression (long-pause voiceover audio producing incorrect sync) outranks
Pair 2 and is queued as an immediate audit before Contract 2→3 work begins — see `project-state.md`.

---

## Long-Pause-Voice Regression — Root Cause + Boundary-Quality Checker Phase 1 (2026-08-02)

**The report.** A user with a voiceover containing unusually long pauses (multi-second silences
between spoken phrases) found several segment boundaries landing in the wrong place — visibly mid-
sentence rather than in the gap. Not reproducible on a "normal" voiceover with typical breath-length
pauses; only surfaced on long-pause audio.

**Root cause — three factors compounding, not one bug:**

1. **Whisper timestamp under-run on long silences.** Whisper's own word timestamps tend to
   under-run (report a word ending earlier than it actually did) more aggressively across a long
   silent stretch than across a short one — the model has less acoustic context to anchor the
   boundary. This shifts `lastSpokenEnd`/`nextSpokenStart` inward from where the audio actually
   changes.
2. **A narrow search window.** `computeBoundarySearchWindow` (`snapBoundaries.ts`) bounds its
   candidate search to a window derived from the spoken-edge midpoint and gap width. On a long
   pause, the true quiet gap is wide, but the under-run from (1) can still leave the real silence
   sitting outside — or at the very edge of — that window, so `boundaryUsedFallback` correctly
   detects no assignable silence and the pipeline falls back to the plain spoken-edge midpoint,
   which on a long pause can be seconds away from where the audio is actually quiet.
3. **A removed distance guard.** The 2026-07-31 window-overlap regression fix (see this file's own
   entry, "Window-Overlap Silence Regression Fix...") deliberately deleted
   `BOUNDARY_SILENCE_INTRUSION_TOLERANCE_SEC` — a fixed-tolerance edge-distance check — because it
   was rejecting genuine boundary silences wholesale on ordinary Whisper blur. That fix was correct
   for the case it targeted (normal-length pauses), but it also removed the only mechanism that
   would have caught a fallback boundary landing implausibly far from either spoken edge on a long
   pause. No replacement guard was added at the time — the checker below is that replacement,
   observability-first rather than a distance re-tolerance (a fixed tolerance was already proven
   unworkable by the 2026-07-31 fix).

None of these three is individually wrong: Whisper's under-run is a model property, the search
window is deliberately bounded (an unbounded search would risk stealing a neighboring pair's real
silence), and the 07-31 deletion fixed a real, worse regression. The combination on long-pause audio
specifically is what produced visibly bad boundaries with nothing in the pipeline flagging them.

**Phase 1 checker — what shipped (commit `458224c`).** Rather than re-introduce a fixed-tolerance
guard (rejected per the 07-31 lesson) or change the alignment/snapping math itself (out of scope
for a hardening pass per `docs/sync-pipeline-contract-plan.md` §3 Step 2 — "changing what the
alignment or snapping math computes... is written up and scheduled separately"), Phase 1 adds a
**post-hoc, read-only measurement pass** (architecture B: runs strictly after the voiceover
waveform's peaks are built, never reordering or altering any existing sync step):

- `boundaryQuality.ts`'s `findQuietestRegion` — an O(n) sliding-window amplitude minimum over the
  waveform peaks already built for the timeline display, answering "where, inside this pair's own
  search window, is the audio actually quietest?"
- `snapBoundaries.ts` exports `computeBoundarySearchWindow` (pure move, no behavior change) and a
  new `boundaryUsedFallback`, which re-derives — from the exact same candidacy predicates
  `snapCoveredBoundaries` already uses — whether a given pair's committed boundary was placed by
  the plain-midpoint fallback rather than a real assigned silence.
- `syncContracts.ts`'s `validateBoundaryQuality` (Contract 5→6, rule `loud-fallback-boundary`) flags
  a fallback boundary whose own waveform amplitude is loud relative to a real, farther-away quiet
  region — see the constants' own calibration story below for the exact gate.
- Wired in `App.tsx` right after `buildVoiceoverWaveform`, at `'info'` severity (not `'warning'`) —
  Phase 1 is observability only; nothing acts on a flagged boundary yet.
- A found-and-fixed bug along the way: `buildVoiceoverWaveform`'s own completed-build dedup check
  had a gate-order bug that mis-deduped already-completed builds, spuriously returning `null` for
  peaks that already existed — fixed as part of this same commit (see `snapBoundaries.ts`'s diff).

**Calibration.** The dev-only harness `window.__calibrateBoundaryQuality({ detail })` (`App.tsx`)
re-derives fresh alignments/silences from the current project (never mutates it) and either sweeps
`BOUNDARY_QUALITY_K_SWEEP × BOUNDARY_QUALITY_WINDOW_SWEEP` (how many pairs each K/window
combination would flag) or, in detail mode, runs the checker once in `'report-all'` mode to print
every fallback pair's actual amplitude numbers, sorted loudest-first.

Run against two real projects:

- **447-segment long-pause project** (the one that surfaced the report) — the checker's flagged set
  included all 5 boundaries independently confirmed bad by manual listening/diagnostic inspection,
  plus 24 additional true positives (29 total) the initial K/window-only sweep would have missed or
  over-fired on.
- **174-segment older project** (no known long-pause issue, used as a specificity check) — **zero**
  false positives at the same calibrated gate.

**Why a dual gate, not just the K-ratio.** The initial K/window-only sweep produced a false-positive
class the user identified by ear: a boundary sitting in a genuine but brief mid-sentence dip (a
speaker's natural micro-pause inside a sentence, not the real inter-sentence gap) would pass a pure
loudness-ratio test if that dip happened to be quiet enough, even though it sits right next to the
boundary rather than meaningfully "elsewhere." **Distance, not just loudness, is the discriminating
feature** — a quiet point immediately adjacent to the boundary is the same dip the boundary already
landed near; a quiet point meaningfully far away is a genuinely different, better placement the
fallback missed. This is why the calibrated rule (`syncConstants.ts`) requires ALL of: an absolute
amplitude floor (`BOUNDARY_QUALITY_ABSOLUTE_AMPLITUDE_FLOOR = 0.05` — below this the boundary is
already near-silent, any ratio computed off near-zero values is noise), a minimum distance
(`BOUNDARY_QUALITY_MIN_DISTANCE_SEC = 0.10` — filters exactly the mid-sentence-dip class above), and
the loudness ratio (`BOUNDARY_QUALITY_LOUDNESS_RATIO_K = 2`).

**What's next.** Phase 2 (the watcher that would actually *move* a flagged boundary to the quiet
point) is explicitly deferred, not folded into this commit — per §3 Step 2's rule that a real math-
behavior change is "written up and scheduled separately, not folded into the hardening pass." It is
queued in `project-state.md` Active Tasks, gated on the same calibrated rule, and requires end-to-
end verification of the fresh-voiceover (peaks-absent) first-sync flow before it can land, since
that's a code path this Phase 1 pass didn't need to exercise (a first sync's peaks aren't built yet
when the pass would want to run). Also newly recorded as a working rule: audit/investigation reports
must be persisted into `docs/`, not left to live only in chat transcripts — this investigation's
findings above are the first case of that rule being followed.

---

## Index-Based Seam Exemption for `isBreathSilence` — Implementation Record (2026-08-03)

**What shipped (commit `c593f1d`).** `isBreathSilence`'s multi-fragment breath override (a silence
with high speech-coverage ratio plus 2+ significant interior tokens, previously assumed to always
mean internal fragmentation of one span's own speech) was root-caused and fixed. The override's
coverage/ratio math is computed relative to the tested span's own first token's timestamp — and
Whisper's timestamp for a span's first token can smear 100–900ms backward across a real silence
boundary (the model assigns the *preceding* pause's own onset to the next word's start rather than
to when it's actually articulated). When that happens, the override wrongly reads a genuine
inter-segment seam as the span's own internal breath.

**The fix** re-poses the same question in **token index** terms instead of timestamp terms: does the
tested silence sit at or after the point in the token array where the immediately preceding span's
own genuine last match (`otherSideLastTokenIdx`) ends? Token indices come from the Hirschberg
text-alignment pass — a pure text match, never smeared — so this is exact where the timestamp-based
version was not. `isBreathSilence` gained an optional `otherSideLastTokenIdx` parameter (default -1,
disabling the exemption — every pre-existing 4-arg call site is unaffected). Wired in both
`snapBoundaries.ts`'s `snapCoveredBoundaries` and `whisperService.ts`'s `alignScenestoTranscript`
gap-fill (kept in parity, same as every other predicate that gap-fill ports from `snapBoundaries.ts`).

**NEXT-side only.** The exemption is wired for the NEXT segment's own span only, anchored on curr's
own `lastTokenIdx` — genuinely temporally adjacent to the tested silence, real seam evidence. A
CURR-side variant was tried and found unsound: the only symmetric anchor for a curr-side call is the
segment *two positions back* from the tested silence, which has no temporal relationship to it at
all. Confirmed on a second, independent 173-segment production project: the curr-side variant wrongly
exempted "They're the worst"'s own internal 0.38s breath, landing the boundary at 18.51s (the
pre-fix breath centre the override exists to prevent) instead of the correct 18.87s. Retroactive
audit found the same mechanism explains a spurious "fix" on the V6 project (segment 60 — see below).
The curr-side variant is **permanently disabled**: real call sites hardcode `-1` for the curr-side
call.

**Evidence — 447-segment V6 production project.** 8 real boundaries fixed: segments 34, 96, 162,
316, 338, 352, 405, 412. (A 9th, segment 60, was originally miscounted as a genuine fix by the
comparison harness's diff — retroactive audit found it was the curr-side false positive described
above, not a genuine seam fix; it only looked like an improvement because the corrupted boundary
happened to also land inside a detected silence.) An exhaustive scan of all 446 real pairs in the
project (both NEXT-side and CURR-side) found zero cases where the override fires and the NEXT-side
exemption does *not* correctly strip it — no real "fallback is correct" counter-example exists in
this dataset. Segment 405 was originally hypothesized as exactly such a counter-example; verification
against real V6 data found that premise wrong (segment 405 is one of the 8 genuine fixes).

**Ear-verified.** User resynced V6 with this fix in the tree, scrolled the full timeline, and
confirmed cuts now sit in pauses: **86.8% → 96.2% correct cuts**.

**What this did not fix.** The investigation that produced this fix also surfaced a separate, still-
open defect — word-shift, where a segment's cut point lands one or more words off from where the
sentence actually breaks. Two candidate fixes for it (FENCE, QUIET) were tried and both failed. This
remains open; see `docs/boundary-drift-investigation.md` for the full evidence, dead ends, and
tooling notes (this document does not repeat that content) and `project-state.md`'s Active Tasks for
current status.

---

<details>
<summary>Phase 7 Sync Audit — Read-Only Investigation (Archived, rescued from orphaned branch `phase-7-sync-audit`, commit `2fdbbc0`, source `docs/phase-7-sync-audit.md`) — dated 2026-06-01, pre-sync-rewrite architecture</summary>

**Provenance.** This audit was committed on a branch (`phase-7-sync-audit`) that was never merged
into `main` or any of its ancestors — unreachable from `main`, `webgl2-effects-engine`, or
`model-p-editor-work`, and never archived here. Found and rescued during the 2026-08-07 repository
consolidation (this file's own entry below, "Repository Consolidation"). The branch itself is
retained (not deleted) pending an owner decision on housekeeping; this entry preserves its substance
regardless of what happens to the branch.

**Verdict: obsolete, not actionable as written.** Every mechanism this audit traces describes an
architecture that has since been rebuilt end to end:

- **Sync entry point.** The audit traces a 3-step wizard (`runSyncStep1/2/3`) culminating in a
  `finalizeSync()` handler. That flow no longer exists — `handleApplySyncFromFiles` (the single
  "Apply Sync" entry point CLAUDE.md documents) replaced it during the WS1-WS6 sync rewrite
  (2026-07-24 to 2026-07-29, archived elsewhere in this file). `finalizeSync` survives only as an
  informal name in a few `App.tsx` code comments, not as a function.
- **Headings.** The audit's #1 CRITICAL finding — a `currentTime` snap-back loop caused by
  in-array heading segments (`currentSegment.heading && !currentSegment.text`) fighting the
  playback interval — is structurally impossible today. Headings became a separate top-level
  `HeadingOverlay[]` layer in Path B (2026-07-08, this file's own "Path B" archive), not
  segment-array entries; there is no `currentSegment.heading` field to snap back on.
- **Playback loop.** The audit's #2/#4/#6/#10 findings all concern a single `setInterval(100ms)`
  loop with `project.segments`/`currentSegment` in its dependency array and a duplicate
  `onTimeUpdate` write path. `usePlayback.ts` (CLAUDE.md's `hooks/` entry) now uses a ~16ms
  `requestAnimationFrame` loop when a voiceover is loaded, falling back to `setInterval(100ms)`
  only when there is none — a different mechanism than the one audited.
- **Duration allocation.** The audit's #3 (hardcoded 0.5s heading floor overrunning the voiceover)
  is moot — headings own no timeline seconds at all post-Path-B (`project-state.md` Key Invariant
  (c)). #8 (character-count vs. word-count duration weighting) is **not a bug** under the current
  design — CLAUDE.md's own top-level description confirms character-weight proportioning is the
  deliberate, current behavior, not a documentation mismatch.
- **Video/waveform rendering.** #5 (`getMediaDuration` per-call, no cache) and #7 (fire-and-forget
  preview seeks) describe the pre-WebCodecs `<video>`-element preview path, superseded by the
  WebCodecs preview migration (`useWebCodecsPreview.ts`, `videoDecoderPool.ts`, archived
  elsewhere in this file). #13 (waveform bars rendered via `Math.random()`, not real audio data)
  is superseded by the real peak-extraction system (`waveformPeaks.ts`/`waveformPipeline.ts`).

**The one finding worth carrying forward as a still-relevant class, not a specific bug: the
missing-asset reflow bug (§"Missing-Asset Bug — Root Cause").** The audit traced a real mechanism —
deleting an asset clears `assetId` silently (no reflow), but a subsequent re-sync's
`unusedAsset ?? matchingAssets[0]` fallback can then silently assign one remaining asset to two
segments, with no duplicate-assignment warning. The specific line numbers and call path
(`App.tsx:172`, pre-rewrite `parseProjectData`) no longer apply — that matching logic is now
`syncEngine.ts`'s `isFuzzyMatch`/`contiguousWordMatch`/`findAssetByContext`/`autoMatchSegments` — but
whether an equivalent silent-duplicate-assignment gap still exists in the current matcher has **not
been checked** by this rescue and is not asserted either way. If asset-matching work is ever
scheduled, worth a fresh, current-code check of this specific class (silent duplicate asset
assignment across segments, no log entry) rather than assuming either "still broken" or "already
fixed."

**Not carried forward, and not because it's wrong — because it's unverifiable against current code
without a fresh audit:** the export-path `asset_missing` guard bypass (#4, "guard fires only when
`assetId` is defined-but-missing") and the `Open Questions` section at the audit's own end. Both
concern surfaces (export pipeline, sync-log surfacing) that have been rewritten multiple times since
2026-06-01 (Tier 1/GL/Canvas export tiers, the WebCodecs export path, the `no-asset` sync-log entry
type) and re-deriving them against 2026-06-code would misattribute current behavior to a two-month-old
trace.

</details>

<details>
<summary>Repository Consolidation — branch-naming drift and the "Model P" correction (Archived, migrated from the deleted scratch note docs/_part2-findings.md) — 2026-08-07</summary>

Two findings surfaced while mapping branch topology during the 2026-08-07 repository consolidation
(reattaching a detached `HEAD`, retiring stale branches, fast-forwarding `main`).

**Finding 1 — `webgl2-effects-engine` stopped being about WebGL2 effects long ago.** The branch name
is stale. Its 47 commits beyond `8d83358` (tag `clean-baseline-2026-07-31`) are the sync-pipeline-
contract program — Phase 2/3/4 forced-alignment measurement, the boundary-quality checker, Contract
1→2 validators, the word-coverage validator, K14-K17 drag-cascade fixes — not WebGL2 effects work.
The actual WebGL2 effects engine work ended at `c522248` ("docs: v2 plan — stage contracts, stage
locking, Stage 1 observability, RU descope, adversarial audit"); everything after that on the branch
is sync-engine/timeline work that happened to land on this pre-existing branch rather than a new one.
Consequence: `main` was fast-forwarded onto `webgl2-effects-engine`'s tip (`6eae48e`) as part of this
consolidation (with owner approval) — as of 2026-08-07, `main` and `webgl2-effects-engine` are
identical, both carrying the sync-pipeline-contract-program work under a WebGL2-labeled branch name.
No rename was performed; flagging here so a future reader isn't misled by the name alone.

**Finding 2 — "Model P" was never a distinct 48-commit effort; it's one park commit.** A same-day
investigation (`docs/context-report-2026-08-07.md` §5) had characterized "Model P" as *"a large
follow-on effort... 48 commits... built on top of `HEAD` and then fully reverted"* — misleading. The
actual topology: `model-p-editor-work` (`210855d`) = `webgl2-effects-engine` (`6eae48e`) **plus
exactly one commit** — `210855d`, `"park: uncommitted Model P / editor working tree at revert
time"`, whose own message says it captures work *"on top of 6eae48e (K14/K15/K16/K17)"*, not on top
of some earlier, separate baseline. The 47 commits the earlier report attributed to "Model P" were
actually `webgl2-effects-engine`'s own sync-pipeline-contract-program commits (Finding 1 above), and
are on `main` regardless of what happens to `model-p-editor-work`. Full rationale for what the park
commit actually contains and why it references a revert to `18f5734`: `docs/decisions/2026-08-07-
model-p-revert.md`.

</details>

---

## The Sync-Pipeline-Contract Programme Through K17 and the Park Commit — Arc Summary (2026-06-01 to 2026-08-07)

A single narrative thread runs through 47 commits (`8d83358`..`6eae48e`, all on the branch
`webgl2-effects-engine`, whose name predates and no longer describes this work — see the
Repository Consolidation entry above) plus one further unreviewed commit
(`model-p-editor-work`'s `210855d`). This entry is the map; each stage's own full record is
linked rather than repeated.

**1. Sync-pipeline-contract programme (2026-08-01 to 2026-08-07), the bulk of the 47 commits.**
Started from the Pipeline Contract Program (`docs/sync-pipeline-contract-plan.md`, paused
pending this work) and the boundary-quality checker. Ran through: `docs/sync-redesign-audit-
report.md` and `docs/audit-verification-2026-08-03.md` (structural audits of the pre-existing
sync pipeline); the index-based seam-exemption fix for `isBreathSilence` (ear-verified 86.8%→
96.2% correct cuts, `docs/boundary-drift-investigation.md`); `docs/sync-pipeline-v2-plan.md`'s
acceptance as the live plan (Revision 2 same day — stage contracts, per-stage lock gates, the
Russian descope, adversarial audit); Phases 0/1/1b/2a/2b closing (DTW abandoned, measured
zero effect — Phase 3 becomes forced alignment); Phase 3's long forced-alignment measurement
arc (blockers closed, reference-validity and reference-correction passes, blinded human
listening batches on English and Spanish, the segment-320/321 cascade root-caused); Phase 3→4
handoff (Step M's golden-baseline replay harness); Phase 4 pre-implementation and gate-closing
passes (Steps Q-X — Spanish scored, heading-wildcard options laid out, structural checks
built); Phase 4 readiness close-out (`18f5734`, Steps Y-Z — Option A ruled for headings, the
replay harness restored after a fourth K8 `/tmp`-loss recurrence, a permanent tripwire added).
**Every commit through `18f5734` is measurement, design, or docs — zero `src/` changes**, by
explicit, repeated instruction. Full detail: `project-state.md`'s Current State field (the
dense, dated chain) and `docs/sync-pipeline-v2-plan.md` itself.

**2. K14-K17 — a separate, explicitly-labeled workstream (2026-08-07, `ad70019`..`6eae48e`).**
Real owner-reported bugs in the editor's lock/drag-cascade behavior, diagnosed and fixed with
measurement and tests, unrelated to the forced-alignment timing-source swap: K14 (lock
hard-wall semantics — fixed a stale-anchor propagation bug), K15 (bounded and localized the
drag cascade — one defect K14 introduced, one that predated it), K16 (three real pointer-math
faults, including a stale 24px constant from a padding redesign years earlier), K17 (fixed a
frozen-neighbour overlap in the live drag preview). Suite reached 1365 tests, green, at
`6eae48e`. Full detail: `project-state.md`'s Current State field and Active Tasks (Manual lock
semantics, K13, K14 entries).

**3. The `segments` invariant surfaces (2026-08-07, immediately after K16/K17).**
`docs/segments-invariant-ruling.md` found that K14's hard-wall and K15a's `restackWindow`
locality had silently adopted "Model S" (independent slots, gaps legal) while nine other
components — including both export paths — assume "Model P" (gapless partition) and cannot
represent a gap. Recommended Model P; flagged a real, sourced export-desync risk. A companion,
`docs/drag-path-testability-assessment.md`, recommended a scoped drag-session test harness
timed to land alongside the ruling's migration. Both AWAITING OWNER RULING as of this entry.

**4. The park commit (`210855d`, `model-p-editor-work`) — Model P implementation begins,
in flight, uncommitted-then-parked.** Owner rulings (numbered "task 2," "task 4" in code
comments, not otherwise persisted in this repo) authorized implementation: a gapless-partition
enforcer (`timelinePartition.ts`), a lock-fingerprint persistence rule closing the pre-existing
K13 bug (`projectFingerprint.ts`), a 50/50 silence-split rule (`snapBoundaries.ts`), and an
explicit export gapless-timeline guard (`exportPipeline.ts`, `exportPipelineWebCodecs.ts`) —
19 files, +3,160/−447 lines, on top of `6eae48e`. The commit's own message frames it as a
safety snapshot ahead of `src/` being reverted to `18f5734` (5 commits before K14) — a revert
that was never actually carried out anywhere in reachable history. Full investigation of what
that revert would have discarded and why it was queued: `docs/decisions/2026-08-07-model-p-
revert.md`.

**5. Repository consolidation, Parts 1-2 (2026-08-07, this same day).** Separately from the
above, the working tree was found detached at `8d83358` with untracked research data and 18
local branches, several stale. Reattached to `main`/`webgl2-effects-engine` (`6eae48e`,
identical after a clean fast-forward); pushed a durable safety net (5 tags + 1 recovery
branch); retired 13 branches (12 already fully merged, one — `phase-7-task-1-export-
profiling` — whose sole commit was already folded into this file); left `phase-7-sync-audit`
untouched pending an owner decision (its content is rescued into this file, above). Full
detail: this file's "Repository Consolidation" entry above.

**Net effect on `main` as of this entry:** `main` = `webgl2-effects-engine` = `6eae48e`,
carrying the full sync-pipeline-contract programme and K14-K17. `model-p-editor-work` sits one
unreviewed commit ahead, holding real, wanted work whose migration is not yet decided. Nothing
here required a `src/` change to record.

**`docs/context-report-2026-08-07.md` is SUPERSEDED.** It lives only on branch
`wip/preserve-2026-08-07` (never copied to `main`) and was written from a detached-HEAD
checkout at `8d83358` before this repository's real `docs/` set was visible, so its "Model P"
characterization (48 independent commits, no recorded rationale) is known-wrong — see this
file's own "Repository Consolidation" entry above. `docs/decisions/2026-08-07-model-p-revert.md`
supersedes its Model P conclusions.

<details>
<summary>Sync Pipeline — Structural Audit Report (Archived, migrated from the deleted docs/sync-redesign-audit-report.md, final source sha 53ff455) — read-only audit dated 2026-08-03, findings absorbed into docs/sync-pipeline-v2-plan.md</summary>

Read-only structural audit of the sync pipeline (`App.tsx`'s `handleApplySyncFromFiles`,
`useWhisper.ts`, `whisperService.ts`, `snapBoundaries.ts`, `syncEngine.ts`, `syncContracts.ts`,
`syncLog.ts`, `syncConstants.ts`, `silenceDetector.ts`, `boundaryQuality.ts`, `types.ts`) to
support the sync-pipeline redesign. No files were modified. **Confirmed absorbed into
`docs/sync-pipeline-v2-plan.md`** (spot-checked 2026-08-07: the pipeline's two-pass snap
duplication, the token-index-vs-timestamp distinction, and the console-only silent-fallback
inventory all appear in v2, the last as v2's Contract OUT required-additions table).

**Pipeline execution map.** Apply Sync is the single entry point (`handleApplySyncFromFiles`) —
no separate re-sync path; it branches internally on whether a cached Whisper transcript exists.
Full 15-step call graph (staging → `parseProjectData` → cache check → alignment branch →
gap-fill → coverage gate → `filterToCoveredSegments` → boundary re-snap
(`snapCoveredBoundaries`, the "middle-gap" fix) → `headExtendFirstSegment` → asset
re-matching → commit → post-hoc boundary-quality check) is preserved verbatim in the git
history of this file's source commit if ever needed again; the branch/fallback summary table
(9 rows: voiceover-duration-probe failure, 0-segments, 0-cached-tokens, coverage-gate trip,
`cachedTokensReady===false` fallback, per-segment `matched===false` drop, 0-tokens-after-filter
fallback to `retileCoveredSegments`, silence-detection failure fallback to token midpoints, no
surviving silence candidate fallback to plain midpoint, backwards-monotonic clamp, and the
`DEGENERATE_PAIR_INVERSION_THRESHOLD_SEC` 5.0s pair-skip) is the durable part and is unchanged
in the current pipeline as of this archival.

**Token INDEX vs. TIMESTAMP usage (§4) — the audit's clearest structural finding, now the
governing principle behind Part C's "four-line rule" in v2.** Token indices (Hirschberg
text-alignment output) are trusted over token timestamps (Whisper's own smeared output,
100-900ms of documented blur) for: `fillsTokenGapWithinSpan`'s gap test, `isBreathSilence`'s
index-based seam exemption, the rescue forward-ordering bound, and every `AlignResult`
downstream consumer reading spoken edges through `firstTokenIdx`/`lastTokenIdx` rather than
stored timestamps. Timestamps are still used for pure temporal-window arithmetic
(`computeBoundarySearchWindow`, `isBoundarySilenceCandidate`, the monotonic checks, the
degenerate-pair guard). The documented tension: the NEXT-side seam exemption is real,
verified evidence; the symmetric CURR-side variant was tried and permanently disabled
(confirmed false-positive on two independent production projects — see the "Index-Based Seam
Exemption" entry elsewhere in this file) because its only available anchor (two segments back)
has no temporal relationship to the tested silence — "not fixable by tuning."

**Console-only & silent-fallback inventory (§5) — the audit's most consequential finding,
absorbed into v2's Contract OUT "required additions" list.** Catalogued every fallback/clamp
NOT reaching the user-facing sync log: the degenerate-pair guard and monotonic-fallback
re-check in `snapBoundaries.ts` (DEV-console-only); `alignScenestoTranscript`'s own monotonic
check (no console.warn at all, no second-level re-check); `applyAnchorBasedTiming`'s
out-of-order anchor detection (warns on detection, but the actual backstop-clamp correction a
few lines later logs nothing); `headExtendFirstSegment` (fully silent by design); Branch B's
"unexpected fallback" detection; rescue recovery's per-pass diagnostic detail (DEV-console-only,
though the aggregate fact does reach the user via the `'rescue'` log entry); `useWhisper.ts`'s
empty-token-array and stale-alignment-discard warnings (console-only, never persisted);
`parseProjectData`'s duplicate/ambiguous tag-match and duplicate-assetId warnings (console-only,
"diagnostic only, no UI surfacing" per the code's own comment — this is the mechanism behind
the duplicate-asset-assignment class flagged in project-state.md's Active Tasks, rescued from
the separate `phase-7-sync-audit` audit); `resolveVideoNativeFps` failure; the DEV calibration
harness's own silence-detection failure; the opt-in Hirschberg/pass-timing instrumentation.
Six duration/value clamps catalogued as "silent floors worth flagging for a redesign" (§5.3):
`MIN_SEGMENT_DURATION` exists as two independent unsynchronized constants (0.1 in
`snapBoundaries.ts`, 0.3 in `App.tsx`, confirmed deliberate non-consolidation, not dead code);
a third bare-literal 0.1 floor in `distributeSegmentTimes`; `retileCoveredSegments`'s
degenerate-duration guard (keeps the segment's original duration on a bad recompute, zero
logging, not even DEV-gated); a 0.05s rescue-path minimum span floor; the backstop monotonic
clamp (corrects without logging).

Full appendix of files read is preserved in git history; no files were modified during the
audit itself.

</details>

<details>
<summary>Audit Verification Report — 2026-08-03 (Archived, migrated from the deleted docs/audit-verification-2026-08-03.md, final source sha 53ff455) — read-only verification against HEAD 8587cac, findings absorbed into docs/sync-pipeline-v2-plan.md</summary>

Independent, source-grounded verification pass re-deriving (not trusting) the structural
audit's claims directly from code, plus five specific claims the task brief attributed to an
unlocated "4-stage proposal" document (confirmed: no such document exists anywhere in this
repository, tracked or dangling — verified each claim against running code instead).

**`computeBoundarySearchWindow` narrow-gap expansion — CONFIRMED exactly.** `spokenGapWidth <
0.1` → fixed 1.0s radius; otherwise `max(0.5, gap/2 + 0.4)`. **Correction later made by v2
(2026-08-07): the real culprit for the FENCE clamp's failure is the `Math.max(0.5, …)` floor,
not the `<0.1s → 1.0s` branch** — a 0.5s minimum radius always reaches past at least one word
at normal speech rate; this report's own instinct was right, the mechanism was one line off.

**Every duration-floor site enumerated** (6 sites, cross-checked against the structural
audit's §5.3 — see that entry above; `syncConstants.ts` itself documents the two
`MIN_SEGMENT_DURATION` constants as a deliberate, accepted non-consolidation, not an oversight).

**If `alignScenestoTranscript`'s internal gap-fill were deleted — traced end to end, not
assumed.** For the one real call site that reaches it with non-empty segments
(`alignFromCache`), its output is **operationally redundant**: `snapCoveredBoundaries`
downstream recomputes every interior pair boundary from `tokens[align.lastTokenIdx]`/
`firstTokenIdx` index lookups, never from the gap-fill's own `t0`/`t1` — a grep for `.t0`/`.t1`
reads across `App.tsx`/`syncContracts.ts` returns zero hits. **Caveat: redundant ≠ dead** — 29
test call sites in `syncTiming.test.ts` directly exercise the gap-fill logic; deleting it
requires updating those tests even though it has no observable effect on Apply Sync's final
output.

**FENCE clamp mechanism — walked through with real numbers (V6 segment 96).** Tokens: "look"
288.750–289.090, "A" 289.200–289.260, "predator" 289.260–289.800. Real silence:
[289.380, 289.960]. A naive `[A.lastTokenIdx.endSec, B.firstTokenIdx.startSec]` clamp produces
[289.090, 289.200] — 0.11s wide, **zero overlap** with the real silence (`289.380 > 289.200`).
Widening by one token each side — `[288.750, 289.260]`, 0.51s — **still zero overlap**, by
0.12s, because the smear crosses not just the boundary token but the one after it ("predator").
**No fixed token-count clamp recovers this fix**; the current un-clamped ±0.5-1.0s radius is
precisely why it works where a token-adjacency clamp would not. This exact numeric case (later
independently reproduced via the Transcript Inspector against `docs/v6-smear-baseline.csv` row
807, confirmed byte-identical) became v2's canonical proof that FENCE fails structurally, not
by mistuning.

**FENCE/QUIET dead ends — no code trace anywhere, prose only.** Confirmed via `git log -S`,
`git fsck --dangling`, and a repo-wide grep: neither term appears in any `.ts`/`.tsx` file,
committed or dangling. The described mechanisms only ever existed as prose in
`docs/boundary-drift-investigation.md` (still on `main`, KEEP — see that doc directly for the
quoted failure descriptions).

**Determinism — the pipeline's own TypeScript is deterministic for identical inputs.**
`crypto.randomUUID()` (segment/asset ids) and `Date.now()` (log/metadata timestamps) are
cosmetic, feed no timing formula. `Map`/`Set` iteration order is NOT a nondeterminism risk in
JavaScript (spec-guaranteed insertion order, and every insertion here is fixed-loop-order
already). Floating-point accumulation in `parseProjectData`'s character-weight proportioning is
sequential/single-threaded, deterministic. **Two genuine, code-external wildcards flagged as
UNVERIFIED at the time:** whisper-cli's own run-to-run determinism (native binary, outside this
codebase's control), and Web Audio API `decodeAudioData` determinism (browser/WebView-
dependent). **Both were later independently confirmed PASS** by Phase 0/2a's own determinism
checks (byte-identical MD5s across repeated runs, base.en and turbo both) — see
`docs/sync-pipeline-v2-plan.md`'s Phase 0/2a entries.

**Test coverage of the 8 seam-exemption fixes — gap identified, not yet closed as of this
archival.** Only 6 of the 8 production V6 fixes (segments 34, 96, 162, 316, 338, 352, 405, 412)
have committed test fixtures with real timestamp data (`syncTiming.test.ts`); **segments 34 and
412 have zero test coverage of any kind** — no fixture, no assertion, only a bare comment
citation. No test drives the full Apply Sync pipeline for any of the 8. Not resolved by any
later work found in this repository as of 2026-08-07 — flagged here so it isn't lost.

</details>

<details>
<summary>Sync Pipeline Contract Plan — Working Document (Archived, migrated from the deleted docs/sync-pipeline-contract-plan.md, final source sha 124ad3d) — program paused 2026-08-03, superseded in sequencing by docs/sync-pipeline-v2-plan.md</summary>

A stage-contract hardening program for the pre-v2, 7-stage sync pipeline (six handoffs + one
input annex). **Paused 2026-08-03** when the boundary-drift investigation found and fixed a
real defect (`isBreathSilence`'s seam exemption, `c593f1d`) this program's own Pair 1 analysis
had not surfaced, and surfaced the still-open word-shift defect that took priority.
`docs/sync-pipeline-v2-plan.md` (accepted the same day) absorbed this program's sequencing and
contract/validator concepts into its own Part J and Phase 7 — **this document remained the sole
authority for its §2 assumption tables and risk register (R1-R14) until this archival**, since
v2 explicitly does not restate them.

**Why the program existed (§0) — five real incidents, none of them math bugs, all of them
contract violations across a stage handoff:**

| Incident | Producer did | Consumer assumed | Result |
|---|---|---|---|
| Middle-gap position offset (2026-07-25) | Emitted `-1` sentinel token indices for unmatched segments | `tokens[idx]?.endSec` resolves to a real spoken edge | 0.13s drift on covered segments adjacent to skipped ones |
| Token-stealing (2026-07-29, WS6) | Global Hirschberg consumed a neighbour's words as substitutions | Every segment's own words remain available to it | Wronged neighbour got zero true matches |
| False-positive rescue (2026-07-31) | Rescue claimed a token ~412s away | Rescue claims are temporally plausible | ~206s phantom first segment, real successor collapsed |
| Window-overlap regression (2026-07-31) | `isBoundarySilenceCandidate` rejected on a 0.3s timestamp tolerance | Whisper trailing-word blur stays under 0.3s | Genuine boundary silences rejected wholesale on a 173/174-segment project |
| Contiguity break (2026-07-31) | `snapCoveredBoundaries` wrote `next.startTime` while `curr.duration` was floored | `startTime[i] + duration[i] === startTime[i+1]` | Visible overlapping segment cards once Timeline went absolute-positioned |

All five are separately archived in full elsewhere in this file (window-overlap/contiguity:
"Window-Overlap Silence Regression Fix..." entry; token-stealing: WS6 record; middle-gap:
sync rewrite record) — listed here only as the program's own stated motivation.

**Pipeline map (§1).** Documented the "5/6 interleave" — the real execution order runs
boundary-snapping TWICE, on two different arrays with different sentinel guarantees
(`snapCoveredBoundaries` on the covered-only array, `alignScenestoTranscript`'s own ported
gap-fill on the full array including unmatched segments) — flagged as undocumented anywhere
outside this file at the time (now documented in `snapBoundaries.ts`'s own header, per CLAUDE.md).

**The Six Contracts + input annex (§2).** Built full assumption tables for all seven handoffs
(0→2 input annex through 6→7 presentation), each assumption marked verified/`UNVALIDATED`/
`USER-REPORTED`. Two rows worth preserving standalone: Contract 1→2's drop-set-unbiased-by-
position assumption (instrumented via `analyzeDropDistribution`, three threshold constants
stated as starting values, never calibrated against a real corrupted-stretch case); Contract
5→6's "a floored duration means the boundary was degenerate" assumption (`UNVALIDATED` and
silent — five floor sites, zero warnings, zero log entries — this is Risk R2 below).

**Risk Register (§5) — preserved VERBATIM below, all 14 entries, per the explicit preservation
requirement for this table.** "Confidence" means confidence in the *current behaviour being
correct*, not in the description's accuracy.

| ID | Pair | Risk | Evidence | Confidence | Detection today |
|---|---|---|---|---|---|
| **R1** | 1→2 | **INSTRUMENTED (was: token-drop clustering unknown).** `filterMalformedTokens` now records a `TokenDrop` per rejection (index/reason/raw values) and `analyzeDropDistribution` (`syncContracts.ts`) flags a WARNING when drops cluster inside one `DROP_CLUSTERING_WINDOW_SEC` window above `DROP_CLUSTERING_RATIO_THRESHOLD`. Re-run against the original 169/1973-drop production project: breakdown is 139 `empty-text` + 30 `inverted-or-zero-duration`, zero clustering violation fired (drops were not concentrated in one stretch on this project). The three constants are the task's stated starting values — **not yet calibrated** against a real corrupted-stretch case, since this project's own drops happened not to cluster. | `USER-REPORTED` count; drop-reason breakdown now captured directly; `analyzeDropDistribution`/`validateTokenOrdering` unit-tested in `syncContracts.test.ts` | **Low** (mechanism); **calibration unverified** | Distribution + reason breakdown, both logged |
| **R2** | 5→6 | **Floor clamps fire silently.** Five sites: `snapBoundaries.ts:699`, `:717`, `whisperService.ts:1612`, `syncEngine.ts:239`, `:246`. A clamped duration is the *symptom* of a degenerate boundary — the 2026-07-30 starvation cascade produced exactly this and was found only because a user saw a collapsed segment. No warning, no counter, no entry. | Verified by reading all five sites | **Low** | None |
| **R3** | 6→7 | **Presentation is freshly rebuilt with shallow mileage.** Absolute positioning, lane redesign, cross-lane boundary markers, and the border-as-overlay WebKit workaround all landed 2026-07-31. `Timeline.tsx` has **no test file**. Its correctness now depends on Key Invariant (f), which the fallback `retileCoveredSegments` path does not enforce. **Split for scheduling: test-debt half CLOSED (`7e6309f`); contract half (log-truthfulness / `retileCoveredSegments` contiguity write) remains open — deferred to Pair 6 as planned.** | Verified: `timelineLayout.ts`/`timelineLayout.test.ts`/`timeline.render.test.tsx` land in `7e6309f`; `retileCoveredSegments` (`App.tsx:836-849`) still has no contiguity write | **Low** | Visual only |
| **R4** | 5→6 | **Two `MIN_SEGMENT_DURATION` constants.** `0.1` in `snapBoundaries.ts:230`, `0.3` in `App.tsx:278`. Same name, different values, different purposes (pipeline floor vs. timeline slot width), no cross-reference. A future edit to one will look like it fixed both. | Verified by reading both | **Medium** (both are individually correct today) | None |
| **R5** | 1→2 | **Token ordering never asserted.** `fillsTokenGapWithinSpan` walks `j → j+1` assuming ascending time; `earliestClaimStartSec` exists precisely because list order ≠ time order elsewhere. Nothing checks that the filtered array is ascending. | Verified | **Medium** | None |
| **R6** | 3→4 | **Forward-ordering bound is vacuous when no later segment has a true global match.** `computeForwardBoundStartSec` returns `undefined` and every claim is accepted. A project ending in a long tail of zero-match segments has no bound on any of their rescues. | Verified at `whisperService.ts:905-911`; the legitimate last-segment case is tested, the tail case is not | **Medium** | None |
| **R7** | 4→5 | **The "same filtered array" coupling is convention-only.** `keptAlignments[i].firstTokenIdx` indexes `aligned.tokens`. Passing `project.transcriptTokens` instead produces wrong boundaries with no crash. One call site is correct today; nothing prevents a second. | Verified at `App.tsx:2524-2531` | **Medium** | None |
| **R8** | 4→5 | **Silence-array identity coupling.** `snapCoveredBoundaries` and the ported gap-fill both key a `Map` on `SilenceInterval` **object identity**. Any `.map()` copy upstream silently breaks contention assignment (every silence becomes its own key). | Verified at `snapBoundaries.ts:582-601` | **Medium** | None |
| **R9** | 5→6 | **Degenerate-pair skip and monotonic clamp are DEV-gated console warnings.** Both fire on exactly the corrupted-data shape that caused the 2026-07-31 phantom-segment incident. In a production build they are invisible. | Verified: `import.meta.env.DEV` guards at `snapBoundaries.ts:638` and `:684` | **Low** | None in production |
| **R10** | 3→4 | **Run-survival thresholds calibrated against two projects.** `RUN_SURVIVAL_*` were recalibrated once already after the first (ratio-scaled) formulation miscalibrated on a real 174-segment project. `syncConstants.ts` itself documents an accepted phantom-match risk on the new 1-3-word band. | Verified in `syncConstants.ts`'s own header | **Medium** | Skip entries show `longest run N` (good), but nothing aggregates across runs |
| **R11** | 1→2 | **RESOLVED WITH CORRECTIONS (was: staging-path failures never reach the log).** The fresh-transcription path (`useWhisper.ts`) now mints/reuses `jobId` as its `syncRunId` and appends summary-less silence/malformed-token/contract-violation entries via `appendSyncLogEntries` (`services/syncLog.ts`) on the live path. **Corrections to this row's original plan:** (1) the "Option A branch" mentioned as needing a fresh UUID was proven statically unreachable and was DELETED, not wired; (2) `SyncLogPanel.tsx` does **not** group entries by `syncRunId` — it renders a flat, reverse-chronological list; (3) the `syncLog.ts` extraction was a **prerequisite** this row's original plan didn't mention. | Verified at `useWhisper.ts`'s staging path and `services/syncLog.ts`; `SyncLogPanel.tsx` read end-to-end, confirmed no `syncRunId` reference | **Medium → Low** | Full log entries (severity + fix hint), same as the Apply Sync path |
| **R12** | 2→3 | **No cost bound on the `O(n·m)` DP.** `__ALIGN_INSTRUMENT__` exists but is dormant. A pathological scene doc has no guard and no warning; the UI shows the blocking `SyncLoadingOverlay` with no indication anything is wrong. | Verified | **Medium** | None |
| **R13** | 4→5 | **`kept` ordering unasserted in `snapCoveredBoundaries`.** `retileCoveredSegments` sorts defensively; `snapCoveredBoundaries` does not. Out-of-order input would make the monotonic check fire on every pair, silently collapsing the timeline to floors. | Verified | **Medium** | None (would present as R2) |
| **R14** | 6→7 | **Discarded stale alignments are silent no-ops.** `segmentSetStillValid` fails → `console.warn` + `return` (`useWhisper.ts:203`, `:304`). The user sees a sync that appears to have done nothing. | Verified | **Medium** | Console only |

**Cross-cutting (§5).** The full console-only failure inventory (9 sites logging to console but
not the sync log) and the fully-silent sites (the R2 floor clamps plus `App.tsx:846`'s
degenerate-retile duration keep, `App.tsx:453`'s fabricated no-voiceover duration, `App.tsx:478`'s
silent video-slowdown-to-fill-slot) is preserved above inline within R2/R4's own rows and this
paragraph; the inventory was frozen as of `8d83358` and explicitly declared "the work-down
list" for the (now-superseded) program.

**Liveness as of this archival (2026-08-07):** only R11 is resolved. **R1-R10 and R12-R14 (13
of 14) remain live, unaddressed technical debt** — none were touched by the K14-K17 lock/drag
workstream or the Model P/S ruling, which were unrelated. Not blocking, not scheduled; surfaced
in `project-state.md`'s Open Decisions index as a pointer to this entry rather than restated
there in full.

</details>

<details>
<summary>Phase 3/4 Blinded Listening Protocols — Steps C, H, Q (Archived, migrated from the deleted docs/phase3-step-c-listening-protocol.md [sha c77509d], docs/phase3-step-h-listening-protocol.md [sha 1f5de51], docs/phase4-step-q-listening-protocol.md [sha 040cc63]) — combined entry, all three batches scored</summary>

Three blinded listening batches, same core protocol each time: opaque clip naming, a
script-text-only manifest (no timing/error/pass-fail data, so a listen-through can't be biased
by which clips "should" be wrong), and a private answer key held outside the repo
(`.answer-keys/`, gitignored — see the K8 pattern documented in `docs/sync-pipeline-v2-plan.md`
and the "Research Artifact Directories" note in `project-state.md`). Listener instructions: for
each clip, report clip-relative timestamps to roughly a tenth of a second — where the
narrator's voice truly stops (last audible energy, not trailing breath/mouth noise) and where
the next word's speech genuinely begins (first audible articulation, not breath intake/lip-smack)
— plus "clear"/"uncertain," without reasoning about what the "correct" answer should be.

**Step C — 12 clips (`clip_01`-`clip_12`.wav), V6 project, 1.0s padding each side.** Two
timestamps per clip (stop/start). **Scored:** all 12 checked against the private answer key —
see `docs/sync-pipeline-v2-plan.md`'s Phase 3 "Step C" section for the C1-C5 results (FA closer
to human than `silencedetect` on all 7 scored failures, 6x-78x, median ~15x; breath mechanism
confirmed with direct evidence).

**Step H — 20 clips (`clip2_01`-`clip2_20`.wav), a SECOND, independent V6 batch, none
overlapping Step C's 12 (avoiding a circular confirmation).** 12 drawn from the worst-remaining
residuals under the Steps E+F corrected reference, 8 controls. Three timestamps per clip
(stop/breath-window/start) — this batch added the explicit breath-window report Step C didn't
ask for. Padding verified programmatically before export (all 20 exact to <5ms). **Scored via
Step J** (`docs/sync-pipeline-v2-plan.md`'s "Blinded-batch scoring pass, Steps I-L" section) —
excluding two heading-recitation-contaminated outliers (Step K's finding), FA's worst error
across the remaining 15 clips was 131.6ms, comfortably under the 250ms gate.

**Step Q — 10 clips (`clip3_01`-`clip3_10`.wav), the Spanish corpus project's first-ever
human-ear pass.** 7 from worst-scoring MMS-FA boundaries, 3 controls. Same three-timestamp
protocol, plus a Spanish-specific note that the judgement is purely acoustic (listener doesn't
need to understand the language) and to mark genuinely ambiguous onsets "uncertain" rather than
guess. **Pre-send integrity check (a direct fix motivated by Step H's own clip-11 mismatch,
which only a human ear had caught):** every clip's padding/duration verified programmatically,
and every clip transcribed with the production whisper-cli sidecar and matched against its
manifest text on three tests (first-word present, lead-in matches the previous segment's tail,
no foreign content) — **10/10 pass**, results in `docs/phase4-step-q-integrity-check.csv`. One
clip flagged in advance, without identifying it, as sitting at the corpus's very start (no left
context, the same edge condition that excluded Step C's clip 3 from scoring). **Scored via Step
U** (`docs/sync-pipeline-v2-plan.md`'s Phase 4 "Steps U-X" section) — against the Step F
breath-aware reference, the 22 Spanish pauses went from median 61.2ms/p95 282.1ms (FAIL) to
median 30.3ms/p95 50.4ms (PASS) against the approved 250ms gate, with one genuine remaining FA
error (clip3_06, -1084ms, a corpus-start unscripted-lead-in case) reported as one, not hidden.

**All three batches' manifests and CSV outputs remain in `docs/` / `docs/measurements/`** (not
folded — they're data, not documentation); only the three protocol documents themselves, whose
content is now fully executed and scored, were archived here.

</details>

<details>
<summary>The Model P Ruling — segments invariant decided (2026-08-07)</summary>

**Owner ruling, recorded 2026-08-07:** `project.segments` IS a gapless partition
("Model P") — `startTime[0] === 0` and `startTime[i] + duration[i] === startTime[i+1]`
for every adjacent pair, `startTime` a derived cache of the duration prefix-sum, never
independently authoritative. Model S (independently-positioned slots, gaps legal) is
rejected. This closes the question `docs/segments-invariant-ruling.md` posed the same
day (written at HEAD `0e2ac5b`/K16, originally only on the never-merged
`model-p-editor-work` branch, landed on `main` as part of the repository consolidation
just ahead of this ruling) — eleven components had answered the question differently,
with no decision ever recorded, and the answer had silently flipped five times across
K13-K16-adjacent work. Full ruling record: `docs/decisions/2026-08-07-model-p-ruling.md`.
Full original analysis, updated in place with the ruling stamped at the top:
`docs/segments-invariant-ruling.md`.

**The lock-shortfall rule (§4.1(a)) is confirmed as part of the same ruling:** an
ordinary (satisfiable) shortfall against a locked segment is absorbed by the adjacent
unlocked segment; an unsatisfiable shortfall (a locked segment on both sides of a gap)
refuses the second lock-toggle outright, with a clear conflict message, rather than
committing a gap. The alternative of letting an earlier lock's slot grow to meet a later
one was rejected (it reopens the pre-K14 growth exemption K14 withdrew on purpose); the
alternative of permitting a gap between two locks as a first-class exception was rejected
as Model S admitted through a side door.

**Consequences, same day:**
- `docs/drag-path-testability-assessment.md`'s Route 2 test-harness recommendation —
  previously conditioned on this exact ruling, since its central assertion needed to know
  which model to encode — is now unconditionally approved, sequenced alongside (not
  before) the P-migration's step 5, per that document's own sequencing argument.
- `project-state.md`'s Open Decisions section was rewritten from "AWAITING OWNER RULING"
  to a compliance backlog: a read-only code search the same day found the concrete places
  a gap can still form under current `main` — `syncEngine.ts`'s `applyAnchorBasedTiming`
  locked branch (Model-S hard-wall behaviour, K14's named rework target),
  `dragCascade.ts`'s `restackWindow` (correct once its upstream input is gapless, not
  itself broken), the absence of any dev-only gaplessness assertion anywhere in `src/`,
  and the absence of any gap guard in either export path (`exportPipeline.ts`,
  `webcodecsExport/exportPipelineWebCodecs.ts`) — the park commit's unmerged
  `checkTimelineIsGapless` is the only place that check has ever existed.
- The park commit's (`210855d`, `model-p-editor-work`) in-flight Model-P rework is
  confirmed as work in the *correct* direction by this ruling, but per
  `docs/decisions/2026-08-07-model-p-revert.md`'s existing recommendation, should be
  re-derived against current `main` (which now includes K17) rather than cherry-picked
  from a diff that predates it and was never reviewed.
- No `src/` change landed as part of this ruling — it is a decision record only.
  Implementation (K14's rework, the dev-only assertion, the export guard) remains open
  and tracked in `project-state.md`'s Active Tasks and Open Decisions.

</details>
