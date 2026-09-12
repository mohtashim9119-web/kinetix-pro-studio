# Export path selection audit (PROMPT 27)

> **Read-only audit + fix spec.** No pipeline behavior changes in this pass.
> **Branch:** `ws3-win-perf-audit` @ `cd60af6`, cut from `ws3-export-integration` @ `9297de2`.
> **Field evidence (Machine 2):** RTX 3050 / i3-12th / 32 GB — progress shows
> `Encoding segment 1 / 345` with no `encoder session` suffix; ~12.8 fps; earlier
> failure `write_file_raw(frame_00001.png)` on segment `segv1_acc1c68b_0`,
> `segmentIndex 0`; reproduced across reinstall, fresh project, multiple attempts.
> **Machine 1 (control):** RX 580 / same CPU class — `Encoding segment 1 / 1 · encoder
> session 1 / n`; ~96 fps.

---

## STEP 1 — Map both paths

### Production export implementations

| # | Implementation | Entry function | Progress string template | WebGL | Intermediate PNGs | Annex-B end-to-end | Durable resume | Recovery ladder | Append ledger | Seven frozen liveness constants¹ |
|---|---|---|---|---|---|---|---|---|---|---|
| A | **Legacy canvas pipeline** | `exportProject` (`exportPipeline.ts:244`) | `Encoding segment ${index + 1} / ${total}` via `stageLabelFor` (`useExport.ts:342–348`); `encoderSessions` never set on this path (`exportPipeline.ts:22–24`) | No — Canvas 2D (`segmentEncoder.ts:117–121`) | Yes — `frame_%05d.png` per frame on canvas tier (`segmentEncoder.ts:237–288`) | **No** — per-segment MP4 → ffmpeg concat protocol on MP4 (`exportPipeline.ts:404–420`) → voiceover mux | No | No | No | **No** — none of the WS3 bounds apply |
| B | **WebCodecs orchestrator (Tier GL)** | `exportProjectWebCodecs` → `driveGlRun` → `exportWorker.ts` worker | `Encoding segment ${index + 1} / ${total} · encoder session ${encoderSessionIndex + 1} / ${encoderSessions}` when `encoderSessions > 1` (`useExport.ts:342–347`); for a single GL piece with multiple sessions, `total === 1` and session suffix appears | Yes — WebGL2 in worker OffscreenCanvas (`exportWorker.ts`, `glCompositor.ts`) | No — `VideoFrame` from GL canvas | **Yes** — worker emits annexb chunks → `appendFileRaw` → `piece_N.h264` | Yes — checkpoint writer + resume discovery (`exportPipelineWebCodecs.ts:2912–2926`, `useExport.ts:577–647`) | Yes — Rungs 3/5a/5b wired in `exportProjectWebCodecs` piece loop | Yes — stamped on every `RunDriveResult` (`exportPipelineWebCodecs.ts:914`, `finish`) | **Yes** — all seven apply to GL worker path |
| C | **WebCodecs orchestrator (Tier 1 plain)** | `exportProjectWebCodecs` → `encodeTier1Piece` (`exportPipelineWebCodecs.ts:~2470`) | Same base template as B; **no** `encoder session` suffix (`pieceSessions` stays null — only GL sets it at `exportPipelineWebCodecs.ts:3121–3122`) | No | No — single ffmpeg trim/scale or one-frame loop | **Yes** — MP4 remuxed to annexb per piece (`remuxMp4ToAnnexb`) | No — checkpoints are GL-piece-scoped only | No | No | Partial — `TIER_PIECE_BOUND_MS`, `REMUX_BOUND_MS`, concat/mux bounds from `ffmpegLivenessBound.ts`; not GL watchdog/flush/append-batch |
| D | **WebCodecs orchestrator (Tier C canvas / “segment path”)** | `exportProjectWebCodecs` → `encodeCanvasPiece` → `encodeSegment` (`exportPipelineWebCodecs.ts:2507–2570`, `segmentEncoder.ts:101`) | Same as C — `Encoding segment ${pieceIndex + 1} / ${pieces.length}`; **no** encoder-session suffix | No — Canvas 2D (same `encodeSegment` as legacy) | **Yes** — identical PNG IPC as legacy (`segmentEncoder.ts:287–288`, `writeFileRaw(frame_00001.png)` class) | **Yes** — MP4 → annexb remux per piece | No | No | No | Partial — `TIER_PIECE_BOUND_MS` with per-frame `touch()` reset (`ffmpegLivenessBound.ts:29–33`, `encodeCanvasPiece:2554–2556`); concat/mux bounds apply post-encode |

