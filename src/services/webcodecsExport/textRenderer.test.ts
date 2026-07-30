import { describe, it, expect } from 'vitest';
import {
  overlayCacheKey,
  bodyCaptionCacheKey,
  headingCacheKey,
  filterVisibleTextLayers,
  resolveBodyCaptionConfig,
  computeHeadingScale,
  computeHeadingAtlasPlan,
  type TextRenderGlobalConfig,
} from './textRenderer';
import { getActiveHeadingAt } from '../headingLayer';
import { HEADING_SUPERSAMPLE_FACTOR } from '../headingRenderConstants';
import { TransitionType, AnimationType } from '../../types';
import type { HeadingOverlay, TextOverlay, VideoSegment } from '../../types';

// ---------------------------------------------------------------------------
// GL rendering itself is not unit-testable without a real GL context (see
// this file's own scope note in textRenderer.ts / the Step 6 report) — these
// tests cover exactly the PURE logic the plan calls out: atlas cache key
// derivation, text config derivation from segment/project, hiddenOnSegments
// filtering, and heading lookup via getActiveHeadingAt.
// ---------------------------------------------------------------------------

function makeOverlay(partial: Partial<TextOverlay> & { id: string; text: string }): TextOverlay {
  return {
    color: '#ffffff',
    backgroundColor: '#000000',
    fontFamily: 'Inter',
    fontSize: 32,
    position: { x: 50, y: 50 },
    ...partial,
  };
}

function makeSegment(partial: Partial<VideoSegment> & { id: string }): VideoSegment {
  return {
    text: '',
    startTime: 0,
    duration: 3,
    transition: TransitionType.NONE,
    animation: AnimationType.NONE,
    order: 0,
    ...partial,
  };
}

function makeHeading(partial: Partial<HeadingOverlay> & { id: string; time: number; duration: number }): HeadingOverlay {
  return {
    text: 'Heading',
    fontFamily: 'Inter',
    fontSize: 48,
    fontWeight: 'bold',
    color: '#ffffff',
    backgroundColor: '#000000',
    x: 50,
    y: 50,
    ...partial,
  };
}

describe('overlayCacheKey', () => {
  it('is identical for two overlays with identical style/text/frame size', () => {
    const a = makeOverlay({ id: 'a', text: 'Hello' });
    const b = makeOverlay({ id: 'b', text: 'Hello' }); // different id — id is not content
    expect(overlayCacheKey(a, 1920, 1080)).toBe(overlayCacheKey(b, 1920, 1080));
  });

  it('is NOT affected by position (position is a separate quad transform, not atlas content)', () => {
    const a = makeOverlay({ id: 'a', text: 'Hello', position: { x: 10, y: 10 } });
    const b = makeOverlay({ id: 'a', text: 'Hello', position: { x: 90, y: 90 } });
    expect(overlayCacheKey(a, 1920, 1080)).toBe(overlayCacheKey(b, 1920, 1080));
  });

  it.each<[string, Partial<TextOverlay>]>([
    ['text', { text: 'Different' }],
    ['fontFamily', { fontFamily: 'Anton' }],
    ['fontSize', { fontSize: 64 }],
    ['fontWeight', { fontWeight: 700 }],
    ['fontStyle', { fontStyle: 'italic' }],
    ['color', { color: '#ff0000' }],
    ['backgroundColor', { backgroundColor: '#00ff00' }],
    ['textShadow', { textShadow: '0 0 0 red' }],
    ['textAlign', { textAlign: 'left' }],
  ])('differs when %s changes', (_label, override) => {
    const a = makeOverlay({ id: 'a', text: 'Hello' });
    const b = makeOverlay({ id: 'a', text: 'Hello', ...override });
    expect(overlayCacheKey(a, 1920, 1080)).not.toBe(overlayCacheKey(b, 1920, 1080));
  });

  it('differs when frame size changes (rendering resolution is part of the key)', () => {
    const a = makeOverlay({ id: 'a', text: 'Hello' });
    expect(overlayCacheKey(a, 1920, 1080)).not.toBe(overlayCacheKey(a, 1280, 720));
  });

  it('numeric and string fontWeight collapse to the same key (same rendered font string)', () => {
    const a = makeOverlay({ id: 'a', text: 'Hello', fontWeight: 700 });
    const b = makeOverlay({ id: 'a', text: 'Hello', fontWeight: '700' });
    expect(overlayCacheKey(a, 1920, 1080)).toBe(overlayCacheKey(b, 1920, 1080));
  });
});

