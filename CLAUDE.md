# CLAUDE.md — Kinetix Pro Studio

> Persistent context for Claude Code sessions. Update "Current Refactor Status" as work progresses.

---

## What This App Does

Browser-based video slideshow compositor. Workflow:
1. User provides a script (text), scene details (bracketed asset names like `[IMAGE: hero.jpg]`), and a voiceover audio file
2. A 3-step sync wizard maps script → scenes → uploaded assets, proportioning segment durations to word count
3. User edits segments on a visual timeline (transitions, overlays, filters, animations)
4. Exports via ffmpeg.wasm — full H.264/AAC MP4 with overlays, filters, and transitions rendered from canvas

No server. No AI calls. Fully client-side.

---

## File Map

```
src/
  App.tsx            # ~1,450 lines — top-level state, orchestration, playback, export
  types.ts           # Shared interfaces: Project, VideoSegment, Asset, TextOverlay + enums
  constants.ts       # FONT_FAMILIES, FILTERS, TEXT_ANIMATIONS, TRANSITION_OPTIONS, ANIMATION_OPTIONS,
                     #   getFilterStyle, getMotionProps + dev-only console.assert guards
  services/
    assetStore.ts    # IndexedDB service: putAsset, getAsset, getAllAssets, deleteAsset, clearAllAssets
    projectStore.ts  # localStorage serializer: save/load/clear under key kinetix:project:v1
    stockService.ts  # Pexels + Pixabay REST search (both keys are client-side env vars)
    syncEngine.ts    # isFuzzyMatch(), findAssetByContext() — parseProjectData() is still in App.tsx
    ffmpegLoader.ts  # Lazy-loads + caches single FFmpeg instance; warns if not crossOriginIsolated.
                     #   NOTE: only used by dev-only test buttons (handleRenderTestFrame, handleEncodeTestSegment)
                     #   on the main thread — NOT used by the production export path.
    frameRenderer.ts   # Pure canvas pipeline: renders one frame for any segment type with filters/overlays/transitions
                     #   Calls applySegmentAnimation (canvasAnimations.ts) for AnimationType canvas transforms.
                     #   Respects segment.trimEnd for video seek clamping.
    canvasAnimations.ts # Canvas 2D animation transforms keyed by AnimationType (Fidelity Polish Item 1).
                     #   applySegmentAnimation() — ctx.save/restore wrapper, easing helpers, dev-only assert guard.
    segmentEncoder.ts # Renders all frames → writes PNGs to ffmpeg FS → libx264 encode → MP4 Uint8Array.
                     #   Reads effectiveTransition = segment.transition || project.globalTransition (see Transition Handling below).
    exportPipeline.ts # Orchestrates full export: encode segments → concat → mux audio → final MP4 Blob.
                     #   Returns ExportResult (never throws). ExportErrorKind: ffmpeg_load|encode|concat|mux|asset_missing|unknown.
  workers/
    exportWorker.ts  # Comlink-exposed FfmpegWorkerService; owns FFmpeg instance off main thread.
                     #   Registers ffmpeg.on('log', ...) → console.debug to silence ffmpeg stderr noise.
  hooks/
    usePersistProject.ts     # Debounced (500ms) project save; accepts enabled flag to gate hydration
    useExport.ts             # Export orchestration: lazy worker lifecycle, ExportSnapshot for retry, progress callback.
                             #   Re-exports ExportError so App.tsx doesn't import exportPipeline directly.
    useTransitionPreview.ts  # Pre-roll snapshot blend for preview transitions (Fidelity Polish Item 3).
                             #   Renders outgoing+incoming frames ~400ms before window; blends via applyTransitionBlend.
  components/
    ErrorBoundary.tsx     # Class-based error boundary (getDerivedStateFromError); PanelFallback with dev stack trace.
    PreviewStage.tsx      # Video/image display + overlay rendering
    SegmentEditorPanel.tsx # Segment list + per-segment controls
    SettingsPanel.tsx     # Global aesthetics, export quality (resolution/fps), JSON import/export, "New Project" reset
    StockSearchModal.tsx  # Pexels/Pixabay search modal — lazy-loaded via React.lazy
    SyncReviewModal.tsx   # Sync mapping review modal — lazy-loaded via React.lazy
    SyncWizard.tsx        # 3-step sync header buttons + validation
    Timeline.tsx          # Scrollable track + playhead + zoom
  index.css          # Tailwind base + custom scrollbar
  main.tsx           # React entry point
index.html           # Title: "Kinetix Pro Studio"
vite.config.ts       # Vite config — COOP/COEP headers for dev server (required for SharedArrayBuffer)
public/
  _headers           # Cloudflare Pages: COOP/COEP headers for production (required for SharedArrayBuffer)
docs/
  phase-4-safari-test.md         # Safari validation procedure + decision matrix (result: PASS)
  fidelity-polish-smoke-tests.md # Fidelity Polish manual smoke test procedures (Items 1–5)
.env.example         # VITE_PEXELS_API_KEY, VITE_PIXABAY_API_KEY
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

`parseProjectData()` is the core sync engine — parses sceneDetails, fuzzy-matches asset names, distributes voiceover duration proportionally by word count. Extracted to `src/services/syncEngine.ts`.

Playback is driven by a `setInterval` (100ms tick) that advances `currentTime`, which `currentSegment` is derived from via `useMemo`.

Export: see **Export Pipeline** section below. MediaRecorder removed in Phase 3.

### Persistence Model

localStorage (key `kinetix:project:v1`, versioned for future migrations) holds the JSON project state with asset `url` and `file` fields stripped — blob URLs are ephemeral and cannot survive a reload. IndexedDB (`kinetix-assets` database, `assets` object store, keyPath `id`) holds the raw blobs keyed by asset id. On app load, the mount effect in `App.tsx` reads localStorage first; if a saved project exists, it fetches all blobs from IndexedDB, builds a `Map<id, StoredAsset>`, and reconstructs each asset's `url` via `URL.createObjectURL(blob)`. Assets whose id is in localStorage but whose blob is missing from IndexedDB are dropped with a `console.warn`, and any segment `assetId` or top-level `voiceoverId` referencing a dropped asset is set to `undefined` — the segment itself is preserved so the timeline is not disturbed. Any future code that **adds** an asset to `project.assets` MUST call `putAsset` before setting project state (if `putAsset` throws, do not add the asset — a phantom asset that vanishes on reload is worse than no asset). Any future code that **removes** an asset MUST call `deleteAsset` and `URL.revokeObjectURL` after the state update.

### Export Pipeline

**Requires `crossOriginIsolated = true`** — served with `Cross-Origin-Opener-Policy: same-origin` + `Cross-Origin-Embedder-Policy: require-corp` headers (configured in `vite.config.ts` for dev, `public/_headers` for Cloudflare Pages prod). Without these headers `SharedArrayBuffer` is unavailable and ffmpeg.wasm falls back to single-threaded mode (slower but still functional).

Full chain, left to right:

```
App.tsx handleExport()
  │
  ├─ spawns exportWorker.ts Web Worker (Comlink)
  │     └─ FfmpegWorkerService.load()
  │           └─ new FFmpeg() + toBlobURL inline  →  loads @ffmpeg/core@0.12.6 (WASM) via unpkg CDN
  │           NOTE: does NOT call ffmpegLoader.ts — the worker owns its FFmpeg instance directly.
  │           ffmpegLoader.ts is only used by dev test buttons on the main thread.
  │
  └─ exportPipeline.ts  exportProject(project, ffmpegWorkerProxy, options, onProgress)
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
        │       ├─ writes frame_00001.png … frame_NNNNN.png to ffmpeg FS
        │       └─ ffmpeg exec: libx264 fast crf23 yuv420p → seg_N.mp4
        │
        ├── if >1 segment: ffmpeg concat demuxer → concat_video.mp4
        │
        ├── if voiceover: ffmpeg mux audio (AAC 192k -shortest) → export_final.mp4
        │
        └── readFile → Blob('video/mp4') → download {name}_{timestamp}.mp4
