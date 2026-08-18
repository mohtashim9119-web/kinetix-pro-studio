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
import type { Project, SyncLogEntry, SyncLogEntryType, SyncRunSummary, GroupedLogItem, VideoSegment } from '../types';
import type { TokenDrop } from './whisperService';
import type { ContractViolation } from './syncContracts';
import type { LockFinding } from './syncEngine';
// WS1 Session J — rule-firing log builders. All four are TYPE-only imports, so
// nothing here pulls a detector (or `@tauri-apps/api`, via forcedAlignmentRun)
// into this module's runtime graph; `syncLog.ts` stays the dependency-light
// service `useWhisper.ts` can import without a cycle.
import type { UnscriptedRun } from './faChunkPlan';
import type { UnspokenScriptFinding } from './faUnspokenGate';
import type { SeamFitFinding } from './faSeamFitGate';
import type { RunPlacementFinding, UtterancePlacementFinding } from './faRunPlacementGate';
import type { FaFallbackReason } from './forcedAlignmentRun';
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
    | 'groupedItems' | 'owningRule' | 'ruleDetail'
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

// ===========================================================================
// WS1 Session J — RULE-FIRING AND ENGINE LOGGING.
//
// THE HOLE THESE CLOSE, stated as what the log could not answer before. A
// completed Apply Sync left no durable record of: which timing engine actually
// produced the boundaries; whether forced alignment ran or silently fell back;
// which rules fired; or on which scenes. All four were `console.warn`s in a dev
// build — absent from `project.syncLog`, from the Sync Log panel, from the Copy
// export, and gone when the window closed. The live acceptance run exists to
// record what the rules did, so it could not have been run against the previous
// logging without producing an unverifiable result.
//
// NO NEW MEASUREMENT HAPPENS HERE, and that is the point. Every number below is
// transcribed from a detector's own finding (`UnspokenScriptFinding`,
// `SeamFitFinding`, `RunPlacementFinding`) or from `computeUnscriptedRuns`'s own
// output, all of which already existed at the call site and were being
// discarded. These builders reformat data; they never derive it. The single
// exception is `buildUnscriptedRunLogEntries`'s segment lookup, which is a
// containment scan over the Model P partition and is documented as such at its
// own site.
//
// ADDITIVE BY CONSTRUCTION: with no rule firing and no FA fallback, every
// function here returns `[]` or is not called, so a run that corrects nothing
// logs exactly what it logged before.
// ===========================================================================

/** Boundary values print to 3 decimals — the precision the committed fixtures
 *  and every audit document use (`663.785` is a real committed value), with
 *  trailing zeros trimmed so a whole-second boundary does not read as
 *  spuriously precise. */
function fmtSec(v: number): string {
  return `${Number(v.toFixed(3))}`;
}

/**
 * WHICH ENGINE RAN — one entry on every audio-timed run, unconditionally.
 *
 * Unconditional on purpose. An entry emitted only when something is wrong
 * cannot answer "did FA run?", because its ABSENCE is ambiguous between "FA
 * ran cleanly" and "this build predates the logging". A line that is always
 * present makes the question answerable from the artifact alone, which is the
 * property the acceptance run needs.
 */
export function buildSyncEngineEntry(
  syncRunId: string,
  engine: 'forced-alignment' | 'whisper',
  tokenCount: number,
  timestamp: number = Date.now(),
): SyncLogEntry {
  return makeSyncLogEntry(
    syncRunId,
    'info',
    engine === 'forced-alignment'
      ? `Timing engine: forced alignment (${tokenCount} aligned word(s)).`
      : `Timing engine: Whisper transcript (${tokenCount} token(s)).`,
    { severity: 'info' },
    timestamp,
  );
}

