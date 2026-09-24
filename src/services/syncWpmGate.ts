/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// ---------------------------------------------------------------------------
// G4 Unit 3 — PRE-sync total WPM sanity check (STATUS.md Wave 2 queue item 2,
// operator design; see syncConstants.ts's own header for the two-check split
// this is one half of). Runs BEFORE any transcription/FA compute — script
// total word count and audio duration are both already known at parse time,
// so this is a cheap, synchronous check that can catch the "planted 100
// extra words" class of script/audio mismatch before a single second of
// compute is spent aligning text that was never spoken.
//
// WARN-ONLY: never blocks Apply Sync, never auto-switches sync engine. Copy
// blocks below are swappable — flagged for operator sign-off (G4 Unit 3
// report), not load-bearing logic.
// ---------------------------------------------------------------------------

import { WPM_NORMAL_MIN, WPM_NORMAL_MAX, WPM_HARD_IMPOSSIBLE_MIN } from './syncConstants';
import { makeSyncLogEntry } from './syncLog';
import type { SyncLogEntry } from '../types';

export type WpmBand = 'normal' | 'soft-slow' | 'soft-fast' | 'hard-fast';

export interface WpmCheckResult {
  /** Script words per minute over the whole audio — 0 when either input is
   *  degenerate (no words, or no audio duration), which always classifies
   *  as 'normal' (nothing to warn about with no usable signal). */
  wpm: number;
  band: WpmBand;
  totalWords: number;
  audioDurationSec: number;
}

/** Pure classification — no logging, directly unit-testable without a
 *  SyncLogEntry's id/timestamp machinery. */
export function classifyScriptWpm(totalWords: number, audioDurationSec: number): WpmCheckResult {
  if (!(audioDurationSec > 0) || totalWords <= 0) {
    return { wpm: 0, band: 'normal', totalWords, audioDurationSec };
  }
  const wpm = (totalWords / audioDurationSec) * 60;
  const band: WpmBand =
    wpm > WPM_HARD_IMPOSSIBLE_MIN ? 'hard-fast'
    : wpm > WPM_NORMAL_MAX ? 'soft-fast'
    : wpm < WPM_NORMAL_MIN ? 'soft-slow'
    : 'normal';
  return { wpm, band, totalWords, audioDurationSec };
}

/** SWAPPABLE COPY BLOCKS (operator sign-off, G4 Unit 3 report) — every
 *  non-normal band's user-facing message + fix hint, kept as one table so a
 *  copy change is a one-line edit here rather than a scattered string hunt. */
export const WPM_CHECK_COPY: Record<Exclude<WpmBand, 'normal'>, (r: WpmCheckResult) => { message: string; fixHint: string }> = {
  'soft-slow': (r) => ({
    message: `This script reads at ${r.wpm.toFixed(0)} words/min over its audio — slower than typical narration ` +
      `(${WPM_NORMAL_MIN}-${WPM_NORMAL_MAX}).`,
    fixHint: 'If this seems off, double-check the script and the audio file are the right pair for this project.',
  }),
  'soft-fast': (r) => ({
    message: `This script reads at ${r.wpm.toFixed(0)} words/min over its audio — faster than typical narration ` +
      `(${WPM_NORMAL_MIN}-${WPM_NORMAL_MAX}).`,
    fixHint: 'If this seems off, double-check the script and the audio file are the right pair for this project.',
  }),
  'hard-fast': (r) => ({
    message: `Check your files: this script reads at ${r.wpm.toFixed(0)} words/min over its audio — far beyond ` +
      `anything a real narration could sustain (typical is ${WPM_NORMAL_MIN}-${WPM_NORMAL_MAX}).`,
    fixHint: 'The script likely has leftover, duplicated, or extra text that doesn\'t match this audio — check both files before syncing.',
  }),
};

/**
 * `undefined` when the band is 'normal' — a clean run's log stays
 * unchanged, matching every other warn-only gate in this pipeline (silence-
 * error, malformed-token, word-coverage, scene-density all follow the same
 * "only log when there's something to say" convention).
 */
export function buildWpmCheckLogEntry(
  syncRunId: string,
  totalWords: number,
  audioDurationSec: number,
  timestamp: number = Date.now(),
): SyncLogEntry | undefined {
  const result = classifyScriptWpm(totalWords, audioDurationSec);
  if (result.band === 'normal') return undefined;

  const { message, fixHint } = WPM_CHECK_COPY[result.band](result);
  return makeSyncLogEntry(syncRunId, 'warning', message, {
    severity: 'warning',
    fixHint,
    finding: { kind: 'wpm' },
  }, timestamp);
}
