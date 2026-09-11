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
  type ResumeRejection,
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
  kind: 'bitstream_touched' | 'budget_exhausted';
  reason: string;
  bitstreamTouched?: ResumeRejection['bitstreamTouched'];
}

function refusalNoticeFromRejections(rejected: readonly ResumeRejection[]): ResumeRefusalNotice | null {
  // Newest first (the caller passes `ordered`), so the first match is the
  // candidate THIS export would actually have tried.
  for (const r of rejected) {
    if (r.bitstreamTouched) {
      return { sessionId: r.sessionId, kind: 'bitstream_touched', reason: r.reason, bitstreamTouched: r.bitstreamTouched };
    }
    if (r.budgetExhausted) {
      return { sessionId: r.sessionId, kind: 'budget_exhausted', reason: r.reason };
    }
  }
  return null;
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
 * starts clean, which is always a correct outcome. `notice` is a SEPARATE,
 * non-blocking signal: unlike `offer`, it is never something the operator
 * answers — the export proceeds either way — but a `bitstream_touched` or
 * `budget_exhausted` refusal must still reach them (WS3 Round 12, STEP 1),
 * because both are silently indistinguishable from "nothing to resume"
 * otherwise.
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
}): Promise<{ offer: ResumeOffer | null; notice: ResumeRefusalNotice | null }> {
  const io = params.io ?? tauriIo;
  const count = params.countPicturesImpl ?? countPictures;
  const nowMs = params.nowMs ?? Date.now();

  let sessionIds: string[] = [];
  try {
    sessionIds = await io.listResumableSessionIds();
  } catch {
    return { offer: null, notice: null };
  }
  if (sessionIds.length === 0) return { offer: null, notice: null };

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
  let notice: ResumeRefusalNotice | null = null;
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
    } else {
      notice = refusalNoticeFromRejections(found.rejected);
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

  return { offer, notice };
}
