# WS1 final verification sweep — 2026-09-18

> Fourth read-only pass over the WS1 sync pipeline. Answers the eight named gaps (W1-W8)
> left open across the three prior passes (`docs/architecture/fa-wiring-audit.md`,
> `docs/ws1-sync-pipeline/gap-closing-verification-2026-09-18.md`,
> `docs/ws1-sync-pipeline/final-shape-mapping-2026-09-18.md`). One docs-only report, this
> file. No source file and no other doc file was modified by this pass. Branch
> `ws1-plan-rewrite`, committed here, merge-only (never rebase), no push, no PR, no CI
> dispatch, no cloud spend, no network job. Nothing was deleted from tracked history.
>
> **New authorization for this pass only:** installing into untracked `node_modules/` and
> `src-tauri/target/` was permitted so gates and measurements could run fresh, instead of
> the inherited-green carried forward by the prior two passes. This authorization was used
> (`npm ci`, `cargo check`/`cargo test`); its results, including a genuine blocker it
> surfaced, are in §W8.

---

## Decision Log (conservative defaults, logged per instruction — never asked)

1. **This file itself is a new `.md` file under `docs/ws1-sync-pipeline/`, placed here
   because the task explicitly named this location and this filename convention.** §W8
   discovered, independently of this fact, that `scripts/ws1-single-tracker.test.ts` — the
   gate that enforces exactly one WS1 tracker — is **already failing on `HEAD`** because
   the previous two passes' own docs (`gap-closing-verification-2026-09-18.md`,
   `final-shape-mapping-2026-09-18.md`) were never added to that test's `ALLOWLIST`. This
   file becomes a third unlisted offender the moment it's committed. Not resolved
   unilaterally (the allowlist lives in a tracked test file, out of this pass's read-only
   remit, and silently editing the enforcement mechanism to make it pass would defeat the
   point of it) — logged here and flagged again in §W8 with exact evidence, for the
   architect to decide: fold all three into `docs/archive/history/work-in-progress.md` per
   the rule's own instructions, or extend `ALLOWLIST`.
2. **No live app / no Tauri runtime available.** W1's restart-mid-sync analysis and W2's
   failure-path analysis are both code-read + existing-test-read investigations, not new
   integration tests written this pass (writing new tests would touch tracked files,
   outside remit). Where a claim would need a live kill-and-relaunch to fully confirm (JS
   engine atomicity mid-object-construction, §W1 Phase 6), this is stated explicitly rather
   than asserted either way.
3. **W3's synthetic benchmark ran via a temporary, untracked test file
   (`scripts/tmp-w3-align-bench.test.ts`), created, run, and deleted within this session.**
   It called the real, unmodified `alignQueryToSubject` (`src/services/whisperService.ts`)
   through its existing `__ALIGN_INSTRUMENT__` hook — no source file was edited, and the
   harness left no trace on disk after this pass (confirmed by `git status --short`
   immediately after deletion, §W3). Logged rather than silently done, since it is a
   file-creation act even though transient and untracked.
4. **W6's "eight constants / four digests" candidate list is the one `final-shape-mapping`
   already proposed (§M3.12) and this pass re-verifies, not a re-derivation from scratch.**
   Continuity chosen over inventing a second candidate set — see §W6.
5. **Fresh cargo gates could not be completed** (§W8): a fresh worktree lacks the
   gitignored ffmpeg sidecar binary (`src-tauri/binaries/README.md`'s own documented
   provisioning step, which fetches a binary from `evermeet.cx` over the network).
   Conservative default: do not fetch it — this pass's own scope says "no network jobs,"
   and fetching and executing a third-party binary is exactly the class of action flagged
   as needing explicit authorization elsewhere. Recorded as a **blocked** gate with the
   exact error and the exact missing artifact named, not silently skipped and not
   worked around.
6. **`docs/archive/ws1/sync-pipeline-v2-plan-original.md`** — the one untracked file
   present at session start (from a prior pass) — left untouched, per the same convention
   both prior passes followed.

---

## Command log

