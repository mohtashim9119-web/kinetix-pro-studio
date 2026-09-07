/**
 * WebCodecs+WebGL2 export orchestrator (docs/webcodecs-export-plan.md §4.4) —
 * main-thread sibling of `../exportPipeline.ts`, same `ExportResult` contract
 * (never throws; every failure path resolves a typed `ExportError`).
 *
 * STEP 5 SCOPE (this file): the Step 4 skeleton drove exactly ONE
 * GL-compositable run end to end, treating the WHOLE project as that one
 * run — a documented, temporary assumption. This step replaces that
 * assumption with a full-timeline orchestrator:
 *
 *   1. ROUTE every segment to a tier — Tier 1 (`isPlainVideoSegment`/
 *      `isPlainImageSegment`, `../plainSegment.ts`, UNCHANGED), Tier GL
 *      (`isGlCompositableSegment`, `./glCompositable.ts`, NEW this step), or
 *      Tier C (everything else — `encodeSegment`, `../segmentEncoder.ts`,
 *      UNCHANGED).
 *   2. SPLIT the routed timeline into "pieces": maximal contiguous runs of
 *      Tier-GL segments (driven by ONE worker call each, so a real
 *      transition between two GL segments renders as a single continuous
 *      encode — see `buildPiecePlans`'s own doc comment for why this is the
 *      only tier that benefits from multi-segment grouping), and one piece
 *      PER SEGMENT for Tier 1 / Tier C (both underlying encoders are
 *      inherently single-segment; grouping them would not reduce the number
 *      of `encodeSegment`/`encodePlainVideoSegment` calls, only complicate
 *      bookkeeping for no benefit — see §3.3 below).
 *   3. ENCODE each piece in timeline order, remuxing every Tier 1/C piece's
 *      MP4 output to raw annexb H.264 (`-bsf:v h264_mp4toannexb`) so every
 *      piece — GL-worker-streamed or remuxed — is the same annexb format.
 *   4. CONCAT every piece's annexb file in timeline order (ffmpeg concat
 *      protocol) → `video_all.h264`.
 *   5. GUARD: verify `video_all.h264`'s actual coded-frame count against the
 *      sum of every piece's own expected frame count — a typed `'concat'`
 *      error, never a silently short/corrupt export, on mismatch.
 *   6. MUX (`./muxOnly.ts`, unchanged) with the project's voiceover (or
 *      no-audio) → `export_final.mp4`.
 *
 * A MATERIAL REFINEMENT beyond the plan's own §3.2/§3.3 text, found while
 * implementing this step (see `buildPiecePlans`'s doc comment for the full
 * reasoning): the plan's routing predicate (`isGlCompositableSegment`)
 * decides each segment's tier independently by inspecting its OWN two
 * transition edges. That is not quite sufficient to guarantee "the only
 * cross-tier boundaries are hard cuts" (the plan's own §3.3 claim) — it is
 * possible for a segment to be individually GL-eligible with a REAL
 * (non-zero-duration) GL-slug transition into a neighbor that is
 * individually disqualified for an UNRELATED reason (e.g. its own color
 * filter). Routing the two segments to different tiers in that case would
 * either drop the transition (if the GL segment's run excludes its
 * partner) or double-render it (if both independently tried to render
 * their own side). This file's `groupConnectedComponents` step closes that
 * gap: segments connected by a real, GL-slug transition are unioned into one
 * component, and the WHOLE component downgrades to Tier C if ANY member is
 * individually ineligible — never split across a real transition. See that
 * function's doc comment for the full argument, including why this is
 * always SAFE (Tier C's `frameRenderer.ts` already implements all 4 GL
 * transition slugs — confirmed by reading its `applyTransitionBlend` switch
 * — so a downgraded segment's transition still renders identically) and the
 * one real cost (per-segment color GRADE, `effectGrade`, has NO renderer at
 * all on the legacy canvas path — confirmed by grep, zero references outside
 * the GL stack — so a downgraded graded segment loses grade in export,
 * exactly as it already does today under the current, unmodified
 * `exportPipeline.ts`; this is a pre-existing gap this step does not
 * introduce, not a new regression).
 *
 * Reuses `ExportError`/`ExportErrorKind`/`ExportResult`/`ExportStage`/
 * `ProgressCallback` from `../exportPipeline.ts` unmodified — including
 * `'cancelled'`, already present there — rather than inventing parallel
 * types.
 */

import type { Asset, HeadingOverlay, Project, TextOverlay, VideoSegment } from '../../types';
import {
  encodeSegment,
  encodePlainVideoSegment,
  encodeStaticImageSegment,
  type FfmpegLike,
} from '../segmentEncoder';
import type { FrameGlobalConfig } from '../frameRenderer';
import { resolveEffectiveTransition } from '../transitionResolver';
import { isPlainVideoSegment, isPlainImageSegment } from '../plainSegment';
import { checkTimelineIsGapless } from '../timelinePartition';
import { isGlCompositableSegment, GL_TRANSITION_SLUGS } from './glCompositable';
import type { ExportError, ExportLivenessSnapshot, ExportResult, ProgressCallback } from '../exportPipeline';
import type { ProjectEffectConfig } from '../gl/compositeParams';
import type {
  ExportWorkerInboundMessage,
  ExportWorkerInitMessage,
  ExportWorkerOutboundMessage,
} from './exportWorker';
import type { FontConfig } from './textRenderer';
import { resolveFontBytes } from './fontResolver';
import { muxOnly } from './muxOnly';
import { FONT_FAMILIES } from '../../constants';
import type { ExportDemuxSplit } from './exportPhaseTracker';
import {
  buildSilentGap,
  formatFailureMessage,
  pushPhaseLogEntry,
  type ExportPhaseLogEntry,
  type ExportWorkerDiagnosticsPayload,
  type SilentIntervalAttribution,
} from './exportWorkerDiagnostics';

export interface ExportOptionsWebCodecs {
  width?: number;
  height?: number;
  fps?: number;
  /**
   * STEP 4 / SPIKE-ONLY ESCAPE HATCH — unchanged from Step 4, still not
   * wired to any real caller (Step 7 hands this to `useExport.ts`). See the
   * Step 4 report for the full rationale; kept verbatim here.
   */
  savePath?: string;
}

/**
 * The minimal ffmpeg surface this orchestrator needs beyond `FfmpegLike`:
 * `appendFileRaw` (streams encoded chunks to disk — added to `TauriFfmpeg` in
 * Step 3), `saveSessionFile`/`kill`/`destroy` (existing `TauriFfmpeg`
 * methods, reused per plan §2). `TauriFfmpeg` already satisfies this
 * structurally; declared as its own interface here (rather than importing
 * the concrete class) so this file stays testable against a fake, matching
 * `segmentEncoder.ts`'s own `FfmpegLike` philosophy.
 */
export interface WebCodecsFfmpeg extends FfmpegLike {
  appendFileRaw(path: string, data: Uint8Array): Promise<void>;
  saveSessionFile(fileName: string, destPath: string): Promise<void>;
  kill(): Promise<void>;
  destroy(): Promise<void>;
  /**
   * Counts H.264 Annex B coded-picture NAL units in a session file entirely on
   * the native side (`TauriFfmpeg.countAnnexbFrames`, backed by the Rust
   * `ffmpeg_count_annexb_frames` command) — see the frame-count guard section
   * below for why this replaced a `readFile` + JS-scan approach.
   */
  countAnnexbFrames(path: string): Promise<number>;
  /**
   * Stream-concatenates `piecePaths` (in order) into a single `outputPath`
   * entirely on the native side (`TauriFfmpeg.concatAnnexbPieces`, backed by the
   * Rust `ffmpeg_concat_annexb_pieces` command) — only 2 file descriptors are
   * ever open, independent of piece count. Replaced the ffmpeg concat-protocol
   * (`-i concat:a|b|c|...`), which opened every piece simultaneously and
   * exhausted macOS's default 256 per-process FD limit on large-segment exports.
   */
  concatAnnexbPieces(piecePaths: string[], outputPath: string): Promise<void>;
}

import {
  withFfmpegLivenessBound,
  FfmpegBoundExpiredError,
  TIER_PIECE_BOUND_MS,
  REMUX_BOUND_MS,
  CONCAT_BOUND_MS,
  FRAME_COUNT_BOUND_MS,
  MUX_BOUND_MS,
} from './ffmpegLivenessBound';

