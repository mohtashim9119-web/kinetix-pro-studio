/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// ---------------------------------------------------------------------------
// G4 Unit 4 — local pre-FA coverage check. Local sibling of Wave 3's planned
// CLOUD mid-coverage abort (`docs/ws1-sync-pipeline/operator-product-
// rulings-2026-09-19.md`): the cloud pipeline discovers a script/audio
// mismatch only AFTER paying for cloud transcription, so it aborts
// mid-coverage and the user bears the cost already incurred — a deliberate
// cost-allocation decision for a billed remote job. Locally there is no
// billed cost to allocate, but FA compute is still real, multi-minute local
// work (76-231s measured on real corpora, forcedAlignmentRun.ts's own
// FaRunResult doc comment) — and unlike the cloud case, the cached Whisper
// transcript this check needs is ALREADY on hand before FA ever starts, so a
// local run gets the thing the cloud run cannot: the chance to ask BEFORE
// spending the cost, not just account for it after.
//
// CHEAP, not an alignment. This is a coarse bag-of-words intersection
// against the cached transcript's own tokens — no Hirschberg pass, no
// per-segment matching, nothing `computeRunContext`/`alignScenestoTranscript`
// already do more precisely (and more expensively) downstream. It exists to
// catch a GROSS mismatch (wrong script entirely, wrong audio entirely)
// cheaply, not to replace real matching.
//
// TWO BANDS, WARN-vs-PAUSE, NEVER AUTO-ABORT (operator design, mirroring G4
// Unit 3's WPM check): marginal coverage produces a warn-only sync-log
// finding and the run proceeds to FA normally; hopeless coverage PAUSES —
// reusing the SAME SyncPausedDialog every other FA precondition/failure
// already uses (`forcedAlignmentRun.ts`'s `FaFailureKind`) — and asks the
// user to continue anyway or cancel. It never decides FOR the user, and it
// never silently skips FA on its own say-so.
// ---------------------------------------------------------------------------

import { canonicalize } from './textNormalize';
import { expandTokensToWords } from './transcriptWords';
import type { FaLanguageCode } from './faTextNormalize';
import type { VideoSegment, TranscriptToken } from '../types';

export type LocalCoverageBand = 'ok' | 'marginal' | 'hopeless';

export interface LocalCoverageResult {
  /** Fraction of script words found in the transcript's own word bag —
   *  1.0 when there is nothing to check (an empty script). */
  coverage: number;
  band: LocalCoverageBand;
  scriptWordCount: number;
}

/** Coverage at or above this fraction is 'ok' — no finding at all, matching
 *  every other warn-only gate's "silent on a clean run" convention. Below
 *  it, down to `LOCAL_COVERAGE_HOPELESS_MAX`, is 'marginal' (warn-only).
 *  0.5 sits below `WORD_COVERAGE_MIN_RATIO` (syncConstants.ts, 0.6) — that
 *  constant flags one already-matched SEGMENT missing too many of its own
 *  words after real alignment; this one is a coarse, unaligned, WHOLE-SCRIPT
 *  bag-of-words estimate taken before any matching has run at all, so it is
 *  deliberately looser: real, correctly-paired scripts routinely lose some
 *  fraction of their bag-intersection to filler words / stage directions /
 *  paraphrasing the aligner recovers via real order-aware matching that this
 *  cheap unordered check cannot see. SWAPPABLE — propose a different value
 *  in review if it proves too tight or too loose in practice. */
export const LOCAL_COVERAGE_MARGINAL_MAX = 0.5;

/** At or below this fraction, coverage is 'hopeless' — pause-and-ask before
 *  spending FA compute. Even a genuinely UNRELATED script and transcript
 *  share some words purely from common function words ("the", "a", "and",
 *  "to") in the same language, so 0 is not the right floor for "clearly
 *  wrong pairing" — but well below `LOCAL_COVERAGE_MARGINAL_MAX`, a script
 *  matching one in five or fewer of its own words against the ENTIRE
 *  transcript (not just its neighbourhood — this check has no position
 *  information at all) is the shape of a wrong-script/wrong-audio pairing,
 *  not a real one with some real mismatch. SWAPPABLE — propose a different
 *  value in review if it proves too tight or too loose in practice. */
export const LOCAL_COVERAGE_HOPELESS_MAX = 0.2;

function wordBag(words: readonly string[]): Map<string, number> {
  const bag = new Map<string, number>();
  for (const w of words) bag.set(w, (bag.get(w) ?? 0) + 1);
  return bag;
}

/**
 * Pure, synchronous, no I/O — directly unit-testable. `canonicalize`
 * (textNormalize.ts) is reused READ-ONLY for both sides so "the same word"
 * means the same thing here as everywhere else in this pipeline (contraction
 * expansion, digit-to-word, ASCII/diacritic folding) — never a third, ad hoc
 * normalizer that could disagree with the real matcher about what counts as
 * a match.
 */
export function computeLocalPreFaCoverage(
  scriptSegments: readonly Pick<VideoSegment, 'text'>[],
  transcriptTokens: readonly Pick<TranscriptToken, 'text'>[],
  languageCode?: FaLanguageCode,
): LocalCoverageResult {
  const scriptWords = scriptSegments.flatMap(s => (s.text ? canonicalize(s.text, languageCode) : []));
  if (scriptWords.length === 0) return { coverage: 1, band: 'ok', scriptWordCount: 0 };

  const transcriptWords = expandTokensToWords(transcriptTokens, languageCode).words.map(w => w.word);
  const bag = wordBag(transcriptWords);

  let matched = 0;
  for (const w of scriptWords) {
    const count = bag.get(w) ?? 0;
    if (count > 0) {
      matched++;
      bag.set(w, count - 1);
    }
  }

  const coverage = matched / scriptWords.length;
  const band: LocalCoverageBand =
    coverage <= LOCAL_COVERAGE_HOPELESS_MAX ? 'hopeless'
    : coverage <= LOCAL_COVERAGE_MARGINAL_MAX ? 'marginal'
    : 'ok';
  return { coverage, band, scriptWordCount: scriptWords.length };
}
