# Kinetix Pro Studio — Project State

> **Purpose:** Living source of truth for project status. Updated at the end of every work session.
> Distinct from `CLAUDE.md` — that file covers architecture/conventions; this file tracks where we are.

---

## Current State

| Field | Value |
|---|---|
| Last updated | 2026-08-02 |
| Current HEAD | `458224c` ("feat(sync): boundary-quality checker — waveform-verified fallback-boundary warnings with calibrated dual gate") on branch `webgl2-effects-engine` — **committed, not pushed**. `tsc --noEmit` clean, `vitest` **1245/1245**. |
| App status | Shipping desktop app — Tauri DMG/installer, native ffmpeg sidecar export. No server, no web hosting. |
| Target users | YouTube creators — initial internal use across 5–10 channels |
| Repo | TBD |
| Restore tag | `sync-known-good-2026-06-20` → commit `bab79b0` — historical pre-sync-rewrite baseline. `sync-known-good-2026-07-29` → commit `bd9e919` — current active bisect target. See Key Invariants (a). |

Sync system rewrite closed (WS1a→WS6 + token-stealing fix); see `docs/history.md` for the full record. Export UX (live timer + completion chime) and the heading text quality fix (1080-reference scale + supersampled rasterization) have also shipped since. Most recently (2026-07-31): the window-overlap silence-candidacy regression fix (a real production bisect found the intra-segment SPAN/tolerance test in `isBoundarySilenceCandidate` was rejecting genuine boundary silences wholesale — deleted, not re-tuned), the resulting contiguity invariant fix in `snapCoveredBoundaries`, the Timeline absolute-positioning + lane redesign + cross-lane boundary markers, segment-1 head-extension (`headExtendFirstSegment`), the Bug C consecutive-run survival gates (recovered from a dropped stash and landed), the sync-log copy button, and Segments-panel spacing/hover-affordance polish — see `docs/history.md` → "Window-Overlap Silence Regression Fix, Timeline Redesign, Bug C Landed, Head-Extension, Copy-Logs, Panel Polish (2026-07-31)". All foundational/export/desktop work remains shipped and stable, including the clean-slate re-sync Architecture Shift (closed 2026-06-24) and the Effects Tab Rebuild (transitions 10/10, clip effects 7/7). No open sync items remain tracked. Active work is feature tasks only — see Active Tasks.

---

## Active Tasks

- **REGRESSION AUDIT — long-pause-voice sync issue (user-reported)** — root-caused (Whisper timestamp under-run + narrow search window + a removed distance guard, see `docs/history.md`). **Boundary-quality checker Phase 1 shipped** (`458224c`) — waveform-verified `info`-severity warnings for fallback boundaries that landed on loud audio with a real quiet region nearby; dual gate (absolute floor 0.05, min distance 0.10s, ratio K=2) calibrated against the 447-seg long-pause project (29 TP incl. all 5 diagnostic-proven boundaries) and the 174-seg older project (0 FP). Manually verified in the dev app on both fixture projects. Queued next, in order:
  - **(a) Phase 2 watcher** — auto-moves a flagged boundary to the quiet point. Gated by the same calibrated rule; a post-hoc pass; must preserve paired-write contiguity (Key Invariant (f)) and the locked-pair guard; runs after `headExtendFirstSegment`. Requires fresh-voiceover end-to-end verification (the peaks-absent first-sync flow) before landing.
  - **(b) Stage 2 adaptive per-voice silence thresholds** — noise-floor estimation, falling back to the current fixed -45dB when estimation is unreliable.
  - **(c) Sync loading screen redesign** — live 0–100% progress (currently a static "Preparing your project…" message, `SyncLoadingOverlay.tsx`).
  - **(d) Pipeline Contract Program Pair 2** — resumes after the watcher ships.
- **Working rule (new):** audit/investigation reports must be persisted into `docs/` (not left to live only in chat transcripts) — implementation work must never depend on recalling a prior conversation.

## Deferred Polish Features

- **Export quality pass — real color-space conversion + cross-segment drift correction** (was "Phase C" in the now-deleted `docs/webcodecs-architecture-plan.md`). The shipped WebCodecs + WebGL2 Worker Export path only tags bt709 color space at MUX time (`muxOnly.ts`) rather than performing true color-space conversion, and has no dedicated frame-timing/drift correction against the audio master clock beyond what the shared compositor already provides. Deliberately deferred, not a known defect — mux-time tagging measurably fixed the preview-vs-export color mismatch, and no drift complaint has been reported. Revisit only if a real color-accuracy or drift issue surfaces.
- Version snapshots (2 open design decisions before building: asset-restoration Design A vs B, and full-rewind-on-restore)
- Auto-captions (reuse Whisper transcript tokens as a timed text layer)
- Multi-user support — team accounts vs. staying single-user is still an open call; revisit if/when multi-user demand materializes
- Multi-language support — bundled model is English-only (`ggml-base.en.bin`); whisper.cpp silently ignores `-l auto` on `.en` models. Requires bundling `ggml-base.bin` (~148MB, multilingual). See `docs/history.md` → "Sync System Rewrite (2026-07-24 to 2026-07-29) — Archived".

