/**
 * Durable export checkpoint manifest (`export_state.json`).
 *
 * This module owns canonical timeline identity, manifest writing, strict
 * parsing/invalidation, and the mandatory pre-append repair handshake. The
 * production orchestrator deliberately does not import it yet: that call site
 * is owned separately, but any future caller must go through
 * `prepareCheckpointResume` before appending to a surviving session.
 */

import { sha256Hex } from './annexbChunkCompare';
import { getFileIdentity } from '../syncEngine';
import type { Asset, HeadingOverlay, Project, SegmentGrade, TextOverlay, VideoSegment } from '../../types';

export const EXPORT_STATE_SCHEMA_VERSION = 1;
export const EXPORT_STATE_FILENAME = 'export_state.json';

/** Bumped when fields included in `sourceTimelineHash` change. Old manifests
 *  whose hash was computed over a narrower identity set invalidate on resume. */
export const EXPORT_TIMELINE_IDENTITY_VERSION = 2;

/** In-process recovery bounds from `exportPipelineWebCodecs.ts` (dedc3bf). */
export const MAX_BOUNDARY_REWINDS_PER_EXPORT = 2;
export const MAX_HARDWARE_FAILOVER_PER_EXPORT = 1;
/** 1 initial + 2 rewinds + 1 software failover `driveGlRun` attempts. */
export const MAX_DRIVE_GL_RUN_ATTEMPTS_PER_EXPORT = 4;
/** 2 rewind truncates + 1 failover truncate (exact-offset). */
export const MAX_TRUNCATES_PER_EXPORT = 3;
/** Cross-process ceiling on rewind/failover/resume-repair events for one export. */
export const MAX_TOTAL_RECOVERY_ATTEMPTS_PER_EXPORT = MAX_DRIVE_GL_RUN_ATTEMPTS_PER_EXPORT;

/**
 * Canonical identity of the timeline a checkpoint may be applied to.
 *
 * Invalidation key: `sourceTimelineHash` = SHA-256 of the canonical JSON of
 * this object (stable key order, no whitespace variance). A checkpoint is
 * stale — and must never be applied — when this hash disagrees with the
 * project currently in memory. That is the only resume gate against an
 * edited timeline: not mtime, not project id alone, not segment count.
 */
export interface ExportTimelineIdentity {
  schema: 1;
  /** Included in the hash — bump `EXPORT_TIMELINE_IDENTITY_VERSION` when this
   *  object's covered fields change so old checkpoints invalidate. */
  timelineIdentityVersion: typeof EXPORT_TIMELINE_IDENTITY_VERSION;
  projectId: string;
  voiceoverId: string | null;
  voiceoverFileIdentity: string | null;
  fps: number;
  width: number;
  height: number;
  aspectRatio: string | null;
  resolutionTier: string | null;
  globalTransition: string;
  globalTransitionDuration: number;
  globalAnimation: string;
  globalOverlayFilter: string | null;
  globalOverlayConfig: {
    color: string;
    backgroundColor: string;
    fontFamily: string;
    fontSize?: number;
    fontWeight?: string | number;
    fontStyle?: 'normal' | 'italic';
    textShadow?: string;
    animation?: string;
    x?: number;
    y?: number;
  };
  /** Cheap asset identity — `name|size|lastModified` when `File` is present,
   *  else `name|addedAt`. Does not hash blob bytes. */
  assets: ReadonlyArray<{
    id: string;
    fileIdentity: string | null;
  }>;
  segments: ReadonlyArray<{
    id: string;
    startTime: number;
    duration: number;
    assetId: string | null;
    trimStart: number | null;
    trimEnd: number | null;
    order: number;
    transition: string;
    transitionDuration: number | null;
    animation: string;
    overlayFilter: string | null;
    showOverlay: boolean | null;
    text: string;
    overlayConfig: VideoSegment['overlayConfig'] | null;
    extraOverlays: ReadonlyArray<{
      id: string;
      text: string;
      color: string;
      backgroundColor: string;
      fontFamily: string;
      fontSize: number;
      fontWeight?: string | number;
      fontStyle?: 'normal' | 'italic';
      textDecoration?: 'none' | 'underline';
      textShadow?: string;
      position: { x: number; y: number };
      animation?: string;
      textAlign?: 'left' | 'center' | 'right';
      hiddenOnSegments?: string[];
    }> | null;
    effectTransition?: string;
    effectTransitionDuration?: number;
    effectAnimation?: string;
    effectAnimationDuration?: number;
    effectAnimationScaleRate?: number;
    effectOverlay?: string;
    effectGrade?: SegmentGrade | null;
  }>;
  headings: ReadonlyArray<{
    id: string;
    time: number;
    duration: number;
    text: string;
  }>;
  textLayers: ReadonlyArray<{
    id: string;
    text: string;
    hiddenOnSegments: string[] | null;
  }>;
}

