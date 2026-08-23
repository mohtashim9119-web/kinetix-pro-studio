/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// ---------------------------------------------------------------------------
// WS1 Session AH — STEP 3. THE S2 DRY RUN. READ-ONLY SIMULATION.
//
// S1 (cleanup at the DETECTION layer) was rejected at ~7% detector precision.
// S2 is prevention at the PARTITION layer: make the bad partition
// unconstructible rather than detect it afterwards. Three rules, and none of
// them is a threshold:
//
//   1. A chunk's text is always a WHOLE NUMBER OF SCRIPT SEGMENTS, never a
//      fragment. (Today's planner cuts the raw token stream at qi-derived
//      indices, which is what puts half a phrase in a window.)
//   2. A chunk edge NEVER falls inside a sentence — including a sentence that
//      spans a segment seam. This is what makes rule 1 insufficient on its own:
//      173's segments 5/6 are "They're the worst" + "because the environment
//      was already doing the killing...", one sentence across two segments.
//   3. The TEXT partition is fixed by the script alone, BEFORE any audio
//      evidence is consulted. Only then is the audio cut placed, at the
//      detected silence nearest the chosen seam. Whisper timestamps are
//      excluded from the identity decision entirely — they decide neither which
//      segments group together nor where a sentence ends.
//
// NOTHING HERE MODIFIES `faChunkPlan.ts`. This measures what S2 WOULD produce,
// so its cost and its honest limits are known before a line of planner code is
// written. That ordering is the whole lesson of S1.
//
// Gated: WS1_SESSION_AH_MEASURE=1 npx vitest run scripts/ws1-session-ah-step3-s2dryrun.test.ts
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

const MEASURE = process.env.WS1_SESSION_AH_MEASURE === '1';
const OUT = resolve(REPO, '.work-phase4/session-ah');

// --- GEOMETRIC constants. Both come from the brief's own stated target band,
// --- not from any corpus row, and neither is tuned: the report below gives the
// --- full distribution so a different band can be read off it directly.
const TARGET_MIN_SEC = 15;
const TARGET_MAX_SEC = 60;

/** Silence-search windows the forced-violation set is reported at. A RANGE, not
 *  a chosen constant — reporting one number would make it load-bearing, and
 *  nothing in this session licenses picking one. */
const SEARCH_WINDOWS = [0.5, 1.0, 2.0, 5.0];

/** Sentence terminator: `.`/`!`/`?`/`…`, optionally followed by any run of
 *  closing quotes/brackets. Applied to the segment's own trimmed raw text.
 *  PUNCTUATION-AWARE, not ML: the script is authored prose with real
 *  punctuation, and inferring sentence ends any other way would reintroduce
 *  exactly the kind of guess S2 exists to remove. */
