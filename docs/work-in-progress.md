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
  **Update, WS2 T3.1 (2026-09-01):** the mechanism behind rows 52/69/79 is now fixed and proven,
  not merely hypothesized — `69d7cfc`'s NFD-fold on the English/default `canonicalize()` branch
  closes the ASCII-shattering that produced the reported garbage-fragment tokens ("Llívia" was
  `["ll","via"]`, now `["llivia"]`; "Peñón de Vélez..." was 8 tokens/4 garbage, now 6 clean
  tokens), measured directly against each row's exact quoted text
  (`.work-phase4/session-ws2-30/phase3-t31-step2-report.md` §3). Rows 8/102's numeral
  tokenization was independently measured to already converge under every plausible transcript
  spelling (`.work-phase4/session-ws2-30/phase3-t31-step1-report.md` §5) — no code change was
  needed or made there. **Not retired**: this session was not supplied the real Whisper
  transcript tokens for these five rows (`project.transcriptTokens`, pullable via
  `__transcriptInspector`), and the fix's own measurement explicitly could not confirm the
  operator's real transcript spelling matches the script's — only that the shattering defect,
  once the dominant confirmed mechanism, no longer occurs. Retire this entry once operator
  verification against the real transcript tokens confirms an actual match, not before.
  **Update, WS2 T4.1 Step 0a (2026-09-02) — the retire-gate is now a ONE-ROW gate, and that row
  is 52.** Measured: rows 69 and 79 cannot test the fold at all — run through the real
  `extractSegmentAlignments`, both report `matched: true` whether or not `llivia`/`penon` match
  anything (69 on `stayed`/`spanish`; 79 on `de`/`de`/`la`/`gomera`, 4 of 6, `penon` and `velez`
  matching nothing). Row 69 is WEAKER evidence post-fix than pre-fix (4 tokens needing a run of 2
  → 3 tokens needing a run of 1). Only row 52 discriminates: one token, nothing to survive on, so
  its confidence reads 1.00 or 0.00 directly. Also measured: the transcript data is absent from
  this machine, not un-consulted — a 3,245-file sweep of the whole tree, including the extracted
  operator projects under `.work-phase4/forensics-20260819-033211/`, returns zero hits. Disposition
  stays `NOT DETERMINED — data absent`. **Retire only on an operator pull showing row 52 at 1/1,
  confidence 1.00**; rows 69/79 reporting `matched: true` is not evidence and must not be counted
  as any. If the pull shows a phonetically divergent spelling, that is ASR divergence, not
  normalization — file the spellings and stop; fuzzy/phonetic matching is a separate unscoped
  decision. Full record: `docs/history-2.md`'s 2026-09-02 T4.1 Step 0a entry.

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
Started: 2026-08-26 (Step 3) | Status: active — all 4 numbered bugs and Phases 1-3 closed; Phase 4 (Settings & project creation) in progress.

### 1. Finished but pending verification

(none)

### 2. In progress

[IN-PROGRESS] Phase 4 — Settings & project creation
  T4.1 App Settings owns Models & Add-ons inline (machine-global); Project Settings keeps only
       project-scoped controls and no models management; per-language FA pack detector.
       Steps 0-3 landed (inventory, D4, D6/D3, the three-block surface, defaults wiring, the
       detector). CANNOT CLOSE while §5's `fa-inference` entry is open — the detector's
       `unbuilt` state now SAYS so to the user instead of promising a pack would help.
  T4.2 New-project flow: New Project Defaults as machine-global state; the modal's language
       dropdown defaults to "Auto-detect", which WRITES NOTHING (the absent `Project.language`
       is load-bearing — `resolveFaLanguage` is `language ?? detectedLanguage`, so a seeded 'en'
       shadows detection forever; locked by `src/services/languageDefaultDrift.test.ts`).

**END GOAL:** A new project can be created with an explicit language choice (or a deliberate
Auto-detect that stores nothing) and FA sync on by default, and the machine-global model/add-on
requirement is surfaced and satisfiable from Settings before a sync ever needs it.

### 3. Next tasks

- [OPEN] Re-examine ruling C3 (dual TS+Rust normalization surface kept honest by a conformance
  fixture): the surface acquired a POLICY, and a conformance fixture tests that two arms AGREE,
  not that either is CORRECT. Ask what check independent of BOTH arms catches a symmetric error.
  Not a reversal. Full argument: `docs/history-2.md`, WS2 T4.1 Step 0a. No owner.

Beyond that: no phase is queued after Phase 4; remaining work is section 5's deferred items.

### 4. Open bugs

(none)

### 5. Deferred tasks

