/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useRef, useEffect, useLayoutEffect, useMemo, useCallback, ChangeEvent, lazy, Suspense, type ReactElement } from 'react';
import { 
  Play, 
  Pause, 
  Plus, 
  Upload, 
  Settings, 
  Scissors, 
  Layout, 
  Video, 
  Type, 
  Music, 
  Image as ImageIcon,
  Trash2,
  ChevronRight,
  ChevronLeft,
  MonitorPlay,
  RotateCcw,
  Check,
  Sparkles,
  Layers,
  FileText,
  FileCode,
  Archive,
  RefreshCw,
  AlertCircle,
  Link,
  Search,
  Maximize,
  Minimize,
  Info,
  X,
  CheckCircle,
  Save,
} from 'lucide-react';
import { motion, AnimatePresence, type Transition } from 'motion/react';
import {
  Project,
  VideoSegment,
  HeadingOverlay,
  Asset,
  TransitionType,
  AnimationType,
  TextOverlay,
  type SegmentGrade,
  type AspectRatio,
  type ResolutionTier,
  type SyncLogEntry,
  type SyncLogEntryType,
  type SyncRunSummary,
  type TranscriptToken,
} from './types';
import { clearFrameRendererCache } from './services/frameRenderer';
import {
  computeDragCascade,
  MIN_SEGMENT_DURATION,
  type DragCascadeOptions,
} from './services/dragCascade';
import { startDragSession } from './services/dragSession';
import { resolveShortcutAction } from './services/undoShortcut';
import { resolveAppShortcut } from './services/appShortcuts';
import { computeSlipBarGeometry } from './services/slipBarGeometry';
import {
  commitProjectSilent,
  commitProject,
  applyRestoredStateImpl,
  isBlockedByLock,
  performUndo,
  performRedo,
} from './services/historySession';
import {
  notePointerUp,
  type CoalesceClass,
  type OpenGesture,
} from './services/historyCoalesce';
import {
  canRedo,
  canUndo,
  emptyHistory,
  peekRedo,
  peekUndo,
  type History,
} from './services/history';
import {
  clearPersistedHistory,
  loadHistory,
  saveHistory,
} from './services/historyPersist';
import { findAssetByContext, autoMatchSegments, applyAnchorBasedTiming, getFileIdentity, isExactFilenameMatch, contiguousWordMatch, cleanTagName, headExtendFirstSegment, type LockFinding } from './services/syncEngine';
import { syncMark } from './services/syncInstrument';
import { detectResidualOrderingViolations, logResidualOrderingViolations } from './services/residualOrderingDetector';
import {
  computeCoverageSummary,
  countTranscriptWords,
  filterMalformedTokens,
  extractSegmentAlignments,
  alignScenestoTranscript,
  type SegmentAlignment,
} from './services/whisperService';
import { faWordSpansToTranscriptTokens, type FaEvent as FaDevEvent, type FaChunkInput as FaDevChunkInput, type FaWordSpan as FaDevWordSpan } from './services/faBoundaryTypes';
import { computeFaChunkPlan } from './services/faChunkPlan';
import type { UnscriptedRun } from './services/faChunkPlan';
import type { FaLanguageCode } from './services/faTextNormalize';
import { isFaGateOpenForProject, isFaEnabledForProject, isFaCapable, resolveFaLanguage } from './services/faGate';
import { runForcedAlignmentForSync } from './services/forcedAlignmentRun';
import { runFaPreflight } from './services/faPreflight';
import {
  detectUnspokenScriptSegmentsFromWhisper,
  applyUnspokenScriptGate,
  R10_SKIP_REASON,
} from './services/faUnspokenGate';
import { detectSeamFitDefects, applySeamFitCorrections } from './services/faSeamFitGate';
import {
  computeRunExtents,
  excludeRunEdgeViolations,
  findRunEdgeViolations,
  describeRunEdgeViolation,
} from './services/faRuleStageExclusion';
import {
  detectRunPlacementDefects,
  applyRunPlacementCorrections,
  detectUtterancePlacementDefects,
  applyUtterancePlacementCorrections,
} from './services/faRunPlacementGate';
import { detectAnchorTrustDefects, applyAnchorTrustCorrections } from './services/faAnchorTrustGate';
import { snapCoveredBoundaries } from './services/snapBoundaries';
import { computeAbsorbedGaps, applyAbsorbedGaps } from './services/absorbedGaps';
import { restoreSegmentsByGapId, countRefusedRestores, RESTORE_REFUSAL_MESSAGE } from './services/absorbedGapRestore';
import { splitSegmentAtTime, deleteSegment } from './services/segmentSplitDelete';

/** WS2 T2.1/T2.2 — fps used ONLY for the restore sub-frame merge check when
 *  re-hydrating a user's past restores during Apply Sync (a re-sync has no
 *  meaningful "current export fps" of its own to read); the interactive
 *  restore UI uses the session's real `exportFps` instead. A conservative,
 *  common default — not derived from any project setting. */
const GAP_RESTORE_REHYDRATION_FPS = 24;
import { detectSilences } from './services/silenceDetector';
import type { SilenceInterval } from './services/silenceDetector';
import {
  validateBoundaryQuality,
  validateWordCoverage,
  type BoundaryQualityMeasurement,
} from './services/syncContracts';
import {
  buildTranscriptInspectorRun,
  compareTranscriptInspectorRuns,
  tokenRowsToCsv,
  type TranscriptInspectorRun,
  type TranscriptInspectorTokenComparisonRow,
} from './services/transcriptInspector';
import {
  MIN_COVERED_RUN_LENGTH,
  NOISE_FLOOR_COVERAGE,
  BOUNDARY_QUALITY_LOUDNESS_RATIO_K,
  BOUNDARY_QUALITY_SUSTAINED_WINDOW_SEC,
  BOUNDARY_QUALITY_K_SWEEP,
  BOUNDARY_QUALITY_WINDOW_SWEEP,
} from './services/syncConstants';
import {
  makeSyncLogEntry,
  appendSyncLogEntries,
  buildSilenceErrorEntry,
  buildMalformedTokenEntry,
  buildGroupedViolationEntry,
  buildUnsupportedLanguageEntry,
  buildLockFindingLogEntries,
  buildLockRefusedLogEntry,
  mintSyncLogId,
  // WS1 Session J — rule-firing / engine / FA-fallback log builders.
  buildSyncEngineEntry,
  buildFaFallbackEntry,
  buildFaPreflightEntry,
  buildFaGateClosedEntry,
  buildUnscriptedRunLogEntries,
  buildUnspokenScriptLogEntries,
  buildSeamFitLogEntries,
  buildRunPlacementLogEntries,
  buildUtterancePlacementLogEntries,
} from './services/syncLog';
import { canLockSegment, findPartitionViolations, PARTITION_EPSILON_SEC } from './services/timelinePartition';
import { buildWaveformPipeline } from './services/waveformPipeline';
import type { WaveformSource } from './services/waveformPeaks';
import { getWaveform as getPersistedWaveform, putWaveform as putPersistedWaveform, deleteWaveform as deletePersistedWaveform, peekWaveform } from './services/waveformStore';
import { createHeading, boundaryTimeForGap, clampHeadingsToDuration, centerHeadingOnBoundary, DEFAULT_HEADING_DURATION } from './services/headingLayer';
import { stripRtfIfNeeded } from './services/textUtils';
import { assignSegmentIds, type SegmentIdSource } from './services/segmentId';
import {
  putAsset,
  deleteAsset,
  getAllAssetsForProject,
  deleteAllAssets,
  getLegacyAssets,
} from './services/assetStore';
import {
  saveProject,
  loadProject,
  loadProjectDetailed,
  adoptMirroredProjects,
  loadAllMetas,
  deleteProjectData,
  migrateLegacyIfNeeded,
  migrateLocalStorageProjectsToOsStore,
  upsertProjectMeta,
  setLastOpenedProjectId,
  getLastOpenedProjectId,
  clearLastOpenedProjectId,
} from './services/projectStore';
import { usePersistProject, buildThumbnailBase64 } from './hooks/usePersistProject';
import { useFocusTrap } from './hooks/useFocusTrap';
import { FONT_FAMILIES, FILTERS, TEXT_ANIMATIONS, getFilterStyle, getMotionProps, SUPPORTED_LANGUAGE_CODES } from './constants';
import { DropZonePanel, type StagedFiles } from './components/DropZonePanel';
import { NEUTRAL_GRADE, type ApplyEvent, type ApplyScope, type AutoGradeResult } from './components/EffectsPanel';
import { capRateForDuration } from './services/zoomScale';
import { resolvePresetScaleRate } from './services/lookPresetService';
import { aspectRatioToCss, resolveDimensions, DEFAULT_ASPECT_RATIO, DEFAULT_RESOLUTION_TIER } from './services/resolutionConfig';
import { ReviewMappingModal } from './components/ReviewMappingModal';
import { TextLayersPanel } from './components/TextLayersPanel';
import { BottomDrawer } from './components/BottomDrawer';
import { SyncLoadingOverlay } from './components/SyncLoadingOverlay';
const StockSearchModal = lazy(() =>
  import('./components/StockSearchModal').then(m => ({ default: m.StockSearchModal }))
);
// Dev-only — lazy so its GL/canvas test code and icon imports never enter the
// production bundle graph; only ever rendered when import.meta.env.DEV is true.
const DevTestPanel = lazy(() =>
  import('./components/DevTestPanel').then(m => ({ default: m.DevTestPanel }))
);
import { Timeline } from './components/Timeline';
import { PreviewStage, type AutoGradeSampler, type PreviewStageHandle } from './components/PreviewStage';
import { SpeedBadge, SPEED_LADDER } from './components/SpeedBadge';
import { ProjectDashboard } from './components/ProjectDashboard';
import { NewProjectModal } from './components/NewProjectModal';
import { ProjectSettingsModal } from './components/ProjectSettingsModal';
import { SyncLogPanel } from './components/SyncLogPanel';
import { ExportSettingsModal } from './components/ExportSettingsModal';
import { ManageModelsModal } from './components/ManageModelsModal';
import { ErrorBoundary, PanelFallback } from './components/ErrorBoundary';
import { useExport, formatElapsed, formatElapsedLong, type ExportResolution, type ExportFps, type ExportError } from './hooks/useExport';
import { useWhisper } from './hooks/useWhisper';
import { usePlayback } from './hooks/usePlayback';
import { TranscriptionBar } from './components/TranscriptionBar';
import { isTauri, probeAudioDuration, probeVideoFps } from './services/tauriFfmpeg';
import { readUiState, patchUiState } from './services/uiStateStore';
import { compactRanges } from './services/rangeCompact';
import { formatTime } from './services/timeFormat';
import { invoke, Channel } from '@tauri-apps/api/core';

interface RawSegment {
  text: string;
  assetId?: string;
  tag?: string;
  unmatchedExplicitTag?: boolean;
  transition: TransitionType;
  animation: AnimationType;
  trimStart: number;
  extraOverlays: TextOverlay[];
}

const getMediaDuration = (url: string, type: 'video' | 'audio'): Promise<number> => {
  return new Promise((resolve) => {
    const media = type === 'video' ? document.createElement('video') : document.createElement('audio');
    media.src = url;
    media.onloadedmetadata = () => resolve(media.duration);
    media.onerror = () => resolve(0);
  });
};

/**
 * Resolves a voiceover asset's duration (seconds) via the native ffmpeg probe.
 *
 * Replaces the old hidden-`<audio>` probe, which was WebView-codec-dependent
 * (OGG silently failed on macOS WKWebView) and fell back to a hardcoded 60 s —
 * mis-proportioning every segment. Prefers the raw `File`; falls back to
 * fetching the blob URL (a committed asset reconstructed on reload may have lost
 * its File reference). THROWS on failure — callers surface the error and abort
 * rather than syncing against a fake duration.
 */
const resolveVoiceoverDuration = async (asset: Asset): Promise<number> => {
  const blob: Blob = asset.file ?? (await (await fetch(asset.url)).blob());
  return probeAudioDuration(blob);
};

/**
 * Probes a video file's native frame rate at stage/import time, for the
 * exportFps auto-match described in the judder audit. Unlike
 * resolveVoiceoverDuration, a failure here is non-fatal — fps auto-match is a
 * convenience, not something the sync flow depends on to be correct — so this
 * swallows errors and returns undefined rather than aborting the caller.
 */
const resolveVideoNativeFps = async (blob: Blob): Promise<number | undefined> => {
  try {
    return await probeVideoFps(blob);
  } catch (err) {
    console.warn('[resolveVideoNativeFps] fps probe failed, leaving nativeFps unset:', err);
    return undefined;
  }
};

const EXPORT_FPS_OPTIONS: ExportFps[] = [24, 30, 60];

/**
 * Rounds an arbitrary native fps (e.g. 23.976, 29.97, 59.94) to the closest
 * supported export fps bucket. Used only to drive the exportFps auto-match
 * suggestion below — never for per-segment retiming.
 */
const nearestExportFps = (fps: number): ExportFps =>
  EXPORT_FPS_OPTIONS.reduce((closest, candidate) =>
    Math.abs(candidate - fps) < Math.abs(closest - fps) ? candidate : closest
  );

// ---------------------------------------------------------------------------
// Module-level helpers for the atomic Apply Sync flow
// ---------------------------------------------------------------------------

/**
 * Persists a single media file to IndexedDB and returns a fully-formed Asset,
 * or null if the write fails. Does NOT call setProject.
 */
async function persistFileToAsset(
  projectId: string,
  file: File,
  type: Asset['type'],
): Promise<Asset | null> {
  const id = crypto.randomUUID();
  const url = URL.createObjectURL(file);
  try {
    await putAsset(projectId, id, file, { name: file.name, mimeType: file.type });
  } catch (err) {
    console.error('[persistFileToAsset] IndexedDB write failed, skipping:', file.name, err);
    URL.revokeObjectURL(url);
    return null;
  }
  const nativeFps = type === 'video' ? await resolveVideoNativeFps(file) : undefined;
  const duration = type === 'video' ? await getMediaDuration(url, 'video') : undefined;
  return { id, name: file.name, url, type, file, addedAt: Date.now(), nativeFps, duration };
}

/**
 * Commits an ephemeral, staging-time voiceover asset (minted by
 * handleVoiceoverStaged, see Option C) to IndexedDB, reusing its pre-minted
 * id and blob URL so cached Whisper tokens (keyed by that id) stay valid.
 * Does NOT call setProject.
 */
async function persistPendingVoiceoverAsset(projectId: string, pending: Asset): Promise<Asset | null> {
  try {
    await putAsset(projectId, pending.id, pending.file!, { name: pending.name, mimeType: pending.file!.type });
  } catch (err) {
    console.error('[persistPendingVoiceoverAsset] IndexedDB write failed, skipping:', pending.name, err);
    return null;
  }
  return pending;
}

/**
 * Extracts all media files from a zip archive, persists them to IndexedDB,
 * and returns the resulting Asset array. Does NOT call setProject.
 */
async function extractZipToAssets(projectId: string, zipFile: File): Promise<Asset[]> {
  const newAssets: Asset[] = [];
  try {
    let JSZipModule: typeof import('jszip');
    try {
      ({ default: JSZipModule } = await import('jszip'));
    } catch (loadErr) {
      console.error('[extractZipToAssets] Failed to load jszip:', loadErr);
      return [];
    }
    const zip = new JSZipModule();
    const content = await zip.loadAsync(zipFile);
    const filePromises = Object.keys(content.files).map(async (filename) => {
      const fileData = content.files[filename];
      if (!fileData || fileData.dir) return;
      const blob = await fileData.async('blob');
      let type: Asset['type'] = 'image';
      if (filename.match(/\.(mp3|wav|ogg|m4a)$/i)) type = 'audio';
      else if (filename.match(/\.(mp4|webm|mov|m4v)$/i)) type = 'video';
      const id = crypto.randomUUID();
      const name = filename.split('/').pop() || filename;
      try {
        await putAsset(projectId, id, blob, { name, mimeType: blob.type || 'application/octet-stream' });
      } catch (err) {
        console.error('[extractZipToAssets] Skipping file:', name, err);
        return;
      }
      const nativeFps = type === 'video' ? await resolveVideoNativeFps(blob) : undefined;
      const url = URL.createObjectURL(blob);
      const duration = type === 'video' ? await getMediaDuration(url, 'video') : undefined;
      newAssets.push({ id, name, url, type, file: new File([blob], filename), nativeFps, duration });
    });
    await Promise.all(filePromises);
  } catch (err) {
    console.error('[extractZipToAssets] Error:', err);
  }
  return newAssets;
}

const TOAST_DURATION = 5000; // ms — auto-dismiss for lock-block toast
const EXPORT_SUCCESS_TOAST_DURATION_MS = 15000; // ms — auto-dismiss for the export-complete toast
const MIN_TIMELINE_HEIGHT = 220; // px — absolute floor: ruler + 80px segments + 80px audio rows

// Enhanced parser that handles heading-voiceover logic
export const parseProjectData = async (
  script: string,
  sceneDetails: string,
  assets: Asset[],
  voiceoverDuration: number = 0,
  previousSegments?: readonly SegmentIdSource[],
): Promise<VideoSegment[]> => {
  // Split on the start of each bracketed tag so blank lines between a tag and its
  // description text stay within the same block (not treated as a scene boundary).
  const TAG_REGEX = /(?=\[[^\]]*\])/;
  const rawDetails = sceneDetails.split(TAG_REGEX).filter(block => block.trim() !== '');
  const scriptLines = script.split(/\r?\n/).map(l => l.trim()).filter(l => l !== '');

  const scenes: { tag: string; description: string }[] = [];

  rawDetails.forEach(block => {
    const trimmedBlock = block.trim();
    // Anchor the tag at the start of the block (TAG_REGEX guarantees every
    // block begins with a `[` in the normal case) rather than assuming it
    // occupies its own line — a tag's description may follow it inline on
    // the SAME line (e.g. "[missing1] This is a test missing segment.") just
    // as validly as on subsequent lines. Splitting on `lines[0]` alone
    // swallowed the whole "tag + inline text" line as the tag and left the
    // description empty, silently falling back to script-slicing.
    const tagMatch = trimmedBlock.match(/^\[[^\]]*\]/);
    if (tagMatch) {
      const tag = tagMatch[0];
      const description = trimmedBlock
        .slice(tag.length)
        .split(/\r?\n/)
        .map(l => l.trim())
        .filter(l => l !== '')
        .join(' ');
      scenes.push({ tag, description });
    } else {
      // No bracket anchored at the block's start (e.g. stray text before the
      // first real tag) — preserve the original first-line-is-the-tag
      // fallback rather than silently dropping the block.
      const lines = block.split(/\r?\n/).map(l => l.trim()).filter(l => l !== '');
      const tag = lines[0];
      if (tag !== undefined) {
        scenes.push({ tag, description: lines.slice(1).join(' ') });
      }
    }
  });

  if (scenes.length === 0) {
    const backupBlocks = sceneDetails.split(TAG_REGEX).map(l => l.trim()).filter(l => l !== '');
    backupBlocks.forEach(block => {
      const lines = block.split(/\r?\n/).map(l => l.trim()).filter(l => l !== '');
      const tag = lines[0];
      if (tag !== undefined) {
        scenes.push({
          tag: tag.startsWith('[') && tag.endsWith(']') ? tag : `[${tag}]`,
          description: lines.slice(1).join(' '),
        });
      }
    });
  }

  const rawSegments: RawSegment[] = [];
  const sceneCount = scenes.length;
  const usedAssetIdsTotal = new Set<string>();

  for (const [idx, scene] of scenes.entries()) {
    let text = scene.description.trim();

    if (!text) {
      if (scriptLines.length === sceneCount) {
        text = scriptLines[idx] ?? '';
      } else if (scriptLines.length > 0) {
        const startIdx = Math.floor((idx / sceneCount) * scriptLines.length);
        const endIdx = Math.floor(((idx + 1) / sceneCount) * scriptLines.length);
        text = scriptLines.slice(startIdx, endIdx).join(' ');
      }
    }

    const current: RawSegment = {
      text,
      transition: TransitionType.NONE,
      animation: AnimationType.NONE,
      trimStart: 0,
      extraOverlays: [],
    };

    const detail = scene.tag;

    const bracketMatch = detail.match(/^\[(.*?)\]/);
    // Clean stray edge punctuation (leading colon/quote/whitespace) and fold
    // the legacy IMAGE:/VIDEO: prefix, so a typo'd tag like "[:  foo]" still
    // resolves to "foo" instead of failing exact match and getting wrong-guessed.
    const name = cleanTagName(bracketMatch?.[1] ?? '');

    // Every scene tag is a bracket by construction (TAG_REGEX only splits on
    // bracket occurrences), so this is "was a non-empty name actually written
    // inside the brackets" — false only for a literal empty `[]` tag.
    const hasExplicitTagName = name.length > 0;

    // WS-logs skip display — remember the cleaned tag name regardless of
    // whether it went on to resolve to an asset, so a skip entry can show
    // "[missing1] ..." even when the tag never matched anything.
    current.tag = name || undefined;

    if (name) {
      // First match wins (upload/array order). Because the match is now
      // extension-agnostic, two assets sharing a stem (e.g. 002_age_24.jpg
      // AND 002_age_24.mp4) can both match the same tag — warn but don't
      // block; the first-in-order asset is used. Mirrors the duplicate-
      // assignment warning below (diagnostic only, no UI surfacing).
      const matches = assets.filter(a => isExactFilenameMatch(name, a.name));
      if (matches.length > 1) {
        console.warn(
          `[parseProjectData] Tag "${name}" matches ${matches.length} assets ` +
          `(extension ignored): ${matches.map(a => a.name).join(', ')}. ` +
          `Using "${matches[0]!.name}" (first uploaded).`
        );
      }
      const asset = matches[0];
      if (asset) {
        current.assetId = asset.id;
        usedAssetIdsTotal.add(asset.id);
      }
    }

    // Fallback tier (explicit tags only): if exact match found nothing, try a
    // contiguous-word-sequence match — the tag's tokens appearing as an
    // adjacent in-order block inside an asset filename (e.g. [year_2003] →
    // year_2003_2342368767.jpg). Require a UNIQUE match: 2+ candidates is
    // ambiguous and must NOT be silently resolved — it falls through to the
    // unmatchedExplicitTag flag below (same "never guess wrong" rule as the
    // exact tier, commit 9b15a59), warning like the exact-collision case above.
    if (name && !current.assetId) {
      const wordMatches = assets.filter(a => contiguousWordMatch(name, a.name));
      if (wordMatches.length === 1) {
        const asset = wordMatches[0]!;
        current.assetId = asset.id;
        usedAssetIdsTotal.add(asset.id);
      } else if (wordMatches.length > 1) {
        console.warn(
          `[parseProjectData] Tag "${name}" ambiguously word-matches ${wordMatches.length} assets: ` +
          `${wordMatches.map(a => a.name).join(', ')}. Leaving unmatched — tighten the tag to disambiguate.`
        );
      }
    }

    if (!current.assetId && !hasExplicitTagName && text) {
      // No fallback to the full `assets` array once the unused pool is
      // exhausted — that used to silently re-assign an asset another
      // segment already claimed this same pass. An exhausted pool leaves
      // the segment unmatched instead (surfaced via the grouped sync-log
      // entry surfaced by buildNoAssetSummaryEntry, computed later from the
      // run's final committed segments).
      const availableAssets = assets.filter(a => !usedAssetIdsTotal.has(a.id) && a.type !== 'audio');
      const contextualAsset = availableAssets.length > 0 ? findAssetByContext(text, availableAssets) : undefined;
      if (contextualAsset) {
        current.assetId = contextualAsset.id;
        usedAssetIdsTotal.add(contextualAsset.id);
      }
    }

    // An explicit tag that failed to resolve to an asset stays visibly
    // unmatched — mark it so the downstream autoMatchSegments pass(es) never
    // fuzzy-guess it from spoken text. Untagged (empty `[]`) scenes are NOT
    // marked, so they remain eligible for the legitimate fuzzy fallback.
    if (hasExplicitTagName && !current.assetId) {
      current.unmatchedExplicitTag = true;
    }

    rawSegments.push(current);
  }

  const textBearingScenes = rawSegments.filter(s => s.text);
  const voDuration = voiceoverDuration > 0 ? voiceoverDuration : rawSegments.length * 5;

  const textBudget = Math.max(0.1, voDuration);
  const totalTextLength = textBearingScenes.reduce((acc, s) => acc + s.text.length, 0) || 1;

  let currentTimeAccumulator = 0;
  const finalSegments: VideoSegment[] = [];

  for (const [i, s] of rawSegments.entries()) {
    let targetDuration: number;

    if (textBearingScenes.length > 0) {
      const weight = s.text.length / totalTextLength;
      targetDuration = weight * textBudget;
    } else {
      targetDuration = voDuration / Math.max(1, rawSegments.length);
    }

    // A video clip always plays at its native rate (owner ruling, WS3 Batch
    // B) — no speed-fit-to-slot computation here. If the clip runs short or
    // long of targetDuration, that's resolved at preview/export time (freeze
    // the last frame, or play a trimStart-positioned window — see
    // buildFreezeFrameEntries and toSourceTime's clamp), not by re-timing the
    // source. The clip's length itself is NOT captured onto the segment: it
    // lives on `Asset.duration` and is resolved through `assetId` at every
    // read, so pointing this segment at a different asset later can't leave a
    // stale length behind (see Asset.duration's doc).
    const segment: VideoSegment = {
      ...s,
      // Overwritten below by assignSegmentIds (WS2 T1.2) — a placeholder here
      // only satisfies VideoSegment's required `id: string` field mid-loop.
      id: '',
      startTime: Number(currentTimeAccumulator.toFixed(3)),
      duration: Number(targetDuration.toFixed(3)),
      anchorStart: Number(currentTimeAccumulator.toFixed(3)), // character-weight bootstrap anchor
      anchorSource: 'estimate' as const,
      trimStart: 0,
      order: i,
      transition: TransitionType.NONE,
      animation: AnimationType.NONE,
      showOverlay: false,
      extraOverlays: [],
    };

    if (i === rawSegments.length - 1 && voiceoverDuration > 0) {
      segment.duration = Math.max(0.1, Number((voiceoverDuration - segment.startTime).toFixed(3)));
    }

    finalSegments.push(segment);
    currentTimeAccumulator += segment.duration;
  }

  // WS2 T1.2 — stable content-derived ids, assigned once per whole array so
  // duplicate-text disambiguation sees full document order. Joins against
  // previousSegments (the project's segments before this Apply Sync run) so
  // an unedited segment's id survives the resync; a segment with no content
  // match (new or edited text) gets a fresh content-derived id.
  const idAssigned = assignSegmentIds(finalSegments, previousSegments);
  idAssigned.forEach((seg, i) => { finalSegments[i] = seg; });

  // Detect segments sharing the same assetId — can happen when the
  // unused-asset pool is exhausted after a deletion and re-sync.
  // This is a data quality warning, not a hard error.
  const assetIdCounts = new Map<string, number>();
  finalSegments.forEach(seg => {
    if (seg.assetId) {
      assetIdCounts.set(seg.assetId, (assetIdCounts.get(seg.assetId) ?? 0) + 1);
    }
  });
  assetIdCounts.forEach((count, assetId) => {
    if (count > 1) {
      const duplicatedSegments = finalSegments
        .filter(s => s.assetId === assetId)
        .map(s => s.text || s.id)
        .join(', ');
      console.warn(
        `[parseProjectData] Asset "${assetId}" is assigned to ${count} segments: ` +
        `${duplicatedSegments}. Re-upload the missing asset and re-sync to fix.`
      );
    }
  });

  return finalSegments;
};


function makeDefaultProject(): Project {
  return {
  id: crypto.randomUUID(),
  name: 'Untitled Project',
  script: 'Welcome to Kinetix Studio. This tool automatically syncs your voiceover with your visuals. Text segments stretch to fit your audio duration perfectly.',
  sceneDetails: '[IMAGE: intro.jpg]\n[IMAGE: tech.jpg]',
  segments: [],
  headings: [],
  assets: [],
  globalTransition: TransitionType.NONE,
  globalTransitionDuration: 0.5,
  globalAnimation: AnimationType.NONE,
  textLayers: [],
  globalOverlayConfig: {
    color: '#FFFFFF',
    backgroundColor: '#000000',
    fontFamily: 'Inter',
  },
  // Not confirmed yet — auto-save is gated until the user names this project.
  confirmed: false,
  };
}

function ModalLoadingFallback(): ReactElement {
  return (
    <div className="fixed inset-0 z-[150] flex items-center justify-center bg-black/80 backdrop-blur-sm">
      <div className="w-8 h-8 rounded-full border-2 border-t-[#F27D26] border-r-transparent border-b-transparent border-l-transparent animate-spin" />
    </div>
  );
}

function getExportErrorSummary(error: ExportError): string {
  switch (error.kind) {
    case 'cancelled':
      return 'Export cancelled.';
    case 'asset_missing':
      return `An asset used by segment ${(error.segmentIndex ?? 0) + 1} could not be found. It may have been deleted.`;
    case 'ffmpeg_load':
      return 'Failed to load the ffmpeg engine. Check your network connection and try again.';
    case 'encode':
      return `Failed to encode segment ${(error.segmentIndex ?? 0) + 1}.`;
    case 'concat':
      return 'Failed to concatenate segments into a single video.';
    case 'mux':
      return 'Failed to mux the audio track into the final video.';
    case 'timeline_gap':
      // The guard's own message already names the size and the segment, and is
      // written for a user rather than a developer — pass it through instead of
      // replacing it with something vaguer.
      return error.message;
    case 'unknown':
      return 'An unexpected error occurred during export.';
  }
}

/**
 * Carries the five slug-valued effect fields forward across an Apply Sync
 * clean-slate rebuild. parseProjectData mints fresh segments with fresh ids, so
 * the only stable identity between the previous and the freshly-parsed arrays is
 * `assetId` (id is regenerated; index breaks on add/remove/reorder).
 *
 * Match is restricted to assetIds that are UNIQUE on BOTH sides — an assetId
 * appearing >1× on either side is ambiguous (e.g. the duplicate-assetId case that
 * arises when the unused-asset pool is exhausted after a deletion), so we fail
 * safe and leave those segments at parse defaults rather than risk assigning a
 * segment's effects to the wrong scene. Segments without an assetId (headings,
 * unmatched scenes) also get no carry-forward. Pure.
 */
function preserveEffectFields(
  committed: VideoSegment[],
  previousSegments: VideoSegment[],
): VideoSegment[] {
  // Old segments keyed by assetId, excluding undefined / non-unique assetIds.
  const oldByAsset = new Map<string, VideoSegment>();
  const seenOld = new Set<string>();
  for (const seg of previousSegments) {
    if (!seg.assetId) continue;
    if (seenOld.has(seg.assetId)) {
      oldByAsset.delete(seg.assetId); // now non-unique — drop it
      continue;
    }
    seenOld.add(seg.assetId);
    oldByAsset.set(seg.assetId, seg);
  }

  // assetIds appearing >1× in the freshly-committed array — ambiguous targets.
  const newCounts = new Map<string, number>();
  committed.forEach(seg => {
    if (seg.assetId) newCounts.set(seg.assetId, (newCounts.get(seg.assetId) ?? 0) + 1);
  });

  return committed.map(seg => {
    if (!seg.assetId || (newCounts.get(seg.assetId) ?? 0) > 1) return seg;
    const prev = oldByAsset.get(seg.assetId);
    if (!prev) return seg;
    return {
      ...seg,
      effectTransition: prev.effectTransition,
      effectTransitionDuration: prev.effectTransitionDuration,
      effectAnimation: prev.effectAnimation,
      effectAnimationDuration: prev.effectAnimationDuration,
      effectAnimationScaleRate: prev.effectAnimationScaleRate,
      effectOverlay: prev.effectOverlay,
      effectGrade: prev.effectGrade,
    };
  });
}

/**
 * K13 fix — one record per previously-locked segment `preserveSegmentLocks`
 * could not carry forward, for the sync log. `no-asset-id`/`duplicate-asset-id`
 * never resolved to a segment in the new array at all (the match itself
 * failed), so there is no new-array index to report — `oldText` (a preview of
 * the OLD segment's own text) is the only stable identity left. `out-of-bounds`/
 * `partition-conflict` DID match a real new segment before validation dropped
 * them, so they carry `segmentIndex` into the new array, matching every other
 * segment-indexed sync-log entry's convention.
 */
export interface DroppedLockRecord {
  reason: 'no-asset-id' | 'duplicate-asset-id' | 'out-of-bounds' | 'partition-conflict';
  oldText: string;
  segmentIndex?: number;
}

/**
 * K13 fix — restores `locked`/`startTime`/`duration` onto `committed` for
 * every segment that maps, by unique assetId, to a segment that was locked in
 * `previousSegments`. Matching mirrors `preserveEffectFields`'s fail-safe
 * shape exactly (unique-assetId-on-both-sides or no carry) — see that
 * function's own doc comment for why. Does NOT carry `anchorStart` forward:
 * a locked segment's anchor is re-derived to match its `startTime` the next
 * time `applyAnchorBasedTiming` runs on it (syncEngine.ts:300), whether
 * that's a later lock toggle or the next Apply Sync.
 *
 * Deliberately runs on `committed` — AFTER autoMatchSegments has assigned
 * every real assetId and the full timing pipeline has already produced a
 * known-valid (gapless) array — rather than feeding the restored lock into
 * applyAnchorBasedTiming's own hard-wall pass earlier in the pipeline. That
 * earlier point doesn't have every segment's assetId yet (autoMatchSegments
 * hasn't run), and — more importantly — a lock that fails validation would
 * need the entire async, Whisper-driven timing pipeline re-run to cleanly
 * revert it. Restoring post-hoc instead makes a dropped lock free to revert:
 * the naturally-synced value the pipeline already computed for that segment
 * is simply left in place, untouched.
 *
 * Validates every restored lock in two passes, per the owner's ordering:
 * (a) a bound check — does the OLD [startTime, startTime+duration] span still
 * fit inside [0, audioDuration]? This runs first and is independent per
 * segment (it can never be affected by another lock), so it never needs to
 * iterate. (b) `findPartitionViolations` on the tentatively-restored array —
 * iterated, dropping exactly one offending candidate per pass (the later
 * segment of a violating pair, matching findPartitionViolations' own
 * "measured at the later of the two" convention; the earlier one only when
 * it alone is a restore candidate) and re-validating from scratch, until
 * stable. Capped at the starting candidate count: each iteration that finds
 * a violation removes exactly one candidate, so the loop can never run more
 * than `candidates.size` times before either stabilizing or running out of
 * candidates to drop.
 *
 * Pure and immutable — never mutates `committed` or `previousSegments`.
 */
