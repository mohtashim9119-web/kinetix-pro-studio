// Sync-log panel model: one macro group per sync run, each with exactly three
// cards — Actions (things the user must fix), Warnings (worth a look, can be
// dismissed) and Info (what happened). Pure view layer: it reads the log and
// the live project; it never changes either.
import type { SyncLogEntry, SyncRunSummary } from '../types';
import {
  engineOf,
  findingOf,
  itemsFor,
  SYNC_LOG_USER_COPY,
  type AttentionItem,
} from './syncLogUserView';
import { CLOUD_USD_PER_WORKER_SEC, formatUsd } from './syncQueue';

// ---------------------------------------------------------------------------
// Ids and copy
// ---------------------------------------------------------------------------
export type ActionId =
  | 'missing-media' | 'offline-media' | 'damaged-media' | 'skipped'
  | 'mismatch' | 'sync-stopped' | 'layer2-unbound';
export type WarningId =
  | 'estimated' | 'text-fit' | 'layer2-adjusted' | 'edits-dropped' | 'import-failures' | 'quality-notes';
export type InfoSection = 'adjustments' | 'recoveries' | 'lock-overflow' | 'boundary-deltas' | 'assets' | 'other';

const ACTION_ORDER: readonly ActionId[] = [
  'missing-media', 'offline-media', 'damaged-media', 'skipped', 'mismatch', 'sync-stopped', 'layer2-unbound',
];
const WARNING_ORDER: readonly WarningId[] = [
  'estimated', 'text-fit', 'layer2-adjusted', 'edits-dropped', 'import-failures', 'quality-notes',
];
const INFO_ORDER: readonly InfoSection[] = [
  'adjustments', 'recoveries', 'lock-overflow', 'boundary-deltas', 'assets', 'other',
];

export const SYNC_GROUPS_COPY = {
  clear: 'All clear — exports unblocked',
  attention: (n: number): string => `${n} item${n === 1 ? ' needs' : 's need'} your attention`,
  action: {
    'missing-media': { title: 'Missing media', hint: 'Exports as black frames, on the slower path.', tone: 'amber', cta: 'add-media' },
    'offline-media': { title: 'Offline media', hint: 'Blocks export until the files are relinked.', tone: 'red', cta: 'relink' },
    'damaged-media': { title: 'Damaged media', hint: 'The file is there but cannot be read. Replace it.', tone: 'red', cta: undefined },
    skipped: { title: 'Skipped scenes', hint: 'Fix the script or audio, then re-sync.', tone: 'red', cta: undefined },
    mismatch: { title: 'Wrong file pair', hint: 'The script and voiceover do not look like a pair. Replace one.', tone: 'red', cta: undefined },
    'sync-stopped': { title: 'Sync stopped', hint: 'The timeline was not updated.', tone: 'red', cta: 'retry' },
    'layer2-unbound': { title: 'Layer 2 unbound', hint: 'Rebind these in the Layer 2 panel.', tone: 'amber', cta: undefined },
  } as const satisfies Record<ActionId, { title: string; hint: string; tone: 'red' | 'amber'; cta: ActionCta | undefined }>,
  warning: {
    estimated: 'Estimated timings',
    'text-fit': "Text doesn't fit",
    'layer2-adjusted': 'Layer 2 auto-adjusted',
    'edits-dropped': 'Manual edits dropped',
    'import-failures': 'Import failures',
    'quality-notes': 'Sync quality notes',
  } as const satisfies Record<WarningId, string>,
  info: {
    adjustments: 'Auto-adjustments',
    recoveries: 'Recoveries',
    'lock-overflow': 'Lock span overflow',
    'boundary-deltas': 'Boundary deltas',
    assets: 'Media notes',
    other: 'Other',
  } as const satisfies Record<InfoSection, string>,
} as const;

export type ActionCta = 'add-media' | 'relink' | 'retry';

// ---------------------------------------------------------------------------
// Classification — one table-driven function, so every kind has one home.
// ---------------------------------------------------------------------------
export type Classification =
  | { card: 'action'; sub: ActionId }
  | { card: 'warning'; sub: WarningId }
  | { card: 'info'; sub: InfoSection | 'imports' }
  | { card: 'hide'; sub?: undefined };

