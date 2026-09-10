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
import type { ExportAppendLedger, ExportError, ExportLivenessSnapshot, ExportResult, ProgressCallback } from '../exportPipeline';
import type { ProjectEffectConfig } from '../gl/compositeParams';
import type {
  ExportWorkerInboundMessage,
  ExportWorkerInitMessage,
  ExportWorkerOutboundMessage,
} from './exportWorker';
import type { FontConfig } from './textRenderer';
import { resolveFontBytes } from './fontResolver';
import {
  muxOnly,
  forcedMp4SealOffer,
  sealTruncatedAnnexbToMp4,
  type ForcedMp4SealOffer,
} from './muxOnly';
import { FONT_FAMILIES } from '../../constants';
import type { ExportDemuxSplit } from './exportPhaseTracker';
import {
  buildSilentGap,
  formatFailureMessage,
  pushPhaseLogEntry,
  NO_FLUSH_OBSERVATION,
  type ExportFailureVia,
  type ExportPhaseLogEntry,
  type ExportWorkerDiagnosticsPayload,
  type SilentIntervalAttribution,
} from './exportWorkerDiagnostics';
import type { AnnexbFrameCount, PieceFrameCountRow } from './annexbFrameCount';
import {
  concatFrameCountGuardFails,
  formatConcatFrameCountMismatch,
} from './annexbFrameCount';

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
  /**
   * WS3 Round 10 Blocker 2 — the operator consent gate for FORCED MP4 SEALING.
   *
   * Reached only after the post-concat picture-count guard has ALREADY failed
   * and `forcedMp4SealOffer` has found a non-empty, strictly shorter,
   * picture-valid prefix. The callback is handed the post-drop numbers the
   * guard itself measured — pictures kept, pictures lost, and the wall
   * duration of each — and must resolve `true` only on an explicit human yes.
   *
   * ABSENT OR FALSE IS THE STATUS QUO. When this is not supplied (every test
   * that predates it, and the legacy path, which never reaches here) or the
   * operator declines, the export returns the SAME typed
   * `formatConcatFrameCountMismatch` failure it returned before this option
   * existed — byte-for-byte the same message, same `kind`. Sealing is never
   * automatic: a silently shorter deliverable is its own failure mode, and
   * the guard is the only thing standing between a wedged encoder and a video
   * the user does not know is truncated.
   */
  requestForcedSealConsent?: (offer: ForcedMp4SealOffer) => Promise<boolean>;
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
   * Counts H.264 Annex B access units (pictures) in a session file entirely on
   * the native side (`TauriFfmpeg.countAnnexbFrames`, backed by the Rust
   * `ffmpeg_count_annexb_frames` command) — see the frame-count guard section
   * below for why this replaced a `readFile` + JS-scan approach.
   */
  sessionFileSize(path: string): Promise<number>;
  countAnnexbFrames(path: string): Promise<AnnexbFrameCount>;
  /**
   * Stream-concatenates `piecePaths` (in order) into a single `outputPath`
   * entirely on the native side (`TauriFfmpeg.concatAnnexbPieces`, backed by the
   * Rust `ffmpeg_concat_annexb_pieces` command) — only 2 file descriptors are
   * ever open, independent of piece count. Replaced the ffmpeg concat-protocol
   * (`-i concat:a|b|c|...`), which opened every piece simultaneously and
   * exhausted macOS's default 256 per-process FD limit on large-segment exports.
   */
  concatAnnexbPieces(piecePaths: string[], outputPath: string): Promise<void>;
  /**
   * WS3 salvage-runtime round — truncates `path` at the last complete Annex-B
   * access unit entirely on the native side (`TauriFfmpeg.truncateAnnexb`,
   * backed by the Rust `ffmpeg_truncate_annexb` command, `tauriFfmpeg.ts:222`)
   * and returns the picture/VCL-NAL count of the KEPT bytes as its last step
   * (`ffmpeg.rs`'s `truncate_annexb_to_last_complete_au`, which counts via
   * `count_annexb_access_units(&kept)` after computing the cut) — so this one
   * call is both "truncate" and "count the truncated result", with no second
   * round-trip needed. Called ONLY on a salvaged GL piece (see the salvage
   * handling below), never on the clean path.
   */
  truncateAnnexb(path: string): Promise<{ pictures: number; vclNals: number; bytesRemoved: number; keptBytes: number }>;
  /**
   * WS3 Tier 1 item 3c (Rung 3, bounded re-render) — truncates `path` to an
   * EXACT, caller-supplied byte offset (`TauriFfmpeg.truncateAnnexbToOffset`,
   * backed by the Rust `ffmpeg_truncate_annexb_to_offset` command,
   * `ffmpeg.rs:915-924` / `tauriFfmpeg.ts:251`), unlike `truncateAnnexb`
   * above, which finds its own cut point from the bytes. This is the
   * primitive the salvage-runtime round's own doc comment (above,
   * `decideBoundedRerenderDisposition`'s block) named as missing — it has
   * since been built but was, until this round, wired to nothing. Used ONLY
   * with a `sessionByteOffsets[k]` value: a boundary already established by
   * a COMPLETED `VideoEncoder.flush()` before the rotation that recorded it
   * (see `driveGlRun`'s own `sessionByteOffsets` doc comment) — never a
   * scanned-from-bytes guess — so the AU-accuracy question `truncateAnnexb`
   * has to resolve by inspection is moot here by construction; the returned
   * `pictures` count is used only to VERIFY that construction, not to decide it.
   */
  truncateAnnexbToOffset(path: string, byteOffset: number): Promise<{ pictures: number; vclNals: number; bytesRemoved: number; keptBytes: number }>;
}