```
git status --short / git log --oneline -1                       (HEAD = 6461ed3, clean tree)
npm ci                                                            (fresh node_modules, exit 0)
npx tsc --noEmit                                                  (exit 0, zero output)
npm test                                                          (exit 1: 3887 passed / 34 failed / 78 skipped, 3999 total; 241/13 files passed/failed)
cd src-tauri && cargo check                                       (exit 1 — build-script failure, see §W8)
cd src-tauri && cargo test                                        (exit 101 — identical build-script failure)
python3 scripts/phase4-restore-replay-inputs.py                   (exit — "missing ffmpeg sidecar", same root cause)
node --expose-gc node_modules/.bin/vitest run scripts/tmp-w3-align-bench.test.ts   (twice; file deleted after)
rm scripts/tmp-w3-align-bench.test.ts                             (untracked, git status confirmed clean after)
grep -rnE "\bCONF_MIN\b" src/ src-tauri/src/ scripts/             (W7, 57 hits, see below)
grep -rn "vocabCharsFromRawVocab" src/ scripts/                   (W4)
npx vitest run scripts/phase4-fa-replay.test.ts                   (W5, 50/50 passed, census re-derived)
git diff --stat eb1c4fa HEAD -- src-tauri/src/model_download.rs docs/architecture/cloud-asr-measurements.md cloud/ docs/architecture/cloud-asr-plan.md src/services/syncConstants.ts src-tauri/src/fa.rs   (W6, empty)
find / -iname "v6_16k.wav" -o -iname "v6_16k_cbr16k.opus" -o -iname "hour_16k.wav" -o -iname "hour_16k_cbr16k.opus"   (W6, zero hits anywhere on this machine)
```

Full `npm test` output logged to session scratchpad (`npm-test.log`), not `/tmp`, not
committed (scratch only, per the "no /tmp literals" / docs-only-report rule — it lives
under this session's Claude-managed scratchpad directory, not the repo's own `/tmp`
convention that rule targets).

---

## W1 — Restart mid-sync

**Never investigated in three prior passes.** The whole Apply Sync pipeline
(`handleApplySyncFromFiles`, `App.tsx:3678`) is **one long async function with a single
writeback**: every intermediate result (matched segments, FA output, rule-stage
corrections) lives in local closure variables, untouched by React state or disk, until the
one `setProject` at `App.tsx:4635` (committed `App.tsx:4673`). No `await` separates
matching from the rule stages from the coverage gate — they run as one synchronous JS turn.
This collapses several of the requested phases into one behavioral unit.

| Phase | On-disk state | Recovers on restart? | Lost | User-visible symptom | Test coverage |
|---|---|---|---|---|---|
| Mid-transcription | Staged audio at `$TMPDIR/kinetix-whisper-<uuid>/{input.<ext>,input_16k.wav}` (`whisper.rs:724,729`); staged file also in IndexedDB (`stagedFilesPersist.ts`); `transcriptTokens` already cleared (`App.tsx:3536-3539`) before Whisper starts | Staged file is re-offered (`App.tsx:4611-4620`) but **not auto-retranscribed** — `canAdoptRestoredVoiceover` (`stagedFilesPersist.ts:198-206`) requires a cache hit that can't exist mid-run | In-flight Whisper progress; the temp dir (no startup sweep exists — the only sweep, `lib.rs:523-546`, is export-session-only) | User re-clicks "Transcribe"; no stuck spinner (in-process single-flight registry dies with the process) | None found |
| Mid-FA-inference | FA input staged content-addressed at `kinetix-fa-production-inputs/<sha256>.<ext>` (`fa_dev.rs:519-559`), guarded by `if !input_path.exists()` (`fa_dev.rs:544`) — **existence, not completeness**; `fs::write` (`:545`) is not atomic. `FaModelCache` (`fa.rs:93-118`) is a bare in-process `Mutex<Option<CachedSession>>` — nothing to persist | No | FA compute; **and a real correctness hazard**: a kill mid-`fs::write` leaves a truncated file at the *final* content-addressed path, and a future run with byte-identical source audio will treat that truncated file as already-staged and never rewrite it | Silent — a later run could feed a corrupt WAV into `fa_align_production` with no signal | None found |
| Mid-matching / mid-rule-stage (R.10-R.15/R-AP) | Unchanged from the FA snapshot — no intermediate write of any kind exists between FA resolution and the final commit | No — nothing durable to recover; the stage recomputes from cached Whisper tokens (and FA, if not yet committed) on the next attempt | All matching/rule-stage work product, but **zero partial application** — this is the safest window in the pipeline precisely because nothing partial can leak into the committed `Project` | "Sync must run again" | None found (and none would be runtime-meaningful here beyond re-asserting a static code property) |
| Immediately before the atomic commit | Object literal at `App.tsx:4635-4661` not yet constructed | No | Whatever preceded it | Same as any abort path (`App.tsx:3762-3775`, `logSyncAbort`) | — |
| During the commit itself | **Statically undeterminable** whether V8 could be pre-empted mid-object-construction — genuinely needs a live test, not asserted either way here | N/A | N/A — a `SIGKILL` either catches the whole heap update or catches none of it; there is no partially-observable state since nothing is flushed to disk from this step regardless | — | Needs a live test |
| Immediately after the commit, before disk flush | Pre-sync project still on disk; persistence is a **debounced** effect (`usePersistProject.ts:169-182`, ~500ms after the state change) — no synchronous flush follows the sync commit specifically. The newly committed voiceover **asset** was already written to IndexedDB *before* the commit (`App.tsx:410-441`) | No — a kill inside the debounce window means the whole sync result never reaches disk | Entire sync result (segments, `faWordTimings`, sync log). The already-persisted voiceover asset becomes an **orphan** in IndexedDB — no sweep/GC logic found for this class | Project reopens looking completely unsynced (not half-synced, which is the better failure mode) — plus silent IndexedDB storage bloat from the orphan | None for a hard-kill window; `App.teardownFlush.test.tsx` covers only the graceful Cmd+R / window-close / Cmd+Q paths, and documents Cmd+Q's real completion as untestable from JS |

