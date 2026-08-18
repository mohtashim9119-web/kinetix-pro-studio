// WS-logs — persistent sync log (R4-4).
//
// The log-UPDATE logic is what's tested here: the pure builders and the fold
// onto the Project. The panel itself (components/SyncLogPanel.tsx) is
// rendering, and is verified manually.
import { describe, it, expect } from 'vitest';
import {
  clearSyncLog,
  buildSkipLogEntries,
  buildSyncAbortEntry,
  buildNoAssetSummaryEntry,
  buildRescueLogEntries,
  buildSyncInfoEntry,
  buildSyncInfoMessage,
  SYNC_LOG_TEXT_PREVIEW_CHARS,
  type SkippedSegmentRecord,
  type RescuedSegmentRecord,
} from '../App';
import {
  appendSyncLogEntries,
  buildSilenceErrorEntry,
  buildMalformedTokenEntry,
  buildContractViolationEntry,
  buildGroupedViolationEntry,
  buildLockRefusedLogEntry,
  makeSyncLogEntry,
  buildSyncEngineEntry,
  buildFaFallbackEntry,
  buildUnscriptedRunLogEntries,
  buildUnspokenScriptLogEntries,
  buildSeamFitLogEntries,
  buildRunPlacementLogEntries,
  buildUtterancePlacementLogEntries,
} from './syncLog';
import { MAX_LOG_ENTRIES, MAX_SYNC_RUN_SUMMARIES, WORD_COVERAGE_MIN_RATIO } from './syncConstants';
import { TransitionType, AnimationType } from '../types';
import type { Project, SyncLogEntry, SyncRunSummary, VideoSegment } from '../types';
import type { ContractViolation } from './syncContracts';

const RUN_ID = 'run-1';
const AT = 1_700_000_000_000;

function makeProject(partial: Partial<Project> = {}): Project {
  return {
    id: 'p1',
    name: 'Test Project',
    script: '',
    sceneDetails: '',
    segments: [],
    assets: [],
    globalTransition: TransitionType.NONE,
    globalTransitionDuration: 0.5,
    globalAnimation: AnimationType.NONE,
    globalOverlayConfig: { color: '#fff', backgroundColor: 'transparent', fontFamily: 'Inter' },
    ...partial,
  };
}

function makeSummary(partial: Partial<SyncRunSummary> = {}): SyncRunSummary {
  return {
    syncRunId: RUN_ID,
    timestamp: AT,
    totalSegments: 8,
    coveredSegments: 8,
    skippedSegments: 0,
    aborted: false,
    ...partial,
  };
}

function makeEntries(count: number, runId = RUN_ID): SyncLogEntry[] {
  return Array.from({ length: count }, (_, i) =>
    makeSyncLogEntry(runId, 'info', `entry ${i}`, undefined, AT + i),
  );
}

describe('appendSyncLogEntries', () => {
  it('appends entries and a summary to a project with no log at all', () => {
    const project = makeProject();
    expect(project.syncLog).toBeUndefined();
    expect(project.syncRunSummaries).toBeUndefined();

    const next = appendSyncLogEntries(project, makeEntries(2), makeSummary());

    expect(next.syncLog).toHaveLength(2);
    expect(next.syncRunSummaries).toHaveLength(1);
    expect(next.syncLog![0]!.message).toBe('entry 0');
  });

  it('appends to an existing log without disturbing what is already there', () => {
    const existing = makeEntries(3, 'older-run');
    const project = makeProject({
      syncLog: existing,
      syncRunSummaries: [makeSummary({ syncRunId: 'older-run' })],
    });

    const next = appendSyncLogEntries(project, makeEntries(2), makeSummary());

    expect(next.syncLog).toHaveLength(5);
    // Append order: oldest first, newest at the end.
    expect(next.syncLog!.slice(0, 3).map(e => e.syncRunId)).toEqual(
      ['older-run', 'older-run', 'older-run'],
    );
    expect(next.syncLog!.slice(3).map(e => e.syncRunId)).toEqual([RUN_ID, RUN_ID]);
    expect(next.syncRunSummaries!.map(s => s.syncRunId)).toEqual(['older-run', RUN_ID]);
  });

  it('does not mutate the input project or its arrays', () => {
    const existing = makeEntries(2);
    const summaries = [makeSummary()];
    const project = makeProject({ syncLog: existing, syncRunSummaries: summaries });

    appendSyncLogEntries(project, makeEntries(1), makeSummary({ syncRunId: 'run-2' }));

    expect(project.syncLog).toHaveLength(2);
    expect(project.syncRunSummaries).toHaveLength(1);
    expect(existing).toHaveLength(2);
    expect(summaries).toHaveLength(1);
  });

  it('prunes the OLDEST entries when the log exceeds MAX_LOG_ENTRIES', () => {
    const project = makeProject({ syncLog: makeEntries(MAX_LOG_ENTRIES, 'older-run') });

    const next = appendSyncLogEntries(project, makeEntries(5), makeSummary());

    expect(next.syncLog).toHaveLength(MAX_LOG_ENTRIES);
    // The 5 new entries survive; the 5 oldest are gone.
    expect(next.syncLog!.slice(-5).map(e => e.syncRunId)).toEqual(Array(5).fill(RUN_ID));
    expect(next.syncLog!.filter(e => e.syncRunId === 'older-run')).toHaveLength(
      MAX_LOG_ENTRIES - 5,
    );
    // Specifically, entries 0..4 of the old run are the ones dropped.
    expect(next.syncLog![0]!.message).toBe('entry 5');
  });

  it('does not prune when the log lands exactly on MAX_LOG_ENTRIES', () => {
    const project = makeProject({ syncLog: makeEntries(MAX_LOG_ENTRIES - 1, 'older-run') });

    const next = appendSyncLogEntries(project, makeEntries(1), makeSummary());

    expect(next.syncLog).toHaveLength(MAX_LOG_ENTRIES);
    expect(next.syncLog![0]!.message).toBe('entry 0');
  });

  it('prunes the OLDEST summaries when they exceed MAX_SYNC_RUN_SUMMARIES', () => {
    const summaries = Array.from({ length: MAX_SYNC_RUN_SUMMARIES }, (_, i) =>
      makeSummary({ syncRunId: `run-${i}`, timestamp: AT + i }),
    );
    const project = makeProject({ syncRunSummaries: summaries });

    const next = appendSyncLogEntries(project, [], makeSummary({ syncRunId: 'newest' }));

    expect(next.syncRunSummaries).toHaveLength(MAX_SYNC_RUN_SUMMARIES);
    expect(next.syncRunSummaries!.at(-1)!.syncRunId).toBe('newest');
    // run-0 (the oldest) was dropped.
    expect(next.syncRunSummaries!.some(s => s.syncRunId === 'run-0')).toBe(false);
    expect(next.syncRunSummaries![0]!.syncRunId).toBe('run-1');
  });

  it('leaves summaries untouched (but still an array) when no summary is passed', () => {
    const project = makeProject({ syncRunSummaries: [makeSummary()] });

    const next = appendSyncLogEntries(project, makeEntries(1));

    expect(next.syncRunSummaries).toHaveLength(1);
    expect(next.syncLog).toHaveLength(1);
  });
});

