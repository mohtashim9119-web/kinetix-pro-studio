# Kinetix Pro Studio — Project State

> **Purpose:** Living source of truth for project status. Updated at the end of every work session.
> Distinct from `CLAUDE.md` — that file covers architecture/conventions; this file tracks where we are.

---

## Current State

| Field | Value |
|---|---|
| Last updated | 2026-06-28 |
| Current HEAD | `4b13cb0` (Effects Steps 5–7) rebased onto `main`'s Windows dev-setup commits (`ce64de4`/`c7065af`); rebase in progress this session — local history diverged from `origin/main` and is being replayed on top, will push once complete. Billing block is resolved — pushes work; CI is now manual-only (`workflow_dispatch`, commit `e725a46`) so no metered usage. Architecture Shift complete (2026-06-24). Recent: live thumbnail 3b (`23c8227`), shared SegmentControls + drawer/preview/timeline sync (`4887d33`), Windows dev environment setup (`ce64de4`), Effects Tab Rebuild Steps 5–7 (`dd903b2`, `d0d8ca2`, `4b13cb0`) + drawer effect-pills (`d750ce3`). |
| App status | Shipping desktop app — Tauri DMG/installer, native ffmpeg sidecar export. No server, no web hosting. |
| Target users | YouTube creators — initial internal use across 5–10 channels |
| Repo | TBD |
| Restore tag | `sync-known-good-2026-06-20` → commit `bab79b0` ("chore: remove VO-DIAG/SYNC-DIAG debug logging") |

All foundational/export/desktop/sync work is shipped and stable, including the clean-slate re-sync Architecture Shift (closed 2026-06-24, commit `254ef1b`). Active work is feature tasks only — see Active Tasks (6 items, ranked).

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

<details>
<summary>Bottom drawer + shared controls — ✅ DONE 2026-06-27 (commit 4887d33)</summary>

- ✅ **Shared `SegmentControls` extraction** — the controls portion of `ReviewMappingRow` (both scene-card and heading-card layouts, the field/button/swatch style consts, `updateHC`, and the `.rm-slider`/`.rm-swatch` `<style>` block) is now `src/components/SegmentControls.tsx`. `ReviewMappingModal` renders thumbnail + `<SegmentControls/>` (modal appearance/behavior unchanged — pure move); the bottom drawer renders `<SegmentControls/>` only (no thumbnail, full width). Non-audio asset filtering lives once, inside `SegmentControls`. The drawer's old `<textarea>` overlay input became the shared single-line input, and its phantom shadow control (export never applied it) was dropped.
- ✅ **Bottom drawer centered at 50vw, viewport-anchored** — wrapper switched from `absolute bottom-0 left-0 right-0` to `fixed bottom-0` with `left: 50%`, `width: 50vw`; centering expressed through Framer Motion (`x: '-50%'` on all three keyframes) since motion owns the element transform. Drawer position is now independent of side-panel collapse state.
- ✅ **Mute toggle moved to drawer header** — sits to the left of the lock icon, scene-only (headings have no embedded audio); the old body mute row was removed so scene and heading drawers are the same height.
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

---

## Active Tasks

> Ranked by priority. Tasks within a group share a UI surface and should be built together.

1. **Effects tab rebuild — 3 clean boxes + cross-project presets.** A 3rd left-panel tab showing exactly three bordered boxes (clean minimal layout):
   - **Transitions** — fade in, fade out, camera shutter; applicable to a single segment or all segments.
   - **Effects** — zoom in, zoom out, adjustable speed; applicable to a single segment or the full video / all segments.
   - **Overlays** — dust particles, fire particles, spark, etc.; applicable to a single segment or all segments.
   - Below the three boxes: a "Save preset" button (saves all 3 settings under a custom name) + a dropdown of saved presets that apply instantly in future projects. Presets require cross-project persistence — storage decision pending (localStorage vs project store).

2. ~~**Bottom drawer redesign** — heading + scene cards rendered at equal height.~~ — ✅ DONE (`4887d33`). Shipped via shared `SegmentControls` + header-mute relocation (scene/heading drawers now equal height). See Completed Work.

