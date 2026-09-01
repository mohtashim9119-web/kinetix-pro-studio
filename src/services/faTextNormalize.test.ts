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
  type FaCardinalData,
} from './faTextNormalize';
import { canonicalize } from './textNormalize';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

function loadVocabChars(lang: FaLanguageCode): Set<string> {
  const raw = JSON.parse(
    readFileSync(resolve(REPO, 'scripts', 'fixtures', `fa-vocab-${lang}.json`), 'utf-8'),
  ) as { _provenance: { modelId: string }; vocab: Record<string, number> };
  return vocabCharsFromRawVocab(raw.vocab);
}

function loadCardinalData(lang: FaLanguageCode): FaCardinalData {
  return JSON.parse(
    readFileSync(resolve(REPO, 'scripts', 'fixtures', `fa-cardinal-${lang}.json`), 'utf-8'),
  ) as FaCardinalData;
}

const LANGUAGES: FaLanguageCode[] = ['en', 'es', 'fr', 'de', 'pt'];
const VOCABS: Record<FaLanguageCode, Set<string>> = Object.fromEntries(
  LANGUAGES.map(lang => [lang, loadVocabChars(lang)]),
) as Record<FaLanguageCode, Set<string>>;
const CARDINAL_DATA: Record<FaLanguageCode, FaCardinalData> = Object.fromEntries(
  LANGUAGES.map(lang => [lang, loadCardinalData(lang)]),
) as Record<FaLanguageCode, FaCardinalData>;

