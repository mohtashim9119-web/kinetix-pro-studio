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
  /** Video-only: the clip's own length in seconds, probed once at
   *  import/stage time. The single source of truth for "how long is this
   *  clip" — every trim/slip bound and every segment-local→source-time clamp
   *  resolves it from here, through the asset a segment currently points at.
   *  A segment must never cache its own copy: `VideoSegment.sourceDuration`
   *  used to, and went stale the moment a segment was pointed at a different
   *  asset (the drawer's asset dropdown, stock search, and autoMatchSegments
   *  all reassign `assetId` and none of them refreshed it), which let the
   *  slip bar hand out a `trimStart` past the real media and froze the
   *  WebCodecs preview on one frame for the whole segment. Undefined when the
   *  asset isn't a video, or when the probe failed — callers must decline to
   *  guess (hide the trim bar, skip the clamp) rather than fabricate a
   *  length. */
  duration?: number;
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
  transitionDuration?: number;
  trimStart?: number;
  trimEnd?: number;
  locked?: boolean; // true = manual adjustment applied; re-sync skips this segment
  /** Audio timestamp (seconds) where this segment's content begins in the voiceover.
   *  Set by parseProjectData (character-weight) and overwritten by Whisper alignment (t0).
   *  Under clean-slate re-sync this is NOT preserved across re-syncs — every anchor is
   *  re-derived fresh each sync. Internal — not displayed in UI. */
  anchorStart?: number;
  /** How anchorStart was derived. 'forced-alignment' = CTC/wav2vec2 forced-alignment
   *  anchor (R-G, ordered above 'whisper' — demote-only provenance, never inferred from
   *  ordering); 'whisper' = precise audio-aligned timestamp from Whisper transcription;
   *  'estimate' = character-weight approximation. Effectively write-only: no production
   *  code branches on this value post-3c. */
  anchorSource?: 'forced-alignment' | 'whisper' | 'estimate';
  /** True when this segment came from an EXPLICIT bracket tag whose filename
   *  failed exact asset matching at parse time. Gates off autoMatchSegments'
   *  fuzzy fallback so a tagged-but-unresolved scene stays visibly unmatched
   *  (red missing tile) instead of being wrong-guessed from its spoken text.
   *  Recomputed fresh every Apply Sync; recovery is via re-sync. Internal. */
  unmatchedExplicitTag?: boolean;
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
  /** Id of the original NATIVE segment this one is ultimately descended
   *  from — itself for a native segment (set to `id` by parseProjectData on
   *  every parse/re-sync, never carried forward from a stale prior split),
   *  and propagated unchanged to both children on every `S` split
   *  (`segmentSplitDelete.ts`), no matter how many times a piece is split
   *  again. This is what lets `deleteSegment`'s "last remaining slice"/
   *  sibling checks recognise TWO segments as siblings of the same original
   *  even after a CHAINED split has separated them by more than one level —
   *  `parentSegmentId`-style immediate-parent comparison (or parsing it back
   *  out of a slice id) only sees one level up and is fooled by nesting.
   *  Undefined for a segment created before this field existed (an old saved
   *  project, or a dev fixture/script) — callers fall back to walking the
   *  slice-id chain (`segmentSplitDelete.ts`'s `parentIdFromSliceId`) rather
   *  than assume one. */
  rootSegmentId?: string;
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
  /** Forced-alignment per-word confidence (WS1 Task 5 Slice D9), a
   *  probability in [0,1] comparable to `syncConstants.ts`'s `CONF_MIN`.
   *  Optional and additive-only: Whisper-sourced tokens never set it — only
   *  `faBoundaryTypes.ts`'s `faWordSpansToTranscriptTokens` reshape does,
   *  and that reshape has no live caller yet. */
  confidence?: number;
  /** Forced-alignment script-word index (WS1 Task 5 Slice D18) — this
   *  word's 0-based position in the full script word sequence
   *  (`faAnchors.ts`'s `FaAnchor.qi` space). The join key back to the
   *  script; TIME IS NOT — see `docs/work-in-progress.md` §4's word-timing-
   *  schema row (original source `d18-index-trace-2026-08-14.md` was
   *  deleted 2026-08-14, `9cf5867`; retrieve: `git show
   *  251be64:docs/ws1-sync-pipeline/d18-index-trace-2026-08-14.md`).
   *  Optional and additive-only, same
   *  convention as `confidence`: Whisper-sourced tokens never set it. */
  wordIndex?: number;
  /** R.7 confidence fallback (WS1 Task 5 Slice D19): `true` when this
   *  word's `confidence` is below `syncConstants.ts`'s `CONF_MIN`. The
   *  word's own `startSec`/`endSec` are the real FA-measured values even
   *  when this is `true` — nothing is dropped or substituted, this is only
   *  a signal for a consumer to filter or highlight on, mirroring
   *  `HeadingOverlay.needsReview`'s convention above. Optional and
   *  additive-only, same convention as `confidence`/`wordIndex`:
   *  Whisper-sourced tokens never set it. */
  needsReview?: boolean;
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
  /** Multilingual production support (Phase 2a, docs/sync-pipeline-v2-plan.md
   *  H.1/H.7) — a whisper language code (e.g. `'en'`, `'es'`). Undefined until
   *  EITHER a transcription runs with no stored language yet (whisper-cli's
   *  `-l auto` detection result is written here — see useWhisper.ts) OR the
   *  user sets an explicit override in Project Settings. Once set by either
   *  path it is STICKY: a later transcription passes it straight through
   *  (skipping re-detection) and never overwrites it — "detection is a
   *  suggestion, not a fact" (H.7) means it's always user-editable afterward,
   *  not that it's silently re-guessed on every run. Undefined on projects
   *  persisted before this field existed and on every pre-Phase-2a project
   *  until its next transcription or an explicit Settings edit; the SUPPORTED
   *  set is English/Spanish/French/Portuguese/German (constants.ts's
   *  SUPPORTED_LANGUAGES) — anything else is accepted (an explicit override
   *  is never blocked) but produces the H.4 guard's 'unsupported-language'
   *  log entry + banner, since whitespace word-splitting and normalization
   *  are only verified for the supported five. */
  language?: string;
  /** WS1 Session M — the language Whisper actually DETECTED for the current
   *  transcript, recorded verbatim from every `-l auto` run (useWhisper.ts),
   *  UNCONDITIONALLY and independently of the sticky `language` field above.
   *
   *  WHY IT IS SEPARATE FROM `language`. `language` is the user's sticky choice
   *  and is only ever written when it was previously unset (H.7). That makes it
   *  an unreliable input for the FA gate on the auto path: a project can carry a
   *  cached transcript whose detected language never made it into `language`
   *  (a pre-Session-M transcript, a detection that didn't persist), leaving the
   *  gate to read `undefined` and fall back with 'unsupported-language' AFTER
   *  the sync — the exact "the information exists and is being thrown away"
   *  failure Session M closes. This field is that information, kept durable and
   *  never conflated with the user's choice, so `resolveFaLanguage` (faGate.ts)
   *  can feed it to the FA gate when `language` is absent. Overwritten by each
   *  new detection (the transcript it describes is what's current); never
   *  overwritten with `undefined` (an explicit-language run detects nothing and
   *  must not erase a prior detection). Undefined until the first `-l auto`
   *  transcription; not a user-editable field. */
  detectedLanguage?: string;
  /** WS1 Session G (owner ruling R-AK) — PER-PROJECT high-precision sync
   *  (forced alignment) switch, replacing the former per-MACHINE global
   *  `uiStateStore` key. Three states, and the distinction matters:
   *  `true` = the user explicitly turned FA ON for this project;
   *  `false` = the user explicitly turned it OFF for this project;
   *  `undefined` = the user has expressed no preference for this project.
   *
   *  UNDEFINED MEANS "resolve the default at READ time" — and this comment
   *  deliberately does NOT say what that default currently is. The single
   *  source of truth is `faGate.ts`'s `FA_PROJECT_DEFAULT_ON`, read through
   *  `isFaEnabledForProject`. This wording is itself a fix (WS1 Session J):
   *  the comment used to assert that an absent field meant enabled, and it
   *  went stale the moment Session H flipped the constant back, so for two
   *  sessions the type file and the gate disagreed in prose. Restating a
   *  value in a second place is what created that drift; naming the owner
   *  instead is what removes it. `faDefaultDrift.test.ts` now fails the build
   *  if any comment anywhere in `src/` asserts a literal value for this
   *  default that disagrees with the constant.
   *
   *  The resolved default is NEVER written back on load, on Apply Sync, or by
   *  any migration, so "no preference" stays "no preference" for the life of
   *  the project and a future default change still reaches it. The ONLY
   *  writer is Project Settings' own Save, and only when the user actually
   *  moved the control (ProjectSettingsModal.tsx) — an explicit choice can
   *  therefore never be silently overwritten.
   *
   *  Undefined on every project persisted before this field existed; those
   *  load byte-identically and are never rewritten (the G1 load-path proof
   *  in faGate.test.ts). Note this is only ONE of the conditions FA needs:
   *  the runtime must also be Tauri-capable (`isFaCapable`) and the
   *  project's `language` must be one of the 5 FA-supported codes
   *  (`forcedAlignmentRun.ts`'s FA_SUPPORTED_LANGUAGES), so a project that
   *  never set a language never engages FA regardless of this field. */
  faHighPrecisionSync?: boolean;
  /** WS-logs — persistent sync log, newest entries appended at the END. Capped
   *  at MAX_LOG_ENTRIES (services/syncConstants.ts); older entries are pruned
   *  from the front. Undefined on projects saved before WS-logs — treat as []. */
  syncLog?: SyncLogEntry[];
  /** WS-logs — per-run rollups, same append/prune discipline, capped at
   *  MAX_SYNC_RUN_SUMMARIES. Undefined on pre-WS-logs projects — treat as []. */
  syncRunSummaries?: SyncRunSummary[];
  /** Persisted forced-alignment word-level timings (WS1 Task 5 Slice D18,
   *  owner ruling D1 — "full word-level timings, persisted in project
   *  data"). Reuses `TranscriptToken`'s shape rather than a parallel type:
   *  every entry an FA production writer produces has `wordIndex` set (the
   *  join key back to the script's own word sequence — see `wordIndex`'s
   *  own doc comment on why time is not a safe substitute) and, unlike
   *  `Project.transcriptTokens` (Whisper's own output), `confidence` set on
   *  every entry too.
   *
   *  SCHEMA ONLY THIS SLICE — no production writer populates this field yet
   *  (R.2/R.5/R.7 and any real per-word UI are unbuilt), and no `version`
   *  concept exists on `Project` to migrate through: an absent field is
   *  read as "no FA word timings," the same convention every other optional
   *  `Project` field here already uses (see `headings`, `resolutionTier`).
   *  Undefined on every project until whichever later slice adds the first
   *  real writer. */
  faWordTimings?: TranscriptToken[];
  /** WS2 T4.1 Step 2 — what THIS project's freshly minted segments start their
   *  `showOverlay` at, seeded ONCE at creation from App Settings' New Project
   *  Defaults (`services/appDefaults.ts`) and never re-read from that global
   *  afterwards.
   *
   *  WHY IT IS STORED HERE RATHER THAN READ FROM APP SETTINGS AT SYNC TIME.
   *  `parseProjectData` runs on every Apply Sync, for any project, at any time.
   *  Reading the live machine-global default there would let a preference the
   *  user changed today silently re-style a project created months ago on its
   *  next re-sync — the exact "a global reaches backward into existing work"
   *  failure that made the old per-machine FA toggle unshippable (WS1 Session
   *  F, finding F6). A New Project Default is a SEED; a seed that keeps
   *  applying is not a seed.
   *
   *  Absent means "no divergence from the built-in `false`" and is never
   *  written back — `handleNewProjectConfirm` stores it only when the user's
   *  default actually differs, matching `faHighPrecisionSync`'s discipline.
   *  Undefined on every project created before this field existed. */
  defaultTextOverlay?: boolean;
}

