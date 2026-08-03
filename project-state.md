# Kinetix Pro Studio — Project State

> **Purpose:** Living source of truth for project status. Updated at the end of every work session.
> Distinct from `CLAUDE.md` — that file covers architecture/conventions; this file tracks where we are.

---

## Current State

| Field | Value |
|---|---|
| Last updated | 2026-08-03 |
| Current HEAD | `30a32cd` ("docs: boundary-drift investigation — breath-fix evidence + open word-shift defect") on branch `webgl2-effects-engine` — **committed, not pushed**. `tsc --noEmit` clean, `vitest` **1284/1284**. |
| App status | Shipping desktop app — Tauri DMG/installer, native ffmpeg sidecar export. No server, no web hosting. |
| Target users | YouTube creators — initial internal use across 5–10 channels |
| Repo | TBD |
| Restore tag | `sync-known-good-2026-06-20` → commit `bab79b0` — historical pre-sync-rewrite baseline. `sync-known-good-2026-07-29` → commit `bd9e919` — current active bisect target. See Key Invariants (a). |

Sync system rewrite closed (WS1a→WS6 + token-stealing fix); see `docs/history.md` for the full record. Export UX (live timer + completion chime) and the heading text quality fix (1080-reference scale + supersampled rasterization) have also shipped since. Most recently (2026-08-03): the index-based seam exemption fix for `isBreathSilence`'s multi-fragment override — ear-verified 86.8% → 96.2% correct cuts on the V6 production project — see `docs/boundary-drift-investigation.md` and Active Tasks below for the still-open word-shift defect it surfaced. Before that (2026-07-31): the window-overlap silence-candidacy regression fix (a real production bisect found the intra-segment SPAN/tolerance test in `isBoundarySilenceCandidate` was rejecting genuine boundary silences wholesale — deleted, not re-tuned), the resulting contiguity invariant fix in `snapCoveredBoundaries`, the Timeline absolute-positioning + lane redesign + cross-lane boundary markers, segment-1 head-extension (`headExtendFirstSegment`), the Bug C consecutive-run survival gates (recovered from a dropped stash and landed), the sync-log copy button, and Segments-panel spacing/hover-affordance polish — see `docs/history.md` → "Window-Overlap Silence Regression Fix, Timeline Redesign, Bug C Landed, Head-Extension, Copy-Logs, Panel Polish (2026-07-31)". All foundational/export/desktop work remains shipped and stable, including the clean-slate re-sync Architecture Shift (closed 2026-06-24) and the Effects Tab Rebuild (transitions 10/10, clip effects 7/7). One sync item remains open — the word-shift defect, see Active Tasks.

---

## Active Tasks

