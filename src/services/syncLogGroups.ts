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
import { classifyScriptWpm } from './syncWpmGate';
import { describeEntry, describeGroupedItem, LIVE_COPY, type Described } from './syncLogCopy';

// ---------------------------------------------------------------------------
// Ids and copy
// ---------------------------------------------------------------------------
export type ActionId =
  | 'missing-media' | 'offline-media' | 'damaged-media' | 'skipped'
  | 'mismatch' | 'sync-stopped' | 'layer2-unbound';
export type WarningId =
  | 'placeholders' | 'unscripted' | 'pace' | 'estimated' | 'text-fit' | 'layer2-adjusted' | 'edits-dropped' | 'import-failures' | 'quality-notes';
export type InfoSection = 'adjustments' | 'recoveries' | 'lock-overflow' | 'boundary-deltas' | 'assets' | 'other';

const ACTION_ORDER: readonly ActionId[] = [
  'missing-media', 'offline-media', 'damaged-media', 'skipped', 'mismatch', 'sync-stopped', 'layer2-unbound',
];
const WARNING_ORDER: readonly WarningId[] = [
  'placeholders', 'unscripted', 'pace', 'estimated', 'text-fit', 'layer2-adjusted', 'edits-dropped', 'import-failures', 'quality-notes',
];
const INFO_ORDER: readonly InfoSection[] = [
  'adjustments', 'recoveries', 'lock-overflow', 'boundary-deltas', 'assets', 'other',
];

export const SYNC_GROUPS_COPY = {
  clear: 'All clear - Ready to export',
  attention: (n: number): string => `${n} item${n === 1 ? ' needs' : 's need'} your attention`,
  action: {
    'missing-media': { title: 'Missing media', hint: 'Exports as black frames, on the slower path.', tone: 'amber', cta: 'add-media' },
    'offline-media': { title: 'Offline media', hint: 'Blocks export until the files are relinked.', tone: 'red', cta: 'relink' },
    'damaged-media': { title: 'Damaged media', hint: 'The file is there but cannot be read. Replace it.', tone: 'red', cta: 'replace' },
    skipped: { title: 'Skipped scenes', hint: 'Fix the script or audio, then re-sync.', tone: 'red', cta: 'resync' },
    mismatch: { title: 'Wrong file pair', hint: 'The script and voiceover do not look like a pair. Replace one.', tone: 'red', cta: 'open-files' },
    'sync-stopped': { title: 'Sync stopped', hint: 'The timeline was not updated.', tone: 'red', cta: 'retry' },
    'layer2-unbound': { title: 'Layer 2 unbound', hint: 'Rebind these in the Layer 2 panel.', tone: 'amber', cta: 'open-layer2' },
  } as const satisfies Record<ActionId, { title: string; hint: string; tone: 'red' | 'amber'; cta: ActionCta | undefined }>,
  warning: {
    placeholders: 'Unspoken scenes kept as placeholders',
    unscripted: 'Speech not in the script',
    pace: 'Script pace',
    estimated: 'Estimated timings',
    'text-fit': "Text doesn't fit",
    'layer2-adjusted': 'Layer 2 auto-adjusted',
    'edits-dropped': 'Manual edits dropped',
    'import-failures': 'Import failures',
    'quality-notes': 'Sync quality notes',
  } as const satisfies Record<WarningId, string>,
  info: {
    imports: 'Media imports',
    adjustments: 'Auto-adjustments',
    recoveries: 'Recoveries',
    'lock-overflow': 'Lock span overflow',
    'boundary-deltas': 'Boundary deltas',
    assets: 'Media notes',
    other: 'Other',
  } as const satisfies Record<InfoSection | 'imports', string>,
} as const;

export type ActionCta = 'add-media' | 'relink' | 'replace' | 'resync' | 'open-files' | 'retry' | 'open-layer2';

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
  // "Text doesn't fit" (weak match, too dense) is hidden from the panel by
  // operator ruling — the records stay in the log and in Copy.
  'weak-match': { card: 'hide' },
  'scene-density': { card: 'hide' },
  'spot-past-voiceover': { card: 'warning', sub: 'layer2-adjusted' },
  'spot-overlap': { card: 'warning', sub: 'layer2-adjusted' },
  'unscripted-speech': { card: 'warning', sub: 'unscripted' },
  'bundle-import-failed': { card: 'warning', sub: 'import-failures' },
  // Actions
  wpm: { card: 'warning', sub: 'pace' },
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

