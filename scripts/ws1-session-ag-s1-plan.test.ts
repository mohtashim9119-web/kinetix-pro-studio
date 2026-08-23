/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// ---------------------------------------------------------------------------
// WS1 Session AG — STEP 4. BUILD THE S1 CHUNK PLAN, AND RUN THE CASCADE CHECK.
//
// Emits `.work-phase4/replay/<corpus>/fa_s1_chunks.json` — the SAME production
// four-argument plan the bundle's own `fa_live_chunks.json` records, with
// `foldPhantomTails` ON. That file is then aligned by `fa_onnx.rs`'s
// `session_p_regen` harness (`FA_REGEN_PLAN=fa_s1_chunks.json`) against the
// SAME `audio_16k.wav`, so the only difference between the two FA word arms is
// S1 itself.
//
// CASCADE CHECK, which the brief requires BEFORE any other measurement:
//   * how many chunks fold at all;
//   * how many folds EMPTY their source run (all its text moved on);
//   * how many folds CHAIN — a fold at run i+1 carrying qi that the fold at
//     run i had already moved, i.e. text propagating across more than one
//     chunk boundary.
//
// READ-MOSTLY: writes only into `.work-phase4/replay/<corpus>/fa_s1_chunks.json`
// and `.work-phase4/session-ag/`. It never touches a stamped bundle arm.
//
// Gated:
//   WS1_SESSION_AG_MEASURE=1 npx vitest run scripts/ws1-session-ag-s1-plan.test.ts
// ---------------------------------------------------------------------------

import { describe, it } from 'vitest';
import { writeFileSync, mkdirSync, readFileSync } from 'fs';
import { resolve } from 'path';

import { CORPORA, runProductionPath, REPO, REPLAY_ROOT } from './ws1-session-p-pipeline.js';
import { computeFaChunkPlan, type FoldDiagnostics } from '../src/services/faChunkPlan';

const MEASURE = process.env.WS1_SESSION_AG_MEASURE === '1';
const OUT = resolve(REPO, '.work-phase4/session-ag');

