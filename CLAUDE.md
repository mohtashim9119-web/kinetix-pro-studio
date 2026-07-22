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
  App.tsx            # ~3,588 lines — top-level state, orchestration, playback, export.
                     #   The window keydown effect's Space branch guards on isTextEntryElement()
                     #   (not a generic tagName check) so a focused range slider no longer traps
                     #   spacebar play/pause; a global pointerup listener blurs any focused
                     #   <input type="range"> on release. +/- branches step the timeline zoom
                     #   sliderT by 0.1 (10 discrete steps, clamped). ArrowLeft/ArrowRight cycle
                     #   globalPlaybackSpeed via handleSpeedClick's 1→2→4→8→1 ladder (SpeedBadge.tsx),
                     #   clamped at both ends. F toggles fullscreen via previewStageRef.current
                     #   .toggleFullscreen() (PreviewStageHandle, exposed by PreviewStage.tsx's
                     #   forwardRef/useImperativeHandle). setGlobalPlaybackSpeed(1) resets on
                     #   project switch and New Project (three reset sites).
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
                     #   The preview stage wrapper div (around <PreviewStage>) keeps a dynamic
                     #   aspect ratio via an inline style (`style={{ aspectRatio:
                     #   aspectRatioToCss(project.aspectRatio ?? DEFAULT_ASPECT_RATIO) }}` +
                     #   bg-black, not the aspect-video utility class) — a same-day D11 "fix"
                     #   (2026-07-20) that removed the aspect ratio entirely to fill the panel was
                     #   reverted the same day (it stretched the preview when resizing the panel
                     #   divider); the actual fix instead changed media fit from object-cover to
                     #   object-contain across every preview path (PreviewStage.tsx's video/img
                     #   elements, PreviewCanvas.tsx's draw math, the GL compositor's BLIT shader via
                     #   useGlPreview.ts's computeObjectContainUvRect) so bg-black shows as
                     #   letterbox/pillarbox bars instead of cropping. Fullscreen's fill/crop behavior
                     #   is separate (PreviewStage's own isFullscreen branch) and is unaffected either
                     #   way. Export is unchanged — frameRenderer.ts still uses drawImageCover.
                     #   The D11 comment above originally said this hardcoded '16 / 9' value would
                     #   need to change "when a future project-level aspect-ratio field" arrived —
                     #   that field now exists (Project Settings + Aspect Ratio, 2026-07-22) and the
                     #   value is dynamic, per the updated line above. The preview's canvas backing
                     #   buffer (PreviewCanvas.tsx/useGlPreview.ts, threaded via PreviewStage.tsx's
                     #   nativeWidth/nativeHeight props) is derived the same way, from
                     #   previewNativeDimensions = resolveDimensions(project.aspectRatio ??
                     #   DEFAULT_ASPECT_RATIO, project.resolutionTier ?? DEFAULT_RESOLUTION_TIER)
                     #   (memoized on those two fields), replacing client-measured sizing.
                     #   NewProjectModal's onConfirm now also passes aspectRatio/resolutionTier;
                     #   handleNewProjectConfirm writes both onto the fresh Project (locked
                     #   aspectRatio forever, resolutionTier editable later). Two new modals are
                     #   mounted here: ProjectSettingsModal (showProjectSettingsModal state, a
                     #   button in the right panel) and ExportSettingsModal (showExportSettingsModal
                     #   state, opened by the Export button before the save-path dialog). Because
                     #   ExportSettingsModal's onContinue setState call and the subsequent
                     #   startExport() call would otherwise both read the useExport hook's
                     #   exportResolution/exportFps closure from the SAME render (stale — React
                     #   batches the setState), a small exportTriggerCount counter is bumped in
                     #   onContinue and a dedicated effect (dep [exportTriggerCount]) calls
                     #   startExport() on the NEXT render, once the hook has re-created with the
                     #   just-committed values.
                     #   sliderT (timeline zoom) is lazy-initialized from persisted UI state
                     #   (uiStateStore's kinetix:ui:v1) instead of a hardcoded 0.5, and a new effect
                     #   persists it on every change — so the reload-restored timelineScrollLeft
                     #   pixel value (Timeline.tsx) maps back to the same zoom level it was saved at.
                     #   The project-switch zoom-reset effect (keyed on project.id) gates on
                     #   isHydrating (hasSkippedHydrationResetRef), not a plain first-run guard — a
                     #   first-run guard is consumed by project.id's initial placeholder value and
                     #   still fires unguarded when the reload-hydration effect later swaps in the
                     #   real persisted project, clobbering the just-restored sliderT back to 0.5 on
                     #   every reload instead of only on a genuine user-initiated switch (D15 fix,
                     #   2026-07-20).
                     #   A "Cancel Export" button renders in the export progress panel alongside
                     #   the resolution/fps readout, wired to useExport.ts's cancelExport — no
                     #   local state, purely additive (docs/history.md -> "WebCodecs + WebGL2
                     #   Worker Export — Implementation Record").
  types.ts           # Shared interfaces: Project, VideoSegment, Asset, TextOverlay + enums.
                     #   SegmentGrade { brightness, contrast, saturation, temperature } — each
                     #   -1..1, 0 = neutral — plus VideoSegment.effectGrade?: SegmentGrade
                     #   (object-valued, mirrors overlayConfig?; undefined = never graded, which
                     #   is DISTINCT from an explicit neutral {0,0,0,0}). Deliberately declared
                     #   here rather than imported from services/gl so the dependency direction
                     #   stays services -> types. Carried across Apply Sync by unique-assetId
                     #   match alongside the other effect* fields (App.tsx's carry loop).
                     #   AspectRatio ('16:9'|'9:16'|'1:1') and ResolutionTier ('720p'|'1080p')
                     #   (Project Settings + Aspect Ratio, 2026-07-22) are plain string-literal
                     #   unions, not enums — matches the newer effectTransition/effectAnimation
                     #   slug fields rather than the legacy TransitionType/AnimationType enums.
                     #   Project gains optional aspectRatio/resolutionTier fields: aspectRatio is
                     #   locked at creation (NewProjectModal.tsx), never editable after, and absent
                     #   from Project Settings entirely; resolutionTier is set at creation but
                     #   editable later in ProjectSettingsModal.tsx. Both undefined on
                     #   pre-existing projects — treat as DEFAULT_ASPECT_RATIO/
                     #   DEFAULT_RESOLUTION_TIER (services/resolutionConfig.ts). The Project NEVER
                     #   stores width/height directly — pixel dimensions are always derived from
                     #   (aspectRatio, resolutionTier) via resolutionConfig.ts's resolveDimensions.
  constants.ts       # FONT_FAMILIES, FILTERS, TEXT_ANIMATIONS, TRANSITION_OPTIONS, ANIMATION_OPTIONS,
                     #   getFilterStyle, getMotionProps + dev-only console.assert guards
  effectsOptions.ts  # TRANSITIONS, ANIMATIONS, OVERLAYS option lists (shared source for EffectsPanel
                     #   dropdowns/randomize-pools — Effects Tab Rebuild Step 2) + NONE sentinels.
  services/
    assetStore.ts    # IndexedDB service: putAsset, getAsset, getAllAssets, deleteAsset, clearAllAssets
    projectStore.ts  # localStorage serializer: save/load/clear under key kinetix:project:v1
    resolutionConfig.ts # Project Settings + Aspect Ratio (2026-07-22) — the single source of truth
                     #   mapping (AspectRatio, ResolutionTier) -> pixel dimensions. Pure,
                     #   dependency-free, worker-safe (same pattern as zoomScale.ts below) —
                     #   imported by the preview path (PreviewCanvas.tsx, useGlPreview.ts via
                     #   PreviewStage.tsx, App.tsx) and the export pipeline alike (useExport.ts).
                     #   RESOLUTION_TABLE: Record<AspectRatio, Record<ResolutionTier,
                     #   FrameDimensions>> — TypeScript-exhaustiveness-checked (a missing ratio/tier
                     #   cell is a compile error, not a silent runtime gap). resolveDimensions(ratio,
                     #   tier) looks up the table; aspectRatioToCss(ratio) maps '16:9' -> '16 / 9'
                     #   for the preview wrapper's inline aspectRatio style.
                     #   DEFAULT_ASPECT_RATIO ('16:9') / DEFAULT_RESOLUTION_TIER ('1080p') are the
                     #   fallback for every project persisted before this feature existed —
                     #   resolves to 1920×1080, i.e. exactly pre-existing behavior, so migration is
                     #   invisible. Only 720p and 1080p tiers exist (all 6 combinations across the
                     #   3 aspect ratios); 4K/2K were deliberately removed from the UI and the type,
                     #   not merely left untested — see the DO NOT DO list. 12 unit tests in
                     #   resolutionConfig.test.ts assert all 6 (ratio, tier) -> dimension pairs,
                     #   aspectRatioToCss for all 3 ratios, and both defaults.
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
    waveformPeaks.ts # Pure peak-extraction + canvas-drawing primitives for the timeline voiceover
                     #   waveform (docs/history.md, "Waveform Rewrite — Implementation Record", archived).
                     #   PEAKS_PER_SECOND (100/sec — a
                     #   deliberately tuned permanent value confirmed 2026-07-20, see the constant's
                     #   own comment; was 10/sec until multi-tile rendering made the higher density
                     #   visible) peak extraction, plus drawWaveformRange (draws a [startTime, endTime) slice of
                     #   the waveform onto a canvas — the per-tile primitive behind
                     #   TimelineWaveform.tsx's multi-tile timeline waveform, each tile getting ~1
                     #   peak-column per backing pixel instead of the whole voiceover being collapsed
                     #   into one 16384px-capped canvas), drawFullWaveform (the ENTIRE waveform onto
                     #   one wide canvas — kept for its unit tests / as a single-tile reference, no
                     #   longer wired into the timeline), and the legacy drawSegmentWaveform
                     #   mirrored-fill routine (no longer wired into the timeline; kept for its unit
                     #   tests / pure geometry helpers). No decode — PCM arrives pre-decoded from
                     #   waveformPipeline.ts.
    waveformPipeline.ts # Chunked, yielding twin of waveformPeaks.ts's synchronous builder
                     #   (buildWaveformPipeline/buildSourceChunked) — spreads the ~60M-op peak
                     #   extraction across yields so a 21-min voiceover never blocks the main thread.
                     #   Called once from Apply Sync and the reload effect in App.tsx; never from a
                     #   render-triggered effect (that was the multi-minute freeze this rewrite fixed).
    waveformStore.ts # IndexedDB persistence for built WaveformSource peaks (DB kinetix-waveforms,
                     #   separate from assetStore's), keyed by [projectId, assetId] with the source
                     #   blob's byte size as an invalidation guard. Lets a reload of an unchanged
                     #   voiceover skip decode+peak-extraction entirely — canvas bitmaps/images are
                     #   still never persisted, only the small peaks array. Also owns peekWaveform()
                     #   (docs/history.md, "Waveform rendered-image caching," 2026-07-19 entry) — a small, global, content-addressed
                     #   (assetId+blobSize, not project-scoped) in-memory LRU mirror of recently
                     #   resolved WaveformSource records, populated by putWaveform and getWaveform
                     #   hits; App.tsx's pre-build identity gate reads it synchronously to skip a
                     #   redundant IndexedDB round-trip on a same-session project switch-back.
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
                     #   kill() (D13 fix, 2026-07-20) — invokes ffmpeg_kill_session; best-effort,
                     #   catch-and-warn like destroy(), must run BEFORE destroy() so the sidecar isn't
                     #   left writing into a session dir about to be deleted. Exposed to useExport.ts
                     #   via ffmpegBackend.ts's TauriBackend.cancel.
                     #   appendFileRaw(path, data) — WebCodecs export path only: same raw-body/
                     #   header transport as writeFileRaw, but invokes ffmpeg_append_file_raw
                     #   (OpenOptions::append, not truncating) so the export worker's streamed
                     #   EncodedVideoChunk bytes can land in one growing per-run .h264 file, one
                     #   append per chunk, caller-ordered.
                     #   countAnnexbFrames(path) — invokes ffmpeg_count_annexb_frames, a native
                     #   Rust NAL scanner that counts H.264 Annex B coded-picture units (type 1/5)
                     #   entirely on the Rust side (bounded 64 KB chunks, file bytes never cross
                     #   into the renderer). Backs exportPipelineWebCodecs.ts's post-concat
                     #   frame-count guard; replaced an earlier JS scan that cost ~5s per export
                     #   pulling the whole concatenated annexb file across IPC just to count frames.
    audioFormats.ts  # AUDIO_EXTENSIONS + isAudioFile(file) — voiceover-slot classifier (broad
                     #   extension list + audio/* MIME fallback). DropZonePanel.addFiles uses it;
                     #   files dropped ON the Voiceover slot that don't classify raise a slot error
                     #   instead of silently misrouting to the image-asset bucket.
    ffmpegBackend.ts # createTauriBackend() — creates TauriFfmpeg session, returns { ffmpeg, dispose,
                     #   saveOutputToDisk, cancel }. dispose() calls ffmpegDestroy to delete
                     #   $TMPDIR/kinetix-export-<uuid>/ after export. cancel() (D13 fix, 2026-07-20)
                     #   calls ffmpeg.kill() to kill the in-flight sidecar; useExport.ts's
                     #   cancelExport calls it BEFORE dispose().
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
                     #   ZOOM_IN/ZOOM_OUT cases compute scale via zoomScale.ts's computeZoomScale
                     #   (shared with the GL preview path) rather than a locally hardcoded rate.
    zoomScale.ts     # computeZoomScale({ rate, duration, elapsed, direction }) — the single formula
                     #   (Peak Scale = min(1.99, 1 + rate*duration), linear interpolation to/from it)
                     #   shared by the GL preview (gl/compositeParams.ts's resolveAnimScale) and the
                     #   canvas export path (canvasAnimations.ts) for the two zoom animations, closing
                     #   a prior duplicated-0.05-constant parity risk between the two renderers. Also
                     #   hosts computeMaxRate/sliderMaxRate/capRateForDuration — per-segment duration-
                     #   based caps on VideoSegment.effectAnimationScaleRate, feeding both the
                     #   EffectsPanel rate input's (type="number", not a range slider) live upper
                     #   bound and Apply-to-all's per-segment clamp.
    transitionResolver.ts # resolveEffectiveTransition(segment, options) — segment.transition (if set
                     #   and not NONE) else options.globalTransition else NONE; folds RETIRED_TRANSITIONS
                     #   (wipe, slide-push, glitch-rgb, whip-pan, zoom — slugs the GL engine never
                     #   implemented, retired at the Phase 5 cutover) to cross-dissolve so an
                     #   already-saved segment carrying one resolves identically in preview and export.
                     #   Also owns resolveTransitionProgress(boundaryTime, duration, currentTime) — the
                     #   shared centered-window (50/50 across the A/B boundary) progress math used by
                     #   gl/compositeParams.ts, segmentEncoder.ts, and (until its Phase 5 deletion) the
                     #   legacy useTransitionPreview.ts, so preview and export can't independently drift.
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
    webcodecsExport/ # WebCodecs+WebGL2 worker export path — the standalone design-plan doc was
                     #   archived and deleted once Step 9 (production-build verification) closed
                     #   it out (2026-07-22); full record: docs/history.md -> "WebCodecs + WebGL2
                     #   Worker Export — Implementation Record"). Main-thread orchestrator + worker-side
                     #   decode/composite/encode pipeline — an ADDITIVE sibling of the legacy
                     #   segmentEncoder.ts/exportPipeline.ts path above, gated by useExport.ts's
                     #   isWebCodecsExportGateOpen() (capability probe + persisted toggle,
                     #   defaults ON on every platform), NOT a replacement — the legacy path is
                     #   untouched and remains the fallback when the gate is closed.
      exportWorker.ts # Worker entry point — one GL-compositable RUN (a maximal contiguous span
                     #   of GL-eligible segments) per 'init' message: sequential decode
                     #   (sequentialDecode.ts) -> composite (GlCompositor/compositeParams.ts,
                     #   UNCHANGED — the real production preview classes, not a reimplementation)
                     #   -> text (textRenderer.ts) -> VideoEncoder (avc:{format:'annexb'},
                     #   backpressure-paced via encodeQueueSize/dequeue) -> stream each
                     #   EncodedVideoChunk's bytes to the main thread (zero-copy transfer) for
                     #   append-to-disk. Worker-safe: no React/DOM/window anywhere in its import
                     #   graph (traced import-by-import, see the file's own header).
      exportPipelineWebCodecs.ts # Main-thread orchestrator — ExportResult-compatible sibling of
                     #   ../exportPipeline.ts (never throws, same typed-error contract). Routes
                     #   every segment to a tier (Tier 1 plain video/image via ../plainSegment.ts
                     #   UNCHANGED, Tier GL via ./glCompositable.ts NEW, Tier C canvas fallback
                     #   via ../segmentEncoder.ts UNCHANGED), splits the routed timeline into
                     #   pieces (maximal contiguous GL runs — one worker call each, so a real
                     #   transition between two GL segments still renders as one continuous
                     #   encode; one piece PER SEGMENT for Tier 1/C, since both underlying
                     #   encoders are inherently single-segment), encodes each piece in order
                     #   (Tier 1/C pieces remuxed MP4->annexb via -bsf:v h264_mp4toannexb, GL
                     #   pieces streamed straight from the worker), concatenates every piece's
                     #   annexb in timeline order (ffmpeg concat protocol) -> video_all.h264,
                     #   verifies its actual coded-frame count (countAnnexbFrames, backed by the
                     #   Rust NAL scanner) against the summed expected count per piece — a typed
                     #   'concat' error, never a silently short/corrupt export, on mismatch — then
                     #   ./muxOnly.ts -> export_final.mp4. groupConnectedComponents (a tiny
                     #   Union-Find over segment array indices) closes a gap the plan's own
                     #   per-segment routing predicate alone can't: two segments individually
                     #   eligible for different tiers but joined by a real, non-zero-duration
                     #   GL-slug transition are unioned into one component, and the WHOLE
                     #   component downgrades to Tier C if ANY member is disqualified — otherwise
                     #   the transition could be silently dropped (if the GL run excluded its
                     #   partner) or double-rendered (if both sides independently tried to render
                     #   their own half). cancelExportWebCodecs() posts 'cancel' to the worker +
                     #   terminates it, then kills+destroys the ffmpeg session the worker was
                     #   streaming into — useExport.ts's cancelExport picks this sequence over the
                     #   legacy backend.cancel() via an activePathRef set fresh on every run.
      glCompositable.ts # isGlCompositableSegment(segment, neighbors) — conservative routing
                     #   predicate, sibling of ../plainSegment.ts, same philosophy: anything not
                     #   certain to be GL-expressible routes to the proven canvas path (Tier C).
                     #   A segment is GL-compositable only when its effective animation resolves
                     #   to zoom-in/zoom-out/none, it carries no color filter (segment/project
                     #   overlayFilter — the 24-filter CSS system), BOTH its transition edges
                     #   resolve to a GL slug (GL_TRANSITION_SLUGS) / hard-cut / zero-duration
                     #   no-op, and it resolves to a real video/image asset (exportWorker.ts has
                     #   no code path for a no-asset/audio-only segment — routing one into a GL
                     #   run would silently shorten that run's frame count). Text is deliberately
                     #   NOT checked here — textRenderer.ts renders all of it regardless of which
                     #   tier a segment's media/transition compositing lands in. Pure — no I/O,
                     #   DOM, or React — evaluated on the main thread by the orchestrator.
      sequentialDecode.ts # decodeSegmentFrames() — one dedicated VideoDecoder per call, no
                     #   pooling, no session/window concept — walks a GL run's source range
                     #   exactly once, start to end. Deliberately NOT a retrofit of
                     #   ../videoDecoderPool.ts (that module's windowed decode-ahead/LRU/handle-
                     #   reuse machinery exists for a scrubbable, randomly-seekable PREVIEW
                     #   timeline shared across many segments — export has none of those
                     #   requirements). Reuses getOrCreateDemux (../videoDemuxer.ts) for the chunk
                     #   list/decoder config and findChunkRange (../videoDecoderPool.ts) for
                     #   keyframe-backed range selection, both pure with respect to this file — no
                     #   shared mutable state crosses the boundary. DECODE_AHEAD_CAP=8 bounds
                     #   in-flight undelivered VideoFrames so decode can't race ahead of GL
                     #   upload+encode and accumulate unbounded live-frame GPU/CPU buffers.
                     #   Worker-safe (no DOM/React/window — only WebCodecs globals, identical on
                     #   self in a worker and window on the main thread).
      textRenderer.ts # GLTextRenderer — parity port of ../frameRenderer.ts's caption/overlay/
                     #   heading wrap/sizing/positioning math (byte-for-byte the same formulas,
                     #   read frameRenderer.ts end-to-end before touching this file) onto a
                     #   Canvas2D "atlas" (OffscreenCanvas, one per unique text config, bounded
                     #   LRU-cached — verified on the 500-segment fixture, Ctrl/Cmd+Shift+D dev
                     #   panel) that is then GPU-composited as an alpha-blended textured quad,
                     #   drawn AFTER GlCompositor's grade pass, instead of drawing straight into
                     #   the frame's own 2D context. The Path B heading's atlas is the one
                     #   exception — frame-sized, not bounding-box-sized, because its 90%-of-
                     #   frame wrap width and vertical centering are computed against the full
                     #   frame (matching drawHeadingLayerOverlay). Text is static — export has no
                     #   text animation today (TEXT_ANIMATIONS is preview-DOM-only) — so this is
                     #   parity, not a scope gap. Worker-safe (OffscreenCanvas + self.fonts, both
                     #   confirmed available in the real WKWebView worker by Step 0).
      fontResolver.ts # resolveFontBytes(usedFamilies) — parses the SAME Google Fonts CSS
                     #   @import src/index.css:1 loads into document.fonts (byte-identical URL,
                     #   fetched here instead), then fetches the actual font BYTES on the MAIN
                     #   THREAD and passes them into the worker as FontConfig.bytes. The worker
                     #   cannot build its own FontFace(url) — confirmed empirically to fail with a
                     #   NetworkError against fonts.gstatic.com from inside a real WKWebView
                     #   worker (CSP/network restriction); DO NOT revert to a URL-based FontFace
                     #   construction inside exportWorker.ts/textRenderer.ts. Non-fatal on
                     #   failure — a family that fails to parse/fetch falls back to a system font,
                     #   matching the preview path's own ensureFont fallback behavior.
      muxOnly.ts     # Two-step mux (design rationale: docs/history.md's implementation record), separately callable/
                     #   testable rather than inlined into exportPipelineWebCodecs.ts. Step 1
                     #   (buildVideoRemuxArgs): remuxes the raw annexb stream to MP4 using -r
                     #   <fps>, NOT the plan's originally-specified -framerate — -framerate only
                     #   affects ffmpeg -i's DISPLAYED r_frame_rate, not the per-packet duration
                     #   the mp4 muxer writes for PTS-less annexb packets; reproduced against the
                     #   bundled ffmpeg binary, a real VideoToolbox-encoded 300-frame/30fps stream
                     #   muxed with -framerate produced a 1.67s/179.97fps file, wrong by exactly
                     #   6x, while -r 30 produced the correct 10.00s/30fps file. Step 2
                     #   (buildAudioMuxArgs): muxes audio in a SEPARATE ffmpeg invocation from the
                     #   -r remux — combining -shortest with a still-PTS-less -c:v copy video
                     #   stream in ONE command silently drops audio entirely (reproduced: output
                     #   file size byte-identical with vs. without the audio input, despite
                     #   ffmpeg's own log showing the AAC encoder ran). Both steps tag
                     #   -colorspace/-color_primaries/-color_trc bt709 at mux time (Step 6 color-
                     #   space fix) — VideoFrame/VideoEncoder expose no colorSpace API for a
                     #   canvas-source frame (confirmed against MDN + a real TS overload-rejection
                     #   error), so the tag has to land here, mirroring segmentEncoder.ts's own
                     #   libx264 bt709 tagging on the legacy path; without it, preview-vs-export
                     #   color match was measured at 0.2%.
    lookPresetService.ts # Combined-look effect presets (Effects Tab Rebuild Step 7): localStorage
                     #   key kinetix:lookPresets:v1, global across projects, cap MAX_LOOK_PRESETS=20.
                     #   loadLookPresets/saveLookPreset/deleteLookPreset. saveLookPreset persists the
                     #   caller-supplied id as-is (no internal re-mint) so EffectsPanel's activeId stays
                     #   valid after the round-trip; same-id save is a no-op (returns the existing record,
                     #   no duplicate row). Deliberately separate from the legacy presetService.ts
                     #   (single-category StylePreset) — combined-look needs 3 slugs + 2 durations at once.
    uiStateStore.ts  # readUiState()/patchUiState() — centralized kinetix:ui:v1 read-merge-write;
                     #   single source for UI-state persistence (D6 fix). Generic key/value store —
                     #   keys currently include currentTime, selectedSegmentId, leftPanelCollapsed,
                     #   rightPanelCollapsed, previewHeight, activeLeftTab, timelineScrollLeft
                     #   (Timeline.tsx), and (D15 fix, 2026-07-20) sliderT — App.tsx lazy-inits
                     #   sliderT from `readUiState().sliderT` and persists it via
                     #   `patchUiState({ sliderT })` on every change, so the timeline zoom level
                     #   survives a reload alongside the scroll position it was saved at.
    gl/              # WebGL2 effects engine (full plan + verification record archived in
                     #   docs/history.md -> "WebGL2 Effects Engine — Full Plan, archived 2026-07-20").
                     #   Phase 5 cutover (commit 2015218) removed the dev gate — this is now the sole,
                     #   production-default preview path for the 4 scoped transitions, both zoom
                     #   animations, and color grading; isWebGL2Supported() survives only as a
                     #   diagnostic (drives a visible error surface on an unsupported runtime), not a
                     #   router to a second implementation.
      glContext.ts   # isWebGL2Supported() + context acquisition/loss-restore plumbing (preview,
                     #   on-screen canvas — untouched by the addition below).
                     #   acquireOffscreenGlContext(canvas, options) (WebCodecs export path,
                     #   see docs/history.md's implementation record) — additive sibling for the export
                     #   worker's OffscreenCanvas, `desynchronized: true` (measured ~12% speedup,
                     #   Step 8). Deliberately a SEPARATE function, not a widened
                     #   acquireGlContext: OffscreenCanvas fires the short-named
                     #   contextlost/contextrestored events, not the on-screen canvas's
                     #   webglcontextlost/webglcontextrestored — a signature-widening would wire
                     #   listeners that never fire. Its contextlost listener never calls
                     #   event.preventDefault(), which per spec GUARANTEES the browser never
                     #   fires contextrestored for that context — a hard fail by construction
                     #   (export worker context loss is a hard fail, never a silent
                     #   restore-and-continue), not a flag callers have to remember to check.
      uvRect.ts      # computeObjectCoverUvRect / computeObjectContainUvRect — moved verbatim out
                     #   of useGlPreview.ts (see docs/history.md's implementation record) so the WebCodecs
                     #   export worker (no DOM, cannot import a React hook module) can share the
                     #   same UV-fit math as the preview path. useGlPreview.ts re-exports both
                     #   names from this file so its existing public surface/importers (incl.
                     #   useGlPreview.test.ts) are unaffected. Export uses COVER (matching legacy
                     #   export's drawImageCover), not the preview path's CONTAIN (D11) — a
                     #   deliberate, explicit choice (plan §4.5), not an oversight.
      shaders.ts     # GLSL ES 3.0 sources (blit, cross-dissolve, dip, light-leak, zoom, grade) +
                     #   u_texRectA/B UV-fit uniforms — BLIT (the only shader ever given a
                     #   non-identity u_texRectA) now does object-CONTAIN, not cover (D11 fix,
                     #   2026-07-20, driven by useGlPreview.ts's computeObjectContainUvRect), with
                     #   an explicit out-of-[0,1]-uv check that paints black instead of letting
                     #   CLAMP_TO_EDGE stretch the source into the letterbox/pillarbox bars. DO NOT
                     #   change this math without re-running the real-GPU pixel checks — see the
                     #   file's own header.
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
    useGlPreview.ts          # WebGL2 preview driver (docs/history.md -> "WebGL2 Effects Engine — Full
                             #   Plan, archived 2026-07-20", Section 3.2/6) —
                             #   per-tick: derive params (compositeParams.ts) → source each slot from
                             #   the WebCodecs decode pool → upload directly to GPU texture → render.
                             #   New computeObjectContainUvRect (D11 fix, 2026-07-20) sits alongside the
                             #   existing computeObjectCoverUvRect — uploadSlot's per-tick texRect now
                             #   uses the contain variant so the GL preview letterboxes/pillarboxes like
                             #   the other preview paths instead of cropping; export (frameRenderer.ts's
                             #   drawImageCover) still uses cover and is untouched. The contain rect's
                             #   uOffset/uScale intentionally push uvA outside [0,1] for the bar region —
                             #   shaders.ts's BLIT fragment shader paints that black explicitly.
                             #   Now takes isFullscreen: boolean in its params, added to the per-tick
                             #   render effect's dep array so the canvas backing buffer re-measures on
                             #   fullscreen transitions (fixes a stretched preview when entering
                             #   fullscreen while paused — tick-driven resize logic otherwise never
                             #   re-ran until the next currentTime change).
                             #   computeObjectCoverUvRect/computeObjectContainUvRect no longer defined
                             #   here — moved verbatim to services/gl/uvRect.ts (see docs/history.md's
                             #   implementation record — so the WebCodecs export worker can import the same UV-fit math
                             #   without pulling in a React hook module) and re-exported from this file
                             #   so its public surface (and useGlPreview.test.ts) is unchanged.
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
                             #   cancelExport (D13 fix, 2026-07-20) calls TauriBackend.cancel() — which
                             #   invokes the Rust ffmpeg_kill_session command via TauriFfmpeg.kill() — BEFORE
                             #   teardown(), so the in-flight ffmpeg sidecar is killed before its session
                             #   temp dir is deleted, instead of running to completion/error against an
                             #   already-gone directory.
                             #   WebCodecs export gate (full
                             #   record: docs/history.md -> "WebCodecs + WebGL2 Worker Export —
                             #   Implementation Record"). isWebCodecsExportCapable() — memoized
                             #   probe (VideoEncoder/VideoDecoder/EncodedVideoChunk + isWebGL2Supported()
                             #   + a module-Worker construction probe). isWebCodecsExportToggleOn()/
                             #   setWebCodecsExportToggle() — persisted user choice in uiStateStore
                             #   under 'webcodecsExportEnabled', DEFAULTS ON for any user who has never
                             #   touched it (macOS Intel verified, incl. production build per Step 9,
                             #   2026-07-22; arm64/Windows unverified but accepted risk — cross-platform
                             #   validation is the only remaining gap). isWebCodecsExportGateOpen() — capability
                             #   AND toggle both required; runExport decides fresh every run and routes
                             #   to exportProjectWebCodecs (services/webcodecsExport/
                             #   exportPipelineWebCodecs.ts) instead of the legacy exportProject when
                             #   open — byte-identical to pre-gate behavior when closed (same args,
                             #   same onProgress shape). activePathRef records which path the current/
                             #   most-recent run used so cancelExport can pick the matching cancel
                             #   sequence: cancelExportWebCodecs() (posts 'cancel' to the worker +
                             #   terminates it, then kills+destroys the ffmpeg session) for the
                             #   WebCodecs path, vs. the pre-existing backend.cancel() for legacy —
                             #   teardown() runs after either, idempotently.
                             #   ExportResolution (Project Settings + Aspect Ratio, 2026-07-22) is
                             #   now a type alias for the shared ResolutionTier ('720p'|'1080p',
                             #   services/resolutionConfig.ts) — the old `'1080p' | '4k'` union is
                             #   gone. runExport derives { width, height } via
                             #   resolveDimensions(snap.aspectRatio ?? DEFAULT_ASPECT_RATIO,
                             #   resolution) instead of a hardcoded ternary — the only place export
                             #   pixel dimensions are decided.
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
    DropZonePanel.tsx  # Left-panel host with the Script/Assets/Editor/Effects tabs. The Effects
                     #   tab mounts only EffectsPanel.tsx and owns lookPresetService persistence —
                     #   it no longer holds any settings sections. The former standalone
                     #   SettingsPanel.tsx's controls (global aesthetics, export quality
                     #   resolution/fps, JSON import/export, "New Project" reset) had lived inline
                     #   here since the pre-WebGL2 layout redesign (SettingsPanel.tsx tombstoned,
                     #   see docs/history.md), then the WebCodecs export toggle joined them
                     #   (see docs/history.md's implementation record) — but Project Settings + Aspect Ratio
                     #   Step 6 (2026-07-22) deleted all three sections (Export Quality, Export
                     #   Engine, Display/Text-Overlay-default) and their supporting local state/
                     #   props from this file entirely, relocating them into ProjectSettingsModal.tsx
                     #   and ExportSettingsModal.tsx (see those files' entries below). Nothing in
                     #   this file reads or writes `webcodecsExportEnabled`/`exportResolution`/
                     #   `exportFps`/`onSetAllOverlay` anymore.
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
    ExportSettingsModal.tsx # Export-time settings dialog (Project Settings + Aspect Ratio, export-
                     #   settings amendment, 2026-07-22) — resolution + fps are chosen HERE, at
                     #   export time, not in Project Settings — the industry-standard pattern
                     #   (matches Premiere/Resolve/Final Cut). App.tsx's Export button opens this
                     #   modal first; its Continue commits the draft resolution/fps back into
                     #   App.tsx's existing exportResolution/exportFps state (via
                     #   exportTriggerCount, see App.tsx's entry below) and proceeds to the
                     #   save-path dialog + export run. Cancel/Escape discard the draft, no export
                     #   triggered. Draft state is seeded from the current exportResolution/
                     #   exportFps so the last export's choice is remembered. Same blocking-modal
                     #   shell as ProjectSettingsModal.tsx (no backdrop-close, Escape = Cancel).
                     #   Shows derived dimensions (via resolutionConfig.ts's resolveDimensions)
                     #   and, when mixedNativeFpsWarning is true, an amber note that staged videos
                     #   have different native frame rates and the fps won't be auto-set.
    NewProjectModal.tsx # New Project dialog. Beyond the project-name field, now also collects
                     #   aspect ratio (3-way segmented control, 16:9/9:16/1:1, locked forever once
                     #   created — Project Settings + Aspect Ratio Step 3, 2026-07-22) and native
                     #   resolution tier (a <select> offering 720p/1080p whose option labels show
                     #   derived dimensions for the currently-selected ratio via resolutionConfig.ts's
                     #   resolveDimensions, e.g. "1080p — 1080 × 1920" under 9:16). Both tiers are
                     #   always offered for every ratio — only the derived dimensions shown change.
                     #   onConfirm signature widened to (name, aspectRatio, resolutionTier);
                     #   App.tsx's handleNewProjectConfirm writes both onto the fresh Project
                     #   before confirming it. Defaults: '16:9' / '1080p' (DEFAULT_ASPECT_RATIO /
                     #   DEFAULT_RESOLUTION_TIER from resolutionConfig.ts) — matches every
                     #   pre-existing project's effective resolution, so migration is invisible.
    PreviewCanvas.tsx     # Minimal canvas paint surface for the WebCodecs preview path — draws
                     #   whatever VideoFrame useWebCodecsPreview.ts hands it, object-contain fit
                     #   (D11 fix, 2026-07-20 — was object-cover; the whole frame now fits inside
                     #   the canvas, letterboxed/pillarboxed on whichever axis doesn't match, with
                     #   clearRect's transparent margin reading as black against the stage's
                     #   bg-black). Export's own cover-fill pipeline (frameRenderer.ts's
                     #   drawImageCover) is untouched.
                     #   Takes an optional isFullscreen?: boolean prop, added to the draw
                     #   effect's dep array (same stretch fix as useGlPreview.ts, on the fallback
                     #   non-GL path) so the canvas re-measures on fullscreen transitions.
                     #   Backing-buffer `width`/`height` props (Project Settings + Aspect Ratio
                     #   Step 2, 2026-07-22) are now the project's NATIVE resolution — derived via
                     #   resolutionConfig.ts's resolveDimensions(project.aspectRatio,
                     #   project.resolutionTier) and threaded from App.tsx/PreviewStage.tsx as
                     #   nativeWidth/nativeHeight — instead of being measured from
                     #   canvas.clientWidth/clientHeight every frame. The object-contain fit math
                     #   (canvasRatio vs. frameRatio) is unchanged; only the source of the
                     #   backing-buffer size changed, so it now compares against the project's real
                     #   aspect ratio rather than whatever size the panel happens to be measured at.
    PreviewStage.tsx      # Video/image display + overlay rendering. Dual-slot video-swap seek
                     #   effect (~line 449, dep [currentSegment?.id]) skips reseeking while
                     #   isResizingRef.current is true — currentSegment can flip transiently
                     #   during a timeline resize-drag; guard prevents an unwanted reseek to the
                     #   wrong segment's start (D12 fix, commit be45b07).
                     #   Media fit changed from object-cover to object-contain on every element
                     #   here (both <video> slots, the static-image <img>, the motion.img) —
                     #   D11 fix, 2026-07-20 — so the whole frame fits inside the stage's aspect-
                     #   ratio wrapper div (App.tsx) instead of cropping; letterbox/pillarbox bars
                     #   show as bg-black. That wrapper's ratio is dynamic since Project Settings +
                     #   Aspect Ratio Step 2 (2026-07-22) — aspectRatioToCss(project.aspectRatio),
                     #   not a hardcoded 16:9 — so this fit behavior now also applies correctly to
                     #   9:16 and 1:1 projects. Fullscreen's own fill/crop behavior (the
                     #   isFullscreen branch) is untouched.
                     #   Takes nativeWidth/nativeHeight props (Project Settings + Aspect Ratio
                     #   Step 2) — the project's derived native resolution — and threads them into
                     #   useGlPreview/PreviewCanvas as their canvas backing-buffer size, replacing
                     #   client-measured sizing on those paths.
                     #   Now a forwardRef component exporting a PreviewStageHandle interface
                     #   ({ toggleFullscreen: () => void }) via useImperativeHandle — App.tsx holds
                     #   previewStageRef and calls it from the F-key branch. toggleNativeFullscreen
                     #   uses Tauri's getCurrentWindow().setFullscreen() (not the browser Fullscreen
                     #   API, which silently fails in the Tauri WebView shell), with the browser API
                     #   kept as a dev-preview fallback; an onResized listener syncs isFullscreen
                     #   state when the user exits via OS controls (Escape, macOS traffic-light)
                     #   that bypass the app's own handler. restoreWebViewFocus() restores keyboard
                     #   focus after any fullscreen-exit path (Tauri getCurrentWebview().setFocus()
                     #   + getCurrentWindow().setFocus() + DOM window/body/#root focus fallbacks) —
                     #   without it, keys reach the OS window but not the embedded WebView post-exit.
                     #   Floating controls (play/pause + SpeedBadge + Esc hint) render when
                     #   isFullscreen. isFullscreen is also passed to useGlPreview and PreviewCanvas
                     #   so their canvas backing buffer re-measures on fullscreen transitions even
                     #   while paused (fixes a stretched-preview bug on paused fullscreen entry).
                     #   New props: onTogglePlay, onSpeedCycle.
    ProjectDashboard.tsx  # Full-screen project picker/grid (opened when no project is confirmed,
                     #   or via a "Projects" entry point). Bulk Select + Delete Projects
                     #   (2026-07-22, self-contained — no App.tsx or service changes): per-card
                     #   hover checkbox (top-left, always visible once selected, `ring-2
                     #   ring-blue-500` highlight on the card) with stopPropagation so a checkbox
                     #   click doesn't also open the project; header gains a "Select All"/"Deselect
                     #   All" toggle button (filter-respecting — operates on `visibleIds`, the
                     #   currently-searched/filtered set, not every project) and a "Delete Selected
                     #   (N)" button (disabled at N=0) that opens a confirm dialog distinct from the
                     #   existing single-project delete confirm. Confirming calls
                     #   handleBulkDelete(), which sequentially awaits deleteAllAssets +
                     #   deleteAllWaveforms + deleteProjectData per selected id (same three calls
                     #   the existing single-delete handleDelete already made, just looped), then
                     #   clears selectedIds and refreshes the metas list. Selection state
                     #   (selectedIds: Set<string>, showBulkConfirm) is local, not persisted —
                     #   resets on remount.
    ProjectSettingsModal.tsx # Project Settings modal (Project Settings + Aspect Ratio Steps 1-6,
                     #   2026-07-22) — a blocking, draft-then-commit dialog opened from a button in
                     #   the right panel (App.tsx), pulling the Export Engine (WebCodecs toggle) and
                     #   Text Overlay (segments-default showOverlay cascade) sections OUT of the
                     #   Effects tab (DropZonePanel.tsx), plus a new Project section: the project's
                     #   native resolution TIER (a <select>, editable) with derived dimensions shown
                     #   as read-only helper text, and the locked aspect ratio (display only, never
                     #   an input — "Aspect ratio is locked at project creation"). Export Quality
                     #   (resolution/fps) is deliberately NOT here — Feature 2's amendment moved
                     #   that to ExportSettingsModal.tsx, chosen at export time instead. All edits
                     #   are local draft state (draftNativeTier/draftWebcodecsEnabled/
                     #   draftOverlayOn) committed atomically on Save via onResolutionTierChange/
                     #   setWebCodecsExportToggle/onSetAllOverlay; Cancel/Escape discard everything
                     #   (no backdrop-click-to-close, matching NewProjectModal's precedent).
    SegmentEditorPanel.tsx # Segment list + per-segment controls
    TimelineWaveform.tsx   # useTimelineWaveform hook — the TILED voiceover waveform (replaced the
                     #   earlier single-canvas approach, which collapsed the whole voiceover into one
                     #   canvas capped at 16384px — on long audio at high zoom that averaged many
                     #   peak columns into a single pixel, discarding density PEAKS_PER_SECOND
                     #   provides). Splits the current-zoom timeline width into multiple tiles, each
                     #   ≤16384px (device px, DPR-scaled) and drawn via drawWaveformRange
                     #   (services/waveformPeaks.ts) onto its own off-screen canvas, snapshotted to
                     #   its own blob: URL — every tile individually gets ~1 peak-column per backing
                     #   pixel, true 1:1 fidelity at any zoom level. Returns { tiles, isReady } where
                     #   tiles: { url, startTime, endTime, width }[]. Rebuild is debounced 200ms
                     #   (REDRAW_DEBOUNCE_MS) and re-runs on waveformSource or current-zoom
                     #   (pixelsPerSecond) change; a change mid-rebuild is handled via a cancelled
                     #   flag so a stale Promise.all resolution can't clobber a newer one. Revokes
                     #   all prior tile blob URLs on rebuild/unmount. Replaced the 294 per-segment
                     #   SegmentWaveform components (each an IndexedDB image-cache lookup + blob URL
                     #   + independent setState) whose fan-out was the ~4s reload delay —
                     #   docs/history.md.
    SpeedBadge.tsx     # Compact pill button showing playback speed (1×/2×/4×/8×). Exports
                     #   SPEED_LADDER = [1,2,4,8] and SpeedBadge({ speed, onCycle }). Click on the
                     #   badge wraps 1→2→4→8→1. Used in the App.tsx play/pause pill and in
                     #   PreviewStage's fullscreen floating controls.
    StockSearchModal.tsx  # Pexels/Pixabay search modal — lazy-loaded via React.lazy
    SyncLoadingOverlay.tsx # Full-screen blocking overlay, shown ONLY while a fresh Apply Sync runs
                     #   (isProcessing) — its sole prop. No waveform-ready gating (removed when the
                     #   waveform collapsed to a single instant canvas), so it never appears on a
                     #   plain project reload/open. Shows one non-technical message ("Preparing your
                     #   project…") + spinner; hides the instant isProcessing clears.
    Timeline.tsx          # Scrollable track + playhead + zoom. Each segment row's onClick calls
                     #   onSeek(s.startTime) directly — this is the element the D12 ghost-click
                     #   fix (App.tsx handleUp) guards against: a left-edge resize-drag ends with
                     #   the cursor far from the (fixed-position) left handle, so the browser's
                     #   native click synthesized right after mouseup lands on this row's body
                     #   instead of the handle, firing an unwanted seek (fixed in be45b07).
                     #   Both track rows carry data-seg-id={s.id} so App.tsx's drag handler can
                     #   write live width directly to the DOM during a resize (commit f4da926).
                     #   The voiceover waveform is a single SHARED lane (not per-segment): it calls
                     #   useTimelineWaveform (TimelineWaveform.tsx) to get an array of tiles, each
                     #   ≤16384px, and lays them all out as CSS multi-background layers on one
                     #   absolutely-positioned div spanning the full timeline width — backgroundImage/
                     #   backgroundPosition/backgroundSize are comma-separated lists, one entry per
                     #   tile, tile position = tile.startTime * pixelsPerSecond. Segment cells render
                     #   on top with only their own border/active-highlight, no background image of
                     #   their own. The waveform lane carries NO data-seg-id and no resize handles,
                     #   and is pointer-events-none (purely visual).
                     #   The reload scroll restore is a one-shot effect gated behind a
                     #   didRestoreRef, deferred until containerWidth's ResizeObserver first fires
                     #   (real pixelsPerSecond, not the 800px zoom fallback) — restoring earlier let
                     #   the browser clamp scrollLeft to 0, then two auto-scroll effects (segment-
                     #   follow, zoom-center) would re-scroll shortly after, producing a visible
                     #   "0 then scroll" flash. Both auto-scroll effects check didRestoreRef before
                     #   running (fixed in 34206ee, on top of the fb6abbb useLayoutEffect timing fix).
                     #   Receives `globalPlaybackSpeed` prop but does not use it (dead prop, kept for now).
  index.css          # Tailwind base + custom scrollbar
  main.tsx           # React entry point.
