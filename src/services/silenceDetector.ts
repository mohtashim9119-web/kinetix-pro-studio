export interface SilenceInterval {
  startSec: number;
  endSec: number;
}

export async function detectSilences(
  audioBlob: Blob,
  options?: {
    thresholdDb?: number;
    minDurationSec?: number;
    frameSizeMs?: number;
  },
): Promise<SilenceInterval[]> {
  const thresholdDb = options?.thresholdDb ?? -45;
  const minDurationSec = options?.minDurationSec ?? 0.25;
  const frameSizeMs = options?.frameSizeMs ?? 20;

  const arrayBuffer = await audioBlob.arrayBuffer();
  const audioCtx = new AudioContext();
  let audioBuffer: AudioBuffer;
  try {
    audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);
  } finally {
    await audioCtx.close();
  }

  const sampleRate = audioBuffer.sampleRate;
  const channelData = audioBuffer.getChannelData(0);
  const frameSizeSamples = Math.floor((frameSizeMs / 1000) * sampleRate);
  if (frameSizeSamples < 1) return [];

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

  return silences;
}
