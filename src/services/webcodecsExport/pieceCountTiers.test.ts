/**
 * Pin: a CLEAN plain-image piece and a CLEAN canvas piece produce no deviation.
 * `plan.expectedFrames` for both is the same `Math.round(duration * fps)` the
 * encoders themselves use (plain image: `-frames:v` cap in `segmentEncoder.ts`;
 * canvas: `totalFrames` in `encodeSegment`), and the counter counts the same
 * pictures the concat guard does — so the completion guard raises nothing.
 */
import { describe, it, expect, vi } from 'vitest';
import { TransitionType, AnimationType } from '../../types';
import type { Asset, Project, VideoSegment } from '../../types';

const tier = vi.hoisted(() => ({ plainImage: true }));
vi.mock('../plainSegment', () => ({
  isPlainVideoSegment: () => false,
  isPlainImageSegment: () => tier.plainImage,
}));
vi.mock('./glCompositable', () => ({ isGlCompositableSegment: () => false, GL_TRANSITION_SLUGS: new Set<string>() }));
vi.mock('../segmentEncoder', () => ({
  encodeSegment: vi.fn(async () => new Uint8Array([1, 2, 3])),
  encodePlainVideoSegment: vi.fn(async () => new Uint8Array([1, 2, 3])),
  encodeStaticImageSegment: vi.fn(async () => new Uint8Array([1, 2, 3])),
}));
vi.mock('./muxOnly', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./muxOnly')>()),
  muxOnly: vi.fn(async () => undefined),
}));

// eslint-disable-next-line import/first
import { exportProjectWebCodecs, type WebCodecsFfmpeg } from './exportPipelineWebCodecs';

const FPS = 30;
const seg = (i: number): VideoSegment => ({
  id: `s${i}`, text: '', assetId: `a${i}`, startTime: i, duration: 1,
  transition: TransitionType.NONE, animation: AnimationType.NONE, order: i,
});
const project = (): Project => ({
  id: 'proj-tiers', name: 'T', script: '', sceneDetails: '',
  segments: [seg(0), seg(1)],
  assets: [0, 1].map((i) => ({ id: `a${i}`, name: `a${i}.png`, url: `blob:a${i}`, type: 'image' }) as Asset),
  globalTransition: TransitionType.NONE, globalTransitionDuration: 0, globalAnimation: AnimationType.NONE,
  globalOverlayConfig: { color: '#fff', backgroundColor: 'transparent', fontFamily: 'Inter' },
});

function ffmpeg(): WebCodecsFfmpeg {
  return {
    writeFile: vi.fn(async () => undefined), writeFileRaw: vi.fn(async () => undefined), exec: vi.fn(async () => 0),
    readFile: vi.fn(async () => new Uint8Array()), deleteFile: vi.fn(async () => undefined),
    appendFileRaw: vi.fn(async () => undefined), saveSessionFile: vi.fn(async () => undefined),
    kill: vi.fn(async () => undefined), destroy: vi.fn(async () => undefined),
    sessionFileSize: vi.fn(async () => 1_000),
    // Each piece is 1 s at 30 fps = 30 pictures; the whole film is 60.
    countAnnexbFrames: vi.fn(async (p: string) => {
      const n = p.startsWith('piece_') ? 30 : 60;
      return { pictures: n, vclNals: n };
    }),
    concatAnnexbPieces: vi.fn(async () => undefined),
    truncateAnnexb: vi.fn(async () => ({ pictures: 0, vclNals: 0, bytesRemoved: 0, keptBytes: 0 })),
  } as unknown as WebCodecsFfmpeg;
}

describe('per-tier exactness of the completion guard', () => {
  it('a clean plain-image piece and a clean canvas piece produce no deviation and no seal decision', async () => {
    for (const plainImage of [true, false]) {
      tier.plainImage = plainImage;
      const warnings: string[] = [];
      const warn = vi.spyOn(console, 'warn').mockImplementation((...a: unknown[]) => { warnings.push(a.map(String).join(' ')); });
      const offers: unknown[] = [];
      const r = await exportProjectWebCodecs(
        project(), ffmpeg(),
        { width: 1920, height: 1080, fps: FPS, requestForcedSealConsent: async (o) => { offers.push(o); return false; } },
      );
      warn.mockRestore();
      expect(r.ok, plainImage ? 'plain image tier' : 'canvas tier').toBe(true);
      expect(warnings.filter((w) => w.includes('[ws3-piece-count]'))).toEqual([]);
      expect(offers).toEqual([]);
    }
  });
});