const FINDING_CLASS: Record<string, Classification> = {
  // Warnings
  'ctc-infeasible': { card: 'warning', sub: 'estimated' },
  'fa-victim-retimed': { card: 'warning', sub: 'estimated' },
  'character-fallback': { card: 'warning', sub: 'estimated' },
  'tail-unmatched': { card: 'warning', sub: 'estimated' },
  'numeric-unmatched': { card: 'warning', sub: 'estimated' },
  'weak-match': { card: 'warning', sub: 'text-fit' },
  'scene-density': { card: 'warning', sub: 'text-fit' },
  'spot-past-voiceover': { card: 'warning', sub: 'layer2-adjusted' },
  'spot-overlap': { card: 'warning', sub: 'layer2-adjusted' },
  'bundle-import-failed': { card: 'warning', sub: 'import-failures' },
  // Actions
  wpm: { card: 'action', sub: 'mismatch' },
  'local-coverage': { card: 'action', sub: 'mismatch' },
  'spot-segment-unmatched': { card: 'action', sub: 'layer2-unbound' },
  'spot-clip-unmatched': { card: 'action', sub: 'layer2-unbound' },
  'spot-clip-missing': { card: 'action', sub: 'layer2-unbound' },
  // Info
  'freeze-frame': { card: 'info', sub: 'adjustments' },
  'boundary-delta': { card: 'info', sub: 'boundary-deltas' },
  'asset-missing': { card: 'info', sub: 'assets' },
  'asset-corrupt': { card: 'info', sub: 'assets' },
  'asset-unverified': { card: 'info', sub: 'assets' },
  'asset-replaced': { card: 'info', sub: 'assets' },
  'asset-relinked': { card: 'info', sub: 'assets' },
  // Consumed by the header, never listed
  'engine-forced-alignment': { card: 'hide' },
  'engine-forced-alignment-cloud': { card: 'hide' },
  'engine-whisper': { card: 'hide' },
  'engine-whisper-cloud': { card: 'hide' },
  'engine-character': { card: 'hide' },
  'run-cost': { card: 'hide' },
};

export function classifyEntry(entry: SyncLogEntry): Classification {
  switch (entry.type) {
    case 'no-asset': return { card: 'action', sub: 'missing-media' };
    case 'skip': return { card: 'action', sub: 'skipped' };
    case 'abort':
    case 'whisper-model-failure':
    case 'unsupported-language':
      return { card: 'action', sub: 'sync-stopped' };
    case 'fa-paused':
      return entry.reason === 'hopeless-local-coverage'
        ? { card: 'action', sub: 'mismatch' }
        : { card: 'action', sub: 'sync-stopped' };
    case 'silence-error': return { card: 'warning', sub: 'quality-notes' };
    case 'malformed-token':
    case 'lock-preserved-adjustment':
      return { card: 'hide' };
    case 'lock-refused':
    case 'lock-not-restored':
      return { card: 'warning', sub: 'edits-dropped' };
    case 'lock-span-overflow': return { card: 'info', sub: 'lock-overflow' };
    case 'rescue': return { card: 'info', sub: 'recoveries' };
    case 'rule-correction': return { card: 'info', sub: 'adjustments' };
    case 'fa-preflight':
      return entry.severity === 'warning' ? { card: 'warning', sub: 'quality-notes' } : { card: 'hide' };
    case 'fa-gate-closed':
      // A reason means the user chose Whisper after a pause (estimated timing);
      // none means high-precision sync was simply off.
      return entry.reason !== undefined
        ? { card: 'warning', sub: 'estimated' }
        : { card: 'warning', sub: 'quality-notes' };
    case 'media-import':
      return entry.severity === 'warning'
        ? { card: 'warning', sub: 'import-failures' }
        : { card: 'info', sub: 'imports' };
    case 'media-match': return { card: 'info', sub: 'imports' };
    case 'warning':
    case 'info': {
      const kind = findingOf(entry)?.kind;
      if (kind && FINDING_CLASS[kind]) return FINDING_CLASS[kind]!;
      if (entry.type === 'info' && entry.message.startsWith('Sync completed')) return { card: 'hide' };
      return { card: 'info', sub: 'other' };
    }
    default:
      return { card: 'info', sub: 'other' };
  }
}