- [DEFERRED · BLOCKS T4.1 CLOSE] `fa-inference` is OFF by default, so a shipped build cannot run
  forced alignment at all. `src-tauri/Cargo.toml`'s `[features]` declares `fa-inference =
  ["dep:ort"]` with **no `default = [...]` key**; only `tauri:dev:fa` passes `-f fa-inference`.
  `fa.rs:817` gates the inference arm and `fa.rs:847`'s `#[cfg(not(...))]` arm returns
  `not_implemented` — so in `tauri:dev`/`tauri:build` EVERY FA run rejects and falls back to
  Whisper timing. Fail-clean, but the whole FA feature (including T3.2's cardinal generator, whose
  only production consumer is the gated `fa_onnx`) is unreachable in a shipped binary.
  **T4.1 MUST NOT CLOSE WHILE THIS IS OPEN**: an App Settings surface offering FA model downloads
  in a binary that cannot run FA is a worse defect than the one T4.1 fixes. Full diagnosis:
  `.work-phase4/session-ws2-38/step4-cardinaldata-reachability.md`. **Revisit trigger:** before any
  shipped build advertises FA. Owner: operator.
- [DEFERRED · OUT OF SCOPE BY RULING] Two groups of persisted state are deliberately NOT on a
  settings surface, excluded by CLAUDE.md §5's live-feedback criterion (a control belongs in
  Settings only when it has no live visual feedback where it is used): (a) style presets and look
  presets (`kinetix:stylePresets:v1`, `kinetix:lookPresets:v1`) — a machine-global content
  library, authored and previewed in the Effects tab; (b) the five per-project global effects
  fields (`globalTransition`, `globalTransitionDuration`, `globalAnimation`, `globalOverlayFilter`,
  `globalOverlayConfig`) — they render into the preview the instant they change. Both found by
  T4.1's Step 0 sweep. **Revisit trigger:** an overturn of the criterion itself, not a fresh
  argument about either group. Owner: operator.
- [DEFERRED] Duplicate asset blob set — `FINAL TEST V8` holds 798 IndexedDB asset rows for a
  project carrying 399 `project.assets` entries (exactly 2x). Separate defect from T4.1; not
  investigated. Every switch pays a double `getAllAssetsForProject` read and the orphan-drop pass
  silently tolerates the extras, so it is invisible in the UI. **Trigger:** any project where
  `getAllAssetsForProject` returns more rows than the project has assets. No owner.
- [DEFERRED · NOT DETERMINED] Cold-start switch outlier — one observed project-open was far
  slower than the rest of the sample. Whether it is a real class of slow open or a one-off
  (first IDB connection, OS page cache) is undetermined: there is no corpus of timed opens to
  measure against, and a single observation cannot separate the two. **Revisit trigger:** a
  reproducible repeat, or timing instrumentation across many opens. No owner.
- [DEFERRED · NOT DETERMINED] `getMediaDuration` back-compat backfill on switch — the
  rehydration pass in `handleSwitchProject` probes every video asset whose `Asset.duration` is
  undefined, serially inside a `Promise.all` of `createObjectURL`+`<video>` loads. Whether this
  measurably costs anything depends on how many pre-`Asset.duration` projects still exist and how
  many video assets each carries — not measurable here (no corpus of legacy projects). Correct as
  written; the open question is cost, not behavior. **Revisit trigger:** a timed open of a real
  legacy project with many video assets. No owner.
- [DEFERRED] 120fps preview decode lag — the decode-ahead cap must be expressed in bytes, not
  frame count; the formula is already derived but full implementation is deferred. On the Windows
  build the preview shows a frozen frame; export (a separate, non-windowed sequential decoder) is
  unaffected. Full diagnosis: `docs/ws2-video-ingest/bug3-diagnosis.md`.
- [DEFERRED] Arbitrary frame rate support — some assets are 24fps but the app assumes a single
  project frame rate throughout; rests on the same single-project-frame-rate assumption as the
  120fps item above. No owner.
- [OPEN · NON-BLOCKING] Bare-key shortcut chain ignores `shortcutsSuppressedRef` — the leak spans
  the WHOLE chain, not only timeline focus. `App.tsx`'s keydown handler guards Space, `+`/`-`,
  arrows and `F` with `isTextEntryElement(document.activeElement)` alone, which asks what has FOCUS,
  not whether a modal is up; `shortcutsSuppressedRef` (which lists every modal flag) is read only by
  `resolveShortcutAction`, the undo/redo chords. So with any modal open and focus on a non-text
  element those keys still act behind the dialog. **S and D were FIXED in WS2 T4.1** (the
  destructive pair); the rest of the chain still leaks. No owner.
