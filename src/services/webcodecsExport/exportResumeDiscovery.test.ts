/**
 * WS3 Round 10, Blocker 3 — discovery, the fence's ORDERING, timeline-hash
 * invalidation, and the cleanup policy.
 *
 * The ordering assertions are the point of this file. Cursor's handshake is a
 * hard precondition, not a suggestion: nothing may append, count or concat
 * until `prepare_checkpoint_resume` has succeeded. Rust enforces that for real
 * (`ensure_resume_prepared`); these tests prove the JS side never even tries,
 * by recording every call and asserting the order rather than only the result.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  collectAbandonedSessions,
  discoverResumableExport,
  evaluateResumeCandidate,
  selectSessionsToCollect,
  pieceFileName,
  ABANDONED_SESSION_TTL_MS,
  type ResumeDiscoveryIo,
  type ResumeSessionHandle,
  type ResumeTargetPlan,
} from './exportResumeDiscovery';
import {
  appendExportCheckpoint,
  createExportStateManifest,
  serializeExportState,
  type ExportCheckpointRecord,
} from './exportCheckpoint';
import { TRUNCATE_BOUND_MS } from './ffmpegLivenessBound';

const HASH_A = 'a'.repeat(64);
const HASH_B = 'b'.repeat(64);
const SESSION = '11111111-2222-4333-8444-555555555555';
const SESSION_2 = '99999999-8888-4777-8666-555555555555';

function manifestJson(params: {
  sessionId?: string;
  hash?: string;
  rows: { pieceIndex: number; encoderSessionIndex: number; byteOffset: number; seamByteOffset?: number; cumulativePictures: number }[];
}): string {
  const hash = params.hash ?? HASH_A;
  let manifest = createExportStateManifest({
    sessionId: params.sessionId ?? SESSION,
    projectId: 'proj',
    sourceTimelineHash: hash,
    fps: 30,
    width: 1920,
    height: 1080,
  });
  for (const row of params.rows) {
    const record: ExportCheckpointRecord = {
      ...row, fps: 30, width: 1920, height: 1080, sourceTimelineHash: hash,
    };
    manifest = appendExportCheckpoint(manifest, record);
  }
  return serializeExportState(manifest);
}

const target: ResumeTargetPlan = {
  expected: { projectId: 'proj', sourceTimelineHash: HASH_A, fps: 30, width: 1920, height: 1080 },
  pieceExpectedFrames: [1800, 1800, 900],
};

interface Harness {
  io: ResumeDiscoveryIo;
  calls: string[];
  fence: ReturnType<typeof vi.fn>;
  count: ReturnType<typeof vi.fn>;
  seamCut: ReturnType<typeof vi.fn>;
  countPictures: (s: ResumeSessionHandle, p: string) => Promise<number>;
}

function harness(opts: {
  json?: string;
  fileSizes?: Record<string, number>;
  fenceResult?: { pictures: number; vclNals: number; bytesRemoved: number; keptBytes: number };
  fenceThrows?: string;
  pieceCounts?: Record<string, number>;
  sessionIds?: string[];
  seamCutPictures?: number;
  /** WS3 STEP 8 (H5) — when set, `io.readSessionClaim` is wired in and
   *  reports this liveness for every session id. Omitted entirely (not just
   *  falsy) keeps `readSessionClaim` absent from `io`, matching the
   *  pre-STEP-8 default-skip behavior most tests still exercise. */
  claimLiveness?: 'live' | 'stale' | 'unclaimed';
} = {}): Harness {
  const calls: string[] = [];
  const fileSizes = opts.fileSizes ?? { 'piece_1.h264': 5_000 };
  const fence = vi.fn(async (path: string, cp: ExportCheckpointRecord) => {
    calls.push(`fence(${path})`);
    if (opts.fenceThrows) throw new Error(opts.fenceThrows);
    return opts.fenceResult ?? {
      pictures: cp.cumulativePictures, vclNals: cp.cumulativePictures,
      bytesRemoved: 0, keptBytes: cp.byteOffset,
    };
  });
  const seamCut = vi.fn(async (path: string, off: number) => {
    calls.push(`seamCut(${path},${off})`);
    return { pictures: opts.seamCutPictures ?? 1_200, vclNals: 0, bytesRemoved: 8, keptBytes: off };
  });
  const count = vi.fn(async (path: string) => {
    calls.push(`count(${path})`);
    return opts.pieceCounts?.[path] ?? 1800;
  });
  const io: ResumeDiscoveryIo = {
    listResumableSessionIds: async () => {
      calls.push('list');
      return opts.sessionIds ?? [SESSION];
    },
    reenter: async (sessionId: string) => {
      calls.push(`reenter(${sessionId})`);
      const handle: ResumeSessionHandle = {
        sessionId,
        readExportState: async () => {
          calls.push('readExportState');
          return new TextEncoder().encode(
            opts.json ?? manifestJson({ rows: [{ pieceIndex: 1, encoderSessionIndex: 1, byteOffset: 4_000, cumulativePictures: 1_200 }] }),
          );
        },
        sessionFileSize: async (path: string) => {
          calls.push(`size(${path})`);
          const size = fileSizes[path];
          if (size === undefined) throw new Error(`no such file ${path}`);
          return size;
        },
        prepareCheckpointResume: fence,
        truncateAnnexbToOffset: seamCut,
        destroy: async () => { calls.push(`destroy(${sessionId})`); },
      };
      return handle;
    },
    ...(opts.claimLiveness
      ? {
          readSessionClaim: async (sessionId: string) => {
            calls.push(`readSessionClaim(${sessionId})`);
            return { holderLiveness: opts.claimLiveness! };
          },
        }
      : {}),
  };
  return { io, calls, fence, count, seamCut, countPictures: (_s, p) => count(p) };
}

