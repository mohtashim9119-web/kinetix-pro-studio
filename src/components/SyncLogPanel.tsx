// src/components/SyncLogPanel.tsx
// WS-logs — the persistent sync-log panel (right panel, App.tsx).
//
// Pure presentation: it renders Project.syncLog and calls back to clear it. All
// writes go through appendSyncLogEntries (services/syncLog.ts) / clearSyncLog
// (App.tsx), so this file holds no log policy and no persistence of its own —
// the log rides along on the Project blob the existing projectStore already saves.
import React, { useState } from 'react';
import { ChevronDown, ChevronRight, Trash2, Copy, X } from 'lucide-react';
import type { SyncLogEntry, SyncLogEntryType, SyncRunSummary } from '../types';
import { SKIPPED_SCENE_COPY } from '../services/skippedScenePlaceholders';
import {
  buildSyncLogUserView,
  resolveAttentionItemSegmentId,
  skipEntryLabel,
  SYNC_LOG_USER_COPY,
  type AttentionLine,
  type SyncLogHeadline,
} from '../services/syncLogUserView';

// Operator ruling (sync-log user view) — the default view is headline +
// attention list + one collapsed Details line (services/syncLogUserView.ts
// decides WHAT goes where; this file only draws it). The raw per-entry cards
// with their type badges survive unchanged, one level down inside Details.

/** Which user-view sections are OPEN, session-persisted (sessionStorage, not
 *  the project file — a UI display preference, not project state), the same
 *  pattern the six-group UI used. Ids: 'details', 'details:<category>',
 *  'attention:<kind>'. Absent = closed, so a fresh session shows the calm
 *  default: attention lines folded, Details folded. */
const OPEN_SECTIONS_STORAGE_KEY = 'kx-sync-log-open-sections';

function readStoredOpenSections(): Set<string> {
  try {
    const raw = sessionStorage.getItem(OPEN_SECTIONS_STORAGE_KEY);
    if (!raw) return new Set();
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? new Set(parsed.filter((v): v is string => typeof v === 'string')) : new Set();
  } catch {
    return new Set(); // sessionStorage unavailable (private mode, SSR, etc.)
  }
}

function writeStoredOpenSections(sections: Set<string>): void {
  try {
    sessionStorage.setItem(OPEN_SECTIONS_STORAGE_KEY, JSON.stringify([...sections]));
  } catch {
    // sessionStorage unavailable — the choice just doesn't outlive this render
  }
}

/** Attention lines the user dismissed, as `${kind}@${windowKey}` — scoped to
 *  the run that raised them, so the same kind reappears when a NEW run raises
 *  it again. localStorage (outlives a restart): a dismissal is a statement
 *  about this run, not a per-session view toggle. Hides the line only — the
 *  log entries themselves stay recorded and reachable under Details. */
const DISMISSED_STORAGE_KEY = 'kx-sync-log-dismissed';
const DISMISSED_CAP = 200;

function readStoredDismissed(): Set<string> {
  try {
    const raw = localStorage.getItem(DISMISSED_STORAGE_KEY);
    if (!raw) return new Set();
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? new Set(parsed.filter((v): v is string => typeof v === 'string')) : new Set();
  } catch {
    return new Set();
  }
}

function writeStoredDismissed(keys: Set<string>): void {
  try {
    localStorage.setItem(DISMISSED_STORAGE_KEY, JSON.stringify([...keys].slice(-DISMISSED_CAP)));
  } catch {
    // storage unavailable — the dismissal just doesn't outlive this mount
  }
}

interface Props {
  syncLog: SyncLogEntry[];
  /** `project.syncRunSummaries` — locates the latest run (the attention
   *  window) and supplies the headline's N/N. Optional: without it the view
   *  falls back to the log's own run markers. */
  syncRunSummaries?: SyncRunSummary[];
  /** Names of the project's assets currently offline (`Asset.unresolved`) —
   *  attention kind 7. Live project state, not a log entry. */
  offlineAssetNames?: string[];
  /** The live timeline (`project.segments`), used only to resolve a grouped
   *  finding's scene to a jump target (`resolveAttentionItemSegmentId`). */
  segments?: { id: string; text?: string }[];
  onClearLog: () => void;
  /** WS2 Step 12 (A3) — opens ManageModelsModal. Optional so a caller that
   *  has no model UI wired (e.g. a future embedding) can omit it; the
   *  deep-link button below simply doesn't render without it. */
  onOpenModelsModal?: () => void;
  /** WS2 T2.1 — deep-links the playhead to the COMMITTED segment named by an
   *  entry's `segmentId` (e.g. the neighbour that absorbed a dropped scene's
   *  gap). Optional so a caller with no seek wiring can omit it; the
   *  deep-link control below simply doesn't render without it. */
  onSeekToSegment?: (segmentId: string) => void;
}

