/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// ---------------------------------------------------------------------------
// WS1 Session AM — STEP 3. ARM F: ANCHOR-PLACED CHUNK EDGES. v6 ONLY.
//
// Produces `fa_am_f_chunks.json` and asserts every structural invariant BEFORE
// a single second of audio is aligned. Three checks carry the session's claim
// that arm F is ONE VARIABLE FROM ARM C:
//
//   1. THE CONTROL EQUIVALENCE. `computeFaChunkPlanS2EdgeArm` under
//      `{ kind: 'silence' }` must reproduce `computeFaChunkPlanS2Excised`
//      EXACTLY — same chunk count, same times to 1e-6, same text. That is what
//      makes "everything except edge placement is held identical to arm C" a
//      measured claim rather than a promise, and it is asserted at the 10-30s
//      band, arm C's, not arm D's 1-15s.
//   2. ARM B AND ARM C MUST STILL REPRODUCE THEIR STORED PLANS AT HEAD. This
//      session appends to `faChunkPlan.ts`; an append that perturbed a shared
//      helper would silently invalidate both stored word files and give the
//      six-arm comparison a moving baseline. Cheap to check, catastrophic to
//      skip — the same reasoning Sessions AK and AL applied.
//   3. TEXT CONSERVATION. A different EDGE must not add or drop one script
//      word relative to arm C.
//
// Also reports whether either of Session AL's two conservation properties
// actually fires at this band — the carry-forward on a collapsed window, and
// the monotone cursor — rather than assuming them inert.
//
// Gated: WS1_SESSION_AM_MEASURE=1 npx vitest run scripts/ws1-session-am-step3-armf.test.ts
// ---------------------------------------------------------------------------

import { describe, it, expect } from 'vitest';
import { writeFileSync, readFileSync, mkdirSync } from 'fs';
import { resolve } from 'path';
import { createHash } from 'crypto';

import { CORPORA, REPO, REPLAY_ROOT, loadLiveBundle } from './ws1-session-p-pipeline.js';
import { parseProjectData } from '../src/App';
import { applyAnchorBasedTiming } from '../src/services/syncEngine';
import {
  computeFaChunkPlanS2, computeFaChunkPlanS2Excised, computeFaChunkPlanS2EdgeArm, computeUnscriptedRuns,
} from '../src/services/faChunkPlan';
import type { FaChunk } from '../src/services/faChunkPlan';
import { AM_TARGET_MIN_SEC, AM_TARGET_MAX_SEC, AL_V6_CHUNK_COUNT } from './ws1-session-am-step1-gate.js';

const MEASURE = process.env.WS1_SESSION_AM_MEASURE === '1';
const OUT = resolve(REPO, '.work-phase4/session-am');
const DOCS = resolve(REPO, 'docs/ws1-sync-pipeline');

const round6 = (n: number): number => +n.toFixed(6);
const samePlan = (a: readonly FaChunk[], b: readonly FaChunk[]): boolean =>
  a.length === b.length && a.every((c, i) =>
    round6(c.startSec) === round6(b[i]!.startSec) && round6(c.endSec) === round6(b[i]!.endSec) && c.text === b[i]!.text);

