// @vitest-environment jsdom
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';
import { StorageSizeReport } from './StorageSizeReport';
import { formatBytes } from '../services/webcodecsExport/diskFull';
import {
  REAL_STORAGE_SIZE_ROWS,
  WHISPER_MODEL_SIZE_BYTES,
  OS_TEMP_DIR,
  type StorageSizeRow,
  type StorageSizeSnapshot,
} from '../services/storageSizeReport';
import { createStorageSizeReportFake } from '../services/storageSizeReportFake';

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

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

async function renderReport(
  snapshot: StorageSizeSnapshot,
  onReclaimRow?: (row: StorageSizeRow) => void,
): Promise<void> {
  root = createRoot(container);
  await act(async () => {
    root.render(<StorageSizeReport snapshot={snapshot} onReclaimRow={onReclaimRow} />);
  });
}

function rowEl(path: string): HTMLElement {
  const el = container.querySelector<HTMLElement>(`[data-testid="storage-row"][data-path="${path}"]`);
  if (!el) throw new Error(`missing row ${path}`);
  return el;
}

describe('StorageSizeReport', () => {
  it('renders the empty state when the snapshot has no rows', async () => {
    const fake = createStorageSizeReportFake({ rows: [], totalReclaimableBytes: 0 });
    await renderReport(await fake.source.load());
    expect(container.querySelector('[data-testid="storage-empty"]')?.textContent).toMatch(/no storage/i);
    expect(container.querySelector('[data-testid="storage-group-reclaimable"]')).toBeNull();
    expect(container.querySelector('[data-testid="storage-group-protected"]')).toBeNull();
  });

  it('groups reclaimable rows apart from protected rows (including never-reclaimable models)', async () => {
    const fake = createStorageSizeReportFake({
      rows: [ORPHAN, LIVE, WHISPER],
      totalReclaimableBytes: 400_000_000,
    });
    await renderReport(await fake.source.load(), vi.fn());
    const reclaimGroup = container.querySelector('[data-testid="storage-group-reclaimable"]')!;
    const protectedGroup = container.querySelector('[data-testid="storage-group-protected"]')!;
    expect(reclaimGroup.querySelector(`[data-path="${ORPHAN.path}"]`)).not.toBeNull();
    expect(reclaimGroup.querySelector(`[data-path="${LIVE.path}"]`)).toBeNull();
    expect(reclaimGroup.querySelector(`[data-path="${WHISPER.path}"]`)).toBeNull();
    expect(protectedGroup.querySelector(`[data-path="${LIVE.path}"]`)).not.toBeNull();
    expect(protectedGroup.querySelector(`[data-path="${WHISPER.path}"]`)).not.toBeNull();
    expect(protectedGroup.querySelector(`[data-path="${ORPHAN.path}"]`)).toBeNull();
  });

  it('shows the source totalReclaimableBytes without re-summing the rows', async () => {
    const fake = createStorageSizeReportFake({
      rows: [ORPHAN, LIVE],
      totalReclaimableBytes: 7,
    });
    await renderReport(await fake.source.load());
    const summary = container.querySelector('[data-testid="storage-total-reclaimable"]')!;
    expect(summary.textContent).toContain(formatBytes(7));
    expect(summary.textContent).not.toContain(formatBytes(ORPHAN.reclaimableBytes));
  });

  it('surfaces a row whose reclaimableBytes exceed currentBytes instead of swallowing it', async () => {
    const fake = createStorageSizeReportFake({
      rows: [BROKEN],
      totalReclaimableBytes: BROKEN.reclaimableBytes,
    });
    await renderReport(await fake.source.load(), vi.fn());
    const alert = container.querySelector('[data-testid="storage-invariant-violation"]');
    expect(alert).not.toBeNull();
    expect(alert?.textContent).toMatch(/exceed/i);
    expect(container.querySelector(`[data-testid="storage-invariant-violation-row"][data-path="${BROKEN.path}"]`)).not.toBeNull();
    expect(rowEl(BROKEN.path).textContent).toContain('Invariant-violating session');
  });

  it('offers no delete or reclaim control on a never-reclaimable Whisper model (1,624,555,275 B)', async () => {
    const onReclaimRow = vi.fn();
    const fake = createStorageSizeReportFake({
      rows: [WHISPER, ORPHAN],
      totalReclaimableBytes: ORPHAN.reclaimableBytes,
    });
    await renderReport(await fake.source.load(), onReclaimRow);
    const whisper = rowEl(WHISPER.path);
    expect(whisper.getAttribute('data-sweep-class')).toBe('never-reclaimable');
    expect(whisper.querySelector('[data-testid="storage-row-reclaim"]')).toBeNull();
    expect(whisper.querySelector('button')).toBeNull();
    expect(whisper.textContent).toContain(formatBytes(WHISPER_MODEL_SIZE_BYTES));
    expect(rowEl(ORPHAN.path).querySelector('[data-testid="storage-row-reclaim"]')).not.toBeNull();
    expect(onReclaimRow).not.toHaveBeenCalled();
  });
});
