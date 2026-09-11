/**
 * WS3 STEP 9 (C7) — `ExportCheckpointWriter.noteBoundaryRewind`/
 * `noteHardwareFailover`/`noteResumeAttempt`. Mirrors `record`'s own
 * existing test shape (none existed before this round — `exportCheckpoint
 * .test.ts` covers the pure functions these call; this file covers the
 * WRITER's own single-slot-write/dirty/no-op-before-a-manifest-exists
 * behavior around them).
 */
import { describe, it, expect } from 'vitest';
import { createExportCheckpointWriter, type CheckpointWritingFfmpeg } from './exportCheckpointWriter';

function fakeFfmpeg(sessionId = 'sess-1'): CheckpointWritingFfmpeg & { writes: string[] } {
  const writes: string[] = [];
  return {
    sessionId,
    writes,
    writeExportState: async (serialized: string) => {
      writes.push(serialized);
    },
  };
}

const identity = (hash: string | null = 'a'.repeat(64)) => ({
  sourceTimelineHash: Promise.resolve(hash),
  fps: 30,
  width: 1920,
  height: 1080,
  projectId: 'proj-1',
});

async function flush(): Promise<void> {
  // Two microtask hops: the identity promise resolving, then the pump's
  // own write promise settling.
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

describe('ExportCheckpointWriter recovery-budget notes (C7)', () => {
  it('noteBoundaryRewind is a no-op before any manifest exists (never queued for later)', async () => {
    const ffmpeg = fakeFfmpeg();
    const writer = createExportCheckpointWriter(ffmpeg, identity());
    writer.noteBoundaryRewind();
    await flush();
    expect(writer.snapshot()).toBeNull();
    expect(writer.writesIssued).toBe(0);
  });

  it('noteBoundaryRewind stamps the manifest and triggers a write once a piece has begun', async () => {
    const ffmpeg = fakeFfmpeg();
    const writer = createExportCheckpointWriter(ffmpeg, identity());
    writer.beginPiece(0);
    await flush();
    writer.noteBoundaryRewind();
    await flush();
    expect(writer.snapshot()?.boundaryRewindsUsed).toBe(1);
    expect(writer.snapshot()?.totalRecoveryAttempts).toBe(1);
    expect(writer.writesIssued).toBeGreaterThanOrEqual(2); // beginPiece's write + this one
    const lastWrite = JSON.parse(ffmpeg.writes[ffmpeg.writes.length - 1]!);
    expect(lastWrite.boundaryRewindsUsed).toBe(1);
  });

  it('noteHardwareFailover sets the flag and increments totalRecoveryAttempts, and is durably written', async () => {
    const ffmpeg = fakeFfmpeg();
    const writer = createExportCheckpointWriter(ffmpeg, identity());
    writer.beginPiece(0);
    await flush();
    writer.noteHardwareFailover();
    await flush();
    expect(writer.snapshot()?.hardwareFailoverUsed).toBe(true);
    expect(writer.snapshot()?.totalRecoveryAttempts).toBe(1);
    const lastWrite = JSON.parse(ffmpeg.writes[ffmpeg.writes.length - 1]!);
    expect(lastWrite.hardwareFailoverUsed).toBe(true);
  });

  it('noteResumeAttempt increments checkpointResumeAttempts and totalRecoveryAttempts on an ADOPTED manifest, cumulative with its prior counts', async () => {
    const ffmpeg = fakeFfmpeg('sess-resumed');
    const writer = createExportCheckpointWriter(ffmpeg, identity());
    // A manifest that already survived one rewind before the crash.
    const priorManifest = {
      schemaVersion: 1 as const,
      sessionId: 'sess-resumed',
      projectId: 'proj-1',
      sourceTimelineHash: 'a'.repeat(64),
      fps: 30,
      width: 1920,
      height: 1080,
      checkpoints: [],
      boundaryRewindsUsed: 1,
      hardwareFailoverUsed: false,
      checkpointResumeAttempts: 0,
      totalRecoveryAttempts: 1,
    };
    writer.adoptManifest(priorManifest, 0);
    writer.noteResumeAttempt();
    await flush();
    const snap = writer.snapshot();
    expect(snap?.checkpointResumeAttempts).toBe(1);
    // Cumulative, not reset — write #5's "roll forward" requirement: the
    // prior rewind's count survives the adopt + resume-attempt stamp.
    expect(snap?.boundaryRewindsUsed).toBe(1);
    expect(snap?.totalRecoveryAttempts).toBe(2);
  });

  it('all four notes are silent no-ops when the writer is disabled (no sessionId/writeExportState)', () => {
    const writer = createExportCheckpointWriter({}, identity());
    expect(() => {
      writer.noteBoundaryRewind();
      writer.noteHardwareFailover();
      writer.noteResumeAttempt();
      writer.noteRotation();
    }).not.toThrow();
    expect(writer.snapshot()).toBeNull();
  });

  // WS3 STEP 9 (C7) — the checkpoint-coverage gap, exercised through the
  // WRITER's own real call sequence: `noteRotation()` fires for every
  // rotation (mirrors `exportPipelineWebCodecs.ts`'s 'session-rotate'
  // handler, unconditional), while `record()` fires only for the ones that
  // pass `fenceSafeCheckpointOffset` (mirrors `onRotationCheckpoint`,
  // conditional). A rotation whose seam is fence-unsafe calls the first and
  // never the second — the manifest must show that gap.
  it('a rotation whose seam is fence-unsafe still bumps rotationsSeen, even though record() is never called for it', async () => {
    const ffmpeg = fakeFfmpeg();
    const writer = createExportCheckpointWriter(ffmpeg, identity());
    writer.beginPiece(0);
    await flush();

    // Two rotations happen; only the FIRST one produces a checkpoint (the
    // second's seam is fence-unsafe, so the caller never calls `record()`
    // for it — exactly the production shape).
    writer.noteRotation();
    writer.record({ encoderSessionIndex: 1, byteOffset: 100, seamByteOffset: 90, cumulativePictures: 30 });
    writer.noteRotation(); // seam 2: no matching record() call
    await flush();

    const snap = writer.snapshot();
    expect(snap?.rotationsSeen).toBe(2);
    expect(snap?.checkpoints).toHaveLength(1);
    // The gap this round makes visible: one rotation produced no checkpoint.
    expect((snap?.rotationsSeen ?? 0) - (snap?.checkpoints.length ?? 0)).toBe(1);
  });
});
