# WS1 gap-closing verification — 2026-09-18

> Read-only verification pass over the 2026-09-17 WS1 sync-pipeline audit. One docs-only
> report, this file. No source or other doc file was modified by this pass. Branch
> `ws1-plan-rewrite`, committed here, merge-only (never rebase) per standing instruction.

---

## Decision Log (conservative defaults taken, logged per instruction — never asked)

1. **"Pre-round28-main target"** — resolved to the annotated git tag `pre-round28-main`
   (`4d4922c`), found via `docs/STATUS.md:3` and `docs/ws3-export-pipeline/architecture-ledger.md:4`.
   Not ambiguous once located; recorded as-is.
2. **"The eight frozen byte constants" and "the four fixture digests" (V5c)** — **no
   authoritative list of exactly 8 constants or exactly 4 digests was found anywhere in
   `docs/`, `CLAUDE.md`, or `scripts/fixtures/README.md`.** Grepped for "frozen" + byte/constant
   and "fixture digest" repo-wide; nothing names these two sets explicitly. Conservative default:
   verified every *concretely identifiable* frozen value found during this pass instead of
   guessing at the two round numbers — see §V5c. **Marked OPEN: the two counts themselves are
   unconfirmed against any named list; the task author should supply or point at the canonical
   list if one exists outside `docs/`.**
3. **"The six gates" (V5d)** — no named list of exactly six gates exists in the repo either.
   Conservative default, logged: `npx tsc --noEmit`, golden replay
   (`scripts/phase4-handoff-replay-sync.test.ts`), the FA replay/Zero-Defect-Register gate
   (`scripts/phase4-fa-replay.test.ts`), `cargo check`, `cargo check --features fa-inference`,
   and the full `npm test` suite (raw count, explicitly caveated as a snapshot). All six run
   this session; results in §V5d.
4. **Where to run the gates** — run against **`main`** (current tip `4bd18ce`) rather than the
   `ws1-plan-rewrite` worktree, because §V1 confirms zero diff on every sync-lane TypeScript file
   between the audit base (`eb1c4fa`) and `main`, and the worktree has no `node_modules` (a
   `git worktree` does not share it, and installing one there would be a real environmental
   change, not a read-only check). Results are equally valid for either ref given the confirmed
   zero-diff; logged rather than silently assumed.
5. **D24's placement** — confirmed still filed under WS3 Open Bugs (`docs/STATUS.md:122`)
   despite being a sync/FA concern. Per the 2026-09-17 audit's own scoping ("flag, don't
   silently move"), this pass does the same: flagged again in §V5e, not relocated.

---

## Command log

```
git fetch --all
git rev-parse main / ws-cloud-asr-plan / ws1-plan-rewrite / pre-round28-main
git merge-base main ws-cloud-asr-plan / main ws1-plan-rewrite
git diff --stat eb1c4fa main -- src/App.tsx src/services/ src-tauri/src/
git diff eb1c4fa main -- src-tauri/src/whisper.rs src-tauri/src/fa.rs src/App.tsx
git diff --stat eb1c4fa main -- <each cited sync-lane service file>
git diff --stat eb1c4fa main -- docs/STATUS.md
diff <(tail -n +9 docs/archive/ws1/sync-pipeline-v2-plan-original.md) docs/ws1-sync-pipeline/sync-pipeline-v2-plan.md
grep/sed across src/services/{faAnchors,faChunkPlan,faAnchorTrustGate,faRunPlacementGate,
  faSeamFitGate,faUnspokenGate,faRuleStageExclusion,forcedAlignmentRun,syncEngine,syncLog,
  syncConstants}.ts, src-tauri/src/{fa,fa_onnx,fa_production,fa_dev,whisper,model_download}.rs
npx tsc --noEmit                                    (main, exit 0)
npx vitest run scripts/phase4-handoff-replay-sync.test.ts   (main, exit 0, 6/6)
npx vitest run scripts/phase4-fa-replay.test.ts              (main, exit 0, 50/50)
cargo check                                          (src-tauri, exit 0)
cargo check --features fa-inference                  (src-tauri, exit 0)
npm test                                             (main, exit 0, 3925 passed/78 skipped)
```

All output logged to session scratchpad (`gates/1..6-*.log`), not `/tmp`, not committed
(scratch only; excluded here per the "no /tmp literals" / docs-only-report rule).

---

## V1 — Repo state vs audit base

