/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// ---------------------------------------------------------------------------
// SYNC LOG USER VIEW (operator ruling — supersedes the six-group UI for the
// user surface; plan-v3 item 9 amended). The panel's default view is:
//
//   1. HEADLINE — engine · N/N scenes matched · placeholders · estimated ·
//      time. Placeholder and estimated counts are ALWAYS printed, zero or
//      not: a degraded run must never read as clean.
//   2. ATTENTION — at most ten lines, one per kind (ATTENTION_ORDER), red or
//      amber only; each line's scenes/items expand inside it.
//   3. DETAILS — one collapsed line with per-category counts; expanding a
//      count reveals the raw entries with their original badges.
//
// Pure derivation over `project.syncLog` (+ run summaries and the live
// offline-asset list): nothing here is stored, so a project persisted before
// this view existed renders correctly the first time it is read. Which TYPE
// is recorded is unchanged — this file only decides how each is SHOWN.
//
// ATTENTION IS SCOPED TO THE LATEST SYNC RUN. The log accumulates across runs
// (MAX_LOG_ENTRIES), so aggregating the whole of it would keep a problem the
// user already fixed on screen forever. The window opens at the latest run's
// start timestamp (every entry of one run shares it — App.tsx's `syncRunAt`)
// and includes anything logged since (a later model failure, a later pause).
// An FA pause the user answered is therefore outside the window by
// construction: answering it starts a new run. DETAILS always covers the
// whole log.
// ---------------------------------------------------------------------------
import type { SyncLogEntry, SyncLogFindingKind, SyncRunSummary } from '../types';
import { isKnownSyncLogEntryType, LOCAL_COVERAGE_FIX_HINT, BUNDLE_IMPORT_FAILED_FIX_HINT } from './syncLog';
import { WORD_COVERAGE_FIX_HINT, SCENE_DENSITY_FIX_HINT } from './syncContracts';
import { WPM_CHECK_COPY } from './syncWpmGate';
import { WORD_COVERAGE_MIN_RATIO } from './syncConstants';

export type AttentionKind =
  | 'unmatched-scene'
  | 'estimated-timings'
  | 'weak-match'
  | 'too-dense'
  | 'script-audio-mismatch'
  | 'no-media'
  | 'offline-media'
  | 'model-missing'
  | 'language-pack-missing'
  | 'sync-incomplete';

/** The ruling's own numbering, 1 → 10. Also the render order. */
export const ATTENTION_ORDER: readonly AttentionKind[] = [
  'unmatched-scene',
  'estimated-timings',
  'weak-match',
  'too-dense',
  'script-audio-mismatch',
  'no-media',
  'offline-media',
  'model-missing',
  'language-pack-missing',
  'sync-incomplete',
];

export const ATTENTION_TONE: Record<AttentionKind, 'red' | 'amber'> = {
  'unmatched-scene': 'red',
  'estimated-timings': 'amber',
  'weak-match': 'amber',
  'too-dense': 'amber',
  'script-audio-mismatch': 'red',
  'no-media': 'amber',
  'offline-media': 'red',
  'model-missing': 'red',
  'language-pack-missing': 'red',
  'sync-incomplete': 'red',
};

export type DetailsCategory =
  | 'issues'
  | 'adjustments'
  | 'locks'
  | 'tokens'
  | 'recoveries'
  | 'preflight'
  | 'engine'
  | 'imports';

export const DETAILS_ORDER: readonly DetailsCategory[] = [
  'issues', 'adjustments', 'locks', 'tokens', 'recoveries', 'preflight', 'engine', 'imports',
];

export type HeadlineEngine = 'forced-alignment' | 'whisper' | 'character' | 'unknown';

const plural = (n: number, one = '', many = 's'): string => (n === 1 ? one : many);

