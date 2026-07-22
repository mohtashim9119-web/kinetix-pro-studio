/**
 * THROWAWAY Step 8 QUALITY-COMPARISON SPIKE FILE — byte-for-byte a copy of
 * the real `src/services/webcodecsExport/exportPipelineWebCodecs.ts`
 * (production, UNTOUCHED) with exactly TWO changes: (1) it drives
 * `./exportWorkerSoftwareSpike.ts` (software-forced encoder) instead of the
 * real `exportWorker.ts`, (2) its main export is renamed
 * `exportProjectWebCodecsSoftwareSpike` so it can be imported alongside the
 * real `exportProjectWebCodecs` in the same spike file without a name
 * collision. Everything else — routing, piece-planning, concat, mux — is
 * verbatim, so the software-encoder export goes through the exact same
 * orchestration the real hardware path does; only the encoder differs. Not
 * imported by any production file. Delete alongside the rest of this spike
 * directory once Step 8 is reviewed.
 *
 * ORIGINAL HEADER (src/services/webcodecsExport/exportPipelineWebCodecs.ts):
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
} from '../../services/segmentEncoder';
import type { FrameGlobalConfig } from '../../services/frameRenderer';
import { resolveEffectiveTransition } from '../../services/transitionResolver';
import { isPlainVideoSegment, isPlainImageSegment } from '../../services/plainSegment';
import { isGlCompositableSegment, GL_TRANSITION_SLUGS } from '../../services/webcodecsExport/glCompositable';
import type {
  ExportError,
  ExportResult,
  ProgressCallback,
} from '../../services/exportPipeline';
import type { ProjectEffectConfig } from '../../services/gl/compositeParams';
import type {
  ExportWorkerInboundMessage,
  ExportWorkerInitMessage,
  ExportWorkerOutboundMessage,
} from './exportWorkerSoftwareSpike';
import type { FontConfig } from '../../services/webcodecsExport/textRenderer';
import { muxOnly } from '../../services/webcodecsExport/muxOnly';

/**
 * Step 6 amendment (2026-07-21) — Part B: font URLs for the worker's
 * `GLTextRenderer.init()` (plan §4.3 point 4: "the worker needs concrete
 * URLs for FontFace loading"). Checked how `FONT_FAMILIES` (constants.ts)
 * actually reach the page before wiring this: `src/index.css:1` loads all 51
 * families via a SINGLE `@import url('https://fonts.googleapis.com/css2?
 * family=...')` — a REMOTE CSS STYLESHEET, not bundled font FILES with one
 * concrete URL per family. That stylesheet itself contains `@font-face`
 * rules whose `src` URLs are woff2 files Google's CDN resolves per-request
 * based on `User-Agent` (different font formats/subsets for different
 * engines) — there is no single stable "family -> file URL" map to hand the
 * worker's `FontFace(family, url(...))` loader; resolving one for real would
 * mean fetching/parsing that CSS2 response per family, an actual URL-
 * resolution subsystem, not the "straight pass-through, no transformation
 * needed" this wiring step is scoped to. The main-thread renderer
 * (`frameRenderer.ts`'s `ensureFont`) never has this problem because the
 * `@import` is already loaded into `document.fonts` by the browser before
 * any export runs — a worker has no document and no stylesheet at all.
 * Passing an empty list here is therefore the correct, honest choice (not a
 * shortcut): `GLTextRenderer.init([])` loads nothing, and every subsequent
 * `ctx.font = ...` in the atlas builders falls back to whatever generic
 * family the worker's Canvas2D resolves — the SAME non-fatal degrade
 * `ensureFont`'s own catch block documents ("canvas falls back to system
 * font") for a family that fails to load on the main thread today. A real
 * per-family URL resolver is future work, not silently faked here.
 */
const EXPORT_FONT_CONFIGS: FontConfig[] = [];

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
}

