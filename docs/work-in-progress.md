# Work In Progress

> **Purpose:** the active task ledger — absorbs all task-level churn so `CLAUDE.md`
> and `docs/history.md` are never touched mid-workstream. **One line per task, no
> narrative** — detail lives in commit messages and the workstream folder
> (`docs/ws1-sync-pipeline/`, `docs/ws3-video-segments/`). Write each block in final
> archival form from the start: on completion or abandonment, move it verbatim to
> `docs/history.md` under a dated heading (mark abandoned blocks with the reason) and
> delete it here — completion is a copy-paste, never a rewrite. Multiple concurrent
> workstreams get separate blocks. Status marks: `[x]` done, `[>]` in progress, `[ ]`
> not started.

---

## WS1 — Sync Pipeline Rewrite
Started: 2026-08-04 | Status: active

- [x] 1. Apply Sync history-entry fix (Slice 1) — commit `1b16a50`
- [ ] 2. Slice 2 — re-derive the 50/50 silence-split rule (park-commit `210855d`, `snapBoundaries.ts` + Apply-Sync plumbing) against current `main`. Will deliberately break the golden replay — budget a per-boundary review, never a blind re-baseline of `scripts/fixtures/phase4-baseline-*-segments.csv`.
- [ ] 3. Verify stale-anchor scroll degradation with a dedicated test (currently asserted correct by code reading only, no test)
- [ ] 4. Word-shift defect — fix the 2 remaining v2-fixable cases (`does the same‖what the job`, `s youngest scout‖a girl of`); the 3rd (`seasons than you‖can count and`) is a script-vs-narration authority conflict, not fixable by any timing-source change. Evidence: `docs/ws1-sync-pipeline/boundary-drift-investigation.md`.
- [ ] 5. Rust integration for forced alignment — not started; blocked on the Spanish FA gate question (see `project-state.md` Open Decisions)
- [ ] 6. Resume Pipeline Contract Program — paused, blocked on task 4 (`docs/ws1-sync-pipeline/sync-pipeline-v2-plan.md` Part J)
- [ ] 7. Re-attempt the boundary-quality watcher — prior attempt reverted (safety-bound failure, React render loop, uncalibrated formula); resumption point at `docs/ws1-sync-pipeline/watcher-revert-2026-08-03.diff`, not source to reintroduce as-is

## WS3 — Video Segments
Started: 2026-08-08 | Status: active

- [x] 1. Decouple `duration`↔`playbackSpeed` coupling on a video-segment drag (ruled a bug, owner 2026-08-08, decouple) — `playbackSpeed` removed as a concept from `VideoSegment` and every read/write site; a video clip always plays at its native rate, freezing its last frame if shorter than the segment or playing a `trimStart`-positioned window if longer. Owner manually verified (real MP4 export, both preview paths, full `docs/wkwebview-drag-checklist.md`).
- [x] 2. Fix bottom-drawer slip-trim bar overflow (bundled with Task 1) — `resolveDragEdge` clamps a `'start'`-edge drag's `trimStart` to `[0, max(0, sourceDuration - duration)]`; `slipBarGeometry.ts` composes `leftPct + widthPct` exactly once (`rightPct`, clamped to 100). Owner manual testing of this surfaced a separate tail defect (preview stall on Case B long-clip slip) that took four further investigation passes — see `docs/ws3-video-segments/ws3-audit.md`'s close-out section for the full account. Three of those passes landed real, independently-verified fixes kept in this baseline (commit-once-at-release in `BottomDrawer.tsx`, `Asset.duration` as the single source of truth for clip length, `findChunkRange`'s keyframe-only scan); none of them was the cause of the reported stall, which remains open — see the new item below, not part of this task.
- [x] 3. Investigate the 5.0s hard limit / stretch behavior — resolved as a duplicate of Task 1: the audit's leading hypothesis (a `clipLen × 2` emergent ceiling from the now-removed speed-coupling clamp) is confirmed as this feature's own clamp, and Task 1's decoupling closes it.
- [x] 4. Delete the unreachable trim/editor UI (`isAdjustingTrim`/`trimmingSegmentId`/`editingSegment`, owner ruling: delete) — removed from `App.tsx`/`Timeline.tsx`/`timeline.render.test.tsx`. Owner manually verified.
- [x] 5. Remove duplicate-asset assignment in the untagged/context fallback (owner ruling: no fallback to the full assets array, ever) — `parseProjectData`'s fallback now matches only `availableAssets`; `autoMatchSegments` (`syncEngine.ts`) closed the same class of gap by seeding and growing its own `usedAssetIds` set. Owner manually verified.

## Preview stall — open, unresolved
Opened: 2026-08-10 | Status: open, cause unknown

- [ ] Video segment preview stalls/blacks-out/drops transitions when a long clip is slipped toward its end (Case B, near max slip). Repro: ~10s clip in a ~3.4s segment, slip toward the end. Preview only — exports render correctly from the same `trimStart`. Reproduces on a freshly reloaded project sitting at max slip with **no drag gesture involved**, which clears every gesture/timing-race theory as the cause. Five fix attempts across the trim math, the asset model, and the decode pool's concurrency/range-lookup logic all landed real, kept improvements but none resolved this. Two live leads for the next pass — full account in `docs/ws3-video-segments/ws3-audit.md`'s close-out section: (1) `feedWindow`'s untested exposure to the same chunk non-monotonicity `findChunkRange` was fixed for, (2) the legacy-`<video>` A/B toggle (dev-only, see below) to learn whether the WebCodecs decode pool is implicated at all.

Full state for both workstreams: [`docs/ws1-sync-pipeline/`](ws1-sync-pipeline/), [`docs/ws3-video-segments/video-segment-investigation.md`](ws3-video-segments/video-segment-investigation.md).
