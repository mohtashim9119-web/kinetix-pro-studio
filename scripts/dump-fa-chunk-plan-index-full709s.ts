/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// ---------------------------------------------------------------------------
// WS1 Task 5 Slice D21 Step 1 — full 709s index-attribution chunk-plan dumper.
//
// Sibling of `scripts/dump-fa-chunk-plan.ts` (D11's time-attribution full-
// corpus dumper) and `scripts/dump-fa-chunk-plan-index-ladder.ts` (D13's
// index-attribution dumper, but scoped to the 240s excerpt with coalescing).
// This one drives `computeFaChunkPlanWithAttribution(..., 'script-word-index')`
// (NO coalesce target — same run/window granularity `dump-fa-chunk-plan.ts`'s
// own `173-full-709s-windowed.json` uses) over the FULL 709s project, so the
// only variable changed relative to that existing plan is the text-
// attribution rule itself (D20's root cause).
//
// NOT part of `npm test`/`npm run build`. Run via:
//   SCRATCHPAD_DIR=<dir> npx tsx scripts/dump-fa-chunk-plan-index-full709s.ts
// Writes `173-full-709s-index-windowed.json` to SCRATCHPAD_DIR (falls back to
// ./tmp-fa-chunk-plans/) for the Rust `d21_measurement` tests to consume
// against the real WAV at the same fixture path.
// ---------------------------------------------------------------------------

import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { computeFaChunkPlanWithAttribution } from '../src/services/faChunkPlan';
import type { TranscriptToken, VideoSegment } from '../src/types';
import type { SilenceInterval } from '../src/services/silenceDetector';

const FIXTURE_DIR = '.work-phase4/replay/173';
const OUT_DIR = process.env.SCRATCHPAD_DIR ?? './tmp-fa-chunk-plans';

interface RawFinalSegment {
  id: string;
  text: string;
  startTime: number;
  duration: number;
}
interface RawToken {
  text: string;
  start: number;
  end: number;
}
interface RawSilence {
  startSec: number;
  endSec: number;
}

function loadSegments(): RawFinalSegment[] {
  const d = JSON.parse(readFileSync(`${FIXTURE_DIR}/golden_baseline_segments.json`, 'utf-8'));
  return d.finalSegments;
}
function loadTokens(): RawToken[] {
  return JSON.parse(readFileSync(`${FIXTURE_DIR}/transcript_tokens.json`, 'utf-8'));
}
function loadSilences(): RawSilence[] {
  const d = JSON.parse(readFileSync(`${FIXTURE_DIR}/silences_app.json`, 'utf-8'));
  return d.silences;
}

function toVideoSegments(raw: RawFinalSegment[]): VideoSegment[] {
  return raw.map(s => ({
    id: s.id,
    text: s.text,
    startTime: s.startTime,
    duration: s.duration,
    transition: 'none',
    animation: 'none',
    order: 0,
  })) as VideoSegment[];
}
function toTranscriptTokens(raw: RawToken[]): TranscriptToken[] {
  return raw.map(t => ({ startSec: t.start, endSec: t.end, text: t.text }));
}
function toSilenceIntervals(raw: RawSilence[]): SilenceInterval[] {
  return raw.map(s => ({ startSec: s.startSec, endSec: s.endSec }));
}

function main() {
  const allSegments = toVideoSegments(loadSegments());
  const allTokens = toTranscriptTokens(loadTokens());
  const allSilences = toSilenceIntervals(loadSilences());

  const audioDuration = Math.max(...allSegments.map(s => s.startTime + s.duration));
  const tokens = allTokens.filter(t => t.startSec < audioDuration);
  const silences = allSilences.filter(s => s.startSec < audioDuration);

  const chunks = computeFaChunkPlanWithAttribution(allSegments, tokens, silences, audioDuration, 'script-word-index');

  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(`${OUT_DIR}/173-full-709s-index-windowed.json`, JSON.stringify({ audioDuration, chunks }, null, 2));

  const totalWords = chunks.reduce((n, c) => n + c.text.split(/\s+/).filter(Boolean).length, 0);
  console.log(
    `[index-full-709s] audioDuration=${audioDuration.toFixed(2)}s segments=${allSegments.length} ` +
    `chunks=${chunks.length} (max ${Math.max(...chunks.map(c => c.endSec - c.startSec)).toFixed(2)}s) words=${totalWords}`,
  );
}

main();
