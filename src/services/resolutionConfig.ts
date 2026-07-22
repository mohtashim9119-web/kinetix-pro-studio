/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Single source of truth mapping (AspectRatio, ResolutionTier) -> pixel
 * dimensions. Pure, dependency-free, worker-safe — imported by the preview
 * path and the export pipeline alike (docs/project-settings-plan.md §1.2).
 * The Record<AspectRatio, Record<ResolutionTier, ...>> shape makes the table
 * exhaustiveness-checked by TypeScript: adding a tier or ratio without
 * filling every cell is a compile error, not a silent runtime hole.
 */

import type { AspectRatio, ResolutionTier } from '../types';

export type { AspectRatio, ResolutionTier };

export interface FrameDimensions {
  width: number;
  height: number;
}

export const RESOLUTION_TABLE: Record<AspectRatio, Record<ResolutionTier, FrameDimensions>> = {
  '16:9': { '720p': { width: 1280, height: 720 }, '1080p': { width: 1920, height: 1080 } },
  '9:16': { '720p': { width: 720, height: 1280 }, '1080p': { width: 1080, height: 1920 } },
  '1:1': { '720p': { width: 720, height: 720 }, '1080p': { width: 1080, height: 1080 } },
};

export const DEFAULT_ASPECT_RATIO: AspectRatio = '16:9';
export const DEFAULT_RESOLUTION_TIER: ResolutionTier = '1080p';

export function resolveDimensions(aspectRatio: AspectRatio, tier: ResolutionTier): FrameDimensions {
  return RESOLUTION_TABLE[aspectRatio][tier];
}

/** '16:9' -> '16 / 9' (for the preview stage's inline `aspectRatio` style). */
export function aspectRatioToCss(aspectRatio: AspectRatio): string {
  return aspectRatio.replace(':', ' / ');
}
