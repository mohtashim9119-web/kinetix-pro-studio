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
import type { HeadingOverlay, Project, TextOverlay, VideoSegment } from '../../types';

export const EXPORT_STATE_SCHEMA_VERSION = 1;
export const EXPORT_STATE_FILENAME = 'export_state.json';

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
  /** Byte offset into the concatenated Annex-B file AFTER this checkpoint. */
  byteOffset: number;
  /** Pictures in `[0, byteOffset)` — access units, not raw VCL NALs. */
  cumulativePictures: number;
  fps: number;
  width: number;
  height: number;
  /** Same hash as `ExportStateManifest.sourceTimelineHash` at write time. */
  sourceTimelineHash: string;
}

export interface ExportStateManifest {
  schemaVersion: typeof EXPORT_STATE_SCHEMA_VERSION;
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
    };

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
    | 'segments'
    | 'headings'
    | 'textLayers'
  >,
  dims: { fps: number; width: number; height: number },
): ExportTimelineIdentity {
  return {
    schema: 1,
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

export function createExportStateManifest(params: {
  sessionId: string;
  projectId: string;
  sourceTimelineHash: string;
  fps: number;
  width: number;
  height: number;
}): ExportStateManifest {
  return {
    schemaVersion: EXPORT_STATE_SCHEMA_VERSION,
    sessionId: params.sessionId,
    projectId: params.projectId,
    sourceTimelineHash: params.sourceTimelineHash,
    fps: params.fps,
    width: params.width,
    height: params.height,
    checkpoints: [],
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
  const fileLength = await io.sessionFileSize(path);
  const validation = validateExportState(serializedManifest, expected, fileLength);
  if (validation.kind === 'clean') {
    return validation;
  }

  let repair: AnnexbCheckpointRepairResult;
  try {
    repair = await io.prepareCheckpointResume(path, validation.checkpoint);
  } catch (err) {
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
      kind: 'clean',
      reason:
        'checkpoint pre-append verification disagrees with byteOffset/cumulativePictures',
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
