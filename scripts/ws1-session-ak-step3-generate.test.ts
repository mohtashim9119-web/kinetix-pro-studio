/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// ---------------------------------------------------------------------------
// WS1 Session AK — STEP 3 (generation half). Writes ARM C's chunk plan
// (`computeFaChunkPlanS2Excised`) as `fa_ak_chunks.json` per corpus, and — in
// the SAME run, before anything is aligned — RE-DERIVES ARM B's plan at HEAD
// and asserts it still reproduces Session AI's stored `fa_ai_chunks.json` byte
// for byte on the chunk array.
//
// THE ARM-B CHECK IS NOT CEREMONY. Step 3's brief says: if arm B does not
// reproduce AI's stored numbers, STOP — an ablation against a moving baseline
// is uninterpretable. Arm B's FA words are a stored artefact that cannot be
// re-derived without re-running the model, so the reproducibility that CAN be
// checked cheaply is the PLAN the words were aligned against. If the plan still
// matches, the stored words are still the right words for this commit.
//
// Both arms are written as SEPARATE files, never over `fa_ai_chunks.json` or
// `fa_live_chunks.json` — the additive-arm discipline every WS1 session since
// AG has used.
//
// Gated: WS1_SESSION_AK_MEASURE=1 npx vitest run scripts/ws1-session-ak-step3-generate.test.ts
// ---------------------------------------------------------------------------

import { describe, it, expect } from 'vitest';
import { writeFileSync, readFileSync, mkdirSync } from 'fs';
import { resolve } from 'path';
import { createHash } from 'crypto';

import { CORPORA, REPO, REPLAY_ROOT, loadLiveBundle } from './ws1-session-p-pipeline.js';
import { parseProjectData } from '../src/App';
import { applyAnchorBasedTiming } from '../src/services/syncEngine';
import {
  computeFaChunkPlanS2, computeFaChunkPlanS2Excised, computeUnscriptedRuns,
  S2_TARGET_MIN_SEC, S2_TARGET_MAX_SEC,
} from '../src/services/faChunkPlan';
import type { FaChunk } from '../src/services/faChunkPlan';

const MEASURE = process.env.WS1_SESSION_AK_MEASURE === '1';
const OUT = resolve(REPO, '.work-phase4/session-ak');

const round6 = (n: number): number => +n.toFixed(6);

