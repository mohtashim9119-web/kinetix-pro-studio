import { describe, it, expect } from 'vitest';
import {
  PHASE_LOG_CAP,
  attributeSilentIntervals,
  failureFromUnknown,
  formatFailureMessage,
  phaseAtTime,
  pushPhaseLogEntry,
  type ExportPhaseLogEntry,
} from './exportWorkerDiagnostics';
import { ExportPhaseTracker } from './exportPhaseTracker';

function logEntry(atMs: number, phase: string, seq: number, frames = 0): ExportPhaseLogEntry {
  return {
    seq,
    atMs,
    phase,
    pieceIndex: 0,
    segmentIndex: 0,
    assetId: null,
    framesEncoded: frames,
    kind: 'enter',
  };
}

describe('exportWorkerDiagnostics', () => {
  it('phaseAtTime returns the phase live at a timestamp', () => {
    const log = [logEntry(0, 'gl-context', 1), logEntry(100, 'frame-loop', 2, 10)];
    expect(phaseAtTime(log, 50)).toBe('gl-context');
    expect(phaseAtTime(log, 150)).toBe('frame-loop');
  });

  it('attributeSilentIntervals attributes gaps to the active phase', () => {
    const log = [logEntry(0, 'frame-loop', 1, 100), logEntry(5000, 'frame-loop', 2, 500)];
    const events = [
      { atMs: 0, kind: 'chunk' as const },
      { atMs: 20_000, kind: 'chunk' as const },
    ];
    const gaps = attributeSilentIntervals(events, log, 5000);
    expect(gaps).toHaveLength(1);
    expect(gaps[0]!.durationMs).toBe(20_000);
    expect(gaps[0]!.phase).toBe('frame-loop');
    expect(gaps[0]!.framesEncodedAtStart).toBe(100);
  });

  it('pushPhaseLogEntry drops oldest entries at PHASE_LOG_CAP (destructive probe)', () => {
    const log: ExportPhaseLogEntry[] = [];
    for (let i = 0; i < PHASE_LOG_CAP + 50; i++) {
      pushPhaseLogEntry(log, logEntry(i, 'frame-loop', i + 1, i));
    }
    expect(log.length).toBe(PHASE_LOG_CAP);
    expect(log[0]!.seq).toBe(51);
    expect(log[log.length - 1]!.seq).toBe(PHASE_LOG_CAP + 50);
  });

  it('ExportPhaseTracker phase log stays bounded under a long synthetic run (destructive probe)', () => {
    const now = { t: 0 };
    const tracker = new ExportPhaseTracker(() => undefined, 0, () => now.t);
    tracker.enter('frame-loop');
    for (let i = 0; i < 10_000; i++) {
      now.t += 100;
      tracker.pulse();
    }
    const breakdown = tracker.finish();
    expect(breakdown.phaseLog.length).toBeLessThanOrEqual(PHASE_LOG_CAP);
    expect(breakdown.phaseLog.length).toBeGreaterThan(0);
  });

  it('formatFailureMessage includes via, name, frame index, and timeline', () => {
    const f = failureFromUnknown(new DOMException('Encoder failed', 'EncodingError'), 'encoder-callback', 1799, 59.967);
    expect(f.name).toBe('EncodingError');
    expect(formatFailureMessage(f)).toContain('encoder-callback');
    expect(formatFailureMessage(f)).toContain('frame 1799');
    expect(formatFailureMessage(f)).toContain('59.967');
  });
});
