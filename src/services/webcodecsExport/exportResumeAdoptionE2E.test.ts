/**
 * WS3 Round 28 (D1) — "resume adopts the retained session" at the
 * discovery/adoption layer, in the exact shape of the Machine 1 field
 * incident (`docs/STATUS.md`, `docs/ws3-export-pipeline/w23-machine1-validation.md`):
 * a failure retained one fully-rendered piece + manifest
 * (`manifestPresent: true`, `pieceCount: 1`, `pieceTotalBytes: 1,078,396,331`,
 * `disposition: retained`); pressing Resume must continue in that SAME
 * session directory, never mint a second one, and never re-render the
 * already-complete piece.
 *
 * This file tests at the layer the codebase already tests resume
 * correctness at (`exportResumeDiscovery.test.ts`'s own harness pattern,
 * reused here) — `useExport.ts` itself is a DOM-touching hook, verified
 * manually per CLAUDE.md's testing conventions, not unit tested directly.
 * The pure decision it delegates to for the adoption-refusal half of this
 * fix (`decideResumeAdoptionOutcome`) has its own direct red-then-green
 * suite in `src/hooks/exportResumeAdoptionDecision.test.ts`.
 */
import { describe, it, expect, vi } from 'vitest';
import {
  discoverResumableExport,
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
const SESSION_ID = 'd9b1d204-0000-4000-8000-000000000001';

function machine1Manifest(): string {
  // One piece, fully rendered, closing checkpoint written — the Machine 1
  // shape: mux-stage failure AFTER render completed, not mid-append.
  let manifest = createExportStateManifest({
    sessionId: SESSION_ID,
    projectId: 'proj-machine1',
    sourceTimelineHash: HASH,
    fps: 30,
    width: 1920,
    height: 1080,
  });
  const record: ExportCheckpointRecord = {
    pieceIndex: 0,
    encoderSessionIndex: 0,
    byteOffset: 1_078_396_331,
    cumulativePictures: 50_911,
    fps: 30,
    width: 1920,
    height: 1080,
    sourceTimelineHash: HASH,
  };
  manifest = appendExportCheckpoint(manifest, record);
  return serializeExportState(manifest);
}

const target: ResumeTargetPlan = {
  expected: { projectId: 'proj-machine1', sourceTimelineHash: HASH, fps: 30, width: 1920, height: 1080 },
  pieceExpectedFrames: [50_911],
};

interface Harness {
  io: ResumeDiscoveryIo;
  calls: string[];
  reenterCount: () => number;
  destroyedSessionIds: string[];
}

function harness(opts: {
  json?: string | (() => string);
  readExportStateThrows?: string;
  fileSizes?: Record<string, number>;
  countThrows?: Record<string, string>;
  pieceCounts?: Record<string, number>;
}): Harness {
  const calls: string[] = [];
  const destroyedSessionIds: string[] = [];
  let reenterCalls = 0;
  const fileSizes = opts.fileSizes ?? { 'piece_0.h264': 1_078_396_331 };
  const io: ResumeDiscoveryIo = {
    listResumableSessionIds: async () => {
      calls.push('list');
      return [SESSION_ID];
    },
    reenter: async (sessionId: string) => {
      reenterCalls += 1;
      calls.push(`reenter(${sessionId})`);
      const handle: ResumeSessionHandle = {
        sessionId,
        readExportState: async () => {
          calls.push('readExportState');
          if (opts.readExportStateThrows) throw new Error(opts.readExportStateThrows);
          const json = typeof opts.json === 'function' ? opts.json() : opts.json ?? machine1Manifest();
          return new TextEncoder().encode(json);
        },
        sessionFileSize: async (path: string) => {
          calls.push(`size(${path})`);
          const size = fileSizes[path];
          if (size === undefined) throw new Error(`no such file ${path}`);
          return size;
        },
        prepareCheckpointResume: async (path: string, cp: ExportCheckpointRecord) => {
          calls.push(`fence(${path})`);
          return { pictures: cp.cumulativePictures, vclNals: cp.cumulativePictures, bytesRemoved: 0, keptBytes: cp.byteOffset };
        },
        truncateAnnexbToOffset: async (path: string, off: number) => {
          calls.push(`seamCut(${path},${off})`);
          return { pictures: 50_911, vclNals: 0, bytesRemoved: 0, keptBytes: off };
        },
        destroy: async () => {
          calls.push(`destroy(${sessionId})`);
          destroyedSessionIds.push(sessionId);
        },
      };
      return handle;
    },
  };
  const countPictures = async (_session: ResumeSessionHandle, path: string): Promise<number> => {
    calls.push(`count(${path})`);
    if (opts.countThrows?.[path]) throw new Error(opts.countThrows[path]);
    return opts.pieceCounts?.[path] ?? 0;
  };
  return { io, calls, reenterCount: () => reenterCalls, destroyedSessionIds };
}

describe('D1 — resume adopts the retained session (Machine 1 shape)', () => {
  it('TEST 1 (E2E CORE REGRESSION CHECK) — resumes into the SAME session id, ZERO pieces re-rendered, no second session ever listed/created', async () => {
    const h = harness({});
    const result = await discoverResumableExport(h.io, target, async () => 0);

    expect(result.resumable).not.toBeNull();
    // Byte-identical session id/directory before and after discovery — this
    // module never mints a new id; it only ever re-enters the one
    // `listResumableSessionIds` reported.
    expect(result.resumable!.sessionId).toBe(SESSION_ID);
    // The single piece is the closing checkpoint's own — no earlier pieces
    // exist to verify (pieceIndex 0), so the "must not re-render a completed
    // piece" property holds by construction: the fence only TRUNCATES/counts
    // the survivor, it never re-encodes it. `picturesAlreadyRendered` must
    // equal the full rendered count, proving nothing was discarded.
    expect(result.resumable!.picturesAlreadyRendered).toBe(50_911);
    expect(result.resumable!.picturesTotal).toBe(50_911);
    // Exactly one session was ever listed or reentered — "no second session
    // directory is created anywhere on disk during resume" as observable at
    // this layer: `listResumableSessionIds` was called once, and `reenter`
    // was called only for SESSION_ID, never for any other id.
    expect(h.calls.filter((c) => c === 'list').length).toBe(1);
    expect(h.reenterCount()).toBe(1);
    expect(h.calls.every((c) => !c.startsWith('reenter(') || c === `reenter(${SESSION_ID})`)).toBe(true);
    // Nothing was destroyed — a successful resume discovery must not touch
    // the survivor's bytes.
    expect(h.destroyedSessionIds).toEqual([]);
  });

  it('TEST 2 (NEGATIVE) — manifest missing on the retained dir: refuses cleanly, not silently treated as "nothing to resume" vs "start fresh" ambiguity', async () => {
    const h = harness({ readExportStateThrows: 'export_state.json unreadable: ENOENT' });
    const result = await discoverResumableExport(h.io, target, async () => 0);

    expect(result.resumable).toBeNull();
    expect(result.rejected).toHaveLength(1);
    expect(result.rejected[0]!.sessionId).toBe(SESSION_ID);
    // Specific, not generic — an operator/log reader must be able to tell
    // "manifest missing" apart from every other rejection reason.
    expect(result.rejected[0]!.reason).toContain('export_state.json unreadable');
    expect(result.rejected[0]!.reason).toContain('ENOENT');
  });

  it('TEST 3 (NEGATIVE) — manifest present but the earlier piece was deleted: refuses cleanly with that specific reason', async () => {
    // Two-piece plan; the manifest's checkpoint points at piece 1 (so piece 0
    // must be verified by picture count before anything is offered) — and
    // piece 0 is missing/unreadable.
    const twoPieceTarget: ResumeTargetPlan = {
      expected: { projectId: 'proj-machine1', sourceTimelineHash: HASH, fps: 30, width: 1920, height: 1080 },
      pieceExpectedFrames: [1800, 900],
    };
    const twoPieceManifest = (): string => {
      let manifest = createExportStateManifest({
        sessionId: SESSION_ID, projectId: 'proj-machine1', sourceTimelineHash: HASH, fps: 30, width: 1920, height: 1080,
      });
      manifest = appendExportCheckpoint(manifest, {
        pieceIndex: 1, encoderSessionIndex: 1, byteOffset: 4_000, cumulativePictures: 900,
        fps: 30, width: 1920, height: 1080, sourceTimelineHash: HASH,
      });
      return serializeExportState(manifest);
    };
    const h = harness({
      json: twoPieceManifest,
      fileSizes: { 'piece_1.h264': 4_000 },
      countThrows: { 'piece_0.h264': 'earlier piece 0 unreadable: ENOENT (deleted)' },
    });
    const result = await discoverResumableExport(h.io, twoPieceTarget, async (_s, p) => {
      h.calls.push(`count(${p})`);
      if (p === 'piece_0.h264') throw new Error('earlier piece 0 unreadable: ENOENT (deleted)');
      return 900;
    });

    expect(result.resumable).toBeNull();
    expect(result.rejected).toHaveLength(1);
    expect(result.rejected[0]!.reason).toContain('earlier piece 0 is unreadable');
    expect(result.rejected[0]!.reason).toContain('ENOENT');
    // The fence must still have run (the survivor piece itself was fine) —
    // proving this rejection is specifically about the EARLIER piece, not a
    // generic refusal that masks which piece is actually missing.
    expect(h.calls.some((c) => c.startsWith('fence('))).toBe(true);
  });
});