## Deferred Known Bugs

None.

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
- **(f) Adjacent covered segments are contiguous.** `startTime[i] + duration[i] === startTime[i+1]` for every adjacent pair produced by `snapCoveredBoundaries` (`snapBoundaries.ts`). Enforced unconditionally since the 2026-07-31 window-overlap regression fix (a boundary write followed by a duration-floor `Math.max` could previously leave `curr` extending past the just-written `next.startTime`) — Timeline.tsx's absolute-positioned segment cards depend on this holding, since each card's position is now a direct function of its own `startTime` rather than an accumulated sum of prior siblings' widths.

---

## Open Questions

No open questions.

---

## Quick Stats

| Metric | Value |
|---|---|
| `src/App.tsx` LOC | 4,369 (measured via `wc -l`) |
| Branch status | `webgl2-effects-engine` @ this commit (tag `clean-baseline-2026-07-31`, immediately after `abb642c`), **committed, not pushed** — ahead of `origin/webgl2-effects-engine` |
| Project persistence | Per-project scoped: `kinetix:project:{id}:v1` + registry `kinetix:projects:v1` in localStorage (legacy single-project key `kinetix:project:v1` retained for one-time migration only) |
| IndexedDB | `kinetix-assets` DB v2, store `assets-v2`, compound keyPath `['projectId','id']` (legacy v1 store retained for migration) |
| Total dependencies | 6 prod + 12 dev |
| Export codec | H.264 video + AAC audio, MP4 container |
| Export engine | Two gated paths as of 2026-07-22 (`useExport.ts`'s `isWebCodecsExportGateOpen()`): **default** — WebCodecs+WebGL2 worker path (`VideoDecoder`→GL composite→`VideoEncoder`, native ffmpeg sidecar for mux-only), toggle ON on every platform; **fallback** — legacy native ffmpeg sidecar (evermeet.cx 8.1.1 static build, GPL) full per-frame canvas pipeline via Tauri `tauri-plugin-shell`, used when the capability probe fails or the user toggles off. See `docs/history.md` → *WebCodecs + WebGL2 Worker Export — Implementation Record*. |
| Export speed — WebCodecs path (default) | Step 8 synthetic effects-heavy benchmark: 194s → 6.8s (**~28×**). Real projects: **~2.3×** — the honest number, not the synthetic one (GPU upload/readback cost in the Worker+OffscreenCanvas regime on WKWebView narrows the real-world win). Verified macOS Intel x86_64 only; macOS arm64/Windows unverified. Tier 1/C segments (plain, or not GL-expressible) run at legacy speed regardless. |
| Export speed — legacy path (fallback) | **Stale — pending re-measurement.** Figures predate the 2026-07-09 worker-pool PNG encode + raw-binary IPC write speedup (commit `cd7ea2b`); no post-fix benchmark has been run yet. macOS Intel (x86_64): ~10× realtime (120s for 12s of output) as of the base64-IPC-only pipeline; Windows: ~6× realtime (6 min per 1 min of video, measured on brother's PC); macOS arm64: pending measurement |
| Test count (`vitest`) | 1245 — up from 1219 via the boundary-quality checker (commit `458224c`: `boundaryQuality.ts`/`boundaryQuality.test.ts` + `syncContracts.test.ts`/`syncTiming.test.ts` additions); see `docs/history.md` for the per-item breakdown |
| Frontend bundle size | 505.86 kB / 152.74 kB gzip main bundle (measured 2026-06-22; no wasm in bundle — ffmpeg is a sidecar binary) |
| Lazy chunks | StockSearchModal 8.79 kB · jszip 95.87 kB |
| ffmpeg sidecar binaries | 76 MB (x86_64-apple-darwin), 48 MB (aarch64-apple-darwin), 97 MB (x86_64-pc-windows-msvc) — all gitignored; see `src-tauri/binaries/README.md` |
| Transition enum values in UI | 10 (only implemented transitions shown) |
| Filter names in UI | 26 (only implemented filters shown) |
| AnimationType values rendered in export | 12 (all applied via `canvasAnimations.ts`) |
