# Work In Progress

> **Purpose:** the active task ledger — one line per task, no narrative. **Line cap: 300**
> (raised from 250, WS2 Step 15, to fit the six-section structure below across two workstreams).
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

> ⚠ **STRUCTURE CONTRACT (WS2 Step 15, permanent):** every workstream in this file has exactly
> these six sections, in this exact order, with these exact names:
> 1. **FINISHED TASKS** (complete AND verified — one-line pointers into `docs/history-2.md`, never
>    full entries)
> 2. **FINISHED BUT PENDING VERIFICATION** (complete, a proof step still outstanding)
> 3. **IN PROGRESS** (actively worked; required tasks listed FIRST, one **END GOAL:** line at the
>    BOTTOM stating what's achieved once every listed task is done — mandatory even when the
>    section body is `(none)`)
> 4. **NEXT TASKS** (planned, not started)
> 5. **OPEN BUGS** (defects found during development)
> 6. **DEFERRED TASKS** (not urgent, non-blocking)
>
> Sections are never renamed, reordered, or omitted — a new workstream is created with all six
> headings present even if empty. Mirrored in `CLAUDE.md` §5 so future sessions can't drift.
>
> **Tag vocabulary (file-wide):** `[OPEN]` = unresolved, no fix built. `[IN-PROGRESS]` = actively
> worked. `[DEFERRED]` = real defect, work explicitly paused by an operator decision.
> `[OPEN · NON-BLOCKING]` = real, confirmed-open defect that doesn't block a lock/release gate —
> NOT "accepted" or "not a bug." `[CLAIM-UNVERIFIED]` = not a code defect — an operational
> task/claim not yet confirmed by direct evidence. Tags describe an item's state; the section
> describes where it lives. FINISHED and FINISHED-BUT-PENDING-VERIFICATION entries carry no
> bracket tag (pointer format only) — tags apply to IN PROGRESS / NEXT / OPEN BUGS / DEFERRED.
> If a tag would contradict its new section, the section wins; every tag WS2 Step 15 changed for
> that reason is listed at the end of the WS2 block.

---

## WS1 — Sync Pipeline Rewrite
Started: 2026-08-04 | Status: active — Phase 3 in progress, accuracy bar met.

### 1. Finished tasks

- Phase 1b — `window.__transcriptInspector()` dev instrumentation. `docs/history-2.md`
- Phase 2a — Whisper → `ggml-large-v3-turbo.bin` + `Project.language`/unsupported-language guard
  (2026-08-05). `docs/history-2.md`
- Phase 2b — DTW measured/abandoned; forced alignment chosen; Stage 1's 4 thresholds finalized
  (2026-08-05). `docs/history-2.md`
- Phase 3b — 5 fr/es/de/pt normalization rules shipped in `faTextNormalize.ts` (2026-08-15).
  `docs/history-2.md`
- Phase 3c — 19 compound-word cases audited; unfixed timing ruled correct (2026-08-15).
  `docs/history-2.md`
- Phase 3d — skipped per its own trigger, dormant since 2026-08-25 freeze. `docs/history-2.md`
- Sessions A–AN — forced-alignment research arc (2026-08-15–24): rules R.5/R.10–R.15, Zero-Defect
  Register triage. Frozen under the accuracy-bar ruling below. `sync-pipeline-v2-plan.md`
- Mover-audit dossier — owner-scored 22/24, both failures fixed via R.13 (Session K, 2026-08-18).
  `docs/history-2.md`
- FA session-cache OOM fix — root-caused, fixed, guardrailed, real-app confirmed —
  `docs/history-2.md#2026-08-25--6a1b939--6a1b939-fa-session-cache-oom-fix` (`6a1b939`, `c295cb3`)
- `boundaryUsedFallback` 4-arg → 5-arg call-site fix, golden replay 6/6 unchanged (WS2 Step 11) —
  `docs/history-2.md#2026-08-26--ws2-step11-boundaryUsedFallback-fix`

### 2. Finished but pending verification

(none)

### 3. In progress

Phase 3 (Task 5), past 3b/3c (closed) and 3d (skipped, dormant). Chunking/accuracy research is
frozen under the 2026-08-25 accuracy-bar ruling (~97–98% of boundaries correct on first sync,
≥95% accepted; remaining errors go through manual UI review, not further pipeline changes).
FA default toggle (`FA_PROJECT_DEFAULT_ON`) is OFF pending the live acceptance run below;
0 of 4 stage locks passed.

- [ ] Execute the live acceptance run and get an owner pass/fail verdict
  (`stage1-live-run-prep.md`).
- [ ] Flip `FA_PROJECT_DEFAULT_ON` once the live run passes.
- [ ] Ear-verify the 4 provisional R.12 closures (v6 boundaries 085, 224, 307, 383) — move from
  structurally-correct to ear-verified.
- [ ] Ratify R.7 confidence-flag handling; build its two unbuilt failure paths (skip-and-flag,
  force-split).
- [ ] Produce real `fa-vocab-<lang>.json` production files; wire `project.language`/`vocabChars`
  into both `computeFaChunkPlan` call sites.
