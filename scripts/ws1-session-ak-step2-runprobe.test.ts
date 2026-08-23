/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// ---------------------------------------------------------------------------
// WS1 Session AK — STEP 2 DESIGN PROBE. Where do v6's ten R.5 runs actually
// sit relative to the structures S2 packs?
//
// This decides the excision integration rather than assuming it. S2 chunks
// WHOLE SEGMENTS grouped into unbreakable sentence groups; production's
// `exciseUnscriptedRuns` splits a chunk at a run using `qiSplit`, a SCRIPT-WORD
// index. If every run happens to fall between two sentence groups, excision in
// S2 is a chunk-edge operation and no text ever has to be split. If a run falls
// strictly inside a group's estimated span, the integration has to decide which
// side that group's text goes — and doing that from the run's TIMESTAMPS would
// violate S2's invariant 3.
//
// Reports, per run: the sentence group whose estimated span contains it (if
// any), the group seam it falls between (if any), and the gap between the
// bracketing segments.
//
// Gated: WS1_SESSION_AK_MEASURE=1 npx vitest run scripts/ws1-session-ak-step2-runprobe.test.ts
// ---------------------------------------------------------------------------

import { describe, it } from 'vitest';
import { writeFileSync, readFileSync, mkdirSync } from 'fs';
import { resolve } from 'path';

import { CORPORA, REPO, loadLiveBundle, tagOf } from './ws1-session-p-pipeline.js';
import { parseProjectData } from '../src/App';
import { applyAnchorBasedTiming } from '../src/services/syncEngine';
import { computeUnscriptedRuns } from '../src/services/faChunkPlan';
import type { VideoSegment } from '../src/types';

const MEASURE = process.env.WS1_SESSION_AK_MEASURE === '1';
const OUT = resolve(REPO, '.work-phase4/session-ak');

/** Mirrors `faChunkPlan.ts`'s own S2 terminator, so this probe groups exactly
 *  the way the planner does. Read-only duplication for a measurement — the
 *  planner's copy stays the source of truth. */
const TERM = /[.!?…]["'”’)\]]*\s*$/;
const endsSentence = (t: string | undefined): boolean => TERM.test((t ?? '').trim());

function groups(segments: readonly VideoSegment[]): Array<{ segIdx: number[]; startSec: number; endSec: number }> {
  const out: Array<{ segIdx: number[]; startSec: number; endSec: number }> = [];
  let cur: number[] = [];
  for (let i = 0; i < segments.length; i++) {
    cur.push(i);
    if (endsSentence(segments[i]!.text) || i === segments.length - 1) {
      const f = segments[cur[0]!]!;
      const l = segments[cur[cur.length - 1]!]!;
      out.push({ segIdx: cur, startSec: f.startTime, endSec: l.startTime + l.duration });
      cur = [];
    }
  }
  return out;
}

describe.skipIf(!MEASURE)('WS1 Session AK Step 2 design probe', () => {
  it('locates every R.5 run relative to S2 sentence groups', async () => {
    mkdirSync(OUT, { recursive: true });
    const L: string[] = ['# WS1 Session AK Step 2 design probe (MEASURED)', ''];
    const json: Record<string, unknown> = {};

    for (const key of ['v6', '173', 'spanish'] as const) {
      const spec = CORPORA[key]!;
      const { whisperTokens, silences } = loadLiveBundle(key);
      const segsRaw = await parseProjectData(
        readFileSync(spec.scriptPath, 'utf-8'), readFileSync(spec.sceneDetailsPath, 'utf-8'), [], spec.audioDuration,
      );
      const anchorTimed = applyAnchorBasedTiming(segsRaw, spec.audioDuration);
      const runs = computeUnscriptedRuns(anchorTimed, whisperTokens, silences, spec.audioDuration);
      const gs = groups(anchorTimed);

      L.push(`## ${key} — ${runs.length} run(s), ${gs.length} sentence group(s), ${anchorTimed.length} segments`);
      L.push('');
      if (runs.length === 0) {
        L.push('_No R.5 runs. Excision is a structural no-op on this corpus — it is a CONTROL._');
        L.push('');
        json[key] = { runs: 0, groups: gs.length, segments: anchorTimed.length, rows: [] };
        continue;
      }

      L.push('| # | run span | dur | inside group? | group span | group segs | falls at seam between groups |');
      L.push('|---|---|---|---|---|---|---|');
      const rows: Array<Record<string, unknown>> = [];
      runs.forEach((u, i) => {
        const inside = gs.findIndex(g => u.startSec >= g.startSec && u.endSec <= g.endSec);
        // The seam interpretation: the last group ENDING at or before the run's
        // start, and the first group STARTING at or after the run's end.
        let before = -1;
        for (let k = 0; k < gs.length; k++) if (gs[k]!.endSec <= u.startSec + 1e-9) before = k;
        let after = gs.length;
        for (let k = 0; k < gs.length; k++) if (gs[k]!.startSec >= u.endSec - 1e-9) { after = k; break; }
        const cleanSeam = before >= 0 && after === before + 1;
        const g = inside >= 0 ? gs[inside]! : undefined;
        L.push(`| ${i} | ${u.startSec.toFixed(2)}-${u.endSec.toFixed(2)} | ${(u.endSec - u.startSec).toFixed(2)}s `
          + `| ${inside >= 0 ? `**group ${inside}**` : 'no'} `
          + `| ${g ? `${g.startSec.toFixed(2)}-${g.endSec.toFixed(2)}` : '—'} `
          + `| ${g ? `${g.segIdx[0]}-${g.segIdx[g.segIdx.length - 1]}` : '—'} `
          + `| ${cleanSeam ? `**YES** (${before}|${after})` : `no (${before}|${after === gs.length ? 'end' : after})`} |`);
        rows.push({
          index: i, startSec: u.startSec, endSec: u.endSec, durationSec: +(u.endSec - u.startSec).toFixed(3),
          tokenLo: u.tokenLo, tokenHi: u.tokenHi, qiSplit: u.qiSplit,
          insideGroup: inside, groupBefore: before, groupAfter: after === gs.length ? null : after, cleanSeam,
          segTagBefore: before >= 0 ? tagOf(anchorTimed[gs[before]!.segIdx[gs[before]!.segIdx.length - 1]!]!) : null,
          segTagAfter: after < gs.length ? tagOf(anchorTimed[gs[after]!.segIdx[0]!]!) : null,
        });
      });
      L.push('');
      const clean = rows.filter(r => r.cleanSeam).length;
      const insideCount = rows.filter(r => (r.insideGroup as number) >= 0).length;
      L.push(`- runs landing cleanly BETWEEN two adjacent sentence groups: **${clean}/${runs.length}**`);
      L.push(`- runs landing strictly INSIDE one sentence group's estimated span: **${insideCount}/${runs.length}**`);
      L.push('');
      json[key] = { runs: runs.length, groups: gs.length, segments: anchorTimed.length, cleanSeam: clean, insideGroup: insideCount, rows };
    }

    writeFileSync(resolve(OUT, 'step2-runprobe.md'), `${L.join('\n')}\n`);
    writeFileSync(resolve(OUT, 'step2-runprobe.json'), JSON.stringify(json, null, 2));
    // eslint-disable-next-line no-console
    console.log(L.join('\n'));
  }, 300_000);
});
