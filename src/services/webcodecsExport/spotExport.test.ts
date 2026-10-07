import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import {
  EXPORT_TIMELINE_IDENTITY_VERSION,
  buildSourceTimelineHash,
  canonicalTimelineJson,
  timelineIdentityFromProject,
} from './exportCheckpoint';
import {
  SPOT_LAYER_ORDER,
  canonicalSpotRenderSpecs,
  hasSpotRenderWork,
  specActiveAt,
  spotQuadRect,
  type SpotRenderSpec,
} from './spotRenderSpec';
import { evaluateSpotPathRefusal } from './spotRenderSpec';
import { TransitionType, AnimationType, type Project, type VideoSegment } from '../../types';
import type { WebCodecsRoutingSummary } from './exportPipelineWebCodecs';
import { validateSpotAssets } from './spotAssetGuard';

function sha256(s: string): string {
  return createHash('sha256').update(s).digest('hex');
}

const VIDEO_SPOT: SpotRenderSpec = {
  assetId: 'spot-vid',
  startSec: 5,
  durSec: 8,
  corner: 'top-right',
  heightPct: 40,
};
const IMAGE_SPOT: SpotRenderSpec = {
  assetId: 'spot-img',
  startSec: 20,
  durSec: 3,
  corner: 'bottom-left',
  heightPct: 40,
};

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
        duration: 60,
        transition: TransitionType.NONE,
        animation: AnimationType.NONE,
        order: 0,
      } satisfies VideoSegment,
    ],
    assets: [],
    globalTransition: TransitionType.NONE,
    globalTransitionDuration: 0,
    globalAnimation: AnimationType.NONE,
    globalOverlayConfig: { color: '#fff', backgroundColor: 'transparent', fontFamily: 'Arial' },
    ...overrides,
  };
}

