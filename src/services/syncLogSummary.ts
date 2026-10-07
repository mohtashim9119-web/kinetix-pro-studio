// Sync-log summary view: the user-facing top block (one header, one stats line,
// uniform warning blocks) and the per-sync Details sections. Pure — the panel
// renders what this returns. The log itself is untouched.
import type { SyncLogEntry, SyncRunSummary } from '../types';
import {
  attentionKindForEntry,
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
    estimated: (): string => 'Some scenes have estimated timing',
    'text-fit': (n: number): string => `${n} scene${s(n)} may have extra or missing text`,
    mismatch: (): string => "Script and voiceover don't look like a pair",
    'no-media': (n: number): string => `${n} scene${s(n)} ${s(n, 'has', 'have')} no media`,
    'offline-media': (n: number): string => `${n} media file${s(n)} ${s(n, 'is', 'are')} offline`,
    'sync-stopped': (): string => "Sync couldn't finish",
  } satisfies Record<BlockId, (n: number) => string>,
  statusLabel: { dismissed: 'Dismissed', resolved: 'Resolved' },
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
    b.title = SUMMARY_COPY.title[id](b.count);
    return [b];
  });
  return { blocks, autoResolved };
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

export interface ActionRecord { entry: SyncLogEntry; status?: 'dismissed' | 'resolved' }

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
