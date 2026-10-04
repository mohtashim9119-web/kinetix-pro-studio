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

/**
 * 1.5.3 — the audio MIME type for a voiceover filename, or '' when the
 * extension is not a supported audio format. A Blob with no type cannot be
 * sniffed by WebKit when the MP3 starts on a bare frame (no ID3 tag): the
 * preview's <audio> fails with MEDIA_ERR_SRC_NOT_SUPPORTED and plays nothing.
 */
const AUDIO_MIME_BY_EXTENSION: Readonly<Record<(typeof AUDIO_EXTENSIONS)[number], string>> = {
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  m4a: 'audio/mp4',
  ogg: 'audio/ogg',
  flac: 'audio/flac',
  aac: 'audio/aac',
  wma: 'audio/x-ms-wma',
  opus: 'audio/ogg',
  aiff: 'audio/aiff',
  aif: 'audio/aiff',
};

export function audioMimeTypeForName(name: string): string {
  const ext = fileExtension(name);
  return (AUDIO_MIME_BY_EXTENSION as Record<string, string>)[ext] ?? '';
}

/** The same file typed by its name when it arrived untyped (the zip-bundle
 *  door, or any picker that leaves `type` empty); otherwise the file itself. */
export function withAudioMimeType(file: File): File {
  if (file.type) return file;
  const type = audioMimeTypeForName(file.name);
  if (!type) return file;
  return new File([file], file.name, { type, lastModified: file.lastModified });
}

/** Open-time repair for a project already persisted with `mimeType: ""`
 *  (built through the bundle door before 1.5.3): an untyped audio blob is
 *  re-wrapped with the type its name implies. Anything else is returned as is. */
export function playableAudioBlob(blob: Blob, name: string, assetType: string): Blob {
  if (blob.type || assetType !== 'audio') return blob;
  const type = audioMimeTypeForName(name);
  return type ? new Blob([blob], { type }) : blob;
}
