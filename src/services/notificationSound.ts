import chimeUrl from '../assets/export-complete-chime.wav';

/**
 * Export-complete notification chime (originally two-tone WAV, ~0.5s,
 * generated for this project — no third-party licensing to track).
 * Played via Web Audio API decode, never a runtime-synthesized
 * OscillatorNode tone, per the export-UX product decision (docs/history.md).
 */

type AudioContextCtor = new () => AudioContext;

function resolveAudioContextCtor(): AudioContextCtor | null {
  if (typeof AudioContext !== 'undefined') return AudioContext;
  const w = globalThis as unknown as { webkitAudioContext?: AudioContextCtor };
  return w.webkitAudioContext ?? null;
}

// Singleton context + decoded-buffer cache — reused across repeated exports
// in the same session rather than spinning up a new AudioContext each time.
let sharedContext: AudioContext | null = null;
let cachedBuffer: AudioBuffer | null = null;

async function loadBuffer(ctx: AudioContext): Promise<AudioBuffer> {
  if (cachedBuffer) return cachedBuffer;
  const response = await fetch(chimeUrl);
  const arrayBuffer = await response.arrayBuffer();
  const buffer = await ctx.decodeAudioData(arrayBuffer);
  cachedBuffer = buffer;
  return buffer;
}

/**
 * Plays the export-complete chime. Never throws — a missing AudioContext
 * (non-browser runtime), a blocked-autoplay resume() rejection, or a
 * fetch/decode failure all fail silently so a sound glitch can never break
 * the completion toast it accompanies.
 */
export async function playExportCompleteChime(): Promise<void> {
  try {
    const Ctor = resolveAudioContextCtor();
    if (!Ctor) return;
    if (!sharedContext) {
      sharedContext = new Ctor();
    }
    const ctx = sharedContext;
    await ctx.resume().catch(() => undefined);
    const buffer = await loadBuffer(ctx);
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(ctx.destination);
    source.start(0);
  } catch {
    // Best-effort — see the doc comment above.
  }
}

/** Test-only: clears the singleton context/buffer so each test gets a fresh probe. */
export function __resetNotificationSoundForTests(): void {
  sharedContext = null;
  cachedBuffer = null;
}
