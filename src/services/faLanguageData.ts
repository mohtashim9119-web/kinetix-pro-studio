/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// ---------------------------------------------------------------------------
// G4 Unit 2 — the runtime loader `faTextNormalize.ts`'s own header flagged as
// missing ("NOT wired into Apply Sync — no caller yet"). This is the ONE
// production data path for `scripts/fixtures/fa-vocab-<lang>.json` /
// `fa-cardinal-<lang>.json` on the TS side, mirroring
// `fa_onnx.rs`'s `vocab_json_for`/`cardinal_json_for` — which already embed
// the SAME five files at Rust compile time via `include_str!` and normalize
// production FA inference text with them. That Rust-side wiring means CTC
// inference itself has been correctly normalized all along; what was missing
// is the TS side agreeing with it. `computeFaChunkPlan`/`computeRunContext`'s
// qi (word-index) bookkeeping reads RAW, un-normalized chunk text — so any
// script word a normalization pass would expand or fold (a bare cardinal
// like "123" -> "one hundred twenty-three", a typographic variant folded to
// a vocab member) produces a DIFFERENT word count on the TS side than the
// text Rust actually ran inference against, desyncing chunk boundaries and
// every sibling gate's (R.10-R.13) qi-derived index math from what the model
// actually saw. Wiring this loader into `forcedAlignmentRun.ts`'s three
// `computeRunContext`-backed calls (G4 Unit 2) closes that gap.
//
// PACKAGING: these five vocab + five cardinal JSON files (10 total, ~90KB
// combined — see `scripts/fixtures/fa-vocab-*.json`/`fa-cardinal-*.json`)
// are imported here as plain ES module JSON imports (`resolveJsonModule`,
// tsconfig.json), the same way `fa_onnx.rs` embeds its own copy via
// `include_str!` at Rust compile time. Vite bundles a JSON import into the
// built JS output — identical across `npm run dev`, `tauri:dev`, and
// `tauri:build` (CLAUDE.md's three dev/build commands), with no separate
// Tauri resource/asset-serving step to configure or verify, and no runtime
// fetch that could fail on a fresh install. The data ships with the app
// because it ships with the JS bundle the app already is.
// ---------------------------------------------------------------------------

import type { FaCardinalData, FaLanguageCode } from './faTextNormalize';
import { vocabCharsFromRawVocab } from './faTextNormalize';

import vocabEn from '../../scripts/fixtures/fa-vocab-en.json';
import vocabEs from '../../scripts/fixtures/fa-vocab-es.json';
import vocabFr from '../../scripts/fixtures/fa-vocab-fr.json';
import vocabDe from '../../scripts/fixtures/fa-vocab-de.json';
import vocabPt from '../../scripts/fixtures/fa-vocab-pt.json';

import cardinalEn from '../../scripts/fixtures/fa-cardinal-en.json';
import cardinalEs from '../../scripts/fixtures/fa-cardinal-es.json';
import cardinalFr from '../../scripts/fixtures/fa-cardinal-fr.json';
import cardinalDe from '../../scripts/fixtures/fa-cardinal-de.json';
import cardinalPt from '../../scripts/fixtures/fa-cardinal-pt.json';

/** A language's normalization inputs, ready for
 *  `normalizeForForcedAlignment`/`computeFaChunkPlan`'s `vocabChars`/
 *  `cardinalData` parameters. */
export interface FaLanguageData {
  vocabChars: ReadonlySet<string>;
  cardinalData: FaCardinalData;
}

const RAW_VOCAB: Readonly<Record<FaLanguageCode, { vocab: Record<string, number> }>> = {
  en: vocabEn,
  es: vocabEs,
  fr: vocabFr,
  de: vocabDe,
  pt: vocabPt,
};

// The JSON's own shape carries extra, unmodeled metadata fields
// (`_provenance`, `ctcMarginExposure`, ...) beyond `FaCardinalData` —
// `faTextNormalize.ts`'s own doc comment on that interface says so
// explicitly ("this generator reads only the fields it composes with").
const RAW_CARDINAL: Readonly<Record<FaLanguageCode, FaCardinalData>> = {
  en: cardinalEn as FaCardinalData,
  es: cardinalEs as FaCardinalData,
  fr: cardinalFr as FaCardinalData,
  de: cardinalDe as FaCardinalData,
  pt: cardinalPt as FaCardinalData,
};

const cache = new Map<FaLanguageCode, FaLanguageData>();

/**
 * The shipped vocab/cardinal data for `language`, or `undefined` if this
 * build has no pack for it.
 *
 * NO SILENT FALLBACK (NR-6, per-pack readiness): a caller that gets
 * `undefined` back must treat that language as having no normalization
 * available for this run — falling through to unnormalized text (the
 * pre-Unit-2 behavior for every language, still correct-if-conservative,
 * `computeFaChunkPlan`'s own `languageCode`-alone path) rather than
 * silently substituting a DIFFERENT language's rules, which would be worse
 * than doing nothing. Today this never actually returns `undefined` — all
 * five `FaLanguageCode` members are shipped — but the type stays honest
 * about what a future language added to `FaLanguageCode` without a shipped
 * pack yet would get: a defined, checkable gap, not a silent wrong answer.
 */
export function loadFaLanguageData(language: FaLanguageCode): FaLanguageData | undefined {
  const cached = cache.get(language);
  if (cached) return cached;

  const rawVocab = RAW_VOCAB[language];
  const cardinalData = RAW_CARDINAL[language];
  if (!rawVocab || !cardinalData) return undefined;

  const data: FaLanguageData = { vocabChars: vocabCharsFromRawVocab(rawVocab.vocab), cardinalData };
  cache.set(language, data);
  return data;
}

/** Every language this build actually ships data for — used by tests and by
 *  any future per-pack-readiness UI that wants to enumerate what is
 *  available without hardcoding the five-language list a second time. */
export function shippedFaLanguages(): readonly FaLanguageCode[] {
  return Object.keys(RAW_VOCAB) as FaLanguageCode[];
}
