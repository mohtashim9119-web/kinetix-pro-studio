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

/** Project-level frame shape, locked at creation via NewProjectModal — never
 *  editable after (not exposed in Project Settings). Pixel dimensions are
 *  derived, never stored — see services/resolutionConfig.ts's lookup table. */
export type AspectRatio = '16:9' | '9:16' | '1:1';

/** Project-level resolution tier. Doubles as the export-quality tier
 *  (services/resolutionConfig.ts); dimensions are derived per (AspectRatio,
 *  ResolutionTier) via the same lookup table, never stored directly. */
export type ResolutionTier = '720p' | '1080p';

export interface Asset {
  id: string;
  name: string;
  url: string;
  type: 'image' | 'video' | 'audio';
  file?: File;
  /** Epoch ms captured at upload time (`file.lastModified`) — survives the
   *  localStorage/IndexedDB round-trip that drops `file` itself. */
  addedAt?: number;
  /** Video-only: native frame rate probed from the source file via ffmpeg
   *  (probe_video_fps IPC command) at stage/import time. Undefined when the
   *  asset isn't a video, or when the probe failed (non-fatal — see
   *  resolveVideoNativeFps in App.tsx). Used only to auto-suggest exportFps;
   *  never fed into per-segment retiming. */
  nativeFps?: number;
}

/**
 * Per-segment color-grade values (WebGL2 effects engine, Phase 4). Each field
 * is −1..1 with 0 = neutral, matching the GL compositor's GradeParams
 * (src/services/gl/compositeParams.ts) and the grade shader's uniforms 1:1.
 * Defined here (rather than imported from the gl service) to keep types.ts's
 * dependency direction clean — services depend on types, never the reverse.
 */
export interface SegmentGrade {
  brightness: number;  // -1..1, 0 = neutral
  contrast: number;    // -1..1, 0 = neutral
  saturation: number;  // -1..1, 0 = neutral
  temperature: number; // -1..1, 0 = neutral (+ = warm)
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
  /** Segment ids on which this global layer is hidden. Undefined = visible on all. */
  hiddenOnSegments?: string[];
}

export interface VideoSegment {
  id: string;
  text: string;
  assetId?: string;
  startTime: number;
  duration: number;
  transition: TransitionType;
  animation: AnimationType;
  overlayFilter?: string;
  order: number;
  showOverlay?: boolean;
  overlayConfig?: {
    color: string;
    backgroundColor: string;
    fontFamily: string;
    fontSize?: number;
    fontWeight?: string | number;
    fontStyle?: 'normal' | 'italic';
    textShadow?: string;
    animation?: string;
    x?: number; // percent 0-100, default 50 (center)
    y?: number; // percent 0-100, default 78 (lower-third)
  };
  extraOverlays?: TextOverlay[];
  playbackSpeed?: number;
  transitionDuration?: number;
  trimStart?: number;
  trimEnd?: number;
  locked?: boolean; // true = manual adjustment applied; re-sync skips this segment
  /** Audio timestamp (seconds) where this segment's content begins in the voiceover.
   *  Set by parseProjectData (character-weight) and overwritten by Whisper alignment (t0).
   *  Under clean-slate re-sync this is NOT preserved across re-syncs — every anchor is
   *  re-derived fresh each sync. Internal — not displayed in UI. */
  anchorStart?: number;
  /** How anchorStart was derived. 'whisper' = precise audio-aligned timestamp from
   *  Whisper transcription; 'estimate' = character-weight approximation. Effectively
   *  write-only: no production code branches on this value post-3c. */
  anchorSource?: 'whisper' | 'estimate';
  /** True when this segment came from an EXPLICIT bracket tag whose filename
   *  failed exact asset matching at parse time. Gates off autoMatchSegments'
   *  fuzzy fallback so a tagged-but-unresolved scene stays visibly unmatched
   *  (red missing tile) instead of being wrong-guessed from its spoken text.
   *  Recomputed fresh every Apply Sync; recovery is via re-sync. Internal. */
  unmatchedExplicitTag?: boolean;
  sourceDuration?: number;
  /** Effects Tab Rebuild — slug-valued per-segment effect selections (effectsOptions.ts
   *  values, e.g. 'cross-dissolve', 'ken-burns'). Additive alongside the legacy
   *  enum fields above; carried across Apply Sync by unique-assetId match. */
  effectTransition?: string;
  effectTransitionDuration?: number;
  effectAnimation?: string;
  effectAnimationDuration?: number;
  /** Per-second zoom rate (scale units/sec) for the ZOOM_IN/ZOOM_OUT
   *  effectAnimation slugs — the shared zoomScale.ts model derives the actual
   *  per-frame scale from this + the segment's own `duration`. Distinct from
   *  `effectAnimationDuration` (untouched, legacy). Absent = the render-time
   *  default DEFAULT_ZOOM_SCALE_RATE (0.010); never written to disk until the
   *  user changes it. Carried across Apply Sync by unique-assetId match
   *  alongside the other effect* fields. */
  effectAnimationScaleRate?: number;
  effectOverlay?: string;
  /** Per-segment color grade (WebGL2 Phase 4). Each value −1..1, 0 = neutral;
   *  absent = no grade (neutral). Object-valued (mirrors overlayConfig?) so the
   *  four coupled values stay atomic across apply/persist/carry-across-sync.
   *  Carried across Apply Sync by unique-assetId match alongside the other
   *  effect* fields. */
  effectGrade?: SegmentGrade;
  /** WS-logs skip display — the cleaned scene-doc tag name (no brackets, e.g.
   *  "missing1") parseProjectData matched against assets for this segment.
   *  Undefined for an untagged scene (empty `[]`). Display-only — nothing
   *  downstream branches on it. */
  tag?: string;
}

