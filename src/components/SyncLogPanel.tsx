// src/components/SyncLogPanel.tsx
// WS-logs — the persistent sync-log panel (right panel, App.tsx).
//
// Pure presentation: it renders Project.syncLog and calls back to clear it. All
// writes go through appendSyncLogEntries (services/syncLog.ts) / clearSyncLog
// (App.tsx), so this file holds no log policy and no persistence of its own —
// the log rides along on the Project blob the existing projectStore already saves.
import React, { useState } from 'react';
import { ChevronDown, ChevronRight, Trash2, Copy } from 'lucide-react';
import type { SyncLogEntry, SyncLogEntryType } from '../types';

interface Props {
  syncLog: SyncLogEntry[];
  onClearLog: () => void;
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
 *  logged before these fields existed) — the caller omits the line entirely
 *  in that case. `longestRun` (Bug C, consecutive-run survival requirement,
 *  2026-08-02) is appended as ", longest run N" when present — display-only,
 *  no threshold logic here — and simply omitted when absent (older entries),
 *  same as the other optional fields. */
function formatMatchLine(
  matchedWords: number | undefined,
  totalWords: number | undefined,
  confidence: number | undefined,
  longestRun: number | undefined,
): string | undefined {
  if (matchedWords === undefined || totalWords === undefined || confidence === undefined) {
    return undefined;
  }
  const runSuffix = longestRun !== undefined ? `, longest run ${longestRun}` : '';
  if (totalWords === 0) {
    return `matched 0 of 0 words (no content to match)${runSuffix}`;
  }
  return `matched ${matchedWords} of ${totalWords} words (confidence ${confidence.toFixed(2)})${runSuffix}`;
}

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
  return undefined;
}

/** Renders one entry exactly as the panel displays it — reused by the Copy
 *  button so the copied text can never drift from what's on screen. */
function formatEntryText(entry: SyncLogEntry): string {
  const label = (TYPE_STYLES[entry.type] ?? TYPE_STYLES.info).label;
  const header = `[${formatTime(entry.timestamp)}] [${label}]`;
  const isSkip = entry.type === 'skip' && entry.segmentIndex !== undefined;

  if (isSkip) {
    const lines = [`${header} Segment ${entry.segmentIndex! + 1} skipped — ${entry.reason ?? 'no audio match'}`];
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
  return lines.join('\n');
}

export function SyncLogPanel({ syncLog, onClearLog }: Props): React.ReactElement {
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

  // Newest first. `syncLog` is append-ordered (oldest first) on the Project;
  // reverse a COPY so the prop array is never mutated.
  const entries = [...syncLog].reverse();

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

  return (
    <div className="border-b border-[#1A1A1A] flex-shrink-0">
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
          Sync Log ({syncLog.length})
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
        <div className="px-3 pb-2 space-y-1 max-h-64 overflow-y-auto custom-scrollbar">
          {entries.length === 0 ? (
            <p className="text-[10px] text-gray-700 italic px-1 py-1">
              No sync activity yet. Run Apply Sync to populate this log.
            </p>
          ) : (
            entries.map((entry) => {
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
              return (
                <div
                  key={entry.id}
                  className="bg-[#0A0A0A] border border-[#1A1A1A] rounded-xl px-3 py-2"
                >
                  <div className="flex items-center gap-2">
                    <span className="text-[9px] font-mono text-gray-600 flex-shrink-0">
                      {formatTime(entry.timestamp)}
                    </span>
                    <span
                      className={`text-[8px] font-black uppercase tracking-wider px-1.5 py-0.5 rounded border flex-shrink-0 ${style.className}`}
                    >
                      {style.label}
                    </span>
                  </div>
                  {isSkip ? (
                    <>
                      <p className="text-[10px] text-gray-300 mt-1 leading-snug break-words">
                        Segment {entry.segmentIndex! + 1} skipped — {entry.reason ?? 'no audio match'}
                      </p>
                      {entry.segmentText && (
                        <p className="text-[9px] text-gray-500 mt-0.5 pl-1.5 leading-snug break-words">
                          {entry.segmentTag && (
                            <span className="font-mono text-gray-400">[{entry.segmentTag}] </span>
                          )}
                          {entry.segmentText}
                        </p>
                      )}
                      {matchLine && (
                        <p className="text-[9px] text-gray-600 mt-0.5 pl-1.5 leading-snug break-words">
                          {matchLine}
                        </p>
                      )}
                    </>
                  ) : (
                    <>
                      <p className="text-[10px] text-gray-300 mt-1 leading-snug break-words">
                        {entry.message}
                      </p>
                      {detailLine && (
                        <p className="text-[9px] text-gray-600 mt-0.5 pl-1.5 leading-snug break-words">
                          {detailLine}
                        </p>
                      )}
                      {entry.segmentText && (
                        <p className="text-[9px] text-gray-600 mt-1 italic leading-snug break-words">
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
            })
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
