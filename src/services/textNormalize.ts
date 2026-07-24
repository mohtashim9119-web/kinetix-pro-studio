/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// ---------------------------------------------------------------------------
// Unified text normalizer (architecture doc §3.2, R1 — closes G4).
//
// One canonical pipeline replaces the former two-normalizer split (the
// filename-path `normalizeForMatch` and the timing-path
// `canonicalizeForAlignment`). Both call sites now share the same Unicode-
// hygiene primitives so they can never drift on that layer again:
//
//   - canonicalize(text)          -> string[]  — the full alignment tokenizer
//   - canonicalizeForFilename(text)-> string   — filename comparison (no
//                                    lowercasing, no contraction expansion, no
//                                    digit reading; behavior identical to the
//                                    old normalizeForMatch)
//
// The alignment pipeline's exact operation order (doc §3.2 (b)):
//   1  NFC normalize                       (S2)
//   2  lowercase
//   3  apostrophe fold  [‘’ʼ'] -> '        (superset of both old functions)
//   4  contraction expansion
//   5  thousands-separator strip between digits
//   6  decimal -> "point" reading
//   7  currency/symbol map  $ % & @
//   8  zero-width/BOM/directional removal, JOIN semantics (deleted, not spaced) (S1)
//   9  en/em dash -> '-'; smart double-quotes -> '"'
//  10  strip remaining non-alphanumeric to space, PRESERVING the hyphen
//  11  whitespace tokenize
//  12  per-token hyphen resolution with the NUMBER_WORDS carve-out (R1)
//  13  per-token digit-run expansion
//
// Steps 1, 3, 8, 9 are the shared Unicode-hygiene primitives (foldUnicodeHygiene);
// canonicalizeForFilename runs exactly those (matching the old normalizeForMatch).
// ---------------------------------------------------------------------------

import { NUMBER_WORDS } from './syncConstants';

// --- Number-word expansion (unchanged from the former whisperService.ts home) --

const ONES_WORDS = [
  'zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight',
  'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen',
  'sixteen', 'seventeen', 'eighteen', 'nineteen',
];
const TENS_WORDS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];

function under100ToWords(n: number): string[] {
  if (n < 20) return [ONES_WORDS[n]!];
  const t = Math.floor(n / 10);
  const o = n % 10;
  return o === 0 ? [TENS_WORDS[t]!] : [TENS_WORDS[t]!, ONES_WORDS[o]!];
}

function under1000ToWords(n: number): string[] {
  if (n < 100) return under100ToWords(n);
  const h = Math.floor(n / 100);
  const r = n % 100;
  const words = [ONES_WORDS[h]!, 'hundred'];
  if (r > 0) words.push(...under100ToWords(r));
  return words;
}

/** Cardinal reading for 0–9999 (callers guarantee the range). */
function cardinalToWords(n: number): string[] {
  if (n < 1000) return under1000ToWords(n);
  const th = Math.floor(n / 1000);
  const r = n % 1000;
  const words = [...under1000ToWords(th), 'thousand'];
  if (r > 0) words.push(...under1000ToWords(r));
  return words;
}

/** Pair reading for a 4-digit year, e.g. 2024 -> "twenty twenty four". */
function yearToWords(n: number): string[] {
  const high = Math.floor(n / 100);
  const low = n % 100;
  return [...under100ToWords(high), ...under100ToWords(low)];
}

/** Expands a pure-digit token to its canonical spoken word sequence. */
function digitTokenToWords(tok: string): string[] {
  const n = Number.parseInt(tok, 10);
  if (!Number.isFinite(n)) return [tok];
  if (tok.length === 4 && n >= 1100 && n <= 2999 && n % 100 >= 10) {
    return yearToWords(n);
  }
  if (n >= 0 && n <= 9999) return cardinalToWords(n);
  return tok.split('').map(d => ONES_WORDS[Number(d)] ?? d);
}

// --- Contractions -----------------------------------------------------------

