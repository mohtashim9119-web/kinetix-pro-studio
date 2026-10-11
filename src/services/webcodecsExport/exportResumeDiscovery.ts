/**
 * Finding a crash-surviving export, proving it is safe to continue, and
 * collecting the ones that are not.
 *
 * WS3 Round 10, Blocker 3. Cursor's `exportCheckpoint.ts` owns manifest
 * writing, validation, and the native pre-append fence. It has no way to FIND a
 * session: `ffmpeg_create_session` mints a fresh UUID under
 * `<storage root>/export-sessions/kinetix-export-<uuid>/` and the renderer forgets it when the app
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
import { TRUNCATE_BOUND_MS, withFfmpegLivenessBound } from './ffmpegLivenessBound';

/**
 * WS3 STEP 8 (H5) — the minimal claim-liveness shape discovery needs.
 * `TauriFfmpeg.readSessionClaim`'s `SessionClaimView` satisfies it (it
 * carries more fields — holder pid/instance/timestamp — that discovery has
 * no use for). Liveness is PID + process start time, not a heartbeat
 * timeout — see `session_claim.rs`'s `is_holder_process_live`: a slow-but-
 * alive holder reads `live`, never `stale`, and PID reuse is guarded by the
 * start-time comparison on macOS (libproc), Linux (`/proc`) and Windows. A
 * PID that exists but whose start time cannot be read still reads `live`.
 */
export interface SessionClaimLivenessView {
  /** `live` = a running process holds this session — another app instance,
   *  OR this process itself (its own claim reads `live` too);
   *  `stale` = the holder process is gone (crashed) — safe to recover;
   *  `unclaimed` = no claim file at all. */
  holderLiveness: 'live' | 'stale' | 'unclaimed';
}

/** The per-session surface discovery needs. `TauriFfmpeg` satisfies it. */
export interface ResumeSessionHandle {
  readonly sessionId: string;
  readExportState(): Promise<Uint8Array>;
  sessionFileSize(path: string): Promise<number>;
  prepareCheckpointResume(
    path: string,
    checkpoint: ExportCheckpointRecord,
  ): Promise<AnnexbCheckpointRepairResult>;
  /** Piece-boundary resume only: lifts the native resume fence without a
   *  checkpoint (see `TauriFfmpeg.clearResumeFence`). Optional so test fakes
   *  and checkpoint-only callers can omit it. */
  clearResumeFence?(): Promise<void>;
  /** Exact, caller-supplied cut. Never applies the conservative final-AU drop
   *  — see `finalAuDropConfinement.test.ts`. Used ONLY after the fence has
   *  cleared, to step back from the verified offset to the rotation seam. */
  truncateAnnexbToOffset(
    path: string,
    byteOffset: number,
  ): Promise<{ pictures: number; vclNals: number; bytesRemoved: number; keptBytes: number }>;
  /** STEP 3b — `force: true` bypasses the native manifest guard; see
   *  `TauriFfmpeg.destroy`'s own doc comment for which callers must set it. */
  destroy(opts?: { force?: boolean; failureKind?: string }): Promise<void>;
  /**
   * Present on `TauriFfmpeg`. Optional so test fakes can omit it; fence/seam
   * bound expiry then no-ops kill rather than throwing.
   */
  kill?(): Promise<void>;
}

export interface ResumeDiscoveryIo {
  listResumableSessionIds(): Promise<string[]>;
  /** Re-enters an existing session. Rust marks it `resume_pending`, which
   *  closes append/count/concat until the fence clears it. */
  reenter(sessionId: string): Promise<ResumeSessionHandle>;
  /**
   * WS3 STEP 8 (H5) — read-only claim inspection, does NOT take the claim
   * (the native `ffmpeg_read_session_claim` command). Optional: when a
   * caller doesn't supply it, `evaluateResumeCandidate` skips the
   * claim-aware live-block/stale-recovery distinction and goes straight to
   * `reenter` as it always did — `reenter`'s own native refusal
   * (`acquire_session_claim` in `session_claim.rs`) still protects a live
   * foreign holder either way; this only adds the SEPARATE, clearer
   * operator-facing message and skips the wasted round-trip for the blocked
   * case. Production (`exportResumeSession.ts`'s `tauriIo`) always supplies it.
   */
  readSessionClaim?(sessionId: string): Promise<SessionClaimLivenessView>;
  /**
   * Phase A (the offer) — a pure read of the manifest (`ffmpeg_peek_export_state`):
   * no claim, no `resume_pending`, no fence. `notFound` covers a missing
   * session, a missing manifest and a torn write alike.
   */
  peekExportState(sessionId: string): Promise<{ kind: 'found'; bytes: number[] } | { kind: 'notFound' }>;
  /**
   * Phase A — a file's byte length without a session handle
   * (`ffmpeg_session_file_size`, which takes no claim and checks no fence).
   */
  peekSessionFileSize(sessionId: string, path: string): Promise<number>;
}

