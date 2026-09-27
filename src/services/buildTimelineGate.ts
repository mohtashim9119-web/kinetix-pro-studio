/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// ---------------------------------------------------------------------------
// Wave 3 U4.6 — the Build Timeline button's gate and copy.
//
// FOUR SLOTS, BY PRODUCT RULING. The sync engine only needs the spine
// (script + scene doc + voiceover). Requiring media is the operator's ruling
// for the "ready timeline" promise, not an engine constraint — so the cloud
// sync intent still fires at spine complete and never waits on media
// (App.tsx). A slot counts as filled when it is staged OR already persisted;
// a bundle zip fills all four in one drop.
//
// The `no-asset` attention kind (media removed after a sync) is a separate
// surface and stays.
// ---------------------------------------------------------------------------

export type BuildTimelineSlot = 'script' | 'scene' | 'voiceover' | 'media';

export interface BuildTimelineSlots {
  script: boolean;
  scene: boolean;
  voiceover: boolean;
  media: boolean;
}

/** Operator-swappable copy. Everything the button says lives here. */
export const BUILD_TIMELINE_COPY = {
  label: 'Build Timeline',
  /** While a LOCAL staging transcription runs (local keeps click-to-run). */
  transcribingLabel: 'Transcribing…',
  transcribingTitle: 'Waiting for transcription to finish…',
  /** Post-sync disabled label. "Timeline ready" is PROPOSED and not yet
   *  signed off by the operator (wave3 rulings, U4.6 item 1) — the signed
   *  Wave 2 label stays until it is. Swap here once signed. */
  syncedLabel: 'Already synced',
  nothingStagedTitle: 'Stage a new file to build the timeline',
  /** An early cloud click whose staging transcription paused or failed —
   *  the pause/model dialog is already up and carries the choice. */
  stagingPausedMessage: 'Transcription stopped — answer the dialog, then build the timeline again.',
  slotNames: {
    script: 'a script',
    scene: 'a scene doc',
    voiceover: 'a voiceover',
    media: 'media',
  } satisfies Record<BuildTimelineSlot, string>,
} as const;

/** How an early Build Timeline click's wait on the staging transcript ended. */
export type StagingTranscriptWait = 'ready' | 'paused' | 'aborted';

export interface StagingTranscriptState {
  /** The staged voiceover's transcript is usable (or its run ended). */
  ready: boolean;
  /** The staging run stopped on a failure that has its own dialog. */
  paused: boolean;
}

/** Resolves once the staging transcript is ready, its run pauses, or the
 *  click is cancelled. `wakers` is called by the owner whenever `read()`
 *  may have changed (App.tsx: after every render). A pause wins over ready:
 *  a failed run's terminal phase also counts as "ready" for gating. */
export function waitForStagingTranscript(
  read: () => StagingTranscriptState,
  wakers: Set<() => void>,
  signal: AbortSignal,
): Promise<StagingTranscriptWait> {
  return new Promise(resolve => {
    const done = (result: StagingTranscriptWait): void => {
      wakers.delete(check);
      signal.removeEventListener('abort', check);
      resolve(result);
    };
    function check(): void {
      const state = read();
      if (signal.aborted) done('aborted');
      else if (state.paused) done('paused');
      else if (state.ready) done('ready');
    }
    wakers.add(check);
    signal.addEventListener('abort', check);
    check();
  });
}

const SLOT_ORDER: BuildTimelineSlot[] = ['script', 'scene', 'voiceover', 'media'];

export function missingSlots(slots: BuildTimelineSlots): BuildTimelineSlot[] {
  return SLOT_ORDER.filter(slot => !slots[slot]);
}

/** "Add a voiceover to build the timeline" / "Add a script, a scene doc and
 *  media to build the timeline". `undefined` when all four are filled. */
export function missingSlotsReason(slots: BuildTimelineSlots): string | undefined {
  const names = missingSlots(slots).map(slot => BUILD_TIMELINE_COPY.slotNames[slot]);
  if (names.length === 0) return undefined;
  const list = names.length === 1
    ? names[0]
    : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
  return `Add ${list} to build the timeline`;
}