¹ Per `architecture-ledger.md` Round 17 final state: `WATCHDOG_MS`, `FORWARD_PROGRESS_BOUND_MS`, `FLUSH_BOUND_MS`, `APPEND_DRAIN_BOUND_MS`, `TRUNCATE_BOUND_MS`, `KILL_BOUND_MS`, `APPEND_BATCH_BYTES`.

### Non-production (dev / spike only)

| Implementation | Entry | Notes |
|---|---|---|
| `exportProjectWebCodecsSoftwareSpike` | `src/dev/webcodecsStep2Spike/` | Forced software encoder; not reachable from `useExport` |
| `exportProjectWebCodecsInstrumented` | same | Timing probes only |
| Liveness probe runners | `src/dev/exportLivenessProbe/` | Direct `exportProjectWebCodecs` calls bypassing UI gate |

### Progress string literals (quoted)

**Machine 1 signature (`1 / 1 · encoder session 1 / n`):**

```339:348:src/hooks/useExport.ts
export function stageLabelFor(stage: ExportStage): string {
  if (stage.type === 'loading_ffmpeg') return 'Loading ffmpeg…';
  if (stage.type === 'encoding_segment') {
    const base = `Encoding segment ${stage.index + 1} / ${stage.total}`;
    // WS3 — the piece count and the encoder-session count are DIFFERENT
    // numbers, and only the second one moves when the session bound engages.
    // Showing just the first is what made a working bound read as a dead one.
    return stage.encoderSessions !== undefined && stage.encoderSessions > 1
      ? `${base} · encoder session ${(stage.encoderSessionIndex ?? 0) + 1} / ${stage.encoderSessions}`
      : base;
```

WebCodecs GL sets `encoderSessions` via `onSessionPlan` (`exportPipelineWebCodecs.ts:3121–3122`) and passes `total: pieces.length` (`exportPipelineWebCodecs.ts:3035–3036`). One GL piece covering the whole timeline → `1 / 1 · encoder session …`.

**Machine 2 signature (`1 / 345`, no session suffix):**

- **Legacy path:** `onProgress({ index: i, total: segments.length, … })` (`exportPipeline.ts:323–328`) — 345 timeline segments → `1 / 345`.
- **WebCodecs Tier C-only routing:** `onProgress({ index: pieceIndex, total: pieces.length, … })` with `pieceSessions === null` (`exportPipelineWebCodecs.ts:3032–3046`) — one canvas piece per segment → also `1 / 345`, visually identical.

Both slow paths call the same `encodeSegment` → `writeFileRaw('frame_00001.png', …)` (`segmentEncoder.ts:237–288`).

### WS3 hardening that does **not** cover the segment path

| Hardening | GL path | Tier C / legacy segment path |
|---|---|---|
| Worker watchdog / forward-progress bound | Yes | No worker |
| Encoder session rotation + flush bound | Yes | N/A (libx264 per segment) |
| Append batching + backpressure gate | Yes | No streaming append |
| Durable checkpoint / resume | Yes (GL pieces) | None |
| Recovery ladder (rewind, hardware→software failover, salvage) | Yes (GL only) | None |
| `gpuCapabilityProbe` (cd60af6) | **Not wired** — read-only probe, no routing input | Same |
| Native annexb concat (FD-safe) | Yes (orchestrator) | Legacy uses MP4 concat protocol |
| Post-concat picture-count guard | WebCodecs only | Legacy has no guard |
| Forced MP4 seal offer | WebCodecs only | None |
| `TIER_PIECE_BOUND_MS` + kill on expiry | WebCodecs Tier 1/C only | **Legacy: unbounded** opaque ffmpeg calls |

---

## STEP 2 — The deciding branch

### Top-level fork (legacy vs WebCodecs)

**Call site** (`useExport.ts:541–667`):

```typescript
const useWebCodecsPath = isWebCodecsExportGateOpen();
// ...
const result = useWebCodecsPath
  ? await exportProjectWebCodecs(...)
  : await exportProject(...);
```

**Gate predicate** (`useExport.ts:162–164`):

```typescript
export function isWebCodecsExportGateOpen(): boolean {
  return isWebCodecsExportCapable() && isWebCodecsExportToggleOn();
}
```

### `isWebCodecsExportCapable()` — evaluation order

File: `useExport.ts:111–134`. Memoized once per session (`cachedWebCodecsExportCapability`).

