/**
 * Write-only export checkpoint manifest (`export_state.json`).
 *
 * Encoder rotation already produces ~27 SPS/PPS+IDR seams on a 26-minute
 * 1080p30 export. This module persists those seams so a future resume round
 * can truncate + concatenate a remainder. THIS ROUND WRITES ONLY. Nothing
 * in the production export pipeline imports this file; writing a manifest
 * cannot change export behaviour, timing, or output bytes until a later
 * round wires a caller.
 *
 * Salvage (whether to resume vs. fail the export) is not this module's call.
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
  return {
    ...manifest,
    checkpoints: [...manifest.checkpoints, record],
  };
}

export function serializeExportState(manifest: ExportStateManifest): string {
  return `${JSON.stringify(sortKeys(manifest), null, 2)}\n`;
}
