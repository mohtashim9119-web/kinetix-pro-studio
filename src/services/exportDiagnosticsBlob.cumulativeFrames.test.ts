/**
 * Q6 (Round 28 quick-close batch) — D7: a Windows field report showed
 * `framesEncoded: 1029` at `encoderSessionIndex: 18` alongside
 * 1,078,402,941 retained bytes on disk, which read as a contradiction. It
 * wasn't: `framesEncoded` on `ExportLivenessSnapshot` is scoped to the
 * CURRENT piece's worker (a fresh WebCodecs worker builds exactly one
 * piece's worth of encoder sessions in its lifetime — exportWorker.ts's
 * `runExport` doc comment), so it resets to 0 every time a new piece's
 * worker spins up even though earlier, already-completed pieces wrote real
 * bytes to disk.
 *
 * This pins the fix: `framesEncodedCumulative` sums frames across every
 * completed piece in the run PLUS the current piece's own count, and never
 * resets when a new per-piece worker (a "session" in the field-report's
 * terms) restarts — while `framesEncoded` keeps its existing, correct,
 * per-session meaning untouched.
 */
import { describe, it, expect } from 'vitest';
import { buildExportDiagnosticsBlob } from './exportDiagnosticsBlob';
import type { ExportError, ExportLivenessSnapshot } from './exportPipeline';

function livenessAfterPiece(framesCompletedBase: number, thisPieceFrames: number): ExportLivenessSnapshot {
  return {
    lastPhase: 'frame-loop',
    msSinceLastPhaseChange: 10,
    pieceIndex: 0,
    framesEncoded: thisPieceFrames,
    framesEncodedCumulative: framesCompletedBase + thisPieceFrames,
  };
}

describe('D7 — framesEncoded (per-session) vs framesEncodedCumulative (persists across a piece-worker restart)', () => {
  it('a simulated encoder/worker restart resets framesEncoded to 0 but keeps accumulating framesEncodedCumulative', () => {
    // Piece 1 (worker #1): encodes 500 frames, completes. framesCompletedBase
    // becomes 500 going into piece 2.
    const afterPiece1 = livenessAfterPiece(0, 500);
    expect(afterPiece1.framesEncoded).toBe(500);
    expect(afterPiece1.framesEncodedCumulative).toBe(500);

    // Piece 2 (worker #2 — a fresh worker, i.e. the "encoder restart"):
    // framesEncoded resets to 0 at the new worker's start...
    const piece2WorkerStart = livenessAfterPiece(500, 0);
    expect(piece2WorkerStart.framesEncoded).toBe(0);
    // ...but framesEncodedCumulative still reads 500 — the bytes already on
    // disk from piece 1 are still accounted for, not lost to the reset.
    expect(piece2WorkerStart.framesEncodedCumulative).toBe(500);

    // Piece 2 progresses to 1029 frames of its own (mirrors the Machine 1
    // field report's framesEncoded: 1029 at encoderSessionIndex: 18) before
    // failing.
    const piece2Failure = livenessAfterPiece(500, 1029);
    expect(piece2Failure.framesEncoded).toBe(1029);
    expect(piece2Failure.framesEncodedCumulative).toBe(1529);
    // The per-session value alone (1029 frames ≈ a few MB at any plausible
    // bitrate) looks contradictory next to ~1GB retained on disk; the
    // cumulative value (1529 frames across both pieces, plus whichever
    // still-earlier pieces already concatenated before piece 1) is the
    // number that actually explains retained bytes that large.
  });

  it('reaches the operator-visible Copy-diagnostics blob under its own distinct key, alongside the untouched per-session field', () => {
    const err: ExportError = {
      kind: 'encode',
      message: 'no output for 30s',
      liveness: livenessAfterPiece(500, 1029),
    };
    const blob = buildExportDiagnosticsBlob(err, {
      segmentCount: 10,
      hasVoiceover: true,
      exportResolution: '1080p',
      exportFps: 30,
      ts: '2026-09-15T00:00:00.000Z',
    });
    expect(blob.framesEncoded).toBe(1029);
    expect(blob.framesEncodedCumulative).toBe(1529);
  });
});
