// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// Wave 3 U7.5 — bulk creation and the auto-fire suppression rule.
//
// OLD BUG 1 (measured on the pre-U7.5 code): nothing distinguished a bulk-made
// project. A fresh project with a voiceover on the cloud engine took the
// ordinary staging path — decideStagingStart's un-flagged answer, 'start' —
// which starts a cloud transcription the moment the voiceover lands, and the
// U4.5 intent effect then aligns the moment its spine completes: two cloud
// jobs before any batch could claim the project. The first block pins that
// un-flagged answer (the bug's shape), the rest pin the flag's answer.

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn(), Channel: class {} }));

import { invoke } from '@tauri-apps/api/core';
import {
  BULK_MAX_PROJECTS, createBulkProject, decideStagingStart, isBulkAutoFireSuppressed,
  makeBulkProject, parseBulkCount, peekCloudTranscript,
} from './bulkContext';
import { loadAllMetas, loadProject, saveProject, upsertProjectMeta } from './projectStore';
import type { Project } from '../types';

const blank = (): Project => ({
  id: crypto.randomUUID(), name: 'Untitled Project',
  script: 'Welcome to Kinetix Studio.', sceneDetails: '[IMAGE: intro.jpg]\n[IMAGE: tech.jpg]',
  segments: [], headings: [], assets: [], textLayers: [], confirmed: false,
} as unknown as Project);

beforeEach(() => { localStorage.clear(); vi.mocked(invoke).mockReset(); });

describe('old bug 1 — an ordinary project has nothing stopping a cloud auto-start', () => {
  it('a project without the flag starts cloud staging on a drop, and a fresh blank project is never "suppressed"', () => {
    const p = blank();
    expect(isBulkAutoFireSuppressed(p)).toBe(false);
    expect(decideStagingStart({ project: p, host: 'cloud', explicit: false, rerun: false })).toBe('start');
  });
});

describe('suppression for bulk-context projects', () => {
  it('a bulk project that has not built only peeks (lookup-first); an explicit click or a pause answer still starts', () => {
    const p = makeBulkProject(blank(), { id: 'x', name: 'Harbour', assets: [] });
    expect(isBulkAutoFireSuppressed(p)).toBe(true);
    expect(decideStagingStart({ project: p, host: 'cloud', explicit: false, rerun: false })).toBe('lookup-first');
    expect(decideStagingStart({ project: p, host: 'cloud', explicit: true, rerun: false })).toBe('start');
    expect(decideStagingStart({ project: p, host: 'cloud', explicit: false, rerun: true })).toBe('start');
    // The local engine never used the cloud: untouched.
    expect(decideStagingStart({ project: p, host: 'local', explicit: false, rerun: false })).toBe('start');
  });

  it('after the first successful build (lastSyncSpine) normal semantics resume', () => {
    const p = { ...makeBulkProject(blank(), { id: 'x', name: 'Harbour', assets: [] }), lastSyncSpine: { audioHash: 'a', scriptHash: 's', engineKey: 'e' } } as Project;
    expect(isBulkAutoFireSuppressed(p)).toBe(false);
    expect(decideStagingStart({ project: p, host: 'cloud', explicit: false, rerun: false })).toBe('start');
  });

  it('the flag persists across a reload (real project store round trip)', async () => {
    const ok = await createBulkProject({ id: '44444444-4444-4444-8444-444444444444', name: 'Harbour', assets: [] },
      { makeBlankProject: blank, save: p => saveProject(p), upsertMeta: upsertProjectMeta });
    expect(ok).toBe(true);
    const reloaded = await loadProject('44444444-4444-4444-8444-444444444444');
    expect(reloaded?.project.bulkContext).toBe(true);
    expect(isBulkAutoFireSuppressed(reloaded!.project)).toBe(true);
  });

  it('the peek is one lookup and never a job: a hit says yes, a miss or any failure says no', async () => {
    const calls: string[] = [];
    vi.mocked(invoke).mockImplementation(async (cmd: string) => {
      calls.push(cmd);
      if (calls.length === 1) return { cached: true, result: {} };
      if (calls.length === 2) return { cached: false, audioPresent: true, audioDurationSec: 3 };
      throw { kind: 'unreachable', detail: 'x' };
    });
    expect(await peekCloudTranscript('h', undefined)).toBe(true);
    expect(await peekCloudTranscript('h', 'en')).toBe(false);
    expect(await peekCloudTranscript('h', 'en')).toBe(false);
    expect(new Set(calls)).toEqual(new Set(['cloud_cache_lookup']));
  });
});

describe('creation — one project per real row, at Build Timeline', () => {
  it('creates the named project with the row\'s id and bundle media, registered, EMPTY of placeholder script/scene', async () => {
    const asset = { id: 'a1', name: 'a.jpg', type: 'image' } as never;
    const ok = await createBulkProject({ id: '55555555-5555-4555-8555-555555555555', name: 'Alpine', assets: [asset] },
      { makeBlankProject: blank, save: p => saveProject(p), upsertMeta: upsertProjectMeta });
    expect(ok).toBe(true);
    const stored = (await loadProject('55555555-5555-4555-8555-555555555555'))!.project;
    expect(stored).toMatchObject({ name: 'Alpine', script: '', sceneDetails: '', confirmed: true, bulkContext: true });
    expect(stored.assets.map(a => a.id)).toEqual(['a1']);
    expect(loadAllMetas().map(m => m.name)).toEqual(['Alpine']);
  });

  it('a failed save creates nothing and says so (false)', async () => {
    let metas = 0;
    const ok = await createBulkProject({ id: 'x', name: 'n', assets: [] },
      { makeBlankProject: blank, save: async () => ({ ok: false }), upsertMeta: () => { metas++; } });
    expect(ok).toBe(false);
    expect(metas).toBe(0);
  });

  it('the quantity is a whole number from 1 to the cap (25)', () => {
    expect(BULK_MAX_PROJECTS).toBe(25);
    expect(parseBulkCount('3')).toBe(3);
    expect(parseBulkCount(' 25 ')).toBe(25);
    for (const bad of ['0', '26', '', '2.5', '-1', 'abc']) expect(parseBulkCount(bad)).toBeNull();
    expect(parseBulkCount('30', 40)).toBe(30);
  });
});
