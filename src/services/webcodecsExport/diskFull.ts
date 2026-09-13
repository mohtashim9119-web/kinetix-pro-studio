/**
 * WS3 Round 21 — disk-full hardening. WS3 item G folded a fourth thing in.
 *
 * Four things live here, all derived from the pipeline's own artifact
 * lifetimes (ledger Round 21 STEP 1) rather than guessed:
 *
 *   1. THE DISK ACCOUNTING MODEL — `estimateExportDiskBytes`. How many bytes
 *      an export holds on disk at its peak, per volume, so the preflight can
 *      refuse before the first encoder session opens (D1). THE live model —
 *      used by the preflight (`decideDiskPreflight`, same file).
 *   2. THE ENOSPC CLASSIFIER — `isDiskFullCause` / `diskFullExportError`.
 *      Every write site (native append/write/concat/copy, ffmpeg's exit) is
 *      mapped to ONE typed `ExportError` kind, `'disk_full'`, that never
 *      charges the recovery budget and is never offered a lossy seal (D3).
 *   3. THE DIAGNOSTIC CAP — `capDiagnosticCause`. The raw native cause is kept
 *      for the diagnostics blob but capped to its last error-bearing lines;
 *      the operator-facing message is one sentence plus free/required bytes.
 *   4. THE DESTINATION-ONLY ESTIMATE — `estimateExportDestinationDiskBytes`
 *      (bottom of this file, WS3 item G — folded in from the formerly-dead
 *      `exportDestinationDiskEstimate.ts`, which nothing but its own test
 *      ever imported). Settings-only (bitrate/duration/hasAudio), no session
 *      pieces needed — for the modal's live size badge and the
 *      storage-relocation view's byte props, neither of which has a session
 *      to model a peak from. This is the ONLY other estimator in the
 *      codebase; do not let a fourth copy of either formula appear —
 *      everything that needs a byte estimate imports one of the two
 *      functions in this file.
 *
 * ── The model, in bytes ────────────────────────────────────────────────────
 *
 * Let D = export duration in seconds and A = the Annex-B video bytes:
 *
 *   A = EXPORT_DISK_VIDEO_BYTES_PER_SECOND × D
 *     = 1,000,000 B/s × D           (EXPORT_BITRATE 8,000,000 bit/s ÷ 8)
 *
 * Artifacts in the session temp dir, in lifetime order (GL path, voiceover):
 *
 *   piece_<n>.h264      A      appended during encode; deleted only AFTER a
 *                              successful mux (never before — a resume needs
 *                              them; a mux failure never touches them)
 *   video_all.h264      A      concat of ≥ 2 pieces; absent for one piece;
 *                              deleted after the mux with the pieces
 *   <video>.premux.mp4  ≈A     muxOnly step 1 (video → real-PTS MP4, stream
 *                              copy: same coded bytes + ~20 B/frame of MP4
 *                              sample tables); deleted in muxOnly's `finally`
 *   voiceover_audio     W      the voiceover asset's OWN bytes, written as-is
 *                              (a WAV is 48 kHz × 2 ch × 2 B = 192,000 B/s);
 *                              deleted after the mux
 *   export_final.mp4    A+AAC  muxOnly step 2; AAC 192 kbit/s = 24,000 B/s × D;
 *                              stays until the session is destroyed
 *   export_state.json   KB     the resume manifest — negligible, retained
 *   session_claim.json  B      negligible
 *
 * `-movflags +faststart` shifts `moov` IN PLACE (movenc `shift_data` opens
 * the same file for read; no temp copy), so neither MP4 step doubles.
 *
 * Peak is the audio-mux step, when every artifact above coexists:
 *
 *   peak(1 piece)  = 3A + W + AAC·D          (piece, premux, final)
 *   peak(≥2 pieces) = 4A + W + AAC·D         (+ video_all)
 *
 * After the mux the intermediates are deleted and delivery copies
 * `export_final.mp4` to `<dest>.part` on the destination volume, so the
 * destination volume needs A + AAC·D, and if it is the SAME volume as the
 * temp tree the two requirements are summed (still below the mux peak, but
 * the sum is what the check enforces).
 *
 * Canvas-tier pieces (`segv1_*`, `frame_%05d.png`) add a per-segment
 * transient of one PNG per frame that is deleted before the next segment;
 * plain-tier pieces write the source MP4 (its own size) transiently. Both
 * are counted at their own rates below.
 *
 * Validation against the machine-1 field failure (2026-09-12, 9297de2):
 * 50,911 frames @ 30 fps → D = 1697.0 s; bytesAppended 1,694,429,224 →
 * 998,485 B/s, 99.85 % of the 1,000,000 B/s the model uses. WAV 326 MB
 * (1697 × 192,000 = 325.8 MB ✓). Single piece → peak = 3 × 1.694 GB + 0.326
 * + 0.041 = 5.45 GB, i.e. 3.1× the 1.735 GB final. (The field note's ~4.7 GB
 * used a ~1.35 GB premux reading; the code path is a stream copy, so the
 * model keeps the larger, code-derived ≈ A.)
 */
