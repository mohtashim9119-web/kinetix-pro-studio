/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// ---------------------------------------------------------------------------
// Item A (project corruption) — Apply Sync must not destroy the outgoing
// voiceover's bytes before the sync commits.
//
// THE DEFECT. `handleApplySyncFromFiles` replaced a staged voiceover by
// deleting the PREVIOUS voiceover's IndexedDB row, native bytes and waveform
// peaks at step 2 (staging) — long before its eight later abort exits
// (no-voiceover, probe failure, empty scene doc, transcript abort, FA pause,
// gate refusal, victim pause, cancel). Every one of those exits leaves
// `project.voiceoverId` pointing at the old asset, so an aborted run left a
// project whose voiceover row names bytes that no longer exist anywhere.
// Operator's project 7102a912: sync run 663c374b ended
// `aborted: true, abortReason: 'fa-paused'` and the project could not be
// opened again ("no metadata for 8d0274c3…", its voiceoverId).
//
// Same source-scan approach as `applySyncCancelInvariant.test.ts`, for the
// same stated reason (a private closure in a component this repo verifies
// manually): every byte-destroying call inside the function must sit strictly
// AFTER the one real commit (`assets: allAssets,`), which every abort path
// returns before by construction.
// ---------------------------------------------------------------------------

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const LINES = readFileSync(resolve(import.meta.dirname, '..', 'App.tsx'), 'utf-8').split('\n');
const ENTRY_MARKER = 'const handleApplySyncFromFiles = async (): Promise<ApplySyncResult> => {';

function bodyRange(): { start: number; end: number } {
  const start = LINES.findIndex(l => l.includes(ENTRY_MARKER));
  expect(start, 'handleApplySyncFromFiles entry marker not found').toBeGreaterThan(-1);
  let end = LINES.length;
  for (let i = start + 1; i < LINES.length; i++) {
    if (LINES[i] === '  };') { end = i; break; }
  }
  return { start, end };
}

function hits(re: RegExp): number[] {
  const { start, end } = bodyRange();
  const out: number[] = [];
  for (let i = start; i < end; i++) if (re.test(LINES[i]!)) out.push(i + 1);
  return out;
}

describe('Item A — Apply Sync defers the outgoing voiceover byte delete to after the commit', () => {
  it('every delete of asset bytes / peaks sits after the one real commit', () => {
    const commit = hits(/^\s+assets: allAssets,$/);
    expect(commit, 'the commit\'s `assets: allAssets,` line was not found exactly once').toHaveLength(1);

    const deletes = hits(/\b(deleteAsset|deleteAssetNative|deletePersistedWaveform)\(/);
    expect(deletes.length, 'the outgoing-voiceover delete disappeared entirely').toBeGreaterThan(0);
    for (const line of deletes) {
      expect(line, `byte delete at App.tsx:${line} runs before the commit at App.tsx:${commit[0]}`).toBeGreaterThan(commit[0]!);
    }
  });
});