// ---------------------------------------------------------------------------
// SWAPPABLE COPY BLOCK — every user-facing string of the default view. Copy
// only: nothing below branches on these values.
// ---------------------------------------------------------------------------
export const SYNC_LOG_USER_COPY = {
  headline: {
    engine: {
      'forced-alignment': 'Forced alignment',
      whisper: 'Whisper',
      character: 'Estimated from text (no transcript)',
      unknown: 'Engine not recorded',
    } satisfies Record<HeadlineEngine, string>,
    matched: (matched: number, total: number): string => `${matched}/${total} scenes matched`,
    placeholders: (n: number): string => `${n} placeholder${plural(n)}`,
    estimated: (n: number): string => `${n} estimated`,
    noRun: 'No sync run yet',
  },
  attention: {
    'unmatched-scene': (n: number): string => `${n} scene${plural(n)} not found in the voiceover`,
    'estimated-timings': (): string => 'Some timings are estimated, not measured',
    'weak-match': (n: number): string =>
      `${n} scene${plural(n)} matched less than ${Math.round(WORD_COVERAGE_MIN_RATIO * 100)}% of ${plural(n, 'its', 'their')} words`,
    'too-dense': (n: number): string => `${n} scene${plural(n)} ha${plural(n, 's', 've')} more words than ${plural(n, 'its', 'their')} audio can hold`,
    'script-audio-mismatch': (): string => "The script and voiceover don't look like a matching pair",
    'no-media': (n: number): string => `${n} scene${plural(n)} ha${plural(n, 's', 've')} no media`,
    'offline-media': (n: number): string => `${n} media file${plural(n)} offline — relink to restore`,
    'model-missing': (): string => 'A required model is missing or damaged',
    'language-pack-missing': (): string => "No language pack for this project's language",
    'sync-incomplete': (): string => "Sync didn't finish — the timeline was not updated",
  } satisfies Record<AttentionKind, (n: number) => string>,
  status: {
    clear: 'All clear — nothing needs your attention.',
    attention: (n: number): string => `${n} item${plural(n)} need${plural(n, 's', '')} your attention`,
  },
  details: (n: number): string => `Details (${n} event${plural(n)})`,
  categories: {
    issues: 'issues',
    adjustments: 'adjustments',
    locks: 'locks',
    tokens: 'tokens filtered',
    recoveries: 'recoveries',
    preflight: 'preflight',
    engine: 'engine notes',
    imports: 'imports',
  } satisfies Record<DetailsCategory, string>,
  jumpToScene: 'Jump to scene',
  manageModels: 'Manage models & add-ons →',
} as const;

// ---------------------------------------------------------------------------
// CLASSIFICATION
// ---------------------------------------------------------------------------

/** WPM warnings are recognised by their fix hint — constant per band
 *  regardless of the measured rate, so a dummy result recovers each one. */
const WPM_FIX_HINTS: ReadonlySet<string> = new Set(
  Object.values(WPM_CHECK_COPY).map(f => f({ wpm: 0, band: 'normal', totalWords: 0, audioDurationSec: 0 }).fixHint),
);

/** `buildCharacterTimingEntry`'s unexpected-fallback wording — legacy text
 *  matching only (see `findingOf`). */
const CHARACTER_FALLBACK_PREFIX = 'Sync completed on character-based timing';

/** `buildFreezeFrameEntries` (App.tsx) — legacy text matching only. */
const FREEZE_FRAME_MARKER = 'the final frame will hold';

/**
 * WHAT AN ENTRY IS, for the generic 'warning'/'info' types. Builders stamp
 * `entry.finding` at build time (pre-landing closeout Item 1), and when it is
 * present it is the ONLY input — display text is never consulted, so a copy
 * edit cannot reclassify anything.
 *
 * LEGACY FALLBACK: an entry persisted before `finding` existed has none, and
 * is recognised by the text matching this view used before the field (fix
 * hints, message prefixes, `owningRule`, the counts in its prose), so old
 * logs still classify. New entries never take this path.
 */
