/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// ---------------------------------------------------------------------------
// WS1 Session AM — STEP 2. THE SUBSTITUTION SURFACE, MEASURED BEFORE ANY FA RUN.
//
// Arm F replaces the estimate-derived seam time at each chunk edge with a
// `faAnchors.ts` three-source-agreement anchor time, selected in SCRIPT-WORD
// INDEX space. Before a single second of audio is aligned this test answers,
// with numbers rather than expectation:
//
//   1. How many anchors v6 has at all, and how many carry three-source
//      agreement — answered from the code path, not assumed.
//   2. For EVERY sentence-group end the planner can break at: does an
//      admissible anchor exist, and what is the distribution of
//      |anchor - estimate| in ms (min/p25/median/p75/max)?
//   3. COVERAGE AND FALLBACK RATE over the edges arm F will actually place,
//      with the fallback rule stated. If fallback exceeds one third, arm F is a
//      PARTIAL substitution and its result cannot fully answer the question —
//      said plainly, per the pre-registered `ARM_F_FALLBACK_PARTIAL_ABOVE`.
//   4. THE CONFOUND CHECK: is the anchor set front-loaded or uniform along the
//      timeline? A front-loaded anchor set would produce an arch BY ITSELF and
//      would make a surviving arch uninterpretable.
//
// The tolerance is IMPORTED from the Step 1 gate, which was committed as its
// own SHA before this file existed — it is not chosen here and cannot be.
//
// Gated: WS1_SESSION_AM_MEASURE=1 npx vitest run scripts/ws1-session-am-step2-surface.test.ts
// ---------------------------------------------------------------------------

import { describe, it, expect } from 'vitest';
import { writeFileSync, readFileSync, mkdirSync } from 'fs';
import { resolve } from 'path';

import { CORPORA, REPO, loadLiveBundle } from './ws1-session-p-pipeline.js';
import { parseProjectData } from '../src/App';
import { applyAnchorBasedTiming } from '../src/services/syncEngine';
import { computeS2SeamSurface, computeFaChunkPlanS2Excised, computeUnscriptedRuns } from '../src/services/faChunkPlan';
import type { S2SeamSurfaceRow } from '../src/services/faChunkPlan';
import {
  ARM_F_TOLERANCE, ARM_F_FALLBACK_PARTIAL_ABOVE, ANCHOR_UNIFORMITY_MIN_DECILE_FRACTION,
  AM_TARGET_MIN_SEC, AM_TARGET_MAX_SEC, AL_V6_CHUNK_COUNT,
} from './ws1-session-am-step1-gate.js';

const MEASURE = process.env.WS1_SESSION_AM_MEASURE === '1';
const OUT = resolve(REPO, '.work-phase4/session-am');
const DOCS = resolve(REPO, 'docs/ws1-sync-pipeline');

const quantiles = (xs: readonly number[]): Record<string, number> => {
  if (xs.length === 0) return { n: 0 };
  const s = [...xs].sort((a, b) => a - b);
  const q = (p: number): number => s[Math.min(s.length - 1, Math.floor(s.length * p))]!;
  return {
    n: s.length,
    min: +s[0]!.toFixed(1),
    p25: +q(0.25).toFixed(1),
    median: +q(0.5).toFixed(1),
    p75: +q(0.75).toFixed(1),
    max: +s[s.length - 1]!.toFixed(1),
    mean: +(s.reduce((a, b) => a + b, 0) / s.length).toFixed(1),
  };
};

