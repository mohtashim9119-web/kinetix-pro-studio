// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// Deleted bulk projects came back after a reload. Measured on the operator's
// disk: projects whose store file was gone but whose MIRROR copy (and mirror
// registry entry) survived; boot-time adoption restores exactly that shape.
// The mirror copy survived because writes and deletes were dispatched
// unordered — Tauri runs the sync native commands on a thread pool — so a save
// made just before a delete could land after it.

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));
vi.mock('./tauriFfmpeg', () => ({ isTauri: () => true }));

import { invoke } from '@tauri-apps/api/core';
import { deleteMirroredProject, writeMirroredProject } from './projectMirror';
import { adoptMirroredProjects, deleteProjectData, deletedProjectIds } from './projectStore';

const mockInvoke = vi.mocked(invoke);

beforeEach(() => { mockInvoke.mockReset(); localStorage.clear(); });

describe('mirror operations are ordered', () => {
  it('a slow write dispatched BEFORE a delete finishes before the delete starts (the delete has the last word)', async () => {
    const log: string[] = [];
    mockInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === 'project_mirror_write_project') {
        log.push('write:start');
        await new Promise(r => setTimeout(r, 30));
        log.push('write:end');
      } else if (cmd === 'project_mirror_delete_project') {
        log.push('delete');
      }
    });
    void writeMirroredProject('p', '{}');
    await deleteMirroredProject('p');
    expect(log).toEqual(['write:start', 'write:end', 'delete']);
  });
});

describe('a deleted project is never adopted back from the mirror', () => {
  it('deleteProjectData records the id, waits for the mirror delete, and boot adoption skips it and cleans the stale mirror copy', async () => {
    const calls: string[] = [];
    mockInvoke.mockImplementation(async (cmd: string, args?: unknown) => {
      calls.push(cmd);
      if (cmd === 'project_store_delete' || cmd === 'project_mirror_delete_project') return undefined;
      if (cmd === 'project_mirror_read_all') {
        return {
          registry: JSON.stringify([{ id: 'gone', name: 'Bulk Project 1', savedAt: 1, segmentCount: 0 }]),
          projects: [['gone', JSON.stringify({ version: 6, savedAt: 1, project: { id: 'gone', name: 'Bulk Project 1', segments: [], assets: [] } })]],
        };
      }
      if (cmd === 'project_store_read') return null;
      if (cmd === 'project_store_write') { calls.push(`write:${(args as { id: string }).id}`); return undefined; }
      return undefined;
    });
    await deleteProjectData('gone');
    expect(deletedProjectIds().has('gone')).toBe(true);
    expect(calls).toContain('project_mirror_delete_project');

    calls.length = 0;
    const report = await adoptMirroredProjects();
    expect(report.adopted).toEqual([]);
    expect(calls).not.toContain('write:gone');
    expect(calls).toContain('project_mirror_delete_project'); // stale copy removed
    expect(JSON.parse(localStorage.getItem('kinetix:projects:v1') ?? '[]')).toEqual([]);
  });

  it('a project that was never deleted is still adopted (the safety net keeps working)', async () => {
    mockInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === 'project_mirror_read_all') {
        return { registry: null, projects: [['keep', JSON.stringify({ version: 6, savedAt: 1, project: { id: 'keep', name: 'Keep', segments: [], assets: [] } })]] };
      }
      if (cmd === 'project_store_read') return null;
      return undefined;
    });
    const report = await adoptMirroredProjects();
    expect(report.adopted).toEqual(['keep']);
  });
});