/**
 * What adoption (Phase B) needs. The manifest and file length are re-read
 * through the claimed handle, so the read-only probes are not part of it.
 */
export type ResumeAdoptIo = Pick<ResumeDiscoveryIo, 'reenter' | 'readSessionClaim'>;

/** A validated, fenced, ready-to-continue export. */
export interface ResumableExport {
  sessionId: string;
  /**
   * The session handle discovery re-entered AND fenced. The export must run on
   * THIS handle: native `reenter` re-arms the resume fence (`resume_pending`)
   * every time it is called, so a second `reenter` after the fence cleared
   * makes every append fail with "has not passed checkpoint pre-append
   * validation".
   */
  session: ResumeSessionHandle;
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
  /**
   * D7.1b — where the piece file ends after adoption: the checkpoint's own end
   * offset, never shorter. When it is beyond `appendFromByteOffset`, the
   * resumed run steps back to the seam immediately before its first append.
   */
  fencedByteOffset: number;
  /** Pictures already on disk across the WHOLE export — completed pieces plus
   *  this piece's fenced prefix. What the resume offer shows the operator. */
  picturesAlreadyRendered: number;
  /** Total pictures this export will contain when finished. */
  picturesTotal: number;
  /**
   * WS3 STEP 8 (H5) — true when this session's claim read `stale` (the prior
   * holder process is gone) immediately before reentry. Distinct from the
   * ordinary "nothing was claimed" case (`false`): the operator-facing
   * notice for this must read "recovering an abandoned session", never the
   * generic resume-offer text, because a stale claim means the PRIOR RUN
   * crashed rather than exited cleanly.
   */
  staleClaimRecovered: boolean;
}

export interface ResumeRejection {
  sessionId: string;
  reason: string;
  /**
   * Set when a native mutating call (the pre-append fence, or the post-fence
   * seam step-back cut) failed AFTER already cutting bytes from the surviving
   * Annex-B file — never on a call that failed cleanly. `reason` alone cannot
   * distinguish these: "the fence refused" and "the fence refused, and also
   * cut the file first" are different operator-facing situations, and only
   * this field tells them apart. See WS3 Round 12, STEP 1.
   */
  bitstreamTouched?: {
    path: string;
    fileLengthBefore: number;
    fileLengthAfter: number;
  };
  /**
   * True when this rejection came from `validateExportState`'s
   * `recovery_budget_exhausted` variant — WS3 Round 13, STEP 4. Carried as a
   * typed flag from the validation `kind`, not re-derived from `reason` text:
   * a discriminant that already exists on the source value must not be
   * re-parsed downstream from its own error message.
   */
  budgetExhausted?: boolean;
  /**
   * WS3 STEP 8 (H5) — true when this candidate was refused because its
   * claim read `live` (a running process holds it — possibly this one),
   * checked BEFORE `reenter` was even attempted. Distinct from an ordinary reenter
   * failure: this is not "something went wrong with the session", it's
   * "another window already owns it" — a different operator-facing message,
   * and not evidence the session itself is broken.
   */
  liveClaimBlocked?: boolean;
  /**
   * WS3 STEP 9 (C7) — true when this rejection came from
   * `validateExportState`'s `never_checkpointed` variant: the export
   * rotated at least one encoder session but never durably checkpointed
   * any of them (every seam lacked a fence-safe offset). Distinct from the
   * ordinary silent case — see the validation kind's own doc comment.
   */
  neverCheckpointed?: boolean;
  /**
   * True when the manifest matched this timeline but nothing had been durably
   * recorded yet (no checkpoint, no finished piece): the export was
   * interrupted too early to resume. Typed, like the others, so the UI can say
   * "No checkpoint yet — restarting from the beginning" instead of restarting
   * silently.
   */
  noCheckpointYet?: boolean;
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
  sessionFileSize: (path: string) => Promise<number>,
  serialized: Uint8Array,
  expected: ExportCheckpointExpectedIdentity,
): Promise<
  | { ok: true; kind: 'checkpoint'; manifest: ExportStateManifest; checkpoint: ExportCheckpointRecord; pieceFile: string }
  | { ok: true; kind: 'piece'; manifest: ExportStateManifest; completedPieces: number }
  | { ok: false; reason: string; budgetExhausted?: boolean; neverCheckpointed?: boolean; noCheckpointYet?: boolean }
