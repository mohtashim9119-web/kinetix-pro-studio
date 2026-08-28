/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// ---------------------------------------------------------------------------
// WS2 T2.1 Commit 4 — split (S) and delete (D) for restored/split segments.
//
// SPLIT creates two slice-id children of the segment being split
// (`makeSliceSegmentId(parentId, 0|1)`), text divided at the word boundary
// nearest the proportional time split — never a mid-word cut.
//
// DELETE removes a split slice or a restored segment ONLY — never an
// unsplit native segment (matched from real audio, never dropped/restored/
// split) and never the last remaining slice of a split pair/group (deleting
// every slice a split produced would silently erase real timeline content
// with nothing left to represent it; Ctrl+Z/undo is the intended way back
// from a split, not deleting down to zero slices).
//
// A RESTORED segment (individually, keeping its own original dropped id —
// `restoredIds`) is always deletable with no "last remaining" restriction:
// deleting it is equivalent to un-restoring it (the time and text simply
// return to the neighbour that absorbs it, exactly as before the restore),
// which never destroys content that has no other representation. A MERGED
// restore slot (a slice id, `makeSliceSegmentId(hostId, 0)`, from the
// sub-frame-cluster rule) is, by this module's own last-remaining-slice
// rule, NOT independently deletable via D — it has no sibling slice by
// construction, so the rule that protects a split's last piece also
// (deliberately, not by omission) protects a merged restore from D; use
// undo to remove one. Documented here as a known, considered simplification
// rather than re-derived per call.
// ---------------------------------------------------------------------------

import type { VideoSegment } from '../types';
import { makeSliceSegmentId, isSliceSegmentId } from './segmentId';

const MIN_SEGMENT_DURATION = 0.1;

function round3(v: number): number {
  return Number(v.toFixed(3));
}

/** Extracts the parent id from a slice id (`slice1_<parentId>::<ordinal>`),
 *  or `null` if `id` is not a slice id. */
export function parentIdFromSliceId(id: string): string | null {
  if (!isSliceSegmentId(id)) return null;
  const withoutPrefix = id.slice('slice1_'.length);
  const sepIdx = withoutPrefix.lastIndexOf('::');
  return sepIdx < 0 ? null : withoutPrefix.slice(0, sepIdx);
}

/** Splits `text` into two pieces at the WHITESPACE RUN nearest
 *  `text.length * t` — never inside a word. Returns `['', '']`-shaped
 *  degenerate output (empty second half) when `text` has no whitespace to
 *  split on at all (a single "word" with no boundary to cut). */
function splitTextAtProportion(text: string, t: number): [string, string] {
  const clampedT = Math.min(Math.max(t, 0), 1);
  const targetIdx = text.length * clampedT;

  let bestCutIdx = -1;
  let bestDist = Infinity;
  const re = /\s+/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const cutIdx = m.index + m[0].length; // just after the whitespace run
    const dist = Math.abs(cutIdx - targetIdx);
    if (dist < bestDist) {
      bestDist = dist;
      bestCutIdx = cutIdx;
    }
  }
  if (bestCutIdx < 0) return [text.trim(), ''];
  return [text.slice(0, bestCutIdx).trim(), text.slice(bestCutIdx).trim()];
}

export interface SplitResult {
  segments: VideoSegment[];
  /** False when the split was refused (no room for two
   *  MIN_SEGMENT_DURATION-sized pieces, or the text has no word boundary to
   *  cut at) — `segments` is then the original array, unchanged. */
  split: boolean;
}

/**
 * Splits `segments[index]` at `splitTime` (an absolute timeline time) into
 * two new slice segments, replacing the original in place. The split point
 * is clamped so both pieces are at least `MIN_SEGMENT_DURATION`; refused
 * entirely (no-op) when the segment is too short to hold two such pieces, or
 * when its text has no whitespace to cut at.
 *
 * Pure — returns a new array; does not mutate `segments`.
 */
