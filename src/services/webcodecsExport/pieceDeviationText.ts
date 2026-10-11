/**
 * Plain-language wording for finished pieces whose picture count differs from
 * the plan (`PieceDeviation`). One place, so the seal prompt, the bulk row
 * notice and the diagnostics all say the same thing.
 */
import type { PieceDeviation } from './exportCheckpoint';

const n = (x: number): string => x.toLocaleString('en-US');

/** "Piece 3: 1,795 frames rendered, 1,796 planned; Piece 5: …" (pieces shown 1-based). */
export function describePieceDeviations(deviations: readonly PieceDeviation[]): string {
  return deviations
    .map((d) => `Piece ${d.pieceIndex + 1}: ${n(d.counted)} frames rendered, ${n(d.expected)} planned`)
    .join('; ');
}

/** One frame at this export's frame rate, in whole milliseconds. */
export function frameShiftMs(fps: number): number {
  return Math.round(1000 / fps);
}

/**
 * The bulk row's notice for a deliverable that was saved with recorded
 * deviations, or `null` when there were none. Never fails the row.
 */
export function bulkDeviationNote(offer: { deviatingPieces?: readonly PieceDeviation[]; fps: number }): string | null {
  const devs = offer.deviatingPieces;
  if (!devs || devs.length === 0) return null;
  return `${describePieceDeviations(devs)}. ${frameShiftSentence(offer.fps)}`;
}

/** What a deviation does to the sound: everything after the piece moves by its frame difference. */
export function frameShiftSentence(fps: number): string {
  return (
    `Everything after each of these is shifted against the voiceover by that frame difference ` +
    `(1 frame is about ${frameShiftMs(fps)} ms at ${fps} fps): earlier where frames were lost, later where frames were added.`
  );
}
