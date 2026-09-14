/**
 * WS3 Round 28 (D1) — red-then-green coverage for
 * `decideResumeAdoptionOutcome`.
 *
 * Field shape being guarded against (Machine 1, build 831c872): the operator
 * pressed Resume on a discovered offer; the app minted a brand new session
 * folder and failed anyway, with no error telling the operator their choice
 * was silently discarded. Before this module existed, `useExport.ts` caught
 * a failed adopting `reenter()` call and just proceeded with the
 * already-created fresh scratch session — exactly this shape.
 */
import { describe, it, expect } from 'vitest';
import { decideResumeAdoptionOutcome } from './exportResumeAdoptionDecision';

const SESSION_ID = '3f2504e0-4f89-41d3-9a0c-0305e82c3301';

describe('decideResumeAdoptionOutcome', () => {
  it('a "clean" choice never produces a failure, regardless of reenterError', () => {
    expect(
      decideResumeAdoptionOutcome({ choice: 'clean', sessionId: SESSION_ID, reenterError: 'anything' }),
    ).toBeNull();
    expect(
      decideResumeAdoptionOutcome({ choice: 'clean', sessionId: SESSION_ID, reenterError: null }),
    ).toBeNull();
  });

  it('a "resume" choice with a successful adoption (reenterError: null) produces no failure', () => {
    expect(
      decideResumeAdoptionOutcome({ choice: 'resume', sessionId: SESSION_ID, reenterError: null }),
    ).toBeNull();
  });

  it('MACHINE 1 SHAPE — manifest missing on the retained dir: "resume" + an adoption error refuses cleanly, naming the session', () => {
    const outcome = decideResumeAdoptionOutcome({
      choice: 'resume',
      sessionId: SESSION_ID,
      reenterError: 'reenter_session: export_state.json is missing',
    });
    expect(outcome).not.toBeNull();
    expect(outcome!.kind).toBe('resume_adoption_failed');
    // The message must name the session and the underlying reason — a
    // generic "something went wrong" would leave the operator unable to
    // tell this apart from any other failure.
    expect(outcome!.message).toContain(SESSION_ID);
    expect(outcome!.message).toContain('export_state.json is missing');
    // And it must say plainly that nothing was overwritten/re-rendered —
    // the whole point of refusing instead of silently substituting a fresh
    // session.
    expect(outcome!.message.toLowerCase()).toContain('nothing was overwritten');
  });

  it('manifest present but the directory itself is gone: refuses cleanly with that specific reason', () => {
    const outcome = decideResumeAdoptionOutcome({
      choice: 'resume',
      sessionId: SESSION_ID,
      reenterError: 'reenter_session: session directory does not exist: <session-temp-dir>/kinetix-export-xyz',
    });
    expect(outcome).not.toBeNull();
    expect(outcome!.kind).toBe('resume_adoption_failed');
    expect(outcome!.message).toContain('session directory does not exist');
  });

  it('never silently returns a "start clean" instruction — the caller has exactly two outcomes: null (proceed as already decided) or a typed refusal', () => {
    const outcome = decideResumeAdoptionOutcome({
      choice: 'resume',
      sessionId: SESSION_ID,
      reenterError: 'anything at all',
    });
    // The type system already enforces this (ResumeAdoptionFailure | null),
    // but pin the actual shape so a future refactor that adds a third,
    // silent-fallback branch is caught here rather than only by review.
    expect(outcome === null || outcome!.kind === 'resume_adoption_failed').toBe(true);
  });
});
