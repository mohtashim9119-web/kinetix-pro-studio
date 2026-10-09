/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// Dashboard revamp — the permanent left panel's three tabs, and the last
// active one, persisted so a reload lands where the operator left off.

export type DashboardLeftTab = 'workspaces' | 'bulk-sync' | 'bulk-export';

export const DASHBOARD_LEFT_TABS: readonly { id: DashboardLeftTab; label: string }[] = [
  { id: 'workspaces', label: 'Workspaces' },
  { id: 'bulk-sync', label: 'Bulk Sync' },
  { id: 'bulk-export', label: 'Bulk Export' },
];

export const DASHBOARD_LEFT_TAB_KEY = 'kinetix:dashboard-left-tab:v1';
/** The old drawers' open flags: read once (first boot after the revamp) so an
 *  operator who had a drawer open lands on its tab. Never written again. */
const LEGACY_BULK_DRAWER_OPEN_KEY = 'kinetix:bulk-drawer-open:v1';
const LEGACY_EXPORT_DRAWER_OPEN_KEY = 'kinetix:bulk-export-drawer-open:v1';

const isTab = (v: unknown): v is DashboardLeftTab => v === 'workspaces' || v === 'bulk-sync' || v === 'bulk-export';

export function readDashboardLeftTab(
  storage: Pick<Storage, 'getItem'> | undefined = typeof localStorage !== 'undefined' ? localStorage : undefined,
): DashboardLeftTab {
  try {
    const raw = storage?.getItem(DASHBOARD_LEFT_TAB_KEY);
    if (isTab(raw)) return raw;
    if (raw == null) {
      if (storage?.getItem(LEGACY_EXPORT_DRAWER_OPEN_KEY) === '1') return 'bulk-export';
      if (storage?.getItem(LEGACY_BULK_DRAWER_OPEN_KEY) === '1') return 'bulk-sync';
    }
  } catch { /* storage unavailable */ }
  return 'workspaces';
}

export function writeDashboardLeftTab(
  tab: DashboardLeftTab,
  storage: Pick<Storage, 'setItem'> | undefined = typeof localStorage !== 'undefined' ? localStorage : undefined,
): void {
  try { storage?.setItem(DASHBOARD_LEFT_TAB_KEY, tab); } catch { /* storage unavailable: the panel starts on Workspaces */ }
}