describe('faTextNormalize — diacritic preservation vs. canonicalize', () => {
  const cases: Array<{ lang: FaLanguageCode; word: string }> = [
    { lang: 'es', word: 'año' },
    { lang: 'fr', word: 'élève' },
    { lang: 'de', word: 'über' },
    { lang: 'pt', word: 'ação' },
  ];

  for (const { lang, word } of cases) {
    it(`${lang}: "${word}" survives intact through the FA normalizer`, () => {
      const result = normalizeForForcedAlignment(word, lang, VOCABS[lang], CARDINAL_DATA[lang]);
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
    const result = normalizeForForcedAlignment('straße', 'de', VOCABS.de, CARDINAL_DATA.de);
    expect(result.words[0]!.representable).toBe(true);
    expect(result.words[0]!.mapped).toBe('strasse');
    expect(result.text).toBe('strasse');
  });

  it('uppercase ẞ also maps to ss (lowercased first)', () => {
    const result = normalizeForForcedAlignment('STRASSE', 'de', VOCABS.de, CARDINAL_DATA.de); // sanity: plain ASCII still works
    expect(result.words[0]!.mapped).toBe('strasse');
    const eszettResult = normalizeForForcedAlignment('GROẞ', 'de', VOCABS.de, CARDINAL_DATA.de);
    expect(eszettResult.words[0]!.representable).toBe(true);
    expect(eszettResult.words[0]!.mapped).toBe('gross');
  });
});

describe('faTextNormalize — digit-bearing words that are NOT a bare cardinal are unrepresentable, dropped and recorded', () => {
  // A bare pure-digit token now expands via the WS2 T3.2 Step 3b-iii
  // compositional generator (all five languages, including English — see
  // the "compositional cardinal-number generation" describe blocks below)
  // — it is no longer unconditionally dropped the way it was before this
  // step. What DOES stay dropped, unaffected by this change, is anything
  // that isn't a pure digit string: a mixed alnum word, a decimal, a
  // thousands-separated number, a leading-zero form, etc. — all still out
  // of `expandCardinalToken`'s scope (its own leading `/^[0-9]+$/` guard).

  it('a digit-bearing word (not purely numeric) is unrepresentable, and is dropped from a phrase without mangling the rest', () => {
    const result = normalizeForForcedAlignment('room101 available', 'en', VOCABS.en, CARDINAL_DATA.en);
    expect(result.words).toHaveLength(2);
    expect(result.words[0]!.input).toBe('room101');
    expect(result.words[0]!.representable).toBe(false);
    expect(result.words[0]!.reason).toMatch(/digit/i);
    expect(result.words[1]!.representable).toBe(true);
    expect(result.words[1]!.mapped).toBe('available');
    // dropped word never partially mangled into the output text
    expect(result.text).toBe('available');
  });

  it('a bare digit DOES now expand under English (regression guard: this used to be the "dropped" example)', () => {
    const result = normalizeForForcedAlignment('12', 'en', VOCABS.en, CARDINAL_DATA.en);
    expect(result.words).toHaveLength(1);
    expect(result.words[0]!.representable).toBe(true);
    expect(result.words[0]!.mapped).toBe('twelve');
    expect(result.text).toBe('twelve');
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
      const result = normalizeForForcedAlignment(phrase, lang, VOCABS[lang], CARDINAL_DATA[lang]);
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
    const result = normalizeForForcedAlignment(word, 'fr', VOCABS.fr, CARDINAL_DATA.fr);
    expect(result.words[0]!.representable).toBe(true);
    expect(result.words[0]!.mapped).toBe(word);
    for (const ch of word) {
      expect(VOCABS.fr.has(ch)).toBe(true);
    }
  });
});

describe('faTextNormalize — empty and whitespace-only input', () => {
  it('empty string produces no words and empty text', () => {
    const result = normalizeForForcedAlignment('', 'en', VOCABS.en, CARDINAL_DATA.en);
    expect(result.words).toEqual([]);
    expect(result.text).toBe('');
  });

  it('whitespace-only string produces no words and empty text', () => {
    const result = normalizeForForcedAlignment('   \t\n  ', 'en', VOCABS.en, CARDINAL_DATA.en);
    expect(result.words).toEqual([]);
    expect(result.text).toBe('');
  });

  it('collapses interior whitespace runs between words', () => {
    const result = normalizeForForcedAlignment('hello    world', 'en', VOCABS.en, CARDINAL_DATA.en);
    expect(result.text).toBe('hello world');
  });
});

describe('faTextNormalize — FOLD: typographic variant to ASCII, preserving the word', () => {
  it('en: "don’t" (curly U+2019 apostrophe) becomes representable and keeps its apostrophe', () => {
    const result = normalizeForForcedAlignment('don’t', 'en', VOCABS.en, CARDINAL_DATA.en);
    expect(result.words[0]!.representable).toBe(true);
    expect(result.words[0]!.mapped).toBe("don't");
    expect(result.text).toBe("don't");
  });

  it('en: an em dash inside a word folds to the vocab hyphen', () => {
    const result = normalizeForForcedAlignment('well—actually', 'en', VOCABS.en, CARDINAL_DATA.en);
    expect(result.words[0]!.representable).toBe(true);
    expect(result.words[0]!.mapped).toBe('well-actually');
  });

  it('en: a curly double quote is dropped (fold target " absent from the en vocab)', () => {
    const result = normalizeForForcedAlignment('“hello”', 'en', VOCABS.en, CARDINAL_DATA.en);
    expect(result.words[0]!.representable).toBe(true);
    expect(result.words[0]!.mapped).toBe('hello');
  });
});

describe('faTextNormalize — STRIP: word-boundary punctuation, never word-internal', () => {
  it('en: "hello." loses only the trailing period', () => {
    const result = normalizeForForcedAlignment('hello.', 'en', VOCABS.en, CARDINAL_DATA.en);
    expect(result.words[0]!.representable).toBe(true);
    expect(result.words[0]!.mapped).toBe('hello');
  });

  it('en: "word," loses only the trailing comma', () => {
    const result = normalizeForForcedAlignment('word,', 'en', VOCABS.en, CARDINAL_DATA.en);
    expect(result.words[0]!.representable).toBe(true);
    expect(result.words[0]!.mapped).toBe('word');
  });

  it('es: guillemets «cerca» are stripped from both edges', () => {
    const result = normalizeForForcedAlignment('«cerca»', 'es', VOCABS.es, CARDINAL_DATA.es);
    expect(result.words[0]!.representable).toBe(true);
    expect(result.words[0]!.mapped).toBe('cerca');
  });

  it('en: stacked boundary marks fully clear from both edges', () => {
    const result = normalizeForForcedAlignment('"word,"', 'en', VOCABS.en, CARDINAL_DATA.en);
    expect(result.words[0]!.representable).toBe(true);
    expect(result.words[0]!.mapped).toBe('word');
  });
});

describe('faTextNormalize — fold and strip together on a single token', () => {
  it('en: a curly-quoted, period-terminated contraction is fully recovered', () => {
    const result = normalizeForForcedAlignment('“don’t.”', 'en', VOCABS.en, CARDINAL_DATA.en);
    expect(result.words[0]!.representable).toBe(true);
    expect(result.words[0]!.mapped).toBe("don't");
  });
});

describe('faTextNormalize — zero-width characters removed mid-word', () => {
  it('en: a zero-width space embedded inside a word is removed, not treated as unrepresentable', () => {
    const result = normalizeForForcedAlignment('hel​lo', 'en', VOCABS.en, CARDINAL_DATA.en);
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
      const result = normalizeForForcedAlignment(word, lang, VOCABS[lang], CARDINAL_DATA[lang]);
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
    const result = normalizeForForcedAlignment('привет.', 'en', VOCABS.en, CARDINAL_DATA.en);
    expect(result.words[0]!.representable).toBe(false);
    expect(result.words[0]!.reason).toMatch(/character ".+" is not in the en vocab/);
    expect(result.text).toBe('');
  });

  it('en: stripping a fully-punctuation token to nothing marks it unrepresentable, not an empty representable word', () => {
    const result = normalizeForForcedAlignment('...', 'en', VOCABS.en, CARDINAL_DATA.en);
    expect(result.words[0]!.representable).toBe(false);
    expect(result.words[0]!.mapped).toBeUndefined();
    expect(result.text).toBe('');
  });
});

describe('faTextNormalize — a fold target absent from a vocab causes a strip there, not a fold', () => {
  it('none of the five vocabs contain an ASCII double quote, so curly double quotes always drop rather than fold', () => {
    for (const lang of LANGUAGES) {
      expect(VOCABS[lang].has('"'), `${lang} vocab should not contain "\\"" per this test's premise`).toBe(false);
      const result = normalizeForForcedAlignment('“x”', lang, VOCABS[lang], CARDINAL_DATA[lang]);
      expect(result.words[0]!.representable).toBe(true);
      expect(result.words[0]!.mapped).toBe('x');
      expect(result.words[0]!.mapped).not.toContain('"');
    }
  });
});

describe('faTextNormalize — French elision (Part H.5 Rule 1)', () => {
  // DECISION: an elided word stays ONE token — see faTextNormalize.ts's own
  // comment block above `foldFrenchElisionBacktick` for the full
  // justification (mirrored byte-for-byte in src-tauri/src/fa/text.rs).

  it('l\'oiseau: straight apostrophe already worked and is unchanged (regression guard)', () => {
    const result = normalizeForForcedAlignment("l'oiseau", 'fr', VOCABS.fr, CARDINAL_DATA.fr);
    expect(result.words).toHaveLength(1);
    expect(result.words[0]!.representable).toBe(true);
    expect(result.words[0]!.mapped).toBe("l'oiseau");
  });

  it('l\'homme (mute h): elides correctly, one token', () => {
    const result = normalizeForForcedAlignment("l'homme", 'fr', VOCABS.fr, CARDINAL_DATA.fr);
    expect(result.words[0]!.representable).toBe(true);
    expect(result.words[0]!.mapped).toBe("l'homme");
  });

  it('le hibou (aspirate h): NOT written elided in the source, stays two separate tokens', () => {
    const result = normalizeForForcedAlignment('le hibou', 'fr', VOCABS.fr, CARDINAL_DATA.fr);
    expect(result.words).toHaveLength(2);
    expect(result.text).toBe('le hibou');
    expect(result.words[0]!.mapped).toBe('le');
    expect(result.words[1]!.mapped).toBe('hibou');
  });

  it('apostrophe-variant case: curly U+2019 and backtick U+0060 both normalize to the same result as straight U+0027', () => {
    const straight = normalizeForForcedAlignment("l'oiseau", 'fr', VOCABS.fr, CARDINAL_DATA.fr);
    const curly = normalizeForForcedAlignment('l’oiseau', 'fr', VOCABS.fr, CARDINAL_DATA.fr);
    const backtick = normalizeForForcedAlignment('l`oiseau', 'fr', VOCABS.fr, CARDINAL_DATA.fr);
    expect(curly.text).toBe(straight.text);
    expect(backtick.text).toBe(straight.text);
    expect(straight.text).toBe("l'oiseau");
  });

  it('qu`il: the two-letter "qu" prefix folds a backtick before a vowel', () => {
    const result = normalizeForForcedAlignment('qu`il', 'fr', VOCABS.fr, CARDINAL_DATA.fr);
    expect(result.words[0]!.representable).toBe(true);
    expect(result.words[0]!.mapped).toBe("qu'il");
  });

  it('the full elision prefix set (l d qu j n s t m c) folds a backtick before a vowel, in one phrase', () => {
    const result = normalizeForForcedAlignment(
      "j`ai n`est s`il t`aime m`appelle c`est d`accord qu`il l`ai",
      'fr',
      VOCABS.fr,
      CARDINAL_DATA.fr,
    );
    expect(result.text).toBe("j'ai n'est s'il t'aime m'appelle c'est d'accord qu'il l'ai");
    expect(result.words.every(w => w.representable)).toBe(true);
  });

  it('negative: "aujourd\'hui" — a fixed compound, not word-initial elision, is untouched (already worked)', () => {
    const result = normalizeForForcedAlignment("aujourd'hui", 'fr', VOCABS.fr, CARDINAL_DATA.fr);
    expect(result.words[0]!.representable).toBe(true);
    expect(result.words[0]!.mapped).toBe("aujourd'hui");
  });

  it('negative: a backtick at a non-word-initial position (mid-compound) is not folded and stays unrepresentable', () => {
    const result = normalizeForForcedAlignment('aujourd`hui', 'fr', VOCABS.fr, CARDINAL_DATA.fr);
    expect(result.words[0]!.representable).toBe(false);
    expect(result.words[0]!.reason).toContain('`');
  });

  it('negative: prefix + backtick + consonant is not a grammatical elision shape and is not folded', () => {
    const result = normalizeForForcedAlignment('j`veux', 'fr', VOCABS.fr, CARDINAL_DATA.fr);
    expect(result.words[0]!.representable).toBe(false);
    expect(result.words[0]!.reason).toContain('`');
  });

  it('negative: the backtick fold is French-only — the same input under "en" is untouched', () => {
    const result = normalizeForForcedAlignment('l`oiseau', 'en', VOCABS.en, CARDINAL_DATA.en);
    expect(result.words[0]!.representable).toBe(false);
    expect(result.words[0]!.reason).toContain('`');
  });
});

describe('faTextNormalize — compositional cardinal-number generation (WS2 T3.2 Step 3b-iii)', () => {
  // Replaces the four former per-language CAPPED 0-30 tables (Spanish/
  // German/Portuguese/French, Part H.5 Rules 2-5) with a shared,
  // data-driven, unbounded generator — see faTextNormalize.ts's own module
  // comment above `FaJoiner` for the design and its no-cap rationale. Every
  // former "negative: N is past the scope cap, stays dropped" case in this
  // file is INVERTED here on purpose: those values are the exact ones this
  // step exists to stop dropping. English is new: it had no FA-side
  // cardinal expansion at all before this step.

  describe('Spanish', () => {
    const CASES: Array<[input: string, mapped: string]> = [
      ['0', 'cero'], ['5', 'cinco'], ['16', 'dieciséis'], ['20', 'veinte'],
      ['23', 'veintitrés'], ['30', 'treinta'],
      ['31', 'treinta y uno'], // former scope cap — now representable
      ['99', 'noventa y nueve'],
      ['100', 'cien'], ['101', 'ciento uno'], ['105', 'ciento cinco'],
      ['200', 'doscientos'], ['234', 'doscientos treinta y cuatro'],
      ['1000', 'mil'], ['1500', 'mil quinientos'],
      ['1000000', 'un millón'], ['2000000', 'dos millones'],
    ];
    it.each(CASES)('"%s" -> "%s"', (input, mapped) => {
      const result = normalizeForForcedAlignment(input, 'es', VOCABS.es, CARDINAL_DATA.es);
      expect(result.words[0]!.representable).toBe(true);
      expect(result.words[0]!.mapped).toBe(mapped);
      expect(result.text).toBe(mapped);
    });

    it('expansion survives inside a phrase', () => {
      const result = normalizeForForcedAlignment('cumplí 23 años', 'es', VOCABS.es, CARDINAL_DATA.es);
      expect(result.text).toBe('cumplí veintitrés años');
      expect(result.words.every(w => w.representable)).toBe(true);
    });
  });

  describe('German', () => {
    const CASES: Array<[input: string, mapped: string]> = [
      ['0', 'null'], ['5', 'fünf'], ['16', 'sechzehn'], ['20', 'zwanzig'],
      ['23', 'dreiundzwanzig'], ['30', 'dreissig'],
      ['31', 'einunddreissig'], // former scope cap — now representable
      ['99', 'neunundneunzig'],
      ['100', 'einhundert'], ['101', 'einhunderteins'], ['105', 'einhundertfünf'],
      ['200', 'zweihundert'],
      ['234', 'zweihundertvierunddreissig'], // space-wall case: fully concatenated, one word (en/es/fr/pt all need multiple words for this value)
      ['1000', 'eintausend'], ['1500', 'eintausendfünfhundert'],
    ];
    it.each(CASES)('"%s" -> "%s"', (input, mapped) => {
      const result = normalizeForForcedAlignment(input, 'de', VOCABS.de, CARDINAL_DATA.de);
      expect(result.words[0]!.representable).toBe(true);
      expect(result.words[0]!.mapped).toBe(mapped);
      expect(result.text).toBe(mapped);
    });

    it('expansion survives inside a phrase', () => {
      const result = normalizeForForcedAlignment('ich bin 23 jahre alt', 'de', VOCABS.de, CARDINAL_DATA.de);
      expect(result.text).toBe('ich bin dreiundzwanzig jahre alt');
      expect(result.words.every(w => w.representable)).toBe(true);
    });
  });

  describe('Portuguese', () => {
    const CASES: Array<[input: string, mapped: string]> = [
      ['0', 'zero'], ['3', 'três'], ['14', 'quatorze'], ['20', 'vinte'], ['30', 'trinta'],
      ['21', 'vinte e um'], // former permanent "wall" value — now representable
      ['29', 'vinte e nove'],
      ['31', 'trinta e um'], // former scope cap — now representable
      ['100', 'cem'], ['101', 'cento e um'], ['105', 'cento e cinco'],
      ['200', 'duzentos'], ['234', 'duzentos e trinta e quatro'],
      ['1000', 'mil'], ['1500', 'mil quinhentos'],
      ['1000000', 'um milhão'], ['2000000', 'dois milhões'],
    ];
    it.each(CASES)('"%s" -> "%s"', (input, mapped) => {
      const result = normalizeForForcedAlignment(input, 'pt', VOCABS.pt, CARDINAL_DATA.pt);
      expect(result.words[0]!.representable).toBe(true);
      expect(result.words[0]!.mapped).toBe(mapped);
      expect(result.text).toBe(mapped);
    });

    it('expansion survives inside a phrase', () => {
      const result = normalizeForForcedAlignment('tenho 3 gatos', 'pt', VOCABS.pt, CARDINAL_DATA.pt);
      expect(result.text).toBe('tenho três gatos');
      expect(result.words.every(w => w.representable)).toBe(true);
    });
  });

  describe('French', () => {
    const CASES: Array<[input: string, mapped: string]> = [
      ['0', 'zéro'], ['1', 'un'], ['17', 'dix-sept'], ['20', 'vingt'], ['30', 'trente'],
      ['21', 'vingt et un'], // former permanent "wall" value — now representable
      ['31', 'trente et un'], // former scope cap — now representable
      ['100', 'cent'], ['101', 'cent un'], ['105', 'cent cinq'],
      ['200', 'deux cents'], // exact multiple of 100: "cent" pluralizes
      ['234', 'deux cent trente-quatre'], // NOT an exact multiple: no 's' on "cent"
      ['1000', 'mille'], ['1500', 'mille cinq cents'],
      ['1000000', 'un million'], ['2000000', 'deux millions'],
    ];
    it.each(CASES)('"%s" -> "%s"', (input, mapped) => {
      const result = normalizeForForcedAlignment(input, 'fr', VOCABS.fr, CARDINAL_DATA.fr);
      expect(result.words[0]!.representable).toBe(true);
      expect(result.words[0]!.mapped).toBe(mapped);
      expect(result.text).toBe(mapped);
    });

    it('a hyphenated expansion (17-19, 22-29) stays exactly one word, not two', () => {
      const result = normalizeForForcedAlignment('dix-sept sont ici', 'fr', VOCABS.fr, CARDINAL_DATA.fr);
      expect(result.words).toHaveLength(3);
      expect(result.words[0]!.mapped).toBe('dix-sept');
    });

    it('expansion survives inside a phrase', () => {
      const result = normalizeForForcedAlignment('il a 17 ans', 'fr', VOCABS.fr, CARDINAL_DATA.fr);
      expect(result.text).toBe('il a dix-sept ans');
      expect(result.words.every(w => w.representable)).toBe(true);
    });

    describe('Rule 1 x Rule 5 co-fire (elision + cardinal expansion in one phrase)', () => {
      it('backtick elision fold and cardinal expansion both fire, independently, in one phrase', () => {
        const result = normalizeForForcedAlignment('j`ai 17 ans', 'fr', VOCABS.fr, CARDINAL_DATA.fr);
        expect(result.text).toBe("j'ai dix-sept ans");
        expect(result.words.every(w => w.representable)).toBe(true);
      });

      it('backtick elision fold and a hyphenated cardinal both survive together', () => {
        const result = normalizeForForcedAlignment('qu`il a 22 ans', 'fr', VOCABS.fr, CARDINAL_DATA.fr);
        expect(result.text).toBe("qu'il a vingt-deux ans");
        expect(result.words.every(w => w.representable)).toBe(true);
      });
    });
  });

  describe('English (new — no FA-side cardinal expansion existed before this step)', () => {
    const CASES: Array<[input: string, mapped: string]> = [
      ['0', 'zero'], ['5', 'five'], ['16', 'sixteen'], ['20', 'twenty'],
      ['23', 'twenty-three'], ['30', 'thirty'], ['99', 'ninety-nine'],
      ['100', 'one hundred'], ['101', 'one hundred one'],
      ['200', 'two hundred'],
      ['234', 'two hundred thirty-four'], // space-wall case (see German's own single-word counterpart above)
      ['1000', 'one thousand'], ['1500', 'one thousand five hundred'],
      ['1000000', 'one million'], ['2000000', 'two million'],
    ];
    it.each(CASES)('"%s" -> "%s"', (input, mapped) => {
      const result = normalizeForForcedAlignment(input, 'en', VOCABS.en, CARDINAL_DATA.en);
      expect(result.words[0]!.representable).toBe(true);
      expect(result.words[0]!.mapped).toBe(mapped);
      expect(result.text).toBe(mapped);
    });

    it('expansion survives inside a phrase', () => {
      const result = normalizeForForcedAlignment('I turned 23 years old', 'en', VOCABS.en, CARDINAL_DATA.en);
      expect(result.text).toBe('i turned twenty-three years old');
      expect(result.words.every(w => w.representable)).toBe(true);
    });
  });

  describe('negatives (unaffected by this step — still out of `expandCardinalToken`\'s scope)', () => {
    it.each(LANGUAGES)('%s: a decimal ("2.5") stays dropped', lang => {
      const result = normalizeForForcedAlignment('2.5', lang, VOCABS[lang], CARDINAL_DATA[lang]);
      expect(result.words[0]!.representable).toBe(false);
      expect(result.words[0]!.reason).toContain('digit');
    });

    it.each(LANGUAGES)('%s: a leading-zero form ("05") is not a bare cardinal and stays dropped', lang => {
      const result = normalizeForForcedAlignment('05', lang, VOCABS[lang], CARDINAL_DATA[lang]);
      expect(result.words[0]!.representable).toBe(false);
      expect(result.words[0]!.reason).toContain('digit');
    });
  });

  describe('yearReading (WS2 T3.2 Step 3b-ii\'s selectionPolicy, consumed here for the first time)', () => {
    // en/de: the modFloorThreshold policy — n % 100 >= 10 selects the
    // "pair"/"hundertgruppe" candidate, else the "compound" (plain cardinal)
    // fallback — mirroring the matcher's (`textNormalize.ts`) own x00-x09
    // quirk on purpose (see fa-cardinal-{en,de}.json's own matcherParityNote).
    // es/fr/pt: a plain "compound" string policy — always the full cardinal.
    it.each([
      ['en', '1998', 'nineteen ninety-eight'], // >= threshold: "pair"
      ['en', '1905', 'one thousand nine hundred five'], // < threshold (x00-x09 quirk): "compound"
      ['en', '2010', 'twenty ten'],
      ['en', '2004', 'two thousand four'],
      ['de', '1998', 'neunzehnhundertachtundneunzig'], // >= threshold: "hundertgruppe"
      ['de', '1905', 'eintausendneunhundertfünf'], // < threshold: "compound"
      ['es', '1998', 'mil novecientos noventa y ocho'], // plain "compound" policy, always
      ['fr', '1998', 'mille neuf cent quatre-vingt-dix-huit'],
      ['pt', '1998', 'mil novecentos e noventa e oito'],
    ] as const)('%s "%s" -> "%s"', (lang, input, mapped) => {
      const result = normalizeForForcedAlignment(input, lang, VOCABS[lang], CARDINAL_DATA[lang]);
      expect(result.words[0]!.representable).toBe(true);
      expect(result.words[0]!.mapped).toBe(mapped);
    });

    it('a 3-digit or 5+-digit token never takes the year-reading branch, even inside the numeric range', () => {
      // yearReading only applies to a 4-CHARACTER token (mirrors the
      // matcher's own `tok.length === 4` gate) — "01998"/"998" don't
      // qualify even though 1998 itself is in range. Using "0999" would be
      // rejected earlier (leading zero), so this checks the boundary via a
      // 3-digit and a plain non-year cardinal instead.
      const en = CARDINAL_DATA.en;
      const three = normalizeForForcedAlignment('998', 'en', VOCABS.en, en);
      expect(three.words[0]!.mapped).toBe('nine hundred ninety-eight'); // plain cardinal, not year-pair
    });
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
