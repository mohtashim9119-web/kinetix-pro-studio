/**
 * D7.1a — a resume attempt is charged only if it is LOST without an operator
 * decision. Adoption writes an "attempt in progress" marker instead of
 * charging. An operator cancel or forward progress clears it. A run that ends
 * by itself without progress commits it, and so does the next adoption when it
 * finds the marker still set (the process died mid-run). A marker that cannot
 * be written fails toward counting.
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
const expected = { projectId: 'proj', sourceTimelineHash: HASH, fps: 30, width: 1920, height: 1080 };
const FILE = Number.MAX_SAFE_INTEGER;
const identity = { projectId: 'proj', sourceTimelineHash: Promise.resolve(HASH), fps: 30, width: 1920, height: 1080 };
const flush = async (): Promise<void> => { for (let i = 0; i < 8; i++) await Promise.resolve(); };

function fakeFfmpeg(failWrites = false): CheckpointWritingFfmpeg & { writes: string[] } {
  const writes: string[] = [];
  return {
    sessionId: SESSION, writes,
    writeExportState: async (s: string) => { if (failWrites) throw new Error('disk gone'); writes.push(s); },
  };
}
function onDisk(f: { writes: string[] }): ExportStateManifest {
  return JSON.parse(f.writes[f.writes.length - 1]!) as ExportStateManifest;
}
function firstRun(): ExportStateManifest {
  let m = createExportStateManifest({ sessionId: SESSION, projectId: 'proj', sourceTimelineHash: HASH, fps: 30, width: 1920, height: 1080 });
  m = appendExportCheckpoint(m, { pieceIndex: 0, encoderSessionIndex: 1, byteOffset: 1_000, cumulativePictures: 300, fps: 30, width: 1920, height: 1080, sourceTimelineHash: HASH });
  return m;
}
const validate = (m: ExportStateManifest) => validateExportState(serializeExportState(m), expected, FILE);
/** What a validated, offered manifest looks like when the next run adopts it. */
function reread(m: ExportStateManifest): ExportStateManifest {
  const v = validate(m);
  if (v.kind !== 'resume') throw new Error(`not resumable: ${v.kind}`);
  return v.manifest;
}

describe('resume attempt marker', () => {
  it('six operator cancel→Retry cycles with no progress charge nothing and keep resume available', async () => {
    let m = firstRun();
    for (let cycle = 1; cycle <= 6; cycle++) {
      const f = fakeFfmpeg();
      const w = createExportCheckpointWriter(f, identity);
      w.adoptManifest(reread(m), 0);
      w.noteResumeAttemptStarted();
      await flush();
      expect(onDisk(f).resumeAttemptInFlight, `cycle ${cycle}: the marker is on disk while the run runs`).toBe(true);
      w.clearResumeAttempt(); // the operator cancelled
      await w.flush();
      m = onDisk(f);
      expect(m.resumeAttemptInFlight).toBeUndefined();
      expect(m.totalRecoveryAttempts ?? 0).toBe(0);
    }
    expect(validate(m).kind).toBe('resume');
  });

  it('a run that ends by itself without progress commits the attempt', async () => {
    const f = fakeFfmpeg();
    const w = createExportCheckpointWriter(f, identity);
    w.adoptManifest(reread(firstRun()), 0);
    w.noteResumeAttemptStarted();
    w.commitResumeAttempt();
    expect(await w.flush()).toBe(true);
    expect(onDisk(f).totalRecoveryAttempts).toBe(1);
    expect(onDisk(f).resumeAttemptInFlight).toBeUndefined();
  });

  it('a process killed mid-run: the marker left on disk counts at discovery and is committed by the next adoption', async () => {
    let m = firstRun();
    for (let crash = 1; crash <= MAX_TOTAL_RECOVERY_ATTEMPTS_PER_EXPORT; crash++) {
      const v = validate(m);
      if (crash < MAX_TOTAL_RECOVERY_ATTEMPTS_PER_EXPORT || v.kind === 'resume') {
        const f = fakeFfmpeg();
        const w = createExportCheckpointWriter(f, identity);
        w.adoptManifest(reread(m), 0);
        w.noteResumeAttemptStarted();
        await flush();
        m = onDisk(f); // …and the process dies here: nothing clears the marker.
        expect(m.totalRecoveryAttempts ?? 0).toBe(crash - 1);
        expect(m.resumeAttemptInFlight).toBe(true);
      }
    }
    // Three committed + the one still in flight = 4 of 4.
    const v = validate(m);
    expect(v.kind).toBe('recovery_budget_exhausted');
    if (v.kind === 'recovery_budget_exhausted') {
      expect(v.reason).toBe('Resume unavailable — 4 of 4 recovery attempts used without progress. Starting fresh.');
    }
  });

  it('forward progress clears the marker along with the counts', async () => {
    const f = fakeFfmpeg();
    const w = createExportCheckpointWriter(f, identity);
    w.adoptManifest(reread({ ...firstRun(), totalRecoveryAttempts: 2 }), 0);
    w.noteResumeAttemptStarted();
    w.record({ encoderSessionIndex: 2, byteOffset: 2_000, seamByteOffset: 2_000, cumulativePictures: 600 });
    await w.flush();
    expect(onDisk(f).resumeAttemptInFlight).toBeUndefined();
    expect(onDisk(f).totalRecoveryAttempts).toBe(0);
  });

  it('a marker that cannot be written fails toward counting, never toward a free retry', async () => {
    const f = fakeFfmpeg(true);
    const w = createExportCheckpointWriter(f, identity);
    w.adoptManifest(reread(firstRun()), 0);
    w.noteResumeAttemptStarted();
    expect(await w.flush()).toBe(false);
    expect(w.snapshot()?.totalRecoveryAttempts).toBe(1);
    expect(w.snapshot()?.resumeAttemptInFlight).toBeUndefined();
  });

  it('an invalid marker value is a corrupt manifest, not a free attempt', () => {
    const bad = JSON.parse(serializeExportState(firstRun())) as Record<string, unknown>;
    bad.resumeAttemptInFlight = 'yes';
    expect(validateExportState(JSON.stringify(bad), expected, FILE).kind).toBe('clean');
  });
});
