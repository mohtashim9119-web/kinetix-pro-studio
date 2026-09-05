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
> Tag vocabulary: [OPEN], [IN-PROGRESS], [DEFERRED], [OPEN · NON-BLOCKING], [CLAIM-UNVERIFIED].

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
* [OPEN · NON-BLOCKING] React "Maximum update depth exceeded" render loop — surfaced during the
  2026-08-25 real-app V8 corpus run (`npm run tauri:dev:fa`). `usePlayback.ts:80-94`'s rAF tick
  already guards this failure mode (QB2 fix), so this is a distinct, unlocated trigger elsewhere
  in the render tree. No owner.

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

## WS2 — Non-Sync Work
Status: OPEN — the general workstream for all development outside the sync pipeline (WS1). Active tasks live in the five sections below; completed items are recorded in `docs/history-2.md`.

Baselines (76e99b6): vitest 3143 passed / 77 skipped / 0 failed; gaplessInvariant 36/36; golden replay 6/6; K13 3/3; cargo 185/0/1 superseded — now 192/0/1 default and 274/0/26 with `--features fa-inference`.

### 1. Finished but pending verification

(none)

### 2. In progress

(none)

**END GOAL:** Next implementation from section 3 — transcription Req 2, raw IPC for ffmpeg probes.

### 3. Next tasks

- [OPEN · BLOCKED] Transcription Req 2: incremental draft save — blocked on Rust WhisperEvent partial-token IPC variant; Progress percent-only (whisper.rs:572), tokens only on Done (whisper.rs:632).
- [OPEN] tauriFfmpeg.ts:45-72 Base64 IPC: brief-estimated ~2.33× peak inflation on ~73MiB voiceover (not measured here). Pass raw paths. Dupes: App.tsx:3168/3399; fa-dev:4846.
- [OPEN · NON-BLOCKING] Dev-Profile IDB Cleanup: dev WebKit 469 MB (291+12+167 MB); packaged 5 v1/15.7 MB. V8 four-ref; v1 STOP 58/266. Non-shipping. `.work-phase4/session-ws2-49-legacy-v1/findings.md`.
- [OPEN · NON-BLOCKING] Replay fixture reproduction gap: `.work-phase4/replay/` (~85M, gitignored) is required by golden replay (3 corpus tests) and ~35 WS1 measurement scripts; a fresh clone fails those until `python3 scripts/phase4-restore-replay-inputs.py` is run locally. Tracking the bundle is unreasonable at this size.

### 4. Open bugs

(none)

### 5. Deferred tasks

- [DEFERRED] [CONSOLIDATED] Non-English Localization & C3 Policy: French cardinal and elision rules plus C3 fixture ceiling beyond 1,998.
- [DEFERRED] [CONSOLIDATED] Video Engine: 120fps preview buffer byte-capping plus native asset export frame rates.

---

*Full history: `docs/history-2.md`. Standing reference material: `sync-pipeline-v2-plan.md` Part AK.*