| Ref | SHA |
|---|---|
| `main` (current tip) | `4bd18cef895b6210d958653281dd2e0de99db440` |
| `ws-cloud-asr-plan` tip | `eb1c4fa199f924aca299598fcc5cbb170841f656` (audit base — unmoved) |
| `ws1-plan-rewrite` tip | `eb1c4fa199f924aca299598fcc5cbb170841f656` (unmoved — no prior commits) |
| `pre-round28-main` (annotated tag) | `4d4922c` (points at the pre-merge main baseline) |
| merge-base(`main`, `ws-cloud-asr-plan`) | `eb1c4fa` |
| merge-base(`main`, `ws1-plan-rewrite`) | `eb1c4fa` |

`main` is **17 commits ahead** of the audit base — `ws-cloud-asr-plan` (`eb1c4fa`) was merged
into `main` via `42988f1`, followed by WS3 storage-root Round 29 work (D12–D23) and one docs
consolidation commit (`4bd18ce`, "NR-5").

**`git diff --stat eb1c4fa main -- src/App.tsx src/services/ src-tauri/src/`** — 13 files, 1598
insertions / 131 deletions, **all WS3 storage-root / asset-timestamp work**:

- `src-tauri/src/{fa.rs, whisper.rs, models.rs, project_mirror.rs, storage_root.rs, ffmpeg.rs, lib.rs}` — D12/D20/D21 fixes routing model/cache paths through `storage_root::resolve_storage_root` instead of `app_local_data_dir` directly.
- `src/App.tsx` — 12 lines, all `addedAt: Date.now()` field additions (D23 fix, unrelated to sync timing) + new storage-relocation-modal props.
- `src/services/{storageRoot.ts, storageRoot.test.ts, exportCheckpoint.ts, webcodecsExport/diskFull*.ts}` — WS3-only.

**Confirmed zero diff** on every sync-pipeline-specific file cited by the 2026-09-17 audit:
`snapBoundaries.ts`, `faChunkPlan.ts`, `whisperService.ts`, `syncLog.ts`, `syncEngine.ts`,
`faGate.ts`, `forcedAlignmentRun.ts`, `faRunPlacementGate.ts`, `faAnchorTrustGate.ts`,
`faSeamFitGate.ts`, `faUnspokenGate.ts`, `faRuleStageExclusion.ts`, `types.ts`, and the entire
`handleApplySyncFromFiles` region of `App.tsx` (confirmed still starting at `App.tsx:3678` on
`main` — the earlier-in-file `addedAt` additions net to a line-count wash by that point).

**Correction to the 2026-09-17 audit:** `whisper.rs`'s `MODEL_FILENAME` constant citation
shifts from **`whisper.rs:589` → `whisper.rs:588`** on `main` (a documentation-comment edit
above it). **The constant's value is unchanged** (`"ggml-large-v3-turbo.bin"`), and
`model_path()`'s underlying logic only gained a *new first-check* (storage-root resolution)
ahead of the pre-existing `app_local_data_dir` fallback — still zero FA-gating anywhere in the
function. The prior session's finding ("Whisper always loads the multilingual turbo model
regardless of FA state") is **unaffected and re-confirmed** on `main`.

**`fa.rs`'s `fa_audio_cache_dir`** similarly gained a storage-root indirection (D20 fix) — no
change to any cited sync-timing logic.

**No other file:line citation from the 2026-09-17 session requires correction.**

**Archive fidelity:** `diff <(tail -n +9 docs/archive/ws1/sync-pipeline-v2-plan-original.md) docs/ws1-sync-pipeline/sync-pipeline-v2-plan.md` → **0 lines of diff.** The archive copy's body (after its 8-line header) is byte-identical to the live plan doc. The live plan doc itself is confirmed identical between `ws1-plan-rewrite` and `main` (`git diff main -- docs/ws1-sync-pipeline/sync-pipeline-v2-plan.md` → empty). **Original file untouched, as required.**

**`docs/STATUS.md` DID change** between `eb1c4fa` and `main` (20 insertions / 5 deletions — the
NR-5 consolidation entry plus new WS3 D23/W25–W30 lines). See §V5e for the current count.

---

## V2 — R.7 status: **PARTIAL**, built differently than specified, verdict per bullet

R.7 ("Failure paths — the skip-and-flag contract") specifies three behaviors. Checked each
against shipped code (`main`, confirmed byte-identical to audit base on every file involved):

