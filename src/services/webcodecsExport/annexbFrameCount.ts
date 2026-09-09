/**
 * Access-unit (picture) counting for raw Annex-B H.264 streams.
 *
 * The post-concat export guard compares encoded output against an expected
 * picture count. Windows hardware encoders often emit multiple coded slices
 * per picture; counting every VCL NAL (types 1/5) therefore inflates the
 * measured count (e.g. exactly 8×). This module counts PICTURES via
 * `first_mb_in_slice == 0` on each VCL NAL — one increment per access unit.
 */

export interface AnnexbFrameCount {
  pictures: number;
  vclNals: number;
}

export interface PieceFrameCountRow {
  pieceIndex: number;
  path: string;
  pictures: number;
  vclNals: number;
  expectedFrames: number;
}

class BitReader {
  private pos = 0;

  constructor(private readonly bytes: Uint8Array) {}

  readBit(): number {
    const byteIdx = this.pos >> 3;
    if (byteIdx >= this.bytes.length) {
      return 0;
    }
    const bitIdx = 7 - (this.pos & 7);
    this.pos++;
    return (this.bytes[byteIdx]! >> bitIdx) & 1;
  }

  readUE(): number | null {
    let zeros = 0;
    while (this.readBit() === 0) {
      zeros++;
      if (zeros > 32) {
        return null;
      }
    }
    let value = (1 << zeros) - 1;
    for (let i = zeros - 1; i >= 0; i--) {
      value += this.readBit() << i;
    }
    return value;
  }
}

/** Strip H.264 emulation-prevention bytes (`00 00 03` → skip `03`). */
function rbspFromNalPayload(payload: Uint8Array): Uint8Array {
  const out: number[] = [];
  for (let i = 0; i < payload.length; i++) {
    if (i >= 2 && payload[i] === 0x03 && payload[i - 1] === 0 && payload[i - 2] === 0) {
      continue;
    }
    out.push(payload[i]!);
  }
  return new Uint8Array(out);
}

function parseFirstMbInSlice(nalPayload: Uint8Array): number | null {
  if (nalPayload.length === 0) {
    return null;
  }
  const reader = new BitReader(rbspFromNalPayload(nalPayload));
  return reader.readUE();
}

function forEachAnnexbNal(
  bytes: Uint8Array,
  visit: (headerByte: number, payload: Uint8Array) => void,
): void {
  const n = bytes.length;
  const headerIndices: number[] = [];
  let i = 0;
  while (i < n - 2) {
    if (bytes[i] === 0 && bytes[i + 1] === 0 && bytes[i + 2] === 1) {
      const headerIdx = i + 3;
      if (headerIdx < n) {
        headerIndices.push(headerIdx);
      }
      i = headerIdx;
    } else {
      i++;
    }
  }

  for (let k = 0; k < headerIndices.length; k++) {
    const headerIdx = headerIndices[k]!;
    const nextHeader = k + 1 < headerIndices.length
      ? headerIndices[k + 1]! - 3
      : n;
    const payloadStart = headerIdx + 1;
    if (payloadStart >= nextHeader) {
      visit(bytes[headerIdx]!, new Uint8Array());
      continue;
    }
    visit(bytes[headerIdx]!, bytes.subarray(payloadStart, nextHeader));
  }
}

/** Legacy raw VCL NAL counter — every type-1/5 start code, not access units. */
export function countAnnexbVclNalsRaw(bytes: Uint8Array): number {
  let count = 0;
  forEachAnnexbNal(bytes, (headerByte) => {
    const nalType = headerByte & 0x1f;
    if (nalType === 1 || nalType === 5) {
      count++;
    }
  });
  return count;
}

/** Count access units (pictures) and raw VCL NALs in an Annex-B byte stream. */
export function countAnnexbAccessUnits(bytes: Uint8Array): AnnexbFrameCount {
  let pictures = 0;
  let vclNals = 0;

  forEachAnnexbNal(bytes, (headerByte, payload) => {
    const nalType = headerByte & 0x1f;
    if (nalType !== 1 && nalType !== 5) {
      return;
    }
    vclNals++;
    const firstMb = parseFirstMbInSlice(payload);
    if (firstMb === 0) {
      pictures++;
    }
  });

  return { pictures, vclNals };
}

/**
 * Picture count for spike/tests — identical to `countAnnexbAccessUnits().pictures`.
 * Replaces the old type-1/5-per-NAL semantics.
 */
export function countAnnexbFrames(bytes: Uint8Array): number {
  return countAnnexbAccessUnits(bytes).pictures;
}

