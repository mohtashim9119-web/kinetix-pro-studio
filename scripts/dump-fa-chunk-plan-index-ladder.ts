/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// ---------------------------------------------------------------------------
// WS1 Task 5 Slice D13 Step 4 — index-attribution chunk-plan dumper.
//
// Sibling of `scripts/dump-fa-chunk-plan-ladder.ts` (D12's time-attribution
// ladder dumper) — same real 240s excerpt of the 173-project replay fixture,
// same two coalesce targets that Step 4 asks be reported beside D12's rows
// (7s and 45s only — not the full 7/20/45/90 ladder; the wider ladder already
// answered "does growing the window help" in D12, D13's question is "does
// changing the ATTRIBUTION RULE at a fixed window size help"), but drives
// `computeFaChunkPlanWithAttribution(..., 'script-word-index', target)`
// (`faChunkPlan.ts`, WS1 Task 5 Slice D13 Step 3) instead of
// `computeFaChunkPlanCoalesced`.
//
// NOT part of `npm test`/`npm run build`. Run via:
//   npx tsx scripts/dump-fa-chunk-plan-index-ladder.ts
// Writes JSON plans to SCRATCHPAD_DIR (falls back to ./tmp-fa-chunk-plans/)
// for the Rust `d13_measurement` tests to consume against the real WAV at the
// same fixture path.
// ---------------------------------------------------------------------------

import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { computeFaChunkPlanWithAttribution } from '../src/services/faChunkPlan';
import type { TranscriptToken, VideoSegment } from '../src/types';
import type { SilenceInterval } from '../src/services/silenceDetector';

const FIXTURE_DIR = '.work-phase4/replay/173';
const OUT_DIR = process.env.SCRATCHPAD_DIR ?? './tmp-fa-chunk-plans';
const CUTOFF_SEC = 240;
const TARGETS: Array<[number, string]> = [[7, '7s'], [45, '45s']];

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

  const segments = allSegments.filter(s => s.startTime < CUTOFF_SEC);
  const audioDuration = Math.max(...segments.map(s => s.startTime + s.duration));
  const tokens = allTokens.filter(t => t.startSec < audioDuration);
  const silences = allSilences.filter(s => s.startSec < audioDuration);

  mkdirSync(OUT_DIR, { recursive: true });
  for (const [target, label] of TARGETS) {
    const chunks = computeFaChunkPlanWithAttribution(segments, tokens, silences, audioDuration, 'script-word-index', target);
    writeFileSync(`${OUT_DIR}/173-excerpt-240s-index-${label}.json`, JSON.stringify({ audioDuration, chunks }, null, 2));
    const maxDur = Math.max(...chunks.map(c => c.endSec - c.startSec));
    const totalWords = chunks.reduce((n, c) => n + c.text.split(' ').filter(Boolean).length, 0);
    console.log(`[index-${label}] target=${target}s chunks=${chunks.length} max=${maxDur.toFixed(2)}s words=${totalWords}`);
  }
}

main();