| R.7 clause | Verdict | Evidence |
|---|---|---|
| **(1) Fit precheck** — "target text cannot fit the window → skip the segment, insert a wildcard, emit a structural finding" | **Implemented by a different mechanism, with a real gap against the literal spec.** The literal case (`AlignError::TooManyRepeats`, confirmed to be exactly the "targets length is too long for CTC" case — comment at `fa_onnx.rs:1415`) is caught inside `align_chunked` (`fa_onnx.rs:1570-1578`) and substituted with **evenly-spaced placeholder words, every one flagged `needs_review`, run continues, `status: ok`.** This is NOT "skip the segment / insert a wildcard / emit a structural finding" — no segment is skipped, no wildcard token exists (`fa_viterbi.rs` implements standard CTC with a blank symbol, no wildcard label — matches the earlier audit's finding), and the only "finding" is a server-side `eprintln!` — **no sync-log entry, nothing the user sees.** This directly reinforces the original FA-wiring-audit's D24-adjacent concern (fabricated timing can present as success). | `fa_onnx.rs:1415,1570-1578`; proving tests: `fa_onnx.rs:5486-5541` (`TooManyRepeats` reproduced against real 709s/173-project text), `fa_onnx.rs:5554,5590,5611` (`fallback_words_for_infeasible_chunk` unit tests). **Any *other* alignment error type still hits the catch-all `Err(e) => return Err(e)` at `fa_onnx.rs:1580` and aborts the whole run** — confirmed by a test's own comment (a different, unrelated measurement harness) stating "R.7's skip-and-flag gate is explicitly OUT OF SCOPE for this slice... production `align_chunked`... still all-or-nothing" for that broader class. |
| **(2) Force-split** — "no admissible anchor within `MAX_RUN_SEC` → force-split, mark LOW-CONFIDENCE, emit a finding" | **Force-split itself is implemented and live** (`faAnchors.ts:319-333`, `computeFaAnchors`, confirmed wired into production via `faChunkPlan.ts:159` inside `computeFaChunkPlan` — see the stale-claim correction below). **"Mark LOW-CONFIDENCE, emit a finding" is NOT found** — only an internal provenance tag (`'forced-split-silence'` \| `'forced-split-max-run'`) survives on the `FaRun` object; no user-facing log entry or low-confidence flag was found tied to a force-split boundary specifically. | `faAnchors.ts:71-72,319-333`; `faChunkPlan.ts:159` |
| **(3) Boundary-word confidence gate** — "FA per-word confidence below `CONF_MIN` on a run's first/last word → do not use that word as a boundary, fall back to the run's own anchor" | **Not confirmed implemented as literally specified.** `CONF_MIN = 0.3` is real, doubly-defined (`syncConstants.ts:536`, `fa.rs:416`), and cross-language-drift-guarded by a dedicated test (`fa.rs:2156-2188`, reads `syncConstants.ts`'s literal source at test time and panics on divergence) — genuinely careful engineering. But its own scope note (`faAnchors.ts:17-21`) says explicitly: *this module runs strictly before any FA pass and has no FA-confidence input... `CONF_MIN` is defined... for that later, post-FA consumer, but is not read here.* Grepped every `CONF_MIN` (not `CONF_MIN_FALLBACK`, a distinct 0.056 constant used by R.14/R.15's unrelated ordinal gate) consumption site found: all are classification/`needs_review` labeling, none implement "reject a run's first/last word specifically and fall back to the run's own anchor." | No positive evidence found; absence, not a confirmed negative — see §Open items. |

**Every doc stating R.7's status**, found repo-wide:
- `docs/ws1-sync-pipeline/sync-pipeline-v2-plan.md` (~line 2846) — the original design spec (three bullets above), and Part M — R.7 not separately addended there.
- `docs/archive/ws1/sync-pipeline-v2-plan-original.md` — verbatim archive of the same (confirmed byte-identical, §V1).
- `docs/STATUS.md:32` — `[OPEN] Ratify R.7 confidence-flag handling; build skip-and-flag and force-split failure paths` — **this line is itself stale**: force-split is built and wired (bullet 2, above); the fit-precheck case is built via a different mechanism (bullet 1); only the CONF_MIN-boundary-word behavior (bullet 3) has no confirmed implementation. "Build" is the wrong verb for two of the three; "ratify" (i.e., decide whether the shipped placeholder-word behavior is acceptable under NR-1's "FA on means FA runs honestly" bar) is the live question.
- `docs/archive/history/work-in-progress.md`, `docs/archive/history/history-2.md` — historical session narrative, not independently re-verified this pass (out of scope budget; flagged, not asserted).

**Stale-claim correction found while verifying this:** `faAnchors.ts:14`'s own header still reads *"NOT wired into Apply Sync or any live path (Slice D1) — this module has no caller yet."* **This is false on `main` today** — `computeFaAnchors` is called from `faChunkPlan.ts:159`, inside the production `computeFaChunkPlan`. Confirmed by direct grep (zero other candidate callers). This is a genuine, previously-unflagged stale in-code claim — folded into §V6.

**Contrast, so the same-sounding claim isn't mis-corrected:** `faTextNormalize.ts:17` carries an
almost-identical sentence ("NOT wired into Apply Sync — no caller yet") — **this one is still
true.** Confirmed: the only production call to `computeFaChunkPlan`
(`forcedAlignmentRun.ts:142`) passes just 4 of its 8 possible arguments — `languageCode`/
`vocabChars`/`cardinalData` are all `undefined`, and `faChunkPlan.ts:930`'s own guard
(`languageCode !== undefined && vocabChars !== undefined && cardinalData !== undefined`)
means `applyFaTextNormalization` never executes today. Two structurally similar doc-comments,
one stale and one accurate — verified independently rather than pattern-matched.

---

## V3 — FA-failure compute waste: per-failure-mode accounting, code-read only

Traced `runForcedAlignmentForSync` (`forcedAlignmentRun.ts:116-208`) failure-mode by
failure-mode, in the order they can fire:

| Failure mode | Line | What already ran before this fires | Waste |
|---|---|---|---|
| `unsupported-language` | `:128` | Nothing — first check, before silence detection, chunk planning, or any I/O | **None** |
| `empty-chunk-plan` | `:145` | Silence detection only (`detectSilences`, a cheap browser Web Audio decode) — no audio staging IPC, no inference | **Minimal** |
| Audio-staging IPC failure (`fa_stage_audio_raw` throws) | caught by `:200` catch | Silence detection + chunk plan built, but the `fa_align_production` invoke (`:179`) is never reached | **Minimal** (staging I/O only, no ONNX inference) |
| `fa_align_production` invoke rejects mid-run (any Rust-side error after some chunks processed) | caught by `:200` catch | **Proportional to how many chunks completed before the failing one** — real ONNX inference already spent on every prior chunk in the run is discarded. Cannot be bounded further from this file alone; depends on which Rust error fired and at which chunk index. | **Partial, unbounded from TS alone** |
| `zero-words` (channel resolves `'Done'` with an empty array) | `:189` | **The entire `fa_align_production` run completed successfully** — every chunk aligned, no error — and only then is the result discarded for having zero words. | **Full** — the complete FA compute cost is paid (measured elsewhere in the plan at ≈349.5s / ≈4.07× realtime on the V6 corpus) and then thrown away |

**One mitigating factor, confirmed by code read:** the single most common infeasibility case
(`TooManyRepeats`, §V2 bullet 1) is caught *inside* `align_chunked` per-chunk
(`fa_onnx.rs:1570-1578`) and does **not** abort the run — it substitutes placeholder words and
continues. So a chunk-level CTC-infeasibility, specifically, does not land in the "mid-run
invoke rejects" row above; it silently degrades that one chunk's words instead (§V2's own
concern about that). The "mid-run invoke rejects" row is for a *different*, less-common class
(any other `AlignError`, an ORT/OOM panic, cancellation, etc.).

**No timing instrumentation exists** to convert "proportional to chunks completed" into an
actual seconds figure without a live run — this is a code-structure answer, not a measured one,
matching the instruction's "code reading only" scope.

---

## V4 — Cache key and re-sync triggers

**`getFileIdentity` (`syncEngine.ts:383-384`, `` `${file.name}|${file.size}|${file.lastModified}` ``) is confirmed the sole construction site.** Grepped for the literal template pattern repo-wide: exactly one real construction (`syncEngine.ts:384`); every other hit is either a type-doc comment describing it (`types.ts:344,412`; `stagedFilesStore.ts:63`; `stagedFilesPersist.ts:163`) or a *call* to the exported function, never a re-implementation.

**Every re-sync/re-transcription trigger found, with file:line:**

| Trigger | File:line | Behavior |
|---|---|---|
| Voiceover staged (file dropped/picked, independent of Apply Sync) | `App.tsx:3488` `handleVoiceoverStaged` | Compares `getFileIdentity(file)` against `lastTranscribedFileIdentity`; identical → skip Whisper entirely (cache hit, `:3520`); **different → full re-transcription** — this is the media-swap trigger |
| Voiceover asset explicitly deleted | `App.tsx` (~`:5443-5447`) | Unconditionally clears `transcriptTokens`/`lastTranscribedAssetId`/`lastTranscribedFileIdentity`, forcing full re-transcription on next stage |
| Apply Sync's own cache-validity check | `App.tsx:3849-3853` (`cachedTokensReady`) | Re-verifies identity match (by asset id OR file identity) before treating cached tokens as usable; a stale match here is what §D24-adjacent bugs would ride on if this check were wrong — it was not found to be |
| Pending-voiceover restore (app relaunch / project reload with a staged-but-uncommitted file) | `App.tsx:5819-5825` | Compares stored `lastTranscribedFileIdentity` against the restored pending file's identity |
| `useWhisper` hook's own pre-flight | `useWhisper.ts:201,469-471,507` | The hook's independent identity check before starting a transcription job — the second, hook-side half of the same cache convention `App.tsx` uses |

**Media-swap-forces-full-re-sync, specifically:** confirmed at `App.tsx:3520` — the ONLY
condition that skips re-transcription is an EXACT match on `name|size|lastModified`; any
difference (new file, even a byte-identical file re-saved with a different mtime) is treated as
a genuinely new file and re-transcribes from scratch. This is the "spine vs. binding" boundary
the task frames it as: `getFileIdentity` is the spine (identity), everything downstream of a
mismatch is a full rebind, not an incremental update — there is no partial-re-sync path
anywhere in this trigger set.

---

## V5 — Remaining evidence base

### V5a — Entry surface

**Tauri commands entering the sync/FA/whisper pipeline** (`#[tauri::command]`, confirmed by grep):

| Command | File:line | Role |
|---|---|---|
| `whisper_transcribe_attach` | `whisper.rs:571` | Reattach to an in-flight transcription (staging-time) |
| `whisper_stage_audio_raw` | `whisper.rs:715` | Raw-IPC audio staging for Whisper |
| `whisper_transcribe` | `whisper.rs:856` | The transcription run itself |
| `whisper_cancel` | `whisper.rs:1107` | User-initiated cancel (wired to `useWhisper.ts`'s `AbortSignal`, confirmed in the 2026-09-17 session) |
| `fa_stage_audio_raw` | `fa_dev.rs:519` | Raw-IPC audio staging for FA (both dev and production paths) |
| `fa_align_dev` | `fa_dev.rs:588` | DEV-only alignment harness (`__faDevAlign`, non-production) |
| `fa_align_production` | `fa_production.rs:34` | The production FA entry point, called from `forcedAlignmentRun.ts:179` |
| `fa_cancel` | `fa.rs:1176` | Exists, but **confirmed zero frontend callers** — `docs/STATUS.md:148` (Backlog Items), not independently re-verified this pass beyond re-confirming the STATUS.md line is still present and unchanged |

**UI/background entry points into the pipeline** (TypeScript side): `handleVoiceoverStaged`
(`App.tsx:3488`, staging-time, independent of Apply Sync) and `handleApplySyncFromFiles`
(`App.tsx:3678`, the full pipeline walkthrough from the 2026-09-17 session, re-confirmed
unchanged at §V1). No other entry point found.

### V5b — Failure-mode matrix (behavior × test coverage, code-read this pass)

| Failure mode | Current behavior | Test coverage found |
|---|---|---|
| Whisper failure (transcode/model/process error) | `whisper_transcribe` rejects; `useWhisper` sets `{phase:'error', message}` (confirmed in 2026-09-17 session) | Not independently re-verified this pass |
| Corrupt/missing weights | `model_download.rs`/`fa.rs` — hash/manifest verification exists (`verify_model_manifest`, cited in the plan's own live-run-prep doc) | Not independently re-verified this pass — **OPEN, needs a dedicated read** |
| FA failure (general) | Fail-clean per §V3's table — outcome depends on *which* failure | `forcedAlignmentRun.test.ts` exists; specific per-branch coverage not enumerated this pass — **OPEN** |
| CTC-infeasible chunks | `TooManyRepeats` → placeholder-word fallback, run continues (§V2); any other error type aborts the whole run | `fa_onnx.rs:5486-5541,5554,5590,5611` (the `TooManyRepeats` branch); **no test found exercising the catch-all abort branch** — **OPEN** |
| Silence/no speech detected | `detectSilences` failure → chunk with zero silences, warned, continues (`forcedAlignmentRun.ts:135-140`) | Not independently re-verified this pass |
| Empty or truncated audio | `audioDuration` hard-abort gate exists pre-parse (`App.tsx`, confirmed 2026-09-17 session); `Math.max(0.1, ...)` floor for degenerate durations at `App.tsx:718` | Not independently re-verified this pass |
| Non-16 kHz input | Transcoded unconditionally to 16 kHz mono at both the Whisper stage (`whisper.rs:786`, `-ar 16000 -ac 1`) and the FA stage (`fa.rs:643,682`) — **not a distinct failure mode as long as ffmpeg transcode succeeds** | N/A by design |
| Unsupported language | `unsupported-language` fallback, zero waste (§V3) | Confirmed via code read this pass |
| Script/audio mismatch | Coverage gate (`evaluateCoverageGate`, confirmed 2026-09-17 session) aborts on total mismatch | Not independently re-verified this pass |
| Very short / very long audio | No enforced bound found on the Hirschberg DP (confirmed 2026-09-17 session, AI.5); `MAX_RUN_SEC`-bounded chunking exists for FA specifically (`faAnchors.ts`) | **OPEN — no measurement against real large inputs, per the 2026-09-17 session's own finding, unchanged** |
| Concurrent syncs | FA: `already_running` single-flight guard (`fa_dev.rs:653`). Whisper: single-flight gate referenced at `whisper.rs:44,105,119,1956` (a proving test exists: `"single-flight must still refuse a duplicate while the job holds the key"`) | `whisper.rs:1956`-area test confirmed present; FA's own single-flight test not independently re-verified this pass |
| Interrupted sync (user cancel) | `whisper_cancel`/`fa_cancel` both exist; **`fa_cancel` has zero frontend callers** (confirmed via STATUS.md, not re-derived) — so FA cannot actually be cancelled mid-run from the UI today despite the IPC command existing | **Real, confirmed gap** — not new to this pass, but re-confirmed present on `main` |
| Restart mid-sync | Not investigated this pass — **OPEN, needs a dedicated read of persistence/recovery around an in-flight Apply Sync** |

### V5c — Frozen constants + fixture digests

Per Decision Log item 2, no canonical "eight"/"four" list was found. **What was concretely
checked and confirmed unchanged (empty diff) between `eb1c4fa` and `main`:**
`MODEL_SIZE_BYTES` (`model_download.rs:140`), `MODEL_SHA256` (`model_download.rs:141`),
`CONF_MIN` (both `syncConstants.ts:536` and `fa.rs:416`, plus their drift-guard test
`fa.rs:2156-2188` still present and — per §V5d Gate 4/6 — the crate still compiles clean with
it in place). **Marked OPEN for the exact "8" and "4" counts** — the task author should name
the list, or confirm these are the intended set (plus whichever others complete it).

### V5d — The six gates (definition per Decision Log item 3), raw results

| # | Gate | Result |
|---|---|---|
| 1 | `npx tsc --noEmit` | **Clean.** Exit 0, zero output. |
| 2 | `scripts/phase4-handoff-replay-sync.test.ts` (golden replay) | **6/6 passed**, 5.83s test time. Includes the v6/173/spanish replay plus the R-H FA-fixture-capture checks. |
| 3 | `scripts/phase4-fa-replay.test.ts` (FA replay / Zero-Defect Register gate) | **50/50 passed**, 16.23s test time. **The "Zero-Defect Register is empty" assertion is still `it.skip`'d in source** (`scripts/phase4-fa-replay.test.ts:838` area, confirmed unchanged between `eb1c4fa` and `main` — empty diff on this file) — the 50/50 count is every *other* test in the file, not evidence the register closed. Register census printed by the run: 21 open / 14 closed by one accounting, 6/21 unassigned by another line in the same output — the file's own two census lines use different open/closed partitions and were not reconciled further this pass (**OPEN** if an exact single number is required). |
| 4 | `cargo check` | **Clean.** Exit 0, 25.51s. |
| 5 | `cargo check --features fa-inference` | **Clean.** Exit 0, 7.51s. Compiles without the ONNX runtime dylib present, as designed (`ort` uses `load-dynamic`). |
| 6 | `npm test` (full suite) | **Exit 0. 254 test files passed, 63 skipped (317 total). 3925 tests passed, 78 skipped (4003 total).** 468.47s wall time. **npm-count caveat:** this is a live snapshot of a fast-moving suite — the plan doc's own last-cited number (93 files / 2387 tests, Session M) is now stale by roughly 2.6× on file count; treat any test count anywhere in the docs as perishable, this one included. |

### V5e — STATUS.md open items, current `main`

`docs/STATUS.md` changed between the audit base and `main` (§V1: 20 insertions/5 deletions) —
**counts below are from `main`, not the audit-base snapshot.**

- **Total bracket-tagged lines:** 47 (`[OPEN`, `[OPEN · NON-BLOCKING]`, `[OPEN · BLOCKED...]`, `[DEFERRED...]` combined).
- **Strict `[OPEN` (any variant) count: 40 — at the stated cap, zero headroom.**
- **`[DEFERRED...]` count: 7** (not counted against the `[OPEN` cap).
- **WS1's own section (lines 23–53): 17 bracket-tagged items** (8 plain `[OPEN]`, 4 more `[OPEN]`, 2 `[OPEN · NON-BLOCKING]`, 3 `[DEFERRED]` — see the section for exact text).
- **D24, WS1-relevant but filed under WS3 (`docs/STATUS.md:122`):** re-confirmed present, unchanged, still `[OPEN]`. NR-5 (`docs/STATUS.md:19`) explicitly states *"D23 and D24 remain open and unblocked by this merge."* Flagged again per Decision Log item 5 — not relocated, per this pass's own read-only scope and the standing "report only, add none" instruction on STATUS.md.

This report adds **zero** new items to `docs/STATUS.md` — none of the findings above were
written there, per the capped-count instruction.

### V5f — Per-word parity data (English), `ws-cloud-asr-plan` / `docs/architecture/cloud-asr-measurements.md`

**Data exists.** `docs/architecture/cloud-asr-measurements.md`'s "Forced alignment — production
Viterbi" section (line ~277) carries a real English comparison:

> V6 English, 280-chunk plan — 3874 local words, 3874 cloud words, 3874 identical text, mean
> |Δstart| **8.16 ms**, max |Δstart| **1.84 s**, ≤10ms: 3588, ≤50ms: 3766, **>50ms: 108**,
> interchangeable: **no**.

Outliers cluster (not randomly sprinkled): i=330–331 ("are"/"eleven", ~126-128s, max 1.84s) and
i=1666–1669 ("you"/"only"/"know"/"you", ~629-631s, max 1.08s).

**Whether these correlate with CTC-infeasible chunks: UNASSESSABLE from stored data.** The same
doc's own "Unmeasured (not estimated)" section states explicitly: *"Why 108 English words exceed
50 ms: logits were not dumped per chunk, so the split between f64 log-softmax and ORT kernel
differences is **unmeasured**."* No per-chunk diagnostic output was persisted alongside the
word-level comparison — only the final word list and the aggregate table above exist.

**Data needed to compute the correlation:** a re-run of the same V6 English comparison with
per-chunk logit/feasibility diagnostics captured (i.e., which chunks hit `TooManyRepeats` /
took the placeholder-word branch on either the local or cloud engine), joined against the
outlier word indices above by chunk membership. Neither the local (`.work-phase4/replay/v6/
fa_production_words.json`) nor the cloud (`cloud/results/`) artifacts referenced in the doc
carry this per-chunk field today. **The clustering pattern (two tight index ranges rather than
108 scattered words) is at least consistent with a chunk-boundary-local mechanism — CTC
infeasibility being one candidate among others — but this is an observation, not a computed
correlation, and should not be read as one.**

---

## V6 — Inheritance map (every doc file:line citing a claim needing correction, consolidated)

**"FA disabled" / plan-phase-completion claims** — the 2026-09-17 audit's own
`fa-wiring-audit.md` STEP 5 already built this index (lines 172-191); re-confirmed present and
unchanged on `main` (`fa-wiring-audit.md` not modified between `eb1c4fa` and `main`). Not
re-listed verbatim here — see that file directly. **One addition found this pass, not in that
prior index:**

| Claim | File:line | Status |
|---|---|---|
| "NOT wired into Apply Sync or any live path (Slice D1) — this module has no caller yet" | `src/services/faAnchors.ts:14` | **STALE.** `computeFaAnchors` is called from `faChunkPlan.ts:159`, live in production. Never updated after `faChunkPlan.ts` began calling it. |
| "NOT wired into Apply Sync — no caller yet" | `src/services/faTextNormalize.ts:17` | **Still accurate** — confirmed the production call to `computeFaChunkPlan` (`forcedAlignmentRun.ts:142`) omits the 4 args this module needs; do not correct this one on the strength of the `faAnchors.ts` finding above, they are independently true/false. |
| "R.5... deferred" | `docs/archive/history/work-in-progress.md:132`, `docs/ws1-sync-pipeline/stage1-live-run-prep.md:199` | **Stale**, same finding as the 2026-09-17 session's plan-doc correction — R.5 ships via excision (`faChunkPlan.ts:422`), confirmed live. Two more citations beyond the plan doc itself that any rewrite/correction pass should also touch. |
| "ALIGNER COMPLETE, dev-only... zero production callers" | `docs/ws1-sync-pipeline/sync-pipeline-v2-plan.md:33` (Phase Status table) | Already indexed by `fa-wiring-audit.md:174,187` as stale vs. `App.tsx:3960+` — re-confirmed, no new instance found elsewhere. |

**"97-99% accuracy" claims** — grepped every `docs/*.md`: **zero hits for this specific figure
anywhere in the documentation.** It exists only in this chat session's own record (the
operator's spoken number), never written into any doc. Nothing to correct — but also nothing to
cite as a documented fact yet. If the operator wants this number treated as a standing
benchmark, it needs to be written somewhere for the first time, not corrected.

**Parity-number citations** — `docs/architecture/cloud-asr-measurements.md`'s own table (§V5f)
is the only stored parity data found; it already carries its own "no, not interchangeable"
verdict and is not contradicted elsewhere in the docs searched this pass.

---

## Summary — what changed since the 2026-09-17 audit, in one paragraph

Nothing in the sync/FA pipeline's TypeScript surface changed between the audit base and current
`main` — every prior citation holds except one Rust line-number shift with no behavioral
consequence (`whisper.rs:589→588`, cosmetic). What's new this pass: R.7 turns out to be a
genuine **partial**, not simply "unratified" — two of its three clauses are built (by different
mechanisms than specified, one with a real observability gap), one has no confirmed
implementation at all; a `fa_align_production` run that returns zero words pays the *full* FA
compute cost before discarding it, the single worst case in the fail-clean contract; `fa_cancel`
existing but having zero frontend callers means FA cannot actually be interrupted mid-run today;
`faAnchors.ts`'s own header is stale in a way that isn't yet reflected anywhere else in the
docs; and the per-word English/cloud parity data needed to test the CTC-infeasibility hypothesis
exists but is missing the one field (per-chunk diagnostics) that would let anyone actually
compute the correlation.

---

## Open items (explicitly unresolved, evidence needed named per instruction)

1. The exact "eight frozen byte constants" / "four fixture digests" lists — no canonical
   source found; needs the task author to name them or confirm the ones checked in §V5c are
   the intended set.
2. R.7 clause 3 (CONF_MIN boundary-word rejection, fallback to run's own anchor) — absence of
   evidence, not confirmed absent; would need a broader repo-wide symbol search beyond
   `CONF_MIN`'s direct consumers (e.g. a differently-named wrapper) before calling it
   definitively unbuilt.
3. Corrupt/missing model weights and script/audio-mismatch failure modes — not independently
   re-verified this pass; the 2026-09-17 session's characterization is carried forward
   unchecked.
4. Very-long-audio behavior — still no measurement (unchanged finding from 2026-09-17); needs
   a real profiling run against a synthetic large project, which this read-only pass cannot
   produce.
5. Restart-mid-sync recovery behavior — not investigated this pass at all.
6. The FA replay gate's own two differently-partitioned census lines (21 open vs. 6/21
   unassigned) — not reconciled into one number this pass; needs a read of
   `scripts/ws1-session-ak-step1-gate.ts` and the register's own source to state a single
   authoritative open-row count.

---

**Commit SHA:** recorded after this file is committed (see chat reply for the final hash).