const CONTRACTIONS: Record<string, string> = {
  "don't": 'do not', "doesn't": 'does not', "didn't": 'did not',
  "isn't": 'is not', "aren't": 'are not', "wasn't": 'was not',
  "weren't": 'were not', "haven't": 'have not', "hasn't": 'has not',
  "hadn't": 'had not', "won't": 'will not', "wouldn't": 'would not',
  "can't": 'cannot', "couldn't": 'could not', "shouldn't": 'should not',
  "mustn't": 'must not', "needn't": 'need not',
  "it's": 'it is', "that's": 'that is', "there's": 'there is',
  "here's": 'here is', "he's": 'he is', "she's": 'she is',
  "what's": 'what is', "who's": 'who is', "let's": 'let us',
  "i'm": 'i am', "you're": 'you are', "we're": 'we are', "they're": 'they are',
  "i've": 'i have', "you've": 'you have', "we've": 'we have',
  "they've": 'they have', "i'll": 'i will', "you'll": 'you will',
  "he'll": 'he will', "she'll": 'she will', "we'll": 'we will',
  "they'll": 'they will', "i'd": 'i would', "you'd": 'you would',
  "he'd": 'he would', "she'd": 'she would', "we'd": 'we would',
  "they'd": 'they would',
};

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Longest keys first so a longer contraction can't be partially eaten; the
// letter/digit lookarounds keep a contraction inside a larger token untouched.
const CONTRACTION_RE = new RegExp(
  '(?<![a-z0-9])(' +
    Object.keys(CONTRACTIONS)
      .sort((a, b) => b.length - a.length)
      .map(escapeRegExp)
      .join('|') +
    ')(?![a-z0-9])',
  'g',
);

// --- Shared Unicode-hygiene primitives (steps 1, 3, 8, 9) -------------------

// Zero-width & directional marks removed with JOIN semantics (deleted, not
// replaced by a space) so an in-word artifact keeps word adjacency:
// "wor​ld" -> "world" (one token), not two. Superset of the old
// normalizeForMatch set (which stripped only U+200B and U+FEFF):
// U+200B ZWSP, U+200C ZWNJ, U+200D ZWJ, U+200E/U+200F directional marks, U+FEFF BOM.
const ZERO_WIDTH_RE = /[​‌‍‎‏﻿]/g;
// Curly/modifier apostrophes: U+2018, U+2019, U+02BC.
const APOSTROPHE_RE = /[‘’ʼ]/g;
// Smart double-quotes: U+201C, U+201D.
const SMART_QUOTE_RE = /[“”]/g;
// En/em dash: U+2013, U+2014.
const DASH_RE = /[–—]/g;

/**
 * The Unicode-hygiene layer both normalizers share: NFC, curly/modifier
 * apostrophe fold, smart double-quote fold, en/em dash -> hyphen, and
 * zero-width/BOM/directional removal (JOIN semantics). Deliberately does NOT
 * lowercase — the filename path preserves case (its callers lowercase
 * themselves), and the alignment path lowercases separately.
 */
export function foldUnicodeHygiene(s: string): string {
  return s
    .normalize('NFC')
    .replace(APOSTROPHE_RE, "'")
    .replace(SMART_QUOTE_RE, '"')
    .replace(DASH_RE, '-')
    .replace(ZERO_WIDTH_RE, '');
}

// --- Hyphen resolution + digit expansion (steps 12, 13) ---------------------

/**
 * R1 hyphen carve-out. A hyphenated token splits on its hyphens IFF every
 * sub-part is a number word or a digit run; otherwise a well-formed compound
 * keeps its hyphen as one token. Stray leading/trailing hyphens (empty
 * sub-parts) are treated as separators and dropped.
 */
function resolveHyphen(tok: string): string[] {
  if (!tok.includes('-')) return [tok];
  const parts = tok.split('-');
  const allNumberish = parts.every(
    p => p.length > 0 && (NUMBER_WORDS.has(p) || /^[0-9]+$/.test(p)),
  );
  if (allNumberish) return parts; // thirty-seven -> [thirty, seven]; 3-4 -> [3, 4]
  const wellFormed = parts.every(p => p.length > 0);
  if (wellFormed) return [tok]; // co-operate / twenty-first stay one token, hyphen intact
  return parts.filter(Boolean); // stray/edge hyphen: drop empties, keep the rest
}

