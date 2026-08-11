/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// ---------------------------------------------------------------------------
// Forced-alignment vocab-aware text normalizer (Phase 3b groundwork, R-Q,
// `docs/history.md` 2026-08-12).
//
// Maps script text to a per-language CTC character vocabulary for the five
// models WS1 will actually ship — `jonatasgrosman/wav2vec2-large-xlsr-53-
// {en,es,fr,de,pt}` (R-Q; MMS-FA is barred by Decision 3). Pure, synchronous,
// no I/O: the caller supplies the vocab (e.g. built from
// `scripts/fixtures/fa-vocab-<lang>.json`'s committed `vocab` object via
// `vocabCharsFromRawVocab` below) — this module never reads a file itself, so
// it stays usable from a worker or a native/Rust FFI boundary later without
// carrying a filesystem dependency. NOT wired into Apply Sync — no caller yet.
//
// DELIBERATELY PARALLEL to `textNormalize.ts`'s `canonicalize`, not built on
// top of it, and `canonicalize`/`stripStageDirections` are untouched by this
// module. `canonicalize` targets Whisper/Hirschberg alignment: it expands
// contractions and digits into words and ASCII-folds toward the alignment
// scoring the golden-baseline replay already locks in — changing any of that
// would move established baselines (`CLAUDE.md` Testing invariant). This
// module targets a downstream CTC acoustic model with a fixed, small,
// per-language character set that INCLUDES native diacritics `canonicalize`
// would fold away (é, ñ, ß, ç, ...) — the opposite instinct from ASCII
// alignment-folding. Sharing a helper between the two is a possible future
// refactor, not this one.
// ---------------------------------------------------------------------------

export type FaLanguageCode = 'en' | 'es' | 'fr' | 'de' | 'pt';

/** One normalized word (or the reason it couldn't be). */
export interface FaWordResult {
  /** The original whitespace-delimited slice, before any mapping. */
  input: string;
  representable: boolean;
  /** Present iff `representable` — every character here is a vocab member. */
  mapped?: string;
  /** Present iff NOT `representable` — why this word was dropped. */
  reason?: string;
}

export interface FaNormalizeResult {
  /** One entry per whitespace-delimited word in the input, in order. */
  words: FaWordResult[];
  /** Representable words' `mapped` text, single-space-joined. Unrepresentable
   *  words are dropped, never partially mangled — see `words[i].reason`. */
  text: string;
}

/** Vocab-JSON entries that are CTC bookkeeping tokens, not literal spellable
 *  characters — `|` is wav2vec2's word-delimiter token, not a printable pipe. */
const NON_CHARACTER_VOCAB_TOKENS = new Set(['<pad>', '<s>', '</s>', '<unk>', '|']);

const DIGIT_RE = /[0-9]/;

/** Zero-width/invisible characters — stripped wherever they occur in a token
 *  (copy-paste artifacts, not meaningful word content): zero-width space,
 *  zero-width non-joiner/joiner, BOM/zero-width no-break space, word joiner. */
const ZERO_WIDTH_RE = /[​‌‍﻿⁠]/g;

/** Word-boundary punctuation: stripped from a token's leading/trailing edges
 *  only (never word-internal) — it isn't part of the word at all, just
 *  sentence/clause punctuation glued on by whitespace-only splitting. */
const BOUNDARY_STRIP_CHARS = new Set(['.', ',', ';', ':', '?', '!', '"', '«', '»', '(', ')']);

/** Typographic variant -> ASCII target. FOLD is distinct from STRIP: a fold
 *  substitutes a character in place (preserving the word as one token),
 *  applied wherever the variant appears in the token, not just at edges.
 *  Whether a given fold actually happens is vocab-dependent (checked at call
 *  time in `foldTypographicVariants`): if the target isn't a member of the
 *  target vocab, the source character is dropped instead of being folded in
 *  as a still-unrepresentable substitute — a fold degrades to a deletion,
 *  never to an unrepresentable-vocab character. */
const FOLD_TARGETS: Record<string, string> = {
  '‘': "'", // LEFT SINGLE QUOTATION MARK
  '’': "'", // RIGHT SINGLE QUOTATION MARK
  'ʼ': "'", // MODIFIER LETTER APOSTROPHE
  '‐': '-', // HYPHEN
  '‑': '-', // NON-BREAKING HYPHEN
  '–': '-', // EN DASH
  '—': '-', // EM DASH
  '“': '"', // LEFT DOUBLE QUOTATION MARK
  '”': '"', // RIGHT DOUBLE QUOTATION MARK
  '„': '"', // DOUBLE LOW-9 QUOTATION MARK
  '‟': '"', // DOUBLE HIGH-REVERSED-9 QUOTATION MARK
};

