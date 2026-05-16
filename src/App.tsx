/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useRef, useEffect, useMemo, ChangeEvent } from 'react';
import JSZip from 'jszip';
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
  X
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
import { isFuzzyMatch, findAssetByContext } from './services/syncEngine';
import { putAsset, deleteAsset, getAllAssets, clearAllAssets } from './services/assetStore';
import { loadProject, clearProject } from './services/projectStore';
import { usePersistProject } from './hooks/usePersistProject';
import { FONT_FAMILIES, FILTERS, TEXT_ANIMATIONS, getFilterStyle, getMotionProps } from './constants';
import { StockSearchModal } from './components/StockSearchModal';
import { SyncReviewModal } from './components/SyncReviewModal';
import { SegmentEditorPanel } from './components/SegmentEditorPanel';
import { Timeline } from './components/Timeline';
import { PreviewStage } from './components/PreviewStage';
import { SyncWizard } from './components/SyncWizard';
import { SettingsPanel } from './components/SettingsPanel';
import { renderSegmentFrame } from './services/frameRenderer';

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

  const textSegments = rawSegments.filter(s => s.text);
  const totalTextLength = textSegments.reduce((acc, s) => acc + s.text.length, 0) || 1;
  const voDuration = voiceoverDuration > 0 ? voiceoverDuration : rawSegments.length * 5;

  let currentTimeAccumulator = 0;
  const finalSegments: VideoSegment[] = [];

  for (const [i, s] of rawSegments.entries()) {
    let targetDuration = 0;

    if (textSegments.length > 0) {
      const weight = s.text.length / totalTextLength;
      targetDuration = weight * voDuration;
    } else {
      targetDuration = voDuration / Math.max(1, rawSegments.length);
    }

    targetDuration = Math.max(targetDuration, 0.5);

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
  const [resizingId, setResizingId] = useState<string | null>(null);
  const [resizingType, setResizingType] = useState<'start' | 'end' | null>(null);
  const [trimmingSegmentId, setTrimmingSegmentId] = useState<string | null>(null);
  const [showStockSearch, setShowStockSearch] = useState(false);
  const [stockTarget, setStockTarget] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const [testFrameUrl, setTestFrameUrl] = useState<string | null>(null);


  const autoMatchAssets = () => {
    setProject(prev => {
      const newSegs = prev.segments.map(s => {
        if (s.assetId) return s;
        
        // Look for bracketed name in heading or text
        const bracketMatch = (s.heading + s.text).match(/\[(.*?):?\s*(.*?)\]/);
        if (bracketMatch) {
          const name = (bracketMatch[2] ?? '').trim();
          const asset = prev.assets.find(a => isFuzzyMatch(name, a.name));
          if (asset) return { ...s, assetId: asset.id };
        }
        
        // Otherwise try current segment context
        const contextAsset = findAssetByContext(s.heading + ' ' + s.text, prev.assets);
        if (contextAsset) return { ...s, assetId: contextAsset.id };
        
        return s;
      });
      return { ...prev, segments: newSegs };
    });
  };

  useEffect(() => {
    if (project.assets.length > 0 && project.segments.length > 0) {
      autoMatchAssets();
    }
  }, [project.assets.length]);

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
    const segments = await parseProjectData(project.script, project.sceneDetails, project.assets, audioDuration);
    
    // Ensure accurate start times
    let acc = 0;
    const syncedSegments = segments.map(s => {
      const start = acc;
      acc += s.duration;
      return { ...s, startTime: Number(start.toFixed(3)) };
    });

    setProject(prev => ({ ...prev, segments: syncedSegments }));
    setIsSynced(true);
    setIsProcessing(false);
    setSyncStep(4);
    setActiveTab('editor'); 
  };

  const [isExporting, setIsExporting] = useState(false);
  const [exportProgress, setExportProgress] = useState(0);
  const previewRef = useRef<HTMLDivElement>(null);
  const hiddenCanvasRef = useRef<HTMLCanvasElement>(null);
  
  // Cache for Web Audio nodes to avoid re-connection errors
  const audioContextRef = useRef<AudioContext | null>(null);
  const audioSourceNodeRef = useRef<MediaElementAudioSourceNode | null>(null);
  const audioDestRef = useRef<MediaStreamAudioDestinationNode | null>(null);

  const handleExport = async () => {
    if (!isSynced) return;
    
    setIsExporting(true);
    setExportProgress(0);
    
    const canvas = hiddenCanvasRef.current;
    if (!canvas) {
       setIsExporting(false);
       alert("Export failed: System canvas not initialized.");
       return;
    }

    const canvasStream = canvas.captureStream(30);
    const combinedTracks = [...canvasStream.getVideoTracks()];
    
    if (audioRef.current && voiceover) {
      try {
        if (!audioContextRef.current) {
          audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
          audioDestRef.current = audioContextRef.current.createMediaStreamDestination();
          audioSourceNodeRef.current = audioContextRef.current.createMediaElementSource(audioRef.current);
          audioSourceNodeRef.current.connect(audioDestRef.current);
          audioSourceNodeRef.current.connect(audioContextRef.current.destination);
        }
        
        const audioTracks = audioDestRef.current!.stream.getAudioTracks();
        const firstTrack = audioTracks[0];
        if (firstTrack) {
          combinedTracks.push(firstTrack);
        }
      } catch (err) {
        console.warn("Audio capture via Web Audio failed, using fallback:", err);
        const el = audioRef.current as HTMLAudioElement & {
          captureStream?: () => MediaStream;
          mozCaptureStream?: () => MediaStream;
        };
        const audioStream = el.captureStream?.() ?? el.mozCaptureStream?.();
        if (audioStream) {
          const fallbackTrack = audioStream.getAudioTracks()[0];
          if (fallbackTrack) combinedTracks.push(fallbackTrack);
        }
      }
    }

    const stream = new MediaStream(combinedTracks);
    const options = MediaRecorder.isTypeSupported('video/webm;codecs=vp9') 
      ? { mimeType: 'video/webm;codecs=vp9' } 
      : { mimeType: 'video/webm' };
    let recorder: MediaRecorder;
    
    try {
      recorder = new MediaRecorder(stream, options);
    } catch (e) {
      console.error("MediaRecorder error:", e);
      setIsExporting(false);
      alert("MP4 Export not supported in this browser environment.");
      return;
    }

    const chunks: Blob[] = [];
    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunks.push(e.data);
    };

    recorder.onstop = () => {
      const blob = new Blob(chunks, { type: 'video/webm' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${project.name.replace(/\s+/g, '_')}_master.webm`;
      a.click();
      
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current.muted = false;
      }
      
      setIsExporting(false);
      setIsPlaying(false);
    };

    // Prepare for capture
    setCurrentTime(0);
    setIsPlaying(false); 
    setExportProgress(0.1); 
    
    if (audioRef.current) {
      audioRef.current.currentTime = 0;
      audioRef.current.muted = true; // Mute during export to avoid double sound if user plays
      audioRef.current.play().catch(e => console.warn("Audio play failed during export:", e));
    }

    recorder.start();

    const totalSegmentsDuration = project.segments.reduce((acc, s) => acc + s.duration, 0) || 0.001;
    const audioDuration = audioRef.current?.duration || 0;
    const totalDuration = Math.max(totalSegmentsDuration, audioDuration);
    
    let exportTime = 0;
    const frameRate = 30;
    const intervalTime = 1000 / frameRate;
    const frameStep = 1 / frameRate;

    const exportLoop = setInterval(() => {
      if (audioRef.current && !audioRef.current.paused) {
        // Sync with audio if available
        exportTime = audioRef.current.currentTime;
      } else {
        exportTime += frameStep;
      }
      
      if (exportTime > totalDuration) exportTime = totalDuration;
      
      setCurrentTime(exportTime);
      
      const progress = Math.min(99, (exportTime / totalDuration) * 100);
      setExportProgress(progress);
      
      if (exportTime >= totalDuration) {
        clearInterval(exportLoop);
        setTimeout(() => {
          recorder.stop();
          setExportProgress(100);
        }, 500); 
      }
    }, intervalTime);
  };

  const handleZipUpload = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    
    setIsProcessing(true);
    try {
      const zip = new JSZip();
      const content = await zip.loadAsync(file);
      const newAssets: Asset[] = [];
      
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
      setProject(prev => ({
        ...prev,
        assets: [...prev.assets, ...newAssets],
        voiceoverId: newAssets.find(a => a.type === 'audio')?.id || prev.voiceoverId
      }));
    } catch (err) {
      console.error("ZIP Error:", err);
    } finally {
      setIsProcessing(false);
    }
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
      setProject(prev => ({
        ...prev,
        assets: [...prev.assets, newAsset],
        voiceoverId: detectedType === 'audio' ? newAsset.id : prev.voiceoverId,
      }));
    }
  };

  const currentSegment = useMemo(() => {
    const seg = project.segments.find(s => currentTime >= s.startTime && currentTime < s.startTime + s.duration);
    return seg || null;
  }, [currentTime, project.segments]);

  const voiceover = project.assets.find(a => a.id === project.voiceoverId);

  const handleRenderTestFrame = async () => {
    const seg = currentSegment ?? project.segments[0];
    if (!seg) return;
    const W = 1920, H = 1080;
    const canvas = document.createElement('canvas');
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const asset = project.assets.find(a => a.id === seg.assetId);
    await renderSegmentFrame({
      segment: seg,
      asset,
      timeInSegment: Math.max(0, currentTime - seg.startTime),
      ctx,
      width: W,
      height: H,
      global: {
        overlayConfig: project.globalOverlayConfig,
        hideAllText: project.hideAllText ?? false,
        globalOverlayFilter: project.globalOverlayFilter,
      },
    });
    setTestFrameUrl(prev => {
      if (prev) URL.revokeObjectURL(prev);
      return null;
    });
    canvas.toBlob(blob => {
      if (blob) setTestFrameUrl(URL.createObjectURL(blob));
    }, 'image/png');
  };

  // Constrain segments to match audio duration perfectly
  useEffect(() => {
    if (isSynced && voiceover && audioRef.current?.duration) {
      const audioDuration = audioRef.current.duration;
      const segmentsDuration = project.segments.reduce((acc, s) => acc + s.duration, 0);
      
      // If there's a significant mismatch (> 0.1s), re-average or distribute the difference
      if (Math.abs(segmentsDuration - audioDuration) > 0.1 && !resizingId) {
        setProject(prev => {
          const ratio = audioDuration / segmentsDuration;
          let acc = 0;
          const adjustedSegs = prev.segments.map(s => {
            const newDuration = s.duration * ratio;
            const start = acc;
            acc += newDuration;
            return {
              ...s,
              duration: Number(newDuration.toFixed(3)),
              startTime: Number(start.toFixed(3))
            };
          });
          return { ...prev, segments: adjustedSegs };
        });
      }
    }
  }, [project.voiceoverId, isSynced, resizingId]);

  useEffect(() => {
    let interval: any;
    if (isPlaying) {
      interval = setInterval(() => {
        const inHeading = currentSegment?.heading && !currentSegment?.text;
        const audioDuration = audioRef.current?.duration || 0;
        const segmentsDuration = project.segments.reduce((acc, s) => acc + s.duration, 0);
        
        let maxDuration = audioDuration > 0 ? audioDuration : segmentsDuration;
        if (isNaN(maxDuration) || !isFinite(maxDuration)) maxDuration = segmentsDuration || 10;

        if (audioRef.current) {
          audioRef.current.playbackRate = globalPlaybackSpeed;
          
          if (voiceover && !inHeading && currentTime < audioDuration) {
            if (audioRef.current.paused) {
              audioRef.current.play().catch(() => {});
            }
            setCurrentTime(audioRef.current.currentTime);
          } else {
            // Manual advancement if no audio or in a heading (heading pauses script voiceover)
            if (audioRef.current && !isExporting && inHeading) audioRef.current.pause();
            
            setCurrentTime(prev => {
              const next = prev + 0.1 * globalPlaybackSpeed;
              if (next >= maxDuration) {
                setIsPlaying(false);
                if (audioRef.current) audioRef.current.currentTime = 0;
                return 0;
              }
              return next;
            });
          }
        } else {
          // No audio ref, manual play
          setCurrentTime(prev => {
            const next = prev + 0.1 * globalPlaybackSpeed;
             if (next >= maxDuration) {
               setIsPlaying(false);
               return 0;
             }
             return next;
          });
        }
      }, 100);
    } else {
      if (!isExporting) {
        audioRef.current?.pause();
      }
    }
    return () => clearInterval(interval);
  }, [isPlaying, voiceover, project.segments, currentSegment, isExporting, globalPlaybackSpeed]);

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

  // Mirror DOM preview to canvas for capture
  useEffect(() => {
    if (!isExporting || !previewRef.current || !hiddenCanvasRef.current) return;
    
    const ctx = hiddenCanvasRef.current.getContext('2d');
    const source = previewRef.current;
    
    const mirror = () => {
      if (!isExporting) return;
      if (ctx && source) {
        const video = source.querySelector('video');
        const img = source.querySelector('img');

        // Only fill if nothing to draw to avoid gaps
        if (!video && !img) {
          ctx.fillStyle = 'black';
          ctx.fillRect(0, 0, 1280, 720);
        }

        if (video) {
           ctx.drawImage(video, 0, 0, 1280, 720);
        } else if (img) {
           ctx.drawImage(img, 0, 0, 1280, 720);
        }

        // Draw simple overlays on canvas for MP4 export
        if (currentSegment) {
          ctx.fillStyle = 'rgba(0,0,0,0.3)';
          ctx.font = 'bold 40px Anton, sans-serif';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          
          if (!project.hideAllText || currentSegment.showOverlay) {
            if (currentSegment.heading) {
              ctx.fillStyle = project.globalOverlayConfig.backgroundColor;
              const textWidth = ctx.measureText(currentSegment.heading).width;
              ctx.fillRect(640 - textWidth/2 - 20, 360 - 60, textWidth + 40, 80);
              ctx.fillStyle = project.globalOverlayConfig.color;
              ctx.fillText(currentSegment.heading, 640, 360 - 20);
            }
          }
        }
      }
      requestAnimationFrame(mirror);
    };
    mirror();
  }, [isExporting]);

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
      {/* Sidebar Navigation */}
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
            className={`p-3 rounded-xl transition-all duration-300 relative group ${activeTab === tab.id ? 'bg-[#1A1A1A] text-[#F27D26]' : 'text-gray-600 hover:text-white'}`}
          >
            <tab.icon size={20} />
            <span className="absolute left-full ml-4 px-2 py-1 bg-black text-[10px] uppercase tracking-widest rounded opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap z-50">{tab.label}</span>
          </button>
        ))}
      </nav>

      {/* Workspace */}
      <main className="flex-1 flex flex-col h-screen overflow-hidden">
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
            onExport={handleExport}
            onReviewMapping={() => setShowSyncDetails(true)}
          />
        </header>

        <div className="flex-1 flex overflow-hidden">
          {/* Left Panel */}
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
                                onClick={() => {
                                  setProject(p => ({ ...p, assets: p.assets.filter(a => a.id !== asset.id) }));
                                  URL.revokeObjectURL(asset.url);
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
                    onRenderTestFrame={import.meta.env.DEV ? handleRenderTestFrame : undefined}
                  />
                )}
              </div>
            </div>
          </div>
                {/* Right Panel: Preview & Sequence */}
          <div className="flex-1 flex flex-col bg-[#020202] relative p-8 gap-8 overflow-hidden">
             {/* Main Stage */}
             <PreviewStage
               currentSegment={currentSegment ?? undefined}
               currentTime={currentTime}
               globalPlaybackSpeed={globalPlaybackSpeed}
               globalTransition={project.globalTransition}
               globalTransitionDuration={project.globalTransitionDuration ?? 0.5}
               globalOverlayConfig={project.globalOverlayConfig}
               hideAllText={project.hideAllText ?? false}
               assets={project.assets}
             />

             {/* Professional Sequence Timeline */}
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
               onResizeStart={(id, type) => { setResizingId(id); setResizingType(type); }}
               onResizeEnd={() => { setResizingId(null); setResizingType(null); }}
               onResizeMove={(x) => {
                 setProject(prev => {
                   const target = prev.segments.find(s => s.id === resizingId);
                   if (!target) return prev;
                   const pixelsPerSecond = 100 * zoomLevel;
                   const updated = prev.segments.map(s => {
                     if (s.id !== resizingId) return s;
                     if (resizingType === 'end') return { ...s, duration: Math.max(0.1, (x / pixelsPerSecond) - target.startTime) };
                     if (resizingType === 'start') {
                       const delta = (x / pixelsPerSecond) - target.startTime;
                       return { ...s, duration: Math.max(0.1, target.duration - delta), trimStart: Math.max(0, (target.trimStart ?? 0) + delta) };
                     }
                     return s;
                   });
                   let acc = 0;
                   return { ...prev, segments: updated.map(s => { const start = acc; acc += s.duration; return { ...s, startTime: Number(start.toFixed(3)) }; }) };
                 });
               }}
               onSegmentUpdate={(updater) => setProject(prev => ({ ...prev, segments: updater(prev.segments) }))}
               onOpenStockSearch={(segmentId) => { setStockTarget(segmentId); setShowStockSearch(true); }}
               onSetTrimmingSegment={setTrimmingSegmentId}
               onSetAdjustingTrim={setIsAdjustingTrim}
             />
        </div>
      </div>
      </main>

      {/* Persistence Audio */}
      {voiceover && (
        <audio 
          ref={audioRef} 
          src={voiceover.url} 
          onTimeUpdate={() => {
            if (isPlaying) {
              setCurrentTime(audioRef.current?.currentTime || 0);
            }
          }}
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
      
      <canvas 
        ref={hiddenCanvasRef} 
        width={1280} 
        height={720} 
        className="hidden pointer-events-none" 
      />

      {/* Export Progress Overlay */}
      <AnimatePresence>
        {isExporting && (
          <motion.div 
            initial={{ opacity: 0 }} 
            animate={{ opacity: 1 }} 
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[200] bg-black/95 backdrop-blur-3xl flex items-center justify-center p-8"
          >
            <div className="w-full max-w-md text-center space-y-8">
              <div className="relative inline-block">
                 <div className="w-32 h-32 rounded-full border-4 border-gray-800 flex items-center justify-center">
                    <span className="text-3xl font-black text-[#F27D26]">{Math.round(exportProgress)}%</span>
                 </div>
                 <motion.div 
                   className="absolute inset-0 rounded-full border-4 border-t-[#F27D26] border-r-transparent border-b-transparent border-l-transparent"
                   animate={{ rotate: 360 }}
                   transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
                 />
              </div>
              
              <div>
                <h2 className="text-2xl font-bold tracking-tight text-white mb-2">Rendering Master MP4</h2>
                <p className="text-gray-500 text-sm font-medium">Please do not close this tab. Processing high-quality textures and transitions...</p>
              </div>

              <div className="h-2 bg-gray-900 rounded-full overflow-hidden">
                <motion.div 
                  className="h-full bg-gradient-to-r from-[#F27D26] to-orange-400"
                  style={{ width: `${exportProgress}%` }}
                />
              </div>

              <div className="grid grid-cols-3 gap-4">
                 <div className="p-3 bg-[#0A0A0A] border border-[#1A1A1A] rounded-2xl">
                    <p className="text-[8px] text-gray-600 font-black uppercase mb-1">Encoding</p>
                    <p className="text-[10px] text-white font-bold">H.264 / AAC</p>
                 </div>
                 <div className="p-3 bg-[#0A0A0A] border border-[#1A1A1A] rounded-2xl">
                    <p className="text-[8px] text-gray-600 font-black uppercase mb-1">Container</p>
                    <p className="text-[10px] text-white font-bold">MP4 / HEVC</p>
                 </div>
                 <div className="p-3 bg-[#0A0A0A] border border-[#1A1A1A] rounded-2xl">
                    <p className="text-[8px] text-gray-600 font-black uppercase mb-1">FPS</p>
                    <p className="text-[10px] text-white font-bold">60 Constant</p>
                 </div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Stock Media Search Modal */}
      <AnimatePresence>
        {showStockSearch && (
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
              setProject(p => ({
                ...p,
                assets: [...p.assets, newAsset],
                segments: p.segments.map(s =>
                  s.id === targetId
                    ? { ...s, assetId: newAsset.id, playbackSpeed: 1, trimStart: 0, isMuted: true }
                    : s
                ),
              }));
            }}
          />
        )}
      </AnimatePresence>

      {/* Sync Review Modals */}
      <AnimatePresence>
        {showSyncDetails && (
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
        )}
      </AnimatePresence>

      {/* Double-click Scene Editor Modal */}
      <AnimatePresence>
        {editingSegment && (
           <div className="fixed inset-0 z-[5000] flex items-center justify-center p-12 bg-black/90 backdrop-blur-2xl">
             <motion.div 
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
                      <button onClick={() => setEditingSegment(null)} className="p-4 bg-white/5 rounded-2xl hover:bg-red-500 hover:text-white transition-all"><X size={24}/></button>
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

                      <div className="space-y-4">
                         <label className="text-[10px] font-black uppercase tracking-[0.2em] text-blue-500">Visual Trimming (Slip)</label>
                         <div className="p-6 rounded-3xl bg-white/5 border border-white/5 space-y-6">
                            <div className="flex justify-between text-[11px] font-mono">
                               <span className="text-gray-500">Video Start</span>
                               <span className="text-blue-400 font-bold">{editingSegment.trimStart?.toFixed(2)}s</span>
                            </div>
                            <input 
                               type="range" min="0" max={editingSegment.sourceDuration || 60} step="0.1"
                               value={editingSegment.trimStart || 0}
                               onChange={(e) => setEditingSegment({...editingSegment, trimStart: parseFloat(e.target.value)})}
                               className="w-full accent-blue-500"
                            />
                            <div className="flex items-center gap-4 pt-2">
                               <div className="flex-1 p-3 bg-black rounded-xl border border-white/5 text-center">
                                  <span className="text-[9px] font-bold text-gray-600 block uppercase mb-1">Playback Speed</span>
                                  <span className="text-sm font-bold text-white">{editingSegment.playbackSpeed?.toFixed(2)}x</span>
                               </div>
                               <div className="flex gap-2">
                                  <button onClick={() => setEditingSegment({...editingSegment, playbackSpeed: Math.max(0.2, (editingSegment.playbackSpeed || 1) - 0.1)})} className="p-3 bg-white/5 rounded-xl hover:bg-white/10 transition-all">-</button>
                                  <button onClick={() => setEditingSegment({...editingSegment, playbackSpeed: Math.min(3, (editingSegment.playbackSpeed || 1) + 0.1)})} className="p-3 bg-white/5 rounded-xl hover:bg-white/10 transition-all">+</button>
                               </div>
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

      {/* Dev-only: frame renderer test output */}
      {import.meta.env.DEV && testFrameUrl && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/90 backdrop-blur-sm" onClick={() => setTestFrameUrl(null)}>
          <div className="relative max-w-[90vw] max-h-[90vh]" onClick={e => e.stopPropagation()}>
            <p className="text-[9px] font-black uppercase tracking-[0.3em] text-yellow-500 mb-2">
              Frame Renderer Output — 1920×1080 — click outside to dismiss
            </p>
            <img src={testFrameUrl} alt="Rendered frame" className="w-full h-auto rounded-xl border border-yellow-900" />
          </div>
        </div>
      )}
    </div>
  );
}
