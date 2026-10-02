/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// Wave 3 U4.5 — source pins on App.tsx's intent wiring and the extracted
// Build Timeline service (App is not mountable in tests; the chain itself is
// composed for real in cloudSyncIntent.test.ts).

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';

const HERE = dirname(fileURLToPath(import.meta.url));
const APP = readFileSync(resolve(HERE, '../App.tsx'), 'utf8');
const PIPE = readFileSync(resolve(HERE, './finishPipeline.ts'), 'utf8');

function effectBody(): string {
  const start = APP.indexOf('// Wave 3 U4.5 — the cloud sync intent.');
  expect(start).toBeGreaterThan(-1);
  return APP.slice(start, APP.indexOf('const applySyncSpineUnchangedReason', start));
}

function applyBody(): string {
  const marker = 'const handleApplySyncFromFiles = async (): Promise<ApplySyncResult> => {';
  const start = APP.indexOf(marker);
  expect(start).toBeGreaterThan(-1);
  return APP.slice(start, APP.indexOf('\n  };', start));
}

describe('Wave 3 U4.5 — App wiring', () => {
  it('staging on the cloud asks the gateway to hold the container; locally it never does', () => {
    expect(APP).toMatch(/cloudHold: stagingHost === 'cloud'/);
    expect(APP).toMatch(/host: stagingHost,/);
  });

  it('the spine effect releases the hold on every "nothing to align" path — the GPU never waits for files', () => {
    const b = effectBody();
    expect(b).toMatch(/releaseHeldTranscription\(audioHash\)/);
    expect((b.match(/noIntent\(\); return;/g) ?? []).length).toBeGreaterThanOrEqual(5);
    expect(b).toMatch(/if \(isProcessing\) return;/);
  });

  it('the intent is fed Apply Sync\'s own parse inputs, in Apply Sync\'s order', () => {
    const b = effectBody();
    expect(b).toMatch(/parseProjectData\(\s*scriptText, sceneText, p\.assets, audioDurationSec, p\.segments, p\.defaultTextOverlay \?\? false,/);
    expect(PIPE).toMatch(/stages\.parseProjectData\(\s*scriptText, sceneText, allAssets, audioDuration, start\.segments, start\.defaultTextOverlay \?\? false,/);
    expect(b).toMatch(/language: resolveFaLanguage\(p\)/);
  });

  it('a paused background intent raises the SAME restart-safe dialog (never silent)', () => {
    const b = effectBody();
    expect(b).toMatch(/outcome\.status !== 'paused'/);
    expect(b).toMatch(/saveFaPause\(record\)/);
    expect(b).toMatch(/setFaPauseDialog\(record\)/);
    expect(b).toMatch(/host: 'cloud', audioHash/);
  });

  it('Apply Sync on the cloud waits on a running staging transcript before the pipeline, and cancel stops the wait', () => {
    const b = applyBody();
    expect(b).toMatch(/waitForStagingTranscript\(/);
    expect(b).toMatch(/syncAbortController\.signal/);
    expect(b).toMatch(/INTENT_PHASE_COPY/);
    expect(b.indexOf('waitForStagingTranscript(')).toBeLessThan(b.indexOf('runBuildTimeline('));
  });
});

describe('Wave 3 U4.6 — App wiring', () => {
  it('an early cloud click waits for the staging transcript BEFORE the voiceover is persisted (which would orphan the staging write-back)', () => {
    const b = applyBody();
    const wait = b.indexOf('await waitForStagingTranscript(');
    const persist = b.indexOf('persistPendingVoiceoverAsset(');
    expect(wait).toBeGreaterThan(-1);
    expect(persist).toBeGreaterThan(wait);
    expect(b).toMatch(/=== 'cloud'/);
    expect(b).toMatch(/pendingForWait\.file === staged\.voiceoverFile\.file/);
  });

  it('the wait shows the cloud\'s own phase, and cancel or a pause ends it keeping the staged files', () => {
    const b = applyBody();
    expect(b).toMatch(/onCloudPhase\(waitAudioHash/);
    expect(b).toMatch(/INTENT_PHASE_COPY\[phase\]/);
    expect(b).toMatch(/waitForStagingTranscript\(\s*\(\) => stagingTranscriptStateRef\.current, stagingTranscriptWaitersRef\.current, syncAbortController\.signal,/);
    expect(b).toMatch(/holdStaged: true/);
    expect(b).toMatch(/offPhase\(\)/);
  });

  it('a staging failure wakes the wait as a pause — the click never hangs on a stopped run', () => {
    expect(APP).toMatch(/paused: cloudTranscriptionPause !== null \|\| whisperModelFailureKind !== null/);
    expect(APP).toMatch(/for \(const wake of \[\.\.\.stagingTranscriptWaitersRef\.current\]\) wake\(\);/);
  });

  it('on the cloud an in-flight staging transcription does not grey Build Timeline; local and explicit-transcribe still do', () => {
    expect(APP).toMatch(/applySyncDisabled=\{buildTimelineWaitsOnTranscription\}/);
    expect(APP).toMatch(/const buildTimelineWaitsOnTranscription = applySyncDisabled\s*&& \(voiceoverNeedsExplicitTranscribe \|\| !\(cloudStagingInFlight \|\| cloudStagingCancelled\)\);/);
    expect(APP).toMatch(/transcriptionStatus\.phase === 'transcribing'/);
  });

  it('the background intent never waits on media: nothing in the spine effect gates on assets', () => {
    const b = effectBody();
    expect(b).not.toMatch(/assets\.length|assetFiles|zipFiles|persistedAssetCount/);
  });

  it('the purple transcription bar is not mounted while transcribing', () => {
    expect(APP).toMatch(/transcriptionStatus\.phase !== 'idle' && transcriptionStatus\.phase !== 'transcribing' && whisperModelFailureKind === null/);
  });
});

describe('Wave 3 U5 — App wiring', () => {
  it('cancelling an early click cancels the cloud transcription itself, keeps the staged files, and lets the next click restart it', () => {
    const b = applyBody();
    expect(b).toMatch(/if \(waited !== 'ready'\) \{/);
    expect(b).toMatch(/cancelTranscription\(\);/);
    expect(b).toMatch(/holdStaged: true/);
  });

  it('cancelling the overlay aborts the pipeline and the in-flight transcription', () => {
    expect(APP).toMatch(/void killLiveCloudJob\(\);/);
    expect(APP).toMatch(/syncAbortControllerRef\.current\?\.abort\(\);/);
    expect(APP).toMatch(/const handleCancelSync = useCallback\(\(\): void => \{\s*void killLiveCloudJob\(\);\s*syncAbortControllerRef\.current\?\.abort\(\);\s*cancelTranscription\(\);/);
    expect(PIPE).toContain("if (faRun.status === 'cancelled') return { ok: false, message: 'Sync cancelled.' };");
  });

  it('a cancelled spine never auto-restarts; only a click lifts it', () => {
    const b = effectBody();
    const suppressed = b.indexOf('isSyncIntentSuppressed(spineKey)');
    expect(suppressed).toBeGreaterThan(-1);
    expect(suppressed).toBeLessThan(b.indexOf('startSyncIntent('));
    expect(APP).toMatch(/clearSyncIntentSuppression\(\);/);
  });
});
