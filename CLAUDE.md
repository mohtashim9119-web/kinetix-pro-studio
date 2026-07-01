# CLAUDE.md — Kinetix Pro Studio

> Persistent context for Claude Code sessions. Update "Current Refactor Status" as work progresses.

---

## What This App Does

Desktop video slideshow compositor (Tauri v2 wrapper around a React/Vite frontend). Workflow:
1. User provides a script (text), scene details (bracketed asset names like `[IMAGE: hero.jpg]`), and a voiceover audio file
2. Apply Sync (the single sync entry point) maps script → scenes → uploaded assets in one pass, proportioning segment durations to word count
3. User edits segments on a visual timeline (transitions, overlays, filters, animations)
4. Exports via native ffmpeg (Tauri sidecar) — full H.264/AAC MP4 with overlays, filters, and transitions rendered from canvas

**Export is desktop-only** (requires the Tauri app). No server. No AI calls. No ffmpeg.wasm — export runs fully native via the bundled ffmpeg sidecar.

---

## File Map

```
src/
  App.tsx            # ~2,962 lines — top-level state, orchestration, playback, export.
                     #   isResizingRef guards the timeline resize-drag gesture: set true
                     #   synchronously in onResizeStart (mousedown), cleared by a resizingId-keyed
                     #   effect (fires after PreviewStage's child effects in the same commit —
                     #   deterministic, not the old racy rAF clear). currentSegment is frozen on
                     #   this same ref during a drag (lastStableSegmentRef + a one-shot
                     #   resizeSettleTick recompute right after release), since PreviewStage reads
                     #   currentSegment directly in many places beyond the seek effect. handleUp
                     #   also arms a one-time, capture-phase window 'click' listener whenever the
                     #   drag actually moved the mouse — swallows the native ghost-click a
                     #   left-edge resize otherwise fires on a segment row (Timeline.tsx), whose
                     #   onClick calls onSeek(s.startTime) directly (D12 fix, commit be45b07).
  types.ts           # Shared interfaces: Project, VideoSegment, Asset, TextOverlay + enums
  constants.ts       # FONT_FAMILIES, FILTERS, TEXT_ANIMATIONS, TRANSITION_OPTIONS, ANIMATION_OPTIONS,
                     #   getFilterStyle, getMotionProps + dev-only console.assert guards
  effectsOptions.ts  # TRANSITIONS, ANIMATIONS, OVERLAYS option lists (shared source for EffectsPanel
                     #   dropdowns/randomize-pools — Effects Tab Rebuild Step 2) + NONE sentinels.
  services/
    assetStore.ts    # IndexedDB service: putAsset, getAsset, getAllAssets, deleteAsset, clearAllAssets
    projectStore.ts  # localStorage serializer: save/load/clear under key kinetix:project:v1
    stockService.ts  # Pexels + Pixabay REST search (both keys are client-side env vars)
    syncEngine.ts    # isFuzzyMatch(), findAssetByContext(), applyAnchorBasedTiming(),
                     #   computeHeadingAnchors()/reinsertHeadings() — carry headings forward
                     #   across re-sync from the segments array (Step 5).
                     #   parseProjectData() still in App.tsx. PASS 2 (character-weight anchor
                     #   backfill) deleted in 3d-2 — dead under clean-slate. PASS 3 now falls
                     #   back to a segment's own startTime for any missing anchor (3d-1).
    whisperService.ts # alignScenestoTranscript() sliding-window text matcher; applyHeadingTiming() —
                     #   gives heading segments (isHeading) fixed 1.0s, 50/50 neighbor absorption, lock-aware.
    silenceDetector.ts # detectSilences(audioUrl) — Web Audio API silence scan used by Whisper gap-fill;
                     #   overlap-based lookup, usedSilences set, monotonic boundary check.
    tauriFfmpeg.ts   # TauriFfmpeg class (FfmpegLike) — routes file I/O + exec through Tauri IPC.
                     #   bytesToBase64() helper (chunked 32 KB btoa — avoids stack overflow on large buffers).
                     #   isTauri() guard — checks for window.__TAURI_INTERNALS__.
    ffmpegBackend.ts # createTauriBackend() — creates TauriFfmpeg session, returns { ffmpeg, dispose }.
                     #   dispose() calls ffmpegDestroy to delete $TMPDIR/kinetix-export-<uuid>/ after export.
    frameRenderer.ts   # Pure canvas pipeline: renders one frame for any segment type with filters/overlays/transitions
                     #   Calls applySegmentAnimation (canvasAnimations.ts) for AnimationType canvas transforms.
                     #   Respects segment.trimEnd for video seek clamping.
    canvasAnimations.ts # Canvas 2D animation transforms keyed by AnimationType (Fidelity Polish Item 1).
                     #   applySegmentAnimation() — ctx.save/restore wrapper, easing helpers, dev-only assert guard.
    segmentEncoder.ts # Renders all frames → writes PNGs to ffmpeg FS → libx264 encode → MP4 Uint8Array.
                     #   Reads effectiveTransition = segment.transition || project.globalTransition (see Transition Handling below).
    exportPipeline.ts # Orchestrates full export: encode segments → concat → mux audio → final MP4 Blob.
                     #   Returns ExportResult (never throws). ExportErrorKind: ffmpeg_load|encode|concat|mux|asset_missing|unknown.
    lookPresetService.ts # Combined-look effect presets (Effects Tab Rebuild Step 7): localStorage
                     #   key kinetix:lookPresets:v1, global across projects, cap MAX_LOOK_PRESETS=20.
                     #   loadLookPresets/saveLookPreset/deleteLookPreset. saveLookPreset persists the
                     #   caller-supplied id as-is (no internal re-mint) so EffectsPanel's activeId stays
                     #   valid after the round-trip; same-id save is a no-op (returns the existing record,
                     #   no duplicate row). Deliberately separate from the legacy presetService.ts
                     #   (single-category StylePreset) — combined-look needs 3 slugs + 2 durations at once.
    uiStateStore.ts  # readUiState()/patchUiState() — centralized kinetix:ui:v1 read-merge-write;
                     #   single source for UI-state persistence (D6 fix).
  hooks/
    usePlayback.ts           # Playback loop: RAF (~16ms) when voiceover loaded, setInterval (100ms) no-voiceover path; audio sync, spacebar.
    usePersistProject.ts     # Debounced (500ms) project save; accepts enabled flag to gate hydration
    useExport.ts             # Export orchestration: Tauri-only (Phase 6.4+). Creates TauriFfmpeg session,
                             #   calls exportProject(), invokes save_bytes_to_disk IPC for native save dialog.
                             #   ExportSnapshot for retry; generation counter guards stale callbacks.
                             #   Re-exports ExportError so App.tsx doesn't import exportPipeline directly.
    useTransitionPreview.ts  # Pre-roll snapshot blend for preview transitions (Fidelity Polish Item 3).
                             #   Renders outgoing+incoming frames ~400ms before window; blends via applyTransitionBlend.
                             #   Takes isResizingRef; forces inTransitionWindow/needsPreRoll/isActive false while a
                             #   timeline resize-drag is in progress (plain per-render read, not an effect dep) —
                             #   otherwise a drag's transient segment-boundary geometry could sweep currentTime into
                             #   a bogus transition window and swap in the wrong segment's snapshot (D12, be45b07).
    useWhisper.ts            # Whisper transcription orchestration: transcribeWithProgress, alignments,
                             #   distributeSegmentTimes, applyHeadingTiming. Generation counter + AbortController
                             #   for cancellation.
  components/
    BottomDrawer.tsx   # Slide-up per-segment editor (8 controls): header w/ duration badge + lock + ×;
                     #   two-column Asset | OverlayText; collapsible Formatting panel; slip-trim visual
                     #   bar (fixed-width orange window slides over source). Heading input
                     #   shown only for [HEADING:] segments. Click-outside backdrop closes drawer.
                     #   Header also shows a read-only effect-pills row (icon+label per applied
                     #   transition/animation/overlay; off-states hidden) — Effects Tab Rebuild bonus.
    EffectsPanel.tsx   # Effects tab UI (transitions/animations/overlays dropdowns + Apply to
                     #   selected/all, randomize-from-checked-pool, combined-look presets section).
                     #   Mounted by DropZonePanel.tsx, which owns lookPresetService persistence —
                     #   EffectsPanel itself only takes initialPresets/onPresetsChange/onApply props.
    ErrorBoundary.tsx     # Class-based error boundary (getDerivedStateFromError); PanelFallback with dev stack trace.
    PreviewStage.tsx      # Video/image display + overlay rendering. Dual-slot video-swap seek
                     #   effect (~line 449, dep [currentSegment?.id]) skips reseeking while
                     #   isResizingRef.current is true — currentSegment can flip transiently
                     #   during a timeline resize-drag; guard prevents an unwanted reseek to the
                     #   wrong segment's start (D12 fix, commit be45b07).
    SegmentEditorPanel.tsx # Segment list + per-segment controls
    SettingsPanel.tsx     # Global aesthetics, export quality (resolution/fps), JSON import/export, "New Project" reset
    StockSearchModal.tsx  # Pexels/Pixabay search modal — lazy-loaded via React.lazy
    Timeline.tsx          # Scrollable track + playhead + zoom. Each segment row's onClick calls
                     #   onSeek(s.startTime) directly — this is the element the D12 ghost-click
                     #   fix (App.tsx handleUp) guards against: a left-edge resize-drag ends with
                     #   the cursor far from the (fixed-position) left handle, so the browser's
                     #   native click synthesized right after mouseup lands on this row's body
                     #   instead of the handle, firing an unwanted seek (fixed in be45b07).
  index.css          # Tailwind base + custom scrollbar
  main.tsx           # React entry point
index.html           # Title: "Kinetix Pro Studio"
vite.config.ts       # Vite config — plugins (react, tailwindcss) + path alias. COOP/COEP removed (Phase 6.4).
public/
  _headers           # Cloudflare Pages headers. COOP/COEP removed in Phase 6.4 (no longer needed without wasm).
src-tauri/
  Cargo.toml         # Rust deps: tauri 2.x, tauri-plugin-shell, tauri-plugin-log, rfd, base64, uuid
  tauri.conf.json    # productName, bundle.externalBin: ["binaries/ffmpeg"], devUrl, beforeDevCommand
  capabilities/
    default.json     # core:default + shell:allow-execute { name: "ffmpeg", sidecar: true }
  src/
    lib.rs           # Tauri Builder — registers tauri_plugin_shell, invoke_handler for all IPC commands
                     #   (12 total: 9 in ffmpeg.rs + 2 in whisper.rs + fetch_url_bytes here).
                     #   fetch_url_bytes: proxy for stock CDN CORS bypass (returns base64).
    ffmpeg.rs        # 9 Tauri commands: create_session, write_file (b64), read_file, delete_file,
                     #   exec (sidecar), destroy_session, pick_save_path, save_bytes_to_disk (rfd),
                     #   reveal_in_finder. Session-scoped temp dirs ($TMPDIR/kinetix-export-<uuid>/);
                     #   path traversal validation.
    whisper.rs       # 2 Tauri commands: whisper_transcribe (streams progress via Channel),
                     #   whisper_cancel. WhisperState holds the running child process for cancellation.
                     #   Sidecar: binaries/whisper; model files: models/*.
  binaries/
    README.md        # Re-provisioning instructions for the gitignored ffmpeg sidecar binaries.
    ffmpeg-x86_64-apple-darwin  # gitignored — evermeet.cx 8.1.1 (76 MB, Intel macOS).
    ffmpeg-aarch64-apple-darwin # gitignored — osxexperts.net 7.1.1 (48 MB, arm64 macOS).
    ffmpeg-x86_64-pc-windows-msvc.exe # gitignored — gyan.dev essentials (97 MB, Windows).
docs/
  phase-4-safari-test.md         # Safari validation procedure + decision matrix (result: PASS)
  fidelity-polish-smoke-tests.md # Fidelity Polish manual smoke test procedures (Items 1–5)
.env.example         # VITE_PEXELS_API_KEY, VITE_PIXABAY_API_KEY, VITE_COVERR_API_KEY
metadata.json        # Google AI Studio project metadata — not used by Vite
```