describe('backward compatibility — pre-WS-logs projects', () => {
  it('treats syncLog/syncRunSummaries: undefined as empty and normalises both to arrays', () => {
    const legacy = makeProject({ syncLog: undefined, syncRunSummaries: undefined });

    const next = appendSyncLogEntries(legacy, [], undefined);

    expect(next.syncLog).toEqual([]);
    expect(next.syncRunSummaries).toEqual([]);
  });

  it('carries every other Project field through untouched', () => {
    const legacy = makeProject({ name: 'Legacy', voiceoverId: 'vo-1' });

    const next = appendSyncLogEntries(legacy, makeEntries(1), makeSummary());

    expect(next.name).toBe('Legacy');
    expect(next.voiceoverId).toBe('vo-1');
    expect(next.segments).toBe(legacy.segments);
    expect(next.assets).toBe(legacy.assets);
  });

  it('clears a legacy project without throwing on the undefined fields', () => {
    const next = clearSyncLog(makeProject());
    expect(next.syncLog).toEqual([]);
    expect(next.syncRunSummaries).toEqual([]);
  });
});

describe('clearSyncLog', () => {
  it('empties both syncLog and syncRunSummaries', () => {
    const project = makeProject({
      syncLog: makeEntries(12),
      syncRunSummaries: [makeSummary(), makeSummary({ syncRunId: 'run-2' })],
    });

    const next = clearSyncLog(project);

    expect(next.syncLog).toEqual([]);
    expect(next.syncRunSummaries).toEqual([]);
  });

  it('does not mutate the input project', () => {
    const project = makeProject({ syncLog: makeEntries(3), syncRunSummaries: [makeSummary()] });

    clearSyncLog(project);

    expect(project.syncLog).toHaveLength(3);
    expect(project.syncRunSummaries).toHaveLength(1);
  });

  it('leaves the rest of the project alone', () => {
    const project = makeProject({ name: 'Keep me', syncLog: makeEntries(2) });
    const next = clearSyncLog(project);
    expect(next.name).toBe('Keep me');
    expect(next.id).toBe('p1');
  });
});

describe('buildSkipLogEntries', () => {
  // Bug 2 fix: 'low confidence' is no longer a possible SegmentSkipReason —
  // matched-but-weak segments are kept, not skipped — so both fixtures below
  // use the sole remaining reason, 'no audio match'.
  const skipped: SkippedSegmentRecord[] = [
    { segmentIndex: 2, segmentText: 'The harbour at dawn.', reason: 'no audio match' },
    { segmentIndex: 5, segmentText: 'A wide shot of the valley.', reason: 'no audio match' },
  ];

  it('emits one entry per skipped segment, carrying index, text and reason', () => {
    const entries = buildSkipLogEntries(RUN_ID, skipped, AT);

    expect(entries).toHaveLength(2);
    expect(entries[0]).toMatchObject({
      syncRunId: RUN_ID,
      timestamp: AT,
      type: 'skip',
      segmentIndex: 2,
      segmentText: 'The harbour at dawn.',
      reason: 'no audio match',
    });
    expect(entries[1]).toMatchObject({
      type: 'skip',
      segmentIndex: 5,
      reason: 'no audio match',
    });
  });

  it('renders a 1-based scene number in the message while storing the 0-based index', () => {
    const [first] = buildSkipLogEntries(RUN_ID, skipped, AT);
    expect(first!.message).toBe('Scene 3 skipped — no audio match.');
    expect(first!.segmentIndex).toBe(2);
  });

  it('truncates segmentText to SYNC_LOG_TEXT_PREVIEW_CHARS with an ellipsis', () => {
    const long = 'x'.repeat(SYNC_LOG_TEXT_PREVIEW_CHARS + 40);
    const [entry] = buildSkipLogEntries(
      RUN_ID,
      [{ segmentIndex: 0, segmentText: long, reason: 'no audio match' }],
      AT,
    );
    expect(entry!.segmentText).toHaveLength(SYNC_LOG_TEXT_PREVIEW_CHARS + 1); // + the ellipsis
    expect(entry!.segmentText!.endsWith('…')).toBe(true);
  });

  it('leaves short text untouched (trimmed, no ellipsis)', () => {
    const [entry] = buildSkipLogEntries(
      RUN_ID,
      [{ segmentIndex: 0, segmentText: '  Short scene.  ', reason: 'no audio match' }],
      AT,
    );
    expect(entry!.segmentText).toBe('Short scene.');
  });

  it('gives every entry a distinct id but the same syncRunId', () => {
    const entries = buildSkipLogEntries(RUN_ID, skipped, AT);
    expect(new Set(entries.map(e => e.id)).size).toBe(2);
    expect(new Set(entries.map(e => e.syncRunId)).size).toBe(1);
  });

  it('returns an empty array for an empty skip list', () => {
    expect(buildSkipLogEntries(RUN_ID, [], AT)).toEqual([]);
  });

  // WS-logs skip detail — tag + match-count fields (segmentTag, matchedWords,
  // totalWords, confidence) copied straight from the record to the entry.
  it('copies segmentTag, matchedWords, totalWords and confidence from record to entry', () => {
    const [entry] = buildSkipLogEntries(
      RUN_ID,
      [{
        segmentIndex: 0,
        segmentText: 'This is a test missing segment.',
        reason: 'no audio match',
        segmentTag: 'missing1',
        matchedWords: 2,
        totalWords: 8,
        confidence: 0.25,
      }],
      AT,
    );
    expect(entry).toMatchObject({
      segmentTag: 'missing1',
      matchedWords: 2,
      totalWords: 8,
      confidence: 0.25,
    });
  });

  it('leaves the new fields undefined when the record does not carry them (backward compat)', () => {
    const [entry] = buildSkipLogEntries(
      RUN_ID,
      [{ segmentIndex: 0, segmentText: 'Old-style skip record.', reason: 'no audio match' }],
      AT,
    );
    expect(entry!.segmentTag).toBeUndefined();
    expect(entry!.matchedWords).toBeUndefined();
    expect(entry!.totalWords).toBeUndefined();
    expect(entry!.confidence).toBeUndefined();
  });
});

