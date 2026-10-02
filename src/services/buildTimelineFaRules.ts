/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/** R.11–R.15 as the editor applies them after snap + head-extend. Same
 *  functions, same order — not a new timing path. */

import type { TranscriptToken, VideoSegment, SyncLogEntry } from '../types';
import type { SegmentAlignment } from './whisperService';
import { toAlignmentLanguageCode } from './whisperService';
import type { SilenceInterval } from './silenceDetector';
import { detectSeamFitDefects, applySeamFitCorrections } from './faSeamFitGate';
import { detectRunPlacementDefects, applyRunPlacementCorrections, detectUtterancePlacementDefects, applyUtterancePlacementCorrections } from './faRunPlacementGate';
import { detectAnchorTrustDefects, applyAnchorTrustCorrections } from './faAnchorTrustGate';
import { computeRunExtents, excludeRunEdgeViolations, findRunEdgeViolations, describeRunEdgeViolation } from './faRuleStageExclusion';
import {
  buildSeamFitLogEntries,
  buildRunPlacementLogEntries,
  buildUtterancePlacementLogEntries,
  buildAnchorTrustLogEntries,
  buildRunEdgeViolationLogEntries,
} from './syncLog';
import { insertSkippedScenePlaceholders } from './skippedScenePlaceholders';

export interface FaRuleStageInput {
  anchorTimed: VideoSegment[];
  finalTimed: VideoSegment[];
  keptAlignments: SegmentAlignment[];
  preFilterSegments: VideoSegment[];
  skippedIndices: ReadonlySet<number>;
  coverage: SegmentAlignment[];
  rawTranscriptTokens: TranscriptToken[];
  faTokens: TranscriptToken[];
  snapTokens: TranscriptToken[];
  silences: SilenceInterval[];
  audioDuration: number;
  language: string | undefined;
  syncRunId: string;
  at: number;
}

export function applyFaRuleStage(input: FaRuleStageInput): {
  segments: VideoSegment[];
  alignments: SegmentAlignment[];
  logEntries: SyncLogEntry[];
} {
  const lang = toAlignmentLanguageCode(input.language);
  const logEntries: SyncLogEntry[] = [];
  let finalTimedSegments = input.finalTimed;

  const preRuleSegments = finalTimedSegments.map(s => ({ ...s }));
  const runExtents = computeRunExtents(
    input.anchorTimed, input.rawTranscriptTokens, input.silences, input.audioDuration, lang,
  );
  const originById = new Map(preRuleSegments.map(s => [s.id, s.startTime]));

  const seamFitFindings = detectSeamFitDefects(
    input.anchorTimed, finalTimedSegments, input.rawTranscriptTokens, input.faTokens,
    input.silences, input.audioDuration, lang,
  );
  const seamFitVerdict = excludeRunEdgeViolations(seamFitFindings, originById, runExtents);
  if (seamFitVerdict.kept.length > 0) {
    logEntries.push(...buildSeamFitLogEntries(input.syncRunId, seamFitVerdict.kept, finalTimedSegments, input.at));
  }
  finalTimedSegments = applySeamFitCorrections(finalTimedSegments, seamFitVerdict.kept);

  const runPlacementFindings = detectRunPlacementDefects(
    input.anchorTimed, finalTimedSegments, input.rawTranscriptTokens,
    input.silences, input.audioDuration, lang,
  );
  if (runPlacementFindings.length > 0) {
    logEntries.push(...buildRunPlacementLogEntries(input.syncRunId, runPlacementFindings, finalTimedSegments, input.at));
  }
  finalTimedSegments = applyRunPlacementCorrections(finalTimedSegments, runPlacementFindings);

  const utteranceFindings = detectUtterancePlacementDefects(
    input.anchorTimed, finalTimedSegments, input.rawTranscriptTokens,
    input.silences, input.audioDuration, lang,
  );
  const utteranceVerdict = excludeRunEdgeViolations(utteranceFindings, originById, runExtents);
  if (utteranceVerdict.kept.length > 0) {
    logEntries.push(...buildUtterancePlacementLogEntries(input.syncRunId, utteranceVerdict.kept, finalTimedSegments, input.at));
  }
  finalTimedSegments = applyUtterancePlacementCorrections(finalTimedSegments, utteranceVerdict.kept);

  const insertion = insertSkippedScenePlaceholders(
    finalTimedSegments, input.keptAlignments, input.preFilterSegments,
    input.skippedIndices, input.coverage, input.snapTokens, input.audioDuration,
  );
  finalTimedSegments = insertion.segments;
  const placeholderAlignments = insertion.alignments;

  const anchorTrustFindings = detectAnchorTrustDefects(
    finalTimedSegments, placeholderAlignments, input.snapTokens, input.silences,
  );
  if (anchorTrustFindings.length > 0) {
    logEntries.push(...buildAnchorTrustLogEntries(input.syncRunId, anchorTrustFindings, finalTimedSegments, input.at));
  }
  finalTimedSegments = applyAnchorTrustCorrections(finalTimedSegments, anchorTrustFindings);

  const runEdgeViolations = findRunEdgeViolations(
    preRuleSegments, finalTimedSegments, runExtents,
    new Set(runPlacementFindings.map(f => f.segmentId)),
  );
  if (runEdgeViolations.length > 0) {
    console.error(
      `[sync] R-AP VIOLATED — ${runEdgeViolations.length} boundary/boundaries moved across an ` +
      `unscripted-run edge by a rule that does not own them:\n  ` +
      runEdgeViolations.map(describeRunEdgeViolation).join('\n  '),
    );
    logEntries.push(...buildRunEdgeViolationLogEntries(input.syncRunId, runEdgeViolations, finalTimedSegments, input.at));
  }

  return { segments: finalTimedSegments, alignments: placeholderAlignments, logEntries };
}
