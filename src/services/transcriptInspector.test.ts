import { describe, it, expect } from 'vitest';
import type { TranscriptToken } from '../types';
import type { SilenceInterval } from './silenceDetector';
import type { TokenDrop } from './whisperService';
import {
  buildTranscriptInspectorRows,
  computeSmearAggregates,
  summarizeDropsByReason,
  tokenRowsToCsv,
  buildTranscriptInspectorRun,
  compareTranscriptInspectorRuns,
} from './transcriptInspector';

// Real seg-96->97 fixture (V6 447-segment project), same numbers cited in
// docs/sync-pipeline-v2-plan.md Part C and committed at src/services/syncTiming.test.ts
// ("seg 96->97" test): tokens "look"/"A"/"predator"/"'s"/"presence", silence
// [289.380, 289.960]. Per Part F, this module's tests use real token data as
// tripwires, not synthetic fixtures.
const SEG96_TOKENS: TranscriptToken[] = [
  { text: 'look', startSec: 288.750, endSec: 289.090 },
  { text: 'A', startSec: 289.200, endSec: 289.260 },
  { text: 'predator', startSec: 289.260, endSec: 289.800 },
  { text: "'s", startSec: 289.800, endSec: 289.930 },
  { text: 'presence', startSec: 289.930, endSec: 290.470 },
];
const SEG96_SILENCES: SilenceInterval[] = [{ startSec: 289.380, endSec: 289.960 }];

describe('buildTranscriptInspectorRows', () => {
  it('flags "predator" with negative smear — the segment-96 pathology (real seg-96->97 fixture)', () => {
    const rows = buildTranscriptInspectorRows(SEG96_TOKENS, SEG96_SILENCES);

    const predator = rows.find(r => r.text === 'predator')!;
    expect(predator.nearestPrecedingSilenceEndSec).toBeCloseTo(289.960, 6);
    expect(predator.smearSec).toBeCloseTo(289.260 - 289.960, 6);
    expect(predator.smearSec!).toBeLessThan(0);
  });

  it('does not attribute the silence to "A" — its declared span ends before the silence starts', () => {
    const rows = buildTranscriptInspectorRows(SEG96_TOKENS, SEG96_SILENCES);
    const tokenA = rows.find(r => r.text === 'A')!;
    // 'A' ends at 289.260, before the silence starts at 289.380 — no silence
    // qualifies as "nearest preceding" for it under this fixture (no earlier
    // silence supplied), so it must fall back to null rather than borrowing
    // the seg-96 silence out of position.
    expect(tokenA.nearestPrecedingSilenceEndSec).toBeNull();
    expect(tokenA.smearSec).toBeNull();
  });

  it('computes gapToPrevTokenSec against the immediately preceding token, null on the first token', () => {
    const rows = buildTranscriptInspectorRows(SEG96_TOKENS, SEG96_SILENCES);
    expect(rows[0]!.gapToPrevTokenSec).toBeNull();
    // 'A' starts at 289.200, 'look' ends at 289.090 -> gap 0.110
    expect(rows[1]!.gapToPrevTokenSec).toBeCloseTo(0.110, 6);
    // 'predator' starts exactly where 'A' ends -> zero gap
    expect(rows[2]!.gapToPrevTokenSec).toBeCloseTo(0, 6);
  });

  it('durationSec is endSec - startSec for every row', () => {
    const rows = buildTranscriptInspectorRows(SEG96_TOKENS, SEG96_SILENCES);
    for (const r of rows) {
      expect(r.durationSec).toBeCloseTo(r.endSec - r.startSec, 6);
    }
  });

  it('is order-independent with respect to unsorted silence input', () => {
    const shuffled = [...SEG96_SILENCES].reverse();
    const rows = buildTranscriptInspectorRows(SEG96_TOKENS, shuffled);
    const predator = rows.find(r => r.text === 'predator')!;
    expect(predator.smearSec).toBeCloseTo(289.260 - 289.960, 6);
  });
});

describe('computeSmearAggregates', () => {
  it('aggregates only over pause-following (defined-smear) tokens and counts negatives', () => {
    const rows = buildTranscriptInspectorRows(SEG96_TOKENS, SEG96_SILENCES);
    const agg = computeSmearAggregates(rows);

    // 'predator', "'s", 'presence' all pick up the same silence; 'look' and 'A' do not.
    expect(agg.pauseFollowingTokenCount).toBe(3);
    expect(agg.negativeSmearCount).toBe(3);
    expect(agg.negativeSmearFraction).toBeCloseTo(1, 6);
    expect(agg.medianSmearSec).not.toBeNull();
    expect(agg.medianSmearSec!).toBeLessThan(0);
  });

  it('returns nulls when no token has a preceding silence', () => {
    const rows = buildTranscriptInspectorRows(SEG96_TOKENS, []);
    const agg = computeSmearAggregates(rows);
    expect(agg.pauseFollowingTokenCount).toBe(0);
    expect(agg.medianSmearSec).toBeNull();
    expect(agg.p95SmearSec).toBeNull();
    expect(agg.negativeSmearFraction).toBeNull();
  });
});

