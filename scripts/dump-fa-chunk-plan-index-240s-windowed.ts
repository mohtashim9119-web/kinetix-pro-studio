/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// ---------------------------------------------------------------------------
// WS1 Task 5 Slice D23 Step 3 — 240s-excerpt index-attribution chunk-plan
// dumper, UNCOALESCED (production-matching granularity).
//
// Sibling of `scripts/dump-fa-chunk-plan-index-full709s.ts` (D21 Step 1's
// full-709s index-attribution dumper, no coalesce target) but scoped to the
// 240s excerpt instead of the full project — the excerpt this codebase's
// whole-file reference (`173-excerpt-240s-reference-words.json`) actually
// covers, so index-attribution output can be compared DIRECTLY against that
// reference without D22 Step 3's mis-assignment-filtering proxy.
//
// `scripts/dump-fa-chunk-plan-index-ladder.ts` (D13 Step 4) already dumps
// 240s-excerpt index-attribution plans, but only at two COALESCED targets
// (7s, 45s) — this script adds the UNCOALESCED (no target) rung at the same
// 240s cutoff, matching the granularity `173-excerpt-240s-windowed.json`
// (time attribution) and `173-full-709s-index-windowed.json` (index
// attribution, full length) both already use.
//
// NOT part of `npm test`/`npm run build`. Run via:
//   SCRATCHPAD_DIR=<dir> npx tsx scripts/dump-fa-chunk-plan-index-240s-windowed.ts
// Writes `173-excerpt-240s-index-windowed.json` to SCRATCHPAD_DIR (falls
// back to ./tmp-fa-chunk-plans/) for a Rust `d23_measurement` test to consume
// against the real WAV at the same fixture path.
// ---------------------------------------------------------------------------

import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { computeFaChunkPlanWithAttribution } from '../src/services/faChunkPlan';
import type { TranscriptToken, VideoSegment } from '../src/types';
import type { SilenceInterval } from '../src/services/silenceDetector';

const FIXTURE_DIR = '.work-phase4/replay/173';
const OUT_DIR = process.env.SCRATCHPAD_DIR ?? './tmp-fa-chunk-plans';
const CUTOFF_SEC = 240;

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

  // Same "extend to the last fully-contained segment's own end" cutoff rule
  // dump-fa-chunk-plan.ts's buildPlan(240, '173-excerpt-240s') uses, so this
  // plan's own audioDuration matches 173-excerpt-240s-windowed.json's and
  // 173-excerpt-240s-reference-words.json's exactly.
  const segments = allSegments.filter(s => s.startTime < CUTOFF_SEC);
  const audioDuration = Math.max(...segments.map(s => s.startTime + s.duration));
  const tokens = allTokens.filter(t => t.startSec < audioDuration);
  const silences = allSilences.filter(s => s.startSec < audioDuration);

  const chunks = computeFaChunkPlanWithAttribution(segments, tokens, silences, audioDuration, 'script-word-index');

  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(`${OUT_DIR}/173-excerpt-240s-index-windowed.json`, JSON.stringify({ audioDuration, chunks }, null, 2));

  const totalWords = chunks.reduce((n, c) => n + c.text.split(/\s+/).filter(Boolean).length, 0);
  console.log(
    `[index-240s-windowed] audioDuration=${audioDuration.toFixed(2)}s segments=${segments.length} ` +
    `chunks=${chunks.length} (max ${Math.max(...chunks.map(c => c.endSec - c.startSec)).toFixed(2)}s) words=${totalWords}`,
  );
}

main();