function findingOf(entry: SyncLogEntry): { kind: SyncLogFindingKind; count?: number } | undefined {
  if (entry.finding) return entry.finding;
  if (entry.type !== 'warning' && entry.type !== 'info') return undefined;
  const hint = entry.fixHint;
  if (hint === WORD_COVERAGE_FIX_HINT) return { kind: 'weak-match' };
  if (hint === SCENE_DENSITY_FIX_HINT) return { kind: 'scene-density' };
  if (hint !== undefined && WPM_FIX_HINTS.has(hint)) return { kind: 'wpm' };
  if (hint === LOCAL_COVERAGE_FIX_HINT) return { kind: 'local-coverage' };
  if (hint === BUNDLE_IMPORT_FAILED_FIX_HINT) return { kind: 'bundle-import-failed' };
  if (entry.type === 'warning' && entry.owningRule === 'FA') {
    const victims = leadingInt(entry.ruleDetail?.reason, /^(\d+) FA victim/);
    return victims !== undefined ? { kind: 'fa-victim-retimed', count: victims } : { kind: 'ctc-infeasible' };
  }
  const placed = leadingInt(entry.message, /(\d+) segment\(s\) placed/);
  if (entry.type === 'warning' && entry.message.startsWith(CHARACTER_FALLBACK_PREFIX)) return { kind: 'character-fallback', count: placed };
  if (entry.message.includes('character-based timing')) return { kind: 'engine-character', count: placed };
  if (entry.message.includes(FREEZE_FRAME_MARKER)) return { kind: 'freeze-frame' };
  if (entry.message.startsWith('Timing engine: forced alignment')) return { kind: 'engine-forced-alignment' };
  if (entry.message.startsWith('Timing engine: Whisper')) return { kind: 'engine-whisper' };
  return undefined;
}

/** Finding → attention kind (undefined = details only). Exhaustive. */
const FINDING_ATTENTION: Record<SyncLogFindingKind, AttentionKind | undefined> = {
  'ctc-infeasible': 'estimated-timings',
  'fa-victim-retimed': 'estimated-timings',
  'character-fallback': 'estimated-timings',
  'scene-density': 'too-dense',
  'weak-match': 'weak-match',
  wpm: 'script-audio-mismatch',
  'local-coverage': 'script-audio-mismatch',
  'bundle-import-failed': undefined,
  'freeze-frame': undefined,
  'engine-forced-alignment': undefined,
  'engine-whisper': undefined,
  'engine-character': undefined,
};

/** The ten-kind mapping for ONE entry, independent of when it was logged.
 *  `undefined` = no attention role (a details counter only). */
export function attentionKindForEntry(entry: SyncLogEntry): AttentionKind | undefined {
  switch (entry.type) {
    case 'skip':
      return 'unmatched-scene';
    case 'no-asset':
      return 'no-media';
    case 'abort':
      return 'sync-incomplete';
    case 'whisper-model-failure':
      return 'model-missing';
    case 'unsupported-language':
      return 'language-pack-missing';
    case 'fa-paused':
      // An unanswered pause is the run not finishing; its reason decides
      // which kind the user must act on. (Answered pauses never reach the
      // attention window — see the file header.)
      switch (entry.reason) {
        case 'model-not-found':
        case 'model-hash-mismatch':
          return 'model-missing';
        case 'unsupported-language':
          return 'language-pack-missing';
        case 'hopeless-local-coverage':
          return 'script-audio-mismatch';
        default:
          return 'sync-incomplete';
      }
    case 'fa-gate-closed':
      // `buildFaUserChoseWhisperEntry` is the only producer that sets
      // `reason`: the user answered a pause by taking Whisper timing.
      return entry.reason !== undefined ? 'estimated-timings' : undefined;
    case 'warning':
    case 'info': {
      const finding = findingOf(entry);
      return finding ? FINDING_ATTENTION[finding.kind] : undefined;
    }
    case 'silence-error':
    case 'malformed-token':
    case 'rescue':
    case 'lock-span-overflow':
    case 'lock-preserved-adjustment':
    case 'lock-refused':
    case 'lock-not-restored':
    case 'rule-correction':
    case 'fa-preflight':
    case 'media-import':
      return undefined;
  }
}