/** Plain-language cause per failure path, for the log line a user reads. */
const FA_FALLBACK_TEXT: Record<FaFallbackReason, { what: string; fix: string }> = {
  'unsupported-language': {
    what: 'the project language has no forced-alignment model',
    fix: 'Set the project language to English, Spanish, French, Portuguese, or German in Project Settings, or leave high-precision sync off for this project.',
  },
  'empty-chunk-plan': {
    what: 'the chunk plan came out empty (no scene carried any text to align)',
    fix: 'Check that the scene document has text for at least one scene, then run Apply Sync again.',
  },
  'zero-words': {
    what: 'alignment returned no words',
    fix: 'Re-run Apply Sync. If it keeps happening, the voiceover may be silent or unreadable for this language.',
  },
  'inference-error': {
    what: 'the alignment engine reported an error',
    fix: 'Check that the alignment model is installed for this language, then run Apply Sync again.',
  },
};

/**
 * THE FA FALLBACK — the entry that makes fail-clean stop meaning fail-silent.
 *
 * severity 'warning', not 'info': the user turned high-precision sync ON for
 * this project and did not get it. That is a degradation with something they
 * can act on, which is exactly what the severity taxonomy reserves 'warning'
 * for.
 */
export function buildFaFallbackEntry(
  syncRunId: string,
  reason: FaFallbackReason,
  detail: string | undefined,
  timestamp: number = Date.now(),
): SyncLogEntry {
  const { what, fix } = FA_FALLBACK_TEXT[reason];
  return makeSyncLogEntry(
    syncRunId,
    'fa-fallback',
    `High-precision sync was ON but did not run — ${what}. This run used Whisper timing instead.`,
    {
      owningRule: 'FA',
      reason,
      severity: 'warning',
      fixHint: fix,
      ...(detail !== undefined ? { errorMessage: detail } : {}),
    },
    timestamp,
  );
}

/**
 * THE FA PRE-FLIGHT ENTRY (WS1 Session M). Emitted once per Apply Sync when the
 * FA gate is OPEN, BEFORE inference, recording whether forced alignment is ready
 * (runtime + model + resolved language). `info` when ready — the pipeline is set
 * up and there is nothing to do; `warning` when not, carrying the first blocking
 * cause verbatim (`errorMessage`) and the action (`fixHint`), so the user learns
 * a doomed run is doomed before it starts rather than after it finishes.
 *
 * Shape mirrors the `FaPreflightResult` fields the caller already computed; kept
 * in `syncLog.ts` (not `faPreflight.ts`) so every durable-log builder lives in
 * one file, exactly like `buildFaFallbackEntry` above.
 */
export function buildFaPreflightEntry(
  syncRunId: string,
  result: {
    ready: boolean;
    summary: string;
    blockingDetail?: string;
    fixHint?: string;
  },
  timestamp: number = Date.now(),
): SyncLogEntry {
  return makeSyncLogEntry(
    syncRunId,
    'fa-preflight',
    result.summary,
    {
      owningRule: 'FA',
      severity: result.ready ? 'info' : 'warning',
      ...(result.blockingDetail !== undefined ? { errorMessage: result.blockingDetail } : {}),
      ...(result.fixHint !== undefined ? { fixHint: result.fixHint } : {}),
    },
    timestamp,
  );
}

