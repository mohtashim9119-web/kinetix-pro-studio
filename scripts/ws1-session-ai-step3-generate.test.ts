/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// ---------------------------------------------------------------------------
// WS1 Session AI — STEP 3 (generation half). Writes S2's chunk plan for all
// three corpora as `fa_ai_chunks.json` under each corpus's live-bundle
// directory, in the `LivePlanFile` shape `fa_onnx.rs`'s `session_p_regen`
// harness reads (`{ audioDuration, chunks: [{ startSec, endSec, text }] }`).
//
// This is a SEPARATE arm, never overwriting `fa_live_chunks.json` — same
// additive discipline Sessions AG/AH used for their own arms. The Rust
// harness then aligns the SAME `audio_16k.wav` against it via
// FA_REGEN_PLAN=fa_ai_chunks.json FA_REGEN_OUT=fa_ai_words.json, exactly the
// recipe `ws1-session-ah-step2-capture.test.ts` used for the 173 re-capture.
//
// Gated: WS1_SESSION_AI_MEASURE=1 npx vitest run scripts/ws1-session-ai-step3-generate.test.ts
// ---------------------------------------------------------------------------

import { describe, it, expect } from 'vitest';
import { writeFileSync, readFileSync, mkdirSync } from 'fs';
import { resolve } from 'path';
import { createHash } from 'crypto';

import { CORPORA, REPO, REPLAY_ROOT, loadLiveBundle } from './ws1-session-p-pipeline.js';
import { parseProjectData } from '../src/App';
import { applyAnchorBasedTiming } from '../src/services/syncEngine';
import { computeFaChunkPlanS2, S2_TARGET_MIN_SEC, S2_TARGET_MAX_SEC } from '../src/services/faChunkPlan';

const MEASURE = process.env.WS1_SESSION_AI_MEASURE === '1';
const OUT = resolve(REPO, '.work-phase4/session-ai');

describe.skipIf(!MEASURE)('WS1 Session AI Step 3 — generate S2 chunk plans for all three corpora', () => {
  it('writes fa_ai_chunks.json per corpus and reports every violation', async () => {
    mkdirSync(OUT, { recursive: true });
    const L: string[] = [];
    L.push('# WS1 Session AI Step 3 — S2 chunk-plan generation (real planner, GEOMETRIC 10-30s)');
    L.push('');

    for (const key of ['v6', '173', 'spanish'] as const) {
      const spec = CORPORA[key]!;
      const { silences } = loadLiveBundle(key);
      const segsRaw = await parseProjectData(
        readFileSync(spec.scriptPath, 'utf-8'), readFileSync(spec.sceneDetailsPath, 'utf-8'), [], spec.audioDuration,
      );
      const anchorTimed = applyAnchorBasedTiming(segsRaw, spec.audioDuration);

      const { chunks, violations } = computeFaChunkPlanS2(anchorTimed, silences, spec.audioDuration);
      expect(S2_TARGET_MIN_SEC).toBe(10);
      expect(S2_TARGET_MAX_SEC).toBe(30);

      // Invariant check, real planner output (not the dry-run simulation):
      // gapless partition of [0, audioDuration).
      expect(chunks[0]!.startSec).toBe(0);
      expect(chunks[chunks.length - 1]!.endSec).toBe(spec.audioDuration);
      for (let i = 1; i < chunks.length; i++) {
        expect(chunks[i]!.startSec, `${key} chunk ${i} gap/overlap`).toBe(chunks[i - 1]!.endSec);
      }

      const payload = {
        _runId: `ai-${new Date().toISOString().replace(/[:.]/g, '')}`,
        audioDuration: spec.audioDuration,
        language: spec.language,
        _source: {
          note: 'WS1 Session AI — computeFaChunkPlanS2(anchorTimed, nativeSilences, audioDuration), '
            + `target ${S2_TARGET_MIN_SEC}-${S2_TARGET_MAX_SEC}s (GEOMETRIC), AT HEAD. Real planner `
            + 'output, not the Step 1 dry-run simulation.',
          anchorTimedSegments: anchorTimed.length,
          silenceCount: silences.length,
          violationCount: violations.length,
        },
        chunks,
      };
      const dest = resolve(REPLAY_ROOT, key, 'fa_ai_chunks.json');
      const text = JSON.stringify(payload, null, 2);
      writeFileSync(dest, text);

      L.push(`## ${key}`);
      L.push('');
      L.push(`- chunks: **${chunks.length}**`);
      L.push(`- violations: **${violations.length}**`);
      L.push(`- sha256: ${createHash('sha256').update(text).digest('hex')}`);
      L.push(`- wrote: ${dest}`);
      L.push('');
      if (violations.length > 0) {
        L.push('| segIdx | cause | idealSec | fallback |');
        L.push('|---|---|---|---|');
        for (const v of violations) {
          L.push(`| ${v.segIdx} | ${v.cause} | ${v.idealSec.toFixed(3)} | ${v.fallback} |`);
        }
        L.push('');
      }
      writeFileSync(resolve(OUT, `step3-${key}-violations.json`), JSON.stringify(violations, null, 2));
    }

    writeFileSync(resolve(OUT, 'step3-generate.md'), L.join('\n'));
    console.log(L.join('\n'));
  }, 120_000);
});
