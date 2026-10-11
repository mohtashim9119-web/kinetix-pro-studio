/**
 * The one call `useExport` makes to decide whether an export starts clean or
 * continues a crash survivor.
 *
 * WS3 Round 10, Blocker 3. This is the glue between `exportResumeDiscovery.ts`
 * (which knows how to validate and fence a candidate) and the hook (which knows
 * the project, the resolution and the operator). It deliberately owns no
 * policy of its own beyond wiring: discovery decides resumability, the cleanup
 * policy decides collection, and the operator decides which one happens.
 */
import { TauriFfmpeg } from '../tauriFfmpeg';
import type { Project } from '../../types';
import {
  buildSourceTimelineHash,
  timelineIdentityFromProject,
  type ExportCheckpointExpectedIdentity,
} from './exportCheckpoint';
import { logExportEvent } from '../exportDiagnosticLog';
import {
  adoptRankedResume,
  collectAbandonedSessions,
  rankResumeCandidates,
  selectSessionsToCollect,
  type ResumableExport,
  type ResumeAdoptIo,
  type ResumeCandidate,
  type ResumeDiscoveryIo,
  type ResumeRejection,
  type ResumeSessionHandle,
  type ResumeTargetPlan,
} from './exportResumeDiscovery';
import {
  exportSessionCreatedAt,
  exportSessionProjectId,
  forgetExportSession,
  recordExportSessionProject,
} from './exportSessionLedger';
import { FRAME_COUNT_BOUND_MS, withFfmpegLivenessBound } from './ffmpegLivenessBound';

/**
 * What the operator is shown. Built read-only (Phase A): nothing about the
 * session has been claimed, fenced or cut. `adoptResumeOffer` does that, and
 * only once the operator has answered Resume.
 */
export interface ResumeOffer {
  sessionId: string;
  picturesAlreadyRendered: number;
  picturesTotal: number;
  fps: number;
  /** Wall-clock seconds already rendered — what the offer actually says. */
  secondsAlreadyRendered: number;
  secondsTotal: number;
  /** Phase A's pick: the furthest-progress valid candidate. */
  candidate: ResumeCandidate;
  /** Phase A's whole ranking, the pick first — what adoption falls through. */
  ranked: readonly ResumeCandidate[];
  /** The plan the ranking was made against; adoption re-validates against it. */
  target: ResumeTargetPlan;
  /**
   * WS3 STEP 8 (H5) — mirrors `candidate.staleClaim`. True means
   * this session's own prior holder process crashed (its claim read
   * `stale`) rather than exited cleanly, so the offer UI must show a
   * "recovering an abandoned session" notice — DIFFERENT wording from the
   * ordinary resume-offer text, because it tells the operator something
   * actually went wrong last time, not just that they closed the app mid-export.
   */
  claimRecoveryNotice: boolean;
}

/**
 * A resume was refused for a reason the operator needs to hear, distinct
 * from the ordinary "nothing to resume" silence — WS3 Round 12, STEP 1.
 * `bitstream_touched` means a surviving file was cut before the refusal;
 * `budget_exhausted` means recovery attempts on that timeline are spent.
 * Every other rejection reason (identity mismatch, corrupt manifest, no
 * checkpoint fits) is the ordinary, silent "start clean" case and is not
 * surfaced — it is not evidence of anything gone wrong.
 */
export interface ResumeRefusalNotice {
  sessionId: string;
  kind: 'bitstream_touched' | 'budget_exhausted' | 'live_claim_blocked' | 'never_checkpointed' | 'no_checkpoint_yet';
  reason: string;
  bitstreamTouched?: ResumeRejection['bitstreamTouched'];
}

