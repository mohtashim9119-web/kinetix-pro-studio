/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// ---------------------------------------------------------------------------
// WS1 Session P — THE ONE LIVE-FIDELITY PIPELINE.
//
// Every Session P step past regeneration (convergence, R.12 root cause, the
// Class A/B analyses, the regression pins, the cross-corpus sweep) drives the
// production rule stage over a run-id-stamped bundle. They must all drive it
// THE SAME WAY: Session P exists because two harnesses disagreed with the app
// and with each other, and re-deriving `runProductionPath` per test file is
// how that happened. So it lives here once.
//
// `runProductionPath` is `App.tsx`'s own order with `App.tsx`'s own arguments
// — including the two distinctions Session P Step 1 measured:
//   * R.5 / R.10 / R.11 / R.12 / R.13 receive the RAW Whisper array
//     (`projectRef.current.transcriptTokens`), not the filtered one.
//   * `snapCoveredBoundaries` and the alignment receive the FILTERED FA
//     tokens (`filterMalformedTokens`'s output), because that is what
//     `alignFromCache` passes.
// Getting either backwards silently changes which rules can fire at all.
// ---------------------------------------------------------------------------

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
import { detectAnchorTrustDefects, applyAnchorTrustCorrections } from '../src/services/faAnchorTrustGate';
import { computeUnscriptedRuns, computeFaChunkPlan, computeRuns } from '../src/services/faChunkPlan';
import {
  computeRunExtents, excludeRunEdgeViolations, findRunEdgeViolations,
} from '../src/services/faRuleStageExclusion';
import type { RunEdgeViolation, RunExtent } from '../src/services/faRuleStageExclusion';
import type { TranscriptToken, VideoSegment } from '../src/types';
import type { SegmentAlignment } from '../src/services/whisperService';
import type { SilenceInterval } from '../src/services/silenceDetector';
import { verifyBundle, bundleArmsFor } from './ws1-runid.js';

export const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const REPLAY_ROOT = resolve(REPO, '.work-phase4/replay');
export const OUT_ROOT = resolve(REPO, '.work-phase4/session-p');

export interface CorpusSpec {
  key: string;
  language: string;
  audioDuration: number;
  scriptPath: string;
  sceneDetailsPath: string;
}

export const CORPORA: Record<string, CorpusSpec> = {
  v6: {
    key: 'v6',
    language: 'en',
    audioDuration: 1421.29,
    scriptPath: '/Users/mohtashim/Downloads/All Projects Test Data/V6 Natural Long Pause Segs/All Text Files/Script.txt',
    sceneDetailsPath: '/Users/mohtashim/Downloads/All Projects Test Data/V6 Natural Long Pause Segs/All Text Files/Sync.txt',
  },
  '173': {
    key: '173',
    language: 'en',
    audioDuration: 709.01,
    scriptPath: '/Users/mohtashim/Downloads/All Projects Test Data/173 Segs Project/script.txt',
    sceneDetailsPath: '/Users/mohtashim/Downloads/All Projects Test Data/173 Segs Project/sync.txt',
  },
  spanish: {
    key: 'spanish',
    language: 'es',
    audioDuration: 92.04,
    scriptPath: '/Users/mohtashim/Downloads/All Projects Test Data/Spanish Project/Spanish Script.txt',
    sceneDetailsPath: '/Users/mohtashim/Downloads/All Projects Test Data/Spanish Project/Spanish Sync.txt',
  },
};

const readArm = (key: string, file: string): string => {
  const path = resolve(REPLAY_ROOT, key, file);
  if (!existsSync(path)) throw new Error(`Missing live-fidelity arm: ${path}`);
  return readFileSync(path, 'utf-8');
};

export interface LiveBundle {
  whisperTokens: TranscriptToken[];
  silences: SilenceInterval[];
  faTokens: TranscriptToken[];
  runId?: string;
}

/**
 * Loads a corpus's four-arm bundle. `requireStamp` (default true) refuses a
 * bundle whose arms do not all carry the same run id and match the manifest —
 * the Step 9 guard, applied at the point of USE rather than only in one test,
 * so no analysis can accidentally run on a mixed-vintage bundle.
 */