export function preserveSegmentLocks(
  committed: VideoSegment[],
  previousSegments: VideoSegment[],
  audioDuration: number,
): { segments: VideoSegment[]; dropped: DroppedLockRecord[] } {
  const lockedOld = previousSegments.filter(s => s.locked);
  if (lockedOld.length === 0) return { segments: committed, dropped: [] };

  // Old segments keyed by assetId, excluding undefined / non-unique assetIds
  // — the exact fail-safe shape preserveEffectFields already uses.
  const oldByAsset = new Map<string, VideoSegment>();
  const seenOld = new Set<string>();
  for (const seg of previousSegments) {
    if (!seg.assetId) continue;
    if (seenOld.has(seg.assetId)) {
      oldByAsset.delete(seg.assetId); // now non-unique — drop it
      continue;
    }
    seenOld.add(seg.assetId);
    oldByAsset.set(seg.assetId, seg);
  }

  // assetIds appearing >1x in the freshly-committed array — ambiguous targets.
  const newCounts = new Map<string, number>();
  committed.forEach(seg => {
    if (seg.assetId) newCounts.set(seg.assetId, (newCounts.get(seg.assetId) ?? 0) + 1);
  });

  const dropped: DroppedLockRecord[] = [];
  // Candidate restores, keyed by the NEW segment's id — stable across the
  // validation loop below, unlike an array index (which shifts as nothing —
  // segments never reorder here — but which a re-derived array must not be
  // trusted to preserve identity through regardless).
  const candidates = new Map<string, { startTime: number; duration: number; oldText: string }>();

  for (const oldSeg of lockedOld) {
    if (!oldSeg.assetId) {
      dropped.push({ reason: 'no-asset-id', oldText: oldSeg.text });
      continue;
    }
    if (!oldByAsset.has(oldSeg.assetId)) {
      // Non-unique in the OLD array — ambiguous target, never guess.
      dropped.push({ reason: 'duplicate-asset-id', oldText: oldSeg.text });
      continue;
    }
    const newCount = newCounts.get(oldSeg.assetId) ?? 0;
    if (newCount === 0) {
      // The scene this lock belonged to is gone from the new array entirely
      // — the user deleted it. Silent per the owner's ruling; no log entry.
      continue;
    }
    if (newCount > 1) {
      dropped.push({ reason: 'duplicate-asset-id', oldText: oldSeg.text });
      continue;
    }

    // Bound check (owner refinement) — the OLD span must still fit inside
    // the NEW audio's duration. Runs before this segment is ever treated as
    // a restore candidate, since it depends only on the old span and the
    // fixed [0, audioDuration] range, never on any other lock.
    const newSeg = committed.find(s => s.assetId === oldSeg.assetId)!;
    const end = oldSeg.startTime + oldSeg.duration;
    if (oldSeg.startTime < -PARTITION_EPSILON_SEC || end > audioDuration + PARTITION_EPSILON_SEC) {
      dropped.push({ reason: 'out-of-bounds', oldText: oldSeg.text, segmentIndex: committed.indexOf(newSeg) });
      continue;
    }

    candidates.set(newSeg.id, { startTime: oldSeg.startTime, duration: oldSeg.duration, oldText: oldSeg.text });
  }

  if (candidates.size === 0) return { segments: committed, dropped };

  const applyCandidates = (): VideoSegment[] =>
    committed.map(seg => {
      const c = candidates.get(seg.id);
      return c ? { ...seg, locked: true, startTime: c.startTime, duration: c.duration } : seg;
    });

  const maxIterations = candidates.size;
  for (let iteration = 0; iteration < maxIterations; iteration++) {
    const attempt = applyCandidates();
    const violations = findPartitionViolations(attempt, audioDuration);
    if (violations.length === 0) return { segments: attempt, dropped };

    const v = violations[0]!;
    const laterSeg = attempt[v.index];
    const earlierSeg = v.index > 0 ? attempt[v.index - 1] : undefined;
    const toRevert = laterSeg && candidates.has(laterSeg.id)
      ? laterSeg
      : (earlierSeg && candidates.has(earlierSeg.id) ? earlierSeg : undefined);

    if (!toRevert) {
      // Defensive backstop only — unreachable in practice, since `committed`
      // is already a known-valid partition before this function ever touches
      // it (every writer upstream maintains that invariant), so any
      // violation here must trace back to one of this function's own
      // candidates. Never risk committing an unresolved violation: abandon
      // every restore for this run rather than guess which one is at fault.
      return { segments: committed, dropped };
    }
    const revertedCandidate = candidates.get(toRevert.id)!;
    candidates.delete(toRevert.id);
    dropped.push({
      reason: 'partition-conflict',
      oldText: revertedCandidate.oldText,
      segmentIndex: committed.findIndex(s => s.id === toRevert.id),
    });
    if (candidates.size === 0) return { segments: committed, dropped };
  }
  // Cap exhausted without stabilizing — same fail-safe as above. Unreachable
  // given the loop bound (each pass removes exactly one candidate, and there
  // are only `maxIterations` of them), but TypeScript can't prove that, and
  // this is the correct answer if it were ever somehow reached anyway.
  return { segments: committed, dropped };
}

// ---------------------------------------------------------------------------
// WS1b — empty-input hard aborts (doc §3.4/§3.11, S15) + the coverage-gate
// abort policy (doc §3.4, R12/R13). Pure predicates/functions, module-level so
// they're directly unit-testable (imported by name from ../App in
// syncTiming.test.ts, the same precedent as parseProjectData in
// sceneTagParsing.test.ts). handleApplySyncFromFiles (the orchestrator) calls
// these and acts on the result — showing a toast and aborting the commit —
// but never contains the policy logic itself.
// ---------------------------------------------------------------------------

export const EMPTY_SCENE_DOC_MESSAGE = 'Your scene doc has no scenes to sync. Add scene tags and try again.';
export const EMPTY_TRANSCRIPT_MESSAGE = 'No speech was found in the audio. No timeline will be created.';
export const FULL_MISMATCH_MESSAGE = "This voiceover doesn't match your scene doc. No timeline will be created.";

/** doc §3.11(b) — empty scene doc: a hard abort regardless of whether a
 *  previous sync's segments still exist (also covers the fresh-project case,
 *  which used to fall through silently). */
export function emptySceneDocAbortMessage(parsedSegmentCount: number): string | null {
  return parsedSegmentCount === 0 ? EMPTY_SCENE_DOC_MESSAGE : null;
}

/** doc §3.11(b) — empty transcript: only an error when a voiceover was
 *  actually staged for this sync (a no-voiceover, character-timed project is
 *  not an error case). */
export function emptyTranscriptAbortMessage(hasVoiceover: boolean, transcriptTokenCount: number): string | null {
  return hasVoiceover && transcriptTokenCount === 0 ? EMPTY_TRANSCRIPT_MESSAGE : null;
}

export type SyncGateResult = { aborted: false } | { aborted: true; message: string };

/**
 * R13 two-signal abort gate — applied by the orchestrator immediately after
 * alignFromCache, before any commit (doc §3.4(b)). `coverage` must be
 * index-parallel to the aligned segments (true of every alignFromCache result).
 *
 * Round 4 (R4-1) DELETED the former first step, R12's middle-gap check: an
 * internal run of uncovered segments — of ANY length — no longer aborts. Those
 * segments are skipped at commit time instead (filterToCoveredSegments below),
 * so the only abort left here is full mismatch (R4-3): the inputs don't
 * correspond at all. With it went the two gap messages ("Audio does not exist
 * for segments X to Y…" and its R9 locked-segment variant) and the
 * MAX_INTERPOLABLE_GAP constant. Do not reintroduce a gap check here — a gap is
 * information for the skip log (R4-4), not an error.
 */
export function evaluateCoverageGate(
  _segments: VideoSegment[],
  coverage: SegmentAlignment[],
  totalTranscriptWords: number,
): SyncGateResult {
  // R13 Signal 1 — contiguous covered-run check (primary): near-zero coverage
  // (the B1 mismatch case).
  const summary = computeCoverageSummary(coverage, totalTranscriptWords);
  if (summary.longestCoveredRun < MIN_COVERED_RUN_LENGTH) {
    return { aborted: true, message: FULL_MISMATCH_MESSAGE };
  }

  // R13 Signal 2 — bidirectional noise floor (anti-noise): a technically-
  // contiguous run built on coincidental word overlap.
  if (summary.bidirectionalCoverage < NOISE_FLOOR_COVERAGE) {
    return { aborted: true, message: FULL_MISMATCH_MESSAGE };
  }

  return { aborted: false };
}

/** Why a segment was left off the timeline (doc §3.5(c), R4-4).
 *  `matched === false` is the sole gate — a segment with zero true matches,
 *  OR (Bug C, consecutive-run survival requirement, 2026-08-02) real matched
 *  words that never form a qualifying contiguous run, is skipped. 'low
 *  confidence' has never been a skip reason since the Bug 2 fix and still is
 *  not one.
 *
 *  WS1 Session E adds the second member, and it does NOT weaken that gate:
 *  R.10 (`faUnspokenGate.ts`) forces `matched: false` on its own findings
 *  BEFORE `filterToCoveredSegments` runs, so the keep test is unchanged. The
 *  reason string only records WHICH of the two things went wrong. R.10's
 *  firing set is a subset of the segments Whisper alone already refuses, so
 *  this member can only ever re-label a skip that would have happened anyway
 *  on the FA-gate-off default path. */
export type SegmentSkipReason = 'no audio match' | typeof R10_SKIP_REASON;

/**
 * One skipped segment, recorded for the sync log. `segmentIndex` is 0-based
 * into the PRE-filter (parsed/aligned) segments array, so the record still
 * points at the scene the user wrote even though it isn't on the timeline.
 * In-memory only here — persisting these and surfacing them in the UI is the
 * separate WS-logs workstream (R4-4).
 */
export interface SkippedSegmentRecord {
  segmentIndex: number;
  segmentText: string;
  reason: SegmentSkipReason;
  /** The segment's cleaned scene-doc tag name (no brackets), if it had one —
   *  see VideoSegment.tag. Omitted for an untagged scene. */
  segmentTag?: string;
  /** Coverage-array numbers for this segment at sync time (WS-logs display). */
  matchedWords?: number;
  totalWords?: number;
  confidence?: number;
  /** Bug C (consecutive-run survival requirement, 2026-08-02): the longest
   *  qualifying-shape run found for this segment at sync time — see
   *  whisperService.ts's AlignResult.longestRun. Undefined on records built
   *  before this field existed, same convention as the three fields above. */
  longestRun?: number;
}

export interface CoveredSegmentFilter {
  kept: VideoSegment[];
  skipped: SkippedSegmentRecord[];
  /** The alignments for `kept`, in the same order — `keptAlignments[i]` belongs
   *  to `kept[i]`. Collected here in the same pass because `snapCoveredBoundaries`
   *  (services/snapBoundaries.ts) needs each survivor's real token indices to
   *  re-snap the boundaries BETWEEN survivors; re-deriving this correspondence
   *  at the call site would mean a second scan over the coverage array that
   *  could silently fall out of step with this one. */
  keptAlignments: SegmentAlignment[];
}

/**
 * R4-1/R4-2 — skip unmatched. Partitions the aligned segments into the ones
 * that go on the timeline and the ones that are dropped.
 *
 * Bug 2 fix: the keep test is `matched === true`, NOT `covered === true`. A
 * segment is kept as long as the audio matched at least one of its words, no
 * matter how weak the confidence — the old app kept every matched segment, and
 * gating on the LOW_CONFIDENCE_RATIO (0.4) threshold here was a regression that
 * dropped legitimately-spoken scenes (e.g. "Navigational charts
 * cross-referenced.", 1/3 words matched → confidence 0.33). A segment with
 * `matched === false` (which also covers zero-token/neutral segments by
 * construction) is dropped, and its only possible skip reason is 'no audio
 * match'.
 *
 * Bug C (consecutive-run survival requirement, 2026-08-02) supersedes part of
 * Bug 2's doctrine: `matched` is no longer simply "at least one word
 * matched" — a segment's matched words must also form a qualifying
 * contiguous run (whisperService.ts's `hasQualifyingRun`). A DROPPED segment
 * can therefore have `matchedWords > 0` and `confidence > 0` — real matches
 * too scattered to trust — so do not assume a skip record's confidence is
 * always 0; only `matched === false` is guaranteed.
 *
 * The `covered` flag (matched AND confidence ≥ LOW_CONFIDENCE_RATIO) is
 * deliberately NOT used here anymore — it survives only inside
 * `computeCoverageSummary`'s R13 contiguous-run scan (the conservative
 * full-mismatch gate), which is intentionally left unchanged.
 *
 * There is deliberately no fallback timing of any kind: a segment either
 * appears at its Whisper-anchored time or it does not appear. Kept segments
 * carry their startTime/duration through untouched, so a dropped segment's
 * span becomes an actual gap in the timeline rather than being folded into a
 * neighbour.
 */
export function filterToCoveredSegments(
  segments: VideoSegment[],
  coverage: SegmentAlignment[],
  // R.10 (`faUnspokenGate.ts`) — the PRE-filter indices this run's
  // scripted-text-never-spoken gate flagged. Purely a REPORTING input: the keep
  // test is still `matched === false` and nothing else, because the gate has
  // already forced `matched: false` on exactly these indices before this
  // function is called. All this changes is which reason the skip record
  // carries into the sync log, so "the audio never said this" reads
  // differently from "the aligner could not find it".
  unspokenScriptIndices?: ReadonlySet<number>,
): CoveredSegmentFilter {
  const kept: VideoSegment[] = [];
  const keptAlignments: SegmentAlignment[] = [];
  const skipped: SkippedSegmentRecord[] = [];
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i]!;
    const alignment = coverage[i];
    if (alignment?.matched) {
      kept.push(seg);
      keptAlignments.push(alignment);
      continue;
    }
    const cov = coverage[i];
    skipped.push({
      segmentIndex: i,
      segmentText: seg.text ?? '',
      reason: unspokenScriptIndices?.has(i) ? R10_SKIP_REASON : 'no audio match',
      segmentTag: seg.tag || undefined,
      matchedWords: cov?.matchedWords,
      totalWords: cov?.totalWords,
      confidence: cov?.confidence,
      longestRun: cov?.longestRun,
    });
  }

  return { kept, skipped, keptAlignments };
}

/**
 * R4-1 re-tile (WS1b) — FALLBACK ONLY since the middle-gap position-offset fix.
 * The Whisper path now uses `snapCoveredBoundaries` (services/snapBoundaries.ts)
 * instead, which subsumes this re-tile: it re-derives the boundaries BETWEEN
 * survivors from their real spoken-word edges and sets durations from those,
 * rather than accepting startTimes that an unmatched neighbour helped compute.
 * This function survives for callers that have no tokens/silences to snap
 * against (the no-transcript paths), where closing the gaps arithmetically is
 * still strictly better than leaving them.
 *
 * After `filterToCoveredSegments` drops the unmatched segments, the survivors
 * still carry durations computed against the FULL pre-filter array (each
 * segment's t1 was pinned to its immediate neighbour's t0 by the aligner, then
 * `applyAnchorBasedTiming` re-derived spans over every segment). So a covered
 * segment sitting right before a skipped run ends at the skipped segment's
 * position, not the next SURVIVING segment's — a gap that compounds down the
 * timeline.
 *
 * This closes the gaps by re-deriving each survivor's duration from the next
 * survivor's startTime; the last survivor extends to `audioDuration` (the audio
 * is the source of truth for total length). Whisper-anchored startTime and
 * anchorStart are correct and are preserved untouched — only `duration` changes.
 * If a recomputed duration would be ≤ 0 (degenerate: non-monotonic or duplicate
 * startTimes), the segment's original duration is kept rather than emitting a
 * zero/negative span. Pure.
 */
export function retileCoveredSegments(kept: VideoSegment[], audioDuration: number): VideoSegment[] {
  if (kept.length === 0) return kept;
  // Defensive: sort by startTime ascending (survivors should already be in order).
  const ordered = [...kept].sort((a, b) => a.startTime - b.startTime);
  return ordered.map((seg, i) => {
    const isLast = i === ordered.length - 1;
    const end = isLast ? audioDuration : ordered[i + 1]!.startTime;
    const nextDuration = end - seg.startTime;
    // Non-monotonic / duplicate startTime (or audioDuration before the last
    // start): keep the original duration rather than a zero/negative span.
    const duration = nextDuration > 0 ? nextDuration : seg.duration;
    return { ...seg, duration: Number(duration.toFixed(3)) };
  });
}

// ---------------------------------------------------------------------------
// WS-logs — persistent sync log (R4-4). filterToCoveredSegments already tells
// us exactly which scenes were left off the timeline and why; until now that
// was a DEV-only console.warn that died with the tab. These pure builders turn
// a run's outcome into SyncLogEntry/SyncRunSummary records, and
// appendSyncLogEntries (services/syncLog.ts) folds them onto the Project —
// which the existing projectStore serializer persists as a unit, so no
// separate store is involved.
//
// Every function here is pure and module-level (same testability precedent as
// the WS1b gate functions above): the orchestrator decides WHEN a run aborted
// or skipped, these decide WHAT the log says about it. makeSyncLogEntry,
// appendSyncLogEntries, buildSilenceErrorEntry, and buildMalformedTokenEntry
// moved to services/syncLog.ts (Pipeline Contract Program, Pair 1, Step 1) —
// the staging-time transcription path (useWhisper.ts) needs them and cannot
// import from this file without a cycle. The rest of this builder family
// stays here and imports makeSyncLogEntry from that module.
// ---------------------------------------------------------------------------

/** Skip entries store a preview, not the whole scene — the log is a scannable
 *  list, and a long scene would dominate both the panel and the saved blob. */
export const SYNC_LOG_TEXT_PREVIEW_CHARS = 80;

function previewSegmentText(text: string): string {
  const trimmed = text.trim();
  return trimmed.length > SYNC_LOG_TEXT_PREVIEW_CHARS
    ? `${trimmed.slice(0, SYNC_LOG_TEXT_PREVIEW_CHARS)}…`
    : trimmed;
}

/** Per-skip-record absorption info (WS2 T2.1) — resolved once at the call
 *  site from `computeAbsorbedGaps`'s host map, keyed back to each skipped
 *  record's own PRE-filter `segmentIndex` so `buildSkipLogEntries` doesn't
 *  need to re-derive the dropped segment's id itself. Every entry in one
 *  absorbed cluster carries the SAME `hostSegmentId`/`hostDisplayIndex`/
 *  `span` — that shared value is what "groups" them: a reader (or a future
 *  UI) can cluster skip entries by `segmentId` even though each still
 *  renders as its own `SyncLogEntry`. */
export interface AbsorbedGapLogInfo {
  hostSegmentId: string;
  /** 0-based index into `kept` (the committed/survivor array) — the scene
   *  number the timeline shows for the absorbing neighbour. */
  hostDisplayIndex: number;
  span: { start: number; end: number };
  gapAudio: 'silent' | 'speech' | 'unknown';
  /** The DROPPED scene's own stable id — what a restore control acts on
   *  (`SyncLogEntry.restoreGapId`), distinct from `hostSegmentId` above. */
  droppedSegmentId: string;
}

/**
 * One 'skip' entry per SkippedSegmentRecord. `segmentIndex` is carried through
 * as the record's PRE-filter index (see SkippedSegmentRecord) — the scene the
 * user wrote, not a position on the committed timeline, which by definition no
 * longer contains it. The displayed index is 1-based; the stored one is not.
 *
 * WS2 T2.1 — when `absorbedInfoBySkipIndex` names this record's absorbing
 * neighbour, the message additionally reports the true reclaimable region
 * (previous survivor's last spoken word end → its duration → next survivor's
 * first spoken word start, per A1) and the audio label (A2), and the entry's
 * `segmentId` is set to the absorbing neighbour's own id — never the dropped
 * segment's — so a click can deep-link the playhead to a COMMITTED,
 * on-timeline position (`SyncLogEntry.segmentId`'s own doc comment).
 */
export function buildSkipLogEntries(
  syncRunId: string,
  skipped: SkippedSegmentRecord[],
  timestamp: number = Date.now(),
  absorbedInfoBySkipIndex?: ReadonlyMap<number, AbsorbedGapLogInfo>,
): SyncLogEntry[] {
  return skipped.map(record => {
    const absorbed = absorbedInfoBySkipIndex?.get(record.segmentIndex);
    let message = `Scene ${record.segmentIndex + 1} skipped — ${record.reason}.`;
    if (absorbed) {
      const gapDuration = absorbed.span.end - absorbed.span.start;
      message += ` Absorbed by scene ${absorbed.hostDisplayIndex + 1} `
        + `(${absorbed.span.start.toFixed(3)}s → ${gapDuration.toFixed(3)}s → ${absorbed.span.end.toFixed(3)}s, ${absorbed.gapAudio}).`;
    }
    return makeSyncLogEntry(
      syncRunId,
      'skip',
      message,
      {
        segmentIndex: record.segmentIndex,
        segmentText: previewSegmentText(record.segmentText),
        reason: record.reason,
        segmentTag: record.segmentTag,
        matchedWords: record.matchedWords,
        totalWords: record.totalWords,
        confidence: record.confidence,
        longestRun: record.longestRun,
        segmentId: absorbed?.hostSegmentId,
        restoreGapId: absorbed?.droppedSegmentId,
      },
      timestamp,
    );
  });
}

/**
 * The summary line for a successful sync (Bug 1 fix). Built on EVERY successful
 * run now — clean or with skips — not only the 0-skip case. `matchedSegments`
 * is how many landed on the timeline, `totalSegments` the pre-filter count, and
 * `skippedSegments` how many were dropped for having no audio match.
 */
export function buildSyncInfoMessage(
  totalSegments: number,
  matchedSegments: number,
  skippedSegments: number,
): string {
  const base = `Sync completed: ${matchedSegments} of ${totalSegments} segments matched.`;
  return skippedSegments > 0 ? `${base} ${skippedSegments} skipped.` : base;
}

/**
 * The 'info' entry for a successful run. Emitted on every successful sync
 * regardless of skip count (Bug 1 fix) — alongside any skip entries, not
 * instead of them.
 */
export function buildSyncInfoEntry(
  syncRunId: string,
  totalSegments: number,
  matchedSegments: number,
  skippedSegments: number,
  timestamp: number = Date.now(),
): SyncLogEntry {
  return makeSyncLogEntry(
    syncRunId,
    'info',
    buildSyncInfoMessage(totalSegments, matchedSegments, skippedSegments),
    undefined,
    timestamp,
  );
}

/** The 'abort' entry for a run that never reached the commit. Carries no
 *  segmentIndex — an abort is about the run, not about one scene. */
export function buildSyncAbortEntry(
  syncRunId: string,
  message: string,
  timestamp: number = Date.now(),
): SyncLogEntry {
  return makeSyncLogEntry(syncRunId, 'abort', message, undefined, timestamp);
}

/**
 * WS3 Batch B, Piece 1 — the single "this segment ended up with no asset"
 * summary entry, replacing two emitters that used to cover overlapping
 * ground: a pre-existing one computed from the run's final committed
 * segments ("No asset matched…", no asset-count context) and a Batch A
 * addition computed from parseProjectData's own output right after the
 * parse pass ("No asset available…", richer — asset-count context alongside
 * the range-collapsed segment numbers), before autoMatchSegments got a
 * chance to fill any of the gap.
 *
 * Both checked the identical `!segment.assetId` predicate — the only
 * difference was WHEN in the pipeline they checked it, not what cause they
 * detected (an explicit tag that never resolved and an exhausted untagged-
 * fallback pool both looked the same to either one). Computing pre-
 * autoMatchSegments risked a false positive: a segment the parse pass left
 * unassigned that autoMatchSegments went on to fill would still have been
 * reported as unassigned. Computing on the final committed segments (this
 * function's contract) is the strictly correct question — "did this segment
 * end up with no asset" — and never misses a cause the old parse-pass-only
 * entry caught, since autoMatchSegments only ever fills gaps, never removes
 * an assignment. Keeps the richer Batch A wording. 1-based positions,
 * compacted into ranges via compactRanges. Returns undefined when every
 * segment has an asset — the caller never appends a zero entry.
 */
export function buildNoAssetSummaryEntry(
  syncRunId: string,
  noAssetSegmentNumbers: number[],
  totalSegments: number,
  availableAssetCount: number,
  timestamp: number = Date.now(),
): SyncLogEntry | undefined {
  if (noAssetSegmentNumbers.length === 0) return undefined;
  return makeSyncLogEntry(
    syncRunId,
    'no-asset',
    `No asset available for ${noAssetSegmentNumbers.length} of ${totalSegments} segments `
    + `(${availableAssetCount} asset${availableAssetCount === 1 ? '' : 's'} for ${totalSegments} segments): `
    + `${compactRanges(noAssetSegmentNumbers)}.`,
    undefined,
    timestamp,
  );
}

/**
 * WS3 Batch B, Piece 2, Case A — one 'warning' entry per committed video
 * segment whose source clip is shorter than the segment's own duration.
 * Owner ruling: a video clip always plays at its native rate; when it runs
 * out before the segment does, the final frame holds for the remainder (see
 * toSourceTime's clamp in useWebCodecsPreview.ts and its three mirrors —
 * PreviewStage.tsx, frameRenderer.ts, exportWorker.ts). This entry is purely
 * informational — the freeze itself needs no user action — so it mirrors
 * buildSkipLogEntries' per-item shape rather than a grouped range summary
 * (unlike buildNoAssetSummaryEntry): each affected segment gets its own line
 * naming exactly which one and by how much, matching the wording an owner
 * report already used as the target: "Segment #4: source clip (1.2s) is
 * shorter than the segment duration (2.5s); the final frame will hold for
 * the remaining 1.3s." Computed from the run's final committed segments (not
 * parseProjectData's own estimate) because Whisper alignment can still
 * change a segment's duration after the parse pass. `availableClipLen`
 * accounts for `trimStart` so a manually-trimmed segment is evaluated
 * against what's actually left of the clip, not its full source length.
 */
export function buildFreezeFrameEntries(
  syncRunId: string,
  segments: VideoSegment[],
  assets: Asset[],
  timestamp: number = Date.now(),
): SyncLogEntry[] {
  const entries: SyncLogEntry[] = [];
  segments.forEach((s, i) => {
    const srcDur = s.assetId ? assets.find(a => a.id === s.assetId)?.duration : undefined;
    if (srcDur === undefined || srcDur <= 0) return;
    const availableClipLen = srcDur - (s.trimStart ?? 0);
    if (availableClipLen >= s.duration) return; // Case B (or exact fit) — nothing to warn about
    const heldFor = s.duration - availableClipLen;
    entries.push(makeSyncLogEntry(
      syncRunId,
      'warning',
      `Segment #${i + 1}: source clip (${availableClipLen.toFixed(1)}s) is shorter than the `
      + `segment duration (${s.duration.toFixed(1)}s); the final frame will hold for the `
      + `remaining ${heldFor.toFixed(1)}s.`,
      { segmentIndex: i },
      timestamp,
    ));
  });
  return entries;
}

/**
 * Rescue observability (false-positive rescue fix, 2026-07-31). One
 * `RescuedSegmentRecord` per segment the per-segment temporal-bounding rescue
 * (whisperService.ts's extractSegmentAlignments) recovered — i.e. every
 * coverage entry carrying `recoveredVia` (present only when the global pass
 * gave the segment zero matches AND the rescue's claim survived the
 * forward-ordering bound; see AlignResult's doc comment). `segmentIndex` is
 * 0-based into the PRE-filter (aligned) segments array, matching
 * `SkippedSegmentRecord`'s convention.
 */
export interface RescuedSegmentRecord {
  segmentIndex: number;
  recoveredVia: 'windowed' | 'global' | 'concat';
  recoveredRegion: { startSec: number; endSec: number };
  /** The segment's anchor estimate at sync time, for the message's "anchor
   *  estimate" clause. Omitted (clause dropped) for a segment with no
   *  anchorStart — the rescue itself never runs without one, so this is
   *  defensive rather than a real case. */
  anchorStart?: number;
}

const RESCUE_PASS_LABEL: Record<RescuedSegmentRecord['recoveredVia'], string> = {
  windowed: 'windowed fallback',
  global: 'global fallback',
  concat: 'sub-word concat fallback',
};

/**
 * One 'rescue' entry per recovered segment (1-based display number, matching
 * `buildSkipLogEntries`'s convention). Informational — this is the SAME
 * rescue mechanism that has always existed (WS6), surfaced to the user for
 * the first time, not a new failure mode. Returns [] when nothing was
 * rescued this run — the caller never appends zero entries.
 */
export function buildRescueLogEntries(
  syncRunId: string,
  rescued: RescuedSegmentRecord[],
  timestamp: number = Date.now(),
): SyncLogEntry[] {
  return rescued.map(record => {
    const passLabel = RESCUE_PASS_LABEL[record.recoveredVia];
    const rangeLabel = `${formatTime(record.recoveredRegion.startSec)}–${formatTime(record.recoveredRegion.endSec)}`;
    const anchorClause = record.anchorStart !== undefined
      ? ` (anchor estimate ${formatTime(record.anchorStart)})`
      : '';
    return makeSyncLogEntry(
      syncRunId,
      'rescue',
      `Segment ${record.segmentIndex + 1} recovered via ${passLabel} — matched audio at ${rangeLabel}${anchorClause}.`,
      { segmentIndex: record.segmentIndex },
      timestamp,
    );
  });
}

/**
 * K13 fix — one 'lock-not-restored' entry per DroppedLockRecord.
 * `no-asset-id`/`duplicate-asset-id` never matched a segment in the new
 * array, so the scene is named from the OLD segment's own text preview;
 * `out-of-bounds`/`partition-conflict` matched a real new segment before
 * validation dropped them, so the message uses its 1-based display number,
 * matching every other segment-indexed entry's convention. Messages are
 * written for the project owner, not a developer: name the scene, say the
 * lock was dropped, say why.
 */
export function buildLockNotRestoredLogEntries(
  syncRunId: string,
  records: DroppedLockRecord[],
  timestamp: number = Date.now(),
): SyncLogEntry[] {
  return records.map(r => {
    const scene = r.segmentIndex !== undefined
      ? `Segment ${r.segmentIndex + 1}`
      : `A previously locked scene ("${previewSegmentText(r.oldText)}")`;
    let message: string;
    let fixHint: string;
    switch (r.reason) {
      case 'no-asset-id':
        message = `${scene}'s lock could not be restored after this sync — the locked scene had no asset reference to match against.`;
        fixHint = 'Point the scene at an asset, then re-lock it.';
        break;
      case 'duplicate-asset-id':
        message = `${scene}'s lock could not be restored after this sync — its asset is shared with another scene, so the match was ambiguous.`;
        fixHint = 'Make sure each scene points to a unique asset, then re-lock it.';
        break;
      case 'out-of-bounds':
        message = `${scene}'s saved lock position no longer fits the voiceover's new length — the lock was dropped.`;
        fixHint = 'Re-lock the segment once you are happy with its new position.';
        break;
      case 'partition-conflict':
        message = `${scene}'s saved lock position conflicts with a neighboring scene after this sync — the lock was dropped.`;
        fixHint = 'Re-lock the segment once you are happy with its new position.';
        break;
    }
    return makeSyncLogEntry(
      syncRunId,
      'lock-not-restored',
      message,
      { segmentIndex: r.segmentIndex, severity: 'warning', fixHint },
      timestamp,
    );
  });
}

/** Empties both log fields. Pure; backs the panel's "Clear log" button. */
export function clearSyncLog(project: Project): Project {
  return { ...project, syncLog: [], syncRunSummaries: [] };
}

/**
 * Resolves the audioDuration to feed into applyAnchorBasedTiming, preferring
 * the real, live <audio> element duration (same source Apply Sync uses,
 * App.tsx:1498) over a self-referential Σ duration of the segments array.
 * A locked segment can carry duration > its available span (locks never
 * shrink — see syncEngine.ts's applyAnchorBasedTiming), which inflates
 * Σ duration by that overlap amount; feeding the inflated sum back into
 * PASS 3 bakes it into the last segment's declared end, making it claim to
 * run past where the real audio actually ends (silent early cutoff). Falls
 * back to the Σ duration when no live audio duration is available yet
 * (no-voiceover projects), leaving that case unchanged.
 */
function resolveAudioDuration(audioEl: HTMLAudioElement | null, fallbackSegments: VideoSegment[]): number {
  const live = audioEl?.duration;
  if (live !== undefined && isFinite(live) && live > 0) return live;
  return fallbackSegments.reduce((sum, s) => sum + s.duration, 0);
}

const TEXT_ENTRY_INPUT_TYPES = new Set([
  'text', 'number', 'password', 'email', 'search', 'tel', 'url',
  'color', 'date', 'datetime-local', 'month', 'week', 'time', 'datetime',
]);

function isTextEntryElement(el: Element | null): boolean {
  if (!el) return false;
  if (el.tagName === 'TEXTAREA') return true;
  if (el.tagName === 'INPUT') {
    return TEXT_ENTRY_INPUT_TYPES.has((el as HTMLInputElement).type);
  }
  return false;
}

