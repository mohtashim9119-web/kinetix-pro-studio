# WS1 final-shape mapping — 2026-09-18

> Third read-only pass over the WS1 sync pipeline. Maps the CURRENT tree against the
> operator's binding final shape and proposes a permanent solution per gap. One docs-only
> report, this file. No source file and no other doc file was modified by this pass.
> Branch `ws1-plan-rewrite`, committed here, merge-only (never rebase), no push, no PR,
> no CI dispatch, no cloud spend, no network job. Nothing was deleted.
>
> Builds on two prior passes: the FA wiring ground-truth audit
> (`docs/architecture/fa-wiring-audit.md`, base `eb1c4fa`) and the gap-closing
> verification (`docs/ws1-sync-pipeline/gap-closing-verification-2026-09-18.md`,
> commit `5970984`). Findings from those passes are re-verified, not restated on trust;
> where this pass contradicts them it says so explicitly.

---

## 0. Answers-block echo (operator-filled, binding)

Recorded verbatim in substance so the proposals below can be checked against their constraints.

**Q1 — Engine UI.** The FA toggle disappears entirely; no FA on/off control anywhere. FA is
not a user choice — it always runs as part of whichever engine is selected. Whisper-only is
never offered as a pick; it exists only as an automatic, visibly-flagged degraded state.
Settings → Sync → "Default engine": Cloud (default) / Local, one radio-style setting. The
sync panel shows which engine will run, with a one-click per-run override that does not
change the global default. Offline is runtime behaviour, not a setting: Cloud selected + no
network → sync pauses with "Cloud unavailable — switch to local / cancel." Settings → Sync →
Local lists local models with sizes and integrity status (Whisper ggml-large-v3-turbo
1,624,555,275 bytes; 5 FA packs 6,312,776,755 bytes total), display/manage only, no
enable/disable controls. Settings → Sync → Cloud shows credits balance and account status.

**Q2 — Local FA language plumbing.** Left blank by the operator; the stated LEAN applies and
is binding: wire the dormant language/vocab normalization at `forcedAlignmentRun.ts:142` so
the local fallback works properly for all five packs. **This pass found that the lean
under-estimates the work — see §M3.9; the missing piece is a runtime data loader that does
not exist, not a forgotten argument.** Flagged for architect decision, not re-scoped here.

**Q3 — Cost visibility.** Credits wallet, never raw costs. $5.00 = 50 cloud syncs; each
successfully completed cloud sync deducts $0.10 (1 credit). Credit price and pack size are
operator-controlled constants, deliberately decoupled from backend cost; real compute cost is
never displayed. Deduct only on success — free on cache hits, user cancels, failed jobs, and
retries that do not complete. Balance zero → cloud unavailable in the engine picker; offer
Local (free) and a top-up entry point. Per-sync credit use appears in the sync log next to
the engine stamp.

**Q4 — Parity validation.** Skip operator-provided native audio entirely. No
French/German/Portuguese sample pass. **Not flagged as an open item, gap or blocker anywhere
in this report or in STATUS.md.** Parity validation is scoped to the English re-run only
(after Wave 1, separately authorized cloud spend). fr/de/pt quality is production-monitored
via real usage signals (failed-chunk rate, estimated-scene counts in the sync log).

---

## 1. Decision Log (conservative defaults, logged per instruction — never asked)

1. **Report filename.** Prior WS1 reports use `<topic>-<date>.md`
   (`gap-closing-verification-2026-09-18.md`, `stage1-live-run-prep.md`,
   `stage1-mover-audit.md`). Chose `final-shape-mapping-2026-09-18.md` — same lane
   directory, same date convention, distinct topic prefix so it cannot collide with the
   gap-closing report written the same day.
2. **The six gates were NOT run this pass.** This worktree has no `node_modules` and no
   `src-tauri/target` (verified: both absent). Installing either is a real environmental
   change, not a read-only check; running them from the main checkout would require leaving
   this worktree, which the environment instruction forbids. Conservative default: carry
   forward the gap pass's recorded results, which remain valid because `main` is at the same
   SHA it was then (`4bd18ce`, unmoved — §M1) and every sync-lane file is byte-identical
   between the two passes. Recorded as inherited evidence, never as a fresh green.
   Consequence for §M6: the "gates green" criterion is scored on inherited evidence and
   labelled as such.
3. **"Eight frozen byte constants / four fixture digests."** The gap pass marked these OPEN —
   no canonical list found. This pass located a candidate set that lands on exactly eight and
   exactly four (§M3.12) and proposes it for operator confirmation. **Proposed, not
   asserted.** All candidates were verified to have an empty diff between the audit base and
   `main`, so the immutability requirement is satisfied either way.
4. **`computeUnscriptedRuns` 4x→1x.** The known item as written is **not supported by the
   tree** (§M3.7). Rather than silently re-scoping it, the item is dispositioned as
   "mis-stated; real defect is adjacent and larger" and the real one is mapped.
5. **S2 strip ~1600 lines.** The figure does not survive contact with the callers (§M3.8).
   Dispositioned as "proposal materially overstated"; the defensible strip is ~180 lines.
   Nothing deleted this pass — strip plans are proposals only, per remit.
6. **D24's STATUS.md placement.** Still filed under WS3 Open Bugs (`docs/STATUS.md:120`)
   despite being a sync/FA concern. Flagged for the third time, not relocated — STATUS.md is
   at its 40/40 cap and this pass adds nothing to it.
7. **One-job vs two-job cloud shape.** The operator's final shape says one engine job; the
   recorded cloud plan specifies two independently invocable functions
   (`docs/architecture/cloud-asr-plan.md:53`, `:110`). This is a genuine conflict. Not
   resolved unilaterally — mapped as an architect decision with a recommendation (§M4.2).

---

## 2. M1 — Refresh

| Ref | SHA | Movement since gap pass |
|---|---|---|
| `main` | `4bd18cef895b6210d958653281dd2e0de99db440` | **Unmoved** |
| `origin/main` | `4bd18cef895b6210d958653281dd2e0de99db440` | In sync |
| `ws1-plan-rewrite` (this branch) | `5970984a9920be3cbc76d0d4a5e8bb577ac74d68` | Gap-pass commit is the tip |
| `ws-cloud-asr-plan` | `eb1c4fa199f924aca299598fcc5cbb170841f656` | **Unmoved** (audit base) |
| `origin/ws-cloud-asr-plan` | `eb1c4fa199f924aca299598fcc5cbb170841f656` | In sync |

`git diff --stat 5970984 main -- src/App.tsx src/services/ src-tauri/src/` → 13 files, 1598
insertions / 131 deletions — **the identical WS3 storage-root set the gap pass already
characterised** (`storage_root.rs` +1414, `lib.rs`, `models.rs`, `whisper.rs`, `fa.rs`,
`ffmpeg.rs`, `project_mirror.rs`, `App.tsx` +12 `addedAt` lines, four WS3-only services).
`ws1-plan-rewrite` is a docs-only commit on top of `eb1c4fa`, so this diff is the same
17-commit WS3 window measured from a different base. **No sync-lane behavioural drift.**

Working tree carries one untracked file — `docs/archive/ws1/sync-pipeline-v2-plan-original.md`
— present at session start, left untouched.

**Prior-finding re-verification.** Every citation this pass depends on was re-read at its
current line rather than inherited. Three corrections to prior passes are recorded, all in
this pass's favour of precision, none behavioural:

- `forcedAlignmentRun.ts` — the `fa_stage_audio_raw` invoke is at **`:163`**, not `:150`;
  the `fa_align_production` invoke is at **`:179`**. Confirmed by direct read.
- `whisper.rs:588` `MODEL_FILENAME` — the gap pass's `589→588` correction holds.
- The audit's `App.tsx:3918` and the gap pass's `App.tsx:3849` for `cachedTokensReady` are
  **both right**: `:3849` is the declaration, `:3918` the `if`. Not a contradiction.

**The 16-step Apply Sync flow — holds in substance, but the numbering in the source is not a
16-step spine and never was.** `handleApplySyncFromFiles` (`App.tsx:3678`) carries exactly six
numbered step comments — `1.` (`:3712`), `2.` (`:3720`), `3.` (`:3793`), `5.` (`:3824`),
`7.` (`:3844`), `8.` (`:4632`) — with **4 and 6 absent**, a numbering gap left by earlier
refactors. The machine-readable spine is the eight `syncMark` checkpoints (`applySync:entry`,
`assets+duration:done`, `parseProjectData:done`, `align+timing:done`,
`autoMatch+preserveEffectFields:done`, `preserveSegmentLocks:done`, `setProject:called`,
`first-paint(rAF)`). The 16 *stages* the prior audit walked are all present and in the same
order; §M2 maps them at that granularity. **Drift note: any doc that calls this a "16-step
flow" with step numbers is describing a narrative, not the source's own numbering.**

---

## 3. M2 — The mapping table

Gap classes: **CONFORMS** · **SMALL-FIX** · **RESTRUCTURE** · **NEW-BUILD** · **RETIRE**.
Wave numbers are proposals; §M7 carries scope/dependency/authorization detail.
"Proving test" names the test that must exist for the row to count as done; *none today* means
no such test was found.

### A. Intake and transcription

| # | Step | Today (file:line + evidence) | Final target | Gap | Permanent solution | Files in scope | Main risk | Wave | Proving test |
|---|---|---|---|---|---|---|---|---|---|
| A1 | Voiceover staged → auto-transcribe | `App.tsx:3488` `handleVoiceoverStaged`; drop slot `DropZonePanel.tsx:1234-1284`; starts Whisper immediately, independent of Apply Sync | Staging starts the selected engine's job, not "Whisper" by name | RESTRUCTURE | Route staging through an engine-resolver (`resolveSyncEngine(project, override)`) instead of calling Whisper directly | `App.tsx`, `DropZonePanel.tsx`, new `syncEngineSelect.ts` | Staging-time engine differs from Apply-Sync-time engine if user flips override between them — resolver must stamp the choice onto the staged record | 2 | `staging uses the resolved engine, not a hardcoded one` — none today |
| A2 | Whisper model load | **Loaded once PER TRANSCRIPTION RUN.** whisper.cpp is a bundled CLI sidecar, not an in-process context: spawn at `whisper.rs:979` inside `whisper_transcribe` (`:856`), model argv at `:974`, path resolved `:929`/`:590`, filename `:588`. Global state `WhisperState` (`whisper.rs:47`) caches **child process handles**, not a model. Process exits on `Terminated` (`:1038`, removed `:1068`) | Cloud default makes this moot for the common path; local path keeps per-run spawn | CONFORMS (local) | No change. The per-run 1.62 GB load is inherent to the sidecar architecture and is not worth re-architecting once cloud is default. **Closes the open 5-minute question.** | — | — | — | Answered; no test owed |
| A3 | FA ONNX model load | **Loaded once per app launch**, reused across chunks and across separate `fa_align_production` calls. Cache `FaModelCache` (`fa.rs:113`), slot `Option<CachedSession>` (`fa.rs:93-96`), `CachedSession` (`fa_onnx.rs:1211-1214`), key `{language,path,size,mtime}` (`:1189-1194`), hit/miss `:1226`, load `:1261`, drop-on-mismatch `:1259`. Conditional on `fa-inference` (on in CI installers, `build.yml:424`) | Unchanged for local engine | CONFORMS | No change | — | Five packs co-resident peak 10.9 GiB measured cloud-side (`cloud-asr-measurements.md:405`) — local cache holds one at a time by key, so not a local risk | — | Answered; no test owed |
| A4 | Transcription cancel | **Wired end to end.** `whisper_cancel` (`whisper.rs:1107`, kill `:1114-1115`) ← `whisperService.ts:1763` ← `AbortController` (`useWhisper.ts:358`, `cancelTranscription:578-579`) ← button `TranscriptionBar.tsx:36-42` via `App.tsx:6957` | Unchanged; plus a cloud-job cancel of the same shape | CONFORMS (local) / NEW-BUILD (cloud) | Keep. Cloud job needs an equivalent abort that also guarantees no credit is deducted | `whisperService.ts`, new cloud client | Cloud cancel that races a completing job could double-charge — deduction must be server-side on delivery, not client-side on start | 3 | `a cancelled cloud job deducts zero credits` — none today |
| A5 | Transcript cache key | `getFileIdentity` = `` `${name}|${size}|${lastModified}` `` — sole construction site `syncEngine.ts:383-384`; compared `App.tsx:3520`, `:3849-3853`, `:5819-5825`, `useWhisper.ts:201,469-471,507` | Content hash of audio bytes | RESTRUCTURE | Replace the volatile triple with a content hash; keep `getFileIdentity` as a fast pre-filter only. Already the recorded cloud-plan decision (`cloud-asr-plan.md:114`) | `syncEngine.ts`, `App.tsx`, `useWhisper.ts`, `types.ts` | Hashing a 30-min file on the main thread would freeze the UI — must hash in Rust (`sha256.rs` already exists, used at `asset_store.rs:218`) or a worker | 2 | `a byte-identical file re-staged with a new mtime is a cache HIT` — none today |
| A6 | Voiceover deleted → cache clear | `App.tsx:~5443-5447` clears `transcriptTokens`/`lastTranscribedAssetId`/`lastTranscribedFileIdentity` | Same, plus clear provenance | SMALL-FIX | Extend the clear to the new provenance field | `App.tsx` | Missing one field leaves orphan provenance claiming an engine for tokens that no longer exist | 1 | `deleting the voiceover clears provenance with the tokens` — none today |

### B. Apply Sync preamble

