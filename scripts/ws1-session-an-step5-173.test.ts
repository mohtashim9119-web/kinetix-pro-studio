/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// ---------------------------------------------------------------------------
// WS1 Session AN — STEP 5. CONDITIONAL 173 EXTENSION.
//
// Condition (Step 1 §3 progress bar, met on v6 per Step 4): regressed (5ms
// band) < arm F's 68 AND >= 1 fallback seam recovered. MEASURED Step 4:
// regressed 46 < 68, 5/5 seams recovered, HARD FAIL 3 did not fire. Condition
// MET — this step runs.
//
// Extends the BETTER of arm F or arm H (arm H, unambiguously better on every
// v6 axis measured in Step 4) UNCHANGED — same function, same band, no
// re-tuning — to the 173 corpus only. Spanish stays out of scope.
//
// PART A (this file, no FA): generates arm H's 173 chunk plan.
// PART B (a separate real `cargo test` run, same mechanism as Step 3/v6):
//   produces `fa_an_h_words.json` under `.work-phase4/replay/173/`.
// PART C (this file, second `it()`, runs only once the words file exists):
//   the real oracle diff, arch verdict, and open-defect status on 173.
//
// Gated: WS1_SESSION_AN_MEASURE=1 npx vitest run scripts/ws1-session-an-step5-173.test.ts
// ---------------------------------------------------------------------------

import { describe, it, expect } from 'vitest';
import { writeFileSync, readFileSync, mkdirSync, existsSync } from 'fs';
import { resolve } from 'path';

import { CORPORA, REPO, REPLAY_ROOT, loadLiveBundle, runProductionPath, tagOf } from './ws1-session-p-pipeline.js';
import { parseProjectData } from '../src/App';
import { applyAnchorBasedTiming } from '../src/services/syncEngine';
import { computeFaChunkPlanS2EdgeArm, computeFaChunkPlanS2Excised, computeUnscriptedRuns } from '../src/services/faChunkPlan';
import type { FaChunk } from '../src/services/faChunkPlan';
import { AM_TARGET_MIN_SEC, AM_TARGET_MAX_SEC } from './ws1-session-am-step1-gate.js';
import { HARD_FAIL_MOVE_SEC, EAR_BILL_TOLERANCE_SEC, DEFECT_LANDED_SEC } from './ws1-session-an-step1-gate.js';

const MEASURE = process.env.WS1_SESSION_AN_MEASURE === '1';
const OUT = resolve(REPO, '.work-phase4/session-an');
const DOCS = resolve(REPO, 'docs/ws1-sync-pipeline');
const KEY = '173';

interface OracleBoundary { index: number; tag: string; startTime: number; duration: number; openDefect?: boolean; earTarget?: number }

