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

// ---------------------------------------------------------------------------
// French elision (Part H.5 Rule 1, sync-pipeline-v2-plan.md:4083).
//
// DECISION (stated before implementation, per the byte-identical port
// requirement): an elided word (l'oiseau, l'homme, qu'il, ...) stays ONE
// token, never split at the apostrophe. Justification: neither this
// module's own whitespace split (`/\s+/`, see `normalizeForForcedAlignment`)
// nor its Rust port's `is_js_whitespace` treats apostrophe as a separator —
// an elided form was ALREADY one token before this rule (confirmed by the
// pre-existing fixture case "l'élève où était-il"). Splitting would insert a
// synthetic word-delimiter (the CTC `|` token, which the model was trained
// to expect at a genuine acoustic pause) between the elision prefix and its
// stem, where French speech has none — "l'oiseau" is pronounced as one
// continuous unit, not two words with a gap. One token is therefore both
// the existing architecture and the phonologically correct choice.
//
// What this rule actually ADDS: a straight apostrophe (already in every
// vocab) and a curly one (already generically folded by FOLD_TARGETS above)
// both already round-tripped correctly with zero code change. The one
// genuine gap is a GRAVE ACCENT (`, U+0060) used as an apostrophe typo/OCR
// substitute — plausible on keyboards where the two keys sit close together
// — which no existing fold covers. Recognizing it requires knowing this is
// actually an elision (prefix + apostrophe-like char + vowel-or-mute-h) so
// the fold can't misfire on unrelated backtick usage or on non-elision
// mid-word apostrophes (e.g. "aujourd'hui", a fixed compound, not
// productive elision). French-only (language-keyed, per H.5's own mandate)
// and elision-shape-gated by construction — it cannot touch English or any
// other non-matching word.
// ---------------------------------------------------------------------------

/** Elidable French forms, longest first so "qu'" isn't shadowed by a
 *  (nonexistent) single-letter "q" entry — kept explicit for clarity even
 *  though none of these prefixes share a first letter. */
const FRENCH_ELISION_PREFIXES = ['qu', 'l', 'd', 'j', 'n', 's', 't', 'm', 'c'];

/** Elision only applies before a vowel or a mute h (grammatically, elision
 *  never precedes a consonant or an aspirate h — and aspirate-h words are
 *  written unelided, e.g. "le hibou", so this module never has to tell the
 *  two kinds of h apart itself, only recognize the shape the source text
 *  already encodes). */
const FRENCH_ELISION_FOLLOWERS = new Set([
  'a', 'e', 'i', 'o', 'u', 'y', 'h',
  'à', 'â', 'ä', 'é', 'è', 'ê', 'ë', 'î', 'ï', 'ô', 'ö', 'ù', 'û', 'ü', 'œ',
]);

/** French-only: a backtick standing in for an apostrophe at a recognized
 *  elision boundary (prefix + backtick + vowel-or-mute-h) folds to the
 *  vocab's straight apostrophe, mirroring the fold-degrades-to-deletion
 *  contract used everywhere else in this module. A backtick anywhere else
 *  (wrong position, or not French) is left untouched — this is deliberately
 *  narrower than `FOLD_TARGETS` above, which folds its variants wherever
 *  they appear; this fold only fires on a genuine elision shape. */
function foldFrenchElisionBacktick(word: string, vocabChars: ReadonlySet<string>): string {
  if (!vocabChars.has("'")) return word;
  for (const prefix of FRENCH_ELISION_PREFIXES) {
    if (!word.startsWith(prefix)) continue;
    if (word[prefix.length] !== '`') continue;
    const follower = word[prefix.length + 1];
    if (follower === undefined || !FRENCH_ELISION_FOLLOWERS.has(follower)) continue;
    return word.slice(0, prefix.length) + "'" + word.slice(prefix.length + 1);
  }
  return word;
}

// ---------------------------------------------------------------------------
// Spanish cardinal numbers 0-30 (Part H.5 Rule 2, sync-pipeline-v2-plan.md:4074,
// scope narrowed per Slice 1 sign-off — docs/work-in-progress.md 2026-08-15).
//
// SCOPE: bare cardinal integers 0-30, Spanish only. Every one of these is a
// SINGLE Spanish orthographic word ("dieciséis", "veintitrés", "treinta") —
// from 31 on, Spanish requires a space-linked "y" compound ("treinta y
// uno"), which is one INPUT token expanding into MULTIPLE output words. That
// would break an invariant several `fa_onnx.rs` consumers already rely on
// (one `FaWordResult` <-> one CTC-aligned word — see `word_merge_e2e`/
// `words_per_chunk`), so 31-99, decimals, thousands separators, currency,
// percent, ordinals, negative numbers, and every language other than Spanish
// stay OUT OF SCOPE and continue to drop exactly as before this change.
// ---------------------------------------------------------------------------

/** Index `n` -> its Spanish spelling, for `n` in 0..=30. */
const SPANISH_CARDINALS_0_30: readonly string[] = [
  'cero', 'uno', 'dos', 'tres', 'cuatro', 'cinco', 'seis', 'siete', 'ocho', 'nueve',
  'diez', 'once', 'doce', 'trece', 'catorce', 'quince', 'dieciséis', 'diecisiete',
  'dieciocho', 'diecinueve', 'veinte', 'veintiuno', 'veintidós', 'veintitrés',
  'veinticuatro', 'veinticinco', 'veintiséis', 'veintisiete', 'veintiocho',
  'veintinueve', 'treinta',
];

