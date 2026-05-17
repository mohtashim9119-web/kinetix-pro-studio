# Kinetix Pro Studio — Project State

> **Purpose:** Living source of truth for project status. Updated at the end of every work session.
> Distinct from `CLAUDE.md` — that file covers architecture/conventions; this file tracks where we are.

---

## Meta

| Field | Value |
|---|---|
| Last updated | 2026-05-17 |
| Current phase | Phase 4 — Polish |
| Hosting target | Cloudflare Pages (frontend) · Render backend TBD |
| Target users | YouTube creators — initial internal use across 5–10 channels |
| Repo | TBD |

---

## Roadmap Phases

| Phase | Description | Status |
|---|---|---|
| Phase 0 | Audit & baseline | ✅ Complete |
| Phase 1 | Foundation refactor | ✅ Complete |
| Phase 2 | Persistence — localStorage + IndexedDB | ✅ Complete |
| Phase 3 | Export pipeline — ffmpeg.wasm in browser | ✅ Complete |
| Phase 4 | Polish — filters, transitions, Safari, error handling | ⬜ Not started |
| Phase 5 | Production hardening — tests, accessibility, responsive | ⬜ Not started |
| Phase 6 | Desktop app — Tauri wrap with native ffmpeg | ⬜ Not started |

---

## Current Sprint

Phase 3 complete. Next: Phase 4 (polish — filters, transitions, Safari, error handling).

Phase 3 steps:

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

---

## Decisions Log

| Date | Decision |
|---|---|
| 2026-05-16 | **Hosting:** Cloudflare Pages for frontend. Free tier, edge CDN, unlimited bandwidth. Render backend deferred to Phase 3. |
| 2026-05-16 | **Target users:** YouTube creators. Initial private use across 5–10 channels owned by user's team. |
| 2026-05-16 | **Export approach:** ffmpeg.wasm in browser for Phase 3. Slower than native (3-5×) but $0 infra, works offline, no server. Pipeline code will port to native ffmpeg in Phase 6 with minimal changes. |
| 2026-05-16 | **Long-term distribution:** Desktop app via Tauri (Phase 6). Web app remains the development target through Phases 3-5; desktop wrap converts the same codebase. Native ffmpeg replaces ffmpeg.wasm for full-speed renders. |
| 2026-05-16 | **Branch strategy:** `main` is the stable branch. Feature work goes on short-lived branches, merged via PR. |
| 2026-05-16 | **Output format:** MP4 required for YouTube upload. Current WebM output is unacceptable for production — this is a Phase 3 blocker. |
| 2026-05-17 | **ffmpeg.wasm encode speed:** ~25s wall-clock per 1s of 1080p output (≈1.35s per frame at 30fps). Acceptable for Phase 3 validation; production-grade speed requires Phase 6 native ffmpeg via Tauri. |

---

## Open Questions

- [ ] Multi-user support — team accounts in v1, or stay single-user through Phase 5?
- [x] Asset storage for persistence — **Resolved (Phase 2):** IndexedDB is sufficient for single-user browser-local persistence. R2/S3 will be revisited when multi-user/cloud-sync arrives (likely Phase 5 or later).
- [ ] Dangling segment references on asset delete — segments referencing a deleted asset are cleaned up on reload (hydration unsets `assetId`) but not at delete time. Decide in Phase 4 whether to clean up at delete time or keep the current eventually-consistent behavior. Affects export pipeline.
- [ ] Bundle splitting — main chunk is now **537 kB** (up from ~521 kB) due to `@ffmpeg/ffmpeg`. Candidates for lazy-loading: ffmpeg import, SegmentEditorPanel, StockSearchModal, SyncReviewModal. Deferred to Phase 4.
- [ ] Stock API key handling — keep client-side for internal use, or proxy immediately in Phase 4?
- [x] **Phase 3 end-to-end export verified — 2026-05-17.** Multi-segment + voiceover + FADE transition + main Export button + VLC playback confirmed H.264/AAC. Verified before `phase-3-export` merged to `main`.

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
| 2026-05-17 | **Phase 3 complete.** Branch `phase-3-export` pushed. `tsc --noEmit` 0 errors, `npm run build` clean (537 kB main bundle). Dev-button segment encode verified; full E2E export pending human smoke test before merge to `main`. |

---

## Quick Stats

| Metric | Value |
|---|---|
| `src/App.tsx` LOC | ~1,450 (was 3,167 — 54% reduction net of all phases) |
| localStorage key | `kinetix:project:v1` |
| IndexedDB store | `kinetix-assets` / `assets` (keyPath: `id`) |
| Total dependencies | 13 prod + 9 dev |
| Export codec | H.264 video + AAC audio, MP4 container |
| Export engine | ffmpeg.wasm 0.12.6 core via `@ffmpeg/ffmpeg@0.12.15` |
| Export speed (1080p/30fps) | ~25s wall-clock per 1s of output (≈1.35s/frame) |
| Main bundle size | 537 kB minified / 161 kB gzip (`@ffmpeg/ffmpeg` is the dominant dep) |
| Worker bundle size | 8.62 kB (`exportWorker.ts` compiled separately by Vite) |
| Critical bugs identified | 5 (stale closure in playback, `togglePlay` listener churn, dead branch in audio sync, `trimEnd` unimplemented, `storyMap` param unused) |
| Transition enum values unmapped | ~42 of 57 |
| Filter names with no style implementation | ~30 of 55 |
