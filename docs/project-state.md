# Kinetix Pro Studio — Project State

> Living document. Update after each significant work session.

---

## Current State

| Field | Value |
|---|---|
| Last updated | 2026-06-30 |
| Current HEAD | ddfde06 |
| Branch | main |
| Build status | ✅ Clean (tsc + vitest 17/17) |

---

## Active Tasks

None currently.

---

## Completed Work

### Four UI bugs fixed — ✅ DONE 2026-06-30 (commits 66fdabf, e967a8d, ddfde06)

* ✅ Bug 1 — Cancel on new-project popup no longer creates a ghost project. Mount effect zero-projects branch now shows empty dashboard instead of auto-opening the modal. Cancel handler returns to dashboard without creating anything.
* ✅ Bug 2 — Project name is inline editable from top-left panel (click to edit, blur/Enter saves, Escape discards). Top-right display is read-only and updates reactively. onRename prop added to DropZonePanel.
* ✅ Bug 3 — UI state fully persists on reload: active tab, left/right panel collapse state, preview divider height, currentTime (playhead position), selectedSegmentId, timeline horizontal scroll position. handleSwitchProject gained a preserveUiState flag — reload preserves position, dashboard project switch resets to 0:00.
* ✅ Bug 4 — Left panel segment list auto-scrolls to active segment during playback AND on manual timeline click while paused. isPlaying guard removed from the scrollIntoView effect. Timeline horizontal scroll persists via debounced listener in Timeline.tsx, restored at 300ms after mount.

### Effects Tab Rebuild — ✅ DONE 2026-06-27 to 2026-06-29

Steps 1–8 complete. All 10 transition slugs implemented in applyTransitionBlend. Combined-look presets, randomize-from-pool, Apply to selected/all, drawer effect-pills — all shipped.

### Architecture Shift: Clean-slate re-sync — ✅ DONE 2026-06-24

All steps 1–7 complete. Apply Sync wipes all derived state and re-derives fresh from audio every time. 17/17 vitest regression suite passing.

---

## Deferred Polish Features

| Feature | Notes |
|---|---|
| Export ignores fontWeight/fontStyle/textShadow on main overlay caption | frameRenderer.ts:488 hardcodes italic+normal; wire fontWeight/fontStyle into canvas font string; call applyTextShadow (existing helper). Preview matches but export won't until fixed. |
| Preview transition 100/0 timing (black flash) | ~100-200ms black flash on video segment boundaries in transition preview. Documented in useTransitionPreview; deferred non-blocking. |
| 4K export unvalidated | 1080p verified macOS + Windows; 4K path untested. |
| Windows export performance | ~6× realtime (slow). Noted from brother's smoke test 2026-05-27. |
| macOS arm64 export speed | Pending measurement. |

---

## Deferred Known Bugs

| Bug | Notes |
|---|---|
| Client-side API keys | Pexels/Pixabay keys visible in JS bundle. Needs backend proxy before public launch. |

---

## SaaS Readiness Tasks

| Task | Notes |
|---|---|
| Backend proxy for API keys | Required before public launch. Keys currently baked into client bundle. |
| Auth layer | No authentication. Required before multi-user / public launch. |
| GPL sidecar licensing | libx264 is GPL. Before public launch: swap for LGPL-only build (OpenH264 or commercial x264 license). |

---

## Decisions Log

| Date | Decision |
|---|---|
| 2026-05-17 | Safari export verified — full export works with crossOriginIsolated=true |
| 2026-05-26 | Phase 6.4 — removed ffmpeg.wasm path entirely; native Tauri sidecar is the only export path |
| 2026-06-12 | Layout redesign shipped; waveform uses real Web Audio API amplitude analysis |
| 2026-06-19 | Heading system: pure overlay model with 50/50 absorption; audio-pause/duration-splitting approach tried and rejected entirely |
| 2026-06-24 | Clean-slate re-sync: deleted all segment merge loops, stableKey logic, anchor-aware Whisper aligner, skip-guard, PASS 2 backfill |
| 2026-06-27 | Effects Tab: combined-look presets use client-generated id preserved across service round-trip so active highlight survives save |
| 2026-06-30 | UI state persistence: kinetix:ui:v1 localStorage key stores activeLeftTab, leftPanelCollapsed, rightPanelCollapsed, previewHeight, currentTime, selectedSegmentId, timelineScrollLeft. handleSwitchProject preserveUiState flag distinguishes reload (preserve) from dashboard switch (reset). Timeline scroll listener lives in Timeline.tsx (not App.tsx) because timeline-scroll-area does not exist in DOM when App.tsx mounts. Restore deferred 300ms via setTimeout to let layout settle after double-mount caused by unbatched async hydration state updates. |