export interface ExportCheckpointRecord {
  /** 0-based piece in the orchestrator's piece list. */
  pieceIndex: number;
  /** 0-based VideoEncoder session inside that piece (rotation index). */
  encoderSessionIndex: number;
  /** Byte offset into the session piece Annex-B file AFTER this checkpoint.
   *  Offsets are per-piece while rendering; a concatenated file exists only
   *  after concat — never assume a single on-disk concatenated path mid-export. */
  byteOffset: number;
  /** Access-unit count in `[0, byteOffset)` of that same piece file. */
  cumulativePictures: number;
  /**
   * WS3 Round 10 (CC wiring edit, named in that round's report) — the ENCODER
   * ROTATION SEAM this checkpoint was taken at: the byte count at the instant
   * the previous encoder session's output ended.
   *
   * Why both offsets exist. `byteOffset` is where the FENCE can verify: its
   * step-5 re-repair drops a final access unit it cannot prove closed, so an
   * offset cut exactly at the seam — which ends on a coded slice with nothing
   * after it — is refused. The fence therefore needs `byteOffset` to sit just
   * past the next access unit's leading non-VCL run. But appending a
   * re-rendered access unit onto a prefix that already holds that unit's
   * parameter sets and AUD writes them TWICE, which is not a conforming
   * access-unit sequence and which the picture counter cannot see.
   *
   * So: the fence verifies at `byteOffset`, and the caller then cuts back to
   * `seamByteOffset` before appending. Both prefixes hold exactly
   * `cumulativePictures` pictures — the bytes between them contain no coded
   * slice — so the cut is verifiable, not assumed.
   *
   * Optional so a manifest written before this field existed still validates;
   * a checkpoint without it simply is not resumed byte-exactly.
   */
  seamByteOffset?: number;
  fps: number;
  width: number;
  height: number;
  /** Same hash as `ExportStateManifest.sourceTimelineHash` at write time. */
  sourceTimelineHash: string;
}

export interface ExportRecoveryBudget {
  /** Boundary rewinds consumed this export (default 0). */
  boundaryRewindsUsed?: number;
  /** Whether the one-shot hardware→software failover has fired (default false). */
  hardwareFailoverUsed?: boolean;
  /** Resume-handshake attempts for the current checkpoint generation (default 0). */
  checkpointResumeAttempts?: number;
  /** Rewind + failover + resume-repair events across process restarts (default 0). */
  totalRecoveryAttempts?: number;
}

export interface ExportStateManifest extends ExportRecoveryBudget {
  schemaVersion: typeof EXPORT_STATE_SCHEMA_VERSION;
  /**
   * WS3 STEP 9 (C7) — every `VideoEncoder` session rotation this piece hit,
   * REGARDLESS of whether it produced a durable checkpoint. Default 0.
   * Paired with `checkpoints.length` (successes only), the gap between them
   * is exactly the checkpoint-coverage question
   * `exportCheckpointPlacement.ts` raises: `rotationsSeen > checkpoints
   * .length` means at least one seam had no fence-safe offset. See
   * `validateExportState`'s `never_checkpointed` kind, which is gated on
   * `rotationsSeen > 0 && checkpoints.length === 0` specifically so a
   * single-session export (the common case — anything under
   * `MAX_ENCODER_SESSION_FRAMES`) never trips it.
   */
  rotationsSeen?: number;
  /** ffmpeg session id (`kinetix-export-{uuid}`). */
  sessionId: string;
  projectId: string;
  sourceTimelineHash: string;
  fps: number;
  width: number;
  height: number;
  checkpoints: ExportCheckpointRecord[];
}

export interface ExportCheckpointExpectedIdentity {
  projectId: string;
  sourceTimelineHash: string;
  fps: number;
  width: number;
  height: number;
}

export interface AnnexbCheckpointRepairResult {
  pictures: number;
  vclNals: number;
  bytesRemoved: number;
  keptBytes: number;
}

export interface ExportCheckpointResumeIo {
  sessionFileSize(path: string): Promise<number>;
  /**
   * Native atomic handshake: inspect the tail backwards, truncate to the last
   * whole access unit unconditionally, truncate to the recorded byte offset,
   * then re-count the kept prefix before allowing append/count/concat.
   */
  prepareCheckpointResume(
    path: string,
    checkpoint: ExportCheckpointRecord,
  ): Promise<AnnexbCheckpointRepairResult>;
}

