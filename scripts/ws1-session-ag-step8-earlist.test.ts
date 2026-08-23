/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// ---------------------------------------------------------------------------
// WS1 Session AG — STEP 8. THE EAR LIST FOR S1's COLLATERAL.
//
// Writes `docs/ws1-sync-pipeline/stage1-session-ag-ear-list.md`: every boundary
// that moved under S1 WITHOUT ear evidence, plus every ear-verified control
// that moved. One row each, with a listening window, a play command, the
// scripted text, and blank Verdict/Class columns — a run sheet worked THROUGH,
// the same class as the Session K/S/W/AC ear lists already on the single-tracker
// allowlist.
//
// This is the bill Step 1 predicted. The generator reports predicted vs actual
// row count so the two can be compared without hand-counting.
//
// Gated:
//   WS1_SESSION_AG_MEASURE=1 npx vitest run scripts/ws1-session-ag-step8-earlist.test.ts
// ---------------------------------------------------------------------------

import { describe, it } from 'vitest';
import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { resolve } from 'path';

import { CORPORA, runProductionPath, tagOf, REPO, REPLAY_ROOT } from './ws1-session-p-pipeline.js';
import { earHistory } from './ws1-ear-pass-ledger.js';
import type { Corpus } from './ws1-ear-pass-ledger.js';
import type { VideoSegment } from '../src/types';

const MEASURE = process.env.WS1_SESSION_AG_MEASURE === '1';
const ARM = process.env.WS1_AG_ARM ?? 'ag_s1_words.json';
const OUT = resolve(REPO, '.work-phase4/session-ag');
const DOC = resolve(REPO, 'docs/ws1-sync-pipeline/stage1-session-ag-ear-list.md');

/** Predicted row count, from Step 1's own census — recorded here so the
 *  comparison is machine-made, not remembered. |(1)^(2)^(3)| minus the rows
 *  already carrying a defect verdict. */
const PREDICTED_UNAUDITED = 14;
const PREDICTED_VERIFIED_CORRECT_IN_SET = 7;

const AUDIO: Record<string, string> = {
  v6: '/Users/mohtashim/Downloads/All Projects Test Data/V6 Natural Long Pause Segs/6.m4a',
  '173': '/Users/mohtashim/Downloads/All Projects Test Data/173 Segs Project/voiceover.m4a',
  spanish: '/Users/mohtashim/Downloads/All Projects Test Data/Spanish Project/Spanish VOiceover.m4a',
};

/** Listening window: 2.5 s before the earlier of the two values and 2.5 s after
 *  the later, so BOTH candidates are audible in one play and the comparison is
 *  A/B rather than solo — the distinction `ear-verify-t` established. */
const PAD_SEC = 2.5;

const textOf = (s: VideoSegment): string => (s as unknown as { text?: string }).text ?? '';

interface Row {
  corpus: string; tag: string; before: number; after: number; delta: number;
  status: 'unaudited' | 'verified-control-moved' | 'defect-target';
  earValue: number | null; text: string;
}

