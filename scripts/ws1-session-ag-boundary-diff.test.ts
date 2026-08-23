/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// ---------------------------------------------------------------------------
// WS1 Session AG — THE BOUNDARY DIFF ENGINE.
//
// One job: run the production rule stage twice over the same corpus with two
// different FA word arms, and diff the COMMITTED BOUNDARIES. Used three times
// this session:
//
//   * STEP 2 (fidelity) — baseline arm vs an unchanged-plan FA re-run. Any
//     boundary that moves here is engine non-determinism, and it invalidates
//     the S1 measurement before S1 is even written.
//   * STEP 5 (measurement) — baseline arm vs the S1-folded FA re-run. Every
//     boundary that moves here is S1's own effect.
//   * STEP 3 (golden replay) — the same per-boundary diff shape, applied to the
//     stored golden fixtures rather than to a second live run.
//
// Emits a per-boundary diff (unchanged / moved with old, new, delta), the rule
// firing counts on both sides, and a per-row report for every ear-scored
// boundary in `ws1-ear-pass-ledger.ts`.
//
// READ-ONLY. Gated:
//   WS1_SESSION_AG_MEASURE=1 WS1_AG_ARM=<file.json> WS1_AG_LABEL=<label> \
//     npx vitest run scripts/ws1-session-ag-boundary-diff.test.ts
// ---------------------------------------------------------------------------

import { describe, it } from 'vitest';
import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { resolve } from 'path';

import { CORPORA, runProductionPath, tagOf, REPO, REPLAY_ROOT } from './ws1-session-p-pipeline.js';
import { EAR_PASS_LEDGER, earHistory } from './ws1-ear-pass-ledger.js';
import type { Corpus } from './ws1-ear-pass-ledger.js';

const MEASURE = process.env.WS1_SESSION_AG_MEASURE === '1';
const ARM = process.env.WS1_AG_ARM ?? 'ag_baseline_words.json';
const LABEL = process.env.WS1_AG_LABEL ?? 'rerun';
const OUT = resolve(REPO, '.work-phase4/session-ag');

/** Every (corpus, tag) the ledger has EVER scored CORRECT at some value, with
 *  that value — the control population any change must not disturb. Derived
 *  from the ledger rather than transcribed, so it cannot drift from it. */
function earControls(): Array<{ corpus: Corpus; tag: string; value: number }> {
  const seen = new Set<string>();
  const out: Array<{ corpus: Corpus; tag: string; value: number }> = [];
  for (const r of EAR_PASS_LEDGER) {
    if (r.scoredValue === null) continue;
    const k = `${r.corpus}|${r.tag}|${r.scoredValue.toFixed(3)}`;
    if (seen.has(k)) continue;
    seen.add(k);
    const h = earHistory(r.corpus, r.tag).filter(
      x => x.scoredValue !== null && Math.abs(x.scoredValue - r.scoredValue!) < (x.armToleranceSec ?? 0.005));
    if (h[0]?.verdict === 'CORRECT') out.push({ corpus: r.corpus, tag: r.tag, value: r.scoredValue });
  }
  return out;
}

interface Moved { tag: string; index: number; before: number; after: number; delta: number }

