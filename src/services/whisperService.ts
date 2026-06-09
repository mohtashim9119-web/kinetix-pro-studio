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

/** Parses whisper stdout text (multiline) into an array of TranscriptTokens. */
export function parseWhisperStdout(stdout: string): TranscriptToken[] {
  const tokens: TranscriptToken[] = [];
  for (const line of stdout.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('[')) continue;
    const closeIdx = trimmed.indexOf(']');
    if (closeIdx === -1) continue;
    const tsPart = trimmed.slice(1, closeIdx);
    const arrowIdx = tsPart.indexOf(' --> ');
    if (arrowIdx === -1) continue;
    const startSec = parseTimestamp(tsPart.slice(0, arrowIdx));
    const endSec = parseTimestamp(tsPart.slice(arrowIdx + 5));
    const text = trimmed.slice(closeIdx + 1).trim();
    if (text) tokens.push({ startSec, endSec, text });
  }
  return tokens;
}

/**
 * Aligns project segments to whisper transcript tokens by distributing tokens
 * proportionally across segments.
 * Returns `{ t0, t1 }` windows for each segment (same length as `segments`).
 */
export function alignScenestoTranscript(
  segments: VideoSegment[],
  tokens: TranscriptToken[],
): Array<{ t0: number; t1: number }> {
  if (!tokens.length || !segments.length) {
    return segments.map(() => ({ t0: 0, t1: 0 }));
  }

  const totalDuration = tokens[tokens.length - 1]?.endSec ?? 0;
  const totalTokens = tokens.length;
  const tokensPerScene = Math.max(1, Math.floor(totalTokens / segments.length));

  return segments.map((_, i) => {
    const startIdx = i * tokensPerScene;
    const endIdx =
      i === segments.length - 1
        ? totalTokens - 1
        : Math.min((i + 1) * tokensPerScene - 1, totalTokens - 1);

    const t0 =
      tokens[startIdx]?.startSec ?? (totalDuration * i) / segments.length;
    const t1 =
      tokens[endIdx]?.endSec ??
      (totalDuration * (i + 1)) / segments.length;

    return { t0, t1: Math.max(t0 + 0.1, t1) };
  });
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