describe.skipIf(!MEASURE)('WS1 Session AG Step 8 — ear list for the S1 collateral', () => {
  it('writes the run sheet for every boundary S1 moved without ear evidence', async () => {
    mkdirSync(OUT, { recursive: true });
    const rows: Row[] = [];
    const perCorpus: Record<string, { moved: number; unaudited: number; ctlMoved: number; defect: number }> = {};

    for (const key of ['v6', '173', 'spanish'] as const) {
      if (!existsSync(resolve(REPLAY_ROOT, key, ARM))) continue;
      const base = await runProductionPath(CORPORA[key]!);
      const s1 = await runProductionPath(CORPORA[key]!, true, undefined, ARM);
      const altByTag = new Map(s1.committed.map(s => [tagOf(s), s]));

      let moved = 0, unaudited = 0, ctlMoved = 0, defect = 0;
      for (const b of base.committed) {
        const tag = tagOf(b);
        const a = altByTag.get(tag);
        if (a === undefined) continue;
        if (Math.abs(a.startTime - b.startTime) < 1e-6) continue;
        moved++;

        const h = earHistory(key as Corpus, tag);
        const atOld = h.find(r => r.scoredValue !== null
          && Math.abs(r.scoredValue - b.startTime) < (r.armToleranceSec ?? 0.005));
        const correctTarget = h.find(r => r.verdict === 'CORRECT' && r.scoredValue !== null);

        let status: Row['status'];
        if (atOld !== undefined && atOld.verdict === 'CORRECT') { status = 'verified-control-moved'; ctlMoved++; }
        else if (correctTarget !== undefined) { status = 'defect-target'; defect++; }
        else { status = 'unaudited'; unaudited++; }

        rows.push({
          corpus: key, tag, before: b.startTime, after: a.startTime,
          delta: a.startTime - b.startTime, status,
          earValue: correctTarget?.scoredValue ?? null,
          text: textOf(a).trim().replace(/\s+/g, ' '),
        });
      }
      perCorpus[key] = { moved, unaudited, ctlMoved, defect };
    }

    // ---- the document -----------------------------------------------------
    const listed = rows.filter(r => r.status !== 'defect-target');
    const D: string[] = [];
    D.push('# Stage 1 — WS1 Session AG Ear List (S1 collateral)');
    D.push('');
    D.push('> **What this is:** the listening bill S1 (the trailing-silence chunk-text fold) incurs.');
    D.push('> Every boundary S1 moved that has **no ear evidence at all**, plus every');
    D.push('> **ear-verified control that moved off its verified value**. Worked THROUGH against the');
    D.push('> audio, not read. Verdict and Class columns are deliberately blank.');
    D.push('>');
    D.push('> **S1 IS NOT SHIPPED.** `foldPhantomTails` defaults to `false`. This sheet is what has to');
    D.push('> be adjudicated before that default flips — the rows below are what would change.');
    D.push('>');
    D.push('> **Not blinded, and deliberately so.** Both the current and the proposed value are named,');
    D.push('> because the question is which of two specific instants is right. Play them A/B:');
    D.push('> `ear-verify-t` measured that two candidates inside one silence can be indistinguishable');
    D.push('> played alone and clearly ordered played side by side.');
    D.push('');
    D.push('## Counts — predicted vs actual');
    D.push('');
    D.push('| quantity | predicted (Step 1 census) | actual (Step 5 measurement) |');
    D.push('|---|---|---|');
    D.push(`| boundaries with no ear evidence | ${PREDICTED_UNAUDITED} | ${rows.filter(r => r.status === 'unaudited').length} |`);
    D.push(`| ear-verified controls in the blast radius | ${PREDICTED_VERIFIED_CORRECT_IN_SET} | ${rows.filter(r => r.status === 'verified-control-moved').length} moved off value |`);
    D.push(`| **total rows on this sheet** | **${PREDICTED_UNAUDITED + PREDICTED_VERIFIED_CORRECT_IN_SET}** | **${listed.length}** |`);
    D.push('');
    for (const [k, v] of Object.entries(perCorpus)) {
      D.push(`- **${k}**: ${v.moved} boundaries moved — ${v.unaudited} unaudited, ` +
        `${v.ctlMoved} verified controls moved off value, ${v.defect} known defect targets (not listed here).`);
    }
    D.push('');
    D.push('## How to play a row');
    D.push('');
    D.push('```bash');
    D.push('ffplay -autoexit -nodisp -ss <window start> -t <window length> "<audio>"');
    D.push('```');
    D.push('');
    D.push('Listen for where the scene should cut. Then fill in **Verdict** (`BEFORE` if the current');
    D.push('value is right and S1 makes it worse / `AFTER` if S1 improves it / `NEITHER`) and **Class**.');
    D.push('');

    for (const key of ['v6', '173', 'spanish']) {
      const mine = listed.filter(r => r.corpus === key);
      if (mine.length === 0) continue;
      D.push(`## ${key} — ${mine.length} rows`);
      D.push('');
      for (const [gi, group] of [
        ['Ear-verified controls that MOVED — a verdict of BEFORE on any of these is a regression',
          mine.filter(r => r.status === 'verified-control-moved')] as const,
        ['No ear evidence either way', mine.filter(r => r.status === 'unaudited')] as const,
      ]) {
        if (group.length === 0) continue;
        D.push(`### ${gi}`);
        D.push('');
        D.push('| # | scene tag | before | after | delta | listening window | verdict | class |');
        D.push('|---|---|---|---|---|---|---|---|');
        group.forEach((r, i) => {
          const lo = Math.max(0, Math.min(r.before, r.after) - PAD_SEC);
          const hi = Math.max(r.before, r.after) + PAD_SEC;
          D.push(`| ${i + 1} | \`${r.tag}\` | ${r.before.toFixed(3)} | ${r.after.toFixed(3)} | ` +
            `${r.delta >= 0 ? '+' : ''}${r.delta.toFixed(3)} | ${lo.toFixed(2)}–${hi.toFixed(2)} |  |  |`);
        });
        D.push('');
        D.push('<details><summary>Play commands and scripted text</summary>');
        D.push('');
        group.forEach((r, i) => {
          const lo = Math.max(0, Math.min(r.before, r.after) - PAD_SEC);
          const hi = Math.max(r.before, r.after) + PAD_SEC;
          D.push(`**${i + 1}. \`${r.tag}\`** — before ${r.before.toFixed(3)}, after ${r.after.toFixed(3)}` +
            (r.earValue !== null ? ` (ledger CORRECT value ${r.earValue.toFixed(3)})` : ''));
          D.push('');
          D.push('```bash');
          D.push(`ffplay -autoexit -nodisp -ss ${lo.toFixed(2)} -t ${(hi - lo).toFixed(2)} "${AUDIO[r.corpus]}"`);
          D.push('```');
          D.push('');
          D.push(`> ${r.text.slice(0, 300)}${r.text.length > 300 ? '…' : ''}`);
          D.push('');
        });
        D.push('</details>');
        D.push('');
      }
    }

    writeFileSync(DOC, D.join('\n') + '\n');
    writeFileSync(resolve(OUT, 'step8-earlist.json'), JSON.stringify(
      { predictedUnaudited: PREDICTED_UNAUDITED, predictedControls: PREDICTED_VERIFIED_CORRECT_IN_SET,
        perCorpus, rows }, null, 2) + '\n');
    console.log(`wrote ${DOC} — ${listed.length} rows (predicted ${PREDICTED_UNAUDITED + PREDICTED_VERIFIED_CORRECT_IN_SET})`);
    console.log(JSON.stringify(perCorpus, null, 2));
  }, 3_600_000);
});
