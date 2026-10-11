/**
 * When each export session directory was created, and which project it is for.
 *
 * WS3 Round 10, Blocker 3. The cleanup policy needs an AGE, and nothing in the
 * native surface provides one: `ffmpeg_list_resumable_sessions` returns bare
 * UUIDs, v4 UUIDs carry no timestamp, and there is no command that reports a
 * directory's mtime. The age is recorded on the renderer side at the moment
 * the session is created.
 *
 * The PROJECT is recorded too, so discovery and cleanup can be scoped to one
 * project without reading another project's manifest. A session the ledger
 * does not know (a build older than this field, cleared site data) has its
 * project identified once from its manifest and stamped here.
 *
 * An unknown AGE is never a reason to delete (`selectSessionsToCollect`): the
 * collector only removes what it can prove is old. Nothing about whether a
 * session is RESUMABLE depends on this file — that is entirely the manifest's
 * `sourceTimelineHash` and the native fence.
 *
 * Rows: legacy rows are a bare number (the creation time); current rows are
 * `{ at?, projectId? }`. Both are read.
 */
const LEDGER_KEY = 'kinetix:exportSessions:v1';
/** Ledger rows are ~100 bytes; this cap keeps a pathological history bounded. */
const MAX_LEDGER_ROWS = 64;

interface Row { at?: number; projectId?: string }
type Ledger = Record<string, Row>;

function read(): Ledger {
  try {
    const raw = localStorage.getItem(LEDGER_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const out: Ledger = {};
    for (const [id, v] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof v === 'number' && Number.isFinite(v)) {
        out[id] = { at: v };
      } else if (v !== null && typeof v === 'object') {
        const r = v as { at?: unknown; projectId?: unknown };
        const row: Row = {};
        if (typeof r.at === 'number' && Number.isFinite(r.at)) row.at = r.at;
        if (typeof r.projectId === 'string' && r.projectId.length > 0) row.projectId = r.projectId;
        if (row.at !== undefined || row.projectId !== undefined) out[id] = row;
      }
    }
    return out;
  } catch {
    return {};
  }
}

function write(ledger: Ledger): void {
  try {
    // Newest first; rows with no known age sort last, so they are the first
    // dropped at the cap (dropping one costs a re-identification, nothing more).
    const entries = Object.entries(ledger)
      .sort((a, b) => (b[1].at ?? -Infinity) - (a[1].at ?? -Infinity))
      .slice(0, MAX_LEDGER_ROWS);
    localStorage.setItem(LEDGER_KEY, JSON.stringify(Object.fromEntries(entries)));
  } catch {
    // A ledger that cannot be written costs precision in the cleanup policy and
    // nothing else — never an export.
  }
}

export function recordExportSessionCreated(sessionId: string, nowMs = Date.now(), projectId?: string): void {
  if (!sessionId) return;
  const ledger = read();
  ledger[sessionId] = {
    ...ledger[sessionId],
    ...(Number.isFinite(nowMs) ? { at: nowMs } : {}),
    ...(projectId ? { projectId } : {}),
  };
  write(ledger);
}

/** Stamps the project a session belongs to, keeping any age already recorded. */
export function recordExportSessionProject(sessionId: string, projectId: string): void {
  if (!sessionId || !projectId) return;
  const ledger = read();
  ledger[sessionId] = { ...ledger[sessionId], projectId };
  write(ledger);
}

export function forgetExportSession(sessionId: string): void {
  const ledger = read();
  if (!(sessionId in ledger)) return;
  delete ledger[sessionId];
  write(ledger);
}

/** `null` for an id whose age the ledger does not know — never collected on age. */
export function exportSessionCreatedAt(sessionId: string): number | null {
  return read()[sessionId]?.at ?? null;
}

/** `null` for an id whose project the ledger does not know. */
export function exportSessionProjectId(sessionId: string): string | null {
  return read()[sessionId]?.projectId ?? null;
}
