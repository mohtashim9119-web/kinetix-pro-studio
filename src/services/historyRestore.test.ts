/**
 * Characterization tests for historyRestore.ts, written to pin App.tsx's
 * applyRestoredState selection/playhead repair BEFORE it was extracted
 * (Stage 6, 2026-08-08 cleanup run) — same "characterize first, then move"
 * precedent as dragSession.test.ts.
 */

import { describe, expect, it } from 'vitest';
import {
  clampCurrentTimeToRestoredEnd,
  repairSelectedHeadingId,
  repairSelectedSegmentId,
  repairSelectedSegmentIds,
} from './historyRestore';
import { AnimationType, TransitionType, type Project, type VideoSegment, type HeadingOverlay } from '../types';

function seg(id: string, startTime: number, duration: number): VideoSegment {
  return {
    id, text: `t-${id}`, startTime, duration,
    transition: TransitionType.NONE, animation: AnimationType.NONE,
    order: 0, anchorStart: startTime,
  };
}

function heading(id: string): HeadingOverlay {
  return {
    id, text: `h-${id}`, time: 0, duration: 1,
    fontFamily: 'Inter', fontSize: 32, fontWeight: 700,
    color: '#fff', backgroundColor: 'transparent', x: 50, y: 50,
  };
}

function makeProject(partial: Partial<Project> = {}): Project {
  return {
    id: 'p1',
    name: 'Test Project',
    script: '',
    sceneDetails: '',
    segments: [seg('a', 0, 5), seg('b', 5, 5)],
    assets: [],
    globalTransition: TransitionType.NONE,
    globalTransitionDuration: 0.5,
    globalAnimation: AnimationType.NONE,
    globalOverlayConfig: { color: '#fff', backgroundColor: 'transparent', fontFamily: 'Inter' },
    ...partial,
  };
}

describe('repairSelectedSegmentId', () => {
  it('passes through an id that still exists in the restored segments', () => {
    const restored = makeProject();
    expect(repairSelectedSegmentId('a', restored)).toBe('a');
  });

  it('drops an id that no longer exists — the Apply Sync case, where the whole id set regenerates', () => {
    const restored = makeProject();
    expect(repairSelectedSegmentId('gone', restored)).toBeNull();
  });

  it('null stays null', () => {
    const restored = makeProject();
    expect(repairSelectedSegmentId(null, restored)).toBeNull();
  });
});

describe('repairSelectedHeadingId', () => {
  it('passes through an id that still exists in the restored headings', () => {
    const restored = makeProject({ headings: [heading('h1')] });
    expect(repairSelectedHeadingId('h1', restored)).toBe('h1');
  });

  it('drops an id that no longer exists', () => {
    const restored = makeProject({ headings: [heading('h1')] });
    expect(repairSelectedHeadingId('gone', restored)).toBeNull();
  });

  it('treats a missing headings array the same as an empty one — always drops', () => {
    const restored = makeProject({ headings: undefined });
    expect(repairSelectedHeadingId('h1', restored)).toBeNull();
  });

  it('null stays null', () => {
    const restored = makeProject({ headings: [heading('h1')] });
    expect(repairSelectedHeadingId(null, restored)).toBeNull();
  });
});

describe('repairSelectedSegmentIds', () => {
  it('returns the SAME set reference when nothing was filtered out — avoids an unnecessary re-render on the common case', () => {
    const restored = makeProject(); // segments a, b
    const ids = new Set(['a', 'b']);
    expect(repairSelectedSegmentIds(ids, restored)).toBe(ids);
  });

  it('drops ids no longer present, keeping the rest', () => {
    const restored = makeProject(); // segments a, b
    const ids = new Set(['a', 'gone']);
    const result = repairSelectedSegmentIds(ids, restored);
    expect(result).not.toBe(ids);
    expect([...result]).toEqual(['a']);
  });

  it('an empty set stays empty (and is returned as the same reference)', () => {
    const restored = makeProject();
    const ids = new Set<string>();
    expect(repairSelectedSegmentIds(ids, restored)).toBe(ids);
  });

  it('every id dropped when none survive', () => {
    const restored = makeProject({ segments: [] });
    const ids = new Set(['a', 'b']);
    const result = repairSelectedSegmentIds(ids, restored);
    expect([...result]).toEqual([]);
  });
});

describe('clampCurrentTimeToRestoredEnd', () => {
  it('leaves currentTime unchanged when it is within the restored timeline', () => {
    const restored = makeProject(); // ends at 10 (segment b: 5+5)
    expect(clampCurrentTimeToRestoredEnd(3, restored)).toBe(3);
  });

  it('clamps down to the restored end when the playhead is past it — a shorter restored timeline', () => {
    const restored = makeProject({ segments: [seg('a', 0, 2)] }); // ends at 2
    expect(clampCurrentTimeToRestoredEnd(9, restored)).toBe(2);
  });

  it('a currentTime exactly at the restored end is left unchanged, not clamped', () => {
    const restored = makeProject(); // ends at 10
    expect(clampCurrentTimeToRestoredEnd(10, restored)).toBe(10);
  });

  it('an empty restored timeline (end = 0) clamps any positive playhead to 0', () => {
    const restored = makeProject({ segments: [] });
    expect(clampCurrentTimeToRestoredEnd(5, restored)).toBe(0);
  });
});