function causeString(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * WS3 Defect 2 — an expired ffmpeg liveness bound must reach the user as
 * ITSELF (its own message plus the standard diagnostics payload), not folded
 * into the generic "Failed to ..." wording of whatever step it interrupted.
 * Any other failure keeps the pre-existing shape exactly.
 */
function boundedStepError(kind: ExportError['kind'], fallbackMessage: string, err: unknown): ExportError {
  if (err instanceof FfmpegBoundExpiredError) {
    return { kind, message: err.message, cause: JSON.stringify(err.diagnostics) };
  }
  return { kind, message: fallbackMessage, cause: causeString(err) };
}

// ---------------------------------------------------------------------------
// Single-active-export state (plan §9.3: one export at a time, same as the
// legacy path — the export UI already prevents re-entry). Mirrors
// exportWorker.ts's own module-level `running`/`cancelRequested` singleton
// pattern. Lets `cancelExportWebCodecs` reach the in-flight worker/ffmpeg
// without threading a handle back out of `exportProjectWebCodecs`'s plain
// `Promise<ExportResult>` return type (the plan's own public API shape,
// §4.4 — no wrapper object). `activeFfmpeg` now stays set for the ENTIRE
// multi-piece export (not just one run), so a cancel that lands while a
// Tier 1/C `ffmpeg.exec` is in flight (no worker active at that moment)
// still has something to kill — see this file's header, cancel sequence.
// ---------------------------------------------------------------------------

let activeWorker: Worker | null = null;
let activeFfmpeg: WebCodecsFfmpeg | null = null;

/**
 * Cancel sequence (plan §9.1, adapted for this step — Step 7 wires the
 * generation-counter/useExport.ts side): post `cancel` to the worker (if a
 * GL piece is currently driving one), terminate it (hard stop in case it's
 * wedged), kill whatever ffmpeg subprocess is in flight (a GL piece's
 * append, a Tier 1/C piece's encode/remux, the concat, or the mux — all run
 * through the same `ffmpeg.exec`/`appendFileRaw`, so one kill covers
 * whichever phase is active), then destroy the session. `destroy()` is
 * idempotent (`TauriFfmpeg`'s own doc comment), so a caller that also tears
 * down its own ffmpeg handle afterward is safe.
 */
export async function cancelExportWebCodecs(): Promise<void> {
  const worker = activeWorker;
  const ffmpeg = activeFfmpeg;
  activeWorker = null;
  activeFfmpeg = null;
  if (worker) {
    const cancelMsg: ExportWorkerInboundMessage = { type: 'cancel' };
    worker.postMessage(cancelMsg);
    worker.terminate();
  }
  if (ffmpeg) {
    await ffmpeg.kill();
    await ffmpeg.destroy();
  }
}

// ---------------------------------------------------------------------------
// Part 1 — Routing (plan §3.2/§3.3, refined — see this file's own header).
// ---------------------------------------------------------------------------

type Tier = 'plain' | 'gl' | 'canvas';

/**
 * Per-segment tier BEFORE the cross-segment consistency pass
 * (`groupConnectedComponents` below) — decided purely from each segment's
 * own fields + its immediate neighbors, exactly matching
 * `exportPipeline.ts`'s own Tier 1 gating (asset-type-specific predicate)
 * and `glCompositable.ts`'s own contract.
 */
function computeIndividualTier(
  segment: VideoSegment,
  prev: VideoSegment | undefined,
  next: VideoSegment | undefined,
  project: Project,
  assetMap: Map<string, Asset>,
): Tier {
  const asset = segment.assetId ? assetMap.get(segment.assetId) : undefined;
  const isPlain =
    (!!asset && asset.type === 'video' && isPlainVideoSegment(segment, prev, next, project)) ||
    (!!asset && asset.type === 'image' && isPlainImageSegment(segment, prev, next, project));
  if (isPlain) return 'plain';
  return isGlCompositableSegment(segment, project, { prev, next }) ? 'gl' : 'canvas';
}

/** Tiny union-find over segment array indices — see `groupConnectedComponents`. */
class UnionFind {
  private readonly parent: number[];
  constructor(n: number) {
    this.parent = Array.from({ length: n }, (_, i) => i);
  }
  find(x: number): number {
    while (this.parent[x] !== x) {
      this.parent[x] = this.parent[this.parent[x]!]!;
      x = this.parent[x]!;
    }
    return x;
  }
  union(a: number, b: number): void {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra !== rb) this.parent[ra] = rb;
  }
}

/**
 * Closes the gap described in this file's top-level header: unions any two
 * ADJACENT segments connected by a real (>0 duration), GL-slug transition —
 * `isGlCompositableSegment` guarantees BOTH sides of such an edge
 * individually pass their own edge check (they resolve the identical
 * `resolveEffectiveTransition` call), but says nothing about whether either
 * side is disqualified for some UNRELATED reason. A legacy-enum or
 * zero-duration edge is never unioned — both of those cases already leave
 * both sides free to land in whatever tier their own fields dictate (a
 * legacy-enum edge already independently fails BOTH sides' own edge check,
 * and a zero-duration edge is a hard cut, which is exactly the boundary type
 * safe to split on).
 *
 * For each resulting connected component: if every member is individually
 * `'gl'`, the whole component stays `'gl'` (one worker run renders the real
 * transition(s) inside it continuously — exactly what the GL run grouping
 * needs). If ANY member is individually `'plain'` or `'canvas'`, the WHOLE
 * component downgrades to `'canvas'` — never split a real transition across
 * a GL/non-GL boundary. (A `'plain'` member can never actually appear in a
 * component of size > 1: Tier 1 requires zero-duration transitions on BOTH
 * of its own edges, so a `'plain'` segment can never be the source OR target
 * of a real-transition union — included in the check only for completeness/
 * defensiveness, not because it is reachable.)
 *
 * This downgrade is always SAFE: `frameRenderer.ts`'s `applyTransitionBlend`
 * implements all 4 GL transition slugs (`cross-dissolve`/`dip-black`/
 * `dip-white`/`light-leak` — confirmed by reading its `switch`), so a
 * downgraded segment's transition renders identically on the canvas path.
 * The one real cost is per-segment color grade (`effectGrade`) — GL-only,
 * confirmed by grep (zero references in `frameRenderer.ts`/
 * `segmentEncoder.ts`/`exportPipeline.ts`) — so a downgraded graded segment
 * loses grade in export, exactly as it already does today under the
 * current, UNMODIFIED legacy pipeline (not a regression this step
 * introduces).
 */
function groupConnectedComponents(
  segments: readonly VideoSegment[],
  individualTiers: readonly Tier[],
  project: Project,
): Tier[] {
  const n = segments.length;
  const uf = new UnionFind(n);
  for (let i = 0; i < n - 1; i++) {
    const resolved = resolveEffectiveTransition(
      segments[i]!,
      project.globalTransition,
      project.globalTransitionDuration,
    );
    if (resolved.duration > 0 && GL_TRANSITION_SLUGS.has(resolved.transition)) {
      uf.union(i, i + 1);
    }
  }

  const componentHasNonGl = new Map<number, boolean>();
  for (let i = 0; i < n; i++) {
    if (individualTiers[i] === 'plain') continue; // never part of a real-transition component (see doc comment)
    if (individualTiers[i] !== 'gl') componentHasNonGl.set(uf.find(i), true);
  }

  return individualTiers.map((tier, i) => {
    if (tier === 'plain') return 'plain';
    return componentHasNonGl.get(uf.find(i)) ? 'canvas' : 'gl';
  });
}

interface RoutingResult {
  tiers: Tier[];
}

function routeSegments(project: Project, assetMap: Map<string, Asset>): RoutingResult | { error: ExportError } {
  const segments = project.segments;
  const n = segments.length;
  const individualTiers: Tier[] = new Array(n);
  for (let i = 0; i < n; i++) {
    individualTiers[i] = computeIndividualTier(segments[i]!, segments[i - 1], segments[i + 1], project, assetMap);
  }
  const finalTiers = groupConnectedComponents(segments, individualTiers, project);

  // Defensive loud-failure assertion (plan §4.4's own instruction: "assert
  // it loudly ... don't silently produce a broken split"). Proven
  // unreachable by `groupConnectedComponents`'s own construction — every
  // real-duration GL edge is unioned into one component before tier
  // assignment, and any edge left OUTSIDE a union is either a hard cut
  // (duration 0) or a legacy-enum transition that already independently
  // fails both sides' own tier computation (both land in 'canvas'). If this
  // ever trips, it indicates an actual bug in the routing/grouping logic
  // above, not a normal project configuration.
  for (let i = 0; i < n - 1; i++) {
    if (finalTiers[i] === finalTiers[i + 1]) continue;
    const resolved = resolveEffectiveTransition(segments[i]!, project.globalTransition, project.globalTransitionDuration);
    if (resolved.duration > 0) {
      return {
        error: {
          kind: 'concat',
          message:
            `Internal routing error: segment "${segments[i]!.id}" -> "${segments[i + 1]!.id}" ` +
            `is a real (${resolved.duration}s) transition spanning a tier boundary (${finalTiers[i]} -> ${finalTiers[i + 1]}). ` +
            'This should be structurally impossible — aborting rather than producing a broken export.',
        },
      };
    }
  }

  return { tiers: finalTiers };
}

// ---------------------------------------------------------------------------
// Part 2 — Piece planning (plan §3.3).
//
// A "piece" is one unit of encode work that produces exactly one annexb
// file. Tier GL pieces may span multiple segments (see `groupConnectedComponents`
// above — needed so a real transition between two GL segments renders as one
// continuous worker stream). Tier 1 and Tier C pieces are always exactly one
// segment: `encodePlainVideoSegment`/`encodeStaticImageSegment`/`encodeSegment`
// are all inherently single-segment functions (unchanged this step), and
// concatenating N single-segment annexb pieces in timeline order is
// byte-identical to concatenating one N-segment "grouped" piece would be —
// annexb concatenation is pure byte concatenation, so there is no efficiency
// or correctness reason to batch Tier 1/C beyond what their own encoders
// already do internally (Tier C's own per-segment transition blending, via
// `nextSegment`/`startTimeOffset`/`trailingExtension`, already produces a
// clean frame-for-frame handoff at its own boundaries — exactly matching
// today's `exportPipeline.ts` behavior).
// ---------------------------------------------------------------------------

interface PiecePlan {
  tier: Tier;
  /** Timeline-contiguous, in order. Length 1 for 'plain'/'canvas'; length >= 1 for 'gl'. */
  segments: VideoSegment[];
  /** Absolute index of `segments[0]` within `project.segments` — used to look
   *  up the TRUE prev/next neighbors (from the full project, not the piece's
   *  own slice) for Tier C's transition-blend rendering. */
  startIndex: number;
  /** Expected frame count this piece will contribute — computed BEFORE
   *  encoding (same formulas the encoders themselves use), so the total is
   *  known up front for progress reporting and the frame-count guard. */
  expectedFrames: number;
  /** GL only (WS3 Defect 1). Frame-grid origin, in timeline seconds: the
   *  `startTime` of the FIRST segment of the whole GL RUN this piece came
   *  from, NOT of this piece. Every piece cut out of one run shares one
   *  origin, so their frame grids are one continuous absolute grid rather
   *  than N independently-rounded local ones. Equal to `segments[0].startTime`
   *  for an unsplit run (and for every Tier 1/C piece, which ignores it). */
  gridOriginSec: number;
  /** GL only (WS3 Defect 1). This piece's first frame's index ON that grid:
   *  `Math.round((segments[0].startTime - gridOriginSec) * fps)`. 0 for an
   *  unsplit run. */
  gridBaseFrame: number;
}

