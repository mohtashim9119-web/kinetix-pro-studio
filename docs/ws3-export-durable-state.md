# WS3 — Export durable state (truncation primitive, checkpoint writer, native bounds)

> Audit + implementation report for the concat-framecount branch. Not a task
> tracker. Salvage/resume **decision** is owned by the runtime-recovery agent;
> this round supplies the primitive, the write-only manifest, and the native
> Cargo gate.

`src-tauri/` is **intentionally non-empty** on this branch (`ffmpeg.rs` vs
`main`). The empty-diff shortcut does not apply. **Cargo gates govern.**

---

## Round 11 — Audit remediation: fence, mutation invariant, identity v2, budget (2026-09-10)

PROMPT 13 primitive-side remediation on `ws3-durable-resume`. Cross-references
`docs/ws3-export-architecture-ledger.md` by name only.

### STEP 0 — Expected vs Observed

| Gate | Expected | Observed |
|---|---|---|
| `npm test` | 3383 + 6 = **3389** pass / 0 fail / 77 skip (**3466**) | **3389 / 0 / 77 (3466)** twice |
| `cargo test` | 293 + 2 = **295** / 0 / 5 | **295 / 0 / 5** |
| `cargo test --features fa-inference` | 379 + 2 = **381** / 0 / 35 | **381 / 0 / 35** |
| fixture digests | unchanged | unchanged |
| `git diff --name-only main -- src-tauri/` | non-empty | non-empty (`ffmpeg.rs`) |

Vitest +6 (`exportCheckpoint.test.ts`): `repair failure after truncation
returns bitstream_touched, not clean`; `includes timelineIdentityVersion so v1
hashes invalidate`; `each newly covered visual field changes the hash`;
`excluded UI/sync fields do not change the hash`; `old-shape manifest without
budget fields still validates`; `budget exhaustion halts resume with a clean
reason`.

Rust +2 (`ffmpeg.rs`): `resumed_session_blocks_write_during_pending`;
`concat_preserves_partial_output_on_disk_full_error`. Renamed
`resumed_session_blocks_append_count_concat_until_prepared` →
`resumed_session_blocks_bitstream_ops_until_prepared` (expanded surface).

### STEP 1 — C1: gated command surface

| Command | Disposition | Reason |
|---|---|---|
| `ffmpeg_create_session` | **Exempt** | mints a fresh session |
| `ffmpeg_list_resumable_sessions` | **Exempt** | no session id / no bitstream I/O |
| `ffmpeg_reenter_session` | **Exempt** | sets `resume_pending` |
| `ffmpeg_prepare_checkpoint_resume` | **Exempt** | IS the handshake; requires pending |
| `ffmpeg_write_export_state` | **Exempt** | manifest only; needed to read budget before prepare |
| `ffmpeg_session_file_size` | **Exempt** | metadata; `validateExportState` needs length while pending |
| `ffmpeg_read_file` | **Gated** (manifest exempt) | reads bitstream bytes; `export_state.json*` allowed |
| `ffmpeg_write_file` | **Gated** | mutates session media |
| `ffmpeg_write_file_raw` | **Gated** | mutates session media |
| `ffmpeg_append_file_raw` | **Gated** (unchanged) | mutates Annex-B |
| `ffmpeg_count_annexb_frames` | **Gated** (unchanged) | reads/scans bitstream |
| `ffmpeg_truncate_annexb` | **Gated** (new) | mutates bitstream |
| `ffmpeg_truncate_annexb_to_offset` | **Gated** (new) | mutates bitstream |
| `ffmpeg_concat_annexb_pieces` | **Gated** (unchanged) | mutates output bitstream |
| `ffmpeg_delete_file` | **Gated** (new) | can delete bitstream files |
| `ffmpeg_exec` | **Gated** (new) | sidecar can write/read session media |
| `ffmpeg_kill_session` | **Exempt** | cancel path |
| `ffmpeg_destroy_session` | **Exempt** | cleanup |
| `save_session_file` | **Exempt** | delivery copy-out |
| `probe_*` | **Exempt** | no session dir |

**Handshake steps enforced by primitive:** 1–7 (tail inspect → whole-AU repair
→ offset assert → exact-offset truncate → zero-byte re-repair → recount match
→ clear `resume_pending`).

**Still caller discipline:** surviving UUID selection; calling
`prepareCheckpointResume` before append; remainder planner starting at checkpoint
`encoderSessionIndex` / frame index; writing recovery counters at rotation/recovery
seams; fsync ordering at rotation (bitstream durable before manifest — see H8).

Destructive probe: with `ensure_resume_bitstream_fence` removed, write during
pending succeeds (RED); restored, refused (GREEN —
`resumed_session_blocks_write_during_pending`).

### STEP 2 — C2: mutation vs clean

| Return | Mutation before return? | Legal? |
|---|---|---|
| `{kind:'clean'}` from validate (hash/schema/budget/file length) | No | Yes |
| `{kind:'clean'}` from repair throw, file length unchanged | No | Yes |
| `{kind:'clean'}` from repair throw, file length changed | No | **No** → now `{kind:'bitstream_touched'}` |
| `{kind:'clean'}` from post-repair verify mismatch | Yes | **No** → now `{kind:'bitstream_touched'}` |
| `{kind:'resume', repair}` | Yes (intentional) | Yes |
| `{kind:'bitstream_touched', repair}` | Yes | Yes — caller must not reuse file |

New additive variant: `{kind:'bitstream_touched', reason, repair:{keptBytes,
bytesRemoved, …}}`. CC's `{kind:'clean'}` and error handling stay valid.

Probe: `repair failure after truncation returns bitstream_touched, not clean`
(GREEN).

### STEP 3 — C3: timeline identity v2

Added to `ExportTimelineIdentity` (hashed via `timelineIdentityVersion: 2`):

- `globalOverlayConfig`
- per-segment: `overlayConfig`, `extraOverlays`, all `effect*` fields incl.
  `effectGrade`, `effectAnimationScaleRate`
- `assets[]`: `{id, fileIdentity}` sorted by id

**Asset bytes approach:** `fileIdentity = getFileIdentity(file)` when `File` is
in memory; else `${name}|${addedAt}`. **Detects:** replacement with different
size or mtime. **Misses:** same-path same-size same-mtime replacement (content
swap with preserved metadata).

**Deliberately excluded (with reason):**

| Field | Reason |
|---|---|
| `locked`, `anchorStart`, `anchorSource` | sync/timing metadata, not pixels |
| `unmatchedExplicitTag`, `tag`, `rootSegmentId` | parse/sync bookkeeping |
| `HeadingOverlay.needsReview` | UI review flag |
| playhead / selection / UI prefs | not render inputs |
| raw asset blob bytes | cost; cheap identity above |

Old v1 hashes invalidate via `timelineIdentityVersion` bump (no false-match).

### STEP 4 — C7: persisted recovery budget

Optional manifest fields (defaults: rewinds `0`, failover `false`, resume attempts
`0`, total `0`):

- `boundaryRewindsUsed`
- `hardwareFailoverUsed`
- `checkpointResumeAttempts`
- `totalRecoveryAttempts`

Cross-restart bound (matches in-process proof on `dedc3bf`):

- `MAX_BOUNDARY_REWINDS_PER_EXPORT = 2`
- `MAX_HARDWARE_FAILOVER_PER_EXPORT = 1`
- `MAX_DRIVE_GL_RUN_ATTEMPTS_PER_EXPORT = 4` (1 + 2 rewinds + 1 failover)
- `MAX_TRUNCATES_PER_EXPORT = 3`
- `MAX_TOTAL_RECOVERY_ATTEMPTS_PER_EXPORT = 4`

**Worst case across repeated crash/resume:** at most **4** total recovery events
and **3** truncates per export lifetime when counters are persisted at seams.

**Exhaustion:** `validateExportState` returns `{kind:'clean', reason:'recovery
budget exhausted: …'}` — no resume offered.

**CC must write at seams (explicit list):**

1. **Encoder rotation seam:** after pending append batch lands and native
   `sessionFileSize` matches expected offset → `appendExportCheckpoint` →
   `serializeExportState` → `writeExportState` (manifest fsync already native).
2. **After boundary rewind:** increment `boundaryRewindsUsed` and
   `totalRecoveryAttempts` → `serializeExportState` → `writeExportState`.
3. **After hardware failover:** set `hardwareFailoverUsed: true`, increment
   `totalRecoveryAttempts` → `serializeExportState` → `writeExportState`.
4. **Before each resume handshake attempt:** increment `checkpointResumeAttempts`
   and `totalRecoveryAttempts` → `writeExportState` (or fold into post-handshake
   write if attempt fails validation without I/O).
5. **After successful `{kind:'resume'}`:** clear or roll `checkpointResumeAttempts`
   on next rotation checkpoint row as appropriate; continue export.

### STEP 5 — C8 and H8

**C8 disk-full concat:** partial concat output is **preserved** when the error
is disk-full (`StorageFull` / `No space left on device`). All other concat errors
still delete the partial output. **Safety:** production consumes concat output
only after the picture-count guard passes — a partial file cannot become a
deliverable without a shortfall or error.

