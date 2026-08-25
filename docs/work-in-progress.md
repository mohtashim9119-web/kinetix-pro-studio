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
> current phase status (Finished / In progress / Open bugs / Not started) plus the constraints
> that still bind it — full session detail lives in `docs/history-2.md`.

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
  itself was never updated to show the scored result — `docs/history-2.md`'s Session K entry is
  the record of truth, not the blank table in `stage1-mover-audit.md`.

*Full detail for all of the above: `docs/history-2.md`.*

### In progress

We're in Phase 3 (Task 5), past 3b/3c (closed) and 3d (skipped, dormant). Chunking and
accuracy-improvement research is frozen under the 2026-08-25 accuracy-bar ruling (~97–98% of
boundaries correct on first sync, ≥95% accepted; remaining errors go through manual review in
the UI, not further pipeline changes — see Standing constraints).

*This section is updated at the end of every session.*

**Stage 1 lock**

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

**Other active work (not part of Stage 1 lock)**

- **OOM memory fix** — partly fixed. ORT's per-shape memory-pattern allocation cache was
  disabled (`a6f2978`, WS1 Session AO Step 4, `src-tauri/src/fa_onnx.rs:421-452`). Cause: the
  ONNX session is cached in `FaModelCache` (`src-tauri/src/fa.rs:113`), a Tauri-managed `State`
  that lives for the whole app-process lifetime and is reused across every Apply Sync, so a
  per-input-shape allocation plan accumulates without release. Every prior memory measurement
  missed it by running one corpus per process (Sessions AK/AM/AL's `fa-run-resources.json`) —
  never the shape the live app takes. Measured before the fix (Session AO Step 1,
  `.work-phase4/session-ao/rss_timeline.csv`): across a v6 → 173 → spanish → v6-again run, RSS
  rose monotonically for 1584 of 1585 one-second samples, jumped +771 MiB at the spanish
  cache-miss boundary, and peaked at 4220.0 MiB — ~1 GiB above the highest single-corpus peak on
  record (v6 alone, 3205.3 MiB, Session AK). Verified output-neutral after the fix (exact
  boundary equality on v6/173/spanish, golden replay 6/6, oracle diff green, all 13 production
  pins reproducing). Open: the fix's memory effect was never re-measured — no post-fix RSS run
  exists — and no session record isolates what drives the single-corpus footprint itself. No
  owner.

### Open bugs

Audited 2026-08-25 against current `main` — full mechanism/fix-design detail for every surviving
row: `sync-pipeline-v2-plan.md` Part AI. One row (chunk-plan non-determinism) closed that session,
see `docs/history-2.md`.

- **OOM crash, partial fix** — see "Other active work" above for what's fixed and what's still
  open. No owner on the remainder. Fix design: Part AI §1. **Conditionally blocks Stage 1's live
  acceptance run** — do the cheap post-fix RSS re-measurement before that run, not a code blocker.
- **`boundaryUsedFallback` calls `isBreathSilence` with 4 arguments instead of 5**
  (`src/services/snapBoundaries.ts:381-382`; the correct 5-arg call exists at `:744-745`) —
  defaults the seam exemption off, so every boundary-quality reading on a seam-exempted pair has
  been wrong since it shipped. Slated for Phase 7; no one currently on it. Fix design (2-line,
  internal-only, no signature change): Part AI §2. **Defers** — diagnostic-only, never touches
  committed segment timing.
- **5 open Zero-Defect Register rows** — boundary-placement defects, ear-verified wrong, with no
  rule that fixes them yet: `214_solitary_fire`, `231_slowing_pace`, `447_scout_facing_dark`,
  `173/lethal_nature_hazard`, `173/gadget_decay` (live list:
  `scripts/ws1-session-ak-step1-gate.ts:59`'s `OPEN_DEFECTS`, matching the AJ-0 oracle's
  `openDefect` rows). `400_endless_dark` is closed at 1266.75, ear-verified by the `full-pass-aj0`
  sitting (`scripts/ws1-ear-pass-ledger.ts:907`). Accepted as residual defects under the accuracy
  bar rather than pursued further; no owner. Audit: Part AI §4 — no fixable design slot without
  contradicting the accuracy-bar ruling; the permanent path is the already-planned Pillar 2
  detector. **Defers** — already accepted in writing under that ruling.
- **Alignment cost has no enforced bound for real inputs** (Contract A4; `__ALIGN_INSTRUMENT__`
  dormant) — an unbounded input can hang the UI behind the loading overlay with no error
  surfaced. No owner; disposition deferred to Stage 2 lock. Needs a cost-vs-input-size measurement
  before a fix can be designed: Part AI §5. **Defers** — the live run's 3 corpora are already
  known-safe sizes.

### Not started

- **Pillar 2 passive detector** (`src/services/faDefectDetector.ts`) — a read-only
  post-processor that flags suspect boundaries; it never moves a timestamp itself. Spec (4
  rules, recorded here so they don't need re-deriving):
  1. Boundary-to-anchor drift — flag if the cut sits more than 100ms from a reliable
     three-source-agreement anchor.
  2. Cut-on-speech — flag if speech energy is present at the cut line.
  3. Cross-segment token overflow — flag if word timestamps cross the cut between adjacent
     segments.
  4. Edge confidence drop — flag if alignment confidence on boundary-adjacent words falls
     sharply against the segment median.

  Measurable against the AJ-0 oracle's labelled boundaries (`scripts/fixtures/session-aj0-oracle-
  {v6,173,spanish}.json`, `openDefect`/`earTarget` fields) with no listening required, and must
  clear ruling R-AS's precision bar (`MIN_IMPLIED_PRECISION = 0.50`,
  `scripts/ws1-session-ak-step1-gate.ts:124`) before any repair built on it ships.
- **Sync log revamp** — strip developer telemetry from the sync log UI; replace with six
  collapsible groups, in this order:
  1. Skipped segments (no audio match) — audio with missing transcription, or text that never
     matched.
  2. Unscripted audio assigned — speech detected that isn't in the script.
  3. Missing assets — script segments with no audio attached.
  4. System info — engine status (e.g. FA on, sync succeeded, 444 of 447 segments clean).
  5. Cuts landed on speech — boundaries that need a small silence adjustment.
  6. Shifted words / low confidence — flagged directly by the Pillar 2 detector, for one-click
     review in the UI. The important one.

  Depends on the Pillar 2 detector existing first — Group 6 renders the detector's output.
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
  `boundaryUsedFallback` argument-count bug (see Open bugs).
- **Bounded-memory options for the residual OOM footprint** — a capped `FaModelCache` session
  cache, or process isolation per sync. Unbuilt.

Sequencing: Stage 1 lock → Phase 4 → Stage 2 lock → Phase 5 → Phase 6 → Phase 6b → Stage 3 lock
→ Phase 7 → Stage 4 lock.

### Standing constraints

- **The oracle** — `scripts/fixtures/session-aj0-oracle-{v6,173,spanish}.json`, the operator's
  own ear-verified live-app saves (no boundary ever manually dragged), 647 boundaries total (v6
  447, 173 173, spanish 27), 5 labelled `openDefect` rows (v6 3, 173 2; spanish 0) carrying the
  ear-correct `earTarget`. Enforced (structural invariants only — segment count, tag order; not a
  per-boundary gate) by `scripts/ws1-session-aj0-oracle-diff.test.ts`. Also usable as a
  no-listening precision evaluation set (see Pillar 2 spec, Not started).
- **Golden replay does not observe the FA chunk plan or any rule stage** — it stops at
  `snapCoveredBoundaries`/`headExtendFirstSegment` and imports neither `faChunkPlan.ts` nor
  `faAnchorTrustGate.ts`. Measured: it stayed 6/6 while arm D moved 366 v6 boundaries (363
  regressed) in the same session (`sync-pipeline-v2-plan.md`'s Part AF).
- **`152_frozen_brush_mice`, `iron_bounce`, `logic_clash`** are RULE-DEPENDENT (R.14, R.15, R.15
  respectively, `src/services/faAnchorTrustGate.ts`) — closed only because the rule fires;
  deleting R.14/R.15 reopens them (`scripts/ws1-session-ah-step1-rowstatus.test.ts:14-19`).
- **Do not re-investigate (dead ends, cont'd):** S1/`foldPhantomTails` — deleted outright after
  scoring REGRESSION on 18 of 18 operator ear verdicts (Session AH); the phantom-tail existence
  detector it was built on — ~7.1% precision (183/277 v6 chunks fire, ~13 real defects); global
  S2 — rejected on 0.62% implied R-AS precision (36 ear-verified control regressions, up to
  -27.7s v6 drift).
- **`S1_KNOWN_BAD_MOVES`** (`scripts/ws1-ear-pass-ledger.ts:1011`, 19 values) — S1's full
  collateral set, all operator-rejected; the project's negative ground truth for detector
  validation, and a hard-fail if any future chunk-edge arm reproduces one.
- **Spanish corpus acceptance has silently lapsed, unresolved** — accepted in writing unlistened
  at Stage 1's lock-gate entry, with a reopening trigger voided "the moment any Spanish-specific
  normalization/alignment code ships"; Phase 3b shipped Spanish cardinals on 2026-08-15, which
  satisfies that trigger's literal text, but no session has ruled on whether it actually reopens
  the acceptance. Flagged for the owner (`sync-pipeline-v2-plan.md:7918-7925`).
- **Arms F/G/H** (`src/services/faChunkPlan.ts`'s `computeFaChunkPlanS2EdgeArm`,
  `S2EdgePlacement` kinds `'anchor'`/`'attested'`/`'anchor-widened'`) are diagnostic-only with no
  production caller — every call site is an env-gated Session AM/AN measurement test. Arm G
  consumes ground truth directly (`attestedStartBySegIdx`, sourced only from the oracle fixture
  in `ws1-session-am-step4-armg.test.ts`) and is unreachable from `src/` by construction, not
  convention — the field has no default and nothing under `src/` reads the oracle fixture.
- **Stage/Phase terminology:** Stage 1 = Prepare (phases 1b, 2a, 2b, 3, 3b, 3c, 3d); Stage 2 =
  Align & Select (phase 4); Stage 3 = Place (phases 5, 6, 6b); Stage 4 = Finalize & Report
  (phase 7). Task 5 = Phase 3, inside Stage 1.
- **Stage lock status:** 0 of 4 stage locks passed.
- **`textNormalize.ts`/`canonicalize` must never change** — frozen English alignment baseline;
  non-English work goes through the separate `faTextNormalize.ts` path instead.
- **fr/de/pt real narration-audio corpus does not exist** — only synthetic fleurs-audio engine-
  parity fixtures do. Accepted in writing (H.8 dormant-rules allowance); reopens only if
  fr/de/pt-specific code ships.
- **R.3/R.8/R.9** (clamp reference point, cascade-safety argument, case-by-case prevention
  table — Step R's production windowing design): drafted, never built. Not required for Stage 1
  lock — the STAGE 1 LOCK GATE criteria list never names them (only R.5/R.10 were added as
  blocking criteria, by owner ruling). Candidate backlog for Phase 5.
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
