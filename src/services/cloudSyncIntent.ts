/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// ---------------------------------------------------------------------------
// Wave 3 U4.5 — the cloud "sync intent": one background run that turns a
// complete spine (script + scene doc + voiceover, with its cloud transcript)
// into fully aligned timings waiting in the gateway's cache, so the human's
// click only REVEALS a timeline instead of starting one.
//
// ONE BOOT. The staging transcription asked the gateway to hold its GPU
// container (`cloudSyncEngine.ts`, held transcriptions). This run plans the
// alignment the moment the transcript lands and hands the plan to that SAME
// container. Nothing here holds the GPU for files: if the spine is not
// complete, the caller releases the hold instead of starting an intent.
//
// THE COVERAGE GATE RUNS INSIDE THE SESSION, BEFORE ANY FA CHARGE. The plan
// comes from `runForcedAlignmentForSync(..., 'cloud')` — the exact function
// Apply Sync calls — so the G4 coverage check (a real script/audio mismatch
// hard-blocks as 'hopeless-local-coverage') and the chunk planner are the
// same code on both paths, run against the cloud transcript, and a mismatch
// releases the held container without an alignment ever being submitted.
//
// PAUSE-AND-ASK STILL APPLIES: every 'paused' outcome (offline / auth /
// mismatch / ...) is returned typed for the caller to raise the SAME
// restart-safe SyncPausedDialog Apply Sync raises. Completed stages stay
// cached server-side; a retry pays only for what is missing.
//
// QUEUE-READY: everything a run needs arrives in `SyncIntentInputs`, and
// segment preparation is injected — nothing reads React state — so the
// post-U7 bulk queue can submit N intents back-to-back through this shape.
//
// Cloud path only. The local path keeps its click-to-run flow.
// ---------------------------------------------------------------------------

import type { Asset, TranscriptToken, VideoSegment } from '../types';
import { applyAnchorBasedTiming } from './syncEngine';
import { runForcedAlignmentForSync, type FaRunResult } from './forcedAlignmentRun';
import { onCloudPhase, releaseHeldTranscription, type CloudPhase } from './cloudSyncEngine';

export interface SyncIntentInputs {
  /** `audioHash|scriptHash|engineKey` — one intent per spine. */
  spineKey: string;
  voiceover: Asset;
  audioHash: string;
  audioDurationSec: number;
  /** The cloud transcript for `audioHash` (stamped `whisper-cloud`). */
  tokens: TranscriptToken[];
  /** Same value Apply Sync passes (`resolveFaLanguage(project)`). */
  language: Parameters<typeof runForcedAlignmentForSync>[4];
  /** The SAME segment preparation Apply Sync runs (parse, character-weight
   *  anchors), injected so this module never reads app state. */
  prepareSegments: () => Promise<VideoSegment[]>;
}

export type SyncIntentOutcome =
  /** Aligned timings are in the gateway cache; the reveal is two hits. */
  | { status: 'ready'; handedOff: boolean; cached: boolean }
  /** Pause-and-ask: raise the same dialog Apply Sync would. */
  | { status: 'paused'; faRun: Extract<FaRunResult, { status: 'paused' }> }
  /** Nothing to prefetch (e.g. the scene doc parsed to no scenes); the
   *  click runs Apply Sync, which reports the reason in its own words. */
  | { status: 'skipped'; reason: string }
  | { status: 'cancelled' };

export type IntentPhase = CloudPhase | 'planning' | 'ready' | 'paused' | 'skipped';

export async function runCloudSyncIntent(
  inputs: SyncIntentInputs,
  signal?: AbortSignal,
): Promise<SyncIntentOutcome> {
  try {
    const segments = await inputs.prepareSegments();
    if (signal?.aborted) return { status: 'cancelled' };
    if (segments.length === 0) return { status: 'skipped', reason: 'the scene doc has no scenes' };
    const anchorTimed = applyAnchorBasedTiming(segments, inputs.audioDurationSec);
    const faRun = await runForcedAlignmentForSync(
      inputs.voiceover,
      anchorTimed,
      inputs.tokens,
      inputs.audioDurationSec,
      inputs.language,
      signal,
      inputs.audioHash,
      false,
      'cloud',
    );
    if (faRun.status === 'cancelled') return { status: 'cancelled' };
    if (faRun.status === 'paused') {
      // The dialog is about to block the operator. Drop the GPU hold now,
      // before the caller paints it — a 30s unanswered hold is the team cost.
      releaseHeldTranscription(inputs.audioHash);
      return { status: 'paused', faRun };
    }
    if (faRun.status === 'ok' || (faRun.status === 'degraded' && faRun.reason === 'ctc-infeasible-chunk')) {
      return { status: 'ready', handedOff: faRun.cloudHandedOff === true, cached: faRun.cloudCached === true };
    }
    return { status: 'skipped', reason: `alignment did not run (${faRun.reason})` };
  } finally {
    // Any path that did not hand the held container a plan (a mismatch
    // pause fires before the cloud call; a skip never gets that far) must
    // let it go now. Idempotent: `alignViaCloud` already took it if it ran.
    releaseHeldTranscription(inputs.audioHash);
  }
}

