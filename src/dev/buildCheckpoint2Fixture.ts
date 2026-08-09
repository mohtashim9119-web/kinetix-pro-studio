/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Checkpoint 2 (Phase 7+8 regression pass, part A) manual-verification fixtures
 * (docs/webcodecs-architecture-plan.md). Throwaway dev tool, not imported by any
 * real app file — same convention as buildScaleFixture.ts / buildPhase5Fixture.ts.
 *
 * Two small, targeted fixtures for re-verifying Phase 1+2/3/4+6 behaviors now
 * that the WebCodecs path is the real capability-gated default (no dev toggle):
 *
 *   const { buildSingleSegmentFixture } = await import('/src/dev/buildCheckpoint2Fixture.ts');
 *   await buildSingleSegmentFixture();
 *   location.reload();
 *
 *   const { buildBoundaryFixture } = await import('/src/dev/buildCheckpoint2Fixture.ts');
 *   await buildBoundaryFixture();
 *   location.reload();
 */

import { putAsset } from '../services/assetStore';
import { saveProject, setLastOpenedProjectId } from '../services/projectStore';
import { AnimationType, TransitionType, type Asset, type Project, type VideoSegment } from '../types';

const SAMPLE_URL = '/_spike/sample.mp4';
const SAMPLE_DURATION_SEC = 10.4;

async function loadSampleAsset(): Promise<{ projectId: string; asset: Asset }> {
  const resp = await fetch(SAMPLE_URL);
  if (!resp.ok) throw new Error(`could not fetch ${SAMPLE_URL} (${resp.status})`);
  const blob = await resp.blob();

  const projectId = crypto.randomUUID();
  const assetId = crypto.randomUUID();
  await putAsset(projectId, assetId, blob, { name: 'sample.mp4', mimeType: blob.type || 'video/mp4' });

  const asset: Asset = {
    id: assetId,
    name: 'sample.mp4',
    url: URL.createObjectURL(blob),
    type: 'video',
    addedAt: Date.now(),
    duration: SAMPLE_DURATION_SEC,
  };
  return { projectId, asset };
}

/** Phase 1+2 baseline: a single video segment, full source duration, no transition/animation. */
export async function buildSingleSegmentFixture(): Promise<{ projectId: string }> {
  const { projectId, asset } = await loadSampleAsset();

  const segments: VideoSegment[] = [
    {
      id: crypto.randomUUID(),
      text: '',
      assetId: asset.id,
      startTime: 0,
      duration: SAMPLE_DURATION_SEC,
      transition: TransitionType.NONE,
      animation: AnimationType.NONE,
      order: 0,
      trimStart: 0,
      trimEnd: SAMPLE_DURATION_SEC,
    },
  ];

  const project: Project = {
    id: projectId,
    name: 'Checkpoint 2 — single segment',
    script: '',
    sceneDetails: '',
    segments,
    assets: [asset],
    globalTransition: TransitionType.NONE,
    globalTransitionDuration: 0.5,
    globalAnimation: AnimationType.NONE,
    globalOverlayConfig: { color: '#ffffff', backgroundColor: '#000000', fontFamily: 'Inter' },
    confirmed: true,
  };

  saveProject(project);
  setLastOpenedProjectId(projectId);
  return { projectId };
}

/**
 * Multi-segment + short-segment boundary-crossing fixture: 2s, 2s, then the
 * exact 1.1s/1.2s/1.3s short-segment range that originally surfaced the
 * Phase 3 latency defect, then a final 2s segment. Total ~9.6s, loops for
 * repeated-full-playthrough / flush-strategy testing.
 */
export async function buildBoundaryFixture(): Promise<{ projectId: string }> {
  const { projectId, asset } = await loadSampleAsset();

  const durations = [2, 2, 1.1, 1.2, 1.3, 2];
  let t = 0;
  const segments: VideoSegment[] = durations.map((dur, i) => {
    const seg: VideoSegment = {
      id: crypto.randomUUID(),
      text: `Segment ${i + 1}`,
      assetId: asset.id,
      startTime: t,
      duration: dur,
      transition: TransitionType.NONE,
      animation: AnimationType.NONE,
      order: i,
      trimStart: 0,
      trimEnd: dur,
    };
    t += dur;
    return seg;
  });

  const project: Project = {
    id: projectId,
    name: 'Checkpoint 2 — boundary/short-segment fixture',
    script: '',
    sceneDetails: '',
    segments,
    assets: [asset],
    globalTransition: TransitionType.NONE,
    globalTransitionDuration: 0.5,
    globalAnimation: AnimationType.NONE,
    globalOverlayConfig: { color: '#ffffff', backgroundColor: '#000000', fontFamily: 'Inter' },
    confirmed: true,
  };

  saveProject(project);
  setLastOpenedProjectId(projectId);
  return { projectId };
}