import {
  withFfmpegLivenessBound,
  FfmpegBoundExpiredError,
  TIER_PIECE_BOUND_MS,
  REMUX_BOUND_MS,
  CONCAT_BOUND_MS,
  FRAME_COUNT_BOUND_MS,
  computeMuxBoundMs,
  TRUNCATE_BOUND_MS,
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

/**
 * WS3 salvage-runtime round — the message for a salvaged GL piece that fails
 * ITS OWN exact-match check, right after truncation, before concat ever runs.
 *
 * Deliberately mirrors `formatConcatFrameCountMismatch` (`annexbFrameCount.ts`,
 * the other agent's file — not imported here to avoid a cross-ownership edit
 * were its shape ever to change) rather than importing it, but reports at a
 * NARROWER scope: one piece, with the truncation's own byte accounting and the
 * worker-reported session/frame context folded in, so a failure here can be
 * attributed to the exact salvaged piece without waiting for the aggregate
 * post-concat guard to run a diagnostic per-piece breakdown after the fact.
 */
function formatSalvageTruncateMismatch(params: {
  pieceIndex: number;
  pictures: number;
  vclNals: number;
  expectedFrames: number;
  bytesRemoved: number;
  keptBytes: number;
  framesEncoded: number;
  encoderSessionIndex: number;
  encoderSessions: number;
  salvageReason: string | null;
}): string {
  const {
    pieceIndex, pictures, vclNals, expectedFrames, bytesRemoved, keptBytes,
    framesEncoded, encoderSessionIndex, encoderSessions, salvageReason,
  } = params;
  const direction = pictures < expectedFrames ? 'short' : 'long';
  return (
    `Salvaged piece ${pieceIndex} failed its post-truncation exact-match check ` +
    `(${direction} by ${Math.abs(pictures - expectedFrames)}): ` +
    `picturesAfterTruncation=${pictures}, vclNals=${vclNals}, expectedFrames=${expectedFrames}, ` +
    `bytesRemovedByTruncation=${bytesRemoved}, keptBytes=${keptBytes}, ` +
    `framesSubmittedToEncoder=${framesEncoded}, ` +
    `encoderSessionIndex=${encoderSessionIndex}/${encoderSessions}, ` +
    `salvageReason=${salvageReason ?? 'unknown'}. ` +
    'The guard tolerance was not widened — aborting rather than shipping a corrupt export.'
  );
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
 * WS3 Defect 1 — the GL PIECE cap.
 *
 * Before this, `buildPiecePlans` coalesced EVERY maximal run of adjacent
 * 'gl'-tier segments into a single PiecePlan, with no bound of any kind on the
 * resulting piece's duration or frame count. Field evidence: a 334-segment
 * 1080p30 project collapsed to `pieceIndex 0` and ran ONE VideoEncoder session
 * across 38061 frames (1268.7s of timeline) before the watchdog fired in
 * `encoder-flush`.
 *
 * What capping the PIECE buys, and what it does NOT:
 *
 *  - A piece boundary is a WORKER boundary (`driveGlRun` constructs a fresh
 *    `Worker` per GL piece and `terminate()`s it at the end), so it is the
 *    only place in this pipeline where every per-run accumulator resets to
 *    zero at once: the worker's demux cache, its `ImageBitmap` map, its
 *    decode cursors, and the main thread's per-run event/attribution arrays.
 *  - It is also the unit of ATTRIBUTION. With one piece, a failure payload can
 *    only ever say `pieceIndex 0`; with a cap it names a bounded span of
 *    timeline.
 *  - It is NOT a reachable bound on the encoder session. `isLegalPieceBoundary`
 *    refuses to cut where a transition straddles the boundary, so a timeline
 *    with a transition on EVERY boundary has no legal cut anywhere and stays
 *    one piece no matter how long it is — which is exactly the shape of the
 *    332-segment field failure this cap did not touch. The encoder session is
 *    bounded independently, inside the run, by
 *    `encoderSessionPlan.ts`'s `planEncoderSessions`; that bound has no
 *    transition precondition and is therefore always reachable.
 *
 * The frame count is shared with that module (`MAX_ENCODER_SESSION_FRAMES`,
 * re-exported below for the existing callers and tests) because the two bounds
 * answer the same question — how much per-frame state may accumulate before
 * something is reset — and there is no reason for them to disagree.
 */
export { MAX_ENCODER_SESSION_FRAMES } from './encoderSessionPlan';

import { MAX_ENCODER_SESSION_FRAMES } from './encoderSessionPlan';

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
  /**
   * WS3 export-recovery round — GL pieces that ended on a flush-timeout
   * SALVAGE rather than a clean flush, with the worker's stated reason.
   *
   * Empty on every clean export. A non-empty list on an export that SHIPPED
   * means the picture-accurate frame-count guard passed at zero tolerance on a
   * file whose final flush never returned — which is a legitimate pass, and
   * still something the operator must be told happened.
   */
  salvagedPieces: { pieceIndex: number; reason: string }[];
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
      /** WS3 export-recovery round — TRUE only when the run ended on a
       *  'salvage-done' rather than a 'done'. `ok: true` here means "no further
       *  bytes will be appended for this piece", NOT "the piece is complete":
       *  completeness is decided downstream, by the picture-accurate
       *  post-concat frame-count guard, at zero tolerance. */
      salvaged: boolean;
      salvageReason: string | null;
      /** Byte offset in `runFile` at which each encoder session's first byte
       *  landed, indexed by session. Recorded IN APPEND-QUEUE ORDER, so entry
       *  `k` is the exact truncation point for a rewind to session `k`. Purely
       *  observational today — see docs/ws3-export-recovery-architecture.md §1c. */
      sessionByteOffsets: number[];
      /** WS3 Tier 1 item 3c (Rung 3) — `sessionByteOffsets`' frame-index
       *  companion, same stamping/indexing scheme. See its own doc comment. */
      sessionFrameIndices: number[];
      /** WS3 Tier 1 item 4 — stamped centrally by `finish`, same as
       *  `sessionByteOffsets` above, so a call site built AFTER `driveGlRun`
       *  returns (its own closure, including `snapshotLiveness`, is gone by
       *  then) can still assemble a complete `ExportLivenessSnapshot` instead
       *  of hand-rolling one with fields it has no way to fill in. See the
       *  post-truncation mismatch error site below for the call site this
       *  closed. */
      appendLedger: ExportAppendLedger;
      msSinceLastPhaseChange: number;
    }
  | {
      ok: false;
      error: ExportError;
      diagnostics: ExportWorkerDiagnosticsPayload | null;
      silentIntervals: SilentIntervalAttribution[];
      appendCallCount: number;
      appendBytes: number;
      sessionByteOffsets: number[];
      sessionFrameIndices: number[];
      appendLedger: ExportAppendLedger;
      msSinceLastPhaseChange: number;
    };

/**
 * What a `finish` call site supplies. The ledger fields (`sessionByteOffsets`,
 * `salvaged`, `salvageReason`) are stamped centrally by `finish` from run-scoped
 * state, so no call site can forget one and no call site can disagree.
 */
type RunDriveResultCore =
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
/**
 * WS3 — how many phase-log lines ride along in an `ExportLivenessSnapshot`.
 *
 * Independent of `PHASE_LOG_CAP` (1024, how much the worker retains) and much
 * smaller, because this one lands in the OS clipboard via App.tsx's Copy
 * diagnostics button. 64 lines at ~4 pulses/s covers the last ~16s before the
 * failure — comfortably the window a 30s watchdog or a 20s flush bound cares
 * about — for a few KB of JSON.
 */
export const LIVENESS_PHASE_LOG_TAIL = 64;

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
 * WS3 append-batching round — how much the main thread accumulates before it
 * spends one `appendFileRaw` IPC round-trip.
 *
 * THE MEASUREMENT THIS IS SIZED FROM. The 354-segment WebView2 field run wrote
 * one chunk per `invoke`, and the phase log timed those calls at 12.4 ms apart,
 * unbroken, for the whole terminal drain. 12.4 ms per frame against a 1080p30
 * encoder that produces a frame far faster than that means the WRITER, not the
 * encoder, sets the run's pace — and every frame the encoder wins by is a chunk
 * that stays in the main thread's queue, so the backlog grows monotonically for
 * the entire run. The cost is not the write: `ffmpeg.rs`'s
 * `ffmpeg_append_file_raw` opens the file, writes, and closes it PER CALL, and
 * that whole sequence plus the WebView2 IPC hop is what 12.4 ms buys.
 *
 * Batching does not make the write faster; it amortizes the fixed per-call cost
 * over ~100 frames. Nothing about the FILE changes — `concatChunks` writes the
 * same bytes in the same order, and `appendFileRawByteEquality.test.ts` pins
 * that against a recording writer rather than leaving it as a claim.
 *
 * 100 chunks / 4 MB, whichever comes first: at 1080p30 (~33 KB/frame measured
 * on this corpus) the count trigger fires first at ~3.3 MB, and the byte
 * trigger is the guard for a high-bitrate or 4K-ish stream where 100 frames
 * would be a much larger buffer. Both are deliberately small enough that a
 * full buffer is a rounding error against the retained backlog the ceiling
 * below actually exists to bound.
 */
export const APPEND_BATCH_CHUNKS = 100;
export const APPEND_BATCH_BYTES = 4 * 1024 * 1024;

/**
 * WS3 append-batching round — the batch's AGE trigger, and it is a correctness
 * bound rather than a throughput knob.
 *
 * FORWARD_PROGRESS_BOUND_MS (45s) resets ONLY on a completed append, by design.
 * A size-triggered batch therefore introduces a failure the unbatched path could
 * not have: a slow encoder that emits 50 frames and then spends a minute
 * compositing leaves those 50 sitting in the buffer, no append ever completes,
 * and the progress bound fires on a perfectly healthy run. Caught by
 * `driveGlRun.test.ts`'s silent-interval eviction case, which feeds 306 chunks
 * at 300ms spacing — the count trigger alone would not have fired until t≈49.7s,
 * past the bound.
 *
 * So a non-empty buffer is ALWAYS flushed within this window, whether or not
 * another chunk ever arrives (the timer is armed when the buffer becomes
 * non-empty, not on a chunk). 1s: at the field run's own 12.4 ms/chunk the count
 * trigger fires first roughly eight times over, so under load this costs nothing
 * and never fires; when the encoder is slow it costs at most one extra IPC call
 * per second — which is precisely the regime where landing an append promptly is
 * the point, because it is the run's only liveness signal.
 */
export const APPEND_BATCH_MAX_AGE_MS = 1_000;

/**
 * WS3 append-batching round — hard ceiling on bytes accepted from the worker
 * but not yet on disk (batch buffer + every queued batch).
 *
 * The field run's own arithmetic is the reasoning: 40384 frames at ~33 KB is
 * ~1.3 GB of encoded output, and an append path that runs slower than the
 * encoder retains the difference. A backlog of 5000 chunks — entirely plausible
 * at 12.4 ms/chunk — is ~165 MB sitting in the JS heap on top of the GL
 * compositor, the demux cache, and the decoders.
 *
 * 256 MB is set ABOVE that plausible-backlog figure on purpose. Under batching
 * the queue should hover near zero, so this is not a tuning knob for normal
 * operation — it is the line past which "the writer is behind" has become "the
 * backlog is itself the failure", and crossing it produces a typed
 * 'append-queue-overflow' naming the depth instead of an opaque renderer OOM
 * some minutes later. It is NOT sized to any measured legitimate peak: no such
 * peak has been measured (see the FINAL REPORT's NOT DETERMINED list), so it is
 * placed by the memory-risk argument alone and should be re-derived the first
 * time a real run reports a `queueDepthBytes` anywhere near it.
 */
export const APPEND_QUEUE_CEILING_BYTES = 256 * 1024 * 1024;

/**
 * WS3 append-batching round — the TERMINAL DRAIN bound.
 *
 * Step 3's liveness fix makes a completed append reset WATCHDOG_MS, which stops
 * a healthy drain being killed. That alone would let a drain run unbounded as
 * long as it keeps making any progress at all, so the drain gets its own
 * ceiling: once the worker's terminal message has arrived, the remaining work
 * is finite and already encoded, and 10 minutes is far past what writing even a
 * multi-GB backlog can legitimately take once the per-call cost is amortized.
 * A drain that blows this fails as 'append-drain-stall' with its depth named.
 */
export const APPEND_DRAIN_BOUND_MS = 600_000;

/** Copy `parts` end to end into one buffer. `total` is passed rather than
 *  re-summed so the allocation and the ledger can never disagree. */
function concatChunks(parts: readonly Uint8Array[], total: number): Uint8Array {
  if (parts.length === 1 && parts[0]!.byteLength === total) return parts[0]!;
  const out = new Uint8Array(total);
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.byteLength;
  }
  return out;
}

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
  /** WS3 — called once per GL piece with its encoder-session plan. Observational. */
  onSessionPlan?: (pieceIndex: number, sessions: number) => void;
  /** Test-only override for APPEND_QUEUE_CEILING_BYTES. Production never passes
   *  it. Exists because the real ceiling is 256 MB and a test that actually
   *  allocated a quarter-gigabyte of chunk buffers to cross it would be
   *  measuring the allocator, not the bound. */
  appendQueueCeilingBytes?: number;
  /** WS3 Tier 1 item 3c (Rung 3) — set only by the rewind recovery in the
   *  'gl' tier loop below, to resume this piece's frame loop at a prior
   *  encoder-session boundary instead of frame 0. See
   *  `ExportWorkerInitMessage.resumeFromFrameIndex`'s own doc for the
   *  invariant this value must satisfy. */
  resumeFromFrameIndex?: number;
  /**
   * WS3 Tier 1 item 3c (Rung 3) — the GLOBAL (whole-piece) session index
   * `resumeFromFrameIndex` resumes INTO. Set alongside it, to the same
   * `hungSessionIndex` the orchestrator's rewind loop already computed.
   *
   * Worker-side session numbering is always correct without this (the
   * worker derives its own `initialSessionIndex` from
   * `sessionStarts.indexOf(resumeFromFrameIndex)` — see
   * `exportWorker.ts:runExport`). This field exists because the
   * ORCHESTRATOR's OWN session bookkeeping (`sessionAt`, `sessionByteOffsets`,
   * `sessionFrameIndices`, all local to THIS `driveGlRun` call) has no other
   * way to learn where a resumed run starts in the whole piece's numbering:
   * it only ever learns a session's index from a 'session-rotate' message,
   * which fires on a TRANSITION into a session, never on the run's own
   * starting one. Left at its default (0) for every non-resumed call,
   * reproducing today's behavior exactly.
   */
  resumeSessionIndex?: number;
  /** WS3 Rung 5a (hardware->software failover) — threaded straight to
   *  `ExportWorkerInitMessage.forceSoftwareEncoder`; see its own doc comment.
   *  Set only by the rewind loop's failover branch, at most once per export. */
  forceSoftwareEncoder?: boolean;
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
    const appendQueueCeiling = deps.appendQueueCeilingBytes ?? APPEND_QUEUE_CEILING_BYTES;
    const runStartedAt = now();

    let appendQueue: Promise<void> = Promise.resolve();
    let appendError: Error | null = null;
    let appendCallCount = 0;
    let appendBytes = 0;
    /** WS3 flush-occlusion round — how many `appendFileRaw` calls are in flight
     *  right now. The failure payload's `appendPendingAtFailure` is
     *  `appendsInFlight > 0`, and it is the field that separates "the encoder
     *  emitted chunks but the WRITER stopped" from "the flush itself is slow".
     *  A counter rather than a boolean so a burst that drains partway is still
     *  readable as pending. */
    let appendsInFlight = 0;
    /**
     * WS3 append-batching round — the main-thread APPEND LEDGER.
     *
     * Every counter here is main-thread knowledge, deliberately: the operator's
     * Copy-diagnostics blob is built from `ExportError` + `ExportLivenessSnapshot`
     * only (App.tsx), so nothing that requires a worker reply survives the last
     * hop. These do, whatever state the worker is in.
     */
    /** Chunks buffered but not yet handed to an `appendFileRaw` call. */
    let pendingBatch: Uint8Array[] = [];
    let pendingBatchBytes = 0;
    let pendingBatchChunks = 0;
    /** Accepted from the worker, not yet on disk — buffer PLUS queued batches. */
    let queueDepthChunks = 0;
    let queueDepthBytes = 0;
    /** `appendFileRaw` IPC calls actually issued (<< `appendCallCount` now). */
    let appendIpcCallCount = 0;
    let lastAppendCompletedAt = now();
    let chunksAppendedDuringFlush = 0;
    let bytesAppendedDuringFlush = 0;
    /** Set the moment the worker's terminal 'done'/'salvage-done' arrives. From
     *  here on no further chunk will ever be posted and the ONLY remaining work
     *  is the drain — which is exactly the window the 30s watchdog used to kill.
     *  Reported on the payload so the next field report answers "was the export
     *  already finished?" without anyone having to infer it. */
    let doneReceived = false;
    let doneReceivedAt: number | null = null;
    let drainBoundTimer: ReturnType<typeof setTimeout> | null = null;
    let pendingBatchTimer: ReturnType<typeof setTimeout> | null = null;
    let settled = false;
    let watchdogTimer: ReturnType<typeof setTimeout> | null = null;
    let progressBoundTimer: ReturnType<typeof setTimeout> | null = null;
    let lastPhase: string | null = 'init';
    let lastPhaseAt = now();
    let lastPieceIndex = pieceIndex;
    let lastFramesEncoded = 0;
    /** WS3 — observational only: the encoder-session plan this piece reported,
     *  and how far into it the run got. Surfaced in the liveness snapshot so a
     *  failure payload says whether the session bound engaged at all, and fed
     *  to `onProgress` so the operator can see it live instead of inferring it
     *  from an unchanged piece count. */
    let sessionCount: number | null = null;
    /** WS3 Tier 1 item 3c (Rung 3) — the GLOBAL session index THIS
     *  invocation starts at. 0 for every non-resumed call (unchanged
     *  behavior); a rewind's resumed call sets it to the session it is
     *  resuming into. See `DriveGlRunDeps.resumeSessionIndex`'s own doc. */
    const resumeSessionIndex = deps.resumeSessionIndex ?? 0;
    let sessionAt = resumeSessionIndex;
    /**
     * WS3 export-recovery round — the SESSION BYTE LEDGER.
     *
     * `sessionByteOffsets[k]` is how many bytes of `runFile` had been written
     * when encoder session `k` produced its first byte. Session 0 is 0 by
     * construction.
     *
     * Recorded by threading a marker THROUGH `appendQueue` rather than reading
     * `appendBytes` when the `session-rotate` message arrives. Message order
     * already guarantees every chunk of session k-1 was RECEIVED before the
     * rotate (the worker posts them all before it posts the rotate), but an
     * append is async: at rotate-receipt time some of those chunks may still be
     * queued, and `appendBytes` would under-count. The marker takes its reading
     * at the queue position the rotate occupies, which is exactly the seam.
     *
     * Nothing reads this to make a decision yet. It is the one number a
     * truncate-and-rewind recovery needs and does not otherwise have — see
     * PART 1c of docs/ws3-export-recovery-architecture.md. The marker appends
     * nothing and does not reset either liveness bound.
     */
    const sessionByteOffsets: number[] = [];
    sessionByteOffsets[resumeSessionIndex] = 0;
    /**
     * WS3 Tier 1 item 3c (Rung 3) — the SESSION FRAME LEDGER, `sessionByteOffsets`'
     * companion. `sessionFrameIndices[k]` is this piece's own 0-based frame
     * index at which encoder session `k` produced its first frame — read
     * directly off the 'session-rotate' message's own `frameIndex` field,
     * which the worker already computes from the SAME `i` the frame loop
     * itself is at (`exportWorker.ts`'s `postOut({type:'session-rotate',
     * ..., frameIndex: i})`, posted strictly between two `encode()` calls —
     * see that call site's own comment). Unlike the byte offset, this needs
     * no append-queue marker: it is exact the instant the message arrives,
     * with nothing async in between.
     *
     * This is the value a rewind passes back to `exportWorker.ts` as
     * `resumeFromFrameIndex` — `planEncoderSessions` guarantees every
     * `sessionStarts` entry (which is exactly the set of values this array
     * ever receives) is already a valid keyframe/session-start boundary, so
     * a resumed run built by `runExport` from this exact value needs no
     * different bootstrapping than session 0 ever did.
     */
    const sessionFrameIndices: number[] = [];
    sessionFrameIndices[resumeSessionIndex] = deps.resumeFromFrameIndex ?? 0;
    let salvaged = false;
    let salvageReason: string | null = null;
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

    /** WS3 flush-occlusion round — see the call site in the `chunk` case. Only
     *  pushes while the worker's own last reported phase is the flush, so a
     *  normal frame-loop export logs nothing extra. `seq` continues this
     *  document's own numbering (negative, so a main-thread entry is never
     *  confused with a worker `seq`). */
    let mainPhaseSeq = 0;
    const notePhaseAppendDuringFlush = (): void => {
      if (lastPhase !== 'encoder-flush') return;
      mainPhaseSeq++;
      pushPhaseLogEntry(phaseLog, {
        seq: -mainPhaseSeq,
        atMs: relMs(),
        phase: 'encoder-flush-append',
        pieceIndex: lastPieceIndex,
        segmentIndex: -1,
        assetId: null,
        framesEncoded: lastFramesEncoded,
        kind: 'pulse',
      });
    };

    const reconstructDiagnostics = (): ExportWorkerDiagnosticsPayload => {
      // WS3 flush-occlusion round — `appendPendingAtFailure` is main-thread
      // knowledge the worker's own payload cannot carry (it is always null
      // there), so it is stamped on every reconstruction, including the one
      // built from a worker snapshot.
      if (lastWorkerDiagnostics) {
        return { ...lastWorkerDiagnostics, appendPendingAtFailure: appendsInFlight > 0 };
      }
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
        ...NO_FLUSH_OBSERVATION,
        encoderSessionIndex: sessionAt,
        encoderSessions: sessionCount ?? 1,
        appendPendingAtFailure: appendsInFlight > 0,
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

    /** WS3 Tier 1 item 4 — the one place the append ledger's shape is
     *  written, shared by `snapshotLiveness` (used while `driveGlRun`'s
     *  closure is still alive) and `finish` (which stamps it onto the
     *  returned `RunDriveResult` so a call site reading the result AFTER
     *  this closure is gone — the salvage-truncate-mismatch site below is
     *  exactly that call site — never has to reconstruct it by hand and
     *  risk leaving a field out). */
    const buildAppendLedger = (): ExportAppendLedger => ({
      chunksAppended: appendCallCount,
      ipcCalls: appendIpcCallCount,
      bytesAppended: appendBytes,
      queueDepthChunks,
      queueDepthBytes,
      msSinceLastAppendCompleted: now() - lastAppendCompletedAt,
      chunksAppendedDuringFlush,
      bytesAppendedDuringFlush,
      doneReceived,
      msSinceDone: doneReceivedAt === null ? null : now() - doneReceivedAt,
      appendInFlight: appendsInFlight > 0,
    });

    const snapshotLiveness = (): ExportLivenessSnapshot => ({
      lastPhase,
      msSinceLastPhaseChange: now() - lastPhaseAt,
      pieceIndex: lastPieceIndex,
      framesEncoded: lastFramesEncoded,
      maxSilentMs: Math.max(maxSilentMs, now() - lastOutputAt),
      // WS3 — the last hop the phase log never crossed. `PHASE_LOG_CAP` governs
      // how much the worker RETAINS; this governs how much the operator SEES,
      // and before this it was zero regardless of the cap.
      phaseLogTail: phaseLog.slice(-LIVENESS_PHASE_LOG_TAIL).map((e) => ({
        atMs: Math.round(e.atMs),
        phase: e.phase,
        pieceIndex: e.pieceIndex,
        framesEncoded: e.framesEncoded,
        kind: e.kind,
      })),
      failureVia: lastWorkerDiagnostics?.failure?.via ?? null,
      encoderSessions: sessionCount,
      encoderSessionIndex: sessionCount === null ? null : sessionAt,
      appendLedger: buildAppendLedger(),
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

    const clearDrainBound = (): void => {
      if (drainBoundTimer) {
        clearTimeout(drainBoundTimer);
        drainBoundTimer = null;
      }
    };

    const finish = (result: RunDriveResultCore): void => {
      if (settled) return;
      settled = true;
      clearWatchdog();
      clearProgressBound();
      clearDrainBound();
      if (pendingBatchTimer) {
        clearTimeout(pendingBatchTimer);
        pendingBatchTimer = null;
      }
      pendingBatch = [];
      if (activeWorker === worker) activeWorker = null;
      worker.terminate();
      const appendLedger = buildAppendLedger();
      const msSinceLastPhaseChange = now() - lastPhaseAt;
      resolve(
        result.ok
          ? { ...result, salvaged, salvageReason, sessionByteOffsets: sessionByteOffsets.slice(), sessionFrameIndices: sessionFrameIndices.slice(), appendLedger, msSinceLastPhaseChange }
          : { ...result, sessionByteOffsets: sessionByteOffsets.slice(), sessionFrameIndices: sessionFrameIndices.slice(), appendLedger, msSinceLastPhaseChange },
      );
    };

    /** How the append queue looked at the moment a bound fired — appended to
     *  every terminal bound message, because "no output for 30s" and "no output
     *  for 30s while 4211 chunks / 139 MB were still queued and the last one
     *  landed 12 ms ago" are different failures and the old text could not tell
     *  them apart. */
    const appendQueueClause = (): string =>
      `append queue: ${queueDepthChunks} chunk(s) / ${queueDepthBytes} byte(s) pending, ` +
      `last append completed ${Math.round(now() - lastAppendCompletedAt)}ms ago, ` +
      `${appendCallCount} chunk(s) written in ${appendIpcCallCount} IPC call(s)` +
      (doneReceived ? ', worker had already reported done' : '');

    /**
     * One terminal-bound path for all four bounds (watchdog, forward-progress,
     * terminal-drain, queue-overflow). Extracted rather than copied a fourth
     * time: the 50 ms `request-diagnostics` grace, the reconstruction, the
     * failure stamp and the `finish` call were identical in every copy, and the
     * only thing that ever differed is the `via` and the sentence.
     *
     * The 50 ms grace is a BEST-EFFORT enrichment, never a dependency. If the
     * worker is wedged, terminated, or simply slower than 50 ms, the payload is
     * rebuilt from main-thread state and is complete for everything the
     * operator reads off it — see `ExportLivenessSnapshot.appendLedger`.
     */
    const finishWithBound = (via: ExportFailureVia, message: string): void => {
      if (settled) return;
      worker.postMessage({ type: 'request-diagnostics' });
      setTimeout(() => {
        const diagnostics = reconstructDiagnostics();
        diagnostics.failure = {
          name: null,
          message,
          via,
          frameIndex: diagnostics.framesEncoded > 0 ? diagnostics.framesEncoded - 1 : null,
          timelineSec: null,
        };
        finish({
          ok: false,
          error: errorFromDiagnostics('unknown', diagnostics, message),
          diagnostics,
          silentIntervals: silentIntervals(),
          appendCallCount,
          appendBytes,
        });
      }, 50);
    };

    /**
     * WS3 append-batching round — the watchdog now DISCRIMINATES.
     *
     * Before this round the 30s message-based watchdog fired blind during the
     * terminal drain: a completed append reset FORWARD_PROGRESS_BOUND_MS but
     * never WATCHDOG_MS, and no chunk message can arrive after 'done' by
     * construction, so a healthy export whose backlog took longer than 30s to
     * write was killed while its writer was still landing a chunk every 12.4 ms.
     * A completed append now resets WATCHDOG_MS too (see the append task), so
     * reaching this function during a drain means no append completed either —
     * a genuinely stuck writer, reported as such rather than as a generic
     * silence.
     */
    const finishWatchdog = (): void => {
      finishWithBound(
        doneReceived ? 'append-drain-stall' : 'watchdog',
        doneReceived
          ? `Export worker finished, but no encoded chunk reached disk for ${WATCHDOG_MS / 1000}s ` +
            `during the final drain — aborting (drain stalled). ${appendQueueClause()}.`
          : `Export worker produced no output for ${WATCHDOG_MS / 1000}s — aborting (watchdog). ${appendQueueClause()}.`,
      );
    };

    const finishProgressBound = (): void => {
      finishWithBound(
        'stall',
        `Export made no forward progress (no append completed) for ${FORWARD_PROGRESS_BOUND_MS / 1000}s ` +
          `— aborting (stall guard). ${appendQueueClause()}.`,
      );
    };

    /** The drain's own ceiling — see APPEND_DRAIN_BOUND_MS. Fires even when the
     *  drain IS progressing, so a pathologically slow writer cannot hold the run
     *  open indefinitely on the strength of one append per 29 seconds. */
    const finishDrainBound = (): void => {
      finishWithBound(
        'append-drain-stall',
        `Export final drain exceeded ${APPEND_DRAIN_BOUND_MS / 1000}s — aborting. ${appendQueueClause()}.`,
      );
    };

    const finishQueueOverflow = (): void => {
      finishWithBound(
        'append-queue-overflow',
        `Encoded output outran the writer: ${queueDepthBytes} byte(s) pending exceeds the ` +
          `${appendQueueCeiling}-byte append-queue ceiling — aborting. ${appendQueueClause()}.`,
      );
    };

    const resetWatchdog = (): void => {
      clearWatchdog();
      watchdogTimer = setTimeout(finishWatchdog, WATCHDOG_MS);
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
     * WS3 append-batching round — hand the buffered chunks to ONE `appendFileRaw`.
     *
     * The queue is still a strict serial chain (`appendQueue.then`), so batch k
     * is fully written before batch k+1 opens the file: concatenation order is
     * unchanged from the one-call-per-chunk path, and so are the bytes, because
     * `concatChunks` only copies. That equality is pinned by
     * `appendBatching.test.ts`'s recording writer rather than asserted here.
     *
     * Called on every batch trigger, and additionally at three seams where a
     * PARTIAL buffer must not be left sitting: encoder-session rotation (so the
     * `sessionByteOffsets` marker still reads the exact seam), and the two
     * terminal messages (so every byte the worker produced reaches disk before
     * anyone counts pictures in the file).
     */
    const flushPendingBatch = (): void => {
      if (pendingBatchTimer) {
        clearTimeout(pendingBatchTimer);
        pendingBatchTimer = null;
      }
      if (pendingBatch.length === 0) return;
      const parts = pendingBatch;
      const batchBytes = pendingBatchBytes;
      const batchChunks = pendingBatchChunks;
      pendingBatch = [];
      pendingBatchBytes = 0;
      pendingBatchChunks = 0;
      appendQueue = appendQueue.then(async () => {
        if (appendError || settled) {
          queueDepthChunks -= batchChunks;
          queueDepthBytes -= batchBytes;
          return;
        }
        appendsInFlight++;
        try {
          await ffmpeg.appendFileRaw(runFile, concatChunks(parts, batchBytes));
          appendIpcCallCount++;
          appendCallCount += batchChunks;
          appendBytes += batchBytes;
          lastAppendCompletedAt = now();
          if (lastPhase === 'encoder-flush') {
            chunksAppendedDuringFlush += batchChunks;
            bytesAppendedDuringFlush += batchBytes;
          }
          // WS3 append-batching round, Step 3a — A COMPLETED APPEND IS LIVENESS.
          //
          // This is the line that stops the watchdog killing healthy exports.
          // `resetProgressBound` was already here; `noteWatchdogOutput` +
          // `resetWatchdog` were not, so once the worker stopped posting chunks
          // — which happens by construction the moment it posts 'done' —
          // WATCHDOG_MS ran down to zero no matter how fast bytes were still
          // reaching disk. An append landing on disk is strictly stronger
          // evidence of life than a 'queue-sample', which already resets this
          // timer and only proves a frame was SUBMITTED.
          //
          // This cannot mask a real hang: the reset happens after `await`
          // RESOLVES, so a writer that is stuck produces no reset at all and
          // both bounds run out exactly as before.
          noteWatchdogOutput();
          resetWatchdog();
          resetProgressBound();
          onFrameProgress(appendCallCount, totalExpectedFrames);
          notePhaseAppendDuringFlush();
          // WS3 Tier 1 item 3b — the back-pressure ack. Sent after EVERY
          // successful flush regardless of trigger (count/bytes/age/rotate/
          // done/salvage-done all funnel through this one success path), with
          // the cumulative total rather than this batch's delta so the
          // worker-side gate needs no reassembly. This is also what makes a
          // gated worker's wait bounded: even if no other trigger fires, the
          // 1s age timer (APPEND_BATCH_MAX_AGE_MS) still reaches this line
          // and still sends an ack, so a parked worker is unblocked within
          // that window as long as the writer itself is making progress —
          // see appendBackpressureGate.ts and the round log for the
          // three-seam non-deadlock argument.
          const ackMsg: ExportWorkerInboundMessage = { type: 'append-ack', bytesAcked: appendBytes };
          worker.postMessage(ackMsg);
        } catch (err) {
          appendError = err instanceof Error ? err : new Error(causeString(err));
        } finally {
          appendsInFlight--;
          queueDepthChunks -= batchChunks;
          queueDepthBytes -= batchBytes;
        }
      });
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

    /**
     * The worker's terminal message arrived: no further chunk can ever be
     * posted, so everything left is the drain. Push the partial buffer out,
     * record the transition for the payload, and arm the drain's own ceiling.
     */
    const noteTerminalMessage = (): void => {
      doneReceived = true;
      doneReceivedAt = now();
      flushPendingBatch();
      clearDrainBound();
      drainBoundTimer = setTimeout(finishDrainBound, APPEND_DRAIN_BOUND_MS);
    };

    worker.onmessage = (ev: MessageEvent<ExportWorkerOutboundMessage>) => {
      const data = ev.data;
      switch (data.type) {
        case 'chunk': {
          recordOutput('chunk');
          noteWatchdogOutput();
          resetWatchdog();
          const bytes = new Uint8Array(data.bytes);
          pendingBatch.push(bytes);
          pendingBatchBytes += bytes.byteLength;
          pendingBatchChunks++;
          queueDepthChunks++;
          queueDepthBytes += bytes.byteLength;
          if (pendingBatchChunks >= APPEND_BATCH_CHUNKS || pendingBatchBytes >= APPEND_BATCH_BYTES) {
            flushPendingBatch();
          } else if (pendingBatchTimer === null) {
            // Buffer just became non-empty — arm the age trigger. Armed here
            // rather than re-armed per chunk so the window measures the OLDEST
            // buffered chunk, and so a buffer whose producer goes silent still
            // reaches disk. See APPEND_BATCH_MAX_AGE_MS.
            pendingBatchTimer = setTimeout(() => {
              pendingBatchTimer = null;
              flushPendingBatch();
            }, APPEND_BATCH_MAX_AGE_MS);
          }
          // WS3 Step 5 — the queue is bounded now. Checked on ACCEPT rather
          // than on completion, because acceptance is the only moment the depth
          // can grow, and the point of the ceiling is to fail while the number
          // is still explainable rather than as an opaque renderer OOM later.
          if (queueDepthBytes > appendQueueCeiling) {
            finishQueueOverflow();
          }
          break;
        }
        case 'run-done':
          break;
        case 'done':
          {
            lastWorkerDiagnostics = data.diagnostics;
            mergePhaseFromWorker(data.diagnostics.phaseLog);
            noteTerminalMessage();
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
        case 'salvage-done':
          {
            // Identical drain-then-settle shape as 'done'. The ONLY differences
            // are the two flags stamped by `finish` — deliberately, because the
            // append queue must be drained the same way either way: whatever
            // chunks were already posted before the fence closed still have to
            // reach disk before anyone counts pictures in the file.
            salvaged = true;
            salvageReason = data.reason;
            lastWorkerDiagnostics = data.diagnostics;
            mergePhaseFromWorker(data.diagnostics.phaseLog);
            noteTerminalMessage();
            const salvageDrainStarted = now();
            void appendQueue.then(() => {
              const appendDrainMs = now() - salvageDrainStarted;
              maxSilentMs = Math.max(maxSilentMs, now() - lastOutputAt);
              const intervals = silentIntervals();
              if (appendError) {
                const failDiag = {
                  ...data.diagnostics,
                  failure: {
                    name: appendError.name || null,
                    message: appendError.message,
                    via: 'append-error' as const,
                    frameIndex: data.diagnostics.framesEncoded > 0 ? data.diagnostics.framesEncoded - 1 : null,
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
                diagnostics: data.diagnostics,
                maxSilentMs,
                appendDrainMs,
                silentIntervals: intervals,
                appendCallCount,
                appendBytes,
              });
            });
          }
          break;
        case 'error': {
          // WS3 flush-occlusion round — stamp the one field only this thread
          // knows before the payload is handed on. This is the path a
          // `flush-timeout` arrives on, and `appendPendingAtFailure` is what
          // separates "the writer stopped" from "the flush itself is slow".
          const errDiagnostics: ExportWorkerDiagnosticsPayload = {
            ...data.diagnostics,
            appendPendingAtFailure: appendsInFlight > 0,
          };
          lastWorkerDiagnostics = errDiagnostics;
          mergePhaseFromWorker(errDiagnostics.phaseLog);
          finish({
            ok: false,
            error: errorFromDiagnostics('encode', errDiagnostics, 'Export worker error.'),
            diagnostics: errDiagnostics,
            silentIntervals: silentIntervals(),
            appendCallCount,
            appendBytes,
          });
          break;
        }
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
        // Observational only — deliberately NOT in the watchdog reset set, so
        // adding them cannot mask a stall the way a resetting message would.
        case 'session-plan':
          sessionCount = data.sessions;
          // WS3 Tier 1 item 3c — NOT hardcoded 0: a resumed run's 'session-plan'
          // still describes the WHOLE piece, but this run itself starts at
          // `resumeSessionIndex`, not the piece's own session 0.
          sessionAt = resumeSessionIndex;
          deps.onSessionPlan?.(data.pieceIndex, data.sessions);
          break;
        case 'session-rotate': {
          sessionCount = data.sessions;
          sessionAt = data.sessionIndex;
          const rotatedTo = data.sessionIndex;
          // WS3 append-batching round — the partial buffer MUST go out before
          // the marker. `sessionByteOffsets[k]` is a truncation point, so it has
          // to be the byte count at the exact seam; a buffer still holding
          // session k-1's tail would put the marker before bytes that belong
          // ahead of it, and a rewind to k would then cut in the wrong place.
          flushPendingBatch();
          appendQueue = appendQueue.then(() => {
            sessionByteOffsets[rotatedTo] = appendBytes;
          });
          // `frameIndex` needs no append-queue marker — it is exact the
          // instant this message arrives (see `sessionFrameIndices`'s own doc).
          sessionFrameIndices[rotatedTo] = data.frameIndex;
          break;
        }
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
      resumeFromFrameIndex: deps.resumeFromFrameIndex,
      forceSoftwareEncoder: deps.forceSoftwareEncoder,
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
// The frame-count guard needs `video_all.h264`'s ACTUAL picture count.
// `ffmpeg.countAnnexbFrames` (the native `ffmpeg_count_annexb_frames` Rust
// command, src-tauri/src/ffmpeg.rs) scans the session-side file in bounded
// 64 KB chunks and counts access units via `first_mb_in_slice == 0` on VCL
// NALs (types 1/5) — not raw slice NAL count, which Windows hardware encoders
// inflate by emitting multiple slices per picture. The file's bytes never cross
// into the renderer. This replaced an earlier version of this guard that
// read the whole file back via `ffmpeg.readFile` and ran the JS scan in
// `annexbFrameCount.ts`, which cost ~5s per export moving the concatenated
// video file's bytes over IPC just to count frames.
//
// `annexbFrameCount.ts` holds the shared JS reference implementation (exported
// below as `countAnnexbFrames`) for spike/test comparison against the Rust
// command on the same bytes — but the guard itself calls the native command.
// ---------------------------------------------------------------------------

export { countAnnexbFrames } from './annexbFrameCount';
export type { AnnexbFrameCount } from './annexbFrameCount';

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
// WS3 salvage-runtime round — Step 3: the BOUND for a future bounded
// re-render, designed and tested here, NOT wired into the live recovery path.
//
// Why not wired: a bounded re-render (fence + abandon the hung session,
// truncate `piece_N.h264` back to the last rotation boundary's recorded byte
// offset — `sessionByteOffsets[k]`, this file's own session-byte-ledger doc
// comment above — reopen an encoder, re-render only from that boundary
// forward) needs a primitive this round does not have:
// `truncateFile(path, byteLength)`, cutting a file to a CALLER-SUPPLIED byte
// length. `ffmpeg.truncateAnnexb` (Step 1, `WebCodecsFfmpeg` above) is NOT
// that primitive — it truncates to the LAST COMPLETE ACCESS UNIT the file
// happens to end on, computed from the bytes themselves, with no way to name
// an earlier, specific cut point. Applied to a piece whose abandoned session
// has been streaming chunks for up to 60s, it would keep most of that
// session's bytes (whichever prefix of them happens to end on a complete AU)
// instead of discarding them — the opposite of a rewind. Re-rendering the
// boundary forward and APPENDING (the only operation actually available)
// would then make the file LONGER than expected, which the zero-tolerance
// guard already rejects exactly as it rejects a short file — a safe failure,
// but a strictly worse one than aborting immediately: it burns up to
// `MAX_ENCODER_SESSION_FRAMES` frames of re-encoding for a foregone-conclusion
// abort. Wiring the mechanism into production today would be a pure
// regression, not a partial win. See this round's final report for the full
// argument and exactly which native command (session id, path, byte length)
// would need to exist for rung 9 to become buildable.
//
// What IS built here: the ceiling a real re-render must obey once that
// primitive exists — "exactly one attempt per boundary, at most 2 boundary
// rewinds per export" — as one pure, tested function, so a future round
// inherits an already-enforced bound rather than inventing one. Precedent:
// `MAX_FLUSH_SALVAGES`/`decideFlushTimeoutDisposition` (`exportWorker.ts`)
// did exactly this for the flush-salvage bound before the salvage itself was
// fully wired.
// ---------------------------------------------------------------------------

/** At most this many rotation-boundary rewinds across a WHOLE export (every
 *  GL piece combined) — a per-EXPORT ceiling, deliberately distinct from
 *  `MAX_FLUSH_SALVAGES` (per-RUN, i.e. per GL piece). Two, not one: a single
 *  export can legitimately contain more than one GL piece, and a transient
 *  stall recovered by one piece's rewind says nothing about whether a
 *  SECOND, unrelated piece's rewind is also transient — but a third rewind in
 *  the same export is exactly the "salvage becomes routine" failure mode
 *  `decideFlushTimeoutDisposition`'s own doc comment warns against, so the
 *  ceiling stops there rather than growing with piece count. */
export const MAX_BOUNDARY_REWINDS_PER_EXPORT = 2;

export type BoundedRerenderDisposition =
  | { action: 'rewind' }
  | { action: 'abort'; reason: string };

/**
 * Pure policy for whether a bounded re-render may attempt ANOTHER rotation-
 * boundary rewind. Takes only a count — same shape as
 * `decideFlushTimeoutDisposition`'s own bound check, and for the same reason:
 * a policy function that cannot see anything but the counter cannot be
 * talked into re-litigating the bound from some other signal.
 */
export function decideBoundedRerenderDisposition(input: {
  rewindsUsed: number;
  maxRewinds?: number;
}): BoundedRerenderDisposition {
  const maxRewinds = input.maxRewinds ?? MAX_BOUNDARY_REWINDS_PER_EXPORT;
  if (input.rewindsUsed >= maxRewinds) {
    return {
      action: 'abort',
      reason: `bounded re-render rewind bound reached (${input.rewindsUsed}/${maxRewinds}) — aborting rather than rewinding unboundedly`,
    };
  }
  return { action: 'rewind' };
}

// ---------------------------------------------------------------------------
// WS3 Rung 5a — hardware->software failover, ONE shot per export.
//
// Deliberately a SEPARATE bounded resource from `decideBoundedRerenderDisposition`
// above, not a widening of it: consulted only once Rung 3's own rewind budget
// (`MAX_BOUNDARY_REWINDS_PER_EXPORT`, per-export) is exhausted, so a transient
// stall is always given the SAME-rung rewind first — a `HARDWARE_LADDER`
// construction-time fallback already exists and a single stall says nothing
// about whether hardware itself is unhealthy for this export. Failing over
// only after the rewind budget is exhausted means: two same-rung rewind
// attempts must already have failed (or the export must already have spent
// its rewind budget on an earlier, unrelated boundary) before this ever
// fires. `failoverUsed` is a boolean, never a counter, so this function can
// grant AT MOST one extra `driveGlRun` attempt for the whole export — see
// the Round 9 ledger entry for the resulting worst-case attempt count.
// ---------------------------------------------------------------------------

export type HardwareFailoverDisposition = { action: 'retry-software' } | { action: 'abort' };

/**
 * Pure policy for whether the export may demote to `SOFTWARE_ONLY_LADDER`
 * and retry the current rotation boundary once more, after
 * `decideBoundedRerenderDisposition` has already refused a same-rung
 * rewind. Same shape as its sibling policy functions — a single input, no
 * I/O — for the same reason: nothing but the counter can talk it into
 * re-litigating the bound from some other signal.
 */
export function decideHardwareFailoverDisposition(input: { failoverUsed: boolean }): HardwareFailoverDisposition {
  if (input.failoverUsed) {
    return { action: 'abort' };
  }
  return { action: 'retry-software' };
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
  /**
   * WS3 salvage-runtime round — test-only injection point, mirroring
   * `DriveGlRunDeps.createWorker` one level up. Defaults to real `Worker`
   * construction (unchanged production behavior); a test supplies a fake
   * `ExportWorkerHandle` so a GL piece's salvage/truncate/count wiring is
   * reachable from `exportProjectWebCodecs` itself, not only from `driveGlRun`
   * in isolation.
   */
  deps: { createWorker?: () => ExportWorkerHandle } = {},
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
    salvagedPieces: [],
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
  // WS3 Tier 1 item 3c (Rung 3) — per-EXPORT ceiling (every GL piece
  // combined), matching `MAX_BOUNDARY_REWINDS_PER_EXPORT`'s own doc comment.
  let boundaryRewindsUsed = 0;
  // WS3 Rung 5a — per-EXPORT, one-shot. See `decideHardwareFailoverDisposition`.
  let hardwareFailoverUsed = false;

  for (let pieceIndex = 0; pieceIndex < pieces.length; pieceIndex++) {
    const plan = pieces[pieceIndex]!;
    const frameOffsetForThisPiece = framesCompletedBase;
    // WS3 — the encoder-session plan for this piece, once the worker reports
    // it. Held here so `onFrameProgress` can carry it: the piece count alone
    // cannot show that the session bound engaged, because the bound does not
    // change the piece count.
    let pieceSessions: number | null = null;
    const onFrameProgress = (frame: number): void => {
      onProgress({
        type: 'encoding_segment',
        index: pieceIndex,
        total: pieces.length,
        frame: frameOffsetForThisPiece + frame,
        totalFrames: totalExpectedFramesOverall,
        ...(pieceSessions !== null
          ? {
              encoderSessions: pieceSessions,
              // 1800-frame sessions on this piece's own frame grid.
              encoderSessionIndex: Math.min(pieceSessions - 1, Math.floor(frame / MAX_ENCODER_SESSION_FRAMES)),
            }
          : {}),
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
      const runGlPiece = (
        resumeFromFrameIndex?: number,
        resumeSessionIndex?: number,
        forceSoftware?: boolean,
      ): Promise<RunDriveResult> =>
        driveGlRun(
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
          {
            onSessionPlan: (_pi, sessions) => {
              pieceSessions = sessions;
            },
            createWorker: deps.createWorker,
            resumeFromFrameIndex,
            resumeSessionIndex,
            forceSoftwareEncoder: forceSoftware,
          },
          { originSec: plan.gridOriginSec, baseFrame: plan.gridBaseFrame },
        );

      let driveResult = await runGlPiece();
      // WS3 Tier 1 item 3c — Rung 3, wired to real execution. On a MID-run
      // (rotation) flush timeout only — never the final flush, which already
      // has its own salvage path via `runFinalFlushWithRecovery` — abandon
      // the hung session, truncate back to the last rotation boundary
      // (`sessionByteOffsets`/`sessionFrameIndices`, both already established
      // by a COMPLETED flush before that rotation was ever posted, so no
      // AU-scan is needed to trust the cut point — see
      // `WebCodecsFfmpeg.truncateAnnexbToOffset`'s own doc), and re-render
      // from that boundary forward via a fresh `driveGlRun` call that resumes
      // the SAME piece's frame loop instead of restarting it.
      //
      // `fileBaseByteOffset` tracks how many bytes of `runFile` existed
      // BEFORE the current `driveGlRun` attempt — 0 for the first attempt,
      // then the previous rewind's absolute cut point. Each attempt's OWN
      // `sessionByteOffsets` is LOCAL to that attempt (it starts counting
      // from 0 again because `appendBytes` is per-invocation state), so a
      // SECOND rewind's absolute offset is `fileBaseByteOffset + <local
      // offset>`, never the local offset alone — the file already has bytes
      // on disk this new invocation never wrote and knows nothing about.
      let fileBaseByteOffset = 0;
      while (!driveResult.ok) {
        const liveness = driveResult.error.liveness;
        const hungSessionIndex = liveness?.encoderSessionIndex ?? null;
        const totalSessions = liveness?.encoderSessions ?? null;
        const isRotationFlushTimeout =
          liveness?.failureVia === 'flush-timeout' &&
          hungSessionIndex !== null &&
          totalSessions !== null &&
          hungSessionIndex < totalSessions - 1;
        if (!isRotationFlushTimeout) break;
        const disposition = decideBoundedRerenderDisposition({ rewindsUsed: boundaryRewindsUsed });
        let forceSoftware = false;
        if (disposition.action === 'abort') {
          const failoverDisposition = decideHardwareFailoverDisposition({ failoverUsed: hardwareFailoverUsed });
          if (failoverDisposition.action === 'abort') {
            // eslint-disable-next-line no-console
            console.info('[ws3-rerender] bounded re-render abort', JSON.stringify({ pieceIndex, hungSessionIndex, reason: disposition.reason }));
            break;
          }
          // WS3 Rung 5a — rewind budget exhausted, but this export has not
          // yet tried demoting to software. One more attempt at THIS same
          // boundary, forced onto `SOFTWARE_ONLY_LADDER` for the whole
          // resumed run — see `decideHardwareFailoverDisposition`'s own doc
          // for why this is bounded to exactly one such attempt per export.
          hardwareFailoverUsed = true;
          forceSoftware = true;
          // eslint-disable-next-line no-console
          console.info('[ws3-failover] hardware->software failover engaged', JSON.stringify({ pieceIndex, hungSessionIndex, rewindsUsed: boundaryRewindsUsed }));
        }

        const localByteOffset = driveResult.sessionByteOffsets[hungSessionIndex];
        const rewindFrameIndex = driveResult.sessionFrameIndices[hungSessionIndex];
        if (localByteOffset === undefined || rewindFrameIndex === undefined) {
          // Defensive only — `hungSessionIndex` came from a real 'session-rotate'
          // this same attempt received (that is the only way `encoderSessionIndex`
          // advances past 0), so both arrays MUST have that entry. Never widen
          // this into a guess at the boundary — abort the rewind attempt instead.
          break;
        }
        const absoluteByteOffset = fileBaseByteOffset + localByteOffset;

        let truncateResult: { pictures: number; vclNals: number; bytesRemoved: number; keptBytes: number };
        try {
          // WS3 Round 10 Blocker 1 — Rung 0 says a RECOVERY path may not hang.
          // This call is a native, whole-file streaming truncate on the same
          // annexb file, on the same sidecar, as the salvage path's
          // `ffmpeg.truncateAnnexb` below — it just cuts at a caller-supplied
          // offset rather than at a scanned AU boundary. It was the only such
          // call in the recovery set left unwrapped, so a sidecar that wedged
          // during a rewind hung the export forever, defeating the very bound
          // (`FLUSH_BOUND_MS`) that sent us into the rewind. Same constant as
          // its sibling (`TRUNCATE_BOUND_MS`, 25x the measured worst 2.3 GB
          // streaming truncate), same kill chain on expiry (`ffmpeg.kill()` ->
          // `set_session_cancelled` -> the per-session `AtomicBool` the Rust
          // scanners poll), same typed `FfmpegBoundExpiredError` surfaced
          // through `boundedStepError`.
          truncateResult = await withFfmpegLivenessBound(
            {
              label: 'TRUNCATE_BOUND_MS',
              boundMs: TRUNCATE_BOUND_MS,
              ffmpeg,
              files: [runFile],
              pieceCount: pieces.length,
              pieceIndex,
            },
            async () => await ffmpeg.truncateAnnexbToOffset(runFile, absoluteByteOffset),
          );
        } catch (err) {
          driveResult = {
            ok: false,
            error: {
              ...boundedStepError('concat', `Bounded re-render: failed to truncate ${runFile} to rewind offset ${absoluteByteOffset} (session ${hungSessionIndex}).`, err),
              liveness,
            },
            diagnostics: driveResult.diagnostics,
            silentIntervals: driveResult.silentIntervals,
            appendCallCount: driveResult.appendCallCount,
            appendBytes: driveResult.appendBytes,
            sessionByteOffsets: driveResult.sessionByteOffsets,
            sessionFrameIndices: driveResult.sessionFrameIndices,
            appendLedger: driveResult.appendLedger,
            msSinceLastPhaseChange: driveResult.msSinceLastPhaseChange,
          };
          break;
        }
        // Zero tolerance, same posture as the salvage-truncate-mismatch guard
        // below: the kept portion must hold EXACTLY the frame count of every
        // session before the hung one — `rewindFrameIndex` IS that count, by
        // construction (it is the absolute frame index the hung session
        // started at). A mismatch means `absoluteByteOffset` did not land
        // where `sessionByteOffsets`/`fileBaseByteOffset` said it would —
        // never widened or accepted as a residual; abort the rewind.
        if (truncateResult.pictures !== rewindFrameIndex) {
          driveResult = {
            ok: false,
            error: {
              kind: 'concat',
              message: `Bounded re-render: rewind truncation of ${runFile} to offset ${absoluteByteOffset} kept ${truncateResult.pictures} picture(s), expected exactly ${rewindFrameIndex} (session ${hungSessionIndex}) — aborting rather than resuming from a mismatched boundary.`,
              cause: `rewind boundary mismatch at session ${hungSessionIndex}`,
              liveness,
            },
            diagnostics: driveResult.diagnostics,
            silentIntervals: driveResult.silentIntervals,
            appendCallCount: driveResult.appendCallCount,
            appendBytes: driveResult.appendBytes,
            sessionByteOffsets: driveResult.sessionByteOffsets,
            sessionFrameIndices: driveResult.sessionFrameIndices,
            appendLedger: driveResult.appendLedger,
            msSinceLastPhaseChange: driveResult.msSinceLastPhaseChange,
          };
          break;
        }

        // WS3 Rung 5a — the failover attempt is bounded by its OWN one-shot
        // flag (`hardwareFailoverUsed`, set above), never by this counter:
        // it must not consume a slot from Rung 3's separate rewind budget,
        // and must not be countable twice.
        if (!forceSoftware) {
          boundaryRewindsUsed++;
        }
        fileBaseByteOffset = absoluteByteOffset;
        // eslint-disable-next-line no-console
        console.info('[ws3-rerender] bounded re-render rewind', JSON.stringify({ pieceIndex, hungSessionIndex, rewindFrameIndex, absoluteByteOffset, boundaryRewindsUsed, forceSoftware }));
        // `resumeSessionIndex` (= `hungSessionIndex`, guaranteed non-null by
        // `isRotationFlushTimeout` above) is what stops the RESUMED run's own
        // ledger from defaulting to session 0 if IT hangs again before its
        // own first 'session-rotate' — see `DriveGlRunDeps.resumeSessionIndex`.
        driveResult = await runGlPiece(rewindFrameIndex, hungSessionIndex, forceSoftware);
      }
      if (!driveResult.ok) {
        const watchdogFired = driveResult.error.message.includes('no output for 30s');
        const d = driveResult.diagnostics;
        diag.glPieces.push({
          ...(d ?? {
            ...NO_FLUSH_OBSERVATION,
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
      if (driveResult.salvaged) {
        diag.salvagedPieces.push({ pieceIndex, reason: driveResult.salvageReason ?? 'flush-timeout salvage' });
        // eslint-disable-next-line no-console
        console.warn('[ws3-recovery] gl-piece SALVAGED — completeness now rests entirely on the frame-count guard', JSON.stringify({
          pieceIndex,
          reason: driveResult.salvageReason,
          frameCount: driveResult.frameCount,
          expectedFrames: plan.expectedFrames,
          sessionByteOffsets: driveResult.sessionByteOffsets,
        }));

        // WS3 salvage-runtime round — real truncation, real count, zero
        // tolerance, BEFORE this piece's file is ever concatenated. Ordering
        // (truncate -> count -> compare, per piece, strictly before concat) is
        // deliberate: truncation is a "last complete AU of THIS buffer"
        // operation, so it is only meaningful applied to the exact file whose
        // tail is in question. Post-concat it would find the tail of whichever
        // piece is LAST in the concatenated stream — not this piece, unless
        // this happens to be the last one — and a single-piece export skips
        // concat entirely (`pieceFiles.length === 1` below), so pre-concat,
        // per-piece truncation is the one hook that is uniform across both
        // shapes. `truncateAnnexb` counts the KEPT bytes as its own last step
        // (see the `WebCodecsFfmpeg` interface doc above), so this is one
        // native round-trip, not two.
        let truncateResult: { pictures: number; vclNals: number; bytesRemoved: number; keptBytes: number };
        try {
          truncateResult = await withFfmpegLivenessBound(
            {
              label: 'TRUNCATE_BOUND_MS',
              boundMs: TRUNCATE_BOUND_MS,
              ffmpeg,
              files: [runFile],
              pieceCount: pieces.length,
              pieceIndex,
            },
            async () => await ffmpeg.truncateAnnexb(runFile),
          );
        } catch (err) {
          activeFfmpeg = null;
          return {
            ok: false,
            error: boundedStepError('concat', `Failed to truncate salvaged piece ${pieceIndex} to its last complete access unit.`, err),
          };
        }

        // eslint-disable-next-line no-console
        console.info('[ws3-recovery] gl-piece salvage TRUNCATED', JSON.stringify({ pieceIndex, ...truncateResult }));

        // Zero tolerance — exact match only. Never widened, in either
        // direction: a salvage short by even one picture, or long by even
        // one (a truncation that kept a stray complete-looking picture the
        // encoder never actually finished emitting for this run), aborts.
        if (truncateResult.pictures !== plan.expectedFrames) {
          activeFfmpeg = null;
          return {
            ok: false,
            error: {
              kind: 'concat',
              message: formatSalvageTruncateMismatch({
                pieceIndex,
                pictures: truncateResult.pictures,
                vclNals: truncateResult.vclNals,
                expectedFrames: plan.expectedFrames,
                bytesRemoved: truncateResult.bytesRemoved,
                keptBytes: truncateResult.keptBytes,
                framesEncoded: d.framesEncoded,
                encoderSessionIndex: d.encoderSessionIndex,
                encoderSessions: d.encoderSessions,
                salvageReason: driveResult.salvageReason,
              }),
              cause: `salvaged piece ${pieceIndex} failed its post-truncation exact-match check`,
              // WS3 Tier 1 item 4 — `maxSilentMs` and `appendLedger` used to
              // be silently absent here: this object was hand-rolled at a
              // call site outside driveGlRun's own closure (snapshotLiveness
              // is gone by the time this runs), so it could only include
              // what RunDriveResult happened to expose. `finish` now stamps
              // `appendLedger`/`msSinceLastPhaseChange` onto every
              // RunDriveResult centrally (same mechanism as
              // `sessionByteOffsets`), so this reads from `driveResult`
              // instead of reconstructing a partial copy by hand.
              liveness: {
                lastPhase: d.lastPhase,
                // `driveResult` is narrowed to `ok: true` here (the `!driveResult.ok`
                // branch above returns), so every field `finish` stamps centrally is
                // available directly — no reconstruction, no gaps.
                msSinceLastPhaseChange: driveResult.msSinceLastPhaseChange,
                pieceIndex,
                framesEncoded: d.framesEncoded,
                maxSilentMs: driveResult.maxSilentMs,
                phaseLogTail: d.phaseLog.slice(-LIVENESS_PHASE_LOG_TAIL).map((e) => ({
                  atMs: Math.round(e.atMs),
                  phase: e.phase,
                  pieceIndex: e.pieceIndex,
                  framesEncoded: e.framesEncoded,
                  kind: e.kind,
                })),
                failureVia: 'flush-timeout',
                encoderSessions: d.encoderSessions,
                encoderSessionIndex: d.encoderSessionIndex,
                appendLedger: driveResult.appendLedger,
              },
            },
          };
        }
      }
      // eslint-disable-next-line no-console
      console.info('[ws3-liveness] gl-piece done', JSON.stringify({
        pieceIndex,
        salvaged: driveResult.salvaged,
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
  /** Set ONLY when the guard failed AND the operator explicitly consented to
   *  a knowingly shorter deliverable. `null` on every clean export, which is
   *  what makes the clean path byte-identical to the pre-wiring tree. Carries
   *  the guard's OWN `measured` reading alongside the offer so the seal step
   *  re-uses the real counts rather than reconstructing them from the offer. */
  let forcedSeal: { offer: ForcedMp4SealOffer; measured: AnnexbFrameCount } | null = null;
  try {
    const measured = await withFfmpegLivenessBound(
      { label: 'FRAME_COUNT_BOUND_MS', boundMs: FRAME_COUNT_BOUND_MS, ffmpeg, files: [finalVideoFile], pieceCount: pieces.length },
      async () => await ffmpeg.countAnnexbFrames(finalVideoFile),
    );
    if (concatFrameCountGuardFails(measured, totalExpectedFramesOverall)) {
      let perPiece: PieceFrameCountRow[] = [];
      try {
        // WS3 Round 10 Blocker 1 sweep — the SECOND unbounded native call on a
        // failure disposition. This breakdown runs only once the guard has
        // ALREADY failed, so it is squarely inside the recovery path Rung 0
        // covers, and a wedged sidecar here hangs an export whose verdict is
        // already known. Same measured constant as the aggregate count above:
        // each piece is a strict prefix of the file that bound was sized from,
        // so it can only be more generous, never tighter. Still diagnostic-only
        // — the outer catch keeps a bound expiry from masking the real
        // picture-count mismatch, exactly as a native failure already did.
        perPiece = await Promise.all(
          pieceFiles.map(async (path, pieceIndex) => {
            const rowCount = await withFfmpegLivenessBound(
              { label: 'FRAME_COUNT_BOUND_MS', boundMs: FRAME_COUNT_BOUND_MS, ffmpeg, files: [path], pieceCount: pieces.length, pieceIndex },
              async () => await ffmpeg.countAnnexbFrames(path),
            );
            return {
              pieceIndex,
              path,
              pictures: rowCount.pictures,
              vclNals: rowCount.vclNals,
              expectedFrames: pieces[pieceIndex]!.expectedFrames,
            };
          }),
        );
      } catch {
        // Per-piece breakdown is diagnostic-only — a failure here must not
        // mask the primary picture-count mismatch above.
      }
      // ── WS3 Round 10 Blocker 2 — FORCED SEALING: guard -> offer -> consent
      // -> seal, in that order and no other ─────────────────────────────────
      //
      // The guard above is NOT relaxed by any of this. It has already run, it
      // has already reported the TRUE discrepancy, and `measured` is the
      // post-drop count — the conservative final-AU drop (salvage truncation,
      // per piece, strictly before concat) makes that discrepancy LARGER by
      // exactly one picture, and nothing here compensates for it in either
      // direction. `forcedMp4SealOffer` never rewrites a count and never
      // turns the guard green; it only decides whether a non-empty, strictly
      // shorter, picture-valid prefix EXISTS to be offered.
      const offer = forcedMp4SealOffer(measured, totalExpectedFramesOverall, fps);
      // No offer (empty, or not actually short — e.g. the stream is LONGER
      // than expected, which sealing cannot fix) => the status quo failure.
      // An offer with no consent hook, or a declined one => the same.
      let consented = false;
      if (offer !== null && options.requestForcedSealConsent) {
        try {
          consented = await options.requestForcedSealConsent(offer);
        } catch (consentErr) {
          // A consent surface that throws (an unmounted modal, a rejected
          // dialog promise) is NOT a yes. Falling through to the status-quo
          // failure is the only safe reading, and it must not be reported as
          // "failed to verify the frame count" — the count was verified, and
          // it was wrong.
          // eslint-disable-next-line no-console
          console.warn('[ws3-seal] consent surface threw — treating as declined', causeString(consentErr));
          consented = false;
        }
      }
      if (offer !== null && consented) {
        // eslint-disable-next-line no-console
        console.warn('[ws3-seal] operator consented to a SHORT deliverable', JSON.stringify(offer));
        // The offer's numbers are the POST-DROP numbers by construction:
        // `measured` is the guard's own reading of the concatenated file as
        // it exists on disk after every salvage truncation. The operator is
        // therefore never told more was kept than actually was.
        forcedSeal = { offer, measured };
      } else {
        activeFfmpeg = null;
        return {
          ok: false,
          error: {
            kind: 'concat',
            message: formatConcatFrameCountMismatch({
              measured,
              expectedTotal: totalExpectedFramesOverall,
              pieceCount: pieces.length,
              perPiece,
            }),
          },
        };
      }
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
    const annexbBytes = await ffmpeg.sessionFileSize(finalVideoFile);
    const muxBoundMs = computeMuxBoundMs(annexbBytes);
    await withFfmpegLivenessBound(
      {
        label: 'MUX_BOUND_MS',
        boundMs: muxBoundMs,
        ffmpeg,
        files: [finalVideoFile, ...(audioFile ? [audioFile] : []), outputFile],
        pieceCount: pieces.length,
      },
      async () => {
        if (forcedSeal === null) {
          await muxOnly(ffmpeg, project.id, finalVideoFile, audioFile, outputFile, fps);
          return;
        }
        // WS3 Round 10 Blocker 2 — the SEAL. Same ffmpeg invocations as
        // `muxOnly` (this helper calls it), under the same measured mux bound,
        // with the duration derived from picture count / fps rather than any
        // container metadata the raw Annex-B does not carry. `measured` is the
        // guard's own unmodified reading — never a value reconstructed from
        // the offer — and the helper re-runs `forcedMp4SealOffer` on it,
        // refusing to seal if it no longer describes a shorter, non-empty,
        // picture-valid prefix.
        const disposition = await sealTruncatedAnnexbToMp4({
          ffmpeg,
          sessionId: project.id,
          videoFile: finalVideoFile,
          audioFile,
          outputFile,
          measured: forcedSeal.measured,
          picturesExpected: forcedSeal.offer.picturesExpected,
          fps,
          operatorConsented: true,
        });
        if (disposition.kind !== 'sealed') {
          throw new Error(
            `forced MP4 sealing did not seal (kind=${disposition.kind}` +
              `${disposition.kind === 'not-eligible' ? `, reason=${disposition.reason}` : ''}) — refusing to report success`,
          );
        }
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
