import { describe, it, expect } from 'vitest';
import type { SyncLogEntry, SyncRunSummary } from '../types';
import { makeSyncLogEntry } from './syncLog';
import { buildSyncLogUserView, type AttentionLine, type SyncLogHeadline } from './syncLogUserView';
import {
  buildSummaryBlocks,
  summaryHeader,
  summaryLine2,
  buildRunSections,
  BLOCK_DISMISSABLE,
} from './syncLogSummary';

const line = (kind: AttentionLine['kind'], tone: 'red' | 'amber', count: number, items = [{ text: 'x' }]): AttentionLine =>
  ({ kind, tone, count, summary: '', items, offerManageModels: kind === 'model-missing' });

describe('buildSummaryBlocks', () => {
  it('merges weak-match + too-dense into one "text-fit" block with summed count', () => {
    const { blocks } = buildSummaryBlocks([line('weak-match', 'amber', 4), line('too-dense', 'amber', 2)]);
    expect(blocks).toHaveLength(1);
    expect(blocks[0]!.id).toBe('text-fit');
    expect(blocks[0]!.title).toBe('6 scenes may have extra or missing text');
  });
  it('merges model-missing + language-pack-missing + sync-incomplete into "sync-stopped", red', () => {
    const { blocks } = buildSummaryBlocks([line('model-missing', 'red', 1), line('sync-incomplete', 'red', 1)]);
    expect(blocks.map(b => b.id)).toEqual(['sync-stopped']);
    expect(blocks[0]!.title).toBe("Sync couldn't finish");
    expect(blocks[0]!.tone).toBe('red');
    expect(blocks[0]!.offerManageModels).toBe(true);
  });
  it('uses the agreed titles', () => {
    const { blocks } = buildSummaryBlocks([
      line('unmatched-scene', 'red', 2), line('estimated-timings', 'amber', 1), line('no-media', 'amber', 5),
      line('offline-media', 'red', 3), line('script-audio-mismatch', 'red', 1),
    ]);
    const t = Object.fromEntries(blocks.map(b => [b.id, b.title]));
    expect(t['no-media']).toBe('5 scenes have no media');
    expect(t['offline-media']).toBe('3 media files are offline');
    expect(t['skipped']).toBe('2 scenes were not found in the voiceover');
    expect(t['estimated']).toBe('Some scenes have estimated timing');
    expect(t['mismatch']).toBe("Script and voiceover don't look like a pair");
    expect(blocks.find(b => b.id === 'offline-media')!.offerRelink).toBe(true);
  });
  it('singular titles', () => {
    const { blocks } = buildSummaryBlocks([line('no-media', 'amber', 1), line('offline-media', 'red', 1)]);
    expect(blocks.find(b => b.id === 'no-media')!.title).toBe('1 scene has no media');
    expect(blocks.find(b => b.id === 'offline-media')!.title).toBe('1 media file is offline');
  });
  it('no-media self-clears from live data: shrinks, then auto-resolves at zero', () => {
    const base = [line('no-media', 'amber', 5)];
    const some = buildSummaryBlocks(base, { unassigned: [{ id: 'a', number: 84 }, { id: 'b', number: 121 }] });
    expect(some.blocks[0]!.title).toBe('2 scenes have no media');
    expect(some.blocks[0]!.items.map(i => i.segmentId)).toEqual(['a', 'b']);
    expect(some.blocks[0]!.items.map(i => i.text)).toEqual(['Scene 84', 'Scene 121']);
    const none = buildSummaryBlocks(base, { unassigned: [] });
    expect(none.blocks).toHaveLength(0);
    expect(none.autoResolved).toEqual(['no-media']);
  });
  it('only no-media and offline... sync-stopped and mismatch are not dismissable', () => {
    expect(BLOCK_DISMISSABLE['sync-stopped']).toBe(false);
    expect(BLOCK_DISMISSABLE['mismatch']).toBe(false);
    expect(BLOCK_DISMISSABLE['no-media']).toBe(true);
    expect(BLOCK_DISMISSABLE['skipped']).toBe(true);
  });
});