| # | Step | Today (file:line) | Final target | Gap | Permanent solution | Files | Main risk | Wave | Proving test |
|---|---|---|---|---|---|---|---|---|---|
| B1 | Apply Sync trigger | Button `DropZonePanel.tsx:1486-1507`, handler `:906-925`, entry `App.tsx:3678` | Unchanged; button area also shows resolved engine + override | SMALL-FIX | Add engine chip + override control beside the button | `DropZonePanel.tsx` | — | 2 | `sync panel shows the engine that will actually run` — none today |
| B2 | Script/scene text read | `App.tsx:3712-3718`, RTF strip | Plus normalized-script hash for the spine | SMALL-FIX | Compute `normalizedScriptHash` here (whitespace/line-ending collapse) and carry it into the spine key | `App.tsx`, new `scriptNormalize.ts` | Over-normalizing (e.g. stripping punctuation) would make a real script change look free — normalize whitespace only | 2 | `whitespace-only script edit does not invalidate the spine; a word change does` — none today |
| B3 | Media persist | `App.tsx:3720-3780` (voiceover `:3730-3762`, assets `:3763-3769`, zips `:3770-3780`) | Unchanged | CONFORMS | — | — | — | — | Covered by existing asset tests |
| B4 | No-voiceover abort | `App.tsx:3785-3791`, `logSyncAbort` | Unchanged | CONFORMS | — | — | — | — | — |
| B5 | Audio duration resolve | `App.tsx:3793-3822`; no fake-duration fallback; abort logs cause `:3818` | Unchanged | CONFORMS | — | — | — | — | — |
| B6 | `parseProjectData` | `App.tsx:3826` | Unchanged | CONFORMS | — | — | — | — | — |
| B7 | Empty scene-doc abort | `App.tsx:3835-3842` | Unchanged | CONFORMS | — | — | — | — | — |
| B8 | Cached-tokens gate | `App.tsx:3849-3853` (decl), `:3918` (branch) | Keyed on content hash (A5) | RESTRUCTURE | Follows A5 | `App.tsx` | — | 2 | Shared with A5 |
| B9 | Empty transcript abort | `App.tsx:3859-3868` | Unchanged | CONFORMS | — | — | — | — | — |
| B10 | Anchor-based timing | `App.tsx:3919` `applyAnchorBasedTiming` (`syncEngine.ts:225`) | Unchanged | CONFORMS | — | — | — | — | — |

### C. Forced-alignment stage

| # | Step | Today (file:line) | Final target | Gap | Permanent solution | Files | Main risk | Wave | Proving test |
|---|---|---|---|---|---|---|---|---|---|
| C1 | FA capability gate | `isFaGateOpenForProject` `App.tsx:3941` = `isFaCapable()` (`faGate.ts:101-104`) ∧ `isFaEnabledForProject` (`:122-127`), default `FA_PROJECT_DEFAULT_ON = false` (`faGate.ts:91`) | **Gate deleted.** FA always runs as part of the selected engine | RETIRE | Remove the per-project gate and its default constant; FA becomes unconditional within the engine job | `faGate.ts`, `App.tsx`, `appDefaults.ts:67` | Deleting the gate without the pause-and-ask contract (C4) in place converts every FA failure into a hard stop | 2 (after 1) | `no code path can run a sync with FA disabled` — none today |
| C2 | FA toggle UI | **Two** toggles: `ProjectSettingsModal.tsx:240-257` (per project) and `NewProjectModal.tsx:199-206` (at creation) | **Both disappear** | RETIRE | Delete both controls and the `faHighPrecisionSync` write path (`App.tsx:7501-7502`); keep the stored field as ignored-legacy | `ProjectSettingsModal.tsx`, `NewProjectModal.tsx`, `App.tsx`, `faGate.ts` | Removing one and not the other leaves a dead toggle that still writes a field nothing reads | 2 | `no FA enable/disable control renders anywhere` — none today |
| C3 | FA preflight | `App.tsx:3949-3951` → `faPreflight.ts:78-179`; **observational only, never blocks** | Preflight becomes a real precondition for the local engine: not-ready → pause and ask before spending compute | RESTRUCTURE | Promote preflight from log entry to gate on the local path; on not-ready, pause with "switch to cloud / cancel" | `faPreflight.ts`, `App.tsx` | Over-strict preflight blocks runs that would have succeeded — keep the existing observational entry as the fallback signal | 2 | `a not-ready local preflight pauses instead of burning inference` — none today |
| C4 | FA run + fallback | `runForcedAlignmentForSync` `App.tsx:3960-3974` → `forcedAlignmentRun.ts:116-208`. Five substitution sites, all resolving to `{status:'fallback'}` and all committing Whisper timing while reporting success — see §M3.1 | **Zero silent fallbacks.** Chunk-level failure → auto-fill + visible flag. Run-level failure → pause and ask (retry once first on cloud) | RESTRUCTURE | Replace the fail-clean-to-Whisper contract with a fail-visible contract: typed outcome, run-level failure surfaces a modal, never a silent commit | `forcedAlignmentRun.ts`, `App.tsx`, `syncLog.ts` | This is the single highest-risk change in the plan — it converts a path that always succeeds into one that can stop. Needs the pause UI (C5) landed first | 1 | `no run-level FA failure reaches the atomic commit` — none today |
| C5 | Pause-and-ask UI | **DOES NOT EXIST.** `SyncLoadingOverlay.tsx:17-35` is `role="status"` with a spinner and no control of any kind | Modal: "switch to local / cancel" (or "switch to cloud" on the local path) | NEW-BUILD | New `SyncPausedDialog` driven by a paused state in the sync orchestrator | new component, `App.tsx` | A modal that appears mid-sync must not lose the work already done — pause must hold the run, not discard it | 1 | `a paused run resumes on the chosen engine without re-transcribing` — none today |
| C6 | CTC-infeasible chunk | `fa_onnx.rs:1570-1578` catches `AlignError::TooManyRepeats` and substitutes evenly-spaced placeholder words (`fallback_words_for_infeasible_chunk`, `:1440-1459`) at `score = f32::NEG_INFINITY` (`:1402`); run continues and returns **`status: ok`**. Every other error aborts the whole run (`:1580`) | Per-chunk **finding**, never `ok`-without-flag; auto-filled scenes visibly flagged | RESTRUCTURE | Carry a per-chunk infeasibility count out of Rust in the `Done` payload; emit one grouped sync-log finding; mark the owning scenes estimated in the UI. See §M3.2 | `fa_onnx.rs`, `fa.rs`, `fa_production.rs`, `faBoundaryTypes.ts`, `syncLog.ts`, `App.tsx` | The flag already exists per word (`needsReview`) and **has zero consumers** (§M3.2) — adding another unread field would repeat the defect | 1 | `a run containing an infeasible chunk cannot report a clean status` — none today |
| C7 | FA cancel | `fa_cancel` (`fa.rs:1176`) registered `lib.rs:607`, **zero frontend callers** (re-confirmed: every `src/` hit is a comment — `faBoundaryTypes.ts:85,91,111`; no `invoke('fa_cancel')` anywhere). Rust *does* poll: `fa_onnx.rs:1537-1538`, `:1554-1555`, flag `fa.rs:144`/`:166-168` | Cancellable everywhere | SMALL-FIX (wiring) | Wire `fa_cancel` to a real cancel control; granularity is one chunk, which is adequate | `App.tsx`, `forcedAlignmentRun.ts`, new cancel UI | Cancel must also unwind the staged audio and leave no partial commit | 1 | `fa_cancel has a production caller and a cancelled run commits nothing` — none today |
| C8 | Whole-run cancel | **DOES NOT EXIST.** No cancel control on the sync overlay; no `'Escape'` handler in `App.tsx` | Cancellable everywhere | NEW-BUILD | Cancel button on the sync overlay, wired to whisper cancel + `fa_cancel` + cloud abort | `SyncLoadingOverlay.tsx`, `App.tsx` | — | 1 | `a sync in any phase can be cancelled and leaves the project untouched` — none today |

### D. Matching and coverage

| # | Step | Today (file:line) | Final target | Gap | Permanent solution | Files | Main risk | Wave | Proving test |
|---|---|---|---|---|---|---|---|---|---|
| D1 | Hirschberg matcher | `alignQueryToSubject` `whisperService.ts:334` → `hirschbergGlobal:270`; row kernels `:194`, `:219`, `:243`. **Three O(n·m) passes per call** (`:359`, `:369`, `:376`). Synchronous, main thread | Bounded and cancellable | RESTRUCTURE | Move to a worker with a cooperative yield + abort signal; add an input-size guard that degrades to windowed alignment above a measured threshold. See §M3.6 | `whisperService.ts`, new worker | A worker boundary changes nothing about correctness but must preserve exact output — golden replay is the guard | 2 | `alignment of a 500-scene/30-min input completes under a bound and honours abort` — none today |
| D2 | **No bound of any kind** | Confirmed absent: no size cap, timeout, worker, or abort on any alignment path. `whisperService.ts:149` records that the earlier `maxStart` cap and overshoot guard **were removed**. Only dormant instrumentation exists (`:125` `__ALIGN_INSTRUMENT__`, logs only) | All sync compute bounded | RESTRUCTURE | Same as D1 | `whisperService.ts` | Freeze risk on large projects is real and unmeasured — this is the freeze in Walkthrough A | 2 | Shared with D1 |
| D3 | Per-segment alignment calls | `extractSegmentAlignments` loops `alignQueryToSubject` at `whisperService.ts:1203` (windowed), plus full-length calls at `:940` and `faChunkPlan.ts:157` | Unchanged shape, bounded | SMALL-FIX | Covered by D1's bound | `whisperService.ts` | — | 2 | Shared with D1 |
| D4 | Coverage gate | `evaluateCoverageGate` `App.tsx:1124`, called `:4039`. Two abort thresholds: `longestCoveredRun < MIN_COVERED_RUN_LENGTH` (`:1132`), `bidirectionalCoverage < NOISE_FLOOR_COVERAGE` (`:1138`) | Unchanged — this is already a pause-worthy honest abort | CONFORMS | Keep. Optionally re-present as pause-and-ask rather than abort | `App.tsx` | — | — | Existing coverage tests |
| D5 | `computeRunContext` duplication | Run **≥3× per sync with identical inputs**, each carrying a Hirschberg pass: via `computeFaChunkPlan` (`faChunkPlan.ts:904`, from `forcedAlignmentRun.ts:142`), via `computeUnscriptedRuns` (`faChunkPlan.ts:419`, from `forcedAlignmentRun.ts:197`), and via R.11's own `computeFaChunkPlan` (`faSeamFitGate.ts:190`) | Computed once, shared | SMALL-FIX | Memoize `computeRunContext` on its four inputs for the life of one sync run, or thread one context object through. See §M3.7 | `faChunkPlan.ts`, `forcedAlignmentRun.ts`, `faSeamFitGate.ts` | The three call sites must be proven to receive identical inputs before sharing — `forcedAlignmentRun.ts:194-196` already asserts this for two of them | 2 | `computeRunContext runs exactly once per sync run` — none today |

### E. Rule stage

| # | Rule | Today (file:line) | Log entry today | Final target | Gap | Permanent solution | Wave | Proving test |
|---|---|---|---|---|---|---|---|---|
| E1 | R.3 | **NOT FOUND as code.** Only `syncConstants.ts:126` recording that R3's char-rate constants "are gone" | n/a | Formally closed | RETIRE | Close the register row; no code owed | 1 | n/a — closure is a docs act |
| E2 | R.5 | Detector `faChunkPlan.ts:413` `computeUnscriptedRuns`; **excision applied at `faChunkPlan.ts:924`** (the `:422` citation in prior docs points at the detector wrapper, not the excision); staged `App.tsx:4014-4016`, spliced `:4505-4510` | **Yes** — `syncLog.ts:567` | Unchanged | CONFORMS | Close as done; correct the `:422` citation | 1 | Existing R.5 tests |
| E3 | R.7 | `CONF_MIN = 0.3` (`syncConstants.ts:536`, `fa.rs:416`, drift-guard `fa.rs:2156-2188`). **No production consumer.** Clause 1 built differently (C6), clause 2 built (`faAnchors.ts:319-333`, wired `faChunkPlan.ts:159`), clause 3 unbuilt | Partial | Ratify per V2 verdict | RESTRUCTURE | See §M3.11 — ratify clauses 1–2 as shipped-by-other-means, retire clause 3 or build it explicitly | 1 (ruling) / 2 (build) | `a boundary word below CONF_MIN is not used as a boundary` — none today |
| E4 | R.8 | **NOT FOUND as runtime code** — described as a fixture-tuning pass (`syncConstants.ts:35`, `whisperService.ts:148`) | n/a | Formally closed | RETIRE | Close the register row | 1 | n/a |
| E5 | R.9 | **NOT FOUND — explicitly deleted** (`App.tsx:1120`, removed with `MAX_INTERPOLABLE_GAP`) | n/a | Formally closed | RETIRE | Close the register row | 1 | n/a |
| E6 | R.10 | `faUnspokenGate.ts`, `App.tsx:4049-4083` | **Yes** — `syncLog.ts:609` | Unchanged | CONFORMS | — | — | Existing |
| E7 | R.11 | `faSeamFitGate.ts`, `App.tsx:~4304-4368` | **Yes** — `syncLog.ts:642` | Unchanged | CONFORMS | — | — | Existing |
| E8 | R.12 | `faRunPlacementGate.ts`, `App.tsx:~4371-4392` | **Yes** — `syncLog.ts:687` | Unchanged | CONFORMS | — | — | Existing |
| E9 | R.13 | `faRunPlacementGate.ts`, `App.tsx:~4399-4432` | **Yes** — `syncLog.ts:736` | Unchanged | CONFORMS | — | — | Existing |
| E10 | **R.14 / R.15** | `faAnchorTrustGate.ts:225` `detectAnchorTrustDefects` (R.14 `:256`, R.15 `:288`), invoked `App.tsx:4462`, **corrections applied `App.tsx:4471`**. **NO log entry — `console.warn` only (`App.tsx:4466-4469`)**. Independently confirmed twice: no `buildAnchorTrust*` builder exists in `syncLog.ts`'s seventeen builders; nothing is pushed to `ruleLogEntries` between `:4462` and `:4471` | **No** | Every correction visible | SMALL-FIX | Add `buildAnchorTrustLogEntries` on the exact pattern R.11/R.12/R.13 already use (built against `finalTimedSegments`). See §M3.3 | 1 | `every boundary R.14/R.15 moves produces a log entry` — none today |
| E11 | R-AP whole-stage check | `App.tsx:4489-4500`, `findRunEdgeViolations`; **`console.error` only**, explicitly detection-not-enforcement (`:4480-4488`) | **No** | Violations visible | SMALL-FIX | Emit a sync-log entry at `warning` severity alongside the console line | 1 | `an R-AP violation produces a log entry` — none today |

### F. Commit and post-commit

