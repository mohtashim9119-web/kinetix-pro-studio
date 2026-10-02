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

const PIPE = readFileSync(resolve(import.meta.dirname, './finishPipeline.ts'), 'utf-8');

describe('Item A — Apply Sync defers the outgoing voiceover byte delete to after the commit', () => {
  it('runBuildTimeline never deletes bytes itself, and only releases after save', () => {
    expect(PIPE).not.toMatch(/\b(deleteAsset|deleteAssetNative|deletePersistedWaveform)\(/);
    const save = PIPE.indexOf('if (input.save) await input.save(next);');
    const release = PIPE.indexOf('input.releaseSupersededVoiceover?.(supersededVoiceover)');
    expect(save).toBeGreaterThan(-1);
    expect(release).toBeGreaterThan(save);
  });

  it('the editor adapter deletes the outgoing voiceover only through that post-save hook', () => {
    const app = readFileSync(resolve(import.meta.dirname, '..', 'App.tsx'), 'utf-8');
    expect(app).toContain('releaseSupersededVoiceover: asset => releaseOutgoingVoiceover(liveProjectRef.current.id, asset)');
    expect(app).toContain('releaseSupersededVoiceover: asset => releaseOutgoingVoiceover(projectId, asset)');
    const fnStart = app.indexOf('function releaseOutgoingVoiceover');
    expect(fnStart).toBeGreaterThan(-1);
    const fn = app.slice(fnStart, app.indexOf('\n}', fnStart));
    expect(fn).toContain('deleteAsset(');
    expect(fn).toContain('deleteAssetNative(');
    expect(fn).toContain('deletePersistedWaveform(');
  });
});
