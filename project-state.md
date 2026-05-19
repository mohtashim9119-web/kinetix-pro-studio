# Kinetix Pro Studio — Project State

> **Purpose:** Living source of truth for project status. Updated at the end of every work session.
> Distinct from `CLAUDE.md` — that file covers architecture/conventions; this file tracks where we are.

---

## Meta

| Field | Value |
|---|---|
| Last updated | 2026-05-17 |
| Current phase | Phase 5 — Production hardening |
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
| Phase 4 | Polish — filters, transitions, Safari, error handling | ✅ Complete |
| Phase 5 | Production hardening — tests, accessibility, responsive | ⬜ Not started |
| Phase 6 | Desktop app — Tauri wrap with native ffmpeg | ⬜ Not started |

---

## Current Sprint

Phase 4 complete. Next: Phase 5 (production hardening — tests, accessibility, responsive layout).

---

## Phase 4 Summary

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

### Smoke Test Results

| Test | Result | Notes |
|---|---|---|
| Test 1 — `crossOriginIsolated` | ✅ PASS | `true` in both Chrome and Safari; `SharedArrayBuffer` available; COOP/COEP headers correct |
| Test 2 — Console hygiene | ✅ PASS | ffmpeg stderr routed to `console.debug`; no spurious `console.error` from pipeline |
| Test 3 — Lazy modal loading | ✅ PASS | `StockSearchModal-*.js` loaded on demand; no lazy chunks in initial network request |
| Test 4 — Dangling asset cleanup | ⚠️ PARTIAL | `c7515e5` clears `assetId` correctly; `autoMatchAssets` re-assigns immediately (pre-existing bug, deferred to Phase 5) |
| Test 5 — `asset_missing` error path | ⚠️ NOT REACHED via reload | Hydration cleanup clears orphaned `assetId`s before export; `ExportError` infrastructure verified by code review; deeper trigger deferred |
| Test 6 — Fade transition | ⬜ PENDING | User execution pending |
| Safari validation | ✅ PASS | `crossOriginIsolated=true`, full export, MP4 plays in VLC with H.264/AAC |

---

## Previous Sprint

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
| 2026-05-17 | **Safari export verified:** `crossOriginIsolated=true`, `SharedArrayBuffer` available, COOP/COEP headers correct, export completes, MP4 plays in VLC with H.264 + AAC. No code changes required for Safari support. |
| 2026-05-17 | **Global transition fallback:** `segmentEncoder.ts` now falls back to `project.globalTransition` when a segment's own `transition` field is NONE. Per-segment overrides take precedence. "Apply to All" button in Settings still materializes the global value onto segments for per-segment overrides. UX revisit deferred to Phase 5. |

---

## Open Questions

- [ ] Multi-user support — team accounts in v1, or stay single-user through Phase 5?
- [x] Asset storage for persistence — **Resolved (Phase 2):** IndexedDB is sufficient for single-user browser-local persistence. R2/S3 will be revisited when multi-user/cloud-sync arrives (likely Phase 5 or later).
- [x] Dangling segment references on asset delete — **Resolved (Phase 4, Step 3):** cleaned up at delete time via `c7515e5`.
- [x] Bundle splitting — **Resolved (Phase 4, Step 5):** jszip, StockSearchModal, SyncReviewModal are now lazy-loaded. Main bundle: 542 kB → 433 kB.
- [ ] Stock API key handling — keep client-side for internal use, or proxy immediately in Phase 5?
- [x] **Phase 3 end-to-end export verified — 2026-05-17.** Multi-segment + voiceover + FADE transition + main Export button + VLC playback confirmed H.264/AAC. Verified before `phase-3-export` merged to `main`.

---

## Known Cosmetic Issues

- **Safari DevTools renders `console.debug` output in red**, making `[ffmpeg-worker]` log lines look alarming. Not a real error. The handler at `exportWorker.ts:35` correctly routes ffmpeg log output to `console.debug`. This is a Safari DevTools display quirk, not a code problem.

---

## Deferred to Phase 5

- **JSZip dynamic-import double-cast** — `as unknown as typeof import('jszip')` workaround for `export =` + ESM dynamic import. Replace with a proper ambient module declaration in `src/types/jszip.d.ts`.
- **Per-segment vs global transition UX** — now that `segmentEncoder.ts` falls back to `project.globalTransition`, the "Apply Transition to All Scenes" button is partly redundant. Consider removing it or repurposing it for per-segment *overrides* only.
- **`motion` library bundle weight** — ~264 kB unminified; not easily tree-shaken without switching APIs. Evaluate whether animation features justify the cost or trim to specific motion primitives.
- **4K export validation** — 1080p verified on Safari and Chrome. 4K path is untested.
- **Stock API rate-limit handling** — 429s silently return empty results. Add retry-with-backoff + user-visible feedback.
- **Real mid-export cancellation** — `cancelExport` in `useExport.ts` clears state but does not terminate the in-flight worker. Requires `worker.terminate()` + restart guard (`// TODO: Phase 5`).
- **Accessibility audit** — no ARIA labels, focus traps, or keyboard nav beyond spacebar. Required before public launch.
- **Responsive layout** — layout assumes ≥1280px width. Mobile/tablet breakpoints not addressed.
- **Backend proxy for API keys** — Pexels/Pixabay keys are visible in the JS bundle. Acceptable for internal use; required for public launch.
- ~~**`autoMatchAssets` re-assignment on delete**~~ — **Fixed Phase 5 step 1 (75be8dd).** Effect removed; `autoMatchSegments` called imperatively on upload only. Deletion path is clean.
- ~~**`asset_missing` ExportError path is defense-in-depth only**~~ — **Updated Phase 5 step 2 (folded into 75be8dd).** With `autoMatchAssets` effect gone, `asset_missing` is now reachable via normal user actions: delete an asset mid-session and export before reload. Comment added at `exportPipeline.ts:80` documenting the trigger path. Error modal already handles it correctly — no further action needed.

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
| 2026-05-17 | **Phase 4 commit `ea18635`:** Fix fade transition global fallback — `segmentEncoder.ts` now uses `project.globalTransition` when a segment's own `transition` field is NONE. Previously, users who set the global transition without clicking "Apply to All" got hard cuts. |

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
| Main bundle size | 433 kB minified / 132 kB gzip (down from 542 kB / 161 kB) |
| Worker bundle size | 8.62 kB (`exportWorker.ts` compiled separately by Vite) |
| Lazy chunks | StockSearchModal 5.3 kB · SyncReviewModal 10 kB · jszip 96 kB |
| Safari support | ✅ Verified — `crossOriginIsolated=true`, full export works |
| Critical bugs identified | 5 (stale closure in playback, `togglePlay` listener churn, dead branch in audio sync, `trimEnd` unimplemented, `storyMap` param unused) |
| Transition enum values in UI | 10 (pruned from 51 — only implemented transitions shown) |
| Filter names in UI | 27 (pruned from 57 — only implemented filters shown) |
