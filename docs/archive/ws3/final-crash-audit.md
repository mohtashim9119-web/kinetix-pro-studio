# WS3 Export — Final crash audit

> Adversarial pass over the merged `ws3-export-integration` tree answering one
> question: what can still crash, hang, corrupt, or silently truncate a user's
> export? Cut: `final-crash-audit` from `ws3-export-integration` @ `78c104a`.
> Base main `4d4922c`. Rollback `15002e5`.
>
> **This file is the eighth WS3 content doc.** `docs/README.md` still records
> the first cap amendment (WS3 ≤7). Do not edit that index from this pass —
> record the second amendment here: the WS3 lane is now **≤8**, because this
> audit is load-bearing and has nowhere else to live.

STEPS 1–3 found three export-losing holes. The operator redirected: **fix the
blockers, then finish STEPS 4–6.** F1–F3 are therefore both *findings of this
audit* and *fixed in this same pass*. Residuals below are what remains after
those fixes. No other file in `docs/` was edited.

Frozen constants, re-read from source at this head (unchanged by the blocker
fixes): `WATCHDOG_MS` 30_000 · `FORWARD_PROGRESS_BOUND_MS` 45_000 ·
`FLUSH_BOUND_MS` 20_000 · `APPEND_DRAIN_BOUND_MS` 600_000 · `TRUNCATE_BOUND_MS`
172_675 (`⌈6907 × 25⌉`) · `KILL_BOUND_MS` 125 (`⌈5 × 25⌉`) ·
`APPEND_BATCH_BYTES` 512 KiB.

---

## Findings

Severity axis: can it lose a completed or in-progress export? A hang the user
can retry is less severe than a silently truncated file they keep. Status
`fixed-this-pass` means the hole existed at `78c104a` and is closed on this
branch.

| ID | Status | Severity | What crashes or corrupts | File:line | Code-fixable vs hardware-bound | One-line fix |
|---|---|---|---|---|---|---|
| **F1** | **fixed-this-pass** | **Export-losing (in-progress bitstream)** | Mid-run rotation flush-timeout called `finish()` immediately, then rewind `set_len` on `piece_N.h264` while `ffmpeg_append_file_raw` could still be in `write_all`/`sync_all`. Native append did not poll the cancel flag. A late `O_APPEND` after `set_len` re-extends the file. Picture-count often fails loud; residual risk was interleaved NALs that still count. | `exportPipelineWebCodecs.ts:1804-1814, 2170-2180` (was `'error'` → `finish()` at the rotation-timeout site); `ffmpeg.rs:27-31, 368-427, 1177, 1198` | Code-fixable | Wait in-flight appends before rewind; per-session IO gate across append/truncate/concat; chunked append that polls cancel between 64 KiB blocks |
| **F2** | **fixed-this-pass** | **Export-losing (completed file at the save path)** | `save_session_file` was an unbounded `fs::copy` onto `dest_path` with no dest fsync. Production save runs in `useExport.ts` *after* the pipeline returns (`activeFfmpeg` already null). Cancel then `destroy` could race the copy. UI said cancelled; dest could still be a truncated MP4. | `ffmpeg.rs:1751-1853`; `useExport.ts:797-806` | Code-fixable | Copy to `dest.part` (cancel-polled, fsynced), rename-over dest, fsync dest; cancel always `backend.cancel()` so the copy sees the flag |
| **F3** | **fixed-this-pass** | Hang on next export start (not a silent keep) | `prepareCheckpointResume` and the post-fence seam `truncateAnnexbToOffset` in `exportResumeDiscovery.ts` had no `withFfmpegLivenessBound`. Later `countPictures` in `exportResumeSession.ts` did. | `exportResumeDiscovery.ts:253-260, 348-349, 400-401` | Code-fixable | Wrap both discovery truncates in `TRUNCATE_BOUND_MS`; thread optional `kill()` on the resume handle |
| **F4** | open | Hang / lying bound (not a silent keep) | `KILL_BOUND_MS` = 125 is 25× a macOS-SSD worst of 5 ms. `TauriFfmpeg.kill()` swallows invoke failures, so `withFfmpegLivenessBound` sets `killed: true` even when the command never ran. Operator-facing text uses `Math.round(KILL_BOUND_MS/1000)` → **"0s"**. The IO gate from F1 now serializes a still-running append behind truncate, so this no longer re-opens F1's silent-NAL hole by itself. | `tauriFfmpeg.ts:451-458`; `ffmpegLivenessBound.ts:142-149, 256, 342-347` | Code-fixable (display + don't swallow); Windows settle time is **W6** | Return kill success/failure; print milliseconds; keep W6 as the hardware measurement |
| **F5** | accepted residual (C7 / Rung 0) | Under-charge of recovery budget across a crash, not a truncated dest | Counters are charged in memory first; `pump()` fires `writeExportState` and never awaits the fsync. A crash in that window persists a budget that is one attempt short. Production `createExportStateManifest` site is `beginPiece` → `startManifest` → `exportLifetimeBudgetOf(manifest)` (C11 carry confirmed). | `exportCheckpointWriter.ts:139-156, 158-175, 248-263` | Deliberately not awaited — awaiting reintroduces a hang on the recovery path | Leave; E1 is the live crash proof |
| **F6** | open, low | Concat output is not durable | `ffmpeg_concat_annexb_pieces` `flush()`es the output and returns — no `sync_all`. An OS crash between concat and mux can lose the concat file. Pieces remain; dest is not written yet. | `ffmpeg.rs:1472-1474` | Code-fixable | `sync_all` the concat output before return, same helper append/truncate already use |

