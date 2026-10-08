import { describe, it, expect } from 'vitest';
import type { SyncLogEntry, SyncLogEntryType, SyncLogFindingKind, SyncRunSummary } from '../types';
import { makeSyncLogEntry } from './syncLog';
import {
  buildSyncGroups,
  classifyEntry,
  timeAgo,
  warningKey,
  type LiveState,
} from './syncLogGroups';

const AT = 1_700_000_000_000;
let n = 0;
const entry = (
  run: string, type: SyncLogEntryType, over: Partial<SyncLogEntry> = {}, t = AT,
): SyncLogEntry => ({ ...makeSyncLogEntry(run, type, `${type} message`, undefined, t), id: `e${n++}`, ...over });
const finding = (run: string, kind: SyncLogFindingKind, over: Partial<SyncLogEntry> = {}, type: SyncLogEntryType = 'warning', count?: number): SyncLogEntry =>
  entry(run, type, { finding: { kind, count }, ...over });
const summary = (run: string, ts: number, over: Partial<SyncRunSummary> = {}): SyncRunSummary =>
  ({ syncRunId: run, timestamp: ts, totalSegments: 10, coveredSegments: 9, skippedSegments: 1, aborted: false, ...over });
const emptyLive: LiveState = { segments: [], assets: [], spots: [] };
const NONE = new Set<string>();

