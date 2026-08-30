/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// ---------------------------------------------------------------------------
// Stable content-derived segment IDs (WS2 Phase 1, T1.2).
//
// `VideoSegment.id` (types.ts) has always existed, but pre-T1.2 it was minted
// fresh with `crypto.randomUUID()` on every Apply Sync — useless as a
// cross-run identity, only a per-render React key. This module replaces that
// with an id derived from the segment's own text, so the same script produces
// the same ids on every re-sync.
//
// Design (owner-selected hybrid, WS2 session ws2-21):
//   - `computeContentKey` is a PURE function of (normalized text, ordinal)
//     where ordinal disambiguates segments that normalize to identical text,
//     assigned in document order. Two parses of the same script produce the
//     same keys.
//   - `assignSegmentIds` uses that key as a JOIN: when a `previousSegments`
//     array is supplied (the project's segments before this Apply Sync run),
//     a freshly-parsed segment whose content key matches one from the
//     previous array carries forward that previous segment's persisted `id`
//     instead of the freshly-computed key. A segment with no match (new text,
//     or the first ever parse) gets the freshly-computed key as its id.
//   - This is what makes the id a "persisted, assign-once" identity rather
//     than a pure hash: once a segment gets an id, it keeps that same id
//     across resyncs for as long as its normalized text keeps producing the
//     same content key, INCLUDING the case where that id predates this
//     module's ids and is not itself content-shaped (e.g. a backfilled
//     pre-T1.2 UUID) — the join only compares content keys, never the id
//     values themselves.
//
// `normalizeForSegmentId` is FROZEN AS `SEGMENT_ID_NORM_V1` — it must not be
// changed by T3.1 or any future matcher/alignment work. The matcher's own
// text normalization (`textNormalize.ts`) is free to evolve independently;
// coupling this module to it would silently change every existing project's
// segment ids the next time that pipeline's normalization rules change. If
// the id-normalization rules themselves ever need to change, ship a new
// `SEGMENT_ID_NORM_V2` function and a new version tag alongside it — never
// edit V1 in place. The version tag is embedded in every id produced here so
// a future rotation is detectable (`id.startsWith('segv2_')` etc.) rather
// than silently changing ids for existing projects on their next load.

export const SEGMENT_ID_NORM_VERSION = 'segv1';

// ---------------------------------------------------------------------------
// Slice ids (WS2 T2.1, gap-absorption restore/split).
//
// A restored or split segment is not a fresh content-derived segment — it is
// a portion of one, carved out of a parent segment's span (an absorbing
// neighbour being split back apart, or a user-initiated timeline split). Its
// identity must survive a re-sync exactly like any other segment id, but it
// must NOT be computed from `computeContentKey` (that would collide with — or
// be indistinguishable from — a fresh segment that happens to have the same
// text) and it must NOT be treated as "missing/legacy" by `backfillSegmentIds`
// (which would blow away the slice relationship on the very next load).
//
// A slice id is therefore its own frozen, independently-versioned shape:
// `SLICE_ID_PREFIX` + the parent's id + a separator + a 0-based ordinal among
// its siblings. It carries no content hash — the parent id plus ordinal is
// already a stable, collision-free join key for as long as the parent id
// itself doesn't change. `isCurrentVersionSegmentId` accepts both shapes so a
// slice id is never mistaken for a legacy/foreign id and rewritten out from
// under it; `SEGMENT_ID_NORM_V1`'s own content-hash path is untouched.
// ---------------------------------------------------------------------------

export const SLICE_ID_PREFIX = 'slice1_';

/** Separator between the parent id and the ordinal. Chosen to not collide
 *  with any character `computeContentKey`/UUID ids produce, so a slice id is
 *  unambiguously splittable back into (parentId, ordinal) if ever needed. */
const SLICE_ID_SEPARATOR = '::';

/** Builds a frozen, deterministic id for the `ordinal`-th slice of `parentId`. */
export function makeSliceSegmentId(parentId: string, ordinal: number): string {
  return `${SLICE_ID_PREFIX}${parentId}${SLICE_ID_SEPARATOR}${ordinal}`;
}

/** True when `id` was produced by `makeSliceSegmentId` (any parent/ordinal). */
export function isSliceSegmentId(id: string): boolean {
  return id.startsWith(SLICE_ID_PREFIX);
}

