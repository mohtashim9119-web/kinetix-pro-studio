/**
 * WS3 Round 10, Blocker 3 — the checkpoint PLACEMENT rule, measured against the
 * same repair the native fence's step 5 runs.
 *
 * The first test is the finding the rule exists for: the intuitive checkpoint —
 * the rotation seam itself — is the one offset `prepare_checkpoint_resume`
 * cannot accept. Everything after it pins the rule that fixes that.
 */
import { describe, it, expect } from 'vitest';
import {
  buildSyntheticSingleSliceWithParamSets,
  countAnnexbAccessUnits,
  scanAnnexbNals,
  truncateAnnexbToLastCompleteAu,
} from './annexbFrameCount';
import { fenceSafeCheckpointOffset, firstVclNalIndex } from './exportCheckpointPlacement';

/** A stream shaped like real encoder output: [SPS][PPS][AUD][SEI][slice] per
 *  picture, parameter sets LEADING each access unit — not trailing it. */
function encoderShapedStream(pictures: number): Uint8Array {
  return buildSyntheticSingleSliceWithParamSets(pictures);
}

/** The absolute offset at which picture `p`'s leading parameter sets begin —
 *  i.e. the byte count at the instant picture `p-1`'s access unit closed. This
 *  is what an encoder rotation seam is. */
function accessUnitStartOffset(bytes: Uint8Array, pictureIndex: number): number {
  const nals = scanAnnexbNals(bytes);
  let seen = 0;
  for (let i = 0; i < nals.length; i++) {
    const nal = nals[i]!;
    if (nal.nalType !== 1 && nal.nalType !== 5) continue;
    if (seen === pictureIndex) {
      // Walk back over this picture's leading non-VCL run.
      let j = i - 1;
      while (j >= 0 && nals[j]!.nalType !== 1 && nals[j]!.nalType !== 5) j--;
      return nals[j + 1]!.start;
    }
    seen++;
  }
  throw new Error(`no picture ${pictureIndex}`);
}

/** Does the fence's step 5 accept this prefix? (`bytesRemoved == 0`.) */
function fenceAcceptsPrefix(bytes: Uint8Array, offset: number): boolean {
  return truncateAnnexbToLastCompleteAu(bytes.subarray(0, offset)).bytesRemoved === 0;
}

