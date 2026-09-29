/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// ---------------------------------------------------------------------------
// AMOUNT normalization — the TS arm of the three-way lockstep.
//
// `scripts/fixtures/fa-amount-lockstep.json` is ONE corpus read by three
// independent suites (this one, `src-tauri/src/fa/text.rs`'s `amount_lockstep`,
// `cloud/test_fa_amount_lockstep.py`), each of which must reproduce it
// per-word and as joined chunk text. This suite additionally pins the headline
// cases with HAND-WRITTEN expectations that do not come from the generator, so
// the corpus cannot be regenerated into agreement with a wrong reading, and
// cross-checks the matcher's `canonicalize` against the forced-alignment
// normalizer: the script side, the transcript side and the aligner's input
// must read one amount as ONE word sequence.
// ---------------------------------------------------------------------------

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import { normalizeForForcedAlignment, parseAmountToken, type FaLanguageCode } from './faTextNormalize';
import { loadFaLanguageData } from './faLanguageData';
import { canonicalize } from './textNormalize';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

interface Entry {
  language: FaLanguageCode;
  input: string;
  note: string;
  words: Array<{ input: string; representable: boolean; mapped: string | null }>;
  text: string;
}
const corpus = JSON.parse(
  readFileSync(resolve(REPO, 'scripts', 'fixtures', 'fa-amount-lockstep.json'), 'utf-8'),
) as { entries: Entry[] };

function fa(lang: FaLanguageCode, input: string) {
  const d = loadFaLanguageData(lang)!;
  return normalizeForForcedAlignment(input, lang, d.vocabChars, d.cardinalData);
}

describe('fa-amount-lockstep.json — the committed corpus matches the live TS normalizer', () => {
  it('covers all five languages', () => {
    const seen = new Set(corpus.entries.map(e => e.language));
    for (const l of ['en', 'es', 'fr', 'de', 'pt']) expect(seen.has(l as FaLanguageCode)).toBe(true);
  });
  for (const e of corpus.entries) {
    it(`${e.language} ${JSON.stringify(e.input)} — ${e.note}`, () => {
      const r = fa(e.language, e.input);
      expect(r.text).toBe(e.text);
      expect(r.words.map(w => ({ input: w.input, representable: w.representable, mapped: w.mapped ?? null }))).toEqual(e.words);
    });
  }
});

describe('amounts read as their spoken words (hand-written, not generated)', () => {
  const cases: Array<[FaLanguageCode, string, string]> = [
    ['en', '$11,000.', 'eleven thousand dollars'],
    ['en', '$9,400', 'nine thousand four hundred dollars'],
    ['en', 'you have in your savings account $11,000.', 'you have in your savings account eleven thousand dollars'],
    ['en', '$1', 'one dollar'],
    ['en', '50%', 'fifty percent'],
    ['es', '$11.000', 'once mil dólares'],
    ['pt', '$11.000,50', 'onze mil vírgula cinco zero dólares'],
  ];
  for (const [lang, input, want] of cases) {
    it(`${lang} ${JSON.stringify(input)} -> ${JSON.stringify(want)}`, () => {
      expect(fa(lang, input).text).toBe(want);
    });
  }
});

describe('bare integers keep their existing reading', () => {
  it('2001, 2003 and 10 are unchanged (not amounts)', () => {
    expect(parseAmountToken('2001', 'en')).toBeUndefined();
    expect(fa('en', '2001').text).toBe('two thousand one');
    expect(fa('en', '10').text).toBe('ten');
    expect(fa('es', '12').text).toBe('doce');
  });
});

describe('the matcher and the aligner read one amount the same way', () => {
  // canonicalize splits English number-word hyphens; the FA reading keeps
  // them ("thirty-four"). Compare as word lists with hyphens read as spaces.
  const words = (s: string): string[] => s.replace(/-/g, ' ').split(/\s+/).filter(Boolean);
  // A bare non-English integer <= 9999 (es "12") keeps canonicalize's existing
  // English reading — the documented, unstarted per-language digit-word gap that
  // this change deliberately does not touch (it would move the Spanish golden).
  const isBareNonEnglishInt = (x: Entry): boolean => x.language !== 'en' && /^\d{1,4}$/.test(x.input);
  for (const e of corpus.entries.filter(x => x.text.length > 0 && !isBareNonEnglishInt(x))) {
    it(`${e.language} ${JSON.stringify(e.input)}: canonicalize == FA reading`, () => {
      const canon = canonicalize(e.input, e.language).join(' ');
      expect(words(canon)).toEqual(words(e.text));
    });
  }
});

describe('no 9999 digit-by-digit cap in the matcher', () => {
  it('11000 is "eleven thousand", not "one one zero zero zero"', () => {
    expect(canonicalize('11000')).toEqual(['eleven', 'thousand']);
    expect(canonicalize('$11,000.')).toEqual(['eleven', 'thousand', 'dollars']);
    expect(canonicalize('You have in your savings account $11,000.')).toEqual(
      ['you', 'have', 'in', 'your', 'savings', 'account', 'eleven', 'thousand', 'dollars'],
    );
  });
  it('a script that spells the amount out canonicalizes identically', () => {
    expect(canonicalize('eleven thousand dollars')).toEqual(canonicalize('$11,000'));
  });
  it('an ID-like run beyond the safe-integer range keeps the digit reading', () => {
    expect(canonicalize('99999999999999999999').length).toBe(20);
  });
});