// ---------------------------------------------------------------------------
// THE ONE INDEX CONVENTION FOR RULE-CORRECTION ENTRIES (WS1 Session K, ruling
// R-AO).
//
// `SyncLogEntry.segmentIndex` on a 'rule-correction' entry is ALWAYS an index
// into the COMMITTED array — the scene number the timeline shows and the user
// can navigate to. It is resolved here, in ONE place, by segment id, and never
// copied from a detector's own `segmentIndex`.
//
// WHY THIS EXISTS. The detectors do not agree on an index space and cannot be
// made to: R.10's and R.11's findings are indexed into the COMPLETE pre-skip
// parse (that is the array their detection needs), while R.12's and R.13's are
// indexed into the committed array. Before this function, both were rendered
// by `SyncLogPanel` as "Scene N + 1", so on any corpus where a scene was
// dropped the same displayed number meant two different scenes — measured on
// 173, where R.11 reported `abysmal_opinion` as "scene 6" for a scene the
// timeline shows as scene 5. `types.ts` asserted the conventions were uniform;
// they were not, and the assertion had never been checked against the code.
//
// A scene that is NOT on the committed timeline (R.10 drops two on 173) has no
// committed index, so it gets NO `segmentIndex` at all and its message names
// the scene by tag instead. An absent index is honest; a parse index rendered
// as a timeline scene number is not.
// ---------------------------------------------------------------------------
function committedIndexOf(
  committedSegments: readonly VideoSegment[],
  segmentId: string,
): number | undefined {
  const i = committedSegments.findIndex(s => s.id === segmentId);
  return i >= 0 ? i : undefined;
}

/**
 * R.5 — UNSCRIPTED-AUDIO EXCISION, one entry per excised run.
 *
 * R.5 is the one rule that fires BEFORE inference (inside the chunk plan), so
 * it has no committed-value/corrected-value pair to report; what it has is an
 * audio SPAN it removed from the windows the model was asked to align against.
 * `ruleDetail.spanStartSec`/`spanEndSec` carry that, rather than being crammed
 * into committed/corrected fields that would misdescribe the operation.
 *
 * THE ONE DERIVED NUMBER IN THIS FILE, flagged rather than buried:
 * `UnscriptedRun` carries token indices and an audio span but no segment index,
 * so the owning scene is found by a containment scan over `committedSegments` —
 * which is a gapless partition (Model P), so exactly one segment contains any
 * given time, and the scan cannot be ambiguous. This is an index lookup on data
 * that already exists, not a measurement; it asserts nothing about the boundary.
 * A span that precedes every segment (V6's corpus-start recitation is the real
 * case) resolves to no segment and the entry is logged without a
 * `segmentIndex`, never with a guessed one.
 *
 * WS1 Session K: the scan now runs over the FINAL COMMITTED array, not over
 * `anchorTimed`. The pre-commit array's `startTime`/`duration` are alignment
 * estimates that `snapCoveredBoundaries`, R.11 and R.12 all move afterwards,
 * so scanning it could name a different scene — and its indices are the parse
 * space, which is not what "Scene N" means to a reader. Gaplessness of the
 * wrong array does not make the lookup right.
 */
export function buildUnscriptedRunLogEntries(
  syncRunId: string,
  runs: readonly UnscriptedRun[],
  committedSegments: readonly VideoSegment[],
  timestamp: number = Date.now(),
): SyncLogEntry[] {
  return runs.map(run => {
    const idx = committedSegments.findIndex(
      s => run.startSec >= s.startTime && run.startSec < s.startTime + s.duration,
    );
    const owner = idx >= 0 ? committedSegments[idx] : undefined;
    return makeSyncLogEntry(
      syncRunId,
      'rule-correction',
      `R.5 excised ${fmtSec(run.endSec - run.startSec)}s of unscripted audio at ` +
        `[${fmtSec(run.startSec)}, ${fmtSec(run.endSec)}] from the alignment window.`,
      {
        owningRule: 'R.5',
        ...(idx >= 0 ? { segmentIndex: idx } : {}),
        ...(owner?.text ? { segmentText: owner.text.slice(0, 120) } : {}),
        severity: 'info',
        ruleDetail: {
          spanStartSec: run.startSec,
          spanEndSec: run.endSec,
          reason:
            `Whisper tokens ${run.tokenLo}-${run.tokenHi} are transcribed audio that no scene's ` +
            `script accounts for; the script resumes at word index ${run.qiSplit}.`,
        },
      },
      timestamp,
    );
  });
}

/**
 * R.10 — SCRIPTED TEXT NEVER SPOKEN, one entry per refused scene.
 *
 * These scenes are ALSO logged by the skip path (they are handed to it), so
 * this entry is not what tells the user the scene is missing — it is what tells
 * them WHICH RULE decided that, and on what evidence. The two entries answer
 * different questions and both are wanted.
 */
