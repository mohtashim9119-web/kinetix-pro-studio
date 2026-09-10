/**
 * Reading the H.264 parameter sets out of an Annex-B stream, and comparing two
 * encoders' answers.
 *
 * WS3 Round 10, Blocker 4. Mixed-rung concatenation — a piece encoded with
 * `prefer-hardware` followed by one encoded with `prefer-software`, which is
 * exactly what Rung 5a's failover produces mid-export — is only safe if the
 * decoder can follow the parameter-set change across the join. Our own
 * picture-accurate counter cannot see a profile mismatch at all (it counts
 * `first_mb_in_slice == 0` VCL NALs and never opens an SPS), so a silent
 * corruption here would pass every guard the export has.
 *
 * This module is the instrument, not the answer: the answer needs two real
 * encoders, and lives in `src/dev/parameterSetSpike/`. Everything here is pure
 * bit-reading over bytes, so it is unit-testable without WebCodecs.
 */

/** Fields of `seq_parameter_set_rbsp` that decide decoder compatibility. */
export interface SpsSummary {
  profileIdc: number;
  /** constraint_set0..5 flags, in order. */
  constraintFlags: boolean[];
  levelIdc: number;
  seqParameterSetId: number;
  /** Present only for high-ish profiles; `null` when the profile omits it. */
  chromaFormatIdc: number | null;
  bitDepthLumaMinus8: number | null;
  bitDepthChromaMinus8: number | null;
}

export interface PpsSummary {
  picParameterSetId: number;
  seqParameterSetId: number;
  entropyCodingModeFlag: boolean;
}

export interface ParameterSetSummary {
  sps: SpsSummary | null;
  pps: PpsSummary | null;
  /** Every distinct SPS payload seen, hex-encoded — repeats collapsed. */
  spsPayloadsHex: string[];
  ppsPayloadsHex: string[];
}

class BitReader {
  private pos = 0;
  constructor(private readonly bytes: Uint8Array) {}
  bit(): number {
    const byteIdx = this.pos >> 3;
    if (byteIdx >= this.bytes.length) return 0;
    const bitIdx = 7 - (this.pos & 7);
    this.pos++;
    return (this.bytes[byteIdx]! >> bitIdx) & 1;
  }
  bits(n: number): number {
    let v = 0;
    for (let i = 0; i < n; i++) v = (v << 1) | this.bit();
    return v;
  }
  ue(): number {
    let zeros = 0;
    while (this.bit() === 0) {
      zeros++;
      if (zeros > 32) return 0;
    }
    let value = (1 << zeros) - 1;
    for (let i = zeros - 1; i >= 0; i--) value += this.bit() << i;
    return value;
  }
  se(): number {
    const k = this.ue();
    return k % 2 === 0 ? -(k / 2) : (k + 1) / 2;
  }
}

/** Strip emulation-prevention bytes (`00 00 03` -> drop the `03`). */
export function rbspFromNal(payload: Uint8Array): Uint8Array {
  const out: number[] = [];
  for (let i = 0; i < payload.length; i++) {
    if (i >= 2 && payload[i] === 0x03 && payload[i - 1] === 0 && payload[i - 2] === 0) continue;
    out.push(payload[i]!);
  }
  return new Uint8Array(out);
}

/** Profiles whose SPS carries chroma_format_idc and the bit-depth fields. */
const EXTENDED_SPS_PROFILES = new Set([100, 110, 122, 244, 44, 83, 86, 118, 128, 138, 139, 134, 135]);

/** `payload` excludes the NAL header byte. */
export function parseSps(payload: Uint8Array): SpsSummary | null {
  const rbsp = rbspFromNal(payload);
  if (rbsp.length < 3) return null;
  const r = new BitReader(rbsp);
  const profileIdc = r.bits(8);
  const constraintFlags = [r.bit(), r.bit(), r.bit(), r.bit(), r.bit(), r.bit()].map((b) => b === 1);
  r.bits(2); // reserved_zero_2bits
  const levelIdc = r.bits(8);
  const seqParameterSetId = r.ue();
  let chromaFormatIdc: number | null = null;
  let bitDepthLumaMinus8: number | null = null;
  let bitDepthChromaMinus8: number | null = null;
  if (EXTENDED_SPS_PROFILES.has(profileIdc)) {
    chromaFormatIdc = r.ue();
    if (chromaFormatIdc === 3) r.bit(); // separate_colour_plane_flag
    bitDepthLumaMinus8 = r.ue();
    bitDepthChromaMinus8 = r.ue();
    r.bit(); // qpprime_y_zero_transform_bypass_flag
    if (r.bit() === 1) {
      // seq_scaling_matrix_present_flag
      const lists = chromaFormatIdc !== 3 ? 8 : 12;
      for (let i = 0; i < lists; i++) {
        if (r.bit() === 1) {
          const size = i < 6 ? 16 : 64;
          let lastScale = 8;
          let nextScale = 8;
          for (let j = 0; j < size; j++) {
            if (nextScale !== 0) nextScale = (lastScale + r.se() + 256) % 256;
            lastScale = nextScale === 0 ? lastScale : nextScale;
          }
        }
      }
    }
  }
  return {
    profileIdc, constraintFlags, levelIdc, seqParameterSetId,
    chromaFormatIdc, bitDepthLumaMinus8, bitDepthChromaMinus8,
  };
}