describe('bodyCaptionCacheKey', () => {
  const base = { text: 'Caption', fontFamily: 'Inter', color: '#fff', bgColor: '#000', fontWeight: 900, fontStyle: 'normal', shadow: 'none', bodyPx: 24, refScale: 1, frameW: 1920 };

  it('identical params produce identical keys', () => {
    expect(bodyCaptionCacheKey({ ...base })).toBe(bodyCaptionCacheKey({ ...base }));
  });

  it.each(['text', 'fontFamily', 'color', 'bgColor', 'fontWeight', 'fontStyle', 'shadow', 'bodyPx', 'refScale', 'frameW'] as const)(
    'differs when %s changes',
    (field) => {
      const override = field === 'fontWeight' || field === 'bodyPx' || field === 'refScale' || field === 'frameW' ? 999 : 'CHANGED';
      const a = bodyCaptionCacheKey({ ...base });
      const b = bodyCaptionCacheKey({ ...base, [field]: override });
      expect(a).not.toBe(b);
    },
  );
});

describe('headingCacheKey', () => {
  it('identical headings produce identical keys', () => {
    const h = makeHeading({ id: 'h1', time: 0, duration: 1 });
    expect(headingCacheKey(h, 1920, 1080)).toBe(headingCacheKey(h, 1920, 1080));
  });

  it('differs when position changes — UNLIKE overlay/caption, position IS baked into the heading atlas', () => {
    const a = makeHeading({ id: 'h1', time: 0, duration: 1, x: 10, y: 10 });
    const b = makeHeading({ id: 'h1', time: 0, duration: 1, x: 90, y: 90 });
    expect(headingCacheKey(a, 1920, 1080)).not.toBe(headingCacheKey(b, 1920, 1080));
  });

  it('is NOT affected by backgroundColor (the bg fill is a separate solid quad, not part of the text atlas)', () => {
    const a = makeHeading({ id: 'h1', time: 0, duration: 1, backgroundColor: '#000000' });
    const b = makeHeading({ id: 'h1', time: 0, duration: 1, backgroundColor: 'rgba(255,0,0,0.4)' });
    expect(headingCacheKey(a, 1920, 1080)).toBe(headingCacheKey(b, 1920, 1080));
  });

  it('differs when frame size changes (wrap width / vertical centering depend on it)', () => {
    const h = makeHeading({ id: 'h1', time: 0, duration: 1 });
    expect(headingCacheKey(h, 1920, 1080)).not.toBe(headingCacheKey(h, 1280, 720));
  });
});

// ---------------------------------------------------------------------------
// Heading text quality fix (1080-reference scale + supersampled
// rasterization) — computeHeadingScale/computeHeadingAtlasPlan are the pure
// size/position math extracted out of buildHeadingTextAtlas specifically so
// they're unit-testable. The actual OffscreenCanvas rasterization inside
// buildHeadingTextAtlas (the Canvas2D quality settings —
// imageSmoothingEnabled/imageSmoothingQuality/textRendering — actually being
// applied, and the resulting bitmap being correct) falls under this file's
// existing "GL rendering itself is not unit-testable without a real GL
// context" scope note above: this Node/vitest environment has no
// OffscreenCanvas global, so that half is manual/code-inspection-verified
// only, same as every other atlas builder in this file (buildOverlayAtlas,
// buildBodyCaptionAtlas — neither has ever had a rasterization-level test).
// ---------------------------------------------------------------------------

