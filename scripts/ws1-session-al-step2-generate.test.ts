/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// ---------------------------------------------------------------------------
// WS1 Session AL — STEPS 2 AND 3 (generation half). v6 ONLY.
//
// Produces three artefacts and asserts every structural invariant before a
// single second of audio is aligned:
//
//   1. THE PERIOD-DETECTION CENSUS. Every v6 segment classified by the
//      period-strict rule, every ambiguous case (ellipsis, abbreviation,
//      decimal, quoted/bracketed end) named, and the rule's verdict compared
//      SEGMENT BY SEGMENT against `s2EndsSentence` — so the claim "arm D is a
//      pure width change from arm C on v6" is measured, not assumed.
//   2. `fa_al_chunks.json` — arm D's plan, written as a SEPARATE file, never
//      over `fa_ai_chunks.json` (arm B) or `fa_ak_chunks.json` (arm C). Both
//      of those must stay reproducible at this commit or the comparison has a
//      moving baseline.
//   3. THE FULL CHUNK INSPECTION TABLE, one row per chunk, every chunk.
//
// ARM B AND ARM C REPRODUCTION IS RE-CHECKED HERE, for the same reason
// Session AK re-checked arm B: this session appends to `faChunkPlan.ts`, and
// an append that perturbed a shared helper would silently invalidate both
// stored word files. Cheap to check, catastrophic to skip.
//
// Gated: WS1_SESSION_AL_MEASURE=1 npx vitest run scripts/ws1-session-al-step2-generate.test.ts
// ---------------------------------------------------------------------------

import { describe, it, expect } from 'vitest';
import { writeFileSync, readFileSync, mkdirSync } from 'fs';
import { resolve } from 'path';
import { createHash } from 'crypto';

import { CORPORA, REPO, REPLAY_ROOT, loadLiveBundle } from './ws1-session-p-pipeline.js';
import { parseProjectData } from '../src/App';
import { applyAnchorBasedTiming } from '../src/services/syncEngine';
import {
  computeFaChunkPlanS2, computeFaChunkPlanS2Excised, computeFaChunkPlanPeriodStrict,
  computeUnscriptedRuns, periodStrictEndsSentence,
} from '../src/services/faChunkPlan';
import type { FaChunk, PeriodStrictChunkInspection } from '../src/services/faChunkPlan';
import { AL_TARGET_MIN_SEC, AL_TARGET_MAX_SEC, AL_SILENCE_SEARCH_WINDOW_SEC } from './ws1-session-al-step1-gate.js';

const MEASURE = process.env.WS1_SESSION_AL_MEASURE === '1';
const OUT = resolve(REPO, '.work-phase4/session-al');
const DOCS = resolve(REPO, 'docs/ws1-sync-pipeline');

const round6 = (n: number): number => +n.toFixed(6);

/** `s2EndsSentence`'s regex, duplicated here ONLY to compare the two rules
 *  segment by segment (the original is module-private). Byte-identical to
 *  `faChunkPlan.ts`'s `S2_SENTENCE_TERMINATOR`. */
