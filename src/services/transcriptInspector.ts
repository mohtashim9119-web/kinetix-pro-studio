// Transcript Inspector (sync pipeline v2, Phase 1b — docs/sync-pipeline-v2-plan.md).
// Pure computation behind the dev-only `window.__transcriptInspector` global
// wired in App.tsx (same DEV-gated pattern as `window.__calibrateBoundaryQuality`).
// Purpose: let the owner SEE the raw material — Whisper's per-token timestamps
// against the detected-silence intervals exactly as the pipeline receives them —
// not score it. This is the instrument Phase 1b's Stage 1 lock gate depends on.
import type { TranscriptToken } from '../types';
import type { SilenceInterval } from './silenceDetector';
import type { TokenDrop } from './whisperService';
import { normalize } from './whisperService';

export interface TranscriptInspectorTokenRow {
  index: number;
  text: string;
  startSec: number;
  endSec: number;
  durationSec: number;
  /** null for the first token (no predecessor). */
  gapToPrevTokenSec: number | null;
  /** End of the nearest preceding detected silence, or null if none exists. */
  nearestPrecedingSilenceEndSec: number | null;
  /**
   * SMEAR ESTIMATE — startSec minus the nearest preceding silence's endSec.
   * Sign convention: negative = the declared start precedes the end of the
   * pause before it (the segment-96 pathology — Whisper assigns the pause's
   * onset to the following word). null when no preceding silence exists.
   */
  smearSec: number | null;
}

export type DropReasonBreakdown = Record<TokenDrop['reason'], number>;

const DROP_REASONS: TokenDrop['reason'][] = [
  'non-finite',
  'negative-start',
  'inverted-or-zero-duration',
  'past-audio-end',
  'empty-text',
];

/**
 * "Nearest preceding silence" for a token is the LAST silence (by start time)
 * that starts before this token's own declared END — not before its start.
 * This deliberately admits the overlap case: when smear is severe enough that
 * a word's declared span starts before, or during, the pause that (in the
 * real audio) precedes it, the silence still counts as "the pause before it."
 * Restricting to `silence.endSec <= token.startSec` would make a negative
 * smear arithmetically impossible, which defeats the whole point of the
 * metric — verified against the real seg-96→97 fixture (syncTiming.test.ts):
 * silence [289.380, 289.960], token "predator" [289.260, 289.800] — the
 * silence's own START (289.380) falls inside "predator"'s declared span, so
 * `silence.startSec < token.endSec` is what picks it out as "predator"'s
 * nearest preceding silence, producing the expected negative smear.
 */
function findNearestPrecedingSilenceIndex(sortedSilences: SilenceInterval[], tokenEndSec: number): number {
  let lo = 0;
  let hi = sortedSilences.length - 1;
  let result = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (sortedSilences[mid]!.startSec < tokenEndSec) {
      result = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return result;
}

/**
 * Per-token inspector rows. `tokens` should be the FILTERED (post-
 * `filterMalformedTokens`) array — the same one every downstream pipeline
 * stage reads — so row indices line up with what the pipeline actually sees.
 * Pure; does not mutate either input. Binary-searches per token (not a
 * stateful two-pointer) so it stays correct even if Whisper emits occasional
 * overlapping/non-monotonic token timestamps.
 */
export function buildTranscriptInspectorRows(
  tokens: TranscriptToken[],
  silences: SilenceInterval[],
): TranscriptInspectorTokenRow[] {
  const sortedSilences = [...silences].sort((a, b) => a.startSec - b.startSec);
  const rows: TranscriptInspectorTokenRow[] = [];
  let prevEnd: number | null = null;

  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i]!;
    const silenceIdx = findNearestPrecedingSilenceIndex(sortedSilences, t.endSec);
    const nearest = silenceIdx >= 0 ? sortedSilences[silenceIdx]! : null;

    rows.push({
      index: i,
      text: t.text,
      startSec: t.startSec,
      endSec: t.endSec,
      durationSec: t.endSec - t.startSec,
      gapToPrevTokenSec: prevEnd !== null ? t.startSec - prevEnd : null,
      nearestPrecedingSilenceEndSec: nearest ? nearest.endSec : null,
      smearSec: nearest ? t.startSec - nearest.endSec : null,
    });
    prevEnd = t.endSec;
  }

  return rows;
}

export interface TranscriptInspectorAggregates {
  /** Tokens with a defined smearSec — i.e. tokens with a nearest preceding silence. */
  pauseFollowingTokenCount: number;
  medianSmearSec: number | null;
  p95SmearSec: number | null;
  /** Count of pause-following tokens whose smear is negative (segment-96 pathology). */
  negativeSmearCount: number;
  /** negativeSmearCount / pauseFollowingTokenCount, or null when there are no pause-following tokens. */
  negativeSmearFraction: number | null;
}