/**
 * WS3 Defect 1 — the encoder-session cap.
 *
 * Before this, `buildPiecePlans` coalesced EVERY maximal run of adjacent
 * 'gl'-tier segments into a single PiecePlan, with no bound of any kind on the
 * resulting piece's duration, frame count, or encoder-session length. Field
 * evidence: a 334-segment 1080p30 project collapsed to `pieceIndex 0` and ran
 * ONE VideoEncoder session across 38061 frames (1268.7s of timeline) before
 * the watchdog fired in `encoder-flush`.
 *
 * Why a bound is needed at all — and why this number:
 *
 *  - A piece boundary is a WORKER boundary (`driveGlRun` constructs a fresh
 *    `Worker` per GL piece and `terminate()`s it at the end), so it is the
 *    only place in this pipeline where every per-run accumulator resets to
 *    zero at once: the worker's demux cache, its `ImageBitmap` map, its
 *    decode cursors, the encoder's own internal state, and the main thread's
 *    per-run event/attribution arrays. Capping the piece therefore caps every
 *    one of those, which is the whole of Defect 7's growth surface.
 *  - It is also the unit of ATTRIBUTION. With one piece, a failure payload can
 *    only ever say `pieceIndex 0`; with a cap it names a bounded span of
 *    timeline.
 *
 *  1800 frames = 60s at 30fps. The cap is stated in FRAMES, not seconds,
 *  because every accumulator above grows per frame, not per second.
 *
 *  HONEST CAVEAT: 1800 is a judgement call, not a measured cliff. The prior
 *  "~62s platform ceiling" this round was told to evaluate has since been
 *  REFUTED in this repo's own history (commit 4d4922c), so it is deliberately
 *  NOT the basis for this number, and the 1268.7s field failure gives an upper
 *  bound on what is too much but no lower bound on what is enough. What 1800
 *  buys is a 21x reduction in every per-frame accumulator against a per-piece
 *  fixed cost (GL context + shader compile + font init) that the phase log
 *  already measures. Tune it from a real run's `phaseMs`, not from this
 *  comment.
 */
export const MAX_ENCODER_SESSION_FRAMES = 1800;

/** Absolute frame index of `sec` on the grid anchored at `originSec`. */
function gridFrame(sec: number, originSec: number, fps: number): number {
  return Math.round((sec - originSec) * fps);
}

/**
 * Is local index `k` inside `run` a LEGAL place to end one piece and begin the
 * next? Two conditions, and both are what makes a split output-neutral by
 * construction rather than by measurement:
 *
 *  1. `k` is a SEGMENT START. `exportWorker.ts` forces a keyframe on the first
 *     frame of every segment in its run (`segmentStartFrames` / `isKeyFrame`),
 *     so the frame that becomes the new encoder session's IDR was already
 *     going to be an IDR in the unsplit run. A split at a segment start
 *     therefore adds no keyframe that was not already there.
 *  2. NO TRANSITION STRADDLES `k`. A real (duration > 0) transition out of
 *     `run[k-1]` is CENTERED on the boundary, so frames on both sides of it
 *     composite BOTH segments. Cutting there would put half of that blend in a
 *     piece whose `segments` array no longer contains the outgoing segment,
 *     and `deriveSlotPlan` would then composite something different. So a
 *     candidate boundary with a straddling transition is not moved out of the
 *     way of the transition — the BOUNDARY moves, to the nearest earlier hard
 *     cut (see `planGlRunPieceStarts`), and the transition is never touched.
 */
function isLegalPieceBoundary(run: readonly VideoSegment[], k: number, project: Project): boolean {
  const prev = run[k - 1];
  if (!prev) return false;
  return resolveEffectiveTransition(prev, project.globalTransition, project.globalTransitionDuration).duration <= 0;
}

/**
 * Local indices in `run` at which a new piece begins. Always starts with 0.
 *
 * Greedy: extend the current piece until its frame span would exceed
 * `capFrames`, then cut at the LAST legal boundary seen since this piece
 * began. A run with no legal boundary at all (every segment joined to the next
 * by a real transition) returns `[0]` — it stays one piece, because splitting
 * it could not be output-neutral. That is a deliberate, stated limit of this
 * fix, not an oversight.
 */
function planGlRunPieceStarts(
  run: readonly VideoSegment[],
  project: Project,
  fps: number,
  originSec: number,
  capFrames: number,
): number[] {
  const starts = [0];
  let pieceStartFrame = gridFrame(run[0]!.startTime, originSec, fps);
  let lastLegal = -1;
  for (let k = 1; k < run.length; k++) {
    if (isLegalPieceBoundary(run, k, project)) lastLegal = k;
    const seg = run[k]!;
    const endFrame = gridFrame(seg.startTime + seg.duration, originSec, fps);
    if (endFrame - pieceStartFrame > capFrames && lastLegal > starts[starts.length - 1]!) {
      starts.push(lastLegal);
      pieceStartFrame = gridFrame(run[lastLegal]!.startTime, originSec, fps);
      // Resume scanning FROM the cut, so legal boundaries between `lastLegal`
      // and `k` are still available to the new piece. Terminates: `lastLegal`
      // is strictly greater than the previous piece start every time, so the
      // piece-start sequence is strictly increasing and bounded by run.length.
      k = lastLegal;
      lastLegal = -1;
    }
  }
  return starts;
}

function buildPiecePlans(
  project: Project,
  tiers: readonly Tier[],
  fps: number,
  assetMap: Map<string, Asset>,
): PiecePlan[] {
  const segments = project.segments;
  const n = segments.length;
  const pieces: PiecePlan[] = [];
  let i = 0;
  while (i < n) {
    const tier = tiers[i]!;
    if (tier === 'gl') {
      let j = i;
      while (j + 1 < n && tiers[j + 1] === 'gl') j++;
      const runSegments = segments.slice(i, j + 1);
      // ONE origin for the whole run, shared by every piece cut out of it
      // (WS3 Defect 1). This is what makes the split exactly frame-neutral:
      // each piece's span is `gridFrame(pieceEnd) - gridFrame(pieceStart)` on
      // ONE grid, so the per-piece counts TELESCOPE — they sum to
      // `gridFrame(runEnd) - gridFrame(runStart)`, which is byte-for-byte the
      // single number the unsplit run produced. Splitting can therefore never
      // add or drop a frame, and the post-concat frame-count guard sees the
      // same total either way.
      const originSec = runSegments[0]!.startTime;
      const pieceStarts = planGlRunPieceStarts(runSegments, project, fps, originSec, MAX_ENCODER_SESSION_FRAMES);
      for (let p = 0; p < pieceStarts.length; p++) {
        const from = pieceStarts[p]!;
        const to = p + 1 < pieceStarts.length ? pieceStarts[p + 1]! : runSegments.length;
        const pieceSegments = runSegments.slice(from, to);
        const first = pieceSegments[0]!;
        const last = pieceSegments[pieceSegments.length - 1]!;
        const gridBaseFrame = gridFrame(first.startTime, originSec, fps);
        const endFrame = gridFrame(last.startTime + last.duration, originSec, fps);
        pieces.push({
          tier: 'gl',
          segments: pieceSegments,
          startIndex: i + from,
          expectedFrames: Math.max(0, endFrame - gridBaseFrame),
          gridOriginSec: originSec,
          gridBaseFrame,
        });
      }
      i = j + 1;
    } else if (tier === 'plain') {
      const segment = segments[i]!;
      const asset = segment.assetId ? assetMap.get(segment.assetId) : undefined;
      // segmentEncoder.ts's two Tier 1 encoders do NOT compute frame count
      // the same way:
      //   - encodeStaticImageSegment (image) passes an EXPLICIT
      //     `-frames:v Math.max(1, Math.round(duration * fps))` cap
      //     (segmentEncoder.ts ~line 528/534) — Math.round is exactly right.
      //   - encodePlainVideoSegment (video) has NO frame cap at all — it
      //     relies on ffmpeg's own `-t <duration> -r <fps>` output-side
      //     trim/CFR conversion (segmentEncoder.ts ~lines 426-444), which
      //     emits one frame per `n/fps < duration` for n = 0, 1, 2, ... —
      //     i.e. `Math.ceil(duration * fps)` frames, not
      //     `Math.round(duration * fps)`. Verified empirically against a
      //     real ffmpeg 8.1.1 encode+ffprobe count: e.g. duration=2.983s @
      //     30fps rounds to 89 but ffmpeg actually emits 90 (=ceil) frames;
      //     this is exactly the class of case (fractional frame count in
      //     (0, 0.5) above an integer) that produced the reported 985-vs-984
      //     mismatch. Using Math.round here for a video segment silently
      //     undercounts by 1 whenever that fraction lands in (0, 0.5).
      const expectedFrames =
        asset?.type === 'video'
          ? Math.max(1, Math.ceil(segment.duration * fps))
          : Math.max(1, Math.round(segment.duration * fps));
      pieces.push({
        tier: 'plain',
        segments: [segment],
        startIndex: i,
        expectedFrames,
        gridOriginSec: segment.startTime,
        gridBaseFrame: 0,
      });
      i++;
    } else {
      const segment = segments[i]!;
      const prev = segments[i - 1];
      const next = segments[i + 1];
      const startTimeOffset = prev
        ? resolveEffectiveTransition(prev, project.globalTransition, project.globalTransitionDuration).duration / 2
        : 0;
      const trailingExtension = next
        ? resolveEffectiveTransition(segment, project.globalTransition, project.globalTransitionDuration).duration / 2
        : 0;
      const expectedFrames = Math.max(1, Math.round((segment.duration - startTimeOffset + trailingExtension) * fps));
      pieces.push({
        tier: 'canvas',
        segments: [segment],
        startIndex: i,
        expectedFrames,
        gridOriginSec: segment.startTime,
        gridBaseFrame: 0,
      });
      i++;
    }
  }
  return pieces;
}

export type WebCodecsTier = 'plain' | 'gl' | 'canvas';

export interface WebCodecsPieceSummary {
  tier: WebCodecsTier;
  startIndex: number;
  segmentCount: number;
  expectedFrames: number;
  /** WS3 Defect 1 — see `PiecePlan.gridOriginSec`. */
  gridOriginSec: number;
  /** WS3 Defect 1 — see `PiecePlan.gridBaseFrame`. */
  gridBaseFrame: number;
}

export interface WebCodecsRoutingSummary {
  pieces: WebCodecsPieceSummary[];
  segmentCounts: { plain: number; gl: number; canvas: number };
  pieceCounts: { plain: number; gl: number; canvas: number };
}

export interface WebCodecsGlPieceDiagnostics extends ExportWorkerDiagnosticsPayload {
  maxSilentMs: number;
  appendDrainMs: number;
  silentIntervals: SilentIntervalAttribution[];
  aborted: boolean;
  appendCallCount: number;
  appendBytes: number;
}

