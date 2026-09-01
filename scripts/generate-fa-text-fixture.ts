/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// ---------------------------------------------------------------------------
// WS1 Task 5 Slice D3 — shared TS/Rust parity fixture generator.
//
// Drives the EXISTING, tested `src/services/faTextNormalize.ts` module (not
// reimplemented, not modified) over a fixed corpus covering all five FA
// languages plus edge cases, and writes the result to
// `scripts/fixtures/fa-text-normalize-fixture.json`. The Rust port
// (`src-tauri/src/fa/text.rs`) asserts byte-identical output against this
// fixture; `src/services/faTextNormalize.fixtureDrift.test.ts` asserts the
// fixture still matches the live TS module, so the two can never silently
// drift apart.
//
// Run via `npx tsx scripts/generate-fa-text-fixture.ts` (not part of
// `npm test`/`npm run build` — a one-shot generator, like the `scripts/*.py`
// fixture producers this file sits alongside). Re-run and commit the diff
// only if the corpus below is deliberately changed.
// ---------------------------------------------------------------------------

import { writeFileSync, readFileSync } from 'fs';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import {
  normalizeForForcedAlignment,
  vocabCharsFromRawVocab,
  type FaLanguageCode,
  type FaCardinalData,
} from '../src/services/faTextNormalize';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');

interface RawVocab {
  _provenance: { modelId: string };
  vocab: Record<string, number>;
}

function loadRawVocab(lang: FaLanguageCode): RawVocab {
  return JSON.parse(
    readFileSync(resolve(REPO, 'scripts', 'fixtures', `fa-vocab-${lang}.json`), 'utf-8'),
  ) as RawVocab;
}

function loadCardinalData(lang: FaLanguageCode): FaCardinalData {
  return JSON.parse(
    readFileSync(resolve(REPO, 'scripts', 'fixtures', `fa-cardinal-${lang}.json`), 'utf-8'),
  ) as FaCardinalData;
}

const LANGUAGES: FaLanguageCode[] = ['en', 'es', 'fr', 'de', 'pt'];
const RAW_VOCABS: Record<FaLanguageCode, RawVocab> = Object.fromEntries(
  LANGUAGES.map(lang => [lang, loadRawVocab(lang)]),
) as Record<FaLanguageCode, RawVocab>;
const VOCAB_CHARS: Record<FaLanguageCode, Set<string>> = Object.fromEntries(
  LANGUAGES.map(lang => [lang, vocabCharsFromRawVocab(RAW_VOCABS[lang].vocab)]),
) as Record<FaLanguageCode, Set<string>>;
const CARDINAL_DATA: Record<FaLanguageCode, FaCardinalData> = Object.fromEntries(
  LANGUAGES.map(lang => [lang, loadCardinalData(lang)]),
) as Record<FaLanguageCode, FaCardinalData>;

// -- corpus -------------------------------------------------------------
// Every entry: { lang, input, note }. `note` documents which required
// coverage bucket the case exercises — cross-checked at the bottom of this
// file, not emitted into the fixture itself.

interface CorpusCase {
  lang: FaLanguageCode;
  input: string;
  note: string;
}