| # | Step | Today (file:line) | Final target | Gap | Permanent solution | Files | Main risk | Wave | Proving test |
|---|---|---|---|---|---|---|---|---|---|
| F1 | Skip / rescue / word-coverage entries | `filterToCoveredSegments` `App.tsx:4090-4094`; absorbed gaps `:4122`; rescue `:4139-4150`; `validateWordCoverage` `:4174-4175`; staged `:4192-4201` | Unchanged | CONFORMS | — | — | — | — | Existing |
| F2 | Boundary snap (50/50) | `snapCoveredBoundaries` `snapBoundaries.ts:665`, called `App.tsx:4235`; **50/50 rule present** at `snapBoundaries.ts:853-855` (silence centre, else spoken-edge midpoint); locked pairs excluded `:684-687`; fallback `retileCoveredSegments` `App.tsx:4236` | Unchanged | CONFORMS | — | — | Golden replay stops here by standing invariant — do not let any new rule move this line | — | Existing golden replay |
| F3 | Head extend | `headExtendFirstSegment` `App.tsx:4249` (`syncEngine.ts:422`) | Unchanged | CONFORMS | — | — | — | — | Existing |
| F4 | autoMatch / preserve | `App.tsx:4562-4565` (`autoMatchSegments` + `preserveEffectFields` `App.tsx:837`); locks `preserveSegmentLocks` `App.tsx:930`, called `:4572`; drops logged `:4577-4582` | Unchanged — this is what makes visual rebinding free | CONFORMS | Keep. This is the existing mechanism the "visuals never invalidate the spine" rule already relies on | — | — | — | Existing lock tests |
| F5 | Atomic commit | **`App.tsx:4635`**, single `setProject`; log folded atomically `:4639`; segments `:4648`; headings clamped `:4649`; `faWordTimings` `:4656`; `unappliedTranscript` cleared `:4671`. Wrapper `setProject` → `commitProject` (`App.tsx:1801-1812`) | Same, plus provenance written here | SMALL-FIX | Add the provenance object to this same object literal so it commits atomically with the timings it describes | `App.tsx`, `types.ts` | Writing provenance in a follow-up `setProject` would allow a window where timings exist unstamped | 1 | `every committed timing set carries provenance in the same commit` — none today |
| F6 | `faWordTimings` storage | `types.ts:534` `faWordTimings?: TranscriptToken[]`; written `App.tsx:3995`/`:4656`. **Write-only — zero readers anywhere in `src/`** outside the write path | Stamped and read | RESTRUCTURE | Either give it a reader (the per-word review UI the flags imply) or retire it. Do not add provenance to a field nothing reads — stamp at the `Project` level instead. See §M3.4 | `types.ts`, `App.tsx` | Retiring it loses the only per-word artefact; recommend keeping + stamping, reading in Wave 2's flag UI | 1 | `a stored FA timing set is reachable by the flag UI` — none today |
| F7 | Waveform build | `buildVoiceoverWaveform` `App.tsx:4690`; pipeline `App.tsx:2000`, persisted peaks `:1978`/`:2007` | Unchanged | CONFORMS | — | — | — | — | Existing |
| F8 | Boundary-quality checker | `validateBoundaryQuality` wired `App.tsx:4715`, input staged `:4242`; **post-hoc, read-only, gates nothing**, severity deliberately downgraded to `info` (`:4700-4712`); own follow-up `setProject` | Unchanged for now | CONFORMS | Keep as observability. Promotion to `warning` is the separately-planned Phase 2 | — | — | — | Existing |
| F9 | Sync log storage | `Project.syncLog?` `types.ts:514`, `syncRunSummaries?` `:517`; appended `appendSyncLogEntries`; caps `MAX_LOG_ENTRIES = 500` / `MAX_SYNC_RUN_SUMMARIES = 10` (`syncConstants.ts:137-138`); 17 entry kinds `types.ts:610-705` | Grouped six-section log with engine + credit stamp | RESTRUCTURE | Add `group` to the entry type and render sections; add engine/credit fields to the run summary | `types.ts`, `syncLog.ts`, `SyncLogPanel.tsx` | Existing entries have no group — renderer must default un-grouped entries to a catch-all section, never drop them | 2 | `every entry kind maps to exactly one of the six groups` — none today |
| F10 | Sync log render | `SyncLogPanel.tsx`, mounted `App.tsx:7312-7317`. **Flat reversed array** (`:263`); only two collapse mechanisms — whole-panel (`:246`,`:294`) and per-entry expansion of grouped-violation entries (`:252-258`,`:406-430`). **The six-group revamp does not exist** | Six collapsible groups | RESTRUCTURE | Follows F9 | `SyncLogPanel.tsx` | — | 2 | Shared with F9 |

### G. Settings, engine selection, credits

| # | Surface | Today (file:line) | Final target | Gap | Permanent solution | Files | Main risk | Wave | Proving test |
|---|---|---|---|---|---|---|---|---|---|
| G1 | App Settings sections | `AppSettingsModal.tsx` — Export Engine `:195`, Models & Add-ons `:224`, Storage `:233`, New Project Defaults `:240`, Diagnostics `:330`. **No Sync section** | New "Sync" section | NEW-BUILD | Add a Sync section between Export Engine and Models, holding: Default engine radio, Local subsection, Cloud subsection | `AppSettingsModal.tsx` | Engine default is app-level per Q1, while the existing FA setting was project-level — the two must not both exist | 2 | `Settings renders exactly one engine default control` — none today |
| G2 | Default-engine radio | **DOES NOT EXIST** — no cloud engine concept anywhere in `src/` (greps for `modal`, `gateway`, `cloudEngine`, `remoteEngine` return zero) | Cloud (default) / Local | NEW-BUILD | New app-setting `defaultSyncEngine: 'cloud' \| 'local'`, default `'cloud'` | `AppSettingsModal.tsx`, app settings store | Shipping the radio before the cloud path exists would offer a broken default | 2 (UI) / 3 (functional) | `default is cloud and survives restart` — none today |
| G3 | Per-run override | **DOES NOT EXIST** | One click in the sync panel, does not change the default | NEW-BUILD | Transient run-scoped override held in sync state, stamped onto the run's provenance | `DropZonePanel.tsx`, `App.tsx` | Override leaking into the persisted default is the obvious bug | 2 | `an override changes this run only` — none today |
| G4 | Local models list | `ModelsSection.tsx` (726 lines), rendered `AppSettingsModal.tsx:229`, `ManageModelsModal.tsx:72`, and filtered-to-one-language at `FaPackStatus.tsx:197-201`. Sizes via `formatBytes` with a `1_624_555_275` fallback (`:486`); integrity via sha256 `checkInstalledModels` (`:51,61,177,217`), "Unverified"/"Checking…" badges (`:478-484`, `:613-618`). **No enable/disable controls exist** | Display/manage only, sizes + integrity, no enable/disable | **CONFORMS** | Re-home the existing component under the new Sync → Local subsection. No new capability needed — the target is already what it does | `AppSettingsModal.tsx` | Re-homing must not break `ManageModelsModal`'s other entry points (`TranscriptionBar` download button, `SyncLogPanel`) | 2 | `models list renders under Sync → Local with no enable control` — none today |
| G5 | Credits balance | **DOES NOT EXIST.** Repo-wide search for credits/balance/billing in `src/` returns only two unrelated hits (`faChunkPlan.ts:1741` "never balanced", `gl/autoGrade.ts:70` "white-balance"). `saas-target-architecture.md:186-193` confirms none of the commercial layer exists | Balance + account status; zero → cloud unavailable + top-up | NEW-BUILD | Server-authoritative wallet; client displays a cached balance and never computes it. See §M4.6 | new `credits.ts`, `AppSettingsModal.tsx`, gateway | A client-side balance is trivially forgeable — deduction and balance must be server-side | 4 | `balance is read from the server, never derived client-side` — none today |
| G6 | Per-sync credit in log | **DOES NOT EXIST** | Credit use beside the engine stamp | NEW-BUILD | Add credit fields to the run summary; render in the log's run header | `types.ts`, `syncLog.ts`, `SyncLogPanel.tsx` | — | 4 | `a successful cloud run logs exactly one credit; a failed one logs none` — none today |
| G7 | FA pack status | `FaPackStatus.tsx`, six states `:122-193`, rendered only at `ProjectSettingsModal.tsx:270` | Folds into Sync → Local | RESTRUCTURE | Move under the new Local subsection; drop the "will fall back to" wording that describes the retired silent-fallback behaviour | `FaPackStatus.tsx`, `AppSettingsModal.tsx` | Its copy is a stale-claim site (§M3.10) | 2 | Covered by G4 |

### H. Storage, provenance, spine

| # | Item | Today (file:line) | Final target | Gap | Permanent solution | Files | Main risk | Wave | Proving test |
|---|---|---|---|---|---|---|---|---|---|
| H1 | Provenance on stored timings | **DOES NOT EXIST.** No engine/model/version field on `Project`, `TranscriptToken` (`types.ts:359-388`), `VideoSegment`, `SyncLogEntry`, `SyncRunSummary`. Only `anchorSource` (`types.ts:235`), whose own doc says it is "effectively write-only: no production code branches on this value post-3c" (`types.ts:234`) | 100% of new timing sets stamped; legacy labelled engine-unknown | NEW-BUILD | Schema + migration in §M3.4 | `types.ts`, `App.tsx`, `projectStore.ts` | Guessing an engine for a legacy project would be a fabricated provenance — must be `'unknown'`, never inferred | 1 | `a project loaded without provenance reports engine-unknown, never a guess` — none today |
| H2 | Project schema version | `StoredProjectData` `projectStore.ts:35-39` carries `version: 2 \| 3 \| 4`, stamped `:347` — but the marker "was never read/branched on" (`:336-346`). Load path `loadProjectDetailed:424`, ad-hoc back-compat only (`headings` default `:468`, legacy strip `:475-491`, `backfillSegmentIds:497`). `types.ts:528-529` states outright "no `version` concept exists on `Project` to migrate through" | A version marker that is actually read | SMALL-FIX | Bump to `5` and make the loader read it for the first time, at the existing `:468` hook | `projectStore.ts` | The field exists but is inert — the risk is assuming it already migrates | 1 | `a v4 project loads, gains engine-unknown provenance, and saves as v5` — none today |
| H3 | Timing spine | Spine today is the volatile `name\|size\|lastModified` (A5); no content hash of audio, no script hash (greps for `normalizeScript`/`scriptHash` return nothing). Rust `sha256.rs` exists and is already used for assets (`asset_store.rs:218`) | Content hash of (audio bytes + normalized script) | NEW-BUILD | Two-part spine: `audioHash` keys the transcript; `audioHash + normalizedScriptHash` keys the alignment. This maps exactly onto the cloud plan's two-job split (§M4.2) | `syncEngine.ts`, new `spine.ts`, Rust `sha256.rs` | Hashing cost on the main thread (A5) | 2 | `script-only edit reuses the transcript and re-runs alignment only` — none today |
| H4 | Scene-anchor binding | Visual rebinding already flows through `autoMatchSegments`/`preserveEffectFields`/`preserveSegmentLocks` (F4) keyed on `assetId` and segment `id` | Stable scene-anchor IDs; visuals can never invalidate the spine | SMALL-FIX | Assert the invariant with a test rather than building new machinery — the mechanism exists | `App.tsx` | — | 2 | `swapping every visual asset leaves the spine hash and all timings unchanged` — none today |

### I. Cloud engine

| # | Item | Today | Final target | Gap | Permanent solution | Wave | Proving test |
|---|---|---|---|---|---|---|---|
| I1 | Any cloud path in the app | **NONE.** Zero cloud/gateway/upload code in the sync lane | Cloud is the default engine | NEW-BUILD | §M4 | 3 | `a cloud sync produces stamped timings end to end` — none today |
| I2 | Audio upload encoding | **No Opus encoder in the app.** Only WAV/PCM transcode (`whisper.rs:756-757` `-ar 16000 -ac 1`, no codec flag); FA reuses it (`fa.rs:916`). Opus encoding exists only in the harness (`cloud/prepare_fixtures.sh:20`,`:35`) | 16 kHz mono Opus, 7,477,405 bytes/hour | NEW-BUILD | Add a `libopus` transcode path beside the existing WAV one | 3 | `one hour encodes to 7,477,405 bytes` — none today |
| I3 | Network permission | CSP `connect-src` (`tauri.conf.json:26`) allows only ipc + Pexels/Pixabay/Vimeo/Coverr — **a gateway origin would be rejected today** | Gateway reachable | SMALL-FIX | Add the gateway origin to `connect-src`; keep the allowlist closed | 3 | `the WebView can reach the gateway and nothing else new` — none today |
| I4 | Offline detection | **NONE.** `navigator.onLine` unused; no probe (`cloud-asr-plan.md:94`) | Cloud + no network → pause with "switch to local / cancel" | NEW-BUILD | Probe the gateway at run start, not `navigator.onLine` alone; reuse C5's pause dialog | 3 | `no network with cloud selected pauses and offers local` — none today |
| I5 | Video upload | Video never leaves the machine — nothing uploads today at all | Video never uploaded | CONFORMS (by absence) | Assert it: a test that the cloud client's payload contains audio only | 3 | `the cloud request body contains audio bytes and chunk text only` — none today |

### J. Dead code and retirement

| # | Item | Today | Final target | Gap | Permanent solution | Wave | Proving test |
|---|---|---|---|---|---|---|---|
| J1 | Dev FA harness | `fa_align_dev` (`fa_dev.rs:587-598`, 11 lines) registered unconditionally at `lib.rs:608` — **it ships in release**; `__faDevAlign` (`App.tsx:5205-5352`, ~148 lines) assigned `:5348`, deleted `:5350`, DEV-gated `:5206`, zero references | Retired | RETIRE | Delete via the audited delete helper; ~180 lines, not ~1600. See §M3.8 | 1 | `no dev-only alignment command is registered in a release build` — none today |
| J2 | `fa_dev.rs` wholesale | **NOT deletable** — holds production code: `fa_stage_audio_raw` (`:518-519`, invoked `forcedAlignmentRun.ts:163`), `resolve_wav_and_align` (`:611`, the entire body of `fa_align_production`), `verify_model_manifest` (`:284`) used by `models.rs` | Renamed, not deleted | SMALL-FIX | Rename the module to reflect that it is production (`fa_stage.rs` or similar) | 2 | Compile-time |
| J3 | `faTextNormalize.ts` | Exercised only by tests — the whole module is dead in production because of the 4-of-8-argument call (§M3.9) | Live, or honestly retired | RESTRUCTURE | Per Q2's binding lean: wire it. Requires a new data loader (§M3.9) | 2 | `normalization runs for all five languages in production` — none today |

---

## 4. M3 — Known items → permanent solutions

### M3.1 — D24: the five substitution sites → pause/ask

**Today.** `runForcedAlignmentForSync` never throws by contract
(`forcedAlignmentRun.ts:16-31`). Five paths return `{status:'fallback'}`:

