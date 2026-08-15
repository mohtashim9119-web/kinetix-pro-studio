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
//   - canonicalizeSceneDoc(text)  -> string[]  — canonicalize, preceded by the
//                                    WS4 stage-direction strip; the SCENE-DOC
//                                    side of the aligner only (see below)
//   - stripStageDirections(text)  -> string    — that strip on its own (pure)
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
 * Non-English `qi`-bookkeeping fixes (Phase 3c, `sync-pipeline-v2-plan.md`
 * H.5/:3821-3839 scope-addition; hyphen-asymmetry itself stays out of scope —
 * NOT STARTED, see `docs/work-in-progress.md` §3). Gated behind an explicit
 * `languageCode` argument so every existing caller (nothing passes one today
 * outside `faChunkPlan.ts`'s `qi` computation) is byte-for-byte unaffected —
 * the frozen English alignment baseline (`CLAUDE.md` Testing invariant) never
 * sees this branch.
 */
const NON_ENGLISH_CANONICALIZE_LANGUAGES = new Set(['es', 'fr', 'de', 'pt']);

/**
 * The full alignment tokenizer (doc §3.2). Deterministic and applied
 * IDENTICALLY to both the scene-doc word side and the Whisper-token side, so a
 * spelled-out number ("thirty seven") and Whisper's digit output ("37") — or a
 * hyphenated compound and its glued form — collapse to the SAME word sequence,
 * and anything not covered here still normalizes symmetrically (a local diff
 * cost in the Hirschberg aligner, never an asymmetric desync).
 *
 * `languageCode` (optional, default English behavior): es/fr/de/pt invert
 * English's thousands/decimal separator convention ("1.234,56" reads as
 * English's "1,234.56") and preserve native diacritics in step 10 instead of
 * ASCII-folding them away — both fixed here, not translated into
 * language-specific number WORDS, which stays a separate, unstarted gap
 * (`sync-pipeline-v2-plan.md` H.5).
 */
export function canonicalize(text: string, languageCode?: 'en' | 'es' | 'fr' | 'de' | 'pt'): string[] {
  // Steps 1, 3, 8, 9 (shared primitive) then 2 (lowercase).
  let t = foldUnicodeHygiene(text).toLowerCase();

  // Step 4 — contraction expansion (apostrophes already folded to ASCII above).
  t = t.replace(CONTRACTION_RE, m => CONTRACTIONS[m] ?? m);

  const nonEnglish = languageCode !== undefined && NON_ENGLISH_CANONICALIZE_LANGUAGES.has(languageCode);

  if (nonEnglish) {
    // Step 5' — es/fr/de/pt use period as the thousands separator: drop it
    // between digits ("1.234" -> "1234"). Was previously left to Step 6's
    // English decimal-point regex, which misread it as a decimal point.
    t = t.replace(/(\d)\.(\d)/g, '$1$2');
    // Step 6' — es/fr/de/pt use comma as the decimal mark: "1234,56" ->
    // "1234 point 5 6" (fractional digits kept single, same convention as
    // English's own digit-by-digit reading below).
    t = t.replace(/(\d+),(\d+)/g, (_m, a: string, b: string) => ` ${a} point ${b.split('').join(' ')} `);
  } else {
    // Step 5 — drop thousands separators between digits (11,000 -> 11000).
    t = t.replace(/(\d),(\d)/g, '$1$2');

    // Step 6 — decimals: "3.5" -> "3 point 5"; fractional digits kept single so
    // the per-token expansion reads them digit-by-digit ("three point five").
    t = t.replace(/(\d+)\.(\d+)/g, (_m, a: string, b: string) => ` ${a} point ${b.split('').join(' ')} `);
  }

  // Step 7 — currency + spoken symbols.
  t = t.replace(/\$\s?(\d+)/g, ' $1 dollars '); // "$5" -> "5 dollars" (spoken order)
  t = t.replace(/\$/g, ' dollars ');            // bare "$" -> "dollars"
  t = t.replace(/%/g, ' percent ');
  t = t.replace(/&/g, ' and ');
  t = t.replace(/@/g, ' at ');

  // Step 10 — strip remaining non-alphanumeric to spaces, PRESERVING the hyphen
  // (co-operate must survive as one token; the R1 carve-out below decides split).
  // es/fr/de/pt additionally preserve native Unicode letters (diacritics) —
  // "café" stays "café" rather than folding to "caf " — instead of the
  // ASCII-only `a-z0-9` class English uses.
  t = nonEnglish
    ? t.replace(/[^\p{L}0-9\s-]/gu, ' ')
    : t.replace(/[^a-z0-9\s-]/g, ' ');

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

// --- Stage-direction stripping (WS4 Feature 1, decision 13a) ----------------
//
// Screenplay/scene directions are WRITTEN but never SPOKEN, so every one of them
// is a scene-doc word with no transcript counterpart — a penalized deletion in
// the Hirschberg aligner that drags a segment's confidence down toward the
// LOW_CONFIDENCE_RATIO skip threshold for no reason. Stripping them is applied
// to the SCENE-DOC SIDE ONLY (see canonicalizeSceneDoc below): the transcript
// side never contains them, so stripping there would be a no-op at best and an
// asymmetry at worst.
//
// Conservative by construction — every rule below is line-anchored, case-
// sensitive (screenplay convention is ALL CAPS), or both, so ordinary prose can
// never trip it:
//
//   STRIP  (whispering), (to camera)        parentheticals, anywhere
//   STRIP  line [CUT TO: KITCHEN] here      bracketed ALL-CAPS, NOT at line start
//   STRIP  INT. KITCHEN - DAY               scene-header line (whole line)
//   STRIP  FADE IN: / CUT TO: / DISSOLVE TO:  transition line (whole line)
//   STRIP  NARRATOR: / VOICE 2:             speaker label at line start (WS5)
//   STRIP  a residual colons-only fragment  (whole line)
//   KEEP   [tag] at line start              scene anchors — the parser's own tags
//   KEEP   [scene 1] anywhere               has lowercase ⇒ not a directive
//   KEEP   *emphasis*                       spoken text, not a direction
//   KEEP   narrator: / note: / hint:        lowercase ⇒ prose, not a label
//   KEEP   hyphens / smart quotes / abbrevs already handled above

/** A `[...]` group. No nesting — brackets don't nest in practice, and a greedy
 *  match would swallow the text between two separate groups. */
const BRACKET_GROUP_RE = /\[[^\]]*\]/g;

/** An innermost `(...)` group. Applied repeatedly so nested parentheticals
 *  ("(to camera (aside))") collapse from the inside out. */
const INNER_PAREN_RE = /\([^()]*\)/g;

/** Slugline: `INT.` / `EXT.` (and the combined forms) followed by content.
 *  Case-SENSITIVE — "Int." in prose is not a slugline. */
const SCENE_HEADER_RE = /^(?:INT|EXT|INT\.\/EXT|EXT\.\/INT|I\/E)\.\s*\S/;

/** Transition line: `FADE IN:`, `CUT TO:`, `DISSOLVE TO:` … Requires either a
 *  colon or end-of-line, so a spoken sentence that merely begins with one of
 *  these words (in caps) is not eaten. Case-SENSITIVE, same reason. */
const TRANSITION_LINE_RE =
  /^(?:FADE\s+(?:IN|OUT)|FADE\s+TO\s+BLACK|CUT\s+TO|CUT\s+BACK\s+TO|SMASH\s+CUT\s+TO|MATCH\s+CUT\s+TO|DISSOLVE\s+TO)\s*(?::|$)/;

/** A line left holding nothing but colons/whitespace after the strips above. */
const COLONS_ONLY_RE = /^[\s:]+$/;

/**
 * Speaker label at the head of a line (WS5, decision 13a extension item A):
 * `NARRATOR:`, `VOICE 2:`, `SPEAKER:`. Like a stage direction, a speaker label
 * is WRITTEN but never SPOKEN — the voice artist reads the dialogue, not the
 * name of who says it — so every label is an unmatchable scene-doc word that
 * drags its segment's confidence down for no reason.
 *
 * Group 1 is everything preserved ahead of the label: leading whitespace, plus
 * an OPTIONAL line-start `[tag]` anchor, so "[scene 1] NARRATOR: hello" keeps
 * its anchor and becomes "[scene 1] hello". Group 2 (the label) is dropped.
 *
 * Case-SENSITIVE and uppercase-ONLY, which is what keeps ordinary prose safe:
 * "note:", "hint:", "narrator:" are lowercase and never match. The `+` after
 * the first character means a label is at least two characters before its
 * colon, so a bare "A:" is left alone.
 *
 * KNOWN, ACCEPTED LIMIT: a genuinely spoken ALL-CAPS clause ending in a colon
 * ("THE ANSWER IS: forty two") matches this pattern and loses its lead-in
 * words. ALL-CAPS spoken prose is rare, screenplay convention reserves caps at
 * line-head-plus-colon for labels, and the failure is a few dropped words on
 * the ALIGNMENT VIEW only — `seg.text` is untouched either way.
 */
const SPEAKER_LABEL_RE = /^(\s*(?:\[[^\]]*\]\s*)?)[A-Z][A-Z0-9 ]+:[ \t]*/;

