/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// ---------------------------------------------------------------------------
// WS1 Session AH — STEP 4. VALIDATE THE NO-EARS PROXY.
//
// THE QUESTION. S1 was shipped to measurement on a collateral ratio and cost an
// 18-row listening session to refute. If a candidate change's moves could be
// scored WITHOUT ears, that session would not have been needed. So: is there a
// signal, derivable from artifacts alone, that separates a KNOWN-GOOD boundary
// value from a KNOWN-BAD proposed one?
//
// THE TWO LABELLED SETS (the whole reason this is answerable at all):
//   * POSITIVE — boundaries whose CURRENTLY COMMITTED value the ledger
//     authorises as CORRECT. A proxy must NOT flag these.
//   * NEGATIVE — `S1_KNOWN_BAD_MOVES`, each an ear-rejected proposed value at a
//     real seam. A proxy MUST flag these.
// Session AH Step 1 verified the two are disjoint, so separation is measurable
// rather than definitional.
//
// THE PROXY, and why every constant in it is GEOMETRIC. The candidate value V at
// seam (i-1, i) is scored against the seam's own WORD GAP — the interval between
// the outgoing segment's last claimed FA word ending and the incoming segment's
// first claimed FA word beginning:
//
//   gap = [outgoingEnd, incomingOnset]
//
// Both endpoints are measured quantities from the aligner, not thresholds. The
// proxy FLAGS V when it falls outside that gap: a V past `incomingOnset` clips
// speech the incoming segment itself claims, and a V before `outgoingEnd` clips
// the outgoing segment's own last word. Those are ORDER comparisons between two
// measured times — no tuning surface. The only number is the +/-50ms tolerance,
// which is the Zero-Defect Register's own standing tolerance (it predates these
// rows by many sessions and was not chosen against them); it is nonetheless
// given two-sided sensitivity and LOOCV below, because it is the single
// constant and its influence has to be shown rather than asserted.
//
// A SECOND SIGNAL is scored alongside, because the brief names it: the incoming
// segment's first-word FA CONFIDENCE (the phantom signal), against production's
// own `CONF_MIN_FALLBACK`. It is reported separately so its contribution is
// visible rather than blended away.
//
// Gated: WS1_SESSION_AH_MEASURE=1 npx vitest run scripts/ws1-session-ah-step4-proxy.test.ts
// ---------------------------------------------------------------------------

import { describe, it } from 'vitest';
import { writeFileSync, mkdirSync } from 'fs';
import { resolve } from 'path';

import { CORPORA, runProductionPath, tagOf, REPO } from './ws1-session-p-pipeline.js';
import { S1_KNOWN_BAD_MOVES, earHistory } from './ws1-ear-pass-ledger.js';
import type { Corpus } from './ws1-ear-pass-ledger.js';
import { CONF_MIN_FALLBACK } from '../src/services/syncConstants';
import type { TranscriptToken } from '../src/types';

const MEASURE = process.env.WS1_SESSION_AH_MEASURE === '1';
const OUT = resolve(REPO, '.work-phase4/session-ah');

/** The register's own standing tolerance. GEOMETRIC in the sense that matters:
 *  it predates these labelled rows and was not derived from them. */
const TOL_SEC = 0.050;

interface Seam {
  corpus: Corpus;
  tag: string;
  /** The value under test. */
  candidate: number;
  label: 'GOOD' | 'BAD';
  outgoingEnd: number | null;
  incomingOnset: number | null;
  incomingConf: number | null;
}

/** Builds the seam geometry for every committed segment of one corpus. */
async function seamsFor(key: Corpus): Promise<Map<string, {
  committed: number; outgoingEnd: number | null; incomingOnset: number | null; incomingConf: number | null;
}>> {
  const run = await runProductionPath(CORPORA[key]!);
  const usable: TranscriptToken[] = run.usableFaTokens;
  const out = new Map<string, {
    committed: number; outgoingEnd: number | null; incomingOnset: number | null; incomingConf: number | null;
  }>();
  for (let i = 0; i < run.committed.length; i++) {
    const a = run.keptAlignments[i]!;
    const prev = i > 0 ? run.keptAlignments[i - 1] : undefined;
    const firstTok = a.firstTokenIdx >= 0 ? usable[a.firstTokenIdx] : undefined;
    const lastPrevTok = prev && prev.lastTokenIdx >= 0 ? usable[prev.lastTokenIdx] : undefined;
    out.set(tagOf(run.committed[i]!), {
      committed: run.committed[i]!.startTime,
      outgoingEnd: lastPrevTok?.endSec ?? null,
      incomingOnset: firstTok?.startSec ?? null,
      incomingConf: firstTok?.confidence ?? null,
    });
  }
  return out;
}