```

**Key types:**
- `FfmpegLike` (in `segmentEncoder.ts`) — minimal interface: `writeFile`, `exec`, `readFile`, `deleteFile`. Both raw `FFmpeg` and the Comlink proxy satisfy this contract.
- `ExportResult = { ok: true; blob: Blob } | { ok: false; error: ExportError }` — `exportProject` never throws; all failures are typed.
- `ExportErrorKind`: `ffmpeg_load | encode | concat | mux | asset_missing | unknown`.
- `ExportStage` union: `loading_ffmpeg | encoding_segment | muxing | done` — drives the progress modal via `useExport`.
- `FrameGlobalConfig` — carries `overlayConfig`, `hideAllText`, `globalOverlayFilter` into the renderer.

**Performance (Phase 3 baseline):** ~25s wall-clock per 1s of 1080p/30fps output (≈1.35s/frame). 4K is untested. Phase 6 (Tauri + native ffmpeg) will replace this path entirely.

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

## Known Bugs (Fix Before Shipping)

- ~~**Trim End**~~: **Fixed Fidelity Polish Item 5** — `trimEnd` UI (slider + reset button, video-only) in SegmentEditorPanel; `frameRenderer.ts` clamps `videoTime = Math.min(rawTime, segment.trimEnd)` before seek; encoder path flows through frameRenderer automatically.
- ~~**`autoMatchAssets` effect at `App.tsx:350–355`**~~: **Fixed Phase 5 step 1** — removed the effect; `autoMatchSegments` is now called imperatively inside each upload handler only. Deletion path is clean.
- ~~**Line ~908 dead branch**~~: **Fixed Phase 1 Step 3** — `Math.abs(audioRef.current.currentTime - currentTime) > 0.2` check removed from playback interval. No such check exists in current code.
- ~~**`togglePlay` listener churn**~~: **Fixed Phase 1 Step 3** — keyboard `useEffect` at App.tsx:817 uses `setIsPlaying(p => !p)` directly with `[]` dep array; listener attaches once on mount. No churn.
- ~~**`storyMap` unused param**~~: **Fixed Phase 1 Step 3** — `parseProjectData` signature has no `storyMap` parameter. Removed in Phase 1.

---

## Known Limitations (Intentionally Deferred)

These are known gaps, not bugs to fix immediately. Track here so they aren't forgotten.

| Limitation | Impact | Future Fix |
|---|---|---|
| ~~Export fidelity limited to what `frameRenderer.ts` implements~~ | ✅ **Resolved Phase 4** — phantom entries pruned from all UI dropdowns; only implemented transitions/filters/animations are shown | — |
| ~~Safari export untested~~ | ✅ **Resolved Phase 4** — Safari verified 2026-05-17; `crossOriginIsolated=true`, full export works | — |
| ~~Segments referencing a deleted asset not cleaned up until reload~~ | ✅ **Resolved Phase 4 (c7515e5)** — cleaned up at delete time | — |
| ~~No error boundaries~~ | ✅ **Resolved Phase 4 (a42ed66)** — `ErrorBoundary` wraps left panel, PreviewStage, Timeline | — |
| Client-side API keys | Keys visible in JS bundle | Backend proxy endpoint (Phase 5) |
| No authentication | Open access | Add auth layer when persistence is added |
| ~~`AnimationType` values not applied in canvas export~~ | ✅ **Resolved Fidelity Polish Item 1** — `canvasAnimations.ts` applies KEN_BURNS/FLOAT/BOUNCE/PULSE/HEARTBEAT/WOBBLE/SHAKE/SKEW/GLITCH/NEON_FLICKER/ROTATE via ctx transforms in frameRenderer; live preview uses `getAnimationWrapperProps` in PreviewStage. | — |
| ~~Extra overlays have no drag-to-position UI~~ | ✅ **Resolved Fidelity Polish Item 4** — Pointer Events drag in PreviewStage with hard-clamp `[halfW/2, 100-halfW/2]`; `updateExtraOverlayPosition` callback wires to App.tsx immutable state update. | — |
| ~~No rate-limit handling in stockService~~ | ✅ **Resolved Phase 5** — exponential backoff retry (3 attempts); discriminated union surface rate_limited/error/ok | — |
| ~~JSZip dynamic-import double-cast~~ | ✅ **Resolved Phase 5** — `{ default: JSZip }` destructure; `moduleResolution: "bundler"` synthesizes `.default` | — |
| ~~Real mid-export cancellation not implemented~~ | ✅ **Resolved Phase 5** — `worker.terminate()` + generation counter prevents stale state overwrite | — |
| 4K export unvalidated | 1080p verified on Safari + Chrome; 4K path untested | Validate in Phase 6 |

---

## Dependencies to Remove

All dead dependencies removed. No remaining items.

---

## Environment Variables

| Variable | Used In | Required? |
|---|---|---|
| `VITE_PEXELS_API_KEY` | `src/services/stockService.ts` | Optional — stock search silently disabled if missing |
| `VITE_PIXABAY_API_KEY` | `src/services/stockService.ts` | Optional — stock search silently disabled if missing |
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
| Extract `usePlayback.ts` hook | ⬜ Deferred — Phase 6 | Playback interval + audio sync still in App.tsx |
| Extract `useExport.ts` hook | ✅ Done — 2026-05-17 | ab8d4d9 — lazy worker, snapshot semantics, ExportError re-export |
| Break App.tsx → components | ✅ Done — 2026-05-16 | 7 components extracted; App.tsx 3,167 → ~1,450 LOC |
| Fix direct mutation pattern | ✅ Done — 2026-05-16 | All setProject calls use immutable .map() |
| Fix `togglePlay` stale closure | ✅ Done — 2026-05-16 | Uses functional updater setIsPlaying(p => !p) |
| Fix export file extension | ✅ Done — 2026-05-16 / 2026-05-17 | Was .webm mislabeled; now real .mp4 from ffmpeg.wasm |
| Replace Math.random IDs | ✅ Done — 2026-05-16 | All IDs use crypto.randomUUID() |
| Fix layout regressions (post-extraction) | ✅ Done — 2026-05-16 | min-h-0 on PreviewStage; fullscreen CSS specificity fix |
| Add project persistence | ✅ Done — 2026-05-16 | localStorage + IndexedDB; single-project; "New Project" reset |
| Replace canvas/MediaRecorder export with ffmpeg.wasm | ✅ Done — 2026-05-17 | Full pipeline: frameRenderer → segmentEncoder → exportPipeline → Comlink worker |
| COOP/COEP headers for SharedArrayBuffer | ✅ Done — 2026-05-17 | vite.config.ts (dev) + public/_headers (Cloudflare Pages prod) |
| Phase 3 E2E smoke test (human) | ✅ Done — 2026-05-17 | Multi-segment + voiceover + FADE transition verified in VLC |
| Add error boundaries | ✅ Done — 2026-05-17 | a42ed66 — ErrorBoundary + PanelFallback, structured ExportResult |
| Clean up dangling asset refs at delete time | ✅ Done — 2026-05-17 | c7515e5 |
| Code-split lazy modals + jszip | ✅ Done — 2026-05-17 | f9704ee, 3e1fd2c — main: 542 kB → 433 kB |
| Prune phantom enum/filter/animation entries | ✅ Done — 2026-05-17 | cdb2296 — FILTERS 57→27, TRANSITION_OPTIONS 10, ANIMATION_OPTIONS 11 |
| Safari export validation | ✅ Done — 2026-05-17 | 97821cd — PASS; crossOriginIsolated=true, full export works |
| Global transition fallback in encoder | ✅ Done — 2026-05-17 | ea18635 — effectiveTransition uses project.globalTransition as fallback |
| Main bundle size | ✅ 433 kB / 132 kB gzip | Down from 542 kB / 161 kB at end of Phase 3 |
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
| Main bundle size (post Fidelity Polish) | ✅ 443.50 kB / 135.70 kB gzip | +7.6 kB raw / +2.5 kB gzip from Phase 5 baseline (443.50 / 435.88 vs 135.70 / 133.19) — within ≤+20kB/+5kB budget |
