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
//      ASCII-folds to its base letters ("mas") under the default fold but
//      keeps its native spelling under 'es'. An ASYMMETRIC script/transcript
//      pair (script "más", transcript "mas" — a plausible ASR spelling)
//      turns that spelling difference into an observable match/no-match
//      split: under the default fold both sides fold to "mas" and match;
//      under 'es' the script keeps "más" while the transcript stays "mas"
//      and they diverge. That split is only reproducible if canonicalize()
//      ran with the SAME languageCode on BOTH the scene-doc side
//      (normalizeSceneDoc) and the token side (normalize) — this is a
//      behavioral proof, not an implementation-detail spy.
//
// NOTE (WS2 T3.1 Step 2, `.work-phase4/session-ws2-30/phase3-t31-step2-report.md`):
// this file originally used a symmetric "más"/"más" pair and asserted a
// `totalWords` divergence (2 fragments under the default fold vs 1 word
// under 'es'). Step 2 changed the DEFAULT branch itself to NFD-fold
// diacritics to their base letter instead of shattering them, so "más" now
// tokenizes to a single `["mas"]` under the default fold too — the old
// fixture's `totalWords` divergence is gone (a real, intended improvement,
// not a regression) and the tests below were updated to the asymmetric
// design above, which still isolates the same threading question.
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
  it('"más" ASCII-folds to its base letters under undefined/\'en\', keeps its native spelling under \'es\'', () => {
    expect(normalize('más', undefined)).toEqual(['mas']);
    expect(normalize('más', 'en')).toEqual(['mas']);
    expect(normalize('más', 'es')).toEqual(['más']);
  });
});

describe('extractSegmentAlignments — languageCode reaches canonicalize() on BOTH the scene-doc and token sides', () => {
  it('WS2 T3.1 Step 2 regression lock: a symmetric diacritic word no longer shatters under the default fold — undefined and \'es\' both produce a full 1-word match', () => {
    const segments = [seg('s1', 'más', 0, 1)];
    const tokens = [tok('más', 0.0, 1.0)];

    const withoutLang = extractSegmentAlignments(segments, tokens, undefined, undefined);
    const withEs = extractSegmentAlignments(segments, tokens, undefined, 'es');

    expect(withoutLang[0]!.totalWords).toBe(1);
    expect(withoutLang[0]!.matchedWords).toBe(1);
    expect(withEs[0]!.totalWords).toBe(1);
    expect(withEs[0]!.matchedWords).toBe(1);
  });

  it('an asymmetric script/transcript pair proves languageCode reaches BOTH sides: default folds both to "mas" (matches); \'es\' preserves the script\'s accent and the two diverge (no match)', () => {
    // Script spelled with the accent; transcript spelled without it (a
    // plausible ASR outcome). Only reproducible if canonicalize() ran with
    // the SAME languageCode on both normalizeSceneDoc (scene/query side) and
    // normalize (token/subject side) — a threading bug reaching only one
    // side would not produce this exact default-matches/es-mismatches split.
    const segments = [seg('s1', 'más', 0, 1)];
    const tokens = [tok('mas', 0.0, 1.0)];

    const withoutLang = extractSegmentAlignments(segments, tokens, undefined, undefined);
    const withEs = extractSegmentAlignments(segments, tokens, undefined, 'es');

    expect(withoutLang[0]!.totalWords).toBe(1);
    expect(withoutLang[0]!.matchedWords).toBe(1); // "mas" === "mas"

    expect(withEs[0]!.totalWords).toBe(1);
    expect(withEs[0]!.matchedWords).toBe(0); // "más" !== "mas"
  });
});

describe('alignScenestoTranscript — languageCode threads through to extractSegmentAlignments', () => {
  it('reproduces the same default-matches/es-mismatches split as extractSegmentAlignments for the asymmetric más/mas pair', () => {
    const segments = [seg('s1', 'más', 0, 1)];
    const tokens = [tok('mas', 0.0, 1.0)];

    const withoutLang = alignScenestoTranscript(segments, tokens, [], 1.0, undefined);
    const withEs = alignScenestoTranscript(segments, tokens, [], 1.0, 'es');

    expect(withoutLang[0]!.totalWords).toBe(1);
    expect(withoutLang[0]!.matchedWords).toBe(1);
    expect(withEs[0]!.totalWords).toBe(1);
    expect(withEs[0]!.matchedWords).toBe(0);
  });
});

describe('filterMalformedTokens — languageCode reaches the empty-text check', () => {
  // WS2 T3.1 Step 2: a Latin diacritic like "é" no longer normalizes to empty
  // under the default fold (NFD-folds to "e" now, see textNormalize.ts's
  // Step 10) — that fold only reaches characters NFD can decompose into a
  // base letter + combining mark. A non-Latin Unicode letter with no such
  // decomposition (e.g. Greek "π") still normalizes to empty under the
  // ASCII-only default filter, while 'es' still preserves it via `\p{L}`.
  it('a non-Latin Unicode-letter-only token normalizes to empty (dropped) under undefined, survives under \'es\'', () => {
    const tokens = [tok('π', 0.0, 0.5)];

    const withoutLang = filterMalformedTokens(tokens, 1.0, undefined);
    expect(withoutLang.tokens).toHaveLength(0);
    expect(withoutLang.skippedCount).toBe(1);
    expect(withoutLang.drops[0]!.reason).toBe('empty-text');

    const withEs = filterMalformedTokens(tokens, 1.0, 'es');
    expect(withEs.tokens).toHaveLength(1);
    expect(withEs.skippedCount).toBe(0);
  });

  it('the same token is also dropped under an explicit \'en\' (byte-identical to undefined)', () => {
    const tokens = [tok('π', 0.0, 0.5)];
    const withEn = filterMalformedTokens(tokens, 1.0, 'en');
    expect(withEn.tokens).toHaveLength(0);
    expect(withEn.skippedCount).toBe(1);
  });

  it('WS2 T3.1 Step 2 regression lock: a Latin-diacritic-only token now SURVIVES under undefined/\'en\' (NFD-folds to a real letter instead of normalizing to empty)', () => {
    const tokens = [tok('é', 0.0, 0.5)];
    const withoutLang = filterMalformedTokens(tokens, 1.0, undefined);
    expect(withoutLang.tokens).toHaveLength(1);
    expect(withoutLang.skippedCount).toBe(0);
  });
});
