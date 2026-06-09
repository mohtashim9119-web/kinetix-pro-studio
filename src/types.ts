/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export enum TransitionType {
  FADE = 'fade',
  SLIDE = 'slide',
  ZOOM = 'zoom',
  NONE = 'none',
  WIPE = 'wipe',
  DISSOLVE = 'dissolve',
  FLIP = 'flip',
  RANDOM = 'random',
  CROSSFADE = 'crossfade',
  GLITCH = 'glitch',
  PIXELATE = 'pixelate',
  SPIRAL = 'spiral',
  WAVE = 'wave',
  SWIRL = 'swirl',
  BLUR = 'blur',
  ZOOM_WIPE = 'zoom-wipe',
  SLIDE_UP = 'slide-up',
  SLIDE_DOWN = 'slide-down',
  CURTAIN = 'curtain',
  DOOR = 'door',
  WINDOW = 'window',
  REVEAL = 'reveal',
  BOUNCE = 'bounce',
  ELASTIC = 'elastic',
  CUBE = 'cube',
  SWAP = 'swap',
  IRIS = 'iris',
  CHECKERBOARD = 'checkerboard',
  STRIPES = 'stripes',
  MOSAIC = 'mosaic',
  VIGNETTE = 'vignette',
  BLOOM = 'bloom',
  VORTEX = 'vortex',
  SHATTER = 'shatter',
  BURN = 'burn',
  FREEZE = 'freeze',
  LIQUIFY = 'liquify',
  COLOR_SHIFT = 'color-shift',
  SCANLINE = 'scanline',
  VHS = 'vhs',
  FILM_STRIP = 'film-strip',
  SMOKE = 'smoke',
  FIRE = 'fire',
  WATER = 'water',
  SNOW = 'snow',
  RAIN = 'rain',
  MATRIX = 'matrix',
  DIGITAL = 'digital',
  ANALOG = 'analog',
  OLD_FILM = 'old-film',
}

export enum AnimationType {
  KEN_BURNS = 'ken-burns',
  ZOOM_IN = 'zoom-in',
  ZOOM_OUT = 'zoom-out',
  SLIDE_LEFT = 'slide-left',
  SLIDE_RIGHT = 'slide-right',
  PAN_UP = 'pan-up',
  PAN_DOWN = 'pan-down',
  ROTATE = 'rotate',
  SHAKE = 'shake',
  FLOAT = 'float',
  PULSE = 'pulse',
  GLITCH = 'glitch',
  NEON_FLICKER = 'neon-flicker',
  BOUNCE = 'bounce',
  TILT = 'tilt',
  SKEW = 'skew',
  HEARTBEAT = 'heartbeat',
  WOBBLE = 'wobble',
  JELLO = 'jello',
  SWING = 'swing',
  NONE = 'none',
  ORBIT = 'orbit',
  SPIN = 'spin',
  SIDE_TO_SIDE = 'side-to-side',
  BOUNCE_IN = 'bounce-in',
  BOUNCE_OUT = 'bounce-out',
  ROLL_IN = 'roll-in',
  ROLL_OUT = 'roll-out',
  FLIP_IN_X = 'flip-in-x',
  FLIP_IN_Y = 'flip-in-y',
  LIGHTSPEED_IN = 'lightspeed-in',
  LIGHTSPEED_OUT = 'lightspeed-out',
  RUBBER_BAND = 'rubber-band',
  TACHADA = 'tachada',
  FLASH = 'flash',
  TADA = 'tada',
  WOBBLE_VERTICAL = 'wobble-vertical',
  SQUISH = 'squish',
  STRETCH = 'stretch',
  BREATHING = 'breathing',
  JELLO_STRETCH = 'jello-stretch',
  ELASTIC_IN = 'elastic-in',
  WAVE = 'wave',
  SWIRL = 'swirl',
  PENDULUM = 'pendulum',
  ROCKING = 'rocking',
  TREMOR = 'tremor',
  QUAKE = 'quake',
  VIBRATION = 'vibration',
  SURGE = 'surge',
}

export interface Asset {
  id: string;
  name: string;
  url: string;
  type: 'image' | 'video' | 'audio';
  file?: File;
}

export interface TextOverlay {
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
}

export interface VideoSegment {
  id: string;
  text: string;
  heading?: string;
  assetId?: string;
  startTime: number;
  duration: number;
  transition: TransitionType;
  animation: AnimationType;
  overlayFilter?: string;
  order: number;
  showOverlay?: boolean;
  customOverlayText?: string;
  overlayConfig?: {
    color: string;
    backgroundColor: string;
    fontFamily: string;
    fontSize?: number;
    fontWeight?: string | number;
    fontStyle?: 'normal' | 'italic';
    textShadow?: string;
    animation?: string;
  };
  extraOverlays?: TextOverlay[];
  playbackSpeed?: number;
  transitionDuration?: number;
  trimStart?: number;
  trimEnd?: number;
  isMuted?: boolean;
  locked?: boolean; // true = manual adjustment applied; re-sync skips this segment
  sourceDuration?: number;
}

export interface TranscriptToken {
  startSec: number;
  endSec: number;
  text: string;
}

export interface Project {
  id: string;
  name: string;
  script: string;
  sceneDetails: string;
  scriptFileName?: string;
  sceneDetailsFileName?: string;
  segments: VideoSegment[];
  assets: Asset[];
  voiceoverId?: string;
  lastExportPath?: string;
  lastTranscribedAssetId?: string;
  transcriptTokens?: TranscriptToken[];
  globalTransition: TransitionType;
  globalTransitionDuration: number;
  globalAnimation: AnimationType;
  globalOverlayFilter?: string;
  hideAllText?: boolean;
  globalOverlayConfig: {
    color: string;
    backgroundColor: string;
    fontFamily: string;
  };
}

export type TranscriptionStatus =
  | { phase: 'idle' }
  | { phase: 'transcribing'; percent: number; jobId: string }
  | { phase: 'done'; jobId: string }
  | { phase: 'error'; message: string; jobId: string };
