// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// Row 2 of a bulk batch timed out in finalizeBulkProject: the transcript was
// cached on the gateway, and the finish path only polled transcriptionReady.
// bulkContext suppresses auto-start. The project switch cancels the one
// shared whisper before that row's adopt can commit tokens, the staged file
// is already showing, and the poll reports "its transcript is not ready".

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { TranscriptToken } from '../types';
import { decideStagingStart, isBulkAutoFireSuppressed, peekCloudTranscript } from './bulkContext';
import { lookupBatchTranscript, runBulkProjectFinish, type BulkReady, isOperatorActivelyEditing, BULK_ACTIVE_EDIT_MS } from './bulkFinish';
import { __resetStageGapsForTests, noteStageGap, STAGE_GAP_WARN_MS } from './cloudSyncEngine';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn(), Channel: class {} }));

import { invoke } from '@tauri-apps/api/core';

const TOKENS: TranscriptToken[] = [{ text: 'hello', startSec: 0, endSec: 1 }];

interface Whisper {
  generation: number;
  phase: 'idle' | 'transcribing' | 'done';
  targetId: string;
  inFlight: string | null;
  pendingId: string | null;
  pendingHash: string | undefined;
  tokens: TranscriptToken[];
  lastHash: string | undefined;
  lastAssetId: string | undefined;
  cancels: string[];
}

function whisper(): Whisper {
  return {
    generation: 0, phase: 'idle', targetId: '', inFlight: null, pendingId: null,
    pendingHash: undefined, tokens: [], lastHash: undefined, lastAssetId: undefined, cancels: [],
  };
}

function cancel(w: Whisper, why: string, protect: string | null): void {
  if (protect && w.inFlight === protect) return;
  w.cancels.push(why);
  w.generation += 1;
  w.phase = 'idle';
  w.inFlight = null;
  w.pendingId = null;
  w.pendingHash = undefined;
}

/** The editor state the passive poll reads. Mirrors App's transcriptionReady. */
function readyOf(w: Whisper, projectId: string, staged: boolean): BulkReady {
  const effective = w.pendingId ?? undefined;
  const transcriptionReady =
    (w.phase === 'done' && w.targetId === effective)
    || (!!effective && w.lastAssetId === effective && w.tokens.length > 0)
    || (!!w.pendingHash && w.lastHash === w.pendingHash && w.tokens.length > 0);
  return {
    projectId,
    built: false,
    ready: staged && transcriptionReady,
    why: !staged ? 'its staged files are still restoring' : !transcriptionReady ? 'its transcript is not ready' : '',
  };
}

/**
 * What App did before the active finish: switch cancels the shared whisper,
 * restore peeks, a second switch-time cancel lands after the start, the
 * staged file is published, tokens never commit.
 */
async function passiveRow(w: Whisper, projectId: string, language: string | undefined): Promise<{ ready: BulkReady; miss: string; cached: boolean }> {
  const project = { bulkContext: true as const, lastSyncSpine: undefined, language };
  cancel(w, 'switch', null);
  const staged = true;
  let miss = 'none';
  const cached = await peekCloudTranscript('hash', language);
  if (isBulkAutoFireSuppressed(project) && decideStagingStart({ project, host: 'cloud', explicit: false, rerun: false }) === 'lookup-first') {
    if (!cached) miss = 'peek-key';
    else {
      const generation = ++w.generation;
      w.inFlight = projectId;
      w.phase = 'transcribing';
      w.pendingId = 'asset';
      w.pendingHash = 'hash';
      w.targetId = 'asset';
      // The switch's cancel of the shared instance lands before the run commits.
      cancel(w, 'switch-before-adopt', null);
      if (w.generation !== generation) miss = 'switch-cancelled-whisper';
      else {
        w.tokens = TOKENS;
        w.lastHash = 'hash';
        w.lastAssetId = 'asset';
        w.phase = 'done';
      }
    }
  }
  if (miss === 'none' && !readyOf(w, projectId, staged).ready) miss = 'restore-timing';
  return { ready: readyOf(w, projectId, staged), miss, cached };
}

beforeEach(() => { vi.mocked(invoke).mockReset(); });

function cacheHit(language: string) {
  vi.mocked(invoke).mockImplementation(async (_cmd: string, args?: unknown) => {
    const languageArg = (args as { job?: { language?: string } } | undefined)?.job?.language;
    if (languageArg === language) return { cached: true, result: { tokens: TOKENS } };
    return { cached: false, audioPresent: true, audioDurationSec: 1 };
  });
}

