import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import {
  appendExportCheckpoint,
  buildSourceTimelineHash,
  canonicalTimelineJson,
  createExportStateManifest,
  exportLifetimeBudgetOf,
  EXPORT_TIMELINE_IDENTITY_VERSION,
  isRecoveryBudgetExhausted,
  MAX_BOUNDARY_REWINDS_PER_EXPORT,
  MAX_TOTAL_RECOVERY_ATTEMPTS_PER_EXPORT,
  prepareCheckpointResume,
  recordBoundaryRewind,
  recordHardwareFailover,
  recordResumeAttempt,
  recordRotationSeen,
  recoveryBudgetExhaustionReason,
  serializeExportState,
  timelineIdentityFromProject,
  validateExportState,
  type AnnexbCheckpointRepairResult,
  type ExportCheckpointRecord,
  type ExportCheckpointResumeIo,
} from './exportCheckpoint';
import {
  buildSyntheticMultiSliceAnnexb,
  countAnnexbAccessUnits,
  scanAnnexbNals,
  truncateAnnexbToLastCompleteAu,
} from './annexbFrameCount';
import { AnimationType, TransitionType, type Project } from '../../types';

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function stubProject(overrides: Partial<Project> = {}): Project {
  return {
    id: 'proj-1',
    name: 'Test',
    script: 'hello',
    sceneDetails: '',
    segments: [
      {
        id: 'seg-1',
        text: 'hello',
        assetId: 'asset-1',
        startTime: 0,
        duration: 2,
        transition: TransitionType.NONE,
        animation: AnimationType.NONE,
        order: 0,
      },
    ],
    assets: [],
    globalTransition: TransitionType.NONE,
    globalTransitionDuration: 0,
    globalAnimation: AnimationType.NONE,
    globalOverlayConfig: { color: '#fff', backgroundColor: 'transparent', fontFamily: 'Arial' },
    ...overrides,
  };
}

describe('exportCheckpoint writer — inert', () => {
  it('buildSourceTimelineHash is stable for the same identity and moves when the timeline moves', async () => {
    const identity = timelineIdentityFromProject(stubProject(), { fps: 30, width: 1920, height: 1080 });
    const a = await buildSourceTimelineHash(identity);
    const b = await buildSourceTimelineHash(identity);
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);

    const edited = timelineIdentityFromProject(
      stubProject({
        segments: [{
          id: 'seg-1',
          text: 'hello',
          assetId: 'asset-1',
          startTime: 0,
          duration: 2.5,
          transition: TransitionType.NONE,
          animation: AnimationType.NONE,
          order: 0,
        }],
      }),
      { fps: 30, width: 1920, height: 1080 },
    );
    expect(await buildSourceTimelineHash(edited)).not.toBe(a);
  });

  it('canonical JSON is key-order independent', () => {
    const identity = timelineIdentityFromProject(stubProject(), { fps: 30, width: 1920, height: 1080 });
    const json = canonicalTimelineJson(identity);
    expect(json).toBe(canonicalTimelineJson(JSON.parse(json) as typeof identity));
  });

  it('appendExportCheckpoint does not mutate annexb bytes (neutrality)', async () => {
    const stream = buildSyntheticMultiSliceAnnexb(4, 8);
    const before = sha256(stream);
    const identity = timelineIdentityFromProject(stubProject(), { fps: 30, width: 1920, height: 1080 });
    const hash = await buildSourceTimelineHash(identity);
    let manifest = createExportStateManifest({
      sessionId: '00000000-0000-4000-8000-000000000001',
      projectId: 'proj-1',
      sourceTimelineHash: hash,
      fps: 30,
      width: 1920,
      height: 1080,
    });
    manifest = appendExportCheckpoint(manifest, {
      pieceIndex: 0,
      encoderSessionIndex: 0,
      byteOffset: stream.byteLength,
      cumulativePictures: countAnnexbAccessUnits(stream).pictures,
      fps: 30,
      width: 1920,
      height: 1080,
      sourceTimelineHash: hash,
    });
    expect(sha256(stream)).toBe(before);
    expect(countAnnexbAccessUnits(stream)).toEqual({ pictures: 4, vclNals: 32 });
    const json = serializeExportState(manifest);
    expect(json).toContain('"schemaVersion": 1');
    expect(json).toContain('"cumulativePictures": 4');
    expect(serializeExportState(manifest)).toBe(json);
  });

  it('refuses to append a checkpoint from a different timeline hash', async () => {
    const identity = timelineIdentityFromProject(stubProject(), { fps: 30, width: 1920, height: 1080 });
    const hash = await buildSourceTimelineHash(identity);
    const manifest = createExportStateManifest({
      sessionId: '00000000-0000-4000-8000-000000000001',
      projectId: 'proj-1',
      sourceTimelineHash: hash,
      fps: 30,
      width: 1920,
      height: 1080,
    });
    expect(() => appendExportCheckpoint(manifest, {
      pieceIndex: 0,
      encoderSessionIndex: 0,
      byteOffset: 0,
      cumulativePictures: 0,
      fps: 30,
      width: 1920,
      height: 1080,
      sourceTimelineHash: '0'.repeat(64),
    })).toThrow(/mix timelines/);
  });
});

