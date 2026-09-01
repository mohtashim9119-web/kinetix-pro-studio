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
// Compositional cardinal-number generation (WS2 T3.2 Step 3b-iii).
//
// Replaces the four former per-language CAPPED 0-30 tables (Spanish/German/
// Portuguese/French — the scope-narrowed Phase 3b Slice 1 shape, superseded
// here) and adds English, which had NO FA-side cardinal expansion at all
// before this step (English digits were unconditionally dropped — the
// `textNormalize.ts` matcher-side English cardinal reader is a completely
// separate module, never shared with this one). The former 31+ cap existed
// only because a bare lookup table couldn't express a multi-word
// composition without breaking the one-`FaWordResult`-per-input-token
// contract; that contract has since been satisfied structurally by the
// multi-word tokenizer capability (`fa_onnx.rs`'s `tokenize_normalized_words`/
// `collapse_word_fragments`, WS2 T3.2 Step 3a-ii) — a `mapped` string MAY
// now contain internal whitespace and still collapses to exactly one
// `WordSpan` after alignment, so a space-linked compound (Spanish "treinta y
// cuatro", French "vingt et un", English "one thousand nine hundred
// ninety-eight") is no longer disqualified by that invariant.
//
// Reads its data from `scripts/fixtures/fa-cardinal-<lang>.json` (WS2 T3.2
// Step 2 landed 0-99/hundred/scale/yearReading; Step 3b-ii extended
// `yearReading.selectionPolicy` with a named threshold policy for en/de) —
// CALLER-supplied, exactly like `vocabChars` above: this module still never
// reads a file itself (module doc comment, top of file). `fa/text.rs` below
// is ported byte-identically, reading the SAME five JSON files (embedded via
// `include_str!`) — neither side hardcodes a cardinal-word table of its own
// any more; the data lives in exactly one place, consumed identically by
// both.
//
// NO MAGNITUDE CAP: composition walks `scale` (thousand, million, ...) from
// the largest applicable level down, recursing into itself for both a
// level's own multiplier count (itself possibly >= that level's own value —
// e.g. a number past 999,999,999 recurses into "N million" for however many
// millions it takes, composing the multiplier itself the same way) and its
// remainder. The practical ceiling is JS's safe-integer range and however
// many scale levels a language's data file ships (today: thousand, million)
// — a value past what "million" can express composes as a repeated multiple
// of "million" rather than inventing an unshipped "billion"-class word; not
// linguistically idiomatic past that point, but arithmetically well-formed
// and a real, deliberate, documented scope boundary — no real video-
// narration digit token needs more than this.
// ---------------------------------------------------------------------------

/** One multiplier/remainder join point's spacing rule — `{type:
 *  "concatenate"}` inserts nothing (German fuses every level into one
 *  orthographic word); `{type: "space", text: null}` inserts a bare space;
 *  `{type: "space", text: "e"}` (Portuguese's hundred-remainder join) inserts
 *  `" e "`. */
export interface FaJoiner {
  type: 'space' | 'concatenate';
  text: string | null;
}

/** `scripts/fixtures/fa-cardinal-<lang>.json`'s `hundred` object — the one
 *  block that has to model three structurally different hundred-grammars:
 *  `"compound"` (en: multiplier count + "hundred" as two space-joined
 *  words; de: the same shape but concatenated), `"fused"` (es/pt: each
 *  multiple of 100 is its OWN irregular single word — "doscientos", never
 *  "dos cientos" — looked up in `multiplierWords` by the full value `"200"`,
 *  `"300"`, ... `"900"`), and French's own conditional pluralization
 *  (`pluralizesWhenExactMultiple`/`pluralSuffix`: "cent" pluralizes to
 *  "cents" only when it's an EXACT multiple of 100 with no remainder —
 *  "deux cents" but "deux cent trois"). `countWordOverride` supplies the
 *  count=1 combining-form word when `dropsOneMultiplier` is false but the
 *  bare `cardinals0to99["1"]` citation form is wrong in this position (e.g.
 *  German "ein" vs. the citation form "eins" — see `fa-cardinal-de.json`'s
 *  own note on this field). */
