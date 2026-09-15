# WS3 — Round 28 closeout: D9 encoder-restart audit

> **Read-only, point-in-time analysis.** No code, tests, or fixes were produced by this pass.
> **Source worktree:** `../4.kinetix-pro-studio-ws3-export-integration` (git worktree of this repo).
> **SHA taken at:** `1560ac5` (integration tip after fast-forwarding `ws3-round28` into
> `ws3-export-integration`, Round 28 closeout).
> **Date:** 2026-09-16.

---

## Scope

D9: twenty encoder sessions with eighteen restarts observed on an RX 580, never investigated.
Question — is this designed rotation, driver-level GPU resets, or undetermined from available
evidence? Investigated by a read-only Explore-agent pass against this SHA; findings below are
that agent's output, unedited except for formatting.

---

## 1. Designed mechanisms that legitimately end/start an encoder session

- **Frame-count rotation (the dominant one).** `encoderSessionPlan.ts:68` —
  `MAX_ENCODER_SESSION_FRAMES = 1800` (60s at 30fps). `planEncoderSessions`
  (`encoderSessionPlan.ts:98-129`) greedily cuts a GL run into encoder sessions whenever the
  running length would exceed this cap, cutting backward to the last frame where `isKeyFrame(i)`
  was already true (GOP = 2×fps = 60 frames at 30fps, `encoderSessionPlan.ts:85`). This is a
  **within-piece** boundary — one GL context/compositor/decode-cursor set persists; only the
  `VideoEncoder` is flushed, closed, and rebuilt (`encoderSessionPlan.ts:18-23`).
- **Piece boundaries.** `planGlRunPieceStarts` (referenced at `encoderSessionPlan.ts:6`) bounds a
  GL *piece* separately, cutting only at hard cuts (no transition). Each new piece spawns a
  **fresh worker** (`exportPipelineWebCodecs.ts:1268`; `exportPipeline.ts:97-104` documents
  `framesEncoded` resetting to 0 at the start of every new piece) — a much heavier restart than
  an in-worker rotation.
- **Codec/profile ladder descent** — not itself a rotation trigger, but rung-visible per session.
  `hardwareCodecLadder.ts:29` — `EXPORT_CODEC_LADDER = ['avc1.640028', 'avc1.42001f']`
  (High→Baseline). `exportWorker.ts`'s `createEncoder` walks codec outer, `hardwareAcceleration`
  inner, and this descent re-runs from scratch on every session build including a rotation, with
  nothing pinning it to the prior session's rung (`exportWorkerDiagnostics.ts:242-258`). Not a
  cause of restarts by itself — a symptom to cross-check.
- Checkpoint/manifest bookkeeping fires on every rotation (`exportCheckpointWriter.ts:111-113`,
  `exportCheckpoint.ts:542-552` `rotationsSeen++`), confirming rotation is a first-class, expected,
  per-piece-repeating event, not an error path. Vocabulary throughout the codebase: a normal
  session change is a **"rotation"** (`'session-rotate'` messages,
  `exportPipelineWebCodecs.ts:1304,2429`; `rotationsSeen` counter). Failure-driven session ends
  use a different vocabulary entirely — a `failureVia`/`via` tag (see §4).

## 2. Expected rotation count for a ~20-session export

`MAX_ENCODER_SESSION_FRAMES = 1800` frames = 60s at 30fps (`encoderSessionPlan.ts:52`). Twenty
total sessions in one piece implies roughly 20 × 60s ≈ 20 minutes of 1080p30 footage — consistent
with the module's own worked example: "a 26-minute 1080p30 export rotates its encoder every 1800
frames (60s)… produces ~26 rotations" (`exportCheckpointWriter.ts:13-14`). By that ratio, ~20
sessions implies **~19 rotations** for ~20 minutes of footage (rotations = sessions − 1 within one
piece/run) — the expected, by-design count for a project of this length.

## 3. Does 18 restarts match?

18 vs. an expected ~19 for a 20-session run is within rounding of exactly what the size-based
rotation cap predicts — not anomalous on its face, if the 18 are genuinely `session-rotate`
events. Nothing found in `encoderSessionPlan.ts`, `exportPipelineWebCodecs.ts`, or `ffmpeg.rs`
ties the figure "18" specifically to any failure-driven mechanism. Whether the 18 are all clean
`session-rotate` events, or include failure-driven ones, **cannot be determined from the count
alone** — see §5–6.

## 4. Could a restart originate from `gl-context-lost`?

- **Where caught:** `src/services/gl/glContext.ts:200` and `:267` register
  `webglcontextlost`/`contextlost` listeners; `exportWorker.ts:1995` sets
  `failState.setFailure('gl-context-lost', ...)` on the per-iteration `contextLost` flag check
  inside the frame loop, and `exportWorker.ts:2146-2156` catches the same case racing in via
  `GlContextLostError` thrown from `glContext.ts:139` (`requireGl`) — both races share the same
  `'gl-context-lost'` identity.
- **`failureVia` classification:** the string literal `'gl-context-lost'` threads through
  `ExportFailureIdentity.via` (`exportWorkerDiagnostics.ts:181`) and surfaces to the UI/manifest
  as `failureVia` (`exportPipelineWebCodecs.ts:1721,3198,3721`).