// ---------------------------------------------------------------------------
// 1. kind -> group mapping table: every kind named in the brief.
// ---------------------------------------------------------------------------
describe('classifyEntry — kind to group mapping', () => {
  const R = 'r1';
  const table: Array<[string, SyncLogEntry, { card: string; sub?: string }]> = [
    // ACTIONS
    ['no-asset', entry(R, 'no-asset'), { card: 'action', sub: 'missing-media' }],
    ['skip', entry(R, 'skip'), { card: 'action', sub: 'skipped' }],
    ['wpm', finding(R, 'wpm'), { card: 'action', sub: 'mismatch' }],
    ['local-coverage', finding(R, 'local-coverage'), { card: 'action', sub: 'mismatch' }],
    ['fa-paused hopeless coverage', entry(R, 'fa-paused', { reason: 'hopeless-local-coverage' }), { card: 'action', sub: 'mismatch' }],
    ['abort', entry(R, 'abort'), { card: 'action', sub: 'sync-stopped' }],
    ['whisper-model-failure', entry(R, 'whisper-model-failure'), { card: 'action', sub: 'sync-stopped' }],
    ['unsupported-language', entry(R, 'unsupported-language'), { card: 'action', sub: 'sync-stopped' }],
    ['fa-paused other reason', entry(R, 'fa-paused', { reason: 'inference-failed' }), { card: 'action', sub: 'sync-stopped' }],
    ['spot-segment-unmatched', finding(R, 'spot-segment-unmatched'), { card: 'action', sub: 'layer2-unbound' }],
    ['spot-clip-unmatched', finding(R, 'spot-clip-unmatched'), { card: 'action', sub: 'layer2-unbound' }],
    ['spot-clip-missing', finding(R, 'spot-clip-missing'), { card: 'action', sub: 'layer2-unbound' }],
    // WARNINGS
    ['ctc-infeasible', finding(R, 'ctc-infeasible'), { card: 'warning', sub: 'estimated' }],
    ['fa-victim-retimed', finding(R, 'fa-victim-retimed'), { card: 'warning', sub: 'estimated' }],
    ['character-fallback', finding(R, 'character-fallback'), { card: 'warning', sub: 'estimated' }],
    ['tail-unmatched', finding(R, 'tail-unmatched'), { card: 'warning', sub: 'estimated' }],
    ['numeric-unmatched', finding(R, 'numeric-unmatched'), { card: 'warning', sub: 'estimated' }],
    ['whisper after pause', entry(R, 'fa-gate-closed', { reason: 'inference-failed' }), { card: 'warning', sub: 'estimated' }],
    ['weak-match', finding(R, 'weak-match'), { card: 'warning', sub: 'text-fit' }],
    ['scene-density', finding(R, 'scene-density'), { card: 'warning', sub: 'text-fit' }],
    ['spot-past-voiceover', finding(R, 'spot-past-voiceover'), { card: 'warning', sub: 'layer2-adjusted' }],
    ['spot-overlap', finding(R, 'spot-overlap'), { card: 'warning', sub: 'layer2-adjusted' }],
    ['lock-refused', entry(R, 'lock-refused'), { card: 'warning', sub: 'edits-dropped' }],
    ['lock-not-restored', entry(R, 'lock-not-restored'), { card: 'warning', sub: 'edits-dropped' }],
    ['bundle-import-failed', finding(R, 'bundle-import-failed'), { card: 'warning', sub: 'import-failures' }],
    ['media-import with failures', entry('imp', 'media-import', { severity: 'warning' }), { card: 'warning', sub: 'import-failures' }],
    ['silence-error', entry(R, 'silence-error'), { card: 'warning', sub: 'quality-notes' }],
    ['fa-preflight not ready', entry(R, 'fa-preflight', { severity: 'warning' }), { card: 'warning', sub: 'quality-notes' }],
    ['fa-gate-closed (high-precision off)', entry(R, 'fa-gate-closed'), { card: 'warning', sub: 'quality-notes' }],
    // INFO
    ['media-import clean', entry('imp', 'media-import', { severity: 'info' }), { card: 'info', sub: 'imports' }],
    ['media-match', entry('imp', 'media-match'), { card: 'info', sub: 'imports' }],
    ['rule-correction', entry(R, 'rule-correction'), { card: 'info', sub: 'adjustments' }],
    ['freeze-frame', finding(R, 'freeze-frame'), { card: 'info', sub: 'adjustments' }],
    ['rescue', entry(R, 'rescue'), { card: 'info', sub: 'recoveries' }],
    ['lock-span-overflow', entry(R, 'lock-span-overflow'), { card: 'info', sub: 'lock-overflow' }],
    ['boundary-delta', finding(R, 'boundary-delta'), { card: 'info', sub: 'boundary-deltas' }],
    ['asset-replaced', finding(R, 'asset-replaced'), { card: 'info', sub: 'assets' }],
    ['asset-unverified', finding(R, 'asset-unverified'), { card: 'info', sub: 'assets' }],
    ['asset-missing record', finding(R, 'asset-missing'), { card: 'info', sub: 'assets' }],
    ['asset-corrupt record', finding(R, 'asset-corrupt'), { card: 'info', sub: 'assets' }],
    ['asset-relinked record', finding(R, 'asset-relinked'), { card: 'info', sub: 'assets' }],
    // HIDDEN
    ['fa-preflight OK', entry(R, 'fa-preflight', { severity: 'info' }), { card: 'hide' }],
    ['malformed-token', entry(R, 'malformed-token'), { card: 'hide' }],
    ['lock-preserved-adjustment', entry(R, 'lock-preserved-adjustment'), { card: 'hide' }],
  ];
  it.each(table)('%s', (_name, e, want) => {
    const c = classifyEntry(e);
    expect(c.card).toBe(want.card);
    if (want.sub) expect(c.sub).toBe(want.sub);
  });
});

