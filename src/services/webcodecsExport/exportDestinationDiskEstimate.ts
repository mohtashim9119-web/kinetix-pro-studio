/**
 * WS3 STEP 6 — the DESTINATION disk-space estimate: how many bytes the
 * chosen SAVE PATH needs for the finished MP4, at the export's own bitrate
 * setting and duration. This is a different question from `diskFull.ts`'s
 * `estimateExportDiskBytes`, which models peak usage in the SESSION temp
 * directory during encoding (multiple annexb/premux/mux intermediates
 * coexisting at the FIXED internal GL-tier encode rate,
 * `EXPORT_DISK_VIDEO_BYTES_PER_SECOND`). This module answers "will the
 * destination volume have room for the delivered file" — a preflight that
 * can run before any rendering starts, from just the export settings —
 * which is what `export_volume_free_space` / `export_validate_output_path`
 * (still out of scope — prompt 37) will eventually gate on. This module is
 * the shared calculation those commands' UI (and nothing else) should
 * import — do not keep a second copy of this formula.
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
 * (24,000 = 192 kbit/s ÷ 8) and the headroom math (`applyHeadroom`: ×1.10
 * then +64 MiB) are `diskFull.ts`'s own existing frozen primitives, reused
 * here rather than re-derived — this module adds only the bitrate-driven
 * video term `diskFull.ts` has no use for (its own video rate is fixed).
 *
 * CROSS-CHECK, not a coincidence: at `bitrateKbps = 8000`,
 * `8000 × 125 = 1,000,000 B/s`, exactly `EXPORT_DISK_VIDEO_BYTES_PER_SECOND`
 * — the point where this general, user-selectable-bitrate formula and
 * `diskFull.ts`'s fixed-rate session model agree. See this module's own
 * test file for that assertion; if it ever stops holding, that is a signal
 * to STOP and report, never to change `EXPORT_DISK_VIDEO_BYTES_PER_SECOND`
 * to make it hold again — that constant is frozen against the machine-1
 * field measurement, not against this cross-check.
 */
import { applyHeadroom, EXPORT_DISK_AAC_BYTES_PER_SECOND } from './diskFull';

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
   *  figure a destination-path preflight should require. */
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
