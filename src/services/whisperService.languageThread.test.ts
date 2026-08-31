/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// ---------------------------------------------------------------------------
// WS2 T3.1, Commit 1 test coverage (Phase 3, Step 1) — the commit itself
// shipped with zero new tests (`.work-phase4/session-ws2-30/phase3-t31-step1-report.md`).
// This file proves the threaded `languageCode` actually reaches
// `canonicalize()` — not just that TypeScript accepts the extra parameter —
// for `toAlignmentLanguageCode`, `extractSegmentAlignments`,
// `alignScenestoTranscript`, and `filterMalformedTokens`.
//
// Two proof strategies, deliberately not mocking `textNormalize.ts`:
//   1. undefined ≡ 'en' — canonicalize's own non-English branch never fires
//      for 'en' (`NON_ENGLISH_CANONICALIZE_LANGUAGES` is es/fr/de/pt only),
//      so this is a straightforward equality check across representative
//      inputs (diacritics, digits, contractions, currency).
//   2. undefined vs 'es' really diverges — a diacritic-bearing word ("más")
//      shatters into two ASCII fragments under the default fold but survives
//      as one token under 'es'. Threading languageCode through BOTH the
//      scene-doc side (normalizeSceneDoc) and the token side (normalize)
//      changes `totalWords` while `matchedWords === totalWords` holds either
//      way (full match) — if only one side were threaded, the token counts
//      would desync and the match would NOT be full. This is a behavioral
//      proof, not an implementation-detail spy.
// ---------------------------------------------------------------------------

import { describe, it, expect } from 'vitest';
import {
  toAlignmentLanguageCode,
  normalize,
  normalizeSceneDoc,
  extractSegmentAlignments,
  alignScenestoTranscript,
  filterMalformedTokens,
} from './whisperService';
import type { VideoSegment, TranscriptToken } from '../types';

const seg = (id: string, text: string, startTime: number, duration: number): VideoSegment =>
  ({ id, text, startTime, duration, transition: 'none', animation: 'none' }) as unknown as VideoSegment;

const tok = (text: string, startSec: number, endSec: number): TranscriptToken => ({ text, startSec, endSec });

describe('toAlignmentLanguageCode', () => {
  it('unset (undefined) narrows to undefined', () => {
    expect(toAlignmentLanguageCode(undefined)).toBeUndefined();
  });

  it("'en' narrows to 'en'", () => {
    expect(toAlignmentLanguageCode('en')).toBe('en');
  });

  it("'es' narrows to 'es'", () => {
    expect(toAlignmentLanguageCode('es')).toBe('es');
  });

  it('an unsupported whisper-cli code (outside the five verified languages) narrows to undefined', () => {
    // 'ja' (Japanese) is a real whisper-cli language code, not in
    // constants.ts's SUPPORTED_LANGUAGE_CODES (en/es/fr/de/pt).
    expect(toAlignmentLanguageCode('ja')).toBeUndefined();
  });
});

describe('normalize / normalizeSceneDoc: undefined ≡ \'en\' (canonicalize\'s own default)', () => {
  const samples = [
    'Llívia',
    'Peñón de Vélez de la Gomera',
    'The complexity originates in 1198',
    '300 American residents.',
    "don't stop believing",
    '$5 and 3.5% and 11,000 & @home',
    'café',
  ];

  it.each(samples)('normalize(%j) is byte-identical for undefined and \'en\'', (text) => {
    expect(normalize(text, 'en')).toEqual(normalize(text, undefined));
  });

  it.each(samples)('normalizeSceneDoc(%j) is byte-identical for undefined and \'en\'', (text) => {
    expect(normalizeSceneDoc(text, 'en')).toEqual(normalizeSceneDoc(text, undefined));
  });
});

describe('normalize: undefined/\'en\' vs \'es\' genuinely diverge on a diacritic word', () => {
  it('"más" shatters into two ASCII fragments under undefined, survives as one token under \'es\'', () => {
    expect(normalize('más', undefined)).toEqual(['m', 's']);
    expect(normalize('más', 'en')).toEqual(['m', 's']);
    expect(normalize('más', 'es')).toEqual(['más']);
  });
});

describe('extractSegmentAlignments — languageCode reaches canonicalize() on BOTH the scene-doc and token sides', () => {
  it('a symmetric diacritic word changes totalWords under \'es\' while staying a full match either way', () => {
    const segments = [seg('s1', 'más', 0, 1)];
    const tokens = [tok('más', 0.0, 1.0)];

    const withoutLang = extractSegmentAlignments(segments, tokens, undefined, undefined);
    const withEn = extractSegmentAlignments(segments, tokens, undefined, 'en');
    const withEs = extractSegmentAlignments(segments, tokens, undefined, 'es');

    // Default fold: "más" -> ["m","s"] on both scene-doc and token sides ->
    // 2 query words, 2 subject words, both matched.
    expect(withoutLang[0]!.totalWords).toBe(2);
    expect(withoutLang[0]!.matchedWords).toBe(2);

    expect(withEn[0]!.totalWords).toBe(2);
    expect(withEn[0]!.matchedWords).toBe(2);

    // es fold: "más" -> ["más"] on both sides -> 1 query word, 1 subject word,
    // matched. totalWords dropping from 2 to 1 (not just confidence moving)
    // is only possible if BOTH normalizeSceneDoc (query/scene side) AND
    // normalize (subject/token side) received 'es' — if only one side had,
    // the two sequences would desync (["m","s"] vs ["más"]) and matchedWords
    // would fall to 0, not stay equal to totalWords.
    expect(withEs[0]!.totalWords).toBe(1);
    expect(withEs[0]!.matchedWords).toBe(1);
  });
});

describe('alignScenestoTranscript — languageCode threads through to extractSegmentAlignments', () => {
  it('reproduces the same totalWords divergence as extractSegmentAlignments for undefined vs \'es\'', () => {
    const segments = [seg('s1', 'más', 0, 1)];
    const tokens = [tok('más', 0.0, 1.0)];

    const withoutLang = alignScenestoTranscript(segments, tokens, [], 1.0, undefined);
    const withEs = alignScenestoTranscript(segments, tokens, [], 1.0, 'es');

    expect(withoutLang[0]!.totalWords).toBe(2);
    expect(withoutLang[0]!.matchedWords).toBe(2);
    expect(withEs[0]!.totalWords).toBe(1);
    expect(withEs[0]!.matchedWords).toBe(1);
  });
});

describe('filterMalformedTokens — languageCode reaches the empty-text check', () => {
  it('a diacritic-only token normalizes to empty (dropped) under undefined, survives under \'es\'', () => {
    const tokens = [tok('é', 0.0, 0.5)];

    const withoutLang = filterMalformedTokens(tokens, 1.0, undefined);
    expect(withoutLang.tokens).toHaveLength(0);
    expect(withoutLang.skippedCount).toBe(1);
    expect(withoutLang.drops[0]!.reason).toBe('empty-text');

    const withEs = filterMalformedTokens(tokens, 1.0, 'es');
    expect(withEs.tokens).toHaveLength(1);
    expect(withEs.skippedCount).toBe(0);
  });

  it('the same token is also dropped under an explicit \'en\' (byte-identical to undefined)', () => {
    const tokens = [tok('é', 0.0, 0.5)];
    const withEn = filterMalformedTokens(tokens, 1.0, 'en');
    expect(withEn.tokens).toHaveLength(0);
    expect(withEn.skippedCount).toBe(1);
  });
});
