/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// Wave 3 U4.5 — source pins on App.tsx's intent wiring (App is not mountable
// in tests; the chain itself is composed for real in cloudSyncIntent.test.ts).
// These pin the three joints that chain depends on: staging asks for the
// hold, the spine effect starts (or releases) with Apply Sync's own inputs,
// and Apply Sync waits on a running intent instead of starting a second run.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';

const APP = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../App.tsx'), 'utf8');

function effectBody(): string {
  const start = APP.indexOf('// Wave 3 U4.5 — the cloud sync intent.');
  expect(start).toBeGreaterThan(-1);
  return APP.slice(start, APP.indexOf('const applySyncSpineUnchangedReason', start));
}

describe('Wave 3 U4.5 — App wiring', () => {
  it('staging on the cloud asks the gateway to hold the container; locally it never does', () => {
    expect(APP).toMatch(/cloudHold: stagingHost === 'cloud'/);
    expect(APP).toMatch(/host: stagingHost,/);
  });

  it('the spine effect releases the hold on every "nothing to align" path — the GPU never waits for files', () => {
    const b = effectBody();
    expect(b).toMatch(/releaseHeldTranscription\(audioHash\)/);
    // not cloud, incomplete spine, gate closed, already synced, no duration
    expect((b.match(/noIntent\(\); return;/g) ?? []).length).toBeGreaterThanOrEqual(5);
    expect(b).toMatch(/if \(isProcessing\) return;/);
  });

  it('the intent is fed Apply Sync\'s own parse inputs, in Apply Sync\'s order', () => {
    const b = effectBody();
    expect(b).toMatch(/parseProjectData\(\s*scriptText, sceneText, p\.assets, audioDurationSec, p\.segments, p\.defaultTextOverlay \?\? false,/);
    expect(APP).toMatch(/const newSegmentsRaw = await parseProjectData\(\s*scriptText, sceneText, allAssets, audioDuration, previousSegments,\s*projectRef\.current\.defaultTextOverlay \?\? false,/);
    expect(b).toMatch(/language: resolveFaLanguage\(p\)/);
  });

  it('a paused background intent raises the SAME restart-safe dialog (never silent)', () => {
    const b = effectBody();
    expect(b).toMatch(/outcome\.status !== 'paused'/);
    expect(b).toMatch(/saveFaPause\(record\)/);
    expect(b).toMatch(/setFaPauseDialog\(record\)/);
    expect(b).toMatch(/host: 'cloud', audioHash/);
  });

  it('Apply Sync on the cloud waits on a running intent for its spine before the pipeline (reveal), and cancel stops the wait', () => {
    const reveal = APP.indexOf('// Wave 3 U4.5 — REVEAL.');
    const pipeline = APP.indexOf('const cachedTranscriptHost = transcriptionHost(');
    expect(reveal).toBeGreaterThan(-1);
    expect(reveal).toBeLessThan(pipeline);
    const b = APP.slice(reveal, pipeline);
    expect(b).toMatch(/getSyncIntent\(`\$\{audioHash\}\|\$\{scriptHash\}\|\$\{engineKey\}`\)/);
    expect(b).toMatch(/intent\.promise/);
    expect(b).toMatch(/syncAbortController\.signal/);
    expect(b).toMatch(/INTENT_PHASE_COPY/);
  });
});
