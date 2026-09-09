# Work In Progress

> **Purpose:** the active task ledger — one line per task, no narrative. **Line cap: 300**.
> Full history: `docs/history-2.md` (append-only). Standing reference material (frozen rulings,
> dead ends, not-yet-built specs): `sync-pipeline-v2-plan.md` Part AK. Overflow: move finished
> work to `docs/history-2.md`, reference material to the plan doc, then re-measure. Original
> header text: `sync-pipeline-v2-plan.md` Part AK.4.

---

> ⚠ **SINGLE-TRACKER RULE (covers every workstream):** No additional tracking or status files
> may be created for WS1, WS2, or any future workstream. All task progress, open decisions, and
> roadmap steps go directly in this file — each workstream under its own top-level section — or
> get appended to `sync-pipeline-v2-plan.md`.

---

> ⚠ STRUCTURE CONTRACT: Every workstream has 5 mandatory sections in exact order:
> 1. FINISHED BUT PENDING VERIFICATION  2. IN PROGRESS  3. NEXT TASKS  4. OPEN BUGS  5. DEFERRED TASKS.
> The file also ends with BACKLOG ITEMS (cross-workstream, ≤30 words each).
> Tag vocabulary: [OPEN], [IN-PROGRESS], [DEFERRED], [OPEN · NON-BLOCKING], [CLAIM-UNVERIFIED].

---

## WS3 — TEAM RELEASE BLOCKERS
Goal: Export watchdog timeout on heavy/long exports (>100 segments @ 1080p) — the sole remaining blocker for the internal team build.
Status (2026-09-07, `af6a300`/`6930b1d`): the decode-cursor leak that caused exports to die around
wall-clock ~62s is CLOSED — 3/3 live 200s/1080p/6000-frame transitioned+animated runs completed
with `peakOpenCursors:2` held throughout. `FORWARD_PROGRESS_BOUND_MS` (45s) landed alongside the
unchanged 30s `WATCHDOG_MS`, not the originally-proposed 30s→90s bump. Full writeup:
`docs/history-2.md`'s "Export liveness" entry.
1. [OPEN] Append-path batching landed static-only (`docs/ws3-append-path-audit.md`): the 30s
   watchdog was killing COMPLETED exports during their final append drain (a completed append
   reset only the 45s progress bound, never `WATCHDOG_MS`, and no chunk can arrive after 'done').
   Fixed, plus 1-per-chunk `appendFileRaw` IPC batched 100:1 and a 256MB queue ceiling. Unverified
   live: no export was run, so the throughput claim is arithmetic on call count only.
2. [OPEN] Part C 500-segment live export (200s/1080p, transition+animation on every
   boundary/segment) shows intermittent multi-second silent gaps mid-run — reproduced in 1 of 3
   live runs 2026-09-07 (15 intervals >5s, longest 10.74s), never crossing either watchdog so the
   export still completes. Root cause not isolated; most intervals lack phase attribution.

---

## WS2 — Non-Sync Work
Status: OPEN — the general workstream for all development outside the sync pipeline (WS1). Active tasks live in the five sections below; completed items are recorded in `docs/history-2.md`.

Baselines (8dbbcea): vitest 3148 passed / 77 skipped / 0 failed; gaplessInvariant 36/36; golden replay 6/6; K13 3/3; cargo 264/0/2 default and 350/0/32 with --features fa-inference.

### 1. Finished but pending verification

(none)

### 2. In progress

(none)

**END GOAL:** Next implementation from section 3 — transcription Req 2, raw IPC for ffmpeg probes.

### 3. Next tasks

- [OPEN · BLOCKED] Transcription Req 2: incremental draft save — blocked on Rust WhisperEvent partial-token IPC variant; Progress percent-only (whisper.rs:572), tokens only on Done (whisper.rs:632).
- [OPEN] tauriFfmpeg.ts:45-72 Base64 IPC: brief-estimated ~2.33× peak inflation on ~73MiB voiceover (not measured here). Pass raw paths. Dupes: App.tsx:3168/3399; fa-dev:4846.

### 4. Open bugs

(none)