describe('buildSyncAbortEntry', () => {
  it('is an abort entry carrying the message and no segment fields', () => {
    const entry = buildSyncAbortEntry(RUN_ID, "This voiceover doesn't match your scene doc.", AT);

    expect(entry.type).toBe('abort');
    expect(entry.message).toBe("This voiceover doesn't match your scene doc.");
    expect(entry.syncRunId).toBe(RUN_ID);
    expect(entry.timestamp).toBe(AT);
    expect(entry.segmentIndex).toBeUndefined();
    expect(entry.segmentText).toBeUndefined();
    expect(entry.reason).toBeUndefined();
  });

  it('pairs with an aborted summary that records the reason and zero coverage', () => {
    const message = 'No speech was found in the audio.';
    const next = appendSyncLogEntries(
      makeProject(),
      [buildSyncAbortEntry(RUN_ID, message, AT)],
      makeSummary({ aborted: true, abortReason: message, coveredSegments: 0, skippedSegments: 0 }),
    );

    expect(next.syncRunSummaries![0]).toMatchObject({
      aborted: true,
      abortReason: message,
      coveredSegments: 0,
      skippedSegments: 0,
    });
  });
});

describe('buildSyncInfoEntry', () => {
  // Bug 1 fix: buildSyncInfoEntry now always fires on a successful sync — with
  // or without skips — so it takes an explicit skippedSegments count and folds
  // it into the message rather than only being called on the 0-skip path.
  it('is an info entry with the matched/total counts and no segment fields (0 skips)', () => {
    const entry = buildSyncInfoEntry(RUN_ID, 8, 8, 0, AT);

    expect(entry.type).toBe('info');
    expect(entry.message).toBe('Sync completed: 8 of 8 segments matched.');
    expect(entry.segmentIndex).toBeUndefined();
    expect(entry.segmentText).toBeUndefined();
    expect(entry.reason).toBeUndefined();
  });

  it('reports partial coverage honestly rather than rounding up to total (0 skips)', () => {
    expect(buildSyncInfoEntry(RUN_ID, 10, 7, 0, AT).message)
      .toBe('Sync completed: 7 of 10 segments matched.');
  });

  it('appends a skipped-count sentence when the run had skips (Bug 1)', () => {
    const entry = buildSyncInfoEntry(RUN_ID, 10, 8, 2, AT);
    expect(entry.type).toBe('info');
    expect(entry.message).toBe('Sync completed: 8 of 10 segments matched. 2 skipped.');
  });
});

describe('buildSyncInfoMessage (Bug 1)', () => {
  it('omits the skipped sentence entirely when skippedSegments is 0', () => {
    expect(buildSyncInfoMessage(8, 8, 0)).toBe('Sync completed: 8 of 8 segments matched.');
  });

  it('appends "N skipped." when skippedSegments > 0', () => {
    expect(buildSyncInfoMessage(10, 8, 2)).toBe('Sync completed: 8 of 10 segments matched. 2 skipped.');
  });
});

describe('makeSyncLogEntry', () => {
  it('supports the warning type used by the character-timing fallback branch', () => {
    const entry = makeSyncLogEntry(RUN_ID, 'warning', 'Fell back to character-based timing.', undefined, AT);
    expect(entry.type).toBe('warning');
    expect(entry.segmentIndex).toBeUndefined();
  });

  it('mints unique ids across calls', () => {
    const ids = Array.from({ length: 50 }, () => makeSyncLogEntry(RUN_ID, 'info', 'x').id);
    expect(new Set(ids).size).toBe(50);
  });
});

// ---------------------------------------------------------------------------
// WS4 — the two new run-level entry kinds (Features 3 and 4)
// ---------------------------------------------------------------------------

describe('buildSilenceErrorEntry (WS4 Feature 3)', () => {
  it('builds a silence-error entry carrying the detector message', () => {
    const entry = buildSilenceErrorEntry(RUN_ID, 'Unable to decode audio data', AT);

    expect(entry.type).toBe('silence-error');
    expect(entry.syncRunId).toBe(RUN_ID);
    expect(entry.timestamp).toBe(AT);
    expect(entry.errorMessage).toBe('Unable to decode audio data');
    expect(entry.message).toContain('Silence detection failed');
  });

  it('says in plain language that sync continued on midpoints', () => {
    const entry = buildSilenceErrorEntry(RUN_ID, 'boom', AT);
    expect(entry.message).toMatch(/midpoint/i);
  });

  it('carries no segment fields — it describes the run, not a scene', () => {
    const entry = buildSilenceErrorEntry(RUN_ID, 'boom', AT);
    expect(entry.segmentIndex).toBeUndefined();
    expect(entry.segmentText).toBeUndefined();
  });
});

