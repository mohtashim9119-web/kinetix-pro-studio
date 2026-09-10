/**
 * WHERE a durable export checkpoint's byte offset may be placed.
 *
 * WS3 Round 10, Blocker 3. This module exists because of one measured fact
 * about the native resume fence, and it is not the fact the checkpoint
 * manifest's own doc comment implies.
 *
 * THE FENCE'S STEP 5. `ffmpeg_prepare_checkpoint_resume` (ffmpeg.rs) runs:
 *   1. tail inspection  2. unconditional whole-AU repair  3. assert the repair
 *   did not fall below the checkpoint  4. exact-offset truncate  5. RE-REPAIR,
 *   asserting `bytesRemoved == 0`  6. recount  7. clear `resume_pending`.
 *
 * Step 5 re-runs the CONSERVATIVE whole-AU repair on the prefix that step 4
 * just cut to. That repair drops the final access unit unless a subsequent NAL
 * proves it closed (`scanned_final_au_is_provably_complete`; JS twin
 * `isFinalAccessUnitProvablyComplete`). So a checkpoint offset is acceptable to
 * the fence if and only if the prefix `[0, offset)` ENDS WITH A NAL THAT BEGINS
 * THE NEXT ACCESS UNIT — a non-VCL NAL (AUD/SPS/PPS/SEI), or a VCL with
 * `first_mb_in_slice == 0`.
 *
 * WHY THE OBVIOUS PLACEMENT IS WRONG. An encoder rotation seam is the byte
 * count at the instant session k's output ends and session k+1's begins. A
 * prefix cut exactly there ends with session k's LAST CODED SLICE and nothing
 * after it, so step 5 drops that picture, `bytesRemoved != 0`, and the fence
 * refuses the resume. The seam — the intuitive checkpoint — is precisely the
 * one offset the fence cannot accept. (Cursor's Rust fixture passes at an
 * "exact-au-boundary" only because `build_multi_slice_stream` writes SPS+PPS
 * AFTER every picture, which no real encoder does; its own trailing-AUD helper
 * carries the comment explaining that it exists for this reason.)
 *
 * THE RULE. Place the checkpoint at `seam + <byte index of the first VCL NAL in
 * the bytes that follow the seam>`. Session k+1 opens with its parameter sets
 * and access-unit delimiter before its first coded slice, so that offset ends
 * the prefix on a non-VCL NAL, contains ZERO bytes of any picture that has not
 * been fully written, and leaves the picture count exactly what it was at the
 * seam. If the bytes after the seam begin immediately with a coded slice, there
 * is no fence-safe offset in them and this returns `null` — NO CHECKPOINT IS
 * WRITTEN. A missing checkpoint costs a resume opportunity; a bad one costs a
 * corrupt bitstream, so declining is the only correct failure.
 *
 * This module is deliberately pure and byte-only: no session, no manifest, no
 * I/O. `exportCheckpointPlacement.test.ts` proves the rule against the same JS
 * twin of the repair that the fence's step 5 runs natively.
 */
import { scanAnnexbNals, type AnnexbNalSpan } from './annexbFrameCount';

/** H.264 coded-slice NAL types: non-IDR (1) and IDR (5). */
function isVcl(nal: AnnexbNalSpan): boolean {
  return nal.nalType === 1 || nal.nalType === 5;
}

/**
 * Byte index, within `postSeamBytes`, of the first coded-slice NAL's start
 * code. `null` when the buffer holds no coded slice at all (nothing to bound
 * the leading non-VCL run), and `0` when it opens directly with one.
 */
export function firstVclNalIndex(postSeamBytes: Uint8Array): number | null {
  const nals = scanAnnexbNals(postSeamBytes);
  for (const nal of nals) {
    if (isVcl(nal)) return nal.start;
  }
  return null;
}

/**
 * The fence-safe checkpoint offset for a rotation seam, or `null` when the
 * bytes that follow the seam cannot produce one.
 *
 * `seamByteOffset` is the absolute offset in the Annex-B file at which
 * `postSeamBytes` was appended.
 */
export function fenceSafeCheckpointOffset(
  seamByteOffset: number,
  postSeamBytes: Uint8Array,
): number | null {
  if (!Number.isSafeInteger(seamByteOffset) || seamByteOffset < 0) return null;
  const firstVcl = firstVclNalIndex(postSeamBytes);
  // `null`  — no coded slice yet: the leading non-VCL run may still be
  //           incomplete, so no offset inside this buffer is provably safe.
  // `0`     — the buffer opens on a coded slice: the only candidate offset is
  //           the seam itself, which is exactly the offset step 5 rejects.
  if (firstVcl === null || firstVcl === 0) return null;
  return seamByteOffset + firstVcl;
}