describe('summarizeDropsByReason', () => {
  it('buckets every TokenDrop reason, including zero-count reasons', () => {
    const drops: TokenDrop[] = [
      { index: 0, reason: 'non-finite', startSec: NaN, endSec: NaN, text: 'x' },
      { index: 1, reason: 'non-finite', startSec: NaN, endSec: NaN, text: 'y' },
      { index: 2, reason: 'empty-text', startSec: 1, endSec: 2, text: '' },
    ];
    const breakdown = summarizeDropsByReason(drops);
    expect(breakdown['non-finite']).toBe(2);
    expect(breakdown['empty-text']).toBe(1);
    expect(breakdown['negative-start']).toBe(0);
    expect(breakdown['inverted-or-zero-duration']).toBe(0);
    expect(breakdown['past-audio-end']).toBe(0);
  });
});

describe('tokenRowsToCsv', () => {
  it('emits a header plus one row per token, quoting text with commas', () => {
    const rows = buildTranscriptInspectorRows(SEG96_TOKENS, SEG96_SILENCES);
    const csv = tokenRowsToCsv(rows);
    const lines = csv.split('\n');
    expect(lines[0]).toBe(
      'index,text,startSec,endSec,durationSec,gapToPrevTokenSec,nearestPrecedingSilenceEndSec,smearSec',
    );
    expect(lines.length).toBe(rows.length + 1);

    const commaCsv = tokenRowsToCsv([
      { index: 0, text: 'a, b', startSec: 0, endSec: 1, durationSec: 1, gapToPrevTokenSec: null, nearestPrecedingSilenceEndSec: null, smearSec: null },
    ]);
    expect(commaCsv).toContain('"a, b"');
  });
});

describe('buildTranscriptInspectorRun / compareTranscriptInspectorRuns', () => {
  it('compares two runs on the same audio, keyed by word+occurrence, never by index', () => {
    const runA = buildTranscriptInspectorRun({
      label: 'base.en',
      tokens: SEG96_TOKENS,
      drops: [],
      totalTokens: SEG96_TOKENS.length,
      silences: SEG96_SILENCES,
      audioDurationSec: 1421.3,
    });

    // Simulate a re-run with one FEWER token up front (as a model swap would
    // shift every later index) — 'predator' must still match by word, not index.
    const shiftedTokens: TranscriptToken[] = [
      { text: 'A', startSec: 289.150, endSec: 289.210 },
      { text: 'predator', startSec: 289.210, endSec: 289.750 },
      { text: "'s", startSec: 289.750, endSec: 289.900 },
      { text: 'presence', startSec: 289.900, endSec: 290.440 },
    ];
    const runB = buildTranscriptInspectorRun({
      label: 'turbo+dtw',
      tokens: shiftedTokens,
      drops: [],
      totalTokens: shiftedTokens.length,
      silences: SEG96_SILENCES,
      audioDurationSec: 1421.3,
    });

    const comparison = compareTranscriptInspectorRuns(runA, runB);
    const predatorRow = comparison.find(r => r.textA === 'predator' || r.textB === 'predator')!;
    expect(predatorRow.textA).toBe('predator');
    expect(predatorRow.textB).toBe('predator');
    expect(predatorRow.deltaSmearSec).not.toBeNull();

    // 'look' only exists in run A.
    const lookRow = comparison.find(r => r.textA === 'look')!;
    expect(lookRow.textB).toBeNull();
    expect(lookRow.deltaSmearSec).toBeNull();
  });

  it('disambiguates repeated words by occurrence rather than colliding on one key', () => {
    const repeated: TranscriptToken[] = [
      { text: 'the', startSec: 0, endSec: 0.2 },
      { text: 'cat', startSec: 0.2, endSec: 0.5 },
      { text: 'the', startSec: 0.5, endSec: 0.7 },
      { text: 'dog', startSec: 0.7, endSec: 1.0 },
    ];
    const run = buildTranscriptInspectorRun({
      label: 'run',
      tokens: repeated,
      drops: [],
      totalTokens: repeated.length,
      silences: [],
      audioDurationSec: 2,
    });
    const comparison = compareTranscriptInspectorRuns(run, run);
    const theKeys = comparison.filter(r => r.textA === 'the');
    expect(theKeys.length).toBe(2);
    expect(new Set(theKeys.map(r => r.key)).size).toBe(2);
  });
});
