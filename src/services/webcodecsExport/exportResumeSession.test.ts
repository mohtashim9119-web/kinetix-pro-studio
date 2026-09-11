/**
 * WS3 Round 12, STEP 1 — `findResumeOffer`'s refusal notice.
 *
 * Discovery already tells the difference between "nothing to resume" and
 * "resume was refused for a reason the operator needs to hear"
 * (`exportResumeDiscovery.test.ts`). This file is the one layer up: proving
 * `findResumeOffer` actually turns that difference into the `notice` it
 * returns, for the two cases that must reach the operator (`bitstream_touched`,
 * `budget_exhausted`) and staying silent for the ordinary ones that must not
 * (identity mismatch, no checkpoint fits, unreadable session).
 */
import { describe, it, expect } from 'vitest';
import type { Project } from '../../types';
import { AnimationType, TransitionType } from '../../types';
import { findResumeOffer } from './exportResumeSession';
import {
  appendExportCheckpoint,
  createExportStateManifest,
  serializeExportState,
  type ExportCheckpointRecord,
} from './exportCheckpoint';
import type { ResumeDiscoveryIo, ResumeSessionHandle } from './exportResumeDiscovery';

const SESSION = '11111111-2222-4333-8444-555555555555';

function project(): Project {
  return {
    id: 'proj-1',
    name: 'p',
    aspectRatio: '16:9',
    resolutionTier: '1080p',
    segments: [],
    assets: [],
    globalTransition: TransitionType.NONE,
    globalTransitionDuration: 0,
    globalAnimation: AnimationType.NONE,
  } as unknown as Project;
}

function ioFor(handle: Partial<ResumeSessionHandle> & { readExportState: ResumeSessionHandle['readExportState'] }): ResumeDiscoveryIo {
  return {
    listResumableSessionIds: async () => [SESSION],
    reenter: async (sessionId) => ({
      sessionId,
      sessionFileSize: async () => 5_000,
      prepareCheckpointResume: async () => { throw new Error('should not be called'); },
      truncateAnnexbToOffset: async (_p, off) => ({ pictures: 0, vclNals: 0, bytesRemoved: 0, keptBytes: off }),
      destroy: async () => {},
      ...handle,
    }),
  };
}

