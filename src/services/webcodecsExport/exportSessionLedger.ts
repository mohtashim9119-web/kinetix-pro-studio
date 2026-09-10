/**
 * When each export session directory was created.
 *
 * WS3 Round 10, Blocker 3. The cleanup policy needs an AGE, and nothing in the
 * native surface provides one: `ffmpeg_list_resumable_sessions` returns bare
 * UUIDs, v4 UUIDs carry no timestamp, and there is no command that reports a
 * directory's mtime. Rust is frozen this round, so the age is recorded on the
 * renderer side at the moment the session is created.
 *
 * This is a convenience, not a correctness input: a session the ledger has
 * forgotten (a different profile, cleared site data, or a build older than this
 * round) is treated as OLDEST by `selectSessionsToCollect`, so a missing entry
 * makes a directory MORE likely to be collected, never less. Nothing about
 * whether a session is RESUMABLE depends on this file — that is entirely the
 * manifest's `sourceTimelineHash` and the native fence.
 */
const LEDGER_KEY = 'kinetix:exportSessions:v1';
/** Ledger rows are ~50 bytes; this cap keeps a pathological history bounded. */
const MAX_LEDGER_ROWS = 64;

type Ledger = Record<string, number>;

function read(): Ledger {
  try {
    const raw = localStorage.getItem(LEDGER_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const out: Ledger = {};
    for (const [id, at] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof at === 'number' && Number.isFinite(at)) out[id] = at;
    }
    return out;
  } catch {
    return {};
  }
}

function write(ledger: Ledger): void {
  try {
    const entries = Object.entries(ledger).sort((a, b) => b[1] - a[1]).slice(0, MAX_LEDGER_ROWS);
    localStorage.setItem(LEDGER_KEY, JSON.stringify(Object.fromEntries(entries)));
  } catch {
    // A ledger that cannot be written costs precision in the cleanup policy and
    // nothing else — never an export.
  }
}

export function recordExportSessionCreated(sessionId: string, nowMs = Date.now()): void {
  if (!sessionId) return;
  const ledger = read();
  ledger[sessionId] = nowMs;
  write(ledger);
}

export function forgetExportSession(sessionId: string): void {
  const ledger = read();
  if (!(sessionId in ledger)) return;
  delete ledger[sessionId];
  write(ledger);
}

/** `null` for an id the ledger does not know — treated as oldest downstream. */
export function exportSessionCreatedAt(sessionId: string): number | null {
  return read()[sessionId] ?? null;
}
