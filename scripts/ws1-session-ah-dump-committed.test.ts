/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// ---------------------------------------------------------------------------
// WS1 Session AH — committed-boundary dumper, for the HEAD-vs-worktree fidelity
// check. Writes one line per committed segment (tag + startTime, 6dp) so the
// two trees can be compared with `diff`, not with a claim.
//
// Gated: WS1_SESSION_AH_DUMP=<path> npx vitest run scripts/ws1-session-ah-dump-committed.test.ts
// ---------------------------------------------------------------------------

import { describe, it } from 'vitest';
import { writeFileSync, mkdirSync } from 'fs';
import { dirname } from 'path';

import { CORPORA, runProductionPath, tagOf } from './ws1-session-p-pipeline.js';

const DEST = process.env.WS1_SESSION_AH_DUMP;

describe.skipIf(!DEST)('WS1 Session AH — dump committed boundaries', () => {
  it('dumps all three corpora', async () => {
    const L: string[] = [];
    for (const key of ['v6', '173', 'spanish'] as const) {
      const run = await runProductionPath(CORPORA[key]!);
      L.push(`## ${key} committed=${run.committed.length} chunks=${run.chunks.length} fired=${JSON.stringify(run.fired)}`);
      for (const s of run.committed) L.push(`${key}\t${tagOf(s)}\t${s.startTime.toFixed(6)}\t${s.duration.toFixed(6)}`);
    }
    mkdirSync(dirname(DEST!), { recursive: true });
    writeFileSync(DEST!, L.join('\n') + '\n');
    console.log(`wrote ${L.length} lines to ${DEST}`);
  }, 900_000);
});