/** The details-count bucket for an entry with no attention role. Replaces
 *  the six-group `syncLogGroupForType`: exhaustive over the union, so a new
 *  entry type without a bucket is a compile error. */
function detailsCategoryForUnflagged(entry: SyncLogEntry): DetailsCategory {
  switch (entry.type) {
    case 'rule-correction':
      return 'adjustments';
    case 'lock-span-overflow':
    case 'lock-preserved-adjustment':
    case 'lock-refused':
    case 'lock-not-restored':
      return 'locks';
    case 'malformed-token':
      return 'tokens';
    case 'rescue':
      return 'recoveries';
    case 'fa-preflight':
    case 'fa-gate-closed':
      return 'preflight';
    case 'media-import':
      return 'imports';
    case 'warning': {
      const kind = findingOf(entry)?.kind;
      if (kind === 'bundle-import-failed') return 'imports';
      if (entry.owningRule === 'R-AP' || kind === 'freeze-frame') return 'adjustments';
      return 'engine';
    }
    case 'info':
    case 'silence-error':
    case 'fa-paused':
    case 'skip':
    case 'abort':
    case 'no-asset':
    case 'unsupported-language':
    case 'whisper-model-failure':
      return 'engine';
  }
}

// ---------------------------------------------------------------------------
// VIEW MODEL
// ---------------------------------------------------------------------------

export interface AttentionItem {
  text: string;
  /** Committed segment to deep-link to, when the item names one. */
  segmentId?: string;
  /** Grouped per-scene findings (weak match, density) carry no segment id —
   *  only the validator's own 0-based index into the survivors it checked
   *  and a truncated text preview (`ContractViolation.detail`). Resolved to
   *  a live segment id at render time by `resolveAttentionItemSegmentId`. */
  sceneRef?: { index?: number; name?: string };
}

export interface AttentionLine {
  kind: AttentionKind;
  tone: 'red' | 'amber';
  count: number;
  summary: string;
  items: AttentionItem[];
  /** True when ManageModelsModal can fix it (kind 8). */
  offerManageModels: boolean;
}

export interface SyncLogHeadline {
  hasRun: boolean;
  engine: HeadlineEngine;
  matched?: number;
  total?: number;
  placeholders: number;
  estimated: number;
  timestamp?: number;
}

export interface SyncLogUserView {
  headline: SyncLogHeadline;
  /** Stable per-run key for dismissals: a dismissed line stays dismissed for
   *  THIS run and comes back when a new run (new window) raises it again. */
  windowKey: string;
  attention: AttentionLine[];
  details: {
    total: number;
    counts: { category: DetailsCategory; count: number; entries: SyncLogEntry[] }[];
  };
}

/** "S{n}" / "S{n} / Clip {n}" — the skip line's two numbering spaces (see
 *  `SyncLogEntry.absorbedByDisplayIndex`). Shared with the raw renderer. */
export function skipEntryLabel(entry: SyncLogEntry): string {
  const s = `S${(entry.segmentIndex ?? 0) + 1}`;
  return entry.absorbedByDisplayIndex !== undefined ? `${s} / Clip ${entry.absorbedByDisplayIndex + 1}` : s;
}

/** Drops entries whose type this build no longer knows (the retired
 *  'fa-fallback', or anything malformed) so an old project renders instead
 *  of crashing. The loader applies the same filter (`projectStore.ts`). */
export function knownSyncLogEntries(log: readonly SyncLogEntry[]): SyncLogEntry[] {
  return log.filter(e => !!e && typeof e === 'object' && isKnownSyncLogEntryType(e.type));
}

/** A run's own entries, for a log with no run summaries to window by: an
 *  abort, a pause, an engine line (by finding), or — legacy — the run's
 *  "Sync completed" info line. */
function isRunMarker(entry: SyncLogEntry): boolean {
  if (entry.type === 'abort' || entry.type === 'fa-paused') return true;
  const kind = findingOf(entry)?.kind;
  if (kind === 'engine-forced-alignment' || kind === 'engine-whisper' || kind === 'engine-character' || kind === 'character-fallback') return true;
  return entry.type === 'info' && entry.message.startsWith('Sync completed');
}

