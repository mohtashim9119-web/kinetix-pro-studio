import { describe, it, expect } from 'vitest';
import {
  buildSyntheticMultiSliceAnnexb,
  buildSyntheticSingleSliceWithParamSets,
  concatFrameCountGuardFails,
  countAnnexbAccessUnits,
  countAnnexbFrames,
  countAnnexbVclNalsRaw,
  formatConcatFrameCountMismatch,
} from './annexbFrameCount';

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
