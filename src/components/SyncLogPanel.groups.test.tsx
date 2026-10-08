// @vitest-environment jsdom
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// Sync log panel — 3-group hierarchy per sync run (Actions / Warnings / Info),
// rendered. The grouping rules themselves are pinned in syncLogGroups.test.ts;
// these pin what the user actually sees and clicks.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';
import type { ComponentProps } from 'react';
import { SyncLogPanel } from './SyncLogPanel';
import type { SyncLogEntry, SyncRunSummary } from '../types';
import { makeSyncLogEntry } from '../services/syncLog';

const AT = Date.now() - 5 * 60_000;
let n = 0;
const e = (run: string, type: SyncLogEntry['type'], over: Partial<SyncLogEntry> = {}, t = AT): SyncLogEntry =>
  ({ ...makeSyncLogEntry(run, type, `${type} msg`, undefined, t), id: `g${n++}`, ...over });
const sum = (run: string, t = AT): SyncRunSummary =>
  ({ syncRunId: run, timestamp: t, totalSegments: 3, coveredSegments: 3, skippedSegments: 0, aborted: false });

let container: HTMLDivElement;
let root: Root | undefined;
beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  sessionStorage.clear();
  localStorage.clear();
});
afterEach(() => { if (root) act(() => root!.unmount()); root = undefined; container.remove(); });

