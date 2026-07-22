import { describe, it, expect } from 'vitest';
import {
  resolveDimensions,
  aspectRatioToCss,
  DEFAULT_ASPECT_RATIO,
  DEFAULT_RESOLUTION_TIER,
  RESOLUTION_TABLE,
} from './resolutionConfig';
import type { AspectRatio, ResolutionTier } from '../types';

describe('resolveDimensions — the (aspectRatio, tier) -> pixel dimensions lookup', () => {
  it('16:9 720p -> 1280x720', () => {
    expect(resolveDimensions('16:9', '720p')).toEqual({ width: 1280, height: 720 });
  });

  it('16:9 1080p -> 1920x1080', () => {
    expect(resolveDimensions('16:9', '1080p')).toEqual({ width: 1920, height: 1080 });
  });

  it('9:16 720p -> 720x1280', () => {
    expect(resolveDimensions('9:16', '720p')).toEqual({ width: 720, height: 1280 });
  });

  it('9:16 1080p -> 1080x1920', () => {
    expect(resolveDimensions('9:16', '1080p')).toEqual({ width: 1080, height: 1920 });
  });

  it('1:1 720p -> 720x720', () => {
    expect(resolveDimensions('1:1', '720p')).toEqual({ width: 720, height: 720 });
  });

  it('1:1 1080p -> 1080x1080', () => {
    expect(resolveDimensions('1:1', '1080p')).toEqual({ width: 1080, height: 1080 });
  });

  it('covers all 6 combinations exhaustively via RESOLUTION_TABLE', () => {
    const ratios: AspectRatio[] = ['16:9', '9:16', '1:1'];
    const tiers: ResolutionTier[] = ['720p', '1080p'];
    for (const ratio of ratios) {
      for (const tier of tiers) {
        expect(resolveDimensions(ratio, tier)).toBe(RESOLUTION_TABLE[ratio][tier]);
      }
    }
    // Compile-time exhaustiveness (cannot be asserted at runtime): the
    // Record<AspectRatio, Record<ResolutionTier, FrameDimensions>> type on
    // RESOLUTION_TABLE means omitting any ratio or tier cell is a TypeScript
    // compile error, not a silent runtime gap.
  });
});

describe('aspectRatioToCss', () => {
  it('16:9 -> "16 / 9"', () => {
    expect(aspectRatioToCss('16:9')).toBe('16 / 9');
  });

  it('9:16 -> "9 / 16"', () => {
    expect(aspectRatioToCss('9:16')).toBe('9 / 16');
  });

  it('1:1 -> "1 / 1"', () => {
    expect(aspectRatioToCss('1:1')).toBe('1 / 1');
  });
});

describe('defaults', () => {
  it('DEFAULT_ASPECT_RATIO is 16:9', () => {
    expect(DEFAULT_ASPECT_RATIO).toBe('16:9');
  });

  it('DEFAULT_RESOLUTION_TIER is 1080p', () => {
    expect(DEFAULT_RESOLUTION_TIER).toBe('1080p');
  });
});
