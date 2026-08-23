/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// ---------------------------------------------------------------------------
// WS1 Session AG — STEP 1 DIAGNOSTIC. WHICH condition does each attributed
// defect fail?
//
// Step 1's funnel put only 2 of the root-cause report's 13 attributed defects
// in the (1)^(2)^(3) set. That is either a refutation of the mechanism claim
// or a defect in the census. This file decides which, per row, by printing the
// raw evidence each condition is computed from: the chunk that ends at the
// seam, every FA token in it with its posterior, whether each token sits
// wholly inside a detected silence, the two segments' own claimed token
// indices, and where the pre-rule boundary landed.
//
// READ-ONLY. Gated:
//   WS1_SESSION_AG_MEASURE=1 npx vitest run scripts/ws1-session-ag-diagnose.test.ts
// ---------------------------------------------------------------------------

import { describe, it } from 'vitest';
import { writeFileSync, mkdirSync } from 'fs';
import { resolve } from 'path';

import { CORPORA, runProductionPath, tagOf, REPO } from './ws1-session-p-pipeline.js';
import { CONF_MIN_FALLBACK } from '../src/services/syncConstants';
import type { TranscriptToken } from '../src/types';
import type { SilenceInterval } from '../src/services/silenceDetector';

const MEASURE = process.env.WS1_SESSION_AG_MEASURE === '1';
const OUT = resolve(REPO, '.work-phase4/session-ag');

const confOf = (t: TranscriptToken | undefined): number =>
  t === undefined ? 0 : ((t as { confidence?: number }).confidence ?? 0);

const containing = (t: TranscriptToken, sil: readonly SilenceInterval[]): SilenceInterval | undefined =>
  sil.find(s => s.startSec <= t.startSec && t.endSec <= s.endSec);

const TARGETS: Record<string, string[]> = {
  v6: ['008_unknown_void', '056_dropping_torch', '152_frozen_brush_mice', '167_smell_of_butchery',
    '214_solitary_fire', '231_slowing_pace', '286_fact_to_act', '400_endless_dark',
    '403_vigilant_embers', '447_scout_facing_dark'],
  '173': ['lethal_nature_hazard', 'wall_split_path', 'logic_clash', 'iron_bounce', 'gadget_decay'],
};

describe.skipIf(!MEASURE)('WS1 Session AG — per-defect condition diagnostic', () => {
  it('prints the raw evidence behind each condition for every attributed defect', async () => {
    mkdirSync(OUT, { recursive: true });
    const L: string[] = [];

    for (const key of ['v6', '173'] as const) {
      const run = await runProductionPath(CORPORA[key]!);
      const toks = run.usableFaTokens;
      const sil = run.silences;
      const chunks = run.chunks;
      const preById = new Map(run.preRuleSegments.map(s => [s.id, s.startTime]));

      L.push(`\n################ ${key}  (chunks=${chunks.length}, faTokens=${toks.length})`);

      for (const tag of TARGETS[key]!) {
        const i = run.committed.findIndex(s => tagOf(s) === tag);
        L.push(`\n==== ${tag}`);
        if (i < 1) { L.push('  NOT COMMITTED (or is index 0) — no seam to examine.'); continue; }

        const seg = run.committed[i]!;
        const lA = run.keptAlignments[i - 1]!, rA = run.keptAlignments[i]!;
        const pre = preById.get(seg.id) ?? seg.startTime;
        const lTok = toks[lA.lastTokenIdx], rTok = toks[rA.firstTokenIdx];
        L.push(`  pre-rule boundary = ${pre.toFixed(3)}   committed = ${seg.startTime.toFixed(3)}`);
        L.push(`  outgoing seg last claimed tok[${lA.lastTokenIdx}] = ` +
          (lTok ? `'${lTok.text}' [${lTok.startSec.toFixed(3)},${lTok.endSec.toFixed(3)}] conf=${confOf(lTok).toExponential(2)}` : 'NONE'));
        L.push(`  incoming seg first claimed tok[${rA.firstTokenIdx}] = ` +
          (rTok ? `'${rTok.text}' [${rTok.startSec.toFixed(3)},${rTok.endSec.toFixed(3)}] conf=${confOf(rTok).toExponential(2)}` : 'NONE'));
        if (rTok) {
          const s = containing(rTok, sil);
          L.push(`    incoming first word phantom? conf<${CONF_MIN_FALLBACK}: ${confOf(rTok) < CONF_MIN_FALLBACK}` +
            `  whollyInSilence: ${s ? `YES [${s.startSec.toFixed(3)},${s.endSec.toFixed(3)}]` : 'NO'}`);
        }

        // Which chunk holds the incoming segment's first claimed token?
        const ci = chunks.findIndex(c => rTok !== undefined && rTok.startSec >= c.startSec && rTok.startSec < c.endSec);
        L.push(`  chunk holding that token: ${ci < 0 ? 'NONE' : `#${ci} [${chunks[ci]!.startSec.toFixed(2)},${chunks[ci]!.endSec.toFixed(2)}]`}`);
        if (ci >= 0) {
          const c = chunks[ci]!;
          const inC: number[] = [];
          for (let t = 0; t < toks.length; t++) {
            if (toks[t]!.startSec >= c.startSec && toks[t]!.startSec < c.endSec) inC.push(t);
          }
          const isLast = inC.length > 0 && inC[inC.length - 1] === rA.firstTokenIdx;
          L.push(`    that chunk holds tokens [${inC[0]}..${inC[inC.length - 1]}] (${inC.length}); ` +
            `is the incoming first word the chunk's LAST token? ${isLast}`);
          L.push(`    chunk text: "${c.text.slice(0, 160)}${c.text.length > 160 ? '…' : ''}"`);
          const tailShow = inC.slice(-6);
          for (const t of tailShow) {
            const tk = toks[t]!;
            const s = containing(tk, sil);
            L.push(`      tok[${t}] '${tk.text}' [${tk.startSec.toFixed(3)},${tk.endSec.toFixed(3)}] ` +
              `conf=${confOf(tk).toExponential(2)} phantom=${confOf(tk) < CONF_MIN_FALLBACK && s !== undefined}` +
              `${s ? ` silence[${s.startSec.toFixed(3)},${s.endSec.toFixed(3)}]` : ' silence:none'}`);
          }
        }

        if (lTok && rTok) {
          const gs = lTok.endSec, ge = rTok.startSec;
          L.push(`  gap = [${gs.toFixed(3)}, ${ge.toFixed(3)}] width ${(ge - gs).toFixed(3)}; ` +
            `pre-rule boundary inside gap? ${pre >= gs - 1e-9 && pre <= ge + 1e-9}`);
        }
      }
    }

    console.log(L.join('\n'));
    writeFileSync(resolve(OUT, 'step1-diagnose.txt'), L.join('\n') + '\n');
  }, 1_800_000);
});
