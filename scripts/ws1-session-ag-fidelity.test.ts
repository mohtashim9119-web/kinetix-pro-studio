/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// ---------------------------------------------------------------------------
// WS1 Session AG — STEP 2 (first half). CHUNK-PLAN REPRODUCTION FIDELITY.
//
// WHY. Step 1's census recomputed 173's chunk plan as 119 chunks while the
// stored `fa_live_chunks.json` — the plan the stored FA word arm was actually
// aligned against — holds 126. v6 (277) and Spanish (5) reproduce exactly. If
// the recomputation does not reproduce, then every seam-scoped statement about
// 173 is being made against a chunk plan that did not produce 173's FA tokens,
// and the S1 measurement on that corpus would be uninterpretable.
//
// This file compares, per corpus, the plan `runProductionPath` computes TODAY
// against the plan stored in the bundle, chunk by chunk: count, windows, text.
//
// READ-ONLY. Gated:
//   WS1_SESSION_AG_MEASURE=1 npx vitest run scripts/ws1-session-ag-fidelity.test.ts
// ---------------------------------------------------------------------------

import { describe, it } from 'vitest';
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { resolve } from 'path';

import { CORPORA, runProductionPath, REPO, REPLAY_ROOT } from './ws1-session-p-pipeline.js';

const MEASURE = process.env.WS1_SESSION_AG_MEASURE === '1';
const OUT = resolve(REPO, '.work-phase4/session-ag');

interface StoredChunk { startSec: number; endSec: number; text: string }

describe.skipIf(!MEASURE)('WS1 Session AG Step 2 — chunk-plan reproduction fidelity', () => {
  it('compares today\'s recomputed plan against the plan the stored FA arm was aligned against', async () => {
    mkdirSync(OUT, { recursive: true });
    const L: string[] = [];

    for (const key of ['v6', '173', 'spanish'] as const) {
      const run = await runProductionPath(CORPORA[key]!);
      const storedFile = resolve(REPLAY_ROOT, key, 'fa_live_chunks.json');
      const stored = JSON.parse(readFileSync(storedFile, 'utf-8')) as {
        _runId?: string; audioDuration: number; chunks: StoredChunk[];
        _source?: Record<string, unknown>;
      };
      const now = run.chunks;
      const was = stored.chunks;

      L.push(`######## ${key}`);
      L.push(`  stored plan: ${was.length} chunks (runId ${stored._runId ?? 'n/a'})`);
      L.push(`  recomputed : ${now.length} chunks`);
      L.push(`  anchorTimed segments now=${run.anchorTimed.length} ` +
        `stored _source.anchorTimedSegments=${String(stored._source?.anchorTimedSegments)}`);
      L.push(`  whisper tokens now=${run.whisperTokens.length} ` +
        `stored _source.rawTokenCount=${String(stored._source?.rawTokenCount)}`);
      L.push(`  silences now=${run.silences.length} ` +
        `stored _source.silenceCount=${String(stored._source?.silenceCount)}`);

      const n = Math.min(now.length, was.length);
      let firstDiff = -1;
      let winDiffs = 0, textDiffs = 0;
      for (let i = 0; i < n; i++) {
        const a = now[i]!, b = was[i]!;
        const winSame = Math.abs(a.startSec - b.startSec) < 1e-9 && Math.abs(a.endSec - b.endSec) < 1e-9;
        const textSame = a.text === b.text;
        if (!winSame) winDiffs++;
        if (!textSame) textDiffs++;
        if (!(winSame && textSame) && firstDiff < 0) firstDiff = i;
      }
      L.push(`  chunk-for-chunk over the first ${n}: windowDiffs=${winDiffs} textDiffs=${textDiffs} ` +
        `firstDiffIndex=${firstDiff}`);

      if (firstDiff >= 0) {
        L.push('  --- first divergence, three chunks either side ---');
        for (let i = Math.max(0, firstDiff - 2); i < Math.min(n, firstDiff + 4); i++) {
          const a = now[i]!, b = was[i]!;
          L.push(`   [${i}] NOW   [${a.startSec.toFixed(2)},${a.endSec.toFixed(2)}] "${a.text.slice(0, 90)}"`);
          L.push(`   [${i}] STORED[${b.startSec.toFixed(2)},${b.endSec.toFixed(2)}] "${b.text.slice(0, 90)}"`);
        }
      }
      L.push(`  VERDICT: ${now.length === was.length && firstDiff < 0
        ? 'REPRODUCES EXACTLY' : 'DOES NOT REPRODUCE'}`);
      L.push('');
    }

    console.log(L.join('\n'));
    writeFileSync(resolve(OUT, 'step2-chunkplan-fidelity.txt'), L.join('\n') + '\n');
  }, 1_800_000);
});
