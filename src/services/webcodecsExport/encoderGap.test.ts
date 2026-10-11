import { describe, it, expect } from 'vitest';
import { detectEncoderGap } from './encoderGap';

describe('detectEncoderGap — submitted frames against emitted chunks after a flush', () => {
  it('a healthy flush emits exactly what was submitted: no gap', () => {
    expect(detectEncoderGap({ submitted: 1830, emitted: 1830, fencedSessions: 0, sessionIndex: 0 })).toBeNull();
  });

  it('fewer chunks than frames is an encoder gap, with both numbers', () => {
    expect(detectEncoderGap({ submitted: 1830, emitted: 1829, fencedSessions: 0, sessionIndex: 2 }))
      .toEqual({ submitted: 1830, emitted: 1829, sessionIndex: 2 });
  });

  it('after a salvage fenced a session its late chunks are discarded on purpose: never a gap', () => {
    expect(detectEncoderGap({ submitted: 1830, emitted: 1500, fencedSessions: 1, sessionIndex: 1 })).toBeNull();
  });

  it('more chunks than frames is not a drop (never false-fails a healthy rung)', () => {
    expect(detectEncoderGap({ submitted: 10, emitted: 11, fencedSessions: 0, sessionIndex: 0 })).toBeNull();
  });

  it('nothing submitted yet is not a gap', () => {
    expect(detectEncoderGap({ submitted: 0, emitted: 0, fencedSessions: 0, sessionIndex: 0 })).toBeNull();
  });
});
