# Path B — Separate Heading Layer (Plan)

> Status: **IN PROGRESS — Phase 0 complete (2026-07-08), Phase 1 next.**
> Supersedes bugs D4 + D5 — both are symptoms of the same coupling this refactor removes.
> All six design decisions below are **LOCKED** (user-approved 2026-07-08). Do not reopen without a documented decision.

## Goal

Lift headings out of the segments array into a dedicated, absolute-time-addressed overlay layer (`Project.headings: HeadingOverlay[]`), so the sync/duration pipeline ignores headings entirely and invariant (b) (Σ segment duration = voiceoverDuration) applies to CONTENT ONLY.

## Why (root cause)

Headings are NOT pure overlays in code today — they are first-class VideoSegment array members carrying real startTime/duration/anchorStart, occupying real timeline seconds STOLEN from neighbors via floating-point steal/give math (`.toFixed(3)` add/subtract across neighbors). That neighbor-perturbation is the structural root of:
  - D4 — lock/heading ops revert manual drag edits (re-derive from stale anchors)
  - D5 — locked-segment duration grows but never shrinks (threatens invariant b)

Extraction dissolves both by removing the coupling rather than patching the math.

## Locked design decisions (Phase 0 — final, user-approved 2026-07-08)

### Decision 1 — Data model: top-level `Project.headings: HeadingOverlay[]`

A new top-level field on `Project` (types.ts), **fully separate from `segments` at every level** — not a flag on a segment, but a genuinely independent array with its own complete styling/settings shape (font, size, weight, color, background, x/y, etc.), designed so future heading-only features (e.g. text animations) can be added without touching segment code at all. Working sketch (final field list settled in Phase 2):

```ts
interface HeadingOverlay {
  id: string;              // crypto.randomUUID()
  time: number;            // absolute start, seconds into the voiceover (Decision 2)
  duration: number;        // seconds; edge-draggable on the timeline (Decision 3)
  text: string;
  // complete, self-contained styling — deliberately NOT shared with
  // TextOverlay/headingConfig, so heading-only features never touch segment code
  fontFamily: string;
  fontSize: number;
  fontWeight: number | string;
  color: string;
  backgroundColor: string; // default OPAQUE — visual parity with today (Decision 4)
  x: number;
  y: number;
  needsReview?: boolean;   // set when a re-sync clamps `time` (Decision 2)
}
```

**Residual risk:** some styling fields duplicate TextOverlay's shape. Deliberate — independence is the point; do not "deduplicate" them back together.

### Decision 2 — Re-anchor rule: fixed absolute timestamp

Headings **never move on re-sync**, regardless of content/audio changes. On re-sync, if `heading.time` exceeds the new voiceoverDuration, clamp it to the new duration and set `needsReview` so the user is flagged to review it — **never auto-delete**.

**Residual risk:** after a large script edit, a heading's fixed timestamp may no longer sit over the content it was authored against — it does not track content. Accepted: the review flag covers the only destructive case (out-of-range); content drift is the user's editorial call.

### Decision 3 — Creation + display model

- Creation trigger unchanged: **"+ Add Heading"** button when hovering between two segments in the left panel (same UX as today). Creates a HeadingOverlay at that boundary's timestamp (`time` = the following segment's startTime, default duration 1.0s) — **no neighbor duration steal**; overlays take no timeline seconds.
- **Left panel (segments tab):** the heading still appears as its own row in the list, positioned between the two segments it falls between — same visual/sequential behavior as today. Row position is *derived from `heading.time`* relative to segment boundaries, not stored as an array position.
- **Preview + timeline:** the heading does NOT occupy a segment slot. It renders as an overlay layer at its exact time range, compositing over whichever segment(s) fall within that range. It is **edge-draggable on the timeline** to grow/shrink its duration, fully independent of segment boundaries.
- Headings are **no longer scene boundaries** — sceneDetails parsing does not split on them (see Decision 6).

**Residual risk:** because row position is time-derived, a re-sync that moves segment boundaries can make a heading's left-panel row appear between a *different* pair of segments than at creation. Correct by design under Decision 2 (the heading stayed put; the content moved).

### Decision 4 — Render model: composite-on-top (permanent, not a patch)