describe('buildMalformedTokenEntry (WS4 Feature 4)', () => {
  it('builds a malformed-token entry with both counts', () => {
    const entry = buildMalformedTokenEntry(RUN_ID, 3, 420, AT);

    expect(entry.type).toBe('malformed-token');
    expect(entry.skippedTokenCount).toBe(3);
    expect(entry.totalTokenCount).toBe(420);
    expect(entry.message).toContain('3 of 420');
  });

  it('is informational, not an error — the tokens were handled', () => {
    const entry = buildMalformedTokenEntry(RUN_ID, 1, 10, AT);
    expect(entry.type).not.toBe('abort');
    expect(entry.type).not.toBe('silence-error');
  });
});

describe('SyncRunSummary.silenceErrorCount (WS4 Feature 3)', () => {
  it('folds a summary carrying the counter onto the project', () => {
    const project = makeProject();
    const summary = makeSummary({ silenceErrorCount: 1 });

    const next = appendSyncLogEntries(project, [], summary);
    expect(next.syncRunSummaries).toHaveLength(1);
    expect(next.syncRunSummaries![0]!.silenceErrorCount).toBe(1);
  });

  it('records zero on a run where silence detection succeeded', () => {
    const next = appendSyncLogEntries(makeProject(), [], makeSummary({ silenceErrorCount: 0 }));
    expect(next.syncRunSummaries![0]!.silenceErrorCount).toBe(0);
  });

  it('treats a pre-WS4 summary with no counter as undefined, not a crash', () => {
    const legacy: SyncRunSummary = makeSummary();
    delete (legacy as { silenceErrorCount?: number }).silenceErrorCount;

    const next = appendSyncLogEntries(makeProject(), [], legacy);
    expect(next.syncRunSummaries![0]!.silenceErrorCount).toBeUndefined();
  });
});

describe('WS4 entries fold onto the project like any other', () => {
  it('appends both new kinds alongside skip/info entries in order', () => {
    const entries = [
      buildSilenceErrorEntry(RUN_ID, 'decode failed', AT),
      buildMalformedTokenEntry(RUN_ID, 2, 50, AT),
      buildSyncInfoEntry(RUN_ID, 8, 8, 0, AT),
    ];

    const next = appendSyncLogEntries(makeProject(), entries, makeSummary({ silenceErrorCount: 1 }));
    expect(next.syncLog!.map(e => e.type)).toEqual(['silence-error', 'malformed-token', 'info']);
  });

  it('prunes the new kinds under MAX_LOG_ENTRIES like every other entry', () => {
    const project = makeProject({ syncLog: makeEntries(MAX_LOG_ENTRIES) });
    const next = appendSyncLogEntries(project, [buildSilenceErrorEntry(RUN_ID, 'boom', AT)]);

    expect(next.syncLog).toHaveLength(MAX_LOG_ENTRIES);
    expect(next.syncLog![MAX_LOG_ENTRIES - 1]!.type).toBe('silence-error');
  });
});

describe('buildNoAssetSummaryEntry (WS3 Batch B, Piece 1 — the single merged "no asset" emitter)', () => {
  it('returns undefined for an empty no-asset list — caller never appends a zero entry', () => {
    expect(buildNoAssetSummaryEntry(RUN_ID, [], 294, 200, AT)).toBeUndefined();
  });

  it('builds the exact message format, including en-dash ranges and 2-run singles', () => {
    const numbers = [7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 23, 78, 79, 80, 81, 82, 83, 84, 85, 86, 87, 88, 89, 90, 91, 92, 93, 94, 95, 96, 97];
    const entry = buildNoAssetSummaryEntry(RUN_ID, numbers, 294, 200, AT);

    // 33 numbers total (12 + 1 + 20) — the spec's illustrative message uses "47"
    // as a stand-in count, not derived from this exact example list.
    expect(entry!.message).toBe('No asset available for 33 of 294 segments (200 assets for 294 segments): 7–18, 23, 78–97.');
  });

  it('renders a 2-run as two singles within the message (compactRanges integration)', () => {
    const entry = buildNoAssetSummaryEntry(RUN_ID, [7, 8], 20, 15, AT);
    expect(entry!.message).toBe('No asset available for 2 of 20 segments (15 assets for 20 segments): 7, 8.');
  });

  it('singularizes "asset" for a count of exactly 1', () => {
    const entry = buildNoAssetSummaryEntry(RUN_ID, [3], 10, 1, AT);
    expect(entry!.message).toBe('No asset available for 1 of 10 segments (1 asset for 10 segments): 3.');
  });

  it('carries type "no-asset", the given syncRunId, and timestamp', () => {
    const entry = buildNoAssetSummaryEntry(RUN_ID, [3], 10, 5, AT)!;
    expect(entry.type).toBe('no-asset');
    expect(entry.syncRunId).toBe(RUN_ID);
    expect(entry.timestamp).toBe(AT);
  });

  it('folds alongside skip entries without disturbing the MAX_LOG_ENTRIES prune', () => {
    const project = makeProject({ syncLog: makeEntries(MAX_LOG_ENTRIES) });
    const noAssetEntry = buildNoAssetSummaryEntry(RUN_ID, [1, 2], 10, 8, AT)!;
    const skipRecord: SkippedSegmentRecord = {
      segmentIndex: 0,
      segmentText: 'unmatched scene',
      reason: 'no audio match',
    };
    const next = appendSyncLogEntries(
      project,
      [...buildSkipLogEntries(RUN_ID, [skipRecord], AT), noAssetEntry],
    );

    expect(next.syncLog).toHaveLength(MAX_LOG_ENTRIES);
    expect(next.syncLog![MAX_LOG_ENTRIES - 1]!.type).toBe('no-asset');
  });
});

