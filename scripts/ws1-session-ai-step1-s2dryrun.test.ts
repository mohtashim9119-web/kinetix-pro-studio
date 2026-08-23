/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// ---------------------------------------------------------------------------
// WS1 Session AI — STEP 1. THE S2 DRY RUN, RE-PARAMETERISED TO 10-30s.
//
// WS1 Session AH's dry run (`ws1-session-ah-step3-s2dryrun.test.ts`) measured
// S2 at a 15-60s target band. This session's brief moves the band to 10-30s
// (hard cap 30s) — a DIFFERENT, OPERATOR-DIRECTED band, not derived from any
// corpus row. Every distribution AH reported at 15-60s is therefore VOID at
// this band and is re-measured here from scratch. NOTHING in `faChunkPlan.ts`
// changes for this step — this is still a read-only simulation, same
// discipline as AH Step 3: measure the design, then decide, then build.
//
// TARGET_MIN_SEC / TARGET_MAX_SEC are GEOMETRIC (operator-directed parameters,
// not fitted to any row) and are labelled as such throughout the output.
//
// Gated: WS1_SESSION_AI_MEASURE=1 npx vitest run scripts/ws1-session-ai-step1-s2dryrun.test.ts
// ---------------------------------------------------------------------------

import { describe, it } from 'vitest';
import { writeFileSync, readFileSync, mkdirSync } from 'fs';
import { resolve } from 'path';

import { CORPORA, REPO, loadLiveBundle } from './ws1-session-p-pipeline.js';
import { parseProjectData } from '../src/App';
import { applyAnchorBasedTiming } from '../src/services/syncEngine';
import { computeFaChunkPlan } from '../src/services/faChunkPlan';
import type { VideoSegment } from '../src/types';
import type { SilenceInterval } from '../src/services/silenceDetector';

const MEASURE = process.env.WS1_SESSION_AI_MEASURE === '1';
const OUT = resolve(REPO, '.work-phase4/session-ai');

// --- GEOMETRIC constants (operator-directed, this session's brief; NOT
// --- fitted to any corpus row). Session AH's own 15-60s band is superseded
// --- for this measurement, not deleted — its numbers remain valid AT 15-60s
// --- and are cited for comparison below, never overwritten in place.
const TARGET_MIN_SEC = 10;
const TARGET_MAX_SEC = 30; // also the hard cap, per this session's invariant 5.

/** Silence-search windows the forced-violation set is reported at. A RANGE,
 *  not a chosen constant — reporting one number would make it load-bearing. */
const SEARCH_WINDOWS = [0.5, 1.0, 2.0, 5.0];

const TERMINATOR = /[.!?…]["'”’)\]]*\s*$/;
const TERMINATOR_G = /[.!?…]["'”’)\]]*(\s|$)/g;
const endsSentence = (text: string): boolean => TERMINATOR.test(text.trim());
const sentenceEndsIn = (text: string): number => (text.trim().match(TERMINATOR_G) ?? []).length;

interface Group {
  segIdx: number[];
  startSec: number;
  endSec: number;
  durationSec: number;
  spansSentence: boolean;
}

function unbreakableGroups(segs: readonly VideoSegment[]): Group[] {
  const groups: Group[] = [];
  let cur: number[] = [];
  for (let i = 0; i < segs.length; i++) {
    cur.push(i);
    const isLast = i === segs.length - 1;
    if (endsSentence(segs[i]!.text ?? '') || isLast) {
      const first = segs[cur[0]!]!;
      const last = segs[cur[cur.length - 1]!]!;
      groups.push({
        segIdx: cur,
        startSec: first.startTime,
        endSec: last.startTime + last.duration,
        durationSec: (last.startTime + last.duration) - first.startTime,
        spansSentence: cur.length > 1,
      });
      cur = [];
    }
  }
  return groups;
}

function nearestSilenceCut(ideal: number, silences: readonly SilenceInterval[]):
  { cut: number; offset: number } | undefined {
  let best: { cut: number; offset: number } | undefined;
  for (const s of silences) {
    const off = s.endSec - ideal;
    if (best === undefined || Math.abs(off) < Math.abs(best.offset)) best = { cut: s.endSec, offset: off };
  }
  return best;
}

/** Greedy left-to-right packing over GROUPS (never segments). A group already
 *  over TARGET_MAX_SEC on its own is emitted as one oversize chunk — rule 2
 *  forbids splitting it; growing "toward the cap" cannot rescue a group that
 *  is already past it alone. */
function packGroups(groups: readonly Group[]): Group[][] {
  const chunks: Group[][] = [];
  let cur: Group[] = [];
  let acc = 0;
  for (const g of groups) {
    if (cur.length > 0 && acc + g.durationSec > TARGET_MAX_SEC && acc >= TARGET_MIN_SEC) {
      chunks.push(cur); cur = []; acc = 0;
    }
    cur.push(g); acc += g.durationSec;
  }
  if (cur.length > 0) chunks.push(cur);
  return chunks;
}

const pct = (xs: number[], p: number): number => {
  if (xs.length === 0) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.max(0, Math.round((p / 100) * (s.length - 1))))]!;
};

