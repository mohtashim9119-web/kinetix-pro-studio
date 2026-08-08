/**
 * Audio-format classification for voiceover uploads.
 *
 * A file is treated as a voiceover if its extension is in `AUDIO_EXTENSIONS`
 * OR (for files with an unusual/missing extension) its MIME type starts with
 * `audio/`. Every listed format is transcodable to 16 kHz mono WAV by the
 * bundled ffmpeg before Whisper sees it (see `transcode_to_wav` in
 * `src-tauri/src/whisper.rs`), so "routes to voiceover" now means "genuinely
 * supported end-to-end", not just "reaches the slot".
 *
 * Previously the router hardcoded only `mp3/wav/m4a/ogg`; anything else (flac,
 * aac, wma, opus, aiff…) fell silently into the image-asset bucket.
 */
export const AUDIO_EXTENSIONS = [
  'mp3',
  'wav',
  'm4a',
  'ogg',
  'flac',
  'aac',
  'wma',
  'opus',
  'aiff',
  'aif',
] as const;

/** Lowercased trailing extension of a filename, or '' if there is none. */
function fileExtension(name: string): string {
  const idx = name.lastIndexOf('.');
  if (idx < 0 || idx === name.length - 1) return '';
  return name.slice(idx + 1).toLowerCase();
}

/**
 * True when a dropped/picked file should be routed to the Voiceover slot.
 *
 * Extension check first (fast, deterministic), then a `audio/*` MIME fallback
 * for files whose name lacks a recognized extension (e.g. a raw recording named
 * `voiceover` with type `audio/mpeg`).
 */
export function isAudioFile(file: File): boolean {
  const ext = fileExtension(file.name);
  if ((AUDIO_EXTENSIONS as readonly string[]).includes(ext)) return true;
  return file.type.startsWith('audio/');
}