A single shared helper **`getActiveHeadingAt(headings, t)`** is the one lookup used by both PreviewStage (preview) and frameRenderer/exportPipeline (export) — no per-caller reimplementation. Default `backgroundColor` stays opaque, so the visual result matches today unless the user changes it.

**Mandatory in this work, not deferred:** `plainSegment.ts`'s Tier 1 fast-path predicates (`isPlainVideoSegment`/`isPlainImageSegment`) gain a **"no heading overlay intersects this segment's time range"** check. An export that silently drops a heading via the fast path is a real bug, not an edge case — headings now overlap segments instead of replacing them, so a "plain" segment can carry a heading.

**Residual risk:** content segments overlapped by a heading lose the Tier 1 fast path and fall back to the per-frame canvas pipeline. Accepted perf cost — correctness first; the predicate change can only make exports slower, never wrong.

### Decision 5 — Migration: NONE

User is discarding all existing test projects and starting fresh. **No old-shape-to-new-shape migration code is built.** Old in-array heading handling is deleted once the new system is verified working — no data-preservation constraint. (`projectStore` defaulting `headings` to `[]` when the key is absent is a default, not a migration.)

**Residual risk:** none.

### Decision 6 — `[HEADING:]` tag: full immediate purge (early phase, NOT deferred)

Unlike the original plan (cleanup deferred to the final phase), this is an **early, explicit, standalone step**. Requirement: if `[HEADING: filename.jpg]` (or any `HEADING:` text) appears in a scene doc, the parser **completely ignores the `HEADING:` keyword and treats the remainder as a normal asset tag** — matching "filename.jpg" and creating a normal segment, exactly as if the tag read `[IMAGE: filename.jpg]`. No special-case recognition, no scene-boundary behavior, no heading creation from scene-doc text, ever.

Retires:
- `isHeadingTag` (App.tsx:287) — the recognize-and-skip branch in parseProjectData
- the `/^\[HEADING\s*:/i` exclusion filter in textUtils.ts:147 (and the heading-special comments around lines 20/108/137)
- the old boundary-behavior fixtures in sceneTagParsing.test.ts — rewritten to assert the new ignore-and-match-filename behavior

**Residual risk:** any old scene doc still containing real `[HEADING:]` tags now produces asset-match attempts (normal segments) instead of skipped boundaries. Accepted — consistent with Decision 5's fresh start; there is no legacy content to protect.

## Approach — incremental build, then delete

The new HeadingOverlay system is built and verified **alongside** the old in-array system. This is justified **only** by protecting the regression-locked sync-pipeline tests (`syncTiming.test.ts`, ~35 tests, plus the sync-known-good tags) during the transition — **not** by data-migration safety (none needed per Decision 5). Production flows cut over to the new layer at Phase 5; the old code and its tests stay green-but-unreachable until Phase 7 deletes both together. Because there is no legacy data to protect, deletion happens as soon as the Phase 6 verification gate passes — sooner than originally planned.

## Refactor surface (audit refreshed at HEAD 93bd6b2)

- Production files referencing `isHeading`: App.tsx, BottomDrawer.tsx, DropZonePanel.tsx, PreviewStage.tsx, ReviewMappingModal.tsx, SegmentControls.tsx, Timeline.tsx, useFirstFrameCache.ts, useWebCodecsPreview.ts, frameRenderer.ts, plainSegment.ts, syncEngine.ts, whisperService.ts, types.ts.
- Test files with heading fixtures: syncTiming.test.ts (~35 tests), lockedOverlap.test.ts, plainSegment.test.ts, sceneTagParsing.test.ts.
- Helpers deleted in Phase 7: `computeHeadingAnchors`, `reinsertHeadings`, `stealDurationFromNeighbors`, `giveDurationToNeighbors` (syncEngine.ts); `applyHeadingTiming` (whisperService.ts).
- Handlers rewritten in Phase 5: `handleInsertHeading`, `handleDeleteHeading`, `handleMoveHeading` (App.tsx).

## Phases

Each phase is individually `tsc --noEmit` + vitest gated; no phase ships without green. Phases 1 and 2 are independent of each other; everything from Phase 3 on is strictly ordered.

### Phase 0 — Lock design decisions ✅ DONE 2026-07-08

This document. No code. The six decisions above are final.

### Phase 1 — `[HEADING:]` scene-tag purge (standalone, shippable) ← NEXT

Implements Decision 6 in full. Does NOT touch the in-array heading system — "+ Add Heading" keeps working exactly as today.

