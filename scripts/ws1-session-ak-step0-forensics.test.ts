/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// ---------------------------------------------------------------------------
// WS1 Session AK — STEP 0 FORENSICS. Two questions the brief asks before any
// arm is run, both answered by MEASUREMENT rather than inspection.
//
// (a) THE `102_frozen_scouts` 10ms GAP. The live export commits 306.42; a fresh
//     harness run at HEAD commits 306.43. Three candidate causes were named:
//     rounding, arm difference, or drift. The arm hypothesis is directly
//     testable and costs one extra run: the app captured its silences at 16 kHz
//     (`silences_app.json`) while the harness defaults to the native-rate arm
//     (`silences_native.json`), and that exact 10ms arm difference is ALREADY on
//     record for a different row — `226_four_scouts` carries an
//     `armToleranceSec: 0.02` in the ear ledger whose note measures the same
//     silence at 671.18 (16 kHz) vs 671.17 (native). If driving the 16 kHz arm
//     reproduces 306.42, the cause is the arm, not drift.
//
// (b) R.5 RUN CENSUS PER CORPUS. How many unscripted-recitation runs
//     `computeUnscriptedRuns` finds on each corpus, where they sit, and how much
//     audio they cover. This is the fact that decides whether 173 and Spanish
//     are CONTROLS for the Step 2 excision arm (zero runs => excision is a
//     structural no-op there) or confounded like v6.
//
// Gated: WS1_SESSION_AK_MEASURE=1 npx vitest run scripts/ws1-session-ak-step0-forensics.test.ts
// ---------------------------------------------------------------------------

import { describe, it } from 'vitest';
import { writeFileSync, mkdirSync } from 'fs';
import { resolve } from 'path';

import { CORPORA, runProductionPath, tagOf, REPO } from './ws1-session-p-pipeline.js';

const MEASURE = process.env.WS1_SESSION_AK_MEASURE === '1';
const OUT = resolve(REPO, '.work-phase4/session-ak');

/** The rows the two arms are compared at: the newly-observed v6 drift, and the
 *  row whose 16 kHz-vs-native arm difference is already ledger-documented. */
const ARM_PROBE_ROWS = ['102_frozen_scouts', '226_four_scouts'];

