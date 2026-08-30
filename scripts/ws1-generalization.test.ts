/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// ---------------------------------------------------------------------------
// WS1 Session P, Step 7b(a) — GENERALIZATION GUARD.
//
// The standing risk in this workstream is that a rule stops being a rule and
// becomes a lookup table for the v6 corpus. This file makes that
// machine-checked instead of a matter of reviewer vigilance.
//
// THREE TIERS, deliberately different in strictness:
//
//  1. EAR-LIST TIMESTAMPS — banned OUTRIGHT from src/ and src-tauri/src, in
//     code AND in comments. These are the 18 open rows plus the 4 regression
//     pins of Session P's ear pass. A rule that names one has been fitted to
//     the audio that produced it. This is the tier that actually prevents
//     overfitting, and it passes today with zero exceptions.
//
//  2. CORPUS IDENTIFIERS IN EXECUTABLE CODE — banned. A scene tag, project
//     name or corpus filename in a live expression means production behaviour
//     branches on which project is loaded. Comments are stripped before this
//     check.
//
//  3. CORPUS IDENTIFIERS IN COMMENTS — ALLOWED, but only in an explicit
//     allowlist of files that already carry measured provenance (which
//     constant was derived from which observation, and what the nearest
//     negative was). CLAUDE.md requires that provenance be recorded; deleting
//     it would cost more than it buys. The allowlist stops the practice from
//     spreading to new files unnoticed.
//
// SCOPE NOTE, stated plainly: tier 3 is a deliberate narrowing of "no
// production file contains any project id or name". Tiers 1 and 2 enforce the
// substance — no fitted value and no corpus-dependent behaviour ship. Tier 3
// keeps the evidence trail that CLAUDE.md's own documentation rules ask for.
// ---------------------------------------------------------------------------

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'fs';
import { resolve, dirname, relative } from 'path';
import { fileURLToPath } from 'url';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ROOTS = [resolve(REPO, 'src'), resolve(REPO, 'src-tauri/src')];
const EXT = /\.(ts|tsx|rs)$/;

/** Session P's ear pass: every boundary value it names, committed or corrected. */
const EAR_LIST_TIMESTAMPS = [
  // Class A — R.11 declined (committed -> ear-correct)
  '449.20', '450.99', '629.01', '630.09', '681.63', '682.74', '1417.12', '1418.53',
  // Class A — already fixed, regression pins
  '571.07', '671.16', '684.09', '686.54',
  // Class B — minor
  '167.03', '167.70', '494.43', '494.75', '856.09', '856.52',
  '1266.21', '1266.66', '1273.14', '1273.55',
];

/** Scene tags, project names and corpus filenames from the WS1 corpora. */
const CORPUS_IDENTIFIERS = [
  'frozen_brush_mice', 'four_scouts', 'scout_listening', 'night_circle',
  'abysmal_opinion', 'perilous_realms', 'blue_monkey',
  'Natural Long Pause', '173 Segs', 'Spanish Project', 'Spanish VOiceover',
  'All Projects Test Data',
];

/** Files permitted to cite corpus identifiers IN COMMENTS ONLY (tier 3). */
const PROVENANCE_ALLOWLIST = new Set([
  'src/types.ts',
  'src/services/faSeamFitGate.ts',
  'src/services/faRunPlacementGate.ts',
  'src/services/syncConstants.ts',
  'src/services/syncLog.ts',
  // WS1 Session AE. R.14/R.15's header records, per conjunct, which measured
  // observation the conjunct exists for and which ear-CORRECT control is the
  // nearest thing it declines — `192_scout_listening` among them, which is the
  // identifier that puts this file here. That is exactly the provenance tier 3
  // exists to preserve, and tiers 1 and 2 (no ear-list timestamp, no corpus
  // identifier in executable code) both pass on this file unaided.
  'src/services/faAnchorTrustGate.ts',
  // WS2 session ws2-26 Commit 1. The refusal-rule header names `blue_monkey`
  // (173) as the measured decoy row the old width clause let through — a 0.88s
  // gap, 0 orphan tokens — against `perilous_realms` (173) and v6 027-029 as
  // the nearest correctly-refused controls with the identical zero-orphan
  // evidence. That comparison is the provenance tier 3 exists to preserve.
  'src/services/absorbedGapRestore.ts',
]);

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const p = resolve(dir, entry);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (EXT.test(entry)) out.push(p);
  }
  return out;
}

/** Production files only — a test fixture may legitimately name its corpus. */
const productionFiles = (): string[] =>
  ROOTS.flatMap(r => walk(r)).filter(f => !/\.test\.tsx?$/.test(f));

/** Strips // line comments and block comments. String-literal `//` (URLs) is
 *  tolerated by requiring the `//` to not be preceded by a `:`. */
function stripComments(src: string): string {
  const noBlock = src.replace(/\/\*[\s\S]*?\*\//g, ' ');
  return noBlock.split('\n').map(line => {
    const i = line.indexOf('//');
    if (i < 0) return line;
    if (i > 0 && line[i - 1] === ':') return line;
    return line.slice(0, i);
  }).join('\n');
}

/** Matches a decimal literal without matching it inside a longer number. */
const containsNumber = (hay: string, needle: string): boolean =>
  new RegExp(`(?<![\\d.])${needle.replace('.', '\\.')}(?![\\d])`).test(hay);

describe('WS1 Session P — generalization guard (Step 7b(a))', () => {
  it('tier 1: no ear-list boundary timestamp appears anywhere in production source', () => {
    const violations: string[] = [];
    for (const file of productionFiles()) {
      const src = readFileSync(file, 'utf-8');
      for (const ts of EAR_LIST_TIMESTAMPS) {
        if (containsNumber(src, ts)) violations.push(`${relative(REPO, file)}: ${ts}`);
      }
    }
    expect(violations, 'a rule naming an ear-pass boundary value has been fitted to v6 audio').toEqual([]);
  });

  it('tier 2: no corpus identifier appears in executable code', () => {
    const violations: string[] = [];
    for (const file of productionFiles()) {
      const code = stripComments(readFileSync(file, 'utf-8'));
      for (const id of CORPUS_IDENTIFIERS) {
        if (code.includes(id)) violations.push(`${relative(REPO, file)}: ${id}`);
      }
    }
    expect(violations, 'production behaviour must not branch on which corpus is loaded').toEqual([]);
  });

  it('tier 3: corpus identifiers in comments stay inside the provenance allowlist', () => {
    const offenders = new Set<string>();
    for (const file of productionFiles()) {
      const src = readFileSync(file, 'utf-8');
      const rel = relative(REPO, file);
      if (CORPUS_IDENTIFIERS.some(id => src.includes(id)) && !PROVENANCE_ALLOWLIST.has(rel)) {
        offenders.add(rel);
      }
    }
    expect([...offenders], 'new file citing a corpus identifier — add measured provenance or drop the reference')
      .toEqual([]);
  });
});
