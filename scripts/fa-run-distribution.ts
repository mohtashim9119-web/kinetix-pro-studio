/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// ---------------------------------------------------------------------------
// WS1 Task 5 Slice D13 Step 1 — run-distribution + runs-vs-chunks
// reconciliation diagnostic.
//
// PROVENANCE REPAIR. `docs/work-in-progress.md` §6's attribution-isolation
// paragraph (original source measurements/d11-chunked-alignment-2026-08-13.md
// §4, deleted 2026-08-14, `9cf5867`; retrieve: `git show
// 251be64:docs/ws1-sync-pipeline/measurements/d11-chunked-alignment-2026-08-13.md`)
// cites "a 240s-run
// median of 3.12s — see the earlier Step 3(a) run-distribution measurement",
// but Slice D12 shipped no committed artifact that reproduces that table: the
// number lived only in a chat transcript, which `CLAUDE.md` §5's
// "Audit/investigation reports must be persisted into `docs/`" rule forbids
// depending on. This script is that artifact.
//
// It also answers a question D11's own doc never reconciled: `computeFaAnchors`
// emits N raw runs but `computeFaChunkPlan` emits M < N chunks (46 -> 32 at
// 240s; 149 -> 97 at 709s). The gap is entirely `runsToChunks`'s empty-run
// merging (a run no segment's `startTime` lands in has no text, so its audio
// window is folded into an adjacent chunk rather than sent to Rust as an
// empty-text chunk `text_to_token_ids` would reject) — this script counts that
// directly instead of leaving it as an unexplained discrepancy.
//
// NOT part of `npm test`/`npm run build`. Pure TS over the gitignored replay
// fixture — no ONNX, no model, no audio decode, runs in well under a second.
//   npx tsx scripts/fa-run-distribution.ts
// ---------------------------------------------------------------------------

import { readFileSync } from 'fs';
import { computeRuns } from '../src/services/faChunkPlan';
import { computeFaChunkPlan } from '../src/services/faChunkPlan';
import type { FaRun } from '../src/services/faAnchors';
import type { TranscriptToken, VideoSegment } from '../src/types';
import type { SilenceInterval } from '../src/services/silenceDetector';

const FIXTURE_DIR = '.work-phase4/replay/173';

interface RawFinalSegment {
  id: string;
  text: string;
  startTime: number;
  duration: number;
}
interface RawToken {
  text: string;
  start: number;
  end: number;
}
interface RawSilence {
  startSec: number;
  endSec: number;
}

function loadSegments(): VideoSegment[] {
  const d = JSON.parse(readFileSync(`${FIXTURE_DIR}/golden_baseline_segments.json`, 'utf-8'));
  return (d.finalSegments as RawFinalSegment[]).map(
    s =>
      ({
        id: s.id,
        text: s.text,
        startTime: s.startTime,
        duration: s.duration,
        transition: 'none',
        animation: 'none',
        order: 0,
      }) as VideoSegment,
  );
}
function loadTokens(): TranscriptToken[] {
  const raw = JSON.parse(readFileSync(`${FIXTURE_DIR}/transcript_tokens.json`, 'utf-8')) as RawToken[];
  return raw.map(t => ({ startSec: t.start, endSec: t.end, text: t.text }));
}
function loadSilences(): SilenceInterval[] {
  const d = JSON.parse(readFileSync(`${FIXTURE_DIR}/silences_app.json`, 'utf-8'));
  return (d.silences as RawSilence[]).map(s => ({ startSec: s.startSec, endSec: s.endSec }));
}

function percentile(sorted: readonly number[], p: number): number {
  if (sorted.length === 0) return NaN;
  const idx = Math.min(Math.round((sorted.length - 1) * p), sorted.length - 1);
  return sorted[idx]!;
}

/** How many runs carry no segment text — the exact count `runsToChunks` folds
 *  away, and therefore the exact reconciliation between `runs` and `chunks`.
 *  Mirrors `runsToChunks`'s own two-pointer attribution scan (faChunkPlan.ts)
 *  rather than re-deriving a different rule. */