- [DEFERRED] S/D hotkey scope is gated on a selected/targeted segment plus the text-entry guard and
  (since T4.1) modal suppression — but still not on true TIMELINE focus. Checked 2026-08-31: the
  blocker is clip focusability, not the guard — Timeline's clip elements and its scroll container
  carry no tabIndex/role (deliberately removed in 299f014), and the container's mousedown-capture
  handler actively suppresses the browser's own focus-shift on click. Gating S/D on focus-within the
  timeline needs tabIndex plumbing across clip elements plus revisiting that suppression, which
  touches selection and scrubbing — out of scope here. No owner.
- [DEFERRED] `textNormalize.ts`'s `digitTokenToWords` emits English cardinal/year words for every
  language's digit tokens — never gated by `languageCode` (es `"23"` → `"twenty three"`). T3.2
  closed the ENGLISH half only and left es/fr/pt/de diverging in a NEW way: FA now emits
  `veintitrés` while the matcher still emits `twenty three`, so the two arms fail DIFFERENTLY and
  a diagnosis reading one arm will mis-attribute it. That wrongness ships today; "T3.2 is done"
  overstates it. Invisible in all three golden corpora only by a symmetric-fold coincidence
  (`spanish`'s `"12"`). Full statement of the reframing: `docs/history-2.md`, WS2 T4.1 D6/D3 entry.
  **Revisit trigger:** a real es/fr/de/pt corpus with digit content that does not coincide with the
  English reading. No owner.
- [DEFERRED] fr/pt/de elision (`l'élève`-class apostrophe handling) — `canonicalize()` splits any
  apostrophe not in the English-only `CONTRACTIONS` map into two tokens on every branch, every
  language; `faTextNormalize.ts` keeps it one token. Whether this is a real match defect is
  genuinely **NOT DETERMINED** — no fr/pt/de corpus in this repo contains elision content to
  measure against (`.work-phase4/session-ws2-33/t32-numeral-diagnosis.md` §2.3). Structurally
  separate from T3.2 (apostrophe handling, not digit handling) and from T3.1 (would touch the
  es/fr/de/pt branch of `canonicalize()`, which needs its own standing-ruling sign-off) — do not
  fold into either. **Revisit trigger:** a real fr/pt/de corpus, or an explicit operator decision
  to scope it as its own task. No owner.
- [DEFERRED] French `composeHundred` pluralizes "cent" unconditionally whenever its local
  remainder is 0, with no signal for whether a further NUMERAL scale word ("mille") follows —
  produces "deux cents mille" for 200000 where correct French is "deux cent mille". Encoded as a
  `knownLossy` fixture entry on `fa-cardinal-fr.json`'s `hundred` config (`7901c27`), not fixed —
  needs a new schema signal threaded from `composeScaleLevel` into `composeHundred`. **Revisit
  trigger:** any corpus containing a French number ≥200,000 where a numeral scale word follows a
  plural-hundreds group; also worth revisiting once a real fr corpus exists (see below). No owner.
- [DEFERRED] CTC margin exposure — the standing inference that a wrong number reading costs only
  local mis-timing is refuted: `align_chunked`'s `TooManyRepeats` fallback is per-CHUNK, and a
  misread English year (the "compound" reading picked where "pair" was correct) adds
  `delta(L+R) = +16` to a chunk's CTC target length. Measured against real production chunk plans:
  173's worst real margin is 9 (chunk 84), with 2 of 403 real chunks across all three corpora
  (both in 173) close enough to flip to whole-chunk placeholder timing under that delta.
  Unreachable today — no corpus contains a year-shaped digit token to actually trigger it.
  **Revisit trigger:** any corpus containing a year-shaped (4-digit, in-range) numeral — at that
  point this finding becomes live risk, not a bound. No owner.
- [DEFERRED] No fr/de/pt golden corpus exists in this repo — the common prerequisite behind
  several items above (the digit-cardinal language-gating item can't be measured against real
  content; the elision question is genuinely undetermined without one; T3.2 Option 1's four-
  language linguistic design work was scoped only against the one real es corpus). T3.1's own
  conformance fixture (`canonicalize-conformance-fixture.json`) had to work around this by testing
  `canonicalize()` directly rather than through a corpus. **Revisit trigger:** acquiring a real fr,
  de, or pt script+transcript+audio corpus — unblocks the digit-cardinal item, the elision
  question, and any future fr/de/pt T3.2 Option-1 work simultaneously. No owner.

---

*Full history: `docs/history-2.md`. Standing reference material: `sync-pipeline-v2-plan.md` Part AK.*
