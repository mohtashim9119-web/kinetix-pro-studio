/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// A passive tap on finished cloud stage runs. The engine reports what a stage
// run already knows (stage, GPU seconds, cache hit, job id); a listener may
// only DISPLAY it (the per-project cost ledger). It never decides anything,
// and a throwing listener can never fail a stage run.

export interface CloudStageEvent {
  /** Bulk row id or project id — the same id for a bulk row's project. */
  ownerId: string;
  stage: 'transcribe' | 'align';
  jobId?: string;
  workerSec: number;
  /** Answered from the result cache: no GPU, no charge. */
  cached: boolean;
  /** A held container ran it: no boot of its own. */
  handedOff: boolean;
}

type Listener = (event: CloudStageEvent) => void;
const listeners = new Set<Listener>();

export function onCloudStageFinished(listener: Listener): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function reportCloudStageFinished(event: CloudStageEvent): void {
  for (const l of listeners) {
    try { l(event); } catch (err) { console.warn('[ledger] stage listener failed:', err); }
  }
}