| # | Site | Reason | Compute already spent |
|---|---|---|---|
| 1 | `forcedAlignmentRun.ts:123-128` | `unsupported-language` | None — first check |
| 2 | `:143-146` | `empty-chunk-plan` | Silence detection only |
| 3 | `:187-190` | `zero-words` | **The entire FA run** — full cost paid, then discarded |
| 4 | `:200-206` | `inference-error` (catch-all: staging failure, IPC rejection, model missing, hash mismatch, ORT failure, cancellation, OOM) | Proportional to chunks completed |
| 5 | `App.tsx:3960-3974` | gate closed → FA never attempted | None |

All five land at `App.tsx:3975` (`faTokens = null`), and the run proceeds to commit Whisper
timing at `App.tsx:4019-4026` → `:4635`. A `fa-fallback` log entry is written
(`App.tsx:3981-3983`, `syncLog.ts:425`) — visible only if the user opens the log panel. **The
sync reports success.**

**Permanent solution.** Split the five sites by class, because they are not one defect:

- **Sites 1 and 5 disappear entirely** under the final shape. There is no gate (C1), and
  language support becomes the engine's problem: cloud handles any language its model
  supports; local without a matching pack is a *precondition failure*, surfaced by the
  promoted preflight (C3) **before** any compute, as pause-and-ask.
- **Site 2 (`empty-chunk-plan`)** is a genuine internal inconsistency — a chunk plan cannot
  be empty for a script that parsed into segments. Promote to a run-level failure with a
  distinct reason code; pause and ask.
- **Site 3 (`zero-words`)** is the worst case in the contract: full compute, then discard.
  Promote to run-level failure, and add a cheap precondition (non-empty normalized target
  text) so the common cause is caught before inference rather than after.
- **Site 4 (`inference-error`)** is a catch-all over causes with different correct responses.
  Split it at the IPC boundary into typed kinds — the audit's STEP 4 list is the right
  taxonomy (`model-missing`, `model-hash-mismatch`, `runtime-load-failed`,
  `audio-stage-failed`, `inference-failed`, `cancelled`, `already-running`,
  `out-of-memory`). `cancelled` must never present as a failure; everything else pauses.

**Contract change.** `FaRunResult` gains a third arm:

```ts
type FaRunResult =
  | { status: 'ok'; tokens: TranscriptToken[]; unscriptedRuns: UnscriptedRun[];
      degraded?: FaDegradation; silenceError?: string }
  | { status: 'paused'; reason: FaFailureKind; detail?: string; resumable: true }
  | { status: 'cancelled' };
```

There is **no `fallback` arm** — the type makes silent Whisper substitution unrepresentable.
`status: 'paused'` drives the C5 dialog; the run holds (transcript and staged audio retained)
so "switch to local" resumes without re-transcribing.

**Risk.** This is the highest-risk change in the whole plan: it converts a path that always
succeeds into one that can stop. It must land *after* C5's pause dialog, never before.

**Files.** `forcedAlignmentRun.ts`, `App.tsx:3960-4026`, `syncLog.ts`, new `SyncPausedDialog`.
**Proving test.** `no run-level FA failure reaches the atomic commit` — and, structurally, a
type-level proof: removing the `fallback` arm makes the old behaviour a compile error.

### M3.2 — Placeholder fabrication → per-chunk finding, never `ok`

**Today.** `fa_onnx.rs:1570-1578` catches `AlignError::TooManyRepeats` and calls
`fallback_words_for_infeasible_chunk` (`:1440-1459`), which emits one evenly-spaced word per
representable word in the chunk's text, each scored `f32::NEG_INFINITY` (`:1402`). The run
continues and returns `status: ok`. The only signal outside the words themselves is an
`eprintln!`.

**The flag exists and nothing reads it.** The score converts to `needsReview: true` at the IPC
boundary (`fa.rs::word_span_to_dto`), survives into `FaWordSpan` (`faBoundaryTypes.ts:56`),
and is copied onto every token by `faWordSpansToTranscriptTokens` (`:133-142`) into
`TranscriptToken.needsReview` (`types.ts:387`). **A repo-wide search finds zero consumers of
`TranscriptToken.needsReview` in `src/`** — every `needsReview` hit in a component
(`ReviewMappingModal.tsx:173`, `Timeline.tsx:578`, `DropZonePanel.tsx:1691`) is
`HeadingOverlay.needsReview`, an unrelated field set when a re-sync clamps a heading
(`headingLayer.ts:22,31`). So the fabricated timings are flagged, stored, and invisible.

This is a stronger statement than the prior passes made: the defect is not only "no sync-log
entry" — it is that the per-word flag which was built to carry this signal has **no reader at
all**, so adding a second unread field would repeat the mistake.

**Permanent solution.**

1. **Rust:** count infeasible chunks and carry the count out in the `Done` payload
   (`FaEvent::Done` gains `infeasibleChunks: Vec<ChunkFinding>` with chunk index, window, and
   word count). The count already exists cloud-side as `nFallbackChunks`
   (`cloud/align.py` metrics) — mirror that field name so both engines report identically.
2. **TypeScript:** `FaRunResult.ok` carries `degraded?: FaDegradation`. A run with any
   infeasible chunk is `ok` **with** a degradation record — never clean.
3. **Log:** one grouped finding per run via the existing `buildGroupedViolationEntry`
   (`syncLog.ts:307`), naming the affected scenes.
4. **UI:** the affected scenes are marked *estimated* in the timeline — this is the "flagged
   estimated scenes" the final shape requires, and it is also the first real reader for
   `needsReview`.
5. **Never fabricate silently:** keep the evenly-spaced fill (a hole in an index-keyed array
   is worse), but it is now auto-fill **plus** a visible flag, which is exactly the target
   contract for chunk-level failure.

**Proving test.** `a run containing an infeasible chunk cannot report a clean status` — assert
that `status === 'ok' && degraded === undefined` is impossible when the Rust layer reported a
non-zero infeasible count. Rust-side tests already reproduce `TooManyRepeats` against real
corpus text (`fa_onnx.rs:5486-5541`) and unit-test the fill (`:5554`,`:5590`,`:5611`), so the
fixture exists; only the assertion is missing.

### M3.3 — R.14 / R.15 log entries

**Today.** `detectAnchorTrustDefects` (`faAnchorTrustGate.ts:225`; R.14 `:256`, R.15 `:288`)
runs at `App.tsx:4462` and its corrections are **applied to the committed array** at
`App.tsx:4471`. The only output is `console.warn` (`:4466-4469`). Confirmed two ways: there is
no `buildAnchorTrust*` among `syncLog.ts`'s seventeen builders, and nothing is pushed to
`ruleLogEntries` between `:4462` and `:4471`. R.11, R.12 and R.13 — the three rules
immediately above it — all emit entries.

**Permanent solution.** Add `buildAnchorTrustLogEntries(syncRunId, findings, finalTimedSegments, syncRunAt)`
to `syncLog.ts` on the exact pattern of `buildSeamFitLogEntries` (`:642`), resolving the
owning scene against `finalTimedSegments` (the `committedIndexOf` convention the neighbouring
rules already use), with `owningRule: 'R.14'` / `'R.15'` so the two are distinguishable in the
log. Push into `ruleLogEntries` immediately after `:4471`.

**Same fix, same commit: R-AP.** `findRunEdgeViolations` (`App.tsx:4489-4500`) is also
`console.error`-only, by an explicit and still-correct decision that it is detection rather
than enforcement (`:4480-4488`). Detection that only reaches the DEV console is not detection
under "every failure visible" — emit a `warning`-severity entry without changing it to throw.

**Proving test.** `every boundary R.14/R.15 moves produces exactly one log entry naming the
scene`. **Files.** `syncLog.ts`, `App.tsx`, `types.ts` (entry kind).

### M3.4 — Provenance stamp: schema, location, migration

**Today.** No engine/model/version provenance exists anywhere (H1). `anchorSource`
(`types.ts:235`) is three-valued, per-segment, demote-only within a run, and its own doc
records it is write-only post-3c (`types.ts:234`). `faWordTimings` (`types.ts:534`) is
likewise write-only. The `Project` type has no version concept (`types.ts:528-529`), though
the *stored envelope* does carry an inert one (H2).

**Proposed schema** — new in `types.ts`, beside `TranscriptToken`:

```ts
/** Provenance for one committed timing set. Additive-optional.
 *  Absent on any project written before this field existed — read as
 *  engine 'unknown', NEVER inferred from the data. */
export interface TimingProvenance {
  engine: 'cloud' | 'local' | 'unknown';
  model: string;          // 'ggml-large-v3-turbo' | 'faster-whisper-large-v3-turbo' | 'fa-<lang>'
  modelRevision: string;  // MODEL_SHA256, or the HF revision pin (FA_REVISION)
  engineVersion: string;  // app version + runtime, e.g. 'kinetix 0.x / ort 1.23.2'
  language: string;
  completedAt: number;
  /** Present only when the run completed in a degraded state. */
  degraded?: {
    kind: 'fa-chunk-infeasible' | 'silence-detect-failed';
    chunkCount?: number;
    sceneIds?: string[];
  };
}
```

**Where stored.** On `Project`, one record per stage, because the two stages can come from
different engines and different runs (a cached transcript re-aligned after a script edit):

```ts
timingProvenance?: {
  transcription?: TimingProvenance;
  alignment?: TimingProvenance;
};
```

**Why not on the tokens.** Per-token stamping multiplies the record thousands of times for a
value that is constant per run, and `TranscriptToken` is the hot array. Per-`Project` is the
right granularity; `anchorSource` stays as the per-segment demote-only signal it already is.

**Where written.** Inside the single atomic commit at `App.tsx:4635`, in the same object
literal as `faWordTimings` (`:4656`) — never in a follow-up `setProject`, which would allow a
window in which timings exist unstamped.

**Migration story.** The envelope already carries `version: 2|3|4` (`projectStore.ts:35-39`,
stamped `:347`) but it "was never read/branched on" (`:336-346`). Bump to `5` and make
`loadProjectDetailed` (`:424`) read it for the first time, at the existing back-compat hook
(`:468`, where `headings` is already defaulted):

- Stored version < 5 **and** `transcriptTokens` present → write
  `timingProvenance.transcription = { engine: 'unknown', model: 'unknown', … }`.
- `faWordTimings` present → same for `alignment`.
- **Never guess.** A legacy project cannot be back-derived to cloud or local, and the FA
  toggle's stored value is not evidence of what actually ran (D24 means a toggle-on project
  may hold Whisper timings). `'unknown'` is the only honest label.
- The UI must render `unknown` as "Engine not recorded (synced before engine tracking)", not
  as an error and not as a guess.

**Proving tests.** `a v4 project loads, gains engine-unknown provenance, and saves as v5`;
`no code path can write provenance with an inferred engine`; `every committed timing set
carries provenance in the same commit`.

### M3.5 — `fa_cancel` wiring, and the missing whole-run cancel

**Today.** `fa_cancel` (`fa.rs:1176`) is registered (`lib.rs:607`), typed, documented, and
**never invoked** — every `fa_cancel` hit in `src/` is prose (`faBoundaryTypes.ts:85`,`:91`,
`:111`); there is no `invoke('fa_cancel')` anywhere in the repo. The Rust side *does* poll
cancellation: before the loop (`fa_onnx.rs:1537-1538`) and before every chunk (`:1554-1555`),
via the closure at `fa.rs:1091`, flag flipped by `cancel_run` (`fa.rs:144`, read `:166-168`),
mapping to `FaError::cancelled` (`fa.rs:478`). Granularity is one chunk — adequate.

**And there is no cancel at all for the sync run.** `SyncLoadingOverlay.tsx:17-35` is 36 lines
with `role="status"`, a spinner and the words "Preparing your project…" — no button, no key
handler; `App.tsx` has zero `'Escape'` handlers. Contrast: transcription *is* cancellable
(A4). So the longest phase of the pipeline is the one that cannot be stopped.

**Permanent solution.** One cancel control on the sync overlay, wired to a single
`cancelSync()` that fans out to whatever is in flight: `whisper_cancel` (staging phase),
`fa_cancel` (alignment phase), cloud abort (Wave 3). On cancel, return
`{status:'cancelled'}` (M3.1) — the run commits nothing and the project is untouched, which
is already guaranteed structurally because every abort path returns before `App.tsx:4635`.

**Proving tests.** `fa_cancel has a production caller`; `a sync cancelled in any phase leaves
the project byte-identical`; `a cancelled cloud job deducts zero credits`.

### M3.6 — Hirschberg: bound, timeout, worker

**Today.** `alignQueryToSubject` (`whisperService.ts:334`) runs `hirschbergGlobal` (`:270`)
with O(n+m) memory but **three** O(n·m) passes per call (`:359`, `:369`, `:376`).
`whisperService.ts:149` records that the earlier `maxStart` cap and overshoot guard were
**removed**. There is no size guard, no timeout, no `AbortSignal`, no worker, and no yield on
any alignment path — the only size-related machinery is dormant instrumentation that logs
(`:125`, `:380-386`). It is called per-segment at `:1203` (windowed, so bounded by the window)
and full-length at `:940` and `faChunkPlan.ts:157`. Combined with §M3.7, a single sync runs
this at least three times over.

**Consequence.** For the 500-scene / 30-minute journey in §M8 — roughly 5,000 script words
against a comparable transcript — this is on the order of 25 M cell updates × 3 passes × ≥3
contexts, synchronous, on the main thread, uninterruptible. **This is the freeze risk, and it
remains unmeasured** (unchanged finding across all three passes).

**Permanent solution, in order of value:**

1. **Deduplicate first (§M3.7).** Cutting ≥3 contexts to 1 is a 3× win for one memoization
   and no algorithmic risk. Do this before anything else.
2. **Move to a worker** with a cooperative yield so the UI stays live, and an `AbortSignal`
   so C8's cancel reaches it. Output must be byte-identical — golden replay
   (`scripts/phase4-handoff-replay-sync.test.ts`) is the guard, and it must pass unchanged.
3. **Bound by measurement, not by guess.** Add the missing measurement first: run the dormant
   `__ALIGN_INSTRUMENT__` path against a synthetic 500-scene/30-minute project and record
   real numbers. Only then choose a threshold above which the matcher degrades to windowed
   alignment. **Do not ship a cap picked without that measurement** — the last cap was removed
   for a reason, and re-adding an arbitrary one risks reintroducing whatever it broke.

**Proving tests.** `alignment of a 500-scene/30-min input completes within the bound`;
`an aborted alignment stops within one yield`; golden replay unchanged.

### M3.7 — `computeUnscriptedRuns` 4×→1×: **the item as written is not supported**

