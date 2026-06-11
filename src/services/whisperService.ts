import { invoke, Channel } from '@tauri-apps/api/core';
import type { Asset, VideoSegment, TranscriptToken } from '../types';

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
    const t1TokenIdx = tokenWords[Math.min(bestEnd, tokenWords.length - 1)]?.tokenIdx ?? t0TokenIdx;

    const t0 = tokens[t0TokenIdx]?.startSec ?? 0;
    const t1 = tokens[t1TokenIdx]?.endSec ?? t0 + 0.1;

    results.push({
      t0,
      t1: Math.max(t0 + 0.05, t1),
      firstTokenIdx: t0TokenIdx,
      lastTokenIdx: t1TokenIdx,
    });

    searchStart = bestStart + Math.max(1, Math.floor(targetWords.length * 0.8));
  }

  // Pass 2: silence-aware boundary detection
  // Use actual token gaps from Whisper output to place boundaries precisely
  for (let i = 0; i < results.length - 1; i++) {
    const curr = results[i]!;
    const next = results[i + 1]!;

    // Actual end of last spoken word in curr, start of first spoken word in next.
    // Sentinel -1 indices (empty segments) safely return undefined → fallback to t1/t0.
    const currLastTokenEnd   = tokens[curr.lastTokenIdx]?.endSec   ?? curr.t1;
    const nextFirstTokenStart = tokens[next.firstTokenIdx]?.startSec ?? next.t0;

    if (nextFirstTokenStart > currLastTokenEnd) {
      // There is a silence gap between the two segments — split it 50/50.
      const silenceGap = nextFirstTokenStart - currLastTokenEnd;
      curr.t1 = currLastTokenEnd + silenceGap * 0.5;
      next.t0 = curr.t1;
    } else {
      // No silence gap (back-to-back or overlapping token spans).
      // Use midpoint of the boundary to avoid a hard cut at a non-zero overlap.
      const mid = (currLastTokenEnd + nextFirstTokenStart) / 2;
      curr.t1 = mid;
      next.t0 = mid;
    }
  }

  // Clamp last segment to actual audio end
  const audioEnd = tokens[tokens.length - 1]?.endSec ?? 0;
  if (results.length > 0) {
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