export type ExportCheckpointValidation =
  | {
      kind: 'resume';
      manifest: ExportStateManifest;
      checkpoint: ExportCheckpointRecord;
    }
  | {
      kind: 'clean';
      reason: string;
    }
  | {
      /** Persisted recovery budget exhausted — distinct from a generic clean refusal. */
      kind: 'recovery_budget_exhausted';
      reason: string;
      budget: Required<ExportRecoveryBudget>;
    }
  | {
      /**
       * WS3 STEP 9 (C7) — the manifest matches this exact timeline (project,
       * hash, fps/resolution all agree — this is NOT a stale/irrelevant
       * manifest), the encoder rotated at least once (`rotationsSeen > 0`),
       * and YET `checkpoints` is EMPTY: every rotation seam this export hit
       * failed `fenceSafeCheckpointOffset` (`exportCheckpointPlacement.ts`).
       *
       * Deliberately gated on `rotationsSeen > 0`, not just
       * `checkpoints.length === 0` — a single-session export (anything
       * under `MAX_ENCODER_SESSION_FRAMES`, 60s) never rotates at all and
       * legitimately has zero checkpoints; that is the overwhelmingly
       * common, entirely unremarkable case and must stay silent. This kind
       * fires only for the genuinely worse outcome: an export that DID
       * rotate but could never durably checkpoint any of those rotations,
       * so a crash mid-export silently offers nothing to resume from —
       * exactly the gap this round's checkpoint-coverage investigation
       * found and this kind exists to stop being silent about.
       */
      kind: 'never_checkpointed';
      reason: string;
    };

export type ExportCheckpointPreparation =
  | {
      kind: 'resume';
      manifest: ExportStateManifest;
      checkpoint: ExportCheckpointRecord;
      repair: AnnexbCheckpointRepairResult;
    }
  | {
      kind: 'clean';
      reason: string;
    }
  | {
      kind: 'recovery_budget_exhausted';
      reason: string;
      budget: Required<ExportRecoveryBudget>;
    }
  | {
      /** The Annex-B file was mutated before the handshake completed. */
      kind: 'bitstream_touched';
      reason: string;
      repair: Partial<AnnexbCheckpointRepairResult> & {
        keptBytes: number;
        bytesRemoved: number;
      };
    }
  | {
      /** WS3 STEP 9 (C7) — mirrors `ExportCheckpointValidation`'s own kind;
       *  see its doc comment. Reached here before any native mutation, same
       *  as `clean`/`recovery_budget_exhausted`. */
      kind: 'never_checkpointed';
      reason: string;
    };

/**
 * Resume handshake seam (CC call site lives in exportPipelineWebCodecs.ts /
 * encoderSessionPlan.ts — not edited here).
 *
 * CC must supply, and nothing else:
 * 1. The surviving session id (from `TauriFfmpeg.listResumableSessionIds` +
 *    `reenter`) — never mint a new UUID for a resume.
 * 2. `serializedManifest` bytes from `export_state.json`.
 * 3. `expected` identity: `{projectId, sourceTimelineHash, fps, width, height}`
 *    of the project currently in memory (`buildSourceTimelineHash` of
 *    `timelineIdentityFromProject`).
 * 4. The surviving Annex-B `path` inside that session.
 * 5. An `ExportCheckpointResumeIo` whose `prepareCheckpointResume` is
 *    `TauriFfmpeg.prepareCheckpointResume` (native atomic handshake).
 * 6. Rotation-seam call sites that call `appendExportCheckpoint` then
 *    `serializeExportState` then `TauriFfmpeg.writeExportState`. CC does
 *    not design the write; those three are the complete writer primitive.
 *
 * HARD PRECONDITION — pre-append fence ordering, native and mandatory:
 * 1. find the final start code (backwards tail inspection)
 * 2. unconditional whole-AU repair (`ffmpeg_truncate_annexb`)
 * 3. assert repair did not fall before the checkpoint byte offset
 * 4. exact-offset truncate (`ffmpeg_truncate_annexb_to_offset`)
 * 5. re-repair asserting `bytesRemoved == 0`
 * 6. recount; assert `pictures == cumulativePictures`
 * 7. only then clear `resume_pending`
 *
 * `prepareCheckpointResume` (this module) + `ffmpeg_prepare_checkpoint_resume`
 * (Rust) already perform that order. CC must not append, count, or concat
 * while `resume_pending` is set, and must not skip `prepareCheckpointResume`.
 *
 * Postconditions: `{kind:'resume', repair}` with `repair.keptBytes ===
 * checkpoint.byteOffset` (both measured on the same surviving **piece** file)
 * and `repair.pictures === checkpoint.cumulativePictures`, fence cleared;
 * `{kind:'clean'}` with a reason when the bitstream is provably untouched; or
 * `{kind:'bitstream_touched', repair}` when repair mutated the file before failing.
 *
 * Errors: native repair failure after mutation → `{kind:'bitstream_touched'}`;
 * failure without mutation → `{kind:'clean'}`; hash/schema/monotonicity/budget
 * mismatch → `{kind:'clean'}` without Annex-B I/O.
 *
 * Call ordering: list/reenter → readExportState → prepareCheckpointResume →
 * (only on kind=resume) append remainder. Writer at a rotation seam:
 * appendExportCheckpoint → serializeExportState → writeExportState.
 */
