# Kinetix Pro Studio — Project State

> **Purpose:** Living source of truth for project status. Updated at the end of every work session.
> Distinct from `CLAUDE.md` — that file covers architecture/conventions; this file tracks where we are.

---

## Meta

| Field | Value |
|---|---|
| Last updated | 2026-06-01 |
| Current phase | Phase 7 — Active |
| Hosting target | Desktop app (Tauri DMG/installer) · no web hosting needed for export |
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
| Phase 5 | Production hardening — tests, accessibility (responsive deferred) | ✅ Complete (2026-05-19) |
| Fidelity Polish | Canvas animations, trimEnd, drag overlays, preview transitions, KEN_BURNS picker fix, Path B export cross-fade | ✅ Complete (2026-05-25) |
| Phase 6 | Desktop app — Tauri wrap with native ffmpeg | ✅ Complete (2026-05-27) |
| Phase 7 | Multi-project + bug fixes + features (10 tasks; see Phase 7 Scope below) | ⬜ Active |

---

## Current Sprint

Bundle 1 complete. Starting Bundle 2 (Task 8 + Task 9c) next.

---

## Phase 7 Scope

10 tasks in dependency order. Tasks 1–2 are prerequisites; tasks 3–4 are bug fixes; tasks 5–9 are features; task 10 is the export-rendering implementation.

### Prerequisites

1. **Export-rendering investigation** ⬜ — Read-only profiling pass. Instrument the export pipeline to measure per-frame time distribution (canvas render, `canvas.toBlob`, base64 encode, IPC write, ffmpeg exec). Output: data-backed recommendation on OffscreenCanvas vs WebCodecs vs Tauri Channel API. No code changes. Informs task 10.

2. **Persistence layer project-id scoping** ⬜ — Migrate `kinetix:project:v1` → `kinetix:projects:v1` registry + per-project keys. Scope IndexedDB assets store by project id. Pure refactor, no UX change. Prerequisite for task 5.

### Bug fixes

3. **Video plays when timeline paused** ✅ — Done (Bundle 1)

4. **Preview/audio sync drift** ✅ — Replace 100ms `setInterval` with `requestAnimationFrame` driven by `audioRef.current.currentTime` as master clock. Frame-accurate preview like CapCut/Premiere. Completed Batch C, commit `e961110`.

### Features

5. **Multi-project picker window** ⬜ — Project registry; picker UI on app open with create/select/duplicate/delete/rename. Single-window with tabs or sidebar (not multi-window — see Rejected). Depends on task 2.

6. **Per-project save location + post-export popup** ✅ — Done (Bundle 1)

7. **Merge inputs into one upload area** ✅ — Unified drop zone; auto-classify by file type. UX design pass first to decide fate of 3-step wizard. Completed as part of Task 9b-0 (commit `4ed6a04`).

8. **More stock footage APIs** ⬜ — Add Coverr, Mixkit, Videvo adapters alongside Pexels/Pixabay in `stockService.ts`. Keys remain client-side (internal use).

9. **Independent text layers + auto-captions + style presets** ⬜ — Three sub-tasks: (a) `project.textLayers[]` decoupled from segments; (b) auto-captions via bundled `whisper.cpp` sidecar (~80 MB `base.en` model); (c) style preset library in localStorage.
   - **9b-0 — UX foundation (drop zone + bottom drawer)** ✅ — Unified drop zone + mapping list (DropZonePanel), slide-up BottomDrawer, VideoSegment.locked with order-index re-sync preservation. SyncWizard and sidebar nav hidden (preserved). Commit `4ed6a04`, merged to main 2026-06-04.

### Export-rendering implementation

10. **Export-rendering implementation** ⬜ — Implement whichever approach task 1 recommended. Target >50% speedup on macOS and Windows. Done last because the feature work in tasks 5–9 changes daily UX more.

### Rejected from scope

- **Multi-window simultaneous projects** — 5–10 parallel webviews + renders would thrash the machine. Use tabs in one window or a render queue instead. Revisit only if single-window UX proves insufficient.

---

## Phase 5 Summary

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

---

## Fidelity Polish Summary

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

---

## Path B (Export Cross-Fade) — Complete

Path B landed in commit `261936f`. All four Test 6 gates verified manually:

- 6-A: no doubled content
- 6-B: no animation snap-back
- 6-C: audio sync preserved
- 6-D: true cross-fade aesthetic confirmed

