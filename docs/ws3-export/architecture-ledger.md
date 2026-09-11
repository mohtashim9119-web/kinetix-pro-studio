# WS3 Export — Architecture Ledger

> **A note on taxonomy, read before trusting the numbers below.** No prior committed doc
> in this repo defines a 0-5 "Rung" scale or a "Tier 1-4" scale under those exact names —
> `docs/ws3-export/recovery-architecture.md` uses its OWN 1-13 rung numbering (different
> scheme, same underlying mechanisms in most cases). The Round 7 task that created this
> file used "Rung 3" / "Tier 1 item 3b/3c/4" as if a 0-5 / 1-4 scale already existed and
> was common ground. It was not found in any committed doc by this session. **This ledger
> is therefore the FIRST place these two scales are formalized**, built from (a) the
> literal content of the Round 7 task and (b) the actual code. The Rung table's 0-2 are a
> confident mapping onto `exportWorker.ts`'s real `HARDWARE_LADDER`; 3-4 map onto real,
> shipped code; 5 is inferred from the older doc's "designed, not built" rung 10
> (software failover). The Tier table's Tier 1 is fully known (this round's own task);
> Tiers 2-4 are NOT known to this session — see the NOT DETERMINED register's first row.
> **Whoever holds the authoritative Tier 2-4 definition should correct this file before
> trusting it for planning purposes beyond Tier 1.**

---

## 1. Rung table (0-5)

The encoder/recovery escalation ladder. 0-2 are "which encoder backend," 3-5 are "which
recovery action when something goes wrong."

