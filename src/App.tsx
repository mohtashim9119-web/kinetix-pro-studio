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
import { searchAllStock, StockResult } from './services/stockService';

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
const isFuzzyMatch = (search: string, target: string) => {
  if (!search || !target) return false;
  // Strip tags and extensions
  const s = search.toLowerCase().trim().replace(/\[(IMAGE|VIDEO|HEADING):?\s*|\]/gi, '').replace(/\.(jpg|jpeg|png|mp4|mov|wav|mp3|zip)$/i, '');
  const t = target.toLowerCase().trim().replace(/\.(jpg|jpeg|png|mp4|mov|wav|mp3|zip)$/i, '');
  
  if (t === s) return true;
  if (t.includes(s) || s.includes(t)) return true;
  
  // Requirement: at least 2 words match
  const sWords = s.split(/[\s_\-]+/).filter(w => w.length > 2);
  const tWords = t.split(/[\s_\-]+/).filter(w => w.length > 2);
  
  let matches = 0;
  const matchedWords: string[] = [];
  for(const word of sWords) {
    if (tWords.some(tw => tw.includes(word) || word.includes(tw))) {
       matches++;
       matchedWords.push(word);
    }
  }
  
  return matches >= 2;
};

// Advanced context matching
const findAssetByContext = (text: string, assets: Asset[]) => {
  const words = text.toLowerCase().split(/[\s,.;:!?]+/).filter(w => w.length > 3);
  for (const asset of assets) {
    const assetName = asset.name.toLowerCase();
    if (words.some(word => assetName.includes(word))) return asset;
  }
  return null;
};

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

const FONT_FAMILIES = [
  'Inter', 'Anton', 'Space Grotesk', 'JetBrains Mono', 'Playfair Display', 'Outfit', 
  'Bebas Neue', 'Montserrat', 'Oswald', 'Roboto', 'Poppins', 'Lato', 'Open Sans', 
  'Raleway', 'Nunito', 'Ubuntu', 'Merriweather', 'Lora', 'Libre Baskerville', 
  'Dancing Script', 'Pacifico', 'Shadows Into Light', 'Indie Flower', 'Amatic SC', 
  'Caveat', 'Satisfy', 'Courgette', 'Righteous', 'Lobster', 'Fredoka One', 
  'Luckiest+Guy', 'Permanent Marker', 'Special Elite', 'Cormorant Garamond', 'Cinzel', 
  'Marcellus', 'Alumni Sans Collegiate One', 'Bungee', 'Monoton', 'Press Start 2P', 
  'Staatliches', 'Teko', 'Kanit', 'Heebo', 'Arimo', 'Titillium Web', 'Exo 2', 
  'Fira Sans', 'Josefin Sans', 'Quicksand', 'Varela Round'
];

const FILTERS = [
  'none', 'vintage', 'noir', 'warm', 'cool', 'dramatic', 'vivid', 'cinematic',
  'sepia', 'grayscale', 'invert', 'hue-rotate-90', 'hue-rotate-180', 'hue-rotate-270',
  'blur-sm', 'blur-md', 'blur-lg', 'brightness-50', 'brightness-150', 'contrast-50', 'contrast-150',
  'saturate-0', 'saturate-200', 'vignette', 'scanlines', 'film-grain', 'technicolor',
  'kodachrome', 'polaroid', 'instant', 'cross-process', 'bleach-bypass', 'fuji', 'agfa',
  'lofi', '8mm', '16mm', 'crt', 'glitch-static', 'noise', 'dust', 'light-leak',
  'retro', 'cyberpunk', 'vaporwave', 'halftone', 'pixel-art', 'edge-detect', 'emboss',
  'sharpen', 'gaussian', 'midnight', 'sunset', 'aurora', 'sepia-high', 'pop-art'
];

const getFilterStyle = (filter?: string) => {
  switch (filter) {
    case 'vintage': return 'sepia(0.5) contrast(1.1) brightness(0.9) saturate(0.8)';
    case 'noir': return 'grayscale(1) contrast(1.5) brightness(0.8)';
    case 'warm': return 'sepia(0.2) saturate(1.4) hue-rotate(-10deg)';
    case 'cool': return 'saturate(1.2) hue-rotate(10deg) brightness(1.1)';
    case 'dramatic': return 'contrast(1.6) brightness(0.9) saturate(0.6)';
    case 'vivid': return 'saturate(2) contrast(1.2) brightness(1.1)';
    case 'cinematic': return 'contrast(1.2) brightness(0.9) saturate(0.9) sepia(0.1)';
    case 'sepia': return 'sepia(1)';
    case 'grayscale': return 'grayscale(1)';
    case 'invert': return 'invert(1)';
    case 'hue-rotate-90': return 'hue-rotate(90deg)';
    case 'hue-rotate-180': return 'hue-rotate(180deg)';
    case 'hue-rotate-270': return 'hue-rotate(270deg)';
    case 'blur-sm': return 'blur(4px)';
    case 'blur-md': return 'blur(8px)';
    case 'blur-lg': return 'blur(16px)';
    case 'brightness-50': return 'brightness(0.5)';
    case 'brightness-150': return 'brightness(1.5)';
    case 'contrast-50': return 'contrast(0.5)';
    case 'contrast-150': return 'contrast(1.5)';
    case 'saturate-0': return 'saturate(0)';
    case 'saturate-200': return 'saturate(2)';
    case 'technicolor': return 'contrast(1.4) saturate(1.8) hue-rotate(-5deg)';
    case 'bleach-bypass': return 'contrast(1.5) saturate(0.4) brightness(1.1)';
    case 'lofi': return 'contrast(1.2) saturate(0.8) sepia(0.2) brightness(1.1)';
    default: return 'none';
  }
};
const TEXT_ANIMATIONS = [
  'fade', 'slide-up', 'slide-down', 'slide-left', 'slide-right', 
  'scale', 'zoom-in', 'zoom-out', 'blur', 'rotate', 
  'typewriter', 'bounce', 'skew', 'reveal-horizontal', 'reveal-vertical', 
  'glitch', 'neon-flicker', 'bounce-in', 'elastic-pop', 'jello',
  'swing', 'wobble', 'pulse', 'shake', 'float', 'heartbeat',
  'flip-x', 'flip-y', 'roll-in', 'roll-out', 'spiral-in', 'spiral-out',
  'blur-reveal', 'shimmer', 'rainbow', 'fire', 'ice', 'ghost',
  'shadow-pop', 'stretch-horizontal', 'stretch-vertical', 'squish',
  '3d-rotate', 'wave', 'zigzag', 'confetti', 'explosion', 'implosion'
];

const getMotionProps = (animation: string) => {
  switch (animation) {
    case 'slide-up': return { initial: { opacity: 0, y: 100 }, animate: { opacity: 1, y: 0 }, exit: { opacity: 0, y: -100 } };
    case 'slide-down': return { initial: { opacity: 0, y: -100 }, animate: { opacity: 1, y: 0 }, exit: { opacity: 0, y: 100 } };
    case 'slide-left': return { initial: { opacity: 0, x: 100 }, animate: { opacity: 1, x: 0 }, exit: { opacity: 0, x: -100 } };
    case 'slide-right': return { initial: { opacity: 0, x: -100 }, animate: { opacity: 1, x: 0 }, exit: { opacity: 0, x: 100 } };
    case 'scale': return { initial: { opacity: 0, scale: 0.2 }, animate: { opacity: 1, scale: 1 }, exit: { opacity: 0, scale: 2 } };
    case 'zoom-in': return { initial: { opacity: 0, scale: 0 }, animate: { opacity: 1, scale: 1 }, exit: { opacity: 0, scale: 3 } };
    case 'zoom-out': return { initial: { opacity: 0, scale: 3 }, animate: { opacity: 1, scale: 1 }, exit: { opacity: 0, scale: 0 } };
    case 'blur': return { initial: { opacity: 0, filter: 'blur(30px)' }, animate: { opacity: 1, filter: 'blur(0px)' }, exit: { opacity: 0, filter: 'blur(30px)' } };
    case 'rotate': return { initial: { opacity: 0, rotate: -360 }, animate: { opacity: 1, rotate: 0 }, exit: { opacity: 0, rotate: 360 } };
    case 'bounce': return { initial: { opacity: 0, y: -300 }, animate: { opacity: 1, y: 0 }, transition: { type: 'spring' as const, bounce: 0.7 } };
    case 'typewriter': return { initial: { clipPath: 'inset(0 100% 0 0)' }, animate: { clipPath: 'inset(0 0 0 0)' }, transition: { duration: 1.5, ease: 'linear' as const } };
    case 'skew': return { initial: { skewX: 45, opacity: 0 }, animate: { skewX: 0, opacity: 1 }, exit: { skewX: -45, opacity: 0 } };
    case 'glitch': return { 
      animate: { 
        x: [0, -5, 5, -2, 2, 0], 
        y: [0, 2, -2, 1, -1, 0],
        opacity: [1, 0.8, 1, 0.9, 1],
        filter: ['blur(0px)', 'blur(2px)', 'blur(0px)']
      }, 
      transition: { duration: 0.3, repeat: Infinity } 
    };
    case 'pulse': return { animate: { scale: [1, 1.05, 1] }, transition: { duration: 1, repeat: Infinity } };
    case 'float': return { animate: { y: [0, -20, 0] }, transition: { duration: 3, repeat: Infinity, ease: "easeInOut" as const } };
    case 'shake': return { animate: { x: [-10, 10, -10, 10, 0] }, transition: { duration: 0.4, repeat: Infinity } };
    case 'neon-flicker': return { 
      animate: { 
        opacity: [1, 0.3, 0.8, 0.2, 1, 0.4, 0.9],
        textShadow: [
          '0 0 10px #fff, 0 0 20px #fff, 0 0 40px #f0f',
          '0 0 5px #fff, 0 0 10px #fff, 0 0 20px #f0f',
          '0 0 10px #fff, 0 0 20px #fff, 0 0 40px #f0f'
        ]
      }, 
      transition: { duration: 2, repeat: Infinity } 
    };
    case 'heartbeat': return { animate: { scale: [1, 1.2, 1, 1.1, 1] }, transition: { duration: 1.5, repeat: Infinity } };
    case 'wobble': return { animate: { rotate: [-5, 5, -5, 5, 0] }, transition: { duration: 1, repeat: Infinity } };
    case 'flip-x': return { initial: { rotateX: 90, opacity: 0 }, animate: { rotateX: 0, opacity: 1 }, exit: { rotateX: -90, opacity: 0 } };
    case 'flip-y': return { initial: { rotateY: 90, opacity: 0 }, animate: { rotateY: 0, opacity: 1 }, exit: { rotateY: -90, opacity: 0 } };
    case 'reveal-horizontal': return { initial: { width: 0 }, animate: { width: 'auto' }, transition: { duration: 0.8, ease: "circOut" as const } };
    case 'reveal-vertical': return { initial: { height: 0 }, animate: { height: 'auto' }, transition: { duration: 0.8, ease: "circOut" as const } };
    case 'crossfade': return { initial: { opacity: 0 }, animate: { opacity: 1 }, exit: { opacity: 0 }, transition: { duration: 0.5 } };
    case 'pixelate': return { initial: { filter: 'blur(20px) contrast(200%)' }, animate: { filter: 'blur(0px) contrast(100%)' }, transition: { duration: 0.8 } };
    case 'shimmer': return { animate: { backgroundPosition: ['-200% 0', '200% 0'] }, transition: { duration: 2, repeat: Infinity, ease: "linear" as const } };
    case 'elastic-pop': return { initial: { scale: 0 }, animate: { scale: 1 }, transition: { type: 'spring' as const, damping: 10, stiffness: 100 } };
    case 'zigzag': return { animate: { x: [0, 20, -20, 20, 0], y: [0, -10, 10, -10, 0] }, transition: { duration: 2, repeat: Infinity } };
    default: return { initial: { opacity: 0 }, animate: { opacity: 1 }, exit: { opacity: 0 } };
  }
};