Nothing else in STEPS 1–3 rose to export-losing. Several hardware items (H4/H6/H7, W1–W15) can still lose or hang an export on a machine this environment cannot run; they are not new, and they are not closed by F1–F3.

---

## STEPS 1–3 (checkpoint, condensed)

### Bound sweep (STEP 1)

| Path | Bounded? | By | On expiry |
|---|---|---|---|
| GL worker silence | yes | `WATCHDOG_MS` 30s | typed abort; `'error'` path now waits in-flight appends (F1) then may rewind |
| Forward progress (chunks without appends landing) | yes | `FORWARD_PROGRESS_BOUND_MS` 45s | typed abort |
| Encoder flush | yes | `FLUSH_BOUND_MS` 20s | rotation → rewind; final session → salvage |
| Terminal append drain | yes | `APPEND_DRAIN_BOUND_MS` 600s | `'append-drain-stall'` |
| Append IPC itself | indirectly | queue ceiling 256 MiB + drain/watchdog; native write now cancel-polled per 64 KiB | overflow aborts; hung write can still occupy the IO gate until cancel or process death |
| Rewind / salvage truncate | yes | `TRUNCATE_BOUND_MS` 172_675 | kill chain → typed error |
| Resume-discovery fence + seam truncate | **was no; now yes** | `TRUNCATE_BOUND_MS` (F3) | same kill chain |
| Concat / count / mux | yes (TS wrapper) | `TRUNCATE_BOUND_MS` / `FRAME_COUNT_BOUND_MS` / mux bound | kill chain |
| `ffmpeg.kill()` inside a bound | yes | `KILL_BOUND_MS` 125 | `FfmpegKillHungError`; see F4 |
| Consent / sealing offer | unbounded by design | operator | export waits |
| `save_session_file` | **was unbounded copy; now cancel-polled chunked copy** | session cancel flag (F2) | `.part` deleted; dest untouched |
| Checkpoint `writeExportState` | fire-and-forget | none (F5) | resume rewinds further |