describe('summaryHeader / summaryLine2', () => {
  const blocks = (tones: Array<'red' | 'amber'>) =>
    tones.map((tone, i) => ({ id: `b${i}`, tone } as never));
  it('green + smooth copy at zero', () => {
    expect(summaryHeader([])).toEqual({ tone: 'green', text: 'Everything is running smoothly' });
  });
  it('amber when only amber blocks; plural/singular text', () => {
    expect(summaryHeader(blocks(['amber']))).toEqual({ tone: 'amber', text: '1 item needs your attention' });
    expect(summaryHeader(blocks(['amber', 'amber']))).toEqual({ tone: 'amber', text: '2 items need your attention' });
  });
  it('red when any red block', () => {
    expect(summaryHeader(blocks(['amber', 'red'])).tone).toBe('red');
  });
  const h = (over: Partial<SyncLogHeadline>): SyncLogHeadline =>
    ({ hasRun: true, engine: 'unknown', placeholders: 0, estimated: 0, ...over });
  it('line 2: matched/total plus placeholders only when > 0', () => {
    expect(summaryLine2(h({ matched: 221, total: 224, placeholders: 3 }))).toBe('221/224 scenes matched · 3 placeholders');
    expect(summaryLine2(h({ matched: 224, total: 224 }))).toBe('224/224 scenes matched');
    expect(summaryLine2(h({ matched: 221, total: 224, placeholders: 1 }))).toBe('221/224 scenes matched · 1 placeholder');
  });
  it('line 2 hidden before first run', () => {
    expect(summaryLine2(h({ hasRun: false }))).toBeUndefined();
  });
});

describe('buildRunSections — one section per sync, Actions vs Info', () => {
  const e = (run: string, type: SyncLogEntry['type'], t: number, extra: Partial<SyncLogEntry> = {}): SyncLogEntry =>
    ({ ...makeSyncLogEntry(run, type, `${type} msg`, undefined, t), ...extra });
  const sum = (run: string, t: number): SyncRunSummary =>
    ({ syncRunId: run, timestamp: t, totalSegments: 10, coveredSegments: 9, skippedSegments: 1, aborted: false });
  const log = [
    e('r1', 'skip', 100), e('r1', 'rule-correction', 101),
    e('r2', 'skip', 200), e('r2', 'no-asset', 201), e('r2', 'rule-correction', 202),
  ];
  const summaries = [sum('r1', 100), sum('r2', 200)];

  it('newest sync first, each with its own lists', () => {
    const s = buildRunSections(log, summaries, { dismissed: new Set(), autoResolved: new Set() });
    expect(s.map(x => x.key)).toEqual(['r2', 'r1']);
    expect(s[1]!.actions.map(a => a.entry.type)).toEqual(['skip']);
    expect(s[1]!.info.map(i => i.type)).toEqual(['rule-correction']);
  });
  it('latest sync lists only dismissed/resolved actions, with status; open ones stay in the main view', () => {
    const open = buildRunSections(log, summaries, { dismissed: new Set(), autoResolved: new Set() });
    expect(open[0]!.actions).toHaveLength(0);
    const s = buildRunSections(log, summaries, { dismissed: new Set(['skipped']), autoResolved: new Set(['no-media']) });
    const byType = Object.fromEntries(s[0]!.actions.map(a => [a.entry.type, a.status]));
    expect(byType).toEqual({ skip: 'dismissed', 'no-asset': 'resolved' });
  });
  it('media-import and media-match go to their own "Media activity" section', () => {
    const s = buildRunSections([...log, e('imp-1', 'media-import', 300)], summaries, { dismissed: new Set(), autoResolved: new Set() });
    const media = s.find(x => x.key === 'media');
    expect(media?.title).toBe('Media activity');
    expect(media?.info).toHaveLength(1);
  });
  it('section title carries time and matched count', () => {
    const s = buildRunSections(log, summaries, { dismissed: new Set(), autoResolved: new Set() });
    expect(s[0]!.title).toMatch(/^Sync · \d{2}:\d{2} · 9\/10 scenes matched$/);
  });
});

describe('integration with the real view model', () => {
  it('buildSyncLogUserView output feeds buildSummaryBlocks', () => {
    const view = buildSyncLogUserView([], []);
    expect(buildSummaryBlocks(view.attention).blocks).toEqual([]);
  });
});
