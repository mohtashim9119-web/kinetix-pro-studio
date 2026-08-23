/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// ---------------------------------------------------------------------------
// WS1 Session AH — STEP 2b. THE FIDELITY GATE on the re-captured 173 bundle.
//
// Drives the SAME production rule stage over two FA word arms — the stamped
// `fa_live_words.json` (aligned against the retired 126-chunk plan) and this
// session's `fa_ah_words.json` (aligned against the 119-chunk plan current code
// actually computes) — and reports every committed boundary that differs.
//
// WHY IT MATTERS. The retired plan is what every measurement since Session P has
// been standing on for this corpus. If the re-capture moves boundaries, then
// 173's ear verdicts were scored against an arm production cannot reproduce, and
// every 173 row needs re-checking. If it moves none, the discrepancy was
// cosmetic and the ear record carries over intact.
//
// Gated: WS1_SESSION_AH_MEASURE=1 npx vitest run scripts/ws1-session-ah-step2b-fidelity.test.ts
// ---------------------------------------------------------------------------

import { describe, it } from 'vitest';
import { writeFileSync, mkdirSync } from 'fs';
import { resolve } from 'path';

import { CORPORA, runProductionPath, tagOf, REPO } from './ws1-session-p-pipeline.js';
import { earHistory } from './ws1-ear-pass-ledger.js';

const MEASURE = process.env.WS1_SESSION_AH_MEASURE === '1';
const OUT = resolve(REPO, '.work-phase4/session-ah');
const TOL = 0.005;

/** The five 173 rows the register tracks, plus every 173 boundary the ledger has
 *  ever scored — all re-verified against the new arm. */
const DEFECT_ROWS = [
  { tag: 'lethal_nature_hazard', committed: 18.51, ear: 19.27 },
  { tag: 'iron_bounce', committed: 76.58, ear: 76.59 },
  { tag: 'wall_split_path', committed: 162.46, ear: 162.15 },
  { tag: 'logic_clash', committed: 418.14, ear: 418.14 },
  { tag: 'gadget_decay', committed: 427.48, ear: 427.60 },
];

