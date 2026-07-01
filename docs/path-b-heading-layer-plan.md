# Path B — Separate Heading Layer (Roadmap)

> Status: PLANNED, not scheduled. Deferred in favor of export-performance work (2026-07-02).
> Supersedes bugs D4 + D5 — both are symptoms of the same coupling this refactor removes.

## Goal

Lift headings out of the segments array into a dedicated, absolute-time-addressed overlay layer, so the sync/duration pipeline ignores headings entirely and invariant (b) (Σ segment duration = voiceoverDuration) applies to CONTENT ONLY.

## Why (root cause)

Headings are NOT pure overlays in code today — they are first-class VideoSegment array members carrying real startTime/duration/anchorStart, occupying real timeline seconds STOLEN from neighbors via floating-point steal/give math (`.toFixed(3)` add/subtract across neighbors). That neighbor-perturbation is the structural root of:
  - D4 — lock/heading ops revert manual drag edits (re-derive from stale anchors)
  - D5 — locked-segment duration grows but never shrinks (threatens invariant b)

Extraction dissolves both by removing the coupling rather than patching the math.

## Refactor surface (from audit, HEAD 38f0dc6)

- ~47 isHeading production references; ~75 heading-special refs across 13 files.
- Files: App.tsx, syncEngine.ts, whisperService.ts, frameRenderer.ts, PreviewStage.tsx, Timeline.tsx, DropZonePanel.tsx, ReviewMappingModal.tsx, SegmentControls.tsx, BottomDrawer.tsx, TextLayersPanel.tsx, exportPipeline.ts, types.ts.
- Helpers to DELETE: computeHeadingAnchors, reinsertHeadings, stealDurationFromNeighbors, giveDurationToNeighbors.
- Helpers to SIMPLIFY/BYPASS: applyHeadingTiming, applyAnchorBasedTiming, parseProjectData heading-skip.
- Handlers to rewrite: handleInsertHeading, handleDeleteHeading, handleMoveHeading.
- ~12 of 24 syncTiming.test.ts tests become obsolete or need rewriting.

## Design decisions to LOCK before any code (open questions)

1. New data model: headings as a top-level Project field (e.g. `headings: HeadingOverlay[]`) addressed by absolute time. Define the type, serialization, and IndexedDB/localStorage round-trip.
2. Re-anchor rule across clean-slate Apply Sync: absolute timestamp vs nearest-word. (Current impl re-anchors on neighbor assetId/ordinal — fragile, being replaced.)
3. Scene-boundary semantics: decide whether headings still MARK scene boundaries or become purely visual.
4. Render model: preview needs a "which heading covers currentTime?" lookup; export needs to COMPOSITE heading frames ONTO content frames (not replace them) — new code in frameRenderer/exportPipeline.
5. Persistence migration: one-time lift of `segments.filter(isHeading)` into the new layer on load, re-timing remaining content. Must handle legacy `heading && !text` shape and any stale `[HEADING:]` scene-text tags.

## Risks

- Touches the REGRESSION-LOCKED sync pipeline (invariant a, protected by syncTiming.test.ts + sync-known-good tags). Sync tests must be rewritten for the new architecture BEFORE the timing changes land, so the net is never removed while the protected code changes.
- Export path (frameRenderer/segmentEncoder/exportPipeline) — currently untouched by all prior fixes — gains a heading-compositing step. Must be validated against real renders on macOS + Windows.
- Data safety: existing saved projects store headings inside segments; a broken migration loses user headings.

## Phased approach (each phase individually tsc+vitest-gated; no phase ships without green)

- Phase 0 — Lock the 5 design decisions above (design doc, no code).
- Phase 1 — Introduce the new HeadingOverlay type + Project.headings field + persistence migration (dual-read: accept both old in-array headings and new layer). No behavior change yet.
- Phase 2 — Rewrite syncTiming tests for content-only timing (net for the new world) BEFORE touching timing code.
- Phase 3 — Remove headings from the timing/sync pipeline (delete steal/give, simplify applyAnchorBasedTiming); headings now free-floating.
- Phase 4 — Rewire render: preview time-window lookup + export compositing.
- Phase 5 — Rewire UI: Timeline/DropZonePanel/ReviewMapping/SegmentControls to the new layer; heading drag by absolute time.
- Phase 6 — Delete dead helpers, obsolete tests, and legacy in-array heading code. Final regression + manual export test both platforms.

## Restore anchor

Before starting Phase 3 (first sync-pipeline change), tag the repo (e.g. `path-b-pre-timing`) as a bisect/restore target.
