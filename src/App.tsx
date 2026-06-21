/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useRef, useEffect, useMemo, useCallback, ChangeEvent, lazy, Suspense, type ReactElement } from 'react';
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
  HeadingConfig,
  Asset,
  TransitionType,
  AnimationType,
  TextOverlay,
} from './types';
import { StockResult } from './services/stockService';
import { isFuzzyMatch, findAssetByContext, autoMatchSegments, applyAnchorBasedTiming, getSegmentStableKey, getFileIdentity } from './services/syncEngine';
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
import { FONT_FAMILIES, FILTERS, TEXT_ANIMATIONS, getFilterStyle, getMotionProps, HEADING_ONLY_DURATION_SECONDS } from './constants';
import { HEADING_DEFAULT_DURATION, applyHeadingTiming } from './services/whisperService';
import { SegmentEditorPanel } from './components/SegmentEditorPanel';
import { DropZonePanel, type StagedFiles } from './components/DropZonePanel';
import { BottomDrawer } from './components/BottomDrawer';
const StockSearchModal = lazy(() =>
  import('./components/StockSearchModal').then(m => ({ default: m.StockSearchModal }))
);
const SyncReviewModal = lazy(() =>
  import('./components/SyncReviewModal').then(m => ({ default: m.SyncReviewModal }))
);
import { Timeline } from './components/Timeline';
import { PreviewStage } from './components/PreviewStage';
import { SyncWizard } from './components/SyncWizard';
import { SettingsPanel } from './components/SettingsPanel';
import { ProjectDashboard } from './components/ProjectDashboard';
import { NewProjectModal } from './components/NewProjectModal';
import { ErrorBoundary, PanelFallback } from './components/ErrorBoundary';
import { useExport, type ExportResolution, type ExportFps, type ExportError } from './hooks/useExport';
import { useWhisper } from './hooks/useWhisper';
import { usePlayback } from './hooks/usePlayback';
import { TranscriptionBar } from './components/TranscriptionBar';
import { isTauri } from './services/tauriFfmpeg';
import { invoke } from '@tauri-apps/api/core';

interface RawSegment {
  text: string;
  heading?: string;           // legacy alias only; prefer isHeading + headingConfig
  isHeading?: boolean;
  headingConfig?: HeadingConfig;
  assetId?: string;
  transition: TransitionType;
  animation: AnimationType;
  playbackSpeed: number;
  trimStart: number;
  isMuted: boolean;
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

/** Returns audio duration with a 5 s timeout that falls back to 60 s. */
const getAudioDuration = (url: string): Promise<number> =>
  new Promise((resolve) => {
    const audio = document.createElement('audio');
    const timer = setTimeout(() => { audio.src = ''; resolve(60); }, 5000);
    audio.onloadedmetadata = () => { clearTimeout(timer); resolve(audio.duration); };
    audio.onerror = () => { clearTimeout(timer); resolve(60); };
    audio.src = url;
  });

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
  return { id, name: file.name, url, type, file };
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
      newAssets.push({ id, name, url: URL.createObjectURL(blob), type, file: new File([blob], filename) });
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

// ---------------------------------------------------------------------------
// Migration: legacy `heading` string → isHeading + headingConfig
// ---------------------------------------------------------------------------

/** Upgrades any segment carrying the legacy `heading` string field to the new
 *  `isHeading + headingConfig` shape.  Safe to call multiple times (idempotent). */
function migrateSegmentHeadings(segments: VideoSegment[]): VideoSegment[] {
  return segments.map(seg => {
    if (seg.isHeading || !seg.heading) return seg; // already migrated or not a heading
    return {
      ...seg,
      isHeading: true as const,
      headingConfig: seg.headingConfig ?? {
        text: seg.heading,
      },
    };
  });
}

/**
 * Inserts a [HEADING: text] tag into sceneDetails at the position
 * corresponding to insertAtSceneIdx (0 = before all scenes, N = after the
 * N-th tag, >= matches.length = after all scenes).
 */
function insertHeadingIntoSceneDetails(
  sceneDetails: string,
  insertAtSceneIdx: number,
  headingText: string,
): string {
  const matches = [...sceneDetails.matchAll(/\[(?:IMAGE|VIDEO|HEADING)\s*:[^\]]*\]/gi)];
  const insertTag = `\n[HEADING: ${headingText}]\n`;
  if (insertAtSceneIdx === 0) return insertTag + sceneDetails;
  if (insertAtSceneIdx >= matches.length) return sceneDetails + insertTag;
  const targetMatch = matches[insertAtSceneIdx];
  if (!targetMatch) return sceneDetails + insertTag;
  const idx = targetMatch.index ?? 0;
  return sceneDetails.slice(0, idx) + insertTag + sceneDetails.slice(idx);
}

