/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// ---------------------------------------------------------------------------
// WS1 Session AI — STEP 1e. PRE-REGISTERED PREDICTIONS at the 10-30s band.
//
// AH's Step 3e predictions were computed at 15-60s and are VOID at this
// session's 10-30s band (a different partition can place a different set of
// chunk edges). Re-registered here, BEFORE any FA run against a simulated or
// real S2 plan — same discipline as AH: predict, then measure, never the
// other way round.
//
// Gated: WS1_SESSION_AI_MEASURE=1 npx vitest run scripts/ws1-session-ai-step1-predict.test.ts
// ---------------------------------------------------------------------------

import { describe, it } from 'vitest';
import { writeFileSync, readFileSync, mkdirSync } from 'fs';
import { resolve } from 'path';

import { CORPORA, REPO, loadLiveBundle, tagOf } from './ws1-session-p-pipeline.js';
import { parseProjectData } from '../src/App';
import { applyAnchorBasedTiming } from '../src/services/syncEngine';
import type { Corpus } from './ws1-ear-pass-ledger.js';

const MEASURE = process.env.WS1_SESSION_AI_MEASURE === '1';
const OUT = resolve(REPO, '.work-phase4/session-ai');

const TERMINATOR = /[.!?…]["'”’)\]]*\s*$/;
const TARGET_MIN_SEC = 10;
const TARGET_MAX_SEC = 30;

/** The seven rows the AH brief named: five still-open defects plus the two
 *  rule-dependent rows (which reopen if R.14/R.15 are deleted). Unchanged
 *  this session — Step 0 closed `wall_split_path`, which was never one of
 *  these seven (it was a register-open row of the SAME mechanism class but
 *  outside the seven AH's own prediction table scoped to; see
 *  `step0-register-count.md`). */
const ROWS: Array<{ corpus: Corpus; tag: string; earValue: number; kind: string }> = [
  { corpus: 'v6', tag: '214_solitary_fire', earValue: 630.09, kind: 'OPEN' },
  { corpus: 'v6', tag: '231_slowing_pace', earValue: 682.74, kind: 'OPEN' },
  { corpus: 'v6', tag: '447_scout_facing_dark', earValue: 1418.53, kind: 'OPEN' },
  { corpus: '173', tag: 'lethal_nature_hazard', earValue: 19.27, kind: 'OPEN' },
  { corpus: '173', tag: 'gadget_decay', earValue: 427.60, kind: 'OPEN' },
  { corpus: 'v6', tag: '152_frozen_brush_mice', earValue: 451.03, kind: 'RULE-DEPENDENT (R.14)' },
  { corpus: '173', tag: 'iron_bounce', earValue: 76.59, kind: 'RULE-DEPENDENT (R.15)' },
];

describe.skipIf(!MEASURE)('WS1 Session AI Step 1e — pre-registered predictions at 10-30s', () => {
  it('states, per row, whether S2@10-30s places a chunk edge at that seam', async () => {
    mkdirSync(OUT, { recursive: true });
    const L: string[] = [];
    L.push('# WS1 Session AI Step 1e — PRE-REGISTERED PREDICTIONS at 10-30s');
    L.push('');
    L.push('Committed BEFORE any FA run against the S2@10-30s plan. Supersedes AH\'s 15-60s predictions');
    L.push('for these same seven rows — a narrower band packs different chunk edges.');
    L.push('');
    L.push('| corpus | seam | ear value | S2@10-30s chunk edge at this seam? | incoming first word still a phantom? |');
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

      const edgeSegIdx = new Set(chunks.slice(1).map(c => c[0]![0]!));
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
        detail.push(`- S2@10-30s places a CHUNK EDGE here: **${hasEdge}**`);
        detail.push(`- **PREDICTION:** ${hasEdge
          ? 'an edge exists, so the phantom mechanism remains available at this seam; S2 changes only WHICH text sits either side.'
          : 'no edge, so the seam sits in a chunk interior. The phantom cannot form here by construction. This is NOT the same as S2 placing this boundary correctly.'}`);
        detail.push('');
        json.push({ corpus: key, tag: r.tag, kind: r.kind, segIdx: idx, hasEdge, isLegalSeam: isLegal, earValue: r.earValue });
      }
      void silences;
    }

    L.push('');
    L.push('## Per-row detail');
    L.push('');
    L.push(...detail);
    L.push('## `gadget_decay` — re-confirmed NOT REACHED at 10-30s');
    L.push('');
    L.push('Same structural facts as AH\'s 15-60s measurement, unaffected by the target band: no detected');
    L.push('silence within seconds of the true seam, and the ear target 427.60 sits 0.06s PAST the incoming');
    L.push('segment\'s own first word onset (427.54), outside its own word gap. **NO RULE ADDED THIS SESSION.**');

    writeFileSync(resolve(OUT, 'step1e-predictions.md'), L.join('\n'));
    writeFileSync(resolve(OUT, 'step1e-predictions.json'), JSON.stringify(json, null, 2));
    console.log(L.slice(0, 20).join('\n'));
  }, 900_000);
});
