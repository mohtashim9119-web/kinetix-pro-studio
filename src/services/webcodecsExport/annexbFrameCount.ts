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
// Truncation to the last COMPLETE access unit.
//
// A raw Annex-B file has no moov atom and no NAL length prefixes, so a crash
// mid-write cannot be "repaired" by rewriting container metadata. The only
// salvage is to drop a trailing partial NAL / incomplete picture and keep
// the prefix that is a concatenation of complete access units.
//
// COMPLETE, precisely:
//   - A NAL is complete iff it has a start code + header byte AND either a
//     following start code (so its end is known) OR it is the last NAL in
//     the file (EOF-terminated). A start code with no header byte, or a
//     trailing 00/000/0001 prefix that never became a NAL, is a dangling
//     start code and is discarded.
//   - A picture (access unit) is the VCL NALs from one `first_mb_in_slice==0`
//     up to (but not including) the next. Continuation slices (`first_mb!=0`)
//     belong to that picture. This does NOT assume one slice per picture.
//   - The last picture is kept iff its VCL count equals the mode of the
//     closed pictures' VCL counts (the stream's established slices-per-picture).
//     With no closed pictures, a single trailing picture is kept (a one-picture
//     file that ended on a NAL boundary is assumed complete).
//   - The cut is the first AUD of a dropped picture if one sits after the
//     previous picture's last VCL; otherwise the first VCL of the dropped
//     picture. Trailing SPS/PPS of a KEPT picture stay.
//
// Whether to CALL this after a crash is not this module's decision.
// ---------------------------------------------------------------------------

export interface AnnexbNalSpan {
  /** Index of the first start-code byte (3- or 4-byte). */
  start: number;
  /** Index of the NAL header byte. */
  header: number;
  /** Exclusive end: next NAL start, or `bytes.length` for an EOF-terminated NAL. */
  end: number;
  nalType: number;
}

export interface AnnexbTruncateResult {
  bytes: Uint8Array;
  bytesRemoved: number;
  pictures: number;
  vclNals: number;
}

function modeOf(values: readonly number[]): number | null {
  if (values.length === 0) {
    return null;
  }
  const counts = new Map<number, number>();
  let best = values[0]!;
  let bestN = 0;
  for (const v of values) {
    const n = (counts.get(v) ?? 0) + 1;
    counts.set(v, n);
    if (n > bestN) {
      best = v;
      bestN = n;
    }
  }
  return best;
}

/**
 * Locate Annex-B NAL spans. 4-byte start codes (`00 00 00 01`) are preferred
 * over the 3-byte form they contain. A start code with no header byte is a
 * dangling suffix: it is not emitted as a NAL, but it DOES close the previous
 * NAL so those trailing bytes are not swallowed as payload.
 */
export function scanAnnexbNals(bytes: Uint8Array): AnnexbNalSpan[] {
  const n = bytes.length;
  const starts: { start: number; header: number }[] = [];
  let danglingStart: number | null = null;
  let i = 0;
  while (i + 2 < n) {
    if (bytes[i] === 0 && bytes[i + 1] === 0 && bytes[i + 2] === 1) {
      const start = i > 0 && bytes[i - 1] === 0 ? i - 1 : i;
      const header = i + 3;
      if (header >= n) {
        danglingStart = start;
        break;
      }
      starts.push({ start, header });
      i = header;
    } else {
      i++;
    }
  }

  const nals: AnnexbNalSpan[] = [];
  for (let k = 0; k < starts.length; k++) {
    const { start, header } = starts[k]!;
    const end = k + 1 < starts.length
      ? starts[k + 1]!.start
      : (danglingStart ?? n);
    nals.push({
      start,
      header,
      end,
      nalType: bytes[header]! & 0x1f,
    });
  }
  return nals;
}

interface PictureGroup {
  vcl: AnnexbNalSpan[];
  firstCompleteIndex: number;
}