import type { ExportError } from '../exportPipeline';

// ---------------------------------------------------------------------------
// Constants — same style as the eight frozen constants: every number has
// its derivation next to it. None of the existing frozen constants change.
// ---------------------------------------------------------------------------

/**
 * Annex-B bytes per second of WebCodecs (GL-tier) output at any resolution
 * the app exports: `exportWorker.ts`'s `EXPORT_BITRATE = 8_000_000` bit/s is
 * a fixed target, not per-pixel, so this is resolution-independent.
 * 8,000,000 ÷ 8 = 1,000,000. Field: 998,485 B/s measured (0.15 % under).
 */
export const EXPORT_DISK_VIDEO_BYTES_PER_SECOND = 1_000_000;

/**
 * Canvas-tier (`segv1_*`, libx264 `-crf 16 -preset fast`) is rate-free; no
 * measurement of its output size exists in the repo. 2× the GL rate is an
 * ASSUMPTION recorded as such (crf 16 at 1080p on motion content is
 * commonly quoted in the 8–16 Mbit/s range); the per-frame PNG transient
 * below dominates the canvas term anyway.
 */
export const EXPORT_DISK_CANVAS_BYTES_PER_SECOND = 2 * EXPORT_DISK_VIDEO_BYTES_PER_SECOND;

/**
 * Per-frame PNG written by the canvas tier before ffmpeg runs, deleted after
 * the segment encodes. 1920 × 1080 × 3 B = 6,220,800 B raw; PNG of a
 * rendered slide with gradients/photos compresses to roughly half; 3 MiB is
 * the working figure. Only ONE segment's frames exist at a time.
 */
export const EXPORT_DISK_CANVAS_PNG_BYTES_PER_FRAME = 3 * 1024 * 1024;

/** AAC 192 kbit/s (`buildAudioMuxArgs` `-b:a 192k`) ÷ 8 = 24,000 B/s. */
export const EXPORT_DISK_AAC_BYTES_PER_SECOND = 24_000;

/** PCM WAV 48 kHz × 2 ch × 16-bit = 192,000 B/s — the fallback when the
 *  voiceover asset's own byte size is not available (blob URL after reload). */
export const EXPORT_DISK_WAV_BYTES_PER_SECOND = 192_000;

/**
 * Headroom multiplier on the modelled bytes. The one field sample ran at
 * 99.85 % of target; VideoEncoder `bitrate` is a VBR average bound over a
 * rate-control window, not a file-size cap, and hardware encoders overshoot
 * on high-complexity spans. 10 % = 170 MB at the field scale — one AAC
 * track plus ~2 minutes of output at target rate — is the tolerance the
 * check carries for rate-control drift and for anything else writing to the
 * same volume during the export. Not a measured number: recorded as the
 * judgement it is.
 */
export const EXPORT_DISK_HEADROOM_RATIO = 0.10;

/**
 * Fixed floor under the ratio, for short exports where 10 % is smaller than
 * the itemised container overhead: `moov` for a 26-min 1080p30 file is ~2 MB
 * (50,911 samples × ~40 B of stsz/stco/ctts/stss), the in-place faststart
 * shift grows the file by that much, two MP4 headers, the manifest and the
 * claim are KB. 64 MiB is 30× that overhead.
 */
export const EXPORT_DISK_HEADROOM_FLOOR_BYTES = 64 * 1024 * 1024;

// ---------------------------------------------------------------------------
// The model
// ---------------------------------------------------------------------------