**H8 durability ordering:** `append_file_raw`, truncate commands, and successful
`prepare_checkpoint_resume` now `sync_all` the Annex-B file before returning.
**Required seam order:** append/truncate bitstream → fsync (native) →
`writeExportState` (manifest fsync). Handshake `byteOffset ≤ fileLen` catches
manifest-ahead-of-durable-length; inverse (durable bytes past checkpoint) is
repaired by whole-AU + exact-offset steps 2–4.

### STEP 6 — Clean findings re-confirmed

Unchanged by this round: picture-accurate production counter; concat two-FD
invariant; guard-to-seal predicate; handshake steps 1–7 now include STEP 1
write/exec/truncate/read gates.

### Additive compatibility

- Old manifest without budget fields validates (`old-shape manifest without budget
  fields still validates`).
- All `TauriFfmpeg` / `exportCheckpoint` public signatures retain compatible shapes;
  new types are additive variants/optional fields only.

---

## Round 8 — Cargo arithmetic, mux measurement, conservative final-AU, seams (2026-09-10)

This section supersedes Round 7's extrapolated 2.3 GB mux bound, the
slices-per-picture mode heuristic as a keep/drop rule, and the claim that
unification was already permanently guarded by sampling. Historical Round 7
text remains below. `docs/ws3-export-architecture-ledger.md` is referenced
by name only and was not edited. Full `npm test` ran twice after CC finished;
both runs were 0 failed.

### STEP 0 — Cargo reconciliation (not a blocker)

`cargo test -- --list` at cut `15002e5` vs HEAD `c03c593`, both feature
configs. Listed counts include ignored tests.

| Config | 15002e5 listed | c03c593 listed | Δ |
|---|---:|---:|---:|
| default | 288 | 293 | **+5** |
| `--features fa-inference` | 404 | 409 | **+5** |

Ignored tests identical (5 default / 35 fa-inference). Names that appear at
`c03c593` and not at `15002e5` — all introduced by `1c2be49`, all intended:

1. `ffmpeg::tests::backwards_tail_inspection_detects_dangling_start_code`
2. `ffmpeg::tests::checkpoint_resume_rejects_picture_count_disagreement`
3. `ffmpeg::tests::checkpoint_resume_repairs_mid_nal_mid_picture_boundary_and_clean_file`
4. `ffmpeg::tests::export_state_write_is_validated_synced_and_replaceable`
5. `ffmpeg::tests::resumed_session_blocks_append_count_concat_until_prepared`

The prompt's "279 + 5 = 288, but observed +9" gap is a **stale baseline**,
not four extra tests on this branch. Actual cut at `15002e5` is **283
passed + 5 ignored = 288 listed**. Four tests already existed at the cut
(introduced on `ws3-export-integration`, not here):

- `stream_nal_scanner_stays_bounded_on_unterminated_trailing_nal` (`2515acb`)
- `access_unit_scanner_stays_bounded_on_unterminated_trailing_nal` (`2515acb`)
- `truncate_annexb_on_unterminated_trailing_nal_produces_sane_cut` (`2515acb`)
- `count_path_and_cut_path_agree_on_every_picture_boundary` (`2a806df`)

Reconciled arithmetic: **279 (stale) + 4 inherited + 5 new = 288** passed
at `c03c593`. fa-inference's 369 baseline already included those four, so
it reconciled at +5 with no cfg/doc-test interaction and no counting error
in the Round 7 *observed* cargo numbers — only in the prompt's 279
baseline. Round 7 docs already stated 283 + 5 = 288; list-diff confirmed
it.

This round then added five more Rust tests (enumerated under STEP 4/5)
and **four** Vitest tests (enumerated below). Post-round default cargo is
**293 passed / 0 failed / 5 ignored** (288 + 5). fa-inference is
**379 / 0 / 35** (374 + 5).

Vitest N vs Round 7's 3456 executed = **+4** (`3456 + 4 = 3460`):

| File | New `it(...)` names |
|---|---|
| `src/services/webcodecsExport/annexbFrameCount.test.ts` | +3: `five fixtures: mid-payload, first_mb, complete+dangling, multi-slice, clean`; `predicate: trailing AUD is complete; EOF-ending VCL is not`; `count path and grouping agree at every byte offset of a small corpus` |
| `src/services/webcodecsExport/muxOnly.test.ts` | +1: `operator-visible offer numbers are the post-final-AU-drop counts` |

Expected vs Observed (Round 8 close).

| Gate | Expected | Observed |
|---|---|---|
| `npm test` count | 3379 + 4 = 3383 pass / 0 fail / 77 skip (**3460**) | **3383 / 0 / 77 (3460)** twice |
| `cargo test` | 288 + 5 = 293 / 0 / 5 | **293 / 0 / 5** |
| `cargo test --features fa-inference` | 374 + 5 = 379 / 0 / 35 | **379 / 0 / 35** |
| fixture `efd16ab5…` (8-slice × 10, 945 B) | unchanged | unchanged |
| fixture `d02aca07…` (1-slice × 12, 444 B) | unchanged | unchanged |
| fixture `b6ce4717…` (param-sets × 3, 126 B) | unchanged | unchanged |
| fixture `c84a5aae…` (short × 9, 333 B) | unchanged | unchanged |

### STEP 1 — AJ-0 oracle-diff flake

Isolated `npx vitest run scripts/ws1-session-aj0-oracle-diff.test.ts -t v6`,
n=5, plus a second 5-run series of the whole file (v6 split out of 3 tests):

| series | walls (s) | p50 | worst |
|---|---|---:|---:|
| `-t v6` | 176.34, 81.44, 76.36, 63.97, 53.59 | 76.36 | **176.34** |
| this-file (3 tests) | 48.6, 90.5, 132.4, 78.9, 77.9 | 78.9 | 132.4 (file-wall worst 160.4) |

Output is deterministic (same oracle diff every run). Not non-deterministic
logic. Combined isolated v6 p50 ≈ 78 s, worst **176.34 s**. The old 180 s
ceiling is **1.02× isolated worst** — no headroom even cold/isolated — and
historically ~2× under full-suite CPU contention. Cause: a fixed-cost
`runProductionPath` sitting against a ceiling with no margin, degraded
further by concurrent load.

Fix: timeout **530_000 ms = 3× isolated worst (176.34 s)** in
`scripts/ws1-session-aj0-oracle-diff.test.ts`. 3× covers the observed
2.7–3.3× isolated span plus the historical ~2× warm-isolated → full-suite
inflation. Raising the timeout is the right fix for a load-sensitive
fixed cost; serialising a reporting check does not remove the 176 s cold
floor. Full-suite confirmation: AJ-0 file **151.2 s** (run 1) and
**184.0 s** (run 2), both well under 530 s, both 3/0/0.

### STEP 2 — Mux measured at 1.7 GB and 2.3 GB

Harness: `scripts/ws3-measure-mux-at-scale.sh`. TMPDIR=
`/var/folders/39/r5vx27154l74y4c2_hp625_w0000gn/T`. Real libx264 Annex-B
GOP tiled by whole copies (no 0xFF, no mid-NAL trim), 21 min WAV, two-pass
muxOnly args, x86_64 sidecar. No duplicate processes; stale scratch purged
first; tail fsync before measure.

| size | actual bytes | pass-1 | pass-2 | total | peak RSS | 25× `computeMuxBoundMs` |
|---|---:|---:|---:|---:|---:|---:|
| 1.7 GB | 1_700_660_619 | 8.370 s | 5.450 s | **13.820 s** | 55_234_560 | **345_500 ms** |
| 2.3 GB | 2_300_238_216 | 13.550 s | 6.920 s | **20.470 s** | 63_279_104 | **511_750 ms** |

Round 7 extrapolation `13.92 × (2.3/1.7) = 18.834 s` vs measured
**20.470 s** → **−1.636 s / 8.0% too fast**. Round 7's 1.7 GB figure
(13.92 s) matches this run to 0.10 s.

Shape is **not linear in annexb bytes**. Pass-1 ratio 13.550/8.370 =
1.619 vs byte ratio 1.353 (I/O of the annexb copy, noisy same order).
Pass-2 ratio 6.920/5.450 = 1.270: AAC of a fixed-length 21 min VO against
`-shortest`, weakly larger premux. Total ratio 1.481. `computeMuxBoundMs`
now interpolates the two measured (pass-1, pass-2) pairs rather than
`total × bytes/1.7GB`. There is no `MUX_BOUND_MS` constant in owned paths.

Owned call sites pass the actual byte length into `computeMuxBoundMs`.
**CC seam (not edited):** `exportPipelineWebCodecs.ts` labels the wrapper
`'MUX_BOUND_MS'` and calls `computeMuxBoundMs(annexbBytes)` where
`annexbBytes` comes from `ffmpeg.sessionFileSize(finalVideoFile)` — actual
size, which is correct.

Old bound 470_824 ms / 20.470 s = **23.0×**, under the 25× floor — that
is why the formula changed. New 511_750 / 20.470 = **25.0×**.

