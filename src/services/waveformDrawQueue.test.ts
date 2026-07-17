import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  enqueueWaveformDraw,
  WAVEFORM_DRAW_BATCH_SIZE,
  _resetWaveformDrawQueueForTests,
} from './waveformDrawQueue';

// Controllable requestAnimationFrame: capture scheduled callbacks and flush
// them one "frame" at a time so batching is deterministic in node.
let frames: FrameRequestCallback[] = [];
let nextId = 1;

function flushOneFrame(): void {
  const due = frames;
  frames = [];
  for (const cb of due) cb(performance.now());
}

beforeEach(() => {
  frames = [];
  nextId = 1;
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
    frames.push(cb);
    return nextId++;
  });
  vi.stubGlobal('cancelAnimationFrame', () => {});
  _resetWaveformDrawQueueForTests();
});

afterEach(() => {
  _resetWaveformDrawQueueForTests();
  vi.unstubAllGlobals();
});

describe('waveformDrawQueue — batching', () => {
  it('runs at most WAVEFORM_DRAW_BATCH_SIZE tasks per frame', () => {
    const order: number[] = [];
    const total = WAVEFORM_DRAW_BATCH_SIZE * 2 + 5; // spans 3 frames
    for (let i = 0; i < total; i++) enqueueWaveformDraw(() => order.push(i));

    flushOneFrame();
    expect(order.length).toBe(WAVEFORM_DRAW_BATCH_SIZE);

    flushOneFrame();
    expect(order.length).toBe(WAVEFORM_DRAW_BATCH_SIZE * 2);

    flushOneFrame();
    expect(order.length).toBe(total);
  });

  it('preserves FIFO order across frames', () => {
    const order: number[] = [];
    const total = WAVEFORM_DRAW_BATCH_SIZE + 3;
    for (let i = 0; i < total; i++) enqueueWaveformDraw(() => order.push(i));

    flushOneFrame();
    flushOneFrame();

    expect(order).toEqual(Array.from({ length: total }, (_, i) => i));
  });

  it('does not schedule another frame once the queue is empty', () => {
    enqueueWaveformDraw(() => {});
    flushOneFrame();
    expect(frames.length).toBe(0); // nothing left → no follow-up frame
  });
});

describe('waveformDrawQueue — cancellation', () => {
  it('a cancelled task never runs', () => {
    const ran: string[] = [];
    enqueueWaveformDraw(() => ran.push('a'));
    const handle = enqueueWaveformDraw(() => ran.push('b'));
    enqueueWaveformDraw(() => ran.push('c'));

    handle.cancel();
    flushOneFrame();

    expect(ran).toEqual(['a', 'c']);
  });

  it('cancel after the task already ran is a no-op', () => {
    const ran: string[] = [];
    const handle = enqueueWaveformDraw(() => ran.push('a'));
    flushOneFrame();
    expect(ran).toEqual(['a']);
    expect(() => handle.cancel()).not.toThrow();
    expect(ran).toEqual(['a']);
  });
});

describe('waveformDrawQueue — resilience', () => {
  it('one throwing task does not stall the rest of the batch', () => {
    const ran: string[] = [];
    enqueueWaveformDraw(() => ran.push('a'));
    enqueueWaveformDraw(() => {
      throw new Error('boom');
    });
    enqueueWaveformDraw(() => ran.push('c'));

    expect(() => flushOneFrame()).not.toThrow();
    expect(ran).toEqual(['a', 'c']);
  });
});
