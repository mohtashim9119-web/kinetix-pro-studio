import type { RetainForResumeReport } from '../services/tauriFfmpeg';

export interface RetainableSession {
  retainForResume?(): Promise<RetainForResumeReport>;
}

/**
 * STEP 3b — the ONE decision for what happens to the session directory a
 * FAILED export ran in. Extracted from `useExport.ts`'s `runExport` so the
 * reported Machine 1 defect — a mux-stage failure at 93% wiped a fully
 * rendered piece and its closing checkpoint, because only `kind ===
 * 'disk_full'` used to reach this decision — can be exercised directly
 * against a real `retainForResume` semantics fake, without a React render
 * harness.
 *
 * Called for EVERY failure kind now, not just `disk_full`: `retainForResume`
 * is itself the correct decision regardless of why the export failed — no
 * manifest ⇒ it destroys outright (identical bytes freed as an
 * unconditional destroy would have, which is what every non-disk_full
 * failure did before this step), a live foreign claim ⇒ it refuses and
 * leaves the directory untouched, a manifest ⇒ it retains the pieces and
 * drops only the mux/delivery intermediates a resume does not need.
 *
 * Returns `null` only when `active` doesn't expose `retainForResume` at all
 * (a bare test fake, or a future ffmpeg-like surface that hasn't grown it
 * yet) — the caller must then fall back to an ordinary GUARDED destroy,
 * which `ffmpeg_destroy_session`'s own native manifest guard backstops.
 */
export async function decideSessionRetentionOnFailure(
  active: RetainableSession | null,
): Promise<RetainForResumeReport | null> {
  if (!active?.retainForResume) return null;
  return active.retainForResume();
}
