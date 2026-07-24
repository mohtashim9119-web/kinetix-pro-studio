/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// PARTIAL COVERAGE NOTE: this repo has no jsdom/happy-dom/@testing-library/
// react/react-test-renderer (confirmed absent from node_modules — same
// limitation useGlPreview.test.ts's header already documents), so
// usePlayback cannot actually be rendered here, and neither of the "if
// feasible" tests the QB2 prompt asks for (spying on setCurrentTime call
// counts across simulated rAF ticks, or asserting an old tick is cancelled
// when deps change) can be performed against the real hook. The tests below
// do NOT render the hook; they mechanically verify the two concrete
// mechanisms the QB2 fix relies on, using the hook module's own exported
// constant and real values transplanted from the rAF effect's dependency
// array in usePlayback.ts. Real end-to-end proof that the infinite-update
// loop is gone is the manual Apply Sync verification (queued, not run here).

import { describe, it, expect } from 'vitest';
import { CURRENT_TIME_EPSILON_SEC } from './usePlayback';

describe('QB2 delta guard — CURRENT_TIME_EPSILON_SEC boundary math', () => {
  // Re-states tick()'s exact guard expression from usePlayback.ts:
  //   Math.abs(audio.currentTime - currentTimeRef.current) > CURRENT_TIME_EPSILON_SEC
  const shouldCommit = (currentTime: number, lastCommitted: number) =>
    Math.abs(currentTime - lastCommitted) > CURRENT_TIME_EPSILON_SEC;

  it('is smaller than one frame at 60fps, so real per-frame playback advancement always clears it', () => {
    const frameAt60fps = 1 / 60; // ~0.0167s
    expect(CURRENT_TIME_EPSILON_SEC).toBeLessThan(frameAt60fps);
    expect(shouldCommit(frameAt60fps, 0)).toBe(true);
  });

  it('suppresses a redundant commit when currentTime has not meaningfully moved', () => {
    // Sub-millisecond float jitter between repeated audio.currentTime reads
    // at the same real position must not trip the guard.
    expect(shouldCommit(1.000001, 1.0)).toBe(false);
    expect(shouldCommit(1.0, 1.0)).toBe(false);
  });

  it('still commits a real seek or multi-frame jump', () => {
    expect(shouldCommit(5.2, 1.0)).toBe(true);
  });

  it('is a strict inequality, so a delta of exactly the epsilon does not commit', () => {
    expect(shouldCommit(CURRENT_TIME_EPSILON_SEC, 0)).toBe(false);
    expect(shouldCommit(CURRENT_TIME_EPSILON_SEC + 0.0001, 0)).toBe(true);
  });
});

describe('QB2 dependency-array fix — hasVoiceover vs. voiceover-object identity', () => {
  // Re-states React's own documented effect-rerun rule: an effect re-runs
  // when at least one dependency fails Object.is against its previous value.
  // usePlayback.ts's rAF effect used to depend on the `voiceover` object
  // itself; it now depends on `hasVoiceover = !!voiceover`. This test proves
  // the concrete case the fix targets: the SAME voiceover asset being
  // represented by a new object (e.g. project.assets rebuilt during Apply
  // Sync, same id/content, new reference) no longer looks like a changed
  // dependency once presence, not identity, is what's tracked.
  const effectWouldRerun = (prevDeps: unknown[], nextDeps: unknown[]) =>
    prevDeps.some((prev, i) => !Object.is(prev, nextDeps[i]));

  it('a same-presence, different-identity voiceover object DID look like a changed dep (pre-fix shape)', () => {
    const voiceoverBefore = { id: 'a1', url: 'blob:1' };
    const voiceoverAfter = { id: 'a1', url: 'blob:1' }; // same content, new object — e.g. post Apply-Sync rebuild
    const prevDeps = [true /* isPlaying */, voiceoverBefore];
    const nextDeps = [true, voiceoverAfter];
    expect(effectWouldRerun(prevDeps, nextDeps)).toBe(true);
  });

  it('the same swap no longer looks like a changed dep once tracked via hasVoiceover (post-fix shape)', () => {
    const voiceoverBefore = { id: 'a1', url: 'blob:1' };
    const voiceoverAfter = { id: 'a1', url: 'blob:1' };
    const prevDeps = [true /* isPlaying */, !!voiceoverBefore];
    const nextDeps = [true, !!voiceoverAfter];
    expect(effectWouldRerun(prevDeps, nextDeps)).toBe(false);
  });

  it('hasVoiceover still changes (and the effect still reruns) when voiceover actually appears/disappears', () => {
    const noVoiceover: { id: string; url: string } | undefined = undefined;
    const someVoiceover: { id: string; url: string } | undefined = { id: 'a1', url: 'blob:1' };
    const prevDeps = [true, !!noVoiceover];
    const nextDeps = [true, !!someVoiceover];
    expect(effectWouldRerun(prevDeps, nextDeps)).toBe(true);
  });
});
