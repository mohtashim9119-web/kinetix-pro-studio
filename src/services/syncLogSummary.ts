// Sync-log summary view: the user-facing top block (one header, one stats line,
// uniform warning blocks) and the per-sync Details sections. Pure — the panel
// renders what this returns. The log itself is untouched.
import type { SyncLogEntry, SyncRunSummary } from '../types';
import type { Asset, Project, VideoSegment } from '../types';
import {
  buildSyncLogUserView,
  attentionKindForEntry,
  resolveAttentionItemSegmentId,
  type AttentionItem,
  type AttentionKind,
  type AttentionLine,
  type SyncLogHeadline,
} from './syncLogUserView';

export type BlockId =
  | 'skipped' | 'estimated' | 'text-fit' | 'mismatch' | 'no-media' | 'offline-media' | 'sync-stopped';

export const BLOCK_ORDER: readonly BlockId[] = [
  'skipped', 'estimated', 'text-fit', 'mismatch', 'no-media', 'offline-media', 'sync-stopped',
];

export const BLOCK_OF_KIND: Record<AttentionKind, BlockId> = {
  'unmatched-scene': 'skipped',
  'estimated-timings': 'estimated',
  'weak-match': 'text-fit',
  'too-dense': 'text-fit',
  'script-audio-mismatch': 'mismatch',
  'no-media': 'no-media',
  'offline-media': 'offline-media',
  'model-missing': 'sync-stopped',
  'language-pack-missing': 'sync-stopped',
  'sync-incomplete': 'sync-stopped',
};

/** A run that did not finish, or a pair that cannot match, is not the user's to
 *  dismiss — it clears when fixed or retried. */
export const BLOCK_DISMISSABLE: Record<BlockId, boolean> = {
  skipped: true, estimated: true, 'text-fit': true, 'no-media': true, 'offline-media': true,
  mismatch: false, 'sync-stopped': false,
};

const s = (n: number, one = '', many = 's'): string => (n === 1 ? one : many);

export const SUMMARY_COPY = {
  clear: 'Everything is running smoothly',
  attention: (n: number): string => `${n} item${s(n)} need${s(n, 's', '')} your attention`,
  title: {
    skipped: (n: number): string => `${n} scene${s(n)} ${s(n, 'was', 'were')} not found in the voiceover`,
    estimated: (n?: number): string =>
      n === undefined ? 'Some scenes have estimated timing' : `${n} scene${s(n)} ${s(n, 'has', 'have')} estimated timing`,
    'text-fit': (n: number): string => `${n} scene${s(n)} may have extra or missing text`,
    mismatch: (): string => "Script and voiceover don't look like a pair",
    'no-media': (n: number): string => `${n} scene${s(n)} ${s(n, 'has', 'have')} no media`,
    'offline-media': (n: number): string => `${n} media file${s(n)} ${s(n, 'is', 'are')} offline`,
    'sync-stopped': (): string => "Sync couldn't finish",
  } satisfies Record<BlockId, (n: number) => string | undefined>,
  statusLabel: { dismissed: 'Dismissed', resolved: 'Resolved', relinked: 'Relinked' },
  mediaSection: 'Media activity',
} as const;

export interface SummaryBlock {
  id: BlockId;
  tone: 'red' | 'amber';
  count: number;
  title: string;
  items: AttentionItem[];
  offerManageModels: boolean;
  offerRelink: boolean;
  dismissable: boolean;
}

export interface LiveSummaryState {
  /** Scenes with no media right now (1-based timeline number). When given, the
   *  no-media block follows it instead of the frozen log entry. */
  unassigned?: readonly { id: string; number: number }[];
  /** The live timeline — lets the estimated-timing block resolve scenes to a true count. */
  segments?: readonly { id: string; text?: string }[];
}

export function buildSummaryBlocks(
  attention: readonly AttentionLine[],
  live: LiveSummaryState = {},
): { blocks: SummaryBlock[]; autoResolved: BlockId[] } {
  const acc = new Map<BlockId, SummaryBlock>();
  for (const line of attention) {
    const id = BLOCK_OF_KIND[line.kind];
    const prev = acc.get(id);
    if (prev) {
      prev.count += line.count;
      prev.items.push(...line.items);
      if (line.tone === 'red') prev.tone = 'red';
      prev.offerManageModels ||= line.offerManageModels;
    } else {
      acc.set(id, {
        id, tone: line.tone, count: line.count, title: '', items: [...line.items],
        offerManageModels: line.offerManageModels, offerRelink: id === 'offline-media',
        dismissable: BLOCK_DISMISSABLE[id],
      });
    }
  }
  const autoResolved: BlockId[] = [];
  const noMedia = acc.get('no-media');
  if (noMedia && live.unassigned) {
    if (live.unassigned.length === 0) {
      acc.delete('no-media');
      autoResolved.push('no-media');
    } else {
      noMedia.count = live.unassigned.length;
      noMedia.items = live.unassigned.map(u => ({ text: `Scene ${u.number}`, segmentId: u.id }));
    }
  }
  const blocks = BLOCK_ORDER.flatMap(id => {
    const b = acc.get(id);
    if (!b) return [];
    b.title = id === 'estimated'
      ? SUMMARY_COPY.title.estimated(estimatedSceneCount(attention, live))
      : SUMMARY_COPY.title[id](b.count) as string;
    return [b];
  });
  return { blocks, autoResolved };
}

