/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import {
  missingSlots,
  missingSlotsReason,
  missingSpineSlots,
  spineGateReason,
  waitForStagingTranscript,
  type StagingTranscriptState,
} from './buildTimelineGate';

const ALL = { script: true, scene: true, voiceover: true, media: true };

describe('U4.6 — the four-slot gate', () => {
  it('all four filled → no reason', () => {
    expect(missingSlots(ALL)).toEqual([]);
    expect(missingSlotsReason(ALL)).toBeUndefined();
  });

  it('the spine alone (no media) is not enough — product ruling, not an engine need', () => {
    expect(missingSlotsReason({ ...ALL, media: false })).toBe('Add media to build the timeline');
  });

  it('one missing slot reads as one sentence', () => {
    expect(missingSlotsReason({ ...ALL, voiceover: false })).toBe('Add a voiceover to build the timeline');
  });

  it('several missing slots are listed in slot order', () => {
    expect(missingSlotsReason({ script: false, scene: true, voiceover: false, media: false }))
      .toBe('Add a script, a voiceover and media to build the timeline');
    expect(missingSlotsReason({ script: false, scene: false, voiceover: false, media: false }))
      .toBe('Add a script, a scene doc, a voiceover and media to build the timeline');
  });
});

describe('U9 — the spine-only gate (editor Build Timeline)', () => {
  it('spine complete, no media → no reason: media never gates', () => {
    expect(missingSpineSlots({ ...ALL, media: false })).toEqual([]);
    expect(spineGateReason({ ...ALL, media: false })).toBeUndefined();
  });

  it('per-item copy, in slot order', () => {
    expect(spineGateReason({ ...ALL, script: false })).toBe('Add script to build the timeline');
    expect(spineGateReason({ ...ALL, scene: false })).toBe('Add scene doc to build the timeline');
    expect(spineGateReason({ ...ALL, voiceover: false })).toBe('Add voiceover to build the timeline');
    expect(spineGateReason({ script: false, scene: false, voiceover: false, media: true }))
      .toBe('Add script, scene doc and voiceover to build the timeline');
  });

  it('the four-slot helpers are untouched for Bulk Projects (its slot chips stay four)', () => {
    expect(missingSlotsReason({ ...ALL, media: false })).toBe('Add media to build the timeline');
  });
});

describe('U4.6 — an early click waits on the staging transcript', () => {
  function harness(initial: StagingTranscriptState) {
    let state = initial;
    const wakers = new Set<() => void>();
    const controller = new AbortController();
    const promise = waitForStagingTranscript(() => state, wakers, controller.signal);
    return {
      promise,
      wakers,
      controller,
      set(next: StagingTranscriptState) { state = next; for (const w of [...wakers]) w(); },
    };
  }

  it('already ready → resolves at once, leaving no waker behind', async () => {
    const h = harness({ ready: true, paused: false });
    await expect(h.promise).resolves.toBe('ready');
    expect(h.wakers.size).toBe(0);
  });

  it('waits while transcribing, then resolves ready when the transcript lands', async () => {
    const h = harness({ ready: false, paused: false });
    let settled = false;
    void h.promise.then(() => { settled = true; });
    await Promise.resolve();
    expect(settled).toBe(false);
    h.set({ ready: true, paused: false });
    await expect(h.promise).resolves.toBe('ready');
  });

  it('a failure with its own dialog ends the wait as paused — never a silent hang', async () => {
    const h = harness({ ready: false, paused: false });
    // A failed run's terminal phase also reads as "ready" for gating: pause wins.
    h.set({ ready: true, paused: true });
    await expect(h.promise).resolves.toBe('paused');
    expect(h.wakers.size).toBe(0);
  });

  it('cancel ends the wait', async () => {
    const h = harness({ ready: false, paused: false });
    h.controller.abort();
    await expect(h.promise).resolves.toBe('aborted');
    expect(h.wakers.size).toBe(0);
  });
});
