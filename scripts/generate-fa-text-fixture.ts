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

const LANGUAGES: FaLanguageCode[] = ['en', 'es', 'fr', 'de', 'pt'];
const RAW_VOCABS: Record<FaLanguageCode, RawVocab> = Object.fromEntries(
  LANGUAGES.map(lang => [lang, loadRawVocab(lang)]),
) as Record<FaLanguageCode, RawVocab>;
const VOCAB_CHARS: Record<FaLanguageCode, Set<string>> = Object.fromEntries(
  LANGUAGES.map(lang => [lang, vocabCharsFromRawVocab(RAW_VOCABS[lang].vocab)]),
) as Record<FaLanguageCode, Set<string>>;

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

  // -- Spanish cardinal numbers 0-30 (Part H.5 Rule 2) ---------------------
  { lang: 'es', input: '23', note: 'es cardinal 0-30: bare digit expands to a spelled word' },
  { lang: 'es', input: '0', note: 'es cardinal 0-30: lower boundary value' },
  { lang: 'es', input: '30', note: 'es cardinal 0-30: upper boundary value' },
  { lang: 'es', input: 'cumplí 23 años', note: 'es cardinal 0-30: expansion survives inside a phrase' },
  { lang: 'es', input: '31', note: 'es cardinal negative: 31 is a multi-word "y" compound, out of scope, stays dropped' },
  { lang: 'es', input: '2.5', note: 'es cardinal negative: decimal stays dropped, out of scope' },
  { lang: 'es', input: '05', note: 'es cardinal negative: leading zero is not a bare cardinal, stays dropped' },
  { lang: 'fr', input: '23', note: 'es cardinal 0-30 unaffected-language control: fr digit word still drops exactly as before' },

  // -- German cardinal numbers 0-30 (Part H.5 Rule 3, Phase 3b remainder) --
  { lang: 'de', input: '23', note: 'de cardinal 0-30: bare digit expands to a spelled word' },
  { lang: 'de', input: '0', note: 'de cardinal 0-30: lower boundary value' },
  { lang: 'de', input: '30', note: 'de cardinal 0-30: upper boundary value (dreissig, pre-substituted ss)' },
  { lang: 'de', input: 'ich bin 23 jahre alt', note: 'de cardinal 0-30: expansion survives inside a phrase' },
  { lang: 'de', input: '31', note: 'de cardinal negative: 31 is past the scope cap, stays dropped' },
  { lang: 'de', input: '2.5', note: 'de cardinal negative: decimal stays dropped, out of scope' },
  { lang: 'de', input: '05', note: 'de cardinal negative: leading zero is not a bare cardinal, stays dropped' },
  { lang: 'pt', input: '23', note: 'de cardinal 0-30 unaffected-language control: pt digit word still drops exactly as before' },
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
  'es cardinal 0-30',
  'de cardinal 0-30',
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
  return [...mapped].map(ch => {
    const id = vocab[ch];
    if (id === undefined) {
      throw new Error(`representable word "${mapped}" contains char "${ch}" absent from vocab — invariant violated`);
    }
    return id;
  });
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
  const result = normalizeForForcedAlignment(input, lang, VOCAB_CHARS[lang]);
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
