# Kinetix Pro Studio — Project State

> **Purpose:** Living source of truth for project status. Updated at the end of every work session.
> Distinct from `CLAUDE.md` — that file covers architecture/conventions; this file tracks where we are.

---

## Current State

| Field | Value |
|---|---|
| Last updated | 2026-08-02 |
| Current HEAD | **`c14a9be`** ("Sync: rescue forward bound, breath discrimination, aligner snap parity, monotonic re-check") on branch `webgl2-effects-engine` — **committed, not pushed** (per this session's self-reference trailing-by-one convention: a commit's own file content cannot exactly quote its own resulting hash, so this value is the best pre-commit prediction, same as the prior entry's `2757614`). `tsc --noEmit` clean, `vitest` **1133/1133**. |
| App status | Shipping desktop app — Tauri DMG/installer, native ffmpeg sidecar export. No server, no web hosting. |
| Target users | YouTube creators — initial internal use across 5–10 channels |
| Repo | TBD |
| Restore tag | `sync-known-good-2026-06-20` → commit `bab79b0` — historical pre-sync-rewrite baseline. `sync-known-good-2026-07-29` → commit `bd9e919` — current active bisect target. See Key Invariants (a). |

Sync system rewrite closed (WS1a→WS6 + token-stealing fix); see `docs/history.md` for the full record. Export UX (live timer + completion chime) and the heading text quality fix (1080-reference scale + supersampled rasterization) have also shipped since. Most recently (2026-08-02): the rescue forward-ordering bound (closes a confirmed ~206s phantom-segment production bug), three-iteration breath discrimination for `snapCoveredBoundaries` (closes a confirmed mid-sentence-breath boundary-theft production bug), rescue observability (new 'rescue' sync-log entries), the aligner gap-fill fix port (parity between the two snap paths now holds under contention), and the monotonic-fallback re-check — see `docs/history.md` → "Rescue Forward Bound, Breath Discrimination, Aligner Snap Parity, Monotonic Re-Check (2026-08-02)". All foundational/export/desktop work remains shipped and stable, including the clean-slate re-sync Architecture Shift (closed 2026-06-24) and the Effects Tab Rebuild (transitions 10/10, clip effects 7/7). No open sync items remain tracked. Active work is feature tasks only — see Active Tasks.

---

## Active Tasks

No active tasks.

## Deferred Polish Features

- **Export quality pass — real color-space conversion + cross-segment drift correction** (was "Phase C" in the now-deleted `docs/webcodecs-architecture-plan.md`). The shipped WebCodecs + WebGL2 Worker Export path only tags bt709 color space at MUX time (`muxOnly.ts`) rather than performing true color-space conversion, and has no dedicated frame-timing/drift correction against the audio master clock beyond what the shared compositor already provides. Deliberately deferred, not a known defect — mux-time tagging measurably fixed the preview-vs-export color mismatch, and no drift complaint has been reported. Revisit only if a real color-accuracy or drift issue surfaces.
- Version snapshots (2 open design decisions before building: asset-restoration Design A vs B, and full-rewind-on-restore)
- Auto-captions (reuse Whisper transcript tokens as a timed text layer)
- Multi-user support — team accounts vs. staying single-user is still an open call; revisit if/when multi-user demand materializes
- Multi-language support — bundled model is English-only (`ggml-base.en.bin`); whisper.cpp silently ignores `-l auto` on `.en` models. Requires bundling `ggml-base.bin` (~148MB, multilingual). See `docs/history.md` → "Sync System Rewrite (2026-07-24 to 2026-07-29) — Archived".

## Deferred Known Bugs

Found via real-app manual testing in the Tauri app (WebGL2 preview toggle ON), 2026-07-13.

- **General preview playback lag/smoothness — root cause never confirmed across two reports.** First observed 2026-07-06 during post-Phase-A manual testing of the (since-replaced) CSS/Canvas2D preview path ("general preview playback lag/smoothness unrelated to segment boundaries — root cause unconfirmed, needs runtime profiling"). Re-reported 2026-07-13 alongside Bug 2 as "combined lag" under the WebGL2 preview path, with no further repro detail captured. Whether the WebGL2 rebuild resolved, carried forward, or replaced the original finding was never determined — the rendering path changed entirely between the two reports. Needs a dedicated repro session to confirm whether this is the same class of WKWebView `texImage2D` slow path Phase 3 Step 2 already fixed once, or a new distinct bottleneck, before it can be scoped. `src/hooks/useGlPreview.ts`, `src/services/gl/glCompositor.ts`. Deferred — not scheduled, not closed.

- **Regression — timeline segment edge-drag no longer tracks mouse movement:** unrelated to the lag entry above (Bugs 1, 2, and 4 are already fixed and no longer listed here). Dragging a segment from its edge does not follow mouse movement proportionally — instead it jumps directly to a fixed length and locks that segment plus its neighbor. Unlocking both afterward snaps them back to their originally-synced position automatically, discarding the manual adjustment entirely. This differs from the previously-working drag behavior documented in CLAUDE.md's `App.tsx` file-map entry (`isResizingRef`, live-width-via-tagged-DOM-refs, single `applyDurationChange` commit on mouseup) and the D12 ghost-click fix history (`docs/history.md`, commit `be45b07`) — suspected regression, not a pre-existing bug. Root cause not yet audited; first step should be bisecting whether this appeared alongside the WebGL2 preview integration (Phase 3, commit `5a40cc6`) or is unrelated to it. `src/App.tsx`, `src/components/Timeline.tsx`. Deferred for proper audit + fix — not scheduled, not closed.

- **(C) Global-pass spurious common-word matches can defeat skip-unmatched for a genuinely no-audio segment.** The Hirschberg global pass can match a short, common word (e.g. "the", "and") in a no-audio segment's text against an unrelated, distant occurrence of that same word elsewhere in the transcript — a real global match, so `matchedCount > 0` and the segment is never even considered by the rescue's zero-match gate (unlike the phantom-segment bug the forward-ordering bound above closes, which required a rescue to fire). Harmless in the confirmed cases so far (the spurious match is a single common word, contributing negligible confidence and rarely enough to flip `matched` to `true` outright), but not proven impossible for a pathological transcript. Queued, not scheduled. `src/services/whisperService.ts`.
- **(D) Quiet-pause detection gaps — boundaries fall back to token midpoints where pauses are too quiet/short for the detector.** `silenceDetector.ts`'s fixed `-45dB`/`0.25s` threshold does not catch every real spoken pause in noisy or quietly-produced audio; when it misses one, `snapCoveredBoundaries`/`alignScenestoTranscript` correctly fall back to the token midpoint (accurate, just less precise than a true silence-centered boundary). User has accepted this as designed behavior, not a defect, pending a deliberate future detector-tuning pass evaluated against a range of real recorded audio (not synthetic fixtures). `src/services/silenceDetector.ts`.
- **(E) `BREATH_TOKEN_OVERLAP_FLOOR_SEC` has only a 0.04s margin against its protecting fixture.** The 0.09s floor (see `docs/history.md` → "Rescue Forward Bound, Breath Discrimination, Aligner Snap Parity, Monotonic Re-Check (2026-08-02)", item 4) is calibrated to admit confirmed production overlaps of 0.09s/0.14s while excluding a 0.05s sub-floor artifact — a stated, honest margin, not a comfortable one. Watch item: revisit calibration if a future project's real Whisper output lands an interior-token overlap in the 0.05–0.09s band that should have counted (or shouldn't have). `src/services/syncConstants.ts`, `src/services/snapBoundaries.ts`.

