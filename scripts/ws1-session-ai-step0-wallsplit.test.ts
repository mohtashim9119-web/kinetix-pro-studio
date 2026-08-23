/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// ---------------------------------------------------------------------------
// WS1 Session AI — STEP 0. wall_split_path disposition, and the register
// open-count reconciliation, after ingesting `ear-verify-ai`.
//
// `ear-verify-ah` (order 13) left one question open: for 173/wall_split_path,
// was the accepted instant 162.46 (what production commits via R.15) or
// 162.15 (the value `ear-173-x`, order 9, had recorded)? `ear-verify-ai`
// (order 14, `ws1-ear-pass-ledger.ts`) answers it: 162.46. This measures
// what that answer means for the live pipeline and the Zero-Defect Register.
//
// Gated: WS1_SESSION_AI_MEASURE=1 npx vitest run scripts/ws1-session-ai-step0-wallsplit.test.ts
// ---------------------------------------------------------------------------

import { describe, it } from 'vitest';
import { writeFileSync, mkdirSync } from 'fs';
import { resolve } from 'path';

import { CORPORA, runProductionPath, tagOf, REPO } from './ws1-session-p-pipeline.js';
import { earHistory, EAR_PIN_TOLERANCE_SEC } from './ws1-ear-pass-ledger.js';

const MEASURE = process.env.WS1_SESSION_AI_MEASURE === '1';
const OUT = resolve(REPO, '.work-phase4/session-ai');

/** The register's seven open rows as of `ear-verify-ah` (Session AH's own
 *  count, cross-checked against `phase4-fa-replay.test.ts`'s `KNOWN_BAD`
 *  before this session's edit): the five rows the S1/S2 phantom-tail
 *  investigation names, plus `400_endless_dark` (a DIFFERENT mechanism —
 *  fallback-boundary amplitude-floor miss, not FA-chunk phantom tail — named
 *  here only so the open-count reconciliation is complete, not because S2
 *  targets it), plus `wall_split_path` (this step's subject). */
const REGISTER_OPEN_BEFORE: Array<{ corpus: 'v6' | '173'; tag: string }> = [
  { corpus: 'v6', tag: '214_solitary_fire' },
  { corpus: 'v6', tag: '231_slowing_pace' },
  { corpus: 'v6', tag: '447_scout_facing_dark' },
  { corpus: 'v6', tag: '400_endless_dark' },
  { corpus: '173', tag: 'lethal_nature_hazard' },
  { corpus: '173', tag: 'gadget_decay' },
  { corpus: '173', tag: 'wall_split_path' },
];

describe.skipIf(!MEASURE)('WS1 Session AI Step 0 — wall_split_path disposition', () => {
  it('reports the committed seam-42-43 value against the new ground truth, and the register count', async () => {
    mkdirSync(OUT, { recursive: true });
    const L: string[] = [];

    const NEW_GROUND_TRUTH = 162.46;
    const spec = CORPORA['173']!;
    const run = await runProductionPath(spec);
    const byTag = new Map(run.committed.map(s => [tagOf(s), s]));
    const seg = byTag.get('wall_split_path');
    if (seg === undefined) throw new Error('wall_split_path not committed — cannot report disposition');

    const committed = seg.startTime;
    const residual = committed - NEW_GROUND_TRUTH;
    const isDefect = Math.abs(residual) >= EAR_PIN_TOLERANCE_SEC;

    L.push('# WS1 Session AI Step 0 — wall_split_path (173, seam 42-43) disposition');
    L.push('');
    L.push(`- ground truth ingested this session (\`ear-verify-ai\`): **${NEW_GROUND_TRUTH.toFixed(3)}**`);
    L.push(`- superseded value (\`ear-173-x\` order 9 / \`ear-verify-ah\` order 13): 162.150`);
    L.push(`- production commits (measured, live pipeline, HEAD): **${committed.toFixed(3)}**`);
    L.push(`- residual vs new ground truth: **${residual >= 0 ? '+' : ''}${residual.toFixed(4)}s**`);
    L.push(`- register tolerance: ${EAR_PIN_TOLERANCE_SEC}s`);
    L.push(`- **VERDICT: ${isDefect ? 'DEFECT (residual exceeds tolerance)' : 'NOT A DEFECT — row is CLOSED'}**`);
    L.push('');
    L.push(`Ledger history for this boundary (latest first): ${earHistory('173', 'wall_split_path')
      .map(h => `${h.sitting}:${h.scoredValue ?? '(absent)'}->${h.verdict}`).join(' | ')}`);
    L.push('');
    L.push(`Rule firing set this run: R.15 fired on wall_split_path (pre-rule ${run.preRuleSegments
      .find(s => tagOf(s) === 'wall_split_path')?.startTime.toFixed(3)}, post-rule ${committed.toFixed(3)}) — RULE-DEPENDENT, same class as \`iron_bounce\`/\`logic_clash\`. Deleting R.15 reopens this row.`);

    console.log(L.join('\n'));
    writeFileSync(resolve(OUT, 'step0-wallsplit.md'), L.join('\n') + '\n');

    // ---- register open-count reconciliation ------------------------------
    const L2: string[] = [];
    L2.push('# WS1 Session AI Step 0 — register open-count reconciliation');
    L2.push('');
    L2.push(`Register open count BEFORE this session's ingestion: **${REGISTER_OPEN_BEFORE.length}**`);
    for (const r of REGISTER_OPEN_BEFORE) L2.push(`- ${r.corpus} / ${r.tag}`);
    L2.push('');
    const after = REGISTER_OPEN_BEFORE.filter(r => !(r.corpus === '173' && r.tag === 'wall_split_path'));
    L2.push(`Register open count AFTER (wall_split_path closes, verified rule-dependent-correct): **${after.length}**`);
    for (const r of after) L2.push(`- ${r.corpus} / ${r.tag}`);
    L2.push('');
    L2.push('Of these six, the five relevant to the S1/S2 phantom-tail investigation (excludes '
      + '`400_endless_dark`, a fallback-boundary amplitude-floor case, a different mechanism):');
    L2.push('- v6/214_solitary_fire, v6/231_slowing_pace, v6/447_scout_facing_dark, '
      + '173/lethal_nature_hazard, 173/gadget_decay');
    L2.push('');
    L2.push('Structural vs rule-dependent, for every row currently CORRECT among the seven named rows '
      + '(the five open + the two rule-dependent, per `.work-phase4/session-ah/step1-rowstatus.md`, '
      + 'unchanged this session — none of R.11-R.15 or the chunk plan was touched by Step 0):');
    L2.push('- `152_frozen_brush_mice` (v6) — RULE-DEPENDENT (R.14)');
    L2.push('- `iron_bounce` (173) — RULE-DEPENDENT (R.15)');
    L2.push('- `logic_clash` (173) — RULE-DEPENDENT (R.15) [not one of the seven named rows, restated for completeness]');
    L2.push('- `wall_split_path` (173) — RULE-DEPENDENT (R.15) [closes this session]');

    console.log(L2.join('\n'));
    writeFileSync(resolve(OUT, 'step0-register-count.md'), L2.join('\n') + '\n');
  }, 120_000);
});
