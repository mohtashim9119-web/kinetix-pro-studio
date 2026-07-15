# CLAUDE.md — Kinetix Pro Studio

> Persistent context for Claude Code sessions. Architecture, conventions, and invariants only — for current status, active tasks, and history, see `project-state.md` and `docs/history.md`.

---

## What This App Does

Desktop video slideshow compositor (Tauri v2 wrapper around a React/Vite frontend). Workflow:
1. User provides a script (text), scene details (bracketed asset names like `[IMAGE: hero.jpg]`), and a voiceover audio file
2. Apply Sync (the single sync entry point) maps script → scenes → uploaded assets in one pass, proportioning segment durations to character count
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
                     #   Segment-resize and divider drags do NOT call setProject per mousemove —
                     #   live width is written directly via data-seg-id-tagged DOM refs, rAF-
                     #   coalesced, with the timeline rect/pps cached once at drag start; the real
                     #   state commit happens exactly once on mouseup via applyDurationChange
                     #   (perf fix, commit f4da926).
  types.ts           # Shared interfaces: Project, VideoSegment, Asset, TextOverlay + enums.
                     #   SegmentGrade { brightness, contrast, saturation, temperature } — each
                     #   -1..1, 0 = neutral — plus VideoSegment.effectGrade?: SegmentGrade
                     #   (object-valued, mirrors overlayConfig?; undefined = never graded, which
                     #   is DISTINCT from an explicit neutral {0,0,0,0}). Deliberately declared
                     #   here rather than imported from services/gl so the dependency direction
                     #   stays services -> types. Carried across Apply Sync by unique-assetId
                     #   match alongside the other effect* fields (App.tsx's carry loop).
  constants.ts       # FONT_FAMILIES, FILTERS, TEXT_ANIMATIONS, TRANSITION_OPTIONS, ANIMATION_OPTIONS,
                     #   getFilterStyle, getMotionProps + dev-only console.assert guards
  effectsOptions.ts  # TRANSITIONS, ANIMATIONS, OVERLAYS option lists (shared source for EffectsPanel
                     #   dropdowns/randomize-pools — Effects Tab Rebuild Step 2) + NONE sentinels.
  services/
    assetStore.ts    # IndexedDB service: putAsset, getAsset, getAllAssets, deleteAsset, clearAllAssets
    projectStore.ts  # localStorage serializer: save/load/clear under key kinetix:project:v1
    stockService.ts  # Pexels + Pixabay REST search (both keys are client-side env vars)
    syncEngine.ts    # Content-only matching + timing helpers (no heading logic — headings
                     #   moved to a separate overlay layer in Path B Phase 7, 2026-07-09):
                     #   isFuzzyMatch(), findAssetByContext(), applyAnchorBasedTiming(),
                     #   plus the tag/filename matchers (cleanTagName, isExactFilenameMatch,
                     #   contiguousWordMatch) and autoMatchSegments().
                     #   parseProjectData() still in App.tsx. PASS 2 (character-weight anchor
                     #   backfill) deleted in 3d-2 — dead under clean-slate. PASS 3 now falls
                     #   back to a segment's own startTime for any missing anchor (3d-1).
    whisperService.ts # alignScenestoTranscript() sliding-window text matcher; distributeSegmentTimes()
                     #   applies aligned windows (lock-aware); transcribeWithProgress() runs the
                     #   whisper-cli sidecar; canonicalizeForAlignment/normalize/textMateriallyChanged
                     #   symmetric token canonicalization (D16). No heading-timing logic — the old
                     #   applyHeadingTiming() was deleted in Path B Phase 7 (2026-07-09).
    silenceDetector.ts # detectSilences(audioUrl) — Web Audio API silence scan used by Whisper gap-fill;
                     #   overlap-based lookup, usedSilences set, monotonic boundary check.
    tauriFfmpeg.ts   # TauriFfmpeg class (FfmpegLike) — routes file I/O + exec through Tauri IPC.
                     #   bytesToBase64() helper (chunked 32 KB btoa — avoids stack overflow on large buffers).
                     #   writeFileRaw() (2026-07-09) — sends frame bytes as a raw Tauri v2 invoke body
                     #   (no base64) to ffmpeg_write_file_raw; session id + path travel as headers.
                     #   Optional on FfmpegLike — segmentEncoder.ts prefers it when present, else uses
                     #   the base64 writeFile() path above.
                     #   saveSessionFile(fileName, destPath) (2026-07-14) — invokes save_session_file
                     #   to copy a finished session file straight to disk natively; the file's bytes
                     #   NEVER enter the renderer. Replaces the readFile→Blob→arrayBuffer→base64→
                     #   save_bytes_to_disk chain that inflated the whole MP4 ~5-6× in the WebView heap
                     #   and crashed WebView2's OOM guard (STATUS_BREAKPOINT) on large exports. Exposed
                     #   to useExport.ts via ffmpegBackend.ts's TauriBackend.saveOutputToDisk.
                     #   isTauri() guard — checks for window.__TAURI_INTERNALS__.
                     #   probeAudioDuration(blob) — native ffmpeg duration probe (invoke
                     #   'probe_audio_duration'); throws on failure. App.tsx's resolveVoiceoverDuration
                     #   wraps it (File or fetched blob) — replaced the old <audio>+60s-fallback probe.
    audioFormats.ts  # AUDIO_EXTENSIONS + isAudioFile(file) — voiceover-slot classifier (broad
                     #   extension list + audio/* MIME fallback). DropZonePanel.addFiles uses it;
                     #   files dropped ON the Voiceover slot that don't classify raise a slot error
                     #   instead of silently misrouting to the image-asset bucket.
    ffmpegBackend.ts # createTauriBackend() — creates TauriFfmpeg session, returns { ffmpeg, dispose }.
                     #   dispose() calls ffmpegDestroy to delete $TMPDIR/kinetix-export-<uuid>/ after export.
    frameRenderer.ts   # Pure canvas pipeline: renders one frame for any segment type with filters/overlays/transitions
                     #   Calls applySegmentAnimation (canvasAnimations.ts) for AnimationType canvas transforms.
                     #   Respects segment.trimEnd for video seek clamping.
                     #   Two <video>-element caches (2026-07-09): the primary videoCache, and an
                     #   isolated blendVideoCache used only when renderSegmentFrame is called with
                     #   useBlendVideoCache: true (the transition-blend "incoming" render in
                     #   segmentEncoder.ts) — prevents a same-source-URL transition from thrashing one
                     #   shared <video> between the outgoing and incoming seek targets every frame.
                     #   releaseBlendVideo(url) detaches and drops a blend-cache entry; called by
                     #   segmentEncoder.ts once a segment's transition window finishes encoding.
    canvasAnimations.ts # Canvas 2D animation transforms keyed by AnimationType (Fidelity Polish Item 1).
                     #   applySegmentAnimation() — ctx.save/restore wrapper, easing helpers, dev-only assert guard.
    segmentEncoder.ts # Renders all frames → writes PNGs to ffmpeg FS → libx264 encode → MP4 Uint8Array.
                     #   Reads effectiveTransition = segment.transition || project.globalTransition (see Transition Handling below).
                     #   Also hosts encodePlainVideoSegment/encodeStaticImageSegment — the Tier 1
                     #   fast-path encoders used when plainSegment.ts predicates return true.
                     #   Frame render/write loop is pipelined (2026-07-09): a FrameEncoderPool of
                     #   OffscreenCanvas workers (frameEncodeWorker.ts) PNG-encodes frame N while the
                     #   main thread renders frame N+1; prefers ffmpeg.writeFileRaw (raw-binary IPC,
                     #   no base64) when the FfmpegLike implementer provides it, else falls back to
                     #   writeFile. Falls back to the original fully-sequential main-thread loop when
                     #   Worker/OffscreenCanvas is unavailable. Also wires blend-cache isolation: passes
                     #   useBlendVideoCache: true on the transition-blend render and calls
                     #   frameRenderer.ts's releaseBlendVideo() in a finally once a segment's transition
                     #   window finishes encoding (see frameRenderer.ts entry below).
    frameEncodeWorker.ts # Dedicated-worker PNG encoder used by segmentEncoder.ts's FrameEncoderPool —
                     #   OffscreenCanvas.convertToBlob('image/png'), reused canvas across frames.
                     #   Pixel-exact vs. the old main-thread canvas.toBlob path (same encoder, same bytes).
    plainSegment.ts  # isPlainVideoSegment/isPlainImageSegment (Tier 1 fast-path predicates, both
                     #   backed by a shared internal isPlainMediaSegment core) — true when a segment
                     #   has no per-frame compositing (no caption/overlay/filter/animation/speed
                     #   change, no transition on either edge), so exportPipeline.ts can skip the
                     #   canvas/PNG/IPC pipeline and hand it to ffmpeg directly (one trim+encode for
                     #   video, one frame + -loop/-frames:v for images). Conservative by design —
                     #   anything not certain to be plain falls back to the canvas path.
    exportPipeline.ts # Orchestrates full export: encode segments → concat → mux audio → final MP4.
                     #   Returns ExportResult (never throws). ExportErrorKind: ffmpeg_load|encode|concat|mux|asset_missing|unknown.
                     #   On success returns { ok:true, outputFile } — the session-relative name of the
                     #   final MP4 (export_final.mp4), NOT its bytes/a Blob (changed 2026-07-14). The
                     #   final file is deliberately left in the session temp dir (excluded from the
                     #   intermediate-file cleanup) so the native save path (TauriFfmpeg.saveSessionFile)
                     #   can copy it straight to disk; it's never read back over IPC. Reading it via
                     #   ffmpeg_read_file (JSON number[], ~8× in the WebView heap) + Blob/base64 copies
                     #   was the STATUS_BREAKPOINT OOM crash on large exports. ffmpeg.readFile is still
                     #   used INTERNALLY for bounded per-segment reads (segmentEncoder.ts, untouched).
                     #   Routes each segment through plainSegment.ts's predicates first; plain
                     #   segments bypass frameRenderer.ts entirely (Tier 1 fast path).
    lookPresetService.ts # Combined-look effect presets (Effects Tab Rebuild Step 7): localStorage
                     #   key kinetix:lookPresets:v1, global across projects, cap MAX_LOOK_PRESETS=20.
                     #   loadLookPresets/saveLookPreset/deleteLookPreset. saveLookPreset persists the
                     #   caller-supplied id as-is (no internal re-mint) so EffectsPanel's activeId stays
                     #   valid after the round-trip; same-id save is a no-op (returns the existing record,
                     #   no duplicate row). Deliberately separate from the legacy presetService.ts
                     #   (single-category StylePreset) — combined-look needs 3 slugs + 2 durations at once.
    uiStateStore.ts  # readUiState()/patchUiState() — centralized kinetix:ui:v1 read-merge-write;
                     #   single source for UI-state persistence (D6 fix).
    gl/              # WebGL2 effects engine (docs/webgl-architecture-plan.md). Renders ONLY behind
                     #   PreviewStage.tsx's dev gate (import.meta.env.DEV && glDevToggle) until
                     #   Phase 5's cutover — a production build never reaches this code today.
      glContext.ts   # isWebGL2Supported() + context acquisition/loss-restore plumbing.
      shaders.ts     # GLSL ES 3.0 sources (blit, cross-dissolve, dip, light-leak, zoom, grade) +
                     #   u_texRectA/B object-cover UV-crop uniforms. DO NOT change this math without
                     #   re-running the real-GPU pixel checks — see the file's own header.
      glCompositor.ts # GlCompositor — owns programs/render targets; per-layer render chain
                     #   (prep slot A -> prep slot B -> blend -> grade). drawGrade sends every grade
                     #   channel through compositeParams.ts's remaps (NOT the raw slider value);
                     #   a neutral grade skips the grade pass entirely (isNeutralGrade).
      compositeParams.ts # PURE derivation, no React/DOM/pool: deriveCompositeParams (transition +
                     #   per-slot zoom + grade for a tick) and deriveSlotPlan (which segment feeds
                     #   texture slot a/b). Grade resolves from the CONTAINING segment's effectGrade,
                     #   else config.grade, else NEUTRAL_GRADE — one post-blend pass, so it SNAPS at
                     #   the transition midpoint (accepted Phase 4 limit, no cross-fade).
                     #   Also owns the grade slider->uniform remaps: the -1..1 slider domain is
                     #   user-facing only; each channel maps onto a gentler EFFECTIVE range at the
                     #   render boundary so every slider position is usable —
                     #   brightnessOffsetUniform (±0.25 additive), contrastGainUniform
                     #   (1.6^c - 1 => 0.625x-1.6x gain), saturationMixUniform (x0.6 => 0.4x-1.6x),
                     #   temperatureTintUniform (x0.4 => ±0.04 channel shift), plus the
                     #   brightnessFromOffset/contrastFromGain inverses autoGrade.ts solves through.
                     #   Every remap maps 0 -> 0, which is what makes glCompositor's neutral-skip
                     #   sound. Feeding raw slider values made the frame unusable at the extremes
                     #   (63/81 combos solid white/black/flat) — do not remove this indirection.
      autoGrade.ts   # computeAutoGrade(ImageData) -> SegmentGrade. Pure, mock-free, DOM-free.
                     #   ONE-SHOT parameter generator (never a per-tick stage): p2-p98 luma-percentile
                     #   stretch solved in the shader's ACTUAL op order (brightness BEFORE contrast,
                     #   pivot 0.5) and in compositeParams.ts's effective ranges, converted back to
                     #   slider terms via its inverses — imports those constants rather than
                     #   restating them, so Auto and the manual sliders cannot drift. Half-strength
                     #   gray-world temperature nudge; saturation always 0 (manual only); flat /
                     #   near-black frames return neutral. PreviewStage.tsx owns the sampler (it
                     #   holds the decode pool + assets); App.tsx's handleAutoGrade drives scope.
  hooks/
    usePlayback.ts           # Playback loop: RAF (~16ms) when voiceover loaded, setInterval (100ms) no-voiceover path; audio sync, spacebar.
    usePersistProject.ts     # Debounced (500ms) project save; accepts enabled flag to gate hydration
    useExport.ts             # Export orchestration: Tauri-only (Phase 6.4+). Creates TauriFfmpeg session,
                             #   pick_save_path dialog runs BEFORE render; calls exportProject(), then on
                             #   success copies the finished MP4 to the chosen path via
                             #   TauriBackend.saveOutputToDisk (native save_session_file copy) — the file's
                             #   bytes never enter the renderer (2026-07-14; replaced the old
                             #   result.blob→arrayBuffer→base64→save_bytes_to_disk path that OOM-crashed
                             #   WebView2 on large exports). The save copy runs BEFORE teardown() (which
                             #   destroys the session dir); on save failure it tears down and surfaces an
                             #   'unknown' ExportError.
                             #   ExportSnapshot for retry; generation counter guards stale callbacks.
                             #   Re-exports ExportError so App.tsx doesn't import exportPipeline directly.
    useTransitionPreview.ts  # Pre-roll snapshot blend for preview transitions (Fidelity Polish Item 3).
                             #   Renders outgoing+incoming frames ~400ms before window; blends via applyTransitionBlend.
                             #   Takes isResizingRef; forces inTransitionWindow/needsPreRoll/isActive false while a
                             #   timeline resize-drag is in progress (plain per-render read, not an effect dep) —
                             #   otherwise a drag's transient segment-boundary geometry could sweep currentTime into
                             #   a bogus transition window and swap in the wrong segment's snapshot (D12, be45b07).
    useWhisper.ts            # Whisper transcription orchestration: transcribeWithProgress, alignments,
                             #   distributeSegmentTimes. Generation counter + AbortController
                             #   for cancellation.
  components/
    BottomDrawer.tsx   # Slide-up per-segment editor (8 controls): header w/ duration badge + lock + ×;
                     #   two-column Asset | OverlayText; collapsible Formatting panel; slip-trim visual
                     #   bar (fixed-width orange window slides over source). Also edits a
                     #   Path B HeadingOverlay when passed a `heading` prop (mutually exclusive
                     #   with `segment`) — headings are a separate top-level overlay layer, no
                     #   longer in-array segments. Click-outside backdrop closes drawer.
                     #   Header also shows a read-only effect-pills row (icon+label per applied
                     #   transition/animation/overlay; off-states hidden) — Effects Tab Rebuild bonus.
    EffectsPanel.tsx   # Effects tab UI (transitions/animations/overlays dropdowns + Apply to
                     #   selected/all, randomize-from-checked-pool, combined-look presets section,
                     #   GRADE section).
                     #   GradeSection (color grading, Phase 4) holds the 4 sliders (-1..1, step .01)
                     #   as LOCAL draft state that is kept in sync with the ACTIVE segment — the
                     #   single selected segment if exactly one is selected, else the playhead's
                     #   (App.tsx derives this as activeGrade/activeGradeSegmentId). Three writers
                     #   touch that draft and they must not fight each other:
                     #     1. sync effect — pulls the active segment's stored effectGrade INTO the
                     #        draft. Compares by VALUE (gradesEqual) not prop identity, so an
                     #        unrelated parent re-render can't clobber an in-progress drag.
                     #     2. slider drag — pushes the draft OUT to the active segment only
                     #        (onGradeLive -> App.handleGradeLive), debounced 120ms, so the preview
                     #        is live with no Apply click.
                     #     3. Reset sliders — cancels any pending debounced write, resets the draft,
                     #        and IMMEDIATELY writes a neutral effectGrade (a click is discrete, so
                     #        no debounce; but the cancel is load-bearing or the drag's queued value
                     #        lands ~120ms later and silently re-grades).
                     #   (2)/(3) echo back through project.segments and would make (1) snap the
                     #   slider back on every write — selfWriteRef tags our own writes so the sync
                     #   effect records them without pushing them back into the draft. A pending
                     #   write is also cancelled when the active segment changes, so a queued value
                     #   can't land on the segment the user just moved to. Touch any of these three
                     #   without re-reading the others and you will reintroduce the fight.
                     #   Reset sliders != Clear grading: Reset writes a neutral {0,0,0,0} on the
                     #   active segment; Clear ({type:'grade-clear'}) writes effectGrade: undefined
                     #   over a selected/all scope. Identical on screen today (config.grade is unset),
                     #   semantically distinct if a project-level grade fallback is ever added.
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
                     #   Both track rows carry data-seg-id={s.id} so App.tsx's drag handler can
                     #   write live width directly to the DOM during a resize (commit f4da926).
                     #   The reload scroll restore is a one-shot effect gated behind a
                     #   didRestoreRef, deferred until containerWidth's ResizeObserver first fires
                     #   (real pixelsPerSecond, not the 800px zoom fallback) — restoring earlier let
                     #   the browser clamp scrollLeft to 0, then two auto-scroll effects (segment-
                     #   follow, zoom-center) would re-scroll shortly after, producing a visible
                     #   "0 then scroll" flash. Both auto-scroll effects check didRestoreRef before
                     #   running (fixed in 34206ee, on top of the fb6abbb useLayoutEffect timing fix).
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
                     #   (16 total: 13 in ffmpeg.rs + 2 in whisper.rs + fetch_url_bytes here).
                     #   fetch_url_bytes: proxy for stock CDN CORS bypass (returns base64).
    ffmpeg.rs        # 13 Tauri commands: create_session, write_file (b64), write_file_raw (raw-body,
                     #   no base64 — added 2026-07-09, session id + path travel as request headers),
                     #   read_file, delete_file, exec (sidecar), destroy_session, pick_save_path,
                     #   save_bytes_to_disk (rfd), save_session_file (native fs::copy of a finished
                     #   session file to a user path — no bytes through the renderer; added 2026-07-14
                     #   to fix the large-export STATUS_BREAKPOINT OOM crash), probe_audio_duration,
                     #   probe_video_fps, reveal_in_finder.
                     #   Session-scoped temp dirs ($TMPDIR/kinetix-export-<uuid>/); path traversal
                     #   validation (write_file_raw validates the header-supplied path the same way
                     #   write_file does).
                     #   probe_audio_duration: runs `ffmpeg -i <file>` (no ffprobe binary bundled),
                     #   parses `Duration:` from stderr — replaces the WebView <audio> duration probe
                     #   (codec-dependent, silent 60s fallback); throws on failure, no fake duration.
    whisper.rs       # 2 Tauri commands: whisper_transcribe (streams progress via Channel),
                     #   whisper_cancel. WhisperState holds the running child process for cancellation.
                     #   Sidecar: binaries/whisper; model files: models/*.
                     #   whisper_transcribe now PRE-TRANSCODES the upload to 16kHz mono WAV via the
                     #   ffmpeg sidecar (transcode_to_wav) before whisper-cli runs — whisper.cpp's
                     #   miniaudio backend only decodes wav/mp3/ogg/flac and fails silently (exit 0,
                     #   zero tokens) on M4A/AAC; ffmpeg reads virtually anything, so any container
                     #   the user uploads works. Transcode failure surfaces a real Error event.
  binaries/
    README.md        # Re-provisioning instructions for the gitignored ffmpeg sidecar binaries.
    ffmpeg-x86_64-apple-darwin  # gitignored — evermeet.cx 8.1.1 (76 MB, Intel macOS).
    ffmpeg-aarch64-apple-darwin # gitignored — osxexperts.net 7.1.1 (48 MB, arm64 macOS).
    ffmpeg-x86_64-pc-windows-msvc.exe # gitignored — gyan.dev essentials (97 MB, Windows).