describe.skipIf(!MEASURE)('WS1 Session AN Step 5 — 173 extension (CONDITIONAL, condition MET)', () => {
  it('generates arm H\'s 173 chunk plan (no FA run)', async () => {
    mkdirSync(OUT, { recursive: true });
    const spec = CORPORA[KEY]!;
    const { silences, whisperTokens } = loadLiveBundle(KEY);
    const segsRaw = await parseProjectData(
      readFileSync(spec.scriptPath, 'utf-8'), readFileSync(spec.sceneDetailsPath, 'utf-8'), [], spec.audioDuration,
    );
    const anchorTimed = applyAnchorBasedTiming(segsRaw, spec.audioDuration);
    const runs = computeUnscriptedRuns(anchorTimed, whisperTokens, silences, spec.audioDuration);
    const armC = computeFaChunkPlanS2Excised(anchorTimed, whisperTokens, silences, spec.audioDuration, AM_TARGET_MIN_SEC, AM_TARGET_MAX_SEC);
    const armH = computeFaChunkPlanS2EdgeArm(
      anchorTimed, whisperTokens, silences, spec.audioDuration, { kind: 'anchor-widened' }, AM_TARGET_MIN_SEC, AM_TARGET_MAX_SEC,
    );

    // Structural invariants — same checks as Step 3, on the 173 corpus.
    for (let i = 0; i < armH.chunks.length; i++) {
      const c = armH.chunks[i]!;
      expect(c.endSec).toBeGreaterThan(c.startSec);
      expect(c.text.length).toBeGreaterThan(0);
      if (i > 0) expect(c.startSec).toBeGreaterThanOrEqual(armH.chunks[i - 1]!.endSec - 1e-9);
    }
    expect(armH.chunks.map(c => c.text).join(' ')).toBe(armC.chunks.map(c => c.text).join(' '));
    expect(runs.length, '173 carries ZERO R.5 recitation runs — MEASURED Session AK; the excision seam '
      + 'plumbing is therefore inert on this corpus by construction, not merely unobserved').toBe(0);

    const dest = resolve(REPLAY_ROOT, KEY, 'fa_an_h_chunks.json');
    const payload = {
      _runId: `an-h-173-${new Date().toISOString().replace(/[:.]/g, '')}`,
      audioDuration: spec.audioDuration,
      language: spec.language,
      _source: {
        note: 'WS1 Session AN Step 5 — arm H (one-group-wider fallback-seam recovery), UNCHANGED from the v6 '
          + 'run, extended to 173. No re-tuning.',
        r5RunCount: runs.length,
        violationCount: armH.violations.length,
        edgeCensus: armH.edgeCensus,
      },
      chunks: armH.chunks,
    };
    writeFileSync(dest, JSON.stringify(payload, null, 2));
    expect(armH.chunks.length).toBeGreaterThan(0);
  }, 120_000);

  it.skipIf(!existsSync(resolve(REPLAY_ROOT, KEY, 'fa_an_h_words.json')))(
    'measures arm H against the 173 oracle, once fa_an_h_words.json exists', async () => {
    const spec = CORPORA[KEY]!;
    const oracle = JSON.parse(readFileSync(resolve(REPO, `scripts/fixtures/session-aj0-oracle-${KEY}.json`), 'utf-8')) as
      { segmentCount: number; boundaries: OracleBoundary[] };

    const A = await runProductionPath(spec);
    const C = await runProductionPath(spec, true, undefined, 'fa_ak_words.json');
    const H = await runProductionPath(spec, true, undefined, 'fa_an_h_words.json');
    const planOf = (f: string): FaChunk[] => (JSON.parse(readFileSync(resolve(REPLAY_ROOT, KEY, f), 'utf-8')) as { chunks: FaChunk[] }).chunks;
    const arms = { A: { run: A, chunks: A.chunks }, C: { run: C, chunks: planOf('fa_ak_chunks.json') }, H: { run: H, chunks: planOf('fa_an_h_chunks.json') } };
    const vals = { A: new Map(A.committed.map(s => [tagOf(s), s.startTime])), C: new Map(C.committed.map(s => [tagOf(s), s.startTime])), H: new Map(H.committed.map(s => [tagOf(s), s.startTime])) };

    const diffOf = (v: Map<string, number>): { unchanged: number; repaired: number; regressed: number; unadjudicable: number; beyondHardFail: number; regressedRows: Array<Record<string, unknown>> } => {
      let unchanged = 0, repaired = 0, regressed = 0, unadj = 0;
      const regressedRows: Array<Record<string, unknown>> = [];
      for (const b of oracle.boundaries) {
        const x = v.get(b.tag);
        if (x === undefined) { unadj++; continue; }
        const d = x - b.startTime;
        if (Math.abs(d) < 1e-9) { unchanged++; continue; }
        if (b.openDefect) {
          if (b.earTarget !== undefined && Math.abs(x - b.earTarget) <= DEFECT_LANDED_SEC) repaired++;
          else unadj++;
          continue;
        }
        if (Math.abs(d) <= EAR_BILL_TOLERANCE_SEC) { unadj++; continue; }
        regressed++;
        regressedRows.push({ tag: b.tag, oracle: b.startTime, arm: x, delta: +d.toFixed(4), beyondHardFail: Math.abs(d) > HARD_FAIL_MOVE_SEC });
      }
      return { unchanged, repaired, regressed, unadjudicable: unadj, beyondHardFail: regressedRows.filter(r => r.beyondHardFail).length, regressedRows };
    };
    const diffA = diffOf(vals.A), diffC = diffOf(vals.C), diffH = diffOf(vals.H);

    // ---- ARCH VERDICT on 173 ------------------------------------------------
    const segsRaw = await parseProjectData(readFileSync(spec.scriptPath, 'utf-8'), readFileSync(spec.sceneDetailsPath, 'utf-8'), [], spec.audioDuration);
    const anchorTimed = applyAnchorBasedTiming(segsRaw, spec.audioDuration);
    const estByTag = new Map(anchorTimed.map(s => [tagOf(s), s.startTime]));
    const oracleByTag = new Map(oracle.boundaries.map(b => [b.tag, b.startTime]));
    const decileMeans: Array<{ decile: number; n: number; cMean: number; hMean: number; estMean: number }> = [];
    for (let dec = 0; dec < 10; dec++) {
      const lo = spec.audioDuration * dec / 10, hi = spec.audioDuration * (dec + 1) / 10;
      const inBand = A.committed.filter(s => s.startTime >= lo && s.startTime < hi).map(tagOf);
      const cDiffs: number[] = [], hDiffs: number[] = [], est: number[] = [];
      for (const t of inBand) {
        const a = vals.A.get(t); if (a === undefined) continue;
        const c = vals.C.get(t); if (c !== undefined) cDiffs.push(c - a);
        const h = vals.H.get(t); if (h !== undefined) hDiffs.push(h - a);
        const e = estByTag.get(t), o = oracleByTag.get(t);
        if (e !== undefined && o !== undefined) est.push(e - o);
      }
      const mean = (xs: number[]): number => xs.length === 0 ? 0 : xs.reduce((p, q) => p + q, 0) / xs.length;
      decileMeans.push({ decile: dec, n: inBand.length, cMean: mean(cDiffs), hMean: mean(hDiffs), estMean: mean(est) });
    }
    const peakC = Math.max(...decileMeans.map(d => Math.abs(d.cMean)));
    const peakH = Math.max(...decileMeans.map(d => Math.abs(d.hMean)));
    const hasArch = peakC > 5.0; // reusing the DIED/SURVIVED band's DIED threshold as the "arch exists at all" test

    // ---- OPEN DEFECTS ----------------------------------------------------
    const defectTags = ['lethal_nature_hazard', 'gadget_decay'];
    const defectRows = defectTags.map(tag => {
      const b = oracle.boundaries.find(x => x.tag === tag)!;
      const cell = (v: Map<string, number>): number | undefined => v.get(tag);
      const landed = (v: Map<string, number>): boolean => {
        const x = cell(v); return x !== undefined && b.earTarget !== undefined && Math.abs(x - b.earTarget) <= DEFECT_LANDED_SEC;
      };
      return { tag, ear: b.earTarget, A: cell(vals.A), C: cell(vals.C), H: cell(vals.H), landedA: landed(vals.A), landedC: landed(vals.C), landedH: landed(vals.H) };
    });

    // ---- REPORT ------------------------------------------------------------
    const L: string[] = [];
    L.push('# WS1 Session AN Step 5 — 173 extension (MEASURED)');
    L.push('');
    L.push('Arm H, UNCHANGED from the v6 run (no re-tuning), extended to 173. 173 carries ZERO R.5 runs, so '
      + 'the excision-seam machinery both arms share is structurally inert here.');
    L.push('');
    L.push('## Oracle diff — A vs C vs H, 173 (173 boundaries total)');
    L.push('');
    L.push('| arm | unchanged | repaired | regressed | unadjudicable | beyond ±50ms |');
    L.push('|---|---|---|---|---|---|');
    for (const [name, d] of [['A', diffA], ['C', diffC], ['H', diffH]] as const) {
      L.push(`| ${name} | ${d.unchanged} | ${d.repaired} | **${d.regressed}** | ${d.unadjudicable} | **${d.beyondHardFail}** |`);
    }
    L.push('');
    L.push(`**Does 173 show an arch at all (arm C, peak abs mean decile Δ > 5.0s)? ${hasArch ? '**YES**' : '**NO**'}** (peak C = ${peakC.toFixed(3)}s, peak H = ${peakH.toFixed(3)}s).`);
    L.push('');
    L.push('## 173\'s two open defects, per arm');
    L.push('');
    L.push('| tag | ear | A | landed(A) | C | landed(C) | H | landed(H) |');
    L.push('|---|---|---|---|---|---|---|---|');
    for (const r of defectRows) {
      L.push(`| \`${r.tag}\` | ${r.ear} | ${r.A?.toFixed(3) ?? '—'} | ${r.landedA} | ${r.C?.toFixed(3) ?? '—'} | ${r.landedC} | ${r.H?.toFixed(3) ?? '—'} | **${r.landedH}** |`);
    }
    L.push('');
    L.push('## The "6 previously unexplained 173 control regressions from arm C"');
    L.push('');
    L.push('**NOT DETERMINED.** A targeted search of `docs/work-in-progress.md` and `sync-pipeline-v2-plan.md` '
      + 'did not turn up an explicit, unambiguous list of six specific tags under this description. The closest '
      + 'match found is `vessel_damage_clue` (Session AI\'s original 173 "control regression" set), which '
      + 'Sessions AJ-0/AK already resolved as a stale-bundle-provenance artifact (172.910 vs the correct '
      + '174.740), not a real edge-placement regression — so it is not part of any regression set arm H could '
      + 'meaningfully repair. Stated as a gap rather than a fabricated list: this sub-claim is NEITHER MEASURED '
      + 'NOR INFERRED this session.');
    L.push('');

    const text = `${L.join('\n')}\n`;
    writeFileSync(resolve(OUT, 'step5-173.md'), text);
    writeFileSync(resolve(DOCS, 'session-an-step5-173.md'), text);
    writeFileSync(resolve(OUT, 'step5-173.json'), JSON.stringify({ diffA, diffC, diffH, hasArch, peakC, peakH, decileMeans, defectRows }, null, 2));

    // eslint-disable-next-line no-console
    console.log(L.join('\n'));
    expect(diffH).toBeDefined();
  }, 180_000);
});