### 5. Deferred tasks

- [DEFERRED] [CONSOLIDATED] Non-English Localization & C3 Policy: French cardinal and elision rules plus C3 fixture ceiling beyond 1,998.
- [DEFERRED] [CONSOLIDATED] Video Engine: 120fps preview buffer byte-capping plus native asset export frame rates.

---

## WS1 — Sync Pipeline Rewrite
Started: 2026-08-04 | Status: active — the primary workstream as of 2026-09-03 (WS2 closed). Phase 3 in progress, accuracy bar met.

### 1. Finished but pending verification

(none)

### 2. In progress

Phase 3 (Task 5), past 3b/3c (closed) and 3d (skipped, dormant). Chunking/accuracy research is
frozen under the 2026-08-25 accuracy-bar ruling (~97–98% of boundaries correct on first sync,
≥95% accepted; remaining errors go through manual UI review, not further pipeline changes).
FA default toggle (`FA_PROJECT_DEFAULT_ON`) is explicitly NOT closed — this is a gated ruling,
never a one-line toggle. Three preconditions, none satisfied: (1) two further disjoint 12/12
blind ear-pass verdicts (fresh listening lists, not reusing any list already scored); (2) an
EMPTY Zero-Defect Register (currently 5 open rows, WS1 §4's first bullet); (3) a runtime ruling
on the FA-enabled Apply Sync wall-clock cost, separately accepted for a change that would run on
every sync rather than an opt-in one. 0 of 4 stage locks passed.

- [ ] Execute the live acceptance run and get an owner pass/fail verdict
  (`stage1-live-run-prep.md`).
- [ ] Flip `FA_PROJECT_DEFAULT_ON` once all three preconditions above are met.
- [ ] Ratify R.7 confidence-flag handling; build its two unbuilt failure paths (skip-and-flag,
  force-split).
- [ ] Produce real `fa-vocab-<lang>.json` production files; wire `project.language`/`vocabChars`
  into both `computeFaChunkPlan` call sites.
- [ ] Task 2 — re-derive the 50/50 silence-split rule in `snapBoundaries.ts` against current
  `main` (deliberately breaks golden replay — needs per-boundary review, never a blind re-baseline).
- [ ] Task 3 — a dedicated test for stale-anchor scroll degradation (currently code-read only).
- [ ] Wire `FaEvent` to a UI progress consumer (no hook/component consumes it yet).
- [ ] Give the rule stage its own fixture-backed regression coverage — golden replay stops at
  `snapCoveredBoundaries` and never reaches chunk plan/FA/any rule (`CLAUDE.md` §4 Testing).
- [ ] Make forced alignment reachable in a shipped build. The FA **user interface is complete**:
      the per-project toggle, the per-language pack detector and its inline installer all ship, and
      in a non-FA build the detector states that this build cannot run high-precision sync rather
      than offering a pack that would not help. What is pending is the **backend wiring**:
      `fa-inference` is a non-default Cargo feature (`src-tauri/Cargo.toml` declares
      `fa-inference = ["dep:ort"]` with no `default = [...]` key; only `tauri:dev:fa` passes
      `-f fa-inference`), so `tauri:build` compiles `fa.rs:847`'s `#[cfg(not(...))]` fallback arm
      and every FA run returns `not_implemented` and falls back to Whisper timing. Making it
      default-on is a WS1 call, gated behind the same Stage 1 preconditions as
      `FA_PROJECT_DEFAULT_ON` above — and T3.2's cardinal generator becoming production-reachable
      is a consequence of that flip, not a separate task. Diagnosis:
      `.work-phase4/session-ws2-38/step4-cardinaldata-reachability.md`.
      **CTC MARGIN, carried here from WS2 §5 so it is read at the flip rather than found after
      it** (measured, not theorised): the standing inference that a wrong number reading costs
      only local mis-timing is refuted — `align_chunked`'s `TooManyRepeats` fallback is
      per-CHUNK, and a misread English year (the "compound" reading picked where "pair" was
      correct) adds `delta(L+R) = +16` to a chunk's CTC target length. Against real production
      chunk plans, 173's worst real margin is **9** (chunk 84), and **2 of 403** real chunks
      across all three corpora — both in 173 — are close enough to flip to whole-chunk
      placeholder timing under that delta. Unreachable today: no corpus contains a year-shaped
      digit token to trigger it. **Trigger:** any corpus containing a year-shaped (4-digit,
      in-range) numeral — at that point this is live risk, not a bound.

**END GOAL:** Stage 1 locks — every STAGE 1 LOCK GATE criterion satisfied (live acceptance run
passed by the owner, Contract IN / Contract 1→2 inspection, determinism, non-English written
acceptance, R.5/R.10, mover-audit dossier, no Stage 1 defect deferred downstream) — and
`FA_PROJECT_DEFAULT_ON` flips to ON.

### 3. Next tasks

- Pillar 2 passive detector — read-only boundary-quality post-processor, 4 rules, gated on
  R-AS's precision bar (`MIN_IMPLIED_PRECISION = 0.50`). Spec: `sync-pipeline-v2-plan.md` Part AK.2.
- Sync log revamp — 6 collapsible groups replacing dev telemetry; Group 6 depends on Pillar 2.
  Spec: `sync-pipeline-v2-plan.md` Part AK.3.
- Phase 4 (Stage 2 — Align & Select) — restructure into the four formal stages.
- Phase 5 (Stage 3 — Place) — replace the boundary picker with the four-line fence rule.
- Phase 6 (Stage 3 — Place) — deprecate the compensation layer if the 8 verification pairs pass.
- Phase 6b (Stage 3 — Place) — verify 173's pairIdx-20 boundary, likely resolved by Phase 5.
- Phase 7 (Stage 4 — Finalize & Report) — observability logging for every clamp/floor/fallback.
- Rule-stage propose/arbitrate rebuild — rules currently mutate a shared array by ordering, no
  conflict record (root cause of the R.11/R.12 collision R-AP closed in Session S). Scheduled,
  not started; would also absorb the R-AP performance cost (~2.70s/Apply Sync on v6, from
  `computeUnscriptedRuns` running 4x instead of 1x per Apply Sync).

Sequencing: Stage 1 lock → Phase 4 → Stage 2 lock → Phase 5 → Phase 6 → Phase 6b → Stage 3 lock
→ Phase 7 → Stage 4 lock.

### 4. Open bugs

Audited 2026-08-25 against `main` — full mechanism/fix-design detail: Part AI.

* [OPEN · NON-BLOCKING] 5 open Zero-Defect Register rows — boundary-placement defects,
  ear-verified wrong, no rule fixes them yet: `214_solitary_fire`, `231_slowing_pace`,
  `447_scout_facing_dark`, `173/lethal_nature_hazard`, `173/gadget_decay` (live list:
  `scripts/ws1-session-ak-step1-gate.ts:59`'s `OPEN_DEFECTS`). `400_endless_dark` is closed at
  1266.75 (`scripts/ws1-ear-pass-ledger.ts:907`). Accepted as residual under the accuracy bar; no
  owner. Permanent path: the planned Pillar 2 detector (Part AI §4).
* [OPEN · NON-BLOCKING] Alignment cost has no enforced bound for real inputs (Contract A4,
  `__ALIGN_INSTRUMENT__` dormant) — an unbounded input can hang the UI with no error surfaced. No
  owner; deferred to Stage 2 lock; needs a cost-vs-input-size measurement first (Part AI §5).

### 5. Deferred tasks

- [DEFERRED · ASR ENGINE LIMITATION] Row 52 ("Llívia", one script word, 0 of 2 transcript words,
  confidence 0.00) is the single surviving row of the five-row non-ASCII/numeral cluster from the
  WS2 Step 15 Windows run, and it is failing **for a cause outside this pipeline**: Whisper did not
  transcribe the isolated token at all, so there was never a token for the confidence gate
  (`LOW_CONFIDENCE_RATIO`, `syncConstants.ts:92`) to match against. Normalization is not the
  mechanism and no normalization change can reach it. **Do not patch** (owner ruling, 2026-09-03).
  The other four rows are CLOSED: 69 and 79 by `69d7cfc`'s NFD fold on the English/default
  `canonicalize()` branch, with 69 the row that verifies the fold; 8 ("The complexity originates in
  1198") and 102 ("300 American residents.") by measurement — their numeral tokenization converges
  under every plausible transcript spelling, so no code change was ever indicated and none was made
  (`.work-phase4/session-ws2-30/phase3-t31-step1-report.md` §5), and the T4.1 Step 0a retire-gate
  had already narrowed to row 52 alone. Operator confirmed all ledger rows syncing correctly
  2026-09-03. **Revisit trigger:** an ASR/G2P change (a different model, or phonetic matching —
  itself unscoped), never a normalization change. No owner.
- Bounded-memory options for the residual OOM footprint — a capped `FaModelCache` session cache,
  or process isolation per sync. Unbuilt. **Flag for owner review:** the shipped drop-then-build
  fix already "produces a bounded profile" per `sync-pipeline-v2-plan.md`'s AI.1 Addendum, so this
  option may be superseded rather than merely unbuilt — kept pending an explicit owner call.
- Full standing-constraints list (oracle, golden replay scope, rule-dependent closures, dead-end
  register, `S1_KNOWN_BAD_MOVES`, arms F/G/H, terminology glossary, frozen-file list, Contract 1→2
  compliance, R.3/R.8/R.9 backlog) — relocated verbatim to `sync-pipeline-v2-plan.md` Part AK.1.

---

## Backlog Items

- [OPEN · NON-BLOCKING] ORT intra-op thread ceiling undecided; 32 recommended, not applied. `fa_onnx.rs:503`
- [OPEN · NON-BLOCKING] `fa_cancel` has zero frontend callers, so FA cancellation is unreachable from the UI. `fa.rs:296`
- [OPEN · NON-BLOCKING] `faBoundaryTypes.ts` missing one-way drift entries for Timing and `alreadyRunning`. `faBoundaryTypes.ts:64`
- [OPEN · NON-BLOCKING] `.digest.json` files not removed by `models.rs` on model delete. `models.rs:664`
- [OPEN · NON-BLOCKING] Two `fa_dev` digest tests share a process-global memo and are latently racy. `fa_dev.rs:731`
- [OPEN · NON-BLOCKING] Whisper attach buffer has a 30 s stale-replay window and its panic path can orphan a registry key. `whisper.rs:172`
- [OPEN · NON-BLOCKING] React maximum update depth exceeded during V8 FA run; distinct from guarded `usePlayback.ts:80-94` rAF tick. Trigger unlocated.
- [OPEN · NON-BLOCKING] Dev-profile WebKit IDB holds 469 MB legacy v1 data; packaged build is 15.7 MB. Non-shipping cleanup.
- [OPEN · NON-BLOCKING] Fresh clone lacks gitignored `.work-phase4/replay/` (~85M); golden replay fails until restore script runs. `scripts/phase4-restore-replay-inputs.py`
- [OPEN · NON-BLOCKING] Export ffmpeg concat/mux paths outside the annexb-piece path (legacy `exportPipeline.ts`'s concat demuxer, the video/audio mux step) are unbounded/unaudited, unlike `TauriFfmpeg.concatAnnexbPieces`. `exportPipeline.ts:263`
- [OPEN · NON-BLOCKING] macOS `VideoEncoder` output is not byte-reproducible run to run (76/1200 annexb chunks matched across 2 identical runs) — `pieceSha256` cannot gate output equivalence; use `FrameContentDigest` instead. `docs/history-2.md`
- [OPEN · NON-BLOCKING] Part C live export's longest silent interval (10.26s) lacks phase attribution — diagnostics report `phase:null` for most intervals >5s. `exportWorkerDiagnostics.ts`
- [OPEN · NON-BLOCKING] `GL_TRANSITION_SLUGS` is duplicated instead of sharing one source. `compositeParams.ts:34`, `decodeCursorLifetime.ts:26`

---

*Full history: `docs/history-2.md`. Standing reference material: `sync-pipeline-v2-plan.md` Part AK.*