Scratch cleanup: **8,575,616 KiB (8,781,430,784 bytes)** freed from
`$TMPDIR/kinetix-ws3-mux-at-scale-*`. None remained at Round 8 close.
Tier-piece synthetic scratch freed **7,200 KiB**.

### STEP 3 — Tier-piece decomposition

`TIER_PIECE_BOUND_MS = 600_000` spans canvas render, PNG encode, IPC,
libx264, and remux.

| Stage | Measurable? | This round |
|---|---|---|
| 1. Canvas/WebGL render per frame | live export / CC lane | unmeasured |
| 2. PNG encode (`toBlob`) | live / CC | unmeasured |
| 3. IPC `writeFileRaw` per frame | Tauri/live | unmeasured |
| 4. ffmpeg libx264 of the piece | synthetic (lavfi) | **13.94 s** for 60 s 1080p30 ultrafast; RSS ~314 MB. PNG-sequence encode would be slower |
| 5. remux MP4→annexb | already measured | **0.14 s** |

Composed measured stages ≈ 14 s. Unmeasured canvas+PNG+IPC dominate (old
allowance 100 ms × 1800 frames = 180 s, itself unmeasured).

**Verdict 3:** the unmeasured stages dominate so completely that no
synthetic composition constrains 600 s. Closing measurement: one live
canvas-path export of a 60 s 1080p30 piece with per-frame timing. Until
that exists the 600 s value remains hardware-bound / NOT DETERMINED.

### STEP 4 — Conservative final-AU policy

**Predicate** (`nal_begins_next_access_unit` /
`scanned_final_au_is_provably_complete` in `src-tauri/src/ffmpeg.rs`; JS
twin `isFinalAccessUnitProvablyComplete` in `annexbFrameCount.ts`):

> The final access unit is provably complete iff a **fully scanned
> subsequent NAL** begins the next AU — non-VCL (AUD/SPS/PPS/SEI), or VCL
> with `first_mb_in_slice == 0`. A dangling start code with no header is
> **not** enough. A last VCL that ends at EOF is **not** complete.

Keep/drop no longer consults the slices-per-picture **mode** heuristic
(`mode_of` is `#[cfg(test)]` only). Cost of a drop: **one picture,
33.33 ms at 1080p30**.

Constraints proven:

1. **Exact-offset resume untouched.** `truncate_annexb_to_offset_inner`
   does not consult the predicate. `resume_exact_offset_path_untouched_by_final_au_policy`
   compares full bytes of offset-only vs `prepare_checkpoint_resume_inner`
   on mid-NAL, mid-picture, exact-AU-boundary, and clean fixtures.
2. **Clean path byte-identical.** `clean_path_truncate_is_full_bytes_identical`
   compares the entire kept buffer to the input (not a length or hash);
   on-disk `truncate_annexb_inner` leaves the file bytes equal.
3. **Sealing offer uses post-drop counts.** `muxOnly.test.ts`: 900
   expected → 899 kept / 1 lost at 30 fps; pre-drop equal count is
   `null` (not eligible). Counter guard is not compensated.
4. **Counter guard not relaxed.** Dropping a picture enlarges the
   discrepancy by one; `forcedMp4SealOffer` never rewrites measured or
   expected.

Fixtures (Rust + JS): crash mid-payload of a single-slice picture; crash
immediately after `first_mb_in_slice == 0`; crash with a provably complete
final AU (trailing AUD, then dangling start — no drop); multi-slice crash
mid-picture; clean file (`bytesRemoved = 0`). Destructive probes RED then
GREEN: completeness always-true mutated `conservative_final_au_policy_five_fixtures`
(4 vs 3); JS twin the same; restored GREEN.

**New residual:** a last picture that is structurally a complete NAL
(closed by a fully scanned subsequent AU-starting NAL) can still carry
corrupt RBSP. Frequency: the crash must occur *after* the next AU header
was fully written, which is not the mid-payload case that was ~100%
before. Incomplete last pictures (mid-payload, first_mb-only, mid
multi-slice) are now dropped. Structurally complete-then-crash-during-next
is the remaining visual risk, expected rare vs the old ~100% keep of a
~33 KB partial slice.

### STEP 5 — Scanner unification

Both paths derive NAL spans from `scan_annexb_nals` (`ffmpeg.rs:853`)
with no remaining divergent offset arithmetic:

- Count: `count_annexb_access_units_in_buffer` (`ffmpeg.rs:467`) iterates
  `scan_annexb_nals`.
- Cut: `scan_annexb_nals_from_file` (`ffmpeg.rs:722`) →
  `scanned_nal_from_span` (`ffmpeg.rs:608`) → `group_pictures_scanned`
  (`ffmpeg.rs:755`) → `compute_truncate_cut_from_scanned`.

Permanent guard: `count_and_cut_grouping_agree_at_every_byte_offset` —
byte-exhaustive over every prefix offset of multi-2×2, variable-1-3-2,
paramsets-3, and single-aud-2. Sampling is not a substitute. Unification
is complete; no divergence guard was added because none survived.

Variable-slice: `variable_slice_mode_heuristic_is_not_used_for_complete_last_picture`
(`[1,3,2,4]`, mode would pick 1 and drop a complete 4-slice last picture;
completeness keeps it). `group_pictures_scanned` groups by
`first_mb == 0` only; mode is not load-bearing.

Destructive probe: `group_pictures_scanned` `first_mb==0 && false` went
RED on the differential (`[29]` vs `[]`), then GREEN on restore.

### STEP 6 — Durable failure records

A class of bug that has now cost two rounds of forensics: a failing suite
whose failing names, files, durations, and arithmetic lived only in a
terminal buffer.

Mechanism (dependency-free):

- Vitest custom reporter `scripts/vitest-failure-record.ts`, hooked from
  `vite.config.ts`. A **failing** run writes
  `.ws3-test-failures/<UTC>-<HEADSHA>.json` plus `latest.json`. Success
  writes nothing. The reporter never throws.
- `scripts/ws3-record-test-run.mjs` (`npm run test:record`) for cargo and
  filtered vitest. Unfiltered vitest is refused (coordinator-gated).
- `npm run test:failure-record` prints `latest.json`.
- Output path is gitignored (`.gitignore` named `.ws3-test-failures/`).

Read: `cat .ws3-test-failures/latest.json`.

### STEP 7 — Seam contracts (owned files only; CC files not edited)

#### Sealing-offer seam — `SealingOfferSeam` (`muxOnly.ts`)

Exported symbols: `forcedMp4SealOffer`, `sealTruncatedAnnexbToMp4`,
types `ForcedMp4SealOffer`, `ForcedMp4SealDisposition`, `SealingOfferSeam`.

**CC must supply, and nothing else:**

1. `measured` — the concat guard's unmodified `{pictures, vclNals}` after
   salvage-truncate (post-final-AU-drop counts, never pre-drop).
2. `picturesExpected` — the same expected count the guard compared against.
3. `fps` — the export frame rate used for wall-duration.
4. `operatorConsented` — explicit operator yes/no; this helper never infers it.
5. ffmpeg session + `videoFile` / `audioFile` / `outputFile` paths for seal.

Preconditions: the concat frame-count guard has already reported the
discrepancy. This seam must not rewrite either count, suppress the guard,
or run before the guard. `measured.pictures` is the post-policy kept count.

Postconditions: `null` / `not-eligible` when there is no non-empty true
shortfall; `consent-required` with the offer when eligible and consent is
absent (no ffmpeg call); `sealed` with the same offer after muxOnly when
consent is present. Duration is pictures/fps, never container metadata.

Errors: muxOnly failures throw; eligibility failures do not throw.

Call ordering: guard reports → `forcedMp4SealOffer(measured, expected, fps)`
→ UI consent → `sealTruncatedAnnexbToMp4({..., operatorConsented: true})`.

#### Resume handshake seam — `ResumeHandshakeSeam` (`exportCheckpoint.ts`)

Exported symbols: `validateExportState`, `prepareCheckpointResume`,
`appendExportCheckpoint`, `serializeExportState`,
`createExportStateManifest`; types `ResumeHandshakeSeam`,
`ExportCheckpointResumeIo`, `ExportCheckpointPreparation`.

**CC must supply, and nothing else:**

1. The surviving session id (from `TauriFfmpeg.listResumableSessionIds` +
   `reenter`) — never mint a new UUID for a resume.
2. `serializedManifest` bytes from `export_state.json`.
3. `expected` identity: `{projectId, sourceTimelineHash, fps, width, height}`
   of the project currently in memory (`buildSourceTimelineHash` of
   `timelineIdentityFromProject`).
4. The surviving Annex-B `path` inside that session.
5. An `ExportCheckpointResumeIo` whose `prepareCheckpointResume` is
   `TauriFfmpeg.prepareCheckpointResume` (native atomic handshake).
6. Rotation-seam call sites that call `appendExportCheckpoint` then
   `serializeExportState` then `TauriFfmpeg.writeExportState`. CC does
   not design the write; those three are the complete writer primitive.

HARD PRECONDITION — pre-append fence ordering, native and mandatory:

1. find the final start code (backwards tail inspection)
2. unconditional whole-AU repair (`ffmpeg_truncate_annexb`)
3. assert repair did not fall before the checkpoint byte offset
4. exact-offset truncate (`ffmpeg_truncate_annexb_to_offset`)
5. re-repair asserting `bytesRemoved == 0`
6. recount; assert `pictures == cumulativePictures`
7. only then clear `resume_pending`

`prepareCheckpointResume` (JS) + `ffmpeg_prepare_checkpoint_resume`
(Rust) already perform that order. CC must not append, count, or concat
while `resume_pending` is set, and must not skip `prepareCheckpointResume`.

Postconditions: `{kind:'resume', repair}` with `keptBytes === byteOffset`
and `pictures === cumulativePictures`, fence cleared; or `{kind:'clean'}`
with a reason and no Annex-B mutation from the JS validator.

Errors: native repair failure → `{kind:'clean'}`; hash/schema/monotonicity
mismatch → `{kind:'clean'}` without Annex-B I/O.

Call ordering: list/reenter → readExportState → prepareCheckpointResume →
(only on kind=resume) append remainder. Writer at a rotation seam:
appendExportCheckpoint → serializeExportState → writeExportState.

The checkpoint writer API is complete and tested as a callable primitive
(`export_state_write_is_validated_synced_and_replaceable` plus the JS
checkpoint tests). CC only supplies rotation-seam call sites.

### STEP 8 — Six-row bound register

Recomputed against this round's mux measurements and Round 7
frame-count (81_375) / truncate (172_675). Break-even is the I/O/CPU
multiple at which the bound false-aborts a healthy export.

| Bound | Current value | Source | Measurement p50 / worst | Headroom | Break-even | False-abort risk |
|---|---|---|---|---:|---:|---|
| remux | 30_000 ms | measured | 0.14 s / 0.14 s | ~214× | **~214×** | low |
| concat | 60_000 ms | measured | 0.64 s / 0.64 s (1.7 GB) | ~94× | **~94×** | low |
| frame-count | 81_375 ms | measured | p50 3.251 s / worst 3.255 s @ 2.3 GB | 25× | **25×** | sized |
| truncate | 172_675 ms | measured | p50 6.770 s / worst 6.907 s @ 2.3 GB | 25× | **25×** | sized |
| mux | 345_500 ms @ 1.7 GB; **511_750 ms @ 2.3 GB** | **measured this round** | 13.820 s / 20.470 s (n=1 per size; used as both p50 and worst) | 25× | **25×** | superseded 470_824 ms was **23.0× vs measured 2.3 GB — under 25×, flagged**. Current 25.0× |
| tier-piece | 600_000 ms | hardware-bound | unmeasured canvas/PNG/IPC; synthetic encode 13.94 s | n/a | **NOT DETERMINED** | verdict 3; cannot be constrained synthetically |

No current sized bound sits under 25×. The deleted
`FRAME_COUNT_BOUND_MS < CONCAT_BOUND_MS` assertion stays deleted.

**Invariant:** the five opaque bounds (remux, concat, frame-count,
truncate, mux) are finite, positive, independently sized, and carry **no
valid cross-step ordering**. They measure different workloads
(stream-copy of one piece, native concat, native scan, salvage rewrite,
two-pass mux). A numeric `<` between them is not a safety property.

### `ffmpeg_truncate_annexb_to_offset` contract (restated)

`ffmpeg_truncate_annexb_to_offset(session, path, byteOffset)` truncates
the session file to exactly `byteOffset` bytes via in-place `set_len`,
refuses offsets past EOF, and returns `{pictures, vclNals, bytesRemoved,
keptBytes}`. It does not consult the salvage completeness predicate.
Round 8 did not change this contract.

### Round 8 gates

| Gate | Result |
|---|---|
| `npx tsc --noEmit` | clean |
| `npm run lint` | clean (`tsc --noEmit`) |
| `cargo build` | warning-free |
| `cargo test` | 293 / 0 / 5 |
| `cargo test --features fa-inference` | 379 / 0 / 35 |
| `git diff --name-only main -- src-tauri/` | non-empty (`ffmpeg.rs`, `lib.rs`) |
| four fixture digests | unchanged |
| targeted Vitest (changed files) | 56 / 0 / 0 |
| `npm test` run 1 | **3383 / 0 / 77 (3460)** in 390 s; AJ-0 file 151.2 s |
| `npm test` run 2 | **3383 / 0 / 77 (3460)** in 457 s; AJ-0 file 184.0 s |
| benchmark scratch | cleaned; **8,781,430,784 bytes** mux + 7,200 KiB tier-piece |

Destructive probes (RED then GREEN): final-AU completeness predicate;
clean-path byte neutrality; resume-path byte-exactness; sealing offer
post-drop numbers; scanner differential / grouping mutation. No
divergence guard was added.

This round's five new Rust tests:

1. `ffmpeg::tests::conservative_final_au_policy_five_fixtures`
2. `ffmpeg::tests::count_and_cut_grouping_agree_at_every_byte_offset`
3. `ffmpeg::tests::variable_slice_mode_heuristic_is_not_used_for_complete_last_picture`
4. `ffmpeg::tests::clean_path_truncate_is_full_bytes_identical`
5. `ffmpeg::tests::resume_exact_offset_path_untouched_by_final_au_policy`

---

## Round 7 [Cursor lineage] — Rung 2b sealing + Rung 4 durable resume (2026-09-10)

> Round-number collision, disambiguated Round 16: `docs/ws3-export-architecture-ledger.md` carries a
> DIFFERENT "Round 7" (CC lineage, `ws3-tier1-close`, 2026-09-10/11 — Tier 1 closeout + Rung 3
> re-render). Every "Round 7" reference in THIS file means this entry; the ledger's Round 16 entry
> carries the cross-lineage round-number map.

This section supersedes this report's earlier "WRITE ONLY", "wired to
nothing", 15× mux-headroom, and bound-ordering statements. The historical
sections remain below because they explain how the current design was reached.
`docs/ws3-export-architecture-ledger.md` is referenced by name only and was not
edited.

### Scope result and production-wiring blocker

All implementation in this round stayed inside the assigned paths:
`src-tauri/**`, `tauriFfmpeg.ts`, checkpoint code, `muxOnly.ts`,
`ffmpegLivenessBound.ts`, their tests, and this report. No change was made to
`exportWorker.ts`, `exportPipelineWebCodecs.ts`, `encoderSessionPlan.ts`,
`driveGlRun*`, `App.tsx`, or `docs/ws3-export-architecture-ledger.md`.

That scope has one unavoidable consequence. The exact concat frame-count guard
and the fresh-session export entry point both live in
`exportPipelineWebCodecs.ts`, an explicitly forbidden path. Therefore:

- the existing guard remains byte-for-byte untouched and still receives the
  count returned after `concatAnnexbPieces`;
- Rung 2b's post-guard sealing predicate and actual MP4 sealing helper are
  implemented and tested, but the guard's failure branch cannot offer/call them
  until that owner wires the disposition after reporting the discrepancy;
- Rung 4's reader, validator, session discovery/re-entry, native pre-append
  fence, repair, and exact-offset recount are implemented and tested, but the
  export entry point cannot choose a surviving session or plan/render the
  remainder until that owner wires it.

This is not reported as end-to-end production resume. The owned primitives are
complete; the two caller integrations are blocked by the path prohibition.

### Rung 2b — forced MP4 sealing

`muxOnly.ts` now exposes `forcedMp4SealOffer` and
`sealTruncatedAnnexbToMp4`.

Eligibility is deliberately narrow: canonical measured pictures must be
non-zero and strictly less than expected pictures. An equal count is not a
shortfall; an excess count is not truncation and remains an error. The helper
does not rewrite either count, suppress the existing guard, or turn its result
green. It is a post-guard disposition only.

The result is typed with:

- `picturesKept`
- `picturesExpected`
- `picturesLost`
- `keptWallDurationSeconds = picturesKept / fps`
- `lostWallDurationSeconds = picturesLost / fps`
- `fps`

The MP4 is produced by the existing `muxOnly` path, preserving `-r <fps>`,
the two-pass audio rule, H.264 stream copy, AAC audio, and bt709 tags. Duration
comes from picture count and fps, never raw-stream/container metadata.

**Consent decision: explicit operator consent.** The application knows it is
about to produce a shorter deliverable than requested. Automatic sealing would
turn a loud correctness failure into silent data loss. The current architecture
already returns a typed export error and has no owned recovery UI surface, so
the safe additive behavior is: report the exact guard discrepancy first, offer
the measured loss, and seal only after explicit consent. The helper performs no
ffmpeg call when consent is absent.

Destructive predicate probe:

- RED mutation: changed `measured.pictures >= picturesExpected` to `>`.
  The equal-count fixture incorrectly produced an offer with zero pictures and
  zero seconds lost; the test failed 1/1.
- GREEN restoration: strict shortfall restored; the same test passed 1/1.

### Rung 4 — manifest validation, session re-entry, and mandatory repair