describe.skipIf(!MEASURE)('WS1 Session AK Step 3 — generate arm C, verify arm B reproduces', () => {
  it('writes fa_ak_chunks.json per corpus and re-derives arm B at HEAD', async () => {
    mkdirSync(OUT, { recursive: true });
    const L: string[] = ['# WS1 Session AK Step 3 — arm C generation + arm B reproduction (MEASURED)', ''];
    const json: Record<string, unknown> = {};

    expect(S2_TARGET_MIN_SEC, 'GEOMETRIC, operator-directed — unchanged this session').toBe(10);
    expect(S2_TARGET_MAX_SEC).toBe(30);

    for (const key of ['v6', '173', 'spanish'] as const) {
      const spec = CORPORA[key]!;
      const { silences, whisperTokens } = loadLiveBundle(key);
      const segsRaw = await parseProjectData(
        readFileSync(spec.scriptPath, 'utf-8'), readFileSync(spec.sceneDetailsPath, 'utf-8'), [], spec.audioDuration,
      );
      const anchorTimed = applyAnchorBasedTiming(segsRaw, spec.audioDuration);
      const runs = computeUnscriptedRuns(anchorTimed, whisperTokens, silences, spec.audioDuration);

      // ---- ARM B, re-derived at HEAD --------------------------------------
      const armB = computeFaChunkPlanS2(anchorTimed, silences, spec.audioDuration);
      const storedB = (JSON.parse(readFileSync(resolve(REPLAY_ROOT, key, 'fa_ai_chunks.json'), 'utf-8')) as {
        chunks: FaChunk[];
      }).chunks;
      const bMatches = armB.chunks.length === storedB.length && armB.chunks.every((c, i) => {
        const s = storedB[i]!;
        return round6(c.startSec) === round6(s.startSec) && round6(c.endSec) === round6(s.endSec) && c.text === s.text;
      });

      // ---- ARM C ------------------------------------------------------------
      const armC = computeFaChunkPlanS2Excised(anchorTimed, whisperTokens, silences, spec.audioDuration);

      // Structural invariants of an EXCISED plan: monotone, non-overlapping,
      // and gapless EXCEPT at excised runs. Never inverted, never empty-text.
      for (let i = 0; i < armC.chunks.length; i++) {
        const c = armC.chunks[i]!;
        expect(c.endSec, `${key} chunk ${i} inverted`).toBeGreaterThan(c.startSec);
        expect(c.text.length, `${key} chunk ${i} empty text`).toBeGreaterThan(0);
        if (i > 0) {
          expect(c.startSec, `${key} chunk ${i} overlaps predecessor`).toBeGreaterThanOrEqual(armC.chunks[i - 1]!.endSec - 1e-9);
        }
      }
      // Every gap in arm C's plan must BE an excised run — not an accident.
      const gaps: Array<{ startSec: number; endSec: number; isRun: boolean }> = [];
      for (let i = 1; i < armC.chunks.length; i++) {
        const g0 = armC.chunks[i - 1]!.endSec;
        const g1 = armC.chunks[i]!.startSec;
        if (g1 - g0 > 1e-6) {
          gaps.push({
            startSec: g0, endSec: g1,
            isRun: runs.some(u => Math.abs(u.startSec - g0) < 1e-6 && Math.abs(u.endSec - g1) < 1e-6),
          });
        }
      }
      const strayGaps = gaps.filter(g => !g.isRun);
      expect(strayGaps, `${key}: every plan gap must be an excised R.5 run`).toEqual([]);

      // TEXT CONSERVATION — the accounting claim, checked rather than asserted:
      // excision removes AUDIO, never SCRIPT TEXT, so both arms' concatenated
      // chunk text must be identical.
      const textB = armB.chunks.map(c => c.text).join(' ');
      const textC = armC.chunks.map(c => c.text).join(' ');
      expect(textC, `${key}: excision must not add or drop a single script word`).toBe(textB);

      const excisedSec = gaps.reduce((a, g) => a + (g.endSec - g.startSec), 0);
      const payload = {
        _runId: `ak-${new Date().toISOString().replace(/[:.]/g, '')}`,
        audioDuration: spec.audioDuration,
        language: spec.language,
        _source: {
          note: 'WS1 Session AK — computeFaChunkPlanS2Excised(anchorTimed, rawWhisperTokens, nativeSilences, '
            + `audioDuration), target ${S2_TARGET_MIN_SEC}-${S2_TARGET_MAX_SEC}s (GEOMETRIC, unchanged), AT HEAD. `
            + 'S2 with R.5 unscripted-run excision folded in. Plan is deliberately NOT gapless: every gap is an '
            + 'excised recitation.',
          anchorTimedSegments: anchorTimed.length,
          silenceCount: silences.length,
          r5RunCount: runs.length,
          excisedSpans: gaps.length,
          excisedSec: round6(excisedSec),
          violationCount: armC.violations.length,
        },
        chunks: armC.chunks,
      };
      const dest = resolve(REPLAY_ROOT, key, 'fa_ak_chunks.json');
      const text = JSON.stringify(payload, null, 2);
      writeFileSync(dest, text);

      const lens = (cs: readonly FaChunk[]): number[] => cs.map(c => +(c.endSec - c.startSec).toFixed(3));
      const stat = (xs: number[]): string => xs.length === 0 ? 'n/a'
        : `min ${Math.min(...xs).toFixed(2)} / median ${[...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]!.toFixed(2)} `
          + `/ max ${Math.max(...xs).toFixed(2)} / mean ${(xs.reduce((a, b) => a + b, 0) / xs.length).toFixed(2)}`;

      L.push(`## ${key}`);
      L.push('');
      L.push(`- R.5 runs: **${runs.length}** | excised spans in arm C: **${gaps.length}** | excised seconds: **${excisedSec.toFixed(2)}s**`);
      L.push(`- arm B chunks (re-derived at HEAD): ${armB.chunks.length} | stored \`fa_ai_chunks.json\`: ${storedB.length}`);
      L.push(`- **arm B reproduces stored plan: ${bMatches ? 'YES' : '**NO — STOP**'}**`);
      L.push(`- arm C chunks: **${armC.chunks.length}** | violations: **${armC.violations.length}**`);
      L.push(`- arm B chunk lengths: ${stat(lens(armB.chunks))}`);
      L.push(`- arm C chunk lengths: ${stat(lens(armC.chunks))}`);
      L.push(`- text conservation (arm C text === arm B text): **YES** (asserted)`);
      L.push(`- sha256: \`${createHash('sha256').update(text).digest('hex')}\``);
      L.push('');
      if (armC.violations.length > 0) {
        L.push('| segIdx | cause | idealSec | fallback |');
        L.push('|---|---|---|---|');
        for (const v of armC.violations) L.push(`| ${v.segIdx} | ${v.cause} | ${v.idealSec.toFixed(3)} | ${v.fallback} |`);
        L.push('');
      }
      if (gaps.length > 0) {
        L.push(`- excised spans: ${gaps.map(g => `${g.startSec.toFixed(2)}-${g.endSec.toFixed(2)}`).join(', ')}`);
        L.push('');
      }

      // THE STOP CONDITION.
      expect(bMatches, `${key}: arm B must reproduce Session AI's stored chunk plan at HEAD`).toBe(true);

      json[key] = {
        r5Runs: runs.length, armBChunks: armB.chunks.length, storedBChunks: storedB.length, armBReproduces: bMatches,
        armCChunks: armC.chunks.length, armCViolations: armC.violations, gaps, excisedSec: round6(excisedSec),
        armBLengths: lens(armB.chunks), armCLengths: lens(armC.chunks),
      };
    }

    writeFileSync(resolve(OUT, 'step3-generate.md'), `${L.join('\n')}\n`);
    writeFileSync(resolve(OUT, 'step3-generate.json'), JSON.stringify(json, null, 2));
    // eslint-disable-next-line no-console
    console.log(L.join('\n'));
  }, 300_000);
});
