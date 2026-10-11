import { describe, it, expect } from 'vitest';
import { bulkDeviationNote, describePieceDeviations } from './pieceDeviationText';

const one = [{ pieceIndex: 2, counted: 1795, expected: 1796 }];

describe('piece deviation wording', () => {
  it('names the piece (1-based) with counted against planned', () => {
    expect(describePieceDeviations(one)).toContain('Piece 3: 1,795 frames rendered, 1,796 planned');
  });

  it('names every piece', () => {
    const text = describePieceDeviations([...one, { pieceIndex: 4, counted: 1679, expected: 1680 }]);
    expect(text).toContain('Piece 3');
    expect(text).toContain('Piece 5');
  });

  it('the bulk note states the one-frame shift in milliseconds at the export fps', () => {
    const note = bulkDeviationNote({ deviatingPieces: one, fps: 30 });
    expect(note).toContain('1 frame');
    expect(note).toContain('33 ms');
    expect(note).toContain('Piece 3');
    const at60 = bulkDeviationNote({ deviatingPieces: one, fps: 60 });
    expect(at60).toContain('17 ms');
  });

  it('an over-plan piece reads as such', () => {
    expect(describePieceDeviations([{ pieceIndex: 0, counted: 1831, expected: 1830 }])).toContain('1,831 frames rendered, 1,830 planned');
  });

  it('no deviations -> no note', () => {
    expect(bulkDeviationNote({ deviatingPieces: [], fps: 30 })).toBeNull();
    expect(bulkDeviationNote({ fps: 30 })).toBeNull();
  });
});
