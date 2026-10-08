// src/components/SyncLogPanel.tsx
// WS-logs — the persistent sync-log panel (right panel, App.tsx).
//
// Pure presentation: it renders Project.syncLog and calls back to clear it. All
// writes go through appendSyncLogEntries (services/syncLog.ts) / clearSyncLog
// (App.tsx), so this file holds no log policy and no persistence of its own —
// the log rides along on the Project blob the existing projectStore already saves.
import React, { useState } from 'react';
import { ChevronDown, ChevronRight, Copy, Check } from 'lucide-react';
import type { SyncLogEntry, SyncLogEntryType, SyncRunSummary } from '../types';
import { SKIPPED_SCENE_COPY } from '../services/skippedScenePlaceholders';
import {
  resolveAttentionItemSegmentId,
  skipEntryLabel,
  SYNC_LOG_USER_COPY,
  type SyncLogHeadline,
} from '../services/syncLogUserView';
import {
  buildSyncGroups,
  resolveKey,
  timeAgo,
  warningKey,
  RESOLVABLE_ACTIONS,
  SYNC_GROUPS_COPY,
  type ActionGroup,
  type GroupItem,
  type LiveState,
  type SyncGroup,
  type WarningGroup,
} from '../services/syncLogGroups';

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
  /** `project.syncRunSummaries` — one per sync run. */
  syncRunSummaries?: SyncRunSummary[];
  /** The live project, so media and Layer 2 problems are always current and
   *  clear themselves as the user fixes them. */
  segments?: LiveState['segments'];
  assets?: LiveState['assets'];
  spots?: LiveState['spots'];
  /** WS2 Step 12 (A3) — opens ManageModelsModal. */
  onOpenModelsModal?: () => void;
  /** Deep-links the playhead to a committed segment. */
  onSeekToSegment?: (segmentId: string) => void;
  /** "Add media" on Missing media. */
  onAddMedia?: () => void;
  /** "Relink files" on Offline media; gets the first offline asset's id. */
  onRelinkOffline?: (firstAssetId?: string) => void;
  /** "Retry" on Sync stopped and "Re-sync" on Skipped scenes. */
  onRetrySync?: () => void;
  /** "Open files" on Wrong file pair (the script / voiceover slots). */
  onOpenFiles?: () => void;
  /** "Open Layer 2" on Layer 2 unbound. */
  onOpenLayer2?: () => void;
  /** This project's cloud cost ledger entries (cost per sync). */
  costEntries?: readonly { at: number; usd: number; sec: number; cached: boolean }[];
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

const TONE_DOT: Record<'green' | 'amber' | 'red', string> = {
  green: 'bg-emerald-400',
  amber: 'bg-amber-500',
  red: 'bg-red-500',
};

/** Pulsing dot; `still` draws it without the ping (used where nothing is wrong). */
function Pulse({ tone, still = false }: { tone: 'green' | 'amber' | 'red'; still?: boolean }): React.ReactElement {
  return (
    <span className="relative flex w-1.5 h-1.5 flex-shrink-0">
      {!still && <span className={`absolute inline-flex w-full h-full rounded-full opacity-60 animate-ping ${TONE_DOT[tone]}`} />}
      <span className={`relative inline-flex w-1.5 h-1.5 rounded-full ${TONE_DOT[tone]}`} />
    </span>
  );
}

/** One of the three identical cards. Same geometry for every card: header row
 *  (title left, chip right), body only when open. */
