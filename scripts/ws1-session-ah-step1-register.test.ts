/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// ---------------------------------------------------------------------------
// WS1 Session AH — STEP 1 (second half). The ledger's own arithmetic, computed
// rather than asserted: how many ear-verified controls exist after ingesting
// `ear-verify-ah`, how many known-bad moves the validation set holds, and
// whether the two sets OVERLAP (a boundary that is both a control and a
// known-bad move would make Step 4's separation trivially unmeasurable).
//
// Gated: WS1_SESSION_AH_MEASURE=1 npx vitest run scripts/ws1-session-ah-step1-register.test.ts
// ---------------------------------------------------------------------------

import { describe, it, expect } from 'vitest';
import { writeFileSync, mkdirSync } from 'fs';
import { resolve } from 'path';

import {
  EAR_PASS_LEDGER, S1_KNOWN_BAD_MOVES, earVerifiedControls, earHistory,
} from './ws1-ear-pass-ledger.js';
import { REPO } from './ws1-session-p-pipeline.js';

const MEASURE = process.env.WS1_SESSION_AH_MEASURE === '1';
const OUT = resolve(REPO, '.work-phase4/session-ah');

describe.skipIf(!MEASURE)('WS1 Session AH Step 1 — ledger arithmetic', () => {
  it('counts controls and known-bad moves, and checks for overlap', () => {
    mkdirSync(OUT, { recursive: true });
    const controls = earVerifiedControls();
    const L: string[] = [];

    L.push('# WS1 Session AH Step 1 — ledger arithmetic (MEASURED)');
    L.push('');
    L.push(`- total ledger rows: **${EAR_PASS_LEDGER.length}**`);
    L.push(`- distinct boundaries with any ear row: **${new Set(EAR_PASS_LEDGER.map(r => `${r.corpus} ${r.tag}`)).size}**`);
    L.push(`- **ear-verified controls (latest sitting = CORRECT): ${controls.length}**`);
    for (const c of ['v6', '173', 'spanish'] as const) {
      L.push(`  - ${c}: ${controls.filter(x => x.corpus === c).length}`);
    }
    L.push(`- rows added by \`ear-verify-ah\`: **${EAR_PASS_LEDGER.filter(r => r.sitting === 'ear-verify-ah').length}**`);
    L.push(`- **known-bad S1 moves: ${S1_KNOWN_BAD_MOVES.length}** `
      + `(${S1_KNOWN_BAD_MOVES.filter(m => m.provenance === 'ah-sitting').length} ah-sitting, `
      + `${S1_KNOWN_BAD_MOVES.filter(m => m.provenance === 'ledger-inherited').length} ledger-inherited)`);
    L.push('');

    // Every known-bad move's CORRECT value must itself be ledger-authorised —
    // otherwise the negative set rests on nothing.
    L.push('## Every known-bad move\'s correct value, checked against the ledger');
    L.push('');
    L.push('| corpus | tag | correct | S1 proposed | delta | latest ledger verdict at correct value |');
    L.push('|---|---|---|---|---|---|');
    const unbacked: string[] = [];
    for (const m of S1_KNOWN_BAD_MOVES) {
      const h = earHistory(m.corpus, m.tag).filter(
        r => r.scoredValue !== null && Math.abs(r.scoredValue - m.correctValue) < 0.005);
      const v = h[0] ? `${h[0].sitting}: ${h[0].verdict}` : '**NONE**';
      if (!h[0] || h[0].verdict !== 'CORRECT') unbacked.push(`${m.corpus}/${m.tag}`);
      L.push(`| ${m.corpus} | \`${m.tag}\` | ${m.correctValue.toFixed(3)} | ${m.proposedValue.toFixed(3)} `
        + `| +${m.deltaSec.toFixed(3)} | ${v} |`);
    }
    L.push('');
    L.push(unbacked.length === 0
      ? '**All known-bad moves rest on a ledger-authorised correct value.**'
      : `**UNBACKED: ${unbacked.join(', ')}**`);

    // Overlap: a known-bad move's PROPOSED value must never be ledger-CORRECT.
    const conflicts = S1_KNOWN_BAD_MOVES.filter(m => {
      const h = earHistory(m.corpus, m.tag).filter(
        r => r.scoredValue !== null && Math.abs(r.scoredValue - m.proposedValue) < 0.005);
      return h[0]?.verdict === 'CORRECT';
    });
    L.push('');
    L.push(`## Overlap check: known-bad PROPOSED values that the ledger calls CORRECT`);
    L.push('');
    L.push(conflicts.length === 0
      ? '**None. The positive and negative sets are disjoint — Step 4\'s separation is measurable.**'
      : `**${conflicts.length} CONFLICT(S): ${conflicts.map(c => `${c.corpus}/${c.tag}`).join(', ')}**`);

    L.push('');
    L.push('## The 43-control figure');
    L.push('');
    L.push('Session AG reported 43 ear-verified controls. That figure counted the boundaries a rule');
    L.push('could be scored against at the time. The number computed here is every boundary whose');
    L.push('LATEST sitting says CORRECT, which is the set Step 4 must not flag.');

    writeFileSync(resolve(OUT, 'step1-ledger.md'), L.join('\n'));
    writeFileSync(resolve(OUT, 'step1-ledger.json'), JSON.stringify({
      totalRows: EAR_PASS_LEDGER.length, controls, knownBad: S1_KNOWN_BAD_MOVES,
      unbacked, conflicts: conflicts.map(c => `${c.corpus}/${c.tag}`),
    }, null, 2));
    console.log(L.join('\n'));

    expect(unbacked).toEqual([]);
    expect(conflicts).toEqual([]);
  });
});