**Stale artifacts after a killed run, and what the next sync does with them:**
- `FaModelCache` (`fa.rs:93-118`) is purely in-process; nothing stale can survive — confirmed, no serialization path exists anywhere in `fa.rs`.
- Whisper staging dirs (`kinetix-whisper-<uuid>`) accumulate forever — fresh UUID every run, never reused, never swept.
- FA staging inputs are content-addressed and LRU-capped at 2 GiB (`fa_dev.rs:478,550`), so they don't grow unbounded, but the existence-only guard (`fa_dev.rs:544`) means a truncated file from a killed run can poison future runs with the same source bytes (above).
- The dev-only durable-WAV cache's `.tmp/` subdirectory (`fa.rs:847-871`) is explicitly excluded from the LRU eviction scan (`fa.rs:761-768`) — an orphan there has no cleanup path at all, though this path has no production caller today (`fa.rs:834`).

**Wave-1 implication, flagged explicitly.** `final-shape-mapping-2026-09-18.md:175,306-315`
(C5) proposes a `SyncPausedDialog` that "holds the run" so the user can retry/switch engine
"without re-transcribing." Given the pipeline shape above, a paused run can only mean the
async function is suspended in the JS heap (an in-process, in-tab pause) — every
intermediate result (FA output, matching, rule-stage corrections) is a local closure
variable with **no durable representation**. Only the Whisper transcript survives a reload
today (via `unappliedTranscript`/`transcriptTokens`). If C5's "resume without re-transcribing"
is meant to also skip re-running FA and the matching/rule stages across a page reload, that
is **not achievable with the current architecture** without C5 also adding durable
mid-pipeline state. If the pause is same-process/same-tab only (dialog stays open, no
reload), the promise holds as written. The plan doc does not currently distinguish these
two cases — flagged for the architect, not resolved here.

*(Full phase-by-phase file:line trail, including the Phase 6 JS-engine-atomicity reasoning,
was produced by a dedicated sub-investigation this pass; the table above is its
distillation. Every citation in it was independently traced against the current tree.)*

---

## W2 — Corrupt/missing model weights + script/audio mismatch

### The central finding: two different gating regimes exist side by side

**Whisper has no integrity gate on the transcription path at all.** `model_path()`
(`whisper.rs:590-652`) does an `.exists()` check only, at every fallback tier — never reads
a byte, never checks size or hash. Called at `whisper.rs:929`, immediately before
`spawn()` (`:969-980`). A truncated or bit-corrupted-but-full-size
`ggml-large-v3-turbo.bin` is handed straight to whisper-cli.

**FA gates use for real.** `verify_model_manifest` (`fa_dev.rs:284-360`: exact-size
precheck `:297-309`, full SHA-256 compare `:348-358`) is called at `fa_dev.rs:668`, inside
`resolve_wav_and_align`, **before** any audio transcode or ONNX session load. A mismatch
returns `Err(FaError{kind: ModelHashMismatch})` via `?`, aborting before the model is ever
used. This is the one open question from two prior passes, now answered definitively: **it
gates, it does not merely check at download time.**

The Settings-UI "Verified"/"Unverified" badge (`models.rs:392-478`, `checkInstalledModels`)
is a **third, independent, display-only path** — never called from `whisper_transcribe` or
`fa_align_*` — and even it can be fooled: `status_for_generic` (`models.rs:445-478`)
short-circuits to a stale `.sha256` sidecar file when present, skipping a fresh hash.