---

## Key State & Data Flow

```
project: Project {
  script          — raw voiceover script text
  sceneDetails    — bracketed scene tags (e.g. [IMAGE: foo.jpg]\nscript line)
  segments[]      — VideoSegment[], generated by parseProjectData(), drives timeline + preview
  assets[]        — Asset[], added via file upload or stock search (blob: URLs)
  voiceoverId     — ID of the audio asset used for sync
  globalTransition / globalAnimation / globalOverlayFilter / globalOverlayConfig
}
```

`parseProjectData()` is the core sync engine — parses sceneDetails, fuzzy-matches asset names, distributes voiceover duration proportionally by word count. `[HEADING:]` tags are recognized only as scene boundaries — recognize-and-skip, no segment materialized (Step 5, 5.4); headings live solely in the segments array. Still defined in `src/App.tsx` — only the fuzzy-matching and anchor-timing helpers (`isFuzzyMatch`, `findAssetByContext`, `applyAnchorBasedTiming`, the heading-anchor helpers) have been extracted to `src/services/syncEngine.ts`.

Playback uses a ~16ms requestAnimationFrame loop when a voiceover is loaded; `currentSegment` is derived from `currentTime` via `useMemo`.

Export: see **Export Pipeline** section below. MediaRecorder removed in Phase 3.