function groupPictures(nals: readonly AnnexbNalSpan[], bytes: Uint8Array): PictureGroup[] {
  const pictures: PictureGroup[] = [];
  for (let i = 0; i < nals.length; i++) {
    const nal = nals[i]!;
    if (nal.nalType !== 1 && nal.nalType !== 5) {
      continue;
    }
    const payload = bytes.subarray(nal.header + 1, nal.end);
    const firstMb = parseFirstMbInSlice(payload);
    if (firstMb === 0) {
      pictures.push({ vcl: [nal], firstCompleteIndex: i });
    } else if (pictures.length > 0) {
      pictures[pictures.length - 1]!.vcl.push(nal);
    }
  }
  return pictures;
}

function droppedPictureCut(nals: readonly AnnexbNalSpan[], prevLastVcl: AnnexbNalSpan, droppedFirstVcl: AnnexbNalSpan): number {
  for (const nal of nals) {
    if (nal.start <= prevLastVcl.start) {
      continue;
    }
    if (nal.start >= droppedFirstVcl.start) {
      break;
    }
    if (nal.nalType === 9) {
      return nal.start;
    }
  }
  return droppedFirstVcl.start;
}

/**
 * Truncate an Annex-B buffer at the last complete access unit.
 * Never assumes one slice per picture. Returns a copy of the kept prefix.
 */
export function truncateAnnexbToLastCompleteAu(bytes: Uint8Array): AnnexbTruncateResult {
  const nals = scanAnnexbNals(bytes);
  const pictures = groupPictures(nals, bytes);

  if (pictures.length === 0) {
    return { bytes: new Uint8Array(), bytesRemoved: bytes.length, pictures: 0, vclNals: 0 };
  }

  const closedCounts = pictures.slice(0, -1).map((p) => p.vcl.length);
  const spp = modeOf(closedCounts);
  let keepCount = pictures.length;
  const last = pictures[pictures.length - 1]!;
  if (spp !== null && last.vcl.length !== spp) {
    keepCount -= 1;
  }

  if (keepCount <= 0) {
    return { bytes: new Uint8Array(), bytesRemoved: bytes.length, pictures: 0, vclNals: 0 };
  }

  let cut: number;
  if (keepCount < pictures.length) {
    const dropped = pictures[keepCount]!;
    const prev = pictures[keepCount - 1]!;
    const prevLastVcl = prev.vcl[prev.vcl.length - 1]!;
    cut = droppedPictureCut(nals, prevLastVcl, dropped.vcl[0]!);
  } else {
    cut = nals[nals.length - 1]!.end;
  }

  const kept = bytes.subarray(0, cut);
  const measured = countAnnexbAccessUnits(kept);
  return {
    bytes: new Uint8Array(kept),
    bytesRemoved: bytes.length - cut,
    pictures: measured.pictures,
    vclNals: measured.vclNals,
  };
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

/** Build one picture per entry in `slicesPerPicture` (variable slices per picture). */
export function buildSyntheticVariableSliceAnnexb(slicesPerPicture: readonly number[]): Uint8Array {
  const out: number[] = [];
  writeNal(out, 7, new Uint8Array([0x42, 0x00, 0x1e]));
  writeNal(out, 8, new Uint8Array([0x68, 0xce]));

  for (let p = 0; p < slicesPerPicture.length; p++) {
    const spp = slicesPerPicture[p]!;
    writeNal(out, 9, new Uint8Array([0xf0]));
    writeNal(out, 6, new Uint8Array([0x05, 0xde, 0xad]));
    for (let s = 0; s < spp; s++) {
      writeSliceNal(out, p === 0 && s === 0, s === 0 ? 0 : 100 + s);
    }
    writeNal(out, 7, new Uint8Array([0x42, 0x00, 0x1e, p & 0xff]));
    writeNal(out, 8, new Uint8Array([0x68, 0xce, p & 0xff]));
  }

  return new Uint8Array(out);
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
