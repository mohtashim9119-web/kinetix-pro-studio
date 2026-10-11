/**
 * Piece-count deviations — the data layer.
 *
 * A finished piece whose counted pictures differ from the plan is RECORDED in
 * the session manifest (`pieceDeviations`), never silently accepted and never a
 * dead end: resume ACCEPTS a deviation that is recorded (same piece, same
 * counted, same expected) and keeps refusing an unrecorded one — the class the
 * field session `88f86aa5` belongs to.
 */
import { describe, it, expect } from 'vitest';
import {
  createExportStateManifest,
  recordPieceDeviation,
  serializeExportState,
  validateExportState,
  type ExportStateManifest,
} from './exportCheckpoint';
import { createExportCheckpointWriter, type CheckpointWritingFfmpeg } from './exportCheckpointWriter';
import {
  discoverResumableExport,
  type ResumeDiscoveryIo,
  type ResumeSessionHandle,
  type ResumeTargetPlan,
} from './exportResumeDiscovery';
import { decideResumeAdoptionOutcome } from '../../hooks/exportResumeAdoptionDecision';

const HASH = 'a'.repeat(64);
const SESSION = '11111111-2222-4333-8444-555555555555';
const identity = { projectId: 'proj', sourceTimelineHash: HASH, fps: 30, width: 1920, height: 1080 };
const target: ResumeTargetPlan = { expected: identity, pieceExpectedFrames: [1800, 1796, 1800, 900] };

function manifest(extra: Partial<ExportStateManifest> = {}): ExportStateManifest {
  return {
    ...createExportStateManifest({ sessionId: SESSION, ...identity, completedPieces: 2 }),
    ...extra,
  };
}

function io(json: string): { io: ResumeDiscoveryIo; destroys: string[] } {
  const destroys: string[] = [];
  const bytes = new TextEncoder().encode(json);
  const handle = (sessionId: string): ResumeSessionHandle => ({
    sessionId,
    readExportState: async () => bytes,
    sessionFileSize: async () => 5_000,
    prepareCheckpointResume: async () => { throw new Error('must not fence a piece-boundary resume'); },
    clearResumeFence: async () => undefined,
    truncateAnnexbToOffset: async () => { throw new Error('must not cut'); },
    destroy: async (o) => { destroys.push(String(o?.failureKind)); },
  });
  return {
    destroys,
    io: {
      listResumableSessionIds: async () => [SESSION],
      peekExportState: async () => ({ kind: 'found', bytes: Array.from(bytes) }),
      peekSessionFileSize: async () => 5_000,
      reenter: async (id: string) => handle(id),
    },
  };
}

describe('manifest — pieceDeviations', () => {
  it('recordPieceDeviation adds one row per piece and replaces a repeat for the same piece', () => {
    const a = recordPieceDeviation(manifest(), { pieceIndex: 1, counted: 1795, expected: 1796 });
    expect(a.pieceDeviations).toEqual([{ pieceIndex: 1, counted: 1795, expected: 1796 }]);
    const b = recordPieceDeviation(a, { pieceIndex: 1, counted: 1794, expected: 1796 });
    expect(b.pieceDeviations).toEqual([{ pieceIndex: 1, counted: 1794, expected: 1796 }]);
  });

  it('a manifest with deviations round-trips through validate (resume_at_piece keeps them)', () => {
    const m = recordPieceDeviation(manifest(), { pieceIndex: 1, counted: 1795, expected: 1796 });
    const v = validateExportState(serializeExportState(m), identity, 0);
    expect(v.kind).toBe('resume_at_piece');
    if (v.kind !== 'resume_at_piece') throw new Error('unreachable');
    expect(v.manifest.pieceDeviations).toEqual([{ pieceIndex: 1, counted: 1795, expected: 1796 }]);
  });

  it('a recorded cause survives validation; an unknown cause is refused', () => {
    const m = recordPieceDeviation(manifest(), { pieceIndex: 1, counted: 1795, expected: 1796, cause: 'encoder_gap' });
    const v = validateExportState(serializeExportState(m), identity, 0);
    if (v.kind !== 'resume_at_piece') throw new Error('unreachable');
    expect(v.manifest.pieceDeviations).toEqual([{ pieceIndex: 1, counted: 1795, expected: 1796, cause: 'encoder_gap' }]);
    const bad = JSON.parse(serializeExportState(m));
    bad.pieceDeviations[0].cause = 'mystery';
    expect(validateExportState(JSON.stringify(bad), identity, 0).kind).toBe('clean');
  });

  it('a manifest WITHOUT deviations is byte-identical on disk (no field written)', () => {
    expect(serializeExportState(manifest())).not.toContain('pieceDeviations');
  });

  it('a malformed pieceDeviations field is refused as an invalid manifest, not ignored', () => {
    const bad = JSON.parse(serializeExportState(manifest()));
    bad.pieceDeviations = [{ pieceIndex: 1, counted: 'x', expected: 1796 }];
    const v = validateExportState(JSON.stringify(bad), identity, 0);
    expect(v.kind).toBe('clean');
  });

  it('the fresh piece-scoped manifest carries the deviations forward (like completedPieces)', () => {
    const m = createExportStateManifest({
      sessionId: SESSION, ...identity, completedPieces: 2,
      pieceDeviations: [{ pieceIndex: 1, counted: 1795, expected: 1796 }],
    });
    expect(m.pieceDeviations).toEqual([{ pieceIndex: 1, counted: 1795, expected: 1796 }]);
  });
});

