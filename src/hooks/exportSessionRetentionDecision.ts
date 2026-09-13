import type { RetainForResumeReport } from '../services/tauriFfmpeg';
import type { ExportError } from '../services/exportPipeline';

export interface RetainableSession {
  retainForResume?(failureKind?: string): Promise<RetainForResumeReport>;
}

/**
 * WS3 item F — builds the opaque string `failureKind` value the native log
 * ultimately receives, from a failed export's `ExportError`. Extracted (same
 * reasoning as `decideSessionRetentionOnFailure` above) so the exact string
 * shape is exercised directly, without a React render harness.
 *
 * `kind` alone collapsed every liveness-bound expiry (watchdog, stall,
 * append-drain-stall, append-queue-overflow) to the same value — before item
 * F that value was `'unknown'` (see `FAILURE_VIA_TO_KIND` in
 * `exportWorkerDiagnostics.ts` for why it is now `'encode'`), and even
 * `'encode'` alone still cannot tell the four bounds apart from each other.
 * `via` is the piece that can, so it is appended whenever present:
 * `"encode:watchdog"`, `"encode:append-drain-stall"`, etc. A failure with no
 * `liveness.failureVia` (most non-bound failures) is unchanged — just
 * `kind` on its own, exactly as before this item.
 */
export function buildNativeFailureKind(error: Pick<ExportError, 'kind' | 'liveness'>): string {
  const via = error.liveness?.failureVia;
  return via ? `${error.kind}:${via}` : error.kind;
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
 *
 * WS3 (diagnostic logging) — `failureKind` (the caller's `ExportError.kind`,
 * as of item F suffixed `:<via>` when `ExportError.liveness?.failureVia` is
 * present — see `useExport.ts`'s own construction of this string) is passed
 * through to `retainForResume` opaquely; it reaches the opt-in native log
 * (`ffmpeg_retain_session_for_resume`'s doc comment) only and never changes
 * this function's own decision.
 */
export async function decideSessionRetentionOnFailure(
  active: RetainableSession | null,
  failureKind?: string,
): Promise<RetainForResumeReport | null> {
  if (!active?.retainForResume) return null;
  return active.retainForResume(failureKind);
}
