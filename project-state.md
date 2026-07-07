# Kinetix Pro Studio — Project State

> **Purpose:** Living source of truth for project status. Updated at the end of every work session.
> Distinct from `CLAUDE.md` — that file covers architecture/conventions; this file tracks where we are.

---

## Current State

| Field | Value |
|---|---|
| Last updated | 2026-07-08 |
| Current HEAD | `aa12206` ("fix: prevent low-confidence alignment matches from overshooting into next segment's word range (Whisper D16 follow-up)") — the last COMMITTED state — on branch `webcodecs-api` — this commit and all prior unpushed commits are being pushed to `origin/webcodecs-api` in this same session, so the branch is caught up with origin as of this update. Since the prior HEAD note (`5f764a7`): a real-project follow-up bug was found in D16 (`cdc1eb1`) itself — a low-confidence match's `bestStart` could land far ahead of the search cursor (a spurious coincidental match against non-spoken caption text), anchoring that segment's `t1` past the next segment's true start and collapsing both to near-zero/negative duration. Fixed via an overshoot guard in `src/services/whisperService.ts` (re-anchors an overshooting low-confidence match to the cursor) plus a backstop monotonic-anchor clamp in `src/services/syncEngine.ts`'s `applyAnchorBasedTiming`, commit `aa12206`. Verified against the user's real transcript: overshoot fires on exactly the 5 genuinely-broken segments, zero false positives on the 8 previously-safe low-confidence segments, zero `[anchor] out-of-order` warnings post-fix (previously 2) — see the D16 Completed Work entry and the 2026-07-07 Decisions Log entry below. `tsc --noEmit` clean, `vitest` **220/220**. On top of that, a docs-only cleanup had landed (`5f764a7`) — no functional change. Commits since the WebCodecs Bug-2 fix (`0a3f67c`, which this cell previously referenced): live per-tick outgoing-side transition rendering (Item 4 B1-B3, `9f4d276`/`73d1f54`/`10410f0`, all shipped and stable) — **B4 (overlay parity) was then implemented, manually tested, found NOT to fix the reported animation jump/disappear symptoms, and surfaced an unrelated React "Maximum update depth exceeded" loop in `usePlayback.ts`; B4/B5 are now PARKED/SUPERSEDED (not "pending") and all uncommitted B4 work was discarded back to clean B3 state — see the WebGL/WebGPU rebuild Decisions Log entry and Active Tasks below, and `docs/webcodecs-architecture-plan.md`'s Item 4 entry for full detail.** The WebCodecs preview migration (Phases 0–8) is complete: `VideoDecoder`-based decode pool + windowed decode-ahead + LRU replaced the dual-`<video>`-slot preview path, cutover to default on all WebCodecs-capable runtimes, with the legacy `<video>` path retained as capability-gated fallback — full detail and per-phase evidence in `docs/webcodecs-architecture-plan.md`. Post-cutover transition-flash-back (Bug 1, commit `3022706`) and animation hard-cut (Bug 2, commit `0a3f67c`) fixes landed on top. Earlier: export quality/perf (CRF 16, vignette removal, Tier 1 fast-path bypass — 3m44s→40s on a mixed 4-video/10-image project), UI smoothness fixes, Effects Tab Rebuild Step 8 transitions (10/10), Architecture Shift complete (2026-06-24). |
| App status | Shipping desktop app — Tauri DMG/installer, native ffmpeg sidecar export. No server, no web hosting. |
| Target users | YouTube creators — initial internal use across 5–10 channels |
| Repo | TBD |
| Restore tag | `sync-known-good-2026-06-20` → commit `bab79b0` ("chore: remove VO-DIAG/SYNC-DIAG debug logging") |

All foundational/export/desktop/sync work is shipped and stable, including the clean-slate re-sync Architecture Shift (closed 2026-06-24, commit `254ef1b`). Effects Tab Rebuild is complete (transitions 10/10, clip effects 7/7). Active work is feature tasks only — see Active Tasks.

---

## Completed Work

<details>
<summary>Universal audio-format support for voiceover upload + transcription — ✅ DONE (4 parts) — 2026-07-08</summary>

**Root cause (two prior audits this session):** four independent gates each defined "allowed audio" differently and none converted the file to what the next stage needed. (1) file-picker `accept` advertised 10 formats but enforced nothing; (2) the extension router in `DropZonePanel.addFiles` hardcoded `['mp3','wav','m4a','ogg']`, silently dumping flac/aac/wma/opus/aiff into the image-asset bucket with no error; (3) the duration probe used a hidden `<audio>` element — WebView-codec-dependent (OGG fails on macOS WKWebView) with a silent 60 s fallback; (4) whisper-cli got raw, unconverted bytes — its miniaudio backend decodes only wav/mp3/ogg/flac and fails M4A/AAC **silently** (exit 0, zero tokens, degrades to estimate timing with no indication). Binary capability confirmed by direct execution of the bundled `whisper-x86_64-apple-darwin` (miniaudio build; `supported audio formats: flac, mp3, ogg, wav`; auto-resamples any rate/layout to 16 kHz mono; M4A → `failed to read audio data` but exit 0).

