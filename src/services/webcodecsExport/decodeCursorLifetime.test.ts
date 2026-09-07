import { readFileSync } from 'fs';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import { describe, it, expect } from 'vitest';
import { AnimationType, TransitionType, type VideoSegment } from '../../types';
import { deriveCompositeParams, deriveSlotPlan, type ProjectEffectConfig } from '../gl/compositeParams';
import {
  DecodeCursorRegistry,
  MAX_SIMULTANEOUS_OPEN_DECODE_CURSORS,
  cursorLastNeededSec,
  shouldReleaseDecodeCursor,
} from './decodeCursorLifetime';

const HERE = dirname(fileURLToPath(import.meta.url));

function makeSegment(overrides: Partial<VideoSegment> & { id: string; startTime: number }): VideoSegment {
  return {
    text: '',
    assetId: 'asset-1',
    duration: 1,
    transition: TransitionType.NONE,
    animation: AnimationType.NONE,
    order: 0,
    ...overrides,
  };
}

function chain(count: number, duration: number, outgoing?: { effectTransition: string; effectTransitionDuration: number }): VideoSegment[] {
  return Array.from({ length: count }, (_, i) =>
    makeSegment({
      id: `s${i}`,
      startTime: i * duration,
      duration,
      order: i,
      ...(outgoing && i < count - 1 ? outgoing : {}),
    }),
  );
}

async function walkPeak(
  segments: VideoSegment[],
  config: ProjectEffectConfig,
  fps: number,
  release: boolean,
): Promise<{ peak: number; created: number; openAtEnd: number }> {
  const registry = new DecodeCursorRegistry<string>();
  const runStart = segments[0]!.startTime;
  const last = segments[segments.length - 1]!;
  const total = Math.round((last.startTime + last.duration - runStart) * fps);
  for (let i = 0; i < total; i++) {
    const currentTime = runStart + i / fps;
    const raw = deriveCompositeParams(segments, currentTime, config);
    const plan = deriveSlotPlan(segments, currentTime, raw.transition, config);
    if (plan.a && !registry.get(plan.a.id)) registry.open(plan.a.id, plan.a.id);
    if (plan.b && !registry.get(plan.b.id)) registry.open(plan.b.id, plan.b.id);
    if (release) {
      await registry.releaseStale(currentTime, segments, config, async () => undefined);
    }
  }
  return { peak: registry.peakOpenCursors, created: registry.cursorsCreated, openAtEnd: registry.size };
}

const none: ProjectEffectConfig = { globalTransitionDuration: 0.5 };

describe('cursorLastNeededSec', () => {
  it('is the exclusive segment end when there is no outgoing GL transition', () => {
    const segments = chain(3, 1);
    expect(cursorLastNeededSec(segments[0]!, segments, none)).toBe(1);
    expect(cursorLastNeededSec(segments[2]!, segments, none)).toBe(3);
  });

  it('extends through the outgoing centered-transition tail', () => {
    const segments = chain(3, 1, { effectTransition: 'cross-dissolve', effectTransitionDuration: 0.4 });
    expect(cursorLastNeededSec(segments[0]!, segments, none)).toBe(1.2);
    expect(shouldReleaseDecodeCursor(segments[0]!, 1.199, segments, none)).toBe(false);
    expect(shouldReleaseDecodeCursor(segments[0]!, 1.2, segments, none)).toBe(true);
  });
});

describe('decode-cursor accumulation (the test that stops the leak returning)', () => {
  it(`peak simultaneous open cursors stays <= ${MAX_SIMULTANEOUS_OPEN_DECODE_CURSORS} across a synthetic multi-segment run`, async () => {
    const segments = chain(8, 1);
    const released = await walkPeak(segments, none, 30, true);
    expect(released.created).toBe(8);
    expect(released.peak).toBeLessThanOrEqual(MAX_SIMULTANEOUS_OPEN_DECODE_CURSORS);
    expect(released.openAtEnd).toBeLessThanOrEqual(1);
  });

  it(`same bound holds when every boundary is a centered GL transition`, async () => {
    const segments = chain(8, 1, { effectTransition: 'cross-dissolve', effectTransitionDuration: 0.4 });
    const released = await walkPeak(segments, none, 30, true);
    expect(released.created).toBe(8);
    expect(released.peak).toBeLessThanOrEqual(MAX_SIMULTANEOUS_OPEN_DECODE_CURSORS);
  });

  it('without release, cursors accumulate to the segment count (the defect this test is built to see)', async () => {
    const segments = chain(8, 1);
    const leaked = await walkPeak(segments, none, 30, false);
    expect(leaked.peak).toBe(8);
    expect(leaked.openAtEnd).toBe(8);
  });

  it('exportWorker frame loop still calls releaseStaleCursors', () => {
    const src = readFileSync(resolve(HERE, 'exportWorker.ts'), 'utf8');
    expect(src).toContain('await runState.releaseStaleCursors(currentTime)');
  });
});
