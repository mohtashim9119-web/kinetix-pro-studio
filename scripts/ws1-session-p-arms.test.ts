/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */
// WS1 Session P — Step 2 exit diagnosis (temporary). Which INPUT COMBINATION
// reproduces the captured production chunk plan and the live R.11 firing set?

import { describe, it } from 'vitest';
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

import { parseProjectData, evaluateCoverageGate, filterToCoveredSegments } from '../src/App';
import { applyAnchorBasedTiming, headExtendFirstSegment } from '../src/services/syncEngine';
import { snapCoveredBoundaries } from '../src/services/snapBoundaries';
import {
  alignScenestoTranscript, distributeSegmentTimes, filterMalformedTokens, countTranscriptWords,
} from '../src/services/whisperService';
import { detectSeamFitDefects } from '../src/services/faSeamFitGate';
import { detectRunPlacementDefects, detectUtterancePlacementDefects } from '../src/services/faRunPlacementGate';
import { detectUnspokenScriptSegmentsFromWhisper, applyUnspokenScriptGate } from '../src/services/faUnspokenGate';
import { computeFaChunkPlan, computeUnscriptedRuns } from '../src/services/faChunkPlan';
import type { TranscriptToken } from '../src/types';
import type { SilenceInterval } from '../src/services/silenceDetector';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const V6DIR = resolve(REPO, '.work-phase4/replay/v6');
const OUT = resolve(REPO, '.work-phase4/session-p');
const AUDIO = 1421.29;
const SCRIPT = '/Users/mohtashim/Downloads/All Projects Test Data/V6 Natural Long Pause Segs/All Text Files/Script.txt';
const SCENES = '/Users/mohtashim/Downloads/All Projects Test Data/V6 Natural Long Pause Segs/All Text Files/Sync.txt';

const rd = (f: string) => readFileSync(resolve(V6DIR, f), 'utf-8');

const silRaw = (f: string): SilenceInterval[] => (JSON.parse(rd(f)) as { silences: SilenceInterval[] }).silences;
const whisperRaw: TranscriptToken[] = (JSON.parse(rd('whisper_raw_tokens.json')) as {
  tokens: Array<{ text: string; startSec: number; endSec: number }>;
}).tokens;
const whisperFiltered: TranscriptToken[] = (JSON.parse(rd('transcript_tokens.json')) as
  Array<{ text: string; start: number; end: number }>).map(t => ({ text: t.text, startSec: t.start, endSec: t.end }));
const faTokens: TranscriptToken[] = (JSON.parse(rd('fa_production_words.json')) as {
  words: Array<{ word: string; startSec: number; endSec: number; confidence: number }>;
}).words.map(w => ({ text: w.word, startSec: w.startSec, endSec: w.endSec, confidence: w.confidence }));

const prodChunks = (JSON.parse(rd('fa_production_chunks.json')) as {
  chunks: Array<{ startSec: number; endSec: number; text: string }>;
}).chunks;

describe('WS1 Session P — Step 2 arm diagnosis', () => {
  it('sweeps input arms', async () => {
    mkdirSync(OUT, { recursive: true });
    const segsRaw = await parseProjectData(readFileSync(SCRIPT, 'utf-8'), readFileSync(SCENES, 'utf-8'), [], AUDIO);
    const anchorTimed = applyAnchorBasedTiming(segsRaw, AUDIO);

    const arms = [
      { name: 'raw+native', tokens: whisperRaw, sil: silRaw('silences_native.json') },
      { name: 'raw+16k', tokens: whisperRaw, sil: silRaw('silences_app.json') },
      { name: 'filtered+native', tokens: whisperFiltered, sil: silRaw('silences_native.json') },
      { name: 'filtered+16k', tokens: whisperFiltered, sil: silRaw('silences_app.json') },
    ];

    const results: Record<string, unknown> = {};
    for (const arm of arms) {
      const chunks = computeFaChunkPlan(anchorTimed, arm.tokens, arm.sil, AUDIO);
      const chunkMatch = chunks.length === prodChunks.length &&
        chunks.every((c, i) => Math.abs(c.startSec - prodChunks[i]!.startSec) < 1e-6 &&
                                Math.abs(c.endSec - prodChunks[i]!.endSec) < 1e-6);

      const filtered = filterMalformedTokens(faTokens, AUDIO);
      const usable = filtered.tokens;
      const alignments = alignScenestoTranscript(anchorTimed, usable, arm.sil, AUDIO);
      const alignedSegments = applyAnchorBasedTiming(
        distributeSegmentTimes(anchorTimed, alignments, 'forced-alignment'), AUDIO);
      evaluateCoverageGate(alignedSegments, alignments, countTranscriptWords(usable));
      const unspoken = detectUnspokenScriptSegmentsFromWhisper(
        alignedSegments, arm.tokens, faTokens, arm.sil, AUDIO);
      const coverage = applyUnspokenScriptGate(alignments, unspoken);
      const { kept, keptAlignments } = filterToCoveredSegments(
        alignedSegments, coverage, new Set(unspoken.map(f => f.segmentIndex)));
      const committed = headExtendFirstSegment(
        snapCoveredBoundaries(kept, keptAlignments, usable, arm.sil, AUDIO));

      const r11 = detectSeamFitDefects(anchorTimed, committed, arm.tokens, faTokens, arm.sil, AUDIO);
      const r12 = detectRunPlacementDefects(anchorTimed, committed, arm.tokens, arm.sil, AUDIO);
      const r13 = detectUtterancePlacementDefects(anchorTimed, committed, arm.tokens, arm.sil, AUDIO);
      const r5 = computeUnscriptedRuns(anchorTimed, arm.tokens, arm.sil, AUDIO);

      results[arm.name] = {
        chunks: chunks.length, chunkMatchesProduction: chunkMatch,
        r5: r5.length, r10: unspoken.length, r11: r11.length, r12: r12.length, r13: r13.length,
        r11tags: r11.map(f => f.segmentTag),
        r11values: r11.map(f => ({ tag: f.segmentTag, from: f.committedValue, to: f.correctedValue })),
      };
    }
    writeFileSync(resolve(OUT, 'arm-sweep.json'), JSON.stringify({ productionChunks: prodChunks.length, results }, null, 2));
  }, 900_000);
});