- [ ] Task 2 — re-derive the 50/50 silence-split rule in `snapBoundaries.ts` against current
  `main` (deliberately breaks golden replay — needs per-boundary review, never a blind re-baseline).
- [ ] Task 3 — a dedicated test for stale-anchor scroll degradation (currently code-read only).
- [ ] Wire `FaEvent` to a UI progress consumer (no hook/component consumes it yet).
- [ ] Owner scoring of the 24-row mover audit dossier (`docs/ws1-sync-pipeline/stage1-mover-audit.md`).
- [ ] Give the rule stage its own fixture-backed regression coverage — golden replay stops at
  `snapCoveredBoundaries` and never reaches chunk plan/FA/any rule (`CLAUDE.md` §4 Testing).

**END GOAL:** Stage 1 locks — every STAGE 1 LOCK GATE criterion satisfied (live acceptance run
passed by the owner, Contract IN / Contract 1→2 inspection, determinism, non-English written
acceptance, R.5/R.10, mover-audit dossier, no Stage 1 defect deferred downstream) — and
`FA_PROJECT_DEFAULT_ON` flips to ON.

### 4. Next tasks

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

### 5. Open bugs

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
* [OPEN] Spanish-corpus acceptance lapse — unresolved owner decision, drifting since 2026-08-15:
  the acceptance's reopening trigger ("voids the moment Spanish-specific normalization/alignment
  code ships") was satisfied in literal text by Phase 3b's Spanish cardinals (2026-08-15); no
  session has ruled whether it actually reopens the acceptance. 3 options + costs:
  `sync-pipeline-v2-plan.md` Part AK.1 / AI §AI.8. **Needs a ruling.**

### 6. Deferred tasks

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
runtime-verified on real Windows hardware; 3 closed did-not-reproduce, no code fix). Two new
open items surfaced by WS2 Step 15's Windows operator log (non-ASCII matching, cut-placement
quality) and the pre-existing macOS-arm64/MSVC-redistributable gaps remain.

### 1. Finished tasks

- WS2 bug 1 — rescued-segment anchor ordering, fixed via a trusted spine —
  `docs/history-2.md#2026-08-26--2ae4d18--2ae4d18-ws2-bug1-trusted-spine` (`2ae4d18`, `1e5deb7`)
- WS2 bug 3 — DID-NOT-REPRODUCE on a HEAD build; **no code fix exists, not relabeled "fixed"** —
  `docs/history-2.md#2026-08-26--no-fix--ws2-bug3-closed-did-not-reproduce`
- WS2 Step 10 — FA error serialization (`[object Object]` → real messages), general fix —
  `docs/history-2.md#2026-08-26--88ff701--88ff701-ws2-step10-error-serialization` (`88ff701`)
- WS2 Step 10/11 — Windows voiceover `fetch(blob:)` fix, 6 further call sites guarded —
  `docs/history-2.md#2026-08-26--56e2116--56e2116-ws2-step10-windows-voiceover-fetch` (`56e2116`),
  `docs/history-2.md#2026-08-26--ws2-step11-fetch-sites`
- WS2 Step 11 — `boundaryUsedFallback` diagnostic-only arg-count fix, golden replay unchanged —
  `docs/history-2.md#2026-08-26--ws2-step11-boundaryUsedFallback-fix`
- WS2 Step 12/13 — Manage Models & Add-ons modal: real Import + real resumable/checksummed
  Download, status-check bug fixed —
  `docs/history-2.md#2026-08-27--ws2-step12-manage-models-modal-a3`,
  `docs/history-2.md#2026-08-27--ws2-step13-fa-download-engine-ort-provisioning` (`4a50680`, `63cd717`)
- WS2 Step 13 Phase 4 — cross-platform ORT provisioning, table-driven + checksum-verified —
  `docs/history-2.md#2026-08-27--fix--5adbbf4-ci-macos-globstar-fix` (`4f31d38`, `5adbbf4`)
- **WS2 Step 15 — MEASURED-FROM-OPERATOR-LOG before/after (117→9 cuts, 3.39/03:57 runs kept
  separate)** —
  `docs/history-2.md#2026-08-27--ws2-step-15--ws2-step15-windows-operator-log-before-after`
- WS2 Step 15 — Windows voiceover fetch bug CLOSED against real Windows hardware —
  `docs/history-2.md#2026-08-27--ws2-step-15--ws2-step15-windows-fetch-bug-closed`
- WS2 Step 15 — error-serialization defect CLOSED against real Windows hardware —
  `docs/history-2.md#2026-08-27--ws2-step-15--ws2-step15-error-serialization-closed`
- **WS2 Step 15 — bug 2 (FA silently disabled on desktop) CLOSED, CI-VERIFIED BUILD + MEASURED
  RUNTIME** (Q1: build came from GitHub Actions "Build desktop installers"; FA ran, 2181 aligned
  words, matching macOS) —
  `docs/history-2.md#2026-08-27--ws2-step-15--ws2-step15-bug2-fa-desktop-closed-ci-verified`