export type ResumeHandshakeSeam = {
  validate: typeof validateExportState;
  prepare: typeof prepareCheckpointResume;
  appendCheckpoint: typeof appendExportCheckpoint;
  serialize: typeof serializeExportState;
  createManifest: typeof createExportStateManifest;
};

export function assetFileIdentity(asset: Asset): string | null {
  if (asset.file) {
    return getFileIdentity(asset.file);
  }
  if (asset.addedAt != null) {
    return `${asset.name}|${asset.addedAt}`;
  }
  return null;
}

export function timelineIdentityFromProject(
  project: Pick<
    Project,
    | 'id'
    | 'voiceoverId'
    | 'lastTranscribedFileIdentity'
    | 'aspectRatio'
    | 'resolutionTier'
    | 'globalTransition'
    | 'globalTransitionDuration'
    | 'globalAnimation'
    | 'globalOverlayFilter'
    | 'globalOverlayConfig'
    | 'segments'
    | 'headings'
    | 'textLayers'
    | 'assets'
  >,
  dims: { fps: number; width: number; height: number },
): ExportTimelineIdentity {
  return {
    schema: 1,
    timelineIdentityVersion: EXPORT_TIMELINE_IDENTITY_VERSION,
    projectId: project.id,
    voiceoverId: project.voiceoverId ?? null,
    voiceoverFileIdentity: project.lastTranscribedFileIdentity ?? null,
    fps: dims.fps,
    width: dims.width,
    height: dims.height,
    aspectRatio: project.aspectRatio ?? null,
    resolutionTier: project.resolutionTier ?? null,
    globalTransition: project.globalTransition,
    globalTransitionDuration: project.globalTransitionDuration,
    globalAnimation: project.globalAnimation,
    globalOverlayFilter: project.globalOverlayFilter ?? null,
    globalOverlayConfig: { ...project.globalOverlayConfig },
    assets: [...project.assets]
      .sort((a, b) => a.id.localeCompare(b.id))
      .map((asset) => ({
        id: asset.id,
        fileIdentity: assetFileIdentity(asset),
      })),
    segments: project.segments.map(segmentIdentity),
    headings: (project.headings ?? []).map(headingIdentity),
    textLayers: (project.textLayers ?? []).map(textLayerIdentity),
  };
}

function segmentIdentity(s: VideoSegment): ExportTimelineIdentity['segments'][number] {
  return {
    id: s.id,
    startTime: s.startTime,
    duration: s.duration,
    assetId: s.assetId ?? null,
    trimStart: s.trimStart ?? null,
    trimEnd: s.trimEnd ?? null,
    order: s.order,
    transition: s.transition,
    transitionDuration: s.transitionDuration ?? null,
    animation: s.animation,
    overlayFilter: s.overlayFilter ?? null,
    showOverlay: s.showOverlay ?? null,
    text: s.text,
    overlayConfig: s.overlayConfig ?? null,
    extraOverlays: s.extraOverlays?.map(textOverlayIdentity) ?? null,
    effectTransition: s.effectTransition,
    effectTransitionDuration: s.effectTransitionDuration,
    effectAnimation: s.effectAnimation,
    effectAnimationDuration: s.effectAnimationDuration,
    effectAnimationScaleRate: s.effectAnimationScaleRate,
    effectOverlay: s.effectOverlay,
    effectGrade: s.effectGrade ?? null,
  };
}

function textOverlayIdentity(t: TextOverlay): NonNullable<ExportTimelineIdentity['segments'][number]['extraOverlays']>[number] {
  return {
    id: t.id,
    text: t.text,
    color: t.color,
    backgroundColor: t.backgroundColor,
    fontFamily: t.fontFamily,
    fontSize: t.fontSize,
    fontWeight: t.fontWeight,
    fontStyle: t.fontStyle,
    textDecoration: t.textDecoration,
    textShadow: t.textShadow,
    position: { ...t.position },
    animation: t.animation,
    textAlign: t.textAlign,
    hiddenOnSegments: t.hiddenOnSegments,
  };
}

function headingIdentity(h: HeadingOverlay): ExportTimelineIdentity['headings'][number] {
  return { id: h.id, time: h.time, duration: h.duration, text: h.text };
}

function textLayerIdentity(t: TextOverlay): ExportTimelineIdentity['textLayers'][number] {
  return {
    id: t.id,
    text: t.text,
    hiddenOnSegments: t.hiddenOnSegments ?? null,
  };
}

/** Stable JSON: sorted keys, no insignificant whitespace other than the stringify default of compact. */
export function canonicalTimelineJson(identity: ExportTimelineIdentity): string {
  return JSON.stringify(sortKeys(identity));
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortKeys);
  }
  if (value !== null && typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(obj).sort()) {
      out[key] = sortKeys(obj[key]);
    }
    return out;
  }
  return value;
}