> {
  const provisional = validateExportState(serialized, expected, Number.MAX_SAFE_INTEGER);
  if (provisional.kind === 'resume_at_piece') {
    return { ok: true, kind: 'piece', manifest: provisional.manifest, completedPieces: provisional.completedPieces };
  }
  if (provisional.kind !== 'resume') {
    return {
      ok: false,
      reason: provisional.reason,
      budgetExhausted: provisional.kind === 'recovery_budget_exhausted',
      neverCheckpointed: provisional.kind === 'never_checkpointed',
      noCheckpointYet: provisional.kind === 'no_checkpoint_yet',
    };
  }
  // Pieces finished AFTER the newest checkpoint's piece (or that checkpoint's
  // own piece, finished): resume at the start of the next piece. No fence — a
  // closing checkpoint sits at end-of-file, which the native fence's
  // conservative final-AU repair cannot accept, and finished pieces are
  // proven by picture count anyway.
  const completed = provisional.manifest.completedPieces ?? 0;
  if (completed > provisional.checkpoint.pieceIndex) {
    return { ok: true, kind: 'piece', manifest: provisional.manifest, completedPieces: completed };
  }

  const pieceFile = pieceFileName(provisional.checkpoint.pieceIndex);
  let fileLength: number;
  try {
    fileLength = await sessionFileSize(pieceFile);
  } catch (err) {
    return { ok: false, reason: `surviving ${pieceFile} is unreadable: ${message(err)}` };
  }

  const validated = validateExportState(serialized, expected, fileLength);
  if (validated.kind !== 'resume') {
    return {
      ok: false,
      reason: 'reason' in validated ? validated.reason : 'checkpoint no longer fits the surviving file',
      budgetExhausted: validated.kind === 'recovery_budget_exhausted',
      neverCheckpointed: validated.kind === 'never_checkpointed',
      noCheckpointYet: validated.kind === 'no_checkpoint_yet',
    };
  }
  // A manifest is piece-scoped, so the authoritative selection cannot name a
  // different piece than the provisional one did. If it somehow does, the
  // manifest is not one this module wrote — decline rather than guess.
  if (validated.checkpoint.pieceIndex !== provisional.checkpoint.pieceIndex) {
    return { ok: false, reason: 'checkpoint manifest spans more than one piece' };
  }
  return {
    ok: true,
    kind: 'checkpoint',
    manifest: validated.manifest,
    checkpoint: validated.checkpoint,
    pieceFile,
  };
}

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** Resume-path truncates are recovery (Rung 0) — same measured bound as salvage. */
function boundedTruncate<T>(session: ResumeSessionHandle, files: string[], fn: () => Promise<T>): Promise<T> {
  return withFfmpegLivenessBound(
    {
      label: 'TRUNCATE_BOUND_MS',
      boundMs: TRUNCATE_BOUND_MS,
      ffmpeg: { kill: session.kill?.bind(session) ?? (async () => undefined) },
      files,
    },
    fn,
  );
}

export type ResumeCandidateOutcome =
  | { ok: true; value: ResumableExport }
  | {
      ok: false;
      reason: string;
      bitstreamTouched?: ResumeRejection['bitstreamTouched'];
      budgetExhausted?: boolean;
      liveClaimBlocked?: boolean;
      neverCheckpointed?: boolean;
      noCheckpointYet?: boolean;
    };

/**
 * Phase B for one session — adoption. MUTATES: `reenter` takes this process's
 * claim and arms the fence, then the fence and the seam step-back cut the
 * piece file. Call only after the operator chose Resume (`adoptRankedResume`).
 * No Annex-B byte is cut unless identity has already passed, and a rejection
 * releases the claim only where no native byte write can have run (C1b).
 */
