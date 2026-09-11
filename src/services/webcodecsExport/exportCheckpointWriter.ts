/**
 * The durable checkpoint WRITER — the piece-scoped manifest, and the
 * single-slot, never-awaited writer that puts it on disk.
 *
 * WS3 Round 10, Blocker 3. Cursor's three writer primitives
 * (`appendExportCheckpoint` -> `serializeExportState` ->
 * `TauriFfmpeg.writeExportState`) are complete; this is the call-site policy
 * around them.
 *
 * WRITE COST PER ROTATION, and why it cannot stall the export.
 *
 * A checkpoint record serializes to ~200 bytes of pretty-printed JSON. A
 * 26-minute 1080p30 export rotates its encoder every 1800 frames (60 s), so it
 * produces ~26 rotations and a manifest that ends under 6 KB; the piece-scoped
 * reset keeps it smaller still. `ffmpeg_write_export_state` validates that
 * JSON, writes a temp file, `sync_all()`s it, and renames it over the previous
 * manifest — one fsync of a few kilobytes.
 *
 * That cost is small, but "small" is not an argument that it cannot stall: an
 * fsync on a wedged volume can block indefinitely, and this repo has already
 * been bitten once by a second read of just-written bytes hanging on Spotlight
 * (WS2 T4.8). So the write is not made fast — it is made STRUCTURALLY UNABLE to
 * stall the export:
 *
 *   - Nothing ever awaits it. `record()` is synchronous and returns
 *     immediately; the export's append queue is never chained to a write.
 *   - At most ONE write is in flight. A rotation that lands while a write is
 *     still going does not queue a second one — it marks the manifest dirty,
 *     and the in-flight write's completion picks up the NEWEST manifest. Cost
 *     per rotation is therefore O(1) in memory and in file descriptors no
 *     matter how slow the volume is.
 *   - A write that fails, or never settles, costs exactly the checkpoints it
 *     would have carried. Resume then rewinds further, which is the correct
 *     degradation; the export itself is untouched.
 *
 * That is a stronger statement than a timeout would give, and it needs no
 * unmeasured constant to make it.
 */
import {
  appendExportCheckpoint,
  createExportStateManifest,
  exportLifetimeBudgetOf,
  recordBoundaryRewind,
  recordHardwareFailover,
  recordResumeAttempt,
  recordRotationSeen,
  serializeExportState,
  type ExportCheckpointRecord,
  type ExportStateManifest,
} from './exportCheckpoint';

/** The ffmpeg surface the writer needs. `TauriFfmpeg` satisfies it. */
export interface CheckpointWritingFfmpeg {
  readonly sessionId?: string;
  writeExportState?(serializedManifest: string): Promise<void>;
}

export interface CheckpointWriterIdentity {
  projectId: string;
  /**
   * The canonical timeline hash, as a PROMISE.
   *
   * It is a promise and not a string on purpose: it comes from
   * `crypto.subtle.digest`, and awaiting it before the piece loop would insert
   * a real asynchronous step into the export's startup path — moving worker
   * construction one macrotask later than it has been since the WebCodecs path
   * shipped. That is an observable change to a path this round is required to
   * leave byte-identical. So the export never awaits it: the writer buffers the
   * one or two calls that can possibly precede it (the first `beginPiece`,
   * which happens before any frame is encoded) and applies them when it lands.
   *
   * Rejecting, or resolving `null`, disables checkpointing for the run and
   * changes nothing else.
   */
  sourceTimelineHash: Promise<string | null>;
  fps: number;
  width: number;
  height: number;
}

export interface ExportCheckpointWriter {
  /** True when this export can actually checkpoint (a session id and a writer
   *  are both present). False makes every other method a no-op. */
  readonly enabled: boolean;
  /** Starts a fresh, piece-scoped manifest and schedules its first write. */
  beginPiece(pieceIndex: number): void;
  /**
   * Continues a manifest that already exists on disk — the resume case.
   *
   * A resumed piece must NOT `beginPiece`: that would write an empty manifest
   * over the one whose checkpoints are the only record of what is already
   * rendered, so a second crash would rewind to the start of the piece instead
   * of to the newest rotation. Adopting keeps appending to it, and takes the
   * timeline hash from the manifest itself (it has already been validated
   * against the current project, or discovery would not have offered it).
   */
  adoptManifest(manifest: ExportStateManifest, pieceIndex: number): void;
  /** Records a rotation checkpoint. Synchronous; never throws. */
  record(record: { encoderSessionIndex: number; byteOffset: number; seamByteOffset: number; cumulativePictures: number }): void;
  /**
   * WS3 STEP 9 (C7) — the three recovery-budget writes. Each is
   * synchronous, never throws, and a no-op before any manifest exists (the
   * same "costs exactly the checkpoints it would have carried" posture as
   * `record` — a budget write that arrives before `beginPiece`/
   * `adoptManifest` has nothing to attach to and is dropped, never queued
   * to be misapplied to a LATER, unrelated manifest).
   */
  noteBoundaryRewind(): void;
  noteHardwareFailover(): void;
  noteResumeAttempt(): void;
  /** WS3 STEP 9 (C7) — call on EVERY 'session-rotate', regardless of
   *  whether a checkpoint was actually written for it (see
   *  `ExportStateManifest.rotationsSeen`'s own doc comment). */
  noteRotation(): void;
  /** The manifest as it stands — for tests and diagnostics. */
  snapshot(): ExportStateManifest | null;
  /** Number of writes actually issued — for tests and diagnostics. */
  readonly writesIssued: number;
}