function refusalNoticeFromRejections(rejected: readonly ResumeRejection[]): ResumeRefusalNotice | null {
  // In the order the candidates were inspected: the first match is the one
  // the operator is told about.
  for (const r of rejected) {
    // WS3 STEP 8 (H5) — checked first: a live-claim block is decided before
    // `reenter` is even attempted, so it is the most specific signal
    // available for this candidate and should never be shadowed by a
    // coincidental bitstream/budget rejection on some OTHER candidate later
    // in the list.
    if (r.liveClaimBlocked) {
      return { sessionId: r.sessionId, kind: 'live_claim_blocked', reason: r.reason };
    }
    if (r.bitstreamTouched) {
      return { sessionId: r.sessionId, kind: 'bitstream_touched', reason: r.reason, bitstreamTouched: r.bitstreamTouched };
    }
    if (r.budgetExhausted) {
      return { sessionId: r.sessionId, kind: 'budget_exhausted', reason: r.reason };
    }
    // WS3 STEP 9 (C7) — the checkpoint-coverage gap: this export rotated
    // but never durably checkpointed. See ResumeRejection.neverCheckpointed.
    if (r.neverCheckpointed) {
      return { sessionId: r.sessionId, kind: 'never_checkpointed', reason: r.reason };
    }
    // The survivor is this timeline's, but it was interrupted before anything
    // was recorded: the export restarts from the beginning, and says so.
    if (r.noCheckpointYet) {
      return { sessionId: r.sessionId, kind: 'no_checkpoint_yet', reason: r.reason };
    }
  }
  return null;
}

const tauriIo: ResumeDiscoveryIo = {
  listResumableSessionIds: () => TauriFfmpeg.listResumableSessionIds(),
  // Phase A (the offer) — neither takes a claim nor checks the fence.
  peekExportState: (sessionId) => TauriFfmpeg.peekExportState(sessionId),
  peekSessionFileSize: (sessionId, path) => TauriFfmpeg.peekSessionFileSize(sessionId, path),
  reenter: async (sessionId) => (await TauriFfmpeg.reenter(sessionId)) as unknown as ResumeSessionHandle,
  // WS3 STEP 8 (H5) — read-only, does not take the claim. Wires the native
  // `ffmpeg_read_session_claim` command (already merged, STEP 3) into
  // discovery's claim-aware reentry check.
  readSessionClaim: (sessionId) => TauriFfmpeg.readSessionClaim(sessionId),
};

/** Every native count here is bounded — a resume is a recovery path (Rung 0). */
const countPictures = async (session: ResumeSessionHandle, path: string): Promise<number> => {
  const ffmpeg = session as unknown as {
    countAnnexbFrames(p: string): Promise<{ pictures: number }>;
    kill(): Promise<void>;
  };
  const measured = await withFfmpegLivenessBound(
    { label: 'FRAME_COUNT_BOUND_MS', boundMs: FRAME_COUNT_BOUND_MS, ffmpeg, files: [path] },
    async () => await ffmpeg.countAnnexbFrames(path),
  );
  return measured.pictures;
};

export async function buildExpectedIdentity(
  project: Project,
  dims: { fps: number; width: number; height: number },
  extras?: { spotRenderSpecs?: import('./spotRenderSpec').SpotRenderSpec[] | null },
): Promise<ExportCheckpointExpectedIdentity> {
  return {
    projectId: project.id,
    sourceTimelineHash: await buildSourceTimelineHash(timelineIdentityFromProject(project, dims, extras)),
    fps: dims.fps,
    width: dims.width,
    height: dims.height,
  };
}

/**
 * Looks for a resumable export for this exact timeline, then collects whatever
 * abandoned sessions the policy says should go.
 *
 * READ-ONLY with respect to every candidate (Phase A, `rankResumeCandidates`):
 * no claim is taken, no fence is armed, no byte is cut. Cancelling at the
 * prompt therefore leaves every session exactly as it was, and the next pass
 * in the same app run makes the same offer. The collector is the one part
 * that destroys anything, and only sessions the policy selects — never the
 * offer, never `inUseSessionId`, never one a live claim holds (C3).
 *
 * Everything here is best-effort: a failure returns "no offer" and the export
 * starts clean, which is always a correct outcome. `notice` is a SEPARATE,
 * non-blocking signal the operator never answers.
 */
