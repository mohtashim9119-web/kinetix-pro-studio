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
} from './types';
import { clearFrameRendererCache } from './services/frameRenderer';
import { findAssetByContext, autoMatchSegments, applyAnchorBasedTiming, getFileIdentity, isExactFilenameMatch, contiguousWordMatch, cleanTagName } from './services/syncEngine';
import { createHeading, boundaryTimeForGap, clampHeadingsToDuration, centerHeadingOnBoundary, DEFAULT_HEADING_DURATION } from './services/headingLayer';
import { stripRtfIfNeeded } from './services/textUtils';
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
  loadAllMetas,
  deleteProjectData,
  migrateLegacyIfNeeded,
  upsertProjectMeta,
  setLastOpenedProjectId,
  getLastOpenedProjectId,
  clearLastOpenedProjectId,
} from './services/projectStore';
import { usePersistProject, buildThumbnailBase64 } from './hooks/usePersistProject';
import { useFocusTrap } from './hooks/useFocusTrap';
import { FONT_FAMILIES, FILTERS, TEXT_ANIMATIONS, getFilterStyle, getMotionProps } from './constants';
import { DropZonePanel, type StagedFiles } from './components/DropZonePanel';
import { NEUTRAL_GRADE, type ApplyEvent, type ApplyScope, type AutoGradeResult } from './components/EffectsPanel';
import { ReviewMappingModal } from './components/ReviewMappingModal';
import { TextLayersPanel } from './components/TextLayersPanel';
import { BottomDrawer } from './components/BottomDrawer';
const StockSearchModal = lazy(() =>
  import('./components/StockSearchModal').then(m => ({ default: m.StockSearchModal }))
);
import { Timeline } from './components/Timeline';
import { PreviewStage, type AutoGradeSampler } from './components/PreviewStage';
import { ProjectDashboard } from './components/ProjectDashboard';
import { NewProjectModal } from './components/NewProjectModal';
import { ErrorBoundary, PanelFallback } from './components/ErrorBoundary';
import { useExport, type ExportResolution, type ExportFps, type ExportError } from './hooks/useExport';
import { useWhisper } from './hooks/useWhisper';
import { usePlayback } from './hooks/usePlayback';
import { TranscriptionBar } from './components/TranscriptionBar';
import { isTauri, probeAudioDuration, probeVideoFps } from './services/tauriFfmpeg';
import { readUiState, patchUiState } from './services/uiStateStore';
import { invoke } from '@tauri-apps/api/core';

interface RawSegment {
  text: string;
  assetId?: string;
  unmatchedExplicitTag?: boolean;
  transition: TransitionType;
  animation: AnimationType;
  playbackSpeed: number;
  trimStart: number;
  extraOverlays: TextOverlay[];
  sourceDuration?: number;
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
  return { id, name: file.name, url, type, file, addedAt: Date.now(), nativeFps };
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
      newAssets.push({ id, name, url: URL.createObjectURL(blob), type, file: new File([blob], filename), nativeFps });
    });
    await Promise.all(filePromises);
  } catch (err) {
    console.error('[extractZipToAssets] Error:', err);
  }
  return newAssets;
}

const MIN_SEGMENT_DURATION = 0.3; // seconds — minimum timeline slot width
const TOAST_DURATION = 5000; // ms — auto-dismiss for lock-block toast
// NOTE: playbackSpeed UI is hidden — feature deferred. See project-state.md.
const MIN_PLAYBACK_SPEED = 0.5;
const MAX_PLAYBACK_SPEED = 2.0;
const MIN_TIMELINE_HEIGHT = 220; // px — absolute floor: ruler + 80px segments + 80px audio rows

// Enhanced parser that handles heading-voiceover logic
export const parseProjectData = async (
  script: string,
  sceneDetails: string,
  assets: Asset[],
  voiceoverDuration: number = 0,
): Promise<VideoSegment[]> => {
  // Split on the start of each bracketed tag so blank lines between a tag and its
  // description text stay within the same block (not treated as a scene boundary).
  const TAG_REGEX = /(?=\[[^\]]*\])/;
  const rawDetails = sceneDetails.split(TAG_REGEX).filter(block => block.trim() !== '');
  const scriptLines = script.split(/\r?\n/).map(l => l.trim()).filter(l => l !== '');

  const scenes: { tag: string; description: string }[] = [];

  rawDetails.forEach(block => {
    const lines = block.split(/\r?\n/).map(l => l.trim()).filter(l => l !== '');
    const tag = lines[0];
    if (tag !== undefined) {
      scenes.push({ tag, description: lines.slice(1).join(' ') });
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
      playbackSpeed: 1,
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
      const availableAssets = assets.filter(a => !usedAssetIdsTotal.has(a.id) && a.type !== 'audio');
      const contextualAsset = findAssetByContext(text, availableAssets.length > 0 ? availableAssets : assets);
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

    const asset = assets.find(a => a.id === s.assetId);
    let playbackSpeed = 1;
    let sourceDuration: number | undefined;

    if (asset?.type === 'video') {
      sourceDuration = await getMediaDuration(asset.url, 'video');
      if (sourceDuration > 0 && targetDuration > sourceDuration) {
        playbackSpeed = sourceDuration / targetDuration;
      }
    }

    const segment: VideoSegment = {
      ...s,
      id: crypto.randomUUID(),
      startTime: Number(currentTimeAccumulator.toFixed(3)),
      duration: Number(targetDuration.toFixed(3)),
      anchorStart: Number(currentTimeAccumulator.toFixed(3)), // character-weight bootstrap anchor
      anchorSource: 'estimate' as const,
      trimStart: 0,
      playbackSpeed,
      order: i,
      transition: TransitionType.NONE,
      animation: AnimationType.NONE,
      showOverlay: false,
      extraOverlays: [],
      sourceDuration,
    };

    if (i === rawSegments.length - 1 && voiceoverDuration > 0) {
      segment.duration = Math.max(0.1, Number((voiceoverDuration - segment.startTime).toFixed(3)));
    }

    finalSegments.push(segment);
    currentTimeAccumulator += segment.duration;
  }

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
      effectOverlay: prev.effectOverlay,
      effectGrade: prev.effectGrade,
    };
  });
}