describe('computeHeadingScale (1080-reference scale, heading text quality fix)', () => {
  it('is 1.0 at the 1080p reference height — no change to existing 1080p exports', () => {
    expect(computeHeadingScale(1080)).toBe(1);
  });

  it('is ~0.667 at 720p — proportionally smaller, matching resolveBodyCaptionConfig\'s refScale convention', () => {
    expect(computeHeadingScale(720)).toBeCloseTo(720 / 1080, 10);
  });

  it('scales linearly with frame height generally', () => {
    expect(computeHeadingScale(540)).toBeCloseTo(0.5);
    expect(computeHeadingScale(2160)).toBeCloseTo(2);
  });
});

describe('computeHeadingAtlasPlan (supersampled atlas sizing, heading text quality fix)', () => {
  it('supersamples the atlas canvas to HEADING_SUPERSAMPLE_FACTOR x frame size', () => {
    const h = makeHeading({ id: 'h1', time: 0, duration: 1 });
    const plan = computeHeadingAtlasPlan(h, 1920, 1080);
    expect(plan.ssW).toBe(1920 * HEADING_SUPERSAMPLE_FACTOR);
    expect(plan.ssH).toBe(1080 * HEADING_SUPERSAMPLE_FACTOR);
  });

  it('effective font size = heading.fontSize x headingScale x supersample factor', () => {
    const h = makeHeading({ id: 'h1', time: 0, duration: 1, fontSize: 48 });
    const plan1080 = computeHeadingAtlasPlan(h, 1920, 1080);
    expect(plan1080.headingScale).toBe(1);
    expect(plan1080.fontSizePx).toBe(48 * 1 * HEADING_SUPERSAMPLE_FACTOR);

    const plan720 = computeHeadingAtlasPlan(h, 1280, 720);
    expect(plan720.headingScale).toBeCloseTo(720 / 1080, 10);
    expect(plan720.fontSizePx).toBeCloseTo(48 * (720 / 1080) * HEADING_SUPERSAMPLE_FACTOR, 10);
  });
});

describe('filterVisibleTextLayers (hiddenOnSegments)', () => {
  it('keeps a layer with no hiddenOnSegments on every segment', () => {
    const layer = makeOverlay({ id: 'l1', text: 'Global' });
    expect(filterVisibleTextLayers([layer], 'seg-a')).toEqual([layer]);
    expect(filterVisibleTextLayers([layer], 'seg-b')).toEqual([layer]);
  });

  it('hides a layer only on the listed segment id, keeps it on others', () => {
    const layer = makeOverlay({ id: 'l1', text: 'Global', hiddenOnSegments: ['seg-a'] });
    expect(filterVisibleTextLayers([layer], 'seg-a')).toEqual([]);
    expect(filterVisibleTextLayers([layer], 'seg-b')).toEqual([layer]);
  });

  it('handles multiple layers independently', () => {
    const l1 = makeOverlay({ id: 'l1', text: 'A', hiddenOnSegments: ['seg-a'] });
    const l2 = makeOverlay({ id: 'l2', text: 'B', hiddenOnSegments: ['seg-b'] });
    const l3 = makeOverlay({ id: 'l3', text: 'C' });
    expect(filterVisibleTextLayers([l1, l2, l3], 'seg-a')).toEqual([l2, l3]);
    expect(filterVisibleTextLayers([l1, l2, l3], 'seg-b')).toEqual([l1, l3]);
    expect(filterVisibleTextLayers([l1, l2, l3], 'seg-c')).toEqual([l1, l2, l3]);
  });
});

