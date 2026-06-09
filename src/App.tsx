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
} from 'lucide-react';
import { motion, AnimatePresence, type Transition } from 'motion/react';
import {
  Project,
  VideoSegment,
  Asset,
  TransitionType,
  AnimationType,
  TextOverlay,
} from './types';
import { StockResult } from './services/stockService';
import { isFuzzyMatch, findAssetByContext, autoMatchSegments } from './services/syncEngine';
import { stripRtfIfNeeded } from './services/textUtils';
import { putAsset, deleteAsset, getAllAssets, clearAllAssets } from './services/assetStore';
import { loadProject, clearProject } from './services/projectStore';
import { usePersistProject } from './hooks/usePersistProject';
import { useFocusTrap } from './hooks/useFocusTrap';
import { FONT_FAMILIES, FILTERS, TEXT_ANIMATIONS, getFilterStyle, getMotionProps, HEADING_ONLY_DURATION_SECONDS } from './constants';
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
import { ErrorBoundary, PanelFallback } from './components/ErrorBoundary';
import { useExport, type ExportResolution, type ExportFps, type ExportError } from './hooks/useExport';
import { useWhisper } from './hooks/useWhisper';
import { TranscriptionBar } from './components/TranscriptionBar';
import { isTauri } from './services/tauriFfmpeg';
import { invoke } from '@tauri-apps/api/core';

interface RawSegment {
  text: string;
  heading?: string;
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
async function persistFileToAsset(file: File, type: Asset['type']): Promise<Asset | null> {
  const id = crypto.randomUUID();
  const url = URL.createObjectURL(file);
  try {
    await putAsset(id, file, { name: file.name, mimeType: file.type });
  } catch (err) {
    console.error('[persistFileToAsset] IndexedDB write failed, skipping:', file.name, err);
    URL.revokeObjectURL(url);
    return null;
  }
  return { id, name: file.name, url, type, file };
}

/**
 * Extracts all media files from a zip archive, persists them to IndexedDB,
 * and returns the resulting Asset array. Does NOT call setProject.
 */
async function extractZipToAssets(zipFile: File): Promise<Asset[]> {
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
        await putAsset(id, blob, { name, mimeType: blob.type || 'application/octet-stream' });
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

// Fuzzy matching helper

// Enhanced parser that handles heading-voiceover logic
const parseProjectData = async (
  script: string,
  sceneDetails: string,
  assets: Asset[],
  voiceoverDuration: number = 0,
): Promise<VideoSegment[]> => {
  const rawDetails = sceneDetails.split(/\r?\n\r?\n/).filter(block => block.trim() !== '');
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
    const backupBlocks = sceneDetails.split(/\r?\n\r?\n/).map(l => l.trim()).filter(l => l !== '');
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
      isMuted: true,
      extraOverlays: [],
    };

    let name = '';
    const detail = scene.tag;

    const specificMatch = detail.match(/\[(?:IMAGE|VIDEO|HEADING):\s*(.*?)\s*\]/i);
    if (specificMatch) {
      if (detail.toUpperCase().includes('HEADING')) {
        current.heading = specificMatch[1] ?? '';
      } else {
        name = specificMatch[1] ?? '';
      }
    } else {
      const simpleMatch = detail.match(/\[(.*?)\]/);
      if (simpleMatch) name = simpleMatch[1] ?? '';
      else name = detail;
    }

    if (name) {
      const matchingAssets = assets.filter(a => isFuzzyMatch(name, a.name));
      const unusedAsset = matchingAssets.find(a => !usedAssetIdsTotal.has(a.id));
      const asset = unusedAsset ?? matchingAssets[0];
      if (asset) {
        current.assetId = asset.id;
        usedAssetIdsTotal.add(asset.id);
      }
    }

    if (!current.assetId && text) {
      const availableAssets = assets.filter(a => !usedAssetIdsTotal.has(a.id) && a.type !== 'audio');
      const contextualAsset = findAssetByContext(text, availableAssets.length > 0 ? availableAssets : assets);
      if (contextualAsset) {
        current.assetId = contextualAsset.id;
        usedAssetIdsTotal.add(contextualAsset.id);
      }
    }

    rawSegments.push(current);
  }

  const headingOnlyScenes = rawSegments.filter(s => s.heading && !s.text);
  const textBearingScenes = rawSegments.filter(s => s.text);
  const voDuration = voiceoverDuration > 0 ? voiceoverDuration : rawSegments.length * 5;

