/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// ---------------------------------------------------------------------------
// CONTRACT 1→2, GUARANTEE P6 — NORMALIZER SYMMETRY. The measurement, built as a
// standing test rather than a one-off harness (WS1 Session J).
//
// THE GUARANTEE, verbatim from the plan: "Both text sides pass through the SAME
// language-keyed normalizer; the English path is byte-identical to pre-v2."
//
// WHY THIS FILE EXISTS RATHER THAN A WRITTEN ACCEPTANCE. P6 was the one
// Contract 1→2 row that could not be scheduled away, because the plan's own
// enforcement text for it is "symmetry property manually-verified" — i.e. the
// verification IS the enforcement, and there was no automated gate to point at.
// The structural half was already DIRECT (there is one module and one entry
// point, `textNormalize.ts`). What had never been checked is the PROPERTY: that
// the script side and the transcript side, on real corpus inputs, actually
// produce the same normalized form for the same word. Accepting P6 in writing
// would have meant accepting a property nobody had ever measured — a different
// act from accepting P4/P8 (known-absent, scheduled) or A4 (known-dormant,
// measured).
//
// WHAT THE TWO SIDES ACTUALLY ARE, read off production rather than assumed:
//
//   script side     `normalizeSceneDoc(seg.text, lang)`  (whisperService.ts)
//                   = canonicalize(stripStageDirections(text), lang)
//                     ...with an empty-result fallback to the unstripped text
//   transcript side `normalize(token.text, lang)`        (whisperService.ts)
//                   = canonicalize(text, lang)
//
// So the sides differ by exactly two things, and each is measured below:
//
//   (1) `stripStageDirections`, script-side only. DELIBERATE and documented —
//       Whisper transcribes speech, so a stage direction can only ever appear
//       on the script side. Measured here for its BLAST RADIUS (how many
//       segments it touches, and whether it ever alters a word rather than
//       removing one) rather than treated as a defect.
//
//   (2) THE GRANULARITY, which is the real risk and the reason this test is
//       worth building. The script side canonicalizes a WHOLE SEGMENT in one
//       call; the transcript side canonicalizes ONE TOKEN at a time. If
//       `canonicalize` is not compositional — if canonicalize("twenty six") !=
//       canonicalize("twenty") ++ canonicalize("six") — then the identical
//       words normalize DIFFERENTLY depending only on which side of the
//       contract they entered from, and the Hirschberg aligner is matching two
//       streams that disagree about their own vocabulary. Nothing in the
//       codebase asserted this. `canonicalize` performs multi-word operations
//       (cardinal/year readings, contraction expansion), which is exactly the
//       shape that breaks compositionality, so this is a live risk and not a
//       theoretical one.
//
// PROVENANCE. Every number this file produces comes from the production
// functions `normalize` / `normalizeSceneDoc` / `canonicalize` /
// `stripStageDirections`, imported and called — never reimplemented. Inputs are
// the committed corpus fixtures the golden replay already reads
// (`scripts/fixtures/phase4-baseline-{corpus}-{segments,words}.csv`), so no new
// fixture path is created and no capture is required.
//
// SCOPE. en/es only, matching Stage 1's own scope (R-AB..R-AF; R-T defers
// fr/de/pt and that corpus does not exist).
//
// PASS CONDITION: zero asymmetries outside the already-accepted Phase 3c hyphen
// class. Any asymmetry outside that class reopens Stage 1.
// ---------------------------------------------------------------------------

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import { canonicalize, stripStageDirections } from './textNormalize';
import { normalize, normalizeSceneDoc } from './whisperService';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const FIXTURES = resolve(REPO, 'scripts', 'fixtures');

/** The same minimal RFC4180-ish reader the golden replay and the FA gate use.
 *  Duplicated rather than imported for the same reason they duplicate it from
 *  each other: this file's only dependency on those is that they read the same
 *  directory. */