export function splitSegmentAtTime(
  segments: readonly VideoSegment[],
  index: number,
  splitTime: number,
): SplitResult {
  const target = segments[index];
  if (!target) return { segments: segments as VideoSegment[], split: false };

  const start = target.startTime;
  const end = round3(start + target.duration);
  if (end - start < 2 * MIN_SEGMENT_DURATION) {
    return { segments: segments as VideoSegment[], split: false };
  }

  const clampedSplit = Math.min(Math.max(splitTime, start + MIN_SEGMENT_DURATION), end - MIN_SEGMENT_DURATION);
  const t = (clampedSplit - start) / (end - start);
  const [textA, textB] = splitTextAtProportion(target.text ?? '', t);
  if (!textB) {
    return { segments: segments as VideoSegment[], split: false };
  }

  const durationA = round3(clampedSplit - start);
  const durationB = round3(end - clampedSplit);

  const a: VideoSegment = { ...target, id: makeSliceSegmentId(target.id, 0), text: textA, startTime: start, duration: durationA };
  const b: VideoSegment = { ...target, id: makeSliceSegmentId(target.id, 1), text: textB, startTime: clampedSplit, duration: durationB };

  const out = segments.map(s => ({ ...s }));
  out.splice(index, 1, a, b);
  return { segments: out, split: true };
}

export interface DeleteResult {
  segments: VideoSegment[];
  /** False when the delete was refused (an unsplit native segment, or the
   *  last remaining slice of a split/cluster) — `segments` is then the
   *  original array, unchanged. */
  deleted: boolean;
}

/**
 * Deletes `segments[index]` — a split slice or an individually-restored
 * segment ONLY (see this module's header for the merged-restore-slot
 * exception, and for why an individually-restored segment carries no
 * "last remaining" restriction). `restoredIds` names every segment id known
 * to be an individually-restored segment (its own original dropped id,
 * not a slice id) — typically every key of `Project.segmentOverrides`.
 *
 * The freed time goes to a same-cluster sibling (an adjacent segment
 * sharing the same slice parent id) when one exists, preferring the
 * PREVIOUS one; otherwise to the "downstream absorber" — the next segment,
 * or the previous segment if this was the last one on the timeline.
 *
 * Pure — returns a new array; does not mutate `segments`.
 */
export function deleteSegment(
  segments: readonly VideoSegment[],
  index: number,
  restoredIds: ReadonlySet<string>,
): DeleteResult {
  const target = segments[index];
  if (!target) return { segments: segments as VideoSegment[], deleted: false };

  const parentId = parentIdFromSliceId(target.id);
  const isIndividuallyRestored = parentId === null && restoredIds.has(target.id);
  if (parentId === null && !isIndividuallyRestored) {
    return { segments: segments as VideoSegment[], deleted: false }; // unsplit native segment
  }
  if (parentId !== null) {
    const hasSibling = segments.some((s, i) => i !== index && parentIdFromSliceId(s.id) === parentId);
    if (!hasSibling) {
      return { segments: segments as VideoSegment[], deleted: false }; // last remaining slice
    }
  }

  const out = segments.map(s => ({ ...s }));
  const freedStart = out[index]!.startTime;
  const freedDuration = out[index]!.duration;

  const prev = index > 0 ? out[index - 1] : undefined;
  const next = index < out.length - 1 ? out[index + 1] : undefined;
  const prevIsSibling = !!prev && parentId !== null && parentIdFromSliceId(prev.id) === parentId;
  const nextIsSibling = !!next && parentId !== null && parentIdFromSliceId(next.id) === parentId;

  if (prevIsSibling && prev) {
    prev.duration = round3(prev.duration + freedDuration);
  } else if (nextIsSibling && next) {
    next.startTime = round3(freedStart);
    next.duration = round3(next.duration + freedDuration);
  } else if (next) {
    next.startTime = round3(freedStart);
    next.duration = round3(next.duration + freedDuration);
  } else if (prev) {
    prev.duration = round3(prev.duration + freedDuration);
  }
  // else: sole segment on the timeline — unreachable in practice (a slice
  // or restored segment implies a native/host segment exists alongside it).

  out.splice(index, 1);
  return { segments: out, deleted: true };
}
