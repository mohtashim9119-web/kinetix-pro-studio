# FA vocab representability — corpus measurement, 2026-08-12

**What this is.** `faTextNormalize.ts` (added in the immediately-preceding commit,
`fc0e756`) has never been run against real corpus text. This measures exactly
that: how much real narration-script text survives its per-language,
vocab-aware normalization for the five shipping `jonatasgrosman/wav2vec2-large-
xlsr-53-{en,es,fr,de,pt}` models, and why the rest doesn't. **Measurement
only — `faTextNormalize.ts`/`textNormalize.ts` were not touched, nothing was
wired into Apply Sync.**

## Real project text vs. Common Voice fallback — stated plainly

| Lang | Text source | Kind |
|---|---|---|
| en | 8 real project `Script.txt` files from `~/Downloads/All Projects Test Data/` (100 Segs, 14 Base Segs, 173 Segs [golden-replay project], 294 Segs, Ancient Humans V9, Missing Segs, V6 Natural Long Pause Segs [golden-replay project], V8 Lin-en Fl-ax Concate Segs) | **REAL project text** |
| es | 1 real project `Spanish Script.txt` (Spanish Project — the golden-replay Spanish project) | **REAL project text** |
| fr | `.work-phase4/spike-runtime/cv-targets/fr.txt` — Common Voice target sentences (the same file the 2026-08-11 runtime spike's G2 step read) | Common Voice **fallback** — no real project text in this corpus is French |
| de | `.work-phase4/spike-runtime/cv-targets/de.txt` — same source | Common Voice **fallback** — no real project text in this corpus is German |
| pt | `.work-phase4/spike-runtime/cv-targets/pt.txt` — same source | Common Voice **fallback** — no real project text in this corpus is Portuguese |

The `~/Downloads/All Projects Test Data/` corpus (already documented as this
repo's private, non-committed research corpus — `scripts/fixtures/README.md`)
contains real narration script text only in English and Spanish. Every
project's `Script.txt` (the flowing prose narration) was used rather than its
`Sync.txt`/`sync.txt` twin — the two are the same words, `Sync.txt` just
chunks them under scene tags — using both would double-count every word.
`cv-targets/<lang>.txt` is the exact artifact the runtime spike's G2 step
(`docs/ws1-sync-pipeline/measurements/runtime-spike-2026-08-11.md`) read for
its uroman-disagreement measurement; unlike the rest of that spike's scratch
environment, this one file set survived on disk in the gitignored
`.work-phase4/spike-runtime/` and was reused here rather than re-fetched. G2
sampled 300 sentences per language from it; this measurement uses the full
file (fr 15,758 / de 15,588 / pt 4,642 sentences) for a stronger signal.

## Per-language results

| Lang | Kind | Total words | Unrepresentable | % | Digit-bearing | Character-not-in-vocab | Empty |
|---|---|---|---|---|---|---|---|
| en | real | 18,023 | 2,360 | 13.09% | 23 | 2,337 | 0 |
| es | real | 249 | 32 | 12.85% | 1 | 31 | 0 |
| fr | CV fallback | 154,817 | 0 | 0.00% | 0 | 0 | 0 |
| de | CV fallback | 142,082 | 0 | 0.00% | 0 | 0 | 0 |
| pt | CV fallback | 35,316 | 0 | 0.00% | 0 | 0 | 0 |

The `empty` reason never fires under the current implementation for any
language: `normalizeForForcedAlignment` filters zero-length whitespace tokens
out of `rawWords` before a single word reaches `normalizeWord`, so no word
can ever reach the reason-assignment step with nothing to classify. This is a
reachability fact about the code, not a finding that needed a corpus to
discover — stated here because 1.2 asked for the breakdown explicitly.

**Why fr/de/pt read exactly 0%.** Common Voice's per-language *sentence*
corpus (the target-sentence text used to validate ASR/CTC models, as opposed
to spoken audio) is itself pre-normalized to each model's training
convention: lowercase, no digits (numbers already spelled as words in the
source transcription), no punctuation. It is not raw human-authored prose —
it never exercises the normalizer's failure paths at all. **This 0% is not
evidence the fr/de/pt vocabs are more complete than en/es's; it is evidence
that Common Voice sentences are the wrong genre of text to stress-test
against.** The en/es real-project numbers are the only trustworthy read on
this normalizer's real-world behavior — see the verdict in the digits section
below for how that materially matters.

## Character-not-in-vocab: the twenty most frequent unrepresentable words

Aggregated across all reasons (not reason-filtered), lower-cased, original
`input` slice (i.e. as split by whitespace, punctuation still attached — see
below).

**en** (top 20 of 2,360 unrepresentable words, all counts from the 8-file
English corpus):

| Word | Count | | Word | Count |
|---|---|---|---|---|
| `it.` | 48 | | `you're` | 8 |
| `didn't` (curly apostrophe) | 22 | | `it,` | 8 |
| `you.` | 22 | | `time.` | 8 |
| `them.` | 15 | | `something.` | 7 |
| `doesn't` (curly) | 14 | | `years.` | 7 |
| `that's` (curly) | 13 | | `that.` | 7 |
| `don't` (curly) | 13 | | `on.` | 7 |
| `wasn't` (curly) | 11 | | `happened.` | 7 |
| `now.` | 10 | | `ship's` (curly) | 7 |
| `do.` | 8 | | `time,` | 7 |

**es** (32 unrepresentable words total, all count=1 — no repeats; 20 shown):
`scylla.`, `marítimo.`, `largos,`, `cabezas,`, `12`, `cuerpo.`, `sencillo:`,
`cerca,`, `tiempo.`, `cubierta.`, `ataque.`, `abierto;`, `acantilado.`,
`ella,`, `nuevo.`, `paso.`, `así,`, `armas,`, `inútiles.`, `marcha.`

**fr / de / pt:** no unrepresentable words — see the Common Voice caveat
above.

## Character-not-in-vocab: distinct offending characters and frequency

The normalizer reports only the *first* vocab-violating character it hits
per word (`normalizeWord` returns on the first failing character), so a word
with two offending characters is counted once, under whichever one comes
first. These counts are therefore a lower bound on true occurrence, not an
exact character census — stated plainly since the task calls this the
number that matters most.

**en** (9 distinct characters, 2,337 character-not-in-vocab words):

| Char | Codepoint | Count | What it is |
|---|---|---|---|
| `.` | U+002E | 1,357 | sentence-final period, glued to the preceding word by whitespace splitting |
| `,` | U+002C | 729 | comma, same cause |
| `’` | U+2019 | 196 | typographic (curly) apostrophe — every contraction in this corpus (`don’t`, `it’s`, `ship’s`, ...) is written with this, never the vocab's plain `'` |
| `:` | U+003A | 37 | colon |
| `?` | U+003F | 7 | question mark |
| `"` | U+0022 | 5 | straight double quote |
| `—` | U+2014 | 4 | em dash |
| `“` | U+201C | 1 | opening curly double quote |
| `​` | U+200B | 1 | zero-width space (invisible copy-paste artifact) |

**es** (6 distinct characters, 31 character-not-in-vocab words):

| Char | Codepoint | Count |
|---|---|---|
| `.` | U+002E | 17 |
| `,` | U+002C | 9 |
| `;` | U+003B | 2 |
| `:` | U+003A | 1 |
| `«` | U+00AB | 1 |
| `»` | U+00BB | 1 |

**fr / de / pt:** no offending characters observed (Common Voice caveat
above applies).

**Reading this table — cheap fix, not a coverage problem.** Every single
offending character on both real-text languages is either (a) ordinary
sentence/clause punctuation attached to a word because the normalizer splits
on whitespace only and does no punctuation stripping, or (b) a typographic
variant of a character the vocab *already contains in ASCII form* (curly
`’`/`“` vs. straight `'`/`"`, `«»` guillemets used as quote marks, an em dash
as a clause break). **Zero occurrences of a genuine missing letter or
diacritic** — the es measurement, in particular, confirms every accented
character actually used (`í`, `ó`, `á`, ...) passed the vocab check cleanly,
consistent with the vocab fixture design and `faTextNormalize.test.ts`'s
existing diacritic-preservation assertions. This is a short, fully-explained
list (9 and 6 distinct characters respectively) — not a long tail. The fix,
whenever it's scheduled, is a normalization/typographic-folding step
(curly-quote-to-straight, em-dash handling, strip attached sentence
punctuation before the per-character check) — not a vocab expansion, and not
in scope for this measurement to implement.

## Digit-bearing words

23 of en's 18,023 words (0.13%) and 1 of es's 249 words (0.40%) contain a
digit. Full en list (23/23, one per line, exactly as split from source text):

```
60,000  50,000  48.  41st  40  38  32  28  26  24.  21.  2001  1895.  1895,
1890s  13th  10:30  10  $9,400."  $9,400  $84,000  $28,000  $11,000.
```

es: `12` (only occurrence).

These are years, ordinals (`41st`, `13th`), decades (`1890s`), clock times
(`10:30`), and dollar amounts (`$11,000`) — exactly the digit content a
narration script naturally contains, and exactly the content Common Voice's
pre-normalized target sentences never show (hence 0 digit-bearing words on
fr/de/pt above — not because those languages avoid digits, but because that
corpus already spells every number as words before it ships as a training
target).

## 1.3 — does this evidence make digits blocking, or support deferring to Phase 3b?

**Supports keeping digits deferred to Phase 3b. The deciding number: digit-
bearing words are 24 of 18,272 real-corpus words across en+es combined —
0.131%.** Even taken alone and not netted against the punctuation-glue
majority above, digit-bearing loss is roughly two orders of magnitude smaller
than the character-not-in-vocab loss on the same real text (2,337+31 = 2,368
words, 12.96% of the combined en+es corpus) — and essentially all of *that*
majority is itself a punctuation-tokenization artifact, not a vocab gap
either. Blocking Phase 3a work on number expansion to fix a 0.13% loss,
before fixing a punctuation-stripping step that would recover most of a
12.96% loss at a fraction of the engineering cost, would be optimizing the
wrong problem first. Nothing about number expansion is implemented by this
measurement, per instruction — this is a measurement-driven priority
argument only.

## Commands used

```sh
# Bundled the throwaway TS measurement script with esbuild (no ts-node/tsx
# installed in this project) and ran it with plain node:
npx esbuild .work-phase4/spike-runtime/measure-fa-repr.ts --bundle \
  --platform=node --format=esm \
  --outfile=.work-phase4/spike-runtime/measure-fa-repr.mjs
node .work-phase4/spike-runtime/measure-fa-repr.mjs \
  > .work-phase4/spike-runtime/measure-fa-repr-output.json
```

The script itself (`measure-fa-repr.ts`) is **not committed** — per task
instruction, it stays in the gitignored `.work-phase4/spike-runtime/` scratch
directory alongside the `cv-targets/` files it reads. It imports
`normalizeForForcedAlignment`/`vocabCharsFromRawVocab` directly from
`src/services/faTextNormalize.ts` (unmodified) and each language's committed
`scripts/fixtures/fa-vocab-<lang>.json`, reads the 9 real-project text files
listed above from `~/Downloads/All Projects Test Data/` (this repo's
existing, non-committed private research corpus), and the 3 Common Voice
`cv-targets/<lang>.txt` files for fr/de/pt, then classifies every
whitespace-split word by the existing `FaWordResult.reason` string. No
`src/` file was read for anything other than the two named, unmodified
normalizer functions.
