# Prompt 37 — rebase-and-wire plan

**When:** CC's storage branch has landed on the integration trunk. Not before.
**Onto:** `ws3-storage-unified` (name from the parallel-lane brief). **UNSEEN on this remote** as of `79efbb2` — `git branch -a` has no `ws3-storage-unified`. Confirm the landed ref at rebase time (`git fetch` + the merge commit / branch the operator names). Do not guess a substitute.
**From:** `ws3-export-modal` @ `79efbb2` (this plan's tree). Fast-forward only this branch after the rebase; no extra PR.
**Lane split (unchanged):** this file does not implement anything. It is the checklist so prompt 37 is mechanical. Do not touch `src-tauri/**`, `useExport.ts`, `exportPipelineWebCodecs.ts`, `exportWorker.ts`, `exportResumeDiscovery.ts`, `hardwareCodecLadder.ts`, or `docs/ws3-export/*.md` until the rebase is authorized — several steps below *are* edits to `useExport.ts` / `App.tsx` / estimator imports; they happen **on the rebase**, not before.

Every **UNSEEN** tag is an assumption that depends on files this tree does not contain. Resolve each by opening the named path on the storage tip before that step.

---

## 0. Order of operations

1. Record CC's tip SHA and `npx vitest list` / `npm test` totals (local + cloud if a cloud run exists). These are `L_*` / `C_*` below. Do not use this branch's 3751/3752 as CC's numbers.
2. `git rebase <cc-tip>` onto `ws3-export-modal`. Do not rebase onto `main`.
3. Duplicate-estimator resolution (§1).
4. Invoke-name alignment (§2). App already binds `createInvokeExportTargetFs(invoke)` on Tauri — this is a name/args check, not a rewrite of the modal.
5. Double-picker removal (§3). This *is* a `useExport.ts` edit; it is the rebase.
6. Recount tests as identities (§4). Do not publish a single combined figure.
7. `npx tsc --noEmit`, then `npm test`. Cargo tests are CC's; run them if Step 3b/4 added any, do not invent counts.

Conflict policy: **CC wins on the size formula.** This branch wins on modal UI, bitrate selector helpers, `ExportTargetFs` + fake, and the 8 contract tests. `useExport.ts` / pipeline files should not conflict if this branch kept the freeze (it did not edit them). If they do, stop — that is not mechanical.

---

## 1. Duplicate estimator

### 1.1 What this branch owns today

| Path | Role |
|---|---|
| `src/services/exportOutputEstimate.ts` | Bitrate selector (`DEFAULT_EXPORT_BITRATE_KBPS` = 8000, min 1500, max 8000, step 500, `exportBitrateKbpsOptions`, `snapExportBitrateKbps`) **and** `estimateExportOutputBytes` (the formula CC owns). |
| `src/services/exportOutputEstimate.test.ts` | **10** tests (listed in §1.3). |
| `src/components/ExportSettingsModal.tsx` | Imports `estimateExportOutputBytes`, `exportBitrateKbpsOptions`, `DEFAULT_EXPORT_BITRATE_KBPS`. |
| `src/components/ExportSettingsModal.test.tsx` | Imports `estimateExportOutputBytes` + `DEFAULT_EXPORT_BITRATE_KBPS` for the live badge. |
| `src/App.tsx` | Imports `DEFAULT_EXPORT_BITRATE_KBPS` only. |

**UNSEEN:** CC's module path, export names, and whether it also ships the selector grid. At rebase: `git ls-tree -r --name-only <cc-tip> -- '*.ts' '*.tsx'` and `rg -n '355_320_000\|1_720_320_000\|estimateExport' <cc-tip>`. Expected shape is “one canonical estimator module”; do not assume it is named `exportOutputEstimate.ts`.

### 1.2 Proof the swap is a no-op on this implementation

Formula in `exportOutputEstimate.ts` (current `estimateExportOutputBytes`):

```
videoBytes            = ceil(bitrateKbps × 125 × durationSeconds)
audioBytes            = hasAudio ? ceil(durationSeconds × 24_000) : 0
                        (24_000 = EXPORT_DISK_AAC_BYTES_PER_SECOND)
estimatedFileBytes    = videoBytes + audioBytes
destinationRequiredBytes = applyHeadroom(estimatedFileBytes)
                        = ceil(estimatedFileBytes × 1.10) + 64 MiB
```

`fps` and `resolution` are recorded on the result and do not enter the byte term.

Worked example, 28-minute 1080p30, `hasAudio=true`, `D = 1680`:

| kbps | videoBytes | audioBytes | **estimatedFileBytes** |
|---|---|---|---|
| 1500 | 1500 × 125 × 1680 = 315,000,000 | 24,000 × 1680 = 40,320,000 | **355,320,000** |
| 3000 | 3000 × 125 × 1680 = 630,000,000 | 40,320,000 | **670,320,000** |
| 8000 | 8000 × 125 × 1680 = 1,680,000,000 | 40,320,000 | **1,720,320,000** |

8000 kbps video term = `EXPORT_DISK_VIDEO_BYTES_PER_SECOND × 1680` = `1_000_000 × 1680` = 1,680,000,000 (today's fixed 8 Mbps preflight). Selector default is 8000, so the default badge is output-neutral vs current encoder.

Locked by `src/services/exportOutputEstimate.test.ts` describe `estimateExportOutputBytes — 28-minute 1080p30 worked examples`, measured green on this tree (`vitest -t "28-minute"` → 3 passed / 7 skipped). After the import retarget, the same three assertions must stay green against **CC's** function. If any of 355,320,000 / 670,320,000 / 1,720,320,000 moves, the swap is not a no-op — stop and diff CC's formula against the table above. Do not re-baseline the triplet.

### 1.3 The ten tests — survive vs delete

File: `src/services/exportOutputEstimate.test.ts`.

#### Survive as importers of CC's module (3)

Keep the tests. Change only the import of `estimateExportOutputBytes` (and any input/result types it needs) to CC's module. Leave the assertion values untouched.

| # | Full name | Why it survives |
|---|---|---|
| 8 | `estimateExportOutputBytes — 28-minute 1080p30 worked examples > 1500 kbps → 355,320,000 B` | Frozen triplet. |
| 9 | `… > 3000 kbps → 670,320,000 B` | Frozen triplet. |
| 10 | `… > 8000 kbps → 1,720,320,000 B (today's default, output-neutral)` | Frozen triplet. |

If CC's function name differs, alias in the test import (`estimateExportOutputBytes as …` or `import { ccName as estimateExportOutputBytes }`). If CC's result uses a different field than `estimatedFileBytes`, read that field **and still assert the three integers**. Do not rewrite the numbers.

**UNSEEN:** CC's exact export name and result shape. If CC already has these three assertions, delete ours (do not double-lock). Search the storage tip for `355_320_000` / `355320000` before keeping them.

#### Deleted (4) — formula-ownership, CC's job

| # | Full name | Why deleted |
|---|---|---|
| 4 | `estimateExportOutputBytes — formula > videoBytes = bitrateKbps × 125 × durationSeconds; audio = 24_000 B/s when hasAudio` | Derivation of the formula. |
| 5 | `… > omits AAC when hasAudio is false` | Formula branch. |
| 6 | `… > fps and resolution do not change the byte term at a fixed bitrate` | Formula independence. |
| 7 | `… > at 8000 kbps the video term equals today's fixed 8 Mbps preflight` | `diskFull.ts` pin; CC owns coupling to the preflight. |

**UNSEEN:** whether CC's Step 3b/4 suite already covers #5–#7. If a deleted case is absent from CC's tests after rebase, **promote that one case to an importer** rather than leave a hole. Default is delete; promotion is only for a case CC did not write.

#### Stay on this lane — not CC importers (3)

These test the bitrate **selector**, which this branch shipped for the modal. They are not the size formula. They keep importing from this branch's remaining helper module (see §1.4). They do **not** import CC's estimator unless CC also shipped the same helpers (**UNSEEN**).

| # | Full name | Helpers under test |
|---|---|---|
| 1 | `export bitrate selector grid > is generated from min/max/step — not a hardcoded option table` | `exportBitrateKbpsOptions` |
| 2 | `… > defaults to today's 1080p encoder target (8000 kbps = 8_000_000 bit/s)` | `DEFAULT_EXPORT_BITRATE_KBPS` / `_BPS` |
| 3 | `… > snaps onto the 500 kbps grid and clamps to [1500, 8000]` | `snapExportBitrateKbps` |

If CC's module **does** export the same selector constants/functions, delete our helpers and retarget these three as importers of CC's module (same rule as #8–#10). Do not leave two grids.

Net of the ten: **3 importers + 4 deleted + 3 selector-stay** = 6 tests remain in this file (or 3 if CC already has the triplet; or 9 if CC is missing #5–#7 and those are promoted).

### 1.4 Code edits (rebase only)

1. Delete `estimateExportOutputBytes` / `ExportSizeEstimateInput` / `ExportSizeEstimate` / `defaultBitrateMatchesDiskModel` from `exportOutputEstimate.ts` **once CC's equivalents are imported**.
2. Keep selector exports in that file (or rename to `exportBitrateSelector.ts` if the filename would collide with CC's — **UNSEEN**).
3. Retarget `estimateExportOutputBytes` imports:
   - `src/components/ExportSettingsModal.tsx`
   - `src/components/ExportSettingsModal.test.tsx` (badge still asserts 355,320,000 / 670,320,000 via `formatBytes`)
   - the three surviving tests in `exportOutputEstimate.test.ts`
4. Do **not** add a second video/audio byte formula. Allowed thin wrapper, only if CC's return type is missing a field the modal already reads:
   - Modal reads `estimate.estimatedFileBytes` (badge) and `estimate.destinationRequiredBytes` (free-space disable) and `estimate.bitrateKbps` (commit).
   - **UNSEEN:** whether CC returns `destinationRequiredBytes` (`applyHeadroom`). If not, wrap: `destinationRequiredBytes: applyHeadroom(cc.estimatedFileBytes)`. That wrapper is not a duplicate formula.
5. Do not thread bitrate into `exportWorker.ts` / `useExport.ts` in this prompt. Encoder stays `EXPORT_BITRATE = 8_000_000` until CC takes that. **UNSEEN:** whether storage already threads bitrate; if it does, do not revert it.

---

## 2. Invoke swap — fake → real Tauri

The modal never imports `@tauri-apps`. Production already goes through `createInvokeExportTargetFs`. The prompt-37 fake is a **test double of that invoke**, not the App Tauri path.

### 2.1 What is already wired (do not re-architect)

`src/App.tsx` (~3214–3216):

```
isTauri()
  ? createInvokeExportTargetFs(invoke)
  : createFakeExportTargetFs({ pickedDirectory: null, freeSpace: null })
```

- Tauri desktop: `invoke` from `@tauri-apps/api/core`, three command names below.
- Browser / cloud Vite: thin `createFakeExportTargetFs` (programmed nulls so Export stays disabled until a folder is picked). Not `createExportTargetFsFake`.
- Contract tests: `createExportTargetFsFake` in `src/services/exportTargetFsFake.ts`, consumed only by `exportTargetFsFake.contract.test.ts`. Keep that file. It is how cloud stays green with no Rust.

`createInvokeExportTargetFs` (`src/services/exportTargetFs.ts` ~147–160) binds:

| `ExportTargetFs` method | Invoke name | Args |
|---|---|---|
| `pickOutputDirectory` | `export_pick_output_directory` | `{ currentDirectory: string \| null }` → `string \| null` |
| `queryVolumeFreeSpace` | `export_volume_free_space` | `{ targetPath: string }` → `VolumeFreeSpaceReading \| null` |
| `validateOutputPath` | `export_validate_output_path` | `{ directory, fileName }` → `OutputPathValidation` |

Same three strings are exported from `exportTargetFsFake.ts` as `EXPORT_PICK_OUTPUT_DIRECTORY` / `EXPORT_VOLUME_FREE_SPACE` / `EXPORT_VALIDATE_OUTPUT_PATH`. They must stay byte-identical to the adapter.

### 2.2 Mechanical swap

1. On the storage tip, confirm the three **commands exist** and are registered in `src-tauri/src/lib.rs`. **UNSEEN:** this tree (pre-storage) has none of those three names. It has:
   - `pick_save_path` (`ffmpeg.rs` ~1759) — **save-file** dialog, not a folder picker.
   - `ffmpeg_volume_free_space` (`ffmpeg.rs` ~356) — `{ sessionId, destPath }` → `Vec<VolumeFreeSpace>`, requires a live session.
2. If CC implemented exactly the three names and arg shapes in the table: **zero TS adapter edits.** App's Tauri branch starts working. Contract tests stay on the fake.
3. If CC used different names or args (likely wrapping Round 21 `ffmpeg_volume_free_space`): edit **only** the string literals / argument packing inside `createInvokeExportTargetFs`. Do not change `ExportTargetFs` consumers (`ExportSettingsModal`, tests). Map CC's native shape onto `VolumeFreeSpaceReading | null` and `OutputPathValidation` there.
4. Do not point App at `createExportTargetFsFake` on Tauri. Fake `invoke` is for tests. Real `invoke` is for `isTauri()`.
5. After rebase, one smoke path in `tauri:dev`: Browse → folder appears; free-space line populated; Export with a legal path does **not** throw `command export_* not found`.

**UNSEEN (resolve before step 3):**

- Whether CC's folder picker is `export_pick_output_directory` or a new `rfd` pick-folder next to `pick_save_path`.
- Whether volume query is a new no-session command or a wrapper that still needs `sessionId` (the modal queries **before** `startExport` creates a session — a session-scoped command cannot back the badge). If CC's command requires `sessionId`, that is a blocker; do not call `ffmpeg_volume_free_space` from the modal as-is.
- Whether `export_validate_output_path` exists; this tree has no such command.
- Whether CC's `VolumeFreeSpace` struct fields match `VolumeFreeSpaceReading` (`path`, `probedPath`, `volumeKey`, `availableBytes`).

Cancel mapping: `pickOutputDirectory` returning `null` is user-cancel. Modal `handleBrowse` already ignores null (`if (picked) setDraftDirectory(picked)`). Preserve that.

---

## 3. Double-picker removal

Two pickers fire today for one Export click. Keep the modal folder picker. Remove the save-file dialog inside `startExport`.

### 3.1 Call site A — keep (modal Browse)

| | |
|---|---|
| File | `src/components/ExportSettingsModal.tsx` |
| Function | `handleBrowse` (~153–163) |
| Call | `await targetFs.pickOutputDirectory(draftDirectory \|\| null)` |
| Bound from | `App.tsx` `targetFs={exportTargetFs}` (~6982) |
| Opens from | Browse button in the modal, not from Export |
| Cancel | `null` → directory unchanged |

Export itself does **not** pick. `handleExport` (~165–174) commits `pureValidation.fullPath` as `choice.outputPath`.

### 3.2 Call site B — remove (startExport save dialog)

| | |
|---|---|
| File | `src/hooks/useExport.ts` |
| Function | `startExport` (~952–996) |
| Call | `await invoke<string \| null>('pick_save_path', { defaultName, defaultDir })` (~964–967) |
| `defaultName` | `${project.name.replace(/\s+/g, '_')}_${ts}.mp4` — **a second, different name** than the modal's `defaultExportFileName` / draft |
| `defaultDir` | `parentDir(project.lastExportPath)` (~961–963) |
| Cancel | `if (!savedPath) return` (~968) — abandons the run after the modal already committed |

`retryExport` (~1071–1078) does **not** pick; it replays `lastSnapshotRef.savedPath`. Leave retry alone.

### 3.3 How the two are chained (App)

1. Sidebar Export (`App.tsx` ~6720) only opens the modal (`setShowExportSettingsModal(true)`). No picker.
2. Modal Export (`App.tsx` `onExport` ~6983–6990):
   - writes resolution / fps / bitrate state
   - `onExportSavePath(choice.outputPath)` → `project.lastExportPath =` the **full file path** the modal validated
   - `setExportTriggerCount(c => c + 1)`
3. Effect (`App.tsx` ~3245–3247) calls `startExport()` on the next render so `useExport` closes over the new resolution/fps.
4. `startExport` then opens `pick_save_path` anyway.

That is the double picker. Comments at `App.tsx` ~6969–6970 already name it.

### 3.4 Mechanical removal (rebase; this is the `useExport.ts` edit)

In `startExport`, replace the `pick_save_path` block with: use `project.lastExportPath` as `savedPath` when it is a non-empty full path (the modal just wrote it). Keep `checkExportDestinationPathLength(savedPath)` and `onSavePath` / `runExport` as they are.

- If `lastExportPath` is missing: do **not** fall back to `pick_save_path` for the modal flow (that restores the double picker). Fail closed with a destination error. The modal already refuses Export with no folder (`canExport` / test `disables Export when no folder is selected`).
- Do not mint a new timestamped `defaultName` in `startExport`. The file name is the modal's.
- `src/dev/webcodecsStep2Spike/main.ts` calls `startExport()` directly (~2478, ~2563, ~2681) and intercepts `pick_save_path`. **UNSEEN** whether that harness must keep a save dialog. If it still needs one, give `startExport` an optional explicit path argument and have the harness pass it — do not keep `pick_save_path` on the production path to serve the spike.
- Bitrate in App state is still not passed into `useExport(project, exportResolution, exportFps, …)` (~3233). Out of scope unless CC already added the arg (**UNSEEN**).

---

## 4. Post-rebase test totals — identities, not one number

Do not assert a single combined collected/passed figure. CC's Step 3b/4 **UNSEEN** count of Rust + TS tests will move the base.

### 4.1 Measure CC first (storage tip, before rebase)

```
L_pass, L_fail, L_skip, L_collect   = local  npm test on CC's tip
C_pass, C_fail, C_skip, C_collect   = cloud  npm test on CC's tip   (if none, leave C_* blank)
R_pass, R_fail                      = cargo test on CC's tip        (Step 3b/4 Rust)
```

**UNSEEN:** all of those. This remote does not have the storage branch, so they cannot be filled in this file.

Cloud on **this** branch at the freeze (`cf3745f` / modal commit `f81674e`): 3630 passed / **35 failed** / 78 skipped = 3743, plus 8 contract tests at `79efbb2` → **3638 / 35 / 78 = 3751**. Failure set is the 35 names + `scripts/ws1-session-p-arms.test.ts` in `.cursor/cloud-expected-failures.md`. Group C = skip. That failure set is independent of CC's additive tests unless CC's new tests themselves go red in cloud (**UNSEEN**).

Local on `fd547ce`: 3638 passed / 0 failed / 78 skipped = **3716**. This branch on top of that, before estimator deletion: 3716 + 28 + 8 = **3752** collected (p-arms still collected locally).

### 4.2 This lane's additive (the 28, then the fake)

Prompt 35 files vs `fd547ce` (verified `git diff --name-only fd547ce HEAD -- '*.test.ts' '*.test.tsx'` at the freeze):

| File | Tests | After §1 |
|---|---|---|
| `src/components/ExportSettingsModal.test.tsx` | 10 | **+10** keep |
| `src/services/exportOutputEstimate.test.ts` | 10 | **+3** importers, **+3** selector, **−4** deleted → **+6** |
| `src/services/exportTargetFs.test.ts` | 8 | **+8** keep |

Prompt 37 (not in the 28):

| File | Tests | After §1 |
|---|---|---|
| `src/services/exportTargetFsFake.contract.test.ts` | 8 | **+8** keep (still fake; still no Rust) |

**UNSEEN:** if CC's Step 3b/4 already added TS tests for the same three commands, keep the 8 contract tests anyway unless they are byte-duplicate assertions against the same fake. They are the cloud-green stand-in; CC's Rust tests do not replace them in `npm test`.

### 4.3 Identities after rebase

Let `Δ_ts` = this lane's surviving Vitest tests = `10 + 6 + 8 + 8` = **32** under the default §1 split (4 formula tests deleted, triplet kept). If the triplet is deleted because CC already has it, `Δ_ts = 29`. If #5–#7 are promoted, `Δ_ts = 35`.

```
local collected  = L_collect + Δ_ts
local passed     = L_pass    + Δ_ts     (assuming L_fail = 0 and no new local reds)
cloud collected  = C_collect + Δ_ts     minus the p-arms collection gap if CC's cloud
                                       still cannot load scripts/ws1-session-p-arms.test.ts
cloud passed     = C_pass    + Δ_ts
cloud failed     = C_fail               unless CC added new cloud-red tests
cloud skipped    = C_skip               Group C stays skip
cargo            = R_*                  this lane adds 0 Rust tests
```

The **28** in the census reconciliation is `10+10+8` at the freeze, **before** the −4 formula deletions and **before** the +8 contract tests. Quote it that way:

```
this-lane TS on top of CC = (the 28) − 4 formula + 8 contract  = 32     [default §1]
                          = (the 28) − 4 formula − 3 triplet + 8 contract = 29  [CC already has triplet]
```

Never write “post-rebase npm test = N” as a single integer.

### 4.4 What must not move

- Cloud **failure names**: still the 35 + 1 suite in `.cursor/cloud-expected-failures.md`, plus any new names CC's own tests add in cloud (**UNSEEN** — append, do not replace, if that happens).
- Frozen triplet: 355,320,000 / 670,320,000 / 1,720,320,000 B.
- Contract tests: 8 passed in cloud with no `src-tauri` and no Tauri.
- K8: no `/tmp/` in new test source (`scripts/no-tmp-artifacts.test.ts`).

---

## 5. UNSEEN register (complete)

Resolve on the storage tip before claiming prompt 37 done.

| ID | Assumption | How to resolve |
|---|---|---|
| U1 | Landed ref is `ws3-storage-unified` | Not on this remote at `79efbb2`. Operator names the SHA/branch. |
| U2 | CC estimator module path + export names | `rg '355_320_000|estimateExport'` on that tip. |
| U3 | CC already asserts the frozen triplet | If yes, delete our 3 importers (do not double-lock). |
| U4 | CC covers hasAudio=false / fps-independence / 8 Mbps pin | If a case is missing, promote that deleted test to an importer. |
| U5 | CC ships bitrate selector helpers | If yes, delete ours and retarget tests #1–#3. If no, keep `exportOutputEstimate.ts` as selector-only. |
| U6 | CC return type includes `destinationRequiredBytes` | If no, thin `applyHeadroom` wrapper only. |
| U7 | CC command names match `export_pick_output_directory` / `export_volume_free_space` / `export_validate_output_path` | If no, map inside `createInvokeExportTargetFs` only. |
| U8 | Volume query works with **no** ffmpeg session | Modal runs before `startExport`. `ffmpeg_volume_free_space` on this tree needs `sessionId`. |
| U9 | CC `VolumeFreeSpace` fields match `VolumeFreeSpaceReading` | Diff `models.rs` / CC TS type vs `exportTargetFs.ts`. |
| U10 | Step 3b/4 TS + Rust test **counts** | Measure `npm test` + `cargo test` on CC's tip; plug into §4 identities. |
| U11 | Step 3b/4 tests duplicate our 8 contract tests | Keep ours unless they are the same assertions. |
| U12 | Spike harness `webcodecsStep2Spike/main.ts` still needs `pick_save_path` | Optional path arg on `startExport`; do not keep the production dialog for it. |
| U13 | CC already threads bitrate into the encoder | Do not revert; do not implement if absent. |
| U14 | CC's cloud `C_fail` set | May still be 35+1, or larger if new tests need corpus/replay. Do not assume 35. |
| U15 | Filename collision `exportOutputEstimate.ts` | Rename our selector remainder if CC took that path. |
| U16 | CC's 13-row storage payload field names | This lane's contract is `StorageSizeRow` `{ path, label, currentBytes, reclaimableBytes, sweepClass }` plus snapshot `{ rows, totalReclaimableBytes }`. Map inside `createInvokeStorageSizeReportSource` if CC differs; do not invent rows in the UI. |
| U17 | The 13 row identities (what each row *is*) | Fake round-trips any 13 rows. Do not bake CC's categories into `StorageSizeReport`. Diff Round 24a on `ws3-storage-unified`. |
| U18 | Sweep classes are `'reclaimable' \| 'protected' \| 'never-reclaimable'` | If CC ships `'orphan' \| 'resumable' \| 'live'` (Round 21 sessions) plus a model flag, map onto this union in the adapter — never in the component. |
| U19 | `totalReclaimableBytes` is a source field, not a UI sum | If CC omits it, do **not** have the component sum `row.reclaimableBytes`. Ask CC to add the field (same rule as not computing a row). |
| U20 | Command name `storage_size_report` | Not on this tree. If Round 24a used another name / args, change only the string in `createInvokeStorageSizeReportSource`. |
| U21 | Whisper model path / exact byte size | Presentation fixture is 1.5 GiB (`1.5 * 1024 ** 3`) at a Library models path, `sweepClass: 'never-reclaimable'`, `reclaimableBytes: 0`. CC's real row may use 1_624_555_275 (`ManageModelsModal` whisper total). Do not offer delete either way. |
| U22 | Low-disk fit is a caller-owned `showReclaimAction` boolean, not `available + reclaimable >= required` | Dialog takes three byte props and that flag and computes nothing. If CC's "fourth number" is `projectedAvailableBytes` or `shortfallBytes`, add it **display-only** at rebase; do not use it to show/hide Reclaim. |
| U23 | Low-disk dialog / storage report are not mounted in `App.tsx` yet | Existing `src/` files are frozen this turn. Wiring (export `disk_full` overlay, settings surface) is rebase work — **UNSEEN** which parent CC wants. |
| U24 | Per-row Reclaim on `sweepClass === 'reclaimable'` vs a single bulk reclaim | Report shows a per-row button only for reclaimable rows. If CC's UI is bulk-only, drop `onReclaimRow` at rebase; keep the never-reclaimable "no button" invariant. |

This commit adds 14 passing Vitest tests (5 fake-contract + 5 `StorageSizeReport` + 4 `LowDiskPreflightDialog`). They are this lane's, on top of the §4.2 32. `Δ_ts` after this commit = 32 + 14 = **46** under the default estimator split. Still not a combined figure with CC's Step 3b/4.

---

## 6. Register resolved against `ws3-storage-unified` @ `0bdc8a5`

Checked 2026-09-13. Estimators are **two layers of one model**, not two copies of one formula. Nothing in `exportOutputEstimate.test.ts` is deleted. Badge keeps `estimatedFileBytes`; preflight keeps CC's `destinationRequiredBytes`.

| ID | Verdict | Settled by |
|---|---|---|
| U1 | **VERIFIED** | `origin/ws3-storage-unified` is `0bdc8a5` (`docs(ws3): Round 24a ledger entry + W23 pending-hardware row`). |
| U2 | **VERIFIED** | `src/services/webcodecsExport/exportDestinationDiskEstimate.ts:56` `estimateExportDestinationDiskBytes`. No `exportOutputEstimate.ts` on CC's tip. |
| U3 | **VERIFIED** (CC asserts the triplet as `videoBytes + audioBytes`, not `estimatedFileBytes`) | `exportDestinationDiskEstimate.test.ts:14-25` `it.each` 1500→355_320_000 / 3000→670_320_000 / 8000→1_720_320_000. Keep our three importers: they lock the **badge** field name. |
| U4 | **VERIFIED** (CC covers hasAudio=false and 8 Mbps pin; not fps/resolution) | `exportDestinationDiskEstimate.test.ts:37-44` (audio 0), `:27-35` (8000 kbps = `EXPORT_DISK_VIDEO_BYTES_PER_SECOND × D`). CC's input has no fps/resolution (`DestinationDiskEstimateInput` `:41-46`). Keep our fps/resolution test — it is the badge layer. |
| U5 | **VERIFIED** (CC does not ship the bitrate selector) | `exportDestinationDiskEstimate.ts` has no `exportBitrateKbpsOptions` / `DEFAULT_EXPORT_BITRATE_KBPS`. Keep selector helpers + tests #1–#3. |
| U6 | **VERIFIED** | `DestinationDiskEstimate.destinationRequiredBytes` at `exportDestinationDiskEstimate.ts:48-53`. That is the **preflight** layer (`applyHeadroom`). Our `estimatedFileBytes` is the **badge** layer (file size, no headroom). Same size-term arithmetic; different public outputs. |
| U7 | **WRONG** (commands do not exist; do not invent them) | `git grep` of those three names in `0bdc8a5:src-tauri/**` is empty. Ledger `architecture-ledger.md:2576` and `exportDestinationDiskEstimate.ts:11-12`: `export_volume_free_space` / `export_validate_output_path` "still out of scope — prompt 37". |
| U8 | **VERIFIED** (existing volume query **requires** a session) | `ffmpeg.rs:356-365` `ffmpeg_volume_free_space(session_id, dest_path?)` calls `session_dir(&session_id)?` first. Modal runs before `startExport` creates a session — this command cannot back the badge. Closest session-less reading: `models.rs:701` `get_available_disk_space` (app-local-data volume only, `u64`, not `VolumeFreeSpace`). |
| U9 | **VERIFIED** (fields match; command shape does not) | `disk_space.rs:129-140` `VolumeFreeSpace { path, probed_path, volume_key, available_bytes }` ≡ `VolumeFreeSpaceReading`. Return is `Vec<VolumeFreeSpace>`, args are `{ sessionId, destPath }`, not `{ targetPath } → reading \| null`. |
| U10 | **VERIFIED** (ledger) | Round 24a STEP 6 `architecture-ledger.md` (~2644): `npm test` **3651 passed / 0 failed / 78 skipped = 3729**. `cargo test --lib -- --test-threads=1`: 356/0/6. Re-measured after rebase. |
| U11 | **VERIFIED** (no duplicate of our 8 contract tests) | CC has no `export_pick_output_directory` / `export_validate_output_path` tests. `exportDestinationDiskEstimate.test.ts` is the formula, not the invoke adapter. Keep the 8. |
| U12 | **VERIFIED** | `src/dev/webcodecsStep2Spike/main.ts:2386` still intercepts `pick_save_path`. `useExport.ts:988` on CC still calls it. Double-picker remains until `startExport` is edited (out of this turn — no new features). |
| U13 | **VERIFIED** (bitrate not threaded) | `exportWorker.ts:1208` `const EXPORT_BITRATE = 8_000_000`; `:1301` `bitrate: EXPORT_BITRATE`. `useExport.ts` has no `bitrateKbps`. |
| U14 | **VERIFIED** (failure set unchanged) | Two post-rebase `npm test` runs: 35 failed + `ws1-session-p-arms.test.ts` suite. Names match `.cursor/cloud-expected-failures.md`. No new cloud failure. |
| U15 | **VERIFIED** (no filename collision) | CC added `exportDestinationDiskEstimate.ts`, not `exportOutputEstimate.ts`. Both files coexist as the two layers. |
| U16 | **WRONG** (no size-report payload on CC) | Round 24a `architecture-ledger.md:2500` and `:2657`: Step 7 (size report) **deferred to Round 25**. No `StorageSizeRow` type on CC's tip. Identities filled from writers (U17), not from a CC schema. |
| U17 | **VERIFIED** (13 identities from writers, not from a CC table named "13 rows") | Round 23 ledger entry has **no STEP 1 storage inventory** (`architecture-ledger.md:2471` is PROMPT 32 clean baseline). Round 21 STEP 1 is the **session-artifact** table (7 files inside `kinetix-export-<uuid>/`, `:2048-2061`). Round 24a STEP 3 (`:2540-2560`) adds whisper staging, FA staging, stale backups. Plus Whisper + 5 FA packs. See `REAL_STORAGE_SIZE_ROWS`. |
| U18 | **WRONG** as a native enum; **kept** as presentation | Native session class is `'live' \| 'resumable' \| 'orphan'` (`tauriFfmpeg.ts:71`, `session_claim.rs`). No `never-reclaimable` in Rust. Models are deleted only via `delete_installed_model` (`models.rs:644`), not via `ffmpeg_reclaim_sessions`. Presentation union stays; adapter (when written) maps. |
| U19 | **STILL-UNSEEN** (no snapshot type on CC) | `ffmpeg_reclaimable_sessions` returns `reclaimableBytes` on the **session** report (`tauriFfmpeg.ts:81`), not a 13-row total. Keep `totalReclaimableBytes` as a source field. |
| U20 | **VERIFIED** (`storage_size_report` does not exist) | `git grep storage_size_report 0bdc8a5 -- src-tauri` empty. Ledger `:2500` Step 7 deferred. Do not invent. |
| U21 | **VERIFIED** (correct 1,624,555,275 B; 1.5 GiB was wrong) | `src-tauri/src/model_download.rs:141` `MODEL_SIZE_BYTES = 1_624_555_275`; `:1411` asserts it; `whisper.rs:571` "1624555275 bytes (~1.51 GiB)". Path: `app_local_data_dir()/models/ggml-large-v3-turbo.bin` (`whisper.rs:583-584`). |
| U22 | **STILL-UNSEEN** (no low-disk dialog on CC) | CC's formula returns `destinationRequiredBytes` (`exportDestinationDiskEstimate.ts:53`). No `showReclaimAction` / projected-available field. Keep the caller-owned boolean. |
| U23 | **VERIFIED** | Neither `StorageSizeReport` nor `LowDiskPreflightDialog` exists on CC's tip. `App.tsx` on CC has the startup reclaim **toast** (`ffmpeg_reclaimable_sessions`), not a 13-row report. Wiring still later. |
| U24 | **VERIFIED** (CC bulk-reclaims sessions) | `App.tsx` startup toast + `TauriFfmpeg.reclaimSessions(reclaimableIds)` — one action for every non-live session. Per-row Reclaim on this lane is extra; never-reclaimable models must still have no button. |

### Layers, not copies

```
size term (badge)     estimatedFileBytes = videoBytes + audioBytes
                      exportOutputEstimate.ts  — this lane
                      (CC computes the same term internally as videoBytes+audioBytes
                       but does not export a file-size field)

preflight term        destinationRequiredBytes = applyHeadroom(size term)
                      exportDestinationDiskEstimate.ts  — CC
                      (this lane also applied headroom on the badge module;
                       the modal gate should read CC's field after rebase)
```

Same `bitrateKbps × 125 × D` + AAC 24,000 B/s. Different outputs. **Do not delete the 10 badge-module tests.** Badge imports `estimateExportOutputBytes`. Preflight imports `estimateExportDestinationDiskBytes`.

### Commands CC actually exposes vs what still has to be written

**Bindable now (wrong shape for the modal's `ExportTargetFs` / size report):**

| Need | Closest Rust | Gap |
|---|---|---|
| Folder picker | **none**. `pick_save_path` (`ffmpeg.rs:1759`) is a **save-file** dialog. `import_local_model` (`models.rs:515`) is a **pick-file** dialog. | Must write `export_pick_output_directory` (or equivalent pick-folder) later. |
| Volume free space | `ffmpeg_volume_free_space` (`ffmpeg.rs:356`) — needs `session_id`, returns `Vec<VolumeFreeSpace>`. `get_available_disk_space` (`models.rs:701`) — app-local-data volume, `u64` only. | Must write a session-less `{ targetPath } → reading \| null` later, or wrap `volume_free_space(Path)` without `session_dir`. |
| Validate output path | **none** | Must write `export_validate_output_path` later. |
| Storage size report | **none**. Sessions only: `ffmpeg_reclaimable_sessions` / `ffmpeg_reclaim_sessions`. | Must write `storage_size_report` later (Round 25). |

Do not add any of those in this turn.

### Post-rebase census (onto `0bdc8a5`)

Rebase: **zero conflicts** (no overlapping paths vs `fd547ce`→`0bdc8a5`).

`npm test` twice, Node v22.22.2, identical:

| | Totals |
|---|---|
| Run 1 | 3665 passed / **35 failed** / 78 skipped = **3778** (97.88s) |
| Run 2 | 3665 passed / **35 failed** / 78 skipped = **3778** (97.05s) |

Failure-name diff run1 vs run2: **empty**. Failure set vs freeze: **empty** (35 tests + 1 non-loading suite).

Lane delta on CC's **3729**: `3778 − 3729 = **49**` = this lane's 50 new tests − 1 `p-arms` not collected in cloud.

```
50 = 28 (prompt 35) + 8 (ExportTargetFs fake) + 14 (storage report + low-disk)
```

---

## 7. Done when

- Rebase onto `0bdc8a5` completed. Estimators are **layers**: keep both modules.
- Badge triplet and CC's `videoBytes+audioBytes` triplet still 355,320,000 / 670,320,000 / 1,720,320,000.
- Deferred commands still absent from `src-tauri/**` (not invented).
- `useExport.ts` `pick_save_path` still present until a later wire (U12).
- Totals reported as CC's 3729 + this lane's delta, local and cloud separately.