type P = ComponentProps<typeof SyncLogPanel>;
function render(props: Partial<P>): void {
  const full: P = { syncLog: [], onClearLog: () => {}, ...props };
  if (!root) root = createRoot(container);
  act(() => root!.render(<SyncLogPanel {...full} />));
}
const q = (sel: string): Element | null => container.querySelector(sel);
const qa = (sel: string): Element[] => [...container.querySelectorAll(sel)];
const click = (el: Element | null | undefined): void => {
  expect(el).toBeTruthy();
  act(() => { el!.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
};
const headline = (): string => q('[data-testid="sync-status-text"]')?.textContent ?? '';
const card = (run: string, id: string): Element => q(`[data-run="${run}"] [data-card="${id}"]`)!;
const openCard = (run: string, id: string): void => click(card(run, id).querySelector('button'));

describe('structure', () => {
  it('one group per sync with exactly three cards in order, all collapsed; newest open and live', () => {
    render({ syncLog: [e('r1', 'rule-correction')], syncRunSummaries: [sum('r1')] });
    const group = q('[data-testid="sync-group"]')!;
    expect(group.getAttribute('data-live')).toBe('true');
    expect(group.textContent).toContain('SYNC 1');
    expect(group.textContent).toContain('5m ago');
    expect(qa('[data-testid="sync-card"]').map(c => c.getAttribute('data-card'))).toEqual(['actions', 'warnings', 'info']);
    for (const c of qa('[data-testid="sync-card"]')) expect(c.querySelector('button')?.getAttribute('aria-expanded')).toBe('false');
  });

  it('all clear: green headline with no number; Actions chip is a dot, not a number', () => {
    render({ syncLog: [e('r1', 'rule-correction')], syncRunSummaries: [sum('r1')] });
    expect(headline()).toBe('All clear — exports unblocked');
    expect(q('[data-testid="sync-status"]')?.getAttribute('data-tone')).toBe('green');
    expect(card('r1', 'actions').querySelector('[data-testid="sync-card-chip"]')?.textContent).toBe('');
  });

  it('Info shows the run summary line', () => {
    render({ syncLog: [e('r1', 'rule-correction')], syncRunSummaries: [sum('r1')] });
    openCard('r1', 'info');
    expect(q('[data-testid="sync-summary-line"]')?.textContent).toBe('3/3 matched · 0 skipped · 0 estimated');
  });
});

describe('headline counts only Actions', () => {
  it('a warning alone keeps the headline green but shows a Warnings chip', () => {
    const weak = e('r1', 'warning', { finding: { kind: 'weak-match' } });
    render({ syncLog: [weak], syncRunSummaries: [sum('r1')] });
    expect(headline()).toBe('All clear — exports unblocked');
    expect(card('r1', 'warnings').querySelector('[data-testid="sync-card-chip"]')?.textContent).toBe('1');
  });
});

describe('live actions', () => {
  const segs = (ids: Array<string | undefined>) => ids.map((assetId, i) => ({ id: `s${i}`, assetId, text: `scene ${i}` }));
  const assets = [{ id: 'a', name: 'a.png', url: 'blob:a' }];

  it('missing media raises the headline, offers Add media, and clears itself when media arrives', () => {
    const onAddMedia = vi.fn();
    render({ syncLog: [], syncRunSummaries: [sum('r1')], segments: segs([undefined, 'a']), assets, onAddMedia });
    expect(headline()).toBe('1 item needs your attention');
    expect(q('[data-testid="sync-status"]')?.getAttribute('data-tone')).toBe('amber');
    openCard('r1', 'actions');
    click(q('[data-action="missing-media"] button'));
    click(q('[data-action="missing-media"] [data-testid="sync-cta"]'));
    expect(onAddMedia).toHaveBeenCalledTimes(1);
    render({ syncLog: [], syncRunSummaries: [sum('r1')], segments: segs(['a', 'a']), assets, onAddMedia });
    expect(headline()).toBe('All clear — exports unblocked');
    expect(q('[data-action="missing-media"]')).toBeNull();
  });

  it('clicking a scene jumps to it', () => {
    const onSeekToSegment = vi.fn();
    render({ syncLog: [], syncRunSummaries: [sum('r1')], segments: segs([undefined]), assets, onSeekToSegment });
    openCard('r1', 'actions');
    click(q('[data-action="missing-media"] button'));
    click(q('[data-action="missing-media"] [data-testid="sync-item"]'));
    expect(onSeekToSegment).toHaveBeenCalledWith('s0');
  });

  it('offline media is red and Relink passes the first offline asset', () => {
    const onRelinkOffline = vi.fn();
    render({
      syncLog: [], syncRunSummaries: [sum('r1')],
      segments: [{ id: 's0', assetId: 'off' }],
      assets: [{ id: 'off', name: 'broll.mp4', url: '', unresolved: true }],
      onRelinkOffline,
    });
    expect(q('[data-testid="sync-status"]')?.getAttribute('data-tone')).toBe('red');
    openCard('r1', 'actions');
    click(q('[data-action="offline-media"] button'));
    click(q('[data-action="offline-media"] [data-testid="sync-cta"]'));
    expect(onRelinkOffline).toHaveBeenCalledWith('off');
  });

  it('Sync stopped offers Retry', () => {
    const onRetrySync = vi.fn();
    render({ syncLog: [e('r1', 'abort')], syncRunSummaries: [sum('r1')], onRetrySync });
    openCard('r1', 'actions');
    click(q('[data-action="sync-stopped"] button'));
    click(q('[data-action="sync-stopped"] [data-testid="sync-cta"]'));
    expect(onRetrySync).toHaveBeenCalledTimes(1);
  });
});

describe('warnings dismissal', () => {
  const w = (run: string, t = AT) => e(run, 'warning', { finding: { kind: 'weak-match' } }, t);

  it('per-item tick removes it and persists across a remount', () => {
    const log = [w('r1'), w('r1')];
    render({ syncLog: log, syncRunSummaries: [sum('r1')] });
    openCard('r1', 'warnings');
    click(q('[data-warning="text-fit"] button'));
    expect(qa('[data-testid="sync-warning-dismiss"]')).toHaveLength(2);
    click(qa('[data-testid="sync-warning-dismiss"]')[0]);
    expect(qa('[data-warning="text-fit"] [data-testid="sync-item"]')).toHaveLength(1);
    act(() => root!.unmount()); root = undefined;
    render({ syncLog: log, syncRunSummaries: [sum('r1')] });
    expect(card('r1', 'warnings').querySelector('[data-testid="sync-card-chip"]')?.textContent).toBe('1');
  });

  it('Dismiss all clears the card; the next sync brings the same kind back', () => {
    render({ syncLog: [w('r1')], syncRunSummaries: [sum('r1')] });
    click(q('[data-testid="sync-warnings-dismiss-all"]'));
    expect(card('r1', 'warnings').querySelector('[data-testid="sync-card-chip"]')?.textContent).toBe('');
    render({ syncLog: [w('r1'), w('r2', AT + 60_000)], syncRunSummaries: [sum('r1'), sum('r2', AT + 60_000)] });
    expect(card('r2', 'warnings').querySelector('[data-testid="sync-card-chip"]')?.textContent).toBe('1');
  });
});

describe('older syncs are frozen', () => {
  it('older groups are not live, start collapsed, and offer no dismiss or action buttons', () => {
    const log = [e('r1', 'abort', {}, AT), e('r1', 'warning', { finding: { kind: 'weak-match' } }, AT), e('r2', 'rule-correction', {}, AT + 60_000)];
    render({ syncLog: log, syncRunSummaries: [sum('r1'), sum('r2', AT + 60_000)], onRetrySync: () => {} });
    const older = q('[data-run="r1"]')!;
    expect(older.getAttribute('data-live')).toBe('false');
    click(older.querySelector('button'));
    openCard('r1', 'actions');
    click(q('[data-run="r1"] [data-action="sync-stopped"] button'));
    expect(q('[data-run="r1"] [data-testid="sync-cta"]')).toBeNull();
    openCard('r1', 'warnings');
    expect(q('[data-run="r1"] [data-testid="sync-warnings-dismiss-all"]')).toBeNull();
  });

  it('shows five syncs, the rest under a collapsed "Earlier syncs"', () => {
    const sums = Array.from({ length: 7 }, (_, i) => sum(`r${i + 1}`, AT + i * 1000));
    render({ syncLog: sums.map(s => e(s.syncRunId, 'rule-correction', {}, s.timestamp)), syncRunSummaries: sums });
    expect(qa('[data-testid="sync-group"]')).toHaveLength(5);
    expect(q('[data-testid="sync-earlier"]')?.textContent).toContain('Earlier syncs (2)');
    click(q('[data-testid="sync-earlier"] button'));
    expect(qa('[data-testid="sync-group"]')).toHaveLength(7);
  });
});

describe('hidden lines never render', () => {
  it('preflight OK, malformed tokens and lock-preserved never show, even fully expanded', () => {
    const log = [
      e('r1', 'fa-preflight', { severity: 'info', message: 'PREFLIGHT_OK' }),
      e('r1', 'malformed-token', { message: 'MALFORMED' }),
      e('r1', 'lock-preserved-adjustment', { message: 'LOCKPRESERVED' }),
      e('r1', 'rule-correction'),
    ];
    render({ syncLog: log, syncRunSummaries: [sum('r1')] });
    for (const c of ['actions', 'warnings', 'info']) openCard('r1', c);
    click(q('[data-testid="sync-more-details"] button'));
    for (const b of qa('[data-testid="sync-more-section"] > button')) click(b);
    for (const t of ['PREFLIGHT_OK', 'MALFORMED', 'LOCKPRESERVED']) expect(container.textContent).not.toContain(t);
    expect(container.textContent).not.toContain('Engine not recorded');
  });
});