export async function buildSourceTimelineHash(identity: ExportTimelineIdentity): Promise<string> {
  return sha256Hex(new TextEncoder().encode(canonicalTimelineJson(identity)));
}

export function normalizeRecoveryBudget(
  budget: ExportRecoveryBudget | undefined,
): Required<ExportRecoveryBudget> {
  return {
    boundaryRewindsUsed: budget?.boundaryRewindsUsed ?? 0,
    hardwareFailoverUsed: budget?.hardwareFailoverUsed ?? false,
    checkpointResumeAttempts: budget?.checkpointResumeAttempts ?? 0,
    totalRecoveryAttempts: budget?.totalRecoveryAttempts ?? 0,
  };
}

/**
 * WS3 STEP 9 (C7) — the three recovery events that must persist to the
 * durable manifest, pure and monotonic like `appendExportCheckpoint`. Each
 * bumps `totalRecoveryAttempts` alongside its own specific counter — a
 * rewind, a failover, and a resume attempt are each their own event toward
 * the cross-process ceiling (`MAX_TOTAL_RECOVERY_ATTEMPTS_PER_EXPORT`),
 * not sub-events of one another. See `exportPipelineWebCodecs.ts`'s STEP 9
 * wiring for why the in-process rewind/failover counters must ALSO be
 * seeded from a resumed manifest's own `boundaryRewindsUsed`/
 * `hardwareFailoverUsed` — otherwise a resumed process's fresh in-memory
 * counters would grant a NEW full rewind/failover budget on top of
 * whatever the crashed process already spent, and persisting these counts
 * here would be recording numbers nothing actually enforces.
 */
export function recordBoundaryRewind(manifest: ExportStateManifest): ExportStateManifest {
  const budget = normalizeRecoveryBudget(manifest);
  return {
    ...manifest,
    boundaryRewindsUsed: budget.boundaryRewindsUsed + 1,
    totalRecoveryAttempts: budget.totalRecoveryAttempts + 1,
  };
}

export function recordHardwareFailover(manifest: ExportStateManifest): ExportStateManifest {
  const budget = normalizeRecoveryBudget(manifest);
  return {
    ...manifest,
    hardwareFailoverUsed: true,
    totalRecoveryAttempts: budget.totalRecoveryAttempts + 1,
  };
}

/**
 * WS3 STEP 9 (C7) — records a rotation REGARDLESS of whether it produced a
 * durable checkpoint. Called on every 'session-rotate', not just the ones
 * that pass `fenceSafeCheckpointOffset` — the whole point is to make the
 * gap between "rotations seen" and "checkpoints written" visible. Not a
 * recovery event (does not touch `totalRecoveryAttempts`): a rotation is
 * normal operation, never a failure by itself.
 */
export function recordRotationSeen(manifest: ExportStateManifest): ExportStateManifest {
  return {
    ...manifest,
    rotationsSeen: (manifest.rotationsSeen ?? 0) + 1,
  };
}

export function recordResumeAttempt(manifest: ExportStateManifest): ExportStateManifest {
  const budget = normalizeRecoveryBudget(manifest);
  return {
    ...manifest,
    checkpointResumeAttempts: budget.checkpointResumeAttempts + 1,
    totalRecoveryAttempts: budget.totalRecoveryAttempts + 1,
  };
}

export function isRecoveryBudgetExhausted(manifest: ExportRecoveryBudget): boolean {
  const budget = normalizeRecoveryBudget(manifest);
  if (budget.boundaryRewindsUsed >= MAX_BOUNDARY_REWINDS_PER_EXPORT) {
    return true;
  }
  if (budget.totalRecoveryAttempts >= MAX_TOTAL_RECOVERY_ATTEMPTS_PER_EXPORT) {
    return true;
  }
  return false;
}

export function recoveryBudgetExhaustionReason(manifest: ExportRecoveryBudget): string {
  const budget = normalizeRecoveryBudget(manifest);
  if (budget.boundaryRewindsUsed >= MAX_BOUNDARY_REWINDS_PER_EXPORT) {
    return `recovery budget exhausted: boundary rewinds ${budget.boundaryRewindsUsed}/${MAX_BOUNDARY_REWINDS_PER_EXPORT}`;
  }
  if (budget.totalRecoveryAttempts >= MAX_TOTAL_RECOVERY_ATTEMPTS_PER_EXPORT) {
    return `recovery budget exhausted: total recovery attempts ${budget.totalRecoveryAttempts}/${MAX_TOTAL_RECOVERY_ATTEMPTS_PER_EXPORT}`;
  }
  return 'recovery budget exhausted';
}