export default function App() {
  const [project, setProject] = useState<Project>({
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
      backgroundColor: 'rgba(0,0,0,0.5)',
      fontFamily: 'Inter'
    }
  });

  const [activeTab, setActiveTab] = useState<'script' | 'assets' | 'settings' | 'editor'>('script');
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [isProcessing, setIsProcessing] = useState(false);
  const [zoomLevel, setZoomLevel] = useState(1);
  const [verticalZoom, setVerticalZoom] = useState(1);
  const [globalPlaybackSpeed, setGlobalPlaybackSpeed] = useState(1);
  const [isAdjustingTrim, setIsAdjustingTrim] = useState(false);
  const [syncStep, setSyncStep] = useState<0 | 1 | 2 | 3 | 4>(0);
  const [showSyncDetails, setShowSyncDetails] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isMidView, setIsMidView] = useState(false);
  const [editingSegment, setEditingSegment] = useState<VideoSegment | null>(null);

  // Native Fullscreen Support
  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(!!document.fullscreenElement);
    };
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', handleFullscreenChange);
  }, []);

  const toggleNativeFullscreen = () => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch(err => {
        console.warn(`Error attempting to enable full-screen mode: ${err.message}`);
        setIsFullscreen(true); // Fallback to CSS fullscreen
      });
    } else {
      document.exitFullscreen();
    }
  };
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
  const [stockSearchQuery, setStockSearchQuery] = useState('');
  const [isStockSearching, setIsStockSearching] = useState(false);
  const [stockResults, setStockResults] = useState<StockResult[]>([]);
  const [stockType, setStockType] = useState<'video' | 'image'>('video');
  const [stockTarget, setStockTarget] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement>(null);

  // Real API Search
  useEffect(() => {
    if (!showStockSearch) return;
    const delayDebounceFn = setTimeout(async () => {
      if (stockSearchQuery.length > 2) {
        setIsStockSearching(true);
        const results = await searchAllStock(stockSearchQuery, stockType);
        setStockResults(results);
        setIsStockSearching(false);
      }
    }, 1000);

    return () => clearTimeout(delayDebounceFn);
  }, [stockSearchQuery, stockType, showStockSearch]);

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
        {
          const blob = await fileData.async('blob');
          let type: Asset['type'] = 'image';
          if (filename.match(/\.(mp3|wav|ogg|m4a)$/i)) type = 'audio';
          else if (filename.match(/\.(mp4|webm|mov|m4v)$/i)) type = 'video';
          
          newAssets.push({
            id: crypto.randomUUID(),
            name: filename.split('/').pop() || filename,
            url: URL.createObjectURL(blob),
            type: type,
            file: new File([blob], filename)
          });
        }
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

  const handleFileUpload = (e: ChangeEvent<HTMLInputElement>, type: Asset['type'] | 'script' | 'story' | 'details') => {
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

      const newAsset: Asset = {
        id: crypto.randomUUID(),
        name: file.name,
        url: URL.createObjectURL(file),
        type: detectedType,
        file
      };
      setProject(prev => ({
        ...prev,
        assets: [...prev.assets, newAsset],
        voiceoverId: detectedType === 'audio' ? newAsset.id : prev.voiceoverId
      }));
    }
  };

  const currentSegment = useMemo(() => {
    const seg = project.segments.find(s => currentTime >= s.startTime && currentTime < s.startTime + s.duration);
    return seg || null;
  }, [currentTime, project.segments]);

  const voiceover = project.assets.find(a => a.id === project.voiceoverId);

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
          <div className="flex items-center gap-4">
            {isProcessing && (
              <div className="flex items-center gap-2 text-[10px] uppercase tracking-widest text-[#F27D26] font-bold">
                <RefreshCw size={14} className="animate-spin" /> Analyzing Story...
              </div>
            )}
            
            <div className="flex flex-col gap-1">
              <div className="flex items-center bg-[#1A1A1A] rounded-full p-1 gap-1 border border-[#282828] shadow-inner">
                <button 
                  onClick={runSyncStep1}
                  className={`px-4 py-1.5 rounded-full text-[8px] font-black uppercase tracking-widest transition-all ${syncValidation.voMatch ? 'bg-green-500 text-white' : 'hover:bg-white/5 text-gray-500'}`}
                >
                  {syncValidation.voMatch ? '✓ Audio Linked' : '1. Link Audio'}
                </button>
                <button 
                  onClick={runSyncStep2}
                  disabled={syncStep < 1}
                  className={`px-4 py-1.5 rounded-full text-[8px] font-black uppercase tracking-widest transition-all ${syncValidation.scriptScenesMatch ? 'bg-green-500 text-white' : 'hover:bg-white/5 text-gray-500 disabled:opacity-30'}`}
                >
                  {syncValidation.scriptScenesMatch ? `✓ Scene Count (${project.sceneDetails.split(/\r?\n\r?\n/).filter(l => l.trim()).length})` : '2. Mapping'}
                </button>
                <button 
                  onClick={runSyncStep3}
                  disabled={syncStep < 2}
                  className={`px-4 py-1.5 rounded-full text-[8px] font-black uppercase tracking-widest transition-all ${syncValidation.assetsMatch ? 'bg-green-500 text-white' : 'hover:bg-white/5 text-gray-500 disabled:opacity-30'}`}
                >
                  {syncValidation.assetsMatch ? '✓ Visuals Detected' : '3. Assets'}
                </button>
              </div>
              {syncStep > 0 && (
                <div className="flex items-center gap-3 px-3 text-[8px] font-mono text-gray-600 uppercase tracking-tighter">
                  <button 
                    onClick={() => setShowSyncDetails(true)}
                    className="flex items-center gap-1 hover:text-[#F27D26] transition-colors group"
                  >
                    <Info size={10} className="group-hover:animate-pulse" /> Review Mapping
                  </button>
                  <span>•</span>
                  <span>Scenes: {project.sceneDetails.split(/\r?\n\r?\n/).map(l=>l.trim()).filter(l => l !== '').length}</span>
                  <span>•</span>
                  <span>Audio: {audioRef.current?.duration?.toFixed(1) || 0}s</span>
                  {syncValidation.missingAssets.length > 0 && (
                     <>
                       <span>•</span>
                       <span className="text-red-500">Missing: {syncValidation.missingAssets.length}</span>
                     </>
                  )}
                </div>
              )}
            </div>

            <button 
              onClick={finalizeSync}
              disabled={isProcessing || syncStep < 3}
              className={`px-6 py-2 rounded-full text-[10px] font-black uppercase tracking-widest flex items-center gap-2 transition-all transform hover:scale-105 active:scale-95 shadow-xl ${
                syncStep >= 3
                  ? 'bg-[#F27D26] text-white hover:bg-[#ff8c3a]' 
                  : 'bg-[#1A1A1A] text-gray-700 border border-[#282828] cursor-not-allowed'
              }`}
            >
              <RefreshCw size={14} className={isProcessing ? 'animate-spin' : ''} />
              Finalize Sync
            </button>
            <button 
              onClick={handleExport}
              className="bg-white text-black px-6 py-2 rounded-full text-[10px] font-black uppercase tracking-widest hover:bg-[#F27D26] hover:text-white transition-all transform hover:scale-105 active:scale-95 shadow-xl"
            >
              Export
            </button>
          </div>
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
                                onClick={() => setProject(p => ({ ...p, assets: p.assets.filter(a => a.id !== asset.id) }))}
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
                  <div className="space-y-6">
                    <div className="space-y-3">
                      <h3 className="text-[11px] font-black uppercase tracking-[0.3em] text-[#F27D26]">Script Context</h3>
                      <div className="p-4 bg-[#0A0A0A] border border-[#1A1A1A] rounded-2xl max-h-40 overflow-y-auto custom-scrollbar text-[11px] font-mono text-gray-500 leading-relaxed">
                        {project.script.split('\n').map((line, idx) => (
                          <div key={idx} className={line.startsWith('[') ? 'text-[#F27D26] mt-2' : ''}>{line}</div>
                        ))}
                      </div>
                    </div>

                    <div className="flex items-center justify-between">
                      <h2 className="text-[11px] font-black uppercase tracking-[0.3em] text-[#F27D26]">Scene Editor</h2>
                      <button 
                        onClick={() => {
                          const newSeg: VideoSegment = {
                            id: crypto.randomUUID(),
                            text: 'New Scene Text',
                            startTime: (() => { const last = project.segments[project.segments.length - 1]; return last ? last.startTime + last.duration : 0; })(),
                            duration: 5,
                            order: project.segments.length,
                            transition: TransitionType.FADE,
                            animation: AnimationType.KEN_BURNS,
                            showOverlay: false,
                            extraOverlays: []
                          };
                          setProject(prev => ({ ...prev, segments: [...prev.segments, newSeg] }));
                        }}
                        className="p-2 bg-[#F27D26]/10 text-[#F27D26] rounded-lg hover:bg-[#F27D26] hover:text-white transition-all flex items-center gap-2 text-[10px] uppercase font-black"
                      >
                        <Plus size={14} /> Add Scene
                      </button>
                    </div>
                    <div className="space-y-4">
                      {project.segments.map((s, idx) => (
                        <div key={s.id} className="p-4 bg-[#0A0A0A] border border-[#1A1A1A] rounded-2xl space-y-4 group hover:border-[#F27D26]/30 transition-all">
                          <div className="flex justify-between items-center">
                            <span className="text-[9px] font-black text-gray-600 uppercase tracking-widest">Scene #{idx + 1}</span>
                            <div className="flex gap-2">
                              <button 
                                onClick={() => setEditingSegment(s)}
                                className="p-1.5 text-gray-700 hover:text-blue-500 transition-colors"
                                title="Expand to Full Edit Mode"
                              >
                                <Maximize size={12} />
                              </button>
                              <button 
                                onClick={() => setProject(p => ({ ...p, segments: p.segments.filter(seg => seg.id !== s.id) }))}
                                className="p-1.5 text-gray-700 hover:text-red-500 transition-colors"
                              >
                                <Trash2 size={12} />
                              </button>
                            </div>
                          </div>
                          
                          <div className="grid grid-cols-2 gap-3">
                            <div className="space-y-1">
                              <label className="text-[7px] uppercase font-bold text-gray-500">Duration (s)</label>
                              <input 
                                type="number"
                                step="0.1"
                                value={s.duration}
                                onChange={(e) => {
                                  const val = parseFloat(e.target.value) || 0.1;
                                  setProject(prev => {
                                    const updated = prev.segments.map((seg, i) => i === idx ? { ...seg, duration: val } : seg);
                                    let acc = 0;
                                    return { ...prev, segments: updated.map(seg => { const start = acc; acc += seg.duration; return { ...seg, startTime: Number(start.toFixed(3)) }; }) };
                                  });
                                }}
                                className="w-full bg-[#121212] border border-[#282828] p-3 rounded-xl text-[10px] font-bold outline-none focus:border-[#F27D26]"
                              />
                            </div>
                            <div className="space-y-1">
                              <label className="text-[7px] uppercase font-bold text-gray-500">Heading</label>
                              <input 
                                placeholder="Scene Heading"
                                value={s.heading || ''}
                                onChange={(e) => updateSegment(idx, { heading: e.target.value })}
                                className="w-full bg-[#121212] border border-[#282828] p-3 rounded-xl text-[10px] font-bold uppercase tracking-widest outline-none focus:border-[#F27D26]"
                              />
                            </div>
                            <div className="col-span-2">
                              <textarea 
                                placeholder="Scene Script Text"
                                value={s.text}
                                onChange={(e) => updateSegment(idx, { text: e.target.value })}
                                className="w-full bg-[#121212] border border-[#282828] p-3 rounded-xl text-[11px] h-20 outline-none focus:border-[#F27D26] resize-none"
                              />
                            </div>
                          </div>

                          <div className="flex items-center gap-4">
                            <div className="flex-1">
                              <select 
                                value={s.assetId || ''}
                                onChange={(e) => updateSegment(idx, { assetId: e.target.value })}
                                className="w-full bg-[#121212] border border-[#282828] p-2 rounded-lg text-[9px] font-bold uppercase tracking-widest outline-none"
                              >
                                <option value="">No Visual Asset</option>
                                {project.assets.filter(a => a.type !== 'audio').map(a => (
                                  <option key={a.id} value={a.id}>{a.name}</option>
                                ))}
                              </select>
                            </div>
                            <button 
                              onClick={() => {
                                setStockTarget(s.id);
                                setShowStockSearch(true);
                              }}
                              className="p-2 bg-blue-500/10 text-blue-500 rounded-lg hover:bg-blue-500 hover:text-white transition-all"
                              title="Search Stock Media"
                            >
                              <Video size={14} />
                            </button>
                             <button 
                                onClick={() => setProject(prev => ({
                                  ...prev,
                                  segments: prev.segments.map((seg, i) =>
                                    i === idx ? { ...seg, showOverlay: !seg.showOverlay, overlayConfig: seg.overlayConfig ?? { ...prev.globalOverlayConfig } } : seg
                                  ),
                                }))}
                                className={`p-2 rounded-lg border transition-all ${s.showOverlay ? 'bg-[#F27D26] border-[#F27D26] text-white' : 'bg-[#121212] border-[#282828] text-gray-500'}`}
                                title="Toggle Main Text Overlay"
                              >
                                <Type size={14} />
                              </button>
                            </div>

                            {s.showOverlay && (
                              <div className="p-3 bg-[#111] rounded-xl border border-[#222] space-y-3">
                                <p className="text-[7px] font-black uppercase tracking-widest text-[#F27D26]">Overlay Styling</p>
                              <div className="grid grid-cols-2 gap-3">
                                  <div className="space-y-1">
                                    <label className="text-[7px] uppercase font-bold text-gray-600">Font Family</label>
                                    <select 
                                      value={s.overlayConfig?.fontFamily || project.globalOverlayConfig.fontFamily}
                                      onChange={(e) => updateSegmentOverlay(idx, { fontFamily: e.target.value })}
                                      className="w-full bg-[#050505] p-1 rounded text-[10px]"
                                    >
                                      {FONT_FAMILIES.map(f => <option key={f} value={f} style={{ fontFamily: f }}>{f}</option>)}
                                    </select>
                                  </div>
                                  <div className="space-y-1">
                                    <label className="text-[7px] uppercase font-bold text-gray-600">Font Size</label>
                                    <input 
                                      type="number" 
                                      value={s.overlayConfig?.fontSize || 60}
                                      onChange={(e) => updateSegmentOverlay(idx, { fontSize: parseInt(e.target.value) })}
                                      className="w-full bg-[#050505] p-1 rounded text-[10px]"
                                    />
                                  </div>
                                  <div className="space-y-1">
                                    <label className="text-[7px] uppercase font-bold text-gray-600">Weight</label>
                                    <select 
                                      value={s.overlayConfig?.fontWeight || 'bold'}
                                      onChange={(e) => updateSegmentOverlay(idx, { fontWeight: e.target.value })}
                                      className="w-full bg-[#050505] p-1 rounded text-[10px]"
                                    >
                                      <option value="normal">Normal</option>
                                      <option value="bold">Bold</option>
                                      <option value="900">Black</option>
                                    </select>
                                  </div>
                                  <div className="space-y-1">
                                    <label className="text-[7px] uppercase font-bold text-gray-600">Style</label>
                                    <div className="flex gap-1">
                                      <button 
                                        onClick={() => updateSegmentOverlay(idx, { fontStyle: s.overlayConfig?.fontStyle === 'italic' ? 'normal' : 'italic' })}
                                        className={`flex-1 text-[7px] p-1 rounded font-bold ${s.overlayConfig?.fontStyle === 'italic' ? 'bg-[#F27D26]' : 'bg-[#050505]'}`}
                                      >IT</button>
                                      <input 
                                        type="color"
                                        value={s.overlayConfig?.color || '#FFFFFF'}
                                        onChange={(e) => updateSegmentOverlay(idx, { color: e.target.value })}
                                        className="flex-1 h-5 bg-transparent"
                                      />
                                    </div>
                                  </div>
                                  <div className="space-y-1 col-span-2">
                                    <label className="text-[7px] uppercase font-bold text-gray-600">Shadow</label>
                                    <div className="flex gap-2">
                                      <button 
                                        onClick={() => updateSegmentOverlay(idx, { textShadow: s.overlayConfig?.textShadow ? '' : '0 4px 15px rgba(0,0,0,1)' })}
                                        className={`flex-1 text-[7px] p-1 rounded font-bold ${s.overlayConfig?.textShadow ? 'bg-[#F27D26]' : 'bg-[#050505]'}`}
                                      >ENABLED</button>
                                      <input 
                                        type="color"
                                        value="#000000"
                                        onChange={(e) => updateSegmentOverlay(idx, { textShadow: `0 4px 15px ${e.target.value}` })}
                                        className="h-5 flex-1 bg-transparent"
                                      />
                                    </div>
                                  </div>
                                  <div className="space-y-1 col-span-2">
                                    <label className="text-[7px] uppercase font-bold text-gray-600">Animation Preset</label>
                                    <select 
                                      value={s.overlayConfig?.animation || 'fade'}
                                      onChange={(e) => updateSegmentOverlay(idx, { animation: e.target.value })}
                                      className="w-full bg-[#050505] p-1 rounded text-[10px] uppercase font-bold"
                                    >
                                      {TEXT_ANIMATIONS.map(a => <option key={a} value={a}>{a.replace('-', ' ')}</option>)}
                                    </select>
                                  </div>
                                </div>
                              </div>
                            )}

                           <div className="grid grid-cols-3 gap-2 pt-2">
                             <button 
                               onClick={() => setProject(prev => ({
                                 ...prev,
                                 segments: prev.segments.map((seg, i) => i === idx ? { ...seg, showOverlay: true, overlayConfig: { ...prev.globalOverlayConfig, color: '#00FF00', backgroundColor: 'rgba(0,0,0,0.8)', fontFamily: 'Bangers', fontSize: 80, textShadow: '0 0 20px #00FF00', animation: 'glitch' } } : seg),
                               }))}
                               className="p-1.5 bg-green-500/10 border border-green-500/20 text-green-500 rounded-lg text-[7px] font-black uppercase tracking-widest hover:bg-green-500 hover:text-white transition-all"
                             >
                               Cyber Bold
                             </button>
                             <button 
                               onClick={() => setProject(prev => ({
                                 ...prev,
                                 segments: prev.segments.map((seg, i) => i === idx ? { ...seg, showOverlay: true, overlayConfig: { ...prev.globalOverlayConfig, color: '#FF00FF', backgroundColor: 'white', fontFamily: 'Monoton', fontSize: 70, textShadow: '0 0 10px #FF00FF', animation: 'neon-flicker' } } : seg),
                               }))}
                               className="p-1.5 bg-pink-500/10 border border-pink-500/20 text-pink-500 rounded-lg text-[7px] font-black uppercase tracking-widest hover:bg-pink-500 hover:text-white transition-all"
                             >
                               Retro Neon
                             </button>
                             <button 
                               onClick={() => setProject(prev => ({
                                 ...prev,
                                 segments: prev.segments.map((seg, i) => i === idx ? { ...seg, showOverlay: true, overlayConfig: { ...prev.globalOverlayConfig, color: 'black', backgroundColor: '#F27D26', fontFamily: 'Anton', fontSize: 90, fontWeight: 900, animation: 'slide-up' } } : seg),
                               }))}
                               className="p-1.5 bg-orange-500/10 border border-orange-500/20 text-[#F27D26] rounded-lg text-[7px] font-black uppercase tracking-widest hover:bg-[#F27D26] hover:text-black transition-all"
                             >
                               Brutal Bold
                             </button>
                          </div>
                          <div className="grid grid-cols-2 gap-3 pt-2">
                             <div className="space-y-1">
                                <label className="text-[7px] uppercase font-bold text-gray-600 flex justify-between">
                                  <span>Playback Speed</span>
                                  <span className="text-[#F27D26]">{s.playbackSpeed?.toFixed(2)}x</span>
                                </label>
                                <input 
                                  type="range" min="0.1" max="3" step="0.1"
                                  value={s.playbackSpeed || 1}
                                  onChange={(e) => updateSegment(idx, { playbackSpeed: parseFloat(e.target.value) })}
                                  className="w-full accent-[#F27D26]"
                                />
                             </div>
                             <div className="space-y-1">
                                <label className="text-[7px] uppercase font-bold text-gray-600 flex justify-between">
                                  <span>Trim Start (s)</span>
                                  <span className="text-blue-400">{s.trimStart?.toFixed(1)}s</span>
                                </label>
                                <input 
                                  type="range" min="0" max={s.sourceDuration || 60} step="0.5"
                                  value={s.trimStart || 0}
                                  onChange={(e) => updateSegment(idx, { trimStart: parseFloat(e.target.value) })}
                                  className="w-full accent-blue-500"
                                />
                             </div>
                          </div>

                          <div className="flex items-center justify-between pt-1">
                             <div className="flex items-center gap-2">
                                <button 
                                  onClick={() => updateSegment(idx, { isMuted: !s.isMuted })}
                                  className={`p-1.5 rounded text-[8px] uppercase font-black tracking-widest flex items-center gap-1 ${s.isMuted ? 'bg-red-500/10 text-red-500' : 'bg-green-500/10 text-green-500'}`}
                                >
                                  {s.isMuted ? <Music size={10} className="line-through" /> : <Music size={10} />}
                                  {s.isMuted ? 'Muted' : 'Audio On'}
                                </button>
                             </div>
                             <button 
                                onClick={() => setProject(prev => ({
                                  ...prev,
                                  segments: prev.segments.map((seg, i) =>
                                    i === idx ? { ...seg, extraOverlays: [...(seg.extraOverlays ?? []), { id: crypto.randomUUID(), text: 'New Text', color: '#FFFFFF', backgroundColor: 'rgba(0,0,0,0.5)', fontFamily: 'Inter', fontSize: 24, position: { x: 50, y: 50 } }] } : seg
                                  ),
                                }))}
                                className="p-1.5 bg-[#1A1A1A] text-gray-500 rounded-lg hover:border-[#F27D26] border border-transparent transition-all flex items-center gap-1 text-[8px] uppercase font-bold"
                              >
                                <Plus size={10} /> Overlay
                              </button>
                            </div>
                          
                          {/* Extra Overlays Editor */}
                          {s.extraOverlays && s.extraOverlays.map((overlay, oIdx) => (
                            <div key={overlay.id} className="p-3 bg-[#050505] border border-[#1A1A1A] rounded-xl space-y-3">
                              <div className="flex justify-between items-center">
                                <span className="text-[8px] font-black text-gray-700 uppercase tracking-widest">Overlay #{oIdx + 1}</span>
                                <button 
                                  onClick={() => updateSegment(idx, { extraOverlays: s.extraOverlays?.filter(o => o.id !== overlay.id) })}
                                  className="text-red-900 hover:text-red-500"
                                >
                                  <Trash2 size={10} />
                                </button>
                              </div>
                              <input 
                                value={overlay.text}
                                onChange={(e) => updateExtraOverlay(idx, oIdx, { text: e.target.value })}
                                className="w-full bg-[#121212] border border-[#282828] p-2 rounded-lg text-[10px] outline-none"
                              />
                              <div className="grid grid-cols-2 gap-2">
                                <div className="space-y-1 col-span-2">
                                  <label className="text-[7px] uppercase font-bold text-gray-600">Font Family</label>
                                  <select 
                                    value={overlay.fontFamily}
                                    onChange={(e) => updateExtraOverlay(idx, oIdx, { fontFamily: e.target.value })}
                                    className="w-full bg-[#121212] border border-[#282828] p-1 rounded-lg text-[10px]"
                                  >
                                    {FONT_FAMILIES.map(f => <option key={f} value={f} style={{ fontFamily: f }}>{f}</option>)}
                                  </select>
                                </div>
                                <div className="space-y-1">
                                  <label className="text-[7px] uppercase font-bold text-gray-600">Text</label>
                                  <input 
                                    type="color"
                                    value={overlay.color}
                                    onChange={(e) => {
                                      const newSegs = [...project.segments];
                                      updateExtraOverlay(idx, oIdx, { color: e.target.value });
                                    }}
                                    className="w-full h-6 bg-transparent"
                                  />
                                </div>
                                <div className="space-y-1">
                                  <label className="text-[7px] uppercase font-bold text-gray-600">Back</label>
                                  <input 
                                    type="color"
                                    value={overlay.backgroundColor}
                                    onChange={(e) => {
                                      const newSegs = [...project.segments];
                                      updateExtraOverlay(idx, oIdx, { backgroundColor: e.target.value });
                                    }}
                                    className="w-full h-6 bg-transparent"
                                  />
                                </div>
                                <div className="space-y-1">
                                  <label className="text-[7px] uppercase font-bold text-gray-600">Size</label>
                                  <input 
                                    type="number"
                                    value={overlay.fontSize}
                                    onChange={(e) => {
                                      const newSegs = [...project.segments];
                                      updateExtraOverlay(idx, oIdx, { fontSize: parseInt(e.target.value) });
                                    }}
                                    className="w-full bg-[#121212] border border-[#282828] p-1 rounded-lg text-[9px]"
                                  />
                                </div>
                                <div className="space-y-1">
                                  <label className="text-[7px] uppercase font-bold text-gray-600">Weight</label>
                                  <select 
                                    value={overlay.fontWeight || 'normal'}
                                    onChange={(e) => {
                                      const newSegs = [...project.segments];
                                      updateExtraOverlay(idx, oIdx, { fontWeight: e.target.value });
                                    }}
                                    className="w-full bg-[#121212] border border-[#282828] p-1 rounded-lg text-[9px]"
                                  >
                                    <option value="normal">Normal</option>
                                    <option value="bold">Bold</option>
                                    <option value="900">Black</option>
                                  </select>
                                </div>
                                <div className="space-y-1">
                                  <label className="text-[7px] uppercase font-bold text-gray-600">Animation</label>
                                  <select 
                                    value={overlay.animation || 'fade'}
                                    onChange={(e) => {
                                      const newSegs = [...project.segments];
                                      updateExtraOverlay(idx, oIdx, { animation: e.target.value });
                                    }}
                                    className="w-full bg-[#121212] border border-[#282828] p-1 rounded-lg text-[8px] uppercase font-bold"
                                  >
                                    {TEXT_ANIMATIONS.map(a => <option key={a} value={a}>{a.replace('-', ' ')}</option>)}
                                  </select>
                                </div>
                                <div className="space-y-1">
                                  <label className="text-[7px] uppercase font-bold text-gray-600">Shadow</label>
                                  <div className="flex gap-1">
                                    <button 
                                      onClick={() => updateExtraOverlay(idx, oIdx, { textShadow: overlay.textShadow ? '' : '0 2px 10px rgba(0,0,0,1)' })}
                                      className={`flex-1 text-[7px] p-1 rounded font-bold ${overlay.textShadow ? 'bg-[#F27D26]' : 'bg-[#121212]'}`}
                                    >SH</button>
                                    <input 
                                      type="color"
                                      value="#000000"
                                      onChange={(e) => updateExtraOverlay(idx, oIdx, { textShadow: `0 2px 10px ${e.target.value}` })}
                                      className="flex-1 h-5 bg-transparent"
                                    />
                                  </div>
                                </div>
                                <div className="space-y-1">
                                  <label className="text-[7px] uppercase font-bold text-gray-600">Align</label>
                                  <div className="flex gap-1">
                                    {['left', 'center', 'right'].map(align => (
                                      <button
                                        key={align}
                                        onClick={() => updateExtraOverlay(idx, oIdx, { textAlign: align as TextOverlay['textAlign'] })}
                                        className={`flex-1 text-[7px] uppercase font-bold p-1 rounded ${
                                          overlay.textAlign === align 
                                            ? 'bg-[#F27D26] text-white' 
                                            : 'bg-[#121212] text-gray-500'
                                        }`}
                                      >
                                        {align.charAt(0).toUpperCase()}
                                      </button>
                                    ))}
                                  </div>
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                      ))}
                    </div>
                  </div>
                )}


                {activeTab === 'settings' && (
                  <div className="space-y-8">
                    <section className="space-y-4">
                      <h3 className="text-[11px] font-black uppercase tracking-[0.3em] text-[#F27D26]">Global Aesthetics</h3>
                      <div className="space-y-2">
                        <label className="text-[9px] uppercase tracking-widest text-gray-600 font-bold block">Project Identity</label>
                        <input 
                          type="text" 
                          value={project.name}
                          onChange={(e) => setProject(p => ({ ...p, name: e.target.value }))}
                          className="w-full bg-[#1A1A1A] border border-[#282828] p-4 rounded-xl text-[12px] font-bold outline-none focus:border-[#F27D26]"
                          placeholder="Project Name"
                        />
                      </div>
                      <div className="space-y-3">
                        <label className="text-[10px] uppercase tracking-widest text-gray-500 font-bold block flex justify-between items-center">
                          Hide On-Screen Text
                          <button 
                            onClick={() => setProject(p => ({ ...p, hideAllText: !p.hideAllText }))}
                            className={`w-10 h-5 rounded-full transition-colors relative ${project.hideAllText ? 'bg-[#F27D26]' : 'bg-[#1A1A1A] border border-[#282828]'}`}
                          >
                            <div className={`absolute top-1 left-1 w-3 h-3 rounded-full bg-white transition-all ${project.hideAllText ? 'translate-x-5' : ''}`} />
                          </button>
                        </label>
                      </div>
                      <div className="space-y-3">
                        <label className="text-[10px] uppercase tracking-widest text-gray-500 font-bold block">Transition Style</label>
                        <select 
                          value={project.globalTransition}
                          onChange={(e) => setProject(p => ({ ...p, globalTransition: e.target.value as any }))}
                          className="w-full bg-[#1A1A1A] border border-[#282828] p-4 rounded-xl text-[11px] uppercase font-bold tracking-widest outline-none focus:border-[#F27D26]"
                        >
                          {Object.values(TransitionType).map(t => <option key={t} value={t}>{t === TransitionType.NONE ? 'instant (none)' : t}</option>)}
                        </select>
                      </div>
                      <div className="space-y-3">
                        <label className="text-[10px] uppercase tracking-widest text-gray-500 font-bold block">Camera Dynamics</label>
                        <select 
                          value={project.globalAnimation}
                          onChange={(e) => setProject(p => ({ ...p, globalAnimation: e.target.value as any }))}
                          className="w-full bg-[#1A1A1A] border border-[#282828] p-4 rounded-xl text-[11px] uppercase font-bold tracking-widest outline-none focus:border-[#F27D26]"
                        >
                          {Object.values(AnimationType).map(a => <option key={a} value={a}>{a === AnimationType.NONE ? 'static (none)' : a.replace('-', ' ')}</option>)}
                        </select>
                      </div>
                      <div className="space-y-3">
                        <label className="text-[10px] uppercase tracking-widest text-gray-500 font-bold block">Aesthetic Overlay Filter (50+ Styles)</label>
                        <select 
                          value={project.globalOverlayFilter || 'none'}
                          onChange={(e) => setProject(p => ({ ...p, globalOverlayFilter: e.target.value }))}
                          className="w-full bg-[#1A1A1A] border border-[#282828] p-4 rounded-xl text-[11px] uppercase font-bold tracking-widest outline-none focus:border-[#F27D26]"
                        >
                          {FILTERS.map(f => <option key={f} value={f}>{f.replace('-', ' ')}</option>)}
                        </select>
                      </div>

                      <div className="space-y-3">
                        <label className="text-[10px] uppercase tracking-widest text-gray-500 font-bold block">Transition Duration (s)</label>
                        <input 
                          type="number"
                          step="0.1"
                          min="0"
                          max="5"
                          value={project.globalTransitionDuration}
                          onChange={(e) => setProject(p => ({ ...p, globalTransitionDuration: parseFloat(e.target.value) || 0 }))}
                          className="w-full bg-[#1A1A1A] border border-[#282828] p-4 rounded-xl text-[11px] font-bold outline-none focus:border-[#F27D26]"
                        />
                      </div>

                  <div className="space-y-4 pt-4">
                        <div className="flex flex-col gap-3">
                           <button 
                             onClick={() => {
                               const newSegs = project.segments.map(s => ({ ...s, transition: project.globalTransition }));
                               setProject(p => ({ ...p, segments: newSegs }));
                             }}
                             className="w-full bg-[#1A1A1A] border border-[#282828] p-3 rounded-xl text-[9px] font-black uppercase tracking-[0.2em] text-[#F27D26] hover:bg-[#F27D26] hover:text-white transition-all flex items-center justify-center gap-2"
                           >
                             <RefreshCw size={12} /> Apply Transition to All Scenes
                           </button>
                           <button 
                             onClick={() => {
                               const newSegs = project.segments.map(s => ({ ...s, animation: project.globalAnimation }));
                               setProject(p => ({ ...p, segments: newSegs }));
                             }}
                             className="w-full bg-[#1A1A1A] border border-[#282828] p-3 rounded-xl text-[9px] font-black uppercase tracking-[0.2em] text-[#F27D26] hover:bg-[#F27D26] hover:text-white transition-all flex items-center justify-center gap-2"
                           >
                             <Sparkles size={12} /> Apply Camera Dynamics to All
                           </button>
                           <button 
                             onClick={() => {
                               const newSegs = project.segments.map(s => ({ ...s, overlayFilter: project.globalOverlayFilter }));
                               setProject(p => ({ ...p, segments: newSegs }));
                             }}
                             className="w-full bg-[#1A1A1A] border border-[#282828] p-3 rounded-xl text-[9px] font-black uppercase tracking-[0.2em] text-[#F27D26] hover:bg-[#F27D26] hover:text-white transition-all flex items-center justify-center gap-2"
                           >
                             <Layers size={12} /> Apply Aesthetic Filter to All
                           </button>
                        </div>
                        <h4 className="text-[10px] uppercase tracking-widest text-gray-600 font-black">Overlay Customization</h4>
                        <div className="grid grid-cols-2 gap-4">
                          <div className="space-y-2">
                             <label className="text-[9px] uppercase tracking-widest text-gray-600 font-bold">Text Color</label>
                             <input 
                                type="color" 
                                value={project.globalOverlayConfig.color}
                                onChange={(e) => setProject(p => ({ ...p, globalOverlayConfig: { ...p.globalOverlayConfig, color: e.target.value } }))}
                                className="w-full h-8 bg-transparent border-none cursor-pointer"
                             />
                          </div>
                          <div className="space-y-2">
                             <label className="text-[9px] uppercase tracking-widest text-gray-600 font-bold">Background Color</label>
                             <input 
                                type="color" 
                                value={project.globalOverlayConfig.backgroundColor}
                                onChange={(e) => setProject(p => ({ ...p, globalOverlayConfig: { ...p.globalOverlayConfig, backgroundColor: e.target.value } }))}
                                className="w-full h-8 bg-transparent border-none cursor-pointer"
                             />
                          </div>
                        </div>
                        <div className="space-y-2">
                          <label className="text-[9px] uppercase tracking-widest text-gray-600 font-bold">Font Family</label>
                             <select 
                                value={project.globalOverlayConfig.fontFamily}
                                onChange={(e) => setProject(p => ({ ...p, globalOverlayConfig: { ...p.globalOverlayConfig, fontFamily: e.target.value } }))}
                                className="w-full bg-[#1A1A1A] border border-[#282828] p-3 rounded-xl text-[10px] font-bold uppercase tracking-widest outline-none"
                             >
                                {FONT_FAMILIES.map(f => <option key={f} value={f} style={{ fontFamily: f }}>{f}</option>)}
                             </select>
                        </div>
                        <div className="flex gap-4 pt-4">
                           <button 
                             onClick={() => {
                               const blob = new Blob([JSON.stringify(project.segments, null, 2)], { type: 'application/json' });
                               const url = URL.createObjectURL(blob);
                               const a = document.createElement('a');
                               a.href = url;
                               a.download = `${project.name.replace(/\s+/g, '_')}_scenes.json`;
                               a.click();
                             }}
                             className="flex-1 bg-[#1A1A1A] border border-[#282828] p-3 rounded-xl text-[10px] uppercase font-bold tracking-widest hover:border-[#F27D26] transition-all"
                           >
                             Export Scenes JSON
                           </button>
                           <label className="flex-1 bg-[#1A1A1A] border border-[#282828] p-3 rounded-xl text-[10px] uppercase font-bold tracking-widest hover:border-[#F27D26] transition-all cursor-pointer text-center">
                             Import Scenes JSON
                             <input type="file" accept=".json" className="hidden" onChange={(e) => handleFileUpload(e, 'story')} />
                           </label>
                        </div>
                      </div>
                    </section>
                  </div>
                )}
              </div>
            </div>
          </div>
                {/* Right Panel: Preview & Sequence */}
          <div className="flex-1 flex flex-col bg-[#020202] relative p-8 gap-8 overflow-hidden">
             {/* Main Stage */}
             <div className="flex-1 flex items-center justify-center">
                <div 
                   className={`relative mx-auto bg-black rounded-[40px] border border-[#1A1A1A] overflow-hidden shadow-2xl group ${isFullscreen ? 'fixed inset-0 z-[5000] !rounded-none !max-w-none !w-screen !h-screen flex items-center justify-center bg-black' : 'transition-all duration-500 ' + (isMidView ? 'aspect-video w-[900px] h-auto' : 'aspect-video max-w-5xl w-full h-auto')}`}
                >
                  {/* Floating Controls */}
                  <div className="absolute top-6 right-6 z-[1001] flex items-center gap-3 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button 
                      onClick={() => setIsMidView(!isMidView)}
                      className={`p-3 bg-black/50 backdrop-blur-md rounded-xl text-white border border-white/10 hover:bg-[#F27D26] transition-all`}
                    >
                      <Layout size={20} />
                    </button>
                    <button 
                      onClick={toggleNativeFullscreen}
                      className={`p-3 bg-black/50 backdrop-blur-md rounded-xl text-white border border-white/10 hover:bg-[#F27D26] transition-all`}
                    >
                      {isFullscreen ? <Minimize size={20} /> : <Maximize size={20} />}
                    </button>
                  </div>

                  <AnimatePresence mode="popLayout" initial={false}>
                     {currentSegment ? (
                       <motion.div 
                         key={currentSegment.id}
                         initial={currentSegment.transition === TransitionType.NONE ? { opacity: 1 } : getMotionProps(currentSegment.transition || project.globalTransition).initial}
                         animate={currentSegment.transition === TransitionType.NONE ? { opacity: 1 } : getMotionProps(currentSegment.transition || project.globalTransition).animate}
                         exit={currentSegment.transition === TransitionType.NONE ? { opacity: 1 } : getMotionProps(currentSegment.transition || project.globalTransition).exit}
                         transition={{ duration: currentSegment.transition === TransitionType.NONE ? 0 : (currentSegment.transitionDuration ?? project.globalTransitionDuration) }}
                         className="absolute inset-0 bg-black"
                       >
                         {/* Visuals */}
                         <div className="absolute inset-0 overflow-hidden">
                           {(() => {
                             const asset = project.assets.find(a => a.id === currentSegment.assetId);
                             if (asset?.url) {
                               if (asset.type === 'video') {
                                 return (
                                   <video 
                                     key={asset.id} 
                                     src={asset.url} 
                                     className="w-full h-full object-cover" 
                                     autoPlay 
                                     muted={currentSegment.isMuted} 
                                     playsInline 
                                     ref={(el) => {
                                       if (el) {
                                         el.playbackRate = (currentSegment.playbackSpeed || 1) * globalPlaybackSpeed;
                                         const segmentProgress = currentTime - currentSegment.startTime;
                                         const videoTime = (currentSegment.trimStart || 0) + (segmentProgress * (currentSegment.playbackSpeed || 1));
                                         if (Math.abs(el.currentTime - videoTime) > 0.1) {
                                           el.currentTime = videoTime;
                                         }
                                       }
                                     }}
                                   />
                                 );
                               }
                               return (
                                 <motion.img 
                                   src={asset.url}
                                   className="w-full h-full object-cover"
                                   initial={{ scale: 1, opacity: 0 }}
                                   animate={{ scale: 1.1, opacity: 1 }}
                                   transition={{ duration: currentSegment.duration, ease: "linear" }}
                                 />
                               );
                             }
                             return (
                               <div className="w-full h-full bg-gradient-to-br from-[#111] to-[#050505] flex items-center justify-center p-20 text-center">
                               </div>
                             );
                           })()}
                         </div>
                         
                         {/* Main Overlays Gradient */}
                         <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-black/40 pointer-events-none" />

                         {/* Extra Overlays Rendering */}
                         {currentSegment.extraOverlays?.map((o) => (
                           <motion.div 
                             key={o.id}
                             {...getMotionProps(o.animation || 'fade')}
                             className="absolute pointer-events-none p-4 rounded-xl shadow-lg border border-white/5"
                             style={{ 
                               left: `${o.position.x}%`, 
                               top: `${o.position.y}%`, 
                               transform: 'translate(-50%, -50%)',
                               color: o.color,
                               backgroundColor: o.backgroundColor,
                               fontFamily: o.fontFamily,
                               fontSize: `${o.fontSize}px`,
                               fontWeight: o.fontWeight || 'normal',
                               fontStyle: o.fontStyle || 'normal',
                               textShadow: o.textShadow || '0 2px 10px rgba(0,0,0,0.5)',
                               textAlign: o.textAlign || 'center',
                               whiteSpace: 'nowrap',
                               zIndex: 40,
                               backdropFilter: 'blur(4px)'
                             }}
                           >
                             {o.text}
                           </motion.div>
                         ))}

                         <div className="absolute inset-0 flex flex-col items-center justify-center p-20 text-center pointer-events-none select-none z-10">
                            {currentSegment.heading && (currentSegment.showOverlay || !project.hideAllText) && (
                              <motion.h3 
                                {...currentSegment.overlayConfig?.animation ? getMotionProps(currentSegment.overlayConfig.animation) : { initial: { opacity: 0, y: -20 }, animate: { opacity: 1, y: 0 } }}
                                className="mb-4 drop-shadow-2xl"
                                style={{ 
                                  fontFamily: currentSegment.overlayConfig?.fontFamily || project.globalOverlayConfig.fontFamily,
                                  color: currentSegment.overlayConfig?.color || project.globalOverlayConfig.color,
                                  fontSize: `${isFullscreen ? 80 : 60}px`,
                                  fontWeight: currentSegment.overlayConfig?.fontWeight || 900,
                                  fontStyle: currentSegment.overlayConfig?.fontStyle || 'normal',
                                  textShadow: currentSegment.overlayConfig?.textShadow || '0 4px 15px rgba(0,0,0,0.5)'
                                }}
                              >
                                {currentSegment.heading}
                              </motion.h3>
                            )}
                            {((!project.hideAllText && currentSegment.text) || (currentSegment.showOverlay && currentSegment.text)) && (
                              <motion.div 
                                initial={{ y: 30, opacity: 0 }}
                                animate={{ y: 0, opacity: 1 }}
                                transition={{ delay: 0.3 }}
                                className="max-w-3xl px-10 py-6 rounded-3xl"
                                style={{ 
                                  backgroundColor: currentSegment.overlayConfig?.backgroundColor || project.globalOverlayConfig.backgroundColor
                                }}
                              >
                                <p 
                                  className="font-light leading-relaxed tracking-wide drop-shadow-md italic"
                                  style={{ 
                                    fontFamily: currentSegment.overlayConfig?.fontFamily || project.globalOverlayConfig.fontFamily,
                                    color: currentSegment.overlayConfig?.color || project.globalOverlayConfig.color,
                                    fontSize: `${isFullscreen ? 32 : 24}px`,
                                    fontWeight: currentSegment.overlayConfig?.fontWeight || 'normal',
                                    fontStyle: currentSegment.overlayConfig?.fontStyle || 'italic'
                                  }}
                                >
                                  &ldquo;{currentSegment.text}&rdquo;
                                </p>
                              </motion.div>
                            )}
                         </div>
                       </motion.div>
                     ) : (
                       <div className="absolute inset-0 flex flex-col items-center justify-center gap-6">
                         <MonitorPlay size={64} className="text-gray-800" strokeWidth={1} />
                         <span className="text-[10px] font-black uppercase tracking-[0.5em] text-gray-600">Sequence Standby</span>
                       </div>
                     )}
                  </AnimatePresence>

                  {/* Corner Stats */}
                 <div className="absolute bottom-10 right-10 flex flex-col items-end gap-2">
                    <div className="bg-black/80 backdrop-blur-md px-4 py-2 rounded-xl border border-white/5 flex items-center gap-3">
                       <span className="text-[10px] font-mono text-[#F27D26]">{currentTime.toFixed(2)}s</span>
                       <div className="w-1.5 h-1.5 rounded-full bg-red-600 animate-pulse" />
                    </div>
                 </div>
               </div>
             </div>

             {/* Professional Sequence Timeline */}
             <div className="h-72 flex flex-col bg-[#050505] rounded-[32px] border border-[#1A1A1A] overflow-hidden shadow-2xl relative">
                 {/* Timeline Toolbar */}
                <div className="px-10 py-4 border-bottom border-[#1A1A1A] flex items-center justify-between bg-[#080808]">
                   <div className="flex items-center gap-8">
                     <div className="flex items-center gap-3">
                        <button 
                          onClick={() => {
                            setCurrentTime(0);
                            if (audioRef.current) audioRef.current.currentTime = 0;
                          }}
                          className="p-2 text-gray-500 hover:text-white transition-colors"
                        >
                          <RotateCcw size={16} />
                        </button>
                        <button 
                         onClick={togglePlay}
                         className="w-12 h-12 bg-[#F27D26] rounded-full text-white flex items-center justify-center hover:scale-105 active:scale-95 transition-all shadow-[0_0_20px_rgba(242,125,38,0.3)]"
                        >
                           {isPlaying ? <Pause size={22} /> : <Play size={22} fill="currentColor" />}
                        </button>
                     </div>
                     <div className="flex flex-col">
                        <span className="text-[9px] font-black uppercase tracking-[0.3em] text-[#F27D26] mb-0.5">Timeline Position</span>
                        <span className="text-lg font-mono text-white tracking-widest">
                          {Math.floor(currentTime / 60).toString().padStart(2, '0')}:
                          {Math.floor(currentTime % 60).toString().padStart(2, '0')}:
                          {Math.floor((currentTime % 1) * 100).toString().padStart(2, '0')}
                        </span>
                     </div>
                   </div>
                   
                   <div className="flex items-center gap-6">
                      <div className="flex items-center gap-3 mr-4">
                        <span className="text-[9px] font-black uppercase tracking-widest text-gray-600">Zoom</span>
                        <input 
                          type="range"
                          min="0.5"
                          max="10"
                          step="0.1"
                          value={zoomLevel}
                          onChange={(e) => setZoomLevel(parseFloat(e.target.value))}
                          className="w-32 h-1 bg-[#1A1A1A] rounded-full appearance-none accent-[#F27D26] cursor-pointer"
                        />
                      </div>
                      <div className="h-8 w-px bg-[#1A1A1A]" />
                      <div className="flex items-center gap-2">
                        <Layers size={14} className="text-gray-600" />
                        <span className="text-[9px] font-bold uppercase tracking-widest text-gray-600">Visuals + Audio Tracks</span>
                      </div>
                      <div className="p-2 bg-[#F27D26]/5 rounded-lg border border-[#F27D26]/10 flex items-center gap-3">
                        <MonitorPlay size={14} className="text-[#F27D26]" />
                        <span className="text-[10px] font-black uppercase tracking-widest text-[#F27D26]">Live Rendering</span>
                      </div>
                   </div>
                </div>

                <div className="flex items-center justify-between px-6 pb-2">
                  <div className="flex items-center gap-2">
                    <RefreshCw size={14} className="text-[#F27D26]" />
                    <span className="text-[10px] font-black uppercase tracking-widest text-[#F27D26]">Timeline Master</span>
                  </div>
                  <div className="flex items-center gap-4">
                    <div className="flex items-center gap-2 bg-[#121212] border border-[#1A1A1A] px-3 py-1.5 rounded-full">
                      <Search size={12} className="text-gray-500" />
                      <span className="text-[9px] font-bold text-gray-500">Horizontal</span>
                      <input 
                        type="range" min="0.1" max="5" step="0.1"
                        value={zoomLevel}
                        onChange={(e) => setZoomLevel(parseFloat(e.target.value))}
                        className="w-24 h-1 bg-[#282828] rounded-lg appearance-none cursor-pointer accent-[#F27D26]"
                      />
                      <span className="text-[9px] font-bold text-gray-500 w-8">{Math.round(zoomLevel * 100)}%</span>
                    </div>
                    <div className="flex items-center gap-2 bg-[#121212] border border-[#1A1A1A] px-3 py-1.5 rounded-full">
                      <Play size={12} className="text-gray-500" />
                      <span className="text-[9px] font-bold text-gray-500">Speed</span>
                      <input 
                        type="range" min="0.5" max="2" step="0.1"
                        value={globalPlaybackSpeed}
                        onChange={(e) => setGlobalPlaybackSpeed(parseFloat(e.target.value))}
                        className="w-24 h-1 bg-[#282828] rounded-lg appearance-none cursor-pointer accent-[#F27D26]"
                      />
                      <span className="text-[9px] font-bold text-gray-500 w-8">{globalPlaybackSpeed.toFixed(1)}x</span>
                    </div>

                    <div className="flex items-center gap-2 bg-[#121212] border border-[#1A1A1A] px-3 py-1.5 rounded-full">
                      <Layout size={12} className="text-gray-500" />
                      <span className="text-[9px] font-bold text-gray-500">Vertical</span>
                      <input 
                        type="range" min="0.5" max="3" step="0.1"
                        value={verticalZoom}
                        onChange={(e) => setVerticalZoom(parseFloat(e.target.value))}
                        className="w-24 h-1 bg-[#282828] rounded-lg appearance-none cursor-pointer accent-[#F27D26]"
                      />
                      <span className="text-[9px] font-bold text-gray-500 w-8">{Math.round(verticalZoom * 100)}%</span>
                    </div>
                  </div>
                </div>

                {/* Timeline Tracks Area */}
                <div 
                  id="timeline-scroll-area"
                  className="flex-1 overflow-x-auto overflow-y-auto custom-scrollbar relative bg-[#030303] flex flex-col p-6 pt-10 cursor-crosshair"
                  onMouseDown={(e) => {
                    const timeline = document.getElementById('timeline-scroll-area');
                    if (timeline && !resizingId) {
                      const rect = timeline.getBoundingClientRect();
                      const x = e.clientX - rect.left + timeline.scrollLeft - 24;
                      const time = Math.max(0, x / (100 * zoomLevel));
                      setCurrentTime(time);
                      if (audioRef.current) audioRef.current.currentTime = time;
                    }
                    if (resizingId) return;
                    const rect = e.currentTarget.getBoundingClientRect();
                    const scrollLeft = e.currentTarget.scrollLeft;
                    const x = e.clientX - rect.left + scrollLeft - 24; // 24 is padding
                    const totalDuration = project.segments.reduce((acc, s) => acc + s.duration, 0) || 1;
                    const pixelsPerSecond = 100 * zoomLevel; 
                    const newTime = Math.max(0, Math.min(totalDuration, x / pixelsPerSecond));
                    setCurrentTime(newTime);
                    if (audioRef.current) audioRef.current.currentTime = newTime;
                    
                    const handleMouseMove = (moveEvent: MouseEvent) => {
                      const moveX = moveEvent.clientX - rect.left + scrollLeft - 24;
                      const moveTime = Math.max(0, Math.min(totalDuration, moveX / pixelsPerSecond));
                      setCurrentTime(moveTime);
                      if (audioRef.current) audioRef.current.currentTime = moveTime;
                    };
                    
                    const handleMouseUp = () => {
                      window.removeEventListener('mousemove', handleMouseMove);
                      window.removeEventListener('mouseup', handleMouseUp);
                    };
                    
                    window.addEventListener('mousemove', handleMouseMove);
                    window.addEventListener('mouseup', handleMouseUp);
                  }}
                >
                   {/* Timeline interaction Logic for Resizing */}
                   {resizingId && (
                     <div 
                       className="fixed inset-0 z-[100] cursor-col-resize"
                       onMouseMove={(e) => {
                         const timeline = document.getElementById('timeline-scroll-area');
                         if (!timeline) return;
                         const rect = timeline.getBoundingClientRect();
                         const x = e.clientX - rect.left + timeline.scrollLeft - 24;
                         const pixelsPerSecond = 100 * zoomLevel;
                         const seg = project.segments.find(s => s.id === resizingId);
                         if (!seg) return;
                         
                         setProject(prev => {
                           const target = prev.segments.find(s => s.id === resizingId);
                           if (!target) return prev;
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
                       onMouseUp={() => {
                         setResizingId(null);
                         setResizingType(null);
                       }}
                     />
                   )}
                   {/* Time Ruler */}
                   <div className="absolute top-4 left-6 right-6 h-4 border-b border-[#1A1A1A] flex items-end">
                      {Array.from({ length: Math.ceil(project.segments.reduce((acc, s) => acc + s.duration, 0) || 30) + 1 }).map((_, i) => (
                        <div key={i} className="flex-shrink-0" style={{ width: `${100 * zoomLevel}px` }}>
                           <div className="h-2 w-px bg-gray-800" />
                           <span className="text-[7px] text-gray-700 absolute -bottom-1 transform -translate-x-1/2 font-mono">{(i * 1).toFixed(1)}s</span>
                        </div>
                      ))}
                   </div>

                   {/* Tracks */}
                   <div className="flex-1 flex gap-2 relative mt-4">
                      {/* Playhead */}
                      <motion.div 
                        className="absolute top-0 bottom-0 w-px bg-[#F27D26] z-50 shadow-[0_0_10px_#F27D26]"
                        style={{ 
                          left: `${currentTime * 100 * zoomLevel}px`,
                          transition: isPlaying ? 'none' : 'left 0.1s linear'
                        }}
                      >
                         <div className="absolute -top-1 -left-1.5 w-3 h-3 bg-[#F27D26] rotate-45" />
                         <div className="absolute top-0 bottom-0 left-0 w-[2px] bg-white opacity-20" />
                      </motion.div>

                      {/* Visual Track */}
                      {!isSynced ? (
                        <div className="flex-1 flex flex-col items-center justify-center text-gray-700 bg-[#080808a0] rounded-3xl border border-[#1A1A1A] border-dashed" style={{ minWidth: '100%' }}>
                           <MonitorPlay size={40} className="mb-4 opacity-20" />
                           <p className="text-[10px] font-black uppercase tracking-[0.4em]">Initialize Project Synchronization</p>
                        </div>
                      ) : (
                        <div className="flex gap-1 h-full items-stretch">
                           {project.segments.map((s, i) => {
                             const asset = project.assets.find(a => a.id === s.assetId);
                             const isActive = currentSegment?.id === s.id;
                              const isMissing = !asset && (s.text || s.heading);
                              
                              return (
                                <div 
                                 key={s.id}
                                 onClick={(e) => {
                                   e.stopPropagation();
                                   setCurrentTime(s.startTime);
                                   if (audioRef.current) audioRef.current.currentTime = s.startTime;
                                 }}
                                 onDoubleClick={(e) => {
                                   e.stopPropagation();
                                   if (trimmingSegmentId === s.id) {
                                     setTrimmingSegmentId(null);
                                     setIsAdjustingTrim(false);
                                   } else {
                                     setTrimmingSegmentId(s.id);
                                     setIsAdjustingTrim(true);
                                   }
                                 }}
                                 onMouseDown={(e) => {
                                   if (isAdjustingTrim && trimmingSegmentId === s.id) {
                                     e.stopPropagation();
                                     const startX = e.clientX;
                                     const startTrim = s.trimStart || 0;
                                     const pixelsPerSecond = 100 * zoomLevel;
                                     
                                     const handleMouseMove = (moveEvent: MouseEvent) => {
                                       const deltaX = moveEvent.clientX - startX;
                                       const deltaTime = deltaX / pixelsPerSecond;
                                       
                                       const maxTrim = Math.max(0, (s.sourceDuration || 60) - s.duration);
                                       const newTrim = Math.max(0, Math.min(maxTrim, startTrim - deltaTime));
                                       
                                       setProject(prev => ({
                                         ...prev,
                                         segments: prev.segments.map(seg => seg.id === s.id ? { ...seg, trimStart: newTrim } : seg),
                                       }));
                                     };
                                     
                                     const handleMouseUp = () => {
                                       window.removeEventListener('mousemove', handleMouseMove);
                                       window.removeEventListener('mouseup', handleMouseUp);
                                     };
                                     
                                     window.addEventListener('mousemove', handleMouseMove);
                                     window.addEventListener('mouseup', handleMouseUp);
                                   } else {
                                      e.stopPropagation();
                                      if (resizingId) return;
                                      setCurrentTime(s.startTime);
                                      if (audioRef.current) audioRef.current.currentTime = s.startTime;
                                   }
                                 }}
                                 style={{ 
                                   width: `${s.duration * 100 * zoomLevel}px`,
                                   height: `${64 * verticalZoom}px`,
                                   opacity: isAdjustingTrim && trimmingSegmentId !== s.id ? 0.3 : 1,
                                   filter: isAdjustingTrim && trimmingSegmentId !== s.id ? 'grayscale(0.5)' : 'none',
                                   transform: isAdjustingTrim && trimmingSegmentId === s.id ? 'scale(1.02)' : 'scale(1)',
                                   boxShadow: isAdjustingTrim && trimmingSegmentId === s.id ? '0 0 30px rgba(242,125,38,0.3)' : 'none',
                                   zIndex: isAdjustingTrim && trimmingSegmentId === s.id ? 50 : (isActive ? 10 : 1)
                                 }}
                                 className={`rounded-lg border transition-all duration-300 cursor-pointer relative flex flex-col group overflow-hidden ${isActive ? 'bg-[#151515] border-[#F27D26]' : 'bg-[#080808] border-[#1A1A1A] hover:bg-[#0C0C0C]'} ${isAdjustingTrim && trimmingSegmentId === s.id ? 'ring-2 ring-[#F27D26] ring-offset-4 ring-offset-black' : ''}`}
                                >
                                 {/* Adjustment Indicator */}
                                 {isAdjustingTrim && trimmingSegmentId === s.id && (
                                   <div className="absolute inset-x-0 top-0 h-4 bg-[#F27D26] flex items-center justify-center z-30">
                                      <span className="text-[7px] font-black uppercase tracking-widest text-black">Drag to Slip Content (Start: {s.trimStart?.toFixed(2)}s)</span>
                                   </div>
                                 )}
                                 {/* Resize Handles */}
                                 <div 
                                   className="absolute left-0 top-0 bottom-0 w-2 cursor-col-resize z-20 hover:bg-[#F27D26]/20 transition-colors"
                                   onMouseDown={(e) => {
                                     e.stopPropagation();
                                     setResizingId(s.id);
                                     setResizingType('start');
                                   }}
                                 />
                                 <div 
                                   className="absolute right-0 top-0 bottom-0 w-2 cursor-col-resize z-20 hover:bg-[#F27D26]/20 transition-colors"
                                   onMouseDown={(e) => {
                                     e.stopPropagation();
                                     setResizingId(s.id);
                                     setResizingType('end');
                                   }}
                                 />
                                  
                                  <div className="flex-1 relative bg-black/50">
                                    {asset?.url ? (
                                      asset.type === 'video' ? (
                                        <video src={asset.url} className={`w-full h-full object-cover opacity-40 ${isActive ? 'opacity-80' : ''}`} />
                                      ) : (
                                        <img src={asset.url} className={`w-full h-full object-cover opacity-30 transition-transform duration-700 ${isActive ? 'scale-110 opacity-70' : 'group-hover:scale-105'}`} />
                                      )
                                    ) : (
                                      <div className="w-full h-full flex items-center justify-center">
                                         <AlertCircle size={14} className={isMissing ? 'text-red-900 animate-pulse' : 'text-gray-900'} />
                                      </div>
                                    )}
                                    
                                    <div className="absolute inset-0 p-2 flex flex-col justify-between pointer-events-none">
                                       <div className="flex justify-between items-start">
                                         <div className="flex flex-col gap-1">
                                            <span className="px-1 py-0.5 bg-black/60 rounded-sm text-[7px] font-mono text-[#F27D26]">#{i+1}</span>
                                            {s.playbackSpeed !== 1 && (
                                              <span className="px-1 py-0.5 bg-[#F27D26]/20 text-[#F27D26] rounded-sm text-[6px] font-mono">
                                                {s.playbackSpeed?.toFixed(2)}x
                                              </span>
                                            )}
                                            {s.trimStart !== undefined && s.trimStart > 0 && (
                                              <span className="px-1 py-0.5 bg-blue-500/20 text-blue-400 rounded-sm text-[6px] font-mono">
                                                Slip: {s.trimStart.toFixed(1)}s
                                              </span>
                                            )}
                                         </div>
                                         <button 
                                           onClick={(e) => {
                                             e.stopPropagation();
                                             setStockTarget(s.id);
                                             setShowStockSearch(true);
                                           }}
                                           className="px-1.5 py-1 bg-blue-500 text-white rounded text-[8px] font-black uppercase pointer-events-auto opacity-0 group-hover:opacity-100 transition-opacity"
                                         >
                                           Change
                                         </button>
                                       </div>
                                       <div className="space-y-0.5">
                                         <p className="text-[8px] font-black text-white/90 uppercase tracking-tight truncate">{s.heading || 'Scene'}</p>
                                         <p className="text-[7px] text-gray-500 font-medium truncate italic">{s.text}</p>
                                       </div>
                                    </div>

                                    {/* Trim visualizer */}
                                    {s.trimStart !== undefined && s.trimStart > 0 && (
                                      <div className="absolute left-0 top-0 bottom-0 w-2 bg-red-500/20 border-r border-red-500/40" />
                                    )}
                                 </div>
                               </div>
                             );
                           })}
                        </div>
                      )}
                   </div>
                   
                   {/* Audio Track with Cuts */}
                   {voiceover && (
                     <div className="mt-2 h-12 bg-[#0A0A0A] border border-[#1A1A1A] rounded-lg relative overflow-hidden flex items-center">
                       <div className="absolute left-0 top-0 bottom-0 w-6 bg-[#F27D26]/10 flex items-center justify-center border-r border-[#F27D26]/20 z-10">
                         <Music size={10} className="text-[#F27D26]" />
                       </div>
                       <div className="flex-1 flex h-full ml-6">
                          {project.segments.map((s) => (
                            <div 
                              key={`vo-${s.id}`}
                              style={{ width: `${s.duration * 100 * zoomLevel}px` }}
                              className="h-full border-r border-[#1A1A1A] relative flex items-center px-2 group"
                            >
                               <div 
                                 className="absolute left-0 top-0 bottom-0 w-1 cursor-col-resize z-20 hover:bg-[#F27D26]/50" 
                                 onMouseDown={(e) => {
                                   e.stopPropagation();
                                   setResizingId(s.id);
                                   setResizingType('start');
                                 }}
                               />
                               <div 
                                 className="absolute right-0 top-0 bottom-0 w-1 cursor-col-resize z-20 hover:bg-[#F27D26]/50" 
                                 onMouseDown={(e) => {
                                   e.stopPropagation();
                                   setResizingId(s.id);
                                   setResizingType('end');
                                 }}
                               />
                               <div className="flex-1 flex items-center gap-0.5 opacity-20 group-hover:opacity-60 transition-opacity">
                                  {Array.from({ length: Math.ceil(s.duration * 5) }).map((_, i) => (
                                    <div key={i} className="w-px bg-[#F27D26]" style={{ height: `${20 + Math.random() * 60}%` }} />
                                  ))}
                               </div>
                               {currentSegment?.id === s.id && (
                                 <div className="absolute inset-0 bg-[#F27D26]/5" />
                               )}
                            </div>
                          ))}
                       </div>
                     </div>
                   )}
                </div>
             </div>
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
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-8">
            <motion.div 
              initial={{ opacity: 0 }} 
              animate={{ opacity: 1 }} 
              exit={{ opacity: 0 }}
              onClick={() => setShowStockSearch(false)}
              className="absolute inset-0 bg-black/90 backdrop-blur-xl"
            />
            <motion.div 
              initial={{ scale: 0.9, y: 20, opacity: 0 }}
              animate={{ scale: 1, y: 0, opacity: 1 }}
              exit={{ scale: 0.9, y: 20, opacity: 0 }}
              className="relative w-full max-w-4xl bg-[#0A0A0A] border border-[#1A1A1A] rounded-[40px] shadow-2xl overflow-hidden flex flex-col h-[80vh]"
            >
              <div className="p-8 border-b border-[#1A1A1A] flex items-center justify-between">
                <div className="flex items-center gap-4">
                  <div className="w-10 h-10 bg-blue-500 rounded-2xl flex items-center justify-center shadow-lg shadow-blue-500/20">
                    <Video size={20} className="text-white" />
                  </div>
                  <div>
                    <h2 className="text-xl font-bold tracking-tight">Stock Library</h2>
                    <p className="text-[10px] text-gray-500 uppercase tracking-widest font-bold">Pexels & Pixabay Integration</p>
                  </div>
                </div>
                <button 
                  onClick={() => setShowStockSearch(false)}
                  className="p-3 hover:bg-[#1A1A1A] rounded-2xl transition-colors text-gray-500 hover:text-white"
                >
                  <Plus size={24} className="rotate-45" />
                </button>
              </div>
              
              <div className="p-8 space-y-8 flex-1 overflow-y-auto custom-scrollbar">
                <div className="relative group">
                  <input 
                    type="text" 
                    value={stockSearchQuery}
                    onChange={(e) => {
                      setStockSearchQuery(e.target.value);
                      setIsStockSearching(true);
                      setTimeout(() => setIsStockSearching(false), 500);
                    }}
                    placeholder="Search high-quality stock footage (e.g. 'abstract technology', 'nature 4k')..."
                    className="w-full bg-[#121212] border border-[#282828] p-6 rounded-[24px] text-lg font-medium outline-none focus:border-blue-500/50 transition-all shadow-inner"
                  />
                  <div className="absolute right-4 top-1/2 -translate-y-1/2 p-3 bg-blue-500 text-white rounded-xl">
                    {isStockSearching ? <RefreshCw size={20} className="animate-spin" /> : <Plus size={20} className="rotate-45" />}
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <button 
                    onClick={() => setStockType('video')}
                    className={`p-4 rounded-2xl border transition-all flex items-center justify-center gap-3 ${stockType === 'video' ? 'bg-blue-500 border-blue-400 font-bold' : 'bg-[#1A1A1A] border-white/5 text-gray-400'}`}
                  >
                    <Video size={18} />
                    Videos
                  </button>
                  <button 
                    onClick={() => setStockType('image')}
                    className={`p-4 rounded-2xl border transition-all flex items-center justify-center gap-3 ${stockType === 'image' ? 'bg-blue-500 border-blue-400 font-bold' : 'bg-[#1A1A1A] border-white/5 text-gray-400'}`}
                  >
                    <ImageIcon size={18} />
                    Images
                  </button>
                </div>

                <div className="grid grid-cols-3 gap-6">
                  {stockResults.length > 0 ? stockResults.map(stock => (
                    <div 
                      key={stock.id} 
                      className="group relative aspect-video rounded-3xl overflow-hidden border border-[#1A1A1A] cursor-pointer hover:border-blue-500 transition-all bg-black"
                      onClick={() => {
                        const newAsset: Asset = {
                          id: crypto.randomUUID(),
                          name: stock.name,
                          url: stock.url,
                          type: stock.type,
                        };
                        setProject(p => ({
                          ...p,
                          assets: [...p.assets, newAsset],
                          segments: p.segments.map(s =>
                            s.id === stockTarget
                              ? { ...s, assetId: newAsset.id, playbackSpeed: 1, trimStart: 0, isMuted: true }
                              : s
                          ),
                        }));
                         setShowStockSearch(false);
                      }}
                    >
                      {stock.type === 'video' ? (
                        <div className="w-full h-full relative">
                          <video 
                            src={stock.url} 
                            className="w-full h-full object-cover opacity-60 group-hover:opacity-100 transition-opacity" 
                            muted 
                            loop 
                            onMouseOver={(e) => (e.target as HTMLVideoElement).play()} 
                            onMouseOut={(e) => { (e.target as HTMLVideoElement).pause(); (e.target as HTMLVideoElement).currentTime = 0; }} 
                          />
                          <div className="absolute top-2 right-2 px-1.5 py-0.5 bg-black/60 rounded text-[8px] font-bold text-white uppercase">{stock.provider}</div>
                        </div>
                      ) : (
                        <div className="w-full h-full relative">
                          <img src={stock.url} className="w-full h-full object-cover opacity-60 group-hover:opacity-100 transition-opacity" />
                          <div className="absolute top-2 right-2 px-1.5 py-0.5 bg-black/60 rounded text-[8px] font-bold text-white uppercase">{stock.provider}</div>
                        </div>
                      )}
                      <div className="absolute inset-0 bg-gradient-to-t from-black/80 to-transparent p-4 flex flex-col justify-end opacity-0 group-hover:opacity-100 transition-opacity">
                        <span className="text-[10px] font-black uppercase tracking-widest text-white">{stock.name}</span>
                        <span className="text-[8px] text-blue-400 font-bold uppercase tracking-wide">Add to Scene</span>
                      </div>
                    </div>
                  )) : (
                    <div className="col-span-3 py-20 text-center space-y-4">
                       <AlertCircle size={32} className="mx-auto text-gray-800" />
                       <p className="text-gray-500 uppercase text-[10px] font-black tracking-widest">No stock media found for "{stockSearchQuery}"</p>
                    </div>
                  )}
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Enhanced Mapping Review Modal (Pre-Sync) */}
      <AnimatePresence>
        {showSyncDetails && (
           <div className="fixed inset-0 z-[110] flex items-center justify-center p-12 bg-black/80 backdrop-blur-md">
             <motion.div 
               initial={{ opacity: 0, scale: 0.95, y: 20 }}
               animate={{ opacity: 1, scale: 1, y: 0 }}
               exit={{ opacity: 0, scale: 0.95, y: 20 }}
               className="w-full max-w-6xl bg-[#080808] border border-[#1A1A1A] rounded-[32px] overflow-hidden flex flex-col max-h-[85vh] shadow-[0_0_50px_rgba(242,125,38,0.2)]"
             >
                 <div className="p-8 border-b border-[#1A1A1A] flex justify-between items-center bg-[#050505]">
                    <div className="flex items-center gap-4">
                       <div className="p-3 bg-[#F27D26]/20 rounded-2xl text-[#F27D26]">
                          <MonitorPlay size={24} />
                       </div>
                       <div>
                          <h2 className="text-xl font-black uppercase tracking-widest text-white">Advanced Sync Review</h2>
                          <p className="text-[10px] text-gray-500 font-bold uppercase tracking-[0.2em]">Map assets to scenes and verify script alignment</p>
                       </div>
                    </div>
                    <button onClick={() => setShowSyncDetails(false)} className="text-gray-500 hover:text-white transition-colors border border-white/5 p-3 rounded-2xl bg-white/5">
                       <X size={24} />
                    </button>
                 </div>

                 <div className="flex-1 overflow-y-auto p-12 space-y-4 custom-scrollbar">
                    {project.sceneDetails.split(/\r?\n\r?\n/).map(l=>l.trim()).filter(l => l !== '').map((block, idx) => {
                      const lines = block.split(/\r?\n/).map(l => l.trim()).filter(l => l !== '');
                      const tag = lines[0] || 'Scene';
                      const desc = lines.slice(1).join(' ');
                      const nameMatch = tag.match(/\[(?:IMAGE|VIDEO|HEADING):\s*(.*?)\s*\]/i) || tag.match(/\[(.*?)\]/);
                      const name = nameMatch?.[1] ?? 'Unknown';
                      
                      // In pre-sync review, we might not have segments yet, so we use logic similar to parseProjectData
                      const matchedAsset = project.assets.find(a => isFuzzyMatch(name, a.name));
                      const asset = matchedAsset || findAssetByContext(desc, project.assets);
                      
                      return (
                        <div key={idx} className="flex gap-8 bg-[#0C0C0C] p-8 rounded-[2rem] border border-white/5 hover:border-[#F27D26]/30 transition-all group items-center">
                           <div className="w-16 h-16 bg-[#1A1A1A] rounded-2xl flex items-center justify-center shrink-0 border border-white/5 group-hover:border-[#F27D26]/20">
                             <span className="text-2xl font-black text-[#F27D26]/40 group-hover:text-[#F27D26]">{idx + 1}</span>
                           </div>

                           <div className="flex-1 space-y-3">
                              <div className="flex items-center gap-3">
                                 <span className="px-3 py-1 bg-[#F27D26]/10 text-[#F27D26] text-[8px] font-black uppercase rounded-full tracking-widest">Scene Logic</span>
                                 <span className="text-[10px] font-mono text-gray-500 truncate max-w-[200px]">{tag}</span>
                              </div>
                              <p className="text-[13px] text-gray-400 font-medium leading-relaxed line-clamp-3 italic">
                                "{desc || 'No script text provided for this scene.'}"
                              </p>
                           </div>

                           <div className="w-[300px] space-y-4">
                              <div className="flex items-center justify-between">
                                  <span className="text-[9px] font-black uppercase tracking-widest text-gray-600">Matched Visual</span>
                                  <button 
                                    onClick={() => {
                                      setStockTarget(`sync-${idx}`);
                                      setShowStockSearch(true);
                                    }}
                                    className="text-[9px] font-black uppercase text-blue-500 hover:text-blue-400"
                                  >Change Asset</button>
                              </div>
                              <div className="aspect-video bg-black rounded-3xl overflow-hidden border border-[#1A1A1A] relative shadow-2xl">
                                 {asset ? (
                                   <>
                                     {asset.type === 'video' ? (
                                       <video src={asset.url} className="w-full h-full object-cover opacity-60" muted autoPlay loop />
                                     ) : (
                                       <img src={asset.url} className="w-full h-full object-cover opacity-60" />
                                     )}
                                     <div className="absolute inset-0 bg-gradient-to-t from-black/80 to-transparent p-4 flex flex-col justify-end">
                                        <p className="text-[10px] font-black text-white uppercase truncate">{asset.name}</p>
                                     </div>
                                   </>
                                 ) : (
                                   <div className="w-full h-full flex flex-col items-center justify-center gap-3 bg-red-500/5 text-red-500/20">
                                      <AlertCircle size={32} />
                                      <span className="text-[9px] font-black uppercase tracking-widest">Unlinked Asset</span>
                                   </div>
                                 )}
                              </div>
                           </div>
                        </div>
                      );
                    })}
                 </div>

                 <div className="p-8 border-t border-[#1A1A1A] bg-[#050505] flex justify-between items-center px-12">
                    <div className="flex flex-col">
                       <span className="text-white text-lg font-black uppercase tracking-widest">Review Complete?</span>
                       <span className="text-[10px] text-gray-500 font-bold uppercase tracking-widest">Everything looks perfectly synced. Ready to finalize.</span>
                    </div>
                    <div className="flex gap-4">
                       <button 
                         onClick={() => setShowSyncDetails(false)}
                         className="px-8 py-4 border border-[#1A1A1A] rounded-2xl text-[10px] uppercase font-black tracking-widest text-gray-500 hover:bg-white/5 transition-all"
                       >
                          Keep Editing
                       </button>
                       <button 
                         onClick={() => { setShowSyncDetails(false); finalizeSync(); }}
                         className="bg-[#F27D26] text-white px-12 py-4 rounded-2xl font-black uppercase tracking-widest hover:scale-105 transition-all shadow-[0_30px_60px_-15px_rgba(242,125,38,0.4)] flex items-center gap-3"
                       >
                          <RefreshCw size={14} /> Finalize Sync
                       </button>
                    </div>
                 </div>
             </motion.div>
           </div>
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
      {/* Sync Details Modal */}
      <AnimatePresence>
        {showSyncDetails && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[2000] flex items-center justify-center p-10 bg-black/90 backdrop-blur-xl"
          >
            <motion.div 
              initial={{ scale: 0.9, y: 20 }}
              animate={{ scale: 1, y: 0 }}
              className="bg-[#0A0A0A] border border-[#1A1A1A] rounded-[40px] w-full max-w-6xl max-h-[85vh] flex flex-col overflow-hidden shadow-2xl"
            >
              <div className="p-8 border-b border-[#1A1A1A] flex items-center justify-between bg-[#0D0D0D]">
                <div>
                  <h2 className="text-[14px] font-black uppercase tracking-[0.5em] text-[#F27D26] mb-1">Mapping Intelligence Review</h2>
                  <p className="text-[10px] text-gray-500 uppercase tracking-widest font-bold">Verify and adjust every visual-audio connection</p>
                </div>
                <button 
                  onClick={() => setShowSyncDetails(false)}
                  className="p-3 bg-[#1A1A1A] rounded-2xl hover:text-red-500 transition-all border border-white/5"
                >
                  <X size={20} />
                </button>
              </div>

              <div className="flex-1 overflow-y-auto p-10 custom-scrollbar">
                <div className="grid gap-6">
                  {project.segments.map((seg, i) => {
                    const asset = project.assets.find(a => a.id === seg.assetId);
                    return (
                      <div key={seg.id} className="group overflow-hidden bg-[#0F0F0F] border border-[#1A1A1A] rounded-3xl flex items-center gap-10 p-6 hover:border-[#F27D26]/30 transition-all">
                        <div className="w-16 h-16 bg-[#1A1A1A] rounded-2xl flex items-center justify-center shrink-0 border border-white/5">
                           <span className="text-2xl font-black text-[#F27D26]">{i + 1}</span>
                        </div>
                        
                        <div className="flex-1 space-y-3">
                          <div className="flex items-center gap-4">
                            <span className="text-[9px] font-black uppercase tracking-widest text-gray-600">Scene Script</span>
                            <div className="h-px flex-1 bg-[#1A1A1A]" />
                          </div>
                          <p className="text-xs font-light text-gray-300 italic leading-relaxed">
                            "{seg.text || '(No script for this scene)'}"
                          </p>
                        </div>

                        <div className="w-80 space-y-4">
                           <div className="flex items-center gap-4">
                            <span className="text-[9px] font-black uppercase tracking-widest text-gray-600">Matched Asset</span>
                            <div className="h-px flex-1 bg-[#1A1A1A]" />
                          </div>
                          <div className="relative group/asset">
                            <select 
                              className="w-full bg-[#1A1A1A] border border-[#282828] p-4 rounded-2xl text-[10px] font-bold uppercase tracking-widest outline-none appearance-none cursor-pointer hover:border-[#F27D26] transition-all"
                              value={seg.assetId || ''}
                              onChange={(e) => {
                                const newAssetId = e.target.value;
                                setProject(prev => {
                                  return { ...prev, segments: prev.segments.map((s, j) => j === i ? { ...s, assetId: newAssetId } : s) };
                                });
                              }}
                            >
                              <option value="">(None)</option>
                              {project.assets.filter(a => a.type !== 'audio').map(a => (
                                <option key={a.id} value={a.id}>{a.name}</option>
                              ))}
                            </select>
                            <div className="absolute inset-0 rounded-2xl pointer-events-none border border-[#F27D26] opacity-0 group-hover/asset:opacity-20 transition-opacity" />
                            <ChevronRight size={14} className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-600 pointer-events-none" />
                          </div>
                        </div>

                        <div className="w-48 h-28 bg-black rounded-2xl overflow-hidden relative border border-[#1A1A1A] shrink-0 group-hover:scale-[1.02] transition-transform">
                          {asset?.url ? (
                            asset.type === 'video' ? (
                              <video src={asset.url} className="w-full h-full object-cover opacity-60" />
                            ) : (
                              <img src={asset.url} className="w-full h-full object-cover opacity-60" />
                            )
                          ) : (
                            <div className="w-full h-full flex items-center justify-center">
                              <AlertCircle size={20} className="text-red-900" />
                            </div>
                          )}
                          <div className="absolute inset-0 bg-[#F27D26]/10 opacity-0 group-hover:opacity-100 transition-opacity" />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              <div className="p-8 bg-[#080808] border-t border-[#1A1A1A] flex items-center justify-between">
                <div className="flex items-center gap-6">
                   <div className="flex flex-col">
                      <span className="text-[10px] font-black uppercase tracking-[0.2em] text-white">Project Density</span>
                      <span className="text-[10px] font-mono text-gray-600">{project.segments.length} Scenes / {voiceover?.name || 'Local Audio'}</span>
                   </div>
                </div>
                <div className="flex gap-4">
                  <button 
                    onClick={() => setShowSyncDetails(false)}
                    className="px-10 py-3 bg-[#1A1A1A] border border-[#282828] rounded-2xl text-[10px] font-black uppercase tracking-[0.3em] hover:bg-white hover:text-black transition-all"
                  >
                    Cancel
                  </button>
                  <button 
                    onClick={() => {
                      setShowSyncDetails(false);
                      setIsSynced(true); // Force re-sync with manual adjustments
                    }}
                    className="px-10 py-3 bg-[#F27D26] text-white rounded-2xl text-[10px] font-black uppercase tracking-[0.3em] hover:bg-[#ff8c3a] shadow-xl hover:scale-105 active:scale-95 transition-all"
                  >
                    Apply Adjustments
                  </button>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
