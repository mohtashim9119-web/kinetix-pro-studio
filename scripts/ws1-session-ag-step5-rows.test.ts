/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// ---------------------------------------------------------------------------
// WS1 Session AG — STEP 5. THE 13 ATTRIBUTED ROWS, BEFORE AND AFTER S1.
//
// Runs the production rule stage twice over each corpus — once on the baseline
// FA arm, once on the S1 arm — and reports, per attributed row:
//   * the incoming segment's own anchor confidence, before and after;
//   * the committed boundary, before and after;
//   * distance to the ear-verified correct value;
//   * CORRECT (within +-50 ms of the ear value) and DIRECTION-CORRECT (moved
//     toward it but outside tolerance) as SEPARATE columns, never merged.
//
// Also re-scores the two rows the root-cause report attributes elsewhere, and
// the 13 production pins.
//
// READ-ONLY. Gated:
//   WS1_SESSION_AG_MEASURE=1 npx vitest run scripts/ws1-session-ag-step5-rows.test.ts
// ---------------------------------------------------------------------------

import { describe, it } from 'vitest';
import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { resolve } from 'path';

import { CORPORA, runProductionPath, tagOf, REPO, REPLAY_ROOT } from './ws1-session-p-pipeline.js';
import { earHistory } from './ws1-ear-pass-ledger.js';
import type { Corpus } from './ws1-ear-pass-ledger.js';
import type { TranscriptToken } from '../src/types';

const MEASURE = process.env.WS1_SESSION_AG_MEASURE === '1';
const ARM = process.env.WS1_AG_ARM ?? 'ag_s1_words.json';
const OUT = resolve(REPO, '.work-phase4/session-ag');
/** The brief's own tolerance. Not a tuned quantity — it is the reporting
 *  boundary Session AE already used for "within 50 ms of the ear target". */
const TOL_SEC = 0.050;

const confOf = (t: TranscriptToken | undefined): number =>
  t === undefined ? 0 : ((t as { confidence?: number }).confidence ?? 0);

const ROWS: Array<{ corpus: Corpus; tag: string; attributed: boolean; note?: string }> = [
  { corpus: 'v6', tag: '008_unknown_void', attributed: true },
  { corpus: 'v6', tag: '056_dropping_torch', attributed: true },
  { corpus: 'v6', tag: '152_frozen_brush_mice', attributed: true },
  { corpus: 'v6', tag: '167_smell_of_butchery', attributed: true },
  { corpus: 'v6', tag: '214_solitary_fire', attributed: true },
  { corpus: 'v6', tag: '231_slowing_pace', attributed: true },
  { corpus: 'v6', tag: '286_fact_to_act', attributed: true },
  { corpus: 'v6', tag: '400_endless_dark', attributed: true },
  { corpus: 'v6', tag: '403_vigilant_embers', attributed: true },
  { corpus: 'v6', tag: '447_scout_facing_dark', attributed: true },
  { corpus: '173', tag: 'lethal_nature_hazard', attributed: true },
  { corpus: '173', tag: 'wall_split_path', attributed: true },
  { corpus: '173', tag: 'logic_clash', attributed: true },
  { corpus: '173', tag: 'iron_bounce', attributed: false, note: 'wrong-silence selection' },
  { corpus: '173', tag: 'gadget_decay', attributed: false, note: 'no chunk edge, no silence' },
];

/** The ear-verified CORRECT target for a row, or null. */
function earTarget(corpus: Corpus, tag: string): number | null {
  for (const r of earHistory(corpus, tag)) {
    if (r.verdict === 'CORRECT' && r.scoredValue !== null) return r.scoredValue;
  }
  return null;
}