describe('U1 — optional spotRenderSpecs zero-drift', () => {
  it('absent and empty are not render work (worker takes the current path)', () => {
    expect(hasSpotRenderWork(undefined)).toBe(false);
    expect(hasSpotRenderWork(null)).toBe(false);
    expect(hasSpotRenderWork([])).toBe(false);
    expect(hasSpotRenderWork([VIDEO_SPOT])).toBe(true);
  });

  it('no-spec identity JSON (minus version) matches the pre-spot field set', async () => {
    const identity = timelineIdentityFromProject(stubProject(), { fps: 30, width: 1920, height: 1080 });
    expect(identity.spotRenderSpecs).toEqual([]);
    const json = canonicalTimelineJson(identity);
    const parsed = JSON.parse(json) as Record<string, unknown>;
    expect('spotRenderSpecs' in parsed).toBe(true);
    const noSpot = { ...parsed };
    delete noSpot.spotRenderSpecs;
    delete noSpot.timelineIdentityVersion;
    // Golden: today's identity keys minus the version bump and the new array.
    expect(Object.keys(noSpot).sort()).toEqual([
      'aspectRatio',
      'assets',
      'fps',
      'globalAnimation',
      'globalOverlayConfig',
      'globalOverlayFilter',
      'globalTransition',
      'globalTransitionDuration',
      'headings',
      'height',
      'projectId',
      'resolutionTier',
      'schema',
      'segments',
      'textLayers',
      'voiceoverFileIdentity',
      'voiceoverId',
      'width',
    ]);
    expect(sha256(JSON.stringify(noSpot))).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('U2 — layout, timing, layering', () => {
  it('layer order is scene < spots < captions', () => {
    expect([...SPOT_LAYER_ORDER]).toEqual(['scene', 'spots', 'captions']);
  });

  it('percentage layout is frame-size independent (720 vs 1080)', () => {
    const a = spotQuadRect(VIDEO_SPOT, 1280, 720, 1920, 1080);
    const b = spotQuadRect(VIDEO_SPOT, 1920, 1080, 1920, 1080);
    expect(a.h / 720).toBeCloseTo(b.h / 1080, 10);
    expect(a.w / 1280).toBeCloseTo(b.w / 1920, 10);
    expect(a.y / 720).toBeCloseTo(b.y / 1080, 10);
    expect((1280 - a.x - a.w) / 720).toBeCloseTo((1920 - b.x - b.w) / 1080, 10);
  });

  it('literal fixture: video spot [5,13) and image spot [20,23) on a 60s timeline', () => {
    expect(specActiveAt(VIDEO_SPOT, 4.99)).toBe(false);
    expect(specActiveAt(VIDEO_SPOT, 5)).toBe(true);
    expect(specActiveAt(VIDEO_SPOT, 12.99)).toBe(true);
    expect(specActiveAt(VIDEO_SPOT, 13)).toBe(false);
    expect(specActiveAt(IMAGE_SPOT, 20)).toBe(true);
    expect(specActiveAt(IMAGE_SPOT, 22.99)).toBe(true);
    expect(specActiveAt(IMAGE_SPOT, 23)).toBe(false);
    const imgRect = spotQuadRect(IMAGE_SPOT, 1920, 1080, 800, 600);
    expect(imgRect.h).toBeCloseTo(432);
    expect(imgRect.x).toBeCloseTo(0.02 * 1080);
    expect(imgRect.y).toBeCloseTo(1080 - imgRect.h - 0.02 * 1080);
  });
});

describe('U3 — resume identity includes spots', () => {
  const dims = { fps: 30, width: 1920, height: 1080 };

  it('bumps EXPORT_TIMELINE_IDENTITY_VERSION (one-time old-checkpoint invalidation)', () => {
    expect(EXPORT_TIMELINE_IDENTITY_VERSION).toBe(4);
  });

  it('changing spotRenderSpecs changes the source timeline hash', async () => {
    const none = await buildSourceTimelineHash(timelineIdentityFromProject(stubProject(), dims));
    const withSpot = await buildSourceTimelineHash(
      timelineIdentityFromProject(stubProject(), dims, { spotRenderSpecs: [VIDEO_SPOT] }),
    );
    const edited = await buildSourceTimelineHash(
      timelineIdentityFromProject(stubProject(), dims, {
        spotRenderSpecs: [{ ...VIDEO_SPOT, startSec: 6 }],
      }),
    );
    expect(withSpot).not.toBe(none);
    expect(edited).not.toBe(withSpot);
    expect(canonicalSpotRenderSpecs([VIDEO_SPOT, IMAGE_SPOT])[0]!.assetId).toBe('spot-vid');
  });
});

describe('U4 — canvas/legacy refuse rather than drop spots', () => {
  const routingAllGl: WebCodecsRoutingSummary = {
    pieces: [{ tier: 'gl', startIndex: 0, segmentCount: 1, expectedFrames: 1800, gridOriginSec: 0, gridBaseFrame: 0 }],
    segmentCounts: { plain: 0, gl: 1, canvas: 0 },
    pieceCounts: { plain: 0, gl: 1, canvas: 0 },
  };
  const routingCanvas: WebCodecsRoutingSummary = {
    pieces: [{ tier: 'canvas', startIndex: 0, segmentCount: 1, expectedFrames: 1800, gridOriginSec: 0, gridBaseFrame: 0 }],
    segmentCounts: { plain: 0, gl: 0, canvas: 1 },
    pieceCounts: { plain: 0, gl: 0, canvas: 1 },
  };

  it('no specs → no refusal (zero-drift)', () => {
    expect(evaluateSpotPathRefusal(stubProject(), [], { gateOpen: false, routing: null })).toBeNull();
    expect(evaluateSpotPathRefusal(stubProject(), [], { gateOpen: true, routing: routingCanvas })).toBeNull();
  });

  it('legacy path with specs refuses by name', () => {
    const r = evaluateSpotPathRefusal(stubProject(), [VIDEO_SPOT], { gateOpen: false, routing: null });
    expect(r?.path).toBe('legacy');
    expect(r?.message).toMatch(/legacy/i);
    expect(r?.message).toMatch(/spot/i);
  });

  it('canvas/plain piece overlapping a spec refuses by name', () => {
    const r = evaluateSpotPathRefusal(stubProject(), [VIDEO_SPOT], { gateOpen: true, routing: routingCanvas });
    expect(r?.path).toBe('canvas');
    expect(r?.message).toMatch(/canvas/i);
  });

  it('all-GL routing with specs does not refuse', () => {
    expect(evaluateSpotPathRefusal(stubProject(), [VIDEO_SPOT], { gateOpen: true, routing: routingAllGl })).toBeNull();
  });
});

describe('U5 — missing asset typed failure', () => {
  it('names the asset', () => {
    const err = validateSpotAssets(
      [{ id: 'other', name: 'x', url: 'blob:x', type: 'video' }],
      [VIDEO_SPOT],
    );
    expect(err).toMatch(/spot-vid/);
    expect(err).toMatch(/missing|unloadable/i);
  });

  it('accepts a present video+image pair', () => {
    expect(
      validateSpotAssets(
        [
          { id: 'spot-vid', name: 'v.mp4', url: 'blob:v', type: 'video', duration: 12 },
          { id: 'spot-img', name: 'i.png', url: 'blob:i', type: 'image' },
        ],
        [VIDEO_SPOT, IMAGE_SPOT],
      ),
    ).toBeNull();
  });
});