// ---------------------------------------------------------------------------
// 2. Headline counts ONLY Actions.
// ---------------------------------------------------------------------------
describe('headline', () => {
  const log = [finding('r1', 'weak-match'), finding('r1', 'ctc-infeasible'), entry('r1', 'rule-correction')];
  it('Info and Warnings never affect it: all clear', () => {
    const v = buildSyncGroups({ log, summaries: [summary('r1', AT)], live: emptyLive, dismissed: NONE });
    expect(v.headline).toEqual({ tone: 'green', text: 'All clear — exports unblocked', count: 0 });
  });
  it('N = unresolved action sub-groups; amber when none are red', () => {
    const live: LiveState = { ...emptyLive, segments: [{ id: 's1' }, { id: 's2', assetId: 'a' }], assets: [{ id: 'a', name: 'a', url: 'blob:a' }] };
    const v = buildSyncGroups({ log, summaries: [summary('r1', AT)], live, dismissed: NONE });
    expect(v.headline).toEqual({ tone: 'amber', text: '1 item needs your attention', count: 1 });
  });
  it('red when any action item is red; plural wording', () => {
    const live: LiveState = {
      segments: [{ id: 's1' }, { id: 's2', assetId: 'off' }],
      assets: [{ id: 'off', name: 'off.mp4', url: '', unresolved: true }],
      spots: [],
    };
    const v = buildSyncGroups({ log, summaries: [summary('r1', AT)], live, dismissed: NONE });
    expect(v.headline).toEqual({ tone: 'red', text: '2 items need your attention', count: 2 });
  });
});

// ---------------------------------------------------------------------------
// 3. Live self-clear + corrupt -> Actions + Layer 2 live.
// ---------------------------------------------------------------------------
describe('live actions (newest sync) self-clear', () => {
  const log = [entry('r1', 'no-asset', { message: 'No asset available for 2 of 3 segments: 1, 3.' })];
  const sums = [summary('r1', AT)];
  const sub = (v: ReturnType<typeof buildSyncGroups>, id: string) => v.syncs[0]!.actions.find(a => a.id === id);

  it('missing media follows live state and clears to zero as media is added', () => {
    const live = (ids: Array<string | undefined>): LiveState => ({
      segments: ids.map((assetId, i) => ({ id: `s${i}`, assetId })),
      assets: [{ id: 'a', name: 'a', url: 'blob:a' }],
      spots: [],
    });
    const two = buildSyncGroups({ log, summaries: sums, live: live([undefined, 'a', undefined]), dismissed: NONE });
    expect(sub(two, 'missing-media')?.items.map(i => i.text)).toEqual(['Scene 1', 'Scene 3']);
    expect(sub(two, 'missing-media')?.items.map(i => i.segmentId)).toEqual(['s0', 's2']);
    const one = buildSyncGroups({ log, summaries: sums, live: live(['a', 'a', undefined]), dismissed: NONE });
    expect(sub(one, 'missing-media')?.items).toHaveLength(1);
    const zero = buildSyncGroups({ log, summaries: sums, live: live(['a', 'a', 'a']), dismissed: NONE });
    expect(sub(zero, 'missing-media')).toBeUndefined();
    expect(zero.headline.count).toBe(0);
  });

  it('offline media is live; items name the file and jump to a scene using it', () => {
    const live: LiveState = {
      segments: [{ id: 's0', assetId: 'off' }],
      assets: [{ id: 'off', name: 'broll.mp4', url: '', unresolved: true }],
      spots: [],
    };
    const v = buildSyncGroups({ log: [], summaries: [summary('r1', AT)], live, dismissed: NONE });
    const g = sub(v, 'offline-media')!;
    expect(g.items).toEqual([{ key: 'asset:off', text: 'broll.mp4', segmentId: 's0' }]);
    expect(g.tone).toBe('red');
    expect(g.cta).toBe('relink');
    const cleared = buildSyncGroups({ log: [], summaries: [summary('r1', AT)], live: { ...live, assets: [{ id: 'off', name: 'broll.mp4', url: 'blob:x' }] }, dismissed: NONE });
    expect(sub(cleared, 'offline-media')).toBeUndefined();
  });

  it('corrupt assets land in Actions (Damaged media), live, red', () => {
    const live: LiveState = {
      segments: [{ id: 's0', assetId: 'bad' }],
      assets: [{ id: 'bad', name: 'bad.png', url: 'blob:b', corrupt: 'image-decode' }],
      spots: [],
    };
    const v = buildSyncGroups({ log: [], summaries: [summary('r1', AT)], live, dismissed: NONE });
    const g = sub(v, 'damaged-media')!;
    expect(g.items.map(i => i.text)).toEqual(['bad.png']);
    expect(g.tone).toBe('red');
  });

  it('Layer 2 unbound is live: unbound clip, missing clip file, lost anchor scene — and clears when fixed', () => {
    const live: LiveState = {
      segments: [{ id: 's0', assetId: 'a' }],
      assets: [{ id: 'a', name: 'a', url: 'blob:a' }, { id: 'gone', name: 'gone.mp4', url: '', unresolved: true }],
      spots: [
        { id: 'p1', clipName: 'avatar.mp4', anchorSegmentId: 's0' },
        { id: 'p2', assetId: 'gone', anchorSegmentId: 's0' },
        { id: 'p3', assetId: 'a', anchorSegmentId: 'deleted', needsReview: true },
        { id: 'p4', assetId: 'a', anchorSegmentId: 's0' },
      ],
    };
    const v = buildSyncGroups({ log: [], summaries: [summary('r1', AT)], live, dismissed: NONE });
    expect(sub(v, 'layer2-unbound')?.items.map(i => i.key)).toEqual(['spot:p1', 'spot:p2', 'spot:p3']);
    const fixed = buildSyncGroups({ log: [], summaries: [summary('r1', AT)], live: { ...live, spots: [live.spots[3]!] }, dismissed: NONE });
    expect(sub(fixed, 'layer2-unbound')).toBeUndefined();
  });

  it('skipped / mismatch / stopped are frozen run records, not live', () => {
    const l = [entry('r1', 'skip', { segmentIndex: 2, segmentText: 'gone' }), finding('r1', 'wpm'), entry('r1', 'abort')];
    const v = buildSyncGroups({ log: l, summaries: [summary('r1', AT)], live: emptyLive, dismissed: NONE });
    expect(v.syncs[0]!.actions.map(a => a.id)).toEqual(['skipped', 'mismatch', 'sync-stopped']);
  });
});

