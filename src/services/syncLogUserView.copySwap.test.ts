/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// Classification hardening (pre-landing closeout, Item 1). The user view must
// never classify by display text: a copy edit to any builder's message or
// fix hint must not move its entry to a different attention kind, details
// category, headline engine or estimated count. Every fixture below is built
// by the REAL builder, then has ALL of its display copy swapped for
// unrelated text — what a future copy pass would do — and must classify
// exactly like the original.
import { describe, it, expect } from 'vitest';
import type { SyncLogEntry, VideoSegment } from '../types';
import { TransitionType, AnimationType } from '../types';
import {
  buildCtcInfeasibleLogEntry,
  buildFaVictimRetimedLogEntry,
  buildGroupedViolationEntry,
  buildLocalCoverageWarningEntry,
  buildBundleImportFailedEntry,
  buildSyncEngineEntry,
  buildCharacterTimingEntry,
} from './syncLog';
import { buildWpmCheckLogEntry } from './syncWpmGate';
import { validateWordCoverage, validateSceneDensity } from './syncContracts';
import { buildSyncLogUserView } from './syncLogUserView';
import { buildFreezeFrameEntries } from '../App';
import type { SegmentAlignment } from './whisperService';

const RUN = 'run-1';
const AT = 1_700_000_000_000;

function seg(i: number, text: string, duration = 1, assetId?: string): VideoSegment {
  return {
    id: `seg-${i}`, order: i, text, startTime: i, duration, assetId,
    transition: TransitionType.NONE, animation: AnimationType.NONE,
  };
}

function alignWords(matchedWords: number, totalWords: number): SegmentAlignment {
  return {
    t0: 0, t1: 0, firstTokenIdx: 0, lastTokenIdx: 0,
    confidence: matchedWords / totalWords, matched: true, matchedWords, totalWords, longestRun: 1,
  };
}

/** Every display string on the entry replaced — the machine fields
 *  (type, owningRule, severity, ids, numbers, finding) left alone. */
function swapCopy(entry: SyncLogEntry): SyncLogEntry {
  return {
    ...entry,
    message: 'Reworded by a copy pass.',
    ...(entry.fixHint !== undefined ? { fixHint: 'A new, friendlier hint.' } : {}),
    ...(entry.ruleDetail ? { ruleDetail: { ...entry.ruleDetail, reason: 'Reworded reason.' } } : {}),
    ...(entry.groupedItems
      ? { groupedItems: entry.groupedItems.map(i => ({ ...i, message: 'Reworded item.', fixHint: 'Reworded.' })) }
      : {}),
  };
}

/** Everything the user view derives from one entry, as the view itself
 *  derives it (latest-run window = this entry alone). */
function classify(entry: SyncLogEntry): { attention: string[]; category: string[]; engine: string; estimated: number } {
  const view = buildSyncLogUserView([entry]);
  return {
    attention: view.attention.map(l => l.kind),
    category: view.details.counts.map(c => c.category),
    engine: view.headline.engine,
    estimated: view.headline.estimated,
  };
}

const FIXTURES: Record<string, () => SyncLogEntry> = {
  'ctc-infeasible': () => buildCtcInfeasibleLogEntry(RUN, [], [{ chunkIndex: 0, startSec: 1, endSec: 2, wordCount: 3 }], AT)!,
  'victim re-timing': () => buildFaVictimRetimedLogEntry(RUN, [
    { segmentIndex: 1, segmentId: 's1', segmentTag: 'v1', trustedStartSec: 0, trustedEndSec: 1, estimatedWordCount: 2 },
    { segmentIndex: 2, segmentId: 's2', segmentTag: 'v2', trustedStartSec: 1, trustedEndSec: 2, estimatedWordCount: 2 },
  ], AT)!,
  'density (single)': () => buildGroupedViolationEntry(RUN, validateSceneDensity([seg(0, 'x', 0.5)], [alignWords(40, 40)]), AT)!,
  'density (grouped)': () => buildGroupedViolationEntry(RUN, validateSceneDensity(
    [seg(0, 'x', 0.5), seg(1, 'y', 0.5)], [alignWords(40, 40), alignWords(40, 40)]), AT)!,
  'weak match': () => buildGroupedViolationEntry(RUN, validateWordCoverage(
    [seg(0, 'a b c d e f'), seg(1, 'a b c d e f')], [alignWords(1, 6), alignWords(1, 6)]), AT)!,
  'WPM': () => buildWpmCheckLogEntry(RUN, 1000, 60, AT)!,
  'local coverage': () => buildLocalCoverageWarningEntry(RUN, { coverage: 0.3, scriptWordCount: 100 }, AT),
  'bundle import failed': () => buildBundleImportFailedEntry(RUN, 'Bundle is missing its voiceover.', AT),
  'character-timing fallback': () => buildCharacterTimingEntry(RUN, true, 6, AT),
  'character timing (no voiceover)': () => buildCharacterTimingEntry(RUN, false, 4, AT),
  'frozen last frame': () => buildFreezeFrameEntries(RUN, [seg(0, 'x', 5, 'a1')],
    [{ id: 'a1', name: 'a1.mp4', url: '', type: 'video', duration: 2 }], AT)[0]!,
  'engine line (FA)': () => buildSyncEngineEntry(RUN, 'forced-alignment', 300, AT),
  'engine line (Whisper)': () => buildSyncEngineEntry(RUN, 'whisper', 300, AT),
};

describe('user-view classification survives a copy swap (never classifies by display text)', () => {
  it.each(Object.keys(FIXTURES).map(k => [k]))('%s', (name) => {
    const original = FIXTURES[name]!();
    expect(classify(swapCopy(original))).toEqual(classify(original));
  });

  it('the fixtures are not trivially unclassified (each originally lands somewhere specific)', () => {
    expect(classify(FIXTURES['WPM']!()).attention).toEqual(['script-audio-mismatch']);
    expect(classify(FIXTURES['density (single)']!()).attention).toEqual(['too-dense']);
    expect(classify(FIXTURES['weak match']!()).attention).toEqual(['weak-match']);
    expect(classify(FIXTURES['local coverage']!()).attention).toEqual(['script-audio-mismatch']);
    expect(classify(FIXTURES['ctc-infeasible']!()).attention).toEqual(['estimated-timings']);
    expect(classify(FIXTURES['victim re-timing']!()).estimated).toBe(2);
    expect(classify(FIXTURES['character-timing fallback']!())).toEqual(
      { attention: ['estimated-timings'], category: ['issues'], engine: 'character', estimated: 6 });
    expect(classify(FIXTURES['bundle import failed']!()).category).toEqual(['imports']);
    expect(classify(FIXTURES['frozen last frame']!()).category).toEqual(['adjustments']);
    expect(classify(FIXTURES['engine line (FA)']!()).engine).toBe('forced-alignment');
  });
});

describe('legacy entries (persisted before `finding` existed) still classify by their original text', () => {
  it.each(Object.keys(FIXTURES).map(k => [k]))('%s', (name) => {
    const original = FIXTURES[name]!();
    expect(original.finding, 'builder stamps a finding').toBeDefined();
    const { finding: _finding, ...legacy } = original;
    expect(classify(legacy)).toEqual(classify(original));
  });
});
