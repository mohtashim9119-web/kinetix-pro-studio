# FA text -> target-token-sequence seam — WS1 Task 5, Slice D5

**Status: seam documented and verified as already composed at HEAD (e1f6e57). fr/de/pt
extended after owner approval to source real audio from a public corpus — see §5.**

## 1. Where the seam actually lives

The D5 task brief frames this as "how the Python reference builds its target token
sequence from normalized text." That framing doesn't quite match the code: the Python
capture script (`scripts/capture-fa-e2e-reference.py`) does **not** build the target
token sequence itself — it shells out to `npx tsx scripts/generate-fa-e2e-tokens.ts`,
which drives the live `src/services/faTextNormalize.ts` module (D3's proven source of
truth) and does the char->id + delimiter mapping in TypeScript. Python only consumes
the already-built `target_token_ids` as an argument to
`torchaudio.functional.forced_align`.

The mapping-from-normalized-words-to-ids step is implemented **twice**, deliberately,
in two languages, with matching doc comments and identical behavior verified by the
`e2e_parity` Rust test (see §3):

- TS: `scripts/generate-fa-e2e-tokens.ts`'s `textToTokenIds()` (lines 68-98)
- Rust: `src-tauri/src/fa_onnx.rs`'s `text_to_token_ids()` (lines 314-345, production
  code — this is what `align()` itself calls, not test-only scaffolding)

Both call the (off-limits, unmodified) normalizer first —
`normalizeForForcedAlignment` / `crate::fa::text::normalize_for_forced_alignment` —
which returns a language-aware, NFC-normalized word list where each word is either
`representable` (with a vocab-safe `mapped` string) or not.

## 2. The exact rules (identical in both implementations)

Given the normalizer's word list, in order:

