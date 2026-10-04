import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { isAudioFile, AUDIO_EXTENSIONS, audioMimeTypeForName, withAudioMimeType, playableAudioBlob } from './audioFormats';

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

// 1.5.3 — V95/V100 played nothing: the zip-bundle door staged the voiceover as
// an untyped File, the build persisted `mimeType: ""`, and every open
// rehydrated an untyped blob. WebKit cannot sniff a bare-frame MP3 (no ID3)
// without a type, so <audio> failed with MEDIA_ERR_SRC_NOT_SUPPORTED (4).
describe('1.5.3 — a voiceover always carries its audio MIME type', () => {
  it('maps every supported audio extension to a non-empty audio/* type', () => {
    for (const ext of AUDIO_EXTENSIONS) {
      expect(audioMimeTypeForName(`voice.${ext}`)).toMatch(/^audio\//);
    }
    expect(audioMimeTypeForName('WH40K 1 - V95.mp3')).toBe('audio/mpeg');
    expect(audioMimeTypeForName('VOICE.M4A')).toBe('audio/mp4');
    expect(audioMimeTypeForName('notes.txt')).toBe('');
    expect(audioMimeTypeForName('voiceover')).toBe('');
  });

  it('types an untyped audio File by its name, keeping name and bytes', async () => {
    const untyped = new File([new Uint8Array([0xff, 0xfb, 0x90, 0xc4])], 'WH40K 1 - V100.mp3');
    expect(untyped.type).toBe('');
    const typed = withAudioMimeType(untyped);
    expect(typed.type).toBe('audio/mpeg');
    expect(typed.name).toBe('WH40K 1 - V100.mp3');
    expect(new Uint8Array(await typed.arrayBuffer())).toEqual(new Uint8Array([0xff, 0xfb, 0x90, 0xc4]));
  });

  it('leaves an already-typed or unrecognised file untouched', () => {
    const typed = new File([new Uint8Array([1])], 'voice.mp3', { type: 'audio/mpeg' });
    expect(withAudioMimeType(typed)).toBe(typed);
    const unknown = new File([new Uint8Array([1])], 'voiceover');
    expect(withAudioMimeType(unknown)).toBe(unknown);
  });

  it('repairs an already-persisted untyped audio blob at open (V95/V100 shape)', () => {
    const stored = new Blob([new Uint8Array([0xff, 0xfb])]);
    expect(playableAudioBlob(stored, 'WH40K 1 - V95.mp3', 'audio').type).toBe('audio/mpeg');
    const good = new Blob([new Uint8Array([1])], { type: 'audio/x-m4a' });
    expect(playableAudioBlob(good, 'voiceover.m4a', 'audio')).toBe(good);
    const image = new Blob([new Uint8Array([1])]);
    expect(playableAudioBlob(image, 'shot.mp3', 'image')).toBe(image);
  });

  it('the project-open rehydrate goes through the repair', () => {
    const app = readFileSync(resolve(import.meta.dirname, '..', 'App.tsx'), 'utf-8');
    expect(app).toMatch(/playableAudioBlob\(stored\.blob, asset\.name, asset\.type\)/);
  });
});
