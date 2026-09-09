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

### Measured bounds — CLOSED 2026-09-10

Synthetic inputs on a macOS internal SSD worktree
(`scripts/ws3-measure-ffmpeg-exec-bounds.sh` for sidecar steps; native steps via
`ffmpeg::tests::measure_streaming_annexb_at_scale` and
`measure_export_scale_native_io_on_disk`, release profile, run **standalone**
under `/usr/bin/time -l` so no cargo build shares the process and the RSS figure
is the scanner's own). Three samples per native cell; p50 = middle, worst = max.

| Step | p50 / worst observed | Chosen bound | Headroom (× worst) | Applied? |
|---|---|---|---|---|
| Remux (60 s 1080p30 piece) | 0.14 s / 0.14 s | **30 s** | ~214× | **yes** |
| Concat (1.7 GB native copy) | 0.834 s / 0.834 s | **60 s** | ~72× | **yes** |
| Frame-count (1.7 GB scan) | 2.714 s / 2.739 s | — (sized at 2.3 GB) | — | — |
| **Frame-count (2.3 GB scan)** | **3.251 s / 3.255 s** | **81.375 s** | **25×** | **yes** |
| Truncate (1.7 GB, scan + set_len + count) | 5.242 s / 5.820 s | — (sized at 2.3 GB) | — | — |
| **Truncate (2.3 GB)** | **6.770 s / 6.907 s** | **172.675 s** | **25×** | **yes** |
| Mux video-only (1.7 GB annexb) | 13.78 s / 13.78 s | **208.8 s** (size-scaled) | ~15× | **yes** |
| Mux with-audio (premux + mix) | 13.92 s / 13.92 s | **208.8 s** @1.7 GB, **282.5 s** @2.3 GB | ~15× | **yes** |
| Tier-piece (canvas + libx264) | — | **600 s** (prior) | — | **no change** (needs live export) |

Prior unmeasured values retired where measured: remux 120→30 s, concat 600→60 s,
mux fixed 180 s → `computeMuxBoundMs(bytes)`, frame-count 300 s → 81.375 s,
truncate 300 s → 172.675 s.

**What the previous round's constants were.** `FRAME_COUNT_BOUND_MS` 18 150 ms
and `TRUNCATE_BOUND_MS` 36 300 ms were derived from 1210 ms and 2420 ms at
2.3 GB. Those two inputs were never measured. Measured, they are 3255 ms and
6907 ms — the invented figures were **2.7×–2.9× too fast**, so the shipped
bounds carried ~5.5× real headroom, not the 15× they claimed. A healthy 2.3 GB
export on a disk barely 6× slower than this machine would have been killed by
its own liveness guard: the same class of defect as the hang it guards against,
self-inflicted. The bounds are now 25× measured worst, chosen so a 2.3 GB export
survives a device 25× slower than an internal SSD.

`computeMuxBoundMs` is KEPT. Verified against the earlier risk table: 13.92 s
worst at 1.7 GB scales to 18.83 s at 2.3 GB, so the flagged row (2.3 GB, two
ffmpeg passes sharing one budget, 10× slower I/O = 188.3 s) is cleared by the
282.5 s the formula yields there, with ~1.5× margin. **Known limit, stated:** at
25× slower I/O a 2.3 GB mux needs 470.8 s and this bound would false-abort. The
native scan bounds are sized for 25×; the mux bound is sized for the 10× bar its
measurement was taken against. `MUX_HEADROOM` was NOT raised this round because
13.92 s at 1.7 GB is the only mux number that exists.

**The `cat` proxy was representative.** `measure_export_scale_native_io_on_disk`
puts the real Rust `ffmpeg_concat_annexb_pieces` at **834 ms** on 1.7 GB against
the earlier `cat` proxy's 640 ms — same order, same shape, proxy optimistic by
~30%. The 60 s concat bound stands.

**A measured ordering reversal.** `FRAME_COUNT_BOUND_MS` (81.375 s) now exceeds
`CONCAT_BOUND_MS` (60 s). That is measurement, not drift: at 1.7 GB the native
concat copy is 834 ms while the access-unit scan is 2.739 s — counting is the
more expensive step. The bound-ordering test's old
`FRAME_COUNT_BOUND_MS < CONCAT_BOUND_MS` assertion encoded an assumption the
first real measurement refuted, and was inverted with the numbers cited inline.

### Memory profile — before and after

**Before (both streaming scanners, as inherited).** Peak memory was **O(file)**,
not O(window), whenever the input did not end at a clean NAL boundary.
`StreamAnnexbNalScanner::drain_complete_nals` and
`AnnexbAccessUnitScanner::drain_complete_nals` both retain the buffer from the
last start code onward, and their only compaction —
`compact_buffer_without_start_codes` / `compact_buffer_tail_without_start_codes`
— is guarded on `buffer_contains_start_code` being **false**. An unterminated
final NAL leaves exactly one start code in the buffer, so that guard holds
forever and every subsequent byte of the file is appended as NAL payload. On top
of the memory, the whole buffer is re-scanned once per 64 KB chunk, i.e. O(n²/chunk).

`compact_buffer_tail_without_start_codes` covered **only** start-code-free
padding, never the unterminated-NAL case — the hazard the count command was
given it for is a strictly narrower one than the hazard that exists.

Measured on the unfixed code: **25 165 828 bytes retained for 24 MiB of trailing
payload, on BOTH scanners.**

Malformed input is not a corner case here — it is the salvage case, a file left
by a crashed or killed export, which is exactly what the truncate primitive is
for. The path is production-reachable.

The fixture generator's dangling `00 00 00 01` before the 0xFF pad does **not**
avoid this: a start code followed by 0xFF is a well-formed NAL header
(`0xFF & 0x1f = 31`) whose payload then runs to EOF. It produces the identical
single-open-NAL shape. That is why `measure_streaming_annexb_at_scale` could not
complete before this fix — a 2.3 GB in-flight NAL re-scanned every 64 KB is
~40 PB of scanning — and why the bounds above could not be measured.

**After.** `MAX_IN_FLIGHT_NAL_BYTES` (8 MiB) caps a single in-flight NAL in both
scanners. Past the cap:

* the **cut path** parks the NAL's head — `start`, `header`, `nal_type`,
  `first_mb`, which is everything the cut decision reads — as `pending` and drops
  the payload; the real `end` is filled in by the next start code, or by `finish`
  at EOF;
* the **count path** counts the NAL from its retained head and drops the payload.

Both keep `ANNEXB_START_CODE_LOOKBACK` (4) trailing bytes so a start code
straddling the next chunk boundary is still found. Dropped payload cannot contain
a start code — RBSP escaping forbids `00 00 01` inside a NAL — so nothing is
lost. Only ONE force-close happens per unterminated NAL: afterwards the buffer
holds no start code, so the ordinary start-code-free compaction keeps it at
~64 KB from then on.

**Bounded working set:** 8 MiB + one I/O chunk per scanner. 8 MiB sits far above
any real H.264 NAL this app emits (a 4K IDR is ~2 MiB worst case), so a
well-formed stream never reaches the cap; and force-closing a legitimately larger
NAL is still **correct**, only slower, because the head that decides everything
has already been parsed. The cap is a memory/performance knob, not a correctness
cliff.

Measured after the fix, at export scale: peak RSS **87 539 712 B (83.5 MiB)** for
a run that writes 4 GB of fixtures and performs six counts and six truncates —
**O(window), confirmed on a 2.3 GB file.**

Regression lock: `stream_nal_scanner_stays_bounded_on_unterminated_trailing_nal`,
`access_unit_scanner_stays_bounded_on_unterminated_trailing_nal` (both failed
before the fix at 25 165 828 bytes against a 10 485 760-byte bound, both pass
after), and `truncate_annexb_on_unterminated_trailing_nal_produces_sane_cut`.

### Counter inventory — production, with file:line

Exactly **two** annexb consumers in production. No third counter.

| Role | Chain | Entry |
|---|---|---|
| Reported `pictures` / `vclNals` | `AnnexbAccessUnitScanner` (`ffmpeg.rs:319`) → `count_annexb_access_units_in_buffer` (`ffmpeg.rs:304`) | `count_annexb_frames_inner` (`ffmpeg.rs:866`), backing `ffmpeg_count_annexb_frames` **and** the reported counts of BOTH truncate commands |
| Cut-point selection | `scan_annexb_nals_from_file` (`ffmpeg.rs:559`) → `StreamAnnexbNalScanner` (`ffmpeg.rs:464`) → `group_pictures_scanned` (`ffmpeg.rs:592`) → `compute_truncate_cut_from_scanned` (`ffmpeg.rs:629`) | `truncate_annexb_inner` (`ffmpeg.rs:927`) |

The in-memory reference implementations (`count_annexb_access_units`,
`group_pictures`, `dropped_picture_cut`, `truncate_annexb_to_last_complete_au`,
`PictureGroup`) are now `#[cfg(test)]` — test oracles, not a third production
counter. `cargo build` is warning-free.

**Could they disagree about where a picture begins?** They did, in the offsets.
`collect_annexb_header_indices` (the counter's own scanner, now deleted) treated
a NAL as beginning at `header - 3` — the three-byte start code's position —
while `scan_annexb_nals` backs up over the leading zero of a four-byte start
code. One byte apart on every four-byte start code. The failure that would
follow: truncate cuts at an offset the counter then interprets as a different
boundary, so the exact-match guard compares against a boundary the cut did not
respect.

**Was a wrong ANSWER reachable? No — traced, not assumed.** The one-byte
difference only ever appends a `0x00` to the END of the payload slice handed to
`parse_first_mb_in_slice`. Appending zero bits to an Exp-Golomb code can add
leading zeros but can never create or destroy a `ue(v) == 0`, and the two
scanners find the identical set of header positions, so `vcl_nals` and the
`first_mb == 0` verdict were always equal. The divergence was real in the
offsets and latent in the verdict.

**Unified anyway,** because "latent" is a property of today's payload parser, not
a guarantee: `count_annexb_access_units_in_buffer` and the count scanner's
retention boundary now both go through `scan_annexb_nals`;
`collect_annexb_header_indices` is deleted. One routine, one answer.
`count_path_and_cut_path_agree_on_every_picture_boundary` locks it, including
four-byte start codes and empty / single-byte VCL payloads.

### The documented residual, restated as a PRODUCTION risk

The residual in Part 2 — *a last VCL whose payload is truncated after `first_mb`
still parses, and on a single-slice stream looks like a complete 1-slice picture,
so it is kept* — is no longer a property of a primitive nobody calls. The salvage
path in `exportPipelineWebCodecs.ts` invokes `ffmpeg.truncateAnnexb` on a GL
piece's file before concat, so this is a shipped behaviour.

**The failure a shipped export would exhibit.** On a single-slice bitstream, a
crash mid-NAL leaves a truncated final slice. Truncate keeps it, having no way in
Annex-B to know the slice is short — there is no length prefix. Concat, the
frame-count guard and mux all pass, because every one of them counts access
units, and by that measure the picture is present. The user gets an MP4 whose
final frame is a corrupt or partially decoded picture — macroblock garbage or a
green/grey band across the last frame — rather than a file that is one frame
shorter. It is a silent wrong-output, not an error.

**Does the streaming rewrite change its reachability?** In neither direction, and
that is a deliberate finding, not an omission. The cut rule is unchanged: a last
picture is kept iff its VCL count equals the mode of the closed pictures' counts.
On a single-slice stream that mode is 1, and a truncated-after-`first_mb` slice
still presents as one VCL NAL with `first_mb == 0`. The streaming rewrite changed
only HOW spans are discovered (chunked instead of whole-file), not WHICH picture
is kept. The new in-flight cap does not touch it either: the cap parks a head and
recovers the exact same `end`, and a truncated final slice is nowhere near 8 MiB.

**The mitigation is unchanged and still unbuilt:** resume should truncate to a
**recorded byte offset** and then count, never infer the cut from the bitstream.
The primitive for that now exists — see the contract below — but nothing calls it.

### `ffmpeg_truncate_annexb_to_offset` — contract

> `ffmpeg_truncate_annexb_to_offset(session, path, byteOffset)` truncates the
> session file to exactly `byteOffset` bytes via in-place `set_len`, refuses
> offsets past EOF, and returns `{ pictures, vclNals, bytesRemoved, keptBytes }`
> where `pictures`/`vclNals` are counted on the kept prefix by the same streaming
> access-unit scanner as `ffmpeg_count_annexb_frames`.

Rust `ffmpeg.rs:915`; JS binding `TauriFfmpeg.truncateAnnexbToOffset`
(`tauriFfmpeg.ts:251`). **Wired to nothing.** It has zero production callers —
it is the primitive the resume path in Part 3 was designed around, shipped ahead
of that path. `ffmpeg_session_file_size` / `TauriFfmpeg.sessionFileSize`
(`tauriFfmpeg.ts:205`) IS live: `exportPipelineWebCodecs.ts:2361` calls it to
size `computeMuxBoundMs`.

### Still NOT DETERMINED

* **Tier-piece bound (600 s).** Unmeasured. Needs a live export, out of scope
  this round (no live exports were run).
* **Mux at 25× slower I/O.** `computeMuxBoundMs` would false-abort a 2.3 GB mux
  there. Only one mux measurement exists (13.92 s at 1.7 GB) and it was not
  re-taken this round.
* **Mux at 2.3 GB.** The 282.5 s figure is the formula's linear extrapolation
  from a 1.7 GB measurement, not a 2.3 GB measurement.
* **Non-SSD and non-macOS numbers.** Every figure above is one macOS internal
  SSD. The 25× headroom is an argument about that gap, not a measurement of it.
* **`ffmpeg_truncate_annexb_to_offset` end-to-end.** Unit-tested, never
  exercised by a real resume, because no resume path calls it.
* **The residual's real-world frequency.** Whether a crashed export actually
  lands mid-slice often enough to matter is unmeasured; only its mechanism is
  established.
* **Windows encoder bitstream.** Unchanged — see Part 5.

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
