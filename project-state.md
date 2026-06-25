# Kinetix Pro Studio — Project State

> **Purpose:** Living source of truth for project status. Updated at the end of every work session.
> Distinct from `CLAUDE.md` — that file covers architecture/conventions; this file tracks where we are.

---

## Current State

| Field | Value |
|---|---|
| Last updated | 2026-06-25 |
| Current HEAD | `31c2573` on `main`, fully pushed to `origin/main`. Architecture Shift complete (2026-06-24). Post-shift fixes: heading-tag false-positive (`cf75695`), orphaned voiceover blob (`3b0593c`), docs sync (`31c2573`). |
| App status | Shipping desktop app — Tauri DMG/installer, native ffmpeg sidecar export. No server, no web hosting. |
| Target users | YouTube creators — initial internal use across 5–10 channels |
| Repo | TBD |
| Restore tag | `sync-known-good-2026-06-20` → commit `bab79b0` ("chore: remove VO-DIAG/SYNC-DIAG debug logging") |

All foundational/export/desktop/sync work is shipped and stable, including the clean-slate re-sync Architecture Shift (closed 2026-06-24, commit `254ef1b`). Active work is feature tasks only — see Active Tasks (9 items, ranked).

---

## Completed Work

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

---

## Active Tasks

> Ranked by priority. Tasks within a group share a UI surface and should be built together.

1. **Version snapshots** — named restore points (Initial Sync / Current Progress / Manual), capped at 20, to roll back a project.
   - Entry 1: Initial Sync — auto-saved immediately after Apply Sync completes, locked, undeletable
   - Entry 2: Current Progress — auto-updated continuously, single slot, reflects latest state
   - Entries 3+: Manual Snapshots — user clicks "Save Snapshot", named (default timestamp, renameable)
   - Storage: `kinetix:project:{id}:versions:v1` in localStorage, per-project scoped, survives reload
   - Cap: 20 manual snapshots, oldest auto-purges with toast
   - UI: square rounded-corner icon bottom-left of segments tab, opens popup listing versions newest-first
   - Each row shows: name/timestamp, restore, rename, delete — lock icon on Entry 1 hides delete
   - Restore confirmation: "Restore this version? Current state will be saved as 'Before restore — [timestamp]' first." (auto-safety snapshot)
   - On restore: Entry 2 immediately updates to match restored state, user continues from there
   - **OPEN DECISIONS (decide before building):**
     1. Asset restoration on snapshot restore — Design A (snapshot stores asset LIST only; restoring after deleting assets = missing/broken assets; lower disk use) vs Design B (deletes are snapshot-protected; asset blobs persist as long as any snapshot references them; higher disk use). DECISION PENDING.
     2. Scene-doc + state on restore is a FULL REWIND (not a merge). Current state auto-saved as "Before restore — [timestamp]" first.

2. **Auto-captions** — auto-generate on-screen captions from the voiceover transcript. Reuses existing Whisper transcript token data (already runs for segment timing). Surfaces tokens as a timed text layer.

3. **Export rendering speedup** — move export onto OffscreenCanvas + Web Worker for faster render without freezing the UI. Investigation complete (2026-06-01, `docs/phase-7-task-1-export-profiling.md`): pipeline is I/O-bound (`canvas.toBlob` 47%, IPC writes 29%); `convertToBlob` off main thread projected 40–55% speedup (~120s → ~60–70s on macOS Intel). Implementation not started.

4. **Hard delete segment** — permanently remove a segment with a confirm dialog. Previous segment absorbs the deleted segment's duration. Clean-slate interaction: a hard-deleted segment will REAPPEAR on the next Apply Sync if its scene tag still exists in the scene doc (re-sync rebuilds from the doc). To delete permanently, user removes the tag from the scene doc. Lowest priority.

5. **Move "global text layers" row** — move global text layers out of the Segments tab to the right panel (contents TBD). Segments tab stays segments-only.

**[EFFECT TAB REBUILD — 3 clean options + presets]**

6. **Transitions** — fade in, fade out, camera shutter; applicable to single segment or all segments.

7. **Effects** — zoom in, zoom out, adjustable speed; applicable to single segment or full video/all segments.

8. **Overlays** — dust particles, fire particles, spark, etc.; applicable to single segment or all segments.

9. **Effect-tab layout + presets** — 3rd left-panel tab shows only these three (tasks 6/7/8) as 3 bordered boxes (clean minimal layout). Below: "Save preset" button (saves all 3 settings under a custom name) + dropdown of saved presets that apply instantly in future projects. Presets require cross-project persistence — storage decision pending (localStorage vs project store).

---

## Rejected from Scope

- **Multi-window simultaneous projects** — 5–10 parallel webviews + renders would thrash the machine. Use tabs in one window or a render queue instead. Revisit only if single-window UX proves insufficient.

---

## Known Issues