/** True when an fa-preflight/fa-paused entry's own detail names a missing
 *  FA model — the one blocking cause ManageModelsModal can actually fix.
 *  Text-matched against `fa.rs::no_model_found_error`'s verbatim message
 *  ("No FA model found for language ...") rather than a new typed field,
 *  since that string is already the log's source of truth for this cause. */
function isMissingModelDetail(detail: string | undefined): boolean {
  return !!detail && detail.includes('No FA model found');
}

/** Type → badge label + colors. Kept as one table so a new SyncLogEntryType is
 *  a compile error here rather than an unstyled badge at runtime. */
const TYPE_STYLES: Record<SyncLogEntryType, { label: string; className: string }> = {
  skip: { label: 'SKIP', className: 'bg-yellow-500/10 text-yellow-400 border-yellow-500/30' },
  abort: { label: 'ABORT', className: 'bg-red-500/10 text-red-400 border-red-500/30' },
  warning: { label: 'WARN', className: 'bg-orange-500/10 text-orange-400 border-orange-500/30' },
  info: { label: 'INFO', className: 'bg-zinc-500/10 text-zinc-400 border-zinc-500/30' },
  // WS4 Feature 3 — red: a real degradation of every boundary in the run.
  'silence-error': { label: 'SILENCE', className: 'bg-red-500/10 text-red-400 border-red-500/30' },
  // WS4 Feature 4 — blue/info: the bad tokens were caught and removed, and the
  // sync proceeded normally. Deliberately NOT an error colour.
  'malformed-token': { label: 'TOKENS', className: 'bg-blue-500/10 text-blue-400 border-blue-500/30' },
  'no-asset': { label: 'NO ASSET', className: 'bg-orange-500/10 text-orange-400 border-orange-500/30' },
  // Rescue observability (false-positive rescue fix, 2026-07-31) — gray/info:
  // this is the same rescue mechanism (WS6) that has always existed, now
  // surfaced to the user, not a new error or degradation.
  rescue: { label: 'RESCUE', className: 'bg-zinc-500/10 text-zinc-400 border-zinc-500/30' },
  // Phase 2a H.4 guard — red: outside the five verified languages, sync
  // accuracy is unguaranteed, not merely degraded.
  'unsupported-language': { label: 'LANGUAGE', className: 'bg-red-500/10 text-red-400 border-red-500/30' },
  // K14 fix (decision 9 / Step AB) — a locked span couldn't hold its (or its
  // trapped neighbour's) content even at the minimum slot. Warning, matching
  // the existing unscripted-gap/monotonic-clamp precedent.
  'lock-span-overflow': { label: 'LOCK OVERFLOW', className: 'bg-orange-500/10 text-orange-400 border-orange-500/30' },
  // K14 fix — a lock's hard wall bounded an unlocked neighbour's placement.
  // Informational: the output is correct, just worth knowing why a boundary
  // landed where it did.
  'lock-preserved-adjustment': { label: 'LOCK', className: 'bg-zinc-500/10 text-zinc-400 border-zinc-500/30' },
  // Model P ruling §4.1(a) — a lock toggle was REFUSED (it would have left an
  // unassignable span between two adjacent locks). Warning, not error: the
  // user's project is in a perfectly valid state, their requested action just
  // wasn't granted. Amber matches the other "we declined / we adjusted"
  // lock surfaces above rather than the red reserved for real failures.
  'lock-refused': { label: 'LOCK REFUSED', className: 'bg-amber-500/10 text-amber-400 border-amber-500/30' },
  // K13 fix — a lock that existed BEFORE this Apply Sync could not be carried
  // into the freshly-synced timeline (unmatched, or its saved position no
  // longer fits). Amber matches lock-refused: the user's project is in a
  // valid state, their earlier lock just wasn't honoured this time.
  'lock-not-restored': { label: 'LOCK NOT RESTORED', className: 'bg-amber-500/10 text-amber-400 border-amber-500/30' },
  // WS1 Session J — a post-inference rule (R.5/R.10/R.11/R.12) corrected this
  // run. Blue/info, matching 'malformed-token': the pipeline caught something
  // and fixed it, which is the system working rather than degrading. The badge
  // is intentionally generic; the entry's own `owningRule` names which rule,
  // and the message leads with it.
  'rule-correction': { label: 'RULE', className: 'bg-blue-500/10 text-blue-400 border-blue-500/30' },
  // plan-v3 items 3/4 — the run STOPPED and is waiting on the user
  // (SyncPausedDialog), not a silent Whisper substitution. Purple: distinct
  // from both the orange warn badges and the red 'abort' badge —
  // this is neither a quiet degradation nor a dead run, it is a question.
  'fa-paused': { label: 'FA PAUSED', className: 'bg-purple-500/10 text-purple-400 border-purple-500/30' },
  // WS1 Session M — the FA readiness pre-flight. Neutral badge; the entry's own
  // severity (info when ready, warning when not) and detail line carry the
  // meaning. Emitted before inference so the user sees readiness up front.
  'fa-preflight': { label: 'FA PRE-FLIGHT', className: 'bg-cyan-500/10 text-cyan-400 border-cyan-500/30' },
  // WS2 Step 3 A5 — the FA gate was closed for this run (bug 2 visibility
  // fix). Neutral/info, matching 'fa-preflight': nothing is wrong, the user
  // just may not know high-precision sync is available to turn on.
  'fa-gate-closed': { label: 'FA OFF', className: 'bg-cyan-500/10 text-cyan-400 border-cyan-500/30' },
  // Wave 1 hotfix — a fresh transcription attempt halted on a typed Whisper
  // model-integrity failure (WhisperModelFailureDialog's log counterpart).
  // Red, matching 'silence-error'/'unsupported-language': transcription did
  // not run, not a degradation the pipeline absorbed.
  'whisper-model-failure': { label: 'WHISPER MODEL', className: 'bg-red-500/10 text-red-400 border-red-500/30' },
  // G6 Step 4 — emerald, a fresh color in this table: a media-vault ingest is
  // its own kind of event (not tied to an Apply Sync run), and none of the
  // existing categories (FA cyan/purple, lock amber, rule blue, error red)
  // fit "here's what happened when you added media."
  'media-import': { label: 'MEDIA', className: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30' },
  // Media workflow Units 1-2 — same emerald family as 'media-import': a
  // Media-block event, not a sync-run outcome.
  'media-match': { label: 'MATCH', className: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30' },
};

/** HH:MM:SS — entries within one run are seconds apart, so the date would be
 *  noise. Falls back to an em dash on an unparseable timestamp. */
function formatTime(timestamp: number): string {
  const d = new Date(timestamp);
  if (Number.isNaN(d.getTime())) return '—';
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

/** Line 3 of a skip entry — "matched X of Y words (confidence Z.ZZ)", or the
 *  no-content variant when the segment had nothing to match. `undefined` when
 *  any of matchedWords/totalWords/confidence is missing (older entries,
 *  logged before these fields existed, OR — WS2 ws2-25 Commit 5 — an R.10
 *  skip, where App.tsx withholds all three: they'd be FA's own forced-
 *  placement rerun stats, not evidence the audio was heard) — the caller
 *  omits the line entirely in that case.
 *
 *  `longestRun` (Bug C, consecutive-run survival requirement, 2026-08-02) is
 *  appended as ", longest run N" when present — display-only, no threshold
 *  logic here — and simply omitted when absent (older entries), same as the
 *  other optional fields. WS2 ws2-25 Commit 5 — when it EXCEEDS matchedWords,
 *  a short parenthetical explains why: `computeLongestRunWithHoles`
 *  (whisperService.ts:595) counts every position a run SPANS, including up
 *  to 2 bridged holes, not just the positions actually matched — without
 *  this, "longest run 9" beside "matched 7 of 9" reads as an impossible
 *  number rather than the documented, intentional hole-bridging it is. */
function formatMatchLine(
  matchedWords: number | undefined,
  totalWords: number | undefined,
  confidence: number | undefined,
  longestRun: number | undefined,
): string | undefined {
  if (matchedWords === undefined || totalWords === undefined || confidence === undefined) {
    return undefined;
  }
  const bridged = longestRun !== undefined && longestRun > matchedWords;
  const runSuffix = longestRun !== undefined
    ? `, longest run ${longestRun}${bridged ? ' (spans up to 2 bridged holes, not just matches)' : ''}`
    : '';
  if (totalWords === 0) {
    return `matched 0 of 0 words (no content to match)${runSuffix}`;
  }
  return `matched ${matchedWords} of ${totalWords} words (confidence ${confidence.toFixed(2)})${runSuffix}`;
}

// `skipEntryLabel` (the "S{n}" / "S{n} / Clip {n}" skip-line label) lives in
// syncLogUserView.ts now — the attention list's unmatched-scene items use it
// too, so the two surfaces can never number a scene differently.

/** The optional second line for WS4's run-level entries. Every field access is
 *  defensive: an entry persisted before WS4 carries none of them, and must
 *  render as a plain message line rather than crashing or printing
 *  "undefined". Returns undefined when there is nothing extra to say. */
function formatDetailLine(entry: SyncLogEntry): string | undefined {
  if (entry.type === 'silence-error') {
    const reason = entry.errorMessage?.trim();
    return reason ? `reason: ${reason}` : undefined;
  }
  if (entry.type === 'malformed-token') {
    const skipped = entry.skippedTokenCount;
    const total = entry.totalTokenCount;
    if (skipped === undefined || total === undefined) return undefined;
    return `${skipped} of ${total} tokens had invalid timestamps`;
  }
  // WS1 Session M — the FA pause's underlying error, surfaced (the retired
  // 'fa-fallback' entry used to land this only on stderr). `errorMessage` is
  // the raw backend text; `fixHint` is the actionable next step. Both
  // defended for entries that carry neither.
  if (entry.type === 'fa-paused') {
    const detail = entry.errorMessage?.trim();
    const fix = entry.fixHint?.trim();
    const parts: string[] = [];
    if (detail) parts.push(`error: ${detail}`);
    if (fix) parts.push(fix);
    return parts.length > 0 ? parts.join(' — ') : undefined;
  }
  // WS1 Session M — the pre-flight's own detail: the first blocking cause
  // (verbatim runtime/model text in `errorMessage`) plus the action (`fixHint`)
  // when NOT ready; the readiness summary otherwise already lives in `message`.
  if (entry.type === 'fa-preflight') {
    const detail = entry.errorMessage?.trim();
    const fix = entry.fixHint?.trim();
    const parts: string[] = [];
    if (detail) parts.push(detail);
    if (fix) parts.push(fix);
    return parts.length > 0 ? parts.join(' — ') : undefined;
  }
  // WS2 Step 3 A5 — the gate-closed entry's action (`fixHint`); the summary
  // already lives in `message`.
  if (entry.type === 'fa-gate-closed') {
    return entry.fixHint?.trim() || undefined;
  }
  return undefined;
}

/** Renders one entry exactly as the panel displays it — reused by the Copy
 *  button so the copied text can never drift from what's on screen. A
 *  grouped entry (`groupedItems` set, log-grouping feature 2026-08-03) always
 *  exports its summary line PLUS every item's own message — the Copy button
 *  must never drop items behind the panel's own collapse-by-default UI. */
export function formatEntryText(entry: SyncLogEntry): string {
  const label = (TYPE_STYLES[entry.type] ?? TYPE_STYLES.info).label;
  const header = `[${formatTime(entry.timestamp)}] [${label}]`;
  const isSkip = entry.type === 'skip' && entry.segmentIndex !== undefined;

  if (isSkip) {
    const lines = [`${header} ${skipEntryLabel(entry)}: ${SKIPPED_SCENE_COPY.label} — ${entry.reason ?? 'no text match'}`];
    if (entry.segmentText) {
      const tag = entry.segmentTag ? `[${entry.segmentTag}] ` : '';
      lines.push(`${tag}${entry.segmentText}`);
    }
    const matchLine = formatMatchLine(entry.matchedWords, entry.totalWords, entry.confidence, entry.longestRun);
    if (matchLine) lines.push(matchLine);
    return lines.join('\n');
  }

  const lines = [`${header} ${entry.message}`];
  const detailLine = formatDetailLine(entry);
  if (detailLine) lines.push(detailLine);
  if (entry.segmentText) {
    const scenePrefix = entry.segmentIndex !== undefined ? `Scene ${entry.segmentIndex + 1}: ` : '';
    lines.push(`${scenePrefix}"${entry.segmentText}"`);
  }
  if (entry.groupedItems && entry.groupedItems.length > 0) {
    for (const item of entry.groupedItems) lines.push(`  - ${item.message}`);
  }
  return lines.join('\n');
}

interface RawEntryProps {
  entry: SyncLogEntry;
  expanded: boolean;
  onToggleExpanded: (id: string) => void;
  onOpenModelsModal?: () => void;
  onSeekToSegment?: (segmentId: string) => void;
}

/** One raw log entry — timestamp, type badge, and its type-specific body —
 *  exactly as the flat list rendered it before the user view existed. Now
 *  reached through Details ▸ category; the badge zoo lives only here. */
export function SyncLogRawEntry({
  entry, expanded, onToggleExpanded, onOpenModelsModal, onSeekToSegment,
}: RawEntryProps): React.ReactElement {
  const style = TYPE_STYLES[entry.type] ?? TYPE_STYLES.info;
  // Skip entries get a dedicated 3-line layout (segment number +
  // reason, tag + text preview, match-count detail) instead of the
  // generic message line — built from the entry's own fields
  // rather than `message` so it renders the same regardless of
  // which wording an older persisted entry's message happens to
  // carry. Line 3 (match-count) is omitted for entries logged
  // before those fields existed (backward compat).
  const isSkip = entry.type === 'skip' && entry.segmentIndex !== undefined;
  const matchLine = isSkip
    ? formatMatchLine(entry.matchedWords, entry.totalWords, entry.confidence, entry.longestRun)
    : undefined;
  // WS4 — run-level entries (silence-error / malformed-token) use
  // the generic branch below plus one optional detail line.
  const detailLine = isSkip ? undefined : formatDetailLine(entry);
  // Log-grouping feature (2026-08-03) — a grouped entry renders
  // its summary (entry.message) collapsed by default, with an
  // expand affordance revealing one line per underlying
  // violation. Mutually exclusive with the skip layout above
  // (a grouped entry is never also a skip entry).
  const isGrouped = !isSkip && (entry.groupedItems?.length ?? 0) > 0;
  return (
    <div data-testid="sync-log-raw-entry" className="py-2">
      <div className="flex items-center gap-2">
        <span className="text-[11px] font-mono text-gray-600 flex-shrink-0">
          {formatTime(entry.timestamp)}
        </span>
        <span
          className={`text-[10px] font-black uppercase tracking-wider px-1.5 py-0.5 rounded border flex-shrink-0 ${style.className}`}
        >
          {style.label}
        </span>
      </div>
      {isSkip ? (
        <>
          <p className="text-xs text-gray-300 mt-1 leading-snug break-words">
            {skipEntryLabel(entry)}: {SKIPPED_SCENE_COPY.label} — {entry.reason ?? 'no text match'}
          </p>
          {entry.segmentText && (
            <p className="text-[11px] text-gray-500 mt-0.5 leading-snug break-words">
              {entry.segmentTag && (
                <span className="font-mono text-gray-400">[{entry.segmentTag}] </span>
              )}
              {entry.segmentText}
            </p>
          )}
          {matchLine && (
            <p className="text-[11px] text-gray-600 mt-0.5 leading-snug break-words">
              {matchLine}
            </p>
          )}
          <div className="flex items-center gap-3 mt-0.5">
            {entry.segmentId && onSeekToSegment && (
              <button
                type="button"
                onClick={() => onSeekToSegment(entry.segmentId!)}
                className="text-[11px] text-[#F27D26] hover:text-[#E06A15] leading-snug underline underline-offset-2"
              >
                Jump to absorbing scene
              </button>
            )}
          </div>
        </>
      ) : isGrouped ? (
        <>
          <button
            type="button"
            onClick={() => onToggleExpanded(entry.id)}
            className="w-full flex items-start gap-1 mt-1 text-left"
            aria-expanded={expanded}
          >
            {expanded
              ? <ChevronDown size={12} className="text-gray-600 flex-shrink-0 mt-0.5" />
              : <ChevronRight size={12} className="text-gray-600 flex-shrink-0 mt-0.5" />
            }
            <span className="text-xs text-gray-300 leading-snug break-words">
              {entry.message}
            </span>
          </button>
          {expanded && (
            <div className="mt-1 space-y-1">
              {entry.groupedItems!.map((item, idx) => (
                <p
                  key={idx}
                  className="text-[11px] text-gray-500 leading-snug break-words"
                >
                  {item.message}
                </p>
              ))}
            </div>
          )}
        </>
      ) : (
        <>
          <p className="text-xs text-gray-300 mt-1 leading-snug break-words">
            {entry.message}
          </p>
          {detailLine && (
            <p className="text-[11px] text-gray-600 mt-0.5 leading-snug break-words">
              {detailLine}
            </p>
          )}
          {onOpenModelsModal && isMissingModelDetail(detailLine) && (
            <button
              type="button"
              onClick={onOpenModelsModal}
              className="mt-1 text-[11px] font-bold uppercase tracking-widest text-[#FF7300] hover:underline"
            >
              Manage models &amp; add-ons →
            </button>
          )}
          {entry.segmentText && (
            <p className="text-[11px] text-gray-600 mt-1 italic leading-snug break-words">
              {entry.segmentIndex !== undefined && (
                <span className="not-italic font-bold text-gray-500">
                  Scene {entry.segmentIndex + 1}:{' '}
                </span>
              )}
              &ldquo;{entry.segmentText}&rdquo;
            </p>
          )}
        </>
      )}
    </div>
  );
}

interface RawEntriesProps {
  entries: SyncLogEntry[];
  onOpenModelsModal?: () => void;
  onSeekToSegment?: (segmentId: string) => void;
}

/** A list of raw entries with its own grouped-entry expand state (keyed by
 *  entry id, collapsed by default). */
export function SyncLogRawEntries({ entries, onOpenModelsModal, onSeekToSegment }: RawEntriesProps): React.ReactElement {
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const toggleExpanded = (id: string): void => {
    setExpandedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };
  return (
    <div className="divide-y divide-white/[0.06] border-t border-white/[0.06]">
      {entries.map(entry => (
        <SyncLogRawEntry
          key={entry.id}
          entry={entry}
          expanded={expandedIds.has(entry.id)}
          onToggleExpanded={toggleExpanded}
          onOpenModelsModal={onOpenModelsModal}
          onSeekToSegment={onSeekToSegment}
        />
      ))}
    </div>
  );
}

/** Headline parts, in the ruling's order. Placeholder and estimated counts
 *  are unconditional — printed at zero too — so a degraded run can never
 *  render a headline that reads as clean (the honesty pin). */
export function formatHeadline(headline: SyncLogHeadline): string {
  const copy = SYNC_LOG_USER_COPY.headline;
  if (!headline.hasRun) return copy.noRun;
  const parts: string[] = [copy.engine[headline.engine]];
  if (headline.matched !== undefined && headline.total !== undefined) {
    parts.push(copy.matched(headline.matched, headline.total));
  }
  parts.push(copy.placeholders(headline.placeholders), copy.estimated(headline.estimated));
  if (headline.timestamp !== undefined) parts.push(formatTime(headline.timestamp));
  return parts.join(' · ');
}

const TONE_CLASSES: Record<AttentionLine['tone'], { dot: string; text: string }> = {
  red: { dot: 'bg-red-500', text: 'text-red-400' },
  amber: { dot: 'bg-amber-500', text: 'text-amber-400' },
};

export function SyncLogPanel({
  syncLog, syncRunSummaries, offlineAssetNames, segments = [], onClearLog, onOpenModelsModal, onSeekToSegment,
}: Props): React.ReactElement {
  // Collapsed by default only when there's nothing to show — an empty section
  // shouldn't occupy the panel, but a run that just skipped scenes should be
  // visible without a click. `null` = the user hasn't expressed a preference,
  // so the default tracks the log's live emptiness (a plain
  // useState(syncLog.length === 0) would latch at mount and stay collapsed
  // through the very sync that produced the entries).
  const [manualCollapsed, setManualCollapsed] = useState<boolean | null>(null);
  const collapsed = manualCollapsed ?? syncLog.length === 0;
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const [copied, setCopied] = useState(false);

  // Open user-view sections, lazily read from sessionStorage once per mount
  // (functional initializer, matching MediaBlock.tsx's sort control).
  const [openSections, setOpenSections] = useState<Set<string>>(readStoredOpenSections);
  const toggleSection = (id: string): void => {
    setOpenSections(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      writeStoredOpenSections(next);
      return next;
    });
  };

  // Newest first. `syncLog` is append-ordered (oldest first) on the Project;
  // reverse a COPY so the prop array is never mutated.
  const entries = [...syncLog].reverse();
  const view = buildSyncLogUserView(syncLog, syncRunSummaries, offlineAssetNames);
  const isEmpty = syncLog.length === 0 && view.attention.length === 0;

  const [dismissed, setDismissed] = useState<Set<string>>(readStoredDismissed);
  const dismissKey = (kind: string): string => `${kind}@${view.windowKey}`;
  const dismissLine = (kind: string): void => {
    setDismissed(prev => {
      const next = new Set(prev);
      next.add(dismissKey(kind));
      writeStoredDismissed(next);
      return next;
    });
  };
  const visibleAttention = view.attention.filter(line => !dismissed.has(dismissKey(line.kind)));

  const handleCopy = (e: React.MouseEvent): void => {
    e.stopPropagation();
    const text = entries.map(formatEntryText).join('\n\n');
    const onCopied = (): void => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    };
    navigator.clipboard.writeText(text).then(onCopied).catch(() => {
      try {
        const textarea = document.createElement('textarea');
        textarea.value = text;
        textarea.style.position = 'fixed';
        textarea.style.opacity = '0';
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand('copy');
        document.body.removeChild(textarea);
        onCopied();
      } catch (err) {
        console.warn('Copy sync log failed:', err);
      }
    });
  };

  const detailsOpen = openSections.has('details');
  const detailsCounts = view.details.counts
    .map(c => `${c.count} ${SYNC_LOG_USER_COPY.categories[c.category]}`)
    .join(' · ');

  return (
    <div className="flex-shrink-0">
      {/* Section header */}
      <div
        className="flex items-center gap-2 px-4 py-2 cursor-pointer select-none"
        onClick={() => setManualCollapsed(!collapsed)}
      >
        {collapsed
          ? <ChevronRight size={12} className="text-gray-600" />
          : <ChevronDown size={12} className="text-gray-600" />
        }
        <span className="text-[9px] font-black uppercase tracking-widest text-gray-500 flex-1">
          Sync Log
        </span>
        {syncLog.length > 0 && (
          <button
            onClick={handleCopy}
            className="p-1 rounded-lg hover:bg-zinc-800 text-gray-600 hover:text-gray-300 transition-colors flex items-center gap-1"
            title="Copy sync log"
            aria-label="Copy sync log"
          >
            {copied ? (
              <span className="text-[8px] font-black uppercase tracking-wider">Copied!</span>
            ) : (
              <Copy size={12} />
            )}
          </button>
        )}
        {syncLog.length > 0 && (
          <button
            onClick={(e) => { e.stopPropagation(); setShowClearConfirm(true); }}
            className="p-1 rounded-lg hover:bg-red-900/40 text-gray-600 hover:text-red-400 transition-colors"
            title="Clear sync log"
            aria-label="Clear sync log"
          >
            <Trash2 size={12} />
          </button>
        )}
      </div>

      {!collapsed && (
        <div className="px-4 pb-3">
          {isEmpty ? (
            <p className="text-xs text-gray-600 italic py-1">
              No sync activity yet. Build the timeline to populate this log.
            </p>
          ) : (
            <>
              {/* 1. Status card — the one block the user reads. Green pulsing
                  dot + "all clear" when nothing is flagged; red dot + count
                  and the list of items to clear otherwise. Fixed width: it
                  sits outside the scroller, so a scrollbar never narrows it.
                  A degraded run always raises at least one line (placeholders
                  → unmatched scene, estimated timing → estimated), so it can
                  never read green — the honesty pin, carried by the status. */}
              <div data-testid="sync-status-card">
                <div className="flex items-center gap-2 min-w-0" data-testid="sync-status" data-state={visibleAttention.length === 0 ? 'clear' : 'attention'}>
                  <span className="relative flex w-2 h-2 flex-shrink-0 self-start mt-[5px]">
                    {visibleAttention.length === 0 && (
                      <span className="absolute inline-flex w-full h-full rounded-full bg-emerald-400 opacity-60 animate-ping" />
                    )}
                    <span className={`relative inline-flex w-2 h-2 rounded-full ${visibleAttention.length === 0 ? 'bg-emerald-400' : 'bg-red-500'}`} />
                  </span>
                  <span className="text-xs text-gray-200 leading-snug break-words">
                    {visibleAttention.length === 0
                      ? SYNC_LOG_USER_COPY.status.clear
                      : SYNC_LOG_USER_COPY.status.attention(visibleAttention.length)}
                  </span>
                </div>

                {visibleAttention.length > 0 && (
                  <div className="mt-2 space-y-0.5">
                    {visibleAttention.map(line => {
                      const sectionId = `attention:${line.kind}`;
                      const open = openSections.has(sectionId);
                      const tone = TONE_CLASSES[line.tone];
                      return (
                        <div key={line.kind} data-testid="sync-attention-line" data-kind={line.kind} data-tone={line.tone}>
                          <div className="flex items-center gap-2 rounded-md hover:bg-white/[0.03]">
                            <button
                              type="button"
                              onClick={() => toggleSection(sectionId)}
                              className="flex-1 min-w-0 flex items-center gap-2 py-1 text-left"
                              aria-expanded={open}
                            >
                              <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${tone.dot}`} />
                              <span className="text-xs text-gray-300 leading-snug break-words flex-1">
                                {line.summary}
                              </span>
                              {open
                                ? <ChevronDown size={12} className="text-gray-500 flex-shrink-0" />
                                : <ChevronRight size={12} className="text-gray-500 flex-shrink-0" />
                              }
                            </button>
                            <button
                              type="button"
                              onClick={() => dismissLine(line.kind)}
                              className="p-0.5 rounded text-gray-600 hover:text-gray-300 flex-shrink-0"
                              title="Dismiss"
                              aria-label={`Dismiss: ${line.summary}`}
                              data-testid="sync-attention-dismiss"
                            >
                              <X size={11} />
                            </button>
                          </div>
                          {open && (
                            <div className="pb-1 space-y-px">
                              {line.items.map((item, idx) => {
                                const targetId = onSeekToSegment ? resolveAttentionItemSegmentId(item, segments) : undefined;
                                return targetId ? (
                                  <button
                                    key={idx}
                                    type="button"
                                    onClick={() => onSeekToSegment!(targetId)}
                                    data-testid="sync-attention-item"
                                    className="w-full text-left text-[11px] text-gray-400 hover:text-gray-100 hover:bg-white/[0.04] rounded px-2 py-1 leading-snug break-words"
                                    title={SYNC_LOG_USER_COPY.jumpToScene}
                                  >
                                    {item.text}
                                  </button>
                                ) : (
                                  <p key={idx} data-testid="sync-attention-item" className="text-[11px] text-gray-500 px-2 py-1 leading-snug break-words">
                                    {item.text}
                                  </p>
                                );
                              })}
                              {line.offerManageModels && onOpenModelsModal && (
                                <button
                                  type="button"
                                  onClick={onOpenModelsModal}
                                  className="px-2 py-1 text-[11px] text-gray-400 hover:text-gray-100 underline underline-offset-2"
                                >
                                  {SYNC_LOG_USER_COPY.manageModels}
                                </button>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* 2. Details — outside the card, quiet, and the ONLY part that
                  scrolls. The negative right margin + matching padding put
                  the scrollbar in the panel gutter, so everything inside
                  keeps the card's exact width. */}
              <div data-testid="sync-details-line" className="mt-3 pt-3 border-t border-white/[0.06]">
                <button
                  type="button"
                  onClick={() => toggleSection('details')}
                  className="w-full min-w-0 flex items-start gap-1.5 py-0.5 text-left text-gray-700 hover:text-gray-500 transition-colors"
                  aria-expanded={detailsOpen}
                >
                  {detailsOpen
                    ? <ChevronDown size={11} className="flex-shrink-0 mt-[3px]" />
                    : <ChevronRight size={11} className="flex-shrink-0 mt-[3px]" />
                  }
                  <span className="text-[11px] leading-snug break-words">
                    {SYNC_LOG_USER_COPY.details(view.details.total)}
                    {detailsCounts && ` · ${detailsCounts}`}
                  </span>
                </button>
                {detailsOpen && (
                  <div
                    // Always-on track (overflow-y: scroll, transparent until
                    // there is something to scroll), so the rows' width never
                    // changes. WKWebView draws the thumb OVER the content, so
                    // the rows stop 16px short of the track: the thumb gets
                    // its own lane (9px into the panel gutter + pr-4) instead
                    // of covering text.
                    className="mt-1 max-h-72 overflow-y-scroll custom-scrollbar -mr-[9px] pr-4 divide-y divide-white/[0.06]"
                  >
                    {/* The run summary lives here now, out of the way. */}
                    <p data-testid="sync-headline" className="text-[11px] text-gray-600 py-1.5 leading-snug break-words">
                      {formatHeadline(view.headline)}
                    </p>
                    {view.details.counts.map(({ category, count, entries: categoryEntries }) => {
                      const sectionId = `details:${category}`;
                      const open = openSections.has(sectionId);
                      return (
                        <div key={category} data-testid="sync-details-count" data-category={category}>
                          <button
                            type="button"
                            onClick={() => toggleSection(sectionId)}
                            className="w-full flex items-center gap-1.5 py-1.5 text-left text-gray-600 hover:text-gray-400 transition-colors"
                            aria-expanded={open}
                          >
                            {open
                              ? <ChevronDown size={11} className="flex-shrink-0" />
                              : <ChevronRight size={11} className="flex-shrink-0" />
                            }
                            <span className="text-[11px]">
                              {count} {SYNC_LOG_USER_COPY.categories[category]}
                            </span>
                          </button>
                          {open && (
                            <div className="pb-1">
                              <SyncLogRawEntries
                                entries={categoryEntries}
                                onOpenModelsModal={onOpenModelsModal}
                                onSeekToSegment={onSeekToSegment}
                              />
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      )}

      {/* Clear confirmation overlay — same pattern as ProjectDashboard's
          delete confirms (no new dialog dependency). */}
      {showClearConfirm && (
        <div className="fixed inset-0 z-[300] bg-black/70 flex items-center justify-center">
          <div className="bg-zinc-900 border border-zinc-700 rounded-xl p-6 max-w-sm w-full mx-4">
            <h3 className="text-white font-semibold mb-2">Clear Sync Log</h3>
            <p className="text-zinc-400 text-sm mb-6">
              All {syncLog.length} sync log {syncLog.length === 1 ? 'entry' : 'entries'} and their
              run summaries will be permanently removed. This cannot be undone.
            </p>
            <div className="flex gap-3 justify-end">
              <button
                onClick={() => setShowClearConfirm(false)}
                className="px-4 py-2 text-sm text-zinc-400 hover:text-white
                           rounded-lg hover:bg-zinc-800 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => { onClearLog(); setShowClearConfirm(false); }}
                className="px-4 py-2 text-sm bg-red-600 hover:bg-red-500
                           text-white rounded-lg transition-colors font-medium"
              >
                Clear log
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
