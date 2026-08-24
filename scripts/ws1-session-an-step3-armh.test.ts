/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// ---------------------------------------------------------------------------
// WS1 Session AN — STEP 3. ARM H: FALLBACK-SEAM RECOVERY. v6 ONLY.
//
// Produces `fa_an_h_chunks.json` and asserts every structural invariant
// BEFORE a single second of audio is aligned. Base is ARM F, not arm C — one
// variable from an EXISTING arm, per the brief:
//
//   1. THE CONTROL EQUIVALENCE. `computeFaChunkPlanS2EdgeArm` under
//      `{ kind: 'silence' }` must still reproduce `computeFaChunkPlanS2Excised`
//      exactly (unchanged from Session AM — nothing above the edge-placement
//      branch was touched).
//   2. ARMS B, C AND F MUST STILL REPRODUCE THEIR STORED PLANS AT HEAD.
//   3. THE FIVE FALLBACK SEAMS, individually: does the one-group-wider search
//      now find an admissible anchor? At what Δqi and from what distance?  If
//      not, what specifically still blocks it?
//   4. TEXT CONSERVATION vs arm F (not arm C — arm H's own comparison point).
//
// Gated: WS1_SESSION_AN_MEASURE=1 npx vitest run scripts/ws1-session-an-step3-armh.test.ts
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
import { FALLBACK_SEAM_GOVERNED_BY_SEAM } from './ws1-session-an-step1-gate.js';

const MEASURE = process.env.WS1_SESSION_AN_MEASURE === '1';
const OUT = resolve(REPO, '.work-phase4/session-an');
const DOCS = resolve(REPO, 'docs/ws1-sync-pipeline');

const round6 = (n: number): number => +n.toFixed(6);
const samePlan = (a: readonly FaChunk[], b: readonly FaChunk[]): boolean =>
  a.length === b.length && a.every((c, i) =>
    round6(c.startSec) === round6(b[i]!.startSec) && round6(c.endSec) === round6(b[i]!.endSec) && c.text === b[i]!.text);