// ---------------------------------------------------------------------------
// Model
// ---------------------------------------------------------------------------
export interface GroupItem {
  key: string;
  text: string;
  segmentId?: string;
  sceneRef?: AttentionItem['sceneRef'];
}

export interface ActionGroup {
  id: ActionId;
  title: string;
  hint: string;
  tone: 'red' | 'amber';
  cta?: ActionCta;
  offerModels: boolean;
  items: GroupItem[];
}

export interface WarningGroup {
  id: WarningId;
  title: string;
  dismissible: boolean;
  items: GroupItem[];
}

export interface InfoCard {
  summaryLine: string;
  imports: string[];
  more: { id: InfoSection; title: string; entries: SyncLogEntry[] }[];
}

export interface SyncGroup {
  runId: string;
  number: number;
  timestamp: number;
  live: boolean;
  engine?: string;
  cost?: string;
  health: 'red' | 'amber' | 'green';
  actions: ActionGroup[];
  warnings: WarningGroup[];
  /** Number of sub-groups with something in them; undefined at zero (no number shown). */
  actionsChip?: number;
  warningsChip?: number;
  info: InfoCard;
}

export interface LiveState {
  segments: readonly { id: string; assetId?: string; text?: string }[];
  assets: readonly { id: string; name: string; url?: string; unresolved?: boolean; corrupt?: unknown }[];
  spots: readonly { id: string; assetId?: string; clipName?: string; anchorSegmentId: string; needsReview?: boolean }[];
}

export interface BuildInput {
  log: readonly SyncLogEntry[];
  summaries: readonly SyncRunSummary[];
  /** The live project. Absent = frozen records only. */
  live?: LiveState;
  dismissed: ReadonlySet<string>;
}

export interface SyncGroupsView {
  headline: { tone: 'green' | 'amber' | 'red'; text: string; count: number };
  /** Up to five, newest first. */
  syncs: SyncGroup[];
  /** The rest, newest first. */
  earlier: SyncGroup[];
}

export const VISIBLE_SYNCS = 5;

export function warningKey(sub: WarningId, itemKey: string, runId: string): string {
  return `warn:${sub}:${itemKey}@${runId}`;
}