export async function evaluateResumeCandidate(
  io: ResumeAdoptIo,
  sessionId: string,
  target: ResumeTargetPlan,
  countPictures: (session: ResumeSessionHandle, path: string) => Promise<number>,
  /** Phase B: the candidate the operator accepted. Adoption refuses, before
   *  any byte write, when the session no longer selects what was offered. */
  offered?: ResumeCandidate,
): Promise<ResumeCandidateOutcome> {
  // WS3 STEP 8 (H5) — claim-aware reentry. Read-only inspection FIRST, before
  // `reenter` is even attempted: a `live` claim held by a different process
  // means "another window is using this session" — an operator-facing
  // situation distinct from any reenter failure — and a `stale` claim means
  // the prior holder crashed, which `reenter`/`acquire_session_claim` will
  // happily recover but the operator should be told is a RECOVERY, not an
  // ordinary resume. `io.readSessionClaim` is optional so callers that don't
  // supply it fall through to the pre-STEP-8 behavior unchanged — `reenter`'s
  // own native refusal for a live foreign holder still applies regardless.
  let staleClaimRecovered = false;
  if (io.readSessionClaim) {
    let claim: SessionClaimLivenessView;
    try {
      claim = await io.readSessionClaim(sessionId);
    } catch (err) {
      return { ok: false, reason: `cannot read session claim: ${message(err)}` };
    }
    if (claim.holderLiveness === 'live') {
      return {
        ok: false,
        reason: 'another window is using this session (live claim held by a different process) — refusing to reenter it here',
        liveClaimBlocked: true,
      };
    }
    if (claim.holderLiveness === 'stale') {
      staleClaimRecovered = true;
    }
  }

  let session: ResumeSessionHandle;
  try {
    session = await io.reenter(sessionId);
  } catch (err) {
    return { ok: false, reason: `cannot re-enter session: ${message(err)}` };
  }

  // `reenter` took this process's claim, and a running app's own claim reads
  // `live`: kept by a rejected candidate, the next pass in this app run refuses
  // the session as "another window is using it" though nothing is. An unforced
  // destroy releases the claim and keeps every file (the native manifest
  // guard). The winner keeps its claim — the export runs on it.
  //
  // Only where no native byte write can have run. Once the fence has been
  // invoked the piece may already be cut — its repair and exact cut run before
  // the checks that can fail, a liveness-bound expiry can land a cut after the
  // length was re-read, and the seam step cuts again — and a later fence on a
  // shortened file re-runs the whole-AU repair, which drops another picture
  // (`prepare_checkpoint_resume_inner`). From that point every rejection keeps
  // the claim held, so this app run cannot re-fence it.
  const fence = { invoked: false };
  const outcome = await evaluateReenteredCandidate(session, sessionId, target, countPictures, staleClaimRecovered, fence, offered);
  if (!outcome.ok && !fence.invoked) await releaseRejectedCandidate(session);
  return outcome;
}

function selectionMatchesOffer(
  selected:
    | { kind: 'checkpoint'; checkpoint: ExportCheckpointRecord }
    | { kind: 'piece'; completedPieces: number },
  offered: ResumeCandidate,
): boolean {
  if (selected.kind !== offered.kind) return false;
  if (selected.kind === 'piece') return selected.completedPieces === offered.completedPieces;
  const a = selected.checkpoint;
  const b = offered.checkpoint;
  return (
    b !== null &&
    a.pieceIndex === b.pieceIndex &&
    a.encoderSessionIndex === b.encoderSessionIndex &&
    a.byteOffset === b.byteOffset &&
    a.cumulativePictures === b.cumulativePictures
  );
}

async function releaseRejectedCandidate(session: ResumeSessionHandle): Promise<void> {
  try {
    await session.destroy({ force: false, failureKind: 'resume-rejected' });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('[ws3-resume] could not release a rejected resume candidate', session.sessionId, message(err));
  }
}

