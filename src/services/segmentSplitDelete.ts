/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// ---------------------------------------------------------------------------
// WS2 T2.1 Commit 4 — split (S) and delete (D) for split segments.
//
// SPLIT creates two slice-id children of the segment being split
// (`makeSliceSegmentId(parentId, 0|1)`), text divided at the word boundary
// nearest the proportional time split — never a mid-word cut.
//
// DELETE removes a split slice ONLY — never an unsplit native segment
// (matched from real audio, never split) and never the last remaining slice
// of a split pair/group (deleting every slice a split produced would
// silently erase real timeline content with nothing left to represent it;
// Ctrl+Z/undo is the intended way back from a split, not deleting down to
// zero slices). When the absorbing neighbour is a SIBLING (came from the
// same split as the deleted slice), its text is REUNITED with the deleted
// slice's text in chronological order (`joinAbsorbedText`) — WS2 ws2-28
// Commit 3, operator-approved: a clip that visually re-spans its whole
// original duration must not caption only half of what's spoken. When the
// absorber is NOT a sibling (the downstream/prev fallback, absorbing time
// from an unrelated neighbour), its text is left untouched — concatenating
// two unrelated captions would not make sense.
//
// REMOVED (WS2 ws2-26, round 1 of the operator's revert request): this used
// to also cover restored (absorbed-gap) segments and merged restore slots,
// both always deletable with no "last remaining" restriction since deleting
// either was equivalent to un-restoring it. The whole restore feature was
// removed, so that carve-out no longer applies — a split slice is the only
// deletable shape now.
// ---------------------------------------------------------------------------

import type { VideoSegment } from '../types';
import { makeSliceSegmentId, isSliceSegmentId } from './segmentId';

const MIN_SEGMENT_DURATION = 0.1;

function round3(v: number): number {
  return Number(v.toFixed(3));
}

/**
 * Joins two adjacent slices' text back together in chronological order
 * (`before` = the earlier one) when a delete reunites a SPLIT pair —
 * `deleteSegment`'s sibling-absorption branches only. Trims each side and
 * skips an empty one rather than leaving a stray space, so an empty-text
 * fixture (tests) or a genuinely blank slice never produces `" "`.
 */
function joinAbsorbedText(before: string, after: string): string {
  const a = before.trim();
  const b = after.trim();
  if (!a) return b;
  if (!b) return a;
  return `${a} ${b}`;
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
  /** The id of the segment that absorbed the deleted slice's freed time —
   *  whichever of `prev`/`next` actually had its `duration`/`startTime`
   *  written below. `null` when `deleted` is false. Guaranteed non-null when
   *  `deleted` is true: the "last remaining slice" refusal above already
   *  requires a sibling to exist elsewhere in `segments`, so at least one of
   *  `prev`/`next` is always present once a delete is allowed to proceed.
   *  Exists so a caller (WS2 ws2-28) can redirect a selection that pointed at
   *  the deleted slice to its real successor instead of orphaning it. */
  absorbedById: string | null;
}

/**
 * Deletes `segments[index]` — a split slice ONLY. Never an unsplit native
 * segment, and never the last remaining slice of a split pair/group (see
 * this module's header).
 *
 * The freed time goes to a same-cluster sibling (an adjacent segment
 * sharing the same slice parent id) when one exists, preferring the
 * PREVIOUS one; otherwise to the "downstream absorber" — the next segment,
 * or the previous segment if this was the last one on the timeline. A
 * sibling absorber's TEXT is reunited with the deleted slice's own text
 * (chronological order, `joinAbsorbedText`); a downstream/non-sibling
 * absorber's text is left untouched.
 *
 * Pure — returns a new array; does not mutate `segments`.
 */
export function deleteSegment(
  segments: readonly VideoSegment[],
  index: number,
): DeleteResult {
  const target = segments[index];
  if (!target) return { segments: segments as VideoSegment[], deleted: false, absorbedById: null };

  const parentId = parentIdFromSliceId(target.id);
  if (parentId === null) {
    return { segments: segments as VideoSegment[], deleted: false, absorbedById: null }; // unsplit native segment
  }
  // The "last remaining slice" rule protects a SPLIT pair's last piece —
  // there IS no other representation of that content once it's gone.
  const hasSibling = segments.some((s, i) => i !== index && parentIdFromSliceId(s.id) === parentId);
  if (!hasSibling) {
    return { segments: segments as VideoSegment[], deleted: false, absorbedById: null }; // last remaining slice
  }

  const out = segments.map(s => ({ ...s }));
  const freedStart = out[index]!.startTime;
  const freedDuration = out[index]!.duration;

  const prev = index > 0 ? out[index - 1] : undefined;
  const next = index < out.length - 1 ? out[index + 1] : undefined;
  const prevIsSibling = !!prev && parentIdFromSliceId(prev.id) === parentId;
  const nextIsSibling = !!next && parentIdFromSliceId(next.id) === parentId;

  let absorbedById: string | null = null;
  if (prevIsSibling && prev) {
    prev.duration = round3(prev.duration + freedDuration);
    // `prev` is chronologically BEFORE the deleted slice — its own words
    // first, then the deleted slice's.
    prev.text = joinAbsorbedText(prev.text, target.text);
    absorbedById = prev.id;
  } else if (nextIsSibling && next) {
    next.startTime = round3(freedStart);
    next.duration = round3(next.duration + freedDuration);
    // `next` is chronologically AFTER the deleted slice — the deleted
    // slice's words first, then `next`'s own.
    next.text = joinAbsorbedText(target.text, next.text);
    absorbedById = next.id;
  } else if (next) {
    next.startTime = round3(freedStart);
    next.duration = round3(next.duration + freedDuration);
    absorbedById = next.id;
  } else if (prev) {
    prev.duration = round3(prev.duration + freedDuration);
    absorbedById = prev.id;
  }
  // else: sole segment on the timeline — unreachable in practice (a slice
  // implies a native/host segment exists alongside it); absorbedById stays null.

  out.splice(index, 1);
  return { segments: out, deleted: true, absorbedById };
}