/** Removes zero-width characters anywhere in the token. */
function stripZeroWidth(word: string): string {
  return word.replace(ZERO_WIDTH_RE, '');
}

/** Substitutes each typographic variant found anywhere in the token for its
 *  ASCII target, but only when the target is actually a member of this
 *  language's vocab — otherwise the variant is dropped (strip, not fold). */
function foldTypographicVariants(word: string, vocabChars: ReadonlySet<string>): string {
  let out = '';
  for (const ch of word) {
    const target = FOLD_TARGETS[ch];
    if (target === undefined) {
      out += ch;
    } else if (vocabChars.has(target)) {
      out += target;
    }
    // else: fold target absent from vocab — drop the character entirely.
  }
  return out;
}

/** Strips `BOUNDARY_STRIP_CHARS` from a token's leading/trailing edges only,
 *  repeatedly, so stacked marks (e.g. a quote-and-comma pair) fully clear. */
function stripBoundaryPunctuation(word: string): string {
  let start = 0;
  let end = word.length;
  while (start < end && BOUNDARY_STRIP_CHARS.has(word[start]!)) start++;
  while (end > start && BOUNDARY_STRIP_CHARS.has(word[end - 1]!)) end--;
  return word.slice(start, end);
}

/**
 * Derives the set of literal, spellable characters from a model's raw
 * `vocab.json` object (as committed verbatim in `scripts/fixtures/
 * fa-vocab-<lang>.json`'s `vocab` field) — i.e. every key except the CTC
 * special/delimiter tokens above.
 */
export function vocabCharsFromRawVocab(rawVocab: Readonly<Record<string, number>>): Set<string> {
  const chars = new Set<string>();
  for (const key of Object.keys(rawVocab)) {
    if (NON_CHARACTER_VOCAB_TOKENS.has(key)) continue;
    chars.add(key);
  }
  return chars;
}

/** German's vocab has no `ß` (spike G1) — the standard `ß` -> `ss` expansion
 *  is applied before the vocab-membership check, not treated as an
 *  unrepresentable character. Applied only for `de`; a no-op otherwise. */
function applyLanguageSpecificSubstitutions(word: string, languageCode: FaLanguageCode): string {
  return languageCode === 'de' ? word.replace(/ß/g, 'ss') : word;
}

/** Normalizes one already-whitespace-isolated word: NFC + lowercase, the
 *  German ß->ss substitution, zero-width stripping, typographic folding,
 *  boundary-punctuation stripping, then a digit check and a per-character
 *  vocab membership check. A word surviving fold+strip with any character
 *  still absent from the vocab is unrepresentable — dropped and recorded,
 *  never partially mangled. */
function normalizeWord(
  rawWord: string,
  languageCode: FaLanguageCode,
  vocabChars: ReadonlySet<string>,
): FaWordResult {
  const lowered = rawWord.normalize('NFC').toLowerCase();
  const substituted = applyLanguageSpecificSubstitutions(lowered, languageCode);
  const dezeroWidthed = stripZeroWidth(substituted);
  const folded = foldTypographicVariants(dezeroWidthed, vocabChars);
  const stripped = stripBoundaryPunctuation(folded);

  if (stripped.length === 0) {
    return {
      input: rawWord,
      representable: false,
      reason: `reduced to nothing by fold/strip — no word content remained (word: "${rawWord}")`,
    };
  }

  if (DIGIT_RE.test(stripped)) {
    return {
      input: rawWord,
      representable: false,
      reason: `contains a digit — number expansion is Phase 3b, out of scope (word: "${rawWord}")`,
    };
  }

  for (const ch of stripped) {
    if (!vocabChars.has(ch)) {
      return {
        input: rawWord,
        representable: false,
        reason: `character "${ch}" is not in the ${languageCode} vocab (word: "${rawWord}")`,
      };
    }
  }

  return { input: rawWord, representable: true, mapped: stripped };
}

/**
 * Normalizes a word or whitespace-separated phrase against one language's CTC
 * vocab. `vocabChars` is the set from `vocabCharsFromRawVocab` (or an
 * equivalent hand-built set) for `languageCode` — this function does not
 * validate that the two agree, since the caller owns that pairing.
 */
export function normalizeForForcedAlignment(
  input: string,
  languageCode: FaLanguageCode,
  vocabChars: ReadonlySet<string>,
): FaNormalizeResult {
  const rawWords = input.split(/\s+/).filter(w => w.length > 0);
  const words = rawWords.map(w => normalizeWord(w, languageCode, vocabChars));
  const text = words
    .filter((w): w is FaWordResult & { mapped: string } => w.representable)
    .map(w => w.mapped)
    .join(' ');
  return { words, text };
}