describe('exportCheckpoint reader + mandatory pre-append repair', () => {
  const sessionId = '00000000-0000-4000-8000-000000000001';
  const hash = 'a'.repeat(64);
  const expected = {
    projectId: 'proj-1',
    sourceTimelineHash: hash,
    fps: 30,
    width: 1920,
    height: 1080,
  };
  const complete = buildSyntheticMultiSliceAnnexb(4, 8);
  const nals = scanAnnexbNals(complete);
  const vcls = nals.filter((nal) => nal.nalType === 1 || nal.nalType === 5);
  const firstVclPicture2 = vcls[2 * 8]!;
  const previousVcl = vcls[2 * 8 - 1]!;
  const checkpointOffset = nals.find(
    (nal) =>
      nal.nalType === 9 &&
      nal.start > previousVcl.start &&
      nal.start < firstVclPicture2.start,
  )!.start;
  const checkpoint: ExportCheckpointRecord = {
    pieceIndex: 0,
    encoderSessionIndex: 0,
    byteOffset: checkpointOffset,
    cumulativePictures: 2,
    fps: 30,
    width: 1920,
    height: 1080,
    sourceTimelineHash: hash,
  };

  function serialized(record: ExportCheckpointRecord = checkpoint): string {
    const manifest = appendExportCheckpoint(
      createExportStateManifest({
        sessionId,
        projectId: expected.projectId,
        sourceTimelineHash: hash,
        fps: expected.fps,
        width: expected.width,
        height: expected.height,
      }),
      record,
    );
    return serializeExportState(manifest);
  }

  function fakeIo(initial: Uint8Array): ExportCheckpointResumeIo & {
    bytes(): Uint8Array;
    prepareCalls: number;
  } {
    let bytes = new Uint8Array(initial);
    const io = {
      prepareCalls: 0,
      bytes: () => bytes,
      sessionFileSize: async () => bytes.byteLength,
      prepareCheckpointResume: async (
        _path: string,
        record: ExportCheckpointRecord,
      ): Promise<AnnexbCheckpointRepairResult> => {
        io.prepareCalls++;
        // Mirrors the native atomic order: inferred whole-AU repair is
        // unconditional, then the authoritative checkpoint offset wins.
        const originalLength = bytes.byteLength;
        if (originalLength === record.byteOffset) {
          const count = countAnnexbAccessUnits(bytes);
          if (count.pictures !== record.cumulativePictures) {
            throw new Error('picture count mismatch');
          }
          return {
            ...count,
            bytesRemoved: 0,
            keptBytes: bytes.byteLength,
          };
        }
        const repaired = truncateAnnexbToLastCompleteAu(bytes);
        if (repaired.bytes.byteLength < record.byteOffset) {
          throw new Error('repair fell before checkpoint');
        }
        bytes = repaired.bytes.slice(0, record.byteOffset);
        const count = countAnnexbAccessUnits(bytes);
        if (count.pictures !== record.cumulativePictures) {
          throw new Error('picture count mismatch');
        }
        return {
          ...count,
          bytesRemoved: originalLength - bytes.byteLength,
          keptBytes: bytes.byteLength,
        };
      },
    };
    return io;
  }

  it('crash mid-NAL repairs to the recorded whole-AU boundary before append', async () => {
    const crashAt = vcls[2 * 8 + 5]!.header + 2;
    const io = fakeIo(complete.slice(0, crashAt));
    const result = await prepareCheckpointResume(io, 'piece_0.h264', serialized(), expected);
    expect(result.kind).toBe('resume');
    expect(io.prepareCalls).toBe(1);
    expect(io.bytes().byteLength).toBe(checkpointOffset);
    expect(countAnnexbAccessUnits(io.bytes()).pictures).toBe(2);
  });

  it('crash mid-picture on a multi-slice stream drops the partial picture', async () => {
    const crashAt = vcls[2 * 8 + 5]!.start;
    const io = fakeIo(complete.slice(0, crashAt));
    const result = await prepareCheckpointResume(io, 'piece_0.h264', serialized(), expected);
    expect(result.kind).toBe('resume');
    expect(io.bytes().byteLength).toBe(checkpointOffset);
    expect(countAnnexbAccessUnits(io.bytes())).toEqual({ pictures: 2, vclNals: 16 });
  });

  it('exact AU boundary is accepted and remains byte-exact', async () => {
    const atBoundary = complete.slice(0, checkpointOffset);
    const io = fakeIo(atBoundary);
    const result = await prepareCheckpointResume(io, 'piece_0.h264', serialized(), expected);
    expect(result.kind).toBe('resume');
    expect(io.bytes()).toEqual(atBoundary);
  });

  it('clean complete bytes take the mandatory repair path with bytesRemoved=0', async () => {
    const fullCheckpoint: ExportCheckpointRecord = {
      ...checkpoint,
      encoderSessionIndex: 1,
      byteOffset: complete.byteLength,
      cumulativePictures: 4,
    };
    const io = fakeIo(complete);
    const result = await prepareCheckpointResume(
      io,
      'piece_0.h264',
      serialized(fullCheckpoint),
      expected,
    );
    expect(result.kind).toBe('resume');
    if (result.kind !== 'resume') return;
    expect(io.prepareCalls).toBe(1);
    expect(result.repair.bytesRemoved).toBe(0);
    expect(result.repair.keptBytes).toBe(complete.byteLength);
  });

  it('stale sourceTimelineHash starts clean without touching Annex-B bytes', async () => {
    const io = fakeIo(complete);
    const before = sha256(io.bytes());
    const result = await prepareCheckpointResume(
      io,
      'piece_0.h264',
      serialized(),
      { ...expected, sourceTimelineHash: 'b'.repeat(64) },
    );
    expect(result).toEqual({
      kind: 'clean',
      reason: 'checkpoint sourceTimelineHash mismatch',
    });
    expect(io.prepareCalls).toBe(0);
    expect(sha256(io.bytes())).toBe(before);
  });

  it('rejects non-monotonic piece/session indices and offsets', () => {
    const manifest = createExportStateManifest({
      sessionId,
      projectId: expected.projectId,
      sourceTimelineHash: hash,
      fps: expected.fps,
      width: expected.width,
      height: expected.height,
    });
    const malformed = JSON.stringify({
      ...manifest,
      checkpoints: [checkpoint, { ...checkpoint, cumulativePictures: 3 }],
    });
    expect(validateExportState(malformed, expected, complete.byteLength)).toEqual({
      kind: 'clean',
      reason: 'checkpoint record 1 is not monotonic',
    });
  });

  it('repair failure after truncation returns bitstream_touched, not clean', async () => {
    const crashAt = vcls[2 * 8 + 5]!.header + 2;
    let bytes = complete.slice(0, crashAt);
    const io: ExportCheckpointResumeIo = {
      sessionFileSize: async () => bytes.byteLength,
      prepareCheckpointResume: async () => {
        const repaired = truncateAnnexbToLastCompleteAu(bytes);
        bytes = repaired.bytes.slice(0, Math.max(0, repaired.bytes.byteLength - 10));
        throw new Error('simulated native failure after whole-AU repair');
      },
    };
    const result = await prepareCheckpointResume(io, 'piece_0.h264', serialized(), expected);
    expect(result.kind).toBe('bitstream_touched');
    if (result.kind !== 'bitstream_touched') return;
    expect(result.reason).toMatch(/repair failed after mutating/);
    expect(result.repair.keptBytes).toBeLessThan(crashAt);
  });
});

