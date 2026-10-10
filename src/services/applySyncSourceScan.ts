/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// Shared source-scan helper for the Apply Sync guards. Apply Sync is two
// members of App.tsx: `handleApplySyncFromFiles` (the pipeline-claim wrapper —
// the one entry point) and `applySyncFromFilesClaimed` (the work it guards).
// The guards assert the INTENT of that pair, not the line layout of either.

import { readFileSync } from 'fs';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';

const HERE = dirname(fileURLToPath(import.meta.url));
export const APP_SRC = readFileSync(resolve(HERE, '..', 'App.tsx'), 'utf-8');

export const ENTRY_MARKER = 'const handleApplySyncFromFiles = async (): Promise<ApplySyncResult> => {';
export const CLAIMED_MARKER = 'const applySyncFromFilesClaimed = async (): Promise<ApplySyncResult> => {';

function member(marker: string): string {
  const start = APP_SRC.indexOf(marker);
  if (start < 0) throw new Error(`'${marker}' not found in App.tsx — this guard has lost its target`);
  const rest = APP_SRC.slice(start + marker.length);
  const end = rest.indexOf('\n  };');
  if (end < 0) throw new Error(`no closing brace for '${marker}'`);
  return rest.slice(0, end);
}

/** The entry point (pipeline-claim wrapper) body. */
export const entryBody = (): string => member(ENTRY_MARKER);
/** The claimed work body (staged read, cloud wait, runBuildTimeline, commit). */
export const claimedBody = (): string => member(CLAIMED_MARKER);
/** Entry + work, for wiring that may live in either. */
export const applySyncBody = (): string => `${entryBody()}\n${claimedBody()}`;

/** Executable statements of a body, comments and blanks removed. */
export function statements(body: string): string[] {
  return body.split('\n').map(l => l.trim()).filter(l => l !== '' && !l.startsWith('//'));
}

/** Index of the first `await ` in a body with comments stripped. */
export function firstAwait(body: string): number {
  return stripComments(body).search(/\bawait\b/);
}

export function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
}