describe.skipIf(!MEASURE)('WS1 Session AM Step 2 — the anchor substitution surface (v6, no FA)', () => {
  it('measures anchor coverage, the fallback rate, and the front-loading confound', async () => {
    mkdirSync(OUT, { recursive: true });
    const spec = CORPORA.v6!;
    const { silences, whisperTokens } = loadLiveBundle('v6');
    const segsRaw = await parseProjectData(
      readFileSync(spec.scriptPath, 'utf-8'), readFileSync(spec.sceneDetailsPath, 'utf-8'), [], spec.audioDuration,
    );
    const anchorTimed = applyAnchorBasedTiming(segsRaw, spec.audioDuration);

    const surface = computeS2SeamSurface(anchorTimed, whisperTokens, silences, spec.audioDuration);
    const runs = computeUnscriptedRuns(anchorTimed, whisperTokens, silences, spec.audioDuration);

    // Arm C's own plan, so the EDGES ARM F WILL ACTUALLY PLACE are counted
    // against the real chunk set rather than against all group ends. The two
    // denominators differ by an order of magnitude and conflating them would
    // flatter the coverage number badly.
    const armC = computeFaChunkPlanS2Excised(
      anchorTimed, whisperTokens, silences, spec.audioDuration, AM_TARGET_MIN_SEC, AM_TARGET_MAX_SEC,
    );
    expect(armC.chunks.length, 'arm C must still reproduce its measured chunk count at HEAD')
      .toBe(AL_V6_CHUNK_COUNT.C);

    // ---- 1. THE ANCHOR SET -------------------------------------------------
    const anchors = surface.anchors;
    const anchorQis = anchors.map(a => a.qi);
    const strictlyAscending = anchorQis.every((q, i) => i === 0 || q > anchorQis[i - 1]!);
    const nonDescending = anchorQis.every((q, i) => i === 0 || q >= anchorQis[i - 1]!);
    const timesNonDescending = anchors.every((a, i) => i === 0 || a.timeSec >= anchors[i - 1]!.timeSec);

    // ---- 2. PER-GROUP-END COVERAGE ----------------------------------------
    const rows = surface.rows;
    const withAnchor = rows.filter(r => r.pick !== undefined);
    const exact = withAnchor.filter(r => r.pick!.deltaQi === 0);
    const deltaQis = withAnchor.map(r => Math.abs(r.pick!.deltaQi));
    const absMs = withAnchor.map(r => Math.abs(r.anchorMinusIdealSec!) * 1000);
    const signedMs = withAnchor.map(r => r.anchorMinusIdealSec! * 1000);
    // The same distance for arm C's OWN rule, so the two are comparable rather
    // than one being reported in a vacuum.
    const silenceAbsMs = rows.filter(r => r.silenceOffsetSec !== undefined)
      .map(r => Math.abs(r.silenceOffsetSec!) * 1000);

    // ---- 3. THE EDGES ARM F WILL ACTUALLY PLACE ---------------------------
    // An arm-C chunk edge is one of four kinds. Only the SILENCE-CUT kind is
    // substitutable; the rest are not estimate-derived at all and arm F leaves
    // them exactly as arm C has them.
    const groupsPerChunkEnd: Array<{ chunkIdx: number; lastSegIdx: number }> = [];
    {
      // Recover each arm-C chunk's closing segment by walking the plan text
      // lengths against the segment array — the plan carries text, not indices.
      let segCursor = 0;
      for (let ci = 0; ci < armC.chunks.length; ci++) {
        const words = armC.chunks[ci]!.text.split(/\s+/).filter(w => w.length > 0).length;
        let acc = 0;
        const from = segCursor;
        while (segCursor < anchorTimed.length && acc < words) {
          acc += (anchorTimed[segCursor]!.text ?? '').split(/\s+/).filter(w => w.length > 0).length;
          segCursor++;
        }
        expect(segCursor, `chunk ${ci} text must consume at least one segment (from ${from})`).toBeGreaterThan(from);
        groupsPerChunkEnd.push({ chunkIdx: ci, lastSegIdx: segCursor - 1 });
      }
      expect(segCursor, 'arm C\'s plan text must consume every v6 segment exactly once').toBe(anchorTimed.length);
    }
    const rowBySeg = new Map(rows.map(r => [r.lastSegIdx, r]));
    const runStarts = new Set(runs.map(u => +u.startSec.toFixed(6)));
    interface EdgeClass { chunkIdx: number; lastSegIdx: number; kind: string; hasAnchor: boolean; deltaQi?: number; deltaMs?: number }
    const edges: EdgeClass[] = [];
    for (let ci = 0; ci < armC.chunks.length - 1; ci++) {
      const endSec = +armC.chunks[ci]!.endSec.toFixed(6);
      const seg = groupsPerChunkEnd[ci]!.lastSegIdx;
      const r = rowBySeg.get(seg);
      const kind = runStarts.has(endSec) ? 'excision-run-edge'
        : r === undefined ? 'not-a-group-end'
          : 'silence-cut';
      edges.push({
        chunkIdx: ci, lastSegIdx: seg, kind,
        hasAnchor: kind === 'silence-cut' && r?.pick !== undefined,
        deltaQi: r?.pick?.deltaQi,
        deltaMs: r?.anchorMinusIdealSec === undefined ? undefined : +(r.anchorMinusIdealSec * 1000).toFixed(1),
      });
    }
    const substitutable = edges.filter(e => e.kind === 'silence-cut');
    const substituted = substitutable.filter(e => e.hasAnchor);
    const fellBack = substitutable.filter(e => !e.hasAnchor);
    // The honest denominator is EVERY internal edge, substitutable or not: an
    // excision-run edge is an edge arm F does not move either.
    const fallbackRateOverInternal = edges.length === 0 ? 0 : (edges.length - substituted.length) / edges.length;
    const fallbackRateOverSubstitutable = substitutable.length === 0 ? 0 : fellBack.length / substitutable.length;
    const isPartial = fallbackRateOverInternal > ARM_F_FALLBACK_PARTIAL_ABOVE;

    // ---- 4. THE FRONT-LOADING CONFOUND ------------------------------------
    const decileOf = (t: number): number => Math.min(9, Math.floor(10 * t / spec.audioDuration));
    const anchorsPerDecile = Array.from({ length: 10 }, () => 0);
    for (const a of anchors) anchorsPerDecile[decileOf(a.timeSec)]!++;
    const meanPerDecile = anchors.length / 10;
    const thinDeciles = anchorsPerDecile
      .map((n, d) => ({ d, n }))
      .filter(x => x.n < meanPerDecile * ANCHOR_UNIFORMITY_MIN_DECILE_FRACTION);
    const uniform = thinDeciles.length === 0;
    // Group ends per decile too — an anchor count that merely follows the
    // corpus's own sentence density is not front-loaded in any meaningful sense.
    const groupEndsPerDecile = Array.from({ length: 10 }, () => 0);
    for (const r of rows) groupEndsPerDecile[decileOf(r.idealSec)]!++;
    const coveredPerDecile = Array.from({ length: 10 }, () => 0);
    for (const r of withAnchor) coveredPerDecile[decileOf(r.idealSec)]!++;

    // =================== THE REPORT ========================================
    const L: string[] = [];
    L.push('# WS1 Session AM Step 2 — the anchor substitution surface (MEASURED, v6, no FA run)');
    L.push('');
    L.push('Computed at HEAD from `computeS2SeamSurface`, which reuses `computeRunContext` unchanged — so');
    L.push('every anchor below is bit-for-bit the anchor production\'s own `runQiRanges` would use. No audio');
    L.push('was aligned to produce this table.');
    L.push('');
    L.push('## The tolerance, imported from the Step 1 gate (committed as its own SHA before this file existed)');
    L.push('');
    L.push('```json');
    L.push(JSON.stringify(ARM_F_TOLERANCE, null, 2));
    L.push('```');
    L.push('');
    L.push(`**Label: ${ARM_F_TOLERANCE.label}.** It carries ${ARM_F_TOLERANCE.numericConstants} numeric constants,`);
    L.push('so there is nothing in it that could have been fitted to a corpus row.');
    L.push('');

    L.push('## 1. The anchor set');
    L.push('');
    L.push('| quantity | value |');
    L.push('|---|---|');
    L.push(`| total anchors \`faAnchors.ts\` emits for v6 | **${anchors.length}** |`);
    L.push(`| of those, carrying THREE-SOURCE AGREEMENT | **${surface.threeSourceAnchors}** |`);
    L.push(`| script words (\`totalQi\`) | ${surface.totalQi} |`);
    L.push(`| sentence groups | ${surface.groupCount} |`);
    L.push(`| group ends a chunk edge may fall at | ${rows.length} |`);
    L.push(`| anchor qi strictly ascending | ${strictlyAscending} |`);
    L.push(`| anchor qi non-descending | ${nonDescending} |`);
    L.push(`| anchor times non-descending | ${timesNonDescending} |`);
    L.push('');
    L.push(`Run-partition boundary provenance census: \`${JSON.stringify(surface.runBoundaryProvenance)}\`. A`);
    L.push('`forced-split-*` boundary is NOT an anchor and is never counted as one.');
    L.push('');
    L.push('**Why the two anchor counts are equal is a code-path fact, not a coincidence.** `computeAnchors`');
    L.push('emits an anchor only when all three sources agree: the Hirschberg op is a `match` (script agrees');
    L.push('with the Whisper token), the token is R-O-distinctive inside a match run of at least');
    L.push('`RUN_SURVIVAL_MIN_RUN_LONG`, AND a detected silence spans the token seam immediately before it');
    L.push('(R.1(c) + I6). There is no weaker-provenance anchor in the array to filter out — so');
    L.push('"how many carry three-source agreement" is answered by construction.');
    L.push('');

    L.push('## 2. Per-group-end coverage — every seam the planner may break at');
    L.push('');
    L.push('| quantity | value |');
    L.push('|---|---|');
    L.push(`| group ends examined | ${rows.length} |`);
    L.push(`| with an ADMISSIBLE anchor (inside the two-group window) | **${withAnchor.length}** (${(100 * withAnchor.length / rows.length).toFixed(1)}%) |`);
    L.push(`| of those, an EXACT hit (Δqi = 0 — the anchor IS the seam) | **${exact.length}** (${(100 * exact.length / rows.length).toFixed(1)}% of all group ends) |`);
    L.push(`| with NO admissible anchor | ${rows.length - withAnchor.length} |`);
    L.push('');
    L.push('### |anchor − estimate| at the covered group ends, in milliseconds');
    L.push('');
    L.push('REPORTED ONLY. This quantity is never a decision input — arm F selects by |Δqi|, never by this.');
    L.push('It is here to size how far the substitution actually moves an edge.');
    L.push('');
    L.push('| distribution | n | min | p25 | median | p75 | max | mean |');
    L.push('|---|---|---|---|---|---|---|---|');
    const qa = quantiles(absMs), qs = quantiles(signedMs.map(Math.abs)), qc = quantiles(silenceAbsMs);
    L.push(`| \`|anchor − estimate|\` (ms) | ${qa.n} | ${qa.min} | ${qa.p25} | **${qa.median}** | ${qa.p75} | ${qa.max} | ${qa.mean} |`);
    L.push(`| \`|arm C silence cut − estimate|\` (ms), same seams | ${qc.n} | ${qc.min} | ${qc.p25} | **${qc.median}** | ${qc.p75} | ${qc.max} | ${qc.mean} |`);
    L.push('');
    L.push(`Signed \`anchor − estimate\`: ${signedMs.filter(x => x < 0).length} negative, `
      + `${signedMs.filter(x => x > 0).length} positive, ${signedMs.filter(x => x === 0).length} exactly zero.`);
    L.push(`Index distance \`|Δqi|\`: \`${JSON.stringify(quantiles(deltaQis))}\`.`);
    L.push('');

    L.push('## 3. Coverage and fallback over the edges ARM F WILL ACTUALLY PLACE');
    L.push('');
    L.push('The denominator that matters is arm C\'s own internal chunk edges, not all group ends — arm C');
    L.push(`emits ${armC.chunks.length} chunks and therefore ${edges.length} internal edges, against ${rows.length} group ends.`);
    L.push('Conflating the two would flatter the coverage number by an order of magnitude.');
    L.push('');
    L.push('| edge kind | count | substituted by arm F? |');
    L.push('|---|---|---|');
    const byKind: Record<string, number> = {};
    for (const e of edges) byKind[e.kind] = (byKind[e.kind] ?? 0) + 1;
    for (const [k, v] of Object.entries(byKind)) {
      L.push(`| \`${k}\` | ${v} | ${k === 'silence-cut' ? 'yes, where an admissible anchor exists' : 'NO — not estimate-derived; left exactly as arm C places it'} |`);
    }
    L.push('');
    L.push('| quantity | value |');
    L.push('|---|---|');
    L.push(`| internal chunk edges | ${edges.length} |`);
    L.push(`| substitutable (estimate-derived silence cuts) | ${substitutable.length} |`);
    L.push(`| **actually substituted with an anchor** | **${substituted.length}** |`);
    L.push(`| fell back to arm C's silence cut | ${fellBack.length} |`);
    L.push(`| **fallback rate over ALL internal edges** | **${(100 * fallbackRateOverInternal).toFixed(1)}%** |`);
    L.push(`| fallback rate over substitutable edges only | ${(100 * fallbackRateOverSubstitutable).toFixed(1)}% |`);
    L.push('');
    L.push('**THE FALLBACK RULE, stated:** where no anchor is admissible for a seam, arm F commits ARM C\'s');
    L.push('OWN cut — `s2NearestSilenceCut` against the estimate-derived ideal seam. That edge is therefore');
    L.push('not substituted at all and remains an arm-C edge. Nothing is invented and nothing is dropped.');
    L.push('');
    L.push(`**PARTIAL-SUBSTITUTION VERDICT, against the pre-registered one-third line: ${isPartial ? '**ARM F IS A PARTIAL SUBSTITUTION**' : 'arm F is NOT a partial substitution'}.**`);
    if (isPartial) {
      L.push('');
      L.push(`Said plainly, as the gate requires: ${(100 * fallbackRateOverInternal).toFixed(1)}% of arm F's internal edges are NOT`);
      L.push('anchor-placed, which is above the one-third line fixed in Step 1. **Arm F\'s result cannot fully');
      L.push('answer the question this session asks.** A surviving arch could be produced by the un-substituted');
      L.push('edges alone, and arm F on its own cannot separate that from a genuine refutation — which is');
      L.push('exactly why arm G exists and why the gate registered the arm-F falsifier with a two-thirds');
      L.push('substitution precondition attached.');
    }
    L.push('');

    L.push('## 4. The front-loading confound');
    L.push('');
    L.push('Registered in Step 1 before the anchor set was looked at: a FRONT-LOADED anchor set — dense');
    L.push('early, sparse mid-corpus — would produce an arch BY ITSELF out of its own fallback pattern, and');
    L.push('would make a surviving arch uninterpretable. It is a confound, not a fix.');
    L.push('');
    L.push('| decile | anchors | group ends | group ends with an anchor | coverage |');
    L.push('|---|---|---|---|---|');
    for (let d = 0; d < 10; d++) {
      const cov = groupEndsPerDecile[d]! === 0 ? '—' : `${(100 * coveredPerDecile[d]! / groupEndsPerDecile[d]!).toFixed(1)}%`;
      L.push(`| ${d} | ${anchorsPerDecile[d]} | ${groupEndsPerDecile[d]} | ${coveredPerDecile[d]} | ${cov} |`);
    }
    L.push('');
    L.push(`Mean anchors per decile: ${meanPerDecile.toFixed(1)}. Uniformity threshold (pre-registered): every`);
    L.push(`decile must hold at least ${100 * ANCHOR_UNIFORMITY_MIN_DECILE_FRACTION}% of the mean.`);
    L.push('');
    L.push(`**VERDICT: the anchor set is ${uniform ? 'UNIFORM' : 'FRONT-LOADED'} along the timeline.**`
      + (uniform ? ' No decile falls below the threshold, so the anchor set cannot manufacture an arch of its own.'
        : ` Thin deciles: ${thinDeciles.map(t => `${t.d} (${t.n})`).join(', ')}. This is a CONFOUND and every arm-F`
          + ' conclusion below is qualified by it.'));
    L.push('');

    L.push('## Appendix — every substitutable internal edge, with its pick');
    L.push('');
    L.push('| chunk | closing seg | edge kind | anchor? | Δqi | anchor − estimate (ms) |');
    L.push('|---|---|---|---|---|---|');
    for (const e of edges) {
      L.push(`| ${e.chunkIdx} | ${e.lastSegIdx} | \`${e.kind}\` | ${e.hasAnchor ? 'YES' : 'no'} `
        + `| ${e.deltaQi ?? '—'} | ${e.deltaMs ?? '—'} |`);
    }
    L.push('');

    const text = `${L.join('\n')}\n`;
    writeFileSync(resolve(OUT, 'step2-surface.md'), text);
    writeFileSync(resolve(DOCS, 'session-am-substitution-surface.md'), text);

    const json = {
      anchors: { total: anchors.length, threeSource: surface.threeSourceAnchors, strictlyAscending, nonDescending, timesNonDescending },
      totalQi: surface.totalQi,
      groupCount: surface.groupCount,
      groupEnds: rows.length,
      runBoundaryProvenance: surface.runBoundaryProvenance,
      coverage: {
        withAnchor: withAnchor.length, exactHits: exact.length, none: rows.length - withAnchor.length,
        absMs: qa, signedAbsMs: qs, silenceAbsMs: qc, deltaQi: quantiles(deltaQis),
        signedNegative: signedMs.filter(x => x < 0).length,
        signedPositive: signedMs.filter(x => x > 0).length,
        signedZero: signedMs.filter(x => x === 0).length,
      },
      armCEdges: {
        chunks: armC.chunks.length, internalEdges: edges.length, byKind,
        substitutable: substitutable.length, substituted: substituted.length, fellBack: fellBack.length,
        fallbackRateOverInternal: +fallbackRateOverInternal.toFixed(4),
        fallbackRateOverSubstitutable: +fallbackRateOverSubstitutable.toFixed(4),
        isPartialSubstitution: isPartial,
        edges,
      },
      frontLoading: { anchorsPerDecile, groupEndsPerDecile, coveredPerDecile, meanPerDecile: +meanPerDecile.toFixed(2), thinDeciles, uniform },
      rows: rows.map((r: S2SeamSurfaceRow) => ({
        groupIdx: r.groupIdx, lastSegIdx: r.lastSegIdx, seamQi: r.seamQi,
        idealSec: +r.idealSec.toFixed(4), silenceCutSec: r.silenceCutSec === undefined ? null : +r.silenceCutSec.toFixed(4),
        anchorQi: r.pick?.qi ?? null, anchorTimeSec: r.pick === undefined ? null : +r.pick.timeSec.toFixed(4),
        deltaQi: r.pick?.deltaQi ?? null,
        anchorMinusIdealMs: r.anchorMinusIdealSec === undefined ? null : +(r.anchorMinusIdealSec * 1000).toFixed(1),
      })),
    };
    writeFileSync(resolve(OUT, 'step2-surface.json'), JSON.stringify(json, null, 2));

    // eslint-disable-next-line no-console
    console.log(L.join('\n'));
  }, 300_000);
});