describe('resume discovery — the fence ordering', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('THE ORDERING: nothing counts before the fence succeeds', async () => {
    const h = harness();
    const r = await evaluateResumeCandidate(h.io, SESSION, target, h.countPictures);
    expect(r.ok).toBe(true);
    const fenceAt = h.calls.findIndex((c) => c.startsWith('fence('));
    const firstCountAt = h.calls.findIndex((c) => c.startsWith('count('));
    expect(fenceAt).toBeGreaterThan(-1);
    expect(firstCountAt).toBeGreaterThan(-1);
    expect(firstCountAt).toBeGreaterThan(fenceAt);
    // …and the read/validate steps all precede the fence.
    expect(h.calls.indexOf('readExportState')).toBeLessThan(fenceAt);
    expect(h.calls.findIndex((c) => c.startsWith('size('))).toBeLessThan(fenceAt);
  });

  it('a fence refusal yields no resume and never counts anything', async () => {
    const h = harness({ fenceThrows: 'checkpoint offset is not a canonical whole-AU boundary' });
    const r = await evaluateResumeCandidate(h.io, SESSION, target, h.countPictures);
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error('unreachable');
    expect(r.reason).toContain('pre-append fence refused');
    expect(h.calls.some((c) => c.startsWith('count('))).toBe(false);
  });

  it('a fence result that disagrees with the checkpoint is refused, not widened', async () => {
    const h = harness({ fenceResult: { pictures: 1_199, vclNals: 1_199, bytesRemoved: 0, keptBytes: 4_000 } });
    const r = await evaluateResumeCandidate(h.io, SESSION, target, h.countPictures);
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error('unreachable');
    expect(r.reason).toContain('disagrees with the checkpoint');
    expect(h.calls.some((c) => c.startsWith('count('))).toBe(false);
  });

  it('TIMELINE-HASH INVALIDATION: a stale hash refuses BEFORE any bitstream call', async () => {
    const h = harness({ json: manifestJson({ hash: HASH_B, rows: [{ pieceIndex: 1, encoderSessionIndex: 1, byteOffset: 4_000, cumulativePictures: 1_200 }] }) });
    const r = await evaluateResumeCandidate(h.io, SESSION, target, h.countPictures);
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error('unreachable');
    expect(r.reason).toContain('sourceTimelineHash mismatch');
    // The three ways to touch the bitstream: fence (truncates), count, and a
    // size probe of the piece. None of them ran.
    expect(h.fence).not.toHaveBeenCalled();
    expect(h.count).not.toHaveBeenCalled();
    expect(h.calls.some((c) => c.startsWith('size('))).toBe(false);
  });

  it('a changed fps/resolution invalidates the same way', async () => {
    const h = harness();
    const r = await evaluateResumeCandidate(
      h.io, SESSION,
      { ...target, expected: { ...target.expected, fps: 60 } },
      h.countPictures,
    );
    expect(r.ok).toBe(false);
    expect(h.fence).not.toHaveBeenCalled();
  });

  it('an EARLIER piece with the wrong picture count refuses the resume', async () => {
    const h = harness({ pieceCounts: { 'piece_0.h264': 1_799 } });
    const r = await evaluateResumeCandidate(h.io, SESSION, target, h.countPictures);
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error('unreachable');
    expect(r.reason).toContain('holds 1799 pictures, plan expects 1800');
  });

  it('reports how much is already rendered — fenced prefix plus verified earlier pieces', async () => {
    const h = harness();
    const r = await evaluateResumeCandidate(h.io, SESSION, target, h.countPictures);
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error('unreachable');
    expect(r.value.picturesAlreadyRendered).toBe(1_800 + 1_200);
    expect(r.value.picturesTotal).toBe(4_500);
    expect(r.value.pieceFile).toBe(pieceFileName(1));
  });

  it('malformed JSON, a wrong schema version, and a non-monotonic manifest all start clean', async () => {
    for (const json of [
      '{ not json',
      JSON.stringify({ schemaVersion: 99, sessionId: SESSION }),
      JSON.stringify({
        schemaVersion: 1, sessionId: SESSION, projectId: 'proj', sourceTimelineHash: HASH_A,
        fps: 30, width: 1920, height: 1080,
        checkpoints: [
          { pieceIndex: 1, encoderSessionIndex: 2, byteOffset: 9, cumulativePictures: 9, fps: 30, width: 1920, height: 1080, sourceTimelineHash: HASH_A },
          { pieceIndex: 1, encoderSessionIndex: 1, byteOffset: 4, cumulativePictures: 4, fps: 30, width: 1920, height: 1080, sourceTimelineHash: HASH_A },
        ],
      }),
    ]) {
      const h = harness({ json });
      const r = await evaluateResumeCandidate(h.io, SESSION, target, h.countPictures);
      expect(r.ok, json.slice(0, 30)).toBe(false);
      expect(h.fence).not.toHaveBeenCalled();
    }
  });

  it('discovery takes the first candidate that works and reports the rest', async () => {
    let first = true;
    const h = harness({ sessionIds: [SESSION_2, SESSION] });
    const io: ResumeDiscoveryIo = {
      listResumableSessionIds: h.io.listResumableSessionIds,
      reenter: async (id) => {
        const handle = await h.io.reenter(id);
        if (first) {
          first = false;
          return { ...handle, readExportState: async () => new TextEncoder().encode(manifestJson({ sessionId: SESSION_2, hash: HASH_B, rows: [{ pieceIndex: 1, encoderSessionIndex: 1, byteOffset: 4_000, cumulativePictures: 1_200 }] })) };
        }
        return handle;
      },
    };
    const result = await discoverResumableExport(io, target, h.countPictures);
    expect(result.resumable?.sessionId).toBe(SESSION);
    expect(result.rejected).toHaveLength(1);
    expect(result.rejected[0]!.sessionId).toBe(SESSION_2);
    expect(result.rejected[0]!.reason).toContain('sourceTimelineHash mismatch');
  });

  // ── WS3 Round 12, STEP 1 — the three new outcomes ─────────────────────────

  function bitstreamTouchedByFenceIo(): ResumeDiscoveryIo {
    // A stateful fake: `sessionFileSize` reflects whatever `prepareCheckpointResume`
    // has already done to the file, exactly like the real native pair would
    // (`ffmpeg_prepare_checkpoint_resume` truncates before its own post-repair
    // check can fail).
    let currentSize = 5_000;
    return {
      listResumableSessionIds: async () => [SESSION],
      reenter: async (sessionId) => ({
        sessionId,
        readExportState: async () => new TextEncoder().encode(
          manifestJson({ rows: [{ pieceIndex: 1, encoderSessionIndex: 1, byteOffset: 4_000, cumulativePictures: 1_200 }] }),
        ),
        sessionFileSize: async () => currentSize,
        prepareCheckpointResume: async () => {
          currentSize = 4_000; // the native repair's truncate landed...
          throw new Error('canonical AU repair kept fewer bytes than checkpoint offset'); // ...then its own check failed.
        },
        truncateAnnexbToOffset: async (_p, off) => ({ pictures: 1_200, vclNals: 0, bytesRemoved: 0, keptBytes: off }),
        destroy: async () => {},
      }),
    };
  }

  it('bitstream_touched: the fence mutates the file, THEN fails — reported as touched, not clean', async () => {
    const r = await evaluateResumeCandidate(bitstreamTouchedByFenceIo(), SESSION, target, async () => 1800);
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error('unreachable');
    expect(r.bitstreamTouched).toEqual({ path: 'piece_1.h264', fileLengthBefore: 5_000, fileLengthAfter: 4_000 });
    expect(r.reason).toContain('mutated');
  });

  it('a fence that never settles expires TRUNCATE_BOUND_MS rather than hanging discovery', async () => {
    vi.useFakeTimers();
    const kill = vi.fn(async () => undefined);
    const io: ResumeDiscoveryIo = {
      listResumableSessionIds: async () => [SESSION],
      reenter: async (sessionId) => ({
        sessionId,
        readExportState: async () => new TextEncoder().encode(
          manifestJson({ rows: [{ pieceIndex: 1, encoderSessionIndex: 1, byteOffset: 4_000, cumulativePictures: 1_200 }] }),
        ),
        sessionFileSize: async () => 5_000,
        prepareCheckpointResume: () => new Promise(() => undefined),
        truncateAnnexbToOffset: async () => {
          throw new Error('must not run');
        },
        destroy: async () => {},
        kill,
      }),
    };
    const p = evaluateResumeCandidate(io, SESSION, target, async () => 1800);
    await vi.advanceTimersByTimeAsync(TRUNCATE_BOUND_MS + 1_000);
    const r = await p;
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error('unreachable');
    expect(r.reason).toContain('TRUNCATE_BOUND_MS');
    expect(kill).toHaveBeenCalled();
  });

  it('bitstream_touched propagates through discoverResumableExport into the rejection list', async () => {
    const discovered = await discoverResumableExport(bitstreamTouchedByFenceIo(), target, async () => 1800, [SESSION]);
    expect(discovered.resumable).toBeNull();
    expect(discovered.rejected[0]!.bitstreamTouched).toEqual({ path: 'piece_1.h264', fileLengthBefore: 5_000, fileLengthAfter: 4_000 });
  });

  it('bitstream_touched: the seam step-back cut mutates the file, THEN fails', async () => {
    let currentSize = 5_000;
    const io: ResumeDiscoveryIo = {
      listResumableSessionIds: async () => [SESSION],
      reenter: async (sessionId) => ({
        sessionId,
        readExportState: async () => new TextEncoder().encode(
          manifestJson({ rows: [{ pieceIndex: 1, encoderSessionIndex: 1, byteOffset: 4_000, seamByteOffset: 3_000, cumulativePictures: 1_200 }] }),
        ),
        sessionFileSize: async () => currentSize,
        prepareCheckpointResume: async (_p, cp) => {
          currentSize = cp.byteOffset;
          return { pictures: cp.cumulativePictures, vclNals: cp.cumulativePictures, bytesRemoved: 0, keptBytes: cp.byteOffset };
        },
        truncateAnnexbToOffset: async () => {
          currentSize = 3_000; // set_len landed...
          throw new Error('cancelled'); // ...then the recount failed.
        },
        destroy: async () => {},
      }),
    };
    const r = await evaluateResumeCandidate(io, SESSION, target, async () => 1800);
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error('unreachable');
    expect(r.bitstreamTouched).toEqual({ path: 'piece_1.h264', fileLengthBefore: 4_000, fileLengthAfter: 3_000 });
  });

  it('a fence failure with NO mutation is never reported as bitstream_touched', async () => {
    const h = harness({ fenceThrows: 'checkpoint offset is not a canonical whole-AU boundary' });
    const r = await evaluateResumeCandidate(h.io, SESSION, target, h.countPictures);
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error('unreachable');
    expect(r.bitstreamTouched).toBeUndefined();
  });

  it('recovery budget exhaustion invalidates the manifest (recovery_budget_exhausted, not resumable) with the reason intact', async () => {
    let manifest = createExportStateManifest({
      sessionId: SESSION, projectId: 'proj', sourceTimelineHash: HASH_A, fps: 30, width: 1920, height: 1080,
    });
    manifest.totalRecoveryAttempts = 4; // MAX_TOTAL_RECOVERY_ATTEMPTS_PER_EXPORT
    manifest = appendExportCheckpoint(manifest, {
      pieceIndex: 1, encoderSessionIndex: 1, byteOffset: 4_000, cumulativePictures: 1_200,
      fps: 30, width: 1920, height: 1080, sourceTimelineHash: HASH_A,
    });
    const h = harness({ json: serializeExportState(manifest) });
    const result = await discoverResumableExport(h.io, target, h.countPictures);
    expect(result.resumable).toBeNull();
    expect(result.rejected[0]!.reason).toContain('recovery budget exhausted');
    expect(result.rejected[0]!.budgetExhausted).toBe(true);
    expect(h.fence).not.toHaveBeenCalled(); // no Annex-B I/O — pure manifest check
  });

  it('a v1-era manifest (hash computed without timelineIdentityVersion) invalidates via the ordinary hash-mismatch path — not corruption, not offered', async () => {
    // A v1 manifest's sourceTimelineHash was built from a differently-shaped
    // identity object (no `timelineIdentityVersion` field), so it can never
    // equal `expected.sourceTimelineHash` computed under v2 — it falls
    // straight into the existing mismatch check with no dedicated code path.
    const h = harness({ json: manifestJson({ hash: HASH_B, rows: [{ pieceIndex: 1, encoderSessionIndex: 1, byteOffset: 4_000, cumulativePictures: 1_200 }] }) });
    const result = await discoverResumableExport(h.io, target, h.countPictures);
    expect(result.resumable).toBeNull();
    expect(result.rejected[0]!.reason).toBe('checkpoint sourceTimelineHash mismatch');
    expect(result.rejected[0]!.bitstreamTouched).toBeUndefined();
    expect(h.fence).not.toHaveBeenCalled(); // rejected before any native mutation — safe, not "corrupt"
  });
});

