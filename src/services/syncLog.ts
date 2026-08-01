/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// WS-logs — persistent sync log (R4-4), extracted from App.tsx (Pipeline
// Contract Program, Pair 1, Step 1). Only the builders/fold needed outside
// App.tsx's own module scope (the staging-time transcription path in
// useWhisper.ts, which cannot import from App.tsx without a cycle) live
// here. The rest of the WS-logs builder family (buildSkipLogEntries,
// buildSyncInfoEntry, buildSyncAbortEntry, buildNoAssetSummaryEntry,
// buildRescueLogEntries, clearSyncLog) remains in App.tsx and imports
// makeSyncLogEntry from this module.
import type { Project, SyncLogEntry, SyncLogEntryType, SyncRunSummary } from '../types';
import type { TokenDrop } from './whisperService';
import type { ContractViolation } from './syncContracts';
import { MAX_LOG_ENTRIES, MAX_SYNC_RUN_SUMMARIES } from './syncConstants';

/** `crypto.randomUUID` is present in every runtime this app ships in (Tauri
 *  WKWebView/WebView2, and Vite dev over localhost — a secure context). The
 *  counter fallback exists only so a non-secure-context or jsdom environment
 *  can't throw mid-sync; ids are never persisted across runs as keys. */
let syncLogIdCounter = 0;
export function mintSyncLogId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  syncLogIdCounter += 1;
  return `synclog-${Date.now()}-${syncLogIdCounter}`;
}

/** Builds one entry. `timestamp` is injectable so a whole run's entries can
 *  share a single Date.now() reading (and so tests are deterministic). */
export function makeSyncLogEntry(
  syncRunId: string,
  type: SyncLogEntryType,
  message: string,
  extra?: Pick<
    SyncLogEntry,
    'segmentIndex' | 'segmentText' | 'reason' | 'segmentTag' | 'matchedWords' | 'totalWords' | 'confidence'
    | 'longestRun' | 'errorMessage' | 'skippedTokenCount' | 'totalTokenCount' | 'severity' | 'fixHint'
  >,
  timestamp: number = Date.now(),
): SyncLogEntry {
  return {
    id: mintSyncLogId(),
    timestamp,
    syncRunId,
    type,
    message,
    ...extra,
  };
}

/**
 * WS4 Feature 3 (decision 11a) — the 'silence-error' entry.
 *
 * Silence detection failing is a real degradation, not a cosmetic one: every
 * boundary in the run falls back to the token midpoint instead of landing in an
 * acoustic gap. It is NOT an abort — a timeline built on midpoints is still a
 * usable timeline — so it is logged loudly and the sync continues.
 */
export function buildSilenceErrorEntry(
  syncRunId: string,
  errorMessage: string,
  timestamp: number = Date.now(),
): SyncLogEntry {
  return makeSyncLogEntry(
    syncRunId,
    'silence-error',
    'Silence detection failed — segment boundaries fall back to spoken-word midpoints instead of audio gaps.',
    { errorMessage },
    timestamp,
  );
}

const DROP_REASON_LABELS: Record<TokenDrop['reason'], string> = {
  'non-finite': 'unusable timestamp',
  'negative-start': 'negative start time',
  'inverted-or-zero-duration': 'zero/inverted duration',
  'past-audio-end': 'past the end of the audio',
  'empty-text': 'empty text',
};

/** Formats a per-reason breakdown, most-common first, e.g.
 *  " (8 unusable timestamp, 3 past the end of the audio, 1 empty text)". */
function summarizeDropReasons(drops: readonly TokenDrop[]): string {
  const counts = new Map<TokenDrop['reason'], number>();
  for (const d of drops) counts.set(d.reason, (counts.get(d.reason) ?? 0) + 1);
  const parts = Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([reason, count]) => `${count} ${DROP_REASON_LABELS[reason]}`);
  return parts.length > 0 ? ` (${parts.join(', ')})` : '';
}

/**
 * WS4 Feature 4 (decision 14a) — the 'malformed-token' entry.
 *
 * Informational by design: the bad tokens were caught and removed before they
 * could place a boundary, so the sync that follows is CLEANER for it. Only
 * emitted when at least one token was actually dropped.
 *
 * `drops` (Pipeline Contract Program, Pair 1, Step 5/7) is optional and
 * additive: when the caller has the per-token drop records in scope (the
 * staging-time path, useWhisper.ts), the message gains a per-reason
 * breakdown; omitted, the message is byte-identical to before this field
 * existed (the Apply Sync path, App.tsx, does not pass it).
 */
export function buildMalformedTokenEntry(
  syncRunId: string,
  skippedCount: number,
  totalTokens: number,
  timestamp: number = Date.now(),
  drops?: TokenDrop[],
): SyncLogEntry {
  const breakdown = drops ? summarizeDropReasons(drops) : '';
  return makeSyncLogEntry(
    syncRunId,
    'malformed-token',
    `Filtered ${skippedCount} of ${totalTokens} transcript token(s) with unusable timestamps before alignment.${breakdown}`,
    { skippedTokenCount: skippedCount, totalTokenCount: totalTokens },
    timestamp,
  );
}

/**
 * Turns one contract validator's `ContractViolation` (syncContracts.ts) into
 * a `SyncLogEntry`. `type` reuses the existing generic 'warning' entry kind
 * for a 'warning'-severity violation — §4's own severity-mapping table
 * already treats 'warning' as WARNING by default, so no new
 * `SyncLogEntryType` value is needed for the one severity Pair 1's
 * validators emit today. NOTE: no contract validator has shipped an
 * 'error'-severity violation yet (Contract 1→2's two rules are both
 * 'warning') — an 'error' here still renders as a 'warning' entry, which is
 * a known gap to revisit (a dedicated type, or reusing 'abort', would both
 * be wrong: 'abort' specifically means the run never committed, which a
 * contract violation does not imply) once a later pair's validator actually
 * emits one.
 */
export function buildContractViolationEntry(
  syncRunId: string,
  violation: ContractViolation,
  timestamp: number = Date.now(),
): SyncLogEntry {
  return makeSyncLogEntry(
    syncRunId,
    'warning',
    violation.message,
    { severity: violation.severity, fixHint: violation.fixHint },
    timestamp,
  );
}

/**
 * Folds a run's entries + summary onto the project. Pure — returns a new
 * Project, never mutates. Both fields are treated as [] when absent, which is
 * what makes a pre-WS-logs project (syncLog: undefined) work unchanged.
 *
 * Pruning keeps the MOST RECENT records: entries are appended at the end, so
 * an over-cap array is sliced from the END. `summary` is optional so a future
 * caller can log a standalone warning without inventing a run rollup for it.
 */
export function appendSyncLogEntries(
  project: Project,
  entries: SyncLogEntry[],
  summary?: SyncRunSummary,
): Project {
  const nextLog = [...(project.syncLog ?? []), ...entries];
  const nextSummaries = summary
    ? [...(project.syncRunSummaries ?? []), summary]
    : [...(project.syncRunSummaries ?? [])];
  return {
    ...project,
    syncLog: nextLog.length > MAX_LOG_ENTRIES ? nextLog.slice(-MAX_LOG_ENTRIES) : nextLog,
    syncRunSummaries: nextSummaries.length > MAX_SYNC_RUN_SUMMARIES
      ? nextSummaries.slice(-MAX_SYNC_RUN_SUMMARIES)
      : nextSummaries,
  };
}
