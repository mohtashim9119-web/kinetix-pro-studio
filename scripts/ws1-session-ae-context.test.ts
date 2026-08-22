/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */
// WS1 Session AE — Step 1 context dump (read-only generator, gated).
//   WS1_SESSION_AE_MEASURE=1 npx vitest run scripts/ws1-session-ae-context.test.ts
import { describe, it } from 'vitest';
import { CORPORA, runProductionPath, tagOf } from './ws1-session-p-pipeline';

const MEASURE = process.env.WS1_SESSION_AE_MEASURE === '1';
const TARGETS: Record<string, string[]> = {
  '173': ['lethal_nature_hazard', 'iron_bounce', 'wall_split_path', 'logic_clash', 'gadget_decay', 'vessel_damage_clue'],
  v6: ['008_unknown_void', '214_solitary_fire', '231_slowing_pace', '447_scout_facing_dark', '152_frozen_brush_mice'],
};

describe.skipIf(!MEASURE)('WS1 Session AE — context dump', () => {
  for (const key of ['v6', '173'] as const) {
    it(`dumps ${key}`, async () => {
      const run = await runProductionPath(CORPORA[key]!, false);
      const toks = run.usableFaTokens;
      const lines: string[] = [];
      for (const tag of TARGETS[key]!) {
        const i = run.committed.findIndex(s => tagOf(s) === tag);
        if (i < 1) { lines.push(`MISSING ${tag}`); continue; }
        const lA = run.keptAlignments[i - 1]!, rA = run.keptAlignments[i]!;
        lines.push(`\n===== ${key} ${tag} idx=${i} committed=${run.committed[i]!.startTime.toFixed(3)}`);
        lines.push(`  LEFT  ${tagOf(run.committed[i - 1]!)} tok[${lA.firstTokenIdx}..${lA.lastTokenIdx}] matched=${lA.matched} conf=${lA.confidence.toFixed(3)} mw=${lA.matchedWords}/${lA.totalWords}`);
        lines.push(`  RIGHT ${tag} tok[${rA.firstTokenIdx}..${rA.lastTokenIdx}] matched=${rA.matched} conf=${rA.confidence.toFixed(3)} mw=${rA.matchedWords}/${rA.totalWords}`);
        const lo = Math.max(0, lA.lastTokenIdx - 8), hi = Math.min(toks.length - 1, rA.firstTokenIdx + 8);
        for (let t = lo; t <= hi; t++) {
          const w = toks[t]! as { text: string; startSec: number; endSec: number; confidence?: number };
          const mark = t === lA.lastTokenIdx ? ' <-L.last' : t === rA.firstTokenIdx ? ' <-R.first' : '';
          lines.push(`    [${t}] '${w.text}' [${w.startSec.toFixed(3)},${w.endSec.toFixed(3)}] c=${(w.confidence ?? NaN).toExponential(2)}${mark}`);
        }
        const sils = run.silences.filter(s => s.endSec > (toks[lA.lastTokenIdx]?.startSec ?? 0) - 2 && s.startSec < (toks[rA.firstTokenIdx]?.endSec ?? 0) + 4);
        lines.push(`  silences: ${sils.map(s => `[${s.startSec.toFixed(2)},${s.endSec.toFixed(2)}]`).join(' ')}`);
      }
      console.log(lines.join('\n'));
      const { writeFileSync, mkdirSync } = await import('fs');
      mkdirSync('.work-phase4/session-ae', { recursive: true });
      writeFileSync(`.work-phase4/session-ae/step1-context-${key}.txt`, lines.join('\n'));
    }, 600_000);
  }
});