async function evaluateReenteredCandidate(
  session: ResumeSessionHandle,
  sessionId: string,
  target: ResumeTargetPlan,
  countPictures: (session: ResumeSessionHandle, path: string) => Promise<number>,
  staleClaimRecovered: boolean,
  fence: { invoked: boolean },
  offered: ResumeCandidate | undefined,
): Promise<ResumeCandidateOutcome> {
  let serialized: Uint8Array;
  try {
    serialized = await session.readExportState();
  } catch (err) {
    return { ok: false, reason: `export_state.json unreadable: ${message(err)}` };
  }

  const selected = await selectCheckpoint((path) => session.sessionFileSize(path), serialized, target.expected);
  if (!selected.ok) return selected;
  if (offered && !selectionMatchesOffer(selected, offered)) {
    return { ok: false, reason: 'the session changed between the resume offer and its adoption — not resuming it' };
  }

  // ── Piece-boundary resume: whole pieces are finished, nothing inside the
  // next one is checkpointed. No fence (nothing to fence); the finished pieces
  // are proven by picture count exactly as the checkpoint path proves them. ──
  if (selected.kind === 'piece') {
    const n = selected.completedPieces;
    if (n > target.pieceExpectedFrames.length) {
      return { ok: false, reason: 'manifest records more finished pieces than the current plan has' };
    }
    if (!session.clearResumeFence) {
      return { ok: false, reason: 'this session cannot lift the resume fence for a piece-boundary resume' };
    }
    try {
      await session.clearResumeFence();
    } catch (err) {
      return { ok: false, reason: `could not open the session for a piece-boundary resume: ${message(err)}` };
    }
    let rendered = 0;
    for (let i = 0; i < n; i++) {
      const expectedFrames = target.pieceExpectedFrames[i]!;
      let pictures: number;
      try {
        pictures = await countPictures(session, pieceFileName(i));
      } catch (err) {
        return { ok: false, reason: `earlier piece ${i} is unreadable: ${message(err)}` };
      }
      if (pictures !== expectedFrames) {
        return { ok: false, reason: `earlier piece ${i} holds ${pictures} pictures, plan expects ${expectedFrames}` };
      }
      rendered += pictures;
    }
    const m = selected.manifest;
    return {
      ok: true,
      value: {
        sessionId,
        session,
        manifest: m,
        checkpoint: {
          pieceIndex: n, encoderSessionIndex: 0, byteOffset: 0, seamByteOffset: 0, cumulativePictures: 0,
          fps: m.fps, width: m.width, height: m.height, sourceTimelineHash: m.sourceTimelineHash,
        },
        repair: { pictures: 0, vclNals: 0, bytesRemoved: 0, keptBytes: 0 },
        pieceFile: pieceFileName(n),
        appendFromByteOffset: 0,
        fencedByteOffset: 0,
        picturesAlreadyRendered: rendered,
        picturesTotal: target.pieceExpectedFrames.reduce((a, b) => a + b, 0),
        staleClaimRecovered,
      },
    };
  }

  const { checkpoint, manifest, pieceFile } = selected;
  if (checkpoint.pieceIndex >= target.pieceExpectedFrames.length) {
    return { ok: false, reason: 'checkpoint names a piece the current plan does not have' };
  }

  // ── The fence. Native, atomic, and mandatory. Rust keeps append/count/
  // concat closed until this returns. ──────────────────────────────────────
  //
  // `ffmpeg_prepare_checkpoint_resume` runs its whole-AU repair and its
  // exact-offset cut as native mutations BEFORE its own post-repair
  // verification can fail (WS3 Round 12, STEP 1) — a thrown error here does
  // not mean the file is untouched. `fileLengthBefore`/`fileLengthAfter`
  // bracket the call so a real mutation is reported as `bitstreamTouched`
  // rather than folded into "nothing to resume."
  fence.invoked = true;
  const fileLengthBeforeFence = await session.sessionFileSize(pieceFile).catch(() => null);
  let repair: AnnexbCheckpointRepairResult;
  try {
    repair = await boundedTruncate(session, [pieceFile], () =>
      session.prepareCheckpointResume(pieceFile, checkpoint),
    );
  } catch (err) {
    const fileLengthAfterFence = await session.sessionFileSize(pieceFile).catch(() => null);
    if (
      fileLengthBeforeFence !== null &&
      fileLengthAfterFence !== null &&
      fileLengthAfterFence !== fileLengthBeforeFence
    ) {
      return {
        ok: false,
        reason:
          `pre-append fence mutated ${pieceFile} before failing: ${message(err)} ` +
          `(kept ${fileLengthAfterFence} of ${fileLengthBeforeFence} bytes)`,
        bitstreamTouched: {
          path: pieceFile,
          fileLengthBefore: fileLengthBeforeFence,
          fileLengthAfter: fileLengthAfterFence,
        },
      };
    }
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

  // D7.1b — adoption never cuts below the checkpoint's end. The fence above
  // removed only bytes at or beyond it (a torn tail). The step back to the
  // rotation seam — needed so the re-rendered access unit does not write the
  // next session's parameter sets and AUD a second time — is NOT done here:
  // the resumed run does it immediately before its first append
  // (`ExportOptionsWebCodecs.resume.fencedByteOffset`). Done here, a cancel
  // before that first append left a file shorter than every checkpoint, and
  // the next discovery found nothing to resume. A file that does end at the
  // seam (an older build's cut, or a crash between the step back and the
  // append) is resumed AT the seam: `validateExportState` hands that
  // checkpoint on with `byteOffset = seamByteOffset`.
  const seamByteOffset = checkpoint.seamByteOffset;
  const appendFromByteOffset =
    typeof seamByteOffset === 'number' && seamByteOffset < checkpoint.byteOffset ? seamByteOffset : checkpoint.byteOffset;

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
      session,
      manifest,
      checkpoint,
      repair,
      pieceFile,
      appendFromByteOffset,
      fencedByteOffset: checkpoint.byteOffset,
      picturesAlreadyRendered,
      picturesTotal: target.pieceExpectedFrames.reduce((a, b) => a + b, 0),
      staleClaimRecovered,
    },
  };
}