describe('resolveBodyCaptionConfig', () => {
  const global: TextRenderGlobalConfig = { overlayConfig: { color: '#AAAAAA', backgroundColor: '#111111', fontFamily: 'Anton' } };

  it('returns null when showOverlay is falsy', () => {
    const seg = makeSegment({ id: 's1', text: 'Hi', showOverlay: false });
    expect(resolveBodyCaptionConfig(seg, global, 1920, 1080)).toBeNull();
  });

  it('returns null when showOverlay is true but text is empty', () => {
    const seg = makeSegment({ id: 's1', text: '', showOverlay: true });
    expect(resolveBodyCaptionConfig(seg, global, 1920, 1080)).toBeNull();
  });

  it('falls back to the global overlayConfig per-field when segment.overlayConfig is absent', () => {
    const seg = makeSegment({ id: 's1', text: 'Hi', showOverlay: true });
    const resolved = resolveBodyCaptionConfig(seg, global, 1920, 1080);
    expect(resolved).not.toBeNull();
    expect(resolved!.color).toBe('#AAAAAA');
    expect(resolved!.bgColor).toBe('#111111');
    expect(resolved!.fontFamily).toBe('Anton');
    expect(resolved!.fontWeight).toBe(900); // hardcoded default, not from global
    expect(resolved!.xPct).toBeCloseTo(0.5);
    expect(resolved!.yPct).toBeCloseTo(0.78);
  });

  it('segment.overlayConfig fields win per-field over the global fallback', () => {
    const seg = makeSegment({
      id: 's1',
      text: 'Hi',
      showOverlay: true,
      overlayConfig: { color: '#FF0000', backgroundColor: '#111111', fontFamily: 'Inter', x: 10, y: 20, fontWeight: 400 },
    });
    const resolved = resolveBodyCaptionConfig(seg, global, 1920, 1080)!;
    expect(resolved.color).toBe('#FF0000'); // segment wins
    expect(resolved.fontFamily).toBe('Inter'); // segment wins
    expect(resolved.fontWeight).toBe(400); // segment wins
    expect(resolved.xPct).toBeCloseTo(0.1);
    expect(resolved.yPct).toBeCloseTo(0.2);
  });

  it('falls back to DEFAULT_GLOBAL_OVERLAY_CONFIG when global.overlayConfig is entirely absent (orchestrator gap)', () => {
    const seg = makeSegment({ id: 's1', text: 'Hi', showOverlay: true });
    const resolved = resolveBodyCaptionConfig(seg, {}, 1920, 1080)!;
    expect(resolved.color).toBe('#FFFFFF');
    expect(resolved.bgColor).toBe('#000000');
    expect(resolved.fontFamily).toBe('Inter');
  });

  it('bodyPx scales with frame height via refScale = frameH/1080', () => {
    const seg = makeSegment({ id: 's1', text: 'Hi', showOverlay: true, overlayConfig: { color: '#fff', backgroundColor: '#000', fontFamily: 'Inter', fontSize: 24 } });
    const at1080 = resolveBodyCaptionConfig(seg, global, 1920, 1080)!;
    const at540 = resolveBodyCaptionConfig(seg, global, 960, 540)!;
    expect(at1080.bodyPx).toBe(24); // refScale=1
    expect(at540.bodyPx).toBe(12); // refScale=0.5
  });
});

describe('getActiveHeadingAt (heading lookup used by this renderer)', () => {
  it('finds the heading whose [time, time+duration) window contains t', () => {
    const h = makeHeading({ id: 'h1', time: 2, duration: 1 });
    expect(getActiveHeadingAt([h], 2.0)).toBe(h); // start-inclusive
    expect(getActiveHeadingAt([h], 2.5)).toBe(h);
    expect(getActiveHeadingAt([h], 2.999)).toBe(h);
  });

  it('is end-exclusive', () => {
    const h = makeHeading({ id: 'h1', time: 2, duration: 1 });
    expect(getActiveHeadingAt([h], 3.0)).toBeUndefined();
  });

  it('returns undefined outside every heading window', () => {
    const h = makeHeading({ id: 'h1', time: 2, duration: 1 });
    expect(getActiveHeadingAt([h], 0)).toBeUndefined();
    expect(getActiveHeadingAt([h], 10)).toBeUndefined();
  });

  it('last-in-array wins when headings overlap at t', () => {
    const h1 = makeHeading({ id: 'h1', time: 0, duration: 5, text: 'First' });
    const h2 = makeHeading({ id: 'h2', time: 1, duration: 5, text: 'Second' });
    expect(getActiveHeadingAt([h1, h2], 2)).toBe(h2);
    expect(getActiveHeadingAt([h2, h1], 2)).toBe(h1);
  });
});
