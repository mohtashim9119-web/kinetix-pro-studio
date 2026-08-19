/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// WS1 Session P — MEASUREMENT harness (temporary; Steps 2-6).
// Drives the real production rule stage over LIVE-FIDELITY inputs:
//   * silences  -> silences_native.json      (44.1kHz LEFT channel, not 16k mono)
//   * whisper   -> whisper_raw_tokens.json   (RAW 4556, not pre-filtered 3989)
//   * fa        -> fa_production_words.json  (3874, unchanged)
// Dumps a diagnostics bundle for the Step 3-6 analysis.

import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync, writeFileSync, mkdirSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

import { parseProjectData, evaluateCoverageGate, filterToCoveredSegments } from '../src/App';
import { applyAnchorBasedTiming, headExtendFirstSegment } from '../src/services/syncEngine';
import { snapCoveredBoundaries } from '../src/services/snapBoundaries';
import {
  alignScenestoTranscript, distributeSegmentTimes, filterMalformedTokens, countTranscriptWords,
} from '../src/services/whisperService';
import { detectSeamFitDefects, applySeamFitCorrections } from '../src/services/faSeamFitGate';
import {
  detectRunPlacementDefects, applyRunPlacementCorrections,
  detectUtterancePlacementDefects, applyUtterancePlacementCorrections,
} from '../src/services/faRunPlacementGate';
import { detectUnspokenScriptSegmentsFromWhisper, applyUnspokenScriptGate } from '../src/services/faUnspokenGate';
import { computeUnscriptedRuns, computeFaChunkPlan, computeRuns } from '../src/services/faChunkPlan';
import type { TranscriptToken, VideoSegment } from '../src/types';
import type { SilenceInterval } from '../src/services/silenceDetector';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const REPLAY_ROOT = resolve(REPO, '.work-phase4/replay');
const OUT_ROOT = resolve(REPO, '.work-phase4/session-p');

const V6 = {
  key: 'v6',
  audioDuration: 1421.29,
  sceneDetailsPath: '/Users/mohtashim/Downloads/All Projects Test Data/V6 Natural Long Pause Segs/All Text Files/Sync.txt',
  scriptPath: '/Users/mohtashim/Downloads/All Projects Test Data/V6 Natural Long Pause Segs/All Text Files/Script.txt',
} as const;

function requireInput(key: string, fileName: string): string {
  const path = resolve(REPLAY_ROOT, key, fileName);
  if (!existsSync(path)) throw new Error(`Missing live-fidelity input: ${path}`);
  return readFileSync(path, 'utf-8');
}

function loadInputs(key: string) {
  const whisperTokens: TranscriptToken[] = (
    JSON.parse(requireInput(key, 'whisper_raw_tokens.json')) as {
      tokens: Array<{ text: string; startSec: number; endSec: number }>;
    }
  ).tokens.map(t => ({ text: t.text, startSec: t.startSec, endSec: t.endSec }));

  const silences: SilenceInterval[] = (
    JSON.parse(requireInput(key, 'silences_native.json')) as { silences: SilenceInterval[] }
  ).silences;

  const faTokens: TranscriptToken[] = (
    JSON.parse(requireInput(key, 'fa_production_words.json')) as {
      words: Array<{ word: string; startSec: number; endSec: number; confidence: number }>;
    }
  ).words.map(w => ({ text: w.word, startSec: w.startSec, endSec: w.endSec, confidence: w.confidence }));

  return { whisperTokens, silences, faTokens };
}

/** The real production rule stage, in App.tsx's own order, with App.tsx's own
 *  arguments — now including the two inputs Session P Step 1 found diverging. */
async function runProductionPath(cfg = V6) {
  const { whisperTokens, silences, faTokens } = loadInputs(cfg.key);
  const script = readFileSync(cfg.scriptPath, 'utf-8');
  const sceneDetails = readFileSync(cfg.sceneDetailsPath, 'utf-8');
  const audioDuration = cfg.audioDuration;

  const newSegmentsRaw = await parseProjectData(script, sceneDetails, [], audioDuration);
  const anchorTimed = applyAnchorBasedTiming(newSegmentsRaw, audioDuration);

  // alignFromCache: filter the tokens it was GIVEN (FA tokens on this branch).
  const filtered = filterMalformedTokens(faTokens, audioDuration);
  const usable = filtered.tokens;
  const alignments = alignScenestoTranscript(anchorTimed, usable, silences, audioDuration);
  const alignedSegments = applyAnchorBasedTiming(
    distributeSegmentTimes(anchorTimed, alignments, 'forced-alignment'), audioDuration,
  );

  const gate = evaluateCoverageGate(alignedSegments, alignments, countTranscriptWords(usable));

  const fired: Record<string, number> = {};

  // R.5 — production feeds computeFaChunkPlan the RAW whisper tokens.
  const r5runs = computeUnscriptedRuns(anchorTimed, whisperTokens, silences, audioDuration);
  fired['R.5'] = r5runs.length;

  const unspoken = detectUnspokenScriptSegmentsFromWhisper(
    alignedSegments, whisperTokens, faTokens, silences, audioDuration,
  );
  fired['R.10'] = unspoken.length;
  const coverage = applyUnspokenScriptGate(alignments, unspoken);

  const { kept, skipped, keptAlignments } = filterToCoveredSegments(
    alignedSegments, coverage, new Set(unspoken.map(f => f.segmentIndex)),
  );
  let finalTimedSegments = headExtendFirstSegment(
    snapCoveredBoundaries(kept, keptAlignments, usable, silences, audioDuration),
  );
  const preRuleSegments = finalTimedSegments.map(s => ({ ...s }));

  const r11 = detectSeamFitDefects(
    anchorTimed, finalTimedSegments, whisperTokens, faTokens, silences, audioDuration,
  );
  fired['R.11'] = r11.length;
  finalTimedSegments = applySeamFitCorrections(finalTimedSegments, r11);

  const r12 = detectRunPlacementDefects(
    anchorTimed, finalTimedSegments, whisperTokens, silences, audioDuration,
  );
  fired['R.12'] = r12.length;
  finalTimedSegments = applyRunPlacementCorrections(finalTimedSegments, r12);

  const r13 = detectUtterancePlacementDefects(
    anchorTimed, finalTimedSegments, whisperTokens, silences, audioDuration,
  );
  fired['R.13'] = r13.length;
  finalTimedSegments = applyUtterancePlacementCorrections(finalTimedSegments, r13);

  return {
    committed: finalTimedSegments, preRuleSegments, fired, kept: kept.length, skipped: skipped.length,
    r5runs, r11, r12, r13, unspoken, anchorTimed, whisperTokens, faTokens, silences, aborted: gate.aborted,
    chunks: computeFaChunkPlan(anchorTimed, whisperTokens, silences, audioDuration),
    runs: computeRuns(anchorTimed, whisperTokens, silences, audioDuration),
  };
}

