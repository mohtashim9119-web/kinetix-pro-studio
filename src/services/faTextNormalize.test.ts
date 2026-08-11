/**
 * faTextNormalize.ts — vocab-aware FA text normalizer.
 *
 * Loads each language's committed vocab fixture (`scripts/fixtures/
 * fa-vocab-<lang>.json`) directly rather than hand-copying vocab subsets into
 * this file, so a future fixture regeneration (a real jonatasgrosman vocab
 * change) can't silently drift from what these tests actually check against.
 *
 * `canonicalize` (from `../services/textNormalize`, i.e. `./textNormalize`
 * here) is imported ONLY for the explicit old-vs-new diacritic-loss
 * comparison the spec calls for — `faTextNormalize.ts` itself never imports
 * it, and this file does not modify it.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import {
  normalizeForForcedAlignment,
  vocabCharsFromRawVocab,
  type FaLanguageCode,
} from './faTextNormalize';
import { canonicalize } from './textNormalize';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

function loadVocabChars(lang: FaLanguageCode): Set<string> {
  const raw = JSON.parse(
    readFileSync(resolve(REPO, 'scripts', 'fixtures', `fa-vocab-${lang}.json`), 'utf-8'),
  ) as { _provenance: { modelId: string }; vocab: Record<string, number> };
  return vocabCharsFromRawVocab(raw.vocab);
}

const LANGUAGES: FaLanguageCode[] = ['en', 'es', 'fr', 'de', 'pt'];
const VOCABS: Record<FaLanguageCode, Set<string>> = Object.fromEntries(
  LANGUAGES.map(lang => [lang, loadVocabChars(lang)]),
) as Record<FaLanguageCode, Set<string>>;

describe('faTextNormalize — diacritic preservation vs. canonicalize', () => {
  const cases: Array<{ lang: FaLanguageCode; word: string }> = [
    { lang: 'es', word: 'año' },
    { lang: 'fr', word: 'élève' },
    { lang: 'de', word: 'über' },
    { lang: 'pt', word: 'ação' },
  ];

  for (const { lang, word } of cases) {
    it(`${lang}: "${word}" survives intact through the FA normalizer`, () => {
      const result = normalizeForForcedAlignment(word, lang, VOCABS[lang]);
      expect(result.words).toHaveLength(1);
      expect(result.words[0]!.representable).toBe(true);
      expect(result.words[0]!.mapped).toBe(word);
      expect(result.text).toBe(word);
    });

    it(`${lang}: "${word}" loses its diacritic under the OLD ASCII canonicalize()`, () => {
      // canonicalize() strips any non-ASCII letter to a space (step 10:
      // `[^a-z0-9\s-]` -> ' '), splitting the word and destroying the
      // diacritic entirely. This is the regression faTextNormalize.ts exists
      // to avoid for the FA path — asserted explicitly here, not just implied.
      const oldTokens = canonicalize(word);
      expect(oldTokens.join(' ')).not.toBe(word);
      expect(oldTokens.some(t => t === word)).toBe(false);
    });
  }
});

describe('faTextNormalize — German ß -> ss', () => {
  it('maps ß to ss before the vocab check, since the German vocab has no ß', () => {
    const result = normalizeForForcedAlignment('straße', 'de', VOCABS.de);
    expect(result.words[0]!.representable).toBe(true);
    expect(result.words[0]!.mapped).toBe('strasse');
    expect(result.text).toBe('strasse');
  });

  it('uppercase ẞ also maps to ss (lowercased first)', () => {
    const result = normalizeForForcedAlignment('STRASSE', 'de', VOCABS.de); // sanity: plain ASCII still works
    expect(result.words[0]!.mapped).toBe('strasse');
    const eszettResult = normalizeForForcedAlignment('GROẞ', 'de', VOCABS.de);
    expect(eszettResult.words[0]!.representable).toBe(true);
    expect(eszettResult.words[0]!.mapped).toBe('gross');
  });
});

describe('faTextNormalize — digits are unrepresentable, dropped and recorded', () => {
  it('a bare digit is unrepresentable with a recorded reason', () => {
    const result = normalizeForForcedAlignment('12', 'en', VOCABS.en);
    expect(result.words).toHaveLength(1);
    expect(result.words[0]!.representable).toBe(false);
    expect(result.words[0]!.mapped).toBeUndefined();
    expect(result.words[0]!.reason).toMatch(/digit/i);
    expect(result.text).toBe('');
  });

  it('a digit-bearing word (not purely numeric) is also unrepresentable, and is dropped from a phrase without mangling the rest', () => {
    const result = normalizeForForcedAlignment('room101 available', 'en', VOCABS.en);
    expect(result.words).toHaveLength(2);
    expect(result.words[0]!.input).toBe('room101');
    expect(result.words[0]!.representable).toBe(false);
    expect(result.words[0]!.reason).toMatch(/digit/i);
    expect(result.words[1]!.representable).toBe(true);
    expect(result.words[1]!.mapped).toBe('available');
    // dropped word never partially mangled into the output text
    expect(result.text).toBe('available');
  });
});

describe('faTextNormalize — every emitted character is a real vocab member', () => {
  const cases: Array<{ lang: FaLanguageCode; phrase: string }> = [
    { lang: 'en', phrase: "it's a good day" },
    { lang: 'es', phrase: 'el año pasado fue increíble' },
    { lang: 'fr', phrase: "l'élève où était-il" },
    { lang: 'de', phrase: 'die straße ist groß' },
    { lang: 'pt', phrase: 'a ação não é fácil' },
  ];

  for (const { lang, phrase } of cases) {
    it(`${lang}: "${phrase}" — every character of the mapped text is in the ${lang} vocab fixture`, () => {
      const result = normalizeForForcedAlignment(phrase, lang, VOCABS[lang]);
      for (const word of result.words) {
        if (!word.representable) continue;
        for (const ch of word.mapped!) {
          expect(VOCABS[lang].has(ch), `"${ch}" in "${word.mapped}" (${lang})`).toBe(true);
        }
      }
      for (const ch of result.text) {
        if (ch === ' ') continue;
        expect(VOCABS[lang].has(ch), `"${ch}" in text "${result.text}" (${lang})`).toBe(true);
      }
    });
  }
});

describe('faTextNormalize — French accepts non-French Latin letters its vocab includes', () => {
  it('ć č š ș are all vocab members and pass through unrepresentable-free', () => {
    const word = 'ćčšș';
    const result = normalizeForForcedAlignment(word, 'fr', VOCABS.fr);
    expect(result.words[0]!.representable).toBe(true);
    expect(result.words[0]!.mapped).toBe(word);
    for (const ch of word) {
      expect(VOCABS.fr.has(ch)).toBe(true);
    }
  });
});

describe('faTextNormalize — empty and whitespace-only input', () => {
  it('empty string produces no words and empty text', () => {
    const result = normalizeForForcedAlignment('', 'en', VOCABS.en);
    expect(result.words).toEqual([]);
    expect(result.text).toBe('');
  });

  it('whitespace-only string produces no words and empty text', () => {
    const result = normalizeForForcedAlignment('   \t\n  ', 'en', VOCABS.en);
    expect(result.words).toEqual([]);
    expect(result.text).toBe('');
  });

  it('collapses interior whitespace runs between words', () => {
    const result = normalizeForForcedAlignment('hello    world', 'en', VOCABS.en);
    expect(result.text).toBe('hello world');
  });
});

describe('faTextNormalize — FOLD: typographic variant to ASCII, preserving the word', () => {
  it('en: "don’t" (curly U+2019 apostrophe) becomes representable and keeps its apostrophe', () => {
    const result = normalizeForForcedAlignment('don’t', 'en', VOCABS.en);
    expect(result.words[0]!.representable).toBe(true);
    expect(result.words[0]!.mapped).toBe("don't");
    expect(result.text).toBe("don't");
  });

  it('en: an em dash inside a word folds to the vocab hyphen', () => {
    const result = normalizeForForcedAlignment('well—actually', 'en', VOCABS.en);
    expect(result.words[0]!.representable).toBe(true);
    expect(result.words[0]!.mapped).toBe('well-actually');
  });

  it('en: a curly double quote is dropped (fold target " absent from the en vocab)', () => {
    const result = normalizeForForcedAlignment('“hello”', 'en', VOCABS.en);
    expect(result.words[0]!.representable).toBe(true);
    expect(result.words[0]!.mapped).toBe('hello');
  });
});

describe('faTextNormalize — STRIP: word-boundary punctuation, never word-internal', () => {
  it('en: "hello." loses only the trailing period', () => {
    const result = normalizeForForcedAlignment('hello.', 'en', VOCABS.en);
    expect(result.words[0]!.representable).toBe(true);
    expect(result.words[0]!.mapped).toBe('hello');
  });

  it('en: "word," loses only the trailing comma', () => {
    const result = normalizeForForcedAlignment('word,', 'en', VOCABS.en);
    expect(result.words[0]!.representable).toBe(true);
    expect(result.words[0]!.mapped).toBe('word');
  });

  it('es: guillemets «cerca» are stripped from both edges', () => {
    const result = normalizeForForcedAlignment('«cerca»', 'es', VOCABS.es);
    expect(result.words[0]!.representable).toBe(true);
    expect(result.words[0]!.mapped).toBe('cerca');
  });

  it('en: stacked boundary marks fully clear from both edges', () => {
    const result = normalizeForForcedAlignment('"word,"', 'en', VOCABS.en);
    expect(result.words[0]!.representable).toBe(true);
    expect(result.words[0]!.mapped).toBe('word');
  });
});

describe('faTextNormalize — fold and strip together on a single token', () => {
  it('en: a curly-quoted, period-terminated contraction is fully recovered', () => {
    const result = normalizeForForcedAlignment('“don’t.”', 'en', VOCABS.en);
    expect(result.words[0]!.representable).toBe(true);
    expect(result.words[0]!.mapped).toBe("don't");
  });
});

describe('faTextNormalize — zero-width characters removed mid-word', () => {
  it('en: a zero-width space embedded inside a word is removed, not treated as unrepresentable', () => {
    const result = normalizeForForcedAlignment('hel​lo', 'en', VOCABS.en);
    expect(result.words[0]!.representable).toBe(true);
    expect(result.words[0]!.mapped).toBe('hello');
  });
});

describe('faTextNormalize — word-internal apostrophe and hyphen survive, per language', () => {
  const cases: Array<{ lang: FaLanguageCode; word: string }> = [
    { lang: 'en', word: "don't" },
    { lang: 'en', word: 'well-known' },
    { lang: 'fr', word: "l'élève" },
    { lang: 'de', word: 'arbeits-platz' },
    { lang: 'pt', word: "d'água" },
  ];

  for (const { lang, word } of cases) {
    it(`${lang}: "${word}" survives fold+strip unchanged`, () => {
      const result = normalizeForForcedAlignment(word, lang, VOCABS[lang]);
      expect(result.words[0]!.representable).toBe(true);
      expect(result.words[0]!.mapped).toBe(word);
    });
  }
});

describe('faTextNormalize — the unrepresentable contract did not become permissive', () => {
  it('en: a genuinely out-of-vocab letter is still unrepresentable after fold+strip', () => {
    // Cyrillic "п" is in neither FOLD_TARGETS nor BOUNDARY_STRIP_CHARS nor the
    // en vocab — it must survive fold/strip untouched and still fail the
    // per-character vocab check, exactly as before this fix.
    const result = normalizeForForcedAlignment('привет.', 'en', VOCABS.en);
    expect(result.words[0]!.representable).toBe(false);
    expect(result.words[0]!.reason).toMatch(/character ".+" is not in the en vocab/);
    expect(result.text).toBe('');
  });

  it('en: stripping a fully-punctuation token to nothing marks it unrepresentable, not an empty representable word', () => {
    const result = normalizeForForcedAlignment('...', 'en', VOCABS.en);
    expect(result.words[0]!.representable).toBe(false);
    expect(result.words[0]!.mapped).toBeUndefined();
    expect(result.text).toBe('');
  });
});

describe('faTextNormalize — a fold target absent from a vocab causes a strip there, not a fold', () => {
  it('none of the five vocabs contain an ASCII double quote, so curly double quotes always drop rather than fold', () => {
    for (const lang of LANGUAGES) {
      expect(VOCABS[lang].has('"'), `${lang} vocab should not contain "\\"" per this test's premise`).toBe(false);
      const result = normalizeForForcedAlignment('“x”', lang, VOCABS[lang]);
      expect(result.words[0]!.representable).toBe(true);
      expect(result.words[0]!.mapped).toBe('x');
      expect(result.words[0]!.mapped).not.toContain('"');
    }
  });
});

describe('vocabCharsFromRawVocab', () => {
  it('excludes CTC special/delimiter tokens from every language vocab', () => {
    for (const lang of LANGUAGES) {
      const chars = VOCABS[lang];
      for (const special of ['<pad>', '<s>', '</s>', '<unk>', '|']) {
        expect(chars.has(special), `${lang} vocab should not expose "${special}" as a character`).toBe(false);
      }
    }
  });

  it('reports the expected symbol counts (33/41/59/38/46 for en/es/fr/de/pt)', () => {
    expect(VOCABS.en.size).toBe(28); // 33 raw vocab entries - 5 special/delimiter tokens
    expect(VOCABS.es.size).toBe(36);
    expect(VOCABS.fr.size).toBe(54);
    expect(VOCABS.de.size).toBe(33);
    expect(VOCABS.pt.size).toBe(41);
  });
});
