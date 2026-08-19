/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// RULING R-AO (WS1 Session K) — THE BOTH-SIDES RULE, MADE MACHINE-CHECKABLE.
//
// WHY THIS FILE EXISTS. Three times a rule fixed one side of a thing and left
// the other unexamined, and each time the gap survived a full session because
// nothing forced anyone to look:
//
//   1. R.5 constrained which audio is EXCISED but not where the committed
//      boundary lands relative to it — closed by R.12, one session later.
//   2. R.12 constrained a run-carrying scene's OPENING edge but not its
//      CLOSING edge — closed by R.13, two sessions later, after an ear pass
//      found it.
//   3. The 173 index convention was corrected in a DOCUMENTATION table
//      (`stage1-live-run-prep.md` §5.3) while the identical off-by-N sat
//      untouched in `syncLog.ts`, where users could actually see it.
//
// The ruling: EVERY rule must STATE both sides of whatever it constrains, and
// a fix applied to documentation must be checked in code. This file enforces
// the first half by source inspection; `syncLog.indexConvention.test.ts`
// enforces the second half for the case that produced it.
//
// This is a DECLARATION check, not a proof of correctness. It cannot know
// whether a rule's second side is right — it can only make it impossible to
// ship a rule that never says what its second side is, or that never says why
// it has only one. That is exactly the failure mode above: in all three cases
// the missing side was never written down anywhere.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';

const HERE = dirname(fileURLToPath(import.meta.url));
const read = (rel: string): string => readFileSync(resolve(HERE, rel), 'utf-8');

/** Every shipped post-inference sync rule, and where its declaration lives. */
const RULES: Array<{ rule: string; module: string; testFile: string }> = [
  { rule: 'R.5', module: 'faChunkPlan.ts', testFile: 'faChunkPlan.test.ts' },
  { rule: 'R.10', module: 'faUnspokenGate.ts', testFile: 'faUnspokenGate.test.ts' },
  { rule: 'R.11', module: 'faSeamFitGate.ts', testFile: 'faSeamFitGate.test.ts' },
  { rule: 'R.12', module: 'faRunPlacementGate.ts', testFile: 'faRunPlacementGate.test.ts' },
  { rule: 'R.13', module: 'faRunPlacementGate.ts', testFile: 'faRunPlacementGate.test.ts' },
  // WS1 Session S. R-AP is not a rule that moves a boundary — it is the
  // invariant that decides which rule MAY. R-AO applies to it for the same
  // reason and more sharply: an arbitrator that only policed the direction
  // somebody had already been bitten by would leave the mirror open, which is
  // precisely the failure mode R-AO names.
  { rule: 'R-AP', module: 'faRuleStageExclusion.ts', testFile: 'faRuleStageExclusion.test.ts' },
];

describe('R-AO — every rule declares both sides of what it constrains', () => {
  for (const { rule, module } of RULES) {
    it(`${rule} (${module}) carries a BOTH SIDES declaration with real content`, () => {
      const src = read(`./${module}`);
      const at = src.indexOf('BOTH SIDES');
      expect(
        at,
        `${module} has no "BOTH SIDES" declaration. Ruling R-AO: a rule must state both ` +
          `sides of what it constrains, or state "SINGLE-SIDED, BECAUSE:" and why. ` +
          `Add it to the rule's header comment — do not delete this assertion.`,
      ).toBeGreaterThan(-1);

      // The declaration must actually say something: at least three further
      // comment lines, so "BOTH SIDES: yes" cannot satisfy it.
      const body = src.slice(at).split('\n').slice(1, 12).filter(l => l.trim().startsWith('//') && l.trim().length > 4);
      expect(body.length, `${module}: the BOTH SIDES declaration has no content`).toBeGreaterThanOrEqual(3);
    });
  }

  it('a single-sided rule must say WHY it is single-sided, not merely that it is', () => {
    const src = read('./faUnspokenGate.ts');
    expect(src).toContain('SINGLE-SIDED, BECAUSE');
    // The reason must name what the other side would have been and who owns it.
    expect(src).toContain('snapCoveredBoundaries');
  });

  it('R.12 and R.13 name each other as the two halves of one invariant', () => {
    const src = read('./faRunPlacementGate.ts');
    expect(src).toContain('OPENING (R.12)');
    expect(src).toContain('CLOSING (R.13)');
    // Both halves must live in the same module — keeping them apart is how the
    // closing edge went unexamined for two sessions.
    expect(src).toContain('export function detectRunPlacementDefects');
    expect(src).toContain('export function detectUtterancePlacementDefects');
  });

  it('the run invariant has a standing BOTH-EDGES corpus assertion, not just unit tests', () => {
    const t = read('./faRunPlacementGate.test.ts');
    expect(
      t,
      'the both-edges corpus assertion was removed — R-AO requires the pair to be ' +
        'checked together on real data, not only in synthetic isolation',
    ).toContain('the run invariant holds on BOTH edges of every run');
  });
});