3. **Version snapshots** — named restore points (Initial Sync / Current Progress / Manual), capped at 20, to roll back a project.
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

4. **Auto-captions** — auto-generate on-screen captions from the voiceover transcript. Reuses existing Whisper transcript token data (already runs for segment timing). Surfaces tokens as a timed text layer.

5. **Export rendering speedup** — move export onto OffscreenCanvas + Web Worker for faster render without freezing the UI. Investigation complete (2026-06-01, `docs/phase-7-task-1-export-profiling.md`): pipeline is I/O-bound (`canvas.toBlob` 47%, IPC writes 29%); `convertToBlob` off main thread projected 40–55% speedup (~120s → ~60–70s on macOS Intel). Implementation not started.

6. **Hard delete segment** — permanently remove a segment with a confirm dialog (lowest priority). Previous segment absorbs the deleted segment's duration. Clean-slate interaction: a hard-deleted segment will REAPPEAR on the next Apply Sync if its scene tag still exists in the scene doc (re-sync rebuilds from the doc). To delete permanently, user removes the tag from the scene doc.

### Review Mapping modal — feature-complete

The Review Mapping modal (task 7, shipped then delisted) is now **feature-complete**. Its final follow-up closed this session:

- ✅ **Live thumbnail in ReviewMappingModal** — DONE (3b, commit `23c8227`). Each per-segment thumbnail now renders a live overlay/heading text layer (font, weight, italic, size, color, bg, bg-None, x/y) scaled proportionally to the thumbnail box, updating in real time as the row is edited. Positioning/sizing math is mirrored locally in the modal — `PreviewStage`, `frameRenderer`, and `types.ts` are untouched. Heading italic is intentionally not rendered (it is unwired everywhere).

---

## Effects Tab Rebuild — Plan (Active Task 1)