`export_state.json` remains at
`$TMPDIR/kinetix-export-{sessionId}/export_state.json`.
`TauriFfmpeg.writeExportState` uses the native
`ffmpeg_write_export_state` command: JSON is validated, written to a sibling
temporary file, `sync_all` is called, then it is renamed over the manifest.

`validateExportState` treats disk data as `unknown` and validates:

- schema version and UUID session id;
- project id;
- SHA-256 `sourceTimelineHash` of canonical
  `ExportTimelineIdentity` JSON;
- fps, width, and height;
- every checkpoint's piece index, encoder-session index, byte offset,
  cumulative picture count, fps, resolution, and hash;
- strict monotonic movement of `(pieceIndex, encoderSessionIndex)`,
  `byteOffset`, and `cumulativePictures`;
- selection of the latest checkpoint whose byte offset fits the surviving
  file.

Any malformed field, stale hash, configuration mismatch, non-monotonic row, or
missing usable checkpoint returns `{kind: "clean"}`. Hash mismatch performs no
Annex-B operation. The owner call site must then create a fresh UUID session.

Native re-entry no longer assumes a fresh UUID:

- `ffmpeg_list_resumable_sessions` enumerates only UUID-named
  `kinetix-export-*` directories containing `export_state.json`;
- `ffmpeg_reenter_session` verifies the existing directory/manifest, restores
  the cancellation flag, and marks the session `resume_pending`;
- native append, count, and concat all reject a `resume_pending` session;
- only successful `ffmpeg_prepare_checkpoint_resume` clears the fence.

The pre-append native order is mandatory and atomic from the renderer's point
of view:

1. find the final start code by bounded backwards file reads and record whether
   it has a header;
2. run canonical whole-access-unit truncation unconditionally;
3. require that repair did not fall before the recorded checkpoint;
4. truncate exactly to checkpoint `byteOffset`;
5. run canonical whole-AU truncation again and require `bytesRemoved == 0`;
6. recount with `AnnexbAccessUnitScanner`;
7. require `pictures == cumulativePictures`;
8. only then clear `resume_pending`.

On any error, append/count/concat remain blocked. The frontend
`prepareCheckpointResume` adds manifest/hash validation before entering that
native handshake and independently checks returned kept bytes and pictures.

Required fixtures:

| Fixture | Expected result |
|---|---|
| crash mid-NAL | repair then exact checkpoint; 2 pictures kept |
| crash mid-picture, 8 slices/picture | partial picture dropped; 16 VCL / 2 pictures |
| exact AU boundary | byte-exact no-op |
| clean complete bytes | mandatory repair still runs; `bytesRemoved = 0` |
| stale `sourceTimelineHash` | `{kind:"clean"}`; zero repair calls; bytes unchanged |

Additional native fixtures cover the pre-append append/count/concat fence,
backwards detection of a dangling start code, picture-count disagreement, and
the same four byte-cut shapes through the Rust command core.

Destructive pre-append probe:

- RED mutation bypassed `io.prepareCheckpointResume` while fabricating matching
  returned counts. The mid-NAL fixture failed because repair calls were 0,
  proving the fixture reaches the mandatory handshake rather than merely
  checking settled metadata.
- GREEN restoration passed the same test.

Destructive hash-invalidation probe:

- RED mutation disabled the `sourceTimelineHash` comparison. The stale fixture
  resumed and physically truncated the bytes (reported 186 bytes removed),
  failing against the required clean/no-touch result.
- GREEN restoration passed and made zero repair calls.

**Remaining owner work:** selecting the matching surviving session, writing
checkpoints at real encoder-rotation seams, and rendering/concatenating the
remainder require `exportPipelineWebCodecs.ts` and the worker/session-plan paths.
Those paths were prohibited this round.

### Bounds — 25× mux fix and five-bound invariant

`MUX_HEADROOM` is now 25, closing the old 10×/15× gap.

| Input size | Measured/scaled two-pass mux | 10× slow I/O | 25× slow I/O / chosen bound |
|---|---:|---:|---:|
| 1.7 GB | `9.22 + 4.70 = 13.92 s` | `139.20 s` | `348.00 s` |
| 2.3 GB | `13.92 × 1.353 = 18.834 s` | `188.34 s` | `470.84 s` |

The implementation uses the exact `2.3 / 1.7` ratio, so
`computeMuxBoundMs(2_300_000_000)` returns **470,824 ms**; 1.7 GB returns
**348,000 ms**.

The refuted `FRAME_COUNT_BOUND_MS < CONCAT_BOUND_MS` assertion is deleted.
The actual invariant is that the five heterogeneous opaque bounds
(remux, concat, frame count, truncate, mux) are finite, positive, and each
sized from its own workload. There is no valid cross-step ordering. Current
values are 30,000 / 60,000 / 81,375 / 172,675 / 348,000 ms at 1.7 GB.

`TIER_PIECE_BOUND_MS = 600,000` cannot be measured by a synthetic disk scan.
It includes canvas rendering, raw IPC, browser scheduling, hardware/software
encoder behavior, and ffmpeg. Its 10-minute value remains **hardware-bound /
NOT DETERMINED** until a live representative export is run.

### Scanner identity, residual cut, and memory

Truncate reports `pictures` and `vclNals` from
`count_annexb_frames_inner` → `AnnexbAccessUnitScanner`, the same canonical
count path as `ffmpeg_count_annexb_frames`. The cut path remains
`scan_annexb_nals_from_file` → `group_pictures_scanned` →
`compute_truncate_cut_from_scanned`, but both paths derive NAL spans through
the same `scan_annexb_nals` routine. The old four-byte-start-code offset
disagreement was unified; its verdict-level wrong answer was traced as
unreachable because the extra terminal zero could not change
`first_mb_in_slice == 0`. The boundary-agreement differential test remains.

Residual single-slice risk after `first_mb_in_slice == 0`:

- for a representative ~33 KB single-slice picture, almost the entire slice
  follows the few first_mb bits; a uniformly timed crash within that write has
  nearly 100% opportunity to leave a tail that still parses as a picture start;
- maximum corrupt tail retained by the inference-only salvage rule is about
  33 KB; expected retained partial payload under a uniform cut is about
  16.5 KB;
- at 1080p30 the symptom is one corrupt final picture spanning **33.33 ms**;
  at 1080p60 it spans **16.67 ms**;
- it is a visual corruption risk, not trustworthy duration. A decoder may show
  macroblock/green-grey damage or drop the picture;
- the streaming rewrite and 8 MiB cap do not change reachability. Checkpoint
  resume removes the risk by using the recorded byte offset after canonical
  repair, rather than trusting the inferred single-slice EOF.

`compact_buffer_tail_without_start_codes` by itself still handles only a tail
with no start code. An open trailing NAL necessarily contains its own start
code, so both scanners use the explicit `MAX_IN_FLIGHT_NAL_BYTES` path: count
parks/counts the parsed head; cut parks `ScannedNal` metadata; both retain only
four bytes of lookback. This distinction matters—the function name is not
evidence that it covered open NALs.

The large unterminated-NAL Rust probes now use a fixed independent 10 MiB
ceiling. The earlier assertion derived its bound from
`MAX_IN_FLIGHT_NAL_BYTES`; raising the production cap raised the test's limit,
so the supposed coverage stayed green.

Destructive memory probe:

- first RED attempt raised the cap 8→64 MiB and unexpectedly stayed green,
  exposing the moving-goalpost test;
- after fixing the fixture's ceiling at 10 MiB, the same mutation failed both
  paths at **25,165,829 retained bytes**;
- restoring 8 MiB passed both tests;
- the real file truncate fixture also proves a >12 MiB unterminated final NAL
  is cut back to the valid prefix.

### `ffmpeg_truncate_annexb_to_offset` contract

`ffmpeg_truncate_annexb_to_offset(session, path, byteOffset)` truncates the
session file to exactly `byteOffset` bytes via in-place `set_len`, refuses
offsets past EOF, and returns `{pictures, vclNals, bytesRemoved, keptBytes}`.

### Prior-failure reconstruction (Step 5)

The prior transcript/reflog preserves that the initial npm baseline was
**3353 passed / 5 failed / 77 skipped**, all classified there as WS1
`runProductionPath` timeouts. Four identities remain recoverable from this
report's earlier record:

1. `aj0-oracle-diff` v6
2. `q-production-pins` R.12
3. `s-exclusion` R.11
4. `s-measure` R.12 descriptors

The fifth test name is absent from the surviving terminal files, commit
messages, reflog, and redacted transcript output. It is formally closed as
**unrecoverable evidence**, not guessed.

The first post-fix `cargo test --features fa-inference` run is preserved only
as **360 passed / 1 failed / 34 ignored** and described as one flaky failure.
The subsequent command intended to print the test identity has no surviving
terminal output and the transcript redacts the result. Its identity is also
formally closed as **unrecoverable evidence**.

### Round 7 gates

Round 7 added **10 executed Vitest tests** (6 checkpoint/resume, 4 sealing)
and **5 Rust tests** (resume fence, four-shape repair, mismatch, backwards
tail, durable manifest replace).