describe.skipIf(!MEASURE)(`WS1 Session AG — boundary diff (${LABEL})`, () => {
  it('diffs committed boundaries between the baseline FA arm and the alternate arm', async () => {
    mkdirSync(OUT, { recursive: true });
    const L: string[] = [];
    const controls = earControls();
    const report: Record<string, unknown> = {};

    L.push(`WS1 SESSION AG — BOUNDARY DIFF   arm="${ARM}"  label="${LABEL}"`);
    L.push(`ear-verified CORRECT control population: ${controls.length}`);
    L.push('');

    for (const key of ['v6', '173', 'spanish'] as const) {
      const armPath = resolve(REPLAY_ROOT, key, ARM);
      if (!existsSync(armPath)) { L.push(`######## ${key}: SKIPPED — no ${ARM} in this bundle\n`); continue; }

      const base = await runProductionPath(CORPORA[key]!);
      const alt = await runProductionPath(CORPORA[key]!, true, undefined, ARM);

      const baseByTag = new Map(base.committed.map((s, i) => [tagOf(s), { v: s.startTime, i }]));
      const altByTag = new Map(alt.committed.map((s, i) => [tagOf(s), { v: s.startTime, i }]));

      const moved: Moved[] = [];
      const added: string[] = [], removed: string[] = [];
      let unchanged = 0;
      for (const [tag, b] of baseByTag) {
        const a = altByTag.get(tag);
        if (a === undefined) { removed.push(tag); continue; }
        if (Math.abs(a.v - b.v) < 1e-6) { unchanged++; continue; }
        moved.push({ tag, index: b.i, before: b.v, after: a.v, delta: a.v - b.v });
      }
      for (const tag of altByTag.keys()) if (!baseByTag.has(tag)) added.push(tag);

      L.push(`######## ${key}`);
      L.push(`  committed: base=${base.committed.length} alt=${alt.committed.length}   ` +
        `unchanged=${unchanged} moved=${moved.length} added=${added.length} removed=${removed.length}`);
      L.push(`  rules base: ${JSON.stringify(base.fired)}`);
      L.push(`  rules alt : ${JSON.stringify(alt.fired)}`);
      if (added.length) L.push(`  ADDED   : ${added.join(', ')}`);
      if (removed.length) L.push(`  REMOVED : ${removed.join(', ')}`);

      moved.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
      if (moved.length) {
        L.push('  --- MOVED (largest |delta| first) ---');
        for (const m of moved) {
          L.push(`   ${m.tag.padEnd(32)} ${m.before.toFixed(3)} -> ${m.after.toFixed(3)}  ` +
            `delta=${m.delta >= 0 ? '+' : ''}${m.delta.toFixed(3)}`);
        }
      }

      // ---- the ear-verified controls -------------------------------------
      const myControls = controls.filter(c => c.corpus === key);
      const disturbed = myControls.filter(c => {
        const a = altByTag.get(c.tag), b = baseByTag.get(c.tag);
        if (!a || !b) return false;
        // A control is DISTURBED only if the boundary that was AT its verified
        // value has moved off it. A control whose committed value was never the
        // verified value is not this diff's business.
        return Math.abs(b.v - c.value) < 0.005 && Math.abs(a.v - c.value) >= 0.005;
      });
      L.push(`  ear controls in this corpus: ${myControls.length}; DISTURBED: ${disturbed.length}`);
      for (const d of disturbed) {
        const a = altByTag.get(d.tag)!;
        L.push(`   !! ${d.tag.padEnd(30)} verified=${d.value.toFixed(3)} -> now ${a.v.toFixed(3)} ` +
          `(delta ${(a.v - d.value >= 0 ? '+' : '')}${(a.v - d.value).toFixed(3)})`);
      }

      // ---- R.14/R.15 firings on both sides --------------------------------
      const fmt = (r: typeof base) => r.anchorTrust.map(f =>
        `${f.rule}:${f.segmentTag}@${f.committedValue.toFixed(3)}->${f.correctedValue.toFixed(3)}`).join(' ');
      L.push(`  anchorTrust base (${base.anchorTrust.length}): ${fmt(base) || '(none)'}`);
      L.push(`  anchorTrust alt  (${alt.anchorTrust.length}): ${fmt(alt) || '(none)'}`);
      L.push('');

      report[key] = {
        baseCount: base.committed.length, altCount: alt.committed.length,
        unchanged, moved, added, removed,
        firedBase: base.fired, firedAlt: alt.fired,
        controls: myControls.length, disturbed,
        anchorTrustBase: base.anchorTrust, anchorTrustAlt: alt.anchorTrust,
      };
    }

    console.log(L.join('\n'));
    writeFileSync(resolve(OUT, `boundary-diff-${LABEL}.txt`), L.join('\n') + '\n');
    writeFileSync(resolve(OUT, `boundary-diff-${LABEL}.json`), JSON.stringify(report, null, 2) + '\n');
  }, 3_600_000);
});
