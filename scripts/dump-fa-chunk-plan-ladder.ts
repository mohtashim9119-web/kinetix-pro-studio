/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// ---------------------------------------------------------------------------
// WS1 Task 5 Slice D12 Step 5A — window-size-ladder chunk-plan dumper.
//
// Sibling of `scripts/dump-fa-chunk-plan.ts` (not a replacement — that
// script's own D11 output is untouched and still feeds `fa_onnx.rs`'s D11
// `real_corpus_measurement` tests). Drives `computeFaChunkPlanCoalesced`
// (WS1 Task 5 Slice D12) at coalesce targets 7s/20s/45s/90s over the same
// real 240s excerpt of the 173-project replay fixture
// (`.work-phase4/replay/173/` — gitignored, not committed), for the
// window-size-ladder measurement (`fa_onnx.rs`'s `d12_measurement::ladder_*`
// tests, WS1 Task 5 Slice D12 Step 5A).
//
// NOT part of `npm test`/`npm run build`. Run via:
//   npx tsx scripts/dump-fa-chunk-plan-ladder.ts
// Writes JSON plans to SCRATCHPAD_DIR (falls back to ./tmp-fa-chunk-plans/)
// for the Rust ladder tests to consume against the real WAV at the same
// fixture path.
// ---------------------------------------------------------------------------

import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { computeFaChunkPlanCoalesced } from '../src/services/faChunkPlan';
import type { TranscriptToken, VideoSegment } from '../src/types';
import type { SilenceInterval } from '../src/services/silenceDetector';

const FIXTURE_DIR = '.work-phase4/replay/173';
const OUT_DIR = process.env.SCRATCHPAD_DIR ?? './tmp-fa-chunk-plans';
const CUTOFF_SEC = 240;
// [coalesceTargetSec, label] — 7s is the "current, control" rung (close to
// today's natural, uncoalesced chunk granularity — median run 3.12s, p90
// 12.04s per Slice D12 Step 3(a)'s own measurement), not identical to the
// unmerged plan.
const TARGETS: Array<[number, string]> = [[7, '7s'], [20, '20s'], [45, '45s'], [90, '90s']];

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
    const chunks = computeFaChunkPlanCoalesced(segments, tokens, silences, audioDuration, target);
    writeFileSync(`${OUT_DIR}/173-excerpt-240s-ladder-${label}.json`, JSON.stringify({ audioDuration, chunks }, null, 2));
    const maxDur = Math.max(...chunks.map(c => c.endSec - c.startSec));
    console.log(`[ladder-${label}] target=${target}s chunks=${chunks.length} max=${maxDur.toFixed(2)}s`);
  }
}

main();