function leadingInt(text: string | undefined, pattern: RegExp): number | undefined {
  const m = text ? pattern.exec(text) : null;
  return m ? Number(m[1]) : undefined;
}

function engineOf(entries: readonly SyncLogEntry[]): HeadlineEngine {
  for (const e of entries) {
    switch (findingOf(e)?.kind) {
      case 'engine-forced-alignment': return 'forced-alignment';
      case 'engine-whisper': return 'whisper';
      case 'engine-character':
      case 'character-fallback': return 'character';
      default: break;
    }
  }
  return 'unknown';
}

function itemsFor(entry: SyncLogEntry): AttentionItem[] {
  if (entry.type === 'skip') {
    const tag = entry.segmentTag ? `[${entry.segmentTag}] ` : '';
    return [{ text: `${skipEntryLabel(entry)}: ${tag}${entry.segmentText ?? ''}`.trim(), segmentId: entry.segmentId }];
  }
  if (entry.groupedItems && entry.groupedItems.length > 0) {
    return entry.groupedItems.map(i => {
      const index = typeof i.detail?.segmentIndex === 'number' ? i.detail.segmentIndex : undefined;
      const name = typeof i.detail?.segmentName === 'string' ? i.detail.segmentName : undefined;
      return index !== undefined || name !== undefined ? { text: i.message, sceneRef: { index, name } } : { text: i.message };
    });
  }
  const sceneRef = sceneRefFromMessage(entry.message);
  return [{
    text: entry.fixHint ? `${entry.message} ${entry.fixHint}` : entry.message,
    segmentId: entry.segmentId,
    ...(sceneRef ? { sceneRef } : {}),
  }];
}

/** A LONE per-scene violation is logged ungrouped (`buildGroupedViolationEntry`'s
 *  count===1 path keeps no `detail`), so its scene survives only in the
 *  validators' fixed message shape `Segment N ("preview") …`
 *  (`syncContracts.ts`). Read back from there; `resolveAttentionItemSegmentId`
 *  still verifies it against the scene's own text before any jump. */
function sceneRefFromMessage(message: string): { index: number; name: string } | undefined {
  const m = /^Segment (\d+) \("(.*?)"\)/.exec(message);
  return m ? { index: Number(m[1]) - 1, name: m[2]! } : undefined;
}

function countFor(kind: AttentionKind, entry: SyncLogEntry): number {
  if (kind === 'no-media') return leadingInt(entry.message, /No asset available for (\d+) of/) ?? 1;
  if (entry.groupedItems && entry.groupedItems.length > 0) return entry.groupedItems.length;
  return 1;
}