| Scenario | File:line | User-visible behavior | Test coverage |
|---|---|---|---|
| Whisper model missing | `whisper.rs:590-652`, call `:929` | Rejected `invoke` promise, literal string `whisper.rs:648-650` | None found |
| Whisper model truncated | No size check exists; whisper-cli fails on its own | Generic `"whisper exited with code {other}"` (`whisper.rs:453-455`), or **silent success on exit 0** if the corruption doesn't crash it | None found |
| Whisper model corrupted, same size | Same as above | Same, including the **undetectable silently-wrong-transcript** case (any exit-0 is `Done` regardless of content) | None found |
| FA pack missing | `fa.rs:617-633` (`fa_model_path`), `fa_dev.rs:662` | Fails clean to Whisper timing (`forcedAlignmentRun.ts:200-207`), sync-log entry only, **sync continues silently** — no toast | `fa.rs:1332-1354` (helper-level) |
| FA pack truncated/corrupted | `fa_dev.rs:284-360`, gated at `:668` | Same fail-clean path, message names exact size/hash mismatch | `fa_dev.rs:969-1017,1029-1067,1393-1467` — thorough |
| Partial/interrupted download | `model_download.rs:426-430` (`.part` file), `:1366-1399` (`finalize_verified_download`) — **verified**: a half-downloaded file only ever exists at `<target>.part`; `fs::rename` to the final name happens strictly after the verify closure succeeds (line 1394-1395, and the FA/import equivalents at `models.rs:590,595`) | No partial file can ever be mistaken for a complete one — confirmed by tracing the finalize/rename order, not assumed | `model_download.rs` extensive (resume/validator/race tests) |

**Script/audio mismatch** — `evaluateCoverageGate` (`App.tsx:1124-1143`), two thresholds:
`longestCoveredRun < MIN_COVERED_RUN_LENGTH` (`:1132`, constant = 2,
`syncConstants.ts:109`) catches total mismatch; `bidirectionalCoverage < NOISE_FLOOR_COVERAGE`
(`:1138`, constant = 0.1, `syncConstants.ts:119`) catches coincidental-overlap false
positives. Call site `App.tsx:4039`; on failure, toast + `logSyncAbort` + return before any
`setProject` — nothing committed. **Partial mismatch is explicitly not an abort case** —
`filterToCoveredSegments` (`App.tsx:1237-1271`) drops individual unmatched segments and
proceeds. Both scenarios are well covered: total mismatch in
`syncTiming.test.ts:1139,1810,1887,4269`; partial mismatch in
`syncTiming.test.ts:1165,1204-1379,4188,4204,4245,4255`.

---

## W3 — Long-audio measurement (numbers only, no threshold decision)

Ran the dormant `__ALIGN_INSTRUMENT__` path (`whisperService.ts:111-132`, hook at
`:339-386`) against the real, unmodified `alignQueryToSubject` via a temporary harness
(deleted after use, §Decision Log item 3), with synthetic scene-doc/transcript word
sequences at ~150 words/minute (a representative spoken-English rate), full-length,
unwindowed — the same call shape D1/D2 in `final-shape-mapping-2026-09-18.md` identified as
having **no bound of any kind**.

| Case | Query/subject words | Wall time (mean of 2 runs) | RSS delta | Analytic top-level cells (n·m) |
|---|---|---|---|---|
| 500-scene / 30-min | 4,500 / 4,500 | **≈3.03-3.13 s** | +14.8 to +16.6 MB | 20,250,000 |
| 1000-scene / 60-min (2×) | 9,000 / 9,000 | **≈11.5-13.1 s** | +2.8 to +6.5 MB (noisy — GC-dependent) | 81,000,000 |

**Scaling check:** doubling both dimensions quadruples the theoretical cell count
(20.25M → 81M, exactly 4×) and the measured wall time scaled **≈3.8-4.2×** (3.03-3.13s →
11.5-13.1s) — consistent with the documented O(n·m) cost, not a lower order. RSS delta was
not a clean, monotonic peak-memory signal: this benchmark measured `process.memoryUsage()`
immediately before and after the (synchronous, single-threaded) call, which cannot sample
*during* execution without instrumenting the algorithm itself — Node's event loop is
blocked for the full duration of a synchronous call, so no concurrent sampler can run. This
is reported as a limitation, not smoothed over: the wall-time and cell-count numbers are
solid; the memory numbers are a rough before/after delta, not a true measured peak.