export interface FaHundredConfig {
  word: string;
  combiningWord: string;
  multiplierForm: 'compound' | 'concatenate' | 'fused';
  multiplierWords: Record<string, string> | null;
  dropsOneMultiplier: boolean;
  countWordOverride?: string;
  regularMultiplierJoiner: FaJoiner | null;
  remainderJoiner: FaJoiner;
  pluralizesWhenExactMultiple?: boolean;
  pluralSuffix?: string;
}

/** One entry of `scripts/fixtures/fa-cardinal-<lang>.json`'s `scale` array
 *  (thousand, million, ...) — same `countWordOverride` role as
 *  `FaHundredConfig`'s (German million's own "eine" vs. the generic "ein"
 *  combining form is the shipped example). `pluralWord` is used whenever the
 *  multiplier count isn't exactly 1 (covers both "pluralizes" languages —
 *  Spanish "millón"/"millones" — and ones where `word`/`pluralWord` are
 *  identical because the word never pluralizes as a count noun — English/
 *  German "thousand"/"tausend"). */
export interface FaScaleLevel {
  value: number;
  word: string;
  pluralWord: string;
  dropsOneMultiplier: boolean;
  countWordOverride?: string;
  joiner: FaJoiner;
}

/** The data-driven form of `yearReading.selectionPolicy` landed in WS2 T3.2
 *  Step 3b-ii: `n % 100 >= threshold` selects `atOrAboveThreshold`,
 *  otherwise `belowThreshold` — both candidate NAMES from the same
 *  `yearReading.candidates` array. Replaces a single-constant policy string
 *  for languages (en, de) whose matcher-mirrored convention is genuinely
 *  conditional, not a single reading; es/fr/pt keep the plain-string form
 *  (`"compound"`) since they have only one real candidate. */
export interface FaYearReadingPolicy {
  name: string;
  threshold: number;
  atOrAboveThreshold: string;
  belowThreshold: string;
}

export interface FaYearReading {
  rangeMin: number;
  rangeMax: number;
  modFloor: number;
  candidates: string[];
  selectionPolicy: string | FaYearReadingPolicy | null;
}

/** The full shape of one `scripts/fixtures/fa-cardinal-<lang>.json` file (its
 *  `_provenance`/`rationale`/`matcherParityNote`/`note` metadata fields are
 *  intentionally not modeled here — this generator reads only the fields it
 *  composes with). */
export interface FaCardinalData {
  cardinals0to99: Record<string, string>;
  hundred: FaHundredConfig;
  scale: FaScaleLevel[];
  yearReading: FaYearReading;
}

/** `null`/`undefined` and `{type: "concatenate"}` both insert nothing;
 *  `{type: "space", text: null}` inserts a bare space; `{type: "space",
 *  text: "e"}` inserts `" e "`. */
function joinerSeparator(joiner: FaJoiner | null | undefined): string {
  if (!joiner || joiner.type === 'concatenate') return '';
  return joiner.text ? ` ${joiner.text} ` : ' ';
}

/** Direct lookup into the data file's own 0-99 table — already the full,
 *  correct spelling for every value in range, INCLUDING language-specific
 *  space-linked/hyphenated compounds (Spanish "treinta y cuatro", French
 *  "vingt et un", Portuguese "trinta e quatro") — this function never
 *  re-derives those, only looks them up. Throws on a missing entry (a data
 *  file integrity bug, not a runtime input-shape question — every value
 *  0-99 is required to be present). */
function cardinal0to99(n: number, data: FaCardinalData): string {
  const word = data.cardinals0to99[String(n)];
  if (word === undefined) {
    throw new Error(`fa cardinal data: cardinals0to99 missing entry for ${n}`);
  }
  return word;
}