  // Allocate fixed time to heading-only scenes, then split the remainder by char-count weight.
  let headingDuration = HEADING_ONLY_DURATION_SECONDS;
  let headingTotal = headingOnlyScenes.length * HEADING_ONLY_DURATION_SECONDS;
  if (headingOnlyScenes.length > 0 && voDuration - headingTotal <= 0) {
    headingTotal = voDuration * 0.5;
    headingDuration = headingTotal / headingOnlyScenes.length;
    console.warn(
      `[kinetix] Heading-only scenes (${headingOnlyScenes.length} × ${HEADING_ONLY_DURATION_SECONDS}s = ` +
      `${(headingOnlyScenes.length * HEADING_ONLY_DURATION_SECONDS).toFixed(2)}s) exceed voiceover duration ` +
      `(${voDuration.toFixed(2)}s). Clamping each heading to ${headingDuration.toFixed(3)}s so headings ` +
      `stay within 50% of total duration.`
    );
  }
  const textBudget = Math.max(0.1, voDuration - headingTotal);
  const totalTextLength = textBearingScenes.reduce((acc, s) => acc + s.text.length, 0) || 1;

  let currentTimeAccumulator = 0;
  const finalSegments: VideoSegment[] = [];

  for (const [i, s] of rawSegments.entries()) {
    let targetDuration: number;

    if (s.heading && !s.text) {
      // Heading-only scene: fixed display time, independent of voiceover word count.
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
        .map(s => s.heading || s.id)
        .join(', ');
      console.warn(
        `[parseProjectData] Asset "${assetId}" is assigned to ${count} segments: ` +
        `${duplicatedSegments}. Re-upload the missing asset and re-sync to fix.`
      );
    }
  });

  return finalSegments;
};


const DEFAULT_PROJECT: Project = {
  id: '1',
  name: 'KINETIX STUDIO',
  script: 'Welcome to Kinetix Studio. This tool automatically syncs your voiceover with your visuals. Headings pause the voiceover during transitions. Text segments stretch to fit your audio duration perfectly.',
  sceneDetails: '[HEADING: Welcome to Kinetix]\n[IMAGE: intro.jpg]\n[HEADING: Advanced Logic]\n[IMAGE: tech.jpg]',
  segments: [],
  assets: [],
  globalTransition: TransitionType.NONE,
  globalTransitionDuration: 0.5,
  globalAnimation: AnimationType.NONE,
  hideAllText: true,
  globalOverlayConfig: {
    color: '#FFFFFF',
    backgroundColor: '#000000',
    fontFamily: 'Inter',
  },
};

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