const tagOf = (s: VideoSegment): string => (s as unknown as { tag?: string }).tag ?? '';

describe('WS1 Session P — live-fidelity production path (measurement)', () => {
  const TIMEOUT = 600_000;

  it('STEP 2 — reproduces the live run with raw tokens + native silences', async () => {
    const r = await runProductionPath();
    mkdirSync(OUT_ROOT, { recursive: true });

    // Independent cross-check that the raw arm IS the live array: the live app
    // logged "filtered 567 of 4556 (493 empty text, 74 zero/inverted)".
    const wFilter = filterMalformedTokens([...r.whisperTokens], V6.audioDuration);
    const dropReasons: Record<string, number> = {};
    for (const d of wFilter.drops) dropReasons[d.reason] = (dropReasons[d.reason] ?? 0) + 1;

    const report = {
      inputs: {
        whisperTokens: r.whisperTokens.length,
        silences: r.silences.length,
        faTokens: r.faTokens.length,
      },
      whisperFilter: {
        total: wFilter.totalTokens, skipped: wFilter.skippedCount,
        kept: wFilter.tokens.length, dropReasons,
      },
      aborted: r.aborted,
      kept: r.kept,
      skipped: r.skipped,
      fired: r.fired,
      r11: r.r11.map(f => ({
        tag: f.segmentTag, segmentIndex: f.segmentIndex, chunkIndex: f.chunkIndex,
        fit: f.fit, fitDeviation: f.fitDeviation, edge: f.edge,
        committedValue: f.committedValue, correctedValue: f.correctedValue,
        delta: f.delta, spanMaxConfidence: f.spanMaxConfidence,
      })),
      r12: r.r12.map(f => ({ ...f })),
      r13: r.r13.map(f => ({ ...f })),
      r5runs: r.r5runs.map(x => ({ ...x })),
      unspoken: r.unspoken.map(x => ({ ...x })),
    };
    writeFileSync(resolve(OUT_ROOT, 'step2-report.json'), JSON.stringify(report, null, 2));

    // Full committed + pre-rule boundary tables for the Step 3-6 analysis.
    writeFileSync(resolve(OUT_ROOT, 'committed.json'), JSON.stringify({
      committed: r.committed.map((s, i) => ({
        i, tag: tagOf(s), id: s.id, startTime: s.startTime, duration: s.duration, text: s.text,
      })),
      preRule: r.preRuleSegments.map((s, i) => ({ i, tag: tagOf(s), id: s.id, startTime: s.startTime })),
    }, null, 2));

    writeFileSync(resolve(OUT_ROOT, 'chunks.json'), JSON.stringify({
      chunks: r.chunks.map((c, i) => ({ i, startSec: c.startSec, endSec: c.endSec, text: c.text })),
      runs: r.runs.map(x => ({ ...x })),
    }, null, 2));

    writeFileSync(resolve(OUT_ROOT, 'fa_tokens.json'), JSON.stringify(
      r.faTokens.map(t => ({ text: t.text, startSec: t.startSec, endSec: t.endSec, confidence: t.confidence })),
    ));
    writeFileSync(resolve(OUT_ROOT, 'silences_used.json'), JSON.stringify(r.silences));
    writeFileSync(resolve(OUT_ROOT, 'whisper_used.json'), JSON.stringify(
      r.whisperTokens.map(t => ({ text: t.text, startSec: t.startSec, endSec: t.endSec })),
    ));

    // eslint-disable-next-line no-console
    console.log('[SESSION-P STEP 2]', JSON.stringify({
      inputs: report.inputs, whisperFilter: report.whisperFilter,
      kept: r.kept, skipped: r.skipped, fired: r.fired,
      r11tags: r.r11.map(f => f.segmentTag),
    }, null, 2));

    expect(r.kept).toBe(447);
  }, TIMEOUT);
});