/** `payload` excludes the NAL header byte. */
export function parsePps(payload: Uint8Array): PpsSummary | null {
  const rbsp = rbspFromNal(payload);
  if (rbsp.length < 1) return null;
  const r = new BitReader(rbsp);
  const picParameterSetId = r.ue();
  const seqParameterSetId = r.ue();
  const entropyCodingModeFlag = r.bit() === 1;
  return { picParameterSetId, seqParameterSetId, entropyCodingModeFlag };
}

function hex(bytes: Uint8Array): string {
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Pull the first SPS/PPS out of an Annex-B buffer, plus every distinct
 * parameter-set payload it contains (so a stream that CHANGES parameter sets
 * mid-way is visible as more than one entry).
 */
export function summarizeParameterSets(
  bytes: Uint8Array,
  scan: (b: Uint8Array) => { start: number; header: number; end: number; nalType: number }[],
): ParameterSetSummary {
  const spsPayloadsHex: string[] = [];
  const ppsPayloadsHex: string[] = [];
  let sps: SpsSummary | null = null;
  let pps: PpsSummary | null = null;
  for (const nal of scan(bytes)) {
    const payload = bytes.subarray(nal.header + 1, nal.end);
    if (nal.nalType === 7) {
      const h = hex(payload);
      if (!spsPayloadsHex.includes(h)) spsPayloadsHex.push(h);
      sps ??= parseSps(payload);
    } else if (nal.nalType === 8) {
      const h = hex(payload);
      if (!ppsPayloadsHex.includes(h)) ppsPayloadsHex.push(h);
      pps ??= parsePps(payload);
    }
  }
  return { sps, pps, spsPayloadsHex, ppsPayloadsHex };
}

export interface ParameterSetDifference {
  field: string;
  a: unknown;
  b: unknown;
}

/**
 * Every field on which two encoders' parameter sets disagree.
 *
 * An empty array means the two rungs are interchangeable at the parameter-set
 * level. A `profileIdc` or `entropyCodingModeFlag` disagreement is the
 * dangerous kind: a decoder that has latched the first piece's profile may
 * mis-parse the second's slices.
 */
export function diffParameterSets(
  a: ParameterSetSummary,
  b: ParameterSetSummary,
): ParameterSetDifference[] {
  const out: ParameterSetDifference[] = [];
  const push = (field: string, av: unknown, bv: unknown): void => {
    if (JSON.stringify(av) !== JSON.stringify(bv)) out.push({ field, a: av, b: bv });
  };
  push('sps.present', a.sps !== null, b.sps !== null);
  if (a.sps && b.sps) {
    push('sps.profileIdc', a.sps.profileIdc, b.sps.profileIdc);
    push('sps.constraintFlags', a.sps.constraintFlags, b.sps.constraintFlags);
    push('sps.levelIdc', a.sps.levelIdc, b.sps.levelIdc);
    push('sps.seqParameterSetId', a.sps.seqParameterSetId, b.sps.seqParameterSetId);
    push('sps.chromaFormatIdc', a.sps.chromaFormatIdc, b.sps.chromaFormatIdc);
    push('sps.bitDepthLumaMinus8', a.sps.bitDepthLumaMinus8, b.sps.bitDepthLumaMinus8);
    push('sps.bitDepthChromaMinus8', a.sps.bitDepthChromaMinus8, b.sps.bitDepthChromaMinus8);
  }
  push('pps.present', a.pps !== null, b.pps !== null);
  if (a.pps && b.pps) {
    push('pps.picParameterSetId', a.pps.picParameterSetId, b.pps.picParameterSetId);
    push('pps.seqParameterSetId', a.pps.seqParameterSetId, b.pps.seqParameterSetId);
    push('pps.entropyCodingModeFlag', a.pps.entropyCodingModeFlag, b.pps.entropyCodingModeFlag);
  }
  push('sps.payloadBytes', a.spsPayloadsHex, b.spsPayloadsHex);
  push('pps.payloadBytes', a.ppsPayloadsHex, b.ppsPayloadsHex);
  return out;
}