/**
 * Path B — separate heading layer (docs/history.md ("Path B — Separate Heading Layer — Design Decisions", archived), Decision 1).
 * A top-level overlay, fully independent of VideoSegment — deliberately
 * NOT shared with TextOverlay so heading-only features never touch
 * segment code. `time` is a fixed absolute timestamp that never moves on re-sync
 * (Decision 2); `needsReview` is set (never delete) when a re-sync clamps `time`
 * past the new voiceoverDuration.
 */
export interface HeadingOverlay {
  id: string;
  time: number;
  duration: number;
  text: string;
  fontFamily: string;
  fontSize: number;
  fontWeight: number | string;
  color: string;
  backgroundColor: string;
  x: number;
  y: number;
  needsReview?: boolean;
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
  /** Epoch ms (`file.lastModified`) of the script/scene-details file last
   *  committed via Apply Sync — these have no Asset entry of their own, so the
   *  timestamp is tracked on Project directly instead. */
  scriptUpdatedAt?: number;
  sceneDetailsUpdatedAt?: number;
  segments: VideoSegment[];
  /** Path B heading layer (docs/history.md ("Path B — Separate Heading Layer — Design Decisions", archived)) — the sole
   *  source of truth for headings; VideoSegment carries no heading fields.
   *  Optional at the type level so existing Project literals (dev fixtures, older
   *  persisted projects) remain valid; treat as `[]` when absent (Decision 5). */
  headings?: HeadingOverlay[];
  assets: Asset[];
  voiceoverId?: string;
  lastExportPath?: string;
  lastTranscribedAssetId?: string;
  /** `${file.name}|${file.size}|${file.lastModified}` of the file that produced
   *  transcriptTokens — lets re-staging the same file be recognized even though
   *  every stage event mints a fresh Asset id. See services/syncEngine.ts getFileIdentity. */
  lastTranscribedFileIdentity?: string;
  transcriptTokens?: TranscriptToken[];
  globalTransition: TransitionType;
  globalTransitionDuration: number;
  globalAnimation: AnimationType;
  globalOverlayFilter?: string;
  textLayers?: TextOverlay[];
  globalOverlayConfig: {
    color: string;
    backgroundColor: string;
    fontFamily: string;
  };
  /** True only after the user has explicitly named the project via NewProjectModal.
   *  Unconfirmed projects (blank defaults) are never auto-saved to the registry. */
  confirmed?: boolean;
  /** Locked at project creation via NewProjectModal — never editable after
   *  (not exposed in Project Settings). Undefined on projects created before
   *  this feature; treat as DEFAULT_ASPECT_RATIO ('16:9', services/resolutionConfig.ts) —
   *  the only ratio the app has ever supported. */
  aspectRatio?: AspectRatio;
  /** The project's native resolution TIER — set at creation, editable later
   *  in Project Settings. NOT pixel dimensions: width/height are derived from
   *  (aspectRatio, resolutionTier) via services/resolutionConfig.ts's lookup
   *  table. Undefined on pre-existing projects; treat as DEFAULT_RESOLUTION_TIER
   *  ('1080p') — matches today's hardcoded exportResolution default. */
  resolutionTier?: ResolutionTier;
  /** WS-logs — persistent sync log, newest entries appended at the END. Capped
   *  at MAX_LOG_ENTRIES (services/syncConstants.ts); older entries are pruned
   *  from the front. Undefined on projects saved before WS-logs — treat as []. */
  syncLog?: SyncLogEntry[];
  /** WS-logs — per-run rollups, same append/prune discipline, capped at
   *  MAX_SYNC_RUN_SUMMARIES. Undefined on pre-WS-logs projects — treat as []. */
  syncRunSummaries?: SyncRunSummary[];
}