export function createExportStateManifest(params: {
  sessionId: string;
  projectId: string;
  sourceTimelineHash: string;
  fps: number;
  width: number;
  height: number;
  /**
   * WS3 Round 16 (C11) — the export-lifetime budget the NEW piece-scoped
   * manifest inherits. Omitted (a first piece) means zero.
   */
  carriedBudget?: ExportLifetimeBudget;
}): ExportStateManifest {
  const carried = params.carriedBudget ?? ZERO_LIFETIME_BUDGET;
  return {
    schemaVersion: EXPORT_STATE_SCHEMA_VERSION,
    sessionId: params.sessionId,
    projectId: params.projectId,
    sourceTimelineHash: params.sourceTimelineHash,
    fps: params.fps,
    width: params.width,
    height: params.height,
    checkpoints: [],
    rotationsSeen: 0,
    boundaryRewindsUsed: carried.boundaryRewindsUsed,
    hardwareFailoverUsed: carried.hardwareFailoverUsed,
    checkpointResumeAttempts: 0,
    totalRecoveryAttempts: carried.totalRecoveryAttempts,
  };
}

/**
 * WS3 Round 16 (C11) — the subset of `ExportRecoveryBudget` whose documented
 * scope is the EXPORT, not the piece. `MAX_BOUNDARY_REWINDS_PER_EXPORT`,
 * `MAX_HARDWARE_FAILOVER_PER_EXPORT` and `MAX_TOTAL_RECOVERY_ATTEMPTS_PER_EXPORT`
 * are all "per export, every GL piece combined" — but the manifest on disk is
 * piece-scoped (the only scope under which the native fence, which takes one
 * file, and `appendExportCheckpoint`'s strict monotonicity can both hold), so
 * a fresh piece's manifest used to start every counter at zero. Within one
 * process that was harmless (the in-process locals are export-scoped); across
 * a crash it was not: the resumed process seeds its locals from the resumed
 * PIECE's manifest, so everything an earlier, already-finished piece had spent
 * was silently restored. Carrying these three forward at every piece start
 * makes the newest manifest on disk always the export-lifetime total.
 *
 * NOT carried, by their own documented scope: `checkpointResumeAttempts`
 * ("for the current checkpoint generation") and `rotationsSeen` (the per-piece
 * checkpoint-coverage signal `never_checkpointed` reads).
 */
export interface ExportLifetimeBudget {
  boundaryRewindsUsed: number;
  hardwareFailoverUsed: boolean;
  totalRecoveryAttempts: number;
}

const ZERO_LIFETIME_BUDGET: ExportLifetimeBudget = {
  boundaryRewindsUsed: 0,
  hardwareFailoverUsed: false,
  totalRecoveryAttempts: 0,
};

/** The export-lifetime budget a manifest carries — zero for `null` (no
 *  previous piece). Pure; the writer calls it at every fresh `beginPiece`. */
export function exportLifetimeBudgetOf(previous: ExportRecoveryBudget | null): ExportLifetimeBudget {
  if (previous === null) return ZERO_LIFETIME_BUDGET;
  const budget = normalizeRecoveryBudget(previous);
  return {
    boundaryRewindsUsed: budget.boundaryRewindsUsed,
    hardwareFailoverUsed: budget.hardwareFailoverUsed,
    totalRecoveryAttempts: budget.totalRecoveryAttempts,
  };
}

/**
 * Append a checkpoint. Pure: returns a new manifest. Does not touch any
 * Annex-B bytes. Rejects a record whose `sourceTimelineHash` disagrees with
 * the manifest (a stale row can never be written onto a different timeline).
 */
export function appendExportCheckpoint(
  manifest: ExportStateManifest,
  record: ExportCheckpointRecord,
): ExportStateManifest {
  if (record.sourceTimelineHash !== manifest.sourceTimelineHash) {
    throw new Error(
      'appendExportCheckpoint: record.sourceTimelineHash does not match the manifest — refusing to mix timelines',
    );
  }
  if (record.fps !== manifest.fps || record.width !== manifest.width || record.height !== manifest.height) {
    throw new Error(
      'appendExportCheckpoint: fps/width/height disagree with the manifest',
    );
  }
  assertCheckpointRecord(record, 'appendExportCheckpoint');
  const previous = manifest.checkpoints[manifest.checkpoints.length - 1];
  if (previous && !checkpointStrictlyFollows(previous, record)) {
    throw new Error(
      'appendExportCheckpoint: checkpoint indices, byteOffset, and cumulativePictures must increase monotonically',
    );
  }
  return {
    ...manifest,
    checkpoints: [...manifest.checkpoints, record],
  };
}

export function serializeExportState(manifest: ExportStateManifest): string {
  return `${JSON.stringify(sortKeys(manifest), null, 2)}\n`;
}

/**
 * Parse and validate a surviving manifest. Every field is checked rather than
 * asserted with a cast: a crash may leave partial JSON, and a stale or malformed
 * record must start clean instead of being partially trusted.
 */
