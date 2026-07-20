/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Phase 6 dev tool — synthesizes a 500-segment Project to stress-test the
 * WebGL2 effects engine at scale, without needing any real footage: ~20
 * distinct solid-color images (so segments are visually distinguishable on
 * the timeline and in preview), cycling through all 4 GL transitions and
 * both zoom animations, plus a spread of non-neutral color grades.
 *
 * Mirrors buildScaleFixture.ts's persistence convention (putAsset before the
 * asset is wired into the Project, per CLAUDE.md's persistence model) but
 * returns the Project directly rather than saving+reloading — DevTestPanel.tsx
 * hands it straight to setProject so it's visible immediately, no reload.
 * Not imported by any real app file.
 */

import { putAsset } from '../../services/assetStore';
import { capRateForDuration, DEFAULT_ZOOM_SCALE_RATE } from '../../services/zoomScale';
import {
  AnimationType,
  TransitionType,
  type Asset,
  type Project,
  type SegmentGrade,
  type VideoSegment,
} from '../../types';

const ASSET_COLORS = [
  '#e6194b', '#3cb44b', '#ffe119', '#4363d8', '#f58231',
  '#911eb4', '#46f0f0', '#f032e6', '#bcf60c', '#fabebe',
  '#008080', '#e6beff', '#9a6324', '#fffac8', '#800000',
  '#aaffc3', '#808000', '#ffd8b1', '#000075', '#808080',
];

/** Matches compositeParams.ts's TransitionSlug — the 4 slugs the GL engine implements. */
const TRANSITION_SLUGS = ['cross-dissolve', 'dip-black', 'dip-white', 'light-leak'] as const;
/** Matches compositeParams.ts's ZoomAnimationSlug. */
const ZOOM_SLUGS = ['zoom-in', 'zoom-out'] as const;

const SEGMENT_COUNT = 500;
const IMAGE_W = 480;
const IMAGE_H = 270;
/** Fraction of the 499 segment boundaries that get a real transition (rest are hard cuts). */
const TRANSITION_RATE = 0.6;
/** Fraction of segments that get a zoom animation. */
const ANIMATION_RATE = 0.3;
/** Fraction of segments that get a non-neutral grade. */
const GRADE_RATE = 0.2;
const TRANSITION_DURATION_SEC = 0.5;

export interface ScaleFixtureResult {
  project: Project;
  segmentCount: number;
  assetCount: number;
  totalDurationSec: number;
}

function makeColorImageBlob(color: string, label: string): Promise<Blob> {
  const canvas = document.createElement('canvas');
  canvas.width = IMAGE_W;
  canvas.height = IMAGE_H;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('generateScaleFixture: 2D context unavailable for asset synthesis');
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, IMAGE_W, IMAGE_H);
  ctx.fillStyle = 'rgba(255,255,255,0.85)';
  ctx.font = 'bold 40px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(label, IMAGE_W / 2, IMAGE_H / 2);
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error('generateScaleFixture: canvas.toBlob returned null'));
    }, 'image/png');
  });
}

/** Small deterministic PRNG (mulberry32) — a fixed seed keeps a "typical" run
 *  visually stable across repeats without pulling in a dependency; nothing
 *  here needs cryptographic randomness. */
function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Builds and returns a complete 500-segment Project. Assets are persisted via
 * putAsset (IndexedDB, project-scoped) before being wired into the returned
 * Project — the same "putAsset before it enters project.assets" ordering
 * CLAUDE.md's persistence model requires. No voiceover: this fixture is for
 * GL compositor stress testing, not sync testing, and the app supports
 * voiceover-less projects.
 */
export async function generateScaleFixture(): Promise<ScaleFixtureResult> {
  const projectId = crypto.randomUUID();
  const rand = mulberry32(0xc0ffee);

  // --- 1. ~20 distinct solid-color assets -----------------------------------
  const assets: Asset[] = [];
  for (let i = 0; i < ASSET_COLORS.length; i++) {
    const blob = await makeColorImageBlob(ASSET_COLORS[i]!, `#${i + 1}`);
    const assetId = crypto.randomUUID();
    await putAsset(projectId, assetId, blob, { name: `swatch-${i + 1}.png`, mimeType: 'image/png' });
    assets.push({
      id: assetId,
      name: `swatch-${i + 1}.png`,
      url: URL.createObjectURL(blob),
      type: 'image',
      addedAt: Date.now(),
    });
  }

  // --- 2. 500 segments, 1-4s each, cycling through the assets ---------------
  const segments: VideoSegment[] = [];
  let cursor = 0;
  for (let i = 0; i < SEGMENT_COUNT; i++) {
    const asset = assets[i % assets.length]!;
    const duration = 1 + rand() * 3; // 1..4s

    const segment: VideoSegment = {
      id: crypto.randomUUID(),
      text: `Segment ${i + 1}`,
      assetId: asset.id,
      startTime: cursor,
      duration,
      transition: TransitionType.NONE,
      animation: AnimationType.NONE,
      order: i,
    };

    if (rand() < ANIMATION_RATE) {
      const slug = ZOOM_SLUGS[Math.floor(rand() * ZOOM_SLUGS.length)]!;
      segment.effectAnimation = slug;
      segment.effectAnimationScaleRate = capRateForDuration(DEFAULT_ZOOM_SCALE_RATE * (1 + rand()), duration);
    }

    if (rand() < GRADE_RATE) {
      const grade: SegmentGrade = {
        brightness: (rand() * 2 - 1) * 0.6,
        contrast: (rand() * 2 - 1) * 0.6,
        saturation: (rand() * 2 - 1) * 0.6,
        temperature: (rand() * 2 - 1) * 0.6,
      };
      segment.effectGrade = grade;
    }

    segments.push(segment);
    cursor += duration;
  }

  // --- 3. ~60% of boundaries get one of the 4 GL transitions ----------------
  for (let i = 0; i < segments.length - 1; i++) {
    if (rand() < TRANSITION_RATE) {
      const slug = TRANSITION_SLUGS[Math.floor(rand() * TRANSITION_SLUGS.length)]!;
      segments[i]!.effectTransition = slug;
      segments[i]!.effectTransitionDuration = TRANSITION_DURATION_SEC;
    }
  }

  const totalDurationSec = cursor;

  const project: Project = {
    id: projectId,
    name: `Phase 6 scale fixture (${SEGMENT_COUNT} segments)`,
    script: '',
    sceneDetails: '',
    segments,
    assets,
    globalTransition: TransitionType.NONE,
    globalTransitionDuration: TRANSITION_DURATION_SEC,
    globalAnimation: AnimationType.NONE,
    globalOverlayConfig: { color: '#ffffff', backgroundColor: '#000000', fontFamily: 'Inter' },
    confirmed: true,
  };

  return { project, segmentCount: segments.length, assetCount: assets.length, totalDurationSec };
}