export interface WebCodecsRunDiagnostics {
  routing: WebCodecsRoutingSummary;
  glPieces: WebCodecsGlPieceDiagnostics[];
  concatMs: number | null;
  muxMs: number | null;
  watchdogFired: boolean;
  watchdogPhase: string | null;
}

/** Last WebCodecs export's measurement blob — read by the throwaway liveness probe. */
export let lastWebCodecsRunDiagnostics: WebCodecsRunDiagnostics | null = null;

function countTiers(tiers: readonly WebCodecsTier[]): { plain: number; gl: number; canvas: number } {
  const counts = { plain: 0, gl: 0, canvas: 0 };
  for (const t of tiers) counts[t]++;
  return counts;
}

/** Pure routing preview — same predicates the live orchestrator uses. */
export function planWebCodecsExport(project: Project, fps: number): WebCodecsRoutingSummary | { error: ExportError } {
  const assetMap = new Map<string, Asset>(project.assets.map((a) => [a.id, a]));
  const routing = routeSegments(project, assetMap);
  if ('error' in routing) return routing;
  const pieces = buildPiecePlans(project, routing.tiers, fps, assetMap);
  const pieceCounts = { plain: 0, gl: 0, canvas: 0 };
  for (const p of pieces) pieceCounts[p.tier]++;
  return {
    pieces: pieces.map((p) => ({
      tier: p.tier,
      startIndex: p.startIndex,
      segmentCount: p.segments.length,
      expectedFrames: p.expectedFrames,
      gridOriginSec: p.gridOriginSec,
      gridBaseFrame: p.gridBaseFrame,
    })),
    segmentCounts: countTiers(routing.tiers),
    pieceCounts,
  };
}

// ---------------------------------------------------------------------------
// Part 3 — Driving a GL piece (unchanged from Step 4 — the worker driving,
// chunk-append serialization, and watchdog logic below are exactly Step 4's
// `driveGlRun`, generalized only in that the caller now invokes it once per
// GL piece instead of exactly once for the whole project).
// ---------------------------------------------------------------------------

type RunDriveResult =
  | {
      ok: true;
      frameCount: number;
      diagnostics: ExportWorkerDiagnosticsPayload;
      maxSilentMs: number;
      appendDrainMs: number;
      silentIntervals: SilentIntervalAttribution[];
      appendCallCount: number;
      appendBytes: number;
    }
  | {
      ok: false;
      error: ExportError;
      diagnostics: ExportWorkerDiagnosticsPayload | null;
      silentIntervals: SilentIntervalAttribution[];
      appendCallCount: number;
      appendBytes: number;
    };

/** Unchanged 30s bound — exported so tests can assert the value and drive
 *  fake timers against the same constant the production path uses. */
export const WATCHDOG_MS = 30_000;

/**
 * Forward-progress bound (WS3 Part D) — a SECOND, independent timer alongside
 * WATCHDOG_MS, not a replacement for it. WATCHDOG_MS resets on ANY worker
 * message, including 'queue-sample' (exportWorker.ts's per-5-frames
 * `encoder.encodeQueueSize` ping, posted right after `encoder.encode()` is
 * CALLED — proof a frame was submitted, not proof its output was ever
 * produced or reached disk). A worker that keeps submitting frames into a
 * stalling encode/composite pipeline can keep resetting WATCHDOG_MS
 * indefinitely while real forward progress has stopped — reproduced live: a
 * 500-segment transitioned/animated run stalled at frame 93 yet accumulated a
 * 131.8s silent gap (4.4x WATCHDOG_MS) before the message-based watchdog
 * finally saw a true gap in ALL messages and fired.
 *
 * This timer resets ONLY on an actual completed append (`appendCallCount`
 * incrementing, immediately after a successful `ffmpeg.appendFileRaw` —
 * see the 'chunk' case below) — a real byte-for-byte increment of on-disk
 * export progress, never a bare message arrival.
 *
 * 45s (1.5x WATCHDOG_MS): the measured no-transition baseline (200s timeline,
 * 6000 frames, 126s wall — docs/history.md Round 6) runs at ~21ms/frame.
 * Transitioned/animated frames composite two textures + a zoom transform
 * instead of one and are measurably slower, but nowhere near 45s/frame under
 * any non-hung condition — this bound is sized to absorb that slowdown many
 * times over (including backpressure waits, `waitForDequeue`) while still
 * firing far faster than the un-bounded message-based watchdog does when
 * trickling non-progress messages keep deferring it.
 */
export const FORWARD_PROGRESS_BOUND_MS = 45_000;

/**
 * WS3 Defect 7 — smallest output gap worth recording as a silent interval,
 * and the hard cap on how many are kept.
 *
 * 250 ms is PHASE_THROTTLE_MS: below it a gap cannot even span one phase pulse,
 * so it has nothing to be attributed to, and at baseline cadence (~21 ms/frame,
 * one chunk per frame) it is more than 10x the ordinary inter-chunk spacing.
 * The previous code used 0, which recorded a "gap" between every consecutive
 * pair of the ~45k per-frame events.
 *
 * 256 bounds the retained set at roughly 50 KB per GL piece (~1.2 MB across a
 * 23-piece export, all of it retained in `WebCodecsRunDiagnostics.glPieces`).
 * Eviction keeps the LONGEST gaps, so a stuttery run cannot push the one gap
 * that mattered out of the record.
 */
export const SILENT_INTERVAL_MIN_MS = 250;
export const SILENT_INTERVAL_CAP = 256;

/**
 * Minimal Worker surface `driveGlRun` needs. Production uses a real module
 * Worker; tests inject a fake so this function can run in node/vitest
 * without constructing `exportWorker.ts`.
 */
export interface ExportWorkerHandle {
  postMessage(message: unknown): void;
  terminate(): void;
  onmessage: ((ev: MessageEvent<ExportWorkerOutboundMessage>) => void) | null;
  onerror: ((ev: ErrorEvent) => void) | null;
}

export interface DriveGlRunDeps {
  createWorker?: () => ExportWorkerHandle;
  now?: () => number;
}

/**
 * WS3 Defect 1 — the absolute frame grid this piece sits on. See `PiecePlan`'s
 * `gridOriginSec`/`gridBaseFrame`. Defaulted so an unsplit run (and every
 * existing caller/test) drives exactly the pre-cap behaviour.
 */
export interface GlRunGrid {
  originSec: number;
  baseFrame: number;
}