// ---------------------------------------------------------------------------
// Registry: at most one intent per spine, observable by the reveal.
// ---------------------------------------------------------------------------

interface IntentEntry {
  spineKey: string;
  audioHash: string;
  phase: IntentPhase;
  promise: Promise<SyncIntentOutcome>;
  outcome?: SyncIntentOutcome;
  controller: AbortController;
}

const intents = new Map<string, IntentEntry>();
const listeners = new Set<() => void>();

function notify(): void {
  for (const listener of listeners) listener();
}

export function subscribeSyncIntents(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function getSyncIntent(spineKey: string): Readonly<Omit<IntentEntry, 'controller'>> | undefined {
  return intents.get(spineKey);
}

/** Starts the intent for this spine unless one already ran or is running.
 *  Returns the entry either way. */
export function startSyncIntent(
  inputs: SyncIntentInputs,
  run: (inputs: SyncIntentInputs, signal: AbortSignal) => Promise<SyncIntentOutcome> = runCloudSyncIntent,
): Readonly<Omit<IntentEntry, 'controller'>> {
  const existing = intents.get(inputs.spineKey);
  if (existing) return existing;
  const controller = new AbortController();
  const entry: IntentEntry = {
    spineKey: inputs.spineKey,
    audioHash: inputs.audioHash,
    phase: 'planning',
    controller,
    promise: Promise.resolve({ status: 'skipped', reason: 'not started' }),
  };
  const off = onCloudPhase(inputs.audioHash, phase => {
    if (entry.outcome) return;
    entry.phase = phase;
    notify();
  });
  entry.promise = run(inputs, controller.signal)
    .catch((err: unknown): SyncIntentOutcome => ({
      status: 'skipped', reason: err instanceof Error ? err.message : String(err),
    }))
    .then(outcome => {
      off();
      entry.outcome = outcome;
      entry.phase = outcome.status === 'ready' ? 'ready' : outcome.status === 'paused' ? 'paused' : 'skipped';
      // A cancelled/skipped intent may run again for the same spine later
      // (e.g. once the network is back); a ready/paused one is final.
      if (outcome.status === 'cancelled' || outcome.status === 'skipped') intents.delete(inputs.spineKey);
      notify();
      return outcome;
    });
  intents.set(inputs.spineKey, entry);
  notify();
  return entry;
}

/** Abort every intent that is not for `keepSpineKey` (the spine changed:
 *  script edit, voiceover swap, engine switch). Their completed stages stay
 *  cached server-side. */
export function cancelOtherSyncIntents(keepSpineKey: string | undefined): void {
  for (const [key, entry] of intents) {
    if (key === keepSpineKey) continue;
    if (!entry.outcome) entry.controller.abort();
    intents.delete(key);
  }
  notify();
}

// ---------------------------------------------------------------------------
// Wave 3 U5 — a user's cancel is a real stop. Cancelling the Build Timeline
// reveal cancels the background intent it was waiting on (its cloud job is
// cancelled on the gateway and leaves a receipt), and that spine is then
// SUPPRESSED: the spine effect must not quietly start it again and bill work
// the human just said no to. The next Build Timeline click lifts it, and so
// does any real change (a changed spine has a new key).
// ---------------------------------------------------------------------------

const suppressed = new Set<string>();

/** Stops this spine's intent and keeps it from auto-starting. Resolves once
 *  the intent has settled (its cloud cancel answered), or at once if none. */
export async function cancelSyncIntent(spineKey: string): Promise<void> {
  suppressed.add(spineKey);
  const entry = intents.get(spineKey);
  if (!entry) return;
  if (!entry.outcome) entry.controller.abort();
  intents.delete(spineKey);
  notify();
  await entry.promise.catch(() => undefined);
}

export function isSyncIntentSuppressed(spineKey: string): boolean {
  return suppressed.has(spineKey);
}

/** A Build Timeline click: the human asked for this spine again. */
export function clearSyncIntentSuppression(): void {
  suppressed.clear();
}

/** A paused intent's answer was given (retry / local / whisper): forget it
 *  so the next spine evaluation can start fresh. */
export function forgetSyncIntent(spineKey: string): void {
  intents.delete(spineKey);
  notify();
}

/** Test-only. */
export function __resetSyncIntentsForTests(): void {
  for (const entry of intents.values()) entry.controller.abort();
  intents.clear();
  listeners.clear();
  suppressed.clear();
}

/** One human line per phase, for the reveal overlay. Operator-swappable. */
export const INTENT_PHASE_COPY: Record<IntentPhase, string> = {
  planning: 'Checking the script against the audio…',
  // Wave 3 U5 — the queued state says what a cancel costs right now.
  'waiting-gpu': 'Waiting for a cloud GPU… Cancel now and this job costs nothing (a GPU already starting up may bill its start-up, about $0.01 or less).',
  transcribing: 'Transcribing on the cloud…',
  aligning: 'Aligning on the cloud…',
  ready: 'Building your timeline…',
  paused: 'Paused — waiting for your answer…',
  skipped: 'Building your timeline…',
};