// ---------------------------------------------------------------------------
// 4. Syncs: newest first, numbering, frozen older, cap 5.
// ---------------------------------------------------------------------------
describe('sync macro groups', () => {
  const mk = (count: number) => {
    const sums = Array.from({ length: count }, (_, i) => summary(`r${i + 1}`, AT + i * 60_000));
    const log = sums.map(s => entry(s.syncRunId, 'skip', { segmentIndex: 0 }, s.timestamp));
    return { sums, log };
  };

  it('newest first, numbered chronologically; only the newest is live', () => {
    const { sums, log } = mk(3);
    const v = buildSyncGroups({ log, summaries: sums, live: emptyLive, dismissed: NONE });
    expect(v.syncs.map(s => s.number)).toEqual([3, 2, 1]);
    expect(v.syncs.map(s => s.live)).toEqual([true, false, false]);
  });

  it('older syncs are frozen: live media state never rewrites them', () => {
    const l = [entry('r1', 'no-asset', {}, AT), entry('r2', 'skip', {}, AT + 60_000)];
    const live: LiveState = { segments: [{ id: 's0', assetId: 'a' }], assets: [{ id: 'a', name: 'a', url: 'blob:a' }], spots: [] };
    const v = buildSyncGroups({ log: l, summaries: [summary('r1', AT), summary('r2', AT + 60_000)], live, dismissed: NONE });
    const older = v.syncs[1]!;
    expect(older.live).toBe(false);
    expect(older.actions.map(a => a.id)).toEqual(['missing-media']); // its frozen record survives
    expect(v.syncs[0]!.actions.map(a => a.id)).toEqual(['skipped']); // newest: live media is clear
  });

  it('shows 5, the rest under "earlier"', () => {
    const { sums, log } = mk(7);
    const v = buildSyncGroups({ log, summaries: sums, live: emptyLive, dismissed: NONE });
    expect(v.syncs).toHaveLength(5);
    expect(v.earlier.map(s => s.number)).toEqual([2, 1]);
  });

  it('health dot: Actions red, else Warnings amber, else green', () => {
    const l = [
      entry('r1', 'skip', {}, AT),
      finding('r2', 'weak-match', {}, 'warning', undefined),
      entry('r2', 'rule-correction'),
      entry('r3', 'rule-correction'),
    ].map((e, i) => (i >= 1 ? { ...e, timestamp: AT + (i + 1) * 60_000 } : e));
    const v = buildSyncGroups({
      log: l,
      summaries: [summary('r1', AT), summary('r2', AT + 120_000), summary('r3', AT + 180_000)],
      live: emptyLive, dismissed: NONE,
    });
    const byRun = Object.fromEntries(v.syncs.map(s => [s.runId, s.health]));
    expect(byRun).toEqual({ r1: 'red', r2: 'amber', r3: 'green' });
  });

  it('zero-count display: no number at 0; chip text only when there is something', () => {
    const v = buildSyncGroups({ log: [entry('r1', 'rule-correction')], summaries: [summary('r1', AT)], live: emptyLive, dismissed: NONE });
    const s = v.syncs[0]!;
    expect(s.actionsChip).toBeUndefined();
    expect(s.warningsChip).toBeUndefined();
    const w = buildSyncGroups({ log: [finding('r1', 'weak-match')], summaries: [summary('r1', AT)], live: emptyLive, dismissed: NONE });
    expect(w.syncs[0]!.warningsChip).toBe(1);
  });

  it('header facts: engine, run summary line, cost', () => {
    const l = [
      finding('r1', 'engine-forced-alignment', {}, 'info'),
      finding('r1', 'run-cost', {}, 'info', 120),
      finding('r1', 'fa-victim-retimed', { finding: { kind: 'fa-victim-retimed', count: 2, segmentIds: ['a', 'b'] } }),
    ];
    const v = buildSyncGroups({ log: l, summaries: [summary('r1', AT, { totalSegments: 224, coveredSegments: 221, skippedSegments: 3 })], live: emptyLive, dismissed: NONE });
    const s = v.syncs[0]!;
    expect(s.engine).toBe('Forced alignment');
    expect(s.info.summaryLine).toBe('Forced alignment · 221/224 matched · 3 skipped · 2 estimated · $0.02');
    expect(s.cost).toBe('$0.02');
  });

  it('engine/no-run noise is hidden: unknown engine adds no "Engine not recorded"', () => {
    const v = buildSyncGroups({ log: [entry('r1', 'rule-correction')], summaries: [summary('r1', AT)], live: emptyLive, dismissed: NONE });
    expect(JSON.stringify(v)).not.toContain('Engine not recorded');
  });
});

