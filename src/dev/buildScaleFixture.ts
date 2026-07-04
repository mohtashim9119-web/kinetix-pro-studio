/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Phase 4+6 (docs/webcodecs-architecture-plan.md) + reusable for Phase 8:
 * builds a synthetic large-N-segment project to exercise the WebCodecs
 * preview path's windowed decode-ahead + LRU eviction at 500+ segment
 * scale, and for manual scrub-stress verification.
 *
 * Scope note (mirrors Phase 3's identical limitation): this repo has no
 * long/varied real video asset available in this environment — the only
 * one is the Phase 0 spike's `public/_spike/sample.mp4` (10.4s, H.264,
 * 1280x720, ~29.97fps, real B-frame GOP structure, fetched from Pexels).
 * This fixture repeats/reuses that single asset across every segment,
 * cycling through different [trimStart, trimEnd] windows of it so segments
 * are not all identical (real decode work per segment, real keyframe
 * variety), sharing one Asset entry — which is itself a real, common
 * project shape (one long uploaded video split into many segments) and
 * exactly what Section 4.2's decoder-reuse-by-asset-id targets.
 *
 * This file is a throwaway dev tool, not imported by any real app file —
 * same convention as Phase 0's src/dev/webcodecsSpike/main.ts. Invoke from
 * the browser devtools console against the running dev server:
 *
 *   const { buildScaleFixture } = await import('/src/dev/buildScaleFixture.ts');
 *   await buildScaleFixture(500);
 *   location.reload();
 *
 * After reload, the fixture project is the last-opened one and loads
 * directly. Toggle the WebCodecs dev flag on (floating button, bottom of
 * the preview stage) to exercise the new path against it.
 */

import { putAsset } from '../services/assetStore';
import { saveProject, setLastOpenedProjectId } from '../services/projectStore';
import { AnimationType, TransitionType, type Asset, type Project, type VideoSegment } from '../types';

const SAMPLE_URL = '/_spike/sample.mp4';
/** Matches the Phase 0 spike's measured duration for public/_spike/sample.mp4. */
const SAMPLE_DURATION_SEC = 10.4;

export interface ScaleFixtureResult {
  projectId: string;
  segmentCount: number;
  totalTimelineDurationSec: number;
}

/**
 * Builds and persists a `segmentCount`-segment project, all segments
 * referencing one shared video asset (public/_spike/sample.mp4) with
 * staggered trim windows, and sets it as the last-opened project so a
 * reload opens it directly.
 */
export async function buildScaleFixture(segmentCount = 500): Promise<ScaleFixtureResult> {
  const resp = await fetch(SAMPLE_URL);
  if (!resp.ok) {
    throw new Error(
      `buildScaleFixture: could not fetch ${SAMPLE_URL} (${resp.status}) — ` +
        're-provision it per the Phase 0 spike (fetched live from the Pexels video API; gitignored, not checked in).',
    );
  }
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
  };

  // Each segment is a short (~0.6s) on-timeline slice, trimmed from a
  // different rotating window of the shared 10.4s source — cycles through
  // ~17 distinct trim windows (10.4s / 0.6s) so keyframe/content variety is
  // real, not a single repeated frame.
  const SEGMENT_TIMELINE_DURATION_SEC = 0.6;
  const SEGMENT_TRIM_DURATION_SEC = 0.5; // < SAMPLE_DURATION_SEC, leaves decode margin
  const trimWindowCount = Math.max(1, Math.floor((SAMPLE_DURATION_SEC - SEGMENT_TRIM_DURATION_SEC) / 0.3));

  const segments: VideoSegment[] = [];
  for (let i = 0; i < segmentCount; i++) {
    const trimStart = (i % trimWindowCount) * 0.3;
    segments.push({
      id: crypto.randomUUID(),
      text: `Segment ${i + 1}`,
      assetId,
      startTime: i * SEGMENT_TIMELINE_DURATION_SEC,
      duration: SEGMENT_TIMELINE_DURATION_SEC,
      transition: TransitionType.NONE,
      animation: AnimationType.NONE,
      order: i,
      trimStart,
      trimEnd: trimStart + SEGMENT_TRIM_DURATION_SEC,
      sourceDuration: SAMPLE_DURATION_SEC,
    });
  }

  const project: Project = {
    id: projectId,
    name: `WebCodecs scale fixture (${segmentCount} segments)`,
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

  const totalTimelineDurationSec = segmentCount * SEGMENT_TIMELINE_DURATION_SEC;
  console.info(
    `[buildScaleFixture] Created project ${projectId} — ${segmentCount} segments, ` +
      `${totalTimelineDurationSec.toFixed(1)}s timeline, 1 shared asset. Reload to open it.`,
  );
  return { projectId, segmentCount, totalTimelineDurationSec };
}
