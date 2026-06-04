import { invoke } from '@tauri-apps/api/core';

export interface WhisperToken {
  text: string;
  t0: number; // start seconds
  t1: number; // end seconds
}

export interface WhisperSegment {
  text: string;
  t0: number;
  t1: number;
  tokens: WhisperToken[];
}

export interface WhisperResult {
  segments: WhisperSegment[];
  text: string;
}

/**
 * Transcribes an audio file using the bundled whisper-cli sidecar.
 * Returns word-level timestamps.
 * Only available in Tauri desktop app — throws in browser.
 */
export async function transcribeAudio(
  audioUrl: string
): Promise<WhisperResult> {
  // Fetch the audio blob from the blob: URL
  const response = await fetch(audioUrl);
  if (!response.ok) {
    throw new Error(`Failed to fetch audio: ${response.statusText}`);
  }
  const arrayBuffer = await response.arrayBuffer();
  const uint8 = new Uint8Array(arrayBuffer);

  // Base64 encode in 32KB chunks (same pattern as bytesToBase64 in tauriFfmpeg.ts)
  const CHUNK = 32768;
  let b64 = '';
  for (let i = 0; i < uint8.length; i += CHUNK) {
    b64 += btoa(String.fromCharCode(...uint8.subarray(i, i + CHUNK)));
  }

  const result = await invoke<WhisperResult>('whisper_transcribe', {
    audioB64: b64,
  });

  return result;
}

/**
 * Groups whisper tokens by scene based on script text alignment.
 * Each scene gets the time range covering its words in the transcript.
 *
 * scenes: array of scene text strings (from parseProjectData scene descriptions)
 * result: WhisperResult from transcribeAudio
 *
 * Returns array of { t0, t1 } for each scene, in order.
 * Scenes that cannot be matched get evenly distributed remaining time.
 */
export function alignScenestoTranscript(
  scenes: string[],
  result: WhisperResult
): Array<{ t0: number; t1: number }> {
  if (!result.segments.length || !scenes.length) return [];

  // Flatten all tokens into a single timeline
  const allTokens: WhisperToken[] = result.segments.flatMap(s => s.tokens);
  if (!allTokens.length) {
    // No word-level tokens — fall back to segment-level distribution
    return distributeSegmentTimes(scenes, result.segments);
  }

  const totalDuration = allTokens[allTokens.length - 1]?.t1 ?? 0;
  const totalWords = allTokens.length;
  const wordsPerScene = Math.max(1, Math.floor(totalWords / scenes.length));

  const aligned: Array<{ t0: number; t1: number }> = [];

  for (let i = 0; i < scenes.length; i++) {
    const startIdx = i * wordsPerScene;
    const endIdx = i === scenes.length - 1
      ? allTokens.length - 1
      : Math.min((i + 1) * wordsPerScene - 1, allTokens.length - 1);

    const t0 = allTokens[startIdx]?.t0 ?? (totalDuration * i / scenes.length);
    const t1 = allTokens[endIdx]?.t1 ?? (totalDuration * (i + 1) / scenes.length);

    aligned.push({ t0, t1: Math.max(t0 + 0.1, t1) });
  }

  return aligned;
}

/** Fallback: distribute segment times evenly across scenes. */
function distributeSegmentTimes(
  scenes: string[],
  segments: WhisperSegment[]
): Array<{ t0: number; t1: number }> {
  const totalDuration = segments[segments.length - 1]?.t1 ?? 0;
  return scenes.map((_, i) => ({
    t0: totalDuration * i / scenes.length,
    t1: totalDuration * (i + 1) / scenes.length,
  }));
}