describe.skipIf(!MEASURE)('WS1 Session AM Step 3 — arm F, anchor-placed chunk edges', () => {
  it('proves the silence control equals arm C, then writes fa_am_f_chunks.json', async () => {
    mkdirSync(OUT, { recursive: true });
    const spec = CORPORA.v6!;
    const { silences, whisperTokens } = loadLiveBundle('v6');
    const segsRaw = await parseProjectData(
      readFileSync(spec.scriptPath, 'utf-8'), readFileSync(spec.sceneDetailsPath, 'utf-8'), [], spec.audioDuration,
    );
    const anchorTimed = applyAnchorBasedTiming(segsRaw, spec.audioDuration);
    const runs = computeUnscriptedRuns(anchorTimed, whisperTokens, silences, spec.audioDuration);

    // ---- 2. ARMS B AND C MUST STILL REPRODUCE AT HEAD ---------------------
    const armB = computeFaChunkPlanS2(anchorTimed, silences, spec.audioDuration);
    const armC = computeFaChunkPlanS2Excised(anchorTimed, whisperTokens, silences, spec.audioDuration);
    const storedPlan = (f: string): FaChunk[] =>
      (JSON.parse(readFileSync(resolve(REPLAY_ROOT, 'v6', f), 'utf-8')) as { chunks: FaChunk[] }).chunks;
    const bReproduces = samePlan(armB.chunks, storedPlan('fa_ai_chunks.json'));
    const cReproduces = samePlan(armC.chunks, storedPlan('fa_ak_chunks.json'));
    expect(bReproduces, 'arm B must still reproduce its stored plan at HEAD').toBe(true);
    expect(cReproduces, 'arm C must still reproduce its stored plan at HEAD').toBe(true);
    expect(armC.chunks.length).toBe(AL_V6_CHUNK_COUNT.C);

    // ---- 1. THE CONTROL EQUIVALENCE ---------------------------------------
    const control = computeFaChunkPlanS2EdgeArm(
      anchorTimed, whisperTokens, silences, spec.audioDuration,
      { kind: 'silence' }, AM_TARGET_MIN_SEC, AM_TARGET_MAX_SEC,
    );
    const controlEqualsArmC = samePlan(control.chunks, armC.chunks);
    expect(controlEqualsArmC,
      'the new parameterised path under { kind: "silence" } MUST reproduce computeFaChunkPlanS2Excised exactly — '
      + 'otherwise arm F is not one variable from arm C').toBe(true);

    // ---- ARM F -------------------------------------------------------------
    const armF = computeFaChunkPlanS2EdgeArm(
      anchorTimed, whisperTokens, silences, spec.audioDuration,
      { kind: 'anchor' }, AM_TARGET_MIN_SEC, AM_TARGET_MAX_SEC,
    );

    // ---- 3. STRUCTURAL INVARIANTS -----------------------------------------
    for (let i = 0; i < armF.chunks.length; i++) {
      const c = armF.chunks[i]!;
      expect(c.endSec, `chunk ${i} inverted`).toBeGreaterThan(c.startSec);
      expect(c.text.length, `chunk ${i} empty text`).toBeGreaterThan(0);
      if (i > 0) {
        expect(c.startSec, `chunk ${i} overlaps predecessor`).toBeGreaterThanOrEqual(armF.chunks[i - 1]!.endSec - 1e-9);
      }
    }
    expect(armF.chunks[armF.chunks.length - 1]!.endSec,
      'the plan must not run past the audio').toBeLessThanOrEqual(spec.audioDuration + 1e-9);

    const gaps: Array<{ startSec: number; endSec: number; isRun: boolean }> = [];
    for (let i = 1; i < armF.chunks.length; i++) {
      const g0 = armF.chunks[i - 1]!.endSec, g1 = armF.chunks[i]!.startSec;
      if (g1 - g0 > 1e-6) {
        gaps.push({
          startSec: g0, endSec: g1,
          isRun: runs.some(u => Math.abs(u.startSec - g0) < 1e-6 && Math.abs(u.endSec - g1) < 1e-6),
        });
      }
    }
    expect(gaps.filter(g => !g.isRun), 'every plan gap must be an excised R.5 run').toEqual([]);

    // ---- TEXT CONSERVATION -------------------------------------------------
    expect(armF.chunks.map(c => c.text).join(' '), 'arm F text must equal arm C text word for word')
      .toBe(armC.chunks.map(c => c.text).join(' '));

    // ---- CONSERVATION PROPERTIES: DID EITHER FIRE? ------------------------
    const collapsed = armF.violations.filter(v => v.cause === 'excision-collapsed-chunk');
    const cursorMonotone = armF.chunks.every((c, i) => i === 0 || c.startSec >= armF.chunks[i - 1]!.endSec - 1e-9);
    const controlCollapsed = control.violations.filter(v => v.cause === 'excision-collapsed-chunk');

    // ---- WRITE THE PLAN ----------------------------------------------------
    const dest = resolve(REPLAY_ROOT, 'v6', 'fa_am_f_chunks.json');
    const excisedSec = gaps.reduce((a, g) => a + (g.endSec - g.startSec), 0);
    const payload = {
      _runId: `am-f-${new Date().toISOString().replace(/[:.]/g, '')}`,
      audioDuration: spec.audioDuration,
      language: spec.language,
      _source: {
        note: 'WS1 Session AM arm F — computeFaChunkPlanS2EdgeArm(anchorTimed, rawWhisperTokens, nativeSilences, '
          + `audioDuration, { kind: 'anchor' }, ${AM_TARGET_MIN_SEC}, ${AM_TARGET_MAX_SEC}) AT HEAD. Internal `
          + 'chunk edges placed at the qi-nearest faAnchors.ts three-source-agreement anchor, admissible only '
          + 'inside the two sentence groups the seam separates; every other aspect held identical to arm C '
          + '(10-30s band, R.5 excision ON, same greedy packing). Plan is deliberately NOT gapless: every gap '
          + 'is an excised recitation.',
        anchorTimedSegments: anchorTimed.length,
        silenceCount: silences.length,
        r5RunCount: runs.length,
        excisedSpans: gaps.length,
        excisedSec: round6(excisedSec),
        violationCount: armF.violations.length,
        edgeCensus: armF.edgeCensus,
      },
      chunks: armF.chunks,
    };
    const text = JSON.stringify(payload, null, 2);
    writeFileSync(dest, text);

    // ---- THE INSPECTION DUMP ----------------------------------------------
    const lens = armF.inspection.map(r => r.durationSec);
    const sorted = [...lens].sort((a, b) => a - b);
    const q = (p: number): number => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))]!;
    const dist = {
      n: lens.length, min: +Math.min(...lens).toFixed(3), p25: +q(0.25).toFixed(3),
      median: +q(0.5).toFixed(3), p75: +q(0.75).toFixed(3), max: +Math.max(...lens).toFixed(3),
      mean: +(lens.reduce((a, b) => a + b, 0) / lens.length).toFixed(3),
      underMin: lens.filter(x => x < AM_TARGET_MIN_SEC).length,
      overMax: lens.filter(x => x > AM_TARGET_MAX_SEC).length,
    };

    const L: string[] = [];
    L.push('# WS1 Session AM Step 3 — arm F chunk inspection (MEASURED, v6, no FA run)');
    L.push('');
    L.push('Anchor-placed internal chunk edges. **Base is ARM C, not arm D** — the 10-30s operator-directed');
    L.push('band, R.5 excision ON, `s2UnbreakableGroups` atoms, net-of-excision greedy packing, all inherited');
    L.push('unchanged. The only line that differs is where an internal seam is cut.');
    L.push('');
    L.push('## The three claims that make this one variable from arm C');
    L.push('');
    L.push('| claim | result |');
    L.push('|---|---|');
    L.push(`| \`{ kind: 'silence' }\` reproduces \`computeFaChunkPlanS2Excised\` exactly | **${controlEqualsArmC}** |`);
    L.push(`| arm B still reproduces \`fa_ai_chunks.json\` at HEAD | **${bReproduces}** |`);
    L.push(`| arm C still reproduces \`fa_ak_chunks.json\` at HEAD | **${cReproduces}** |`);
    L.push(`| arm F text equals arm C text word for word | **true** (asserted) |`);
    L.push('');
    L.push('The first row is the load-bearing one: the parameterised path is not merely *described* as arm C');
    L.push('plus an edge rule, it is *measured* to be, at the same band, on the same corpus, at this commit.');
    L.push('');
    L.push('## Edge census — how each internal edge was actually placed');
    L.push('');
    L.push('| cut kind | count | substituted? |');
    L.push('|---|---|---|');
    for (const [k, v] of Object.entries(armF.edgeCensus)) {
      const sub = k === 'anchor' ? '**YES — anchor-placed**'
        : k === 'detected-silence' ? 'no — fell back to arm C\'s cut'
          : 'no — not estimate-derived in any arm';
      L.push(`| \`${k}\` | ${v} | ${sub} |`);
    }
    L.push('');
    L.push('## Distribution');
    L.push('');
    L.push(`- n **${dist.n}** | min **${dist.min}s** | p25 ${dist.p25}s | **median ${dist.median}s** | p75 ${dist.p75}s | max **${dist.max}s** | mean ${dist.mean}s`);
    L.push(`- chunks under ${AM_TARGET_MIN_SEC}s: **${dist.underMin}** | chunks over ${AM_TARGET_MAX_SEC}s: **${dist.overMax}**`);
    L.push(`- arm C's own median, MEASURED Session AL: 26.06s`);
    L.push('');
    L.push('## Session AL\'s two conservation properties — did either fire at this band?');
    L.push('');
    L.push(`- **TEXT carry-forward on a collapsed window: ${collapsed.length === 0 ? 'DID NOT FIRE' : `FIRED ${collapsed.length} time(s)`}.**`
      + ` The silence control fired it ${controlCollapsed.length} time(s), so any difference is attributable to`
      + ' edge placement rather than to the shared packing.');
    L.push(`- **TIME monotone cursor: holds — ${cursorMonotone}.** No emitted window starts behind its predecessor's end.`);
    L.push('');
    L.push('## The complete violation list (not a summary)');
    L.push('');
    L.push(`Total violation events: **${armF.violations.length}**.`);
    L.push('');
    if (armF.violations.length === 0) {
      L.push('_None._');
    } else {
      L.push('| # | cause | segIdx | ideal | seam | dur | what the planner did |');
      L.push('|---|---|---|---|---|---|---|');
      armF.violations.forEach((v, i) => {
        L.push(`| ${i} | \`${v.cause}\` | ${v.segIdx} | ${v.idealSec.toFixed(3)} | ${v.seamSec?.toFixed(3) ?? '—'} `
          + `| ${v.durationSec?.toFixed(3) ?? '—'} | ${v.fallback.replace(/\|/g, '\\|')} |`);
      });
    }
    L.push('');
    L.push('## Every chunk');
    L.push('');
    L.push('| # | start | end | dur | cut | ideal | Δideal | Δqi | anchor qi | segs | >cap |');
    L.push('|---|---|---|---|---|---|---|---|---|---|---|');
    for (const r of armF.inspection) {
      L.push(`| ${r.index} | ${r.startSec.toFixed(3)} | ${r.endSec.toFixed(3)} | ${r.durationSec.toFixed(3)} `
        + `| ${r.cutKind} | ${r.idealSec.toFixed(3)} | ${r.cutOffsetSec >= 0 ? '+' : ''}${r.cutOffsetSec.toFixed(3)} `
        + `| ${r.deltaQi ?? '—'} | ${r.anchorQi ?? '—'} | ${r.segFrom}-${r.segTo} | ${r.exceededCap ? '**YES**' : ''} |`);
    }
    L.push('');

    const dumpText = `${L.join('\n')}\n`;
    writeFileSync(resolve(OUT, 'step3-armf.md'), dumpText);
    writeFileSync(resolve(DOCS, 'session-am-armf-inspection.md'), dumpText);

    writeFileSync(resolve(OUT, 'step3-armf.json'), JSON.stringify({
      controlEqualsArmC, bReproduces, cReproduces,
      armBChunks: armB.chunks.length, armCChunks: armC.chunks.length, armFChunks: armF.chunks.length,
      edgeCensus: armF.edgeCensus, distribution: dist,
      r5Runs: runs.length, excisedSpans: gaps.length, excisedSec: round6(excisedSec),
      conservation: {
        collapsedChunks: collapsed.length, controlCollapsedChunks: controlCollapsed.length, cursorMonotone,
      },
      violations: armF.violations,
      inspection: armF.inspection,
      planSha256: createHash('sha256').update(text).digest('hex'),
    }, null, 2));

    // eslint-disable-next-line no-console
    console.log(L.join('\n'));
  }, 300_000);
});