**Fix:**
- **Part 1 — universal ffmpeg pre-transcode (core).** `whisper.rs` now transcodes the upload to 16 kHz mono WAV via the ffmpeg sidecar (`transcode_to_wav`, `ffmpeg -hide_banner -y -i <in> -ar 16000 -ac 1 <out>`) before whisper-cli runs, pointing `-f` at the WAV. ffmpeg reads virtually any container/codec, so whisper's format limitation is now irrelevant. Transcode failure cleans the temp dir and emits a real `Error` event.
- **Part 2 — widened extension router.** New `src/services/audioFormats.ts` (`AUDIO_EXTENSIONS` + `isAudioFile`, extension list + `audio/*` MIME fallback). `addFiles` uses it; a file dropped/browsed **onto the Voiceover slot** that doesn't classify as audio now raises a `setSlotError` instead of silently misrouting. New `forceSlot: 'voiceover'` path.
- **Part 3 — ffprobe-style duration via IPC.** New `probe_audio_duration` command (`ffmpeg -i <file>`, parses `Duration:` from stderr — no separate ffprobe binary is bundled) + `probeAudioDuration(blob)` in `tauriFfmpeg.ts`. App's `resolveVoiceoverDuration` replaces the `<audio>`/60 s-fallback `getAudioDuration`; on failure it shows a toast and aborts the sync (no fake duration).
- **Part 4 — visible zero-token warning.** New `TranscriptionStatus` `'warning'` phase; `useWhisper`'s empty-token branch surfaces an amber non-blocking `TranscriptionBar` warning (sync still proceeds on estimate timing). `transcriptionReady` treats `'warning'` as terminal so Apply Sync re-enables.
- **UI copy:** Voiceover subtitle now "MP3, WAV, M4A, OGG, FLAC, AAC, WMA, Opus, AIFF".

**Verification:** `tsc --noEmit` clean; `cargo check` clean (14 s); vitest **220 → 227** (new `audioFormats.test.ts`, 7 cases incl. the FLAC-routes-to-voiceover regression). No existing test asserted the old 60 s-fallback or 4-format behavior, so none needed updating. Runtime end-to-end (real M4A/FLAC transcription in the Tauri app) not yet exercised — pending manual smoke test.

</details>

<details>
<summary>D16 — script→Whisper alignment cascade on number/contraction/symbol mismatches, + overshoot follow-up — ✅ FIXED, verified against real project data, committed (`cdc1eb1`, `aa12206`) — 2026-07-07</summary>

**Root cause:** `alignScenestoTranscript`'s word-matching cursor (`src/services/whisperService.ts`) is forward-only and greedy. A script's spelled-out number ("thirty seven") against Whisper's digit output ("37") — and likewise contractions ("don't" vs "do not") and symbols ("%" vs "percent") — scored as a mismatch, degrading that segment's match confidence enough to let a coincidental wrong-position match win, which then permanently desynced the cursor for every following segment. Confirmed against the user's real 251-segment project: drift began exactly at a spoken "thirty-seven" and cascaded forward from there; removing the word eliminated it. Full audit in this session's history.

**Fix (two parts, both in `src/services/whisperService.ts`):**
- **Part A — `canonicalizeForAlignment`** (new exported pure function; `normalize` now delegates to it, so it applies symmetrically to BOTH script segment text and Whisper token text before matching): integers 0–9999 (cardinal reading), 4-digit years (pair reading, e.g. "2024" → "twenty twenty four"), simple decimals ("3.5" → "three point five"), thousands separators, 44 common contractions (expanded before apostrophe stripping), and common spoken symbols (% → percent, & → and, @ → at, $N → "N dollars"). A script's "thirty seven" and Whisper's "37" now collapse to the same word sequence.
- **Part C — cursor confidence guard:** when a segment's best match covers fewer than 40% of its words (`bestScore / targetWords.length < 0.4`), the monotonic search cursor advances only minimally (by 1) instead of by the matched span, so a low-confidence/spurious match can no longer over-advance the cursor and strand every following segment. Dev-only `console.warn` flags each low-confidence segment. Contains any residual mismatch class Part A doesn't canonicalize.

**Tests:** 11 new tests in `src/services/syncTiming.test.ts` (6 canonicalization-equivalence + 5 alignment/cascade, incl. the "thirty-seven" regression and the Part-C safety-net). Full suite **216/216**, `tsc --noEmit` clean.

**Known residual risk:** the "years" spoken-form convention (pair reading, e.g. "2024" → "twenty twenty four") was chosen from general whisper.cpp behavior, NOT confirmed against real transcripts in this repo (none were available) — flag for confirmation on the first real-world test. Digit-vs-digit years are unaffected (both sides canonicalize identically regardless of convention). Still open — see Active Tasks.

**Follow-up — overshoot into next segment's word range (commit `aa12206`):** manual verification of D16 against a real project surfaced a second, distinct failure mode — a specific segment (and its immediate neighbor) collapsing to ~0.1–0.2s duration, without the cascading-forward-drift symptom D16's Part C guard was built to contain. Root-caused via temporary, fully-removed instrumentation (`TEMP-D16-AUDIT`/`TEMP-D16-DETAIL`, added and stripped across three audit-only turns): when a low-confidence match's `bestStart` (its best-scoring candidate position) lands more than 3 words *ahead* of the search cursor — a coincidental match against text that never actually occurs in the transcript, e.g. a burned-in on-screen caption like "you are twenty seven" — that segment's `t1` gets anchored to the overshot position's timestamp, landing after the *next* segment's real, higher-confidence match and collapsing both to a near-zero or negative span. The existing Part C guard correctly holds the forward cursor in this case (preventing a cascade), but did nothing to correct the corrupted segment's own `t0`/`t1`. Distinguished from the 8 already-safe low-confidence cases in the same real project, where `bestStart` stays at/near the cursor and no collapse occurs.

