export interface SilenceInterval {
  startSec: number;
  endSec: number;
}

/**
 * WS4 Feature 3 (decision 11a) — silence detection reports failure instead of
 * swallowing it.
 *
 * Before: any throw (fetch, `decodeAudioData`, an unavailable AudioContext)
 * propagated to the caller's bare `catch { return []; }`, which is
 * indistinguishable from "this audio genuinely has no silence in it". The two
 * outcomes have opposite meanings for boundary placement — with real silences,
 * boundaries land in acoustic gaps; with none, every boundary silently degrades
 * to a token midpoint — and the user was never told which one they got.
 *
 * A discriminated union makes the distinction unignorable at the type level:
 * callers cannot read `.silences` without first narrowing on `status`.
 */
export type SilenceDetectResult =
  | { status: 'ok'; silences: SilenceInterval[] }
  | { status: 'error'; errorMessage: string };

function describeError(err: unknown): string {
  if (err instanceof Error) return err.message || err.name;
  return String(err);
}

/**
 * Scans `audioBlob` for silent stretches via the Web Audio API.
 *
 * NEVER throws — every failure mode (unreadable blob, unavailable AudioContext,
 * decode failure) comes back as `{ status: 'error', errorMessage }`. A
 * successful scan that simply found nothing returns `{ status: 'ok',
 * silences: [] }`, which is a different thing and now says so.
 */
export async function detectSilences(
  audioBlob: Blob,
  options?: {
    thresholdDb?: number;
    minDurationSec?: number;
    frameSizeMs?: number;
  },
): Promise<SilenceDetectResult> {
  const thresholdDb = options?.thresholdDb ?? -45;
  const minDurationSec = options?.minDurationSec ?? 0.25;
  const frameSizeMs = options?.frameSizeMs ?? 20;

  let audioBuffer: AudioBuffer;
  try {
    const arrayBuffer = await audioBlob.arrayBuffer();
    const audioCtx = new AudioContext();
    try {
      audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);
    } finally {
      // Closing is best-effort cleanup: a close() failure must not mask the
      // decode error (or manufacture one on an otherwise successful decode).
      await audioCtx.close().catch(() => {});
    }
  } catch (err) {
    return { status: 'error', errorMessage: describeError(err) };
  }

  const sampleRate = audioBuffer.sampleRate;
  const channelData = audioBuffer.getChannelData(0);
  const frameSizeSamples = Math.floor((frameSizeMs / 1000) * sampleRate);
  // A frame smaller than one sample means the scan cannot run at all — that is
  // a real failure of the requested configuration, not an absence of silence.
  if (frameSizeSamples < 1) {
    return {
      status: 'error',
      errorMessage: `frame size ${frameSizeMs}ms is below one sample at ${sampleRate}Hz`,
    };
  }

  const totalFrames = Math.floor(channelData.length / frameSizeSamples);
  const silences: SilenceInterval[] = [];
  let silenceStart: number | null = null;

  for (let f = 0; f < totalFrames; f++) {
    const offset = f * frameSizeSamples;
    let sumSq = 0;
    for (let i = 0; i < frameSizeSamples; i++) {
      const s = channelData[offset + i] ?? 0;
      sumSq += s * s;
    }
    const rms = Math.sqrt(sumSq / frameSizeSamples);
    const db = rms === 0 ? -Infinity : 20 * Math.log10(rms);
    const frameSec = (f * frameSizeSamples) / sampleRate;

    if (db < thresholdDb) {
      if (silenceStart === null) silenceStart = frameSec;
    } else if (silenceStart !== null) {
      if (frameSec - silenceStart >= minDurationSec) {
        silences.push({ startSec: silenceStart, endSec: frameSec });
      }
      silenceStart = null;
    }
  }

  // Trailing silence reaching the end of audio.
  if (silenceStart !== null) {
    const endSec = (totalFrames * frameSizeSamples) / sampleRate;
    if (endSec - silenceStart >= minDurationSec) {
      silences.push({ startSec: silenceStart, endSec });
    }
  }

  return { status: 'ok', silences };
}