describe('findResumeOffer — resume refusal notice', () => {
  it('bitstream_touched reaches the caller as a notice, with no offer', async () => {
    let currentSize = 5_000;
    const io = ioFor({
      readExportState: async () => new TextEncoder().encode(
        manifestJsonFor({ byteOffset: 4_000, cumulativePictures: 30, hash: await expectedHash() }),
      ),
      sessionFileSize: async () => currentSize,
      prepareCheckpointResume: async () => {
        currentSize = 4_000;
        throw new Error('checkpoint offset is not a canonical whole-AU boundary');
      },
    });
    const { offer, notice } = await findResumeOffer({
      project: project(), fps: 30, width: 1920, height: 1080,
      pieceExpectedFrames: [60], io, nowMs: 0,
    });
    expect(offer).toBeNull();
    expect(notice?.kind).toBe('bitstream_touched');
    expect(notice?.bitstreamTouched).toEqual({ path: 'piece_0.h264', fileLengthBefore: 5_000, fileLengthAfter: 4_000 });
  });

  it('budget_exhausted reaches the caller as a notice, with no offer', async () => {
    let manifest = createExportStateManifest({
      sessionId: SESSION, projectId: 'proj-1', sourceTimelineHash: await expectedHash(), fps: 30, width: 1920, height: 1080,
    });
    manifest.totalRecoveryAttempts = 4;
    manifest = appendExportCheckpoint(manifest, {
      pieceIndex: 0, encoderSessionIndex: 0, byteOffset: 4_000, cumulativePictures: 30,
      fps: 30, width: 1920, height: 1080, sourceTimelineHash: await expectedHash(),
    });
    const io = ioFor({ readExportState: async () => new TextEncoder().encode(serializeExportState(manifest)) });
    const { offer, notice } = await findResumeOffer({
      project: project(), fps: 30, width: 1920, height: 1080,
      pieceExpectedFrames: [60], io, nowMs: 0,
    });
    expect(offer).toBeNull();
    expect(notice?.kind).toBe('budget_exhausted');
    expect(notice?.reason).toContain('recovery budget exhausted');
  });

  it('an ordinary identity mismatch (v1-era manifest, wrong project, etc.) yields NO notice — silent, not alarming', async () => {
    const io = ioFor({
      readExportState: async () => new TextEncoder().encode(
        manifestJsonFor({ byteOffset: 4_000, cumulativePictures: 30, hash: 'f'.repeat(64) }),
      ),
    });
    const { offer, notice } = await findResumeOffer({
      project: project(), fps: 30, width: 1920, height: 1080,
      pieceExpectedFrames: [60], io, nowMs: 0,
    });
    expect(offer).toBeNull();
    expect(notice).toBeNull();
  });

  it('no surviving sessions at all yields no offer and no notice', async () => {
    const io: ResumeDiscoveryIo = { listResumableSessionIds: async () => [], reenter: async () => { throw new Error('unreachable'); } };
    const { offer, notice } = await findResumeOffer({
      project: project(), fps: 30, width: 1920, height: 1080,
      pieceExpectedFrames: [60], io, nowMs: 0,
    });
    expect(offer).toBeNull();
    expect(notice).toBeNull();
  });

  // WS3 STEP 8 (H5) — a live claim held by a DIFFERENT process must reach
  // the caller as its own distinct notice kind, decided before `reenter` is
  // even attempted (so `prepareCheckpointResume` throwing "should not be
  // called" — ioFor's default — would fail this test if the block did not
  // actually short-circuit).
  it('a live claim reaches the caller as a live_claim_blocked notice, with no offer, and never attempts reenter', async () => {
    let reentered = false;
    const io: ResumeDiscoveryIo = {
      listResumableSessionIds: async () => [SESSION],
      reenter: async (sessionId) => {
        reentered = true;
        return {
          sessionId,
          readExportState: async () => { throw new Error('should not be called — live claim must block first'); },
          sessionFileSize: async () => 5_000,
          prepareCheckpointResume: async () => { throw new Error('should not be called'); },
          truncateAnnexbToOffset: async (_p, off) => ({ pictures: 0, vclNals: 0, bytesRemoved: 0, keptBytes: off }),
          destroy: async () => {},
        };
      },
      readSessionClaim: async () => ({ holderLiveness: 'live' }),
    };
    const { offer, notice } = await findResumeOffer({
      project: project(), fps: 30, width: 1920, height: 1080,
      pieceExpectedFrames: [60], io, nowMs: 0,
    });
    expect(offer).toBeNull();
    expect(notice?.kind).toBe('live_claim_blocked');
    expect(notice?.reason).toContain('another window is using this session');
    expect(reentered).toBe(false);
  });
});

async function expectedHash(): Promise<string> {
  const { buildSourceTimelineHash, timelineIdentityFromProject } = await import('./exportCheckpoint');
  return buildSourceTimelineHash(timelineIdentityFromProject(project(), { fps: 30, width: 1920, height: 1080 }));
}

function manifestJsonFor(params: { byteOffset: number; cumulativePictures: number; hash?: string }): string {
  const hash = params.hash;
  const record: Omit<ExportCheckpointRecord, 'sourceTimelineHash' | 'fps' | 'width' | 'height'> = {
    pieceIndex: 0, encoderSessionIndex: 0, byteOffset: params.byteOffset, cumulativePictures: params.cumulativePictures,
  };
  // Built synchronously with a placeholder hash when the real (async) one
  // isn't needed — the mismatch tests pass an explicit wrong hash instead.
  const finalHash = hash ?? 'a'.repeat(64);
  let manifest = createExportStateManifest({
    sessionId: SESSION, projectId: 'proj-1', sourceTimelineHash: finalHash, fps: 30, width: 1920, height: 1080,
  });
  manifest = appendExportCheckpoint(manifest, { ...record, sourceTimelineHash: finalHash, fps: 30, width: 1920, height: 1080 });
  return serializeExportState(manifest);
}