function emptyRunCount(runs: readonly FaRun[], segments: readonly VideoSegment[]): number {
  const hasText: boolean[] = runs.map(() => false);
  let runIdx = 0;
  for (const seg of segments) {
    if (!seg.text || !seg.text.trim()) continue;
    while (runIdx < runs.length - 1 && seg.startTime >= runs[runIdx]!.windowEnd) runIdx++;
    hasText[runIdx] = true;
  }
  return hasText.filter(h => !h).length;
}

function report(label: string, segments: VideoSegment[], tokens: TranscriptToken[], silences: SilenceInterval[], audioDuration: number): void {
  const runs = computeRuns(segments, tokens, silences, audioDuration);
  // Pinned to 'segment-start-time' explicitly (WS1 Task 5 Slice D23):
  // computeFaChunkPlan's own default flipped to index attribution this
  // slice, but emptyRunCount below mirrors runsToChunks's own
  // segment-start-time-specific scan, so this report is only meaningful
  // against that same rule.
  const chunks = computeFaChunkPlan(segments, tokens, silences, audioDuration, 'segment-start-time');

  const durations = runs.map(r => r.windowEnd - r.windowStart).sort((a, b) => a - b);
  const provenance = new Map<string, number>();
  for (const r of runs) {
    for (const p of [r.startProvenance, r.endProvenance]) {
      provenance.set(p, (provenance.get(p) ?? 0) + 1);
    }
  }
  const empties = emptyRunCount(runs, segments);

  console.log(`\n=== ${label} ===`);
  console.log(`audioDuration=${audioDuration.toFixed(2)}s segments=${segments.length} tokens=${tokens.length} silences=${silences.length}`);
  console.log(`runs=${runs.length}  chunks=${chunks.length}  empty(text-less) runs=${empties}  reconciles=${runs.length - empties === chunks.length}`);
  console.log(
    `run duration (s): min=${durations[0]!.toFixed(2)} p50=${percentile(durations, 0.5).toFixed(2)} ` +
      `p90=${percentile(durations, 0.9).toFixed(2)} p99=${percentile(durations, 0.99).toFixed(2)} max=${durations[durations.length - 1]!.toFixed(2)}`,
  );
  const chunkDurations = chunks.map(c => c.endSec - c.startSec).sort((a, b) => a - b);
  console.log(
    `chunk duration (s): min=${chunkDurations[0]!.toFixed(2)} p50=${percentile(chunkDurations, 0.5).toFixed(2)} ` +
      `p90=${percentile(chunkDurations, 0.9).toFixed(2)} p99=${percentile(chunkDurations, 0.99).toFixed(2)} max=${chunkDurations[chunkDurations.length - 1]!.toFixed(2)}`,
  );
  console.log(`boundary provenance counts: ${[...provenance.entries()].map(([k, v]) => `${k}=${v}`).join(' ')}`);
}

function main(): void {
  const allSegments = loadSegments();
  const allTokens = loadTokens();
  const allSilences = loadSilences();

  // 240s excerpt — the same cutoff `dump-fa-chunk-plan-ladder.ts` uses, so
  // this table describes exactly the plan the D12/D13 measurements ran on.
  const CUTOFF_SEC = 240;
  const exSegments = allSegments.filter(s => s.startTime < CUTOFF_SEC);
  const exDuration = Math.max(...exSegments.map(s => s.startTime + s.duration));
  report(
    '240s excerpt',
    exSegments,
    allTokens.filter(t => t.startSec < exDuration),
    allSilences.filter(s => s.startSec < exDuration),
    exDuration,
  );

  // Full 709s project — the length D11 §3 reported 97 chunks for.
  const fullDuration = Math.max(...allSegments.map(s => s.startTime + s.duration));
  report('full project', allSegments, allTokens, allSilences, fullDuration);
}

main();