/** Recomputes sequential startTimes from accumulated durations. Pure. */
function recomputeStartTimes(segs: VideoSegment[]): VideoSegment[] {
  let acc = 0;
  return segs.map(s => {
    const t = acc;
    acc += s.duration;
    return { ...s, startTime: Number(t.toFixed(3)) };
  });
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

/**
 * Applies a drag-resize delta to originalSegments, cascading overflow into neighbors.
 * Affected segments (dragged + all that absorbed any portion) are auto-locked.
 * Returns the updated array, or null if a locked neighbor blocked the cascade
 * (caller should revert the live-preview state and show a toast).
 */
function computeDragCascade(
  originalSegments: VideoSegment[],
  draggedIdx: number,
  finalDuration: number,
  finalTrimStart: number,
  direction: 'right' | 'left',
  onLockedBlock: (segIndex: number, segId: string) => void,
): VideoSegment[] | null {
  const segs = originalSegments.map(s => ({ ...s }));
  segs[draggedIdx] = { ...segs[draggedIdx]!, duration: finalDuration, trimStart: finalTrimStart, locked: true };
  const delta = finalDuration - (originalSegments[draggedIdx]?.duration ?? finalDuration);
  let remaining = -delta; // positive → neighbor must grow; negative → neighbor must shrink
  const step = direction === 'right' ? 1 : -1;
  let ni = draggedIdx + step;
  while (Math.abs(remaining) > 0.001) {
    if (ni < 0 || ni >= segs.length) break;
    const neighbor = segs[ni]!;
    if (neighbor.locked) {
      onLockedBlock(ni, neighbor.id);
      return null;
    }
    const newDur = neighbor.duration + remaining;
    if (newDur >= MIN_SEGMENT_DURATION) {
      segs[ni] = { ...neighbor, duration: newDur, locked: true };
      remaining = 0;
    } else {
      // Clamp neighbor to MIN; pass overflow to next segment in same direction.
      segs[ni] = { ...neighbor, duration: MIN_SEGMENT_DURATION, locked: true };
      remaining += neighbor.duration - MIN_SEGMENT_DURATION; // remaining stays negative
      ni += step;
    }
  }
  return recomputeStartTimes(segs);
}

export default function App() {
  const [project, setProject] = useState<Project>(makeDefaultProject);

  const [isHydrating, setIsHydrating] = useState(true);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState<number>(() => {
    try { return (readUiState().currentTime as number) ?? 0; }
    catch { return 0; }
  });
  const [isProcessing, setIsProcessing] = useState(false);
  const [sliderT, setSliderT] = useState(0.5);
  // Live pixels-per-second value from Timeline's zoom formula. Held in a ref so
  // App's two consumer sites (playback auto-scroll, resize-drag) read the current
  // value without re-rendering App on every zoom tick.
  const pixelsPerSecondRef = useRef(100);
  const onPixelsPerSecondChange = useCallback((pps: number) => {
    pixelsPerSecondRef.current = pps;
  }, []);
  const [globalPlaybackSpeed, setGlobalPlaybackSpeed] = useState(1);
  const [isAdjustingTrim, setIsAdjustingTrim] = useState(false);
  const [syncStep, setSyncStep] = useState<0 | 1 | 2 | 3 | 4>(0);
  const [editingSegment, setEditingSegment] = useState<VideoSegment | null>(null);
  const exportModalTrapRef = useFocusTrap<HTMLDivElement>();
  const segmentEditorTrapRef = useFocusTrap<HTMLDivElement>();
  const [isSynced, setIsSynced] = useState(false);
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
  const [trimmingSegmentId, setTrimmingSegmentId] = useState<string | null>(null);
  const [showStockSearch, setShowStockSearch] = useState(false);
  const [stockTarget, setStockTarget] = useState<string | null>(null);
  const [showReviewMapping, setShowReviewMapping] = useState(false);
  const [stockError, setStockError] = useState<string | null>(null);
  const [showDashboard, setShowDashboard] = useState(true);
  const [showNewProjectModal, setShowNewProjectModal] = useState(false);
  const audioRef = useRef<HTMLAudioElement>(null);

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
  // Baseline for speed-slider drag: captured on the FIRST tick of a new drag gesture
  // so that all subsequent ticks divide by the same original clipLen, preventing the
  // feedback loop where each tick reads the previous tick's just-written duration.
  const speedBaselineRef = useRef<{ segmentId: string; clipLen: number } | null>(null);



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
   * Applies a duration change for one segment with the same cascade + auto-lock
   * semantics as a drag-resize. Shared by the drag-resize handler and the
   * playback-speed slider. Returns true if the cascade succeeded, false if a
   * locked neighbor blocked it (caller must revert live-preview state if any).
   */
  const applyDurationChange = useCallback((
    originalSegments: VideoSegment[],
    segmentId: string,
    newDuration: number,
    finalTrimStart: number,
    fromSide: 'left' | 'right',
    additionalUpdates?: Partial<VideoSegment>,
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
            onClick: () => setProject(prev => ({
              ...prev,
              segments: prev.segments.map(s => s.id === segId ? { ...s, locked: false } : s),
            })),
          } : undefined,
        );
      },
    );
    if (cascadeResult === null) return false;
    const finalSegments = additionalUpdates
      ? cascadeResult.map(s => s.id === segmentId ? { ...s, ...additionalUpdates } : s)
      : cascadeResult;
    setProject(prev => ({ ...prev, segments: finalSegments }));
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
      const migrated = migrateLegacyIfNeeded();
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
      // 2. Route on launch:
      //    • No projects yet  → new-project modal (first ever launch).
      //    • Has a lastOpenedProjectId that still exists in the registry →
      //      reopen that project directly (normal reload case).
      //    • Has projects but no last-opened id (e.g. first launch after
      //      migration) → show the dashboard so the user picks one.
      // -----------------------------------------------------------------------
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

  const { saveNow, lastSavedAt } = usePersistProject(project, !isHydrating);

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
    speedBaselineRef.current = null;
    setProject(prev => {
      const toggled = prev.segments.map(s =>
        s.id === segmentId ? { ...s, locked: !s.locked } : s
      );
      const audioDuration = resolveAudioDuration(audioRef.current, toggled);
      return { ...prev, segments: applyAnchorBasedTiming(toggled, audioDuration) };
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
            return { ...s, effectAnimation: e.value, effectAnimationDuration: e.duration, animation: AnimationType.NONE };
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
            return {
              ...s,
              effectTransition: e.preset.transition,
              effectTransitionDuration: e.preset.transitionDur,
              effectAnimation: e.preset.animation,
              effectAnimationDuration: e.preset.animationDur,
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
    setProject(prev => ({
      ...prev,
      segments: prev.segments.map(s => ({ ...s, locked: false })),
    }));
  }, []);

  /**
   * Path B Phase 5 (docs/path-b-heading-layer-plan.md, Decision 3) — creates a
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

  const handlePlaybackSpeedChange = useCallback((segIdx: number, newSpeed: number): void => {
    const seg = projectRef.current.segments[segIdx];
    if (!seg) return;

    // No-op if speed hasn't changed — don't capture a baseline yet either.
    if (Math.abs(newSpeed - (seg.playbackSpeed ?? 1)) < 0.001) return;

    const clampedSpeed = Math.max(MIN_PLAYBACK_SPEED, Math.min(MAX_PLAYBACK_SPEED, newSpeed));

    // Locked segment: honor speed update but keep duration fixed.
    if (seg.locked) {
      setProject(prev => ({
        ...prev,
        segments: prev.segments.map((s, i) => i === segIdx ? { ...s, playbackSpeed: clampedSpeed } : s),
      }));
      return;
    }

    // Non-video or unknown sourceDuration: fall back to simple update.
    const asset = assetsRef.current.find(a => a.id === seg.assetId);
    if (asset?.type !== 'video' || !seg.sourceDuration || seg.sourceDuration <= 0) {
      setProject(prev => ({
        ...prev,
        segments: prev.segments.map((s, i) => i === segIdx ? { ...s, playbackSpeed: clampedSpeed } : s),
      }));
      return;
    }

    // Compute or reuse the speed-drag baseline. Baseline = the original (duration × speed)
    // captured on the FIRST tick of a drag gesture. Reusing it across ticks prevents the
    // feedback loop where each tick reads the previous tick's just-written duration.
    let clipLen: number;
    if (speedBaselineRef.current?.segmentId === seg.id) {
      clipLen = speedBaselineRef.current.clipLen;
    } else {
      const fullClipLen = (seg.trimEnd ?? seg.sourceDuration) - (seg.trimStart ?? 0);
      clipLen = Math.min(seg.duration * (seg.playbackSpeed ?? 1), fullClipLen);
      speedBaselineRef.current = { segmentId: seg.id, clipLen };
    }
    if (clipLen <= 0) return;
    const newDuration = Math.max(MIN_SEGMENT_DURATION, clipLen / clampedSpeed);
    const success = applyDurationChange(
      projectRef.current.segments,
      seg.id,
      newDuration,
      seg.trimStart ?? 0,
      'right',
      { playbackSpeed: clampedSpeed },
    );
    if (success) {
      // Prevent currentTime from sitting past the segment's new shorter end,
      // which would evict the currentSegment to an image/heading and freeze the video.
      const newEnd = seg.startTime + newDuration;
      setCurrentTime(t => Math.min(t, newEnd - 0.01));
    }
  }, [applyDurationChange]);

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

  /** '1080p' | '4k' */
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
        projectRef.current,
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
    setIsProcessing(true);

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
        showToast("Couldn't read the voiceover's duration — sync aborted. Try re-adding the audio file.");
        setIsProcessing(false);
        return;
      }
    }

    // 5. Parse project data with the fresh, complete data
    const newSegmentsRaw = await parseProjectData(scriptText, sceneText, allAssets, audioDuration);

    // Never wipe existing segments if parse produced nothing
    if (newSegmentsRaw.length === 0 && projectRef.current.segments.length > 0) {
      console.warn('[sync] parseProjectData returned 0 segments — keeping existing segments');
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

    let finalTimedSegments: VideoSegment[];
    if (cachedTokensReady) {
      const anchorTimed = applyAnchorBasedTiming(newSegmentsRaw, audioDuration);
      finalTimedSegments = await alignFromCache(
        voiceoverAsset!,
        anchorTimed,
        projectRef.current.transcriptTokens!,
        audioDuration,
      );
    } else {
      // Defensive fallback only — under correct button gating this branch
      // should be unreachable whenever a voiceover exists in Tauri. Surface
      // it loudly rather than silently shipping character-based timing.
      if (voiceoverAsset && isTauri()) {
        console.warn(
          '[sync] Apply Sync committed with no cached transcript — falling back to character-based timing',
          { voiceoverAssetId: voiceoverAsset.id },
        );
      }
      finalTimedSegments = applyAnchorBasedTiming(newSegmentsRaw, audioDuration);
    }

    const committedSegments = preserveEffectFields(
      autoMatchSegments(allAssets, finalTimedSegments),
      previousSegments,
    );

    // 8. Single atomic state update — segments are already final.
    //    New-layer headings (Path B Decision 2) never move on re-sync; only
    //    clamp+flag any whose fixed timestamp now exceeds the resynced audio.
    setProject(prev => ({
      ...prev,
      script: scriptText,
      sceneDetails: sceneText,
      scriptFileName: staged.scriptFile?.file.name ?? prev.scriptFileName ?? '',
      sceneDetailsFileName: staged.sceneFile?.file.name ?? prev.sceneDetailsFileName ?? '',
      scriptUpdatedAt: staged.scriptFile ? Date.now() : prev.scriptUpdatedAt,
      sceneDetailsUpdatedAt: staged.sceneFile ? Date.now() : prev.sceneDetailsUpdatedAt,
      assets: allAssets,
      voiceoverId: newVoiceoverId,
      segments: committedSegments,
      headings: clampHeadingsToDuration(prev.headings ?? [], audioDuration),
    }));

    setIsSynced(true);
    setIsProcessing(false);
    setSyncStep(4);
  };

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
    const newAsset: Asset = { id, name: file.name, url, type: detectedType, file };

    // When replacing with a new audio file, evict the existing audio asset so
    // the assets list never accumulates more than one voiceover entry.
    if (detectedType === 'audio') {
      const oldAudio = assetsRef.current.find(a => a.type === 'audio');
      if (oldAudio) {
        URL.revokeObjectURL(oldAudio.url);
        deleteAsset(projectIdRef.current, oldAudio.id).catch(err =>
          console.error('[kinetix] Failed to delete old voiceover from IndexedDB:', err),
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
        newAssets.push({
          id,
          name,
          url: URL.createObjectURL(blob),
          type,
          file: new File([blob], filename),
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
    setProject(p => ({
      ...p,
      segments: p.segments.map(s => (s.id === activeGradeSegmentId ? { ...s, effectGrade: value } : s)),
    }));
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

  // --- Export success toast: auto-dismiss after 10 s ---
  useEffect(() => {
    if (!exportState.showExportSuccess) return;
    const t = setTimeout(() => dismissSuccess(), 10000);
    return () => clearTimeout(t);
  }, [exportState.showExportSuccess, dismissSuccess]);

  const togglePlay = () => setIsPlaying(p => !p);

  // Add spacebar play/pause
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.code === 'Space') {
        if (document.activeElement?.tagName !== 'INPUT' && document.activeElement?.tagName !== 'TEXTAREA') {
          e.preventDefault();
          setIsPlaying(p => !p);
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  // Reset zoom to the default midpoint whenever the active project changes.
  useEffect(() => {
    setSliderT(0.5);
  }, [project.id]);

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

  const handleNewProjectConfirm = (name: string): void => {
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
    // Mark as confirmed so auto-save and saveNow will persist it going forward.
    fresh.confirmed = true;
    saveProject(fresh); // persist full project JSON
    setLastOpenedProjectId(fresh.id);
    upsertProjectMeta({ // ensure registry entry exists right away
      id: fresh.id,
      name: fresh.name,
      savedAt: Date.now(),
      segmentCount: 0,
    });
    setProject(fresh);
    setIsSynced(false);
    setCurrentTime(0);
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

    const saved = loadProject(id);
    if (!saved) {
      console.error('[kinetix] Cannot switch to project — not found in storage:', id);
      return;
    }

    // Revoke current project's blob URLs.
    project.assets.forEach(a => { if (a.url) URL.revokeObjectURL(a.url); });

    // Rehydrate the target project's assets from IndexedDB.
    const storedAssets = await getAllAssetsForProject(saved.project.id);
    const blobMap = new Map(storedAssets.map(a => [a.id, a]));

    const droppedIds = new Set<string>();
    const rehydratedAssets = saved.project.assets
      .map(asset => {
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
        return { ...asset, url: rehydratedUrl, file: rehydratedFile };
      })
      .filter((a): a is NonNullable<typeof a> => a !== null);

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

    setProject({
      ...saved.project,
      assets: rehydratedAssets,
      segments: rehydratedSegments,
      voiceoverId: rehydratedVoiceoverId,
      // Any project loaded from storage was previously confirmed by the user,
      // so mark it as confirmed to enable auto-save going forward.
      confirmed: true,
    });
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

  if (showDashboard) {
    return (
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
    );
  }

  return (
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
            onSegmentClick={handleSegmentClick}
            onToggleLock={handleToggleLock}
            onLockAll={() => setProject(p => ({ ...p, segments: p.segments.map(s => ({ ...s, locked: true })) }))}
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
            globalTransition={project.globalTransition}
            globalTransitionDuration={project.globalTransitionDuration ?? 0.5}
            globalAnimation={project.globalAnimation ?? 'none'}
            globalOverlayFilter={project.globalOverlayFilter ?? 'none'}
            globalOverlayConfig={project.globalOverlayConfig}
            exportResolution={exportResolution}
            exportFps={exportFps}
            mixedNativeFpsWarning={mixedNativeFpsWarning}
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
            onSetAllOverlay={handleSetAllOverlay}
            onExportResolutionChange={(v) => setExportResolution(v as ExportResolution)}
            onExportFpsChange={(v) => { exportFpsUserSetRef.current = true; setExportFps(v as ExportFps); }}
            onApplyTransitionPreset={(v) => setProject(p => ({ ...p, globalTransition: v as TransitionType }))}
            onApplyAnimationPreset={(v) => setProject(p => ({ ...p, globalAnimation: v as AnimationType }))}
            onApplyOverlayFilterPreset={(v) => setProject(p => ({ ...p, globalOverlayFilter: v as string }))}
            onApplyOverlayConfigPreset={(v) => setProject(p => ({ ...p, globalOverlayConfig: { ...p.globalOverlayConfig, ...v } }))}
            onBackToProjects={() => { if (project.confirmed) saveNow(); clearLastOpenedProjectId(); setShowDashboard(true); }}
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
              <div className="h-full aspect-video border border-[#333333]">
              <ErrorBoundary fallback={(err, reset) => (
                <PanelFallback label="Preview" error={err} reset={reset} />
              )}>
                <PreviewStage
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
                  onUpdateExtraOverlayPosition={updateExtraOverlayPosition}
                  textLayers={project.textLayers ?? []}
                  headings={project.headings ?? []}
                  autoGradeSamplerRef={autoGradeSamplerRef}
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

          {/* Timeline — fills remaining height */}
          <div className="flex-1 min-h-0 pb-2">
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
                trimmingSegmentId={trimmingSegmentId}
                isAdjustingTrim={isAdjustingTrim}
                voiceoverName={voiceover?.name}
                voiceoverUrl={voiceover?.url}
                voiceoverFile={voiceover?.file}
                onTogglePlay={togglePlay}
                onSeek={(time) => {
                  setCurrentTime(time);
                  if (audioRef.current) audioRef.current.currentTime = time;
                }}
                onResizeStart={(id, type) => {
                  setResizingId(id);
                  setResizingType(type);
                  document.body.classList.add('resizing');
                  // Snapshot original segments at drag-start; used for cascade + revert.
                  const originalSegments = projectRef.current.segments;
                  const draggedIdx = originalSegments.findIndex(s => s.id === id);
                  const originalTarget = originalSegments[draggedIdx];
                  if (draggedIdx < 0 || !originalTarget) return;
                  const pps = pixelsPerSecondRef.current;
                  // B3 — cache the timeline element + its left edge ONCE at drag start.
                  // rect.left is stable for the whole gesture, so re-measuring it (a
                  // layout read) on every mousemove was pure thrash. scrollLeft is still
                  // read live, but only at the top of each rAF frame, before any write.
                  const timeline = document.getElementById('timeline-scroll-area');
                  if (!timeline) return;
                  const rectLeft = timeline.getBoundingClientRect().left;
                  // B1 — elements whose width we update directly during the drag (visual
                  // row + waveform row share the same data-seg-id), so we avoid a
                  // per-frame setProject/full re-render. The real state change is
                  // committed ONCE on mouseup via applyDurationChange (unchanged, below).
                  const liveEls = Array.from(
                    timeline.querySelectorAll<HTMLElement>(`[data-seg-id="${id}"]`),
                  );
                  let lastX = 0;
                  let hasMoved = false;
                  // Capture video context at drag-start for speed coupling.
                  const dragAsset = assetsRef.current.find(a => a.id === originalTarget.assetId);
                  const isVideoSeg = dragAsset?.type === 'video';
                  const srcDur = originalTarget.sourceDuration ?? 0;

                  // Pointer clientX -> content-space x (same formula + -24 gutter as before).
                  const computeX = (clientX: number): number =>
                    clientX - rectLeft + timeline.scrollLeft - 24;
                  // Live duration implied by a content-space x — mirrors the mouseup math
                  // so the width shown during the drag matches the value committed on drop.
                  // Used for the visual width ONLY; the committed state is computed
                  // independently in handleUp (kept identical to the pre-change path).
                  const liveDurationForX = (x: number): number => {
                    let liveDuration: number;
                    let liveTrimStart: number = originalTarget.trimStart ?? 0;
                    if (type === 'end') {
                      liveDuration = Math.max(MIN_SEGMENT_DURATION, (x / pps) - originalTarget.startTime);
                    } else {
                      const rawDelta = (x / pps) - originalTarget.startTime;
                      liveDuration = Math.max(MIN_SEGMENT_DURATION, originalTarget.duration - rawDelta);
                      liveTrimStart = Math.max(0, (originalTarget.trimStart ?? 0) + rawDelta);
                    }
                    if (isVideoSeg && srcDur > 0) {
                      const liveClipLen = (originalTarget.trimEnd ?? srcDur) - liveTrimStart;
                      if (liveClipLen > 0) {
                        const maxDur = liveClipLen / MIN_PLAYBACK_SPEED;
                        const minDur = Math.max(MIN_SEGMENT_DURATION, liveClipLen / MAX_PLAYBACK_SPEED);
                        liveDuration = Math.max(minDur, Math.min(maxDur, liveDuration));
                      }
                    }
                    return liveDuration;
                  };

                  // B5 — coalesce mousemoves into a single rAF; only the latest pointer
                  // position matters per frame.
                  let rafId: number | null = null;
                  let pendingEvent: MouseEvent | null = null;
                  const applyFrame = (): void => {
                    rafId = null;
                    if (!pendingEvent) return;
                    lastX = computeX(pendingEvent.clientX);
                    const w = `${liveDurationForX(lastX) * pps}px`;
                    for (const el of liveEls) el.style.width = w;
                  };
                  const handleMove = (e: MouseEvent): void => {
                    pendingEvent = e;
                    hasMoved = true;
                    if (rafId === null) rafId = requestAnimationFrame(applyFrame);
                  };
                  const handleUp = () => {
                    if (rafId !== null) { cancelAnimationFrame(rafId); rafId = null; }
                    // Ensure lastX reflects the final pointer position even if the last
                    // mousemove's rAF frame had not fired yet — so the committed size
                    // matches exactly where the user released.
                    if (pendingEvent) lastX = computeX(pendingEvent.clientX);
                    setResizingId(null);
                    setResizingType(null);
                    document.body.classList.remove('resizing');
                    window.removeEventListener('mousemove', handleMove);
                    window.removeEventListener('mouseup', handleUp);
                    // isResizingRef is cleared by the resizingId effect below,
                    // not here — see D12 fix note there.
                    // D12 fix (round 4) — the real cause of the "playhead jumps to
                    // wherever I dragged" report: each segment row is a flex item, so
                    // its on-screen left edge is the sum of every PRECEDING row's width,
                    // which never changes while THIS row is being resized. The right-edge
                    // handle sits at `right-0`, so it tracks the cursor continuously (row
                    // width is driven live by cursor x) and the mouseup lands on it. The
                    // left-edge handle sits at a fixed `left-0` that never moves during
                    // the drag, so after any meaningful left-edge drag the cursor ends up
                    // far from it at release. The browser fires a native 'click' right
                    // after this mouseup, hit-tested at the release position — for a
                    // left-edge drag that lands on the segment ROW body, not the handle,
                    // whose onClick is onSeek(s.startTime) (Timeline.tsx) — a real,
                    // direct setCurrentTime call, unrelated to anything currentSegment-
                    // or transition-preview-derived. Swallow exactly that one ghost click
                    // before any React handler (row onClick, ruler onMouseDown-installed
                    // handlers, etc.) can see it.
                    if (hasMoved) {
                      const swallowGhostClick = (clickEvent: MouseEvent) => {
                        clickEvent.stopPropagation();
                        clickEvent.preventDefault();
                      };
                      window.addEventListener('click', swallowGhostClick, { capture: true, once: true });
                    }
                    if (!hasMoved) return;
                    // Compute final duration from last known mouse position.
                    let finalDuration: number;
                    let finalTrimStart: number = originalTarget.trimStart ?? 0;
                    if (type === 'end') {
                      finalDuration = Math.max(MIN_SEGMENT_DURATION, (lastX / pps) - originalTarget.startTime);
                    } else {
                      const rawDelta = (lastX / pps) - originalTarget.startTime;
                      finalDuration = Math.max(MIN_SEGMENT_DURATION, originalTarget.duration - rawDelta);
                      finalTrimStart = Math.max(0, (originalTarget.trimStart ?? 0) + rawDelta);
                    }
                    // Speed coupling: clamp duration + compute new playbackSpeed for video.
                    let speedUpdate: { playbackSpeed: number } | undefined;
                    if (isVideoSeg && srcDur > 0) {
                      const finalClipLen = (originalTarget.trimEnd ?? srcDur) - finalTrimStart;
                      if (finalClipLen > 0) {
                        const maxDur = finalClipLen / MIN_PLAYBACK_SPEED;
                        const minDur = Math.max(MIN_SEGMENT_DURATION, finalClipLen / MAX_PLAYBACK_SPEED);
                        finalDuration = Math.max(minDur, Math.min(maxDur, finalDuration));
                        const newSpeed = Math.max(MIN_PLAYBACK_SPEED, Math.min(MAX_PLAYBACK_SPEED, finalClipLen / finalDuration));
                        speedUpdate = { playbackSpeed: newSpeed };
                      }
                    }
                    // Negligible drag — revert live preview to original.
                    if (Math.abs(finalDuration - originalTarget.duration) < 0.01) {
                      setProject(prev => ({ ...prev, segments: originalSegments }));
                      return;
                    }
                    const direction = type === 'end' ? 'right' as const : 'left' as const;
                    speedBaselineRef.current = null;
                    const succeeded = applyDurationChange(
                      originalSegments, id, finalDuration, finalTrimStart, direction, speedUpdate,
                    );
                    // null cascade → locked neighbor blocked: revert live preview.
                    if (!succeeded) setProject(prev => ({ ...prev, segments: originalSegments }));
                  };
                  isResizingRef.current = true;
                  window.addEventListener('mousemove', handleMove);
                  window.addEventListener('mouseup', handleUp);
                }}
                onSegmentUpdate={(updater) => setProject(prev => ({ ...prev, segments: updater(prev.segments) }))}
                onOpenStockSearch={(segmentId) => { setStockTarget(segmentId); setShowStockSearch(true); }}
                onSetTrimmingSegment={setTrimmingSegmentId}
                onSetAdjustingTrim={setIsAdjustingTrim}
                onSelectSegment={(id) => setSelectedSegmentId(id)}
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
          {/* Project name + save status */}
          <div className="flex-shrink-0 px-3 pt-3 pb-2 border-b border-[#1A1A1A]">
            <p className="text-xs text-zinc-400 truncate">{project.name}</p>
            <p className="text-[10px] text-zinc-600 mt-0.5">
              {lastSavedAt ? `Saved` : `Unsaved`}
            </p>
          </div>

          {/* Export button */}
          <div className="p-3 border-b border-[#1A1A1A]">
            <button
              onClick={startExport}
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
                    <p className="text-[10px] text-white font-bold">{exportResolution === '4k' ? '3840×2160' : '1920×1080'}</p>
                  </div>
                  <div className="p-3 bg-[#0A0A0A] border border-[#1A1A1A] rounded-2xl">
                    <p className="text-[8px] text-gray-600 font-black uppercase mb-1">FPS</p>
                    <p className="text-[10px] text-white font-bold">{exportFps} Constant</p>
                  </div>
                </div>
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
              const newAsset: Asset = {
                id,
                name: stock.name,
                url: URL.createObjectURL(blob),
                type: stock.type,
                nativeFps,
              };
              setProject(p => {
                const newAssets = [...p.assets, newAsset];
                const afterTarget = p.segments.map(s =>
                  s.id === targetId
                    ? { ...s, assetId: newAsset.id, playbackSpeed: 1, trimStart: 0 }
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

      {/* Double-click Scene Editor Modal */}
      <AnimatePresence>
        {editingSegment && (
           <div className="fixed inset-0 z-[5000] flex items-center justify-center p-12 bg-black/90 backdrop-blur-2xl">
             <motion.div
               ref={segmentEditorTrapRef}
               initial={{ opacity: 0, scale: 0.9, y: 30 }}
               animate={{ opacity: 1, scale: 1, y: 0 }}
               exit={{ opacity: 0, scale: 0.9, y: 30 }}
               className="w-full max-w-7xl bg-[#080808] border border-white/5 rounded-[40px] overflow-hidden flex h-[90vh] shadow-2xl"
             >
                {/* Visual Preview Section */}
                <div className="flex-1 bg-black relative flex items-center justify-center p-12">
                   <div className="w-full aspect-video rounded-3xl overflow-hidden shadow-2xl border border-white/10 relative">
                      {project.assets.find(a => a.id === editingSegment.assetId) ? (
                        project.assets.find(a => a.id === editingSegment.assetId)!.type === 'video' ? (
                          <video src={project.assets.find(a => a.id === editingSegment.assetId)!.url} className="w-full h-full object-cover" autoPlay muted loop />
                        ) : (
                          <img src={project.assets.find(a => a.id === editingSegment.assetId)!.url} className="w-full h-full object-cover" />
                        )
                      ) : (
                        <div className="w-full h-full flex flex-col items-center justify-center bg-[#0A0A0A] text-gray-800">
                           <AlertCircle size={64} />
                           <span className="text-xl font-bold mt-4 uppercase tracking-[0.3em]">No Asset Linked</span>
                        </div>
                      )}
                      
                      <div className="absolute inset-x-0 bottom-0 p-12 bg-gradient-to-t from-black/80 to-transparent">
                          <h2 className="text-3xl font-black uppercase tracking-tighter text-white mb-2">Untitled Scene</h2>
                          <p className="text-lg text-gray-300 italic leading-relaxed line-clamp-2">"{editingSegment.text}"</p>
                      </div>
                   </div>
                </div>

                {/* Controls Section */}
                <div className="w-[450px] border-left border-white/5 flex flex-col p-12 space-y-10 bg-[#0A0A0A]">
                   <div className="flex justify-between items-start">
                      <div>
                        <h3 className="text-2xl font-black text-white uppercase tracking-tighter">Edit Scene</h3>
                        <p className="text-[10px] text-gray-500 font-bold uppercase tracking-widest mt-1">Precise Timing & Visual Controls</p>
                      </div>
                      <button onClick={() => setEditingSegment(null)} aria-label="Close segment editor" className="p-4 bg-white/5 rounded-2xl hover:bg-red-500 hover:text-white transition-all"><X size={24}/></button>
                   </div>

                   <div className="space-y-8 flex-1 overflow-y-auto pr-4 custom-scrollbar">
                      <div className="space-y-4">
                         <label className="text-[10px] font-black uppercase tracking-[0.2em] text-[#F27D26]">Scene Duration</label>
                         <div className="grid grid-cols-2 gap-4">
                            <div className="p-4 rounded-2xl bg-white/5 border border-white/5 space-y-2">
                               <span className="text-[9px] font-bold text-gray-500 uppercase">Start Time</span>
                               <p className="text-2xl font-mono font-bold">{editingSegment.startTime.toFixed(2)}s</p>
                            </div>
                            <div className="p-4 rounded-2xl bg-white/5 border border-white/5 space-y-2">
                               <span className="text-[9px] font-bold text-gray-500 uppercase">Duration</span>
                               <input 
                                 type="number" 
                                 step="0.1" 
                                 value={editingSegment.duration} 
                                 onChange={(e) => setEditingSegment({...editingSegment, duration: parseFloat(e.target.value) || 0.1})}
                                 className="bg-transparent border-none outline-none text-2xl font-mono font-bold w-full text-[#F27D26]"
                               />
                            </div>
                         </div>
                      </div>

                      {project.assets.find(a => a.id === editingSegment.assetId)?.type === 'video' && (() => {
                        const srcDur = editingSegment.sourceDuration ?? 60;
                        const trimStart = editingSegment.trimStart ?? 0;
                        const trimEnd = editingSegment.trimEnd ?? srcDur;
                        return (
                          <div className="space-y-4">
                            <label className="text-[10px] font-black uppercase tracking-[0.2em] text-blue-500">Visual Trimming (Slip)</label>
                            <div className="p-6 rounded-3xl bg-white/5 border border-white/5 space-y-6">
                              <div className="flex justify-between text-[11px] font-mono">
                                <span className="text-gray-500">Video Start</span>
                                <span className="text-blue-400 font-bold">{trimStart.toFixed(2)}s</span>
                              </div>
                              <input
                                type="range" min="0" max={srcDur} step="0.1"
                                value={trimStart}
                                onChange={(e) => {
                                  const val = parseFloat(e.target.value);
                                  const next = { ...editingSegment, trimStart: val };
                                  if (editingSegment.trimEnd !== undefined && val >= editingSegment.trimEnd) {
                                    next.trimEnd = Math.min(srcDur, val + 0.1);
                                  }
                                  setEditingSegment(next);
                                }}
                                className="w-full accent-blue-500"
                              />
                              <div className="flex justify-between text-[11px] font-mono">
                                <span className="text-gray-500">Video End</span>
                                <span className="text-purple-400 font-bold">
                                  {editingSegment.trimEnd !== undefined
                                    ? `${editingSegment.trimEnd.toFixed(2)}s`
                                    : 'end of media'}
                                </span>
                              </div>
                              <div className="flex items-center gap-2">
                                <input
                                  type="range" min={trimStart + 0.1} max={srcDur} step="0.1"
                                  value={trimEnd}
                                  onChange={(e) => {
                                    const val = parseFloat(e.target.value);
                                    setEditingSegment({ ...editingSegment, trimEnd: Math.max(trimStart + 0.1, val) });
                                  }}
                                  className="flex-1 accent-purple-500"
                                />
                                {editingSegment.trimEnd !== undefined && (
                                  <button
                                    onClick={() => setEditingSegment({ ...editingSegment, trimEnd: undefined })}
                                    title="Reset to end of media"
                                    className="text-base font-black text-gray-400 hover:text-red-400 transition-colors px-2"
                                    aria-label="Reset trim end to end of media"
                                  >
                                    ×
                                  </button>
                                )}
                              </div>
                            </div>
                          </div>
                        );
                      })()}

                      <div className="space-y-4">
                         <label className="text-[10px] font-black uppercase tracking-[0.2em] text-gray-500">Playback Speed</label>
                         <div className="flex items-center gap-4">
                            <div className="flex-1 p-3 bg-black rounded-xl border border-white/5 text-center">
                               <span className="text-[9px] font-bold text-gray-600 block uppercase mb-1">Speed</span>
                               <span className="text-sm font-bold text-white">{editingSegment.playbackSpeed?.toFixed(2)}x</span>
                            </div>
                            <div className="flex gap-2">
                               <button onClick={() => setEditingSegment({...editingSegment, playbackSpeed: Math.max(0.2, (editingSegment.playbackSpeed || 1) - 0.1)})} className="p-3 bg-white/5 rounded-xl hover:bg-white/10 transition-all">-</button>
                               <button onClick={() => setEditingSegment({...editingSegment, playbackSpeed: Math.min(3, (editingSegment.playbackSpeed || 1) + 0.1)})} className="p-3 bg-white/5 rounded-xl hover:bg-white/10 transition-all">+</button>
                            </div>
                         </div>
                      </div>

                      <div className="space-y-4">
                         <label className="text-[10px] font-black uppercase tracking-[0.2em] text-gray-500">Script</label>
                         <textarea
                            value={editingSegment.text} 
                            onChange={(e) => setEditingSegment({...editingSegment, text: e.target.value})}
                            className="w-full bg-white/5 border border-white/5 p-4 rounded-2xl h-32 outline-none focus:border-[#F27D26]/50 text-sm leading-relaxed"
                         />
                      </div>
                   </div>

                   <div className="pt-10 flex gap-4">
                      <button 
                         onClick={() => setEditingSegment(null)}
                         className="flex-1 py-5 rounded-3xl text-[10px] uppercase font-black tracking-widest text-gray-500 hover:bg-white/5 transition-all"
                      >Cancel</button>
                      <button 
                         onClick={() => {
                            setProject(p => ({
                               ...p,
                               segments: p.segments.map(s => s.id === editingSegment.id ? editingSegment : s)
                            }));
                            setEditingSegment(null);
                         }}
                         className="flex-1 py-5 bg-[#F27D26] text-white rounded-3xl text-[10px] uppercase font-black tracking-widest shadow-2xl shadow-[#F27D26]/30 hover:scale-[1.02] transition-all"
                      >Apply Changes</button>
                   </div>
                </div>
             </motion.div>
           </div>
        )}
      </AnimatePresence>

      {/* Export success toast — bottom-right, auto-dismisses after 10 s */}
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
              Export complete
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

    </div>
  );
}