export async function findResumeOffer(params: {
  project: Project;
  fps: number;
  width: number;
  height: number;
  pieceExpectedFrames: readonly number[];
  /** The freshly created session, if one already exists — never collected. */
  inUseSessionId?: string;
  nowMs?: number;
  io?: ResumeDiscoveryIo;
  spotRenderSpecs?: import('./spotRenderSpec').SpotRenderSpec[] | null;
  /** Who else still needs which sessions — the collector skips them. */
  interests?: import('./exportInterestRegistry').ExportInterestView;
  /** This export's owner name in `interests` (a bulk row passes 'bulk'). */
  interestOwner?: string;
  /** Receives one line per session disposition (default: the diagnostic log). */
  logDisposition?: (line: string) => void;
}): Promise<{ offer: ResumeOffer | null; notice: ResumeRefusalNotice | null }> {
  const io = params.io ?? tauriIo;
  const logLine = params.logDisposition ?? ((line: string) => logExportEvent('session-disposition', line));
  const projectId = params.project.id;
  const disposition = (sessionId: string, what: string, reason: string): void =>
    logLine(`disposition=${what} projectId=${projectId} sessionId=${sessionId} reason=${reason}`);
  const nowMs = params.nowMs ?? Date.now();

  let sessionIds: string[] = [];
  try {
    sessionIds = await io.listResumableSessionIds();
  } catch {
    return { offer: null, notice: null };
  }
  if (sessionIds.length === 0) return { offer: null, notice: null };

  // PROJECT SCOPE. This export only ever inspects, ranks, adopts or collects
  // its OWN project's sessions; another project's are invisible to it.
  const ownSessionIds = await sessionsOfProject(io, sessionIds, params.project.id);

  let offer: ResumeOffer | null = null;
  let notice: ResumeRefusalNotice | null = null;
  /** This project's sessions the recovery budget refused this pass. */
  let budgetRefused: string[] = [];
  try {
    const expected = await buildExpectedIdentity(params.project, {
      fps: params.fps, width: params.width, height: params.height,
    }, { spotRenderSpecs: params.spotRenderSpecs });
    const target: ResumeTargetPlan = { expected, pieceExpectedFrames: params.pieceExpectedFrames };
    const { ranked, rejected } = await rankResumeCandidates(
      io,
      target,
      ownSessionIds.filter((id) => id !== params.inUseSessionId),
      exportSessionCreatedAt,
    );
    // The budget is checked only after identity (`validateExportState`), so a
    // budget refusal is always THIS project's session on THIS timeline.
    budgetRefused = rejected.filter((r) => r.budgetExhausted).map((r) => r.sessionId);
    const best = ranked[0];
    if (best) {
      offer = {
        sessionId: best.sessionId,
        picturesAlreadyRendered: best.projectedPicturesRendered,
        picturesTotal: best.picturesTotal,
        fps: params.fps,
        secondsAlreadyRendered: best.projectedPicturesRendered / params.fps,
        secondsTotal: best.picturesTotal / params.fps,
        candidate: best,
        ranked,
        target,
        claimRecoveryNotice: best.staleClaim,
      };
    } else {
      notice = refusalNoticeFromRejections(rejected);
    }
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('[ws3-resume] discovery failed — starting clean', err instanceof Error ? err.message : String(err));
  }

  // A resumable session is NEVER collected while it is still resumable, and
  // neither is the session in use. A session the recovery budget just refused
  // is kept too: it is this project's record of why the export restarts, and
  // deleting it in the same pass would erase that evidence. Everything else
  // goes through the policy.
  //
  // Cleanup is per project too (P2), and skips whatever another owner still
  // needs (P3): every session it has published, and — when another owner (a
  // bulk row) has interest in this project — all of this project's sessions.
  const protectedIds = [
    ...(offer ? [offer.sessionId] : []),
    ...(params.inUseSessionId ? [params.inUseSessionId] : []),
    ...budgetRefused,
    ...(params.interests?.protectedSessionIds() ?? []),
  ];
  const projectHeldElsewhere = params.interests?.heldByOther(params.project.id, params.interestOwner) === true;
  const reasonKept = (id: string): string | null => {
    if (projectHeldElsewhere) return 'another owner still needs this project (bulk row queued, running or awaiting Retry)';
    if (offer?.sessionId === id) return 'offered for resume';
    if (id === params.inUseSessionId) return 'in use by this export';
    if (budgetRefused.includes(id)) return 'refused by the recovery budget this pass — kept as the record of why';
    if (params.interests?.protectedSessionIds().has(id)) return 'another run is using it';
    if (exportSessionCreatedAt(id) === null) return 'age unknown — nothing proves it abandoned';
    return null;
  };
  try {
    const candidates = ownSessionIds.map((sessionId) => ({ sessionId, createdAtMs: exportSessionCreatedAt(sessionId) }));
    for (const c of candidates) {
      const why = reasonKept(c.sessionId);
      if (why) disposition(c.sessionId, 'kept', why);
    }
    const policy = { candidates, protectedSessionIds: protectedIds, nowMs };
    const doomed = projectHeldElsewhere ? [] : selectSessionsToCollect(policy);
    for (const c of candidates) {
      if (!reasonKept(c.sessionId) && !doomed.includes(c.sessionId)) disposition(c.sessionId, 'kept', 'within the project\'s retention cap and TTL');
    }
    const collected = projectHeldElsewhere ? [] : await collectAbandonedSessions(io, {
      ...policy,
      onDisposition: (id, what, reason) => disposition(id, what, reason),
    });
    for (const id of collected) forgetExportSession(id);
    // A collected session is gone: adoption must not fall through to it.
    if (offer && collected.length > 0) {
      offer = { ...offer, ranked: offer.ranked.filter((c) => !collected.includes(c.sessionId)) };
    }
  } catch {
    // Cleanup is housekeeping; it never blocks or fails an export.
  }

  return { offer, notice };
}

