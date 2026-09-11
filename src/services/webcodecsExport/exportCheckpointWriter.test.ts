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

  // PROMPT 19 STEP 10b — persist-ordering probe. `noteBoundaryRewind()` /
  // `noteHardwareFailover()` are called in `exportPipelineWebCodecs.ts`
  // BEFORE the re-render attempt (`runGlPiece`) that could hang again — so
  // if the OS process dies during that re-render, has the charge already
  // survived, or was it lost with the crash?
  //
  // The writer's own fsync (`ffmpeg_write_export_state` -> `sync_all`) is
  // never awaited by `record()`/`noteBoundaryRewind()` (see this file's own
  // header comment on `pump()` — deliberately so a wedged volume cannot
  // stall the export, per Rung 0). So the DURABLE write genuinely races the
  // next recovery attempt. What this probe pins down is the narrower claim
  // that actually bounds the risk: the IN-MEMORY manifest — the one
  // `snapshot()` reads, and the one the NEXT `noteBoundaryRewind()` call in
  // the same process would increment from — already reflects the charge
  // the instant `noteBoundaryRewind()` returns, with zero dependency on the
  // write settling. A `writeExportState` that never resolves (simulating a
  // crash before the fsync lands) is indistinguishable, from the writer's
  // own state, from one that resolved instantly.
  it('PERSIST-ORDERING PROBE: the charge is applied to the in-memory manifest synchronously, independent of whether the durable write ever settles (simulated crash-before-fsync)', async () => {
    let neverResolve!: () => void;
    const stall = new Promise<void>((resolve) => { neverResolve = resolve; });
    const writes: string[] = [];
    const ffmpeg: CheckpointWritingFfmpeg & { writes: string[] } = {
      sessionId: 'sess-1',
      writes,
      writeExportState: async (serialized: string) => {
        writes.push(serialized);
        // Simulates a process crash before this write's fsync ever
        // completes: the promise this call returns simply never settles.
        await stall;
      },
    };
    const writer = createExportCheckpointWriter(ffmpeg, identity());
    writer.beginPiece(0);
    await Promise.resolve();
    await Promise.resolve();

    // beginPiece's own write is now in flight and permanently stalled
    // (fsync "never completes"). The charge below is issued while that
    // write is still outstanding — exactly the ordering
    // `exportPipelineWebCodecs.ts` uses (note* before the re-render).
    writer.noteBoundaryRewind();

    // No `await` on the write at all — this assertion runs in the SAME
    // synchronous turn as the charge, proving the in-memory manifest needs
    // no I/O to reflect it. A resumed process reading `resume.manifest`
    // only ever sees a manifest that made it to disk, so this does not by
    // itself prove durability across a real crash — it proves the ONLY gap
    // is the fsync window itself, not any earlier bookkeeping lag.
    expect(writer.snapshot()?.boundaryRewindsUsed).toBe(1);
    expect(writer.snapshot()?.totalRecoveryAttempts).toBe(1);

    // A second charge in the same still-stalled process also lands
    // in-memory immediately — the in-process gate
    // (`decideBoundedRerenderDisposition`) never waits on disk either, so a
    // wedged fsync cannot itself let a process over-spend its own budget.
    writer.noteBoundaryRewind();
    expect(writer.snapshot()?.boundaryRewindsUsed).toBe(2);

    neverResolve();
    await flush();
  });
});
