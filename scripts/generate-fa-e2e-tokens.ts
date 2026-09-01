/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// ---------------------------------------------------------------------------
// WS1 Task 5 Slice D4 — target-token-id generator for the end-to-end FA
// parity fixture family (`fa-e2e-alignment-*.json`).
//
// Drives the EXISTING, tested `src/services/faTextNormalize.ts` module (not
// reimplemented, not modified) over the three D2/D3 fixture texts, then maps
// each representable word's characters to vocab ids (char_to_id + a single
// word-delimiter id strictly between words) — the same tokenization contract
// `src-tauri/src/fa_onnx.rs`'s `text_to_token_ids` implements in Rust. Using
// the live TS normalizer (the source of truth D3's own fixture-parity tests
// already prove Rust matches byte-for-byte) keeps this generator from
// reimplementing normalization a third time in a third language — the only
// NEW logic here is the trivial char->id/word-delimiter mapping step, kept
// deliberately dumb (a HashMap lookup) to minimize the risk of a spurious
// mismatch that isn't a real Rust bug.
//
// Slice D5 (2026-08-12) extended CASES with three fr/de/pt entries — real
// short utterances sourced from google/fleurs (CC-BY-4.0, HF-hosted), since
// no real fr/de/pt audio existed anywhere in this repo/private corpus before
// this slice (see docs/work-in-progress.md §5's D5 row; original source
// fa-text-to-spans-seam-d5-2026-08-12.md was deleted 2026-08-14, `9cf5867`;
// retrieve: `git show 251be64:docs/ws1-sync-pipeline/fa-text-to-spans-seam-d5-2026-08-12.md`).
//
// Prints JSON to stdout: one object per fixture case, each with
// {file, language, text, targetTokenIds, blankId}. Consumed by
// `scripts/capture-fa-e2e-reference.py` via a `npx tsx` subprocess call —
// deliberately NOT written to a committed intermediate file (only the final
// `fa-e2e-alignment-*.json` fixtures this feeds into are committed).
//
// Run via `npx tsx scripts/generate-fa-e2e-tokens.ts`.
// ---------------------------------------------------------------------------

import { readFileSync } from 'fs';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import {
  normalizeForForcedAlignment,
  vocabCharsFromRawVocab,
  type FaLanguageCode,
  type FaCardinalData,
} from '../src/services/faTextNormalize';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');

interface RawVocab {
  _provenance: { modelId: string };
  vocab: Record<string, number>;
}

function loadRawVocab(lang: FaLanguageCode): RawVocab {
  return JSON.parse(
    readFileSync(resolve(REPO, 'scripts', 'fixtures', `fa-vocab-${lang}.json`), 'utf-8'),
  ) as RawVocab;
}

function loadCardinalData(lang: FaLanguageCode): FaCardinalData {
  return JSON.parse(
    readFileSync(resolve(REPO, 'scripts', 'fixtures', `fa-cardinal-${lang}.json`), 'utf-8'),
  ) as FaCardinalData;
}

// -- the three D2/D3 fixture windows (same texts as `_provenance.text` in
// `scripts/fixtures/fa-emission-en-deep-night.json` /
// `fa-emission-en-mother-look.json` / `fa-emission-es-resultan-inutiles.json`),
// plus three D5 fr/de/pt entries sourced from google/fleurs (see this file's
// module doc comment)
interface Case {
  file: string;
  language: FaLanguageCode;
  text: string;
}

const CASES: Case[] = [
  { file: 'en-deep-night', language: 'en', text: 'It is deep in the night.' },
  { file: 'en-mother-look', language: 'en', text: 'Your mother does not look up.' },
  { file: 'es-resultan-inutiles', language: 'es', text: 'pero resultan inútiles.' },
  {
    file: 'fr-pas-juste',
    language: 'fr',
    text: "Cela ne me semblait pas logique ; ce n'était certainement pas juste.",
  },
  { file: 'de-nicht-fair', language: 'de', text: 'Das erschien mir nicht sinnvoll; es war ganz gewiss nicht fair.' },
  {
    file: 'pt-site-publico',
    language: 'pt',
    text: 'O resultado da análise do gráfico será disponibilizado no site público.',
  },
];

function textToTokenIds(
  text: string,
  language: FaLanguageCode,
  vocab: Record<string, number>,
  vocabChars: Set<string>,
  cardinalData: FaCardinalData,
): { targetTokenIds: number[]; blankId: number; normalizedText: string } {
  const blankId = vocab['<pad>'];
  const wordDelimId = vocab['|'];
  if (blankId === undefined || wordDelimId === undefined) {
    throw new Error('vocab is missing "<pad>" or "|"');
  }
  const result = normalizeForForcedAlignment(text, language, vocabChars, cardinalData);

  const ids: number[] = [];
  let first = true;
  for (const word of result.words) {
    if (!word.representable) continue;
    // A multi-word compositional cardinal reading (WS2 T3.2 Step 3b-iii) may
    // contain internal whitespace — split into fragments and insert the
    // word-delimiter id between them too, exactly like `fa_onnx.rs`'s
    // `tokenize_normalized_words` does (a fragment delimiter is
    // indistinguishable from a between-word delimiter at the CTC level).
    const fragments = (word.mapped as string).split(/\s+/).filter(f => f.length > 0);
    for (const fragment of fragments) {
      if (!first) ids.push(wordDelimId);
      first = false;
      for (const ch of fragment) {
        const id = vocab[ch];
        if (id === undefined) {
          throw new Error(
            `normalized word "${word.mapped}" contains char ${JSON.stringify(ch)} absent from vocab`,
          );
        }
        ids.push(id);
      }
    }
  }
  return { targetTokenIds: ids, blankId, normalizedText: result.text };
}

const output = CASES.map(({ file, language, text }) => {
  const raw = loadRawVocab(language);
  const vocabChars = vocabCharsFromRawVocab(raw.vocab);
  const cardinalData = loadCardinalData(language);
  const { targetTokenIds, blankId, normalizedText } = textToTokenIds(text, language, raw.vocab, vocabChars, cardinalData);
  return { file, language, text, normalizedText, targetTokenIds, blankId };
});

process.stdout.write(JSON.stringify(output));
