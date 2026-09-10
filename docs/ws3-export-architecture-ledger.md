# WS3 Export — Architecture Ledger

> **Purpose.** This is the file that prevents context loss across WS3 export-hardening
> rounds. Five registers (Rung, Tier, Bound, Counter, NOT DETERMINED) plus a dated Round
> log. Every status uses the fixed vocabulary: `LANDED` / `PARTIAL` / `POLICY-ONLY` /
> `WRITE-ONLY` / `SIMULATED` / `NOT STARTED`. Cross-reference `docs/ws3-export-durable-state.md`
> by name only — this file does not edit or duplicate its content.
>
> **A note on taxonomy, read before trusting the numbers below.** No prior committed doc
> in this repo defines a 0-5 "Rung" scale or a "Tier 1-4" scale under those exact names —
> `docs/ws3-export-recovery-architecture.md` uses its OWN 1-13 rung numbering (different
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
| 5 | **Software failover at a rotation boundary** — if hardware encoding keeps failing mid-export, force the NEXT session to build at rung 2 (`prefer-software`) rather than restarting the ladder from rung 0 every time. | NOT STARTED | none (inferred successor to `docs/ws3-export-recovery-architecture.md`'s old rung 10, "designed, not built") | — |

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
| 4 | — | Not known to this session. `docs/ws3-export-recovery-architecture.md`'s old rung 13 ("process isolation," SPECULATIVE) is a plausible candidate. | NOT DETERMINED | — | — |

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
| `APPEND_QUEUE_CEILING_BYTES` | 256 MiB | Assumed ("placed by the memory-risk argument alone... should be re-derived the first time a real run reports a `queueDepthBytes` anywhere near it" — pre-existing doc comment, unchanged this round) | 8x `APPEND_BACKPRESSURE_THRESHOLD_BYTES` | n/a | Unmeasured legitimate peak — explicitly flagged as a NOT DETERMINED item in a prior round, still true. |
| `APPEND_BACKPRESSURE_THRESHOLD_BYTES` | 32 MiB (this round, new) | Assumed — reasoned against the two neighbors (8x `APPEND_BATCH_BYTES`, 1/8 `APPEND_QUEUE_CEILING_BYTES`), not measured against a real peak backlog | 8x above the batch trigger, 8x below the ceiling | **Never engaged at any of the three measured latencies (0.5/12.4/25 ms) — see §6.** Break-even (the latency at which it WOULD engage for this chunk profile) was not computed; back-pressure is a hedge against a worse case than any latency measured this round. | A worker legitimately parked on this gate cannot be misread as stalled, because the SAME event (a completed append) both resets `FORWARD_PROGRESS_BOUND_MS`/`WATCHDOG_MS` and unblocks the gate — proven at all three seams (session-rotation, done, salvage-done) in `appendBackpressureAckWiring.test.ts`. |
| `MAX_BOUNDARY_REWINDS_PER_EXPORT` | 2 (this round, new) | Assumed — "two, not one: a transient stall recovered by one piece's rewind says nothing about a second piece's rewind, but a third rewind in the same export is 'salvage becomes routine'" (own doc comment, `exportPipelineWebCodecs.ts:2276`) | n/a | n/a | None known — bounded, destructively probed (see §6). |
| `MAX_FLUSH_SALVAGES` | 1 | Assumed (prior round) | n/a | n/a | Unchanged this round. |
| `MAX_ENCODER_SESSION_FRAMES` | 1,800 | Assumed (prior round, ~60s at 30fps) | n/a | n/a | Unchanged this round — this round's rewind logic depends on `planEncoderSessions`'s guarantee that every session-start frame is already a keyframe; not re-verified this round, inherited as-is. |
| `FLUSH_BOUND_MS` | 20,000 ms | Assumed (prior round) | n/a | n/a | Unchanged this round. |
| `APPEND_DRAIN_BOUND_MS` | 600,000 ms (10 min) | Assumed (prior round) | For the pathological 25 ms unbatched arm simulated this round: terminal drain 549,233.8 ms = 91.5% of this bound — the CLOSEST any simulated scenario came to any bound this round, and the batching fix removes the risk entirely (batched terminal drain at 25 ms = 25 ms). | n/a | Not re-measured this round beyond the one simulated data point above. |

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
| Tier 2/3/4 authoritative definitions (this ledger's Tier table only knows Tier 1) | Whoever holds the original Tier 1-4 breakdown (not found in any committed doc by this session) | Locate or re-author the Tier 2-4 item list and correct §2 above | No |
| NOT DETERMINED #1/#2 (append throughput at 3 latencies) — **SIMULATED, not resolved** | Next round with Windows hardware access | A real WebView2/Windows run at the 12.4 ms-class machine, with the batched+back-pressure path active, measuring actual terminal drain | **Yes** — Windows machine with the real regression hardware profile |
| Real per-call `open`/`write_all`/`close` cost in `ffmpeg.rs:189-198` on Windows | Owner of `ffmpeg.rs` (outside this round's file-ownership boundary) | Instrument that function directly and log real per-call timings on Windows | Yes |
| Whether `APPEND_QUEUE_CEILING_BYTES` (256 MB) is sized to any real legitimate peak | Next round that has a real high-resolution/high-bitrate field export to sample | Sample `queueDepthBytes` from a real run's diagnostics payload and compare | Preferably yes (a real large export), not strictly a hardware question |
| The break-even latency at which `APPEND_BACKPRESSURE_THRESHOLD_BYTES` (32 MB) would actually engage for the field chunk profile | Not computed this round (out of scope — the three specified latencies never approached it) | Extend `scripts/ws3-measure-append-throughput.test.ts` with a bisection over latency until `peakUnackedBytes` crosses 32 MB | No — computable in the existing simulator |
| Rung 5 (software failover at a rotation boundary) | Next round | Design + build, following the Rung 3 precedent (policy function first, wire second) | No |
| Whether `planEncoderSessions`'s "every session start is a keyframe" guarantee still holds under Rung 3's resumed-run bootstrapping (`initialSessionIndex` computed from `sessionStarts.indexOf`) for every real timeline shape, not just this round's synthetic fixtures | Next round, or a live-export verification pass | A live export that actually triggers a mid-run rotation-flush-timeout and inspects the resumed session's first frame | Not necessarily — could be checked with a broader property-based fixture instead |
| Whether the Rung 3 rewind's simplification in the ORCHESTRATOR (a resumed run's `sessionByteOffsets`/`sessionFrameIndices` bootstrap at exactly one sparse index, `resumeSessionIndex`) generalizes correctly to a THIRD rewind if `MAX_BOUNDARY_REWINDS_PER_EXPORT` were ever raised above 2 | Whoever changes that constant | Extend `boundedRerenderWiring.test.ts` with a 3-rewind scenario before raising the constant | No |

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