**Key insight:** In/out transition overlaps cancel pairwise across the timeline, so `Σ encoded = Σ duration = voiceoverDuration` is preserved without any `App.tsx` changes. Only `segmentEncoder.ts` and `exportPipeline.ts` were modified. The pre-audit predicted App.tsx would need updating at four `startTime` accumulator sites — this was not required because the algebraic invariant held by construction.

---

## Phase 6 Summary

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
| 2026-05-27 | **Branch strategy update:** Continuing short-lived feature branches, but merging directly to `main` with `git merge --no-ff` rather than via PR (single-developer workflow). |

---

## Open Questions

- [ ] Multi-user support — team accounts in v1, or stay single-user through Phase 5?
- [x] Asset storage for persistence — **Resolved (Phase 2):** IndexedDB is sufficient for single-user browser-local persistence. R2/S3 will be revisited when multi-user/cloud-sync arrives (likely Phase 5 or later).
- [x] Dangling segment references on asset delete — **Resolved (Phase 4, Step 3):** cleaned up at delete time via `c7515e5`.
- [x] Bundle splitting — **Resolved (Phase 4, Step 5):** jszip, StockSearchModal, SyncReviewModal are now lazy-loaded. Main bundle: 542 kB → 433 kB.
- [x] Stock API key handling — kept client-side for internal use; backend proxy deferred (tracked in Long-running Deferred Items as "Backend proxy for API keys — required for public launch").
- [x] **Phase 3 end-to-end export verified — 2026-05-17.** Multi-segment + voiceover + FADE transition + main Export button + VLC playback confirmed H.264/AAC. Verified before `phase-3-export` merged to `main`.

---

## Known Cosmetic Issues

- **Preview transition black flash on video boundaries** — when a transition ends on a video segment, the newly-mounted `<video>` element shows ~100-200ms of black before its first decoded frame paints. Attempted fix (canvas hold + canplay listener + failsafe timeout) did not engage reliably across multiple debugging rounds — root cause never isolated. Removed in favor of shipping the working blend without the hold. Future fix likely requires pre-mounting the next video element offscreen during the pre-roll window, or replacing the canvas blend entirely with a dual-video CSS opacity crossfade. Exports are unaffected — issue is preview-only.

- **Preview letterboxing in normal view** — already noted previously. Carried forward.

- **Video preview jumps on resize drag release** — video preview jumps to near-start of current segment on resize drag release. Audio position is unaffected and exports are correct. Three approaches attempted (isResizing prop, isResizingRef, stable useCallback ref) — all blocked by the same root cause: currentSegment useMemo re-resolves with new startTimes in the same render that clears the resize guard. Deferred.

- **Mux "Failed to fetch" — Phase 5 Step 4 investigation (no repro, root cause identified):** The one observed failure (Phase 4 smoke test, heavily-mutated state) was traced to `exportPipeline.ts:198` — `fetchFile(voiceoverAsset.url)` where the blob URL had already been revoked. The pre-c7515e5 delete handler called `URL.revokeObjectURL(asset.url)` synchronously but did NOT clear `voiceoverId`, leaving the export pipeline holding a revoked URL. c7515e5 (Phase 4 Step 3) fixed the root cause by clearing `voiceoverId` on delete — the mux step now routes to the no-audio branch when `voiceoverId` is absent. Not reproducible with current code. No further action needed.

---

## Long-running Deferred Items

