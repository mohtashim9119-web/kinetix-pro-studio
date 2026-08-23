/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// ---------------------------------------------------------------------------
// WS1 Session AK — STEP 0. REPOINT 173's DEFAULT BUNDLE ARM.
//
// WHAT WAS WRONG. `.work-phase4/replay/173/run_manifest.json` stamped
// `fa_live_chunks.json` / `fa_live_words.json` (minted 2026-08-19T13:39:10Z) as
// the corpus's default. WS1 Session AH (AB.7) retired that exact arm: its
// 126-chunk plan is not reproducible from any version-controlled state by
// today's planner (which computes 119), and it MEASURED the arm committing
// 172.910 at `vessel_damage_clue` against the register's oldest positive
// assertion, 174.740 (`ear-12`, re-confirmed by `ear-173-x`). Session AH
// superseded it with a fresh HEAD recapture, `fa_ah_chunks.json` (119 chunks) /
// `fa_ah_words.json`, which commits 174.740 exactly with the other 172 of 173
// boundaries bit-identical (`.work-phase4/session-ah/step2b-fidelity.md`).
//
// Nobody repointed the default. So every unqualified
// `runProductionPath(CORPORA['173'])` — Session AI's Step 4 census (`base:
// 172.91`) and Session AJ-0's own oracle diff included — silently replayed the
// known-wrong arm. Session AJ-0 traced this to its exact cause and named the
// repoint the single highest-value next action; this is that action.
//
// WHY A MANIFEST EDIT ALONE WOULD HAVE BEEN A NO-OP, and worse than one.
// `loadLiveBundle` never read the manifest's `file` field — it resolved arm
// filenames from the hardcoded `V6_BUNDLE_ARMS`. Repointing only the manifest
// would therefore have changed nothing about which bytes get loaded, while
// making `verifyBundle` hash the OLD file against the NEW arm's sha256 and
// report a SILENT EDIT that never happened. The repoint has to happen at
// `bundleArmsFor` (`ws1-runid.ts`), where the name is actually resolved; this
// script only re-stamps the bundle so the four arms carry one vintage again.
//
// THE RETIRED ARM IS NOT DELETED. `fa_live_chunks.json` / `fa_live_words.json`
// stay on disk untouched as the historical record — only which arm is DEFAULT
// changes. `silences_native.json` and `whisper_raw_tokens.json` are carried
// forward with their CONTENT unchanged (Session AH re-derived the silences from
// audio and found them byte-identical); only their `_runId` field is rewritten,
// which is what a restamp is.
//
// Gated: WS1_SESSION_AK_REPOINT=1 npx vitest run scripts/ws1-session-ak-step0-repoint.test.ts
// ---------------------------------------------------------------------------

import { describe, it, expect } from 'vitest';
import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { resolve } from 'path';

import { CORPORA, runProductionPath, tagOf, REPO, REPLAY_ROOT } from './ws1-session-p-pipeline.js';
import { mintRunId, stampArm, writeManifest, verifyBundle, bundleArmsFor } from './ws1-runid.js';

const RUN = process.env.WS1_SESSION_AK_REPOINT === '1';
const OUT = resolve(REPO, '.work-phase4/session-ak');

/** The register's oldest positive assertion (`ear-12`, re-confirmed by
 *  `ear-173-x`). The whole point of the repoint is that the default arm
 *  reproduces it. */
const VESSEL_DAMAGE_CLUE_EAR = 174.74;

describe.skipIf(!RUN)('WS1 Session AK Step 0 — repoint 173 to the fa_ah_* arm', () => {
  it('restamps the bundle, rewrites the manifest, and reproduces vessel_damage_clue', async () => {
    mkdirSync(OUT, { recursive: true });
    const dir = resolve(REPLAY_ROOT, '173');
    const arms = bundleArmsFor('173');

    expect(arms.chunkPlan, 'bundleArmsFor must already name the AH recapture').toBe('fa_ah_chunks.json');
    expect(arms.faWords).toBe('fa_ah_words.json');
    for (const f of Object.values(arms)) {
      expect(existsSync(resolve(dir, f)), `arm file missing: ${f}`).toBe(true);
    }

    const runId = mintRunId().replace(/^p-/, 'ak-');
    const manifestArms: Record<string, { file: string; sha256: string; count: number }> = {};
    for (const [name, file] of Object.entries(arms)) {
      const { sha256, count } = stampArm(resolve(dir, file), runId);
      manifestArms[name] = { file, sha256, count };
    }
    writeManifest(dir, { runId, mintedAt: new Date().toISOString(), arms: manifestArms });

    const verdict = verifyBundle(dir, arms);
    expect(verdict.problems).toEqual([]);
    expect(verdict.ok).toBe(true);

    // The load-bearing check: the DEFAULT path (no `faWordsFile` override) now
    // reproduces the register's oldest positive assertion.
    const run = await runProductionPath(CORPORA['173']!);
    const vessel = run.committed.find(s => tagOf(s) === 'vessel_damage_clue');
    expect(vessel, 'vessel_damage_clue must be committed').toBeDefined();
    expect(vessel!.startTime).toBeCloseTo(VESSEL_DAMAGE_CLUE_EAR, 2);
    expect(run.runId).toBe(runId);

    const L = [
      '# WS1 Session AK Step 0 — 173 default-arm repoint (MEASURED)',
      '',
      `- new runId: \`${runId}\``,
      `- retired arm left on disk untouched: \`fa_live_chunks.json\` / \`fa_live_words.json\``,
      '',
      '| arm | file | sha256 | count |',
      '|---|---|---|---|',
      ...Object.entries(manifestArms).map(([n, a]) => `| ${n} | \`${a.file}\` | \`${a.sha256.slice(0, 16)}\` | ${a.count} |`),
      '',
      `- \`vessel_damage_clue\` on the DEFAULT path: **${vessel!.startTime.toFixed(3)}** (ear target ${VESSEL_DAMAGE_CLUE_EAR})`,
      `- rules fired: \`${JSON.stringify(run.fired)}\``,
      `- committed: ${run.committed.length}`,
    ].join('\n');
    writeFileSync(resolve(OUT, 'step0-repoint.md'), `${L}\n`);
    // eslint-disable-next-line no-console
    console.log(L);
  }, 300_000);
});
