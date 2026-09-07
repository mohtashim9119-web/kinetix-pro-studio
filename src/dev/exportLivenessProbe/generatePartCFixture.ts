/**
 * THROWAWAY — Part C fixture: 500 segments / 200s timeline, a REAL GL
 * transition on every boundary (cycling the 4 UI-selectable slugs) and a
 * REAL GL animation on every segment (cycling the 2 UI-selectable zoom
 * slugs), a caption on every segment, 4 unique video assets, voiceover
 * attached. Not imported by any production file.
 *
 * Transition duration is deliberately small (0.2s, half-window 0.1s) relative
 * to the 0.4s segment duration so adjacent transition windows never overlap —
 * see the Part B analysis note on `resolveActiveBoundary`'s first-match-wins
 * iteration (compositeParams.ts:311-330) picking the wrong pair when a
 * transition's half-duration exceeds a neighboring segment's own duration.
 * That is a separate, already-flagged concern this fixture avoids rather than
 * exercises.
 */

import { putAsset } from '../../services/assetStore';
import { saveProject, setLastOpenedProjectId } from '../../services/projectStore';
import { AnimationType, TransitionType, type Asset, type Project, type VideoSegment } from '../../types';
import { planWebCodecsExport, type WebCodecsRoutingSummary } from '../../services/webcodecsExport/exportPipelineWebCodecs';
import { TRANSITIONS, ANIMATIONS_VISIBLE, TRANSITION_NONE, ANIMATION_NONE } from '../../effectsOptions';

export const PART_C_SEGMENT_COUNT = 500;
export const PART_C_SEG_DURATION_SEC = 0.4; // 500 * 0.4 = 200s timeline — matches the no-transition 200s-4assets baseline
export const PART_C_FPS = 30;
export const PART_C_TRANSITION_DURATION_SEC = 0.2;

const VIDEO_SPECS = [
  { path: '/_spike/local-smallest.mp4', name: 'local-smallest.mp4', duration: 1.28 },
  { path: '/_spike/local-mid-a.mp4', name: 'local-mid-a.mp4', duration: 10.01 },
  { path: '/_spike/sample.mp4', name: 'sample.mp4', duration: 10.4 },
  { path: '/_spike/local-largest.mp4', name: 'local-largest.mp4', duration: 5.0 },
] as const;

/** The 4 real UI-selectable transition slugs (TRANSITIONS minus the hard-cut sentinel). */
const TRANSITION_CYCLE = TRANSITIONS.map((t) => t.value).filter((v) => v !== TRANSITION_NONE);
/** The 2 real UI-selectable animation slugs (ANIMATIONS_VISIBLE minus 'none'). */
const ANIMATION_CYCLE = ANIMATIONS_VISIBLE.map((a) => a.value).filter((v) => v !== ANIMATION_NONE);

export interface PartCFixtureResult {
  project: Project;
  segmentCount: number;
  uniqueVideoAssets: number;
  timelineDurationSec: number;
  predicted: WebCodecsRoutingSummary;
  transitionCycle: string[];
  animationCycle: string[];
}

async function fetchBlob(path: string): Promise<Blob> {
  const resp = await fetch(path);
  if (!resp.ok) throw new Error(`generatePartCFixture: fetch ${path} failed (${resp.status})`);
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

export async function generatePartCFixture(): Promise<PartCFixtureResult> {
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

  const framesPerSeg = Math.max(1, Math.round(PART_C_SEG_DURATION_SEC * PART_C_FPS));
  const segDur = framesPerSeg / PART_C_FPS;
  const timelineDurationSec = PART_C_SEGMENT_COUNT * segDur;
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
  for (let i = 0; i < PART_C_SEGMENT_COUNT; i++) {
    const video = assets[i % VIDEO_SPECS.length]!;
    segments.push({
      id: crypto.randomUUID(),
      text: `Caption ${i + 1}`,
      assetId: video.id,
      startTime: (i * framesPerSeg) / PART_C_FPS,
      duration: segDur,
      transition: TransitionType.NONE,
      animation: AnimationType.NONE,
      order: i,
      showOverlay: true,
      trimStart: 0,
      trimEnd: Math.min(segDur, video.duration ?? segDur),
      effectTransition: TRANSITION_CYCLE[i % TRANSITION_CYCLE.length],
      effectTransitionDuration: PART_C_TRANSITION_DURATION_SEC,
      effectAnimation: ANIMATION_CYCLE[i % ANIMATION_CYCLE.length],
    });
  }

  const project: Project = {
    id: projectId,
    name: `WS3 Part C transitioned fixture (${PART_C_SEGMENT_COUNT} segments)`,
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

  const predicted = planWebCodecsExport(project, PART_C_FPS);
  if ('error' in predicted) throw new Error(predicted.error.message);

  return {
    project,
    segmentCount: segments.length,
    uniqueVideoAssets: VIDEO_SPECS.length,
    timelineDurationSec,
    predicted,
    transitionCycle: TRANSITION_CYCLE,
    animationCycle: ANIMATION_CYCLE,
  };
}

/** First `segmentCount` segments / `timelineSec` re-timed onto the frame grid — same
 *  role as frameGridSlice.ts's sliceProjectFrameGrid, but preserves the effect*
 *  fields (transition/animation cycling) and the voiceover asset that fixture drops. */
export function slicePartCFixture(base: Project, segmentCount: number, timelineSec: number, fps = PART_C_FPS): Project {
  const fpb = Math.max(1, Math.round((timelineSec / segmentCount) * fps));
  const segDur = fpb / fps;
  const videoAssets = base.assets.filter((a) => a.type === 'video');
  const src = base.segments;
  const segments: VideoSegment[] = [];
  for (let i = 0; i < segmentCount; i++) {
    const template = src[i % src.length]!;
    const video = videoAssets[i % videoAssets.length]!;
    segments.push({
      ...template,
      id: `pc-${i}`,
      assetId: video.id,
      startTime: (i * fpb) / fps,
      duration: segDur,
      order: i,
      trimStart: 0,
      trimEnd: Math.min(segDur, video.duration ?? segDur),
      text: `Caption ${i + 1}`,
      showOverlay: true,
      effectTransition: TRANSITION_CYCLE[i % TRANSITION_CYCLE.length],
      effectTransitionDuration: PART_C_TRANSITION_DURATION_SEC,
      effectAnimation: ANIMATION_CYCLE[i % ANIMATION_CYCLE.length],
    });
  }
  return { ...base, segments };
}