- **`usePlayback` hook extraction** — Playback interval + audio sync still inline in App.tsx. Pure refactor, no behavior change. Worth doing before adding more playback features.
- **Segment lock order-index matching** — if scenes are added/removed between re-syncs, locked segments may match wrong positions since matching is by order index which shifts. Acceptable for now; revisit when scene management UI is added.
- **SaaS-readiness cluster** — Three items that must ship together for public launch: backend API proxy for Pexels/Pixabay keys; auth layer; swap GPL ffmpeg sidecar (libx264) for LGPL-only build (OpenH264 or commercial x264 license). Do not pick off individually.
- **Phase 4 Test 5 deeper trigger validation** — `asset_missing` error path verified by code review; deeper trigger validation deferred. Low value.
- ~~**JSZip dynamic-import double-cast**~~ — **Fixed Phase 5 step 5.** Destructure `{ default: JSZip }`; `@types/jszip` removed.
- **Per-segment vs global transition UX** — now that `segmentEncoder.ts` falls back to `project.globalTransition`, the "Override all per-segment transitions" button is partly redundant. Consider removing it or repurposing it for per-segment *overrides* only.
- **`motion` library bundle weight** — ~264 kB unminified; not easily tree-shaken without switching APIs. Evaluate whether animation features justify the cost or trim to specific motion primitives.
- **4K export validation** — 1080p verified on Safari and Chrome. 4K path is untested.
- ~~**Stock API rate-limit handling**~~ — **Fixed Phase 5 step 7.** Exponential backoff retry (3 attempts); discriminated union StockSearchResult; distinct UI for rate_limited/error/ok.
- ~~**Real mid-export cancellation**~~ — **Fixed Phase 5 step 3.** `worker.terminate()` + generation counter in `useExport`.
- ~~**Accessibility audit**~~ — **Phase 5 step 8 complete.** ARIA labels, focus rings, aria-live, timeline slider keyboard nav, useFocusTrap on all 4 modals. Pass 2 (screen reader, responsive) deferred to Phase 6.
- ~~**`AnimationType` values not applied in canvas export**~~ — **Fixed Fidelity Polish Item 4.** `canvasAnimations.ts` applies all 12 AnimationType values via canvas ctx transforms in `frameRenderer.ts`; live preview uses `getAnimationWrapperProps` motion.div wrapper in `PreviewStage.tsx`.
- ~~**Extra overlays have no drag-to-position UI**~~ — **Fixed Fidelity Polish Item 2.** Pointer Events drag on extra overlays with hard-clamp `[halfW/2, 100-halfW/2]`; `updateExtraOverlayPosition` callback wires through to App.tsx immutable state update.
- **Responsive layout** — layout assumes ≥1280px width. Mobile/tablet breakpoints not addressed.
- **Backend proxy for API keys** — Pexels/Pixabay keys are visible in the JS bundle. Acceptable for internal use; required for public launch.
- **`getMediaDuration()` URL cache missing** — creates a new HTMLVideoElement per invocation with no cache; N segments sharing the same video asset trigger N separate `loadedmetadata` loads at sync time. Low impact for small projects. Fix when sync performance becomes a complaint.
- **`finalizeSync` redundant second-pass startTime accumulation** — re-accumulates startTimes already set correctly by `parseProjectData`. Dead code under normal conditions; may silently correct floating-point drift with 20+ segments. Remove or verify in a future cleanup pass.
- **Character-count vs word-count duration weights** — `parseProjectData` uses `s.text.length` (character count) for duration weights, not word count as documented in CLAUDE.md. Dense prose receives disproportionate time. Deferred to a future sync quality pass.
- **`audioRef.current.duration` synchronous read on upload** — read at button-click time with no await; if `loadedmetadata` has not fired, `audioDuration = 0` and `parseProjectData` silently falls back to `rawSegments.length × 5` seconds with no user feedback. Add a `loadedmetadata` await and a toast warning before public launch.
- **`currentSegment` gap behavior** — useMemo returns `null` during any timing gap between segments (e.g. after a trim-resize misaligns startTimes); preview shows "Sequence Standby" with no indicator that a gap exists. Low priority until trim-resize precision is improved.
- **Audio waveform bars use `Math.random()` heights** — Timeline waveform bars are decorative, not real waveform data, and re-randomize on every render. Replace with real waveform analysis or make heights stable (compute once on asset load). Deferred.
- **Video seek on resize drag release** — video preview jumps to near-start of current segment when resize drag releases; audio is unaffected, exports are correct. Three fix approaches attempted (isResizing prop, isResizingRef, stable useCallback ref) — all blocked by currentSegment useMemo re-resolving with new startTimes in the same render that clears the resize guard. Deferred until a larger PreviewStage refactor makes a DOM-direct seek approach feasible.
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

---

## Task 9b-2 — Background Transcription Pipeline + Progress Bar
Status: COMPLETE — merged to main

### What was built
- Rust: WhisperState<Mutex<Option<CommandChild>>>; streaming via Channel<WhisperEvent>;
  cancellation via whisper_cancel command; silent exit codes 130/143
- TypeScript: transcribeWithProgress(); AbortController cancellation pattern (same as useExport)
- TranscriptionBar: animated indigo progress strip; green done flash (3s); red error banner
- App.tsx: startTranscription() triggered on audio upload when isTauri()

### Upload/Sync flow (also stabilised in this task)
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

