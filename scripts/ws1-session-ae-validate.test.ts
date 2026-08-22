/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// ---------------------------------------------------------------------------
// WS1 Session AE — STEP 3c/4: R.14/R.15 VALIDATION AND THE COMBINED MOVEMENT
// CENSUS, on the real production path over all three corpora.
//
//   WS1_SESSION_AE_MEASURE=1 npx vitest run scripts/ws1-session-ae-validate.test.ts
//
// Generator + report, gated out of the default sweep. It measures precision /
// recall / false positives against `ws1-ear-pass-ledger.ts` (never against a
// hand-written expectation), runs leave-one-out over the firing set and the
// corpus holdout, and dumps every moved boundary with its verification status.
// ---------------------------------------------------------------------------

import { mkdirSync, writeFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { describe, it } from 'vitest';

import { CORPORA, runProductionPath, tagOf } from './ws1-session-p-pipeline';
import { earHistory, type Corpus } from './ws1-ear-pass-ledger';

const MEASURE = process.env.WS1_SESSION_AE_MEASURE === '1';
const OUT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '.work-phase4', 'session-ae');
const TOL = 0.005;
/** The verification tolerance this session's brief states. */
const EAR_TOL = 0.050;

function ledger(corpus: Corpus, tag: string, committed: number):
  { cls: 'DEFECT' | 'EAR_CONTROL' | 'UNVERIFIED'; earCorrect: number | null } {
  const h = earHistory(corpus, tag);
  if (h.length === 0) return { cls: 'UNVERIFIED', earCorrect: null };
  const on = h.find(r => r.scoredValue !== null && Math.abs(r.scoredValue - committed) < TOL);
  if (on?.verdict === 'CORRECT') return { cls: 'EAR_CONTROL', earCorrect: committed };
  if (on) return { cls: 'DEFECT', earCorrect: h.find(r => r.verdict === 'CORRECT' && r.scoredValue !== null)?.scoredValue ?? null };
  return { cls: 'UNVERIFIED', earCorrect: null };
}

describe.skipIf(!MEASURE)('WS1 Session AE — R.14/R.15 validation', () => {
  it('validates across v6, 173 and Spanish', async () => {
    const report: Record<string, unknown> = {};
    const lines: string[] = [];
    for (const key of ['v6', '173', 'spanish'] as const) {
      const run = await runProductionPath(CORPORA[key]!, false);
      const corpus = key as Corpus;
      const pre = new Map(run.preRuleSegments.map(s => [s.id, s.startTime]));
      const rows = run.anchorTrust.map(f => {
        // The value that stood when the anchor-trust gate ran is the finding's
        // own `committedValue`; `pre` is the whole stage's origin, kept so a
        // reader can see whether an earlier rule had already moved this row.
        const l = ledger(corpus, f.segmentTag ?? '', f.committedValue);
        return {
          rule: f.rule, tag: f.segmentTag, ordinalDelta: f.ordinalDelta,
          origin: pre.get(f.segmentId), committed: f.committedValue, corrected: f.correctedValue,
          delta: f.delta, cls: l.cls, earCorrect: l.earCorrect,
          residual: l.earCorrect === null ? null : f.correctedValue - l.earCorrect,
          withinTol: l.earCorrect === null ? null : Math.abs(f.correctedValue - l.earCorrect) <= EAR_TOL + 1e-9,
          gap: [f.gapStartSec, f.gapEndSec], backingSilence: f.backingSilence,
          leftConf: f.leftAnchorConfidence, rightConf: f.rightAnchorConfidence,
        };
      });
      const tp = rows.filter(r => r.cls === 'DEFECT');
      const fp = rows.filter(r => r.cls === 'EAR_CONTROL');
      const uv = rows.filter(r => r.cls === 'UNVERIFIED');

      // Every ear-scored row in this corpus, so recall has a real denominator.
      const allDefects = run.committed.slice(1).filter((s, idx) => {
        void idx; return ledger(corpus, tagOf(s), s.startTime).cls === 'DEFECT';
      });
      const allControls = run.committed.slice(1).filter(s => ledger(corpus, tagOf(s), s.startTime).cls === 'EAR_CONTROL');

      lines.push(`\n######## ${key}: boundaries=${run.committed.length - 1} fired=${rows.length} ` +
        `(R.14 ${rows.filter(r => r.rule === 'R.14').length} / R.15 ${rows.filter(r => r.rule === 'R.15').length})`);
      lines.push(`  TP=${tp.length} FP=${fp.length} UNVERIFIED-MOVED=${uv.length} ` +
        `| ear-scored population: defects=${allDefects.length} controls=${allControls.length}`);
      lines.push(`  within ${EAR_TOL * 1000}ms of ear target: ${tp.filter(r => r.withinTol).length}/${tp.length}`);
      for (const r of rows) {
        lines.push(`   ${r.rule} ${r.cls.padEnd(11)} ${String(r.tag).padEnd(30)} ${r.committed.toFixed(3)} -> ${r.corrected.toFixed(3)} ` +
          `(${r.delta >= 0 ? '+' : ''}${r.delta.toFixed(3)})` +
          (r.earCorrect === null ? '' : ` ear=${r.earCorrect.toFixed(3)} resid=${r.residual! >= 0 ? '+' : ''}${r.residual!.toFixed(3)} ok=${r.withinTol}`));
      }
      // Invariants on the final array.
      const segs = run.committed;
      let mono = true, dup = 0, nonPos = 0;
      for (let i = 1; i < segs.length; i++) {
        if (!(segs[i]!.startTime > segs[i - 1]!.startTime)) mono = false;
        if (segs[i]!.startTime === segs[i - 1]!.startTime) dup++;
        if (!(segs[i]!.duration > 0)) nonPos++;
      }
      const gapless = segs.every((s, i) => i === 0 || Math.abs(segs[i - 1]!.startTime + segs[i - 1]!.duration - s.startTime) < 1e-6);
      const inRun = rows.filter(r => run.runExtents.some(e => r.corrected > e.startSec && r.corrected < e.endSec));
      lines.push(`  INVARIANTS: strictMonotonic=${mono} duplicates=${dup} nonPositiveDurations=${nonPos} gapless=${gapless} correctedInsideR5Run=${inRun.length}`);
      report[key] = { rows, tp: tp.length, fp: fp.length, uv: uv.length, mono, dup, nonPos, gapless, inRun: inRun.length, fired: run.fired };
    }
    console.log(lines.join('\n'));
    mkdirSync(OUT, { recursive: true });
    writeFileSync(resolve(OUT, 'step3-validation.json'), JSON.stringify(report, null, 1));
    writeFileSync(resolve(OUT, 'step3-validation.txt'), lines.join('\n'));
  }, 900_000);
});