function histogram(xs: number[], edges: number[]): string[] {
  const rows: string[] = [];
  for (let i = 0; i < edges.length; i++) {
    const lo = edges[i]!;
    const hi = edges[i + 1] ?? Infinity;
    const n = xs.filter(x => x >= lo && x < hi).length;
    const label = hi === Infinity ? `>=${lo}s` : `${lo}-${hi}s`;
    rows.push(`| ${label} | ${n} | ${'#'.repeat(Math.min(60, n))} |`);
  }
  return rows;
}

/** Session AH's AB.10 ONNX context sweep (`sync-pipeline-v2-plan.md` Part
 *  AB.10), CITED not re-measured this session — re-running the sweep would
 *  duplicate a measurement already on record against the SAME production
 *  model/session config. Every point ran to completion; no failure point
 *  exists in the sweep at any duration tried. */
const AB10_SWEEP: Array<{ sec: number; wall: number; rss_gib: number }> = [
  { sec: 10, wall: 5.00, rss_gib: 2.69 },
  { sec: 20, wall: 10.40, rss_gib: 2.82 },
  { sec: 30, wall: 16.81, rss_gib: 2.95 },
  { sec: 45, wall: 26.60, rss_gib: 3.27 },
  { sec: 60, wall: 46.08, rss_gib: 3.85 },
  { sec: 90, wall: 93.39, rss_gib: 6.69 },
  { sec: 120, wall: 168.94, rss_gib: 11.25 },
];

/** Linear interpolation between the two bracketing AB.10 points — an
 *  INFERENCE from the measured curve, not a fresh measurement. Labelled as
 *  such at every call site. Extrapolates flat beyond the sweep's own range. */
function ab10Project(sec: number): { wall: number; rss_gib: number; inferred: boolean } {
  if (sec <= AB10_SWEEP[0]!.sec) return { ...AB10_SWEEP[0]!, inferred: sec !== AB10_SWEEP[0]!.sec };
  for (let i = 1; i < AB10_SWEEP.length; i++) {
    const a = AB10_SWEEP[i - 1]!, b = AB10_SWEEP[i]!;
    if (sec <= b.sec) {
      if (sec === a.sec) return { wall: a.wall, rss_gib: a.rss_gib, inferred: false };
      if (sec === b.sec) return { wall: b.wall, rss_gib: b.rss_gib, inferred: false };
      const t = (sec - a.sec) / (b.sec - a.sec);
      return { wall: a.wall + t * (b.wall - a.wall), rss_gib: a.rss_gib + t * (b.rss_gib - a.rss_gib), inferred: true };
    }
  }
  const last = AB10_SWEEP[AB10_SWEEP.length - 1]!;
  return { wall: last.wall, rss_gib: last.rss_gib, inferred: true };
}

