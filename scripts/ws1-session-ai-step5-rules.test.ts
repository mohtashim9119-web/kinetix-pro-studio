/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// ---------------------------------------------------------------------------
// WS1 Session AI — STEP 5. PATCH-RULE INTERACTION under S2.
//
// R.14/R.15 firing identity under the S2 arm, per corpus; whether
// `152_frozen_brush_mice` (R.14), `iron_bounce` and `logic_clash` (R.15)
// become STRUCTURALLY correct under S2 (pre-rule value already matches ear,
// rule does not need to fire) or remain RULE-DEPENDENT (pre-rule is wrong,
// the rule still corrects it); and a DOUBLE-CORRECTION check — any boundary
// where S2's own chunk-plan change already moved the pre-rule value, and a
// rule (R.11-R.15) ALSO fires on that same segment afterward.
//
// Does NOT delete R.14/R.15 — see this session's own report for why golden
// coverage for the rule stage remains the blocking prerequisite, and why
// 173's `logic_clash`/`iron_bounce` (21-22, per the register) reopen the
// moment R.15 is removed.
//
// Gated: WS1_SESSION_AI_MEASURE=1 npx vitest run scripts/ws1-session-ai-step5-rules.test.ts
// ---------------------------------------------------------------------------

import { describe, it } from 'vitest';
import { writeFileSync, mkdirSync } from 'fs';
import { resolve } from 'path';

import { CORPORA, runProductionPath, tagOf, REPO } from './ws1-session-p-pipeline.js';
import { EAR_PIN_TOLERANCE_SEC } from './ws1-ear-pass-ledger.js';

const MEASURE = process.env.WS1_SESSION_AI_MEASURE === '1';
const OUT = resolve(REPO, '.work-phase4/session-ai');
const TOL = EAR_PIN_TOLERANCE_SEC;

const RULE_DEPENDENT_ROWS: Array<{ corpus: 'v6' | '173'; tag: string; ear: number; rule: string }> = [
  { corpus: 'v6', tag: '152_frozen_brush_mice', ear: 451.03, rule: 'R.14' },
  { corpus: '173', tag: 'iron_bounce', ear: 76.59, rule: 'R.15' },
  { corpus: '173', tag: 'logic_clash', ear: 418.14, rule: 'R.15' },
];