function percentile(sortedAsc: number[], p: number): number | null {
  if (sortedAsc.length === 0) return null;
  if (sortedAsc.length === 1) return sortedAsc[0]!;
  const idx = p * (sortedAsc.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sortedAsc[lo]!;
  const frac = idx - lo;
  return sortedAsc[lo]! * (1 - frac) + sortedAsc[hi]! * frac;
}

export function computeSmearAggregates(rows: TranscriptInspectorTokenRow[]): TranscriptInspectorAggregates {
  const smears: number[] = [];
  for (const r of rows) {
    if (r.smearSec !== null) smears.push(r.smearSec);
  }
  const sorted = [...smears].sort((a, b) => a - b);
  const negativeSmearCount = smears.reduce((n, s) => (s < 0 ? n + 1 : n), 0);

  return {
    pauseFollowingTokenCount: smears.length,
    medianSmearSec: percentile(sorted, 0.5),
    p95SmearSec: percentile(sorted, 0.95),
    negativeSmearCount,
    negativeSmearFraction: smears.length > 0 ? negativeSmearCount / smears.length : null,
  };
}

export function summarizeDropsByReason(drops: TokenDrop[]): DropReasonBreakdown {
  const out: DropReasonBreakdown = {
    'non-finite': 0,
    'negative-start': 0,
    'inverted-or-zero-duration': 0,
    'past-audio-end': 0,
    'empty-text': 0,
  };
  for (const d of drops) out[d.reason]++;
  return out;
}

function csvEscape(s: string): string {
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function tokenRowsToCsv(rows: TranscriptInspectorTokenRow[]): string {
  const header = [
    'index', 'text', 'startSec', 'endSec', 'durationSec',
    'gapToPrevTokenSec', 'nearestPrecedingSilenceEndSec', 'smearSec',
  ];
  const lines = [header.join(',')];
  for (const r of rows) {
    lines.push([
      String(r.index),
      csvEscape(r.text),
      r.startSec.toFixed(3),
      r.endSec.toFixed(3),
      r.durationSec.toFixed(3),
      r.gapToPrevTokenSec !== null ? r.gapToPrevTokenSec.toFixed(3) : '',
      r.nearestPrecedingSilenceEndSec !== null ? r.nearestPrecedingSilenceEndSec.toFixed(3) : '',
      r.smearSec !== null ? r.smearSec.toFixed(3) : '',
    ].join(','));
  }
  return lines.join('\n');
}

/** One inspector "run" — a snapshot of tokens/silences at one point in time,
 *  labeled so `.compare()` can print something meaningful. */
export interface TranscriptInspectorRun {
  label: string;
  timestamp: number;
  audioDurationSec: number;
  totalTokens: number;
  skippedTokenCount: number;
  dropBreakdown: DropReasonBreakdown;
  silenceCount: number;
  rows: TranscriptInspectorTokenRow[];
  aggregates: TranscriptInspectorAggregates;
}

export function buildTranscriptInspectorRun(params: {
  label: string;
  /** FILTERED (post-filterMalformedTokens) tokens — what the pipeline actually sees. */
  tokens: TranscriptToken[];
  drops: TokenDrop[];
  totalTokens: number;
  silences: SilenceInterval[];
  audioDurationSec: number;
}): TranscriptInspectorRun {
  const rows = buildTranscriptInspectorRows(params.tokens, params.silences);
  return {
    label: params.label,
    timestamp: Date.now(),
    audioDurationSec: params.audioDurationSec,
    totalTokens: params.totalTokens,
    skippedTokenCount: params.drops.length,
    dropBreakdown: summarizeDropsByReason(params.drops),
    silenceCount: params.silences.length,
    rows,
    aggregates: computeSmearAggregates(rows),
  };
}

/**
 * Word+occurrence key for a row — normalized text via the SAME `normalize`
 * the aligner uses, joined with its 0-based occurrence count within the run.
 * Comparisons across runs must never key by token index: a model/arg swap
 * changes the token count (fewer/more malformed drops), which shifts every
 * later index (docs/sync-pipeline-v2-plan.md Part C, "Index-keyed references
 * break after Phase 3").
 */
function keyRowsByWordOccurrence(rows: TranscriptInspectorTokenRow[]): Map<string, TranscriptInspectorTokenRow> {
  const counts = new Map<string, number>();
  const out = new Map<string, TranscriptInspectorTokenRow>();
  for (const row of rows) {
    const words = normalize(row.text);
    const norm = words.length > 0 ? words.join(' ') : row.text.toLowerCase();
    const occurrence = counts.get(norm) ?? 0;
    counts.set(norm, occurrence + 1);
    out.set(`${norm}#${occurrence}`, row);
  }
  return out;
}

export interface TranscriptInspectorTokenComparisonRow {
  key: string;
  textA: string | null;
  textB: string | null;
  smearA: number | null;
  smearB: number | null;
  /** smearB - smearA, only when both sides have a defined smear. */
  deltaSmearSec: number | null;
}

/**
 * Side-by-side token comparison across two runs, keyed by normalized word +
 * occurrence (never by index — see `keyRowsByWordOccurrence`). Works for two
 * runs on the SAME audio (different transcription args) and, degenerately,
 * for two runs on DIFFERENT audio (most keys will only match on one side —
 * the aggregate comparison is the more meaningful signal for that case).
 */
export function compareTranscriptInspectorRuns(
  runA: TranscriptInspectorRun,
  runB: TranscriptInspectorRun,
): TranscriptInspectorTokenComparisonRow[] {
  const mapA = keyRowsByWordOccurrence(runA.rows);
  const mapB = keyRowsByWordOccurrence(runB.rows);
  const allKeys = new Set<string>([...mapA.keys(), ...mapB.keys()]);

  const out: TranscriptInspectorTokenComparisonRow[] = [];
  for (const key of allKeys) {
    const a = mapA.get(key) ?? null;
    const b = mapB.get(key) ?? null;
    out.push({
      key,
      textA: a?.text ?? null,
      textB: b?.text ?? null,
      smearA: a?.smearSec ?? null,
      smearB: b?.smearSec ?? null,
      deltaSmearSec: a?.smearSec != null && b?.smearSec != null ? b.smearSec - a.smearSec : null,
    });
  }
  out.sort((x, y) => x.key.localeCompare(y.key));
  return out;
}

export { DROP_REASONS };
