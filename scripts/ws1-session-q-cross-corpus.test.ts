/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// ---------------------------------------------------------------------------
// WS1 Session Q — STEP 5. CROSS-CORPUS SWEEP (Session P's 7b(d), finished).
//
// R.12 and R.13 have never executed outside v6: the 173 and Spanish bundles
// had no raw-Whisper arm and no live chunk plan, so the corpus-parameterised
// harness Session P built could not be pointed at them. This file runs the
// whole production rule stage over every corpus that HAS a stamped
// live-fidelity bundle and reports, per corpus:
//
//   * each rule's firing count, by name;
//   * every committed boundary that MOVED relative to the pre-rule array,
//     with its delta and the rule that moved it;
//   * the Model-P invariants (gapless, strictly monotonic, positive duration)
//     after composition.
//
// It is a REPORT plus a small set of standing assertions. The assertions are
// the ones that must hold on ANY corpus — never a pinned firing count, which
// would turn a generalization check back into a v6 lookup table.
// ---------------------------------------------------------------------------

import { describe, it, expect } from 'vitest';
import { existsSync, writeFileSync, mkdirSync } from 'fs';
import { resolve } from 'path';
import { CORPORA, OUT_ROOT, REPLAY_ROOT, runProductionPath, tagOf } from './ws1-session-p-pipeline.js';
import { MANIFEST_FILE } from './ws1-runid.js';

const MEASURE = process.env.WS1_SESSION_Q_MEASURE === '1';

const stamped = (key: string): boolean => existsSync(resolve(REPLAY_ROOT, key, MANIFEST_FILE));

describe.skipIf(!MEASURE)('WS1 Session Q — cross-corpus rule sweep (Step 5)', () => {
  for (const key of Object.keys(CORPORA)) {
    it(`${key}: every rule runs, and every boundary move is accounted for`, async () => {
      if (!stamped(key)) {
        throw new Error(
          `${key} has no stamped live-fidelity bundle (${MANIFEST_FILE} absent). ` +
          `Build it: whisper raw arm -> ws1-session-q-dump-live-plan -> FA regen -> ws1-session-p-stamp-bundle.ts ${key}`,
        );
      }
      const spec = CORPORA[key]!;
      const r = await runProductionPath(spec);
      mkdirSync(OUT_ROOT, { recursive: true });

      const preById = new Map(r.preRuleSegments.map(s => [s.id, s.startTime]));
      const movers = r.committed.flatMap((s, i) => {
        const before = preById.get(s.id);
        if (before === undefined) return [];
        const delta = s.startTime - before;
        if (Math.abs(delta) < 1e-9) return [];
        const byRule =
          r.r11.some(f => f.segmentId === s.id) ? 'R.11'
          : r.r12.some(f => f.segmentId === s.id) ? 'R.12'
          : r.r13.some(f => f.segmentId === s.id) ? 'R.13'
          : 'UNATTRIBUTED';
        return [{ index: i, tag: tagOf(s), before, after: s.startTime, delta, byRule }];
      });

      // Model P after composition — must hold on every corpus.
      const problems: string[] = [];
      for (let i = 1; i < r.committed.length; i++) {
        const prev = r.committed[i - 1]!; const cur = r.committed[i]!;
        if (!(cur.startTime > prev.startTime)) problems.push(`seg ${i} not strictly after ${i - 1}`);
        if (Math.abs(prev.startTime + prev.duration - cur.startTime) > 1e-6) problems.push(`seg ${i - 1}->${i} gap/overlap`);
        if (!(cur.duration > 0)) problems.push(`seg ${i} non-positive duration`);
      }

      const out = {
        corpus: key, runId: r.runId, language: spec.language,
        parsed: r.anchorTimed.length, kept: r.kept, skipped: r.skipped, committed: r.committed.length,
        whisperFilter: r.whisperFilter,
        chunkCount: r.chunks.length, runCount: r.runs.length, unscriptedRuns: r.r5runs.length,
        fired: r.fired,
        movers,
        unattributedMovers: movers.filter(m => m.byRule === 'UNATTRIBUTED'),
        modelPProblems: problems,
      };
      writeFileSync(resolve(OUT_ROOT, `stepQ5-cross-corpus-${key}.json`), JSON.stringify(out, null, 2));
      // eslint-disable-next-line no-console
      console.log(`[STEP Q5 ${key}]`, JSON.stringify({
        runId: r.runId, committed: r.committed.length, fired: r.fired,
        movers: movers.length, unattributed: out.unattributedMovers.length, modelP: problems.length,
      }, null, 2));
      for (const m of movers) {
        // eslint-disable-next-line no-console
        console.log(`  ${m.byRule.padEnd(14)} seg ${String(m.index).padStart(3)} ${m.tag.padEnd(26)} ${m.before.toFixed(3)} -> ${m.after.toFixed(3)} (${m.delta >= 0 ? '+' : ''}${m.delta.toFixed(3)})`);
      }

      // EVERY corpus must satisfy these; none of them pins a v6 number.
      expect(problems, 'Model P must survive rule composition on every corpus').toEqual([]);
      expect(out.unattributedMovers, 'a boundary moved with no rule claiming it').toEqual([]);
      expect(Object.keys(r.fired).sort()).toEqual(['R.10', 'R.11', 'R.12', 'R.13', 'R.5']);
    }, 900_000);
  }
});