- **Preview transition black flash on video boundaries** — when a transition ends on a video segment, the newly-mounted `<video>` element shows ~100-200ms of black before its first decoded frame paints. Attempted fix (canvas hold + canplay listener + failsafe timeout) did not engage reliably across multiple debugging rounds — root cause never isolated. Removed in favor of shipping the working blend without the hold. Future fix likely requires pre-mounting the next video element offscreen during the pre-roll window, or replacing the canvas blend entirely with a dual-video CSS opacity crossfade. Exports are unaffected — issue is preview-only.

- **Preview letterboxing in normal view** — carried forward from an earlier audit; low-priority cosmetic issue. (The original note never recorded more detail than this.)

- **Video preview jumps to near-start of current segment on resize drag release** — audio position is unaffected and exports are correct. Three fix approaches attempted (isResizing prop, isResizingRef, stable useCallback ref) — all blocked by the same root cause: `currentSegment` `useMemo` re-resolves with new `startTime`s in the same render that clears the resize guard. Deferred until a larger PreviewStage refactor makes a DOM-direct seek approach feasible.

- ~~**Orphaned IndexedDB blob on audio re-stage**~~ — ✅ **RESOLVED (`3b0593c`).** Re-staging audio writes a new IndexedDB blob via `putAsset` with no content dedup; the `oldIdx` splice in `handleApplySyncFromFiles` removed the asset from `project.assets` without calling `deleteAsset`, leaving an orphaned blob. Fixed by pairing the splice with `URL.revokeObjectURL` + fire-and-forget `deleteAsset(projectId, oldId)`, mirroring the existing `processMediaFile` pattern.

- ~~**Clipped search window when a new scene is inserted next to an "absorbed" boundary**~~ — ✅ **RESOLVED.** Originally attributed to `alignScenesToTranscriptAnchorAware` (`src/services/whisperService.ts`), which bounded a new/estimate segment's text-matching search window using its nearest surviving whisper-anchored neighbors' `anchorStart` values. If one of those neighbors' anchors was itself positioned by an *earlier* sync's gap-fill pass absorbing audio for content that had no bracket at the time, the resulting window could be narrower than the new segment's own word count — forcing `alignScenestoTranscript`'s sliding-window match to lock onto the wrong (preceding) words instead of the new segment's real content. Confirmed via real-scene-text repro during Step 4.5b investigation (2026-06-23): inserting a new `012_tape_deck` bracket between unchanged `011_cloth_seats` and `013_cd_adapter` — where `013`'s carried-forward anchor had pre-absorbed the (then-unbracketed) "tape deck" audio from the original sync — produced a 0.225s sliver on `011_cloth_seats` and misplaced `012`'s content. **Fixed in `8615639`** (clamped each boundary's gap-fill search window to its two neighboring segments' own spoken edges — the bug actually lived in the shared `alignScenestoTranscript` gap-fill logic, not anything unique to the anchor-aware path it was originally attributed to). The anchor-aware function this entry originally named was itself later deleted in clean-slate step 3c (2026-06-24, commits `5da64df`/`8523f39`).

---

## SaaS Readiness Tasks

> Items required before public launch or multi-user distribution. Not scheduled — tracked here so they aren't forgotten.

- **Backend proxy for API keys** — Pexels/Pixabay/Coverr keys currently in JS bundle (VITE_ prefix). Required before public launch.
- **Auth layer** — No authentication; open access. Required for multi-user.
- **LGPL ffmpeg swap** — Current sidecar is GPL (libx264). Swap for LGPL-only build (OpenH264 or commercial x264 license) before public distribution.
- **4K export validation** — 1080p verified on macOS + Windows. 4K UI option exists but untested. Validate before advertising 4K support.
- **playbackSpeed UI re-expose** — Logic preserved in App.tsx; UI dropdown removed during 2026-06-17 BottomDrawer redesign. Re-expose as compact dropdown if user testing shows it's needed.

---

## Key Invariants

Non-negotiables. Future work — especially the Architecture Shift active task — must not break these without a deliberate, documented decision.

