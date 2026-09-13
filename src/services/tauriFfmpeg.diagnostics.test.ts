/**
 * WS3 (diagnostic logging) — the IPC plumbing for the W23 cross-check trio:
 * `failureKind` reaching the native log via `retainForResume`/`destroy`, and
 * the independent `sessionDiskSnapshot` read. Each of these three natives
 * commands gained an argument or a return value this round; this file pins
 * that `TauriFfmpeg`'s TS wrappers actually pass/return them, so a future
 * refactor of the wrapper can't silently drop the diagnostic without any
 * test noticing (the exact class of bug `exportDiagnosticsBlob.test.ts`'s
 * own header describes for the blob's own fields).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Mock } from 'vitest';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));

import { invoke } from '@tauri-apps/api/core';
import { TauriFfmpeg } from './tauriFfmpeg';

const mockInvoke = invoke as unknown as Mock;

async function reenter(sessionId: string): Promise<TauriFfmpeg> {
  mockInvoke.mockResolvedValueOnce(undefined); // ffmpeg_reenter_session
  return TauriFfmpeg.reenter(sessionId);
}

beforeEach(() => {
  mockInvoke.mockReset();
});

describe('TauriFfmpeg.retainForResume — failureKind reaches the native log call', () => {
  it('passes the given failureKind through to ffmpeg_retain_session_for_resume', async () => {
    const ffmpeg = await reenter('sess-1');
    mockInvoke.mockResolvedValueOnce({
      sessionId: 'sess-1', path: '/sessions/x', disposition: 'retained', retainedBytes: 1, reclaimedBytes: 2, removed: [],
    });
    await ffmpeg.retainForResume('disk_full');
    expect(mockInvoke).toHaveBeenLastCalledWith('ffmpeg_retain_session_for_resume', {
      sessionId: 'sess-1',
      failureKind: 'disk_full',
    });
  });

  it('sends null, not undefined, when no failureKind is given — a real IPC arg the native side always sees', async () => {
    const ffmpeg = await reenter('sess-2');
    mockInvoke.mockResolvedValueOnce({
      sessionId: 'sess-2', path: '/sessions/x', disposition: 'destroyed', retainedBytes: 0, reclaimedBytes: 0, removed: [],
    });
    await ffmpeg.retainForResume();
    expect(mockInvoke).toHaveBeenLastCalledWith('ffmpeg_retain_session_for_resume', {
      sessionId: 'sess-2',
      failureKind: null,
    });
  });
});

describe('TauriFfmpeg.destroy — failureKind reaches the native log call, and the outcome is returned', () => {
  it('passes force and failureKind through, and returns the native disposition', async () => {
    const ffmpeg = await reenter('sess-3');
    mockInvoke.mockResolvedValueOnce([]); // takeDurabilityWarnings
    mockInvoke.mockResolvedValueOnce({ disposition: 'refused_manifest' });
    const outcome = await ffmpeg.destroy({ force: false, failureKind: 'mux' });
    expect(mockInvoke).toHaveBeenLastCalledWith('ffmpeg_destroy_session', {
      sessionId: 'sess-3',
      force: false,
      failureKind: 'mux',
    });
    expect(outcome).toEqual({ disposition: 'refused_manifest' });
  });

  it('returns null (not throw) when the IPC call itself fails — destroy stays best-effort', async () => {
    const ffmpeg = await reenter('sess-4');
    mockInvoke.mockResolvedValueOnce([]); // takeDurabilityWarnings
    mockInvoke.mockRejectedValueOnce(new Error('session dir already gone'));
    const outcome = await ffmpeg.destroy({ force: true, failureKind: 'success' });
    expect(outcome).toBeNull();
  });

  it('is idempotent: a second call returns null without a second IPC round-trip', async () => {
    const ffmpeg = await reenter('sess-5');
    mockInvoke.mockResolvedValueOnce([]);
    mockInvoke.mockResolvedValueOnce({ disposition: 'destroyed' });
    await ffmpeg.destroy({ force: true });
    const callsAfterFirst = mockInvoke.mock.calls.length;
    const second = await ffmpeg.destroy({ force: true });
    expect(second).toBeNull();
    expect(mockInvoke.mock.calls.length).toBe(callsAfterFirst);
  });
});

describe('TauriFfmpeg.sessionDiskSnapshot — the independent post-hoc read', () => {
  it('invokes ffmpeg_session_disk_snapshot with the given session id and returns its result verbatim', async () => {
    mockInvoke.mockResolvedValueOnce({ manifestPresent: true, pieceCount: 3, pieceTotalBytes: 65_536 });
    const snap = await TauriFfmpeg.sessionDiskSnapshot('sess-6');
    expect(mockInvoke).toHaveBeenCalledWith('ffmpeg_session_disk_snapshot', { sessionId: 'sess-6' });
    expect(snap).toEqual({ manifestPresent: true, pieceCount: 3, pieceTotalBytes: 65_536 });
  });
});