// ---------------------------------------------------------------------------
// WS-logs — persistent sync log (R4-4). The skip records filterToCoveredSegments
// already produces were in-memory only; these types give them a home ON the
// Project, so they survive an app close/reopen and are visible to anyone who
// opens the project. Persisted by the existing projectStore serializer (Project
// is saved as a unit) — there is deliberately no separate store.
// ---------------------------------------------------------------------------

export type SyncLogEntryType = 'skip' | 'abort' | 'warning' | 'info';

/** One line in the sync log. Entries from a single Apply Sync run share a
 *  `syncRunId`, so the UI can group them without a nested data structure. */
export interface SyncLogEntry {
  id: string;
  /** Date.now() at creation. */
  timestamp: number;
  /** Groups every entry emitted by one Apply Sync run. */
  syncRunId: string;
  type: SyncLogEntryType;
  message: string;
  /** Skip entries only: 0-based index into the PRE-filter (aligned) segments
   *  array, so it still points at the scene the user wrote. */
  segmentIndex?: number;
  /** Skip entries only: the segment's text, truncated for display. */
  segmentText?: string;
  /** Skip entries only: why it was left off the timeline. */
  reason?: string;
  /** Skip entries only: the segment's cleaned scene-doc tag name (no
   *  brackets), if it had one. Undefined on pre-WS-logs-tag entries and on
   *  untagged scenes — both render identically (line omits the tag prefix). */
  segmentTag?: string;
  /** Skip entries only: transcript words matched, from the coverage array at
   *  sync time. Undefined on entries logged before this field existed. */
  matchedWords?: number;
  /** Skip entries only: total scene-doc words for this segment, from the
   *  coverage array at sync time. Undefined on older entries. */
  totalWords?: number;
  /** Skip entries only: matchedWords / totalWords at sync time. Undefined on
   *  older entries. */
  confidence?: number;
}

/** One Apply Sync run, rolled up. Written alongside that run's entries. */
export interface SyncRunSummary {
  syncRunId: string;
  timestamp: number;
  totalSegments: number;
  coveredSegments: number;
  skippedSegments: number;
  aborted: boolean;
  abortReason?: string;
}

export interface ProjectMeta {
  id: string;
  name: string;
  savedAt: number;
  segmentCount: number;
  /** Optional base64 or blob-URL thumbnail captured at save time. */
  thumbnailUrl?: string;
  /** Asset id of the thumbnail source (used to re-derive the URL after reload). */
  thumbnailAssetId?: string;
}

export type TranscriptionStatus =
  | { phase: 'idle' }
  | { phase: 'transcribing'; percent: number; jobId: string }
  | { phase: 'done'; jobId: string }
  // Non-blocking: transcription "succeeded" (exit 0) but produced no usable
  // text, so sync proceeds on estimate timing. Surfaced so a silent decode
  // failure isn't invisible. See useWhisper's empty-token branch.
  | { phase: 'warning'; message: string; jobId: string }
  | { phase: 'error'; message: string; jobId: string };
