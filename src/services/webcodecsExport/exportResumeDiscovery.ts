/**
 * Finding a crash-surviving export, proving it is safe to continue, and
 * collecting the ones that are not.
 *
 * WS3 Round 10, Blocker 3. Cursor's `exportCheckpoint.ts` owns manifest
 * writing, validation, and the native pre-append fence. It has no way to FIND a
 * session: `ffmpeg_create_session` mints a fresh UUID under
 * `$TMPDIR/kinetix-export-<uuid>/` and the renderer forgets it when the app
 * closes. This module is the discovery half.
 *
 * WHAT IT GUARANTEES, IN ORDER, PER CANDIDATE:
 *   1. Schema, monotonicity and IDENTITY are checked before any native call
 *      that can touch a byte — a `sourceTimelineHash` mismatch invalidates
 *      with zero Annex-B I/O (`validateExportState`).
 *   2. The native fence (`ffmpeg_prepare_checkpoint_resume`) then runs on the
 *      surviving piece file. Append, count and concat are refused by Rust
 *      (`ensure_resume_prepared`) until it succeeds, so nothing here can
 *      accidentally reach them early.
 *   3. Only after the fence clears are the EARLIER pieces verified — by
 *      picture count against the plan, not by existence.
 *
 * MANIFEST SCOPE. The manifest is PIECE-SCOPED: it is created fresh at the
 * start of each GL piece, and its `byteOffset`/`cumulativePictures` are local
 * to that piece's own `piece_<n>.h264`. That is the only scope under which the
 * fence — which takes ONE file — and `appendExportCheckpoint`'s strict
 * monotonicity can both hold, since a per-piece byte offset necessarily resets
 * at a piece boundary. See this round's report for the one-line correction this
 * implies for `ExportCheckpointRecord.byteOffset`'s doc comment.
 */
import {
  validateExportState,
  type AnnexbCheckpointRepairResult,
  type ExportCheckpointExpectedIdentity,
  type ExportCheckpointRecord,
  type ExportStateManifest,
} from './exportCheckpoint';

/** The per-session surface discovery needs. `TauriFfmpeg` satisfies it. */
export interface ResumeSessionHandle {
  readonly sessionId: string;
  readExportState(): Promise<Uint8Array>;
  sessionFileSize(path: string): Promise<number>;
  prepareCheckpointResume(
    path: string,
    checkpoint: ExportCheckpointRecord,
  ): Promise<AnnexbCheckpointRepairResult>;
  /** Exact, caller-supplied cut. Never applies the conservative final-AU drop
   *  — see `finalAuDropConfinement.test.ts`. Used ONLY after the fence has
   *  cleared, to step back from the verified offset to the rotation seam. */
  truncateAnnexbToOffset(
    path: string,
    byteOffset: number,
  ): Promise<{ pictures: number; vclNals: number; bytesRemoved: number; keptBytes: number }>;
  destroy(): Promise<void>;
}

export interface ResumeDiscoveryIo {
  listResumableSessionIds(): Promise<string[]>;
  /** Re-enters an existing session. Rust marks it `resume_pending`, which
   *  closes append/count/concat until the fence clears it. */
  reenter(sessionId: string): Promise<ResumeSessionHandle>;
}

/** A validated, fenced, ready-to-continue export. */
export interface ResumableExport {
  sessionId: string;
  manifest: ExportStateManifest;
  checkpoint: ExportCheckpointRecord;
  repair: AnnexbCheckpointRepairResult;
  /** `piece_<n>.h264` the fence was applied to. */
  pieceFile: string;
  /**
   * Where a resumed run APPENDS — the rotation seam, after the post-fence cut
   * back from the verified offset. Equals `checkpoint.byteOffset` for a
   * manifest written before `seamByteOffset` existed, which resumes correctly
   * but not byte-exactly (the re-rendered access unit's parameter sets are
   * written on top of the kept ones). See `ExportCheckpointRecord`.
   */
  appendFromByteOffset: number;
  /** Pictures already on disk across the WHOLE export — completed pieces plus
   *  this piece's fenced prefix. What the resume offer shows the operator. */
  picturesAlreadyRendered: number;
  /** Total pictures this export will contain when finished. */
  picturesTotal: number;
}

