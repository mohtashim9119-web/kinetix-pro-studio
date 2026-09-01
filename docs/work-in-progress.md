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
Started: 2026-08-26 (Step 3) | Status: all 4 numbered bugs closed (1/2/4 code-fixed and now
runtime-verified on real Windows hardware; 3 closed did-not-reproduce, no code fix). A
sync-pipeline defect surfaced by WS2 Step 15's Windows operator log (non-ASCII matching) was
relocated to WS1 §4 — see that section. macOS CI-artifact/arm64 FA
platform verification and MSVC redistributable are both closed (OPERATOR-ATTESTED); the
autosave-quota bug is fixed (T1.3, OPERATOR-ATTESTED live `tauri:dev` verification, see
`docs/history-2.md`). Phase 1 (project data durability & foundations) is fully closed —
T1.1/T1.2/T1.3 all done. Phase 2 closed at a MUCH SMALLER scope than originally planned: T2.1
pivoted from its original never-drop design through a full gap-absorption restore UI
(automatic + a Forced Restore human override) to, finally, visibility-only reporting — the
restore UI produced inaccurate micro-durations in silent gaps that needed manual correction
anyway, so the operator had it removed entirely (session ws2-26, round 1 of 2,
`docs/history-2.md`'s ws2-t21 entry). T2.2 (the operator-override persistence layer the restore
UI needed) is closed as not-building — there is nothing left for it to persist. Recovering a
dropped scene is now fully manual: jump to it via the sync log's "Jump to absorbing scene" link,
then split (`S`) the absorbing clip and retype. Two real bugs surfaced by that same removal pass
(sync-log host-numbering off-by-one, split-then-delete text loss) are fixed and
operator-verified (`docs/history-2.md`'s ws2-t21 round-2 record). Phase 3 (Text and number
normalization, T3.1+T3.2) is now closed — canonical-form matching (T3.1: language-threaded
matcher, NFD diacritic fold, tokenHash identity column, es/fr/de/pt conformance fixture) and a
compositional FA-side cardinal-number generator (T3.2, TS+Rust atomic) both landed on
`ws2-t31-language-thread`, sessions ws2-28 through ws2-36; full record in `docs/history-2.md`.
Phase 4 (Settings & project creation) is now in progress.

### 1. Finished but pending verification

(none)

### 2. In progress

[IN-PROGRESS] Phase 4 — Settings & project creation
  T4.1 App Settings page owning Models & Add-ons (machine-global); Project Settings shows a
       read-only requirement row that deep-links to it; missing-model check moved into
       faPreflight.ts and surfaced in the sync log.
  T4.2 New-project flow: language dropdown, FA sync ON by default, project-scoped settings
       only; fix the stale blurred previous project by unmounting the editor and clearing
       activeProjectId on close.

**END GOAL:** A new project can be created with an explicit language choice and FA sync on by
default, and the machine-global model/add-on requirement is surfaced and satisfiable from
Settings before a sync ever needs it — closing the gap Phase 3 assumed (a project always
carries a real `project.language`).

### 3. Next tasks

- [OPEN] Re-examine ruling C3 (dual TS+Rust implementation of the shared normalization surface,
  kept honest by a conformance fixture) — it was never revisited after the surface changed shape,
  and the reason to revisit is not that the surface got bigger. **The surface acquired a POLICY.**
  C3 was ruled when the shared surface was a small lookup: two implementations of a table are
  cheap to keep honest, and a conformance fixture is an adequate guard because a table entry is
  either right or wrong on its face. By the close of Phase 3 the shared surface was a
  compositional cardinal generator, five per-language data files, and a year-reading selection
  policy with a named threshold, in two languages. A conformance fixture over a THRESHOLD RULE
  tests that the two implementations **agree**, not that either is **correct** — and both can
  satisfy it while both are wrong. That is not hypothetical here: the propagated x00-x09 quirk is
  the standing example, deliberately mirrored into both sides so `1905` reads as a cardinal. The
  fixture is green, parity is real and was the right priority, and both sides are confidently
  wrong together. A fixture catches drift; it does not prevent it, and it cannot see a defect that
  is symmetric across the two arms (see `CLAUDE.md` §4 Testing's fixture-reach rule — this is the
  same failure mode at ruling scale). Re-examination should ask what C3 costs now that the shared
  surface carries policy rather than data, and what independent-of-both-arms check, if any, could
  catch a symmetric error. Not a decision to reverse C3 — a decision to re-derive it against the
  surface that actually exists. No owner.

Beyond that: WS2's numbered-bug backlog is closed and Phase 3 is done; no phase is queued after
Phase 4. Remaining work beyond Phase 4 is the deferred items in section 5.

### 4. Open bugs

(none)

### 5. Deferred tasks

- [DEFERRED] 120fps preview decode lag — the decode-ahead cap must be expressed in bytes, not
  frame count; the formula is already derived but full implementation is deferred. On the Windows
  build the preview shows a frozen frame; export (a separate, non-windowed sequential decoder) is
  unaffected. Full diagnosis: `docs/ws2-video-ingest/bug3-diagnosis.md`.
- [DEFERRED] Arbitrary frame rate support — some assets are 24fps but the app assumes a single
  project frame rate throughout; rests on the same single-project-frame-rate assumption as the
  120fps item above. No owner.
- [DEFERRED] S/D hotkey scope is gated on a selected/targeted segment plus the text-entry guard,
  not true timeline focus. Checked 2026-08-31: the blocker is clip focusability, not the guard —
  Timeline's clip elements and its scroll container carry no tabIndex/role (deliberately removed
  in 299f014), and the container's mousedown-capture handler actively suppresses the browser's own
  focus-shift on click. Gating S/D on focus-within the timeline needs tabIndex plumbing across clip
  elements plus revisiting that suppression, which touches selection and scrubbing — out of scope
  here. No owner.
- [DEFERRED] `textNormalize.ts`'s `digitTokenToWords` emits English cardinal/year words for every
  language's digit tokens — never gated by `languageCode` (e.g. es `"23"` → `"twenty three"`, not
  `"veintitrés"`). Real, confirmed (T3.2 diagnosis; `sync-pipeline-v2-plan.md` H.5). Currently
  invisible in all three golden corpora because the only real non-English digit content
  (`spanish`'s `"12"`) folds to the same wrong word on both sides of the aligner (a symmetric-fold
  coincidence, not evidence the behavior is correct). **Reframed after T3.2 landed (2026-09-02):
  T3.2 closed the English half of a two-sided divergence and left the other four languages
  diverging in a NEW way — this is not "the same gap, still deferred."** Before T3.2 both sides
  were wrong in the same direction: FA and the matcher each emitted the English reading, so the
  divergence was uniform and one fix would have closed it. After T3.2 the FA side emits
  `veintitrés` for Spanish while the matcher still emits `twenty three`, because
  `digitTokenToWords` is not language-gated. The two sides now fail DIFFERENTLY, which means the
  observed failure signature depends on which side you read — a diagnosis that reads only one arm
  will mis-attribute it. **English is genuinely closed; es/fr/pt/de are not, and that wrongness
  ships today.** Deferring remains correct (zero non-English digit corpora — a fix cannot be
  measured against real content), but "T3.2 is done" overstates it: only the English half is.
  **Revisit trigger:** a real es/fr/de/pt corpus whose script or transcript contains digit content
  beyond what happens to coincide with the English reading. No owner.
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
