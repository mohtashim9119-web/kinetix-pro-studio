/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// ---------------------------------------------------------------------------
// WS1 Session AH — STEP 1. STRUCTURAL vs RULE-DEPENDENT, for every row the
// operator's Session AH verdicts touch.
//
// THE QUESTION THIS ANSWERS. A register row marked "fixed" can be fixed two
// very different ways:
//   * STRUCTURAL — `snapCoveredBoundaries` already lands on the ear-verified
//     value before any rule runs. Deleting every patch rule leaves it correct.
//   * RULE-DEPENDENT — the pre-rule value is wrong and a patch rule (R.11-R.15)
//     moves it onto the ear value. Deleting that rule REOPENS the row.
// The register does not record the distinction, so "closed" has been carrying
// two meanings. Session AH's brief requires them separated, because the
// standing plan is eventually to delete R.14/R.15 once an upstream fix lands,
// and every rule-dependent row is a row that comes back when that happens.
//
// READ-ONLY. Drives `runProductionPath` (the one live-fidelity pipeline) and
// diffs `preRuleSegments` against `committed`. Writes only into
// `.work-phase4/session-ah/`.
//
// Gated:
//   WS1_SESSION_AH_MEASURE=1 npx vitest run scripts/ws1-session-ah-step1-rowstatus.test.ts
// ---------------------------------------------------------------------------

import { describe, it } from 'vitest';
import { writeFileSync, mkdirSync } from 'fs';
import { resolve } from 'path';

import { CORPORA, runProductionPath, tagOf, REPO } from './ws1-session-p-pipeline.js';
import { earHistory } from './ws1-ear-pass-ledger.js';
import type { Corpus } from './ws1-ear-pass-ledger.js';

const MEASURE = process.env.WS1_SESSION_AH_MEASURE === '1';
const OUT = resolve(REPO, '.work-phase4/session-ah');

/** The rows the operator's Session AH verdicts name, plus the two the brief
 *  singles out for the structural/rule-dependent question. `earValue` is the
 *  operator's stated ground truth. */
const ROWS: Array<{ corpus: Corpus; tag: string; earValue: number; briefStatus: 'fixed' | 'open' }> = [
  { corpus: 'v6',  tag: '152_frozen_brush_mice',  earValue: 451.03,  briefStatus: 'fixed' },
  { corpus: '173', tag: 'iron_bounce',             earValue: 76.59,   briefStatus: 'fixed' },
  { corpus: '173', tag: 'wall_split_path',         earValue: 162.15,  briefStatus: 'fixed' },
  { corpus: '173', tag: 'logic_clash',             earValue: 418.14,  briefStatus: 'fixed' },
  { corpus: 'v6',  tag: '214_solitary_fire',       earValue: 630.09,  briefStatus: 'open' },
  { corpus: 'v6',  tag: '231_slowing_pace',        earValue: 682.74,  briefStatus: 'open' },
  { corpus: 'v6',  tag: '447_scout_facing_dark',   earValue: 1418.53, briefStatus: 'open' },
  { corpus: '173', tag: 'lethal_nature_hazard',    earValue: 19.27,   briefStatus: 'open' },
  { corpus: '173', tag: 'gadget_decay',            earValue: 427.60,  briefStatus: 'open' },
  // The one remaining register-open row the brief does not name, measured so
  // the open-count reconciliation is complete rather than assumed.
  { corpus: 'v6',  tag: '400_endless_dark',        earValue: 1266.66, briefStatus: 'open' },
];

/** The register's own tolerance. */
const TOL = 0.005;

describe.skipIf(!MEASURE)('WS1 Session AH Step 1 — structural vs rule-dependent', () => {
  it('reports pre-rule, post-rule and owning rule for every named row', async () => {
    mkdirSync(OUT, { recursive: true });
    const L: string[] = [];
    const json: Record<string, unknown> = {};

    L.push('# WS1 Session AH Step 1 — structural vs rule-dependent');
    L.push('');
    L.push('`pre` = `snapCoveredBoundaries` + head-extend, BEFORE any of R.11-R.15.');
    L.push('`post` = what production commits today. `movedBy` = the rule(s) whose');
    L.push('finding names this segment. Tolerance for "== ear" is the register\'s 0.005s.');
    L.push('');

    const rows: Array<Record<string, unknown>> = [];

    for (const key of ['v6', '173'] as const) {
      const spec = CORPORA[key]!;
      const run = await runProductionPath(spec);
      const pre = new Map(run.preRuleSegments.map(s => [s.id, s.startTime]));
      const byTag = new Map(run.committed.map(s => [tagOf(s), s]));

      // Which rule names which segment id.
      const ruleOf = new Map<string, string[]>();
      const add = (id: string, rule: string): void => {
        const cur = ruleOf.get(id) ?? [];
        if (!cur.includes(rule)) cur.push(rule);
        ruleOf.set(id, cur);
      };
      for (const f of run.r11Kept) add(f.segmentId, 'R.11');
      for (const f of run.r12) add(f.segmentId, 'R.12');
      for (const f of run.r13Kept) add(f.segmentId, 'R.13');
      for (const f of run.anchorTrust) add(f.segmentId, f.rule);

      for (const r of ROWS.filter(x => x.corpus === key)) {
        const seg = byTag.get(r.tag);
        if (seg === undefined) {
          L.push(`- **${key} / ${r.tag}** — NOT COMMITTED (segment absent from the committed array).`);
          rows.push({ corpus: key, tag: r.tag, present: false });
          continue;
        }
        const preV = pre.get(seg.id);
        const postV = seg.startTime;
        const rules = ruleOf.get(seg.id) ?? [];
        const preMatches = preV !== undefined && Math.abs(preV - r.earValue) < TOL;
        const postMatches = Math.abs(postV - r.earValue) < TOL;
        const verdict = postMatches
          ? (preMatches ? 'STRUCTURAL' : `RULE-DEPENDENT (${rules.join('+') || 'unattributed'})`)
          : 'NOT ON EAR VALUE';
        const ledger = earHistory(r.corpus, r.tag)
          .map(h => `${h.sitting}:${h.scoredValue ?? 'absent'}->${h.verdict}`).join(' | ');
        rows.push({
          corpus: key, tag: r.tag, present: true, earValue: r.earValue,
          pre: preV, post: postV, movedBy: rules, preMatches, postMatches, verdict,
          briefStatus: r.briefStatus, residual: +(postV - r.earValue).toFixed(4), ledger,
        });
        L.push(`- **${key} / ${r.tag}** — ear ${r.earValue.toFixed(3)} | pre ${preV?.toFixed(3)} | `
          + `post ${postV.toFixed(3)} | movedBy ${rules.join('+') || '(none)'} | residual `
          + `${(postV - r.earValue >= 0 ? '+' : '')}${(postV - r.earValue).toFixed(3)} | **${verdict}**`);
        L.push(`  - ledger: ${ledger || '(no ear row)'}`);
      }
      L.push('');
      L.push(`### ${key} — rule firing counts this run`);
      L.push('```');
      L.push(JSON.stringify(run.fired));
      L.push('```');
      L.push('');
      json[`${key}_fired`] = run.fired;
      json[`${key}_committedCount`] = run.committed.length;
      json[`${key}_chunkCount`] = run.chunks.length;
    }

    json.rows = rows;
    writeFileSync(resolve(OUT, 'step1-rowstatus.json'), JSON.stringify(json, null, 2));
    writeFileSync(resolve(OUT, 'step1-rowstatus.md'), L.join('\n'));
    console.log(L.join('\n'));
  }, 600_000);
});
