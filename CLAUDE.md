# CLAUDE.md — Kinetix Pro Studio

> **Purpose:** the operating manual — architecture, conventions, invariants. Durable
> content only: true today and still true in six months. **Never put here:** status,
> test/line counts, commit SHAs, dates, or task lists — those rot the moment they're
> written. Status → `project-state.md`. Task-level detail → `docs/work-in-progress.md`.
> Dated fixes/investigations/measured numbers → `docs/history.md`. **Cap: ~400 lines**;
> if adding content would exceed it, something existing moves to `docs/history.md`
> first. See §5 "Documentation rules" for the full scheme across all five docs.

---

## 1. What This Project Is

Kinetix Pro Studio is a desktop video slideshow compositor: a user supplies a script, scene-tagged asset references, and a voiceover, the app syncs them into a timeline of segments with transitions, overlays, filters, and animations, and it exports a full H.264/AAC MP4. It's built for solo creators producing narrated slideshow-style videos without a full NLE. It's a Tauri v2 app — a React/Vite frontend wrapped in a Rust shell that bundles a native ffmpeg sidecar (export) and a whisper.cpp sidecar (speech alignment); there is no server and no AI API calls, everything runs locally.

---

## 2. Commands

```
npm run dev             # Vite dev server (browser only — no Tauri APIs, no export)
npm run tauri:dev       # Full app: Tauri shell + Vite — the only place export/ffmpeg/whisper work
npm run build            # vite build (frontend only)
npm run tauri:build     # Production .app/.dmg bundle
npm run lint             # tsc --noEmit
npm test                 # vitest run (single pass)
npm run test:watch      # vitest watch mode
```

Rust side (`src-tauri/`): normally driven through `tauri:dev`/`tauri:build` above; use `cargo check`/`cargo build` from `src-tauri/` directly when iterating on Rust alone. ffmpeg sidecar binaries under `src-tauri/binaries/` are gitignored — see `src-tauri/binaries/README.md` to re-provision on a fresh checkout.

