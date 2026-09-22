/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// ---------------------------------------------------------------------------
// G4 Unit 2 — the runtime loader for `scripts/fixtures/fa-vocab-<lang>.json`/
// `fa-cardinal-<lang>.json`. Proves the loader actually loads the shipped
// data per language (not a stub), that the shape matches what
// `normalizeForForcedAlignment` requires, and NR-6's no-silent-fallback rule
// for an unshipped language.
// ---------------------------------------------------------------------------

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import { loadFaLanguageData, shippedFaLanguages } from './faLanguageData';
import { normalizeForForcedAlignment, vocabCharsFromRawVocab, type FaLanguageCode } from './faTextNormalize';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const LANGUAGES: readonly FaLanguageCode[] = ['en', 'es', 'fr', 'de', 'pt'];

describe('loadFaLanguageData — loads the real shipped data, for all 5 languages', () => {
  it('shippedFaLanguages() lists exactly the 5 FA-supported languages', () => {
    expect([...shippedFaLanguages()].sort()).toEqual([...LANGUAGES].sort());
  });

  it.each(LANGUAGES)('%s: returns real vocabChars/cardinalData, not a stub', (lang) => {
    const data = loadFaLanguageData(lang);
    expect(data, `${lang} must be loadable — all 5 languages are shipped`).toBeDefined();
    expect(data!.vocabChars.size).toBeGreaterThan(10);
    expect(data!.cardinalData.cardinals0to99).toBeDefined();
    expect(data!.cardinalData.scale.length).toBeGreaterThan(0);
  });

  it.each(LANGUAGES)('%s: vocabChars matches the real committed fixture file byte-for-byte (not a copy that could drift)', (lang) => {
    const raw = JSON.parse(readFileSync(resolve(REPO, 'scripts', 'fixtures', `fa-vocab-${lang}.json`), 'utf-8')) as {
      vocab: Record<string, number>;
    };
    const expectedChars = vocabCharsFromRawVocab(raw.vocab);
    const data = loadFaLanguageData(lang)!;
    expect(data.vocabChars).toEqual(expectedChars);
  });

  it.each(LANGUAGES)('%s: cardinalData matches the real committed fixture file byte-for-byte', (lang) => {
    const raw = JSON.parse(readFileSync(resolve(REPO, 'scripts', 'fixtures', `fa-cardinal-${lang}.json`), 'utf-8')) as Record<string, unknown>;
    const data = loadFaLanguageData(lang)!;
    expect(data.cardinalData.cardinals0to99).toEqual(raw.cardinals0to99);
    expect(data.cardinalData.hundred).toEqual(raw.hundred);
    expect(data.cardinalData.scale).toEqual(raw.scale);
    expect(data.cardinalData.yearReading).toEqual(raw.yearReading);
  });

  it('repeated calls for the same language return a cached, referentially stable result', () => {
    const a = loadFaLanguageData('en');
    const b = loadFaLanguageData('en');
    expect(a).toBe(b);
  });

  it('NR-6, no silent fallback: an unsupported language string is not something this function can even be called with (type-level), and returns undefined rather than an English default if cast past the type', () => {
    // Simulates a future FaLanguageCode member added without a shipped pack —
    // the exact gap this function's own doc comment names.
    const data = loadFaLanguageData('xx' as FaLanguageCode);
    expect(data).toBeUndefined();
  });

  it.each(LANGUAGES)('%s: the loaded data actually normalizes text — round-trips through normalizeForForcedAlignment without throwing', (lang) => {
    const data = loadFaLanguageData(lang)!;
    const result = normalizeForForcedAlignment('hello world 123', lang, data.vocabChars, data.cardinalData);
    expect(result.words.length).toBe(3);
  });
});