function Card({
  id, title, chip, open, onToggle, muted, children, headerExtra,
}: {
  id: string;
  title: string;
  chip: React.ReactNode;
  open: boolean;
  onToggle: () => void;
  muted: boolean;
  children?: React.ReactNode;
  headerExtra?: React.ReactNode;
}): React.ReactElement {
  return (
    <div data-testid="sync-card" data-card={id} className={`rounded-lg border border-white/[0.06] ${muted ? 'opacity-60' : ''}`}>
      <div className="group/card flex items-center gap-1 px-[0.5vw] h-8">
        <button type="button" onClick={onToggle} aria-expanded={open} className="flex-1 min-w-0 h-full flex items-center gap-1.5 text-left">
          {open ? <ChevronDown size={11} className="text-gray-500 flex-shrink-0" /> : <ChevronRight size={11} className="text-gray-500 flex-shrink-0" />}
          <span className="text-[12px] font-bold uppercase tracking-wider text-gray-300">{title}</span>
        </button>
        {headerExtra}
        <span className="flex items-center justify-end min-w-[1.5rem]" data-testid="sync-card-chip">{chip}</span>
      </div>
      {open && <div className="px-[0.5vw] pb-1 divide-y divide-white/[0.06]">{children}</div>}
    </div>
  );
}

const CHIP_TONE: Record<'red' | 'amber' | 'green' | 'blue', string> = {
  red: 'bg-red-500/20 text-red-300',
  amber: 'bg-amber-500/20 text-amber-300',
  green: 'bg-emerald-500/20 text-emerald-300',
  blue: 'bg-sky-500/20 text-sky-300',
};

function Chip({ n, tone }: { n: number; tone: 'red' | 'amber' | 'green' | 'blue' }): React.ReactElement {
  return <span className={`text-[12px] font-medium leading-4 rounded px-1.5 ${CHIP_TONE[tone]}`}>{n}</span>;
}