### Persistence Model

localStorage (key `kinetix:project:v1`, versioned for future migrations) holds the JSON project state with asset `url` and `file` fields stripped — blob URLs are ephemeral and cannot survive a reload. IndexedDB (`kinetix-assets` database, `assets` object store, keyPath `id`) holds the raw blobs keyed by asset id. On app load, the mount effect in `App.tsx` reads localStorage first; if a saved project exists, it fetches all blobs from IndexedDB, builds a `Map<id, StoredAsset>`, and reconstructs each asset's `url` via `URL.createObjectURL(blob)`. Assets whose id is in localStorage but whose blob is missing from IndexedDB are dropped with a `console.warn`, and any segment `assetId` or top-level `voiceoverId` referencing a dropped asset is set to `undefined` — the segment itself is preserved so the timeline is not disturbed. Any future code that **adds** an asset to `project.assets` MUST call `putAsset` before setting project state (if `putAsset` throws, do not add the asset — a phantom asset that vanishes on reload is worse than no asset). Any future code that **removes** an asset MUST call `deleteAsset` and `URL.revokeObjectURL` after the state update.

### Export Pipeline

**Desktop-only (Tauri app required).** No `crossOriginIsolated` requirement — ffmpeg.wasm removed in Phase 6.4. Export uses the native ffmpeg sidecar bundled in `src-tauri/binaries/` (gitignored; see `binaries/README.md` for re-provisioning on a fresh checkout).

Full chain, left to right:

```
App.tsx handleExport()  [via useExport hook]
  │
  └─ ffmpegBackend.ts  createTauriBackend()
        └─ TauriFfmpeg.create()  →  IPC: ffmpeg_create_session  →  $TMPDIR/kinetix-export-<uuid>/
              │
              └─ exportPipeline.ts  exportProject(project, tauriFfmpeg, options, onProgress)
                    │
                    ├── for each segment:
                    │     segmentEncoder.ts  encodeSegment(segment, asset, ffmpeg, globalConfig, opts)
                    │       ├─ for each frame: frameRenderer.ts  renderSegmentFrame(...)
                    │       │     ├─ draws background (color fill / image drawImage / video seeked drawImage)
                    │       │     ├─ applies CSS filter string via ctx.filter
                    │       │     ├─ draws text overlay + extra overlays
                    │       │     └─ if transition frame: applyTransitionBlend(ctx, blendParams, w, h)
                    │       │           └─ FADE/DISSOLVE: globalAlpha + drawImage
                    │       │           └─ SLIDE/SLIDE_UP: offset drawImage
                    │       │           └─ ZOOM: scale + globalAlpha
                    │       │           └─ BLUR: ctx.filter blur + globalAlpha
                    │       ├─ writes frame_00001.png … frame_NNNNN.png via IPC (base64-encoded)
                    │       │     IPC: ffmpeg_write_file  →  $TMPDIR/kinetix-export-<uuid>/frame_NNNNN.png
                    │       └─ IPC: ffmpeg_exec  →  sidecar ffmpeg  →  libx264 fast crf23 yuv420p → seg_N.mp4
                    │
                    ├── if >1 segment: ffmpeg concat demuxer → concat_video.mp4
                    │
                    ├── if voiceover: ffmpeg mux audio (AAC 192k -shortest) → export_final.mp4
                    │
                    └── IPC: ffmpeg_read_file → MP4 bytes → IPC: save_bytes_to_disk (rfd native save dialog)
                          + IPC: ffmpeg_destroy_session (cleanup $TMPDIR session dir)
```

**Key types:**
- `FfmpegLike` (in `segmentEncoder.ts`) — minimal interface: `writeFile`, `exec`, `readFile`, `deleteFile`. `TauriFfmpeg` satisfies this contract.
- `ExportResult = { ok: true; blob: Blob } | { ok: false; error: ExportError }` — `exportProject` never throws; all failures are typed.
- `ExportErrorKind`: `ffmpeg_load | encode | concat | mux | asset_missing | unknown`.
- `ExportStage` union: `loading_ffmpeg | encoding_segment | muxing | done` — drives the progress modal via `useExport`.
- `FrameGlobalConfig` — carries `overlayConfig`, `hideAllText`, `globalOverlayFilter` into the renderer.

**Performance (post Phase 6.3.1):** macOS Intel (x86_64): ~10× realtime (120s for 12s of 1080p/30fps output). Windows: ~6× realtime (6 min per 1 min of video). macOS arm64: pending measurement. 4K untested.

### Transition Handling

`project.globalTransition` is the project-level default. Each `VideoSegment` also carries a `transition` field (defaults to `TransitionType.NONE` when created by `parseProjectData`).

`segmentEncoder.ts` resolves the effective transition as:
```ts
const effectiveTransition =
  segment.transition && segment.transition !== TransitionType.NONE
    ? segment.transition
    : (options.globalTransition ?? TransitionType.NONE);
```
`exportPipeline.ts` passes `project.globalTransition` as `options.globalTransition`. This means a user can set the global transition in Settings and get it applied without clicking "Override all per-segment transitions" — but per-segment overrides always take precedence. The "Override all per-segment transitions" button materializes the global value onto each segment's own field (useful for subsequent per-segment divergence).

### Anchor-Based Segment Timing

Each VideoSegment carries two anchor fields that drive re-sync behavior:

- `anchorStart?: number` — audio timestamp (seconds) where this segment's
  spoken content begins. Internal; not shown in UI.
- `anchorSource?: 'whisper' | 'estimate'` — provenance label. 'whisper'
  means precise audio alignment; 'estimate' means character-weight
  approximation.

Under clean-slate re-sync, anchors are never restored from previous
segments — the stableKey merge loop that used to do this (matching by
assetId or heading text) was deleted in step 3a (commit 452e1eb); every
anchor is re-derived fresh each sync from parseProjectData's character-weight
estimates. applyAnchorBasedTiming then recomputes startTime/duration from anchors:
each surviving segment occupies [its anchor, next anchor], and the last
segment extends to audioDuration. Locked segments preserve their durations
EXCEPT when a removal gap opens immediately after — they expand to absorb
the freed time (one-directional lock exemption). If anchorStart is missing
(e.g. a pre-6/18 persisted project), this pass falls back to the segment's
own startTime instead of 0 — a missing anchor can no longer collapse a
segment to the timeline origin (3d-1).

Whisper re-sync now always runs `alignScenestoTranscript` unconditionally.
The Whisper skip-guard and the anchor-aware aligner described in earlier
revisions of this doc were deleted in clean-slate step 3c (commits
5da64df, 8523f39) — under clean-slate nothing is carried forward, so no
segment can ever reach Whisper alignment already tagged anchorSource='whisper'.

Heading segments (isHeading) participate in the same anchor system.
handleInsertHeading auto-names each heading uniquely ("Heading 1",
"Heading 2"...). The × delete button (handleDeleteHeading) reverses
insertion atomically: returns the absorbed duration to both neighbors
(50/50 split) and restores next.anchorStart to prev.anchorStart +
prev.duration — the position next would occupy had the heading never
existed.

