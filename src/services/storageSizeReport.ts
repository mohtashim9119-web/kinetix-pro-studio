/**
 * Narrow injected surface for the storage size report.
 *
 * Presentation never invents a row. Round 24a deferred Step 7 (size report)
 * and never shipped `storage_size_report` in `src-tauri/**`. The 13 identities
 * below are the on-disk classes Round 21 STEP 1 + Round 24a STEP 3 + the
 * model writers actually have. CC's future source fills `currentBytes` /
 * `reclaimableBytes` at runtime; recorded constants are used only where the
 * tree names a size (Whisper, FA onnx manifest).
 *
 * Documented invoke name (not registered — do not invent the Rust):
 *
 *   storage_size_report  () → StorageSizeSnapshot
 */

export type StorageSweepClass = 'reclaimable' | 'protected' | 'never-reclaimable';

/** `model_download.rs` `MODEL_SIZE_BYTES` / `whisper.rs` comment. */
export const WHISPER_MODEL_SIZE_BYTES = 1_624_555_275;

/** macOS `app.path().app_local_data_dir()` for identifier `com.kinetix.pro-studio`. */
export const APP_LOCAL_DATA_DIR =
  '/Users/name/Library/Application Support/com.kinetix.pro-studio';

/** Round 21: `$TMPDIR` is `/var/folders/<xx>/<hash>/T/`, not `/tmp`. */
export const OS_TEMP_DIR = '/var/folders/xx/hash/T';

/**
 * The 13 storage-report identities. `currentBytes` is the recorded constant
 * when one exists; `0` means runtime-only (CC's source stats the directory).
 * `reclaimableBytes` is 0 here for the same reason except never-reclaimable
 * models, which stay 0 by classification.
 *
 * FA byte sizes: `scripts/fixtures/fa-onnx-manifest.json` `models.<lang>.byteSize`.
 */
export const REAL_STORAGE_SIZE_ROWS: readonly StorageSizeRow[] = [
  {
    path: `${APP_LOCAL_DATA_DIR}/models/ggml-large-v3-turbo.bin`,
    label: 'Whisper large-v3-turbo',
    currentBytes: WHISPER_MODEL_SIZE_BYTES,
    reclaimableBytes: 0,
    sweepClass: 'never-reclaimable',
  },
  {
    path: `${APP_LOCAL_DATA_DIR}/fa-models/en/model.onnx`,
    label: 'FA English',
    currentBytes: 1_262_512_711,
    reclaimableBytes: 0,
    sweepClass: 'never-reclaimable',
  },
  {
    path: `${APP_LOCAL_DATA_DIR}/fa-models/es/model.onnx`,
    label: 'FA Spanish',
    currentBytes: 1_262_545_511,
    reclaimableBytes: 0,
    sweepClass: 'never-reclaimable',
  },
  {
    path: `${APP_LOCAL_DATA_DIR}/fa-models/fr/model.onnx`,
    label: 'FA French',
    currentBytes: 1_262_619_311,
    reclaimableBytes: 0,
    sweepClass: 'never-reclaimable',
  },
  {
    path: `${APP_LOCAL_DATA_DIR}/fa-models/de/model.onnx`,
    label: 'FA German',
    currentBytes: 1_262_533_211,
    reclaimableBytes: 0,
    sweepClass: 'never-reclaimable',
  },
  {
    path: `${APP_LOCAL_DATA_DIR}/fa-models/pt/model.onnx`,
    label: 'FA Portuguese',
    currentBytes: 1_262_566_011,
    reclaimableBytes: 0,
    sweepClass: 'never-reclaimable',
  },
  {
    path: `${APP_LOCAL_DATA_DIR}/fa-audio-cache`,
    label: 'FA durable WAV cache',
    currentBytes: 0,
    reclaimableBytes: 0,
    sweepClass: 'reclaimable',
  },
  {
    path: `${OS_TEMP_DIR}/kinetix-fa-dev-inputs`,
    label: 'FA staging inputs',
    currentBytes: 0,
    reclaimableBytes: 0,
    sweepClass: 'reclaimable',
  },
  {
    path: `${OS_TEMP_DIR}/kinetix-whisper-staging`,
    label: 'Whisper transcribe staging',
    currentBytes: 0,
    reclaimableBytes: 0,
    sweepClass: 'reclaimable',
  },
  {
    path: `${OS_TEMP_DIR}/kinetix-export-live`,
    label: 'Live export session',
    currentBytes: 0,
    reclaimableBytes: 0,
    sweepClass: 'protected',
  },
  {
    path: `${OS_TEMP_DIR}/kinetix-export-resumable`,
    label: 'Resumable export session',
    currentBytes: 0,
    reclaimableBytes: 0,
    sweepClass: 'reclaimable',
  },
  {
    path: `${OS_TEMP_DIR}/kinetix-export-orphan`,
    label: 'Orphan export session',
    currentBytes: 0,
    reclaimableBytes: 0,
    sweepClass: 'reclaimable',
  },
  {
    path: `${APP_LOCAL_DATA_DIR}/project-mirror/backups`,
    label: 'Stale project backups',
    currentBytes: 0,
    reclaimableBytes: 0,
    sweepClass: 'reclaimable',
  },
];

/**
 * One line of the storage report. Every field is owned by the data source.
 * Presentation must not derive path, label, bytes, or classification.
 */
export interface StorageSizeRow {
  path: string;
  label: string;
  currentBytes: number;
  reclaimableBytes: number;
  sweepClass: StorageSweepClass;
}

/**
 * Payload the UI renders. `totalReclaimableBytes` is owned by the source
 * so the summary cannot silently re-sum the rows.
 */
export interface StorageSizeSnapshot {
  rows: readonly StorageSizeRow[];
  totalReclaimableBytes: number;
}

export interface StorageSizeReportSource {
  load(): Promise<StorageSizeSnapshot>;
}

/**
 * Production adapter. `invoke` is passed in so this module never imports
 * `@tauri-apps`. CC substitutes the real `invoke`; the command name stays.
 */
export function createInvokeStorageSizeReportSource(
  invoke: <T>(cmd: string, args?: Record<string, unknown>) => Promise<T>,
): StorageSizeReportSource {
  return {
    async load(): Promise<StorageSizeSnapshot> {
      return invoke<StorageSizeSnapshot>('storage_size_report');
    },
  };
}

/** True when a row's reclaimable figure exceeds what it currently occupies. */
export function isReclaimableExceedsCurrent(row: StorageSizeRow): boolean {
  return row.reclaimableBytes > row.currentBytes;
}

export function isNeverReclaimable(row: StorageSizeRow): boolean {
  return row.sweepClass === 'never-reclaimable';
}

export function isProtectedSweepClass(sweepClass: StorageSweepClass): boolean {
  return sweepClass === 'protected' || sweepClass === 'never-reclaimable';
}