export function buildUnspokenScriptLogEntries(
  syncRunId: string,
  findings: readonly UnspokenScriptFinding[],
  timestamp: number = Date.now(),
): SyncLogEntry[] {
  return findings.map(f =>
    makeSyncLogEntry(
      syncRunId,
      'rule-correction',
      `R.10 refused the scene ${f.segmentTag ? `tagged ${f.segmentTag}` : `at script position ${f.segmentIndex + 1}`} ` +
        `(script position ${f.segmentIndex + 1}, not on the timeline) — ` +
        'its script text is never spoken in the audio.',
      {
        // NO `segmentIndex`: R.10's scenes are DROPPED, so they have no
        // committed index, and the panel renders this field as a timeline
        // scene number. The script position is stated in the message instead.
        owningRule: 'R.10',
        ...(f.segmentTag ? { segmentTag: f.segmentTag } : {}),
        severity: 'info',
        ruleDetail: {
          reason:
            `Loudest forced-alignment word confidence across the scene's ${f.faWordCount} word(s) ` +
            `was ${f.maxWordConfidence.toExponential(3)} — no acoustic evidence the text was voiced.`,
        },
      },
      timestamp,
    ),
  );
}

/**
 * R.11 — CHUNK-FIT BOUNDARY CORRECTION, one entry per corrected boundary.
 */
export function buildSeamFitLogEntries(
  syncRunId: string,
  findings: readonly SeamFitFinding[],
  committedSegments: readonly VideoSegment[],
  timestamp: number = Date.now(),
): SyncLogEntry[] {
  return findings.map(f => {
    // `SeamFitFinding.segmentIndex` is a PRE-SKIP parse index; the log's is a
    // committed one. Resolved by id — never copied. See `committedIndexOf`.
    const ci = committedIndexOf(committedSegments, f.segmentId);
    return makeSyncLogEntry(
      syncRunId,
      'rule-correction',
      `R.11 moved ${ci !== undefined ? `scene ${ci + 1}` : 'a scene'}${f.segmentTag ? ` (${f.segmentTag})` : ''} ` +
        `from ${fmtSec(f.committedValue)}s to ${fmtSec(f.correctedValue)}s ` +
        `(${f.delta >= 0 ? '+' : ''}${fmtSec(f.delta)}s).`,
      {
        owningRule: 'R.11',
        ...(ci !== undefined ? { segmentIndex: ci } : {}),
        ...(f.segmentTag ? { segmentTag: f.segmentTag } : {}),
        severity: 'info',
        ruleDetail: {
          committedValue: f.committedValue,
          correctedValue: f.correctedValue,
          reason:
            `Chunk ${f.chunkIndex} [${fmtSec(f.chunkStartSec)}, ${fmtSec(f.chunkEndSec)}] fits its script ` +
            `${fmtSec(f.fitDeviation)}x off; the committed boundary sat on a word seam carrying only ` +
            `${f.spanMaxConfidence.toExponential(3)} confidence, so it was re-anchored to the chunk's ` +
            `${f.edge} edge.`,
        },
      },
      timestamp,
    );
  });
}

/**
 * R.12 — THE ATOMIC-RUN INVARIANT, one entry per corrected boundary.
 *
 * The rule with the largest measured effect on the corpus (nine defects on v6,
 * five of them independently scored wrong by ear before it existed), so its
 * entry carries the full placement evidence: which run the boundary had fallen
 * inside, the only legal interval it could move to, and whether it landed on a
 * real silence's midpoint or on the fallback.
 */