export function driveGlRun(
  ffmpeg: WebCodecsFfmpeg,
  runId: string,
  runFile: string,
  segments: VideoSegment[],
  assets: Asset[],
  config: ProjectEffectConfig,
  width: number,
  height: number,
  fps: number,
  totalExpectedFrames: number,
  onFrameProgress: (frame: number, totalFrames: number) => void,
  textConfig: {
    fontConfigs: FontConfig[];
    globalOverlayConfig: Project['globalOverlayConfig'];
    textLayers: TextOverlay[];
    headings: HeadingOverlay[];
  },
  pieceIndex: number,
  startIndex: number,
  deps: DriveGlRunDeps = {},
  grid: GlRunGrid = { originSec: segments[0]?.startTime ?? 0, baseFrame: 0 },
): Promise<RunDriveResult> {
  return new Promise((resolve) => {
    const worker = deps.createWorker
      ? deps.createWorker()
      : new Worker(new URL('./exportWorker.ts', import.meta.url), { type: 'module' });
    activeWorker = worker as Worker;
    const now = deps.now ?? (() => performance.now());
    const runStartedAt = now();

    let appendQueue: Promise<void> = Promise.resolve();
    let appendError: Error | null = null;
    let appendCallCount = 0;
    let appendBytes = 0;
    let settled = false;
    let watchdogTimer: ReturnType<typeof setTimeout> | null = null;
    let progressBoundTimer: ReturnType<typeof setTimeout> | null = null;
    let lastPhase: string | null = 'init';
    let lastPhaseAt = now();
    let lastPieceIndex = pieceIndex;
    let lastFramesEncoded = 0;
    let lastOutputAt = now();
    /** WS3 export-liveness-occlusion round: monotonic-clock anchor mirroring
     *  FORWARD_PROGRESS_BOUND_MS's own reset condition exactly (set only
     *  where `resetProgressBound` is called, i.e. only after a real append
     *  completes) — lets `checkLivenessBounds` evaluate "time since real
     *  progress" from a message receipt instead of waiting on
     *  `progressBoundTimer`'s own `setTimeout` to fire on schedule. */
    let lastRealProgressAt = now();
    let maxSilentMs = 0;
    let lastWorkerDiagnostics: ExportWorkerDiagnosticsPayload | null = null;
    const phaseLog: ExportPhaseLogEntry[] = [];
    /**
     * WS3 Defect 7 — replaces the unbounded `outputEvents` array.
     *
     * That array held one entry per `chunk` AND per `queue-sample` for the
     * whole run — ~45k objects on the 38061-frame field run — and was then fed
     * to `attributeSilentIntervals` with `minDurationMs = 0`, which produces
     * one attribution per CONSECUTIVE PAIR: another ~45k objects, retained per
     * GL piece in `WebCodecsRunDiagnostics.glPieces` for the whole export. Both
     * grew strictly per frame.
     *
     * Now a gap is attributed the moment it CLOSES (`buildSilentGap`), so the
     * only thing retained is gaps worth looking at. Memory is O(notable gaps),
     * hard-capped below, instead of O(frames) — and the attribution is more
     * accurate too, because it reads the phase log while the gap's own entries
     * are still in it rather than after it has rolled over.
     */
    const recordedIntervals: SilentIntervalAttribution[] = [];
    let outputEventCount = 0;
    let lastOutputRelMs = 0;

    const relMs = (): number => now() - runStartedAt;

    /** Keep the LONGEST gaps once at cap — a short gap that was evicted was
     *  never the one anyone was looking for. */
    const retainInterval = (interval: SilentIntervalAttribution): void => {
      if (recordedIntervals.length < SILENT_INTERVAL_CAP) {
        recordedIntervals.push(interval);
        return;
      }
      let shortestAt = 0;
      for (let i = 1; i < recordedIntervals.length; i++) {
        if (recordedIntervals[i]!.durationMs < recordedIntervals[shortestAt]!.durationMs) shortestAt = i;
      }
      if (interval.durationMs > recordedIntervals[shortestAt]!.durationMs) {
        recordedIntervals[shortestAt] = interval;
      }
    };

    const recordOutput = (kind: 'chunk' | 'queue-sample'): void => {
      void kind; // kept in the signature for call-site readability at both sites
      const t = relMs();
      const gapStart = outputEventCount === 0 ? 0 : lastOutputRelMs;
      const interval = buildSilentGap(gapStart, t, phaseLog, SILENT_INTERVAL_MIN_MS);
      if (interval) retainInterval(interval);
      maxSilentMs = Math.max(maxSilentMs, t - gapStart);
      outputEventCount++;
      lastOutputRelMs = t;
      lastOutputAt = now();
    };

    const noteWatchdogOutput = (): void => {
      const t = now();
      maxSilentMs = Math.max(maxSilentMs, t - lastOutputAt);
      lastOutputAt = t;
    };

    const mergePhaseFromWorker = (entries: readonly ExportPhaseLogEntry[]): void => {
      for (const e of entries) {
        pushPhaseLogEntry(phaseLog, e);
      }
    };

    const reconstructDiagnostics = (): ExportWorkerDiagnosticsPayload => {
      if (lastWorkerDiagnostics) return lastWorkerDiagnostics;
      return {
        phaseMs: {},
        instrumentationMs: 0,
        demuxSplit: [],
        framesEncoded: lastFramesEncoded,
        pieceIndex: lastPieceIndex,
        lastPhase,
        phaseLog: phaseLog.slice(),
        failure: null,
        demuxCacheSize: null,
        workerHeapBytes: null,
        decodedSourceFrames: 0,
        encodedChunkCount: 0,
        encodedKeyframeCount: 0,
        encodedChunkBytes: 0,
        encodedChunkCountAtFlushStart: null,
        decodersCreated: 0,
        decodersOpen: 0,
        cursorsCreated: 0,
        openCursors: 0,
        peakOpenCursors: 0,
        openImageBitmaps: 0,
        frameContentDigest: null,
        frameContentDigestFrames: null,
      };
    };

    /** Everything retained so far, plus the still-open terminal gap — which is
     *  always reported regardless of length, exactly as
     *  `attributeSilentIntervals`'s `endMs` clause did. */
    const silentIntervals = (): SilentIntervalAttribution[] => {
      const terminal = buildSilentGap(outputEventCount === 0 ? 0 : lastOutputRelMs, relMs(), phaseLog, 0);
      return terminal ? [...recordedIntervals, terminal] : [...recordedIntervals];
    };

    const snapshotLiveness = (): ExportLivenessSnapshot => ({
      lastPhase,
      msSinceLastPhaseChange: now() - lastPhaseAt,
      pieceIndex: lastPieceIndex,
      framesEncoded: lastFramesEncoded,
      maxSilentMs: Math.max(maxSilentMs, now() - lastOutputAt),
    });

    const errorFromDiagnostics = (
      kind: ExportError['kind'],
      diagnostics: ExportWorkerDiagnosticsPayload,
      fallbackMessage: string,
    ): ExportError => {
      const msg = diagnostics.failure ? formatFailureMessage(diagnostics.failure) : fallbackMessage;
      return {
        kind,
        message: msg,
        cause: diagnostics.failure?.message,
        liveness: snapshotLiveness(),
      };
    };

    const clearWatchdog = (): void => {
      if (watchdogTimer) {
        clearTimeout(watchdogTimer);
        watchdogTimer = null;
      }
    };

    const clearProgressBound = (): void => {
      if (progressBoundTimer) {
        clearTimeout(progressBoundTimer);
        progressBoundTimer = null;
      }
    };

    const finish = (result: RunDriveResult): void => {
      if (settled) return;
      settled = true;
      clearWatchdog();
      clearProgressBound();
      if (activeWorker === worker) activeWorker = null;
      worker.terminate();
      resolve(result);
    };

    const finishWatchdog = (): void => {
      if (settled) return;
      worker.postMessage({ type: 'request-diagnostics' });
      setTimeout(() => {
        const diagnostics = reconstructDiagnostics();
        diagnostics.failure = {
          name: null,
          message: 'Export worker produced no output for 30s — aborting (watchdog).',
          via: 'watchdog',
          frameIndex: diagnostics.framesEncoded > 0 ? diagnostics.framesEncoded - 1 : null,
          timelineSec: null,
        };
        finish({
          ok: false,
          error: errorFromDiagnostics('unknown', diagnostics, 'Export worker produced no output for 30s — aborting (watchdog).'),
          diagnostics,
          silentIntervals: silentIntervals(),
          appendCallCount,
          appendBytes,
        });
      }, 50);
    };

    const resetWatchdog = (): void => {
      clearWatchdog();
      watchdogTimer = setTimeout(finishWatchdog, WATCHDOG_MS);
    };

    const finishProgressBound = (): void => {
      if (settled) return;
      worker.postMessage({ type: 'request-diagnostics' });
      setTimeout(() => {
        const diagnostics = reconstructDiagnostics();
        diagnostics.failure = {
          name: null,
          message: `Export made no forward progress (no append completed) for ${FORWARD_PROGRESS_BOUND_MS / 1000}s — aborting (stall guard).`,
          via: 'stall',
          frameIndex: diagnostics.framesEncoded > 0 ? diagnostics.framesEncoded - 1 : null,
          timelineSec: null,
        };
        finish({
          ok: false,
          error: errorFromDiagnostics(
            'unknown',
            diagnostics,
            `Export made no forward progress (no append completed) for ${FORWARD_PROGRESS_BOUND_MS / 1000}s — aborting (stall guard).`,
          ),
          diagnostics,
          silentIntervals: silentIntervals(),
          appendCallCount,
          appendBytes,
        });
      }, 50);
    };

    /** Reset ONLY on real forward progress (an append actually completing) —
     *  never on bare message arrival. See FORWARD_PROGRESS_BOUND_MS's own doc
     *  comment. */
    const resetProgressBound = (): void => {
      lastRealProgressAt = now();
      clearProgressBound();
      progressBoundTimer = setTimeout(finishProgressBound, FORWARD_PROGRESS_BOUND_MS);
    };

    /**
     * WS3 export-liveness-occlusion round — the mechanism fix. Both bounds
     * above are ALSO still enforced by their own `setTimeout` deadline
     * (unchanged, kept as a backstop), but a `setTimeout` living on this
     * document's main-thread context is exactly what WebKit throttles/defers
     * for an occluded/non-visible window (docs/ws3-silent-gaps-diagnosis.md's
     * Step 1 finding) — so a deadline that depends solely on its own callback
     * firing on schedule can be starved for the entire duration of an
     * occlusion, independent of whether real work has stalled.
     *
     * This function evaluates the SAME two bounds from a monotonic clock
     * (`now()`, `performance.now()` by default — unaffected by throttling
     * itself, see the class doc above) every time ANY worker message is
     * received (message dispatch is not the thing found to be throttled;
     * only this document's own scheduled timers were) — including the new
     * 'heartbeat' message (exportWorker.ts), which is sourced from a
     * `setInterval` living in the EXPORT WORKER's own realm, a thread the
     * diagnosis found kept executing (however slowly) through the run-5
     * occlusion that starved this document's timers. So even when the frame
     * loop produces zero chunk/queue-sample/phase output for a long stretch,
     * the heartbeat still gives this check a ~5s-cadence opportunity to catch
     * up and fire the bound immediately, rather than waiting on a
     * possibly-deferred `setTimeout` callback.
     *
     * Neither bound's RESET condition changes here — this only changes when
     * elapsed time against the existing anchors (`lastOutputAt`,
     * `lastRealProgressAt`) gets checked, never what resets those anchors.
     */
    const checkLivenessBounds = (): void => {
      if (settled) return;
      const t = now();
      if (t - lastOutputAt >= WATCHDOG_MS) {
        finishWatchdog();
        return;
      }
      if (t - lastRealProgressAt >= FORWARD_PROGRESS_BOUND_MS) {
        finishProgressBound();
      }
    };

    worker.onmessage = (ev: MessageEvent<ExportWorkerOutboundMessage>) => {
      const data = ev.data;
      switch (data.type) {
        case 'chunk': {
          recordOutput('chunk');
          noteWatchdogOutput();
          resetWatchdog();
          const bytes = new Uint8Array(data.bytes);
          appendQueue = appendQueue.then(async () => {
            if (appendError || settled) return;
            try {
              await ffmpeg.appendFileRaw(runFile, bytes);
              appendCallCount++;
              appendBytes += bytes.byteLength;
              resetProgressBound();
              onFrameProgress(appendCallCount, totalExpectedFrames);
            } catch (err) {
              appendError = err instanceof Error ? err : new Error(causeString(err));
            }
          });
          break;
        }
        case 'run-done':
          break;
        case 'done':
          {
            lastWorkerDiagnostics = data.diagnostics;
            mergePhaseFromWorker(data.diagnostics.phaseLog);
            const appendDrainStarted = now();
            void appendQueue.then(() => {
              const appendDrainMs = now() - appendDrainStarted;
              maxSilentMs = Math.max(maxSilentMs, now() - lastOutputAt);
              const diagnostics = data.diagnostics;
              const intervals = silentIntervals();
              if (appendError) {
                const failDiag = {
                  ...diagnostics,
                  failure: {
                    name: appendError.name || null,
                    message: appendError.message,
                    via: 'append-error' as const,
                    frameIndex: diagnostics.framesEncoded > 0 ? diagnostics.framesEncoded - 1 : null,
                    timelineSec: null,
                  },
                };
                finish({
                  ok: false,
                  error: errorFromDiagnostics('encode', failDiag, 'Failed to append an encoded chunk to disk.'),
                  diagnostics: failDiag,
                  silentIntervals: intervals,
                  appendCallCount,
                  appendBytes,
                });
                return;
              }
              finish({
                ok: true,
                frameCount: data.frameCount,
                diagnostics,
                maxSilentMs,
                appendDrainMs,
                silentIntervals: intervals,
                appendCallCount,
                appendBytes,
              });
            });
          }
          break;
        case 'error':
          lastWorkerDiagnostics = data.diagnostics;
          mergePhaseFromWorker(data.diagnostics.phaseLog);
          finish({
            ok: false,
            error: errorFromDiagnostics('encode', data.diagnostics, 'Export worker error.'),
            diagnostics: data.diagnostics,
            silentIntervals: silentIntervals(),
            appendCallCount,
            appendBytes,
          });
          break;
        case 'cancelled':
          lastWorkerDiagnostics = data.diagnostics;
          mergePhaseFromWorker(data.diagnostics.phaseLog);
          finish({
            ok: false,
            error: errorFromDiagnostics('cancelled', data.diagnostics, 'Export cancelled.'),
            diagnostics: data.diagnostics,
            silentIntervals: silentIntervals(),
            appendCallCount,
            appendBytes,
          });
          break;
        case 'diagnostics-snapshot':
          lastWorkerDiagnostics = data.diagnostics;
          mergePhaseFromWorker(data.diagnostics.phaseLog);
          lastPhase = data.diagnostics.lastPhase;
          lastFramesEncoded = data.diagnostics.framesEncoded;
          lastPieceIndex = data.diagnostics.pieceIndex;
          break;
        case 'queue-sample':
          recordOutput('queue-sample');
          noteWatchdogOutput();
          resetWatchdog();
          break;
        case 'phase':
          if (data.phase !== lastPhase) lastPhaseAt = now();
          lastPhase = data.phase;
          lastPieceIndex = data.pieceIndex;
          lastFramesEncoded = data.framesEncoded;
          pushPhaseLogEntry(phaseLog, {
            seq: data.seq,
            atMs: relMs(),
            phase: data.phase,
            pieceIndex: data.pieceIndex,
            segmentIndex: data.segmentIndex,
            assetId: data.assetId,
            framesEncoded: data.framesEncoded,
            kind: 'pulse',
          });
          // Does not reset either bound (unchanged reset sets — see each
          // bound's own doc comment) — only a message-receipt opportunity to
          // check them against the monotonic clock. See checkLivenessBounds.
          checkLivenessBounds();
          break;
        case 'heartbeat':
          // Never resets WATCHDOG_MS or FORWARD_PROGRESS_BOUND_MS — see
          // checkLivenessBounds's doc comment and this message's own doc
          // comment in exportWorker.ts. Its entire purpose is to guarantee
          // this document's main thread gets a monotonic-clock check-in on a
          // ~5s cadence even during a stretch where the worker produces no
          // other message at all.
          checkLivenessBounds();
          break;
      }
    };

    worker.onerror = (ev: ErrorEvent) => {
      const diagnostics = reconstructDiagnostics();
      diagnostics.failure = {
        name: null,
        message: `${ev.message} at ${ev.filename}:${ev.lineno}`,
        via: 'worker-crash',
        frameIndex: lastFramesEncoded > 0 ? lastFramesEncoded - 1 : null,
        timelineSec: null,
      };
      finish({
        ok: false,
        error: {
          kind: 'encode',
          message: formatFailureMessage(diagnostics.failure),
          cause: diagnostics.failure.message,
          liveness: snapshotLiveness(),
        },
        diagnostics,
        silentIntervals: silentIntervals(),
        appendCallCount,
        appendBytes,
      });
    };

    const initMsg: ExportWorkerInitMessage = {
      type: 'init',
      runId,
      segments,
      assets,
      config,
      width,
      height,
      fps,
      fontConfigs: textConfig.fontConfigs,
      globalOverlayConfig: textConfig.globalOverlayConfig,
      textLayers: textConfig.textLayers,
      headings: textConfig.headings,
      pieceIndex,
      startIndex,
      frameContentDigest: frameContentDigestEnabled,
      frameGridOriginSec: grid.originSec,
      frameGridBaseFrame: grid.baseFrame,
    };
    resetWatchdog();
    resetProgressBound();
    worker.postMessage(initMsg);
  });
}

