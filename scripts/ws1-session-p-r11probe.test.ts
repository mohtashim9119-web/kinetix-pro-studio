/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */
// WS1 Session P — R.11 per-conjunct decline probe (temporary).
// Mirrors faSeamFitGate.ts's detectSeamFitDefects loop EXACTLY, recording why
// each candidate boundary passes or declines. Any divergence from that file is
// a bug in this probe.

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
import { detectUnspokenScriptSegmentsFromWhisper, applyUnspokenScriptGate } from '../src/services/faUnspokenGate';
import { computeFaChunkPlan, computeRuns } from '../src/services/faChunkPlan';
import { R11_MIN_FIT_DEVIATION, R11_MIN_CORRECTION_SEC, R11_MAX_SPAN_WORD_CONF } from '../src/services/syncConstants';
import type { TranscriptToken, VideoSegment } from '../src/types';
import type { SilenceInterval } from '../src/services/silenceDetector';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const V6DIR = resolve(REPO, '.work-phase4/replay/v6');
const OUT = resolve(REPO, '.work-phase4/session-p');
const AUDIO = 1421.29;
const SCRIPT = '/Users/mohtashim/Downloads/All Projects Test Data/V6 Natural Long Pause Segs/All Text Files/Script.txt';
const SCENES = '/Users/mohtashim/Downloads/All Projects Test Data/V6 Natural Long Pause Segs/All Text Files/Sync.txt';
const rd = (f: string) => readFileSync(resolve(V6DIR, f), 'utf-8');
const scriptWordCount = (t: string): number => t.split(/\s+/).filter(w => w.length > 0).length;

// MEASUREMENT — not part of the default `npm test` sweep (see
// ws1-session-p-converge.test.ts's own gate note). WS1_SESSION_P_MEASURE=1.
const MEASURE = process.env.WS1_SESSION_P_MEASURE === '1';

