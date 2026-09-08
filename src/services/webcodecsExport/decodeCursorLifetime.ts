/**
 * Decode-cursor lifetime for the WebCodecs export worker.
 *
 * A cursor is per-segment (not per-asset). Export's playhead is strictly
 * monotone (`runStartSec + i / fps`), so a segment is never revisited after
 * the playhead has left it — including its outgoing centered-transition tail.
 * Incoming lookahead (a later segment read before its startTime) is the
 * first-open case, not a reopen.
 *
 * Invariant: at most MAX_SIMULTANEOUS_OPEN_DECODE_CURSORS cursors are live
 * at once. deriveSlotPlan returns at most two segments (plan.a / plan.b) for
 * any currentTime, and this module releases every cursor whose last-needed
 * time has passed, so the high-water mark cannot exceed that pair.
 */

import { TransitionType, type VideoSegment } from '../../types';
import { resolveEffectiveTransition } from '../transitionResolver';
import type { ProjectEffectConfig } from '../gl/compositeParams';

/** Maximum decode cursors that may be open at one instant. */
export const MAX_SIMULTANEOUS_OPEN_DECODE_CURSORS = 2;

const CONTIGUITY_EPSILON_S = 0.001;

/** Same four slugs compositeParams.ts / glCompositable.ts treat as live GL blends. */
const GL_TRANSITION_SLUGS: ReadonlySet<string> = new Set([
  'cross-dissolve',
  'dip-black',
  'dip-white',
  'light-leak',
]);

function findNextSegment(
  segments: readonly VideoSegment[],
  segment: VideoSegment,
): VideoSegment | undefined {
  const end = segment.startTime + segment.duration;
  return segments.find(
    (s) => Math.abs(end - s.startTime) < CONTIGUITY_EPSILON_S && s.id !== segment.id,
  );
}

/**
 * Last currentTime at which `segment` can still be plan.a or plan.b.
 *
 * No outgoing GL transition: exclusive end (`start + duration`), matching
 * findContainingSegment's `[start, start+duration)` test.
 *
 * Outgoing centered GL transition of duration D: exclusive window end
 * (`boundary + D/2`), matching resolveTransitionProgress (`currentTime >= end`
 * → inactive). After that instant the outgoing segment is never selected again.
 */
export function cursorLastNeededSec(
  segment: VideoSegment,
  segments: readonly VideoSegment[],
  config: ProjectEffectConfig,
): number {
  const end = segment.startTime + segment.duration;
  const next = findNextSegment(segments, segment);
  if (!next) return end;
  const resolved = resolveEffectiveTransition(segment, config.globalTransition, config.globalTransitionDuration);
  if (resolved.transition === TransitionType.NONE || resolved.duration <= 0) return end;
  if (!GL_TRANSITION_SLUGS.has(resolved.transition)) return end;
  return end + resolved.duration / 2;
}

/**
 * WS3 Defects 6/7 — per-ASSET last-needed time, `assetId -> seconds`.
 *
 * Cursor lifetime is per-SEGMENT, which is right for a decoder but wrong for
 * everything keyed by ASSET: the demux cache entry (`videoDemuxer.ts`) and the
 * decoded `ImageBitmap` both outlive any one segment and were held for the
 * whole run.
 *
 * An asset is finished once the playhead has passed `cursorLastNeededSec` for
 * EVERY segment in the run that references it — hence the max. Taking the max
 * is what makes an asset reused by a later segment safe: its release time is
 * pushed out to that later segment's own last-needed time, so a "revisit" is
 * never a reopen. Segments with no `assetId` contribute nothing.
 *
 * Pure. Same monotone-playhead assumption as `cursorLastNeededSec`, and the
 * same exclusive-end semantics, so this inherits its transition-tail handling
 * rather than restating it.
 */