/**
 * Dev/diagnostic opt-in for per-frame content hashing in the export worker.
 * OFF for every production export — the Round 6 harness turns it on to get an
 * output-neutrality gate that the encoder's run-to-run non-reproducibility
 * cannot invalidate. See frameContentDigest.ts.
 */
let frameContentDigestEnabled = false;

export function setFrameContentDigestEnabled(on: boolean): void {
  frameContentDigestEnabled = on;
}

// ---------------------------------------------------------------------------
// Part 4 — Driving Tier 1 / Tier C pieces + the annexb remux (plan §4.4).
// ---------------------------------------------------------------------------

async function remuxMp4ToAnnexb(
  ffmpeg: WebCodecsFfmpeg,
  mp4File: string,
  h264File: string,
  pieceIndex: number,
  pieceCount: number,
): Promise<void> {
  // Stream-copy: no re-encode, no quality change — only the container
  // changes (MP4 -> raw annexb H.264), milliseconds per piece (plan §4.4).
  // Opaque single `ffmpeg.exec` — WS3 Defect 2 class (ii), bounded.
  await withFfmpegLivenessBound(
    { label: 'REMUX_BOUND_MS', boundMs: REMUX_BOUND_MS, ffmpeg, files: [mp4File, h264File], pieceIndex, pieceCount },
    async () => {
      await ffmpeg.exec(['-i', mp4File, '-c', 'copy', '-bsf:v', 'h264_mp4toannexb', '-f', 'h264', '-y', h264File]);
    },
  );
}

interface PieceEncodeSuccess {
  ok: true;
  h264File: string;
}
type PieceEncodeResult = PieceEncodeSuccess | { ok: false; error: ExportError };

/**
 * Encodes one Tier 1 (plain video/image) piece via the UNCHANGED
 * `encodePlainVideoSegment`/`encodeStaticImageSegment` (mirroring exactly
 * how `exportPipeline.ts` calls them, lines ~170-173), writes the resulting
 * MP4 into the session, remuxes it to annexb, and deletes the MP4
 * intermediate.
 */
async function encodeTier1Piece(
  ffmpeg: WebCodecsFfmpeg,
  segment: VideoSegment,
  asset: Asset,
  globalConfig: FrameGlobalConfig,
  fps: number,
  width: number,
  height: number,
  pieceIndex: number,
  pieceCount: number,
): Promise<PieceEncodeResult> {
  const mp4File = `tier1_piece_${pieceIndex}.mp4`;
  const h264File = `piece_${pieceIndex}.h264`;
  try {
    // WS3 Defect 2 — opaque (class ii): both Tier 1 encoders are a single
    // `ffmpeg.exec` with no incremental output, so this gets a plain timeout.
    const mp4Bytes = await withFfmpegLivenessBound(
      { label: 'TIER_PIECE_BOUND_MS(tier1)', boundMs: TIER_PIECE_BOUND_MS, ffmpeg, files: [mp4File], pieceIndex, pieceCount },
      async () =>
        asset.type === 'video'
          ? await encodePlainVideoSegment(segment, asset, ffmpeg, { fps, width, height })
          : await encodeStaticImageSegment(segment, asset, globalConfig, ffmpeg, { fps, width, height }),
    );
    await ffmpeg.writeFile(mp4File, mp4Bytes);
    await remuxMp4ToAnnexb(ffmpeg, mp4File, h264File, pieceIndex, pieceCount);
  } catch (err) {
    return {
      ok: false,
      error: { kind: 'encode', message: `Failed to encode Tier 1 segment "${segment.id}".`, segmentIndex: pieceIndex, cause: causeString(err) },
    };
  } finally {
    await ffmpeg.deleteFile(mp4File).catch(() => undefined);
  }
  return { ok: true, h264File };
}

/**
 * Encodes one Tier C (canvas) piece via the UNCHANGED `encodeSegment`,
 * mirroring `exportPipeline.ts`'s own per-segment loop (lines ~94-212)
 * exactly — same `startTimeOffset`/`trailingExtension` halved-transition-
 * window math, same options shape — then remuxes its MP4 output to annexb.
 */
async function encodeCanvasPiece(
  ffmpeg: WebCodecsFfmpeg,
  plan: PiecePlan,
  project: Project,
  assetMap: Map<string, Asset>,
  globalConfig: FrameGlobalConfig,
  fps: number,
  width: number,
  height: number,
  pieceIndex: number,
  pieceCount: number,
  onFrameProgress: (frame: number, totalFrames: number) => void,
): Promise<PieceEncodeResult> {
  const segment = plan.segments[0]!;
  const prevSegment = project.segments[plan.startIndex - 1];
  const nextSegment = project.segments[plan.startIndex + 1];
  const asset = segment.assetId ? assetMap.get(segment.assetId) : undefined;
  const nextAsset = nextSegment?.assetId ? assetMap.get(nextSegment.assetId) : undefined;

  const startTimeOffset = prevSegment
    ? resolveEffectiveTransition(prevSegment, project.globalTransition, project.globalTransitionDuration).duration / 2
    : 0;
  const trailingExtension = nextSegment
    ? resolveEffectiveTransition(segment, project.globalTransition, project.globalTransitionDuration).duration / 2
    : 0;

  const mp4File = `canvas_piece_${pieceIndex}.mp4`;
  const h264File = `piece_${pieceIndex}.h264`;
  try {
    // WS3 Defect 2 — the ONE class (i) path: `encodeSegment` renders and writes
    // one PNG per frame before ffmpeg runs, and reports each via `onProgress`.
    // So this bound RESETS on a completed frame write (`handle.touch()`) and
    // can only fire when frames genuinely stop moving, never merely because the
    // segment is long or the machine is slow.
    const mp4Bytes = await withFfmpegLivenessBound(
      { label: 'TIER_PIECE_BOUND_MS(canvas)', boundMs: TIER_PIECE_BOUND_MS, ffmpeg, files: [mp4File], pieceIndex, pieceCount },
      async (handle) =>
        await encodeSegment(segment, asset, ffmpeg, globalConfig, {
          fps,
          width,
          height,
          nextSegment,
          nextAsset,
          globalTransitionDuration: project.globalTransitionDuration,
          globalTransition: project.globalTransition,
          startTimeOffset,
          trailingExtension,
          onProgress: (frame, totalFrames) => {
            handle.touch();
            onFrameProgress(frame, totalFrames);
          },
        }),
    );
    await ffmpeg.writeFile(mp4File, mp4Bytes);
    await remuxMp4ToAnnexb(ffmpeg, mp4File, h264File, pieceIndex, pieceCount);
  } catch (err) {
    return {
      ok: false,
      error: { kind: 'encode', message: `Failed to encode canvas segment "${segment.id}".`, segmentIndex: pieceIndex, cause: causeString(err) },
    };
  } finally {
    await ffmpeg.deleteFile(mp4File).catch(() => undefined);
  }
  return { ok: true, h264File };
}

