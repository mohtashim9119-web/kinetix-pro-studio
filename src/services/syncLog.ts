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
import type { Project, SyncLogEntry, SyncLogEntryType, SyncRunSummary, GroupedLogItem } from '../types';
import type { TokenDrop } from './whisperService';
import type { ContractViolation } from './syncContracts';
import type { LockFinding } from './syncEngine';
import { MAX_LOG_ENTRIES, MAX_SYNC_RUN_SUMMARIES, WORD_COVERAGE_MIN_RATIO } from './syncConstants';

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
    | 'groupedItems'
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

/**
 * Phase 2a H.4 guard — the 'unsupported-language' entry. Fired when
 * `Project.language` is set (by detection or an explicit override) to a code
 * outside `constants.ts`'s `SUPPORTED_LANGUAGES`. Error severity: whitespace
 * word-splitting and normalization are only verified for the supported five,
 * so this isn't a degradation of an otherwise-working path (an ordinary
 * WARNING), it's a use of the pipeline outside its verified envelope.
 */
export function buildUnsupportedLanguageEntry(
  syncRunId: string,
  languageCode: string,
  timestamp: number = Date.now(),
): SyncLogEntry {
  return makeSyncLogEntry(
    syncRunId,
    'unsupported-language',
    `Project language "${languageCode}" is outside the supported set (English, Spanish, French, Portuguese, German) — sync accuracy is not guaranteed.`,
    {
      severity: 'error',
      fixHint: 'Set the correct language in Project Settings if this was misdetected, or expect reduced sync accuracy for this language.',
    },
    timestamp,
  );
}

/**
 * K14 fix (decision 9 / Step AB) — turns `applyAnchorBasedTiming`'s
 * `LockFinding`s (syncEngine.ts) into `SyncLogEntry`s, one per finding.
 * `segmentIndex` is 0-based into whatever segments array
 * `applyAnchorBasedTiming` was called with, matching the convention every
 * other segment-indexed entry (skip, no-asset, rescue) already uses;
 * messages use the 1-based display number.
 */
export function buildLockFindingLogEntries(
  syncRunId: string,
  findings: LockFinding[],
  timestamp: number = Date.now(),
): SyncLogEntry[] {
  return findings.map(f => {
    const displayNumber = f.segmentIndex + 1;
    if (f.kind === 'lock-span-overflow') {
      return makeSyncLogEntry(
        syncRunId,
        'lock-span-overflow',
        `Segment ${displayNumber} is squeezed by a locked boundary — its content is short `
        + `${f.amountSec.toFixed(2)}s of the space it needs.`,
        { segmentIndex: f.segmentIndex, severity: 'warning', fixHint: 'Unlock the bounding segment, or shorten its content, to give this segment more room.' },
        timestamp,
      );
    }
    return makeSyncLogEntry(
      syncRunId,
      'lock-preserved-adjustment',
      `Segment ${displayNumber}'s boundary moved ${f.amountSec.toFixed(2)}s to respect a locked neighbour.`,
      { segmentIndex: f.segmentIndex, severity: 'info' },
      timestamp,
    );
  });
}

/**
 * Model P ruling §4.1(a) (2026-08-07) — the lock toggle was REFUSED because
 * granting it would have left an unassignable span between two adjacent
 * locks. Records a declined action: the segment's `locked` flag is unchanged.
 *
 * `segmentIndex`/`conflictIndex` are 0-based into the segments array, matching
 * every other segment-indexed entry; the message uses 1-based display numbers.
 */
