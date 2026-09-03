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
- **A detector-based repair's go/no-go gate is the detector's PRECISION, measured before the repair is built — never the collateral-ratio measured after fixing a target set.** A detector that fires on most chunks/rows for a rare defect (e.g. a signal true on two-thirds of chunks against ~13 real defects, ~7% precision) will move far more correct boundaries than defective ones no matter how good the repair built on it is, because the repair cannot learn which firings were real. State the precision first; if it is not defensible, ship nothing (WS1 Session AH: S1, keyed on a ~7% phantom-tail detector, scored favorably on its target rows in Session AG but was rejected 18/18 on ear audit of its full collateral set — the census showing the low precision was already in hand when it shipped to measurement).
- **A no-ears validator for a sync-timing change must not be built from the output of the very arm the change alters.** Such a validator measures itself: a defect in that arm reads as agreement with its own broken reference. (WS1 Session AH: a word-gap-containment proxy scored against FA's own word timings had a *negative* separation margin between known-good and known-bad boundaries — the known-bad range sat inside the known-good range — because the phantom rows that make a boundary wrong are exactly the rows whose FA-derived reference is itself wrong.) A validator needs a reference independent of the arm under test — a second aligner, a different model, or ears.
- **A corpus that structurally cannot exhibit a proposed cause is the strongest available control, and a regression surviving there refutes the cause as a general explanation before the affected corpus is consulted.** Pick the control by whether the mechanism *can* operate, not by whether you expect movement. WS1 Session AK tested whether R.5 recitation excision explained S2's regressions: v6 carries 10 recitations, 173 and Spanish carry **zero**, so excision is inert there by construction — measured, arm C returned chunk plans *and* FA words byte-identical to arm B on both. 173 nonetheless regressed 40 boundaries identically under both arms, which settled the general question without needing v6's numbers at all; v6's own result (14 of 30 controls repaired exactly, drift -23.786s → -19.155s) then sized a *contribution* rather than establishing a cause. The corollary is the useful half: **a structural null also validates the change itself** — any movement on a corpus where the mechanism cannot operate means the implementation is doing something other than what it claims, and every number it produced elsewhere is uninterpretable until that is explained.
- **A drift that returns to zero was never cumulative.** Before attributing a systematic timing error to an accumulating index/offset mistake, plot it against timeline position: an accumulating error is monotone and ends at its extreme, whereas a per-region displacement that something re-anchors rises, peaks, and comes back. WS1 Session AK measured S2's v6 drift as an **arch** — peaking mid-corpus and returning to 0.157s in the final decile, identically in two arms — which retired the "cumulative drift" framing the defect had been carried under for two sessions and redirected the search to a local, per-chunk mechanism.
- **A wider forced-alignment chunk window is a capacity question AND a separate, independent accuracy question — clearing the first proves nothing about the second.** The ONNX context sweep (WS1 Session AH, `sync-pipeline-v2-plan.md` AB.10) ran cleanly to 120s with no failure point, which bounds memory/wall-clock only. WS1 Session AI shipped a sentence-bounded planner (`computeFaChunkPlanS2`, 10-30s chunks, unshipped) that stayed inside that capacity envelope on every corpus yet produced up to -27.7s of systematic negative alignment drift on v6 (30 ear-verified controls regressed) while 173/spanish showed far smaller or zero drift — a real accuracy cost the capacity sweep gave no warning of. Treat a longer/denser chunk as an accuracy risk to be measured against ear-verified controls, never inferred safe from a memory/timing sweep alone.
- **Before attributing a systematic timing error to a stage, plot the identical profile for the stage UPSTREAM of it — a downstream error that merely inherits an upstream one is not evidence about the downstream stage at all.** The upstream profile is also the validator a self-referential one cannot be: it is computed before any arm and cannot be moved by any of them. WS1 Session AL measured a period-strict 1-15s chunk plan (arm D) against 10-30s arms on v6 and found the drift arch UNCHANGED in shape and slightly LARGER in amplitude (-20.617s vs -19.155s) at half the chunk width — eliminating chunk width outright — while `applyAnchorBasedTiming`'s own per-decile error against the oracle turned out to be the same arch, correlating with arm D's drift at r = 0.9940 (arm B 0.9778, arm C 0.9732). Corollary, and the reason the arch is an arch: Σ content-segment duration = voiceoverDuration, so a character-weight estimate distributes a FIXED total and its error is a redistribution that must sum to zero across the corpus — **an arch is the signature of a conserved-total distribution error, never of an accumulating one.**
- **A drift's correlation with an upstream error curve (r ≈ 0.97-0.99) is a candidate mechanism, not a demonstrated one — confirm it by substituting the suspected input directly and checking whether the drift dies, not by the correlation alone.** WS1 Session AL found v6's S2 drift arch correlated with `applyAnchorBasedTiming`'s own per-decile error at r = 0.9940 but stopped short of claiming causation ("correlation with an upstream error is consistent with several causal routes"). WS1 Session AM tested it directly: replacing every S2-family chunk edge's estimate-derived seam with a `faAnchors.ts` three-source-agreement anchor (index-space nearest-match, zero numeric constants) cut v6 oracle regressions 76% (279 → 68) and killed the drift arch outright (peak 3.249s against a ≤5.0s DIED band, from arm C's 19.155s SURVIVED), with a second arm placing edges at the oracle's own attested times killing it further (0.042s, 2 regressions) as the ceiling. One row was traced end to end as direct mechanistic confirmation rather than aggregate correlation: `231_slowing_pace`'s FA confidence collapse held identically across three prior arms because its chunk's closing seam was exactly one of five documented anchor-substitution fallbacks, and cleared only under the oracle-placed arm that reached that specific seam.

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
- **A fixture's REACH is established by a destructive probe, never by a green run — the probe is the artifact, and a suite that has never been deliberately broken has unmeasured reach.** A passing gate is compatible with two indistinguishable worlds: the change is safe, or the gate cannot see the change. Green alone never separates them, and no amount of green accumulates into evidence that it can. So before a fixture is cited as coverage for a class of change, deliberately introduce the exact defect it is claimed to catch and confirm it goes red; if it stays green, its reach stops short of that class and it must be described by what it actually guards, not by its name. Worked instances, both in this repo: golden replay produced byte-identical output across three different normalization regimes before anyone asked whether it *could* move (see the next bullet, and note the settling probe ran two sessions after the question was live); and the `tokenHash` column was added as coverage and is real, but delivered only PROSPECTIVE coverage — a destructive probe confirmed the hash moves when hashed directly, while the same probe showed zero movement on all three committed corpora, for the structural reason that none of them contains a character that can move it. Corollary for fixture DESIGN: a symmetric fixture — one whose two sides are both derived from the same input, e.g. `whisperService.languageThread.test.ts`'s `tok('más')` against `seg('más')` — cannot detect a divergence between those sides, because the divergence is the thing it authors away. That is a correct test of the fold and no test at all of the divergence; say which one you have.
- **Golden replay's reach stops at `snapCoveredBoundaries`, and a green 6/6 is therefore NOT evidence about forced alignment.** It reads Whisper tokens and silences and runs parse → align → distribute → snap. It never computes a chunk plan, never runs FA, and never runs a rule (R.5, R.10, R.11, R.12, R.13, R-U, R-MD, R.14, R.15) — measured, zero references to any of them in that file. So a change confined to `faChunkPlan.ts`, the FA path, or any rule gate leaves the fixtures byte-identical no matter how many boundaries it moves in the app, and **deleting a rule on the strength of a green golden replay is deleting code no fixture protects.** Rule-stage changes are verified against the live FA arms instead (`scripts/ws1-session-p-pipeline.ts`'s `runProductionPath`, plus a per-boundary diff), never against golden replay alone.

**Repo operations** (same standing as the probe rule above — both are about not trusting an operation that *looks* like it succeeded)

- **Stage named paths only — never `git add -A`, `git add .`, or `git add -u`.** This repo carries standing untracked directories that are deliberately out of scope (`public/` since Phase 3), and a wildcard stage sweeps them in silently: the commit looks correct, the diff is only inspected for the intended files, and the stray path is found later. Care at the keyboard cannot make a wildcard safe in a repo shaped like this one — the fix is the mechanism, not the vigilance. Worked instance: `public/ws2-23-seed.json` was committed this way and untracked in WS2 T4.1 Step 4.
- **Never redirect into an existing file with `>` — read it, write the replacement to a temp path, then `mv` it into place.** A shell redirect truncates before the writer runs, so a mistake destroys the original with no undo and no git history when the path is gitignored (`.claude/`, `src-tauri/binaries/`). Worked instance: `.claude/launch.json` was overwritten this way in WS2 T4.1 and recovered only because its content happened to still be in the session's context — recovery-by-luck, not a property of the process.

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

**What belongs on a settings surface — the live-feedback criterion (owner ruling, WS2 T4.1).** A control belongs in App Settings or Project Settings when it has **no live visual feedback at its point of use**: the user cannot tell what it did by looking, so it needs a named home, a label, and Save/Cancel. A control that shows its effect immediately where it already lives **stays there** — moving it into a modal removes the feedback loop that made it usable and makes the control strictly worse. The criterion is about the control's feedback, not about its storage scope: a machine-global persisted value is not automatically a setting.

Ruled OUT by this criterion, deliberately and not by oversight: **style presets and look presets** (`kinetix:stylePresets:v1`, `kinetix:lookPresets:v1`) are a machine-global *content library*, authored and previewed in the Effects tab, not a setting; and the **five per-project global effects fields** (`globalTransition`, `globalTransitionDuration`, `globalAnimation`, `globalOverlayFilter`, `globalOverlayConfig`) render into the preview the instant they change. Both groups were found by WS2 T4.1's Step 0 settings-inventory sweep and excluded on this rule — do not re-litigate either without overturning the criterion itself.

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
| `git add -A` / `git add .` / `git add -u` | Sweeps in standing untracked, out-of-scope paths (`public/`) — stage named paths only |
| Redirect into an existing file with `>` | Truncates before the writer runs; unrecoverable for gitignored paths — write to a temp path and `mv` |
| Base64-encode a large binary payload (audio, video, any file-sized blob) to cross the Tauri IPC bridge | ~5-8x memory inflation across the JS heap and the WKWebView bridge before Rust ever sees it. Send it as the raw IPC request body instead (`tauri::ipc::Request`/`InvokeBody::Raw`) — precedent: `ffmpeg.rs`'s `ffmpeg_write_file_raw`, `whisper.rs`'s `whisper_stage_audio_raw`, `fa_dev.rs`'s `fa_stage_audio_raw` |

**Documentation rules.** Five docs, one job each, enforced by a short anti-bloat header at the top of every one of them: `CLAUDE.md` (durable operating manual, cap ~400 lines), `project-state.md` (perishable situation report, cap ~250 lines, six fixed sections), `docs/work-in-progress.md` (one-line-per-task active ledger, cap 300 lines), `docs/history.md` (append-only archive, never edited mid-workstream), `docs/wkwebview-drag-checklist.md` (live manual QA procedure only — run history goes to `docs/history.md`). Before adding to any of the five, re-read its header and put the content in the one file whose job it actually is.

**`docs/work-in-progress.md`'s five-section structure contract (permanent).** Every workstream in that file (WS1, WS2, and any future one) carries exactly five sections, in this fixed order, with these exact names: (1) Finished but pending verification — complete, a proof step still outstanding; (2) In progress — required tasks listed first, one **END GOAL:** line at the bottom (mandatory even when the section is `(none)`); (3) Next tasks; (4) Open bugs; (5) Deferred tasks. Sections are never renamed, reordered, or omitted — a new workstream is created with all five headings present even if empty. A workstream carries no dedicated "finished work" section in this file at all — a closed item is dropped from whichever section it occupied and folded into the workstream's own top-of-section `Status:` line (one line, prose) plus its full record in `docs/history-2.md`; this file never grows a running list of completed pointers. The short contract summary at the top of `docs/work-in-progress.md` itself is this entry's mirror, not a second source of truth; this entry is authoritative.

**Tag vocabulary (file-wide, `docs/work-in-progress.md`).** `[OPEN]` = unresolved, no fix built. `[IN-PROGRESS]` = actively worked. `[DEFERRED]` = real defect, work explicitly paused by an operator decision. `[OPEN · NON-BLOCKING]` = real, confirmed-open defect that doesn't block a lock/release gate — not "accepted" or "not a bug." `[CLAIM-UNVERIFIED]` = not a code defect — an operational task/claim not yet confirmed by direct evidence. Tags describe an item's state; the section describes where it lives — if a tag would contradict its new section, the section wins. Finished-but-pending-verification entries carry no bracket tag (prose format only); tags apply only to In progress / Next / Open bugs / Deferred.

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
