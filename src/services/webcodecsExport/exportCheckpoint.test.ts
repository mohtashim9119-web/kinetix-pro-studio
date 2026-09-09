import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import {
  appendExportCheckpoint,
  buildSourceTimelineHash,
  canonicalTimelineJson,
  createExportStateManifest,
  serializeExportState,
  timelineIdentityFromProject,
} from './exportCheckpoint';
import {
  buildSyntheticMultiSliceAnnexb,
  countAnnexbAccessUnits,
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