describe.skipIf(!MEASURE)('WS1 Session AH Step 2b — 173 re-capture fidelity gate', () => {
  it('compares committed boundaries across the two FA arms', async () => {
    mkdirSync(OUT, { recursive: true });
    const spec = CORPORA['173']!;
    const base = await runProductionPath(spec);                                   // fa_live_words.json
    const fresh = await runProductionPath(spec, true, undefined, 'fa_ah_words.json');

    const L: string[] = [];
    L.push('# WS1 Session AH Step 2b — 173 re-capture fidelity gate (MEASURED)');
    L.push('');
    L.push('| arm | plan | chunks | committed | rules fired |');
    L.push('|---|---|---|---|---|');
    L.push(`| stamped (retired) | fa_live_chunks.json (126) | ${base.chunks.length} recomputed | ${base.committed.length} | ${JSON.stringify(base.fired)} |`);
    L.push(`| re-captured | fa_ah_chunks.json (119) | ${fresh.chunks.length} | ${fresh.committed.length} | ${JSON.stringify(fresh.fired)} |`);
    L.push('');
    L.push('Note: `chunks` above is what the CURRENT planner computes in both runs (119) — the arms');
    L.push('differ in the FA WORDS they carry, which is what the plan difference actually produced.');
    L.push('');

    const baseByTag = new Map(base.committed.map(s => [tagOf(s), s.startTime]));
    const freshByTag = new Map(fresh.committed.map(s => [tagOf(s), s.startTime]));
    const allTags = [...new Set([...baseByTag.keys(), ...freshByTag.keys()])];

    const diffs: Array<{ tag: string; base: number | undefined; fresh: number | undefined; delta: number | null }> = [];
    let exact = 0;
    for (const t of allTags) {
      const a = baseByTag.get(t); const b = freshByTag.get(t);
      if (a !== undefined && b !== undefined && Math.abs(a - b) < 1e-9) { exact++; continue; }
      diffs.push({ tag: t, base: a, fresh: b, delta: a !== undefined && b !== undefined ? +(b - a).toFixed(6) : null });
    }

    L.push('## Fidelity verdict');
    L.push('');
    L.push(`- boundaries compared: **${allTags.length}**`);
    L.push(`- **exact matches (bit-identical): ${exact}**`);
    L.push(`- **differences: ${diffs.length}**`);
    L.push('');
    if (diffs.length === 0) {
      L.push('**The re-captured arm commits every boundary at the identical value.** The retired');
      L.push('126-chunk plan and the reproducible 119-chunk plan are indistinguishable at the committed');
      L.push('output, so every 173 ear verdict on record carries over unchanged.');
    } else {
      L.push('| tag | stamped arm | re-captured arm | delta | ear history |');
      L.push('|---|---|---|---|---|');
      for (const d of diffs.sort((x, y) => Math.abs(y.delta ?? 0) - Math.abs(x.delta ?? 0))) {
        const h = earHistory('173', d.tag).map(r => `${r.sitting}:${r.scoredValue ?? 'absent'}->${r.verdict}`).join(' \\| ');
        L.push(`| \`${d.tag}\` | ${d.base?.toFixed(3) ?? 'ABSENT'} | ${d.fresh?.toFixed(3) ?? 'ABSENT'} `
          + `| ${d.delta === null ? '—' : (d.delta >= 0 ? '+' : '') + d.delta.toFixed(3)} | ${h || '(none)'} |`);
      }
    }
    L.push('');

    // ---- the five register rows ----------------------------------------
    L.push('## The five 173 register rows — do they still reproduce?');
    L.push('');
    L.push('| row | expected committed | stamped arm | re-captured arm | reproduces? |');
    L.push('|---|---|---|---|---|');
    for (const r of DEFECT_ROWS) {
      const a = baseByTag.get(r.tag); const b = freshByTag.get(r.tag);
      const ok = a !== undefined && b !== undefined
        && Math.abs(a - r.committed) < TOL && Math.abs(b - r.committed) < TOL;
      L.push(`| \`${r.tag}\` | ${r.committed.toFixed(3)} | ${a?.toFixed(3) ?? '—'} | ${b?.toFixed(3) ?? '—'} | ${ok ? 'YES' : '**NO**'} |`);
    }
    L.push('');

    // ---- every ledger-scored 173 boundary ------------------------------
    const scored = [...new Set(
      (await import('./ws1-ear-pass-ledger.js')).EAR_PASS_LEDGER
        .filter(r => r.corpus === '173').map(r => r.tag))];
    L.push('## Every ledger-scored 173 boundary, re-verified against the new arm');
    L.push('');
    L.push('| tag | stamped | re-captured | identical? | latest ledger verdict at the committed value |');
    L.push('|---|---|---|---|---|');
    for (const t of scored.sort()) {
      const a = baseByTag.get(t); const b = freshByTag.get(t);
      const same = a !== undefined && b !== undefined && Math.abs(a - b) < 1e-9;
      const h = b === undefined ? '—' : (() => {
        const m = earHistory('173', t).filter(r => r.scoredValue !== null && Math.abs(r.scoredValue - b) < TOL);
        return m[0] ? `${m[0].sitting}: ${m[0].verdict}` : 'no row at this value';
      })();
      L.push(`| \`${t}\` | ${a?.toFixed(3) ?? 'ABSENT'} | ${b?.toFixed(3) ?? 'ABSENT'} | ${same ? 'yes' : '**NO**'} | ${h} |`);
    }

    writeFileSync(resolve(OUT, 'step2b-fidelity.md'), L.join('\n'));
    writeFileSync(resolve(OUT, 'step2b-fidelity.json'), JSON.stringify({
      compared: allTags.length, exact, diffs,
      baseFired: base.fired, freshFired: fresh.fired,
    }, null, 2));
    console.log(L.slice(0, 40).join('\n'));
  }, 900_000);
});
