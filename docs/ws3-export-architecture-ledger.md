# WS3 Export — Architecture Ledger

> **Purpose.** This is the file that prevents context loss across WS3 export-hardening
> rounds. Five registers (Rung, Tier, Bound, Counter, NOT DETERMINED) plus a dated Round
> log. Every status uses the fixed vocabulary: `LANDED` / `PARTIAL` / `PRIMITIVE-ONLY` /
> `NOT-WIRED` / `SIMULATED` / `NOT STARTED`. Cross-reference `docs/ws3-export-durable-state.md`
> by name only — this file does not edit or duplicate its content.
>
> **Round 9 (this entry) — THIS FILE IS NOW THE SINGLE SOURCE OF TRUTH for the Rung
> 0-5 / Tier 1-4 taxonomy.** Round 7 formalized the scales from scratch (see the
> superseded note this replaces, preserved in the Round 7 log entry below for
> history). Round 9's own task text arrived with a MORE DETAILED, and in places
> DIFFERENT, definition of Rungs 0-5 than Round 7's — notably, Round 7's Rung 0-2
> ("which encoder backend") is not a slot in Round 9's scheme at all; it is
> pre-existing plumbing that Round 9's real Rung 5a builds on. Round 9's definition
> below REPLACES Round 7's Rung/Tier tables. Any future disagreement about what a
> Rung or Tier number means resolves HERE, in this file — not in conversation, not
> in `docs/ws3-export-recovery-architecture.md`'s own independent 1-13 numbering
> (a different, older scheme covering mostly the same mechanisms), and not by
> re-deriving it from a task prompt. The vocabulary also changed this round:
> Round 7 used `POLICY-ONLY`/`WRITE-ONLY`; Round 9's task specified
> `PRIMITIVE-ONLY`/`NOT-WIRED` instead, which is now the fixed vocabulary above —
> treat any `POLICY-ONLY`/`WRITE-ONLY` still visible below (Round 7's own log entry,
> preserved verbatim for history) as the retired spelling of the same idea.

---

## 1. Rung table (0-5) — CANONICAL as of Round 9