// Enhanced parser that handles heading-voiceover logic
const parseProjectData = async (
  script: string,
  sceneDetails: string,
  assets: Asset[],
  voiceoverDuration: number = 0,
): Promise<VideoSegment[]> => {
  // Split on the start of each bracketed tag so blank lines between a tag and its
  // description text stay within the same block (not treated as a scene boundary).
  const TAG_REGEX = /(?=\[(?:IMAGE|VIDEO|HEADING)\s*:)/i;
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

    const isHeadingTag = scene.tag.toUpperCase().includes('HEADING');

    // Heading scenes carry no spoken text — don't distribute script lines to them.
    if (!text && !isHeadingTag) {
      if (scriptLines.length === sceneCount) {
        text = scriptLines[idx] ?? '';
      } else if (scriptLines.length > 0) {
        const startIdx = Math.floor((idx / sceneCount) * scriptLines.length);
        const endIdx = Math.floor(((idx + 1) / sceneCount) * scriptLines.length);
        text = scriptLines.slice(startIdx, endIdx).join(' ');
      }
    }
    if (isHeadingTag) text = ''; // headings are silent title cards

    const current: RawSegment = {
      text,
      transition: TransitionType.NONE,
      animation: AnimationType.NONE,
      playbackSpeed: 1,
      trimStart: 0,
      isMuted: true,
      extraOverlays: [],
    };

    let name = '';
    const detail = scene.tag;

    const specificMatch = detail.match(/\[(?:IMAGE|VIDEO|HEADING):\s*(.*?)\s*\]/i);
    if (specificMatch) {
      if (isHeadingTag) {
        const headingText = specificMatch[1] ?? '';
        current.isHeading = true;
        current.headingConfig = { text: headingText };
        current.heading = headingText; // keep legacy alias
      } else {
        name = specificMatch[1] ?? '';
      }
    } else {
      const simpleMatch = detail.match(/\[(.*?)\]/);
      if (simpleMatch) name = simpleMatch[1] ?? '';
      else name = detail;
    }

    const hasExplicitTagName = specificMatch !== null &&
      !isHeadingTag &&
      (specificMatch[1] ?? '').length > 0;

    if (name) {
      const matchingAssets = assets.filter(a => isFuzzyMatch(name, a.name));
      const unusedAsset = matchingAssets.find(a => !usedAssetIdsTotal.has(a.id));
      const asset = unusedAsset ?? matchingAssets[0];
      if (asset) {
        current.assetId = asset.id;
        usedAssetIdsTotal.add(asset.id);
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

    rawSegments.push(current);
  }

  const headingOnlyScenes = rawSegments.filter(s => s.isHeading);
  const textBearingScenes = rawSegments.filter(s => s.text);
  const voDuration = voiceoverDuration > 0 ? voiceoverDuration : rawSegments.length * 5;

  // Headings get a fixed initial size (applyHeadingTiming will correct to 1.0s after Whisper).
  // Deduct heading allocation from the text budget so the cumulative durations stay ≤ voDuration.
  let headingDuration = HEADING_ONLY_DURATION_SECONDS;
  let headingTotal = headingOnlyScenes.length * HEADING_ONLY_DURATION_SECONDS;
  if (headingOnlyScenes.length > 0 && voDuration - headingTotal <= 0) {
    headingTotal = voDuration * 0.5;
    headingDuration = headingTotal / headingOnlyScenes.length;
  }
  const textBudget = Math.max(0.1, voDuration - headingTotal);
  const totalTextLength = textBearingScenes.reduce((acc, s) => acc + s.text.length, 0) || 1;

  let currentTimeAccumulator = 0;
  const finalSegments: VideoSegment[] = [];

  for (const [i, s] of rawSegments.entries()) {
    let targetDuration: number;

    if (s.isHeading) {
      // Heading-only scene: fixed initial size; applyHeadingTiming will pin to 1.0 s after Whisper.
      targetDuration = headingDuration;
    } else if (textBearingScenes.length > 0) {
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

    if (i === rawSegments.length - 1 && voiceoverDuration > 0 && !segment.isHeading) {
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
        .map(s => s.headingConfig?.text || s.heading || s.id)
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
  script: 'Welcome to Kinetix Studio. This tool automatically syncs your voiceover with your visuals. Headings pause the voiceover during transitions. Text segments stretch to fit your audio duration perfectly.',
  sceneDetails: '[IMAGE: intro.jpg]\n[IMAGE: tech.jpg]',
  segments: [],
  assets: [],
  globalTransition: TransitionType.NONE,
  globalTransitionDuration: 0.5,
  globalAnimation: AnimationType.NONE,
  hideAllText: true,
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

/** Recomputes sequential startTimes from accumulated durations. Pure. */
function recomputeStartTimes(segs: VideoSegment[]): VideoSegment[] {
  let acc = 0;
  return segs.map(s => {
    const t = acc;
    acc += s.duration;
    return { ...s, startTime: Number(t.toFixed(3)) };
  });
}

/** Diagnostic only — temporary, remove once the click-twice bug is found. */
function logSyncDiag(stage: string, segments: VideoSegment[]): void {
  console.log(`[SYNC-DIAG] ${stage}`);
  console.table(segments.map((s, index) => ({
    index,
    startTime: Number(s.startTime.toFixed(3)),
    duration: Number(s.duration.toFixed(3)),
    anchorStart: s.anchorStart !== undefined ? Number(s.anchorStart.toFixed(3)) : undefined,
    anchorSource: s.anchorSource,
    locked: !!s.locked,
  })));
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
  const [activeTab, setActiveTab] = useState<'script' | 'assets' | 'settings' | 'editor'>('script');
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [isProcessing, setIsProcessing] = useState(false);
  const [zoomLevel, setZoomLevel] = useState(1);
  const [globalPlaybackSpeed, setGlobalPlaybackSpeed] = useState(1);
  const [isAdjustingTrim, setIsAdjustingTrim] = useState(false);
  const [syncStep, setSyncStep] = useState<0 | 1 | 2 | 3 | 4>(0);
  const [showSyncDetails, setShowSyncDetails] = useState(false);
  const [editingSegment, setEditingSegment] = useState<VideoSegment | null>(null);
  const exportModalTrapRef = useFocusTrap<HTMLDivElement>();
  const segmentEditorTrapRef = useFocusTrap<HTMLDivElement>();
  const [syncValidation, setSyncValidation] = useState<{
    voMatch: boolean;
    scriptScenesMatch: boolean;
    assetsMatch: boolean;
    missingAssets: string[];
  }>({
    voMatch: false,
    scriptScenesMatch: false,
    assetsMatch: false,
    missingAssets: []
  });
  const [isSynced, setIsSynced] = useState(false);
  const [selectedSegmentId, setSelectedSegmentId] = useState<string | null>(null);
  const [leftPanelCollapsed, setLeftPanelCollapsed] = useState(false);
  const [rightPanelCollapsed, setRightPanelCollapsed] = useState(false);
  const [previewHeight, setPreviewHeight] = useState(() => Math.floor((window.innerHeight - 4) / 2));
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
  const pendingVoiceoverRef = useRef<{ file: File; asset: Asset } | null>(null);
  // Synchronous guard: true while a timeline resize drag is in progress.
  // Cleared via a one-frame rAF delay in handleUp so it stays true through
  // the render that processes the final mousemove setProject call.
  const isResizingRef = useRef(false);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Baseline for speed-slider drag: captured on the FIRST tick of a new drag gesture
  // so that all subsequent ticks divide by the same original clipLen, preventing the
  // feedback loop where each tick reads the previous tick's just-written duration.
  const speedBaselineRef = useRef<{ segmentId: string; clipLen: number } | null>(null);



  // Ref bridge so the mount-only hydration effect ([] deps) can call
  // handleSwitchProject, which is defined later in the component body.
  // The ref is updated every render so it always holds the latest version.
  const handleSwitchProjectRef = useRef<(id: string) => Promise<void>>(async () => {});

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
        // First ever launch — no projects yet.
        setShowDashboard(false);
        setShowNewProjectModal(true);
        setIsHydrating(false);
        return;
      }

      if (lastId && allMetas.some(m => m.id === lastId)) {
        // Reload case — reopen the last active project directly.
        await handleSwitchProjectRef.current(lastId);
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
    setProject(prev => ({
      ...prev,
      segments: prev.segments.map(s =>
        s.id === segmentId ? { ...s, locked: !s.locked } : s
      ),
    }));
  }, []);

  const handleUnlockAll = useCallback((): void => {
    setProject(prev => ({
      ...prev,
      segments: prev.segments.map(s => ({ ...s, locked: false })),
    }));
  }, []);

  const handleInsertHeading = useCallback((afterIndex: number): void => {
    setProject(prev => {
      const segs = prev.segments;
      const insertAt = afterIndex + 1; // -1 → 0 (prepend); i → i+1 (after segment i)
      const HEADING_DUR = HEADING_DEFAULT_DURATION; // 1.0 s
      const HALF = HEADING_DUR / 2;                // 0.5 s each side
      const MIN_DUR = 0.1;

      // Work on a mutable copy so we can adjust neighbor durations.
      const draft = segs.map(s => ({ ...s }));

      const prevSeg = draft[insertAt - 1] as typeof draft[number] | undefined;
      const nextSeg = draft[insertAt] as typeof draft[number] | undefined;

      // Steal time from both neighbors. Locked segments are still absorbed — insertion
      // is a deliberate user action. We warn but do not skip.
      let prevSteal = 0;
      let nextSteal = 0;

      if (!prevSeg && !nextSeg) {
        // Empty timeline — heading just takes 1.0 s of new time, that's fine.
      } else if (!prevSeg) {
        // Prepend: take full 1.0 s from next segment.
        nextSteal = Math.min(HEADING_DUR, (nextSeg!.duration) - MIN_DUR);
        if (nextSeg?.locked) console.warn('[handleInsertHeading] absorbing from locked segment (next)');
      } else if (!nextSeg) {
        // Append: take full 1.0 s from prev segment.
        prevSteal = Math.min(HEADING_DUR, (prevSeg.duration) - MIN_DUR);
        if (prevSeg.locked) console.warn('[handleInsertHeading] absorbing from locked segment (prev)');
      } else {
        // Middle: try HALF from each; spill remainder to the other.
        const prevAvail = Math.max(0, prevSeg.duration - MIN_DUR);
        const nextAvail = Math.max(0, nextSeg.duration - MIN_DUR);
        prevSteal = Math.min(HALF, prevAvail);
        const remaining = HEADING_DUR - prevSteal;
        nextSteal = Math.min(remaining, nextAvail);
        const stillRemaining = HEADING_DUR - prevSteal - nextSteal;
        if (stillRemaining > 0) {
          // spill back to prev if next was short
          prevSteal += Math.min(stillRemaining, prevAvail - prevSteal);
        }
        if (prevSeg.locked || nextSeg?.locked) {
          console.warn('[handleInsertHeading] absorbing from locked segment(s)');
        }
      }

      const actualDur = Number((prevSteal + nextSteal).toFixed(3)) || HEADING_DUR;

      if (prevSeg) prevSeg.duration = Number((prevSeg.duration - prevSteal).toFixed(3));
      if (nextSeg) nextSeg.duration = Number((nextSeg.duration - nextSteal).toFixed(3));

      const headingStart = prevSeg
        ? Number((prevSeg.startTime + prevSeg.duration).toFixed(3))
        : 0;

      if (nextSeg) {
        nextSeg.anchorStart = Number((headingStart + actualDur).toFixed(3));
      }

      const existingHeadingCount = prev.segments.filter(s => s.isHeading).length;
      const defaultText = `Heading ${existingHeadingCount + 1}`;

      const newHeading: VideoSegment = {
        id: crypto.randomUUID(),
        order: insertAt,
        text: '',
        heading: defaultText,
        isHeading: true,
        headingConfig: { text: defaultText, x: 50, y: 50 },
        duration: actualDur,
        startTime: headingStart,
        anchorStart: headingStart,
        anchorSource: 'whisper',
        transition: TransitionType.NONE,
        animation: AnimationType.NONE,
      };

      const merged = [
        ...draft.slice(0, insertAt),
        newHeading,
        ...draft.slice(insertAt),
      ];

      // Recompute startTimes via cumulative sum so everything is contiguous.
      let cursor = 0;
      const reordered = merged.map((s, i) => {
        const out = { ...s, order: i, startTime: Number(cursor.toFixed(3)) };
        cursor += s.duration;
        return out;
      });

      const newSceneDetails = insertHeadingIntoSceneDetails(
        prev.sceneDetails,
        insertAt,
        defaultText,
      );

      return { ...prev, segments: reordered, sceneDetails: newSceneDetails };
    });
  }, []);

  const handleDeleteHeading = useCallback((segmentId: string): void => {
    setProject(prev => {
      const idx = prev.segments.findIndex(s => s.id === segmentId);
      if (idx === -1) return prev;
      const heading = prev.segments[idx];
      if (!heading?.isHeading) return prev;

      const headingDur = heading.duration;
      const headingText = heading.headingConfig?.text ?? heading.heading ?? '';

      const newSegs = [...prev.segments];
      const prevSeg = newSegs[idx - 1];
      const nextSeg = newSegs[idx + 1];

      // Return time to neighbors — reverse of the absorption done at insertion.
      if (prevSeg && nextSeg) {
        newSegs[idx - 1] = { ...prevSeg, duration: prevSeg.duration + headingDur / 2 };
        newSegs[idx + 1] = { ...nextSeg, duration: nextSeg.duration + headingDur / 2 };
      } else if (prevSeg) {
        newSegs[idx - 1] = { ...prevSeg, duration: prevSeg.duration + headingDur };
      } else if (nextSeg) {
        newSegs[idx + 1] = { ...nextSeg, duration: nextSeg.duration + headingDur };
      }

      // Restore next.anchorStart to its true pre-insertion position: prev's restored
      // anchorStart + prev's restored duration — i.e. where next would sit if the
      // heading had never existed. (The old formula subtracted headingDur from next's
      // current anchor, which reproduces the HEADING's own anchor, not next's true one.)
      const updatedPrev = newSegs[idx - 1];
      const updatedNext = newSegs[idx + 1];
      if (updatedNext && updatedPrev) {
        if (updatedPrev.anchorStart !== undefined) {
          newSegs[idx + 1] = {
            ...updatedNext,
            anchorStart: Number((updatedPrev.anchorStart + updatedPrev.duration).toFixed(3)),
          };
        }
      } else if (updatedNext && !updatedPrev) {
        // Heading was at position 0 — next becomes the new first segment, anchored at 0.
        newSegs[idx + 1] = { ...updatedNext, anchorStart: 0 };
      }

      // Remove heading from array.
      newSegs.splice(idx, 1);

      // Recompute startTimes cumulatively.
      let t = 0;
      for (let i = 0; i < newSegs.length; i++) {
        newSegs[i] = { ...newSegs[i]!, startTime: Number(t.toFixed(3)) };
        t += newSegs[i]!.duration;
      }

      // Remove [HEADING: <text>] tag from sceneDetails.
      const tagPattern = new RegExp(
        `\\n?\\[HEADING:\\s*${headingText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\]\\n?`,
        'i',
      );
      const newSceneDetails = prev.sceneDetails.replace(tagPattern, '\n');

      return { ...prev, segments: newSegs, sceneDetails: newSceneDetails };
    });
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

  const runSyncStep1 = () => {
    // Step 1: Match Script and Voiceover
    const hasVO = !!project.voiceoverId;
    const wordCount = project.script.split(/\s+/).filter(w => w.length > 0).length;
    const voDuration = audioRef.current?.duration || 0;
    
    // Heuristic: Audio should be at least some length for at least 3 words
    const isPlausible = hasVO && voDuration > 1 && wordCount > 0;
    
    setSyncValidation(prev => ({ ...prev, voMatch: isPlausible }));
    if (isPlausible) {
      setSyncStep(1);
    } else {
      alert(`Sync Failed: ${!hasVO ? 'Please upload a voiceover (mp3/wav).' : 'Script word count (' + wordCount + ') and voiceover duration (' + voDuration.toFixed(1) + 's) mismatch.'}`);
    }
  };

  const runSyncStep2 = () => {
    // Step 2: Match Scene Details and Script
    const detailsLines = project.sceneDetails.split(/\r?\n\r?\n/).map(l => l.trim()).filter(l => l !== '');
    const scriptLines = project.script.split(/\r?\n/).map(l => l.trim()).filter(l => l !== '');
    
    // Any scenes found?
    const hasScenes = detailsLines.length > 0;
    const countMatch = detailsLines.length === scriptLines.length;
    
    setSyncValidation(prev => ({ ...prev, scriptScenesMatch: hasScenes }));
    if (hasScenes) {
      setSyncStep(2);
      if (!countMatch) {
        console.log(`Note: Detail lines (${detailsLines.length}) and script lines (${scriptLines.length}) don't match exactly. Proportional sync will be used.`);
      }
    } else {
      alert("No scene details found. Please add bracketed names like [frozen_train] or [IMAGE: train.mp4] in Scene Details.");
    }
  };

  const runSyncStep3 = () => {
    // Step 3: Match Visual Names and assets
    const detailsLines = project.sceneDetails.split(/\r?\n\r?\n/).map(l => l.trim()).filter(l => l !== '');
    
    const missing: string[] = [];
    let matchCount = 0;
    
    detailsLines.forEach(line => {
      let name = '';
      const specificMatch = line.match(/\[(?:IMAGE|VIDEO|HEADING):\s*(.*?)\s*\]/i);
      if (specificMatch) {
        if (!line.toUpperCase().includes('HEADING')) name = specificMatch[1] ?? '';
      } else {
        const simpleMatch = line.match(/\[(.*?)\]/);
        if (simpleMatch) name = simpleMatch[1] ?? '';
      }

      if (name) {
        const found = project.assets.find(a => isFuzzyMatch(name, a.name));
        if (found) {
          matchCount++;
        } else {
          missing.push(name);
        }
      }
    });
    
    const allMatched = missing.length === 0 && matchCount > 0;
    setSyncValidation(prev => ({ ...prev, assetsMatch: allMatched, missingAssets: missing }));
    
    if (matchCount > 0 || detailsLines.length === 0) {
      setSyncStep(3);
      if (missing.length > 0) {
        alert(`Detected ${matchCount} matches. Missing ${missing.length} visuals: ${missing.join(', ')}. Contextual search will fill these.`);
      }
    } else {
      alert("No uploaded visuals match the bracketed names in your Scene Details.");
    }
  };

  // Calibration logic - Final Step
  const finalizeSync = async () => {
    setIsProcessing(true);
    // Prefer the synchronous read (already loaded); fall back to an async load
    // when loadedmetadata has not yet fired (e.g. rapid upload → Apply Sync).
    let audioDuration = audioRef.current?.duration || 0;
    if (!audioDuration && projectRef.current.voiceoverId) {
      const voiceoverForDuration = projectRef.current.assets.find(
        a => a.id === projectRef.current.voiceoverId,
      );
      if (voiceoverForDuration) {
        audioDuration = await getAudioDuration(voiceoverForDuration.url);
        if (!audioDuration) {
          showToast('Voiceover metadata not ready — try again in a moment');
          setIsProcessing(false);
          return;
        }
      }
    }
    const newSegments = await parseProjectData(
      projectRef.current.script,
      projectRef.current.sceneDetails,
      projectRef.current.assets,
      audioDuration,
    );

    // Lock restoration: keyed first by stable identity (assetId for image/video segments,
    // heading text for title cards), then by order+text as fallback. See getSegmentStableKey.
    // First-wins insertion prevents a duplicate assetId from silently overwriting an earlier entry.
    const stableKey = getSegmentStableKey;
    const prevByKey = new Map<string, VideoSegment>();
    for (const s of projectRef.current.segments) {
      const key = stableKey(s);
      if (!prevByKey.has(key)) prevByKey.set(key, s);
    }
    const syncedSegments = newSegments.map(s => {
      const prev = prevByKey.get(stableKey(s));
      return {
        ...s,
        assetId: s.assetId,
        trimStart: prev?.trimStart ?? s.trimStart,
        trimEnd: prev?.trimEnd ?? s.trimEnd,
        playbackSpeed: prev?.playbackSpeed ?? s.playbackSpeed,
        isMuted: prev?.isMuted ?? s.isMuted,
        locked: s.isHeading ? undefined : prev?.locked,
        anchorStart: prev?.anchorStart ?? s.anchorStart,
        anchorSource: prev?.anchorSource ?? s.anchorSource,
        duration: prev?.locked && !s.isHeading
          ? (prev.duration ?? s.duration)
          : s.duration,
        startTime: prev?.locked && !s.isHeading
          ? (prev.startTime ?? s.startTime)
          : s.startTime,
      };
    });

    // Never wipe existing segments if parse produced nothing
    if (syncedSegments.length === 0 && projectRef.current.segments.length > 0) {
      console.warn('[sync] parseProjectData returned 0 segments — keeping existing segments');
      setIsProcessing(false);
      return;
    }

    const anchorTimed = applyAnchorBasedTiming(syncedSegments, audioDuration);
    const headingTimed = applyHeadingTiming(anchorTimed);

    setProject(prev => ({ ...prev, segments: headingTimed }));
    setIsSynced(true);
    setIsProcessing(false);
    setSyncStep(4);
    setActiveTab('editor');

    // Trigger transcription (Tauri only) — segment-ID gate inside startTranscription guards correctness
    const voiceoverAsset = projectRef.current.assets.find(a => a.id === projectRef.current.voiceoverId);
    if (voiceoverAsset && isTauri()) {
      startTranscription(
        voiceoverAsset,
        audioDuration,
        headingTimed,
        projectRef.current,
        (updated) => {
          setProject(prev => {
            // Defense-in-depth: reject the Whisper update if the segment set has
            // changed since alignment started (primary gate is in startTranscription).
            if (prev.segments.length !== updated.length) {
              console.warn('[whisper] Rejecting alignment update — segment count changed', {
                current: prev.segments.length,
                incoming: updated.length,
              });
              return prev;
            }
            const currentIds = new Set(prev.segments.map(s => s.id));
            for (const seg of updated) {
              if (!currentIds.has(seg.id)) {
                console.warn('[whisper] Rejecting alignment update — segment ID mismatch');
                return prev;
              }
            }
            return { ...prev, segments: updated };
          });
        },
        (updater) => setProject(updater),
      );
    }
  };

  /** '1080p' | '4k' */
  const [exportResolution, setExportResolution] = useState<ExportResolution>('1080p');
  /** frames per second */
  const [exportFps, setExportFps] = useState<ExportFps>(30);
  const previewRef = useRef<HTMLDivElement>(null);

  const onExportSavePath = useCallback((path: string) => {
    setProject(p => ({ ...p, lastExportPath: path }));
  }, []);
  const exportApi = useExport(project, exportResolution, exportFps, onExportSavePath);
  const { state: exportState, startExport, cancelExport, retryExport, dismissSuccess } = exportApi;

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
    };
    setPendingVoiceover({ file, asset });

    // Same-file detection: this exact file was already transcribed and its
    // tokens are still cached — skip the Whisper run entirely. Apply Sync
    // stays enabled via the lastTranscribedFileIdentity clause below.
    const cachedTokensExist = (projectRef.current.transcriptTokens?.length ?? 0) > 0;
    if (projectRef.current.lastTranscribedFileIdentity === incomingIdentity && cachedTokensExist) {
      return;
    }

    void (async () => {
      const duration = await getAudioDuration(asset.url);
      startTranscription(
        asset,
        duration,
        [],
        projectRef.current,
        () => {},
        (updater) => setProject(updater),
      );
    })();
  }, [cancelTranscription, startTranscription]);

  // Cancels an in-flight staging-time transcription and discards the
  // ephemeral asset — used when the user removes or replaces a staged
  // voiceover before ever clicking Apply Sync.
  const handleVoiceoverUnstaged = useCallback(() => {
    const pending = pendingVoiceoverRef.current;
    if (!pending) return;
    cancelTranscription();
    URL.revokeObjectURL(pending.asset.url);
    setPendingVoiceover(null);
  }, [cancelTranscription]);

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

    if (staged.voiceoverFile) {
      if (!allAssets.some(a => a.name === staged.voiceoverFile!.file.name)) {
        const pending = pendingVoiceoverRef.current;
        const reusingPending = pending !== null && pending.file === staged.voiceoverFile.file;
        const asset = reusingPending
          ? await persistPendingVoiceoverAsset(projectRef.current.id, pending!.asset)
          : await persistFileToAsset(projectRef.current.id, staged.voiceoverFile.file, 'audio');
        if (asset) {
          allAssets.push(asset);
          newVoiceoverId = asset.id;
          // The ephemeral asset is now a real, committed one — forget the
          // pending reference without revoking its (now in-use) blob URL.
          if (reusingPending) setPendingVoiceover(null);
        }
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
      audioDuration = await getAudioDuration(voiceoverAsset.url);
    }

    // 5. Parse project data with the fresh, complete data
    const newSegments = await parseProjectData(scriptText, sceneText, allAssets, audioDuration);

    // 6. Preserve locked durations: keyed first by stable identity (assetId or heading text),
    //    then by order+text as fallback — same strategy as finalizeSync. See getSegmentStableKey.
    // First-wins insertion prevents a duplicate assetId from silently overwriting an earlier entry.
    const stableKey = getSegmentStableKey;
    const prevByKey = new Map<string, VideoSegment>();
    for (const s of projectRef.current.segments) {
      const key = stableKey(s);
      if (!prevByKey.has(key)) prevByKey.set(key, s);
    }
    const syncedSegments = newSegments.map(s => {
      const prev = prevByKey.get(stableKey(s));
      return {
        ...s,
        assetId: s.assetId,
        trimStart: prev?.trimStart ?? s.trimStart,
        trimEnd: prev?.trimEnd ?? s.trimEnd,
        playbackSpeed: prev?.playbackSpeed ?? s.playbackSpeed,
        isMuted: prev?.isMuted ?? s.isMuted,
        locked: s.isHeading ? undefined : prev?.locked,
        anchorStart: prev?.anchorStart ?? s.anchorStart,
        anchorSource: prev?.anchorSource ?? s.anchorSource,
        duration: prev?.locked && !s.isHeading
          ? (prev.duration ?? s.duration)
          : s.duration,
        startTime: prev?.locked && !s.isHeading
          ? (prev.startTime ?? s.startTime)
          : s.startTime,
      };
    });

    // Never wipe existing segments if parse produced nothing
    if (syncedSegments.length === 0 && projectRef.current.segments.length > 0) {
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
      && projectRef.current.lastTranscribedAssetId === voiceoverAsset.id
      && (projectRef.current.transcriptTokens?.length ?? 0) > 0;

    logSyncDiag('1 input segments (before applyAnchorBasedTiming)', syncedSegments);

    let finalTimedSegments: VideoSegment[];
    if (cachedTokensReady) {
      const anchorTimed = applyAnchorBasedTiming(syncedSegments, audioDuration);
      logSyncDiag('2 after applyAnchorBasedTiming', anchorTimed);
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
      const anchorTimedFallback = applyAnchorBasedTiming(syncedSegments, audioDuration);
      logSyncDiag('2 after applyAnchorBasedTiming (fallback branch)', anchorTimedFallback);
      finalTimedSegments = applyHeadingTiming(anchorTimedFallback);
    }

    const committedSegments = autoMatchSegments(allAssets, finalTimedSegments);
    logSyncDiag('7 final committed segments', committedSegments);

    // 8. Single atomic state update — segments are already final.
    setProject(prev => ({
      ...prev,
      script: scriptText,
      sceneDetails: sceneText,
      scriptFileName: staged.scriptFile?.file.name ?? prev.scriptFileName ?? '',
      sceneDetailsFileName: staged.sceneFile?.file.name ?? prev.sceneDetailsFileName ?? '',
      assets: allAssets,
      voiceoverId: newVoiceoverId,
      segments: committedSegments,
    }));

    setIsSynced(true);
    setIsProcessing(false);
    setSyncStep(4);
    setActiveTab('editor');
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
      return {
        ...prev,
        assets: prev.assets.filter(a => a.id !== assetId),
        voiceoverId: prev.voiceoverId === assetId ? undefined : prev.voiceoverId,
        segments: prev.segments.map(s =>
          s.assetId === assetId ? { ...s, assetId: undefined } : s
        ),
      };
    });
  }, []);

  const handleDeleteAllAssets = useCallback(() => {
    const nonAudio = assetsRef.current.filter(a => a.type !== 'audio');
    nonAudio.forEach(a => URL.revokeObjectURL(a.url));
    Promise.all(nonAudio.map(a => deleteAsset(projectIdRef.current, a.id))).catch(err =>
      console.error('[handleDeleteAllAssets] IndexedDB delete failed:', err)
    );
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

  /** Core zip-extraction logic shared by handleZipUpload and handleDropFiles. */
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

  const handleFileUpload = async (e: ChangeEvent<HTMLInputElement>, type: Asset['type'] | 'script' | 'story' | 'details') => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (type === 'script') {
      const reader = new FileReader();
      reader.onload = (e) => setProject(prev => ({ ...prev, script: e.target?.result as string }));
      reader.readAsText(file);
    } else if (type === 'details') {
      const reader = new FileReader();
      reader.onload = (e) => setProject(prev => ({ ...prev, sceneDetails: e.target?.result as string }));
      reader.readAsText(file);
    } else if (type === 'story') {
      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          const data = JSON.parse(e.target?.result as string);
          if (Array.isArray(data)) {
            // Assume it's a full scene export
            setProject(prev => ({ ...prev, segments: data }));
            setIsSynced(true);
          } else {
            // Story map format not yet implemented
          }
        } catch {
          console.error("Invalid JSON for story map");
        }
      };
      reader.readAsText(file);
    } else {
      let detectedType: Asset['type'] = type as Asset['type'];
      if (file.type.startsWith('video/')) detectedType = 'video';
      else if (file.type.startsWith('audio/')) detectedType = 'audio';
      else if (file.type.startsWith('image/')) detectedType = 'image';
      await processMediaFile(file, detectedType);
    }
  };

  // DEAD CODE — kept for reference, not called anywhere.
  // All file ingestion now goes through DropZonePanel staged
  // state → handleApplySyncFromFiles.
  // Do not delete — may be useful for future drag-drop
  // onto timeline feature.
  const handleDropFiles = useCallback(async (files: File[]): Promise<void> => {
    for (const file of files) {
      const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
      if (ext === 'txt') {
        const text = await file.text();
        setProject(prev => ({ ...prev, sceneDetails: text }));
      } else if (['mp3', 'wav', 'm4a', 'ogg'].includes(ext)) {
        await processMediaFile(file, 'audio');
      } else if (['jpg', 'jpeg', 'png', 'gif', 'webp'].includes(ext)) {
        await processMediaFile(file, 'image');
      } else if (['mp4', 'mov', 'webm', 'm4v'].includes(ext)) {
        await processMediaFile(file, 'video');
      } else if (ext === 'zip') {
        await processZipFile(file);
      }
    }
  }, [processMediaFile, processZipFile]);

  const currentSegment = useMemo(() => {
    const seg = project.segments.find(s => currentTime >= s.startTime && currentTime < s.startTime + s.duration);
    return seg || null;
  }, [currentTime, project.segments]);

  const selectedSegment = project.segments.find(s => s.id === selectedSegmentId) ?? null;
  const selectedSegmentIndex = project.segments.findIndex(s => s.id === selectedSegmentId);

  // Sync volatile values into refs on every render so async handlers and stable
  // callbacks can read the live state without stale closures.
  // Intentionally no dependency array — must run after every render to stay fresh.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    assetsRef.current = project.assets;
    projectRef.current = project;
    projectIdRef.current = project.id;
    pendingVoiceoverRef.current = pendingVoiceover;
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
    transcriptionStatus.phase === 'done'
    || transcriptionStatus.phase === 'error'
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

  // Auto-scroll timeline to keep playhead in view during playback
  useEffect(() => {
    if (isPlaying) {
      const scrollArea = document.getElementById('timeline-scroll-area');
      if (scrollArea) {
        const pixelsPerSecond = 100 * zoomLevel;
        const playheadX = currentTime * pixelsPerSecond;
        const viewWidth = scrollArea.clientWidth;
        const scrollLeft = scrollArea.scrollLeft;
        const padding = 150; // threshold from edge to start scrolling

        if (playheadX > scrollLeft + viewWidth - padding) {
          scrollArea.scrollLeft = playheadX - viewWidth + padding;
        } else if (playheadX < scrollLeft + (padding / 2)) {
          scrollArea.scrollLeft = Math.max(0, playheadX - (padding / 2));
        }
      }
    }
  }, [currentTime, isPlaying, zoomLevel]);

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

  // Validate the useState initializer against the real layout after first paint.
  // window.innerHeight may differ from the center column's actual usable height.
  useEffect(() => {
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

  const handleSwitchProject = async (id: string): Promise<void> => {
    setShowDashboard(false);
    if (id === project.id) return;

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
        return { ...asset, url: URL.createObjectURL(stored.blob) };
      })
      .filter((a): a is NonNullable<typeof a> => a !== null);

    const rehydratedSegments = migrateSegmentHeadings(
      saved.project.segments.map(seg => {
        if (seg.assetId !== undefined && droppedIds.has(seg.assetId)) {
          return { ...seg, assetId: undefined };
        }
        return seg;
      }),
    );

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
    setCurrentTime(0);
    setIsPlaying(false);
    setSelectedSegmentId(null);
  };

  // Keep the ref up to date every render so the mount-only hydration effect
  // (which closes over the ref, not the function directly) always invokes the
  // latest version of handleSwitchProject.
  handleSwitchProjectRef.current = handleSwitchProject;

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
    <div className="min-h-screen bg-[#0A0A0A] text-[#E4E3E0] font-sans selection:bg-[#F27D26] selection:text-white flex overflow-hidden h-screen">

      {/* Body — 3 columns, full height */}
      <div className="flex flex-1 overflow-hidden h-full">

        {/* Left panel — 20vw collapsible */}
        <ErrorBoundary fallback={(err, reset) => (
          <div style={{ width: '20vw' }} className="flex-shrink-0 flex flex-col h-full border-r border-[#1A1A1A] bg-[#080808]">
            <PanelFallback label="Left panel" error={err} reset={reset} />
          </div>
        )}>
        <div
          style={{ width: leftPanelCollapsed ? 0 : '20vw' }}
          className="flex-shrink-0 flex flex-col h-full border-r border-[#1A1A1A] bg-[#080808] overflow-hidden transition-[width] duration-300 ease-in-out"
        >
          <DropZonePanel
            segments={project.segments}
            assets={project.assets}
            voiceoverId={project.voiceoverId}
            script={project.script}
            persistedScript={project.script}
            persistedScriptName={project.scriptFileName ?? ''}
            persistedSceneDetails={project.sceneDetails}
            persistedSceneDetailsName={project.sceneDetailsFileName ?? ''}
            persistedVoiceoverName={project.assets.find(a => a.id === project.voiceoverId)?.name ?? ''}
            persistedAssetCount={project.assets.filter(a => a.type !== 'audio').length}
            onClearScript={() => setProject(p => ({ ...p, script: '', scriptFileName: '' }))}
            onClearSceneDetails={() => setProject(p => ({ ...p, sceneDetails: '', sceneDetailsFileName: '' }))}
            onDeleteAsset={handleDeleteAsset}
            onDeleteAllAssets={handleDeleteAllAssets}
            onDeleteVoiceover={() => { if (project.voiceoverId) handleDeleteAsset(project.voiceoverId); }}
            onApplySync={handleApplySyncFromFiles}
            onVoiceoverStaged={handleVoiceoverStaged}
            onVoiceoverUnstaged={handleVoiceoverUnstaged}
            applySyncDisabled={applySyncDisabled}
            onSegmentClick={(id) => setSelectedSegmentId(id)}
            onToggleLock={handleToggleLock}
            onLockAll={() => setProject(p => ({ ...p, segments: p.segments.map(s => ({ ...s, locked: true })) }))}
            onUnlockAll={handleUnlockAll}
            allLocked={project.segments.length > 0 && project.segments.every(s => s.locked === true)}
            onInsertHeading={handleInsertHeading}
            onDeleteHeading={handleDeleteHeading}
            selectedSegmentId={selectedSegmentId ?? undefined}
            textLayers={project.textLayers ?? []}
            onAddTextLayer={handleAddTextLayer}
            onUpdateTextLayer={handleUpdateTextLayer}
            onDeleteTextLayer={handleDeleteTextLayer}
            onToggleTextLayerOnSegment={handleToggleTextLayerOnSegment}
            globalTransition={project.globalTransition}
            globalTransitionDuration={project.globalTransitionDuration ?? 0.5}
            globalAnimation={project.globalAnimation ?? 'none'}
            globalOverlayFilter={project.globalOverlayFilter ?? 'none'}
            globalOverlayConfig={project.globalOverlayConfig}
            hideAllText={project.hideAllText ?? false}
            exportResolution={exportResolution}
            exportFps={exportFps}
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
            onHideAllTextChange={(v) => setProject(p => ({ ...p, hideAllText: v }))}
            onExportResolutionChange={(v) => setExportResolution(v as ExportResolution)}
            onExportFpsChange={(v) => setExportFps(v as ExportFps)}
            onApplyTransitionPreset={(v) => setProject(p => ({ ...p, globalTransition: v as TransitionType }))}
            onApplyAnimationPreset={(v) => setProject(p => ({ ...p, globalAnimation: v as AnimationType }))}
            onApplyOverlayFilterPreset={(v) => setProject(p => ({ ...p, globalOverlayFilter: v as string }))}
            onApplyOverlayConfigPreset={(v) => setProject(p => ({ ...p, globalOverlayConfig: { ...p.globalOverlayConfig, ...v } }))}
            onBackToProjects={() => { if (project.confirmed) saveNow(); clearLastOpenedProjectId(); setShowDashboard(true); }}
            projectName={project.name}
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
                  hideAllText={project.hideAllText ?? false}
                  assets={project.assets}
                  isPlaying={isPlaying}
                  isResizingRef={isResizingRef}
                  onUpdateExtraOverlayPosition={updateExtraOverlayPosition}
                  textLayers={project.textLayers ?? []}
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
                type="range" min={0.5} max={10} step={0.1}
                value={zoomLevel}
                onChange={e => setZoomLevel(parseFloat(e.target.value))}
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
              const onMove = (ev: MouseEvent) => {
                if (!isDraggingDivider.current) return;
                const delta = ev.clientY - startY;
                const rect = centerColRef.current?.getBoundingClientRect();
                const centerWidth = rect?.width ?? window.innerWidth * 0.65;
                const centerHeight = rect?.height ?? window.innerHeight;
                const maxAllowed = Math.floor(centerWidth * (9 / 16));
                const minTlH = Math.max(MIN_TIMELINE_HEIGHT, Math.floor(centerHeight * 0.30));
                const timelineFloor = centerHeight - minTlH - 4;
                const next = Math.min(
                  Math.max(startHeight + delta, 180),
                  Math.min(maxAllowed, timelineFloor),
                );
                setPreviewHeight(next);
              };
              const onUp = () => {
                isDraggingDivider.current = false;
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
                segments={project.segments}
                assets={project.assets}
                currentSegmentId={currentSegment?.id}
                currentTime={currentTime}
                isPlaying={isPlaying}
                isSynced={isSynced}
                zoomLevel={zoomLevel}
                globalPlaybackSpeed={globalPlaybackSpeed}
                resizingId={resizingId}
                resizingType={resizingType}
                trimmingSegmentId={trimmingSegmentId}
                isAdjustingTrim={isAdjustingTrim}
                voiceoverName={voiceover?.name}
                voiceoverUrl={voiceover?.url}
                onTogglePlay={togglePlay}
                onSeek={(time) => {
                  setCurrentTime(time);
                  if (audioRef.current) audioRef.current.currentTime = time;
                }}
                onZoomChange={setZoomLevel}
                onResizeStart={(id, type) => {
                  setResizingId(id);
                  setResizingType(type);
                  document.body.classList.add('resizing');
                  // Snapshot original segments at drag-start; used for cascade + revert.
                  const originalSegments = projectRef.current.segments;
                  const draggedIdx = originalSegments.findIndex(s => s.id === id);
                  const originalTarget = originalSegments[draggedIdx];
                  if (draggedIdx < 0 || !originalTarget) return;
                  const pps = 100 * zoomLevel;
                  let lastX = 0;
                  let hasMoved = false;
                  // Capture video context at drag-start for speed coupling.
                  const dragAsset = assetsRef.current.find(a => a.id === originalTarget.assetId);
                  const isVideoSeg = dragAsset?.type === 'video';
                  const srcDur = originalTarget.sourceDuration ?? 0;
                  const handleMove = (e: MouseEvent) => {
                    const timeline = document.getElementById('timeline-scroll-area');
                    if (!timeline) return;
                    const rect = timeline.getBoundingClientRect();
                    lastX = e.clientX - rect.left + timeline.scrollLeft - 24;
                    hasMoved = true;
                    // Live preview: update only the dragged segment. Cascade applies on mouseup.
                    setProject(prev => {
                      const updated = prev.segments.map(s => {
                        if (s.id !== id) return s;
                        let liveDuration: number;
                        let liveTrimStart: number = originalTarget.trimStart ?? 0;
                        if (type === 'end') {
                          liveDuration = Math.max(MIN_SEGMENT_DURATION, (lastX / pps) - originalTarget.startTime);
                        } else {
                          const rawDelta = (lastX / pps) - originalTarget.startTime;
                          liveDuration = Math.max(MIN_SEGMENT_DURATION, originalTarget.duration - rawDelta);
                          liveTrimStart = Math.max(0, (originalTarget.trimStart ?? 0) + rawDelta);
                        }
                        // Speed coupling: clamp duration by [0.75×, 4×] bounds for video.
                        if (isVideoSeg && srcDur > 0) {
                          const liveClipLen = (originalTarget.trimEnd ?? srcDur) - liveTrimStart;
                          if (liveClipLen > 0) {
                            const maxDur = liveClipLen / MIN_PLAYBACK_SPEED;
                            const minDur = Math.max(MIN_SEGMENT_DURATION, liveClipLen / MAX_PLAYBACK_SPEED);
                            liveDuration = Math.max(minDur, Math.min(maxDur, liveDuration));
                            const liveSpeed = liveClipLen / liveDuration;
                            return { ...s, duration: liveDuration, trimStart: liveTrimStart, playbackSpeed: liveSpeed };
                          }
                        }
                        return { ...s, duration: liveDuration, trimStart: liveTrimStart };
                      });
                      let acc = 0;
                      return { ...prev, segments: updated.map(s => { const start = acc; acc += s.duration; return { ...s, startTime: Number(start.toFixed(3)) }; }) };
                    });
                  };
                  const handleUp = () => {
                    setResizingId(null);
                    setResizingType(null);
                    document.body.classList.remove('resizing');
                    window.removeEventListener('mousemove', handleMove);
                    window.removeEventListener('mouseup', handleUp);
                    requestAnimationFrame(() => { isResizingRef.current = false; });
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
                onDeleteHeading={handleDeleteHeading}
              />
            </ErrorBoundary>
          </div>

          {/* Backdrop — click outside drawer to dismiss */}
          {selectedSegment && (
            <div
              className="absolute inset-0 z-40"
              onClick={() => setSelectedSegmentId(null)}
            />
          )}

          <BottomDrawer
            segment={selectedSegment}
            segmentIndex={selectedSegmentIndex}
            assets={project.assets}
            globalOverlayConfig={project.globalOverlayConfig}
            onClose={() => setSelectedSegmentId(null)}
            onUpdateSegment={updateSegment}
            onUpdateSegmentOverlay={updateSegmentOverlay}
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
        </div>

      </div>

      {/* Legacy left panel content — hidden in new UX, preserved for rollback */}
      {false && (
      <div className="w-[450px] border-right border-[#1A1A1A] flex flex-col bg-[#050505]">
        <div className="p-8 h-full flex flex-col">
          <div className="flex-1 overflow-y-auto custom-scrollbar pr-4">
            {activeTab === 'editor' && (
              <SegmentEditorPanel
                script={project.script}
                segments={project.segments}
                assets={project.assets}
                globalOverlayConfig={project.globalOverlayConfig}
                onAddSegment={(seg) => setProject(prev => ({ ...prev, segments: [...prev.segments, seg] }))}
                onDeleteSegment={(id) => setProject(p => ({ ...p, segments: p.segments.filter(seg => seg.id !== id) }))}
                onEditSegment={setEditingSegment}
                onOpenStockSearch={(segId) => { setStockTarget(segId); setShowStockSearch(true); }}
                onUpdateSegment={updateSegment}
                onUpdateSegmentOverlay={updateSegmentOverlay}
                onUpdateExtraOverlay={updateExtraOverlay}
                onSegmentDurationChange={(idx, val) => setProject(prev => {
                  const updated = prev.segments.map((seg, i) => i === idx ? { ...seg, duration: val } : seg);
                  let acc = 0;
                  return { ...prev, segments: updated.map(seg => { const start = acc; acc += seg.duration; return { ...seg, startTime: Number(start.toFixed(3)) }; }) };
                })}
                onToggleOverlay={(idx) => setProject(prev => ({
                  ...prev,
                  segments: prev.segments.map((seg, i) =>
                    i === idx ? { ...seg, showOverlay: !seg.showOverlay, overlayConfig: seg.overlayConfig ?? { ...prev.globalOverlayConfig } } : seg
                  ),
                }))}
                onSetOverlayPreset={(idx, preset) => setProject(prev => ({
                  ...prev,
                  segments: prev.segments.map((seg, i) => {
                    if (i !== idx) return seg;
                    const base = { ...prev.globalOverlayConfig };
                    if (preset === 'cyber') return { ...seg, showOverlay: true, overlayConfig: { ...base, color: '#00FF00', backgroundColor: '#000000', fontFamily: 'Bangers', fontSize: 80, textShadow: '0 0 20px #00FF00', animation: 'glitch' } };
                    if (preset === 'retro') return { ...seg, showOverlay: true, overlayConfig: { ...base, color: '#FF00FF', backgroundColor: 'white', fontFamily: 'Monoton', fontSize: 70, textShadow: '0 0 10px #FF00FF', animation: 'neon-flicker' } };
                    return { ...seg, showOverlay: true, overlayConfig: { ...base, color: 'black', backgroundColor: '#F27D26', fontFamily: 'Anton', fontSize: 90, fontWeight: 900, animation: 'slide-up' } };
                  }),
                }))}
                onAddExtraOverlay={(idx) => setProject(prev => ({
                  ...prev,
                  segments: prev.segments.map((seg, i) =>
                    i === idx ? { ...seg, extraOverlays: [...(seg.extraOverlays ?? []), { id: crypto.randomUUID(), text: 'New Text', color: '#FFFFFF', backgroundColor: '#000000', fontFamily: 'Inter', fontSize: 24, position: { x: 50, y: 50 } }] } : seg
                  ),
                }))}
              />
            )}
            {activeTab === 'settings' && (
              <SettingsPanel
                project={project}
                onProjectChange={(updates) => setProject(p => ({ ...p, ...updates }))}
                onApplyTransitionToAll={() => setProject(p => ({ ...p, segments: p.segments.map(s => ({ ...s, transition: p.globalTransition })) }))}
                onApplyAnimationToAll={() => setProject(p => ({ ...p, segments: p.segments.map(s => ({ ...s, animation: p.globalAnimation })) }))}
                onApplyFilterToAll={() => setProject(p => ({ ...p, segments: p.segments.map(s => ({ ...s, overlayFilter: p.globalOverlayFilter })) }))}
                onNewProject={handleNewProject}
                onOpenDashboard={() => { clearLastOpenedProjectId(); setShowDashboard(true); }}
                onExportScenesJson={() => {
                  const blob = new Blob([JSON.stringify(project.segments, null, 2)], { type: 'application/json' });
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement('a');
                  a.href = url;
                  a.download = `${project.name.replace(/\s+/g, '_')}_scenes.json`;
                  a.click();
                }}
                onImportScenesJson={(e) => handleFileUpload(e, 'story')}
                exportResolution={exportResolution}
                onExportResolutionChange={setExportResolution}
                exportFps={exportFps}
                onExportFpsChange={setExportFps}
                onApplyTransitionPreset={(value) => setProject(p => ({ ...p, globalTransition: value as TransitionType }))}
                onApplyAnimationPreset={(value) => setProject(p => ({ ...p, globalAnimation: value as AnimationType }))}
                onApplyOverlayFilterPreset={(value) => setProject(p => ({ ...p, globalOverlayFilter: value }))}
                onApplyOverlayConfigPreset={(value) => setProject(p => ({ ...p, globalOverlayConfig: { ...p.globalOverlayConfig, ...value } }))}
                currentTransition={project.globalTransition}
                currentAnimation={project.globalAnimation}
                currentOverlayFilter={project.globalOverlayFilter ?? ''}
                currentOverlayConfig={project.globalOverlayConfig}
              />
            )}
          </div>
        </div>
      </div>
      )}

      {/* Settings modal — tombstoned (controls moved to Effects tab) */}
      {false && showSettings && (
        <div onClick={() => setShowSettings(false)} />
      )}

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
          onCancel={() => setShowNewProjectModal(false)}
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
              const newAsset: Asset = {
                id,
                name: stock.name,
                url: URL.createObjectURL(blob),
                type: stock.type,
              };
              setProject(p => {
                const newAssets = [...p.assets, newAsset];
                const afterTarget = p.segments.map(s =>
                  s.id === targetId
                    ? { ...s, assetId: newAsset.id, playbackSpeed: 1, trimStart: 0, isMuted: true }
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

      {/* Sync Review Modals */}
      {showSyncDetails && (
        <Suspense fallback={<ModalLoadingFallback />}>
        <AnimatePresence>
          <SyncReviewModal
            sceneDetails={project.sceneDetails}
            segments={project.segments}
            assets={project.assets}
            voiceoverName={voiceover?.name ?? 'Local Audio'}
            onClose={() => setShowSyncDetails(false)}
            onFinalizeSync={finalizeSync}
            onApplyAdjustments={() => setIsSynced(true)}
            onOpenStockSearch={(targetId) => {
              setStockTarget(targetId);
              setShowStockSearch(true);
            }}
            onAssetChange={(segIdx, assetId) => {
              setProject(prev => ({
                ...prev,
                segments: prev.segments.map((s, j) => j === segIdx ? { ...s, assetId: assetId } : s),
              }));
            }}
          />
        </AnimatePresence>
        </Suspense>
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
                          <h2 className="text-3xl font-black uppercase tracking-tighter text-white mb-2">{editingSegment.headingConfig?.text || editingSegment.heading || "Untitled Scene"}</h2>
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
                         <label className="text-[10px] font-black uppercase tracking-[0.2em] text-gray-500">Heading & Script</label>
                         <input 
                            value={editingSegment.headingConfig?.text || editingSegment.heading || ''}
                            onChange={(e) => setEditingSegment({
                              ...editingSegment,
                              heading: e.target.value,
                              headingConfig: editingSegment.headingConfig
                                ? { ...editingSegment.headingConfig, text: e.target.value }
                                : undefined,
                            })}
                            placeholder="Heading Text"
                            className="w-full bg-white/5 border border-white/5 p-4 rounded-2xl outline-none focus:border-[#F27D26]/50 text-sm font-bold uppercase tracking-widest"
                         />
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
