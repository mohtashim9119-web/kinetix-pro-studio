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
| 2026-05-17 | **Phase 4 commit `97821cd`:** Add Safari validation test procedure (`docs/phase-4-safari-test.md`). Safari E2E result: **PASS** — `crossOriginIsolated=true`, `SharedArrayBuffer` available, COOP/COEP headers correct, export completes, MP4 plays in VLC with H.264/AAC. |
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
| 2026-05-21 | **Fidelity Polish commit `136b1ac`:** Update CLAUDE.md — add `canvasAnimations.ts` and `useTransitionPreview.ts` to File Map; resolve Known Bugs (trimEnd) and Known Limitations (AnimationType canvas, overlay drag); add 9 rows to Current Refactor Status; create `docs/fidelity-polish-smoke-tests.md` with 14 test procedures. |
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
| Docs | CLAUDE.md status + Known Limitations updates; new docs/fidelity-polish-smoke-tests.md (14 procedures) | c6fcc64, 136b1ac |
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

---

## Historical Quick Stats (superseded)

> These lines were dropped from the current "Quick Stats" in `project-state.md` on 2026-06-22 because they're pure historical trivia (not current state) or fully duplicated by the sections above. Kept here so the numbers aren't lost.

| Metric | Value |
|---|---|
| Critical bugs (Phase 1 audit) | 5 identified, all resolved (stale closure in playback, `togglePlay` listener churn, dead branch in audio sync, `trimEnd` unimplemented, `storyMap` param unused) |
| Safari support (historical) | ✅ Verified Phase 4 — wasm path (now removed). Native sidecar path is macOS-only (DMG). |