/**
 * WS3 STEP 8 (H5) — the frontend consumer of two already-merged native
 * commands (`ffmpeg_read_session_claim`, and `reenter`'s own
 * `acquire_session_claim` refusal). These tests pin the TWO DIFFERENT
 * operator-facing outcomes a claim can produce, and that they are decided
 * BEFORE `reenter` is even attempted.
 */
describe('claim-aware reentry (H5) — a live foreign holder blocks, a stale one recovers', () => {
  it('a LIVE claim blocks reentry before it is even attempted, and is reported as liveClaimBlocked', async () => {
    const h = harness({ claimLiveness: 'live' });
    const r = await evaluateResumeCandidate(h.io, SESSION, target, h.countPictures);
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error('unreachable');
    expect(r.liveClaimBlocked).toBe(true);
    expect(r.reason).toContain('another window is using this session');
    // The whole point: reenter is never even called for a live-blocked candidate.
    expect(h.calls).toContain(`readSessionClaim(${SESSION})`);
    expect(h.calls.some((c) => c.startsWith('reenter('))).toBe(false);
  });

  it('a live claim propagates through discoverResumableExport as a live_claim_blocked rejection', async () => {
    const h = harness({ claimLiveness: 'live' });
    const result = await discoverResumableExport(h.io, target, h.countPictures);
    expect(result.resumable).toBeNull();
    expect(result.rejected[0]!.liveClaimBlocked).toBe(true);
  });

  it('a STALE claim permits reentry, and the resumable value says so (staleClaimRecovered)', async () => {
    const h = harness({ claimLiveness: 'stale' });
    const r = await evaluateResumeCandidate(h.io, SESSION, target, h.countPictures);
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error('unreachable');
    expect(r.value.staleClaimRecovered).toBe(true);
    // Reentry DID happen — a stale claim recovers, it does not block.
    expect(h.calls.some((c) => c.startsWith('reenter('))).toBe(true);
  });

  it('an UNCLAIMED session is the ordinary case — no recovery notice, reentry proceeds', async () => {
    const h = harness({ claimLiveness: 'unclaimed' });
    const r = await evaluateResumeCandidate(h.io, SESSION, target, h.countPictures);
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error('unreachable');
    expect(r.value.staleClaimRecovered).toBe(false);
  });

  it('omitting readSessionClaim entirely (a caller that does not supply it) skips the check and behaves exactly as before STEP 8', async () => {
    const h = harness(); // no claimLiveness — io.readSessionClaim is absent
    const r = await evaluateResumeCandidate(h.io, SESSION, target, h.countPictures);
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error('unreachable');
    expect(r.value.staleClaimRecovered).toBe(false);
    expect(h.calls.some((c) => c.startsWith('readSessionClaim('))).toBe(false);
  });

  it('TWO DIFFERENT operator-facing messages: live-block text never mentions recovery, and vice versa', async () => {
    const live = harness({ claimLiveness: 'live' });
    const liveResult = await evaluateResumeCandidate(live.io, SESSION, target, live.countPictures);
    expect(liveResult.ok).toBe(false);
    if (liveResult.ok) throw new Error('unreachable');
    expect(liveResult.reason.toLowerCase()).not.toContain('recover');

    const stale = harness({ claimLiveness: 'stale' });
    const staleResult = await evaluateResumeCandidate(stale.io, SESSION, target, stale.countPictures);
    expect(staleResult.ok).toBe(true);
    if (!staleResult.ok) throw new Error('unreachable');
    expect(staleResult.value.staleClaimRecovered).toBe(true);
  });
});

