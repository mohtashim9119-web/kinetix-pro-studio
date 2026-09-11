/**
 * WS3 STEP 8 (C6) — a durable record of a session-cleanup failure so it
 * reaches the OPERATOR, not just a `console.warn` nobody reads.
 *
 * Two call sites feed this: `TauriFfmpeg.destroy()` (native
 * `ffmpeg_destroy_session` failing to remove the session directory — worse
 * on Windows, where a delete can pend behind an open file handle rather
 * than failing outright) and `muxOnly.ts`'s premux-intermediate cleanup
 * (the `${videoFile}.premux.mp4` scratch file left behind when its own
 * `deleteFile` fails). Neither failure is fatal to the export that produced
 * it — the final output is already on disk by the time either cleanup step
 * runs — so neither may block or fail the export. But a silently-orphaned
 * session directory is exactly the 1.6-2.3 GB exposure H10's orphan sweep
 * exists to reclaim, and a notice logged only to the console is invisible
 * the moment the WebView is closed. This module makes the failure durable
 * so the NEXT run — not just this one's console — can see it.
 *
 * Persisted in localStorage rather than held in memory: the failure can be
 * the very last thing an export does, after which nothing in this renderer
 * process is still running to show anything. localStorage's per-origin
 * caveats (can read back empty in a private window, never shared across
 * machines) are acceptable here — this is a best-effort operator notice,
 * not the mechanism that actually reclaims the bytes. H10's sweep reclaims
 * them on its own schedule regardless of whether this notice survives.
 */

export type CleanupNoticeKind = 'session-destroy' | 'premux-intermediate';

export interface CleanupNotice {
  kind: CleanupNoticeKind;
  sessionId: string;
  detail: string;
  atMs: number;
}

const STORAGE_KEY = 'kinetix:exportCleanupNotices:v1';

/** Bounded ring — this is housekeeping metadata, never left to grow
 *  unbounded across a long-lived install. */
export const CLEANUP_NOTICE_CAP = 20;

function hasLocalStorage(): boolean {
  try {
    return typeof localStorage !== 'undefined';
  } catch {
    return false;
  }
}

function readAll(): CleanupNotice[] {
  if (!hasLocalStorage()) return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as CleanupNotice[]) : [];
  } catch {
    return [];
  }
}

function writeAll(notices: readonly CleanupNotice[]): void {
  if (!hasLocalStorage()) return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(notices.slice(-CLEANUP_NOTICE_CAP)));
  } catch {
    // Best-effort — a private window or a full quota must not throw out of
    // a cleanup path that is itself already best-effort.
  }
}

/** Records one cleanup failure. Never throws — a notice-recording failure
 *  must not mask or replace the cleanup failure it is trying to surface. */
export function recordCleanupFailure(
  kind: CleanupNoticeKind,
  sessionId: string,
  detail: string,
  nowMs: number = Date.now(),
): void {
  try {
    const notices = readAll();
    notices.push({ kind, sessionId, detail, atMs: nowMs });
    writeAll(notices);
  } catch {
    // See writeAll's own note — recording is best-effort.
  }
}

/** Every cleanup notice recorded since the last `clearCleanupNotices()`. */
export function readCleanupNotices(): CleanupNotice[] {
  return readAll();
}

/** Clears the ledger — called once the operator-facing surface has read it,
 *  so the same notice is not shown on every subsequent export start. */
export function clearCleanupNotices(): void {
  writeAll([]);
}