// ---------------------------------------------------------------------------
// Part 5 — Concat + frame-count guard (plan §4.4).
//
// The frame-count guard needs `video_all.h264`'s ACTUAL coded-frame count.
// `ffmpeg.countAnnexbFrames` (the native `ffmpeg_count_annexb_frames` Rust
// command, src-tauri/src/ffmpeg.rs) now performs this count directly on the
// session-side file, in bounded 64 KB chunks — the file's bytes never cross
// into the renderer. This replaced an earlier version of this guard that
// read the whole file back via `ffmpeg.readFile` and ran the identical
// start-code scan in JS (`countAnnexbFrames` below), which cost ~5s per
// export moving the concatenated video file's bytes over IPC just to count
// frames.
//
// `countAnnexbFrames` (JS) is kept below as the reference implementation —
// exported for the Step 5 spike (`src/dev/webcodecsStep2Spike/main.ts`) to
// diff against the Rust command's output on the same file, and for this
// file's own unit tests — but the guard itself no longer calls it.
// ---------------------------------------------------------------------------

/**
 * Counts H.264 Annex B coded-picture NAL units (type 1 = non-IDR slice,
 * type 5 = IDR slice) in a raw byte stream. Reference implementation kept
 * for spike/test comparison against the native `ffmpeg_count_annexb_frames`
 * command the real guard below now uses — see the section header above.
 */
export function countAnnexbFrames(bytes: Uint8Array): number {
  let count = 0;
  const n = bytes.length;
  let i = 0;
  while (i < n - 2) {
    // A 3-byte start code (00 00 01) also matches the tail of a 4-byte start
    // code (00 00 00 01), so scanning for the 3-byte form alone finds both.
    if (bytes[i] === 0 && bytes[i + 1] === 0 && bytes[i + 2] === 1) {
      const headerIdx = i + 3;
      if (headerIdx < n) {
        const nalType = bytes[headerIdx]! & 0x1f;
        if (nalType === 1 || nalType === 5) count++;
      }
      i = headerIdx;
    } else {
      i++;
    }
  }
  return count;
}

// Concatenation itself is now a native Rust helper (`ffmpeg.concatAnnexbPieces`
// -> `ffmpeg_concat_annexb_pieces`), NOT an ffmpeg concat-protocol invocation.
// The old `concat:piece_0.h264|piece_1.h264|...` pipe-list opened every piece
// file at once; on a large-segment export (each non-GL segment becomes its own
// `piece_NN.h264`) that blew past macOS's default 256 per-process
// file-descriptor limit (`Too many open files`, reproduced at 407 segments).
// The Rust helper stream-copies piece bytes with only 2 FDs open at any moment,
// so it scales to arbitrary segment counts and is OS-independent. Raw AnnexB
// byte concatenation is spec-valid (every NAL unit is start-code-prefixed); the
// frame-count guard below proves the concatenated result is byte-correct.

// ---------------------------------------------------------------------------
// Part 5b — Used-font-family discovery, for `resolveFontBytes` (fontResolver.ts).
//
// Fetching bytes for every one of FONT_FAMILIES' ~52 families on every export
// would be wasteful (most projects use one or two). This scans every text
// source `GLTextRenderer.renderFrame` can actually draw from — see
// `textRenderer.ts`'s own element-set doc comment for the same four sources
// in the same order — for the family names it references:
//   1. `segment.extraOverlays[].fontFamily` (types.ts `TextOverlay.fontFamily`)
//      — always drawn when present, no visibility gate beyond existing.
//   2. `segment.overlayConfig?.fontFamily` (types.ts `VideoSegment.overlayConfig`)
//      — only actually rendered when the body caption itself would render
//      (`segment.showOverlay && segment.text`, mirroring
//      `textRenderer.ts`'s own `resolveBodyCaptionConfig` gate), falling back
//      per-field to `project.globalOverlayConfig.fontFamily` exactly like
//      that function does.
//   3. `project.textLayers[].fontFamily` (types.ts `TextOverlay.fontFamily`,
//      reused for global layers) — included unconditionally; a layer's
//      `hiddenOnSegments` only ever hides it on SOME segments, not the whole
//      export.
//   4. `project.headings[].fontFamily` (types.ts `HeadingOverlay.fontFamily`).
// A family name that is unset/blank anywhere along the way falls back to
// FONT_FAMILIES[0] ('Inter', the app's default), matching `constants.ts`'s
// own ordering and `textRenderer.ts`'s DEFAULT_GLOBAL_OVERLAY_CONFIG.
// ---------------------------------------------------------------------------

function addFontFamily(used: Set<string>, family: string | undefined): void {
  const trimmed = family?.trim();
  used.add(trimmed ? trimmed : FONT_FAMILIES[0]!);
}

function collectUsedFontFamilies(project: Project): Set<string> {
  const used = new Set<string>();

  for (const segment of project.segments) {
    for (const overlay of segment.extraOverlays ?? []) {
      addFontFamily(used, overlay.fontFamily);
    }
    if (segment.showOverlay && segment.text) {
      addFontFamily(used, segment.overlayConfig?.fontFamily ?? project.globalOverlayConfig.fontFamily);
    }
  }
  for (const layer of project.textLayers ?? []) {
    addFontFamily(used, layer.fontFamily);
  }
  for (const heading of project.headings ?? []) {
    addFontFamily(used, heading.fontFamily);
  }

  return used;
}

// ---------------------------------------------------------------------------
// Part 6 — Main orchestrator.
// ---------------------------------------------------------------------------

/**
 * Full multi-tier export: route -> plan pieces -> encode each piece in
 * timeline order (GL via the worker, Tier 1/C via the unchanged encoders +
 * an annexb remux) -> concat -> frame-count guard -> mux -> optionally save
 * to disk (see `ExportOptionsWebCodecs.savePath`) -> return.
 */