/**
 * True for bracketed content that reads as a directive rather than a tag:
 * at least two consecutive capitals and NO lowercase at all. "[CUT TO: KITCHEN]"
 * and "[CLOSE UP]" qualify; "[scene 1]" and "[Hero shot]" deliberately do not.
 */
function isAllCapsDirective(inner: string): boolean {
  return /[A-Z]{2}/.test(inner) && !/[a-z]/.test(inner);
}

/**
 * Removes screenplay/scene directions from text destined for the aligner.
 *
 * Line-oriented: "at line start" is only meaningful per line, and whole-line
 * rules (sluglines, transitions) must not eat their neighbours. Emptied lines
 * are dropped rather than left as blanks — the output feeds a whitespace
 * tokenizer, so blank lines carry no information.
 *
 * NFC-normalizes first (the same step 1 `canonicalize` performs), so the
 * pattern matching sees composed characters; `canonicalize`'s own NFC pass is
 * idempotent on this output.
 *
 * PURE and non-mutating with respect to the caller's segment: `seg.text` keeps
 * the author's original wording — only the ALIGNMENT VIEW of it is stripped.
 */
export function stripStageDirections(text: string): string {
  const kept: string[] = [];

  for (const rawLine of text.normalize('NFC').split('\n')) {
    const trimmedStart = rawLine.trimStart();
    // Whole-line rules first, on the untouched line.
    if (SCENE_HEADER_RE.test(trimmedStart) || TRANSITION_LINE_RE.test(trimmedStart)) {
      continue;
    }

    // Bracketed directives. "At line start" is decided against the ORIGINAL
    // line's first non-whitespace offset, so an earlier strip on the same line
    // can never promote a mid-line bracket into an anchor position.
    const firstNonWs = rawLine.search(/\S/);
    let line = rawLine.replace(BRACKET_GROUP_RE, (match, offset: number) => {
      if (offset === firstNonWs) return match;              // [tag] anchor — preserved
      return isAllCapsDirective(match.slice(1, -1)) ? ' ' : match;
    });

    // Speaker label (WS5). Runs AFTER the bracket pass so a line-start [tag]
    // anchor is already settled and can simply be carried through by group 1,
    // and BEFORE the parenthetical pass so "NARRATOR: (whispering) hello"
    // composes: the label goes here, then "(whispering)" goes below, leaving
    // "hello". Whole-line transition rules ran earlier still, so "CUT TO:" was
    // already dropped as a transition and never reaches this pattern.
    line = line.replace(SPEAKER_LABEL_RE, '$1');

    // Parentheticals, inside-out until stable. An unbalanced "(" is left alone.
    let previous: string;
    do {
      previous = line;
      line = line.replace(INNER_PAREN_RE, ' ');
    } while (line !== previous);

    if (COLONS_ONLY_RE.test(line)) continue;

    // Replacing a strip with ' ' preserves word adjacency ("a[CUT]b" -> "a b");
    // collapse the runs it leaves behind.
    const collapsed = line.replace(/\s+/g, ' ').trim();
    if (collapsed.length > 0) kept.push(collapsed);
  }

  return kept.join('\n');
}

/**
 * The SCENE-DOC side of the alignment tokenizer: stage directions stripped,
 * then the standard `canonicalize` pipeline. Composed rather than folded into
 * `canonicalize` itself, because the transcript (subject) side must NOT be
 * stripped — Whisper transcribes speech, so a direction can only ever appear on
 * the scene-doc side, and running the strip on both would buy nothing while
 * risking an asymmetry. `canonicalize` and `canonicalizeForFilename` keep their
 * exact prior semantics.
 */
export function canonicalizeSceneDoc(text: string, languageCode?: 'en' | 'es' | 'fr' | 'de' | 'pt'): string[] {
  return canonicalize(stripStageDirections(text), languageCode);
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