export function createExportCheckpointWriter(
  ffmpeg: CheckpointWritingFfmpeg,
  identity: CheckpointWriterIdentity,
): ExportCheckpointWriter {
  const sessionId = ffmpeg.sessionId;
  const write = ffmpeg.writeExportState?.bind(ffmpeg);
  const enabled = typeof sessionId === 'string' && sessionId.length > 0 && typeof write === 'function';

  let manifest: ExportStateManifest | null = null;
  let pieceIndex = 0;
  let inFlight = false;
  let dirty = false;
  let writesIssued = 0;
  /** Resolved timeline hash, once it lands. `null` while pending or failed. */
  let hash: string | null = null;
  /** A `beginPiece` that arrived before the hash did. */
  let deferredPieceIndex: number | null = null;

  const pump = (): void => {
    if (!enabled || inFlight || !dirty || manifest === null) return;
    dirty = false;
    inFlight = true;
    writesIssued++;
    const serialized = serializeExportState(manifest);
    void write!(serialized)
      .catch((err: unknown) => {
        // eslint-disable-next-line no-console
        console.warn('[ws3-resume] checkpoint write failed — resume will rewind further', err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        inFlight = false;
        // Coalesced rotations that arrived during this write are picked up
        // here, as ONE write of the newest manifest.
        pump();
      });
  };

  const startManifest = (nextPieceIndex: number): void => {
    manifest = createExportStateManifest({
      sessionId: sessionId!,
      projectId: identity.projectId,
      sourceTimelineHash: hash!,
      fps: identity.fps,
      width: identity.width,
      height: identity.height,
      // WS3 Round 16 (C11) — the manifest being left behind is the previous
      // piece's (fresh or adopted, plus every note* since), i.e. the export's
      // running total. The new piece inherits it, so the newest manifest on
      // disk is always the export-lifetime budget and a resume from ANY piece
      // seeds `exportPipelineWebCodecs.ts`'s in-process gates correctly.
      carriedBudget: exportLifetimeBudgetOf(manifest),
    });
    dirty = true;
    pump();
  };

  if (enabled) {
    void identity.sourceTimelineHash
      .then((resolved) => {
        hash = resolved;
        if (hash === null) return;
        if (deferredPieceIndex !== null) {
          const deferred = deferredPieceIndex;
          deferredPieceIndex = null;
          startManifest(deferred);
        }
      })
      .catch((err: unknown) => {
        // eslint-disable-next-line no-console
        console.warn('[ws3-resume] timeline identity unavailable — this export will not be resumable', err instanceof Error ? err.message : String(err));
      });
  }

  return {
    enabled,
    get writesIssued() { return writesIssued; },
    beginPiece(nextPieceIndex: number): void {
      if (!enabled) return;
      pieceIndex = nextPieceIndex;
      if (hash === null) { deferredPieceIndex = nextPieceIndex; manifest = null; return; }
      startManifest(nextPieceIndex);
    },
    adoptManifest(existing: ExportStateManifest, nextPieceIndex: number): void {
      if (!enabled) return;
      if (existing.sessionId !== sessionId) {
        // A manifest from a different session cannot be written to this one —
        // Rust rejects the mismatch anyway. Start clean rather than guess.
        // eslint-disable-next-line no-console
        console.warn('[ws3-resume] refusing to adopt a manifest from another session');
        return;
      }
      pieceIndex = nextPieceIndex;
      hash = existing.sourceTimelineHash;
      deferredPieceIndex = null;
      manifest = existing;
    },
    record(row): void {
      // A rotation that beats the hash produces no checkpoint. It cannot
      // produce a wrong one: without the hash there is no manifest to append
      // to, and a checkpoint with no identity is exactly what
      // `validateExportState` exists to reject.
      if (!enabled || manifest === null || hash === null) return;
      const full: ExportCheckpointRecord = {
        pieceIndex,
        encoderSessionIndex: row.encoderSessionIndex,
        byteOffset: row.byteOffset,
        seamByteOffset: row.seamByteOffset,
        cumulativePictures: row.cumulativePictures,
        fps: identity.fps,
        width: identity.width,
        height: identity.height,
        sourceTimelineHash: hash,
      };
      try {
        manifest = appendExportCheckpoint(manifest, full);
      } catch (err) {
        // A non-monotonic or malformed row is DROPPED, never forced in and
        // never allowed to abort the export: the manifest's monotonicity is
        // what makes a resume safe, so a row that would break it is exactly
        // the row not to keep.
        // eslint-disable-next-line no-console
        console.warn('[ws3-resume] refusing a non-monotonic checkpoint', err instanceof Error ? err.message : String(err));
        return;
      }
      dirty = true;
      pump();
    },
    noteBoundaryRewind(): void {
      if (!enabled || manifest === null) return;
      manifest = recordBoundaryRewind(manifest);
      dirty = true;
      pump();
    },
    noteHardwareFailover(): void {
      if (!enabled || manifest === null) return;
      manifest = recordHardwareFailover(manifest);
      dirty = true;
      pump();
    },
    noteResumeAttempt(): void {
      if (!enabled || manifest === null) return;
      manifest = recordResumeAttempt(manifest);
      dirty = true;
      pump();
    },
    noteRotation(): void {
      if (!enabled || manifest === null) return;
      manifest = recordRotationSeen(manifest);
      dirty = true;
      pump();
    },
    snapshot(): ExportStateManifest | null {
      return manifest;
    },
  };
}