/** THE PROXY. Returns true = FLAG (this value is structurally wrong). */
const flagsGap = (s: Seam, tol: number): boolean => {
  if (s.incomingOnset === null) return false;   // no evidence -> never flag on absence
  if (s.candidate > s.incomingOnset + tol) return true;
  if (s.outgoingEnd !== null && s.candidate < s.outgoingEnd - tol) return true;
  return false;
};
const flagsConf = (s: Seam): boolean =>
  s.incomingConf !== null && s.incomingConf < CONF_MIN_FALLBACK;

function score(seams: readonly Seam[], predicate: (s: Seam) => boolean): {
  tp: number; fp: number; fn: number; tn: number; precision: number; recall: number;
} {
  let tp = 0, fp = 0, fn = 0, tn = 0;
  for (const s of seams) {
    const f = predicate(s);
    if (s.label === 'BAD') { if (f) tp++; else fn++; }
    else { if (f) fp++; else tn++; }
  }
  return {
    tp, fp, fn, tn,
    precision: tp + fp === 0 ? NaN : tp / (tp + fp),
    recall: tp + fn === 0 ? NaN : tp / (tp + fn),
  };
}

describe.skipIf(!MEASURE)('WS1 Session AH Step 4 — no-ears proxy validation', () => {
  it('scores the proxy against both labelled sets', async () => {
    mkdirSync(OUT, { recursive: true });
    const L: string[] = [];
    const seams: Seam[] = [];
    const geomByCorpus = new Map<Corpus, Awaited<ReturnType<typeof seamsFor>>>();
    for (const key of ['v6', '173', 'spanish'] as const) geomByCorpus.set(key, await seamsFor(key));

    // ---- NEGATIVE set: the known-bad proposed values ---------------------
    const missingNeg: string[] = [];
    for (const m of S1_KNOWN_BAD_MOVES) {
      const g = geomByCorpus.get(m.corpus)!.get(m.tag);
      if (!g) { missingNeg.push(`${m.corpus}/${m.tag}`); continue; }
      seams.push({
        corpus: m.corpus, tag: m.tag, candidate: m.proposedValue, label: 'BAD',
        outgoingEnd: g.outgoingEnd, incomingOnset: g.incomingOnset, incomingConf: g.incomingConf,
      });
    }

    // ---- POSITIVE set: committed values the ledger authorises ------------
    // Defined against PRODUCTION, not against the ledger alone: a ledger row
    // saying "this VALUE is correct" is not the same claim as "the boundary
    // production commits here is correct" (`lethal_nature_hazard` has an
    // ear-CORRECT target at 19.27 while production commits 18.51, scored
    // EARLY — that boundary SHOULD be flagged, and counting it as a control
    // would be scoring the proxy against a defect).
    const controls: string[] = [];
    for (const key of ['v6', '173', 'spanish'] as const) {
      for (const [tag, g] of geomByCorpus.get(key)!) {
        const h = earHistory(key, tag).filter(
          r => r.scoredValue !== null && Math.abs(r.scoredValue - g.committed) < TOL_SEC);
        if (h[0]?.verdict !== 'CORRECT') continue;
        // A boundary that is BOTH a control and a known-bad seam is still fine:
        // the candidate values differ (Step 1 proved the sets disjoint by value).
        controls.push(`${key}/${tag}`);
        seams.push({
          corpus: key, tag, candidate: g.committed, label: 'GOOD',
          outgoingEnd: g.outgoingEnd, incomingOnset: g.incomingOnset, incomingConf: g.incomingConf,
        });
      }
    }

    const good = seams.filter(s => s.label === 'GOOD');
    const bad = seams.filter(s => s.label === 'BAD');

    L.push('# WS1 Session AH Step 4 — no-ears proxy validation (MEASURED)');
    L.push('');
    L.push(`Tolerance **+/-${(TOL_SEC * 1000).toFixed(0)} ms**, stated. Positive set = boundaries whose`);
    L.push('COMMITTED value the ledger authorises as CORRECT (must not flag). Negative set =');
    L.push('`S1_KNOWN_BAD_MOVES` proposed values (must flag).');
    L.push('');
    L.push(`- positive (controls): **${good.length}**`);
    L.push(`- negative (known-bad moves): **${bad.length}**`);
    if (missingNeg.length) L.push(`- known-bad rows with no committed seam: ${missingNeg.join(', ')}`);
    L.push('');

    // ---- The two signals, scored separately then together ---------------
    const variants: Array<{ name: string; pred: (s: Seam) => boolean; constants: string }> = [
      { name: 'A. word-gap containment (candidate outside [outgoingEnd, incomingOnset])',
        pred: s => flagsGap(s, TOL_SEC), constants: 'TOL_SEC=0.050 (GEOMETRIC — register standing tolerance)' },
      { name: 'A-late. candidate PAST incomingOnset only',
        pred: s => s.incomingOnset !== null && s.candidate > s.incomingOnset + TOL_SEC,
        constants: 'TOL_SEC=0.050 (GEOMETRIC)' },
      { name: 'B. incoming first-word confidence < CONF_MIN_FALLBACK (the phantom signal)',
        pred: flagsConf, constants: `CONF_MIN_FALLBACK=${CONF_MIN_FALLBACK} (GEOMETRIC — production constant)` },
      { name: 'A OR B', pred: s => flagsGap(s, TOL_SEC) || flagsConf(s), constants: 'both of the above' },
    ];

    L.push('## Scores');
    L.push('');
    L.push('| proxy variant | TP | FP | FN | TN | precision | recall | constants |');
    L.push('|---|---|---|---|---|---|---|---|');
    const results: Record<string, unknown> = {};
    for (const v of variants) {
      const r = score(seams, v.pred);
      results[v.name] = r;
      L.push(`| ${v.name} | ${r.tp} | ${r.fp} | ${r.fn} | ${r.tn} | `
        + `${Number.isNaN(r.precision) ? 'n/a' : r.precision.toFixed(3)} | `
        + `${Number.isNaN(r.recall) ? 'n/a' : r.recall.toFixed(3)} | ${v.constants} |`);
    }
    L.push('');

    // ---- Separation margin ---------------------------------------------
    // The continuous quantity behind signal A: how far past incomingOnset the
    // candidate sits. Negative = inside/before the onset (safe).
    const overshoot = (s: Seam): number | null =>
      s.incomingOnset === null ? null : s.candidate - s.incomingOnset;
    const goodOver = good.map(overshoot).filter((x): x is number => x !== null);
    const badOver = bad.map(overshoot).filter((x): x is number => x !== null);
    const maxGood = Math.max(...goodOver);
    const minBad = Math.min(...badOver);
    L.push('## Separation margin (signal A\'s underlying continuous quantity)');
    L.push('');
    L.push('`overshoot = candidate - incomingOnset`. Positive means the cut lands after the incoming');
    L.push('segment\'s own first word has begun.');
    L.push('');
    L.push('| set | n | min | median | max |');
    L.push('|---|---|---|---|---|');
    const med = (xs: number[]): number => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]!;
    L.push(`| GOOD (controls) | ${goodOver.length} | ${Math.min(...goodOver).toFixed(3)} | ${med(goodOver).toFixed(3)} | **${maxGood.toFixed(3)}** |`);
    L.push(`| BAD (known-bad) | ${badOver.length} | **${minBad.toFixed(3)}** | ${med(badOver).toFixed(3)} | ${Math.max(...badOver).toFixed(3)} |`);
    L.push('');
    const margin = minBad - maxGood;
    L.push(`**Separation margin = min(BAD) - max(GOOD) = ${minBad.toFixed(3)} - ${maxGood.toFixed(3)} = ${margin.toFixed(3)}s.**`);
    L.push(margin > 0
      ? `Positive: the two sets are linearly separable on this signal, with ${margin.toFixed(3)}s of clear air.`
      : `NOT positive: the sets OVERLAP by ${(-margin).toFixed(3)}s on this signal. No threshold on it alone can separate them.`);
    L.push('');

    // ---- Sensitivity on the one constant --------------------------------
    L.push('## Two-sided sensitivity on TOL_SEC (the only constant)');
    L.push('');
    L.push('| TOL_SEC | TP | FP | FN | TN | precision | recall |');
    L.push('|---|---|---|---|---|---|---|');
    for (const mult of [0.90, 0.95, 1.00, 1.05, 1.10]) {
      const t = TOL_SEC * mult;
      const r = score(seams, s => flagsGap(s, t));
      L.push(`| ${t.toFixed(4)}s (${((mult - 1) * 100).toFixed(0)}%) | ${r.tp} | ${r.fp} | ${r.fn} | ${r.tn} | `
        + `${Number.isNaN(r.precision) ? 'n/a' : r.precision.toFixed(3)} | ${Number.isNaN(r.recall) ? 'n/a' : r.recall.toFixed(3)} |`);
    }
    L.push('');

    // ---- LOOCV ----------------------------------------------------------
    // The constant is not fitted, so LOOCV cannot change it; it is run anyway
    // because the brief requires it, and a stable result is itself evidence the
    // constant is not doing hidden work.
    let loocvCorrect = 0;
    for (let i = 0; i < seams.length; i++) {
      const held = seams[i]!;
      const pred = flagsGap(held, TOL_SEC);
      if ((held.label === 'BAD') === pred) loocvCorrect++;
    }
    L.push('## LOOCV over the labelled set');
    L.push('');
    L.push(`Leave-one-out accuracy: **${loocvCorrect}/${seams.length} = ${(loocvCorrect / seams.length).toFixed(3)}**.`);
    L.push('`TOL_SEC` is not fitted to these rows (it is the register\'s standing tolerance), so each');
    L.push('fold\'s decision rule is identical to the full-set rule — the number is a sanity check, not');
    L.push('a model-selection result.');
    L.push('');

    // ---- Per-row detail -------------------------------------------------
    L.push('## Per-row detail — negative set');
    L.push('');
    L.push('| corpus | tag | proposed | outgoingEnd | incomingOnset | overshoot | conf | flagged (A) |');
    L.push('|---|---|---|---|---|---|---|---|');
    for (const s of bad) {
      L.push(`| ${s.corpus} | \`${s.tag}\` | ${s.candidate.toFixed(3)} | ${s.outgoingEnd?.toFixed(3) ?? '—'} `
        + `| ${s.incomingOnset?.toFixed(3) ?? '—'} | ${overshoot(s)?.toFixed(3) ?? '—'} `
        + `| ${s.incomingConf?.toExponential(2) ?? '—'} | ${flagsGap(s, TOL_SEC) ? '**YES**' : 'no'} |`);
    }
    L.push('');
    L.push('## Per-row detail — positive set, FALSE POSITIVES only');
    L.push('');
    const fps = good.filter(s => flagsGap(s, TOL_SEC));
    if (fps.length === 0) L.push('None.');
    else {
      L.push('| corpus | tag | committed | outgoingEnd | incomingOnset | overshoot | conf |');
      L.push('|---|---|---|---|---|---|---|');
      for (const s of fps) {
        L.push(`| ${s.corpus} | \`${s.tag}\` | ${s.candidate.toFixed(3)} | ${s.outgoingEnd?.toFixed(3) ?? '—'} `
          + `| ${s.incomingOnset?.toFixed(3) ?? '—'} | ${overshoot(s)?.toFixed(3) ?? '—'} | ${s.incomingConf?.toExponential(2) ?? '—'} |`);
      }
    }

    writeFileSync(resolve(OUT, 'step4-proxy.md'), L.join('\n'));
    writeFileSync(resolve(OUT, 'step4-proxy.json'), JSON.stringify({
      controls, results, margin, maxGood, minBad,
      seams: seams.map(s => ({ ...s, overshoot: overshoot(s) })),
    }, null, 2));
    console.log(L.join('\n'));
  }, 900_000);
});