- **Boundary-placement fix — SHIPPED, ear-verified (2026-08-03).** `isBreathSilence`'s multi-fragment override now classifies breath-vs-boundary by token INDEX rather than token TIMESTAMP (Whisper timestamps blur 100-900ms across a real seam; indices, from the Hirschberg alignment pass, don't). Fixes 8 real boundaries on the 447-segment V6 production project (segs 34, 96, 162, 316, 338, 352, 405, 412). User resynced V6 with the fix in the tree, scrolled the full timeline, and confirmed cuts now sit in pauses: **86.8% → 96.2% correct cuts**. Full evidence, dead ends, and tooling notes: `docs/boundary-drift-investigation.md`. Wired NEXT-side only — the CURR-side variant is permanently disabled (confirmed unsound on a second, independent 173-segment project). See `snapBoundaries.ts`'s own doc comment and `CLAUDE.md`'s entry for the mechanism.
- **Word-shift defect (NEW top item, OPEN)** — a segment's cut point lands one or more words off from where the sentence actually breaks. **11 ear-verified cases:** segments 28-29, 60-61, 77-81, 105-106, 117-118, 130-131, 144-147, 188-189, 222-223, 295-296, 428-429 (V6 project). The aligner is exonerated (all 447 spans independently confirmed correct) — root-caused to the **boundary picker**, which widens its silence-candidate search window when the claimed inter-segment gap looks narrow (0.244s mean on defective pairs vs. 0.700s mean on clean pairs). Two candidate fixes tried and **both failed**: FENCE (window-fencing) directly conflicts with the 8 Candidate-1 breath-exemption fixes above; QUIET (quietest-point bias) fails 3 of 4 hard correctness checks at every window size tested. **Fix plan accepted 2026-08-03: `docs/sync-pipeline-v2-plan.md`** — the v2 architecture plan (sequences the timing-source upgrade before the fence, per its Part C) is the accepted path forward; Phase 0 (safety/instruments) is next. Full detail: `docs/boundary-drift-investigation.md`.
- **Pipeline Contract Program — stays paused.** Was already paused pending the (now-shipped) boundary-quality checker Phase 1; now additionally pending the word-shift fix above. Pair 1's own R2/floor-clamp analysis is superseded by the boundary-drift investigation — see `docs/sync-pipeline-contract-plan.md`'s re-stamped header. Two new, uncalibrated validators shipped alongside the boundary fix outside the formal contract-program sequence (same "ships when ready, doesn't wait for its formal turn" precedent as the boundary-quality checker itself): a Contract 3→4 `low-word-coverage` checker (`validateWordCoverage`, `syncContracts.ts`) and grouped sync-log entries (`buildGroupedViolationEntry`, `syncLog.ts`) — both **UNVERIFIED**, no manual confirmation yet in the running app.
- **Phase 2 boundary-quality watcher — REVERTED 2026-08-03** (no change from prior status). An uncommitted implementation (`applyBoundaryWatcher` + `verifyCommittedBoundaries` auto-correction, `boundaryQuality.ts`) was built and tested against production-verified projects, then reverted before commit for three reasons found during that verification: (1) a safety-bound failure on a real production project — a correction produced a degenerate near-zero/negative segment duration and a visible black gap; (2) a React render loop triggered by the new `setProject` write path in the Apply-Sync effect; (3) `findSilenceRegionCenter`'s region-centering formula (the `quietestAmplitude * 2` interim threshold) was never calibrated against real audio. The full diff is preserved at `docs/watcher-revert-2026-08-03.diff` — starting point for any future attempt.
- **(b) Stage 2 adaptive per-voice silence thresholds** — noise-floor estimation, falling back to the current fixed -45dB when estimation is unreliable.
- **(c) Sync loading screen redesign** — live 0–100% progress (currently a static "Preparing your project…" message, `SyncLoadingOverlay.tsx`).
- **Working rule:** audit/investigation reports must be persisted into `docs/` (not left to live only in chat transcripts) — implementation work must never depend on recalling a prior conversation.

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
| Test count (`vitest`) | 1284 — up from 1245 via the index-based seam exemption fix (`syncTiming.test.ts` additions), the word-coverage validator (`syncContracts.test.ts`), and grouped sync-log entries (`syncLog.test.ts`/`SyncLogPanel.test.tsx`); see `docs/history.md` for the per-item breakdown |
| Frontend bundle size | 505.86 kB / 152.74 kB gzip main bundle (measured 2026-06-22; no wasm in bundle — ffmpeg is a sidecar binary) |
| Lazy chunks | StockSearchModal 8.79 kB · jszip 95.87 kB |
| ffmpeg sidecar binaries | 76 MB (x86_64-apple-darwin), 48 MB (aarch64-apple-darwin), 97 MB (x86_64-pc-windows-msvc) — all gitignored; see `src-tauri/binaries/README.md` |
| Transition enum values in UI | 10 (only implemented transitions shown) |
| Filter names in UI | 26 (only implemented filters shown) |
| AnimationType values rendered in export | 12 (all applied via `canvasAnimations.ts`) |
