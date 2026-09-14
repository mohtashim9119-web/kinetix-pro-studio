/**
 * WS3 Round 28 (D1) — the ONE decision for what happens when the operator
 * has explicitly chosen "Resume" on a discovered offer, and the second,
 * adopting `reenter` call (`useExport.ts`'s own re-entry, distinct from the
 * read-only one `discoverResumableExport` already performed while building
 * the offer) either succeeds or fails.
 *
 * Field evidence (Machine 1, build 831c872, `docs/STATUS.md`): a retained
 * session (manifest present, one complete piece, 1,078,402,941 bytes) was
 * discovered, offered, and the operator pressed Resume — and the app started
 * a BRAND NEW session folder and failed anyway. Before this module,
 * `useExport.ts` caught a failed adoption `reenter` and silently fell back
 * to the already-created fresh scratch session — exactly this shape: the
 * operator's explicit choice was discarded with no error, and the export
 * proceeded as if they had chosen "Start Clean". `decideResumeAdoptionOutcome`
 * is the pure extraction of "what should happen instead" — refuse outright,
 * with a specific message — so it can be exercised directly, without a React
 * render harness, mirroring `exportSessionRetentionDecision.ts`'s own reason
 * for existing.
 *
 * Extracted deliberately: adopting a resumed session must never be a
 * best-effort fallback. A `clean` choice legitimately has nothing to adopt.
 * A `resume` choice names a directory the operator was just shown as
 * resumable — if it can no longer be adopted, that is new information they
 * must see, not a silent substitution.
 */
export interface ResumeAdoptionFailure {
  kind: 'resume_adoption_failed';
  message: string;
}

/**
 * `reenterError` is `null` when the adopting `reenter` call succeeded (or
 * was never attempted because the operator chose `clean`). Non-null carries
 * the thrown error's message. Returns `null` when there is nothing to
 * decide (a `clean` choice, or a successful `resume` adoption) — the caller
 * proceeds exactly as it already does in that case.
 */
export function decideResumeAdoptionOutcome(params: {
  choice: 'resume' | 'clean';
  sessionId: string;
  reenterError: string | null;
}): ResumeAdoptionFailure | null {
  if (params.choice !== 'resume') return null;
  if (params.reenterError === null) return null;
  return {
    kind: 'resume_adoption_failed',
    message:
      `Could not resume the retained export session (${params.sessionId}): ${params.reenterError}. ` +
      'Nothing was overwritten — no export ran. Try again; if this keeps happening, choose "Start Clean" ' +
      'to begin a new export, or check that the session\'s temp directory still exists and is writable.',
  };
}