export default function App() {
  const [project, setProject] = useState<Project>(DEFAULT_PROJECT);

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
  const [showSettings, setShowSettings] = useState(false);
  const [resizingId, setResizingId] = useState<string | null>(null);
  const [resizingType, setResizingType] = useState<'start' | 'end' | null>(null);
  const [trimmingSegmentId, setTrimmingSegmentId] = useState<string | null>(null);
  const [showStockSearch, setShowStockSearch] = useState(false);
  const [stockTarget, setStockTarget] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement>(null);

  // Ref that mirrors project.segments for stable interval closure access.
  // The playback setInterval reads this instead of closing over the state value
  // directly, so that segment edits (overlay changes, drag-resize, etc.) no longer
  // destroy and rebuild the interval on every setProject call. (Finding 13 / Batch A)
  const segmentsRef = useRef<VideoSegment[]>(project.segments);
  // Ref that mirrors project.assets so useCallback([]) closures can read the
  // latest asset list without project.assets appearing in their dep arrays.
  const assetsRef = useRef<Asset[]>(project.assets);
  // Ref that mirrors the full project so async handlers (handleApplySyncFromFiles,
  // finalizeSync) can read the live state after awaits without stale closures.
  const projectRef = useRef<Project>(project);
  // Tracks the active requestAnimationFrame handle for the voiceover playback loop.
  const rafRef = useRef<number | null>(null);
  // Synchronous guard: true while a timeline resize drag is in progress.
  // Cleared via a one-frame rAF delay in handleUp so it stays true through
  // the render that processes the final mousemove setProject call.
  const isResizingRef = useRef(false);



  // Rehydrate persisted project on mount
  useEffect(() => {
    (async () => {
      const saved = loadProject();
      if (!saved) {
        setIsHydrating(false);
        return;
      }

      const storedAssets = await getAllAssets();
      const blobMap = new Map(storedAssets.map(a => [a.id, a]));

      const droppedIds = new Set<string>();
      const rehydratedAssets = saved.project.assets
        .map(asset => {
          const stored = blobMap.get(asset.id);
          if (!stored) {
            console.warn(`[kinetix] Dropping orphaned asset on load — id: ${asset.id}, name: ${asset.name}`);
            droppedIds.add(asset.id);
            return null;
          }
          return { ...asset, url: URL.createObjectURL(stored.blob) };
        })
        .filter((a): a is NonNullable<typeof a> => a !== null);

      const rehydratedSegments = saved.project.segments.map(seg => {
        if (seg.assetId !== undefined && droppedIds.has(seg.assetId)) {
          console.warn(`[kinetix] Clearing assetId on segment "${seg.id}" — referenced asset was dropped`);
          return { ...seg, assetId: undefined };
        }
        return seg;
      });

      let rehydratedVoiceoverId = saved.project.voiceoverId;
      if (rehydratedVoiceoverId !== undefined && droppedIds.has(rehydratedVoiceoverId)) {
        console.warn(`[kinetix] Clearing voiceoverId — referenced asset was dropped`);
        rehydratedVoiceoverId = undefined;
      }

      setProject({
        ...saved.project,
        assets: rehydratedAssets,
        segments: rehydratedSegments,
        voiceoverId: rehydratedVoiceoverId,
      });
      // Restore sync state — if saved segments exist the user had already synced.
      if (rehydratedSegments.length > 0) setIsSynced(true);
      setIsHydrating(false);
    })();
  }, []);

  usePersistProject(project, !isHydrating);

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
    const audioDuration = audioRef.current?.duration || 0;
    const newSegments = await parseProjectData(
      projectRef.current.script,
      projectRef.current.sceneDetails,
      projectRef.current.assets,
      audioDuration,
    );

    // Locked segments (matched by order index) preserve their duration from the
    // previous sync so manual timing adjustments survive a re-sync.
    const prevByOrder = new Map(projectRef.current.segments.map(s => [s.order, s]));

    let acc = 0;
    const syncedSegments = newSegments.map(s => {
      const prev = prevByOrder.get(s.order);
      const duration = prev?.locked ? prev.duration : s.duration;
      const start = acc;
      acc += duration;
      return { ...s, duration, locked: prev?.locked, startTime: Number(start.toFixed(3)) };
    });

    // Never wipe existing segments if parse produced nothing
    if (syncedSegments.length === 0 && projectRef.current.segments.length > 0) {
      console.warn('[sync] parseProjectData returned 0 segments — keeping existing segments');
      setIsProcessing(false);
      return;
    }

    setProject(prev => ({ ...prev, segments: syncedSegments }));
    setIsSynced(true);
    setIsProcessing(false);
    setSyncStep(4);
    setActiveTab('editor');

    // Trigger transcription (Tauri only) — Option A caching applies
    const voiceoverAsset = projectRef.current.assets.find(a => a.id === projectRef.current.voiceoverId);
    if (voiceoverAsset && isTauri()) {
      startTranscription(
        voiceoverAsset,
        audioDuration,
        syncedSegments,
        projectRef.current,
        (updated) => { setProject(prev => ({ ...prev, segments: updated })); },
        (updater) => setProject(updater),
      );
    }
  };

  /** '1080p' | '4k' */
  const [exportResolution, setExportResolution] = useState<ExportResolution>('1080p');
  /** frames per second */
  const [exportFps, setExportFps] = useState<ExportFps>(30);
  const previewRef = useRef<HTMLDivElement>(null);

  const exportApi = useExport(project, exportResolution, exportFps);
  const { state: exportState, startExport, cancelExport, retryExport, dismissSuccess } = exportApi;

  const { transcriptionStatus, startTranscription, cancelTranscription, dismissError } = useWhisper();

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
        const asset = await persistFileToAsset(staged.voiceoverFile.file, 'audio');
        if (asset) {
          allAssets.push(asset);
          newVoiceoverId = asset.id;
        }
      }
    }
    for (const sf of staged.assetFiles) {
      if (allAssets.some(a => a.name === sf.file.name)) continue;
      const ext = sf.file.name.split('.').pop()?.toLowerCase() ?? '';
      const type: Asset['type'] = ['mp4', 'mov', 'webm', 'm4v'].includes(ext) ? 'video' : 'image';
      const asset = await persistFileToAsset(sf.file, type);
      if (asset) allAssets.push(asset);
    }
    for (const sf of staged.zipFiles) {
      const extracted = await extractZipToAssets(sf.file);
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

    // 6. Preserve locked durations by order index
    const prevByOrder = new Map(projectRef.current.segments.map(s => [s.order, s]));
    let acc = 0;
    const syncedSegments = newSegments.map(s => {
      const prev = prevByOrder.get(s.order);
      const duration = prev?.locked ? prev.duration : s.duration;
      const start = acc;
      acc += duration;
      return { ...s, duration, locked: prev?.locked, startTime: Number(start.toFixed(3)) };
    });

    // Never wipe existing segments if parse produced nothing
    if (syncedSegments.length === 0 && projectRef.current.segments.length > 0) {
      console.warn('[sync] parseProjectData returned 0 segments — keeping existing segments');
      setIsProcessing(false);
      return;
    }

    // 7. Single atomic state update
    setProject(prev => ({
      ...prev,
      script: scriptText,
      sceneDetails: sceneText,
      scriptFileName: staged.scriptFile?.file.name ?? prev.scriptFileName ?? '',
      sceneDetailsFileName: staged.sceneFile?.file.name ?? prev.sceneDetailsFileName ?? '',
      assets: allAssets,
      voiceoverId: newVoiceoverId,
      segments: autoMatchSegments(allAssets, syncedSegments),
    }));

    setIsSynced(true);
    setIsProcessing(false);
    setSyncStep(4);
    setActiveTab('editor');

    // 8. Trigger transcription on voiceover (Tauri only)
    if (voiceoverAsset && isTauri()) {
      startTranscription(
        voiceoverAsset,
        audioDuration,
        syncedSegments,
        projectRef.current,
        (updated) => { setProject(prev => ({ ...prev, segments: updated })); },
        (updater) => setProject(updater),
      );
    }
  };

  // Shared delete handler — used by DropZonePanel post-sync assets list
  const handleDeleteAsset = useCallback((assetId: string) => {
    setProject(prev => {
      const asset = prev.assets.find(a => a.id === assetId);
      if (!asset) return prev;
      URL.revokeObjectURL(asset.url);
      deleteAsset(assetId).catch(err =>
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
    Promise.all(nonAudio.map(a => deleteAsset(a.id))).catch(err =>
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
      await putAsset(id, file, { name: file.name, mimeType: file.type });
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
        deleteAsset(oldAudio.id).catch(err =>
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
          await putAsset(id, blob, { name, mimeType: blob.type || 'application/octet-stream' });
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

  // Sync volatile values into refs on every render so the playback interval can
  // read them without those values appearing in the interval's dependency array.
  // Intentionally no dependency array — must run after every render to stay fresh.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    segmentsRef.current = project.segments;
    assetsRef.current = project.assets;
    projectRef.current = project;
  });

  const voiceover = project.assets.find(a => a.id === project.voiceoverId);


  // --- Playback: audio pause on user stop ---
  // Fires whenever isPlaying flips to false; no-ops when audioRef is null (no voiceover loaded).
  // Kept in a separate effect so the rAF loop dep array stays minimal.
  useEffect(() => {
    if (!isPlaying && !exportState.isExporting) {
      audioRef.current?.pause();
    }
  }, [isPlaying, exportState.isExporting]);

  // --- Export success toast: auto-dismiss after 10 s ---
  useEffect(() => {
    if (!exportState.showExportSuccess) return;
    const t = setTimeout(() => dismissSuccess(), 10000);
    return () => clearTimeout(t);
  }, [exportState.showExportSuccess, dismissSuccess]);

  // --- Playback: rAF loop — voiceover path (audio element is master clock) ---
  // Reads audioRef.current.currentTime on every animation frame (~16ms at 60fps).
  // Replaces the 100ms setInterval, eliminating quantization drift (audit findings 9, 10).
  // All values inside tick are read via stable refs or setters — no stale closure risk.
  // segmentsRef not needed here: end-of-audio uses native audio.ended, not segmentsDuration.
  useEffect(() => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }

    if (!isPlaying || !voiceover) return;

    const tick = () => {
      const audio = audioRef.current;
      if (!audio) return;

      const t = audio.currentTime;
      setCurrentTime(t);

      // Defensive resume: if audio stalled mid-playback for any reason, restart it.
      // Guard with !audio.ended so a naturally-finished audio is not restarted here.
      if (audio.paused && !audio.ended) {
        audio.play().catch(() => {});
      }

      // End-of-audio detection via native HTMLMediaElement.ended flag.
      if (audio.ended) {
        setIsPlaying(false);
        audio.currentTime = 0;
        setCurrentTime(0);
        return; // do not schedule next frame
      }

      rafRef.current = requestAnimationFrame(tick);
    };

    rafRef.current = requestAnimationFrame(tick);

    return () => {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
  }, [isPlaying, voiceover]);

  // --- Playback: setInterval manual-advance — no-voiceover path ---
  // Only runs when isPlaying is true and no voiceover asset is loaded.
  // No audio drift concern here; keeps globalPlaybackSpeed and segmentsDuration as before.
  // (Decision 1 / Batch C: keep no-voiceover path as a separate setInterval, unchanged.)
  useEffect(() => {
    if (!isPlaying || voiceover) return;

    const interval = setInterval(() => {
      const segDur = segmentsRef.current.reduce((acc, s) => acc + s.duration, 0);
      const maxDuration = (!segDur || isNaN(segDur) || !isFinite(segDur)) ? 10 : segDur;
      setCurrentTime(prev => {
        const next = prev + 0.1 * globalPlaybackSpeed;
        if (next >= maxDuration) {
          setIsPlaying(false);
          return 0;
        }
        return next;
      });
    }, 100);

    return () => clearInterval(interval);
  }, [isPlaying, voiceover, globalPlaybackSpeed]);

  // --- Playback: playbackRate sync ---
  // Separate effect so neither loop gains globalPlaybackSpeed as a dep.
  // Fires on play-start and whenever the user adjusts speed mid-playback.
  useEffect(() => {
    if (audioRef.current) {
      audioRef.current.playbackRate = globalPlaybackSpeed;
    }
  }, [isPlaying, globalPlaybackSpeed]);

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

  // (Canvas mirror removed — export now uses ffmpeg.wasm frame renderer, not MediaRecorder)

  const handleNewProject = async () => {
    const confirmed = window.confirm(
      'Discard this project? This will permanently delete your script, segments, and all uploaded assets from this browser. This cannot be undone.'
    );
    if (!confirmed) return;

    project.assets.forEach(a => { if (a.url) URL.revokeObjectURL(a.url); });
    clearProject();
    try {
      await clearAllAssets();
    } catch (err) {
      console.error('Failed to clear IndexedDB assets:', err);
    }
    setProject(DEFAULT_PROJECT);
  };

  if (isHydrating) {
    return (
      <div className="min-h-screen bg-[#0A0A0A] flex items-center justify-center">
        <span className="text-[#E4E3E0] text-sm font-mono tracking-widest uppercase">Loading…</span>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0A0A0A] text-[#E4E3E0] font-sans selection:bg-[#F27D26] selection:text-white flex overflow-hidden">
      {/* Sidebar Navigation — hidden in new UX, preserved for rollback */}
      {false && (
      <nav className="w-16 border-right border-[#1A1A1A] flex flex-col items-center py-6 gap-8 bg-[#050505]">
        <div className="bg-[#F27D26] p-2 rounded-lg mb-4 shadow-[0_0_20px_rgba(242,125,38,0.3)]">
          <Video size={24} className="text-white" />
        </div>
        {[
          { id: 'script', icon: FileText, label: 'Script' },
          { id: 'assets', icon: Layers, label: 'Library' },
          { id: 'editor', icon: Layout, label: 'Scene Editor' },
          { id: 'settings', icon: Settings, label: 'Config' }
        ].map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id as any)}
            aria-label={tab.label}
            aria-current={activeTab === tab.id ? 'page' : undefined}
            className={`p-3 rounded-xl transition-all duration-300 relative group ${activeTab === tab.id ? 'bg-[#1A1A1A] text-[#F27D26]' : 'text-gray-600 hover:text-white'}`}
          >
            <tab.icon size={20} />
            <span className="absolute left-full ml-4 px-2 py-1 bg-black text-[10px] uppercase tracking-widest rounded opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap z-50">{tab.label}</span>
          </button>
        ))}
      </nav>
      )}

      {/* Workspace */}
      <main className="flex-1 flex flex-col h-screen overflow-hidden">
        <TranscriptionBar
          status={transcriptionStatus}
          onCancel={cancelTranscription}
          onDismiss={dismissError}
        />
        {/* Header */}
        <header className="h-16 border-bottom border-[#1A1A1A] px-8 flex items-center justify-between bg-[#0A0A0A]">
          <div className="flex items-center gap-6">
            {isAdjustingTrim && (
              <button 
                onClick={() => {
                  setIsAdjustingTrim(false);
                  setTrimmingSegmentId(null);
                }}
                className="bg-green-500 text-white px-4 py-1.5 rounded-full text-[10px] font-black uppercase tracking-widest hover:bg-green-400 transition-all flex items-center gap-2 animate-pulse"
              >
                <Check size={14} /> Done Adjusting
              </button>
            )}
            <h1 className="text-sm font-bold tracking-[0.2em] uppercase text-white/90">Kinetix <span className="text-[#F27D26]">Pro</span> Studio</h1>
            <div className="h-4 w-px bg-[#1A1A1A]" />
            <div className="flex items-center gap-2">
              <div className={`w-2 h-2 rounded-full animate-pulse ${isSynced ? 'bg-green-500' : 'bg-[#F27D26]'}`} />
              <span className="text-[10px] uppercase tracking-widest text-gray-500 font-bold">
                {isSynced ? 'Timeline Master Ready' : 'Auto-Sync Active'}
              </span>
            </div>
          </div>
          {/* Status indicator — replaces SyncWizard in new UX */}
          <div className="flex items-center gap-3">
            <div className={`w-2 h-2 rounded-full ${isSynced ? 'bg-green-500' : 'bg-[#F27D26] animate-pulse'}`} />
            <span className="text-[10px] uppercase tracking-widest text-gray-500">
              {isSynced ? 'Timeline Ready' : 'Drop files to begin'}
            </span>
            <button
              onClick={startExport}
              className="ml-4 bg-white text-black px-6 py-2 rounded-full text-[10px] font-black uppercase tracking-widest hover:bg-[#F27D26] hover:text-white transition-all transform hover:scale-105 active:scale-95 shadow-xl"
            >
              Export
            </button>
          </div>
          {/* SyncWizard — hidden in new UX, preserved for rollback */}
          {false && (
          <SyncWizard
            syncStep={syncStep}
            syncValidation={syncValidation}
            isProcessing={isProcessing}
            sceneCount={project.sceneDetails.split(/\r?\n\r?\n/).filter(l => l.trim()).length}
            audioDuration={audioRef.current?.duration ?? 0}
            onRunStep1={runSyncStep1}
            onRunStep2={runSyncStep2}
            onRunStep3={runSyncStep3}
            onFinalizeSync={finalizeSync}
            onExport={startExport}
            onReviewMapping={() => setShowSyncDetails(true)}
          />
          )}
        </header>

        <div className="flex-1 flex overflow-hidden">
          {/* Left Panel — new unified DropZonePanel */}
          <ErrorBoundary fallback={(err, reset) => (
            <div className="w-[380px] flex-shrink-0 flex flex-col h-full border-r border-[#0F0F0F] bg-[#080808]">
              <PanelFallback label="Left panel" error={err} reset={reset} />
            </div>
          )}>
          <div className="w-[380px] flex-shrink-0 flex flex-col h-full border-r border-[#0F0F0F] bg-[#080808]">
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
              onScriptChange={(val) => setProject(p => ({ ...p, script: val }))}
              onSceneDetailsChange={(val) => setProject(p => ({ ...p, sceneDetails: val }))}
              onClearScript={() => setProject(p => ({ ...p, script: '', scriptFileName: '' }))}
              onClearSceneDetails={() => setProject(p => ({ ...p, sceneDetails: '', sceneDetailsFileName: '' }))}
              onDeleteAsset={handleDeleteAsset}
              onDeleteAllAssets={handleDeleteAllAssets}
              onDeleteVoiceover={() => { if (project.voiceoverId) handleDeleteAsset(project.voiceoverId); }}
              onApplySync={handleApplySyncFromFiles}
              onSegmentClick={(id) => setSelectedSegmentId(id)}
              onToggleLock={handleToggleLock}
              onLockAll={() => setProject(p => ({
                ...p,
                segments: p.segments.map(s => ({ ...s, locked: true })),
              }))}
              onUnlockAll={handleUnlockAll}
              allLocked={project.segments.length > 0 && project.segments.every(s => s.locked === true)}
              selectedSegmentId={selectedSegmentId ?? undefined}
              onOpenSettings={() => setShowSettings(true)}
            />
          </div>
          </ErrorBoundary>

          {/* Legacy left panel content — hidden in new UX, preserved for rollback */}
          {false && (
          <div className="w-[450px] border-right border-[#1A1A1A] flex flex-col bg-[#050505]">
            <div className="p-8 h-full flex flex-col">
              <div className="flex-1 overflow-y-auto custom-scrollbar pr-4">
                {activeTab === 'script' && (
                  <div className="space-y-6 flex flex-col h-full">
                    <div className="flex-1 flex flex-col space-y-4">
                      <div className="flex items-center justify-between">
                        <h2 className="text-[11px] font-black uppercase tracking-[0.3em] text-[#F27D26]">Voiceover Script</h2>
                        <label className="cursor-pointer text-[9px] font-black uppercase tracking-widest text-[#F27D26] hover:text-white transition-all flex items-center gap-2">
                           <Upload size={12} /> Import TXT
                           <input type="file" accept=".txt" className="hidden" onChange={(e) => handleFileUpload(e, 'script')} />
                        </label>
                      </div>
                      <textarea 
                        value={project.script}
                        onChange={(e) => setProject(prev => ({ ...prev, script: e.target.value }))}
                        className="w-full flex-1 bg-[#0A0A0A] border border-[#1A1A1A] rounded-2xl p-6 text-sm leading-relaxed outline-none focus:border-[#F27D26]/50 transition-all resize-none font-mono text-gray-300 shadow-inner"
                        placeholder="Enter your script here..."
                      />
                    </div>
                    
                    <div className="flex-1 flex flex-col space-y-4">
                      <div className="flex items-center justify-between">
                        <h2 className="text-[11px] font-black uppercase tracking-[0.3em] text-blue-500">Scene Details</h2>
                        <label className="cursor-pointer text-[9px] font-black uppercase tracking-widest text-blue-500 hover:text-white transition-all flex items-center gap-2">
                           <Upload size={12} /> Import TXT
                           <input type="file" accept=".txt" className="hidden" onChange={(e) => handleFileUpload(e, 'details')} />
                        </label>
                      </div>
                      <textarea 
                        value={project.sceneDetails}
                        onChange={(e) => setProject(prev => ({ ...prev, sceneDetails: e.target.value }))}
                        className="w-full flex-1 bg-[#0A0A0A] border border-[#1A1A1A] rounded-2xl p-6 text-sm leading-relaxed outline-none focus:border-blue-500/50 transition-all resize-none font-mono text-gray-300 shadow-inner"
                        placeholder="Enter scene details like [IMAGE: scene1.jpg]..."
                      />
                    </div>
                  </div>
                )}

                {activeTab === 'assets' && (
                  <div className="space-y-8">
                    <div className="space-y-4">
                      <h3 className="text-[11px] font-black uppercase tracking-[0.3em] text-[#F27D26]">Bulk Asset Import</h3>
                      <div className="grid grid-cols-2 gap-4">
                        <label className="flex flex-col items-center justify-center border-2 border-dashed border-[#1A1A1A] rounded-2xl p-6 cursor-pointer hover:border-[#F27D26] hover:bg-[#F27D26]/5 transition-all group">
                          <Archive size={24} className="text-gray-600 group-hover:text-[#F27D26] mb-2" />
                          <span className="text-[9px] font-bold uppercase tracking-widest text-center">Upload ZIP Library</span>
                          <input type="file" accept=".zip" className="hidden" onChange={handleZipUpload} />
                        </label>
                        <label className="flex flex-col items-center justify-center border-2 border-dashed border-[#1A1A1A] rounded-2xl p-6 cursor-pointer hover:border-[#F27D26] hover:bg-[#F27D26]/5 transition-all group">
                          <Music size={24} className="text-gray-600 group-hover:text-[#F27D26] mb-2" />
                          <span className="text-[9px] font-bold uppercase tracking-widest text-center">Voiceover Track</span>
                          <input type="file" accept="audio/*" className="hidden" onChange={(e) => handleFileUpload(e, 'audio')} />
                        </label>
                      </div>
                    </div>

                    <div className="space-y-4">
                      <div className="flex justify-between items-center">
                        <h3 className="text-[11px] font-black uppercase tracking-[0.3em] text-gray-500">Asset Gallery</h3>
                        <span className="text-[10px] font-mono text-gray-600">{project.assets.length} items</span>
                      </div>
                      <div className="grid grid-cols-2 gap-3 pb-8">
                        {project.assets.map(asset => (
                          <div key={asset.id} className="relative aspect-video rounded-xl overflow-hidden group border border-[#1A1A1A]">
                            {asset.type === 'image' ? (
                              <img src={asset.url} className="w-full h-full object-cover" />
                            ) : asset.type === 'audio' ? (
                              <div className="w-full h-full bg-[#1A1A1A] flex items-center justify-center"><Music size={20} className="text-[#F27D26]" /></div>
                            ) : (
                              <div className="w-full h-full bg-[#1A1A1A] flex items-center justify-center"><Video size={20} className="text-blue-500" /></div>
                            )}
                            <div className="absolute inset-0 bg-black/80 opacity-0 group-hover:opacity-100 transition-all flex flex-col items-center justify-center p-4">
                              <p className="text-[8px] text-white font-bold uppercase text-center mb-3 line-clamp-1">{asset.name}</p>
                              <button
                                aria-label={`Delete asset ${asset.name}`}
                                onClick={() => {
                                  URL.revokeObjectURL(asset.url);
                                  setProject(p => ({
                                    ...p,
                                    assets: p.assets.filter(a => a.id !== asset.id),
                                    voiceoverId: p.voiceoverId === asset.id ? undefined : p.voiceoverId,
                                    segments: p.segments.map(s =>
                                      s.assetId === asset.id ? { ...s, assetId: undefined } : s
                                    ),
                                  }));
                                  deleteAsset(asset.id).catch(err =>
                                    console.error('Failed to delete asset from IndexedDB:', err)
                                  );
                                }}
                                className="p-2 bg-red-500/20 text-red-500 rounded-full hover:bg-red-500 hover:text-white transition-colors"
                              >
                                <Trash2 size={16} />
                              </button>
                            </div>
                            {asset.id === project.voiceoverId && (
                              <div className="absolute top-2 right-2 bg-[#F27D26] text-white p-1 rounded-full"><Music size={10} /></div>
                            )}
                          </div>
                        ))}
                        <label className="border-2 border-dashed border-[#1A1A1A] rounded-xl flex flex-col items-center justify-center hover:border-[#F27D26] cursor-pointer transition-colors min-h-[80px]">
                           <Plus size={20} className="text-gray-700" />
                           <input type="file" multiple className="hidden" onChange={(e) => {
                             const files: File[] = Array.from(e.target.files || []);
                             files.forEach(f => {
                               let type: Asset['type'] = 'image';
                               if (f.type.startsWith('audio')) type = 'audio';
                               else if (f.type.startsWith('video')) type = 'video';
                               handleFileUpload({ target: { files: [f] } } as any, type);
                             });
                           }} />
                        </label>
                      </div>
                    </div>
                  </div>
                )}

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
                  />
                )}
              </div>
            </div>
          </div>
          )} {/* end legacy left panel {false && */}

                {/* Right Panel: Preview & Sequence */}
          <div className="flex-1 flex flex-col bg-[#020202] relative p-8 gap-8 overflow-hidden">
             {/* Main Stage */}
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
               />
             </ErrorBoundary>

             {/* Professional Sequence Timeline */}
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
               onTogglePlay={togglePlay}
               onSeek={(time) => {
                 setCurrentTime(time);
                 if (audioRef.current) audioRef.current.currentTime = time;
               }}
               onZoomChange={setZoomLevel}
               onSpeedChange={setGlobalPlaybackSpeed}
               onResizeStart={(id, type) => {
                 setResizingId(id);
                 setResizingType(type);
                 document.body.classList.add('resizing');

                 const handleMove = (e: MouseEvent) => {
                   const timeline = document.getElementById('timeline-scroll-area');
                   if (!timeline) return;
                   const rect = timeline.getBoundingClientRect();
                   const x = e.clientX - rect.left + timeline.scrollLeft - 24;
                   const pixelsPerSecond = 100 * zoomLevel;
                   setProject(prev => {
                     const target = prev.segments.find(s => s.id === id);
                     if (!target) return prev;
                     const updated = prev.segments.map(s => {
                       if (s.id !== id) return s;
                       if (type === 'end') return { ...s, duration: Math.max(0.1, (x / pixelsPerSecond) - target.startTime) };
                       if (type === 'start') {
                         const delta = (x / pixelsPerSecond) - target.startTime;
                         return { ...s, duration: Math.max(0.1, target.duration - delta), trimStart: Math.max(0, (target.trimStart ?? 0) + delta) };
                       }
                       return s;
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
                   requestAnimationFrame(() => {
                     isResizingRef.current = false;
                   });
                 };

                 isResizingRef.current = true;
                 window.addEventListener('mousemove', handleMove);
                 window.addEventListener('mouseup', handleUp);
               }}
               onSegmentUpdate={(updater) => setProject(prev => ({ ...prev, segments: updater(prev.segments) }))}
               onOpenStockSearch={(segmentId) => { setStockTarget(segmentId); setShowStockSearch(true); }}
               onSetTrimmingSegment={setTrimmingSegmentId}
               onSetAdjustingTrim={setIsAdjustingTrim}
             />
             </ErrorBoundary>

             <BottomDrawer
               segment={selectedSegment}
               segmentIndex={selectedSegmentIndex}
               assets={project.assets}
               globalOverlayConfig={project.globalOverlayConfig}
               onClose={() => setSelectedSegmentId(null)}
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
               onOpenStockSearch={(segmentId) => { setStockTarget(segmentId); setShowStockSearch(true); }}
               onToggleLock={handleToggleLock}
             />
        </div>
      </div>
      </main>

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

      {/* Settings Modal */}
      <AnimatePresence>
        {showSettings && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[100] bg-black/90 backdrop-blur-2xl flex items-start justify-center p-12 overflow-y-auto"
            onClick={(e) => { if (e.target === e.currentTarget) setShowSettings(false); }}
          >
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 20 }}
              className="w-full max-w-2xl bg-[#080808] border border-white/5 rounded-[32px] overflow-hidden shadow-2xl"
            >
              <div className="flex items-center justify-between px-8 py-6 border-b border-[#1A1A1A]">
                <h2 className="text-sm font-black uppercase tracking-[0.2em] text-white">Settings</h2>
                <button
                  onClick={() => setShowSettings(false)}
                  className="p-2 rounded-xl hover:bg-white/5 transition-colors"
                  aria-label="Close settings"
                >
                  <X size={18} className="text-gray-500" />
                </button>
              </div>
              <div className="p-8">
                <SettingsPanel
                  project={project}
                  onProjectChange={(updates) => setProject(p => ({ ...p, ...updates }))}
                  onApplyTransitionToAll={() => setProject(p => ({ ...p, segments: p.segments.map(s => ({ ...s, transition: p.globalTransition })) }))}
                  onApplyAnimationToAll={() => setProject(p => ({ ...p, segments: p.segments.map(s => ({ ...s, animation: p.globalAnimation })) }))}
                  onApplyFilterToAll={() => setProject(p => ({ ...p, segments: p.segments.map(s => ({ ...s, overlayFilter: p.globalOverlayFilter })) }))}
                  onNewProject={handleNewProject}
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
                />
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

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
                blob = await fetch(stock.url).then(r => r.blob());
              } catch (err) {
                console.error('Failed to fetch stock asset blob, skipping:', stock.url, err);
                return;
              }
              const id = crypto.randomUUID();
              try {
                await putAsset(id, blob, { name: stock.name, mimeType: blob.type });
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
                          <h2 className="text-3xl font-black uppercase tracking-tighter text-white mb-2">{editingSegment.heading || "Untilted Scene"}</h2>
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
                            value={editingSegment.heading || ''} 
                            onChange={(e) => setEditingSegment({...editingSegment, heading: e.target.value})}
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

    </div>
  );
}