**No threshold or bound decision is made here** — this section reports the two numbers the
task asked for (wall time, cells) plus an honest caveat on the third (peak memory); the
bound itself remains the architect's call, per the task's own framing.

---

## W4 — `vocabCharsFromRawVocab`

**Present, exact name and signature confirmed:**

```ts
// src/services/faTextNormalize.ts:129
export function vocabCharsFromRawVocab(rawVocab: Readonly<Record<string, number>>): Set<string>
```

Repo-wide grep for every call site outside its own definition file finds it consumed
**only by tests and offline generator scripts** —
`src/services/faTextNormalize.fixtureDrift.test.ts:31,61`,
`src/services/faTextNormalize.test.ts:21,33,576`, `src/services/faChunkPlan.test.ts:15,579,673`,
`scripts/generate-fa-text-fixture.ts:29,58`, `scripts/generate-fa-e2e-tokens.ts:43,138` — **zero
hits in any production call path** (`App.tsx`, `forcedAlignmentRun.ts`). This confirms, at
the exact function this pass was asked to locate, the same finding `final-shape-mapping`'s
§M3.9 made from a different angle: the function exists and works, but nothing in production
ever loads a real `vocab.json` and calls it — the missing piece is a runtime data loader,
not a forgotten function.

---

## W5 — FA replay gate census reconciliation

**Not a reconciliation failure — one of the two log lines has a misleading label, and the
underlying numbers were never actually in conflict.** Full trail (re-run this pass,
`npx vitest run scripts/phase4-fa-replay.test.ts`, 50/50 passed, unchanged since the prior
pass):