function causeString(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
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
      const first = runSegments[0]!;
      const last = runSegments[runSegments.length - 1]!;
      // Matches exportWorker.ts's own totalFrames formula EXACTLY (line
      // ~541: `Math.max(0, Math.round((runEndSec - runStartSec) * fps))`
      // with runStartSec = first.startTime, runEndSec = last.startTime +
      // last.duration) — the absolute frame grid the worker actually walks.
      const expectedFrames = Math.max(0, Math.round((last.startTime + last.duration - first.startTime) * fps));
      pieces.push({ tier: 'gl', segments: runSegments, startIndex: i, expectedFrames });
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
      pieces.push({ tier: 'plain', segments: [segment], startIndex: i, expectedFrames });
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
      pieces.push({ tier: 'canvas', segments: [segment], startIndex: i, expectedFrames });
      i++;
    }
  }
  return pieces;
}

// ---------------------------------------------------------------------------
// Part 3 — Driving a GL piece (unchanged from Step 4 — the worker driving,
// chunk-append serialization, and watchdog logic below are exactly Step 4's
// `driveGlRun`, generalized only in that the caller now invokes it once per
// GL piece instead of exactly once for the whole project).
// ---------------------------------------------------------------------------

type RunDriveResult =
  | { ok: true; frameCount: number }
  | { ok: false; error: ExportError };

const WATCHDOG_MS = 30_000;

