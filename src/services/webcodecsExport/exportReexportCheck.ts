/**
 * WS3 Batch 2 (STEP 2) — the pre-export "does an existing checkpoint match
 * THIS timeline" check, run at Export-click time, before `ExportSettingsModal`
 * opens. Distinct from `exportResumeSession.ts`'s `findResumeOffer`, which
 * runs mid-export (after fps/resolution are already chosen) and ranks every
 * candidate by progress (read-only too; only `adoptResumeOffer`, after the
 * operator chose Resume, engages the native fence via `reenter`) — this
 * module only ever peeks
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
import type { SpotRenderSpec } from './spotRenderSpec';

export interface ReexportCheckIo {
  listResumableSessionIds(): Promise<string[]>;
  /** Wraps `TauriFfmpeg.peekExportState` — never reenter/claim/fence. */
  peekExportState(sessionId: string): Promise<{ kind: 'found'; bytes: number[] } | { kind: 'notFound' }>;
}

/**
 * The hash ingredients beyond the project itself. REQUIRED, so every caller
 * states the spot specs: the checkpoint writer hashes WITH them
 * (`exportPipelineWebCodecs.ts`), and a check that hashes without them reads a
 * spotted project's own valid checkpoint as `edited` — which the Export click
 * then purges.
 */
export interface ReexportCheckExtras {
  spotRenderSpecs: SpotRenderSpec[] | null | undefined;
}

export type ReexportCheckOutcome =
  | { kind: 'no-checkpoint' }
  | { kind: 'unedited'; sessionId: string; manifest: ExportStateManifest }
  | { kind: 'edited'; sessionId: string; manifest: ExportStateManifest };

/**
 * Newest first. NOT `findResumeOffer`'s order any more — that offer ranks by
 * furthest progress (`rankResumeCandidates`). `checkExistingCheckpoint` takes the newest one
 * that belongs to the project, keeping the two-option modal's semantics
 * simple: "the" checkpoint, not "a" checkpoint chosen from a list the operator
 * never sees.
 */
function newestFirst(ids: readonly string[]): string[] {
  return [...ids].sort((a, b) => {
    const at = exportSessionCreatedAt(a);
    const bt = exportSessionCreatedAt(b);
    if (at === bt) return a < b ? -1 : 1;
    if (at === null) return 1;
    if (bt === null) return -1;
    return bt - at;
  });
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
 * `no-checkpoint` — no resumable session belongs to this project, or its
 * manifest couldn't be read/parsed (peek's NotFound, or a shape peek did not
 * expect — both treated identically to "nothing to offer", never as an error
 * the operator sees before they've even opened export config).
 * `unedited` — this project's newest checkpoint's `sourceTimelineHash`
 * matches what the CURRENT project would hash to, computed with THAT
 * checkpoint's own fps/width/height (never a UI-selected value, since none has
 * been chosen yet at this point in the flow).
 * `edited` — this project's checkpoint exists but the hash differs.
 *
 * Another project's session is never considered: its `projectId` is part of
 * the hashed identity, so it would always read `edited` — and be purged.
 */
export async function checkExistingCheckpoint(
  project: Project,
  io: ReexportCheckIo,
  extras: ReexportCheckExtras,
): Promise<ReexportCheckOutcome> {
  let ids: string[] = [];
  try {
    ids = await io.listResumableSessionIds();
  } catch {
    return { kind: 'no-checkpoint' };
  }

  for (const sessionId of newestFirst(ids)) {
    let peek: { kind: 'found'; bytes: number[] } | { kind: 'notFound' };
    try {
      peek = await io.peekExportState(sessionId);
    } catch {
      continue;
    }
    if (peek.kind === 'notFound') continue;
    const manifest = decodeManifest(peek.bytes);
    if (manifest === null || manifest.projectId !== project.id) continue;

    const currentHash = await buildSourceTimelineHash(
      timelineIdentityFromProject(
        project,
        { fps: manifest.fps, width: manifest.width, height: manifest.height },
        extras,
      ),
    );
    return currentHash === manifest.sourceTimelineHash
      ? { kind: 'unedited', sessionId, manifest }
      : { kind: 'edited', sessionId, manifest };
  }
  return { kind: 'no-checkpoint' };
}