export default function App() {
  const [project, setProjectRaw] = useState<Project>(makeDefaultProject);

  // -------------------------------------------------------------------------
  // UNDO/REDO SEAM (Phase 1, 2026-08-08).
  // Design: docs/decisions/2026-08-08-undo-redo-design.md §1.3, §3.1.
  //
  // `setProject` below is a WRAPPER around the raw setter. Every one of this
  // file's ~61 existing `setProject(...)` call sites keeps its exact current
  // syntax — only the identifier they resolve to changed — so capture is not a
  // per-call-site obligation that rots the moment someone adds site 62. That is
  // the same argument the Model P gapless assertion makes for being one effect
  // rather than ~61 inline checks, and it applies here for the same reason.
  //
  // WHY A SYNCHRONOUS MIRROR (`liveProjectRef`) RATHER THAN `projectRef`.
  // The wrapper has to know the PRE-edit project in order to store it.
  // `projectRef` is written from a `useEffect`, so it holds the last COMMITTED
  // project — which is correct for a single write, and wrong for two writes
  // batched into one handler: the second would read the first's stale value and
  // push a duplicate state, producing two history entries for one gesture.
  // `liveProjectRef` is advanced synchronously inside the wrapper itself, so
  // each call in a batch sees the value the previous call produced.
  //
  // The cost of that choice, stated plainly: an updater-form call now receives
  // `liveProjectRef.current` rather than React's own queued state. Those agree
  // only as long as EVERY write goes through here. `setProjectRaw` is therefore
  // called in exactly two places outside this wrapper — the hydration commit and
  // `setProjectSilent` — and both advance the mirror. Do not add a third.
  // -------------------------------------------------------------------------
  const liveProjectRef = useRef<Project>(project);
  const [history, setHistory] = useState<History<Project>>(emptyHistory<Project>);

  /**
   * Writes the project WITHOUT recording history.
   *
   * For writes that are not user edits, or that would record a state the user
   * never authored:
   *  - the drag session's two revert paths (`revertSegments`) — they restore the
   *    array that is already the top of history, so capturing them would push a
   *    no-op duplicate and make one gesture cost two undos (design §3.1);
   *  - lock/unlock, which the owner ruled NOT undoable (design §4);
   *  - hydration, and any other machine-driven write;
   *  - handleApplySyncFromFiles's post-hoc boundary-quality log append — a
   *    continuation of the SAME Apply Sync edit that already pushed its own
   *    entry via `setProject`, arriving after the async waveform build, not a
   *    second user-authored edit (Stage 3, 2026-08-08 cleanup run).
   */
  const setProjectSilent = useCallback((action: React.SetStateAction<Project>): void => {
    commitProjectSilent(action, { liveProjectRef, setProjectRaw });
  }, []);

  /**
   * The capturing setter — what all pre-existing `setProject` call sites now
   * resolve to. `meta` is optional; a site that passes nothing still gets an
   * undoable entry, just with a generic label.
   */
  // The open coalescing gesture (design §3.2). A ref, not state: it is consulted
  // synchronously inside `setProject` and must never lag a batch.
  const openGestureRef = useRef<OpenGesture | null>(null);

  const setProject = useCallback((
    action: React.SetStateAction<Project>,
    meta?: {
      label?: string;
      anchorSegmentId?: string;
      /** `(control, target)` — e.g. `grade:brightness:<segId>`. Omit for a
       *  discrete action, which always gets its own entry. */
      coalesceKey?: string;
      coalesceKind?: CoalesceClass;
    },
  ): void => {
    commitProject(action, meta, { liveProjectRef, setProjectRaw, setHistory, openGestureRef });
  }, []);

  const [isHydrating, setIsHydrating] = useState(true);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState<number>(() => {
    try { return (readUiState().currentTime as number) ?? 0; }
    catch { return 0; }
  });
  const [isProcessing, setIsProcessing] = useState(false);
  // D15 fix — restore the persisted zoom level instead of always starting at the
  // 0.5 midpoint, so a raw pixel timelineScrollLeft (persisted at whatever zoom
  // was active) maps back to the same timeline position on reload.
  const [sliderT, setSliderT] = useState<number>(() => {
    try { return (readUiState().sliderT as number) ?? 0.5; }
    catch { return 0.5; }
  });
  // Live pixels-per-second value from Timeline's zoom formula. Held in a ref so
  // App's two consumer sites (playback auto-scroll, resize-drag) read the current
  // value without re-rendering App on every zoom tick.
  const pixelsPerSecondRef = useRef(100);
  const onPixelsPerSecondChange = useCallback((pps: number) => {
    pixelsPerSecondRef.current = pps;
  }, []);
  const [globalPlaybackSpeed, setGlobalPlaybackSpeed] = useState(1);
  const [syncStep, setSyncStep] = useState<0 | 1 | 2 | 3 | 4>(0);
  const exportModalTrapRef = useFocusTrap<HTMLDivElement>();
  const [isSynced, setIsSynced] = useState(false);

  // Voiceover waveform data, built ONCE upfront (services/waveformPipeline) instead
  // of inside Timeline's render-triggered decode effect (the multi-minute freeze —
  // docs/history.md ("Waveform Rewrite — Implementation Record", archived) §3). Two writers: handleApplySyncFromFiles awaits
  // buildVoiceoverWaveform as part of the sync sequence; a reload effect re-triggers
  // it when a persisted project mounts. The peaks (not canvas bitmaps/images) are
  // now persisted to IndexedDB (services/waveformStore.ts) keyed by asset id, so a
  // reload of an unchanged voiceover loads cached peaks instead of re-decoding —
  // see buildVoiceoverWaveform below (persistence reversal, docs/history.md
  // ("Waveform Rewrite — Implementation Record", archived), "Persistence of peaks").
  // waveformSource MUST stay a stable object reference between builds — SegmentWaveform
  // is React.memo'd on its identity — so it is only ever replaced by setWaveformSource.
  const [waveformSource, setWaveformSource] = useState<WaveformSource | null>(null);
  // Key (voiceover asset id) the waveform is built-or-building for. Set synchronously
  // at build start so the explicit Apply-Sync call and the reload effect dedupe
  // against each other within a session. Keyed on asset.id, NOT asset.url — url is a
  // blob: URL re-minted every session (App.tsx's reload path), so it is never a
  // meaningful identity; asset.id is stable and every upload/replace mints a fresh
  // id (handleVoiceoverStaged/processMediaFile), so an id match is a safe cache key
  // both for this in-memory ref and for the IndexedDB cache below. Reset to null on
  // failure so a retry can happen.
  const waveformBuiltForRef = useRef<string | null>(null);

  // Identity of the asset the CURRENTLY-DISPLAYED waveformSource was built
  // from (gen-6 gate audit, Option A) — updated the instant setWaveformSource
  // commits real content, cleared to null whenever it's set to null. Distinct
  // from waveformBuiltForRef: that ref is set synchronously at build START
  // (before the async cache lookup even resolves) purely to dedupe overlapping
  // in-flight calls for the SAME key, and is blind across a project switch
  // (overwritten by whatever project was visited in between). This ref instead
  // answers "does waveformSource in React state right now already match this
  // incoming asset+blobSize" — used by the pre-generation-bump gate below to
  // short-circuit the apply-sync/reload-effect double-fire on the same asset.
  const waveformResidentRef = useRef<{ assetId: string; blobSize: number } | null>(null);

  // Mirrors the latest value handed to setWaveformSource — boundary-quality
  // checker (waveform-watcher program, Phase 1). React state updates are not
  // visible synchronously to the caller of an async function that scheduled
  // them, so handleApplySyncFromFiles's post-hoc pass (needs the resolved
  // WaveformSource the instant buildVoiceoverWaveform's own await settles)
  // cannot read `waveformSource` itself here — it would be the closure's
  // stale value. This ref is updated at the exact same moment as every
  // setWaveformSource call below and returned by buildVoiceoverWaveform
  // instead.
  const waveformSourceRef = useRef<WaveformSource | null>(null);
  const commitWaveformSource = useCallback((source: WaveformSource | null) => {
    waveformSourceRef.current = source;
    setWaveformSource(source);
  }, []);

  const buildVoiceoverWaveform = useCallback(async (
    asset: Asset | undefined | null,
  ): Promise<WaveformSource | null> => {
    const incomingAssetId = asset?.id ?? null;
    const incomingBlobSize = asset?.file?.size ?? null;

    // --- Pre-build identity gate --------------------------------------------
    // Two synchronous arms, checked BEFORE the in-flight dedupe below (Phase 1
    // wiring fix, 2026-08-02 — see the dedupe check's own comment for why the
    // ORDER here is load-bearing, not cosmetic):
    //   'resident' — waveformResidentRef already reflects this exact
    //     asset+blobSize: waveformSource in React state right now IS this
    //     content (no intervening project switch).
    //   'mirror'   — services/waveformStore.ts's in-memory LRU mirror already
    //     resolved this exact asset+blobSize earlier THIS SESSION (put or a
    //     prior getWaveform hit). Covers the switch-back case (A -> B -> A):
    //     the reload effect always re-fires because handleSwitchProject mints
    //     a fresh File object on every rehydration ([App.tsx] rehydratedFile),
    //     even when content is byte-identical, but the mirror answers
    //     synchronously without an IndexedDB round-trip.
    // Falls through to the in-flight dedupe / cold path ('cold-miss') otherwise.
    let gateArm: 'resident' | 'mirror' | 'cold-miss' | 'no-asset' = 'no-asset';
    let mirroredSource: WaveformSource | undefined;
    if (incomingAssetId !== null && incomingBlobSize !== null) {
      const resident = waveformResidentRef.current;
      if (resident && resident.assetId === incomingAssetId && resident.blobSize === incomingBlobSize) {
        gateArm = 'resident';
      } else {
        mirroredSource = peekWaveform(incomingAssetId, incomingBlobSize);
        gateArm = mirroredSource ? 'mirror' : 'cold-miss';
      }
    }

    if (gateArm === 'resident') {
      // waveformSource already IS this asset+blobSize — nothing to do.
      return waveformSourceRef.current;
    }
    if (gateArm === 'mirror' && mirroredSource && incomingAssetId !== null && incomingBlobSize !== null) {
      waveformBuiltForRef.current = incomingAssetId;
      waveformResidentRef.current = { assetId: incomingAssetId, blobSize: incomingBlobSize };
      commitWaveformSource(mirroredSource);
      syncMark('waveform:committed-from-mirror');
      return mirroredSource;
    }

    // --- Cheap in-flight dedupe (reorder fix, gen-3/gen-4 bug; re-ordered
    // again in the Phase 1 wiring fix above, 2026-08-02) ---------------------
    // waveformBuiltForRef is set synchronously at the START of a cold build
    // (no await in between) and is NEVER reset back to null on success — only
    // on a failed build (below) does it clear, to allow a retry. That means a
    // call for an asset whose build already completed successfully earlier
    // this session would ALSO match this ref, indistinguishable from a
    // still-in-flight duplicate call for the same key, unless the resident/
    // mirror gates above are checked FIRST: they catch the "already done"
    // case and return the real source before this check ever runs. Reaching
    // this line therefore means resident/mirror both missed, so a match here
    // can only mean a genuinely in-flight, not-yet-committed build for this
    // key (the apply-sync + reload-effect back-to-back double-fire this
    // check exists for) — the resident ref only updates once
    // setWaveformSource actually commits, which is a tick too late to catch
    // that double-fire itself.
    //
    // Bug fixed here (Phase 1 wiring fix): before this reorder, a re-sync on
    // an unchanged voiceover — whose waveform had already been built and
    // committed by an earlier Apply Sync or the reload effect — hit THIS
    // check first and returned null unconditionally, even though real peaks
    // existed and were resident. The post-sync boundary-quality checker
    // (below) then logged "Waveform unavailable" every time instead of
    // running its real measurement.
    //
    // No resolved source to return here — the OTHER in-flight call owns this
    // build; returning null tells a boundary-quality caller "not verified
    // this run" rather than guessing at a value that isn't committed yet.
    if (incomingAssetId !== null && waveformBuiltForRef.current === incomingAssetId) {
      return null;
    }

    if (!asset?.url) {
      waveformBuiltForRef.current = null;
      waveformResidentRef.current = null;
      commitWaveformSource(null);
      return null;
    }
    const key = asset.id;
    // waveformBuiltForRef already confirmed !== key by the dedupe check above.
    waveformBuiltForRef.current = key;
    syncMark('waveform:build-start');

    // Reuse persisted peaks when available — skips decodeAudioData + the peak
    // loop entirely on a reload of an unchanged voiceover. blobSize is read
    // synchronously off the already-in-hand File (no async probe) and doubles
    // as the invalidation guard: a same-id asset whose blob size no longer
    // matches what was persisted is treated as a cache miss, not served stale.
    const blobSize = asset.file?.size;
    if (blobSize !== undefined) {
      try {
        const cached = await getPersistedWaveform(projectIdRef.current, asset.id, blobSize);
        if (cached) {
          if (waveformBuiltForRef.current !== key) return null; // voiceover changed mid-lookup
          waveformResidentRef.current = { assetId: key, blobSize };
          commitWaveformSource(cached);
          syncMark('waveform:committed-from-cache');
          return cached;
        }
      } catch (err) {
        console.error('[waveform] persisted-peaks read failed, rebuilding:', err);
      }
    }

    try {
      const { source } = await buildWaveformPipeline({ file: asset.file, url: asset.url });
      if (waveformBuiltForRef.current !== key) return null; // voiceover changed mid-build
      waveformResidentRef.current = blobSize !== undefined ? { assetId: key, blobSize } : null;
      commitWaveformSource(source);
      syncMark('waveform:committed');
      if (blobSize !== undefined && source) {
        void putPersistedWaveform(projectIdRef.current, asset.id, source, blobSize)
          .catch(err => console.error('[waveform] failed to persist peaks:', err));
      }
      return source;
    } catch (err) {
      console.error('[waveform] build failed:', err);
      if (waveformBuiltForRef.current === key) {
        waveformBuiltForRef.current = null; // allow a later retry
        waveformResidentRef.current = null;
        commitWaveformSource(null);
      }
      return null;
    }
  }, [commitWaveformSource]);

  const [selectedSegmentId, setSelectedSegmentId] = useState<string | null>(() => {
    try { return (readUiState().selectedSegmentId as string | null) ?? null; }
    catch { return null; }
  });
  // Path B Phase 5 — mutually exclusive with selectedSegmentId: selecting a
  // heading row opens the BottomDrawer's heading editor instead of a segment's.
  const [selectedHeadingId, setSelectedHeadingId] = useState<string | null>(null);
  // Batch (multi-)selection for the Effects tab — separate from selectedSegmentId
  // (which drives drawer + seek). Driven only by row checkboxes / select-all.
  const [selectedSegmentIds, setSelectedSegmentIds] = useState<Set<string>>(new Set());

  // ── Persisted UI state (kinetix:ui:v1) ──────────────────────────────────────
  const [leftPanelCollapsed, setLeftPanelCollapsed] = useState<boolean>(() => {
    try { return (readUiState().leftPanelCollapsed as boolean) ?? false; }
    catch { return false; }
  });
  const [rightPanelCollapsed, setRightPanelCollapsed] = useState<boolean>(() => {
    try { return (readUiState().rightPanelCollapsed as boolean) ?? false; }
    catch { return false; }
  });
  const [previewHeight, setPreviewHeight] = useState<number>(() => {
    try { return (readUiState().previewHeight as number) ?? Math.floor((window.innerHeight - 4) / 2); }
    catch { return Math.floor((window.innerHeight - 4) / 2); }
  });
  const [activeLeftTab, setActiveLeftTab] = useState<'files' | 'segments' | 'effects'>(() => {
    try { return (readUiState().activeLeftTab as 'files' | 'segments' | 'effects') ?? 'files'; }
    catch { return 'files'; }
  });

  // Timeline scroll position — read once on mount; passed to <Timeline> as initialScrollLeft.
  // Persistence (scroll listener + localStorage write) lives in Timeline.tsx where
  // timeline-scroll-area is guaranteed to exist.
  const initialTimelineScrollLeft = (() => {
    try { return (readUiState().timelineScrollLeft as number) ?? 0; }
    catch { return 0; }
  })();

  // Persist UI state to localStorage whenever any of the tracked values change.
  useEffect(() => {
    patchUiState({ leftPanelCollapsed, rightPanelCollapsed, previewHeight, activeLeftTab, selectedSegmentId });
  }, [leftPanelCollapsed, rightPanelCollapsed, previewHeight, activeLeftTab, selectedSegmentId]);

  // Persist currentTime when paused or seeking (not on every 16ms playback tick).
  // Fires when isPlaying transitions to false (pause/end) or when currentTime
  // changes while already paused (seek). Bails immediately during playback.
  useEffect(() => {
    if (isPlaying) return;
    patchUiState({ currentTime });
  }, [isPlaying, currentTime]);

  const isDraggingDivider = useRef(false);
  const centerColRef = useRef<HTMLDivElement>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [resizingId, setResizingId] = useState<string | null>(null);
  const [resizingType, setResizingType] = useState<'start' | 'end' | null>(null);
  const [toast, setToast] = useState<{
    message: string;
    action?: { label: string; onClick: () => void };
  } | null>(null);
  const [showStockSearch, setShowStockSearch] = useState(false);
  const [stockTarget, setStockTarget] = useState<string | null>(null);
  const [showReviewMapping, setShowReviewMapping] = useState(false);
  const [stockError, setStockError] = useState<string | null>(null);
  // Phase 2a H.4 guard — per-session dismiss for the unsupported-language
  // banner; reset (in the effect below) whenever project.language changes to
  // a NEW unsupported value, so dismissing one warning can't silently hide a
  // later, different one.
  const [languageBannerDismissed, setLanguageBannerDismissed] = useState(false);
  const [showDashboard, setShowDashboard] = useState(true);
  const [showNewProjectModal, setShowNewProjectModal] = useState(false);
  const [showProjectSettingsModal, setShowProjectSettingsModal] = useState(false);
  const [showExportSettingsModal, setShowExportSettingsModal] = useState(false);
  const [showManageModelsModal, setShowManageModelsModal] = useState(false);
  const [devPanelOpen, setDevPanelOpen] = useState(false);
  const audioRef = useRef<HTMLAudioElement>(null);
  const previewStageRef = useRef<PreviewStageHandle>(null);

  // Ref that mirrors project.assets so useCallback([]) closures can read the
  // latest asset list without project.assets appearing in their dep arrays.
  const assetsRef = useRef<Asset[]>(project.assets);
  // Ref that mirrors the full project so async handlers (handleApplySyncFromFiles,
  // finalizeSync) can read the live state after awaits without stale closures.
  const projectRef = useRef<Project>(project);
  // Ref that mirrors project.id so stable useCallback([]) closures can pass the
  // correct projectId to IndexedDB calls without project.id in their dep arrays.
  const projectIdRef = useRef<string>(project.id);
  // Option C: ephemeral voiceover staged before Apply Sync is clicked — minted by
  // handleVoiceoverStaged, consumed (id/url reused) by handleApplySyncFromFiles.
  // Not part of project state; never persisted until commit.
  const [pendingVoiceover, setPendingVoiceover] = useState<{ file: File; asset: Asset } | null>(null);
  // Mirrors pendingVoiceover synchronously — written at every setPendingVoiceoverSync
  // call, not just after the next render's effect. Two stage events firing within the
  // same render (rapid re-stage, double-fire) must see each other's writes immediately;
  // a post-render-only mirror lets the second one read a one-render-stale value.
  const pendingVoiceoverRef = useRef<{ file: File; asset: Asset } | null>(null);
  const setPendingVoiceoverSync = useCallback((value: { file: File; asset: Asset } | null) => {
    pendingVoiceoverRef.current = value;
    setPendingVoiceover(value);
  }, []);
  // Asset id of whichever voiceover the most recently STARTED real transcription
  // attempt (either call site) was for. transcriptionStatus.phase is asset-agnostic
  // (one useWhisper instance backs both handleVoiceoverStaged and finalizeSync), so
  // transcriptionReady needs this to confirm a done/error phase actually belongs to
  // the voiceover that's currently relevant, not a stale already-superseded one.
  const transcriptionTargetIdRef = useRef<string | null>(null);
  // Synchronous guard: true while a timeline resize drag is in progress.
  // Set true unconditionally on mousedown (onResizeStart, below). Cleared by
  // the resizingId effect below — NOT by a rAF in handleUp (that raced against
  // PreviewStage's id-keyed seek effect in the same commit; see D12 fix).
  const isResizingRef = useRef(false);
  // D12 fix (round 3) — currentSegment itself must not track the transient,
  // resize-distorted segment geometry: PreviewStage's JSX reads currentSegment
  // directly in many un-gated places (image src, captions, heading text, the
  // Ken Burns/zoom transform, and the outer motion.div's animate/exit props),
  // not just the one imperative video-seek effect. Gating individual
  // consumers (rounds 1 and 2) is fragile and was proven incomplete — the
  // round-2 fix incidentally exposed this because suppressMotionAnim used to
  // (accidentally, via the round-1-unguarded transition-preview bug) also
  // freeze the Framer Motion props. Freeze the resolved segment at the
  // source instead: while isResizingRef.current is true, the useMemo below
  // returns the last value it resolved before the drag started, so every
  // downstream consumer — present and future — is stable for free.
  const lastStableSegmentRef = useRef<VideoSegment | null>(null);
  // Bumped once, right after isResizingRef clears, to force exactly one
  // fresh currentSegment recompute using the now-final (already-committed)
  // segments/currentTime — otherwise the frozen value would never update
  // again until some unrelated render happens to occur (a mutated ref alone
  // doesn't trigger a re-render).
  const [resizeSettleTick, setResizeSettleTick] = useState(0);
  // D12 fix — deterministic clearer for isResizingRef. resizingId and the final
  // cascaded `segments` update (applyDurationChange, called from handleUp) are
  // set in the same batched commit, so React flushes PreviewStage's (child)
  // passive effects — including the id-keyed seek effect that reads
  // isResizingRef — before this (parent) effect runs. That ordering is a React
  // guarantee, unlike the old rAF clear which raced the browser's own paint
  // scheduling against React's effect flush.
  useEffect(() => {
    if (resizingId === null) {
      isResizingRef.current = false;
      setResizeSettleTick(t => t + 1);
    }
  }, [resizingId]);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Ref bridge so the mount-only hydration effect ([] deps) can call
  // handleSwitchProject, which is defined later in the component body.
  // The ref is updated every render so it always holds the latest version.
  const handleSwitchProjectRef = useRef<(id: string, opts?: { preserveUiState?: boolean }) => Promise<void>>(async () => {});

  const showToast = useCallback((
    message: string,
    action?: { label: string; onClick: () => void },
  ) => {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    setToast({ message, action });
    toastTimerRef.current = setTimeout(() => setToast(null), TOAST_DURATION);
  }, []);

  /**
   * Applies a duration change for one segment with the same cascade semantics
   * as a drag-resize. Returns true if the cascade succeeded, false if a
   * locked neighbor blocked it (caller must revert live-preview state if any).
   *
   * The project's `transcriptTokens` are forwarded to the cascade as the source
   * of each absorbing neighbour's yield floor (K15b — services/dragCascade.ts's
   * `neighbourFloorDuration`). Times, not indices, are what the floor reads, so
   * the persisted (unfiltered) array is the right one here — unlike the
   * index-based `snapCoveredBoundaries` call site, which must use the filtered
   * array `useWhisper` returns. Undefined on a project with no voiceover yet,
   * which the floor handles by degrading to MIN_SEGMENT_DURATION.
   */
  const applyDurationChange = useCallback((
    originalSegments: VideoSegment[],
    segmentId: string,
    newDuration: number,
    finalTrimStart: number,
    fromSide: 'left' | 'right',
    // Cascade switches (owner ruling 2026-08-08). The drag path passes
    // `DRAG_CASCADE_OPTIONS` — the same object its live preview resolved
    // through — so a drag can never change total timeline duration.
    cascadeOptions?: DragCascadeOptions,
  ): boolean => {
    const draggedIdx = originalSegments.findIndex(s => s.id === segmentId);
    if (draggedIdx < 0) return false;
    const cascadeResult = computeDragCascade(
      originalSegments,
      draggedIdx,
      newDuration,
      finalTrimStart,
      fromSide,
      (segIdx, segId) => {
        const lockedSeg = originalSegments.find(s => s.id === segId);
        showToast(
          `Segment ${segIdx + 1} is locked. Unlock to continue resizing.`,
          lockedSeg ? {
            label: 'Unlock',
            // SILENT — see handleToggleLock: locks are not undoable.
            onClick: () => setProjectSilent(prev => ({
              ...prev,
              segments: prev.segments.map(s => s.id === segId ? { ...s, locked: false } : s),
            })),
          } : undefined,
        );
      },
      projectRef.current.transcriptTokens,
      cascadeOptions,
    );
    if (cascadeResult === null) return false;
    // ONE history entry per committed gesture, labelled and anchored (design
    // §5.2). The anchor is the segment the gesture STARTED on — not the whole
    // set the cascade moved — so an undo of a five-segment cascade scrolls back
    // to where the user's hand actually was. `cascadeResult === null` returned
    // above without committing, so a blocked drag reaches this line never and
    // pushes nothing; the live preview writes no state at all, so the ~60 frames
    // of a gesture are structurally incapable of adding entries.
    setProject(
      prev => ({ ...prev, segments: cascadeResult }),
      { label: `resize segment ${draggedIdx + 1}`, anchorSegmentId: segmentId },
    );
    return true;
  }, [showToast]);

  // Rehydrate persisted project on mount
  useEffect(() => {
    (async () => {
      // -----------------------------------------------------------------------
      // 1. Migrate legacy single-project format if present.
      //    If migration ran, copy assets from the v1 IDB store to the new v2
      //    store scoped by projectId.
      // -----------------------------------------------------------------------
      const migrated = await migrateLegacyIfNeeded();
      if (migrated) {
        const legacyBlobs = await getLegacyAssets();
        await Promise.all(
          legacyBlobs.map(a =>
            putAsset(migrated.project.id, a.id, a.blob, {
              name: a.name,
              mimeType: a.mimeType,
            }).catch((err: unknown) =>
              console.warn('[kinetix] Migration: failed to copy asset', a.id, err),
            ),
          ),
        );
        console.info(
          `[kinetix] Migrated legacy project "${migrated.project.name}" (id: ${migrated.project.id})`,
        );
      }

      // -----------------------------------------------------------------------
      // 1a. WS2 T1.3 — one-time migration of any project still sitting under
      //     the old per-project localStorage keys into the primary OS file
      //     store, freeing the shared ~5-10 MB origin budget that was causing
      //     QuotaExceededError on large projects. A no-op outside Tauri. Must
      //     run BEFORE mirror adoption below, whose "already present locally"
      //     check now looks at the OS store.
      // -----------------------------------------------------------------------
      await migrateLocalStorageProjectsToOsStore();

      // -----------------------------------------------------------------------
      // 2. Route on launch:
      //    • No projects yet  → new-project modal (first ever launch).
      //    • Has a lastOpenedProjectId that still exists in the registry →
      //      reopen that project directly (normal reload case).
      //    • Has projects but no last-opened id (e.g. first launch after
      //      migration) → show the dashboard so the user picks one.
      // -----------------------------------------------------------------------
      // -----------------------------------------------------------------------
      // 1b. WS1 Session O — adopt anything the durable mirror holds that this
      //     ORIGIN does not. `localStorage` is origin-scoped, and `tauri dev`
      //     (http://localhost:3000) and a bundled build (tauri://localhost) are
      //     different origins with disjoint stores; the mirror lives in the
      //     bundle-id-keyed app data dir, which is the same in both. Strictly
      //     additive — never overwrites a project this origin already has —
      //     so it must run BEFORE the registry is read.
      // -----------------------------------------------------------------------
      try {
        const adoption = await adoptMirroredProjects();
        if (adoption.adopted.length > 0) {
          // `showToast` is a useCallback with [] deps — stable, so reading it
          // from this mount-only effect's closure is not a staleness hazard.
          showToast(
            `Recovered ${adoption.adopted.length} project${adoption.adopted.length === 1 ? '' : 's'} from this app's durable storage.`,
          );
        }
      } catch (err) {
        console.error('[kinetix] Mirror adoption failed; continuing with local storage only:', err);
      }

      const allMetas = loadAllMetas();
      const lastId = getLastOpenedProjectId();

      if (allMetas.length === 0) {
        // No projects yet — show empty dashboard; user clicks "New Project" there.
        setShowDashboard(true);
        setIsHydrating(false);
        return;
      }

      if (lastId && allMetas.some(m => m.id === lastId)) {
        // Reload case — reopen the last active project directly.
        await handleSwitchProjectRef.current(lastId, { preserveUiState: true });
        setShowDashboard(false);
        setIsHydrating(false);
        return;
      }

      // Has projects but no last-opened id (e.g. first launch after migration).
      setShowDashboard(true);
      setIsHydrating(false);
    })();
  }, []);

  const { saveNow, lastSavedAt, saveError } = usePersistProject(project, !isHydrating);

  // Surface a save failure the moment it happens — a debounced autosave
  // failing (e.g. QuotaExceededError) must never be silent: previously
  // `lastSavedAt` was stamped regardless of outcome, so the footer's
  // "Saved" label looked identical whether or not the write actually landed.
  // Toast once per distinct failure (by reason) rather than once per 500 ms
  // retry, since the underlying condition (e.g. storage still full) can
  // easily persist across several autosave ticks.
  const lastToastedSaveErrorReasonRef = useRef<string | null>(null);
  useEffect(() => {
    if (!saveError) {
      lastToastedSaveErrorReasonRef.current = null;
      return;
    }
    if (lastToastedSaveErrorReasonRef.current === saveError.reason) return;
    lastToastedSaveErrorReasonRef.current = saveError.reason;
    showToast(
      saveError.reason === 'quota-exceeded'
        ? "Couldn't save — storage is full. Free up space (delete an unused project) or your latest edits won't persist."
        : `Couldn't save your project (${saveError.reason}). Your latest edits may be lost if you close the app now.`,
    );
  }, [saveError, showToast]);

  const updateSegment = (idx: number, updates: Partial<VideoSegment>): void => {
    setProject(prev => ({
      ...prev,
      segments: prev.segments.map((s, i) => i === idx ? { ...s, ...updates } : s),
    }));
  };

  const updateSegmentOverlay = (idx: number, updates: Partial<NonNullable<VideoSegment['overlayConfig']>>): void => {
    setProject(prev => ({
      ...prev,
      segments: prev.segments.map((s, i) =>
        i === idx
          ? { ...s, overlayConfig: { ...(s.overlayConfig ?? prev.globalOverlayConfig), ...updates } }
          : s
      ),
    }));
  };

  // Master "Overlay Text Display" setter — bulk-writes showOverlay across every
  // segment. This is the single source of truth now that hideAllText is gone.
  const handleSetAllOverlay = (value: boolean): void => {
    setProject(p => ({ ...p, segments: p.segments.map(s => ({ ...s, showOverlay: value })) }));
  };

  const updateExtraOverlay = (segIdx: number, oIdx: number, updates: Partial<TextOverlay>): void => {
    setProject(prev => ({
      ...prev,
      segments: prev.segments.map((s, i) =>
        i === segIdx
          ? { ...s, extraOverlays: s.extraOverlays?.map((o, j) => j === oIdx ? { ...o, ...updates } : o) }
          : s
      ),
    }));
  };

  /**
   * Updates the position of an extra overlay identified by segment id + overlay id.
   * Used by PreviewStage drag-to-position — IDs allow lookup without passing indices
   * across the component boundary.
   */
  const updateExtraOverlayPosition = useCallback(
    (segmentId: string, overlayId: string, x: number, y: number): void => {
      setProject(prev => ({
        ...prev,
        segments: prev.segments.map(s =>
          s.id !== segmentId ? s : {
            ...s,
            extraOverlays: s.extraOverlays?.map(o =>
              o.id !== overlayId ? o : { ...o, position: { x, y } }
            ),
          }
        ),
      }));
    },
    [],
  );

  const handleToggleLock = useCallback((segmentId: string): void => {
    // SILENT — locks are NOT undoable (owner ruling 2026-08-08, design §4). A
    // lock is a statement about how future edits may behave, not an edit to the
    // video, and making it undoable interacts confusingly with §5.1's
    // block-undo-on-locked-segment policy: undo would sometimes remove a lock
    // and sometimes be blocked BY one, with no way for the user to predict which.
    setProjectSilent(prev => {
      // MODEL P §4.1(a) (2026-08-07) — refuse a lock that would make the
      // gapless invariant unsatisfiable, rather than committing a gap.
      //
      // Only the LOCK direction is gated. Unlocking removes a wall, which can
      // only ever make the partition more satisfiable, so it is never refused
      // (see `canLockSegment`'s own doc comment).
      const index = prev.segments.findIndex(s => s.id === segmentId);
      const target = index >= 0 ? prev.segments[index] : undefined;
      if (target && !target.locked) {
        const refusal = canLockSegment(prev.segments, index);
        if (refusal) {
          // Declined: `locked` is left exactly as it was, and the reason is
          // surfaced rather than swallowed.
          return appendSyncLogEntries(
            prev,
            [buildLockRefusedLogEntry(mintSyncLogId(), index, refusal.conflictIndex, refusal.amountSec)],
          );
        }
      }

      const toggled = prev.segments.map(s =>
        s.id === segmentId ? { ...s, locked: !s.locked } : s
      );
      const audioDuration = resolveAudioDuration(audioRef.current, toggled);
      const findings: LockFinding[] = [];
      const segments = applyAnchorBasedTiming(toggled, audioDuration, f => findings.push(f));
      const withTiming: Project = { ...prev, segments };
      if (findings.length === 0) return withTiming;
      return appendSyncLogEntries(withTiming, buildLockFindingLogEntries(mintSyncLogId(), findings));
    });
  }, []);

  // Left-panel segment click: open the drawer AND jump the time-driven preview
  // to the segment, mirroring the timeline onSeek pattern (setCurrentTime + audio resync).
  const handleSegmentClick = useCallback((id: string): void => {
    setSelectedSegmentId(id);
    setSelectedHeadingId(null);
    const seg = project.segments.find(s => s.id === id);
    if (seg) {
      setCurrentTime(seg.startTime);
      if (audioRef.current) audioRef.current.currentTime = seg.startTime;
    }
  }, [project.segments]);

  // Persist history so it survives a PAGE RELOAD but not an app restart (owner
  // ruling 2026-08-08, design §6.0). The reload/restart discriminator is a
  // per-process token from Rust — see `historyPersist.ts`'s header for why
  // nothing in the renderer can make that distinction on its own.
  //
  // Debounced at 400ms, just under `usePersistProject`'s own 500ms, so a burst
  // of edits writes once. Keyed on the history object's identity rather than on
  // `project`, so a SILENT write (a lock, a drag revert) triggers no save.
  useEffect(() => {
    if (isHydrating) return;
    const id = liveProjectRef.current.id;
    const t = setTimeout(() => { void saveHistory(id, history); }, 400);
    return () => clearTimeout(t);
  }, [history, isHydrating]);

  // -------------------------------------------------------------------------
  // UNDO / REDO TRAVERSAL (Phase 2, 2026-08-08). Design §4, §5.
  //
  // The restore goes through `setProjectSilent`, NOT `setProject`: travelling to
  // a stored state must not itself become a new undoable entry, or undo would
  // never make progress. The stored states were all produced by writers that
  // already satisfied the DEV gapless assertion, which is what makes the
  // invariant question nearly vacuous here (design §5) — but "nearly" is not
  // "entirely", so the assertion below runs BEFORE the commit, naming the entry,
  // because a violation surfacing only afterwards loses the one useful fact.
  //
  // NOT subject to the drag path's duration-invariance guard, and that is
  // correct: `conserveTotalDuration` is opt-in via `DRAG_CASCADE_OPTIONS` and is
  // passed only by the drag path. A restore never enters `computeDragCascade` at
  // all, and a restored state may legitimately differ in total duration from the
  // current one — undoing an Apply Sync is the obvious case.
  // -------------------------------------------------------------------------
  // The segment a traversal should scroll to and flash (design §5.2). The nonce is
  // what makes a REPEAT traversal onto the same anchor re-fire the flash — keying
  // the effect on the id alone would light it once and then stay silent while the
  // user pressed undo four more times on the same segment.
  const [historyAnchor, setHistoryAnchor] = useState<{ segmentId: string; nonce: number } | null>(null);

  // Selection is NOT restored — that is the "haunted editor" failure mode
  // (design §4): the user undoes a timing change and the editor jumps to a
  // segment they were not looking at. But it IS repaired, because undoing past
  // a heading's or segment's existence can leave a selection pointing at
  // something that is now gone. Same shape as `handleSwitchProject`'s own
  // repair. Playback position is not undoable either (owner ruling: undo
  // during playback KEEPS PLAYING — the playhead is not history); it is only
  // clamped into the restored timeline's bounds. Body moved to
  // `historySession.ts`'s `applyRestoredStateImpl` (App.tsx debt cleanup,
  // second attempt, 2026-08-08) — characterized in `historySession.test.ts`
  // before this call-in existed.
  const applyRestoredState = useCallback((restored: Project, what: string): void => {
    applyRestoredStateImpl(restored, what, {
      setProjectSilent,
      setSelectedSegmentId,
      setSelectedHeadingId,
      setSelectedSegmentIds,
      setCurrentTime,
    });
  }, [setProjectSilent]);

  /**
   * LOCK CONFLICT — blocks a traversal that would move a locked segment (owner
   * ruling, design §5.1). Returns true when blocked.
   *
   * History is left completely untouched, so the entry is NOT consumed: pressing
   * undo again after unlocking performs it normally. The alternative the design
   * doc rejects — restore everything except the locked segment — is not buildable;
   * see `historyLockPolicy.ts`'s header for why (it breaks the gapless invariant
   * by construction under snapshots, and produces a state the pipeline never
   * produced under patches).
   */
  const blockedByLock = useCallback((target: Project): boolean => {
    return isBlockedByLock(target, { liveProjectRef, setHistoryAnchor, showToast, setProjectSilent });
  }, [showToast, setProjectSilent]);

  const handleUndo = useCallback((): void => {
    performUndo({ isResizingRef, history, liveProjectRef, blockedByLock, setHistory, applyRestoredState, setHistoryAnchor });
  }, [history, applyRestoredState, blockedByLock]);

  const handleRedo = useCallback((): void => {
    performRedo({ isResizingRef, history, liveProjectRef, blockedByLock, setHistory, applyRestoredState, setHistoryAnchor });
  }, [history, applyRestoredState, blockedByLock]);

  const undoLabel = peekUndo(history)?.label;
  const redoLabel = peekRedo(history)?.label;
  const undoAvailable = canUndo(history);
  const redoAvailable = canRedo(history);

  // The global keydown effect below keeps its deliberately-empty dep array (a
  // stale-closure trap this file has been bitten by before — see the togglePlay
  // note in CLAUDE.md), so the shortcut branch reaches the live handlers and the
  // live suppression condition through refs rather than through its closure.
  const handleUndoRef = useRef(handleUndo);
  const handleRedoRef = useRef(handleRedo);
  handleUndoRef.current = handleUndo;
  handleRedoRef.current = handleRedo;

  // WS2 T2.1 Commit 4 — S/D (split/delete) read the CURRENTLY selected
  // segment and playhead time through refs for the same reason as
  // handleUndoRef/handleRedoRef above: the global keydown effect's dep array
  // is deliberately empty.
  const selectedSegmentIdRef = useRef(selectedSegmentId);
  selectedSegmentIdRef.current = selectedSegmentId;
  const currentTimeRef = useRef(currentTime);
  currentTimeRef.current = currentTime;

  // WS2 session ws2-23 (bug 4) — S/D were gated on `selectedSegmentId` ALONE,
  // documented as "a click on a clip is what sets selectedSegmentId". That is
  // not true of Timeline.tsx: a clip's `onClick` only seeks; `onSelectSegment`
  // fires on DOUBLE-click. So the natural gesture (click a clip, press S)
  // never armed either key — verified live, 173 corpus, S/D no-ops after a
  // single click. The playhead segment is the fallback target: clicking a clip
  // seeks to its start, which makes it `currentSegment` and paints it with the
  // existing orange active-clip border, so the affordance is already visible
  // and needs no new state or chrome. Selection still wins when present, so
  // nothing about the previous behaviour changes — this only adds a target
  // where there was none.
  const playheadSegmentIdRef = useRef<string | null>(null);
  const resolveShortcutTargetSegmentId = (): string | null =>
    selectedSegmentIdRef.current ?? playheadSegmentIdRef.current;

  // App-level shortcuts (reload / devtools, 2026-08-08). Same ref pattern and
  // the same reason: the keydown effect below keeps its empty dep array.
  const isExportingRef = useRef(false);


  // Path B Phase 5 — left-panel heading row click: open the drawer's heading
  // editor AND jump the preview to the heading's time, mirroring handleSegmentClick.
  const handleHeadingClick = useCallback((id: string): void => {
    setSelectedHeadingId(id);
    setSelectedSegmentId(null);
    const heading = (projectRef.current.headings ?? []).find(h => h.id === id);
    if (heading) {
      setCurrentTime(heading.time);
      if (audioRef.current) audioRef.current.currentTime = heading.time;
    }
  }, []);

  // Batch selection (Effects tab) — checkbox toggle / select-all / clear.
  // Independent of selectedSegmentId; never affects the drawer or seek.
  const onToggleSegmentSelect = useCallback((id: string): void => {
    setSelectedSegmentIds(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }, []);

  const onSelectAllSegments = useCallback((): void => {
    setSelectedSegmentIds(new Set(project.segments.map(s => s.id)));
  }, [project.segments]);

  const onClearSegmentSelection = useCallback((): void => {
    setSelectedSegmentIds(new Set());
  }, []);

  const handleApplyEffect = useCallback((e: ApplyEvent): void => {
    setProject(p => {
      const segments = p.segments.map(s => {
        switch (e.type) {
          case 'transition':
            if (e.scope === 'selected' && !selectedSegmentIds.has(s.id)) return s;
            // Reset the legacy field so a stale segment.transition (e.g. from
            // "Override all per-segment transitions") can never override an
            // explicit slug choice here — including Hard Cut, which the
            // resolver otherwise treats as "no slug chosen" and falls back
            // to this same legacy field.
            return { ...s, effectTransition: e.value, effectTransitionDuration: e.duration, transition: TransitionType.NONE };
          case 'animation':
            if (e.scope === 'selected' && !selectedSegmentIds.has(s.id)) return s;
            // Reset the legacy twin so a stale segment.animation can't compete
            // with the slug the renderer now reads (effectAnimation wins).
            // The chosen zoom rate is capped PER SEGMENT so a long segment can't
            // be driven past MAX_PEAK_SCALE (apply-to-all across mixed lengths).
            // effectAnimationDuration is left untouched (legacy field).
            return {
              ...s,
              effectAnimation: e.value,
              effectAnimationScaleRate: capRateForDuration(e.scaleRate, s.duration),
              animation: AnimationType.NONE,
            };
          case 'overlay':
            if (e.scope === 'selected' && !selectedSegmentIds.has(s.id)) return s;
            // Reset the legacy twin (segment.overlayFilter) for the same reason.
            return { ...s, effectOverlay: e.value, overlayFilter: 'none' };
          case 'grade':
            if (e.scope === 'selected' && !selectedSegmentIds.has(s.id)) return s;
            // New feature area — no legacy CSS/Canvas2D grade field to reset;
            // deriveCompositeParams reads effectGrade directly (Phase 4).
            return { ...s, effectGrade: e.value };
          case 'grade-clear':
            if (e.scope === 'selected' && !selectedSegmentIds.has(s.id)) return s;
            // Grade bug audit Fix C — the only path that actually removes an
            // applied grade. Sets effectGrade back to undefined (not a neutral
            // {0,0,0,0} object) so a cleared segment is indistinguishable from
            // one that was never graded.
            return { ...s, effectGrade: undefined };
          case 'randomize-transitions': {
            const slug = e.pool[Math.floor(Math.random() * e.pool.length)];
            // See the 'transition' case above — same legacy-field reset.
            return { ...s, effectTransition: slug, effectTransitionDuration: s.effectTransitionDuration, transition: TransitionType.NONE };
          }
          case 'randomize-animations': {
            const slug = e.pool[Math.floor(Math.random() * e.pool.length)];
            // See the 'animation' case above — same legacy-twin reset.
            return { ...s, effectAnimation: slug, effectAnimationDuration: s.effectAnimationDuration, animation: AnimationType.NONE };
          }
          case 'preset': {
            if (e.scope === 'selected' && !selectedSegmentIds.has(s.id)) return s;
            // See the 'transition' case above — same legacy-field reset, now
            // extended to the animation + overlay legacy twins.
            // A preset with a stored zoom rate writes it (capped to THIS
            // segment's duration); a preset without one (old preset / non-zoom
            // animation) leaves the segment's existing rate untouched.
            const presetRate = resolvePresetScaleRate(e.preset, s.duration);
            return {
              ...s,
              effectTransition: e.preset.transition,
              effectTransitionDuration: e.preset.transitionDur,
              effectAnimation: e.preset.animation,
              effectAnimationDuration: e.preset.animationDur,
              ...(presetRate !== undefined ? { effectAnimationScaleRate: presetRate } : {}),
              effectOverlay: e.preset.overlay,
              transition: TransitionType.NONE,
              animation: AnimationType.NONE,
              overlayFilter: 'none',
            };
          }
          default:
            return s;
        }
      });
      return { ...p, segments };
    });
  }, [selectedSegmentIds]);

  // WebGL2 Phase 4 — auto color-grade. PreviewStage owns the decode pool +
  // assets, so it populates this ref with the per-segment sampler; App drives
  // the scope selection + the write. Each target segment is sampled
  // sequentially (bounds decode-pool pressure — a one-shot, not a per-tick
  // path), computing its OWN grade from its OWN first frame, then all
  // successes are written in a single setProject. Segments with no analyzable
  // frame are counted as failures and reported back to the Auto button's flash,
  // never silently skipped. Writes effectGrade exactly like the manual
  // { type: 'grade' } apply path.
  const autoGradeSamplerRef = useRef<AutoGradeSampler | null>(null);
  const handleAutoGrade = useCallback(async (scope: ApplyScope): Promise<AutoGradeResult> => {
    const sampler = autoGradeSamplerRef.current;
    const targets = project.segments.filter(s => scope === 'all' || selectedSegmentIds.has(s.id));
    if (!sampler || targets.length === 0) return { applied: 0, failed: targets.length };

    const results = new Map<string, SegmentGrade>();
    let failed = 0;
    for (const seg of targets) {
      const grade = await sampler(seg).catch(() => null);
      if (grade) results.set(seg.id, grade);
      else failed++;
    }

    if (results.size > 0) {
      setProject(p => ({
        ...p,
        segments: p.segments.map(s => (results.has(s.id) ? { ...s, effectGrade: results.get(s.id)! } : s)),
      }));
    }
    return { applied: results.size, failed };
  }, [project.segments, selectedSegmentIds]);

  const handleUnlockAll = useCallback((): void => {
    // SILENT — see handleToggleLock: locks are not undoable.
    setProjectSilent(prev => ({
      ...prev,
      segments: prev.segments.map(s => ({ ...s, locked: false })),
    }));
  }, []);

  /**
   * Path B Phase 5 (docs/history.md ("Path B — Separate Heading Layer — Design Decisions", archived), Decision 3) — creates a
   * top-level HeadingOverlay at the boundary timestamp between the two
   * segments the "+ Add Heading" affordance was hovering (time = the
   * following segment's startTime, or the end of the last segment if
   * inserting after it). No segment is inserted and no neighbor duration is
   * stolen — overlays own no timeline seconds, so `segments` is untouched.
   */
  const handleInsertHeading = useCallback((afterIndex: number): void => {
    setProject(prev => {
      const gapIndex = afterIndex + 1; // -1 → 0 (prepend); i → i+1 (after segment i)
      const boundaryTime = boundaryTimeForGap(prev.segments, gapIndex);
      // Corrective fix: center the heading on the boundary (50/50 split into
      // both neighbors) instead of starting exactly at it (0/100 split).
      const time = centerHeadingOnBoundary(boundaryTime, DEFAULT_HEADING_DURATION);
      const headings = prev.headings ?? [];
      const defaultText = `Heading ${headings.length + 1}`;
      const heading = createHeading(time, { text: defaultText });
      return { ...prev, headings: [...headings, heading] };
    });
  }, []);

  /** Path B Phase 5 — removes a HeadingOverlay by id. No duration give-back:
   *  overlays never stole timeline seconds from neighbors in the first place. */
  const handleDeleteHeading = useCallback((headingId: string): void => {
    setProject(prev => ({
      ...prev,
      headings: (prev.headings ?? []).filter(h => h.id !== headingId),
    }));
  }, []);

  /** Path B Phase 5 — retimes a HeadingOverlay directly (`time` update), not
   *  an array reorder: headings have no position in `segments` to move. */
  const handleMoveHeading = useCallback((headingId: string, newTime: number): void => {
    setProject(prev => ({
      ...prev,
      headings: (prev.headings ?? []).map(h =>
        h.id === headingId ? { ...h, time: Math.max(0, newTime) } : h
      ),
    }));
  }, []);

  /** Path B Phase 5 — writes styling/text updates onto a HeadingOverlay by id
   *  (BottomDrawer / ReviewMappingModal heading editors). */
  const handleUpdateHeading = useCallback((headingId: string, updates: Partial<HeadingOverlay>): void => {
    setProject(prev => ({
      ...prev,
      headings: (prev.headings ?? []).map(h => h.id === headingId ? { ...h, ...updates } : h),
    }));
  }, []);

  const handleAddTextLayer = useCallback((): void => {
    setProject(prev => ({
      ...prev,
      textLayers: [
        ...(prev.textLayers ?? []),
        {
          id: crypto.randomUUID(),
          text: 'New Text',
          color: '#FFFFFF',
          backgroundColor: 'transparent',
          fontFamily: 'Inter',
          fontSize: 32,
          position: { x: 50, y: 50 },
        } satisfies TextOverlay,
      ],
    }));
  }, []);

  const handleUpdateTextLayer = useCallback((id: string, updates: Partial<TextOverlay>): void => {
    setProject(prev => ({
      ...prev,
      textLayers: (prev.textLayers ?? []).map(l => l.id === id ? { ...l, ...updates } : l),
    }));
  }, []);

  const handleDeleteTextLayer = useCallback((id: string): void => {
    setProject(prev => ({
      ...prev,
      textLayers: (prev.textLayers ?? []).filter(l => l.id !== id),
    }));
  }, []);

  const handleToggleTextLayerOnSegment = useCallback((layerId: string, segmentId: string): void => {
    setProject(prev => ({
      ...prev,
      textLayers: (prev.textLayers ?? []).map(l => {
        if (l.id !== layerId) return l;
        const hidden = l.hiddenOnSegments ?? [];
        return {
          ...l,
          hiddenOnSegments: hidden.includes(segmentId)
            ? hidden.filter(s => s !== segmentId)
            : [...hidden, segmentId],
        };
      }),
    }));
  }, []);

  // Validation report
  const validationReport = useMemo(() => {
    const lines = project.script.split('\n');
    const requiredAssets = lines
      .map(l => l.match(/\[(?:IMAGE|VIDEO):\s*(.*?)\s*\]/)?.[1])
      .filter((n): n is string => !!n);
    
    const uniqueRequired: string[] = Array.from(new Set(requiredAssets));
    const missing = uniqueRequired.filter(name => {
      const cleanName = name.trim().toLowerCase();
      return !project.assets.find(a => {
        const assetName = a.name.trim().toLowerCase();
        return assetName === cleanName || assetName.split('.')[0] === cleanName;
      });
    });

    return {
      total: uniqueRequired.length,
      missing,
      hasVoiceover: !!project.voiceoverId,
      ready: missing.length === 0 && !!project.voiceoverId
    };
  }, [project.script, project.assets, project.voiceoverId]);

  /** '720p' | '1080p' */
  const [exportResolution, setExportResolution] = useState<ExportResolution>('1080p');
  /** frames per second */
  const [exportFps, setExportFps] = useState<ExportFps>(30);
  // True once the user has manually picked a value in the Frame Rate dropdown —
  // after that the source-fps auto-match effect below must never override it.
  const exportFpsUserSetRef = useRef(false);
  // True when staged video assets' native fps disagree — auto-match is skipped
  // (no per-segment retiming) and the UI surfaces this as an open edge case.
  const [mixedNativeFpsWarning, setMixedNativeFpsWarning] = useState(false);
  const previewRef = useRef<HTMLDivElement>(null);

  const onExportSavePath = useCallback((path: string) => {
    setProject(p => ({ ...p, lastExportPath: path }));
  }, []);
  const exportApi = useExport(project, exportResolution, exportFps, onExportSavePath);
  const { state: exportState, startExport, cancelExport, retryExport, dismissSuccess } = exportApi;

  // ExportSettingsModal's Continue commits exportResolution/exportFps via
  // setState, then must call startExport — but startExport is a useCallback
  // closed over the OLD exportResolution/exportFps until the next render, so
  // calling it synchronously in the same handler would export with stale
  // values. exportTriggerCount forces a render to land first; this effect
  // fires only on that render (never on resolution/fps changes coming from
  // elsewhere, e.g. the native-fps auto-match effect below) and reads the
  // freshly-closed-over startExport from that same render.
  const [exportTriggerCount, setExportTriggerCount] = useState(0);
  useEffect(() => {
    if (exportTriggerCount === 0) return;
    startExport();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [exportTriggerCount]);

  // Exported-video judder audit — auto-suggest exportFps from staged video
  // assets' probed native frame rate when they all agree, instead of always
  // defaulting to 30fps regardless of source content. Mixed native fps across
  // assets is flagged for the user rather than guessed at; per-segment
  // retiming is out of scope (segmentEncoder.ts/plainSegment.ts untouched).
  useEffect(() => {
    const nativeFpsValues = project.assets
      .filter(a => a.type === 'video' && a.nativeFps !== undefined)
      .map(a => nearestExportFps(a.nativeFps!));

    if (nativeFpsValues.length === 0) {
      setMixedNativeFpsWarning(false);
      return;
    }

    const matched = nativeFpsValues[0]!;
    const allMatch = nativeFpsValues.every(v => v === matched);
    setMixedNativeFpsWarning(!allMatch);

    if (allMatch && !exportFpsUserSetRef.current) {
      setExportFps(prev => (prev === matched ? prev : matched));
    }
  }, [project.assets]);

  const { transcriptionStatus, startTranscription, cancelTranscription, dismissError, alignFromCache } = useWhisper();

  // --------------------------------------------------------------------------
  // Option C — staging-time transcription trigger. Fires the moment a
  // voiceover file lands in the FILES-tab slot, independent of Apply Sync.
  // Mints an in-memory Asset (no IndexedDB write yet) so Whisper has
  // something to fetch; project.assets/voiceoverId stay untouched until
  // handleApplySyncFromFiles commits. onSegmentsUpdated is a no-op — this
  // call is cache-only, it never mutates live segments (only Apply Sync does).
  // --------------------------------------------------------------------------
  const handleVoiceoverStaged = useCallback((file: File) => {
    if (!isTauri()) return;

    const incomingIdentity = getFileIdentity(file);

    // No-op: this exact file is already the pending one (its transcription is
    // either in-flight or just finished) from an earlier stage event in this
    // session. Don't cancel/restart an in-flight job or mint a redundant
    // asset + blob URL for a file we're already tracking.
    const previous = pendingVoiceoverRef.current;
    if (previous && getFileIdentity(previous.file) === incomingIdentity) {
      return;
    }

    if (previous) {
      cancelTranscription();
      URL.revokeObjectURL(previous.asset.url);
    }

    const asset: Asset = {
      id: crypto.randomUUID(),
      name: file.name,
      url: URL.createObjectURL(file),
      type: 'audio',
      file,
      addedAt: Date.now(),
    };
    setPendingVoiceoverSync({ file, asset });

    // Same-file detection: this exact file was already transcribed and its
    // tokens are still cached — skip the Whisper run entirely. Apply Sync
    // stays enabled via the lastTranscribedFileIdentity clause below.
    const cachedTokensExist = (projectRef.current.transcriptTokens?.length ?? 0) > 0;
    if (projectRef.current.lastTranscribedFileIdentity === incomingIdentity && cachedTokensExist) {
      // The asset above just minted a BRAND NEW ephemeral id — startTranscription
      // (which normally moves lastTranscribedAssetId forward) never runs on this
      // path, so without this, lastTranscribedAssetId is left pointing at the OLD
      // asset id forever. Once this new asset is committed by Apply Sync,
      // transcriptionReady's id comparisons can never match again, and the button
      // gets stuck disabled with no event left that could re-enable it.
      setProject(p => ({ ...p, lastTranscribedAssetId: asset.id }));
      return;
    }

    // Genuinely different file (neither guard above fired): clear the stale
    // cached transcript so Apply Sync's gating (applySyncDisabled /
    // cachedTokensReady) can't mistake leftover tokens — transcribed against
    // the PREVIOUS audio — for "ready" against this one. This forces
    // re-transcription before Apply Sync re-enables.
    // (anchorSource demotion removed in 3e: nothing branches on anchorSource
    // post-clean-slate, and the next sync rebuilds segments from scratch via
    // parseProjectData anyway, so demoting the outgoing segments was dead work.)
    setProject(p => ({
      ...p,
      transcriptTokens: undefined,
    }));

    void (async () => {
      let duration: number;
      try {
        duration = await resolveVoiceoverDuration(asset);
      } catch (err) {
        // Ownership recheck first — don't surface an error for a file the user
        // already moved past while the probe was running.
        if (pendingVoiceoverRef.current?.asset.id !== asset.id) return;
        console.error('[voiceover] duration probe failed:', err);
        showToast("Couldn't read that audio file — try a different file or format.");
        return;
      }
      // Entry-ordering recheck: the probe's resolution order isn't tied to
      // staging order, so by the time this resolves a later stage event may
      // have already superseded this file. Don't start a transcription for a
      // file the user has since moved past.
      if (pendingVoiceoverRef.current?.asset.id !== asset.id) return;
      transcriptionTargetIdRef.current = asset.id;
      startTranscription(
        asset,
        duration,
        [],
        projectRef.current.language,
        () => {},
        (updater) => {
          // Commit-time ownership guard: only write back if `asset` (the file
          // THIS call started transcribing) is still the current pending
          // voiceover. A job that loses ownership after starting (a newer
          // file gets staged mid-transcription) must not resurrect stale
          // tokens/identity/phase for a file the user has moved past.
          if (pendingVoiceoverRef.current?.asset.id !== asset.id) return;
          setProject(updater);
        },
      );
    })();
  }, [cancelTranscription, startTranscription, showToast]);

  // Cancels an in-flight staging-time transcription and discards the
  // ephemeral asset — used when the user removes or replaces a staged
  // voiceover before ever clicking Apply Sync.
  const handleVoiceoverUnstaged = useCallback(() => {
    const pending = pendingVoiceoverRef.current;
    if (!pending) return;
    cancelTranscription();
    URL.revokeObjectURL(pending.asset.url);
    setPendingVoiceoverSync(null);
  }, [cancelTranscription, setPendingVoiceoverSync]);

  // --------------------------------------------------------------------------
  // Atomic Apply Sync handler — persists ALL staged files, then runs sync in
  // a single setProject call so finalizeSync never reads stale state.
  // --------------------------------------------------------------------------
  const handleApplySyncFromFiles = async (staged: StagedFiles): Promise<void> => {
    syncMark('applySync:entry', { reset: true });
    setIsProcessing(true);

    // WS-logs — one id for every entry this run emits, plus one timestamp so a
    // run's entries sort together rather than smearing across the ms boundary
    // of a long sync. Minted before the first await so it's stable end-to-end.
    const syncRunId = mintSyncLogId();
    const syncRunAt = Date.now();

    /** Records an aborted run (entry + summary) and persists it. The abort
     *  paths below return before the segment commit, so this is the ONLY
     *  setProject they make — segments/assets are deliberately untouched. */
    const logSyncAbort = (message: string, totalSegments: number): void => {
      setProject(prev => appendSyncLogEntries(
        prev,
        [buildSyncAbortEntry(syncRunId, message, syncRunAt)],
        {
          syncRunId,
          timestamp: syncRunAt,
          totalSegments,
          coveredSegments: 0,
          skippedSegments: 0,
          aborted: true,
          abortReason: message,
        },
      ));
    };

    // 1. Read text files — strip RTF markup if the file is an .rtf document
    const scriptText = staged.scriptFile
      ? stripRtfIfNeeded(await staged.scriptFile.file.text())
      : projectRef.current.script;
    const sceneText = staged.sceneFile
      ? stripRtfIfNeeded(await staged.sceneFile.file.text())
      : projectRef.current.sceneDetails;

    // 2. Persist media files without touching React state.
    //    allAssets starts with existing assets so dedup checks are against the
    //    full accumulated list (prevents duplicating on re-upload or re-sync).
    const allAssets: Asset[] = [...projectRef.current.assets];
    let newVoiceoverId = projectRef.current.voiceoverId;
    // Snapshot of pre-sync segments, used by preserveEffectFields below to carry
    // forward per-segment effect selections by assetId. Captured now, before any
    // await, so it can't observe state this same sync has already committed.
    const previousSegments = projectRef.current.segments;

    if (staged.voiceoverFile) {
      const pending = pendingVoiceoverRef.current;
      const reusingPending = pending !== null && pending.file === staged.voiceoverFile.file;
      const asset = reusingPending
        ? await persistPendingVoiceoverAsset(projectRef.current.id, pending!.asset)
        : await persistFileToAsset(projectRef.current.id, staged.voiceoverFile.file, 'audio');
      if (asset) {
        // Drop any previously-committed voiceover asset so it doesn't linger as
        // an orphaned duplicate in project.assets — the name-based dedup this
        // replaced was matching staged.voiceoverFile.file.name against ALL
        // assets, which skipped this whole block (and silently kept the OLD
        // voiceoverId) whenever a re-staged file happened to share a name with
        // an already-committed asset.
        const oldIdx = allAssets.findIndex(a => a.id === projectRef.current.voiceoverId);
        const oldAsset = allAssets[oldIdx];
        if (oldAsset) {
          allAssets.splice(oldIdx, 1);
          URL.revokeObjectURL(oldAsset.url);
          deleteAsset(projectRef.current.id, oldAsset.id).catch(err =>
            console.error('[kinetix] Failed to delete old voiceover from IndexedDB:', err),
          );
          deletePersistedWaveform(projectRef.current.id, oldAsset.id).catch(err =>
            console.error('[kinetix] Failed to delete old voiceover peaks:', err),
          );
        }
        allAssets.push(asset);
        newVoiceoverId = asset.id;
        // The ephemeral asset is now a real, committed one — forget the
        // pending reference without revoking its (now in-use) blob URL.
        if (reusingPending) setPendingVoiceoverSync(null);
      }
    }
    for (const sf of staged.assetFiles) {
      if (allAssets.some(a => a.name === sf.file.name)) continue;
      const ext = sf.file.name.split('.').pop()?.toLowerCase() ?? '';
      const type: Asset['type'] = ['mp4', 'mov', 'webm', 'm4v'].includes(ext) ? 'video' : 'image';
      const asset = await persistFileToAsset(projectRef.current.id, sf.file, type);
      if (asset) allAssets.push(asset);
    }
    for (const sf of staged.zipFiles) {
      const extracted = await extractZipToAssets(projectRef.current.id, sf.file);
      for (const asset of extracted) {
        if (allAssets.some(a => a.name === asset.name)) {
          URL.revokeObjectURL(asset.url); // won't be used — clean up
          continue;
        }
        allAssets.push(asset);
        if (asset.type === 'audio') newVoiceoverId = asset.id;
      }
    }

    // 3. Get audio duration from the voiceover asset we just created (or existing)
    const voiceoverAsset = allAssets.find(a => a.id === newVoiceoverId);
    let audioDuration = audioRef.current?.duration || 0;
    if (voiceoverAsset && (!audioRef.current || audioRef.current.src !== voiceoverAsset.url)) {
      try {
        audioDuration = await resolveVoiceoverDuration(voiceoverAsset);
      } catch (err) {
        // No fake-duration fallback (the old code silently used 60 s). Abort the
        // sync and tell the user rather than proportioning every segment wrong.
        console.error('[sync] voiceover duration probe failed:', err);
        const msg = "Couldn't read the voiceover's duration — sync aborted. Try re-adding the audio file.";
        showToast(msg);
        // totalSegments is 0 here by necessity — the scene doc hasn't been
        // parsed yet at this point in the sequence.
        logSyncAbort(msg, 0);
        setIsProcessing(false);
        return;
      }
    }

    // 5. Parse project data with the fresh, complete data
    syncMark('assets+duration:done');
    const newSegmentsRaw = await parseProjectData(scriptText, sceneText, allAssets, audioDuration, previousSegments);
    syncMark('parseProjectData:done');

    // WS1b — empty scene-doc hard abort (doc §3.4/§3.11, S15). Always aborts
    // on zero parsed segments now, not only when previous segments existed —
    // the fresh-project case used to fall through silently.
    const sceneDocAbortMsg = emptySceneDocAbortMessage(newSegmentsRaw.length);
    if (sceneDocAbortMsg) {
      console.warn('[sync] parseProjectData returned 0 segments — aborting sync');
      showToast(sceneDocAbortMsg);
      logSyncAbort(sceneDocAbortMsg, newSegmentsRaw.length);
      setIsProcessing(false);
      return;
    }

    // 7. Option C — resolve final timing BEFORE the commit, never after.
    //    If Whisper tokens are already cached for this exact voiceover (the
    //    normal case: Apply Sync is gated until staging-time transcription
    //    reaches 'done'), align inline so the very first commit is already
    //    ms-perfect. No character-based timing ever reaches the screen.
    const cachedTokensReady = !!voiceoverAsset
      && (projectRef.current.lastTranscribedAssetId === voiceoverAsset.id
          || (!!voiceoverAsset.file
              && projectRef.current.lastTranscribedFileIdentity === getFileIdentity(voiceoverAsset.file)))
      && (projectRef.current.transcriptTokens?.length ?? 0) > 0;

    // WS1b — empty transcript hard abort (doc §3.4/§3.11, S15): a voiceover
    // was staged for this sync but Whisper produced zero tokens (silent or
    // corrupted audio) — abort rather than silently falling back to
    // character-based timing for a sync that was supposed to be audio-driven.
    const transcriptAbortMsg = emptyTranscriptAbortMessage(
      !!voiceoverAsset,
      projectRef.current.transcriptTokens?.length ?? 0,
    );
    if (transcriptAbortMsg) {
      showToast(transcriptAbortMsg);
      logSyncAbort(transcriptAbortMsg, newSegmentsRaw.length);
      setIsProcessing(false);
      return;
    }

    let finalTimedSegments: VideoSegment[];
    // WS1 Task 5, docs/work-in-progress.md §11 item 1 — set only when the FA
    // capability gate was open AND forced alignment actually succeeded this
    // run; persisted verbatim onto `Project.faWordTimings` by the single
    // commit below (schema: types.ts's `faWordTimings?: TranscriptToken[]`).
    // Stays undefined on every gate-off run — a project synced with the gate
    // off never gains this field, matching every pre-FA project's shape.
    let faWordTimingsResult: TranscriptToken[] | undefined;
    // Boundary-quality checker (waveform-watcher program, Phase 1) — captured
    // only on the cachedTokensReady/Whisper-snapped branch below, since only
    // that branch has real per-segment token alignments to check a fallback
    // boundary against. Consumed by the post-hoc pass after
    // buildVoiceoverWaveform resolves, further down this function — index-
    // parallel with finalTimedSegments/committedSegments the whole way
    // (autoMatchSegments/preserveEffectFields/headExtendFirstSegment all
    // preserve segment order and count).
    let pendingBoundaryCheckInput: {
      alignments: SegmentAlignment[];
      tokens: TranscriptToken[];
      silences: SilenceInterval[];
    } | null = null;
    // WS-logs — staged by whichever timing branch runs, committed by the single
    // setProject below. Every branch that reaches the commit sets both, so a
    // committed run always leaves exactly one summary behind.
    let pendingLogEntries: SyncLogEntry[] = [];
    let pendingLogSummary: SyncRunSummary | undefined;
    // Layer 2 permanent detector (WS2 Step 5, Bug 1) — `keptAlignments` only
    // exists inside the audio-timed branch below (the character-based-timing
    // fallback branch has no coverage data at all, hence no rescue and
    // nothing to check); staged here, like `pendingLogEntries` above, so the
    // single commit point downstream can read it regardless of which branch
    // ran. Empty in the fallback branch — correctly reports zero violations,
    // since a violation is only possible when a rescue was involved.
    let residualCheckAlignments: SegmentAlignment[] = [];
    // WS1 Session J — rule-firing / engine / FA-fallback entries, staged
    // SEPARATELY from `pendingLogEntries` for one structural reason: the
    // audio-timed branch below ASSIGNS `pendingLogEntries` wholesale partway
    // through (after the skip filter), while rules fire both before that point
    // (FA fallback, R.5, R.10) and after it (R.11, R.12). Pushing into
    // `pendingLogEntries` at the earlier sites would have them silently
    // overwritten by that assignment — a bug that would have shown up as
    // "R.10 never logs", i.e. exactly the kind of quiet hole this work exists
    // to close. Spliced in as a block once every rule has run.
    const ruleLogEntries: SyncLogEntry[] = [];
    // R.5's log entries are built late (they need the committed array) but must
    // appear at their pipeline-order position — see the R.5 block below.
    let stagedUnscriptedRuns: readonly UnscriptedRun[] = [];
    let unscriptedRunLogInsertAt = 0;
    if (cachedTokensReady) {
      const anchorTimed = applyAnchorBasedTiming(newSegmentsRaw, audioDuration);

      // WS1 Task 5 — production forced-alignment wiring (docs/work-in-
      // progress.md §11 item 1). The gate is PER PROJECT as of WS1 Session G
      // (`isFaGateOpenForProject(project)` = `isCapable() &&
      // isFaEnabledForProject(project)`, faGate.ts). Made PER PROJECT and
      // defaulted ON by owner ruling R-AK (WS1 Session G); the resolved
      // default for a project expressing no preference was flipped back to
      // OFF by WS1 Session H, value-only (`faGate.ts`'s
      // `FA_PROJECT_DEFAULT_ON` doc comment has the exact flip-back
      // condition) — when the gate is off, `faTokens` stays null and this
      // whole branch is a no-op, so
      // behavior is byte-identical to before this branch existed. When the
      // gate is on, `runForcedAlignmentForSync` fails CLEAN on any error (no
      // model present, hash mismatch, inference error, unsupported language,
      // empty chunk plan) — it returns null rather than throwing, so a
      // failed FA attempt always falls through to the cached Whisper tokens
      // below, never aborts the sync and never half-applies timing.
      //
      // Read off `projectRef.current`, the same snapshot every other input in
      // this branch comes from — never off the module-global it replaced, so
      // two projects open in two windows can disagree.
      const faGateOpen = isFaGateOpenForProject(projectRef.current);
      // WS1 Session M — FA readiness PRE-FLIGHT, before inference. When the gate
      // is open, report up front whether forced alignment can actually run
      // (runtime library load, model presence, resolved language) so a run that
      // is going to fall back is visible as such BEFORE the multi-minute sync,
      // not only after. Purely observational: it never changes whether FA is
      // attempted — `runForcedAlignmentForSync` stays the single fail-clean
      // authority on what actually happened.
      if (faGateOpen) {
        const preflight = await runFaPreflight(projectRef.current);
        ruleLogEntries.push(buildFaPreflightEntry(syncRunId, preflight, syncRunAt));
      } else if (isFaCapable()) {
        // WS2 Step 3 A5 (bug 2 visibility fix) — the gate being closed used to
        // produce NO Sync Log signal at all (this whole block was skipped).
        // FA_PROJECT_DEFAULT_ON stays false (WS1 Session H); this only makes
        // the closed-gate state visible instead of silent. Skipped when not
        // FA-capable (plain browser dev server) — there is nothing to turn on.
        ruleLogEntries.push(buildFaGateClosedEntry(syncRunId, syncRunAt));
      }
      const faRun = faGateOpen
        ? await runForcedAlignmentForSync(
            voiceoverAsset!,
            anchorTimed,
            projectRef.current.transcriptTokens!,
            audioDuration,
            // WS1 Session M — resolve the FA language durably: the sticky
            // `language` when set, else Whisper's own `-l auto` detection. The
            // auto path used to pass `projectRef.current.language` alone, which
            // could be undefined even after a correct detection, sending the run
            // to an 'unsupported-language' fallback the pre-flight now catches
            // first.
            resolveFaLanguage(projectRef.current),
          )
        : null;
      const faTokens = faRun?.status === 'ok' ? faRun.tokens : null;
      // WS1 Session J — the FA fallback, made durable. `runForcedAlignment
      // ForSync` is fail-clean by contract and stays so; this only records
      // WHICH failure path fired, and only when the gate was open (a
      // gate-closed run never attempted FA and owes no fallback entry — the
      // engine entry below already says it ran on Whisper).
      if (faRun?.status === 'fallback') {
        ruleLogEntries.push(buildFaFallbackEntry(syncRunId, faRun.reason, faRun.detail, syncRunAt));
      }
      // A silence-detection failure INSIDE the FA pass is distinct from
      // `aligned.silenceError` below: it degraded the CHUNK PLAN (built
      // against zero silences) rather than the boundary snap, and was
      // console-only until now.
      if (faRun?.status === 'ok' && faRun.silenceError !== undefined) {
        ruleLogEntries.push(buildSilenceErrorEntry(syncRunId, faRun.silenceError, syncRunAt));
      }
      // R-G: 'forced-alignment' > 'whisper' > 'estimate', demote-only —
      // stated explicitly by this branch (the code path that actually
      // produced `faTokens`), never inferred downstream.
      const anchorSourceForRun: 'whisper' | 'forced-alignment' = faTokens ? 'forced-alignment' : 'whisper';
      if (faTokens) faWordTimingsResult = faTokens;
      // WHICH ENGINE RAN — unconditional, so its absence is never ambiguous.
      ruleLogEntries.push(buildSyncEngineEntry(
        syncRunId,
        anchorSourceForRun,
        faTokens ? faTokens.length : projectRef.current.transcriptTokens!.length,
        syncRunAt,
      ));
      // R.5 — the excisions this run's chunk plan actually made, surfaced by
      // `runForcedAlignmentForSync` from the same `computeRunContext` pass
      // that built the plan. R.5 fires before inference, so this is the only
      // point at which its work is observable at all.
      //
      // WS1 Session K: the ENTRIES are built at the end of the branch, not
      // here, because their owning-scene lookup must run over the FINAL
      // COMMITTED array (`anchorTimed`'s timings are pre-snap estimates and its
      // indices are the parse space). The runs are staged now and spliced back
      // into this exact position below, so the documented R.5 -> R.10 -> R.11
      // -> R.12 -> R.13 log order is unchanged.
      if (faRun?.status === 'ok' && faRun.unscriptedRuns.length > 0) {
        stagedUnscriptedRuns = faRun.unscriptedRuns;
        unscriptedRunLogInsertAt = ruleLogEntries.length;
      }

      const aligned = await alignFromCache(
        voiceoverAsset!,
        anchorTimed,
        faTokens ?? projectRef.current.transcriptTokens!,
        audioDuration,
        anchorSourceForRun,
      );

      // WS1b — bidirectional coverage metric (§3.3) + two-signal abort gate
      // (§3.4/R13), applied BEFORE the commit (doc §3.4(b): "immediately after
      // the alignFromCache call... before setProject"). Nothing is committed on
      // abort — the pre-sync project state is untouched (we return before
      // setProject). The gate's only remaining case is full mismatch (R4-3);
      // internal gaps are skipped below, not aborted (R4-1).
      const totalTranscriptWords = countTranscriptWords(projectRef.current.transcriptTokens!);

      const gate = evaluateCoverageGate(aligned.segments, aligned.coverage, totalTranscriptWords);

      if (gate.aborted) {
        console.warn('[sync] coverage gate aborted:', gate.message);
        showToast(gate.message);
        logSyncAbort(gate.message, aligned.segments.length);
        setIsProcessing(false);
        return;
      }

      // WS1 R.10 (faUnspokenGate.ts) — SCRIPTED TEXT NEVER SPOKEN. Forced
      // alignment has no drop path (a CTC objective must place every target
      // token somewhere), so an on-screen-only title or a planted, never-voiced
      // string gets carved out of whichever real speech sits next to it and
      // steals that speech's own onset. This gate refuses those segments and
      // hands them to the skip path below.
      //
      // Runs ONLY when FA actually produced the tokens — with the gate off,
      // `faTokens` is null and this is a no-op, so the default path is
      // byte-identical to before this existed. It also runs AFTER
      // `evaluateCoverageGate` on purpose: whether the audio corresponds to the
      // doc AT ALL is a judgement on the raw alignment, and must not be
      // influenced by a per-segment refusal.
      //
      // Its conjunct (1) is the WHISPER alignment's own `matched`, which is why
      // `projectRef.current.transcriptTokens` (not `aligned.tokens`, which are
      // the FA tokens on this branch) is what goes in.
      const unspokenScript = faTokens
        ? detectUnspokenScriptSegmentsFromWhisper(
            aligned.segments,
            projectRef.current.transcriptTokens!,
            faTokens,
            aligned.silences,
            audioDuration,
          )
        : [];
      const coverageAfterR10 = applyUnspokenScriptGate(aligned.coverage, unspokenScript);
      if (unspokenScript.length > 0) {
        console.warn(
          `[sync] R.10 — ${unspokenScript.length} scripted segment(s) never spoken, dropped:`,
          unspokenScript,
        );
        ruleLogEntries.push(...buildUnspokenScriptLogEntries(syncRunId, unspokenScript, syncRunAt));
      }

      // R4-1/R4-2 — skip unmatched. Only audio-covered segments reach the
      // timeline; the rest are dropped (no char-fallback, no interpolation) and
      // recorded for the sync log. Skipped segments leave real gaps: the audio
      // keeps playing as one continuous file, and no neighbour is stretched to
      // cover the hole.
      const { kept, skipped, keptAlignments } = filterToCoveredSegments(
        aligned.segments,
        coverageAfterR10,
        new Set(unspokenScript.map(f => f.segmentIndex)),
      );
      residualCheckAlignments = keptAlignments;

      if (import.meta.env.DEV && skipped.length > 0) {
        console.warn(
          `[sync] skipped ${skipped.length} uncovered segment(s) of ${aligned.segments.length}:`,
          skipped,
        );
      }

      // WS2 T2.1 (gap-absorption) — computed here (right after the filter
      // that produced `skipped`) rather than after the boundary snap below,
      // so the SAME map can feed both the sync-log entries (which need it
      // immediately, for the grouped skip message) and the later merge onto
      // `finalTimedSegments` — one computation, two consumers, never two
      // computations that could silently disagree.
      //
      // WORD SOURCE — `aligned.tokens`, NEVER `projectRef.current.transcriptTokens`.
      // `aligned.tokens` is `filterMalformedTokens(faTokens ?? transcriptTokens)`
      // (useWhisper.ts:107-108,139), so it is FA's word list on the FA arm and
      // Whisper's on the Whisper arm — the alignment engine's OWN words, matching
      // whichever arm produced the timings above. This is load-bearing, not
      // incidental: `keptAlignments[i].firstTokenIdx`/`lastTokenIdx` (what
      // `computeAbsorbedGaps` dereferences to build each span) are indices into
      // exactly this array, so substituting any other token array resolves to the
      // WRONG tokens and silently mis-measures every absorbed span. Locked by
      // `absorbedGaps.test.ts`'s "reads spans from the token array it is given"
      // suite and by `scripts/ws2-restore-corpus.test.ts`'s two-arm check.
      const absorbedGapsByHostId = computeAbsorbedGaps(
        aligned.segments, skipped, kept.map(s => s.id), keptAlignments, aligned.tokens, aligned.silences,
      );

      // Rescue observability (false-positive rescue fix, 2026-07-31) — every
      // coverage entry the per-segment temporal-bounding rescue recovered
      // (`recoveredVia` set only for an ACCEPTED claim — see AlignResult's
      // doc comment; a rejected claim leaves the segment genuinely
      // zero-matched, and shows up in `skipped` above instead) gets one
      // 'rescue' log entry below. Built from `coverageAfterR10`/
      // `aligned.segments` — the PRE-filter arrays, same indexing
      // `buildSkipLogEntries` uses — since a rescued segment is by
      // definition `matched: true` and therefore always in `kept`, but the
      // PRE-filter index is what the message displays (1-based).
      // R.10's gate clears `recoveredVia`/`recoveredRegion` on anything it
      // drops, so a segment cannot be reported as recovered and skipped in
      // the same run's log.
      const rescued: RescuedSegmentRecord[] = [];
      for (let i = 0; i < coverageAfterR10.length; i++) {
        const cov = coverageAfterR10[i];
        if (cov?.recoveredVia && cov.recoveredRegion) {
          rescued.push({
            segmentIndex: i,
            recoveredVia: cov.recoveredVia,
            recoveredRegion: cov.recoveredRegion,
            anchorStart: aligned.segments[i]?.anchorStart,
          });
        }
      }

      // WS2 T2.1 — resolve `absorbedGapsByHostId` (computed just above, right
      // after `filterToCoveredSegments`) back to each skip record's own
      // PRE-filter `segmentIndex`, for `buildSkipLogEntries` below.
      const absorbedInfoBySkipIndex = new Map<number, AbsorbedGapLogInfo>();
      for (const [hostId, gaps] of absorbedGapsByHostId) {
        const hostDisplayIndex = kept.findIndex(s => s.id === hostId);
        if (hostDisplayIndex < 0) continue;
        for (const gap of gaps) {
          const skipRecord = skipped.find(r => aligned.segments[r.segmentIndex]?.id === gap.segmentId);
          if (skipRecord) {
            absorbedInfoBySkipIndex.set(skipRecord.segmentIndex, {
              hostSegmentId: hostId, hostDisplayIndex, span: gap.span, gapAudio: gap.gapAudio,
              droppedSegmentId: gap.segmentId,
            });
          }
        }
      }

      // Word-coverage validator (Stage-4 output validation, Contract 3→4,
      // rule 'low-word-coverage', 2026-08-03) — a KEPT (survived, matched:
      // true) segment can still have matched only a minority of its own
      // words, the rest silently absorbed into a neighboring segment's span
      // (the segment 28 production case — see syncContracts.ts's own doc
      // comment). Runs on `kept`/`keptAlignments`, the same index-parallel
      // pair the boundary-quality checker's input capture below uses — text
      // content doesn't change across the boundary re-snap that follows, so
      // there's no need to wait for it. Grouped into ONE log entry when 2+
      // segments are flagged (log-grouping feature, 2026-08-03); a lone
      // flagged segment still gets a plain entry (buildGroupedViolationEntry's
      // own count===1 fallback).
      const wordCoverageViolations = validateWordCoverage(kept, keptAlignments);
      const wordCoverageEntry = buildGroupedViolationEntry(syncRunId, wordCoverageViolations, syncRunAt);

      // WS-logs (R4-4) — the skip records are no longer DEV-console-only: one
      // 'skip' entry per dropped scene. Bug 1 fix: a summary 'info' entry is now
      // emitted on EVERY successful run — alongside the skip entries, not
      // instead of them — so a run with 2 skips produces 3 entries (2 skip + 1
      // info). Staged into locals here and folded onto the project inside the
      // one atomic setProject below, so the log commits with the segments it
      // describes rather than in a second render.
      //
      // WS4 — two more entry kinds ride along on the same staging. Both describe
      // the RUN (not a scene), and both are emitted only when they actually
      // happened, so a clean sync's log is unchanged:
      //   'silence-error'   (Feature 3) silence detection failed; boundaries
      //                     degraded to token midpoints, sync continued
      //   'malformed-token' (Feature 4) tokens with unusable timestamps were
      //                     dropped before alignment
      pendingLogEntries = [
        ...(aligned.silenceError ? [buildSilenceErrorEntry(syncRunId, aligned.silenceError, syncRunAt)] : []),
        ...(aligned.malformedTokenCount > 0
          ? [buildMalformedTokenEntry(syncRunId, aligned.malformedTokenCount, aligned.totalTokenCount, syncRunAt)]
          : []),
        ...(skipped.length > 0 ? buildSkipLogEntries(syncRunId, skipped, syncRunAt, absorbedInfoBySkipIndex) : []),
        ...(rescued.length > 0 ? buildRescueLogEntries(syncRunId, rescued, syncRunAt) : []),
        ...(wordCoverageEntry ? [wordCoverageEntry] : []),
        buildSyncInfoEntry(syncRunId, aligned.segments.length, kept.length, skipped.length, syncRunAt),
      ];
      pendingLogSummary = {
        syncRunId,
        timestamp: syncRunAt,
        totalSegments: aligned.segments.length,
        coveredSegments: kept.length,
        skippedSegments: skipped.length,
        aborted: false,
        silenceErrorCount: aligned.silenceError ? 1 : 0,
        rescueCount: rescued.length,
      };

      // Covered-only boundary re-snap (middle-gap position-offset fix).
      //
      // The aligner's own snap ran on the FULL array, so any boundary shared
      // with an UNMATCHED segment was computed from that segment's -1 token
      // sentinels — i.e. from placeholder anchors, not from anything spoken.
      // Re-snapping here, on the survivors only, gives every boundary two
      // matched segments with real spoken-word edges, so a scene that never
      // reaches the timeline can no longer shift the position of one that does
      // (measured drift before this: 0.13s). It also SUBSUMES the old R4-1
      // re-tile — durations come from the re-snapped boundaries, and the last
      // survivor still runs to audioDuration.
      //
      // The plain arithmetic re-tile stays as the fallback for the degenerate
      // case where there is nothing to snap against (no tokens): closing the
      // skip gaps is still better than leaving them.
      // WS4 Feature 4 — snap against `aligned.tokens`, the MALFORMED-FILTERED
      // array the aligner actually used, not `projectRef.current.transcriptTokens`.
      // keptAlignments' firstTokenIdx/lastTokenIdx are indices into the filtered
      // array; reading the raw one with them would resolve to the wrong tokens
      // whenever anything was filtered.
      const transcriptTokens = aligned.tokens;
      finalTimedSegments = transcriptTokens.length > 0
        ? snapCoveredBoundaries(kept, keptAlignments, transcriptTokens, aligned.silences, audioDuration)
        : retileCoveredSegments(kept, audioDuration);
      // Boundary-quality checker input (waveform-watcher program, Phase 1) —
      // only meaningful when snapCoveredBoundaries actually ran against real
      // tokens above; the retileCoveredSegments fallback has no per-pair
      // alignment data to check a fallback boundary against.
      if (transcriptTokens.length > 0) {
        pendingBoundaryCheckInput = { alignments: keptAlignments, tokens: transcriptTokens, silences: aligned.silences };
      }
      // Head/tail symmetry (syncEngine.ts's headExtendFirstSegment): the last
      // segment already runs to audioDuration (both branches above); the
      // first segment's own startTime is untouched by either (it's still
      // wherever the aligner's matched span put it — the first spoken word,
      // not necessarily 0). Stretch it back to 0 the same way.
      finalTimedSegments = headExtendFirstSegment(finalTimedSegments);

      // WS2 T2.1 (gap-absorption) — merges the map computed right after
      // `filterToCoveredSegments` above onto the final committed segments,
      // BEFORE any WS1 rule below can move a boundary again. Keyed by id, so
      // this reads identically regardless of which timing branch (snap vs.
      // retile) ran, and regardless of anything upstream having reordered
      // `kept` (it hasn't — this is defense-in-depth, not a known reorder).
      finalTimedSegments = applyAbsorbedGaps(finalTimedSegments, absorbedGapsByHostId);

      // WS2 T2.2 (minimal override store) — clean-slate re-sync (§4
      // invariant) never carries a segment's own timing forward, but a
      // segment the user previously restored (`Project.segmentOverrides`)
      // IS re-applied here if this run dropped it again, so a restore
      // survives a re-sync instead of needing to be redone by hand every
      // time. Uses a fixed fps for the sub-frame merge check rather than the
      // session's export-fps UI state — this runs deep inside the sync
      // commit path, which does not (and should not) depend on that
      // unrelated setting.
      const keepOverrideIds = new Set(
        Object.entries(projectRef.current.segmentOverrides ?? {})
          .filter(([, action]) => action === 'keep')
          .map(([segId]) => segId),
      );
      if (keepOverrideIds.size > 0) {
        finalTimedSegments = restoreSegmentsByGapId(finalTimedSegments, keepOverrideIds, GAP_RESTORE_REHYDRATION_FPS);
      }

      // WS1 R.11 (faSeamFitGate.ts) — CHUNK-FIT BOUNDARY CORRECTION. Runs
      // ONLY when FA actually produced the tokens (mirrors R.10's own
      // gating) and only AFTER the final committed array exists, since
      // detection compares the COMMITTED boundary against a real silence's
      // midpoint. `anchorTimed`/`projectRef.current.transcriptTokens!` are
      // the SAME (complete, pre-skip, raw-token) inputs
      // `runForcedAlignmentForSync` gave `computeFaChunkPlan` to produce the
      // real chunk plan FA was run against — required for the detector's
      // own word-index attribution to mean anything.
      if (faTokens) {
        // WS1 Session S, ruling R-AP — THE RUN-EDGE EXCLUSION INVARIANT.
        //
        // `preRuleSegments` is the ORIGIN array: the committed boundaries as
        // they stood before ANY rule in this stage ran. Every R-AP verdict is
        // reached against it, never against the running array, because a
        // current-state check provably cannot see the defect R-AP exists for:
        // once R.11 has moved a boundary out of a run, asking "is this
        // boundary inside a run?" truthfully answers no, and R.12 correctly
        // declines a row it should have owned. See
        // `faRuleStageExclusion.ts`'s header for the measured instance
        // (`266_forty_one_burden`, 790.33 -> 792.18, past the end of R.5
        // run 6).
        //
        // The extents are derived from the SAME inputs R.12 and R.13 give
        // their own run derivation, so all three rules are talking about one
        // interval.
        const preRuleSegments = finalTimedSegments.map(s => ({ ...s }));
        const runExtents = computeRunExtents(
          anchorTimed, projectRef.current.transcriptTokens!, aligned.silences, audioDuration,
        );
        const originById = new Map(preRuleSegments.map(s => [s.id, s.startTime]));

        const seamFitFindings = detectSeamFitDefects(
          anchorTimed,
          // WS1 Session N — the COMMITTED array, the second half of the same
          // two-array split R.12/R.13 below already had. Passing only
          // `anchorTimed` made R.11 read a character-weight pre-alignment
          // estimate as its `committedValue`; see faSeamFitGate.ts's doc
          // comment for the measured consequence (it could never fire).
          finalTimedSegments,
          projectRef.current.transcriptTokens!,
          faTokens,
          aligned.silences,
          audioDuration,
        );
        // R-AP, clause (1) and (2), applied to R.11: it may not touch a
        // boundary whose ORIGIN lies inside a run (that row is R.12's), and it
        // may not move any boundary across a run edge.
        const seamFitVerdict = excludeRunEdgeViolations(seamFitFindings, originById, runExtents);
        if (seamFitVerdict.excluded.length > 0) {
          console.warn(
            `[sync] R-AP — declined ${seamFitVerdict.excluded.length} R.11 correction(s) that would ` +
            `have crossed or claimed an unscripted-run edge:`,
            seamFitVerdict.excluded,
          );
        }
        const keptSeamFit = seamFitVerdict.kept;
        if (keptSeamFit.length > 0) {
          console.warn(
            `[sync] R.11 — ${keptSeamFit.length} chunk-fit boundary correction(s):`,
            keptSeamFit,
          );
          ruleLogEntries.push(...buildSeamFitLogEntries(syncRunId, keptSeamFit, finalTimedSegments, syncRunAt));
        }
        finalTimedSegments = applySeamFitCorrections(finalTimedSegments, keptSeamFit);

        // WS1 R.12 (faRunPlacementGate.ts) — THE ATOMIC-RUN INVARIANT. No
        // committed boundary may lie strictly inside an unscripted run.
        // Structural, no threshold. Runs LAST in the correction chain and on
        // the fully-corrected array, so its `committedValue` is the value the
        // project would actually have shipped; its findings are disjoint from
        // R.10's and R.11's on every committed corpus (measured), so the order
        // is a determinism choice, not a dependency.
        //
        // `anchorTimed` supplies the COMPLETE pre-skip script/order the run
        // derivation needs (it never reads segment timing);
        // `finalTimedSegments` supplies the committed boundaries under test.
        const runPlacementFindings = detectRunPlacementDefects(
          anchorTimed,
          finalTimedSegments,
          projectRef.current.transcriptTokens!,
          aligned.silences,
          audioDuration,
        );
        if (runPlacementFindings.length > 0) {
          console.warn(
            `[sync] R.12 — ${runPlacementFindings.length} atomic-run boundary correction(s):`,
            runPlacementFindings,
          );
          ruleLogEntries.push(...buildRunPlacementLogEntries(syncRunId, runPlacementFindings, finalTimedSegments, syncRunAt));
        }
        finalTimedSegments = applyRunPlacementCorrections(finalTimedSegments, runPlacementFindings);

        // WS1 R.13 (faRunPlacementGate.ts) — THE ATOMIC-UTTERANCE INVARIANT,
        // the CLOSING half of R.12. R.12 pulls a run-carrying scene's START
        // back to before the recitation; nothing before this looked at where
        // that scene ENDS, so its closing boundary could still sit on the pause
        // between the recitation and the scene's own line — leaving the carrier
        // holding a recitation it has no words for and handing its own line to
        // the next scene. Runs immediately after R.12 and on R.12's own output,
        // because the defect is only well-defined once the opening edge is
        // correct. Structural, no threshold. Blast radius on the committed
        // corpora: 1 of 649.
        const utteranceFindings = detectUtterancePlacementDefects(
          anchorTimed,
          finalTimedSegments,
          projectRef.current.transcriptTokens!,
          aligned.silences,
          audioDuration,
        );
        // R-AP applies to R.13 too — it is not R.12, and the invariant is
        // universal. On every committed corpus R.13's one firing is already
        // legal (its origin and target both sit past the run's end), so this
        // is a guard against a future shape, not a live filter.
        const utteranceVerdict = excludeRunEdgeViolations(utteranceFindings, originById, runExtents);
        if (utteranceVerdict.excluded.length > 0) {
          console.warn(
            `[sync] R-AP — declined ${utteranceVerdict.excluded.length} R.13 correction(s) that would ` +
            `have crossed or claimed an unscripted-run edge:`,
            utteranceVerdict.excluded,
          );
        }
        const keptUtterance = utteranceVerdict.kept;
        if (keptUtterance.length > 0) {
          console.warn(
            `[sync] R.13 — ${keptUtterance.length} atomic-utterance boundary correction(s):`,
            keptUtterance,
          );
          ruleLogEntries.push(
            ...buildUtterancePlacementLogEntries(syncRunId, keptUtterance, finalTimedSegments, syncRunAt),
          );
        }
        finalTimedSegments = applyUtterancePlacementCorrections(finalTimedSegments, keptUtterance);

        // WS1 Session AE, R.14 / R.15 (faAnchorTrustGate.ts) — THE ANCHOR-TRUST
        // GATE. Last in the stage, and deliberately so: both rules read the
        // per-segment token attribution `snapCoveredBoundaries` itself snapped
        // against (`keptAlignments`, index-parallel with the committed array)
        // and ask whether the boundary that came out of the whole stage sits
        // where those ordinals say it must. Running it earlier would have it
        // judge an array R.11/R.12/R.13 were still going to move.
        //
        // `transcriptTokens` here is `aligned.tokens` — the SAME filtered FA
        // array `keptAlignments`' indices address. Handing it the raw array
        // would shift every ordinal by however many tokens the malformed
        // filter dropped, which is the one way to make this gate lie.
        //
        // No R-AP filter: R.14 and R.15 cannot claim a boundary R.12 owns.
        // R.12's rows are inside an unscripted run, where the incoming
        // segment's own claimed anchors are the run's tokens; R.14 requires
        // ordinalDelta 0 with a sub-reliability incoming anchor and a word gap
        // under 0.25s, and R.15 requires a NEGATIVE ordinal. On all three
        // committed corpora the two rules' firing sets are disjoint from
        // R.11/R.12/R.13's, measured. The whole-stage R-AP check below still
        // sees their output, which is the point of it being whole-stage.
        const anchorTrustFindings = detectAnchorTrustDefects(
          finalTimedSegments, keptAlignments, transcriptTokens, aligned.silences,
        );
        if (anchorTrustFindings.length > 0) {
          console.warn(
            `[sync] R.14/R.15 — ${anchorTrustFindings.length} anchor-trust boundary correction(s):`,
            anchorTrustFindings,
          );
        }
        finalTimedSegments = applyAnchorTrustCorrections(finalTimedSegments, anchorTrustFindings);

        // R-AP, CHECKED AND LOGGED over the whole stage, on the (origin,
        // final) PAIR. This is not a restatement of the two filters above: a
        // filter can only decline what its own rule proposes, while this sees
        // the composed result of every rule — including a future rule added
        // without an R-AP filter, and including two individually-legal moves
        // that compose into an illegal one. R.12's own ids are exempt by name.
        //
        // WS1 SESSION T WORDING FIX: this is DETECTION, not enforcement. A
        // violation is `console.error`'d into the sync log, matching every
        // other DEV-mode invariant check in this codebase (none of them
        // throw) — it does not block the commit, export, or any downstream
        // step. Earlier text here and in the docs said "asserted", which
        // overstated the guarantee; corrected rather than changed to throw,
        // since throwing here would be a new, codebase-inconsistent pattern
        // introduced for its own sake, not because this invariant needs a
        // stronger guarantee than any other DEV check in `App.tsx` has.
        const runEdgeViolations = findRunEdgeViolations(
          preRuleSegments, finalTimedSegments, runExtents,
          new Set(runPlacementFindings.map(f => f.segmentId)),
        );
        if (runEdgeViolations.length > 0) {
          console.error(
            `[sync] R-AP VIOLATED — ${runEdgeViolations.length} boundary/boundaries moved across an ` +
            `unscripted-run edge by a rule that does not own them:\n  ` +
            runEdgeViolations.map(describeRunEdgeViolation).join('\n  '),
            runEdgeViolations,
          );
        }
      }

      // R.5's staged entries, built now that `finalTimedSegments` is final and
      // spliced back to their pipeline-order position (see the R.5 block).
      if (stagedUnscriptedRuns.length > 0) {
        ruleLogEntries.splice(
          unscriptedRunLogInsertAt,
          0,
          ...buildUnscriptedRunLogEntries(syncRunId, stagedUnscriptedRuns, finalTimedSegments, syncRunAt),
        );
      }

      // WS1 Session J — splice the staged rule/engine/fallback entries in
      // FRONT of this branch's own entries, now that every rule has fired.
      // Order is deliberate: engine first, then the corrections in the order
      // the pipeline applied them (R.5 -> R.10 -> R.11 -> R.12 -> R.13), then the
      // per-scene skips and the run summary. A reader gets "what ran and what
      // it changed" before "what the outcome was", which is the order the
      // acceptance run reads them in.
      pendingLogEntries = [...ruleLogEntries, ...pendingLogEntries];
    } else {
      // Defensive fallback only — under correct button gating this branch
      // should be unreachable whenever a voiceover exists in Tauri. Surface
      // it loudly rather than silently shipping character-based timing.
      const unexpectedFallback = !!voiceoverAsset && isTauri();
      if (unexpectedFallback) {
        console.warn(
          '[sync] Apply Sync committed with no cached transcript — falling back to character-based timing',
          { voiceoverAssetId: voiceoverAsset!.id },
        );
      }
      finalTimedSegments = applyAnchorBasedTiming(newSegmentsRaw, audioDuration);
      // WS-logs — this branch commits too, so it owes the log a summary. There
      // is no coverage data here (nothing was aligned against audio), so every
      // segment counts as covered and none as skipped. The defensive case gets
      // a 'warning' rather than an 'info' — the same signal as the console.warn
      // above, but one a teammate can still see tomorrow.
      pendingLogEntries = [
        makeSyncLogEntry(
          syncRunId,
          unexpectedFallback ? 'warning' : 'info',
          unexpectedFallback
            ? `Sync completed on character-based timing — no cached transcript was available for the voiceover. ${finalTimedSegments.length} segment(s) placed.`
            : `Sync completed: ${finalTimedSegments.length} segment(s) placed using character-based timing (no voiceover transcript).`,
          undefined,
          syncRunAt,
        ),
      ];
      pendingLogSummary = {
        syncRunId,
        timestamp: syncRunAt,
        totalSegments: finalTimedSegments.length,
        coveredSegments: finalTimedSegments.length,
        skippedSegments: 0,
        aborted: false,
        // No audio was analysed on this branch, so silence detection never ran.
        silenceErrorCount: 0,
      };
    }
    syncMark('align+timing:done');

    const committedSegments = preserveEffectFields(
      autoMatchSegments(allAssets, finalTimedSegments),
      previousSegments,
    );
    syncMark('autoMatch+preserveEffectFields:done');

    // K13 fix — restore locked/startTime/duration from previousSegments onto
    // whichever committed segment now carries the same (unique) assetId.
    // Runs after preserveEffectFields, on the fully-timed, fully-asset-
    // matched array — see preserveSegmentLocks' own doc comment for why.
    const { segments: lockRestoredSegments, dropped: droppedLocks } = preserveSegmentLocks(
      committedSegments,
      previousSegments,
      audioDuration,
    );
    if (droppedLocks.length > 0) {
      pendingLogEntries = [
        ...pendingLogEntries,
        ...buildLockNotRestoredLogEntries(syncRunId, droppedLocks, syncRunAt),
      ];
    }
    syncMark('preserveSegmentLocks:done');

    // WS-logs — one summary entry for committed segments with no matched
    // asset (success paths only; the abort path above returns before this
    // point and owes no such entry). Segment numbers are 1-based positions
    // in lockRestoredSegments, matching the Segments-tab row numbering. Piece 1
    // (WS3 Batch B) — this is now the SOLE "no asset" emitter; see
    // buildNoAssetSummaryEntry's own comment for why computing it here, on
    // the final committed segments, is strictly correct and why the
    // parse-pass-only snapshot this replaced is redundant with it.
    const noAssetNumbers = lockRestoredSegments
      .map((s, i) => (s.assetId ? null : i + 1))
      .filter((n): n is number => n !== null);
    if (noAssetNumbers.length > 0) {
      const availableAssetCount = allAssets.filter(a => a.type !== 'audio').length;
      const noAssetEntry = buildNoAssetSummaryEntry(
        syncRunId,
        noAssetNumbers,
        lockRestoredSegments.length,
        availableAssetCount,
        syncRunAt,
      );
      if (noAssetEntry) pendingLogEntries = [...pendingLogEntries, noAssetEntry];
      if (pendingLogSummary) pendingLogSummary = { ...pendingLogSummary, noAssetCount: noAssetNumbers.length };
    }

    // Piece 2, Case A — one warning per committed video segment whose clip
    // runs out before the segment does (freeze-last-frame). See
    // buildFreezeFrameEntries' own comment for why this is computed here.
    // Computed AFTER preserveSegmentLocks — a restored lock can change a
    // segment's duration, which this check depends on.
    const freezeFrameEntries = buildFreezeFrameEntries(syncRunId, lockRestoredSegments, allAssets, syncRunAt);
    if (freezeFrameEntries.length > 0) {
      pendingLogEntries = [...pendingLogEntries, ...freezeFrameEntries];
    }

    // Layer 2 permanent detector (WS2 Step 5, Bug 1) — re-checks `keptAlignments`
    // (each kept segment's own REAL matched audio position, independent of the
    // gapless partition `lockRestoredSegments` always produces by construction)
    // for any ordering violation that survived the trusted-spine gate. Detection
    // and DEV-console logging only — never mutates, repairs, re-anchors, or
    // blocks; the export guard (timelinePartition.ts) remains the sole
    // enforcement point. Zero behavioral change when the timeline is clean, the
    // overwhelmingly common case. See residualOrderingDetector.ts.
    if (import.meta.env.DEV) {
      const residualViolations = detectResidualOrderingViolations(residualCheckAlignments);
      if (residualViolations.length > 0) logResidualOrderingViolations(residualViolations);
    }

    // 8. Single atomic state update — segments are already final.
    //    New-layer headings (Path B Decision 2) never move on re-sync; only
    //    clamp+flag any whose fixed timestamp now exceeds the resynced audio.
    setProject(prev => ({
      // WS-logs — fold this run's entries/summary in FIRST so they commit
      // atomically with the segments they describe (appendSyncLogEntries is
      // pure and only touches syncLog/syncRunSummaries).
      ...appendSyncLogEntries(prev, pendingLogEntries, pendingLogSummary),
      script: scriptText,
      sceneDetails: sceneText,
      scriptFileName: staged.scriptFile?.file.name ?? prev.scriptFileName ?? '',
      sceneDetailsFileName: staged.sceneFile?.file.name ?? prev.sceneDetailsFileName ?? '',
      scriptUpdatedAt: staged.scriptFile ? Date.now() : prev.scriptUpdatedAt,
      sceneDetailsUpdatedAt: staged.sceneFile ? Date.now() : prev.sceneDetailsUpdatedAt,
      assets: allAssets,
      voiceoverId: newVoiceoverId,
      segments: lockRestoredSegments,
      headings: clampHeadingsToDuration(prev.headings ?? [], audioDuration),
      // WS1 Task 5, §11 item 1 — clean-slate re-sync (CLAUDE.md's Sync/
      // Whisper invariants): every Apply Sync re-derives this fresh, exactly
      // like anchorStart. A gate-off or FA-fallback run explicitly clears
      // any FA word timings a PRIOR run may have left behind, rather than
      // leaving stale word indices attached to a segment structure they no
      // longer describe.
      faWordTimings: faWordTimingsResult,
    }));
    syncMark('setProject:called');
    // Post-commit paint boundary: rAF fires after React commits + the browser
    // paints the new segment DOM. The waveform-pipeline marks (below) then
    // attribute the decode/peak-build cost that lands AFTER this first paint.
    requestAnimationFrame(() => syncMark('first-paint(rAF)'));

    // Reveal the timeline immediately (unchanged reveal timing) — the waveform
    // then fills in as it's built.
    setIsSynced(true);
    setSyncStep(4);

    // Build the voiceover waveform ONCE, here in the sync sequence — relocated out
    // of Timeline's render-triggered decode effect (docs/history.md ("Waveform Rewrite — Implementation Record", archived)
    // §3). The pipeline yields internally so the main thread stays responsive even
    // on a 21-min file; isProcessing stays true until it finishes so the UI reflects
    // "still working" (and gives the Step 5 loading screen a clean hook). The reload
    // effect dedupes against the same key, so it won't rebuild what this just built.
    const resolvedWaveform = await buildVoiceoverWaveform(voiceoverAsset);

    // Boundary-quality checker (waveform-watcher program, Phase 1) — a
    // post-hoc, READ-ONLY measurement pass (architecture B: runs strictly
    // AFTER the peaks above are built; nothing about the sync steps or the
    // segment commit above is reordered or altered). Own follow-up
    // setProject, reusing this run's syncRunId with no summary (the R11
    // staging-path pattern, services/syncLog.ts — this pass has no
    // segment-coverage outcome of its own to roll up, only whatever
    // boundary-quality findings it produced).
    //
    // Severity: 'info', not 'warning', even though the dual-gate thresholds
    // (BOUNDARY_QUALITY_LOUDNESS_RATIO_K / _SUSTAINED_WINDOW_SEC / _ABSOLUTE_
    // AMPLITUDE_FLOOR / _MIN_DISTANCE_SEC, syncConstants.ts) are now
    // calibrated against production data (see that constant's own doc
    // comment). Phase 1 ships this as observability only — a WARNING is
    // always-visible, amber, and implies the user should act on it (severity
    // taxonomy, docs/sync-pipeline-contract-plan.md §4); that promotion is
    // Phase 2's watcher/auto-fix work, not this checker's. `validateBoundary
    // Quality` itself still returns 'warning'-typed ContractViolations (it is
    // a correctly-typed Contract 5→6 validator, ready for Phase 2 to promote
    // as-is) — the downgrade to 'info' happens here, at this wiring, not in
    // the validator.
    if (pendingBoundaryCheckInput) {
      const boundaryViolations = resolvedWaveform
        ? validateBoundaryQuality(
            committedSegments,
            pendingBoundaryCheckInput.alignments,
            pendingBoundaryCheckInput.tokens,
            pendingBoundaryCheckInput.silences,
            resolvedWaveform,
            BOUNDARY_QUALITY_LOUDNESS_RATIO_K,
            BOUNDARY_QUALITY_SUSTAINED_WINDOW_SEC,
          )
        : [];
      // Log-grouping feature (2026-08-03) — 2+ boundary-quality warnings from
      // one run fold into a single entry (buildGroupedViolationEntry, same
      // builder the word-coverage validator above uses) instead of one entry
      // per flagged boundary; a lone flagged boundary still gets a plain
      // entry. `entryType: 'info'` preserves this checker's own established
      // Phase 1 downgrade (see the comment above) — grouping must not
      // silently promote it to a 'warning'-typed entry.
      const groupedBoundaryEntry = resolvedWaveform
        ? buildGroupedViolationEntry(syncRunId, boundaryViolations, syncRunAt, 'info')
        : undefined;
      const boundaryLogEntries: SyncLogEntry[] = resolvedWaveform
        ? (groupedBoundaryEntry ? [groupedBoundaryEntry] : [])
        : [makeSyncLogEntry(
            syncRunId,
            'info',
            `Waveform unavailable — ${Math.max(0, committedSegments.length - 1)} boundary(ies) not waveform-verified.`,
            undefined,
            syncRunAt,
          )];
      if (boundaryLogEntries.length > 0) {
        // setProjectSilent, not setProject: this is a post-hoc continuation of
        // the SAME Apply Sync edit that already pushed a history entry above
        // (step 8), arriving after the async waveform build rather than a new
        // user-authored edit of its own. A second keyless setProject here
        // always pushes (historyCoalesce.ts's discrete-write rule), so it used
        // to cost the user two undo presses per Apply Sync — the first a
        // visual no-op on the waveform-unavailable branch, since nothing but
        // this log entry had changed. See docs/_cleanup-findings.md, Stage 3.
        setProjectSilent(prev => appendSyncLogEntries(prev, boundaryLogEntries, undefined));
      }
    }

    setIsProcessing(false);
  };

  // MODEL P — dev-only gapless-partition assertion (ruling §6.1 step 1,
  // compliance backlog item 3, 2026-08-07).
  //
  // Fires on the FIRST violation of `startTime[i] + duration[i] ===
  // startTime[i+1]` to reach committed state. This is the check the ruling
  // document asked for on the grounds that it "would have caught K14's gap the
  // day it shipped" — K14 shipped green because every targeted test passed;
  // none of them asked this question of the array as a whole.
  //
  // Deliberately ONE effect keyed on `project.segments` rather than an
  // assertion threaded through each of the ~79 `setProject` call sites. An
  // effect observes the committed result of every writer — including ones
  // added later, and including writers that reach `segments` indirectly — so
  // its coverage cannot rot as call sites are added or moved. Per-call-site
  // assertions would have to be remembered every time, which is precisely the
  // failure mode the ruling is reacting to.
  //
  // DEV-only and dead-code-eliminated in production (same `import.meta.env.DEV`
  // convention as the dev panel and the calibration harness below). It never
  // throws and never mutates: a violation here means the timeline is already
  // wrong, and taking the editor down on top of that helps nobody. It reports
  // and lets the user keep working.
  //
  // `audioDuration` is deliberately NOT passed — the head/tail clauses depend
  // on a voiceover being loaded and settle asynchronously during hydration and
  // Apply Sync, so including them would fire noisy false positives on states
  // that are legitimately mid-flight. Adjacency is the clause that is
  // unconditionally true of any committed array, and it is the one that breaks
  // export (`segments-invariant-ruling.md` §1.3).
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    const violations = findPartitionViolations(project.segments)
      .filter(v => v.kind === 'lock-lock-gap' || v.kind === 'lock-lock-overlap');
    if (violations.length === 0) return;
    const first = violations[0]!;
    console.error(
      `[model-p] GAPLESS INVARIANT VIOLATED — ${violations.length} site(s). `
      + `First: ${first.kind === 'lock-lock-gap' ? 'gap' : 'overlap'} of `
      + `${first.amountSec.toFixed(3)}s before segment ${first.index + 1} (id ${first.segmentId}). `
      + `Model P requires startTime[i] + duration[i] === startTime[i+1]. `
      + `See docs/decisions/2026-08-07-model-p-ruling.md.`,
      violations,
    );
  }, [project.segments]);

  // Boundary-quality calibration harness (waveform-watcher program, Phase 1,
  // Step 6) — DEV-only, never bundled into a production build (dead-code
  // eliminated behind `import.meta.env.DEV`, same convention the Ctrl/Cmd+
  // Shift+D dev panel above uses). Not wired to any UI: run it from the
  // browser/WKWebView devtools console as `await __calibrateBoundaryQuality()`
  // against a project that already has a Whisper-synced voiceover (Apply
  // Sync must have run at least once so persisted transcript tokens + peaks
  // exist). Default mode (no argument, or `{ detail: false }`) re-derives
  // fresh alignments/silences from the CURRENT project state (never touches
  // it) and sweeps BOUNDARY_QUALITY_K_SWEEP x BOUNDARY_QUALITY_WINDOW_SWEEP
  // (syncConstants.ts), printing one line per combination: how many fallback
  // boundaries existed, how many the threshold would flag, and which ones.
  // This is how Phase 2 picks real BOUNDARY_QUALITY_LOUDNESS_RATIO_K /
  // BOUNDARY_QUALITY_SUSTAINED_WINDOW_SEC values instead of the interim
  // starting points wired in above.
  //
  // Detail mode (`await __calibrateBoundaryQuality({ detail: true })`,
  // added alongside the Phase 1 wiring fix, 2026-08-02) — the sweep table
  // above answers "how many pairs would K/window flag," but calibrating a
  // DUAL gate (relative K-ratio + an absolute-amplitude floor) needs the
  // actual per-pair amplitude numbers, not just flagged counts. Runs the
  // checker ONCE, at the currently-wired production K/window
  // (BOUNDARY_QUALITY_LOUDNESS_RATIO_K / BOUNDARY_QUALITY_SUSTAINED_WINDOW_SEC
  // — a sweep grid of raw amplitudes would be redundant noise, since the
  // amplitudes themselves don't depend on K/window, only which pairs get
  // flagged does), in `'report-all'` mode so EVERY fallback pair prints —
  // flagged or not — sorted by `boundaryAmplitude` descending (loudest
  // fallback boundaries first, since those are the ones most likely to be
  // genuinely bad). Does not also run the sweep — it's a different
  // diagnostic question, not an additive one.
  useEffect(() => {
    if (!import.meta.env.DEV) return;

    const calibrate = async (options?: { detail?: boolean }): Promise<void> => {
      const project = projectRef.current;
      const segments = project.segments;
      const rawTokens = project.transcriptTokens ?? [];
      const voiceoverAsset = project.assets.find(a => a.id === project.voiceoverId);

      if (!voiceoverAsset) {
        console.warn('[calibrate] no voiceover asset on the current project.');
        return;
      }
      if (rawTokens.length === 0) {
        console.warn('[calibrate] no persisted transcript tokens on the current project — run Apply Sync first.');
        return;
      }

      const blobSize = voiceoverAsset.file?.size;
      let waveformSource: WaveformSource | null = blobSize !== undefined
        ? peekWaveform(voiceoverAsset.id, blobSize) ?? null
        : null;
      if (!waveformSource && blobSize !== undefined) {
        waveformSource = await getPersistedWaveform(project.id, voiceoverAsset.id, blobSize);
      }
      if (!waveformSource) {
        console.warn('[calibrate] no persisted waveform peaks for the current voiceover — run Apply Sync first.');
        return;
      }

      const filtered = filterMalformedTokens(rawTokens, waveformSource.totalDuration);
      const alignments = extractSegmentAlignments(segments, filtered.tokens);

      let silences: SilenceInterval[] = [];
      try {
        const blob = voiceoverAsset.file ?? await (await fetch(voiceoverAsset.url)).blob();
        const silenceResult = await detectSilences(blob);
        if (silenceResult.status === 'ok') silences = silenceResult.silences;
        else console.warn('[calibrate] silence detection failed, sweeping with zero silences:', silenceResult.errorMessage);
      } catch (err) {
        console.warn('[calibrate] voiceover fetch/silence-scan failed, sweeping with zero silences:', err);
      }

      console.log(
        `[calibrate] ${segments.length} segments, ${filtered.tokens.length} tokens (${filtered.skippedCount} dropped), ${silences.length} silences`,
      );

      if (options?.detail) {
        const measurements = validateBoundaryQuality(
          segments, alignments, filtered.tokens, silences, waveformSource,
          BOUNDARY_QUALITY_LOUDNESS_RATIO_K, BOUNDARY_QUALITY_SUSTAINED_WINDOW_SEC, 'report-all',
        );
        const sorted = [...measurements].sort((a, b) => b.boundaryAmplitude - a.boundaryAmplitude);
        console.log(
          `[calibrate] detail — K=${BOUNDARY_QUALITY_LOUDNESS_RATIO_K} window=${BOUNDARY_QUALITY_SUSTAINED_WINDOW_SEC}s — ` +
          `${sorted.length} fallback pair(s), sorted by boundaryAmplitude desc:`,
        );
        for (const m of sorted) {
          const distance = m.quietestAmplitude !== undefined
            ? Math.abs(m.boundaryAmplitude - m.quietestAmplitude)
            : undefined;
          console.log(
            `[calibrate]   segmentIndex=${m.segmentIndex} boundaryTime=${m.boundaryTime.toFixed(2)}s ` +
            `boundaryAmplitude=${m.boundaryAmplitude.toFixed(3)} ` +
            `quietestTime=${m.quietestTime !== undefined ? m.quietestTime.toFixed(2) + 's' : 'n/a'} ` +
            `quietestAmplitude=${m.quietestAmplitude !== undefined ? m.quietestAmplitude.toFixed(3) : 'n/a'} ` +
            `|distance|=${distance !== undefined ? distance.toFixed(3) : 'n/a'}` +
            (m.flagged ? ' [FLAGGED]' : ''),
          );
        }
        return;
      }

      for (const k of BOUNDARY_QUALITY_K_SWEEP) {
        for (const win of BOUNDARY_QUALITY_WINDOW_SWEEP) {
          const measurements: BoundaryQualityMeasurement[] = validateBoundaryQuality(
            segments, alignments, filtered.tokens, silences, waveformSource, k, win, 'report-all',
          );
          const flagged = measurements.filter(m => m.flagged);
          console.log(
            `[calibrate] K=${k} window=${win}s — fallback pairs: ${measurements.length}, flagged: ${flagged.length}` +
            (flagged.length > 0 ? ` — segments: ${flagged.map(m => m.segmentIndex + 1).join(', ')}` : ''),
          );
        }
      }
    };

    (window as unknown as {
      __calibrateBoundaryQuality: (options?: { detail?: boolean }) => Promise<void>;
    }).__calibrateBoundaryQuality = calibrate;
    return () => {
      delete (window as unknown as { __calibrateBoundaryQuality?: (options?: { detail?: boolean }) => Promise<void> }).__calibrateBoundaryQuality;
    };
  }, []);

  // Transcript Inspector (sync pipeline v2, Phase 1b — docs/sync-pipeline-v2-plan.md)
  // — DEV-only, in-app; not wired to any UI. Follows __calibrateBoundaryQuality's
  // precedent exactly: a DEV-gated window global invoked from the devtools
  // console. MUST run in-app — silences are never persisted and are recomputed
  // per sync from the audio blob via Web Audio, which does not exist outside the
  // WebView; a terminal script cannot see what the pipeline sees.
  //
  // `await __transcriptInspector()` re-derives fresh tokens (via
  // filterMalformedTokens, same audioDuration convention as
  // __calibrateBoundaryQuality above) and fresh silences (via detectSilences)
  // from the CURRENT project state, never touching it, and prints:
  //   - a console.table of per-token rows (text/startSec/endSec/durationSec/
  //     gapToPrevTokenSec/nearestPrecedingSilenceEndSec/smearSec)
  //   - a CSV dump of the same rows (paste into a spreadsheet)
  //   - aggregate smear metrics (median/p95, negative-smear count+fraction —
  //     the segment-96 pathology) and the malformed-token drop breakdown
  // It also returns the built TranscriptInspectorRun so two runs (e.g. before/
  // after a transcription-arg or model change) can be captured and compared:
  //   const a = await __transcriptInspector({ label: 'base.en' });
  //   // ...re-transcribe / re-sync...
  //   const b = await __transcriptInspector({ label: 'turbo+dtw' });
  //   __transcriptInspector.compare(a, b);
  // compare() keys token rows by normalized word + occurrence, never by index
  // — the index space differs between runs (docs/sync-pipeline-v2-plan.md Part
  // C, "Index-keyed references break after Phase 3").
  useEffect(() => {
    if (!import.meta.env.DEV) return;

    const inspect = async (options?: { label?: string }): Promise<TranscriptInspectorRun | undefined> => {
      const project = projectRef.current;
      const rawTokens = project.transcriptTokens ?? [];
      const voiceoverAsset = project.assets.find(a => a.id === project.voiceoverId);

      if (!voiceoverAsset) {
        console.warn('[inspector] no voiceover asset on the current project.');
        return undefined;
      }
      if (rawTokens.length === 0) {
        console.warn('[inspector] no persisted transcript tokens on the current project — run Apply Sync first.');
        return undefined;
      }

      const blobSize = voiceoverAsset.file?.size;
      let waveformSource: WaveformSource | null = blobSize !== undefined
        ? peekWaveform(voiceoverAsset.id, blobSize) ?? null
        : null;
      if (!waveformSource && blobSize !== undefined) {
        waveformSource = await getPersistedWaveform(project.id, voiceoverAsset.id, blobSize);
      }
      if (!waveformSource) {
        console.warn('[inspector] no persisted waveform peaks for the current voiceover — run Apply Sync first.');
        return undefined;
      }

      const audioDurationSec = waveformSource.totalDuration;
      const filterResult = filterMalformedTokens(rawTokens, audioDurationSec);

      let silences: SilenceInterval[] = [];
      try {
        const blob = voiceoverAsset.file ?? await (await fetch(voiceoverAsset.url)).blob();
        const silenceResult = await detectSilences(blob);
        if (silenceResult.status === 'ok') silences = silenceResult.silences;
        else console.warn('[inspector] silence detection failed, inspecting with zero silences:', silenceResult.errorMessage);
      } catch (err) {
        console.warn('[inspector] voiceover fetch/silence-scan failed, inspecting with zero silences:', err);
      }

      const run = buildTranscriptInspectorRun({
        label: options?.label ?? project.name,
        tokens: filterResult.tokens,
        drops: filterResult.drops,
        totalTokens: filterResult.totalTokens,
        silences,
        audioDurationSec,
      });

      console.log(
        `[inspector] "${run.label}" — ${run.totalTokens} raw tokens (${run.skippedTokenCount} dropped), ` +
        `${run.rows.length} kept, ${run.silenceCount} silences detected, audioDuration=${audioDurationSec.toFixed(2)}s`,
      );
      console.table(run.rows.map(r => ({
        idx: r.index,
        text: r.text,
        startSec: r.startSec.toFixed(3),
        endSec: r.endSec.toFixed(3),
        durationSec: r.durationSec.toFixed(3),
        gapToPrevSec: r.gapToPrevTokenSec !== null ? r.gapToPrevTokenSec.toFixed(3) : '',
        nearestSilenceEndSec: r.nearestPrecedingSilenceEndSec !== null ? r.nearestPrecedingSilenceEndSec.toFixed(3) : '',
        smearSec: r.smearSec !== null ? r.smearSec.toFixed(3) : '',
      })));
      console.log(
        `[inspector] smear — pause-following tokens: ${run.aggregates.pauseFollowingTokenCount}, ` +
        `median=${run.aggregates.medianSmearSec !== null ? run.aggregates.medianSmearSec.toFixed(3) + 's' : 'n/a'}, ` +
        `p95=${run.aggregates.p95SmearSec !== null ? run.aggregates.p95SmearSec.toFixed(3) + 's' : 'n/a'}, ` +
        `negative=${run.aggregates.negativeSmearCount} (${run.aggregates.negativeSmearFraction !== null ? (run.aggregates.negativeSmearFraction * 100).toFixed(1) + '%' : 'n/a'})`,
      );
      console.log('[inspector] malformed-token drop breakdown:', run.dropBreakdown);
      console.log('[inspector] CSV (copy below):');
      console.log(tokenRowsToCsv(run.rows));

      return run;
    };

    const compare = (
      runA: TranscriptInspectorRun,
      runB: TranscriptInspectorRun,
    ): TranscriptInspectorTokenComparisonRow[] => {
      console.log(`[inspector] comparing "${runA.label}" vs "${runB.label}"`);
      console.table([
        { metric: 'median smear (s)', [runA.label]: runA.aggregates.medianSmearSec, [runB.label]: runB.aggregates.medianSmearSec },
        { metric: 'p95 smear (s)', [runA.label]: runA.aggregates.p95SmearSec, [runB.label]: runB.aggregates.p95SmearSec },
        { metric: 'negative-smear fraction', [runA.label]: runA.aggregates.negativeSmearFraction, [runB.label]: runB.aggregates.negativeSmearFraction },
        { metric: 'pause-following tokens', [runA.label]: runA.aggregates.pauseFollowingTokenCount, [runB.label]: runB.aggregates.pauseFollowingTokenCount },
      ]);
      const rows = compareTranscriptInspectorRuns(runA, runB);
      console.table(rows.map(r => ({
        key: r.key,
        textA: r.textA ?? '',
        textB: r.textB ?? '',
        smearA: r.smearA !== null ? r.smearA.toFixed(3) : '',
        smearB: r.smearB !== null ? r.smearB.toFixed(3) : '',
        deltaSmearSec: r.deltaSmearSec !== null ? r.deltaSmearSec.toFixed(3) : '',
      })));
      return rows;
    };

    type TranscriptInspectorFn = ((options?: { label?: string }) => Promise<TranscriptInspectorRun | undefined>) & {
      compare: typeof compare;
    };
    const inspectorFn = inspect as TranscriptInspectorFn;
    inspectorFn.compare = compare;

    (window as unknown as { __transcriptInspector: TranscriptInspectorFn }).__transcriptInspector = inspectorFn;
    return () => {
      delete (window as unknown as { __transcriptInspector?: TranscriptInspectorFn }).__transcriptInspector;
    };
  }, []);

  // Forced-alignment dev-only invocation path (WS1 Task 5 Slice D10) —
  // DEV-only, in-app; not wired to any UI. Follows __transcriptInspector's
  // (and __calibrateBoundaryQuality's) own precedent exactly: a DEV-gated
  // window global invoked from the devtools console, never referenced from
  // any component's render output or event handler — the only way to reach
  // it is by typing its name into devtools.
  //
  // `await __faDevAlign()` runs the CURRENT project's voiceover + segments
  // through the real `fa_align_dev` Tauri command (src-tauri/src/fa_dev.rs —
  // transcodes to a throwaway 16kHz WAV, verifies the resolved model against
  // the committed SHA-256 manifest, then delegates to the unmodified,
  // production `fa_align`), reshapes the result via
  // `faWordSpansToTranscriptTokens` (the D9 reshape), and feeds those tokens
  // through the REAL, unmodified `alignScenestoTranscript`/
  // `extractSegmentAlignments` (same functions the production Apply Sync
  // path calls) to get a `t0` per segment — the FA analog of `anchorStart`.
  // NEVER writes anything back into the live project: no `setProject`, no
  // history entry, no persistence. Purely observational — prints a
  // console.table comparing each segment's FA-derived `t0` against its
  // currently-stored (Whisper-derived) `anchorStart`, and returns the full
  // result so it can be captured/compared across runs the same way
  // `__transcriptInspector`'s return value is.
  useEffect(() => {
    if (!import.meta.env.DEV) return;

    const faDevAlign = async (options?: { language?: FaLanguageCode }) => {
      const project = projectRef.current;
      const voiceoverAsset = project.assets.find(a => a.id === project.voiceoverId);
      if (!voiceoverAsset) {
        console.warn('[fa-dev] no voiceover asset on the current project.');
        return undefined;
      }
      if (project.segments.length === 0) {
        console.warn('[fa-dev] project has no segments — run Apply Sync first.');
        return undefined;
      }
      if (!project.transcriptTokens || project.transcriptTokens.length === 0) {
        console.warn('[fa-dev] project has no cached Whisper transcriptTokens — run Apply Sync first.');
        return undefined;
      }

      const SUPPORTED_FA_LANGUAGES: FaLanguageCode[] = ['en', 'es', 'fr', 'de', 'pt'];
      const language = options?.language ?? (project.language as FaLanguageCode | undefined);
      if (!language || !SUPPORTED_FA_LANGUAGES.includes(language)) {
        console.warn(
          `[fa-dev] project.language (${String(project.language)}) is not one of the 5 FA ` +
          `languages (${SUPPORTED_FA_LANGUAGES.join(', ')}) — pass { language } explicitly.`,
        );
        return undefined;
      }

      const voiceoverBlob = voiceoverAsset.file ?? await (await fetch(voiceoverAsset.url)).blob();
      const buffer = await voiceoverBlob.arrayBuffer();
      const audioExtHint = voiceoverAsset.file?.type
        || voiceoverAsset.file?.name.split('.').pop()
        || '';
      // Raw IPC body, staged by fa_stage_audio_raw into 'kinetix-fa-dev-inputs'
      // — see forcedAlignmentRun.ts's own call for the full base64-avoidance
      // rationale, identical here.
      const inputPath = await invoke<string>('fa_stage_audio_raw', new Uint8Array(buffer), {
        headers: {
          'cache-dir': 'kinetix-fa-dev-inputs',
          'ext-hint': audioExtHint,
        },
      });

      // WS1 Task 5 Slice D11: whole-file FA is infeasible at production
      // audio length (D10) — build the windowed chunk plan via
      // computeFaChunkPlan (faAnchors.ts's run structure; text attribution
      // defaults to script-word-index text attribution since WS1 Task 5
      // Slice D23 — segment-startTime remains reachable via computeFaChunkPlan's
      // 5th argument, see that function's own doc comment) instead of the
      // pre-D11 single whole-file segment list.
      const audioDuration = await probeAudioDuration(voiceoverBlob);
      const silenceResult = await detectSilences(voiceoverBlob);
      const silences: SilenceInterval[] = silenceResult.status === 'ok' ? silenceResult.silences : [];
      if (silenceResult.status !== 'ok') {
        console.warn('[fa-dev] silence detection failed, chunking with zero silences:', silenceResult.errorMessage);
      }
      const chunks: FaDevChunkInput[] = computeFaChunkPlan(
        project.segments,
        project.transcriptTokens,
        silences,
        audioDuration,
      );
      if (chunks.length === 0) {
        console.warn('[fa-dev] chunk plan is empty (every segment has empty text) — nothing to align.');
        return undefined;
      }

      console.log(
        `[fa-dev] running fa_align_dev — language=${language}, chunks=${chunks.length}, ` +
        `audio bytes=${buffer.byteLength}`,
      );

      const wallClockStartMs = performance.now();
      const channel = new Channel<FaDevEvent>();
      const words = await new Promise<FaDevWordSpan[]>(
        (resolve, reject) => {
          channel.onmessage = (msg) => {
            if (msg.event === 'Progress') {
              console.log(`[fa-dev] progress ${msg.data.index}/${msg.data.total}`);
            } else if (msg.event === 'Done') {
              resolve(msg.data.words);
            } else if (msg.event === 'Error') {
              reject(new Error(msg.data.message));
            }
          };
          invoke('fa_align_dev', {
            inputPath,
            chunks,
            language,
            onEvent: channel,
          }).catch((err: unknown) => reject(err instanceof Error ? err : new Error(String(err))));
        },
      );
      const wallClockMs = performance.now() - wallClockStartMs;

      const tokens = faWordSpansToTranscriptTokens(words);

      // Real, unmodified production functions — the same ones the Apply
      // Sync commit path calls (see App.tsx's own `cachedTokensReady`
      // branch). `t0` is the FA analog of `anchorStart` here: this dev tool
      // never runs the full commit pipeline (applyAnchorBasedTiming ->
      // snapCoveredBoundaries -> headExtendFirstSegment), so `t0` is
      // reported directly rather than a literal `segment.anchorStart` write.
      const alignments = alignScenestoTranscript(project.segments, tokens, [], audioDuration);

      const rows = project.segments.map((seg, i) => {
        const faAnchorStart = alignments[i]?.t0;
        const oldAnchorStart = seg.anchorStart;
        const deltaSec = (faAnchorStart !== undefined && oldAnchorStart !== undefined)
          ? faAnchorStart - oldAnchorStart
          : undefined;
        return {
          index: i,
          text: seg.text.slice(0, 40),
          oldAnchorStart,
          faAnchorStart,
          deltaSec,
          anchorSource: 'forced-alignment' as const,
        };
      });

      const deltas = rows.map(r => r.deltaSec).filter((d): d is number => d !== undefined).sort((a, b) => a - b);
      const min = deltas.length > 0 ? deltas[0] : undefined;
      const max = deltas.length > 0 ? deltas[deltas.length - 1] : undefined;
      const median = deltas.length > 0 ? deltas[Math.floor(deltas.length / 2)] : undefined;

      console.log(
        `[fa-dev] done — wallClockMs=${wallClockMs.toFixed(1)}, words=${words.length}, ` +
        `segments=${rows.length}, anchorStart delta (s) min=${min?.toFixed(3) ?? 'n/a'} ` +
        `median=${median?.toFixed(3) ?? 'n/a'} max=${max?.toFixed(3) ?? 'n/a'}`,
      );
      console.table(rows.map(r => ({
        idx: r.index,
        text: r.text,
        oldAnchorStart: r.oldAnchorStart?.toFixed(3) ?? '',
        faAnchorStart: r.faAnchorStart?.toFixed(3) ?? '',
        deltaSec: r.deltaSec?.toFixed(3) ?? '',
      })));

      return { wallClockMs, wordCount: words.length, rows, deltaStats: { min, median, max } };
    };

    (window as unknown as { __faDevAlign: typeof faDevAlign }).__faDevAlign = faDevAlign;
    return () => {
      delete (window as unknown as { __faDevAlign?: typeof faDevAlign }).__faDevAlign;
    };
  }, []);

  // WS-logs — empties both log fields. The setProject alone persists it (the
  // debounced usePersistProject save writes the whole Project).
  const handleClearSyncLog = useCallback(() => {
    setProject(prev => clearSyncLog(prev));
  }, []);

  // WS2 T2.1 Commit 3 — restores one or more dropped scenes (named by their
  // own stable id, `SyncLogEntry.restoreGapId`) back onto the timeline, and
  // records each as `'keep'` in `Project.segmentOverrides` (T2.2) so a
  // future re-sync that drops the same content again re-restores it
  // automatically instead of silently reverting the user's choice. Goes
  // through `setProject` (never `setProjectSilent`), so this is undoable
  // like any other timeline edit.
  const handleRestoreAbsorbedSegments = useCallback((gapSegmentIds: string[]): void => {
    if (gapSegmentIds.length === 0) return;
    // WS2 ws2-25 Commit 2 — a cluster whose transcript recorded nothing, in a
    // gap too narrow to be anything but a word seam, is REFUSED rather than
    // restored as slivers carved out of neighbours that own that time. Report
    // it instead of failing silently: from the user's side an ignored restore
    // and a broken one look identical.
    let refusedCount = 0;
    setProject(prev => {
      const ids = new Set(gapSegmentIds);
      const segments = restoreSegmentsByGapId(prev.segments, ids, exportFps);
      refusedCount = countRefusedRestores(prev.segments, ids, exportFps);
      // Only record an override for what actually landed — marking a refused
      // scene `'keep'` would promise a re-restore on the next sync that this
      // same rule would refuse again.
      const restoredIds = new Set(
        segments.filter(sg => ids.has(sg.id)).map(sg => sg.id),
      );
      const segmentOverrides = { ...(prev.segmentOverrides ?? {}) };
      for (const id of restoredIds) segmentOverrides[id] = 'keep';
      return { ...prev, segments, segmentOverrides };
    });
    if (refusedCount > 0) showToast(RESTORE_REFUSAL_MESSAGE);
  }, [exportFps, showToast]);

  // WS2 T2.1 Commit 3 — Timeline's right-click "Restore absorbed segments"
  // menu item restores EVERY cluster hosted on one clip in one action (the
  // sync-log panel's checkbox multi-select above is what a selective, one-
  // cluster-at-a-time restore goes through).
  const handleRestoreAllGapsOnSegment = useCallback((hostSegmentId: string): void => {
    const host = projectRef.current.segments.find(s => s.id === hostSegmentId);
    const gapIds = host?.absorbedGaps?.map(g => g.segmentId) ?? [];
    handleRestoreAbsorbedSegments(gapIds);
  }, [handleRestoreAbsorbedSegments]);

  // WS2 T2.1 Commit 4 — S (split the selected segment at the playhead) and
  // D (delete a split slice or restored segment). Both go through
  // setProject (undoable). `restoredIds` for the delete guard is every key
  // of `Project.segmentOverrides` — see segmentSplitDelete.ts's header for
  // why a merged restore slot (a slice id) is deliberately NOT included and
  // stays covered by the ordinary last-remaining-slice rule instead.
  const handleSplitSelectedSegment = useCallback((): void => {
    const id = resolveShortcutTargetSegmentId();
    if (!id) return;
    setProject(prev => {
      const index = prev.segments.findIndex(s => s.id === id);
      if (index < 0) return prev;
      const { segments, split } = splitSegmentAtTime(prev.segments, index, currentTimeRef.current);
      return split ? { ...prev, segments } : prev;
    });
  }, []);

  // WS2 ws2-25 Commit 4 — id-parameterized so the D shortcut (which resolves
  // its own target) and the Timeline right-click "Delete segment" entry (which
  // already knows exactly which clip was clicked) share one code path rather
  // than the context menu re-deriving selection state to call the shortcut
  // handler indirectly.
  const handleDeleteSegmentById = useCallback((id: string): void => {
    let didDelete = false;
    setProject(prev => {
      const index = prev.segments.findIndex(s => s.id === id);
      if (index < 0) return prev;
      const restoredIds = new Set(Object.keys(prev.segmentOverrides ?? {}));
      const { segments, deleted } = deleteSegment(prev.segments, index, restoredIds);
      if (!deleted) return prev;
      didDelete = true;
      return { ...prev, segments };
    });
    if (didDelete) setSelectedSegmentId(null);
  }, []);

  const handleDeleteSelectedSegment = useCallback((): void => {
    const id = resolveShortcutTargetSegmentId();
    if (!id) return;
    handleDeleteSegmentById(id);
  }, [handleDeleteSegmentById]);

  // Shared delete handler — used by DropZonePanel post-sync assets list
  const handleDeleteAsset = useCallback((assetId: string) => {
    setProject(prev => {
      const asset = prev.assets.find(a => a.id === assetId);
      if (!asset) return prev;
      URL.revokeObjectURL(asset.url);
      deleteAsset(projectIdRef.current, assetId).catch(err =>
        console.error('Failed to delete asset from IndexedDB:', err)
      );
      clearFrameRendererCache();
      return {
        ...prev,
        assets: prev.assets.filter(a => a.id !== assetId),
        voiceoverId: prev.voiceoverId === assetId ? undefined : prev.voiceoverId,
        segments: prev.segments.map(s =>
          s.assetId === assetId ? { ...s, assetId: undefined } : s
        ),
        ...(prev.voiceoverId === assetId ? {
          transcriptTokens: undefined,
          lastTranscribedAssetId: undefined,
          lastTranscribedFileIdentity: undefined,
        } : {}),
      };
    });
  }, []);

  const handleDeleteAllAssets = useCallback(() => {
    const nonAudio = assetsRef.current.filter(a => a.type !== 'audio');
    nonAudio.forEach(a => URL.revokeObjectURL(a.url));
    Promise.all(nonAudio.map(a => deleteAsset(projectIdRef.current, a.id))).catch(err =>
      console.error('[handleDeleteAllAssets] IndexedDB delete failed:', err)
    );
    clearFrameRendererCache();
    setProject(prev => ({
      ...prev,
      assets: prev.assets.filter(a => a.type === 'audio'),
      segments: prev.segments.map(s => ({ ...s, assetId: undefined })),
    }));
  }, []);

  const processMediaFile = useCallback(async (file: File, detectedType: Asset['type']): Promise<void> => {
    // Skip if an asset with the same filename already exists
    if (assetsRef.current.some(a => a.name === file.name)) return;
    const id = crypto.randomUUID();
    const url = URL.createObjectURL(file);
    try {
      await putAsset(projectIdRef.current, id, file, { name: file.name, mimeType: file.type });
    } catch (err) {
      console.error('Failed to persist asset to IndexedDB, skipping:', file.name, err);
      URL.revokeObjectURL(url);
      return;
    }
    const newAsset: Asset = {
      id,
      name: file.name,
      url,
      type: detectedType,
      file,
      duration: detectedType === 'video' ? await getMediaDuration(url, 'video') : undefined,
    };

    // When replacing with a new audio file, evict the existing audio asset so
    // the assets list never accumulates more than one voiceover entry.
    if (detectedType === 'audio') {
      const oldAudio = assetsRef.current.find(a => a.type === 'audio');
      if (oldAudio) {
        URL.revokeObjectURL(oldAudio.url);
        deleteAsset(projectIdRef.current, oldAudio.id).catch(err =>
          console.error('[kinetix] Failed to delete old voiceover from IndexedDB:', err),
        );
        deletePersistedWaveform(projectIdRef.current, oldAudio.id).catch(err =>
          console.error('[kinetix] Failed to delete old voiceover peaks:', err),
        );
      }
    }

    setProject(prev => {
      // For audio: drop any existing audio asset so we don't accumulate them.
      const baseAssets = detectedType === 'audio'
        ? prev.assets.filter(a => a.type !== 'audio')
        : prev.assets;
      const newAssets = [...baseAssets, newAsset];
      return {
        ...prev,
        assets: newAssets,
        segments: autoMatchSegments(newAssets, prev.segments),
        voiceoverId: detectedType === 'audio' ? newAsset.id : prev.voiceoverId,
      };
    });
  }, []);

  /** Core zip-extraction logic for handleZipUpload. */
  const processZipFile = useCallback(async (file: File): Promise<void> => {
    setIsProcessing(true);
    try {
      let JSZip: typeof import('jszip');
      try {
        ({ default: JSZip } = await import('jszip'));
      } catch (loadErr) {
        console.error('Failed to load jszip:', loadErr);
        return;
      }
      const zip = new JSZip();
      const content = await zip.loadAsync(file);
      const newAssets: Asset[] = [];

      const filePromises = Object.keys(content.files).map(async (filename) => {
        const fileData = content.files[filename];
        if (!fileData || fileData.dir) return;
        const name = filename.split('/').pop() || filename;
        // Skip files whose name already exists in the current asset list
        if (assetsRef.current.some(a => a.name === name)) return;
        const blob = await fileData.async('blob');
        let type: Asset['type'] = 'image';
        if (filename.match(/\.(mp3|wav|ogg|m4a)$/i)) type = 'audio';
        else if (filename.match(/\.(mp4|webm|mov|m4v)$/i)) type = 'video';

        const id = crypto.randomUUID();
        try {
          await putAsset(projectIdRef.current, id, blob, { name, mimeType: blob.type || 'application/octet-stream' });
        } catch (err) {
          console.error('Failed to persist ZIP asset to IndexedDB, skipping:', name, err);
          return;
        }
        const zipUrl = URL.createObjectURL(blob);
        newAssets.push({
          id,
          name,
          url: zipUrl,
          type,
          file: new File([blob], filename),
          duration: type === 'video' ? await getMediaDuration(zipUrl, 'video') : undefined,
        });
      });

      await Promise.all(filePromises);
      setProject(prev => {
        // Final dedup against the latest project state (catches concurrent adds)
        const dedupedNew = newAssets.filter(na => !prev.assets.some(a => a.name === na.name));
        const allAssets = [...prev.assets, ...dedupedNew];
        return {
          ...prev,
          assets: allAssets,
          segments: autoMatchSegments(allAssets, prev.segments),
          voiceoverId: newAssets.find(a => a.type === 'audio')?.id || prev.voiceoverId,
        };
      });
    } catch (err) {
      console.error("ZIP Error:", err);
    } finally {
      setIsProcessing(false);
    }
  }, []);

  const handleZipUpload = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    await processZipFile(file);
  };

  // WS2 ws2-25 Commit 4 — every individually-restored absorbed-gap segment's
  // own id (segmentOverrides' keys), for DropZonePanel's title fallback. A
  // merged restore slot's slice id is deliberately excluded here — it's
  // detected structurally (isSliceSegmentId) at the call site instead, same
  // as segmentSplitDelete.ts's own split-vs-restore split.
  const restoredSegmentIdsMemo = useMemo(
    () => new Set(Object.keys(project.segmentOverrides ?? {})),
    [project.segmentOverrides],
  );

  const currentSegment = useMemo(() => {
    if (isResizingRef.current) {
      // Frozen for the whole gesture — see isResizingRef/lastStableSegmentRef
      // comment above. Re-resolves once, right after release, via resizeSettleTick.
      return lastStableSegmentRef.current;
    }
    const seg = project.segments.find(s => currentTime >= s.startTime && currentTime < s.startTime + s.duration) ?? null;
    lastStableSegmentRef.current = seg;
    return seg;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentTime, project.segments, resizeSettleTick]);

  // WS2 ws2-23 (bug 4) — kept in step every render, for the S/D fallback
  // target above; the keydown effect's dep array is deliberately empty.
  playheadSegmentIdRef.current = currentSegment?.id ?? null;

  // LIVE AUTO-FOLLOW — while playback is running and the segment drawer is
  // already open, the drawer retargets to whichever segment the playhead is in,
  // so its text/timing/rule indicators track the video across boundaries.
  //
  // Three deliberate properties:
  //  - It only ever RETARGETS an open drawer; it never opens or closes one.
  //    `selectedSegmentId === null` covers both "drawer closed" and "the
  //    heading editor is open" (the two ids are mutually exclusive), so a
  //    heading being edited is never yanked away mid-playback.
  //  - It does NOT seek. `handleSegmentClick` pairs selection with a
  //    setCurrentTime/audio resync because a click is a navigation; this is the
  //    inverse direction (time drives selection), and seeking here would fight
  //    the playback loop.
  //  - It fires once per BOUNDARY CROSSING, not once per frame: `currentSegment`
  //    re-resolves on every `currentTime` tick, but the id guard means
  //    `setSelectedSegmentId` is only called when the resolved segment actually
  //    changes. A null `currentSegment` (playhead in a skipped-segment gap, or
  //    past the last segment) holds the current target rather than blanking it.
  useEffect(() => {
    if (!isPlaying || selectedSegmentId === null) return;
    const playingId = currentSegment?.id;
    if (!playingId || playingId === selectedSegmentId) return;
    setSelectedSegmentId(playingId);
  }, [isPlaying, currentSegment, selectedSegmentId]);

  // Project Settings Step 2 — the preview's native backing-buffer dimensions,
  // derived from (project.aspectRatio, project.resolutionTier) via
  // resolutionConfig.ts's lookup table. Threaded into PreviewStage, which
  // forwards it to PreviewCanvas (Canvas2D path) and useGlPreview (GL path)
  // so both size their canvas's backing buffer to the project's real
  // resolution instead of the panel's measured client size.
  const previewNativeDimensions = useMemo(
    () => resolveDimensions(project.aspectRatio ?? DEFAULT_ASPECT_RATIO, project.resolutionTier ?? DEFAULT_RESOLUTION_TIER),
    [project.aspectRatio, project.resolutionTier],
  );

  // Grade bug audit Fix B — the segment EffectsPanel's GRADE sliders should
  // sync FROM: the single selected segment when exactly one is selected
  // (matches the Apply-to-selected mental model), else the playhead segment,
  // else none. Resolved as an id first, then looked up separately, so
  // EffectsPanel/GradeSection can distinguish "a different segment is now
  // active" (id changed) from "same segment, its stored grade changed value"
  // (id same, grade differs) — both should re-sync the sliders.
  const activeGradeSegmentId = useMemo<string | undefined>(() => {
    if (selectedSegmentIds.size === 1) return [...selectedSegmentIds][0];
    return currentSegment?.id;
  }, [selectedSegmentIds, currentSegment]);

  const activeGrade = useMemo<SegmentGrade>(() => {
    const seg = activeGradeSegmentId ? project.segments.find(s => s.id === activeGradeSegmentId) : undefined;
    return seg?.effectGrade ?? NEUTRAL_GRADE;
  }, [activeGradeSegmentId, project.segments]);

  // Duration + stored zoom rate of the active segment (same resolution as
  // activeGrade) — feed the ANIMATIONS zoom-rate control in EffectsPanel: the
  // duration drives its per-segment max bound, the stored rate syncs its
  // displayed value on selection change.
  const activeSegmentDuration = useMemo<number | undefined>(() => {
    const seg = activeGradeSegmentId ? project.segments.find(s => s.id === activeGradeSegmentId) : undefined;
    return seg?.duration;
  }, [activeGradeSegmentId, project.segments]);

  const activeAnimationScaleRate = useMemo<number | undefined>(() => {
    const seg = activeGradeSegmentId ? project.segments.find(s => s.id === activeGradeSegmentId) : undefined;
    return seg?.effectAnimationScaleRate;
  }, [activeGradeSegmentId, project.segments]);

  // Live grade preview — the active segment's effectGrade tracks the GRADE
  // sliders as they are dragged (EffectsPanel debounces the calls), so the
  // preview updates with no Apply click: useGlPreview's render effect already
  // lists `segments` as a dep and deriveCompositeParams reads effectGrade off
  // the containing segment, so this write alone redraws even while paused.
  //
  // Deliberately narrower than handleApplyEffect's { type: 'grade' } case,
  // which is why it's a separate setter rather than another ApplyEvent: this
  // writes exactly ONE segment (the one the sliders sync FROM, above) and has
  // no scope concept at all. Apply-to-selected/all stays the way to push a
  // dialed-in grade onto anything else.
  const handleGradeLive = useCallback((value: SegmentGrade): void => {
    if (!activeGradeSegmentId) return;
    setProject(
      p => ({
        ...p,
        segments: p.segments.map(s => (s.id === activeGradeSegmentId ? { ...s, effectGrade: value } : s)),
      }),
      {
        label: `grade segment ${liveProjectRef.current.segments.findIndex(s => s.id === activeGradeSegmentId) + 1}`,
        anchorSegmentId: activeGradeSegmentId,
        // COALESCING (design §3.2). One entry per slider gesture, closed by
        // pointerup. The key includes the TARGET, which is what makes "drag
        // brightness on segment 5, then on segment 9" two entries rather than one.
        //
        // It deliberately does NOT include the channel: `EffectsPanel` writes all
        // four grade values as one `SegmentGrade` object per debounced write, so
        // from this seam a brightness drag and a contrast drag are
        // indistinguishable — a per-channel key would be a fiction. One entry per
        // grade gesture per segment is both achievable and what a user means.
        coalesceKey: `grade:${activeGradeSegmentId}`,
        coalesceKind: 'slider',
      },
    );
  }, [activeGradeSegmentId]);

  const selectedSegment = project.segments.find(s => s.id === selectedSegmentId) ?? null;
  const selectedSegmentIndex = project.segments.findIndex(s => s.id === selectedSegmentId);
  const selectedHeading = (project.headings ?? []).find(h => h.id === selectedHeadingId) ?? null;

  // Sync volatile values into refs on every render so async handlers and stable
  // callbacks can read the live state without stale closures.
  // Intentionally no dependency array — must run after every render to stay fresh.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    assetsRef.current = project.assets;
    projectRef.current = project;
    projectIdRef.current = project.id;
    // pendingVoiceoverRef is no longer mirrored here — setPendingVoiceoverSync
    // writes it synchronously at every call site instead.
  });

  // --- Thumbnail: write base64 to meta immediately when first image asset changes ---
  // This ensures the dashboard shows a correct thumbnail even on fresh app launch,
  // without waiting for the next full auto-save cycle.
  useEffect(() => {
    const firstImage = project.assets.find(a => a.type === 'image');
    if (!firstImage || !project.confirmed) return;

    void buildThumbnailBase64(firstImage.url).then((base64) => {
      if (!base64) return;
      upsertProjectMeta({
        id: project.id,
        name: project.name,
        savedAt: Date.now(),
        segmentCount: project.segments.length,
        thumbnailUrl: base64,
        thumbnailAssetId: firstImage.id,
      });
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project.assets, project.confirmed, project.id]);

  const voiceover = project.assets.find(a => a.id === project.voiceoverId);

  // Reload / restore path: when a persisted synced project mounts, its voiceover
  // blob is restored from IndexedDB under a fresh object URL every session, so this
  // effect always re-fires — but buildVoiceoverWaveform now checks IndexedDB-
  // persisted peaks (services/waveformStore.ts) keyed by the stable voiceover.id
  // before falling back to a full rebuild, so a reload of an unchanged voiceover
  // loads cached peaks instead of re-decoding. buildVoiceoverWaveform also dedupes
  // against waveformBuiltForRef, so this is a no-op when Apply Sync already built
  // the current voiceover (it sets the same key synchronously before this effect
  // runs). Keyed on the primitive id/file (not the recomputed `voiceover` object,
  // and not url — url is a re-minted blob: URL every session, never a meaningful
  // identity) so it doesn't re-fire on unrelated re-renders.
  useEffect(() => {
    void buildVoiceoverWaveform(voiceover);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [voiceover?.id, voiceover?.file, buildVoiceoverWaveform]);

  // Option C — Apply Sync stays disabled for as long as a voiceover (staged
  // or already committed) hasn't finished transcribing. The cached-token
  // clause is load-bearing, not an optimization: it's what lets the button
  // re-enable correctly on reload/restore, where nothing ever re-runs
  // transcription (transcriptionStatus.phase stays 'idle' forever otherwise).
  const effectiveVoiceoverId = pendingVoiceover?.asset.id ?? voiceover?.id;
  const transcriptionReady =
    // A terminal phase only counts as ready if it belongs to the voiceover
    // that's actually relevant right now. transcriptionStatus.phase alone is
    // asset-agnostic — one useWhisper instance backs both handleVoiceoverStaged
    // and finalizeSync — so without the target-id match this goes true for a
    // stale done/error left over from a different, already-superseded file.
    ((transcriptionStatus.phase === 'done'
      || transcriptionStatus.phase === 'warning'
      || transcriptionStatus.phase === 'error')
      && transcriptionTargetIdRef.current === effectiveVoiceoverId)
    || (effectiveVoiceoverId !== undefined
        && project.lastTranscribedAssetId === effectiveVoiceoverId
        && (project.transcriptTokens?.length ?? 0) > 0)
    // Same-file detection (handleVoiceoverStaged): a freshly staged file always
    // gets a brand-new Asset id, so the clause above never matches it even when
    // its content was already transcribed and Whisper was deliberately skipped.
    || (pendingVoiceover !== null
        && project.lastTranscribedFileIdentity === getFileIdentity(pendingVoiceover.file)
        && (project.transcriptTokens?.length ?? 0) > 0);
  const applySyncDisabled = effectiveVoiceoverId !== undefined && !transcriptionReady;

  usePlayback({
    isPlaying,
    setIsPlaying,
    setCurrentTime,
    audioRef,
    segments: project.segments,
    voiceover,
    globalPlaybackSpeed,
    isExporting: exportState.isExporting,
  });

  // --- Export success toast: auto-dismiss after EXPORT_SUCCESS_TOAST_DURATION_MS ---
  useEffect(() => {
    if (!exportState.showExportSuccess) return;
    const t = setTimeout(() => dismissSuccess(), EXPORT_SUCCESS_TOAST_DURATION_MS);
    return () => clearTimeout(t);
  }, [exportState.showExportSuccess, dismissSuccess]);

  // --- Phase 2a H.4 guard: unsupported-language log entry ---
  // Fires once per DISTINCT unsupported value (loggedUnsupportedLanguageRef),
  // not on every render a language happens to still be unsupported — an
  // undefined/supported value resets the ref so a later different unsupported
  // value logs again. The banner below is a plain derived render, independent
  // of this effect, so it doesn't need its own "already shown" tracking.
  const loggedUnsupportedLanguageRef = useRef<string | undefined>(undefined);
  useEffect(() => {
    const lang = project.language;
    if (lang === undefined || SUPPORTED_LANGUAGE_CODES.includes(lang)) {
      loggedUnsupportedLanguageRef.current = undefined;
      return;
    }
    if (loggedUnsupportedLanguageRef.current === lang) return;
    loggedUnsupportedLanguageRef.current = lang;
    setLanguageBannerDismissed(false);
    const entry = buildUnsupportedLanguageEntry(mintSyncLogId(), lang);
    setProject(prev => appendSyncLogEntries(prev, [entry]));
  }, [project.language]);
  const isLanguageUnsupported =
    project.language !== undefined && !SUPPORTED_LANGUAGE_CODES.includes(project.language);

  // Shortcut suppression (design §7). Undo/redo must stand down whenever another
  // surface legitimately owns the keyboard: any of the five modals that run their
  // own keydown listeners, the DEV panel, or an export in flight (undoing a
  // timing change mid-render is meaningless — the pipeline has already
  // snapshotted). A focused text field is handled separately, inside the branch,
  // because there the correct behaviour is to leave the event alone entirely so
  // the OS's own text undo runs.
  isExportingRef.current = exportState.isExporting;

  const shortcutsSuppressedRef = useRef(false);
  shortcutsSuppressedRef.current =
    showStockSearch || showNewProjectModal || showProjectSettingsModal
    || showExportSettingsModal || showReviewMapping || devPanelOpen
    || showManageModelsModal || exportState.isExporting;

  const togglePlay = () => setIsPlaying(p => !p);

  const handleSpeedClick = useCallback(() => {
    setGlobalPlaybackSpeed(prev => {
      const idx = SPEED_LADDER.indexOf(prev as typeof SPEED_LADDER[number]);
      if (idx === -1 || idx === SPEED_LADDER.length - 1) return SPEED_LADDER[0];
      return SPEED_LADDER[idx + 1] ?? prev;
    });
  }, []);

  // Add spacebar play/pause
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // APP SHORTCUTS — reload and the devtools toggle (2026-08-08, owner
      // request). Resolved by `services/appShortcuts.ts`; see that file for the
      // chord table and for why these — unlike undo/redo — are NOT suppressed by
      // a focused text field (there is no "reload this text field" for them to
      // shadow, whereas Cmd+Z genuinely has a text meaning).
      //
      // Placed ahead of undo/redo purely so reload is as unconditional as
      // possible; the two key sets are disjoint, so the order cannot change any
      // outcome (asserted in appShortcuts.test.ts).
      const appAction = resolveAppShortcut(e, { exporting: isExportingRef.current });
      if (appAction !== 'ignore') {
        e.preventDefault();
        if (appAction === 'reload') {
          window.location.reload();
        } else if (appAction === 'reload-blocked') {
          // THE ONE PLACE THESE SHORTCUTS DECLINE TO DO WHAT THE KEY SAYS, and
          // deliberately: a reload during an export destroys minutes of
          // unrecoverable work — the render dies with the page, the ffmpeg
          // sidecar is left mid-run, and its session temp dir is orphaned. The
          // key is still consumed (preventDefault above) so the webview's own
          // reload cannot fire behind us.
          showToast('Cancel the export before reloading.');
        } else {
          // Devtools live on the Rust side — Tauri exposes no JS API for them.
          // Fire-and-forget: a failure here (a release build without the
          // `devtools` feature) is surfaced as a toast, never thrown.
          void (async () => {
            try {
              const { invoke } = await import('@tauri-apps/api/core');
              await invoke('toggle_devtools');
            } catch (err) {
              console.warn('[devtools] toggle unavailable:', err);
              showToast('Developer tools are not available in this build.');
            }
          })();
        }
        return;
      }
      // UNDO / REDO (Phase 2, 2026-08-08). The DECISION — which chord means
      // what, and when to stand down — lives in `services/undoShortcut.ts`,
      // where it is swept exhaustively by unit test rather than inspected by eye
      // inside this ~120-line handler. That file's header records the real-shell
      // measurement this design rests on, and what remains unverified.
      //
      // `preventDefault()` on 'consume' as well as on undo/redo is deliberate:
      // this app configures no menu, so Tauri's default macOS Edit menu is live
      // (it was observed to FLASH on both chords) and its Cmd+Z is bound to the
      // OS text responder. Leaving the event alone while a modal is open would
      // let that responder perform a text undo behind the modal the user is
      // looking at.
      const shortcut = resolveShortcutAction(e, {
        isTextEntry: isTextEntryElement(document.activeElement),
        suppressed: shortcutsSuppressedRef.current,
        dragging: isResizingRef.current,
      });
      if (shortcut !== 'ignore') {
        e.preventDefault();
        if (shortcut === 'undo') handleUndoRef.current();
        else if (shortcut === 'redo') handleRedoRef.current();
        return;
      }
      if (e.code === 'Space') {
        if (!isTextEntryElement(document.activeElement)) {
          e.preventDefault();
          setIsPlaying(p => !p);
        }
      } else if (e.key === '+' || e.key === '=') {
        if (!isTextEntryElement(document.activeElement)) {
          e.preventDefault();
          setSliderT(t => Math.min(1, Math.round((t + 0.1) * 100) / 100));
        }
      } else if (e.key === '-' || e.key === '_') {
        if (!isTextEntryElement(document.activeElement)) {
          e.preventDefault();
          setSliderT(t => Math.max(0, Math.round((t - 0.1) * 100) / 100));
        }
      } else if (e.key === 'ArrowRight') {
        if (!isTextEntryElement(document.activeElement)) {
          e.preventDefault();
          setGlobalPlaybackSpeed(prev => {
            const idx = SPEED_LADDER.indexOf(prev as typeof SPEED_LADDER[number]);
            if (idx === -1 || idx === SPEED_LADDER.length - 1) return prev;
            return SPEED_LADDER[idx + 1] ?? prev;
          });
        }
      } else if (e.key === 'ArrowLeft') {
        if (!isTextEntryElement(document.activeElement)) {
          e.preventDefault();
          setGlobalPlaybackSpeed(prev => {
            const idx = SPEED_LADDER.indexOf(prev as typeof SPEED_LADDER[number]);
            if (idx <= 0) return prev;
            return SPEED_LADDER[idx - 1] ?? prev;
          });
        }
      } else if (e.key === 'f' || e.key === 'F') {
        if (!isTextEntryElement(document.activeElement)) {
          e.preventDefault();
          previewStageRef.current?.toggleFullscreen();
        }
      } else if (
        // WS2 T2.1 Commit 4, corrected in ws2-23 — S/D require a TARGET
        // segment: the explicitly selected one, else the one under the
        // playhead (`resolveShortcutTargetSegmentId`). The original gate read
        // `selectedSegmentId` alone on the belief that clicking a clip sets
        // it; Timeline.tsx only sets it on DOUBLE-click, which made both keys
        // dead on the natural gesture. Refused, same as every other bare-key
        // shortcut here, while a text field has focus.
        (e.key === 's' || e.key === 'S') && !e.ctrlKey && !e.metaKey && !e.altKey
        && !isTextEntryElement(document.activeElement) && resolveShortcutTargetSegmentId()
      ) {
        e.preventDefault();
        handleSplitSelectedSegment();
      } else if (
        (e.key === 'd' || e.key === 'D') && !e.ctrlKey && !e.metaKey && !e.altKey
        && !isTextEntryElement(document.activeElement) && resolveShortcutTargetSegmentId()
      ) {
        e.preventDefault();
        handleDeleteSelectedSegment();
      } else if (import.meta.env.DEV && (e.ctrlKey || e.metaKey) && e.shiftKey && (e.key === 'D' || e.key === 'd')) {
        e.preventDefault();
        setDevPanelOpen(prev => !prev);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  // Blur range sliders on release so a drag doesn't leave focus (and the
  // spacebar guard above) stuck on the slider indefinitely.
  useEffect(() => {
    const handler = (e: PointerEvent) => {
      // COALESCING (design §3.2): a slider gesture's entry closes on its RELEASE,
      // not on an idle timer — a release is a fact, a timer is a guess, and a slow
      // deliberate drag crossing the timer would split into two entries. This
      // starts the grace period rather than closing outright, because
      // EffectsPanel debounces its grade writes at 120ms and the gesture's LAST
      // write therefore lands after this point; closing hard here would push that
      // trailing write as a spurious second entry.
      //
      // Folded into the EXISTING pointerup listener rather than adding a second
      // one — same event, same moment, and one listener cannot get out of step
      // with itself.
      openGestureRef.current = notePointerUp(openGestureRef.current, Date.now());
      const target = e.target;
      if (target instanceof HTMLInputElement && target.type === 'range') {
        target.blur();
      }
    };
    window.addEventListener('pointerup', handler);
    return () => window.removeEventListener('pointerup', handler);
  }, []);

  // Reset zoom to the default midpoint whenever the active project changes.
  // D15 fix (corrected) — a plain "skip the first effect run" guard doesn't
  // work here: `project` starts as makeDefaultProject() and the reload-hydration
  // effect (above) later swaps in the real persisted project via setProject,
  // which changes project.id a SECOND time (after the "first run" guard was
  // already consumed on mount by the placeholder id) — so the guard's skip
  // landed on the wrong transition and the real hydration swap still clobbered
  // the just-restored sliderT back to 0.5 on every reload. Gating on isHydrating
  // instead: skip entirely while hydration is in flight, and skip exactly once
  // more right after it completes (the just-loaded project settling in) — a
  // project.id change strictly after that point is a genuine user-initiated
  // switch, and only that should reset zoom.
  const hasSkippedHydrationResetRef = useRef(false);
  useEffect(() => {
    if (isHydrating) return;
    if (!hasSkippedHydrationResetRef.current) {
      hasSkippedHydrationResetRef.current = true;
      return;
    }
    setSliderT(0.5);
    setGlobalPlaybackSpeed(1);
  }, [project.id, isHydrating]);

  // D15 fix — persist zoom level alongside timelineScrollLeft (Timeline.tsx's
  // scroll listener) so a reload restores the pixel offset at the same zoom it
  // was saved at.
  useEffect(() => {
    patchUiState({ sliderT });
  }, [sliderT]);

  // Auto-scroll timeline to keep playhead in view during playback
  useEffect(() => {
    if (isPlaying) {
      const scrollArea = document.getElementById('timeline-scroll-area');
      if (scrollArea) {
        const pixelsPerSecond = pixelsPerSecondRef.current;
        const playheadX = currentTime * pixelsPerSecond;
        const viewWidth = scrollArea.clientWidth;
        const scrollLeft = scrollArea.scrollLeft;
        const padding = 150; // threshold from edge to start scrolling
        // Max meaningful scroll, measured from the actual timeline CONTENT width
        // (segments, starting at x=0) — NOT scrollArea.scrollWidth. The decorative
        // time ruler overflows the content by a few px, so scrollWidth stays > view
        // even when the timeline visually fits, which let the auto-scroll nudge
        // segment 1 off the left edge near playback end. Content width = 0 maxScroll
        // when it fits, pinning scrollLeft to 0.
        const totalDur = projectRef.current.segments.reduce((acc, s) => acc + s.duration, 0);
        const contentWidth = totalDur * pixelsPerSecond;
        const maxScroll = Math.max(0, contentWidth - viewWidth);

        if (playheadX > scrollLeft + viewWidth - padding) {
          scrollArea.scrollLeft = Math.min(maxScroll, Math.max(0, playheadX - viewWidth + padding));
        } else if (playheadX < scrollLeft + (padding / 2)) {
          scrollArea.scrollLeft = Math.min(maxScroll, Math.max(0, playheadX - (padding / 2)));
        }
      }
    }
  }, [currentTime, isPlaying, sliderT]);

  useEffect(() => {
    if (!stockError) return;
    const t = setTimeout(() => setStockError(null), 5000);
    return () => clearTimeout(t);
  }, [stockError]);

  // Clamp previewHeight when a panel collapses/expands — the center column changes
  // size, which changes both the 16:9 aspect cap and the timeline-floor cap. Wait
  // 310ms so the CSS transition (duration-300) settles before we measure.
  useEffect(() => {
    const id = setTimeout(() => {
      const rect = centerColRef.current?.getBoundingClientRect();
      if (!rect) return;
      const maxAllowed = Math.floor(rect.width * (9 / 16));
      const minTlH = Math.max(MIN_TIMELINE_HEIGHT, Math.floor(rect.height * 0.30));
      const timelineFloor = rect.height - minTlH - 4;
      setPreviewHeight(h => Math.min(h, Math.min(maxAllowed, timelineFloor)));
    }, 310);
    return () => clearTimeout(id);
  }, [leftPanelCollapsed, rightPanelCollapsed]);

  // Validate the useState initializer against the real layout BEFORE first paint.
  // window.innerHeight may differ from the center column's actual usable height.
  // useLayoutEffect runs synchronously after DOM mutation but before the browser
  // paints, so the corrected height is applied without a visible "jump then settle".
  useLayoutEffect(() => {
    const rect = centerColRef.current?.getBoundingClientRect();
    if (!rect) return;
    const maxAllowed = Math.floor(rect.width * (9 / 16));
    const minTlH = Math.max(MIN_TIMELINE_HEIGHT, Math.floor(rect.height * 0.30));
    const timelineFloor = rect.height - minTlH - 4;
    setPreviewHeight(h => Math.min(h, Math.min(maxAllowed, timelineFloor)));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // (Canvas mirror removed — export now uses ffmpeg.wasm frame renderer, not MediaRecorder)

  const handleNewProject = (): void => {
    // Save current project first, then show the name-picking modal.
    saveNow();
    setShowNewProjectModal(true);
  };

  const handleNewProjectConfirm = async (name: string, aspectRatio: AspectRatio, resolutionTier: ResolutionTier): Promise<void> => {
    setShowNewProjectModal(false);
    // Discard any staging-time voiceover transcription left over from the
    // outgoing project — otherwise effectiveVoiceoverId keeps pointing at its
    // ephemeral asset id, which can never match the new project's
    // lastTranscribedAssetId, leaving Apply Sync stuck disabled forever.
    handleVoiceoverUnstaged();
    // Revoke current project's blob URLs (they belong to the old session).
    project.assets.forEach(a => { if (a.url) URL.revokeObjectURL(a.url); });
    // Build the new project and register it immediately — don't wait for the
    // debounced hook so the registry always reflects this project by the time
    // the dashboard next renders.
    const fresh = makeDefaultProject();
    fresh.name = name;
    // Locked forever at creation (aspectRatio) / editable later in Project
    // Settings (resolutionTier) — Project Settings + Aspect Ratio Step 3.
    fresh.aspectRatio = aspectRatio;
    fresh.resolutionTier = resolutionTier;
    // Mark as confirmed so auto-save and saveNow will persist it going forward.
    fresh.confirmed = true;
    const outcome = await saveProject(fresh); // persist full project JSON
    if (!outcome.ok) {
      showToast(`Couldn't save the new project (${outcome.reason}). Try again, or check available storage.`);
    }
    setLastOpenedProjectId(fresh.id);
    upsertProjectMeta({ // ensure registry entry exists right away
      id: fresh.id,
      name: fresh.name,
      savedAt: Date.now(),
      segmentCount: 0,
    });
    // New Project clears history (design §6.0) — an undo stack that survived
    // could restore the OUTGOING project's segments onto this one's assets.
    // Silent, because the write itself is not a user edit of this project.
    const outgoingId = liveProjectRef.current.id;
    setProjectSilent(fresh);
    setHistory(emptyHistory<Project>());
    void clearPersistedHistory(outgoingId);
    setIsSynced(false);
    setCurrentTime(0);
    setGlobalPlaybackSpeed(1);
    setIsPlaying(false);
    setSelectedSegmentId(null);
  };

  const handleSwitchProject = async (id: string, opts?: { preserveUiState?: boolean }): Promise<void> => {
    setShowDashboard(false);
    if (id === project.id) return;

    // Discard any staging-time voiceover transcription left over from the
    // outgoing project — otherwise effectiveVoiceoverId keeps pointing at its
    // ephemeral asset id, which can never match the target project's
    // lastTranscribedAssetId, leaving Apply Sync stuck disabled forever.
    handleVoiceoverUnstaged();

    // Save current project before switching — only if it was confirmed by the user.
    if (project.confirmed) {
      saveNow();
    }

    // WS1 Session O — distinguish "no such project" from "present but broken",
    // and surface the latter instead of failing silently. `loadProjectDetailed`
    // has already recorded a poison flag for this id, which makes `saveProject`
    // refuse every subsequent write to it, so the unreadable raw bytes stay on
    // disk exactly as they are rather than being autosaved over.
    const outcome = await loadProjectDetailed(id);
    if (outcome === null) {
      console.error('[kinetix] Cannot switch to project — not found in storage:', id);
      showToast('That project could not be found in storage.');
      return;
    }
    if (!outcome.ok) {
      console.error('[kinetix] Cannot switch to project — load failed:', id, outcome);
      showToast(
        `This project could not be opened (${outcome.reason}). Its ${outcome.rawLength} bytes of saved data have been left untouched, and saving is blocked for it so nothing overwrites them.`,
      );
      return;
    }
    const saved = { project: outcome.project, savedAt: outcome.savedAt };

    // Revoke current project's blob URLs.
    project.assets.forEach(a => { if (a.url) URL.revokeObjectURL(a.url); });

    // Rehydrate the target project's assets from IndexedDB.
    const storedAssets = await getAllAssetsForProject(saved.project.id);
    const blobMap = new Map(storedAssets.map(a => [a.id, a]));

    const droppedIds = new Set<string>();
    const rehydratedAssets = (await Promise.all(
      saved.project.assets.map(async asset => {
        const stored = blobMap.get(asset.id);
        if (!stored) {
          console.warn(
            `[kinetix] Dropping orphaned asset on switch — id: ${asset.id}, name: ${asset.name}`,
          );
          droppedIds.add(asset.id);
          return null;
        }
        const rehydratedUrl = URL.createObjectURL(stored.blob);
        const rehydratedFile = new File([stored.blob], asset.name, { type: stored.blob.type });
        // Back-compat backfill: a project saved before Asset.duration existed
        // carries no clip length. This is the one place every stored asset's
        // blob URL is recreated, so probing here is what keeps the trim bar
        // and the source-time clamps working on an older project instead of
        // declining for the whole session.
        const duration = asset.type === 'video' && asset.duration === undefined
          ? await getMediaDuration(rehydratedUrl, 'video')
          : asset.duration;
        return { ...asset, url: rehydratedUrl, file: rehydratedFile, duration };
      }),
    )).filter((a): a is NonNullable<typeof a> => a !== null);

    const rehydratedSegments = saved.project.segments.map(seg => {
      if (seg.assetId !== undefined && droppedIds.has(seg.assetId)) {
        return { ...seg, assetId: undefined };
      }
      return seg;
    });

    let rehydratedVoiceoverId = saved.project.voiceoverId;
    if (rehydratedVoiceoverId !== undefined && droppedIds.has(rehydratedVoiceoverId)) {
      rehydratedVoiceoverId = undefined;
    }

    // SILENT, and history is cleared. This is the ONE write that serves both
    // "the user opened a different project" and "the page reloaded and we are
    // restoring the same one" — the two cases the owner ruled must behave
    // DIFFERENTLY (§6.0: a switch clears, a reload keeps). They are told apart
    // by `opts.preserveUiState`, which is already set only on the reload path
    // (see the mount effect's handleSwitchProjectRef call). The reload branch's
    // history restore lands in the persistence commit; here, both paths clear,
    // so a switch is correct today and a reload is merely not-yet-restoring
    // rather than wrong.
    setProjectSilent({
      ...saved.project,
      assets: rehydratedAssets,
      segments: rehydratedSegments,
      voiceoverId: rehydratedVoiceoverId,
      // Any project loaded from storage was previously confirmed by the user,
      // so mark it as confirmed to enable auto-save going forward.
      confirmed: true,
    });
    // HISTORY (design §6.0). A genuine project switch CLEARS; a page RELOAD of
    // the same project RESTORES. `opts.preserveUiState` is already set only on
    // the reload path (the mount effect passes it; no user-initiated switch
    // does), so it is the existing, load-bearing discriminator rather than a new
    // flag that could drift out of step with it.
    //
    // `loadHistory` applies the real gate — a per-app-process token — so even
    // here an APP RESTART restores nothing. Both conditions must hold: the same
    // project reopened by a reload, AND the same app process.
    if (opts?.preserveUiState) {
      void loadHistory(saved.project.id, rehydratedAssets).then(restored => {
        if (restored) setHistory(restored);
      });
    } else {
      setHistory(emptyHistory<Project>());
      void clearPersistedHistory(saved.project.id);
    }
    setLastOpenedProjectId(saved.project.id);
    setIsSynced(rehydratedSegments.length > 0);
    setIsPlaying(false);
    if (opts?.preserveUiState) {
      // Reload of the last-open project: keep the user's playhead + selection,
      // already restored from kinetix:ui:v1 by the useState initializers. Only
      // clear a dangling selection whose segment no longer exists.
      setSelectedSegmentId(prev =>
        prev && rehydratedSegments.some(s => s.id === prev) ? prev : null,
      );
    } else {
      // Explicit switch to a (possibly different) project: reset to the start.
      setCurrentTime(0);
      setGlobalPlaybackSpeed(1);
      setSelectedSegmentId(null);
    }
  };

  // Keep the ref up to date every render so the mount-only hydration effect
  // (which closes over the ref, not the function directly) always invokes the
  // latest version of handleSwitchProject.
  handleSwitchProjectRef.current = handleSwitchProject;

  const SHOW_GLOBAL_TEXT_LAYERS_IN_RIGHT_PANEL = false;

  if (isHydrating) {
    return (
      <div className="min-h-screen bg-[#0A0A0A] flex items-center justify-center">
        <span className="text-[#E4E3E0] text-sm font-mono tracking-widest uppercase">Loading…</span>
      </div>
    );
  }

  // Rendered as a variable (not two separate early returns) so DevTestPanel
  // below has exactly ONE mount point regardless of showDashboard — two
  // separate <DevTestPanel/> JSX sites would remount it on every dashboard
  // <-> editor transition, wiping its in-progress spike/fixture results the
  // instant "Load 500-Segment Fixture" switches the view away from the
  // dashboard.
  const mainContent = showDashboard ? (
    <ProjectDashboard
      currentProjectId={project.confirmed ? project.id : null}
      onSelectProject={(id) => {
        void handleSwitchProject(id);
        setShowDashboard(false);
      }}
      onNewProject={() => {
        setShowDashboard(false);
        setShowNewProjectModal(true);
      }}
    />
  ) : (
    <div className="min-h-screen bg-[var(--kx-bg)] text-[#E4E3E0] font-sans selection:bg-[var(--kx-accent)] selection:text-white flex overflow-hidden h-screen">

      {/* Body — 3 columns, full height */}
      <div className="flex flex-1 overflow-hidden h-full">

        {/* Left panel — 20vw collapsible */}
        <ErrorBoundary fallback={(err, reset) => (
          <div style={{ width: '20vw' }} className="flex-shrink-0 flex flex-col h-full border-r border-[var(--kx-line)] bg-[var(--kx-panel)]">
            <PanelFallback label="Left panel" error={err} reset={reset} />
          </div>
        )}>
        <div
          style={{ width: leftPanelCollapsed ? 0 : '20vw' }}
          className="flex-shrink-0 flex flex-col h-full border-r border-[var(--kx-line)] bg-[var(--kx-panel)] overflow-hidden transition-[width] duration-300 ease-in-out"
        >
          <DropZonePanel
            segments={project.segments}
            restoredSegmentIds={restoredSegmentIdsMemo}
            assets={project.assets}
            voiceoverId={project.voiceoverId}
            script={project.script}
            persistedScript={project.script}
            persistedScriptName={project.scriptFileName ?? ''}
            persistedScriptUpdatedAt={project.scriptUpdatedAt}
            persistedSceneDetails={project.sceneDetails}
            persistedSceneDetailsName={project.sceneDetailsFileName ?? ''}
            persistedSceneDetailsUpdatedAt={project.sceneDetailsUpdatedAt}
            persistedVoiceoverName={project.assets.find(a => a.id === project.voiceoverId)?.name ?? ''}
            persistedAssetCount={project.assets.filter(a => a.type !== 'audio').length}
            isSynced={isSynced}
            onClearScript={() => setProject(p => ({ ...p, script: '', scriptFileName: '', scriptUpdatedAt: undefined }))}
            onClearSceneDetails={() => setProject(p => ({ ...p, sceneDetails: '', sceneDetailsFileName: '', sceneDetailsUpdatedAt: undefined }))}
            onDeleteAsset={handleDeleteAsset}
            onDeleteAllAssets={handleDeleteAllAssets}
            onDeleteVoiceover={() => { if (project.voiceoverId) handleDeleteAsset(project.voiceoverId); }}
            onApplySync={handleApplySyncFromFiles}
            onVoiceoverStaged={handleVoiceoverStaged}
            onVoiceoverUnstaged={handleVoiceoverUnstaged}
            applySyncDisabled={applySyncDisabled}
            onUndo={handleUndo}
            onRedo={handleRedo}
            canUndo={undoAvailable}
            canRedo={redoAvailable}
            undoLabel={undoLabel}
            redoLabel={redoLabel}
            onSegmentClick={handleSegmentClick}
            onToggleLock={handleToggleLock}
            onLockAll={() => setProjectSilent(p => ({ ...p, segments: p.segments.map(s => ({ ...s, locked: true })) }))}
            onUnlockAll={handleUnlockAll}
            allLocked={project.segments.length > 0 && project.segments.every(s => s.locked === true)}
            onOpenReviewMapping={() => setShowReviewMapping(true)}
            headings={project.headings ?? []}
            onInsertHeading={handleInsertHeading}
            onDeleteHeading={handleDeleteHeading}
            onMoveHeading={handleMoveHeading}
            onHeadingClick={handleHeadingClick}
            selectedHeadingId={selectedHeadingId ?? undefined}
            selectedSegmentId={selectedSegmentId ?? undefined}
            currentSegmentId={currentSegment?.id}
            selectedSegmentIds={selectedSegmentIds}
            onToggleSegmentSelect={onToggleSegmentSelect}
            onSelectAllSegments={onSelectAllSegments}
            onClearSegmentSelection={onClearSegmentSelection}
            onApplyEffect={handleApplyEffect}
            onAutoGrade={handleAutoGrade}
            onGradeLive={handleGradeLive}
            activeGrade={activeGrade}
            activeGradeSegmentId={activeGradeSegmentId}
            activeSegmentDuration={activeSegmentDuration}
            activeAnimationScaleRate={activeAnimationScaleRate}
            globalTransition={project.globalTransition}
            globalTransitionDuration={project.globalTransitionDuration ?? 0.5}
            globalAnimation={project.globalAnimation ?? 'none'}
            globalOverlayFilter={project.globalOverlayFilter ?? 'none'}
            globalOverlayConfig={project.globalOverlayConfig}
            currentTransition={project.globalTransition}
            currentAnimation={project.globalAnimation ?? ''}
            currentOverlayFilter={project.globalOverlayFilter ?? ''}
            currentOverlayConfig={project.globalOverlayConfig}
            onTransitionChange={(v) => setProject(p => ({ ...p, globalTransition: v }))}
            onTransitionDurationChange={(v) => setProject(p => ({ ...p, globalTransitionDuration: v }))}
            onApplyTransitionToAll={() => setProject(p => ({ ...p, segments: p.segments.map(s => ({ ...s, transition: p.globalTransition })) }))}
            onAnimationChange={(v) => setProject(p => ({ ...p, globalAnimation: v as AnimationType }))}
            onApplyAnimationToAll={() => setProject(p => ({ ...p, segments: p.segments.map(s => ({ ...s, animation: p.globalAnimation as AnimationType })) }))}
            onFilterChange={(v) => setProject(p => ({ ...p, globalOverlayFilter: v }))}
            onApplyFilterToAll={() => setProject(p => ({ ...p, segments: p.segments.map(s => ({ ...s, overlayFilter: p.globalOverlayFilter })) }))}
            onOverlayConfigChange={(v) => setProject(p => ({ ...p, globalOverlayConfig: { ...p.globalOverlayConfig, ...v } }))}
            onApplyTransitionPreset={(v) => setProject(p => ({ ...p, globalTransition: v as TransitionType }))}
            onApplyAnimationPreset={(v) => setProject(p => ({ ...p, globalAnimation: v as AnimationType }))}
            onApplyOverlayFilterPreset={(v) => setProject(p => ({ ...p, globalOverlayFilter: v as string }))}
            onApplyOverlayConfigPreset={(v) => setProject(p => ({ ...p, globalOverlayConfig: { ...p.globalOverlayConfig, ...v } }))}
            onBackToProjects={() => {
              if (project.confirmed) saveNow();
              clearLastOpenedProjectId();
              // Owner ruling 2026-08-08: returning to the dashboard clears
              // history, and re-opening a project starts fresh — so the
              // persisted copy goes too, not just the in-memory stack.
              setHistory(emptyHistory<Project>());
              void clearPersistedHistory(project.id);
              setShowDashboard(true);
            }}
            projectName={project.name}
            onRename={(name) => setProject(p => ({ ...p, name }))}
            activeLeftTab={activeLeftTab}
            onActiveLeftTabChange={setActiveLeftTab}
            isPlaying={isPlaying}
          />
          {transcriptionStatus.phase !== 'idle' && (
            <div className="flex-shrink-0">
              <TranscriptionBar
                status={transcriptionStatus}
                onCancel={cancelTranscription}
                onDismiss={dismissError}
                onDownloadModel={() => setShowManageModelsModal(true)}
              />
            </div>
          )}
        </div>
        </ErrorBoundary>

        {/* Left collapse toggle strip */}
        <button
          onClick={() => setLeftPanelCollapsed(p => !p)}
          className="w-3 flex-shrink-0 flex items-center justify-center bg-[#0D0D0D] hover:bg-[#1A1A1A] border-r border-[#1A1A1A] transition-colors cursor-col-resize z-10"
          title={leftPanelCollapsed ? 'Expand panel' : 'Collapse panel'}
          aria-label={leftPanelCollapsed ? 'Expand left panel' : 'Collapse left panel'}
        >
          {leftPanelCollapsed ? <ChevronRight size={10} className="text-zinc-600" /> : <ChevronLeft size={10} className="text-zinc-600" />}
        </button>

        {/* Center — preview + timeline stacked */}
        <div className="flex-1 flex flex-col overflow-hidden bg-[#020202] min-w-0 relative" ref={centerColRef}>

          {/* Preview — height-driven, draggable divider below */}
          <div
            className="flex-shrink-0 w-full bg-[#020202] relative pb-[15px]"
            style={{ height: previewHeight + 'px' }}
          >
            <div className="h-full w-full flex items-center justify-center bg-[#020202]">
              {/* Frame aspect ratio: derived from the project's own
                  aspectRatio field (Project Settings Step 2), locked at
                  creation via NewProjectModal — '16:9' when absent (every
                  pre-existing project), matching the previous hardcoded
                  behavior exactly. Expressed as an inline style (rather than
                  the aspect-video utility class) so this stays the one place
                  that needs to change per project. bg-black makes the
                  media's object-contain letterbox/pillarbox bars solid black. */}
              <div className="h-full bg-black border border-[#333333]" style={{ aspectRatio: aspectRatioToCss(project.aspectRatio ?? DEFAULT_ASPECT_RATIO) }}>
              <ErrorBoundary fallback={(err, reset) => (
                <PanelFallback label="Preview" error={err} reset={reset} />
              )}>
                <PreviewStage
                  ref={previewStageRef}
                  segments={project.segments}
                  currentSegment={currentSegment ?? undefined}
                  currentTime={currentTime}
                  globalPlaybackSpeed={globalPlaybackSpeed}
                  globalTransition={project.globalTransition}
                  globalTransitionDuration={project.globalTransitionDuration ?? 0.5}
                  globalOverlayConfig={project.globalOverlayConfig}
                  assets={project.assets}
                  isPlaying={isPlaying}
                  isResizingRef={isResizingRef}
                  nativeWidth={previewNativeDimensions.width}
                  nativeHeight={previewNativeDimensions.height}
                  onUpdateExtraOverlayPosition={updateExtraOverlayPosition}
                  textLayers={project.textLayers ?? []}
                  headings={project.headings ?? []}
                  autoGradeSamplerRef={autoGradeSamplerRef}
                  onTogglePlay={togglePlay}
                  onSpeedCycle={handleSpeedClick}
                />
              </ErrorBoundary>
              </div>
            </div>

            {/* Left pill — seek + play/pause + timecode */}
            <div className="absolute bottom-3 left-3 z-30 flex items-center gap-2 bg-[#0D0D0D]/90 backdrop-blur-sm border border-[#2A2A2A] rounded-full px-3 py-1.5 shadow-lg">
              <button
                onClick={() => {
                  setCurrentTime(0);
                  if (audioRef.current) audioRef.current.currentTime = 0;
                  const tl = document.getElementById('timeline-scroll-area');
                  if (tl) tl.scrollLeft = 0;
                }}
                className="text-zinc-500 hover:text-white transition-colors"
              >
                <RotateCcw size={11} />
              </button>
              <button
                onClick={togglePlay}
                className="w-5 h-5 rounded-full bg-[#F27D26] hover:bg-[#E06A15] flex items-center justify-center transition-colors flex-shrink-0"
              >
                {isPlaying
                  ? <Pause size={9} fill="white" className="text-white" />
                  : <Play size={9} fill="white" className="text-white ml-0.5" />}
              </button>
              <SpeedBadge speed={globalPlaybackSpeed} onCycle={handleSpeedClick} />
              <span className="text-[10px] text-zinc-400 font-mono tabular-nums">
                {String(Math.floor(currentTime / 60)).padStart(2,'0')}:{String(Math.floor(currentTime % 60)).padStart(2,'0')}:{String(Math.floor((currentTime % 1) * 100)).padStart(2,'0')}
              </span>
            </div>

            {/* Right pill — zoom */}
            <div className="absolute bottom-3 right-3 z-30 flex items-center gap-2 bg-[#0D0D0D]/90 backdrop-blur-sm border border-[#2A2A2A] rounded-full px-3 py-1.5 shadow-lg">
              <span className="text-[10px] text-zinc-500">Zoom</span>
              <input
                type="range" min={0} max={1} step={0.01}
                value={sliderT}
                onChange={e => setSliderT(parseFloat(e.target.value))}
                className="w-20 accent-[#F27D26] h-1"
              />
            </div>
          </div>

          {/* Draggable divider */}
          <div
            className="h-[6px] flex-shrink-0 bg-[#F27D26] shadow-[0_0_10px_rgba(242,125,38,0.45)] cursor-row-resize"
            onMouseDown={(e) => {
              e.preventDefault();
              isDraggingDivider.current = true;
              const startY = e.clientY;
              const startHeight = previewHeight;
              // B3 — measure the center column ONCE; its box doesn't change while the
              // divider is being dragged, so the clamp bounds are constant for the gesture.
              const rect = centerColRef.current?.getBoundingClientRect();
              const centerWidth = rect?.width ?? window.innerWidth * 0.65;
              const centerHeight = rect?.height ?? window.innerHeight;
              const maxAllowed = Math.floor(centerWidth * (9 / 16));
              const minTlH = Math.max(MIN_TIMELINE_HEIGHT, Math.floor(centerHeight * 0.30));
              const timelineFloor = centerHeight - minTlH - 4;
              const clampHeight = (y: number): number => Math.min(
                Math.max(startHeight + (y - startY), 180),
                Math.min(maxAllowed, timelineFloor),
              );
              // B5 — coalesce mousemoves into one setPreviewHeight per animation frame.
              let rafId: number | null = null;
              let pendingY = startY;
              const applyFrame = () => {
                rafId = null;
                if (!isDraggingDivider.current) return;
                setPreviewHeight(clampHeight(pendingY));
              };
              const onMove = (ev: MouseEvent) => {
                if (!isDraggingDivider.current) return;
                pendingY = ev.clientY;
                if (rafId === null) rafId = requestAnimationFrame(applyFrame);
              };
              const onUp = () => {
                isDraggingDivider.current = false;
                if (rafId !== null) { cancelAnimationFrame(rafId); rafId = null; }
                // Land exactly on the release position, even if the last frame was
                // still pending.
                setPreviewHeight(clampHeight(pendingY));
                window.removeEventListener('mousemove', onMove);
                window.removeEventListener('mouseup', onUp);
              };
              window.addEventListener('mousemove', onMove);
              window.addEventListener('mouseup', onUp);
            }}
          />

          {/* Timeline — fills remaining height.
              WS2 ws2-23 (bug 5): `relative z-[45]` puts the timeline ABOVE the
              drawer's click-outside-to-dismiss backdrop (z-40, below) and
              below the drawer itself (z-50). Without it, `elementFromPoint` at
              a clip's centre returned the backdrop whenever the drawer was
              open — verified live — so the clip's own `onContextMenu` (the
              "Restore absorbed segments" menu) and every other clip pointer
              handler were unreachable in exactly the state a user is in after
              opening a scene. Clicking a clip now retargets the drawer instead
              of dismissing it; clicking the PREVIEW area still dismisses. */}
          <div className="relative z-[45] flex-1 min-h-0 pb-2">
            <ErrorBoundary fallback={(err, reset) => (
              <PanelFallback label="Timeline" error={err} reset={reset} />
            )}>
              <Timeline
                initialScrollLeft={initialTimelineScrollLeft}
                segments={project.segments}
                assets={project.assets}
                headings={project.headings ?? []}
                currentSegmentId={currentSegment?.id}
                currentTime={currentTime}
                isPlaying={isPlaying}
                isSynced={isSynced}
                sliderT={sliderT}
                onPixelsPerSecondChange={onPixelsPerSecondChange}
                globalPlaybackSpeed={globalPlaybackSpeed}
                resizingId={resizingId}
                resizingType={resizingType}
                voiceoverName={voiceover?.name}
                waveformSource={waveformSource}
                onRestoreAbsorbedGaps={handleRestoreAllGapsOnSegment}
                onDeleteSegment={handleDeleteSegmentById}
                restoredSegmentIds={restoredSegmentIdsMemo}
                onTogglePlay={togglePlay}
                onSeek={(time) => {
                  setCurrentTime(time);
                  if (audioRef.current) audioRef.current.currentTime = time;
                }}
                onResizeStart={(id, type, downClientX) => {
                  // The DOM/pointer-event orchestration for a drag gesture lives in
                  // services/dragSession.ts (WS2 task 1, extracted from this inline
                  // closure) — see that file's header for what moved and why.
                  startDragSession(id, type, downClientX, {
                    getSegments: () => projectRef.current.segments,
                    getPixelsPerSecond: () => pixelsPerSecondRef.current,
                    getTranscriptTokens: () => projectRef.current.transcriptTokens,
                    getSourceDuration: (segment) => segment.assetId
                      ? projectRef.current.assets.find(a => a.id === segment.assetId)?.duration
                      : undefined,
                    setResizingId,
                    setResizingType,
                    setIsResizing: (value) => { isResizingRef.current = value; },
                    commitDurationChange: applyDurationChange,
                    // SILENT (undo/redo Phase 1, design §3.1). Both revert paths
                    // — a locked-neighbour block and an interrupted/discarded
                    // gesture — restore the array that is already the top of
                    // history. Capturing them would push a no-op duplicate and
                    // make one gesture cost two undo presses to escape.
                    revertSegments: (originalSegments) =>
                      setProjectSilent(prev => ({ ...prev, segments: originalSegments })),
                  });
                }}
                historyAnchor={historyAnchor}
                onSegmentUpdate={(updater) => setProject(prev => ({ ...prev, segments: updater(prev.segments) }))}
                onOpenStockSearch={(segmentId) => { setStockTarget(segmentId); setShowStockSearch(true); }}
                onSelectSegment={(id) => setSelectedSegmentId(id)}
                // WS2 ws2-23 (bugs 4/6) — a single click RETARGETS an already-
                // open scene drawer and never opens a closed one, exactly the
                // rule LIVE AUTO-FOLLOW above already uses for playback. Before
                // the z-[45] fix a clip was unclickable while the drawer was
                // open, so this case could not arise; now that it can, a stale
                // drawer selection would otherwise keep overriding the clip the
                // user is actually pointing at for S/D
                // (`resolveShortcutTargetSegmentId` prefers selection) — that
                // is what made D look broken on a freshly restored segment.
                // `selectedSegmentId === null` also covers "the heading editor
                // is open" (the two ids are mutually exclusive), so a heading
                // being edited is never yanked away by a timeline click.
                onClipClick={(id) => setSelectedSegmentId(prev => (prev === null ? null : id))}
                onHeadingResizeCommit={(id, next) => {
                  setProject(prev => ({
                    ...prev,
                    headings: (prev.headings ?? []).map(h => h.id === id ? { ...h, ...next } : h),
                  }));
                }}
              />
            </ErrorBoundary>
          </div>

          {/* Backdrop — click outside drawer to dismiss */}
          {(selectedSegment || selectedHeading) && (
            <div
              className="absolute inset-0 z-40"
              onClick={() => { setSelectedSegmentId(null); setSelectedHeadingId(null); }}
            />
          )}

          <BottomDrawer
            segment={selectedSegment}
            segmentIndex={selectedSegmentIndex}
            heading={selectedHeading}
            assets={project.assets}
            globalOverlayConfig={project.globalOverlayConfig}
            onClose={() => { setSelectedSegmentId(null); setSelectedHeadingId(null); }}
            onUpdateSegment={updateSegment}
            onUpdateSegmentOverlay={updateSegmentOverlay}
            onUpdateHeading={handleUpdateHeading}
            onOpenStockSearch={(segmentId) => { setStockTarget(segmentId); setShowStockSearch(true); }}
            onToggleLock={handleToggleLock}
            onSeek={(time) => {
              setCurrentTime(time);
              if (audioRef.current) audioRef.current.currentTime = time;
            }}
          />

        </div>

        {/* Right collapse toggle strip */}
        <button
          onClick={() => setRightPanelCollapsed(p => !p)}
          className="w-3 flex-shrink-0 flex items-center justify-center bg-[#0D0D0D] hover:bg-[#1A1A1A] border-l border-[#1A1A1A] transition-colors cursor-col-resize z-10"
          title={rightPanelCollapsed ? 'Expand panel' : 'Collapse panel'}
          aria-label={rightPanelCollapsed ? 'Expand right panel' : 'Collapse right panel'}
        >
          {rightPanelCollapsed ? <ChevronLeft size={10} className="text-zinc-600" /> : <ChevronRight size={10} className="text-zinc-600" />}
        </button>

        {/* Right panel — 15vw collapsible */}
        <div
          style={{ width: rightPanelCollapsed ? 0 : '15vw' }}
          className="flex-shrink-0 flex flex-col h-full border-l border-[#1A1A1A] bg-[#080808] overflow-hidden transition-[width] duration-300 ease-in-out"
        >
          <div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar">
            {/* Project name + save status */}
            <div className="flex-shrink-0 px-3 pt-3 pb-2 border-b border-[#1A1A1A]">
              <p className="text-xs text-zinc-400 truncate">{project.name}</p>
              <p
                className={`text-[10px] mt-0.5 ${saveError ? 'text-red-400 font-medium' : 'text-zinc-600'}`}
                title={saveError ? saveError.message : undefined}
              >
                {saveError ? 'Save failed' : lastSavedAt ? 'Saved' : 'Unsaved'}
              </p>
            </div>

            {/* Export button */}
            <div className="p-3 border-b border-[#1A1A1A]">
              <button
                onClick={() => setShowExportSettingsModal(true)}
                className="w-full py-2 px-3 bg-[#F27D26] hover:bg-[#E06A15] text-white text-sm font-semibold rounded-lg transition-colors"
              >
                Export
              </button>
            </div>

            {SHOW_GLOBAL_TEXT_LAYERS_IN_RIGHT_PANEL && (
              <TextLayersPanel
                textLayers={project.textLayers ?? []}
                segments={project.segments}
                onAddTextLayer={handleAddTextLayer}
                onUpdateTextLayer={handleUpdateTextLayer}
                onDeleteTextLayer={handleDeleteTextLayer}
                onToggleTextLayerOnSegment={handleToggleTextLayerOnSegment}
              />
            )}

            {/* WS-logs — persistent sync log (R4-4). Reads straight off the
                project; `?? []` is what makes a pre-WS-logs project render. */}
            <SyncLogPanel
              syncLog={project.syncLog ?? []}
              onClearLog={handleClearSyncLog}
              onOpenModelsModal={() => setShowManageModelsModal(true)}
              onSeekToSegment={handleSegmentClick}
              onRestoreSegments={handleRestoreAbsorbedSegments}
            />
          </div>

          {/* Pinned footer — Project Settings trigger (plan §2.3) */}
          <div className="flex-shrink-0 px-3 pb-3 pt-2 border-t border-[#1A1A1A]">
            <button
              onClick={() => setShowProjectSettingsModal(true)}
              className="w-full py-2 px-3 bg-[#F27D26] hover:bg-[#E06A15] text-white text-sm font-semibold rounded-lg transition-colors"
            >
              Project Settings
            </button>
          </div>

        </div>

      </div>

      {/* Persistence Audio */}
      {voiceover && (
        <audio
          ref={audioRef}
          src={voiceover.url}
        />
      )}

      <style>{`
        .custom-scrollbar::-webkit-scrollbar { width: 5px; height: 5px; }
        .custom-scrollbar::-webkit-scrollbar-track { background: transparent; }
        .custom-scrollbar::-webkit-scrollbar-thumb { background: #1a1a1a; border-radius: 10px; }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover { background: #F27D26; }
        
        @import url('https://fonts.googleapis.com/css2?family=Anton&family=Space+Grotesk:wght@300;400;500;600;700&family=JetBrains+Mono&family=Inter:wght@400;700;900&family=Playfair+Display:wght@700;900&family=Outfit:wght@400;700;900&family=Montserrat:wght@400;700;900&family=Bebas+Neue&family=Oswald:wght@700&family=Raleway:wght@700;900&family=Poppins:wght@700;900&family=Roboto:wght@700;900&family=Loto:wght@700;900&family=Open+Sans:wght@700;900&family=Prompt:wght@700;900&family=Kanit:wght@700;900&family=Rubik:wght@700;900&family=Syncopate:wght@700&family=Syne:wght@700;800&family=Unbounded:wght@700;900&family=Bangers&family=Luckiest+Guy&family=Permanent+Marker&family=Lobster&family=Pacifico&family=Dancing+Script:wght@700&family=Shadows+Into+Light&family=Righteous&family=Fredoka+One&family=Bungee&family=Press+Start+2P&family=Monoton&family=Creepster&family=Special+Elite&family=Homemade+Apple&family=Cinzel:wght@700;900&family=Spectral:wght@700&family=Libre+Baskerville:ital,wght@0,700;1,400&family=Abril+Fatface&family=Cormorant+Garamond:wght@700&family=EB+Garamond:wght@700&family=Old+Standard+TT:wght@700&family=Cardo:wght@700&family=Zilla+Slab:wght@700&family=Josefin+Sans:wght@700&family=Quicksand:wght@700&family=Work+Sans:wght@700;900&family=Comfortaa:wght@700&family=Questrial&display=swap');

        :root { --f-display: 'Anton', sans-serif; }
        body { background: #050505; }

        @keyframes typewriter {
          from { width: 0; }
          to { width: 100%; }
        }
        @keyframes glitch {
          0% { transform: translate(0); }
          20% { transform: translate(-2px, 2px); }
          40% { transform: translate(-2px, -2px); }
          60% { transform: translate(2px, 2px); }
          80% { transform: translate(2px, -2px); }
          100% { transform: translate(0); }
        }
        @keyframes neon-flicker {
          0%, 19%, 21%, 23%, 25%, 54%, 56%, 100% { opacity: 1; text-shadow: 0 0 10px #F27D26, 0 0 20px #F27D26; }
          20%, 22%, 24%, 55% { opacity: 0.5; text-shadow: none; }
        }
      `}</style>
      
      {/* Export Progress / Error Overlay */}
      <AnimatePresence>
        {(exportState.isExporting || exportState.error !== null) && (
          <motion.div
            ref={exportModalTrapRef}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[200] bg-black/95 backdrop-blur-3xl flex items-center justify-center p-8"
          >
            {exportState.error !== null ? (
              /* ── Error view ── */
              <div className="w-full max-w-md text-center space-y-6">
                <div className="w-16 h-16 rounded-full bg-red-500/10 border border-red-500/30 flex items-center justify-center mx-auto">
                  <span className="text-2xl">✕</span>
                </div>
                <div>
                  <h2 className="text-xl font-bold text-white mb-2">
                    {exportState.error.kind === 'cancelled' ? 'Export Cancelled' : 'Export Failed'}
                  </h2>
                  <p className="text-sm text-gray-300 mb-1">
                    {getExportErrorSummary(exportState.error)}
                  </p>
                  {exportState.error.kind !== 'cancelled' && (
                    <p className="text-xs text-gray-600">{exportState.error.message}</p>
                  )}
                </div>
                <div className="flex gap-3 justify-center">
                  {exportState.error.kind !== 'cancelled' && (
                    <button
                      onClick={() => {
                        const diagnostics = {
                          error: exportState.error,
                          projectMeta: {
                            segmentCount: project.segments.length,
                            hasVoiceover: !!project.voiceoverId,
                            exportResolution,
                            exportFps,
                            ts: new Date().toISOString(),
                          },
                        };
                        navigator.clipboard.writeText(JSON.stringify(diagnostics, null, 2)).catch(() => undefined);
                      }}
                      className="px-4 py-2 text-xs font-bold border border-gray-700 text-gray-300 rounded-xl hover:border-gray-500 transition-colors"
                    >
                      Copy diagnostics
                    </button>
                  )}
                  {exportState.error.kind !== 'cancelled' && (
                    <button
                      onClick={retryExport}
                      className="px-4 py-2 text-xs font-bold bg-[#F27D26] text-black rounded-xl hover:bg-orange-400 transition-colors"
                    >
                      Retry
                    </button>
                  )}
                  <button
                    onClick={cancelExport}
                    className="px-4 py-2 text-xs font-bold border border-gray-700 text-gray-300 rounded-xl hover:border-gray-500 transition-colors"
                  >
                    {exportState.error.kind === 'cancelled' ? 'Dismiss' : 'Cancel'}
                  </button>
                </div>
              </div>
            ) : (
              /* ── Progress view ── */
              <div className="w-full max-w-md text-center space-y-8">
                <div className="relative inline-block">
                  <div className="w-32 h-32 rounded-full border-4 border-gray-800 flex items-center justify-center">
                    <span className="text-3xl font-black text-[#F27D26]">{Math.round(exportState.progress)}%</span>
                  </div>
                  <motion.div
                    className="absolute inset-0 rounded-full border-4 border-t-[#F27D26] border-r-transparent border-b-transparent border-l-transparent"
                    animate={{ rotate: 360 }}
                    transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
                  />
                </div>

                <div>
                  <h2 className="text-2xl font-bold tracking-tight text-white mb-2">Rendering Master MP4</h2>
                  <p aria-live="polite" aria-atomic="true" className="text-[#F27D26] text-sm font-semibold min-h-[1.25rem]">{exportState.stageLabel}</p>
                  <p aria-live="polite" className="text-gray-300 text-lg font-mono font-bold tabular-nums mt-2">{formatElapsed(exportState.elapsedSec)}</p>
                  <p className="text-gray-500 text-xs mt-1">Please do not close this tab.</p>
                </div>

                <div className="h-2 bg-gray-900 rounded-full overflow-hidden">
                  <motion.div
                    className="h-full bg-gradient-to-r from-[#F27D26] to-orange-400"
                    style={{ width: `${exportState.progress}%` }}
                  />
                </div>

                <div className="grid grid-cols-3 gap-4">
                  <div className="p-3 bg-[#0A0A0A] border border-[#1A1A1A] rounded-2xl">
                    <p className="text-[8px] text-gray-600 font-black uppercase mb-1">Codec</p>
                    <p className="text-[10px] text-white font-bold">H.264 / AAC</p>
                  </div>
                  <div className="p-3 bg-[#0A0A0A] border border-[#1A1A1A] rounded-2xl">
                    <p className="text-[8px] text-gray-600 font-black uppercase mb-1">Resolution</p>
                    <p className="text-[10px] text-white font-bold">{(() => {
                      const { width, height } = resolveDimensions(project.aspectRatio ?? DEFAULT_ASPECT_RATIO, exportResolution);
                      return `${width}×${height}`;
                    })()}</p>
                  </div>
                  <div className="p-3 bg-[#0A0A0A] border border-[#1A1A1A] rounded-2xl">
                    <p className="text-[8px] text-gray-600 font-black uppercase mb-1">FPS</p>
                    <p className="text-[10px] text-white font-bold">{exportFps} Constant</p>
                  </div>
                </div>

                <button
                  onClick={cancelExport}
                  className="px-4 py-2 text-xs font-bold border border-gray-700 text-gray-300 rounded-xl hover:border-gray-500 transition-colors"
                >
                  Cancel Export
                </button>
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {/* New Project Modal */}
      {showNewProjectModal && (
        <NewProjectModal
          onConfirm={handleNewProjectConfirm}
          onCancel={() => { setShowNewProjectModal(false); setShowDashboard(true); }}
        />
      )}

      {/* Project Settings Modal (docs/project-settings-plan.md §2.1-2.3) */}
      {showProjectSettingsModal && (
        <ProjectSettingsModal
          segments={project.segments}
          aspectRatio={project.aspectRatio ?? DEFAULT_ASPECT_RATIO}
          resolutionTier={project.resolutionTier ?? DEFAULT_RESOLUTION_TIER}
          onResolutionTierChange={(v) => setProject(p => ({ ...p, resolutionTier: v }))}
          onSetAllOverlay={handleSetAllOverlay}
          language={project.language}
          onLanguageChange={(v) => setProject(p => ({ ...p, language: v }))}
          faEnabled={isFaEnabledForProject(project)}
          onFaEnabledChange={(v) => setProject(p => ({ ...p, faHighPrecisionSync: v }))}
          onManageModel={() => setShowManageModelsModal(true)}
          onClose={() => setShowProjectSettingsModal(false)}
        />
      )}

      {/* Manage Models & Add-ons (WS2 Step 12, A3) — the one model UI,
          reachable from Project Settings' "Manage models & add-ons" link
          and automatically from TranscriptionBar's "Download model" action
          on a model-not-found transcription error. Replaces the old
          whisper-only ModelDownloadPanel. */}
      {showManageModelsModal && (
        <ManageModelsModal
          onClose={() => setShowManageModelsModal(false)}
          projectLanguage={project.language}
        />
      )}

      {/* Export Settings Modal — resolution + fps chosen at export time
          (industry-standard pattern), replacing the old Project Settings
          "Export Quality" section. Appears BEFORE the native save-path
          dialog: Continue commits exportResolution/exportFps then triggers
          startExport via exportTriggerCount (see its declaration above for
          why); Cancel closes with no state change and no export. */}
      {showExportSettingsModal && (
        <ExportSettingsModal
          aspectRatio={project.aspectRatio ?? DEFAULT_ASPECT_RATIO}
          exportResolution={exportResolution}
          exportFps={exportFps}
          mixedNativeFpsWarning={mixedNativeFpsWarning}
          onContinue={(resolution, fps) => {
            exportFpsUserSetRef.current = true;
            setExportResolution(resolution);
            setExportFps(fps);
            setShowExportSettingsModal(false);
            setExportTriggerCount(c => c + 1);
          }}
          onCancel={() => setShowExportSettingsModal(false)}
        />
      )}

      {/* Settings Modal — tombstoned (controls moved to Effects tab in task-layout-redesign) */}
      {false && showSettings && <div />}

      {/* Stock Media Search Modal */}
      {showStockSearch && (
        <Suspense fallback={<ModalLoadingFallback />}>
        <AnimatePresence>
          <StockSearchModal
            targetSegmentId={stockTarget}
            onClose={() => setShowStockSearch(false)}
            onSelect={async (stock, targetId) => {
              let blob: Blob;
              try {
                if (isTauri()) {
                  // Route through Rust to bypass CORS restrictions on external CDN URLs
                  const base64: string = await invoke('fetch_url_bytes', { url: stock.url });
                  const byteChars = atob(base64);
                  const byteArray = new Uint8Array(byteChars.length);
                  for (let i = 0; i < byteChars.length; i++) {
                    byteArray[i] = byteChars.charCodeAt(i);
                  }
                  const mimeType = stock.type === 'image' ? 'image/jpeg' : 'video/mp4';
                  blob = new Blob([byteArray], { type: mimeType });
                } else {
                  blob = await fetch(stock.url).then(r => r.blob());
                }
              } catch (err) {
                console.error('[stock] failed to download asset:', stock.url, err);
                setStockError(`Failed to download asset: ${String(err)}`);
                return;
              }
              const id = crypto.randomUUID();
              try {
                await putAsset(projectIdRef.current, id, blob, { name: stock.name, mimeType: blob.type });
              } catch (err) {
                console.error('Failed to persist stock asset to IndexedDB, skipping:', stock.name, err);
                return;
              }
              const nativeFps = stock.type === 'video' ? await resolveVideoNativeFps(blob) : undefined;
              const stockUrl = URL.createObjectURL(blob);
              const newAsset: Asset = {
                id,
                name: stock.name,
                url: stockUrl,
                type: stock.type,
                nativeFps,
                duration: stock.type === 'video' ? await getMediaDuration(stockUrl, 'video') : undefined,
              };
              setProject(p => {
                const newAssets = [...p.assets, newAsset];
                const afterTarget = p.segments.map(s =>
                  s.id === targetId
                    ? { ...s, assetId: newAsset.id, trimStart: 0 }
                    : s
                );
                return {
                  ...p,
                  assets: newAssets,
                  segments: autoMatchSegments(newAssets, afterTarget),
                };
              });
            }}
          />
        </AnimatePresence>
        </Suspense>
      )}

      {/* Review Mapping Modal */}
      {showReviewMapping && (
        <ReviewMappingModal
          segments={project.segments}
          headings={project.headings ?? []}
          assets={project.assets}
          globalOverlayConfig={project.globalOverlayConfig}
          onClose={() => setShowReviewMapping(false)}
          onUpdateSegment={updateSegment}
          onUpdateSegmentOverlay={updateSegmentOverlay}
          onUpdateHeading={handleUpdateHeading}
          onOpenStockSearch={(segId) => { setStockTarget(segId); setShowStockSearch(true); }}
        />
      )}

      {/* Stock download error banner — auto-dismisses after 5 s */}
      {stockError && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[200] flex items-center gap-3 bg-red-900/90 border border-red-500/50 text-red-200 text-sm font-medium px-5 py-3 rounded-2xl shadow-xl backdrop-blur-md max-w-lg">
          <AlertCircle size={16} className="shrink-0 text-red-400" />
          <span className="flex-1">{stockError}</span>
          <button
            onClick={() => setStockError(null)}
            aria-label="Dismiss error"
            className="shrink-0 text-red-400 hover:text-white transition-colors"
          >
            <X size={16} />
          </button>
        </div>
      )}

      {/* Unsupported-language banner (Phase 2a, H.4 guard) — persistent while
          project.language stays outside the supported set; dismissible for
          the session, re-shown if the language changes to a new unsupported
          value. Top-anchored (not the bottom toast lane above) since this is
          ongoing project state, not a one-off action result. */}
      {isLanguageUnsupported && !languageBannerDismissed && (
        <div className="fixed top-4 left-1/2 -translate-x-1/2 z-[200] flex items-center gap-3 bg-red-900/90 border border-red-500/50 text-red-200 text-sm font-medium px-5 py-3 rounded-2xl shadow-xl backdrop-blur-md max-w-lg">
          <AlertCircle size={16} className="shrink-0 text-red-400" />
          <span className="flex-1">
            Project language &quot;{project.language}&quot; is outside the supported set (English, Spanish, French,
            Portuguese, German) — sync accuracy is not guaranteed.
          </span>
          <button
            onClick={() => setLanguageBannerDismissed(true)}
            aria-label="Dismiss language warning"
            className="shrink-0 text-red-400 hover:text-white transition-colors"
          >
            <X size={16} />
          </button>
        </div>
      )}

      {/* Export success toast — bottom-right, auto-dismisses after EXPORT_SUCCESS_TOAST_DURATION_MS */}
      <AnimatePresence>
        {exportState.showExportSuccess && exportState.lastExportPath && (
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 16 }}
            className="fixed bottom-6 right-6 z-[300] bg-zinc-900 border border-zinc-700
                       rounded-xl p-4 shadow-2xl flex flex-col gap-3 min-w-64"
          >
            <div className="flex items-center gap-2 text-green-400 font-semibold text-sm">
              <CheckCircle size={18} />
              Export completed in {formatElapsedLong(exportState.lastExportElapsedSec ?? 0)}
            </div>
            <p className="text-zinc-400 text-xs truncate max-w-56">
              {exportState.lastExportPath.split('/').pop()?.split('\\').pop()}
            </p>
            <div className="flex gap-2">
              <button
                onClick={() => invoke('reveal_in_finder', { path: exportState.lastExportPath })}
                className="flex-1 text-xs bg-zinc-800 hover:bg-zinc-700
                           text-zinc-200 rounded-lg px-3 py-2 transition-colors"
              >
                Show in Finder
              </button>
              <button
                onClick={dismissSuccess}
                className="text-xs text-zinc-500 hover:text-zinc-300 px-2 transition-colors"
              >
                Dismiss
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Lock-block toast — bottom-center, 5 s auto-dismiss */}
      {toast !== null && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[400] bg-indigo-600 text-white rounded-xl px-5 py-3 shadow-2xl flex items-center gap-3 max-w-sm w-max">
          <span className="flex-1 text-sm">{toast.message}</span>
          {toast.action && (
            <button
              onClick={() => { toast.action!.onClick(); setToast(null); }}
              className="text-sm font-semibold bg-white/20 hover:bg-white/30 rounded-lg px-3 py-1.5 transition-colors flex-shrink-0"
            >
              {toast.action.label}
            </button>
          )}
        </div>
      )}

      <SyncLoadingOverlay isProcessing={isProcessing} />

    </div>
  );

  return (
    <>
      {mainContent}
      {import.meta.env.DEV && devPanelOpen && (
        <Suspense fallback={null}>
          <DevTestPanel
            onClose={() => setDevPanelOpen(false)}
            setProject={(p) => { setProject(p); setShowDashboard(false); }}
          />
        </Suspense>
      )}
    </>
  );
}
