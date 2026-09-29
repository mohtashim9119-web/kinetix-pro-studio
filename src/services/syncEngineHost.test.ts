// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// Wave 3 U2 — the Cloud/Local host, its place in the ONE engine resolver,
// and the honesty requirements hanging off it: config-only resolution (no
// IPC, ever — it runs inside the spine's "already synced" check), keys that
// can never match across hosts, and a Sync Log that names the cloud engine.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Mock } from 'vitest';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn(), Channel: class {} }));
vi.mock('./tauriFfmpeg', () => ({ isTauri: vi.fn(() => true) }));

import { invoke } from '@tauri-apps/api/core';
import {
  DEFAULT_SYNC_ENGINE_HOST,
  SYNC_ENGINE_HOST_KEY,
  clearRunHostOverride,
  hostForRun,
  onSyncEngineHostChange,
  readRunHostOverride,
  saveRunHostOverride,
  shouldStartStaging,
  readSyncEngineHost,
  writeSyncEngineHost,
} from './syncEngineHost';
import { computeSyncEngineKey, resolveSyncEngine } from './faPreflight';
import { spineEquals } from './spine';
import { buildSyncEngineEntry } from './syncLog';
import { buildSyncLogUserView } from './syncLogUserView';
import { formatHeadline } from '../components/SyncLogPanel';

const mockInvoke = invoke as unknown as Mock;

beforeEach(() => {
  localStorage.clear();
  mockInvoke.mockReset();
});

describe('Wave 3 U4 — hostForRun (one-run local override)', () => {
  const override = { projectId: 'p1', audioHash: 'h1', host: 'local' as const, reason: 'offline' };
  it('applies to exactly its project + audio, and nothing else', () => {
    expect(hostForRun('cloud', override, { projectId: 'p1', audioHash: 'h1' })).toBe('local');
    expect(hostForRun('cloud', override, { projectId: 'p1', audioHash: 'h2' })).toBe('cloud');
    expect(hostForRun('cloud', override, { projectId: 'p2', audioHash: 'h1' })).toBe('cloud');
    expect(hostForRun('cloud', override, { projectId: 'p1', audioHash: undefined })).toBe('cloud');
    expect(hostForRun('cloud', null, { projectId: 'p1', audioHash: 'h1' })).toBe('cloud');
    expect(hostForRun('local', null, { projectId: 'p1', audioHash: 'h1' })).toBe('local');
  });
  it('never touches the standing choice', () => {
    writeSyncEngineHost('cloud');
    hostForRun(readSyncEngineHost(), override, { projectId: 'p1', audioHash: 'h1' });
    expect(readSyncEngineHost()).toBe('cloud');
    expect(localStorage.getItem(SYNC_ENGINE_HOST_KEY)).toBe('cloud');
  });
});

// U4 hotfix — the operator's click check: "Transcribe on this computer" (and
// "Try the cloud again") did nothing, and a reload lost the choice. Runtime
// probes showed both answers re-driving staging with the file already
// pending, which the plain re-drop guard refuses. These fail on dac689a.
describe('U4 hotfix — explicit re-run restarts staging; the choice survives a reload', () => {
  const ID = 'vo20.m4a|317996|1790536224000';
  it('a dialog answer (rerun) restarts staging for the SAME pending file', () => {
    expect(shouldStartStaging({ pendingIdentity: ID, incomingIdentity: ID, rerun: true })).toBe(true);
  });
  it('a plain re-drop of the pending file stays a no-op; a new file always starts', () => {
    expect(shouldStartStaging({ pendingIdentity: ID, incomingIdentity: ID, rerun: false })).toBe(false);
    expect(shouldStartStaging({ pendingIdentity: ID, incomingIdentity: 'other|1|1', rerun: false })).toBe(true);
    expect(shouldStartStaging({ pendingIdentity: undefined, incomingIdentity: ID, rerun: false })).toBe(true);
  });
  it('a recorded local choice is read back per project, and cleared when its sync commits', () => {
    const o = { projectId: 'p1', audioHash: 'h1', host: 'local' as const, reason: 'offline' };
    saveRunHostOverride(o);
    expect(readRunHostOverride('p1')).toEqual(o);
    expect(readRunHostOverride('p2')).toBeNull();
    clearRunHostOverride('p1');
    expect(readRunHostOverride('p1')).toBeNull();
  });
  it('survives a fresh module load (a reload) — the gap the click check hit', async () => {
    saveRunHostOverride({ projectId: 'p1', audioHash: 'h1', host: 'local', reason: 'offline' });
    vi.resetModules();
    const fresh = await import('./syncEngineHost');
    const override = fresh.readRunHostOverride('p1');
    expect(fresh.hostForRun('cloud', override, { projectId: 'p1', audioHash: 'h1' })).toBe('local');
    // The standing choice was never written by the override.
    expect(localStorage.getItem(SYNC_ENGINE_HOST_KEY)).toBeNull();
  });
  it('refuses a malformed stored record rather than guessing an engine', () => {
    localStorage.setItem('kinetix:run-host-override:v1:p1', JSON.stringify({ projectId: 'p1', audioHash: 'h1', host: 'cloud', reason: 'x' }));
    expect(readRunHostOverride('p1')).toBeNull();
    localStorage.setItem('kinetix:run-host-override:v1:p1', '{not json');
    expect(readRunHostOverride('p1')).toBeNull();
  });
});