`npm run tauri:dev:fa` compiles with the `fa-inference` Cargo feature (forced-alignment ONNX inference — see `src-tauri/Cargo.toml`'s `[features]`), off by default in plain `tauri:dev`/`tauri:build`. `ort` uses `load-dynamic`, so this compiles without an onnxruntime dylib present; an FA call at runtime with `ORT_DYLIB_PATH` unset fails cleanly rather than crashing. This does not by itself route Apply Sync's timing through FA — see `docs/work-in-progress.md`'s WS1 section for that gate's status.

Export, the ffmpeg sidecar, and the whisper.cpp sidecar only run inside `npm run tauri:dev` or the built app — `npm run dev` alone has no Tauri IPC bridge.

---

## 3. Architecture Map

The ~25 modules a new session most needs to orient itself. One line each — what it does, not its history (see `docs/history.md` for that).

**Entry points & shared types**
- `src/App.tsx` — top-level state, orchestration, playback loop wiring, export triggers; still hosts `parseProjectData()`, the sync entry point.
- `src/types.ts` — `Project`, `VideoSegment`, `Asset`, `TextOverlay`, `SegmentGrade` + shared enums.
- `src/constants.ts` — filter/transition/animation option lists, `SUPPORTED_LANGUAGES`, dev-only assert guards.

**Sync engine (script → timed segments)**
- `src/services/syncEngine.ts` — content-only fuzzy matching + anchor-based timing helpers (`isFuzzyMatch`, `applyAnchorBasedTiming`, `headExtendFirstSegment`).
- `src/services/whisperService.ts` — Whisper alignment: sliding-window text matcher, per-segment rescue for zero-match segments, run-survival gates.
- `src/services/snapBoundaries.ts` — refines segment boundaries against detected silence for the covered (matched) segment array.
- `src/services/textNormalize.ts` — the one shared text-normalization pipeline (`canonicalize` / `stripStageDirections`) used by both the alignment and filename paths.
- `src/services/faAnchorTrustGate.ts` — R.14/R.15: corrects a committed boundary when FA's own token
  ordinals say it sits in the wrong place (smeared incoming anchor) or on the wrong side of a word
  (outgoing segment's tail after the cut).
- `src/services/syncConstants.ts` — every tuning constant the sync pipeline uses; imported, never duplicated locally.

**Undo/redo**
- `src/services/history.ts` — pure snapshot-ring undo/redo core, no React/DOM.
- `src/services/historyPersist.ts` — persists history across a page reload (not an app restart) via IndexedDB.
- `src/services/historyLockPolicy.ts` — blocks an undo/redo traversal that would move a locked segment.
- `src/services/historyCoalesce.ts` — decides when a drag/type gesture closes into one history entry.

**Timeline / drag**
- `src/services/dragCascade.ts` — pure math for how a timeline drag-resize cascades into neighboring segments.
- `src/services/dragGeometry.ts` — pointer-coordinates-to-segment-timing geometry for a drag.
- `src/services/dragSession.ts` — DOM/pointer-event orchestration for one drag gesture.
- `src/components/Timeline.tsx` — scrollable track, playhead, zoom, absolutely-positioned segment/heading/waveform lanes.

**Preview**
- `src/components/PreviewStage.tsx` — video/image display + overlay rendering, fullscreen handling.
- `src/hooks/useGlPreview.ts` — WebGL2 preview driver (transitions, zoom animations, color grading).
- `src/services/gl/` (`glCompositor.ts` + `compositeParams.ts`) — the WebGL2 compositing engine shared by preview and the WebCodecs export path.

**Export**
- `src/hooks/useExport.ts` — export orchestration; decides WebCodecs vs. legacy path per run, tracks cancel/progress/timer state.
- `src/services/exportPipeline.ts` — legacy canvas-per-frame → ffmpeg export orchestrator.
- `src/services/webcodecsExport/` — WebCodecs+WebGL2 worker export path (default since 2026-07-22); additive sibling of the legacy path, not a replacement.
- `src/services/segmentEncoder.ts` + `src/services/frameRenderer.ts` — legacy per-frame canvas render/encode pipeline.
- `src/services/resolutionConfig.ts` — single source of truth mapping (aspect ratio, resolution tier) → pixel dimensions.

**Persistence & speech**
- `src/services/assetStore.ts` / `src/services/projectStore.ts` — IndexedDB asset blobs / localStorage project JSON.
- `src/hooks/useWhisper.ts` — Whisper transcription orchestration hook (progress, cancellation, language handling).

**Native (Rust)**
- `src-tauri/src/ffmpeg.rs` — ffmpeg sidecar IPC commands (session lifecycle, frame I/O, export mux/concat, probes).
- `src-tauri/src/whisper.rs` — whisper-cli sidecar IPC commands (transcription, cancellation, language detection).

---

## 4. Invariants

Standing rules that are true today and must not be broken. (Pulled out of the old File Map's dated commentary and project-state.md's old "Key Invariants" section — see `docs/history.md` for how each was discovered or fixed.)

**Segment timing**
- **`project.segments` is a gapless partition ("Model P"), officially and permanently — "Model S" (independently-positioned slots with legal gaps) is rejected.** A lock whose position would make the partition unsatisfiable (another lock on the opposite side of the shortfall) is refused at toggle time (`App.tsx`'s `handleToggleLock`) rather than silently committing a gap; unlocking is never refused. Full ruling/analysis: `docs/history.md`'s "Decisions Log — Dissolved from `docs/decisions/`" section.
- For every adjacent pair of covered (matched) segments: `startTime[i] + duration[i] === startTime[i+1]`. Holds unconditionally after `snapCoveredBoundaries`; `headExtendFirstSegment` and `Timeline.tsx`'s absolute positioning both depend on it. A DEV-mode assertion checks it.
- **Σ content-segment duration = voiceoverDuration.** Applies to content segments only — no in-array headings exist (see below). Transition overlaps cancel pairwise by construction, so this holds without special-casing `App.tsx`.
- **Headings are a separate top-level `HeadingOverlay[]` layer (`project.headings`), not segment-array entries.** `VideoSegment` carries no heading fields. A `HeadingOverlay` has a fixed absolute `time` that never moves on re-sync (a clamp + `needsReview` flag handles a re-sync that shrinks past it); it participates in no segment timing math and is composited on top of whichever segment(s) fall within its time range at render/export time.
- Under clean-slate re-sync, anchors are never carried forward from a previous sync run — every Apply Sync re-derives every segment's `anchorStart` fresh.
- **`anchorSource` provenance only ever moves one direction**: `'whisper'` (precise audio alignment) may demote to `'estimate'` (character-weight approximation) but never promotes back, regardless of text changes.
- **Transcription cache validity is keyed by file identity, not asset id** — `getFileIdentity(file) = \`${file.name}|${file.size}|${file.lastModified}\`` (`syncEngine.ts`), cached as `Project.lastTranscribedFileIdentity`. Necessary because every file-stage event mints a fresh `Asset` id even when the user re-picks the identical file.
- A segment absent from a restored/target state is not a lock conflict — that's the Apply Sync boundary.

**Undo/redo**
- `history.ts` stores whole-`Project` snapshots, not patches. Every writer in the app must be immutable, or history silently rewrites its own past.
- History depth is 20 *total states*, not 20 each: `undoDepth + redoDepth <= MAX_HISTORY_STATES`.
- History survives a page reload but not an app restart (discriminated by a per-process token minted in `lib.rs`).
- If traveling to a stored state would move a currently-locked segment, the traversal is blocked entirely — there is no partial restore that skips just the locked segment (impossible under snapshots without breaking the gapless invariant above).
- Lock/unlock itself is never undoable — those writes go through `setProjectSilent`, bypassing history.
- `setProjectRaw` must never be called outside `App.tsx`'s `setProject`/`setProjectSilent` wrappers — they advance `liveProjectRef`, the synchronous mirror a batched second `setProject` call in the same handler depends on.
- Never route an undo/redo restore through `computeDragCascade` — its `conserveTotalDuration` option rejects a legitimate restore (e.g. undoing an Apply Sync) whose total duration differs from current state.

**Assets & persistence**
- An asset must be written via `putAsset` (IndexedDB) *before* it's added to `project.assets` — a blob URL dies with the tab.
- Removing an asset must call `deleteAsset` and `URL.revokeObjectURL`.
- `Project` never stores `width`/`height` directly — dimensions are always derived via `resolutionConfig.ts`'s `resolveDimensions(aspectRatio, resolutionTier)`.
- `aspectRatio` is locked forever at project creation and is never an editable UI field; `resolutionTier` is the only editable-later dimension field.
- **`Asset.duration` is the single source of truth for a video clip's own length** — no `VideoSegment` field caches it (the retired field name was `VideoSegment.sourceDuration` — do not reintroduce it); every trim/slip bound and every segment-local→source-time clamp (`toSourceTime`/`sourceRange`, `resolveDragEdge`, `plainSegment.ts`, `buildFreezeFrameEntries`) resolves it from the asset a segment currently points at, via `assetId`. Probed once per video asset at every creation site (mirroring the existing `nativeFps` pattern), plus a back-compat backfill on rehydration. Undefined when the asset isn't a video or the probe failed — callers must decline to guess (hide the trim bar, skip the clamp) rather than fabricate a length.
- **A video segment always plays at its native rate** — `VideoSegment` has no `playbackSpeed` field; changing a segment's duration (by drag or otherwise) never changes its playback speed. (`globalPlaybackSpeed`, the separate per-project scrub-speed control, is unrelated and still a real field.)

**Sync / Whisper**
- **Timestamps may measure distance; they must never decide identity.** Whether two things ARE the same thing (a boundary, an R.1 anchor, a breath-vs-boundary silence) is token-index business — from the Hirschberg alignment pass — never raw-timestamp proximity: timestamps can smear 100–900ms across a real silence seam, so "close" can masquerade as "the same." Scope is the whole sync/FA pipeline, not one file — worked violation: `faAnchors.ts`'s `findAgreeingSilence` matching an anchor by timestamp proximity (ear-pass items 6/7, `docs/work-in-progress.md` §11).
- A Whisper rescue claim may only take tokens no other segment's global alignment pass already matched, and its earliest claimed token must sit before the first token any *later* segment truly matched — order, not distance, distinguishes a legitimate rescue from a false-positive one.
- `Project.language` is sticky once set (by detection or explicit override) — a later transcription never silently re-detects while a language is already stored.
- Sync accuracy is verified for five languages (English, Spanish, French, Portuguese, German — `constants.ts`'s `SUPPORTED_LANGUAGES`, backed by the `ggml-large-v3-turbo.bin` model); other whisper-cli codes are accepted, never blocked, but trip an `unsupported-language` sync-log warning.
- Only 720p and 1080p resolution tiers exist, for all three aspect ratios. 4K/2K are deliberately absent from the type, not just untested.
- **A solo listening pass can be overturned by a side-by-side (A/B) pass; a side-by-side pass is not itself re-litigated by a later solo pass.** Two near-identical timestamps can be indistinguishable played alone but clearly ordered played side by side (WS1 Session T: 1188.950 vs 1189.050, both inside 1.26s of digital silence, reversed a SOLO "correct" verdict on comparison). A verdict recorded from a solo sitting is not wrong on its face, but is unaudited against this failure mode — flag it for re-verification when touched, don't silently trust it as settled.
- **Whether a boundary is DEFECTIVE is decided from token ordinals and aligner posteriors; acoustic
  silence may decide only WHERE the corrected boundary goes.** A silence array cannot tell you a cut is
  wrong — every one of the 15 ear-verified defects sits on or beside a real detected silence, and 5 of
  them sit exactly on one's midpoint. What separates them from correct boundaries is the ordinal
  relationship between the cut and the two segments' own claimed words (WS1 Session AE:
  `faAnchorTrustGate.ts`, zero false positives across 37 ear-verified controls in 3 corpora, where the
  same rows resisted every amplitude/energy/silence-distance signal tried in Sessions Q, R, AB and AD).
  Corollary: a corrected boundary is NOT confined to the word gap it was supposed to land in — measured,
  not one v6 row's ear-verified target lies inside its own gap.
- **A sync rule's threshold/offset must be derived from a measurable acoustic or structural property, never fitted to make specific corpus rows agree.** A constant tuned until known rows pass is a corpus-fitted value wearing a rule's clothes — it will not generalize past the rows used to derive it. When no principled candidate reproduces every known-correct row, the correct outcome is to ship nothing and record the negative (WS1 Session S: none of 7 candidate placement rules satisfied both ear-verified anchors, so none shipped that session).

**Export**
- The WebCodecs export path uses annexb (not AVCC) format end-to-end — enforced by a post-concat frame-count guard.
- Export frame timestamps are absolute (`Math.round(frameIndex * 1e6 / fps)`), never an accumulating per-frame delta.
- AnnexB piece concatenation must go through `TauriFfmpeg.concatAnnexbPieces` (2 file descriptors open at a time) — never an ffmpeg concat-protocol invocation (`-i concat:a|b|c|...`), which opens every piece simultaneously and can exceed macOS's per-process FD limit.
- Muxing a raw annexb stream must use `-r <fps>`, never `-framerate` (the latter only sets the demuxer's displayed rate, not the per-packet duration the muxer writes).
- Video and audio must be muxed in *separate* ffmpeg invocations — combining `-shortest` with a still-PTS-less `-c:v copy` video stream silently drops audio.
- Color space is tagged at mux time (`-colorspace bt709` etc.) — a canvas-source `VideoFrame`/`VideoEncoder` has no `colorSpace` API to set directly.
- Cancel must terminate the export worker *before* killing the ffmpeg session it's streaming into.

**Drag/timeline**
- A drag-resize cascade only restacks the contiguous index window it actually touched (anchored on the edge the drag doesn't move) — never a global recompute of every `startTime`.
- A cascade neighbor can never be stripped of *all* its own words — a head-yielding neighbor's start may not pass its own last word's onset, and vice versa for a tail-yielding one.
- Dragging never locks a segment, and an already-locked neighbor is an impassable wall for a cascade.
- **The last segment's right edge is not draggable, in either direction** — `segments[N-1].end === mediaDuration` is a hard invariant w.r.t. drag (its left edge remains a normal boundary drag). Enforced via `DRAG_CASCADE_OPTIONS.conserveTotalDuration`, opt-in to the drag path only — never route an undo/redo restore or the playback-speed slider through it (see Undo/redo invariants).
- **A cancelled drag (`pointercancel`) always discards (reverts to pre-gesture state), never commits** — only a genuine `pointerup` commits. `dragSession.ts`'s `handleCancel` sets a `wasCancelled` flag checked before the negligible-drag/commit branches.

**Testing**
- Sync/anchor timing is regression-locked: `src/services/syncTiming.test.ts` (150+ tests) plus `scripts/phase4-handoff-replay-sync.test.ts` (the golden-baseline replay against 3 real corpus projects) protect it — the golden replay is the signal every future sync-timing change should be diffed against, and a failure there names the boundary to investigate, never a reason to re-baseline blindly.
- **Golden replay's reach stops at `snapCoveredBoundaries`, and a green 6/6 is therefore NOT evidence about forced alignment.** It reads Whisper tokens and silences and runs parse → align → distribute → snap. It never computes a chunk plan, never runs FA, and never runs a rule (R.5, R.10, R.11, R.12, R.13, R-U, R-MD, R.14, R.15) — measured, zero references to any of them in that file. So a change confined to `faChunkPlan.ts`, the FA path, or any rule gate leaves the fixtures byte-identical no matter how many boundaries it moves in the app, and **deleting a rule on the strength of a green golden replay is deleting code no fixture protects.** Rule-stage changes are verified against the live FA arms instead (`scripts/ws1-session-p-pipeline.ts`'s `runProductionPath`, plus a per-boundary diff), never against golden replay alone.

---

## 5. Working Rules

**State updates — immutable only.**
```ts
// DO
setProject(prev => ({
  ...prev,
  segments: prev.segments.map((s, i) => i === idx ? { ...s, duration: val } : s)
}));

// DO NOT — direct mutation before setState
const newSegs = [...project.segments];
newSegs[idx].duration = val;
setProject(p => ({ ...p, segments: newSegs }));
```

**IDs.** Use `crypto.randomUUID()` — never `Math.random().toString(36).substr(2,9)`.

**Component decomposition.** Extract before adding: don't add new features directly into `App.tsx` as a monolith. Target structure (build toward this as features are touched):
```
App.tsx                 — top-level state + orchestration only
  components/            — SyncWizard, LeftPanel/*, PreviewStage, Timeline, modals
  services/               — syncEngine.ts, stockService.ts, and siblings (extracted, pure)
  hooks/                  — usePlayback.ts, useExport.ts, and siblings
```

**Audit/investigation reports must be persisted into `docs/`**, not left to live only in a chat transcript — implementation work must never depend on recalling a prior conversation.

**Do-not list.**

| Rule | Reason |
|---|---|
| Mutate an array/object before `setState` | React may not re-render correctly; breaks history's snapshot-sharing invariant |
| `Math.random().toString(36).substr(2,9)` for IDs | `substr` deprecated; collisions possible in bulk imports |
| `any` type | Use proper types or `unknown` + guards |
| Label an export file `.webm` | Container is real MP4 (H.264/AAC) |
| Add features to `App.tsx` without extracting a component first | Makes the monolith worse |
| Put secret API keys in `vite.config.ts`'s `define` | Baked into the client bundle, publicly visible |
| Add an asset to `project.assets` without calling `putAsset` first | Blob URL dies with the tab — asset vanishes on reload |
| `useEffect` with missing dependencies | Stale closures |
| Recreate functions inside render without `useCallback` | Spurious effect re-runs |
| A filter in `FILTERS` without a `getFilterStyle` case | Shows in dropdown, applies nothing |
| Non-globally-unique segment IDs | Timeline and React keys break on collision |
| `-framerate` on an ffmpeg mux of a raw annexb stream | Wrong per-packet duration for PTS-less packets — use `-r <fps>` |
| Use raw-timestamp proximity to decide two things are the same (a boundary, an R.1 anchor, a breath-vs-boundary silence) anywhere in the sync/FA pipeline | Timestamps blur 100–900ms across a real seam — "close" isn't "the same"; identity is token-index business (`snapBoundaries.ts`, `faAnchors.ts`) |
| `FontFace.load(url)` inside the WebCodecs export worker | Fails with a NetworkError against fonts.gstatic.com in real WKWebView — fetch bytes on the main thread instead (`fontResolver.ts`) |
| Assume a canvas-source `VideoFrame`/`VideoEncoder` config has a `colorSpace` field | Only the buffer-source overload has one — tag color space at mux time instead |
| Call `setProjectRaw` outside `App.tsx`'s `setProject`/`setProjectSilent` | Desynchronizes `liveProjectRef`, corrupting the next `setProject` call's `prev` |
| Use `projectRef` (not `liveProjectRef`) to derive undo history's pre-edit state | `projectRef` lags batched updates — two `setProject` calls in one handler can push a duplicate state |
| Make lock/unlock undoable | Interacts unpredictably with the block-on-locked-segment undo policy (owner ruling) |
| "Restore everything except the locked segment" on a blocked undo | Not buildable under snapshots — breaks the gapless invariant by construction |
| Route an undo/redo restore through `computeDragCascade` | Its `conserveTotalDuration` guard rejects a legitimate differing-total restore |
| Size a snapshot-history design from JSON byte counts | JSON can't represent structural sharing — wildly overestimates real heap cost |
| An ffmpeg concat-protocol invocation for the WebCodecs export path's AnnexB pieces | Opens every piece file at once — exceeds macOS's per-process FD limit; use `TauriFfmpeg.concatAnnexbPieces` |
| Add a resolution tier without updating `RESOLUTION_TABLE` for all 3 aspect ratios | A missing cell is a compile error — but still needs a deliberate dimension decision per ratio |
| Store `width`/`height` directly on `Project` | Always derive via `resolutionConfig.ts`'s `resolveDimensions` |
| Expose `aspectRatio` as editable anywhere in the UI | Locked forever at creation by design |
| Move a file into or out of `scripts/fixtures/` without checking `scripts/` first | See §7 — every file there is read by hardcoded path in `scripts/*.py`/`scripts/*.test.ts`, including the golden-replay test itself |
| Base64-encode a large binary payload (audio, video, any file-sized blob) to cross the Tauri IPC bridge | ~5-8x memory inflation across the JS heap and the WKWebView bridge before Rust ever sees it. Send it as the raw IPC request body instead (`tauri::ipc::Request`/`InvokeBody::Raw`) — precedent: `ffmpeg.rs`'s `ffmpeg_write_file_raw`, `whisper.rs`'s `whisper_stage_audio_raw`, `fa_dev.rs`'s `fa_stage_audio_raw` |

**Documentation rules.** Five docs, one job each, enforced by a short anti-bloat header at the top of every one of them: `CLAUDE.md` (durable operating manual, cap ~400 lines), `project-state.md` (perishable situation report, cap ~250 lines, six fixed sections), `docs/work-in-progress.md` (one-line-per-task active ledger), `docs/history.md` (append-only archive, never edited mid-workstream), `docs/wkwebview-drag-checklist.md` (live manual QA procedure only — run history goes to `docs/history.md`). Before adding to any of the five, re-read its header and put the content in the one file whose job it actually is.

---

## 6. Conventions and Patterns

**TypeScript.** `strict: true`. No `any` — proper types or `unknown` + type guards. Prefer explicit return types on functions.

**Layering.** Services (`src/services/`) are plain, dependency-light modules — pure functions where possible, no React/DOM. Hooks (`src/hooks/`) own React state/effects and call into services. Components (`src/components/`) render; business logic belongs in a service or hook, not inline in JSX handlers.

**Testing.** Vitest (`npm test` / `npm run test:watch`). Pure logic modules (sync math, drag math, history) get direct unit tests with hand-written fixtures — no DOM needed. DOM-touching modules that resist direct unit testing (`usePlayback.ts`, `useGlPreview.ts`, `useExport.ts`'s timer/chime behavior) are verified manually instead — a known, accepted gap, not an oversight.

**Exports.** Output is MP4 (H.264 + AAC), named `{name}_{timestamp}.mp4`.

**Environment variables.**

| Variable | Used in | Required? |
|---|---|---|
| `VITE_PEXELS_API_KEY` | `src/services/stockService.ts` | Optional — stock search silently disabled if missing |
| `VITE_PIXABAY_API_KEY` | `src/services/stockService.ts` | Optional |
| `VITE_COVERR_API_KEY` | `src/services/stockService.ts` | Optional — Coverr video search silently skipped if missing |

Secret/backend-only keys (any future AI/backend key) must go through a backend proxy — never into `vite.config.ts`'s `define`.

---

## 7. Where Things Live

- **Current status, active tasks, deferred bugs** → `project-state.md` (single source of truth for what's in flight).
- **History of completed work** — every dated fix, bug investigation, commit SHA, and measured number that used to live in this file's File Map, plus the full sync-pipeline v2 research trail → `docs/history.md`.
- **Accepted-but-not-yet-implemented sync pipeline redesign** → `docs/ws1-sync-pipeline/sync-pipeline-v2-plan.md`. Read before touching any file under `src/services/` that participates in sync timing/alignment.
- **Active workstream folders** → `docs/ws1-sync-pipeline/` (sync pipeline). A folder is deleted once its workstream closes, with its content folded into `docs/history.md` — `docs/wkwebview-drag-checklist.md` is the deliberate exception (a standing, repeated procedure, not a one-time investigation).
- **Standing manual verification procedure** → `docs/wkwebview-drag-checklist.md` — run before any release and after any change to `dragSession.ts`/`dragCascade.ts`/`dragGeometry.ts`/timeline CSS.
- **Ruling records** → `docs/history.md`'s "Decisions Log — Dissolved from `docs/decisions/`" section, one dated subsection per ruling (Model P, last-segment-edge lock, pointercancel discard-vs-commit, undo/redo design). `project-state.md`'s "Rulings In Force" section indexes them; the operative one-liner for each also lives in this file's §4 Invariants.
- **ffmpeg sidecar re-provisioning** → `src-tauri/binaries/README.md`.
- **Test fixtures read by hardcoded path** (golden baseline, forced-alignment ground truth, transcript-inspector exports) → `scripts/fixtures/`, indexed by `scripts/fixtures/README.md`. **WS1 research-phase measurement data** (not read by any script) → `docs/ws1-sync-pipeline/measurements/`, indexed by its own `README.md`.

**No CSV/JSON data files live in `docs/` — they're test fixtures, not documentation.** Files a `scripts/*.py` or `scripts/*.test.ts` reads by *hardcoded path* (the `phase4-baseline-*.csv` golden baseline, `verification-baseline.csv`, the `*-Smear-Phase2a.csv` exports, the core `phase3-onset-*-fa*.csv` tables) live in `scripts/fixtures/`, beside their readers — see `scripts/fixtures/README.md`. Everything else (WS1 research-phase measurement output, including `v6-smear-baseline.csv`/`173-smear-baseline.csv`) lives in `docs/ws1-sync-pipeline/measurements/` — see its `README.md`. Before moving any file into or out of `scripts/fixtures/`, grep `scripts/` for its filename; if there's a hit in a `.py`/`.ts` file (not a `.md` runbook or docstring), every one of those hardcoded paths must be updated in the same commit, and the golden replay (§4 Testing) re-verified 3/3 — see `docs/history.md`'s "Docs Restructure Phase 5" entry for what it costs to skip that check.
