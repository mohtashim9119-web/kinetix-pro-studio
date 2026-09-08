import { describe, it, expect } from 'vitest';
import { LIVENESS_PHASE_LOG_TAIL } from './exportPipelineWebCodecs';
import { PHASE_LOG_CAP } from './exportWorkerDiagnostics';
import type { ExportLivenessSnapshot } from '../exportPipeline';

/**
 * WS3 — the phase log's last hop.
 *
 * `PHASE_LOG_CAP` went 128 -> 1024 and the field payload still carried no
 * phase log, because the cap governs RETENTION in the worker and the operator
 * only ever receives `ExportLivenessSnapshot` — which had no phase-log field.
 * This pins the route, so a future payload without a log is a collection bug
 * rather than a plumbing one.
 */
describe('liveness snapshot carries the phase log to the operator', () => {
  it('LIVENESS_PHASE_LOG_TAIL is smaller than PHASE_LOG_CAP and non-zero', () => {
    expect(LIVENESS_PHASE_LOG_TAIL).toBeGreaterThan(0);
    expect(LIVENESS_PHASE_LOG_TAIL).toBeLessThan(PHASE_LOG_CAP);
  });

  it('ExportLivenessSnapshot structurally accepts a phase-log tail and a typed via', () => {
    // A compile-time assertion with a runtime witness: before this round the
    // interface had neither field, so this object would not typecheck.
    const snap: ExportLivenessSnapshot = {
      lastPhase: 'encoder-flush',
      msSinceLastPhaseChange: 30158,
      pieceIndex: 0,
      framesEncoded: 38061,
      maxSilentMs: 30158,
      failureVia: 'flush-timeout',
      phaseLogTail: [{ atMs: 1, phase: 'encoder-flush', pieceIndex: 0, framesEncoded: 38061, kind: 'enter' }],
    };
    expect(snap.phaseLogTail).toHaveLength(1);
    expect(snap.failureVia).toBe('flush-timeout');
  });
});
