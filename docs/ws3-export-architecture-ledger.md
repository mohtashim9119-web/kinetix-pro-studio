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
| 0 | Bounded operations — every encoder and ffmpeg operation carries a timeout and dies with a typed error rather than hanging | No operation can hang silently | LANDED | `WATCHDOG_MS`/`FORWARD_PROGRESS_BOUND_MS`/`FLUSH_BOUND_MS`/`APPEND_DRAIN_BOUND_MS`/`TRUNCATE_BOUND_MS` (`exportPipelineWebCodecs.ts`, `ffmpegLivenessBound.ts`) | pre-existing | `ws3-export-liveness` and predecessors |
| 1 | Correct measurement — frame counts are picture-accurate access-unit counts, never coded-slice counts | Counter cannot report 8x on a multi-slice hardware bitstream | LANDED | `AnnexbFrameCount.pictures` (Rust `ffmpeg.rs`'s `AnnexbAccessUnitScanner`); every production truncate/count/compare site uses `.pictures` only — verified this round by direct read of `count_annexb_frames_inner` (`ffmpeg.rs:866-891`, a plain streaming AU counter, no drop policy) | pre-existing | prior round |
| 2a | Bitstream salvage — a crash-truncated Annex-B stream is cut back to its last provably complete access unit, bounded memory. Final AU complete iff a fully scanned subsequent NAL begins the next AU; otherwise dropped (one picture, 33.33 ms @ 1080p30) | — | LANDED, hardened in Cursor's Round 8 (reported, not independently re-verified this round) | `truncate_annexb_inner`/`compute_truncate_cut_from_scanned` (`ffmpeg.rs:629-654`, `:927-956`) — the conservative-drop policy this round confirmed by direct read is confined to THIS function, never `truncate_annexb_to_offset_inner` (see STEP 2b below) | reported: `d0ce875` (conservative final-AU) | Cursor, `ws3-durable-resume` |
| 2b | Forced sealing — a truncated-but-valid stream sealed into a playable MP4, duration derived from picture count, so a short render beats a failed render | — | **PRIMITIVE landed; guard-to-offer call site NOT-WIRED** — confirmed this round: the rotation-timeout rewind-exhausted abort (`exportPipelineWebCodecs.ts:2649-2652`, see STEP 2a below) returns a hard failure with no guard call, no offer, no seal | `muxOnly.ts` (Cursor's `SealingOfferSeam`, not opened this round per Part 0) | reported: `dea7953` (sealing) | Cursor, `ws3-durable-resume` |
| 3 | Bounded re-render — on a MID-run (rotation) flush timeout only: fence the hung session, truncate `runFile` back to the last rotation boundary's exact byte offset (established by a completed `VideoEncoder.flush()`, never scanned), resume the SAME piece's frame loop from that boundary. One attempt per boundary, `MAX_BOUNDARY_REWINDS_PER_EXPORT = 2` total per export | — | LANDED (Round 7), unchanged this round except for the new Rung 5a hand-off once its own budget is exhausted | Decision: `decideBoundedRerenderDisposition`, `exportPipelineWebCodecs.ts:2294`. Wiring: `exportPipelineWebCodecs.ts:2555-2670` (`runGlPiece`, the `while (!driveResult.ok)` loop, the truncate call now at `:2616`) | `a6581d2` | `ws3-tier1-close` (Round 7) |
| 4 | Durable checkpoint resume — `export_state.json` written at rotation seams, read/validated on restart, surviving bitstream fenced and repaired before any append | — | **PRIMITIVE landed; writer call sites, session selection, remainder render NOT-WIRED** (as reported by Round 9's task text; not independently opened this round per Part 0's "do not read from ws3-durable-resume") | `docs/ws3-export-durable-state.md` (Cursor's, cross-referenced by name only) | reported: `989f9c1` (resume), `5792b63` (durable failure records) | Cursor, `ws3-durable-resume` |
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
| 2 | — | Recoverable failure: Rungs 2b, 3, 4 wired end to end. **Confirmed this round to be the correct Tier 2 mapping** (Round 7 had flagged this as its own NOT DETERMINED #1 — "not known to this session"; Round 9's task text states it directly, closing that row). Currently: Rung 3 alone is fully wired; 2b and 4 are PRIMITIVE-ONLY/NOT-WIRED (see Rung table). | **PARTIAL** | — | — | — |
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
| **NEW, Round 9 STEP 2b — the Rung 3/5a rewind's own `truncateAnnexbToOffset` call is NOT wrapped in `withFfmpegLivenessBound`/`TRUNCATE_BOUND_MS`**, unlike the final-flush salvage path's `truncateAnnexb` call (`exportPipelineWebCodecs.ts:2616` vs. `:2775`, see STEP 2b below) — a hung native truncate on the rewind path has no TS-side timeout at all, only the Rust side's own cooperative `check_cancelled` | Owner of `exportPipelineWebCodecs.ts` (mine — flagged, not fixed this round to keep this round's diff mechanical for integration) | Wrap the `:2616` call the same way the `:2775` call already is | No |
| **NEW, Round 9 STEP 5b — no active production "driver is struggling" warning currently exists** to ask whether throttling suppresses it. `encodeQueueSizeAtFlushExpiry` and `'queue-sample'` are diagnostic-only (no orchestrator/UI logic reads either as a live warning). If one is built later off raw `encodeQueueSize` trajectory, it MUST account for the fact that both `BACKPRESSURE_HIGH_WATER` (pre-existing) and this round's throttle now actively suppress that signal by design — build it off `wait-dequeue` time or the throttle's own internal state instead | Whoever builds that warning | Read this note before building it | No |
| **NEW, Round 9 STEP 3/4 — mixed-rung (hardware→software) SPS/PPS profile continuity is REASONED, not measured.** `docs/ws3-export-recovery-architecture.md` §4c argues annexb's inline SPS/PPS-before-every-IDR makes a mid-stream rung change spec-valid, but flags a MEDIUM real risk: `isConfigSupported` passing does not guarantee which profile/level a given rung actually emits. No spike diffed the two rungs' actual SPS bytes this round (out of scope: "No live exports") | Next round with a live-export capability, or a spike using two real `VideoEncoder` instances locally | Diff the SPS NAL bytes emitted by a `prefer-hardware` vs `prefer-software` session locally (no full export needed) | Possibly — depends on whether the local machine's WebCodecs implementation exposes both rungs distinctly (this Mac session's own `VideoEncoder` was never invoked for real encoding this round, only faked in tests) |

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