export interface ResumeRejection {
  sessionId: string;
  reason: string;
}

export interface ResumeDiscoveryResult {
  resumable: ResumableExport | null;
  /** Every session inspected and turned down, with why. Feeds cleanup. */
  rejected: ResumeRejection[];
}

/** What discovery needs to know about the export the app WOULD run now. */
export interface ResumeTargetPlan {
  expected: ExportCheckpointExpectedIdentity;
  /** `expectedFrames` per piece, in piece order — the current plan's. */
  pieceExpectedFrames: readonly number[];
}

export function pieceFileName(pieceIndex: number): string {
  return `piece_${pieceIndex}.h264`;
}

/**
 * `validateExportState` needs a file length to pick the newest checkpoint that
 * the surviving bytes can support, and the file it must measure is named by the
 * checkpoint the validation has not selected yet. Resolving that with
 * `MAX_SAFE_INTEGER` runs the full schema/identity/monotonicity validation and
 * yields the LAST record; its `pieceIndex` then names the file, whose real
 * length re-runs the same validation for real. Nothing is skipped: the second
 * call is the authoritative one.
 */
async function selectCheckpoint(
  session: ResumeSessionHandle,
  serialized: Uint8Array,
  expected: ExportCheckpointExpectedIdentity,
): Promise<
  | { ok: true; manifest: ExportStateManifest; checkpoint: ExportCheckpointRecord; pieceFile: string }
  | { ok: false; reason: string }
> {
  const provisional = validateExportState(serialized, expected, Number.MAX_SAFE_INTEGER);
  if (provisional.kind === 'clean') return { ok: false, reason: provisional.reason };

  const pieceFile = pieceFileName(provisional.checkpoint.pieceIndex);
  let fileLength: number;
  try {
    fileLength = await session.sessionFileSize(pieceFile);
  } catch (err) {
    return { ok: false, reason: `surviving ${pieceFile} is unreadable: ${message(err)}` };
  }

  const validated = validateExportState(serialized, expected, fileLength);
  if (validated.kind === 'clean') return { ok: false, reason: validated.reason };
  // A manifest is piece-scoped, so the authoritative selection cannot name a
  // different piece than the provisional one did. If it somehow does, the
  // manifest is not one this module wrote — decline rather than guess.
  if (validated.checkpoint.pieceIndex !== provisional.checkpoint.pieceIndex) {
    return { ok: false, reason: 'checkpoint manifest spans more than one piece' };
  }
  return {
    ok: true,
    manifest: validated.manifest,
    checkpoint: validated.checkpoint,
    pieceFile,
  };
}

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Inspect one surviving session. Never mutates Annex-B bytes unless the
 * identity check has already passed — that is the whole point of the ordering.
 */