| Rung | What it is | Status | Owning file:line | Landing SHA |
|---|---|---|---|---|
| 0 | `prefer-hardware` — first `VideoEncoder` config attempted, every session build | LANDED | `exportWorker.ts:1152` (`HARDWARE_LADDER[0]`), tried in `createEncoder`'s ladder loop, `exportWorker.ts:1187` (`for (const hardwareAcceleration of HARDWARE_LADDER)`) | pre-existing (before this round) |
| 1 | `no-preference` — second attempt if rung 0's `isConfigSupported`/`configure` fails | LANDED | `exportWorker.ts:1152` | pre-existing |
| 2 | `prefer-software` — third attempt; exhausting all three throws | LANDED | `exportWorker.ts:1152`; selected rung recorded on every build via `activeSelectedHardwareRung` (`exportWorker.ts`, set inside `createEncoder`'s success path) and surfaced as `selectedHardwareRung` on the diagnostics payload | pre-existing |
| 3 | **Bounded re-render** — on a MID-run (rotation) flush timeout only: fence the hung session, truncate `runFile` back to the last rotation boundary's exact byte offset (never scanned — established by a completed `VideoEncoder.flush()` before that rotation was ever posted), resume the SAME piece's frame loop from that boundary via a fresh `driveGlRun` call. One attempt per boundary, `MAX_BOUNDARY_REWINDS_PER_EXPORT = 2` total per export. | **LANDED this round** | Decision: `decideBoundedRerenderDisposition`, `exportPipelineWebCodecs.ts:2289`. Wiring/retry loop: `exportPipelineWebCodecs.ts:2474-2610` (`runGlPiece`, the `while (!driveResult.ok)` loop at `:2527`, the truncate call at `:2557`). Resume plumbing: `exportWorker.ts`'s `ExportWorkerInitMessage.resumeFromFrameIndex` and the reordered `runExport` setup that computes `initialSessionIndex` before building the first encoder. Orchestrator-side session-index bootstrap for a SECOND rewind: `DriveGlRunDeps.resumeSessionIndex`, `exportPipelineWebCodecs.ts` (seeds `sessionAt`/`sessionByteOffsets`/`sessionFrameIndices` at the resumed index instead of defaulting to 0 — a real bug found and fixed mid-round, see Round 7 log). | `a6581d2` |
| 4 | **Salvage-and-truncate** — on a FINAL-flush timeout (the run's LAST planned session only): fence, salvage once (`MAX_FLUSH_SALVAGES = 1`), truncate to the last complete access unit (`ffmpeg.truncateAnnexb`, AU-scanned since there is no clean rotation boundary to fall back to), accept the piece only on an EXACT picture-count match against `plan.expectedFrames`. | LANDED (prior round: `ws3-salvage-runtime`) | `exportWorker.ts`'s `runFinalFlushWithRecovery`/`decideFlushTimeoutDisposition`; `exportPipelineWebCodecs.ts`'s post-truncation mismatch guard (`formatSalvageTruncateMismatch`) | prior round (`2959861` base, `6efd525`/`765f546`/`efff8ee` per `git log`) |
| 5 | **Software failover at a rotation boundary** — if hardware encoding keeps failing mid-export, force the NEXT session to build at rung 2 (`prefer-software`) rather than restarting the ladder from rung 0 every time. | NOT STARTED | none (inferred successor to `docs/ws3-export/recovery-architecture.md`'s old rung 10, "designed, not built") | — |

---

## 2. Tier table (1-4)

| Tier | Item | Description | Status | Owning file:line | Landing SHA |
|---|---|---|---|---|---|
| 1 | 3a | (Pre-existing, not this round) Append batching, 100:1 IPC reduction | LANDED | `exportPipelineWebCodecs.ts` (`APPEND_BATCH_CHUNKS`/`APPEND_BATCH_BYTES`/`flushPendingBatch`) | prior round (`89317ea`) |
| 1 | 3b | Worker-side back-pressure against the append/IPC path — a gate that pauses the frame loop (never the append pipeline itself) once unacked bytes exceed 32 MB, unblocked only by a real completed append's ack | **LANDED this round** | `appendBackpressureGate.ts` (class + `APPEND_BACKPRESSURE_THRESHOLD_BYTES`, `:52`/`:71`); worker wiring `exportWorker.ts:1401` (wait), `:1442` (construct), `:1589` (submit), `:2015` (ack-in); orchestrator ack-out `exportPipelineWebCodecs.ts:1639` | `a6581d2` |
| 1 | 3c | Bounded re-render — see Rung 3 above (same work, Tier/Rung cross-reference) | **LANDED this round** | see Rung 3 row | `a6581d2` |
| 1 | 4 | `ExportAppendLedger`'s `doneReceived`/`msSinceDone` (and every other liveness field) reaches the operator-visible Copy-diagnostics blob end to end, with a permanent regression test | **LANDED this round** | `exportDiagnosticsBlob.ts:34` (extracted `buildExportDiagnosticsBlob`, was inline in `App.tsx`); centrally-stamped `appendLedger`/`msSinceLastPhaseChange` on `RunDriveResult` via `buildAppendLedger` (`exportPipelineWebCodecs.ts:1363`) and `finish` (`:1434`) | `eb95bac` |
| 1 | NOT DETERMINED #1/#2 closure | Append-throughput measurement at 3 latencies, unbatched vs batched+back-pressure | **SIMULATED this round** — see §5 register and §6 | `scripts/ws3-measure-append-throughput.test.ts` | `265fcae` |
| 1 | NOT DETERMINED #5 closure | Confirm `doneReceived`+`msSinceDone`+`queueDepthChunks` are jointly readable from one payload with no inference | **LANDED this round** (same work as Tier 1 item 4) | `exportDiagnosticsBlob.test.ts` | `eb95bac` |
| 2 | — | **Not known to this session.** `ws3-durable-resume` is a real, concurrently-active branch name (per Part 0's context) and is the most plausible Tier 2 candidate (checkpoint/resume across a full app restart, distinct from this round's intra-export rewind), but no doc confirms this mapping. | NOT DETERMINED | — | — |
| 3 | — | Not known to this session. Rung 5 (software failover) is a plausible candidate. | NOT DETERMINED | — | — |
| 4 | — | Not known to this session. `docs/ws3-export/recovery-architecture.md`'s old rung 13 ("process isolation," SPECULATIVE) is a plausible candidate. | NOT DETERMINED | — | — |

---

> **Purpose.** This is the file that prevents context loss across WS3 export-hardening
> rounds. Five registers (Rung, Tier, Bound, Counter, NOT DETERMINED) plus a dated Round
> log. Every status uses the fixed vocabulary: `LANDED` / `PARTIAL` / `PRIMITIVE-ONLY` /
> `NOT-WIRED` / `SIMULATED` / `NOT STARTED`. Cross-reference `docs/ws3-export/durable-state.md`
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
> in `docs/ws3-export/recovery-architecture.md`'s own independent 1-13 numbering
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
| 3 | Bounded re-render — on a MID-run (rotation) flush timeout only: fence the hung session, truncate `runFile` back to the last rotation boundary's exact byte offset (established by a completed `VideoEncoder.flush()`, never scanned), resume the SAME piece's frame loop from that boundary. One attempt per boundary, `MAX_BOUNDARY_REWINDS_PER_EXPORT = 2` total per export | — | LANDED (Round 7), unchanged this round except for the new Rung 5a hand-off once its own budget is exhausted. **WS3 Round 18 CORRECTION: this "LANDED" disposition was incomplete.** The crash audit (F1) found the rewind truncate could run concurrently with a still-in-flight append on the SAME `runFile` — the exact scenario a rotation-flush-timeout rewind creates — with nothing serializing them; salvage's own truncate path had an equivalent drain guard, the rewind path did not. Round 7/10's landing never exercised this: `recoveryMatrix.test.ts`'s nine rows verify DECISION/dispatch correctness (which policy fires, in what order), not concurrent native I/O safety, so a real interleaving defect sat inside a row this ledger had already called closed. Fixed Round 18 (`session_io_gate` on the Rust side + `finishAfterInFlightAppends`/`IN_FLIGHT_APPEND_DRAIN_BOUND_MS` on the JS side — see Round 18 entry), proven by a destructive probe (`truncate_cannot_interleave_with_in_flight_append`, `ffmpeg.rs`) rather than by trusting the fix's own targeted tests. See Round 18's "closed-row recheck" for whether any other row shares this shape. | Decision: `decideBoundedRerenderDisposition`, `exportPipelineWebCodecs.ts:2294`. Wiring: `exportPipelineWebCodecs.ts:2555-2670` (`runGlPiece`, the `while (!driveResult.ok)` loop, the truncate call now at `:2616`) | `a6581d2` (Round 7 landing) + Round 18 SHA for the interleaving fix | `ws3-tier1-close` (Round 7) + `ws3-crash-fixes` (Round 18) |
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
| 2 | — | Recoverable failure: Rungs 2b, 3, 4 wired end to end. | **COMPLETE as of Round 10.** All three are wired: Rung 3 (Round 7), Rung 2b (`7b53676`), Rung 4 (`8d5eb7d`). Verified together, not only apart, by `recoveryMatrix.test.ts`'s nine rows. Nothing in Tier 2 is left open. **WS3 Round 18 CORRECTION: "nothing left open" was wrong for Rung 3** — see that row's own Round 18 correction. `recoveryMatrix.test.ts`'s nine rows are a decision-dispatch matrix (which recovery policy fires for which failure shape); they were never a claim about concurrent native-I/O safety on any recovery path, and treating "verified together" as covering that dimension is exactly the gap. Rung 2b and Rung 4 were rechecked against the same question this round (does their recovery path run any native mutation concurrently with another in-flight one from the live process) and neither has the shape Rung 3 had — Rung 2b's seal runs after the guard's own count, not concurrently with a writer; Rung 4's resume starts in a fresh process, so there is no live in-flight append from the process that crashed for it to race. | see Rung 2b/3/4 rows | `7b53676`, `8d5eb7d` | `ws3-tier2-wire` |
| 3 | — | Enterprise layers: Rung 5 plus size-scaled, I/O-calibrated bounds. **Confirmed this round** (closes Round 7's own speculative "Rung 5 is a plausible candidate" row). 5a/5b landed this round; 5c decided (defer); size-scaled/I/O-calibrated bounds NOT STARTED (no task this round scoped them). | **PARTIAL** | — | this round (5a/5b only) | `ws3-tier3-failover` |
| 4 | — | Hardware-bound: real WebView2 IPC cost (**W11/W12/W13**); HDD/non-SSD bound numbers (**E8**); tier-piece wall-time on a live export (**E4**); the Windows encoder's actual slice structure (**W14**). **Confirmed Round 9** (closes Round 7's own speculative "old rung 13, process isolation" guess — that guess was WRONG; Tier 4 is a hardware-access category, not a single mechanism). All four remain NOT STARTED; from Round 16 they are rows of `docs/ws3-export/windows-validation.md`, the single list of hardware-bound items. | NOT STARTED | `docs/ws3-export/windows-validation.md` | — | — |

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
| `AnnexbFrameCount.pictures` vs `.vclNals` | `pictures` is the picture-accurate (access-unit) counter; `vclNals` is the raw, multi-slice-inflatable counter | Every production truncate/count/compare site uses `.pictures` only (verified by the explore pass that fed this ledger — zero production reads of `.vclNals` for a decision) | `countAnnexbFrames` (JS reference implementation, `exportPipelineWebCodecs.ts` — explicitly noted in `docs/ws3-export/recovery-architecture.md` item 2 as "still counts slices... off the guard path but what spikes/tests diff against") | `countAnnexbFrames` itself, per the note above — flagged as a rename/fix candidate in a prior round, not touched this round | Zero-tolerance exact-match, both directions, at every site that compares a picture count to an expected frame count (final-flush salvage AND this round's rewind-truncate verification both use this posture). |

---

## 5. NOT DETERMINED register

| Item | Owner | What would close it | Needs hardware not available here? |
|---|---|---|---|
| ~~Tier 2/3/4 authoritative definitions~~ — **CLOSED Round 9.** See §2 Tier table: Tier 2 = Rungs 2b/3/4 (PARTIAL — 3 landed, 2b/4 not-wired); Tier 3 = Rung 5 + size-scaled bounds (PARTIAL — 5a/5b landed, 5c deferred, size-scaled bounds not started); Tier 4 = hardware-bound items (NOT STARTED, all four require physical hardware). | closed | closed | closed |
| NOT DETERMINED #1/#2 (append throughput at 3 latencies) — **SIMULATED, not resolved** → `docs/ws3-export/windows-validation.md` **W12** (Round 16) | Next round with Windows hardware access | see W12 | **Yes** |
| Real per-call `open`/`write_all`/`close` cost in `ffmpeg.rs`'s append command on Windows → **W13** (Round 16) | Owner of `ffmpeg.rs` | see W13 | Yes |
| ~~Whether `APPEND_QUEUE_CEILING_BYTES` (256 MB) is sized to any real legitimate peak~~ — **CLOSED Round 9 STEP 6b.** Restated explicitly as a last-resort guard, deliberately NOT derived from the unbatched pathological peak (category error — production is always batched). See Bound register row. Reopen trigger: a real field `queueDepthBytes` reading near 256 MB. | closed | closed | closed |
| ~~The break-even latency at which `APPEND_BACKPRESSURE_THRESHOLD_BYTES` (32 MB) would actually engage~~ — **CLOSED Round 9 STEP 6a.** ≈5,654.5 ms/call (SIMULATED bisection), ≈456x the measured 12.4 ms Windows figure. See Bound register row and `scripts/ws3-measure-append-throughput.test.ts`. | closed | closed | closed |
| ~~Rung 5 (software failover at a rotation boundary)~~ — **CLOSED (5a/5b) Round 9.** See Rung 5 sub-table. 5c remains a DECIDED-DEFER, not a NOT DETERMINED — see §7. | closed | closed | closed |
| Whether `planEncoderSessions`'s "every session start is a keyframe" guarantee still holds under Rung 3's/5a's resumed-run bootstrapping for every real timeline shape — the CHECKPOINT half is answered (`encoderSessionPlan.test.ts` "RESUME KEYFRAME GUARANTEE", Round 14); the live-rewind half → **E3** (Round 16) | Next round, or a live-export verification pass | see E3, or a broader property-based fixture | Not necessarily |
| Whether the Rung 3/5a rewind's simplification in the ORCHESTRATOR (`resumeSessionIndex` bootstrap at exactly one sparse index) generalizes correctly to a THIRD same-rung rewind if `MAX_BOUNDARY_REWINDS_PER_EXPORT` were ever raised above 2 | Whoever changes that constant | Extend `boundedRerenderWiring.test.ts` with a 3-rewind scenario before raising the constant | No |
| ~~Round 9 STEP 2b — the Rung 3/5a rewind's `truncateAnnexbToOffset` is unbounded~~ — **CLOSED Round 10** (`46cfda8`). Wrapped in `TRUNCATE_BOUND_MS` with the same kill chain and typed error as its salvage sibling. Destructive probe: removing the wrap makes `rewindTruncateBound.test.ts` HANG (test timed out in 20 s) rather than fail an assertion — the defect itself, not a proxy. The sweep also found and fixed a second instance (the guard's per-piece diagnostic count). | closed | closed | closed |
| **NEW, Round 9 STEP 5b — no active production "driver is struggling" warning currently exists** to ask whether throttling suppresses it. `encodeQueueSizeAtFlushExpiry` and `'queue-sample'` are diagnostic-only (no orchestrator/UI logic reads either as a live warning). If one is built later off raw `encodeQueueSize` trajectory, it MUST account for the fact that both `BACKPRESSURE_HIGH_WATER` (pre-existing) and this round's throttle now actively suppress that signal by design — build it off `wait-dequeue` time or the throttle's own internal state instead | Whoever builds that warning | Read this note before building it | No |
| ~~Round 9 STEP 3/4 — mixed-rung SPS/PPS continuity is REASONED, not measured~~ — **MECHANISM CLOSED Round 10** (`1e61e84`), **WINDOWS ANSWER STILL OPEN**. Measured on Mac (Chromium 152, avc1.640028, 640x360@30): both rungs emit profile_idc 100 / level_idc 30, but the constraint flags differ ([000000] hw vs [000011] sw) and the entropy coding mode differs (CABAC hw vs CAVLC sw); SPS and PPS payloads differ entirely. The hardware-then-software join is nonetheless accepted by our own picture counter (60/60), by `VideoDecoder` (60 frames, no error), and by the real x86_64 ffmpeg sidecar, which muxes 60 frames AND fully decodes all 60 with zero warnings. So the pipeline tolerates a mid-stream parameter-set change, including the more dangerous entropy-mode change. **What is NOT answered:** Windows (Media Foundation vs a different software encoder) — Tier 4, needs the hardware; and WKWebView, where the app actually encodes — this ran in Chromium, so it compares VideoToolbox to OpenH264 through a different host. | Next round with Windows hardware; a WKWebView run needs only `npm run tauri:dev` | → **W4** (Windows) / **M1** (WKWebView), Round 16 | Yes for the Windows half; no for the WKWebView half |

| ~~Round 10 — `ffmpeg.kill()` inside `withFfmpegLivenessBound`'s expiry handler is itself an unbounded `await`~~ — **CLOSED Round 13** (`f9af872`, Cursor): measured worst 5 ms, `KILL_BOUND_MS` = 125 (25×), expiry raises `FfmpegKillHungError` naming that the sidecar may still be running. The Windows kill-latency half → **W6** (Round 16). | closed | closed | closed |
| Round 10 — a rotation whose following bytes open directly on a coded slice yields NO checkpoint. Made VISIBLE Round 14 (`rotationsSeen` + `never_checkpointed`, `fa0a61c`); the live decline rate → **E2** (Round 16) | Next round | see E2 | No |
| ~~Round 10 — pre-Round-10 abandoned session directories with no `export_state.json` are uncollectable from the renderer~~ — **CLOSED Round 13/14** (`d73747a` manifest-less orphan sweep, `ee406dd` consumer wiring at every export start). Windows `pending_delete` accuracy → **W1**. | closed | closed | closed |
| Round 10 — the resume path has never been exercised against a real crash → **E1** (Round 16). Every proof is a fixture (byte-real fake ffmpeg, call-order recording). | Next round | see E1 | Live app on either platform |

---

## 6. Round log

### Round 7 [CC lineage] (2026-09-10 / 2026-09-11) — Tier 1 closeout + Rung 3 re-render

> Round-number collision, disambiguated Round 16: `docs/ws3-export/durable-state.md` carries a
> DIFFERENT "Round 7" (Cursor lineage, `ws3-durable-resume`, 2026-09-10 — Rung 2b sealing + Rung 4
> resume primitives). Every "Round 7" reference in THIS file means this entry; see the Round 16
> round-number map for the full cross-lineage numbering.

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
- **`VideoEncoder`/`prefer-software` in WebView2:** NOT independently confirmed this round (no live/Windows run permitted). `docs/ws3-export/recovery-architecture.md` §4a already reasoned it is a valid WebCodecs value in every Chromium-family engine with OpenH264 shipped for software encode, and flagged the actual WebView2 exposure as NOT DETERMINED absent a live run — that status is unchanged. What WOULD confirm it: a `VideoEncoder.isConfigSupported({..., hardwareAcceleration: 'prefer-software'})` probe logged from a real `tauri:dev` session on Windows.
- **Failover trigger and ordering: REWIND FIRST, failover only once the rewind budget is exhausted — argued, not assumed.** A rotation flush timeout already has a tested, landed same-rung recovery (Rung 3). Failing over to software on the FIRST such timeout would discard a fast hardware path over what might be one transient stall — exactly the "salvage becomes routine" failure mode `MAX_BOUNDARY_REWINDS_PER_EXPORT`'s own doc comment already warns against, just one rung earlier. So: `decideBoundedRerenderDisposition` is consulted first (unchanged); only when IT returns abort does `decideHardwareFailoverDisposition` get a turn, and it is one-shot (`hardwareFailoverUsed` boolean, never a counter).
- **Worst-case total attempt count, PROVEN bounded:** 1 initial attempt + `MAX_BOUNDARY_REWINDS_PER_EXPORT` (2) same-rung rewinds + 1 one-shot software failover retry = **4 total `driveGlRun` attempts, 3 total `truncateAnnexbToOffset` calls, per export** — regardless of how many GL pieces or rotation boundaries the export contains, because both gating resources (`boundaryRewindsUsed`, `hardwareFailoverUsed`) are export-scoped, not per-piece/per-boundary. Proven by `hardwareFailoverWiring.test.ts`'s "total worst-case attempt bound" test (destructively RED/GREEN probed: `decideHardwareFailoverDisposition` forced to always abort → 4 tests across 3 files went RED, confirming they actually catch the regression; restored → GREEN).
- **fps penalty estimate: SPECULATIVE, carried from `docs/ws3-export/recovery-architecture.md` §4c, not independently measured** — "tens of seconds to a couple of minutes for 1800 frames" for a 60 s 1080p30 software session vs. hardware's seconds; no separate 1080p60 estimate exists in that doc or was computable this round without a live run. Flagged NOT DETERMINED / hardware-bound.
- **Mixed-rung concat verdict: REASONED CLEAN, not measured.** Annexb emits SPS/PPS inline ahead of every IDR, so a decoder re-reads parameter sets at a rung-change seam and the mux (`-r <fps>` on a PTS-less raw stream) is unaffected — per `docs/ws3-export/recovery-architecture.md` §4c, adopted here. **Real risk, MEDIUM, unresolved:** `isConfigSupported` passing does not guarantee which profile/level a given rung actually emits (this codebase's own `createEncoder` comment already says so), so a software rung could legally emit a different profile than hardware mid-file — decodable and guard-passing, but a quality/compatibility discontinuity nothing in the pipeline would notice. Not measured this round (no live encoder available); recorded as a NOT DETERMINED row (§5).
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
`docs/ws3-export/durable-state.md` as the pre-`afa8818` CUT-POINT count in an arithmetic line
("actual cut 283 + 5 = 288 / 0 / 5"), i.e. an input to a sum, never a suite total. The authoritative
pair is **293 / 0 / 5** and **379 / 0 / 35**.

**What broke.** Nothing in the merge. Two things broke during the wiring, both found by tests and
both fixed:
1. Five `vi.mock('./muxOnly', () => ({ muxOnly }))` factories were TOTAL module mocks. Once the
   orchestrator reached the sealing exports in that module, the mock deleted them and a typed guard
   failure became a generic one. Made partial with `importOriginal`.
2. Resuming at the fence-verified offset duplicated the next access unit's parameter sets, as above.

**`docs/ws3-export/durable-state.md` corrections for Cursor** (collected, not made — that file is
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
4. `docs/ws3-export/durable-state.md:675` records "actual cut 283 + 5 = 288 / 0 / 5". That 283 has
   since been quoted downstream as a suite total. Worth marking as an addend.

**Tier 2: CLOSED.** Rungs 2b, 3 and 4 are all wired, and verified together rather than only apart.

### Round 14 (2026-09-11) — Findings-register close-out: C5/C6/C7 + H5/H10 consumer wiring + H9

**Branch:** `ws3-hardening-windows`, a fresh session (no memory of prior rounds), picking up from
STEPs 0-6 already committed on this branch. **Base:** the branch's own STEP 6 head, `9ea600a`.
Scope was `docs/ws3-export/pipeline-audit.md`'s Findings register (Part 7) items C5, C6, C7, H5,
H9, H10 — STEPs 7-10 of a 4-STEP assignment (STEPs 11+ deliberately not started, per the
operator's instruction to stop here for review).

**Files touched:**
- `src/services/webcodecsExport/exportPipelineWebCodecs.ts` (modified — STEP 7 discard accounting,
  STEP 9 five recovery-budget writes + in-process budget seeding, STEP 9 rotation-coverage counter)
- `src/services/exportPipeline.ts` (modified — `ExportAppendLedger.discardedAtFinish`,
  `ExportErrorKind.destination_path`)
- `src/services/webcodecsExport/appendBatching.test.ts` (modified — 4 new C5 probes)
- `src/services/exportDiagnosticsBlob.test.ts` (modified — sentinel for the new field)
- `src/services/webcodecsExport/exportCleanupNotices.ts` (new — C6 durable ledger)
- `src/services/webcodecsExport/exportCleanupNotices.test.ts` (new)
- `src/services/tauriFfmpeg.ts` (modified — `destroy()` records via `exportCleanupNotices`;
  `SessionClaimView.holderLiveness` narrowed to a literal union)
- `src/services/webcodecsExport/muxOnly.ts` / `.test.ts` (modified — premux-delete failure recorded)
- `src/services/webcodecsExport/exportResumeDiscovery.ts` / `.test.ts` (modified — H5 claim-aware
  reentry: `SessionClaimLivenessView`, `liveClaimBlocked`, `staleClaimRecovered`; C7
  `never_checkpointed` propagation)
- `src/services/webcodecsExport/exportResumeSession.ts` / `.test.ts` (modified — `tauriIo` supplies
  `readSessionClaim`; `ResumeRefusalNotice.kind` gains `live_claim_blocked`/`never_checkpointed`)
- `src/hooks/useExport.ts` (modified — orphan sweep + cleanup notices at export start;
  destination-path check before `runExport`)
- `src/services/webcodecsExport/exportCheckpoint.ts` (modified — `rotationsSeen`,
  `recordBoundaryRewind`/`recordHardwareFailover`/`recordResumeAttempt`/`recordRotationSeen`,
  `never_checkpointed` validation kind)
- `src/services/webcodecsExport/exportCheckpoint.test.ts` (modified — 10 new tests)
- `src/services/webcodecsExport/exportCheckpointWriter.ts` (modified — four `note*` methods)
- `src/services/webcodecsExport/exportCheckpointWriter.test.ts` (new, 6 tests)
- `src/services/webcodecsExport/exportCheckpointPlacement.test.ts` (modified — production-granularity
  coverage test)
- `src/services/webcodecsExport/hardwareFailoverWiring.test.ts` (modified — resumed-run budget-seeding probe)
- `src/services/webcodecsExport/encoderSessionPlan.test.ts` (modified — resume keyframe-guarantee test)
- `src-tauri/src/session_claim.rs` (modified — `classify_remove_outcome` extracted + 4 tests)
- `src-tauri/src/ffmpeg.rs` (modified — `windows_long_path`/`apply_windows_long_path_prefix`,
  `WINDOWS_MAX_PATH`, `save_session_file` now prefixes both copy sides; 6 new tests)
- `src/App.tsx` (modified — `getExportErrorSummary` handles `'destination_path'`)
- `src/services/exportDestinationPath.ts` / `.test.ts` (new — H9 TS-side pre-encode check)

**What landed:**
1. **C5 (STEP 7, `2bb06fa`).** `ExportAppendLedger.discardedAtFinish` — the exact
   pendingBatch-plus-unlanded-queue population, read at the moment `finish()` settles, before it is
   discarded — is now named in every abnormal-finish message and in the ledger the operator's
   Copy-diagnostics blob reads. Decided flush-then-fail for `cancel` only (the worker's own terminal
   message — nothing more will ever be posted, so draining is safe, reusing the existing
   `APPEND_DRAIN_BOUND_MS` machinery); account-and-report for watchdog/queue-overflow/worker-crash
   (a writer that may genuinely be stuck must not be waited on further).
2. **C6 (STEP 8, `ee406dd`).** `exportCleanupNotices.ts`, a small localStorage-backed bounded ledger,
   fed by `TauriFfmpeg.destroy()` and `muxOnly.ts`'s premux-intermediate delete failure paths — both
   previously invisible to the operator (console.warn-only, and completely silent, respectively).
3. **H5 + H10 consumer wiring (STEP 8, `ee406dd`).** Cursor's Round 13 native commands
   (`ffmpeg_read_session_claim`, `ffmpeg_sweep_orphan_sessions`) had thin `TauriFfmpeg` wrappers but
   were called from nowhere in the frontend — confirmed by grep before starting. `evaluateResumeCandidate`
   now reads the claim before `reenter` (live blocks with its own message, stale recovers with a
   different one); `useExport.ts` calls the sweep once per export start, `pendingDelete` kept separate
   from `bytesReclaimed`.
4. **C7 (STEP 9, `fa0a61c`).** The five specified durable-manifest writes, plus a REAL bug found and
   fixed: the in-process `boundaryRewindsUsed`/`hardwareFailoverUsed` locals were unconditionally
   0/false on every process start, including a resumed one, silently granting a resumed run a fresh
   `MAX_BOUNDARY_REWINDS_PER_EXPORT` budget on top of whatever a crashed process already spent — now
   seeded from `resume.manifest`. Also: `rotationsSeen` + a new `never_checkpointed` validation kind,
   making "this export rotated but never durably checkpointed" a distinguishable state rather than
   silent nothing-to-resume; and a production-batch-granularity coverage test confirming
   `fenceSafeCheckpointOffset` coverage is total for realistic encoder-shaped content (not
   content-dependent — follows from every access unit carrying a leading AUD).
5. **H9 (STEP 10, `e9355a2`).** `windows_long_path` prefixes both sides of `save_session_file`'s
   copy with `\\?\` on Windows; `exportDestinationPath.ts` rejects an over-length Windows destination
   before rendering starts. The prefixing RULE (pure string logic, deliberately not
   `#[cfg(windows)]`-gated) is unit-tested on this macOS dev environment; whether the real Win32
   `CreateFile` family honors it for every code path `fs::copy` takes internally is UNCONFIRMED here.

**What did not land:** STEPs 11+ (out of this round's assigned scope — the operator's instruction
was to stop after STEP 10 for review). No live export was run (no real ffmpeg/whisper sidecar) —
this round is verified by tests and code inspection only, matching the assignment's stated
constraint.

**Gate arithmetic:** see this round's own final report for the full `npx tsc --noEmit` /
`npm run lint` / `npm test` ×2 / `cargo test` / `cargo test --features fa-inference` numbers and
every commit SHA — recorded once there, not duplicated here.

**What broke (and was caught before shipping):** two bugs, both found by this round's own tests
before commit:
1. The resumed-run in-process rewind/failover budget bug described under C7 above — caught by a
   dedicated `hardwareFailoverWiring.test.ts` probe (a resumed run whose manifest already shows the
   rewind budget at MAX must go straight to the ONE remaining failover attempt on its first hang,
   never a fresh rewind), which failed until the seeding fix landed.
2. STEP 7's `errorFromDiagnostics`/`snapshotLiveness` initially left `discardedAtFinish` `null` on
   the operator-facing `ExportError.liveness.appendLedger` (only the internal, unread-by-operators
   `RunDriveResult.appendLedger` had it) — caught by the cancel-path destructive probe reading the
   wrong field, fixed by making `snapshotLiveness`'s embedded ledger always the at-finish one (both
   its call sites are terminal-only, never a mid-run progress snapshot).

### Round 15 (2026-09-11) — PROMPT 19 close-out: STEPs 11-13, findings-register disposition

**Branch:** `ws3-hardening-windows`, fresh session, continuing directly from Round 14's own head
(`9c80e71`). SHA chain covered: `9c80e71` (Round 14 docs) → `e9355a2` (S10, H9) → `fa0a61c` (S9,
C7) → `ee406dd` (S8, C6/H5/H10) → `2bb06fa` (S7, C5) → `9ea600a` (S6, H3) → `75e331c` (S5, H2) →
`9ea600a`'s sibling `2514423` (merge of `ws3-durable-resume` Round 13 into this branch) →
`0d397f7` (S2, H1) → `4a3e584` (S1) → `d6eff3b` (S0). Round numbering note: Round 9 already
collided between `ws3-tier3-failover` and this branch's own numbering before this round started;
that collision is NOT renumbered here, and the tier3 Rung 5c DEFER block above is a later
reconciliation, untouched by this round.

**Merge disposition (`2514423`).** No textual conflicts; the two branches touched disjoint
regions — `ws3-durable-resume`'s Rust primitives and `exportCheckpoint.ts`'s pure schema/handshake
functions vs. this branch's own `exportPipelineWebCodecs.ts` orchestration and Rung 3/5a rewind
code. Confirmed by the merge commit's own diff carrying no `<<<<<<<` markers and no file appearing
on both sides' independent change lists.

**Corrected STEP 2 arithmetic.** The task text's assumed baseline (`3514 passed / 77 skipped / 0
failed = 3591`) does not match this tree. Measured, twice, identically: **3564 passed / 0 failed /
77 skipped = 3641** at this round's start (before this round's own STEP 10b probe addition), which
is `9c80e71`'s true total. See "Gate arithmetic" below for the full reconciliation — this round
adds exactly one more test (`exportCheckpointWriter.test.ts`'s persist-ordering probe, STEP 10b
item 3), bringing the final total to 3565/0/77 = 3642.

**STEP 4 disposition (inherited, not re-run this round).** Per Round 14's own report (unchanged
this round — STEP 4 was a Round 14, not Round 15, deliverable): four failures surfaced during that
round's wiring work, all fixed before commit — see Round 14's "What broke" entries above. This
round did not re-run STEP 4; it is cited here only because PROMPT 19 asks the Round 15 entry to
carry it forward.

**STEP 5 codec ladder / STEP 6 accounting / STEP 7 discard accounting.** Unchanged this round —
see Round 14's own dispositions above (`75e331c`, `9ea600a`, `2bb06fa`). Carried forward by
reference, not re-verified, except where STEP 10b below found a residual.

#### STEP 10b — five carry-overs

1. **Push.** `ws3-hardening-windows` pushed to `origin` at the start of this round
   (`be332ee..9c80e71`), before any of this round's own work — confirmed via `git push` output.
   A second push closes this round (see "Push" at the end of this entry).

2. **Budget seeding completeness.** `boundaryRewindsUsed` and `hardwareFailoverUsed` are seeded
   explicitly as named locals in `exportPipelineWebCodecs.ts:2885,2888` from `resume?.manifest`.
   `checkpointResumeAttempts` and `totalRecoveryAttempts` are **not** separately re-seeded as
   locals — they do not need to be, because `adoptManifest` (`exportCheckpointWriter.ts:196-209`)
   assigns the **entire** resumed manifest object (`manifest = existing`), all four
   `ExportRecoveryBudget` fields intact, to the writer's own state; every subsequent `record()` /
   `noteBoundaryRewind()` / `noteHardwareFailover()` / `noteResumeAttempt()` call increments off
   that adopted object, not a fresh one. There is no separate "truncate counter" field in
   `ExportStateManifest` (`exportCheckpoint.ts:169-178` has exactly four budget fields) — truncate
   count is not tracked independently because it is 1:1 with the two counters that already are:
   every `boundaryRewindsUsed` increment and every `hardwareFailoverUsed` transition corresponds to
   exactly one `truncateAnnexbToOffset` call, so there is nothing to seed that boundaryRewindsUsed/
   hardwareFailoverUsed do not already cover.

   **The counter that is NOT fully seeded, found this round:** the manifest is **piece-scoped**, not
   export-scoped, on disk. `beginPiece` → `startManifest` (`exportCheckpointWriter.ts:157-166`)
   constructs a **brand-new** manifest via `createExportStateManifest` with no budget argument —
   all four counters reset to 0 — for every piece that is NOT the one being resumed (`beginPiece` is
   called for every piece after the resumed one, and for every piece in a run that never crashed).
   But `MAX_BOUNDARY_REWINDS_PER_EXPORT` and `MAX_TOTAL_RECOVERY_ATTEMPTS_PER_EXPORT` are documented,
   in `exportPipelineWebCodecs.ts`'s own comment at the `boundaryRewindsUsed` declaration, as
   **per-EXPORT, every GL piece combined**. Concretely: if piece 0 spends 1 rewind and finishes, then
   the process crashes mid-piece-1 (which has spent 0 rewinds of its own), `resume.manifest` is
   piece 1's manifest — `boundaryRewindsUsed: 0` — so the resumed process's in-process local seeds to
   0, not 1, silently restoring a rewind piece 0 already spent. This is narrower than the STEP 9 bug
   (which reset the ENTIRE budget to 0 on every resume, any piece, any history) — it only leaks
   budget spent in a piece **before** the one being resumed, and only across a crash (a single
   unbroken process run never loses it, since the in-process locals are never piece-scoped). Reported
   as found, not fixed this round — out of PROMPT 19's scope (STEP 10b asks to "report any counter
   that is not" seeded; this is that counter, not a directive to re-architect the manifest's
   piece-scoping this round). Affects only multi-GL-piece exports (a single-piece export, the common
   case for most projects, cannot exhibit it) that crash after piece 0+ has already spent a rewind.

3. **Budget persist ordering.** Traced precisely for both write sites:
   - Rewind (`noteBoundaryRewind`, `exportPipelineWebCodecs.ts:3177`): called **after** the rewind
     truncate (`:3110-3138`) completes and its exact-match check (`:3146-3165`) passes, but
     **before** the re-render attempt (`runGlPiece`, `:3186`) — the operation that could hang again
     — begins.
   - Failover (`noteHardwareFailover`, `:3079`): called **before** the failover's own re-render
     attempt begins (same ordering intent, stated explicitly in the code's own comment: "write #3:
     persist the failover flag AND bump totalRecoveryAttempts before the failover attempt itself
     runs").

   So the charge is issued before the risky attempt in both cases — **in-process**, synchronously:
   `checkpointWriter`'s internal `manifest` variable is mutated the instant `noteBoundaryRewind()`/
   `noteHardwareFailover()` returns, with zero dependency on I/O (`exportCheckpointWriter.ts`'s own
   header comment: "Nothing ever awaits it. `record()` is synchronous and returns immediately").
   The DURABLE write (`ffmpeg_write_export_state`'s `sync_all`) is deliberately never awaited — by
   the writer's own explicit design, so a wedged volume cannot stall the export (Rung 0: "a recovery
   path may not hang", cited verbatim in the rewind-truncate's own comment at `:3097`). So there is a
   real window — between the in-memory charge and the fsync landing — where a genuine OS-level crash
   loses the durable copy of that one charge.

   **Probe added:** `exportCheckpointWriter.test.ts`'s new "PERSIST-ORDERING PROBE" — a
   `writeExportState` that never resolves (simulating a crash before its fsync completes) — confirms
   the in-memory manifest (`snapshot()`) already reflects the charge in the SAME synchronous turn as
   the `note*` call, with zero dependency on the write settling, and that a SECOND charge issued
   while the first write is still stalled also lands in-memory immediately (so a wedged fsync cannot
   itself let one process over-spend its own in-process budget — the in-process gate reads the
   synchronous local, never the manifest, never disk). 7/7 green (was 6/6 before this addition).

   **Verdict: acceptable, not a bug to fix.** Making the durable write synchronous (awaited before
   the re-render attempt) would reintroduce exactly the hang Rung 0 forbids and the rewind-truncate
   fix (Round 10, Blocker 1) exists to prevent — an fsync on a wedged volume can block indefinitely,
   and awaiting it would turn "one lost checkpoint" into "the export itself now hangs on I/O it was
   specifically built not to depend on." The residual risk is real but bounded: it requires an actual
   process crash landing in a narrow window (between a synchronous local mutation and one fsync
   round-trip, typically single-digit milliseconds), the worst case is under-counting one recovery
   attempt (not an unbounded reset — item 2's cross-piece gap is structurally the same shape but
   would leak more), and the absolute per-piece ceiling (`MAX_TOTAL_RECOVERY_ATTEMPTS_PER_EXPORT`)
   still applies to whatever the next process's own attempts add on top, so this is not the same
   "silently grants a full fresh budget" severity STEP 9 fixed — it is a strictly smaller residual of
   the identical shape, correctly attributable to fsync durability, not to the recording logic.

4. **Pre-encode path-length validation: EXISTS**, confirmed at `src/hooks/useExport.ts:717-747`
   (`checkExportDestinationPathLength`, called immediately after `pick_save_path` returns and
   explicitly before Step 3's render call — the function's own doc comment states the intent: "reject
   an impossible destination... at second zero, rather than after a 30+ minute encode"). This closes
   the durable-state doc's own STEP 6 "NOT DETERMINED (CC/UI scope)" note — it has since landed
   (Round 14, `e9355a2`); `docs/ws3-export/durable-state.md` is updated below to match.

   **Forward slashes:** `apply_windows_long_path_prefix` (`ffmpeg.rs:1622-1639`) only inspects
   whether byte index 1 is `:` to detect a drive-letter path — it does not require or convert to
   backslashes. A path like `C:/Users/alice/out.mp4` (which `looksLikeWindowsPath`,
   `exportDestinationPath.ts:41-43`, accepts via its own `[\\\/]` alternation) would be prefixed as
   `\\?\C:/Users/alice/out.mp4`. Per Microsoft's own documentation, `\\?\` **disables** the usual
   path parsing and requires backslash separators — a forward-slash path under that prefix is not
   guaranteed to resolve the way an unprefixed one would. **Known gap, not fixed this round:** no
   code path normalizes `/` to `\` before prefixing.
   **Relative components (`.`/`..`):** the function's own comment states a relative path (no drive
   letter) is left unprefixed, "defensive, not expected" — but it does **not** detect or reject `..`/
   `.` segments inside an otherwise-absolute path (e.g. `C:\Users\alice\..\Videos\out.mp4`). Since
   `\\?\` disables canonicalization, Win32 would **not** resolve those segments — the literal string
   after the prefix is looked up verbatim. **Known gap, not fixed this round.** Neither gap is
   reachable through this app's own UI today (`pick_save_path` returns whatever the native Windows
   save dialog produces, which does not normally emit forward slashes or `..` segments) — both are
   recorded as latent, not live, defects.
   **UNC (`\\?\UNC\`):** confirmed correct — `apply_windows_long_path_prefix` strips the leading
   `\\` and reprefixes as `\\?\UNC\server\share\...`, exercised by
   `windows_prefix_applies_to_a_unc_path` (`ffmpeg.rs` test suite, passing).

5. **Keyframe guarantee: already answered by STEP 9**, not a gap. Cited precisely:
   `encoderSessionPlan.test.ts:166`, "RESUME KEYFRAME GUARANTEE" — a checkpoint's recorded frame
   index is always one of `planEncoderSessions`' own `sessionStarts` (found, keyframe-safe by
   construction, since the planner only ever cuts backward to an already-keyframe boundary — never
   forward, never off-grid); a foreign/corrupted checkpoint value is rejected the identical way
   `exportWorker.ts` itself rejects an off-grid resume frame. Passing as part of this round's `npm
   test` run.

#### STEP 11 — Quantifying the 512 KiB batch cap

Figures on record (this round's own gate run + STEP 2's commit message, `0d397f7`): ~460.4 s
export; a ~33 KB/chunk 1080p30 profile; ~40,000 chunks unbatched; STEP 2's own commit message
states the append-call reduction for that profile drops from **~100×** (at the old 4 MiB cap) to
**~15.5×** (at the new 512 KiB cap) once the byte trigger, not the 100-chunk count trigger,
dominates at the smaller size.

**Append-call counts, this profile:** old (4 MiB, no verify): 40,000/100 ≈ **400** append calls, 0
verify calls, 400 total IPC round trips. New (512 KiB, every append verified): 40,000/15.5 ≈
**2,581** append calls **+ 2,581** verify calls (STEP 2, `0d397f7`, added an immediate
`sessionFileSize` read after every `appendFileRaw`) = **5,162** total round trips.

**IPC call-count multiplier, 512 KiB vs. 4 MiB:** append calls alone, 2,581/400 ≈ **6.45×**; total
round trips (append + verify), 5,162/400 ≈ **12.9×**.

**Added wall-clock from the verify calls alone** (2,581 extra round trips, isolating just the new
per-append verify — not the batch-count increase itself, which was already implicit in the pre-STEP-2
call count):

| Latency | Added wall-clock | % of 460.4 s |
|---|---|---|
| 0.5 ms (Mac) | 2,581 × 0.5 ms ≈ **1.29 s** | **0.28%** |
| 12.4 ms (Windows, measured) | 2,581 × 12.4 ms ≈ **32.0 s** | **6.96%** |
| 25 ms (pathological) | 2,581 × 25 ms ≈ **64.5 s** | **14.0%** |

**Resulting terminal-drain margin.** The 12.4 ms terminal-drain figure on record is for the single
FINAL pending batch drained at finish, not the whole run's append stream — that step now issues one
additional verify round trip, not thousands. Worst case (pathological 25 ms latency): terminal
drain becomes ≈ 12.4 ms (append) + 25 ms (verify) ≈ **37.4 ms**, against the 30,000 ms `WATCHDOG_MS`
bound — margin drops from ~29,988 ms to **~29,963 ms**. The bulk of the added wall-clock (32.0 s on
Windows, 64.5 s pathological) lands across the WHOLE export's many mid-run appends, not at the
terminal drain step, so it competes with `APPEND_DRAIN_BOUND_MS` (600,000 ms) and total export wall
time, not with `WATCHDOG_MS`'s per-idle-interval bound — and at 32.0 s / 460.4 s it is nowhere close
to either.

**The 32 MiB back-pressure gate's relationship to batch size CHANGED, stated plainly.**
`APPEND_BACKPRESSURE_THRESHOLD_BYTES = 32 * 1024 * 1024` (`appendBackpressureGate.ts:52`) is an
absolute byte threshold, untouched by this round. At the old 4 MiB batch size, 32 MiB of unacked
data meant at most **8** batches (8 round trips) could be outstanding before back-pressure parked
the frame loop. At the new 512 KiB batch size, the SAME 32 MiB threshold now permits **64** batches
(64 round trips) outstanding before parking — an 8× increase in the number of concurrently
in-flight IPC calls the gate tolerates, even though the byte ceiling itself is unchanged. This is a
real behavioral change: back-pressure now engages later in call-count terms (though at the identical
byte volume), meaning more outstanding round-trip promises can accumulate in the append queue before
throttling kicks in.

**Verdict: the cap is justified.** H1's WebView2 ~2 MB IStream truncation risk is the one hypothesis
in the register that plausibly explains BOTH production Windows hangs without inventing a new
mechanism, and 512 KiB carries a 4× margin below the documented ~2 MB ceiling — plus the verify call
is an INDEPENDENT second mitigation (a short write is caught and typed at the batch that lost bytes,
not discovered minutes later at the concat/frame-count guard) that holds even if the size guess is
wrong. The wall-clock cost is real (6.96% of total export time at measured Windows latency, 14% in
the pathological case) but does not threaten any bound in the register — `APPEND_DRAIN_BOUND_MS`
has ~9.4 minutes of headroom against a worst-case few-tens-of-seconds addition, and the terminal
drain's own margin against `WATCHDOG_MS` barely moves. `APPEND_BATCH_BYTES` stays frozen at 512 KiB.

**What would license raising it, precisely.** The test: on a real Windows machine, through the
actual Tauri/WebView2 IPC raw-body path (not a Mac dev environment, not a mock), append a known byte
pattern at a stepped series of sizes from 512 KiB upward (e.g. 512 KiB, 1 MiB, 1.5 MiB, 2 MiB, 3 MiB,
4 MiB) and compare landed `sessionFileSize` + a SHA-256 of the written file against the submitted
bytes at each step — the exact probe `docs/ws3-export/pipeline-audit.md` Part 4.5 already specifies
for H1. The threshold: the largest size in that sweep that lands byte-identical, with the SAME 4×
safety-margin convention this round's own fix already used (raise only to ¼ of the empirically
confirmed safe ceiling, never to the ceiling itself). Who runs it: someone with hands-on access to a
real Windows machine running the built app — this is explicitly not producible from this Mac dev
environment, and not something CI can stand in for; until that number is measured, 512 KiB is not a
default awaiting confirmation, it is the frozen value.

#### STEP 12 — Dispositions

| ID | Statement (short) | Status | Fixing SHA(s) / probe |
|---|---|---|---|
| C1 | Resume fence didn't gate write/exec/truncate/read | **closed** | `79e3eed` (Round 11); `ensure_resume_bitstream_fence` gates write/raw-write/read/exec/both truncates/delete |
| C2 | `{kind:'clean'}` masked a post-mutation native failure | **closed** | `693e533` (Round 11); `{kind:'bitstream_touched'}` distinguishes it |
| C3 | Timeline hash omitted overlay/effect/asset-byte identity | **closed** | `693e533` (Round 11); `ExportTimelineIdentity` v2 |
| C4 | Rewind `truncateAnnexbToOffset` had no TS liveness bound | **closed** | Round 10, Blocker 1 (pre-`9c80e71`, inherited on this branch); `exportPipelineWebCodecs.ts:3110-3120` wraps it in `withFfmpegLivenessBound` / `TRUNCATE_BOUND_MS`, same kill chain as salvage truncate |
| C5 | Pending append batch silently discarded on abnormal finish | **closed** | `2bb06fa` (STEP 7); `ExportAppendLedger.discardedAtFinish` named in every abnormal-finish message; probed by `appendBatching.test.ts` |
| C6 | `destroy`/premux cleanup failures invisible to operator | **closed** | `ee406dd` (STEP 8); `exportCleanupNotices.ts` durable ledger, read at next export start |
| C7 | Manifest schema couldn't bound recovery across restarts | **mitigated** | `fa0a61c` (STEP 9) fixed the unconditional-0/false full-reset bug (closes the SEVERE case). **Residual, found this round (STEP 10b item 2):** piece-scoped manifest reset means budget spent in an EARLIER, already-finished piece is invisible to a LATER piece's resumed manifest — a narrower, still-real cross-piece leak. Not fixed this round; out of PROMPT 19 scope per STEP 10b's own framing ("report any counter that is not") |
| C8 | Concat deleted output on any error, including disk-full | **closed** | `79e3eed` (Round 11); preserves partial output on disk-full only |
| C9 | Slice-counting reachable on a production guard | **closed** (was already clean) | Rung 1, pre-existing; `.vclNals` confirmed diagnostic-only, `annexbFrameCount.test.ts` passing |
| C10 | In-process second-rewind session-index bug | **closed** (was already clean on this head) | `resumeSessionIndex` fix pre-dates this branch (Round 7/9); `boundedRerenderWiring.test.ts` passing |
| H1 | 4 MiB batch vs. WebView2 ~2 MB IStream truncation | **mitigated** | `0d397f7` (STEP 2): 512 KiB (4× margin) + independent per-append verify/short-write detector. Real-hardware confirmation of the ~2 MB ceiling itself remains **open** — see STEP 11 |
| H2 | `prefer-software` + `avc1.640028` may be unconfigurable on Windows/OpenH264 | **mitigated** | `75e331c` (STEP 5): profile-ladder descent pinned per piece via `selectedCodec`, closing the MIXED-PROFILE-MID-PIECE structural risk. The underlying `isConfigSupported` behavior on real Windows/WebView2 remains **open** |
| H3 | `VideoEncoder.close()` async release may leak HW sessions | **mitigated** | `9ea600a` (STEP 6): explicit encoder-session accounting (open/close counts on the diagnostics blob), closing before every terminal post — makes a leak OBSERVABLE. The underlying Chromium/driver release timing on real hardware remains **open** |
| H4 | Defender scan-on-close may explain the 12.4 ms/append gap | **open** | No code fix possible from this repo — requires a real Windows machine + Defender exclusion A/B (`docs/ws3-export/pipeline-audit.md` Part 4.3) |
| H5 | Two app instances could `reenter` the same session (no lock) | **mitigated** | `d73747a` (Round 13, native claim primitive) + `ee406dd` (STEP 8, consumer wiring: `evaluateResumeCandidate` reads the claim before `reenter`, distinguishing live/stale). Logic is unit-tested (`exportResumeDiscovery.test.ts`, `exportResumeSession.test.ts`); a real two-process concurrent race on Windows NTFS has not been run live — **open** as hardware confirmation |
| H6 | TDR during a long GL export presents as unrecoverable context loss | **open**, by deliberate decision | Rung 5c **DEFER** (Round 9), reopen trigger stated explicitly in that entry above — not a gap awaiting a fix, a decision awaiting a specific reopening observation |
| H7 | Lid close / Modern Standby may kill MF drain despite heartbeat | **open** | Untested; needs a real Windows machine, lid-close mid-session |
| H8 | Checkpoint fsync without Annex-B `sync_all` could lose durability | **closed** | `79e3eed` (Round 11); `sync_all` on append/truncate/prepare |
| H9 | Long destination paths fail `save_session_file` post-encode | **mitigated** | `e9355a2` (STEP 10): `windows_long_path` prefixes both copy sides; `exportDestinationPath.ts` pre-encode check confirmed wired (STEP 10b item 4). **Residual, found this round:** forward-slash and relative-component (`..`/`.`) Windows paths are not normalized before `\\?\` prefixing — latent, not reachable through this app's own save dialog today. Real `CreateFile`-family compliance with `\\?\` across every `fs::copy` code path remains **open** |
| H10 | Orphaned session dirs accumulate, ~1.6-2.3 GB each | **mitigated** | `d73747a` (Round 13, native sweep) + `ee406dd` (STEP 8, consumer wiring: `useExport.ts` sweeps once per export start, `pendingDelete` kept separate from `bytesReclaimed` — confirmed this round via `useExport.ts:221-223`, `exportResumeDiscovery.ts:117,268,286`). Real Windows `pending_delete` accounting accuracy under a live delete-pending race remains **open** |

No blanks; nothing hardware-bound is marked `closed` — every hardware-dependent item above reads
`mitigated` (code-side fix verified, hardware unconfirmed) or `open` (no code-side fix possible from
this environment at all).

#### STEP 13 — Gates (raw output in this round's own final report, not duplicated here)

`npx tsc --noEmit` clean; `npm run lint` clean (this repo's `lint` script is `tsc --noEmit` itself,
per `CLAUDE.md`'s own Commands section — the two gates are the same command). `npm test` ×2,
identical both times: **3,564 pass / 0 fail / 77 skip → 3,565 pass / 0 fail / 77 skip after this
round's own +1 probe test** (see "Corrected STEP 2 arithmetic" above for the reconciliation from
`9c80e71`'s true baseline, 3,564/0/77, not the task text's assumed 3,591). `cargo test`: **308 / 0 /
5**, matching the expected figure exactly. `cargo test --features fa-inference`: parallel **394 / 0
/ 35**, run three times, zero failures observed in any of the three (the historically-flaky
`whisper::in_flight_tests` race did not reproduce on this machine this session — reported as
observed, not asserted as fixed, since a race that does not reproduce in three runs is not proven
absent); single-threaded **394 / 0 / 35**, matching exactly. Note: 394 is +15 over Round 13's
recorded 379 baseline, not the +10 the task text's "10 new Rust tests" language implies — the
`session_claim.rs` (4 tests) + `ffmpeg.rs` (6 tests) additions the Round 14 entry lists sum to 10,
so 5 further Rust tests were added somewhere between Round 13 and this round's measurement that are
not individually itemized in either round's own file list; reported as measured, not reconciled
further within this round's scope. Seven frozen constants verified verbatim against source (not
just quoted): `WATCHDOG_MS` 30,000 (`exportPipelineWebCodecs.ts:949`), `FORWARD_PROGRESS_BOUND_MS`
45,000 (`:978`), `FLUSH_BOUND_MS` 20,000 (`exportWorker.ts:886`), `APPEND_DRAIN_BOUND_MS` 600,000
(`exportPipelineWebCodecs.ts:1110`), `TRUNCATE_BOUND_MS` 172,675 (`ffmpegLivenessBound.ts:175-177`,
computed as `6,907 × 25`, matches exactly), `KILL_BOUND_MS` 125 (`:149`, computed as `5 × 25`,
matches exactly), `APPEND_BATCH_BYTES` 524,288 / 512 KiB (`exportPipelineWebCodecs.ts:1052`). Four
fixture digests (`5db5e004…`, `af89ca66…`, `1abf9839…`, `fb9cdda2…`) confirmed unchanged, present
identically in both `docs/ws3-export/durable-state.md:1709-1712` and the live
`annexbFrameCount.test.ts:242-245`, and exercised passing as part of the `npm test` run above.

### Round 16 (2026-09-11) — Consolidation: carry-overs closed, integration merge, canonical ledger (PROMPT 20)

**Branch:** `ws3-hardening-windows` from `9de3455`, merged into `ws3-export-integration` (STEP 2
below). **Base main:** `4d4922c`. **Rollback:** `15002e5`. This is the entry to read instead of
the fifteen before it: it carries the merge record, the round-number map, the single C1–C11 /
H1–H10 disposition table, and the final frozen state. Hardware-bound residuals live in exactly one
file, `docs/ws3-export/windows-validation.md`, and are referenced from the table by ID only.

#### STEP 1a — Real clean-path byte neutrality: MATCH (`931a3c8`)

Not a trace assertion. `scripts/ws3-clean-path-artifact.test.ts` runs the real
`exportProjectWebCodecs` orchestrator — batching, per-append verify, checkpoint writes, concat,
the post-concat picture-count guard, mux, save — against a fake WORKER that replays a
byte-deterministic libx264 Annex-B fixture one access unit per frame (the granularity the real
worker posts), and a fake ffmpeg whose every file operation is real disk I/O in a session
directory and whose `exec` spawns the REAL bundled sidecar (`ffmpeg-x86_64-apple-darwin`, the
binary the app runs on this machine) with the argv the pipeline hands it. The output is a real
`export_final.mp4` written by the real muxer. The same file, unchanged, was run at `51e1f6b`
(pre-durable-state, in a detached worktree) and at the current head.

Why not a full live export: a live export needs the Tauri IPC bridge, WKWebView's `VideoEncoder`
and a GL context — none of which exist headless. Everything from the encoder's output bytes
onward IS the real code, and that is the entire surface the durable-state work touched.

| Arm | Input | `export_final.mp4` SHA-256 | `video_all.h264` SHA-256 |
|---|---|---|---|
| A | 320×180, 3 GL pieces × 1830 frames (5490 AUs, ~3.25 KB/AU), sine WAV voiceover; fixture `216592e8…9b95`, wav `9bd76648…6c5d` | `5bef695552b82311c95c4dbad410c6755c0820a220a2e7519a3caf4f3748f06c` at **both** `51e1f6b` and head | `216592e8…9b95` at both — equal to the input fixture, i.e. the pipeline is byte-transparent for the bitstream |
| B | 1280×720, 2 GL pieces × 1830 frames (3660 AUs, ~45 KB/AU — the field profile, so the 512 KiB BYTE trigger decides batch boundaries); fixture `89a16a32…3d69`, wav `5d2557e9…6285` | `09c53b61334205f7522e24912a2bbf951ca8da011a12e9de3eab22be39995386` at **both** | `89a16a32…3d69` at both |

Every intermediate (`piece_N.h264`, `voiceover_audio`, `video_all.h264.premux.mp4`) also matched
in both arms; the mux argv was identical across all runs; head is self-deterministic (Arm A run
twice, identical); both truncate primitives throw if reached and were never reached. The head's
extra clean-path work is visible in the call trace and moves no byte: Arm A — 9 manifest writes
and 57 per-append verify reads at head vs 0 / 1 at `51e1f6b`; Arm B — **304 appends under the
512 KiB cap vs 42 under the old 4 MiB cap** (7.2×), 6 manifest writes, 305 verify reads. So none
of STEP 9's five durable writes, nor STEP 2's batch cap, perturbs the clean path; the digests
above are the baseline. The harness is skipped without `WS3_ARTIFACT_DIR` (+1 skipped test in
`npm test`); fixture generation commands are in its header and are byte-deterministic
(regenerated, identical digest). The C11 fix (`5aba84b`, STEP 1c) was re-run through Arm A after
landing: still `5bef6955…f06c`.

#### STEP 1b — Cargo reconciliation: all 15 accounted, and the premise corrected

Round 13 did **not** record 379 — its own gate table (`docs/ws3-export/durable-state.md`, "Round
13 gates") records **384** (`381 + 3`). 379 is Round 8's / Round 10's figure (ledger Round 10
gates; durable-state Round 8 gates). Round 15's note that "5 further Rust tests were added
somewhere between Round 13 and this round's measurement, not itemized" was wrong about the
location: they sit between Round 10 and Round 13 and ARE itemized in Cursor's own Round 11 and
Round 13 gate tables. Measured with `cargo test --features fa-inference -- --list` (which lists
ignored tests too, so listed − 35 = runnable) at four heads, name sets diffed:

| Head | Listed | Runnable | Delta | Test names (module::tests::name) | Introducing commit | Arrived on this branch via |
|---|---|---|---|---|---|---|
| `57fc882` (Round 10, `ws3-tier2-wire`) | 414 | **379** | — | — | — | — |
| `4006386` (Round 11, `ws3-durable-resume`) | 416 | **381** | +3 −1 | + `ffmpeg::concat_preserves_partial_output_on_disk_full_error`, + `ffmpeg::resumed_session_blocks_bitstream_ops_until_prepared`, + `ffmpeg::resumed_session_blocks_write_during_pending`; − `ffmpeg::resumed_session_blocks_append_count_concat_until_prepared` (from `1c2be49`, replaced by the two `resumed_session_blocks_*` tests) | `79e3eed` | merge `d6eff3b` |
| `1b3d369` (Round 13, `ws3-durable-resume`; `80a7458` is identical) | 419 | **384** | +3 | `session_claim::claim_contention_second_holder_refused_while_first_live`, `session_claim::stale_claim_recovery_after_dead_pid`, `session_claim::sweep_refuses_claimed_directory` | `d73747a` | merge `2514423` |
| `9de3455` (Round 15, this branch) | 429 | **394** | +10 | `ffmpeg::windows_long_path_is_a_byte_for_byte_no_op_on_this_platform`, `ffmpeg::windows_prefix_actually_defeats_max_path_by_length`, `ffmpeg::windows_prefix_applies_to_a_drive_letter_path`, `ffmpeg::windows_prefix_applies_to_a_unc_path`, `ffmpeg::windows_prefix_is_idempotent_never_double_prefixed`, `ffmpeg::windows_prefix_leaves_a_relative_path_alone_defensively` (6, `e9355a2`, H9); `session_claim::a_directory_gone_before_the_call_is_neither_deleted_nor_pending`, `session_claim::a_genuine_removal_is_classified_as_deleted`, `session_claim::only_the_deleted_outcome_is_eligible_for_bytes_reclaimed`, `session_claim::pending_delete_is_never_classified_as_deleted` (4, `ee406dd`, H5/H10) | `e9355a2`, `ee406dd` | own commits |

379 + 2 + 3 + 10 = 394. Sixteen additions, one removal, every one attributed by `git log -S`.
The 35 ignored are constant at every head.

**`whisper::in_flight_tests` flake — REPRODUCED on the 4th run.** Round 15 observed 0 failures in
3 parallel runs; this round's 4th parallel run of `cargo test --features fa-inference` failed
`whisper::in_flight_tests::a_retained_percent_is_peeked_not_consumed` — `393 passed; 1 failed;
35 ignored`, panic at `src/whisper.rs:1671:43` — `received[0]` on a recording-channel log that
was empty when read. The test's `Channel` callback pushes synchronously, so this is NOT an
async-delivery race; the mechanism was not investigated further (outside WS3 file ownership).
The same test passes in isolation (`cargo test --features fa-inference
a_retained_percent_is_peeked_not_consumed`: 1/1, 0.00 s) and single-threaded. Record across the
consolidated tree (STEP 6): parallel runs this round **2 failed of 3** (hardening head; integration
head run 1), the third green; Round 15's 3 were green — **2 of 6 parallel runs overall, always
this one test, never single-threaded. Historically observed, not fixed, not proven fixed.** Nothing in
this round's or this branch's Rust changes plausibly touched it: `git log 4d4922c..HEAD --
src-tauri/src/whisper.rs` is empty; the branch's Rust diff is confined to `ffmpeg.rs`,
`session_claim.rs`, `lib.rs` (command registration), `Cargo.toml`/`Cargo.lock`. The race is
between the test's synchronous read of the log and the channel's asynchronous delivery — a
pre-existing test-fixture timing defect, not a product defect, and outside WS3's file ownership.

#### STEP 1c — C11, the multi-piece budget gap: FIXED (`5aba84b`)

**ID `C11`.** The manifest on disk is piece-scoped (the only scope under which the native fence,
which takes one file, and `appendExportCheckpoint`'s strict monotonicity can both hold — Round
10), and a fresh piece's manifest started every budget counter at zero. Within one process that
was harmless — the in-process gates (`boundaryRewindsUsed`, `hardwareFailoverUsed`) are
export-scoped locals — but a resumed process seeds those locals from the resumed PIECE's manifest
(STEP 9, `fa0a61c`), so everything an earlier, already-finished piece had spent was silently
restored.

**Worst case, written out.** An export with N GL pieces and one OS-level crash per piece: each
crash lands in a piece whose manifest shows only that piece's own spend, so each new process is
granted a fresh in-process budget and the cross-process `totalRecoveryAttempts` gate is likewise
per piece. Total: **2N rewinds, N failovers, 3N exact-offset truncates, 4N recovery attempts**
against the documented **2 / 1 / 3 / 4**. A 26-minute 1080p30 export (~26 pieces at 1800 frames)
could perform 52 rewinds and 26 failovers. Within a single piece repeated crashes were already
bounded (the adopted manifest rolls forward); the leak is strictly across piece boundaries.

**Fix, inside Rung 0.** `exportLifetimeBudgetOf(previous)` (pure, `exportCheckpoint.ts`) projects
the three export-scoped counters; `createExportStateManifest` takes them as `carriedBudget`; the
writer's `startManifest` passes the manifest it is leaving behind (fresh or adopted, plus every
`note*` since — the export's running total). The newest manifest on disk is therefore always the
export-lifetime total and a resume from ANY piece seeds the in-process gates correctly. No new
file, no new native command, no new I/O, no new time constant — the same single-slot,
never-awaited write. `checkpointResumeAttempts` (documented per checkpoint generation) and
`rotationsSeen` (per-piece coverage signal for `never_checkpointed`) deliberately stay
piece-scoped. Probes: `exportCheckpointWriter.test.ts` "THE C11 SCENARIO" (+3), `exportCheckpoint.test.ts`
(+2); destructive — replacing the carry with `undefined` turns the scenario red, restored by
move. The residual from Round 15 STEP 10b item 3 (a crash landing between the synchronous
in-memory charge and its fsync under-counts ONE attempt) is unchanged and unchanged in kind — it
was never a piece-boundary leak.

#### STEP 2 — Merge into `ws3-export-integration`: fast-forward, ZERO conflicts

`git merge ws3-hardening-windows` in the `ws3-export-integration` worktree (which already
existed at `../4.kinetix-pro-studio-ws3-export-integration` @ `15002e5`; no second worktree was
added) was a **fast-forward** `15002e5 → e8cfd82`. Structurally so, not luck: `15002e5` is the
merge base of the two branches and an ancestor of the hardening head, and every lineage the task
predicted conflicts from — `ws3-tier3-failover` (`0ab9af8`), `ws3-tier2-wire` (`81815cd`),
`ws3-durable-resume` Rounds 11 and 13 (`d6eff3b`, `2514423`) — had already been merged INTO
`ws3-hardening-windows` before this round. The integration branch itself carried no ledger and no
pipeline audit at all (`git cat-file -e 15002e5:docs/ws3-export/architecture-ledger.md` fails).
The three predicted hazards were therefore verified as resolutions of the MERGED tree rather than
resolved as conflicts:

| File | Predicted | Measured on the merged tree |
|---|---|---|
| `docs/ws3-export/architecture-ledger.md` | three divergent blobs, chronological union | Every Round-log entry from every blob (`ws3-tier1-close` Round 7, `ws3-tier3-failover` Round 7 + 9 + Rung 5c, `ws3-tier2-wire` Round 7 + 9 + 10) is present in the merged file with **zero** missing non-empty lines; the Round 7 and Round 9 entries are byte-identical to their source blobs. The only lines unique to an older blob are LIVING-register rows (Rung 0/2b/4 status, Tier 2 status, two NOT DETERMINED rows) that Round 10 updated in place — registers are current-state tables, not append-only — plus the `## 7. Decisions register` heading, restored in STEP 3. |
| `docs/ws3-export/durable-state.md` | three blobs, hardening (1779 lines) a strict superset | `ws3-export-integration` (629 lines), `ws3-tier3-failover` (629) and `ws3-tier2-wire` (1332): **0** unique non-empty lines each. `ws3-durable-resume` (1602): **1** unique line — the `save_session_file` / "pre-encode path-length validation: NOT DETERMINED" sentence, which Round 15 edited in place at `:1759` (adding "*as of this entry*") and followed with the Round 14/15 closure. Nothing lost; one sentence deliberately qualified. |
| `docs/archive/history/work-in-progress.md` | two blobs, WS3 @ `15002e5` wins | One blob (`c16afeab`) on every branch involved — identical everywhere; the 5-line append-path batching item is at `:32-36`. Nothing to take. |

#### STEP 3 — The ledger's two remaining divergences

**The "Round 9 collision" does not exist in any ledger blob.** Measured: the only `### Round 9`
heading in any blob (`ws3-tier3-failover`, `ws3-tier2-wire`, hardening) is the same entry, and
the tier3 and hardening copies differ by one blank line. No entry was dropped, so none needed
keeping. What DOES exist is a cross-DOCUMENT collision on **Round 7**: this file's Round 7 (CC
lineage, `ws3-tier1-close`, 2026-09-10/11, Tier 1 closeout + Rung 3) versus
`docs/ws3-export/durable-state.md`'s Round 7 (Cursor lineage, `ws3-durable-resume`, 2026-09-10,
Rung 2b sealing + Rung 4 resume primitives). Round 15's "Round 9 already collided" note was this
collision, misnumbered. Disposition: **both kept, both headings qualified** (`Round 7 [CC
lineage]` / `Round 7 [Cursor lineage]`), a one-line cross-note added under each pointing at the
other, and the map below recorded. **Deliberately NOT renumbered** to "the next free round
number": the next free number is 17 (12 is taken — see the map), so renaming would put a
2026-09-10 entry after a 2026-09-11 one, and it would break 42 existing "Round 7" cross-references
across three docs (29 in this file alone) plus the commit messages that cite them. The qualified
headings disambiguate every existing reference without moving it.

**Round-number map (cross-lineage, authoritative from here on):**

| Round | Lineage / branch | Where the entry lives | Content |
|---|---|---|---|
| 7 [CC] | `ws3-tier1-close` | this file §6 | Tier 1 closeout, Rung 3 rewind, back-pressure, diagnostics blob, ledger created |
| 7 [Cursor] | `ws3-durable-resume` | `durable-state.md` | Rung 2b sealing + Rung 4 resume primitives, checkpoint manifest, fence |
| 8 | Cursor, `ws3-durable-resume` | `durable-state.md` | Cargo arithmetic, mux measured at 1.7/2.3 GB, conservative final-AU, seam contracts |
| 9 | CC, `ws3-tier3-failover` | this file §6 + §7 | Rung 5a/5b, canonical taxonomy, Rung 5c DEFER |
| 10 | CC, `ws3-tier2-wire` | this file §6 | Tier 2 closeout: sealing wired, resume wired, Rung 0 holes, parameter-set spike, recovery matrix |
| 11 | Cursor, `ws3-durable-resume` | `durable-state.md` + audit Part 7 | C1/C2/C3/C7/C8/H8 remediation |
| 12 | CC, `ws3-hardening-windows` STEPs 0-2 (`d6eff3b`, `4a3e584`, `0d397f7`) | **code comments only** (`WS3 Round 12`, `App.tsx`, `useExport.ts`, `exportResumeSession.ts`, `flushSalvage.test.ts`) — no doc entry was ever written | Round 11 merge, resume-refusal notice, 512 KiB batch cap (H1) |
| 13 | Cursor, `ws3-durable-resume` | `durable-state.md` + audit Part 7 | Realistic fixtures, `KILL_BOUND_MS`, session claim, orphan sweep |
| 14 | CC, `ws3-hardening-windows` | this file §6 + `durable-state.md` + audit | C5/C6/C7/H5/H9/H10 |
| 15 | CC, `ws3-hardening-windows` | this file §6 + audit | STEPs 10b-13, batch-cap quantification, first full disposition table |
| 16 | CC, `ws3-export-integration` | this file §6 (this entry) + `windows-validation.md` | Consolidation |

**Rung 5c DEFER block: folded.** It had lost its `## 7. Decisions register` heading at `be332ee`
(the Round 7 preamble restore) and was sitting inside §6 between the Round 14 and Round 15
entries. Restored as **§7** after the Round log — the position its own first line ("durable — not
round-log") and the Round 9 entry ("see §7 below") both name — with a provenance note; content
verified byte-identical to the `ws3-tier3-failover` blob (`dedc3bf`). Deferred four rounds; closed
here.

**Canonical form.** After this round, `docs/ws3-export/architecture-ledger.md` has exactly one
form: the file at `ws3-export-integration`'s head, to which `ws3-hardening-windows` is
fast-forwarded (both pushed at the same SHA). The older blobs on `ws3-tier1-close`,
`ws3-tier3-failover` and `ws3-tier2-wire` are strict historical ancestors whose every round-log
line is contained in this one (measured above); no branch carries a ledger with content this one
lacks.

#### STEP 4 — Consolidated disposition: C1–C11, H1–H10 (supersedes every earlier table)

Vocabulary: `closed` = fixed in code, with the SHA and the probe that goes red without the fix;
`mitigated` = code-side fix verified, one residual stated; `open` = no code-side fix possible from
this environment, or an explicit deferral. Nothing hardware-bound is `closed`. Hardware residuals
are named by their row ID in `docs/ws3-export/windows-validation.md` and described nowhere else.

| ID | Statement (short) | Status | Fixing SHA(s) · probe / residual |
|---|---|---|---|
| C1 | Resume fence didn't gate write/exec/truncate/read | **closed** | `79e3eed` · `ffmpeg::tests::resumed_session_blocks_bitstream_ops_until_prepared`, `resumed_session_blocks_write_during_pending` |
| C2 | `{kind:'clean'}` masked a post-mutation native failure | **closed** | `693e533` · `exportResumeDiscovery.test.ts` "bitstream_touched: the fence mutates the file, THEN fails" + "a fence failure with NO mutation is never reported as bitstream_touched" |
| C3 | Timeline hash omitted overlay/effect/asset-byte identity | **closed** | `693e533` · `exportCheckpoint.test.ts` "each newly covered visual field changes the hash", "includes timelineIdentityVersion so v1 hashes invalidate" |
| C4 | Rewind `truncateAnnexbToOffset` had no TS liveness bound | **closed** | `46cfda8` (Round 10) · `rewindTruncateBound.test.ts` — with the wrap removed the test HANGS (20 s timeout), the defect itself |
| C5 | Pending append batch silently discarded on abnormal finish | **closed** | `2bb06fa` · `appendBatching.test.ts` "watchdog kill: discardedAtFinish names the encoder-produced bytes…", "worker crash: the same discard accounting applies" |
| C6 | `destroy`/premux cleanup failures invisible to operator | **closed** | `ee406dd` · `exportCleanupNotices.test.ts`; `muxOnly.test.ts` premux-delete failure recorded |
| C7 | Manifest schema couldn't bound recovery across restarts | **mitigated** | `fa0a61c` (full-reset bug) + `5aba84b` (C11 cross-piece carry) · `hardwareFailoverWiring.test.ts` resumed-run seeding probe; `exportCheckpointWriter.test.ts` "THE C11 SCENARIO". Residual: a crash inside the single fsync window between the synchronous in-memory charge and its durable write under-counts exactly one attempt (Round 15 STEP 10b item 3, accepted under Rung 0 — awaiting the write would reintroduce the hang) |
| C8 | Concat deleted output on any error, including disk-full | **closed** | `79e3eed` · `ffmpeg::tests::concat_preserves_partial_output_on_disk_full_error` |
| C9 | Slice-counting reachable on a production guard | **closed** (already clean) | Rung 1, pre-existing · `annexbFrameCount.test.ts` `8slice-10pic` fixture (`pictures` 10 vs `vclNals` 80); zero production reads of `.vclNals` for a decision |
| C10 | In-process second-rewind session-index bug | **closed** | `a6581d2` (Round 7 [CC]) · `boundedRerenderWiring.test.ts` "stops rewinding once MAX_BOUNDARY_REWINDS_PER_EXPORT is reached" — RED with the `resumeSessionIndex` bootstrap removed |
| C11 | Piece-scoped manifest leaked budget spent in earlier pieces across a crash (worst case 2N/N/3N/4N vs 2/1/3/4) | **closed** | `5aba84b` · `exportCheckpointWriter.test.ts` "THE C11 SCENARIO" — RED with the carry replaced by `undefined`; `exportCheckpoint.test.ts` `exportLifetimeBudgetOf` |
| H1 | 4 MiB batch vs. WebView2 ~2 MB IStream truncation | **mitigated** | `0d397f7` · 512 KiB cap (4× margin) + independent per-append verify; clean-path neutrality of the cap measured on real bytes (STEP 1a Arm B, 304 vs 42 appends, identical MP4). Residual: **W11** (and **W12**, **W13**) |
| H2 | `prefer-software` + `avc1.640028` may be unconfigurable on Windows/OpenH264 | **mitigated** | `75e331c` · profile-ladder descent pinned per piece via `selectedCodec` (`hardwareCodecLadder.ts`, `hardwareFailoverLadder.test.ts`). Residual: **W4** |
| H3 | `VideoEncoder.close()` async release may leak HW sessions | **mitigated** | `9ea600a` · `encoderSessionsOpened`/`encoderSessionsClosed` on the diagnostics blob, close before every terminal post — a leak is observable. Residual: **W5**, **M2** |
| H4 | Defender scan-on-close may explain the 12.4 ms/append gap | **open** | No code-side fix possible here. **W7** |
| H5 | Two app instances could `reenter` the same session (no lock) | **mitigated** | `d73747a` (claim primitive) + `ee406dd` (consumer: `evaluateResumeCandidate` reads the claim before `reenter`) · `exportResumeDiscovery.test.ts` "a LIVE claim blocks reentry…", "a STALE claim permits reentry…"; `session_claim::tests::claim_contention_second_holder_refused_while_first_live`. Residual: **W10** |
| H6 | TDR during a long GL export presents as unrecoverable context loss | **open**, by decision | Rung 5c DEFER (§7), reopen trigger stated there. **W8** |
| H7 | Lid close / Modern Standby may kill MF drain despite heartbeat | **open** | No code-side fix possible here. **W9** |
| H8 | Checkpoint fsync without Annex-B `sync_all` could lose durability | **mitigated** | `79e3eed` · `sync_session_file` (`ffmpeg.rs:94`) on append/truncate/prepare; seam order append → fsync → manifest; handshake `byteOffset ≤ fileLen` (`exportResumeDiscovery.test.ts`); `ffmpeg::tests::export_state_write_is_validated_synced_and_replaceable`. Residual: durability under a real OS crash is **E1** |
| H9 | Long destination paths fail `save_session_file` post-encode | **mitigated** | `e9355a2` · `windows_long_path` on both copy sides (6 `ffmpeg::tests::windows_*` tests) + `exportDestinationPath.ts` pre-encode check (`useExport.ts:717-747`). Residual: **W2**, **W3** |
| H10 | Orphaned session dirs accumulate, ~1.6–2.3 GB each | **mitigated** | `d73747a` (native sweep) + `ee406dd` (consumer: `useExport.ts` sweeps once per export start, `pendingDelete` kept apart from `bytesReclaimed`) · `session_claim::tests::pending_delete_is_never_classified_as_deleted`, `only_the_deleted_outcome_is_eligible_for_bytes_reclaimed`. Residual: **W1** |

Twenty-one rows, no blanks. Ten `closed` (C1–C6, C8–C11), eight `mitigated` (C7, H1, H2, H3,
H5, H8, H9, H10), three `open` (H4, H6, H7). Every `mitigated` residual and every `open`
item resolves to a row in `docs/ws3-export/windows-validation.md` (25 rows: W1–W15 Windows,
M1–M2 macOS-native, E1–E8 either) — that file, not this table, is where "what's left" is read.
This table supersedes Round 15 STEP 12's table and every earlier scattered disposition
(`docs/ws3-export/pipeline-audit.md` Part 7's Round 11/13/14/15 blocks are historical; its Round
16 block points here).

#### Final state

**Seven frozen constants, read from source at this head:** `WATCHDOG_MS` = 30,000
(`exportPipelineWebCodecs.ts:949`) · `FORWARD_PROGRESS_BOUND_MS` = 45,000 (`:978`) ·
`FLUSH_BOUND_MS` = 20,000 (`exportWorker.ts:886`) · `APPEND_DRAIN_BOUND_MS` = 600,000
(`exportPipelineWebCodecs.ts:1110`) · `TRUNCATE_BOUND_MS` = 172,675 (`ffmpegLivenessBound.ts:175`,
`⌈6,907 × 25⌉`) · `KILL_BOUND_MS` = 125 (`:149`, `⌈5 × 25⌉`) · `APPEND_BATCH_BYTES` = 524,288 =
512 KiB (`exportPipelineWebCodecs.ts:1052`). Unchanged this round.

**Four fixture digests** (`annexbFrameCount.test.ts:242-245`, mirrored in
`docs/ws3-export/durable-state.md`): `8slice-10pic` 781 B
`5db5e004522c4212339bfbae771df15c84bc8858ec8ad7906a131199dcaf8994` · `1slice-12pic` 261 B
`af89ca66bbb7447312547e54d8ded6e9ac460b51d8e09f5a327ac82cf5a88d44` · `paramsets-3pic` 81 B
`1abf9839f658ae5b9f83f2411542b86fe0490c055e1ec739f00d4bd2a6458035` · `short-9pic` 201 B
`fb9cdda22d69cac8af96ef1f7f1cd5a9dfaf486ef7d8efb46fe01a0c7fb6198b`. Unchanged.

**Clean-path output digests (new baseline, STEP 1a):** Arm A `export_final.mp4`
`5bef695552b82311c95c4dbad410c6755c0820a220a2e7519a3caf4f3748f06c`; Arm B
`09c53b61334205f7522e24912a2bbf951ca8da011a12e9de3eab22be39995386` (inputs and procedure in
STEP 1a and the harness header).

**Recovery budget as actually implemented** (`exportCheckpoint.ts:22-30`,
`exportPipelineWebCodecs.ts`): per export, every GL piece combined, and — from `5aba84b` —
carried across piece boundaries in the durable manifest so it holds across any number of
crashes: `MAX_BOUNDARY_REWINDS_PER_EXPORT` = 2 · `MAX_HARDWARE_FAILOVER_PER_EXPORT` = 1
(one-shot flag, not charged to the rewind budget) · `MAX_TRUNCATES_PER_EXPORT` = 3 (2 + 1,
exact-offset, each under `TRUNCATE_BOUND_MS`) · `MAX_DRIVE_GL_RUN_ATTEMPTS_PER_EXPORT` = 4 (1
initial + 2 + 1) = `MAX_TOTAL_RECOVERY_ATTEMPTS_PER_EXPORT`, the cross-process gate
(`isRecoveryBudgetExhausted`: refuses a resume once `boundaryRewindsUsed ≥ 2` or
`totalRecoveryAttempts ≥ 4`, where resume attempts also count). In-process gates read the
export-scoped locals, seeded from the resumed manifest; the durable manifest carries
`boundaryRewindsUsed`, `hardwareFailoverUsed`, `totalRecoveryAttempts` export-lifetime and
`checkpointResumeAttempts`, `rotationsSeen`, `checkpoints` piece-scoped. Salvage: `MAX_FLUSH_SALVAGES`
= 1 per GL piece (final-flush only). Known residual: the one-attempt fsync-window under-count
(C7).

#### STEP 6 — Gates on the merged integration branch (raw tails)

`npx tsc --noEmit` → exit 0, no output. `npm run lint` (= `tsc --noEmit`) → exit 0.

`npm test`, run 1:
```
[replay:v6] parsed=447 kept=444 skipped=3 gate.aborted=false totalCommittedDuration=1421.29 audioDuration=1421.29
[replay:173] parsed=175 kept=172 skipped=3 gate.aborted=false totalCommittedDuration=709.01 audioDuration=709.01
[replay:spanish] parsed=27 kept=26 skipped=1 gate.aborted=false totalCommittedDuration=92.04 audioDuration=92.04
 ✓ src/services/dragDurationInvariant.test.ts (12 tests) 504ms
stdout | src/services/syncTiming.test.ts > Row 8a — last-segment rescue window sized from the probed audioDuration > fails to recover the last segment's true words with the token-derived fallback, succeeds once the true probed duration is passed
stdout | src/services/syncTiming.test.ts > Row 8a — last-segment rescue window sized from the probed audioDuration > the optional audioDuration parameter does not change output for existing (no-audioDuration) call sites
[ws3-seal] operator consented to a SHORT deliverable {"picturesKept":27,"picturesExpected":30,"picturesLost":3,"keptWallDurationSeconds":0.9,"lostWallDurationSeconds":0.1,"fps":30}
[ws3-seal] operator consented to a SHORT deliverable {"picturesKept":27,"picturesExpected":30,"picturesLost":3,"keptWallDurationSeconds":0.9,"lostWallDurationSeconds":0.1,"fps":30}
[ws3-seal] operator consented to a SHORT deliverable {"picturesKept":29,"picturesExpected":30,"picturesLost":1,"keptWallDurationSeconds":0.9666666666666667,"lostWallDurationSeconds":0.03333333333333333,"fps":30}
[seek] target=0.000s videoDuration=10s readyState=4 networkState=1 src=blob:same-source-url
[seek] target=0.000s videoDuration=10s readyState=4 networkState=1 src=blob:same-source-url
[seek] target=0.000s videoDuration=10s readyState=4 networkState=1 src=blob:same-source-url
[seek] target=0.000s videoDuration=10s readyState=4 networkState=1 src=blob:same-source-url
[seek] target=0.000s videoDuration=10s readyState=4 networkState=1 src=blob:same-source-url
[seek] target=0.000s videoDuration=10s readyState=4 networkState=1 src=blob:same-source-url
[seek] target=0.000s videoDuration=10s readyState=4 networkState=1 src=blob:same-source-url
[seek] target=0.000s videoDuration=10s readyState=4 networkState=1 src=blob:same-source-url
[seek] target=0.000s videoDuration=10s readyState=4 networkState=1 src=blob:same-source-url
[seek] target=0.000s videoDuration=10s readyState=4 networkState=1 src=blob:same-source-url
 Test Files  207 passed | 63 skipped (270)
      Tests  3569 passed | 78 skipped (3647)
   Duration  225.20s (transform 29.81s, setup 0ms, import 136.89s, tests 1374.82s, environment 37.37s)
exit 0
```
`npm test`, run 2:
```
[replay:v6] parsed=447 kept=444 skipped=3 gate.aborted=false totalCommittedDuration=1421.29 audioDuration=1421.29
[replay:173] parsed=175 kept=172 skipped=3 gate.aborted=false totalCommittedDuration=709.01 audioDuration=709.01
[replay:spanish] parsed=27 kept=26 skipped=1 gate.aborted=false totalCommittedDuration=92.04 audioDuration=92.04
 ✓ src/services/dragDurationInvariant.test.ts (12 tests) 529ms
stdout | src/services/syncTiming.test.ts > Row 8a — last-segment rescue window sized from the probed audioDuration > fails to recover the last segment's true words with the token-derived fallback, succeeds once the true probed duration is passed
stdout | src/services/syncTiming.test.ts > Row 8a — last-segment rescue window sized from the probed audioDuration > the optional audioDuration parameter does not change output for existing (no-audioDuration) call sites
[ws3-seal] operator consented to a SHORT deliverable {"picturesKept":27,"picturesExpected":30,"picturesLost":3,"keptWallDurationSeconds":0.9,"lostWallDurationSeconds":0.1,"fps":30}
[ws3-seal] operator consented to a SHORT deliverable {"picturesKept":29,"picturesExpected":30,"picturesLost":1,"keptWallDurationSeconds":0.9666666666666667,"lostWallDurationSeconds":0.03333333333333333,"fps":30}
[ws3-seal] operator consented to a SHORT deliverable {"picturesKept":27,"picturesExpected":30,"picturesLost":3,"keptWallDurationSeconds":0.9,"lostWallDurationSeconds":0.1,"fps":30}
[seek] target=0.000s videoDuration=10s readyState=4 networkState=1 src=blob:same-source-url
[seek] target=0.000s videoDuration=10s readyState=4 networkState=1 src=blob:same-source-url
[seek] target=0.000s videoDuration=10s readyState=4 networkState=1 src=blob:same-source-url
[seek] target=0.000s videoDuration=10s readyState=4 networkState=1 src=blob:same-source-url
[seek] target=0.000s videoDuration=10s readyState=4 networkState=1 src=blob:same-source-url
[seek] target=0.000s videoDuration=10s readyState=4 networkState=1 src=blob:same-source-url
[seek] target=0.000s videoDuration=10s readyState=4 networkState=1 src=blob:same-source-url
[seek] target=0.000s videoDuration=10s readyState=4 networkState=1 src=blob:same-source-url
[seek] target=0.000s videoDuration=10s readyState=4 networkState=1 src=blob:same-source-url
[seek] target=0.000s videoDuration=10s readyState=4 networkState=1 src=blob:same-source-url
 Test Files  207 passed | 63 skipped (270)
      Tests  3569 passed | 78 skipped (3647)
   Duration  219.79s (transform 29.26s, setup 0ms, import 138.07s, tests 1395.73s, environment 39.01s)
exit 0
```
Identical. **Arithmetic against 3641:** `9de3455` = 3564 passed + 77 skipped = **3641** (Round
15's own "3565/77 = 3642" was an off-by-one — its +1 probe was already inside its 3564
measurement; the diff `9de3455..HEAD -- '*.test.ts'` adds exactly 6 tests and removes 0). Delta
this round, every one attributed: `exportCheckpointWriter.test.ts` +3 (`5aba84b`, C11: 7 → 10),
`exportCheckpoint.test.ts` +2 (`5aba84b`: 26 → 28), `scripts/ws3-clean-path-artifact.test.ts` +1
**skipped** (`931a3c8`, gated on `WS3_ARTIFACT_DIR`). 3641 + 5 passed + 1 skipped = **3647 =
3569 / 0 / 78** ✓.

`cargo test` (default features):
```
test result: ok. 308 passed; 0 failed; 5 ignored; 0 measured; 0 filtered out; finished in 9.37s
test result: ok. 0 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s
test result: ok. 0 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s
```
`cargo test --features fa-inference`, parallel, run 1 of 2 on this head:
```
test whisper::in_flight_tests::a_retained_percent_is_peeked_not_consumed ... FAILED
thread 'whisper::in_flight_tests::a_retained_percent_is_peeked_not_consumed' (376042) panicked at src/whisper.rs:1671:43:
test result: FAILED. 393 passed; 1 failed; 35 ignored; 0 measured; 0 filtered out; finished in 9.40s
```
run 2 of 2, parallel:
```
test result: ok. 394 passed; 0 failed; 35 ignored; 0 measured; 0 filtered out; finished in 9.28s
test result: ok. 0 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s
test result: ok. 0 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s
```
single-threaded (`-- --test-threads=1`):
```
test result: ok. 394 passed; 0 failed; 35 ignored; 0 measured; 0 filtered out; finished in 34.41s
test result: ok. 0 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s
test result: ok. 0 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s
```
308 / 0 / 5 and 394 / 0 / 35 match Round 15 exactly (no Rust test added this round). The one
parallel failure is the `whisper::in_flight_tests` flake recorded under STEP 1b.

**Seven frozen constants** verified verbatim against source (values and `file:line` in "Final
state" above). **Four fixture digests** unchanged (`annexbFrameCount.test.ts:242-245` ==
`docs/ws3-export/durable-state.md`, exercised passing in both `npm test` runs). `git status
--porcelain` on the integration worktree: clean apart from `node_modules/` and `public/`
(standing untracked). The three pre-existing untracked docs in the MAIN worktree
(`docs/ws3-export/durable-state.md`, `docs/ws3-export/speed-architecture-audit.md`,
`docs/ws3-groq-transcription-architecture-audit.md`) are pre-existing and out of scope — not
staged, committed, or deleted (Cursor removes two of them in its Phase 2). No `git add -A`; every
stage was by named path. `ws3-hardening-windows` fast-forwarded to the integration head so both
branches carry the one canonical ledger; both pushed. No merge to `main`, no PR.

### Round 17 (2026-09-11) — Documentation consolidation and close (PROMPT 22)

**Branch:** `ws3-export-integration` @ `523d9a5`, merging `docs-consolidate-p2` @ `9c58985`.
**Base main:** `4d4922c`. **Rollback:** `15002e5`. Documentation-lane close only — no features,
no refactors, one test-annotation change (STEP 3 below).

#### STEP 1 — Merge: fast-forward, ZERO conflicts

`git fetch origin && git merge origin/docs-consolidate-p2` was a clean fast-forward
`523d9a5 → 9c58985` (124 files changed, +2088/-738) — `docs-consolidate-p2` branches directly off
this branch's own `523d9a5`, so there was no divergence to reconcile. Content-identity confirmed
for all three docs this prompt named, by diffing old flat path (as committed at `523d9a5`)
against new nested path: every hunk in all three diffs is a cross-reference string rewritten from
the old flat filename (`docs/ws3-export-architecture-ledger.md` etc.) to the new nested one
(`docs/ws3-export/architecture-ledger.md`) — the ref-rewrite this consolidation commit exists to
do. Zero content dropped, zero hunks outside a path string:
- `architecture-ledger.md` — 8 hunks, all path-string rewrites.
- `durable-state.md` — 8 hunks, all path-string rewrites.
- `pipeline-audit.md` — 8 hunks, all path-string rewrites.

#### STEP 2 — Stale stub deleted

`docs/ws3-export-durable-state.md` in the main worktree: confirmed 64 lines / 3842 bytes, dated
2026-09-10, containing only the "Step 4d residual" analysis (truncated-final-slice-read-as-complete).
That topic is superseded in the committed `docs/ws3-export/durable-state.md` (1859 lines), whose
Round-11+ text (around line 1367-1382) carries the same truncated-final-slice concern folded into
the durable checkpoint/resume design. Committed copy confirmed present on this branch before
deletion. Stub removed by `rm` (named path, not a wildcard). Main worktree `git status --porcelain`
is now **completely empty** — zero untracked files of any kind, docs included.

#### STEP 3 — Flake rule: `#[ignore]`, not a canonical-gate rewrite

**Decision: `#[ignore]` on the test, with the panic site and reason recorded inline.**
`whisper::in_flight_tests::a_retained_percent_is_peeked_not_consumed` (`src-tauri/src/whisper.rs`)
panics at `whisper.rs:1671:43` in roughly one parallel `cargo test` run in three, never
single-threaded, never in isolation — first reproduced Round 16 STEP 1b, mechanism traced there to
cross-test interference through the process-global `IN_FLIGHT`/`TERMINAL_BUFFER` statics
(`whisper.rs:94,220-221`), not a defect in the peeked-not-consumed behavior the test asserts. The
test is `#[cfg(test)]`-only, not `fa-inference`-gated, so the flake risk sits on the **plain**
`cargo test` gate, not the feature-gated one.

Why `#[ignore]` over a canonical-gate rewrite: the alternative this prompt offered — stating that
single-threaded is the canonical gate — would mean either (a) restating that rule for the whole
`cargo test` invocation project-wide to cover a single test outside WS3's file ownership, which
over-scopes a local fixture problem into a project-wide workflow change, or (b) leaving the
default parallel gate free to flake ~1/3 of the time with no enforcement, which defeats the point
of stating a rule at all. `#[ignore]` is scoped to exactly the one test that has the problem, is
enforced by the compiler (an ignored test cannot silently un-ignore itself), and the inline comment
at the test site plus this entry are the record the next person needs — no rediscovery required.

**Canonical gate commands, stated once here for reference:**
- Plain: `cargo test` (parallel, default) — now **307 / 0 / 6** (the flake's own test moved from
  counted-and-occasionally-red to ignored; everything else unchanged).
- fa-inference: `cargo test --features fa-inference -- --test-threads=1` — now **393 / 0 / 36**
  (same one-test shift). Single-threaded was already this project's practice for the fa-inference
  gate (STEP 5 below runs it that way); this entry makes it explicit that doing so is not merely a
  style choice but the only way to get a trustworthy count while `IN_FLIGHT`/`TERMINAL_BUFFER`
  remain process-global test state.
- To exercise the ignored test on its own for a real answer: `cargo test --features fa-inference
  -- --ignored --test-threads=1 a_retained_percent_is_peeked_not_consumed`.

Not fixed, not owned by WS3 — the fix (scoping the test's global state, or accepting per-test
isolation via a different harness) belongs to whoever owns `whisper.rs`'s test module.

#### STEP 4 — Doc tree as it now stands

31 markdown files under `docs/`, 5 lanes:

| Lane | Path | Count |
|---|---|---|
| Top-level | `docs/README.md` | 1 |
| Archive | `docs/archive/` (`README.md` + `history/` × 3 + `ws2/` × 2 + `ws3/` × 5) | 11 |
| WS1 (sync pipeline) | `docs/ws1-sync-pipeline/` (incl. `measurements/`) | 6 |
| WS2 (app) | `docs/ws2-app/` | 5 |
| WS3 (export) | `docs/ws3-export/` | 8 |

`1 + 11 + 6 + 5 + 8 = 31`, matches `find docs -name '*.md' | wc -l`. This is the tree
`docs-consolidate-p2` produced: every WS3 doc this ledger cross-references now lives under
`docs/ws3-export/` (README, architecture-ledger, durable-state, pipeline-audit,
recovery-architecture, silent-gaps-diagnosis, speed-architecture-audit, windows-validation); the
old flat `docs/ws3-export-*.md` naming is retired project-wide, not just for the three files STEP
1 checked byte-for-byte.

**21-row C1–C11/H1–H10 disposition table and 25-row Windows validation list: unchanged, remain
authoritative.** Referenced by path only, not restated: this file's own §6 Round 16 STEP 4 table
(C1–C11, H1–H10), and `docs/ws3-export/windows-validation.md` (W1–W15, M1–M2, E1–E8).

#### STEP 4 (cont.) — durable-state.md / pipeline-audit.md: no number moved

Checked both files for any number this round's changes could have invalidated. **None did, and
none needed updating.** The only "current state" figures either file carries are the seven frozen
constants and four fixture digests (both mirrored from source and re-verified unchanged in STEP 5
below). The `cargo test` counts appearing in `durable-state.md` (e.g. its Round 13/Round 14 gate
tables, "384 + 10 = 394" etc.) are historical per-round snapshots of what that round actually
measured at the time — correctly frozen, not retroactively rewritten to Round 17's post-`#[ignore]`
counts, the same way `docs/history.md` entries are never edited after the fact. `pipeline-audit.md`
carries no raw pass/fail counts at all (checked; zero hits for the relevant numbers).

#### State at close

**What the pipeline guarantees today:** the 21-row C1–C11/H1–H10 disposition table (§6 Round 16
STEP 4) is the single authoritative statement — ten `closed`, eight `mitigated` with a named
residual each, three `open` by explicit decision or hardware dependency. Every `mitigated`/`open`
residual resolves to exactly one row in `docs/ws3-export/windows-validation.md` (25 rows), which is
where "what's left" is read — not this ledger, not `pipeline-audit.md`. Seven frozen liveness/batch
constants and four fixture digests are re-verified unchanged this round (STEP 5). The recovery
budget (2 rewinds / 1 hardware failover / 3 truncates / 4 total attempts, export-lifetime, carried
across piece boundaries since C11) is unchanged.

**What remains unverified:** everything hardware-bound — the full W1–W15/M1–M2/E1–E8 set in
`docs/ws3-export/windows-validation.md` requires real Windows and/or non-SSD hardware this
environment does not have. Rung 5c (out-of-process render isolation) stays DEFERRED per §7's
standing decision, reopened only by one of the two observed-occurrence triggers stated there. C7's
one-attempt fsync-window under-count residual is accepted, not fixed. The `whisper::in_flight_tests`
flake (STEP 3 above) is documented and contained, not fixed — ownership sits outside WS3.

**Where each lives:** disposition table and final-state figures — this file, §6 Round 16. Hardware
residuals — `docs/ws3-export/windows-validation.md`. Deferred-decision reasoning — this file, §7.
Checkpoint/resume design and the durable-write seam order — `docs/ws3-export/durable-state.md`.
Byte-level guard/truncate semantics and the C-series/H-series findings register —
`docs/ws3-export/pipeline-audit.md`. Throughput anatomy (Mac) —
`docs/ws3-export/speed-architecture-audit.md`. Recovery-architecture rung numbering (its own,
independent 1-13 scheme, not this ledger's) — `docs/ws3-export/recovery-architecture.md`. This
entry is the one place all of the above is indexed together; someone reading only this entry knows
the whole position.

#### STEP 5 — Gates (raw tails below)

See the STEP 5 gate log appended to this round's close — `npx tsc --noEmit` exit 0 (no output),
`npm run lint` exit 0, `npm test` run twice identical at **3569 / 0 / 78 = 3647** (no delta from
Round 16), `cargo test` **307 / 0 / 6** (was 308/0/5; delta is exactly STEP 3's new `#[ignore]`),
`cargo test --features fa-inference -- --test-threads=1` **393 / 0 / 36** (was 394/0/35; same
one-test delta). Seven frozen constants verified verbatim against source (unchanged). Four named
fixture digests verified unchanged (`annexbFrameCount.test.ts:242-245`). `git status --porcelain`
on the integration worktree: clean apart from `node_modules/` and `public/` (standing untracked)
plus the STEP 3 edit to `src-tauri/src/whisper.rs`, committed this round. Pushed to
`ws3-export-integration`. No merge to `main`, no PR.

---

## 7. Decisions register (durable — not round-log, never re-litigated without overturning the entry)

> Round 16 note: this heading was dropped by `be332ee` (the Round 7 preamble restore), which left
> the block below sitting inside §6 between the Round 14 and Round 15 entries. Restored here, at
> the position its own first line and the Round 9 entry ("see §7 below") both name. Content
> unchanged from the `ws3-tier3-failover` blob (`dedc3bf`), verified byte-identical.

### Rung 5c — out-of-process render isolation: **DEFER** (decided Round 9, 2026-09-10)

Deferred three times before this round (per Part 0's own framing); decided here, adopting
`docs/ws3-export/recovery-architecture.md` §6's own prior analysis as the authoritative
reasoning (that document reached the identical conclusion independently, with a fuller
two-shape cost comparison this entry summarizes rather than re-derives).

1. **Would it have prevented the frame-47,840 hang? No — confirmed, and the premise itself
   needs correcting.** That export was never actually hung: `docs/ws3-export/recovery-architecture.md`
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
   occlusion (the documented run-5 class, `docs/ws3-export/silent-gaps-diagnosis.md`, 223.6 s of
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
timer-starvation class documented in `docs/ws3-export/silent-gaps-diagnosis.md`'s run 5, confirming it
is a recurring failure mode rather than a one-off. Either observation reopens this decision;
absent one, it stays deferred.

---

### Round 18 (2026-09-11) — Crash audit remediation (PROMPT 24)

**Branch:** `ws3-crash-fixes` (from `ws3-export-integration` @ `78c104a`), merged into
`ws3-export-integration`. **Source of fixes:** `final-crash-audit` @ `d3b56c4` (F1–F3 code,
adopted and extended; doc merged separately). **Base main:** `4d4922c`. **Rollback:** `15002e5`.

#### F1–F6 disposition

| Finding | What it was | Fixing SHA(s) | Probe proving it |
|---|---|---|---|
| F1 — rewind truncate could race an in-flight append | `session_io_gate` (per-session `Arc<Mutex<()>>`) serializes append/truncate/checkpoint-repair/concat in `ffmpeg.rs`; JS-side `finishAfterInFlightAppends` drains the append queue before a rotation-flush rewind fires | `30e071e` (adopted), `4564bee` (drain-wait tightened) | `truncate_cannot_interleave_with_in_flight_append` (`ffmpeg.rs`) — see below for the self-correction on this probe's own validity |
| F2 — delivery copy not crash-atomic | `save_session_file` now copies to `dest.part`, `sync_all`s, `rename_over`s (atomic on Unix; backup-then-promote on Windows) | `30e071e` | `copy_session_file_atomic_*` (3 Rust tests, adopted from the audit) |
| F3 — resume-path native repair unbounded | `prepareCheckpointResume`/`truncateAnnexbToOffset` on the resume path wrapped in `withFfmpegLivenessBound(TRUNCATE_BOUND_MS)`, mirroring salvage | `30e071e` | `boundedRerenderWiring.test.ts`/`exportResumeDiscovery.test.ts` additions (adopted); this is also the Rung 3/Tier 2 closed-row gap named below |
| F4 — `TauriFfmpeg.kill()` swallowed invoke failures | `kill()` now throws; `withFfmpegLivenessBound`'s pre-existing `killed`/`killError` diagnostics fields can finally be populated; the two best-effort cancel callers (`cancelExportWebCodecs()`, `useExport.ts`'s cancel handler) catch-and-record via `recordCleanupFailure('session-kill', ...)` instead of silently swallowing | `0ce18d1` | Full vitest suite green with `kill()` now throwing (3572/0/78); no call site left unhandled |
| F5 | not named by the audit (F1–F3 blockers + F4/F6 residuals only) | — | — |
| F6 — concat output not fsynced | `concat_annexb_pieces_inner` calls `out.sync_all()` after `flush()`, matching append/truncate/write_file/manifest | `0ce18d1` | Existing `concat_annexb_pieces_*` Rust tests still pass; cost bound below |

#### STEP 2 — F1 review answers

1. **JS-side wait bound:** yes, but it was reusing `WATCHDOG_MS` (30s) for a wait that only needed
   to cover one ~512 KiB append round trip. **Safety argument, verified, not assumed:** the native
   `session_io_gate` is the actual correctness guarantee — a truncate command acquires the gate
   unconditionally as the first thing it does (confirmed by direct read of
   `ffmpeg_truncate_annexb_to_offset`), so an early expiry of the JS-side wait cannot let the
   truncate bypass the gate; it can only make the truncate block *in the Rust mutex* instead of in
   JS. Confirmed the gate-wait sits *inside* `TRUNCATE_BOUND_MS`'s coverage too: `ffmpeg_kill_session`
   sets the SAME per-session cooperative cancel flag both `append_file_raw_inner` and
   `truncate_annexb_to_offset_inner` poll (`set_session_cancelled`, `ffmpeg.rs:1584`), so if
   `TRUNCATE_BOUND_MS` itself expires while truncate is genuinely blocked on the gate, its own
   kill-on-expiry unsticks the wedged append within one 64 KiB chunk, which releases the gate. New
   **eighth constant**, `IN_FLIGHT_APPEND_DRAIN_BOUND_MS = 625` (`exportPipelineWebCodecs.ts:987`):
   derived, not picked — the worst on-record per-append latency (25ms, pathological/simulated,
   `architecture-ledger.md`'s own Round 16/17 cost table) × the same 25× headroom multiplier
   `TRUNCATE_BOUND_MS`/`KILL_BOUND_MS` were derived with. `625ms × 3` (2 rewinds + 1 failover,
   `MAX_BOUNDARY_REWINDS_PER_EXPORT = 2`) is a rounding error next to the old `30s × 3`.
2. **Gate deadlock:** no cycle. One mutex per session; every gated command acquires it exactly once
   and releases on return; `prepare_checkpoint_resume_inner` calls the ungated `truncate_annexb_inner`
   helper directly (not the gated command), so there is no reentrant acquisition anywhere in the
   call graph. The outer `io_gates: Mutex<HashMap<...>>` is held only long enough to fetch/insert
   the per-session `Arc`, never during I/O.
3. **Short-write detector:** unaffected. `append_file_raw_inner` calls `sync_all()` once, after all
   64 KiB chunks succeed; a mid-loop error or cancel returns `Err` for the WHOLE command, so the
   JS-side `sessionFileSize` comparison (`exportPipelineWebCodecs.ts:1877-1897`) — which only runs
   after `appendFileRaw` resolves `Ok` — never observes a partially-landed batch as a success.
4. **Per-append cost:** ~7 extra `write()` syscalls per 512 KiB batch (8 chunks vs. 1), fsync count
   unchanged (still one `sync_all` per batch). Bounded at low-single-digit microseconds per syscall;
   across a 2.3 GB export (~4,600 batches) that's well under 200ms total added wall-clock — three
   orders of magnitude below `TRUNCATE_BOUND_MS`. See the W7a addition below for the one place this
   assumption needs a real-hardware check rather than a bound.

**Stacking risk found and closed.** Before tightening, the wait could stack:
`WATCHDOG_MS` (detect) + `WATCHDOG_MS` (drain) + `TRUNCATE_BOUND_MS` (172.7s) ≈ 232.7s per hung
rewind cycle, up to 3 cycles (2 rewinds + 1 failover) = ~698s (11.6 min) of potential silent stall
with zero progress indication. Fixed two ways: (a) the drain wait is now `625ms` instead of `30s`
(saves up to ~89.6s of the 698s); (b) `ExportStage` gained a `'recovering'` variant
(`exportPipeline.ts`), emitted the moment a rotation-flush rewind is about to run its
`TRUNCATE_BOUND_MS`-bounded truncate — the dominant ~172.7s of any remaining stall. **Confirmed it
reaches the UI through every consumer, not just the type:** `useExport.ts`'s `stageLabelFor`
("Recovering segment N / M…") and `progressFor` (holds at the piece's own start-of-segment
percentage rather than dropping to 0) both handle it; the emission site
(`exportPipelineWebCodecs.ts`, right where `isRotationFlushTimeout` is first true) has `onProgress`
and `pieces`/`pieceIndex` in scope from the enclosing per-piece loop, not synthesized.

#### STEP 3 — `.part` path length

`checkExportDestinationPathLength` now validates `destPath.length + '.part'.length` (5) against
`WINDOWS_MAX_PATH` (260), since `save_session_file`'s delivery path constructs that longer path
before ever touching the operator's chosen name. **Effective limit for the operator's own path:
260 → 255 characters.** Still reported at `startExport()`, before any rendering begins — call site
unchanged (`useExport.ts` ~745). Destructive probe added: a path the old check accepted (< 260,
`.part` form 260–264) is now rejected — `exportDestinationPath.test.ts`.

**Windows `rename_over` fallback — worked through, not waved past.** Unix: single `fs::rename`
syscall, POSIX-atomic replace, no intermediate window. Windows (only on the fallback branch, when
a bare `fs::rename(part, dest)` fails because `dest` exists): backup-then-promote — remove any
stale `.bak`, rename `dest → dest.bak`, rename `part → dest`. **If the process dies between those
two renames:** `dest` does not exist under its own name; `dest.bak` holds the pre-existing file's
original bytes, untouched (rename doesn't touch content); `dest.part` holds the new export's
bytes, already fsynced complete. **Both the old and new files are fully recoverable — a rename
away, not gone** — but nothing in this codebase auto-detects or reconciles a `.bak`/`.part` leftover
pair on next launch (checked: no such logic exists anywhere `.bak`/`.part` appear in
`src-tauri/src/`). This is a real, honest gap: recoverable manually, not recovered automatically.
Recorded here rather than fixed, since building that reconciliation is new scope beyond F2.

#### STEP 4 — F4 and F6

**F6:** `concat_annexb_pieces_inner` now calls `out.sync_all()` after `flush()` — `flush()` on a
raw `fs::File` is a no-op (no userspace buffering to flush; all durability work is in `sync_all`).
**Cost against `CONCAT_BOUND_MS` (60,000ms, ~94× the measured 0.64s worst-case 1.7GB stream-copy):**
the original measurement never included an fsync. A GB-scale fsync on local SSD, most bytes already
written incrementally by the preceding `write_all` loop, typically completes in low single-digit
seconds — comfortably inside the 60s bound's ~94× headroom even before accounting for it.

**F4:** `TauriFfmpeg.kill()` throws instead of swallowing. `withFfmpegLivenessBound`'s expiry
handler already had `killed`/`killError` diagnostics fields built for exactly this — they could
never be populated before, because the failure died inside `kill()` before reaching that race.
Two best-effort cancel-path callers (`cancelExportWebCodecs()`, `useExport.ts`'s `cancelExport`)
now catch, `console.warn`, and `recordCleanupFailure('session-kill', ...)` — same durable-notice
posture `destroy()` already has (STEP 8, C6) — rather than disappearing. New `'session-kill'`
`CleanupNoticeKind`; `TauriBackend`/`WebCodecsFfmpeg` gained the `sessionId` plumbing needed to
attribute the notice. Also fixed: `FfmpegKillHungError`'s message rendered `KILL_BOUND_MS` (125ms)
as "0s" (`Math.round(125/1000) = 0`) — now reports milliseconds.

#### STEP 5 — Re-proof

**Byte neutrality, Arm A: exact match.** Regenerated Arm A's fixtures from the test file's own
documented command; input digests matched Round 16's recorded `216592e8…9b95` (h264) /
`9bd76648…6c5d` (wav) exactly, confirming the command is genuinely byte-deterministic.
`export_final.mp4` on the fixed tree: `5bef695552b82311c95c4dbad410c6755c0820a220a2e7519a3caf4f3748f06c`
— **identical to Round 16's recorded digest.**

**Byte neutrality, Arm B: differential proof, not a fixed-anchor match.** Round 16's Arm B fixture
has no recorded generation command anywhere in the docs (a record defect, fixed this round —
see `scripts/ws3-clean-path-artifact.test.ts`'s header). Regenerating it from the same
`-threads 1` command that reproduced Arm A exactly reproduced the WAV bit-for-bit
(`5d2557e9…6285`, a pure function of frequency/rate/duration — no encoder involved) but NOT the
H.264 (`89a16a32…3d69` expected, `f4e8752b…6309` got), despite identical frame count and identical
thread-pinning flags. **Conclusion: Round 16's original Arm B fixture was generated without
pinning threads (or on a differently-configured encoder), so libx264's slice/row-threading
partitioning — machine/core-count-dependent when unpinned — was never reproducible off that
specific box.** It was never a valid fixed byte-neutrality anchor; only Arm A's documented command
is. Byte neutrality is a DIFFERENTIAL property (same input through two code versions), not a match
against a recorded digest, so this doesn't touch the actual claim: ran the newly-regenerated,
internally-reproducible Arm B fixture (1280×720, 2 pieces, field profile) through BOTH `78c104a`
(pre-fix) and the F1–F6 head. **Every digest matched exactly** — `export_final.mp4`
`d0be77fdd72edf956fa94a2b257f88d0ef8e67923a531e6a39adc0b3ff7e5db8`, `video_all.h264`
`f4e8752b75a9d92e19c9d71201760d4402f976bdfc5b11dac649417448bf6309` at both, plus every intermediate
— and even the call trace matched exactly (216 `appendFileRaw`, 217 `sessionFileSize`, 1
`concatAnnexbPieces`, etc., identical between the two commits). F1's chunking/gating perturbs
nothing on the clean path.

**512 KiB cost recomputation.** F1's chunking happens INSIDE one Rust command — still exactly one
`invoke()`/IPC round trip per 512 KiB batch, same batch count (2,581 for the field export) as
before. **The IPC-round-trip math behind 1.29s/32.0s/64.5s (0.28%/6.96%/14.0% at 0.5/12.4/25ms) is
therefore unchanged** — no new round trips were added, only ~7 extra in-process `write()` syscalls
per batch (STEP 2's bound: negligible). **New consideration this round surfaces, not resolved by
it:** if the still-NOT-DETERMINED W7/H4 Windows Defender cost is ultimately found to be per-`write`
rather than per-`close`, chunking multiplies it ~8× (12.4ms → ~99ms/append, 6.96% → ~56% — not a
rounding difference). Recorded as its own row, **W7a**, in `windows-validation.md` with the
multiplier named explicitly, since that's the file real-hardware verification actually works from.

**The F1 scenario itself — destructive probe, and a real self-correction.** First version of
`truncate_cannot_interleave_with_in_flight_append` (spawn an append thread, poll until ≥1 chunk
landed, take the gate, `.join()` the append, assert full length) passed even when deliberately
pointed the "truncate" side at a DIFFERENT session's gate — simulating exactly the bug class F1
fixes. Root cause: `.join()` blocks until the append finishes regardless of whether anything
actually serialized it, so the assertion was true no matter what. Rewrote to check the file length
the INSTANT the gate is acquired, before any join — reliably red (3/3, observed `196608` of
`134217728` expected bytes) with the gate broken, reliably green (3/3) with it correct. This is
the standard CLAUDE.md's own testing-reach invariant asks for (a probe validated by breaking the
thing it claims to guard, not trusted on a green run) — applied here to a test *written this
round*, not just cited from precedent.

#### STEP 6 — Ledger discrepancies

**W2 resolved in place** (`windows-validation.md`). The row claimed "confirm the pre-encode check
passes (it allows ≤ 32,767)" and named `std::fs::copy` as the tested path — both wrong for this
repo. `checkExportDestinationPathLength` deliberately enforces 260 (255 after this round's `.part`
fix), documented at `windows_long_path`'s own definition as intentional fast-feedback/defensive-net,
never an attempt to express the real Win32 extended-length ceiling; `save_session_file` hasn't
called `std::fs::copy` since F2 replaced it with `copy_session_file_atomic`. Rewrote W2 to exercise
the real `\\?\` prefix via direct IPC (bypassing the pre-check, same technique W3 already uses) and
to separately confirm the pre-check still rejects the same path for a normal export — that
rejection is the intended UX, not the bug.

**Rung 3 / Tier 2 closed-row discrepancy — said plainly, not quietly fixed.** The ledger's Rung 3
row ("LANDED") and Tier 2 row ("COMPLETE... nothing left open") both predate this round. F1 found
the rewind truncate could run concurrently with a still-in-flight append with nothing serializing
them — `recoveryMatrix.test.ts`'s nine rows verify decision/dispatch correctness (which recovery
policy fires for which failure shape), never concurrent native I/O safety, so a real interleaving
defect sat inside an already-closed row. Both rows corrected in place with the discrepancy stated,
not silently patched around.

**Closed-row recheck result:** checked every other Tier 2 row (2b, 4) against the same question —
does its recovery path run a native mutation concurrently with another in-flight one from the LIVE
process. Neither has Rung 3's shape. Rung 2b's forced seal runs after the guard's own frame count,
never concurrently with a writer. Rung 4's resume starts in a FRESH process after the old one
crashed — there is no live in-flight append from a dead process to race. No other row shares the
defect class; this is a Rung-3-specific gap, not a systemic one.

#### STEP 7 — Merge, ledger, gates

Merged `ws3-crash-fixes` into `ws3-export-integration` (`5d06851`, clean, zero conflicts). Merged
`docs/ws3-export/final-crash-audit.md` from `final-crash-audit` (doc only — its code was already
adopted and extended on `ws3-crash-fixes`) as the eighth WS3 content doc; recorded the second cap
amendment (WS3 ≤7 → ≤8) in `docs/README.md` (`0b2af15`), as the audit doc asked for and correctly
left undone itself.

**Gates, run directly, raw tails:**

| Gate | Result | Reconciliation |
|---|---|---|
| `npx tsc --noEmit` | clean, zero errors | Fixed one real error in the ADOPTED F3 code along the way (see below) |
| `npm run lint` | clean (= `tsc --noEmit` in this repo) | — |
| `npm test` × 2 | **3572 passed, 0 failed, 78 skipped = 3650**, identical both runs | Baseline 3569/0/78=3647 + 3 new tests (1 each in `boundedRerenderWiring.test.ts`, `exportResumeDiscovery.test.ts` from the adopted F1–F3, 1 in `exportDestinationPath.test.ts` from STEP 3) = 3572. Exact. |
| `cargo test` | **314 passed, 0 failed, 6 ignored** | Baseline 307/0/6 + 7 new tests (6 adopted from F1/F2's Rust tests + 1 `truncate_cannot_interleave_with_in_flight_append`) = 314. Exact. |
| `cargo test --features fa-inference -- --test-threads=1` | **400 passed, 0 failed, 36 ignored** | Baseline 393/0/36 + the same 7 = 400. Exact. |
| Seven frozen constants | Verbatim, re-read from source: `WATCHDOG_MS` 30_000 · `FORWARD_PROGRESS_BOUND_MS` 45_000 · `FLUSH_BOUND_MS` 20_000 · `APPEND_DRAIN_BOUND_MS` 600_000 · `TRUNCATE_BOUND_MS` 172_675 · `KILL_BOUND_MS` 125 · `APPEND_BATCH_BYTES` 524_288 (512 KiB) | Unchanged by every fix this round |
| Eighth constant | `IN_FLIGHT_APPEND_DRAIN_BOUND_MS = 625` (`exportPipelineWebCodecs.ts:987`) | Stated explicitly as an ADDITION, derivation in STEP 2 above |
| Four named fixture digests | Unchanged | `scripts/fixtures/` — zero files touched by any commit this round (`git diff 78c104a...HEAD --stat -- scripts/fixtures/` is empty), so trivially unchanged |
| Byte-neutrality digests | Both re-proven — Arm A exact match to Round 16's recorded digest, Arm B exact differential match (`78c104a` vs. F1–F6 head, freshly regenerated fixture) | See STEP 5 above |
| `git status --porcelain` | Clean apart from `node_modules`/`public` | — |

**A note on what "targeted tests" meant.** The cherry-picked F3 code (`exportResumeDiscovery.ts`,
wrapping `session.truncateAnnexbToOffset(pieceFile, checkpoint.seamByteOffset)` in a new closure
passed to `boundedTruncate`) carried a real `tsc` error: TypeScript does not retain a property
narrow (`typeof checkpoint.seamByteOffset === 'number'`) through a nested arrow function, so the
closure saw `number | undefined` again. `final-crash-audit`'s own doc claims 33/33 vitest passing
on the touched files — true, but vitest doesn't type-check, and this error would have surfaced on
the very first `tsc --noEmit` anyone ran against that branch. Fixed by hoisting the narrowed value
to a local `const` before the check (`exportResumeDiscovery.ts`). Recorded here because "targeted
tests passed" is weaker evidence than it reads when the targeted tests never included the
type-checker.

**Disposition rows updated this round:** Rung 3 (Rung table, §1), Tier 2 (Tier table, §2) — both
in place with the Round 18 correction inline, per STEP 6 above. F4/F6 close two of the four
residuals `final-crash-audit.md` itself lists as open at merge time; F1's stacking risk and the
Rung 3 interleaving gap are new findings this round, not residuals the audit already knew about.

**No merge to main. No PR.** Pushed `ws3-export-integration`, `ws3-crash-fixes`, `final-crash-audit`.

### Round 19 (2026-09-12) — First Windows compile (PROMPT 25)

Branch `ws3-windows-build-fix`, cut from `ws3-export-integration` @ `a5f352e`; rollback `15002e5`.
No merge to main, no PR.

#### STEP 0 — The feedback loop: `.github/workflows/windows-check.yml`

Until this round nothing ever compiled a `#[cfg(windows)]` block: `build.yml` is
`workflow_dispatch`-only and costs ~7 minutes, and every local gate runs on macOS. The new job runs
`cargo check --all-targets --locked` on `windows-latest` in two cells (feature-off, `--features
fa-inference` — the shipped installer's cell) and nothing else: no bundling, no signing, no `npm ci`.
Sidecars are empty placeholders (`ffmpeg-<triple>.exe`, `whisper-<triple>.exe`), the same trick
`fa-ort-matrix.yml` uses, because `tauri-build` hard-fails any cargo invocation when an
`externalBin` path is missing. Triggers: `workflow_dispatch`, PRs and pushes to `main`/`ws3-**`
touching `src-tauri/**`. A final step prints the count of remaining `warning:` lines.

**Reach was established destructively, not by a green run.** The first dispatch ran against the
pre-fix tip (`a5f352e` + workflow commit) and went RED on both cells
(https://github.com/mohtashim9119-web/kinetix-pro-studio/actions/runs/34636558113) with
`E0308` ×2 at the two `GetProcessTimes` sites, plus — **not in the brief** — `E0433`/`E0599` in
`project_mirror.rs` (see STEP 2). The post-fix run went green on both cells with **0 warning lines**
(https://github.com/mohtashim9119-web/kinetix-pro-studio/actions/runs/34637227561).

Local cross-check was tried and abandoned inside the brief's time box: `rustup target add
x86_64-pc-windows-msvc` + `cargo check --target x86_64-pc-windows-msvc` gets as far as
`tauri-build`'s `build.rs`, which panics in `tauri-winres` with `NotAttempted("llvm-rc")` — the
Windows resource compiler isn't in Xcode's toolchain and Homebrew's only ships it inside the full
`llvm` formula. CI is the loop.

#### STEP 1 — The two `GetProcessTimes` sites, `src-tauri/src/session_claim.rs`

**Before** (both `process_start_time_ms` at ~139-144 and `is_holder_process_live` at ~226-231,
byte-for-byte duplicates apart from the handle source):

```rust
let mut creation = MaybeUninit::<i64>::uninit();
let mut exit     = MaybeUninit::<i64>::uninit();
let mut kernel   = MaybeUninit::<i64>::uninit();
let mut user     = MaybeUninit::<i64>::uninit();
let ok = GetProcessTimes(proc, creation.as_mut_ptr(), exit.as_mut_ptr(),
                         kernel.as_mut_ptr(), user.as_mut_ptr());   // E0308: *mut i64, wants *mut FILETIME
let filetime = creation.assume_init();
const EPOCH_DIFF_100NS: i64 = 116_444_736_000_000_000;
return ((filetime - EPOCH_DIFF_100NS) / 10_000).max(0) as u64;
```

**After** — one call site. `windows_process_times(handle) -> Option<WindowsProcessTimes>` owns the
four real `FILETIME` values (`&mut creation, &mut exit, &mut kernel, &mut user`) and
`filetime_to_unix_ms(&FILETIME) -> u64` does `((hi as u64) << 32 | lo as u64)
.saturating_sub(116_444_736_000_000_000) / 10_000`. Both former sites now call the helper:

- `process_start_time_ms` (self): `GetCurrentProcess()` pseudo-handle → helper → `creation_unix_ms`,
  falling back to `now_ms()` if the call fails. No `OpenProcess`, no `CloseHandle`.
- `is_holder_process_live(pid, start)` (foreign): `OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION)`
  → helper → `abs_diff(start) <= 2_000`. Every "cannot verify" branch now resolves to **live**, never
  stale: `OpenProcess` failing with `ERROR_ACCESS_DENIED` (process exists under another user /
  elevated), `GetProcessTimes` failing on a valid handle, or a recorded `start == 0`. Only a PID
  that does not exist (`OpenProcess` fails with anything else) or a creation-time mismatch > 2 s
  (PID reuse) is stale. The exit-time `FILETIME` is deliberately NOT consulted: MSDN documents its
  content as undefined while the process runs, so "nonzero exit ⇒ stale" could steal a live holder.

**Claim-file compatibility — the answer.** `session_claim.json` persists
`holder_start_time_ms: u64` = milliseconds since the Unix epoch, and the reconstruction produces
exactly the number the broken code *intended*: `(FILETIME_100ns − 1601→1970 offset) / 10_000`. The
only differences are (a) the `i64` subtraction that could go negative is now a `u64`
`saturating_sub` (same result for every post-1970 value, 0 instead of `.max(0)` for pre-1970) and
(b) the hi/lo dwords are combined explicitly instead of reinterpreting an `i64`. **The persisted
format does not change.** Beyond that, there is no legacy population to protect: this arm never
compiled, so no Windows build has ever written a claim file with a Windows-derived value. The
`start == 0 ⇒ cannot verify, assume live` branch is still added, as the brief asked, so an
unparseable/absent start time can never make a live session look stale.

**The `AsRawHandle` finding.** `use std::os::windows::io::AsRawHandle` at line 124 was unused, and
the local named `handle` was `std::process::id()` — a **PID**, not a handle. That was fine by
accident: `OpenProcess` takes a PID, so the call was opening a real handle to the current process
with `PROCESS_QUERY_LIMITED_INFORMATION`, which is sufficient for `GetProcessTimes`. The import
looks like a leftover from an earlier draft that derived the handle from `Child`/`File` (neither
applies to the current process — there is no `AsRawHandle` for "self"). The code was NOT passing a
bad handle; it would have returned a real creation time had it compiled. Rewritten to
`GetCurrentProcess()` anyway, which removes the misnamed local, the `OpenProcess` failure branch and
the `CloseHandle` for the self path.

**`lib.rs:247`** — `MenuItem`/`MenuItemKind` were imported at function scope but used only inside
the `#[cfg(target_os = "macos")]` block; the `use` moved into that block.

**Tests added** (`session_claim::tests::windows_start_time`, `#[cfg(windows)]`): known FILETIME
vectors (1970 epoch → 0, 2000-01-01 → 946 684 800 000, pre-1970 → 0); own start time stable across
reads, ≤ now, < 1 h old; `is_holder_process_live` true for (own PID, own start), **false for (own
PID, start + 1 h)** — the PID-reuse case — true for (own PID, 0), false for PID 4 000 000. These are
COMPILED by the check job (`--all-targets`) and RUN only by a real Windows `cargo test` — see the
new row in `windows-validation.md`.

#### STEP 2 — The full platform-gated inventory, `src-tauri/**`

Every `#[cfg(...)]` naming `windows`/`unix`/`macos`/`linux` (`grep -rn 'cfg(' src tests build.rs`),
plus the runtime `cfg!(target_os = "windows")` sites. "Compiles" = green on run 34637227561.

| File:line | Gate | What it does | Compiles on Windows | Ever exercised by a test |
|---|---|---|---|---|
| `session_claim.rs:97` / `:199` | `unix` | `/proc/<pid>/stat` starttime + `kill(pid,0)` liveness | n/a (unix) | YES on macOS via `claim_contention…`, `stale_claim_recovery…` — **but see the macOS finding below** |
| `session_claim.rs:121` / `:229` | `windows` | the two fixed sites above | **YES (was NO)** | Compiled only; 3 new `#[cfg(windows)]` tests exist, never run |
| `session_claim.rs:138,147,162` | `windows` | `WindowsProcessTimes`, `filetime_to_unix_ms`, `windows_process_times` (new) | YES | Compiled only (same 3 tests) |
| `session_claim.rs:132` / `:258` | `not(any(unix,windows))` | fallbacks | n/a | never (no such target) |
| `session_claim.rs:182` | `unix` | `boot_time_epoch_ms` via `/proc/stat` | n/a | Linux only in practice; on macOS returns `None` |
| `session_claim.rs:403` (`classify_remove_outcome`) + `:493-499` | none (runtime) | `pending_delete` classification from `ee406dd` | YES | Pure function: 4 tests (`pending_delete_is_never_classified_as_deleted` etc.). The NTFS race itself: W1, unverified |
| `lib.rs:254` | `macos` | deferred-Quit menu rewrite | n/a | manual only |
| `lib.rs:434` | `all(windows, debug_assertions)` | `open_devtools()` on the main window | YES | never (dev-build side effect) |
| `ffmpeg.rs:119` | `windows` | `raw_os_error() == 112` (`ERROR_DISK_FULL`) → disk-full | YES | `StorageFull` kind branch tested (`ffmpeg.rs:3129`); the `112` branch never |
| `ffmpeg.rs:1676-1707` | none (`cfg!` runtime) | `apply_windows_long_path_prefix` / `windows_long_path` from `e9355a2` | YES | Prefix RULE: 5 tests (`:3506-3539`). Real Win32 honouring of `\\?\`: W2/W3, unverified |
| `ffmpeg.rs:2005` / `:2012` | `macos` / `windows` | `reveal_in_finder` → `open -R` / `explorer /select,` | YES | never on either platform |
| `whisper.rs:597` | `windows` | resource_dir `_up_` parent fallback for the model path | YES | never |
| `fa_onnx.rs:432` / `:443` | `windows` / `not(windows)` | `augment_ort_load_error` MSVC-runtime hint | YES | never (the string is never asserted) |
| `fa_onnx.rs:1919…7611` (16 pairs) | `macos` / `not(macos)` | `fa_models_dir()` in `#[ignore]`d corpus-measurement test modules; the non-macOS arm `panic!`s | YES (compiles; the panic is only reached under `--ignored`) | macOS only, and only with a private corpus |
| `project_mirror.rs:399` | was **ungated** | inode-identity test using `std::os::unix::fs::MetadataExt::ino()` | **was NO** (`E0433`/`E0599`) → now `#[cfg(unix)]` | YES on macOS; on Windows the replace-not-truncate property is now simply unasserted (`file_index()` is nightly-only) |

**Coverage gaps this round names and does not fix:** `reveal_in_finder` (both arms),
`whisper.rs:597`, `augment_ort_load_error`, `ffmpeg.rs:119`'s `112` branch, `lib.rs:434`, and the
three new Windows tests that have never executed. All are compile-verified only.

**macOS finding, out of this round's scope but recorded because the inventory surfaced it:** the
`#[cfg(unix)]` arm is really a *Linux* arm. macOS has no `/proc`, so on macOS
`process_start_time_ms()` always falls through to `now_ms()` and `is_holder_process_live` returns
`true` for any existing PID (the "unreadable → live" branch). PID-reuse detection therefore does
not exist on macOS today; the instance-UUID (`holder_instance_id`) is what actually distinguishes
same-PID holders there. Safe direction (never steals), but weaker than the struct's doc comment
claims. Needs `sysctl(KERN_PROC)`/`proc_pidinfo` to close; not started.

#### STEP 3 — Gates

| Gate | Result |
|---|---|
| Windows `cargo check --all-targets` (feature-off / fa-inference) | **green / green, 0 warnings** — run 34637227561 |
| Windows bundle build (`build.yml`, `-f fa-inference`) | see the closing line of this entry |
| macOS `cargo check --all-targets` | clean, 0 warnings |
| `npx tsc --noEmit` / `npm run lint` | clean / clean |
| `npm test` | **3572 passed, 0 failed, 78 skipped = 3650** — unchanged (no TS touched) |
| `cargo test` | **314 / 0 / 6** — unchanged; the 3 new tests are `#[cfg(windows)]` and the gated `project_mirror` test still runs on macOS |
| `cargo test --features fa-inference -- --test-threads=1` | **400 / 0 / 36** — unchanged |

**Windows bundle build:** `build.yml` dispatched on `2aba548` — **green on both matrix legs**
(windows-latest `x86_64-pc-windows-msvc` MSI+NSIS and macos-latest universal DMG),
https://github.com/mohtashim9119-web/kinetix-pro-studio/actions/runs/34637659903. The first Windows
installer this branch has ever produced.

**No merge to main. No PR.** Pushed `ws3-windows-build-fix`.

### Round 20 (2026-09-12) — Windows fsync access denied (PROMPT 26)

Branch `ws3-windows-fsync-fix`, cut from `ws3-export-integration` @ `1abe9a1` (the integration
head after fast-forwarding `ws3-windows-build-fix` @ `5825dc9` and folding in the Round 19
carry-overs); rollback `15002e5`. No merge to main, no PR.

**Field report, machine 1.** 1080p30, 354 segments, voiceover present. Export reached 40,374 of
40,384 frames; the sealing offer fired and was accepted; the mux stage then failed with
`write_file(voiceover_audio): sync_all: Access is denied. (os error 5)`. macOS passed the same
project.

**Field report, machine 2 (arrived mid-round).** 167 segments, 1080p30, voiceover present. Failed
on the FIRST frame of segment 0 on the canvas/PNG segment path (`segv1_…`):
`kind: encode, segmentIndex: 0 — write_file_raw(frame_00001.png): sync_all: Access is denied.
(os error 5)`. Deterministic, not a race — which rules out a Defender timing window as the
primary cause and, together with machine 1's 40,374 successful appends, gives the discriminator:
the append path's handle survives `FlushFileBuffers`; the `write_file`/`write_file_raw` handle
does not. Both installers were built from `5825dc9`. Machine 3 pending — **no rebuild until it
reports**, so all three results come from the same binary.

#### STEP 1 — Root cause, with evidence

The failing call is `ffmpeg.rs`'s `sync_session_file` — the ONE function behind both field
failures. `ffmpeg_write_file` (machine 1, base64 body, `voiceover_audio`) and
`ffmpeg_write_file_raw` (machine 2, raw IPC body, `frame_00001.png`) differ only in transport;
each does `fs::write(&full, bytes)` and then calls it with the same arguments:

```rust
fn sync_session_file(path: &Path, label: &str) -> Result<(), String> {
    let file = fs::File::open(path)…;   // Win32: CreateFileW(GENERIC_READ)
    file.sync_all()…                     // Win32: FlushFileBuffers(handle)
}
```

`File::open` maps to `GENERIC_READ` only. `FlushFileBuffers` requires write access on the handle
and returns `ERROR_ACCESS_DENIED` (5) otherwise. `fsync(2)` on an `O_RDONLY` descriptor succeeds
on macOS and Linux — which is exactly why the same project passed on macOS and why nothing in the
repo's test suite had ever seen this. The file pre-exists (just written by `fs::write`), is under
the session dir in `%TEMP%`, and nothing else in-process holds a handle to it: `fs::write`'s
handle is closed before `sync_session_file` opens its own.

**Ranking against the code, not plausibility:**

| Hypothesis | Verdict | Evidence |
|---|---|---|
| Handle opened without write access, `FlushFileBuffers` refuses | **Confirmed — the cause** | (1) The error string's shape `{label}: sync_all: {e}` is emitted at exactly one site, `sync_session_file`, and only from the `sync_all` arm — the open arm would read `open for sync:`, and a failed `fs::write` would read `write_file(voiceover_audio): Access is denied` with no `sync_all`. So the write succeeded, the read-only open succeeded, and `FlushFileBuffers` alone failed. (2) The first Windows execution of the existing `cargo test` suite (integration run 34647026774, the Round 19 carry-over's first run) reproduced the identical failure at a SECOND site with no voiceover involved: `copy_session_file_atomic_does_not_touch_dest_until_complete` failed with `copy_session_file dest: sync_all: Access is denied. (os error 5)` — the post-rename `sync_session_file(dest)` in the delivery path. (3) The new `#[cfg(windows)]` probe `read_only_handle_cannot_flush_file_buffers` pins `File::open(p).sync_all()` → `raw_os_error == 5` on windows-latest. |
| `.append(true)` maps to `FILE_APPEND_DATA` without `FILE_WRITE_DATA` and `FlushFileBuffers` refuses it | **Ruled out by the field reports — and the direction is the reverse** | The brief's discriminator is right (append survives, `write_file`/`write_file_raw` do not) but the mechanism it names is inverted: the append handle is the one WITH a write right (`FILE_APPEND_DATA`), and `append_file_raw_inner` ends every 512 KiB batch with `sync_all` on it — 40,374 machine-1 frames = thousands of successful `FlushFileBuffers` calls on exactly that handle shape. The failing handles have NO write right at all: `sync_session_file` opened them with `File::open` (`GENERIC_READ`), which neither `write_file` nor `write_file_raw` shares with the append path. Machine 2 failing on frame 1 of segment 0 confirms it is the open, not timing. Pinned by `append_only_handle_can_flush_file_buffers` (green on windows-latest, run below). |
| Defender scan-on-close holding the file (W7) | Not this failure | A scan-on-close hold surfaces as `ERROR_SHARING_VIOLATION` (32) on the next *open*, not `ERROR_ACCESS_DENIED` on `FlushFileBuffers` of an already-open handle; and the open here succeeded. Remains a real external-hold class — covered by the STEP 3 retry policy, not by the STEP 3 open fix. |
| Controlled Folder Access on the destination | Not this failure | CFA denies the *open-for-write* (and `fs::write` would have failed first); the session dir is under `%TEMP%`, not a protected folder; the delivery path was never reached. Same retry/degrade coverage as above. |
| File open elsewhere in-process / in the WebView | Not this failure | `fs::write` closes its handle before `sync_session_file` opens; the WebView never touches the session dir (raw-body IPC lands bytes natively). A concurrent opener with `FILE_SHARE_*` would not deny a flush anyway. |
| Read-only attribute from a prior attempt | Not this failure | Would have failed `fs::write` (the create/truncate open), not the flush; the session dir is fresh per export. |

No Windows machine was needed to distinguish: hypothesis 1 is the only one that fails at
`FlushFileBuffers` on a handle that was just successfully opened, and CI run 34647026774 executed
the reproduction on real Windows.

#### STEP 2 — `sync_all` / open-flags audit, `src-tauri/**`

Every `sync_all` in the crate, with the `OpenOptions` behind its handle and whether
`FlushFileBuffers` can legally succeed on it under Win32 semantics. "Latent" = same bug as the
field failure. "Site fixed" refers to STEP 3.

| # | Site (`file:fn`) | Handle came from | Win32 access on handle | `FlushFileBuffers` legal? | Status before | After Round 20 |
|---|---|---|---|---|---|---|
| 1 | `ffmpeg.rs:sync_session_file` ← `ffmpeg_write_file` (the field failure, `voiceover_audio`; also canvas-tier `export_piece_N.mp4` bytes) | `fs::File::open(path)` | `GENERIC_READ` | **No — ERROR_ACCESS_DENIED** | **LATENT — the failure** | `durable_fs::fsync_path_bounded`: `OpenOptions::write(true)` (no create/truncate) → `GENERIC_WRITE`; bounded retry; `Unconfirmed` degrades (recorded, command returns Ok) |
| 2 | `ffmpeg.rs:sync_session_file` ← `ffmpeg_write_file_raw` (**machine 2's failure**, `frame_00001.png`) | same as 1 | `GENERIC_READ` | **No — ERROR_ACCESS_DENIED** | **LATENT — the second field failure** | same as 1 |
| 2a | **Canvas/PNG segment path** (`segv1_*`, the second export route): `segmentEncoder.ts` per-frame `writeFileRaw(frame_%05d.png)` (pooled encoder) / `writeFile` (fallback), `writeFile(src_*.mp4)` for the plain-video source, and `encodeCanvasPiece` in the WebCodecs orchestrator; legacy `exportPipeline.ts` `writeFile` for segment MP4s, the concat manifest and the voiceover | all resolve to sites 1 and 2 — no other native write command exists | as 1/2 | as 1/2 | **LATENT — every canvas-path export fails on its first frame on Windows** (machine 2) | covered by the fix to 1/2; no separate site |
| 3 | `ffmpeg.rs:sync_session_file` ← `ffmpeg_truncate_annexb` (salvage) | same as 1 | `GENERIC_READ` | **No** | **LATENT** — every Windows salvage/rewind would have failed after the truncate landed | same as 1 |
| 4 | `ffmpeg.rs:sync_session_file` ← `ffmpeg_truncate_annexb_to_offset` (Rung 3 rewind) | same as 1 | `GENERIC_READ` | **No** | **LATENT** | same as 1 |
| 5 | `ffmpeg.rs:sync_session_file` ← `ffmpeg_prepare_checkpoint_resume` (durable resume fence) | same as 1 | `GENERIC_READ` | **No** | **LATENT** — every Windows resume would have failed at the fence | same as 1 |
| 6 | `ffmpeg.rs:copy_session_file_atomic` — post-rename `sync_session_file(dest)` (**F2 delivery — the priority**) | same as 1 | `GENERIC_READ` | **No** | **LATENT — every Windows delivery.** Reproduced on windows-latest by the pre-existing test (run 34647026774). The `.part` was fully written, fsynced and promoted by rename; the command then returned `Err`, `useExport` reported "Failed to save the exported file to disk", and the bytes sat at `dest` unacknowledged. | same as 1; outcome carried into `SaveSessionFileResult` — never an `Err` for an unconfirmed flush of a complete file |
| 7 | `ffmpeg.rs:copy_session_file_atomic` — `.part` `output.sync_all()` | `fs::File::create(&part)` | `GENERIC_READ \| GENERIC_WRITE` | Yes | OK (external-hold class only) | `durable_fs::fsync_file_bounded`; `Unconfirmed` proceeds to the rename and is reported |
| 8 | `ffmpeg.rs:append_file_raw_inner` (per 512 KiB batch) | `OpenOptions::create(true).append(true)` | `FILE_GENERIC_WRITE & !FILE_WRITE_DATA` = `FILE_APPEND_DATA \| FILE_WRITE_ATTRIBUTES \| FILE_WRITE_EA \| STANDARD_RIGHTS_WRITE \| SYNCHRONIZE` | Yes — proven by 40,374 field frames and the new probe | OK | Unchanged. A per-batch external hold surfaces as a hard append error, which the per-append size verify and Rung 3 already handle; degrading here would flood warnings on the hot path. |
| 9 | `ffmpeg.rs:ffmpeg_write_export_state` — manifest temp | `fs::File::create(&temp)` | `GENERIC_READ \| GENERIC_WRITE` | Yes | OK | Unchanged, still a HARD error: the crash-safe manifest contract depends on the temp being durable before the rename; an unconfirmed manifest must not be promoted |
| 10 | `ffmpeg.rs:concat_annexb_pieces_inner` (**F6 concat output**) | `fs::File::create(out_full)` | `GENERIC_READ \| GENERIC_WRITE` | Yes | OK | `durable_fs::fsync_file_bounded`; `Unconfirmed` recorded, concat returns Ok (the picture-count guard still runs on the bytes) |
| 11 | `session_claim.rs:write_claim_record` — claim temp | `fs::File::create(&temp)` | `GENERIC_READ \| GENERIC_WRITE` | Yes | OK | Unchanged, hard error (a claim that is not durable must not be promoted) |
| 12 | `project_mirror.rs:write_atomic` — mirror temp | `fs::File::create(&tmp)` | `GENERIC_READ \| GENERIC_WRITE` | Yes | OK | Unchanged |
| 13 | `model_download.rs` — `.part` after body end | `OpenOptions::create(true).write(true).truncate/append(resumed)` | `GENERIC_WRITE` (or `FILE_APPEND_DATA` set when resumed — see #8) | Yes | OK | Unchanged |
| 14 | `models.rs:import_to_target` — `.part` before validate/rename | **`File::open(&part_path)`** | `GENERIC_READ` | **No — ERROR_ACCESS_DENIED** | **LATENT — model import would fail on every Windows machine** | `durable_fs::fsync_path` (write-access open); still a hard error — an import is cheap to retry and nothing has consumed the bytes |

Six latent sites (1–6, one function), one more in a different subsystem (14). Every site that
fsyncs by path now goes through `durable_fs::open_for_fsync`; there is no remaining
`File::open(..).sync_all()` in the crate (`grep -n "sync_all" src-tauri/src/*.rs` is the check).

**What the delivery failure would have looked like in the field.** Site 6 runs after the export
is complete and the bytes are at the operator's chosen path. Every Windows export — with or
without a voiceover, forced-sealed or not — would have ended in "Failed to save the exported file
to disk. … completed export remains at `%TEMP%\kinetix-export-<uuid>\export_final.mp4`", with a
byte-identical copy already sitting at the destination. Machine 1 never reached it only because
site 1 fired first.

#### STEP 3 — Fix and degradation policy

New module `src-tauri/src/durable_fs.rs`:

- `open_for_fsync(path)` — `OpenOptions::new().write(true).open(path)`: write access, no create,
  no truncate, no append. The only open under which `FlushFileBuffers` is defined to succeed.
- `fsync_path_bounded(path, label)` / `fsync_file_bounded(&file, path, label)` — bounded retry:
  `FSYNC_RETRY_BACKOFF_MS = [25, 50, 100, 200, 400]`, six attempts, **≤ 775 ms of sleep total**
  (Rung 0: every wait has a number, and this one is inside every ffmpeg liveness bound). The path
  variant re-opens on every attempt so a released hold is actually observed. Retryable set:
  `ERROR_ACCESS_DENIED` (5), `ERROR_SHARING_VIOLATION` (32), `ERROR_LOCK_VIOLATION` (33),
  `EINTR`, `EAGAIN`, `EBUSY`. Everything else (`NotFound`, `EIO`, `ENOSPC`/`ERROR_DISK_FULL`)
  returns `Err` immediately, with the OS error code, the step, the full path, the attempt count and
  elapsed ms in the string — the same fields an `Unconfirmed` cause carries.
- `SyncOutcome::{Confirmed, Unconfirmed{cause}}` — the fsync is **never dropped**; the two
  outcomes are made distinguishable and the caller applies policy.

**Policy, by site** (`record_durability_outcome` in `ffmpeg.rs`):

| Outcome | Session-scoped writes (1–5, 10) | Delivery (6, 7) | Manifest / claim (9, 11) | Model import (14) |
|---|---|---|---|---|
| `Confirmed` | silent | silent; `durableConfirmed: true` | silent | silent |
| `Unconfirmed` after ≤ 775 ms | **command returns Ok**; cause logged natively (`[ws3-durability]`) and recorded on the session; drained by the frontend at the terminal (`ffmpeg_take_durability_warnings`) and surfaced on the error blob or the success toast | **rename still happens; command returns Ok** with `SaveSessionFileResult { durableConfirmed: false, durabilityWarning }`; success toast says "Saved, but the disk did not confirm the write was flushed" with the OS error + path on hover | hard `Err` (unchanged — an unconfirmed manifest/claim must not be promoted over a good one) | hard `Err` (unchanged) |
| hard error | `Err` with code + path (unchanged shape, richer string) | `Err` — `.part` removed, `dest` untouched (unchanged) | `Err` | `Err` |

"A durability failure on a complete file degrades to *saved but not confirmed durable*, never to
*export lost*." Anything not yet drained when `TauriFfmpeg.destroy()` runs (a cancel, a crash
between mux and delivery) becomes a `durability-unconfirmed` cleanup notice for the next run — the
same channel STEP 8 (C6) built for cleanup failures.

#### STEP 4 — Diagnostics hole

Every post-encode failure in `exportPipelineWebCodecs.ts` — concat, the frame-count guard (both
the typed mismatch and a thrown count), the voiceover write, mux/seal, and the pipeline-side
delivery — was built as `{ kind, message, cause }` with no `liveness`, because `snapshotLiveness`
is a closure inside `driveGlRun` and is gone by the time these stages run. The blob's
`liveness`/`lastPhase`/`framesEncoded`/`pieceIndex`/`appendLedger`/`phaseLogTail` are all read
off `err.liveness`, hence all null. The `useExport`-side delivery failure had the same shape.

Fix: the pipeline retains the last GL piece's `finish`-stamped result as `lastGlPieceLiveness`
and layers the post-encode stages on as their own phase-log entries (`kind: 'post-encode'`).
`postEncodeError(kind, message, err, phase)` wraps `boundedStepError` and every post-encode
failure now goes through it; `lastPhase` names the failing stage (`concat`, `concat:verify`,
`mux:write-voiceover`, `mux`, `mux:seal`, `deliver`) and the tail ends in it. A successful run
returns its terminal view on `ExportResult.liveness` so `useExport`'s delivery step — which has no
closure of its own — attaches it (with `lastPhase: 'deliver'`) to a delivery failure. The native
cause already carries the OS error code and full path (`durable_fs::describe`, or the new
`[path=…]` suffix on a failed `fs::write`); the TS side passes it through verbatim
(`ExportError.cause`). `ExportError.durabilityWarnings` and the blob's `durabilityWarnings` carry
any degraded fsyncs from the failed run.

**The seal dialog's "10 FRAMES LOST / 0s".** `formatElapsedLong` floors; 10 frames at 30 fps is
0.333 s → "0s" beside a non-zero frame count. New `formatFrameSpanDuration`: sub-second shows
milliseconds ("333 ms"), ≥ 1 s rounds UP to whole seconds so a loss is never understated. Used
on the three seal-dialog tiles and the success toast's "Shortened by".

#### STEP 5 — Proof and gates

**Red, then green, on real Windows.**

- Run 34647026774 (https://github.com/mohtashim9119-web/kinetix-pro-studio/actions/runs/34647026774, integration `1abe9a1`, first-ever Windows execution of the test suite, unfixed
  code): `copy_session_file_atomic_does_not_touch_dest_until_complete` **FAILED** with
  `copy_session_file dest: sync_all: Access is denied. (os error 5)`. Also failed:
  `windows_long_path_is_a_byte_for_byte_no_op_on_this_platform` — a test with no platform gate
  asserting the non-Windows branch; now `#[cfg(not(windows))]`, with a `#[cfg(windows)]` twin
  asserting the prefix IS applied. The Round 19 `windows_start_time` trio ran for the first time:
  3/3 ok. 65 passed / 2 failed.
- Run 34647440025 (https://github.com/mohtashim9119-web/kinetix-pro-studio/actions/runs/34647440025, this branch, probe commit `8982e2e` on unfixed code): the new
  `ffmpeg::tests::windows_fsync_access` trio — `read_only_handle_cannot_flush_file_buffers` ok,
  `append_only_handle_can_flush_file_buffers` ok, `sync_session_file_confirms_on_an_existing_file`
  **FAILED** (the site under test, pre-fix). RED as designed.
- Run 34650194466 (https://github.com/mohtashim9119-web/kinetix-pro-studio/actions/runs/34650194466, fix commit `bf49a99`): every filtered test green — including the machine-2 case
  `write_file_raw_first_frame_sync_confirms` (fresh `frame_00001.png` via `fs::write`, then
  `sync_session_file`, the exact first-frame sequence), added after machine 2 reported. Its red
  is run 34647440025: it exercises the same function with the same arguments as the probe that
  went red there (`sync_session_file_confirms_on_an_existing_file` — itself a `fs::write` +
  `sync_session_file` on a file that did not exist before the test).

`windows-check.yml` (Round 19 carry-over, landed on integration at `1abe9a1`): the feature-off
cell runs `cargo test --lib -- --test-threads=1 session_claim:: project_mirror:: ffmpeg::tests::
durable_fs::` and fails if fewer than 3 tests execute. The feature-on cell stays check-only
(linking the `fa-inference` test binary pulls the ort runtime, which is `build.yml`'s concern).

| Gate | Result |
|---|---|
| Windows `cargo check --all-targets` (feature-off / fa-inference) | **green / green, 0 warnings** — run 34650194466 |
| Windows `cargo test --lib` (filtered: `session_claim:: project_mirror:: ffmpeg::tests:: durable_fs::`) | **78 passed / 0 failed / 3 ignored** — run 34650194466; includes the 4 `windows_fsync_access` probes, the Round 19 `windows_start_time` trio (executed for the first time on run 34647026774), `windows_long_path_applies_the_prefix_at_runtime_on_windows`, and `durable_fs::tests` ×7 |
| Windows bundle build (`build.yml`, `-f fa-inference`) | **NOT dispatched this round, deliberately.** The machine-2 follow-up: no rebuild until machine 3 reports, so all three field results come from `5825dc9`. Dispatch `build.yml` on this branch's head once machine 3 is in; the compile+test job above is the standing gate until then. |
| macOS `npx tsc --noEmit` / `npm run lint` | clean / clean |
| `npm test` | **3587 passed, 0 failed, 78 skipped = 3665** (was 3572/0/78 = 3650; +15: `postEncodeDiagnostics` ×7, `formatFrameSpanDuration` ×5, `normalizeSaveSessionFileResult` ×3) |
| `cargo test` | **321 / 0 / 6** (was 314; +7 `durable_fs::tests`; the 5 `#[cfg(windows)]` additions do not run here) |
| `cargo test --features fa-inference -- --test-threads=1` | **407 / 0 / 36** (was 400; +7) |

New tests: Rust `durable_fs::tests` ×7 (open never truncates/creates; confirmed on every platform;
`NotFound` is a hard error with path + `attempts=1`; the schedule is exhausted and bounded
(≥ 775 ms, < 1,775 ms) then degrades; a hold released mid-schedule confirms; retryable set is the
external-hold class only, per platform; handle variant confirms), `ffmpeg::tests::windows_fsync_access` ×4
(`#[cfg(windows)]`), `windows_long_path_applies_the_prefix_at_runtime_on_windows` (`#[cfg(windows)]`).
TS `postEncodeDiagnostics.test.ts` ×7 (the field failure's blob has all six fields populated and
the native cause verbatim; each post-encode stage names itself; success carries liveness;
`durableConfirmed: false` is still a success), `formatFrameSpanDuration` ×5,
`normalizeSaveSessionFileResult` ×3.

#### Field evidence for W4/W5 — recorded, not fixed

The 10-frame shortfall (40,374 / 40,384) on machine 1's hardware encoder is the first field
observation of the encoder-drain class W4/W5 describe. The sealing offer fired and was accepted,
so the guard and the seal worked as designed. **Not attempted this round** — it needs the same
project on all three machines first. Row W17 in `windows-validation.md` names the data to collect
(machine, GPU, driver version, `encoderSessions`/`encoderSessionIndex`/`selectedHardwareRung` from
the blob, and reproducibility on the same project). Note the diagnostics blob from machine 1 was
the null one this round fixed, so none of those fields are known for that run.

**No merge to main. No PR.** Pushed `ws3-windows-fsync-fix`.
