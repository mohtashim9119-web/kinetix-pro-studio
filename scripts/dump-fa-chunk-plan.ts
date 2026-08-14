/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// ---------------------------------------------------------------------------
// WS1 Task 5 Slice D11 — real-corpus chunk-plan dumper.
//
// Drives the EXISTING, tested `src/services/faChunkPlan.ts` (`computeFaChunkPlan`,
// itself calling the unmodified `faAnchors.ts`) over the real 173-project
// replay fixture (`.work-phase4/replay/173/` — gitignored, not committed;
// present on the machine that ran D10's own measurements) to produce real
// `{startSec, endSec, text}` chunk lists for the D11 Automated Agreement
// Budget measurement (the 240s bounded-agreement excerpt) and the D11
// full-length sanity run (the full 709s project). Also emits a single
// "whole-file" chunk for the 240s excerpt (feasible per D10) to compare
// against the windowed output.
//
// NOT part of `npm test`/`npm run build` — a one-shot measurement generator,
// like `scripts/generate-fa-text-fixture.ts`. Run via:
//   npx tsx scripts/dump-fa-chunk-plan.ts
// Writes JSON plans to the scratchpad path given by SCRATCHPAD_DIR (falls
// back to a local ./tmp-fa-chunk-plans/ if unset) for a Rust test/binary to
// consume against the real WAV at the same fixture path.
// ---------------------------------------------------------------------------

import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { computeFaChunkPlan } from '../src/services/faChunkPlan';
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

function buildPlan(audioDurationCutoff: number, label: string) {
  const allSegments = toVideoSegments(loadSegments());
  const allTokens = toTranscriptTokens(loadTokens());
  const allSilences = toSilenceIntervals(loadSilences());

  const segments = allSegments.filter(s => s.startTime < audioDurationCutoff);
  const audioDuration = segments.length > 0
    ? Math.max(...segments.map(s => s.startTime + s.duration))
    : audioDurationCutoff;
  const tokens = allTokens.filter(t => t.startSec < audioDuration);
  const silences = allSilences.filter(s => s.startSec < audioDuration);

  // Pinned to 'segment-start-time' explicitly (WS1 Task 5 Slice D23):
  // computeFaChunkPlan's own default flipped to index attribution this
  // slice, but this dumper's whole documented purpose (above) is the
  // time-attribution baseline these *-windowed.json artifacts have always
  // been — an implicit call here would now silently change their meaning.
  const windowed = computeFaChunkPlan(segments, tokens, silences, audioDuration, 'segment-start-time');
  const wholeFileText = segments.map(s => s.text).join(' ');
  const wholeFile = [{ startSec: 0, endSec: audioDuration, text: wholeFileText }];

  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(`${OUT_DIR}/${label}-windowed.json`, JSON.stringify({ audioDuration, chunks: windowed }, null, 2));
  writeFileSync(`${OUT_DIR}/${label}-wholefile.json`, JSON.stringify({ audioDuration, chunks: wholeFile }, null, 2));

  console.log(
    `[${label}] audioDuration=${audioDuration.toFixed(2)}s segments=${segments.length} ` +
    `windowed chunks=${windowed.length} (max ${Math.max(...windowed.map(c => c.endSec - c.startSec)).toFixed(2)}s) ` +
    `wholeFile chunks=1 (${audioDuration.toFixed(2)}s)`,
  );
}

// 240s excerpt (extended to the last fully-contained segment's own end, per
// this script's own doc comment — never cuts a segment mid-word).
buildPlan(240, '173-excerpt-240s');
// Full 709s project.
buildPlan(Infinity, '173-full-709s');
