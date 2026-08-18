/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// ---------------------------------------------------------------------------
// WS1 Session N — THE PRODUCTION-PATH GATE (standing rule R-AO).
//
// WHY THIS FILE EXISTS. Every WS1 rule (R.5, R.10, R.11, R.12, R.13) had green
// unit tests in `src/services/fa*.test.ts` and a green golden replay in
// `scripts/phase4-handoff-replay-sync.test.ts`, and yet R.11 had never once
// fired in the shipped app. Neither gate could have caught that:
//
//   - The golden replay is an FA-OFF replay. It reproduces steps 1-7 of Apply
//     Sync (parse -> anchor -> align -> coverage gate -> skip filter -> snap ->
//     head-extend) and STOPS exactly where App.tsx's rule block begins. It
//     invokes none of R.5/R.10/R.11/R.12/R.13.
//   - The per-module unit tests call each detector directly with hand-built
//     inputs. R.11's suite passed its committed array in the one argument
//     production fills with `anchorTimed`, so the suite could not observe that
//     production was handing the detector a character-weight PRE-ALIGNMENT
//     ESTIMATE as its `committedValue` (measured drift on v6: 15.59s / 20.49s /
//     22.38s), which widened the third conjunct's correction span from ~1-2s to
//     17-23s and declined every candidate.
//
// So: fixture-green was necessary and not sufficient. This file is the
// sufficient half — it drives the REAL production rule stage, in App.tsx's own
// order, with App.tsx's own arguments, over the REAL captured v6 inputs, and
// asserts FINAL COMMITTED BOUNDARY VALUES rather than harness internals.
//
// INPUTS are the same gitignored, deterministically-regenerable replay captures
// the golden replay already depends on (`python3
// scripts/phase4-restore-replay-inputs.py`), plus `fa_production_words.json` —
// the real 3874-word in-app forced-alignment output for v6.
// ---------------------------------------------------------------------------

import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'fs';
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
import { computeUnscriptedRuns } from '../src/services/faChunkPlan';
import type { TranscriptToken, VideoSegment } from '../src/types';
import type { SilenceInterval } from '../src/services/silenceDetector';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const REPLAY_ROOT = resolve(REPO, '.work-phase4/replay');
const RESTORE_CMD = 'python3 scripts/phase4-restore-replay-inputs.py';

const V6 = {
  key: 'v6',
  audioDuration: 1421.29,
  sceneDetailsPath: '/Users/mohtashim/Downloads/All Projects Test Data/V6 Natural Long Pause Segs/All Text Files/Sync.txt',
  scriptPath: '/Users/mohtashim/Downloads/All Projects Test Data/V6 Natural Long Pause Segs/All Text Files/Script.txt',
} as const;

function requireInput(key: string, fileName: string): string {
  const path = resolve(REPLAY_ROOT, key, fileName);
  if (!existsSync(path)) {
    throw new Error(
      `Replay input missing: ${path}\nRegenerate it (deterministically, from committed sources):\n    ${RESTORE_CMD}`,
    );
  }
  return readFileSync(path, 'utf-8');
}

/** The real production rule stage, in App.tsx's own order and with App.tsx's
 *  own arguments. Mirrors `handleApplySyncFromFiles`'s `cachedTokensReady`
 *  branch; any divergence here is a bug in this harness, not a liberty. */
async function runProductionPath(): Promise<{
  committed: VideoSegment[];
  fired: Record<string, number>;
  kept: number;
  skipped: number;
}> {
  const whisperTokens: TranscriptToken[] = (
    JSON.parse(requireInput(V6.key, 'transcript_tokens.json')) as Array<{ text: string; start: number; end: number }>
  ).map(t => ({ text: t.text, startSec: t.start, endSec: t.end }));
  const silences: SilenceInterval[] = (
    JSON.parse(requireInput(V6.key, 'silences_app.json')) as { silences: SilenceInterval[] }
  ).silences;
  const faTokens: TranscriptToken[] = (
    JSON.parse(requireInput(V6.key, 'fa_production_words.json')) as {
      words: Array<{ word: string; startSec: number; endSec: number; confidence: number }>;
    }
  ).words.map(w => ({ text: w.word, startSec: w.startSec, endSec: w.endSec, confidence: w.confidence }));

  const script = readFileSync(V6.scriptPath, 'utf-8');
  const sceneDetails = readFileSync(V6.sceneDetailsPath, 'utf-8');
  const audioDuration = V6.audioDuration;

  // App.tsx: parse -> anchorTimed -> (FA ON) alignFromCache with FA tokens.
  const newSegmentsRaw = await parseProjectData(script, sceneDetails, [], audioDuration);
  const anchorTimed = applyAnchorBasedTiming(newSegmentsRaw, audioDuration);

  const filtered = filterMalformedTokens(faTokens, audioDuration);
  const usable = filtered.tokens;
  const alignments = alignScenestoTranscript(anchorTimed, usable, silences, audioDuration);
  const alignedSegments = applyAnchorBasedTiming(
    distributeSegmentTimes(anchorTimed, alignments, 'forced-alignment'), audioDuration,
  );

  const gate = evaluateCoverageGate(alignedSegments, alignments, countTranscriptWords(usable));
  expect(gate.aborted, 'coverage gate must not abort on real narration').toBe(false);

  const fired: Record<string, number> = {};

  // R.5 — the excisions the chunk plan actually made.
  fired['R.5'] = computeUnscriptedRuns(anchorTimed, whisperTokens, silences, audioDuration).length;

  // R.10 — scripted text never spoken.
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

  // R.11 -> R.12 -> R.13, in App.tsx's order, each on the previous one's output.
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

  return { committed: finalTimedSegments, fired, kept: kept.length, skipped: skipped.length };
}