describe.skipIf(!MEASURE)('WS1 Session AK Step 0 forensics', () => {
  it('answers the 102_frozen_scouts arm question and censuses R.5 per corpus', async () => {
    mkdirSync(OUT, { recursive: true });
    const L: string[] = ['# WS1 Session AK Step 0 forensics (MEASURED)', ''];
    const json: Record<string, unknown> = {};

    // ---- (a) the silence-arm probe, v6 ------------------------------------
    const v6 = CORPORA.v6!;
    const native = await runProductionPath(v6);                                 // silences_native.json
    const app16k = await runProductionPath(v6, true, 'silences_app.json');      // the app's own capture arm

    L.push('## (a) `102_frozen_scouts` — 16 kHz vs native silence arm');
    L.push('');
    L.push('| tag | native arm (harness default) | 16 kHz arm (`silences_app.json`) | export | delta(16k - native) |');
    L.push('|---|---|---|---|---|');
    const armRows: Array<Record<string, unknown>> = [];
    const EXPORT: Record<string, number> = { '102_frozen_scouts': 306.42, '226_four_scouts': 671.17 };
    for (const tag of ARM_PROBE_ROWS) {
      const n = native.committed.find(s => tagOf(s) === tag)?.startTime;
      const a = app16k.committed.find(s => tagOf(s) === tag)?.startTime;
      L.push(`| \`${tag}\` | ${n?.toFixed(3) ?? 'ABSENT'} | ${a?.toFixed(3) ?? 'ABSENT'} | ${EXPORT[tag]!.toFixed(3)} `
        + `| ${n !== undefined && a !== undefined ? ((a - n) >= 0 ? '+' : '') + (a - n).toFixed(3) : '—'} |`);
      armRows.push({ tag, native: n, app16k: a, exportValue: EXPORT[tag] });
    }
    L.push('');

    // Whole-corpus movement between the two silence arms, so the answer is not
    // read off two cherry-picked rows.
    const nByTag = new Map(native.committed.map(s => [tagOf(s), s.startTime]));
    const aByTag = new Map(app16k.committed.map(s => [tagOf(s), s.startTime]));
    let armMoved = 0;
    const armDeltas: number[] = [];
    for (const [t, n] of nByTag) {
      const a = aByTag.get(t);
      if (a === undefined) continue;
      if (Math.abs(a - n) >= 1e-9) { armMoved++; armDeltas.push(+(a - n).toFixed(6)); }
    }
    L.push(`- v6 boundaries that move between the two silence arms: **${armMoved}** of ${nByTag.size}`);
    if (armDeltas.length > 0) {
      const abs = armDeltas.map(Math.abs);
      L.push(`- |delta| range: ${Math.min(...abs).toFixed(3)}s .. ${Math.max(...abs).toFixed(3)}s`);
    }
    L.push('');

    // ---- (b) R.5 census, all three corpora --------------------------------
    L.push('## (b) R.5 unscripted-run census');
    L.push('');
    L.push('| corpus | runs | total excised audio (s) | % of corpus | spans |');
    L.push('|---|---|---|---|---|');
    const r5: Record<string, unknown> = {};
    for (const key of ['v6', '173', 'spanish'] as const) {
      const spec = CORPORA[key]!;
      const r = key === 'v6' ? native : await runProductionPath(spec);
      const runs = r.r5runs;
      const total = runs.reduce((acc, u) => acc + (u.endSec - u.startSec), 0);
      const spans = runs.map(u => `${u.startSec.toFixed(2)}-${u.endSec.toFixed(2)}`).join(', ') || '(none)';
      L.push(`| ${key} | **${runs.length}** | ${total.toFixed(2)} | ${(100 * total / spec.audioDuration).toFixed(2)}% | ${spans} |`);
      r5[key] = {
        count: runs.length, totalSec: +total.toFixed(3), audioDuration: spec.audioDuration,
        runs: runs.map(u => ({
          tokenLo: u.tokenLo, tokenHi: u.tokenHi, startSec: u.startSec, endSec: u.endSec,
          durationSec: +(u.endSec - u.startSec).toFixed(3), qiSplit: u.qiSplit,
        })),
      };
    }
    L.push('');

    // ---- (c) `102_frozen_scouts` at full precision -------------------------
    // The arm hypothesis is refuted above (both arms give the same value), so
    // the remaining candidates are rounding and drift. These are separable:
    // a ROUNDING cause requires the underlying quantity to sit within a
    // half-ulp of the 0.01 grid line between 306.42 and 306.43 (i.e. near
    // 306.425); a DRIFT cause does not.
    const idx102 = native.committed.findIndex(s => tagOf(s) === '102_frozen_scouts');
    const seg102 = native.committed[idx102];
    const pre102 = native.preRuleSegments.find(s => s.id === seg102?.id);
    const align102 = native.keptAlignments[idx102];
    const firstTok = align102 ? native.usableFaTokens[align102.firstTokenIdx] : undefined;
    const prevAlign = idx102 > 0 ? native.keptAlignments[idx102 - 1] : undefined;
    const prevTok = prevAlign ? native.usableFaTokens[prevAlign.lastTokenIdx] : undefined;
    const nearSil = native.silences.filter(s => s.endSec > 304 && s.startSec < 309);

    L.push('## (c) `102_frozen_scouts` at full precision');
    L.push('');
    L.push(`- committed (native arm): \`${seg102?.startTime}\``);
    L.push(`- pre-rule-stage value:   \`${pre102?.startTime}\``);
    L.push(`- export value:           \`306.42\`  (delta ${(306.42 - (seg102?.startTime ?? NaN)).toFixed(6)})`);
    L.push(`- distance to the 0.01 grid line at 306.425: \`${Math.abs((seg102?.startTime ?? NaN) - 306.425).toFixed(6)}\``);
    L.push(`- incoming first FA token: ${firstTok ? `\`${firstTok.text}\` [${firstTok.startSec}, ${firstTok.endSec}]` : 'n/a'}`);
    L.push(`- outgoing last FA token:  ${prevTok ? `\`${prevTok.text}\` [${prevTok.startSec}, ${prevTok.endSec}]` : 'n/a'}`);
    L.push(`- silences in [304, 309]: ${nearSil.map(s => `[${s.startSec}, ${s.endSec}] mid=${((s.startSec + s.endSec) / 2).toFixed(6)}`).join(', ') || '(none)'}`);
    L.push(`- moved by a rule this run? ${seg102 && pre102 ? (Math.abs(seg102.startTime - pre102.startTime) > 1e-9 ? 'YES' : 'no') : 'n/a'}`);
    L.push('');

    json.frozenScouts102 = {
      committed: seg102?.startTime, preRule: pre102?.startTime, exportValue: 306.42,
      distanceToGridLine: Math.abs((seg102?.startTime ?? NaN) - 306.425),
      firstToken: firstTok, prevToken: prevTok,
      nearbySilences: nearSil,
    };
    json.armProbe = { rows: armRows, movedBetweenArms: armMoved, compared: nByTag.size, deltas: armDeltas };
    json.r5 = r5;
    writeFileSync(resolve(OUT, 'step0-forensics.md'), `${L.join('\n')}\n`);
    writeFileSync(resolve(OUT, 'step0-forensics.json'), JSON.stringify(json, null, 2));
    // eslint-disable-next-line no-console
    console.log(L.join('\n'));
  }, 600_000);
});