/** Composes 100-999 per `data.hundred`'s configuration — see
 *  `FaHundredConfig`'s own doc comment for the three hundred-grammar shapes
 *  this models. */
function composeHundred(n: number, data: FaCardinalData): string {
  const hundred = data.hundred;
  const multiplier = Math.floor(n / 100);
  const remainder = n % 100;

  let head: string;
  if (hundred.multiplierForm === 'fused') {
    if (multiplier === 1) {
      head = remainder === 0 ? hundred.word : hundred.combiningWord;
    } else {
      const fused = hundred.multiplierWords?.[String(multiplier * 100)];
      if (fused === undefined) {
        throw new Error(`fa cardinal data: hundred.multiplierWords missing entry for ${multiplier * 100}`);
      }
      head = fused;
    }
  } else {
    let multiplierPart = '';
    if (!(multiplier === 1 && hundred.dropsOneMultiplier)) {
      multiplierPart = (multiplier === 1 ? hundred.countWordOverride : undefined)
        ?? hundred.multiplierWords?.[String(multiplier)]
        ?? cardinal0to99(multiplier, data);
    }
    let hundredWord = hundred.word;
    if (hundred.pluralizesWhenExactMultiple && hundred.pluralSuffix && remainder === 0 && multiplier > 1) {
      hundredWord += hundred.pluralSuffix;
    }
    if (multiplierPart === '') {
      head = hundredWord;
    } else if (hundred.multiplierForm === 'concatenate') {
      head = multiplierPart + hundredWord;
    } else {
      head = multiplierPart + joinerSeparator(hundred.regularMultiplierJoiner) + hundredWord;
    }
  }

  if (remainder === 0) return head;
  const tail = cardinal0to99(remainder, data);
  return head + joinerSeparator(hundred.remainderJoiner) + tail;
}

/** Composes `n` at and above one scale level (thousand, million, ...),
 *  recursing into `cardinalToWords` for both the level's own multiplier
 *  count (unbounded — module comment above) and its remainder. Reuses the
 *  level's own `joiner` for both the multiplier->word attachment and the
 *  word->remainder attachment (the data file has no separate field for the
 *  latter; every shipped language's spacing convention at a scale boundary
 *  is uniform across both — space-separated for en/es/fr/pt, fully
 *  concatenated for de — so one field correctly covers both joins). */
function composeScaleLevel(n: number, level: FaScaleLevel, data: FaCardinalData): string {
  const multiplier = Math.floor(n / level.value);
  const remainder = n % level.value;

  let multiplierPart = '';
  if (!(multiplier === 1 && level.dropsOneMultiplier)) {
    multiplierPart = (multiplier === 1 ? level.countWordOverride : undefined)
      ?? cardinalToWords(multiplier, data);
  }
  const scaleWord = multiplier === 1 ? level.word : level.pluralWord;
  const head = multiplierPart === ''
    ? scaleWord
    : level.joiner.type === 'concatenate'
      ? multiplierPart + scaleWord
      : multiplierPart + joinerSeparator(level.joiner) + scaleWord;

  if (remainder === 0) return head;
  const tail = cardinalToWords(remainder, data);
  return level.joiner.type === 'concatenate' ? head + tail : `${head} ${tail}`;
}

/** Full literal/arithmetic cardinal reading of any non-negative integer, per
 *  `data`'s own composition rules. This IS the year-reading "compound"
 *  candidate (called directly, not re-derived) and the fallback for every
 *  non-year digit token. No magnitude cap — module comment above. */
function cardinalToWords(n: number, data: FaCardinalData): string {
  if (n < 100) return cardinal0to99(n, data);
  if (n < 1000) return composeHundred(n, data);
  const levels = [...data.scale].sort((a, b) => b.value - a.value);
  for (const level of levels) {
    if (n >= level.value) return composeScaleLevel(n, level, data);
  }
  // Unreachable: `data.scale`'s smallest shipped value is 1000 and n >= 1000
  // was already established by the `n < 1000` check above.
  throw new Error(`fa cardinal data: no scale level applies to ${n}`);
}

