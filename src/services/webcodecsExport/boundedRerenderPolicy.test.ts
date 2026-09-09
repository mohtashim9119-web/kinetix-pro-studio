/**
 * WS3 salvage-runtime round — Step 3(b): the bounded-re-render rewind ceiling.
 *
 * See `exportPipelineWebCodecs.ts`'s own doc comment above
 * `decideBoundedRerenderDisposition` for why this is a designed-and-tested
 * POLICY only, not wired into the live recovery path this round (blocked on
 * a `truncateFile(path, byteLength)` primitive that still does not exist —
 * `ffmpeg.truncateAnnexb` solves a different problem).
 */
import { describe, it, expect } from 'vitest';
import {
  decideBoundedRerenderDisposition,
  MAX_BOUNDARY_REWINDS_PER_EXPORT,
} from './exportPipelineWebCodecs';

describe('decideBoundedRerenderDisposition', () => {
  it('MAX_BOUNDARY_REWINDS_PER_EXPORT is 2', () => {
    expect(MAX_BOUNDARY_REWINDS_PER_EXPORT).toBe(2);
  });

  it('allows a rewind below the bound', () => {
    expect(decideBoundedRerenderDisposition({ rewindsUsed: 0 }).action).toBe('rewind');
    expect(decideBoundedRerenderDisposition({ rewindsUsed: 1 }).action).toBe('rewind');
  });

  it('aborts once the bound is reached, and names it', () => {
    const d = decideBoundedRerenderDisposition({ rewindsUsed: MAX_BOUNDARY_REWINDS_PER_EXPORT });
    expect(d.action).toBe('abort');
    if (d.action !== 'abort') throw new Error('unreachable');
    expect(d.reason).toContain('2/2');
  });

  it('never allows a rewind past the bound, however many have already happened', () => {
    for (const used of [2, 3, 5, 50]) {
      expect(decideBoundedRerenderDisposition({ rewindsUsed: used }).action).toBe('abort');
    }
  });

  it('honours a caller-supplied maxRewinds override', () => {
    expect(decideBoundedRerenderDisposition({ rewindsUsed: 4, maxRewinds: 5 }).action).toBe('rewind');
    expect(decideBoundedRerenderDisposition({ rewindsUsed: 5, maxRewinds: 5 }).action).toBe('abort');
  });

  it('takes only a count — the signature itself is the guarantee no other signal can leak in', () => {
    const params = Object.keys(decideBoundedRerenderDisposition({ rewindsUsed: 0 }));
    expect(params.sort()).toEqual(['action']);
  });
});