// ---------------------------------------------------------------------------
// 5. Warnings: dismissal persistence + reset on next sync; import-failure promotion.
// ---------------------------------------------------------------------------
describe('warnings dismissal', () => {
  const w1 = finding('r1', 'weak-match');
  it('dismissed items drop out of the group and the chip; the key is stable per run', () => {
    const base = buildSyncGroups({ log: [w1], summaries: [summary('r1', AT)], live: emptyLive, dismissed: NONE });
    const item = base.syncs[0]!.warnings[0]!.items[0]!;
    expect(item.key).toBe(w1.id);
    const key = warningKey('text-fit', item.key, 'r1');
    const after = buildSyncGroups({ log: [w1], summaries: [summary('r1', AT)], live: emptyLive, dismissed: new Set([key]) });
    expect(after.syncs[0]!.warnings).toHaveLength(0);
    expect(after.syncs[0]!.warningsChip).toBeUndefined();
  });

  it('resets on the next sync: the same problem in a new run shows again', () => {
    const key = warningKey('text-fit', w1.id, 'r1');
    const w2 = finding('r2', 'weak-match');
    const v = buildSyncGroups({
      log: [w1, w2],
      summaries: [summary('r1', AT), summary('r2', AT + 60_000)],
      live: emptyLive, dismissed: new Set([key]),
    });
    expect(v.syncs[0]!.runId).toBe('r2');
    expect(v.syncs[0]!.warnings[0]!.items).toHaveLength(1);
  });

  it('older syncs are read-only: their warnings are listed but not dismissible', () => {
    const v = buildSyncGroups({
      log: [w1, entry('r2', 'rule-correction', {}, AT + 60_000)],
      summaries: [summary('r1', AT), summary('r2', AT + 60_000)],
      live: emptyLive, dismissed: NONE,
    });
    const older = v.syncs[1]!;
    expect(older.warnings[0]!.items).toHaveLength(1);
    expect(older.warnings[0]!.dismissible).toBe(false);
    expect(v.syncs[0]!.live).toBe(true);
  });

  it('import batches with failures are promoted to Warnings; clean batches stay Info', () => {
    const bad = entry('imp-1', 'media-import', { severity: 'warning', message: 'Imported 3, 2 failed.' }, AT + 5);
    const ok = entry('imp-2', 'media-import', { severity: 'info', message: 'Imported 4.' }, AT + 6);
    const v = buildSyncGroups({ log: [entry('r1', 'rule-correction'), bad, ok], summaries: [summary('r1', AT)], live: emptyLive, dismissed: NONE });
    const s = v.syncs[0]!;
    expect(s.warnings.map(w => w.id)).toEqual(['import-failures']);
    expect(s.warnings[0]!.items[0]!.text).toBe('Imported 3, 2 failed.');
    expect(s.info.imports).toEqual(['Imported 4.']);
  });
});