describe.skipIf(!MEASURE)('WS1 Session P — R.11 decline probe', () => {
  it('dumps every candidate with its decline reason', async () => {
    mkdirSync(OUT, { recursive: true });
    const whisper: TranscriptToken[] = (JSON.parse(rd('whisper_raw_tokens.json')) as {
      tokens: Array<{ text: string; startSec: number; endSec: number }>;
    }).tokens;
    const silences: SilenceInterval[] = (JSON.parse(rd('silences_native.json')) as { silences: SilenceInterval[] }).silences;
    const faTokens: TranscriptToken[] = (JSON.parse(rd('fa_live_words.json')) as {
      words: Array<{ word: string; startSec: number; endSec: number; confidence: number }>;
    }).words.map(w => ({ text: w.word, startSec: w.startSec, endSec: w.endSec, confidence: w.confidence }));

    const segments = applyAnchorBasedTiming(
      await parseProjectData(readFileSync(SCRIPT, 'utf-8'), readFileSync(SCENES, 'utf-8'), [], AUDIO), AUDIO);

    const filtered = filterMalformedTokens(faTokens, AUDIO);
    const usable = filtered.tokens;
    const alignments = alignScenestoTranscript(segments, usable, silences, AUDIO);
    const alignedSegments = applyAnchorBasedTiming(
      distributeSegmentTimes(segments, alignments, 'forced-alignment'), AUDIO);
    evaluateCoverageGate(alignedSegments, alignments, countTranscriptWords(usable));
    const unspoken = detectUnspokenScriptSegmentsFromWhisper(alignedSegments, whisper, faTokens, silences, AUDIO);
    const coverage = applyUnspokenScriptGate(alignments, unspoken);
    const { kept, keptAlignments } = filterToCoveredSegments(
      alignedSegments, coverage, new Set(unspoken.map(f => f.segmentIndex)));
    const committedSegments = headExtendFirstSegment(
      snapCoveredBoundaries(kept, keptAlignments, usable, silences, AUDIO));

    // ---- verbatim mirror of detectSeamFitDefects ----
    const committedById = new Map(committedSegments.map(s => [s.id, s.startTime]));
    const chunks = computeFaChunkPlan(segments, whisper, silences, AUDIO);
    const runs = computeRuns(segments, whisper, silences, AUDIO);

    const segWordCounts = segments.map(s => scriptWordCount(s.text ?? ''));
    const chunkWordCounts = chunks.map(c => scriptWordCount(c.text));
    const wordToChunk: number[] = [];
    chunkWordCounts.forEach((n, ci) => { for (let i = 0; i < n; i++) wordToChunk.push(ci); });
    const segFirstChunk: number[] = []; const segWordStart: number[] = [];
    let cursor = 0;
    for (const n of segWordCounts) {
      segWordStart.push(cursor);
      segFirstChunk.push(n > 0 ? (wordToChunk[cursor] ?? -1) : -1);
      cursor += n;
    }
    const chunkWordStart: number[] = [];
    { let c = 0; for (const n of chunkWordCounts) { chunkWordStart.push(c); c += n; } }

    const chunkBoundaries = new Map<number, number[]>();
    for (let i = 0; i < segments.length; i++) {
      const ci = segFirstChunk[i];
      if (ci === undefined || ci === -1) continue;
      if (!chunkBoundaries.has(ci)) chunkBoundaries.set(ci, []);
      chunkBoundaries.get(ci)!.push(i);
    }
    const fitByChunk = chunks.map((c, ci) => {
      const words = chunkWordCounts[ci]!;
      const onsets = whisper.filter(t => t.startSec >= c.startSec - 1e-9 && t.startSec < c.endSec - 1e-9).length;
      const fit = onsets > 0 ? words / onsets : Number.POSITIVE_INFINITY;
      return { fit, fitDeviation: onsets > 0 ? Math.max(fit, 1 / fit) : Number.POSITIVE_INFINITY, words, onsets };
    });

    const tagOf = (s: VideoSegment) => (s as unknown as { tag?: string }).tag ?? '';
    const rows: unknown[] = [];

    for (const [ci, segIdxs] of chunkBoundaries) {
      const { fit, fitDeviation, words, onsets } = fitByChunk[ci]!;
      const chunk = chunks[ci]!;
      const chunkStartWord = chunkWordStart[ci]!;
      const chunkEndWord = chunkStartWord + chunkWordCounts[ci]!;
      const first = segIdxs[0]!; const last = segIdxs[segIdxs.length - 1]!;
      const cands: Array<{ segIdx: number; edge: 'start' | 'end' }> = [];
      if (segWordStart[first] === chunkStartWord) cands.push({ segIdx: first, edge: 'start' });
      if (segWordStart[last]! + segWordCounts[last]! >= chunkEndWord) cands.push({ segIdx: last, edge: 'end' });

      const fitOk = fitDeviation > R11_MIN_FIT_DEVIATION;
      for (const { segIdx, edge } of cands) {
        const row: Record<string, unknown> = {
          chunkIndex: ci, segIdx, tag: tagOf(segments[segIdx]!), edge,
          fit, fitDeviation, chunkWords: words, chunkOnsets: onsets,
          chunkStartSec: chunk.startSec, chunkEndSec: chunk.endSec,
          conjunct1_fitDeviation_gt_threshold: fitOk,
        };
        if (!fitOk) { row['declinedAt'] = 'C1 fitDeviation'; rows.push(row); continue; }
        if (segIdx === 0) { row['declinedAt'] = 'index 0 (headExtend)'; rows.push(row); continue; }

        const edgeTime = edge === 'start' ? chunk.startSec : chunk.endSec;
        const run = runs.find(r => Math.abs((edge === 'start' ? r.windowStart : r.windowEnd) - edgeTime) < 1e-6);
        const agreedAnchor = edge === 'start' ? run?.startProvenance === 'agreed-anchor' : run?.endProvenance === 'agreed-anchor';
        row['edgeTime'] = edgeTime;
        row['conjunct2_agreedAnchor'] = !!agreedAnchor;
        if (!agreedAnchor) { row['declinedAt'] = 'C2 agreedAnchor'; rows.push(row); continue; }

        const backingSilence = silences.find(s => Math.abs(s.endSec - edgeTime) < 1e-6);
        row['backingSilence'] = backingSilence ? [backingSilence.startSec, backingSilence.endSec] : null;
        if (!backingSilence) { row['declinedAt'] = 'C2b backingSilence'; rows.push(row); continue; }

        const correctedValue = (backingSilence.startSec + backingSilence.endSec) / 2;
        const committedValue = committedById.get(segments[segIdx]!.id);
        row['correctedValue'] = correctedValue;
        row['committedValue'] = committedValue;
        if (committedValue === undefined) { row['declinedAt'] = 'no committed'; rows.push(row); continue; }
        const delta = correctedValue - committedValue;
        row['delta'] = delta;
        if (Math.abs(delta) <= R11_MIN_CORRECTION_SEC) { row['declinedAt'] = 'C3 no-op delta'; rows.push(row); continue; }

        const spanLo = Math.min(committedValue, correctedValue);
        const spanHi = Math.max(committedValue, correctedValue);
        const inSpan = faTokens.filter(t => t.startSec >= spanLo - 1e-9 && t.startSec <= spanHi + 1e-9);
        let spanMaxConf: number | undefined;
        for (const t of inSpan) {
          if (typeof t.confidence !== 'number' || !Number.isFinite(t.confidence)) continue;
          if (spanMaxConf === undefined || t.confidence > spanMaxConf) spanMaxConf = t.confidence;
        }
        row['spanWordCount'] = inSpan.length;
        row['spanWords'] = inSpan.map(t => ({ text: t.text, startSec: t.startSec, confidence: t.confidence }));
        row['spanMaxConf'] = spanMaxConf ?? null;
        row['conjunct4_spanConf_lt_threshold'] = spanMaxConf !== undefined && spanMaxConf < R11_MAX_SPAN_WORD_CONF;
        if (spanMaxConf === undefined) { row['declinedAt'] = 'C4 no usable evidence'; rows.push(row); continue; }
        if (spanMaxConf >= R11_MAX_SPAN_WORD_CONF) { row['declinedAt'] = 'C4 spanMaxConf'; rows.push(row); continue; }
        row['declinedAt'] = null;
        rows.push(row);
      }
    }
    writeFileSync(resolve(OUT, 'r11-probe.json'), JSON.stringify({
      thresholds: { R11_MIN_FIT_DEVIATION, R11_MIN_CORRECTION_SEC, R11_MAX_SPAN_WORD_CONF },
      chunkCount: chunks.length, candidateCount: rows.length, rows,
    }, null, 2));
  }, 900_000);
});
