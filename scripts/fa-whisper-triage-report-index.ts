/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// ---------------------------------------------------------------------------
// WS1 Task 5 Slice D13 Step 4 — Whisper triage report for index attribution.
//
// Sibling of `scripts/fa-whisper-triage-report.ts` (D12's own script, NOT
// modified by this slice) — identical methodology (D12's Part C:
// `alignQueryToSubject`-based matching against real Whisper token times,
// because the naive sequential-text-equality walk the ladder/attribution-
// isolation legs use is only valid when both sides tokenize the same
// underlying SCRIPT text, and is wrong here where one side is Whisper's own
// transcription of the actual audio), pointed at the `d13_measurement::
// whisper_triage_index` test's own dump filenames
// (`173-excerpt-240s-index-<rung>-words.json`) instead of D12's
// `173-excerpt-240s-ladder-<rung>-words.json`.
//
// WS1 Task 5 Slice D14 A1 — "plumbing check." D13's own combined table found
// `index-45s-vs-whisper` statistically indistinguishable from
// `whole-file-vs-whisper` itself (several percentiles identical to 2 decimal
// places) — striking enough that it deserves direct verification, not just
// belief: (1) SHA-256 both input word-JSON files and print the hashes, so a
// self-comparison bug (the "windowed" file accidentally being the same file
// as the reference) is visible in the file content itself, not just the file
// name; (2) if the hashes genuinely differ but several percentiles still
// coincide, print the top-10-by-|delta| per-word tail for EACH comparison so
// the coincidence is backed by the actual matched words, not asserted from
// the percentiles alone.
//
// NOT part of npm test/build. Run via:
//   FA_CHUNK_PLAN_DIR=<dir> npx tsx scripts/fa-whisper-triage-report-index.ts [rung]
// `[rung]` defaults to "45s" — must match whichever rung
// `d13_measurement::whisper_triage_index` was run with (`FA_D13_BEST_RUNG`).
// ---------------------------------------------------------------------------

import { createHash } from 'crypto';
import { readFileSync } from 'fs';
import { alignQueryToSubject, normalize } from '../src/services/whisperService';

const PLAN_DIR = process.env.FA_CHUNK_PLAN_DIR;
if (!PLAN_DIR) {
  console.error('FA_CHUNK_PLAN_DIR must be set (same dir the Rust d13_measurement tests wrote into).');
  process.exit(1);
}
const RUNG = process.argv[2] ?? '45s';
// Two percentiles counting as "still identical" despite different input
// files — 5ms is well under CTC frame quantization (20ms, conv_stride) so a
// coincidence at this resolution is genuinely surprising, not float-noise.
const COINCIDENCE_EPSILON_SEC = 0.005;

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
interface MatchedRecord {
  qi: number;
  text: string;
  faStart: number;
  faEnd: number;
  whisperStart: number;
  whisperEnd: number;
  startDiff: number;
  endDiff: number;
}
interface ReportResult {
  matched: number;
  startDiffs: number[];
  endDiffs: number[];
  records: MatchedRecord[];
  percentiles: { startP99: number; startMax: number; endP99: number; endMax: number };
}

function load<T>(filename: string): T {
  return JSON.parse(readFileSync(`${PLAN_DIR}/${filename}`, 'utf-8'));
}

function sha256File(filename: string): string {
  const bytes = readFileSync(`${PLAN_DIR}/${filename}`);
  return createHash('sha256').update(bytes).digest('hex');
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return NaN;
  const idx = Math.round((sorted.length - 1) * p);
  return sorted[Math.min(idx, sorted.length - 1)]!;
}

function report(label: string, faWords: RefWord[], whisperTokens: RawWhisperToken[]): ReportResult {
  // Query = FA words, one entry each, re-normalized via the SAME `normalize`
  // Whisper tokens use below — identical technique to
  // `fa-whisper-triage-report.ts`'s own `report()`.
  const queryWords: string[] = faWords.map(w => normalize(w.text)[0] ?? w.text);

  // Subject = Whisper tokens, expanded the same way `faChunkPlan.ts`'s own
  // `tokenWords` construction does; each resulting subject word inherits its
  // OWNING TOKEN's start/end.
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
  const records: MatchedRecord[] = [];
  let matched = 0;
  for (const op of alignment.ops) {
    if (op.type !== 'match') continue;
    const sj = alignment.matchedSubjectOf[op.qi];
    if (sj === undefined || sj < 0) continue;
    const faWord = faWords[op.qi]!;
    const whisperTime = subjectTimes[sj]!;
    const startDiff = Math.abs(whisperTime.start - faWord.start);
    const endDiff = Math.abs(whisperTime.end - faWord.end);
    startDiffs.push(startDiff);
    endDiffs.push(endDiff);
    records.push({
      qi: op.qi,
      text: faWord.text,
      faStart: faWord.start,
      faEnd: faWord.end,
      whisperStart: whisperTime.start,
      whisperEnd: whisperTime.end,
      startDiff,
      endDiff,
    });
    matched++;
  }
  const sortedStart = [...startDiffs].sort((a, b) => a - b);
  const sortedEnd = [...endDiffs].sort((a, b) => a - b);

  console.log(`\n=== ${label} ===`);
  console.log(`FA words=${faWords.length}, whisper subject words=${subjectWords.length}, matched=${matched}`);
  if (sortedStart.length === 0) {
    console.log('no matches — no distribution');
    return { matched: 0, startDiffs: [], endDiffs: [], records: [], percentiles: { startP99: NaN, startMax: NaN, endP99: NaN, endMax: NaN } };
  }
  console.log(
    `START(s) min=${sortedStart[0]!.toFixed(4)} p50=${percentile(sortedStart, 0.5).toFixed(4)} ` +
    `p90=${percentile(sortedStart, 0.9).toFixed(4)} p99=${percentile(sortedStart, 0.99).toFixed(4)} ` +
    `max=${sortedStart[sortedStart.length - 1]!.toFixed(4)}`,
  );
  console.log(
    `END(s)   min=${sortedEnd[0]!.toFixed(4)} p50=${percentile(sortedEnd, 0.5).toFixed(4)} ` +
    `p90=${percentile(sortedEnd, 0.9).toFixed(4)} p99=${percentile(sortedEnd, 0.99).toFixed(4)} ` +
    `max=${sortedEnd[sortedEnd.length - 1]!.toFixed(4)}`,
  );
  return {
    matched,
    startDiffs: sortedStart,
    endDiffs: sortedEnd,
    records,
    percentiles: {
      startP99: percentile(sortedStart, 0.99),
      startMax: sortedStart[sortedStart.length - 1]!,
      endP99: percentile(sortedEnd, 0.99),
      endMax: sortedEnd[sortedEnd.length - 1]!,
    },
  };
}