**Verified.** `computeUnscriptedRuns` (`faChunkPlan.ts:413`) has five non-test references:
production at `forcedAlignmentRun.ts:197`, and three inside `computeFaChunkPlanS2Excised`
(`:1374`), `computeFaChunkPlanPeriodStrict` (`:1782`) and `computeFaChunkPlanS2EdgeArm`
(`:2378`). **None of those three variants has any production caller** — confirmed by grep, and
`faChunkPlan.ts:1351` says so itself. So the "computed 4×" reading counts three dead
experimental arms. **Disposition: mis-stated.**

**The real defect is adjacent and larger.** The expensive pass is `computeRunContext`
(`faChunkPlan.ts:114`), which carries a full Hirschberg alignment (`faChunkPlan.ts:157`). It
runs **at least three times per sync against identical inputs**:

| # | Path | Site |
|---|---|---|
| 1 | `computeFaChunkPlan` → `computeRunContext` | `faChunkPlan.ts:904`, from `forcedAlignmentRun.ts:142` |
| 2 | `computeUnscriptedRuns` → `computeRunContext` | `faChunkPlan.ts:419`, from `forcedAlignmentRun.ts:197` |
| 3 | R.11's own `computeFaChunkPlan` | `faSeamFitGate.ts:190` |

Inputs for 1 and 2 are provably identical — `forcedAlignmentRun.ts:194-196` asserts it in
prose, and it is true: both receive `anchorTimedSegments, whisperTokens, silences,
audioDuration`. The comment is correct about *provenance* while confirming the
*duplication*.

**Permanent solution.** Compute one `RunContext` per sync run and thread it through: build it
once in `runForcedAlignmentForSync`, pass it into `computeFaChunkPlan`, return it on the
result, and hand it to R.11 instead of letting `faSeamFitGate.ts:190` rebuild its own. A
memoization keyed on the four inputs is the smaller change; threading is the cleaner one.
Either way the R.5 provenance guarantee is *strengthened*, not weakened — one context means
the plan and the logged excisions cannot diverge even in principle.

**Proving test.** `computeRunContext executes exactly once per sync run` (spy/counter).

### M3.8 — S2 strip: **~1600 lines is materially overstated**

**Verified.** `fa_dev.rs` is 1,475 lines and the `App.tsx` harness block (`:5205-5352`) is
~148, totalling ~1,623 — that is where the figure comes from. But **`fa_dev.rs` is misnamed
and holds production code**:

| Symbol | Site | Production use |
|---|---|---|
| `fa_stage_audio_raw` | `fa_dev.rs:518-519` | Invoked by production at `forcedAlignmentRun.ts:163` |
| `resolve_wav_and_align` | `fa_dev.rs:611` | The **entire body** of `fa_align_production` (`fa_production.rs:34-43`) |
| `verify_model_manifest` / `manifest_byte_size_for` | `fa_dev.rs:284` / `:52` | Used by `models.rs`'s FA download/import path |

Roughly 785 of its lines are `#[cfg(test)]` blocks (`:691-1475`), already excluded from
release builds — deleting them buys source lines and no binary.

**Genuinely dead, and defensibly strippable — ~180 lines:**

- `fa_align_dev` (`fa_dev.rs:587-598`, 11 lines) + its registration at `lib.rs:608`.
  **Note it is registered unconditionally and therefore ships in release** — `fa_dev.rs` is
  *not* feature-gated (`lib.rs:11` is a plain `pub mod fa_dev;`), unlike `fa_onnx`
  (`lib.rs:17`, `#[cfg(feature = "fa-inference")]`). Removing the registration is a small
  real attack-surface reduction, not just tidying.
- The `__faDevAlign` harness (`App.tsx:5205-5352`, ~148 lines plus its comment header),
  assigned `:5348`, deleted `:5350`, `import.meta.env.DEV`-gated `:5206`, referenced from no
  render path or handler.

**One blocker:** `src-tauri/tests/fa_durable_wav_live.rs` calls `fa_align_dev` directly
(`:45`, `:138`) and must be repointed at `resolve_wav_and_align` or removed in the same
change.

**Disposition.** Re-scope the item from "strip ~1600 lines" to "retire the dev alignment
command and harness (~180 lines) and rename `fa_dev.rs` to reflect that it is production."
Deletion via the audited delete helper only; frozen-asset check after. **Nothing deleted this
pass.**

### M3.9 — Local FA language plumbing (Q2's binding lean)

**Verified exactly as described, and then some.** `forcedAlignmentRun.ts:142` calls
`computeFaChunkPlan` with **four** arguments; the signature takes eight
(`faChunkPlan.ts:503-512`), of which `languageCode` (`:509`), `vocabChars` (`:510`) and
`cardinalData` (`:511`) are optional and therefore `undefined`. The guard at
`faChunkPlan.ts:930-932` requires all three, so `applyFaTextNormalization` (`:942-951`) —
and with it the whole of `faTextNormalize.ts` — never executes in production. The same guard
shape repeats at `:1214`, `:1490`, `:2005`, `:2654`, none of which has a production caller
either.

The irony: `language` is **already in scope twelve lines above the call**, narrowed at
`forcedAlignmentRun.ts:130`. Passing it is one line.

**But the lean under-estimates the work, and this is the finding that matters.** `vocabChars`
and `cardinalData` have **no runtime loader anywhere**. The data is committed as test fixtures
(`scripts/fixtures/fa-vocab-<lang>.json`, `scripts/fixtures/fa-cardinal-<lang>.json`) and is
read today **only by tests** (`faTextNormalize.fixtureDrift.test.ts:66`).
`faTextNormalize.ts` deliberately does no I/O. So wiring this requires:

1. `forcedAlignmentRun.ts:142` — pass `language` (arg 6) and the attribution mode (arg 5). *One line.*
2. **A production data path for five vocab files + five cardinal files** — either bundled as
   app resources and imported, or shipped beside the model packs and read over IPC. This does
   not exist and is the bulk of the work. It also has a packaging consequence: these files
   must ship in the installer.
3. A loader with its own failure mode — and under "zero silent fallbacks", a missing vocab
   file must pause or degrade *visibly*, not quietly skip normalization the way it does today.