The Effects tab already exists and works (global-only) in DropZonePanel.tsx.
This is a guided rebuild to a new fixed UI (from mockup.tsx, design-locked) made
fully functional in steps. UI layout/structure stays exactly as designed; only
the accent is re-tokened to the app branding orange (#e07c3a), reconciling the
existing #F27D26 / #ee8b3f variants.

KEY DECISIONS (locked):
- "Apply to selected" = TRUE MULTI-SELECT of segments (selectedSegmentId becomes
  a Set).
- Per-segment effect fields MUST survive both reload AND Apply Sync — requires
  patching parseProjectData to preserve them (fixes the isMuted-style clean-slate
  wipe).
- Dropdowns/randomize-pools/presets all read ONE shared option source; no entry
  is ever wired to a renderer case that does nothing (no phantom enums).
- Accent canonical = #e07c3a.
- Presets = COMBINED LOOK: capture one option from each of the 3 dropdowns
  (transition + animation + overlay) + custom name; up to 20; selecting restores
  the 3 dropdown values, then exposes Apply to selected / Apply to all. Does NOT
  capture overlay style/color (likely a new combined-preset store rather than
  bending the legacy single-category presetService).

OVERLAY BACKGROUND HANDLING (important):
- Stock overlays ship with a black/white/green background; it is NOT removed
  automatically.
- Asset-backed overlays MUST be sourced as BLACK-BACKGROUND screen-blend footage.
- REQUIRED FUNCTION: the renderer must remove the black background by compositing
  the overlay with a "screen" blend mode — ctx.globalCompositeOperation='screen'
  in export (frameRenderer) and mix-blend-mode:screen in preview (PreviewStage).
  Pure black becomes transparent; bright areas show through. Each asset overlay
  carries a blend-mode setting (default 'screen'; 'multiply' available for
  white-background assets).
- Green-screen / chroma-key removal is EXPLICITLY OUT OF SCOPE (per-pixel keying;
  dropped earlier). Do not source green-screen overlays.

EFFECT LISTS (final, feasibility-resolved):
Transitions (10, all buildable): Hard Cut, Cross Dissolve, Dip to Black,
  Dip to White, Wipe, Slide/Push, Glitch/RGB Split, Whip Pan, Zoom, Light Leak
  (Light Leak via procedural radial-gradient flash if no asset).
Clip Effects (10, all buildable): Color Correction/Grading, Zoom In, Zoom Out,
  Ken Burns, Speed Ramping (maps to playbackSpeed — interacts with sync auto-fit;
  handle carefully), Gaussian Blur, Pixelate/Mosaic, Duotone/Color Wash,
  Sepia/Vintage, Invert.
Overlays (10): PROCEDURAL-now (4): Letterbox, Vignette, CRT/Scanlines, Viewfinder.
  ASSET-BACKED-later (6, shown DISABLED until media uploaded; black-bg screen-blend
  only): Film Grain, Light Leaks, Film Damage, Atmospheric Particles,
  Weather (Rain/Fog/Snow), Fire/Embers.
Dropped as non-feasible in this engine: Match Cut, Morph Cut, Crop, Masking &
  Tracking, Warp Stabilizer, Chroma Key.

STEPS:
1. ✅ DONE (`3bbd926`) — Land UI — mount EffectsPanel (from mockup.tsx) in place
   of the inline Effects section in DropZonePanel.tsx; retoken accent to #e07c3a;
   all buttons no-op stubs; placeholder labels OK. tsc + vitest clean.
2. ✅ DONE (`3c0d3af`) — Real option arrays — replace placeholders with the final
   lists above as {label,value} from one shared source (`effectsOptions.ts`);
   asset-backed overlays marked disabled. No renderer work.
3. ✅ DONE (`330c79e`) — Multi-select model — convert selectedSegmentId (single)
   to a Set; wire multi-select in the segment list/timeline; feed count into
   panel "N selected".
4. ✅ DONE (`f2dd193`) — Per-segment persistence — patch parseProjectData to
   preserve effect fields (transition/animation/overlay/duration); verify
   round-trip through projectStore AND survival across Apply Sync.
5. ✅ DONE (`dd903b2`) — Apply to selected/all — replace stubs with real handlers
   writing to the selected Set or all segments via setProject(...map...).
6. ✅ DONE (`d0d8ca2`) — Randomize across segments — wire per-block randomize from
   checked pool across all segments; same persistence path.
7. ✅ DONE (`4b13cb0`) — Combined-look presets — new dedicated localStorage store
   (`src/services/lookPresetService.ts`, key `kinetix:lookPresets:v1`, cap 20):
   save = 3 dropdown values + name; select = restore dropdowns; apply reuses
   step-5 handlers. Legacy `presetService.ts` left untouched/unrelated — combined
   look got its own store rather than bending the single-category service.
   Bonus (same arc, commit `d750ce3`): read-only effect pills in the bottom
   drawer header surface the applied transition/animation/overlay per segment.
8. ⬜ NEXT — Renderer implementation (small batches, each in BOTH PreviewStage +
   frameRenderer before enabling its dropdown entry): transitions → clip effects
   → procedural overlays → (later) asset-backed overlays once media supplied.
   Asset overlays use screen-blend compositing to remove black backgrounds
   (see above). Only remaining step before Docs sync (Step 9).
9. ⬜ PENDING — Docs sync + cleanup.

SEQUENCING: Steps 1-2 fast/safe (UI+data) — done. Steps 3-4 structural backbone —
done. Steps 5-7 wire on top — done (this session). Step 8 largest/most
open-ended, partly gated on user-supplied black-bg overlay assets, is now the
only remaining implementation step. Each step = own commit with tsc + vitest +
manual test before proceeding.

---

## Rejected from Scope

- **Multi-window simultaneous projects** — 5–10 parallel webviews + renders would thrash the machine. Use tabs in one window or a render queue instead. Revisit only if single-window UX proves insufficient.

---

## Known Issues

- **Preview transition black flash on video boundaries** — when a transition ends on a video segment, the newly-mounted `<video>` element shows ~100-200ms of black before its first decoded frame paints. Attempted fix (canvas hold + canplay listener + failsafe timeout) did not engage reliably across multiple debugging rounds — root cause never isolated. Removed in favor of shipping the working blend without the hold. Future fix likely requires pre-mounting the next video element offscreen during the pre-roll window, or replacing the canvas blend entirely with a dual-video CSS opacity crossfade. Exports are unaffected — issue is preview-only.

- **Preview letterboxing in normal view** — carried forward from an earlier audit; low-priority cosmetic issue. (The original note never recorded more detail than this.)

- **Video preview jumps to near-start of current segment on resize drag release** — audio position is unaffected and exports are correct. Three fix approaches attempted (isResizing prop, isResizingRef, stable useCallback ref) — all blocked by the same root cause: `currentSegment` `useMemo` re-resolves with new `startTime`s in the same render that clears the resize guard. Deferred until a larger PreviewStage refactor makes a DOM-direct seek approach feasible.

- **Preview/export transition timing mismatch** — preview shows the transition in the last D seconds of segment A (window: `[boundary − D, boundary)`). Export places the transition in a trailing extension after A's nominal end (window: `[boundary, boundary + D)`) — the deliberate Path B design that preserves `Σ duration = voiceoverDuration`. The two windows are mirror images around the same boundary; neither is internally inconsistent, but they don't match each other. Root cause: `useTransitionPreview.ts` picks the pre-boundary window with no documented reason; export's post-boundary window is invariant-proven and intentional. Fix: shift preview window to match export. Deferred — tracked as a separate task.

- ~~**Orphaned IndexedDB blob on audio re-stage**~~ — ✅ **RESOLVED (`3b0593c`).** Re-staging audio writes a new IndexedDB blob via `putAsset` with no content dedup; the `oldIdx` splice in `handleApplySyncFromFiles` removed the asset from `project.assets` without calling `deleteAsset`, leaving an orphaned blob. Fixed by pairing the splice with `URL.revokeObjectURL` + fire-and-forget `deleteAsset(projectId, oldId)`, mirroring the existing `processMediaFile` pattern.

- ~~**Clipped search window when a new scene is inserted next to an "absorbed" boundary**~~ — ✅ **RESOLVED.** Originally attributed to `alignScenesToTranscriptAnchorAware` (`src/services/whisperService.ts`), which bounded a new/estimate segment's text-matching search window using its nearest surviving whisper-anchored neighbors' `anchorStart` values. If one of those neighbors' anchors was itself positioned by an *earlier* sync's gap-fill pass absorbing audio for content that had no bracket at the time, the resulting window could be narrower than the new segment's own word count — forcing `alignScenestoTranscript`'s sliding-window match to lock onto the wrong (preceding) words instead of the new segment's real content. Confirmed via real-scene-text repro during Step 4.5b investigation (2026-06-23): inserting a new `012_tape_deck` bracket between unchanged `011_cloth_seats` and `013_cd_adapter` — where `013`'s carried-forward anchor had pre-absorbed the (then-unbracketed) "tape deck" audio from the original sync — produced a 0.225s sliver on `011_cloth_seats` and misplaced `012`'s content. **Fixed in `8615639`** (clamped each boundary's gap-fill search window to its two neighboring segments' own spoken edges — the bug actually lived in the shared `alignScenestoTranscript` gap-fill logic, not anything unique to the anchor-aware path it was originally attributed to). The anchor-aware function this entry originally named was itself later deleted in clean-slate step 3c (2026-06-24, commits `5da64df`/`8523f39`).

---

## Deferred (Non-Blocking)

> Recorded debt that is intentionally NOT on the active backlog. Revisit when convenient — these don't block any current work.

- **Export caption styling gap — fontWeight/fontStyle/textShadow not applied for the main overlay caption.** `frameRenderer.ts` computes `fontWeight`, `fontStyle`, and `shadow` from `segment.overlayConfig` (lines 475–477) but never applies any of the three to the canvas context: the canvas font string at line 488 is hardcoded to `` `italic normal ${bodyPx}px "${fontFamily}"` `` — every exported caption renders italic + normal-weight regardless of the user's actual weight/italic settings — and `shadow` is read into a local var that's never used at all (dead code). Preview/export mismatch: `PreviewStage.tsx`'s `<p>` for the same caption correctly applies `fontWeight`/`fontStyle` dynamically via inline style, so the modal and live preview show the configured look while the exported MP4 won't match. Fix is small (wire weight/style into the canvas font string + call `applyTextShadow`), but export was not manually retested when last flagged. **Deferred — recorded, not active.**

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
| 2026-06-28 | Windows dev environment: vcvars64.bat must be sourced before every cargo invocation on this machine (MSVC toolchain at custom D:\VSBuildTools2026b path, not on bare PATH). Permanent fix: .cargo/config.toml sets the linker path; dev.bat at project root sources vcvars64.bat then runs npm run tauri:dev — double-click to launch. Vite watcher configured to ignore src-tauri/target/** (EBUSY race condition on Windows). git identity set repo-scoped only on the Windows machine. |
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
| 2026-06-26 | **Review Mapping popup (task 7):** new ReviewMappingModal at z-[150] with per-segment thumbnail, horizontal asset bar, stock search trigger (reuses existing StockSearchModal at z-[200] after bump), time range display. Mounted in App.tsx sibling to StockSearchModal. StockSearchModal z-index bumped from z-[100] to z-[200] to clear the new popup. *(The initial ship also had a mute toggle; it was removed in the `947082c` card-layout redesign and is not present in the current modal.)* |
| 2026-06-26 | **Review Mapping popup — post-ship polish (this session):** refinement of the already-delisted task 7 feature, not a new backlog item. Scene overlay x/y position wiring, lower-third default y=78, preview+export (`55aacc1`). Swatch/toggle/stock-split polish + overlay bg-color editor (`88169fd`). Overlay caption font-size wiring, bubble auto-width, bg-None option, removed auto-quotes (`603a268`). Square toggle, scene row reorder, scene X/Y sliders (`5bb778e`). Scene overlay + heading text edge-to-edge X/Y positioning + width fix in PreviewStage (`df52dc1`). Scene row consolidation — italic moved into formatting row, color+XY rows merged into one, shadow swatch removed, ban toggle relocated next to bg swatch, square toggle thumb sizing fixed (`1447813`). Review Mapping control converted from icon to a centered text button in the Segments tab header (`67c4547`). |
| 2026-06-27 | **Billing block resolved + CI made manual-only.** The push-blocking billing issue is fixed — `origin/main` now tracks local HEAD again. To prevent recurring metered usage, the build workflow was switched to manual-only (`workflow_dispatch`, commit `e725a46`); CI no longer runs on push. Live thumbnail 3b (`23c8227`) is the first feature pushed under the restored flow. |
| 2026-06-27 | **Shared SegmentControls + drawer/preview/timeline sync (commit `4887d33`).** Extracted the Review Mapping card's controls into a shared `SegmentControls` component reused by both the modal and the bottom drawer (modal unchanged — pure move; drawer is controls-only, no thumbnail). Bottom drawer recentered to a viewport-anchored 50vw block (motion-owned `x: '-50%'`), independent of side-panel state. Mute toggle relocated to the drawer header (scene-only); body mute row removed so scene/heading drawers match height. Left-panel segment click now seeks the time-driven preview to the segment and auto-scrolls the timeline to bring it into view. Closes backlog item 2 (bottom drawer redesign). |
| 2026-06-27 | **Effects Tab Rebuild Steps 5–7 + drawer effect-pills (commits `dd903b2`, `d0d8ca2`, `d750ce3`, `4b13cb0`).** Apply-to-selected/all and randomize now write real per-segment effect fields; combined-look presets (transition + animation + overlay slugs + 2 durations) persist globally via a new `src/services/lookPresetService.ts` (dedicated localStorage store, 20-cap, kept separate from the legacy single-category `presetService.ts`). Mid-session fix: preset ids are now preserved end-to-end through the service round-trip (the service no longer re-mints its own id), so the active "Restored" highlight survives a save. Bottom drawer header also gained a read-only effect-pills row. Step 8 (renderer implementation) is now the only remaining step in the Effects Tab Rebuild plan. All four commits are local-only — not yet pushed to `origin/main` (still at `1e249df`). |

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
| `src/App.tsx` LOC | 2,962 (was 2,838 prior to Effects Tab Rebuild Steps 5–7) |
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
