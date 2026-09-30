/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// ---------------------------------------------------------------------------
// Shared TS / Rust / Python lockstep corpus for AMOUNT normalization.
//
// Drives `src/services/faTextNormalize.ts` (with the language's real vocab,
// cardinal data and amount words, exactly as `loadFaLanguageData` supplies
// them) over a fixed corpus and writes `scripts/fixtures/fa-amount-lockstep.json`.
// Three independent test suites read that ONE file and must reproduce it
// byte-for-byte: `src/services/faAmountLockstep.test.ts` (TS, plus hand-written
// expectations that do not come from this generator), `src-tauri/src/fa/text.rs`
// (`amount_lockstep`) and `cloud/test_fa_amount_lockstep.py`. Same pattern as
// `generate-fa-text-fixture.ts` / `fa-text-normalize-fixture.json`.
//
// Run via `npx tsx scripts/generate-fa-amount-lockstep.ts`. Re-run and commit
// the diff only when the corpus or the amount rules are deliberately changed,
// then port the same change to text.rs and fa_engine.py — never regenerate
// just to silence a failing side.
// ---------------------------------------------------------------------------

import { writeFileSync } from 'fs';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import { normalizeForForcedAlignment, type FaLanguageCode } from '../src/services/faTextNormalize';
import { loadFaLanguageData } from '../src/services/faLanguageData';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');

interface Case { lang: FaLanguageCode; input: string; note: string }

