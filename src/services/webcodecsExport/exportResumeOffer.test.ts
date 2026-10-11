/**
 * The two-phase resume: OFFER (read-only, ranked) then ADOPT (mutating, one
 * session, only after the operator chose Resume).
 *
 * Discovery used to re-enter, fence and seam-cut a candidate before the
 * operator was asked, so a cancel at the prompt left the file cut and the
 * session claimed by this process. Phase A must be safe to run and abandon at
 * any moment: no claim, no fence, no byte write. These tests record every
 * call the fake IO sees and assert on that list.
 */
import { describe, it, expect } from 'vitest';
import {
  adoptRankedResume,
  rankResumeCandidates,
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

const HASH = 'a'.repeat(64);
const OTHER_HASH = 'b'.repeat(64);
const OLD = '11111111-1111-4111-8111-111111111111';
const NEW = '22222222-2222-4222-8222-222222222222';
const THIRD = '33333333-3333-4333-8333-333333333333';

/** Three pieces of 1000 pictures: 3000 total. */
const target: ResumeTargetPlan = {
  expected: { projectId: 'proj', sourceTimelineHash: HASH, fps: 30, width: 1920, height: 1080 },
  pieceExpectedFrames: [1000, 1000, 1000],
};

function manifest(params: {
  sessionId: string;
  hash?: string;
  completedPieces?: number;
  rows?: { pieceIndex: number; encoderSessionIndex: number; byteOffset: number; seamByteOffset?: number; cumulativePictures: number }[];
}): string {
  const hash = params.hash ?? HASH;
  let m = createExportStateManifest({
    sessionId: params.sessionId, projectId: 'proj', sourceTimelineHash: hash, fps: 30, width: 1920, height: 1080,
    ...(params.completedPieces !== undefined ? { completedPieces: params.completedPieces } : {}),
  });
  for (const row of params.rows ?? []) {
    const record: ExportCheckpointRecord = { ...row, fps: 30, width: 1920, height: 1080, sourceTimelineHash: hash };
    m = appendExportCheckpoint(m, record);
  }
  return serializeExportState(m);
}

interface FakeSession {
  json: string;
  files: Record<string, number>;
  claim?: 'live' | 'stale' | 'unclaimed';
  fenceThrows?: string;
  /** Pictures the last fence kept — what the seam cut then counts. */
  prepared?: number;
}

/** Every IO entry point is recorded as `name(sessionId[,arg])`. */
function multiSessionIo(sessions: Record<string, FakeSession>): {
  io: ResumeDiscoveryIo;
  calls: string[];
  files: (id: string) => Record<string, number>;
  countPictures: (s: ResumeSessionHandle, p: string) => Promise<number>;
} {
  const calls: string[] = [];
  const io: ResumeDiscoveryIo = {
    listResumableSessionIds: async () => { calls.push('listResumableSessionIds'); return Object.keys(sessions); },
    readSessionClaim: async (id) => {
      calls.push(`readSessionClaim(${id})`);
      return { holderLiveness: sessions[id]!.claim ?? 'unclaimed' };
    },
    peekExportState: async (id) => {
      calls.push(`peekExportState(${id})`);
      const s = sessions[id];
      if (!s) return { kind: 'notFound' };
      return { kind: 'found', bytes: Array.from(new TextEncoder().encode(s.json)) };
    },
    peekSessionFileSize: async (id, path) => {
      calls.push(`peekSessionFileSize(${id},${path})`);
      const size = sessions[id]!.files[path];
      if (size === undefined) throw new Error(`no such file ${path}`);
      return size;
    },
    reenter: async (id) => {
      calls.push(`reenter(${id})`);
      const s = sessions[id]!;
      const handle: ResumeSessionHandle = {
        sessionId: id,
        readExportState: async () => { calls.push(`readExportState(${id})`); return new TextEncoder().encode(s.json); },
        sessionFileSize: async (path) => {
          calls.push(`sessionFileSize(${id},${path})`);
          const size = s.files[path];
          if (size === undefined) throw new Error(`no such file ${path}`);
          return size;
        },
        prepareCheckpointResume: async (path, cp) => {
          calls.push(`prepareCheckpointResume(${id},${path})`);
          if (s.fenceThrows) throw new Error(s.fenceThrows);
          s.files[path] = cp.byteOffset;
          s.prepared = cp.cumulativePictures;
          return { pictures: cp.cumulativePictures, vclNals: cp.cumulativePictures, bytesRemoved: 0, keptBytes: cp.byteOffset };
        },
        truncateAnnexbToOffset: async (path, off) => {
          calls.push(`truncateAnnexbToOffset(${id},${path},${off})`);
          s.files[path] = off;
          return { pictures: s.prepared ?? 0, vclNals: 0, bytesRemoved: 0, keptBytes: off };
        },
        clearResumeFence: async () => { calls.push(`clearResumeFence(${id})`); },
        destroy: async (opts) => { calls.push(`destroy(${id},${opts?.force ? 'force' : 'unforced'})`); },
      };
      return handle;
    },
  };
  const countPictures = async (s: ResumeSessionHandle, p: string): Promise<number> => {
    calls.push(`count(${s.sessionId},${p})`);
    return 1000;
  };
  return { io, calls, files: (id) => sessions[id]!.files, countPictures };
}

const MUTATING = ['reenter(', 'prepareCheckpointResume(', 'truncateAnnexbToOffset(', 'clearResumeFence(', 'destroy('];
const mutatingCalls = (calls: string[]): string[] => calls.filter((c) => MUTATING.some((m) => c.startsWith(m)));

/** ~10%: piece 0, 300 pictures in. */
const tenPercent = (id: string): FakeSession => ({
  json: manifest({ sessionId: id, rows: [{ pieceIndex: 0, encoderSessionIndex: 1, byteOffset: 3_000, cumulativePictures: 300 }] }),
  files: { 'piece_0.h264': 3_500 },
});
/** ~60%: piece 1 done up to 800 pictures — 1000 + 800 = 1800. */
const sixtyPercent = (id: string): FakeSession => ({
  json: manifest({ sessionId: id, rows: [{ pieceIndex: 1, encoderSessionIndex: 2, byteOffset: 8_000, cumulativePictures: 800 }] }),
  files: { 'piece_0.h264': 10_000, 'piece_1.h264': 8_200 },
});

describe('Phase A — rankResumeCandidates (read-only offer)', () => {
  it('(1) an older ~60% session beats a newer ~10% one', async () => {
    const h = multiSessionIo({ [OLD]: sixtyPercent(OLD), [NEW]: tenPercent(NEW) });
    const created = (id: string): number | null => (id === NEW ? 2_000 : 1_000);
    const { ranked } = await rankResumeCandidates(h.io, target, [NEW, OLD], created);
    expect(ranked.map((c) => c.sessionId)).toEqual([OLD, NEW]);
    expect(ranked[0]!.projectedPicturesRendered).toBe(1_800);
    expect(ranked[1]!.projectedPicturesRendered).toBe(300);
  });

  it('(2) a newer session with a mismatched timeline hash is ignored', async () => {
    const mismatched: FakeSession = {
      json: manifest({ sessionId: NEW, hash: OTHER_HASH, completedPieces: 2 }),
      files: {},
    };
    const h = multiSessionIo({ [OLD]: tenPercent(OLD), [NEW]: mismatched });
    const { ranked, rejected } = await rankResumeCandidates(h.io, target, [NEW, OLD], (id) => (id === NEW ? 2 : 1));
    expect(ranked.map((c) => c.sessionId)).toEqual([OLD]);
    expect(rejected.map((r) => r.sessionId)).toEqual([NEW]);
    expect(rejected[0]!.reason).toContain('sourceTimelineHash mismatch');
  });

  it('(3) a fully rendered session wins and is offered for straight-to-mux', async () => {
    const full: FakeSession = { json: manifest({ sessionId: OLD, completedPieces: 3 }), files: {} };
    const h = multiSessionIo({ [OLD]: full, [NEW]: sixtyPercent(NEW) });
    const { ranked } = await rankResumeCandidates(h.io, target, [NEW, OLD], (id) => (id === NEW ? 2 : 1));
    expect(ranked[0]!.sessionId).toBe(OLD);
    expect(ranked[0]!.kind).toBe('piece');
    expect(ranked[0]!.completedPieces).toBe(3);
    expect(ranked[0]!.projectedPicturesRendered).toBe(3_000);
    expect(ranked[0]!.picturesTotal).toBe(3_000);
  });

  it('(4) the newest session loses to any further-progress valid session', async () => {
    const h = multiSessionIo({ [OLD]: sixtyPercent(OLD), [NEW]: tenPercent(NEW), [THIRD]: { json: manifest({ sessionId: THIRD, completedPieces: 1 }), files: {} } });
    const created = (id: string): number => ({ [OLD]: 1, [THIRD]: 2, [NEW]: 3 })[id]!;
    const { ranked } = await rankResumeCandidates(h.io, target, [NEW, THIRD, OLD], created);
    // 1800 (OLD) > 1000 (THIRD, one piece) > 300 (NEW, newest).
    expect(ranked.map((c) => c.sessionId)).toEqual([OLD, THIRD, NEW]);
  });

  it('ties on progress fall to the larger checkpoint byte offset, then the newer session', async () => {
    const a: FakeSession = {
      json: manifest({ sessionId: OLD, rows: [{ pieceIndex: 0, encoderSessionIndex: 1, byteOffset: 3_000, cumulativePictures: 300 }] }),
      files: { 'piece_0.h264': 3_100 },
    };
    const b: FakeSession = {
      json: manifest({ sessionId: NEW, rows: [{ pieceIndex: 0, encoderSessionIndex: 1, byteOffset: 3_200, cumulativePictures: 300 }] }),
      files: { 'piece_0.h264': 3_300 },
    };
    const c: FakeSession = {
      json: manifest({ sessionId: THIRD, rows: [{ pieceIndex: 0, encoderSessionIndex: 1, byteOffset: 3_200, cumulativePictures: 300 }] }),
      files: { 'piece_0.h264': 3_300 },
    };
    const h = multiSessionIo({ [OLD]: a, [NEW]: b, [THIRD]: c });
    const created = (id: string): number => ({ [OLD]: 3, [NEW]: 1, [THIRD]: 2 })[id]!;
    const { ranked } = await rankResumeCandidates(h.io, target, [OLD, NEW, THIRD], created);
    expect(ranked.map((x) => x.sessionId)).toEqual([THIRD, NEW, OLD]);
  });

  it('the checkpoint is the one the REAL file length supports, not the newest row', async () => {
    const s: FakeSession = {
      json: manifest({
        sessionId: OLD,
        rows: [
          { pieceIndex: 0, encoderSessionIndex: 1, byteOffset: 3_000, cumulativePictures: 300 },
          { pieceIndex: 0, encoderSessionIndex: 2, byteOffset: 6_000, cumulativePictures: 600 },
        ],
      }),
      files: { 'piece_0.h264': 4_000 },
    };
    const h = multiSessionIo({ [OLD]: s });
    const { ranked } = await rankResumeCandidates(h.io, target, [OLD], () => 1);
    expect(ranked[0]!.checkpoint?.byteOffset).toBe(3_000);
    expect(ranked[0]!.projectedPicturesRendered).toBe(300);
  });

  it('(5) NO-MUTATION: Phase A calls only list-free read probes — no claim, no fence, no cut', async () => {
    const h = multiSessionIo({ [OLD]: sixtyPercent(OLD), [NEW]: tenPercent(NEW) });
    const before = { old: { ...h.files(OLD) }, neu: { ...h.files(NEW) } };
    await rankResumeCandidates(h.io, target, [NEW, OLD], () => 1);
    expect(mutatingCalls(h.calls)).toEqual([]);
    // The complete set of functions Phase A may call.
    const names = new Set(h.calls.map((c) => c.slice(0, c.indexOf('('))));
    expect([...names].sort()).toEqual(['peekExportState', 'peekSessionFileSize', 'readSessionClaim']);
    expect(h.files(OLD)).toEqual(before.old);
    expect(h.files(NEW)).toEqual(before.neu);
  });

  it('(6) a live claim is skipped, typed as liveClaimBlocked, and its manifest is never read', async () => {
    const h = multiSessionIo({ [OLD]: { ...sixtyPercent(OLD), claim: 'live' }, [NEW]: tenPercent(NEW) });
    const { ranked, rejected } = await rankResumeCandidates(h.io, target, [NEW, OLD], () => 1);
    expect(ranked.map((c) => c.sessionId)).toEqual([NEW]);
    expect(rejected).toEqual([expect.objectContaining({ sessionId: OLD, liveClaimBlocked: true })]);
    expect(h.calls).not.toContain(`peekExportState(${OLD})`);
  });

  it('a stale claim stays valid and is flagged for the recovery notice', async () => {
    const h = multiSessionIo({ [OLD]: { ...tenPercent(OLD), claim: 'stale' } });
    const { ranked } = await rankResumeCandidates(h.io, target, [OLD], () => 1);
    expect(ranked[0]!.staleClaim).toBe(true);
  });

  it('typed rejections survive Phase A (no checkpoint yet)', async () => {
    const h = multiSessionIo({ [OLD]: { json: manifest({ sessionId: OLD }), files: {} } });
    const { ranked, rejected } = await rankResumeCandidates(h.io, target, [OLD], () => 1);
    expect(ranked).toEqual([]);
    expect(rejected[0]!.noCheckpointYet).toBe(true);
  });
});

describe('Phase B — adoptRankedResume (mutating, after consent)', () => {
  it('(1) adopting the chosen session produces today\'s ResumableExport shape', async () => {
    const s: FakeSession = {
      json: manifest({ sessionId: OLD, rows: [{ pieceIndex: 1, encoderSessionIndex: 2, byteOffset: 8_000, seamByteOffset: 7_900, cumulativePictures: 800 }] }),
      files: { 'piece_0.h264': 10_000, 'piece_1.h264': 8_200 },
    };
    const h = multiSessionIo({ [OLD]: s });
    const { ranked } = await rankResumeCandidates(h.io, target, [OLD], () => 1);
    const adopted = await adoptRankedResume(h.io, ranked, target, async (_s, p) => {
      h.calls.push(`count(${p})`);
      return p === 'piece_1.h264' ? 800 : 1000;
    });
    expect(adopted.rejected).toEqual([]);
    const r = adopted.resumable!;
    expect(Object.keys(r).sort()).toEqual([
      'appendFromByteOffset', 'checkpoint', 'manifest', 'picturesAlreadyRendered', 'picturesTotal',
      'pieceFile', 'repair', 'session', 'sessionId', 'staleClaimRecovered',
    ]);
    expect(r.sessionId).toBe(OLD);
    expect(r.pieceFile).toBe('piece_1.h264');
    expect(r.appendFromByteOffset).toBe(7_900);
    expect(r.picturesAlreadyRendered).toBe(1_800);
    expect(r.picturesTotal).toBe(3_000);
    expect(r.staleClaimRecovered).toBe(false);
    expect(h.calls.filter((c) => c.startsWith('reenter('))).toEqual([`reenter(${OLD})`]);
  });

  it('(2) a Phase-B failure releases per C1b and falls through to the NEXT ranked candidate', async () => {
    // OLD ranks first but its fence refuses: held (fence invoked). NEW's
    // manifest goes bad between offer and adopt: released (no fence ran).
    // THIRD adopts.
    const sessions: Record<string, FakeSession> = {
      [OLD]: { ...sixtyPercent(OLD), fenceThrows: 'checkpoint offset is not a canonical whole-AU boundary' },
      [NEW]: { json: manifest({ sessionId: NEW, completedPieces: 1 }), files: {} },
      [THIRD]: tenPercent(THIRD),
    };
    const h = multiSessionIo(sessions);
    const { ranked } = await rankResumeCandidates(h.io, target, [OLD, NEW, THIRD], () => 1);
    expect(ranked.map((c) => c.sessionId)).toEqual([OLD, NEW, THIRD]);
    sessions[NEW]!.json = manifest({ sessionId: NEW, hash: OTHER_HASH, completedPieces: 1 });
    const adopted = await adoptRankedResume(h.io, ranked, target, h.countPictures);
    expect(adopted.resumable?.sessionId).toBe(THIRD);
    expect(adopted.rejected.map((r) => r.sessionId)).toEqual([OLD, NEW]);
    expect(h.calls).not.toContain(`destroy(${OLD},unforced)`);
    expect(h.calls).toContain(`destroy(${NEW},unforced)`);
    expect(h.calls).not.toContain(`destroy(${THIRD},unforced)`);
    // Order: each candidate is tried only after the one before it failed.
    const reenters = h.calls.filter((c) => c.startsWith('reenter('));
    expect(reenters).toEqual([`reenter(${OLD})`, `reenter(${NEW})`, `reenter(${THIRD})`]);
  });

  it('a session whose selection changed since the offer is refused before any byte write', async () => {
    const sessions: Record<string, FakeSession> = { [OLD]: sixtyPercent(OLD) };
    const h = multiSessionIo(sessions);
    const { ranked } = await rankResumeCandidates(h.io, target, [OLD], () => 1);
    sessions[OLD]!.files['piece_1.h264'] = 100; // the offered checkpoint no longer fits
    const adopted = await adoptRankedResume(h.io, ranked, target, h.countPictures);
    expect(adopted.resumable).toBeNull();
    expect(h.calls.some((c) => c.startsWith('prepareCheckpointResume('))).toBe(false);
    expect(h.calls).toContain(`destroy(${OLD},unforced)`);
  });

  it('Round 24: adopting a fully rendered session fences nothing, re-renders nothing, and resumes past the last piece', async () => {
    const h = multiSessionIo({ [OLD]: { json: manifest({ sessionId: OLD, completedPieces: 3 }), files: {} } });
    const { ranked } = await rankResumeCandidates(h.io, target, [OLD], () => 1);
    const adopted = await adoptRankedResume(h.io, ranked, target, h.countPictures);
    const r = adopted.resumable!;
    expect(r.checkpoint.pieceIndex).toBe(3);
    expect(r.picturesAlreadyRendered).toBe(3_000);
    expect(r.picturesTotal).toBe(3_000);
    expect(h.calls.some((c) => c.startsWith('prepareCheckpointResume('))).toBe(false);
    expect(h.calls.some((c) => c.startsWith('truncateAnnexbToOffset('))).toBe(false);
    expect(h.calls.filter((c) => c.startsWith('count('))).toEqual([
      `count(${OLD},piece_0.h264)`, `count(${OLD},piece_1.h264)`, `count(${OLD},piece_2.h264)`,
    ]);
  });

  it('(3) the winner\'s bytes are untouched until adopt is called', async () => {
    const h = multiSessionIo({ [OLD]: { ...sixtyPercent(OLD), json: manifest({ sessionId: OLD, rows: [{ pieceIndex: 1, encoderSessionIndex: 2, byteOffset: 8_000, seamByteOffset: 7_900, cumulativePictures: 800 }] }) } });
    const { ranked } = await rankResumeCandidates(h.io, target, [OLD], () => 1);
    expect(h.files(OLD)['piece_1.h264']).toBe(8_200);
    expect(mutatingCalls(h.calls)).toEqual([]);
    await adoptRankedResume(h.io, ranked, target, async (_s, p) => (p === 'piece_1.h264' ? 800 : 1000));
    const firstMutation = h.calls.findIndex((c) => MUTATING.some((m) => c.startsWith(m)));
    const lastPeek = h.calls.map((c) => c.startsWith('peek')).lastIndexOf(true);
    expect(firstMutation).toBeGreaterThan(lastPeek);
    expect(h.files(OLD)['piece_1.h264']).toBe(7_900);
  });
});