Headings are array-only since Step 5 (done 2026-06-24): the segments
array is the sole source of truth, never serialized into sceneDetails
text. On re-sync, computeHeadingAnchors (syncEngine.ts) captures each
heading's position relative to its content neighbors from the previous
segments array, and reinsertHeadings places it onto the freshly re-synced
content with the same 50/50 neighbor-absorption math. The [HEADING:]
scene-text tag is no longer written (5.3) or read (5.4) —
parseProjectData recognize-and-skips it as a scene boundary only.

---

## Conventions — Adopt Going Forward

### TypeScript
- `strict: true` in tsconfig (add when touching tsconfig)
- No `any` — use proper types or `unknown` + type guards
- All API responses typed (see `stockService.ts` as a pattern to fix)
- Prefer explicit return types on functions

### IDs
- Use `crypto.randomUUID()` — never `Math.random().toString(36).substr(2,9)` (`substr` is deprecated)

### State Updates — Immutable Only
```ts
// ✅ DO
setProject(prev => ({
  ...prev,
  segments: prev.segments.map((s, i) =>
    i === idx ? { ...s, duration: val } : s
  )
}));

// ❌ DO NOT
const newSegs = [...project.segments];
newSegs[idx].duration = val;   // direct mutation before setState
setProject(p => ({ ...p, segments: newSegs }));
```

### Component Decomposition (Target Structure)
Break `App.tsx` into this hierarchy as features are touched:
```
App.tsx                    — top-level state + orchestration only
  components/
    SyncWizard.tsx         — 3-step sync header buttons + validation
    LeftPanel/
      ScriptTab.tsx
      AssetsTab.tsx
      EditorTab.tsx        — segment list + per-segment controls
      SettingsTab.tsx
    PreviewStage.tsx       — video/image display + overlay rendering
    Timeline.tsx           — scrollable track + playhead + zoom
    SegmentEditorModal.tsx — full-edit modal (editingSegment state)
    StockSearchModal.tsx
    SyncReviewModal.tsx
  services/
    syncEngine.ts          — parseProjectData(), isFuzzyMatch(), findAssetByContext()
    stockService.ts        — already extracted ✓
  hooks/
    usePlayback.ts         — playback interval, audio sync, spacebar
    useExport.ts           — export orchestration (currently inline in App.tsx handleExport)
```
**Do not add features to App.tsx as a monolith — extract first, then add.**

### Export Format
- Output is MP4 (H.264 + AAC). Name the download `{name}_{timestamp}.mp4`
- The canvas render pipeline in `frameRenderer.ts` captures overlays and filters — exports are full-fidelity relative to what the renderer implements
- Export quality settings (resolution, fps) live in `App.tsx` state (`exportResolution`, `exportFps`) and are surfaced in SettingsPanel

### Environment Variables
- Client-safe (Pexels, Pixabay): `VITE_` prefix, `import.meta.env`
- Secret (any future AI/backend key): must go through a backend proxy — never `define` in vite.config

---

## DO NOT DO List

| Rule | Reason |
|---|---|
| `newSegs[idx].prop = val` before setState | Direct mutation — React may not re-render correctly, causes subtle bugs |
| `Math.random().toString(36).substr(2,9)` for IDs | `substr` deprecated; collisions possible in bulk imports |
| `any` type | Defeats type safety; use proper types or `unknown` |
| Label export file `.webm` | Container is now real MP4 (H.264/AAC) — use `.mp4` |
| Add features to App.tsx without extracting a component first | Makes the monolith worse |
| Put secret API keys in `vite.config.ts` `define` | Baked into client bundle, publicly visible |
| Add an asset to `project.assets` without calling `putAsset` first | Blob URL dies with the tab — asset vanishes on reload |
| `useEffect` with missing dependencies | Causes stale closures — use `useCallback` + correct dep arrays |
| Recreating functions inside render without `useCallback` | Causes spurious effect re-runs (see `togglePlay` keyboard listener bug) |
| Filters in the `FILTERS` array without a `getFilterStyle` case | Shows in dropdown, applies nothing — either implement or remove |
| Segment IDs that aren't globally unique | Timeline and React keys break on collision |

---

> Bug & task tracking lives in project-state.md (single source of truth). This file is architecture, conventions, invariants, and refactor history only.

---

## Dependencies to Remove

All dead dependencies removed. No remaining items.

---

## Environment Variables

| Variable | Used In | Required? |
|---|---|---|
| `VITE_PEXELS_API_KEY` | `src/services/stockService.ts` | Optional — stock search silently disabled if missing |
| `VITE_PIXABAY_API_KEY` | `src/services/stockService.ts` | Optional — stock search silently disabled if missing |
| `VITE_COVERR_API_KEY` | `src/services/stockService.ts` | Optional — Coverr video search silently skipped if missing |
| ~~`GEMINI_API_KEY`~~ | Removed in Phase 1 — `define` block stripped from `vite.config.ts` | — |

---

## Current Refactor Status

> Update this section as work progresses. Date each entry.