function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else { inQuotes = false; }
      } else { field += c; }
    } else if (c === '"') { inQuotes = true; }
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n') { row.push(field); field = ''; rows.push(row); row = []; }
    else if (c !== '\r') { field += c; }
  }
  if (field.length > 0 || row.length > 0) { row.push(field); rows.push(row); }
  const header = rows.shift() ?? [];
  return rows
    .filter(r => r.length === header.length)
    .map(r => Object.fromEntries(header.map((h, i) => [h, r[i] ?? ''])) as Record<string, string>);
}

type Lang = 'en' | 'es';

interface Corpus {
  key: string;
  lang: Lang;
  /** Committed script segments — the SCRIPT side's input. */
  segmentTexts: string[];
  /** Committed Whisper token texts — the TRANSCRIPT side's input. */
  tokenTexts: string[];
}

function loadCorpus(key: string, lang: Lang): Corpus {
  const segs = parseCsv(readFileSync(resolve(FIXTURES, `phase4-baseline-${key}-segments.csv`), 'utf-8'));
  const words = parseCsv(readFileSync(resolve(FIXTURES, `phase4-baseline-${key}-words.csv`), 'utf-8'));
  return {
    key,
    lang,
    segmentTexts: segs.map(r => r['text'] ?? '').filter(t => t.length > 0),
    tokenTexts: words.map(r => r['text'] ?? '').filter(t => t.length > 0),
  };
}

/** en/es only — Stage 1's scope. The Spanish corpus is the only non-English
 *  one in scope and is deliberately included: a language-keyed normalizer whose
 *  symmetry was only ever checked on English would be checked on the one path
 *  where the language key does nothing. */
const CORPORA: Corpus[] = [
  loadCorpus('v6', 'en'),
  loadCorpus('173', 'en'),
  loadCorpus('spanish', 'es'),
];

/**
 * THE PHASE 3C ACCEPTED CLASS. Closed 2026-08-15 by written acceptance rather
 * than by fix: hyphenated compounds normalize differently depending on whether
 * the hyphen survived into the text being normalized. Documented, accepted, and
 * therefore excluded from the pass condition — but counted and reported, so
 * "accepted" never quietly grows to cover something else.
 */
function isAcceptedHyphenClass(rawWord: string): boolean {
  return rawWord.includes('-');
}