/**
 * Which of `sessionIds` belong to `projectId`, from the ledger's project
 * column. A session the ledger has no project for (written by a build older
 * than that column, or after site data was cleared) is identified ONCE from
 * its manifest — a read-only peek, no claim, no rank — and the answer is
 * stamped so no later pass reads it again. Its identity is the only thing
 * read; a foreign session found this way is dropped like any other.
 */
async function sessionsOfProject(io: ResumeDiscoveryIo, sessionIds: readonly string[], projectId: string): Promise<string[]> {
  const own: string[] = [];
  for (const id of sessionIds) {
    let owner = exportSessionProjectId(id);
    if (owner === null) {
      owner = await identifyProject(io, id);
      if (owner !== null) recordExportSessionProject(id, owner);
    }
    if (owner === projectId) own.push(id);
  }
  return own;
}

async function identifyProject(io: ResumeDiscoveryIo, sessionId: string): Promise<string | null> {
  try {
    const peek = await io.peekExportState(sessionId);
    if (peek.kind !== 'found') return null;
    const parsed: unknown = JSON.parse(new TextDecoder().decode(new Uint8Array(peek.bytes)));
    const projectId = (parsed as { projectId?: unknown } | null)?.projectId;
    return typeof projectId === 'string' && projectId.length > 0 ? projectId : null;
  } catch {
    return null;
  }
}

/**
 * Phase B — call ONLY after the operator answered Resume. Re-enters, arms,
 * fences (or clears) and steps back to the seam on the offered session; if
 * that fails, on the next candidate of the offer's ranking, and so on
 * (`adoptRankedResume`). `resumable` is null when none survived; `notice`
 * then carries the reason the operator must hear (a bitstream cut before a
 * refusal, an exhausted budget), exactly as discovery reported it before the
 * two phases were split.
 */
export async function adoptResumeOffer(
  offer: ResumeOffer,
  params: {
    io?: ResumeAdoptIo;
    countPicturesImpl?: (session: ResumeSessionHandle, path: string) => Promise<number>;
  } = {},
): Promise<{ resumable: ResumableExport | null; rejected: ResumeRejection[]; notice: ResumeRefusalNotice | null }> {
  const io = params.io ?? tauriIo;
  const count = params.countPicturesImpl ?? countPictures;
  const adopted = await adoptRankedResume(io, offer.ranked, offer.target, count);
  return {
    resumable: adopted.resumable,
    rejected: adopted.rejected,
    notice: adopted.resumable ? null : refusalNoticeFromRejections(adopted.rejected),
  };
}
