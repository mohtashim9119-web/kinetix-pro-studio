import { invoke, Channel } from '@tauri-apps/api/core';
import type { Asset, VideoSegment, TranscriptToken } from '../types';
import type { SilenceInterval } from './silenceDetector';

export type { TranscriptToken };

type WhisperEvent =
  | { event: 'Progress'; data: { percent: number } }
  | { event: 'Done'; data: { tokens: TranscriptToken[] } }
  | { event: 'Error'; data: { message: string } };

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  const CHUNK = 3 * 4096; // 12288 — multiple of 3, safe boundary
  let binary = '';
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

function parseTimestamp(ts: string): number {
  const normalized = ts.trim().replace(',', '.');
  const parts = normalized.split(':');
  if (parts.length !== 3) return 0;
  const h = parseFloat(parts[0] ?? '0');
  const m = parseFloat(parts[1] ?? '0');
  const s = parseFloat(parts[2] ?? '0');
  return h * 3600 + m * 60 + s;
}

// ---------------------------------------------------------------------------
// D16 — symmetric canonicalization (numbers / contractions / symbols)
// ---------------------------------------------------------------------------
// Applied IDENTICALLY to both the script segment text and the Whisper token
// text before word-level matching, so a spelled-out number in the script
// ("thirty seven") and Whisper's digit output ("37") — or the reverse —
// collapse to the SAME word sequence instead of desyncing the aligner's
// monotonic cursor (see D16). Everything is deterministic and applied to both
// sides, so anything NOT covered here still normalizes symmetrically (never
// asymmetrically) and any residual mismatch is contained by the Part C cursor
// guard in alignScenestoTranscript.
//
// Coverage:
//   - integers 0–9999 (cardinal reading)
//   - 4-digit years 1100–2999 whose last two digits are 10–99 (pair reading,
//     e.g. 2024 -> "twenty twenty four"); 2000–2009 / round hundreds fall back
//     to cardinal ("two thousand three") — the form Whisper's en model emits
//   - integers > 9999 read digit-by-digit (never an unbounded cardinal string)
//   - simple decimals ("3.5" -> "three point five", fraction read digit-wise)
//   - thousands separators stripped (11,000 -> 11000)
//   - the contraction map below (expanded before any apostrophe strip)
//   - spoken symbols: % -> percent, & -> and, @ -> at, $N -> "N dollars"

const ONES_WORDS = [
  'zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight',
  'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen',
  'sixteen', 'seventeen', 'eighteen', 'nineteen',
];
const TENS_WORDS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];

function under100ToWords(n: number): string[] {
  if (n < 20) return [ONES_WORDS[n]!];
  const t = Math.floor(n / 10);
  const o = n % 10;
  return o === 0 ? [TENS_WORDS[t]!] : [TENS_WORDS[t]!, ONES_WORDS[o]!];
}

function under1000ToWords(n: number): string[] {
  if (n < 100) return under100ToWords(n);
  const h = Math.floor(n / 100);
  const r = n % 100;
  const words = [ONES_WORDS[h]!, 'hundred'];
  if (r > 0) words.push(...under100ToWords(r));
  return words;
}

/** Cardinal reading for 0–9999 (callers guarantee the range). */
function cardinalToWords(n: number): string[] {
  if (n < 1000) return under1000ToWords(n);
  const th = Math.floor(n / 1000);
  const r = n % 1000;
  const words = [...under1000ToWords(th), 'thousand'];
  if (r > 0) words.push(...under1000ToWords(r));
  return words;
}

/** Pair reading for a 4-digit year, e.g. 2024 -> "twenty twenty four". */
function yearToWords(n: number): string[] {
  const high = Math.floor(n / 100);
  const low = n % 100;
  return [...under100ToWords(high), ...under100ToWords(low)];
}

/** Expands a pure-digit token to its canonical spoken word sequence. */
function digitTokenToWords(tok: string): string[] {
  const n = Number.parseInt(tok, 10);
  if (!Number.isFinite(n)) return [tok];
  if (tok.length === 4 && n >= 1100 && n <= 2999 && n % 100 >= 10) {
    return yearToWords(n);
  }
  if (n >= 0 && n <= 9999) return cardinalToWords(n);
  return tok.split('').map(d => ONES_WORDS[Number(d)] ?? d);
}

