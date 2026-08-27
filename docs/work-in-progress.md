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
Started: 2026-08-04 | Status: active — Phase 3 in progress, accuracy bar met.

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
* [OPEN] Non-ASCII proper-noun matching — every remaining low-match-rate failure in the WS2 Step
  15 03:57:28 Windows run involves diacritics or foreign place names: segment 52 skipped entirely
  ("Llívia", 0 of 2 words, confidence 0.00); segment 69 ("Llívia stayed Spanish." 2 of 4, 50%);
  segment 79 ("Peñón de Vélez de la Gomera" 4 of 8, 50%); segment 8 ("The complexity originates in
  1198" 4 of 7, 57%); segment 102 ("300 American residents." 2 of 4, 50%). Segment 79 failed in
  BOTH the before and after runs — not a Windows issue, not fixed by FA. Hypotheses, all
  UNVERIFIED: Unicode normalization (NFC vs NFD) mismatch between transcript and script; the
  en-language CTC vocab (measured 33 symbols) may lack glyphs for í/ñ/é; numeral-to-word expansion
  for "1198"/"300". No fix attempted. `docs/history-2.md`'s Step 15 entries. Rationale: a
  sync-pipeline matching defect, not a distribution defect — relocated from WS2 §4, provenance
  preserved (surfaced by the WS2 Step 15 Windows operator log, 03:57:28 run). **Third occurrence,
  WS2 Step 18 (2026-08-27):** segment 8 ("The complexity originates in 1198") failed identically
  a third time (4 of 7, 57%) on an unrelated 33-segment operator project — now reproducible on a
  small project, cheap to debug. Contains no diacritics, so this run corroborates only the
  numeral-expansion hypothesis (now best-supported of the three), leaving NFC/NFD and CTC-vocab
  glyph coverage still UNVERIFIED against the Llívia/Peñón cases. Still no fix attempted. Detail:
  `docs/history-2.md#2026-08-27--ws2-step-18--ws1-nonascii-segment8-third-occurrence`.
* [OPEN · NON-BLOCKING] Cut-placement quality — 9 of 228 cuts land on live audio in the WS2 Step
  15 Windows AFTER run (~96.1%, vs. the ~97-98% bar): segment pairs 53/54, 68/69, 101/102,
  109/110, 123/124, 138/139, 195/196, 202/203, 218/219. At macOS parity (10) — a pre-existing
  cross-platform quality gap, not a Windows regression, not closed by this workstream's fixes.
  Rationale: a sync-pipeline boundary-placement defect, not a distribution defect — relocated from
  WS2 §4, provenance preserved (surfaced by the WS2 Step 15 Windows operator log, 03:57:28 run).

### 5. Deferred tasks

- Bounded-memory options for the residual OOM footprint — a capped `FaModelCache` session cache,
  or process isolation per sync. Unbuilt. **Flag for owner review:** the shipped drop-then-build
  fix already "produces a bounded profile" per `sync-pipeline-v2-plan.md`'s AI.1 Addendum, so this
  option may be superseded rather than merely unbuilt — kept pending an explicit owner call.
- Full standing-constraints list (oracle, golden replay scope, rule-dependent closures, dead-end
  register, `S1_KNOWN_BAD_MOVES`, arms F/G/H, terminology glossary, frozen-file list, Contract 1→2
  compliance, R.3/R.8/R.9 backlog) — relocated verbatim to `sync-pipeline-v2-plan.md` Part AK.1.

---

## WS2 — Video Ingest & Distribution Bugs
Started: 2026-08-26 (Step 3) | Status: all 4 numbered bugs closed (1/2/4 code-fixed and now
runtime-verified on real Windows hardware; 3 closed did-not-reproduce, no code fix). Two
sync-pipeline defects surfaced by WS2 Step 15's Windows operator log (non-ASCII matching,
cut-placement quality) were relocated to WS1 §4 — see that section. macOS CI-artifact/arm64 FA
platform verification and MSVC redistributable are both closed (OPERATOR-ATTESTED); the
autosave-quota bug is fixed (T1.3, OPERATOR-ATTESTED live `tauri:dev` verification, see
`docs/history-2.md`). Phase 1 (project data durability & foundations) is fully closed —
T1.1/T1.2/T1.3 all done; Phase 2 is now in progress.

### 1. Finished but pending verification

(none)

### 2. In progress

[IN-PROGRESS] Phase 2 — Never-drop segments & operator override
  T2.1 Place unmatched segments at interpolated timestamps with timingSource/confidence
       flags and a sync-log warning, instead of dropping them.
  T2.2 Operator override layer: keep / hide / manually add or delete a segment, persisted
       by stable segment ID.

**END GOAL:** No project data survives loss across app close, crash, or version upgrade; every
launch opens the dashboard; opening a project restores its last saved position. (Phase 1's goal —
carried here as the still-relevant durability bar Phase 2 builds on; Phase 2 additionally ends
at: no segment is ever silently dropped from the timeline without an operator-visible flag and
recovery path.)

### 3. Next tasks

[OPEN] Phase 3 — Text and number normalization
  T3.1 Canonical match form: Unicode NFC/NFD normalization, punctuation folding, tiered
       diacritic fallback, and number/date/currency value tokens; match on canonical form,
       render from the original surface form.
  T3.2 Locale verbalizer for the FA pass (digits → words, en/es/fr/de/pt) with token
       provenance so aligned groups collapse back to exact source-token boundaries;
       single shared implementation for the TS matcher and the Rust FA runtime.

[OPEN] Phase 4 — Settings & project creation
  T4.1 App Settings page owning Models & Add-ons (machine-global); Project Settings shows a
       read-only requirement row that deep-links to it; missing-model check moved into
       faPreflight.ts and surfaced in the sync log.
  T4.2 New-project flow: language dropdown, FA sync ON by default, project-scoped settings
       only; fix the stale blurred previous project by unmounting the editor and clearing
       activeProjectId on close.

(WS2's numbered-bug backlog is closed; remaining work beyond Phases 2-4 above is the two
deferred items below.)

### 4. Open bugs

(none)

### 5. Deferred tasks

- [DEFERRED] 120fps preview decode lag — operator-deprioritised, real code-level defect found
  while diagnosing bug 3, not itself closed by bug 3's non-repro: `videoDecoderPool.ts`'s 90-frame
  decode-ahead cap (`MAX_BUFFERED_FRAMES_PER_SESSION`) is sized against a fixed ~1.5s window
  (`WINDOW_AHEAD_SEC`) tuned for 24-30fps content; at 120fps the first decode-ahead batch needs
  ~180 frames, overflows the cap, and the excess is dropped PERMANENTLY (`feedCursor` has already
  advanced past those chunks). Reproduced against the real, unmodified `videoDecoderPool.ts` with
  the asset's actual measured profile (mock-`VideoDecoder` harness); never confirmed on-screen in
  a live app. Any bound must be in BYTES not frame count — preserves the prior 4.0 GB → 2.8 GB
  peak / 1300 MB → 137 MB spike-memory work. Preview only — export uses a separate, non-windowed
  sequential decoder (`sequentialDecode.ts`) and is unaffected. Full diagnosis:
  `docs/ws2-video-ingest/bug3-diagnosis.md`.

---

*Full history: `docs/history-2.md`. Standing reference material: `sync-pipeline-v2-plan.md` Part AK.*
