// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// Bulk-created projects came back after delete + reload. The mechanism: the
// editor keeps the last-opened project in memory (bulk finishing opens each
// one), and its autosave / teardown flush writes it back after the dashboard
// deleted it — recreating both the stored record and the registry entry.
// A deleted id must stay deleted for the life of the session.

import { describe, it, expect, beforeEach } from 'vitest';
import { deleteProjectData, loadAllMetas, loadProject, saveProject } from './projectStore';
import type { Project } from '../types';

const project = (id: string): Project => ({
  id, name: 'Bulk', script: '', sceneDetails: '', segments: [], headings: [], assets: [], textLayers: [], confirmed: true,
} as unknown as Project);

beforeEach(() => localStorage.clear());

describe('a deleted project stays deleted', () => {
  it('a late save of the deleted (still in-memory) project does not bring it back', async () => {
    const p = project('11111111-1111-4111-8111-111111111111');
    expect((await saveProject(p)).ok).toBe(true);
    await deleteProjectData(p.id);
    expect(await loadProject(p.id)).toBeNull();

    await saveProject({ ...p, name: 'autosave after delete' });

    expect(await loadProject(p.id)).toBeNull();
    expect(loadAllMetas().some(m => m.id === p.id)).toBe(false);
  });

  it('other projects still save normally', async () => {
    const a = project('22222222-2222-4222-8222-222222222222');
    const b = project('33333333-3333-4333-8333-333333333333');
    await saveProject(a); await deleteProjectData(a.id);
    expect((await saveProject(b)).ok).toBe(true);
    expect(await loadProject(b.id)).not.toBeNull();
  });
});
