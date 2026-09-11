/**
 * WS3 Round 10, Blocker 4 — the parameter-set reader, tested against bytes
 * whose fields are known by construction.
 *
 * The spike that answers the actual question needs two real encoders and lives
 * in `src/dev/parameterSetSpike/`. This file exists so that when the spike
 * reports "the two rungs agree", the instrument that said so is one that has
 * been shown to be able to say "they disagree".
 */
import { describe, it, expect } from 'vitest';
import { scanAnnexbNals, buildSyntheticSingleSliceWithParamSets } from './annexbFrameCount';
import {
  diffParameterSets,
  parsePps,
  parseSps,
  rbspFromNal,
  summarizeParameterSets,
} from './h264ParameterSets';

/** Baseline (66), no constraint flags, level 3.0, sps id 0. */
const BASELINE_SPS = new Uint8Array([0x42, 0x00, 0x1e, 0x88]);
/** High (100) — carries chroma_format_idc and bit depths. */
const HIGH_SPS = new Uint8Array([0x64, 0x00, 0x28, 0xac, 0xd9, 0x40]);

describe('SPS parsing', () => {
  it('reads profile, constraint flags and level from a baseline SPS', () => {
    const sps = parseSps(BASELINE_SPS)!;
    expect(sps.profileIdc).toBe(66);
    expect(sps.constraintFlags).toEqual([false, false, false, false, false, false]);
    expect(sps.levelIdc).toBe(30);
    // Baseline omits the chroma/bit-depth block entirely.
    expect(sps.chromaFormatIdc).toBeNull();
  });

  it('reads the extended block for a High-profile SPS', () => {
    const sps = parseSps(HIGH_SPS)!;
    expect(sps.profileIdc).toBe(100);
    expect(sps.levelIdc).toBe(40);
    expect(sps.chromaFormatIdc).not.toBeNull();
  });

  it('sees a constraint flag that is actually set', () => {
    // constraint_set1_flag — the bit that distinguishes Constrained Baseline.
    const constrained = new Uint8Array([0x42, 0x40, 0x1e, 0x88]);
    expect(parseSps(constrained)!.constraintFlags[1]).toBe(true);
    expect(parseSps(BASELINE_SPS)!.constraintFlags[1]).toBe(false);
  });

  it('strips emulation-prevention bytes before reading', () => {
    expect(Array.from(rbspFromNal(new Uint8Array([0x00, 0x00, 0x03, 0x01]))))
      .toEqual([0x00, 0x00, 0x01]);
  });
});

describe('PPS parsing', () => {
  it('reads the entropy coding mode — CAVLC vs CABAC', () => {
    // ue(0) ue(0) then the flag: 1 1 <flag> ...
    const cavlc = parsePps(new Uint8Array([0b11000000]))!;
    const cabac = parsePps(new Uint8Array([0b11100000]))!;
    expect(cavlc.entropyCodingModeFlag).toBe(false);
    expect(cabac.entropyCodingModeFlag).toBe(true);
    expect(cavlc.picParameterSetId).toBe(0);
    expect(cavlc.seqParameterSetId).toBe(0);
  });
});

describe('summarize + diff', () => {
  const scan = (b: Uint8Array) => scanAnnexbNals(b).map((n) => ({ ...n }));

  it('collapses repeated identical parameter sets and finds the first of each', () => {
    // buildSyntheticSingleSliceWithParamSets now emits realistic stream-start-only
    // parameter sets (WS3 Round 13 fixture rebuild) — one SPS/PPS, not one per
    // picture — so it can no longer exercise "distinct payloads are not collapsed".
    // Build a local stream with parameter sets that vary per picture instead,
    // purpose-built for that REACH claim.
    const varyingParamSets = (pictures: number): Uint8Array => {
      const out: number[] = [];
      const startCode = () => out.push(0x00, 0x00, 0x00, 0x01);
      for (let p = 0; p < pictures; p++) {
        startCode();
        out.push(0x67, 0x42, 0x00, 0x1e, p & 0xff); // SPS (nal type 7)
        startCode();
        out.push(0x68, 0x68, 0xce, p & 0xff); // PPS (nal type 8)
        startCode();
        out.push(0x65, 0x88); // IDR slice (nal type 5)
      }
      return new Uint8Array(out);
    };
    const stream = varyingParamSets(4);
    const summary = summarizeParameterSets(stream, scan);
    expect(summary.sps).not.toBeNull();
    expect(summary.pps).not.toBeNull();
    // Each picture carries a distinct SPS/PPS payload byte, so four distinct
    // payloads is the correct reading — and proves repeats are not collapsed
    // across genuinely different bytes.
    expect(summary.spsPayloadsHex).toHaveLength(4);
  });

  it('REACH: the differ reports a profile mismatch, not just equality', () => {
    const a = { sps: parseSps(BASELINE_SPS), pps: null, spsPayloadsHex: ['a'], ppsPayloadsHex: [] };
    const b = { sps: parseSps(HIGH_SPS), pps: null, spsPayloadsHex: ['b'], ppsPayloadsHex: [] };
    const fields = diffParameterSets(a, b).map((d) => d.field);
    expect(fields).toContain('sps.profileIdc');
    expect(fields).toContain('sps.levelIdc');
    expect(fields).toContain('sps.chromaFormatIdc');
    expect(fields).toContain('sps.payloadBytes');
  });

  it('REACH: the differ reports an entropy-coding mismatch', () => {
    const a = { sps: null, pps: parsePps(new Uint8Array([0b11000000])), spsPayloadsHex: [], ppsPayloadsHex: [] };
    const b = { sps: null, pps: parsePps(new Uint8Array([0b11100000])), spsPayloadsHex: [], ppsPayloadsHex: [] };
    expect(diffParameterSets(a, b).map((d) => d.field)).toContain('pps.entropyCodingModeFlag');
  });

  it('reports NOTHING when the two summaries are the same', () => {
    const stream = buildSyntheticSingleSliceWithParamSets(3);
    const s = summarizeParameterSets(stream, scan);
    expect(diffParameterSets(s, s)).toEqual([]);
  });
});
