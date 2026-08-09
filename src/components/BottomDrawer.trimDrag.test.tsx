// @vitest-environment jsdom
/**
 * WS3 Batch B tail-defect regression (docs/ws3-video-segments/ws3-audit.md,
 * "Batch B tail defect" section) — pins the actual mechanism of the fix, not
 * the source-time arithmetic (that was already correct and unchanged; see
 * `useWebCodecsPreview.test.ts`'s existing Case B boundary tests, which keep
 * passing before and after this fix and therefore cannot be the regression
 * guard for this bug).
 *
 * The real defect: dragging the drawer's Clip Trim slider used to call
 * `onUpdateSegment` (a full, immutable `setProject`) on every raw
 * `pointermove`, which — via `App.tsx`'s `currentSegment` useMemo and
 * `useWebCodecsPreview.ts`'s decode-ahead effect — tore down and rebuilt the
 * WebCodecs decode session dozens of times per second, racing against
 * itself (see BottomDrawer.tsx's `liveTrimStart` comment for the full
 * mechanism). None of that async decode/session-churn behavior is reachable
 * from jsdom (no real VideoDecoder, no real decode timing) — what IS
 * directly pinnable, and what this test pins, is the observable trigger:
 * how many times a drag gesture calls `onUpdateSegment`. Before the fix that
 * was once per `pointermove` tick (5 moves below → 5 calls, the failing
 * assertion); after the fix it is exactly once, at release, with the
 * correctly clamped final value. Proving the trigger is gone is not the same
 * as proving the decode race can never happen for some other reason — the
 * owner's manual retest (drag to max slip in the real app, watch the
 * preview) remains the actual verification for the runtime symptom.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';
import { BottomDrawer } from './BottomDrawer';
import type { Asset, VideoSegment } from '../types';
import { TransitionType, AnimationType } from '../types';

// Owner's exact repro numbers (docs/ws3-video-segments/ws3-audit.md): a
// ~10s clip trimmed into a ~3.4s segment (Case B, long clip) — max slip is
// sourceDuration - duration = 6.6.
const SOURCE_DURATION = 10;
const SEGMENT_DURATION = 3.4;
const MAX_SLIP_TRIM_START = SOURCE_DURATION - SEGMENT_DURATION; // 6.6

function makeSegment(): VideoSegment {
  return {
    id: 'seg-1',
    text: 'seg-1',
    order: 0,
    startTime: 0,
    duration: SEGMENT_DURATION,
    transition: TransitionType.NONE,
    animation: AnimationType.NONE,
    assetId: 'asset-1',
    trimStart: 0,
  };
}

// The clip length lives on the asset — the drawer resolves it through the
// segment's assetId, so a segment pointed at a different asset can never
// carry a stale length (see Asset.duration's doc).
function makeAsset(): Asset {
  return { id: 'asset-1', name: 'clip.mp4', url: 'blob:fake-clip', type: 'video', duration: SOURCE_DURATION };
}

const globalOverlayConfig: NonNullable<VideoSegment['overlayConfig']> = {
  color: '#ffffff',
  backgroundColor: 'transparent',
  fontFamily: 'sans-serif',
};

let container: HTMLDivElement | null = null;
let root: Root | null = null;

afterEach(() => {
  if (root) {
    act(() => { root!.unmount(); });
    root = null;
  }
  if (container) {
    container.remove();
    container = null;
  }
});

/** Stubs the track element's layout (jsdom has no layout engine — see
 *  dragSessionHarness.ts's identical rationale) as a 0-400px track, so a
 *  clientX of 0 maps to ratio 0 (trimStart 0) and 400 maps to ratio 1
 *  (trimStart sourceDuration), matching the "drag toward the right/end"
 *  repro. */
function stubTrackRect(el: Element): void {
  (el as HTMLElement).getBoundingClientRect = () =>
    ({ left: 0, right: 400, width: 400, top: 0, bottom: 24, height: 24, x: 0, y: 0, toJSON: () => {} }) as DOMRect;
}