| Gate | Expected | Observed |
|---|---|---|
| `npx tsc --noEmit` | clean | clean |
| `npm run lint` | clean | clean (`tsc --noEmit`) |
| `cargo build` | clean, warning-free | clean, 0 warnings |
| Vitest total arithmetic | `3446 + 10 = 3456` | 3456 in both full runs |
| `npm test` run 1 | 3379 pass / 0 fail / 77 skip | 3366 / 13 / 77; sandbox EPERM, WS1 timeouts/artifact writers, two decode timing timeouts, timing-budget failure |
| `npm test` run 2 (unrestricted) | 3379 / 0 / 77 | 3378 / 1 / 77; only AJ-0 v6 180 s timeout |
| isolated AJ-0 follow-up | 3 / 0 / 0 | 3 / 0 / 0 in 91.16 s |
| targeted changed Vitest files | 52 / 0 / 0 | 52 / 0 / 0 |
| `cargo test` | actual cut 283 + 5 = 288 / 0 / 5 | 288 / 0 / 5 |
| `cargo test --features fa-inference` | 369 + 5 = 374 / 0 / 35 | 374 / 0 / 35 |
| locked fixture digests | all four unchanged | all four unchanged; locked-hash test 1/1 |
| `git diff --name-only main -- src-tauri/` | non-empty, expected paths | `src-tauri/src/ffmpeg.rs`, `src-tauri/src/lib.rs` |

The prompt's default-Cargo baseline said 279 / 0 / 5, but this branch was cut
after `2515acb` (+3 scanner tests) and `2a806df` (+1 scanner-unification test);
its own cut baseline is 283 / 0 / 5. Thus observed 288 is actual-cut
`283 + 5`, not an unexplained four-test addition. The supplied feature baseline
already included those inherited tests.

The second full Vitest run is the valid unrestricted gate. Its sole failure is
the historical `runProductionPath` wall-time class, and the exact failed file
passed immediately in isolation. No export/checkpoint/sealing test failed.
This is recorded as a non-green full-suite gate rather than misreported as
green.

Named-path implementation commits:

- `1c2be49` — native session re-entry, pre-append fence/repair, durable manifest
- `989f9c1` — TypeScript checkpoint reader/validator and native bindings
- `dea7953` — explicit-consent forced MP4 sealing helper
- `3e817df` — 25× mux liveness bound and five-bound invariant

No test-mock or script path required a change; no empty/manufactured commit was
created for those groups. The docs commit follows this section.

### Still NOT DETERMINED

- Live production guard → sealing-offer call site: owner-blocked by forbidden
  `exportPipelineWebCodecs.ts`.
- Live checkpoint writing, session selection, remainder planning/rendering,
  and concat: owner-blocked by forbidden orchestrator/worker/session-plan paths.
- Tier-piece 600 s bound: hardware-bound; requires a live representative
  export.
- Windows hardware encoder bitstream and real-world single-slice crash
  frequency: hardware/operator evidence required.
- 2.3 GB mux timing is a linear extrapolation from the measured 1.7 GB run,
  not a direct 2.3 GB measurement.


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

---

## Round 14 — C5/C6/H5/H10/C7/H9 consumer-side wiring + durable writes (2026-09-11)

`ws3-hardening-windows` STEPs 7-10 (fresh session, not the `ws3-durable-resume`
branch Rounds 11/13 above). Cursor's native H5/H10 commands (already merged at
STEP 3) get their frontend consumer here; C7's five manifest writes and C5/C6/H9
are pure TS/Rust hardening with no native-command dependency.

### STEP 7 — C5: discarded-batch accounting

`finish()` in `exportPipelineWebCodecs.ts` cleared `pendingBatch` and let any
already-queued-but-unlanded batch bail silently on watchdog / queue-overflow /
worker-error / cancel, with nothing in the payload distinguishing "the encoder
never produced these bytes" from "we threw away bytes the encoder already
produced." `ExportAppendLedger.discardedAtFinish: {chunks, bytes} | null` now
names that population, populated at the terminal snapshot only (both
`finish()`'s own ledger and the one embedded in `ExportError.liveness`, which is
what the operator's Copy-diagnostics blob actually reads). Every abnormal-finish
message now states explicitly: "N chunk(s) / N byte(s) already produced by the
encoder were discarded by this abort ... not a shortfall in the encoder's own
output."

**Per-path decision:** watchdog / queue-overflow / worker-crash keep
account-and-report (the writer may genuinely be stuck; waiting to drain risks an
unbounded hang or growing the backlog being aborted). `cancel` switches to
flush-then-fail — `'cancelled'` is the worker's own terminal message (same
contract as `'done'`/`'salvage-done'`), so draining via the existing
`noteTerminalMessage`/`APPEND_DRAIN_BOUND_MS` machinery is safe.

Commit: `2bb06fa`. 4 new destructive probes in `appendBatching.test.ts`.

### STEP 8 — C6, H5, H10

**C6** — `TauriFfmpeg.destroy()` (console.warn-only) and `muxOnly.ts`'s
premux-intermediate delete (completely silent — no warn at all) now both record
into a new bounded ledger, `exportCleanupNotices.ts` (localStorage-backed).
`useExport.ts` reads and clears it at the start of the NEXT export, surfacing
`UseExportState.cleanupNotices`.

**H5** — `evaluateResumeCandidate` (`exportResumeDiscovery.ts`) now calls the
already-merged `ffmpeg_read_session_claim` BEFORE `reenter`: `live` (different
process) blocks with a distinct `liveClaimBlocked` rejection — "another window
is using this session" — without attempting `reenter` at all; `stale` proceeds
and stamps `ResumableExport.staleClaimRecovered` for a separate "recovering an
abandoned session" notice. `readSessionClaim` is optional on `ResumeDiscoveryIo`
so every pre-existing test fake needed zero changes; production's `tauriIo`
always supplies it.

**H10** — `TauriFfmpeg.sweepOrphanSessions()` (already-merged
`ffmpeg_sweep_orphan_sessions`) wired into `useExport.ts`, run once per export
start before the fresh session exists. `pendingDelete` (Windows: `remove_dir_all`
returned Ok but an open handle kept the directory alive) is surfaced separately
from `bytesReclaimed`, never conflated — enforced in Rust by extracting
`classify_remove_outcome` (Deleted / PendingDelete / VanishedBeforeDelete) as a
pure function, since the real global-temp-dir-scanning `sweep_manifestless_orphans`
was deliberately NOT called from a new test (risk of racing/deleting another
concurrently running test's own session directory under `cargo test`'s default
parallelism). Disk exposure this closes: ~1.7-2.3 GB per orphaned session
directory (measured reference/sizing cases, `exportResumeDiscovery.ts`'s
cleanup-policy header — carried forward from that prior measurement, not
re-measured this round).

Commit: `ee406dd`. 6 probes (`exportResumeDiscovery.test.ts`), 1
(`exportResumeSession.test.ts`), 2 (`muxOnly.test.ts`), 5
(`exportCleanupNotices.test.ts`), 4 Rust (`session_claim.rs`).

### STEP 9 — C7: five durable writes + checkpoint coverage

Write #1 (rotation checkpoint + serialize on a verified landed batch) was
already fully wired since Round 10/STEP 3 — confirmed unchanged. Writes #2-4
(`recordBoundaryRewind`/`recordHardwareFailover`/`recordResumeAttempt`, pure,
each bumps its own counter AND `totalRecoveryAttempts`) added to
`exportCheckpoint.ts`, wired via new `ExportCheckpointWriter` methods called at
the exact three call sites in `exportPipelineWebCodecs.ts`. Write #5 (roll
forward across a resume) is automatic: `adoptManifest` keeps the whole existing
manifest object and nothing downstream resets the counters.

**Real bug found and fixed:** the in-memory `boundaryRewindsUsed`/
`hardwareFailoverUsed` locals were unconditionally 0/false at the top of EVERY
process, including a resumed one — so a resumed run always got a fresh
`MAX_BOUNDARY_REWINDS_PER_EXPORT` budget on top of whatever the crashed process
already spent. **Two sources of truth, and which is authoritative:** the
in-memory counter gates THIS process's own next-rewind decision
(`decideBoundedRerenderDisposition`); the persisted `totalRecoveryAttempts`
gates whether a NEW process may resume AT ALL (`isRecoveryBudgetExhausted`,
checked once at discovery time). Without seeding the in-memory counter from
`resume.manifest`, these two gates could disagree and the cross-restart bound
(2 rewinds / 1 failover / 4 total recovery attempts / 3 truncates,
`MAX_BOUNDARY_REWINDS_PER_EXPORT`/`MAX_HARDWARE_FAILOVER_PER_EXPORT`/
`MAX_TOTAL_RECOVERY_ATTEMPTS_PER_EXPORT`/`MAX_TRUNCATES_PER_EXPORT` in
`exportCheckpoint.ts`) would be silently wider than documented across a resume.
Fixed by seeding both from `resume.manifest`. Destructive probe
(`hardwareFailoverWiring.test.ts`): a resumed run whose manifest already shows
the rewind budget at MAX goes straight to the one remaining failover attempt on
its FIRST hang, never a fresh rewind first.