`TRUNCATE_BOUND_MS` and `KILL_BOUND_MS` still match their stated derivations in
`ffmpegLivenessBound.ts` (25× measured worst on this machine's SSD). The
justification is macOS-SSD; HDD is **E8**, Windows kill latency is **W6**.
Neither constant was changed this pass.

### State machine (STEP 2)

Process death at any charged recovery step: in-memory counter may be ahead of
disk (F5). Resume seeds from the durable manifest, so the next process can
attempt one extra rewind/failover relative to the process that died — the C7
residual the ledger already records. Unrecoverable without a checkpoint: a
crash before the first rotation checkpoint (`never_checkpointed`). Partial
file at the *operator* path: F2 closed the copy-truncation hole; a crash
*during* rename-over on Windows can leave dest at `.bak` with the completed
session file still in `$TMPDIR` — operator-visible miss, not a silent short
MP4.

C11 carry: the only production `createExportStateManifest` call is
`exportCheckpointWriter.ts:159` with `carriedBudget: exportLifetimeBudgetOf(manifest)`.
Test fixtures construct manifests directly; they are not production sites.

### Silent corruption (STEP 3)

| Class | Detected in production? |
|---|---|
| Short / truncated IPC append | Yes — `sessionFileSize` vs expected running total, `ShortAppendError` (`exportPipelineWebCodecs.ts` ~1872–1900) |
| Truncate offset mid-AU (rewind) | Yes — kept picture count must equal `rewindFrameIndex`; mismatch aborts |
| Truncate offset mid-AU (resume fence) | Yes — native fence repair + picture-count disagreement refuses resume |
| Malformed concat inputs | Existence is not proof; earlier pieces are counted. Concat itself is byte concatenation. |
| Parameter-set mismatch across a rung | Mitigated by per-piece codec pin (H2); join quality is **W4** / **M1** |
| Frame-count vs container | Post-concat picture-count guard (annexb, not AVCC) |
| Write treated as durable without fsync | Append/truncate/prepare/export_state/F2 dest: `sync_all`. Concat output: **F6**. Checkpoint fsync is not awaited by the renderer: **F5**. |

---

## STEP 4 — Windows risk surface

Built from the merged code first (ffmpeg.rs `windows_long_path` /
`save_session_file` / `OpenOptions::append`, `session_claim.rs` pending-delete
and PID liveness, `hardwareCodecLadder.ts`, `glContext.ts` OffscreenCanvas,
`exportWorker.ts` heartbeat, `exportDestinationPath.ts`, `tauriFfmpeg.ts`
raw-body append). Then diffed against the existing 25 rows.

### Code-derived list

1. **Large raw IPC bodies (H1).** Production appends `InvokeBody::Raw` at
   `APPEND_BATCH_BYTES` = 512 KiB and verifies landed size. Raising the cap
   without a WebView2 measurement is what H1 exists to forbid.
2. **Hardware encoder sessions (H3 / NVENC / MF).** Up to 23–27 sequential
   `VideoEncoder` sessions per long GL piece; close is async; accounting is
   diagnostic-only (`encoderSessionsOpened`/`Closed`).
3. **`prefer-software` + High profile (H2).** Ladder can demote codec per
   piece; mixed-profile *within* a piece is pinned closed. Whether WebView2
   accepts the pair at all is unmeasured here.
4. **TDR / `gl-context-lost` (H6).** Worker treats OffscreenCanvas context
   loss as a hard fail. Rung 5c is deferred pending a real TDR observation.
5. **Defender scan-on-close (H4).** Native append is open → chunked write →
   `sync_all` → close, once per 512 KiB. A synchronous AV filter on close
   would dominate wall clock; no code in this repo can prove or disprove it.
6. **Append vs truncate (F1, Windows-shaped).** `FILE_APPEND_DATA` writes
   ignore the file pointer and extend EOF
   ([Win32 file access rights](https://learn.microsoft.com/en-us/windows/win32/fileio/file-access-rights-constants)).
   A late append after `SetEndOfFile`/`set_len` re-extends. F1's IO gate
   plus cancel-polled chunks are the code-side serialization; they do not
   change the Win32 semantics if a handle is still open.
7. **`\\?\` long paths (H9).** `apply_windows_long_path_prefix` prefixes
   drive-letter paths `\\?\` and UNC `\\?\UNC\`, no-ops on relative paths,
   is a no-op on macOS. Delivery now goes through `copy_session_file_atomic`,
   not `fs::copy`.
8. **Forward-slash / `.` / `..` under `\\?\`.** Prefix disables Win32
   normalization
   ([Maximum Path Length Limitation](https://learn.microsoft.com/en-us/windows/win32/fileio/maximum-file-path-limitation)).
   `looksLikeWindowsPath` accepts `C:/...`. A short forward-slash dest would
   be prefixed as `\\?\C:/...` and can fail or write a literal path.
9. **Pending delete (H10).** Sweep classifies `remove_dir_all` Ok + dir still
   exists as `pending_delete` and does **not** add those bytes to
   `bytesReclaimed`. Accuracy under a live NTFS handle is unmeasured.
10. **Claim file / two instances (H5).** `session_claim.json` is PID +
    start-time + `holder_instance_id`, no heartbeat. NTFS atomicity of the
    create/reenter race is **W10**.
11. **Modern Standby / lid close (H7).** No power-event handler. Survival
    depends on the worker heartbeat + liveness bounds.
12. **Worker OffscreenCanvas + WebGL2 + VideoEncoder in WebView2.** The
    production encoder lives there. Chromium spikes are not that host.
13. **Pre-encode path-length check vs `\\?\`.** See disagreement with W2
    below — this is a real code/docs split, not a new crash.

### Research (URLs, confidence, kind)

| Topic | Source | Confidence | Kind |
|---|---|---|---|
| WebView2 `IStream` body ~2 MB truncation | [Wails PR 5369](https://github.com/wailsapp/wails/pull/5369) (host reports silent truncate / drop past ~2 MB); [ICoreWebView2WebResourceRequest.Content](https://learn.microsoft.com/en-us/microsoft-edge/webview2/reference/win32/icorewebview2webresourcerequest) documents IStream, **not** a 2 MB cap; [Tauri v2 raw body](https://v2.tauri.app/develop/calling-rust/) is the supported binary path | Medium for the ~2 MB figure (reported host bug, not a Microsoft guarantee). High that 512 KiB + verify is the right posture until W11 measures | Reported bug + documented API |
| NVENC concurrent sessions | [Tom's Hardware / NVIDIA matrix coverage](https://www.tomshardware.com/news/nvidia-increases-concurrent-nvenc-sessions-on-consumer-gpus) — consumer driver cap historically 3→5→8; workstation unlimited. This app opens sessions **sequentially**, one encoder at a time, so the concurrent cap is the wrong limit unless a previous `close()` has not released (H3) | High for sequential-vs-concurrent distinction; medium for the current numeric cap | Documented driver policy + inference about this app |
| NVENC multi-slice | [NV_ENC_PIC_PARAMS_H264.sliceMode](https://www.ffmpeg.org/doxygen/3.4/structNV__ENC__PIC__PARAMS__H264.html) — driver may emit N slices/picture. Rung 1 counts pictures, not VCL NALs | High | Documented encoder control; **W14** is the measurement |
| TDR | [WDDM TDR](https://learn.microsoft.com/en-us/windows-hardware/drivers/display/timeout-detection-and-recovery) — default 2 s GPU preempt timeout; recovery purges video memory | High | Documented guarantee. Whether our GL export presents as `gl-context-lost` is **W8** (inference until observed) |
| MF async MFT | Chromium/WebView2 `VideoEncoder` on Windows is Media Foundation. `close()` is not documented as synchronous session release. Matches H3's residual | Medium | Inference from the WebCodecs-on-Windows stack; not a Microsoft API we call directly |
| Defender scan-on-close | [CreateFile pending-delete → ACCESS_DENIED](https://learn.microsoft.com/en-us/windows/win32/api/fileapi/nf-fileapi-createfilea); field reports of Defender holding downloads ([superuser](https://superuser.com/questions/998173/the-action-cant-be-completed-because-the-file-is-open-in-windows-defender-servi)) | Medium that AV-on-close can dominate 512 KiB appends; **W7** is the A/B | Inference + anecdotal |
| `FILE_APPEND_DATA` | [File access rights](https://learn.microsoft.com/en-us/windows/win32/fileio/file-access-rights-constants): append does not overwrite existing data; writes extend. Combined with F1's previous un-gated `set_len`, this is the Windows-shaped corruption | High | Documented guarantee |
| `\\?\` disables normalization | [Maximum Path Length Limitation](https://learn.microsoft.com/en-us/windows/win32/fileio/maximum-file-path-limitation): no `/`→`\`, no `.`/`..`; UNC is `\\?\UNC\` | High | Documented guarantee. **W3** is the live test |
| `CreateFile` + `\\?\` | Same page: extended length is 32,767 with the prefix. Whether every internal path `std::fs` takes honours it is **W2** — and this pass no longer uses `fs::copy` for delivery | High for CreateFile; medium for rustc's std | Documented + implementation-dependent |
| Pending delete | [CreateFile remarks](https://learn.microsoft.com/en-us/windows/win32/api/fileapi/nf-fileapi-createfilea): delete waits for last handle; reopen fails with ACCESS_DENIED | High | Documented. Sweep's `pending_delete` classifier is the code-side guess; **W1** measures it |
| WebView2 dedicated workers / OffscreenCanvas | [CoreWebView2DedicatedWorker](https://learn.microsoft.com/en-us/microsoft-edge/webview2/reference/winrt/microsoft_web_webview2_core/corewebview2dedicatedworker) exists; [MDN OffscreenCanvas](https://developer.mozilla.org/en-US/docs/Web/API/OffscreenCanvas) is the web API. WebView2 ≠ Chromium for this app's encoder host (**M1** analog on Windows is W4 + a worker GL spike, not a new row) | Medium | Documented APIs; host-delta is inference until measured |

### Diff against W1–W15 / M1–M2 / E1–E8

**No new Windows hardware row.** Every code-derived Windows risk already has
an ID in `windows-validation.md`. Inventing a 26th row to look thorough would
duplicate W4 (software High profile), W5 (session leak), W8 (TDR), or W11
(IStream).

**Additions that are not hardware rows** (code, this pass): F1, F2, F3
(fixed); F4, F6 (open, not Windows-specific). F2 changes *how* W2/W6/E6
should be run: delivery is no longer `fs::copy`, it is copy-to-`.part` +
rename-over + fsync.

**Disagreements with existing rows**

- **W2's pass criterion is wrong against current TS.** It says the pre-encode
  check "allows ≤ 32,767". `checkExportDestinationPathLength`
  (`exportDestinationPath.ts:53-59`) **rejects any Windows-shaped path at
  length ≥ 260**. Native `windows_long_path` would accept a long dest; the
  renderer never lets the operator pick one through this app's save flow.
  Long-path delivery is therefore unexercised in production, and a 30-minute
  encode cannot fail at MAX_PATH delivery *via the UI* — it is refused at
  second zero. The `\\?\` prefix on dest is still load-bearing for UNC and
  for any future caller that bypasses the check. W2 should be rewritten:
  either raise the TS ceiling to 32,767 now that delivery is prefixed, or
  change the pass criterion to "paths ≥ 260 are rejected before encode."
- **W2's "every code path `std::fs::copy` takes" is stale.** Delivery no
  longer calls `fs::copy`. The live question is whether `File::create` /
  `write_all` / `rename` honour `\\?\` on the `.part` and dest paths.
- **W6 is still right**, and F4 makes it more urgent: 125 ms is a macOS
  measurement wearing a Windows bound's clothes.
- **W3 is still right**, and is reachable for *short* forward-slash dests
  (`looksLikeWindowsPath` accepts `C:/...`).
- **H8 "closed" vs concat:** ledger H8 is about checkpoint vs Annex-B
  `sync_all` on append/truncate/prepare. Concat output (F6) was never in
  that claim. Not a disposition lie — a gap beside it.

**Already closed by code, of those 25:** none. F1–F3 were not in the 25.

---

## STEP 5 — Concurrency and lifecycle

| Scenario | Current behavior | Verdict |
|---|---|---|
| Two app instances launched together | Each `ffmpeg_create_session` mints a new UUID under `$TMPDIR/kinetix-export-<uuid>/`. No shared mutable bitstream. | Correct |
| Two instances racing `reenter` on the same session | `evaluateResumeCandidate` reads the claim **before** `reenter`. Live foreign holder → `live_claim_blocked`, `reenter` never called. Native `acquire_session_claim` also refuses a live foreign PID. | Correct in logic; NTFS race is **W10**. Tolerable until that run. |
| Orphan sweep vs a live claimed session | Manifest-present dirs are deferred. Age < 1 h deferred. Live claim deferred (`session_claim.rs:431-469`). Only manifest-less, old, unclaimed dirs are candidates. `pending_delete` is not counted as reclaimed. | Correct. Accuracy of the classifier is **W1**. |
| Resume discovery while another export is mid-flight | Same claim check. A live holder of candidate A does not affect an in-flight export B (different session id). Sweep at export *start* will not collect B (too young, and once a manifest exists it is deferred). | Correct |
| App quit / window close during export | `onCloseRequested` flushes the *project* (`flushWithBudget`) then `win.destroy()`. It does **not** call `cancelExport`. Cmd+Q is `app-quit-requested` with a Rust-side 2 s budget, also project-flush, not export-cancel. Process death. If a checkpoint was durable, E1's resume path applies; if not, the piece rewinds. After F2, a close mid-save leaves dest untouched (`.part` dropped). | Tolerable: same class as kill -9. Not a silent dest truncate. Not a dedicated export-cancel-on-quit. |
| OS sleep / lid close / Modern Standby | No handler. Heartbeat + `WATCHDOG_MS` / `FORWARD_PROGRESS_BOUND_MS` are the only tripwires. WebKit timer starvation is diagnosed; WebView2 / MF drain across Modern Standby is **W9**. | Hardware-bound (H7). Defect if it silent-stalls past 45 s — that is the W9 pass criterion. |
| PID reused | Claim is PID + start-time (2 s slack) + `holder_instance_id`. **Liveness does not read `holder_instance_id`.** On Windows, `GetProcessTimes` is the real creation FILETIME — reuse matching within 2 s of the *original* start is implausible. On macOS, `/proc/<pid>/stat` is missing; `process_start_time_ms` falls back to `now_ms()`, and `is_holder_process_live` treats a live PID with unreadable start time as **live** (`session_claim.rs:207-208`). Failure mode is **false-block resume**, not steal. | Tolerable on macOS (conservative). Sufficient against double-append. Insufficient as a heartbeat (a wedged-but-alive holder blocks forever — same as a live claim, which is the point). |

No heartbeat is the right shape for a crash-resume lock: a heartbeat that
stops would look like death and invite a second process onto a live bitstream.
The cost is a stuck live PID. That is W10's stale-PID half, not a new hole.

---

## STEP 6 — What the tests don't cover

### Faked components on recovery paths

Almost every recovery wiring test (`boundedRerenderWiring`, `recoveryMatrix`,
`hardwareFailoverWiring`, `flushSalvage`, `salvageTruncate`,
`exportResumeWiring`, `forcedSealWiring`, `driveGlRun`) injects a `FakeWorker`
and a mocked `WebCodecsFfmpeg`. They exercise **decision + call order +
orchestrator state**, not VideoEncoder, not WebGL2, not the real sidecar, not
NTFS.

Native recovery that *is* real: `ffmpeg::tests` fence/truncate/concat/cancel/
IO-gate/atomic-copy, against hand-built Annex-B fixtures.

The one test in the "faked encoder, real ffmpeg sidecar, real bytes" category
named by the prompt: `scripts/ws3-clean-path-artifact.test.ts` (Round 16
clean-path byte-neutrality). Encoder is a replay of a pre-encoded libx264
stream; every file op and `exec` is the real sidecar. **Skipped** in `npm test`
unless `WS3_ARTIFACT_DIR` is set. It covers the *clean* path (batching,
verify-after-append, concat, guard, mux). It does **not** cover rewind,
failover, salvage, resume fence, or F1's hung-append-then-truncate.

No equivalent artifact exists for: a rotation rewind, a hardware failover
join, a forced seal, a crash-restart resume, or F2's save-to-dest.

### No destructive probe

F1's new test (`boundedRerenderWiring.test.ts` "does not truncate while an
in-flight append…") is outcome-shaped at the mock: truncate is not called
until the hung `appendFileRaw` is released, then it is called at the session-0
byte offset. It does **not** open two concurrent native handles. The native
half is `session_io_gate_is_exclusive_per_session` (mutex exclusion) plus
`append_stops_mid_write_when_cancel_flag_is_set` (cancel between chunks).
Nobody has a test that performs a real `set_len` while a real `O_APPEND`
handle is still in `write_all` — that was the production bug, and the gate
makes it impossible to schedule, which is also why it cannot be reproduced
without removing the gate (the CLAUDE.md probe rule: delete the wrap, confirm
red). That probe was **not** run this pass on the JS wait; the wiring test
going red when `finishAfterInFlightAppends` is replaced with `finish` would
be that probe.

F2's native tests *are* outcome-shaped: dest bytes, dest absence on cancel,
existing dest untouched. They do not run through `useExport.ts`'s cancel
race (that hook is historically a manual-verification gap).

F3's discovery test uses fake timers: a hanging fence expires
`TRUNCATE_BOUND_MS`. Destructive in the timeout sense; the sidecar is mocked.

### Trace-shaped vs outcome-shaped

Trace-shaped (call sequences, `initMessages`, mock call counts): most
`*Wiring.test.ts` files, including the first bounded-rerender test's
`appendFileRaw` length list. Outcome-shaped (bytes / file state / picture
counts): `ffmpeg::tests`, `annexbFrameCount.test.ts` (real fixtures +
digests), `exportCheckpoint.test.ts` hash identity, F2 copy tests, the
clean-path artifact when enabled.

A green wiring suite after F1 is evidence the orchestrator waits; it is not
evidence two Windows handles cannot interleave. That sentence is the Round 13
lesson applied here.

### Fixtures that do not look like real encoder output

Unchanged from the ledger. `8slice-10pic` / `1slice-12pic` / `paramsets-3pic`
/ `short-9pic` are purpose-built Annex-B with known digests — they *are* the
AU-scanner's contract, not a pretend encoder. Round 13's "unrealistic Annex-B
invalidated a resume proof" is why those digests exist. The FakeWorker chunks
in wiring tests are still `new Uint8Array(n)` with a marker byte — they do
not contain start codes. Any test that would parse them as Annex-B would be
in the Round 13 failure class. The F1 wiring test does not parse them; it
tracks byte lengths. Native F1/F2 tests use real files, not those blobs.

**E1–E8 / W1–W15 / M1–M2 remain the only proofs that involve a real encoder
host or a real Windows kernel.** This pass did not pretend otherwise.

---

## Ledger vs code

Assume nothing from a prior audit is still true. Re-derived:

| Ledger claim | Code |
|---|---|
| C4 closed: rewind `truncateAnnexbToOffset` wrapped in `TRUNCATE_BOUND_MS` | **Holds** (`exportPipelineWebCodecs.ts` ~3132). F1 was a *different* hole (append still writing). F3 was a *third* (discovery fence unwrapped). Rung 0 "every native call on a failure path is wrapped" was **false at `78c104a` for discovery**; true after F3. |
| C11 closed: piece manifest carries export-lifetime budget | **Holds.** Only production create site carries `exportLifetimeBudgetOf`. |
| H8 mitigated: Annex-B `sync_all` on append/truncate/prepare | **Holds** for those three. Concat output is F6 — not in H8's claim. |
| H9 mitigated: `windows_long_path` + pre-encode check | **Holds as mitigation.** The check's *threshold* (260, not 32,767) disagrees with W2's written pass criterion (STEP 4). |
| H5 mitigated: claim before reenter | **Holds.** Liveness ignores `holder_instance_id` (STEP 5); that is documented in the claim struct, not a ledger lie. |
| 10 closed / 8 mitigated / 3 open | **Holds** for C1–C11 / H1–H10 as *named*. F1–F3 were unnamed at Round 17. After this pass they do not reopen those rows; they were adjacent holes. |
| `ffmpeg.kill()` hole closed Round 13 | **Partially.** Bound exists; `TauriFfmpeg.kill` swallows (F4). |

No disposition is marked `closed` for a hardware-bound item. That rule still
holds.

---

## Verdict

**Do not put this pipeline in front of real Windows users as a "finished"
export until W4, W5, W8, W9, W14, and E1 have been run.** Those are the
rows that can still lose or hang a long encode on the host the two field
failures came from. F1–F3 were the code-side export-losing holes this pass
could actually close without that hardware; they are closed.

**Fit to dogfood on macOS `tauri:dev`:** yes, with the same caveats the
ledger already had (M1/M2, E1–E8). The three silent-loss bugs that would
have bitten a rewind, a cancel-at-save, or a wedged resume fence are the
ones that were live at `78c104a`.

**Fix first, in order, if anything more is to be done in code before
Windows:**

1. Already done: F1, F2, F3.
2. F4 — stop swallowing `kill` failures; print `KILL_BOUND_MS` in
   milliseconds. Cheap, and it makes W6's measurement meaningful.
3. Align W2 with `exportDestinationPath.ts` (raise to 32,767 *or* rewrite
   the row). Otherwise the first Windows long-path test will fight the UI.
4. F6 — `sync_all` concat output. Small, matches H8's posture.

Then the hardware list, starting with W14 (if the AU scanner mis-counts that
GPU's slices, every other Windows number is uninterpretable) and E1 (the
only proof resume survives a real death).

---

## What this pass changed (named paths)

Not part of the original read-only gate; added when F1–F3 were redirected to
fixes.

- `src-tauri/src/ffmpeg.rs` — IO gate, cancel-polled append, atomic save
- `src/services/webcodecsExport/exportPipelineWebCodecs.ts` — wait in-flight
  appends on the rewind `'error'` path
- `src/services/webcodecsExport/exportResumeDiscovery.ts` — bound the fence
- `src/hooks/useExport.ts` — cancel kills the session during save
- tests: `boundedRerenderWiring.test.ts`, `exportResumeDiscovery.test.ts`,
  plus new `ffmpeg::tests` for the gate and atomic copy

Targeted verification this pass (not `npm test` / not `npm install`):
`boundedRerenderWiring.test.ts` + `exportResumeDiscovery.test.ts` 33/33;
`cargo test --lib ffmpeg::tests` 47 passed / 0 failed / 3 ignored.
Worktree has no committed `node_modules` or sidecars; local runs used a
symlink into the main checkout, gitignored.