---

## SaaS Readiness Tasks

> Items required before public launch or multi-user distribution. Not scheduled — tracked here so they aren't forgotten.

- **Backend proxy for API keys** — Pexels/Pixabay/Coverr keys currently in JS bundle (VITE_ prefix). Required before public launch.
- **Auth layer** — No authentication; open access. Required for multi-user.
- **LGPL ffmpeg swap** — Current sidecar is GPL (libx264). Swap for LGPL-only build (OpenH264 or commercial x264 license) before public distribution.
- ~~**4K export validation**~~ — **moot as of 2026-07-22.** 4K was fully removed from the UI and the `ResolutionTier` type by the Project Settings + Aspect Ratio work (see Active Tasks) — only 720p/1080p exist now. If 4K is ever reinstated, it needs dimension decisions for all 3 aspect ratios (`resolutionConfig.ts`'s `RESOLUTION_TABLE`) plus this same macOS/Windows validation pass, at that time.
- ~~**playbackSpeed UI re-expose**~~ — **resolved 2026-07-19.** UI was re-exposed via `SpeedBadge.tsx` (1x/2x/4x/8x cycling, click + ArrowLeft/ArrowRight) — no longer an open item.
- **Restrict `fetch_url_bytes` with a domain allowlist (SSRF hardening)** — currently fetches any URL passed from the webview; acceptable for internal single-user use, required before public launch. `lib.rs`

---

## Key Invariants

Non-negotiables. Future work — especially the Architecture Shift active task — must not break these without a deliberate, documented decision.

- **(a) Sync timing is regression-locked.** `src/services/syncTiming.test.ts` (154+ vitest tests in this file alone) plus regression tags protect the sync/anchor timing pipeline. Active bisect target: `sync-known-good-2026-07-29` → `bd9e919` (post-sync-rewrite baseline). Historical: `sync-known-good-2026-06-20` → `bab79b0` (pre-rewrite).
- **(b) Σ content-segment duration = voiceoverDuration.** This applies to content segments only — every `VideoSegment` in `project.segments` is content (no in-array headings exist as of Path B Phase 7, 2026-07-08). Total content-segment duration must always equal the voiceover's duration. Transition overlaps cancel pairwise by construction (Path B cross-fade design — see `docs/history.md`'s Decisions Log, 2026-05-25), so this holds without special-casing `App.tsx`. Headings are excluded entirely from this invariant — they own no timeline seconds (see (c)). This isn't theoretical: removing `splitAudio` in Heading Round 5 broke an earlier version of this invariant and cost 4 rounds of drift-bug fixes before headings were rebuilt as pure overlays.
- **(c) Headings are a separate top-level `HeadingOverlay[]` layer (`project.headings`), not segment-array entries.** Path B (see `docs/history.md` → "Path B — Separate Heading Layer — Design Decisions (Archived)") replaced the old in-array `isHeading`/`headingConfig` system entirely in Phase 7 (2026-07-08) — `VideoSegment` carries no heading fields anymore. A `HeadingOverlay` has a fixed absolute `time` that never moves on re-sync (a clamp+`needsReview` flag handles a re-sync that shrinks past it); it participates in no segment timing math and is composited on top of whichever segment(s) fall within its time range at render/export time.
- **(d) Transcription cache validity is keyed by file identity, not asset id.** `getFileIdentity(file) = \`${file.name}|${file.size}|${file.lastModified}\`` (`src/services/syncEngine.ts:216`), cached as `Project.lastTranscribedFileIdentity` (`src/types.ts:215`). Necessary because every file-stage event mints a fresh `Asset` id even when the user re-picks the identical file — id/reference equality can't catch a re-stage, but name+size+lastModified can.
- **(e) `anchorSource` provenance only ever moves one direction.** `'whisper'` = precise audio alignment; `'estimate'` = character-weight approximation that Whisper can still realign later. An anchor may be demoted `whisper → estimate` but is never promoted back, regardless of text changes (enforced by `syncTiming.test.ts`).
  - *Post-3c follow-up note — closed 2026-06-24 (post-3d-2):* `anchorSource` is confirmed effectively write-only — no production code branches on `'whisper'` vs `'estimate'`. Still written by `parseProjectData`, `applyAnchorBasedTiming` PASS 1, `distributeSegmentTimes`, and `handleInsertHeading`. Now documented directly in the `anchorSource` doc-comment in `src/types.ts`; no further cleanup planned.