1. **Drop non-representable words entirely.** A word the normalizer marked
   unrepresentable (digit-bearing, or contains a character absent from the
   language's vocab after normalization) contributes **zero** ids — not a
   placeholder, not a delimiter, nothing.
2. **Word-delimiter (`|`) insertion is strictly BETWEEN two kept (representable)
   words**, never leading, never trailing. Implemented via a `first` flag: the
   delimiter is emitted immediately before a kept word's characters, but only if a
   kept word has already been emitted before it. A dropped word never triggers a
   delimiter on either side of it — two representable words separated only by a
   dropped middle word get exactly one delimiter between them, not two, not zero.
3. **Character mapping** is a straight `char -> vocab id` lookup per character of
   the word's normalized `mapped` string, via the vocab's single-codepoint entries
   (`char_to_id`). No fallback, no substitution — the normalizer's own invariant
   guarantees every char in a `representable` word's `mapped` string exists in the
   vocab; a miss here is treated as an invariant violation (`panic!` in Rust,
   `throw` in TS), not a silently-dropped char.
4. **No blank/pad token in the target sequence.** `<pad>`'s vocab id (`blank_id`)
   is looked up and returned/passed alongside the sequence, but is never itself an
   element of `target_token_ids` — it's a parameter to the CTC forced-alignment DP
   (`forced_align`/`merge_tokens`), not part of the target path.
5. **No star/wildcard/catch-all token.** Unlike some wav2vec2-based forced-aligner
   setups that map genuinely out-of-vocabulary spans to a `<star>` catch-all token,
   this pipeline has no such token: an unrepresentable word is dropped (rule 1), not
   substituted.
6. **Empty result is a hard error, not silently accepted downstream.** If every word
   in the text is dropped, `target_token_ids` is empty; production `align()`
   (`fa_onnx.rs` line 374) returns `FaOnnxError::EmptyTokenization` rather than
   feeding an empty target to the DP. (Not separately exercised by the e2e fixtures
   below — all three have plenty of representable words — but noted here since it's
   part of the seam's contract.)

No ambiguity was found in either implementation — the TS and Rust doc comments
describe the same contract in the same words, and (see §3) the Rust production
tokenizer's output is asserted byte-identical to the TS-derived, fixture-recorded
sequence for all three existing fixtures. STOP condition (a) — "the reference's
target-sequence construction is ambiguous" — does not apply.

## 3. This composition already exists at HEAD — Gap (a) is already closed

The D5 brief's stated gap (a) was: *"No test takes raw transcript text through to
spans... the seam ... is unverified in Rust."* Reading `src-tauri/src/fa_onnx.rs`'s
`e2e_parity` module (added in D4, e1f6e57) shows this is no longer accurate:

`e2e_parity::run_one` (fa_onnx.rs:840-949):
1. Reads `source_text` from the fixture's `_provenance.text` (raw transcript text).
2. Calls **production** `text_to_token_ids(source_text, lang_enum, &vocab)` — i.e.
   raw text -> `fa::text` normalizer -> target token ids, the exact composed step
   the D5 brief asks for.
3. Asserts the result equals the fixture's recorded `target_token_ids` (hard gate,
   `assert_eq!`, fa_onnx.rs:882-887).
4. Feeds the **derived** ids (`got_target_ids`, not the fixture's) into the real
   ONNX forward pass + Viterbi DP + merge — so the span computation itself is
   downstream of the text-derived sequence, not a fixture shortcut.
5. Asserts span count, per-span token/start/end (zero tolerance), and reports
   target-token-count / merged-span-count and max abs score diff exactly as this
   slice's item 6 asks for.

Confirmed by rerunning the composed test with `FA_REQUIRE_ORT=1` and a real
`ORT_DYLIB_PATH` (see final report for the full run):

```
fa-e2e-alignment-es-resultan-inutiles.json: 22 target tokens, 179 frames, 22 merged spans (expected 22)
fa-e2e-alignment-en-mother-look.json: 28 target tokens, 207 frames, 28 merged spans (expected 28)
fa-e2e-alignment-en-deep-night.json: 23 target tokens, 191 frames, 23 merged spans (expected 23)
```

**Non-vacuity proof (this slice's item 6):** temporarily incremented
`target_token_ids[0]` in `fa-e2e-alignment-es-resultan-inutiles.json` by 1, reran
`e2e_es_resultan_inutiles` — failed exactly at the token-sequence `assert_eq!` with
a left/right mismatch printed, as expected. Restored via `git checkout --` and
reran — passed again. No other file was touched during this probe.

## 4. `target_token_ids`'s dual role — relabeled, not renamed

The D5 brief asks to "relabel [`target_token_ids`] unambiguously as
expected-derived-output, not input" while keeping the field. The field is
inherently dual-purpose and that's not a bug: it is the **expected output** of the
text->tokens step (what `e2e_parity` asserts the Rust tokenizer must reproduce) and,
by necessity of how CTC forced alignment works, it is also a required **input
parameter** to `torchaudio.functional.forced_align` in the capture script (the DP
needs a target sequence to align against — there's no way to compute per-token spans
without one). Renaming the JSON key would not remove that second role, so the fixture
key stays `target_token_ids`; what changed is `capture-fa-e2e-reference.py`'s
`_provenance.note`, which now states explicitly that the field is the TS-normalizer-
derived *expected* tokenization output, supplied to `forced_align` only because the
alignment DP requires a target sequence as its input contract — not because it is
independently sourced input data.

## 5. fr/de/pt audio — sourced from google/fleurs after owner approval

No real, spoken French/German/Portuguese audio existed anywhere in this repository
or its known private research corpus (`~/Downloads/All Projects Test Data/`, checked
directly — every project's `Script.txt` is English except "Spanish Project") at the
start of this slice. The only fr/de/pt material found:

- `.work-phase4/spike-runtime/cv-targets/{fr,de,pt}.txt` — Common Voice **target
  sentence text only**, no audio, used for the 2026-08-12 vocab-representability
  text study (`docs/ws1-sync-pipeline/measurements/fa-vocab-representability-2026-08-12.md`).
- `export-fa-onnx.py`'s `DEFAULT_VERIFY_AUDIO` — a single **English** clip
  (`C05_v6_it_trailing_word.wav`) reused across all 5 languages' ONNX export
  fidelity checks. That reuse is explicitly documented as valid *only* for
  structural forward-pass fidelity ("the audio's language does not need to match
  the model under test") — it is not real fr/de/pt speech and is not suitable as a
  forced-alignment span-parity fixture, which requires real audio matched to real
  transcript text in the target language.

This was reported per STOP condition (g) rather than substituted with synthetic
audio. **Owner approved sourcing from a public corpus.** Three short real
utterances were fetched from `google/fleurs` (CC-BY-4.0, Google's standard
multilingual speech-eval corpus, hosted on Hugging Face, `validation` split),
confirmed with the owner by exact sentence/duration/size before downloading:

| lang | file key | source id | duration | text |
|---|---|---|---|---|
| fr | `fr-pas-juste` | fleurs fr_fr#1577 | 4.62s | "Cela ne me semblait pas logique ; ce n'était certainement pas juste." |
| de | `de-nicht-fair` | fleurs de_de#1577 | 5.40s | "Das erschien mir nicht sinnvoll; es war ganz gewiss nicht fair." |
| pt | `pt-site-publico` | fleurs pt_br#1552 | 5.64s | "O resultado da análise do gráfico será disponibilizado no site público." |

(fr/de share source id 1577 — FLEURS is a parallel corpus, same underlying sentence
translated per language; coincidental, not deliberately matched.)

Downloaded via `curl` from Hugging Face's `datasets-server.huggingface.co`
presigned-URL API into the existing `.work-phase4/replay/{fr,de,pt}/audio_16k.wav`
convention (gitignored scratch dir, matching the existing en/es pattern) — verified
16kHz mono float32 WAV before use, matching the pipeline's format assumption exactly
(no resampling needed).

ONNX models for all 5 languages were already present locally
(`~/Library/Application Support/com.kinetix.pro-studio/fa-models/{en,es,fr,de,pt}/model.onnx`,
from the original five-language spike) — only real audio was missing.

**Pipeline extension.** No `fa-onnx-emission-*.json` D2 fixture or MMS_FA
`fa-emission-*.json` windowing fixture exists for fr/de/pt, so `capture-fa-e2e-
reference.py` gained a `RAW_CLIP_CASES` path that runs the ONNX forward pass
in-process (via `onnxruntime`, identical zero-mean/unit-var preprocessing to
`capture-fa-onnx-reference.py`) directly against each whole clip (no windowing —
each clip is already a short standalone utterance), then feeds that emission into
the same independent `torchaudio.functional.forced_align`/`merge_tokens` step the
three D2-sourced cases use. Deliberately does **not** write a separate committed
`fa-onnx-emission-{fr,de,pt}-*.json` intermediate — an early attempt to do so (git-
reverted) produced a 2.59 MB French emission-matrix fixture alone, which would have
blown the 2 MB per-fixture budget before even reaching the final fixture; the final
`fa-e2e-alignment-*.json` fixture (no C-dimension emission matrix, just
input_samples + target_token_ids + blank_id + expected_spans) stays well under
budget the same way the three D2-sourced cases already do.

`generate-fa-e2e-tokens.ts`'s `CASES` gained the same three `{file, language, text}`
entries — no new logic, the existing language-parametrized TS tokenizer path handles
fr/de/pt exactly as it already handles en/es.

`src-tauri/src/fa_onnx.rs`'s `e2e_parity::FIXTURES` gained the same three entries
plus one `#[test]` each (`e2e_fr_pas_juste`, `e2e_de_nicht_fair`,
`e2e_pt_site_publico`) — no new Rust logic; `run_one` already generalizes over
language via `Language::from_code`/`load_vocab`.

**Results — zero divergences on all three, same zero-tolerance gate as en/es:**

| fixture | target tokens | frames | merged spans | max abs score diff |
|---|---|---|---|---|
| fr-pas-juste | 65 | 230 | 65 | 0.0000126 |
| de-nicht-fair | 61 | 269 | 61 | 0.0000161 |
| pt-site-publico | 70 | 281 | 70 | 0.0000017 |

Every span's start/end frame index is bit-for-bit identical to the independent
torchaudio reference; target-token-sequence assert (fa::text-derived vs.
TS-normalizer-derived) matches exactly for all three; no dropped/unrepresentable
words encountered in any of the three languages' chosen sentences (confirmed no
`text_to_token_ids` panic and every span accounted for). Score drift reported as
observation only, consistent in magnitude with the existing en/es D4 numbers.

Fixture sizes: fr 1.63 MB, de 1.88 MB, pt 1.84 MB (all under the 2 MB cap).
Cumulative FA fixture footprint across all of `scripts/fixtures/fa-*.json`: 12 MB
(under the 20 MB budget).
