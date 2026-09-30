/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// Grammar coverage, Commit B — a bare integer in a non-English script reads as
// the DETECTED language's cardinal words in the matcher, the same words forced
// alignment speaks, so a German script "3" matches whisper's "drei" instead of
// missing against "three". English is untouched.

import { describe, it, expect } from 'vitest';
import { canonicalize } from './textNormalize';
import { normalizeForForcedAlignment, type FaLanguageCode } from './faTextNormalize';
import { loadFaLanguageData } from './faLanguageData';
import { alignScenestoTranscript } from './whisperService';
import type { TranscriptToken, VideoSegment } from '../types';

const NON_EN: FaLanguageCode[] = ['es', 'fr', 'de', 'pt'];

function fa(text: string, lang: FaLanguageCode): string[] {
  const d = loadFaLanguageData(lang)!;
  return normalizeForForcedAlignment(text, lang, d.vocabChars, d.cardinalData).text.split(' ').filter(Boolean);
}

// Small numbers, every teen/decade edge, hundreds, thousands, year-shaped.
const SWEEP = [
  ...Array.from({ length: 101 }, (_, i) => i),
  101, 110, 121, 199, 200, 999, 1000, 1001, 1100, 1999, 2000, 2001, 2024, 2099, 3000, 9999,
].map(String);

describe('a bare integer reads in the detected language', () => {
  it('the documented case: German "3" is "drei", not "three"', () => {
    expect(canonicalize('3', 'de')).toEqual(['drei']);
    expect(canonicalize('12', 'es')).toEqual(['doce']);
  });

  for (const lang of NON_EN) {
    it(`${lang}: matcher and forced alignment read every bare integer 0-100 and the edges identically`, () => {
      const mismatches = SWEEP.filter(n => JSON.stringify(canonicalize(n, lang)) !== JSON.stringify(fa(n, lang)));
      expect(mismatches).toEqual([]);
    });
  }

  it('English (and no language) is byte-for-byte the original reader', () => {
    expect(canonicalize('3', 'en')).toEqual(['three']);
    expect(canonicalize('3')).toEqual(['three']);
    expect(canonicalize('1998', 'en')).toEqual(['nineteen', 'ninety', 'eight']);
    expect(canonicalize('12', 'en')).toEqual(['twelve']);
    for (const n of SWEEP) expect(canonicalize(n, 'en')).toEqual(canonicalize(n));
  });

  it('a token the shared reader declines keeps the legacy reading (leading zero, huge run)', () => {
    expect(canonicalize('007', 'de')).toEqual(canonicalize('007'));
    expect(canonicalize('123456789012345678901234567890', 'es')).toEqual(canonicalize('123456789012345678901234567890'));
  });

  it('symmetric: a script digit and the spelled-out transcript word are the same tokens', () => {
    expect(canonicalize('wir haben 3 Katzen', 'de')).toEqual(canonicalize('wir haben drei Katzen', 'de'));
    expect(canonicalize('tengo 12 gatos', 'es')).toEqual(canonicalize('tengo doce gatos', 'es'));
  });
});

describe('the matcher now aligns a non-English script digit to the spoken word', () => {
  const seg = (id: string, text: string, startTime: number, order: number): VideoSegment =>
    ({ id, text, startTime, duration: 3, transition: 'none', animation: 'none', order }) as unknown as VideoSegment;
  const toks = (words: string[]): TranscriptToken[] => words.map((text, i) => ({ text, startSec: i * 0.5, endSec: i * 0.5 + 0.4 }));

  it('German "3" matches spoken "drei" (all words matched, nothing left over)', () => {
    const segments = [seg('a', 'wir haben 3 Katzen zu Hause', 0, 0), seg('b', 'und dann ist es vorbei', 3, 1)];
    const words = ['wir', 'haben', 'drei', 'katzen', 'zu', 'hause', 'und', 'dann', 'ist', 'es', 'vorbei'];
    const [first] = alignScenestoTranscript(segments, toks(words), [], 6, 'de');
    expect(first!.matchedWords).toBe(first!.totalWords);
    expect(first!.unmatchedNumericTokens).toBeUndefined();
  });
});
