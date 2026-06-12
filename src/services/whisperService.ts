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
    };
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
