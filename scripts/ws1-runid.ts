/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// ---------------------------------------------------------------------------
// WS1 Session P — THE SHARED RUN ID.
//
// WHY THIS EXISTS (measured, not defensive). Session P Step 2 found the
// harness reproducing 277 chunks against a captured production plan of 280.
// The captured plan, the captured FA words, the silences and the raw Whisper
// tokens had each been generated at a DIFFERENT time, by a different command,
// and nothing on any of them recorded that fact. Four arms of one "bundle"
// were four vintages, and the only symptom was a rule firing set that would
// not converge.
//
// A run id fixes that by construction: every arm of a bundle carries the same
// `_runId`, and a manifest records each arm's sha256 at stamp time. Two
// failure modes are then machine-detectable rather than folklore:
//
//   * MIXED VINTAGE — two arms carry different `_runId`s. Someone regenerated
//     one arm and not the others.
//   * SILENT EDIT — an arm's `_runId` matches but its sha256 does not match
//     the manifest. The file changed after it was stamped, so its id is a
//     lie.
//
// The id itself is deliberately NOT content-derived. A content hash would
// change when an arm legitimately changes, which is the opposite of what is
// wanted: the id answers "were these produced by the same regeneration pass",
// and only the manifest's per-arm sha256 answers "is this arm still what it
// was". Conflating the two would let a restamp silently launder a stale arm.
// ---------------------------------------------------------------------------

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { createHash, randomBytes } from 'crypto';
import { resolve } from 'path';

/** Marker key written into every stamped arm file. Underscore-prefixed to sit
 *  beside the `_provenance` convention `fa_production_words.json` already uses
 *  and to stay clear of any real data key. */
export const RUN_ID_KEY = '_runId';

export interface RunManifest {
  runId: string;
  mintedAt: string;
  /** Arm logical name -> what was stamped. `count` is the arm's own primary
   *  array length (silences/tokens/words/chunks), recorded so a truncated
   *  regeneration is visible in the manifest without opening the file. */
  arms: Record<string, { file: string; sha256: string; count: number }>;
}

export const MANIFEST_FILE = 'run_manifest.json';

/** `p-20260819T164500Z-1a2b3c4d` — sortable, obviously Session P, and unique
 *  per pass. Random suffix so two passes in the same second cannot collide. */
export function mintRunId(now: Date = new Date()): string {
  const stamp = now.toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
  return `p-${stamp}-${randomBytes(4).toString('hex')}`;
}

export const sha256File = (path: string): string =>
  createHash('sha256').update(readFileSync(path)).digest('hex');

/** Reads the arm's primary array length, whichever key holds it. Returns -1
 *  when the shape is unrecognized rather than throwing — the caller reports
 *  it, and an unrecognized arm is itself worth seeing in the manifest. */
function armCount(json: unknown): number {
  if (Array.isArray(json)) return json.length;
  if (json && typeof json === 'object') {
    for (const key of ['silences', 'tokens', 'words', 'chunks']) {
      const v = (json as Record<string, unknown>)[key];
      if (Array.isArray(v)) return v.length;
    }
  }
  return -1;
}

/** Writes `_runId` into one arm file in place, preserving key order by
 *  reserializing the parsed object with the id first. Returns its sha256
 *  AFTER stamping — the manifest must record the bytes that end up on disk,
 *  not the bytes before the stamp, or every verification would fail. */
export function stampArm(path: string, runId: string): { sha256: string; count: number } {
  const json = JSON.parse(readFileSync(path, 'utf-8')) as unknown;
  const count = armCount(json);
  // The spread MUST NOT carry a previous `_runId` through: `{ [K]: id,
  // ...json }` silently re-applies the OLD id when `json` already has the key,
  // so a restamp would appear to succeed and leave a mixed-vintage bundle.
  // (Measured: it did exactly that on the first restamp of the v6 bundle.)
  const rest = Array.isArray(json) ? undefined : { ...(json as Record<string, unknown>) };
  if (rest) delete rest[RUN_ID_KEY];
  const stamped = rest ? { [RUN_ID_KEY]: runId, ...rest } : { [RUN_ID_KEY]: runId, items: json };
  writeFileSync(path, `${JSON.stringify(stamped, null, 2)}\n`);
  return { sha256: sha256File(path), count };
}

export function readArmRunId(path: string): string | undefined {
  if (!existsSync(path)) return undefined;
  const json = JSON.parse(readFileSync(path, 'utf-8')) as Record<string, unknown>;
  const id = json[RUN_ID_KEY];
  return typeof id === 'string' ? id : undefined;
}

export function writeManifest(dir: string, manifest: RunManifest): void {
  writeFileSync(resolve(dir, MANIFEST_FILE), `${JSON.stringify(manifest, null, 2)}\n`);
}

export function readManifest(dir: string): RunManifest | undefined {
  const path = resolve(dir, MANIFEST_FILE);
  if (!existsSync(path)) return undefined;
  return JSON.parse(readFileSync(path, 'utf-8')) as RunManifest;
}

export interface BundleVerdict {
  ok: boolean;
  runId?: string;
  /** Human-readable reasons, empty iff `ok`. Every failure names the arm. */
  problems: string[];
}

/**
 * The Step 9 guard, as a pure function so both the guard test and any ad-hoc
 * check share one implementation. Fails if ANY arm is missing, unstamped,
 * carries a different id than its siblings, is absent from the manifest, or
 * no longer hashes to what the manifest recorded.
 */
export function verifyBundle(dir: string, armFiles: Record<string, string>): BundleVerdict {
  const problems: string[] = [];
  const manifest = readManifest(dir);
  if (!manifest) return { ok: false, problems: [`no ${MANIFEST_FILE} in ${dir} — bundle was never stamped`] };

  const ids = new Map<string, string>();
  for (const [name, file] of Object.entries(armFiles)) {
    const path = resolve(dir, file);
    if (!existsSync(path)) { problems.push(`${name}: missing (${file})`); continue; }
    const id = readArmRunId(path);
    if (!id) { problems.push(`${name}: no ${RUN_ID_KEY} — unstamped arm`); continue; }
    ids.set(name, id);
    if (id !== manifest.runId) {
      problems.push(`${name}: runId ${id} != manifest runId ${manifest.runId} — MIXED VINTAGE`);
    }
    const recorded = manifest.arms[name];
    if (!recorded) { problems.push(`${name}: stamped but absent from manifest`); continue; }
    const actual = sha256File(path);
    if (actual !== recorded.sha256) {
      problems.push(`${name}: sha256 ${actual.slice(0, 12)}… != manifest ${recorded.sha256.slice(0, 12)}… — SILENT EDIT after stamping`);
    }
  }

  const distinct = new Set(ids.values());
  if (distinct.size > 1) {
    problems.push(`arms carry ${distinct.size} distinct run ids: ${[...distinct].join(', ')} — MIXED VINTAGE`);
  }
  return { ok: problems.length === 0, runId: manifest.runId, problems };
}

/** The v6 live-fidelity bundle's four arms, named once so the stamper, the
 *  guard test and the production-path test cannot disagree about membership. */
export const V6_BUNDLE_ARMS: Record<string, string> = {
  silences: 'silences_native.json',
  whisperRaw: 'whisper_raw_tokens.json',
  chunkPlan: 'fa_live_chunks.json',
  faWords: 'fa_live_words.json',
};