export interface DiskEstimatePiece {
  tier: 'plain' | 'gl' | 'canvas';
  expectedFrames: number;
  /** Plain tier: the source MP4's own size (its bitstream IS the piece). */
  sourceBytes?: number;
}

export interface DiskEstimateInput {
  fps: number;
  pieces: readonly DiskEstimatePiece[];
  /** `null` = no voiceover. `bytes: null` = size unknown, use the WAV rate. */
  voiceover: { bytes: number | null } | null;
  /** Bytes already on disk for a resumed session (its pieces). Subtracted. */
  resumedBytesOnDisk?: number;
}

export interface DiskEstimate {
  durationSeconds: number;
  annexbBytes: number;
  voiceoverBytes: number;
  aacBytes: number;
  finalBytes: number;
  /** Largest single-segment canvas PNG transient (0 without canvas pieces). */
  canvasTransientBytes: number;
  /** Peak simultaneous bytes in the session temp tree (before headroom). */
  tempPeakBytes: number;
  /** Bytes the destination volume needs for the delivered file. */
  destinationBytes: number;
  /** `tempPeakBytes` with headroom applied. */
  tempRequiredBytes: number;
  /** `destinationBytes` with headroom applied. */
  destinationRequiredBytes: number;
  amplification: number;
}

export function applyHeadroom(bytes: number): number {
  return Math.ceil(bytes * (1 + EXPORT_DISK_HEADROOM_RATIO)) + EXPORT_DISK_HEADROOM_FLOOR_BYTES;
}

export function estimateExportDiskBytes(input: DiskEstimateInput): DiskEstimate {
  const fps = input.fps > 0 ? input.fps : 30;
  let annexb = 0;
  let frames = 0;
  let canvasTransient = 0;
  for (const p of input.pieces) {
    const secs = p.expectedFrames / fps;
    frames += p.expectedFrames;
    if (p.tier === 'gl') {
      annexb += secs * EXPORT_DISK_VIDEO_BYTES_PER_SECOND;
    } else if (p.tier === 'canvas') {
      annexb += secs * EXPORT_DISK_CANVAS_BYTES_PER_SECOND;
      canvasTransient = Math.max(canvasTransient, p.expectedFrames * EXPORT_DISK_CANVAS_PNG_BYTES_PER_FRAME);
    } else {
      annexb += p.sourceBytes ?? secs * EXPORT_DISK_VIDEO_BYTES_PER_SECOND;
    }
  }
  const durationSeconds = frames / fps;
  const voiceoverBytes =
    input.voiceover === null
      ? 0
      : input.voiceover.bytes ?? Math.ceil(durationSeconds * EXPORT_DISK_WAV_BYTES_PER_SECOND);
  const aacBytes = input.voiceover === null ? 0 : Math.ceil(durationSeconds * EXPORT_DISK_AAC_BYTES_PER_SECOND);
  const finalBytes = Math.ceil(annexb + aacBytes);
  const copies = input.pieces.length >= 2 ? 4 : 3; // pieces (+ video_all) + premux + final
  // Without a voiceover muxOnly has no premux step (one ffmpeg run straight
  // to the final), so one fewer copy of A coexists.
  const muxCopies = input.voiceover === null ? copies - 1 : copies;
  const muxPeak = muxCopies * annexb + voiceoverBytes + aacBytes;
  // The canvas transient happens during encode, when only earlier pieces'
  // annexb exist — bounded above by annexb + transient.
  const encodePeak = annexb + canvasTransient;
  const tempPeak = Math.ceil(Math.max(muxPeak, encodePeak)) - (input.resumedBytesOnDisk ?? 0);
  const tempPeakBytes = Math.max(0, tempPeak);
  return {
    durationSeconds,
    annexbBytes: Math.ceil(annexb),
    voiceoverBytes,
    aacBytes,
    finalBytes,
    canvasTransientBytes: canvasTransient,
    tempPeakBytes,
    destinationBytes: finalBytes,
    tempRequiredBytes: applyHeadroom(tempPeakBytes),
    destinationRequiredBytes: applyHeadroom(finalBytes),
    amplification: finalBytes > 0 ? tempPeakBytes / finalBytes : 0,
  };
}

// ---------------------------------------------------------------------------
// Preflight (D1)
// ---------------------------------------------------------------------------