describe('exportCheckpoint timeline identity v2', () => {
  const dims = { fps: 30, width: 1920, height: 1080 };

  async function baseHash(): Promise<string> {
    return buildSourceTimelineHash(timelineIdentityFromProject(stubProject(), dims));
  }

  it('includes timelineIdentityVersion so v1 hashes invalidate', async () => {
    const identity = timelineIdentityFromProject(stubProject(), dims);
    expect(identity.timelineIdentityVersion).toBe(EXPORT_TIMELINE_IDENTITY_VERSION);
    const v2 = await buildSourceTimelineHash(identity);
    const v1ish = await buildSourceTimelineHash({
      ...identity,
      timelineIdentityVersion: 1 as typeof EXPORT_TIMELINE_IDENTITY_VERSION,
    });
    expect(v2).not.toBe(v1ish);
  });

  it('each newly covered visual field changes the hash', async () => {
    const base = await baseHash();
    const gradeHash = await buildSourceTimelineHash(timelineIdentityFromProject(
      stubProject({
        segments: [{
          id: 'seg-1',
          text: 'hello',
          assetId: 'asset-1',
          startTime: 0,
          duration: 2,
          transition: TransitionType.NONE,
          animation: AnimationType.NONE,
          order: 0,
          effectGrade: { brightness: 0.1, contrast: 0, saturation: 0, temperature: 0 },
        }],
      }),
      dims,
    ));
    expect(gradeHash).not.toBe(base);

    const overlayHash = await buildSourceTimelineHash(timelineIdentityFromProject(
      stubProject({
        segments: [{
          id: 'seg-1',
          text: 'hello',
          assetId: 'asset-1',
          startTime: 0,
          duration: 2,
          transition: TransitionType.NONE,
          animation: AnimationType.NONE,
          order: 0,
          overlayConfig: {
            color: '#f00',
            backgroundColor: 'transparent',
            fontFamily: 'Arial',
          },
        }],
      }),
      dims,
    ));
    expect(overlayHash).not.toBe(base);

    const globalOverlayHash = await buildSourceTimelineHash(timelineIdentityFromProject(
      stubProject({
        globalOverlayConfig: {
          color: '#00f',
          backgroundColor: 'transparent',
          fontFamily: 'Arial',
        },
      }),
      dims,
    ));
    expect(globalOverlayHash).not.toBe(base);

    const assetHash = await buildSourceTimelineHash(timelineIdentityFromProject(
      stubProject({
        assets: [{
          id: 'asset-1',
          name: 'clip.mp4',
          url: 'blob:x',
          type: 'video',
          addedAt: 12345,
        }],
      }),
      dims,
    ));
    expect(assetHash).not.toBe(base);
  });

  it('excluded UI/sync fields do not change the hash', async () => {
    const base = await baseHash();
    const withLocked = await buildSourceTimelineHash(timelineIdentityFromProject(
      stubProject({
        segments: [{
          id: 'seg-1',
          text: 'hello',
          assetId: 'asset-1',
          startTime: 0,
          duration: 2,
          transition: TransitionType.NONE,
          animation: AnimationType.NONE,
          order: 0,
          locked: true,
          anchorStart: 9.5,
          anchorSource: 'whisper',
        }],
      }),
      dims,
    ));
    expect(withLocked).toBe(base);
  });
});

