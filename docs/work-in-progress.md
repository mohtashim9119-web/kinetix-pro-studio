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

## WS2 — Video Ingest & Distribution Bugs
Started: 2026-08-26 (Step 3) | Status: **CLOSED 2026-09-03**, reopened for T4.3 and re-closed the same day.
T4.3 (model-download transfer resilience) fixed an operator-reported FA pack failure: bounded retry with
exponential backoff around the stream loop, conditional resume gated on a new `.part.meta` validator
sidecar (URL + expected size + ETag/`X-Linked-ETag`/Last-Modified) plus a 206 `Content-Range` start/total
check, the 416 permanent-stick discharged (discard once, restart, then permanent), three distinct error
forms that never promise an impossible resume, and a new `fa_model_status` command so an FA row offers
"Resume <bytes>" instead of a bare Download. Whisper shares the engine and was verified by destructive
probe, not inference. Full record: `docs/history-2.md`. Original text follows. **CLOSED 2026-09-03.** All 4 numbered bugs and all four phases are done — Phase 4 (Settings & project creation) closed with T4.1 and T4.2. T4.2 also closed the bare-key shortcut leak (Space, `+`/`-`, arrows, `F` now read `shortcutsSuppressedRef` via `services/bareKeyShortcut.ts`, per-key probed) and ran the §5 hygiene pass, 15 entries → 8. No phase is queued after it; section 5 is the residual backlog, none of it owned. **Its entries stay here under the closed workstream:** the structure contract rules on closed ITEMS (fold into this line + `docs/history-2.md`) but is silent on a closed workstream's still-open ones, and the single-tracker rule puts them in this file under their own workstream section or nowhere. Attention moves to WS1.

### 1. Finished but pending verification

(none)

### 2. In progress

(none)

**END GOAL:** (none — WS2 is closed. T4.1 and T4.2 both met the goal that stood here: a new project
can be created with an explicit language choice or a deliberate Auto-detect that stores nothing, and
the machine-global model/add-on requirement is surfaced and satisfiable from App Settings before a
sync ever needs it.)

### 3. Next tasks

(none) — no phase is queued after Phase 4. Everything remaining is section 5's deferred backlog.

### 4. Open bugs

(none)

### 5. Deferred tasks

Hygiene pass 2026-09-03 (T4.2): 15 entries → 8. WS2-45 pass (2026-09-04): Site B zip data-integrity
scope, French/C3/fixture corrections, vitest flake inventory, E8 tightened — **seven entries**
remain. No entry's content was dropped without a named destination — see T4.2 and WS2-45 records
in `docs/history-2.md`.

- [DEFERRED] IndexedDB Orphaned Asset Blobs (`processZipFile` data integrity & cleanup audit)
  - **Active Bug (Site B):** `processZipFile`'s dedup (`App.tsx:4697`) drops a duplicate without
    `deleteAsset` AND without `URL.revokeObjectURL`, leaking both a DB row and a blob URL. NOT
    safely fixable as delete alone: `voiceoverId` (`App.tsx:4703`) derives from the UNDEDUPLICATED
    `newAssets`, so when the dropped duplicate is the audio file its id becomes `project.voiceoverId`
    while its row is absent from `project.assets` — a dangling `voiceoverId` that must be fixed
    first (read `dedupedNew`, not `newAssets`). Reachability is narrow: the drop needs a concurrent
    add mid-extraction (`assetsRef.current` only updates in an effect at `App.tsx:4865`). Site A
    (`extractZipToAssets` consumer) closed at `a2e2b26` (`services/zipAssetMerge.ts`).
  - **Audit Task — DIAGNOSED, not closed (WS2-49, 2026-09-04):** the 798/399 count is a one-time
    event, not a systemic write-path pattern — every other project on disk measures exactly 1:1.
    All 399 orphans sit in one contiguous recordID block written 2026-08-25, byte-identical to
    exactly one referenced asset in a second block written 2026-08-27, with no successful project
    save between the batches — matching this project's `QuotaExceededError` incident already
    documented at `projectStore.ts:71` for that date. 398 of 399 are reachable from none of
    `historyPersist.ts`, `lastTranscribedAssetId`, a staged voiceover, or `waveformStore.ts`; one
    stale `waveformStore` peaks entry survives for the old voiceover id. Stays open as cleanup
    (delete contract unbuilt), not diagnosis. **NOT DETERMINED:** whether the abort was
    `QuotaExceededError`, a crash, or a cancel — no console output from that session persists.
  - **Standing verdict (WS2-49):** the eager asset-write path may proceed without that mechanism
    being known, given a probe-verified delete contract plus a before/after row-count check
    against this baseline.
  - **Measurement artifacts:** `.work-phase4/session-ws2-49/` (gitignored). **NOT DETERMINED:**
    whether to promote it to a tracked path — an unrepeatable baseline is worth less than the
    number it produced.
  - **Trigger:** Fixing `processZipFile`'s `voiceoverId` derivation, or building the delete
    contract above.
