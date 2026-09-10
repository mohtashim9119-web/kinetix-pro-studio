import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import {
  buildSyntheticMultiSliceAnnexb,
  buildSyntheticSingleSliceWithParamSets,
  buildSyntheticSingleSliceWithTrailingAud,
  buildSyntheticVariableSliceAnnexb,
  concatFrameCountGuardFails,
  countAnnexbAccessUnits,
  countAnnexbFrames,
  countAnnexbVclNalsRaw,
  formatConcatFrameCountMismatch,
  isFinalAccessUnitProvablyComplete,
  scanAnnexbNals,
  truncateAnnexbToLastCompleteAu,
} from './annexbFrameCount';

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function vclNals(bytes: Uint8Array) {
  return scanAnnexbNals(bytes).filter((n) => n.nalType === 1 || n.nalType === 5);
}

function pictureSliceCounts(bytes: Uint8Array): number[] {
  const vcls = vclNals(bytes);
  const perPic: number[] = [];
  let n = 0;
  for (const nal of vcls) {
    const first = bytes.subarray(nal.header + 1, nal.end);
    // first_mb 0 encodes as UE `1`, so the high bit of the first payload byte is set.
    const startsPicture = ((first[0] ?? 0) & 0x80) !== 0;
    if (startsPicture && n > 0) {
      perPic.push(n);
      n = 0;
    }
    n += 1;
  }
  if (n > 0) perPic.push(n);
  return perPic;
}

describe('annexbFrameCount — access-unit counting', () => {
  it('multi-slice fixture (8 slices/picture) → correct picture count', () => {
    const stream = buildSyntheticMultiSliceAnnexb(10, 8);
    const measured = countAnnexbAccessUnits(stream);
    expect(measured.pictures).toBe(10);
    expect(measured.vclNals).toBe(80);
    expect(countAnnexbFrames(stream)).toBe(10);
  });

  it('single-slice fixture → unchanged picture count', () => {
    const stream = buildSyntheticSingleSliceWithParamSets(12);
    const measured = countAnnexbAccessUnits(stream);
    expect(measured.pictures).toBe(12);
    expect(measured.vclNals).toBe(12);
  });

  it('repeated SPS/PPS/AUD/SEI → not counted as pictures', () => {
    const stream = buildSyntheticMultiSliceAnnexb(3, 1);
    const measured = countAnnexbAccessUnits(stream);
    expect(measured.pictures).toBe(3);
    expect(measured.vclNals).toBe(3);
  });

  it('genuine short-by-one stream → guard still aborts', () => {
    const stream = buildSyntheticSingleSliceWithParamSets(9);
    const measured = countAnnexbAccessUnits(stream);
    expect(measured.pictures).toBe(9);
    expect(concatFrameCountGuardFails(measured, 10)).toBe(true);
    expect(concatFrameCountGuardFails(measured, 9)).toBe(false);
  });

  describe('destructive probe — access-unit vs raw VCL counter', () => {
    const stream = buildSyntheticMultiSliceAnnexb(5, 8);

    it('with access-unit counting: pictures=5 (GREEN)', () => {
      expect(countAnnexbAccessUnits(stream).pictures).toBe(5);
    });

    it('probe revert — raw VCL count=40, guard expected=5 would abort (RED)', () => {
      const rawVcl = countAnnexbVclNalsRaw(stream);
      expect(rawVcl).toBe(40);
      expect(concatFrameCountGuardFails({ pictures: rawVcl, vclNals: rawVcl }, 5)).toBe(true);
    });
  });
});

describe('formatConcatFrameCountMismatch', () => {
  it('includes measured pictures, VCL count, ratio, expected, and per-piece rows', () => {
    const message = formatConcatFrameCountMismatch({
      measured: { pictures: 80767, vclNals: 646136 },
      expectedTotal: 80767,
      pieceCount: 1,
      perPiece: [{
        pieceIndex: 0,
        path: 'piece_0.h264',
        pictures: 80767,
        vclNals: 646136,
        expectedFrames: 80767,
      }],
    });

    expect(message).toContain('measuredPictures=80767');
    expect(message).toContain('measuredVclNals=646136');
    expect(message).toContain('slicesPerPicture≈8.000');
    expect(message).toContain('expectedTotal=80767');
    expect(message).toContain('pieceCount=1');
    expect(message).toContain('piece_0.h264: pictures=80767 vclNals=646136 expected=80767');
  });
});