/** Mirrors the native `VolumeFreeSpace` (`disk_space.rs`). */
export interface VolumeFreeSpace {
  path: string;
  probedPath: string;
  volumeKey: string;
  availableBytes: number;
}

export interface DiskPreflightShortfall {
  volumeKey: string;
  /** Every path that resolved onto this volume. */
  paths: string[];
  requiredBytes: number;
  availableBytes: number;
  shortfallBytes: number;
}

export interface DiskPreflightResult {
  ok: boolean;
  estimate: DiskEstimate;
  volumes: Array<{ volumeKey: string; paths: string[]; requiredBytes: number; availableBytes: number }>;
  shortfall: DiskPreflightShortfall | null;
}

/**
 * Group readings that share a free-space pool: equal `volumeKey`, OR
 * byte-identical `availableBytes` (two APFS volumes in one container have
 * distinct device ids but one pool — see `disk_space.rs`'s `volume_key`).
 */
export function groupVolumes(
  readings: ReadonlyArray<{ reading: VolumeFreeSpace; requiredBytes: number }>,
): Array<{ volumeKey: string; paths: string[]; requiredBytes: number; availableBytes: number }> {
  const groups: Array<{ volumeKey: string; paths: string[]; requiredBytes: number; availableBytes: number }> = [];
  for (const { reading, requiredBytes } of readings) {
    const existing = groups.find(
      (g) => g.volumeKey === reading.volumeKey || g.availableBytes === reading.availableBytes,
    );
    if (existing) {
      existing.paths.push(reading.path);
      existing.requiredBytes += requiredBytes;
    } else {
      groups.push({
        volumeKey: reading.volumeKey,
        paths: [reading.path],
        requiredBytes,
        availableBytes: reading.availableBytes,
      });
    }
  }
  return groups;
}

/**
 * Pure decision: `temp` is the session tree's reading, `destination` the
 * output file's (absent when the export saves later). Returns the FIRST
 * volume that cannot hold its summed requirement.
 */
export function decideDiskPreflight(params: {
  estimate: DiskEstimate;
  temp: VolumeFreeSpace;
  destination: VolumeFreeSpace | null;
}): DiskPreflightResult {
  const readings = [{ reading: params.temp, requiredBytes: params.estimate.tempRequiredBytes }];
  if (params.destination) {
    readings.push({ reading: params.destination, requiredBytes: params.estimate.destinationRequiredBytes });
  }
  const volumes = groupVolumes(readings);
  for (const v of volumes) {
    if (v.availableBytes < v.requiredBytes) {
      return {
        ok: false,
        estimate: params.estimate,
        volumes,
        shortfall: {
          volumeKey: v.volumeKey,
          paths: v.paths,
          requiredBytes: v.requiredBytes,
          availableBytes: v.availableBytes,
          shortfallBytes: v.requiredBytes - v.availableBytes,
        },
      };
    }
  }
  return { ok: true, estimate: params.estimate, volumes, shortfall: null };
}

// ---------------------------------------------------------------------------
// ENOSPC classification (D3)
// ---------------------------------------------------------------------------

/** The tag every native ENOSPC carries (`disk_space::DISK_FULL_TAG`). */
export const DISK_FULL_TAG = '[disk-full]';

const DISK_FULL_PATTERNS: readonly RegExp[] = [
  /\[disk-full\]/,
  /No space left on device/i,
  /StorageFull/,
  /QuotaExceeded/,
  /ERROR_DISK_FULL/,
  /ERROR_HANDLE_DISK_FULL/,
  /\bENOSPC\b/,
  /\(os error 112\)/,
  /\(os error 39\)/,
  /not enough space on the disk/i,
  /The disk is full/i,
  /ffmpeg exited with code -28\b/,
  /ffmpeg exited with code 228\b/,
];

/** Whether a native/ffmpeg cause string describes a full volume. */
export function isDiskFullCause(cause: string | null | undefined): boolean {
  if (!cause) return false;
  return DISK_FULL_PATTERNS.some((re) => re.test(cause));
}

export function isDiskFullError(err: unknown): boolean {
  if (err instanceof DiskFullError) return true;
  if (err instanceof Error) return isDiskFullCause(err.message);
  return isDiskFullCause(typeof err === 'string' ? err : String(err));
}

/**
 * Thrown by the preflight and by the append path when ENOSPC is detected
 * mid-run, so the pipeline can settle immediately instead of waiting for a
 * worker that can no longer make progress.
 */