/** The "pair"/"hundertgruppe" year-reading shapes: split into a two-digit
 *  high/low half (`floor(n/100)`, `n%100`) and read each half via
 *  `cardinal0to99` directly — NOT via `composeHundred` (the high half is a
 *  literal two-digit citation, e.g. "nineteen", not a count of hundreds).
 *  "pair" space-joins the halves (en: "nineteen ninety-eight");
 *  "hundertgruppe" (the only other candidate name any shipped language
 *  uses) joins them through an explicit hundred-word using `hundred`'s own
 *  concatenation style (de: "neunzehn" + "hundert" + "achtundneunzig", fully
 *  concatenated). "compound" delegates to the plain arithmetic reading.
 *  Throws on any other candidate name — an unrecognized reading strategy is
 *  a data-file/schema mismatch, not a silently-ignorable input. */
function composeYearReading(n: number, candidate: string, data: FaCardinalData): string {
  if (candidate === 'compound') return cardinalToWords(n, data);
  const high = cardinal0to99(Math.floor(n / 100), data);
  const low = cardinal0to99(n % 100, data);
  if (candidate === 'pair') return `${high} ${low}`;
  if (candidate === 'hundertgruppe') {
    return data.hundred.multiplierForm === 'concatenate'
      ? `${high}${data.hundred.word}${low}`
      : `${high} ${data.hundred.word} ${low}`;
  }
  throw new Error(`fa cardinal data: unknown yearReading candidate "${candidate}"`);
}

/** Resolves `yearReading.selectionPolicy` (a plain candidate-name string for
 *  es/fr/pt, or the `n % 100 >= threshold` object form for en/de — WS2 T3.2
 *  Step 3b-ii) to the candidate name that applies to this specific `n`. */
function selectYearCandidate(n: number, policy: FaYearReading['selectionPolicy']): string {
  if (policy === null) {
    throw new Error('fa cardinal data: yearReading.selectionPolicy is unset (null) for this language');
  }
  if (typeof policy === 'string') return policy;
  return (n % 100) >= policy.threshold ? policy.atOrAboveThreshold : policy.belowThreshold;
}

/** Entry point replacing the four former per-language `expand*Cardinal`
 *  functions — now shared across all five languages (English included,
 *  previously unhandled) and fully data-driven.
 *
 *  NO PRODUCTION CALLER TODAY: every real call site of `computeFaChunkPlan`
 *  (`App.tsx`'s dev path, `faSeamFitGate.ts`, `forcedAlignmentRun.ts`) omits
 *  the `languageCode`/`vocabChars`/`cardinalData` trio, which is the only
 *  way `normalizeForForcedAlignment` — and therefore this function — is
 *  ever reached (see `computeFaChunkPlanWithAttribution`'s own doc comment
 *  in `faChunkPlan.ts`). This function exists as the PARITY REFERENCE the
 *  Rust port (`expand_cardinal_token`, `src-tauri/src/fa/text.rs`) is
 *  ported byte-identically against and pinned to via the shared
 *  `fa-text-normalize-fixture.json` fixture — not as a shipping code path.
 *  Do not mistake test/fixture coverage here for production behavior.
 *
 *  THE TRIO STAYS OMITTED PERMANENTLY (WS2 T4.1 Step 4, owner ruling). This is
 *  not "not wired yet" — wiring it would be a DEFECT, and here is the
 *  mechanism. Both arms normalizing is idempotent on the STRING and NOT on the
 *  WORD COUNT. `fa_onnx.rs`'s `tokenize_normalized_words` records
 *  `fragment_counts` per SOURCE word and `collapse_word_fragments` merges each
 *  group back to exactly one `WordSpan` per source word, which is what keeps
 *  `wordIndex` 1:1 with the RAW words of `chunk.text`. If this side
 *  pre-normalized, `"2024"` would reach Rust as `"twenty twenty-four"` — TWO
 *  raw source words, two `WordSpan`s — desynchronizing `wordIndex` against the
 *  script-word attribution for the rest of the chunk. The trio is optional
 *  precisely so the production path never supplies it.
 *
 *  Separately, and not to be confused with the above: the RUST arm's own
 *  reachability is gated by the `fa-inference` Cargo feature, which is OFF in
 *  `tauri:dev`/`tauri:build`. See `docs/work-in-progress.md` §5.
 *
 *  `stripped` must be entirely
 *  digits, no sign, no separators, no leading zero other than a bare "0" —
 *  anything else returns `undefined` and the caller falls through to the
 *  pre-existing digit-drop path, exactly as every former per-language
 *  function did. A 4-character token numerically inside
 *  `yearReading.rangeMin..rangeMax` takes the year-reading branch (mirroring
 *  the matcher's own `tok.length === 4 && n >= rangeMin && n <= rangeMax`
 *  gate, `textNormalize.ts:91` — same structural condition, independently
 *  re-expressed here since this module shares no code with that one);
 *  everything else gets the plain arithmetic cardinal reading. */
