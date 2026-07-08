import type { HeadingOverlay } from '../types';

/**
 * Path B heading layer (docs/path-b-heading-layer-plan.md, Decision 4).
 * The single shared lookup used by both preview (PreviewStage) and export
 * (frameRenderer/exportPipeline) — no per-caller reimplementation.
 * Start-inclusive / end-exclusive: `t` in [heading.time, heading.time + heading.duration).
 * If multiple headings overlap at `t`, the last one in array order wins.
 */
export function getActiveHeadingAt(headings: HeadingOverlay[], t: number): HeadingOverlay | undefined {
  let active: HeadingOverlay | undefined;
  for (const h of headings) {
    if (t >= h.time && t < h.time + h.duration) {
      active = h;
    }
  }
  return active;
}

/**
 * Decision 2: headings never move on re-sync. If a heading's `time` falls at or
 * past the new voiceoverDuration, clamp it to the duration and flag `needsReview`
 * so the user can fix it — never delete. In-range headings are returned untouched.
 */
export function clampHeadingsToDuration(
  headings: HeadingOverlay[],
  voiceoverDuration: number
): HeadingOverlay[] {
  return headings.map(h => {
    if (h.time < voiceoverDuration) return h;
    return { ...h, time: voiceoverDuration, needsReview: true };
  });
}

const DEFAULT_HEADING_DURATION = 1.0;

/** Factory for a new HeadingOverlay — defaults match Phase 0's pinned visual
 *  parity target: opaque background, 1.0s duration, centered position. */
export function createHeading(
  time: number,
  overrides: Partial<Omit<HeadingOverlay, 'id' | 'time'>> = {}
): HeadingOverlay {
  return {
    id: crypto.randomUUID(),
    time,
    duration: DEFAULT_HEADING_DURATION,
    text: '',
    fontFamily: 'Inter',
    fontSize: 48,
    fontWeight: 'bold',
    color: '#ffffff',
    backgroundColor: '#000000',
    x: 50,
    y: 50,
    ...overrides,
  };
}