export function buildSyncLogUserView(
  syncLog: readonly SyncLogEntry[],
  syncRunSummaries: readonly SyncRunSummary[] = [],
  offlineAssetNames: readonly string[] = [],
): SyncLogUserView {
  const log = knownSyncLogEntries(syncLog);

  // The latest run: its summary when one exists (every committed, aborted
  // and paused run writes one), else the newest run-marker entry — a
  // project whose summaries were pruned or never written still gets a window.
  const latestSummary = syncRunSummaries.reduce<SyncRunSummary | undefined>(
    (best, s) => (!best || s.timestamp >= best.timestamp ? s : best), undefined,
  );
  const markerStart = log.filter(isRunMarker).reduce<number | undefined>(
    (max, e) => (max === undefined || e.timestamp > max ? e.timestamp : max), undefined,
  );
  const windowStart = latestSummary?.timestamp ?? markerStart;
  const inWindow = (e: SyncLogEntry): boolean => windowStart === undefined || e.timestamp >= windowStart;
  const windowed = log.filter(inWindow);

  // --- attention ---
  const byKind = new Map<AttentionKind, { count: number; items: AttentionItem[] }>();
  const add = (kind: AttentionKind, count: number, items: AttentionItem[]): void => {
    const acc = byKind.get(kind) ?? { count: 0, items: [] };
    acc.count += count;
    acc.items.push(...items);
    byKind.set(kind, acc);
  };
  for (const entry of windowed) {
    const kind = attentionKindForEntry(entry);
    if (kind) add(kind, countFor(kind, entry), itemsFor(entry));
  }
  if (offlineAssetNames.length > 0) {
    add('offline-media', offlineAssetNames.length, offlineAssetNames.map(name => ({ text: name })));
  }
  const attention: AttentionLine[] = ATTENTION_ORDER.flatMap(kind => {
    const acc = byKind.get(kind);
    if (!acc) return [];
    return [{
      kind,
      tone: ATTENTION_TONE[kind],
      count: acc.count,
      summary: SYNC_LOG_USER_COPY.attention[kind](acc.count),
      items: acc.items,
      offerManageModels: kind === 'model-missing',
    }];
  });

  // --- headline ---
  const hasRun = windowStart !== undefined;
  const infoLine = windowed.find(e => e.type === 'info' && e.message.startsWith('Sync completed:'));
  const placeholders = windowed.filter(e => e.type === 'skip' && e.ruleDetail?.spanStartSec !== undefined).length;
  let estimated = 0;
  for (const e of windowed) {
    const finding = findingOf(e);
    if (finding?.kind === 'fa-victim-retimed' || finding?.kind === 'character-fallback') estimated += finding.count ?? 0;
  }
  const headline: SyncLogHeadline = {
    hasRun,
    engine: engineOf(windowed),
    matched: latestSummary?.coveredSegments ?? leadingInt(infoLine?.message, /(\d+) of \d+ segments matched/),
    total: latestSummary?.totalSegments ?? leadingInt(infoLine?.message, /\d+ of (\d+) segments matched/),
    placeholders,
    estimated,
    timestamp: windowStart,
  };

  // --- details (whole log, newest first) ---
  const buckets = new Map<DetailsCategory, SyncLogEntry[]>();
  for (const entry of [...log].reverse()) {
    const kind = attentionKindForEntry(entry);
    const answeredPause = entry.type === 'fa-paused' && !inWindow(entry);
    const category = kind && !answeredPause ? 'issues' : detailsCategoryForUnflagged(entry);
    const bucket = buckets.get(category);
    if (bucket) bucket.push(entry); else buckets.set(category, [entry]);
  }
  const counts = DETAILS_ORDER.flatMap(category => {
    const entries = buckets.get(category);
    return entries ? [{ category, count: entries.length, entries }] : [];
  });

  return { headline, windowKey: String(windowStart ?? 'all'), attention, details: { total: log.length, counts } };
}

/** Strips the validators' display truncation (`truncateForDisplay`'s trailing
 *  ellipsis) and surrounding whitespace so a preview can prefix-match. */
function namePrefix(name: string): string {
  return name.replace(/(\.\.\.|…)$/, '').trim();
}

/**
 * The segment an attention item should jump to, or `undefined` when it
 * cannot be resolved with confidence — then the item renders as plain text,
 * never as a jump to a guessed scene.
 *
 * `sceneRef.index` is the validator's index into the survivors it checked,
 * which can drift from the live timeline (a placeholder re-inserted after
 * validation shifts every later clip), so the index is only trusted when
 * that segment's text agrees with the preview; otherwise the first segment
 * whose text starts with the preview wins.
 */
export function resolveAttentionItemSegmentId(
  item: AttentionItem,
  segments: readonly { id: string; text?: string }[],
): string | undefined {
  if (item.segmentId) return item.segmentId;
  const ref = item.sceneRef;
  if (!ref) return undefined;
  const prefix = ref.name ? namePrefix(ref.name) : '';
  const matches = (s: { text?: string } | undefined): boolean =>
    !!s && prefix.length > 0 && (s.text ?? '').trim().startsWith(prefix);
  if (ref.index !== undefined) {
    const atIndex = segments[ref.index];
    if (atIndex && (prefix.length === 0 || matches(atIndex))) return atIndex.id;
  }
  return segments.find(matches)?.id;
}
