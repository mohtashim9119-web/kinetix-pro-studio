/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// Dashboard revamp Stage 6 — the last active left tab persists, and the dead
// drawer / dock / close-button paths are gone.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { DASHBOARD_LEFT_TAB_KEY, readDashboardLeftTab, writeDashboardLeftTab } from './dashboardLeftTab';

const mem = (seed: Record<string, string> = {}): Pick<Storage, 'getItem' | 'setItem'> => {
  const m = new Map(Object.entries(seed));
  return { getItem: k => m.get(k) ?? null, setItem: (k, v) => { m.set(k, String(v)); } };
};

describe('last active left tab', () => {
  it('defaults to Workspaces', () => {
    expect(readDashboardLeftTab(mem())).toBe('workspaces');
  });

  it('round-trips every tab through kinetix:dashboard-left-tab:v1', () => {
    const s = mem();
    for (const tab of ['bulk-sync', 'bulk-export', 'workspaces'] as const) {
      writeDashboardLeftTab(tab, s);
      expect(s.getItem(DASHBOARD_LEFT_TAB_KEY)).toBe(tab);
      expect(readDashboardLeftTab(s)).toBe(tab);
    }
  });

  it('an unknown stored value falls back to Workspaces', () => {
    expect(readDashboardLeftTab(mem({ [DASHBOARD_LEFT_TAB_KEY]: 'drawer' }))).toBe('workspaces');
  });

  it('first boot after the revamp: an open old drawer lands on its tab (export wins, as it did)', () => {
    expect(readDashboardLeftTab(mem({ 'kinetix:bulk-drawer-open:v1': '1' }))).toBe('bulk-sync');
    expect(readDashboardLeftTab(mem({ 'kinetix:bulk-export-drawer-open:v1': '1' }))).toBe('bulk-export');
    expect(readDashboardLeftTab(mem({ 'kinetix:bulk-drawer-open:v1': '1', 'kinetix:bulk-export-drawer-open:v1': '1' }))).toBe('bulk-export');
  });

  it('once a tab is stored, the old drawer flags are ignored', () => {
    expect(readDashboardLeftTab(mem({ [DASHBOARD_LEFT_TAB_KEY]: 'workspaces', 'kinetix:bulk-drawer-open:v1': '1' }))).toBe('workspaces');
  });

  it('storage that throws reads as Workspaces and writes are swallowed', () => {
    const broken = { getItem: () => { throw new Error('denied'); }, setItem: () => { throw new Error('denied'); } };
    expect(readDashboardLeftTab(broken)).toBe('workspaces');
    expect(() => writeDashboardLeftTab('bulk-sync', broken)).not.toThrow();
  });
});

describe('App wiring (source contract)', () => {
  const app = readFileSync(resolve(process.cwd(), 'src/App.tsx'), 'utf8');
  const dash = readFileSync(resolve(process.cwd(), 'src/components/ProjectDashboard.tsx'), 'utf8');

  it('App owns the tab, restores it at boot and writes it on change', () => {
    expect(app).toContain('useState<DashboardLeftTab>(readDashboardLeftTab)');
    expect(app).toContain('writeDashboardLeftTab(dashboardLeftTab)');
  });

  it('a reload that lands on a bulk tab mounts that pane at boot', () => {
    expect(app).toContain("useState(() => dashboardLeftTab === 'bulk-sync')");
    expect(app).toContain("useState(() => dashboardLeftTab === 'bulk-export')");
  });

  it('the old drawer / dock / close paths are gone', () => {
    for (const dead of ['toggleBulkDrawer', 'toggleExportDrawer', 'bulkHidden', 'exportHidden', 'bulkDockWide', 'BULK_DRAWER_WIDTH', 'readBulkDrawerOpen', 'onClose={() => setBulkHidden']) {
      expect(app, dead).not.toContain(dead);
    }
    for (const dead of ['bulkDockInset', 'DOCK_MOTION', 'playFlip', 'data-flip', 'dashboard-bulk-export', 'data-testid="dashboard-bulk"']) {
      expect(dash, dead).not.toContain(dead);
    }
  });
});