// ---------------------------------------------------------------------------
// 6. Hide rules + info folder.
// ---------------------------------------------------------------------------
describe('hide rules and the Info card', () => {
  it('preflight-OK, malformed-token, lock-preserved never appear anywhere', () => {
    const l = [
      entry('r1', 'fa-preflight', { severity: 'info', message: 'PREFLIGHT_OK_TEXT' }),
      entry('r1', 'malformed-token', { message: 'MALFORMED_TEXT' }),
      entry('r1', 'lock-preserved-adjustment', { message: 'LOCKPRESERVED_TEXT' }),
    ];
    const v = buildSyncGroups({ log: l, summaries: [summary('r1', AT)], live: emptyLive, dismissed: NONE });
    const dump = JSON.stringify(v);
    for (const t of ['PREFLIGHT_OK_TEXT', 'MALFORMED_TEXT', 'LOCKPRESERVED_TEXT']) expect(dump).not.toContain(t);
  });

  it('the "More details" folder groups adjustments, recoveries, overflow, boundary deltas and assets', () => {
    const l = [
      entry('r1', 'rule-correction'), entry('r1', 'rule-correction'), entry('r1', 'rescue'),
      entry('r1', 'lock-span-overflow'), finding('r1', 'boundary-delta', {}, 'info'),
      finding('r1', 'asset-replaced', {}, 'info'), finding('r1', 'asset-unverified', {}, 'info'),
    ];
    const v = buildSyncGroups({ log: l, summaries: [summary('r1', AT)], live: emptyLive, dismissed: NONE });
    const more = Object.fromEntries(v.syncs[0]!.info.more.map(m => [m.id, m.entries.length]));
    expect(more).toEqual({ adjustments: 2, recoveries: 1, 'lock-overflow': 1, 'boundary-deltas': 1, assets: 2 });
  });

  it('a project with imports but no sync still shows them (one project group)', () => {
    const v = buildSyncGroups({ log: [entry('imp', 'media-import', { severity: 'info', message: 'Imported 2.' })], summaries: [], live: emptyLive, dismissed: NONE });
    expect(v.syncs).toHaveLength(1);
    expect(v.syncs[0]!.info.imports).toEqual(['Imported 2.']);
  });
});

describe('timeAgo', () => {
  it('formats compactly', () => {
    expect(timeAgo(AT, AT + 10_000)).toBe('just now');
    expect(timeAgo(AT, AT + 5 * 60_000)).toBe('5m ago');
    expect(timeAgo(AT, AT + 3 * 3_600_000)).toBe('3h ago');
    expect(timeAgo(AT, AT + 2 * 86_400_000)).toBe('2d ago');
  });
});