**Fix (two parts):**
- **Primary — overshoot guard** (`src/services/whisperService.ts`, `alignScenestoTranscript`): when confidence `< 0.4` AND `bestStart` is more than 3 words past the entry cursor, re-anchor `bestStart`/`bestEnd` to the cursor before deriving `t0`/`t1` — so an overshooting low-confidence match behaves like the already-safe at-cursor case instead of stealing a bogus forward position. In-tolerance low-confidence matches are untouched (byte-identical output).
- **Backstop — monotonic clamp** (`src/services/syncEngine.ts`, `applyAnchorBasedTiming`): a backward pass pulls any still-inflated non-locked anchor down to its successor's anchor before durations are derived. No-op when anchors are already monotonic (did not fire on the real verification data) — defense-in-depth against any overshoot pattern the primary guard doesn't catch.

**Verified against the user's real transcript (13-segment low-confidence set):** overshoot warning fires on exactly the 5 genuinely-broken segments (48, 65, 152, 173, 183 — note 65 was a newly-caught latent case that hadn't visibly collapsed before but was a genuine overshoot); zero false positives on the 8 previously-safe low-confidence segments (8, 40, 82, 97, 116, 119, 125); zero `[anchor] out-of-order` warnings post-fix (previously 2, at i=153 and i=175) — confirms the primary guard resolves the issue upstream and the backstop clamp is pure safety net on real data. 4 new regression tests added to `src/services/syncTiming.test.ts` (at-cursor case unaffected, far-ahead overshoot resolves, consecutive-overshoot pair resolves without mutual corruption, backstop clamp exercised directly). One pre-existing Part C test assertion updated (`t0[2] > 4.0` → `> 3.0`) — that fixture's own `s1` segment was itself a genuine overshoot case; the old threshold encoded the pre-fix collapsed placement (~5s), the new one reflects the correct uncollapsed placement (~3.75s) the fix now produces.

**Status:** Both D16 (`cdc1eb1`) and this follow-up (`aa12206`) FIXED, committed, and verified against real project data. `tsc --noEmit` clean, `vitest` **220/220** (216 baseline + 4 new). The years-spoken-form residual risk above is the only open item.
</details>

<details>
<summary>First-frame cache + cover layer for preview segment boundaries — ✅ DONE 2026-07-04 (commit 213c3e1)</summary>

Phase 1 of the preview-video quality effort: a `useFirstFrameCache.ts` hook precomputes and caches each segment's first frame; `PreviewStage.tsx` draws it as a static cover layer over the live `<video>` element at segment boundaries, hiding the frozen/blank frame that a cold video element shows before its clock actually starts (see the cold-start clock freeze bug below — the cover doesn't fix that root cause, it papers over the visible symptom during the boundary window). `tsc --noEmit` clean, `vitest` 60/60.
</details>

<details>
<summary>Locked-overlap early-cutoff fix — ✅ DONE 2026-07-03 (commit 202f31b)</summary>

`fix: thread real audio duration into heading/lock re-timing (no early cutoff)` — `resolveAudioDuration` now threads the real decoded audio duration through heading/lock re-timing instead of an approximated value, closing an early-cutoff bug surfaced while investigating the preview cold-start freeze below (the original hypothesis — a boundary-rounding gap — was itself rejected as IEEE-754 noise, but chasing it down turned up this genuine, unrelated fix). Regression tests added. `tsc --noEmit` clean, `vitest` 60/60.
</details>

D4 + D5 converted into the Path B: Separate Heading Layer roadmap (`docs/path-b-heading-layer-plan.md`) — they are symptoms of heading/segment coupling that Path B removes. Not fixed individually (targeted fixes rejected as low-value). Path B is PLANNED but deferred; current focus pivoting to export/runtime performance. (2026-07-02)

Heading architecture roadmap: see `docs/path-b-heading-layer-plan.md`.

<details>
<summary>Timeline smoothness — reload scroll + drag perf — ✅ DONE 2026-07-02 (commits fb6abbb, f4da926, 34206ee)</summary>