docs/
  archived/
    fidelity-polish-smoke-tests.md # Fidelity Polish manual smoke test procedures (Items 1–5) — archived, feature stable since 2026-05-25
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

`parseProjectData()` is the core sync engine — parses sceneDetails, fuzzy-matches asset names, distributes voiceover duration proportionally by character count. `[HEADING:]` tags are recognized only as scene boundaries — recognize-and-skip, no segment materialized (Step 5, 5.4); headings live solely in the segments array. Still defined in `src/App.tsx` — only the fuzzy-matching and anchor-timing helpers (`isFuzzyMatch`, `findAssetByContext`, `applyAnchorBasedTiming`, the heading-anchor helpers) have been extracted to `src/services/syncEngine.ts`.

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
                    │       ├─ PNG-encodes off-thread (FrameEncoderPool, frameEncodeWorker.ts) while the
                    │       │     main thread renders the next frame (2026-07-09 pipelining)
                    │       ├─ writes frame_00001.png … frame_NNNNN.png via IPC — raw-binary
                    │       │     (ffmpeg_write_file_raw, no base64) when the ffmpeg backend supports it,
                    │       │     else base64-encoded (ffmpeg_write_file)
                    │       │     →  $TMPDIR/kinetix-export-<uuid>/frame_NNNNN.png
                    │       └─ IPC: ffmpeg_exec  →  sidecar ffmpeg  →  libx264 fast crf16 yuv420p bt709 → seg_N.mp4
                    │
                    │   (Tier 1 fast path — plainSegment.ts predicates true — skips all of the
                    │    above per-frame steps for that segment: one direct ffmpeg trim+encode
                    │    for plain video, one frame + -loop/-frames:v for plain image, same
                    │    CRF/bt709/CFR flags for clean concat.)
                    │
                    ├── if >1 segment: ffmpeg concat demuxer → concat_video.mp4
                    │
                    ├── if voiceover: ffmpeg mux audio (AAC 192k -shortest) → export_final.mp4
                    │
                    │   exportProject returns { ok:true, outputFile:'export_final.mp4' } — the file
                    │   is LEFT in the session dir (not read into renderer memory).
                    │
                    └── useExport.ts: IPC save_session_file → native fs::copy export_final.mp4 →
                          user's chosen path (bytes never enter the renderer; save dialog already
                          ran via pick_save_path before render). Then IPC ffmpeg_destroy_session
                          (cleanup $TMPDIR session dir, incl. export_final.mp4).