function printTopTail(label: string, records: MatchedRecord[], by: 'startDiff' | 'endDiff', n: number): void {
  const top = [...records].sort((a, b) => b[by] - a[by]).slice(0, n);
  console.log(`\n--- ${label}: top ${top.length} by |${by}| ---`);
  console.log('qi\ttext\tfaStart\tfaEnd\twhisperStart\twhisperEnd\tstartDiff\tendDiff');
  for (const r of top) {
    console.log(
      `${r.qi}\t${r.text}\t${r.faStart.toFixed(4)}\t${r.faEnd.toFixed(4)}\t` +
      `${r.whisperStart.toFixed(4)}\t${r.whisperEnd.toFixed(4)}\t${r.startDiff.toFixed(4)}\t${r.endDiff.toFixed(4)}`,
    );
  }
}

function loadWhisperTokens(): RawWhisperToken[] {
  return JSON.parse(readFileSync('.work-phase4/replay/173/transcript_tokens.json', 'utf-8'));
}

function main() {
  const referenceFile = '173-excerpt-240s-reference-words.json';
  const windowedFile = `173-excerpt-240s-index-${RUNG}-words.json`;

  const referenceHash = sha256File(referenceFile);
  const windowedHash = sha256File(windowedFile);
  console.log('=== A1 plumbing check: input word-JSON identity ===');
  console.log(`${referenceFile}: sha256=${referenceHash}`);
  console.log(`${windowedFile}: sha256=${windowedHash}`);
  if (referenceHash === windowedHash) {
    console.error(
      '\nBUG: the two input files are byte-identical — "whole-file-vs-whisper" and ' +
      `"index-${RUNG}-vs-whisper" would be comparing ${referenceFile} to itself, not a real ` +
      'windowed pass. Fix the file that produced this before trusting any percentile below.',
    );
    process.exit(1);
  }
  console.log('Hashes differ — the two comparisons below use genuinely different input files.\n');

  const wholeFileWords = load<RefWord[]>(referenceFile);
  const windowedWords = load<RefWord[]>(windowedFile);
  const allWhisperTokens = loadWhisperTokens();
  const audioDuration = wholeFileWords.length > 0 ? wholeFileWords[wholeFileWords.length - 1]!.end : 240;
  const whisperTokens = allWhisperTokens.filter(t => t.start < audioDuration + 5);

  const wholeFileResult = report('whole-file-vs-whisper', wholeFileWords, whisperTokens);
  const windowedResult = report(`index-${RUNG}-vs-whisper`, windowedWords, whisperTokens);

  const coincide =
    Math.abs(wholeFileResult.percentiles.startP99 - windowedResult.percentiles.startP99) < COINCIDENCE_EPSILON_SEC &&
    Math.abs(wholeFileResult.percentiles.startMax - windowedResult.percentiles.startMax) < COINCIDENCE_EPSILON_SEC &&
    Math.abs(wholeFileResult.percentiles.endP99 - windowedResult.percentiles.endP99) < COINCIDENCE_EPSILON_SEC &&
    Math.abs(wholeFileResult.percentiles.endMax - windowedResult.percentiles.endMax) < COINCIDENCE_EPSILON_SEC;

  console.log(`\n=== A1 verdict ===`);
  console.log(
    `whole-file p99/max: start=${wholeFileResult.percentiles.startP99.toFixed(4)}/${wholeFileResult.percentiles.startMax.toFixed(4)} ` +
    `end=${wholeFileResult.percentiles.endP99.toFixed(4)}/${wholeFileResult.percentiles.endMax.toFixed(4)}`,
  );
  console.log(
    `index-${RUNG}   p99/max: start=${windowedResult.percentiles.startP99.toFixed(4)}/${windowedResult.percentiles.startMax.toFixed(4)} ` +
    `end=${windowedResult.percentiles.endP99.toFixed(4)}/${windowedResult.percentiles.endMax.toFixed(4)}`,
  );

  if (coincide) {
    console.log(
      '\nPercentiles coincide within 5ms across both files despite different SHA-256 hashes — ' +
      'printing the top-10-by-|delta| tail for each comparison so the coincidence is visible in the ' +
      'actual matched words, not just asserted from the summary statistics.',
    );
    printTopTail('whole-file-vs-whisper', wholeFileResult.records, 'startDiff', 10);
    printTopTail(`index-${RUNG}-vs-whisper`, windowedResult.records, 'startDiff', 10);
  } else {
    console.log('\nPercentiles do not coincide within 5ms — no tail dump needed.');
  }
}

main();