describe('annexb truncate — last complete access unit', () => {
  const PICTURES = 4;
  const SLICES = 8;
  const stream = buildSyntheticMultiSliceAnnexb(PICTURES, SLICES);
  const vcls = vclNals(stream);

  it('fixture layout: 4 pictures × 8 slices', () => {
    expect(vcls).toHaveLength(32);
    expect(countAnnexbAccessUnits(stream)).toEqual({ pictures: 4, vclNals: 32 });
  });

  it('mid-NAL (slice 5 of picture 2) drops the incomplete picture; no partial survives', () => {
    const slice5 = vcls[2 * SLICES + 5]!;
    const cut = slice5.header + 2;
    const truncated = stream.subarray(0, cut);
    const result = truncateAnnexbToLastCompleteAu(truncated);
    expect(result.pictures).toBe(2);
    expect(result.vclNals).toBe(16);
    expect(pictureSliceCounts(result.bytes)).toEqual([8, 8]);
    expect(countAnnexbAccessUnits(result.bytes).pictures).toBe(2);
    expect(result.bytesRemoved).toBeGreaterThan(0);
  });

  it('mid-picture at the start of slice 5 of 8 drops the incomplete picture', () => {
    const slice5 = vcls[2 * SLICES + 5]!;
    const truncated = stream.subarray(0, slice5.start);
    const result = truncateAnnexbToLastCompleteAu(truncated);
    expect(result.pictures).toBe(2);
    expect(result.vclNals).toBe(16);
    expect(pictureSliceCounts(result.bytes)).toEqual([8, 8]);
  });

  it('exactly on a picture boundary keeps every complete picture before the cut', () => {
    const firstVclOfPicture2 = vcls[2 * SLICES]!;
    const nals = scanAnnexbNals(stream);
    const prevLast = vcls[2 * SLICES - 1]!;
    const aud = nals.find((n) => n.nalType === 9 && n.start > prevLast.start && n.start < firstVclOfPicture2.start);
    expect(aud).toBeDefined();
    const truncated = stream.subarray(0, aud!.start);
    const result = truncateAnnexbToLastCompleteAu(truncated);
    expect(result.pictures).toBe(2);
    expect(result.vclNals).toBe(16);
    expect(pictureSliceCounts(result.bytes)).toEqual([8, 8]);
  });

  it('a complete file is a no-op: 0 bytes removed, all pictures kept', () => {
    const result = truncateAnnexbToLastCompleteAu(stream);
    expect(result.pictures).toBe(4);
    expect(result.vclNals).toBe(32);
    expect(result.bytesRemoved).toBe(0);
    expect(result.bytes).toEqual(stream);
  });

  it('a dangling start code after a complete picture is stripped; pictures stay complete', () => {
    const dangling = new Uint8Array(stream.length + 4);
    dangling.set(stream);
    dangling.set([0, 0, 0, 1], stream.length);
    const result = truncateAnnexbToLastCompleteAu(dangling);
    expect(result.pictures).toBe(4);
    expect(result.vclNals).toBe(32);
    expect(result.bytesRemoved).toBe(4);
    expect(pictureSliceCounts(result.bytes)).toEqual([8, 8, 8, 8]);
  });

  it('single-slice file ending on a VCL is not provably complete: last AU is dropped', () => {
    const single = buildSyntheticSingleSliceWithParamSets(12);
    const result = truncateAnnexbToLastCompleteAu(single);
    expect(result.pictures).toBe(11);
    expect(result.vclNals).toBe(11);
    expect(result.bytesRemoved).toBeGreaterThan(0);
  });
});

