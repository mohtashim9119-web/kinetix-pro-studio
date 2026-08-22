/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */
// WS1 Session AC — Step 1: register drift audit. Read-only measurement over
// the SAME `runProductionPath` harness `ws1-session-q-production-pins.test.ts`
// pins against (App.tsx's own rule order/arguments, over the run-id-stamped
// live bundle). Prints today's committed value for every one of the
// seventeen rows under audit: the eight open Class A/B rows, the seven
// Session V closures, and the two historical R.11 members
// (152_frozen_brush_mice on v6, abysmal_opinion on 173).
//
// MEASUREMENT — not part of the default `npm test` sweep.
// WS1_SESSION_AC_MEASURE=1.

import { describe, it } from 'vitest';
import { writeFileSync, mkdirSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { CORPORA, runProductionPath, tagOf } from './ws1-session-p-pipeline.js';

const MEASURE = process.env.WS1_SESSION_AC_MEASURE === '1';
const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = resolve(REPO, '.work-phase4', 'session-ac');

const V6_TAGS = [
  // 8 open Class A/B
  '214_solitary_fire', '231_slowing_pace', '447_scout_facing_dark',
  '056_dropping_torch', '167_smell_of_butchery', '286_fact_to_act',
  '400_endless_dark', '403_vigilant_embers',
  // 7 Session V closures
  '042_eleven_years', '176_twenty_six_scout', '224_thirty_three',
  '307_forty_nine_years', '340_fifty_eight', '383_sixty_four', '266_forty_one_burden',
  // 1 historical R.11 member (v6)
  '152_frozen_brush_mice',
];

describe.skipIf(!MEASURE)('WS1 Session AC — register drift probe (v6/173)', () => {
  it('writes committed values for all seventeen audited rows', async () => {
    mkdirSync(OUT, { recursive: true });
    const v6 = await runProductionPath(CORPORA.v6!);
    const v6Rows: Record<string, number | null> = {};
    const v6Text: Record<string, { prevTag: string | null; prevText: string | null; ownText: string | null }> = {};
    for (const tag of V6_TAGS) {
      const idx = v6.committed.findIndex(s => tagOf(s) === tag);
      const seg = idx >= 0 ? v6.committed[idx] : undefined;
      v6Rows[tag] = seg ? seg.startTime : null;
      const prev = idx > 0 ? v6.committed[idx - 1] : undefined;
      v6Text[tag] = {
        prevTag: prev ? tagOf(prev) : null,
        prevText: prev ? (prev.text ?? null) : null,
        ownText: seg ? (seg.text ?? null) : null,
      };
    }

    const c173 = await runProductionPath(CORPORA['173']!);
    const seg173 = c173.committed.find(s => tagOf(s) === 'abysmal_opinion');

    writeFileSync(resolve(OUT, 'drift-probe.json'), JSON.stringify({
      v6: {
        runId: v6.runId, fired: v6.fired,
        committedCount: v6.committed.length, kept: v6.kept, skipped: v6.skipped, aborted: v6.aborted,
        rows: v6Rows, text: v6Text,
      },
      c173: {
        runId: c173.runId, fired: c173.fired,
        abysmal_opinion: seg173 ? seg173.startTime : null,
      },
    }, null, 2));
  }, 300_000);
});