export function validateExportState(
  serialized: string | Uint8Array,
  expected: ExportCheckpointExpectedIdentity,
  annexbFileLength: number,
): ExportCheckpointValidation {
  if (!Number.isSafeInteger(annexbFileLength) || annexbFileLength < 0) {
    return { kind: 'clean', reason: 'invalid Annex-B file length' };
  }

  let value: unknown;
  try {
    const text = typeof serialized === 'string'
      ? serialized
      : new TextDecoder().decode(serialized);
    value = JSON.parse(text);
  } catch {
    return { kind: 'clean', reason: 'export_state.json is not valid JSON' };
  }

  if (!isRecord(value)) {
    return { kind: 'clean', reason: 'export_state.json root is not an object' };
  }
  if (value.schemaVersion !== EXPORT_STATE_SCHEMA_VERSION) {
    return { kind: 'clean', reason: 'checkpoint schemaVersion mismatch' };
  }
  if (!isUuid(value.sessionId)) {
    return { kind: 'clean', reason: 'checkpoint sessionId is invalid' };
  }
  if (
    typeof value.projectId !== 'string' ||
    typeof value.sourceTimelineHash !== 'string' ||
    !isSha256(value.sourceTimelineHash) ||
    !isPositiveFinite(value.fps) ||
    !isPositiveSafeInteger(value.width) ||
    !isPositiveSafeInteger(value.height) ||
    !Array.isArray(value.checkpoints)
  ) {
    return { kind: 'clean', reason: 'checkpoint manifest fields are invalid' };
  }

  const boundaryRewindsUsed = optionalNonNegativeInteger(value.boundaryRewindsUsed);
  const checkpointResumeAttempts = optionalNonNegativeInteger(value.checkpointResumeAttempts);
  const totalRecoveryAttempts = optionalNonNegativeInteger(value.totalRecoveryAttempts);
  const rotationsSeen = optionalNonNegativeInteger(value.rotationsSeen);
  if (
    boundaryRewindsUsed === null ||
    checkpointResumeAttempts === null ||
    totalRecoveryAttempts === null ||
    rotationsSeen === null ||
    (value.hardwareFailoverUsed !== undefined &&
      typeof value.hardwareFailoverUsed !== 'boolean')
  ) {
    return { kind: 'clean', reason: 'checkpoint recovery budget fields are invalid' };
  }
  const recoveryBudget: ExportRecoveryBudget = {
    boundaryRewindsUsed,
    hardwareFailoverUsed: typeof value.hardwareFailoverUsed === 'boolean'
      ? value.hardwareFailoverUsed
      : undefined,
    checkpointResumeAttempts,
    totalRecoveryAttempts,
  };
  if (isRecoveryBudgetExhausted(recoveryBudget)) {
    return {
      kind: 'recovery_budget_exhausted',
      reason: recoveryBudgetExhaustionReason(recoveryBudget),
      budget: normalizeRecoveryBudget(recoveryBudget),
    };
  }

  if (value.projectId !== expected.projectId) {
    return { kind: 'clean', reason: 'checkpoint projectId mismatch' };
  }
  if (value.sourceTimelineHash !== expected.sourceTimelineHash) {
    return { kind: 'clean', reason: 'checkpoint sourceTimelineHash mismatch' };
  }
  if (
    value.fps !== expected.fps ||
    value.width !== expected.width ||
    value.height !== expected.height
  ) {
    return { kind: 'clean', reason: 'checkpoint fps/resolution mismatch' };
  }

  const checkpoints: ExportCheckpointRecord[] = [];
  for (let i = 0; i < value.checkpoints.length; i++) {
    const candidate = value.checkpoints[i];
    if (!isCheckpointRecord(candidate)) {
      return { kind: 'clean', reason: `checkpoint record ${i} is invalid` };
    }
    if (
      candidate.sourceTimelineHash !== value.sourceTimelineHash ||
      candidate.fps !== value.fps ||
      candidate.width !== value.width ||
      candidate.height !== value.height
    ) {
      return { kind: 'clean', reason: `checkpoint record ${i} disagrees with its manifest` };
    }
    const previous = checkpoints[checkpoints.length - 1];
    if (previous && !checkpointStrictlyFollows(previous, candidate)) {
      return { kind: 'clean', reason: `checkpoint record ${i} is not monotonic` };
    }
    checkpoints.push(candidate);
  }

  // WS3 STEP 9 (C7) — checked BEFORE the generic "no checkpoint fits" case
  // just below, which an empty `checkpoints` array would also trip: this is
  // the more specific, more concerning diagnosis (the export rotated but
  // NEVER durably checkpointed), not to be folded into the silent-and-
  // ordinary "no checkpoint fits the current file length" bucket.
  if (checkpoints.length === 0 && (rotationsSeen ?? 0) > 0) {
    return {
      kind: 'never_checkpointed',
      reason: `export rotated ${rotationsSeen} encoder session(s) but never wrote a durable checkpoint — every rotation seam lacked a fence-safe offset`,
    };
  }

  const checkpoint = [...checkpoints]
    .reverse()
    .find((row) => row.byteOffset <= annexbFileLength);
  if (!checkpoint) {
    return { kind: 'clean', reason: 'no checkpoint fits the surviving Annex-B file' };
  }

  return {
    kind: 'resume',
    manifest: {
      schemaVersion: EXPORT_STATE_SCHEMA_VERSION,
      sessionId: value.sessionId,
      projectId: value.projectId,
      sourceTimelineHash: value.sourceTimelineHash,
      fps: value.fps,
      width: value.width,
      height: value.height,
      checkpoints,
      rotationsSeen: rotationsSeen ?? 0,
      ...normalizeRecoveryBudget(recoveryBudget),
    },
    checkpoint,
  };
}