// ---------------------------------------------------------------------------
// WS-logs — persistent sync log (R4-4). The skip records filterToCoveredSegments
// already produces were in-memory only; these types give them a home ON the
// Project, so they survive an app close/reopen and are visible to anyone who
// opens the project. Persisted by the existing projectStore serializer (Project
// is saved as a unit) — there is deliberately no separate store.
// ---------------------------------------------------------------------------

/**
 * The log line's kind. This IS the discriminator — WS4's new entry kinds are
 * added here rather than as a second `kind` field, so there is exactly one
 * thing to switch on and SyncLogPanel's TYPE_STYLES table stays exhaustive
 * (a new kind is a compile error there, not an unstyled badge at runtime).
 *
 *  - 'silence-error'   WS4 Feature 3 — silence detection failed; sync continued
 *                      on token-midpoint boundaries. Red: a real degradation.
 *  - 'malformed-token' WS4 Feature 4 — whisper tokens with unusable timestamps
 *                      were filtered out before alignment. Info, not error:
 *                      they were handled, and sync proceeded normally.
 *  - 'rescue'          Rescue observability (false-positive rescue fix,
 *                      2026-07-31) — a segment's per-segment temporal-bounding
 *                      rescue (whisperService.ts) recovered it after the
 *                      global pass gave it zero matches. Informational, not
 *                      error: this is the SAME rescue mechanism that has
 *                      always existed (WS6) surfaced for the first time,
 *                      not a new failure mode — it lets a user distinguish a
 *                      legitimate anchor-drift recovery from one that landed
 *                      far from the segment's expected position.
 *  - 'unsupported-language' Phase 2a, H.4 guard — the project's detected or
 *                      user-set language (Project.language) is outside the
 *                      five supported languages (constants.ts's
 *                      SUPPORTED_LANGUAGES). Error, not warning: whitespace
 *                      word-splitting and normalization are only verified for
 *                      the supported five, so sync accuracy on anything else
 *                      is unguaranteed, not merely degraded. Always carries
 *                      severity:'error' and a plain-language fixHint; also
 *                      drives a persistent banner (App.tsx) — see Contract
 *                      OUT's required-additions table, docs/sync-pipeline-v2-plan.md.
 */