function driveGlRun(
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
): Promise<RunDriveResult> {
  return new Promise((resolve) => {
    // STEP 8 SPIKE OVERRIDE — points at the software-forced worker duplicate,
    // not the real exportWorker.ts.
    const worker = new Worker(new URL('./exportWorkerSoftwareSpike.ts', import.meta.url), { type: 'module' });
    activeWorker = worker;

    let appendQueue: Promise<void> = Promise.resolve();
    let appendError: Error | null = null;
    let framesAppended = 0;
    let settled = false;
    let watchdogTimer: ReturnType<typeof setTimeout> | null = null;

    const clearWatchdog = (): void => {
      if (watchdogTimer) {
        clearTimeout(watchdogTimer);
        watchdogTimer = null;
      }
    };
    const resetWatchdog = (): void => {
      clearWatchdog();
      watchdogTimer = setTimeout(() => {
        finish({
          ok: false,
          error: { kind: 'unknown', message: 'Export worker produced no output for 30s — aborting (watchdog).' },
        });
      }, WATCHDOG_MS);
    };

    const finish = (result: RunDriveResult): void => {
      if (settled) return;
      settled = true;
      clearWatchdog();
      if (activeWorker === worker) activeWorker = null;
      worker.terminate();
      resolve(result);
    };

    worker.onmessage = (ev: MessageEvent<ExportWorkerOutboundMessage>) => {
      const data = ev.data;
      switch (data.type) {
        case 'chunk': {
          resetWatchdog();
          const bytes = new Uint8Array(data.bytes);
          // Serialized append queue (plan §4.4): each appendFileRaw call is
          // awaited before the next chunk's is issued, so on-disk append
          // order matches encode order — appendFileRaw itself makes no such
          // guarantee across concurrent calls (tauriFfmpeg.ts's own doc
          // comment: "the caller is responsible for awaiting each call
          // before issuing the next").
          appendQueue = appendQueue.then(async () => {
            if (appendError || settled) return;
            try {
              await ffmpeg.appendFileRaw(runFile, bytes);
              framesAppended++;
              onFrameProgress(framesAppended, totalExpectedFrames);
            } catch (err) {
              appendError = err instanceof Error ? err : new Error(causeString(err));
            }
          });
          break;
        }
        case 'run-done':
          // A worker call in this step is always exactly one run — `done`
          // always follows immediately, so there is nothing to do here
          // beyond what `done` already handles.
          break;
        case 'done':
          // Must wait for the append queue to fully drain — the worker
          // finishing its encode says nothing about whether every chunk has
          // actually landed on disk yet.
          void appendQueue.then(() => {
            if (appendError) {
              finish({
                ok: false,
                error: { kind: 'encode', message: 'Failed to append an encoded chunk to disk.', cause: appendError.message },
              });
              return;
            }
            finish({ ok: true, frameCount: data.frameCount });
          });
          break;
        case 'error':
          finish({ ok: false, error: { kind: 'encode', message: 'Export worker reported an error.', cause: data.message } });
          break;
        case 'cancelled':
          finish({ ok: false, error: { kind: 'cancelled', message: 'Export cancelled.' } });
          break;
        case 'queue-sample':
          // Diagnostic-only (exportWorker.ts's own doc comment) — still a
          // liveness signal for the watchdog.
          resetWatchdog();
          break;
      }
    };

    worker.onerror = (ev: ErrorEvent) => {
      finish({
        ok: false,
        error: { kind: 'encode', message: 'Export worker crashed.', cause: `${ev.message} at ${ev.filename}:${ev.lineno}` },
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
    };
    resetWatchdog();
    worker.postMessage(initMsg);
  });
}

// ---------------------------------------------------------------------------
// Part 4 — Driving Tier 1 / Tier C pieces + the annexb remux (plan §4.4).
// ---------------------------------------------------------------------------

async function remuxMp4ToAnnexb(ffmpeg: WebCodecsFfmpeg, mp4File: string, h264File: string): Promise<void> {
  // Stream-copy: no re-encode, no quality change — only the container
  // changes (MP4 -> raw annexb H.264), milliseconds per piece (plan §4.4).
  await ffmpeg.exec(['-i', mp4File, '-c', 'copy', '-bsf:v', 'h264_mp4toannexb', '-f', 'h264', '-y', h264File]);
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
): Promise<PieceEncodeResult> {
  const mp4File = `tier1_piece_${pieceIndex}.mp4`;
  const h264File = `piece_${pieceIndex}.h264`;
  try {
    const mp4Bytes =
      asset.type === 'video'
        ? await encodePlainVideoSegment(segment, asset, ffmpeg, { fps, width, height })
        : await encodeStaticImageSegment(segment, asset, globalConfig, ffmpeg, { fps, width, height });
    await ffmpeg.writeFile(mp4File, mp4Bytes);
    await remuxMp4ToAnnexb(ffmpeg, mp4File, h264File);
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
    const mp4Bytes = await encodeSegment(segment, asset, ffmpeg, globalConfig, {
      fps,
      width,
      height,
      nextSegment,
      nextAsset,
      globalTransitionDuration: project.globalTransitionDuration,
      globalTransition: project.globalTransition,
      startTimeOffset,
      trailingExtension,
      onProgress: onFrameProgress,
    });
    await ffmpeg.writeFile(mp4File, mp4Bytes);
    await remuxMp4ToAnnexb(ffmpeg, mp4File, h264File);
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
// The plan's own text (§4.4) suggests "ffmpeg -i frame count via the
// existing exec + stderr parse pattern, or -f null - packet count" — NEITHER
// is actually available through the existing `ffmpeg_exec` Rust command:
// reading `src-tauri/src/ffmpeg.rs`'s `ffmpeg_exec` directly (not modifiable
// this step — see this file's own scope) shows it collects stderr
// internally but only RETURNS it to the caller on a NON-ZERO exit code; a
// successful `-f null -` decode returns only the bare exit code, with no
// `frame=`/packet-count text surfaced at all. Modifying `ffmpeg.rs` to add a
// dedicated probe command is out of this step's explicit scope (it is on
// the "files NOT modified" list). `countAnnexbFrames` below is the
// self-contained alternative: a linear scan for Annex B start codes,
// counting NAL units of type 1 (non-IDR slice) or 5 (IDR slice) — one per
// coded picture for a single-slice-per-frame stream, which is what BOTH this
// app's Tier 1/C `libx264 -preset fast` output (segmentEncoder.ts, no
// multi-slice config) and the GL worker's `VideoEncoder` (exportWorker.ts,
// no slicing options set) always produce. This does mean reading
// `video_all.h264`'s full bytes back into the renderer via `ffmpeg.readFile`
// — a real, but much smaller-scale, re-introduction of the "read a file back
// into the renderer" pattern the 2026-07-14 OOM fix moved away from for the
// FINAL MP4. The two are not the same class of risk: that fix was about a
// RAW-PIXEL PNG pipeline inflating a file's size ~5-6x through base64/array
// serialization before the fix; this is a single `Uint8Array` read of a
// COMPRESSED H.264 elementary stream (typically low-single-digit MB per
// minute of output at this app's export bitrates), read once, scanned once,
// and never serialized further. Flagged here, and in this step's report, as
// a concrete follow-up: a dedicated Rust probe command (returning just a
// frame count, never the bytes) would remove this cost entirely, but adding
// one is a `ffmpeg.rs`/`lib.rs` change outside this step's explicit scope.
// ---------------------------------------------------------------------------

/**
 * Counts H.264 Annex B coded-picture NAL units (type 1 = non-IDR slice,
 * type 5 = IDR slice) in a raw byte stream. See the section header above for
 * why this exists instead of parsing ffmpeg's own stderr, and the
 * single-slice-per-frame assumption it relies on (true for every encoder
 * this app's export paths use).
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

/**
 * Exported (beyond this file's own internal use) so the Step 5 spike's
 * concat-guard negative test (`src/dev/webcodecsStep2Spike/main.ts`) can
 * exercise the REAL concat call against a deliberately-corrupted piece,
 * rather than re-deriving the same ffmpeg command in test-only code.
 */
export async function concatAnnexbPieces(ffmpeg: WebCodecsFfmpeg, pieceFiles: string[], outFile: string): Promise<void> {
  await ffmpeg.exec(['-f', 'h264', '-i', `concat:${pieceFiles.join('|')}`, '-c', 'copy', '-y', outFile]);
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
export async function exportProjectWebCodecsSoftwareSpike(
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
          fontConfigs: EXPORT_FONT_CONFIGS,
          globalOverlayConfig: project.globalOverlayConfig,
          textLayers: project.textLayers ?? [],
          headings: project.headings ?? [],
        },
      );
      if (!driveResult.ok) {
        activeFfmpeg = null;
        return { ok: false, error: driveResult.error };
      }
      pieceFiles.push(runFile);
    } else if (plan.tier === 'plain') {
      const segment = plan.segments[0]!;
      const asset = assetMap.get(segment.assetId!)!; // presence already verified above
      const result = await encodeTier1Piece(ffmpeg, segment, asset, globalConfig, fps, width, height, pieceIndex);
      onFrameProgress(plan.expectedFrames);
      if (!result.ok) {
        activeFfmpeg = null;
        return { ok: false, error: result.error };
      }
      pieceFiles.push(result.h264File);
    } else {
      const result = await encodeCanvasPiece(ffmpeg, plan, project, assetMap, globalConfig, fps, width, height, pieceIndex, onFrameProgress);
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
    } else {
      await concatAnnexbPieces(ffmpeg, pieceFiles, videoAllFile);
    }
  } catch (err) {
    activeFfmpeg = null;
    return { ok: false, error: { kind: 'concat', message: 'Failed to concatenate the encoded pieces.', cause: causeString(err) } };
  }
  const finalVideoFile = pieceFiles.length === 1 ? pieceFiles[0]! : videoAllFile;

  // ── Loud-failure frame-count guard (plan §4.4) — never ship silently
  // corrupt output ─────────────────────────────────────────────────────────
  try {
    const rawBytes = await ffmpeg.readFile(finalVideoFile);
    const bytes = typeof rawBytes === 'string' ? new TextEncoder().encode(rawBytes) : rawBytes;
    const actualFrames = countAnnexbFrames(bytes);
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
    return { ok: false, error: { kind: 'concat', message: 'Failed to verify the concatenated output frame count.', cause: causeString(err) } };
  }

  // ── Mux voiceover audio (unchanged — ./muxOnly.ts) ────────────────────────
  const outputFile = 'export_final.mp4';
  const voiceoverAsset = project.voiceoverId ? assetMap.get(project.voiceoverId) : undefined;
  let audioFile: string | null = null;

  try {
    if (voiceoverAsset?.url) {
      audioFile = 'voiceover_audio';
      const audioResp = await fetch(voiceoverAsset.url);
      const audioBytes = new Uint8Array(await audioResp.arrayBuffer());
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
    await muxOnly(ffmpeg, project.id, finalVideoFile, audioFile, outputFile, fps);
  } catch (err) {
    activeFfmpeg = null;
    return { ok: false, error: { kind: 'mux', message: 'Failed to mux the encoded output with audio.', cause: causeString(err) } };
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
