/**
 * The cross-process recovery budget (`MAX_TOTAL_RECOVERY_ATTEMPTS_PER_EXPORT`)
 * is a LOOP GUARD: it must stop a checkpoint that crashes or stalls every time
 * it is resumed, and nothing else. The operator's field run hit it after four
 * ordinary cancel/Retry cycles that each moved the export forward, and both
 * projects were refused in lockstep on the fifth Retry. These tests pin the
 * semantics: progress resets the count, no-progress attempts still exhaust,
 * the identity check runs first, and the refusal says what happened.
 */
import { describe, it, expect } from 'vitest';
import { createExportCheckpointWriter, type CheckpointWritingFfmpeg } from './exportCheckpointWriter';
import {
  MAX_TOTAL_RECOVERY_ATTEMPTS_PER_EXPORT,
  appendExportCheckpoint,
  createExportStateManifest,
  serializeExportState,
  validateExportState,
  type ExportStateManifest,
} from './exportCheckpoint';

const SESSION = '11111111-2222-4333-8444-555555555555';
const HASH = 'a'.repeat(64);
const OTHER_HASH = 'b'.repeat(64);
const expected = { projectId: 'proj', sourceTimelineHash: HASH, fps: 30, width: 1920, height: 1080 };
const FILE = Number.MAX_SAFE_INTEGER;

function fakeFfmpeg(): CheckpointWritingFfmpeg & { writes: string[] } {
  const writes: string[] = [];
  return { sessionId: SESSION, writes, writeExportState: async (s: string) => { writes.push(s); } };
}
const identity = { projectId: 'proj', sourceTimelineHash: Promise.resolve(HASH), fps: 30, width: 1920, height: 1080 };
const flush = async (): Promise<void> => { for (let i = 0; i < 6; i++) await Promise.resolve(); };

function firstRunManifest(): ExportStateManifest {
  let m = createExportStateManifest({ sessionId: SESSION, projectId: 'proj', sourceTimelineHash: HASH, fps: 30, width: 1920, height: 1080 });
  m = appendExportCheckpoint(m, { pieceIndex: 0, encoderSessionIndex: 1, byteOffset: 1_000, cumulativePictures: 300, fps: 30, width: 1920, height: 1080, sourceTimelineHash: HASH });
  return m;
}

/** One resumed run: adopt what is on disk, count the attempt, optionally move forward. */
async function resumeCycle(onDisk: ExportStateManifest, progress: boolean): Promise<ExportStateManifest> {
  const ffmpeg = fakeFfmpeg();
  const writer = createExportCheckpointWriter(ffmpeg, identity);
  writer.adoptManifest(onDisk, 0);
  writer.noteResumeAttempt();
  if (progress) {
    const last = onDisk.checkpoints[onDisk.checkpoints.length - 1]!;
    writer.record({
      encoderSessionIndex: last.encoderSessionIndex + 1,
      byteOffset: last.byteOffset + 1_000,
      seamByteOffset: last.byteOffset + 1_000,
      cumulativePictures: last.cumulativePictures + 300,
    });
  }
  await flush();
  return JSON.parse(ffmpeg.writes[ffmpeg.writes.length - 1]!) as ExportStateManifest;
}

