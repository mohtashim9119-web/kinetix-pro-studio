import { describe, it, expect } from 'vitest';
import { isAudioFile, AUDIO_EXTENSIONS } from './audioFormats';

/** Builds a File with a given name/MIME for classification tests. */
function makeFile(name: string, type = ''): File {
  return new File([new Uint8Array([1, 2, 3])], name, { type });
}

describe('isAudioFile — voiceover extension router (Part 2)', () => {
  it('routes every supported audio extension to voiceover', () => {
    for (const ext of AUDIO_EXTENSIONS) {
      expect(isAudioFile(makeFile(`voice.${ext}`))).toBe(true);
    }
  });

  it('routes FLAC to voiceover (regression: previously fell into the image-asset bucket)', () => {
    // The pre-fix router hardcoded ['mp3','wav','m4a','ogg'] — a .flac dropped
    // on the Voiceover slot was silently misrouted to assets. It must now
    // classify as audio.
    expect(isAudioFile(makeFile('narration.flac'))).toBe(true);
  });

  it('routes the other previously-dropped formats (aac, wma, opus, aiff, aif) to voiceover', () => {
    for (const ext of ['aac', 'wma', 'opus', 'aiff', 'aif']) {
      expect(isAudioFile(makeFile(`clip.${ext}`))).toBe(true);
    }
  });

  it('is case-insensitive on the extension', () => {
    expect(isAudioFile(makeFile('LOUD.WAV'))).toBe(true);
    expect(isAudioFile(makeFile('Track.Mp3'))).toBe(true);
  });

  it('falls back to the audio/* MIME type when the extension is unrecognized or missing', () => {
    expect(isAudioFile(makeFile('recording', 'audio/mpeg'))).toBe(true);
    expect(isAudioFile(makeFile('take1.weirdext', 'audio/x-caf'))).toBe(true);
  });

  it('does NOT classify non-audio files as voiceover', () => {
    expect(isAudioFile(makeFile('hero.jpg', 'image/jpeg'))).toBe(false);
    expect(isAudioFile(makeFile('clip.mp4', 'video/mp4'))).toBe(false);
    expect(isAudioFile(makeFile('script.txt', 'text/plain'))).toBe(false);
    expect(isAudioFile(makeFile('bundle.zip', 'application/zip'))).toBe(false);
    expect(isAudioFile(makeFile('noext'))).toBe(false);
  });

  it('does not treat a dotted stem without a real trailing extension as audio', () => {
    // "mix.final." ends in a dot → no extension token → not audio by extension,
    // and no audio MIME → false.
    expect(isAudioFile(makeFile('mix.final.'))).toBe(false);
  });
});
