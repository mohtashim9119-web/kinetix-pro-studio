import { describe, it, expect } from 'vitest';
import { computeObjectCoverUvRect, resolveChasedVideoFrame, type ChasedFrame } from './useGlPreview';

/**
 * Pure-function tests, mock-free — the useGlPreview hook itself can't be
 * unit-tested (this repo has no jsdom/@testing-library/react, same precedent
 * as useWebCodecsPreview.test.ts / compositeParams.test.ts), so its pure,
 * export-reusable helper is tested directly against inputs/outputs. This is
 * the object-cover crop math both PreviewCanvas.tsx and the legacy
 * `<video className="object-cover">` use, now expressed in the source's own
 * UV space (uOffset/vOffset/uScale/vScale) for direct upload to
 * shaders.ts's u_texRectA/u_texRectB uniform — replacing the earlier
 * pixel-rect form that fed a CPU-canvas pre-fit step, removed after it was
 * found to cause a severe WKWebView performance regression (see
 * docs/webgl-architecture-plan.md Section 7's [CORRECTED] object-cover row).
 */

describe('computeObjectCoverUvRect', () => {
  it('same aspect (16:9 source into 16:9 destination): identity — no crop, full [0,1] UV', () => {
    const r = computeObjectCoverUvRect(1280, 720, 1920, 1080);
    expect(r).toEqual({ uOffset: 0, vOffset: 0, uScale: 1, vScale: 1 });
  });

  it('wider-than-destination source: crops horizontally (uScale < 1, centered uOffset), full vScale', () => {
    // 2:1 source (2000x1000) into 1:1 destination (1000x1000): keep full
    // height (vScale=1, vOffset=0), crop width to 1000/2000=0.5 of the
    // source, centered — uOffset = (1 - 0.5) / 2 = 0.25.
    const r = computeObjectCoverUvRect(2000, 1000, 1000, 1000);
    expect(r.vScale).toBe(1);
    expect(r.vOffset).toBe(0);
    expect(r.uScale).toBeCloseTo(0.5, 6);
    expect(r.uOffset).toBeCloseTo(0.25, 6);
  });

  it('taller-than-destination source: crops vertically (vScale < 1, centered vOffset), full uScale', () => {
    // 1:2 source (1000x2000) into 1:1 destination: keep full width
    // (uScale=1, uOffset=0), crop height to 1000/2000=0.5, vOffset=0.25.
    const r = computeObjectCoverUvRect(1000, 2000, 1000, 1000);
    expect(r.uScale).toBe(1);
    expect(r.uOffset).toBe(0);
    expect(r.vScale).toBeCloseTo(0.5, 6);
    expect(r.vOffset).toBeCloseTo(0.25, 6);
  });

  it('portrait source into landscape destination: keeps full uScale, crops top/bottom', () => {
    // 720x1280 (9:16) into 1920x1080 (16:9): srcRatio 0.5625 < dstRatio
    // 1.777, so keep full width (uScale=1), crop height to
    // (720/1.777)/1280 ≈ 0.3164, vOffset = (1 - 0.3164)/2 ≈ 0.3418.
    const r = computeObjectCoverUvRect(720, 1280, 1920, 1080);
    const expectedShPx = 720 / (1920 / 1080);
    expect(r.uScale).toBe(1);
    expect(r.uOffset).toBe(0);
    expect(r.vScale).toBeCloseTo(expectedShPx / 1280, 6);
    expect(r.vOffset).toBeCloseTo((1280 - expectedShPx) / 2 / 1280, 6);
  });

  it('matches PreviewCanvas.tsx\'s own cover math exactly (frameRatio vs canvasRatio branch, same crop), converted to UV space, so the GL path and the legacy canvas fill the stage identically', () => {
    // Reproduce PreviewCanvas.tsx's inline pixel-rect computation for the
    // same inputs, then convert to UV by dividing by the source dimensions —
    // the same conversion computeObjectCoverUvRect performs internally.
    const frameW = 1600;
    const frameH = 900;
    const canvasW = 800;
    const canvasH = 800;
    const canvasRatio = canvasW / canvasH;
    const frameRatio = frameW / frameH;
    let sx = 0;
    let sy = 0;
    let sw = frameW;
    let sh = frameH;
    if (frameRatio > canvasRatio) {
      sw = frameH * canvasRatio;
      sx = (frameW - sw) / 2;
    } else {
      sh = frameW / canvasRatio;
      sy = (frameH - sh) / 2;
    }
    const expected = { uOffset: sx / frameW, vOffset: sy / frameH, uScale: sw / frameW, vScale: sh / frameH };
    expect(computeObjectCoverUvRect(frameW, frameH, canvasW, canvasH)).toEqual(expected);
  });

  it('the returned rect always samples within [0,1]: uOffset+uScale<=1 and vOffset+vScale<=1 (no out-of-bounds source read)', () => {
    for (const [srcW, srcH, dstW, dstH] of [
      [1280, 720, 1920, 1080],
      [2000, 1000, 1000, 1000],
      [1000, 2000, 1000, 1000],
      [720, 1280, 1920, 1080],
      [3840, 2160, 800, 600],
    ] as const) {
      const r = computeObjectCoverUvRect(srcW, srcH, dstW, dstH);
      expect(r.uOffset + r.uScale).toBeLessThanOrEqual(1 + 1e-9);
      expect(r.vOffset + r.vScale).toBeLessThanOrEqual(1 + 1e-9);
      expect(r.uOffset).toBeGreaterThanOrEqual(0);
      expect(r.vOffset).toBeGreaterThanOrEqual(0);
    }
  });
});