/**
 * Mandatory resume gate. Validation and hash invalidation happen before any
 * mutating native call. A matching manifest then performs one atomic native
 * repair/count operation; disagreement starts clean.
 */
export async function prepareCheckpointResume(
  io: ExportCheckpointResumeIo,
  path: string,
  serializedManifest: string | Uint8Array,
  expected: ExportCheckpointExpectedIdentity,
): Promise<ExportCheckpointPreparation> {
  const fileLengthBefore = await io.sessionFileSize(path);
  const validation = validateExportState(serializedManifest, expected, fileLengthBefore);
  if (validation.kind !== 'resume') {
    return validation;
  }

  let repair: AnnexbCheckpointRepairResult;
  try {
    repair = await io.prepareCheckpointResume(path, validation.checkpoint);
  } catch (err) {
    const fileLengthAfter = await io.sessionFileSize(path);
    if (fileLengthAfter !== fileLengthBefore) {
      return {
        kind: 'bitstream_touched',
        reason: `checkpoint pre-append repair failed after mutating the bitstream: ${err instanceof Error ? err.message : String(err)}`,
        repair: {
          keptBytes: fileLengthAfter,
          bytesRemoved: fileLengthBefore > fileLengthAfter
            ? fileLengthBefore - fileLengthAfter
            : 0,
        },
      };
    }
    return {
      kind: 'clean',
      reason: `checkpoint pre-append repair failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
  if (
    repair.keptBytes !== validation.checkpoint.byteOffset ||
    repair.pictures !== validation.checkpoint.cumulativePictures
  ) {
    return {
      kind: 'bitstream_touched',
      reason:
        'checkpoint pre-append verification disagrees with byteOffset/cumulativePictures',
      repair: {
        keptBytes: repair.keptBytes,
        bytesRemoved: repair.bytesRemoved,
        pictures: repair.pictures,
        vclNals: repair.vclNals,
      },
    };
  }
  return { ...validation, repair };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isUuid(value: unknown): value is string {
  return typeof value === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function isSha256(value: string): boolean {
  return /^[0-9a-f]{64}$/.test(value);
}

function isPositiveFinite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

function isNonNegativeSafeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function optionalNonNegativeInteger(value: unknown): number | null | undefined {
  if (value === undefined) {
    return undefined;
  }
  return isNonNegativeSafeInteger(value) ? value : null;
}

function isPositiveSafeInteger(value: unknown): value is number {
  return isNonNegativeSafeInteger(value) && value > 0;
}

function isCheckpointRecord(value: unknown): value is ExportCheckpointRecord {
  if (!isRecord(value)) return false;
  return (
    isNonNegativeSafeInteger(value.pieceIndex) &&
    isNonNegativeSafeInteger(value.encoderSessionIndex) &&
    isNonNegativeSafeInteger(value.byteOffset) &&
    isNonNegativeSafeInteger(value.cumulativePictures) &&
    (value.seamByteOffset === undefined ||
      (isNonNegativeSafeInteger(value.seamByteOffset) &&
        value.seamByteOffset <= (value.byteOffset as number))) &&
    isPositiveFinite(value.fps) &&
    isPositiveSafeInteger(value.width) &&
    isPositiveSafeInteger(value.height) &&
    typeof value.sourceTimelineHash === 'string' &&
    isSha256(value.sourceTimelineHash)
  );
}

function assertCheckpointRecord(record: ExportCheckpointRecord, owner: string): void {
  if (!isCheckpointRecord(record)) {
    throw new Error(`${owner}: invalid checkpoint record`);
  }
}

function checkpointStrictlyFollows(
  previous: ExportCheckpointRecord,
  next: ExportCheckpointRecord,
): boolean {
  const indexMoves =
    next.pieceIndex > previous.pieceIndex ||
    (
      next.pieceIndex === previous.pieceIndex &&
      next.encoderSessionIndex > previous.encoderSessionIndex
    );
  return (
    indexMoves &&
    next.byteOffset > previous.byteOffset &&
    next.cumulativePictures > previous.cumulativePictures
  );
}
