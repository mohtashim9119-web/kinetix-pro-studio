/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */
// WS1 Session AE follow-up — did the 230/231 seam DROP words, or only mistime
// them? Read-only; gated out of the default sweep.
//   WS1_SESSION_AE_MEASURE=1 npx vitest run scripts/ws1-session-ae-seam230.test.ts
import { describe, it } from 'vitest';
import { writeFileSync, mkdirSync } from 'fs';
import { CORPORA, runProductionPath, tagOf } from './ws1-session-p-pipeline';

const MEASURE = process.env.WS1_SESSION_AE_MEASURE === '1';
const WIN: [number, number] = [678.0, 686.5];

describe.skipIf(!MEASURE)('WS1 Session AE — 230/231 word-match audit', () => {
  it('reports match coverage and both token arms for the 229-232 window', async () => {
    const run = await runProductionPath(CORPORA.v6!, false);
    const L: string[] = [];

    L.push('=== PER-SEGMENT ALIGNMENT COVERAGE (the Hirschberg pass\'s own numbers) ===');
    for (const tag of ['229_no_formal_sense', '230_slowing_pace', '231_slowing_pace', '232_sudden_halt']) {
      const i = run.committed.findIndex(s => tagOf(s) === tag);
      if (i < 0) { L.push(`  ${tag}: NOT COMMITTED (skipped upstream)`); continue; }
      const a = run.keptAlignments[i]!;
      L.push(`  ${tag.padEnd(22)} matchedWords=${a.matchedWords}/${a.totalWords} ` +
        `matched=${a.matched} longestRun=${a.longestRun} conf=${a.confidence.toFixed(3)} ` +
        `tok[${a.firstTokenIdx}..${a.lastTokenIdx}] recoveredVia=${a.recoveredVia ?? 'none (direct global match)'}`);
      L.push(`      script text: "${run.committed[i]!.text.trim()}"`);
    }

    L.push('\n=== FA TOKENS in the window (the array the alignment indexed) ===');
    run.usableFaTokens.forEach((t, idx) => {
      if (t.startSec < WIN[0] || t.startSec > WIN[1]) return;
      const c = (t as { confidence?: number }).confidence;
      L.push(`  [${idx}] '${t.text}' [${t.startSec.toFixed(3)}, ${t.endSec.toFixed(3)}] conf=${c === undefined ? 'n/a' : c.toExponential(2)}`);
    });

    L.push('\n=== RAW WHISPER TOKENS in the window (the independent ASR arm) ===');
    for (const t of run.whisperTokens) {
      if (t.startSec < WIN[0] || t.startSec > WIN[1]) continue;
      L.push(`  '${t.text}' [${t.startSec.toFixed(3)}, ${t.endSec.toFixed(3)}]`);
    }

    L.push('\n=== MALFORMED-TOKEN FILTER: was anything dropped in this window? ===');
    L.push(`  filter totals — total=${run.whisperFilter.total} kept=${run.whisperFilter.kept} skipped=${run.whisperFilter.skipped}`);
    L.push(`  FA array: ${run.faTokens.length} raw -> ${run.usableFaTokens.length} usable ` +
      `(${run.faTokens.length - run.usableFaTokens.length} dropped corpus-wide)`);
    const droppedInWindow = run.faTokens.filter(t =>
      t.startSec >= WIN[0] && t.startSec <= WIN[1] &&
      !run.usableFaTokens.some(u => u.startSec === t.startSec && u.text === t.text));
    L.push(`  FA tokens dropped INSIDE this window: ${droppedInWindow.length}` +
      (droppedInWindow.length ? ` -> ${droppedInWindow.map(t => `'${t.text}'@${t.startSec}`).join(', ')}` : ''));

    console.log(L.join('\n'));
    mkdirSync('.work-phase4/session-ae', { recursive: true });
    writeFileSync('.work-phase4/session-ae/seam230-audit.txt', L.join('\n'));
  }, 600_000);
});