const CONTRACTIONS: Record<string, string> = {
  "don't": 'do not', "doesn't": 'does not', "didn't": 'did not',
  "isn't": 'is not', "aren't": 'are not', "wasn't": 'was not',
  "weren't": 'were not', "haven't": 'have not', "hasn't": 'has not',
  "hadn't": 'had not', "won't": 'will not', "wouldn't": 'would not',
  "can't": 'cannot', "couldn't": 'could not', "shouldn't": 'should not',
  "mustn't": 'must not', "needn't": 'need not',
  "it's": 'it is', "that's": 'that is', "there's": 'there is',
  "here's": 'here is', "he's": 'he is', "she's": 'she is',
  "what's": 'what is', "who's": 'who is', "let's": 'let us',
  "i'm": 'i am', "you're": 'you are', "we're": 'we are', "they're": 'they are',
  "i've": 'i have', "you've": 'you have', "we've": 'we have',
  "they've": 'they have', "i'll": 'i will', "you'll": 'you will',
  "he'll": 'he will', "she'll": 'she will', "we'll": 'we will',
  "they'll": 'they will', "i'd": 'i would', "you'd": 'you would',
  "he'd": 'he would', "she'd": 'she would', "we'd": 'we would',
  "they'd": 'they would',
};

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Longest keys first so a longer contraction can't be partially eaten; the
// letter/digit lookarounds keep a contraction inside a larger token untouched.
const CONTRACTION_RE = new RegExp(
  '(?<![a-z0-9])(' +
    Object.keys(CONTRACTIONS)
      .sort((a, b) => b.length - a.length)
      .map(escapeRegExp)
      .join('|') +
    ')(?![a-z0-9])',
  'g',
);

/**
 * Pure canonicalizer shared by the script-word and Whisper-token tokenizers
 * (both reach it through `normalize`). Order is deliberate: fold apostrophes
 * and expand contractions BEFORE any apostrophe is stripped; map
 * symbols/currency/decimals BEFORE the non-alphanumeric strip removes them;
 * expand digit runs to words AFTER tokenization so per-token range logic
 * applies. Identical input on both sides always yields identical output.
 */