**Checkpoint coverage:** the existing `exportCheckpointPlacement.test.ts`
"holds at every rotation seam" test only proved coverage against the WHOLE
remaining stream; production hands `fenceSafeCheckpointOffset` just the first
post-seam append batch. Added a PRODUCTION-GRANULARITY test (smallest real
batch = exactly one encoder 'chunk', atomic per `exportWorker.ts`'s
`output` callback) — coverage is still total for realistic encoder-shaped
content. NOT content-dependent: it follows from every access unit carrying a
leading AUD (`avc:{format:'annexb'}`), per `encoderSessionPlan.ts`'s own doc
comment — NOT independently confirmed against real VideoToolbox/software
encoder output.

**"Wrote zero checkpoints" is now distinguishable:** added
`ExportStateManifest.rotationsSeen` (bumped on every 'session-rotate' via a new
`deps.onSessionRotation` callback, regardless of checkpoint success) and a new
`validateExportState` kind `'never_checkpointed'`, gated on `rotationsSeen > 0
&& checkpoints.length === 0` — deliberately NOT bare `checkpoints.length ===
0`, since any single-session export (under `MAX_ENCODER_SESSION_FRAMES`, 60s)
legitimately has zero checkpoints and must stay silent. Wired through
`ResumeRejection`/`ResumeRefusalNotice` as a fourth operator-facing kind
alongside `bitstream_touched`/`budget_exhausted`/`live_claim_blocked`.

**Resumed-run keyframe guarantee:** confirmed `exportWorker.ts` already
recomputes `sessionStarts` fresh (deterministic from
`totalFrames`/`isKeyFrame`/`MAX_ENCODER_SESSION_FRAMES`) and hard-fails
(`init-error`) if `resumeFromFrameIndex` is not found in it — no bug, no code
change. New test in `encoderSessionPlan.test.ts` proves every legitimate
checkpoint frame is found and keyframe-safe, and a foreign/corrupted value is
rejected the same way.

Commit: `fa0a61c`. New tests: `exportCheckpoint.test.ts` (+10),
`exportCheckpointWriter.test.ts` (new file, 6), `exportCheckpointPlacement.test.ts`
(+1), `hardwareFailoverWiring.test.ts` (+1), `encoderSessionPlan.test.ts` (+1).

### STEP 10 — H9: close the delivery path

`save_session_file` used plain `fs::copy` — no `\\?\` extended-length-path
prefix, so a long project path + long output filename could fail the delivery
copy AFTER a successful 30+ minute encode. The error already named the intact
session source path (unchanged, pre-existing). Two halves:

1. `windows_long_path` (`ffmpeg.rs`) applies `\\?\` (`\\?\UNC\` for a UNC
   share) to both sides of the copy, gated by `cfg!(target_os = "windows")`
   checked AT the call site rather than `#[cfg(windows)]` on the function
   itself — the string-prefixing logic (`apply_windows_long_path_prefix`)
   compiles and is directly unit-tested on every platform, including this
   macOS dev environment; only the runtime decision to apply it differs per
   target. 6 new Rust tests, including a no-op check proving macOS behavior is
   byte-for-byte unchanged (the one platform this environment can verify).
2. `exportDestinationPath.ts` checks the chosen destination's length against
   `WINDOWS_MAX_PATH = 260` (mirrored, named constant on both sides of the IPC
   boundary) BEFORE any rendering starts — wired into `useExport.ts`'s
   `startExport`, right after `pick_save_path` resolves the path. Windows-only
   by the path's own shape (drive-letter or UNC — no OS-detection API/
   dependency needed); a macOS/Linux path is never rejected regardless of
   length (destructive probe pins this). 7 new TS tests.

