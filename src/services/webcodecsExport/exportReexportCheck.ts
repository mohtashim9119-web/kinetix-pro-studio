/**
 * WS3 Batch 2 (STEP 2) — the pre-export "does an existing checkpoint match
 * THIS timeline" check, run at Export-click time, before `ExportSettingsModal`
 * opens. Distinct from `exportResumeSession.ts`'s `findResumeOffer`, which
 * runs mid-export (after fps/resolution are already chosen) and engages the
 * native fence via `reenter` — this module only ever peeks
 * (`TauriFfmpeg.peekExportState`, 2A), never claims, never fences.
 *
 * Reuses `buildSourceTimelineHash`/`timelineIdentityFromProject` directly
 * (Ruling C) — no second hash, no duplicated comparison logic.
 */
import type { Project } from '../../types';
import {
  buildSourceTimelineHash,
  timelineIdentityFromProject,
  type ExportStateManifest,
} from './exportCheckpoint';
import { exportSessionCreatedAt } from './exportSessionLedger';

export interface ReexportCheckIo {
  listResumableSessionIds(): Promise<string[]>;
  /** Wraps `TauriFfmpeg.peekExportState` — never reenter/claim/fence. */
  peekExportState(sessionId: string): Promise<{ kind: 'found'; bytes: number[] } | { kind: 'notFound' }>;
}

export type ReexportCheckOutcome =
  | { kind: 'no-checkpoint' }
  | { kind: 'unedited'; sessionId: string; manifest: ExportStateManifest }
  | { kind: 'edited'; sessionId: string; manifest: ExportStateManifest };

/**
 * Only the single NEWEST resumable session is considered — matches
 * `findResumeOffer`'s own newest-first policy (`exportResumeSession.ts`),
 * and keeps the two-option modal's semantics simple: "the" checkpoint, not
 * "a" checkpoint chosen from a list the operator never sees.
 */
function newestSessionId(ids: readonly string[]): string | null {
  if (ids.length === 0) return null;
  const ordered = [...ids].sort((a, b) => {
    const at = exportSessionCreatedAt(a);
    const bt = exportSessionCreatedAt(b);
    if (at === bt) return a < b ? -1 : 1;
    if (at === null) return 1;
    if (bt === null) return -1;
    return bt - at;
  });
  return ordered[0] ?? null;
}

function decodeManifest(bytes: number[]): ExportStateManifest | null {
  try {
    const text = new TextDecoder().decode(new Uint8Array(bytes));
    const parsed: unknown = JSON.parse(text);
    if (
      parsed !== null &&
      typeof parsed === 'object' &&
      typeof (parsed as { sourceTimelineHash?: unknown }).sourceTimelineHash === 'string' &&
      typeof (parsed as { fps?: unknown }).fps === 'number' &&
      typeof (parsed as { width?: unknown }).width === 'number' &&
      typeof (parsed as { height?: unknown }).height === 'number'
    ) {
      return parsed as ExportStateManifest;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * `no-checkpoint` — nothing resumable exists, or the newest one's manifest
 * couldn't be read/parsed (peek's NotFound, or a shape peek did not expect —
 * both treated identically to "nothing to offer", never as an error the
 * operator sees before they've even opened export config).
 * `unedited` — the newest checkpoint's `sourceTimelineHash` matches what the
 * CURRENT project would hash to, computed with THAT checkpoint's own
 * fps/width/height (never a UI-selected value, since none has been chosen
 * yet at this point in the flow).
 * `edited` — a checkpoint exists but the hash differs.
 */
export async function checkExistingCheckpoint(
  project: Project,
  io: ReexportCheckIo,
): Promise<ReexportCheckOutcome> {
  let ids: string[] = [];
  try {
    ids = await io.listResumableSessionIds();
  } catch {
    return { kind: 'no-checkpoint' };
  }
  const sessionId = newestSessionId(ids);
  if (sessionId === null) return { kind: 'no-checkpoint' };

  let peek: { kind: 'found'; bytes: number[] } | { kind: 'notFound' };
  try {
    peek = await io.peekExportState(sessionId);
  } catch {
    return { kind: 'no-checkpoint' };
  }
  if (peek.kind === 'notFound') return { kind: 'no-checkpoint' };

  const manifest = decodeManifest(peek.bytes);
  if (manifest === null) return { kind: 'no-checkpoint' };

  const currentHash = await buildSourceTimelineHash(
    timelineIdentityFromProject(project, { fps: manifest.fps, width: manifest.width, height: manifest.height }),
  );

  return currentHash === manifest.sourceTimelineHash
    ? { kind: 'unedited', sessionId, manifest }
    : { kind: 'edited', sessionId, manifest };
}