export function canonicalizeForAlignment(s: string): string[] {
  let t = s.toLowerCase();

  // Fold curly/modifier apostrophes to ASCII, then expand contractions.
  t = t.replace(/[‘’ʼ]/g, "'");
  t = t.replace(CONTRACTION_RE, m => CONTRACTIONS[m] ?? m);

  // Drop thousands separators between digits (11,000 -> 11000).
  t = t.replace(/(\d),(\d)/g, '$1$2');

  // Decimals: "3.5" -> "3 point 5"; fractional digits kept single so the
  // per-token expansion below reads them digit-by-digit ("three point five").
  t = t.replace(/(\d+)\.(\d+)/g, (_m, a: string, b: string) => ` ${a} point ${b.split('').join(' ')} `);

  // Currency: "$5" -> "5 dollars" (number-then-unit, matching spoken order);
  // a bare "$" -> "dollars".
  t = t.replace(/\$\s?(\d+)/g, ' $1 dollars ');
  t = t.replace(/\$/g, ' dollars ');

  // Other spoken symbols.
  t = t.replace(/%/g, ' percent ');
  t = t.replace(/&/g, ' and ');
  t = t.replace(/@/g, ' at ');

  // Strip anything still non-alphanumeric to spaces (hyphens, leftover
  // apostrophes, punctuation) — same terminal step as the original normalize().
  t = t.replace(/[^a-z0-9\s]/g, ' ');

  const rawTokens = t.split(/\s+/).filter(w => w.length > 0);

  const out: string[] = [];
  for (const tok of rawTokens) {
    if (/^\d+$/.test(tok)) {
      out.push(...digitTokenToWords(tok));
    } else {
      out.push(tok);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Public helpers (also used by useWhisper)
// ---------------------------------------------------------------------------

/**
 * Word-level normalizer used by the aligner (and textMateriallyChanged).
 * Delegates to canonicalizeForAlignment so numbers/contractions/symbols
 * canonicalize identically on the script and Whisper-token sides (D16).
 */
export function normalize(s: string): string[] {
  return canonicalizeForAlignment(s);
}

/**
 * True if two strings differ once normalized to the same word-level
 * representation the aligner matches against (see `normalize`). Used to
 * decide whether a carried-forward 'whisper' anchor is still trustworthy
 * after a re-sync changes a segment's underlying text.
 */
export function textMateriallyChanged(a: string, b: string): boolean {
  return normalize(a).join(' ') !== normalize(b).join(' ');
}

export function alignScenestoTranscript(
  segments: VideoSegment[],
  tokens: TranscriptToken[],
  silences: SilenceInterval[] = [],
): Array<{ t0: number; t1: number }> {
  if (!tokens.length || !segments.length) {
    return segments.map(() => ({ t0: 0, t1: 0 }));
  }

  // Expand each token into all its words — Whisper tokens may contain multiple
  // words (e.g. " hello world") and every word must be individually searchable.
  const tokenWords: Array<{ word: string; tokenIdx: number }> = [];
  for (let i = 0; i < tokens.length; i++) {
    const words = normalize(tokens[i]!.text);
    for (const word of words) {
      if (word.length > 0) {
        tokenWords.push({ word, tokenIdx: i });
      }
    }
  }

  interface AlignResult {
    t0: number;
    t1: number;
    firstTokenIdx: number;
    lastTokenIdx: number;
  }

  const results: AlignResult[] = [];
  let searchStart = 0;

  // D16 cursor-guard tuning (see the confidence + overshoot checks in the loop).
  const LOW_CONFIDENCE_RATIO = 0.4; // fewer than ~40% of target words matched -> low confidence
  const OVERSHOOT_TOLERANCE = 3;    // words a low-confidence match may sit ahead of the entry cursor

  for (let si = 0; si < segments.length; si++) {
    const seg = segments[si];
    if (!seg) continue;

    if (!seg.text || !seg.text.trim()) {
      const anchor = results[si - 1]?.t1 ?? 0;
      results.push({ t0: anchor, t1: anchor, firstTokenIdx: -1, lastTokenIdx: -1 });
      continue;
    }

    const targetWords = normalize(seg.text);
    if (targetWords.length === 0) {
      const anchor = results[si - 1]?.t1 ?? 0;
      results.push({ t0: anchor, t1: anchor, firstTokenIdx: -1, lastTokenIdx: -1 });
      continue;
    }

    const entrySearchStart = searchStart; // Part C: cursor position BEFORE this segment scores.

    const windowSize = Math.max(targetWords.length, 3);
    let bestScore = -1;
    let bestStart = searchStart;
    let bestEnd = Math.min(searchStart + windowSize - 1, tokenWords.length - 1);

    const maxStart = Math.max(
      searchStart,
      Math.min(
        searchStart + Math.floor(tokenWords.length / segments.length) * 5,
        tokenWords.length - Math.max(1, targetWords.length),
      ),
    );

    for (let wi = searchStart; wi <= maxStart; wi++) {
      let score = 0;
      for (let j = 0; j < targetWords.length; j++) {
        if (tokenWords[wi + j]?.word === targetWords[j]) score++;
      }
      if (score > bestScore) {
        bestScore = score;
        bestStart = wi;
        bestEnd = wi + targetWords.length - 1;
      }
    }

    // Confidence = fraction of this segment's words that positionally matched at
    // bestStart. Computed here (before t0/t1 are derived) so the overshoot guard
    // below can correct bestStart itself, not just the forward cursor.
    const confidence = targetWords.length > 0 ? bestScore / targetWords.length : 1;

    // D16 overshoot guard (primary fix). A low-confidence match whose bestStart
    // lands far AHEAD of the entry cursor is almost always coincidental: the
    // segment's text (e.g. a burned-in on-screen label) never occurs in the
    // transcript, so the matcher latched onto a stray later repetition of a
    // common word. Anchoring t0/t1 to that overshot position pushes this
    // segment's span past where the NEXT segment's real, higher-confidence match
    // begins, collapsing both to near-zero/negative duration (the 48/152/173/183
    // repro). Snap bestStart back to the cursor so this segment behaves like an
    // in-tolerance low-confidence match — a near-zero-width placeholder at the
    // cursor — while the confidence guard below still holds the forward cursor so
    // the next segment re-anchors freely. In-tolerance low-confidence matches
    // (bestStart at or within OVERSHOOT_TOLERANCE of the cursor) are untouched:
    // byte-identical to before.
    if (confidence < LOW_CONFIDENCE_RATIO && bestStart - entrySearchStart > OVERSHOOT_TOLERANCE) {
      if (import.meta.env.DEV) {
        console.warn(
          '[align] overshoot for segment %d — bestStart %d is %d words past cursor %d; anchoring at cursor',
          si, bestStart, bestStart - entrySearchStart, entrySearchStart,
        );
      }
      bestStart = entrySearchStart;
      bestEnd = Math.min(entrySearchStart + windowSize - 1, tokenWords.length - 1);
    }

    const t0TokenIdx = tokenWords[bestStart]?.tokenIdx ?? 0;

    // Re-scan bestStart to find the highest j where a word actually matched.
    // Using the last MATCHED position (not bestEnd = bestStart + targetWords.length - 1)
    // makes t1TokenIdx and searchStart independent of targetWords.length: adding a
    // non-matching word to seg.text cannot extend effectiveLastWordPos, so it cannot
    // shift lastTokenIdx or the next segment's searchStart.
    let lastMatchOffset = -1;
    for (let j = 0; j < targetWords.length; j++) {
      if (tokenWords[bestStart + j]?.word === targetWords[j]) lastMatchOffset = j;
    }
    if (lastMatchOffset < 0) lastMatchOffset = 0; // fallback: no matches — treat as one-word span
    const effectiveLastWordPos = bestStart + lastMatchOffset;
    const t1TokenIdx = tokenWords[Math.min(effectiveLastWordPos, tokenWords.length - 1)]?.tokenIdx ?? t0TokenIdx;

    const t0 = tokens[t0TokenIdx]?.startSec ?? 0;
    const t1 = tokens[t1TokenIdx]?.endSec ?? t0 + 0.1;

    results.push({
      t0,
      t1: Math.max(t0 + 0.05, t1),
      firstTokenIdx: t0TokenIdx,
      lastTokenIdx: t1TokenIdx,
    });

    // Part C (D16) — cursor confidence guard. bestScore is the count of
    // positionally-matched words at bestStart; confidence is the fraction of
    // this segment's words that actually lined up. A low fraction means the
    // segment text and the audio here don't correspond (an unhandled token
    // mismatch — an abbreviation, foreign word, or Whisper mis-hearing). In
    // that case DON'T advance the monotonic cursor past this segment on the
    // strength of a bad match: a spurious late match would push searchStart
    // ahead of the NEXT segment's true words and strand every segment after it
    // (the D16 cascade). Instead advance minimally (by 1), keeping forward
    // progress while leaving the next segment's window free to re-anchor.
    //
    // Threshold 0.4 (fewer than ~40% of target words matched): a real segment
    // with one unmatched name/number still clears it (e.g. 4/5 = 0.8, 2/3 =
    // 0.67), while a genuinely desynced match (mostly-zero score) trips it.
    // (confidence and LOW_CONFIDENCE_RATIO are computed above, before the
    // overshoot guard that may already have snapped bestStart to the cursor.)
    if (confidence < LOW_CONFIDENCE_RATIO) {
      if (import.meta.env.DEV) {
        console.warn(
          '[align] low-confidence match for segment %d (%d/%d words) — holding cursor to avoid cascade',
          si, Math.max(0, bestScore), targetWords.length,
        );
      }
      searchStart = Math.min(entrySearchStart + 1, tokenWords.length);
    } else {
      // Advance searchStart past all tokenWords sharing t1TokenIdx (the last matched token).
      // Audio-grounded, not text-length-grounded: editing scene description text cannot
      // shift where the next segment's scoring window begins.
      let nextSearchStart = effectiveLastWordPos + 1;
      while (nextSearchStart < tokenWords.length && (tokenWords[nextSearchStart]?.tokenIdx ?? Infinity) <= t1TokenIdx) {
        nextSearchStart++;
      }
      searchStart = nextSearchStart;
    }
  }

  // Step 2 — override t1 from neighbor anchors.
  // Each unlocked segment's right boundary is set to the next segment's t0 anchor
  // before the gap-fill runs. This breaks the bestEnd → lastTokenIdx → t1 chain so
  // that editing scene description text cannot shift a segment's duration via word count.
  // Locked segments are skipped: their t1 is immovable.
  const audioEnd = tokens[tokens.length - 1]?.endSec ?? 0;
  for (let i = 0; i < results.length - 1; i++) {
    if (segments[i]?.locked) continue;
    results[i]!.t1 = results[i + 1]!.t0;
  }

  // Gap-fill — place boundaries in real audio silence.
  // Reads actual Whisper token timestamps to find the midpoint of the silence gap
  // between adjacent segments and moves both boundaries to that midpoint.
  // Pairs where either side is locked are skipped entirely.
  // usedSilences prevents the same silence interval from being claimed by two boundaries.
  const usedSilences = new Set<SilenceInterval>();
  for (let i = 0; i < results.length - 1; i++) {
    if (segments[i]?.locked || segments[i + 1]?.locked) continue;
    const curr = results[i]!;
    const next = results[i + 1]!;

    // Sentinel -1 indices (empty/heading-only segments) return undefined → fallback to curr.t1/next.t0.
    const lastSpokenEnd   = tokens[curr.lastTokenIdx]?.endSec   ?? curr.t1;
    const nextSpokenStart = tokens[next.firstTokenIdx]?.startSec ?? next.t0;
    // curr's own first word and next's own last word — outer bounds this boundary's
    // search may never cross. Without this clamp, the wide radius used below for a
    // near-zero spokenGapWidth can reach past a short next segment entirely and steal
    // the silence that belongs to the FOLLOWING boundary, collapsing that segment to ~0.
    const currFirstSpokenStart = tokens[curr.firstTokenIdx]?.startSec ?? curr.t0;
    const nextLastSpokenEnd    = tokens[next.lastTokenIdx]?.endSec   ?? next.t1;

    // Find silences overlapping a window centered on the spoken-gap midpoint.
    // Whisper word-boundary timestamps are inaccurate by ~300ms, so a silence can extend
    // past nextSpokenStart or start before lastSpokenEnd — a containment check fails those.
    // Instead we look for overlap with a generous search window and pick the closest center.
    const spokenMid = (lastSpokenEnd + nextSpokenStart) / 2;
    const spokenGapWidth = nextSpokenStart - lastSpokenEnd;
    // When Whisper compresses adjacent words to the same timestamp (spokenGap near 0),
    // its boundary timestamp is unreliable. Use a 1.0s radius (not larger — avoids stealing
    // silences that belong to neighbouring boundaries).
    const searchRadius = spokenGapWidth < 0.1
      ? 1.0
      : Math.max(0.5, spokenGapWidth / 2 + 0.4);
    const searchStart = Math.max(spokenMid - searchRadius, currFirstSpokenStart);
    const searchEnd   = Math.min(spokenMid + searchRadius, nextLastSpokenEnd);

    const candidates = silences.filter(
      s => s.endSec > searchStart && s.startSec < searchEnd && !usedSilences.has(s),
    );

    let gap: SilenceInterval | undefined;
    if (candidates.length > 0) {
      gap = candidates.reduce((best, s) => {
        const sCenter    = (s.startSec + s.endSec) / 2;
        const bestCenter = (best.startSec + best.endSec) / 2;
        return Math.abs(sCenter - spokenMid) < Math.abs(bestCenter - spokenMid) ? s : best;
      });
    }

    // Mark the chosen silence as used so later boundaries cannot claim it.
    if (gap) usedSilences.add(gap);

    // Split the silence 50/50: if a real gap was detected, use its midpoint;
    // otherwise fall back to the midpoint of the token-boundary estimate.
    let boundary = gap
      ? (gap.startSec + gap.endSec) / 2
      : (lastSpokenEnd + nextSpokenStart) / 2;

    // Monotonic sanity check: a boundary must not go backwards past the previous one.
    // If it does, the chosen silence belongs to an earlier boundary — fall back.
    if (i > 0 && boundary < results[i - 1]!.t1) {
      boundary = (lastSpokenEnd + nextSpokenStart) / 2;
    }

    curr.t1 = boundary;
    next.t0 = boundary;
  }

  // Clamp last segment to actual audio end (skip if locked).
  if (results.length > 0 && !segments[results.length - 1]?.locked) {
    results[results.length - 1]!.t1 = audioEnd;
  }

  return results.map(r => ({ t0: r.t0, t1: r.t1 }));
}

/** Fixed on-screen duration for heading-only slides after Whisper alignment. */
export const HEADING_DEFAULT_DURATION = 1.0; // seconds
const MIN_SEGMENT_DURATION = 0.3; // must match App.tsx constant

/**
 * Applies time windows from `alignments` to `segments`, respecting
 * `segment.locked === true` (locked segments are left unchanged).
 */
export function distributeSegmentTimes(
  segments: VideoSegment[],
  alignments: Array<{ t0: number; t1: number }>,
  _totalDuration: number,
): VideoSegment[] {
  const updated = segments.map((seg, i) => {
    if (seg.locked) return seg;
    const a = alignments[i];
    if (!a) return seg;
    const duration = Math.max(0.1, a.t1 - a.t0);
    return {
      ...seg,
      startTime: Number(a.t0.toFixed(3)),
      duration: Number(duration.toFixed(3)),
      anchorStart: Number(a.t0.toFixed(3)), // Whisper-derived anchor overwrites char-weight estimate
      anchorSource: 'whisper' as const,
    };
  });
  return updated;
}

/** Returns the index of the nearest non-heading-only segment searching from `from` in direction `step`. */
function nearestContentIdx(segs: VideoSegment[], from: number, step: -1 | 1): number {
  for (let ni = from + step; ni >= 0 && ni < segs.length; ni += step) {
    const s = segs[ni];
    if (s && !s.isHeading && !(s.heading && !s.text)) return ni;
  }
  return -1;
}

/**
 * Post-processing pass that pins heading-only segment durations to exactly
 * HEADING_DEFAULT_DURATION (1.0 s) after Whisper alignment.
 *
 * Two cases are handled:
 *
 * SHRINK (Whisper gave heading the full inter-speech gap, e.g. 1.1 s > 1.0 s):
 *   - Return the excess to the nearest unlocked previous neighbor; fall back to next.
 *
 * GROW (Whisper collapsed heading to ~0.1 s — heading has no spoken text):
 *   - Grow toward HEADING_DEFAULT_DURATION via 50/50 take from both neighbors.
 *   - Any shortfall on one side is shifted to the other.
 *   - Locked neighbors contribute 0 available space.
 *   - If total available < HEADING_DEFAULT_DURATION, clamp to available space.
 *
 * startTimes are recomputed to keep segments contiguous.
 */
export function applyHeadingTiming(segments: VideoSegment[]): VideoSegment[] {
  if (segments.length === 0) return segments;
  const segs = segments.map(s => ({ ...s }));

  for (let i = 0; i < segs.length; i++) {
    const seg = segs[i]!;
    if (!seg.isHeading && !(seg.heading && !seg.text)) continue; // not a heading-only slide
    if (seg.locked) continue;

    const prevIdx = nearestContentIdx(segs, i, -1);
    const nextIdx = nearestContentIdx(segs, i, 1);
    const prevSeg = prevIdx >= 0 ? segs[prevIdx]! : null;
    const nextSeg = nextIdx >= 0 ? segs[nextIdx]! : null;

    // SHRINK pass: Whisper assigned the heading the full spoken gap (> 1.0 s).
    // Split excess between prev and next neighbors, clamped to each neighbor's
    // available slack. If neither can absorb all of it, the heading retains the
    // remainder rather than over-inflating a neighbor.
    if (seg.duration > HEADING_DEFAULT_DURATION + 0.001) {
      const excess = Number((seg.duration - HEADING_DEFAULT_DURATION).toFixed(3));
      const MIN_DUR = 0.1;

      const prevAvail = prevIdx >= 0 && prevSeg !== null && !prevSeg.locked
        ? Math.max(0, prevSeg.duration - MIN_DUR) : 0;
      const nextAvail = nextIdx >= 0 && nextSeg !== null && !nextSeg.locked
        ? Math.max(0, nextSeg.duration - MIN_DUR) : 0;

      let giveToP = Math.min(excess / 2, prevAvail);
      let giveToN = Math.min(excess - giveToP, nextAvail);
      // If next is constrained, spill remainder back to prev.
      if (giveToP + giveToN < excess) {
        giveToP = Math.min(excess - giveToN, prevAvail);
      }

      const absorbed = giveToP + giveToN;
      const headingFinalDuration = absorbed < excess - 0.001
        ? Number((HEADING_DEFAULT_DURATION + (excess - absorbed)).toFixed(3))
        : HEADING_DEFAULT_DURATION;

      segs[i] = { ...seg, duration: headingFinalDuration };
      if (giveToP > 0 && prevIdx >= 0 && prevSeg !== null) {
        segs[prevIdx] = { ...prevSeg, duration: Number((prevSeg.duration + giveToP).toFixed(3)) };
      }
      if (giveToN > 0 && nextIdx >= 0 && nextSeg !== null) {
        segs[nextIdx] = { ...nextSeg, duration: Number((nextSeg.duration + giveToN).toFixed(3)) };
      }
      continue;
    }

    // GROW pass: Whisper collapsed heading to near zero; build back up to 1.0 s.
    const prevAvail = prevSeg && !prevSeg.locked
      ? Math.max(0, prevSeg.duration - MIN_SEGMENT_DURATION) : 0;
    const nextAvail = nextSeg && !nextSeg.locked
      ? Math.max(0, nextSeg.duration - MIN_SEGMENT_DURATION) : 0;
    const totalAvail = prevAvail + nextAvail;

    if (totalAvail <= 0) continue;

    const target = Math.min(HEADING_DEFAULT_DURATION, seg.duration + totalAvail);
    // Only take from neighbors the NET amount needed — the heading already holds seg.duration.
    const toTake = Math.max(0, target - seg.duration);

    let takeFromPrev: number;
    let takeFromNext: number;

    if (toTake < 0.001) {
      takeFromPrev = 0; takeFromNext = 0;
    } else if (prevAvail === 0) {
      takeFromPrev = 0; takeFromNext = toTake;
    } else if (nextAvail === 0) {
      takeFromPrev = toTake; takeFromNext = 0;
    } else {
      const half = toTake / 2;
      if (prevAvail >= half && nextAvail >= half) {
        takeFromPrev = half; takeFromNext = half;
      } else if (prevAvail < half) {
        takeFromPrev = prevAvail;
        takeFromNext = Math.min(toTake - prevAvail, nextAvail);
      } else {
        takeFromNext = nextAvail;
        takeFromPrev = Math.min(toTake - nextAvail, prevAvail);
      }
    }

    segs[i] = { ...seg, duration: target };
    if (prevIdx >= 0 && prevSeg !== null && takeFromPrev > 0) {
      segs[prevIdx] = { ...prevSeg, duration: prevSeg.duration - takeFromPrev };
    }
    if (nextIdx >= 0 && nextSeg !== null && takeFromNext > 0) {
      segs[nextIdx] = { ...nextSeg, duration: nextSeg.duration - takeFromNext };
    }
  }

  let acc = 0;
  return segs.map(s => {
    const t = acc;
    acc += s.duration;
    return { ...s, startTime: Number(t.toFixed(3)) };
  });
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

/**
 * Transcribes `audioAsset` using the bundled whisper-cli sidecar, streaming
 * progress via `onProgress` until the result (or an error) is returned.
 * Honouring `signal` aborts the job mid-flight.
 */
export async function transcribeWithProgress(
  audioAsset: Asset,
  durationSecs: number,
  onProgress: (percent: number) => void,
  signal: AbortSignal,
): Promise<TranscriptToken[]> {
  let buffer: ArrayBuffer;
  if (audioAsset.file) {
    // Prefer the raw File object — avoids blob URL fetch restrictions in WebView2 (Windows)
    buffer = await audioAsset.file.arrayBuffer();
  } else {
    // Fallback: fetch blob URL (works on macOS WebView, may fail on Windows)
    const response = await fetch(audioAsset.url);
    if (!response.ok) {
      throw new Error(`Failed to fetch audio: ${response.statusText}`);
    }
    buffer = await response.arrayBuffer();
  }
  const audiob64 = arrayBufferToBase64(buffer);

  return new Promise<TranscriptToken[]>((resolve, reject) => {
    if (signal.aborted) {
      reject(new DOMException('Aborted', 'AbortError'));
      return;
    }

    const channel = new Channel<WhisperEvent>();

    channel.onmessage = (msg) => {
      if (msg.event === 'Progress') {
        onProgress(msg.data.percent);
      } else if (msg.event === 'Done') {
        resolve(msg.data.tokens);
      } else if (msg.event === 'Error') {
        reject(new Error(msg.data.message));
      }
    };

    const onAbort = () => {
      invoke('whisper_cancel').catch(() => {});
      reject(new DOMException('Aborted', 'AbortError'));
    };
    signal.addEventListener('abort', onAbort, { once: true });

    invoke('whisper_transcribe', {
      audioB64: audiob64,
      durationSecs,
      onEvent: channel,
    }).catch((err: unknown) => {
      signal.removeEventListener('abort', onAbort);
      reject(err instanceof Error ? err : new Error(String(err)));
    });
  });
}
