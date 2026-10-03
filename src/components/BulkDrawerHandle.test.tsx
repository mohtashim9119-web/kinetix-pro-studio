// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// Operator checklist (bulk UI):
// 4. Open a project from a bulk row → editor shows zero bulk UI (no drawer,
//    no left-edge handle, no badge, no dashboard bulk button).
// 5. Back to the dashboard → Bulk Projects button + live progress intact.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(process.cwd());
const read = (rel: string): string => readFileSync(resolve(ROOT, rel), 'utf8');

describe('editor has no bulk affordances', () => {
  it('App never mounts a bulk drawer handle or editor-side bulk tab', () => {
    const app = read('src/App.tsx');
    expect(app).not.toMatch(/BulkDrawerHandle/);
    expect(app).not.toMatch(/bulk-drawer-handle/);
    expect(app).toContain('hidden={bulkHidden || !showDashboard}');
  });

  it('dashboard still renders the bulk button with progress', () => {
    const dash = read('src/components/ProjectDashboard.tsx');
    expect(dash).toContain('data-testid="dashboard-bulk"');
    expect(dash).toContain('dashboard-bulk-count');
    expect(dash).toContain('ProgressRing');
    expect(dash).toContain('FailedDot');
  });
});