| Area | Status | Notes |
|---|---|---|
| Initial audit | ✅ Done — 2026-05-16 | See audit report in conversation history |
| CLAUDE.md created | ✅ Done — 2026-05-16 | This file |
| `strict: true` in tsconfig | ✅ Done — 2026-05-16 | noUncheckedIndexedAccess, noImplicitOverride, noFallthroughCasesInSwitch also enabled |
| Remove dead dependencies | ✅ Done — 2026-05-16 | Removed @google/genai, express, dotenv, tsx, @types/express |
| Fix `index.html` title | ✅ Done — 2026-05-16 | Now "Kinetix Pro Studio" |
| Strip AI Studio artifacts from vite.config | ✅ Done — 2026-05-16 | Removed GEMINI_API_KEY define, DISABLE_HMR, loadEnv |
| Extract `syncEngine.ts` | ✅ Done — 2026-05-16 | isFuzzyMatch, findAssetByContext |
| Extract `constants.ts` | ✅ Done — 2026-05-16 | FONT_FAMILIES, FILTERS, TEXT_ANIMATIONS, getFilterStyle, getMotionProps |
| Extract `usePlayback.ts` hook | ✅ Done | RAF loop (~16ms) when voiceover loaded, setInterval (100ms) no-voiceover path; audio sync, spacebar |
| Extract `useExport.ts` hook | ✅ Done — 2026-05-17 | ab8d4d9 — lazy worker, snapshot semantics, ExportError re-export |
| Break App.tsx → components | ✅ Done — 2026-05-16 | 7 components extracted; App.tsx 3,167 → ~1,450 LOC |
| Fix direct mutation pattern | ✅ Done — 2026-05-16 | All setProject calls use immutable .map() |
| Fix `togglePlay` stale closure | ✅ Done — 2026-05-16 | Uses functional updater setIsPlaying(p => !p) |
| Fix export file extension | ✅ Done — 2026-05-16 / 2026-05-17 | Was .webm mislabeled; now real .mp4 from ffmpeg (sidecar in 6.4+) |
| Replace Math.random IDs | ✅ Done — 2026-05-16 | All IDs use crypto.randomUUID() |
| Fix layout regressions (post-extraction) | ✅ Done — 2026-05-16 | min-h-0 on PreviewStage; fullscreen CSS specificity fix |
| Add project persistence | ✅ Done — 2026-05-16 | localStorage + IndexedDB; single-project; "New Project" reset |
| Replace canvas/MediaRecorder export pipeline | ✅ Done — 2026-05-17 | Full pipeline: frameRenderer → segmentEncoder → exportPipeline. Originally via Comlink worker + ffmpeg.wasm; superseded by native ffmpeg sidecar in Phase 6.4. |
| COOP/COEP headers for SharedArrayBuffer | ✅ Done — 2026-05-17 | vite.config.ts (dev) + public/_headers (Cloudflare Pages prod) — removed in Phase 6.4 (wasm no longer needed). |
| Phase 3 E2E smoke test (human) | ✅ Done — 2026-05-17 | Multi-segment + voiceover + FADE transition verified in VLC |
| Add error boundaries | ✅ Done — 2026-05-17 | a42ed66 — ErrorBoundary + PanelFallback, structured ExportResult |
| Clean up dangling asset refs at delete time | ✅ Done — 2026-05-17 | c7515e5 |
| Code-split lazy modals + jszip | ✅ Done — 2026-05-17 | f9704ee, 3e1fd2c — main: 542 kB → 433 kB |
| Prune phantom enum/filter/animation entries | ✅ Done — 2026-05-17 | cdb2296 — FILTERS 57→27, TRANSITION_OPTIONS 10, ANIMATION_OPTIONS 11 |
| Safari export validation | ✅ Done — 2026-05-17 | 97821cd — PASS; crossOriginIsolated=true, full export works |
| Global transition fallback in encoder | ✅ Done — 2026-05-17 | ea18635 — effectiveTransition uses project.globalTransition as fallback |
| Main bundle size | ✅ 433 kB / 132 kB gzip | Down from 542 kB / 161 kB at end of Phase 3 (pre-Phase 6.4) |
| Fix autoMatchAssets delete regression | ✅ Done — 2026-05-19 | Pure autoMatchSegments fn in syncEngine; called imperatively in upload handlers only |
| Real mid-export cancellation | ✅ Done — 2026-05-19 | worker.terminate() + generation counter in useExport |
| JSZip type cleanup | ✅ Done — 2026-05-19 | Destructure { default: JSZip }; @types/jszip removed (jszip ships own types) |
| Stock API 429 handling | ✅ Done — 2026-05-19 | fetchWithRetry exp backoff; StockSearchResult discriminated union; distinct UI states |
| Accessibility pass 1 | ✅ Done — 2026-05-19 | ARIA labels, focus rings, aria-live, timeline slider, useFocusTrap on all 4 modals |
| Phase 5 smoke test doc | ✅ Done — 2026-05-19 | docs/phase-5-smoke-tests.md |
| Fidelity Polish Item 5 — trimEnd | ✅ Done — 2026-05-21 | b3f09b9 + 0f4016c + e7a5134 — gate trimStart/trimEnd UI on video; renderer clamp; encoder flows through frameRenderer |
| Fidelity Polish Item 1 — AnimationType canvas | ✅ Done — 2026-05-21 | ee5ea67 + 33d5840 + 7dfd934 — canvasAnimations.ts (12 types); KEN_BURNS added to picker; live preview motion.div wrapper |
| Fidelity Polish Item 4 — Overlay drag | ✅ Done — 2026-05-21 | cf2e3aa — Pointer Events drag in PreviewStage; hard-clamp; updateExtraOverlayPosition in App.tsx |
| Fidelity Polish Item 2 — KEN_BURNS in picker | ✅ Done — 2026-05-21 | 33d5840 — added to ANIMATION_OPTIONS; dev assert guard extended |
| Fidelity Polish Item 3 — Preview transitions | ✅ Done — 2026-05-21 | 94f8a37 + 0c49339 + ea5ba65 — useTransitionPreview (pre-roll snapshot); canvas overlay in PreviewStage; mounted-ref guard |
| Fidelity Polish smoke test doc | ✅ Done — 2026-05-21 | docs/fidelity-polish-smoke-tests.md |
| Main bundle size (post Phase 6.4) | ✅ 442.18 kB / 134.73 kB gzip (post Phase 6.4 wasm removal) | Current measured value; down from 443.50 kB / 135.70 kB at Fidelity Polish |
| Phase 6.1 — Tauri v2 scaffold | ✅ Done — 2026-05-26 | tauri init, tauri.conf.json, npm scripts, smoke test |
| Phase 6.2 — Rust IPC bridge | ✅ Done — 2026-05-26 | ffmpeg.rs (9 commands incl. save_bytes_to_disk, pick_save_path, reveal_in_finder); TauriFfmpeg class; IPC smoke test (10/10) |
| Phase 6.3 — Wire Tauri backend into export | ✅ Done — 2026-05-26 | isTauri() branch in useExport; ffmpegBackend.ts; rfd save dialog (3b61ec3); E2E verified (~8 min, video plays fine) |
| Phase 6.3.1 — Base64 IPC for frame writes | ✅ Done — 2026-05-26 | ba87174 — bytesToBase64 helper (32 KB chunks); ffmpeg_write_file + save_bytes_to_disk both b64; 551s → 120s (4.6× speedup) |
| Phase 6.4 — Remove wasm path | ✅ Done — 2026-05-26 | 55ba298 — deleted @ffmpeg/*, comlink, exportWorker.ts, ffmpegLoader.ts, dev test buttons; COOP/COEP headers removed |
| Phase 6.5 — Bundle ffmpeg sidecar | ✅ Done — 2026-05-27 | c567d5e — evermeet.cx 8.1.1 static build (76 MB, system-libs-only); tauri-build copies to target/debug/ffmpeg; sidecar("ffmpeg") at runtime; portability verified (export works with system ffmpeg disabled) |
| Divider panel + preview height fixes | ✅ Done — 2026-06-17 | previewHeight initializer from viewport, panel toggle clamps via useEffect (310ms delay), timeline floor 140px enforced during drag and on panel toggle |
| Anchor-based segment timing (Bug 3 fix) | ✅ Done — 2026-06-18 | VideoSegment.anchorStart + anchorSource; applyAnchorBasedTiming in syncEngine.ts; alignScenesToTranscriptAnchorAware in whisperService.ts; Whisper skip-guard + anchor-aware Option A in useWhisper.ts (anchor-aware aligner + skip-guard later removed in clean-slate 3c, 2026-06-24, commits 5da64df/8523f39) |
| Heading system complete | ✅ Done — 2026-06-19 | 9 rounds; isHeading flag, headingConfig, "+ Add Heading" UI, × delete with anchor restoration; an audio-pause/duration-splitting approach was tried and rejected entirely — pure overlay model with 50/50 absorption shipped instead |
| Clean-slate re-sync rebuild (3a–3e) | ✅ Done — 2026-06-24 | Apply Sync now wipes all derived state and re-derives fresh from audio every time — nothing carried forward. Deleted the merge loops, `resolveAnchorSource`/`getComparableText`/`getSegmentStableKey`, the anchor-aware Whisper aligner + skip-guard, PASS 2 anchor backfill, and the dead `anchorSource` demotion in `handleVoiceoverStaged`. Commits: `452e1eb` (3a), 3b tests, `5da64df`/`8523f39` (3c), `eb7fc8e` (3d-1), `f27d557` (3d-2), `6090250` (3e) |
| Step 5 — headings array-only | ✅ Done — 2026-06-24 | `b3a13e3`/`abcc75e`/`72c1fd3`/`6342c8d`/`2516a7c` — segments array is now the sole source of truth for headings; `[HEADING:]` scene-text tag no longer written (5.3) or read (5.4); deleted dead heading duration-budget logic, fixing a ~1.5s/heading skew. Heading styling survives re-sync intact |
| Step 7 — final regression (closes Architecture Shift) | ✅ Done — 2026-06-24 | `254ef1b` — combined-pipeline 11→14 regression test (heading carry-forward + real timing together, production order) + no-out-of-order-warning assertion; smoke-test doc updated; 17/17 vitest; manually verified end-to-end in the Tauri app. **Clean-slate re-sync Architecture Shift is now fully complete (all steps 1–7)** |
| Heading-tag detection false-positive fix | ✅ Done — 2026-06-25 | `cf75695` — `isHeadingTag` used a bare `.includes('HEADING')`, so a scene tag like `[IMAGE: heading_shot.jpg]` false-matched and the whole scene was skipped (vanished from the timeline). Tightened to `/^\[HEADING\s*:/i`, matching how IMAGE/VIDEO tags are anchored. 17/17 vitest, `tsc` clean, manually verified in the Tauri app |
| Orphaned voiceover blob on re-stage fix | ✅ Done — 2026-06-25 | `3b0593c` — `oldIdx` splice in `handleApplySyncFromFiles` now pairs with `URL.revokeObjectURL` + fire-and-forget `deleteAsset(projectId, oldId)`, mirroring the existing `processMediaFile` pattern. Closes the Known Limitations entry above. 17/17 vitest, `tsc` clean |
| Review Mapping popup — post-ship polish | ✅ Done — 2026-06-26 | `55aacc1`/`88169fd`/`603a268`/`5bb778e`/`df52dc1`/`1447813`/`67c4547` — scene overlay x/y wiring (lower-third default y=78, preview+export), swatch/toggle/stock-split + bg-color editor + None option, font-size/bubble-width/quote fixes, square toggle + scene row reorder + X/Y sliders, PreviewStage edge-to-edge X/Y positioning + content-based width fix (heading + scene), scene row consolidation (italic moved into formatting row, color+XY rows merged, shadow swatch removed, ban toggle relocated, toggle thumb sizing fixed), Review Mapping control converted from icon to a centered text button. Refinement of the already-delisted task 7 feature — not a new Active Task. Pushed to `origin/main` (billing block resolved; CI now manual-only `workflow_dispatch`, `e725a46`) |
| Review Mapping — live thumbnail (3b) | ✅ Done — 2026-06-27 | `23c8227` — per-segment thumbnails render a live overlay/heading text layer scaled to the thumbnail box, real-time on edit; modal-only (`PreviewStage`/`frameRenderer`/`types.ts` untouched). Review Mapping modal now feature-complete. `tsc` clean, 17/17 vitest. Pushed to `origin/main` |
| Shared SegmentControls + drawer/preview/timeline sync | ✅ Done — 2026-06-27 | `4887d33` — extracted the Review Mapping card controls (scene + heading layouts) into shared `src/components/SegmentControls.tsx`, reused by both the modal (thumbnail + controls; pure move, unchanged) and the bottom drawer (controls-only, no thumbnail). Drawer recentered to viewport-anchored 50vw (motion `x: '-50%'`), independent of side panels; mute toggle moved to drawer header (scene-only), body mute row removed (scene/heading drawers equal height); dropped the drawer's phantom shadow control. Left-panel segment click seeks the time-driven preview (`handleSegmentClick`) and `Timeline` auto-scrolls the active segment into view on `currentSegmentId` change. `tsc` clean, 17/17 vitest. Pushed to `origin/main`. Closes backlog item 2 (bottom drawer redesign) |
| Effects Tab Rebuild Steps 5–7 + drawer effect-pills | ✅ Done — 2026-06-27 | `dd903b2` (Step 5, Apply to selected/all), `d0d8ca2` (Step 6, randomize across segments), `d750ce3` (bonus, read-only drawer effect-pills), `4b13cb0` (Step 7, combined-look presets via new `src/services/lookPresetService.ts`, 20-cap, client-generated id preserved across the service round-trip so the active "Restored" highlight survives a save). `tsc` clean, 17/17 vitest after each commit. **Local on `main`, NOT pushed** — `origin/main` still at `1e249df`. Step 8 (renderer implementation) is the only remaining step in the Effects Tab Rebuild plan |
| Effects Step 8 — transitions (10/10) | ✅ Done — 2026-06-29 | All 10 slugs in applyTransitionBlend; Batch A (hard-cut/cross-dissolve/zoom/dip-black/dip-white/slide-push/whip-pan/wipe) + Batch B (glitch-rgb/light-leak); screen blend first use; caption fixes; 100/0 timing documented as deferred |
| Bug 1 fix — cancel ghost project | ✅ Done — 2026-06-30 | Cancel no longer creates blank project; auto-popup removed from zero-projects reload; empty dashboard shows correctly |
| Bug 2 fix — inline project rename | ✅ Done — 2026-06-30 | Top-left name is inline editable (click/blur/Enter saves, Escape discards); top-right is read-only reactive label; onRename prop added to DropZonePanel |
| Bug 3 fix — UI state persistence | ✅ Done — 2026-06-30 | activeLeftTab, leftPanelCollapsed, rightPanelCollapsed, previewHeight persisted to kinetix:ui:v1; lazy useState initializers on mount; handleSwitchProject preserveUiState flag preserves currentTime + selectedSegmentId on reload vs reset on project switch |
| Bug 4 fix — left panel auto-scroll | ✅ Done — 2026-06-30 | scrollIntoView on currentSegmentId change in DropZonePanel; isPlaying guard removed so it fires on manual timeline click while paused too; timeline horizontal scroll persists via listener in Timeline.tsx restored at 300ms after mount |