const CORPUS: CorpusCase[] = [
  // -- empty / whitespace-only input --------------------------------------
  { lang: 'en', input: '', note: 'empty input' },
  { lang: 'en', input: '   \t\n  ', note: 'whitespace-only input' },

  // -- mixed case -----------------------------------------------------------
  { lang: 'en', input: 'Hello WORLD MiXeD', note: 'mixed case' },
  { lang: 'de', input: 'STRASSE', note: 'mixed case (all-caps, plain ASCII)' },
  { lang: 'de', input: 'GROẞ', note: 'mixed case + uppercase eszett -> ss' },

  // -- German ß / eszett ------------------------------------------------
  { lang: 'de', input: 'straße', note: 'German ß -> ss' },
  { lang: 'de', input: 'die straße ist groß', note: 'German ß -> ss, phrase' },

  // -- diacritics per language --------------------------------------------
  { lang: 'es', input: 'año', note: 'es diacritic' },
  { lang: 'es', input: 'el año pasado fue increíble', note: 'es diacritic phrase' },
  { lang: 'fr', input: 'élève', note: 'fr diacritic' },
  { lang: 'fr', input: "l'élève où était-il", note: 'fr diacritic phrase, internal apostrophe/hyphen' },
  { lang: 'de', input: 'über', note: 'de diacritic' },
  { lang: 'pt', input: 'ação', note: 'pt diacritic' },
  { lang: 'pt', input: 'a ação não é fácil', note: 'pt diacritic phrase' },

  // -- French loanword characters ------------------------------------------
  { lang: 'fr', input: 'ćčšș', note: 'fr loanword characters (non-French Latin letters in fr vocab)' },

  // -- digit-containing words --------------------------------------------
  { lang: 'en', input: '12', note: 'bare digit' },
  { lang: 'en', input: 'room101 available', note: 'digit-bearing word dropped, rest of phrase survives' },
  { lang: 'de', input: 'Zimmer5 ist frei', note: 'digit-bearing word dropped (de)' },
  { lang: 'es', input: 'año2024 pasado', note: 'digit-bearing word dropped (es)' },

  // -- pure punctuation -----------------------------------------------------
  { lang: 'en', input: '...', note: 'pure punctuation -> reduced to nothing' },

  // -- genuine OOV tokens (must be rejected, not silently accepted) --------
  { lang: 'en', input: 'привет.', note: 'genuine OOV: Cyrillic, must reject' },
  { lang: 'fr', input: '日本語', note: 'genuine OOV: CJK, must reject (fr)' },

  // -- FOLD: typographic variant -> ASCII, preserving the word ------------
  { lang: 'en', input: 'don’t', note: 'fold: curly apostrophe -> straight' },
  { lang: 'en', input: 'well—actually', note: 'fold: em dash -> hyphen' },
  { lang: 'en', input: '“hello”', note: 'fold target absent from vocab -> drop, not fold' },
  { lang: 'en', input: '“don’t.”', note: 'fold + strip together' },

  // -- STRIP: word-boundary punctuation, never word-internal --------------
  { lang: 'en', input: 'hello.', note: 'strip: trailing period' },
  { lang: 'en', input: 'word,', note: 'strip: trailing comma' },
  { lang: 'en', input: '"word,"', note: 'strip: stacked boundary marks both edges' },
  { lang: 'es', input: '«cerca»', note: 'strip: guillemets both edges' },

  // -- zero-width characters mid-word --------------------------------------
  { lang: 'en', input: 'hel​lo', note: 'zero-width space removed mid-word' },

  // -- word-internal apostrophe / hyphen survive ---------------------------
  { lang: 'en', input: "don't", note: 'word-internal apostrophe survives' },
  { lang: 'en', input: 'well-known', note: 'word-internal hyphen survives' },
  { lang: 'de', input: 'arbeits-platz', note: 'word-internal hyphen survives (de)' },
  { lang: 'pt', input: "d'água", note: 'word-internal apostrophe survives (pt)' },

  // -- it's a good day (baseline sanity phrase) ----------------------------
  { lang: 'en', input: "it's a good day", note: 'baseline sanity phrase' },

  // -- French elision (Part H.5 Rule 1) ------------------------------------
  { lang: 'fr', input: "l'oiseau", note: 'fr elision: straight apostrophe, already worked, regression guard' },
  { lang: 'fr', input: "l'homme", note: 'fr elision: mute-h word, straight apostrophe' },
  { lang: 'fr', input: 'l`homme', note: 'fr elision: mute-h word, backtick apostrophe-typo folds' },
  { lang: 'fr', input: 'le hibou', note: 'fr elision: aspirate-h word NOT written elided, stays two tokens' },
  { lang: 'fr', input: 'l’oiseau', note: 'fr elision: curly U+2019 apostrophe (generic fold, already worked)' },
  { lang: 'fr', input: 'l`oiseau', note: 'fr elision: backtick apostrophe-typo before a vowel folds' },
  { lang: 'fr', input: 'qu`il', note: 'fr elision: two-letter "qu" prefix, backtick before a vowel folds' },
  {
    lang: 'fr',
    input: "j`ai n`est s`il t`aime m`appelle c`est d`accord qu`il l`ai",
    note: 'fr elision: full prefix set (l d qu j n s t m c), backtick before vowel, single phrase',
  },
  { lang: 'fr', input: "aujourd'hui", note: 'fr elision negative: fixed compound, not word-initial elision, unchanged' },
  { lang: 'fr', input: 'aujourd`hui', note: 'fr elision negative: backtick not at a word-initial elision boundary, not folded' },
  { lang: 'fr', input: 'j`veux', note: 'fr elision negative: prefix+backtick before a consonant, not a grammatical elision shape' },
  { lang: 'en', input: 'l`oiseau', note: 'fr elision negative: the backtick fold is French-only, untouched under en' },

  // -- Spanish cardinal numbers, WS2 T3.2 Step 3b-iii compositional generator
  //    (supersedes the former capped 0-30 table, Part H.5 Rule 2) ---------
  { lang: 'es', input: '23', note: 'es cardinal: bare digit 0-30 range expands to a spelled word' },
  { lang: 'es', input: '0', note: 'es cardinal: lower boundary value' },
  { lang: 'es', input: '30', note: 'es cardinal: former table upper boundary value' },
  { lang: 'es', input: 'cumplí 23 años', note: 'es cardinal: expansion survives inside a phrase' },
  { lang: 'es', input: '31', note: 'es cardinal: former cap boundary (used to stay dropped as a multi-word "y" compound) — now representable' },
  { lang: 'es', input: '234', note: 'es cardinal: arbitrary magnitude, hundreds + "y" compound (doscientos treinta y cuatro)' },
  { lang: 'es', input: '1000000', note: 'es cardinal: arbitrary magnitude, million-level with the "un millón" apocope fix' },
  { lang: 'es', input: '1998', note: 'es cardinal: year-shaped value, always the plain "compound" reading (no pair-style policy for es)' },
  { lang: 'es', input: '2.5', note: 'es cardinal negative: decimal stays dropped, out of scope' },
  { lang: 'es', input: '05', note: 'es cardinal negative: leading zero is not a bare cardinal, stays dropped' },

  // -- German cardinal numbers, WS2 T3.2 Step 3b-iii compositional generator
  //    (supersedes the former capped 0-30 table, Part H.5 Rule 3) --------
  { lang: 'de', input: '23', note: 'de cardinal: bare digit 0-30 range expands to a spelled word' },
  { lang: 'de', input: '0', note: 'de cardinal: lower boundary value' },
  { lang: 'de', input: '30', note: 'de cardinal: former table upper boundary value (dreissig, pre-substituted ss)' },
  { lang: 'de', input: 'ich bin 23 jahre alt', note: 'de cardinal: expansion survives inside a phrase' },
  { lang: 'de', input: '31', note: 'de cardinal: former cap boundary (used to stay dropped) — now representable' },
  { lang: 'de', input: '100', note: 'de cardinal: einhundert, not einshundert (countWordOverride fix, WS2 T3.2 Step 3b-iii)' },
  { lang: 'de', input: '234', note: 'de cardinal: space-wall case — fully concatenated into one word, unlike en/es/fr/pt at the same value' },
  { lang: 'de', input: '1000', note: 'de cardinal: eintausend, not einstausend (countWordOverride fix)' },
  { lang: 'de', input: '1998', note: 'de yearReading: n % 100 = 98 >= threshold (10) -> "hundertgruppe" (neunzehnhundertachtundneunzig)' },
  { lang: 'de', input: '1905', note: 'de yearReading: n % 100 = 5 < threshold (10), x00-x09 quirk mirrored from the matcher -> "compound"' },
  { lang: 'de', input: '2000', note: 'de yearReading: x00-x09 quirk, another century' },
  { lang: 'de', input: '2010', note: 'de yearReading: n % 100 = 10 >= threshold, boundary value itself' },
  { lang: 'de', input: '2.5', note: 'de cardinal negative: decimal stays dropped, out of scope' },
  { lang: 'de', input: '05', note: 'de cardinal negative: leading zero is not a bare cardinal, stays dropped' },

  // -- Portuguese cardinal numbers, WS2 T3.2 Step 3b-iii compositional
  //    generator (supersedes the former capped 0-20/30 table, Part H.5 Rule 4;
  //    PT-BR spelling per owner decision 2026-08-15) ----------------------
  { lang: 'pt', input: '3', note: 'pt cardinal: bare digit expands to a spelled word' },
  { lang: 'pt', input: '0', note: 'pt cardinal: lower boundary value' },
  { lang: 'pt', input: '14', note: 'pt cardinal: PT-BR variant value (quatorze, not catorze)' },
  { lang: 'pt', input: '16', note: 'pt cardinal: PT-BR variant value (dezesseis, not dezasseis)' },
  { lang: 'pt', input: '17', note: 'pt cardinal: PT-BR variant value (dezessete, not dezassete)' },
  { lang: 'pt', input: '19', note: 'pt cardinal: PT-BR variant value (dezenove, not dezanove)' },
  { lang: 'pt', input: '20', note: 'pt cardinal: former table upper boundary of the contiguous single-word range' },
  { lang: 'pt', input: '30', note: 'pt cardinal: former table\'s one value past 20 that was still a single word' },
  { lang: 'pt', input: 'tenho 3 gatos', note: 'pt cardinal: expansion survives inside a phrase' },
  { lang: 'pt', input: '21', note: 'pt cardinal: former permanent "vinte e X" wall value (used to stay dropped) — now representable' },
  { lang: 'pt', input: '29', note: 'pt cardinal: the other end of the former "vinte e X" wall — now representable' },
  { lang: 'pt', input: '31', note: 'pt cardinal: former cap boundary (used to stay dropped) — now representable' },
  { lang: 'pt', input: '234', note: 'pt cardinal: arbitrary magnitude, hundreds + "e" compound (duzentos e trinta e quatro)' },
  { lang: 'pt', input: '1998', note: 'pt cardinal: year-shaped value, always the plain "compound" reading (no pair-style policy for pt)' },
  { lang: 'pt', input: '2.5', note: 'pt cardinal negative: decimal stays dropped, out of scope' },
  { lang: 'pt', input: '05', note: 'pt cardinal negative: leading zero is not a bare cardinal, stays dropped' },

  // -- French cardinal numbers, WS2 T3.2 Step 3b-iii compositional generator
  //    (supersedes the former capped 0-30-minus-21 table, Part H.5 Rule 5) --
  { lang: 'fr', input: '0', note: 'fr cardinal: lower boundary value' },
  { lang: 'fr', input: '1', note: 'fr cardinal: bare digit expands to a spelled word' },
  { lang: 'fr', input: '16', note: 'fr cardinal: last non-hyphenated teen (seize)' },
  { lang: 'fr', input: '17', note: 'fr cardinal: hyphenated teen, one token in/out (dix-sept)' },
  { lang: 'fr', input: '18', note: 'fr cardinal: hyphenated teen, one token in/out (dix-huit)' },
  { lang: 'fr', input: '19', note: 'fr cardinal: hyphenated teen, one token in/out (dix-neuf)' },
  { lang: 'fr', input: '20', note: 'fr cardinal: boundary value (vingt)' },
  { lang: 'fr', input: '22', note: 'fr cardinal: hyphenated "vingt-X" shape, one token in/out (vingt-deux)' },
  { lang: 'fr', input: '29', note: 'fr cardinal: upper end of the hyphenated "vingt-X" shape (vingt-neuf)' },
  { lang: 'fr', input: '30', note: 'fr cardinal: former table upper boundary value (trente)' },
  { lang: 'fr', input: 'il a 17 ans', note: 'fr cardinal: expansion survives inside a phrase' },
  { lang: 'fr', input: '21', note: 'fr cardinal: former permanent "vingt et un" wall value (used to stay dropped) — now representable' },
  { lang: 'fr', input: '31', note: 'fr cardinal: former cap boundary (used to stay dropped) — now representable' },
  { lang: 'fr', input: '100', note: 'fr cardinal: exactly 100, "cent" with no leading "un" (dropsOneMultiplier)' },
  { lang: 'fr', input: '200', note: 'fr cardinal: exact multiple of 100 pluralizes "cent" -> "cents" (deux cents)' },
  { lang: 'fr', input: '234', note: 'fr cardinal: NOT an exact multiple, "cent" does not pluralize (deux cent trente-quatre)' },
  { lang: 'fr', input: '1998', note: 'fr cardinal: year-shaped value, always the plain "compound" reading (no pair-style policy for fr)' },
  { lang: 'fr', input: '2.5', note: 'fr cardinal negative: decimal stays dropped, out of scope' },
  { lang: 'fr', input: '05', note: 'fr cardinal negative: leading zero is not a bare cardinal, stays dropped' },

  // -- Rule 1 x Rule 5 co-fire: French elision + cardinal expansion --------
  { lang: 'fr', input: 'j`ai 17 ans', note: 'fr elision + fr cardinal co-fire: backtick elision fold and cardinal expansion both fire in one phrase' },
  { lang: 'fr', input: 'qu`il a 22 ans', note: 'fr elision + fr cardinal co-fire: backtick elision fold and a hyphenated cardinal both survive together' },

  // -- English cardinal numbers, WS2 T3.2 Step 3b-iii compositional
  //    generator (NEW — no FA-side cardinal expansion existed for English
  //    before this step; every digit token was unconditionally dropped) --
  { lang: 'en', input: '23', note: 'en cardinal: bare digit expands to a spelled word (previously always dropped, this is the "unaffected-language control" value from every other language\'s old cardinal test)' },
  { lang: 'en', input: '3', note: 'en cardinal: bare digit, another former unaffected-language-control value' },
  { lang: 'en', input: '17', note: 'en cardinal: bare digit, another former unaffected-language-control value' },
  { lang: 'en', input: '31', note: 'en cardinal: former cap boundary value under other languages\' old tables — now representable under en too' },
  { lang: 'en', input: '234', note: 'en cardinal: space-wall case — three words (two hundred thirty-four), unlike German at the same value' },
  { lang: 'en', input: '1000000', note: 'en cardinal: arbitrary magnitude, million level' },
  { lang: 'en', input: 'I turned 23 years old', note: 'en cardinal: expansion survives inside a phrase' },
  { lang: 'en', input: '1998', note: 'en yearReading: n % 100 = 98 >= threshold (10) -> "pair" (nineteen ninety-eight)' },
  { lang: 'en', input: '1905', note: 'en yearReading: n % 100 = 5 < threshold (10), the x00-x09 quirk mirrored from the matcher\'s own textNormalize.ts -> "compound" (one thousand nine hundred five)' },
  { lang: 'en', input: '2000', note: 'en yearReading: x00-x09 quirk, another century (two thousand)' },
  { lang: 'en', input: '2010', note: 'en yearReading: n % 100 = 10 >= threshold, boundary value itself (twenty ten)' },
  { lang: 'en', input: '2024', note: 'en yearReading: pair reading, another value (twenty twenty-four)' },
  { lang: 'en', input: '998', note: 'en yearReading negative: a 3-digit token never takes the year-reading branch even though 1998 is in range — plain cardinal (nine hundred ninety-eight)' },
  { lang: 'en', input: '2.5', note: 'en cardinal negative: decimal stays dropped, out of scope' },
  { lang: 'en', input: '05', note: 'en cardinal negative: leading zero is not a bare cardinal, stays dropped' },
];

