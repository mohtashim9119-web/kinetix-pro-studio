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

export const MIN_HEADING_DURATION = 0.3; // seconds — mirrors App.tsx's MIN_SEGMENT_DURATION

/**
 * Path B Phase 4 (docs/path-b-heading-layer-plan.md) — pure resize math for the
 * timeline's edge-drag handles. `edge: 'end'` (right handle) only changes
 * `duration`; `edge: 'start'` (left handle) shifts `time` and inversely adjusts
 * `duration` so the opposite edge (`time + duration`) stays fixed, mirroring how
 * segment start-edge resize works. Clamps to MIN_HEADING_DURATION and time >= 0.
 */
export function resizeHeading(
  original: Pick<HeadingOverlay, 'time' | 'duration'>,
  edge: 'start' | 'end',
  deltaSeconds: number
): { time: number; duration: number } {
  if (edge === 'end') {
    return {
      time: original.time,
      duration: Math.max(MIN_HEADING_DURATION, original.duration + deltaSeconds),
    };
  }
  const maxDelta = original.duration - MIN_HEADING_DURATION;
  const clampedDelta = Math.min(deltaSeconds, maxDelta);
  const time = Math.max(0, original.time + clampedDelta);
  const actualDelta = time - original.time;
  return { time, duration: original.duration - actualDelta };
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
