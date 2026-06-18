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
// Public helpers (also used by useWhisper)
// ---------------------------------------------------------------------------

export function alignScenestoTranscript(
  segments: VideoSegment[],
  tokens: TranscriptToken[],
  silences: SilenceInterval[] = [],
): Array<{ t0: number; t1: number }> {
  if (!tokens.length || !segments.length) {
    return segments.map(() => ({ t0: 0, t1: 0 }));
  }

  function normalize(s: string): string[] {
    return s
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ') // replace punctuation with space, not nothing
      .split(/\s+/)
      .filter(w => w.length > 0);
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

    // Advance searchStart past all tokenWords sharing t1TokenIdx (the last matched token).
    // Audio-grounded, not text-length-grounded: editing scene description text cannot
    // shift where the next segment's scoring window begins.
    let nextSearchStart = effectiveLastWordPos + 1;
    while (nextSearchStart < tokenWords.length && (tokenWords[nextSearchStart]?.tokenIdx ?? Infinity) <= t1TokenIdx) {
      nextSearchStart++;
    }
    searchStart = nextSearchStart;
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
    const searchStart = spokenMid - searchRadius;
    const searchEnd   = spokenMid + searchRadius;

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

/**
 * Anchor-aware variant of alignScenestoTranscript.
 *
 * - Segments with `anchorSource === 'whisper'` are treated as fixed: their
 *   t0 = anchorStart and t1 = the next Whisper-anchored segment's anchorStart
 *   (or audioDuration).
 * - All other segments (new, estimate-anchored) are aligned within the gap
 *   defined by their nearest Whisper-anchored neighbors, using the existing
 *   sliding-window matcher.
 */
export function alignScenesToTranscriptAnchorAware(
  segments: VideoSegment[],
  tokens: TranscriptToken[],
  silences: SilenceInterval[],
  audioDuration: number,
): Array<{ t0: number; t1: number }> {
  const result: Array<{ t0: number; t1: number }> = new Array(segments.length);
  // Cache: non-Whisper block's first index → matcher output for that block
  const blockCache = new Map<number, Array<{ t0: number; t1: number }>>();

  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i]!;

    if (seg.anchorSource === 'whisper') {
      const t0 = seg.anchorStart ?? 0;
      let t1 = audioDuration;
      for (let j = i + 1; j < segments.length; j++) {
        if (segments[j]!.anchorSource === 'whisper') {
          t1 = segments[j]!.anchorStart ?? 0;
          break;
        }
      }
      result[i] = { t0, t1 };
      continue;
    }

    // Non-Whisper (new or estimate) — find the contiguous non-Whisper block containing i.
    let blockStart = i;
    while (blockStart > 0 && segments[blockStart - 1]!.anchorSource !== 'whisper') {
      blockStart--;
    }

    if (!blockCache.has(blockStart)) {
      let blockEnd = i;
      while (blockEnd + 1 < segments.length && segments[blockEnd + 1]!.anchorSource !== 'whisper') {
        blockEnd++;
      }

      // Gap bounds from nearest Whisper-anchored neighbors.
      let gapStart = 0;
      for (let j = blockStart - 1; j >= 0; j--) {
        if (segments[j]!.anchorSource === 'whisper') {
          gapStart = segments[j]!.anchorStart ?? 0;
          break;
        }
      }
      let gapEnd = audioDuration;
      for (let j = blockEnd + 1; j < segments.length; j++) {
        if (segments[j]!.anchorSource === 'whisper') {
          gapEnd = segments[j]!.anchorStart ?? 0;
          break;
        }
      }

      const tokensInGap = tokens.filter(t => t.startSec >= gapStart && t.endSec <= gapEnd);
      const blockSegments = segments.slice(blockStart, blockEnd + 1);
      // duplicated from alignScenestoTranscript — refactor candidate
      const blockAlignments = alignScenestoTranscript(blockSegments, tokensInGap, silences);

      // Force the last non-Whisper segment's right boundary to the gap end so it
      // does not overlap the following Whisper-anchored segment.
      if (blockAlignments.length > 0) {
        blockAlignments[blockAlignments.length - 1]!.t1 = gapEnd;
      }

      blockCache.set(blockStart, blockAlignments);
    }

    const blockAlignments = blockCache.get(blockStart)!;
    result[i] = blockAlignments[i - blockStart] ?? { t0: 0, t1: 0 };
  }

  return result;
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
  return segments.map((seg, i) => {
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

    // splitAudio: heading inserts dead video time without stealing from neighbors.
    // Set duration to HEADING_DEFAULT_DURATION and shift all subsequent segments
    // forward by the delta so they stay in sync with the audio.
    if (seg.headingConfig?.splitAudio) {
      const originalDur = seg.duration;
      segs[i] = { ...seg, duration: HEADING_DEFAULT_DURATION };
      const shift = Number((HEADING_DEFAULT_DURATION - originalDur).toFixed(3));
      if (Math.abs(shift) > 0.001) {
        for (let j = i + 1; j < segs.length; j++) {
          const after = segs[j];
          if (!after) continue;
          segs[j] = {
            ...after,
            startTime: Number((after.startTime + shift).toFixed(3)),
            ...(after.anchorStart !== undefined
              ? { anchorStart: Number((after.anchorStart + shift).toFixed(3)) }
              : {}),
          };
        }
      }
      continue;
    }

    const prevIdx = nearestContentIdx(segs, i, -1);
    const nextIdx = nearestContentIdx(segs, i, 1);
    const prevSeg = prevIdx >= 0 ? segs[prevIdx]! : null;
    const nextSeg = nextIdx >= 0 ? segs[nextIdx]! : null;

    // SHRINK pass: Whisper assigned the heading the full spoken gap (> 1.0 s).
    // Return excess to previous unlocked neighbor; fall back to next.
    if (seg.duration > HEADING_DEFAULT_DURATION + 0.001) {
      const excess = Number((seg.duration - HEADING_DEFAULT_DURATION).toFixed(3));
      segs[i] = { ...seg, duration: HEADING_DEFAULT_DURATION };
      if (prevIdx >= 0 && prevSeg !== null && !prevSeg.locked) {
        segs[prevIdx] = { ...prevSeg, duration: Number((prevSeg.duration + excess).toFixed(3)) };
      } else if (nextIdx >= 0 && nextSeg !== null && !nextSeg.locked) {
        segs[nextIdx] = { ...nextSeg, duration: Number((nextSeg.duration + excess).toFixed(3)) };
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
  const response = await fetch(audioAsset.url);
  if (!response.ok) {
    throw new Error(`Failed to fetch audio: ${response.statusText}`);
  }
  const buffer = await response.arrayBuffer();
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