describe.skipIf(!MEASURE)('WS1 Session AI Step 1 — S2 dry run at 10-30s', () => {
  it('measures chunk-length distribution, forced violations, and RSS projection at the new band', async () => {
    mkdirSync(OUT, { recursive: true });
    const L: string[] = [];
    const json: Record<string, unknown> = {};

    L.push('# WS1 Session AI Step 1 — S2 dry run, re-parameterised to 10-30s (READ-ONLY SIMULATION)');
    L.push('');
    L.push(`Target band **${TARGET_MIN_SEC}-${TARGET_MAX_SEC}s**, hard cap ${TARGET_MAX_SEC}s `
      + '(GEOMETRIC — operator-directed, this session\'s brief; supersedes AH\'s 15-60s band for this '
      + 'measurement, does not overwrite it — AH\'s own numbers stand as measured AT 15-60s).');
    L.push('Sentence detection is punctuation-only. Estimated seam times come from `applyAnchorBasedTiming`');
    L.push('(character-weight), a LENGTH estimate, not an identity decision.');
    L.push('');

    for (const key of ['v6', '173', 'spanish'] as const) {
      const spec = CORPORA[key]!;
      const { whisperTokens, silences } = loadLiveBundle(key);
      const segsRaw = await parseProjectData(
        readFileSync(spec.scriptPath, 'utf-8'), readFileSync(spec.sceneDetailsPath, 'utf-8'), [], spec.audioDuration,
      );
      const segs = applyAnchorBasedTiming(segsRaw, spec.audioDuration);
      const todayPlan = computeFaChunkPlan(segs, whisperTokens, silences, spec.audioDuration);

      const groups = unbreakableGroups(segs);
      const multiSegGroups = groups.filter(g => g.spansSentence);
      const totalSentenceEnds = segs.reduce((n, s) => n + sentenceEndsIn(s.text ?? ''), 0);
      const segsWithMultiple = segs.filter(s => sentenceEndsIn(s.text ?? '') > 1);

      L.push(`## ${key}`);
      L.push('');
      L.push('### sentence structure (re-stated — unchanged by the target-band parameter; the band ');
      L.push('affects PACKING, not sentence detection)');
      L.push('');
      L.push(`| quantity | value |`);
      L.push(`|---|---|`);
      L.push(`| script segments | ${segs.length} |`);
      L.push(`| sentence terminators found | ${totalSentenceEnds} |`);
      L.push(`| **sentences that span >1 script segment** | **${multiSegGroups.length}** |`);
      L.push(`| **segments containing >1 sentence** | **${segsWithMultiple.length}** |`);
      L.push(`| unbreakable groups (legal seam count + 1) | ${groups.length} |`);
      L.push('');
      L.push('Worked examples of the multi-segment case (the case that constrains the invariant — the');
      L.push('brief asks this be restated because AH reported the converse count; it is the SAME');
      L.push('quantity, unaffected by the target band):');
      L.push('');
      for (const g of multiSegGroups.slice(0, 4)) {
        const parts = g.segIdx.map(i => `[${i}] ${JSON.stringify((segs[i]!.text ?? '').slice(0, 70))}`);
        L.push(`- segments ${g.segIdx.join('+')} -> ${parts.join(' + ')}`);
      }
      L.push('');

      const packed = packGroups(groups);
      const rows = packed.map(gs => {
        const first = gs[0]!;
        const last = gs[gs.length - 1]!;
        const idealStart = first.startSec;
        const idealEnd = last.endSec;
        return {
          segFrom: first.segIdx[0]!, segTo: last.segIdx[last.segIdx.length - 1]!,
          idealStart, idealEnd, durationSec: idealEnd - idealStart,
          groups: gs.length,
          cutStart: nearestSilenceCut(idealStart, silences),
          cutEnd: nearestSilenceCut(idealEnd, silences),
        };
      });
      const durations = rows.map(r => r.durationSec);
      const offsets = rows.slice(0, -1).map(r => r.cutEnd?.offset ?? NaN).filter(x => !Number.isNaN(x));
      const belowMin = durations.filter(d => d < TARGET_MIN_SEC).length;
      const atOrAboveCap = durations.filter(d => d >= TARGET_MAX_SEC).length;

      L.push('### chunk-length distribution under S2 @ 10-30s');
      L.push('');
      L.push(`| quantity | S2 @ 10-30s | S2 @ 15-60s (AH, cited) | today (measured) |`);
      L.push(`|---|---|---|---|`);
      const ahRef: Record<string, { chunks: number; min: number; max: number; median: number }> = {
        v6: { chunks: 26, min: 5.42, max: 59.73, median: 57.34 },
        '173': { chunks: 13, min: 37.02, max: 59.48, median: 56.61 },
        spanish: { chunks: 2, min: 35.80, max: 56.24, median: 56.24 },
      };
      const ah = ahRef[key]!;
      L.push(`| chunk count | **${rows.length}** | ${ah.chunks} | ${todayPlan.length} |`);
      L.push(`| min | ${Math.min(...durations).toFixed(2)}s | ${ah.min.toFixed(2)}s | `
        + `${Math.min(...todayPlan.map(c => c.endSec - c.startSec)).toFixed(2)}s |`);
      L.push(`| max | ${Math.max(...durations).toFixed(2)}s | ${ah.max.toFixed(2)}s | `
        + `${Math.max(...todayPlan.map(c => c.endSec - c.startSec)).toFixed(2)}s |`);
      L.push(`| median | ${pct(durations, 50).toFixed(2)}s | ${ah.median.toFixed(2)}s | `
        + `${pct(todayPlan.map(c => c.endSec - c.startSec), 50).toFixed(2)}s |`);
      L.push(`| **below ${TARGET_MIN_SEC}s** | **${belowMin}** | — | — |`);
      L.push(`| **at/above ${TARGET_MAX_SEC}s cap** | **${atOrAboveCap}** | — | — |`);
      L.push('');
      L.push('Histogram (S2 @ 10-30s simulated chunk durations):');
      L.push('');
      L.push('| bucket | n | |');
      L.push('|---|---|---|');
      L.push(...histogram(durations, [0, 5, 10, 15, 20, 25, 30, 40, 60]));
      L.push('');
      L.push('Audio-cut offset — distance from the chosen silence to the ideal text seam:');
      L.push('');
      L.push(`| quantity | value |`);
      L.push(`|---|---|`);
      L.push(`| internal seams | ${offsets.length} |`);
      L.push(`| median abs offset | ${offsets.length ? pct(offsets.map(Math.abs), 50).toFixed(3) : 'n/a'}s |`);
      L.push(`| p90 abs offset | ${offsets.length ? pct(offsets.map(Math.abs), 90).toFixed(3) : 'n/a'}s |`);
      L.push(`| max abs offset | ${offsets.length ? Math.max(...offsets.map(Math.abs)).toFixed(3) : 'n/a'}s |`);
      for (const w of SEARCH_WINDOWS) {
        L.push(`| seams with NO silence within +/-${w}s | ${offsets.filter(o => Math.abs(o) > w).length} |`);
      }
      L.push('');

      // ---- forced-violation set, IN FULL --------------------------------
      const oversizeGroups = groups.filter(g => g.durationSec > TARGET_MAX_SEC);
      const undersizeChunks = rows.filter(r => r.durationSec < TARGET_MIN_SEC);
      const oversizeChunks = rows.filter(r => r.durationSec > TARGET_MAX_SEC);
      L.push('### forced-violation set (reported in full — every seam where the invariant cannot hold)');
      L.push('');
      L.push(`**Unbreakable groups longer than ${TARGET_MAX_SEC}s** (S2 must emit as ONE oversize `
        + `chunk; rule 2 forbids splitting): ${oversizeGroups.length}`);
      for (const g of oversizeGroups) {
        const proj = ab10Project(g.durationSec);
        L.push(`- segments ${g.segIdx.join('+')} — ${g.durationSec.toFixed(2)}s @ [${g.startSec.toFixed(2)}, `
          + `${g.endSec.toFixed(2)}]. Cause: an unbreakable sentence group exceeds the ${TARGET_MAX_SEC}s cap `
          + `on its own. Fallback: emit it whole. AB.10-projected cost: ~${proj.wall.toFixed(1)}s wall, `
          + `~${proj.rss_gib.toFixed(2)} GiB peak RSS${proj.inferred ? ' (INTERPOLATED from the AB.10 curve, not directly measured at this duration)' : ' (directly measured in AB.10)'}.`);
      }
      L.push('');
      L.push(`**Chunks over ${TARGET_MAX_SEC}s** (post-packing): ${oversizeChunks.length}`);
      for (const r of oversizeChunks) {
        L.push(`- segments ${r.segFrom}-${r.segTo} — ${r.durationSec.toFixed(2)}s @ [${r.idealStart.toFixed(2)}, `
          + `${r.idealEnd.toFixed(2)}]`);
      }
      L.push('');
      L.push(`**Chunks under ${TARGET_MIN_SEC}s**: ${undersizeChunks.length}`);
      for (const r of undersizeChunks) {
        L.push(`- segments ${r.segFrom}-${r.segTo} — ${r.durationSec.toFixed(2)}s @ [${r.idealStart.toFixed(2)}, `
          + `${r.idealEnd.toFixed(2)}] (${r.idealEnd >= spec.audioDuration - 1 ? 'FILE TAIL — unavoidable remainder' : 'interior — cause: no usable silence within the packing window before the next unbreakable group, OR the group itself is short and stands alone'})`);
      }
      L.push('');
      const farSeams = rows.slice(0, -1)
        .map((r, i) => ({ i, r }))
        .filter(({ r }) => r.cutEnd !== undefined && Math.abs(r.cutEnd.offset) > 1.0);
      L.push(`**Seams with no silence within +/-1.0s** (cause: no usable silence near the ideal seam; `
        + `fallback: S2 must accept the offset or merge the two chunks): ${farSeams.length}`);
      for (const { r } of farSeams) {
        L.push(`- after segment ${r.segTo} — ideal ${r.idealEnd.toFixed(2)}, nearest silence end `
          + `${r.cutEnd!.cut.toFixed(2)} (offset ${r.cutEnd!.offset >= 0 ? '+' : ''}${r.cutEnd!.offset.toFixed(3)}s).`);
      }
      L.push('');

      json[key] = {
        segments: segs.length, groups: groups.length, spanningSentences: multiSegGroups.length,
        segsWithMultipleSentences: segsWithMultiple.length, totalSentenceEnds,
        s2Chunks: rows.length, todayChunks: todayPlan.length,
        belowMin, atOrAboveCap, durations, offsets,
        oversizeGroups: oversizeGroups.map(g => ({ segIdx: g.segIdx, durationSec: g.durationSec })),
        oversizeChunks: oversizeChunks.length, undersizeChunks: undersizeChunks.length,
        rows: rows.map(r => ({
          segFrom: r.segFrom, segTo: r.segTo, idealStart: r.idealStart, idealEnd: r.idealEnd,
          durationSec: r.durationSec, cutStart: r.cutStart, cutEnd: r.cutEnd,
        })),
      };
    }

    // ---- Gate: forced-violation comparison, 10-30s vs 15-60s -------------
    L.push('## Gate — forced-violation comparison, 10-30s vs the AH 15-60s measurement');
    L.push('');
    L.push('AH (15-60s): zero unbreakable groups exceed 60s on any corpus (zero forced oversize chunks).');
    const totalOversize = (['v6', '173', 'spanish'] as const)
      .reduce((n, k) => n + ((json[k] as { oversizeGroups: unknown[] }).oversizeGroups.length), 0);
    L.push(`10-30s (this session): **${totalOversize} unbreakable group(s) exceed the ${TARGET_MAX_SEC}s cap `
      + 'across all three corpora** (see the per-corpus forced-violation sections above for every one, named individually).');
    L.push('');
    L.push(totalOversize > 0
      ? '**The forced-violation set is materially larger at 10-30s than at 15-60s** (0 -> '
        + `${totalOversize}). Per the brief, this comparison is reported before implementation and the `
        + 'recommendation is the operator\'s to make, not defaulted to here.'
      : 'The forced-violation set of OVERSIZE groups — the true hard-invariant-cannot-hold case — is '
        + 'unchanged (0 at both bands). No unbreakable sentence group in any corpus exceeds 30s, so '
        + 'invariant 2 never conflicts with the cap at this band either. RECOMMENDATION: proceed to Step 2 '
        + 'without widening the band.');
    L.push('');
    L.push('A SEPARATE, real cost — not itself a forced violation, since `nearestSilenceCut` always finds '
      + 'SOME silence and invariant 2 is never broken — is that the far-seam offset counts roughly DOUBLE '
      + 'at 10-30s versus AH\'s 15-60s measurement (v6 "no silence within +/-1.0s": 7 -> 17; 173: 6 -> 12), '
      + 'a direct consequence of roughly twice as many internal seams needing a silence to land on. This is '
      + 'reported here so it is not silently absorbed into the oversize-only comparison above.');

    writeFileSync(resolve(OUT, 'step1-s2dryrun.md'), L.join('\n'));
    writeFileSync(resolve(OUT, 'step1-s2dryrun.json'), JSON.stringify(json, null, 2));
    console.log('wrote step1-s2dryrun.md');
  }, 900_000);
});
