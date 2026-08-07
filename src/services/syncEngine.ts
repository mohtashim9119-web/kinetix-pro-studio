/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { Asset, VideoSegment } from '../types';
import { canonicalizeForFilename } from './textNormalize';

export const isFuzzyMatch = (search: string, target: string): boolean => {
  if (!search || !target) return false;
  const s = search.toLowerCase().trim().replace(/\[(IMAGE|VIDEO|HEADING):?\s*|\]/gi, '').replace(/\.(jpg|jpeg|png|webp|gif|bmp|svg|avif|heic|heif|mp4|mov|webm|m4v|wav|mp3|zip)$/i, '');
  const t = target.toLowerCase().trim().replace(/\.(jpg|jpeg|png|webp|gif|bmp|svg|avif|heic|heif|mp4|mov|webm|m4v|wav|mp3|zip)$/i, '');

  if (t === s) return true;
  if (t.includes(s) || s.includes(t)) return true;

  const sWords = s.split(/[\s_\-]+/).filter(w => w.length > 2);
  const tWords = t.split(/[\s_\-]+/).filter(w => w.length > 2);

  let matches = 0;
  for (const word of sWords) {
    if (tWords.some(tw => tw.includes(word) || word.includes(tw))) {
      matches++;
    }
  }
  return matches >= 2;
};

export const findAssetByContext = (text: string, assets: Asset[]): Asset | null => {
  const words = text.toLowerCase().split(/[\s,.;:!?]+/).filter(w => w.length > 3);
  for (const asset of assets) {
    const assetName = asset.name.toLowerCase();
    if (words.some(word => assetName.includes(word))) return asset;
  }
  return null;
};

/**
 * Normalizes a string for strict tag/filename comparison: Unicode NFC form,
 * smart quotes/dashes folded to their plain ASCII equivalents, and zero-width
 * characters (U+200B, U+FEFF and the other zero-width/directional marks)
 * stripped — the encoding artifacts a filename commonly picks up surviving a
 * copy-paste from Word/Google Docs.
 *
 * Now a thin wrapper over the SHARED Unicode-hygiene layer in ./textNormalize
 * (the unified-normalizer refactor, architecture doc §3.2 — closes G4), so the
 * filename path and the alignment path can never drift on NFC/apostrophe/quote/
 * dash/zero-width handling again. Behavior is identical to the former inline
 * version (no lowercasing, no tokenization); the only difference is a slightly
 * broader — strictly superset — apostrophe and zero-width fold set.
 */
export function normalizeForMatch(s: string): string {
  return canonicalizeForFilename(s);
}

/**
 * Allowlisted image+video extensions stripped from filenames/tags before an
 * exact-name comparison, so a bare tag `[002_age_24]` matches an uploaded
 * `002_age_24.jpg`. Uses an anchored, allowlisted trailing-extension pattern
 * (not a naive last-dot split) so dotted stems like `my.scene.02` survive
 * intact — only a real trailing media extension is removed.
 */
const MEDIA_EXT_RE = /\.(jpg|jpeg|png|webp|gif|bmp|svg|avif|heic|heif|mp4|mov|webm|m4v)$/i;

/** Removes a single trailing allowlisted media extension, if present. */
export function stripMediaExtension(s: string): string {
  return s.replace(MEDIA_EXT_RE, '');
}

/**
 * Strips stray edge punctuation that can't be part of a filename stem — a
 * typo'd leading colon, quotes, stray whitespace — while KEEPING characters
 * that are filename-legal at the edges: letters, digits, underscore, hyphen,
 * and dot. So `_intro.jpg`, `002_age_24`, and `my.scene.02` survive intact,
 * but `":  foo"` → `"foo"`. Interior characters (e.g. a space in
 * "my file.jpg") are untouched — only the leading/trailing runs are cleaned.
 */
const cleanEdgePunctuation = (v: string): string =>
  v.replace(/^[^a-zA-Z0-9_.-]+/, '').replace(/[^a-zA-Z0-9_.-]+$/, '');

/**
 * Normalizes raw bracket-tag content into a filename stem for matching.
 * Order matters: clean edges first (so a stray leading `:` or quote can't
 * hide a legacy `IMAGE:`/`VIDEO:`/`HEADING:` keyword from the strip), then
 * drop the legacy keyword prefix, then clean edges again (so any punctuation
 * the keyword strip exposed — e.g. `[IMAGE: : foo]` — is also removed).
 * `HEADING:` is stripped exactly like `IMAGE:`/`VIDEO:` — the keyword itself
 * is never read for anything; a `[HEADING: foo.jpg]` tag matches an asset
 * named `foo.jpg` the same as `[IMAGE: foo.jpg]` would (Path B Decision 6 —
 * headings are no longer a distinct tag kind).
 * Extension stripping is deliberately NOT done here; isExactFilenameMatch
 * strips extensions from both sides at compare time.
 */