- **(a) Sync timing is regression-locked.** `src/services/syncTiming.test.ts` (8 vitest tests, added in commit `05398f4` "lock sync timing pipeline with regression test") plus the `sync-known-good-2026-06-20` tag protect the sync/anchor timing pipeline. Tag message: *"Known-good single-click ms-correct sync. Baseline for per-slot re-sync work. Restore/bisect target if sync drifts."* Bisect or restore against this tag before reaching for a new fix if sync ever drifts again.
- **(b) Σ segment duration = voiceoverDuration.** Total segment duration must always equal the voiceover's duration. Transition overlaps cancel pairwise by construction (Path B cross-fade design, Decisions Log 2026-05-25), so this holds without special-casing `App.tsx`. This isn't theoretical: removing `splitAudio` in Heading Round 5 broke this invariant and cost 4 rounds of drift-bug fixes before headings were rebuilt as pure overlays.
- **(c) Headings are pure overlays** — no audio/duration splitting; insert/delete absorbs duration via a 50/50 split with neighbors (Heading Round 5). Fully array-only since Step 5 (5.1–5.4, done 2026-06-24, commits `b3a13e3`/`abcc75e`/`72c1fd3`/`6342c8d`/`2516a7c`): the segments array is the sole source of truth, never serialized to `sceneDetails` text — 5.3 stopped writing the `[HEADING:]` tag, 5.4 stopped `parseProjectData` reading it (recognize-and-skip: still a scene boundary, no segment). Dual storage is gone.
- **(d) Transcription cache validity is keyed by file identity, not asset id.** `getFileIdentity(file) = \`${file.name}|${file.size}|${file.lastModified}\`` (`src/services/syncEngine.ts:216`), cached as `Project.lastTranscribedFileIdentity` (`src/types.ts:215`). Necessary because every file-stage event mints a fresh `Asset` id even when the user re-picks the identical file — id/reference equality can't catch a re-stage, but name+size+lastModified can.
- **(e) `anchorSource` provenance only ever moves one direction.** `'whisper'` = precise audio alignment; `'estimate'` = character-weight approximation that Whisper can still realign later. An anchor may be demoted `whisper → estimate` but is never promoted back, regardless of text changes (enforced by `syncTiming.test.ts`).
  - *Post-3c follow-up note — closed 2026-06-24 (post-3d-2):* `anchorSource` is confirmed effectively write-only — no production code branches on `'whisper'` vs `'estimate'`. Still written by `parseProjectData`, `applyAnchorBasedTiming` PASS 1, `distributeSegmentTimes`, and `handleInsertHeading` (PASS 2, the other writer, was deleted in 3d-2). Now documented directly in the `anchorSource` doc-comment in `src/types.ts`; no further cleanup planned.

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
| 2026-06-26 | **Draggable headings (task 6):** heading rows drag to any position via Pointer Events + setPointerCapture (no new dependency). Duration give-back/steal factored into shared syncEngine helpers (stealDurationFromNeighbors / giveDurationToNeighbors). Post-drag recompute uses anchor-free recomputeStartTimes, not applyAnchorBasedTiming. Stale-anchor behavior on pre-existing projects (locked neighbor edge case) is consistent with clean-slate philosophy — fresh sync resolves it. |
| 2026-06-26 | **Review Mapping popup (task 7):** new ReviewMappingModal at z-[150] with per-segment thumbnail, horizontal asset bar, stock search trigger (reuses existing StockSearchModal at z-[200] after bump), mute toggle, time range display. Mounted in App.tsx sibling to StockSearchModal. StockSearchModal z-index bumped from z-[100] to z-[200] to clear the new popup. |

---

## Open Questions

- [ ] Multi-user support — team accounts in v1, or stay single-user through Phase 5?
- [x] Asset storage for persistence — **Resolved (Phase 2):** IndexedDB is sufficient for single-user browser-local persistence. R2/S3 will be revisited when multi-user/cloud-sync arrives (likely Phase 5 or later).
- [x] Dangling segment references on asset delete — **Resolved (Phase 4, Step 3):** cleaned up at delete time via `c7515e5`.
- [x] Bundle splitting — **Resolved (Phase 4, Step 5):** jszip, StockSearchModal, SyncReviewModal are now lazy-loaded. Main bundle: 542 kB → 433 kB.
- [x] Stock API key handling — kept client-side for internal use; backend proxy deferred (tracked in Long-running Deferred Items as "Backend proxy for API keys — required for public launch").
- [x] **Phase 3 end-to-end export verified — 2026-05-17.** Multi-segment + voiceover + FADE transition + main Export button + VLC playback confirmed H.264/AAC. Verified before `phase-3-export` merged to `main`.

---

## Quick Stats

| Metric | Value |
|---|---|
| `src/App.tsx` LOC | 2,777 |
| Project persistence | Per-project scoped: `kinetix:project:{id}:v1` + registry `kinetix:projects:v1` in localStorage (legacy single-project key `kinetix:project:v1` retained for one-time migration only) |
| IndexedDB | `kinetix-assets` DB v2, store `assets-v2`, compound keyPath `['projectId','id']` (legacy v1 store retained for migration) |
| Total dependencies | 6 prod + 12 dev |
| Export codec | H.264 video + AAC audio, MP4 container |
| Export engine | Native ffmpeg sidecar (evermeet.cx 8.1.1 static build, GPL) via Tauri `tauri-plugin-shell` |
| Export speed (1080p/30fps) | macOS Intel (x86_64): ~10× realtime (120s for 12s of output); Windows: ~6× realtime (6 min per 1 min of video, measured on brother's PC); macOS arm64: pending measurement |
| Frontend bundle size | 505.86 kB / 152.74 kB gzip main bundle (measured 2026-06-22; no wasm in bundle — ffmpeg is a sidecar binary) |
| Lazy chunks | StockSearchModal 8.79 kB · jszip 95.87 kB |
| ffmpeg sidecar binaries | 76 MB (x86_64-apple-darwin), 48 MB (aarch64-apple-darwin), 97 MB (x86_64-pc-windows-msvc) — all gitignored; see `src-tauri/binaries/README.md` |
| Transition enum values in UI | 10 (only implemented transitions shown) |
| Filter names in UI | 26 (only implemented filters shown) |
| AnimationType values rendered in export | 12 (all applied via `canvasAnimations.ts`) |
