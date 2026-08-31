/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// ---------------------------------------------------------------------------
// WS2 T3.1 Step 3 — es/fr/de/pt conformance fixture for `canonicalize()`
// (src/services/textNormalize.ts).
//
// Drives the EXISTING, tested `canonicalize()` directly (not reimplemented,
// not modified, not going through the sync pipeline) over a curated corpus
// covering the four non-English branches, and writes the result to
// `scripts/fixtures/canonicalize-conformance-fixture.json`.
//
// Mirrors `scripts/generate-fa-text-fixture.ts`'s pattern (a one-shot
// generator driving a live TS module, corpus + coverage cross-check inline,
// output written and byte-capped) and its output envelope shape
// (`_generatedBy` + `entries[]` with `language`/`input`/`note` on every
// entry) — but `canonicalize()` computes a genuinely different thing than
// `faTextNormalize.ts`'s vocab-aware per-word normalizer (no ONNX vocab, no
// tokenIds, no representable/mapped/reason per word): its output is a flat
// token-array, so the per-entry payload fields differ. See this step's report
// for the Rust-readability verdict.
//
// THIS FIXTURE LOCKS CURRENT BEHAVIOR, NOT DESIRED BEHAVIOR. Where current
// behavior is lossy (documented, known gaps — not fixed by this fixture),
// `knownLossy`/`lossyNote` record it. Where an es/fr/de/pt output looks like
// it could be a defect but this step has no way to confirm intent,
// `notDetermined`/`notDeterminedNote` record that instead — nothing is
// "fixed" by this generator or this step.
//
// Run via `npx tsx scripts/generate-canonicalize-conformance-fixture.ts`.
// Re-run and commit the diff only if the corpus below is deliberately
// changed.
// ---------------------------------------------------------------------------

import { writeFileSync } from 'fs';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import { canonicalize } from '../src/services/textNormalize';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');

type Lang = 'es' | 'fr' | 'de' | 'pt';

interface CorpusCase {
  lang: Lang;
  input: string;
  note: string;
  /** Which required coverage bucket(s) this case exercises — cross-checked
   *  below, not emitted into the fixture itself. */
  classes: string[];
  knownLossy?: string;
  notDetermined?: string;
}

// -- corpus -----------------------------------------------------------------
// Every entry: { lang, input, note, classes, knownLossy?, notDetermined? }.
// `classes` values are cross-checked against REQUIRED_CLASSES below so a
// missing coverage bucket fails loudly rather than silently.

