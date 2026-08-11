# Work In Progress

> **Purpose:** the active task ledger — absorbs all task-level churn so `CLAUDE.md`
> and `docs/history.md` are never touched mid-workstream. **One line per task, no
> narrative** — detail lives in commit messages and the workstream folder
> (`docs/ws1-sync-pipeline/`). Write each block in final
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
- [ ] 4. Word-shift defect — fix the 2 remaining v2-fixable cases (`does the same‖what the job`, `s youngest scout‖a girl of`); the 3rd (`seasons than you‖can count and`) is a script-vs-narration authority conflict, not fixable by any timing-source change. Evidence: `docs/ws1-sync-pipeline/boundary-drift-investigation.md`. Expected to resolve as a side effect of task 5's token-smear-cascade fix (`docs/ws1-sync-pipeline/roadmap-2026-08-07.md` §D2), not as standalone work — task 6's "blocked on task 4" therefore really means blocked behind task 5.
- [ ] 5. Rust integration for forced alignment — not started; NOT BLOCKED — all three Rust gates are closed (Spanish accuracy via Step U, structural checks via Steps W/X, heading assignment via Option A). Per owner ruling R-B, the fr/de/pt unvalidated-language warning surfaces (Step T.7) ship in this same task/release, not after.
- [ ] 6. Resume Pipeline Contract Program — paused, blocked on task 4 (`docs/ws1-sync-pipeline/sync-pipeline-v2-plan.md` Part J)
- [ ] 7. Re-attempt the boundary-quality watcher — prior attempt reverted (safety-bound failure, React render loop, uncalibrated formula); resumption point at `docs/ws1-sync-pipeline/watcher-revert-2026-08-03.diff`, not source to reintroduce as-is
- [ ] 8. K13 fix — lock preservation is broken across resync (see `project-state.md` Deferred and Known-Broken). Owner ruling R-C (2026-08-11): fix fresh against `main`, porting only the logic/idea from the parked `model-p-editor-work` branch, never its stale code — order-keyed carry-forward of `locked` into the freshly-parsed array (`parseProjectData`/`preserveEffectFields` in `App.tsx`). Signal: `scripts/phase4-step-w-k13-repro.test.ts` must start failing when fixed.
- [ ] 9. Phase 3b — language-keyed number/currency normalization (per-language number words and reading rules, currency equivalents, inverted thousands separators, French elision vs. English contraction expansion; full spec `docs/ws1-sync-pipeline/sync-pipeline-v2-plan.md` Part H.5). GATE: English path must stay byte-identical to today's baseline.
- [ ] 10. Phase 3c — hyphen/word-split fix (`textNormalize.ts` glues a mid-call hyphenated word into one alignment word while Whisper emits two tokens, understating the segment's end). **Must land before Phase 5; gates the Stage 1 lock** — the last Stage-1 index-shifting event (`docs/ws1-sync-pipeline/sync-pipeline-v2-plan.md:3725-3726`).

Full state: [`docs/ws1-sync-pipeline/`](ws1-sync-pipeline/).