const S2_TERMINATOR_MIRROR = /[.!?…]["'”’)\]]*\s*$/;
const s2EndsSentenceMirror = (t: string | undefined): boolean => S2_TERMINATOR_MIRROR.test((t ?? '').trim());

describe.skipIf(!MEASURE)('WS1 Session AL Steps 2-3 — period census, arm D plan, inspection dump', () => {
  it('censuses v6 periods, writes fa_al_chunks.json, and dumps every chunk', async () => {
    mkdirSync(OUT, { recursive: true });
    const spec = CORPORA.v6!;
    const { silences, whisperTokens } = loadLiveBundle('v6');
    const segsRaw = await parseProjectData(
      readFileSync(spec.scriptPath, 'utf-8'), readFileSync(spec.sceneDetailsPath, 'utf-8'), [], spec.audioDuration,
    );
    const anchorTimed = applyAnchorBasedTiming(segsRaw, spec.audioDuration);
    const runs = computeUnscriptedRuns(anchorTimed, whisperTokens, silences, spec.audioDuration);

    // ---- ARM B AND ARM C MUST STILL REPRODUCE AT HEAD ---------------------
    const armB = computeFaChunkPlanS2(anchorTimed, silences, spec.audioDuration);
    const armC = computeFaChunkPlanS2Excised(anchorTimed, whisperTokens, silences, spec.audioDuration);
    const storedPlan = (f: string): FaChunk[] =>
      (JSON.parse(readFileSync(resolve(REPLAY_ROOT, 'v6', f), 'utf-8')) as { chunks: FaChunk[] }).chunks;
    const samePlan = (a: readonly FaChunk[], b: readonly FaChunk[]): boolean =>
      a.length === b.length && a.every((c, i) =>
        round6(c.startSec) === round6(b[i]!.startSec) && round6(c.endSec) === round6(b[i]!.endSec) && c.text === b[i]!.text);
    const bReproduces = samePlan(armB.chunks, storedPlan('fa_ai_chunks.json'));
    const cReproduces = samePlan(armC.chunks, storedPlan('fa_ak_chunks.json'));
    expect(bReproduces, 'arm B must still reproduce its stored plan at HEAD').toBe(true);
    expect(cReproduces, 'arm C must still reproduce its stored plan at HEAD').toBe(true);

    // ================= 1. THE PERIOD-DETECTION CENSUS ======================
    interface CensusRow {
      idx: number; tail: string; psEnds: boolean; psRejectedAs?: string; psTerminator?: string;
      closers: string; s2Ends: boolean; disagrees: boolean;
    }
    const census: CensusRow[] = anchorTimed.map((s, idx) => {
      const v = periodStrictEndsSentence(s.text);
      const s2 = s2EndsSentenceMirror(s.text);
      return {
        idx, tail: (s.text ?? '').trim().slice(-46), psEnds: v.endsSentence, psRejectedAs: v.rejectedAs,
        psTerminator: v.terminator, closers: v.closersStripped, s2Ends: s2, disagrees: v.endsSentence !== s2,
      };
    });
    const disagreements = census.filter(r => r.disagrees);
    const byRejection: Record<string, number> = {};
    for (const r of census) if (!r.psEnds) byRejection[r.psRejectedAs ?? '?'] = (byRejection[r.psRejectedAs ?? '?'] ?? 0) + 1;
    const byTerminator: Record<string, number> = {};
    for (const r of census) if (r.psEnds) byTerminator[r.psTerminator ?? '?'] = (byTerminator[r.psTerminator ?? '?'] ?? 0) + 1;

    // Ambiguous CASES — the four classes the brief names, hunted across the
    // WHOLE segment text, not just its final position, so "none found" is a
    // measurement over the corpus rather than over one character.
    const AMBIG: Array<{ name: string; re: RegExp; tailRe: RegExp }> = [
      { name: 'ellipsis (… or ...)', re: /…|\.\.\./, tailRe: /(?:…|\.\.\.)["'”’»)\]}]*$/ },
      { name: 'decimal (digit.digit)', re: /\d\.\d/, tailRe: /\d\.\d["'”’»)\]}]*$/ },
      { name: 'any digit', re: /\d/, tailRe: /\d["'”’»)\]}]*\.?$/ },
      { name: 'abbreviation (closed list)', re: /(?:^|\s)(?:Mr|Mrs|Ms|Dr|Prof|St|Jr|Sr|vs|etc|approx|Fig|No|Vol|Inc|Ltd|Co|Ave|Rd|Mt|Gen|Capt|Sgt|Lt|cf|al)\./, tailRe: /(?:^|\s)(?:Mr|Mrs|Ms|Dr|Prof|St|Jr|Sr|vs|etc|approx|Fig|No|Vol|Inc|Ltd|Co|Ave|Rd|Mt|Gen|Capt|Sgt|Lt|cf|al)\.$/ },
      { name: 'single-capital initial (X.)', re: /(?:^|\s)[A-Z]\./, tailRe: /(?:^|\s)[A-Z]\.$/ },
      { name: 'quote or bracket', re: /["“”'‘’«»()[\]{}]/, tailRe: /["“”'‘’«»()[\]{}]$/ },
      { name: 'colon or semicolon', re: /[:;]/, tailRe: /[:;]$/ },
      { name: 'exclamation or question mark', re: /[!?]/, tailRe: /[!?]["'”’»)\]}]*$/ },
    ];
    // Two counts per class, because only one of them can change a verdict: the
    // rule consults the SEGMENT-FINAL position only, so an occurrence anywhere
    // else in the text is not an ambiguity at all. Reporting both stops a
    // harmless intra-word apostrophe from being filed as a resolved edge case.
    const ambigHits = AMBIG.map(a => {
      const rows = anchorTimed.map((s, i) => ({ i, t: (s.text ?? '').trim() }));
      return {
        name: a.name,
        hits: rows.filter(r => a.re.test(r.t)),
        tailHits: rows.filter(r => a.tailRe.test(r.t)),
      };
    });

    // ================= 2. ARM D ============================================
    const armD = computeFaChunkPlanPeriodStrict(
      anchorTimed, whisperTokens, silences, spec.audioDuration,
      AL_TARGET_MIN_SEC, AL_TARGET_MAX_SEC, AL_SILENCE_SEARCH_WINDOW_SEC,
    );

    // Structural invariants — monotone, non-overlapping, non-empty, and every
    // plan gap is an excised R.5 run rather than an accident.
    for (let i = 0; i < armD.chunks.length; i++) {
      const c = armD.chunks[i]!;
      expect(c.endSec, `chunk ${i} inverted`).toBeGreaterThan(c.startSec);
      expect(c.text.length, `chunk ${i} empty text`).toBeGreaterThan(0);
      if (i > 0) expect(c.startSec, `chunk ${i} overlaps predecessor`).toBeGreaterThanOrEqual(armD.chunks[i - 1]!.endSec - 1e-9);
    }
    const gaps: Array<{ startSec: number; endSec: number; isRun: boolean }> = [];
    for (let i = 1; i < armD.chunks.length; i++) {
      const g0 = armD.chunks[i - 1]!.endSec, g1 = armD.chunks[i]!.startSec;
      if (g1 - g0 > 1e-6) {
        gaps.push({ startSec: g0, endSec: g1, isRun: runs.some(u => Math.abs(u.startSec - g0) < 1e-6 && Math.abs(u.endSec - g1) < 1e-6) });
      }
    }
    expect(gaps.filter(g => !g.isRun), 'every plan gap must be an excised R.5 run').toEqual([]);

    // TEXT CONSERVATION against arm C — the whole point of a one-variable
    // change: a different BAND must not add or drop one script word.
    expect(armD.chunks.map(c => c.text).join(' '), 'arm D text must equal arm C text word for word')
      .toBe(armC.chunks.map(c => c.text).join(' '));

    // NEVER A MID-SENTENCE SPLIT: every chunk's last segment must end a
    // sentence by the period-strict rule, except where a chunk is closed by an
    // excision seam or is the corpus's last.
    let midSentenceEdges = 0;
    for (let i = 0; i < armD.inspection.length - 1; i++) {
      const row = armD.inspection[i]!;
      if (row.cutKind === 'excision-run-edge') continue;
      if (!periodStrictEndsSentence(anchorTimed[row.segTo]!.text).endsSentence) midSentenceEdges++;
    }
    expect(midSentenceEdges, 'invariant 1/2: no chunk edge may fall inside a sentence').toBe(0);

    const dest = resolve(REPLAY_ROOT, 'v6', 'fa_al_chunks.json');
    const excisedSec = gaps.reduce((a, g) => a + (g.endSec - g.startSec), 0);
    const payload = {
      _runId: `al-${new Date().toISOString().replace(/[:.]/g, '')}`,
      audioDuration: spec.audioDuration,
      language: spec.language,
      _source: {
        note: 'WS1 Session AL arm D — computeFaChunkPlanPeriodStrict(anchorTimed, rawWhisperTokens, '
          + `nativeSilences, audioDuration, ${AL_TARGET_MIN_SEC}, ${AL_TARGET_MAX_SEC}, `
          + `${AL_SILENCE_SEARCH_WINDOW_SEC}) AT HEAD. Period-strict grouping, 1-15s band (OPERATOR-DIRECTED), `
          + 'R.5 excision ON (matching arm C). Plan is deliberately NOT gapless: every gap is an excised recitation.',
        anchorTimedSegments: anchorTimed.length,
        silenceCount: silences.length,
        r5RunCount: runs.length,
        excisedSpans: gaps.length,
        excisedSec: round6(excisedSec),
        violationCount: armD.violations.length,
      },
      chunks: armD.chunks,
    };
    const text = JSON.stringify(payload, null, 2);
    writeFileSync(dest, text);

    // ================= 3. THE INSPECTION DUMP ==============================
    const lens = armD.inspection.map(r => r.durationSec);
    const sorted = [...lens].sort((a, b) => a - b);
    const q = (p: number): number => sorted.length === 0 ? 0 : sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))]!;
    const dist = {
      n: lens.length,
      min: +Math.min(...lens).toFixed(3),
      p25: +q(0.25).toFixed(3),
      median: +q(0.5).toFixed(3),
      p75: +q(0.75).toFixed(3),
      max: +Math.max(...lens).toFixed(3),
      mean: +(lens.reduce((a, b) => a + b, 0) / lens.length).toFixed(3),
      underMin: lens.filter(x => x < AL_TARGET_MIN_SEC).length,
      overMax: lens.filter(x => x > AL_TARGET_MAX_SEC).length,
    };
    const HIST_EDGES = [0, 1, 2, 4, 6, 8, 10, 12, 14, 15, 20, 30, 45, Infinity];
    const hist = HIST_EDGES.slice(0, -1).map((lo, i) => ({
      lo, hi: HIST_EDGES[i + 1]!, n: lens.filter(x => x >= lo && x < HIST_EDGES[i + 1]!).length,
    }));

    const D: string[] = [];
    D.push('# WS1 Session AL — v6 arm D chunk inspection table (MEASURED)');
    D.push('');
    D.push(`Period-strict planner, band **${AL_TARGET_MIN_SEC}-${AL_TARGET_MAX_SEC}s** (OPERATOR-DIRECTED), silence`);
    D.push(`search window **±${AL_SILENCE_SEARCH_WINDOW_SEC}s** (OPERATOR-DIRECTED, inherited unchanged from`);
    D.push('`S2_SILENCE_SEARCH_WINDOW_SEC`), R.5 excision ON. v6 = 1421.29s, 447 segments.');
    D.push('');
    D.push(`Total chunks: **${armD.chunks.length}**. Every chunk is listed; nothing is elided.`);
    D.push('');
    D.push('`cut` column: `detected-silence` = the audio cut landed on a detected silence end within the');
    D.push('search window; `geometric-fallback` = no silence inside the window, cut taken at the geometric');
    D.push('midpoint of the inter-word gap; `excision-run-edge` = the cut is an R.5 run boundary;');
    D.push('`corpus-end` = the final chunk ends at `audioDuration`. `Δideal` is the committed cut minus the');
    D.push('estimate-based ideal seam.');
    D.push('');
    D.push('| # | start | end | dur | cut | Δideal | sents | segs | >cap | ending text |');
    D.push('|---|---|---|---|---|---|---|---|---|---|');
    for (const r of armD.inspection) {
      D.push(`| ${r.index} | ${r.startSec.toFixed(3)} | ${r.endSec.toFixed(3)} | ${r.durationSec.toFixed(3)} `
        + `| ${r.cutKind} | ${r.cutOffsetSec >= 0 ? '+' : ''}${r.cutOffsetSec.toFixed(3)} | ${r.sentenceCount} `
        + `| ${r.segFrom}-${r.segTo} | ${r.exceededCap ? '**YES**' : ''} | ${r.endingText.replace(/\|/g, '\\|')} |`);
    }
    D.push('');
    D.push('## Distribution');
    D.push('');
    D.push(`- n **${dist.n}** | min **${dist.min}s** | p25 ${dist.p25}s | **median ${dist.median}s** | p75 ${dist.p75}s | max **${dist.max}s** | mean ${dist.mean}s`);
    D.push(`- chunks under ${AL_TARGET_MIN_SEC}s: **${dist.underMin}** | chunks over ${AL_TARGET_MAX_SEC}s: **${dist.overMax}**`);
    D.push('');
    D.push('| bucket | count |');
    D.push('|---|---|');
    for (const h of hist) D.push(`| ${h.lo}-${h.hi === Infinity ? '∞' : h.hi}s | ${h.n} |`);
    D.push('');
    D.push('## Cut-kind census');
    D.push('');
    const cutKinds: Record<string, number> = {};
    for (const r of armD.inspection) cutKinds[r.cutKind] = (cutKinds[r.cutKind] ?? 0) + 1;
    D.push('| cut kind | count |');
    D.push('|---|---|');
    for (const [k, v] of Object.entries(cutKinds)) D.push(`| ${k} | ${v} |`);
    D.push('');
    D.push('## The complete violation list (not a summary)');
    D.push('');
    D.push(`Total violation events: **${armD.violations.length}**.`);
    D.push('');
    if (armD.violations.length === 0) {
      D.push('_None. No chunk exceeded the cap, no cut fell back to geometry, no run was left unexcised,');
      D.push('no chunk collapsed, and the final chunk was not degenerate._');
    } else {
      D.push('| # | cause | segIdx | ideal | seam | dur | what the planner did |');
      D.push('|---|---|---|---|---|---|---|');
      armD.violations.forEach((v, i) => {
        D.push(`| ${i} | \`${v.cause}\` | ${v.segIdx} | ${v.idealSec.toFixed(3)} | ${v.seamSec?.toFixed(3) ?? '—'} `
          + `| ${v.durationSec?.toFixed(3) ?? '—'} | ${v.fallback.replace(/\|/g, '\\|')} |`);
      });
    }
    D.push('');
    D.push('## The period-detection census');
    D.push('');
    D.push(`- v6 segments: **${census.length}** | period-strict sentence ends: **${census.filter(r => r.psEnds).length}** `
      + `| unbreakable groups: **${census.filter(r => r.psEnds).length + (census[census.length - 1]!.psEnds ? 0 : 1)}**`);
    D.push(`- terminator census (accepted): \`${JSON.stringify(byTerminator)}\``);
    D.push(`- rejection census: \`${JSON.stringify(byRejection)}\``);
    D.push(`- **segments where the period-strict rule DISAGREES with \`s2EndsSentence\`: ${disagreements.length}**`);
    D.push('');
    D.push('### Ambiguous-case hunt (whole segment text, not just its final character)');
    D.push('');
    D.push('| class the brief names | anywhere in text | at segment-final position | resolution |');
    D.push('|---|---|---|---|');
    for (const a of ambigHits) {
      const resolution = a.hits.length === 0
        ? 'STRUCTURALLY ABSENT from v6 anywhere — the exclusion is inert on this corpus'
        : a.tailHits.length === 0
          ? 'present INSIDE segment text but NEVER at the segment-final position the rule reads, so it '
            + 'cannot change a verdict; the exclusion is inert on this corpus'
          : 'PRESENT AT A SEGMENT-FINAL POSITION — see the named rows below';
      D.push(`| ${a.name} | ${a.hits.length} | **${a.tailHits.length}** | ${resolution} |`);
    }
    D.push('');
    for (const a of ambigHits) {
      if (a.hits.length === 0) continue;
      D.push(`#### ${a.name} — ${a.hits.length} segment(s), ${a.tailHits.length} at a segment-final position`);
      D.push('');
      for (const h of a.hits) D.push(`- segment **${h.i}**${a.tailHits.some(t => t.i === h.i) ? ' **(FINAL POSITION)**' : ''}: \`${h.t.slice(-70).replace(/\|/g, '\\|')}\``);
      D.push('');
    }
    if (disagreements.length > 0) {
      D.push('### Segments where period-strict and `s2EndsSentence` disagree');
      D.push('');
      D.push('| segIdx | tail | period-strict | rejected as | s2 |');
      D.push('|---|---|---|---|---|');
      for (const r of disagreements) {
        D.push(`| ${r.idx} | \`${r.tail.replace(/\|/g, '\\|')}\` | ${r.psEnds} | ${r.psRejectedAs ?? '—'} | ${r.s2Ends} |`);
      }
      D.push('');
    }

    const dumpText = `${D.join('\n')}\n`;
    writeFileSync(resolve(OUT, 'v6-chunk-inspection.md'), dumpText);
    writeFileSync(resolve(DOCS, 'session-al-v6-chunk-inspection.md'), dumpText);

    const json = {
      armBReproduces: bReproduces, armCReproduces: cReproduces,
      armBChunks: armB.chunks.length, armCChunks: armC.chunks.length, armDChunks: armD.chunks.length,
      r5Runs: runs.length, excisedSpans: gaps.length, excisedSec: round6(excisedSec),
      distribution: dist, histogram: hist, cutKinds,
      violations: armD.violations,
      census: {
        segments: census.length,
        periodStrictEnds: census.filter(r => r.psEnds).length,
        s2Ends: census.filter(r => r.s2Ends).length,
        disagreements: disagreements.length,
        byTerminator, byRejection,
        ambiguous: ambigHits.map(a => ({
          name: a.name, count: a.hits.length, rows: a.hits.map(h => h.i),
          tailCount: a.tailHits.length, tailRows: a.tailHits.map(h => h.i),
        })),
      },
      inspection: armD.inspection satisfies PeriodStrictChunkInspection[],
      planSha256: createHash('sha256').update(text).digest('hex'),
    };
    writeFileSync(resolve(OUT, 'step2-generate.json'), JSON.stringify(json, null, 2));

    // eslint-disable-next-line no-console
    console.log([
      `arm B reproduces: ${bReproduces} | arm C reproduces: ${cReproduces}`,
      `arm D chunks: ${armD.chunks.length} | violations: ${armD.violations.length}`,
      `distribution: ${JSON.stringify(dist)}`,
      `cut kinds: ${JSON.stringify(cutKinds)}`,
      `period census: ${JSON.stringify(json.census)}`,
      `plan sha256: ${json.planSha256}`,
      `wrote ${dest}`,
    ].join('\n'));
  }, 300_000);
});