describe.skipIf(!MEASURE)('WS1 Session AG Step 5 — the attributed rows before and after S1', () => {
  it('scores every attributed row on both arms', async () => {
    mkdirSync(OUT, { recursive: true });
    const L: string[] = [];
    const out: unknown[] = [];

    L.push(`WS1 SESSION AG — STEP 5: THE ATTRIBUTED ROWS   S1 arm="${ARM}"`);
    L.push(`CORRECT tolerance +-${(TOL_SEC * 1000).toFixed(0)} ms; DIRECTION-CORRECT reported separately.`);
    L.push('');

    for (const key of ['v6', '173'] as const) {
      if (!existsSync(resolve(REPLAY_ROOT, key, ARM))) {
        L.push(`######## ${key}: SKIPPED — no ${ARM}\n`); continue;
      }
      const base = await runProductionPath(CORPORA[key]!);
      const s1 = await runProductionPath(CORPORA[key]!, true, undefined, ARM);
      L.push(`######## ${key}`);
      L.push(`  rules base: ${JSON.stringify(base.fired)}`);
      L.push(`  rules S1  : ${JSON.stringify(s1.fired)}`);
      L.push('');

      for (const row of ROWS.filter(r => r.corpus === key)) {
        const bi = base.committed.findIndex(s => tagOf(s) === row.tag);
        const si = s1.committed.findIndex(s => tagOf(s) === row.tag);
        if (bi < 1 || si < 1) {
          L.push(`  ${row.tag}: NOT COMMITTED on one of the arms (base ${bi}, S1 ${si})`);
          continue;
        }
        const bConf = confOf(base.usableFaTokens[base.keptAlignments[bi]!.firstTokenIdx]);
        const sConf = confOf(s1.usableFaTokens[s1.keptAlignments[si]!.firstTokenIdx]);
        const bVal = base.committed[bi]!.startTime;
        const sVal = s1.committed[si]!.startTime;
        // The PRE-RULE (post-snap) value on each arm. This is the column that
        // answers "did S1 remove the NEED for R.14", as opposed to "did the
        // final number change": a row whose baseline pre-rule value is wrong
        // and only becomes right because R.14 corrected it, but whose S1
        // pre-rule value is already right, has been fixed at the source.
        const bPre = base.preRuleSegments.find(x => x.id === base.committed[bi]!.id)?.startTime ?? bVal;
        const sPre = s1.preRuleSegments.find(x => x.id === s1.committed[si]!.id)?.startTime ?? sVal;
        const bRule = base.anchorTrust.find(f => f.segmentTag === row.tag);
        const sRule = s1.anchorTrust.find(f => f.segmentTag === row.tag);
        const ear = earTarget(key as Corpus, row.tag);

        const dBefore = ear === null ? null : Math.abs(bVal - ear);
        const dAfter = ear === null ? null : Math.abs(sVal - ear);
        const correct = dAfter !== null && dAfter <= TOL_SEC;
        // DIRECTION-CORRECT is strictly "moved toward, still outside tolerance"
        // — it is NOT a weaker form of CORRECT and is never merged with it.
        const directionCorrect = !correct && dBefore !== null && dAfter !== null
          && Math.abs(sVal - bVal) > 1e-6 && dAfter < dBefore;
        const worsened = dBefore !== null && dAfter !== null && dAfter > dBefore + 1e-6;

        L.push(`  ${row.tag}${row.attributed ? '' : '  [NOT-ATTRIBUTED: ' + row.note + ']'}`);
        L.push(`     incoming anchor conf : ${bConf.toExponential(2)}  ->  ${sConf.toExponential(2)}` +
          `   (${sConf > bConf ? 'ROSE' : sConf < bConf ? 'FELL' : 'unchanged'})`);
        L.push(`     pre-rule (snap only) : ${bPre.toFixed(3)}  ->  ${sPre.toFixed(3)}` +
          `   [rule that moved it: base ${bRule ? bRule.rule : 'none'}, S1 ${sRule ? sRule.rule : 'none'}]`);
        L.push(`     committed boundary   : ${bVal.toFixed(3)}  ->  ${sVal.toFixed(3)}   ` +
          `delta=${(sVal - bVal >= 0 ? '+' : '')}${(sVal - bVal).toFixed(3)}`);
        L.push(`     ear target           : ${ear === null ? 'none' : ear.toFixed(3)}   ` +
          `dist ${dBefore === null ? 'n/a' : dBefore.toFixed(3)} -> ${dAfter === null ? 'n/a' : dAfter.toFixed(3)}`);
        L.push(`     CORRECT=${correct}   DIRECTION-CORRECT=${directionCorrect}   WORSENED=${worsened}`);

        out.push({
          corpus: key, tag: row.tag, attributed: row.attributed,
          confBefore: bConf, confAfter: sConf,
          before: bVal, after: sVal, delta: sVal - bVal,
          preBefore: bPre, preAfter: sPre,
          ruleBefore: bRule?.rule ?? null, ruleAfter: sRule?.rule ?? null,
          ear, distBefore: dBefore, distAfter: dAfter,
          correct, directionCorrect, worsened,
        });
      }
      L.push('');
    }

    const att = out.filter(r => (r as { attributed: boolean }).attributed);
    const nCorrect = att.filter(r => (r as { correct: boolean }).correct).length;
    const nDir = att.filter(r => (r as { directionCorrect: boolean }).directionCorrect).length;
    const nWorse = att.filter(r => (r as { worsened: boolean }).worsened).length;
    L.push('=== SUMMARY over the attributed rows scored on both arms ===');
    L.push(`  scored=${att.length}  CORRECT=${nCorrect}  DIRECTION-CORRECT=${nDir}  WORSENED=${nWorse}`);

    console.log(L.join('\n'));
    writeFileSync(resolve(OUT, 'step5-rows.txt'), L.join('\n') + '\n');
    writeFileSync(resolve(OUT, 'step5-rows.json'), JSON.stringify(out, null, 2) + '\n');
  }, 3_600_000);
});
