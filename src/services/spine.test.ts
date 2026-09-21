/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// ---------------------------------------------------------------------------
// plan-v3 Wave 2 item 4 — content-hash spine.
//
// THE OLD BUG THIS PROVES FIXED. `syncEngine.ts`'s `getFileIdentity` was
// `${name}|${size}|${lastModified}`, and it was the transcript cache key
// (`Project.lastTranscribedFileIdentity`, compared at App.tsx's
// `cachedTokensReady`/`handleVoiceoverStaged`). A media swap that re-copies
// or re-exports the exact same audio bytes under a new filename or a fresh
// `lastModified` produced a DIFFERENT identity string under the old scheme,
// even though nothing about the audio actually changed — forcing a full
// re-transcription every time. `computeAudioHash` reads the file's actual
// bytes, so it is immune to name/mtime drift: this file's first test
// ('two Files with identical bytes...') is the direct regression proof —
// it fails against `getFileIdentity` (two different name/mtime strings
// never compare equal) and passes against `computeAudioHash`.
// ---------------------------------------------------------------------------

import { describe, it, expect } from 'vitest';
import { computeAudioHash, computeScriptHash, spineEquals, type SyncSpine } from './spine';
import { normalizeScriptForHash } from './scriptNormalize';
import { getFileIdentity } from './syncEngine';

describe('computeAudioHash — the content-hash cache key (A5)', () => {
  it('two Files with identical bytes but different name/mtime hash the same', async () => {
    const bytes = new Uint8Array([1, 2, 3, 4, 5, 250, 0, 128]);
    const fileA = new File([bytes], 'voiceover-v1.wav', { lastModified: 1_700_000_000_000 });
    const fileB = new File([bytes], 'voiceover-v2-reexport.wav', { lastModified: 1_800_000_000_000 });

    // The bug this fixes, stated as a fact about the OLD key: it would have
    // called these two files different.
    expect(getFileIdentity(fileA)).not.toBe(getFileIdentity(fileB));

    // The new key correctly calls them the same — a media swap with
    // identical content must not force a re-transcription.
    const [hashA, hashB] = await Promise.all([computeAudioHash(fileA), computeAudioHash(fileB)]);
    expect(hashA).toBe(hashB);
  });

  it('a real content change produces a different hash', async () => {
    const fileA = new File([new Uint8Array([1, 2, 3])], 'a.wav', { lastModified: 1 });
    const fileB = new File([new Uint8Array([1, 2, 4])], 'a.wav', { lastModified: 1 });
    const [hashA, hashB] = await Promise.all([computeAudioHash(fileA), computeAudioHash(fileB)]);
    expect(hashA).not.toBe(hashB);
  });

  it('is a lowercase hex SHA-256 digest (64 chars)', async () => {
    const hash = await computeAudioHash(new File([new Uint8Array([9, 9, 9])], 'x.wav'));
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('is deterministic across repeated calls on the same bytes', async () => {
    const file = new File([new Uint8Array([7, 7, 7, 7])], 'x.wav');
    const first = await computeAudioHash(file);
    const second = await computeAudioHash(file);
    expect(first).toBe(second);
  });
});

describe('normalizeScriptForHash — whitespace/line-ending collapse ONLY (B2)', () => {
  it('collapses line-ending differences (CRLF vs LF)', () => {
    expect(normalizeScriptForHash('Line one.\r\nLine two.'))
      .toBe(normalizeScriptForHash('Line one.\nLine two.'));
  });

  it('collapses a trailing-space / re-indent edit', () => {
    expect(normalizeScriptForHash('Hello world.   \n  '))
      .toBe(normalizeScriptForHash('Hello world.'));
  });

  it('does NOT hide a real word change — B2s stated over-normalization risk', () => {
    expect(normalizeScriptForHash('The cat sat.')).not.toBe(normalizeScriptForHash('The cat ran.'));
  });

  it('does NOT strip punctuation — a punctuation-only edit still changes the text', () => {
    expect(normalizeScriptForHash('Wait, really?')).not.toBe(normalizeScriptForHash('Wait really'));
  });
});

describe('computeScriptHash — the alignment half of the spine (H3)', () => {
  it('a whitespace-only script edit does not invalidate the spine', async () => {
    const a = await computeScriptHash('Hello world.\nScene two.', 'Scene A tags');
    const b = await computeScriptHash('Hello world.  \r\n\r\nScene two.', 'Scene A tags');
    expect(a).toBe(b);
  });

  it('a real word change invalidates the spine', async () => {
    const a = await computeScriptHash('Hello world.', 'Scene A tags');
    const b = await computeScriptHash('Hello there.', 'Scene A tags');
    expect(a).not.toBe(b);
  });

  it('a scene-details-only change invalidates the spine (headings/tags live there)', async () => {
    const a = await computeScriptHash('Hello world.', 'Scene A tags');
    const b = await computeScriptHash('Hello world.', 'Scene B tags');
    expect(a).not.toBe(b);
  });

  it('never collides across the script/scene boundary', async () => {
    const a = await computeScriptHash('ab', 'c');
    const b = await computeScriptHash('a', 'bc');
    expect(a).not.toBe(b);
  });
});

describe('spineEquals', () => {
  const s: SyncSpine = { audioHash: 'aa', scriptHash: 'bb' };

  it('true only when both halves match', () => {
    expect(spineEquals(s, { audioHash: 'aa', scriptHash: 'bb' })).toBe(true);
  });

  it('false when only the audio half changed (visuals-only claim would be wrong here)', () => {
    expect(spineEquals(s, { audioHash: 'zz', scriptHash: 'bb' })).toBe(false);
  });

  it('false when only the script half changed', () => {
    expect(spineEquals(s, { audioHash: 'aa', scriptHash: 'zz' })).toBe(false);
  });

  it('false against null/undefined — never a wildcard match', () => {
    expect(spineEquals(s, null)).toBe(false);
    expect(spineEquals(s, undefined)).toBe(false);
    expect(spineEquals(null, s)).toBe(false);
  });
});
