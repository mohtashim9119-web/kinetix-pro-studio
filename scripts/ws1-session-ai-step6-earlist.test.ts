/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// ---------------------------------------------------------------------------
// WS1 Session AI — STEP 6. THE PRIORITISED EAR LIST FOR S2.
//
// Writes `docs/ws1-sync-pipeline/stage1-session-ai-ear-list.md`, ordered
// highest-value listening first, per the brief:
//   1. the five open defects (listed if S2 moved them; noted if unchanged)
//   2. any of the 69 ear-verified controls that moved
//   3. boundaries whose incoming first-word FA confidence changed by more
//      than an order of magnitude (base vs S2), excluding rows already listed
//   4. the remaining moved-without-evidence set
// Each row: scene tag, committed before, committed after, delta, listening
// window, play command, scripted text, verdict/class blank — same run-sheet
// convention as the Session AG/AD/K/S/W ear lists.
//
// Gated:
//   WS1_SESSION_AI_MEASURE=1 npx vitest run scripts/ws1-session-ai-step6-earlist.test.ts
// ---------------------------------------------------------------------------

import { describe, it } from 'vitest';
import { writeFileSync, mkdirSync } from 'fs';
import { resolve } from 'path';

import { CORPORA, runProductionPath, tagOf, REPO } from './ws1-session-p-pipeline.js';
import { earHistory, earVerifiedControls, EAR_PIN_TOLERANCE_SEC } from './ws1-ear-pass-ledger.js';
import type { Corpus } from './ws1-ear-pass-ledger.js';
import type { VideoSegment } from '../src/types';
import type { TranscriptToken } from '../src/types';

const MEASURE = process.env.WS1_SESSION_AI_MEASURE === '1';
const OUT = resolve(REPO, '.work-phase4/session-ai');
const DOC = resolve(REPO, 'docs/ws1-sync-pipeline/stage1-session-ai-ear-list.md');
const TOL = EAR_PIN_TOLERANCE_SEC;

const AUDIO: Record<string, string> = {
  v6: '/Users/mohtashim/Downloads/All Projects Test Data/V6 Natural Long Pause Segs/6.m4a',
  '173': '/Users/mohtashim/Downloads/All Projects Test Data/173 Segs Project/voiceover.m4a',
  spanish: '/Users/mohtashim/Downloads/All Projects Test Data/Spanish Project/Spanish VOiceover.m4a',
};

const PAD_SEC = 2.5;

const textOf = (s: VideoSegment): string => (s as unknown as { text?: string }).text ?? '';
const confOf = (t: TranscriptToken | undefined): number =>
  t === undefined ? 0 : ((t as { confidence?: number }).confidence ?? 0);

const OPEN_DEFECT_TAGS = new Set(['214_solitary_fire', '231_slowing_pace', '447_scout_facing_dark', 'lethal_nature_hazard', 'gadget_decay']);

interface Row {
  corpus: string; tag: string; before: number; after: number; delta: number;
  confBefore: number; confAfter: number; confRatio: number;
  category: 'open-defect' | 'control-moved' | 'confidence-jump' | 'no-evidence';
  earValue: number | null; text: string;
}