const CORPUS: CorpusCase[] = [
  // -- Spanish --------------------------------------------------------------
  { lang: 'es', input: 'café', note: 'accented vowel, single word', classes: ['accented-vowel'] },
  { lang: 'es', input: 'año', note: 'ñ, single word', classes: ['enye'] },
  {
    lang: 'es', input: 'político-económico', note: 'hyphenated compound (both parts well-formed words)',
    classes: ['hyphenated-compound'],
  },
  {
    lang: 'es', input: '¿Cómo estás?', note: 'punctuation: inverted question mark + trailing question mark',
    classes: ['punctuation'],
  },
  {
    lang: 'es', input: 'año 2024', note: 'digit token inside an es phrase',
    classes: ['digits'],
    knownLossy: 'digitTokenToWords (textNormalize.ts) always reads a digit run as ENGLISH ' +
      'cardinal/year words, uninformed by languageCode — "2024" -> "twenty twenty four", not ' +
      'a Spanish reading. Documented, unstarted gap: canonicalize()\'s own doc comment and ' +
      'CLAUDE.md\'s Sync/Whisper invariants both name this as sync-pipeline-v2-plan.md H.5, ' +
      'out of scope for WS2 T3.1.',
  },
  {
    lang: 'es', input: 'El médico atendió a través del área difícil ayer',
    note: 'real sentence, multiple accented vowels', classes: ['accented-vowel', 'real-sentence'],
  },
  {
    lang: 'es', input: 'Después de años, volvió al pueblo con su corazón tranquilo',
    note: 'real sentence, ñ + accented vowels + comma punctuation',
    classes: ['enye', 'accented-vowel', 'punctuation', 'real-sentence'],
  },
  {
    lang: 'es', input: "d'agua", note: "word-internal apostrophe (not a real Spanish elision, probes the generic apostrophe-strip path)",
    classes: ['apostrophe'],
    notDetermined: 'canonicalize() strips ANY apostrophe to a space on every branch (en included — ' +
      'only a fixed set of English contractions in CONTRACTIONS survive as one token, by expansion, ' +
      'not preservation) — "d\'agua" -> ["d","agua"], two tokens. Unlike faTextNormalize.ts (a ' +
      'DIFFERENT module), canonicalize() has no French-elision-style apostrophe handling for any ' +
      'language. Whether this is an accepted scope boundary or a real gap for es/fr/pt elision-heavy ' +
      'text is NOT DETERMINED by this step — recorded, not fixed.',
  },

  // -- French -----------------------------------------------------------------
  { lang: 'fr', input: 'élève', note: 'accented vowel, single word', classes: ['accented-vowel'] },
  { lang: 'fr', input: 'garçon', note: 'ç, single word', classes: ['cedilla'] },
  {
    lang: 'fr', input: 'grand-mère', note: 'hyphenated compound (both parts well-formed words)',
    classes: ['hyphenated-compound'],
  },
  {
    lang: 'fr', input: '«Bonjour, ça va ?»', note: 'punctuation: guillemets + comma + spaced question mark',
    classes: ['punctuation'],
  },
  {
    lang: 'fr', input: '23 ans', note: 'digit token inside a fr phrase',
    classes: ['digits'],
    knownLossy: 'Same digitTokenToWords gap as the es case above — "23" -> "twenty three" (English ' +
      'words), not "vingt-trois". sync-pipeline-v2-plan.md H.5, out of scope for WS2 T3.1.',
  },
  {
    lang: 'fr', input: 'Le café est très près de la forêt cet été',
    note: 'real sentence, multiple accented vowels', classes: ['accented-vowel', 'real-sentence'],
  },
  {
    lang: 'fr', input: "L'élève étudie à Noël même où il était né",
    note: 'real sentence, word-initial elision apostrophe + accented vowels',
    classes: ['apostrophe', 'accented-vowel', 'real-sentence'],
    notDetermined: '"L\'élève" -> ["l","élève"], split into two tokens — canonicalize() has no ' +
      'French-elision handling (see the es d\'agua case above for the general apostrophe-strip ' +
      'behavior this follows). NOT DETERMINED whether this is a real gap for fr text specifically.',
  },
  {
    lang: 'fr', input: 'ćčšș', note: 'loanword/non-French Latin letters, preserved by \\p{L} (regression witness shared with fa-text-normalize-fixture.json)',
    classes: ['accented-vowel'],
  },

  // -- German -----------------------------------------------------------------
  { lang: 'de', input: 'über', note: 'accented vowel (umlaut), single word', classes: ['accented-vowel'] },
  { lang: 'de', input: 'straße', note: 'ß, single word', classes: ['eszett'] },
  {
    lang: 'de', input: 'Süd-Amerika', note: 'hyphenated compound (both parts well-formed words), mixed case',
    classes: ['hyphenated-compound'],
  },
  {
    lang: 'de', input: 'Wir müssen morgen früh nach Köln fahren, oder?',
    note: 'punctuation: comma + trailing question mark, real sentence',
    classes: ['punctuation', 'accented-vowel', 'real-sentence'],
  },
  {
    lang: 'de', input: '23 Jahre', note: 'digit token inside a de phrase',
    classes: ['digits'],
    knownLossy: 'Same digitTokenToWords gap as the es/fr cases above — "23" -> "twenty three" ' +
      '(English words), not "dreiundzwanzig". sync-pipeline-v2-plan.md H.5, out of scope for WS2 T3.1.',
  },
  {
    lang: 'de', input: 'Die Grüße waren schön, aber die Straße war groß und weiß',
    note: 'real sentence, ß (lowercase) + umlauts + comma punctuation',
    classes: ['eszett', 'accented-vowel', 'punctuation', 'real-sentence'],
  },
  {
    lang: 'de', input: "Hallo, wie geht's?", note: "word-internal apostrophe in colloquial German (geht's)",
    classes: ['apostrophe', 'punctuation'],
    notDetermined: '"geht\'s" -> ["geht","s"] — same generic apostrophe-strip behavior as the es/fr ' +
      'cases above (canonicalize() has no German-specific apostrophe handling either). NOT DETERMINED ' +
      'whether this is a real gap for de colloquial text specifically.',
  },

  // -- Portuguese ---------------------------------------------------------------
  { lang: 'pt', input: 'ação', note: 'ç + ã, single word', classes: ['cedilla', 'nasal-vowel'] },
  { lang: 'pt', input: 'não', note: 'ã, single word', classes: ['nasal-vowel'] },
  { lang: 'pt', input: 'razões', note: 'õ, single word', classes: ['nasal-vowel'] },
  {
    lang: 'pt', input: 'guarda-chuva', note: 'hyphenated compound (both parts well-formed words)',
    classes: ['hyphenated-compound'],
  },
  {
    lang: 'pt', input: '«Olá, tudo bem?»', note: 'punctuation: guillemets + comma + trailing question mark',
    classes: ['punctuation'],
  },
  {
    lang: 'pt', input: '3 gatos', note: 'digit token inside a pt phrase',
    classes: ['digits'],
    knownLossy: 'Same digitTokenToWords gap as the es/fr/de cases above — "3" -> "three" (English ' +
      'word), not "três". sync-pipeline-v2-plan.md H.5, out of scope for WS2 T3.1.',
  },
  {
    lang: 'pt', input: 'A informação sobre a construção não é fácil de entender',
    note: 'real sentence, ç/ã/õ family + accented vowels', classes: ['cedilla', 'nasal-vowel', 'accented-vowel', 'real-sentence'],
  },
  {
    lang: 'pt', input: "d'água", note: 'word-internal apostrophe (real Portuguese elision-like contraction, e.g. "copo d\'água")',
    classes: ['apostrophe', 'accented-vowel'],
    notDetermined: '"d\'água" -> ["d","água"] — same generic apostrophe-strip behavior as the other ' +
      'language cases above. NOT DETERMINED whether this is a real gap for pt text specifically.',
  },
];

