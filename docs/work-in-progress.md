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
Current focus: Task 5 — Rust integration for forced alignment (Phase 3). See `docs/ws1-sync-pipeline/ws1-master-roadmap.md`'s NEXT UP block.

- [x] 1. Apply Sync history-entry fix (Slice 1) — commit `1b16a50`
- [ ] 2. Slice 2 — re-derive the 50/50 silence-split rule (park-commit `210855d`, `snapBoundaries.ts` + Apply-Sync plumbing) against current `main`. Will deliberately break the golden replay — budget a per-boundary review, never a blind re-baseline of `scripts/fixtures/phase4-baseline-*-segments.csv`.
- [ ] 3. Verify stale-anchor scroll degradation with a dedicated test (currently asserted correct by code reading only, no test)
- [ ] 4. Word-shift defect — fix the 2 remaining v2-fixable cases (`does the same‖what the job`, `s youngest scout‖a girl of`); the 3rd (`seasons than you‖can count and`) is a script-vs-narration authority conflict, not fixable by any timing-source change. Evidence: `docs/ws1-sync-pipeline/boundary-drift-investigation.md`. Expected to resolve as a side effect of task 5's token-smear-cascade fix (`docs/ws1-sync-pipeline/roadmap-2026-08-07.md` §D2), not as standalone work — task 6's "blocked on task 4" therefore really means blocked behind task 5.
- [ ] 5. Rust integration for forced alignment — not started; NOT BLOCKED — all three Rust gates are closed (Spanish accuracy via Step U, structural checks via Steps W/X, heading assignment via Option A). Per owner ruling R-B, the fr/de/pt unvalidated-language warning surfaces (Step T.7) ship in this same task/release, not after. CTC Viterbi forced-alignment DP ported to Rust, commit `6a0ac21` (no inference wired yet). **ort/onnxruntime native-runtime blocker resolved 2026-08-12** (see below) — the remaining work is wiring, not a runtime-provisioning research problem.
- [ ] 6. Resume Pipeline Contract Program — paused, blocked on task 4 (`docs/ws1-sync-pipeline/sync-pipeline-v2-plan.md` Part J)
- [ ] 7. Re-attempt the boundary-quality watcher — prior attempt reverted (safety-bound failure, React render loop, uncalibrated formula); resumption point at `docs/ws1-sync-pipeline/watcher-revert-2026-08-03.diff`, not source to reintroduce as-is
- [x] 8. K13 fix — lock preservation across resync. **Done 2026-08-11.** Owner ruling R-C: fixed fresh against `main`, porting only the logic/idea from the parked `model-p-editor-work` branch, never its stale code — `preserveSegmentLocks` (`App.tsx`) restores `locked`/`startTime`/`duration` by unique `assetId` after `autoMatchSegments`/`preserveEffectFields`, bound-checked and validated against `findPartitionViolations`. Verified: 11 unit tests (`src/services/preserveSegmentLocks.test.ts`), the inverted `scripts/phase4-step-w-k13-repro.test.ts` (now proves the fix holds, 3/3), 5 manual tests. Gates at close-out: `npm run lint` clean, `npm test` 72 files/1803 passed/1 skipped/0 failed, golden replay 3/3, `cargo check` clean.
- [ ] 9. Phase 3b — language-keyed number/currency normalization (per-language number words and reading rules, currency equivalents, inverted thousands separators, French elision vs. English contraction expansion; full spec `docs/ws1-sync-pipeline/sync-pipeline-v2-plan.md` Part H.5). GATE: English path must stay byte-identical to today's baseline.
- [ ] 10. Phase 3c — hyphen/word-split fix (`textNormalize.ts` glues a mid-call hyphenated word into one alignment word while Whisper emits two tokens, understating the segment's end). **Must land before Phase 5; gates the Stage 1 lock** — the last Stage-1 index-shifting event (`docs/ws1-sync-pipeline/sync-pipeline-v2-plan.md:3725-3726`).

**Rulings (WS1-specific):**
- **R-A — 22 blank `boundary-quality-flag` rows deferred, non-blocking** (2026-08-11). WS1 does not pause for an ear-listening pass to fill them in. Item tracked in Deferred / Known Bugs below.
- **R-B — the fr/de/pt "unvalidated language" warning (Step T.7) ships with Phase 3/task 5**, same task/release, not after. Referenced in task 5 above.
- **R-C — `model-p-editor-work` stays permanently unmerged; K13 fixed fresh against `main`, porting only the logic/idea, never the stale branch code** (2026-08-11). **CLOSED** — full fix record at task 8 above.
- **Heading-wildcard assignment (Option A)** — unscripted audio (spoken chapter headings) is absorbed entirely by the preceding segment, logged as an explicit `unscripted-gap` entry. Owner decision 8, recorded in `docs/ws1-sync-pipeline/sync-pipeline-v2-plan.md`'s Steps Y–Z section. Blocks v2 Phase 5, not Phase 3.
- **Spanish forced-alignment gate — cleared.** Step F's breath-aware reference scores p95 50.4ms against the approved 250ms gate (1 of 22 pauses over) — passes. All three WS1 Rust-integration gates (Spanish accuracy, structural checks, heading assignment) are closed. Evidence: `docs/ws1-sync-pipeline/spanish-gate-scoring.md`, `docs/ws1-sync-pipeline/measurements/`, `docs/ws1-sync-pipeline/roadmap-2026-08-07.md` §D2, `docs/ws1-sync-pipeline/sync-pipeline-v2-plan.md` Step U/T.7.
- **ort/onnxruntime native-runtime blocker — RESOLVED, not yet ratified into `project-state.md`** (2026-08-12). R-M's "from-source onnxruntime build required" premise superseded: `ort`'s `api-NN` Cargo features are a configurable minimum-version floor (default requires onnxruntime ≥1.27; disabling all `api-NN` features drops the floor to 17), and the existing onnxruntime-osx-x86_64 binary (v1.23.2 is the correct pin, not v1.22.0 — see below) loads and runs a full forward pass through the real Rust `ort` binding with fidelity-verified output (0/49 argmax mismatches vs. the torch reference). Full evidence: `docs/ws1-sync-pipeline/measurements/runtime-unblock-2026-08-12.md`. **This ruling update to R-M and the still-open R-N packaging decision are formal `project-state.md` edits — deferred to the end-of-Task-5 documentation pass, pending owner approval**, per the process rule below. `src-tauri/Cargo.toml` was not touched; this was investigated entirely in a gitignored scratch crate.
- **Process rule (permanent, all future WS1 tasks):** during implementation, only this file and files under `docs/ws1-sync-pipeline/` are written. `CLAUDE.md`, `docs/history.md`, and `project-state.md` require explicit owner approval and are batched to task completion — never touched at the end of a part or sub-task without that approval.

Full record for all five: `docs/history.md`'s "Decisions Log — Dissolved from `docs/decisions/`" section.

**Deferred / Known Bugs:**
- **CLOSED 2026-08-05 — Adaptive per-voice silence thresholds (Phase 3d).** Investigated and SKIPPED per Phase 2b's own measurement: the fixed −45dB threshold is not the binding constraint (ground-truth pauses verified real against the waveform; the failure is entirely token-side, not silence-side). Reopens only if task 5/Phase 3's post-forced-alignment measurement shows a silence-side cost. Evidence: `docs/history.md:4265`, `docs/ws1-sync-pipeline/ws1-master-roadmap.md:118,325`, `docs/ws1-sync-pipeline/sync-pipeline-v2-plan.md:553`.
- **`boundaryUsedFallback` calls `isBreathSilence` with 4 arguments instead of 5** (`src/services/snapBoundaries.ts`) — the omitted 5th parameter silently defaults to disabling the seam exemption, so every `validateBoundaryQuality` reading on a seam-exempted pair has been wrong since it shipped. Diagnostic-only — never affects a committed boundary. Scheduled for v2 Phase 7; self-resolves if v2 Phase 6 deletes the exemption instead.
- **Stuck `resizingId` on an early-bail drag start** (`src/services/dragSession.ts`) — **WONTFIX (owner ruling, 2026-08-08).** Unreachable through the UI (both bail conditions require state a real gesture can't produce), and fixing it would retire a characterization test that proves the WS2 task-1 extraction was behavior-preserving. The desired behavior is pinned as a deliberately skipped spec test (`dragSessionHarness.test.ts` PART 4) and the residue is actively audited by `acknowledgeKnownResidue`, which fails if the residue ever stops appearing. Ruling lapses if the path ever becomes reachable.
- **22 blank `boundary-quality-flag` rows** in `scripts/fixtures/verification-baseline.csv` — deferred, non-blocking (owner ruling R-A, 2026-08-11, see Rulings above). WS1 does not pause for an ear-listening pass to fill them in.

Full state: [`docs/ws1-sync-pipeline/`](ws1-sync-pipeline/).
