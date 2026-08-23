/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// ---------------------------------------------------------------------------
// WS1 Session AG — STEP 6. THE WORD-GAP INTERVAL, RE-MEASURED ON REPAIRED FA.
//
// WHY THIS IS NOT A REPEAT. WS1 Session AE's interval-word census measured, for
// every ear-scored boundary, whether the ear-verified correct value lies inside
// the WORD GAP — the interval between the outgoing segment's last claimed word
// and the incoming segment's first claimed word. It found that not one v6 row's
// target lies inside its own gap (gaps 0.02-0.36 s against targets 0.32-1.83 s
// later), and Session AE's rule header records that finding as the reason
// R.14's placement cannot be gap-confined.
//
// That measurement is VOID as evidence about the real interval, because the
// gaps it measured were COLLAPSED BY PHANTOMS: the incoming segment's "first
// claimed word" was, on those very rows, a phantom sitting in the outgoing
// chunk's trailing silence, which pins the gap's right edge ~20 ms after the
// outgoing word instead of at the incoming segment's real onset. Measuring an
// interval whose right edge is an artefact and concluding the interval is too
// narrow is circular.
//
// This file re-runs the same measurement on the S1 arm, where that particular
// artefact is removed, and reports per row: the repaired gap, whether the
// ear-correct value now falls inside it, and its position as a fraction of the
// interval's width.
//
// READ-ONLY. Gated:
//   WS1_SESSION_AG_MEASURE=1 npx vitest run scripts/ws1-session-ag-step6-interval.test.ts
// ---------------------------------------------------------------------------

import { describe, it } from 'vitest';
import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { resolve } from 'path';

import { CORPORA, runProductionPath, tagOf, REPO, REPLAY_ROOT } from './ws1-session-p-pipeline.js';
import { EAR_PASS_LEDGER, earHistory } from './ws1-ear-pass-ledger.js';
import type { Corpus } from './ws1-ear-pass-ledger.js';

const MEASURE = process.env.WS1_SESSION_AG_MEASURE === '1';
const ARM = process.env.WS1_AG_ARM ?? 'ag_s1_words.json';
const OUT = resolve(REPO, '.work-phase4/session-ag');

/** Every (corpus, tag) the ledger names a CORRECT value for, defect targets and
 *  controls alike — derived from the ledger, never transcribed. */
function scoredRows(): Array<{ corpus: Corpus; tag: string; ear: number; isDefectTarget: boolean }> {
  const seen = new Set<string>();
  const out: Array<{ corpus: Corpus; tag: string; ear: number; isDefectTarget: boolean }> = [];
  for (const r of EAR_PASS_LEDGER) {
    const k = `${r.corpus}|${r.tag}`;
    if (seen.has(k)) continue;
    const h = earHistory(r.corpus, r.tag);
    const correct = h.find(x => x.verdict === 'CORRECT' && x.scoredValue !== null);
    if (correct === undefined) continue;
    seen.add(k);
    // A row is a DEFECT TARGET if the ledger also holds a non-CORRECT verdict
    // for it — i.e. some value was heard and rejected. Otherwise it is a pure
    // control.
    const isDefectTarget = h.some(x => x.verdict !== 'CORRECT' && x.scoredValue !== null);
    out.push({ corpus: r.corpus, tag: r.tag, ear: correct.scoredValue!, isDefectTarget });
  }
  return out;
}

interface Out {
  corpus: string; tag: string; kind: string; ear: number;
  baseGapStart: number; baseGapEnd: number; baseWidth: number; baseInside: boolean; baseFrac: number | null;
  s1GapStart: number; s1GapEnd: number; s1Width: number; s1Inside: boolean; s1Frac: number | null;
}