- [DEFERRED] Non-English Localization & Corpora Gap
  - **Parent Prerequisite:** Missing real `fr`, `de`, and `pt` golden audio/transcript corpora.
  - **Sub-Items:**
    a) **Digit Cardinals:** `digitTokenToWords` (`textNormalize.ts`) emits English words for all languages.
    b) **Elisions:** `canonicalize()` splits non-English apostrophes (e.g., `l'élève`).
    c) **French Grammar:** *cent* and *quatre-vingt* wrongly keep their `-s` before a bare numeral
       scale word — measured: `200000` → `"deux cents mille"` and `80000` → `"quatre-vingts mille"`
       (correct: `"deux cent mille"`, `"quatre-vingt mille"`). `200000000` → `"deux cents millions"`
       is correct and must not regress (*million* is a noun). NOT `composeHundred`-only: the
       `quatre-vingts` case is a literal `cardinals0to99["80"]` lookup via `composeScaleLevel`, so
       suppression belongs at `composeScaleLevel`'s multiplier call, covering both the
       `composeHundred` plural and the 0-99 table. Needs a new
       `hundred.suppressPluralBeforeNumeralScaleWord` schema field in `fa-cardinal-fr.json` plus
       both arms (`faTextNormalize.ts:276`, `fa/text.rs`), and fr fixture rows for
       200000/300000/80000/200000000 — `fa-text-normalize-fixture.json` tops out at 1998, so it
       currently cannot see this defect in either arm, and a TS-only fix would leave it GREEN with
       the arms diverged.
    d) **Corpus Gap:** Four-language linguistic design is unvalidated for `fr`/`de`/`pt`.
  - **Note (WS2-44):** (c) is NOT corpus-blocked and NOT reachable in the default build.
    `composeHundred` is dead in the TS arm permanently by owner ruling — every
    `computeFaChunkPlan` call site (`App.tsx:4395`, `faSeamFitGate.ts:190`,
    `forcedAlignmentRun.ts:142`) omits the `languageCode`/`vocabChars`/`cardinalData` trio and
    `faTextNormalize.ts:501-511` rules that it stays omitted (wiring it would desync `wordIndex`).
    The live arm is `fa/text.rs:314` via `fa_onnx.rs:848`/`:1321`/`:1538`, gated on the
    non-default `fa-inference` feature. So a TS-side fix is a `gates-guarding-nothing` change and
    should move only as C3 parity ballast alongside the Rust fix. By contrast (a),
    `digitTokenToWords` (`textNormalize.ts:88`), IS live via `canonicalize`
    (`textNormalize.ts:195`/`:206`) and is genuinely corpus-blocked.
  - **Trigger:** Acquiring real French, German, or Portuguese test corpora; (c) also has its own
    numeral-scale trigger independent of the corpus gap.
- [DEFERRED] Video Engine & Frame Rate Limitations
  - **Sub-Items:**
    a) **120fps Preview Lag:** `MAX_BUFFERED_FRAMES_PER_SESSION = 90` (`videoDecoderPool.ts:107`) caps by frame count instead of byte budget, freezing 120fps preview playback. Export is unaffected.
    b) **Arbitrary Frame Rate:** `useExport.ts:27` hardcodes a single project frame rate, ignoring native asset frame rates (`Asset.nativeFps`).
  - **Trigger:** Media engine / preview buffer refactor.
- [DEFERRED] Timeline Clip Focus & S/D Hotkey Scope
  - **Issue:** Single-key shortcuts (`S`/`D`) do not check for true timeline DOM focus because clip elements lack `tabIndex` and `Timeline.tsx:433` suppresses focus-shift on click.
  - **Trigger:** Reworking timeline clip focusability and keyboard navigation.