/**
 * resolveChasedVideoFrame — the fix for the video-video pre-boundary blend
 * gap (docs/webgl-architecture-plan.md's "video-video transition blend gap"
 * closeout entry). Before this fix, the render effect's local resolver only
 * ever checked `currentFrame`/`currentFrameSegmentId` and the outgoing chase
 * state — there was no third branch for an `incoming` chase, so a video
 * incoming segment could never resolve a frame during the pre-boundary half
 * (bounds-based currentSegment hadn't reached it yet). These tests exercise
 * the shared resolver directly with plain sentinel objects standing in for
 * VideoFrame (the function only ever compares them by reference/segmentId,
 * never touches the real VideoFrame API surface — consistent with this
 * repo's no-jsdom/no-WebCodecs-runtime testing precedent).
 */
describe('resolveChasedVideoFrame', () => {
  const frameCurrent = {} as unknown as VideoFrame;
  const frameOutgoing = {} as unknown as VideoFrame;
  const frameIncoming = {} as unknown as VideoFrame;

  it('resolves via currentFrame when currentFrameSegmentId matches the requested segment', () => {
    expect(resolveChasedVideoFrame('seg-a', frameCurrent, 'seg-a', null, null)).toBe(frameCurrent);
  });

  it('post-boundary: falls through to the outgoing chase state once currentFrame has moved on to the incoming segment', () => {
    const outgoing: ChasedFrame = { frame: frameOutgoing, segmentId: 'seg-a' };
    expect(resolveChasedVideoFrame('seg-a', frameCurrent, 'seg-b', outgoing, null)).toBe(frameOutgoing);
  });

  it('THE FIX — pre-boundary: falls through to the incoming chase state when currentFrame still belongs to the outgoing segment', () => {
    const incoming: ChasedFrame = { frame: frameIncoming, segmentId: 'seg-b' };
    expect(resolveChasedVideoFrame('seg-b', frameCurrent, 'seg-a', null, incoming)).toBe(frameIncoming);
  });

  it('video-video pre-boundary: both slots resolve on the same tick — outgoing via currentFrame, incoming via the new chase — so the render effect never has to fall back to a single-slot blit', () => {
    const incoming: ChasedFrame = { frame: frameIncoming, segmentId: 'seg-b' };
    expect(resolveChasedVideoFrame('seg-a', frameCurrent, 'seg-a', null, incoming)).toBe(frameCurrent);
    expect(resolveChasedVideoFrame('seg-b', frameCurrent, 'seg-a', null, incoming)).toBe(frameIncoming);
  });

  it('currentFrame takes precedence over a same-segment outgoing/incoming chase entry (freshest source wins)', () => {
    const outgoing: ChasedFrame = { frame: frameOutgoing, segmentId: 'seg-a' };
    const incoming: ChasedFrame = { frame: frameIncoming, segmentId: 'seg-a' };
    expect(resolveChasedVideoFrame('seg-a', frameCurrent, 'seg-a', outgoing, incoming)).toBe(frameCurrent);
  });

  it('a chase entry tagged for a different segment id is never mistaken for the requested one', () => {
    const outgoing: ChasedFrame = { frame: frameOutgoing, segmentId: 'seg-x' };
    const incoming: ChasedFrame = { frame: frameIncoming, segmentId: 'seg-y' };
    expect(resolveChasedVideoFrame('seg-a', null, null, outgoing, incoming)).toBeNull();
  });

  it('returns null when nothing covers the requested segment (no decoded frame anywhere yet)', () => {
    expect(resolveChasedVideoFrame('seg-c', frameCurrent, 'seg-a', null, null)).toBeNull();
  });
});