export function loadLiveBundle(
  key: string, requireStamp = true, silencesFile?: string, faWordsFile?: string,
): LiveBundle {
  const dir = resolve(REPLAY_ROOT, key);
  // WS1 Session AK Step 0 — per-corpus arm resolution. 173's default FA arm is
  // `fa_ah_*` (Session AH's recapture), not the retired `fa_live_*`.
  const arms = bundleArmsFor(key);
  let runId: string | undefined;
  if (requireStamp) {
    const verdict = verifyBundle(dir, arms);
    if (!verdict.ok) {
      throw new Error(`Bundle ${key} is not a single-vintage live-fidelity bundle:\n  ${verdict.problems.join('\n  ')}`);
    }
    runId = verdict.runId;
  }

  const whisperTokens: TranscriptToken[] = (
    JSON.parse(readArm(key, arms.whisperRaw!)) as {
      tokens: Array<{ text: string; startSec: number; endSec: number }>;
    }
  ).tokens.map(t => ({ text: t.text, startSec: t.startSec, endSec: t.endSec }));

  // WS1 Session AE: `silencesFile` is an ADDITIVE arm override, defaulting to
  // the manifest's own native-rate arm so every existing caller is unchanged.
  // It exists so the 16 kHz capture arm (`silences_app.json`) and the
  // native-rate arm (`silences_native.json`) can be driven through the SAME
  // production path for a rate-movement census, rather than a second harness
  // re-deriving one of them.
  const silences: SilenceInterval[] = (
    JSON.parse(readArm(key, silencesFile ?? arms.silences!)) as { silences: SilenceInterval[] }
  ).silences;

  // WS1 Session AG: `faWordsFile` is an ADDITIVE arm override on the same
  // pattern as `silencesFile` above, defaulting to the manifest's own FA arm so
  // every existing caller is unchanged. It exists so an ALTERNATE FA word set
  // (the same audio aligned against a different chunk plan — Session AG's S1
  // fold, and its own unchanged-plan fidelity re-run) can be driven through the
  // SAME production path, rather than a second harness re-deriving the rule
  // stage and disagreeing with the app the way Session P's two harnesses did.
  // The three stamped arms are still verified; only which FA words are read
  // changes.
  const faTokens: TranscriptToken[] = (
    JSON.parse(readArm(key, faWordsFile ?? arms.faWords!)) as {
      words: Array<{ word: string; startSec: number; endSec: number; confidence: number }>;
    }
  ).words.map(w => ({ text: w.word, startSec: w.startSec, endSec: w.endSec, confidence: w.confidence }));

  return { whisperTokens, silences, faTokens, runId };
}

export interface ProductionRun {
  runId?: string;
  committed: VideoSegment[];
  /** Index-parallel with `committed`: the alignment `snapCoveredBoundaries`
   *  itself was given for each committed segment, straight out of
   *  `filterToCoveredSegments`. Exposed (WS1 Session R) so a consumer reads the
   *  SAME per-segment token attribution production snapped against, rather than
   *  recomputing an alignment over a different array and hoping the indices
   *  still line up — a segment skipped by R.10/the coverage filter shifts every
   *  later index, so `alignments[i]` from a fresh full-array pass is NOT
   *  `committed[i]`'s alignment whenever anything was skipped. */
  keptAlignments: SegmentAlignment[];
  preRuleSegments: VideoSegment[];
  fired: Record<string, number>;
  kept: number;
  skipped: number;
  aborted: boolean;
  whisperFilter: { total: number; skipped: number; kept: number; dropReasons: Record<string, number> };
  r5runs: ReturnType<typeof computeUnscriptedRuns>;
  /** WS1 Session S — the acoustic run extents R-AP is stated against, and
   *  everything the invariant produced this run. `r11` / `r13` below are the
   *  rules' RAW proposals (what the detector found); `r11Kept` / `r13Kept` are
   *  what actually reached the array after R-AP declined the rest. A consumer
   *  that wants "what fired" wants the KEPT list; a consumer studying the
   *  collision wants both. */
  runExtents: RunExtent[];
  r11Excluded: ReturnType<typeof excludeRunEdgeViolations<ReturnType<typeof detectSeamFitDefects>[number]>>['excluded'];
  r13Excluded: ReturnType<typeof excludeRunEdgeViolations<ReturnType<typeof detectUtterancePlacementDefects>[number]>>['excluded'];
  r11Kept: ReturnType<typeof detectSeamFitDefects>;
  r13Kept: ReturnType<typeof detectUtterancePlacementDefects>;
  runEdgeViolations: RunEdgeViolation[];
  /** WS1 Session AE — R.14/R.15's raw proposals, in one array (the gate is
   *  one detector; `finding.rule` says which rule owns each row). */
  anchorTrust: ReturnType<typeof detectAnchorTrustDefects>;
  r11: ReturnType<typeof detectSeamFitDefects>;
  r12: ReturnType<typeof detectRunPlacementDefects>;
  r13: ReturnType<typeof detectUtterancePlacementDefects>;
  unspoken: ReturnType<typeof detectUnspokenScriptSegmentsFromWhisper>;
  anchorTimed: VideoSegment[];
  whisperTokens: TranscriptToken[];
  faTokens: TranscriptToken[];
  usableFaTokens: TranscriptToken[];
  silences: SilenceInterval[];
  chunks: ReturnType<typeof computeFaChunkPlan>;
  runs: ReturnType<typeof computeRuns>;
}

