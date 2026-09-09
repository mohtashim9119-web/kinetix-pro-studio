# WS3 — Export durable state (truncation primitive, checkpoint writer, native bounds)

> Audit + implementation report for the concat-framecount branch. Not a task
> tracker. Salvage/resume **decision** is owned by the runtime-recovery agent;
> this round supplies the primitive, the write-only manifest, and the native
> Cargo gate.

`src-tauri/` is **intentionally non-empty** on this branch (`ffmpeg.rs` vs
`main`). The empty-diff shortcut does not apply. **Cargo gates govern.**

---

## Part 0 — Cargo gate (closed)

`CARGO_TARGET_DIR=$PWD/src-tauri/target`

| Suite | Baseline | This round (after new tests) | Arithmetic |
|---|---|---|---|
| `cargo test` | 264 / 0 / 2 | **269 / 0 / 2** | 264 + 2 (already on `afa8818`) + 3 new = 269 |
| `cargo test --features fa-inference` | 350 / 0 / 32 | **355 / 0 / 32** | 350 + 2 + 3 = 355 |

`npx tsc --noEmit` / `npm run lint`: clean.

`npm test`: baseline **3293** + **12** = **3305** executed. Added vitest: 8 in `annexbFrameCount.test.ts` (truncate fixtures + locked hashes) + 4 in `exportCheckpoint.test.ts`. Arithmetic: 3293 + 8 + 4 = 3305.

A full-suite run under load reported 3301 passed + 4 failed, all four failures being WS1 `runProductionPath` timeouts (`aj0-oracle-diff` v6, `q-production-pins` R.12, `s-exclusion` R.11, `s-measure` R.12 descriptors) — pre-existing live-fidelity scripts, not export code. Isolated: the oracle v6 case passed in 53s; the Q/S files passed when not sharing a v6 production-path slot. Re-count of executed tests in that run: 3301 + 4 = 3305.

