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
Started: 2026-08-26 (Step 3) | Status: **CLOSED 2026-09-03.** All 4 numbered bugs and all four phases are done — Phase 4 (Settings & project creation) closed with T4.1 and T4.2. T4.2 also closed the bare-key shortcut leak (Space, `+`/`-`, arrows, `F` now read `shortcutsSuppressedRef` via `services/bareKeyShortcut.ts`, per-key probed) and ran the §5 hygiene pass, 15 entries → 8. No phase is queued after it; section 5 is the residual backlog, none of it owned. **Its entries stay here under the closed workstream:** the structure contract rules on closed ITEMS (fold into this line + `docs/history-2.md`) but is silent on a closed workstream's still-open ones, and the single-tracker rule puts them in this file under their own workstream section or nowhere. Attention moves to WS1.

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

Hygiene pass 2026-09-03 (T4.2): 15 entries → 8. Three deleted as fully relocated or measured
noise, one closed by the Step 2 fix, CTC margin moved onto WS1's FA task line, four non-English
items merged. No entry's content was dropped without a named destination — see the T4.2 record
in `docs/history-2.md`.

- [DEFERRED] Re-examine ruling C3 (the dual TS+Rust normalization surface, kept honest by a
  conformance fixture): the surface acquired a POLICY, and a conformance fixture tests that two arms
  AGREE, not that either is CORRECT. The open question is what check independent of BOTH arms catches
  a symmetric error. Not a reversal of C3. Full argument: `docs/history-2.md`, WS2 T4.1 Step 0a.
  **Revisit trigger:** any change to either normalization arm's policy, or a real divergence report.
  No owner.
- [DEFERRED] FA pack detector `unsupported` state (manual row E8) is not user-reachable from the
  Project Settings dropdown, which is built from `SUPPORTED_LANGUAGES`. Two corrections from
  T4.2's verification pass. (1) The branch **is** tested — `FaPackStatus.test.tsx:156` renders it
  with `'ja'`; the old "whether it renders is untested" was wrong. (2) The unreachability premise
  was enforced by **nothing**: `models.ts:21` intersects `SUPPORTED_LANGUAGE_CODES` with a
  hardcoded five-code literal and `models.rs:182` hardcodes the same five a third time, so a sixth
  language compiled clean and made the branch reachable on the same commit. Now guarded by
  `faPackLanguageParity.test.ts` (reach probed destructively, not assumed). The deferral stands;
  the guard is what will announce its premise failing. **Revisit trigger:** that guard going red.
  No owner.
- [OPEN] Zip import writes asset blobs to IndexedDB BEFORE the dedup that decides whether to keep
  them, and the discard path never calls `deleteAsset` — an **active write bug on `main`**, not a
  legacy artifact. `App.tsx:4677` writes; `App.tsx:4696`'s "final dedup (catches concurrent adds)"
  then drops by name, and every asset it drops is a permanently orphaned blob. The race it
  compensates for is structural: all file promises run concurrently off one `assetsRef.current`
  snapshot, so two archive entries with the same basename (`filename.split('/').pop()`) both pass
  the `4670` pre-check. `extractZipToAssets` (`App.tsx:365`) has the same write-then-return shape.
  Filed as its own item per operator ruling A1 rather than patched inside the hygiene pass. Full
  diagnosis: `.work-phase4/session-ws2-41/step3-duplicate-asset-blobs.md` §2. No owner.
- [DEFERRED · NOT DETERMINED] Orphaned asset rows — diagnosis task, NOT a fix. `FINAL TEST V8`
  returns 798 rows for 399 `project.assets` entries. T4.2 established these are **not duplicates**:
  `assets-v2`'s key is compound `['projectId','id']` (`assetStore.ts:47`) and `put` replaces, so
  798 rows are 798 DISTINCT ids — ~399 orphans. Whether the entry above produced V8's specific
  split is **NOT DETERMINED** (needs the live app + that IndexedDB; a full re-stage by the user
  would also produce 2×, and that is a user action, not a bug). An `id-not-in-project.assets`
  deletion rule is **disqualified as written**: it would delete rows reachable from persisted undo
  snapshots (`historyPersist.ts:170` stores whole `Project`s), from `lastTranscribedAssetId`
  (`types.ts:349`), and from the staged-voiceover window (`App.tsx:351`→`3019`), and would
  desynchronise the second asset-id-keyed store (`waveformStore.ts:114`). Next step is the
  report-only classifier and its four go/no-go conditions, both specified in
  `.work-phase4/session-ws2-41/step3-duplicate-asset-blobs.md` §§4-5. No owner.