export type SyncLogEntryType =
  | 'skip'
  | 'abort'
  | 'warning'
  | 'info'
  | 'silence-error'
  | 'malformed-token'
  | 'no-asset'
  | 'rescue'
  | 'unsupported-language'
  | 'lock-span-overflow'
  | 'lock-preserved-adjustment'
  /** 'lock-refused' — Model P ruling §4.1(a) (2026-08-07). A lock toggle was
   *  REFUSED because granting it would have made the gapless invariant
   *  unsatisfiable: it would have produced two ADJACENT locked segments with
   *  space between them, which nothing is permitted to absorb (both are
   *  immovable by definition). severity:'warning', with a fixHint naming the
   *  conflicting segment. Unlike every other entry here this one records an
   *  action the app DECLINED to take, so the segment's `locked` flag is
   *  unchanged when it appears. See services/timelinePartition.ts's
   *  `canLockSegment`. */
  | 'lock-refused'
  /** 'lock-not-restored' — K13 fix. A segment that was locked BEFORE this
   *  Apply Sync could not carry its lock forward into the freshly-synced
   *  timeline, either because it could not be matched to a segment in the
   *  new array (no assetId, or an ambiguous assetId shared by more than one
   *  segment on either side) or because its saved position no longer fits
   *  the new timeline (past the new audio's end, or conflicting with a
   *  neighbour). severity:'warning', with a fixHint telling the user to
   *  re-lock the scene. A locked scene the user simply deleted is NOT
   *  reported here — that drop is silent by design. See App.tsx's
   *  `preserveSegmentLocks`. */
  | 'lock-not-restored'
  /** 'rule-correction' — WS1 Session J. ONE post-inference rule fired on ONE
   *  scene: R.5 (unscripted-audio excision), R.10 (scripted text never
   *  spoken), R.11 (chunk-fit boundary correction), R.12 (the atomic-run
   *  invariant, opening edge) or R.13 (the atomic-utterance invariant, its
   *  closing edge). Always carries `owningRule`; carries `segmentIndex` as a
   *  COMMITTED index whenever the scene is on the timeline (R.5's is derived
   *  from the excised span's containing segment — see
   *  `buildUnscriptedRunLogEntries`) and omits it when the scene is not
   *  (R.10); carries `ruleDetail` with the value the
   *  run would have committed WITHOUT the rule and the value it committed
   *  instead, so a reader can check the correction rather than trust it.
   *
   *  Before this existed, a rule firing was a `console.warn` in a dev build
   *  and nothing else: not in `project.syncLog`, not in the Sync Log panel,
   *  not in the Copy export, and gone when the window closed. The live
   *  acceptance run's whole purpose is recording what the rules did, so a run
   *  that leaves no durable evidence of it cannot be the run that accepts it.
   *
   *  severity:'info', deliberately. A rule firing is the pipeline WORKING —
   *  a correction that landed, not a degradation the user should act on. The
   *  severity taxonomy reserves 'warning' for "the user should do something",
   *  and there is nothing for them to do here. */
  | 'rule-correction'
  /** 'fa-fallback' — WS1 Session J. The FA gate was OPEN for this project and
   *  forced alignment did NOT produce the timing: the run committed on Whisper
   *  tokens instead. Carries `reason` (which of the failure paths fired) and,
   *  where the failure came back from the IPC layer, `errorMessage`.
   *
   *  THIS IS THE SPECIFIC HOLE IT CLOSES. `runForcedAlignmentForSync` is
   *  fail-clean by contract — every failure returns rather than throwing, and
   *  the sync proceeds. That is correct behaviour and stays. But it made a run
   *  where FA silently failed INDISTINGUISHABLE, in the log, from a run where
   *  FA succeeded: the user got Whisper timing while believing they had
   *  forced-alignment timing, and no persisted artifact disagreed. Fail-clean
   *  must not mean fail-silent.
   *
   *  severity:'warning', unlike 'rule-correction': the user asked for
   *  high-precision sync in Project Settings and did not get it, and the
   *  fixHint names what to check. */
  | 'fa-fallback'
  /** 'fa-preflight' — WS1 Session M. Emitted ONCE per Apply Sync when the FA
   *  gate is OPEN, BEFORE inference runs, recording whether forced alignment is
   *  actually ready: runtime library load, model presence, and the resolved
   *  language. It answers, up front and cheaply, the question the FA-fallback
   *  entry used to answer only AFTER several minutes of Whisper work — so a run
   *  that is going to fall back is visible as such before it starts.
   *
   *  severity:'info' when ready (the pipeline is set up correctly — nothing to
   *  do); severity:'warning' when NOT ready, with `errorMessage` carrying the
   *  first blocking cause (verbatim runtime/model detail) and `fixHint` the
   *  action. A gate-closed run emits no pre-flight entry at all — there is
   *  nothing to be ready for. */
  | 'fa-preflight'
  /** 'fa-gate-closed' — WS2 Step 3 A5 (bug 2 visibility fix). Emitted ONCE per
   *  Apply Sync when the FA gate is CLOSED (`isFaGateOpenForProject` false)
   *  and the project is otherwise FA-capable (desktop runtime present) — i.e.
   *  exactly the case that used to produce no signal at all, because
   *  `App.tsx` only ran the pre-flight/logged anything `if (faGateOpen)`.
   *  `FA_PROJECT_DEFAULT_ON` stays false; this is visibility only, not a
   *  behavior change. severity:'info' — nothing is wrong, the user just may
   *  not know the option exists. Never emitted when `isFaCapable()` is false
   *  (plain browser dev server) — there is nothing to turn on there either. */
  | 'fa-gate-closed';

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
  /** TWO conventions, one per entry kind, both stated here because assuming
   *  they were the same is what produced the WS1 Session K defect.
   *
   *   - 'skip' entries: 0-based index into the PRE-filter (parse) segments
   *     array — the scene the user wrote. A skipped scene has no committed
   *     index by definition, so this is the only index it can carry, and
   *     `SyncLogPanel` renders it as "Segment N skipped", never as "Scene N".
   *
   *   - 'rule-correction' entries: 0-based index into the COMMITTED array —
   *     the scene number the timeline shows and the user can navigate to.
   *     ABSENT when the rule's subject is not on the timeline (R.10 drops its
   *     scenes); the message names the scene by tag in that case.
   *
   *  WS1 Session J widened this field from "skip entries only" and recorded
   *  that "every rule detector already returns a `segmentIndex` on this same
   *  PRE-filter convention". THAT CLAIM WAS FALSE and was never checked
   *  against the code: `UnspokenScriptFinding` and `SeamFitFinding` are
   *  parse-indexed, `RunPlacementFinding` and `UtterancePlacementFinding` are
   *  committed-indexed. Both were rendered as "Scene N + 1", so on 173 —
   *  the only corpus where a scene is dropped — R.11 named `abysmal_opinion`
   *  "scene 6" for a scene the timeline shows as scene 5.
   *
   *  The conversion now happens in exactly one place, `syncLog.ts`'s
   *  `committedIndexOf`, resolving by segment id; no builder may copy a
   *  detector's own `segmentIndex` onto an entry. `syncLog.indexConvention.test.ts`
   *  fails the build if one does. */
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
  /** Skip entries only (Bug C, consecutive-run survival requirement,
   *  2026-08-02): the longest qualifying-shape run found for this segment at
   *  sync time — see whisperService.ts's AlignResult.longestRun. Undefined on
   *  entries logged before this field existed, same optionality convention as
   *  matchedWords/totalWords/confidence above. */
  longestRun?: number;
  /** 'silence-error' entries only (WS4 Feature 3): what the silence detector
   *  reported. Undefined on every other kind. */
  errorMessage?: string;
  /** 'malformed-token' entries only (WS4 Feature 4): how many transcript
   *  tokens were dropped before alignment. */
  skippedTokenCount?: number;
  /** 'malformed-token' entries only: the pre-filter token count — the
   *  denominator for skippedTokenCount. */
  totalTokenCount?: number;
  /** Pipeline Contract Program (docs/sync-pipeline-contract-plan.md §4) —
   *  additive severity axis, orthogonal to `type`. Undefined on every entry
   *  logged before this field existed; §4 documents a default-severity
   *  mapping from `type` for rendering those. Only entries built from a
   *  contract validator's `ContractViolation` set this today. */
  severity?: 'info' | 'warning' | 'error';
  /** Pipeline Contract Program (§4): "every WARNING and every ERROR carries
   *  a user-facing fix hint" — something the USER can do, not a developer
   *  pointer. Undefined on entries with no `severity` and on INFO entries. */
  fixHint?: string;
  /** Grouped-violation entries only (user-requested log grouping, 2026-08-03)
   *  — when 2+ `ContractViolation`s of the same `rule` land in one sync run,
   *  `syncLog.ts`'s `buildGroupedViolationEntry` folds them into ONE entry
   *  (`message` holds the summary form, e.g. "4 scenes matched fewer than
   *  60% of their words.") instead of one entry per violation, with each
   *  violation's own message/fixHint/detail preserved here verbatim so the
   *  panel's expand affordance — and the Copy button's export — can still
   *  show every item. Undefined on every other entry, including a SINGLE
   *  violation (which still renders as a plain, non-grouped entry — see
   *  `buildGroupedViolationEntry`'s own doc comment). Deliberately its own
   *  minimal shape rather than importing `ContractViolation` from
   *  `syncContracts.ts`, which would create a type-level import cycle with
   *  this file. */
  groupedItems?: GroupedLogItem[];
  /** WS1 Session J — WHICH RULE OWNS THIS ENTRY. `'R.5' | 'R.10' | 'R.11' |
   *  'R.12'` today; also set on 'fa-fallback' entries, where it names the FA
   *  entry point (`'FA'`) rather than a post-inference rule.
   *
   *  Deliberately a WIDENED `string`, not a union, and the reason is concrete:
   *  this workstream has added four rules in five sessions, and a union would
   *  make each new rule a type edit in a file that has nothing to do with the
   *  rule. The values are documented here and asserted in `syncLog.test.ts`;
   *  a typo produces a wrong log line, never a wrong boundary.
   *
   *  It is a FIELD and not a prefix baked into `message` on purpose. A rule
   *  name inside a message string cannot be filtered, grouped, or counted
   *  without parsing prose back out of it, and the one question the live
   *  acceptance run must answer is "which rules fired, on which segments" —
   *  which is a query, not a sentence. Undefined on every entry that no rule
   *  owns, which is all of them before this session. */
  owningRule?: string;
  /** WS1 Session J — the numbers behind a 'rule-correction' entry, so a log
   *  reader can CHECK the correction instead of trusting it.
   *
   *  Every field is transcribed from the detector's own finding at the call
   *  site; nothing here is re-measured or re-derived (see `syncLog.ts`'s
   *  builders). Undefined on non-rule entries. */
  ruleDetail?: {
    /** Point-valued corrections (R.11, R.12): the boundary the run would have
     *  committed WITHOUT this rule. Absent on R.5 (which acts on a span before
     *  inference, not on a committed point) and on R.10 (which drops a scene
     *  rather than moving a boundary). */
    committedValue?: number;
    /** Point-valued corrections: the boundary it committed instead. */
    correctedValue?: number;
    /** Span-valued findings (R.5's excised unscripted runs): the audio span
     *  the finding concerns. Kept separate from committed/corrected rather
     *  than overloaded onto them — an excised span is not a "value that
     *  moved", and naming it as one would misreport what R.5 does. */
    spanStartSec?: number;
    spanEndSec?: number;
    /** Always present: why this rule fired on this scene, in the detector's
     *  own terms (the fit deviation, the confidence, the run index). */
    reason: string;
  };
  /** WS2 T2.1 (gap-absorption revision) — the stable content-derived id
   *  (segmentId.ts) of the committed segment this entry is about, when the
   *  entry concerns one specific segment (e.g. the neighbour that absorbed a
   *  dropped scene's gap). Undefined on entries with no single owning
   *  segment. Lets a click deep-link the playhead straight to it
   *  (`onSeekToSegment`, SyncLogPanel's "Jump to absorbing scene"). */
  segmentId?: string;
  /** WS2 ws2-25 Commit 5 — skip entries only, when the drop is absorbed: the
   *  ABSORBING NEIGHBOUR's own 0-based position in the FINAL committed array
   *  — the number the Timeline actually renders for that clip (`#{i+1}`,
   *  Timeline.tsx's own segment-card index over `project.segments`).
   *
   *  Named distinctly from `segmentIndex` (the DROPPED scene's own PRE-FILTER
   *  script position — a different numbering space) precisely so a reader
   *  never conflates the two, the confusion this field exists to end: see
   *  `buildSkipLogEntries`'s "S{n} / Clip {n}" message format. */
  absorbedByDisplayIndex?: number;
}