export function assetLastNeededSecByAsset(
  segments: readonly VideoSegment[],
  config: ProjectEffectConfig,
): Map<string, number> {
  const out = new Map<string, number>();
  for (const seg of segments) {
    if (!seg.assetId) continue;
    const lastNeeded = cursorLastNeededSec(seg, segments, config);
    const prev = out.get(seg.assetId);
    if (prev === undefined || lastNeeded > prev) out.set(seg.assetId, lastNeeded);
  }
  return out;
}

/**
 * Is every asset's SOURCE time non-decreasing across the run?
 *
 * This is the exact — and, on the field shape, unmet — precondition for keying
 * decode cursors by ASSET instead of by SEGMENT.
 *
 * A `DecodeCursor` wraps one `decodeSegmentFrames(url, start, end)` generator,
 * which is forward-only: `frameAt` advances it with `gen.next()` and has no
 * rewind of any kind (`exportWorker.ts`). Timeline time is strictly monotone
 * during export, so a SEGMENT-keyed cursor is always read forward and is always
 * safe. An ASSET-keyed cursor is only safe in addition when consecutive
 * segments sharing that asset also read its SOURCE forward — i.e. segment i+1's
 * `trimStart` is at or after where segment i stopped.
 *
 * Slideshow timelines do not satisfy this: every segment is authored with
 * `trimStart: 0`, so each one restarts the same source range from zero and the
 * sequence is decreasing at every reuse. Returns false there.
 *
 * Pure. Compares `trimStart` only — the quantity that decides direction — so it
 * does not need the asset's duration or the transition tail.
 */
export function assetSourceTimeIsMonotone(segments: readonly VideoSegment[]): boolean {
  const lastEndByAsset = new Map<string, number>();
  for (const seg of [...segments].sort((a, b) => a.startTime - b.startTime)) {
    if (!seg.assetId) continue;
    const start = seg.trimStart || 0;
    const prevEnd = lastEndByAsset.get(seg.assetId);
    // Strictly `start < prevEnd`, not `start < prevStart`: the next segment must
    // begin at or after where the previous one STOPPED reading. Equal trimStarts
    // (the slideshow case, every segment at 0) fail here, which is correct — the
    // second segment needs frames the shared generator has already yielded and
    // cannot produce again.
    if (prevEnd !== undefined && start < prevEnd) return false;
    lastEndByAsset.set(seg.assetId, start + seg.duration);
  }
  return true;
}

export function shouldReleaseDecodeCursor(
  segment: VideoSegment,
  currentTime: number,
  segments: readonly VideoSegment[],
  config: ProjectEffectConfig,
): boolean {
  return currentTime >= cursorLastNeededSec(segment, segments, config);
}

/** Per-run cursor map with peak tracking. Close is injected so tests need no VideoDecoder. */
export class DecodeCursorRegistry<T> {
  private readonly map = new Map<string, T>();
  private created = 0;
  private peak = 0;

  get(id: string): T | undefined {
    return this.map.get(id);
  }

  open(id: string, cursor: T): T {
    this.map.set(id, cursor);
    this.created++;
    this.peak = Math.max(this.peak, this.map.size);
    return cursor;
  }

  get size(): number {
    return this.map.size;
  }

  get cursorsCreated(): number {
    return this.created;
  }

  get peakOpenCursors(): number {
    return this.peak;
  }

  ids(): string[] {
    return [...this.map.keys()];
  }

  async releaseStale(
    currentTime: number,
    segments: readonly VideoSegment[],
    config: ProjectEffectConfig,
    close: (cursor: T) => Promise<void>,
  ): Promise<void> {
    const stale: string[] = [];
    for (const id of this.map.keys()) {
      const seg = segments.find((s) => s.id === id);
      if (!seg || shouldReleaseDecodeCursor(seg, currentTime, segments, config)) {
        stale.push(id);
      }
    }
    for (const id of stale) {
      const cursor = this.map.get(id);
      if (!cursor) continue;
      this.map.delete(id);
      await close(cursor);
    }
  }

  async disposeAll(close: (cursor: T) => Promise<void>): Promise<void> {
    const cursors = [...this.map.values()];
    this.map.clear();
    for (const cursor of cursors) await close(cursor);
  }
}