// ---------------------------------------------------------------------------
// Phase A — the offer: read-only, ranked
// ---------------------------------------------------------------------------

/**
 * A session that can be offered, as far as can be told without touching it.
 * Adoption (Phase B) re-derives all of this through the claimed handle and
 * refuses if it no longer matches.
 */
export interface ResumeCandidate {
  sessionId: string;
  kind: 'checkpoint' | 'piece';
  manifest: ExportStateManifest;
  /** The checkpoint the surviving file length supports (`kind: 'checkpoint'`). */
  checkpoint: ExportCheckpointRecord | null;
  /** Whole pieces finished — the piece to resume at (`kind: 'piece'`). */
  completedPieces: number;
  /** Pictures the resume would keep: finished pieces + the fenced prefix. */
  projectedPicturesRendered: number;
  picturesTotal: number;
  /** The claim read `stale`: the prior holder process is gone. */
  staleClaim: boolean;
  createdAtMs: number | null;
}

type CandidateInspection =
  | { ok: true; candidate: ResumeCandidate }
  | ({ ok: false } & Omit<ResumeRejection, 'sessionId'>);

function sumFrames(pieceExpectedFrames: readonly number[], pieces: number): number {
  let total = 0;
  for (let i = 0; i < pieces; i++) total += pieceExpectedFrames[i] ?? 0;
  return total;
}

async function inspectCandidate(
  io: ResumeDiscoveryIo,
  sessionId: string,
  target: ResumeTargetPlan,
  createdAtMs: number | null,
): Promise<CandidateInspection> {
  let staleClaim = false;
  if (io.readSessionClaim) {
    let claim: SessionClaimLivenessView;
    try {
      claim = await io.readSessionClaim(sessionId);
    } catch (err) {
      return { ok: false, reason: `cannot read session claim: ${message(err)}` };
    }
    if (claim.holderLiveness === 'live') {
      return {
        ok: false,
        reason: 'another window is using this session (its claim is held by a running process) — not offering it',
        liveClaimBlocked: true,
      };
    }
    staleClaim = claim.holderLiveness === 'stale';
  }

  let peek: { kind: 'found'; bytes: number[] } | { kind: 'notFound' };
  try {
    peek = await io.peekExportState(sessionId);
  } catch (err) {
    return { ok: false, reason: `export_state.json unreadable: ${message(err)}` };
  }
  if (peek.kind === 'notFound') return { ok: false, reason: 'export_state.json unreadable: not found' };

  const selected = await selectCheckpoint(
    (path) => io.peekSessionFileSize(sessionId, path),
    new Uint8Array(peek.bytes),
    target.expected,
  );
  if (!selected.ok) {
    const { ok: _ok, ...rejection } = selected;
    return { ok: false, ...rejection };
  }

  const picturesTotal = sumFrames(target.pieceExpectedFrames, target.pieceExpectedFrames.length);
  if (selected.kind === 'piece') {
    if (selected.completedPieces > target.pieceExpectedFrames.length) {
      return { ok: false, reason: 'manifest records more finished pieces than the current plan has' };
    }
    return {
      ok: true,
      candidate: {
        sessionId, kind: 'piece', manifest: selected.manifest, checkpoint: null,
        completedPieces: selected.completedPieces,
        projectedPicturesRendered: sumFrames(target.pieceExpectedFrames, selected.completedPieces),
        picturesTotal, staleClaim, createdAtMs,
      },
    };
  }
  if (selected.checkpoint.pieceIndex >= target.pieceExpectedFrames.length) {
    return { ok: false, reason: 'checkpoint names a piece the current plan does not have' };
  }
  return {
    ok: true,
    candidate: {
      sessionId, kind: 'checkpoint', manifest: selected.manifest, checkpoint: selected.checkpoint,
      completedPieces: selected.manifest.completedPieces ?? 0,
      projectedPicturesRendered:
        sumFrames(target.pieceExpectedFrames, selected.checkpoint.pieceIndex) + selected.checkpoint.cumulativePictures,
      picturesTotal, staleClaim, createdAtMs,
    },
  };
}

/**
 * Ranking, highest first: (a) projected pictures rendered, (b) the
 * checkpoint's byte offset (0 for a piece-boundary resume), (c) the session's
 * ledger creation time, newer first, unknown last. The id breaks any remaining
 * tie so the order is deterministic.
 */