- **Files touched:**
  - `src/App.tsx` — delete the `isHeadingTag` test + `continue` (~line 287) in parseProjectData; a `[HEADING: …]` tag falls through to the normal asset-tag path (keyword ignored, remainder fuzzy-matched as a filename, normal segment created).
  - `src/services/textUtils.ts` — remove the `/^\[HEADING\s*:/i` exclusion filter (~line 147); update the heading-special comments (~lines 20, 108, 137).
- **Tests:**
  - `src/services/sceneTagParsing.test.ts` — REWRITE the `[HEADING:]` fixtures: assert `[HEADING: foo.jpg]` matches `foo.jpg` and yields a normal segment (parity with `[IMAGE: foo.jpg]`); assert no scene-skip/boundary behavior. DELETE the old boundary-behavior assertions.

### Phase 2 — HeadingOverlay data model + persistence + shared lookup

No behavior change; old system untouched. Dual existence begins.

- **Files touched:**
  - `src/types.ts` — add `HeadingOverlay` interface (final field list from the Decision 1 sketch) + `headings: HeadingOverlay[]` on `Project`.
  - **NEW** `src/services/headingLayer.ts` — `getActiveHeadingAt(headings, t)` (the single shared lookup, Decision 4); `clampHeadingsToDuration(headings, voiceoverDuration)` (Decision 2: clamp + `needsReview`, never delete); `createHeading(time, …)` factory with defaults (opaque background, 1.0s duration).
  - `src/services/projectStore.ts` — serialize/deserialize `headings`; default `[]` when absent.
  - `src/App.tsx` — `headings: []` in the blank-project factory.
- **Tests:**
  - **NEW** `src/services/headingLayer.test.ts` — lookup boundary semantics (start-inclusive/end-exclusive, overlapping headings), clamp+flag behavior (in-range untouched, out-of-range clamped + flagged, never removed), factory defaults.

### Phase 3 — Composite-on-top rendering (preview + export) + Tier 1 fast-path guard

Implements Decision 4. New-layer headings only exist via dev/test data until Phase 5 — verified here with injected data.

- **Files touched:**
  - `src/services/frameRenderer.ts` — after content/filter/overlay/transition draw, composite the active heading (via `getActiveHeadingAt`) on top; opaque default background gives visual parity with today's heading segments.
  - `src/services/exportPipeline.ts` + `src/services/segmentEncoder.ts` — thread `project.headings` into per-frame render options; frame time computed as absolute (segment startTime + frame offset) so the lookup is timeline-correct.
  - `src/services/plainSegment.ts` — predicates take the headings list (or a precomputed intersection flag) and return `false` when any heading intersects `[startTime, startTime + duration)` — the mandatory Decision 4 guard.
  - `src/components/PreviewStage.tsx` — render the active new-layer heading as an overlay driven by `getActiveHeadingAt(currentTime)`.
- **Tests:**
  - `src/services/plainSegment.test.ts` — new cases: heading fully inside a segment / straddling a segment edge / exactly touching a boundary (no overlap) / far away — only true non-intersection stays on the fast path.
- **Manual gate:** export a project where a heading straddles two otherwise-plain segments — the heading must appear in the output (fast path correctly bypassed).

### Phase 4 — Timeline display + edge-drag duration resize

- **Files touched:**
  - `src/components/Timeline.tsx` — render headings as an overlay band positioned at absolute time over the track (no segment slot); edge-drag handles resize `duration` (left edge also shifts `time`), independent of segment boundaries; reuse the `f4da926` ref+rAF live-drag pattern (no `setProject` per mousemove, commit once on mouseup).
  - `src/App.tsx` — heading resize/retime commit handler (immutable update of `project.headings`).
- **Tests:** none automated for the drag gesture (manual-verify, per repo convention); any min-duration/clamp rules introduced here land as `headingLayer.test.ts` unit tests.

### Phase 5 — Creation + left panel + editing cutover to the new layer

From this phase on, **no code path creates in-array heading segments** — the old system becomes unreachable but stays present and tested.

