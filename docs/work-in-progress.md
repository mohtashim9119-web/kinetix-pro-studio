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

- [ ] 1. Decouple `duration`↔`playbackSpeed` coupling on a video-segment drag (ruled a bug, owner 2026-08-08, decouple) — mechanism in `resolveDragEdge` (`src/services/dragGeometry.ts`); needs a purpose-built drag fixture since no corpus project exercises an interactive drag. Sequencing/gate notes: investigation doc §2.
- [ ] 2. Fix bottom-drawer slip-trim bar overflow — prior fix (`a7044c1`) closed one of two root causes; remaining cause is an unclamped `leftPct + widthPct` sum reachable via an ordinary left-edge Timeline drag. Detail: investigation doc §3.
- [ ] 3. Investigate the 5.0s hard limit / stretch behavior — status unknown, no reference found anywhere in the repo; needs an owner repro before it can be worked
- [ ] 4. Get an owner ruling on deleting the unreachable trim/editor UI (`isAdjustingTrim`/`trimmingSegmentId`/`editingSegment`) — confirmed dead code, superseded by `BottomDrawer.tsx`
- [ ] 5. Verify duplicate-asset assignment on re-sync — unverified against the current matcher (`syncEngine.ts`'s `isFuzzyMatch`/`findAssetByContext`/`autoMatchSegments`); repro hypothesis: stage N segments each matched to a distinct asset, delete one asset without resyncing, re-run Apply Sync, check whether two segments silently share an `assetId`

Full state for both workstreams: [`docs/ws1-sync-pipeline/`](ws1-sync-pipeline/), [`docs/ws3-video-segments/video-segment-investigation.md`](ws3-video-segments/video-segment-investigation.md).
