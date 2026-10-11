/**
 * Encoder-gap detection: after a COMPLETED `VideoEncoder.flush()` every frame
 * handed to `encode()` has produced exactly one chunk (WebCodecs delivers all
 * pending outputs before flush resolves; H.264 with `avc.format: 'annexb'` is
 * one chunk per frame, reorder depth only delays chunks, never removes them).
 * Fewer chunks than frames therefore means the encoder swallowed a frame — the
 * field defect that left pieces one picture short.
 *
 * Never a gap: a session fenced by a flush-timeout salvage (its late chunks are
 * dropped on purpose and not counted), more chunks than frames, or nothing
 * submitted yet.
 */
export interface EncoderGap {
  submitted: number;
  emitted: number;
  sessionIndex: number;
}

export function detectEncoderGap(p: {
  submitted: number;
  emitted: number;
  fencedSessions: number;
  sessionIndex: number;
}): EncoderGap | null {
  if (p.fencedSessions > 0) return null;
  if (p.submitted <= 0 || p.emitted >= p.submitted) return null;
  return { submitted: p.submitted, emitted: p.emitted, sessionIndex: p.sessionIndex };
}
