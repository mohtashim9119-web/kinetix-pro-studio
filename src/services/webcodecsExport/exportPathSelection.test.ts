/**
 * PROMPT 28 STEP 2 (CRITICAL) — red-then-green for the grade-loss refusal.
 *
 * "Red": before this round, a project carrying a non-neutral `effectGrade`
 * that lands on the canvas/legacy path exports successfully with the grade
 * silently dropped (`frameRenderer.ts`/`segmentEncoder.ts` have no grade
 * renderer — confirmed by grep, zero references outside the GL stack). This
 * file exercises `evaluateGradeLossRefusal` directly, which is the function
 * `useExport.ts` calls before starting any encode; a project that FAILS
 * these assertions is a project this refusal would let back into the old
 * silent-drop behavior.
 */
import { describe, it, expect } from 'vitest';
import { TransitionType, AnimationType } from '../../types';
import type { VideoSegment, Project, Asset, SegmentGrade } from '../../types';
import { evaluateGradeLossRefusal, isNeutralGrade, nonNeutralGradeSegmentIndices } from './exportPathSelection';
import type { WebCodecsRoutingSummary } from './exportPipelineWebCodecs';

const VIDEO_ASSET: Asset = { id: 'v1', name: 'clip.mp4', url: 'blob:v1', type: 'video' };
const NON_NEUTRAL_GRADE: SegmentGrade = { brightness: 0.5, contrast: -0.3, saturation: 0.2, temperature: 0.1 };
const NEUTRAL_GRADE: SegmentGrade = { brightness: 0, contrast: 0, saturation: 0, temperature: 0 };

function makeSegment(partial: Partial<VideoSegment> & { id: string }): VideoSegment {
  return {
    text: '',
    startTime: 0,
    duration: 3,
    transition: TransitionType.NONE,
    animation: AnimationType.NONE,
    order: 0,
    assetId: 'v1',
    ...partial,
  };
}

function makeProject(segments: VideoSegment[]): Project {
  return {
    id: 'p1',
    name: 'Test',
    script: '',
    sceneDetails: '',
    segments,
    assets: [VIDEO_ASSET],
    globalTransition: TransitionType.NONE,
    globalTransitionDuration: 0.5,
    globalAnimation: AnimationType.NONE,
    globalOverlayConfig: { color: '#fff', backgroundColor: '#000', fontFamily: 'sans-serif' },
  };
}

/** A routing summary whose piece boundaries match `segments` 1:1 — segment i
 *  lands on `tiers[i]`. */
function makeRouting(tiers: ReadonlyArray<'plain' | 'gl' | 'canvas'>): WebCodecsRoutingSummary {
  const counts = { plain: 0, gl: 0, canvas: 0 };
  for (const t of tiers) counts[t]++;
  return {
    pieces: tiers.map((tier, i) => ({
      tier,
      startIndex: i,
      segmentCount: 1,
      expectedFrames: 90,
      gridOriginSec: i * 3,
      gridBaseFrame: i * 90,
    })),
    segmentCounts: counts,
    pieceCounts: counts,
  };
}

describe('isNeutralGrade', () => {
  it('undefined is neutral', () => {
    expect(isNeutralGrade(undefined)).toBe(true);
  });
  it('all-zero is neutral', () => {
    expect(isNeutralGrade(NEUTRAL_GRADE)).toBe(true);
  });
  it('any non-zero channel is non-neutral', () => {
    expect(isNeutralGrade({ brightness: 0.01, contrast: 0, saturation: 0, temperature: 0 })).toBe(false);
    expect(isNeutralGrade({ brightness: 0, contrast: 0, saturation: 0, temperature: -0.01 })).toBe(false);
  });
});

describe('nonNeutralGradeSegmentIndices', () => {
  it('finds only the graded segments, by index', () => {
    const project = makeProject([
      makeSegment({ id: 's0' }),
      makeSegment({ id: 's1', effectGrade: NON_NEUTRAL_GRADE }),
      makeSegment({ id: 's2', effectGrade: NEUTRAL_GRADE }),
    ]);
    expect(nonNeutralGradeSegmentIndices(project)).toEqual([1]);
  });
});

describe('evaluateGradeLossRefusal — top-level gate closed (legacy path)', () => {
  it('RED-then-GREEN: refuses when ANY segment carries a non-neutral grade, since legacy has no grade renderer at all', () => {
    const project = makeProject([
      makeSegment({ id: 's0' }),
      makeSegment({ id: 's1', effectGrade: NON_NEUTRAL_GRADE }),
    ]);
    const refusal = evaluateGradeLossRefusal(project, {
      gateOpen: false,
      capabilityFailures: ['no-webgl2'],
      routing: null,
    });
    expect(refusal).not.toBeNull();
    expect(refusal?.affectedSegmentIndices).toEqual([1]);
    expect(refusal?.failedGateClauses).toEqual(['no-webgl2']);
    expect(refusal?.remediation.length).toBeGreaterThan(0);
  });

  it('no refusal when every segment is neutral-graded', () => {
    const project = makeProject([makeSegment({ id: 's0' }), makeSegment({ id: 's1', effectGrade: NEUTRAL_GRADE })]);
    expect(evaluateGradeLossRefusal(project, { gateOpen: false, capabilityFailures: ['no-webgl2'], routing: null })).toBeNull();
  });
});

describe('evaluateGradeLossRefusal — top-level gate open (WebCodecs path)', () => {
  it('refuses only for a graded segment whose tier resolved to canvas', () => {
    const project = makeProject([
      makeSegment({ id: 's0', effectGrade: NON_NEUTRAL_GRADE }), // gl tier — renders fine
      makeSegment({ id: 's1', effectGrade: NON_NEUTRAL_GRADE }), // canvas tier — loses grade
    ]);
    const routing = makeRouting(['gl', 'canvas']);
    const refusal = evaluateGradeLossRefusal(project, { gateOpen: true, capabilityFailures: [], routing });
    expect(refusal?.affectedSegmentIndices).toEqual([1]);
    expect(refusal?.failedGateClauses).toBeNull();
  });

  it('no refusal when every graded segment resolved to the GL tier', () => {
    const project = makeProject([makeSegment({ id: 's0', effectGrade: NON_NEUTRAL_GRADE })]);
    const routing = makeRouting(['gl']);
    expect(evaluateGradeLossRefusal(project, { gateOpen: true, capabilityFailures: [], routing })).toBeNull();
  });

  it('no refusal for a canvas-tier segment with no grade — canvas renders every non-grade feature correctly (parity matrix)', () => {
    const project = makeProject([makeSegment({ id: 's0' })]);
    const routing = makeRouting(['canvas']);
    expect(evaluateGradeLossRefusal(project, { gateOpen: true, capabilityFailures: [], routing })).toBeNull();
  });
});