/** Bulk billing lines written before the structured `run-cost` finding existed:
 *  the app's own fixed template (`BULK_COPY.billingLog`), read back for the cost only. */
/** Words/min behind a pace warning: the stored number, or (entries written before
 *  it was stored) read back from the app's own fixed sentence. */
function wpmOf(entry: SyncLogEntry): number | undefined {
  const f = entry.finding;
  if (f?.kind === 'wpm' && typeof f.count === 'number') return f.count;
  const m = /reads at (\d+(?:\.\d+)?) words\/min/.exec(entry.message);
  return m ? Number(m[1]) : undefined;
}

/** Re-judged against TODAY's band, so a warning raised under an older, narrower
 *  range no longer shows once its pace counts as normal. */
function paceBand(entry: SyncLogEntry): ReturnType<typeof classifyScriptWpm>['band'] | undefined {
  const wpm = wpmOf(entry);
  return wpm === undefined ? undefined : classifyScriptWpm(wpm, 60).band;
}

function legacyBillingSec(entry: SyncLogEntry): number | undefined {
  const m = /^Cloud billing \(bulk build\): (\d+(?:\.\d+)?) s worked/.exec(entry.message);
  return m ? Number(m[1]) : undefined;
}

export function classifyEntry(entry: SyncLogEntry): Classification {
  // Rule-engine lines (R.5–R.15, R-AP …) stay in the log but never in the panel.
  if (entry.type !== 'skip' && /^R[.-]/.test(entry.owningRule ?? '')) return { card: 'hide' };
  switch (entry.type) {
    case 'no-asset': return { card: 'action', sub: 'missing-media' };
    case 'skip': return { card: 'warning', sub: 'placeholders' };
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
    case 'rule-correction': return { card: 'hide' };
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
      if (kind === 'wpm' && paceBand(entry) === 'normal') return { card: 'hide' };
      if (kind && FINDING_CLASS[kind]) return FINDING_CLASS[kind]!;
      if (entry.type === 'info' && entry.message.startsWith('Sync completed')) return { card: 'hide' };
      if (entry.type === 'info' && legacyBillingSec(entry) !== undefined) return { card: 'hide' };
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
  /** Short plain line (fits in two lines of the panel). */
  text: string;
  /** The full explanation in plain words, shown when the item is clicked. */
  detail?: string;
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

export interface InfoGroup {
  id: InfoSection | 'imports';
  title: string;
  items: GroupItem[];
}

export interface InfoCard {
  /** Always first: matched, cloud cost. (Estimated timing lives in Warnings.) */
  facts: GroupItem[];
  groups: InfoGroup[];
}

export interface SyncGroup {
  runId: string;
  number: number;
  timestamp: number;
  live: boolean;
  engine?: string;
  cost?: string;
  /** Header second line: "372/372 matched · 2 estimated · used $0.0074". */
  summary?: string;
  /** Scenes with estimated timing (distinct), for the header and Info. */
  estimatedScenes: number;
  health: 'red' | 'amber' | 'green';
  actions: ActionGroup[];
  warnings: WarningGroup[];
  /** Number of sub-groups with something in them; undefined at zero. */
  actionsChip?: number;
  warningsChip?: number;
  /** Rows in Info (facts + sub-groups). */
  infoCount: number;
  /** Every log record of this sync, hidden ones included (what Copy copies). */
  entries: SyncLogEntry[];
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
  /** This project's cloud cost ledger (every billed stage, bulk or editor). */
  costEntries?: readonly { at: number; usd: number; sec: number; cached: boolean }[];
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

/** Action groups that are a run's RECORD (not live state): the user can mark an
 *  item resolved once handled. Live media/Layer 2 groups clear themselves. */
export const RESOLVABLE_ACTIONS: ReadonlySet<ActionId> = new Set(['skipped', 'mismatch', 'sync-stopped']);

export function resolveKey(sub: ActionId, itemKey: string, runId: string): string {
  return `resolve:${sub}:${itemKey}@${runId}`;
}

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
const plain = (d: Described): { text: string; detail: string } => ({ text: d.short, detail: d.detail });

function liveActions(live: LiveState): ActionGroup[] {
  const out = new Map<ActionId, GroupItem[]>();
  const push = (id: ActionId, item: GroupItem): void => { out.set(id, [...(out.get(id) ?? []), item]); };
  const assetById = new Map(live.assets.map(a => [a.id, a]));
  const segIds = new Set(live.segments.map(s => s.id));
  const firstSegUsing = (assetId: string): string | undefined => live.segments.find(s => s.assetId === assetId)?.id;

  live.segments.forEach((seg, i) => {
    if (!seg.assetId) push('missing-media', { key: `scene:${seg.id}`, ...plain(LIVE_COPY.missingMedia(i + 1)), segmentId: seg.id });
    else if (!assetById.has(seg.assetId)) push('offline-media', { key: `scene:${seg.id}`, ...plain(LIVE_COPY.sceneFileGone(i + 1)), segmentId: seg.id });
  });
  for (const a of live.assets) {
    if (a.unresolved) push('offline-media', { key: `asset:${a.id}`, ...plain(LIVE_COPY.offline(a.name)), segmentId: firstSegUsing(a.id) });
    else if (a.corrupt) push('damaged-media', { key: `asset:${a.id}`, ...plain(LIVE_COPY.damaged(a.name)), segmentId: firstSegUsing(a.id) });
  }
  live.spots.forEach((spot, i) => {
    const n = i + 1;
    const anchor = segIds.has(spot.anchorSegmentId) ? spot.anchorSegmentId : undefined;
    const asset = spot.assetId ? assetById.get(spot.assetId) : undefined;
    let copy: Described | undefined;
    if (spot.needsReview || !anchor) copy = LIVE_COPY.spotSceneRemoved(n);
    else if (!spot.assetId) copy = LIVE_COPY.spotClipNotFound(n, spot.clipName);
    else if (!asset || asset.unresolved) copy = LIVE_COPY.spotClipMissing(n);
    if (copy) push('layer2-unbound', { key: `spot:${spot.id}`, ...plain(copy), segmentId: anchor });
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
  const kind = findingOf(entry)?.kind;
  if (entry.groupedItems && entry.groupedItems.length > 0) {
    const refs = itemsFor(entry);
    return entry.groupedItems.map((g, i) => {
      const d = describeGroupedItem(kind, g);
      const sceneRef = refs[i]?.sceneRef;
      return {
        key: entry.groupedItems!.length === 1 ? entry.id : `${entry.id}#${i}`,
        text: d.short,
        detail: d.detail,
        ...(sceneRef ? { sceneRef } : {}),
      };
    });
  }
  const base = itemsFor(entry)[0];
  const d = describeEntry(entry);
  return [{
    key: entry.id,
    text: d.short,
    detail: d.detail,
    ...(base?.segmentId ? { segmentId: base.segmentId } : {}),
    ...(base?.sceneRef ? { sceneRef: base.sceneRef } : {}),
  }];
}

const LIVE_REPLACED: ReadonlySet<string> = new Set(['missing-media', 'layer2-unbound']);

// ---------------------------------------------------------------------------
// The builder
// ---------------------------------------------------------------------------
export function buildSyncGroups(input: BuildInput): SyncGroupsView {
  const { log, summaries, live, dismissed, costEntries = [] } = input;
  const isMedia = (e: SyncLogEntry): boolean => e.type === 'media-import' || e.type === 'media-match';

  // 1. The runs, oldest first. A sync is a run that wrote a summary — every
  // finished, stopped or paused sync does. Records written while a sync was
  // being prepared (transcription, imports, a cache-hit cost line) carry their
  // own ids; they are part of that sync, not syncs of their own. Logs with no
  // summaries at all (very old projects) fall back to grouping by record id.
  const stamp = new Map<string, number>();
  for (const s of summaries) stamp.set(s.syncRunId, s.timestamp);
  if (stamp.size === 0) {
    for (const e of log) {
      if (isMedia(e)) continue;
      stamp.set(e.syncRunId, Math.min(stamp.get(e.syncRunId) ?? e.timestamp, e.timestamp));
    }
  }
  let runIds = [...stamp.entries()].sort((a, b) => a[1] - b[1]).map(([id]) => id);
  const synthetic = runIds.length === 0 && log.length > 0;
  if (synthetic) {
    runIds = ['project'];
    stamp.set('project', Math.max(...log.map(e => e.timestamp)));
  }

  // 2. Records per sync. A record from another id joins the sync it led up to
  // (the first one that finished at or after it); anything after the last
  // sync joins the latest.
  const entriesByRun = new Map<string, SyncLogEntry[]>(runIds.map(id => [id, []]));
  for (const e of log) {
    let runId = e.syncRunId;
    if (synthetic || !entriesByRun.has(runId)) {
      runId = runIds.find(id => (stamp.get(id) ?? 0) >= e.timestamp) ?? runIds[runIds.length - 1]!;
    }
    entriesByRun.get(runId)?.push(e);
  }

  // 3. One group per run.
  const newestId = runIds[runIds.length - 1];
  const summaryByRun = new Map(summaries.map(s => [s.syncRunId, s]));
  // Cloud charges belong to the sync they happened just before (a charge is
  // recorded while the sync runs; its summary is stamped when it finishes).
  const GRACE_MS = 5 * 60_000;
  const costByRun = new Map<string, { usd: number; sec: number; any: boolean }>();
  for (const c of costEntries) {
    const runId = runIds.find(id => (stamp.get(id) ?? 0) + GRACE_MS >= c.at) ?? newestId;
    if (!runId) continue;
    const acc = costByRun.get(runId) ?? { usd: 0, sec: 0, any: false };
    costByRun.set(runId, { usd: acc.usd + c.usd, sec: acc.sec + c.sec, any: true });
  }
  const groups: SyncGroup[] = runIds.map((runId, idx) => {
    const isLive = runId === newestId;
    const entries = [...(entriesByRun.get(runId) ?? [])].sort((a, b) => a.timestamp - b.timestamp);
    return buildOne(runId, idx + 1, stamp.get(runId) ?? 0, isLive, entries, summaryByRun.get(runId), isLive ? live : undefined, dismissed, costByRun.get(runId));
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
  ledgerCost: { usd: number; sec: number; any: boolean } | undefined,
): SyncGroup {
  const actionItems = new Map<ActionId, GroupItem[]>();
  const stoppedModels = new Map<ActionId, boolean>();
  const warnItems = new Map<WarningId, GroupItem[]>();
  const infoItems = new Map<InfoSection | 'imports', GroupItem[]>();
  let logCostSec: number | undefined;
  const estimatedKeys = new Set<string>();
  let estimatedAll = 0;

  for (const e of entries) {
    const f = findingOf(e);
    const workerSec = f?.kind === 'run-cost' ? f.count : legacyBillingSec(e);
    if (typeof workerSec === 'number' && workerSec > 0) logCostSec = (logCostSec ?? 0) + workerSec;
    noteEstimated(e, f, estimatedKeys, n => { estimatedAll = Math.max(estimatedAll, n); });

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
    } else {
      infoItems.set(c.sub, [...(infoItems.get(c.sub) ?? []), ...itemsOf(e)]);
    }
  }

  // Actions: live problems first, then this run's frozen records.
  const liveMap = new Map<ActionId, GroupItem[]>();
  if (live) for (const g of liveActions(live)) liveMap.set(g.id, g.items);
  const merged = new Map<ActionId, GroupItem[]>();
  for (const [id, items] of actionItems) {
    const kept = isLive && RESOLVABLE_ACTIONS.has(id) ? items.filter(i => !dismissed.has(resolveKey(id, i.key, runId))) : items;
    if (kept.length > 0) merged.set(id, kept);
  }
  for (const [id, items] of liveMap) merged.set(id, [...items, ...(merged.get(id) ?? [])]);
  const actions = buildActionGroups(merged, stoppedModels);

  // Warnings: dismissals apply to the live sync only.
  const warnings: WarningGroup[] = WARNING_ORDER.flatMap(id => {
    const all = warnItems.get(id) ?? [];
    const items = isLive ? all.filter(i => !dismissed.has(warningKey(id, i.key, runId))) : all;
    return items.length === 0 ? [] : [{ id, title: SYNC_GROUPS_COPY.warning[id], dismissible: isLive, items }];
  });

  const engineLabel = engineLabelOf(entries);
  const estimated = Math.max(estimatedKeys.size, estimatedAll);
  const engineKind = engineOf(entries);
  const onCloud = engineKind === 'forced-alignment-cloud' || engineKind === 'whisper-cloud';
  // Ledger first (every cloud stage); the run's own billing line otherwise.
  const costUsd = ledgerCost?.any ? ledgerCost.usd : logCostSec !== undefined ? logCostSec * CLOUD_USD_PER_WORKER_SEC : undefined;
  const costSec = ledgerCost?.any ? ledgerCost.sec : logCostSec;
  const cost = costUsd !== undefined && costUsd > 0 ? formatUsd(costUsd) : undefined;
  // $0 has two honest reasons: the cloud answered from its cache, or the sync
  // ran on this computer. Unknown cloud cost is said plainly, never as $0.
  const fromCache = !cost && (ledgerCost?.any === true || entries.some(e => /served from the cloud cache/.test(e.message)));
  const costPhrase = cost ? `used ${cost}`
    : fromCache ? '$0 · served from cloud cache'
    : costUsd !== undefined || (!onCloud && engineKind !== 'unknown') ? '$0 · ran on this computer'
    : 'cost not recorded';
  // Skipped scenes are kept as estimated placeholders now, so no "skipped" count.
  const parts: string[] = [];
  if (summary) parts.push(`${summary.coveredSegments}/${summary.totalSegments} matched`);
  // Header keeps cost short and uniform: "used $X" (cache and local runs are $0);
  // the Info line says why.
  const headerCost = cost ? `used ${cost}` : costPhrase === 'cost not recorded' ? 'cost unknown' : 'used $0';
  parts.push(`${estimated} estimated`, headerCost);

  const facts: GroupItem[] = [
    ...(summary ? [{
      key: 'fact:matched',
      text: `${summary.coveredSegments} of ${summary.totalSegments} scenes matched`,
      detail: `${summary.coveredSegments} of the ${summary.totalSegments} scenes were found in the voiceover and timed from it.`,
    }] : []),
    {
      key: 'fact:cost',
      text: cost ? `Cloud cost: ${cost}` : costPhrase === 'cost not recorded' ? 'Cloud cost not recorded' : costPhrase,
      detail: cost
        ? `Ran on the cloud: ${Math.round(costSec ?? 0)} seconds worked, ${cost} paid.`
        : fromCache
          ? 'Ran on the cloud, served from cache: 0 seconds worked, $0 paid.'
          : costPhrase === '$0 · ran on this computer'
            ? 'Ran on this computer: no cloud time, $0 paid.'
            : "This sync ran on the cloud before costs were recorded, so its cost isn't known.",
    },
  ];

  const infoGroups: InfoGroup[] = (['imports', ...INFO_ORDER] as const).flatMap(id => {
    const items = infoItems.get(id);
    return items && items.length > 0 ? [{ id, title: SYNC_GROUPS_COPY.info[id], items }] : [];
  });

  const health: SyncGroup['health'] = actions.length > 0 ? 'red' : warnings.length > 0 ? 'amber' : 'green';
  return {
    runId, number, timestamp, live: isLive,
    entries,
    ...(engineLabel ? { engine: engineLabel } : {}),
    ...(cost ? { cost } : {}),
    ...(parts.length > 0 ? { summary: parts.join(' · ') } : {}),
    health,
    actions, warnings,
    ...(actions.length > 0 ? { actionsChip: actions.length } : {}),
    ...(warnings.length > 0 ? { warningsChip: warnings.length } : {}),
    estimatedScenes: estimated,
    infoCount: facts.length + infoGroups.length,
    info: { facts, groups: infoGroups },
  };
}

/** Distinct scenes with estimated timing: placeholders kept for skipped scenes,
 *  scenes re-timed from standard timing, and scenes whose last words or a number
 *  weren't heard. A text-length fallback times every scene. CTC chunks name
 *  words, not scenes, so they can't be counted as scenes. */
function noteEstimated(
  e: SyncLogEntry,
  f: SyncLogEntry['finding'],
  keys: Set<string>,
  all: (n: number) => void,
): void {
  if (e.type === 'skip') keys.add(`idx:${e.segmentIndex ?? -1}`);
  if (f?.kind === 'fa-victim-retimed') {
    if (f.segmentIds?.length) for (const id of f.segmentIds) keys.add(`id:${id}`);
    else for (let i = 0; i < (f.count ?? 0); i++) keys.add(`victim:${e.id}:${i}`);
  }
  if (f?.kind === 'tail-unmatched' || f?.kind === 'numeric-unmatched') {
    for (const g of e.groupedItems ?? []) {
      if (typeof g.detail?.segmentIndex === 'number') keys.add(`idx:${g.detail.segmentIndex}`);
    }
  }
  if (f?.kind === 'character-fallback' && typeof f.count === 'number') all(f.count);
}

function engineLabelOf(entries: readonly SyncLogEntry[]): string | undefined {
  const engine = engineOf(entries);
  return engine === 'unknown' ? undefined : SYNC_LOG_USER_COPY.headline.engine[engine];
}