export function SyncLogPanel({
  syncLog, syncRunSummaries, segments = [], assets = [], spots = [],
  onOpenModelsModal, onSeekToSegment, onAddMedia, onRelinkOffline, onRetrySync, onOpenFiles, onOpenLayer2, costEntries,
}: Props): React.ReactElement {
  const [manualCollapsed, setManualCollapsed] = useState<boolean | null>(null);
  const collapsed = manualCollapsed ?? false;
  /** The sync whose records were just copied (brief "Copied" tick). */
  const [copiedRun, setCopiedRun] = useState<string | null>(null);

  // Open sections, session-persisted. An id in the set FLIPS that section's default.
  const [toggled, setToggled] = useState<Set<string>>(readStoredOpenSections);
  const isOpen = (id: string, defaultOpen = false): boolean => (toggled.has(id) ? !defaultOpen : defaultOpen);
  const toggle = (id: string): void => {
    setToggled(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      writeStoredOpenSections(next);
      return next;
    });
  };

  // SYNC boxes: in-memory only (see renderSync).
  const [syncToggled, setSyncToggled] = useState<Set<string>>(() => new Set());
  const toggleSync = (runId: string): void => {
    setSyncToggled(prev => {
      const next = new Set(prev);
      if (next.has(runId)) next.delete(runId); else next.add(runId);
      return next;
    });
  };

  const [dismissed, setDismissed] = useState<Set<string>>(readStoredDismissed);
  const dismiss = (keys: string[]): void => {
    setDismissed(prev => {
      const next = new Set(prev);
      for (const k of keys) next.add(k);
      writeStoredDismissed(next);
      return next;
    });
  };

  const view = buildSyncGroups({ log: syncLog, summaries: syncRunSummaries ?? [], live: { segments, assets, spots }, dismissed, costEntries });

  /** Copies one sync's records (oldest first), hidden ones included. */
  const copySync = (sync: SyncGroup): void => {
    const text = sync.entries.map(formatEntryText).join('\n\n');
    const onCopied = (): void => {
      setCopiedRun(sync.runId);
      setTimeout(() => setCopiedRun(r => (r === sync.runId ? null : r)), 1500);
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


  const ctaFor = (g: ActionGroup, sync: SyncGroup): { label: string; run: () => void } | undefined => {
    if (!sync.live) return undefined;
    const firstOfflineAsset = g.items.find(i => i.key.startsWith('asset:'))?.key.slice('asset:'.length);
    switch (g.cta) {
      case 'add-media': return onAddMedia ? { label: 'Add media', run: onAddMedia } : undefined;
      case 'relink': return onRelinkOffline ? { label: 'Relink', run: () => onRelinkOffline(firstOfflineAsset) } : undefined;
      case 'replace': return onAddMedia ? { label: 'Replace', run: onAddMedia } : undefined;
      case 'resync': return onRetrySync ? { label: 'Re-sync', run: onRetrySync } : undefined;
      case 'open-files': return onOpenFiles ? { label: 'Open files', run: onOpenFiles } : undefined;
      case 'retry': return onRetrySync ? { label: 'Retry', run: onRetrySync } : undefined;
      case 'open-layer2': return onOpenLayer2 ? { label: 'Layer 2', run: onOpenLayer2 } : undefined;
      default: return undefined;
    }
  };

  /** Which item's detail card is open (one at a time), keyed per sync. */
  const [openDetail, setOpenDetail] = useState<string | null>(null);

  /** One item: its short line (max two lines) and, when clicked, a card with the
   *  full explanation in plain words — plus "Go to scene" when it names one. */
  const itemBlock = (
    item: GroupItem, scope: string, strong: boolean, leading: React.ReactNode, trailing: React.ReactNode,
  ): React.ReactElement => {
    const key = `${scope}:${item.key}`;
    const open = openDetail === key;
    const targetId = onSeekToSegment
      ? resolveAttentionItemSegmentId({ text: item.text, segmentId: item.segmentId, sceneRef: item.sceneRef }, segments)
      : undefined;
    return (
      <div key={item.key} className="group/item py-1.5" data-testid="sync-item-block">
        <div className="flex items-start gap-1.5">
          {leading}
          <button
            type="button"
            data-testid="sync-item"
            aria-expanded={open}
            onClick={() => setOpenDetail(open ? null : key)}
            className={`flex-1 min-w-0 text-left text-[11px] leading-4 break-words line-clamp-2 hover:text-white ${strong ? 'text-gray-300' : 'text-gray-400'}`}
          >
            {item.text}
          </button>
          {trailing}
        </div>
        {open && (
          <div data-testid="sync-item-detail" className="mt-1.5 rounded-md border border-white/[0.08] bg-white/[0.04] px-2 py-1.5">
            <p className="text-[11px] leading-4 text-gray-300">{item.detail ?? item.text}</p>
            <div className="flex items-center gap-3 mt-1.5">
              {targetId && (
                <button type="button" data-testid="sync-item-goto" onClick={() => onSeekToSegment!(targetId)} className="text-[11px] leading-4 text-gray-200 hover:text-white underline underline-offset-2">
                  Go to scene
                </button>
              )}
              <button type="button" onClick={() => setOpenDetail(null)} className="text-[11px] leading-4 text-gray-500 hover:text-gray-300">
                Close
              </button>
            </div>
          </div>
        )}
      </div>
    );
  };

  const ctaButton = (cta: { label: string; run: () => void }): React.ReactElement => (
    <button type="button" data-testid="sync-cta" onClick={cta.run} className="flex-shrink-0 h-4 inline-flex items-center text-[11px] leading-none text-gray-200 bg-white/[0.06] hover:bg-white/[0.12] rounded px-1.5 transition-colors">
      {cta.label}
    </button>
  );

  const tickButton = (
    { label, onClick, testId }: { label: string; onClick: () => void; testId: string },
    reveal = 'group-hover/item:opacity-100',
  ): React.ReactElement => (
    <button type="button" data-testid={testId} aria-label={label} title={label} onClick={onClick} className={`flex-shrink-0 h-4 w-4 inline-flex items-center justify-center rounded text-gray-600 hover:text-emerald-400 opacity-0 ${reveal} focus:opacity-100 transition-opacity`}>
      <Check size={12} />
    </button>
  );

  /** A sub-group. One item: just that item's line (no arrow, no title). More:
   *  a title row with the count and the arrow on the RIGHT; items below, no indent. */
  const subGroup = ({
    sectionId, testId, dataAttr, dotClass, title, items, cta, tickFor, groupTick,
  }: {
    sectionId: string;
    testId: string;
    dataAttr: Record<string, string>;
    dotClass?: string;
    title: string;
    items: GroupItem[];
    cta?: { label: string; run: () => void };
    tickFor?: (item: GroupItem) => { label: string; onClick: () => void; testId: string } | undefined;
    groupTick?: { label: string; onClick: () => void; testId: string };
  }): React.ReactElement => {
    const dot = dotClass ? <span className="h-4 flex items-center flex-shrink-0"><span className={`w-1.5 h-1.5 rounded-full ${dotClass}`} /></span> : null;
    if (items.length === 1) {
      const item = items[0]!;
      const tick = tickFor?.(item);
      return (
        <div key={sectionId} data-testid={testId} {...dataAttr}>
          {itemBlock(item, sectionId, true, dot, <>{cta && ctaButton(cta)}{tick && tickButton(tick)}</>)}
        </div>
      );
    }
    const open = isOpen(sectionId);
    return (
      <div key={sectionId} data-testid={testId} {...dataAttr}>
        <div className="group/sub flex items-start gap-1.5 py-1.5">
          {dot}
          <button type="button" onClick={() => toggle(sectionId)} aria-expanded={open} className="flex-1 min-w-0 flex items-center text-left text-[11px] leading-4 text-gray-300">
            <span className="truncate">{title}</span>
            <span aria-hidden="true" className="mx-1.5 w-[3px] h-[3px] rounded-full bg-gray-500 flex-shrink-0" />
            <span className="text-gray-500 flex-shrink-0">{items.length}</span>
          </button>
          {cta && ctaButton(cta)}
          {groupTick && tickButton(groupTick, 'group-hover/sub:opacity-100')}
          <button type="button" onClick={() => toggle(sectionId)} aria-label={open ? 'Collapse' : 'Expand'} className="flex-shrink-0 h-4 w-4 inline-flex items-center justify-center text-gray-500">
            {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          </button>
        </div>
        {open && (
          <div className="border-t border-white/[0.06] divide-y divide-white/[0.06]">
            {items.map(item => {
              const tick = tickFor?.(item);
              return itemBlock(item, sectionId, false, null, tick ? tickButton(tick) : null);
            })}
          </div>
        )}
      </div>
    );
  };

  const renderAction = (g: ActionGroup, sync: SyncGroup): React.ReactElement => {
    const resolvable = sync.live && RESOLVABLE_ACTIONS.has(g.id);
    return (
      <div key={g.id}>
        {subGroup({
          sectionId: `${sync.runId}:action:${g.id}`,
          testId: 'sync-action-group', dataAttr: { 'data-action': g.id, 'data-tone': g.tone },
          dotClass: TONE_DOT[g.tone], title: g.title, items: g.items, cta: ctaFor(g, sync),
          tickFor: resolvable ? item => ({ label: 'Mark resolved', testId: 'sync-action-resolve', onClick: () => dismiss([resolveKey(g.id, item.key, sync.runId)]) }) : undefined,
        })}
        {sync.live && g.offerModels && onOpenModelsModal && (
          <button type="button" onClick={onOpenModelsModal} className="text-[11px] leading-4 text-gray-300 hover:text-white underline underline-offset-2 pb-1.5">
            {SYNC_LOG_USER_COPY.manageModels}
          </button>
        )}
      </div>
    );
  };

  const renderWarning = (g: WarningGroup, sync: SyncGroup): React.ReactElement => subGroup({
    sectionId: `${sync.runId}:warning:${g.id}`,
    testId: 'sync-warning-group', dataAttr: { 'data-warning': g.id },
    dotClass: 'bg-amber-500', title: g.title, items: g.items,
    tickFor: g.dismissible ? item => ({ label: 'Dismiss', testId: 'sync-warning-dismiss', onClick: () => dismiss([warningKey(g.id, item.key, sync.runId)]) }) : undefined,
    groupTick: g.dismissible ? { label: `Dismiss all ${g.title}`, testId: 'sync-warning-group-dismiss', onClick: () => dismiss(g.items.map(i => warningKey(g.id, i.key, sync.runId))) } : undefined,
  });

  const infoDot = <span className="h-4 flex items-center flex-shrink-0"><span className="w-1.5 h-1.5 rounded-full bg-sky-400" /></span>;

  const renderSync = (sync: SyncGroup): React.ReactElement => {
    const muted = !sync.live;
    // The newest sync opens by default every time; older ones start closed.
    // Not remembered, so the latest sync is always shown open.
    const open = syncToggled.has(sync.runId) ? !sync.live : sync.live;
    const actionTone = sync.actions.some(a => a.tone === 'red') ? 'red' : 'amber';
    const warnKeys = sync.warnings.flatMap(w => (w.dismissible ? w.items.map(i => warningKey(w.id, i.key, sync.runId)) : []));
    const cardId = (c: string): string => `${sync.runId}:card:${c}`;
    return (
      <div key={sync.runId} data-testid="sync-group" data-run={sync.runId} data-live={sync.live ? 'true' : 'false'} data-health={sync.health} style={{ width: '19vw' }} className={`mx-auto rounded-xl border border-white/[0.08] ${muted ? 'bg-white/[0.01]' : 'bg-white/[0.03]'}`}>
        {/* Header: health dot leads the title; Copy sits at the right edge, on
            the title's 16px line. Clicking the title opens or closes the sync. */}
        <div className="flex items-start gap-2 px-[0.5vw] py-2">
          <span data-testid="sync-health" data-health={sync.health} className="h-4 flex items-center flex-shrink-0">
            <Pulse tone={sync.health === 'red' ? 'red' : sync.health === 'amber' ? 'amber' : 'green'} still={muted || sync.health === 'green'} />
          </span>
          <button type="button" onClick={() => toggleSync(sync.runId)} aria-expanded={open} className="flex-1 min-w-0 text-left">
            <span className="flex items-center gap-2">
              <span className="text-[12px] leading-4 font-bold uppercase tracking-wider text-gray-200 flex-shrink-0">SYNC {sync.number}</span>
              <span className={`text-[12px] leading-4 truncate ${muted ? 'text-gray-600' : 'text-gray-500'}`}>{[timeAgo(sync.timestamp), sync.engine].filter(Boolean).join(' · ')}</span>
            </span>
            {sync.summary && <span data-testid="sync-summary-line" className={`block text-[12px] mt-1.5 leading-4 ${muted ? 'text-gray-600' : 'text-gray-400'}`}>{sync.summary}</span>}
          </button>
          <span className="h-4 flex items-center flex-shrink-0">
            <button
              type="button"
              data-testid="sync-log-copy"
              onClick={() => copySync(sync)}
              aria-label={`Copy sync ${sync.number} log`}
              title={copiedRun === sync.runId ? 'Copied' : 'Copy log'}
              className="h-5 w-5 inline-flex items-center justify-center rounded text-gray-500 hover:text-gray-200 hover:bg-white/[0.06] transition-colors"
            >
              {copiedRun === sync.runId ? <Check size={14} strokeWidth={1.75} className="text-emerald-400" /> : <Copy size={13} strokeWidth={1.75} />}
            </button>
          </span>
        </div>
        {open && (
          <div className="px-[0.5vw] pb-[0.5vw] space-y-1.5">
            <Card
              id="actions" title="Actions" muted={muted}
              open={isOpen(cardId('actions'))} onToggle={() => toggle(cardId('actions'))}
              chip={<Chip n={sync.actionsChip ?? 0} tone={sync.actionsChip ? actionTone : 'green'} />}
            >
              {sync.actions.length === 0
                ? <p className="text-[11px] leading-4 text-gray-600 py-1.5">Nothing to fix.</p>
                : sync.actions.map(g => renderAction(g, sync))}
            </Card>
            <Card
              id="warnings" title="Warnings" muted={muted}
              open={isOpen(cardId('warnings'))} onToggle={() => toggle(cardId('warnings'))}
              chip={<Chip n={sync.warningsChip ?? 0} tone={sync.warningsChip ? 'amber' : 'green'} />}
              headerExtra={sync.live && warnKeys.length > 0
                ? tickButton({ label: 'Dismiss all warnings', testId: 'sync-warnings-dismiss-all', onClick: () => dismiss(warnKeys) }, 'group-hover/card:opacity-100')
                : undefined}
            >
              {sync.warnings.length === 0
                ? <p className="text-[11px] leading-4 text-gray-600 py-1.5">No warnings.</p>
                : sync.warnings.map(g => renderWarning(g, sync))}
            </Card>
            <Card
              id="info" title="Info" muted={muted}
              open={isOpen(cardId('info'))} onToggle={() => toggle(cardId('info'))}
              chip={<Chip n={sync.infoCount} tone="blue" />}
            >
              {sync.info.facts.map(item => (
                <div key={item.key} data-testid="sync-info-fact">
                  {itemBlock(item, `${sync.runId}:info`, true, infoDot, null)}
                </div>
              ))}
              {sync.info.groups.map(g => subGroup({
                sectionId: `${sync.runId}:info:${g.id}`,
                testId: 'sync-info-group', dataAttr: { 'data-info': g.id },
                dotClass: 'bg-sky-400', title: g.title, items: g.items,
              }))}
            </Card>
          </div>
        )}
      </div>
    );
  };

  const earlierOpen = isOpen('earlier');
  return (
    <div className="flex-shrink-0 text-[12px] antialiased" style={{ fontFamily: "'Inter', ui-sans-serif, system-ui, sans-serif" }}>
      {/* Sticky: the log header, headline and divider stay put while the sync
          groups scroll underneath (the right panel is the scroller). */}
      <div data-testid="sync-log-sticky" className="sticky top-0 z-10 bg-[#080808]">
        <div className="flex items-center gap-2 px-4 py-2 cursor-pointer select-none" onClick={() => setManualCollapsed(!collapsed)}>
          {collapsed ? <ChevronRight size={12} className="text-gray-600" /> : <ChevronDown size={12} className="text-gray-600" />}
          <span className="text-[12px] font-medium text-gray-400 flex-1">Sync log</span>
        </div>
        {!collapsed && (
          <div className="px-4">
            <div data-testid="sync-status-card" className="pb-3 border-b border-white/[0.06]">
              <div data-testid="sync-status" data-state={view.headline.tone === 'green' ? 'clear' : 'attention'} data-tone={view.headline.tone} className="flex items-center gap-2 min-w-0">
                <Pulse tone={view.headline.tone} />
                <span data-testid="sync-status-text" className="text-[12px] text-gray-200 leading-snug break-words">{view.headline.text}</span>
              </div>
            </div>
          </div>
        )}
      </div>

      {!collapsed && (
        <div className="px-4 pt-3 pb-3">
          <div className="-mx-4 space-y-2">
            {view.syncs.length === 0 && <p className="text-[12px] text-gray-600 px-4">No sync yet.</p>}
            {view.syncs.map(renderSync)}
            {view.earlier.length > 0 && (
              <div data-testid="sync-earlier" className="px-4">
                <button type="button" onClick={() => toggle('earlier')} aria-expanded={earlierOpen} className="w-full flex items-center gap-1.5 py-1 text-left text-gray-600 hover:text-gray-400">
                  {earlierOpen ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
                  <span className="text-[12px]">Earlier syncs ({view.earlier.length})</span>
                </button>
                {earlierOpen && <div className="space-y-2">{view.earlier.map(renderSync)}</div>}
              </div>
            )}
          </div>
        </div>
      )}

    </div>
  );
}
