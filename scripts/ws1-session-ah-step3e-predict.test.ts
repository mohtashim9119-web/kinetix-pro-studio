/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// ---------------------------------------------------------------------------
// WS1 Session AH — STEP 3e. PRE-REGISTERED PREDICTIONS against the open defects.
//
// Written and committed BEFORE any FA run against a simulated S2 plan, which is
// the point: Session AG's S1 was measured after the fact and its "10/13 CORRECT"
// read as success because nothing had been committed to in advance. Every row
// below states, ahead of time, whether the simulated S2 partition puts a chunk
// edge at that seam and whether the incoming segment's first word would still be
// a phantom.
//
// A phantom needs a chunk edge to exist. The mechanism (see
// `docs/history-2.md`'s Session AH entry) is: text filed into a window's silent
// tail. With NO edge at the seam, the seam sits in a chunk's interior, there is
// no silent tail to file into, and the phantom cannot form BY CONSTRUCTION —
// which is also why S2 cannot be credited with "fixing" such a row: it removes
// the failure mode without placing a better boundary, and what the boundary then
// becomes is an open empirical question this session does not answer.
//
// Gated: WS1_SESSION_AH_MEASURE=1 npx vitest run scripts/ws1-session-ah-step3e-predict.test.ts
// ---------------------------------------------------------------------------

import { describe, it } from 'vitest';
import { writeFileSync, readFileSync, mkdirSync } from 'fs';
import { resolve } from 'path';

import { CORPORA, REPO, loadLiveBundle, tagOf } from './ws1-session-p-pipeline.js';
import { parseProjectData } from '../src/App';
import { applyAnchorBasedTiming } from '../src/services/syncEngine';
import type { Corpus } from './ws1-ear-pass-ledger.js';

const MEASURE = process.env.WS1_SESSION_AH_MEASURE === '1';
const OUT = resolve(REPO, '.work-phase4/session-ah');