describe('checkpoint placement — the fence decides where a checkpoint may sit', () => {
  it('THE FINDING: the rotation seam itself is REJECTED by the fence, on encoder-shaped bytes', () => {
    const stream = encoderShapedStream(6);
    const seam = accessUnitStartOffset(stream, 3); // end of picture 2's AU
    expect(countAnnexbAccessUnits(stream.subarray(0, seam)).pictures).toBe(3);
    // The prefix is a whole number of complete access units — and the fence
    // still refuses it, because nothing follows the last coded slice to prove
    // that slice's picture closed.
    expect(fenceAcceptsPrefix(stream, seam)).toBe(false);
    expect(truncateAnnexbToLastCompleteAu(stream.subarray(0, seam)).pictures).toBe(2);
  });

  it('the rule produces an offset the fence ACCEPTS, with the seam picture count unchanged', () => {
    const stream = encoderShapedStream(6);
    const seam = accessUnitStartOffset(stream, 3);
    const postSeam = stream.subarray(seam);
    const offset = fenceSafeCheckpointOffset(seam, postSeam);
    expect(offset).not.toBeNull();
    expect(offset!).toBeGreaterThan(seam);
    expect(fenceAcceptsPrefix(stream, offset!)).toBe(true);
    // No picture is gained or lost by moving the cut forward past the leading
    // non-VCL run — the offset contains zero bytes of picture 3.
    expect(countAnnexbAccessUnits(stream.subarray(0, offset!)).pictures).toBe(3);
    expect(truncateAnnexbToLastCompleteAu(stream.subarray(0, offset!)).pictures).toBe(3);
  });

  it('holds at every rotation seam in the stream, not just one', () => {
    const stream = encoderShapedStream(8);
    for (let p = 1; p < 8; p++) {
      const seam = accessUnitStartOffset(stream, p);
      const offset = fenceSafeCheckpointOffset(seam, stream.subarray(seam));
      expect(offset, `picture ${p}`).not.toBeNull();
      expect(fenceAcceptsPrefix(stream, offset!), `picture ${p}`).toBe(true);
      expect(countAnnexbAccessUnits(stream.subarray(0, offset!)).pictures, `picture ${p}`).toBe(p);
    }
  });

  /**
   * WS3 STEP 9 (C7) — production never hands `fenceSafeCheckpointOffset` the
   * WHOLE remaining stream: it hands it `payload`, the FIRST append batch
   * after the seam (`exportPipelineWebCodecs.ts`'s `flushPendingBatch`),
   * which can be as small as exactly ONE encoder 'chunk' message. A 'chunk'
   * message is atomic — one whole access unit's leading non-VCL run AND its
   * coded slice always arrive together in a single postMessage
   * (`exportWorker.ts`'s `encoder.encode` -> `output` callback fires once
   * per input frame) — so the SMALLEST realistic batch is exactly one
   * picture's own bytes, never a fragment of one. This test measures
   * coverage at THAT granularity, not the whole-stream one the tests above
   * use, closing the gap between what was tested and what production does.
   */
  it('PRODUCTION GRANULARITY: holds even when the batch is exactly ONE picture (the smallest real append batch), at every rotation seam', () => {
    const stream = encoderShapedStream(8);
    let uncheckpointable = 0;
    for (let p = 1; p < 8; p++) {
      const seam = accessUnitStartOffset(stream, p);
      const nextSeam = p + 1 < 8 ? accessUnitStartOffset(stream, p + 1) : stream.length;
      // Exactly picture p's own bytes — the smallest possible first
      // post-rotation batch, not the whole remaining stream.
      const onePictureBatch = stream.subarray(seam, nextSeam);
      const offset = fenceSafeCheckpointOffset(seam, onePictureBatch);
      if (offset === null) {
        uncheckpointable++;
        continue;
      }
      expect(fenceAcceptsPrefix(stream, offset), `picture ${p}`).toBe(true);
      expect(countAnnexbAccessUnits(stream.subarray(0, offset)).pictures, `picture ${p}`).toBe(p);
    }
    // The finding this test exists to record: for realistic encoder-shaped
    // content (AUD before every slice, SPS/PPS only at stream start — see
    // `encoderShapedStream`'s own doc comment), coverage is TOTAL even at
    // the smallest real batch granularity. This is not content-dependent —
    // it follows from every access unit carrying at least a leading AUD,
    // which `avc: { format: 'annexb' }` guarantees per `encoderSessionPlan
    // .ts`'s own doc comment. Confirmed here against the synthetic
    // realistic fixture; NOT independently confirmed against real
    // VideoToolbox/software-encoder output — see this round's report.
    expect(uncheckpointable).toBe(0);
  });

  it('declines when the post-seam bytes open directly on a coded slice', () => {
    // No leading parameter sets: the only candidate offset is the seam, which
    // the fence rejects — so there is no checkpoint to write.
    const stream = encoderShapedStream(4);
    const seam = accessUnitStartOffset(stream, 2);
    const sliceStart = scanAnnexbNals(stream).find((n) => n.start >= seam && (n.nalType === 1 || n.nalType === 5))!.start;
    expect(firstVclNalIndex(stream.subarray(sliceStart))).toBe(0);
    expect(fenceSafeCheckpointOffset(seam, stream.subarray(sliceStart))).toBeNull();
  });

  it('declines when the post-seam bytes hold no coded slice at all', () => {
    const stream = encoderShapedStream(4);
    const seam = accessUnitStartOffset(stream, 2);
    const paramSetsOnly = stream.subarray(seam, seam + 8);
    expect(firstVclNalIndex(paramSetsOnly)).toBeNull();
    expect(fenceSafeCheckpointOffset(seam, paramSetsOnly)).toBeNull();
  });

  it('declines a nonsensical seam offset rather than producing one', () => {
    const stream = encoderShapedStream(4);
    expect(fenceSafeCheckpointOffset(-1, stream)).toBeNull();
    expect(fenceSafeCheckpointOffset(1.5, stream)).toBeNull();
  });
});