describe('syncEngineHost', () => {
  it('defaults to Local until the team opts in (D3)', () => {
    expect(DEFAULT_SYNC_ENGINE_HOST).toBe('local');
    expect(readSyncEngineHost()).toBe('local');
  });

  it('persists the choice and notifies subscribers; junk reads as the default', () => {
    const seen: string[] = [];
    const off = onSyncEngineHostChange(h => seen.push(h));
    writeSyncEngineHost('cloud');
    expect(readSyncEngineHost()).toBe('cloud');
    expect(localStorage.getItem(SYNC_ENGINE_HOST_KEY)).toBe('cloud');
    off();
    writeSyncEngineHost('local');
    expect(seen).toEqual(['cloud']);
    localStorage.setItem(SYNC_ENGINE_HOST_KEY, 'mars');
    expect(readSyncEngineHost()).toBe('local');
  });
});

describe('resolveSyncEngine — cloud host', () => {
  it('is config-only: FA toggle on → cloud:fa, off → cloud:whisper, and NEVER touches IPC', async () => {
    const on = await resolveSyncEngine({ faHighPrecisionSync: true, language: 'en' }, 'cloud');
    const off = await resolveSyncEngine({ faHighPrecisionSync: false, language: 'en' }, 'cloud');
    expect(on).toEqual({ engine: 'cloud', gateOpen: true, ready: true, preflight: undefined, key: 'cloud:fa', host: 'cloud' });
    expect(off).toMatchObject({ engine: 'cloud', gateOpen: false, key: 'cloud:whisper' });
    expect(mockInvoke).not.toHaveBeenCalled();
  });

  it('reads the standing host when none is passed', async () => {
    writeSyncEngineHost('cloud');
    expect(await computeSyncEngineKey({ faHighPrecisionSync: false })).toBe('cloud:whisper');
    writeSyncEngineHost('local');
    expect(await computeSyncEngineKey({ faHighPrecisionSync: false })).toBe('whisper');
  });

  it('"Already synced" stays honest across an engine switch: no cloud key equals any local key', async () => {
    mockInvoke.mockResolvedValue({ ready: true, featureCompiled: true, modelPresent: true, runtimeLoaded: true, language: 'en' });
    const localKeys = new Set<string>();
    const cloudKeys = new Set<string>();
    for (const fa of [true, false]) {
      localKeys.add(await computeSyncEngineKey({ faHighPrecisionSync: fa, language: 'en' }, 'local'));
      cloudKeys.add(await computeSyncEngineKey({ faHighPrecisionSync: fa, language: 'en' }, 'cloud'));
    }
    for (const k of cloudKeys) expect(localKeys.has(k)).toBe(false);

    const stampedLocally = { audioHash: 'a', scriptHash: 's', engineKey: 'whisper' };
    const nowOnCloud = { audioHash: 'a', scriptHash: 's', engineKey: 'cloud:whisper' };
    expect(spineEquals(stampedLocally, nowOnCloud)).toBe(false);
    expect(spineEquals(nowOnCloud, { ...nowOnCloud })).toBe(true);
  });
});

describe('Sync Log names the cloud engine', () => {
  it('the engine line carries model + revision, and the headline says "(cloud)"', () => {
    const entry = buildSyncEngineEntry('run1', 'forced-alignment', 3874, 1000, {
      model: 'mohtashim9/kinetix-fa-models/en',
      modelVersion: 'f618960d71728eba5f12528d5571838a10d262bf+ort-1.23.2+port-1',
    });
    expect(entry.message).toBe(
      'Timing engine: forced alignment on the cloud (mohtashim9/kinetix-fa-models/en @ f618960d7172) (3874 aligned word(s)).',
    );
    expect(entry.finding).toEqual({ kind: 'engine-forced-alignment-cloud' });
    const view = buildSyncLogUserView([entry]);
    expect(formatHeadline(view.headline)).toMatch(/^Forced alignment \(cloud\)/);

    const whisperCloud = buildSyncEngineEntry('run2', 'whisper', 10, 2000, { model: 'm', modelVersion: 'v' });
    expect(formatHeadline(buildSyncLogUserView([whisperCloud]).headline)).toMatch(/^Whisper \(cloud\)/);
  });

  it('Wave 3 U3 — a cache-served cloud run says so in the engine line; the headline is unchanged', () => {
    const entry = buildSyncEngineEntry('run1', 'forced-alignment', 3874, 1000, {
      model: 'mohtashim9/kinetix-fa-models/en', modelVersion: 'f618960d71728eba5f12528d5571838a10d262bf+ort-1.23.2+port-1', cached: true,
    });
    expect(entry.message).toBe(
      'Timing engine: forced alignment on the cloud (mohtashim9/kinetix-fa-models/en @ f618960d7172, served from the cloud cache — nothing uploaded, no GPU charge) (3874 aligned word(s)).',
    );
    expect(entry.finding).toEqual({ kind: 'engine-forced-alignment-cloud' });
    expect(formatHeadline(buildSyncLogUserView([entry]).headline)).toMatch(/^Forced alignment \(cloud\)/);
    const computed = buildSyncEngineEntry('run2', 'forced-alignment', 3874, 1000, { model: 'm', modelVersion: 'v', cached: false });
    expect(computed.message).not.toContain('cache');
  });

  it('a local run reads exactly as before', () => {
    const entry = buildSyncEngineEntry('run1', 'whisper', 12, 1000);
    expect(entry.message).toBe('Timing engine: Whisper transcript (12 token(s)).');
    expect(formatHeadline(buildSyncLogUserView([entry]).headline)).toMatch(/^Whisper ·/);
  });
});