describe.skipIf(!MEASURE)('WS1 Session AI Step 6 — prioritised ear list for S2', () => {
  it('writes the run sheet, highest-value listening first', async () => {
    mkdirSync(OUT, { recursive: true });
    const rows: Row[] = [];
    const controls = earVerifiedControls();

    for (const key of ['v6', '173', 'spanish'] as const) {
      const spec = CORPORA[key]!;
      const base = await runProductionPath(spec);
      const s2 = await runProductionPath(spec, true, undefined, 'fa_ai_words.json');
      const s2ByTag = new Map(s2.committed.map((s, i) => [tagOf(s), { seg: s, idx: i }]));
      const controlTags = new Set(controls.filter(c => c.corpus === key).map(c => c.tag));

      for (let i = 0; i < base.committed.length; i++) {
        const b = base.committed[i]!;
        const tag = tagOf(b);
        const found = s2ByTag.get(tag);
        if (found === undefined) continue;
        const { seg: a, idx: aIdx } = found;

        const confB = i > 0 ? confOf(base.usableFaTokens[base.keptAlignments[i]?.firstTokenIdx ?? -1]) : NaN;
        const confA = aIdx > 0 ? confOf(s2.usableFaTokens[s2.keptAlignments[aIdx]?.firstTokenIdx ?? -1]) : NaN;
        const ratio = (Number.isFinite(confB) && Number.isFinite(confA) && confB > 0 && confA > 0)
          ? Math.max(confA, confB) / Math.min(confA, confB) : NaN;

        const moved = Math.abs(a.startTime - b.startTime) >= 1e-6;
        const isOpenDefect = OPEN_DEFECT_TAGS.has(tag);
        const isControl = controlTags.has(tag);
        const bigConfJump = Number.isFinite(ratio) && ratio >= 10;

        // Unmoved rows have nothing new to listen to — this holds for open defects too
        // (they are noted separately in the "did NOT move" section below, not listed as a row).
        if (!moved) continue;

        const h = earHistory(key as Corpus, tag);
        const correctTarget = h.find(r => r.verdict === 'CORRECT' && r.scoredValue !== null);

        let category: Row['category'];
        if (isOpenDefect) category = 'open-defect';
        else if (isControl) category = 'control-moved';
        else if (bigConfJump) category = 'confidence-jump';
        else category = 'no-evidence';

        rows.push({
          corpus: key, tag, before: b.startTime, after: a.startTime, delta: a.startTime - b.startTime,
          confBefore: confB, confAfter: confA, confRatio: ratio,
          category, earValue: correctTarget?.scoredValue ?? null,
          text: textOf(a).trim().replace(/\s+/g, ' '),
        });
      }
    }

    // ---- which open defects did NOT move (nothing new to listen to) -------
    const movedOpenTags = new Set(rows.filter(r => r.category === 'open-defect').map(r => `${r.corpus}/${r.tag}`));
    const allOpenDefects: Array<{ corpus: string; tag: string }> = [
      { corpus: 'v6', tag: '214_solitary_fire' }, { corpus: 'v6', tag: '231_slowing_pace' },
      { corpus: 'v6', tag: '447_scout_facing_dark' }, { corpus: '173', tag: 'lethal_nature_hazard' },
      { corpus: '173', tag: 'gadget_decay' },
    ];
    const unmovedOpenDefects = allOpenDefects.filter(d => !movedOpenTags.has(`${d.corpus}/${d.tag}`));

    const D: string[] = [];
    D.push('# Stage 1 — WS1 Session AI Ear List (S2 measurement)');
    D.push('');
    D.push('> **What this is:** the listening bill S2 (the sentence-bounded chunk planner,');
    D.push('> `computeFaChunkPlanS2`, measurement arm only — not shipped) incurs. Ordered');
    D.push('> highest-value listening first: (1) the five open defects, (2) any ear-verified');
    D.push('> control that moved, (3) boundaries whose incoming FA confidence changed by more');
    D.push('> than an order of magnitude, (4) the remaining moved-without-evidence set. Worked');
    D.push('> THROUGH against the audio, not read. Verdict and Class columns are deliberately blank.');
    D.push('>');
    D.push('> **S2 IS NOT SHIPPED.** `computeFaChunkPlanS2` has no production caller. This sheet is');
    D.push('> what has to be adjudicated before any ship decision — a decision this session does not');
    D.push('> take.');
    D.push('>');
    D.push('> **Not blinded, and deliberately so** — same discipline as every prior WS1 ear list.');
    D.push('');
    D.push('## Open defects that did NOT move under S2 (nothing new to listen to)');
    D.push('');
    if (unmovedOpenDefects.length === 0) {
      D.push('(none — every one of the five moved; see the section below)');
    } else {
      for (const d of unmovedOpenDefects) D.push(`- ${d.corpus} / \`${d.tag}\` — unchanged from base under S2.`);
    }
    D.push('');
    D.push('## How to play a row');
    D.push('');
    D.push('```bash');
    D.push('ffplay -autoexit -nodisp -ss <window start> -t <window length> "<audio>"');
    D.push('```');
    D.push('');
    D.push('Fill in **Verdict** (`BEFORE` if the current value is right and S2 makes it worse /');
    D.push('`AFTER` if S2 improves it / `NEITHER`) and **Class**.');
    D.push('');

    const groups: Array<[string, Row['category']]> = [
      ['1. The five open defects — did S2 move them, and in which direction?', 'open-defect'],
      ['2. Ear-verified controls that MOVED — a verdict of BEFORE on any of these is a regression', 'control-moved'],
      ['3. Incoming FA confidence changed by >1 order of magnitude', 'confidence-jump'],
      ['4. Remaining moved-without-evidence set', 'no-evidence'],
    ];

    let totalListed = 0;
    for (const key of ['v6', '173', 'spanish']) {
      const mine = rows.filter(r => r.corpus === key);
      if (mine.length === 0) continue;
      D.push(`## ${key} — ${mine.length} rows`);
      D.push('');
      for (const [title, cat] of groups) {
        const group = mine.filter(r => r.category === cat);
        if (group.length === 0) continue;
        totalListed += group.length;
        D.push(`### ${title}`);
        D.push('');
        D.push('| # | scene tag | before | after | delta | conf before | conf after | listening window | verdict | class |');
        D.push('|---|---|---|---|---|---|---|---|---|---|');
        group.forEach((r, i) => {
          const lo = Math.max(0, Math.min(r.before, r.after) - PAD_SEC);
          const hi = Math.max(r.before, r.after) + PAD_SEC;
          D.push(`| ${i + 1} | \`${r.tag}\` | ${r.before.toFixed(3)} | ${r.after.toFixed(3)} | `
            + `${r.delta >= 0 ? '+' : ''}${r.delta.toFixed(3)} | ${r.confBefore.toExponential(2)} | `
            + `${r.confAfter.toExponential(2)} | ${lo.toFixed(2)}–${hi.toFixed(2)} |  |  |`);
        });
        D.push('');
        D.push('<details><summary>Play commands and scripted text</summary>');
        D.push('');
        group.forEach((r, i) => {
          const lo = Math.max(0, Math.min(r.before, r.after) - PAD_SEC);
          const hi = Math.max(r.before, r.after) + PAD_SEC;
          D.push(`**${i + 1}. \`${r.tag}\`** — before ${r.before.toFixed(3)}, after ${r.after.toFixed(3)}`
            + (r.earValue !== null ? ` (ledger CORRECT value ${r.earValue.toFixed(3)})` : ''));
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

    D.push('## Counts');
    D.push('');
    D.push(`- total rows: **${totalListed}**`);
    D.push(`- open-defect: ${rows.filter(r => r.category === 'open-defect').length}`);
    D.push(`- control-moved: ${rows.filter(r => r.category === 'control-moved').length}`);
    D.push(`- confidence-jump: ${rows.filter(r => r.category === 'confidence-jump').length}`);
    D.push(`- no-evidence: ${rows.filter(r => r.category === 'no-evidence').length}`);

    writeFileSync(DOC, D.join('\n') + '\n');
    writeFileSync(resolve(OUT, 'step6-earlist.json'), JSON.stringify({ rows, unmovedOpenDefects }, null, 2) + '\n');
    console.log(`wrote ${DOC} — ${totalListed} rows`);
    console.log(JSON.stringify({
      total: totalListed,
      byCategory: {
        openDefect: rows.filter(r => r.category === 'open-defect').length,
        controlMoved: rows.filter(r => r.category === 'control-moved').length,
        confidenceJump: rows.filter(r => r.category === 'confidence-jump').length,
        noEvidence: rows.filter(r => r.category === 'no-evidence').length,
      },
    }, null, 2));
  }, 300_000);
});