// Coverage cross-check — fails loudly (not silently) if a required bucket
// from the task spec has no corpus case, rather than trusting the list above
// to stay complete under future edits.
const REQUIRED_NOTE_SUBSTRINGS = [
  'es diacritic',
  'fr diacritic',
  'de diacritic',
  'pt diacritic',
  'German ß',
  'loanword characters',
  'digit-bearing word',
  'bare digit',
  'pure punctuation',
  'empty input',
  'whitespace-only input',
  'mixed case',
  'genuine OOV',
  'fr elision',
  'es cardinal',
  'de cardinal',
  'pt cardinal',
  'fr cardinal',
  'en cardinal',
  'yearReading',
  'space-wall',
  'former cap boundary',
];
for (const needle of REQUIRED_NOTE_SUBSTRINGS) {
  if (!CORPUS.some(c => c.note.includes(needle))) {
    throw new Error(`fixture corpus is missing required coverage: "${needle}"`);
  }
}

// -- drive the TS module -------------------------------------------------

interface FixtureWord {
  input: string;
  representable: boolean;
  mapped: string | null;
  reason: string | null;
  tokenIds: number[] | null;
}

interface FixtureEntry {
  language: FaLanguageCode;
  input: string;
  note: string;
  words: FixtureWord[];
  text: string;
  textTokenIds: number[];
}

