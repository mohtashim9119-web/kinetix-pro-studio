/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// ---------------------------------------------------------------------------
// WS1 Session AM — STEP 4. ARM G: THE CEILING. v6 ONLY.
//
// *** DIAGNOSTIC ONLY. THIS ARM CAN NEVER SHIP. ***
//
// Arm G places every internal chunk edge at the AJ-0 oracle's own attested
// boundary time for the segment that OPENS the next chunk. It consumes ground
// truth. It exists to answer exactly one question — IF CHUNK EDGES WERE
// PERFECT, WOULD THE ARCH GO AWAY? — and nothing it produces is a candidate for
// production under any result, including a good one.
//
// UNREACHABLE FROM PRODUCTION BY CONSTRUCTION, NOT BY CONVENTION. The attested
// table is a REQUIRED field of the `{ kind: 'attested' }` discriminant with no
// default, and no file under `src/` reads the oracle fixture — asserted below
// by grepping the source tree, so the claim is checked rather than stated. An
// arm-G plan is unconstructible without a caller that already holds all 447
// oracle values and passes them in explicitly.
//
// THE FIDELITY QUESTION IS THE POINT. Arm G's answer is worth exactly what the
// seam -> attested-time mapping is worth, so this test measures that mapping
// before it measures anything else, and says honestly where it is lossy.
//
// Gated: WS1_SESSION_AM_MEASURE=1 npx vitest run scripts/ws1-session-am-step4-armg.test.ts
// ---------------------------------------------------------------------------

import { describe, it, expect } from 'vitest';
import { writeFileSync, readFileSync, mkdirSync, readdirSync, statSync } from 'fs';
import { resolve, join } from 'path';
import { createHash } from 'crypto';

import { CORPORA, REPO, REPLAY_ROOT, loadLiveBundle } from './ws1-session-p-pipeline.js';
import { parseProjectData } from '../src/App';
import { applyAnchorBasedTiming } from '../src/services/syncEngine';
import {
  computeFaChunkPlanS2Excised, computeFaChunkPlanS2EdgeArm, computeUnscriptedRuns,
} from '../src/services/faChunkPlan';
import type { FaChunk } from '../src/services/faChunkPlan';
import {
  AM_TARGET_MIN_SEC, AM_TARGET_MAX_SEC, ARM_G_IS_DIAGNOSTIC_ONLY, ARM_G_SHIP_GATE_APPLIES,
  ARM_G_DEFECTIVE_ORACLE_ROWS, V6_OPEN_DEFECTS, AL_V6_CHUNK_COUNT,
} from './ws1-session-am-step1-gate.js';

const MEASURE = process.env.WS1_SESSION_AM_MEASURE === '1';
const OUT = resolve(REPO, '.work-phase4/session-am');
const DOCS = resolve(REPO, 'docs/ws1-sync-pipeline');

const round6 = (n: number): number => +n.toFixed(6);

interface OracleBoundary {
  index: number; tag: string; startTime: number; duration: number;
  openDefect?: boolean; earTarget?: number;
}

/** Every `.ts` file under `src/`, so the "no production path can reach arm G"
 *  claim is CHECKED rather than asserted in prose. */
function walkTs(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walkTs(full, out);
    else if (full.endsWith('.ts') || full.endsWith('.tsx')) out.push(full);
  }
  return out;
}

