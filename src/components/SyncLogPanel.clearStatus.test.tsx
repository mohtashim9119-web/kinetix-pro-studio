// @vitest-environment jsdom
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// Sync log: logs are permanent records — there is no way to delete them from
// the panel. Copy lives in each SYNC header and copies that sync's records.
// The status card is always present and reads green when nothing needs fixing.

import { describe, it, expect, afterEach, vi } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';
import { SyncLogPanel } from './SyncLogPanel';
import { buildMediaImportEntry } from '../services/syncLog';
import type { SyncLogEntry, SyncRunSummary } from '../types';

let root: Root | undefined;
let container: HTMLDivElement | undefined;
afterEach(() => { act(() => root?.unmount()); container?.remove(); });

async function mount(syncLog: SyncLogEntry[], syncRunSummaries: SyncRunSummary[] = []): Promise<HTMLDivElement> {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => { root!.render(<SyncLogPanel syncLog={syncLog} syncRunSummaries={syncRunSummaries} />); });
  return container;
}

const AT = 1_700_000_000_000;
const entry = (): SyncLogEntry =>
  buildMediaImportEntry('run', 'files', { imported: 2, deduped: 0, unsupportedSkipped: 0, failed: 0 }, AT, [], []);
const summary: SyncRunSummary = { syncRunId: 'run', timestamp: AT, totalSegments: 2, coveredSegments: 2, skippedSegments: 0, aborted: false };

describe('sync log — permanent records, copy per sync, always-present status card', () => {
  it('there is no delete/clear control anywhere', async () => {
    const el = await mount([entry()], [summary]);
    expect(el.querySelector('[data-testid="sync-log-clear"]')).toBeNull();
    expect(el.querySelector('[aria-label="Clear sync log"]')).toBeNull();
    expect(el.textContent).not.toContain('Clear log');
  });

  it('Copy sits in the SYNC header and copies that sync\'s records', async () => {
    const writeText = vi.fn(async () => undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    const el = await mount([entry()], [summary]);
    const copy = el.querySelector('[data-testid="sync-group"] [data-testid="sync-log-copy"]') as HTMLButtonElement;
    expect(copy).not.toBeNull();
    await act(async () => { copy.click(); });
    expect(writeText).toHaveBeenCalledTimes(1);
    expect(String((writeText.mock.calls[0] as unknown[])[0])).toContain('2 imported');
  });

  it('an empty log opens showing the green status card', async () => {
    const el = await mount([]);
    expect(el.querySelector('[data-testid="sync-status"]')?.getAttribute('data-state')).toBe('clear');
    expect(el.querySelector('[data-testid="sync-status-text"]')?.textContent).toBe('All clear - Ready to export');
  });
});