describe('annexb truncate — variable slices per picture (mode rule)', () => {
  const SLICE_COUNTS = [8, 8, 4, 8] as const;

  it('complete 8/8/4/8 stream is a no-op: keeps every picture', () => {
    const stream = buildSyntheticVariableSliceAnnexb(SLICE_COUNTS);
    expect(countAnnexbAccessUnits(stream)).toEqual({ pictures: 4, vclNals: 28 });
    expect(pictureSliceCounts(stream)).toEqual([8, 8, 4, 8]);

    const result = truncateAnnexbToLastCompleteAu(stream);
    expect(result.pictures).toBe(4);
    expect(result.vclNals).toBe(28);
    expect(result.bytesRemoved).toBe(0);
    expect(pictureSliceCounts(result.bytes)).toEqual([8, 8, 4, 8]);
  });

  it('mid-NAL in the final 8-slice picture drops the incomplete picture only', () => {
    const stream = buildSyntheticVariableSliceAnnexb(SLICE_COUNTS);
    const vcls = vclNals(stream);
    const slice5OfLast = vcls[8 + 8 + 4 + 5]!;
    const truncated = stream.subarray(0, slice5OfLast.header + 2);

    const result = truncateAnnexbToLastCompleteAu(truncated);
    expect(result.pictures).toBe(3);
    expect(result.vclNals).toBe(20);
    expect(pictureSliceCounts(result.bytes)).toEqual([8, 8, 4]);
  });

  it('single-slice stream truncated after first_mb byte drops the incomplete last AU', () => {
    const complete = buildSyntheticSingleSliceWithParamSets(4);
    const vcls = vclNals(complete);
    const fourthFirstSlice = vcls[3]!;
    const truncated = complete.subarray(0, fourthFirstSlice.header + 2);

    expect(countAnnexbAccessUnits(truncated)).toEqual({ pictures: 4, vclNals: 4 });

    const result = truncateAnnexbToLastCompleteAu(truncated);
    expect(result.pictures).toBe(3);
    expect(result.vclNals).toBe(3);
    expect(pictureSliceCounts(result.bytes)).toEqual([1, 1, 1]);
  });
});

describe('synthetic Annex-B byte identity (JS reference hashes)', () => {
  // Locked so the Rust builders in ffmpeg.rs can assert the same digest for
  // the same constructor arguments — JS and Rust then count identical bytes.
  it('JS constructors match the locked SHA-256 digests the Rust tests also assert', () => {
    const cases = [
      { name: '8slice-10pic', bytes: buildSyntheticMultiSliceAnnexb(10, 8), pictures: 10, vclNals: 80 },
      { name: '1slice-12pic', bytes: buildSyntheticSingleSliceWithParamSets(12), pictures: 12, vclNals: 12 },
      { name: 'paramsets-3pic', bytes: buildSyntheticMultiSliceAnnexb(3, 1), pictures: 3, vclNals: 3 },
      { name: 'short-9pic', bytes: buildSyntheticSingleSliceWithParamSets(9), pictures: 9, vclNals: 9 },
    ] as const;
    const locked: Record<string, { len: number; sha256: string }> = {
      '8slice-10pic': { len: 945, sha256: 'efd16ab57ff667563b14ce12bafa3425e5c7802f637d92e4f3565f4475920112' },
      '1slice-12pic': { len: 444, sha256: 'd02aca0757167768f0561f6a8a92632b3dd8ab69266757d2ab88734beb22233c' },
      'paramsets-3pic': { len: 126, sha256: 'b6ce471760350a3545a80ccb54da71441a04c2006c55452b6e00187adfb38894' },
      'short-9pic': { len: 333, sha256: 'c84a5aae5a64f203d9ec02326e84e5296792813de7b4cd35b5ec7ca7404a55aa' },
    };
    const lines: string[] = [];
    for (const c of cases) {
      expect(countAnnexbAccessUnits(c.bytes)).toEqual({ pictures: c.pictures, vclNals: c.vclNals });
      const digest = sha256(c.bytes);
      if (locked[c.name]!.sha256 === 'PENDING') {
        lines.push(`${c.name} len=${c.bytes.byteLength} sha256=${digest}`);
      } else {
        expect(c.bytes.byteLength).toBe(locked[c.name]!.len);
        expect(digest).toBe(locked[c.name]!.sha256);
      }
    }
    if (lines.length > 0) {
      expect(lines.join('\n')).toBe('locked');
    }
  });
});

