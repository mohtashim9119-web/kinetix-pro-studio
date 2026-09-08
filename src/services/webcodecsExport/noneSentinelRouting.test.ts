/**
 * Effects-tab `'none'` vs unset: a zero-effects project must take Tier 1,
 * not GL. The field shape is 332 captions-off video segments with the
 * literal `overlayFilter: 'none'` `handleApplyEffect` writes, plus
 * `globalOverlayFilter: 'none'` from the legacy filter dropdown.
 *
 * Before `isEffectUnset`, `plainSegment.ts` treated that string as SET and
 * `computeIndividualTier` fell through to GL. After, every segment is
 * `'plain'`.
 */
import { describe, it, expect } from 'vitest';
import { AnimationType, TransitionType, type Asset, type Project, type VideoSegment } from '../../types';
import { planWebCodecsExport } from './exportPipelineWebCodecs';

const FIELD_SEGMENTS = 332;
const VIDEO: Asset = { id: 'v1', name: 'clip.mp4', url: 'blob:v1', type: 'video' };

function makeSegment(
  i: number,
  extra: Partial<VideoSegment> = {},
): VideoSegment {
  return {
    id: `s${i}`,
    text: '',
    startTime: i * 3,
    duration: 3,
    transition: TransitionType.NONE,
    animation: AnimationType.NONE,
    order: i,
    assetId: 'v1',
    showOverlay: false,
    ...extra,
  };
}

function makeProject(segments: VideoSegment[], extra: Partial<Project> = {}): Project {
  return {
    id: 'p',
    name: 'zero-effects',
    script: '',
    sceneDetails: '',
    segments,
    assets: [VIDEO],
    globalTransition: TransitionType.NONE,
    globalTransitionDuration: 0,
    globalAnimation: AnimationType.NONE,
    globalOverlayConfig: { color: '#fff', backgroundColor: '#000', fontFamily: 'Inter' },
    ...extra,
  };
}

describe('zero-effects routing — Effects-tab "none" sentinel', () => {
  it('a 332-segment captions-off project with overlayFilter/globalOverlayFilter "none" routes to Tier 1', () => {
    const segments = Array.from({ length: FIELD_SEGMENTS }, (_, i) =>
      makeSegment(i, { overlayFilter: 'none' }),
    );
    const project = makeProject(segments, { globalOverlayFilter: 'none' });
    const plan = planWebCodecsExport(project, 30);
    expect('error' in plan).toBe(false);
    if ('error' in plan) return;
    expect(plan.segmentCounts).toEqual({ plain: FIELD_SEGMENTS, gl: 0, canvas: 0 });
    expect(plan.pieceCounts).toEqual({ plain: FIELD_SEGMENTS, gl: 0, canvas: 0 });
  });

  it('"none" and null overlayFilter produce identical Tier-1 routing', () => {
    const noneSegs = [makeSegment(0, { overlayFilter: 'none' })];
    const nullSegs = [makeSegment(0, { overlayFilter: null as unknown as string })];
    const nonePlan = planWebCodecsExport(makeProject(noneSegs, { globalOverlayFilter: 'none' }), 30);
    const nullPlan = planWebCodecsExport(makeProject(nullSegs, { globalOverlayFilter: null as unknown as string }), 30);
    expect('error' in nonePlan).toBe(false);
    expect('error' in nullPlan).toBe(false);
    if ('error' in nonePlan || 'error' in nullPlan) return;
    expect(nonePlan.segmentCounts).toEqual({ plain: 1, gl: 0, canvas: 0 });
    expect(nullPlan.segmentCounts).toEqual(nonePlan.segmentCounts);
    expect(nullPlan.pieceCounts).toEqual(nonePlan.pieceCounts);
  });

  it('a real GL animation still routes to GL, not Tier 1', () => {
    const segments = [makeSegment(0, { overlayFilter: 'none', effectAnimation: 'zoom-in' })];
    const project = makeProject(segments, { globalOverlayFilter: 'none' });
    const plan = planWebCodecsExport(project, 30);
    expect('error' in plan).toBe(false);
    if ('error' in plan) return;
    expect(plan.segmentCounts).toEqual({ plain: 0, gl: 1, canvas: 0 });
    expect(plan.pieceCounts).toEqual({ plain: 0, gl: 1, canvas: 0 });
  });
});