### Key files changed
- src-tauri/src/whisper.rs
- src-tauri/src/lib.rs
- src/types.ts
- src/services/whisperService.ts
- src/services/textUtils.ts
- src/hooks/useWhisper.ts
- src/components/TranscriptionBar.tsx
- src/components/DropZonePanel.tsx
- src/App.tsx

---

## Task 9b-3 — Wire Whisper Timestamps into Segment Timing
Status: COMPLETE — merged to main

### What was built
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

### Verified behaviors
- Re-sync with same audio: no transcription bar, cached tokens reused
- New audio: full Whisper run triggers correctly
- Locked segments: timing preserved across re-sync
- Scene edits with same audio: instant re-sync, correct timing

---

## Task 9b-4 — Accurate Whisper Alignment
Status: COMPLETE — merged to main

### What was built
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

### Verified behaviors
- Timestamps are speech-accurate (DTW), not character-count based
- Timeline is contiguous with no gaps between segments
- Locked segments preserve timing across re-sync
- Re-syncing images only does not wipe segments
- Assets cleared + reload: segments persist, re-attaching works
- Slot UX: immediate green ✓ after sync; single × click clears both
  staged and persisted; no two-step clear behavior

---

## Bundle 1 — Bug Fixes (Task 3 + Task 6)
Status: COMPLETE — merged to main

### Task 3 — Video plays when timeline paused
- isPlaying prop added to PreviewStage
- useEffect syncs video element play/pause to isPlaying
- autoPlay removed — playback fully explicit
- videoRef callback syncs on segment change

### Task 6 — Post-export save dialog + popup
- Save dialog now appears BEFORE rendering starts
- Cancel before render wastes nothing — no render triggered
- pick_save_path Rust command opens rfd dialog, returns path only
- save_bytes_to_disk now takes explicit path, no dialog
- lastExportPath persisted in Project state — dialog remembers last folder
- Bottom-right success toast: filename, Show in Finder, Dismiss, 10s auto-dismiss
- reveal_in_finder command: open -R on macOS, explorer /select on Windows

---

## Task 9b-5
Status: NO-OP — all originally planned items already delivered

- Apply Sync commits whisper timings: ✅ delivered in 9b-2/9b-3
- Hide SyncWizard: ✅ delivered in 9b-0 ({false && ...} preserved)
- Bracket-only scene format: deferred — old format still accepted and
  works correctly; no change needed since Whisper handles timing
  independently of description text

---

## Quick Stats

| Metric | Value |
|---|---|
| `src/App.tsx` LOC | 1,568 (was 3,167 — 50% reduction net of all phases; Fidelity Polish added ~150 LOC, Phase 6.4 trimmed worker references) |
| localStorage key | `kinetix:project:v1` |
| IndexedDB store | `kinetix-assets` / `assets` (keyPath: `id`) |
| Total dependencies | 6 prod + 11 dev (Phase 6.4 removed @ffmpeg/ffmpeg, @ffmpeg/util, comlink) |
| Export codec | H.264 video + AAC audio, MP4 container |
| Export engine | Native ffmpeg sidecar (evermeet.cx 8.1.1 static build, GPL) via Tauri `tauri-plugin-shell` |
| Export speed (1080p/30fps) | macOS Intel (x86_64): ~10× realtime (120s for 12s of output, post-6.3.1); Windows: ~6× realtime (6 min per 1 min of video, measured on brother's PC); macOS arm64: pending measurement |
| Frontend bundle size | 442.18 kB / 134.73 kB gzip (no wasm in bundle; ffmpeg is sidecar binary) |
| Lazy chunks | StockSearchModal 5.3 kB · SyncReviewModal 10 kB · jszip 96 kB |
| ffmpeg sidecar binaries | 76 MB (x86_64-apple-darwin), 48 MB (aarch64-apple-darwin), 97 MB (x86_64-pc-windows-msvc) — all gitignored; see `src-tauri/binaries/README.md` |
| Safari support | ✅ Verified Phase 4 — wasm path (now removed). Native sidecar path is macOS-only (DMG). |
| Critical bugs (Phase 1 audit) | 5 identified, all resolved (stale closure in playback, `togglePlay` listener churn, dead branch in audio sync, `trimEnd` unimplemented, `storyMap` param unused) |
| Transition enum values in UI | 10 (pruned from 51 — only implemented transitions shown) |
| Filter names in UI | 27 (pruned from 57 — only implemented filters shown) |
| AnimationType values rendered in export | 12 (was 0 — no-op until Fidelity Polish; all 12 now applied via canvasAnimations.ts) |