| Order | Condition | Queries | On false / throw | Logged? |
|---|---|---|---|---|
| 1 | `typeof window === 'undefined'` | SSR guard | return `false` | No |
| 2 | `'VideoEncoder' in window` **and** `'VideoDecoder' in window` **and** `'EncodedVideoChunk' in window` | WebCodecs API presence | return `false` | No |
| 3 | `isWebGL2Supported()` | Throwaway canvas `getContext('webgl2')` (`glContext.ts:27–38`) | return `false` | No |
| 4 | `typeof Worker === 'undefined'` | Worker API | return `false` | No |
| 5 | Module-worker probe | `new Worker(blobUrl, { type: 'module' })` in try/catch | catch → return `false` | No |

### `isWebCodecsExportToggleOn()` — evaluation order

File: `useExport.ts:150–155`.

| Order | Condition | On failure | Logged? |
|---|---|---|---|
| 1 | `readUiState()[WEBCODECS_TOGGLE_KEY]` | try/catch → `WEBCODECS_TOGGLE_DEFAULT_ON` (`true`) | No |
| 2 | `typeof stored === 'boolean'` | use stored; else default `true` | No |

**No code path records which gate clause failed.** `activePathRef` (`useExport.ts:405,542`) holds `'legacy' | 'webcodecs'` for cancel teardown only — not diagnostics, not UI.

### Within WebCodecs (only if gate open): tier routing

File: `exportPipelineWebCodecs.ts:404–543`. **Pure project content — no GPU re-probe.**

```typescript
function computeIndividualTier(...): Tier {
  if (isPlain) return 'plain';
  return isGlCompositableSegment(segment, project, { prev, next }) ? 'gl' : 'canvas';
}
// then groupConnectedComponents() may downgrade whole GL-transition components to 'canvas'
```

Logged once per run: `console.info('[ws3-liveness] routing', JSON.stringify(diag.routing))` (`exportPipelineWebCodecs.ts:2864`).

### Most likely false clause on Machine 2

Given Machine 1 runs the same project class on WebCodecs GL (`1 / 1 · encoder session`), **within-WebCodecs tier routing cannot differ** for identical project bytes. Machine 2's `1 / 345` without session suffix therefore implicates the **top-level gate**, not `isGlCompositableSegment`.

**Single most likely false condition: #3 — `isWebGL2Supported()` returns `false`.**

Rationale:

- RTX 3050 is WebCodecs-capable in Chromium; clauses 2, 4, 5 likely pass on a current WebView2 build.
- WebGL2 context creation failure (driver blocklist, ANGLE/SwiftShader-only context, corporate GPU policy) is a known class that leaves WebCodecs APIs present but fails the export gate's `getContext('webgl2')` probe — exactly the shape that routes to legacy with **zero user-visible explanation**.
- `gpuCapabilityProbe.ts` (cd60af6) can detect SwiftShader/software rasterizer **but is not consulted by the gate** — a probe/report mismatch is possible.

Secondary (less likely for “same project class”): toggle explicitly set `false` in `kinetix:ui:v1` on Machine 2 only.

### Field-evidence verdict

Machine 2's progress shape + `write_file_raw(frame_00001.png)` + ~12.8 fps **confirms the per-segment canvas/PNG encode path** (`encodeSegment`). Combined with Machine 1's `1 / 1 · encoder session` on a comparable effects-bearing project, the code-consistent explanation is:

> **Machine 2 failed `isWebCodecsExportGateOpen()` (most likely at `isWebGL2Supported()`) and ran `exportProject` (legacy), not a silent within-WebCodecs tier downgrade of the same routing Machine 1 received.**

If both machines passed the gate, identical project JSON would produce identical `pieces.length` and tier counts — Machine 2 could not show `345` pieces while Machine 1 shows `1` unless segment count differs.

---

## STEP 3 — Silent-fallback inventory