- **`REGISTER_ROSTER`** (`.length === 35`) — every ear-pass item that has ever entered the register, append-only.
- **`KNOWN_BAD`** (`.length === 21 === REGISTER_HIGH_WATER`, `phase4-fa-replay.test.ts:1146`) — the roster minus everything already closed against the frozen fixture. Splits into `status === 'open'` (**6** rows) and `status === 'fixed'` (**15** rows, fixed against the *live* path but not yet convertible to a closed fixture assertion — see the file's own doc comment, lines 308-338).
- **`CLOSED_BY_POSITIVE_ASSERTION`** (`.length === 14`).
- Arithmetic: 6 + 15 = 21 = `KNOWN_BAD.length`; 21 + 14 = 35 = roster total. Nothing is inconsistent.

**The "21 open" print** (`phase4-fa-replay.test.ts:1470-1474`) labels `KNOWN_BAD.length`
(open **+** fixed) as `OPEN` — that label is simply wrong; 15 of those 21 are `fixed`, not
open. **The "6/21 unassigned" print** (`:1638-1650`) correctly filters `status === 'open'`
(`open.length === 6`, line 1639) and groups those six by `owningRule`, which happens to be
`'unassigned'` for all six today — hence "6/21."

**Single authoritative open-row count: 6** — `classA-214-solitary-fire`,
`classA-231-slowing-pace`, `classA-447-scout-facing-dark`, `classB-400-endless-dark`,
`x173-lethal-nature-hazard`, `x173-gadget-decay`. The "21" and "14" are real, correctly
computed, differently-scoped numbers (unresolved-against-fixture, and closed-against-fixture,
respectively) — not competing answers to the same question. The only defect is
`phase4-fa-replay.test.ts:1471`'s own log string calling `KNOWN_BAD.length` "OPEN" — a
one-line clarity bug in a test's `console.log`, zero effect on pass/fail, not fixed here
(read-only remit) but now precisely named instead of left as an unresolved discrepancy.

---

## W6 — Frozen assets, final form

**(a) SHA-256 digests of the four pinned fixtures.** All four
(`v6_16k.wav`, `v6_16k_cbr16k.opus`, `hour_16k.wav`, `hour_16k_cbr16k.opus`) are **absent**
from this machine entirely — `find / -iname "<each name>"` (excluding permission-denied
paths) returned zero hits anywhere, not just in the repo (they live in the gitignored
`cloud/fixtures/`, per `.gitignore:59` and `cloud/README.md:25`). **Digests cannot be
recorded this pass.** Procedure to capture them, next time the source audio and a working
ffmpeg sidecar are both available:
```
./cloud/prepare_fixtures.sh   # regenerates the four files under cloud/fixtures/
shasum -a 256 cloud/fixtures/v6_16k.wav cloud/fixtures/v6_16k_cbr16k.opus \
              cloud/fixtures/hour_16k.wav cloud/fixtures/hour_16k_cbr16k.opus
```
This is currently blocked in this environment by the same missing ffmpeg sidecar binary
identified independently in §W8 (`prepare_fixtures.sh` itself failed with
`missing ffmpeg sidecar: .../src-tauri/binaries/ffmpeg-x86_64-apple-darwin` when actually
attempted this pass, before any digest step was reached).

**(b) One canonical location, proposed.** Creating a *new* file for this list would add a
**fourth** offender to the already-broken single-tracker gate (§W8, §Decision Log item 1).
The consistent choice, given that gate's own remedy instructions ("add new WS1
status/decision/slice content to `work-in-progress.md` §1-§11 instead of creating a new
file," or extend the allowlist for a genuine non-tracking data record): append the eight
constants + four fixture rows as a small new Part to
`docs/ws1-sync-pipeline/sync-pipeline-v2-plan.md` — already on the allowlist, already the
design-of-record document, already carries an analogous append-only "Part M" pointer
pattern. This is a proposal only; nothing was written there this pass (read-only remit).

**(c) Re-verified: empty diff on all eight, current `HEAD` (`6461ed3`) vs. audit base (`eb1c4fa`).**
```
git diff --stat eb1c4fa HEAD -- src-tauri/src/model_download.rs \
  docs/architecture/cloud-asr-measurements.md cloud/ docs/architecture/cloud-asr-plan.md \
  src/services/syncConstants.ts src-tauri/src/fa.rs
```
→ **empty.** Every value re-read at its live line this pass, matching `final-shape-mapping`'s
§M3.12 table exactly:

| # | Value | Source (re-confirmed) |
|---|---|---|
| 1 | 1,624,555,275 | `MODEL_SIZE_BYTES`, `model_download.rs:140` |
| 2 | 6,312,776,755 | Five FA packs total, `cloud-asr-plan.md:13,96` |
| 3 | 7,937,332,030 | Whisper + all five packs, `cloud-asr-plan.md:96` |
| 4 | 32,851,696 | V6 source `6.m4a`, `cloud-asr-measurements.md:54` |
| 5 | 45,481,468 | `v6_16k.wav`, `cloud-asr-measurements.md:63` |
| 6 | 2,952,316 | `v6_16k_cbr16k.opus`, `:64` |
| 7 | 115,200,078 | `hour_16k.wav`, `:65` |
| 8 | 7,477,405 | `hour_16k_cbr16k.opus`, `:66` |

`MODEL_SHA256` (`model_download.rs:141`) and `CONF_MIN` (`syncConstants.ts:536`, `fa.rs:416`)
were also re-checked in the same diff and are likewise unchanged.

---

## W7 — R.7 clause 3 closure evidence

**`CONF_MIN` has no production consumer implementing R.7 clause 3.** Exhaustive
word-boundary grep (`grep -rnE "\bCONF_MIN\b" src/ src-tauri/src/ scripts/`, chosen
specifically to exclude `CONF_MIN_FALLBACK` and `CONF_MIN_MIRROR`) returned **57 hits**.
Classified: 2 definitions (`syncConstants.ts:536`, `fa.rs:416`), 1 cross-language
drift-guard test (`fa.rs:2156-2188`), **exactly one genuine runtime consumer**
(`fa.rs:428-437`, `word_span_to_dto`: `needs_review: confidence < CONF_MIN` — a per-word
UI-review label, applied uniformly to every word, not specifically first/last-of-run, and
with no fallback substitution since no Whisper timing is available at that IPC boundary to
fall back to), and the remaining 54 are doc comments, test-fixture-builder mirrors, or
distinctness assertions (none of which execute against production data).

Tracing the one genuine consumer downstream: `faBoundaryTypes.ts:133-141` copies the flag
verbatim into `TranscriptToken.needsReview`; its sole production caller
(`forcedAlignmentRun.ts:191-193`) returns it unfiltered; `App.tsx:3961` never reads it
per-word. The UI's only other `needsReview` consumers (`Timeline.tsx:578`,
`ReviewMappingModal.tsx:173`, `DropZonePanel.tsx:1691`) all key off a **different**, unrelated
`HeadingOverlay.needsReview` field (`headingLayer.ts:31`). A broader search for the clause-3
behavior under a different name — `runAnchor`, `"run's own anchor"`, first/last-word
confidence checks near `faAnchors.ts`/`faChunkPlan.ts` — found nothing; `faAnchors.ts`
(where "run's own anchor" logic lives) runs strictly pre-FA by its own doc comment
(`:17-21`) and never reads confidence at all.