const startTimeOf = (segs: readonly VideoSegment[], tag: string): number => {
  const s = segs.find(x => (x as unknown as { tag?: string }).tag === tag);
  expect(s, `segment ${tag} must be on the committed timeline`).toBeDefined();
  return s!.startTime;
};

describe('WS1 production path — v6, FA ON (R-AO gate)', () => {
  const TIMEOUT = 300_000;

  it('reproduces the live run shape: 447 parsed, 447 kept, 0 skipped', async () => {
    const { kept, skipped } = await runProductionPath();
    expect(kept).toBe(447);
    expect(skipped).toBe(0);
  }, TIMEOUT);

  it('R-AO: every registry rule has an observable firing count on the production path', async () => {
    const { fired } = await runProductionPath();
    // Every rule in the registry must be OBSERVED, by name, on the real path.
    // A rule that cannot fire here is not closed, however green its fixtures.
    expect(Object.keys(fired).sort()).toEqual(['R.10', 'R.11', 'R.12', 'R.13', 'R.5']);
    expect(fired['R.5'], 'R.5 excises the ten unscripted recitations').toBe(10);
    expect(fired['R.11'], 'R.11 must fire — it could not before Session N').toBeGreaterThan(0);
    expect(fired['R.12'], 'R.12 pulls run-carrying scene starts out of the runs').toBeGreaterThan(0);
    expect(fired['R.13'], 'R.13 closes R.12 at the far edge').toBeGreaterThan(0);
  }, TIMEOUT);

  it('commits R.11 ear-correct boundaries, not the pre-fix register values', async () => {
    const { committed } = await runProductionPath();
    // RED before Session N (the pre-fix register values 449.20 / 570.18 /
    // 670.24 were committed verbatim); GREEN after.
    expect(startTimeOf(committed, '152_frozen_brush_mice')).toBeCloseTo(451.03, 2);
    expect(startTimeOf(committed, '192_scout_listening')).toBeCloseTo(571.07, 2);
    expect(startTimeOf(committed, '226_four_scouts')).toBeCloseTo(671.18, 2);
  }, TIMEOUT);

  it('commits no boundary strictly inside an unscripted run (R.12 invariant, end to end)', async () => {
    const { committed } = await runProductionPath();
    const whisperTokens: TranscriptToken[] = (
      JSON.parse(requireInput(V6.key, 'transcript_tokens.json')) as Array<{ text: string; start: number; end: number }>
    ).map(t => ({ text: t.text, startSec: t.start, endSec: t.end }));
    const silences: SilenceInterval[] = (
      JSON.parse(requireInput(V6.key, 'silences_app.json')) as { silences: SilenceInterval[] }
    ).silences;
    const script = readFileSync(V6.scriptPath, 'utf-8');
    const sceneDetails = readFileSync(V6.sceneDetailsPath, 'utf-8');
    const anchorTimed = applyAnchorBasedTiming(
      await parseProjectData(script, sceneDetails, [], V6.audioDuration), V6.audioDuration,
    );
    const runs = computeUnscriptedRuns(anchorTimed, whisperTokens, silences, V6.audioDuration);

    const violations = committed.slice(1).filter(s =>
      runs.some(r => s.startTime > r.startSec + 1e-9 && s.startTime < r.endSec - 1e-9),
    ).map(s => `${(s as unknown as { tag?: string }).tag}@${s.startTime.toFixed(2)}`);
    expect(violations, 'no committed boundary may land mid-recitation').toEqual([]);
  }, TIMEOUT);

  it('preserves Model P: gapless partition and total duration', async () => {
    const { committed } = await runProductionPath();
    for (let i = 0; i + 1 < committed.length; i++) {
      expect(committed[i]!.startTime + committed[i]!.duration).toBeCloseTo(committed[i + 1]!.startTime, 6);
    }
    const last = committed[committed.length - 1]!;
    expect(last.startTime + last.duration).toBeCloseTo(V6.audioDuration, 2);
    expect(committed[0]!.startTime).toBe(0);
    for (const s of committed) expect(s.duration).toBeGreaterThan(0);
  }, TIMEOUT);
});