| Location | Trigger | User/diagnostics signal | Performance delta | Output differs? | Severity |
|---|---|---|---|---|---|
| `isWebCodecsExportGateOpen()` false | Any capability clause or toggle off | **None** — same progress UI shape as Tier C | ~7–8× slower (PNG per frame × N segments); no append batching | See below | **HIGH** (perf + durability) |
| `computeIndividualTier` → `'canvas'` | Segment fails `isGlCompositableSegment` (filter, clip-effect slug, legacy transition, bad asset, etc.) | `[ws3-liveness] routing` console only; routing not in Copy-diagnostics blob | Per-segment PNG path vs unified GL | **Grade (`effectGrade`) dropped** — GL-only (`exportPipelineWebCodecs.ts:467–471`, zero refs in `frameRenderer.ts`/`segmentEncoder.ts`). Filters/transitions/animations still render on canvas. | **CRITICAL** if grade non-neutral |
| `groupConnectedComponents` downgrade | Any member of a GL-transition component not individually `'gl'` | Same as above | Whole component → N canvas pieces | Same grade loss for affected segments | **CRITICAL** when grade + GL transitions co-exist |
| `createFrameEncoderPool()` → `null` | No OffscreenCanvas / Worker / `convertToBlob` | `console.log('[export] Using sequential fallback…')` — easy to miss | Sequential PNG encode vs pipelined pool | **No** — byte-identical PNGs | Medium (perf only) |
| `ffmpeg.writeFileRaw` absent | Non-Tauri backend | Falls back to base64 `writeFile` (`segmentEncoder.ts:287–290`) | ~5–8× IPC inflation | No | Medium |
| Hardware encoder ladder | `prefer-hardware` succeeds but software runs | **None** — `selectedHardwareRung` not in operator blob today | Up to order-of-magnitude encode slowdown | No (same annexb contract) | Medium |
| `isWebGL2Supported()` memoization | First probe result cached for session | Failed probe never re-tried until restart | Sticky legacy routing | N/A | Medium |

**Effects on segment path vs GL path (visual):**

| Effect type | GL worker | Canvas / legacy `encodeSegment` |
|---|---|---|
| Color filter (`overlayFilter`) | N/A if GL-routed (filter disqualifies GL) | Rendered (`frameRenderer` CSS filter) |
| Clip-effect slugs (blur, sepia, duotone, …) | Disqualifies GL → canvas | Rendered on canvas |
| GL transitions (4 slugs) | Native GL blend | Canvas `applyTransitionBlend` — **same slugs, intended parity** |
| Legacy enum transitions | Disqualifies GL → canvas | Canvas blend |
| Zoom in/out animation | GL | Canvas animation |
| **`effectGrade`** | GL grade shader | **Not rendered — silent loss** |
| Text / headings / overlays | GL text renderer / canvas | Canvas |

---

## STEP 4 — Project vs machine

### What path choice depends on

| Decision | Depends on project? | Depends on machine? |
|---|---|---|
| Legacy vs WebCodecs | Toggle only (user preference) | **Capability probe** (WebCodecs + WebGL2 + module Worker) |
| Tier plain / gl / canvas | **Yes** — segment fields, neighbors, assets, transitions | **No** — pure functions, no GPU |
| GL piece count vs segment count | **Yes** — all-GL composable → few pieces; all canvas → one piece per segment | No |
| Encoder session count | **Yes** — timeline length vs `MAX_ENCODER_SESSION_FRAMES` | No |

### When the **same project** takes different paths on different machines

Only one code-backed case:

1. **Machine A:** `isWebCodecsExportGateOpen() === true` → `exportProjectWebCodecs`.
2. **Machine B:** gate false → `exportProject` (legacy).

Tier routing inside WebCodecs is deterministic from project JSON + fps; it **cannot** explain Machine 1 @ `1/1` vs Machine 2 @ `1/345` on identical timelines.

### Manual A/B test prediction

| Test | Expected if hypothesis holds |
|---|---|
| Same project file, Machine 1 vs Machine 2 | M1: `1 / 1 · encoder session …`; M2: `1 / N` (N = segment count), no session suffix |
| Machine 2 DevTools: `isWebCodecsExportCapable()` | `false` |
| Machine 2: `canvas.getContext('webgl2')` on throwaway canvas | `null` or SwiftShader in unmasked renderer |
| Machine 2 console during export | **No** `[ws3-liveness] routing` line (legacy path skips orchestrator) |
| Copy diagnostics on Machine 2 failure | `liveness`, `appendLedger`, `encoderSessions` all absent (`ExportLivenessSnapshot` is WebCodecs-only) |
| Toggle off on M1, same project | M1 progress matches M2 shape (`N / N`, no session suffix) |

Segment-count variations (345 vs 354 vs 379) change **N in the progress denominator only**; they do not change **which path** runs.

---

## STEP 5 — Fix spec (no implementation)

### 5.1 Record path selection in diagnostics

Extend the Copy-diagnostics blob (`exportDiagnosticsBlob.ts`) and successful-run logging with a **`exportPathSelection`** block:

```typescript
{
  topLevelPath: 'webcodecs' | 'legacy';
  gate: {
    capable: boolean;
    toggleOn: boolean;
    open: boolean;
    capabilityFailures: ('no-window' | 'no-webcodecs' | 'no-webgl2' | 'no-worker' | 'no-module-worker')[];
  };
  routing?: WebCodecsRoutingSummary; // pieces, segmentCounts, pieceCounts — already computed in orchestrator
  progressInterpretation: {
    pieceOrSegmentTotal: number;
    encoderSessionsPlanned: number | null;
  };
}
```