describe('writer — notePieceDeviation', () => {
  function fakeFfmpeg(): CheckpointWritingFfmpeg & { writes: string[] } {
    const writes: string[] = [];
    return { sessionId: SESSION, writes, writeExportState: async (s: string) => { writes.push(s); } };
  }
  const flush = async (): Promise<void> => { for (let i = 0; i < 6; i++) await Promise.resolve(); };

  it('persists the deviation and the NEXT piece-scoped manifest keeps it', async () => {
    const ff = fakeFfmpeg();
    const writer = createExportCheckpointWriter(ff, { ...identity, sourceTimelineHash: Promise.resolve(HASH) });
    writer.beginPiece(0);
    await flush();
    writer.notePieceDeviation({ pieceIndex: 0, counted: 1795, expected: 1796 });
    writer.notePieceCompleted(0);
    writer.beginPiece(1);
    await flush();
    expect(writer.snapshot()?.pieceDeviations).toEqual([{ pieceIndex: 0, counted: 1795, expected: 1796 }]);
    expect(JSON.parse(ff.writes[ff.writes.length - 1]!).pieceDeviations).toEqual([
      { pieceIndex: 0, counted: 1795, expected: 1796 },
    ]);
  });

  it('a deviation noted before the timeline hash lands is applied to the first manifest', async () => {
    const ff = fakeFfmpeg();
    const writer = createExportCheckpointWriter(ff, { ...identity, sourceTimelineHash: Promise.resolve(HASH) });
    writer.notePieceDeviation({ pieceIndex: 0, counted: 1795, expected: 1796 });
    writer.beginPiece(1);
    await flush();
    expect(writer.snapshot()?.pieceDeviations).toEqual([{ pieceIndex: 0, counted: 1795, expected: 1796 }]);
  });
});

describe('resume — recorded deviations are accepted, unrecorded ones refused', () => {
  const recorded = (counted: number, expected = 1796) =>
    serializeExportState(recordPieceDeviation(manifest(), { pieceIndex: 1, counted, expected }));

  it('ACCEPTS a piece whose count differs from the plan when the manifest recorded exactly that', async () => {
    const h = io(recorded(1795));
    const counts: Record<string, number> = { 'piece_0.h264': 1800, 'piece_1.h264': 1795 };
    const r = await discoverResumableExport(h.io, target, async (_s, p) => counts[p]!, [SESSION]);
    expect(r.resumable).not.toBeNull();
    expect(r.resumable!.picturesAlreadyRendered).toBe(1800 + 1795);
  });

  it('REFUSES the same count when it was never recorded (the field-session class)', async () => {
    const h = io(serializeExportState(manifest()));
    const counts: Record<string, number> = { 'piece_0.h264': 1800, 'piece_1.h264': 1795 };
    const r = await discoverResumableExport(h.io, target, async (_s, p) => counts[p]!, [SESSION]);
    expect(r.resumable).toBeNull();
    expect(r.rejected[0]!.reason).toContain('earlier piece 1 holds 1795 pictures, plan expects 1796');
    expect(r.rejected[0]!.unrecoverable).toBe(true);
  });

  it('REFUSES when the file no longer matches what was recorded (1794 on disk, 1795 recorded)', async () => {
    const h = io(recorded(1795));
    const counts: Record<string, number> = { 'piece_0.h264': 1800, 'piece_1.h264': 1794 };
    const r = await discoverResumableExport(h.io, target, async (_s, p) => counts[p]!, [SESSION]);
    expect(r.resumable).toBeNull();
    expect(r.rejected[0]!.reason).toContain('holds 1794 pictures');
  });

  it('REFUSES when the plan moved since the deviation was recorded (expected differs)', async () => {
    const h = io(recorded(1795, 1790));
    const counts: Record<string, number> = { 'piece_0.h264': 1800, 'piece_1.h264': 1795 };
    const r = await discoverResumableExport(h.io, target, async (_s, p) => counts[p]!, [SESSION]);
    expect(r.resumable).toBeNull();
  });

  it('an exact session with no deviations still resumes untouched (pin)', async () => {
    const h = io(serializeExportState(manifest()));
    const counts: Record<string, number> = { 'piece_0.h264': 1800, 'piece_1.h264': 1796 };
    const r = await discoverResumableExport(h.io, target, async (_s, p) => counts[p]!, [SESSION]);
    expect(r.resumable).not.toBeNull();
  });
});

describe('refusal wording — unrecoverable is not "try again"', () => {
  it('an unrecoverable adoption failure says so plainly and points at Start Clean, with no Retry invitation', () => {
    const f = decideResumeAdoptionOutcome({
      choice: 'resume', sessionId: SESSION, unrecoverable: true,
      reenterError: 'earlier piece 2 holds 1795 pictures, plan expects 1796',
    });
    expect(f!.message).toContain('cannot be resumed');
    expect(f!.message).toContain('Start Clean');
    expect(f!.message).not.toContain('Try again');
    expect(f!.message).toContain('1795');
  });

  it('a recoverable adoption failure keeps the existing text', () => {
    const f = decideResumeAdoptionOutcome({ choice: 'resume', sessionId: SESSION, reenterError: 'boom' });
    expect(f!.message).toContain('Try again');
  });
});