describe('buildRescueLogEntries (rescue observability, false-positive rescue fix)', () => {
  it('returns [] for an empty rescued list — caller never appends zero entries', () => {
    expect(buildRescueLogEntries(RUN_ID, [], AT)).toEqual([]);
  });

  it('builds the exact message format for a global-fallback recovery, including the anchor clause', () => {
    const record: RescuedSegmentRecord = {
      segmentIndex: 152, // 0-based -> "Segment 153"
      recoveredVia: 'global',
      recoveredRegion: { startSec: 50, endSec: 52 },
      anchorStart: 6,
    };
    const [entry] = buildRescueLogEntries(RUN_ID, [record], AT);
    expect(entry!.message).toBe(
      'Segment 153 recovered via global fallback — matched audio at 00:50–00:52 (anchor estimate 00:06).',
    );
  });

  it('omits the anchor clause when anchorStart is undefined', () => {
    const record: RescuedSegmentRecord = {
      segmentIndex: 0,
      recoveredVia: 'windowed',
      recoveredRegion: { startSec: 5, endSec: 6 },
    };
    const [entry] = buildRescueLogEntries(RUN_ID, [record], AT);
    expect(entry!.message).toBe('Segment 1 recovered via windowed fallback — matched audio at 00:05–00:06.');
  });

  it('labels each recoveredVia pass distinctly', () => {
    const records: RescuedSegmentRecord[] = [
      { segmentIndex: 0, recoveredVia: 'windowed', recoveredRegion: { startSec: 1, endSec: 2 } },
      { segmentIndex: 1, recoveredVia: 'global', recoveredRegion: { startSec: 3, endSec: 4 } },
      { segmentIndex: 2, recoveredVia: 'concat', recoveredRegion: { startSec: 5, endSec: 6 } },
    ];
    const entries = buildRescueLogEntries(RUN_ID, records, AT);
    expect(entries.map(e => e.message)).toEqual([
      'Segment 1 recovered via windowed fallback — matched audio at 00:01–00:02.',
      'Segment 2 recovered via global fallback — matched audio at 00:03–00:04.',
      'Segment 3 recovered via sub-word concat fallback — matched audio at 00:05–00:06.',
    ]);
  });

  it('carries type "rescue", the given syncRunId, timestamp, and segmentIndex', () => {
    const record: RescuedSegmentRecord = {
      segmentIndex: 4,
      recoveredVia: 'global',
      recoveredRegion: { startSec: 10, endSec: 11 },
    };
    const [entry] = buildRescueLogEntries(RUN_ID, [record], AT);
    expect(entry!.type).toBe('rescue');
    expect(entry!.syncRunId).toBe(RUN_ID);
    expect(entry!.timestamp).toBe(AT);
    expect(entry!.segmentIndex).toBe(4);
  });

  it('folds alongside skip/no-asset entries without disturbing the MAX_LOG_ENTRIES prune', () => {
    const project = makeProject({ syncLog: makeEntries(MAX_LOG_ENTRIES) });
    const rescueEntries = buildRescueLogEntries(
      RUN_ID,
      [{ segmentIndex: 0, recoveredVia: 'global', recoveredRegion: { startSec: 1, endSec: 2 } }],
      AT,
    );
    const next = appendSyncLogEntries(project, rescueEntries);

    expect(next.syncLog).toHaveLength(MAX_LOG_ENTRIES);
    expect(next.syncLog![MAX_LOG_ENTRIES - 1]!.type).toBe('rescue');
  });
});

// ---------------------------------------------------------------------------
// Log-grouping feature (2026-08-03) — buildGroupedViolationEntry
// ---------------------------------------------------------------------------

function violation(overrides: Partial<ContractViolation> = {}): ContractViolation {
  return {
    contract: '5->6',
    rule: 'loud-fallback-boundary',
    severity: 'warning',
    message: 'The cut between segment 1 and segment 2 landed on audio that\'s still playing, not in a quiet gap.',
    fixHint: 'Check the cut on the timeline — nudge it toward the quieter moment nearby if it looks or sounds off.',
    detail: { segmentIndex: 0 },
    ...overrides,
  };
}

describe('buildContractViolationEntry', () => {
  it('builds a plain warning-type entry carrying the violation\'s message/severity/fixHint', () => {
    const v = violation();
    const entry = buildContractViolationEntry(RUN_ID, v, AT);
    expect(entry.type).toBe('warning');
    expect(entry.message).toBe(v.message);
    expect(entry.severity).toBe('warning');
    expect(entry.fixHint).toBe(v.fixHint);
    expect(entry.groupedItems).toBeUndefined();
  });
});

