// @vitest-environment jsdom
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// Sync log: Copy / Clear live with the Details rows (they act on the log
// entries), and clearing the log never removes the status card — it stays and
// reads green ("all clear").

import { describe, it, expect, afterEach } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';
import { act, useState } from 'react';
import { SyncLogPanel } from './SyncLogPanel';
import { buildMediaImportEntry } from '../services/syncLog';
import type { SyncLogEntry } from '../types';

let root: Root | undefined;
let container: HTMLDivElement | undefined;
afterEach(() => { act(() => root?.unmount()); container?.remove(); });

function Harness({ initial }: { initial: SyncLogEntry[] }) {
  const [log, setLog] = useState(initial);
  return <SyncLogPanel syncLog={log} syncRunSummaries={[]} offlineAssetNames={[]} onClearLog={() => setLog([])} />;
}

async function mount(initial: SyncLogEntry[]): Promise<HTMLDivElement> {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => { root!.render(<Harness initial={initial} />); });
  return container;
}

const entry = (): SyncLogEntry =>
  buildMediaImportEntry('run', 'files', { imported: 2, deduped: 0, unsupportedSkipped: 0, failed: 0 }, 1_700_000_000_000, [], []);

describe('sync log — copy/clear placement and the always-present status card', () => {
  it('Copy and Clear sit in the Details row, NOT in the section header', async () => {
    const el = await mount([entry()]);
    const details = el.querySelector('[data-testid="sync-details-line"]')!;
    expect(details.querySelector('[data-testid="sync-log-copy"]')).not.toBeNull();
    expect(details.querySelector('[data-testid="sync-log-clear"]')).not.toBeNull();
    const header = el.querySelector('.cursor-pointer')!;
    expect(header.querySelector('[aria-label="Copy sync log"]')).toBeNull();
    expect(header.querySelector('[aria-label="Clear sync log"]')).toBeNull();
  });

  it('clearing the log empties the entries but the status card stays, green; the icons go with the entries', async () => {
    const el = await mount([entry()]);
    await act(async () => { (el.querySelector('[data-testid="sync-log-clear"]') as HTMLButtonElement).click(); });
    const confirm = [...document.body.querySelectorAll('button')].find(b => b.textContent === 'Clear log')!;
    await act(async () => { confirm.click(); });
    expect(el.querySelector('[data-testid="sync-status-card"]')).not.toBeNull();
    expect(el.querySelector('[data-testid="sync-status"]')?.getAttribute('data-state')).toBe('clear');
    expect(el.textContent).toContain('Details (0 events)');
    expect(el.querySelector('[data-testid="sync-log-clear"]')).toBeNull();
    expect(el.textContent).not.toContain('No sync activity yet');
  });

  it('an empty log opens showing the green status card (never a bare placeholder line)', async () => {
    const el = await mount([]);
    expect(el.querySelector('[data-testid="sync-status"]')?.getAttribute('data-state')).toBe('clear');
  });
});