export function buildRunPlacementLogEntries(
  syncRunId: string,
  findings: readonly RunPlacementFinding[],
  committedSegments: readonly VideoSegment[],
  timestamp: number = Date.now(),
): SyncLogEntry[] {
  return findings.map(f => {
    // `RunPlacementFinding.segmentIndex` is already a committed index, but it
    // is re-resolved by id anyway so that EVERY rule-correction entry gets its
    // number from the same place and no future detector can quietly reintroduce
    // a second convention.
    const ci = committedIndexOf(committedSegments, f.segmentId);
    return makeSyncLogEntry(
      syncRunId,
      'rule-correction',
      `R.12 moved ${ci !== undefined ? `scene ${ci + 1}` : 'a scene'}${f.segmentTag ? ` (${f.segmentTag})` : ''} ` +
        `from ${fmtSec(f.committedValue)}s to ${fmtSec(f.correctedValue)}s ` +
        `(${f.delta >= 0 ? '+' : ''}${fmtSec(f.delta)}s) — it had landed inside unscripted audio.`,
      {
        owningRule: 'R.12',
        ...(ci !== undefined ? { segmentIndex: ci } : {}),
        ...(f.segmentTag ? { segmentTag: f.segmentTag } : {}),
        severity: 'info',
        ruleDetail: {
          committedValue: f.committedValue,
          correctedValue: f.correctedValue,
          reason:
            `The boundary lay strictly inside unscripted run ${f.runIndex} ` +
            `[${fmtSec(f.runStartSec)}, ${fmtSec(f.runEndSec)}]. The only legal interval is ` +
            `[${fmtSec(f.gapStartSec)}, ${fmtSec(f.gapEndSec)}]; placed by ${f.placement}` +
            (f.backingSilence
              ? ` on silence [${fmtSec(f.backingSilence.startSec)}, ${fmtSec(f.backingSilence.endSec)}].`
              : '.'),
        },
      },
      timestamp,
    );
  });
}

/**
 * R.13 — THE ATOMIC-UTTERANCE INVARIANT (the closing half of R.12), one entry
 * per corrected boundary.
 *
 * Carries the same evidence shape as R.12's entry so the pair reads as a pair:
 * which run the carrier holds, where the carrier's own line actually ends
 * (the anchor the correction is derived from), and which detected silence
 * backed the placement.
 */
export function buildUtterancePlacementLogEntries(
  syncRunId: string,
  findings: readonly UtterancePlacementFinding[],
  committedSegments: readonly VideoSegment[],
  timestamp: number = Date.now(),
): SyncLogEntry[] {
  return findings.map(f => {
    const ci = committedIndexOf(committedSegments, f.segmentId);
    return makeSyncLogEntry(
      syncRunId,
      'rule-correction',
      `R.13 moved ${ci !== undefined ? `scene ${ci + 1}` : 'a scene'}${f.segmentTag ? ` (${f.segmentTag})` : ''} ` +
        `from ${fmtSec(f.committedValue)}s to ${fmtSec(f.correctedValue)}s ` +
        `(${f.delta >= 0 ? '+' : ''}${fmtSec(f.delta)}s) — it had cut into the previous scene's own line.`,
      {
        owningRule: 'R.13',
        ...(ci !== undefined ? { segmentIndex: ci } : {}),
        ...(f.segmentTag ? { segmentTag: f.segmentTag } : {}),
        severity: 'info',
        ruleDetail: {
          committedValue: f.committedValue,
          correctedValue: f.correctedValue,
          reason:
            `Scene ${f.carrierTag ?? f.carrierId} carries unscripted run ${f.runIndex} ` +
            `[${fmtSec(f.runStartSec)}, ${fmtSec(f.runEndSec)}] and speaks its own line after it, ` +
            `ending at ${fmtSec(f.utteranceEndSec)}s — the earliest legal value for this boundary. ` +
            `Placed by ${f.placement}` +
            (f.backingSilence
              ? ` on silence [${fmtSec(f.backingSilence.startSec)}, ${fmtSec(f.backingSilence.endSec)}].`
              : '.'),
        },
      },
      timestamp,
    );
  });
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