function pictureStartOffsetsFromCount(bytes: Uint8Array): number[] {
  return scanAnnexbNals(bytes)
    .filter((n) => n.nalType === 1 || n.nalType === 5)
    .filter((n) => {
      const payload = bytes.subarray(n.header + 1, n.end);
      return payload.length > 0 && ((payload[0] ?? 0) & 0x80) !== 0;
    })
    .map((n) => n.start);
}

function pictureStartOffsetsFromGrouping(bytes: Uint8Array): number[] {
  const nals = scanAnnexbNals(bytes);
  const pictures: number[] = [];
  for (const nal of nals) {
    if (nal.nalType !== 1 && nal.nalType !== 5) continue;
    const payload = bytes.subarray(nal.header + 1, nal.end);
    if (payload.length > 0 && ((payload[0] ?? 0) & 0x80) !== 0) {
      pictures.push(nal.start);
    }
  }
  return pictures;
}

describe('conservative final-AU salvage policy', () => {
  const PAYLOAD = 200;

  it('five fixtures: mid-payload, first_mb, complete+dangling, multi-slice, clean', () => {
    const clean = buildSyntheticSingleSliceWithTrailingAud(4, PAYLOAD);
    const vcls = vclNals(clean);
    expect(vcls).toHaveLength(4);

    const last = vcls[3]!;
    const mid = last.header + 2 + Math.floor(PAYLOAD / 2);
    const midResult = truncateAnnexbToLastCompleteAu(clean.subarray(0, mid));
    expect(midResult.pictures).toBe(3);
    expect(midResult.bytesRemoved).toBeGreaterThan(0);

    const afterFirstMb = truncateAnnexbToLastCompleteAu(clean.subarray(0, last.header + 2));
    expect(afterFirstMb.pictures).toBe(3);

    const dangling = new Uint8Array(clean.length + 4);
    dangling.set(clean);
    dangling.set([0, 0, 0, 1], clean.length);
    const completeThenDangling = truncateAnnexbToLastCompleteAu(dangling);
    expect(completeThenDangling.pictures).toBe(4);
    expect(completeThenDangling.bytes).toEqual(clean);

    const multi = buildSyntheticMultiSliceAnnexb(4, 8);
    const mv = vclNals(multi);
    const slice5 = mv[2 * 8 + 5]!;
    expect(truncateAnnexbToLastCompleteAu(multi.subarray(0, slice5.header + 2)).pictures).toBe(2);

    const cleanResult = truncateAnnexbToLastCompleteAu(clean);
    expect(cleanResult.pictures).toBe(4);
    expect(cleanResult.bytesRemoved).toBe(0);
    expect(cleanResult.bytes).toEqual(clean);
  });

  it('predicate: trailing AUD is complete; EOF-ending VCL is not', () => {
    const withAud = buildSyntheticSingleSliceWithTrailingAud(2, 8);
    const nals = scanAnnexbNals(withAud);
    const lastVcl = vclNals(withAud)[1]!;
    expect(isFinalAccessUnitProvablyComplete(nals, lastVcl, withAud)).toBe(true);

    const eofVcl = buildSyntheticSingleSliceWithParamSets(2);
    const eofNals = scanAnnexbNals(eofVcl);
    const eofLast = vclNals(eofVcl)[1]!;
    expect(isFinalAccessUnitProvablyComplete(eofNals, eofLast, eofVcl)).toBe(false);
  });
});

describe('scanner unification — byte-exhaustive picture-boundary agreement', () => {
  it('count path and grouping agree at every byte offset of a small corpus', () => {
    const streams: Array<[string, Uint8Array]> = [
      ['multi-2x2', buildSyntheticMultiSliceAnnexb(2, 2)],
      ['variable-1-3-2', buildSyntheticVariableSliceAnnexb([1, 3, 2])],
      ['paramsets-3', buildSyntheticSingleSliceWithParamSets(3)],
      ['single-aud-2', buildSyntheticSingleSliceWithTrailingAud(2, 8)],
    ];
    for (const [name, stream] of streams) {
      for (let offset = 0; offset <= stream.byteLength; offset++) {
        const prefix = stream.subarray(0, offset);
        expect(pictureStartOffsetsFromCount(prefix), `${name} offset ${offset}`).toEqual(
          pictureStartOffsetsFromGrouping(prefix),
        );
      }
    }
  });
});