export function timeAgo(timestamp: number, now: number = Date.now()): string {
  const s = Math.max(0, Math.round((now - timestamp) / 1000));
  if (s < 60) return 'just now';
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

// ---------------------------------------------------------------------------
// Live actions (the newest sync): computed from the project, never from the log.
// ---------------------------------------------------------------------------
function liveActions(live: LiveState): ActionGroup[] {
  const out = new Map<ActionId, GroupItem[]>();
  const push = (id: ActionId, item: GroupItem): void => { out.set(id, [...(out.get(id) ?? []), item]); };
  const assetById = new Map(live.assets.map(a => [a.id, a]));
  const segIds = new Set(live.segments.map(s => s.id));
  const firstSegUsing = (assetId: string): string | undefined => live.segments.find(s => s.assetId === assetId)?.id;

  live.segments.forEach((seg, i) => {
    if (!seg.assetId) push('missing-media', { key: `scene:${seg.id}`, text: `Scene ${i + 1}`, segmentId: seg.id });
    else if (!assetById.has(seg.assetId)) push('offline-media', { key: `scene:${seg.id}`, text: `Scene ${i + 1}`, segmentId: seg.id });
  });
  for (const a of live.assets) {
    if (a.unresolved) push('offline-media', { key: `asset:${a.id}`, text: a.name, segmentId: firstSegUsing(a.id) });
    else if (a.corrupt) push('damaged-media', { key: `asset:${a.id}`, text: a.name, segmentId: firstSegUsing(a.id) });
  }
  live.spots.forEach((spot, i) => {
    const label = `Spot ${i + 1}`;
    const anchor = segIds.has(spot.anchorSegmentId) ? spot.anchorSegmentId : undefined;
    const asset = spot.assetId ? assetById.get(spot.assetId) : undefined;
    let text: string | undefined;
    if (spot.needsReview || !anchor) text = `${label}: its scene was removed`;
    else if (!spot.assetId) text = `${label}: clip not found${spot.clipName ? ` (${spot.clipName})` : ''}`;
    else if (!asset || asset.unresolved) text = `${label}: clip file is missing`;
    if (text) push('layer2-unbound', { key: `spot:${spot.id}`, text, segmentId: anchor });
  });
  return buildActionGroups(out, false);
}

function buildActionGroups(byId: Map<ActionId, GroupItem[]>, offerModels: boolean | Map<ActionId, boolean>): ActionGroup[] {
  return ACTION_ORDER.flatMap(id => {
    const items = byId.get(id);
    if (!items || items.length === 0) return [];
    const copy = SYNC_GROUPS_COPY.action[id];
    return [{
      id, title: copy.title, hint: copy.hint, tone: copy.tone, cta: copy.cta,
      offerModels: id === 'sync-stopped' && (typeof offerModels === 'boolean' ? offerModels : offerModels.get(id) === true),
      items,
    } satisfies ActionGroup];
  });
}

function itemsOf(entry: SyncLogEntry): GroupItem[] {
  const items = itemsFor(entry);
  return items.map((item, i) => ({
    key: items.length === 1 ? entry.id : `${entry.id}#${i}`,
    text: item.text,
    ...(item.segmentId ? { segmentId: item.segmentId } : {}),
    ...(item.sceneRef ? { sceneRef: item.sceneRef } : {}),
  }));
}

const LIVE_REPLACED: ReadonlySet<string> = new Set(['missing-media', 'layer2-unbound']);

// ---------------------------------------------------------------------------
// The builder
// ---------------------------------------------------------------------------
export function buildSyncGroups(input: BuildInput): SyncGroupsView {
  const { log, summaries, live, dismissed } = input;
  const isMedia = (e: SyncLogEntry): boolean => e.type === 'media-import' || e.type === 'media-match';

  // 1. The runs, oldest first.
  const stamp = new Map<string, number>();
  for (const s of summaries) stamp.set(s.syncRunId, s.timestamp);
  for (const e of log) {
    if (isMedia(e)) continue;
    stamp.set(e.syncRunId, Math.min(stamp.get(e.syncRunId) ?? e.timestamp, e.timestamp));
  }
  let runIds = [...stamp.entries()].sort((a, b) => a[1] - b[1]).map(([id]) => id);
  const synthetic = runIds.length === 0 && log.length > 0;
  if (synthetic) {
    runIds = ['project'];
    stamp.set('project', Math.max(...log.map(e => e.timestamp)));
  }

  // 2. Entries per run (media events are not runs: they join the sync before them).
  const entriesByRun = new Map<string, SyncLogEntry[]>(runIds.map(id => [id, []]));
  for (const e of log) {
    let runId = e.syncRunId;
    if (synthetic || isMedia(e) || !entriesByRun.has(runId)) {
      const before = runIds.filter(id => (stamp.get(id) ?? 0) <= e.timestamp);
      runId = before.length > 0 ? before[before.length - 1]! : runIds[0]!;
    }
    entriesByRun.get(runId)?.push(e);
  }

  // 3. One group per run.
  const newestId = runIds[runIds.length - 1];
  const summaryByRun = new Map(summaries.map(s => [s.syncRunId, s]));
  const groups: SyncGroup[] = runIds.map((runId, idx) => {
    const isLive = runId === newestId;
    const entries = [...(entriesByRun.get(runId) ?? [])].sort((a, b) => a.timestamp - b.timestamp);
    return buildOne(runId, idx + 1, stamp.get(runId) ?? 0, isLive, entries, summaryByRun.get(runId), isLive ? live : undefined, dismissed);
  });

  const newestFirst = groups.reverse();
  const newest = newestFirst[0];
  const actionCount = newest ? newest.actions.length : (live ? liveActions(live).length : 0);
  const anyRed = newest
    ? newest.actions.some(a => a.tone === 'red')
    : (live ? liveActions(live).some(a => a.tone === 'red') : false);
  const headline = actionCount === 0
    ? { tone: 'green' as const, text: SYNC_GROUPS_COPY.clear, count: 0 }
    : { tone: anyRed ? 'red' as const : 'amber' as const, text: SYNC_GROUPS_COPY.attention(actionCount), count: actionCount };

  return { headline, syncs: newestFirst.slice(0, VISIBLE_SYNCS), earlier: newestFirst.slice(VISIBLE_SYNCS) };
}

function buildOne(
  runId: string,
  number: number,
  timestamp: number,
  isLive: boolean,
  entries: SyncLogEntry[],
  summary: SyncRunSummary | undefined,
  live: LiveState | undefined,
  dismissed: ReadonlySet<string>,
): SyncGroup {
  const actionItems = new Map<ActionId, GroupItem[]>();
  const stoppedModels = new Map<ActionId, boolean>();
  const warnItems = new Map<WarningId, GroupItem[]>();
  const imports: string[] = [];
  const more = new Map<InfoSection, SyncLogEntry[]>();
  let cost: string | undefined;
  let estimated = 0;

  for (const e of entries) {
    const f = findingOf(e);
    if (f?.kind === 'run-cost' && typeof f.count === 'number' && f.count > 0) {
      cost = formatUsd(f.count * CLOUD_USD_PER_WORKER_SEC);
    }
    if (f?.kind === 'fa-victim-retimed' || f?.kind === 'character-fallback') estimated += f.count ?? 0;

    const c = classifyEntry(e);
    if (c.card === 'hide') continue;
    if (c.card === 'action') {
      // The newest sync's media and Layer 2 problems come from the live project.
      if (live && LIVE_REPLACED.has(c.sub)) continue;
      actionItems.set(c.sub, [...(actionItems.get(c.sub) ?? []), ...itemsOf(e)]);
      if (c.sub === 'sync-stopped' && (e.type === 'whisper-model-failure' || (e.type === 'fa-paused' && String(e.reason).startsWith('model-')))) {
        stoppedModels.set('sync-stopped', true);
      }
    } else if (c.card === 'warning') {
      warnItems.set(c.sub, [...(warnItems.get(c.sub) ?? []), ...itemsOf(e)]);
    } else if (c.sub === 'imports') {
      imports.push(e.message);
    } else {
      more.set(c.sub, [...(more.get(c.sub) ?? []), e]);
    }
  }

  // Actions: live problems first, then this run's frozen records.
  const liveMap = new Map<ActionId, GroupItem[]>();
  if (live) for (const g of liveActions(live)) liveMap.set(g.id, g.items);
  const merged = new Map<ActionId, GroupItem[]>(actionItems);
  for (const [id, items] of liveMap) merged.set(id, [...items, ...(merged.get(id) ?? [])]);
  const actions = buildActionGroups(merged, stoppedModels);

  // Warnings: dismissals apply to the live sync only.
  const warnings: WarningGroup[] = WARNING_ORDER.flatMap(id => {
    const all = warnItems.get(id) ?? [];
    const items = isLive ? all.filter(i => !dismissed.has(warningKey(id, i.key, runId))) : all;
    return items.length === 0 ? [] : [{ id, title: SYNC_GROUPS_COPY.warning[id], dismissible: isLive, items }];
  });

  const engineLabel = engineLabelOf(entries);
  const parts: string[] = [];
  if (engineLabel) parts.push(engineLabel);
  if (summary) {
    parts.push(`${summary.coveredSegments}/${summary.totalSegments} matched`, `${summary.skippedSegments} skipped`, `${estimated} estimated`);
  }
  if (cost) parts.push(cost);

  const health: SyncGroup['health'] = actions.length > 0 ? 'red' : warnings.length > 0 ? 'amber' : 'green';
  return {
    runId, number, timestamp, live: isLive,
    ...(engineLabel ? { engine: engineLabel } : {}),
    ...(cost ? { cost } : {}),
    health,
    actions, warnings,
    ...(actions.length > 0 ? { actionsChip: actions.length } : {}),
    ...(warnings.length > 0 ? { warningsChip: warnings.length } : {}),
    info: {
      summaryLine: parts.join(' · '),
      imports,
      more: INFO_ORDER.flatMap(id => (more.has(id) ? [{ id, title: SYNC_GROUPS_COPY.info[id], entries: more.get(id)! }] : [])),
    },
  };
}

function engineLabelOf(entries: readonly SyncLogEntry[]): string | undefined {
  const engine = engineOf(entries);
  return engine === 'unknown' ? undefined : SYNC_LOG_USER_COPY.headline.engine[engine];
}