```

**Key types:**
- `FfmpegLike` (in `segmentEncoder.ts`) — minimal interface: `writeFile`, `exec`, `readFile`, `deleteFile`, plus an optional `writeFileRaw` (2026-07-09). `TauriFfmpeg` satisfies this contract, including `writeFileRaw`.
- `ExportResult = { ok: true; outputFile: string } | { ok: false; error: ExportError }` — `exportProject` never throws; all failures are typed. `outputFile` is the session-relative name of the final MP4 (left in the session dir), NOT its bytes — the native save path copies it to disk without pulling it into the renderer (2026-07-14 OOM-crash fix).
- `ExportErrorKind`: `ffmpeg_load | encode | concat | mux | asset_missing | unknown`.
- `ExportStage` union: `loading_ffmpeg | encoding_segment | muxing | done` — drives the progress modal via `useExport`.
- `FrameGlobalConfig` — carries `overlayConfig`, `hideAllText`, `globalOverlayFilter` into the renderer.

**Performance (post Phase 6.3.1):** macOS Intel (x86_64): ~10× realtime (120s for 12s of 1080p/30fps output). Windows: ~6× realtime (6 min per 1 min of video). macOS arm64: pending measurement. 4K untested. These figures predate the Tier 1 fast path (2026-07-02) and describe the full per-frame canvas pipeline — they still apply to composited segments, but plain segments (no caption/overlay/transition/filter/animation/speed change) now bypass this path entirely; measured 3m44s → 40s on a mixed 4-video/10-image project.

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

> Bug & task tracking lives in project-state.md (single source of truth). This file is architecture, conventions, and invariants only — for completed-work history, see `docs/history.md`.

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
