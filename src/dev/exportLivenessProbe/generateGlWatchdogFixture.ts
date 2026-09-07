/**
 * THROWAWAY — Round 2 GL-watchdog fixture. Not imported by any production file.
 *
 * Minimum change that moves a plain image/video segment from Tier 1 to GL:
 * set `showOverlay: true` with non-empty `text`. That fails
 * `plainSegment.ts:91-103` (caption / extraOverlays / global text layers)
 * while `glCompositable.ts:41-44` deliberately does NOT check text, so the
 * segment stays GL-expressible.
 */

import { putAsset } from '../../services/assetStore';
import { saveProject, setLastOpenedProjectId } from '../../services/projectStore';
import { AnimationType, TransitionType, type Asset, type Project, type VideoSegment } from '../../types';
import { planWebCodecsExport, type WebCodecsRoutingSummary } from '../../services/webcodecsExport/exportPipelineWebCodecs';

export const FIXTURE_SEGMENT_COUNT = 263;
export const FIXTURE_SEG_DURATION_SEC = 0.4;
export const FIXTURE_FPS = 30;

const VIDEO_SPECS = [
  { path: '/_spike/local-smallest.mp4', name: 'local-smallest.mp4', duration: 1.28 },
  { path: '/_spike/local-mid-a.mp4', name: 'local-mid-a.mp4', duration: 10.01 },
  { path: '/_spike/sample.mp4', name: 'sample.mp4', duration: 10.4 },
  { path: '/_spike/local-largest.mp4', name: 'local-largest.mp4', duration: 5.0 },
] as const;

export interface GlWatchdogFixtureResult {
  project: Project;
  segmentCount: number;
  uniqueVideoAssets: number;
  timelineDurationSec: number;
  predicted: WebCodecsRoutingSummary;
  glForcingField: string;
}

async function fetchBlob(path: string): Promise<Blob> {
  const resp = await fetch(path);
  if (!resp.ok) throw new Error(`generateGlWatchdogFixture: fetch ${path} failed (${resp.status})`);
  return resp.blob();
}

function makeSilentWav(durationSec: number, sampleRate = 44100): Blob {
  const frames = Math.max(1, Math.round(durationSec * sampleRate));
  const dataBytes = frames * 2; // mono s16
  const buffer = new ArrayBuffer(44 + dataBytes);
  const view = new DataView(buffer);
  const writeStr = (offset: number, s: string): void => {
    for (let i = 0; i < s.length; i++) view.setUint8(offset + i, s.charCodeAt(i));
  };
  writeStr(0, 'RIFF');
  view.setUint32(4, 36 + dataBytes, true);
  writeStr(8, 'WAVE');
  writeStr(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeStr(36, 'data');
  view.setUint32(40, dataBytes, true);
  return new Blob([buffer], { type: 'audio/wav' });
}

export async function generateGlWatchdogFixture(): Promise<GlWatchdogFixtureResult> {
  const projectId = crypto.randomUUID();
  const assets: Asset[] = [];

  for (const spec of VIDEO_SPECS) {
    const blob = await fetchBlob(spec.path);
    const assetId = crypto.randomUUID();
    await putAsset(projectId, assetId, blob, { name: spec.name, mimeType: blob.type || 'video/mp4' });
    assets.push({
      id: assetId,
      name: spec.name,
      url: URL.createObjectURL(blob),
      type: 'video',
      addedAt: Date.now(),
      duration: spec.duration,
    });
  }

  const framesPerSeg = Math.max(1, Math.round(FIXTURE_SEG_DURATION_SEC * FIXTURE_FPS));
  const segDur = framesPerSeg / FIXTURE_FPS;
  const timelineDurationSec = FIXTURE_SEGMENT_COUNT * segDur;
  const voBlob = makeSilentWav(timelineDurationSec);
  const voiceoverId = crypto.randomUUID();
  await putAsset(projectId, voiceoverId, voBlob, { name: 'voiceover.wav', mimeType: 'audio/wav' });
  assets.push({
    id: voiceoverId,
    name: 'voiceover.wav',
    url: URL.createObjectURL(voBlob),
    type: 'audio',
    addedAt: Date.now(),
  });

  const segments: VideoSegment[] = [];
  for (let i = 0; i < FIXTURE_SEGMENT_COUNT; i++) {
    const video = assets[i % VIDEO_SPECS.length]!;
    segments.push({
      id: crypto.randomUUID(),
      text: `Caption ${i + 1}`,
      assetId: video.id,
      startTime: (i * framesPerSeg) / FIXTURE_FPS,
      duration: segDur,
      transition: TransitionType.NONE,
      animation: AnimationType.NONE,
      order: i,
      showOverlay: true,
      trimStart: 0,
      trimEnd: Math.min(segDur, video.duration ?? segDur),
    });
  }

  const project: Project = {
    id: projectId,
    name: `WS3 GL watchdog fixture (${FIXTURE_SEGMENT_COUNT} segments)`,
    script: '',
    sceneDetails: '',
    segments,
    assets,
    voiceoverId,
    globalTransition: TransitionType.NONE,
    globalTransitionDuration: 0.5,
    globalAnimation: AnimationType.NONE,
    globalOverlayConfig: { color: '#ffffff', backgroundColor: '#000000', fontFamily: 'Inter' },
    confirmed: true,
    aspectRatio: '16:9',
    resolutionTier: '1080p',
  };

  await saveProject(project);
  setLastOpenedProjectId(projectId);

  const predicted = planWebCodecsExport(project, FIXTURE_FPS);
  if ('error' in predicted) throw new Error(predicted.error.message);

  return {
    project,
    segmentCount: segments.length,
    uniqueVideoAssets: VIDEO_SPECS.length,
    timelineDurationSec,
    predicted,
    glForcingField: 'showOverlay=true with non-empty text (plainSegment.ts:91-92; glCompositable.ts:41-44)',
  };
}
