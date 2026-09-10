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
import {
  collectAbandonedSessions,
  discoverResumableExport,
  type ResumableExport,
  type ResumeDiscoveryIo,
  type ResumeSessionHandle,
} from './exportResumeDiscovery';
import { exportSessionCreatedAt, forgetExportSession } from './exportSessionLedger';
import { FRAME_COUNT_BOUND_MS, withFfmpegLivenessBound } from './ffmpegLivenessBound';

/** What the operator is shown, and what the pipeline needs to continue. */
export interface ResumeOffer {
  sessionId: string;
  picturesAlreadyRendered: number;
  picturesTotal: number;
  fps: number;
  /** Wall-clock seconds already rendered — what the offer actually says. */
  secondsAlreadyRendered: number;
  secondsTotal: number;
  resumable: ResumableExport;
}

const tauriIo: ResumeDiscoveryIo = {
  listResumableSessionIds: () => TauriFfmpeg.listResumableSessionIds(),
  reenter: async (sessionId) => (await TauriFfmpeg.reenter(sessionId)) as unknown as ResumeSessionHandle,
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
): Promise<ExportCheckpointExpectedIdentity> {
  return {
    projectId: project.id,
    sourceTimelineHash: await buildSourceTimelineHash(timelineIdentityFromProject(project, dims)),
    fps: dims.fps,
    width: dims.width,
    height: dims.height,
  };
}

/**
 * Looks for a resumable export for this exact timeline, then collects whatever
 * abandoned sessions the policy says should go.
 *
 * Everything here is best-effort: a failure returns "no offer" and the export
 * starts clean, which is always a correct outcome.
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
  countPicturesImpl?: (session: ResumeSessionHandle, path: string) => Promise<number>;
}): Promise<ResumeOffer | null> {
  const io = params.io ?? tauriIo;
  const count = params.countPicturesImpl ?? countPictures;
  const nowMs = params.nowMs ?? Date.now();

  let sessionIds: string[] = [];
  try {
    sessionIds = await io.listResumableSessionIds();
  } catch {
    return null;
  }
  if (sessionIds.length === 0) return null;

  // Newest first — the ledger's job. An id the ledger does not know sorts last,
  // matching the cleanup policy's own "unknown means oldest" treatment.
  const ordered = [...sessionIds].sort((a, b) => {
    const at = exportSessionCreatedAt(a);
    const bt = exportSessionCreatedAt(b);
    if (at === bt) return a < b ? -1 : 1;
    if (at === null) return 1;
    if (bt === null) return -1;
    return bt - at;
  });

  let offer: ResumeOffer | null = null;
  try {
    const expected = await buildExpectedIdentity(params.project, {
      fps: params.fps, width: params.width, height: params.height,
    });
    const found = await discoverResumableExport(
      io,
      { expected, pieceExpectedFrames: params.pieceExpectedFrames },
      count,
      ordered.filter((id) => id !== params.inUseSessionId),
    );
    if (found.resumable) {
      offer = {
        sessionId: found.resumable.sessionId,
        picturesAlreadyRendered: found.resumable.picturesAlreadyRendered,
        picturesTotal: found.resumable.picturesTotal,
        fps: params.fps,
        secondsAlreadyRendered: found.resumable.picturesAlreadyRendered / params.fps,
        secondsTotal: found.resumable.picturesTotal / params.fps,
        resumable: found.resumable,
      };
    }
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('[ws3-resume] discovery failed — starting clean', err instanceof Error ? err.message : String(err));
  }

  // A resumable session is NEVER collected while it is still resumable, and
  // neither is the session in use. Everything else goes through the policy.
  const protectedIds = [
    ...(offer ? [offer.sessionId] : []),
    ...(params.inUseSessionId ? [params.inUseSessionId] : []),
  ];
  try {
    const collected = await collectAbandonedSessions(io, {
      candidates: sessionIds.map((sessionId) => ({
        sessionId,
        createdAtMs: exportSessionCreatedAt(sessionId),
      })),
      protectedSessionIds: protectedIds,
      nowMs,
    });
    for (const id of collected) forgetExportSession(id);
  } catch {
    // Cleanup is housekeeping; it never blocks or fails an export.
  }

  return offer;
}