export class DiskFullError extends Error {
  readonly requiredBytes: number | null;
  readonly availableBytes: number | null;
  readonly volumePath: string | null;
  readonly phase: string;

  constructor(opts: {
    message: string;
    phase: string;
    requiredBytes?: number | null;
    availableBytes?: number | null;
    volumePath?: string | null;
  }) {
    super(opts.message);
    this.name = 'DiskFullError';
    this.phase = opts.phase;
    this.requiredBytes = opts.requiredBytes ?? null;
    this.availableBytes = opts.availableBytes ?? null;
    this.volumePath = opts.volumePath ?? null;
  }
}

// ---------------------------------------------------------------------------
// Diagnostic cap (D3c)
// ---------------------------------------------------------------------------

/** Last lines kept from a native cause. */
export const DISK_FULL_CAUSE_MAX_LINES = 12;
/** Byte cap on the kept cause. */
export const DISK_FULL_CAUSE_MAX_BYTES = 1_500;

const FFMPEG_PROGRESS_LINE = /^\s*(frame=|size=|video:)/;

/**
 * Keep the last `maxLines` non-progress lines of a cause and cap the result
 * at `maxBytes` from the end — ffmpeg's `frame=… speed=…` spam is dropped,
 * the lines that name the error (`No space left on device`, `Error writing
 * trailer`) are last and survive.
 */
export function capDiagnosticCause(
  cause: string,
  maxLines: number = DISK_FULL_CAUSE_MAX_LINES,
  maxBytes: number = DISK_FULL_CAUSE_MAX_BYTES,
): string {
  // Keep the native header (`ffmpeg exited with code -28 (...)`) as its own
  // line even when the sidecar glued the first progress line onto it.
  const header = /^(ffmpeg exited with code -?\d+[^:\r\n]*): /.exec(cause);
  const body = header ? cause.slice(header[0].length) : cause;
  const lines = body
    .split(/\r?\n|\r/)
    .map((l) => l.trimEnd())
    .filter((l) => l.length > 0 && !FFMPEG_PROGRESS_LINE.test(l));
  if (header) lines.unshift(header[1]!);
  let joined = lines.slice(Math.max(0, lines.length - maxLines)).join('\n');
  if (joined.length > maxBytes) joined = `...${joined.slice(joined.length - maxBytes)}`;
  return joined;
}

// ---------------------------------------------------------------------------
// The typed error (D3c)
// ---------------------------------------------------------------------------

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '?';
  const gib = 1024 ** 3;
  const mib = 1024 ** 2;
  if (bytes >= gib) return `${(bytes / gib).toFixed(2)} GiB`;
  if (bytes >= mib) return `${(bytes / mib).toFixed(0)} MiB`;
  return `${bytes} B`;
}

/**
 * One short sentence plus free/required bytes. `cause` (capped) rides on
 * `ExportError.cause` for the diagnostics blob only; `phase` names the step.
 */
export function diskFullExportError(opts: {
  phase: string;
  requiredBytes: number | null;
  availableBytes: number | null;
  volumePath: string | null;
  cause: string;
}): ExportError {
  const where = opts.volumePath ? ` on the volume holding ${opts.volumePath}` : '';
  const numbers =
    opts.requiredBytes !== null && opts.availableBytes !== null
      ? ` Needs about ${formatBytes(opts.requiredBytes)}, ${formatBytes(opts.availableBytes)} free.`
      : opts.availableBytes !== null
        ? ` ${formatBytes(opts.availableBytes)} free.`
        : '';
  return {
    kind: 'disk_full',
    message: `The export ran out of disk space${where} (${opts.phase}).${numbers}`,
    cause: capDiagnosticCause(opts.cause),
    diskFull: {
      phase: opts.phase,
      requiredBytes: opts.requiredBytes,
      availableBytes: opts.availableBytes,
      volumePath: opts.volumePath,
    },
  };
}

/** Wrap an arbitrary thrown value as a disk-full ExportError. */
export function diskFullExportErrorFrom(err: unknown, phase: string): ExportError {
  if (err instanceof DiskFullError) {
    return diskFullExportError({
      phase: err.phase || phase,
      requiredBytes: err.requiredBytes,
      availableBytes: err.availableBytes,
      volumePath: err.volumePath,
      cause: err.message,
    });
  }
  const cause = err instanceof Error ? err.message : String(err);
  return diskFullExportError({ phase, requiredBytes: null, availableBytes: null, volumePath: null, cause });
}