function wordTokenIds(mapped: string, vocab: Record<string, number>): number[] {
  // A multi-word compositional cardinal reading (WS2 T3.2 Step 3b-iii) may
  // contain internal whitespace — split into fragments and insert the
  // word-delimiter id between them too, mirroring `fa_onnx.rs`'s
  // `tokenize_normalized_words` (a fragment delimiter is indistinguishable
  // from a between-word delimiter at the CTC level; no normalizer emitted
  // internal whitespace before this step, so this is a strict extension —
  // every pre-existing single-fragment `mapped` value tokenizes identically
  // to before).
  const delim = vocab['|'];
  const fragments = mapped.split(/\s+/).filter(f => f.length > 0);
  const ids: number[] = [];
  fragments.forEach((fragment, i) => {
    if (i > 0) {
      if (delim === undefined) throw new Error('vocab missing "|" word-delimiter token');
      ids.push(delim);
    }
    for (const ch of fragment) {
      const id = vocab[ch];
      if (id === undefined) {
        throw new Error(`representable word "${mapped}" contains char "${ch}" absent from vocab — invariant violated`);
      }
      ids.push(id);
    }
  });
  return ids;
}

function textTokenIds(text: string, vocab: Record<string, number>): number[] {
  const delim = vocab['|'];
  if (delim === undefined) throw new Error('vocab missing "|" word-delimiter token');
  if (text.length === 0) return [];
  const words = text.split(' ');
  const ids: number[] = [];
  words.forEach((w, i) => {
    if (i > 0) ids.push(delim);
    ids.push(...wordTokenIds(w, vocab));
  });
  return ids;
}