describe('abandoned-session cleanup policy', () => {
  const now = 1_800_000_000_000;
  const fresh = (id: string, ageMs: number) => ({ sessionId: id, createdAtMs: now - ageMs });

  it('NEVER collects a session that is still resumable, or the one in use', () => {
    const doomed = selectSessionsToCollect({
      candidates: [fresh('resumable', 0), fresh('in-use', 0), fresh('old', ABANDONED_SESSION_TTL_MS * 2)],
      protectedSessionIds: ['resumable', 'in-use'],
      nowMs: now,
    });
    expect(doomed).not.toContain('resumable');
    expect(doomed).not.toContain('in-use');
    expect(doomed).toContain('old');
  });

  it('keeps exactly MAX_RETAINED_ABANDONED_SESSIONS, newest first', () => {
    const doomed = selectSessionsToCollect({
      candidates: [fresh('newest', 1_000), fresh('middle', 2_000), fresh('oldest', 3_000)],
      protectedSessionIds: [],
      nowMs: now,
    });
    expect(doomed.sort()).toEqual(['middle', 'oldest']);
  });

  it('collects past the TTL even when inside the retention count', () => {
    const doomed = selectSessionsToCollect({
      candidates: [fresh('ancient', ABANDONED_SESSION_TTL_MS + 1)],
      protectedSessionIds: [],
      nowMs: now,
    });
    expect(doomed).toEqual(['ancient']);
  });

  it('treats an unknown age as OLDEST, so pre-ledger leftovers go first', () => {
    const doomed = selectSessionsToCollect({
      candidates: [{ sessionId: 'unknown', createdAtMs: null }, fresh('known', 10_000)],
      protectedSessionIds: [],
      nowMs: now,
    });
    expect(doomed).toEqual(['unknown']);
  });

  it('actually destroys what it selects, and survives one that refuses', async () => {
    const destroyed: string[] = [];
    const io: ResumeDiscoveryIo = {
      listResumableSessionIds: async () => [],
      reenter: async (id) => {
        if (id === 'stuck') throw new Error('locked');
        return {
          sessionId: id,
          readExportState: async () => new Uint8Array(),
          sessionFileSize: async () => 0,
          prepareCheckpointResume: async () => ({ pictures: 0, vclNals: 0, bytesRemoved: 0, keptBytes: 0 }),
          truncateAnnexbToOffset: async () => ({ pictures: 0, vclNals: 0, bytesRemoved: 0, keptBytes: 0 }),
          destroy: async () => { destroyed.push(id); },
        };
      },
    };
    const collected = await collectAbandonedSessions(io, {
      candidates: [fresh('a', 1_000), fresh('b', 2_000), fresh('stuck', 3_000)],
      protectedSessionIds: [],
      nowMs: now,
    });
    expect(destroyed).toEqual(['b']);
    expect(collected).toEqual(['b']);
  });
});
