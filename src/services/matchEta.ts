/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * matchEta.ts — conditional measured-ETA for the Hirschberg matcher (WS2
 * Wave 2 Group 2 completion, Unit 3, operator-approved).
 *
 * `alignQueryToSubject` (`whisperService.ts`) is O(n*m) in query/subject
 * word count (`docs/ws1-sync-pipeline/final-shape-mapping-2026-09-18.md`
 * §M3.6). This session re-measured it twice — once contaminated by a
 * concurrent CPU-bound test run (discarded), once clean — at:
 *
 *   500-scene / 30-min,  4500/4500 words: mean 3152.7ms (3067-3238ms, 2 runs)
 *   1000-scene / 60-min, 9000/9000 words: mean 12242.2ms (12201-12283ms, 2 runs)
 *
 * FITTED, not looked up: both samples are used to estimate the single free
 * parameter of `ms = k * queryWords * subjectWords` (k = ms / cells,
 * averaged across the two samples) rather than interpolating between
 * exactly these two word counts — this generalizes to any query/subject
 * size, including the common case where they differ (script words vs.
 * transcript words are rarely equal, unlike this benchmark's synthetic
 * fixture, which used equal-length query/subject for a clean O(n*m) scaling
 * check).
 *
 * Scope (operator ruling): additive only. No cap, no behavior change below
 * the threshold, never blocks or delays the match itself — this estimates a
 * wall-clock duration for a status line, nothing else. `computeRunContext`
 * item 1's memo and item 2's worker migration are what make a long match
 * survivable; this is purely "tell the user it's expected to take a while."
 */

const MEASURED_SAMPLES: ReadonlyArray<{ words: number; ms: number }> = [
  { words: 4500, ms: 3152.7 },
  { words: 9000, ms: 12242.2 },
];

/** ms per (query word x subject word) cell, averaged across the measured
 *  samples above (each sample's own k = ms / words^2, since both samples
 *  used equal query/subject length). */
const FITTED_MS_PER_CELL =
  MEASURED_SAMPLES.reduce((sum, s) => sum + s.ms / (s.words * s.words), 0) / MEASURED_SAMPLES.length;

/**
 * Threshold above which the sync UI surfaces a stage status line instead of
 * staying silent (operator-approved scope: "when estimated match time >
 * ~2s"). Logged here, not picked silently elsewhere: ~2s is roughly the
 * point a plain spinner starts reading as "is this stuck?" rather than
 * "this is instant" — the same order of magnitude the export pipeline's own
 * progress UI treats as "worth naming the stage" (no hard research behind
 * the exact number; it is a UX judgment call, named so a future session can
 * revisit it instead of rediscovering it).
 */
export const MATCH_ETA_THRESHOLD_MS = 2000;

/** Estimates the Hirschberg pass's wall-clock duration for a
 *  `queryWordCount x subjectWordCount` match, from the fitted model above. */
export function estimateMatchMs(queryWordCount: number, subjectWordCount: number): number {
  if (queryWordCount <= 0 || subjectWordCount <= 0) return 0;
  return FITTED_MS_PER_CELL * queryWordCount * subjectWordCount;
}

/**
 * The stage status line's copy — a single swappable block per the operator's
 * request ("propose copy in a swappable block"), so wording can change
 * without touching the estimation logic or its call sites.
 */
export function matchEtaMessage(estimatedMs: number): string {
  const seconds = Math.max(1, Math.round(estimatedMs / 1000));
  return `Matching a long script — about ${seconds}s.`;
}

/** Returns the stage message when `estimatedMs` clears the threshold, else
 *  `null` (no status line, no behavior change) — the one function App.tsx
 *  actually calls. */
export function matchEtaStageMessage(queryWordCount: number, subjectWordCount: number): string | null {
  const estimatedMs = estimateMatchMs(queryWordCount, subjectWordCount);
  if (estimatedMs <= MATCH_ETA_THRESHOLD_MS) return null;
  return matchEtaMessage(estimatedMs);
}