---

## Open Questions

No open questions.

---

## Quick Stats

| Metric | Value |
|---|---|
| `src/App.tsx` LOC | 4,265 (measured via `wc -l`) |
| Branch status | `webgl2-effects-engine` @ `c14a9be`, **committed, not pushed** — 1 ahead of `origin/webgl2-effects-engine` |
| Project persistence | Per-project scoped: `kinetix:project:{id}:v1` + registry `kinetix:projects:v1` in localStorage (legacy single-project key `kinetix:project:v1` retained for one-time migration only) |
| IndexedDB | `kinetix-assets` DB v2, store `assets-v2`, compound keyPath `['projectId','id']` (legacy v1 store retained for migration) |
| Total dependencies | 6 prod + 12 dev |
| Export codec | H.264 video + AAC audio, MP4 container |
| Export engine | Two gated paths as of 2026-07-22 (`useExport.ts`'s `isWebCodecsExportGateOpen()`): **default** — WebCodecs+WebGL2 worker path (`VideoDecoder`→GL composite→`VideoEncoder`, native ffmpeg sidecar for mux-only), toggle ON on every platform; **fallback** — legacy native ffmpeg sidecar (evermeet.cx 8.1.1 static build, GPL) full per-frame canvas pipeline via Tauri `tauri-plugin-shell`, used when the capability probe fails or the user toggles off. See `docs/history.md` → *WebCodecs + WebGL2 Worker Export — Implementation Record*. |
| Export speed — WebCodecs path (default) | Step 8 synthetic effects-heavy benchmark: 194s → 6.8s (**~28×**). Real projects: **~2.3×** — the honest number, not the synthetic one (GPU upload/readback cost in the Worker+OffscreenCanvas regime on WKWebView narrows the real-world win). Verified macOS Intel x86_64 only; macOS arm64/Windows unverified. Tier 1/C segments (plain, or not GL-expressible) run at legacy speed regardless. |
| Export speed — legacy path (fallback) | **Stale — pending re-measurement.** Figures predate the 2026-07-09 worker-pool PNG encode + raw-binary IPC write speedup (commit `cd7ea2b`); no post-fix benchmark has been run yet. macOS Intel (x86_64): ~10× realtime (120s for 12s of output) as of the base64-IPC-only pipeline; Windows: ~6× realtime (6 min per 1 min of video, measured on brother's PC); macOS arm64: pending measurement |
| Test count (`vitest`) | 1133 — up from 1083 via the rescue forward-ordering bound, three-iteration breath discrimination, rescue observability, the aligner gap-fill fix port, and the monotonic-fallback re-check (1083 → 1133, all new coverage); see `docs/history.md` for the per-item breakdown |
| Frontend bundle size | 505.86 kB / 152.74 kB gzip main bundle (measured 2026-06-22; no wasm in bundle — ffmpeg is a sidecar binary) |
| Lazy chunks | StockSearchModal 8.79 kB · jszip 95.87 kB |
| ffmpeg sidecar binaries | 76 MB (x86_64-apple-darwin), 48 MB (aarch64-apple-darwin), 97 MB (x86_64-pc-windows-msvc) — all gitignored; see `src-tauri/binaries/README.md` |
| Transition enum values in UI | 10 (only implemented transitions shown) |
| Filter names in UI | 26 (only implemented filters shown) |
| AnimationType values rendered in export | 12 (all applied via `canvasAnimations.ts`) |