**Explicitly noted:** `windows_long_path` makes the delivery copy itself immune
to MAX_PATH, so the TS-side check is now mostly belt-and-suspenders for THIS
pipeline — valuable for fast second-zero feedback and as a safety net for any
future copy path that doesn't go through `windows_long_path`, not the primary
fix. **Remains genuinely UNRECOVERABLE** even with both fixes: disk full,
permission denied, or an antivirus lock on the destination — ordinary
`fs::copy` failures unrelated to path length, for which the existing error
message still names the intact session source path. **UNCONFIRMED on real
hardware:** whether the real Win32 `CreateFile` family honors `\\?\` for every
internal code path `fs::copy` takes — the prefixing RULE is proven here, not
the OS's own compliance with it.

Commit: `e9355a2`.

### Round 14 gates

| Gate | Expected | Observed |
|---|---|---|
| `tsc --noEmit` / `npm run lint` | clean | clean |
| `cargo test` | 298 + 10 = **308** | 308 / 0 / 5 |
| `cargo test --features fa-inference` (single-threaded) | 384 + 10 = **394** | 394 / 0 / 35 |
| `npm test` | see final report (run twice, both green) | see final report |
| frozen constants (WATCHDOG_MS, FORWARD_PROGRESS_BOUND_MS, FLUSH_BOUND_MS, APPEND_DRAIN_BOUND_MS, TRUNCATE_BOUND_MS, KILL_BOUND_MS, APPEND_BATCH_BYTES) | unchanged | unchanged — none of the four STEPs touch them |

## Round 13 — Realistic fixtures, kill bound, claim, orphan sweep, exhaustion variant (2026-09-11)

Cross-reference: `docs/ws3-export-architecture-ledger.md` (name only).

### Part 0 baseline

| Gate | Expected | Observed |
|---|---|---|
| Vitest total | 3466 = 3389 pass + 77 skip + 0 fail | 3466 = 3389 / 77 / 0 (pre-change) |
| `cargo test` | 295 / 0 / 5 | 295 / 0 / 5 |
| `cargo test --features fa-inference` | 381 / 0 / 35 | 381 / 0 / 35 |
| locked digests (pre-change) | efd16ab5… d02aca07… b6ce4717… c84a5aae… | unchanged on entry |

### STEP 1 — Realistic fixture rebuild

**Shape:** SPS/PPS once at stream start; per-picture AUD/SEI/slices; **no** per-picture trailing SPS/PPS; trailing AUD after the final picture only (delimiter for the conservative predicate — not a per-picture param-set rotation).

**New locked digests (all four changed — fixture shape changed):**

| Fixture | len | SHA-256 |
|---|---|---|
| `8slice-10pic` | 781 | `5db5e004522c4212339bfbae771df15c84bc8858ec8ad7906a131199dcaf8994` |
| `1slice-12pic` | 261 | `af89ca66bbb7447312547e54d8ded6e9ac460b51d8e09f5a327ac82cf5a88d44` |
| `paramsets-3pic` | 81 | `1abf9839f658ae5b9f83f2411542b86fe0490c055e1ec739f00d4bd2a6458035` |
| `short-9pic` | 201 | `fb9cdda22d69cac8af96ef1f7f1cd5a9dfaf486ef7d8efb46fe01a0c7fb6198b` |

**Truncation / resume after rebuild:** all annexb + checkpoint Vitest rows green; Rust truncate/resume rows green. Initial failures on realistic bytes revealed (a) the old per-picture SPS/PPS was masking predicate gaps, and (b) checkpoint `byteOffset` at AUD-start without an in-prefix delimiter is **exact-offset** business, not salvage-predicate business — repaired via exact-length fast path in `prepare_checkpoint_resume_inner`.

**Predicate / seam verdict:** conservative final-AU + count-and-cut + exact-offset seam **hold** on the rebuilt corpus with trailing-AUD delimiter and exact-offset authority for checkpoint offsets at AUD-start.

### STEP 2 — Kill latency + `KILL_BOUND_MS`

| Case | p50 | worst |
|---|---|---|
| idle | 0 ms | 1 ms |
| already-exited | 0 ms | 0 ms |
| mid-concat (1.7 GB) | 2 ms | 3 ms |
| mid-mux | 2 ms | 4 ms |
| mid-truncate | 3 ms | 5 ms |

**Landed:** `KILL_BOUND_MS = 125` (25× worst 5 ms). On kill-bound expiry: `FfmpegKillHungError` — no third retry layer; message states the sidecar **may still be running**. Windows: kill uses the same sidecar `CommandChild::kill()` path; expect similar order-of-magnitude (not re-measured on hardware this round).

### STEP 3 — H5 session claim

**File:** `<session_dir>/session_claim.json` — `{schemaVersion, sessionId, holderPid, holderStartTimeMs, holderInstanceId, claimedAtMs}`.

**Acquire:** `ffmpeg_create_session` / `ffmpeg_reenter_session` call `acquire_session_claim`. **Stale policy:** reclaim when `holderPid` is dead or PID-reuse disambiguation fails (start-time mismatch). **Live holder:** PID exists with matching start time — refuse reentry. Slow-but-alive holders cannot misfire: claim is refreshed on every session command path that acquires, and liveness is PID+start-time, not a heartbeat timeout.

**Discovery (read-only):** `ffmpeg_read_session_claim` → `{holderLiveness: live|stale|unclaimed}`. **CC contract:** before `reenter`, read claim; if `live` and not this process, show “session in use by another window”; if `stale`, proceed with reenter (claim rewrites); reenter guarantees exclusive claim for this process on success.

**Windows caveats:** PID reuse guarded by start-time; open-handle delete may pend — claim file removal on destroy is best-effort.

### STEP 4 — H10 orphan sweep

**Threshold:** `ORPHAN_SWEEP_MIN_AGE_SECS = 3600` (1 h). **Safety:** no `export_state.json*`; not claimed by live holder; age ≥ threshold. **Runs:** app startup (best-effort log) + `ffmpeg_sweep_orphan_sessions`. **Windows honesty:** `pending_delete` outcome when `remove_dir_all` returns Ok but the directory still exists (open handle). Never counts `pending_delete` toward `bytes_reclaimed`.

### STEP 5 — `recovery_budget_exhausted`

Additive variant `{kind:'recovery_budget_exhausted', reason, budget}`. **`clean` retains:** nothing-to-resume / invalid manifest. **CC:** branch on `kind === 'recovery_budget_exhausted'` (not `clean` + reason parse).

**Return-surface audit:**

| Outcome | Understatement risk | Round 13 |
|---|---|---|
| `clean` | none when truly nothing to resume | unchanged |
| `recovery_budget_exhausted` | was `clean` + reason | **fixed** |
| `bitstream_touched` | none — distinct kind | unchanged |
| `resume` | none | unchanged |

### STEP 6 — H9 delivery / MAX_PATH

`save_session_file` uses plain `fs::copy` — no `\\?\` extended prefix. Failure is typed in the error string and **includes the intact session source path** so the operator can copy manually. Pre-encode path-length validation: **NOT DETERMINED** (CC/UI scope) *as of this entry*.

**Round 14/15 update (2026-09-11, `ws3-hardening-windows`).** Both gaps above are closed. `save_session_file` (`ffmpeg.rs:1698-1723`) now runs `windows_long_path` on both `src` and `dest_path` before `fs::copy`, applying a Windows-only `\\?\` extended-length-path prefix (`apply_windows_long_path_prefix`, `ffmpeg.rs:1622-1639` — drive-letter paths get `\\?\C:\...`, UNC paths get `\\?\UNC\server\share\...`; a macOS/Linux path is a byte-for-byte no-op). Pre-encode path-length validation landed at `src/hooks/useExport.ts:717-747` (`checkExportDestinationPathLength`, `src/services/exportDestinationPath.ts`), called immediately after `pick_save_path` returns and before any rendering begins. Fixing SHA: `e9355a2` (STEP 10, H9). **Two residual gaps found in Round 15's audit, neither fixed, neither reachable through this app's own save dialog today:** (1) `apply_windows_long_path_prefix` does not normalize forward slashes to backslashes before prefixing, and Win32's `\\?\` syntax disables the usual path parsing (including `/`→`\` conversion) — a hypothetical forward-slash-containing Windows path would not be guaranteed to resolve correctly once prefixed; (2) the same disabled-canonicalization property means a `..`/`.` relative component inside an otherwise-absolute path is not resolved under `\\?\` and nothing in this codebase detects or rejects one. UNC handling is confirmed correct by its own passing unit test. Real Win32 `CreateFile`-family compliance with `\\?\` across every `fs::copy` code path remains unconfirmed outside a real Windows run.

### STEP 7 — Four corrections

1. **`byteOffset` doc** — per-piece file while rendering, not “concatenated Annex-B file”.
2. **`ResumeHandshakeSeam`** — `keptBytes === byteOffset` is on the same **piece** file.
3. **283 addend** — prior gate rows used **283 + N** where 283 is the branch cut addend, not the suite total.
4. **Fixtures** — STEP 1 above.

### Round 13 gates

| Gate | Expected | Observed |
|---|---|---|
| Vitest | 3466 + 1 = **3467** | 3390 pass / 77 skip / 0 fail ×2 |
| `cargo test` | 295 + 3 = **298** | 298 / 0 / 5 ×2 |
| `cargo test --features fa-inference` | 381 + 3 = **384** | 384 / 0 / 35 |
| `tsc` / `lint` | clean | clean |
| digests | four new values above | locked in Rust + JS |
| additive CC manifest | validates | unchanged schema v1 fields only |

---

## Round 16 — Consolidation: C11 closed, budget carried across pieces, hardware list moved out (2026-09-11)

`ws3-export-integration` (fast-forwarded from `ws3-hardening-windows`; the merge base `15002e5`
was an ancestor, so there were no conflicts). This section is the durable-state view of the
ledger's Round 16 entry (`docs/ws3-export-architecture-ledger.md`), which is authoritative for
dispositions, gates and the round-number map; this file states only what changed in the durable
state itself. Note this file's own "Round 7" is the Cursor-lineage Round 7 (heading qualified
above); the ledger's is a different entry — see the ledger's round-number map.

### STEP 1a — Byte neutrality of the durable writes, on real bytes

`scripts/ws3-clean-path-artifact.test.ts` (`931a3c8`) produced a real `export_final.mp4` through
the real sidecar muxer at `51e1f6b` (before any of this branch's durable-state work) and at the
consolidated head, same input, same settings: **identical SHA-256** in both arms —
`5bef6955…f06c` (320×180, 3 pieces, 5490 AUs) and `09c53b61…5386` (1280×720, 2 pieces, 3660 AUs,
~45 KB/AU — the arm in which the 512 KiB byte trigger, not the 100-chunk count, decides batch
boundaries: 304 appends vs 42). The manifest writes (9 and 6 respectively at head, 0 at `51e1f6b`)
and the per-append verify reads are the only clean-path difference and move no byte.

### STEP 1c — C11: the export-lifetime budget now survives a piece boundary (`5aba84b`)

**Was.** `startManifest` built every fresh piece's manifest with all four budget counters at 0.
Within one process the in-process gates (export-scoped locals) held; across a crash the resumed
process seeded those locals from the resumed PIECE's manifest, so budget spent in an earlier,
finished piece was restored. Worst case for N GL pieces with one OS-level crash per piece:
**2N rewinds, N failovers, 3N exact-offset truncates, 4N recovery attempts** against the documented
2 / 1 / 3 / 4 (a 26-piece export: 52 rewinds, 26 failovers).

**Is.** `createExportStateManifest` takes `carriedBudget: ExportLifetimeBudget`
(`boundaryRewindsUsed`, `hardwareFailoverUsed`, `totalRecoveryAttempts`), which the writer's
`startManifest` fills from `exportLifetimeBudgetOf(manifest)` — the manifest it is leaving behind,
fresh or adopted plus every `note*` since. The newest manifest on disk is therefore always the
export-lifetime total; `isRecoveryBudgetExhausted` on a resume into ANY piece reads the export's
real spend. Still piece-scoped, by their own documented scope: `checkpoints`, `rotationsSeen`
(the `never_checkpointed` coverage signal) and `checkpointResumeAttempts` (per checkpoint
generation). No new file, native command, I/O or time constant — the same single-slot,
never-awaited write, so Rung 0 is untouched. Schema version unchanged (the fields already
existed; only their initial values on a fresh piece changed), and an older manifest with the
fields absent still normalizes to zero.

**Manifest scope statement, restated so it is not misread:** the manifest is per PIECE for
checkpoints (the fence takes one file; `appendExportCheckpoint` is strictly monotonic within it)
and per EXPORT for the three budget counters (carried at every piece start). Both are true at
once; neither is a change to the Round 10 design, which said nothing about budget scope.

**Residual, unchanged:** a crash inside the single fsync window between the synchronous
in-memory charge and its durable write under-counts exactly one attempt (Round 15 STEP 10b
item 3) — accepted, because awaiting the write would reintroduce the hang Rung 0 forbids.

### Cargo reconciliation (STEP 1b)

`cargo test --features fa-inference` runnable counts by head, name-diffed with `-- --list`
(listed − 35 ignored): `57fc882` (Round 10) **379** → `4006386` (Round 11) **381** (+3 −1,
`79e3eed`) → `1b3d369` = `80a7458` (Round 13) **384** (+3, `d73747a`) → `9de3455` (Round 15)
**394** (+10: 6 `ffmpeg::windows_*` from `e9355a2`, 4 `session_claim::*` from `ee406dd`). This
file's own Round 13 gate table (384) was already correct; the ledger's Round 15 "5 unitemized
tests" note was the error, corrected there. This round's `cargo test --features fa-inference`
adds no Rust tests; `cargo test` and the fa-inference suite numbers for the consolidated head are
in the ledger's Round 16 gate section.

### Hardware-bound items

Every durable-state item that needs a real Windows or real macOS-native run — `pending_delete`
accuracy, `\\?\` compliance and normalization, `KILL_BOUND_MS` on Windows, resume after a real
OS crash, the checkpoint decline rate, `TIER_PIECE_BOUND_MS`, HDD bound numbers — now lives ONLY in
`docs/ws3-export-windows-validation.md` (rows W1, W2, W3, W6, E1, E2, E4, E8). The earlier
"hardware-bound / NOT DETERMINED" phrases in this file's Round 7/8/13 sections are dated history;
that file is the current list.

### Round 16 gates

Recorded once, in the ledger's Round 16 entry ("STEP 6 — Gates"), not duplicated here.