- [DEFERRED] C3 Normalization Dual-Implementation Policy
  - **Issue:** Dual TS/Rust normalization relies on a conformance fixture that tests agreement rather than absolute correctness against independent standards.
  - **Fixture ceiling:** `scripts/fixtures/fa-text-normalize-fixture.json` tops out at **1998** — the
    arms can diverge above that with the fixture still green (French *cent*/*quatre-vingt* before a
    bare numeral scale word is the measured example; see the localization entry's sub-item (c)).
  - **Trigger:** Policy changes to either normalization arm or a real divergence report.
- [DEFERRED] Order-dependent vitest timeout flakes (not a code defect)
  - **Inventory:** Two files confirmed under full-suite CPU contention (pass in isolation):
    `faSeamFitGate.test.ts` (**16/16 isolated**; 173 rows at lines 288/299 had vitest's default
    5s harness budget — raised to 120s this round), `scripts/ws1-session-aj0-oracle-diff.test.ts`
    (3/3 isolated; v6 `runProductionPath` exceeded 120s under load — raised to 180s). Both are
    vitest harness allowances, not in-test performance assertions.
    `scripts/ws1-session-s-exclusion.test.ts` (6/6 isolated; **unconfirmed at current main** —
    named from session-ws2-06 at `bc3a156`, not reproduced under load at `a8e22c1`).
  - **Measured profiles (3059 total):** suite is green only sometimes. Flake profiles under load:
    **2980 / 2 / 77** (`bc3a156`, session-ws2-06) and **2979 / 3 / 77** (`a8e22c1`, pre-fix,
    back-to-back runs) — both failures are timeout budgets, not logic failures. Green when
    uncontended: **2982 / 77 / 0**.
  - **Trigger:** dedicated CI pool or further harness headroom — not silencing individual failures
    without measuring isolation cost.
- [DEFERRED] FA pack detector `unsupported` state (manual row E8) is not user-reachable from the
  Project Settings dropdown, which is built from `SUPPORTED_LANGUAGES`. Verified 2026-09-03: still
  open, not superseded by `faPackLanguageParity.test.ts` — that test's own header says the deferral
  stays correct and its job is only to fail loudly if a sixth language ever makes the branch
  reachable (`models.ts:21` / `models.rs:182` still hardcode the same five-code list three times,
  independently). **Trigger:** that guard going red.
- [OPEN · NON-BLOCKING] WebKit profile split (WS2-49): the dev binary sets no
  `CFBundleIdentifier`, so WebKit falls back to `~/Library/WebKit/app/` instead of the folder
  matching `tauri.conf.json`'s bundle id — that bundle-id folder holds a stale profile with no V8
  (IndexedDB) in it. Any IndexedDB measurement or cleanup must target the dev binary's actual
  profile, not the bundle-id path config implies. No owner.
- [OPEN] Two further IndexedDB leaks found in passing (WS2-49, unexamined, different mechanism
  from the 798/399 entry above, unscoped, no cost read): a 266-row legacy pre-v2 assets store
  with no `projectId`, and at least one fully orphaned project pool (asset rows, no
  `project.json`). No owner.
- [OPEN] `tauriFfmpeg.ts`'s duration/fps probes (`probeAudioDuration`/`probeVideoFps`,
  `tauriFfmpeg.ts:45-72`) base64-encode the entire blob over Tauri IPC before either sidecar
  runs — the pattern this repo's `CLAUDE.md` §4 invariant prohibits (raw-body precedent:
  `ffmpeg_write_file_raw`/`whisper_stage_audio_raw`/`fa_stage_audio_raw`), same IPC/disk cost
  class as the T4.8 incident. Not fixed; no cost measurement taken. No owner.
- [OPEN] `emptySceneDocAbortMessage` (`App.tsx:1009`, message `App.tsx:1002`, checked
  `App.tsx:3319`) always reports "no scenes to sync," but in the staged-files path
  (`App.tsx:3223-3225`) a 0-segment parse can equally mean no scene file was ever staged and
  `project.sceneDetails` was never committed — not a real doc parsing to zero. Misleading for
  that case. Not changed this round — `App.tsx` is Cursor-owned. No owner.

---

*Full history: `docs/history-2.md`. Standing reference material: `sync-pipeline-v2-plan.md` Part AK.*