**The retirement ruling now rests on an exhaustive, word-boundary-precise grep plus a full
downstream trace, not on the ruling's own assertion** — proof, as the task required, not
just a restated ruling.

---

## W8 — Fresh gates

| # | Gate | Result |
|---|---|---|
| 1 | `npx tsc --noEmit` | **Clean.** Exit 0, zero output, fresh `node_modules` (`npm ci`, not inherited). |
| 2 | `npm run lint` | **Identical to gate 1** — `package.json`'s `"lint"` script is literally `tsc --noEmit` (confirmed by reading `package.json`); not a second, independent check. |
| 3 | `npm test` | **Exit 1. 241/317 test files passed, 13 failed. 3887/3999 tests passed, 34 failed, 78 skipped.** Root-caused, not just counted: **12 of the 13 failing files** (`phase4-handoff-replay-sync.test.ts`, `ws1-production-path.test.ts`, `ws1-session-aj0-oracle-diff.test.ts`, `ws1-session-p-arms.test.ts`, `ws1-session-p-invariants.test.ts`, `ws1-session-p-measure.test.ts`, `ws1-session-q-invariants.test.ts`, `ws1-session-q-production-pins.test.ts`, `ws1-session-s-exclusion.test.ts`, `ws1-session-s-measure.test.ts`, `ws1-silence-arms.test.ts`, `ws2-27-absorption-numbering.test.ts`) fail with the identical root cause — a missing `.work-phase4/replay/<project>/*.json` fixture, absent in a genuinely fresh worktree and regenerable per the failing tests' own error text via `python3 scripts/phase4-restore-replay-inputs.py`, which this pass ran and confirmed **also fails**, for the same underlying reason as the cargo gates below (missing ffmpeg sidecar — see gate 4). **The 13th failing file is a real, independent regression**, not an environment artifact: `scripts/ws1-single-tracker.test.ts`'s single test fails because `docs/ws1-sync-pipeline/final-shape-mapping-2026-09-18.md` and `docs/ws1-sync-pipeline/gap-closing-verification-2026-09-18.md` — both already committed to `HEAD` before this pass started — are not in that test's `ALLOWLIST` (`scripts/ws1-single-tracker.test.ts:30-59`). **Neither prior pass's own "npm test: exit 0" claim was ever re-verified against the tree state it actually left behind**: the gap-closing pass ran its gates *before* its own doc was committed, and the final-shape-mapping pass explicitly skipped re-running gates (its own Decision Log item 2). This is the first time anyone has run `npm test` against the tree both docs actually left on disk — and it was broken the whole time. Not fixed here (read-only for tracked files; the allowlist is a tracked test file) — named precisely instead, per §Decision Log item 1. |
| 4 | `cargo check` (src-tauri) | **BLOCKED, not clean.** `error: failed to run custom build command for app v0.1.0` — `resource path 'binaries/ffmpeg-x86_64-apple-darwin' doesn't exist`. Confirmed real and reproducible (ran directly, exit captured). Root cause: `src-tauri/binaries/` is gitignored (`src-tauri/binaries/README.md`) and this is a **genuinely fresh worktree** (`node_modules`/`target` both absent at session start, confirmed) — the single package's `build.rs` (`fn main() { tauri_build::build() }`) validates the `externalBin` resource declared in `tauri.conf.json` on *every* invocation, for *any* target. **This is a fresh finding neither prior pass could have hit**, because both explicitly ran their gates from the already-provisioned `main` checkout, never from a bare worktree (final-shape-mapping's own Decision Log item 2 says so outright: "This worktree has no `node_modules` and no `src-tauri/target`... running them from the main checkout would require leaving this worktree"). This pass's new authorization to install into `src-tauri/target/` did not, and could not, fix this — the blocker is a missing *resource file*, not a missing build cache. |
| 5 | `cargo test` (src-tauri) | **BLOCKED, identical cause.** Ran directly to confirm rather than assume it would fail the same way: exit code **101** (cargo's standard compile-failure exit), same `resource path ... doesn't exist` error, same build-script failure — reproduced independently of gate 4, not inferred from it. |
| 6 | `cargo test --features fa-inference` / `cargo build --release --features fa-inference` | **Not run — would hit the identical build-script failure before compiling a single line of feature-gated code**, since `build.rs`'s resource check runs unconditionally for the `app` package regardless of features or profile. Running them would have reproduced gate 4's exact error a second and third time for zero new information; not worth the wall-clock cost of a release build to confirm a certainty. |

**No download was attempted to unblock gates 4-6.** `src-tauri/binaries/README.md`'s own
documented remedy is `curl -L -o /tmp/ffmpeg.zip https://evermeet.cx/ffmpeg/getrelease/zip`
— fetching and executing a third-party binary, which this pass's own scope ("no network
jobs") and the standing safety rule against "downloading or executing files from untrusted
sources" both rule out. This is recorded as a genuine environmental gap the "fresh gates"
authorization surfaced, not a gate this pass could close.

**Net effect on the "gates green" question:** gates 1-2 are fresh-green. Gate 3 is
fresh-run but not green, for one environment-shaped reason (12 files) and one real
regression (1 file, 1 test) that predates this pass and was invisible until a truly fresh
`npm test` actually ran against `HEAD`. Gates 4-6 could not run at all in this environment,
for a reason (missing sidecar binary) that is itself new information: no prior "cargo check:
Clean" claim in this repo's WS1 docs was ever obtained from a fresh worktree, only from an
already-provisioned checkout — so "inherited green" was inheriting an environment
assumption, not just a code state, and that assumption does not hold for a bare clone or
worktree.

---

## Summary — what this pass found, in one paragraph

Every one of the eight named gaps now has either a definitive answer or a precisely-named
missing piece, with file:line evidence throughout. The two most consequential findings are
outside the eight questions' literal wording but fall directly out of answering them
honestly: first, **a real, currently-live regression** — the WS1 single-tracker
enforcement test has been broken since the moment the second of the last two verification
docs was committed, undetected because neither pass re-ran the full suite against the tree
it actually left behind, and this pass's own new note becomes a third offender against the
same broken gate the moment it's committed (§Decision Log item 1, §W8). Second, **the
"fresh gates" authorization itself surfaced a fresh-checkout onboarding gap**: a truly bare
worktree cannot compile the Rust side at all without a manual, network-sourced binary
provisioning step that this pass correctly declined to perform, meaning three of the six
requested gates could not be run to completion in this environment, full stop — not
skipped, not assumed, genuinely blocked, with the exact missing artifact named. Substantively:
restart-mid-sync has a real correctness hazard (a killed FA run can poison a future run's
staged-audio cache via an existence-only, non-atomic write guard) alongside several
already-safe windows; Whisper has zero integrity gating on model weights while FA gates
correctly; the FA replay census's two headline numbers were never actually in conflict, only
mislabeled; `vocabCharsFromRawVocab` exists and works but has no production caller;
`CONF_MIN`'s retirement for R.7 clause 3 now rests on an exhaustive grep, not a restated
ruling; the eight frozen constants remain byte-identical since the audit base; and none of
the four pinned fixtures exist anywhere on this machine, blocked from regeneration by the
same missing ffmpeg sidecar that blocks the cargo gates.

---

## Open items (explicitly unresolved, missing evidence named)

1. **The single-tracker gate regression** (§W8, gate 3, §Decision Log item 1) — needs an
   architect decision: extend `ALLOWLIST` in `scripts/ws1-single-tracker.test.ts` for all
   three affected files (including this one), or fold their content into
   `docs/archive/history/work-in-progress.md` per the rule's own stated remedy. Not
   resolved here — editing that test file is outside this pass's read-only remit for
   tracked files.
2. **The ffmpeg sidecar binary** (`src-tauri/binaries/ffmpeg-x86_64-apple-darwin`) is
   missing in this worktree and cannot be fetched under this pass's "no network jobs"
   scope. Blocks: `cargo check`/`cargo test`/`cargo build` (gates 4-6),
   `scripts/phase4-restore-replay-inputs.py` (and therefore 12 of the 13 failing `npm test`
   files), and `cloud/prepare_fixtures.sh` (and therefore the four fixture digests, §W6a).
   All three blockers are the *same* missing artifact — provisioning it once (per
   `src-tauri/binaries/README.md`'s own instructions, an explicit, authorized action)
   would very likely close all of them in one step, but that action needs sign-off this
   pass's scope does not grant.
3. **W6(b)'s canonical-location proposal** (append a new Part to
   `sync-pipeline-v2-plan.md`) is a proposal, not an implemented change — nothing was
   written there this pass.
4. **W1's Phase 6** (JS-engine atomicity of the `setProject` object-literal construction
   under a mid-construction `SIGKILL`) is stated as genuinely undeterminable from static
   reading, not resolved either way — would need a live kill-and-inspect test, which this
   read-only pass could not produce.

---

**Commit SHA:** recorded after this file is committed (see chat reply for the final hash).