export function compareResumeCandidates(a: ResumeCandidate, b: ResumeCandidate): number {
  if (a.projectedPicturesRendered !== b.projectedPicturesRendered) {
    return b.projectedPicturesRendered - a.projectedPicturesRendered;
  }
  const ao = a.checkpoint?.byteOffset ?? 0;
  const bo = b.checkpoint?.byteOffset ?? 0;
  if (ao !== bo) return bo - ao;
  if (a.createdAtMs !== b.createdAtMs) {
    if (a.createdAtMs === null) return 1;
    if (b.createdAtMs === null) return -1;
    return b.createdAtMs - a.createdAtMs;
  }
  return a.sessionId < b.sessionId ? -1 : a.sessionId > b.sessionId ? 1 : 0;
}

/**
 * Phase A. Inspects every candidate WITHOUT taking a claim, arming the fence
 * or writing a byte: it calls `readSessionClaim`, `peekExportState` and
 * `peekSessionFileSize`, nothing else. Safe to run and abandon at any moment —
 * the next pass sees exactly what this one saw.
 *
 * Valid = the claim is not live, the manifest reads, its identity matches
 * `target`, a checkpoint the real file length supports resolves (or whole
 * pieces are finished), and the plan has the piece it names. A fully rendered
 * session is valid and ranks top. Every other candidate is rejected with why.
 */
export async function rankResumeCandidates(
  io: ResumeDiscoveryIo,
  target: ResumeTargetPlan,
  sessionIds: readonly string[],
  createdAtMs: (sessionId: string) => number | null,
): Promise<{ ranked: ResumeCandidate[]; rejected: ResumeRejection[] }> {
  const ranked: ResumeCandidate[] = [];
  const rejected: ResumeRejection[] = [];
  for (const sessionId of sessionIds) {
    const inspected = await inspectCandidate(io, sessionId, target, createdAtMs(sessionId));
    if (inspected.ok) {
      ranked.push(inspected.candidate);
    } else {
      const { ok: _ok, ...rejection } = inspected;
      rejected.push({ sessionId, ...rejection });
    }
  }
  ranked.sort(compareResumeCandidates);
  return { ranked, rejected };
}

/**
 * Phase B, after the operator chose Resume. Adopts the first candidate of
 * Phase A's ranking that survives the real handshake — re-enter, arm,
 * fence-or-clear, seam step-back, earlier-piece counts — on that ONE session.
 * Each failure falls through to the next ranked candidate; its claim is
 * released only where no native byte write can have run (C1b, see
 * `evaluateResumeCandidate`). Candidates after the winner are never touched.
 */
export async function adoptRankedResume(
  io: ResumeAdoptIo,
  ranked: readonly ResumeCandidate[],
  target: ResumeTargetPlan,
  countPictures: (session: ResumeSessionHandle, path: string) => Promise<number>,
): Promise<ResumeDiscoveryResult> {
  const rejected: ResumeRejection[] = [];
  for (const candidate of ranked) {
    const outcome = await evaluateResumeCandidate(io, candidate.sessionId, target, countPictures, candidate);
    if (outcome.ok) return { resumable: outcome.value, rejected };
    rejected.push(rejectionFrom(candidate.sessionId, outcome));
  }
  return { resumable: null, rejected };
}

function rejectionFrom(sessionId: string, outcome: Extract<ResumeCandidateOutcome, { ok: false }>): ResumeRejection {
  return {
    sessionId,
    reason: outcome.reason,
    ...(outcome.bitstreamTouched ? { bitstreamTouched: outcome.bitstreamTouched } : {}),
    ...(outcome.budgetExhausted ? { budgetExhausted: true } : {}),
    ...(outcome.liveClaimBlocked ? { liveClaimBlocked: true } : {}),
    ...(outcome.neverCheckpointed ? { neverCheckpointed: true } : {}),
    ...(outcome.noCheckpointYet ? { noCheckpointYet: true } : {}),
  };
}

/**
 * Offer and adopt in one call, for a caller with no consent step between
 * them: Phase A ranks every candidate read-only, Phase B adopts the best one
 * that survives. `rejected` lists Phase A's rejections, then Phase B's.
 * `findResumeOffer` runs the two phases separately, with the operator between.
 */