describe('row 2 finish — the passive poll', () => {
  it('pins switch-cancelled-whisper: the transcript is cached and the poll still times out', async () => {
    cacheHit('en');
    const w = whisper();
    const row = await passiveRow(w, 'row-2', 'en');
    expect(row.cached).toBe(true);
    expect(row.miss).toBe('switch-cancelled-whisper');
    expect(row.ready.why).toBe('its transcript is not ready');
    expect(w.cancels).toContain('switch-before-adopt');
  });

  it('pins a peek-key miss when the lookup language is not the batch key', async () => {
    cacheHit('en');
    const w = whisper();
    const row = await passiveRow(w, 'row-2', undefined);
    expect(row.cached).toBe(false);
    expect(row.miss).toBe('peek-key');
    expect(await lookupBatchTranscript('hash', undefined)).toBeNull();
    expect(await lookupBatchTranscript('hash', 'en')).toEqual({ tokens: TOKENS, language: 'en' });
  });
});

describe('row 2 finish — active', () => {
  async function finishRow(language: string | undefined): Promise<{ ok: boolean; message?: string; forced: boolean }> {
    cacheHit('en');
    let forced = false;
    let tokens: TranscriptToken[] = [];
    let hash: string | undefined;
    const result = await runBulkProjectFinish('row-2', {
      switchProject: async () => {},
      adoptCachedTranscript: async () => {
        const found = await lookupBatchTranscript('hash', language);
        if (!found) return false;
        tokens = found.tokens;
        hash = 'hash';
        return true;
      },
      forceStartTranscription: async () => { forced = true; tokens = TOKENS; hash = 'hash'; },
      readReady: () => ({
        projectId: 'row-2', ready: tokens.length > 0 && hash === 'hash', built: false, why: tokens.length ? '' : 'its transcript is not ready',
      }),
      applySync: async () => ({ ok: true }),
      saveNow: async () => {},
    }, 1_000);
    return { ...result, forced };
  }

  it('adopts the cached transcript and builds inside the window', async () => {
    const result = await finishRow('en');
    expect(result.ok).toBe(true);
    expect(result.forced).toBe(false);
    expect(result.message).toBeUndefined();
  });

  it('force-starts when the cache genuinely misses (suppression does not block the batch)', async () => {
    vi.mocked(invoke).mockResolvedValue({ cached: false, audioPresent: true, audioDurationSec: 1 });
    let forced = false;
    const result = await runBulkProjectFinish('row-2', {
      switchProject: async () => {},
      adoptCachedTranscript: async () => false,
      forceStartTranscription: async () => { forced = true; },
      readReady: () => ({ projectId: 'row-2', ready: forced, built: false, why: forced ? '' : 'its transcript is not ready' }),
      applySync: async () => ({ ok: true }),
      saveNow: async () => {},
    }, 1_000);
    expect(forced).toBe(true);
    expect(result.ok).toBe(true);
  });

  it('warns only when transcribe-done to align-submit exceeds 10s', () => {
    __resetStageGapsForTests();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(noteStageGap('hash', 0, 4_000).warned).toBe(false);
    expect(noteStageGap('hash', 0, STAGE_GAP_WARN_MS + 50).warned).toBe(true);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('stays green across 20 runs, including a two-row batch', async () => {
    for (let i = 0; i < 20; i++) {
      const first = await finishRow('en');
      const second = await finishRow('en');
      expect(first.ok && second.ok).toBe(true);
    }
  });
});

describe('v1.2.2 — finishing never fights the operator', () => {
  it('actively editing = editor open AND (recent input or a sync running); the dashboard never is', () => {
    expect(isOperatorActivelyEditing({ editorOpen: true, syncRunning: false, msSinceInput: 1_000 })).toBe(true);
    expect(isOperatorActivelyEditing({ editorOpen: true, syncRunning: true, msSinceInput: 10 * BULK_ACTIVE_EDIT_MS })).toBe(true);
    expect(isOperatorActivelyEditing({ editorOpen: true, syncRunning: false, msSinceInput: BULK_ACTIVE_EDIT_MS })).toBe(false);
    expect(isOperatorActivelyEditing({ editorOpen: false, syncRunning: true, msSinceInput: 0 })).toBe(false);
  });

  it('yields (deferred) as soon as the operator navigates — before the switch, while waiting, or before Build Timeline', async () => {
    for (const at of [0, 1, 2]) {
      let checks = 0;
      const applySync = vi.fn(async () => ({ ok: true }));
      const switchProject = vi.fn(async () => undefined);
      const result = await runBulkProjectFinish('p', {
        switchProject,
        adoptCachedTranscript: async () => true,
        forceStartTranscription: async () => undefined,
        readReady: () => ({ projectId: 'p', ready: true, built: false, why: '' }),
        applySync,
        saveNow: async () => undefined,
        shouldYield: () => checks++ >= at,
      });
      expect(result, `yield point ${at}`).toEqual({ ok: false, deferred: true });
      expect(applySync).not.toHaveBeenCalled();
      expect(switchProject).toHaveBeenCalledTimes(at === 0 ? 0 : 1);
    }
  });
});
