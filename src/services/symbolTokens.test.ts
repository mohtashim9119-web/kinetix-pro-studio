/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// Grammar coverage, Commit A — standalone `%`, `&`, `@` read as the language's
// spoken word, identically on the matcher side (`canonicalize`) and the forced-
// alignment side (`normalizeForForcedAlignment`), and a symbol the audio never
// claimed is loud (the 041e47d number-tripwire class).

import { describe, it, expect } from 'vitest';
import { canonicalize } from './textNormalize';
import { normalizeForForcedAlignment, type FaLanguageCode } from './faTextNormalize';
import { loadFaLanguageData } from './faLanguageData';
import { alignScenestoTranscript } from './whisperService';
import { validateNumericWords } from './syncContracts';
import type { TranscriptToken, VideoSegment } from '../types';

const LANGS: FaLanguageCode[] = ['en', 'es', 'fr', 'de', 'pt'];
const SPOKEN: Record<FaLanguageCode, Record<string, string>> = {
  en: { '%': 'percent', '&': 'and', '@': 'at' },
  es: { '%': 'por ciento', '&': 'y', '@': 'arroba' },
  fr: { '%': 'pour cent', '&': 'et', '@': 'arobase' },
  de: { '%': 'prozent', '&': 'und', '@': 'at' },
  pt: { '%': 'por cento', '&': 'e', '@': 'arroba' },
};

function fa(text: string, lang: FaLanguageCode): string {
  const d = loadFaLanguageData(lang)!;
  return normalizeForForcedAlignment(text, lang, d.vocabChars, d.cardinalData).text;
}

describe('standalone symbol tokens read as spoken words, per language', () => {
  for (const lang of LANGS) {
    for (const sym of ['%', '&', '@']) {
      it(`${lang} ${sym} -> "${SPOKEN[lang][sym]}" on BOTH sides`, () => {
        expect(fa(sym, lang)).toBe(SPOKEN[lang][sym]);
        expect(canonicalize(sym, lang).join(' ')).toBe(SPOKEN[lang][sym]);
        // Same word sequence — the property the aligner needs.
        expect(canonicalize(sym, lang)).toEqual(fa(sym, lang).split(' '));
      });
    }
  }

  it('a symbol in a longer token is not standalone for forced alignment (unchanged: dropped)', () => {
    expect(fa('AT&T', 'en')).toBe('');
    expect(fa('@user', 'en')).toBe('');
  });

  it('English matcher output for the symbols is byte-identical to before', () => {
    expect(canonicalize('rock & roll @ 50%', 'en')).toEqual(['rock', 'and', 'roll', 'at', 'fifty', 'percent']);
    expect(canonicalize('rock & roll @ home')).toEqual(['rock', 'and', 'roll', 'at', 'home']);
  });
});

describe('an unmatched symbol is loud', () => {
  const seg = (id: string, text: string, startTime: number, order: number): VideoSegment =>
    ({ id, text, startTime, duration: 3, transition: 'none', animation: 'none', order }) as unknown as VideoSegment;
  const tok = (text: string, i: number): TranscriptToken => ({ text, startSec: i * 0.5, endSec: i * 0.5 + 0.4 });

  it('names "&" when the audio never said "and"', () => {
    const segments = [seg('a', 'we make rock & roll music today', 0, 0), seg('b', 'and then it ends', 3, 1)];
    // transcript: the speaker skipped the word for "&"
    const words = ['we', 'make', 'rock', 'roll', 'music', 'today', 'and', 'then', 'it', 'ends'];
    const alignments = alignScenestoTranscript(segments, words.map(tok), [], 6, 'en');
    const v = validateNumericWords(segments, alignments);
    expect(v.some(x => (x.detail as { tokens: string[] }).tokens.includes('&'))).toBe(true);
  });

  it('raises nothing when the symbol was spoken', () => {
    const segments = [seg('a', 'we make rock & roll music today', 0, 0), seg('b', 'and then it ends', 3, 1)];
    const words = ['we', 'make', 'rock', 'and', 'roll', 'music', 'today', 'and', 'then', 'it', 'ends'];
    const alignments = alignScenestoTranscript(segments, words.map(tok), [], 6, 'en');
    expect(validateNumericWords(segments, alignments)).toEqual([]);
  });
});