**Also note `docs/STATUS.md:32`** already carries this as an open item ("Produce
`fa-vocab-<lang>.json` files; wire `project.language`/`vocabChars` into both
`computeFaChunkPlan` call sites") — the files now exist as fixtures, so that line is partly
stale; what remains is the runtime loader and the wiring.

**Unresolved detail, flagged rather than guessed:** whether `vocabCharsFromRawVocab` is
exported from `faTextNormalize.ts` under that exact name for production use was not confirmed
this pass — verify before sizing the loader.

**Proving tests.** `normalization runs in production for all five languages`; `a missing vocab
file pauses instead of silently skipping normalization`.

### M3.10 — Stale-claim correction list (consolidated, including new finds)

Carried forward from `fa-wiring-audit.md` STEP 5 (lines 172-191, re-confirmed unchanged on
`main`) and the gap pass's §V6. **New this pass, found by direct read:**

| # | Claim | Site | Status |
|---|---|---|---|
| N1 | "SCHEMA ONLY THIS SLICE — no production writer populates this field yet" | `types.ts:527-533` | **STALE.** `faWordTimings` is written by production at `App.tsx:3995`/`:4656`. The same comment's "no `version` concept exists on `Project`" is still true and is load-bearing for M3.4 |
| N2 | "…and that reshape has no live caller yet" (of `faWordSpansToTranscriptTokens`) | `types.ts:367` | **STALE.** Called in production at `forcedAlignmentRun.ts:193` |
| N3 | "no production code branches on this value post-3c" (`anchorSource`) | `types.ts:234` | **Still accurate** — verified, do not "correct" it. It is the reason `anchorSource` cannot serve as the provenance stamp |
| N4 | Apply Sync described as a numbered 16-step flow | prior reports / narrative docs | **Imprecise.** The source carries six numbered comments with 4 and 6 missing (§M1). The stages exist; the numbering does not |

**Carried forward, re-confirmed present and uncorrected:**

| # | Claim | Site | Status |
|---|---|---|---|
| C1 | "NOT wired into Apply Sync or any live path (Slice D1) — this module has no caller yet" | `faAnchors.ts:14-15` | **STALE** — `computeFaAnchors` is called from `faChunkPlan.ts:159` |
| C2 | "NOT wired into Apply Sync — no caller yet" | `faTextNormalize.ts:17` | **Still accurate** (§M3.9). Do not pattern-match it to C1 |
| C3 | "R.5 … deferred" ×3 | `sync-pipeline-v2-plan.md`, `docs/archive/history/work-in-progress.md:132`, `stage1-live-run-prep.md:199` | **STALE** — R.5 ships via excision at `faChunkPlan.ts:924` |
| C4 | "ALIGNER COMPLETE, dev-only … zero production callers" | `sync-pipeline-v2-plan.md:33` | **STALE** vs `App.tsx:3960+` |
| C5 | "fa-inference is off in every shipped build" family (8 sites) | `fa-wiring-audit.md:176-191` | **STALE** vs CI (`build.yml:424`); accurate only for non-`-f` local packaging |
| C6 | "will fall back to" FA-unavailable copy | `FaPackStatus.tsx:145`, `syncLog.ts:435` | **Becomes stale on Wave 1 delivery** — silent fallback is being removed; this copy must change with it |

**Additional correction owed by the R.5 citation:** prior docs cite `faChunkPlan.ts:422` for
R.5's excision. `:413`/`:419` is the detector wrapper; the excision is at **`:924`**.

### M3.11 — R.7 closure per the V2 verdict

The gap pass's verdict — **PARTIAL, built differently than specified** — is re-confirmed
unchanged. Disposition per clause:

- **Clause 1 (fit precheck).** Shipped by a different mechanism: placeholder fill rather than
  skip-and-flag (§M3.2). **Ratify the mechanism, fix the honesty.** No wildcard token exists
  in the Viterbi implementation and none should be invented; auto-fill + visible flag is the
  operator's own stated target for chunk-level failure, so the shipped mechanism is right and
  only its reporting is wrong.
- **Clause 2 (force-split).** Built and live (`faAnchors.ts:319-333`, wired
  `faChunkPlan.ts:159`); provenance tag survives on the `FaRun` object. Missing: the
  "LOW-CONFIDENCE, emit a finding" half. **Close the build; fold the finding into the same
  log work as M3.3.**
- **Clause 3 (boundary-word confidence gate).** No confirmed implementation; `CONF_MIN` has
  no production consumer. **Operator decision required:** build it, or retire the clause. The
  recommendation is to retire it — under the final shape, per-word confidence surfaces as the
  estimated-scene flag (§M3.2), which serves the user-facing purpose the clause was written
  for, and a second confidence mechanism that only moves boundaries would be a new source of
  invisible timeline changes of exactly the kind this workstream keeps closing.
- **`docs/STATUS.md:31`** ("Ratify R.7 confidence-flag handling; build skip-and-flag and
  force-split failure paths") is itself stale in its verb: two of three are built.

### M3.12 — Frozen byte constants and fixture digests (prior OPEN item)

The gap pass found no canonical list. This pass proposes one that lands on exactly the stated
counts. **Proposed for confirmation, not asserted.**

**Eight frozen byte constants:**

| # | Value | Source |
|---|---|---|
| 1 | 1,624,555,275 | `MODEL_SIZE_BYTES`, `model_download.rs:140`; also `whisper.rs:586`, `ModelsSection.tsx:486` |
| 2 | 6,312,776,755 | Five FA packs total, `cloud-asr-plan.md:96` |
| 3 | 7,937,332,030 | Whisper + all five packs, `cloud-asr-plan.md:96` |
| 4 | 32,851,696 | V6 source `6.m4a`, `cloud-asr-measurements.md:54` |
| 5 | 45,481,468 | `v6_16k.wav`, `:63` |
| 6 | 2,952,316 | `v6_16k_cbr16k.opus`, `:64` |
| 7 | 115,200,078 | `hour_16k.wav`, `:65` |
| 8 | 7,477,405 | `hour_16k_cbr16k.opus`, `:66` |

**Four fixtures** — the four files in that same table (rows 5-8 above). **Important caveat:
these are pinned by byte size, not by digest.** No SHA-256 is recorded for any of the four in
`cloud-asr-measurements.md` or `cloud/README.md`. If "four fixture digests" means literal
digests, they do not exist and recording them is a small hardening item; if it means the four
pinned fixture sizes, they are exactly the rows above.

**Immutability verified regardless of which reading is correct:**
`git diff --stat eb1c4fa main -- src-tauri/src/model_download.rs docs/architecture/cloud-asr-measurements.md cloud/`
→ **empty**. Nothing in this set moved, and this pass changed none of it.

### M3.13 — STATUS.md closure proposals (proposals only — nothing written)

STATUS.md is at 40/40 `[OPEN`. **This report adds zero items.** Proposed closures, which
would create headroom:

| Line | Item | Proposed disposition |
|---|---|---|
| `:32` | "Ratify R.7 …; build skip-and-flag and force-split failure paths" | **Rewrite, not close** — two of three clauses built (§M3.11); the live question is ratification |
| `:32` | "Produce `fa-vocab-<lang>.json`; wire language/vocabChars" | **Partly close** — fixtures exist; what remains is the runtime loader (§M3.9) |
| `:35` | "Wire `FaEvent` to a UI progress consumer (none exists)" | Keep open — still true, and Wave 1's cancel UI is the natural home |
| `:134` | "`fa_cancel` has zero frontend callers" | Keep open until Wave 1 lands (§M3.5) |
| `:30` | "Flip `FA_PROJECT_DEFAULT_ON` once three preconditions met" | **Close as obsolete** — the gate is being deleted entirely (C1), so the flip will never happen |
| `:25` (In Progress) | "FA default toggle still OFF at read time (NR-2 pending)" | **Obsolete** for the same reason — NR-2 is superseded by the no-toggle final shape |
| `:120` | D24 | Keep open; **re-flagged as mis-filed under WS3** for the third time |
| — | R.3 / R.8 / R.9 | **Formal closure** — not present as code (§E1/E4/E5); R.9 explicitly deleted |
| — | R.5 | **Formal closure** — ships via excision at `faChunkPlan.ts:924` |

**NR-2 is superseded.** It rules that the FA toggle default becomes ON with a migration. Under
Q1 there is no toggle at all. NR-2 should be marked superseded by the final shape rather than
implemented — flagged here, not edited.

---

## 5. M4 — Cloud lane

Read-only review of `ws-cloud-asr-plan` (`eb1c4fa`), `docs/architecture/cloud-asr-plan.md`,
`docs/architecture/cloud-asr-measurements.md`, and `cloud/`.

### M4.1 — What exists

**Category (a), ships in the app: nothing.** There is no cloud path in the sync lane at all.
The only network code in the product is `fetch_url_bytes` (`lib.rs:63-86`, stock-footage
download, sole caller `App.tsx:7590`) and the model downloader (`model_download.rs`,
`models.rs:86`) — weights *down*, never audio *up*. CSP `connect-src`
(`tauri.conf.json:26`) allows ipc plus four stock-media origins and would reject a gateway.

**Category (b), standalone harness — real, measured, reusable:** `cloud/` (16 files).
`cloud/app.py` (309 lines) is the Modal transcription app —
`faster-whisper-large-v3-turbo` in a volume, three classes (`TranscriberT4:175`,
`TranscriberT4Snapshot:225` with GPU memory snapshot, `TranscriberL4:273`), entry
`transcribe(audio_bytes, language, offset_sec, suffix)` (`:194-199`), returns tokens +
metrics. `cloud/align.py` (363) is the FA app — pinned `FA_REVISION`
`f618960d71728eba5f12528d5571838a10d262bf` (`:19-20`), `AlignerT4:293` / `AlignerCPU:333`,
entry `align(audio_bytes, chunks, language, suffix)` (`:212-218`), returns words + metrics
including **`nFallbackChunks`**. `cloud/fa_engine.py` (625) is a faithful Python port of
`fa_viterbi.rs`/`fa_onnx.rs`/`faTextNormalize.ts`. `cloud/measure.py` (525) is the runner.
A **license gate is code, not policy**: `assert_fa_license()` (`align.py:85`) raises unless
the HF card tag matches; re-verified `apache-2.0` (`cloud-asr-measurements.md:282`).

**Category (c), doc-only:** the entire gateway, auth, quota, metering, upload and offline
design (`cloud-asr-plan.md:104-134`). The file says so itself at `:3` — "This is a plan, not
a description of current behaviour. Nothing below is implemented."
`saas-target-architecture.md` contains **no** mention of cloud ASR, credits, or engine
selection; its commercial layer is explicitly phase four and explicitly nonexistent
(`:186-193`).

### M4.2 — Job shape: one job vs two (architect decision)

**Conflict.** The final shape says one engine job. The plan specifies "two independently
invocable Modal functions, not one co-located call" (`cloud-asr-plan.md:53`), with the
combined call named as "a later optimisation, not the primary path" (`:110`), and notes this
means two cold starts (`:140`).

**Recommendation: one job on the wire, two stages behind it, keyed separately.** Both are
right about different things, and the spine (§H3) resolves it:

- The user-facing contract is one job — one progress bar, one credit, one result. That is the
  final shape and it should be honoured.
- Server-side, transcription and alignment remain separately cacheable, because the spine has
  two keys: `audioHash` → transcript, `audioHash + normalizedScriptHash` → alignment. A
  script-only edit must re-run alignment and **reuse** the transcript. The plan's server-side
  audio cache keyed on a content hash (`:114`) is exactly this and should be kept.
- This gives the operator's "whitespace-only script changes are free" and "real script change
  re-bills" behaviours for free, and avoids paying twice for transcription on a script edit.

**Do not adopt chunked fan-out.** Measured: n=4 is faster (52.3 s vs 118.5 s) but **damages
seams** — a 1.16 s hole at t=2700 with n=4, and with n=10 a duplicated word (`night.` at
t=1440) plus a 0.92 s gap, while being *slower* than n=1 (324.2 s vs 118.5 s)
(`cloud-asr-measurements.md:214-217`, `:236-253`). Fabricated or dropped words at a seam is
precisely the class of defect this whole workstream exists to remove.

### M4.3 — Timing and cost against the target

Target: ~90 s + cold start, ~$0.02/sync. Measured, warm T4:

| Stage | 23.7-min V6 | 1 hour | ~30 min (interpolated) |
|---|---|---|---|
| Transcription (processing) | 41.971 s | 110.513 s | ~53 s |
| Forced alignment (processing) | 25.819 s | 66.495 s | ~33 s |
| **Combined** | ~68 s | ~177 s | **~86 s** |

Cold start adds 7.5–30 s empty-container, 24–32 s with snapshots
(`cloud-asr-measurements.md:96-109`, `:454`). **The ~90 s target holds for a 30-minute
voiceover on a warm container, and becomes ~110-120 s on a cold one.**

Cost: transcription ~$0.024/audio hour (`:143-162`), FA ~$0.0107/audio hour (`:381-398`) →
~$0.035/hour → **~$0.0175 for a 30-minute voiceover**. The operator's ~$0.02/sync is
accurate. Against Q3's $0.10 credit, gross margin is roughly 5×, which is the operator's call
and deliberately decoupled.

### M4.4 — Upload path and privacy surface

**Exactly what leaves the machine, under the plan: the voiceover audio as 16 kHz mono Opus
CBR 16 kbps, plus the chunk-plan text (i.e. the script), plus a language code and an account
token. Nothing else. Video is never uploaded** — and today nothing is uploaded at all, so
this is a property to build and assert, not to preserve.

Sizes are frozen and exact: one hour = **7,477,405 bytes** Opus (vs 115,200,078 bytes WAV),
V6 23.7 min = 2,952,316 bytes (`cloud-asr-measurements.md:63-66`). **Upload time from a real
user's machine is explicitly unmeasured** (`:462-486`) — on a slow uplink 7.5 MB could
rival the 90 s of compute, so the progress UI must show upload separately from processing.

**Must build:** a `libopus` encode path. None exists — the app's only transcode is WAV
(`whisper.rs:756-757`, reused by FA at `fa.rs:916`); Opus encoding lives only in
`cloud/prepare_fixtures.sh:20,35`.

**Privacy note for the operator, stated plainly:** the script and the voiceover both leave the
machine on every cloud sync. That is a material change from today's local-only posture
(`saas-target-architecture.md:166-170` requires the core edit/export loop to stay
cloud-independent — sync is not that loop, so this is consistent, but it should be said in
the product's own words to users before the first cloud run).

### M4.5 — Parity: the finding that constrains the engine picker

Two separate parity results, and they point in opposite directions:

- **Forced alignment, English:** 3874/3874 words, identical text, mean |Δstart| **8.16 ms**,
  max **1.84 s**, 108 words > 50 ms → **not interchangeable** under the owner threshold
  (`:358-359`). Spanish: mean 0.88 ms, max 20 ms → **interchangeable**. Modal T4 vs Modal CPU:
  **bit-identical** (`:371`).
- **Transcription:** local 4,556 tokens vs cloud 3,960; only-local 726, only-cloud 130; mean
  |Δstart| **0.295 s**, max **8.35 s** → **not interchangeable** (`:176-198`).

**Consequence for the final shape.** Switching engines mid-project changes the timings. Under
"zero silent fallbacks", the per-run override (G3) must therefore be treated as a **re-sync
with a different engine**, stamped as such (H1), and not presented as a neutral toggle. The
pause-and-ask flow that offers "switch to local" is offering a *different result*, not the
same result by another route — the dialog copy must say so.

The 108-word English outlier cluster remains unexplained: per-chunk logits were not dumped, so
the correlation with CTC-infeasible chunks is **unassessable from stored data** (`:462-486`).
Wave 1's English re-run (Q4, separately authorized) should capture per-chunk feasibility
diagnostics so this can finally be computed — and `nFallbackChunks` already exists in the
cloud harness's metrics, so the field is half-built.

### M4.6 — Reusable vs must-build

| Reusable as-is | Must build |
|---|---|
| `cloud/app.py`, `cloud/align.py` — job bodies, model provisioning, metrics incl. `nFallbackChunks` | The gateway (auth, quota, metering, one-hour job cap) — doc-only today |
| `cloud/fa_engine.py` — verified Python port, bit-identical T4/CPU | Account/session token storage in the Rust shell |
| `assert_fa_license()` — a real, passing license gate | Opus encode path in the app |
| Frozen fixtures and their byte constants | Cloud client + upload + progress (upload distinct from processing) |
| `build_chunk_plan.ts` — imports the live `computeFaChunkPlan` read-only | Retry-once, pause-and-ask, offline probe |
| The measured cost/duration baseline | Credits wallet (server-authoritative), balance display, top-up, zero-balance behaviour |
| The seam-damage evidence (as a negative result: do not fan out) | Cloud provenance stamp (§M3.4), CSP origin (`tauri.conf.json:26`) |

**Planner drift to watch:** the frozen plan has 280 V6 chunks; the live TS planner now
produces **273** (`cloud-asr-measurements.md:344`). Cloud and local must build the chunk plan
from the same code path or their results are not comparable — `build_chunk_plan.ts` importing
the live planner is the right pattern and should be preserved.

---

## 6. M5 — Failure-mode matrix vs target

"Test that must exist" names the missing test; *none today* means none was found.

| # | Failure mode | Current behaviour | Target behaviour | Test that must exist |
|---|---|---|---|---|
| 1 | FA unsupported language | Silent Whisper substitution, sync reports success (`forcedAlignmentRun.ts:123-128`) | Precondition, caught by preflight before compute → **pause + ask** | `an unsupported language pauses before any compute` — none today |
| 2 | FA empty chunk plan | Silent substitution (`:143-146`) | **Pause + ask** (internal inconsistency) | `an empty chunk plan pauses` — none today |
| 3 | FA zero words | Silent substitution **after full compute** (`:187-190`) | **Pause + ask**, with a cheap pre-check to avoid paying first | `a zero-word result pauses and is pre-empted where possible` — none today |
| 4 | FA inference error (catch-all) | Silent substitution (`:200-206`) | Typed kinds; **pause + ask**, retry once first on cloud | `each typed failure kind pauses with its own message` — none today |
| 5 | FA gate closed | Runs on Whisper, logs `fa-gate-closed` | **Cannot occur** — gate deleted | `no code path can disable FA` — none today |
| 6 | CTC-infeasible chunk | Fabricated evenly-spaced words, `status: ok`, flag stored with **zero readers** (`fa_onnx.rs:1570-1578`) | **Auto-fill + visible flag**; never clean status | `a run with an infeasible chunk cannot report clean` — none today |
| 7 | Any other `AlignError` | Aborts the whole run (`fa_onnx.rs:1580`) | **Pause + ask** | `the catch-all abort branch is exercised` — **none today** (noted OPEN by the gap pass, still open) |
| 8 | Silence detection failure | Continues with zero silences; log entry on success only (`forcedAlignmentRun.ts:135-140`, `App.tsx:3988-3990`) | **Bounded degradation + flag** — acceptable, but must be flagged on the run, not only logged | `a zero-silence chunk plan marks the run degraded` — none today |
| 9 | Whisper failure | `useWhisper` sets `{phase:'error'}`; visible in `TranscriptionBar` | Unchanged; **conforms** | Existing |
| 10 | Whisper model missing | Error + **Download Model** button (`TranscriptionBar.tsx:86-93`) | Unchanged; **conforms** — this is already the pause-and-ask pattern done right | Existing |
| 11 | Corrupt/missing weights | sha256 verify exists (`checkInstalledModels`, `MODEL_SHA256`) | Unchanged | Not re-verified this pass — **carried forward OPEN** |
| 12 | Script/audio mismatch | Coverage gate aborts (`App.tsx:1124`,`:4039`) | **Pause + ask** (same information, better affordance) | Existing gate tests; pause variant — none today |
| 13 | Very long / 500-scene input | **Unbounded, main-thread, uninterruptible** (§M3.6) | Bounded + cancellable | `a 500-scene/30-min input completes within a bound` — none today |
| 14 | Concurrent sync | FA single-flight `fa_dev.rs:653`; Whisper single-flight (test at `whisper.rs:1956`) | Unchanged | Whisper's exists; FA's not re-verified |
| 15 | User cancel — transcription | **Works** (`TranscriptionBar.tsx:36-42` → `whisper_cancel`) | Unchanged | Existing |
| 16 | User cancel — alignment | **Impossible** — `fa_cancel` has zero callers | Cancellable | `fa_cancel has a production caller` — none today |
| 17 | User cancel — whole sync | **Impossible** — no control exists | Cancellable everywhere | `a sync cancels in any phase and commits nothing` — none today |
| 18 | Restart mid-sync | **Not investigated** in any pass | Defined behaviour | **OPEN — needs a dedicated read**; carried forward a second time |
| 19 | Cloud offline | n/a — no cloud | **Pause**: "Cloud unavailable — switch to local / cancel" | `no network with cloud selected pauses` — none today |
| 20 | Cloud job failure | n/a | **Retry once**, then pause + ask | `a cloud failure retries exactly once before pausing` — none today |
| 21 | Cloud cold start | n/a | Progress shows it; never a timeout failure | `a cold start does not present as an error` — none today |
| 22 | Credits exhausted | n/a | Cloud unavailable in picker; Local offered; top-up entry point | `zero balance removes cloud from the picker` — none today |
| 23 | Credit deducted on failure | n/a | **Never** — success only | `cancels, failures, retries and cache hits deduct zero` — none today |
| 24 | Legacy project, no provenance | n/a — no provenance exists | Labelled **engine-unknown**, never guessed | `a legacy project reports engine-unknown` — none today |
| 25 | R.14/R.15 move a boundary | **Silent** — `console.warn` only | Logged | `every anchor-trust correction logs` — none today |
| 26 | R-AP violation | `console.error` only | Logged at warning severity | `an R-AP violation logs` — none today |
| 27 | Media (visual) swap | Rebinds via `autoMatchSegments`; no re-sync | Unchanged — **conforms** | `swapping visuals leaves the spine and timings unchanged` — none today |
| 28 | Same audio re-staged, new mtime | **Full re-transcription** (`App.tsx:3520`) | **Cache hit, free** | `byte-identical audio with a new mtime is a cache hit` — none today |
| 29 | Whitespace-only script edit | Full re-match; on cloud would re-bill | **Free** via normalization | `whitespace-only edit does not invalidate the spine` — none today |

---

## 7. M6 — Enterprise-grade scorecard (the "before" picture)

Scored against the current tree. This is what the waves must drive to all-PASS.

| # | Criterion | Score | Evidence |
|---|---|---|---|
| 1 | **Zero silent fallbacks** (silent list must be empty) | **FAIL** | Silent list has **six** members: five FA substitution sites (§M3.1) that commit Whisper timing under a successful sync, plus the CTC-infeasible placeholder path that returns `status: ok` (§M3.2). Two further silent paths in the rule stage: R.14/R.15 corrections (`App.tsx:4466-4471`) and R-AP violations (`:4489-4500`), both console-only |
| 2 | **Zero fabricated timings** (test proves the placeholder path can't return `ok`) | **FAIL** | `fa_onnx.rs:1570-1578` fabricates evenly-spaced words and the run returns `ok`. Tests exist that the fabrication *happens* (`fa_onnx.rs:5554`,`:5590`,`:5611`); **no test asserts it cannot present as clean.** The `needsReview` flag that was built to carry the signal has **zero consumers** |
| 3 | **100% of new stored timing sets stamped; legacy labelled unknown** | **FAIL** | No provenance field exists anywhere (`types.ts` — H1). `anchorSource` is write-only by its own doc (`types.ts:234`). Stored envelope has a version marker that is never read (`projectStore.ts:336-346`) |
| 4 | **Every matrix cell has a proving test** | **FAIL** | Of 29 cells in §M5: **4 PASS** on existing tests (9, 10, 12-partial, 15), 2 carried-forward unverified (11, 14), 1 never investigated (18), and **22 have no proving test today** |
| 5 | **All sync compute bounded + cancellable** | **FAIL** | Hirschberg has no bound, no timeout, no worker, no abort, and runs ≥3× per sync (§M3.6, §M3.7). Alignment cannot be cancelled (`fa_cancel` zero callers). The sync run has no cancel control at all (`SyncLoadingOverlay.tsx:17-35`). Only transcription is bounded-and-cancellable |
| 6 | **Gates green** | **PASS (inherited, not re-run)** | Gap pass recorded all six green at this same `main` SHA: `tsc` clean; golden replay 6/6; FA replay 50/50; `cargo check` clean; `cargo check --features fa-inference` clean; `npm test` exit 0 (3925 passed / 78 skipped). **Not re-run this pass** — Decision Log 2. Caveat unchanged: the FA replay's "Zero-Defect Register is empty" assertion is still `it.skip`'d, so 50/50 is not evidence the register closed |
| 7 | **Frozen assets verified (empty diffs)** | **PASS** | `git diff --stat eb1c4fa main -- src-tauri/src/model_download.rs docs/architecture/cloud-asr-measurements.md cloud/` → empty. All eight candidate byte constants and all four fixtures unchanged (§M3.12). This pass modified none of them |
| 8 | **Docs inheritance map empty** | **FAIL** | Ten stale claims outstanding (§M3.10): four new or re-confirmed this pass (N1, N2, N4, C1), three carried (C3, C4, C5-family of eight sites), and one (C6) that becomes stale the moment Wave 1 ships. Two claims verified **still accurate** and must not be "corrected" (N3, C2) |
| 9 | **STATUS ≤ cap** | **PASS (at the line)** | 40/40 `[OPEN`, zero headroom, plus 7 `[DEFERRED`. **This report adds zero items.** §M3.13 proposes closures that would create headroom; none written |

**Score: 3 PASS (one of them inherited, one of them merely at-the-line), 6 FAIL.** No PARTIALs
were awarded — every criterion here is a bar, and a bar is either cleared or not. The honest
summary is that the pipeline is well-engineered *internally* and weak at exactly one thing:
telling the truth to the user about what happened.

---

## 8. M7 — Work-order draft

Scope: **S** ≈ under a day, **M** ≈ a few days, **L** ≈ a week or more. **All estimates are
estimates** — no item here has been costed against a live run, and the two largest risks
(Hirschberg bounds, cloud gateway) are explicitly unmeasured.

Authorization legend: **[code]** code change · **[cloud]** cloud spend · **[merge]** merge to
`main` · **[delete]** audited delete helper.

### Wave 1 — Tell the truth (no cloud, no new engine)

Everything here is local-only and independently shippable. It is also the prerequisite for
deleting the FA gate in Wave 2 — you cannot make FA unconditional until failure is visible.

| # | Item | Scope | Depends on | Authorization |
|---|---|---|---|---|
| 1.1 | Pause-and-ask dialog + paused run state (C5) | M | — | [code] |
| 1.2 | Cancel control on the sync overlay; wire `fa_cancel` (§M3.5, C7/C8) | M | 1.1 (shares the overlay) | [code] |
| 1.3 | Replace the fail-clean-to-Whisper contract; typed failure kinds; remove the `fallback` arm (§M3.1) | **L** | 1.1, 1.2 | [code] |
| 1.4 | Per-chunk infeasibility count out of Rust; grouped finding; `degraded` on the result (§M3.2) | M | 1.3 (shares the result type) | [code] |
| 1.5 | Provenance schema + atomic write + v4→v5 migration labelling legacy engine-unknown (§M3.4) | M | — | [code] |
| 1.6 | R.14/R.15 log entries + R-AP log entry (§M3.3) | **S** | — | [code] |
| 1.7 | Stale-claim corrections, ten sites (§M3.10) | S | — | [code] |
| 1.8 | Retire `fa_align_dev` + `__faDevAlign` (~180 lines); repoint `fa_durable_wav_live.rs` (§M3.8) | S | — | [code] [delete] |
| 1.9 | STATUS.md closures + NR-2 superseded note (§M3.13) | S | 1.1-1.8 landing | [code] |
| 1.10 | English parity re-run with per-chunk feasibility diagnostics (§M4.5) | M | 1.4 (needs the count) | **[cloud]** — separately authorized per Q4 |

**Wave 1 exit:** scorecard rows 1, 2 and 3 go PASS; row 8 goes PASS; row 5 goes partial.
Sequence 1.1 → 1.2 → 1.3 is strict; 1.5, 1.6, 1.7, 1.8 are independent and parallelizable.

### Wave 2 — One engine concept, bounded compute

| # | Item | Scope | Depends on | Authorization |
|---|---|---|---|---|
| 2.1 | Delete both FA toggles and the gate (C1, C2) | S | **Wave 1 complete** | [code] |
| 2.2 | Settings → Sync section; default-engine radio; re-home models list + FA pack status (G1, G2, G4, G7) | M | 2.1 | [code] |
| 2.3 | Sync-panel engine chip + per-run override (B1, G3) | M | 2.2 | [code] |
| 2.4 | Promote FA preflight from observational to gating on the local path (C3) | S | 1.1 | [code] |
| 2.5 | Deduplicate `computeRunContext` to one pass per run (§M3.7) | S | — | [code] |
| 2.6 | Hirschberg: measure first with `__ALIGN_INSTRUMENT__`, then worker + abort + measured bound (§M3.6) | **L** | 2.5, 1.2 | [code] |
| 2.7 | Content-hash spine: audio hash + normalized script hash (H3, A5, B2, B8) | **L** | — | [code] |
| 2.8 | Scene-anchor binding invariant test (H4) | S | 2.7 | [code] |
| 2.9 | Six-group sync log (F9, F10) | M | 1.6 (new entry kinds exist by then) | [code] |
| 2.10 | Language/vocab normalization: wiring + the runtime data loader + packaging (§M3.9, Q2) | **L** | — | [code] |
| 2.11 | Rename `fa_dev.rs` to reflect that it is production (J2) | S | 1.8 | [code] |

**Wave 2 exit:** scorecard row 5 goes PASS. 2.6 and 2.10 are the two large unknowns — 2.6
because the bound must be chosen from a measurement that does not exist yet, 2.10 because the
loader and its packaging consequence are unscoped.

### Wave 3 — Cloud engine

| # | Item | Scope | Depends on | Authorization |
|---|---|---|---|---|
| 3.1 | Gateway: auth, per-account quota, one-hour job cap, metering (doc-only today) | **L** | — | [code] **[cloud]** |
| 3.2 | Opus encode path in the app (I2) | M | — | [code] |
| 3.3 | Cloud client + upload with separate upload/processing progress (M4.4) | M | 3.1, 3.2 | [code] |
| 3.4 | One-job-on-the-wire, two-stage-behind-it, keyed by the Wave 2 spine (§M4.2) | **L** | 3.1, 2.7 | [code] **[cloud]** |
| 3.5 | Retry-once, then pause-and-ask (M5 #20) | S | 3.4, 1.1 | [code] |
| 3.6 | Offline probe against the gateway; pause flow (I4) | S | 3.1, 1.1 | [code] |
| 3.7 | CSP `connect-src` gateway origin (I3) | S | 3.1 | [code] |
| 3.8 | Cloud provenance stamp; assert audio-only payload (I5, §M3.4) | S | 1.5, 3.4 | [code] |
| 3.9 | Make Cloud the actual default (G2 functional) | S | all of Wave 3 | [code] [merge] |

### Wave 4 — Commercial layer

| # | Item | Scope | Depends on | Authorization |
|---|---|---|---|---|
| 4.1 | Server-authoritative credits wallet; deduct on delivery only (G5, Q3) | **L** | 3.1 | [code] **[cloud]** |
| 4.2 | Balance + account status in Settings → Sync → Cloud | M | 4.1 | [code] |
| 4.3 | Zero-balance behaviour: cloud removed from picker, Local offered, top-up entry | M | 4.1, 2.2 | [code] |
| 4.4 | Per-sync credit in the sync log beside the engine stamp (G6) | S | 4.1, 2.9 | [code] |
| 4.5 | Prove deduction rules: success only; free on cache hit, cancel, failure, incomplete retry | M | 4.1 | [code] |

**Critical path:** 1.1 → 1.2 → 1.3 → 2.1 → 2.2 → 2.7 → 3.1 → 3.4 → 3.9 → 4.1. Everything
else hangs off it. The single most valuable early item is **1.3**, and the single most
under-scoped items are **2.6**, **2.10** and **3.1**.

---

## 9. M8 — Before/after pipeline walkthrough

One journey, told twice. **Sarah** has a 30-minute voiceover, a finished script, and a scene
document with about 500 scenes. She has her visuals ready. In both stories she does exactly
the same things; only the software differs.

Citations are footnoted so the story reads without them.

### Walkthrough A — Today, defects present

**1. She drops in the voiceover.** The moment the file lands, transcription starts on its own
— she did not ask for it.[^1]

> *What she sees:* a progress bar, "Transcribing… 4%".
> *What actually happened:* the app launched a separate program and loaded a 1.6-gigabyte
> speech model from scratch. It will do that again, in full, every single time she
> transcribes anything.[^2]
> *Consequence:* about **21 minutes** of waiting before she can even press the main button.
> She can cancel this part — that button works.[^3]

**2. She presses Apply Sync.** A dimmed screen appears: a spinner and the words "Preparing
your project…".

> *What she sees:* a spinner. No percentage, no stage, no button.
> *What actually happened:* the screen is a status label with no controls on it at all.[^4]
> *Consequence:* **from here until it finishes, there is no way to stop.** If she picked the
> wrong script, she waits it out or force-quits the app. The longest phase of the pipeline is
> the only one with no cancel.

**3. Behind the spinner, precise alignment runs — or quietly doesn't.** Whether it runs at all
depends on a setting buried in Project Settings that is **off by default**.[^5]

> *What she sees:* nothing. The spinner is identical either way.
> *What actually happened:* if the setting is off, the precise pass is skipped entirely. If
> it is on and anything goes wrong — an unsupported language, a missing model file, a runtime
> error, or a result that comes back empty — the app quietly falls back to the rougher
> timings and **carries on as if nothing happened**.[^6]
> *Consequence:* this is the defect the team calls D24. Her timeline is measurably worse and
> **the app reports success**. There is a line about it in a log panel she has no reason to
> open. In one of those cases — an empty result — the app pays the *entire* cost of the
> precise pass first and then throws all of it away.[^7]

**4. Some passages can't be aligned at all.** For a few scenes, the text the app tries to fit
into a window is structurally too long to fit, at any quality.

> *What she sees:* nothing at all.
> *What actually happened:* the app **invented** timings for those words — spaced them evenly
> across the window — and marked each one internally as needing review.[^8]
> *Consequence:* those scenes are guesses presented as measurements. The "needs review" mark
> is real, and **nothing in the entire application ever reads it** — no badge, no log line, no
> count.[^9] The run reports a clean result.

**5. The matching stage runs, unbounded.** Her ~500 scenes are matched against thousands of
transcribed words.

> *What she sees:* the spinner, possibly frozen.
> *What actually happened:* the matcher runs on the main thread with no size limit, no
> timeout, and no way to interrupt it — and a previous size guard was deliberately
> removed.[^10] It also runs the same expensive computation at least three separate times
> over the same inputs.[^11]
> *Consequence:* on a project this size the window can simply stop responding, and nobody has
> ever measured where the edge is.[^12] The redundant work is roughly triple what is needed.

**6. Rules adjust the scene boundaries.** Several automatic rules nudge boundaries to land in
the right places. Most of them write a line in the log explaining what they did.

> *What she sees:* nothing.
> *What actually happened:* two of the rules — the last two to run, and they **do move her
> committed boundaries** — write nothing at all. Their only output is a developer console
> message.[^13] A separate safety check that detects illegal boundary moves is also
> console-only.[^14]
> *Consequence:* scenes moved and **there is no record anywhere she can see**. If a boundary
> looks wrong later, there is nothing to trace it to.

**7. The timeline commits, and the waveform draws.** The reveal happens, then the audio
picture fills in.

> *What she sees:* her timeline. It looks finished.
> *What actually happened:* everything was written in one atomic step, which is genuinely
> well built.[^15] But **nothing recorded which engine produced these timings, which model,
> or which version** — no such field exists anywhere in the saved project.[^16]
> *Consequence:* six months from now, nobody — not Sarah, not support, not the developers —
> can tell whether these timings came from the precise pass or the fallback. The one field
> that stores the precise word timings is written and then **never read by anything**.[^17]

**8. She re-exports her voiceover from her audio editor** — same audio, a tiny fade fixed at
the very end — and drops it back in.

> *What she sees:* the full 21-minute transcription, again.
> *What actually happened:* the app identifies audio by filename, byte size and
> last-modified date. A new timestamp means "new file", even if the bytes were
> identical.[^18]
> *Consequence:* she pays the full cost again for a file the app had already processed. There
> is no partial re-sync anywhere in the system — any mismatch is a rebuild from scratch.

**A — summary.**
*Time spent waiting:* roughly **21 minutes** transcribing plus **6 minutes** aligning, about
**27 minutes**, of which the last 6 are completely uninterruptible.[^19]
*What can go silently wrong:* precise alignment silently downgraded to rough timings (six
separate ways); invented timings for unalignable passages, presented as real; two boundary
rules moving her scenes with no record; a safety violation detected and reported only to a
console; redundant computation tripling the cost; an unbounded matcher that can freeze the
window; and a re-staged identical file forcing a full redo.
*What is stored, and is it labelled:* the timings, the transcript, the log, and a write-only
copy of the precise word timings. **None of it carries any engine, model or version label. It
is all unlabelled.**

### Walkthrough B — Final shape, same journey, same moments

**1. She drops in the voiceover.** Before anything starts, the panel says which engine will
run: **Cloud**. A single click beside it would switch this one run to Local; it would not
change her default.[^20]

> *What she sees:* "Engine: Cloud" and a progress bar that distinguishes *uploading* from
> *processing*.
> *What actually happened:* the audio was compressed to a small speech-optimized file —
> about 3.7 MB for 30 minutes — and sent. The video never leaves her machine.[^21]
> *Consequence:* **no 21-minute wait.** There is no forced-alignment setting anywhere to find
> or get wrong, because there is no longer such a setting.
> *Delivered by:* Wave 2 items 2.1-2.3 and Wave 3 items 3.2-3.3.

**2. She presses Apply Sync.** The progress panel names the stage and carries a Cancel button.

> *What she sees:* stage-by-stage progress and a working Cancel.
> *What actually happened:* one job, ~90 seconds warm, a little longer on a cold start.
> Cancel reaches whatever is running — transcription, alignment, or the cloud job — and the
> project is left exactly as it was.[^22]
> *Consequence:* she is never trapped. Cancelling costs her nothing, including no credit.
> *Delivered by:* Wave 1 items 1.2-1.3, Wave 3 items 3.4-3.5.

**3. Alignment runs as part of the job — always.** There is no toggle and no way to end up on
the rough timings by accident.

> *What she sees:* one progress bar.
> *What actually happened:* transcription and alignment ran as one job. Neither is optional.
> *Consequence:* the "quietly worse timings, reported as success" outcome **cannot occur** —
> the result type no longer has a way to express it.
> *Delivered by:* Wave 1 item 1.3, Wave 2 item 2.1.

**4. Three scenes can't be aligned precisely.** The passages are still structurally
unalignable — that has not changed.

> *What she sees:* a clear line in the sync log — "3 scenes estimated" — and those three
> scenes marked **estimated** on the timeline itself.
> *What actually happened:* the app still filled in evenly-spaced timings, because a gap
> would be worse. But the run is now recorded as *completed with degradation*, never clean,
> and the estimate flag finally has something reading it.
> *Consequence:* she can look at exactly three scenes and decide whether to care. Nothing is
> presented as a measurement that is actually a guess.
> *Delivered by:* Wave 1 item 1.4.

**5. Something goes wrong — the cloud job fails once.** The app retries, once, silently.

> *What she sees:* nothing on the first failure. On the second, a dialog: "Cloud unavailable
> — switch to local, or cancel."
> *What actually happened:* one automatic retry, then it stopped and asked rather than
> quietly doing something else.
> *Consequence:* she chooses. If she picks Local, the run resumes on her machine without
> re-doing work already completed — and the dialog says plainly that local will produce
> *different* timings, because the two engines are measurably not interchangeable.[^23]
> No credit was deducted, because the job never completed.
> *Delivered by:* Wave 1 item 1.1, Wave 3 items 3.5-3.6, Wave 4 item 4.5.

**6. The matching stage runs, bounded.** Same ~500 scenes.

> *What she sees:* a responsive window and a live progress bar.
> *What actually happened:* the matcher runs off the main thread, honours Cancel, and the
> expensive shared computation runs once instead of three times.
> *Consequence:* no freeze, and the stage is roughly three times cheaper.
> *Delivered by:* Wave 2 items 2.5-2.6.

**7. Rules adjust the boundaries — all of them on the record.** Including the last two.

> *What she sees:* a grouped, six-section sync log. Every boundary correction has a line
> naming the scene and the rule that moved it.
> *Consequence:* no invisible changes to her timeline. Ever.
> *Delivered by:* Wave 1 item 1.6, Wave 2 item 2.9.

**8. The timeline commits — stamped.** In the same atomic write as the timings.

> *What she sees:* in the log, next to the result: the engine, the model, and "1 credit".
> *What actually happened:* a provenance record was written in the same step as the timings,
> so timings can never exist unstamped. Exactly one credit was deducted, on success only.
> *Consequence:* in six months anyone can answer "what produced these timings?". Her older
> projects, synced before any of this existed, read **"engine not recorded"** — never a
> guess.[^24]
> *Delivered by:* Wave 1 item 1.5, Wave 4 items 4.1 and 4.4.

**9. She re-exports the voiceover** — same audio, tiny fade fixed — and drops it back in.

> *What she sees:* nothing happens. The timeline is already correct.
> *What actually happened:* the app identifies audio by its content, not its timestamp.
> Identical bytes, identical result, no work, no charge.
> *Consequence:* free. Likewise, swapping every visual in the project changes no timing at
> all, and fixing a double space in the script costs nothing — only a real wording change
> triggers a fresh sync, and that re-bills one credit.
> *Delivered by:* Wave 2 items 2.7-2.8, Wave 3 item 3.4.

**B — summary.**
*Time spent waiting:* about **90 seconds** warm, ~2 minutes cold — and interruptible
throughout.
*What can go silently wrong:* **nothing.** Every failure is either auto-filled with a visible
flag, or it stops and asks. There is no path that downgrades quality while reporting success.
*What is stored, and is it labelled:* the timings, the transcript, the grouped log, and the
word timings — **all stamped with engine, model and version**. Projects predating the stamp
are explicitly labelled "engine not recorded" rather than guessed.

### Closing table — A vs B

| | **A — today** | **B — final shape** | Delivered by |
|---|---|---|---|
| **Total wait** | ~27 min (21 transcribe + 6 align) | ~90 s warm / ~2 min cold | W2.1-2.3, W3.2-3.4 |
| **Silent-failure count** | **8** — five FA substitution paths, fabricated timings for unalignable chunks, R.14/R.15 boundary moves, R-AP violations | **0** | W1.3, W1.4, W1.6 |
| **Re-sync triggers** | Any change to filename, byte size or timestamp of the audio — including a byte-identical re-export | Real audio change, or a real script wording change. Whitespace-only edits and all visual changes are free | W2.7, W2.8 |
| **Cancellable points** | **1 of 3** — transcription only; alignment and the sync run cannot be stopped | **All** — transcription, alignment, cloud job, whole run | W1.2, W2.6, W3.5 |
| **Trust signals visible to the user** | An engine line and a fallback line in a log panel she has no reason to open. Two rules and one safety check write nothing she can see | Engine chip before the run; stage progress; estimated-scene flags on the timeline; a grouped six-section log with every correction; provenance on the stored result | W1.4-1.6, W1.5, W2.9 |
| **Cost** | Free, but ~27 min of her machine and her time per sync | 1 credit ($0.10) on success only. Free on cache hits, cancels, failures and incomplete retries. Local stays free and offline | W4.1, W4.5 |

[^1]: `App.tsx:3488` `handleVoiceoverStaged`; slot `DropZonePanel.tsx:1234-1284`, comment at `:892-893`.
[^2]: Sidecar spawned per run at `whisper.rs:979` inside `whisper_transcribe` (`:856`), model argv `:974`; `WhisperState` (`whisper.rs:47`) caches process handles, not models. Local whisper.cpp measured 1018.42 s for 23.7 min of audio (RTF 1.40×) — `cloud-asr-measurements.md:130-131`.
[^3]: `TranscriptionBar.tsx:36-42` → `whisperService.ts:1763` → `whisper_cancel` (`whisper.rs:1107`).
[^4]: `SyncLoadingOverlay.tsx:17-35`, rendered `App.tsx:7872`; no cancel prop, no `'Escape'` handler in `App.tsx`.
[^5]: `ProjectSettingsModal.tsx:240-257`; default `FA_PROJECT_DEFAULT_ON = false` (`faGate.ts:91`); gate read `App.tsx:3941`.
[^6]: `forcedAlignmentRun.ts:123-128`, `:143-146`, `:187-190`, `:200-206`; commit proceeds `App.tsx:3975` → `:4019-4026` → `:4635`.
[^7]: `forcedAlignmentRun.ts:187-190` — the full `fa_align_production` run completes before the zero-word check.
[^8]: `fa_onnx.rs:1570-1578`, fill at `:1440-1459`, score `:1402`.
[^9]: `needsReview` reaches `TranscriptToken` (`types.ts:387`) via `faBoundaryTypes.ts:133-142`; repo-wide search finds zero consumers in `src/` — every component hit is `HeadingOverlay.needsReview` (`headingLayer.ts:22,31`).
[^10]: `whisperService.ts:334`/`:270`, three DP passes `:359`,`:369`,`:376`; removal of the earlier cap recorded at `:149`.
[^11]: `computeRunContext` (`faChunkPlan.ts:114`) via `:904`, `:419` and `faSeamFitGate.ts:190`.
[^12]: Carried forward unmeasured across all three passes; `__ALIGN_INSTRUMENT__` (`whisperService.ts:125`) is dormant.
[^13]: `faAnchorTrustGate.ts:225`, applied `App.tsx:4471`, warn only `:4466-4469`; no `buildAnchorTrust*` exists among `syncLog.ts`'s builders.
[^14]: `App.tsx:4489-4500`, `console.error` only, by explicit decision `:4480-4488`.
[^15]: `App.tsx:4635`, single `setProject`, log folded `:4639`.
[^16]: No engine/model/version field on `Project`, `TranscriptToken`, `VideoSegment`, `SyncLogEntry` or `SyncRunSummary`; `anchorSource` is write-only by its own doc (`types.ts:234`).
[^17]: `faWordTimings` (`types.ts:534`) written `App.tsx:3995`/`:4656`, zero readers in `src/`.
[^18]: `getFileIdentity` (`syncEngine.ts:383-384`), compared `App.tsx:3520`.
[^19]: Local FA measured 275.95 s for 23.7 min (5.16× realtime) — `cloud-asr-measurements.md:381-398`.
[^20]: Target per Q1; no such control exists today (G2, G3).
[^21]: One hour of 16 kHz mono Opus CBR 16 kbps = 7,477,405 bytes (`cloud-asr-measurements.md:66`); no Opus encoder exists in the app today (`whisper.rs:756-757`).
[^22]: Warm T4: ~53 s transcription + ~33 s alignment for 30 min (`cloud-asr-measurements.md:125-127`, `:381-398`); cold start 7.5-30 s (`:96-109`).
[^23]: English FA parity mean 8.16 ms but max 1.84 s with 108 words over 50 ms (`cloud-asr-measurements.md:358-359`); transcription parity 4556 local vs 3960 cloud tokens (`:176-198`).
[^24]: Migration at the existing back-compat hook `projectStore.ts:468`; envelope version `:35-39`, currently never read (`:336-346`).

---

## 10. Open items (explicitly unresolved, evidence named)

1. **Restart mid-sync** — never investigated, in any of the three passes. Needs a dedicated
   read of persistence/recovery around an in-flight Apply Sync.
2. **Corrupt/missing model weights, and script/audio mismatch** — carried forward from the
   2026-09-17 audit unverified for a second pass.
3. **Very-long-audio behaviour** — still unmeasured. Wave 2 item 2.6 must start with the
   measurement, not the bound.
4. **R.7 clause 3** — absence of evidence, not confirmed absent. §M3.11 recommends retiring
   the clause; that is an operator ruling, not a finding.
5. **`vocabCharsFromRawVocab` export name** — referenced in `faTextNormalize.ts`'s header but
   its export line was not located; verify before sizing Wave 2 item 2.10.
6. **The FA replay gate's two differently-partitioned census lines** (21 open vs 6/21
   unassigned) — unreconciled for a second pass.
7. **One-job vs two-job cloud shape** — architect decision, recommendation given (§M4.2).
8. **The eight/four frozen-asset lists** — a candidate set is proposed (§M3.12) and verified
   immutable; the naming itself needs operator confirmation, and "digests" may be a misnomer
   for byte-size pins.

Per Q4, fr/de/pt parity is **not** listed here and is not a gap.

---

## 11. Command log

```
git fetch --all
git rev-parse HEAD / main / ws1-plan-rewrite / ws-cloud-asr-plan / origin/main / origin/ws-cloud-asr-plan
git branch -a | grep -i cloud
git show eb1c4fa --stat
git log --oneline -15
git status --short
git diff --stat 5970984 main -- src/App.tsx src/services/ src-tauri/src/
git diff --stat eb1c4fa main -- src-tauri/src/model_download.rs docs/architecture/cloud-asr-measurements.md cloud/
ls -d node_modules / src-tauri/target                      (both ABSENT — see Decision Log 2)
wc -l src/App.tsx src/services/{syncEngine,syncLog,faChunkPlan}.ts
read  docs/architecture/fa-wiring-audit.md
read  docs/STATUS.md
read  docs/ws1-sync-pipeline/gap-closing-verification-2026-09-18.md
read  src/services/forcedAlignmentRun.ts (full)
read  src/App.tsx:3678-3977, 3978-4277, 4441-4510, 4556-4735
read  src-tauri/src/fa_onnx.rs:1390-1499
read  src/types.ts:379-396, 522-534
grep  numbered step comments + syncMark checkpoints in handleApplySyncFromFiles
grep  anchor-trust builders / syncLog exported builders
grep  needsReview consumers (src/, non-test)
grep  faWordTimings consumers (src/, src-tauri/src/, non-test)
grep  stale-claim phrases across src/services, src/types.ts, src-tauri/src/fa*.rs
grep  frozen byte constants repo-wide; sha256/digest in measurements + cloud README
grep  content-hash / script-normalization surfaces
sed   docs/architecture/cloud-asr-measurements.md:50-70; src-tauri/src/model_download.rs:135-145
```

Four read-only research agents were used for breadth (cloud lane, rules/matching, model-load
and cancel and dead-code, UI and storage schema). Every finding they returned that this report
relies on was re-verified against the tree by direct read before being stated — three of their
line citations were corrected in the process (§M1), and two of their conclusions contradicted
the task's own framing and are recorded as corrections (§M3.7, §M3.8).

The six gates were **not** run — Decision Log 2. No test, build, network call, cloud job or
delete was executed by this pass.

---

## 12. Commit

Files changed by this pass: **this file only.** `docs/STATUS.md` untouched (zero items added).
No source file, no other doc, no frozen asset, no fixture. Nothing deleted.

**Commit SHA:** recorded in the chat reply after this file is committed.