index.html           # Title: "Kinetix Pro Studio"
vite.config.ts       # Vite config — plugins (react, tailwindcss) + path alias. COOP/COEP removed (Phase 6.4).
public/
  _headers           # Cloudflare Pages headers. COOP/COEP removed in Phase 6.4 (no longer needed without wasm).
src-tauri/
  Cargo.toml         # Rust deps: tauri 2.x, tauri-plugin-shell, tauri-plugin-log, rfd, base64, uuid
  tauri.conf.json    # productName, bundle.externalBin: ["binaries/ffmpeg"], devUrl, beforeDevCommand
  capabilities/
    default.json     # core:default + shell:allow-execute { name: "ffmpeg", sidecar: true } +
                     #   core:window:allow-set-fullscreen + core:webview:allow-set-webview-focus
                     #   (fullscreen feature — neither is in core:default; PreviewStage.tsx's
                     #   toggleNativeFullscreen and restoreWebViewFocus need them).
  src/
    lib.rs           # Tauri Builder — registers tauri_plugin_shell, invoke_handler for all IPC commands
                     #   (18 total: 15 in ffmpeg.rs + 2 in whisper.rs + fetch_url_bytes here). Also
                     #   `.manage(ffmpeg::FfmpegProcessState::default())` (D13 fix, 2026-07-20) — shared
                     #   Mutex<HashMap<session_id, CommandChild>> app state ffmpeg_exec/ffmpeg_kill_session
                     #   use to track/kill the in-flight sidecar.
                     #   fetch_url_bytes: proxy for stock CDN CORS bypass (returns base64).
    ffmpeg.rs        # 15 Tauri commands: create_session, write_file (b64), write_file_raw (raw-body,
                     #   no base64 — added 2026-07-09, session id + path travel as request headers),
                     #   append_file_raw (WebCodecs export path, see docs/history.md's implementation
                     #   record — OpenOptions::append(true).create(true) instead of write_file_raw's truncating
                     #   fs::write, so the export worker's streamed annexb chunks land in one growing
                     #   per-run file), read_file, count_annexb_frames (WebCodecs export path — counts
                     #   H.264 Annex B coded-picture NAL units, type 1/5, in bounded 64 KB chunks entirely
                     #   on the Rust side; backs exportPipelineWebCodecs.ts's post-concat frame-count
                     #   guard, replacing a JS readFile+scan that cost ~5s per export moving the whole
                     #   file's bytes over IPC just to count frames), delete_file, exec (sidecar),
                     #   kill_session (new, D13 fix, 2026-07-20 —
                     #   see below), destroy_session, pick_save_path,
                     #   save_session_file (native fs::copy of a finished
                     #   session file to a user path — no bytes through the renderer; added 2026-07-14
                     #   to fix the large-export STATUS_BREAKPOINT OOM crash), probe_audio_duration,
                     #   probe_video_fps, reveal_in_finder.
                     #   Session-scoped temp dirs ($TMPDIR/kinetix-export-<uuid>/); path traversal
                     #   validation (write_file_raw/append_file_raw both validate the header-supplied
                     #   path the same way write_file does).
                     #   probe_audio_duration: runs `ffmpeg -i <file>` (no ffprobe binary bundled),
                     #   parses `Duration:` from stderr — replaces the WebView <audio> duration probe
                     #   (codec-dependent, silent 60s fallback); throws on failure, no fake duration.
                     #   exec now uses tauri-plugin-shell's spawn() (not output()) so its CommandChild
                     #   handle can be stored in FfmpegProcessState for the run's duration — output()
                     #   blocked until completion with no killable handle, so the old export-cancel path
                     #   only deleted the session dir while the sidecar kept running against it (D13).
                     #   kill_session removes+kills the stored child for a session_id; a no-op (not an
                     #   error) when nothing is running for it. Called by useExport.ts's cancelExport
                     #   (via TauriFfmpeg.kill()) BEFORE destroy_session.
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
  aspectRatio?    — '16:9' | '9:16' | '1:1' (Project Settings + Aspect Ratio, 2026-07-22) — locked
                    at creation via NewProjectModal, never editable after; undefined on
                    pre-existing projects, treat as DEFAULT_ASPECT_RATIO ('16:9')
  resolutionTier? — '720p' | '1080p' — set at creation, editable later in ProjectSettingsModal;
                    undefined on pre-existing projects, treat as DEFAULT_RESOLUTION_TIER ('1080p').
                    Neither field stores pixel dimensions directly — width/height are always
                    derived via services/resolutionConfig.ts's resolveDimensions(aspectRatio, tier)
}
```

`parseProjectData()` is the core sync engine — parses sceneDetails, fuzzy-matches asset names, distributes voiceover duration proportionally by character count. `[HEADING:]` tags are recognized only as scene boundaries — recognize-and-skip, no segment materialized (Step 5, 5.4); headings live solely in the segments array. Still defined in `src/App.tsx` — only the fuzzy-matching and anchor-timing helpers (`isFuzzyMatch`, `findAssetByContext`, `applyAnchorBasedTiming`, the heading-anchor helpers) have been extracted to `src/services/syncEngine.ts`.

Playback uses a ~16ms requestAnimationFrame loop when a voiceover is loaded; `currentSegment` is derived from `currentTime` via `useMemo`.

Export: see **Export Pipeline** section below. MediaRecorder removed in Phase 3. As of 2026-07-22, export runs through one of two gated paths decided fresh on every run by `useExport.ts`'s `isWebCodecsExportGateOpen()` — the new WebCodecs+WebGL2 worker path (default ON) or the legacy canvas/ffmpeg path (fallback) — see the **WebCodecs + WebGL2 Worker Export Path** subsection below. Export resolution/fps are chosen at **export time** via `ExportSettingsModal.tsx` (opened first when the user clicks Export), not stored as project settings — see **Export Pipeline** below and the Project Settings + Aspect Ratio / Export Settings dialog write-up in `docs/history.md`.

### Persistence Model

localStorage (key `kinetix:project:v1`, versioned for future migrations) holds the JSON project state with asset `url` and `file` fields stripped — blob URLs are ephemeral and cannot survive a reload. IndexedDB (`kinetix-assets` database, `assets` object store, keyPath `id`) holds the raw blobs keyed by asset id. On app load, the mount effect in `App.tsx` reads localStorage first; if a saved project exists, it fetches all blobs from IndexedDB, builds a `Map<id, StoredAsset>`, and reconstructs each asset's `url` via `URL.createObjectURL(blob)`. Assets whose id is in localStorage but whose blob is missing from IndexedDB are dropped with a `console.warn`, and any segment `assetId` or top-level `voiceoverId` referencing a dropped asset is set to `undefined` — the segment itself is preserved so the timeline is not disturbed. Any future code that **adds** an asset to `project.assets` MUST call `putAsset` before setting project state (if `putAsset` throws, do not add the asset — a phantom asset that vanishes on reload is worse than no asset). Any future code that **removes** an asset MUST call `deleteAsset` and `URL.revokeObjectURL` after the state update.

### Export Pipeline

**Desktop-only (Tauri app required).** No `crossOriginIsolated` requirement — ffmpeg.wasm removed in Phase 6.4. Export uses the native ffmpeg sidecar bundled in `src-tauri/binaries/` (gitignored; see `binaries/README.md` for re-provisioning on a fresh checkout).

**Export-time settings dialog (2026-07-22 amendment):** clicking Export first opens `ExportSettingsModal.tsx` (resolution + fps, seeded from the current `exportResolution`/`exportFps` state) — the industry-standard pattern (Premiere/Resolve/Final Cut choose export quality at export time, not as a project-wide setting). Continue commits the draft back into `App.tsx`'s existing state and proceeds to the `pick_save_path` dialog below; Cancel/Escape aborts with no export triggered. This is a UI relocation only — resolution/fps were already session-level `App.tsx` state before this amendment (previously edited inline in the Effects tab, then in `ProjectSettingsModal.tsx`'s now-removed Export Quality section); the export pipeline itself, and the `{ width, height, fps }` options shape passed into it, are unchanged. Width/height for the chosen resolution tier are derived from `resolutionConfig.ts`'s `resolveDimensions(project.aspectRatio ?? DEFAULT_ASPECT_RATIO, resolution)` inside `useExport.ts`'s `runExport` — not a hardcoded 1920×1080/3840×2160 ternary.

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
- `FrameGlobalConfig` (`frameRenderer.ts:8-15`) — carries `overlayConfig`, `globalOverlayFilter`, `globalTextLayers`, and `headings` into the renderer. (Corrected 2026-07-22: an earlier revision of this note listed a `hideAllText` field that has never existed on this interface — read the type directly if this list ever needs re-verifying.)

**Performance (post Phase 6.3.1):** macOS Intel (x86_64): ~10× realtime (120s for 12s of 1080p/30fps output). Windows: ~6× realtime (6 min per 1 min of video). macOS arm64: pending measurement. (4K is no longer a resolution option at all as of Project Settings + Aspect Ratio — see the DO NOT DO list — so there is nothing to measure there; only 720p/1080p exist.) These figures predate the Tier 1 fast path (2026-07-02) and describe the full per-frame canvas pipeline — they still apply to composited segments routed through this legacy path (or its Tier 1 fast path), but as of 2026-07-22 this is no longer the export default — see the WebCodecs export path below, now gated on by default. Plain segments (no caption/overlay/transition/filter/animation/speed change) bypass this legacy path's per-frame pipeline entirely regardless of which export path is active; measured 3m44s → 40s on a mixed 4-video/10-image project under the legacy path.

### WebCodecs + WebGL2 Worker Export Path (default since 2026-07-22)

**Additive sibling of the legacy pipeline above, not a replacement.** Gated by `useExport.ts`'s `isWebCodecsExportGateOpen()` — a runtime capability probe (`VideoEncoder`/`VideoDecoder`/`EncodedVideoChunk`, `isWebGL2Supported()`, module-Worker construction) AND a persisted user toggle (`ProjectSettingsModal.tsx`'s Export Engine section — relocated here from `DropZonePanel.tsx`'s Effects tab by Project Settings + Aspect Ratio Step 6, 2026-07-22; same persisted key, same gate logic, only the UI location moved), both required. **The toggle defaults ON for every platform** (a deliberate decision — see `docs/history.md` → "WebCodecs + WebGL2 Worker Export — Implementation Record"), so this is now the export path most users hit; when the gate is closed (unsupported runtime, or the user switches it off) the legacy pipeline above runs byte-identical to before the gate existed. Full architecture, invariants, and the step-by-step build record now live entirely in `docs/history.md`'s implementation-record section (steps 1-9, all done — the standalone plan doc was archived and deleted once Step 9's production-build verification closed it out, 2026-07-22).

Full chain, left to right:

```
useExport.ts runExport()  — isWebCodecsExportGateOpen() ? webcodecs : legacy
  │
  └─ exportPipelineWebCodecs.ts  exportProjectWebCodecs(project, tauriFfmpeg, options, onProgress)
        │
        ├── ROUTE every segment to a tier:
        │     Tier 1 (plainSegment.ts, UNCHANGED)   — plain video/image, ffmpeg direct
        │     Tier GL (glCompositable.ts, NEW)       — GL-expressible (4 transitions, 2 zooms,
        │                                              grade, no color filter)
        │     Tier C (segmentEncoder.ts, UNCHANGED)  — everything else (canvas fallback)
        │     groupConnectedComponents unions segments joined by a real GL-slug transition so a
        │     mixed-eligibility pair can't have its transition silently dropped or double-rendered.
        │
        ├── SPLIT into pieces: maximal contiguous Tier-GL runs (one worker call each — a real
        │     transition between two GL segments still encodes as one continuous run); one piece
        │     PER SEGMENT for Tier 1/C.
        │
        ├── for each Tier-GL piece:  →  exportWorker.ts (dedicated Worker, one 'init' per run)
        │       ├─ DECODE    sequentialDecode.ts — one dedicated VideoDecoder per segment, walks
        │       │             the run's source range once, DECODE_AHEAD_CAP=8
        │       ├─ COMPOSITE compositeParams.ts + GlCompositor (BOTH UNCHANGED — the same classes
        │       │             the WebGL2 preview uses) upload to an OffscreenCanvas GL context
        │       │             (glContext.ts's acquireOffscreenGlContext, desynchronized:true)
        │       ├─ TEXT      textRenderer.ts's GLTextRenderer — Canvas2D atlas → GPU quad, parity
        │       │             port of frameRenderer.ts's caption/overlay/heading math
        │       ├─ ENCODE    VideoEncoder, avc:{format:'annexb'}, backpressure-paced
        │       └─ STREAM    each EncodedVideoChunk's bytes transferred (zero-copy) to the main
        │                     thread, appended via TauriFfmpeg.appendFileRaw → IPC
        │                     ffmpeg_append_file_raw → run_K.h264 in the session dir
        │
        ├── for each Tier 1/C piece: existing encoder (ffmpeg direct-trim / segmentEncoder.ts) →
        │     remux MP4→annexb via `-bsf:v h264_mp4toannexb` (same annexb format as the GL pieces)
        │
        ├── CONCAT every piece's annexb, timeline order (ffmpeg concat protocol) → video_all.h264
        │
        ├── GUARD: TauriFfmpeg.countAnnexbFrames (IPC ffmpeg_count_annexb_frames, a native Rust
        │     NAL scanner — bounded 64 KB chunks, file bytes never cross into the renderer) vs.
        │     the summed expected frame count across all pieces → typed 'concat' ExportError on
        │     mismatch, never a silently short/corrupt export
        │
        ├── MUX (muxOnly.ts): buildVideoRemuxArgs (-r <fps>, NOT -framerate) then, in a SEPARATE
        │     ffmpeg invocation, buildAudioMuxArgs (never combine -shortest with a still-PTS-less
        │     -c:v copy stream — silently drops audio) → export_final.mp4, both steps tagging
        │     -colorspace/-color_primaries/-color_trc bt709 at mux time
        │
        └── same save path as legacy: TauriBackend.saveOutputToDisk → native save_session_file
              copy → user's chosen path; bytes never enter the renderer either way.
```

**Cancel:** `useExport.ts` tracks which path the current/most-recent run used (`activePathRef`) and picks the matching cancel sequence — `cancelExportWebCodecs()` (posts `'cancel'` to the worker + terminates it, THEN kills+destroys the ffmpeg session the worker was streaming into) for this path, vs. the legacy `backend.cancel()` otherwise; `teardown()` runs after either, idempotently.

**Key invariants:** annexb (not AVCC) is mandatory end-to-end — `avc:{format:'annexb'}` on the encoder config, verified by the frame-count guard; all timestamps are absolute (`Math.round(frameIndex·1e6/fps)`, not an accumulating per-frame delta, which drifts ~10µs/s at 30fps); the frame-count guard is a loud, typed failure, never a silent short export; the worker's encoder backpressure (`encodeQueueSize`/`dequeue`) and `sequentialDecode.ts`'s `DECODE_AHEAD_CAP=8` are what keep memory bounded on long exports (no chunk streaming would otherwise cap it); cancel must terminate the worker BEFORE killing the ffmpeg session, or the worker can still be mid-`appendFileRaw` against a session about to be destroyed.

**What this does NOT change:** the legacy pipeline above (`exportPipeline.ts`/`segmentEncoder.ts`/`frameRenderer.ts`/`frameEncodeWorker.ts`) is untouched and is exactly what runs when the gate is closed; the WebGL2 **preview** path (`useGlPreview.ts`/`glCompositor.ts`/`compositeParams.ts`) is untouched except for the verbatim `uvRect.ts` extraction; sync engine, timeline/editing, and persistence are untouched.

**Performance — honest numbers, not aspirational:** Step 8's synthetic effects-heavy benchmark measured 194s → 6.8s (~28×). Real projects measure roughly ~2.3× — the gap is GPU upload/readback cost in the Worker+OffscreenCanvas regime on WKWebView, which the synthetic benchmark's effects-heavy composition doesn't fully represent. `desynchronized: true` on the OffscreenCanvas GL context measured ~12% on top of that. Tier 1/C segments run at legacy speed (unchanged encoders). **Verified on macOS Intel x86_64 only** — macOS arm64 and Windows/WebView2 remain UNVERIFIED (no hardware access during implementation). `tauri build` (production bundling — Step 9) was run and verified on macOS Intel x86_64 on 2026-07-22: the app builds, packages (`.app`/`.dmg`), and launches cleanly in release mode (window renders, project dashboard loads real data, clean quit) — proving the worker's ES-module format loads correctly in a bundled production app. A full in-app export-flow walkthrough (an actual WebCodecs export triggered from the packaged app) is a separate manual step the user performs, not yet completed. See `docs/history.md`'s implementation record for the full per-step verification detail and the cross-platform status table.

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
- Export quality settings (resolution, fps) live in `App.tsx` state (`exportResolution`, `exportFps`) and are surfaced in `ExportSettingsModal.tsx`, opened at export time (not a settings panel — `SettingsPanel.tsx` was tombstoned long before this; see `docs/history.md`). Pixel dimensions for the chosen tier are derived via `resolutionConfig.ts`'s `resolveDimensions`, never hardcoded.

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
| `-framerate` on an ffmpeg mux of a raw annexb stream | Only sets the demuxer's displayed `r_frame_rate` — the muxer writes wrong per-packet duration for PTS-less packets (measured 6x-wrong file); use `-r <fps>` instead (`muxOnly.ts`) |
| `FontFace.load(url)` inside the WebCodecs export Worker | Fails with a NetworkError against fonts.gstatic.com on real WKWebView (confirmed empirically, not theoretical) — fetch bytes on the main thread and pass an `ArrayBuffer`/`FontConfig.bytes` into the worker instead (`fontResolver.ts`) |
| Assuming a canvas-source `VideoFrame`/`VideoEncoder` config accepts a `colorSpace` field | Only the buffer-source constructor overload has one — a canvas-source `VideoFrame` has no `colorSpace` API at all (confirmed against MDN and a real TS overload-rejection error); tag color space at MUX time instead (`muxOnly.ts`'s bt709 flags) |
| Adding 4K (or any resolution tier) back without updating `RESOLUTION_TABLE` for all 3 aspect ratios | `resolutionConfig.ts`'s `Record<AspectRatio, Record<ResolutionTier, FrameDimensions>>` shape makes a missing cell a compile error, not a silent runtime hole — but every new tier still needs a deliberate dimension decision for `9:16` and `1:1`, not just `16:9` |
| Storing `width`/`height` directly on `Project` | Pixel dimensions are always derived from `(aspectRatio, resolutionTier)` via `resolutionConfig.ts`'s `resolveDimensions` — never persisted directly, so there is exactly one source of truth for what a project's frame size is |
| Exposing `aspectRatio` as an editable field anywhere in the UI | Locked forever at creation (`NewProjectModal.tsx`) by design — changing it after segments/timing exist has no defined reflow behavior; `resolutionTier` is the only editable-later field (`ProjectSettingsModal.tsx`) |

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
