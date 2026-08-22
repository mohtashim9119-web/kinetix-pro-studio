/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */
// WS1 Session AB — R.11 full-population probe, generalized to all three
// corpora (v6/173/spanish). Verbatim mirror of
// `ws1-session-p-r11probe.test.ts`'s detectSeamFitDefects walk (same
// per-conjunct decline recording), parametrized over corpus so the same
// candidate-population evidence Session P captured for v6 alone is available
// for 173 and Spanish too. Any divergence from `faSeamFitGate.ts`'s
// `detectSeamFitDefects` is a bug in this probe, not a finding.
//
// MEASUREMENT — not part of the default `npm test` sweep.
// WS1_SESSION_AB_MEASURE=1.

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
const OUT = resolve(REPO, '.work-phase4/session-ab');
const scriptWordCount = (t: string): number => t.split(/\s+/).filter(w => w.length > 0).length;

const MEASURE = process.env.WS1_SESSION_AB_MEASURE === '1';

type CorpusKey = 'v6' | '173' | 'spanish';
const CORPORA: Record<CorpusKey, { dir: string; script: string; sync: string; audio: number }> = {
  v6: {
    dir: resolve(REPO, '.work-phase4/replay/v6'),
    script: '/Users/mohtashim/Downloads/All Projects Test Data/V6 Natural Long Pause Segs/All Text Files/Script.txt',
    sync: '/Users/mohtashim/Downloads/All Projects Test Data/V6 Natural Long Pause Segs/All Text Files/Sync.txt',
    audio: 1421.29,
  },
  '173': {
    dir: resolve(REPO, '.work-phase4/replay/173'),
    script: '/Users/mohtashim/Downloads/All Projects Test Data/173 Segs Project/script.txt',
    sync: '/Users/mohtashim/Downloads/All Projects Test Data/173 Segs Project/sync.txt',
    audio: 709.01,
  },
  spanish: {
    dir: resolve(REPO, '.work-phase4/replay/spanish'),
    script: '/Users/mohtashim/Downloads/All Projects Test Data/Spanish Project/Spanish Script.txt',
    sync: '/Users/mohtashim/Downloads/All Projects Test Data/Spanish Project/Spanish Sync.txt',
    audio: 92.04,
  },
};

