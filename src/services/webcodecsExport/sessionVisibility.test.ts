/**
 * WS3 — the encoder-session bound must be OBSERVABLE.
 *
 * Field sequence this pins. An installer carrying the session bound showed
 * "Encoding segment 2 / 3" and was read as the fix having failed, because 3 is
 * the PIECE count and the bound deliberately does not change piece boundaries.
 * The two numbers are different, only the second one moves when the bound
 * engages, and the UI showed only the first — so a working bound and a dead
 * one rendered identically.
 *
 * That is the same failure as the phase log that was capped 128 -> 1024 and
 * never routed to the payload: a change nobody can observe is a change nobody
 * can trust, and both cost a round to discover.
 */
import { describe, it, expect } from 'vitest';
import { stageLabelFor } from '../../hooks/useExport';
import type { ExportStage } from '../exportPipeline';

const piece = (over: Partial<Extract<ExportStage, { type: 'encoding_segment' }>>): ExportStage => ({
  type: 'encoding_segment',
  index: 1,
  total: 3,
  frame: 0,
  totalFrames: 38061,
  ...over,
});

describe('export progress label — pieces vs encoder sessions', () => {
  it('shows the session count alongside the piece count when the bound engaged', () => {
    // The field shape: 3 pieces, and this piece bounded into 8 sessions.
    const label = stageLabelFor(piece({ encoderSessions: 8, encoderSessionIndex: 4 }));
    expect(label).toBe('Encoding segment 2 / 3 · encoder session 5 / 8');
  });

  it('DESTRUCTIVE: a piece that planned ONE session renders with no session suffix', () => {
    // This is what a dead bound looks like — and it must be visibly different
    // from a live one, which is the entire point of this file.
    expect(stageLabelFor(piece({ encoderSessions: 1, encoderSessionIndex: 0 }))).toBe('Encoding segment 2 / 3');
    // A live bound is NOT the same string.
    expect(stageLabelFor(piece({ encoderSessions: 8, encoderSessionIndex: 0 }))).not.toBe(
      stageLabelFor(piece({ encoderSessions: 1, encoderSessionIndex: 0 })),
    );
  });

  it('an unreported plan degrades to the pre-WS3 label exactly (non-GL pieces, legacy path)', () => {
    expect(stageLabelFor(piece({}))).toBe('Encoding segment 2 / 3');
  });

  it('the piece count is UNCHANGED by the session count — they are different numbers', () => {
    const label = stageLabelFor(piece({ encoderSessions: 22, encoderSessionIndex: 21 }));
    expect(label).toContain('segment 2 / 3');
    expect(label).toContain('session 22 / 22');
  });
});
