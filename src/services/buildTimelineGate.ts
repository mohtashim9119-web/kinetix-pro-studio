/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// ---------------------------------------------------------------------------
// Wave 3 U4.6 — the Build Timeline button's gate and copy.
//
// SPINE-ONLY, BY PRODUCT RULING (Wave 3 U9 — reverses U4.6's four-slot rule).
// The sync engine only needs the spine (script + scene doc + voiceover), and
// the cloud sync intent always fired at spine complete without waiting on
// media (App.tsx, U4.5). Media is optional: build with none, add it later,
// press Match, and the placeholder scenes fill. A slot counts as filled when
// it is staged OR already persisted; a bundle zip fills all of them in one
// drop.
//
// The four-slot helpers below (`missingSlots` / `missingSlotsReason`) remain
// for the Bulk Projects surfaces, whose slot chips are unchanged this pass.
//
// The `no-asset` attention kind (media removed after a sync) is a separate
// surface and stays.
// ---------------------------------------------------------------------------

export type BuildTimelineSlot = 'script' | 'scene' | 'voiceover' | 'media';

/** The slots the engine actually needs. */
export type SpineSlot = 'script' | 'scene' | 'voiceover';

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
  /** Post-sync disabled label (operator-signed at U4.6 sign-off). */
  syncedLabel: 'Timeline ready',
  nothingStagedTitle: 'Stage a new file to build the timeline',
  /** An early cloud click whose staging transcription paused or failed —
   *  the pause/model dialog is already up and carries the choice. */
  stagingPausedMessage: 'Transcription stopped — answer the dialog, then build the timeline again.',
  /** Editor button, 0 media: enabled, with an honest hint (never a block). */
  noMediaHint: 'No media yet — scenes will build as unmatched placeholders. Add media any time, then Match.',
  /** Per-item copy for the spine-only gate ("Add script to build the timeline"). */
  spineSlotNames: {
    script: 'script',
    scene: 'scene doc',
    voiceover: 'voiceover',
  } satisfies Record<SpineSlot, string>,
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

const SPINE_ORDER: SpineSlot[] = ['script', 'scene', 'voiceover'];

export function missingSpineSlots(slots: BuildTimelineSlots): SpineSlot[] {
  return SPINE_ORDER.filter(slot => !slots[slot]);
}

/** "Add voiceover to build the timeline" / "Add script and scene doc to build
 *  the timeline". `undefined` when the spine is complete — media never gates. */
export function spineGateReason(slots: BuildTimelineSlots): string | undefined {
  const names = missingSpineSlots(slots).map(slot => BUILD_TIMELINE_COPY.spineSlotNames[slot]);
  if (names.length === 0) return undefined;
  const list = names.length === 1
    ? names[0]
    : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
  return `Add ${list} to build the timeline`;
}