/** True distinct scenes behind the estimated-timing entries, or undefined when any entry names no scene. */
export function estimatedSceneCount(attention: readonly AttentionLine[], live: LiveSummaryState): number | undefined {
  const est = attention.find(l => l.kind === 'estimated-timings')?.estimatedScenes;
  if (!est || est.unknown || !live.segments) return undefined;
  const ids = new Set(est.ids);
  for (const ref of est.refs) {
    const id = resolveAttentionItemSegmentId({ text: '', sceneRef: ref }, live.segments);
    if (!id) return undefined;
    ids.add(id);
  }
  const count = Math.max(ids.size, est.allScenes);
  return count > 0 ? count : undefined;
}

export function summaryHeader(
  visible: readonly Pick<SummaryBlock, 'tone'>[],
): { tone: 'green' | 'amber' | 'red'; text: string } {
  if (visible.length === 0) return { tone: 'green', text: SUMMARY_COPY.clear };
  return {
    tone: visible.some(b => b.tone === 'red') ? 'red' : 'amber',
    text: SUMMARY_COPY.attention(visible.length),
  };
}

export function summaryLine2(headline: SyncLogHeadline): string | undefined {
  if (!headline.hasRun || headline.matched === undefined || headline.total === undefined) return undefined;
  const parts = [`${headline.matched}/${headline.total} scenes matched`];
  if (headline.placeholders > 0) parts.push(`${headline.placeholders} placeholder${s(headline.placeholders)}`);
  return parts.join(' · ');
}

// ---------------------------------------------------------------------------
// Details: one section per sync, each with Actions and Info.
// ---------------------------------------------------------------------------

export interface ActionRecord { entry: SyncLogEntry; status?: 'dismissed' | 'resolved' | 'relinked' }

export interface RunSection {
  key: string;
  title: string;
  timestamp: number;
  actions: ActionRecord[];
  info: SyncLogEntry[];
}

const pad = (n: number): string => String(n).padStart(2, '0');
const clock = (t: number): string => `${pad(new Date(t).getHours())}:${pad(new Date(t).getMinutes())}`;

export function buildRunSections(
  log: readonly SyncLogEntry[],
  summaries: readonly SyncRunSummary[],
  state: { dismissed: ReadonlySet<BlockId>; autoResolved: ReadonlySet<BlockId> },
): RunSection[] {
  const summaryByRun = new Map(summaries.map(x => [x.syncRunId, x]));
  const latest = summaries.reduce<SyncRunSummary | undefined>(
    (best, x) => (!best || x.timestamp >= best.timestamp ? x : best), undefined,
  );
  const byKey = new Map<string, SyncLogEntry[]>();
  for (const entry of log) {
    const key = entry.type === 'media-import' || entry.type === 'media-match' ? 'media' : entry.syncRunId;
    const bucket = byKey.get(key);
    if (bucket) bucket.push(entry); else byKey.set(key, [entry]);
  }
  const latestKey = latest?.syncRunId
    ?? [...byKey.entries()].filter(([k]) => k !== 'media')
      .sort((a, b) => Math.max(...b[1].map(e => e.timestamp)) - Math.max(...a[1].map(e => e.timestamp)))[0]?.[0];

  const sections: RunSection[] = [];
  for (const [key, entries] of byKey) {
    const ordered = [...entries].sort((a, b) => b.timestamp - a.timestamp);
    const timestamp = ordered[0]!.timestamp;
    const actions: ActionRecord[] = [];
    const info: SyncLogEntry[] = [];
    for (const entry of ordered) {
      if (entry.finding?.kind === 'asset-relinked') { actions.push({ entry, status: 'relinked' }); continue; }
      const kind = key === 'media' ? undefined : attentionKindForEntry(entry);
      if (!kind) { info.push(entry); continue; }
      if (key !== latestKey) { actions.push({ entry }); continue; }
      const block = BLOCK_OF_KIND[kind];
      if (state.dismissed.has(block)) actions.push({ entry, status: 'dismissed' });
      else if (state.autoResolved.has(block)) actions.push({ entry, status: 'resolved' });
    }
    let title = SUMMARY_COPY.mediaSection as string;
    if (key !== 'media') {
      const sm = summaryByRun.get(key);
      title = `Sync · ${clock(sm?.timestamp ?? timestamp)}`;
      if (sm) title += ` · ${sm.coveredSegments}/${sm.totalSegments} scenes matched`;
    }
    sections.push({ key, title, timestamp, actions, info });
  }
  return sections.sort((a, b) => b.timestamp - a.timestamp);
}

// ---------------------------------------------------------------------------
// Bulk: a finished row carries the same one-line summary and block titles.
// ---------------------------------------------------------------------------

export interface BulkSyncSummary { line?: string; warnings: string[] }

export function summarizeProjectForBulk(
  project: Pick<Project, 'syncLog' | 'syncRunSummaries' | 'segments' | 'assets'>,
): BulkSyncSummary {
  const assets: readonly Asset[] = project.assets ?? [];
  const offline = assets.filter(a => a.unresolved).map(a => a.name);
  const view = buildSyncLogUserView(project.syncLog ?? [], project.syncRunSummaries ?? [], offline);
  const segments: readonly VideoSegment[] = project.segments ?? [];
  const unassigned = segments.flatMap((seg, i) => (seg.assetId ? [] : [{ id: seg.id, number: i + 1 }]));
  const { blocks } = buildSummaryBlocks(view.attention, { unassigned, segments });
  return { line: summaryLine2(view.headline), warnings: blocks.map(b => b.title) };
}

export function bulkDoneStatus(summary: BulkSyncSummary | undefined): string {
  return summary?.line ? `Ready · ${summary.line}` : 'Ready';
}
