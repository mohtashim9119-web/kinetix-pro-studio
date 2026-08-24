# Work In Progress

> **Purpose:** the active task ledger — one line per task, no narrative. **Line cap: 250.**
> Chosen because, post-cleanup, live WS1 content is a short list of standing constraints and
> open roadmap items, not a second history file — 250 gives headroom for a few more workstreams
> without inviting narrative back in. When the cap is hit, move finished work to
> `docs/history-2.md` (companion to `docs/history.md`, same append-only rule: never edited
> mid-workstream, only appended to) and re-measure.
>
> WS1's full session-by-session history (Sessions A through AN, the component/measurement
> ledger, and the Changelog) moved to `docs/history-2.md` on 2026-08-25. This file tracks WS1's
> current phase status (Finished / In progress / Not started) plus the constraints that still
> bind it — full session detail lives in `docs/history-2.md`.

---

> ⚠ **SINGLE-TRACKER RULE:** No additional tracking or status files may be created for
> Workstream 1. All task progress, open decisions, and roadmap steps must be recorded directly
> in this file or appended to `sync-pipeline-v2-plan.md`.

---

## WS1 — Sync Pipeline Rewrite
Started: 2026-08-04 | Status: active — Phase 3 in progress, accuracy bar met (see below)

### Finished

- **Phase 1b** — built the dev-only `window.__transcriptInspector()` instrumentation (raw
  Whisper token timestamps vs. detected silence), feeding the smear-baseline data behind Stage 1
  lock's numeric thresholds.
- **Phase 2a** — swapped Whisper to `ggml-large-v3-turbo.bin`, added `Project.language` + the
  unsupported-language guard; gate passed against real-corpus resyncs (2026-08-05).
- **Phase 2b** — measured DTW vs. raw Whisper timestamps as the timing source; DTW abandoned,
  forced alignment chosen for Phase 3; finalized Stage 1 lock's four numeric thresholds
  (2026-08-05).
- **Phase 3b** — shipped 5 language-normalization rules (fr/es/de/pt cardinal & elision
  handling) in `faTextNormalize.ts`; owner ruled single-word-output only, permanently. Closed
  (2026-08-15).
- **Phase 3c** — audited 19 compound-word (hyphen-asymmetry) cases; owner ear-tested both
  candidates and ruled the unfixed timing correct. Closed as an accepted Stage 1 defect, no code
  change (2026-08-15).
- **Phase 3d** — evaluated per its own conditional trigger and skipped: Phase 2b's evidence
  showed the fixed −45dB silence threshold wasn't the binding constraint (2026-08-05). Reopens
  only if Phase 3's post-forced-alignment measurement later shows a silence-side cost — not
  triggered as of the 2026-08-25 accuracy-bar freeze.