// ---------------------------------------------------------------------------
// WS2 ws2-28 Commit 2 — selection-aware wrappers.
//
// `handleSplitSelectedSegment`/`handleDeleteSegmentById` (App.tsx) used to
// mutate `project.segments` via the two functions above and leave
// `selectedSegmentId` untouched (split) or nulled unconditionally (delete),
// which is exactly the defect `split-text-diagnosis.md` (session ws2-28)
// traces: an open drawer whose target segment was just replaced/removed goes
// through a `segment` prop transition that a caller three components away
// (`BottomDrawer.tsx`) has to render correctly with no way to know a
// "successor" exists. Moving the redirect decision here — right next to the
// mutation that makes it necessary — means App.tsx's handlers only need to
// plumb `setProject`/`setSelectedSegmentId`, and this decision is unit-tested
// exactly as written, not re-derived by a test that could drift from it.
// ---------------------------------------------------------------------------

export interface SplitSelectionResult extends SplitResult {
  /** What `selectedSegmentId` should become after this call. Equal to
   *  `currentSelectedId` unchanged UNLESS the split target (`targetId`) WAS
   *  the current selection AND the split actually happened, in which case it
   *  moves to the first (ordinal 0) resulting slice — the open editor
   *  follows its own content into the split rather than being orphaned. */
  selectedSegmentId: string | null;
}

/**
 * `splitSegmentAtTime`, plus the `selectedSegmentId` redirect described
 * above. Pure — same purity guarantees as `splitSegmentAtTime`.
 */
export function splitSelectedSegment(
  segments: readonly VideoSegment[],
  targetId: string,
  splitTime: number,
  currentSelectedId: string | null,
): SplitSelectionResult {
  const index = segments.findIndex(s => s.id === targetId);
  if (index < 0) {
    return { segments: segments as VideoSegment[], split: false, selectedSegmentId: currentSelectedId };
  }
  const { segments: out, split } = splitSegmentAtTime(segments, index, splitTime);
  if (!split) {
    return { segments: out, split: false, selectedSegmentId: currentSelectedId };
  }
  const selectedSegmentId = currentSelectedId === targetId ? out[index]!.id : currentSelectedId;
  return { segments: out, split: true, selectedSegmentId };
}

export interface DeleteSelectionResult extends DeleteResult {
  /** What `selectedSegmentId` should become after this call. Equal to
   *  `currentSelectedId` unchanged UNLESS the deleted segment (`targetId`)
   *  WAS the current selection AND the delete actually happened, in which
   *  case it moves to `absorbedById` — the segment that just absorbed the
   *  freed span. Reversing ws2-25's "clear to null unconditionally" —
   *  closing a caption editor because a NEIGHBOURING slice was deleted was
   *  never correct on its own terms (operator ruling, ws2-28). */
  selectedSegmentId: string | null;
}

/**
 * `deleteSegment`, plus the `selectedSegmentId` redirect described above.
 * Pure — same purity guarantees as `deleteSegment`.
 */
export function deleteSelectedSegment(
  segments: readonly VideoSegment[],
  targetId: string,
  currentSelectedId: string | null,
): DeleteSelectionResult {
  const index = segments.findIndex(s => s.id === targetId);
  if (index < 0) {
    return { segments: segments as VideoSegment[], deleted: false, absorbedById: null, selectedSegmentId: currentSelectedId };
  }
  const { segments: out, deleted, absorbedById } = deleteSegment(segments, index);
  if (!deleted) {
    return { segments: out, deleted: false, absorbedById: null, selectedSegmentId: currentSelectedId };
  }
  const selectedSegmentId = currentSelectedId === targetId ? absorbedById : currentSelectedId;
  return { segments: out, deleted: true, absorbedById, selectedSegmentId };
}