export function concatFrameCountGuardFails(measured: AnnexbFrameCount, expectedTotal: number): boolean {
  return measured.pictures !== expectedTotal;
}

export function formatConcatFrameCountMismatch(params: {
  measured: AnnexbFrameCount;
  expectedTotal: number;
  pieceCount: number;
  perPiece?: readonly PieceFrameCountRow[];
}): string {
  const { measured, expectedTotal, pieceCount, perPiece } = params;
  const slicesPerPicture = measured.pictures > 0
    ? measured.vclNals / measured.pictures
    : null;
  const sppText = slicesPerPicture === null ? 'n/a' : slicesPerPicture.toFixed(3);

  let message =
    `Concat frame-count guard failed: measuredPictures=${measured.pictures}, ` +
    `measuredVclNals=${measured.vclNals}, slicesPerPicture≈${sppText}, ` +
    `expectedTotal=${expectedTotal}, pieceCount=${pieceCount}.`;

  if (perPiece && perPiece.length > 0) {
    message += ` Per-piece: ${perPiece.map((row) =>
      `${row.path}: pictures=${row.pictures} vclNals=${row.vclNals} expected=${row.expectedFrames}`,
    ).join('; ')}.`;
  }

  message += ' Aborting rather than shipping a corrupt export.';
  return message;
}

// ---------------------------------------------------------------------------
// Synthetic Annex-B builders — shared by unit tests only.
// ---------------------------------------------------------------------------

function writeStartCode(out: number[]): void {
  out.push(0, 0, 0, 1);
}

function writeUe(outBits: number[], value: number): void {
  let tmp = value + 1;
  let bits = 0;
  while (tmp > 1) {
    bits++;
    tmp >>= 1;
  }
  for (let i = 0; i < bits; i++) {
    outBits.push(0);
  }
  outBits.push(1);
  for (let i = bits - 1; i >= 0; i--) {
    outBits.push((value >> i) & 1);
  }
}

function bitsToRbspBytes(bits: number[]): Uint8Array {
  const bytes: number[] = [];
  for (let i = 0; i < bits.length; i += 8) {
    let byte = 0;
    for (let b = 0; b < 8; b++) {
      byte = (byte << 1) | (bits[i + b] ?? 0);
    }
    bytes.push(byte);
  }
  return new Uint8Array(bytes);
}

function writeNal(out: number[], nalType: number, rbsp: Uint8Array, refIdc = 2): void {
  writeStartCode(out);
  out.push(((refIdc & 3) << 5) | (nalType & 0x1f));
  for (const b of rbsp) {
    out.push(b);
  }
}

function writeSliceNal(out: number[], idr: boolean, firstMbInSlice: number): void {
  const bits: number[] = [];
  writeUe(bits, firstMbInSlice);
  writeUe(bits, idr ? 7 : 5);
  writeNal(out, idr ? 5 : 1, bitsToRbspBytes(bits));
}

/** Build N pictures with `slicesPerPicture` coded slices each (synthetic RBSP). */
export function buildSyntheticMultiSliceAnnexb(pictures: number, slicesPerPicture: number): Uint8Array {
  const out: number[] = [];
  writeNal(out, 7, new Uint8Array([0x42, 0x00, 0x1e]));
  writeNal(out, 8, new Uint8Array([0x68, 0xce]));

  for (let p = 0; p < pictures; p++) {
    writeNal(out, 9, new Uint8Array([0xf0]));
    writeNal(out, 6, new Uint8Array([0x05, 0xde, 0xad]));
    for (let s = 0; s < slicesPerPicture; s++) {
      writeSliceNal(out, p === 0 && s === 0, s === 0 ? 0 : 100 + s);
    }
    writeNal(out, 7, new Uint8Array([0x42, 0x00, 0x1e, p & 0xff]));
    writeNal(out, 8, new Uint8Array([0x68, 0xce, p & 0xff]));
  }

  return new Uint8Array(out);
}

/** Build a single-slice-per-picture stream with repeated parameter-set rotation. */
export function buildSyntheticSingleSliceWithParamSets(pictures: number): Uint8Array {
  const out: number[] = [];
  for (let p = 0; p < pictures; p++) {
    writeNal(out, 7, new Uint8Array([0x42, 0x00, 0x1e, p & 0xff]));
    writeNal(out, 8, new Uint8Array([0x68, 0xce, p & 0xff]));
    writeNal(out, 9, new Uint8Array([0xf0]));
    writeNal(out, 6, new Uint8Array([0x05, 0xbe, 0xef]));
    writeSliceNal(out, p === 0, 0);
  }
  return new Uint8Array(out);
}