describe.skipIf(!MEASURE)('WS1 Session AG Step 6 — word-gap interval on repaired FA', () => {
  it('re-measures the word gap for every ear-scored row on both arms', async () => {
    mkdirSync(OUT, { recursive: true });
    const L: string[] = [];
    const rows = scoredRows();
    const results: Out[] = [];

    L.push(`WS1 SESSION AG — STEP 6: WORD-GAP INTERVAL, BASELINE vs S1 ("${ARM}")`);
    L.push(`ear-scored rows on record: ${rows.length}`);
    L.push('');

    for (const key of ['v6', '173', 'spanish'] as const) {
      if (!existsSync(resolve(REPLAY_ROOT, key, ARM))) { L.push(`######## ${key}: SKIPPED — no ${ARM}\n`); continue; }
      const base = await runProductionPath(CORPORA[key]!);
      const s1 = await runProductionPath(CORPORA[key]!, true, undefined, ARM);

      const gapOf = (run: typeof base, tag: string): [number, number] | null => {
        const i = run.committed.findIndex(s => tagOf(s) === tag);
        if (i < 1) return null;
        const l = run.usableFaTokens[run.keptAlignments[i - 1]!.lastTokenIdx];
        const r = run.usableFaTokens[run.keptAlignments[i]!.firstTokenIdx];
        if (l === undefined || r === undefined) return null;
        return [l.endSec, r.startSec];
      };

      L.push(`######## ${key}`);
      for (const row of rows.filter(r => r.corpus === key)) {
        const bg = gapOf(base, row.tag), sg = gapOf(s1, row.tag);
        if (bg === null || sg === null) { L.push(`  ${row.tag.padEnd(30)} (no gap on one arm)`); continue; }
        const bIn = row.ear >= bg[0] && row.ear <= bg[1];
        const sIn = row.ear >= sg[0] && row.ear <= sg[1];
        const bW = bg[1] - bg[0], sW = sg[1] - sg[0];
        const bF = bW > 0 ? (row.ear - bg[0]) / bW : null;
        const sF = sW > 0 ? (row.ear - sg[0]) / sW : null;
        const kind = row.isDefectTarget ? 'DEFECT-TARGET' : 'CONTROL';
        L.push(`  ${row.tag.padEnd(30)} ${kind.padEnd(14)} ear=${row.ear.toFixed(3)}`);
        L.push(`     baseline gap [${bg[0].toFixed(3)},${bg[1].toFixed(3)}] w=${bW.toFixed(3)} ` +
          `inside=${bIn} frac=${bF === null ? 'n/a' : bF.toFixed(3)}`);
        L.push(`     S1       gap [${sg[0].toFixed(3)},${sg[1].toFixed(3)}] w=${sW.toFixed(3)} ` +
          `inside=${sIn} frac=${sF === null ? 'n/a' : sF.toFixed(3)}`);
        results.push({
          corpus: key, tag: row.tag, kind, ear: row.ear,
          baseGapStart: bg[0], baseGapEnd: bg[1], baseWidth: bW, baseInside: bIn, baseFrac: bF,
          s1GapStart: sg[0], s1GapEnd: sg[1], s1Width: sW, s1Inside: sIn, s1Frac: sF,
        });
      }
      L.push('');
    }

    const tally = (pred: (r: Out) => boolean, sel: (r: Out) => boolean) =>
      results.filter(r => sel(r) && pred(r)).length;
    const isDef = (r: Out) => r.kind === 'DEFECT-TARGET';
    const isCtl = (r: Out) => r.kind === 'CONTROL';

    L.push('=== PHASE 2 VERDICT INPUTS ===');
    L.push(`  defect targets scored: ${results.filter(isDef).length}   ` +
      `ear value inside gap — baseline ${tally(r => r.baseInside, isDef)}, S1 ${tally(r => r.s1Inside, isDef)}`);
    L.push(`  controls scored      : ${results.filter(isCtl).length}   ` +
      `ear value inside gap — baseline ${tally(r => r.baseInside, isCtl)}, S1 ${tally(r => r.s1Inside, isCtl)}`);
    const widened = results.filter(r => r.s1Width > r.baseWidth + 1e-6).length;
    L.push(`  gaps that WIDENED under S1: ${widened} of ${results.length}`);
    const fracs = results.filter(isDef).filter(r => r.s1Inside && r.s1Frac !== null).map(r => r.s1Frac!);
    if (fracs.length > 0) {
      fracs.sort((a, b) => a - b);
      L.push(`  defect-target fractional positions inside the repaired gap: ` +
        `min=${fracs[0]!.toFixed(3)} median=${fracs[fracs.length >> 1]!.toFixed(3)} ` +
        `max=${fracs[fracs.length - 1]!.toFixed(3)}  (n=${fracs.length})`);
      L.push('  A CONSISTENT fractional position across rows would be a placement rule; ' +
        'a scattered one would not.');
    }

    console.log(L.join('\n'));
    writeFileSync(resolve(OUT, 'step6-interval.txt'), L.join('\n') + '\n');
    writeFileSync(resolve(OUT, 'step6-interval.json'), JSON.stringify(results, null, 2) + '\n');
  }, 3_600_000);
});