export async function exportProjectWebCodecs(
  project: Project,
  ffmpeg: WebCodecsFfmpeg,
  options: ExportOptionsWebCodecs = {},
  onProgress: ProgressCallback = () => undefined,
): Promise<ExportResult> {
  const fps = options.fps ?? 30;
  // Width/height must both be even for yuv420p. segmentEncoder.ts's own
  // encoders each independently even their OWN width/height internally
  // (encodeSegment/encodePlainVideoSegment/encodeStaticImageSegment), so
  // evening HERE, once, up front, and passing the evened values to every
  // encoder (Tier 1/C AND the GL worker, which does NOT even on its own)
  // guarantees every piece agrees on one W x H — an odd requested size would
  // otherwise silently produce Tier 1/C pieces one pixel narrower/shorter
  // than the GL worker's OffscreenCanvas, corrupting the final concat.
  const rawWidth = options.width ?? 1920;
  const rawHeight = options.height ?? 1080;
  const width = rawWidth % 2 === 0 ? rawWidth : rawWidth - 1;
  const height = rawHeight % 2 === 0 ? rawHeight : rawHeight - 1;

  const segments = project.segments;
  if (segments.length === 0) {
    return { ok: false, error: { kind: 'encode', message: 'Project has no segments to export.' } };
  }

  // MODEL P export guard (compliance backlog item 4, ruling §1.3) — the same
  // check, in the same position, as `exportPipeline.ts`'s. Both paths position
  // output by prefix-sum of `duration` and cannot represent a gap, so both need
  // it; the guard lives in `timelinePartition.ts` precisely so the two cannot
  // drift apart on what "continuous" means.
  const gapReason = checkTimelineIsGapless(segments);
  if (gapReason) {
    return { ok: false, error: { kind: 'timeline_gap', message: gapReason } };
  }

  const assetMap = new Map<string, Asset>(project.assets.map((a) => [a.id, a]));

  // Asset-presence check up front, matching exportPipeline.ts's own contract
  // exactly (lines ~99-113): a segment with NO assetId is allowed (rendered
  // as black/text-only, a real and intentional case), but an assetId that
  // does not resolve to a real asset with a `url` is a hard `asset_missing`
  // error, not a silent skip.
  for (const segment of segments) {
    if (!segment.assetId) continue;
    const asset = assetMap.get(segment.assetId);
    if (!asset?.url) {
      return { ok: false, error: { kind: 'asset_missing', message: `Segment "${segment.id}" has no asset` } };
    }
  }

  const routing = routeSegments(project, assetMap);
  if ('error' in routing) {
    return { ok: false, error: routing.error };
  }

  const pieces = buildPiecePlans(project, routing.tiers, fps, assetMap);
  const totalExpectedFramesOverall = pieces.reduce((sum, p) => sum + p.expectedFrames, 0);
  const pieceCounts = { plain: 0, gl: 0, canvas: 0 };
  for (const p of pieces) pieceCounts[p.tier]++;
  const diag: WebCodecsRunDiagnostics = {
    routing: {
      pieces: pieces.map((p) => ({
        tier: p.tier,
        startIndex: p.startIndex,
        segmentCount: p.segments.length,
        expectedFrames: p.expectedFrames,
        gridOriginSec: p.gridOriginSec,
        gridBaseFrame: p.gridBaseFrame,
      })),
      segmentCounts: countTiers(routing.tiers),
      pieceCounts,
    },
    glPieces: [],
    concatMs: null,
    muxMs: null,
    watchdogFired: false,
    watchdogPhase: null,
  };
  lastWebCodecsRunDiagnostics = diag;
  // eslint-disable-next-line no-console
  console.info('[ws3-liveness] routing', JSON.stringify(diag.routing));

  const config: ProjectEffectConfig = {
    globalTransition: project.globalTransition,
    globalTransitionDuration: project.globalTransitionDuration,
    // Project-level grade fallback intentionally left undefined — parity
    // with exportPipeline.ts/compositeParams.ts's own current usage (plan §8:
    // "currently unset in preview usage — thread as undefined for parity").
  };
  const globalConfig: FrameGlobalConfig = {
    overlayConfig: project.globalOverlayConfig,
    globalOverlayFilter: project.globalOverlayFilter,
    globalTextLayers: project.textLayers ?? [],
    headings: project.headings ?? [],
  };

  onProgress({ type: 'loading_ffmpeg' });
  activeFfmpeg = ffmpeg;

  // Only Tier-GL pieces render text via the worker's GLTextRenderer, so skip
  // the fetch entirely when nothing in this export needs it. resolveFontBytes
  // caches fetched bytes by URL for the session either way, and only fetches
  // the families this project's text elements actually reference (see
  // collectUsedFontFamilies) rather than every family in FONT_FAMILIES.
  const fontConfigs: FontConfig[] = pieces.some((p) => p.tier === 'gl')
    ? await resolveFontBytes([...collectUsedFontFamilies(project)])
    : [];

  const pieceFiles: string[] = [];
  let framesCompletedBase = 0;

  for (let pieceIndex = 0; pieceIndex < pieces.length; pieceIndex++) {
    const plan = pieces[pieceIndex]!;
    const frameOffsetForThisPiece = framesCompletedBase;
    const onFrameProgress = (frame: number): void => {
      onProgress({
        type: 'encoding_segment',
        index: pieceIndex,
        total: pieces.length,
        frame: frameOffsetForThisPiece + frame,
        totalFrames: totalExpectedFramesOverall,
      });
    };

    if (plan.tier === 'gl') {
      const referencedAssets: Asset[] = [];
      const seen = new Set<string>();
      for (const segment of plan.segments) {
        if (!segment.assetId) continue;
        const asset = assetMap.get(segment.assetId);
        if (asset && !seen.has(asset.id)) {
          seen.add(asset.id);
          referencedAssets.push(asset);
        }
      }
      const runFile = `piece_${pieceIndex}.h264`;
      const driveResult = await driveGlRun(
        ffmpeg,
        `run_${pieceIndex}`,
        runFile,
        plan.segments,
        referencedAssets,
        config,
        width,
        height,
        fps,
        plan.expectedFrames,
        onFrameProgress,
        {
          fontConfigs,
          globalOverlayConfig: project.globalOverlayConfig,
          textLayers: project.textLayers ?? [],
          headings: project.headings ?? [],
        },
        pieceIndex,
        plan.startIndex,
        {},
        { originSec: plan.gridOriginSec, baseFrame: plan.gridBaseFrame },
      );
      if (!driveResult.ok) {
        const watchdogFired = driveResult.error.message.includes('no output for 30s');
        const d = driveResult.diagnostics;
        diag.glPieces.push({
          ...(d ?? {
            phaseMs: {},
            instrumentationMs: 0,
            demuxSplit: [],
            framesEncoded: driveResult.error.liveness?.framesEncoded ?? 0,
            pieceIndex,
            lastPhase: driveResult.error.liveness?.lastPhase ?? null,
            phaseLog: [],
            failure: null,
            demuxCacheSize: null,
            workerHeapBytes: null,
            decodedSourceFrames: 0,
            encodedChunkCount: 0,
            encodedKeyframeCount: 0,
            encodedChunkBytes: 0,
            encodedChunkCountAtFlushStart: null,
            decodersCreated: 0,
            decodersOpen: 0,
            cursorsCreated: 0,
            openCursors: 0,
            peakOpenCursors: 0,
            openImageBitmaps: 0,
            frameContentDigest: null,
            frameContentDigestFrames: null,
          }),
          maxSilentMs: driveResult.error.liveness?.maxSilentMs ?? 0,
          appendDrainMs: 0,
          silentIntervals: driveResult.silentIntervals,
          aborted: true,
          appendCallCount: driveResult.appendCallCount,
          appendBytes: driveResult.appendBytes,
        });
        diag.watchdogFired = watchdogFired;
        diag.watchdogPhase = driveResult.error.liveness?.lastPhase ?? null;
        // eslint-disable-next-line no-console
        console.info('[ws3-liveness] gl-piece abort', JSON.stringify({
          pieceIndex,
          error: driveResult.error.message,
          liveness: driveResult.error.liveness,
          diagnostics: d,
        }));
        activeFfmpeg = null;
        return { ok: false, error: driveResult.error };
      }
      const d = driveResult.diagnostics;
      diag.glPieces.push({
        ...d,
        maxSilentMs: driveResult.maxSilentMs,
        appendDrainMs: driveResult.appendDrainMs,
        silentIntervals: driveResult.silentIntervals,
        aborted: false,
        appendCallCount: driveResult.appendCallCount,
        appendBytes: driveResult.appendBytes,
      });
      // eslint-disable-next-line no-console
      console.info('[ws3-liveness] gl-piece done', JSON.stringify({
        pieceIndex,
        diagnostics: d,
        maxSilentMs: driveResult.maxSilentMs,
        appendDrainMs: driveResult.appendDrainMs,
        silentIntervals: driveResult.silentIntervals,
      }));
      pieceFiles.push(runFile);
    } else if (plan.tier === 'plain') {
      const segment = plan.segments[0]!;
      const asset = assetMap.get(segment.assetId!)!; // presence already verified above
      const result = await encodeTier1Piece(ffmpeg, segment, asset, globalConfig, fps, width, height, pieceIndex, pieces.length);
      onFrameProgress(plan.expectedFrames);
      if (!result.ok) {
        activeFfmpeg = null;
        return { ok: false, error: result.error };
      }
      pieceFiles.push(result.h264File);
    } else {
      const result = await encodeCanvasPiece(ffmpeg, plan, project, assetMap, globalConfig, fps, width, height, pieceIndex, pieces.length, onFrameProgress);
      if (!result.ok) {
        activeFfmpeg = null;
        return { ok: false, error: result.error };
      }
      pieceFiles.push(result.h264File);
    }

    framesCompletedBase += plan.expectedFrames;
  }

  onProgress({ type: 'muxing' });

  // ── Concat every piece's annexb file, in timeline order ──────────────────
  const videoAllFile = 'video_all.h264';
  try {
    if (pieceFiles.length === 1) {
      // A single piece needs no concat call at all — but still goes through
      // the SAME frame-count guard below via a plain rename-by-reference
      // (ffmpeg's own file, reused directly as `video_all.h264`'s stand-in).
      diag.concatMs = 0;
    } else {
      const concatStarted = performance.now();
      await withFfmpegLivenessBound(
        { label: 'CONCAT_BOUND_MS', boundMs: CONCAT_BOUND_MS, ffmpeg, files: [videoAllFile], pieceCount: pieces.length },
        async () => {
          await ffmpeg.concatAnnexbPieces(pieceFiles, videoAllFile);
        },
      );
      diag.concatMs = performance.now() - concatStarted;
    }
  } catch (err) {
    activeFfmpeg = null;
    return { ok: false, error: boundedStepError('concat', 'Failed to concatenate the encoded pieces.', err) };
  }
  const finalVideoFile = pieceFiles.length === 1 ? pieceFiles[0]! : videoAllFile;

  // ── Loud-failure frame-count guard (plan §4.4) — never ship silently
  // corrupt output ─────────────────────────────────────────────────────────
  try {
    const actualFrames = await withFfmpegLivenessBound(
      { label: 'FRAME_COUNT_BOUND_MS', boundMs: FRAME_COUNT_BOUND_MS, ffmpeg, files: [finalVideoFile], pieceCount: pieces.length },
      async () => await ffmpeg.countAnnexbFrames(finalVideoFile),
    );
    if (actualFrames !== totalExpectedFramesOverall) {
      activeFfmpeg = null;
      return {
        ok: false,
        error: {
          kind: 'concat',
          message:
            `Concatenated output frame count (${actualFrames}) does not match the expected total (${totalExpectedFramesOverall}) ` +
            `across ${pieces.length} piece(s) — aborting rather than shipping a corrupt export.`,
        },
      };
    }
  } catch (err) {
    activeFfmpeg = null;
    return { ok: false, error: boundedStepError('concat', 'Failed to verify the concatenated output frame count.', err) };
  }

  // ── Mux voiceover audio (unchanged — ./muxOnly.ts) ────────────────────────
  const outputFile = 'export_final.mp4';
  const voiceoverAsset = project.voiceoverId ? assetMap.get(project.voiceoverId) : undefined;
  let audioFile: string | null = null;

  try {
    if (voiceoverAsset?.url) {
      audioFile = 'voiceover_audio';
      const audioBytes = voiceoverAsset.file
        ? new Uint8Array(await voiceoverAsset.file.arrayBuffer())
        : new Uint8Array(await (await fetch(voiceoverAsset.url)).arrayBuffer());
      await ffmpeg.writeFile(audioFile, audioBytes);
    }
  } catch (err) {
    activeFfmpeg = null;
    return {
      ok: false,
      error: { kind: 'mux', message: 'Failed to prepare the voiceover audio for muxing.', cause: causeString(err) },
    };
  }

  try {
    // TauriFfmpeg's real session id is private (not exposed to callers) —
    // `project.id` identifies this export run in muxOnly's error messages
    // instead; see muxOnly.ts's own doc comment on the `sessionId` param.
    const muxStarted = performance.now();
    await withFfmpegLivenessBound(
      {
        label: 'MUX_BOUND_MS',
        boundMs: MUX_BOUND_MS,
        ffmpeg,
        files: [finalVideoFile, ...(audioFile ? [audioFile] : []), outputFile],
        pieceCount: pieces.length,
      },
      async () => {
        await muxOnly(ffmpeg, project.id, finalVideoFile, audioFile, outputFile, fps);
      },
    );
    diag.muxMs = performance.now() - muxStarted;
  } catch (err) {
    activeFfmpeg = null;
    return { ok: false, error: boundedStepError('mux', 'Failed to mux the encoded output with audio.', err) };
  }

  // ── Cleanup intermediates (best-effort — mirrors exportPipeline.ts's own
  // intermediate cleanup; the session dir teardown covers anything missed) ──
  const intermediates = [...pieceFiles, videoAllFile, ...(audioFile ? [audioFile] : [])].filter((f) => f !== outputFile);
  await Promise.allSettled(intermediates.map((f) => ffmpeg.deleteFile(f)));

  if (options.savePath) {
    try {
      await ffmpeg.saveSessionFile(outputFile, options.savePath);
    } catch (err) {
      activeFfmpeg = null;
      return { ok: false, error: { kind: 'unknown', message: 'Failed to save the exported file to disk.', cause: causeString(err) } };
    }
  }

  activeFfmpeg = null;
  onProgress({ type: 'done' });
  return { ok: true, outputFile };
}