/** `stripped` must be ENTIRELY digits, no leading zero (other than a bare
 *  "0"), no sign, no separators — anything else returns `undefined` and the
 *  caller falls through to the pre-existing digit-drop path unchanged. */
function expandSpanishCardinal(stripped: string): string | undefined {
  if (!/^[0-9]+$/.test(stripped)) return undefined;
  if (stripped.length > 1 && stripped[0] === '0') return undefined;
  const n = Number(stripped);
  if (n > 30) return undefined;
  return SPANISH_CARDINALS_0_30[n];
}

// ---------------------------------------------------------------------------
// German cardinal numbers 0-30 (Part H.5 Rule 3, Phase 3b remainder audit,
// 2026-08-15 — sync-pipeline-v2-plan.md's H.5 decision block).
//
// Found empirically (not from spec): German cardinal digits were dropped
// wholesale like every other language before this rule, but unlike Spanish
// German has NO structural wall at 30 — every German cardinal, arbitrarily
// large, is a single concatenated orthographic word ("einunddreißig",
// "zweihundertfünfzig", ...), so it never needs multi-word output and is
// unaffected by the permanent single-word-output decision (b). The cap at 30
// here is a deliberate SCOPE choice, not a structural one: a flat lookup
// table mirrors Rule 2's already-reviewed shape exactly, while numbers past
// 30 need algorithmic compound generation (hundreds/thousands rules), which
// is real design work deferred to a future slice, not a same-pattern
// extension.
//
// Values below are the PRE-substitution vocab-safe spelling (German vocab
// has no `ß` — spike G1, `applyLanguageSpecificSubstitutions` above) since
// `expandGermanCardinal`'s output bypasses that step entirely (it substitutes
// for `stripped`, which already ran through it on the ORIGINAL input, not on
// a freshly generated candidate): "dreissig", not "dreißig".
// ---------------------------------------------------------------------------

/** Index `n` -> its German spelling (bare-cardinal reading, e.g. "eins" not
 *  the adjectival "ein"), for `n` in 0..=30. */
const GERMAN_CARDINALS_0_30: readonly string[] = [
  'null', 'eins', 'zwei', 'drei', 'vier', 'fünf', 'sechs', 'sieben', 'acht', 'neun',
  'zehn', 'elf', 'zwölf', 'dreizehn', 'vierzehn', 'fünfzehn', 'sechzehn', 'siebzehn',
  'achtzehn', 'neunzehn', 'zwanzig', 'einundzwanzig', 'zweiundzwanzig', 'dreiundzwanzig',
  'vierundzwanzig', 'fünfundzwanzig', 'sechsundzwanzig', 'siebenundzwanzig',
  'achtundzwanzig', 'neunundzwanzig', 'dreissig',
];

/** `stripped` must be ENTIRELY digits, no leading zero (other than a bare
 *  "0"), no sign, no separators — anything else returns `undefined` and the
 *  caller falls through to the pre-existing digit-drop path unchanged.
 *  Mirrors `expandSpanishCardinal`'s contract exactly. */
function expandGermanCardinal(stripped: string): string | undefined {
  if (!/^[0-9]+$/.test(stripped)) return undefined;
  if (stripped.length > 1 && stripped[0] === '0') return undefined;
  const n = Number(stripped);
  if (n > 30) return undefined;
  return GERMAN_CARDINALS_0_30[n];
}

/** Normalizes one already-whitespace-isolated word: NFC + lowercase, the
 *  German ß->ss substitution, zero-width stripping, typographic folding,
 *  boundary-punctuation stripping, then (Spanish only) a bare-0-30-cardinal
 *  expansion, then a digit check and a per-character vocab membership
 *  check. A word surviving fold+strip with any character still absent from
 *  the vocab is unrepresentable — dropped and recorded, never partially
 *  mangled. */
function normalizeWord(
  rawWord: string,
  languageCode: FaLanguageCode,
  vocabChars: ReadonlySet<string>,
): FaWordResult {
  const lowered = rawWord.normalize('NFC').toLowerCase();
  const substituted = applyLanguageSpecificSubstitutions(lowered, languageCode);
  const elisionFolded = languageCode === 'fr'
    ? foldFrenchElisionBacktick(substituted, vocabChars)
    : substituted;
  const dezeroWidthed = stripZeroWidth(elisionFolded);
  const folded = foldTypographicVariants(dezeroWidthed, vocabChars);
  const stripped = stripBoundaryPunctuation(folded);

  if (stripped.length === 0) {
    return {
      input: rawWord,
      representable: false,
      reason: `reduced to nothing by fold/strip — no word content remained (word: "${rawWord}")`,
    };
  }

  const cardinalExpansion = languageCode === 'es'
    ? expandSpanishCardinal(stripped)
    : languageCode === 'de'
      ? expandGermanCardinal(stripped)
      : undefined;
  const candidate = cardinalExpansion ?? stripped;

  if (cardinalExpansion === undefined && DIGIT_RE.test(stripped)) {
    return {
      input: rawWord,
      representable: false,
      reason: `contains a digit — number expansion is Phase 3b, out of scope (word: "${rawWord}")`,
    };
  }

  for (const ch of candidate) {
    if (!vocabChars.has(ch)) {
      return {
        input: rawWord,
        representable: false,
        reason: `character "${ch}" is not in the ${languageCode} vocab (word: "${rawWord}")`,
      };
    }
  }

  return { input: rawWord, representable: true, mapped: candidate };
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