describe.skipIf(!MEASURE)('WS1 Session AB — R.11 corpus probe (v6/173/spanish)', () => {
  for (const key of Object.keys(CORPORA) as CorpusKey[]) {
    it(`dumps every candidate with its decline reason — ${key}`, async () => {
      const cfg = CORPORA[key];
      mkdirSync(OUT, { recursive: true });
      const rd = (f: string) => readFileSync(resolve(cfg.dir, f), 'utf-8');

      const whisper: TranscriptToken[] = (JSON.parse(rd('whisper_raw_tokens.json')) as {
        tokens: Array<{ text: string; startSec: number; endSec: number }>;
      }).tokens;
      const silences: SilenceInterval[] = (JSON.parse(rd('silences_native.json')) as { silences: SilenceInterval[] }).silences;
      const faTokens: TranscriptToken[] = (JSON.parse(rd('fa_live_words.json')) as {
        words: Array<{ word: string; startSec: number; endSec: number; confidence: number }>;
      }).words.map(w => ({ text: w.word, startSec: w.startSec, endSec: w.endSec, confidence: w.confidence }));

      const segments = applyAnchorBasedTiming(
        await parseProjectData(readFileSync(cfg.script, 'utf-8'), readFileSync(cfg.sync, 'utf-8'), [], cfg.audio), cfg.audio);

      const filtered = filterMalformedTokens(faTokens, cfg.audio);
      const usable = filtered.tokens;
      const alignments = alignScenestoTranscript(segments, usable, silences, cfg.audio);
      const alignedSegments = applyAnchorBasedTiming(
        distributeSegmentTimes(segments, alignments, 'forced-alignment'), cfg.audio);
      evaluateCoverageGate(alignedSegments, alignments, countTranscriptWords(usable));
      const unspoken = detectUnspokenScriptSegmentsFromWhisper(alignedSegments, whisper, faTokens, silences, cfg.audio);
      const coverage = applyUnspokenScriptGate(alignments, unspoken);
      const { kept, keptAlignments } = filterToCoveredSegments(
        alignedSegments, coverage, new Set(unspoken.map(f => f.segmentIndex)));
      const committedSegments = headExtendFirstSegment(
        snapCoveredBoundaries(kept, keptAlignments, usable, silences, cfg.audio));

      // ---- verbatim mirror of detectSeamFitDefects ----
      const committedById = new Map(committedSegments.map(s => [s.id, s.startTime]));
      const chunks = computeFaChunkPlan(segments, whisper, silences, cfg.audio);
      const runs = computeRuns(segments, whisper, silences, cfg.audio);

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
            corpus: key,
            chunkIndex: ci, segIdx, tag: tagOf(segments[segIdx]!), edge,
            fit, fitDeviation, chunkWords: words, chunkOnsets: onsets,
            chunkStartSec: chunk.startSec, chunkEndSec: chunk.endSec,
            conjunct1_fitDeviation_gt_threshold: fitOk,
          };
          // COUNTERFACTUAL MODE (WS1 Session AB): unlike the Session P probe,
          // this does NOT short-circuit at the first failing conjunct — C2/C3/C4
          // are always evaluated when structurally possible, so a sensitivity
          // sweep over R11_MIN_FIT_DEVIATION can tell, for a candidate C1
          // currently declines, what would ACTUALLY happen downstream if C1's
          // threshold moved, rather than only what fitDeviation is. `declinedAt`
          // still names the FIRST conjunct (in real evaluation order) that would
          // decline it under the CURRENT thresholds, matching the real detector.
          const failsAt: string[] = [];
          if (!fitOk) failsAt.push('C1 fitDeviation');
          if (segIdx === 0) failsAt.push('index 0 (headExtend)');

          const edgeTime = edge === 'start' ? chunk.startSec : chunk.endSec;
          const run = runs.find(r => Math.abs((edge === 'start' ? r.windowStart : r.windowEnd) - edgeTime) < 1e-6);
          const agreedAnchor = edge === 'start' ? run?.startProvenance === 'agreed-anchor' : run?.endProvenance === 'agreed-anchor';
          row['edgeTime'] = edgeTime;
          row['conjunct2_agreedAnchor'] = !!agreedAnchor;
          if (!agreedAnchor) failsAt.push('C2 agreedAnchor');

          const backingSilence = agreedAnchor ? silences.find(s => Math.abs(s.endSec - edgeTime) < 1e-6) : undefined;
          row['backingSilence'] = backingSilence ? [backingSilence.startSec, backingSilence.endSec] : null;
          if (agreedAnchor && !backingSilence) failsAt.push('C2b backingSilence');

          if (backingSilence) {
            const correctedValue = (backingSilence.startSec + backingSilence.endSec) / 2;
            const committedValue = committedById.get(segments[segIdx]!.id);
            row['correctedValue'] = correctedValue;
            row['committedValue'] = committedValue;
            if (committedValue === undefined) {
              failsAt.push('no committed');
            } else {
              const delta = correctedValue - committedValue;
              row['delta'] = delta;
              const isNoOp = Math.abs(delta) <= R11_MIN_CORRECTION_SEC;
              if (isNoOp) failsAt.push('C3 no-op delta');

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
              if (spanMaxConf === undefined) failsAt.push('C4 no usable evidence');
              else if (spanMaxConf >= R11_MAX_SPAN_WORD_CONF) failsAt.push('C4 spanMaxConf');
            }
          }
          // First failure in REAL evaluation order (short-circuit semantics),
          // even though every reachable conjunct above was computed regardless.
          const order = ['C1 fitDeviation', 'index 0 (headExtend)', 'C2 agreedAnchor', 'C2b backingSilence', 'no committed', 'C3 no-op delta', 'C4 no usable evidence', 'C4 spanMaxConf'];
          row['wouldFireIfC1Passed'] = failsAt.filter(f => f !== 'C1 fitDeviation').length === 0 && backingSilence !== undefined;
          row['declinedAt'] = order.find(o => failsAt.includes(o)) ?? null;
          rows.push(row);
        }
      }
      writeFileSync(resolve(OUT, `r11-probe-${key}.json`), JSON.stringify({
        corpus: key,
        thresholds: { R11_MIN_FIT_DEVIATION, R11_MIN_CORRECTION_SEC, R11_MAX_SPAN_WORD_CONF },
        chunkCount: chunks.length, candidateCount: rows.length,
        committedSegmentCount: committedSegments.length,
        rows,
      }, null, 2));
    }, 300_000);
  }
});