Pre-implementation measurement (HEAD `afa8818`, before this round's tests):
266 / 0 / 2 and 352 / 0 / 32 — the +2 vs the stated baseline were the
access-unit tests already shipped on `afa8818`. No regression. The +3 are
`ffmpeg_count_annexb_frames_matches_js_synthetic_bytes`,
`truncate_mid_nal_mid_picture_and_boundary`,
`ffmpeg_truncate_annexb_command_matches_in_memory`.

`ffmpeg_count_annexb_frames` now covers, on **identical synthetic bytes**
(locked SHA-256, JS `annexbFrameCount.test.ts` ↔ Rust `ffmpeg.rs`):

| Fixture | pictures | vclNals | byteLength | sha256 prefix |
|---|---|---|---|---|
| 8 slices/picture × 10 | 10 | 80 | 945 | `efd16ab57ff66756…` |
| single-slice × 12 | 12 | 12 | 444 | `d02aca0757167768…` |
| repeated SPS/PPS/AUD/SEI × 3 | 3 | 3 | 126 | `b6ce471760350a35…` |
| short-by-one × 9 (guard expected 10) | 9 | 9 | 333 | `c84a5aae5a64f203…` |

JS and Rust return identical `{pictures, vclNals}` for each of those four
streams. The command path (`ffmpeg_count_annexb_frames` against a session
file) matches the in-memory counter.

---

## Part 1 — Branch reconciliation (report only — **not merged**)

Fetched `origin/ws3-export-liveness-occlusion` and `origin/ws3-concat-framecount`.
Merge-base with occlusion is `ca9130c` as stated.

### Overlap — STOP

**Two files changed on both branches** after `ca9130c`. Do not merge until the
runtime-recovery agent (owner of `exportPipelineWebCodecs.ts` / `driveGlRun` /
`exportWorker.ts`) resolves them:

| File | concat-framecount (`afa8818`+) | liveness-occlusion (`c118ac1`) |
|---|---|---|
| `src/services/webcodecsExport/exportPipelineWebCodecs.ts` | access-unit `countAnnexbFrames` return shape | flush-occlusion: `appendsInFlight`, `appendPendingAtFailure`, phase-log pulses |
| `src/services/webcodecsExport/driveGlRun.test.ts` | mock `countAnnexbFrames` → `{pictures, vclNals}` | `NO_FLUSH_OBSERVATION` spread on diagnostics fixtures |

Zero overlap was the merge precondition. It is **not** met. Stop.

Occlusion-only (no concat edits): `exportWorker.ts`,
`exportWorkerDiagnostics.ts`, `flushLiveness.test.ts` (commits `481f680`,
`96a6c47`, `c118ac1`).

Concat-only (no occlusion edits): `src-tauri/src/ffmpeg.rs`,
`src/services/tauriFfmpeg.ts`, `annexbFrameCount.ts`,
`annexbFrameCount.test.ts`, `exportPipelineWebCodecs.test.ts`, plus this
round's new files.

### Recommended order (do not execute)

The overlapping files are the other agent's. Merge **this branch into
theirs**, they resolve the two files (keep both the access-unit count shape
and the flush instrumentation).

```
git fetch origin
git checkout ws3-export-liveness-occlusion          # at c118ac1
git merge --no-ff origin/ws3-concat-framecount
# Resolve exportPipelineWebCodecs.ts and driveGlRun.test.ts.
# Rollback SHA if the merge is aborted: c118ac1
#   git merge --abort
#   git reset --hard c118ac1
```

Rollback SHA: **`c118ac1`**.

### Gates on the combined branch

- `npx tsc --noEmit` and `npm run lint`
- `npm test` (this branch's baseline + occlusion's flush tests + this round's adds)
- `cargo test` **and** `cargo test --features fa-inference` (this branch made
  `src-tauri/` non-empty; occlusion did not — the Cargo gates still govern
  after the merge)
- Occlusion's flush destructive probes (`flushLiveness.test.ts`)

---

## Part 2 — Truncation primitive

### No moov to repair

Confirmed. `muxOnly.ts:109-120` remuxes raw Annex-B with `-r <fps> -i <file>
-c:v copy`. There is no MP4 until after this step. A crashed in-progress
`.h264` has no `moov` atom. Salvage is prefix truncation, not container
repair.

### Definition of "complete"

Implemented in JS (`truncateAnnexbToLastCompleteAu` in `annexbFrameCount.ts`)
and Rust (`truncate_annexb_to_last_complete_au` in `ffmpeg.rs`), same rules:

1. **NAL completeness.** A NAL is complete iff it has a start code + header
   byte and either a following start code or EOF. A start code with no header
   (dangling `00 00 01` / `00 00 00 01`) is **not** a NAL; it closes the
   previous NAL so those bytes are not swallowed as payload.
2. **Picture (access unit).** VCL NALs (types 1/5) grouped by
   `first_mb_in_slice == 0`. Continuation slices (`first_mb != 0`) belong to
   that picture. **Does not assume one slice per picture.**
3. **Last picture kept iff** its VCL count equals the mode of the closed
   pictures' VCL counts (established slices-per-picture). A one-picture file
   with no closed predecessor is kept (ended on a NAL boundary).
4. **Cut point.** If the last picture is dropped: the first AUD after the
   previous picture's last VCL, else the dropped picture's first VCL.
   Trailing SPS/PPS of a kept picture stay.

**Residual (documented, not papered over):** a last VCL whose payload is
truncated *after* `first_mb` still parses, on a single-slice stream, looks
like a complete 1-slice picture and is kept. Undetectable in Annex-B (no
length prefix). Do not run this on a known-complete checkpointed piece —
resume should truncate to a **recorded byte offset**, then count.

**Salvage is not this round's call.** The other agent decides whether to
invoke the primitive. Guarantee: after truncate, remaining pictures are
complete access units at the stream's established slices-per-picture; no
partial picture survives in the three fixtures below.

### Fixture results

4 pictures × 8 slices. All three cuts + complete-file no-op + dangling
start-code, JS and Rust:

| Cut | pictures kept | vclNals | partial picture? |
|---|---|---|---|
| mid-NAL (2 bytes into slice 5 of picture 2) | 2 | 16 | no — slice counts `[8, 8]` |
| mid-picture (start of slice 5 of 8) | 2 | 16 | no |
| exactly on picture-2 AUD | 2 | 16 | no |
| complete file | 4 | 32 | no, `bytesRemoved = 0` |
| dangling `00 00 00 01` after complete file | 4 | 32 | no, `bytesRemoved = 4` |

Native command: `ffmpeg_truncate_annexb` (session file, in-place). JS
wrapper: `TauriFfmpeg.truncateAnnexb`. **Neither is called from the
production export pipeline this round.**

### ffmpeg mux of a truncated-but-valid stream

`-r <fps>` with `-c:v copy` assigns per-packet duration from the input
frame rate flag, not from SPS timing. Duration of the remuxed MP4 is
**picture_count / fps** (the reason `-r` exists instead of `-framerate` —
`muxOnly.ts` header, correction 1).

Empirical mux of the **counting fixtures**: ffmpeg rejects them
(`sps_id out of range`, `dimensions not set`). Those streams are
RBSP-minimal (`first_mb` + dummy SPS/PPS) and are not a decodable
bitstream. That is by design.

Empirical mux of a **real** truncated encoder bitstream: **NOT DETERMINED**
this round (no live export, no Part C fixture, no encoder capture). The
production path already muxes complete Annex-B this way; truncate's
guarantee is that its output is a complete-AU prefix of that same class.

---

## Part 3 — Checkpoint manifest (WRITE ONLY)

### Location

`<session_dir>/export_state.json` where `session_dir` is
`$TMPDIR/kinetix-export-{sessionId}` — the same directory as `piece_N.h264`.
Not in project JSON. A crash that skips `ffmpeg_destroy_session` leaves the
session dir; a clean cancel deletes it.

Filename constant: `EXPORT_STATE_FILENAME` in `exportCheckpoint.ts`.

### Invalidation key (precise)

`sourceTimelineHash` = SHA-256 of the canonical JSON (sorted keys) of
`ExportTimelineIdentity`:

- `schema: 1`
- `projectId`
- `voiceoverId`, `voiceoverFileIdentity` (`lastTranscribedFileIdentity`)
- `fps`, `width`, `height`, `aspectRatio`, `resolutionTier`
- `globalTransition`, `globalTransitionDuration`, `globalAnimation`, `globalOverlayFilter`
- every segment: `id, startTime, duration, assetId, trimStart, trimEnd, order, transition, transitionDuration, animation, overlayFilter, showOverlay, text`
- every heading: `id, time, duration, text`
- every text layer: `id, text, hiddenOnSegments`

A checkpoint is stale — and must never be applied — when this hash disagrees
with the project currently in memory. Not mtime. Not project id alone. Not
segment count.

### Per-checkpoint record (justification)

| Field | Why |
|---|---|
| `pieceIndex` | Which orchestrator piece this seam belongs to |
| `encoderSessionIndex` | Which VideoEncoder rotation inside that piece (the natural SPS/PPS+IDR boundary) |
| `byteOffset` | Where to `set_len` / slice the concatenated Annex-B so the remainder can be concatenated after a fresh render |
| `cumulativePictures` | Access-unit count in `[0, byteOffset)` — the post-truncate guard must re-count and match this, not raw VCL |
| `fps`, `width`, `height` | Mux and encoder config; a resolution-tier change must not resume |
| `sourceTimelineHash` | Copy of the manifest hash at write time; a stale row cannot be mixed onto a different timeline (`appendExportCheckpoint` refuses) |

### Writer — inert

`createExportStateManifest` / `appendExportCheckpoint` / `serializeExportState`
in `src/services/webcodecsExport/exportCheckpoint.ts`.

**Not imported** by `exportPipelineWebCodecs.ts`, `exportWorker.ts`,
`driveGlRun`, `encoderSessionPlan.ts`, or any production export caller.
Grep: the only importers are `exportCheckpoint.test.ts`.

Neutrality proof: appending a checkpoint and serializing JSON does not take
Annex-B bytes as input; the test hashes a synthetic stream before and after
`appendExportCheckpoint` and asserts equality, and asserts
`countAnnexbAccessUnits` unchanged.

### Resume path (paper only — not implemented)

1. Load `export_state.json` from the surviving session dir (or refuse if
   missing / `schemaVersion !== 1`).
2. Recompute `sourceTimelineHash` from the live project. Mismatch → discard,
   full re-export. **Never** apply a stale checkpoint.
3. Take the last checkpoint whose `byteOffset` ≤ current file length.
4. `ffmpeg_truncate_annexb` is the wrong tool here if the file already ends
   at a recorded offset. Truncate **to `byteOffset`** (byte slice / `set_len`),
   then `ffmpeg_count_annexb_frames` and require `pictures === cumulativePictures`.
5. Confirm the byte at `byteOffset` begins an IDR with leading SPS/PPS
   (rotation property). If not, refuse.
6. Plan the remainder from the first uncommitted encoder session / piece,
   render it into a new piece file, `ffmpeg_concat_annexb_pieces` of
   `[truncated prefix, remainder…]`, then existing mux.

Files that would change in a resume round (not this one):

- `exportPipelineWebCodecs.ts` — read manifest, skip committed sessions, concat remainder
- `exportWorker.ts` / `driveGlRun.ts` — start a run at a session index, not always 0
- `encoderSessionPlan.ts` — possibly expose remainder starts
- `useExport.ts` / `App.tsx` — UI: resume vs restart (other agent's call)
- `tauriFfmpeg.ts` — already has `truncateAnnexb`; may need truncate-to-offset
- `ffmpeg.rs` — truncate-to-offset if distinct from last-complete-AU
- `exportCheckpoint.ts` — a **reader** + validator (writer already exists)

### Failure mode most worried about

**Byte offset and picture count disagree after a crash that wrote past the
last checkpoint, then a last-complete-AU truncate that dropped a different
number of pictures than the recorded `cumulativePictures`.** Resume would
mux a stream whose duration (`pictures/fps`) does not match the remainder's
timeline origin.

**Guard:** after any truncate, re-run `ffmpeg_count_annexb_frames` and
require `pictures === cumulativePictures` of the checkpoint being applied.
Mismatch → discard checkpoint, full re-export. Second guard: IDR+SPS/PPS at
the seam.

---

## Part 4 — Native cancellation + measured bounds (`ws3-native-cancel`)

### Cooperative cancel (built this round)

`FfmpegSessionState` (`ffmpeg.rs`) holds per-session `Arc<AtomicBool>` cancel
flags, registered in `ffmpeg_create_session`, cleared in `ffmpeg_destroy_session`.

**`ffmpeg_kill_session`** (unchanged JS surface — `TauriFfmpeg.kill()`):
1. Sets the session cancel flag (`Ordering::SeqCst`).
2. Kills any in-flight `ffmpeg_exec` child (unchanged D13 behaviour).

**Poll points** (every **64 KB** read/write iteration, plus entry/exit checks):
- `ffmpeg_concat_annexb_pieces` → `Err("cancelled")`, partial output removed.
- `ffmpeg_count_annexb_frames` → `Err("cancelled")`.
- `ffmpeg_truncate_annexb` → chunked read + chunked write → `Err("cancelled")`.

**Remaining window after this change:** up to **one 64 KB** read/write may
complete after the flag is set (poll is between chunks, not inside `read()`).
`truncate_annexb` additionally holds the full file in RAM for the access-unit
parse between read completion and rewrite — that parse is **not** interruptible;
on a ~1.7 GB file it is usually seconds, not minutes. No other export step is
still unkillable: remux/mux/tier-piece die via process kill; native I/O stops via
the flag.

**Salvage safety:** bound expiry → `kill()` sets flag → a subsequent
`truncateAnnexb` cannot interleave with an orphan concat writer (Rust test
`salvage_interleaving_cancel_then_truncate_leaves_stable_file`).

### When an export is interrupted

1. The UI cancel path (or a liveness bound) calls `ffmpeg.kill()`.
2. Any running **ffmpeg sidecar** is terminated; native concat/count/truncate
   loops observe the flag and stop.
3. The orchestrator surfaces `FfmpegBoundExpiredError` or a user-cancel error;
   the session dir may contain partial piece files — **do not** treat them as
   complete. Use **Export again** (full re-export). Checkpoint **resume** is
   not available yet (see below).
4. `ffmpeg.destroy()` reclaims the temp dir when the export handler finishes.

### Measured bounds (26-minute 1080p30 scale, ~1.7 GB annexb)

Synthetic inputs on an x86_64 macOS SSD worktree (`scripts/ws3-measure-ffmpeg-exec-bounds.sh`
for sidecar steps; native concat on 1.7 GB on-disk blobs; frame-count triplicate
**NOT DETERMINED** — benchmark did not finish cleanly).

| Step | p50 / worst observed | Chosen bound | Headroom (× worst) | Applied? |
|---|---|---|---|---|
| Remux (60 s 1080p30 piece) | 0.14 s / 0.14 s | **30 s** | ~214× | **yes** |
| Concat (1.7 GB native copy) | 0.64 s / 0.64 s | **60 s** | ~94× | **yes** |
| Frame-count (1.7 GB scan) | — / — | **300 s** (prior) | — | **no change** (not measured) |
| Mux video-only (1.7 GB annexb) | 13.78 s / 13.78 s | **180 s** | ~13× | **yes** |
| Mux with-audio (premux + mix) | 13.92 s / 13.92 s | **180 s** (same constant) | ~13× | **yes** |
| Truncate (`ffmpeg_truncate_annexb`) | 3200-picture fixture only | **NOT DETERMINED** at 1.7 GB | — | bound wired by runtime agent |
| Tier-piece (canvas + libx264) | — | **600 s** (prior) | — | **no change** (needs live export) |

Prior unmeasured values retired where measured: remux 120→30 s, concat 600→60 s,
mux 900→180 s.

### Checkpoint RESUME — designed, deliberately not implemented

**Reason:** resume requires rendering the remainder of a partially encoded
timeline — that logic lives in `exportWorker.ts`, `exportPipelineWebCodecs.ts`,
`encoderSessionPlan.ts`, and `driveGlRun.ts`, owned by the parallel
`ws3-salvage-runtime` agent this round. Building both would produce competing
implementations.

**Future round would touch:** `exportPipelineWebCodecs.ts` (manifest reader,
skip committed sessions), `exportWorker.ts` / `driveGlRun.ts` (start run at
session index), `encoderSessionPlan.ts`, `exportCheckpoint.ts` (reader +
validator), `useExport.ts` / UI, and possibly truncate-to-offset in
`ffmpeg.rs` / `tauriFfmpeg.ts`.

---

## Part 5 — Multi-slice fallout

### Production cannot reach the raw-VCL spikes

Two `src/dev/webcodecsStep2Spike/` pipelines still count every type-1/5
start code:

- `exportPipelineWebCodecsSoftwareSpike.ts` `countAnnexbFrames` (~line 773)
- `exportPipelineWebCodecsInstrumentedSpike.ts` `countAnnexbFrames` (~line 598)

Entry points: imported only from `src/dev/webcodecsStep2Spike/main.ts`,
which is the Step 2 spike HTML page (`spike-webcodecs-step2.html`), not
`App.tsx` / `useExport.ts`. `webcodecsToggleConsumers.test.ts` mentions
the path as a string. Production `exportPipelineWebCodecs.ts` uses
`ffmpeg.countAnnexbFrames` (native access-unit counter).
`countAnnexbVclNalsRaw` in `annexbFrameCount.ts` is test-only (destructive
probe).

### Truncation does not assume one slice per picture

Grouping is `first_mb_in_slice == 0` plus spp = mode of closed pictures'
VCL counts. The 8-slice fixtures are the test. A new instance of the
raw-VCL bug in truncate would have kept a 5-slice tail as "5 pictures" or
counted 5 as complete; it drops the incomplete picture instead.

### Windows encoder bitstream — NOT DETERMINED

Still uncaptured. To close:

1. **dxdiag** (or `Get-CimInstance Win32_VideoController`) from the failing
   machine: GPU name, driver version, driver date, BIOS/DirectX.
2. A **short raw `.h264` piece** from a failing export (one encoder session,
   a few seconds), taken from the session dir *before* mux — not the final
   MP4. That is the bitstream `ffmpeg_count_annexb_frames` actually scans.
3. Optional: `ffprobe -show_frames` on that piece for `slice_count` /
   `pict_type`, and the native command's `{pictures, vclNals}` on the same
   file.

Until (2) exists, "Windows hardware encoder emits 8 slices" remains the
working explanation of the 8× inflations, not a captured fact.

---

## Installer checklist (must be true before a build)

- [ ] `git diff --name-only main -- src-tauri/` is **non-empty** and understood
      (`ffmpeg.rs` at minimum). Do not use the empty-diff shortcut.
- [ ] `cargo test` green vs the numbers in Part 0 (or a recorded successor).
- [ ] `cargo test --features fa-inference` green vs the numbers in Part 0.
- [ ] `npx tsc --noEmit` and `npm run lint` clean.
- [ ] `npm test` green with arithmetic vs this branch's baseline.
- [ ] Combined with liveness-occlusion **only after** the two overlapping
      files are resolved (Part 1). Do not ship an installer from a
      conflicted merge.
- [ ] Truncation primitive **not** wired into production salvage unless the
      runtime-recovery agent has taken that decision and the
      `cumulativePictures` re-count guard exists.
- [ ] Checkpoint writer still inert, or a resume round has landed the reader
      + invalidation hash check.
- [ ] Windows bitstream (Part 5) still NOT DETERMINED — do not claim
      multi-slice is closed on Windows until a `.h264` piece is captured.
- [ ] No live-export / Part C fixture required for *this* branch's Cargo +
      vitest gates.

---

## Files this round

| Path | Role |
|---|---|
| `src-tauri/src/ffmpeg.rs` | access-unit count tests vs JS bytes; truncate primitive + command |
| `src-tauri/src/lib.rs` | register `ffmpeg_truncate_annexb` |
| `src/services/tauriFfmpeg.ts` | unused `truncateAnnexb` wrapper |
| `src/services/webcodecsExport/annexbFrameCount.ts` | JS truncate primitive |
| `src/services/webcodecsExport/annexbFrameCount.test.ts` | truncate fixtures + locked hashes |
| `src/services/webcodecsExport/exportCheckpoint.ts` | write-only manifest |
| `src/services/webcodecsExport/exportCheckpoint.test.ts` | hash invalidation + neutrality |
| `src/services/webcodecsExport/ffmpegLivenessBound.ts` | kill-scope comment (concat/count are not ffmpeg children) |