export function cleanTagName(raw: string): string {
  let name = cleanEdgePunctuation(raw.trim());
  name = name.replace(/^(?:IMAGE|VIDEO|HEADING)\s*:\s*/i, '');
  return cleanEdgePunctuation(name);
}

/**
 * Strict, case-insensitive, extension-agnostic filename match for the
 * bare-bracket tag format — no fuzzy/substring/word-overlap fallback (that's
 * isFuzzyMatch's job). A trailing media extension is stripped from BOTH sides
 * first, so `[002_age_24]`, `[002_age_24.jpg]`, and asset `002_age_24.png` all
 * resolve to the same normalized stem.
 */
export function isExactFilenameMatch(tagName: string, assetName: string): boolean {
  return normalizeForMatch(stripMediaExtension(tagName.trim()).toLowerCase()) ===
    normalizeForMatch(stripMediaExtension(assetName.trim()).toLowerCase());
}

/** Splits a name into lowercase alphanumeric word tokens using the same stem
 *  normalization as isExactFilenameMatch (extension strip + Unicode fold +
 *  lowercase), so `002_age_24.jpg` → ['002','age','24']. */
function toWordTokens(s: string): string[] {
  return normalizeForMatch(stripMediaExtension(s.trim()).toLowerCase())
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

/**
 * Explicit-tag fallback tier (runs only after isExactFilenameMatch fails):
 * true when the tag's word-token sequence appears as a CONTIGUOUS, in-order,
 * adjacent block anywhere inside the asset's word-token sequence — tag-within-
 * asset direction only, not the reverse. So a short tag `[year_2003]` resolves
 * to asset `year_2003_2342368767.jpg`, but `[2003_year]` does NOT match
 * `year_2003` (order + adjacency required — this is a token-level substring,
 * not a gap-allowing subsequence). An empty tag returns false.
 *
 * Deliberately looser than isExactFilenameMatch and stricter than isFuzzyMatch.
 * Because a single short tag can be a contiguous block of several filenames,
 * this is inherently ambiguity-prone: callers MUST require a UNIQUE match
 * before assigning and leave a 2+ match visibly unmatched rather than silently
 * picking one (same "never guess wrong" rule as the exact tier, commit 9b15a59).
 */
export function contiguousWordMatch(tagName: string, assetName: string): boolean {
  const tag = toWordTokens(tagName);
  if (tag.length === 0) return false;
  const asset = toWordTokens(assetName);
  if (tag.length > asset.length) return false;

  for (let i = 0; i + tag.length <= asset.length; i++) {
    let allMatch = true;
    for (let j = 0; j < tag.length; j++) {
      if (asset[i + j] !== tag[j]) {
        allMatch = false;
        break;
      }
    }
    if (allMatch) return true;
  }
  return false;
}

/**
 * A lock (decision 9 / Step AB, docs/sync-pipeline-v2-plan.md) forced a
 * different placement on an UNLOCKED neighbour than plain anchor-to-anchor
 * derivation would have given it — `applyAnchorBasedTiming` reports every
 * one of these via its optional `onLockFinding` callback rather than
 * resolving them silently (Step AB: "never silence... every one of the
 * above is answered because leaving any of them implicit is exactly how
 * K14 happened"). `kind` maps 1:1 onto the two new `SyncLogEntryType`
 * members these are built into (`syncLog.ts`'s `buildLockFindingLogEntries`).
 */
export interface LockFinding {
  /** The bounded span couldn't hold even the minimum slot (Step AB's
   *  "too short" case) — warning severity. */
  kind: 'lock-span-overflow' | 'lock-preserved-adjustment';
  segmentId: string;
  /** Index into the array `applyAnchorBasedTiming` was called with. */
  segmentIndex: number;
  amountSec: number;
}

/**
 * Re-derives startTime and duration for each segment from its anchorStart,
 * preserving surviving scene positions across re-sync after scene add/remove.
 *
 * Preconditions:
 *  - segments are in display order
 *  - audioDuration > 0
 *  - each segment has either an anchorStart (surviving from prev sync) or
 *    undefined anchorStart (brand-new scene from this sync)
 *
 * Postconditions:
 *  - every segment has anchorStart, startTime, duration set
 *  - startTimes are monotonically non-decreasing and contiguous
 *  - first segment startTime = 0, UNLESS it is locked (see below)
 *  - last segment duration = audioDuration - last.startTime, UNLESS it is
 *    locked
 *  - LOCKED SEGMENTS ARE A HARD WALL (K14 fix — decision 9 / Step AB):
 *    `startTime` and `duration` are pinned — never derived from
 *    `anchorStart`, never grown or shrunk to absorb a neighbour. The prior
 *    one-directional growth exemption ("locked segments never shrink, but
 *    grow to absorb a removal gap that opened up after them") is WITHDRAWN;
 *    a lock no longer moves in either direction, full stop. `anchorStart` is
 *    instead kept in lockstep with `startTime` at all times (INVARIANT L2)
 *    rather than read as a separately-stale value — this is what closes
 *    K14, where a drag left a locked segment's `anchorStart` stale and a
 *    later, unrelated lock toggle silently re-derived its `startTime` from
 *    that stale value, moving a segment the toggle never touched.
 *  - an UNLOCKED segment can never start before an immediately preceding
 *    LOCKED segment's actual end (that lock's own `startTime + duration` is
 *    a hard floor on the very next segment's start) — this is what stops an
 *    unlocked neighbour from overlapping a lock. An unlocked segment
 *    immediately before a LOCKED segment is likewise bounded by that lock's
 *    own `startTime`, not by the lock's `anchorStart` (Step AC's R.1(d)/R.2
 *    substitution — a lock is a hard wall, not an ordinary neighbour
 *    anchor). This bound is DELIBERATELY LOCAL, never propagated through a
 *    running cursor past the one segment immediately touching the lock — a
 *    lock is a non-cascading, single-segment-deep wall (Step AC: "a locked
 *    boundary is always a run-boundary case, never same-run interior"), and
 *    an ordinary unlocked-to-unlocked overshoot keeps its pre-existing,
 *    LOCAL collapse-to-floor behaviour (the D16 backstop clamp above) rather
 *    than rippling into a later, correctly-anchored segment. Multi-segment
 *    windowing when a bounded span is too small for ALL of its trapped
 *    content (more than one segment between two locks) is Step AC / forced-
 *    alignment territory, out of K14's scope — only the segment directly
 *    adjacent to each lock is bounded here.
 *  - a lock-caused adjustment to an unlocked neighbour's placement is
 *    reported via `onLockFinding`, never silent (Step AB) — `lock-span-
 *    overflow` (warning) when the bounded span can't meet the minimum slot,
 *    `lock-preserved-adjustment` (info) for any other lock-caused move.
 */
export function applyAnchorBasedTiming(
  segments: VideoSegment[],
  audioDuration: number,
  onLockFinding?: (finding: LockFinding) => void,
): VideoSegment[] {
  if (segments.length === 0) return segments;
  if (audioDuration <= 0) return segments;

  const out: VideoSegment[] = segments.map(s => ({ ...s }));

  // PASS 1 — normalize first-segment anchor to 0, UNLESS it is locked: a
  // lock is a hard wall even at the very front of the timeline (decision 9
  // point 3 is unconditional). A locked first segment's anchorStart is
  // corrected below, in the main pass, to match its own untouched startTime.
  const first = out[0];
  if (first && !first.locked && ((first.anchorStart ?? 0) > 0 || first.anchorStart === undefined)) {
    if (first.anchorStart === undefined) first.anchorSource = 'estimate';
    first.anchorStart = 0;
  }

  for (let i = 1; i < out.length; i++) {
    const prev = out[i - 1]!;
    const cur = out[i]!;
    if ((cur.anchorStart ?? 0) < (prev.anchorStart ?? 0)) {
      console.warn('[anchor] out-of-order anchor at i=%d: prev=%s cur=%s id=%s',
        i, prev.anchorStart, cur.anchorStart, cur.id);
    }
  }

  // Backstop monotonic clamp (D16 defense-in-depth). If an anchor still
  // overshoots its successor — an overshoot the primary alignment guard in
  // whisperService did not catch — deriving durations below would push this
  // segment's end past the next segment's start, collapsing both to the 0.1
  // floor (the inversion class the warning above only reports). Walk backward,
  // pulling any inflated non-locked anchor down to its successor so anchors are
  // monotonically non-decreasing before durations are derived; the walk order
  // lets a run of overshoots collapse cleanly. Locked segments are authoritative
  // (never move/shrink) and are skipped. No-op when anchors are already
  // monotonic, so normal projects are byte-identical.
  for (let i = out.length - 2; i >= 0; i--) {
    const cur = out[i]!;
    if (cur.locked) continue;
    const curAnchor = cur.anchorStart ?? cur.startTime ?? 0;
    const nextAnchor = out[i + 1]?.anchorStart ?? out[i + 1]?.startTime ?? 0;
    if (curAnchor > nextAnchor) {
      cur.anchorStart = nextAnchor;
    }
  }

  // PASS 2 — recompute startTime and duration. Left-to-right; each segment's
  // lock-boundedness is read directly off its immediate neighbours (`out[i -
  // 1]`/`out[i + 1]`), never propagated through a running cursor — a lock is
  // a non-cascading, single-segment-deep wall (Step AC: "a locked boundary
  // is always a run-boundary case, never same-run interior"), and an
  // ordinary unlocked-to-unlocked overshoot must keep its pre-existing,
  // LOCAL behaviour (the overshooting segment alone collapses to the floor;
  // it must never push a later, correctly-anchored segment forward — see the
  // D16 backstop clamp above, which this pass must not re-break).
  for (let i = 0; i < out.length; i++) {
    const seg = out[i];
    if (!seg) continue;
    const isLast = i === out.length - 1;
    const nextLocked = !isLast && out[i + 1]?.locked === true;
    const naiveNextAnchor = isLast
      ? audioDuration
      : (out[i + 1]?.anchorStart ?? out[i + 1]?.startTime ?? audioDuration);
    // A locked next segment's boundary is its startTime, unconditionally —
    // never its (possibly stale) anchorStart. This is the R.1(d)/R.2
    // substitution: a lock is a hard wall, not an ordinary neighbour anchor.
    const nextAnchor = nextLocked ? out[i + 1]!.startTime : naiveNextAnchor;

    if (seg.locked) {
      // Hard wall (Step AB): startTime/duration are read-only here — never
      // snapped to anchorStart, never grown or shrunk. Only anchorStart
      // moves, to stay in lockstep with the pinned position (INVARIANT L2).
      seg.anchorStart = seg.startTime;
      continue;
    }

    const rawAnchor = seg.anchorStart ?? seg.startTime ?? 0;
    const prevLocked = i > 0 && out[i - 1]?.locked === true;
    // MODEL P (ruling §4.1's fill rule, 2026-08-07) — an unlocked segment
    // following a LOCK starts at that lock's exact end, not merely at or
    // after it.
    //
    // This used to be `Math.max(rawAnchor, lockFloor)`. A max is a FLOOR: it
    // closes an overlap (anchor before the wall) and is structurally blind to
    // a GAP (anchor after the wall), which is precisely how K14's hard wall
    // came to permit Model S. Measured: a lock ending at 20s followed by a
    // segment anchored at 35s left a real 15-second hole that nothing
    // downstream repaired.
    //
    // Pinning the start to the wall makes the successor absorb the shortfall
    // as LEADING SILENCE — its own END is still `nextAnchor`, so its words do
    // not move and nothing ripples past it. That is the ruling's own answer
    // ("the following segment starts early, at the lock's actual end, and
    // absorbs the space"), and the same operation `headExtendFirstSegment`
    // already performs against the timeline start and Option A (decision 8)
    // performs for unscripted-heading audio.
    //
    // Deliberately scoped to a LOCKED predecessor only. An unlocked
    // predecessor's (possibly floor-collapsed) end is still NOT a floor here
    // — making it one would re-introduce exactly the forward ripple the D16
    // backstop clamp above exists to contain locally. This is also what keeps
    // a lock-free project's output byte-identical to pre-fix: with no lock in
    // the array this branch never runs, which the Step M golden replay
    // (`scripts/phase4-handoff-replay-sync.test.ts`, three real corpus
    // projects, none containing a locked segment) verifies on every run.
    const effectiveStart = prevLocked
      ? out[i - 1]!.startTime + out[i - 1]!.duration
      : rawAnchor;
    const boundedByLock = prevLocked || nextLocked;
    const availableSpan = nextAnchor - effectiveStart;
    const tooShort = boundedByLock && availableSpan < 0.1;

    seg.startTime = Number(effectiveStart.toFixed(3));
    seg.duration = Number((tooShort ? Math.max(0, availableSpan) : Math.max(0.1, availableSpan)).toFixed(3));

    if (boundedByLock) {
      if (tooShort) {
        onLockFinding?.({
          kind: 'lock-span-overflow',
          segmentId: seg.id,
          segmentIndex: i,
          amountSec: Number((0.1 - availableSpan).toFixed(3)),
        });
      } else {
        const naiveDuration = Math.max(0.1, naiveNextAnchor - rawAnchor);
        const moved = Math.abs(effectiveStart - rawAnchor) + Math.abs(seg.duration - naiveDuration);
        if (moved > 0.001) {
          onLockFinding?.({
            kind: 'lock-preserved-adjustment',
            segmentId: seg.id,
            segmentIndex: i,
            amountSec: Number(moved.toFixed(3)),
          });
        }
      }
    }
  }

  // PASS 3 — clamp last segment exactly to audioDuration, UNLESS it is
  // locked (a hard wall, same as everywhere else in this pass).
  const last = out[out.length - 1];
  if (last && !last.locked) {
    last.duration = Number(Math.max(0.1, audioDuration - last.startTime).toFixed(3));
  }

  return out;
}

/**
 * Stable identity string for a File, used to detect re-staging the same
 * underlying file across separate selections. A fresh `File` object (and a
 * fresh Asset id) is minted on every stage event even when the user picks
 * the exact same file again, so reference/id equality can't catch this —
 * name+size+lastModified can.
 */
export function getFileIdentity(file: File): string {
  return `${file.name}|${file.size}|${file.lastModified}`;
}

/**
 * Head/tail symmetry for the finalized timeline (post-snap): the LAST
 * segment already runs all the way to `audioDuration` (snapCoveredBoundaries'
 * own tail extension, and applyAnchorBasedTiming's PASS 3) — the audio is the
 * source of truth for total length, not the last matched word. The FIRST
 * segment gets no equivalent treatment from `snapCoveredBoundaries`: that
 * function only ever writes `next.startTime` in its pair loop, so
 * `segments[0].startTime` passes through untouched, still sitting wherever
 * the aligner's own matched span put it — the first spoken WORD, which can
 * be a few tenths of a second after true t=0 (real lead-in silence before
 * narration starts).
 *
 * This is a thin, standalone post-pass rather than logic inside
 * `snapCoveredBoundaries` itself: that function is pair-boundary logic with
 * no notion of "is this really the timeline's first segment" — it's
 * exercised in tests on synthetic slices representing arbitrary MIDDLE pairs
 * of a larger project, where index 0 of the slice is not the timeline's true
 * first segment and must keep its own startTime. Only a caller holding the
 * full, ordered, post-snap array can safely make that call — so it belongs
 * here, applied once by App.tsx right after `snapCoveredBoundaries` /
 * `retileCoveredSegments`. Not needed after `applyAnchorBasedTiming` (the
 * no-transcript fallback branch) — that function already forces its own
 * first anchor to 0 in its PASS 1, so this would always be a no-op there.
 *
 * Stretches `segments[0]` back to start at 0 by growing its duration to
 * absorb the lead-in, so it covers the full head exactly as the last segment
 * covers the full tail. The segment's END (startTime + duration) is
 * unchanged, so this can never ripple into segment 2's startTime — no
 * contiguity check is needed beyond that invariant. Audio/exports are
 * unaffected: narration still physically begins at the original startTime
 * inside the (now longer) first segment. A locked first segment is
 * authoritative and is left untouched, matching every other lock exemption
 * in this pipeline. Pure; no-op (returns the same array reference) when
 * there's nothing to do.
 */
export function headExtendFirstSegment(segments: VideoSegment[]): VideoSegment[] {
  const first = segments[0];
  if (!first || first.locked || first.startTime <= 0) return segments;

  const stretched: VideoSegment = {
    ...first,
    startTime: 0,
    duration: Number((first.duration + first.startTime).toFixed(3)),
    anchorStart: 0,
  };
  return [stretched, ...segments.slice(1)];
}

export const autoMatchSegments = (assets: Asset[], segments: VideoSegment[]): VideoSegment[] =>
  segments.map(s => {
    if (s.assetId) return s;

    // A segment that carried an EXPLICIT bracket tag whose filename failed
    // exact matching at parse time must never be fuzzy-guessed from its spoken
    // text — that silently picks a wrong asset. Leave it visibly unmatched
    // (red missing tile); recovery is re-running Apply Sync, which re-parses
    // the tag and exact-matches. Segments that never had an explicit tag name
    // (empty `[]`, so this flag was never set) are still fuzzy-matched below.
    if (s.unmatchedExplicitTag) return s;

    const bracketMatch = s.text.match(/\[(.*?):?\s*(.*?)\]/);
    if (bracketMatch) {
      const name = (bracketMatch[2] ?? '').trim();
      const asset = assets.find(a => isFuzzyMatch(name, a.name));
      if (asset) return { ...s, assetId: asset.id };
    }

    const contextAsset = findAssetByContext(s.text, assets);
    if (contextAsset) return { ...s, assetId: contextAsset.id };

    return s;
  });