describe('recovery budget — a loop guard, never a penalty for progress', () => {
  it('(1) six cancel/Retry cycles that each wrote a new checkpoint never exhaust the budget', async () => {
    let onDisk = firstRunManifest();
    for (let cycle = 1; cycle <= 6; cycle++) {
      const v = validateExportState(serializeExportState(onDisk), expected, FILE);
      expect(v.kind, `cycle ${cycle}`).toBe('resume');
      onDisk = await resumeCycle(onDisk, true);
    }
    expect(onDisk.totalRecoveryAttempts).toBe(0);
  });

  it('(2) consecutive attempts with no progress still accumulate and exhaust', async () => {
    let onDisk = firstRunManifest();
    for (let i = 0; i < MAX_TOTAL_RECOVERY_ATTEMPTS_PER_EXPORT; i++) {
      expect(validateExportState(serializeExportState(onDisk), expected, FILE).kind).toBe('resume');
      onDisk = await resumeCycle(onDisk, false);
    }
    expect(onDisk.totalRecoveryAttempts).toBe(MAX_TOTAL_RECOVERY_ATTEMPTS_PER_EXPORT);
    expect(validateExportState(serializeExportState(onDisk), expected, FILE).kind).toBe('recovery_budget_exhausted');
  });

  it('a finished piece counts as progress too', async () => {
    const ffmpeg = fakeFfmpeg();
    const writer = createExportCheckpointWriter(ffmpeg, identity);
    writer.adoptManifest({ ...firstRunManifest(), totalRecoveryAttempts: 3 }, 0);
    writer.noteResumeAttempt();
    writer.notePieceCompleted(0);
    await flush();
    expect(writer.snapshot()?.totalRecoveryAttempts).toBe(0);
  });

  it('(3) a timeline change is new work: the old exhausted session reads as a mismatch, not a refusal', () => {
    const exhausted = { ...firstRunManifest(), totalRecoveryAttempts: MAX_TOTAL_RECOVERY_ATTEMPTS_PER_EXPORT };
    const v = validateExportState(serializeExportState(exhausted), { ...expected, sourceTimelineHash: OTHER_HASH }, FILE);
    expect(v).toEqual({ kind: 'clean', reason: 'checkpoint sourceTimelineHash mismatch' });
  });

  it('(4) a foreign project\'s exhausted session reads as a project mismatch, never as this project\'s refusal', () => {
    const foreign = { ...firstRunManifest(), projectId: 'someone-else', totalRecoveryAttempts: MAX_TOTAL_RECOVERY_ATTEMPTS_PER_EXPORT };
    expect(validateExportState(serializeExportState(foreign), expected, FILE)).toEqual({ kind: 'clean', reason: 'checkpoint projectId mismatch' });
  });

  it('(5) the refusal carries the real reason and the count', () => {
    const exhausted = { ...firstRunManifest(), totalRecoveryAttempts: MAX_TOTAL_RECOVERY_ATTEMPTS_PER_EXPORT };
    const v = validateExportState(serializeExportState(exhausted), expected, FILE);
    expect(v.kind).toBe('recovery_budget_exhausted');
    if (v.kind !== 'recovery_budget_exhausted') throw new Error('unreachable');
    expect(v.reason).toBe('Resume unavailable — 4 of 4 recovery attempts used without progress. Starting fresh.');
  });
});

describe('the rewind budget counts hangs, and progress resets it too', () => {
  it('an export that had two encoder hangs and then progressed still resumes', async () => {
    const ffmpeg = fakeFfmpeg();
    const writer = createExportCheckpointWriter(ffmpeg, identity);
    writer.adoptManifest(firstRunManifest(), 0);
    writer.noteBoundaryRewind();
    writer.noteBoundaryRewind();
    // The run got past the hangs and wrote a checkpoint beyond the last one.
    writer.record({ encoderSessionIndex: 2, byteOffset: 2_000, seamByteOffset: 2_000, cumulativePictures: 600 });
    await flush();
    const onDisk = JSON.parse(ffmpeg.writes[ffmpeg.writes.length - 1]!) as ExportStateManifest;
    expect(onDisk.boundaryRewindsUsed).toBe(0);
    expect(validateExportState(serializeExportState(onDisk), expected, FILE).kind).toBe('resume');
  });

  it('two hangs with no progress after them still refuse resume, with the truthful reason', async () => {
    const ffmpeg = fakeFfmpeg();
    const writer = createExportCheckpointWriter(ffmpeg, identity);
    writer.adoptManifest(firstRunManifest(), 0);
    writer.noteBoundaryRewind();
    writer.noteBoundaryRewind();
    await flush();
    const onDisk = JSON.parse(ffmpeg.writes[ffmpeg.writes.length - 1]!) as ExportStateManifest;
    const v = validateExportState(serializeExportState(onDisk), expected, FILE);
    expect(v.kind).toBe('recovery_budget_exhausted');
    if (v.kind === 'recovery_budget_exhausted') expect(v.reason).toBe('Resume unavailable — 2 of 2 boundary rewinds used. Starting fresh.');
  });

  it('a resume attempt is not a hang: it never touches the rewind count', async () => {
    const ffmpeg = fakeFfmpeg();
    const writer = createExportCheckpointWriter(ffmpeg, identity);
    writer.adoptManifest(firstRunManifest(), 0);
    writer.noteResumeAttempt();
    await flush();
    expect(writer.snapshot()?.boundaryRewindsUsed ?? 0).toBe(0);
  });
});
