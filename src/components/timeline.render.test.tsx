// §6.0 Timeline smoke tests (docs/sync-pipeline-contract-plan.md) — static-
// markup coverage for Timeline.tsx (freshly rebuilt 2026-07-31: absolute
// positioning, lane redesign, cross-lane boundary markers) and the segments-
// tab spacing convention in DropZonePanel.tsx. Same pattern as
// SyncLogPanel.test.tsx / SyncLoadingOverlay.test.tsx: renderToStaticMarkup,
// no DOM/testing-library dependency.
import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ComponentProps } from 'react';
import { Timeline } from './Timeline';
import { DropZonePanel } from './DropZonePanel';
import type { VideoSegment } from '../types';
import { TransitionType, AnimationType } from '../types';

function makeSeg(id: string, startTime: number, duration: number): VideoSegment {
  return {
    id,
    text: `seg-${id}`,
    order: 0,
    startTime,
    duration,
    transition: TransitionType.NONE,
    animation: AnimationType.NONE,
  };
}

type TimelineProps = ComponentProps<typeof Timeline>;

function makeTimelineProps(overrides: Partial<TimelineProps> = {}): TimelineProps {
  return {
    segments: [],
    assets: [],
    headings: [],
    currentSegmentId: undefined,
    currentTime: 0,
    isPlaying: false,
    isSynced: true,
    sliderT: 1,
    onPixelsPerSecondChange: () => {},
    globalPlaybackSpeed: 1,
    resizingId: null,
    resizingType: null,
    trimmingSegmentId: null,
    isAdjustingTrim: false,
    voiceoverName: undefined,
    waveformSource: null,
    onTogglePlay: () => {},
    onSeek: () => {},
    onResizeStart: () => {},
    onSegmentUpdate: () => {},
    onOpenStockSearch: () => {},
    onSetTrimmingSegment: () => {},
    onSetAdjustingTrim: () => {},
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Test 6 — N segments -> exactly N segment-card elements; representative
// segment's left/width match the 800px static-render fallback geometry.
// ---------------------------------------------------------------------------
describe('Timeline static markup — segment cards (Test 6)', () => {
  it('renders exactly N segment-card elements at the expected left/width', () => {
    // containerWidth is 0 in a static (non-hydrated) render — there is no real
    // DOM for the ResizeObserver to observe, so Timeline's zoom formula falls
    // back to its 800px default (`containerWidth || 800`, Timeline.tsx). This
    // test therefore pins THAT fallback geometry, not the ResizeObserver-
    // measured path a real mounted browser takes.
    //
    // sliderT=1 pins pixelsPerSecond to exactly ppsMax=100 regardless of the
    // fallback width's derived ppsMin, so the expected pixel values below are
    // exact, not approximate.
    const segments = [makeSeg('s1', 0, 5), makeSeg('s2', 5, 5)];
    const html = renderToStaticMarkup(
      <Timeline {...makeTimelineProps({ segments, sliderT: 1 })} />,
    );

    const segCardMatches = html.match(/data-seg-id="/g) ?? [];
    expect(segCardMatches.length).toBe(segments.length);

    expect(html).toContain('left:0px'); // segment 1: startTime 0 * 100
    expect(html).toContain('width:500px'); // segment 1: duration 5 * 100
    expect(html).toContain('left:500px'); // segment 2: startTime 5 * 100
  });
});

// ---------------------------------------------------------------------------
// Test 7 — isSynced=true -> segments.length-1 boundary markers;
// isSynced=false -> zero.
// ---------------------------------------------------------------------------
const BOUNDARY_MARKER_CLASS_FRAGMENT = 'w-px bg-[rgba(242,156,95,0.2)] z-40';

function countBoundaryMarkers(html: string): number {
  const escaped = BOUNDARY_MARKER_CLASS_FRAGMENT.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return (html.match(new RegExp(escaped, 'g')) ?? []).length;
}

describe('Timeline static markup — boundary markers (Test 7)', () => {
  const segments = [makeSeg('s1', 0, 5), makeSeg('s2', 5, 5), makeSeg('s3', 10, 5)];

  it('isSynced=true renders exactly segments.length-1 boundary markers', () => {
    const html = renderToStaticMarkup(
      <Timeline {...makeTimelineProps({ segments, isSynced: true })} />,
    );
    expect(countBoundaryMarkers(html)).toBe(segments.length - 1);
  });

  it('isSynced=false renders zero boundary markers', () => {
    const html = renderToStaticMarkup(
      <Timeline {...makeTimelineProps({ segments, isSynced: false })} />,
    );
    expect(countBoundaryMarkers(html)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Test 8b — a single segment renders zero boundary markers (no interior
// boundary to mark).
// ---------------------------------------------------------------------------
describe('Timeline static markup — single-segment edge case (Test 8b)', () => {
  it('a single segment renders zero boundary markers', () => {
    const html = renderToStaticMarkup(
      <Timeline {...makeTimelineProps({ segments: [makeSeg('s1', 0, 5)], isSynced: true })} />,
    );
    expect(countBoundaryMarkers(html)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Test 9 — DropZonePanel segments tab: the scroll container carries
// `gap-1.5`, and no row-wrapper className contains a per-row `mb-` (the
// abb642c margin-collapse fix — spacing must come from exactly one place,
// the container's own `gap`, per CLAUDE.md's DropZonePanel.tsx entry).
// ---------------------------------------------------------------------------
type DropZonePanelProps = ComponentProps<typeof DropZonePanel>;

function makeDropZonePanelProps(overrides: Partial<DropZonePanelProps> = {}): DropZonePanelProps {
  const noop = () => {};
  return {
    segments: [],
    headings: [],
    assets: [],
    voiceoverId: undefined,
    script: '',
    persistedScript: '',
    persistedScriptName: '',
    persistedScriptUpdatedAt: undefined,
    persistedSceneDetails: '',
    persistedSceneDetailsName: '',
    persistedSceneDetailsUpdatedAt: undefined,
    persistedVoiceoverName: '',
    persistedAssetCount: 0,
    isSynced: true,
    onClearScript: noop,
    onClearSceneDetails: noop,
    onDeleteAsset: noop,
    onDeleteAllAssets: noop,
    onDeleteVoiceover: noop,
    onApplySync: noop,
    onVoiceoverStaged: noop,
    onVoiceoverUnstaged: noop,
    applySyncDisabled: false,
    onSegmentClick: noop,
    onToggleLock: noop,
    onLockAll: noop,
    onUnlockAll: noop,
    allLocked: false,
    onOpenReviewMapping: noop,
    onInsertHeading: noop,
    selectedSegmentId: undefined,
    currentSegmentId: undefined,
    selectedSegmentIds: new Set(),
    onToggleSegmentSelect: noop,
    onSelectAllSegments: noop,
    onClearSegmentSelection: noop,
    onApplyEffect: noop,
    globalTransition: TransitionType.NONE,
    globalTransitionDuration: 0.5,
    globalAnimation: 'none',
    globalOverlayFilter: 'none',
    globalOverlayConfig: { color: '#fff', backgroundColor: '#000', fontFamily: 'Inter' },
    currentTransition: 'none',
    currentAnimation: 'none',
    currentOverlayFilter: 'none',
    currentOverlayConfig: { color: '#fff', backgroundColor: '#000', fontFamily: 'Inter' },
    onTransitionChange: noop,
    onTransitionDurationChange: noop,
    onApplyTransitionToAll: noop,
    onAnimationChange: noop,
    onApplyAnimationToAll: noop,
    onFilterChange: noop,
    onApplyFilterToAll: noop,
    onOverlayConfigChange: noop,
    onApplyTransitionPreset: noop,
    onApplyAnimationPreset: noop,
    onApplyOverlayFilterPreset: noop,
    onApplyOverlayConfigPreset: noop,
    onBackToProjects: noop,
    projectName: 'Test Project',
    onRename: noop,
    activeLeftTab: 'segments',
    onActiveLeftTabChange: noop,
    isPlaying: false,
    ...overrides,
  };
}

describe('DropZonePanel static markup — segments tab spacing (Test 9)', () => {
  it('the segment-list scroll container carries gap-1.5', () => {
    const segments = [makeSeg('s1', 0, 5), makeSeg('s2', 5, 5)];
    const html = renderToStaticMarkup(
      <DropZonePanel {...makeDropZonePanelProps({ segments })} />,
    );
    expect(html).toContain('id="segment-list-scroll"');
    // The scroll container's own class list must include gap-1.5 — the sole
    // source of inter-row spacing (CLAUDE.md's DropZonePanel.tsx entry).
    const scrollContainerMatch = html.match(/id="segment-list-scroll" class="([^"]*)"/);
    expect(scrollContainerMatch).not.toBeNull();
    expect(scrollContainerMatch![1]).toContain('gap-1.5');
  });

  it('no row-wrapper className contains a per-row mb- margin', () => {
    const segments = [makeSeg('s1', 0, 5), makeSeg('s2', 5, 5)];
    const html = renderToStaticMarkup(
      <DropZonePanel {...makeDropZonePanelProps({ segments })} />,
    );
    // Row wrappers are uniquely identified by their `relative group/gap
    // flex-shrink-0` className (both heading and segment rows share it) —
    // distinct from the unrelated `-mb-1.5` gap-affordance element nested
    // inside each row (a deliberate, documented negative margin used purely
    // to size the hover-reveal "+ heading" button, not row-to-row spacing).
    const rowWrapperMatches = [...html.matchAll(/class="(relative group\/gap[^"]*)"/g)];
    expect(rowWrapperMatches.length).toBe(segments.length);
    for (const m of rowWrapperMatches) {
      expect(m[1]).not.toMatch(/\bmb-/);
    }
  });
});

// ---------------------------------------------------------------------------
// Manual WKWebView checklist STEP 4 guard, render level — the segment-card lane
// and the waveform lane must place the SAME segment at the SAME pixels.
//
// SCOPE, MEASURED BY MUTATION — do not over-read these two tests:
//
//   CAUGHT: either lane switching to a different layout formula or different
//   segment fields. Verified by giving the waveform lane a cumulative-flow
//   `left` (+3px); both tests fail, naming the 3px.
//
//   NOT CAUGHT: either lane deriving its OWN `pixelsPerSecond`. Verified by
//   replacing the waveform lane's shared `pixelsPerSecond` with its own
//   `computeZoomPixelsPerSecond(totalDuration, containerWidth, sliderT)` call —
//   both tests still passed. They structurally cannot catch it: in a static
//   render `containerWidth` is 0 (no ResizeObserver), and `zoomBasisDuration`
//   is seeded from `totalDuration`, so on a first render every possible
//   derivation collapses to the same number. The divergence only appears after
//   a drag mutates state, which `renderToStaticMarkup` cannot reach.
//
// The uncaught half is covered elsewhere and deliberately not duplicated here:
// `dragTriage.test.ts`'s F2 block pins frozen-vs-rebased zoom numerically
// (300px -> 259.0909px), and `timelineLayout.test.ts`'s companion block proves
// two independently-derived zooms make the layers' pixel extents diverge.
//
// The waveform lane only renders when `voiceoverName` is set, which is why the
// other tests in this file (voiceoverName: undefined) see one element per
// segment and this one sees two.
// ---------------------------------------------------------------------------
interface RenderedCell { left: number; width: number }

function cellsBySegId(html: string): Map<string, RenderedCell[]> {
  const byId = new Map<string, RenderedCell[]>();
  for (const m of html.matchAll(/data-seg-id="([^"]+)"\s+style="([^"]*)"/g)) {
    const [, id, style] = m;
    const left = style!.match(/left:(-?[\d.]+)px/);
    const width = style!.match(/width:(-?[\d.]+)px/);
    if (!left || !width) continue;
    const bucket = byId.get(id!) ?? [];
    bucket.push({ left: parseFloat(left[1]!), width: parseFloat(width[1]!) });
    byId.set(id!, bucket);
  }
  return byId;
}

describe('Timeline static markup — card lane and waveform lane agree (checklist step 4 guard)', () => {
  const segments = [makeSeg('s1', 0, 5), makeSeg('s2', 5, 3), makeSeg('s3', 8, 7)];

  it('renders each segment in BOTH lanes at identical left/width', () => {
    const html = renderToStaticMarkup(
      <Timeline {...makeTimelineProps({ segments, sliderT: 1, voiceoverName: 'vo.mp3' })} />,
    );
    const byId = cellsBySegId(html);

    for (const s of segments) {
      const cells = byId.get(s.id);
      // One thumbnail-lane cell + one waveform-lane cell. Both carry
      // data-seg-id because App's resize drag writes live geometry to both
      // (Timeline.tsx's K16 note) — if they disagree, the drag visibly tears.
      expect(cells, `segment ${s.id} should render in both lanes`).toHaveLength(2);
      expect(cells![0]!.left).toBeCloseTo(cells![1]!.left, 6);
      expect(cells![0]!.width).toBeCloseTo(cells![1]!.width, 6);
      // sliderT=1 pins pixelsPerSecond to ppsMax=100, so these are exact.
      expect(cells![0]!.left).toBeCloseTo(s.startTime * 100, 6);
      expect(cells![0]!.width).toBeCloseTo(s.duration * 100, 6);
    }
  });

  it('the waveform lane container spans exactly the card lane extent', () => {
    const html = renderToStaticMarkup(
      <Timeline {...makeTimelineProps({ segments, sliderT: 1, voiceoverName: 'vo.mp3' })} />,
    );
    const byId = cellsBySegId(html);
    const cardExtent = [...byId.values()]
      .flat()
      .reduce((max, c) => Math.max(max, c.left + c.width), 0);
    expect(cardExtent).toBeCloseTo(15 * 100, 6); // totalDuration 15s at 100 px/s

    // The lane's own container is sized `totalDuration * pixelsPerSecond`. It
    // must equal the card extent — a mismatch is the two layers having derived
    // pixels-per-second (or total duration) independently.
    expect(html).toContain(`width:${cardExtent}px`);
  });
});