export async function evaluateResumeCandidate(
  io: ResumeDiscoveryIo,
  sessionId: string,
  target: ResumeTargetPlan,
  countPictures: (session: ResumeSessionHandle, path: string) => Promise<number>,
): Promise<{ ok: true; value: ResumableExport } | { ok: false; reason: string }> {
  let session: ResumeSessionHandle;
  try {
    session = await io.reenter(sessionId);
  } catch (err) {
    return { ok: false, reason: `cannot re-enter session: ${message(err)}` };
  }

  let serialized: Uint8Array;
  try {
    serialized = await session.readExportState();
  } catch (err) {
    return { ok: false, reason: `export_state.json unreadable: ${message(err)}` };
  }

  const selected = await selectCheckpoint(session, serialized, target.expected);
  if (!selected.ok) return selected;

  const { checkpoint, manifest, pieceFile } = selected;
  if (checkpoint.pieceIndex >= target.pieceExpectedFrames.length) {
    return { ok: false, reason: 'checkpoint names a piece the current plan does not have' };
  }

  // ── The fence. Native, atomic, and mandatory. Rust keeps append/count/
  // concat closed until this returns. ──────────────────────────────────────
  let repair: AnnexbCheckpointRepairResult;
  try {
    repair = await session.prepareCheckpointResume(pieceFile, checkpoint);
  } catch (err) {
    return { ok: false, reason: `pre-append fence refused the resume: ${message(err)}` };
  }
  if (
    repair.keptBytes !== checkpoint.byteOffset ||
    repair.pictures !== checkpoint.cumulativePictures
  ) {
    return {
      ok: false,
      reason:
        `fence result disagrees with the checkpoint ` +
        `(keptBytes ${repair.keptBytes} vs ${checkpoint.byteOffset}, ` +
        `pictures ${repair.pictures} vs ${checkpoint.cumulativePictures})`,
    };
  }

  // ── The post-fence step back to the seam. The fence has cleared, so
  // append/count/concat are open and an exact cut is legal. Both prefixes hold
  // `cumulativePictures` pictures by construction — the bytes between them
  // contain no coded slice — and that is ASSERTED, not assumed. ─────────────
  let appendFromByteOffset = checkpoint.byteOffset;
  if (
    typeof checkpoint.seamByteOffset === 'number' &&
    checkpoint.seamByteOffset < checkpoint.byteOffset
  ) {
    let cut: { pictures: number; keptBytes: number };
    try {
      cut = await session.truncateAnnexbToOffset(pieceFile, checkpoint.seamByteOffset);
    } catch (err) {
      return { ok: false, reason: `could not step back to the rotation seam: ${message(err)}` };
    }
    if (cut.pictures !== checkpoint.cumulativePictures || cut.keptBytes !== checkpoint.seamByteOffset) {
      return {
        ok: false,
        reason:
          `stepping back to the rotation seam changed the picture count ` +
          `(${cut.pictures} vs ${checkpoint.cumulativePictures}) — refusing to resume`,
      };
    }
    appendFromByteOffset = checkpoint.seamByteOffset;
  }

  // ── Only now may anything COUNT. Every piece before this one must already
  // hold exactly the picture count the current plan expects of it — existence
  // is not evidence, and a short earlier piece would silently shorten the
  // finished film. ─────────────────────────────────────────────────────────
  let picturesAlreadyRendered = checkpoint.cumulativePictures;
  for (let i = 0; i < checkpoint.pieceIndex; i++) {
    const expectedFrames = target.pieceExpectedFrames[i]!;
    let pictures: number;
    try {
      pictures = await countPictures(session, pieceFileName(i));
    } catch (err) {
      return { ok: false, reason: `earlier piece ${i} is unreadable: ${message(err)}` };
    }
    if (pictures !== expectedFrames) {
      return {
        ok: false,
        reason: `earlier piece ${i} holds ${pictures} pictures, plan expects ${expectedFrames}`,
      };
    }
    picturesAlreadyRendered += pictures;
  }

  return {
    ok: true,
    value: {
      sessionId,
      manifest,
      checkpoint,
      repair,
      pieceFile,
      appendFromByteOffset,
      picturesAlreadyRendered,
      picturesTotal: target.pieceExpectedFrames.reduce((a, b) => a + b, 0),
    },
  };
}

/**
 * Scan every surviving session and return the first that is genuinely
 * resumable for `target`, plus every one that was not and why.
 *
 * Candidates are inspected NEWEST FIRST (`listResumableSessionIds` returns them
 * sorted by UUID, which carries no time, so the caller supplies the order it
 * knows — see `orderedSessionIds`). The first success wins; the rest are left
 * untouched and reported, so the cleanup policy — not this function — decides
 * their fate.
 */
export async function discoverResumableExport(
  io: ResumeDiscoveryIo,
  target: ResumeTargetPlan,
  countPictures: (session: ResumeSessionHandle, path: string) => Promise<number>,
  orderedSessionIds?: readonly string[],
): Promise<ResumeDiscoveryResult> {
  let ids: readonly string[];
  try {
    ids = orderedSessionIds ?? (await io.listResumableSessionIds());
  } catch {
    return { resumable: null, rejected: [] };
  }

  const rejected: ResumeRejection[] = [];
  for (const sessionId of ids) {
    const outcome = await evaluateResumeCandidate(io, sessionId, target, countPictures);
    if (outcome.ok) return { resumable: outcome.value, rejected };
    rejected.push({ sessionId, reason: outcome.reason });
  }
  return { resumable: null, rejected };
}

// ---------------------------------------------------------------------------
// Cleanup policy
// ---------------------------------------------------------------------------