/** Expands a resolved token's digit runs to words, emitting into `out`. */
function expandDigitsInto(tok: string, out: string[]): void {
  // A preserved hyphen-compound is one unit by design (co-operate, covid-19) —
  // emit it verbatim rather than letting the mixed-alnum split leak a stray hyphen.
  if (tok.includes('-')) {
    out.push(tok);
    return;
  }
  if (/^\d+$/.test(tok)) {
    out.push(...digitTokenToWords(tok));
    return;
  }
  if (/\d/.test(tok)) {
    // Mixed alnum token — a letter run glued to a digit run with no space (e.g.
    // "to97", produced when whisper.cpp's -ml 1 word-boundary heuristic fuses a
    // short function word onto a following number). Split into contiguous
    // digit / non-digit runs, expand each digit run through the cardinal path,
    // and emit the letter runs as their own words, preserving left-to-right order.
    const parts = tok.match(/\d+|\D+/g) ?? [tok];
    for (const part of parts) {
      if (/^\d+$/.test(part)) out.push(...digitTokenToWords(part));
      else out.push(part);
    }
    return;
  }
  out.push(tok);
}

// --- Public entry points ----------------------------------------------------

/**
 * The full alignment tokenizer (doc §3.2). Deterministic and applied
 * IDENTICALLY to both the scene-doc word side and the Whisper-token side, so a
 * spelled-out number ("thirty seven") and Whisper's digit output ("37") — or a
 * hyphenated compound and its glued form — collapse to the SAME word sequence,
 * and anything not covered here still normalizes symmetrically (a local diff
 * cost in the Hirschberg aligner, never an asymmetric desync).
 */
export function canonicalize(text: string): string[] {
  // Steps 1, 3, 8, 9 (shared primitive) then 2 (lowercase).
  let t = foldUnicodeHygiene(text).toLowerCase();

  // Step 4 — contraction expansion (apostrophes already folded to ASCII above).
  t = t.replace(CONTRACTION_RE, m => CONTRACTIONS[m] ?? m);

  // Step 5 — drop thousands separators between digits (11,000 -> 11000).
  t = t.replace(/(\d),(\d)/g, '$1$2');

  // Step 6 — decimals: "3.5" -> "3 point 5"; fractional digits kept single so
  // the per-token expansion reads them digit-by-digit ("three point five").
  t = t.replace(/(\d+)\.(\d+)/g, (_m, a: string, b: string) => ` ${a} point ${b.split('').join(' ')} `);

  // Step 7 — currency + spoken symbols.
  t = t.replace(/\$\s?(\d+)/g, ' $1 dollars '); // "$5" -> "5 dollars" (spoken order)
  t = t.replace(/\$/g, ' dollars ');            // bare "$" -> "dollars"
  t = t.replace(/%/g, ' percent ');
  t = t.replace(/&/g, ' and ');
  t = t.replace(/@/g, ' at ');

  // Step 10 — strip remaining non-alphanumeric to spaces, PRESERVING the hyphen
  // (co-operate must survive as one token; the R1 carve-out below decides split).
  t = t.replace(/[^a-z0-9\s-]/g, ' ');

  // Step 11 — whitespace tokenize.
  const rawTokens = t.split(/\s+/).filter(Boolean);

  // Steps 12 + 13 — hyphen resolution, then digit-run expansion per resolved token.
  const out: string[] = [];
  for (const tok of rawTokens) {
    for (const piece of resolveHyphen(tok)) {
      expandDigitsInto(piece, out);
    }
  }
  return out;
}

/**
 * Filename-comparison normalizer for the tag/asset-matching path. Runs ONLY
 * the shared Unicode-hygiene primitives — no lowercasing (callers lowercase
 * before comparing), no contraction expansion, no digit-as-word reading — so
 * its behavior is identical to the former `normalizeForMatch`, now sharing the
 * exact same NFC/apostrophe/quote/dash/zero-width layer as the aligner.
 */
export function canonicalizeForFilename(s: string): string {
  return foldUnicodeHygiene(s);
}

export { NUMBER_WORDS };