describe('Contract 1→2 P6 — the two text sides share one normalizer', () => {
  it('reads real corpus material on both sides (a symmetry pass over nothing is not a pass)', () => {
    for (const c of CORPORA) {
      expect(c.segmentTexts.length, `${c.key} script segments`).toBeGreaterThan(0);
      expect(c.tokenTexts.length, `${c.key} transcript tokens`).toBeGreaterThan(0);
    }
    // Pinned so a truncated or swapped fixture cannot make this suite vacuous.
    expect(CORPORA.map(c => c.key)).toEqual(['v6', '173', 'spanish']);
  });

  // -------------------------------------------------------------------------
  // (2) GRANULARITY — the measurement that had never been made.
  // -------------------------------------------------------------------------

  it('the compositionality check has teeth on ENGLISH — and records that it has none on Spanish', () => {
    // A compositionality test over a normalizer that only ever maps one word to
    // one word would pass trivially and prove nothing. `canonicalize` is NOT
    // that: it reads digits as words ("1985" -> nineteen eighty five, "26" ->
    // twenty six), expands contractions ("don't" -> do not) and splits
    // hyphenated compounds — each of which turns one input token into several
    // output words, which is the shape that breaks compositionality if it ever
    // reaches across a whitespace boundary.
    //
    // MEASURED COVERAGE, WS1 Session J, and the honest half of this result:
    //
    //   corpus  lang  tokens  expanding tokens  expanding script words  hyphens
    //   v6      en     3989          9                   26               15
    //   173     en     1836          1                   36               13
    //   spanish es      363          0                    0                0
    //
    // The English corpora genuinely exercise the property. THE SPANISH CORPUS
    // EXERCISES NOTHING: 363 tokens, none of which expands, no contraction, no
    // digit, no hyphen. Its compositionality result is therefore VACUOUSLY
    // true on the CORPUS. That is a corpus-coverage limitation, not an
    // asymmetry — no disagreement was found anywhere — but it bounds what the
    // corpus pass is entitled to claim, so it is asserted here rather than
    // written in a paragraph somebody has to remember.
    //
    // WS1 Session L closed the other half of this: the property is NOT
    // non-falsifiable in Spanish — the test below ("the Spanish half is
    // EXERCISED on constructed digit material") runs the es-keyed normalizer on
    // real Spanish sentences carrying an expanding digit and confirms both
    // expansion and compositionality. What stays corpus-vacuous is only what a
    // Spanish corpus WITHOUT digits can reach; the machinery itself is
    // exercised. Full bound in that test's header.
    const englishExpanding = CORPORA.filter(c => c.lang === 'en')
      .map(c => c.tokenTexts.filter(t => normalize(t, c.lang).length > 1).length);
    expect(englishExpanding.every(n => n > 0), 'no English corpus exercises multi-word expansion').toBe(true);

    // Pinned as a MEASUREMENT, not a target: if Spanish corpus material with
    // digits or contractions is ever added, this flips and the vacuity note
    // above must be revisited rather than silently outliving its truth.
    const spanish = CORPORA.find(c => c.key === 'spanish')!;
    expect(
      spanish.tokenTexts.filter(t => normalize(t, 'es').length > 1).length,
      'The Spanish corpus now contains expanding tokens — P6\'s es coverage note is stale, update it.',
    ).toBe(0);

    // And pin the mechanism itself, independent of corpus content, so the
    // English result cannot quietly become vacuous either.
    expect(canonicalize('1985', 'en')).toEqual(['nineteen', 'eighty', 'five']);
    expect(canonicalize("don't", 'en')).toEqual(['do', 'not']);
  });

  // WS1 Session L — THE SPANISH HALF, MOVED FROM VACUOUS TO EXERCISED.
  //
  // The debt Session J left open, stated plainly: the Spanish CORPUS contains
  // no expanding token, so the compositionality pass over it proves nothing,
  // and P6's es half rested on non-falsifying material. Session L was asked to
  // either construct material that exercises the property, or record what would
  // be needed. This is the construction — and the precise bound on what it can
  // and cannot claim, measured against the production normalizer rather than
  // asserted.
  //
  // WHAT IS AND IS NOT AVAILABLE ON THE `es` PATH, measured:
  //   - The digit reader DOES expand under the 'es' key: canonicalize('1985',
  //     'es') = [nineteen, eighty, five], '26' -> [twenty, six], '2000' ->
  //     [two, thousand]. This is the SAME output English produces — the
  //     digit->words reading is language-INDEPENDENT, not an es-specific rule.
  //   - Every SPANISH-LEXICAL rule Phase 3b built is 1->1 and expands nothing:
  //     'veintiseis' -> [veintiseis], the del/al contractions -> [del]/[al]
  //     (not split into de-el/a-el). So there is NO Spanish WORD that expands
  //     to multiple output words; the only multi-word construct reachable on
  //     the es path at all is the shared digit reader.
  //   - The Spanish corpus contains no digits, which is the whole reason its
  //     natural coverage is zero.
  //
  // So the honest discharge is: the property is NOT non-falsifiable in Spanish
  // (constructed digit material exercises expansion AND compositionality under
  // the es key, below), but it IS un-exercisable by any Spanish-LEXICAL
  // construct, because none expands. What would move the natural-corpus number
  // off zero: a Spanish corpus carrying digit tokens, OR a future Phase 3b rule
  // that makes a Spanish word expand (e.g. writing out del -> "de el"), which
  // is currently out of scope by decision (b).
  it('the Spanish half is EXERCISED on constructed digit material — expansion is real and compositional', () => {
    // Real Spanish sentences carrying a digit that expands. Every non-digit
    // word is genuine Spanish the es normalizer must pass through untouched.
    const spanishWithDigits = [
      'Nací en 1985 cerca del río',
      'Tengo 26 años y 100 libros',
      'En el año 2000 había 21 casas',
    ];

    for (const s of spanishWithDigits) {
      const tokens = s.split(/\s+/);

      // NOT VACUOUS: at least one token genuinely expands under the es key.
      const expanded = tokens.some(t => normalize(t, 'es').length > 1);
      expect(expanded, `constructed Spanish "${s}" must contain an expanding token`).toBe(true);

      // THE PROPERTY, on Spanish: the transcript side (per token) and the
      // script side (whole text) produce the identical stream under 'es'.
      const perToken = tokens.flatMap(t => normalize(t, 'es'));
      const wholeText = normalize(s, 'es');
      expect(perToken.join(' '), `es compositionality on "${s}"`).toBe(wholeText.join(' '));

      // And the Spanish words really did survive the pass (not an all-digits
      // string that would dodge the es lexical rules entirely).
      expect(
        wholeText.some(w => /[a-zñáéíóú]/i.test(w)),
        `"${s}" must keep at least one real Spanish word through the es pass`,
      ).toBe(true);
    }

    // The measured bound, pinned so it cannot rot: es-lexical rules are 1->1,
    // only the shared digit reader expands on the es path.
    expect(canonicalize('1985', 'es')).toEqual(['nineteen', 'eighty', 'five']); // digit reader, es key
    expect(canonicalize('veintiseis', 'es')).toEqual(['veintiseis']);           // es cardinal: 1->1
    expect(canonicalize('del', 'es')).toEqual(['del']);                          // es contraction: not expanded
  });

  it('canonicalize is COMPOSITIONAL: per-token normalization equals whole-text normalization', () => {
    // The transcript side normalizes token-by-token; the script side normalizes
    // a whole segment at once. If these disagree, the same words carry
    // different normalized forms on the two sides of Contract 1→2 — which is
    // precisely the asymmetry P6 forbids, and it would be invisible in every
    // existing test because both sides are individually self-consistent.
    const report: string[] = [];

    for (const c of CORPORA) {
      const perToken = c.tokenTexts.flatMap(t => normalize(t, c.lang));
      const wholeText = normalize(c.tokenTexts.join(' '), c.lang);

      if (perToken.join('') !== wholeText.join('')) {
        // Report the FIRST divergence with context, not just a length delta —
        // a count tells you nothing about which construct broke.
        let i = 0;
        while (i < perToken.length && i < wholeText.length && perToken[i] === wholeText[i]) i++;
        report.push(
          `${c.key}: per-token ${perToken.length} words vs whole-text ${wholeText.length} words; ` +
            `first divergence at index ${i} — per-token ${JSON.stringify(perToken.slice(i, i + 6))} ` +
            `vs whole-text ${JSON.stringify(wholeText.slice(i, i + 6))}`,
        );
      }
    }

    expect(
      report,
      'canonicalize is not compositional. The transcript side (per token) and the script side ' +
        '(whole segment) therefore produce different word streams for the same text, which is a ' +
        'live Contract 1→2 P6 asymmetry and reopens Stage 1:\n' + report.join('\n'),
    ).toEqual([]);
  });

  it('the same raw word normalizes identically wherever it appears, across both sides', () => {
    // The direct form of P6's own question: "is there any case in the en/es
    // corpora where the script text and the transcript text are normalized
    // differently?" Built as a raw-word -> normalized-form map populated from
    // BOTH sides; a raw word reaching two different forms is an asymmetry.
    const violations: string[] = [];

    for (const c of CORPORA) {
      const seen = new Map<string, { form: string; side: string }>();

      const record = (raw: string, side: string): void => {
        if (raw.length === 0) return;
        const form = canonicalize(raw, c.lang).join(' ');
        const prior = seen.get(raw);
        if (prior === undefined) {
          seen.set(raw, { form, side });
        } else if (prior.form !== form && !isAcceptedHyphenClass(raw)) {
          violations.push(
            `${c.key}: "${raw}" normalizes to "${prior.form}" from the ${prior.side} side ` +
              `but "${form}" from the ${side} side`,
          );
        }
      };

      for (const seg of c.segmentTexts) {
        for (const w of stripStageDirections(seg).split(/\s+/)) record(w, 'script');
      }
      for (const t of c.tokenTexts) record(t, 'transcript');
    }

    expect(violations, `Same word, different normalized form:\n${violations.join('\n')}`).toEqual([]);
  });

  it('is language-keyed on both sides identically — es text takes the es path from either side', () => {
    // A "shared normalizer" that received a different language argument on each
    // side would satisfy the structural claim and violate the property. Both
    // production wrappers thread `languageCode` straight into `canonicalize`;
    // this pins that they agree, using the Spanish corpus where the key does
    // real work.
    const spanish = CORPORA.find(c => c.key === 'spanish')!;
    for (const t of spanish.tokenTexts.slice(0, 500)) {
      expect(normalize(t, 'es'), `transcript-side "${t}"`).toEqual(canonicalize(t, 'es'));
    }
    for (const seg of spanish.segmentTexts) {
      expect(normalizeSceneDoc(seg, 'es')).toEqual(canonicalize(stripStageDirections(seg), 'es').length > 0
        ? canonicalize(stripStageDirections(seg), 'es')
        : canonicalize(seg, 'es'));
    }
  });

  // -------------------------------------------------------------------------
  // (1) THE ONE DELIBERATE ASYMMETRY — measured, not assumed.
  // -------------------------------------------------------------------------

  it('stripStageDirections is the ONLY script-side-exclusive step, and it only ever REMOVES words', () => {
    // The accepted asymmetry, bounded. The strip is script-side only by design.
    // What must not happen is the strip ALTERING a word that survives it: that
    // would mean a word present on both sides carries different text on each,
    // which is an asymmetry rather than a removal. Measured as: every word the
    // script side emits after stripping is a word the unstripped text would
    // also have emitted.
    const violations: string[] = [];

    for (const c of CORPORA) {
      for (const seg of c.segmentTexts) {
        const stripped = normalizeSceneDoc(seg, c.lang);
        const unstripped = normalize(seg, c.lang);
        const pool = new Set(unstripped);
        for (const w of stripped) {
          if (!pool.has(w)) {
            violations.push(`${c.key}: stripping produced the new word "${w}" in: ${seg.slice(0, 90)}`);
          }
        }
      }
    }

    expect(
      violations,
      `stripStageDirections altered words rather than only removing them:\n${violations.join('\n')}`,
    ).toEqual([]);
  });

  it('records the strip\'s blast radius — measured at ZERO on every corpus in scope', () => {
    // MEASURED, WS1 Session J: `stripStageDirections` changes the normalized
    // output of 0 of 444 v6 segments, 0 of 172 in 173, and 0 of 26 in Spanish.
    // It never fires on any committed corpus material in Stage 1's scope.
    //
    // Two consequences, both stated rather than glossed:
    //
    //  1. The one deliberate script-side-exclusive step contributes NO
    //     asymmetry on these corpora, because it never runs on them. P6's
    //     result is not resting on the strip being benign — the strip is
    //     absent.
    //  2. The preceding test ("only ever REMOVES words") is therefore also
    //     unexercised by these fixtures. It is kept because it is the assertion
    //     that would catch a future corpus containing directions, and because
    //     `stripStageDirections` has its own direct unit coverage in
    //     `textNormalize.test.ts` — but it earns no credit for P6 today, and
    //     this comment exists so nobody later reads it as though it did.
    //
    // Pinned at 0 rather than bounded loosely: a corpus that starts stripping
    // is a change in what these fixtures are, and should fail here and be
    // looked at, not absorbed by a generous threshold.
    for (const c of CORPORA) {
      const touched = c.segmentTexts.filter(
        seg => normalizeSceneDoc(seg, c.lang).join(' ') !== normalize(seg, c.lang).join(' '),
      ).length;
      expect(
        touched,
        `${c.key}: stripStageDirections now alters ${touched} segment(s); P6's "blast radius is zero" ` +
          'note is stale and the strip\'s contribution to symmetry must be re-measured.',
      ).toBe(0);
    }
  });
});