export function buildLockRefusedLogEntry(
  syncRunId: string,
  segmentIndex: number,
  conflictIndex: number,
  amountSec: number,
  timestamp: number = Date.now(),
): SyncLogEntry {
  return makeSyncLogEntry(
    syncRunId,
    'lock-refused',
    `Segment ${segmentIndex + 1} was not locked — it would leave ${amountSec.toFixed(2)}s of `
    + `timeline unassigned against already-locked segment ${conflictIndex + 1}.`,
    {
      segmentIndex,
      severity: 'warning',
      fixHint: `Unlock segment ${conflictIndex + 1} first, or close the space between the two before locking.`,
    },
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
 * Rule → summary-sentence builder for `buildGroupedViolationEntry` below.
 * Each `ContractViolation.rule` that ships a validator gets a human, count-
 * shaped one-liner here rather than a generic "N issues of type X" — the
 * per-violation `message` is already segment-specific prose (built for a
 * SINGLE entry), so grouping needs its own summary form, not a truncation of
 * the per-item text. Add one line here per new rule as validators ship;
 * `summarizeGroupedRule`'s fallback covers anything not yet added so a
 * future rule can never go unsummarized.
 */
const GROUPED_RULE_SUMMARIES: Record<string, (count: number) => string> = {
  'loud-fallback-boundary': (n) => `${n} cuts landed on audio that's still playing.`,
  'low-word-coverage': (n) =>
    `${n} scenes matched fewer than ${Math.round(WORD_COVERAGE_MIN_RATIO * 100)}% of their words.`,
};

function summarizeGroupedRule(rule: string, count: number): string {
  const builder = GROUPED_RULE_SUMMARIES[rule];
  if (builder) return builder(count);
  return `${count} issues found — expand for per-item details.`;
}

/**
 * Groups 2+ `ContractViolation`s of the SAME rule (a single sync run's worth
 * — the caller partitions by rule before calling this, one call per group)
 * into ONE `SyncLogEntry` instead of one entry per violation (user-requested
 * grouping, 2026-08-03 — a run with 20+ identical-type violations used to
 * produce 20+ separate log entries). `message` is the summary sentence
 * (`summarizeGroupedRule`); every violation's own message/fixHint/detail
 * survives verbatim on `groupedItems` (types.ts) for the panel's expand
 * affordance and the Copy button's export.
 *
 * `entryType` (default `'warning'`, matching `buildContractViolationEntry`'s
 * convention) lets a caller with its own established entry-type convention
 * keep it under grouping — e.g. the boundary-quality checker's wiring
 * (App.tsx) deliberately logs at `'info'`, not `'warning'` (Phase 1 ships it
 * as observability only; see that call site's own comment), and grouping
 * must not silently change that.
 *
 * `severity` is the MAX across the group ('error' if any violation is
 * 'error', else 'warning' — mirrors `buildContractViolationEntry`'s existing
 * type-'warning'-regardless-of-severity convention for the entry's own
 * `type`, only `severity` reflects the escalation). `fixHint` is the shared
 * hint when every violation in the group carries the identical string, else
 * a generic "expand for per-item details" pointer — a per-item fixHint is
 * still preserved on each `groupedItems` entry either way, this is only the
 * one-line summary's own hint.
 *
 * A single violation is NOT grouped — returns the same plain entry shape
 * `buildContractViolationEntry` would build (at `entryType` instead of
 * always `'warning'`), so a lone finding never gets a pointless one-item
 * dropdown. Returns `undefined` for an empty array (no entry to log).
 */
export function buildGroupedViolationEntry(
  syncRunId: string,
  violations: ContractViolation[],
  timestamp: number = Date.now(),
  entryType: SyncLogEntryType = 'warning',
): SyncLogEntry | undefined {
  if (violations.length === 0) return undefined;
  if (violations.length === 1) {
    const v = violations[0]!;
    return makeSyncLogEntry(syncRunId, entryType, v.message, { severity: v.severity, fixHint: v.fixHint }, timestamp);
  }

  const severity: 'warning' | 'error' = violations.some(v => v.severity === 'error') ? 'error' : 'warning';
  const uniqueFixHints = new Set(violations.map(v => v.fixHint));
  const fixHint = uniqueFixHints.size === 1 ? violations[0]!.fixHint : 'Expand for per-item details.';
  const groupedItems: GroupedLogItem[] = violations.map(v => ({
    message: v.message,
    fixHint: v.fixHint,
    detail: v.detail,
  }));

  return makeSyncLogEntry(
    syncRunId,
    entryType,
    summarizeGroupedRule(violations[0]!.rule, violations.length),
    { severity, fixHint, groupedItems },
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