- **`FAILURE_VIA_TO_KIND` table** (`exportWorkerDiagnostics.ts:162-176`):
  ```
  export const FAILURE_VIA_TO_KIND = {
    'encoder-callback': 'encode',
    thrown: 'encode',
    'gl-context-lost': 'encode',
    cancel: 'cancelled',
    ...
  } as const satisfies Record<ExportFailureVia, ExportErrorKind>;
  ```
  `'gl-context-lost'` maps to `ExportErrorKind = 'encode'` — the same bucket as almost every
  other failure `via`, by explicit design ("this map does not invent new `ExportErrorKind`
  values", `exportWorkerDiagnostics.ts:148-149`). The finer distinction lives only in `via`, not
  `kind`.
- **Terminal for the piece, not a rotation.** `exportWorker.ts:1993-1999`: "exportWorker: WebGL2
  context lost mid-export — aborting (no restore attempted, per plan §4.1)" — it throws out of
  the frame loop entirely, closes the encoder once (`closeEncoderOnce()`), and posts
  `postTerminal('error', ...)`. It is not routed through `planEncoderSessions`/`session-rotate`
  at all — a context loss ends the whole piece's worker, which (per §1's piece-restart mechanism)
  would trigger a brand-new worker/piece, a much heavier restart than an in-place rotation.
- **Recoverable or terminal on this integration tip?** `resumeEligibility.ts:26-31`: resume is
  gated on retention evidence (`retainForResume` + `disposition: 'retained'` + confirmed
  manifest), not on `kind`. `isNeverResumeKind` (`exportFailureCopy.ts:108-110`) does not list
  `'encode'`/gl-context-lost as never-resumable, so a `gl-context-lost` failure *can* be
  resume-eligible if retention succeeded — but it is not silently absorbed as an in-place
  rotation; it fails the run and depends on the separate resume/retry flow
  (`resumeEligibility.ts:33-40` `shouldOfferResume`). `shouldMentionHardware`/`hardwareNoteFor`
  (`resumeEligibility.ts:44-59`) explicitly surface a user-facing note
  (`GRAPHICS_CONTEXT_LOST_NOTE`, `exportFailureCopy.ts:105-106`) whenever
  `failureVia === 'gl-context-lost'` — the UI does distinguish this case from a normal
  completion; it is a real failure event requiring operator awareness, never folded into
  rotation counts.

## 5. What the diagnostic log records today, and what's missing

`src/services/exportDiagnosticLog.ts:37-44` — `ExportLogPhase` is a closed set: `'init' |
'encoder-config' | 'progress' | 'watchdog' | 'cancelled' | 'disk-full' | 'session-cleanup'`.
**There is no `'session-rotate'` (or any rotation-specific) phase.** Grepping every
`logExportEvent(...)` call site (`exportPipelineWebCodecs.ts:395,425,2944,3085`,
`useExport.ts:1118,1158`) shows rotations are never written to `kinetix-diagnostic.log`; only
init, cancel, and session-cleanup are. Currently a rotation isn't logged there at all, and
neither is a context-loss-driven restart via this channel — both are silent to the durable log.
The only place either is visible is the in-memory/worker diagnostics payload
(`ExportWorkerDiagnosticsPayload`, `exportWorkerDiagnostics.ts:186-309`), attached to the
terminal `ExportError`/liveness snapshot only on failure, not persisted per-session to a durable
log distinguishing rotation from failure at the file level.

Fields that would need to be **added** (not implemented in this pass) to make a context-loss
restart distinguishable from a designed rotation in the log:

- A `'session-rotate'` (or `'session-restart'`) `ExportLogPhase` value in
  `exportDiagnosticLog.ts:37-44`, logged at the actual `'session-rotate'` handling site
  (`exportPipelineWebCodecs.ts:2429`).
- A `restartReason: 'rotation-cap' | ExportFailureVia` recorded per rotation/restart event —
  today `rotationsSeen` (`exportCheckpoint.ts:194`) only counts occurrences with no cause tag.
- `selectedHardwareRung`/`selectedCodec` (`exportWorkerDiagnostics.ts:238-269`) already exist
  per-session in the worker payload but are not persisted to `kinetix-diagnostic.log` per
  rotation — surfacing rung/codec drift between consecutive sessions would be a strong secondary
  signal of driver-level instability vs. clean rotation.
- A boundary-type marker (`'frame-cap' | 'piece-boundary' | 'gl-context-lost'`) at each
  `session-cleanup`/`encoder-config` log line — today's `session-cleanup` detail string
  (`exportPipelineWebCodecs.ts:425`) carries only `sessionId`/`reason=cancel`, no
  rotation-vs-failure distinction.

## 6. Conclusion

**Undetermined from available evidence**, leaning toward "consistent with designed rotation" but
not provable either way from the artifacts described. The count (18, against an expected ~19
rotations for a ~20-session/~20-minute export under the 1800-frame/60s cap in
`encoderSessionPlan.ts:52,68`) is numerically compatible with pure by-design rotation and
requires no GPU-failure explanation. But because `gl-context-lost` failures
(`exportWorker.ts:1993-1999`) are currently **not logged to `kinetix-diagnostic.log` at all** (no
matching `ExportLogPhase`, `exportDiagnosticLog.ts:37-44`) and rotations are likewise never
durably logged there, the raw "20 sessions, 18 restarts" figure as currently recorded cannot rule
out one or more of those 18 actually being driver-triggered context-loss restarts disguised as
rotations.

**What would settle it:** add the `session-rotate`/`restartReason` logging named in §5, then check
(a) whether restart-to-restart frame gaps cluster near exactly 1800 (rotation) or are
irregular/shorter (driver reset), and (b) whether `selectedHardwareRung`/`selectedCodec`
(already captured per-session in `exportWorkerDiagnostics.ts:238-269` but not persisted) changed
rungs mid-run — a clean rotation would have no reason to do that, but a driver recovery/failover
might.

No fields were added and no code changed in this pass — see D9's entry in `docs/STATUS.md` for
tracking status.
