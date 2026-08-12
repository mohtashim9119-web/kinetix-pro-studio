/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// ---------------------------------------------------------------------------
// WS1 Task 5 Slice D12 Step 5C — Whisper triage report.
//
// Consumes the two JSON word dumps `fa_onnx.rs`'s `d12_measurement::
// whisper_triage` test writes (whole-file reference, already cached by every
// `d12_measurement` test as `173-excerpt-240s-reference-words.json`; the
// chosen ladder rung's windowed output, `173-excerpt-240s-ladder-<rung>-
// words.json`) plus the real Whisper `transcript_tokens.json`, and computes
// the actual agreement stats — deliberately NOT done in Rust. A first Rust-
// side attempt used the same naive sequential-text-equality walk the
// whole-file-vs-windowed comparison uses, and it is WRONG here: that walk is
// only valid when both sides tokenize the SAME underlying text (true for
// whole-file vs. windowed — both come from `segment.text`, the SCRIPT).
// Whisper's tokens come from the actual spoken AUDIO, which routinely
// differs in wording from the script — exactly the gap `alignQueryToSubject`
// (this file's own import, the SAME Hirschberg-style fuzzy aligner
// `faChunkPlan.ts`/`whisperService.ts` use everywhere else in this codebase
// for script-vs-transcript matching) exists to bridge. The naive walk matched
// only 4/569 words in a real run before this fix.
//
// NOT part of npm test/build. Run via:
//   FA_CHUNK_PLAN_DIR=<dir> npx tsx scripts/fa-whisper-triage-report.ts [rung]
// `[rung]` defaults to "90s" — must match whichever rung
// `d12_measurement::whisper_triage` was run with (`FA_D12_BEST_RUNG`).
// ---------------------------------------------------------------------------

import { readFileSync } from 'fs';
import { alignQueryToSubject, normalize } from '../src/services/whisperService';

const PLAN_DIR = process.env.FA_CHUNK_PLAN_DIR;
if (!PLAN_DIR) {
  console.error('FA_CHUNK_PLAN_DIR must be set (same dir the Rust d12_measurement tests wrote into).');
  process.exit(1);
}
const RUNG = process.argv[2] ?? '90s';

interface RefWord {
  text: string;
  start: number;
  end: number;
}
interface RawWhisperToken {
  text: string;
  start: number;
  end: number;
}

function load<T>(filename: string): T {
  return JSON.parse(readFileSync(`${PLAN_DIR}/${filename}`, 'utf-8'));
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return NaN;
  const idx = Math.round((sorted.length - 1) * p);
  return sorted[Math.min(idx, sorted.length - 1)]!;
}

function report(label: string, faWords: RefWord[], whisperTokens: RawWhisperToken[]) {
  // Query = FA words, one entry each, re-normalized via the SAME `normalize`
  // Whisper tokens use below, so both sides share one canonicalization
  // (contraction expansion, digit reading, etc.) — FA's own text is already
  // vocab-normalized (lowercase, boundary-stripped, no digits), so this is
  // near-idempotent for FA words in practice; falls back to the FA word's
  // own text unchanged if `normalize` drops or splits it (rare — FA words
  // are already single, clean tokens).
  const queryWords: string[] = faWords.map(w => normalize(w.text)[0] ?? w.text);

  // Subject = Whisper tokens, expanded the same way `faChunkPlan.ts`'s own
  // `tokenWords` construction does (a token may canonicalize to 0+ words);
  // each resulting subject word inherits its OWNING TOKEN's start/end
  // (sub-token precision isn't available — same convention used throughout
  // this codebase, e.g. `whisperService.ts`'s `extractSegmentAlignments`).
  const subjectWords: string[] = [];
  const subjectTimes: Array<{ start: number; end: number }> = [];
  for (const t of whisperTokens) {
    for (const w of normalize(t.text)) {
      if (w.length > 0) {
        subjectWords.push(w);
        subjectTimes.push({ start: t.start, end: t.end });
      }
    }
  }

  const alignment = alignQueryToSubject(queryWords, subjectWords);

  const startDiffs: number[] = [];
  const endDiffs: number[] = [];
  let matched = 0;
  for (const op of alignment.ops) {
    if (op.type !== 'match') continue;
    const sj = alignment.matchedSubjectOf[op.qi];
    if (sj === undefined || sj < 0) continue;
    const faWord = faWords[op.qi]!;
    const whisperTime = subjectTimes[sj]!;
    startDiffs.push(Math.abs(whisperTime.start - faWord.start));
    endDiffs.push(Math.abs(whisperTime.end - faWord.end));
    matched++;
  }
  startDiffs.sort((a, b) => a - b);
  endDiffs.sort((a, b) => a - b);

  console.log(`\n=== ${label} ===`);
  console.log(`FA words=${faWords.length}, whisper subject words=${subjectWords.length}, matched=${matched}`);
  if (startDiffs.length === 0) {
    console.log('no matches — no distribution');
    return;
  }
  console.log(
    `START(s) min=${startDiffs[0]!.toFixed(4)} p50=${percentile(startDiffs, 0.5).toFixed(4)} ` +
    `p90=${percentile(startDiffs, 0.9).toFixed(4)} p99=${percentile(startDiffs, 0.99).toFixed(4)} ` +
    `max=${startDiffs[startDiffs.length - 1]!.toFixed(4)}`,
  );
  console.log(
    `END(s)   min=${endDiffs[0]!.toFixed(4)} p50=${percentile(endDiffs, 0.5).toFixed(4)} ` +
    `p90=${percentile(endDiffs, 0.9).toFixed(4)} p99=${percentile(endDiffs, 0.99).toFixed(4)} ` +
    `max=${endDiffs[endDiffs.length - 1]!.toFixed(4)}`,
  );
}

function loadWhisperTokens(): RawWhisperToken[] {
  return JSON.parse(readFileSync('.work-phase4/replay/173/transcript_tokens.json', 'utf-8'));
}

function main() {
  const wholeFileWords = load<RefWord[]>('173-excerpt-240s-reference-words.json');
  const windowedWords = load<RefWord[]>(`173-excerpt-240s-ladder-${RUNG}-words.json`);
  const allWhisperTokens = loadWhisperTokens();
  const audioDuration = wholeFileWords.length > 0 ? wholeFileWords[wholeFileWords.length - 1]!.end : 240;
  const whisperTokens = allWhisperTokens.filter(t => t.start < audioDuration + 5);

  report('whole-file-vs-whisper', wholeFileWords, whisperTokens);
  report(`ladder-${RUNG}-vs-whisper`, windowedWords, whisperTokens);
}

main();