- **WS2 Step 15 — bug 4's acquisition path CLOSED, END-TO-END VERIFIED** (Q2: "en" model reached
  the machine via the Download button in Manage Models & Add-ons) —
  `docs/history-2.md#2026-08-27--ws2-step-15--ws2-step15-bug4-acquisition-closed-end-to-end`
- WS2 Step 15 — token filtering resolved as a Whisper-path-vs-FA-path property (Whisper 10.6%/
  11.0% Windows/macOS, FA 0.05% both); mechanism NOT DETERMINED —
  `docs/history-2.md#2026-08-27--ws2-step-15--ws2-step15-token-filtering-resolved`

### 2. Finished but pending verification

- [CLAIM-UNVERIFIED → narrowed] Whether FA runs correctly from a **CI-built macOS** installer
  artifact specifically — the Windows leg closed via WS2 Step 15 (CI-built, measured runtime);
  the macOS Download/Import verification on record ran on the operator's local dev build, not the
  CI `universal-apple-darwin` artifact. Remaining step: an operator run of the CI-built macOS
  artifact with FA. `docs/history-2.md#2026-08-27--correction--ws2-step15-a5-p2-fully-superseded`
- FA onnxruntime dlopen/inference on **macOS arm64 (Apple Silicon)** — Windows dlopen/inference is
  now MEASURED (Step 15); the macOS universal dylib is built and lipo'd but has never executed on
  real Apple Silicon hardware. No such hardware available in any session to date. Remaining step:
  run the built app on an Apple Silicon Mac and confirm FA executes.
  `docs/ws2-fa-models/ort-provisioning.md`

### 3. In progress

(none)

**END GOAL:** every platform this project ships (Windows CI-built, macOS CI-built universal,
macOS local) runs forced alignment correctly end-to-end from a fresh, never-hand-provisioned
install, with no known-open code defect blocking a release build.

### 4. Next tasks

(none beyond the deferred items below — WS2's numbered-bug backlog is closed; remaining work is
the two open bugs and two deferred items below.)

### 5. Open bugs

* [OPEN] Non-ASCII proper-noun matching — every remaining low-match-rate failure in the WS2 Step
  15 03:57:28 Windows run involves diacritics or foreign place names: segment 52 skipped entirely
  ("Llívia", 0 of 2 words, confidence 0.00); segment 69 ("Llívia stayed Spanish." 2 of 4, 50%);
  segment 79 ("Peñón de Vélez de la Gomera" 4 of 8, 50%); segment 8 ("The complexity originates in
  1198" 4 of 7, 57%); segment 102 ("300 American residents." 2 of 4, 50%). Segment 79 failed in
  BOTH the before and after runs — not a Windows issue, not fixed by FA. Hypotheses, all
  UNVERIFIED: Unicode normalization (NFC vs NFD) mismatch between transcript and script; the
  en-language CTC vocab (measured 33 symbols) may lack glyphs for í/ñ/é; numeral-to-word expansion
  for "1198"/"300". No fix attempted. `docs/history-2.md`'s Step 15 entries.
* [OPEN · NON-BLOCKING] Cut-placement quality — 9 of 228 cuts land on live audio in the WS2 Step
  15 Windows AFTER run (~96.1%, vs. the ~97-98% bar): segment pairs 53/54, 68/69, 101/102,
  109/110, 123/124, 138/139, 195/196, 202/203, 218/219. At macOS parity (10) — a pre-existing
  cross-platform quality gap, not a Windows regression, not closed by this workstream's fixes.
* [OPEN] MSVC Visual C++ Redistributable — `onnxruntime.dll` on Windows needs it present on the
  end-user machine; not bundled and not yet chain-installed by the installer. Unresolved even
  though Step 15 confirmed FA runs on the (already-provisioned) test machine.
  `docs/ws2-fa-models/ort-provisioning.md`

### 6. Deferred tasks

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
- [OPEN · NON-BLOCKING] Stray worktree housekeeping — `.claude/worktrees/elated-haibt-ab90e1`
  should be removed once confirmed unneeded; not urgent, doesn't block any WS2 task.

**Tags changed this restructure (WS2 Step 15, per the structure contract's "section wins" rule):**
Windows voiceover fetch bug: `[IN-PROGRESS]` → moved to Finished (closed, no tag). Bug 2 (FA
silently disabled): was untagged in the old "Finished" list pending CI/runtime proof — now a
plain Finished pointer, fully closed. Bug 4 acquisition half: was `[CLAIM-UNVERIFIED]` — now a
plain Finished pointer, fully closed. CI-installer runtime verification: was one
`[CLAIM-UNVERIFIED]` row covering both platforms — split; Windows closed (Finished), macOS
narrowed and moved to Finished-but-pending-verification. FA onnxruntime provisioning: was `[OPEN]`
covering both Windows and macOS arm64 — split; Windows closed (Finished), macOS arm64 moved to
Finished-but-pending-verification (no bracket tag, per the no-tag convention for that section).

---

*Full history: `docs/history-2.md`. Standing reference material: `sync-pipeline-v2-plan.md` Part AK.*