describe('buildGroupedViolationEntry', () => {
  it('returns undefined for an empty violations array', () => {
    expect(buildGroupedViolationEntry(RUN_ID, [], AT)).toBeUndefined();
  });

  it('a single violation takes the plain (non-grouped) entry path', () => {
    const v = violation({ message: 'lone violation message' });
    const entry = buildGroupedViolationEntry(RUN_ID, [v], AT);
    expect(entry).toBeDefined();
    expect(entry!.message).toBe('lone violation message');
    expect(entry!.groupedItems).toBeUndefined();
    expect(entry!.type).toBe('warning');
    expect(entry!.severity).toBe('warning');
    expect(entry!.fixHint).toBe(v.fixHint);
  });

  it('groups 3+ violations of the same rule into one entry, preserving every item', () => {
    const violations = [
      violation({ message: 'cut 1 is loud' }),
      violation({ message: 'cut 2 is loud' }),
      violation({ message: 'cut 3 is loud' }),
    ];
    const entry = buildGroupedViolationEntry(RUN_ID, violations, AT);

    expect(entry).toBeDefined();
    expect(entry!.syncRunId).toBe(RUN_ID);
    expect(entry!.timestamp).toBe(AT);
    expect(entry!.type).toBe('warning');
    expect(entry!.message).toBe("3 cuts landed on audio that's still playing.");
    expect(entry!.groupedItems).toHaveLength(3);
    expect(entry!.groupedItems!.map(i => i.message)).toEqual([
      'cut 1 is loud',
      'cut 2 is loud',
      'cut 3 is loud',
    ]);
  });

  it('uses the low-word-coverage summary phrasing, including the live ratio constant', () => {
    const violations = [
      violation({ rule: 'low-word-coverage', message: 'scene 1 low coverage' }),
      violation({ rule: 'low-word-coverage', message: 'scene 2 low coverage' }),
      violation({ rule: 'low-word-coverage', message: 'scene 3 low coverage' }),
      violation({ rule: 'low-word-coverage', message: 'scene 4 low coverage' }),
    ];
    const entry = buildGroupedViolationEntry(RUN_ID, violations, AT);
    const pct = Math.round(WORD_COVERAGE_MIN_RATIO * 100);
    expect(entry!.message).toBe(`4 scenes matched fewer than ${pct}% of their words.`);
  });

  it('falls back to a generic summary for a rule with no dedicated phrasing', () => {
    const violations = [
      violation({ rule: 'some-future-rule', message: 'a' }),
      violation({ rule: 'some-future-rule', message: 'b' }),
    ];
    const entry = buildGroupedViolationEntry(RUN_ID, violations, AT);
    expect(entry!.message).toContain('2');
    expect(entry!.message.toLowerCase()).toContain('expand');
  });

  it('severity is the MAX across the group (error beats warning)', () => {
    const violations = [
      violation({ severity: 'warning' }),
      violation({ severity: 'error' }),
      violation({ severity: 'warning' }),
    ];
    const entry = buildGroupedViolationEntry(RUN_ID, violations, AT);
    expect(entry!.severity).toBe('error');
  });

  it('uses the shared fixHint when every violation carries the identical string', () => {
    const violations = [
      violation({ fixHint: 'same hint' }),
      violation({ fixHint: 'same hint' }),
    ];
    const entry = buildGroupedViolationEntry(RUN_ID, violations, AT);
    expect(entry!.fixHint).toBe('same hint');
  });

  it('falls back to a generic fixHint when violations disagree', () => {
    const violations = [
      violation({ fixHint: 'hint A' }),
      violation({ fixHint: 'hint B' }),
    ];
    const entry = buildGroupedViolationEntry(RUN_ID, violations, AT);
    expect(entry!.fixHint).toMatch(/per-item/i);
    // Per-item fixHints still survive individually, even though the summary's own hint is generic.
    expect(entry!.groupedItems!.map(i => i.fixHint)).toEqual(['hint A', 'hint B']);
  });

  it('preserves each violation\'s own detail payload verbatim on groupedItems', () => {
    const violations = [
      violation({ detail: { segmentIndex: 0, foo: 'bar' } }),
      violation({ detail: { segmentIndex: 1, foo: 'baz' } }),
    ];
    const entry = buildGroupedViolationEntry(RUN_ID, violations, AT);
    expect(entry!.groupedItems!.map(i => i.detail)).toEqual([
      { segmentIndex: 0, foo: 'bar' },
      { segmentIndex: 1, foo: 'baz' },
    ]);
  });

  it('respects an explicit entryType override (boundary-quality\'s established "info" convention)', () => {
    const violations = [violation(), violation()];
    const entry = buildGroupedViolationEntry(RUN_ID, violations, AT, 'info');
    expect(entry!.type).toBe('info');

    // Same override applies on the single-violation fallback path.
    const single = buildGroupedViolationEntry(RUN_ID, [violation()], AT, 'info');
    expect(single!.type).toBe('info');
  });

  it('mints a fresh id and defaults type to "warning" when entryType is omitted', () => {
    const violations = [violation(), violation()];
    const entry = buildGroupedViolationEntry(RUN_ID, violations, AT);
    expect(entry!.type).toBe('warning');
    expect(entry!.id).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// Model P ruling §4.1(a) — the refused-lock surface.
// ---------------------------------------------------------------------------

describe('buildLockRefusedLogEntry', () => {
  it('names both segments in 1-based display numbers and reports the unassignable span', () => {
    const entry = buildLockRefusedLogEntry(RUN_ID, 4, 3, 2.5, AT);

    expect(entry.type).toBe('lock-refused');
    expect(entry.severity).toBe('warning');
    // 0-based index preserved for the UI to locate the row...
    expect(entry.segmentIndex).toBe(4);
    // ...while the human-readable message uses 1-based display numbers.
    expect(entry.message).toContain('Segment 5');
    expect(entry.message).toContain('segment 4');
    expect(entry.message).toContain('2.50s');
    expect(entry.fixHint).toContain('Unlock segment 4');
    expect(entry.syncRunId).toBe(RUN_ID);
    expect(entry.timestamp).toBe(AT);
  });

  it('is a warning, not an error — the project remains in a valid state', () => {
    // The distinction matters: nothing failed, an action was declined. An
    // 'error' severity here would misreport a healthy project as broken.
    expect(buildLockRefusedLogEntry(RUN_ID, 1, 0, 0.75, AT).severity).toBe('warning');
  });
});

// ===========================================================================
// WS1 Session J — rule-firing, engine and FA-fallback entries.
//
// What these pin is not prose but the two properties the live acceptance run
// depends on: (1) every rule firing produces an entry that NAMES its rule in a
// field, and (2) a run where forced alignment silently fell back is
// distinguishable, from the persisted log alone, from a run where it did not.
// Both were unfalsifiable before this session — the information existed only in
// a dev-build console.
// ===========================================================================

describe('buildSyncEngineEntry — which engine ran', () => {
  it('names forced alignment and its aligned-word count', () => {
    const entry = buildSyncEngineEntry(RUN_ID, 'forced-alignment', 3998, AT);
    expect(entry.type).toBe('info');
    expect(entry.message).toContain('forced alignment');
    expect(entry.message).toContain('3998');
    expect(entry.timestamp).toBe(AT);
    expect(entry.syncRunId).toBe(RUN_ID);
  });

  it('names Whisper on a run that used transcript timing', () => {
    const entry = buildSyncEngineEntry(RUN_ID, 'whisper', 3900, AT);
    expect(entry.message).toContain('Whisper');
    expect(entry.message).not.toContain('forced alignment');
  });

  it('produces DIFFERENT text for the two engines — the property that makes the run readable', () => {
    // If these ever collapsed to the same string the entry would be decorative:
    // the acceptance run reads this line to decide whether FA engaged at all.
    const fa = buildSyncEngineEntry(RUN_ID, 'forced-alignment', 10, AT).message;
    const whisper = buildSyncEngineEntry(RUN_ID, 'whisper', 10, AT).message;
    expect(fa).not.toBe(whisper);
  });
});

describe('buildFaFallbackEntry — fail-clean stops meaning fail-silent', () => {
  it('records the reason as a queryable field, not only inside the message', () => {
    const entry = buildFaFallbackEntry(RUN_ID, 'inference-error', 'model hash mismatch', AT);
    expect(entry.type).toBe('fa-fallback');
    expect(entry.reason).toBe('inference-error');
    expect(entry.owningRule).toBe('FA');
    expect(entry.errorMessage).toBe('model hash mismatch');
  });

  it('is a WARNING with a fix hint — the user asked for FA and did not get it', () => {
    const entry = buildFaFallbackEntry(RUN_ID, 'unsupported-language', 'zz', AT);
    expect(entry.severity).toBe('warning');
    expect(entry.fixHint).toBeTruthy();
  });

  it('gives every failure path its own distinguishable text', () => {
    const reasons = ['unsupported-language', 'empty-chunk-plan', 'zero-words', 'inference-error'] as const;
    const messages = reasons.map(r => buildFaFallbackEntry(RUN_ID, r, undefined, AT).message);
    expect(new Set(messages).size).toBe(reasons.length);
  });

  it('omits errorMessage entirely when there is no backend detail to carry', () => {
    expect(buildFaFallbackEntry(RUN_ID, 'zero-words', undefined, AT).errorMessage).toBeUndefined();
  });
});

describe('rule-correction entries — R.5 / R.10 / R.11 / R.12', () => {
  const segs = [
    { id: 'a', text: 'first scene', startTime: 0, duration: 10, transition: TransitionType.NONE, animation: AnimationType.NONE, order: 0 },
    { id: 'b', text: 'second scene', startTime: 10, duration: 10, transition: TransitionType.NONE, animation: AnimationType.NONE, order: 1 },
  ];

  it('R.5 reports an excised SPAN, and does not pretend a boundary moved', () => {
    const [entry] = buildUnscriptedRunLogEntries(
      RUN_ID,
      [{ tokenLo: 3, tokenHi: 9, startSec: 12.5, endSec: 15.75, qiSplit: 40 }],
      segs,
      AT,
    );
    expect(entry!.type).toBe('rule-correction');
    expect(entry!.owningRule).toBe('R.5');
    expect(entry!.ruleDetail?.spanStartSec).toBe(12.5);
    expect(entry!.ruleDetail?.spanEndSec).toBe(15.75);
    // R.5 acts before inference: there is no committed/corrected pair, and
    // inventing one would misdescribe what the rule does.
    expect(entry!.ruleDetail?.committedValue).toBeUndefined();
    expect(entry!.ruleDetail?.correctedValue).toBeUndefined();
    // Containment over the Model P partition: 12.5 falls in segment index 1.
    expect(entry!.segmentIndex).toBe(1);
  });

  it('R.5 logs a corpus-start span with NO segmentIndex rather than a guessed one', () => {
    // V6's first "Level one..." recitation is the real case: it precedes every
    // committed segment, so no segment contains it. Reporting index 0 would be
    // a fabricated attribution.
    const [entry] = buildUnscriptedRunLogEntries(
      RUN_ID,
      [{ tokenLo: 0, tokenHi: 2, startSec: 100, endSec: 103, qiSplit: 0 }],
      segs,
      AT,
    );
    expect(entry!.segmentIndex).toBeUndefined();
  });

  it('R.10 names the rule and the refused scene, carrying its confidence evidence', () => {
    const [entry] = buildUnspokenScriptLogEntries(
      RUN_ID,
      [{ segmentIndex: 12, segmentId: 'x', segmentTag: 'blue_monkey', maxWordConfidence: 4.07e-5, faWordCount: 3 }],
      AT,
    );
    expect(entry!.owningRule).toBe('R.10');
    // WS1 Session K: a REFUSED scene is not on the timeline, so it carries no
    // committed index at all — the script position moves into the message.
    expect(entry!.segmentIndex).toBeUndefined();
    expect(entry!.message).toContain('script position 13');
    expect(entry!.segmentTag).toBe('blue_monkey');
    expect(entry!.ruleDetail?.reason).toContain('4.070e-5');
  });

  it('R.11 carries both values, so a reader can check the correction', () => {
    const [entry] = buildSeamFitLogEntries(
      RUN_ID,
      [{
        segmentIndex: 191, segmentId: 'y', segmentTag: '192_scout_listening',
        chunkIndex: 100, chunkStartSec: 568.5, chunkEndSec: 571.36,
        fit: 1.5, fitDeviation: 1.5, edge: 'end',
        committedValue: 570.18, correctedValue: 571.07, delta: 0.89,
        spanMaxConfidence: 4.0732e-5,
      }],
      [{ id: 'y', tag: '192_scout_listening' } as unknown as VideoSegment],
      AT,
    );
    expect(entry!.owningRule).toBe('R.11');
    // The number comes from the COMMITTED array (index 0 -> "scene 1"), NOT
    // from the finding's own parse index 191. Ruling R-AO.
    expect(entry!.segmentIndex).toBe(0);
    expect(entry!.message).toContain('scene 1');
    expect(entry!.ruleDetail?.committedValue).toBe(570.18);
    expect(entry!.ruleDetail?.correctedValue).toBe(571.07);
    expect(entry!.message).toContain('570.18');
    expect(entry!.message).toContain('571.07');
  });

  it('R.12 carries the run it escaped and the interval it was allowed to land in', () => {
    const [entry] = buildRunPlacementLogEntries(
      RUN_ID,
      [{
        segmentIndex: 223, segmentId: 'z', segmentTag: '224_thirty_three',
        runIndex: 7, runStartSec: 663.9, runEndSec: 666.48,
        runTokenLo: 100, runTokenHi: 110,
        gapStartSec: 663.5, gapEndSec: 663.9,
        backingSilence: { startSec: 663.6, endSec: 663.97 },
        placement: 'silence-midpoint',
        committedValue: 664.33, correctedValue: 663.785, delta: -0.545,
      }],
      [{ id: 'z', tag: '224_thirty_three' } as unknown as VideoSegment],
      AT,
    );
    expect(entry!.owningRule).toBe('R.12');
    expect(entry!.ruleDetail?.correctedValue).toBe(663.785);
    // 3 decimals preserved: 663.785 is a real committed value and rounding it
    // to 663.79 would make the log disagree with the fixture.
    expect(entry!.message).toContain('663.785');
    expect(entry!.ruleDetail?.reason).toContain('silence-midpoint');
  });

  it('every builder returns [] for no findings — a clean run logs nothing extra', () => {
    // The additive property, asserted rather than asserted-in-prose: this is
    // what makes the change observationally inert on a corpus where no rule
    // fires.
    expect(buildUnscriptedRunLogEntries(RUN_ID, [], segs, AT)).toEqual([]);
    expect(buildUnspokenScriptLogEntries(RUN_ID, [], AT)).toEqual([]);
    expect(buildSeamFitLogEntries(RUN_ID, [], segs, AT)).toEqual([]);
    expect(buildRunPlacementLogEntries(RUN_ID, [], segs, AT)).toEqual([]);
    expect(buildUtterancePlacementLogEntries(RUN_ID, [], segs, AT)).toEqual([]);
  });

  it('every rule entry is INFO severity — a correction is the pipeline working', () => {
    const all = [
      ...buildUnscriptedRunLogEntries(RUN_ID, [{ tokenLo: 0, tokenHi: 1, startSec: 1, endSec: 2, qiSplit: 3 }], segs, AT),
      ...buildUnspokenScriptLogEntries(RUN_ID, [{ segmentIndex: 0, segmentId: 'x', maxWordConfidence: 1e-6, faWordCount: 1 }], AT),
      ...buildSeamFitLogEntries(RUN_ID, [{
        segmentIndex: 0, segmentId: 'y', chunkIndex: 1, chunkStartSec: 0, chunkEndSec: 1,
        fit: 1, fitDeviation: 1.5, edge: 'start', committedValue: 1, correctedValue: 2, delta: 1, spanMaxConfidence: 1e-6,
      }], segs, AT),
      ...buildRunPlacementLogEntries(RUN_ID, [{
        segmentIndex: 0, segmentId: 'z', runIndex: 0, runStartSec: 0, runEndSec: 1,
        runTokenLo: 0, runTokenHi: 1, gapStartSec: 0, gapEndSec: 1,
        placement: 'run-start-fallback', committedValue: 1, correctedValue: 0.5, delta: -0.5,
      }], segs, AT),
      ...buildUtterancePlacementLogEntries(RUN_ID, [{
        segmentIndex: 1, segmentId: 'w', carrierIndex: 0, carrierId: 'v',
        runIndex: 0, runStartSec: 0, runEndSec: 1, utteranceEndSec: 2,
        placement: 'utterance-end-fallback', committedValue: 1.5, correctedValue: 2, delta: 0.5,
      }], segs, AT),
    ];
    expect(all).toHaveLength(5);
    for (const e of all) {
      expect(e.type).toBe('rule-correction');
      expect(e.severity).toBe('info');
      expect(e.owningRule).toBeTruthy();
    }
  });

  it('the five rules are distinguishable by owningRule alone, with no message parsing', () => {
    // The reason owningRule is a field and not a message prefix: counting what
    // fired must be a filter, not a regex over prose.
    const names = [
      buildUnscriptedRunLogEntries(RUN_ID, [{ tokenLo: 0, tokenHi: 1, startSec: 1, endSec: 2, qiSplit: 3 }], segs, AT)[0]!.owningRule,
      buildUnspokenScriptLogEntries(RUN_ID, [{ segmentIndex: 0, segmentId: 'x', maxWordConfidence: 1e-6, faWordCount: 1 }], AT)[0]!.owningRule,
      buildSeamFitLogEntries(RUN_ID, [{
        segmentIndex: 0, segmentId: 'y', chunkIndex: 1, chunkStartSec: 0, chunkEndSec: 1,
        fit: 1, fitDeviation: 1.5, edge: 'start', committedValue: 1, correctedValue: 2, delta: 1, spanMaxConfidence: 1e-6,
      }], segs, AT)[0]!.owningRule,
      buildRunPlacementLogEntries(RUN_ID, [{
        segmentIndex: 0, segmentId: 'z', runIndex: 0, runStartSec: 0, runEndSec: 1,
        runTokenLo: 0, runTokenHi: 1, gapStartSec: 0, gapEndSec: 1,
        placement: 'run-start-fallback', committedValue: 1, correctedValue: 0.5, delta: -0.5,
      }], segs, AT)[0]!.owningRule,
      buildUtterancePlacementLogEntries(RUN_ID, [{
        segmentIndex: 1, segmentId: 'w', carrierIndex: 0, carrierId: 'v',
        runIndex: 0, runStartSec: 0, runEndSec: 1, utteranceEndSec: 2,
        placement: 'utterance-end-fallback', committedValue: 1.5, correctedValue: 2, delta: 0.5,
      }], segs, AT)[0]!.owningRule,
    ];
    expect(names).toEqual(['R.5', 'R.10', 'R.11', 'R.12', 'R.13']);
  });
});