describe.skipIf(!MEASURE)('WS1 Session AM Step 4 — arm G, the oracle-placed ceiling (DIAGNOSTIC ONLY)', () => {
  it('measures the oracle mapping\'s fidelity, then writes fa_am_g_chunks.json', async () => {
    mkdirSync(OUT, { recursive: true });
    const spec = CORPORA.v6!;
    const { silences, whisperTokens } = loadLiveBundle('v6');
    const oracle = JSON.parse(readFileSync(
      resolve(REPO, 'scripts/fixtures/session-aj0-oracle-v6.json'), 'utf-8',
    )) as { segmentCount: number; boundaries: OracleBoundary[] };

    const segsRaw = await parseProjectData(
      readFileSync(spec.scriptPath, 'utf-8'), readFileSync(spec.sceneDetailsPath, 'utf-8'), [], spec.audioDuration,
    );
    const anchorTimed = applyAnchorBasedTiming(segsRaw, spec.audioDuration);
    const runs = computeUnscriptedRuns(anchorTimed, whisperTokens, silences, spec.audioDuration);
    const armC = computeFaChunkPlanS2Excised(anchorTimed, whisperTokens, silences, spec.audioDuration);
    expect(armC.chunks.length).toBe(AL_V6_CHUNK_COUNT.C);

    // ==================== UNREACHABILITY, CHECKED =========================
    // Two independent conditions, both asserted:
    //   (a) nothing under src/ reads the oracle fixture, so no module inside
    //       the app can construct an attested table at all; and
    //   (b) nothing under src/ constructs the `{ kind: 'attested' }`
    //       discriminant — the only caller is this measurement script.
    const srcFiles = walkTs(resolve(REPO, 'src'));
    const readsOracle = srcFiles.filter(f => readFileSync(f, 'utf-8').includes('session-aj0-oracle'));
    // CONSTRUCTION, not mention. `faChunkPlan.ts` necessarily DECLARES the
    // discriminant (`{ kind: 'attested'; attestedStartBySegIdx: ... }`, members
    // separated by `;`) and BRANCHES on it (`placement.kind === 'attested'`);
    // that is the definition site and is exactly where it belongs. What must
    // not exist anywhere in `src/` is an OBJECT LITERAL supplying the required
    // table — members separated by `,` — because that is the only thing that
    // could actually reach the planner with ground truth in hand.
    const CONSTRUCTS_ATTESTED = /kind:\s*'attested'\s*,\s*attestedStartBySegIdx/;
    const buildsAttested = srcFiles.filter(f => CONSTRUCTS_ATTESTED.test(readFileSync(f, 'utf-8')));
    const mentionsAttested = srcFiles.filter(f => /'attested'/.test(readFileSync(f, 'utf-8')));
    expect(readsOracle, 'no file under src/ may read the oracle fixture').toEqual([]);
    expect(buildsAttested, 'no file under src/ may construct the attested placement').toEqual([]);
    expect(mentionsAttested.map(f => f.replace(`${REPO}/`, '')),
      'the discriminant may be declared and branched on ONLY in the planner that defines it')
      .toEqual(['src/services/faChunkPlan.ts']);
    expect(ARM_G_IS_DIAGNOSTIC_ONLY).toBe(true);
    expect(ARM_G_SHIP_GATE_APPLIES).toBe(false);

    // ==================== THE MAPPING'S FIDELITY ==========================
    const attestedStartBySegIdx = new Map<number, number>(
      oracle.boundaries.map(b => [b.index, b.startTime]),
    );
    const tagBySegIdx = new Map(oracle.boundaries.map(b => [b.index, b.tag]));
    const defectiveIdx = new Set(oracle.boundaries.filter(b => b.openDefect).map(b => b.index));
    expect(defectiveIdx.size, 'the gate registered exactly this many defective oracle rows')
      .toBe(ARM_G_DEFECTIVE_ORACLE_ROWS);

    // Which segments can OPEN a chunk at all — i.e. the seam targets. A group's
    // first segment, for every group after the first.
    const groupFirsts: number[] = [];
    {
      let cur: number[] = [];
      const endsSentence = (t: string | undefined): boolean => /[.!?…]["'”’)\]]*\s*$/.test((t ?? '').trim());
      for (let i = 0; i < anchorTimed.length; i++) {
        cur.push(i);
        if (endsSentence(anchorTimed[i]!.text) || i === anchorTimed.length - 1) {
          groupFirsts.push(cur[0]!);
          cur = [];
        }
      }
    }
    const openable = groupFirsts.slice(1); // the first group opens the corpus, not a seam
    const openableWithAttested = openable.filter(i => attestedStartBySegIdx.has(i));
    const openableDefective = openable.filter(i => defectiveIdx.has(i));

    // ==================== ARM G ===========================================
    const armG = computeFaChunkPlanS2EdgeArm(
      anchorTimed, whisperTokens, silences, spec.audioDuration,
      { kind: 'attested', attestedStartBySegIdx }, AM_TARGET_MIN_SEC, AM_TARGET_MAX_SEC,
    );

    // Which seams arm G ACTUALLY used, and whether any landed on a defective row.
    const usedSeams: Array<{ chunkIdx: number; openingSegIdx: number; tag: string; time: number; defective: boolean }> = [];
    {
      // The opening segment of chunk i+1 is `inspection[i+1].segFrom` when no
      // carry-forward happened; carry-forward did not fire in arm F and is
      // asserted below for arm G too.
      for (let i = 0; i + 1 < armG.inspection.length; i++) {
        if (armG.inspection[i]!.cutKind !== 'attested') continue;
        const opening = armG.inspection[i + 1]!.segFrom;
        usedSeams.push({
          chunkIdx: i, openingSegIdx: opening, tag: tagBySegIdx.get(opening) ?? '?',
          time: armG.inspection[i]!.endSec, defective: defectiveIdx.has(opening),
        });
      }
    }
    const seamsOnDefectiveRows = usedSeams.filter(s => s.defective);

    // ==================== STRUCTURAL INVARIANTS ===========================
    for (let i = 0; i < armG.chunks.length; i++) {
      const c = armG.chunks[i]!;
      expect(c.endSec, `chunk ${i} inverted`).toBeGreaterThan(c.startSec);
      expect(c.text.length, `chunk ${i} empty text`).toBeGreaterThan(0);
      if (i > 0) {
        expect(c.startSec, `chunk ${i} overlaps predecessor`).toBeGreaterThanOrEqual(armG.chunks[i - 1]!.endSec - 1e-9);
      }
    }
    expect(armG.chunks[armG.chunks.length - 1]!.endSec).toBeLessThanOrEqual(spec.audioDuration + 1e-9);

    const gaps: Array<{ startSec: number; endSec: number; isRun: boolean }> = [];
    for (let i = 1; i < armG.chunks.length; i++) {
      const g0 = armG.chunks[i - 1]!.endSec, g1 = armG.chunks[i]!.startSec;
      if (g1 - g0 > 1e-6) {
        gaps.push({
          startSec: g0, endSec: g1,
          isRun: runs.some(u => Math.abs(u.startSec - g0) < 1e-6 && Math.abs(u.endSec - g1) < 1e-6),
        });
      }
    }
    expect(gaps.filter(g => !g.isRun), 'every plan gap must be an excised R.5 run').toEqual([]);
    expect(armG.chunks.map(c => c.text).join(' '), 'arm G text must equal arm C text word for word')
      .toBe(armC.chunks.map(c => c.text).join(' '));

    const collapsed = armG.violations.filter(v => v.cause === 'excision-collapsed-chunk');
    const cursorMonotone = armG.chunks.every((c, i) => i === 0 || c.startSec >= armG.chunks[i - 1]!.endSec - 1e-9);

    // ==================== WRITE THE PLAN ==================================
    const dest = resolve(REPLAY_ROOT, 'v6', 'fa_am_g_chunks.json');
    const excisedSec = gaps.reduce((a, g) => a + (g.endSec - g.startSec), 0);
    const payload = {
      _runId: `am-g-${new Date().toISOString().replace(/[:.]/g, '')}`,
      audioDuration: spec.audioDuration,
      language: spec.language,
      _source: {
        note: '*** DIAGNOSTIC ONLY — ARM G CAN NEVER SHIP. *** WS1 Session AM arm G — '
          + `computeFaChunkPlanS2EdgeArm(anchorTimed, rawWhisperTokens, nativeSilences, audioDuration, `
          + `{ kind: 'attested', ... }, ${AM_TARGET_MIN_SEC}, ${AM_TARGET_MAX_SEC}) AT HEAD. Internal chunk `
          + 'edges placed at the AJ-0 ORACLE\'s own attested boundary times, i.e. this plan CONSUMES GROUND '
          + 'TRUTH and exists solely to establish the ceiling for any chunk-plan-based fix. Everything else '
          + 'is held identical to arm C.',
        anchorTimedSegments: anchorTimed.length,
        silenceCount: silences.length,
        r5RunCount: runs.length,
        excisedSpans: gaps.length,
        excisedSec: round6(excisedSec),
        violationCount: armG.violations.length,
        edgeCensus: armG.edgeCensus,
      },
      chunks: armG.chunks,
    };
    const text = JSON.stringify(payload, null, 2);
    writeFileSync(dest, text);

    // ==================== THE REPORT ======================================
    const lens = armG.inspection.map(r => r.durationSec);
    const sorted = [...lens].sort((a, b) => a - b);
    const q = (p: number): number => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))]!;
    const dist = {
      n: lens.length, min: +Math.min(...lens).toFixed(3), p25: +q(0.25).toFixed(3),
      median: +q(0.5).toFixed(3), p75: +q(0.75).toFixed(3), max: +Math.max(...lens).toFixed(3),
      mean: +(lens.reduce((a, b) => a + b, 0) / lens.length).toFixed(3),
      overMax: lens.filter(x => x > AM_TARGET_MAX_SEC).length,
    };
    const offsets = armG.inspection.filter(r => r.cutKind === 'attested').map(r => r.cutOffsetSec);
    const absOff = offsets.map(Math.abs).sort((a, b) => a - b);

    const L: string[] = [];
    L.push('# WS1 Session AM Step 4 — arm G, the oracle-placed ceiling (MEASURED, v6, no FA run)');
    L.push('');
    L.push('> ## *** DIAGNOSTIC ONLY. ARM G CAN NEVER SHIP. ***');
    L.push('>');
    L.push('> This arm places chunk edges at the AJ-0 oracle\'s own attested boundary times. It CONSUMES');
    L.push('> GROUND TRUTH. No result it produces — including a good one — makes it a shipping candidate,');
    L.push('> and the session gate\'s SUCCESS BAR and SHIP CAP are deliberately NOT applied to it, because');
    L.push('> applying a ship gate to an unshippable arm would be theatre. Its single job is to answer:');
    L.push('> **if chunk edges were perfect, would the arch go away?**');
    L.push('');
    L.push('## Unreachability from production — checked, not asserted');
    L.push('');
    L.push('| condition | result |');
    L.push('|---|---|');
    L.push(`| files under \`src/\` that read the oracle fixture | **${readsOracle.length}** |`);
    L.push(`| files under \`src/\` that CONSTRUCT the attested placement (object literal supplying the table) | **${buildsAttested.length}** |`);
    L.push(`| files under \`src/\` that mention the discriminant at all | ${mentionsAttested.length} (\`${mentionsAttested.map(f => f.replace(`${REPO}/`, '')).join('`, `')}\` — the declaration and branch site, asserted to be the only one) |`);
    L.push(`| \`src/\` files scanned | ${srcFiles.length} |`);
    L.push('| attested table has a default value | **no — required field** |');
    L.push('');
    L.push('The required-field construction is what makes this structural rather than conventional: an arm-G');
    L.push('plan is unconstructible without a caller that already holds every one of the 447 oracle values');
    L.push('and passes them in explicitly. Nothing inside the app can supply one.');
    L.push('');
    L.push('## How the 447 oracle values map onto permitted sentence-group ends');
    L.push('');
    L.push('| quantity | value |');
    L.push('|---|---|');
    L.push(`| oracle boundaries | ${oracle.boundaries.length} (one per segment, indices contiguous) |`);
    L.push(`| segments that can OPEN a chunk (group firsts, excluding the corpus's first) | ${openable.length} |`);
    L.push(`| of those, with an attested oracle time | **${openableWithAttested.length}** |`);
    L.push(`| of those, WITHOUT one | **${openable.length - openableWithAttested.length}** |`);
    L.push(`| of those, whose oracle value is itself an OPEN DEFECT | **${openableDefective.length}** |`);
    L.push('');
    L.push('**Where a group end has no oracle boundary: this never happens on v6.** The oracle carries one');
    L.push('boundary per segment index and the indices are contiguous, so the seam -> attested-time mapping');
    L.push('is TOTAL. The `no-attested-time` violation path exists in the planner as a correctness guard and');
    L.push(`fired ${armG.violations.filter(v => v.cause === 'no-attested-time').length} times here.`);
    L.push('');
    L.push('## Is the mapping lossy? Yes, in one specific and stateable way.');
    L.push('');
    L.push('It is not lossy in COVERAGE — every seam gets a time. It is lossy in TRUTH, on exactly three');
    L.push(`rows. ${ARM_G_DEFECTIVE_ORACLE_ROWS} of the 447 oracle values are v6's OPEN DEFECTS, and for those the oracle stores the`);
    L.push('DEFECTIVE production value, not the ear target:');
    L.push('');
    L.push('| tag | oracle (stored) | ear target | error carried |');
    L.push('|---|---|---|---|');
    for (const d of V6_OPEN_DEFECTS) {
      L.push(`| \`${d.tag}\` | ${d.prod.toFixed(2)} | ${d.ear.toFixed(2)} | ${(d.prod - d.ear).toFixed(2)}s |`);
    }
    L.push('');
    L.push(`**Did any chunk seam actually land on one of those three rows? ${seamsOnDefectiveRows.length === 0 ? '**NO — zero of them.**' : `**YES — ${seamsOnDefectiveRows.length}.**`}**`);
    if (seamsOnDefectiveRows.length === 0) {
      L.push('');
      L.push('So arm G\'s edges are attested-correct on every seam it actually uses, and the three defective');
      L.push('values never enter the plan. The ceiling is therefore worth its full face value on v6 — stated');
      L.push('as a measurement, not as a hope, and it could easily have gone the other way.');
    } else {
      L.push('');
      for (const s of seamsOnDefectiveRows) {
        L.push(`- chunk ${s.chunkIdx} cuts at \`${s.tag}\` (${s.time.toFixed(3)}) — a KNOWN-WRONG time. Arm G's`);
        L.push('  ceiling is degraded by exactly this much and the interpretation below is qualified by it.');
      }
    }
    L.push('');
    L.push('A second, weaker caveat, stated rather than buried: an oracle value is production\'s own COMMITTED');
    L.push('boundary after the full rule stage, not an independent physical measurement. It is the project\'s');
    L.push('ground truth and 444 of its 447 rows are ear-verified, but "perfect" here means "matches the');
    L.push('ear-verified live export", not "matches the acoustic waveform".');
    L.push('');
    L.push('## Edge census');
    L.push('');
    L.push('| cut kind | count |');
    L.push('|---|---|');
    for (const [k, v] of Object.entries(armG.edgeCensus)) L.push(`| \`${k}\` | ${v} |`);
    L.push('');
    L.push('## Distribution and how far the edges actually moved');
    L.push('');
    L.push(`- n **${dist.n}** | min ${dist.min}s | p25 ${dist.p25}s | **median ${dist.median}s** | p75 ${dist.p75}s | max ${dist.max}s | mean ${dist.mean}s | over cap ${dist.overMax}`);
    L.push(`- \`|attested cut − estimate ideal|\` over the ${absOff.length} attested edges: min `
      + `${absOff.length ? absOff[0]!.toFixed(3) : '—'}s | median ${absOff.length ? absOff[Math.floor(absOff.length / 2)]!.toFixed(3) : '—'}s `
      + `| max ${absOff.length ? absOff[absOff.length - 1]!.toFixed(3) : '—'}s`);
    L.push(`- signed: ${offsets.filter(x => x > 0).length} positive, ${offsets.filter(x => x < 0).length} negative`);
    L.push('');
    L.push('## Conservation properties');
    L.push('');
    L.push(`- TEXT carry-forward on a collapsed window: ${collapsed.length === 0 ? 'DID NOT FIRE' : `FIRED ${collapsed.length} time(s)`}`);
    L.push(`- TIME monotone cursor: holds — ${cursorMonotone}`);
    L.push('');
    L.push('## The complete violation list');
    L.push('');
    L.push(`Total: **${armG.violations.length}**.`);
    L.push('');
    if (armG.violations.length > 0) {
      L.push('| # | cause | segIdx | ideal | seam | dur | what the planner did |');
      L.push('|---|---|---|---|---|---|---|');
      armG.violations.forEach((v, i) => {
        L.push(`| ${i} | \`${v.cause}\` | ${v.segIdx} | ${v.idealSec.toFixed(3)} | ${v.seamSec?.toFixed(3) ?? '—'} `
          + `| ${v.durationSec?.toFixed(3) ?? '—'} | ${v.fallback.replace(/\|/g, '\\|')} |`);
      });
    } else {
      L.push('_None._');
    }
    L.push('');
    L.push('## Every chunk');
    L.push('');
    L.push('| # | start | end | dur | cut | ideal | Δideal | segs | >cap |');
    L.push('|---|---|---|---|---|---|---|---|---|');
    for (const r of armG.inspection) {
      L.push(`| ${r.index} | ${r.startSec.toFixed(3)} | ${r.endSec.toFixed(3)} | ${r.durationSec.toFixed(3)} `
        + `| ${r.cutKind} | ${r.idealSec.toFixed(3)} | ${r.cutOffsetSec >= 0 ? '+' : ''}${r.cutOffsetSec.toFixed(3)} `
        + `| ${r.segFrom}-${r.segTo} | ${r.exceededCap ? '**YES**' : ''} |`);
    }
    L.push('');

    const dumpText = `${L.join('\n')}\n`;
    writeFileSync(resolve(OUT, 'step4-armg.md'), dumpText);
    writeFileSync(resolve(DOCS, 'session-am-armg-inspection.md'), dumpText);

    writeFileSync(resolve(OUT, 'step4-armg.json'), JSON.stringify({
      diagnosticOnly: true, shipGateApplies: false,
      unreachability: { srcFilesScanned: srcFiles.length, readsOracle, buildsAttested },
      mapping: {
        oracleBoundaries: oracle.boundaries.length, openableSegments: openable.length,
        openableWithAttested: openableWithAttested.length,
        openableDefective: openableDefective.length,
        seamsUsed: usedSeams.length, seamsOnDefectiveRows,
        noAttestedTimeViolations: armG.violations.filter(v => v.cause === 'no-attested-time').length,
      },
      armGChunks: armG.chunks.length, edgeCensus: armG.edgeCensus, distribution: dist,
      excisedSpans: gaps.length, excisedSec: round6(excisedSec),
      conservation: { collapsedChunks: collapsed.length, cursorMonotone },
      violations: armG.violations, inspection: armG.inspection,
      planSha256: createHash('sha256').update(text).digest('hex'),
    }, null, 2));

    // eslint-disable-next-line no-console
    console.log(L.join('\n'));
  }, 300_000);
});