/**
 * A session directory holds this export's whole Annex-B stream — 1.7 GB at the
 * measured 26-minute 1080p30 reference, 2.3 GB at the sizing case. Nothing
 * deletes an abandoned one today: `ffmpeg_destroy_session` runs on teardown,
 * which by definition does not run when the process dies. Left uncollected they
 * accumulate one per crash until the volume fills — a failure mode resume would
 * INTRODUCE, so the policy ships with it rather than after it.
 *
 * THE POLICY, in words: keep at most ONE abandoned session besides the one
 * currently resumable, and never keep an abandoned session past its TTL. Bound
 * on disk is therefore (1 resumable + 1 retained) x the session size, ~4.6 GB
 * at the 2.3 GB sizing case.
 *
 * WHAT IS NEVER COLLECTED:
 *   - the session the app is using right now (`inUseSessionId`);
 *   - the session discovery just found RESUMABLE for the current timeline.
 * A resumable session is never collected while it is still resumable — that is
 * the rule the whole feature rests on.
 *
 * AGE comes from a caller-supplied ledger (`createdAtMs`), because nothing in
 * the native surface exposes a directory mtime and v4 UUIDs carry no time. An
 * id the ledger does not know — a session from a build older than this round,
 * which never wrote a ledger entry — is treated as OLDEST, so those are the
 * first collected rather than the last. A directory with no `export_state.json`
 * at all is invisible to `ffmpeg_list_resumable_sessions` and therefore
 * uncollectable from here; from this round on every export writes its manifest
 * before it renders a frame, so only pre-round leftovers can be in that state.
 */
export const ABANDONED_SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const MAX_RETAINED_ABANDONED_SESSIONS = 1;

export interface AbandonedSessionCandidate {
  sessionId: string;
  /** From the caller's ledger; `null` when unknown (treated as oldest). */
  createdAtMs: number | null;
}

/**
 * Pure decision: which abandoned sessions to destroy. Separated from the I/O so
 * the policy can be tested without a filesystem, and so a bug in the policy can
 * never be masked by a mock that does not delete.
 */
export function selectSessionsToCollect(params: {
  candidates: readonly AbandonedSessionCandidate[];
  protectedSessionIds: readonly string[];
  nowMs: number;
  ttlMs?: number;
  maxRetained?: number;
}): string[] {
  const ttl = params.ttlMs ?? ABANDONED_SESSION_TTL_MS;
  const maxRetained = params.maxRetained ?? MAX_RETAINED_ABANDONED_SESSIONS;
  const protectedIds = new Set(params.protectedSessionIds);
  const collectable = params.candidates.filter((c) => !protectedIds.has(c.sessionId));

  // Newest first; unknown age sorts last (i.e. is treated as oldest).
  const byAge = [...collectable].sort((a, b) => {
    if (a.createdAtMs === b.createdAtMs) return a.sessionId < b.sessionId ? -1 : 1;
    if (a.createdAtMs === null) return 1;
    if (b.createdAtMs === null) return -1;
    return b.createdAtMs - a.createdAtMs;
  });

  const doomed = new Set<string>();
  byAge.forEach((candidate, rank) => {
    if (rank >= maxRetained) doomed.add(candidate.sessionId);
    if (candidate.createdAtMs !== null && params.nowMs - candidate.createdAtMs > ttl) {
      doomed.add(candidate.sessionId);
    }
  });
  return [...doomed];
}

/**
 * Runs the policy. Every destroy is independent and best-effort: a directory
 * that refuses to go is logged and skipped, never allowed to abort an export.
 */
export async function collectAbandonedSessions(
  io: ResumeDiscoveryIo,
  params: {
    candidates: readonly AbandonedSessionCandidate[];
    protectedSessionIds: readonly string[];
    nowMs: number;
    ttlMs?: number;
    maxRetained?: number;
  },
): Promise<string[]> {
  const doomed = selectSessionsToCollect(params);
  const collected: string[] = [];
  for (const sessionId of doomed) {
    try {
      const session = await io.reenter(sessionId);
      await session.destroy();
      collected.push(sessionId);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn('[ws3-resume] could not collect abandoned export session', sessionId, message(err));
    }
  }
  return collected;
}