/**
 * Frozen normalization for id derivation ONLY. Deliberately simpler and
 * independent from `textNormalize.ts`'s alignment-tuned pipeline (contraction
 * expansion, digit reading, etc.) — this only needs to collapse cosmetic
 * differences (case, whitespace, punctuation) that shouldn't mint a new id,
 * not to match spoken audio.
 */
export function normalizeForSegmentId(text: string): string {
  return text
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Deterministic, non-cryptographic 32-bit hash (FNV-1a) — a join key, not a security primitive. */
function fnv1aHex(input: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

/**
 * Content key for one segment's text at a given ordinal (its 0-based rank
 * among prior segments in the same array that normalize to the same text,
 * in document order). Pure — same inputs always produce the same key.
 */
export function computeContentKey(text: string, ordinal: number): string {
  const hash = fnv1aHex(normalizeForSegmentId(text));
  return `${SEGMENT_ID_NORM_VERSION}_${hash}_${ordinal}`;
}

export interface SegmentIdInput {
  text: string;
}

export interface SegmentIdSource {
  id: string;
  text: string;
}

/** Computes each segment's content key in document order, disambiguating duplicates by ordinal. */
function computeContentKeys(segments: readonly SegmentIdInput[]): string[] {
  const seen = new Map<string, number>();
  return segments.map(s => {
    const norm = normalizeForSegmentId(s.text);
    const hash = fnv1aHex(norm);
    const ordinal = seen.get(hash) ?? 0;
    seen.set(hash, ordinal + 1);
    return `${SEGMENT_ID_NORM_VERSION}_${hash}_${ordinal}`;
  });
}

/**
 * Assigns a stable `id` to every segment in `segments`, in document order.
 *
 * - Without `previousSegments`: id = that segment's own content key (fresh
 *   ingest / backfill case).
 * - With `previousSegments`: a segment whose content key matches one from
 *   `previousSegments` carries forward that previous segment's `id`
 *   (persisted-identity join); otherwise it falls back to its own content
 *   key (new or edited text).
 *
 * Pure — does not mutate its inputs. Never touches any field but `id`.
 */
export function assignSegmentIds<T extends SegmentIdInput>(
  segments: readonly T[],
  previousSegments?: readonly SegmentIdSource[],
): (T & { id: string })[] {
  const keys = computeContentKeys(segments);

  let prevIdByKey: Map<string, string> | null = null;
  if (previousSegments && previousSegments.length > 0) {
    const prevKeys = computeContentKeys(previousSegments);
    prevIdByKey = new Map();
    previousSegments.forEach((p, i) => {
      const prevKey = prevKeys[i]!;
      // First segment claims a given key on the previous side — matches
      // computeContentKeys' own document-order-first disambiguation.
      if (!prevIdByKey!.has(prevKey)) {
        prevIdByKey!.set(prevKey, p.id);
      }
    });
  }

  return segments.map((s, i) => {
    const key = keys[i]!;
    const id = prevIdByKey?.get(key) ?? key;
    return { ...s, id };
  });
}

/** True when `id` was produced (or backfilled) by this module's current
 *  content-hash version, OR is a slice id (`makeSliceSegmentId`) — both are
 *  "current, do not touch" shapes for `backfillSegmentIds` purposes; only a
 *  missing/legacy (e.g. pre-T1.2 `crypto.randomUUID()`) id fails this check. */
export function isCurrentVersionSegmentId(id: string): boolean {
  return id.startsWith(`${SEGMENT_ID_NORM_VERSION}_`) || isSliceSegmentId(id);
}

/**
 * One-time backfill for a project loaded from storage: replaces any segment
 * id that is missing or predates this module (e.g. a pre-T1.2
 * `crypto.randomUUID()`) with its content key. A segment that already carries
 * a current-version id is left untouched — this is what makes the backfill
 * idempotent (a second load sees only already-valid ids and changes nothing)
 * and safe to call unconditionally on every load rather than gated on a
 * schema-version check.
 *
 * Content keys (and therefore duplicate-text ordinals) are computed once over
 * the WHOLE array in document order before any replacement, so a segment
 * needing backfill still disambiguates correctly against segments that don't.
 */
export function backfillSegmentIds<T extends SegmentIdInput & { id?: string }>(
  segments: readonly T[],
): (T & { id: string })[] {
  const keys = computeContentKeys(segments);
  return segments.map((s, i) => {
    if (s.id && isCurrentVersionSegmentId(s.id)) {
      return s as T & { id: string };
    }
    return { ...s, id: keys[i]! };
  });
}