/** The real production rule stage, in App.tsx's order, over one live bundle. */
export async function runProductionPath(
  spec: CorpusSpec, requireStamp = true, silencesFile?: string, faWordsFile?: string,
): Promise<ProductionRun> {
  const { whisperTokens, silences, faTokens, runId } =
    loadLiveBundle(spec.key, requireStamp, silencesFile, faWordsFile);
  const audioDuration = spec.audioDuration;

  const newSegmentsRaw = await parseProjectData(
    readFileSync(spec.scriptPath, 'utf-8'), readFileSync(spec.sceneDetailsPath, 'utf-8'), [], audioDuration,
  );
  const anchorTimed = applyAnchorBasedTiming(newSegmentsRaw, audioDuration);

  // alignFromCache filters the tokens it was GIVEN — FA tokens on this branch.
  const filtered = filterMalformedTokens(faTokens, audioDuration);
  const usable = filtered.tokens;
  const alignments = alignScenestoTranscript(anchorTimed, usable, silences, audioDuration);
  const alignedSegments = applyAnchorBasedTiming(
    distributeSegmentTimes(anchorTimed, alignments, 'forced-alignment'), audioDuration,
  );
  const gate = evaluateCoverageGate(alignedSegments, alignments, countTranscriptWords(usable));

  const wFilter = filterMalformedTokens([...whisperTokens], audioDuration);
  const dropReasons: Record<string, number> = {};
  for (const d of wFilter.drops) dropReasons[d.reason] = (dropReasons[d.reason] ?? 0) + 1;

  const fired: Record<string, number> = {};
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
  let committed = headExtendFirstSegment(
    snapCoveredBoundaries(kept, keptAlignments, usable, silences, audioDuration),
  );
  const preRuleSegments = committed.map(s => ({ ...s }));

  // WS1 Session S, R-AP — the same origin array and the same run extents
  // App.tsx builds, at the same point in the stage. Mirroring this is the
  // whole contract of this file: a harness that skipped the exclusion would
  // measure a pipeline the app does not run.
  const runExtents = computeRunExtents(anchorTimed, whisperTokens, silences, audioDuration);
  const originById = new Map(preRuleSegments.map(s => [s.id, s.startTime]));

  const r11 = detectSeamFitDefects(anchorTimed, committed, whisperTokens, faTokens, silences, audioDuration);
  const r11Verdict = excludeRunEdgeViolations(r11, originById, runExtents);
  fired['R.11'] = r11Verdict.kept.length;
  committed = applySeamFitCorrections(committed, r11Verdict.kept);

  const r12 = detectRunPlacementDefects(anchorTimed, committed, whisperTokens, silences, audioDuration);
  fired['R.12'] = r12.length;
  committed = applyRunPlacementCorrections(committed, r12);

  const r13 = detectUtterancePlacementDefects(anchorTimed, committed, whisperTokens, silences, audioDuration);
  const r13Verdict = excludeRunEdgeViolations(r13, originById, runExtents);
  fired['R.13'] = r13Verdict.kept.length;
  committed = applyUtterancePlacementCorrections(committed, r13Verdict.kept);

  // WS1 Session AE, R.14/R.15 (faAnchorTrustGate.ts) — the anchor-trust gate,
  // last in the stage and on the composed array, exactly as App.tsx runs it.
  const anchorTrust = detectAnchorTrustDefects(committed, keptAlignments, usable, silences);
  fired['R.14'] = anchorTrust.filter(f => f.rule === 'R.14').length;
  fired['R.15'] = anchorTrust.filter(f => f.rule === 'R.15').length;
  committed = applyAnchorTrustCorrections(committed, anchorTrust);

  const runEdgeViolations = findRunEdgeViolations(
    preRuleSegments, committed, runExtents, new Set(r12.map(f => f.segmentId)),
  );

  return {
    runId, committed, keptAlignments, preRuleSegments, fired, kept: kept.length, skipped: skipped.length,
    runExtents, runEdgeViolations,
    r11Excluded: r11Verdict.excluded, r13Excluded: r13Verdict.excluded,
    r11Kept: r11Verdict.kept, r13Kept: r13Verdict.kept,
    aborted: gate.aborted,
    whisperFilter: { total: wFilter.totalTokens, skipped: wFilter.skippedCount, kept: wFilter.tokens.length, dropReasons },
    r5runs, r11, r12, r13, anchorTrust, unspoken, anchorTimed, whisperTokens, faTokens, usableFaTokens: usable, silences,
    chunks: computeFaChunkPlan(anchorTimed, whisperTokens, silences, audioDuration),
    runs: computeRuns(anchorTimed, whisperTokens, silences, audioDuration),
  };
}

export const tagOf = (s: VideoSegment): string => (s as unknown as { tag?: string }).tag ?? '';