describe('exportCheckpoint recovery budget', () => {
  const sessionId = '00000000-0000-4000-8000-000000000001';
  const hash = 'a'.repeat(64);
  const expected = {
    projectId: 'proj-1',
    sourceTimelineHash: hash,
    fps: 30,
    width: 1920,
    height: 1080,
  };

  it('old-shape manifest without budget fields still validates', () => {
    const legacy = JSON.stringify({
      schemaVersion: 1,
      sessionId,
      projectId: expected.projectId,
      sourceTimelineHash: hash,
      fps: 30,
      width: 1920,
      height: 1080,
      checkpoints: [{
        pieceIndex: 0,
        encoderSessionIndex: 0,
        byteOffset: 0,
        cumulativePictures: 0,
        fps: 30,
        width: 1920,
        height: 1080,
        sourceTimelineHash: hash,
      }],
    });
    const result = validateExportState(legacy, expected, 0);
    expect(result.kind).toBe('resume');
  });

  it('budget exhaustion halts resume with a distinct recovery_budget_exhausted kind', () => {
    const exhausted = JSON.stringify({
      ...createExportStateManifest({
        sessionId,
        projectId: expected.projectId,
        sourceTimelineHash: hash,
        fps: 30,
        width: 1920,
        height: 1080,
      }),
      boundaryRewindsUsed: MAX_BOUNDARY_REWINDS_PER_EXPORT,
    });
    expect(isRecoveryBudgetExhausted({ boundaryRewindsUsed: MAX_BOUNDARY_REWINDS_PER_EXPORT })).toBe(true);
    expect(validateExportState(exhausted, expected, 0)).toEqual({
      kind: 'recovery_budget_exhausted',
      reason: recoveryBudgetExhaustionReason({ boundaryRewindsUsed: MAX_BOUNDARY_REWINDS_PER_EXPORT }),
      budget: {
        boundaryRewindsUsed: MAX_BOUNDARY_REWINDS_PER_EXPORT,
        hardwareFailoverUsed: false,
        checkpointResumeAttempts: 0,
        totalRecoveryAttempts: 0,
      },
    });

    const totalExhausted = JSON.stringify({
      ...createExportStateManifest({
        sessionId,
        projectId: expected.projectId,
        sourceTimelineHash: hash,
        fps: 30,
        width: 1920,
        height: 1080,
      }),
      totalRecoveryAttempts: MAX_TOTAL_RECOVERY_ATTEMPTS_PER_EXPORT,
    });
    expect(validateExportState(totalExhausted, expected, 0)).toEqual({
      kind: 'recovery_budget_exhausted',
      reason: recoveryBudgetExhaustionReason({ totalRecoveryAttempts: MAX_TOTAL_RECOVERY_ATTEMPTS_PER_EXPORT }),
      budget: {
        boundaryRewindsUsed: 0,
        hardwareFailoverUsed: false,
        checkpointResumeAttempts: 0,
        totalRecoveryAttempts: MAX_TOTAL_RECOVERY_ATTEMPTS_PER_EXPORT,
      },
    });
  });
});

