/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// ---------------------------------------------------------------------------
// Transcript token -> canonical words, with AMOUNT groups merged first.
//
// An engine may split one written amount across several transcript tokens:
//   cloud (faster-whisper words):  "$11"  ",000."
//   local (whisper.cpp -ml 1):     "$"  "11"  ","  "000"  "."
// Canonicalizing each token alone reads them as unrelated fragments
// ("eleven dollars" + "zero"), which can never line up with the script's
// "$11,000" ("eleven thousand dollars"). This module finds those runs, reads
// each run as ONE amount (the same `canonicalize` amount path the script side
// takes), and hands the resulting words back spread across the run's own
// token indices — so a matched span still runs from the run's first token to
// its last, and every downstream reader (matcher, chunk plan, boundary snap)
// keeps working in ordinary token indices.
//
// Grouping is by TEXT shape only — never by timestamps (identity is never
// decided by distance; CLAUDE.md §5). Every candidate run must pass the same
// `parseAmountToken` grammar the script side uses, or it is not merged; a
// standalone "." between digit tokens is never merged (it is far more often a
// sentence end: "in 2003." "5 people"). Non-amount tokens expand exactly as
// before, so text without amounts is byte-identical.
// ---------------------------------------------------------------------------

import { canonicalize } from './textNormalize';
import { AMOUNT_CURRENCY_SYMBOLS, parseAmountToken, type FaLanguageCode } from './faTextNormalize';

/** A merged run of >= 2 tokens that together spell ONE amount. */
export interface AmountGroup {
  /** First member token index. */
  start: number;
  /** Last member token index (inclusive). */
  end: number;
  /** The members' text, concatenated ("$11,000."). */
  text: string;
}

export interface TranscriptWord {
  word: string;
  tokenIdx: number;
  /** The OWNING token's start — a token's internal words have no finer stamp. */
  startSec: number;
}

const SYMBOL_ONLY = /^[$€£]$/;
const NUMERIC_HEAD = /^[$€£]?\d[\d.,]*%?[.,;:!?)"”’]*$/;
const SEPARATED_TRIPLE = /^[,.]\d{3}[.,;:!?)"”’]*$/;
const TRIPLE = /^\d{3}[.,;:!?)"”’]*$/;
const EDGE_PUNCT = new Set(['.', ',', ';', ':', '?', '!', '"', '”', '’', '(', ')', '«', '»']);

function stripEdges(s: string): string {
  let a = 0;
  let b = s.length;
  while (a < b && EDGE_PUNCT.has(s[a]!)) a++;
  while (b > a && EDGE_PUNCT.has(s[b - 1]!)) b--;
  return s.slice(a, b);
}

/** True for a token that continues no sentence: "11." ends one. */
function endsSentence(s: string): boolean {
  return /[.;:!?)"”’]$/.test(s);
}

/**
 * Every multi-token amount run in `tokens`, in order. `languageCode` picks the
 * separator convention (en: "," thousands; es/fr/de/pt: "." thousands) the
 * validation uses; default English, like `canonicalize`.
 */
export function findAmountGroups(
  tokens: ReadonlyArray<{ text: string }>,
  languageCode: FaLanguageCode = 'en',
): AmountGroup[] {
  const text = tokens.map(t => (t.text ?? '').trim());
  const groups: AmountGroup[] = [];
  let i = 0;
  while (i < text.length) {
    const t = text[i]!;
    let cur: string;
    let j = i;
    if (SYMBOL_ONLY.test(t) && i + 1 < text.length && NUMERIC_HEAD.test(text[i + 1]!)) {
      cur = t + text[i + 1]!;
      j = i + 1;
    } else if (NUMERIC_HEAD.test(t)) {
      cur = t;
    } else {
      i++;
      continue;
    }

    for (;;) {
      const next = text[j + 1];
      if (next === undefined || endsSentence(cur)) break;
      if (SEPARATED_TRIPLE.test(next)) {
        cur += next;
        j++;
        continue;
      }
      const after = text[j + 2];
      if (next === ',' && after !== undefined && TRIPLE.test(after)) {
        cur += next + after;
        j += 2;
        continue;
      }
      if (next === '%' && !cur.includes('%')) {
        cur += next;
        j++;
      } else if (SYMBOL_ONLY.test(next) && !AMOUNT_CURRENCY_SYMBOLS.has(cur[0]!)) {
        cur += next;
        j++;
      }
      break;
    }

    if (j > i && parseAmountToken(stripEdges(cur).toLowerCase(), languageCode) !== undefined) {
      groups.push({ start: i, end: j, text: cur });
      i = j + 1;
    } else {
      i++;
    }
  }
  return groups;
}

/**
 * Canonical words for a token stream, in token order, with amount runs read as
 * one amount and their words spread first-word -> first member token,
 * last-word -> last member token. Also returns which token indices sit inside
 * a merged run (`groupedTokenIdx`), so a caller can keep a fragment of an
 * amount from being treated as a stand-alone anchor word.
 */
export function expandTokensToWords(
  tokens: ReadonlyArray<{ text: string; startSec?: number }>,
  languageCode?: FaLanguageCode,
): { words: TranscriptWord[]; groupedTokenIdx: ReadonlySet<number> } {
  const groups = findAmountGroups(tokens, languageCode ?? 'en');
  const groupAt = new Map<number, AmountGroup>();
  const grouped = new Set<number>();
  for (const g of groups) {
    groupAt.set(g.start, g);
    for (let k = g.start; k <= g.end; k++) grouped.add(k);
  }

  const words: TranscriptWord[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const g = groupAt.get(i);
    if (g) {
      const groupWords = canonicalize(g.text, languageCode).filter(w => w.length > 0);
      const members = g.end - g.start + 1;
      for (let w = 0; w < groupWords.length; w++) {
        const member = groupWords.length === 1
          ? 0
          : Math.round((w * (members - 1)) / (groupWords.length - 1));
        const idx = g.start + member;
        words.push({ word: groupWords[w]!, tokenIdx: idx, startSec: tokens[idx]!.startSec ?? 0 });
      }
      i = g.end;
      continue;
    }
    for (const word of canonicalize(tokens[i]!.text, languageCode)) {
      if (word.length > 0) words.push({ word, tokenIdx: i, startSec: tokens[i]!.startSec ?? 0 });
    }
  }
  return { words, groupedTokenIdx: grouped };
}

/**
 * True for a punctuation-only "," token that is the thousands separator inside
 * an amount ("$" "11" "," "000"). `filterMalformedTokens` would otherwise drop
 * it as empty text — and with it the only evidence that "11" "000" is 11,000
 * rather than two numbers. `prev`/`next` are the raw neighbours.
 */
export function isAmountSeparatorToken(
  text: string,
  prev: { text: string } | undefined,
  next: { text: string } | undefined,
): boolean {
  if (text.trim() !== ',') return false;
  if (!prev || !next) return false;
  return /^[$€£]?\d{1,3}$/.test(prev.text.trim()) && /^\d{3}[.,;:!?)"”’]*$/.test(next.text.trim());
}