describe.skipIf(!MEASURE)('WS1 Session AN Step 3 — arm H, fallback-seam recovery', () => {
  it('resolves (or explains) each of the 5 fallback seams, then writes fa_an_h_chunks.json', async () => {
    mkdirSync(OUT, { recursive: true });
    const spec = CORPORA.v6!;
    const { silences, whisperTokens } = loadLiveBundle('v6');
    const segsRaw = await parseProjectData(
      readFileSync(spec.scriptPath, 'utf-8'), readFileSync(spec.sceneDetailsPath, 'utf-8'), [], spec.audioDuration,
    );
    const anchorTimed = applyAnchorBasedTiming(segsRaw, spec.audioDuration);
    const runs = computeUnscriptedRuns(anchorTimed, whisperTokens, silences, spec.audioDuration);

    // ---- ARMS B, C, F MUST STILL REPRODUCE AT HEAD --------------------------
    const armB = computeFaChunkPlanS2(anchorTimed, silences, spec.audioDuration);
    const armC = computeFaChunkPlanS2Excised(anchorTimed, whisperTokens, silences, spec.audioDuration);
    const storedPlan = (f: string): FaChunk[] =>
      (JSON.parse(readFileSync(resolve(REPLAY_ROOT, 'v6', f), 'utf-8')) as { chunks: FaChunk[] }).chunks;
    const bReproduces = samePlan(armB.chunks, storedPlan('fa_ai_chunks.json'));
    const cReproduces = samePlan(armC.chunks, storedPlan('fa_ak_chunks.json'));
    expect(bReproduces, 'arm B must still reproduce its stored plan at HEAD').toBe(true);
    expect(cReproduces, 'arm C must still reproduce its stored plan at HEAD').toBe(true);
    expect(armC.chunks.length).toBe(AL_V6_CHUNK_COUNT.C);

    const armF = computeFaChunkPlanS2EdgeArm(
      anchorTimed, whisperTokens, silences, spec.audioDuration, { kind: 'anchor' }, AM_TARGET_MIN_SEC, AM_TARGET_MAX_SEC,
    );
    const fReproduces = samePlan(armF.chunks, storedPlan('fa_am_f_chunks.json'));
    expect(fReproduces, 'arm F must still reproduce its stored plan at HEAD').toBe(true);

    // ---- THE CONTROL EQUIVALENCE (unchanged from Session AM) ----------------
    const control = computeFaChunkPlanS2EdgeArm(
      anchorTimed, whisperTokens, silences, spec.audioDuration,
      { kind: 'silence' }, AM_TARGET_MIN_SEC, AM_TARGET_MAX_SEC,
    );
    const controlEqualsArmC = samePlan(control.chunks, armC.chunks);
    expect(controlEqualsArmC,
      'the { kind: "silence" } control must still reproduce computeFaChunkPlanS2Excised exactly — arm H must not '
      + 'have perturbed anything above the edge-placement branch').toBe(true);

    // ---- ARM H ---------------------------------------------------------------
    const armH = computeFaChunkPlanS2EdgeArm(
      anchorTimed, whisperTokens, silences, spec.audioDuration,
      { kind: 'anchor-widened' }, AM_TARGET_MIN_SEC, AM_TARGET_MAX_SEC,
    );

    // ---- STRUCTURAL INVARIANTS ------------------------------------------------
    for (let i = 0; i < armH.chunks.length; i++) {
      const c = armH.chunks[i]!;
      expect(c.endSec, `chunk ${i} inverted`).toBeGreaterThan(c.startSec);
      expect(c.text.length, `chunk ${i} empty text`).toBeGreaterThan(0);
      if (i > 0) {
        expect(c.startSec, `chunk ${i} overlaps predecessor`).toBeGreaterThanOrEqual(armH.chunks[i - 1]!.endSec - 1e-9);
      }
    }
    expect(armH.chunks[armH.chunks.length - 1]!.endSec,
      'the plan must not run past the audio').toBeLessThanOrEqual(spec.audioDuration + 1e-9);

    const gaps: Array<{ startSec: number; endSec: number; isRun: boolean }> = [];
    for (let i = 1; i < armH.chunks.length; i++) {
      const g0 = armH.chunks[i - 1]!.endSec, g1 = armH.chunks[i]!.startSec;
      if (g1 - g0 > 1e-6) {
        gaps.push({ startSec: g0, endSec: g1, isRun: runs.some(u => Math.abs(u.startSec - g0) < 1e-6 && Math.abs(u.endSec - g1) < 1e-6) });
      }
    }
    expect(gaps.filter(g => !g.isRun), 'every plan gap must be an excised R.5 run').toEqual([]);

    // ---- TEXT CONSERVATION vs ARM F (arm H's own comparison point) ----------
    expect(armH.chunks.map(c => c.text).join(' '), 'arm H text must equal arm F text word for word')
      .toBe(armF.chunks.map(c => c.text).join(' '));

    // ---- CONSERVATION PROPERTIES --------------------------------------------
    const collapsed = armH.violations.filter(v => v.cause === 'excision-collapsed-chunk');
    const cursorMonotone = armH.chunks.every((c, i) => i === 0 || c.startSec >= armH.chunks[i - 1]!.endSec - 1e-9);

    // ---- THE FIVE FALLBACK SEAMS, INDIVIDUALLY --------------------------------
    interface SeamResolution {
      closingSegIdx: number; chunkIdxInF: number;
      resolvedInH: boolean; viaWidenedWindow: boolean; cutKindInH: string;
      armFCutSec: number | undefined; armHCutSec: number | undefined; deltaSec: number | undefined;
      deltaQi: number | undefined; anchorQi: number | undefined; reasonIfUnresolved: string | undefined;
    }
    const seamResolutions: SeamResolution[] = [];
    for (const seam of FALLBACK_SEAM_GOVERNED_BY_SEAM) {
      const fRow = armF.inspection.find(r => r.segTo === seam.closingSegIdx);
      const hRow = armH.inspection.find(r => r.segTo === seam.closingSegIdx);
      const unresolvedViolation = armH.violations.find(
        v => v.cause === 'no-admissible-anchor' && v.segIdx === seam.closingSegIdx + 1,
      );
      seamResolutions.push({
        closingSegIdx: seam.closingSegIdx,
        chunkIdxInF: seam.chunkIdx,
        resolvedInH: hRow !== undefined && (hRow.cutKind === 'anchor' || hRow.cutKind === 'anchor-widened'),
        viaWidenedWindow: hRow?.cutKind === 'anchor-widened',
        cutKindInH: hRow?.cutKind ?? '(chunk collapsed/shifted — see armH inspection)',
        armFCutSec: fRow?.endSec,
        armHCutSec: hRow?.endSec,
        deltaSec: fRow !== undefined && hRow !== undefined ? +(hRow.endSec - fRow.endSec).toFixed(3) : undefined,
        deltaQi: hRow?.deltaQi,
        anchorQi: hRow?.anchorQi,
        reasonIfUnresolved: unresolvedViolation?.fallback,
      });
    }
    const resolvedCount = seamResolutions.filter(s => s.resolvedInH).length;

    // ---- WRITE THE PLAN --------------------------------------------------------
    const dest = resolve(REPLAY_ROOT, 'v6', 'fa_an_h_chunks.json');
    const excisedSec = gaps.reduce((a, g) => a + (g.endSec - g.startSec), 0);
    const payload = {
      _runId: `an-h-${new Date().toISOString().replace(/[:.]/g, '')}`,
      audioDuration: spec.audioDuration,
      language: spec.language,
      _source: {
        note: 'WS1 Session AN arm H — computeFaChunkPlanS2EdgeArm(anchorTimed, rawWhisperTokens, nativeSilences, '
          + `audioDuration, { kind: 'anchor-widened' }, ${AM_TARGET_MIN_SEC}, ${AM_TARGET_MAX_SEC}) AT HEAD. Base is `
          + 'arm F: internal chunk edges placed at the qi-nearest faAnchors.ts three-source-agreement anchor inside '
          + 'the two sentence groups the seam separates; where NO such anchor exists, arm H tries ONE additional '
          + 'search widened by exactly one more sentence group on each side before falling back to arm C\'s own '
          + 'nearest-detected-silence cut. Every other aspect (10-30s band, R.5 excision, packing) held identical '
          + 'to arm F/arm C.',
        anchorTimedSegments: anchorTimed.length,
        silenceCount: silences.length,
        r5RunCount: runs.length,
        excisedSpans: gaps.length,
        excisedSec: round6(excisedSec),
        violationCount: armH.violations.length,
        edgeCensus: armH.edgeCensus,
      },
      chunks: armH.chunks,
    };
    const text = JSON.stringify(payload, null, 2);
    writeFileSync(dest, text);

    // ---- REPORT -----------------------------------------------------------
    const L: string[] = [];
    L.push('# WS1 Session AN Step 3 — arm H chunk inspection (MEASURED, v6, no FA run)');
    L.push('');
    L.push('One-group-wider anchor search, tried ONLY at seams arm F\'s own two-group window could not resolve.');
    L.push('Base is ARM F, not arm C.');
    L.push('');
    L.push('## The claims that make this one variable from arm F');
    L.push('');
    L.push('| claim | result |');
    L.push('|---|---|');
    L.push(`| \`{ kind: 'silence' }\` still reproduces \`computeFaChunkPlanS2Excised\` exactly | **${controlEqualsArmC}** |`);
    L.push(`| arm B still reproduces \`fa_ai_chunks.json\` at HEAD | **${bReproduces}** |`);
    L.push(`| arm C still reproduces \`fa_ak_chunks.json\` at HEAD | **${cReproduces}** |`);
    L.push(`| arm F still reproduces \`fa_am_f_chunks.json\` at HEAD | **${fReproduces}** |`);
    L.push(`| arm H text equals arm F text word for word | **true** (asserted) |`);
    L.push('');
    L.push('## The five fallback seams, individually resolved or not');
    L.push('');
    L.push('| closing seg | arm-F chunk | resolved in H? | via widened window? | Δqi | anchor qi | arm F cut | arm H cut | Δ (s) | reason if unresolved |');
    L.push('|---|---|---|---|---|---|---|---|---|---|');
    for (const s of seamResolutions) {
      L.push(`| ${s.closingSegIdx} | ${s.chunkIdxInF} | ${s.resolvedInH ? '**YES**' : 'no'} `
        + `| ${s.viaWidenedWindow ? 'YES' : 'n/a'} | ${s.deltaQi ?? '—'} | ${s.anchorQi ?? '—'} `
        + `| ${s.armFCutSec?.toFixed(3) ?? '—'} | ${s.armHCutSec?.toFixed(3) ?? '—'} | ${s.deltaSec ?? '—'} `
        + `| ${s.reasonIfUnresolved ?? '—'} |`);
    }
    L.push('');
    L.push(`**${resolvedCount} of 5 fallback seams resolved to an admissible anchor under the widened window.**`);
    L.push('');
    L.push('## Edge census — how each internal edge was actually placed');
    L.push('');
    L.push('| cut kind | count |');
    L.push('|---|---|');
    for (const [k, v] of Object.entries(armH.edgeCensus)) L.push(`| \`${k}\` | ${v} |`);
    L.push('');
    L.push('## Conservation properties — did either fire at this band?');
    L.push('');
    L.push(`- **TEXT carry-forward on a collapsed window: ${collapsed.length === 0 ? 'DID NOT FIRE' : `FIRED ${collapsed.length} time(s)`}.**`);
    L.push(`- **TIME monotone cursor: holds — ${cursorMonotone}.**`);
    L.push('');
    L.push('## The complete violation list (not a summary)');
    L.push('');
    L.push(`Total violation events: **${armH.violations.length}** (arm F had ${armF.violations.length}).`);
    L.push('');
    if (armH.violations.length === 0) {
      L.push('_None._');
    } else {
      L.push('| # | cause | segIdx | ideal | seam | dur | what the planner did |');
      L.push('|---|---|---|---|---|---|---|');
      armH.violations.forEach((v, i) => {
        L.push(`| ${i} | \`${v.cause}\` | ${v.segIdx} | ${v.idealSec.toFixed(3)} | ${v.seamSec?.toFixed(3) ?? '—'} `
          + `| ${v.durationSec?.toFixed(3) ?? '—'} | ${v.fallback.replace(/\|/g, '\\|')} |`);
      });
    }
    L.push('');

    const dumpText = `${L.join('\n')}\n`;
    writeFileSync(resolve(OUT, 'step3-armh.md'), dumpText);
    writeFileSync(resolve(DOCS, 'session-an-armh-inspection.md'), dumpText);

    writeFileSync(resolve(OUT, 'step3-armh.json'), JSON.stringify({
      controlEqualsArmC, bReproduces, cReproduces, fReproduces,
      armHChunks: armH.chunks.length, armFChunks: armF.chunks.length,
      edgeCensus: armH.edgeCensus,
      r5Runs: runs.length, excisedSpans: gaps.length, excisedSec: round6(excisedSec),
      conservation: { collapsedChunks: collapsed.length, cursorMonotone },
      seamResolutions, resolvedCount,
      violations: armH.violations,
      inspection: armH.inspection,
      planSha256: createHash('sha256').update(text).digest('hex'),
    }, null, 2));

    // eslint-disable-next-line no-console
    console.log(L.join('\n'));
  }, 300_000);
});