describe('BottomDrawer Clip Trim drag — commits once per gesture, not once per pointermove', () => {
  it('dragging the fill toward the right/end calls onUpdateSegment exactly once, at release, clamped to max slip', () => {
    container = document.createElement('div');
    document.body.appendChild(container);
    const onUpdateSegment = vi.fn();

    act(() => {
      root = createRoot(container!);
      root.render(
        <BottomDrawer
          segment={makeSegment()}
          segmentIndex={0}
          assets={[makeAsset()]}
          globalOverlayConfig={globalOverlayConfig}
          onClose={() => {}}
          onUpdateSegment={onUpdateSegment}
          onUpdateSegmentOverlay={() => {}}
          onOpenStockSearch={() => {}}
          onToggleLock={() => {}}
        />,
      );
    });

    const track = container.querySelector('[data-testid="clip-trim-track"]');
    const fill = container.querySelector('[data-testid="clip-trim-fill"]');
    expect(track).toBeTruthy();
    expect(fill).toBeTruthy();
    stubTrackRect(track!);

    act(() => {
      fill!.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: 0 }));
    });

    // Five pointermove ticks marching toward the clip's end — mirrors a real
    // drag gesture's event volume far better than a single jump would, and
    // is exactly the volume that used to produce 5 separate project commits.
    const moveTargets = [80, 160, 240, 320, 400];
    for (const clientX of moveTargets) {
      act(() => {
        window.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX }));
      });
    }

    // The defect's actual trigger: NO commit may happen before release.
    expect(onUpdateSegment).not.toHaveBeenCalled();

    act(() => {
      window.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, clientX: 400 }));
    });

    expect(onUpdateSegment).toHaveBeenCalledTimes(1);
    const [calledIdx, updates] = onUpdateSegment.mock.calls[0]!;
    expect(calledIdx).toBe(0);
    expect(updates.trimStart).toBeCloseTo(MAX_SLIP_TRIM_START, 5);
    expect(updates.trimEnd).toBeCloseTo(SOURCE_DURATION, 5);
    // The invariant the whole freeze/trimmed-window mechanism depends on
    // (docs/ws3-video-segments/ws3-audit.md's "trim invariant now enforced"):
    // never past the real clip end.
    expect(updates.trimStart + SEGMENT_DURATION).toBeLessThanOrEqual(SOURCE_DURATION + 1e-9);
  });
});

describe('BottomDrawer Clip Trim drag — the clip length follows the asset, never a stale per-segment copy', () => {
  /** The defect this pins: the clip length used to be cached on the segment
   *  (`VideoSegment.sourceDuration`), written only by parseProjectData and
   *  refreshed by nothing. Reassigning a segment's asset — via this drawer's
   *  own asset dropdown, stock search, or autoMatchSegments — left the old
   *  clip's length behind. A stale-long value made max slip hand out a
   *  `trimStart` past the new clip's real media, and the WebCodecs preview
   *  then held a single frame for the whole segment (reproduced against the
   *  real VideoDecoderPool: 1 distinct frame across a 3.4s segment, no error
   *  and no null, so nothing surfaced it). The length now resolves from
   *  `Asset.duration` through the segment's current `assetId` on every read,
   *  which makes the stale state unrepresentable. */
  const SHORT_CLIP = 4;

  it('a segment pointed at a shorter asset slips against the SHORT clip, not the length its old asset had', () => {
    container = document.createElement('div');
    document.body.appendChild(container);
    const onUpdateSegment = vi.fn();

    // The same segment as the test above — deliberately unchanged — but its
    // assetId now resolves to a 4s clip instead of a 10s one. Under the old
    // cached field the segment would still have claimed 10s here.
    act(() => {
      root = createRoot(container!);
      root.render(
        <BottomDrawer
          segment={makeSegment()}
          segmentIndex={0}
          assets={[{ ...makeAsset(), duration: SHORT_CLIP }]}
          globalOverlayConfig={globalOverlayConfig}
          onClose={() => {}}
          onUpdateSegment={onUpdateSegment}
          onUpdateSegmentOverlay={() => {}}
          onOpenStockSearch={() => {}}
          onToggleLock={() => {}}
        />,
      );
    });

    const track = container.querySelector('[data-testid="clip-trim-track"]');
    const fill = container.querySelector('[data-testid="clip-trim-fill"]');
    expect(track).toBeTruthy();
    stubTrackRect(track!);

    act(() => {
      fill!.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: 0 }));
    });
    for (const clientX of [100, 200, 300, 400]) {
      act(() => {
        window.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX }));
      });
    }
    act(() => {
      window.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, clientX: 400 }));
    });

    expect(onUpdateSegment).toHaveBeenCalledTimes(1);
    const [, updates] = onUpdateSegment.mock.calls[0]!;
    // Max slip against the REAL clip: 4 - 3.4 = 0.6, not 10 - 3.4 = 6.6.
    expect(updates.trimStart).toBeCloseTo(SHORT_CLIP - SEGMENT_DURATION, 5);
    expect(updates.trimEnd).toBeCloseTo(SHORT_CLIP, 5);
    // The invariant the freeze/trimmed-window mechanism depends on: the
    // committed window never runs past the media that actually exists.
    expect(updates.trimStart + SEGMENT_DURATION).toBeLessThanOrEqual(SHORT_CLIP + 1e-9);
  });

  it('an asset with no probed duration hides the trim bar rather than guessing a length', () => {
    container = document.createElement('div');
    document.body.appendChild(container);

    act(() => {
      root = createRoot(container!);
      root.render(
        <BottomDrawer
          segment={makeSegment()}
          segmentIndex={0}
          assets={[{ ...makeAsset(), duration: undefined }]}
          globalOverlayConfig={globalOverlayConfig}
          onClose={() => {}}
          onUpdateSegment={() => {}}
          onUpdateSegmentOverlay={() => {}}
          onOpenStockSearch={() => {}}
          onToggleLock={() => {}}
        />,
      );
    });

    expect(container.querySelector('[data-testid="clip-trim-track"]')).toBeNull();
  });
});