- **Files touched:**
  - `src/App.tsx` — `handleInsertHeading` rewritten: creates a HeadingOverlay at the boundary timestamp (Decision 3), no segment insert, no neighbor steal; `handleDeleteHeading` → remove from `headings` (no duration give-back — overlays own no timeline seconds); `handleMoveHeading` → retime (`time` update).
  - `src/components/DropZonePanel.tsx` — segments-tab list interleaves heading rows between segment rows by `heading.time` (same visual behavior as today).
  - `src/components/BottomDrawer.tsx` + `src/components/SegmentControls.tsx` — heading editor reads/writes HeadingOverlay fields.
  - `src/components/ReviewMappingModal.tsx` — heading cards read from the new layer (or the modal goes content-only; decide in-phase).
- **Tests:** `syncTiming.test.ts` UNTOUCHED (protected code untouched — must stay green). The row-interleave ordering logic is extracted into `headingLayer.ts` as a pure helper and unit-tested in `headingLayer.test.ts`.

### Phase 6 — Re-sync integration + full verification gate

- **Files touched:**
  - `src/App.tsx` — Apply Sync calls `clampHeadingsToDuration` once the new voiceoverDuration is known; new-layer headings are otherwise untouched by re-sync (Decision 2). The legacy `computeHeadingAnchors`/`reinsertHeadings` calls become natural no-ops (no in-array headings exist in new projects); actual deletion waits for Phase 7.
  - `src/hooks/useWhisper.ts` — confirm the Whisper path is heading-neutral (`applyHeadingTiming` no-ops with zero `isHeading` segments).
  - Minimal `needsReview` surfacing — badge on the heading's left-panel row (and/or timeline band).
- **Tests:** clamp cases already covered in Phase 2; add an integration-style re-sync test if practical.
- **Manual gate (the "fully verified" bar for Phase 7):** end-to-end pass in the Tauri app — create, edit, drag-resize, re-sync (incl. shorter audio → clamp+flag), and export with headings over plain and composited segments.

### Phase 7 — Legacy deletion + sync-pipeline simplification (final)

**Precondition:** Phase 6 manual gate passed. Tag the repo `path-b-pre-deletion` immediately before starting (bisect/restore anchor).

- **Files touched:**
  - `src/types.ts` — remove `isHeading`/`headingConfig` (and any other legacy heading fields) from VideoSegment.
  - `src/services/syncEngine.ts` — delete `computeHeadingAnchors`, `reinsertHeadings`, `stealDurationFromNeighbors`, `giveDurationToNeighbors`; simplify `applyAnchorBasedTiming` to content-only.
  - `src/services/whisperService.ts` — delete `applyHeadingTiming` + heading-special branches.
  - `src/App.tsx` — delete legacy heading branches (`HEADING_DUR`, old handler remnants, heading-skip comments).
  - Sweep every remaining `isHeading` reference: PreviewStage.tsx, Timeline.tsx, DropZonePanel.tsx, ReviewMappingModal.tsx, SegmentControls.tsx, BottomDrawer.tsx, useFirstFrameCache.ts, useWebCodecsPreview.ts, frameRenderer.ts, plainSegment.ts (the line-74 in-array guard is dead once the field is gone).
- **Tests:**
  - `src/services/syncTiming.test.ts` — DELETE heading-carry-forward/steal-give/applyHeadingTiming tests; REWRITE the Σ-duration invariant tests as content-only (invariant (b) now applies to content only — update `project-state.md` Key Invariants wording in the same commit).
  - `src/services/lockedOverlap.test.ts`, `src/services/plainSegment.test.ts` — drop in-array-heading fixtures.
- **Exit:** `tsc` clean, full vitest green, manual export regression on macOS (+ Windows when available).

## Risks (residual, post-decisions)

- **Regression-locked sync pipeline:** the protected tests stay untouched and green through Phases 1–6; only Phase 7 rewrites them, together with the code they cover, behind the `path-b-pre-deletion` tag — the net is never removed while the protected code changes.
- **Export path gains new code** (frameRenderer/exportPipeline compositing) in a previously-untouched pipeline: validated by the Phase 3 manual export gate and the Phase 6 full pass.
- **Tier 1 fast-path change is fail-safe by construction:** the predicate only becomes more conservative (extra `false` → canvas path), so the failure mode is a slower export, never a wrong render.
- Per-decision residual risks are recorded inline in the Locked design decisions section (Decisions 1–4, 6).

## Restore anchor

Tag `path-b-pre-deletion` immediately before starting Phase 7 (first destructive change to the sync pipeline and its tests).