/**
 * WS3 STEP 9 (C7) — the three durable recovery-budget writes, pure and
 * monotonic. Each event bumps its own counter AND `totalRecoveryAttempts`
 * together, in one call — never as two separate writes that could land out
 * of step with each other (a manifest cannot have a rewind counted without
 * the cross-process ceiling seeing it, or vice versa).
 */
describe('exportCheckpoint recovery-budget writes (C7)', () => {
  const sessionId = '00000000-0000-4000-8000-000000000002';
  const hash = 'b'.repeat(64);
  const base = () => createExportStateManifest({
    sessionId, projectId: 'proj-2', sourceTimelineHash: hash, fps: 30, width: 1920, height: 1080,
  });

  it('recordBoundaryRewind increments boundaryRewindsUsed and totalRecoveryAttempts together', () => {
    const m = recordBoundaryRewind(base());
    expect(m.boundaryRewindsUsed).toBe(1);
    expect(m.totalRecoveryAttempts).toBe(1);
    expect(m.hardwareFailoverUsed).toBe(false);
    expect(m.checkpointResumeAttempts).toBe(0);
    const twice = recordBoundaryRewind(m);
    expect(twice.boundaryRewindsUsed).toBe(2);
    expect(twice.totalRecoveryAttempts).toBe(2);
  });

  it('recordHardwareFailover sets the one-shot flag and increments totalRecoveryAttempts, never boundaryRewindsUsed', () => {
    const m = recordHardwareFailover(base());
    expect(m.hardwareFailoverUsed).toBe(true);
    expect(m.totalRecoveryAttempts).toBe(1);
    expect(m.boundaryRewindsUsed).toBe(0);
  });

  it('recordResumeAttempt increments checkpointResumeAttempts and totalRecoveryAttempts, never the others', () => {
    const m = recordResumeAttempt(base());
    expect(m.checkpointResumeAttempts).toBe(1);
    expect(m.totalRecoveryAttempts).toBe(1);
    expect(m.boundaryRewindsUsed).toBe(0);
    expect(m.hardwareFailoverUsed).toBe(false);
  });

  it('a mixed recovery lifecycle (2 rewinds, 1 failover, 1 resume) sums to the documented 4 total — MAX_TOTAL_RECOVERY_ATTEMPTS_PER_EXPORT', () => {
    let m = base();
    m = recordBoundaryRewind(m);
    m = recordBoundaryRewind(m);
    m = recordHardwareFailover(m);
    m = recordResumeAttempt(m);
    expect(m.boundaryRewindsUsed).toBe(2);
    expect(m.hardwareFailoverUsed).toBe(true);
    expect(m.checkpointResumeAttempts).toBe(1);
    expect(m.totalRecoveryAttempts).toBe(4);
    expect(m.totalRecoveryAttempts).toBe(MAX_TOTAL_RECOVERY_ATTEMPTS_PER_EXPORT);
    expect(isRecoveryBudgetExhausted(m)).toBe(true);
  });

  it('none of the three writes touch checkpoints — pure budget mutation, no bitstream implication', () => {
    let m = base();
    m = appendExportCheckpoint(m, {
      pieceIndex: 0, encoderSessionIndex: 0, byteOffset: 100, cumulativePictures: 10,
      fps: 30, width: 1920, height: 1080, sourceTimelineHash: hash,
    });
    const before = m.checkpoints;
    m = recordBoundaryRewind(m);
    m = recordHardwareFailover(m);
    m = recordResumeAttempt(m);
    expect(m.checkpoints).toBe(before);
  });

  it('recordRotationSeen increments rotationsSeen only — never a recovery-budget field', () => {
    const m = recordRotationSeen(base());
    expect(m.rotationsSeen).toBe(1);
    expect(m.totalRecoveryAttempts).toBe(0);
    expect(m.boundaryRewindsUsed).toBe(0);
    const twice = recordRotationSeen(m);
    expect(twice.rotationsSeen).toBe(2);
  });
});

