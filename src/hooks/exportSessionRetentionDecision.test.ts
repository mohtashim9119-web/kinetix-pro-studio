/**
 * WS3 (diagnostic logging) — `exportSessionRetentionDecision.ts` had no
 * dedicated test file before this round; its behavior was only exercised
 * indirectly through `useExport.ts`'s own tests. Pins the two things this
 * round changed: `failureKind` is threaded through to `retainForResume`
 * verbatim, and the null-fallback shape (no `retainForResume` on `active`
 * at all) is unaffected by that addition.
 */
import { describe, it, expect, vi } from 'vitest';
import { decideSessionRetentionOnFailure, buildNativeFailureKind, type RetainableSession } from './exportSessionRetentionDecision';
import type { RetainForResumeReport } from '../services/tauriFfmpeg';

const REPORT: RetainForResumeReport = {
  sessionId: 'sess-1',
  path: '/sessions/kinetix-export-sess-1',
  disposition: 'retained',
  retainedBytes: 65_536,
  reclaimedBytes: 4_096,
  removed: ['video_all.h264'],
};

describe('decideSessionRetentionOnFailure', () => {
  it('passes the failureKind through to retainForResume verbatim', async () => {
    const retainForResume = vi.fn().mockResolvedValue(REPORT);
    const active: RetainableSession = { retainForResume };
    const report = await decideSessionRetentionOnFailure(active, 'disk_full');
    expect(retainForResume).toHaveBeenCalledWith('disk_full');
    expect(report).toEqual(REPORT);
  });

  it('calls retainForResume with undefined when no failureKind is given', async () => {
    const retainForResume = vi.fn().mockResolvedValue(REPORT);
    const active: RetainableSession = { retainForResume };
    await decideSessionRetentionOnFailure(active);
    expect(retainForResume).toHaveBeenCalledWith(undefined);
  });

  it('returns null without calling anything when active has no retainForResume at all', async () => {
    const active: RetainableSession = {};
    const report = await decideSessionRetentionOnFailure(active, 'disk_full');
    expect(report).toBeNull();
  });

  it('returns null when active itself is null', async () => {
    const report = await decideSessionRetentionOnFailure(null, 'disk_full');
    expect(report).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// WS3 item F — buildNativeFailureKind
// ---------------------------------------------------------------------------

describe('buildNativeFailureKind', () => {
  it('is just kind when there is no liveness.failureVia', () => {
    expect(buildNativeFailureKind({ kind: 'disk_full', liveness: undefined })).toBe('disk_full');
    expect(
      buildNativeFailureKind({
        kind: 'encode',
        liveness: { lastPhase: null, msSinceLastPhaseChange: null, pieceIndex: null, framesEncoded: null, failureVia: null },
      }),
    ).toBe('encode');
  });

  it('appends via for a liveness-bound expiry — the exact shape that used to collapse to "unknown" alone', () => {
    expect(
      buildNativeFailureKind({
        kind: 'encode',
        liveness: { lastPhase: null, msSinceLastPhaseChange: null, pieceIndex: null, framesEncoded: null, failureVia: 'watchdog' },
      }),
    ).toBe('encode:watchdog');
    expect(
      buildNativeFailureKind({
        kind: 'encode',
        liveness: { lastPhase: null, msSinceLastPhaseChange: null, pieceIndex: null, framesEncoded: null, failureVia: 'append-drain-stall' },
      }),
    ).toBe('encode:append-drain-stall');
  });

  it('still appends via even for a non-encode kind — the two facts are independent', () => {
    expect(
      buildNativeFailureKind({
        kind: 'disk_full',
        liveness: { lastPhase: null, msSinceLastPhaseChange: null, pieceIndex: null, framesEncoded: null, failureVia: 'append-error' },
      }),
    ).toBe('disk_full:append-error');
  });
});
