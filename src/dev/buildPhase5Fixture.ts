/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Phase 5 manual-verification fixture (docs/webcodecs-architecture-plan.md).
 * Throwaway dev tool, not imported by any real app file — same convention
 * as buildScaleFixture.ts / webcodecsSpike/main.ts. Builds a small project
 * whose segments exercise filters / animations / overlays / captions,
 * individually and combined, against the real sample.mp4 asset, for
 * side-by-side legacy-vs-WebCodecs manual comparison.
 *
 *   const { buildPhase5Fixture } = await import('/src/dev/buildPhase5Fixture.ts');
 *   await buildPhase5Fixture();
 *   location.reload();
 */

import { putAsset } from '../services/assetStore';
import { saveProject, setLastOpenedProjectId } from '../services/projectStore';
import { AnimationType, TransitionType, type Asset, type Project, type VideoSegment } from '../types';

const SAMPLE_URL = '/_spike/sample.mp4';
const SAMPLE_DURATION_SEC = 10.4;

export async function buildPhase5Fixture(): Promise<{ projectId: string }> {
  const resp = await fetch(SAMPLE_URL);
  if (!resp.ok) throw new Error(`buildPhase5Fixture: could not fetch ${SAMPLE_URL} (${resp.status})`);
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

  const SEG_DUR = 4;
  const overlay = (idx: number) => ({
    id: crypto.randomUUID(),
    text: `Extra overlay ${idx}`,
    color: '#ffffff',
    backgroundColor: 'rgba(0,0,0,0.5)',
    fontFamily: 'Inter',
    fontSize: 28,
    position: { x: 20, y: 20 },
  });

  const segments: VideoSegment[] = [
    // 1. Filter only (effectAnimation clip-effect slug, CSS ctx.filter equivalent)
    {
      id: crypto.randomUUID(),
      text: '',
      assetId,
      startTime: 0,
      duration: SEG_DUR,
      transition: TransitionType.NONE,
      animation: AnimationType.NONE,
      order: 0,
      trimStart: 0,
      trimEnd: SEG_DUR,
      effectAnimation: 'sepia',
    },
    // 2. True camera-dynamics animation only (legacy AnimationType enum)
    {
      id: crypto.randomUUID(),
      text: '',
      assetId,
      startTime: SEG_DUR,
      duration: SEG_DUR,
      transition: TransitionType.NONE,
      animation: AnimationType.BOUNCE,
      order: 1,
      trimStart: 0,
      trimEnd: SEG_DUR,
    },
    // 3. Ken Burns zoom (effectAnimation slug that IS a real AnimationType motion case)
    {
      id: crypto.randomUUID(),
      text: '',
      assetId,
      startTime: SEG_DUR * 2,
      duration: SEG_DUR,
      transition: TransitionType.NONE,
      animation: AnimationType.NONE,
      order: 2,
      trimStart: 0,
      trimEnd: SEG_DUR,
      effectAnimation: 'ken-burns',
    },
    // 4. Extra overlay + caption only, no filter/animation
    {
      id: crypto.randomUUID(),
      text: 'Caption text for segment four',
      assetId,
      startTime: SEG_DUR * 3,
      duration: SEG_DUR,
      transition: TransitionType.NONE,
      animation: AnimationType.NONE,
      order: 3,
      trimStart: 0,
      trimEnd: SEG_DUR,
      showOverlay: true,
      extraOverlays: [overlay(4)],
    },
    // 5. Combined: animation + filter (effectAnimation wins, filter only per
    //    existing legacy field-precedence — see PreviewStage.tsx) + overlay + caption
    {
      id: crypto.randomUUID(),
      text: 'Combined effects segment',
      assetId,
      startTime: SEG_DUR * 4,
      duration: SEG_DUR,
      transition: TransitionType.NONE,
      animation: AnimationType.WOBBLE,
      order: 4,
      trimStart: 0,
      trimEnd: SEG_DUR,
      showOverlay: true,
      extraOverlays: [overlay(5)],
    },
    // 6. Combined: filter (gaussian-blur) + overlay + caption, no true animation
    {
      id: crypto.randomUUID(),
      text: 'Filter plus overlay plus caption',
      assetId,
      startTime: SEG_DUR * 5,
      duration: SEG_DUR,
      transition: TransitionType.NONE,
      animation: AnimationType.NONE,
      order: 5,
      trimStart: 0,
      trimEnd: SEG_DUR,
      effectAnimation: 'gaussian-blur',
      showOverlay: true,
      extraOverlays: [overlay(6)],
    },
  ];

  const project: Project = {
    id: projectId,
    name: 'Phase 5 fixture',
    script: '',
    sceneDetails: '',
    segments,
    assets: [asset],
    globalTransition: TransitionType.NONE,
    globalTransitionDuration: 0.5,
    globalAnimation: AnimationType.NONE,
    globalOverlayConfig: { color: '#ffffff', backgroundColor: 'rgba(0,0,0,0.55)', fontFamily: 'Inter' },
    confirmed: true,
  };

  await saveProject(project);
  setLastOpenedProjectId(projectId);
  return { projectId };
}