/**
 * WS3 STEP 9 (C7) — the checkpoint-COVERAGE gap `exportCheckpointPlacement
 * .ts` documents, made durably visible: `rotationsSeen > 0 &&
 * checkpoints.length === 0` means the export rotated but never once found
 * a fence-safe seam. Gated on `rotationsSeen`, not bare `checkpoints
 * .length === 0`, so the overwhelmingly common single-session export (under
 * `MAX_ENCODER_SESSION_FRAMES`, 60s) stays silent — it never rotated, so
 * having zero checkpoints is not a defect.
 */
describe('never_checkpointed — the checkpoint-coverage gap (C7)', () => {
  const sessionId = '00000000-0000-4000-8000-000000000003';
  const hash = 'c'.repeat(64);
  const expected = { projectId: 'proj-3', sourceTimelineHash: hash, fps: 30, width: 1920, height: 1080 };

  it('fires when the export rotated but has zero checkpoints', () => {
    const manifest = JSON.stringify({
      ...createExportStateManifest({ sessionId, ...expected }),
      rotationsSeen: 3,
    });
    const result = validateExportState(manifest, expected, 0);
    expect(result.kind).toBe('never_checkpointed');
    if (result.kind !== 'never_checkpointed') return;
    expect(result.reason).toContain('3 encoder session');
  });

  it('does NOT fire for the ordinary single-session export — zero rotations, zero checkpoints, silent', () => {
    const manifest = JSON.stringify(createExportStateManifest({ sessionId, ...expected }));
    const result = validateExportState(manifest, expected, 0);
    // rotationsSeen defaults to 0, so this is the ordinary "no checkpoint
    // fits" clean case, not the alarming never_checkpointed one.
    expect(result.kind).not.toBe('never_checkpointed');
    expect(result.kind).toBe('clean');
  });

  it('does NOT fire when rotations happened AND at least one checkpoint landed', () => {
    let m = createExportStateManifest({ sessionId, ...expected });
    m = { ...m, rotationsSeen: 2 };
    m = appendExportCheckpoint(m, {
      pieceIndex: 0, encoderSessionIndex: 1, byteOffset: 4_000, cumulativePictures: 30,
      fps: 30, width: 1920, height: 1080, sourceTimelineHash: hash,
    });
    const result = validateExportState(JSON.stringify(m), expected, 4_000);
    expect(result.kind).toBe('resume');
  });

  it('old-shape manifests without rotationsSeen still validate (default 0, silent)', () => {
    const legacy = JSON.stringify({
      schemaVersion: 1, sessionId, projectId: expected.projectId,
      sourceTimelineHash: hash, fps: 30, width: 1920, height: 1080,
      checkpoints: [],
      // no rotationsSeen field at all — pre-STEP-9 manifest shape.
    });
    const result = validateExportState(legacy, expected, 0);
    expect(result.kind).not.toBe('never_checkpointed');
  });
});