describe.skipIf(!MEASURE)('WS1 Session AG Step 4 — S1 chunk plan + cascade check', () => {
  it('builds the folded plan for every corpus and reports the cascade', async () => {
    mkdirSync(OUT, { recursive: true });
    const L: string[] = [];
    const report: Record<string, unknown> = {};

    for (const key of ['v6', '173', 'spanish'] as const) {
      const spec = CORPORA[key]!;
      const run = await runProductionPath(spec);
      const base = run.chunks;

      const fold: FoldDiagnostics = { folds: [] };
      const s1 = computeFaChunkPlan(
        run.anchorTimed, run.whisperTokens, run.silences, spec.audioDuration,
        'script-word-index', undefined, undefined,
        true, fold,
      );

      // ---- CASCADE ------------------------------------------------------
      const emptied = fold.folds.filter(f => f.remainingWords === 0);
      const byRun = new Map(fold.folds.map(f => [f.runIndex, f]));
      const chained = fold.folds.filter(f => {
        const prev = byRun.get(f.runIndex - 1);
        if (prev === undefined) return false;
        const prevQi = new Set(prev.movedQiStarts);
        return f.movedQiStarts.some(q => prevQi.has(q));
      });

      const wordsMoved = fold.folds.reduce((n, f) => n + f.movedWords.length, 0);
      const textChangedChunks = (() => {
        let n = 0;
        const m = Math.min(base.length, s1.length);
        for (let i = 0; i < m; i++) if (base[i]!.text !== s1[i]!.text) n++;
        return n + Math.abs(base.length - s1.length);
      })();

      L.push(`######## ${key}`);
      L.push(`  chunks: baseline=${base.length}  S1=${s1.length}  (text differs on ${textChangedChunks})`);
      L.push(`  folds=${fold.folds.length}  wordsMoved=${wordsMoved}  ` +
        `sourceRunsEmptied=${emptied.length}  chainedFolds=${chained.length}`);
      if (fold.folds.length > 0) {
        const sizes = fold.folds.map(f => f.movedWords.length).sort((a, b) => a - b);
        L.push(`  words per fold: min=${sizes[0]} median=${sizes[sizes.length >> 1]} max=${sizes[sizes.length - 1]}`);
      }
      if (chained.length > 0) {
        L.push('  --- CHAINED FOLDS (text crossing more than one chunk boundary) ---');
        for (const c of chained.slice(0, 20)) {
          L.push(`   run ${c.runIndex} window [${c.windowStart.toFixed(2)},${c.windowEnd.toFixed(2)}] ` +
            `moved "${c.movedWords.join(' ')}"`);
        }
      }
      if (emptied.length > 0) {
        L.push('  --- FOLDS THAT EMPTIED THEIR SOURCE RUN ---');
        for (const e of emptied.slice(0, 20)) {
          L.push(`   run ${e.runIndex} window [${e.windowStart.toFixed(2)},${e.windowEnd.toFixed(2)}] ` +
            `moved "${e.movedWords.join(' ')}"`);
        }
      }

      // ---- the seam-230 chunk, named explicitly -------------------------
      if (key === 'v6') {
        L.push('  --- SEAM 230/231: the chunk that ends at 681.50 ---');
        const bi = base.findIndex(c => Math.abs(c.endSec - 681.50) < 0.02);
        const si = s1.findIndex(c => Math.abs(c.endSec - 681.50) < 0.02);
        L.push(`   baseline #${bi}: ${bi < 0 ? '(not found)' : `[${base[bi]!.startSec.toFixed(2)},${base[bi]!.endSec.toFixed(2)}] "…${base[bi]!.text.slice(-70)}"`}`);
        L.push(`   S1       #${si}: ${si < 0 ? '(not found)' : `[${s1[si]!.startSec.toFixed(2)},${s1[si]!.endSec.toFixed(2)}] "…${s1[si]!.text.slice(-70)}"`}`);
        if (bi >= 0 && bi + 1 < base.length) L.push(`   baseline next: "${base[bi + 1]!.text.slice(0, 70)}…"`);
        if (si >= 0 && si + 1 < s1.length) L.push(`   S1       next: "${s1[si + 1]!.text.slice(0, 70)}…"`);
      }
      L.push('');

      // ---- write the plan in the harness's own schema --------------------
      const livePath = resolve(REPLAY_ROOT, key, 'fa_live_chunks.json');
      const live = JSON.parse(readFileSync(livePath, 'utf-8')) as Record<string, unknown>;
      writeFileSync(resolve(REPLAY_ROOT, key, 'fa_s1_chunks.json'),
        JSON.stringify({
          _source: {
            note: 'WS1 Session AG — S1 (trailing-silence text fold) applied to the production ' +
              'four-argument computeFaChunkPlan call. Same segments/whisper/silences/duration as ' +
              'fa_live_chunks.json; the ONLY difference is foldPhantomTails=true.',
            baselinePlan: 'fa_live_chunks.json',
            baselineRunId: live._runId ?? null,
            baselineChunks: base.length,
            folds: fold.folds.length,
            wordsMoved,
          },
          audioDuration: spec.audioDuration,
          language: spec.language,
          chunks: s1,
        }, null, 2) + '\n');

      report[key] = {
        baselineChunks: base.length, s1Chunks: s1.length, textChangedChunks,
        folds: fold.folds.length, wordsMoved,
        sourceRunsEmptied: emptied.length, chainedFolds: chained.length,
        foldDetail: fold.folds,
      };
    }

    console.log(L.join('\n'));
    writeFileSync(resolve(OUT, 'step4-cascade.txt'), L.join('\n') + '\n');
    writeFileSync(resolve(OUT, 'step4-cascade.json'), JSON.stringify(report, null, 2) + '\n');
  }, 1_800_000);
});