export interface CheckpointPurgeIo {
  /** Read-only claim inspection (`TauriFfmpeg.readSessionClaim`). */
  readSessionClaim(sessionId: string): Promise<{ holderLiveness: 'live' | 'stale' | 'unclaimed' }>;
  reenter(sessionId: string): Promise<{ destroy(opts: { force: boolean; failureKind: string }): Promise<unknown> }>;
}

export type CheckpointPurgeOutcome =
  | { kind: 'purged'; sessionId: string }
  | { kind: 'skipped-live-claim'; sessionId: string }
  | { kind: 'failed'; sessionId: string; reason: string };

/**
 * Discards a checkpoint session — forced, it is meant to go. Never one whose
 * claim reads `live`: a live claim may be a run using it right now. That
 * check is CONSERVATIVE: this process also keeps claims on sessions no run is
 * using (C1b's post-fence holds, a cancel that lands during adoption), and
 * those are skipped too until a restart makes the claim stale. Skipping
 * is the intended failure direction.
 */
export async function purgeCheckpointSession(
  sessionId: string,
  failureKind: string,
  io: CheckpointPurgeIo,
): Promise<CheckpointPurgeOutcome> {
  try {
    const claim = await io.readSessionClaim(sessionId);
    if (claim.holderLiveness === 'live') return { kind: 'skipped-live-claim', sessionId };
    const handle = await io.reenter(sessionId);
    await handle.destroy({ force: true, failureKind });
    return { kind: 'purged', sessionId };
  } catch (err) {
    return { kind: 'failed', sessionId, reason: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * The Export-click check: what the newest checkpoint of this project says,
 * and — only for `edited` — the auto-purge of exactly that session.
 */
export async function resolveReexportCheckpoint(
  project: Project,
  io: ReexportCheckIo & CheckpointPurgeIo,
  extras: ReexportCheckExtras,
): Promise<{ outcome: ReexportCheckOutcome; purge: CheckpointPurgeOutcome | null }> {
  const outcome = await checkExistingCheckpoint(project, io, extras);
  if (outcome.kind !== 'edited') return { outcome, purge: null };
  return { outcome, purge: await purgeCheckpointSession(outcome.sessionId, 'timeline-edited-auto-purge', io) };
}

/** A manifest that actually records something to resume from. */
export function hasUsableResumePoint(manifest: ExportStateManifest): boolean {
  return (Array.isArray(manifest.checkpoints) && manifest.checkpoints.length > 0) || (manifest.completedPieces ?? 0) > 0;
}

/**
 * Bulk Retry's question: does ANY surviving session hold a usable resume point
 * for exactly this timeline? Unlike `checkExistingCheckpoint` (the single
 * export's two-option modal, which only ever considers the newest session),
 * this scans newest-first, so another project's newer cancelled session cannot
 * hide this project's own — and an empty manifest (nothing recorded yet) is
 * not a checkpoint.
 */
export async function findUsableCheckpoint(
  project: Project,
  io: ReexportCheckIo,
  extras?: { spotRenderSpecs?: import('./spotRenderSpec').SpotRenderSpec[] | null },
): Promise<{ sessionId: string; manifest: ExportStateManifest } | null> {
  let ids: string[] = [];
  try {
    ids = await io.listResumableSessionIds();
  } catch {
    return null;
  }
  const ordered = [...ids].sort((a, b) => {
    const at = exportSessionCreatedAt(a);
    const bt = exportSessionCreatedAt(b);
    if (at === bt) return a < b ? -1 : 1;
    if (at === null) return 1;
    if (bt === null) return -1;
    return bt - at;
  });
  for (const sessionId of ordered) {
    let peek: { kind: 'found'; bytes: number[] } | { kind: 'notFound' };
    try {
      peek = await io.peekExportState(sessionId);
    } catch {
      continue;
    }
    if (peek.kind === 'notFound') continue;
    const manifest = decodeManifest(peek.bytes);
    if (manifest === null || manifest.projectId !== project.id || !hasUsableResumePoint(manifest)) continue;
    const currentHash = await buildSourceTimelineHash(
      timelineIdentityFromProject(project, { fps: manifest.fps, width: manifest.width, height: manifest.height }, extras),
    );
    if (currentHash === manifest.sourceTimelineHash) return { sessionId, manifest };
  }
  return null;
}