/** One violation's worth of detail inside a grouped `SyncLogEntry` — a
 *  minimal mirror of `syncContracts.ts`'s `ContractViolation` (message/
 *  fixHint/detail only; `contract`/`rule`/`severity` are the grouping key
 *  and already summarized on the parent entry, so they aren't repeated per
 *  item). See `SyncLogEntry.groupedItems`. */
export interface GroupedLogItem {
  message: string;
  fixHint?: string;
  detail?: Record<string, unknown>;
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
  /** WS4 Feature 3 — how many silence-detection failures this run hit (0 or 1
   *  today: silence is detected once per run). Optional because summaries
   *  persisted before WS4 genuinely do not have it — treat undefined as 0,
   *  same convention as SyncLogEntry's later-added fields above. */
  silenceErrorCount?: number;
  /** How many committed segments in this run have no matched asset. Optional
   *  because summaries persisted before this feature genuinely do not have
   *  it — treat undefined as 0, same convention as silenceErrorCount above. */
  noAssetCount?: number;
  /** Rescue observability (false-positive rescue fix, 2026-07-31) — how many
   *  segments this run recovered via the per-segment temporal-bounding
   *  rescue (whisperService.ts). Optional for the same reason as
   *  silenceErrorCount/noAssetCount above — treat undefined as 0. */
  rescueCount?: number;
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