const TERMINATOR = /[.!?…]["'”’)\]]*\s*$/;
const TARGET_MIN_SEC = 15;
const TARGET_MAX_SEC = 60;

/** The seven rows the brief names: five still-open defects plus the two
 *  rule-dependent rows (which reopen if R.14/R.15 are deleted). */
const ROWS: Array<{ corpus: Corpus; tag: string; earValue: number; kind: string }> = [
  { corpus: 'v6', tag: '214_solitary_fire', earValue: 630.09, kind: 'OPEN' },
  { corpus: 'v6', tag: '231_slowing_pace', earValue: 682.74, kind: 'OPEN' },
  { corpus: 'v6', tag: '447_scout_facing_dark', earValue: 1418.53, kind: 'OPEN' },
  { corpus: '173', tag: 'lethal_nature_hazard', earValue: 19.27, kind: 'OPEN' },
  { corpus: '173', tag: 'gadget_decay', earValue: 427.60, kind: 'OPEN' },
  { corpus: 'v6', tag: '152_frozen_brush_mice', earValue: 451.03, kind: 'RULE-DEPENDENT (R.14)' },
  { corpus: '173', tag: 'iron_bounce', earValue: 76.59, kind: 'RULE-DEPENDENT (R.15)' },
];

describe.skipIf(!MEASURE)('WS1 Session AH Step 3e — pre-registered predictions', () => {
  it('states, per row, whether S2 places a chunk edge at that seam', async () => {
    mkdirSync(OUT, { recursive: true });
    const L: string[] = [];
    L.push('# WS1 Session AH Step 3e — PRE-REGISTERED PREDICTIONS');
    L.push('');
    L.push('Committed BEFORE any FA run against a simulated S2 plan.');
    L.push('');
    L.push('| corpus | seam | ear value | S2 chunk edge at this seam? | incoming first word still a phantom? |');
    L.push('|---|---|---|---|---|');
    const detail: string[] = [];
    const json: Array<Record<string, unknown>> = [];

    for (const key of ['v6', '173'] as const) {
      const spec = CORPORA[key]!;
      const { silences } = loadLiveBundle(key);
      const segsRaw = await parseProjectData(
        readFileSync(spec.scriptPath, 'utf-8'), readFileSync(spec.sceneDetailsPath, 'utf-8'), [], spec.audioDuration,
      );
      const segs = applyAnchorBasedTiming(segsRaw, spec.audioDuration);

      // Rebuild the same partition Step 3c produced.
      const groups: number[][] = [];
      let cur: number[] = [];
      for (let i = 0; i < segs.length; i++) {
        cur.push(i);
        if (TERMINATOR.test((segs[i]!.text ?? '').trim()) || i === segs.length - 1) { groups.push(cur); cur = []; }
      }
      const dur = (g: number[]): number => {
        const f = segs[g[0]!]!, l = segs[g[g.length - 1]!]!;
        return (l.startTime + l.duration) - f.startTime;
      };
      const chunks: number[][][] = [];
      let acc = 0; let cc: number[][] = [];
      for (const g of groups) {
        if (cc.length > 0 && acc + dur(g) > TARGET_MAX_SEC && acc >= TARGET_MIN_SEC) { chunks.push(cc); cc = []; acc = 0; }
        cc.push(g); acc += dur(g);
      }
      if (cc.length > 0) chunks.push(cc);

      // Segment index at which each chunk STARTS — these are the only edges.
      const edgeSegIdx = new Set(chunks.slice(1).map(c => c[0]![0]!));
      // And the group boundaries (legal seams) for context.
      const legalSeam = new Set(groups.slice(1).map(g => g[0]!));

      for (const r of ROWS.filter(x => x.corpus === key)) {
        const idx = segs.findIndex(s => tagOf(s) === r.tag);
        if (idx < 0) { L.push(`| ${key} | \`${r.tag}\` | ${r.earValue} | **SEGMENT NOT FOUND** | — |`); continue; }
        const hasEdge = edgeSegIdx.has(idx);
        const isLegal = legalSeam.has(idx);
        const prevText = (segs[idx - 1]?.text ?? '').trim();
        const phantom = hasEdge ? 'POSSIBLE (edge exists)' : 'NO — no edge, so no silent tail to file into';
        L.push(`| ${key} | \`${r.tag}\` (seam ${idx - 1}-${idx}) | ${r.earValue.toFixed(2)} | `
          + `**${hasEdge ? 'YES' : 'NO'}** | ${phantom} |`);
        detail.push(`### ${key} / \`${r.tag}\` — ${r.kind}`);
        detail.push('');
        detail.push(`- segment index ${idx}; seam ${idx - 1}-${idx}; ear target ${r.earValue.toFixed(3)}`);
        detail.push(`- previous segment ends a sentence: **${TERMINATOR.test(prevText)}** `
          + `(${JSON.stringify(prevText.slice(-60))})`);
        detail.push(`- this seam is a LEGAL S2 seam (group boundary): **${isLegal}**`);
        detail.push(`- S2 places a CHUNK EDGE here: **${hasEdge}**`);
        detail.push(`- **PREDICTION:** ${hasEdge
          ? 'an edge exists, so the phantom mechanism remains available at this seam; S2 changes only WHICH text sits either side.'
          : 'no edge, so the seam sits in a chunk interior. The phantom cannot form here by construction. This is NOT the same as S2 placing this boundary correctly — it removes the failure mode without supplying a better landmark, and where FA then puts the boundary is not predicted by this session.'}`);
        detail.push('');
        json.push({ corpus: key, tag: r.tag, kind: r.kind, segIdx: idx, hasEdge, isLegalSeam: isLegal, earValue: r.earValue });
      }
      void silences;
    }

    L.push('');
    L.push('## Per-row detail');
    L.push('');
    L.push(...detail);
    L.push('## `gadget_decay` — explicitly confirmed NOT REACHED');
    L.push('');
    L.push('The brief requires this stated outright. `gadget_decay` (173, seam 106-107) is the one');
    L.push('register row that neither chunking nor silence touches:');
    L.push('');
    L.push('- **No chunk edge.** Today both segments sit inside one chunk `[417.30, 433.52]`; under S2');
    L.push('  the simulated partition likewise places no edge at this seam (measured above).');
    L.push('- **No silence.** `docs/history-2.md`\'s Session AH entry records no detected silence within');
    L.push('  seconds of the true seam.');
    L.push('- **Its ear target lies outside its own word gap.** 427.60 sits 0.06s PAST the incoming');
    L.push('  segment\'s own first word onset (427.54), so no right-edge-minus-pre-roll placement can');
    L.push('  reach it either — independently recorded by WS1 Sessions Y and Z.');
    L.push('');
    L.push('**S2 does not address it, and NO RULE IS ADDED TO COVER IT THIS SESSION.** It stays open,');
    L.push('and it is the strongest single piece of evidence that the phantom mechanism is not the only');
    L.push('defect cause — a perfect chunk plan leaves this row exactly where it is.');

    writeFileSync(resolve(OUT, 'step3e-predictions.md'), L.join('\n'));
    writeFileSync(resolve(OUT, 'step3e-predictions.json'), JSON.stringify(json, null, 2));
    console.log(L.slice(0, 20).join('\n'));
  }, 900_000);
});