- [DEFERRED] S/D hotkey scope is gated on a selected/targeted segment plus the text-entry guard and
  (since T4.1) modal suppression — but still not on true TIMELINE focus. Confirmed by T4.2 as a
  DISTINCT leak, not covered by that round's bare-key fix: that fix answers "does a modal own the
  keyboard", this asks "does the timeline own it", and no modal need be open for this one. The
  blocker is clip focusability, not the guard — Timeline's clip elements and its scroll container
  carry no tabIndex/role (deliberately removed in `299f014`) and `Timeline.tsx:433-446`'s
  mousedown-capture handler actively suppresses the browser's own focus-shift on click. Gating S/D
  on focus-within needs tabIndex plumbing plus revisiting that suppression, which touches selection
  and scrubbing. No owner.
- [DEFERRED] 120fps preview decode lag — the decode-ahead cap must be expressed in bytes, not
  frame count; the formula is already derived but full implementation is deferred. Cause confirmed
  by T4.2: `MAX_BUFFERED_FRAMES_PER_SESSION = 90` (`videoDecoderPool.ts:107`) is a frame COUNT
  sized against assumed 24-30fps content, and nothing reads the source's actual rate, so at 120fps
  90 frames = 0.75s and the fixed `WINDOW_AHEAD_SEC = 1.5` window (`:76`) can never fill. On the
  Windows build the preview shows a frozen frame; export is unaffected (a separate, non-windowed
  sequential decoder). **Deliberately NOT merged with the item below** — see it. Full diagnosis:
  `docs/ws2-video-ingest/bug3-diagnosis.md`.
- [DEFERRED] Arbitrary frame rate support — one frame rate is assumed for the whole timeline
  (`ExportFps = 24 | 30 | 60`, `useExport.ts:27`, applied per-run at `:190`/`:490`), with
  `Asset.nativeFps` used "only to auto-suggest exportFps" (`types.ts:134-136`); some assets are
  24fps. **T4.2 checked the standing claim that this shares a cause with the 120fps item and
  REFUTED it.** Both halves are individually true, but they are two mechanisms in two subsystems:
  the 120fps defect is a preview-pool constant that never reads the SOURCE ASSET's rate
  (`bug3-diagnosis.md:124`, `:199-200`) and that diagnosis records export as unaffected (`:212`),
  while this item is an export/project-model question. Neither fix advances the other, so they
  stay separate entries. No owner.
- [DEFERRED · NOT DETERMINED] Non-English correctness, four items sharing ONE prerequisite — **no
  fr/de/pt golden corpus exists in this repo.** That gap is the parent, not a fifth item:
  acquiring one real fr, de or pt script+transcript+audio corpus unblocks (a) and (b) together,
  and T3.1's conformance fixture had to work around it by testing `canonicalize()` directly rather
  than through a corpus. Each sub-item keeps its own pointer and its own distinct fix:
  - **(a) digit cardinals are never language-gated.** `textNormalize.ts`'s `digitTokenToWords`
    emits English cardinal/year words for every language (es `"23"` → `"twenty three"`), never
    gated by `languageCode`. T3.2 closed the ENGLISH half only and left es/fr/pt/de diverging in a
    NEW way: FA now emits `veintitrés` while the matcher still emits `twenty three`, so the two
    arms fail DIFFERENTLY and a diagnosis reading one arm will mis-attribute it. That wrongness
    ships today; "T3.2 is done" overstates it. Invisible in all three golden corpora only by a
    symmetric-fold coincidence (`spanish`'s `"12"`). Fix: gate on `languageCode`. Full reframing:
    `docs/history-2.md`, WS2 T4.1 D6/D3.
  - **(b) fr/pt/de elision (`l'élève`-class).** `canonicalize()` splits any apostrophe not in the
    English-only `CONTRACTIONS` map into two tokens on every branch, every language;
    `faTextNormalize.ts` keeps it one token. Whether this is a real match defect is genuinely NOT
    DETERMINED — no corpus here contains elision content
    (`.work-phase4/session-ws2-33/t32-numeral-diagnosis.md` §2.3). Fix touches the es/fr/de/pt
    branch of `canonicalize()`, which needs its own standing-ruling sign-off. Structurally
    separate from (a) — apostrophes, not digits — and from T3.1; do not fold into either.
  - **(c) French `composeHundred` pluralizes "cent" unconditionally** whenever its local remainder
    is 0, with no signal for whether a further NUMERAL scale word ("mille") follows — "deux cents
    mille" for 200000 where correct French is "deux cent mille". Encoded as a `knownLossy` fixture
    entry on `fa-cardinal-fr.json`'s `hundred` config (`7901c27`), not fixed. Fix: thread a new
    schema signal from `composeScaleLevel` into `composeHundred`. Has its OWN trigger independent
    of the corpus: any corpus with a French number ≥200,000 followed by a numeral scale word.
  - **(d) the corpus gap itself** — T3.2 Option 1's four-language linguistic design work was
    scoped only against the one real es corpus, so it is unvalidated for fr/de/pt.

  **Revisit trigger:** acquiring a real fr, de or pt corpus (unblocks a, b and d at once), or (c)'s
  own numeral trigger. No owner.

---

*Full history: `docs/history-2.md`. Standing reference material: `sync-pipeline-v2-plan.md` Part AK.*