describe('exportLifetimeBudgetOf (C11, Round 16)', () => {
  it('projects exactly the three export-scoped counters, normalized, and zero for null', () => {
    expect(exportLifetimeBudgetOf(null)).toEqual({ boundaryRewindsUsed: 0, hardwareFailoverUsed: false, totalRecoveryAttempts: 0 });
    expect(exportLifetimeBudgetOf({})).toEqual({ boundaryRewindsUsed: 0, hardwareFailoverUsed: false, totalRecoveryAttempts: 0 });
    expect(exportLifetimeBudgetOf({ boundaryRewindsUsed: 2, hardwareFailoverUsed: true, checkpointResumeAttempts: 5, totalRecoveryAttempts: 4 }))
      .toEqual({ boundaryRewindsUsed: 2, hardwareFailoverUsed: true, totalRecoveryAttempts: 4 });
  });

  it('createExportStateManifest seeds from carriedBudget and keeps piece-scoped fields at zero', () => {
    const m = createExportStateManifest({
      sessionId: 's', projectId: 'p', sourceTimelineHash: 'a'.repeat(64), fps: 30, width: 1920, height: 1080,
      carriedBudget: { boundaryRewindsUsed: 1, hardwareFailoverUsed: true, totalRecoveryAttempts: 2 },
    });
    expect(m.boundaryRewindsUsed).toBe(1);
    expect(m.hardwareFailoverUsed).toBe(true);
    expect(m.totalRecoveryAttempts).toBe(2);
    expect(m.checkpointResumeAttempts).toBe(0);
    expect(m.rotationsSeen).toBe(0);
    expect(m.checkpoints).toEqual([]);
    // The cross-process gate reads the carried total, so a resume into this
    // piece is refused exactly when the EXPORT's budget is gone.
    expect(isRecoveryBudgetExhausted(m)).toBe(false);
    expect(isRecoveryBudgetExhausted({ ...m, boundaryRewindsUsed: 2 })).toBe(true);
  });
});