const TERMINATOR = /[.!?…]["'”’)\]]*\s*$/;
/** Counts sentence ends INSIDE a segment (not just at its end). */
const TERMINATOR_G = /[.!?…]["'”’)\]]*(\s|$)/g;

const endsSentence = (text: string): boolean => TERMINATOR.test(text.trim());
const sentenceEndsIn = (text: string): number => (text.trim().match(TERMINATOR_G) ?? []).length;

interface Group {
  /** Indices into the segment array. Always contiguous, length >= 1. */
  segIdx: number[];
  startSec: number;
  endSec: number;
  durationSec: number;
  /** True when this group had to absorb a following segment because a sentence
   *  ran across the seam — i.e. the case that constrains the invariant. */
  spansSentence: boolean;
}

/** Rule 1 + rule 2: the atoms a chunk edge may fall between. A seam is legal
 *  only where the preceding segment ENDS a sentence. */
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

/** Rule 3, second half: given a text seam's estimated audio time, the audio cut
 *  is the detected silence's `endSec` nearest to it — the same landmark
 *  `faAnchors.ts` already uses for every anchor. Returns the cut and its signed
 *  offset from the ideal seam. */
function nearestSilenceCut(ideal: number, silences: readonly SilenceInterval[]):
  { cut: number; offset: number } | undefined {
  let best: { cut: number; offset: number } | undefined;
  for (const s of silences) {
    const off = s.endSec - ideal;
    if (best === undefined || Math.abs(off) < Math.abs(best.offset)) best = { cut: s.endSec, offset: off };
  }
  return best;
}

/** Greedy left-to-right packing over GROUPS (never segments), targeting
 *  [TARGET_MIN_SEC, TARGET_MAX_SEC]. A group is never split — that is rule 2. */
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

describe.skipIf(!MEASURE)('WS1 Session AH Step 3 — S2 dry run', () => {
  it('measures sentence structure, packing, and the forced-violation set', async () => {
    mkdirSync(OUT, { recursive: true });
    const L: string[] = [];
    const json: Record<string, unknown> = {};

    L.push('# WS1 Session AH Step 3 — S2 dry run (READ-ONLY SIMULATION)');
    L.push('');
    L.push(`Target band **${TARGET_MIN_SEC}-${TARGET_MAX_SEC}s** (GEOMETRIC — the brief's own band, no corpus row informed it).`);
    L.push('Sentence detection is punctuation-only. Estimated seam times come from `applyAnchorBasedTiming`');
    L.push('(character-weight), which is a LENGTH estimate, not an identity decision — no Whisper timestamp');
    L.push('decides which segments group together or where a sentence ends.');
    L.push('');

    for (const key of ['v6', '173', 'spanish'] as const) {
      const spec = CORPORA[key]!;
      const { whisperTokens, silences } = loadLiveBundle(key);
      const segsRaw = await parseProjectData(
        readFileSync(spec.scriptPath, 'utf-8'), readFileSync(spec.sceneDetailsPath, 'utf-8'), [], spec.audioDuration,
      );
      const segs = applyAnchorBasedTiming(segsRaw, spec.audioDuration);
      const todayPlan = computeFaChunkPlan(segs, whisperTokens, silences, spec.audioDuration);

      // ---- 3b. Sentence statistics -------------------------------------
      const groups = unbreakableGroups(segs);
      const multiSegGroups = groups.filter(g => g.spansSentence);
      const totalSentenceEnds = segs.reduce((n, s) => n + sentenceEndsIn(s.text ?? ''), 0);
      const segsWithMultiple = segs.filter(s => sentenceEndsIn(s.text ?? '') > 1);
      const segsWithNone = segs.filter(s => sentenceEndsIn(s.text ?? '') === 0);

      L.push(`## ${key}`);
      L.push('');
      L.push('### 3b — sentence structure');
      L.push('');
      L.push(`| quantity | value |`);
      L.push(`|---|---|`);
      L.push(`| script segments | ${segs.length} |`);
      L.push(`| sentence terminators found | ${totalSentenceEnds} |`);
      L.push(`| **sentences that span >1 script segment** | **${multiSegGroups.length}** |`);
      L.push(`| segments touched by a spanning sentence | ${multiSegGroups.reduce((n, g) => n + g.segIdx.length, 0)} |`);
      L.push(`| widest spanning sentence (segments) | ${Math.max(0, ...multiSegGroups.map(g => g.segIdx.length))} |`);
      L.push(`| **segments containing >1 sentence** | **${segsWithMultiple.length}** |`);
      L.push(`| segments containing NO terminator | ${segsWithNone.length} |`);
      L.push(`| **unbreakable groups (legal seam count + 1)** | **${groups.length}** |`);
      L.push('');
      L.push('Worked examples of the multi-segment case — the one that constrains the invariant:');
      L.push('');
      for (const g of multiSegGroups.slice(0, 4)) {
        const parts = g.segIdx.map(i => `[${i}] ${JSON.stringify((segs[i]!.text ?? '').slice(0, 70))}`);
        L.push(`- segments ${g.segIdx.join('+')} -> ${parts.join(' + ')}`);
      }
      L.push('');

      // ---- 3c. Packing simulation --------------------------------------
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
      // Offsets at every INTERNAL seam (a chunk's end that is not the file end).
      const offsets = rows.slice(0, -1).map(r => r.cutEnd?.offset ?? NaN).filter(x => !Number.isNaN(x));

      L.push('### 3c — chunk-length distribution under S2');
      L.push('');
      L.push(`| quantity | S2 (simulated) | today (measured) |`);
      L.push(`|---|---|---|`);
      L.push(`| chunk count | **${rows.length}** | ${todayPlan.length} |`);
      L.push(`| min | ${Math.min(...durations).toFixed(2)}s | ${Math.min(...todayPlan.map(c => c.endSec - c.startSec)).toFixed(2)}s |`);
      L.push(`| max | ${Math.max(...durations).toFixed(2)}s | ${Math.max(...todayPlan.map(c => c.endSec - c.startSec)).toFixed(2)}s |`);
      L.push(`| median | ${pct(durations, 50).toFixed(2)}s | ${pct(todayPlan.map(c => c.endSec - c.startSec), 50).toFixed(2)}s |`);
      L.push(`| mean | ${(durations.reduce((a, b) => a + b, 0) / durations.length).toFixed(2)}s | ${(todayPlan.reduce((a, c) => a + c.endSec - c.startSec, 0) / todayPlan.length).toFixed(2)}s |`);
      L.push(`| **below ${TARGET_MIN_SEC}s** | **${durations.filter(d => d < TARGET_MIN_SEC).length}** | ${todayPlan.filter(c => c.endSec - c.startSec < TARGET_MIN_SEC).length} |`);
      L.push(`| **above ${TARGET_MAX_SEC}s** | **${durations.filter(d => d > TARGET_MAX_SEC).length}** | ${todayPlan.filter(c => c.endSec - c.startSec > TARGET_MAX_SEC).length} |`);
      L.push('');
      L.push('Histogram (S2 simulated chunk durations):');
      L.push('');
      L.push('| bucket | n | |');
      L.push('|---|---|---|');
      L.push(...histogram(durations, [0, 5, 10, 15, 20, 30, 45, 60, 90]));
      L.push('');
      L.push('Audio-cut offset — distance from the chosen silence to the ideal text seam:');
      L.push('');
      L.push(`| quantity | value |`);
      L.push(`|---|---|`);
      L.push(`| internal seams | ${offsets.length} |`);
      L.push(`| median abs offset | ${pct(offsets.map(Math.abs), 50).toFixed(3)}s |`);
      L.push(`| p90 abs offset | ${pct(offsets.map(Math.abs), 90).toFixed(3)}s |`);
      L.push(`| max abs offset | ${Math.max(...offsets.map(Math.abs)).toFixed(3)}s |`);
      for (const w of SEARCH_WINDOWS) {
        L.push(`| seams with NO silence within +/-${w}s | ${offsets.filter(o => Math.abs(o) > w).length} |`);
      }
      L.push('');

      // ---- 3d. Forced-violation set ------------------------------------
      const oversizeGroups = groups.filter(g => g.durationSec > TARGET_MAX_SEC);
      const undersizeChunks = rows.filter(r => r.durationSec < TARGET_MIN_SEC);
      const oversizeChunks = rows.filter(r => r.durationSec > TARGET_MAX_SEC);
      L.push('### 3d — forced-violation set (reported in full)');
      L.push('');
      L.push(`**Unbreakable groups longer than ${TARGET_MAX_SEC}s** (a single sentence-group S2 cannot split): ${oversizeGroups.length}`);
      for (const g of oversizeGroups) {
        L.push(`- segments ${g.segIdx.join('+')} — ${g.durationSec.toFixed(2)}s @ [${g.startSec.toFixed(2)}, ${g.endSec.toFixed(2)}]. `
          + `S2 must emit it as ONE oversize chunk; rule 2 forbids splitting it.`);
      }
      L.push('');
      L.push(`**Chunks over ${TARGET_MAX_SEC}s**: ${oversizeChunks.length}`);
      for (const r of oversizeChunks) {
        L.push(`- segments ${r.segFrom}-${r.segTo} — ${r.durationSec.toFixed(2)}s @ [${r.idealStart.toFixed(2)}, ${r.idealEnd.toFixed(2)}]`);
      }
      L.push('');
      L.push(`**Chunks under ${TARGET_MIN_SEC}s**: ${undersizeChunks.length}`);
      for (const r of undersizeChunks) {
        L.push(`- segments ${r.segFrom}-${r.segTo} — ${r.durationSec.toFixed(2)}s @ [${r.idealStart.toFixed(2)}, ${r.idealEnd.toFixed(2)}]`
          + ` (${r.idealEnd >= spec.audioDuration - 1 ? 'FILE TAIL — unavoidable remainder' : 'interior'})`);
      }
      L.push('');
      const farSeams = rows.slice(0, -1)
        .map((r, i) => ({ i, r }))
        .filter(({ r }) => r.cutEnd !== undefined && Math.abs(r.cutEnd.offset) > 1.0);
      L.push(`**Seams with no silence within +/-1.0s**: ${farSeams.length}`);
      for (const { r } of farSeams) {
        L.push(`- after segment ${r.segTo} — ideal ${r.idealEnd.toFixed(2)}, nearest silence end `
          + `${r.cutEnd!.cut.toFixed(2)} (offset ${r.cutEnd!.offset >= 0 ? '+' : ''}${r.cutEnd!.offset.toFixed(3)}s). `
          + `S2 must either accept the offset or leave the seam unrealised and merge the two chunks.`);
      }
      L.push('');

      json[key] = {
        segments: segs.length, groups: groups.length, spanningSentences: multiSegGroups.length,
        segsWithMultipleSentences: segsWithMultiple.length, totalSentenceEnds,
        s2Chunks: rows.length, todayChunks: todayPlan.length,
        durations, offsets, oversizeGroups: oversizeGroups.map(g => ({ segIdx: g.segIdx, durationSec: g.durationSec })),
        rows: rows.map(r => ({
          segFrom: r.segFrom, segTo: r.segTo, idealStart: r.idealStart, idealEnd: r.idealEnd,
          durationSec: r.durationSec, cutStart: r.cutStart, cutEnd: r.cutEnd,
        })),
      };
    }

    writeFileSync(resolve(OUT, 'step3-s2dryrun.md'), L.join('\n'));
    writeFileSync(resolve(OUT, 'step3-s2dryrun.json'), JSON.stringify(json, null, 2));
    console.log('wrote step3-s2dryrun.md');
  }, 900_000);
});