export async function discoverResumableExport(
  io: ResumeDiscoveryIo,
  target: ResumeTargetPlan,
  countPictures: (session: ResumeSessionHandle, path: string) => Promise<number>,
  sessionIds?: readonly string[],
  createdAtMs: (sessionId: string) => number | null = () => null,
): Promise<ResumeDiscoveryResult> {
  let ids: readonly string[];
  try {
    ids = sessionIds ?? (await io.listResumableSessionIds());
  } catch {
    return { resumable: null, rejected: [] };
  }
  const offer = await rankResumeCandidates(io, target, ids, createdAtMs);
  const adopted = await adoptRankedResume(io, offer.ranked, target, countPictures);
  return { resumable: adopted.resumable, rejected: [...offer.rejected, ...adopted.rejected] };
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
 * THE POLICY, in words, PER PROJECT (the caller passes one project's
 * sessions — see `findResumeOffer`): keep at most ONE abandoned session besides
 * the one currently resumable, and never keep an abandoned session past its
 * TTL. Bound on disk is therefore (1 resumable + 1 retained) x the session size
 * per project, ~4.6 GB at the 2.3 GB sizing case. One project's leftovers never
 * count against another's.
 *
 * WHAT IS NEVER COLLECTED:
 *   - the session the app is using right now (`inUseSessionId`);
 *   - the session discovery just found RESUMABLE for the current timeline.
 * A resumable session is never collected while it is still resumable — that is
 * the rule the whole feature rests on.
 *
 * AGE comes from a caller-supplied ledger (`createdAtMs`), because nothing in
 * the native surface exposes a directory mtime and v4 UUIDs carry no time. An
 * id whose age the ledger does not know is NEVER collected: nothing proves it
 * abandoned, and under-collecting is the safe direction. The Storage settings'
 * reclaim list still shows it for a manual clean-up. A directory with no `export_state.json`
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

  // An unknown age proves nothing about abandonment, so it is never collected
  // (under-collecting is the safe direction). Known ages: newest first.
  const byAge = collectable
    .filter((c): c is AbandonedSessionCandidate & { createdAtMs: number } => c.createdAtMs !== null)
    .sort((a, b) => (a.createdAtMs === b.createdAtMs ? (a.sessionId < b.sessionId ? -1 : 1) : b.createdAtMs - a.createdAtMs));

  const doomed = new Set<string>();
  byAge.forEach((candidate, rank) => {
    if (rank >= maxRetained) doomed.add(candidate.sessionId);
    if (params.nowMs - candidate.createdAtMs > ttl) {
      doomed.add(candidate.sessionId);
    }
  });
  return [...doomed];
}

/**
 * Runs the policy. Every destroy is independent and best-effort: a directory
 * that refuses to go is logged and skipped, never allowed to abort an export.
 *
 * Never a session a `live` claim holds: the policy picks by age alone, and
 * `reenter` succeeds on this process's own claim, so a run using the session
 * would have its appends fenced and its files deleted. CONSERVATIVE — this
 * process also holds claims no run is using (C1b's post-fence holds, a cancel
 * that lands during adoption); those stay until a restart makes the claim
 * stale, and are collected then. A claim that cannot be read is skipped
 * the same way. Without `io.readSessionClaim` the collector behaves as before.
 */
export async function collectAbandonedSessions(
  io: Pick<ResumeDiscoveryIo, 'reenter' | 'readSessionClaim'>,
  params: {
    candidates: readonly AbandonedSessionCandidate[];
    protectedSessionIds: readonly string[];
    nowMs: number;
    ttlMs?: number;
    maxRetained?: number;
    /** Told every outcome for a session the policy selected. */
    onDisposition?: (sessionId: string, disposition: 'collected' | 'skipped' | 'destroy-failed', reason: string) => void;
  },
): Promise<string[]> {
  const doomed = selectSessionsToCollect(params);
  const collected: string[] = [];
  const tell = params.onDisposition ?? (() => undefined);
  for (const sessionId of doomed) {
    try {
      if (io.readSessionClaim && (await io.readSessionClaim(sessionId)).holderLiveness === 'live') {
        tell(sessionId, 'skipped', 'live claim — a running process holds it');
        continue;
      }
      const session = await io.reenter(sessionId);
      // STEP 3b — this policy exists specifically to discard sessions past
      // the retention cap/TTL; a manifest is expected (that's why they were
      // resumable candidates at all) and must not stop the collection.
      await session.destroy({ force: true, failureKind: 'ttl-collect' });
      collected.push(sessionId);
      tell(sessionId, 'collected', 'over the project\'s retention cap or past its TTL');
    } catch (err) {
      tell(sessionId, 'destroy-failed', message(err));
      // eslint-disable-next-line no-console
      console.warn('[ws3-resume] could not collect abandoned export session', sessionId, message(err));
    }
  }
  return collected;
}
