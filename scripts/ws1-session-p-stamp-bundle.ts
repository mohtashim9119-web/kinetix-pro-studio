/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// ---------------------------------------------------------------------------
// WS1 Session P — STAMP ONE LIVE-FIDELITY BUNDLE.
//
// Mints a single run id and writes it into every arm of a corpus's bundle in
// one pass, recording each arm's post-stamp sha256 in `run_manifest.json`.
// This is the ONLY supported way to stamp: stamping arms one at a time is how
// a mixed-vintage bundle gets created in the first place, which is the exact
// defect Session P Step 2 spent its budget diagnosing.
//
// Run:  npx tsx scripts/ws1-session-p-stamp-bundle.ts [corpus]   (default v6)
// ---------------------------------------------------------------------------

import { existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { mintRunId, stampArm, writeManifest, verifyBundle, V6_BUNDLE_ARMS, type RunManifest } from './ws1-runid.js';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const corpus = process.argv[2] ?? 'v6';
const dir = resolve(REPO, '.work-phase4/replay', corpus);

const missing = Object.entries(V6_BUNDLE_ARMS).filter(([, f]) => !existsSync(resolve(dir, f)));
if (missing.length > 0) {
  console.error(`Cannot stamp ${corpus}: missing arm(s) — ${missing.map(([n, f]) => `${n} (${f})`).join(', ')}`);
  process.exit(1);
}

const runId = mintRunId();
const arms: RunManifest['arms'] = {};
for (const [name, file] of Object.entries(V6_BUNDLE_ARMS)) {
  const { sha256, count } = stampArm(resolve(dir, file), runId);
  arms[name] = { file, sha256, count };
  console.log(`  stamped ${name.padEnd(10)} ${file.padEnd(26)} count=${String(count).padStart(5)}  sha=${sha256.slice(0, 12)}…`);
}
writeManifest(dir, { runId, mintedAt: new Date().toISOString(), arms });

const verdict = verifyBundle(dir, V6_BUNDLE_ARMS);
console.log(`\nrunId: ${runId}`);
console.log(verdict.ok ? 'bundle VERIFIED — all arms share one run id and match the manifest' : `bundle FAILED:\n  ${verdict.problems.join('\n  ')}`);
process.exit(verdict.ok ? 0 : 1);