Populate on **`startExport`** immediately after `isWebCodecsExportGateOpen()` (before encode), mirroring how `encoderSessions` and `appendLedger` attach to `ExportLivenessSnapshot` post-failure. On legacy, set `routing: null` and `encoderSessionsPlanned: null` explicitly so absence is not ambiguous.

Optional: call `probeGpuCapabilities()` once when gate fails at WebGL2 — **read-only**, does not change routing — and attach `unmaskedRendererWebGL`, `softwareRasterizationDetected`, `top1080p30EncoderSupport` for field correlation.

### 5.2 Pre-export warning copy (slow path chosen)

When `!isWebCodecsExportGateOpen()` **or** when WebCodecs routing has `pieceCounts.gl === 0 && pieceCounts.canvas > 0` for a project with any non-plain segment:

> **Export will use the compatibility (segment-by-segment) encoder.**  
> Reason: {humanized gate failure | “project effects require the canvas encoder”}.  
> Expect significantly slower exports{and, if any segment has non-neutral `effectGrade`,: **“Color grade will not appear in the exported video.”**}

Require explicit **Continue** or offer **Open App Settings → WebCodecs export** when the failure is toggle-only.

Do **not** block Tier 1 plain segments silently — plain path is fast and intentional.

### 5.3 Policy: effect-bearing projects on segment path

**Recommendation:** For projects where `planWebCodecsExport` reports `pieceCounts.gl === 0` and (`segmentCounts.canvas > 0` or any non-neutral `effectGrade`), **hard-fail with diagnosis** instead of silent downgrade — *unless* the operator confirms the compatibility export (5.2).

For **legacy gate failure** on a project that *would* have routed GL: **hard-fail with fix hints** (update GPU driver, disable software rendering, check WebView2) rather than falling back to legacy — legacy exists for capability absence, not as a silent perf cliff.

**CRITICAL:** Never silently drop `effectGrade`. Either render it (GL path) or warn/fail.

### 5.4 Bring segment path under bounds — or retire it

| Option | Scope | Notes |
|---|---|---|
| **Retire legacy top-level path** | `useExport.ts` | When gate fails, show error UI instead of `exportProject`. Forces operator to fix environment. **CC-review:** changes default export behavior. |
| **Retire Tier C inside WebCodecs** | `exportPipelineWebCodecs.ts` | Replace canvas pieces with hard-fail + “unsupported effect combo” list. Requires expanding GL expressibility or accepting fewer exportable projects. |
| **Harden segment path** | `exportPipeline.ts` + `encodeCanvasPiece` | Port `TIER_PIECE_BOUND_MS`, destination-path guard, timeline gap guard (already shared), optional annexb concat + frame guard. **Does not** recover GL throughput — still PNG-per-frame. |
| **Fix gate root cause** | Machine 2 WebGL2 | Driver/WebView2/ANGLE investigation; if SwiftShader, surface in probe + block with message. |

**CC-review-required if touching:** any of the seven frozen constants, annexb byte layout, append batch size, recovery ladder rungs (`MAX_BOUNDARY_REWINDS_PER_EXPORT`, hardware failover, salvage), or encoded output digests in `architecture-ledger.md`.

**Not CC-review-required:** diagnostics-only fields, pre-export UI copy, recording `exportPathSelection`, wiring `gpuCapabilityProbe` output into diagnostics (probe already exists at cd60af6).

### 5.5 Immediate field checks (Machine 2)

1. In app DevTools console before export: `isWebCodecsExportCapable()`, `isWebCodecsExportToggleOn()`, `isWebGL2Supported()`.
2. Confirm absence of `[ws3-liveness] routing` log line during export.
3. Inspect `kinetix:ui:v1` → `webcodecsExportEnabled`.
4. After fix ships: verify diagnostics blob includes `exportPathSelection.topLevelPath`.

---

## Gates (this pass)

- `npx tsc --noEmit` — required clean
- `npm run lint` — required clean
- `git diff --name-only ws3-export-integration..HEAD` — three cd60af6 files + this doc only

---

## Cross-references

- Throughput / probe contract: `docs/ws3-export/windows-throughput-audit.md`
- Recovery ladder scope: `docs/ws3-export/recovery-architecture.md` §4b (Tier C ≠ failover)
- Frozen constants register: `docs/ws3-export/architecture-ledger.md` Round 17 final state
- Tier routing predicates: `src/services/webcodecsExport/glCompositable.ts`, `src/services/plainSegment.ts`