Three-part fix for a UI "jump then settle" feel on reload and laggy timeline drag:
- **Reload jump (`fb6abbb`):** the `previewHeight` measurement effect and the timeline `scrollLeft` restore both moved from post-paint `useEffect`/`setTimeout` to pre-paint `useLayoutEffect`, so the corrected preview height and saved scroll position apply before first paint instead of visibly snapping into place after.
- **Timeline drag perf (`f4da926`):** segment-resize and divider drags no longer call `setProject` on every `mousemove` (which rebuilt the whole segments array and re-rendered the full app every frame, with no memoized children). Live width during a drag is now written directly to the DOM via `data-seg-id`-tagged elements; `mousemove` is coalesced into one `requestAnimationFrame` per frame; the timeline rect and pixels-per-second are cached once at drag start instead of re-measured (`getBoundingClientRect`) on every move. The real state change still commits exactly once, on mouseup, through the existing `applyDurationChange` cascade — final drop values are unchanged from before.
- **Scroll-restore race (`34206ee`):** the `fb6abbb` restore ran while `containerWidth` was still 0 (Timeline's 800px zoom-formula fallback before its `ResizeObserver` first fires), so the browser clamped `scrollLeft` to 0 at restore time; two auto-scroll effects (segment-follow, zoom-center) then re-scrolled to the current position shortly after the real width landed, producing a visible "0 then scroll" flash. Fixed by deferring the one-shot restore until the `ResizeObserver`'s first real measurement, and gating both auto-scroll effects on a `didRestoreRef` so neither can fire before the restore has applied.

`tsc --noEmit` clean and 56/56 vitest after each commit. Drag feel and the reload flash can't be proven by automated tests — flagged for manual verification (drag smoothness + exact drop values; reload with a non-zero saved scroll position; playback/zoom/segment-select auto-scroll still work post-restore).
</details>

<details>
<summary>App-wide native selection disabled — ✅ DONE 2026-07-02 (commit b62bd95)</summary>

Click-drag gestures in the timeline and dashboard were triggering native text selection. `#root` now sets `user-select: none`, re-enabled for `input`/`textarea`/`[contenteditable="true"]` and, individually, the transcription-error message (`TranscriptionBar.tsx`) so users can still copy it. `draggable={false}` added to Timeline segment thumbnails and dashboard project thumbnails — the two primary drag surfaces — to stop native ghost-image drag. Review Mapping / preview / dropzone / stock-search thumbnails intentionally left untouched (lower drag-surface risk, out of scope for this pass).
</details>

<details>
<summary>Export quality raise + Tier 1 fast-path speedup — ✅ DONE 2026-07-02 (commits fbc96db, e8eba95, bf003d1)</summary>

- **Quality (`fbc96db`):** removed the unconditional edge-darkening vignette burn-in from both the export canvas path (`frameRenderer.ts`, `drawGradientVignette`) and the preview-only CSS scrim (`PreviewStage.tsx`), restoring preview/export parity. `libx264 -crf 23` → `-crf 16` (visually-lossless YouTube master, per the CRF-16 decision below). `imageSmoothingQuality: 'high'` set on both the main and blend canvases. Pinned `-colorspace`/`-color_primaries`/`-color_trc bt709` on export for consistent color reproduction.
- **Tier 1 fast path — plain video (`e8eba95`):** segments with no caption/overlay/transition/filter/animation/speed change (`isPlainVideoSegment`) bypass the per-frame canvas/PNG/IPC pipeline entirely — one direct ffmpeg trim + cover-fit encode at CRF 16, flags matched to the canvas path (`-an`, bt709, CFR, `setsar`) so concat still seams cleanly.
- **Tier 1 fast path — plain image (`bf003d1`):** plain image segments (`isPlainImageSegment`, sharing a common `isPlainMediaSegment` predicate core with the video check) render ONE frame and encode with `-loop 1 -frames:v N` at CRF 16, `N = segmentFrameCount` for byte-exact duration parity under `-shortest` (no audio drift). Desktop-verified: **3m44s → 40s** on a 4-video/10-image project, output correct (A/V sync, no boundary seam) on both fast-path commits.

New service: `src/services/plainSegment.ts` — the shared `isPlainMediaSegment`/`isPlainVideoSegment`/`isPlainImageSegment` predicates, with dedicated test coverage (`plainSegment.test.ts`).
</details>

<details>
<summary>D12 fixed — preview/playhead jump on timeline resize-drag — ✅ DONE 2026-07-01 (commit be45b07)</summary>

Root cause was a native ghost click, not the derived-state race originally suspected. A resize-drag ends with the cursor away from the left-edge handle's DOM position (segment rows are flex items — a row's on-screen left edge is the sum of every preceding row's width, which never changes while that row is being resized, so the fixed `left-0` handle never tracks the cursor the way the `right-0` handle does). The browser's native `click`, synthesized immediately after `mouseup` and hit-tested at the release position, was landing on the segment row body instead of the handle — firing `onClick`'s `onSeek(s.startTime)` (`Timeline.tsx`) directly, moving the real playhead. Fixed with a one-time, capture-phase `window` `click` listener armed in `handleUp` only when the drag actually moved the mouse (`App.tsx`).

Three secondary issues surfaced and were fixed along the way, kept in the codebase as real (if now largely redundant) hardening: (1) `PreviewStage.tsx`'s dual-slot video seek effect now skips reseeking while `isResizingRef.current` is true, cleared deterministically by a `resizingId`-keyed effect (child-before-parent commit ordering) instead of a racy `requestAnimationFrame` clear; (2) `useTransitionPreview.ts` forces `inTransitionWindow`/`needsPreRoll`/`isActive` false during a drag, so the transition-preview canvas can't swap in a snapshot of the wrong segment's frame; (3) `App.tsx`'s `currentSegment` is frozen at the source during a drag (`lastStableSegmentRef` + one-shot `resizeSettleTick` recompute on release), since `PreviewStage` reads `currentSegment` directly in many ungated places beyond the seek effect (image src, captions, Ken Burns transform, cross-segment transition props). `tsc --noEmit` clean and 17/17 vitest passing throughout. Manually verified across left/right-edge drags, both directions, segments near and far from the playhead.
</details>

<details>
<summary>Caption rendering fidelity — ✅ DONE 2026-06-30 (commits 60aa676, ae6165a, and this commit)</summary>

Export caption now honors `fontWeight`/`fontStyle`/`textShadow` (D1, commit `60aa676`); preview caption scales font/padding/radius proportionally to stage height, mirroring `frameRenderer`'s `refScale` (commit `ae6165a`); caption max-width unified to 70% of render width in BOTH preview (CSS `maxWidth: '70%'`) and export (`frameRenderer` `w * 0.7`) for wrap parity. Preview and export now match. Manual export + preview tests passed.
</details>

<details>
<summary>D10 fixed — preview transition black flash on video boundaries — ✅ DONE 2026-06-30</summary>

D10 fixed — preview transition black flash on video→video boundaries eliminated. Root cause: the idle video slot was preloaded (bytes buffered) but never pre-seeked, so seek+first-paint was deferred to the swap moment; the prior canvas-hold attempt gated on 'canplay' (fires before paint). Fix (`PreviewStage.tsx`): warm the idle dual-video slot ahead of time (seek to `nextSeg.trimStart||0` during preload) and gate the reveal on an actual painted frame via `requestVideoFrameCallback`, with a 'seeked'+rAF fallback and 400ms failsafe; warmed common path reveals synchronously (no added latency); existing canvas-hold retained as fallback for unwarmed edge cases (short segments/scrubbing). Image/color paths untouched. Verified acceptable on macOS; Windows/WebView2 spot-check not separately performed (rVFC+fallbacks are engine-agnostic).
</details>

<details>
<summary>D6 fixed — kinetix:ui:v1 lost-update race closed — ✅ DONE 2026-06-30 (commit 3b0702f)</summary>

D6 fixed — kinetix:ui:v1 lost-update/structural race closed by consolidating the three read-modify-write writers (2 in App.tsx, 1 in Timeline.tsx) plus all 7 lazy-initializer reads into a single standalone module `src/services/uiStateStore.ts` (`readUiState`/`patchUiState`). Behavior unchanged (same fields, same write timing, same isPlaying gating, same 300ms scroll-restore); only the read-merge-write mechanics are now centralized and atomic per call. Manually verified: reload preserves panel/scroll/playhead/tab; dashboard project-switch resets to 0:00. Commit `3b0702f`.
</details>

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
- ✅ **Mute toggle moved to drawer header** — sits to the left of the lock icon, scene-only (headings have no embedded audio); the old body mute row was removed so scene and heading drawers are the same height. *(The mute toggle itself — and the underlying `isMuted` field — was removed entirely on 2026-07-01 as dead code with no consumer; formerly tracked as D3.)*
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

<details>
<summary>Left-panel UI restructure — ✅ DONE 2026-06-30 (commits 0c577e9, f0ee59c, 65d5d66, 8fe8a78)</summary>

- Files tab redesign — compact headers, metadata rows, timestamps, Apply Sync gradient (`0c577e9`).
- Apply Sync stuck-in-syncing fix — clear pending voiceover on project switch and cache-hit re-stage (`f0ee59c`).
- Left panel redesign — heading rows, accent bar, Files tab polish, sync button fix (`65d5d66`).
- Segments tab header restructured into two rows: count/runtime + search input on row 1, the three unified action buttons (lock/unlock all, review, select-all/clear) stretched `flex-1` across row 2 (`8fe8a78`). Added `segmentSearch` state filtering the segment list by `seg.text`, preserving the original array index (`i`) through a `return null` guard inline in the existing `.map()` so `rowRefs`, `dropTargetIdx`, and `onMoveHeading` heading-drag logic stay correct while filtered.
- Recycle bin permanently dropped (no longer present in DropZonePanel.tsx).
- `tsc --noEmit` clean and 17/17 vitest passing.
</details>

<details>
<summary>Four UI bugs fixed — ✅ DONE 2026-06-30 (commits 66fdabf, e967a8d, ddfde06)</summary>

* ✅ Bug 1 — Cancel on new-project popup no longer creates a ghost project. Mount effect zero-projects branch now shows empty dashboard instead of auto-opening the modal.
* ✅ Bug 2 — Project name is inline editable from top-left panel (click to edit, blur/Enter saves, Escape discards). Top-right display is read-only and updates reactively.
* ✅ Bug 3 — UI state fully persists on reload: active tab, left/right panel collapse state, preview divider height, currentTime, selectedSegmentId, timeline horizontal scroll. handleSwitchProject gained a preserveUiState flag — reload preserves position, dashboard switch resets to 0:00.
* ✅ Bug 4 — Left panel segment list auto-scrolls to active segment during playback AND on manual timeline click while paused. Timeline horizontal scroll persists via debounced listener in Timeline.tsx, restored at 300ms after mount.
</details>

<details>
<summary>Effects Step 8 — transitions complete (10/10, commit 76ccf16)</summary>

All 10 transition slugs rendered in `frameRenderer.ts` (`applyTransitionBlend`)
and `useTransitionPreview.ts`/`PreviewStage.tsx`:
- Batch A: hard-cut, cross-dissolve, zoom, dip-black, dip-white, slide-push,
  whip-pan, wipe (commits 3779222, f928546, c0ab24f range)
- Batch B: glitch-rgb (lazy scratch-canvas compositing, screen blend, no
  getImageData), light-leak (radial gradient bloom, screen blend, peaks at
  alpha=0.5) — commit 76ccf16
- Caption fixes landed alongside: 6c88da0, 4a65379, f1676a9, a61bfe8
- First use of globalCompositeOperation='screen' in frameRenderer.ts
- Known issue logged: transition timing is 100/0 split, not true 50/50
  (see Ignored Low Risk Bugs D7)
</details>

<details>
<summary>Review Mapping modal — feature-complete — ✅ DONE 2026-06-27 (commit 23c8227)</summary>

The Review Mapping modal (task 7, shipped then delisted) reached feature-complete status. Final follow-up: live per-segment thumbnail renders the overlay/heading text layer (font, weight, italic, size, color, bg, bg-None, x/y) scaled proportionally to the thumbnail box, updating in real time as the row is edited. Positioning math mirrored locally in the modal — `PreviewStage`, `frameRenderer`, and `types.ts` untouched. Heading italic intentionally not rendered (unwired everywhere). Commit `23c8227`.
</details>

---

## Active Tasks

- **WebGL/WebGPU effects-rendering engine rebuild (NOT STARTED).** Decided 2026-07-07 (see Decisions Log) after the CSS/Canvas2D effects engine's Item 4 B4 patch failed to fix its target symptom and surfaced an unrelated infinite-render-loop bug — see this entry's Decisions Log writeup and `docs/webcodecs-architecture-plan.md`'s Item 4 entry for the full incident. Deliberately small scope for the first cut: **3 transitions** (dip-to-black, dip-to-white, cross-dissolve) + **2 animations** (zoom in, zoom out). Rationale: the current mixed DOM/CSS + Canvas2D rendering approach is the root cause of the whole Item-4 debugging saga and also of the slow per-frame export path; a unified WebGL/WebGPU renderer (the CapCut/Premiere-class approach) also pairs natively with WebCodecs — `VideoFrame` uploads directly to a GPU texture with no conversion — and the decode side of that pairing (the WebCodecs preview migration, Phases 0–8) is already done. Estimated effort: days, not weeks, since scope is being deliberately cut rather than expanded. Not yet started — scoping/prompt drafting was paused this session to prioritize higher-priority bugs first (scene-tag matching `9b15a59`, D16 Whisper alignment `cdc1eb1`).
- **Manually verify D16's pair-reading "years spoken-form" assumption against a real project (PARTIALLY VERIFIED 2026-07-07 — cardinal form confirmed, pair-reading form still open).** D16 (`cdc1eb1`) hard-codes a pair-reading convention for years whose last two digits are 10–99 (4-digit token, range 1100–2999, guard `n % 100 >= 10`; e.g. "2024" → "twenty twenty four") based on general whisper.cpp behavior. A real-project test confirmed the *other* branch instead: digit form "2003" (scene/heading text) and the spoken line "the year is two thousand and three" synced correctly — but 2003 falls outside the pair-reading guard (`2003 % 100 = 3 < 10`), so `canonicalizeForAlignment` took the general cardinal branch (`cardinalToWords` → "two thousand three"), never the pair-reading branch. The pair-reading convention itself (years like 2024, 1987, etc. with last-two-digits ≥10) remains unconfirmed — needs a real project with a script that spells out a year in that specific form (e.g. "twenty twenty four") to close out.

## Deferred Polish Features

- Version snapshots (2 open design decisions before building: asset-restoration Design A vs B, and full-rewind-on-restore)
- Auto-captions (reuse Whisper transcript tokens as a timed text layer)
- Procedural overlays: 4 remaining — Letterbox, Vignette, CRT/Scanlines, Viewfinder (pure canvas draw ops, no legacy-twin interactions) *(renderer not yet wired)*
- Asset-backed overlays: 6 blocked — Film Grain, Light Leaks, Film Damage, Atmospheric Particles, Weather, Fire/Embers (waiting on user-supplied black-bg screen-blend footage; render via ctx.globalCompositeOperation='screen')
- Export speedup: OffscreenCanvas/Worker (profiling done — I/O-bound, convertToBlob off main thread projected 40–55% faster)
- Multi-user support — team accounts vs. staying single-user is still an open call; revisit if/when multi-user demand materializes

## Deferred Known Bugs

D4 and D5 — see Path B roadmap (`docs/path-b-heading-layer-plan.md`); folded into that roadmap on 2026-07-02 rather than fixed individually — see Decisions Log.

Newly logged 2026-07-02, not yet root-caused or triaged into a D-number in this repo:
- **Exported-video judder** — reported FPS mismatch between source and export causing visible judder in rendered output (referenced as "finding #6"). Not yet reproduced/investigated against a specific commit here — needs a dedicated repro (source fps vs. `exportFps` setting vs. actual encoded frame timing) before a fix is scoped. Not yet started (Bug 1).
- **Preview video cold-start clock freeze — still open, now lower-priority (fallback-path only).** The "preview black-screen during playback" symptom logged 2026-07-02 (distinct from the already-fixed D10 transition-boundary flash) was investigated in depth: confirmed root cause is that a `<video>` element that has never played will not start its media clock on `.play()`, regardless of `readyState`/buffering. A full Phase 2 fix attempt (5-slot rolling pool, 3-detector motion sensing, ended-reset guard, clock-kick watchdog, load-based warm) was built, tested, and fully reverted — none of it addressed the real cause, and it never got committed. Two candidate directions (silent pre-roll vs. reveal-first/hide-after-motion) are proposed, pending a small diagnostic to decide between them. **Note (2026-07-07):** the WebCodecs preview migration (Phases 0–8, complete 2026-07-05, see `docs/webcodecs-architecture-plan.md`) replaced the dual-`<video>`-slot preview with a `VideoDecoder`-based decode pool as the default on all WebCodecs-capable runtimes; the `<video>`-based path this bug describes is now only the capability-gated fallback for non-capable runtimes. Downgraded from "UNRESOLVED" urgency accordingly — not closed, since the fallback path is still real and unfixed, but no longer affects the default preview experience. Full writeup: [docs/bugs/preview-cold-start-clock-freeze.md](docs/bugs/preview-cold-start-clock-freeze.md).

---

## SaaS Readiness Tasks

> Items required before public launch or multi-user distribution. Not scheduled — tracked here so they aren't forgotten.

- **Backend proxy for API keys** — Pexels/Pixabay/Coverr keys currently in JS bundle (VITE_ prefix). Required before public launch.
- **Auth layer** — No authentication; open access. Required for multi-user.
- **LGPL ffmpeg swap** — Current sidecar is GPL (libx264). Swap for LGPL-only build (OpenH264 or commercial x264 license) before public distribution.
- **4K export validation** — 1080p verified on macOS + Windows. 4K UI option exists but untested. Validate before advertising 4K support.
- **playbackSpeed UI re-expose** — Logic preserved in App.tsx; UI dropdown removed during 2026-06-17 BottomDrawer redesign. Re-expose as compact dropdown if user testing shows it's needed.
- **Restrict `fetch_url_bytes` with a domain allowlist (SSRF hardening)** — currently fetches any URL passed from the webview; acceptable for internal single-user use, required before public launch. `lib.rs`

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
| 2026-06-29 | **Effects Step 8 — transition renderer (Batch A + B):** All 10 transitions implemented in `applyTransitionBlend` (frameRenderer.ts) via pure canvas compositing — no getImageData/pixel readback anywhere. glitch-rgb uses lazy module-level scratch canvases + screen blend (cheap fake, visually indistinguishable at transition speeds). light-leak uses radial gradient bloom + screen blend, opacity shaped by alpha*(1-alpha)*4. Transition timing is Path B (100/0 split — entire window on A's trailing extension in export, last D seconds of A in preview) — documented as deferred known issue, not a regression. |
| 2026-06-30 | UI state persistence: kinetix:ui:v1 localStorage key stores activeLeftTab, leftPanelCollapsed, rightPanelCollapsed, previewHeight, currentTime, selectedSegmentId, timelineScrollLeft. handleSwitchProject preserveUiState flag distinguishes reload (preserve) from dashboard switch (reset). Timeline scroll listener lives in Timeline.tsx because timeline-scroll-area does not exist in DOM when App.tsx mounts. Restore deferred 300ms via setTimeout to let layout settle after double-mount caused by unbatched async hydration state updates. |
| 2026-06-30 | Caption max-width = 70% of render width (was 768px @1080p ≈40%). Applied identically in PreviewStage (CSS `maxWidth: '70%'`, resolves against inset-0 stage box, no JS) and frameRenderer (`w * 0.7`). Font-size/padding/radius remain height-scaled via refScale. Long captions now wrap later than before; preview/export parity preserved. |
| 2026-06-30 | UI-state persistence consolidated into `src/services/uiStateStore.ts` — single source for `kinetix:ui:v1` read/merge/write. Closes D6 and the structural risk of independent RMW writers (future async storage backend would otherwise reintroduce a real clobber). No behavior change. |
| 2026-06-30 | D10 fixed via pre-seek + requestVideoFrameCallback reveal-gating in PreviewStage dual-video slots (was: canplay-gated, which fires before paint). Canvas-hold kept as fallback. Preview-only; export untouched. |
| 2026-07-01 | D12 root cause was a native ghost click racing ahead of React state, not a derived-state timing bug — a browser `click` synthesized right after `mouseup` can hit-test onto a completely different element than the one `mousedown` targeted if the pointer drifted during the gesture (exactly what a left-edge timeline resize does, since that handle's DOM position never tracks the cursor). Three earlier fix attempts targeting `currentSegment`/`useTransitionPreview` staleness were real but not the dominant cause, because native DOM event dispatch isn't gated by any React state/effect timing at all. **Reusable pattern:** when a drag-release intermittently triggers an unrelated click-handler side effect, suspect a native ghost-click before assuming a React state race — fix by arming a one-time, capture-phase `window` `click` listener in the drag's mouseup handler (only when the drag actually moved the pointer) that swallows the very next click before any bubble-phase React handler sees it. Commit `be45b07`. |
| 2026-07-02 | D4/D5 will NOT get targeted fixes. Both fold into Path B (separate heading layer, `docs/path-b-heading-layer-plan.md`), deferred. Active-bug list now empty; next focus = export speed + app performance. |
| 2026-07-02 | **CRF 16 for export, not pixel-identical:** chose `libx264 -crf 16` (visually-lossless YouTube master) over chasing a pixel-identical re-encode. A truly pixel-identical path would require JPEG-frame passthrough or a hardware encoder, both ruled out — JPEG intermediates reintroduce generational loss before libx264 ever sees the frame, and hardware encoders (VideoToolbox/NVENC/QSV) aren't guaranteed present or bit-consistent across the Windows/macOS Intel/macOS arm64 targets this app ships to. CRF 16 gets visual quality close enough for the intended use (YouTube upload) without either tradeoff. |
| 2026-07-02 | **Two-tier export: plain segments bypass canvas entirely.** Any segment with no per-frame compositing (no caption, overlay, transition edge, filter, animation, or speed change) now skips the canvas/PNG/IPC render pipeline and goes through ffmpeg directly — one trim+encode for video (`e8eba95`), one frame + `-loop`/`-frames:v` for images (`bf003d1`). Composited segments (anything with an active effect) still render through the full per-frame `frameRenderer.ts` canvas path unchanged. The predicate (`isPlainMediaSegment` in `src/services/plainSegment.ts`) is deliberately conservative — anything it isn't certain is plain falls back to the canvas path, so quality/correctness never regresses, only speed varies. |
| 2026-07-02 | **Live timeline drag stays off React state.** Resize/divider drags no longer route their per-`mousemove` live-preview through `setProject` — App.tsx isn't decomposed/memoized, so any state update during a drag re-rendered the entire tree every frame. Live visual feedback is now a direct DOM write (`el.style.width` via `data-seg-id`, rAF-coalesced); the real state commit still happens exactly once, on mouseup, through the pre-existing `applyDurationChange` cascade — so final dropped values are provably unchanged (Phase A audit confirmed mouseup already fully committed independent of the per-move state, `f4da926`). Memoizing the heavy children (`PreviewStage`, `DropZonePanel`, `Timeline`, `BottomDrawer`) so `setProject` mid-drag would be cheap was considered and deliberately deferred — the ref/DOM approach is a superset fix that also eliminates the per-frame reflow width causes, not just the re-render cost. |
| 2026-07-07 | **Scene-tag/asset-matching fixes (`9b15a59`):** extension-agnostic exact match (strip file extensions on both sides before comparing, so `photo.jpg` matches an uploaded `photo.png`-renamed-to-`.jpg` case that previously failed), RTF bare-tag support (paste-from-RTF scene lists that lose their bracket formatting still resolve), and a new `unmatchedExplicitTag` flag that stops a failed *explicit* tag match from silently falling back to fuzzy-matching some other, wrong asset — an explicit tag that can't resolve now surfaces as genuinely unmatched instead of guessing. Informed by two read-only audits this session (`docs/archived/audit-scene-sync-flow.md`, now-deleted `docs/audit-tag-format-change.md`). `tsc --noEmit` clean, `vitest` 205/205 at the time. |
| 2026-07-07 | **D16 — script/Whisper alignment cascade fix (`cdc1eb1`):** root-caused a Whisper-alignment desync triggered by spoken numbers (e.g. script says "37," Whisper transcribes "thirty-seven") and similar contraction/symbol mismatches — one mismatched token was throwing off the sliding-window cursor for every subsequent word, cascading into wrong segment boundaries later in the transcript. Fixed via `canonicalizeForAlignment` (normalizes numbers/contractions/symbols before comparison) plus a cursor confidence guard in `src/services/whisperService.ts`, plus 11 new tests. `tsc --noEmit` clean, `vitest` 216/216. **Residual risk, not yet closed:** the "years spoken-form" convention used by `canonicalizeForAlignment` (pair-reading, e.g. "2024" → "twenty twenty four") was chosen from general whisper.cpp behavior, not confirmed against a real transcript in this repo — see Active Tasks. |
| 2026-07-07 | **D16 follow-up — overshoot into next segment's word range (`aa12206`):** real-project verification of D16 surfaced a second, non-cascading failure mode — a low-confidence match's `bestStart` landing far ahead of the search cursor (a spurious match against unspoken caption-style text) anchored that segment's `t1` past the *next* segment's true start, collapsing both to near-zero/negative duration, without triggering D16's cascade guard (which only protects the forward cursor, not the corrupted segment's own span). Root-caused via temporary instrumentation (added and fully removed across three audit-only turns, confirmed via grep). Fixed by (1) an overshoot guard in `whisperService.ts` that re-anchors an overshooting low-confidence match to the cursor, and (2) a backstop monotonic-anchor clamp in `syncEngine.ts`'s `applyAnchorBasedTiming`. Verified against the user's real transcript: fires on exactly the 5 genuinely-broken segments (of 13 low-confidence total), zero false positives on the 8 safe ones, zero `[anchor] out-of-order` warnings post-fix (previously 2). 4 new regression tests, 1 pre-existing Part C assertion updated (reflects the fix's correct, uncollapsed placement, not a masking change — see the D16 Completed Work entry for the full trace). `tsc --noEmit` clean, `vitest` 220/220. |
| 2026-07-07 | **Abandon further CSS/Canvas2D effects-engine patching; rebuild on WebGL/WebGPU instead.** Item 4's B4 sub-task (overlay parity — restoring `extraOverlays` during a live transition) was implemented and manually tested against `PreviewStage.tsx`/`useTransitionPreview.ts`, but did **not** fix the actually-reported symptoms (animation jump/disappear during transitions), and testing surfaced a new, unrelated bug: a React "Maximum update depth exceeded" infinite-render loop in `usePlayback.ts`. Rather than continue patching B4/B5 (or the CSS/Canvas2D effects engine generally, given this was already the second structural surprise after Phase B's `VideoEncoder` dead end), the decision was made to abandon the current DOM/CSS + Canvas2D rendering approach entirely and rebuild the effects engine on WebGL/WebGPU — see the new Active Tasks entry for scope (3 transitions + 2 animations, deliberately small first cut). All uncommitted B4 work was discarded via targeted `git restore` on `PreviewStage.tsx` and `useTransitionPreview.ts`, confirmed back to clean B3 state (commit `10410f0`; 162/162 tests passing at the time, now 216/216 with D16 on top). B1-B3 remain shipped and unaffected — Item 4's original frozen-frame symptom stays fixed. Full status recorded in `docs/webcodecs-architecture-plan.md`'s Item 4 entry. |

---

## Open Questions

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

---

## Ignored Low Risk Bugs

Low/no-risk — intentionally not scheduled. Revisit only if a user reports impact.

- **D7 — Transition timing is 100/0, not true 50/50:** the entire blend window sits on one side of the cut (Path B design, preserves Σ-duration invariant) rather than the industry-standard centered split; true 50/50 requires clip handles or breaking invariant (b). `segmentEncoder.ts`, `exportPipeline.ts`
- **D8 — glitch-rgb faint color cast tail:** at alpha→1 the red/blue tint passes don't fully cancel, leaving a cosmetic fringe at the end of the transition; harmless at typical transition speeds. `frameRenderer.ts`
- **D9 — Caption-switch is instant during dissolve:** DOM-text captions can't be pixel-blended — the incoming caption appears immediately rather than fading in; inherent to the DOM-text rendering approach. `PreviewStage.tsx`
- **D11 — Preview letterboxing in normal view:** the preview stage shows letterbox bars in the non-fullscreen layout; under-documented placeholder behavior, not a regression. `PreviewStage.tsx`
- **D13 — Export cancel doesn't kill the in-flight ffmpeg subprocess:** the generation counter and session teardown fire immediately, but the running `ffmpeg_exec` sidecar continues to completion against the torn-down temp dir; the resulting error is swallowed. `useExport.ts`, `ffmpeg.rs`
- **D14 — Timeline ruler overflows track by a few px:** `Math.ceil(totalDuration) + 1` ticks each `pixelsPerSecond` wide exceed the segment content width; cosmetic, auto-scroll clamps correctly. `Timeline.tsx`
- **D15 — Timeline scroll-restore assumes default zoom:** the one-shot reload scroll restore (`34206ee`) applies a raw persisted `scrollLeft` pixel value that's only valid at `sliderT = 0.5` (the value it's reset to on every `project.id` change); `sliderT` itself is never persisted. If a user zooms before reloading, the saved pixel offset maps to a different timeline position after reload and gets silently clamped by `maxScroll` — no crash, just minor scroll drift. Full fix would require persisting `sliderT` alongside `timelineScrollLeft`. `Timeline.tsx`, `App.tsx`