// ---------------------------------------------------------------------------
// WS3 item G — the destination-only estimate (formerly
// exportDestinationDiskEstimate.ts, folded in here). One module, one named
// API, three consumers:
//
//   - The preflight              -> `estimateExportDiskBytes` + `decideDiskPreflight` above (unchanged).
//   - The modal's live size badge -> `estimateExportDestinationDiskBytes` below.
//   - The storage-relocation view's byte props -> `estimateExportDestinationDiskBytes` below.
//
// Both functions now live in this one file so a fourth copy of either
// formula cannot appear without also touching this file.
// ---------------------------------------------------------------------------

/**
 * WS3 STEP 6 — the DESTINATION disk-space estimate: how many bytes the
 * chosen SAVE PATH needs for the finished MP4, at the export's own bitrate
 * setting and duration. This is a different question from
 * `estimateExportDiskBytes` above, which models peak usage in the SESSION
 * TEMP directory during encoding (multiple annexb/premux/mux intermediates
 * coexisting at the FIXED internal GL-tier encode rate,
 * `EXPORT_DISK_VIDEO_BYTES_PER_SECOND`). This function answers "will the
 * destination volume have room for the delivered file" — callable BEFORE any
 * rendering starts, from just the export settings (bitrate, duration,
 * whether there's a voiceover) — which is what a live size badge or a
 * storage-relocation view needs; neither has session pieces to model a peak
 * from.
 *
 * THE FORMULA (owner-specified, adopted verbatim — do not re-derive):
 *
 *   videoBytes = bitrateKbps × 125 × durationSeconds
 *   audioBytes = hasAudio ? EXPORT_DISK_AAC_BYTES_PER_SECOND × durationSeconds : 0
 *   destinationRequiredBytes = ceil((videoBytes + audioBytes) × 1.10) + 64 MiB
 *
 * `125` is the plain kbit/s → bytes/s conversion (1000 bits/kbit ÷ 8
 * bits/byte) — NOT a measured/frozen constant, just unit arithmetic, so it
 * is written inline rather than named. `EXPORT_DISK_AAC_BYTES_PER_SECOND`
 * and `applyHeadroom` (×1.10 then +64 MiB) are this file's own existing
 * frozen primitives, reused here rather than re-derived — this function adds
 * only the bitrate-driven video term the peak model has no use for (its own
 * video rate is fixed).
 *
 * CROSS-CHECK, not a coincidence: at `bitrateKbps = 8000`,
 * `8000 × 125 = 1,000,000 B/s`, exactly `EXPORT_DISK_VIDEO_BYTES_PER_SECOND`
 * — the point where this general, user-selectable-bitrate formula and the
 * fixed-rate session model above agree. See this file's own test file for
 * that assertion; if it ever stops holding, that is a signal to STOP and
 * report, never to change `EXPORT_DISK_VIDEO_BYTES_PER_SECOND` to make it
 * hold again — that constant is frozen against the machine-1 field
 * measurement, not against this cross-check.
 */
export interface DestinationDiskEstimateInput {
  /** The export's target video bitrate, in kbit/s (e.g. 1500/3000/8000). */
  bitrateKbps: number;
  durationSeconds: number;
  hasAudio: boolean;
}

export interface DestinationDiskEstimate {
  videoBytes: number;
  audioBytes: number;
  /** `ceil((videoBytes + audioBytes) × 1.10) + 64 MiB` — the free-space
   *  figure a destination-path preflight, a size badge, or a
   *  storage-relocation view should require/display. */
  destinationRequiredBytes: number;
}

export function estimateExportDestinationDiskBytes(
  input: DestinationDiskEstimateInput,
): DestinationDiskEstimate {
  const videoBytes = input.bitrateKbps * 125 * input.durationSeconds;
  const audioBytes = input.hasAudio
    ? EXPORT_DISK_AAC_BYTES_PER_SECOND * input.durationSeconds
    : 0;
  return {
    videoBytes,
    audioBytes,
    destinationRequiredBytes: applyHeadroom(videoBytes + audioBytes),
  };
}