Round 9's task text is adopted verbatim as the definition (below), with status/file:line/SHA
filled in against the real code as of this round. This REPLACES Round 7's Rung 0-5 table
(which numbered the hardware-ladder construction-time fallback as rungs 0-2 — that material
is folded into Rung 5's row below as pre-existing plumbing, not a rung of its own).

| Rung | Definition | Success condition | Status | Owning file:line | Landing SHA | Branch |
|---|---|---|---|---|---|---|
| 0 | Bounded operations — every encoder and ffmpeg operation carries a timeout and dies with a typed error rather than hanging | No operation can hang silently | **LANDED, two holes closed Round 10** (`46cfda8`): the Rung 3/5a rewind's `truncateAnnexbToOffset` and the concat guard's per-piece diagnostic count were the last two native calls on a FAILURE path with no wrapper. One remaining known hole, owned and NOT fixed — see the NOT DETERMINED register's `ffmpeg.kill()` row. | `WATCHDOG_MS`/`FORWARD_PROGRESS_BOUND_MS`/`FLUSH_BOUND_MS`/`APPEND_DRAIN_BOUND_MS`/`TRUNCATE_BOUND_MS` (`exportPipelineWebCodecs.ts`, `ffmpegLivenessBound.ts`) | pre-existing | `ws3-export-liveness` and predecessors |
| 1 | Correct measurement — frame counts are picture-accurate access-unit counts, never coded-slice counts | Counter cannot report 8x on a multi-slice hardware bitstream | LANDED | `AnnexbFrameCount.pictures` (Rust `ffmpeg.rs`'s `AnnexbAccessUnitScanner`); every production truncate/count/compare site uses `.pictures` only — verified this round by direct read of `count_annexb_frames_inner` (`ffmpeg.rs:866-891`, a plain streaming AU counter, no drop policy) | pre-existing | prior round |
| 2a | Bitstream salvage — a crash-truncated Annex-B stream is cut back to its last provably complete access unit, bounded memory. Final AU complete iff a fully scanned subsequent NAL begins the next AU; otherwise dropped (one picture, 33.33 ms @ 1080p30) | — | LANDED, hardened in Cursor's Round 8 (reported, not independently re-verified this round) | `truncate_annexb_inner`/`compute_truncate_cut_from_scanned` (`ffmpeg.rs:629-654`, `:927-956`) — the conservative-drop policy this round confirmed by direct read is confined to THIS function, never `truncate_annexb_to_offset_inner` (see STEP 2b below) | reported: `d0ce875` (conservative final-AU) | Cursor, `ws3-durable-resume` |
| 2b | Forced sealing — a truncated-but-valid stream sealed into a playable MP4, duration derived from picture count, so a short render beats a failed render | Guard reports the true shortfall, the operator sees the numbers, and only an explicit yes ships a short file | **LANDED Round 10** (`7b53676`). Wired at the post-concat picture-count guard as guard -> offer -> consent -> seal. Round 9's row said "no guard call"; that was WRONG and is corrected here — `ffmpeg.countAnnexbFrames` (native `count_annexb_access_units`) has run at that seam under `FRAME_COUNT_BOUND_MS` since before the merge. Only the offer/consent/seal half was unwired. | Primitives: `muxOnly.ts` (`forcedMp4SealOffer`, `sealTruncatedAnnexbToMp4`, `SealingOfferSeam`). Call site: `exportPipelineWebCodecs.ts`'s guard-fails branch. Consent surface: `useExport.ts`'s `pendingSealConsent` + `App.tsx`'s sealing dialog. Tests: `forcedSealWiring.test.ts` (8), matrix ROWs 4/5/6. | `dea7953` (primitive, Cursor) + `7b53676` (wiring, CC) | `ws3-durable-resume` + `ws3-tier2-wire` |
| 3 | Bounded re-render — on a MID-run (rotation) flush timeout only: fence the hung session, truncate `runFile` back to the last rotation boundary's exact byte offset (established by a completed `VideoEncoder.flush()`, never scanned), resume the SAME piece's frame loop from that boundary. One attempt per boundary, `MAX_BOUNDARY_REWINDS_PER_EXPORT = 2` total per export | — | LANDED (Round 7), unchanged this round except for the new Rung 5a hand-off once its own budget is exhausted | Decision: `decideBoundedRerenderDisposition`, `exportPipelineWebCodecs.ts:2294`. Wiring: `exportPipelineWebCodecs.ts:2555-2670` (`runGlPiece`, the `while (!driveResult.ok)` loop, the truncate call now at `:2616`) | `a6581d2` | `ws3-tier1-close` (Round 7) |
| 4 | Durable checkpoint resume — `export_state.json` written at rotation seams, read/validated on restart, surviving bitstream fenced and repaired before any append | A resumed run and an uninterrupted run of the same timeline produce identical output | **LANDED Round 10** (`8d5eb7d`). Writer at rotation seams, session discovery, the mandatory native fence, the post-fence seam step-back, remainder render, cleanup policy, and the operator's choice are all wired. | Primitives (Cursor): `exportCheckpoint.ts`, `ffmpeg.rs`'s `ffmpeg_prepare_checkpoint_resume`/`ffmpeg_list_resumable_sessions`/`ffmpeg_reenter_session`/`ffmpeg_write_export_state`. Wiring (CC): `exportCheckpointPlacement.ts`, `exportCheckpointWriter.ts`, `exportResumeDiscovery.ts`, `exportResumeSession.ts`, `exportSessionLedger.ts`, `exportPipelineWebCodecs.ts`'s rotation hook + piece loop, `useExport.ts`, `App.tsx`. | `989f9c1`/`1c2be49` (primitives, Cursor) + `8d5eb7d` (wiring, CC) | `ws3-durable-resume` + `ws3-tier2-wire` |
| 5 | Degradation and isolation — GPU→CPU encoder failover (5a), adaptive throttling under driver pressure (5b), render isolation surviving GPU context loss (5c) | — | **5a LANDED this round. 5b LANDED this round. 5c DECIDED this round: DEFER (not implemented, by design — see §7 below).** | 5a/5b: `exportWorker.ts`, `exportPipelineWebCodecs.ts` — see detailed rows below. Pre-existing plumbing 5a builds on: `HARDWARE_LADDER`/`SOFTWARE_ONLY_LADDER` construction-time fallback, `exportWorker.ts:1166/1170`, `createEncoder`'s ladder loop `:1247` (this was Round 7's own Rung 0-2; folded in here, not a separate slot in this scheme) | this round | `ws3-tier3-failover` |

### Rung 5 sub-table (this round's own work, full detail)

| Sub-rung | What it is | Status | Owning file:line | Landing SHA |
|---|---|---|---|---|
| 5a | Hardware→software failover: when Rung 3's own rewind budget is exhausted for the export, one more attempt at the SAME rotation boundary, forced onto `SOFTWARE_ONLY_LADDER = ['prefer-software']` for the whole resumed run. One-shot per export (`hardwareFailoverUsed` boolean, not a counter). | **LANDED this round** | Policy: `decideHardwareFailoverDisposition`, `exportPipelineWebCodecs.ts:2335`. Wiring: the abort branch at `exportPipelineWebCodecs.ts:2585-2601` (was an unconditional `break`; now consults the failover policy first), `forceSoftware` threaded through `runGlPiece`/`DriveGlRunDeps.forceSoftwareEncoder`/`ExportWorkerInitMessage.forceSoftwareEncoder` (`exportPipelineWebCodecs.ts:1070`, `:1988`; `exportWorker.ts:171`). Ladder selection: `createEncoder`'s new `ladder` parameter (`exportWorker.ts:1224-1231`), `buildEncoder`'s call site (`:1676`, `payload.forceSoftwareEncoder ? SOFTWARE_ONLY_LADDER : HARDWARE_LADDER`). | this round |
| 5b | Adaptive throttling: a small, continuous, per-frame submission delay (0-10 ms) that grows as `encodeQueueSize` rises past a SOFT threshold (2) below the pre-existing hard ceiling (`BACKPRESSURE_HIGH_WATER = 4`, unchanged) — graduated backoff underneath the hard wait, not a replacement for it. | **LANDED this round** | `THROTTLE_SOFT_WATER`/`THROTTLE_STEP_MS`/`MAX_THROTTLE_DELAY_MS`/`computeThrottleDelayMs`, `exportWorker.ts:1179-1219`. Wired into `runFrameLoopTick` immediately before the existing `BACKPRESSURE_HIGH_WATER` check, `exportWorker.ts:1454-1459`. | this round |
| 5c | Out-of-process render isolation. | **DECIDED this round: DEFER.** See §7 "Rung 5c decision" below for the full four-question answer and reopen trigger. | Decision recorded here and in the Round 9 log; no code. | this round (decision only) |

---

## 2. Tier table (1-4) — CANONICAL as of Round 9

| Tier | Item | Description | Status | Owning file:line | Landing SHA | Branch |
|---|---|---|---|---|---|---|
| 1 | 3a | Append batching, 100:1 IPC reduction | LANDED | `exportPipelineWebCodecs.ts` (`APPEND_BATCH_CHUNKS`/`APPEND_BATCH_BYTES`/`flushPendingBatch`) | prior round (`89317ea`) | `ws3-export-liveness` |
| 1 | 3b | Worker-side back-pressure, 32 MB threshold | LANDED (Round 7) | `appendBackpressureGate.ts` | `a6581d2` | `ws3-tier1-close` |
| 1 | 3c | Bounded re-render — Rung 3 | LANDED (Round 7) | see Rung 3 row | `a6581d2` | `ws3-tier1-close` |
| 1 | 4 | Liveness fields reach the operator-visible diagnostics blob end to end | LANDED (Round 7) | `exportDiagnosticsBlob.ts` | `eb95bac` | `ws3-tier1-close` |
| 1 | — | **COMPLETE** as of Round 7's own closeout — unchanged this round. | LANDED | — | — | — |
| 2 | — | Recoverable failure: Rungs 2b, 3, 4 wired end to end. | **COMPLETE as of Round 10.** All three are wired: Rung 3 (Round 7), Rung 2b (`7b53676`), Rung 4 (`8d5eb7d`). Verified together, not only apart, by `recoveryMatrix.test.ts`'s nine rows. Nothing in Tier 2 is left open. | see Rung 2b/3/4 rows | `7b53676`, `8d5eb7d` | `ws3-tier2-wire` |
| 3 | — | Enterprise layers: Rung 5 plus size-scaled, I/O-calibrated bounds. **Confirmed this round** (closes Round 7's own speculative "Rung 5 is a plausible candidate" row). 5a/5b landed this round; 5c decided (defer); size-scaled/I/O-calibrated bounds NOT STARTED (no task this round scoped them). | **PARTIAL** | — | this round (5a/5b only) | `ws3-tier3-failover` |
| 4 | — | Hardware-bound: real WebView2 IPC cost; HDD/non-SSD bound numbers; tier-piece wall-time on a live export; the Windows encoder's actual slice structure. **Confirmed this round** (closes Round 7's own speculative "old rung 13, process isolation" guess — that guess was WRONG; Tier 4 is a hardware-access category, not a single mechanism). All four items remain NOT STARTED — none reachable without physical Windows/non-SSD hardware, per Part 0. | NOT STARTED | — | — | — |

---

## 3. Bound register

Every constant a liveness/recovery decision in the export path reads, in one place so a
future change doesn't have to re-derive "is this measured or assumed."

| Constant | Value | Measured or assumed | Headroom multiple | Break-even slowdown factor | Known false-abort risk |
|---|---|---|---|---|---|
| `WATCHDOG_MS` | 30,000 ms | Measured baseline (field-death corpus), unchanged this round (Part 0 forbids touching it) | n/a (this round didn't move it) | n/a | Resets on 'chunk' OR completed-append messages — under current code this bound essentially never fires as long as SOME append keeps completing, however slowly (see §6's simulated finding: even a 25 ms/call pathological unbatched run never trips it, only `APPEND_DRAIN_BOUND_MS` gets close). Real false-abort risk is therefore concentrated in a writer that fully STALLS (0 completions), not one that's merely slow. |
| `FORWARD_PROGRESS_BOUND_MS` | 45,000 ms | Measured (1.5x `WATCHDOG_MS`, sized against the non-transition baseline's ~21ms/frame) | ~3,947x the 3 s max parked-window observed in this round's back-pressure fixtures (`appendBackpressureAckWiring.test.ts`) | n/a | Resets only on a completed append (never a bare message) — see back-pressure interaction note below. |
| `APPEND_BATCH_CHUNKS` | 100 | Assumed (round-number choice against the field profile's ~33 KB/chunk) | n/a | n/a | None known — a batch this small relative to `APPEND_BACKPRESSURE_THRESHOLD_BYTES` (32 MB) cannot itself starve anything. |
| `APPEND_BATCH_BYTES` | 4 MiB | Assumed | n/a | n/a | Same as above. |
| `APPEND_BATCH_MAX_AGE_MS` | 1,000 ms | Assumed (liveness bound, not a throughput knob — costs at most one extra IPC call/s when the encoder is slow) | n/a | n/a | None known. |
| `APPEND_QUEUE_CEILING_BYTES` | 256 MiB | **Round 9 STEP 6b: restated explicitly, not re-derived.** Deriving it from the unbatched-path pathological peak (708 MB @ 25 ms, `scripts/ws3-measure-append-throughput.test.ts`'s own table) would be a category error — production is ALWAYS batched (Tier 1 item 3a, unconditional), so the unbatched arm is a legacy comparison baseline, not a code path this ceiling needs to bound. The batched+back-pressure arm's own peak queue depth stays in the low single-digit MB at every measured latency (0.5/12.4/25 ms — see the existing "queue ceiling is never approached" assertion in the same file), nowhere near 256 MB. So 256 MB remains what its own pre-existing doc comment always said: a last-resort memory guard, decoupled from any plausible legitimate peak under the ALWAYS-batched production path — not sized to any specific scenario, batched or unbatched. | 8x `APPEND_BACKPRESSURE_THRESHOLD_BYTES`; **≈36x** the batched-path peak actually observed at any measured latency this round or Round 7's | n/a | Reopen trigger (unchanged from the pre-existing comment, restated so it isn't re-derived next round): a real field export's diagnostics reports `queueDepthBytes` anywhere near 256 MB. Until then, do not treat this constant as tuned to a scenario — it is a ceiling nothing plausible reaches. |
| `APPEND_BACKPRESSURE_THRESHOLD_BYTES` | 32 MiB (Round 7) | Assumed — reasoned against the two neighbors (8x `APPEND_BATCH_BYTES`, 1/8 `APPEND_QUEUE_CEILING_BYTES`), not measured against a real peak backlog | 8x above the batch trigger, 8x below the ceiling | **Round 9 STEP 6a, CLOSED: break-even latency ≈ 5,654.5 ms/call** (bisected against the field chunk profile with the gate disabled, `scripts/ws3-measure-append-throughput.test.ts`'s "back-pressure break-even latency" describe block — SIMULATED, not measured on real hardware). That is **≈456x** the measured Windows figure (12.4 ms) and **≈226x** the pathological figure tested (25 ms) — so for THIS chunk profile, back-pressure is, in practice, a ceiling guard that does not fire on any plausible hardware; it would take a writer roughly 456x slower than the one that actually died in the field to engage it. | A worker legitimately parked on this gate cannot be misread as stalled, because the SAME event (a completed append) both resets `FORWARD_PROGRESS_BOUND_MS`/`WATCHDOG_MS` and unblocks the gate — proven at all three seams (session-rotation, done, salvage-done) in `appendBackpressureAckWiring.test.ts`. |
| `MAX_BOUNDARY_REWINDS_PER_EXPORT` | 2 (Round 7) | Assumed — "two, not one: a transient stall recovered by one piece's rewind says nothing about a second piece's rewind, but a third rewind in the same export is 'salvage becomes routine'" (own doc comment, `exportPipelineWebCodecs.ts:2281`) | n/a | n/a | None known — bounded, destructively probed (Round 7, re-probed Round 9 against the new failover interaction). |
| `THROTTLE_SOFT_WATER` | 2 (Round 9, new) | Derived — half of the pre-existing `BACKPRESSURE_HIGH_WATER` (4), never freshly assumed | n/a | n/a | None known — the throttle is a no-op at or below this value, reproducing pre-Round-9 behaviour exactly (output-neutrality, proven by test). |
| `THROTTLE_STEP_MS` / `MAX_THROTTLE_DELAY_MS` | 5 ms / 10 ms (Round 9, new) | Derived — `MAX_THROTTLE_DELAY_MS` is `THROTTLE_STEP_MS x (BACKPRESSURE_HIGH_WATER - THROTTLE_SOFT_WATER)`, chosen so the worst case (10 ms/frame) times `MAX_ENCODER_SESSION_FRAMES` (1,800) totals 18,000 ms — still under `FORWARD_PROGRESS_BOUND_MS` (45,000 ms) even under the impossible assumption that every single frame in a whole session pays the maximum delay with zero resets in between | `FORWARD_PROGRESS_BOUND_MS` / (`MAX_THROTTLE_DELAY_MS` x `MAX_ENCODER_SESSION_FRAMES`) ≈ 2.5x, on the adversarial reading; effectively unbounded headroom under the real reset-per-append semantics | n/a | Structurally cannot cause a false abort: resolves on its own `setTimeout`, never depends on any other resource, and never blocks an append already queued — see Round 9 log for the full non-deadlock proof against `AppendBackpressureGate`. |
| `TRUNCATE_BOUND_MS` | 172,675 ms | **Measured** — 25x the worst observed streaming truncate at 2.3 GB (6,907 ms; `ffmpegLivenessBound.ts`'s own measurement block, Cursor's `b52e145`) | 25x worst-observed at the sizing file size | A 25x-slower volume than the SSD these numbers came from | Round 10 (`46cfda8`) added the Rung 3/5a rewind call to this bound's coverage. Both callers now: salvage `truncateAnnexb` and rewind `truncateAnnexbToOffset`. |
| `FRAME_COUNT_BOUND_MS` | 81,375 ms | **Measured** — 25x the worst observed streaming AU count at 2.3 GB (3,255 ms) | 25x | 25x | Round 10 (`46cfda8`) added the guard's PER-PIECE diagnostic count to this bound's coverage; each piece is a strict prefix of the file the bound was sized from, so the bound can only be more generous there, never tighter. |
| mux bound (`computeMuxBoundMs`) | 345,500 ms @ 1.7 GB · 511,750 ms @ 2.3 GB | **Measured** (Cursor's `b52e145`), interpolated per-pass rather than scaled as a total | 25x measured two-pass total | 25x | **SUPERSEDED FIGURES, recorded so they do not resurface**: the pre-`c9b86a5` 18,150 / 36,300 ms pair (built on an unmeasured 1,210 ms count and 2,420 ms truncate at 2.3 GB, ~2.7-2.9x too fast, ~5.5x real headroom); and Round 7's 13.92 x (2.3/1.7) = 18.834 s extrapolation, which was 1.636 s (8.0%) too fast against the 20.470 s measurement. Use only the two figures in this row. |
| checkpoint write (`export_state.json`) | no time bound, BY CONSTRUCTION | n/a | n/a | n/a | Round 10. ~200 B/record, under 6 KB per 26-minute export, one fsync'd atomic replace. Deliberately NOT given a constant: nothing awaits it, at most one write is in flight, and a rotation landing mid-write coalesces into the next one, so its cost is O(1) regardless of volume latency and a wedged write costs only the checkpoints it would have carried. A structural guarantee, not a tuned number. |
| `ABANDONED_SESSION_TTL_MS` / `MAX_RETAINED_ABANDONED_SESSIONS` | 7 days / 1 | Derived from the session size, not fitted: bound on disk is (1 resumable + 1 retained) x session size ≈ 4.6 GB at the 2.3 GB sizing case | n/a | n/a | Round 10. A resumable session is never collected while it is still resumable, nor is the one in use. Age comes from a renderer-side ledger (`exportSessionLedger.ts`) because no native command exposes a directory mtime; an unknown id is treated as OLDEST, so a missing ledger row makes collection MORE likely, never less. |
| `MAX_FLUSH_SALVAGES` | 1 | Assumed (prior round) | n/a | n/a | Unchanged this round. |
| `MAX_ENCODER_SESSION_FRAMES` | 1,800 | Assumed (prior round, ~60s at 30fps) | n/a | n/a | Unchanged this round — Rung 3's rewind logic (and Round 9's Rung 5a failover, which reuses the same rewind mechanism) depends on `planEncoderSessions`'s guarantee that every session-start frame is already a keyframe; not re-verified this round, inherited as-is. |
| `FLUSH_BOUND_MS` | 20,000 ms | Assumed (prior round) | n/a | n/a | Unchanged this round (Part 0 forbids touching it). |
| `APPEND_DRAIN_BOUND_MS` | 600,000 ms (10 min) | Assumed (prior round) | For the pathological 25 ms unbatched arm simulated in Round 7: terminal drain 549,233.8 ms = 91.5% of this bound — the CLOSEST any simulated scenario came to any bound. Unchanged this round (Part 0 forbids touching it). | n/a | Not re-measured this round beyond the Round 7 data point. |

---

## 4. Counter register

| Canonical counter | What it is | Delegating callers | Probe-only functions | Dev spikes marked unreachable-from-production | Guard chain |
|---|---|---|---|---|---|
| `sessionByteOffsets[k]` | Byte offset in `runFile` at which encoder session `k` produced its first byte. Established only AFTER a completed `VideoEncoder.flush()` (never scanned from bytes) — this is what makes it AU-accurate by construction. | `finish` stamps it centrally onto every `RunDriveResult` (`exportPipelineWebCodecs.ts:1434`); read by the Rung 3 rewind loop (`:2557`'s `absoluteByteOffset` computation) and by the (pre-existing) salvage-truncate-mismatch site | none | none | Session-rotate handler flushes the pending batch BEFORE recording the marker (`exportPipelineWebCodecs.ts`'s `case 'session-rotate'`), so the byte count is read at the exact seam, never before pending bytes are accounted for. |
| `sessionFrameIndices[k]` (this round, new) | `sessionByteOffsets`'s frame-index companion — the piece-absolute frame index at which session `k` started, read directly off `session-rotate`'s own `frameIndex` field | Same stamping site as `sessionByteOffsets` | none | none | Exact the instant the message arrives — no async marker needed (unlike the byte version, which needs the append-queue marker). |
| `appendCallCount` / `appendIpcCallCount` | Chunks landed on disk / actual `appendFileRaw` IPC calls issued (batched, so `<<` the chunk count) | `buildAppendLedger` (`:1363`) | none | none | Incremented only after `await ffmpeg.appendFileRaw(...)` RESOLVES — a stuck writer produces no increment. |
| `encoderSessionIndex` / `encoderSessions` (on `ExportLivenessSnapshot`) | Orchestrator's own `sessionAt`/`sessionCount`, main-thread state, updated only by 'session-plan'/'session-rotate' messages | `snapshotLiveness` | none | none | On a rotation-flush-timeout, `sessionAt` correctly still names the HUNG session (not yet advanced), because advancement only happens after a successful flush — this is the property Rung 3's rewind depends on, and the property that was WRONG for a resumed run before this round's `resumeSessionIndex` fix (a resumed run's own 'session-plan' message used to hard-reset `sessionAt` to 0 regardless of where it actually resumed). |
| `AppendBackpressureGate.unacked()` (this round, new) | `submitted - acked`, both cumulative, both worker-local per run | `waitIfNeeded`, `ack` | `waiterCount()` (test/diagnostic only, not read by production logic) | none | Never resolves on a timer of its own — only a real `ack()` call (sourced from a completed `appendFileRaw`) can unblock a parked waiter; proven directly in `appendBackpressureGate.test.ts`. |
| `AnnexbFrameCount.pictures` vs `.vclNals` | `pictures` is the picture-accurate (access-unit) counter; `vclNals` is the raw, multi-slice-inflatable counter | Every production truncate/count/compare site uses `.pictures` only (verified by the explore pass that fed this ledger — zero production reads of `.vclNals` for a decision) | `countAnnexbFrames` (JS reference implementation, `exportPipelineWebCodecs.ts` — explicitly noted in `docs/ws3-export-recovery-architecture.md` item 2 as "still counts slices... off the guard path but what spikes/tests diff against") | `countAnnexbFrames` itself, per the note above — flagged as a rename/fix candidate in a prior round, not touched this round | Zero-tolerance exact-match, both directions, at every site that compares a picture count to an expected frame count (final-flush salvage AND this round's rewind-truncate verification both use this posture). |

---

## 5. NOT DETERMINED register

| Item | Owner | What would close it | Needs hardware not available here? |
|---|---|---|---|
| ~~Tier 2/3/4 authoritative definitions~~ — **CLOSED Round 9.** See §2 Tier table: Tier 2 = Rungs 2b/3/4 (PARTIAL — 3 landed, 2b/4 not-wired); Tier 3 = Rung 5 + size-scaled bounds (PARTIAL — 5a/5b landed, 5c deferred, size-scaled bounds not started); Tier 4 = hardware-bound items (NOT STARTED, all four require physical hardware). | closed | closed | closed |
| NOT DETERMINED #1/#2 (append throughput at 3 latencies) — **SIMULATED, not resolved** | Next round with Windows hardware access | A real WebView2/Windows run at the 12.4 ms-class machine, with the batched+back-pressure path active, measuring actual terminal drain | **Yes** — Windows machine with the real regression hardware profile |
| Real per-call `open`/`write_all`/`close` cost in `ffmpeg.rs:189-198` on Windows | Owner of `ffmpeg.rs` (outside this round's file-ownership boundary) | Instrument that function directly and log real per-call timings on Windows | Yes |
| ~~Whether `APPEND_QUEUE_CEILING_BYTES` (256 MB) is sized to any real legitimate peak~~ — **CLOSED Round 9 STEP 6b.** Restated explicitly as a last-resort guard, deliberately NOT derived from the unbatched pathological peak (category error — production is always batched). See Bound register row. Reopen trigger: a real field `queueDepthBytes` reading near 256 MB. | closed | closed | closed |
| ~~The break-even latency at which `APPEND_BACKPRESSURE_THRESHOLD_BYTES` (32 MB) would actually engage~~ — **CLOSED Round 9 STEP 6a.** ≈5,654.5 ms/call (SIMULATED bisection), ≈456x the measured 12.4 ms Windows figure. See Bound register row and `scripts/ws3-measure-append-throughput.test.ts`. | closed | closed | closed |
| ~~Rung 5 (software failover at a rotation boundary)~~ — **CLOSED (5a/5b) Round 9.** See Rung 5 sub-table. 5c remains a DECIDED-DEFER, not a NOT DETERMINED — see §7. | closed | closed | closed |
| Whether `planEncoderSessions`'s "every session start is a keyframe" guarantee still holds under Rung 3's (and now Rung 5a's, which reuses the same resume mechanism) resumed-run bootstrapping (`initialSessionIndex` computed from `sessionStarts.indexOf`) for every real timeline shape, not just synthetic fixtures | Next round, or a live-export verification pass | A live export that actually triggers a mid-run rotation-flush-timeout and inspects the resumed session's first frame | Not necessarily — could be checked with a broader property-based fixture instead |
| Whether the Rung 3/5a rewind's simplification in the ORCHESTRATOR (`resumeSessionIndex` bootstrap at exactly one sparse index) generalizes correctly to a THIRD same-rung rewind if `MAX_BOUNDARY_REWINDS_PER_EXPORT` were ever raised above 2 | Whoever changes that constant | Extend `boundedRerenderWiring.test.ts` with a 3-rewind scenario before raising the constant | No |
| ~~Round 9 STEP 2b — the Rung 3/5a rewind's `truncateAnnexbToOffset` is unbounded~~ — **CLOSED Round 10** (`46cfda8`). Wrapped in `TRUNCATE_BOUND_MS` with the same kill chain and typed error as its salvage sibling. Destructive probe: removing the wrap makes `rewindTruncateBound.test.ts` HANG (test timed out in 20 s) rather than fail an assertion — the defect itself, not a proxy. The sweep also found and fixed a second instance (the guard's per-piece diagnostic count). | closed | closed | closed |
| **NEW, Round 9 STEP 5b — no active production "driver is struggling" warning currently exists** to ask whether throttling suppresses it. `encodeQueueSizeAtFlushExpiry` and `'queue-sample'` are diagnostic-only (no orchestrator/UI logic reads either as a live warning). If one is built later off raw `encodeQueueSize` trajectory, it MUST account for the fact that both `BACKPRESSURE_HIGH_WATER` (pre-existing) and this round's throttle now actively suppress that signal by design — build it off `wait-dequeue` time or the throttle's own internal state instead | Whoever builds that warning | Read this note before building it | No |
| ~~Round 9 STEP 3/4 — mixed-rung SPS/PPS continuity is REASONED, not measured~~ — **MECHANISM CLOSED Round 10** (`1e61e84`), **WINDOWS ANSWER STILL OPEN**. Measured on Mac (Chromium 152, avc1.640028, 640x360@30): both rungs emit profile_idc 100 / level_idc 30, but the constraint flags differ ([000000] hw vs [000011] sw) and the entropy coding mode differs (CABAC hw vs CAVLC sw); SPS and PPS payloads differ entirely. The hardware-then-software join is nonetheless accepted by our own picture counter (60/60), by `VideoDecoder` (60 frames, no error), and by the real x86_64 ffmpeg sidecar, which muxes 60 frames AND fully decodes all 60 with zero warnings. So the pipeline tolerates a mid-stream parameter-set change, including the more dangerous entropy-mode change. **What is NOT answered:** Windows (Media Foundation vs a different software encoder) — Tier 4, needs the hardware; and WKWebView, where the app actually encodes — this ran in Chromium, so it compares VideoToolbox to OpenH264 through a different host. | Next round with Windows hardware; a WKWebView run needs only `npm run tauri:dev` | Re-run `spike-parameter-sets.html` inside the Tauri app for the WKWebView half; a Windows machine for the Windows half | Yes for the Windows half; no for the WKWebView half |

| **NEW, Round 10 — `ffmpeg.kill()` inside `withFfmpegLivenessBound`'s expiry handler is itself an unbounded `await`** (`ffmpegLivenessBound.ts:288`). If `kill()` never settles, the bound never rejects: the mechanism that saves every other native call can itself hang. Found by STEP 2's sweep; deliberately NOT fixed. Every candidate fix needs a new time constant for `kill()` that has never been measured, and inventing one is exactly the defect Round 7's unmeasured-bounds correction established the rule against. | Owner of `ffmpegLivenessBound.ts` | Measure real `ffmpeg_kill_session` latency (it is a state-flag store plus a child kill, expected sub-millisecond), then bound the await at a measured multiple — or restructure so the rejection does not depend on the kill settling | No |
| **NEW, Round 10 — a rotation whose following bytes open directly on a coded slice yields NO checkpoint.** `fenceSafeCheckpointOffset` declines rather than guess, which is correct, but it means an encoder that does not emit inline parameter sets before its first slice after a rotation would produce a resumable-in-principle export with an empty manifest. Not observed: the Mac spike shows both rungs leading every IDR with SPS/PPS. | Next round | Log the decline rate on a live export; if it is ever non-zero, the encoder's AU shape needs re-examining before resume can be relied on there | No |
| **NEW, Round 10 — pre-Round-10 abandoned session directories with no `export_state.json` are uncollectable from the renderer.** `ffmpeg_list_resumable_sessions` only returns directories that have a manifest, so a directory left by an older build is invisible to the cleanup policy. From this round on every export writes its manifest before rendering a frame, so only pre-round leftovers can be in that state. | Owner of `ffmpeg.rs` (frozen this round) | A native command that lists `kinetix-export-*` regardless of manifest presence, or a one-time sweep at startup | No |
| **NEW, Round 10 — the resume path has never been exercised against a real crash.** Every proof here is a fixture: a byte-real fake ffmpeg for the bitstream, call-order recording for the fence. The native fence, `ffmpeg_list_resumable_sessions`, and `ffmpeg_reenter_session` have Rust unit tests (Cursor's) but no end-to-end run where the app was actually killed mid-export and restarted. | Next round | `npm run tauri:dev`, start a long export, kill the process at a rotation, restart, take the resume offer, and diff the finished file against an uninterrupted run | No — needs only a live Tauri session, which this round's "no live exports" rule excluded |

---

## 6. Round log

### Round 7 (2026-09-10 / 2026-09-11) — Tier 1 closeout + Rung 3 re-render

**Branch:** `ws3-tier1-close`, cut from `ws3-export-integration` @ `15002e5` (commits `89317ea`, `15002e5`). **Base main SHA:** `4d4922c`. **Rollback:** `2959861`. Parallel round — Cursor concurrently on `ws3-durable-resume`.

**Files touched (all within this round's ownership: `exportWorker.ts`, `exportPipelineWebCodecs.ts`, `encoderSessionPlan.ts` [not touched — no changes needed there], `driveGlRun*`, `App.tsx`'s export-error blob, this ledger):**
- `src/services/webcodecsExport/appendBackpressureGate.ts` (new)
- `src/services/webcodecsExport/appendBackpressureGate.test.ts` (new)
- `src/services/webcodecsExport/appendBackpressureAckWiring.test.ts` (new)
- `src/services/webcodecsExport/boundedRerenderWiring.test.ts` (new)
- `src/services/exportDiagnosticsBlob.ts` (new — extracted from `App.tsx`)
- `src/services/exportDiagnosticsBlob.test.ts` (new)
- `scripts/ws3-measure-append-throughput.test.ts` (new)
- `src/services/webcodecsExport/exportWorker.ts` (modified)
- `src/services/webcodecsExport/exportPipelineWebCodecs.ts` (modified)
- `src/App.tsx` (modified — export-error blob now calls `buildExportDiagnosticsBlob`)

**What landed:**
1. Step 1 — worker-side append back-pressure (Tier 1 item 3b), 32 MB threshold, non-deadlock proven at all three seams. `a6581d2`.
2. Step 3 — Rung 3 (bounded re-render) wired to real execution: decision, truncate, resume. A real bug (resumed run's session index defaulting to 0) found via testing and fixed (`DriveGlRunDeps.resumeSessionIndex`). `a6581d2` (same commit as Step 1 — the two are interleaved in `exportWorker.ts`/`exportPipelineWebCodecs.ts`).
3. Step 4 — `buildExportDiagnosticsBlob` extracted and made testable; permanent completeness regression test added; the one known-incomplete construction site (salvage-truncate-mismatch) fixed via centrally-stamped `appendLedger`/`msSinceLastPhaseChange`. `eb95bac`.
4. Step 2 — throughput harness built and run; NOT DETERMINED #1/#2 status changed from "unmeasured" to "SIMULATED" (not "resolved" — see §5). `265fcae`.
5. Step 5 — this ledger, created from scratch (no prior Rung/Tier taxonomy existed in a committed doc). SHA recorded in the final report (this file cannot know its own commit SHA in advance).

**What did not land:**
- Rung 5 (software failover) — NOT STARTED, out of this round's scope.
- Real Windows/WebView2 measurement for NOT DETERMINED #1/#2 — needs hardware this session does not have.
- Tier 2-4 definitions — not found, not authored (would be fabrication).
- Break-even latency computation for the back-pressure threshold — not requested by Part 0's explicit deliverables, noted as a follow-up.

**Gate arithmetic:** see the Round 7 entry's own final report for the full `npx tsc --noEmit` / `npm run lint` / `npm test` x2 numbers and every commit SHA — recorded once, in the final report, rather than duplicated here to avoid the two ever silently disagreeing.

**What broke (and was caught before shipping):** two bugs found by this round's own tests, both fixed before commit:
1. A resumed run's own `sessionAt` reset to 0 on its 'session-plan' message regardless of where it actually resumed, corrupting a SECOND rewind's boundary computation (silently resuming from frame 0 instead of the correct frame) — found by `boundedRerenderWiring.test.ts`'s "stops rewinding" test once its message timing was corrected, fixed via `resumeSessionIndex`, destructively re-probed (RED with the bootstrap removed, GREEN restored).
2. The Step 4 completeness test's own generic leaf-scan was initially defeated by the diagnostics blob's `error: err` field trivially re-including the original (untouched) `liveness` object regardless of what the rest of the function did — caught by the test's own destructive probe going unexpectedly GREEN, fixed by excluding `blob.error` from the scan so the check exercises the function's own logic.

### Round 9 (2026-09-10) — Rung 5 + ledger authority + seam closure

**Branch:** `ws3-tier3-failover`, cut from `ws3-tier1-close` @ `51e1f6b` (commits `a6581d2`, `eb95bac`, `265fcae`, `51e1f6b`). **Base main SHA:** `4d4922c`. **Rollback:** `15002e5`. Parallel round — Cursor on `ws3-durable-resume` @ `81bde88`, not read from this round per Part 0.

**Part 0 — Expected vs Observed:**

| Check | Expected | Observed | Verdict |
|---|---|---|---|
| `npm test` | 3467 = 3390 passed + 77 skipped + 0 failed | 3467 = 3390 passed + 77 skipped + 0 failed | MATCH |
| Cargo default suite | 283/0/5 (NOT 279/0/5 — see correction below) | Not re-run, per Part 0's explicit instruction; verified untouched instead | N/A by design |
| `git status --porcelain -- src-tauri Cargo.lock` | empty | empty | MATCH |

**Corrections to the standing record (STEP 1):**
1. The Cargo baseline is `283/0/5`, not `279/0/5` — the `279/0/5` figure carried in prior rounds was stale; at cut `15002e5` the default suite was already 283 passed, with four tests inherited from `2515acb`/`2a806df`.
2. The 2.3 GB mux extrapolation was 8.0% optimistic — measured 20.470 s against 18.834 s predicted, so `470_824` was really 23.0x headroom and is now `511_750` at a true 25x. (Reported facts, carried forward as instructed — not independently re-measured this round; no mux work was in scope.)

**AJ-0 flake:** isolated (`npx vitest run scripts/ws1-session-aj0-oracle-diff.test.ts`), 37.77 s wall time against the `180_000` ms bound this branch still carries — did not reproduce. Cursor's fix (`530_000` ms, 3x an isolated worst of 176.34 s across n=10) is reported to land at `26491ae` on `ws3-durable-resume`; not cherry-picked, not edited here, arrives at integration as instructed.

**STEP 1 — ledger taxonomy written: YES.** See §1/§2 above — this file is now the canonical Rung 0-5 / Tier 1-4 definition, replacing Round 7's own (narrower, since-superseded) version. Both STEP 1 record corrections are in the Bound register / this entry.

**STEP 2a — the fallback seam (report only, nothing built):**
- **Decision point:** `exportPipelineWebCodecs.ts:2585` — the `if (disposition.action === 'abort')` branch inside the rewind `while` loop, reached once `decideBoundedRerenderDisposition` refuses another same-rung rewind (rewind budget exhausted for the export).
- **Hand-off point (unchanged by this round for the sealing side):** `exportPipelineWebCodecs.ts:2590` — once Round 9's own new `decideHardwareFailoverDisposition` ALSO refuses (failover already used once this export), the loop `break`s and falls through to `exportPipelineWebCodecs.ts:2728`'s `return { ok: false, error: driveResult.error };` — a hard failure. **No guard call, no offer, no seal happen here today** — confirmed by direct read; this is the gap Round 9's task asked to be reported, not built.
- **State at that point:** `runFile` (`piece_${pieceIndex}.h264`) contains `fileBaseByteOffset` bytes from the last successful rewind's truncation (0 if no rewind for this piece ever succeeded) PLUS whatever bytes the final hung `driveGlRun` attempt appended before its flush hung — the tail is NOT provably complete (unlike a Rung 3 rewind's own cut points, which sit at a completed-flush boundary by construction). `driveResult.error.liveness` carries `encoderSessionIndex` (hung session), `encoderSessions` (planned total), `framesEncoded`, `failureVia: 'flush-timeout'`. `plan.expectedFrames` (the piece's full target) and `fps` are both in scope at the call site.
- **What must be handed to a sealing disposition, to match Cursor's `SealingOfferSeam` contract (`muxOnly.ts`: post-drop `{pictures, vclNals}`, `picturesExpected`, `fps`, operator consent, ffmpeg paths; ordering guard → offer → consent → seal):** the GUARD step — an AU-scan/truncate-to-last-complete-AU, i.e. the same `ffmpeg.truncateAnnexb(runFile)` call the FINAL-flush salvage path already makes at `:2775` — is not currently run at THIS seam at all. My side of the contract (running the guard, producing `{pictures, vclNals}`) is therefore itself unwired here, a gap alongside the sealing UI/consent/seal machinery on Cursor's side. **Confirms the handoff shape matches `SealingOfferSeam`'s expected inputs, but confirms neither side is wired at this exact seam yet** — recorded as a NOT DETERMINED / next-task row, not fixed this round (Part 0: "Do not build the sealing side").

**STEP 2b — truncate signature and preconditions:**
- **Signature verdict: MATCHES, verified by direct read, not assumed.** TS declaration (`exportPipelineWebCodecs.ts:180`, `WebCodecsFfmpeg.truncateAnnexbToOffset(path: string, byteOffset: number): Promise<{pictures, vclNals, bytesRemoved, keptBytes}>`) against the real implementation (`tauriFfmpeg.ts:251-265`, invoking `ffmpeg_truncate_annexb_to_offset` with `{sessionId, path, byteOffset}`) against the Rust command (`ffmpeg.rs:915-925`, `session_id: String, path: String, byte_offset: u64`) and its return struct (`AnnexbTruncateResult`, `ffmpeg.rs:234-239`, `pictures/vcl_nals/bytes_removed/kept_bytes` — Tauri's default camelCase IPC rename makes these `pictures/vclNals/bytesRemoved/keptBytes` exactly). No mismatch on name, parameter order, parameter types, or any return field.
- **Precondition 1 (offset lands on a completed-`flush()` boundary):** TRUE, verified — `absoluteByteOffset` is built from `sessionByteOffsets[hungSessionIndex]`, which the Counter register (§4) already documents as established only after a completed `flush()`, and this round's own read of the call site confirms nothing else feeds `absoluteByteOffset`.
- **Precondition 2 (bounded by `TRUNCATE_BOUND_MS`): FALSE — BLOCKER.** The rewind's own `truncateAnnexbToOffset` call (`:2616`) is a bare `await`, NOT wrapped in `withFfmpegLivenessBound` — unlike the final-flush salvage path's `truncateAnnexb` call (`:2775`), which is. A hung native truncate on the rewind path has no TS-side timeout at all today, only the Rust side's own cooperative `check_cancelled`. Recorded as a NOT DETERMINED row (§5) and a merge-time flag — not fixed this round, to keep the diff mechanical, but genuinely a gap the interface doc comment's own claim ("bounded by TRUNCATE_BOUND_MS") does not match for this call site.
- **Precondition 3 (a failed call leaves the file unmutated):** TRUE, verified by direct read of `truncate_annexb_to_offset_inner` (`ffmpeg.rs:957-993`) — an offset past EOF is refused with an `Err` BEFORE the file is ever opened for write; a `set_len` failure is a single OS call that does not partially truncate.
- **Precondition 4 (the conservative final-AU drop does NOT apply to the exact-offset path): TRUE, verified by direct code read, not assumed — the one Cursor flagged as mattering most.** `truncate_annexb_to_offset_inner` (`ffmpeg.rs:957-993`) never calls `compute_truncate_cut_from_scanned` (`ffmpeg.rs:629-654`, the conservative-drop policy) — it truncates to the CALLER-supplied `byte_offset` via a direct `set_len`, then counts pictures on the result via `count_annexb_frames_inner` (`ffmpeg.rs:866-891`), a plain streaming AU counter with no drop logic of its own. `compute_truncate_cut_from_scanned` is called ONLY from `truncate_annexb_inner` (the AU-scanned salvage function), never from the exact-offset function. Confirmed structurally, not by running Cursor's code.

**STEP 3 — Rung 5a (hardware→software failover): LANDED.**
- **`VideoEncoder`/`prefer-software` in WebView2:** NOT independently confirmed this round (no live/Windows run permitted). `docs/ws3-export-recovery-architecture.md` §4a already reasoned it is a valid WebCodecs value in every Chromium-family engine with OpenH264 shipped for software encode, and flagged the actual WebView2 exposure as NOT DETERMINED absent a live run — that status is unchanged. What WOULD confirm it: a `VideoEncoder.isConfigSupported({..., hardwareAcceleration: 'prefer-software'})` probe logged from a real `tauri:dev` session on Windows.
- **Failover trigger and ordering: REWIND FIRST, failover only once the rewind budget is exhausted — argued, not assumed.** A rotation flush timeout already has a tested, landed same-rung recovery (Rung 3). Failing over to software on the FIRST such timeout would discard a fast hardware path over what might be one transient stall — exactly the "salvage becomes routine" failure mode `MAX_BOUNDARY_REWINDS_PER_EXPORT`'s own doc comment already warns against, just one rung earlier. So: `decideBoundedRerenderDisposition` is consulted first (unchanged); only when IT returns abort does `decideHardwareFailoverDisposition` get a turn, and it is one-shot (`hardwareFailoverUsed` boolean, never a counter).
- **Worst-case total attempt count, PROVEN bounded:** 1 initial attempt + `MAX_BOUNDARY_REWINDS_PER_EXPORT` (2) same-rung rewinds + 1 one-shot software failover retry = **4 total `driveGlRun` attempts, 3 total `truncateAnnexbToOffset` calls, per export** — regardless of how many GL pieces or rotation boundaries the export contains, because both gating resources (`boundaryRewindsUsed`, `hardwareFailoverUsed`) are export-scoped, not per-piece/per-boundary. Proven by `hardwareFailoverWiring.test.ts`'s "total worst-case attempt bound" test (destructively RED/GREEN probed: `decideHardwareFailoverDisposition` forced to always abort → 4 tests across 3 files went RED, confirming they actually catch the regression; restored → GREEN).
- **fps penalty estimate: SPECULATIVE, carried from `docs/ws3-export-recovery-architecture.md` §4c, not independently measured** — "tens of seconds to a couple of minutes for 1800 frames" for a 60 s 1080p30 software session vs. hardware's seconds; no separate 1080p60 estimate exists in that doc or was computable this round without a live run. Flagged NOT DETERMINED / hardware-bound.
- **Mixed-rung concat verdict: REASONED CLEAN, not measured.** Annexb emits SPS/PPS inline ahead of every IDR, so a decoder re-reads parameter sets at a rung-change seam and the mux (`-r <fps>` on a PTS-less raw stream) is unaffected — per `docs/ws3-export-recovery-architecture.md` §4c, adopted here. **Real risk, MEDIUM, unresolved:** `isConfigSupported` passing does not guarantee which profile/level a given rung actually emits (this codebase's own `createEncoder` comment already says so), so a software rung could legally emit a different profile than hardware mid-file — decodable and guard-passing, but a quality/compatibility discontinuity nothing in the pipeline would notice. Not measured this round (no live encoder available); recorded as a NOT DETERMINED row (§5).
- **Output neutrality: PROVEN, full bytes, not a metadata hash.** `hardwareFailoverWiring.test.ts`'s "OUTPUT NEUTRALITY (full bytes, not a metadata hash)" test records every `appendFileRaw` call through a real recording mock and asserts the exact concatenated byte sequence, in order, against the exact chunk bytes emitted — for a run that never fails over. Passes.

**STEP 4 — Rung 5b (adaptive throttling): LANDED.**
- **Threshold:** `THROTTLE_SOFT_WATER = 2` (half of the pre-existing, unchanged `BACKPRESSURE_HIGH_WATER = 4`).
- **Backoff shape:** linear, `computeThrottleDelayMs(q) = min(THROTTLE_STEP_MS * (q - THROTTLE_SOFT_WATER), MAX_THROTTLE_DELAY_MS)` for `q > THROTTLE_SOFT_WATER`, else 0. `THROTTLE_STEP_MS = 5` ms, `MAX_THROTTLE_DELAY_MS = 10` ms.
- **Recovery condition:** automatic, stateless — the function is continuous in `encodeQueueSize`, so there is no discrete on/off boundary to oscillate across and no separate hysteresis state is needed.
- **Non-deadlock proof #1 (never trips `FORWARD_PROGRESS_BOUND_MS`):** arithmetic + structural. `MAX_THROTTLE_DELAY_MS` (10 ms) x `MAX_ENCODER_SESSION_FRAMES` (1,800) = 18,000 ms, under `FORWARD_PROGRESS_BOUND_MS` (45,000 ms) even under the impossible assumption that every frame in a whole session pays the maximum delay back-to-back with zero appends completing in between. Structurally, the delay only paces the moment BEFORE a frame is submitted and never blocks an append already queued, so it cannot itself withhold the per-completed-append reset. Pinned by `throttlePolicy.test.ts`.
- **Non-deadlock proof #2 (composes with the 32 MB append gate):** proven with the REAL `exportWorker.ts` frame loop (`throttleBackpressureDeadlock.test.ts`) — a frame with `encodeQueueSize` fixed at 3 (throttle engaged every frame, hard wait never) that also submits a 40 MB chunk (parking the real `AppendBackpressureGate`) completes once, and only once, an 'append-ack' message arrives; fake timers prove the throttle's own `setTimeout` needs no real wall-clock wait. **Destructively RED/GREEN probed**: withholding the ack leaves `'done'` never emitted (RED, confirmed); restoring it, GREEN.
- **Driver-stall-warning interaction: ANSWERED.** No active production "driver is struggling" warning currently exists to suppress — `encodeQueueSizeAtFlushExpiry` (post-mortem, sampled only at flush expiry) and the `'queue-sample'` message (explicitly documented as diagnostic-only, "no orchestrator behaviour depends on this") are the only two artifacts, and neither is read as a live warning anywhere in `exportPipelineWebCodecs.ts`/`App.tsx`. So today, throttling suppresses nothing. Flagged forward: if such a warning is EVER built from raw `encodeQueueSize` trajectory, it would be blind by construction, because BOTH the pre-existing `BACKPRESSURE_HIGH_WATER` hard cap and this round's throttle now actively suppress that exact signal — a future warning needs `wait-dequeue` time or the throttle's own internal state instead. Recorded as a NOT DETERMINED row (§5) so it isn't rediscovered the hard way.

**STEP 5 — Rung 5c (process isolation): DECIDED — DEFER.** Full four-question answer and reopen trigger: see §7 below (kept as its own durable section, not buried in this dated log entry, per the task's "record the decision... so it is never re-litigated").

**STEP 6 — both numbers closed:**
- **6a:** break-even latency ≈ **5,654.5 ms/call** (SIMULATED bisection, `scripts/ws3-measure-append-throughput.test.ts`'s new "back-pressure break-even latency" block) — ≈456x the measured 12.4 ms Windows figure, ≈226x the pathological 25 ms figure tested. **Not reachable on any plausible hardware measured or discussed this round** — back-pressure is, in practice, a ceiling guard for this chunk profile, not something any measured or speculated latency exercises.
- **6b:** `APPEND_QUEUE_CEILING_BYTES` (256 MB) is **restated explicitly as a last-resort memory guard**, deliberately NOT derived from the unbatched-path pathological peak (708 MB @ 25 ms) — deriving from it would be a category error, since production is always batched and the batched path's own peak stays in the low single-digit MB at every latency measured. Reopen trigger: a real field export reporting `queueDepthBytes` anywhere near 256 MB.

**Gate arithmetic:** `npx tsc --noEmit` clean. `npm run lint` (= `tsc --noEmit` per `package.json`) clean. `npm test` run twice, both green: **3483 = 3406 passed + 77 skipped + 0 failed**, both runs identical. Delta from the `51e1f6b` baseline (3467): **+16 tests**, enumerated — `hardwareFailoverPolicy.test.ts` (3, new), `hardwareFailoverLadder.test.ts` (2, new), `hardwareFailoverWiring.test.ts` (3, new), `throttlePolicy.test.ts` (5, new), `throttleBackpressureDeadlock.test.ts` (1, new), `scripts/ws3-measure-append-throughput.test.ts` (+2, extended — was 1 test, now 3), `boundedRerenderWiring.test.ts` (net 0 — 5 tests before and after; one test's body was extended to cover the new failover branch, none added/removed). `git diff --name-only 51e1f6b -- src-tauri/` empty. `git status --porcelain -- src-tauri Cargo.lock` empty.

**Files touched, functions named exactly (for a mechanical integration merge):**
- `src/services/webcodecsExport/exportWorker.ts` — added `ExportWorkerInitMessage.forceSoftwareEncoder`; added `SOFTWARE_ONLY_LADDER`, `THROTTLE_SOFT_WATER`/`THROTTLE_STEP_MS`/`MAX_THROTTLE_DELAY_MS`/`computeThrottleDelayMs`/`sleep`; `createEncoder` gained a 6th `ladder` parameter (default `HARDWARE_LADDER`, iterates `ladder` not the constant directly); `buildEncoder`'s `createEncoder(...)` call site passes the ladder conditionally; `runFrameLoopTick` gained the throttle-sleep block immediately before the pre-existing `BACKPRESSURE_HIGH_WATER` check. No other function touched.
- `src/services/webcodecsExport/exportPipelineWebCodecs.ts` — added `DriveGlRunDeps.forceSoftwareEncoder`; `driveGlRun`'s `initMsg` construction threads it through; added `decideHardwareFailoverDisposition` + `HardwareFailoverDisposition` type (new function, next to `decideBoundedRerenderDisposition`); `exportProjectWebCodecs` gained `hardwareFailoverUsed` (new local, alongside `boundaryRewindsUsed`); `runGlPiece` gained a `forceSoftware` parameter; the rewind `while` loop's abort branch (previously an unconditional `break`) now consults `decideHardwareFailoverDisposition`; the `boundaryRewindsUsed++`/`runGlPiece(...)` call at the loop's tail is now conditional on `!forceSoftware` / passes `forceSoftware` through. `segmentEncoder.ts` (the file this round was warned is shared with Cursor's concat path) — **NOT TOUCHED**, confirmed by `git status`; Rung 5a's failover is entirely a WebCodecs/GL-tier mechanism and never needed `encodeCanvasPiece`.
- `scripts/ws3-measure-append-throughput.test.ts` — added `batchedNoGateConfig` + a new `describe` block (2 tests: monotonicity precondition, the bisection itself). No existing function/test touched.
- `src/services/webcodecsExport/boundedRerenderWiring.test.ts` — one existing test's body extended (loop bound +1, assertions updated) to cover the new failover branch it now exercises as a side effect of the rewind budget being exhausted; nothing else in the file touched.
- New test files (no existing production logic touched by their addition): `hardwareFailoverPolicy.test.ts`, `hardwareFailoverLadder.test.ts`, `hardwareFailoverWiring.test.ts`, `throttlePolicy.test.ts`, `throttleBackpressureDeadlock.test.ts`.

**What broke (and was caught before shipping):** the pre-existing `boundedRerenderWiring.test.ts` "stops rewinding once MAX_BOUNDARY_REWINDS_PER_EXPORT is reached" test timed out once Rung 5a shipped — its fixture never answered the NEW 4th init message (the failover attempt), so the awaited result promise never resolved. Not a production bug: the test's own fixture became stale the moment the intentional behavior change (fail over once, don't just abort) landed. Fixed by extending the fixture one attempt further and updating its exact-count assertions; destructively re-probed (`decideHardwareFailoverDisposition` forced to always abort → RED across 4 tests in 3 files, confirming real detection; restored → GREEN).

---

### Round 10 (2026-09-11) — Tier 2 closeout: sealing wired, resume wired, Rung 0 holes closed

**Branch** `ws3-tier2-wire`, cut from `ws3-export-integration`. Base `main` `4d4922c`.

**Cut-point correction.** The round's task text said "cut from `ws3-export-integration` @ `beab034`".
That branch's head is `15002e5` (two commits later), which is also the task's own stated rollback
point, and `15002e5` is the merge base of BOTH branches merged this round. Cut from `15002e5`.

**SHAs.**

| SHA | What |
|---|---|
| `81815cd` | merge `ws3-durable-resume` @ `81bde88` |
| `0ab9af8` | merge `ws3-tier3-failover` @ `dedc3bf` |
| `46cfda8` | STEP 2 — bound both unbounded native calls on the recovery path |
| `7b53676` | STEP 3 — wire the sealing seam (guard -> offer -> consent -> seal) |
| `8d5eb7d` | STEP 4 — wire durable checkpoint resume |
| `1e61e84` | STEP 5 — mixed-rung parameter-set spike |
| `2ef8399` | STEP 6 — end-to-end recovery matrix |

**Merge conflicts: ZERO, and structurally so — not luck.** The two branches touched DISJOINT file
sets: `git diff --name-only 15002e5 81bde88` and `... 15002e5 dedc3bf` intersect in nothing.
The round's task text predicted "genuine overlap, since Rung 3's rewind and Rung 2b's sealing both
dispose of a failed session, and both branches touched `exportPipelineWebCodecs.ts`". The second
half is factually wrong: `ws3-durable-resume` never touched `exportPipelineWebCodecs.ts` at all —
it put sealing in `muxOnly.ts` and resume in `exportCheckpoint.ts` and left every call site alone.
That disjointness IS why the seams were unwired, so the absence of conflicts and the existence of
Blockers 2 and 3 are the same fact.

**Arrival verification (six artifacts).** AJ-0 timeout at `530_000` present, `180_000` gone
(`scripts/ws1-session-aj0-oracle-diff.test.ts:98`, and the file's only remaining "180" is inside an
unrelated number). Durable failure recorder present and wired as a vitest reporter
(`vite.config.ts:30` -> `scripts/vitest-failure-record.ts`, writing
`.ws3-test-failures/<ISO>-<sha>.json` + `latest.json`); it fires only on a failing run and did so on
this round's own red probes. Conservative final-AU drop present and confined (below). Measured mux
bounds present: 345,500 ms @ 1.7 GB, 511,750 ms @ 2.3 GB. `SealingOfferSeam` present in
`muxOnly.ts`; `ResumeHandshakeSeam` present in `exportCheckpoint.ts`.

**STEP 2b re-verified in ONE tree, and pinned.** `finalAuDropConfinement.test.ts` asserts
structurally that the conservative drop predicate has exactly one live call site
(`compute_truncate_cut_from_scanned`), that `truncate_annexb_inner` takes that cut and
`truncate_annexb_to_offset_inner` never does, that the exact-offset Tauri command routes only to the
exact-offset inner, and — behaviourally, via the JS twin — that the predicate is live at all.
Destructive probe: adding a `compute_truncate_cut_from_scanned` call to
`truncate_annexb_to_offset_inner` turns it red; reverted by move, never by `git checkout`.

**STEP 2 — the bounded-call enumeration.** Every native/ffmpeg call reachable from a failure
disposition (rewind, salvage, sealing, resume):

| # | Call | Path | Bounded? | Constant | Where the wrap is |
|---|---|---|---|---|---|
| 1 | `ffmpeg.truncateAnnexbToOffset(runFile, absoluteByteOffset)` | Rung 3/5a rewind | **YES — fixed this round** | `TRUNCATE_BOUND_MS` (172,675 ms) | `exportPipelineWebCodecs.ts`, rewind loop's truncate try-block |
| 2 | `ffmpeg.truncateAnnexb(runFile)` | final-flush salvage | YES (pre-existing) | `TRUNCATE_BOUND_MS` | salvage block |
| 3 | `ffmpeg.countAnnexbFrames(finalVideoFile)` | post-concat guard | YES (pre-existing) | `FRAME_COUNT_BOUND_MS` | guard block |
| 4 | `ffmpeg.countAnnexbFrames(path)` per piece | guard's diagnostic breakdown, reached ONLY after the guard fails | **NO -> YES, fixed this round** | `FRAME_COUNT_BOUND_MS` | inside the `Promise.all` map |
| 5 | `ffmpeg.concatAnnexbPieces` | concat | YES (pre-existing) | `CONCAT_BOUND_MS` | concat block |
| 6 | `ffmpeg.sessionFileSize(finalVideoFile)` | mux sizing | no — a `metadata()` stat, no scan, no child process | — | — |
| 7 | `muxOnly` / `sealTruncatedAnnexbToMp4` | mux and SEAL | YES | `computeMuxBoundMs(annexbBytes)` | mux block; the seal runs inside the same wrapper |
| 8 | `TauriFfmpeg.listResumableSessionIds` | resume discovery | no — a `read_dir` of `$TMPDIR`, no scan | — | — |
| 9 | `TauriFfmpeg.reenter` | resume discovery | no — a directory check + a state-map insert | — | — |
| 10 | `session.readExportState` | resume discovery | no — reads a <6 KB manifest | — | — |
| 11 | `session.sessionFileSize` | resume discovery | no — a stat | — | — |
| 12 | `session.prepareCheckpointResume` (the fence) | resume | **inherits** — it is three `truncate_annexb_inner`-class scans, and Rust polls the same cooperative `AtomicBool` the bounded calls set. NOT wrapped on the JS side. See the caveat below. | — | — |
| 13 | `session.truncateAnnexbToOffset` (post-fence seam step-back) | resume | same as 12 | — | — |
| 14 | `countPictures` per earlier piece | resume verification | **YES** | `FRAME_COUNT_BOUND_MS` | `exportResumeSession.ts`'s `countPictures` |
| 15 | `ffmpeg.writeExportState` | checkpoint write | **structurally unable to stall** — never awaited, single-slot, coalescing. See the Bound register row. | — | `exportCheckpointWriter.ts` |
| 16 | `ffmpeg.kill()` inside the bound's own expiry handler | every bounded call | **NO — the one remaining hole** | — | `ffmpegLivenessBound.ts:288`. Reported, not fixed: every fix needs an unmeasured `kill()` constant. NOT DETERMINED row added. |

Rows 12/13 are the caveat worth naming: the fence and the seam step-back are the two native calls on
the resume path with no JS-side bound. They are bounded in the same sense the rest of the resume path
is — a cancelled session's `AtomicBool` stops them — but they do not carry a `withFfmpegLivenessBound`
wrapper, because a resume runs BEFORE `activeFfmpeg` is set and a bound that killed the session
mid-fence would leave the survivor in the one state the fence exists to prevent. Whether that
trade is right is a next-round question; it is stated here rather than left implicit.

**STEP 3 — sealing.** Wired as guard -> offer -> consent -> seal. **Round 9's claim that there was
"no guard call" at that seam was wrong**: `ffmpeg.countAnnexbFrames` (native
`count_annexb_access_units`, picture-accurate) has run there under `FRAME_COUNT_BOUND_MS` since
before the merge. Only the offer/consent/seal half was missing.

Consent decision: Cursor argued explicit consent over automatic sealing. Having seen the call site,
that is right and is what shipped. The guard is the only thing standing between a wedged encoder and
a video the operator does not know is truncated, and an automatic seal would convert a loud failure
into a quiet one. The dialog states frames kept, frames lost, and the wall-duration of each; there is
no default, no timeout and no "remember this". A cancel, an unmounted surface, and a consent callback
that throws are all DECLINES.

The four constraints, each with its probe:
1. *Guard not relaxed.* `measured` is the post-drop count and nothing compensates. Probe: feeding
   `pictures + 1` into the offer turns two tests red.
2. *Declining is unchanged.* Asserted by EQUALITY against the failure produced with no consent hook
   wired at all — the pre-wiring behaviour. Probe: defaulting an absent hook to consent turns it red.
3. *Clean path neutral.* The complete ffmpeg call trace of a clean export — every call, in order,
   with the mux exec's full argv — is asserted, and the SAME assertion passes unchanged against the
   pre-wiring pipeline restored from `46cfda8`. (Neutrality is proven at the level of the complete
   invocation sequence and arguments, which is what determines the output bytes; a unit test's fake
   ffmpeg produces no bytes to compare. The assertion has been shown red — it caught a
   `deleteFile` miscount while being written.)
4. *Post-drop numbers.* Asserted directly on the offer the consent callback receives.

**STEP 4 — resume, and the finding it rests on.** The obvious checkpoint — the rotation seam — is the
ONE offset the native fence cannot accept. Its step 5 re-runs the conservative whole-AU repair on the
prefix step 4 cut to, and a prefix cut at a seam ends on a coded slice with nothing after it to prove
that picture closed, so the repair drops it and `bytesRemoved != 0`. Cursor's own Rust fixture passes
at an "exact-au-boundary" only because `build_multi_slice_stream` writes SPS+PPS AFTER every picture,
which no real encoder does — the helper right below it carries a comment saying it exists for exactly
this reason. `exportCheckpointPlacement.ts` states the rule (seam + the byte index of the first coded
slice in the following bytes; decline when there is none) and
`exportCheckpointPlacement.test.ts`'s first test IS the finding, on encoder-shaped bytes.

Both offsets are recorded, because the fence's acceptance criterion and a byte-exact resume are
incompatible with one. The fence verifies at `byteOffset`; the resumer then cuts back to
`seamByteOffset` before appending, because appending a re-rendered access unit onto a prefix that
already holds its parameter sets and AUD writes them TWICE — not a conforming access-unit sequence,
and invisible to the picture counter. Both prefixes hold `cumulativePictures` pictures, asserted at
resume. This defect was found by the resumed-vs-uninterrupted test producing a file 31 bytes longer
than the control, not by inspection.

Manifest scope is PER PIECE — the only scope under which a fence that takes one file and
`appendExportCheckpoint`'s strict monotonicity can both hold. Discovery proves the earlier pieces by
picture count instead, which is stronger than a byte offset would have been.

Discovery ordering, asserted by recorded call order and not only by result: read + validate (identity
first, with zero bitstream I/O on a mismatch) -> fence -> seam step-back -> count earlier pieces.
Nothing counts before the fence; a fence refusal or a fence result that disagrees with the checkpoint
counts nothing at all.

Cleanup policy: keep at most one abandoned session besides the resumable one, none past a 7-day TTL,
never collect a session that is still resumable or the one in use. Runs in `findResumeOffer`, at
export start, after the fresh session exists so it is protected. Disk bound ≈ 4.6 GB at the 2.3 GB
sizing case. Age from a renderer-side ledger, since no native command exposes a directory mtime and
Rust was frozen; an unknown id sorts OLDEST.

Resumed-equals-uninterrupted is proven with a byte-real fake ffmpeg (append, truncate-to-offset,
concat, size and picture count are all genuine over an in-memory buffer): same picture count AND
byte-identical files.

Probes, all RED then GREEN: counting before the fence; removing the `sourceTimelineHash` gate;
removing the cleanup policy's protected-set filter; placing the checkpoint at the seam.

**STEP 5 — the parameter-set spike.** Measured, Chromium 152 on macOS, avc1.640028, 640x360@30,
30 frames per rung:

| Field | `prefer-hardware` | `prefer-software` |
|---|---|---|
| profile_idc | 100 | 100 |
| level_idc | 30 | 30 |
| constraint flags | `[0,0,0,0,0,0]` | `[0,0,0,0,1,1]` |
| chroma_format_idc / bit depths | 1 / 0 / 0 | 1 / 0 / 0 |
| entropy_coding_mode_flag | **true (CABAC)** | **false (CAVLC)** |
| SPS payload | `64001eac1316c0a0…` | `640c1eac18d01405…` |
| PPS payload | `ee1f2c` | `ce3c80` |

Four differences. The join (hardware-then-software, 60 pictures, 102,246 bytes): our own
picture-accurate counter reads 60/60; `VideoDecoder` returns 60 frames with no error; the real
x86_64 ffmpeg sidecar binary muxes 60 frames AND fully decodes all 60 with zero warnings.

**Which question this answers:** the MECHANISM one — our pipeline tolerates a parameter-set change
mid-stream, including a CABAC->CAVLC switch, because every IDR carries inline SPS/PPS and both the
decoder and ffmpeg re-read them at the join. Profile agreement is not what makes it work; the more
dangerous field disagrees and it still works. **Which it does not:** Windows (Media Foundation vs a
different software encoder) — Tier 4, hardware-bound; and WKWebView, where the app actually encodes —
this ran in Chromium, so it compares VideoToolbox to OpenH264 through a different host. No mitigation
is needed on the strength of this result, so none is recorded as a decision.

**STEP 6 — the recovery matrix and the total bound.** Nine rows in `recoveryMatrix.test.ts`, all
driving the real `exportProjectWebCodecs`. Arithmetic:

```
per hung rotation boundary   1 initial + MAX_BOUNDARY_REWINDS_PER_EXPORT (2) + 1 failover = 4 attempts
truncates for those          2 + 1 = 3
salvage, per GL piece        1 truncateAnnexb + 1 count
concat guard, per export     1 count (+ P per-piece counts on failure, P = piece count)
sealing, per export          1 offer + 1 consent + 1 seal (which is one muxOnly)
resume, per export           <= S fences + 1 seam step-back + K counts
                             S = surviving session dirs (cleanup holds this at <= 2 in steady state)
                             K = the resumed piece's index
```

The failover's one-shot flag is deliberately not charged to the rewind budget, which is why ROW 2 and
ROW 3 both land on exactly 4 attempts and exactly 3 truncates. Every native call in that space is in
the STEP 2 table above, with the two named exceptions (rows 12/13) and the one named hole (row 16).

**Gate arithmetic.**

| Gate | Expected | Observed |
|---|---|---|
| `npm test` post-merge, pre-work | 3,420 pass + 77 skip = **3,497** | **3,420 / 0 / 77 (3,497)** |
| `npm test` final | 3,497 + **73** added = **3,570** | 3,493 pass / 0 fail / 77 skip, twice |

Per-file arithmetic for the 73 added, all under `src/services/webcodecsExport/`:
`finalAuDropConfinement` 4 · `rewindTruncateBound` 2 · `forcedSealWiring` 8 ·
`exportCheckpointPlacement` 6 · `exportResumeDiscovery` 14 · `exportResumeWiring` 6 ·
`exportSessionLedger` 5 · `tauriFfmpegCheckpointSurface` 10 · `h264ParameterSets` 9 ·
`recoveryMatrix` 9. Sum = 73.
| `cargo test` | 293 / 0 / 5 | **293 / 0 / 5** |
| `cargo test --features fa-inference` | 379 / 0 / 35 | **379 / 0 / 35** |
| `git diff --name-only main -- src-tauri/` | non-empty, `ffmpeg.rs` + `lib.rs` | as expected |
| `git diff --name-only 81bde88 -- src-tauri/` | empty | **empty** |

**Cargo baseline correction, carried forward.** The round's task text asked to "carry forward the
corrected Cargo baseline 283/0/5". That figure is not this tree's: `cargo test` measures
**293 / 0 / 5** here, twice, on the merged tree. 283 appears in
`docs/ws3-export-durable-state.md` as the pre-`afa8818` CUT-POINT count in an arithmetic line
("actual cut 283 + 5 = 288 / 0 / 5"), i.e. an input to a sum, never a suite total. The authoritative
pair is **293 / 0 / 5** and **379 / 0 / 35**.

**What broke.** Nothing in the merge. Two things broke during the wiring, both found by tests and
both fixed:
1. Five `vi.mock('./muxOnly', () => ({ muxOnly }))` factories were TOTAL module mocks. Once the
   orchestrator reached the sealing exports in that module, the mock deleted them and a typed guard
   failure became a generic one. Made partial with `importOriginal`.
2. Resuming at the fence-verified offset duplicated the next access unit's parameter sets, as above.

**`docs/ws3-export-durable-state.md` corrections for Cursor** (collected, not made — that file is
Cursor's):
1. `ExportCheckpointRecord.byteOffset`'s doc says "Byte offset into the concatenated Annex-B file".
   There is no concatenated file while an export is rendering; each piece is its own
   `piece_<n>.h264` and `video_all.h264` does not exist until after the last piece. The offset is
   per piece. (The `seamByteOffset` field added this round documents the corrected model in place.)
2. The Rust fixture `build_multi_slice_stream` writes SPS+PPS AFTER every picture. That is why the
   `checkpoint_resume_repairs_...` test's "exact-au-boundary" and "clean" rows pass with
   `bytes_removed == 0`. Real encoder output leads each access unit with its parameter sets, so a
   prefix cut at a true rotation seam does NOT survive step 5. The test is correct about the code and
   misleading about the world; a fixture shaped like
   `buildSyntheticSingleSliceWithParamSets` would say so.
3. The `ResumeHandshakeSeam` doc says CC must supply "`serializedManifest` bytes" and an
   `ExportCheckpointResumeIo`. The JS `prepareCheckpointResume` wrapper additionally requires that
   `repair.keptBytes === checkpoint.byteOffset`, which is a file-local reading of `byteOffset` and so
   contradicts correction 1's "concatenated file" wording. Worth reconciling in one direction.
4. `docs/ws3-export-durable-state.md:675` records "actual cut 283 + 5 = 288 / 0 / 5". That 283 has
   since been quoted downstream as a suite total. Worth marking as an addend.

**Tier 2: CLOSED.** Rungs 2b, 3 and 4 are all wired, and verified together rather than only apart.

## 7. Decisions register (durable — not round-log, never re-litigated without overturning the entry)

### Rung 5c — out-of-process render isolation: **DEFER** (decided Round 9, 2026-09-10)

Deferred three times before this round (per Part 0's own framing); decided here, adopting
`docs/ws3-export-recovery-architecture.md` §6's own prior analysis as the authoritative
reasoning (that document reached the identical conclusion independently, with a fuller
two-shape cost comparison this entry summarizes rather than re-derives).

1. **Would it have prevented the frame-47,840 hang? No — confirmed, and the premise itself
   needs correcting.** That export was never actually hung: `docs/ws3-export-recovery-architecture.md`
   §6a is unambiguous — process isolation contains CRASHES, not HANGS. A `flush()` that never
   returns still never returns in another process; the caller still waits. What isolation buys
   is the ability to KILL the stuck process and survive, and this pipeline already has that —
   the export body runs in a `Worker`, and the orchestrator's watchdog already calls
   `worker.terminate()` on timeout, a hard kill that needs no cooperation from the worker. So
   for a hang, the marginal gain of a separate OS process over the existing `Worker.terminate()`
   is close to zero. Isolation addresses failures this pipeline does not currently have evidence
   of having had, not the one actually investigated.
2. **Which failures it WOULD genuinely save, concretely:** (a) a renderer crash or OOM that
   takes the whole app down — a `Worker` shares the renderer process, so a crash there loses
   the app and the current project, not just the export; this is the strongest genuine case,
   and it is about blast radius, not liveness. (b) Main-thread timer throttling under WKWebView
   occlusion (the documented run-5 class, `docs/ws3-silent-gaps-diagnosis.md`, 223.6 s of
   starved `setTimeout` deadlines) — a native process is not subject to that policy at all; this
   is the one class where isolation is a real fix, not a nicer failure mode. **Concretely NOT**
   `glCompositor.ts:202`'s GPU-context-loss throw (`createContentTexture` → `requireGl`) — a lost
   WebGL context is a driver/compositor event that happens in whatever process owns the context;
   isolation changes WHERE the exception surfaces, not WHETHER it occurs, and it is already
   handled deterministically today (`exportWorker.ts`'s `contextLost` flag → `'gl-context-lost'`
   failure identity, verified present this round at `exportWorker.ts:1835-1839`).
3. **Cost, native Rust render vs. hidden-WebView isolation:** a full native render process needs
   the WebGL2 compositor, the GL text renderer (~900 lines), decode, and encode all rewritten
   against a new IPC protocol — MONTHS, and it re-opens every parity question the export plan
   already settled once; it is the ONLY shape that actually fixes the occlusion class (item 2b),
   being outside WebKit's throttling policy entirely. A second hidden WebView window is DAYS —
   one seam (`ExportWorkerHandle`, already the sole surface `driveGlRun` depends on) — but fixes
   NEITHER the investigated hang NOR the occlusion class, and is arguably WORSE for occlusion: a
   window that is never visible is the maximally-throttled case of exactly the policy that caused
   the documented run-5 failure.
4. **Defer or implement: DEFER.** Neither shape addresses the failure actually investigated,
   the cheap shape does not address the one class isolation WOULD help with, and the expensive
   shape that does is a rewrite whose engineering budget produces more value spent on Rungs 2b/3/4/5
   (which this round and Cursor's concurrent round are actively closing) than on a speculative
   rewrite.

**Reopen trigger (specific, not "if problems continue"):** a real, OBSERVED occurrence of EITHER
— (a) a renderer crash/OOM during export that took down the whole app and lost unsaved project
state, not a hypothetical; or (b) a second field-verified occurrence of the WKWebView-occlusion
timer-starvation class documented in `docs/ws3-silent-gaps-diagnosis.md`'s run 5, confirming it
is a recurring failure mode rather than a one-off. Either observation reopens this decision;
absent one, it stays deferred.
