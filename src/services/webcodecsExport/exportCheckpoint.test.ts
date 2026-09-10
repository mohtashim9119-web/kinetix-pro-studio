import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import {
  appendExportCheckpoint,
  buildSourceTimelineHash,
  canonicalTimelineJson,
  createExportStateManifest,
  prepareCheckpointResume,
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
        const repaired = truncateAnnexbToLastCompleteAu(bytes);
        if (repaired.bytes.byteLength < record.byteOffset) {
          throw new Error('repair fell before checkpoint');
        }
        const originalLength = bytes.byteLength;
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
});