export const AMOUNT_LOCKSTEP_CASES: Case[] = [
  // -- the defect that started this (14-segment "3. Voiceover.mp3") --------
  { lang: 'en', input: '$11,000.', note: 'currency + thousands separator + trailing period' },
  { lang: 'en', input: '$9,400', note: 'currency + thousands separator' },
  { lang: 'en', input: 'you have in your savings account $11,000.', note: 'scene 3 chunk text: the amount must be present' },
  { lang: 'en', input: 'you pay $9,400 in cash.', note: 'scene 13 chunk text: the amount must be present' },
  { lang: 'en', input: '84,000', note: 'thousands separator, no symbol' },
  // -- magnitude: no digit-by-digit cap -------------------------------------
  { lang: 'en', input: '11000', note: 'bare integer above the old 9999 cap' },
  { lang: 'en', input: '$11000', note: 'currency, no separator' },
  { lang: 'en', input: '€1,234,567', note: 'millions, euro' },
  { lang: 'en', input: '£3', note: 'pound, plural' },
  { lang: 'en', input: '$1', note: 'currency singular form (exactly one, no decimals)' },
  { lang: 'en', input: '$1.00', note: 'decimals => plural form even at one' },
  // -- decimals / percent -----------------------------------------------------
  { lang: 'en', input: '2.5', note: 'decimal' },
  { lang: 'en', input: '$5.99', note: 'currency + decimal' },
  { lang: 'en', input: '0.05', note: 'decimal, zero integer part' },
  { lang: 'en', input: '50%', note: 'percent' },
  { lang: 'en', input: '(50%)', note: 'percent inside edge punctuation' },
  { lang: 'en', input: '$1998', note: 'money is never read as a year' },
  // -- bare integers are UNCHANGED --------------------------------------------
  { lang: 'en', input: '2001', note: 'bare year-shaped integer keeps the year reading' },
  { lang: 'en', input: '2003', note: 'bare year-shaped integer keeps the cardinal reading (03 < 10)' },
  { lang: 'en', input: '10', note: 'bare integer' },
  // -- not an amount: unchanged (dropped) ---------------------------------------
  { lang: 'en', input: '$', note: 'lone symbol is not an amount' },
  { lang: 'en', input: '1,5', note: 'comma decimal is not English amount grammar' },
  { lang: 'en', input: '1234,567', note: 'malformed thousands grouping' },
  { lang: 'en', input: '$007', note: 'leading zero is not an amount' },
  { lang: 'en', input: '50%%', note: 'malformed percent' },
  // -- the other four languages ---------------------------------------------------
  { lang: 'es', input: '$11.000', note: 'es: "." thousands, dollars' },
  { lang: 'es', input: '1.234,56', note: 'es: thousands + decimal' },
  { lang: 'es', input: '15%', note: 'es: percent (two words)' },
  { lang: 'es', input: '€1', note: 'es: euro singular' },
  { lang: 'es', input: '12', note: 'es: bare integer unchanged' },
  { lang: 'fr', input: '84.000', note: 'fr: hyphenated cardinal + thousands' },
  { lang: 'fr', input: '$1', note: 'fr: dollar singular' },
  { lang: 'fr', input: '50%', note: 'fr: percent' },
  { lang: 'fr', input: '1.234,5', note: 'fr: thousands + decimal' },
  { lang: 'de', input: '1.234.567', note: 'de: millions (capitalized scale word in the data must lowercase)' },
  { lang: 'de', input: '€30', note: 'de: euro' },
  { lang: 'de', input: '3,5', note: 'de: decimal' },
  { lang: 'de', input: '30%', note: 'de: percent' },
  { lang: 'pt', input: '$11.000,50', note: 'pt: full amount' },
  { lang: 'pt', input: '12.345', note: 'pt: thousands, no symbol' },
  { lang: 'pt', input: '€1', note: 'pt: euro singular' },
  // -- standalone symbol tokens: %, &, @ read as the language's spoken word ------
  { lang: 'en', input: '%', note: 'standalone percent sign' },
  { lang: 'en', input: '&', note: 'standalone ampersand' },
  { lang: 'en', input: '@', note: 'standalone at-sign' },
  { lang: 'en', input: 'up 50 % on rock & roll @ home', note: 'symbols inside a phrase, next to a bare integer' },
  { lang: 'en', input: '(&),', note: 'symbol inside edge punctuation is still standalone' },
  { lang: 'en', input: 'AT&T', note: 'symbol inside a longer token is NOT standalone (unchanged: dropped)' },
  { lang: 'en', input: '@user', note: 'leading @ on a handle is NOT standalone (unchanged: dropped)' },
  { lang: 'es', input: '%', note: 'es: two-word percent' },
  { lang: 'es', input: '&', note: 'es: y' },
  { lang: 'fr', input: '@', note: 'fr: arobase' },
  { lang: 'de', input: '&', note: 'de: und' },
  { lang: 'de', input: '%', note: 'de: prozent' },
  { lang: 'pt', input: '@', note: 'pt: arroba' },
  { lang: 'pt', input: '%', note: 'pt: por cento' },
  // -- bare integers in the language's own words (the matcher's canonicalize reads these identically) --
  { lang: 'de', input: '3', note: 'de: bare integer (script "3" vs spoken "drei")' },
  { lang: 'fr', input: '21', note: 'fr: bare integer, hyphenated reading' },
  { lang: 'pt', input: '2024', note: 'pt: bare year-shaped integer' },
  { lang: 'es', input: '1998', note: 'es: bare year-shaped integer' },
];

const out = AMOUNT_LOCKSTEP_CASES.map(c => {
  const data = loadFaLanguageData(c.lang)!;
  const r = normalizeForForcedAlignment(c.input, c.lang, data.vocabChars, data.cardinalData);
  return {
    language: c.lang,
    input: c.input,
    note: c.note,
    words: r.words.map(w => ({ input: w.input, representable: w.representable, mapped: w.mapped ?? null })),
    text: r.text,
  };
});

writeFileSync(
  resolve(REPO, 'scripts', 'fixtures', 'fa-amount-lockstep.json'),
  JSON.stringify({
    _generatedBy: 'scripts/generate-fa-amount-lockstep.ts (drives src/services/faTextNormalize.ts)',
    _read: 'TS: src/services/faAmountLockstep.test.ts; Rust: src-tauri/src/fa/text.rs amount_lockstep; Python: cloud/test_fa_amount_lockstep.py. Compared: per-word representable + mapped, and the joined chunk text. Reason strings are NOT compared (each side words its own).',
    entries: out,
  }, null, 2) + '\n',
);
console.log(`wrote ${out.length} entries`);