- **Sessions A–AN** (Phase 3's forced-alignment research arc, 2026-08-15 to 2026-08-24) — a
  rolling cycle of owner rulings, rule builds (R.5, R.10–R.15), Zero-Defect Register triage, and
  ear-verification audits; the final sub-arc (Sessions AK–AN) chased chunk-edge placement as the
  root cause of residual timing drift. Chunk-width/chunk-edge research is now frozen under the
  accuracy-bar ruling below.
- **Mover-audit dossier** (`stage1-mover-audit.md`) — owner-scored 22/24 (Session K,
  2026-08-18); the 2 failures were root-caused and fixed via R.13. The on-disk dossier file
  itself was never updated to show the scored result — treat `docs/history-2.md`'s Session K
  entry as the record of truth, not the blank table in `stage1-mover-audit.md`.

*Full detail for all of the above: `docs/history-2.md`.*

### In progress

We're in Phase 3 (Task 5), past 3b/3c (closed) and 3d (skipped, dormant). Chunking and
accuracy-improvement research is frozen under the 2026-08-25 accuracy-bar ruling (~97–98% of
boundaries correct on first sync, ≥95% accepted; remaining errors go through manual review in
the UI, not further pipeline changes — see Standing constraints). What's left is closing out
Stage 1's own procedural gate, not further accuracy work.

*This section is updated at the end of every session.*

**END GOAL:** Stage 1 locks once the live acceptance run (prepared, not yet executed —
`stage1-live-run-prep.md`) has been run and passed by the owner; every other STAGE 1 LOCK GATE
criterion (Contract IN / Contract 1→2 owner inspection, determinism, the non-English written
acceptance, R.5/R.10, the mover-audit dossier, no Stage 1 defect deferred downstream) is already
satisfied or accepted in writing.

- [ ] Execute the live acceptance run and get an owner pass/fail verdict
  (`stage1-live-run-prep.md`).
- [ ] Flip `FA_PROJECT_DEFAULT_ON` once the live run passes.
- [ ] Ear-verify the 4 provisional R.12 closures (v6 boundaries 085/224/307/383) — move from
  structurally-correct to ear-verified.
- [ ] Ratify R.7 confidence-flag handling and build its two unbuilt failure paths
  (skip-and-flag, force-split).
- [ ] Produce real `fa-vocab-<lang>.json` production files and wire
  `project.language`/`vocabChars` into both `computeFaChunkPlan` call sites.
- [ ] Task 2 — re-derive the 50/50 silence-split rule in `snapBoundaries.ts` against current
  `main` (independent of the above; will deliberately break golden replay — needs per-boundary
  review, not a blind re-baseline).
- [ ] Task 3 — a dedicated test for stale-anchor scroll degradation (currently only asserted
  correct by code reading).
- [ ] Wire `FaEvent` to a UI progress consumer (no hook/component consumes it yet).

### Not started — Phase 4 through 7

- **Phase 4** (Stage 2 — Align & Select) — restructure the pipeline into the four formal
  stages: Stage 2's return type becomes timing-free, Stage 1's output bundles into one object,
  `distributeSegmentTimes`/`applyAnchorBasedTiming` collapse into Stage 3. Structural only,
  timing held identical.
- **Phase 5** (Stage 3 — Place) — replace the boundary picker with the four-line fence rule;
  delete `computeBoundarySearchWindow`, `isBoundarySilenceCandidate`, `fillsTokenGapWithinSpan`,
  the three-pass contention assignment, and the degenerate-pair guard.
- **Phase 6** (Stage 3 — Place) — deprecate the compensation layer: turn off the seam
  exemption, and if the eight verification pairs still pass, delete `isBreathSilence`, the
  multi-fragment override, the seam exemption, and its four constants.
- **Phase 6b** (Stage 3 — Place) — verify the 173-project's pairIdx-20 boundary (defect at
  75.660 vs. target 76.470), likely resolved by Phase 5.
- **Phase 7** (Stage 4 — Finalize & Report) — observability: log entries with plain-language fix
  hints for every clamp/floor/fallback/degenerate-boundary/estimated-timing decision; fix the
  `boundaryUsedFallback` argument-count bug.

Sequencing: Stage 1 lock → Phase 4 → Stage 2 lock → Phase 5 → Phase 6 → Phase 6b → Stage 3 lock
→ Phase 7 → Stage 4 lock.

### Standing constraints

- **Stage/Phase terminology:** Stage 1 = Prepare (phases 1b, 2a, 2b, 3, 3b, 3c, 3d); Stage 2 =
  Align & Select (phase 4); Stage 3 = Place (phases 5, 6, 6b); Stage 4 = Finalize & Report
  (phase 7). Task 5 = Phase 3, inside Stage 1.
- **Stage lock status:** 0 of 4 stage locks passed.
- **`textNormalize.ts`/`canonicalize` must never change** — frozen English alignment baseline;
  non-English work goes through the separate `faTextNormalize.ts` path instead.
- **fr/de/pt real narration-audio corpus does not exist** — only synthetic fleurs-audio engine-
  parity fixtures do. Accepted in writing (H.8 dormant-rules allowance); reopens only if
  fr/de/pt-specific code ships.
- **Zero-Defect Register:** not driven to 0 — 6 rows remained open as of Session AN
  (2026-08-24, the last WS1 session before the accuracy-bar freeze): `214_solitary_fire`,
  `231_slowing_pace`, `447_scout_facing_dark`, `400_endless_dark`, `173/lethal_nature_hazard`,
  `173/gadget_decay`. Accepted as residual defects under the accuracy bar rather than pursued
  further.
- **FA default toggle** (`Project.faHighPrecisionSync` / `FA_PROJECT_DEFAULT_ON`): currently
  **OFF**, pending the live acceptance run (see In progress checklist).
- **Contract 1→2 compliance:** 6 of 8 requirements met. P4 (silence assertion) and P8 (bundled
  Stage-1 output object) are satisfied by Phase 4, not before.
- **Do not re-investigate** (all confirmed dead ends): DTW (confirmed dead twice); `--vad`
  (needs an unbundled model); the curr-side seam-exemption variant (disabled); FENCE/QUIET
  word-shift fixes (both failed); the "246 PICK-WRONG" figure (debunked — overcounts by ≥45,
  only 11 ear-verified cases are trustworthy).
- **Boundary-quality watcher:** do not reintroduce as previously built — the prior attempt was
  reverted for a safety-bound failure, a React render loop, and an uncalibrated formula.

---

*Full WS1 history: `docs/history-2.md`.*
