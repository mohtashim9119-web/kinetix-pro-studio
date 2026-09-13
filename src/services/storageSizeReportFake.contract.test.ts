/**
 * Contract: `storage_size_report` against the fake. No Rust, no Tauri.
 * The fake is a pass-through of the injected snapshot — it does not
 * compute rows or re-sum reclaimable bytes.
 */
import { describe, it, expect } from 'vitest';
import {
  REAL_STORAGE_SIZE_ROWS,
  WHISPER_MODEL_SIZE_BYTES,
  OS_TEMP_DIR,
  type StorageSizeRow,
  type StorageSizeSnapshot,
} from './storageSizeReport';
import {
  createStorageSizeReportFake,
  STORAGE_SIZE_REPORT,
} from './storageSizeReportFake';

const WHISPER = REAL_STORAGE_SIZE_ROWS[0]!;
const LIVE: StorageSizeRow = { ...REAL_STORAGE_SIZE_ROWS[9]!, currentBytes: 50_000_000 };
const ORPHAN: StorageSizeRow = {
  ...REAL_STORAGE_SIZE_ROWS[11]!,
  currentBytes: 400_000_000,
  reclaimableBytes: 400_000_000,
};

const BROKEN: StorageSizeRow = {
  path: `${OS_TEMP_DIR}/kinetix-export-invariant`,
  label: 'Invariant-violating session',
  currentBytes: 10_000_000,
  reclaimableBytes: 99_000_000,
  sweepClass: 'reclaimable',
};

describe('storage_size_report', () => {
  it('returns the injected rows unchanged — it does not invent or rewrite a row', async () => {
    const snapshot: StorageSizeSnapshot = {
      rows: [ORPHAN, LIVE, WHISPER],
      totalReclaimableBytes: 400_000_000,
    };
    const fake = createStorageSizeReportFake(snapshot);
    const loaded = await fake.adapted.load();
    expect(loaded.rows).toEqual([ORPHAN, LIVE, WHISPER]);
    const viaInvoke = await fake.invoke<StorageSizeSnapshot>(STORAGE_SIZE_REPORT);
    expect(viaInvoke).toEqual(loaded);
  });

  it('returns the injected totalReclaimableBytes even when it does not equal the row sum', async () => {
    const fake = createStorageSizeReportFake({
      rows: [ORPHAN, LIVE],
      // Deliberately not 400_000_000 — proves the fake does not re-sum.
      totalReclaimableBytes: 1,
    });
    expect((await fake.source.load()).totalReclaimableBytes).toBe(1);
    expect((await fake.adapted.load()).totalReclaimableBytes).toBe(1);
  });

  it('round-trips the real 13-row identity payload without dropping, merging, or filling rows', async () => {
    expect(REAL_STORAGE_SIZE_ROWS).toHaveLength(13);
    const fake = createStorageSizeReportFake({
      rows: REAL_STORAGE_SIZE_ROWS,
      totalReclaimableBytes: 0,
    });
    const loaded = await fake.adapted.load();
    expect(loaded.rows).toHaveLength(13);
    expect(loaded.rows).toEqual(REAL_STORAGE_SIZE_ROWS);
  });

  it('preserves a never-reclaimable Whisper model row at the recorded 1,624,555,275 B', async () => {
    const fake = createStorageSizeReportFake({
      rows: [WHISPER],
      totalReclaimableBytes: 0,
    });
    const [row] = (await fake.adapted.load()).rows;
    expect(row).toEqual(WHISPER);
    expect(row?.sweepClass).toBe('never-reclaimable');
    expect(row?.reclaimableBytes).toBe(0);
    expect(row?.currentBytes).toBe(WHISPER_MODEL_SIZE_BYTES);
    expect(row?.currentBytes).toBe(1_624_555_275);
  });

  it('does not clamp a row whose reclaimableBytes exceed currentBytes', async () => {
    const fake = createStorageSizeReportFake({
      rows: [BROKEN],
      totalReclaimableBytes: BROKEN.reclaimableBytes,
    });
    const [row] = (await fake.adapted.load()).rows;
    expect(row?.reclaimableBytes).toBe(99_000_000);
    expect(row?.currentBytes).toBe(10_000_000);
    expect(row?.reclaimableBytes).toBeGreaterThan(row?.currentBytes ?? 0);
  });
});
