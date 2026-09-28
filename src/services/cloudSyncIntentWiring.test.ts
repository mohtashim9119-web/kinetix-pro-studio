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

// Wave 3 U4.6 — the flow UI on top of the intent: the click is a reveal on
// the cloud even while transcription runs, the background job never waits on
// media, and local keeps click-to-run.
describe('Wave 3 U4.6 — App wiring', () => {
  function earlyClickBlock(): string {
    const start = APP.indexOf('// Wave 3 U4.6 — EARLY-CLICK REVEAL.');
    expect(start, 'the early-click reveal is gone').toBeGreaterThan(-1);
    return APP.slice(start, APP.indexOf('// 1. Read text files', start));
  }

  it('an early cloud click waits for the staging transcript BEFORE the voiceover is persisted (which would orphan the staging write-back)', () => {
    const wait = APP.indexOf('await waitForStagingTranscript(');
    const persist = APP.indexOf('await persistPendingVoiceoverAsset(');
    expect(wait).toBeGreaterThan(-1);
    expect(wait).toBeLessThan(persist);
    const b = earlyClickBlock();
    expect(b).toMatch(/=== 'cloud'/);
    expect(b).toMatch(/pendingForWait\.file === staged\.voiceoverFile\.file/);
  });

  it('the wait shows the cloud\'s own phase, and cancel or a pause ends it keeping the staged files', () => {
    const b = earlyClickBlock();
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

// Wave 3 U5 — cancel honesty: a cancel is a real stop on the cloud, says what
// it cost, and leaves the timeline as it was.
describe('Wave 3 U5 — App wiring', () => {
  function sliceFrom(marker: string, length = 1800): string {
    const at = APP.indexOf(marker);
    expect(at, `${marker} not found`).toBeGreaterThan(-1);
    return APP.slice(at, at + length);
  }

  it('cancelling an early click cancels the cloud transcription itself, keeps the staged files, and lets the next click restart it', () => {
    const b = sliceFrom("if (waited === 'aborted') {", 700);
    expect(b).toMatch(/cancelTranscription\(\);/);
    expect(b).toMatch(/setStagingCancelledAssetId\(stagingAssetId\)/);
    expect(b).toMatch(/await cancelledResult\(0\)/);
    expect(b).toMatch(/holdStaged: true/);
    const restart = sliceFrom('let restartedStagingHash', 900);
    expect(restart).toMatch(/stagingCancelledAssetIdRef\.current === cancelledStaging\.asset\.id/);
    expect(restart).toMatch(/handleVoiceoverStaged\(cancelledStaging\.file, \{ rerun: true \}\)/);
  });

  it('cancelling the reveal stops the background intent, not just the wait', () => {
    const b = sliceFrom('if (revealCancelled) {', 700);
    expect(b).toMatch(/cancelSyncIntent\(intent\.spineKey\)/);
    expect(b.indexOf('cancelSyncIntent')).toBeLessThan(b.indexOf('return cancelledResult'));
  });

  it('a cancelled spine never auto-restarts; only a click lifts it', () => {
    const b = effectBody();
    const suppressed = b.indexOf('isSyncIntentSuppressed(spineKey)');
    expect(suppressed).toBeGreaterThan(-1);
    expect(suppressed).toBeLessThan(b.indexOf('startSyncIntent('));
    expect(APP).toMatch(/clearSyncIntentSuppression\(\);/);
  });

  it('every cancel waits for the gateway\'s answer and reports it', () => {
    const b = sliceFrom('const cancelledResult = async', 1200);
    expect(b).toMatch(/await settleCloudCancels\(\)/);
    expect(b).toMatch(/describeCloudCancel\(\s*takeCancelReceiptsSince\(syncRunAt\)/);
    expect(b.indexOf('settleCloudCancels')).toBeLessThan(b.indexOf('logSyncAbort('));
  });
});