describe.skipIf(!MEASURE)('WS1 Session AI Step 5 — patch-rule interaction under S2', () => {
  it('reports R.14/R.15 firing identity, structural-vs-rule-dependent, and double-correction', async () => {
    mkdirSync(OUT, { recursive: true });
    const L: string[] = [];
    const json: Record<string, unknown> = {};

    L.push('# WS1 Session AI Step 5 — patch-rule interaction under S2 (MEASURED)');
    L.push('');
    L.push('R.14/R.15 are NOT deleted this session. Golden replay never reaches the rule stage');
    L.push('(`CLAUDE.md` §4 Testing) so no fixture protects a deletion; 173\'s `iron_bounce`/`logic_clash`');
    L.push('(register rows 21-22/104-105) reopen the instant R.15 is removed.');
    L.push('');

    for (const key of ['v6', '173', 'spanish'] as const) {
      const spec = CORPORA[key]!;
      const base = await runProductionPath(spec);
      const s2 = await runProductionPath(spec, true, undefined, 'fa_ai_words.json');

      L.push(`## ${key}`);
      L.push('');
      L.push(`- base: R.11=${base.fired['R.11']} R.12=${base.fired['R.12']} R.13=${base.fired['R.13']} R.14=${base.fired['R.14']} R.15=${base.fired['R.15']}`);
      L.push(`- S2:   R.11=${s2.fired['R.11']} R.12=${s2.fired['R.12']} R.13=${s2.fired['R.13']} R.14=${s2.fired['R.14']} R.15=${s2.fired['R.15']}`);
      L.push('');

      const s2R14R15 = s2.anchorTrust.filter(f => f.rule === 'R.14' || f.rule === 'R.15');
      L.push(`### R.14/R.15 firing identity under S2 (${s2R14R15.length} firing(s))`);
      L.push('');
      if (s2R14R15.length === 0) {
        L.push('(none fired)');
      } else {
        L.push('| rule | segmentId | tag |');
        L.push('|---|---|---|');
        const byId = new Map(s2.committed.map(seg => [seg.id, tagOf(seg)]));
        for (const f of s2R14R15) {
          L.push(`| ${f.rule} | ${f.segmentId} | \`${byId.get(f.segmentId) ?? '?'}\` |`);
        }
      }
      L.push('');

      json[key] = {
        baseFired: base.fired, s2Fired: s2.fired,
        s2R14R15Firings: s2R14R15.map(f => ({ rule: f.rule, segmentId: f.segmentId, tag: (() => {
          const seg = s2.committed.find(x => x.id === f.segmentId);
          return seg ? tagOf(seg) : undefined;
        })() })),
      };
    }

    // ---- structural vs rule-dependent under S2, for the three named rows --
    L.push('## structural vs rule-dependent under S2');
    L.push('');
    L.push('| corpus | tag | rule | ear | S2 pre-rule | S2 post-rule | verdict |');
    L.push('|---|---|---|---|---|---|---|');
    const structuralRows: Array<Record<string, unknown>> = [];
    for (const r of RULE_DEPENDENT_ROWS) {
      const spec = CORPORA[r.corpus]!;
      const s2 = await runProductionPath(spec, true, undefined, 'fa_ai_words.json');
      const post = s2.committed.find(s => tagOf(s) === r.tag);
      if (post === undefined) {
        L.push(`| ${r.corpus} | \`${r.tag}\` | ${r.rule} | ${r.ear.toFixed(3)} | — | ABSENT | **NOT COMMITTED** |`);
        continue;
      }
      const pre = s2.preRuleSegments.find(s => s.id === post.id);
      const preV = pre?.startTime;
      const postV = post.startTime;
      const preMatches = preV !== undefined && Math.abs(preV - r.ear) < TOL;
      const postMatches = Math.abs(postV - r.ear) < TOL;
      const verdict = postMatches
        ? (preMatches ? 'STRUCTURALLY CORRECT under S2 (rule not needed)' : `RULE-DEPENDENT (${r.rule} still fires and still needed)`)
        : 'NOT ON EAR VALUE under S2';
      L.push(`| ${r.corpus} | \`${r.tag}\` | ${r.rule} | ${r.ear.toFixed(3)} | ${preV?.toFixed(3) ?? '—'} | ${postV.toFixed(3)} | **${verdict}** |`);
      structuralRows.push({ corpus: r.corpus, tag: r.tag, rule: r.rule, ear: r.ear, pre: preV, post: postV, verdict });
    }
    L.push('');

    // ---- double-correction check ------------------------------------------
    L.push('## double-correction check');
    L.push('');
    L.push('A boundary where S2\'s OWN chunk-plan change already moved the pre-rule value away from');
    L.push('base\'s pre-rule value, AND a rule (R.11-R.15) still fires on that same segment afterward.');
    L.push('');
    const doubleCorrections: Array<Record<string, unknown>> = [];
    for (const key of ['v6', '173', 'spanish'] as const) {
      const spec = CORPORA[key]!;
      const base = await runProductionPath(spec);
      const s2 = await runProductionPath(spec, true, undefined, 'fa_ai_words.json');
      const basePreByTag = new Map(base.preRuleSegments.map(s => [tagOf(s), s.startTime]));
      const s2FiredIds = new Set([
        ...s2.r11Kept.map(f => f.segmentId), ...s2.r12.map(f => f.segmentId), ...s2.r13Kept.map(f => f.segmentId),
        ...s2.anchorTrust.map(f => f.segmentId),
      ]);
      for (const seg of s2.preRuleSegments) {
        const tag = tagOf(seg);
        const basePreV = basePreByTag.get(tag);
        if (basePreV === undefined || Math.abs(seg.startTime - basePreV) < TOL) continue; // S2 didn't move the pre-rule value
        if (!s2FiredIds.has(seg.id)) continue; // no rule fired here
        doubleCorrections.push({
          corpus: key, tag, basePre: basePreV, s2Pre: seg.startTime,
          s2Post: s2.committed.find(c => c.id === seg.id)?.startTime,
        });
      }
    }
    L.push(`**${doubleCorrections.length} double-correction case(s) found.**`);
    if (doubleCorrections.length > 0) {
      L.push('');
      L.push('| corpus | tag | base pre-rule | S2 pre-rule (moved by S2) | S2 post-rule (moved again by a rule) |');
      L.push('|---|---|---|---|---|');
      for (const d of doubleCorrections as Array<{ corpus: string; tag: string; basePre: number; s2Pre: number; s2Post: number | undefined }>) {
        L.push(`| ${d.corpus} | \`${d.tag}\` | ${d.basePre.toFixed(3)} | ${d.s2Pre.toFixed(3)} | ${d.s2Post?.toFixed(3) ?? '—'} |`);
      }
      L.push('');
      L.push('**Each such case is a defect of the COMBINATION (S2 + rule stage), reported here, not as a net result.**');
    }

    writeFileSync(resolve(OUT, 'step5-rules.md'), L.join('\n'));
    writeFileSync(resolve(OUT, 'step5-rules.json'), JSON.stringify({ ...json, structuralRows, doubleCorrections }, null, 2));
    console.log(L.join('\n'));
  }, 300_000);
});