function expandCardinalToken(stripped: string, data: FaCardinalData): string | undefined {
  if (!/^[0-9]+$/.test(stripped)) return undefined;
  if (stripped.length > 1 && stripped[0] === '0') return undefined;
  const n = Number(stripped);
  if (!Number.isSafeInteger(n)) return undefined;
  const yr = data.yearReading;
  if (stripped.length === 4 && n >= yr.rangeMin && n <= yr.rangeMax) {
    return composeYearReading(n, selectYearCandidate(n, yr.selectionPolicy), data);
  }
  return cardinalToWords(n, data);
}

/** Normalizes one already-whitespace-isolated word: NFC + lowercase, the
 *  German ß->ss substitution, zero-width stripping, typographic folding,
 *  boundary-punctuation stripping, then a data-driven cardinal-number
 *  expansion (`expandCardinalToken`, all five languages), then a digit check
 *  and a per-character vocab membership check (skipping the space character,
 *  which a multi-word compositional reading may now contain structurally —
 *  it is a fragment delimiter, not a spellable vocab character). A word
 *  surviving fold+strip with any non-space character still absent from the
 *  vocab is unrepresentable — dropped and recorded, never partially
 *  mangled. */
function normalizeWord(
  rawWord: string,
  languageCode: FaLanguageCode,
  vocabChars: ReadonlySet<string>,
  cardinalData: FaCardinalData,
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

  const cardinalExpansion = expandCardinalToken(stripped, cardinalData);
  const candidate = cardinalExpansion ?? stripped;

  if (cardinalExpansion === undefined && DIGIT_RE.test(stripped)) {
    return {
      input: rawWord,
      representable: false,
      reason: `contains a digit — number expansion is Phase 3b, out of scope (word: "${rawWord}")`,
    };
  }

  for (const ch of candidate) {
    if (ch === ' ') continue; // fragment delimiter of a multi-word compositional reading, not a spellable vocab character
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
 * `cardinalData` is the parsed contents of that language's
 * `fa-cardinal-<lang>.json` (WS2 T3.2 Step 3b-iii) — caller-supplied, same as
 * `vocabChars`, for the same reason (module doc comment, top of file: this
 * module never reads a file itself).
 */
export function normalizeForForcedAlignment(
  input: string,
  languageCode: FaLanguageCode,
  vocabChars: ReadonlySet<string>,
  cardinalData: FaCardinalData,
): FaNormalizeResult {
  const rawWords = input.split(/\s+/).filter(w => w.length > 0);
  const words = rawWords.map(w => normalizeWord(w, languageCode, vocabChars, cardinalData));
  const text = words
    .filter((w): w is FaWordResult & { mapped: string } => w.representable)
    .map(w => w.mapped)
    .join(' ');
  return { words, text };
}