// Coverage cross-check — fails loudly if a required class has no corpus case
// for a given language, rather than trusting the list above to stay complete.
const REQUIRED_CLASSES_PER_LANG: Record<Lang, string[]> = {
  es: ['accented-vowel', 'enye', 'hyphenated-compound', 'punctuation', 'digits'],
  fr: ['accented-vowel', 'cedilla', 'hyphenated-compound', 'punctuation', 'digits'],
  de: ['accented-vowel', 'eszett', 'hyphenated-compound', 'punctuation', 'digits'],
  pt: ['accented-vowel', 'cedilla', 'nasal-vowel', 'hyphenated-compound', 'punctuation', 'digits'],
};
for (const [lang, required] of Object.entries(REQUIRED_CLASSES_PER_LANG) as [Lang, string[]][]) {
  for (const needle of required) {
    if (!CORPUS.some(c => c.lang === lang && c.classes.includes(needle))) {
      throw new Error(`fixture corpus is missing required coverage: ${lang}/${needle}`);
    }
  }
}

// -- drive the TS module directly, no pipeline -------------------------------

interface FixtureEntry {
  language: Lang;
  input: string;
  note: string;
  /** canonicalize(input, language) — the real threaded-language behavior, LOCKED. */
  tokens: string[];
  /** canonicalize(input, undefined). */
  tokensUndefined: string[];
  /** canonicalize(input, 'en'). */
  tokensEn: string[];
  /** Whether tokensUndefined and tokensEn are byte-identical for this input —
   *  the identity that underpins the entire language-threading change. Always
   *  true in a committed fixture (the generator throws before writing if not). */
  undefinedEqualsEn: boolean;
  /** Non-null iff current behavior for `tokens` is measurably lossy relative
   *  to the input's real content — the fixture locks the lossy output as
   *  expected, and this field names the loss + owning task. Never fixed here. */
  knownLossy: string | null;
  /** Non-null iff `tokens` looks like it could be a defect but this step has
   *  no way to confirm intent — recorded, not fixed, not judged. */
  notDetermined: string | null;
}

const entries: FixtureEntry[] = CORPUS.map(({ lang, input, note, knownLossy, notDetermined }) => {
  const tokens = canonicalize(input, lang);
  const tokensUndefined = canonicalize(input, undefined);
  const tokensEn = canonicalize(input, 'en');
  const undefinedEqualsEn = JSON.stringify(tokensUndefined) === JSON.stringify(tokensEn);
  if (!undefinedEqualsEn) {
    throw new Error(
      `undefined !== 'en' for ${lang} input ${JSON.stringify(input)}: ` +
      `undefined=${JSON.stringify(tokensUndefined)} en=${JSON.stringify(tokensEn)} — ` +
      `this identity is the whole point of this step's undefined-equals-en check; stopping ` +
      `rather than writing a fixture that silently contradicts it.`,
    );
  }
  return {
    language: lang,
    input,
    note,
    tokens,
    tokensUndefined,
    tokensEn,
    undefinedEqualsEn,
    knownLossy: knownLossy ?? null,
    notDetermined: notDetermined ?? null,
  };
});

const fixture = {
  _generatedBy: 'scripts/generate-canonicalize-conformance-fixture.ts (run via `npx tsx`) — ' +
    'driven from src/services/textNormalize.ts\'s canonicalize(), directly, not through the sync ' +
    'pipeline. Locks CURRENT behavior, not desired behavior — see knownLossy/notDetermined per entry.',
  entries,
};

const outPath = resolve(REPO, 'scripts', 'fixtures', 'canonicalize-conformance-fixture.json');
const json = JSON.stringify(fixture, null, 2);
writeFileSync(outPath, json + '\n');

const bytes = Buffer.byteLength(json, 'utf-8');
console.log(`Wrote ${entries.length} entries (${bytes} bytes) to ${outPath}`);
if (bytes > 512 * 1024) {
  throw new Error(`fixture exceeds 512 KB cap: ${bytes} bytes`);
}