const entries: FixtureEntry[] = CORPUS.map(({ lang, input, note }) => {
  const vocab = RAW_VOCABS[lang].vocab;
  const result = normalizeForForcedAlignment(input, lang, VOCAB_CHARS[lang], CARDINAL_DATA[lang]);
  const words: FixtureWord[] = result.words.map(w => ({
    input: w.input,
    representable: w.representable,
    mapped: w.mapped ?? null,
    reason: w.reason ?? null,
    tokenIds: w.representable ? wordTokenIds(w.mapped!, vocab) : null,
  }));
  return {
    language: lang,
    input,
    note,
    words,
    text: result.text,
    textTokenIds: textTokenIds(result.text, vocab),
  };
});

const fixture = {
  _generatedBy: 'scripts/generate-fa-text-fixture.ts (run via `npx tsx`) — driven from src/services/faTextNormalize.ts',
  entries,
};

const outPath = resolve(REPO, 'scripts', 'fixtures', 'fa-text-normalize-fixture.json');
const json = JSON.stringify(fixture, null, 2);
writeFileSync(outPath, json + '\n');

const bytes = Buffer.byteLength(json, 'utf-8');
console.log(`Wrote ${entries.length} entries (${bytes} bytes) to ${outPath}`);
if (bytes > 512 * 1024) {
  throw new Error(`fixture exceeds 512 KB cap: ${bytes} bytes`);
}
