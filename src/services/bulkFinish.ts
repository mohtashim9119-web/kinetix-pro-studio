/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// ---------------------------------------------------------------------------
// Bulk finish is ACTIVE. The cloud batch leaves each row's transcript in the
// gateway cache and does not write it onto the project. A passive poll of
// `transcriptionReady` times out when bulkContext has suppressed the editor's
// auto-start and the peek-adopt race (project switch cancelling the one
// shared whisper) never lands the tokens. Finish therefore adopts the cache
// itself, by the same language key the batch transcribe used, and only
// force-starts a transcription when that lookup misses.
// ---------------------------------------------------------------------------

import type { TranscriptToken } from '../types';
import { lookupCloudCache } from './cloudGateway';
import { cloudTranscribeLanguage } from './cloudSyncEngine';

/** How long finish waits for the editor to become ready after the active steps. */
export const BULK_FINISH_WAIT_MS = 90_000;

export interface CachedTranscript {
  tokens: TranscriptToken[];
  /** The language key the hit was stored under (the batch key, or `auto`). */
  language: string;
}

/**
 * Free lookup of the transcript the batch job stored. Tries the batch key
 * first (`language ?? 'auto'`, the same expression `transcribeViaCloud`
 * submits), then `auto` if that was a different key. A miss is a miss — no
 * job, no upload.
 */
export async function lookupBatchTranscript(
  audioHash: string,
  language: string | undefined,
): Promise<CachedTranscript | null> {
  const primary = cloudTranscribeLanguage(language);
  const keys = primary === 'auto' ? [primary] : [primary, 'auto'];
  for (const key of keys) {
    try {
      const found = await lookupCloudCache<{ tokens?: TranscriptToken[] }>({
        stage: 'transcribe', audioHash, language: key,
      });
      if (found.cached && (found.result.tokens?.length ?? 0) > 0) {
        return { tokens: found.result.tokens!, language: key };
      }
    } catch {
      return null;
    }
  }
  return null;
}

export interface BulkReady {
  projectId: string;
  ready: boolean;
  built: boolean;
  why: string;
}

export interface BulkFinishDeps {
  switchProject: (id: string) => Promise<void>;
  /** Write the cached transcript onto the open project. False when the cache misses. */
  adoptCachedTranscript: (id: string) => Promise<boolean>;
  /** The batch's own stage — suppression blocks auto-fire, not this. */
  forceStartTranscription: (id: string) => Promise<void>;
  readReady: () => BulkReady;
  applySync: () => Promise<{ ok: boolean; message?: string }>;
  saveNow: () => Promise<void>;
  now?: () => number;
  wait?: (ms: number) => Promise<void>;
}

/**
 * Open the project, adopt or force-start its transcript, then Build Timeline.
 * The wait is only for the editor to observe the adopt; it is not how the
 * transcript gets there.
 */
export async function runBulkProjectFinish(
  id: string,
  deps: BulkFinishDeps,
  waitMs: number = BULK_FINISH_WAIT_MS,
): Promise<{ ok: boolean; message?: string }> {
  await deps.switchProject(id);
  const adopted = await deps.adoptCachedTranscript(id);
  if (!adopted) await deps.forceStartTranscription(id);
  const now = deps.now ?? Date.now;
  const wait = deps.wait ?? ((ms: number) => new Promise<void>(r => { setTimeout(r, ms); }));
  const deadline = now() + waitMs;
  for (;;) {
    const s = deps.readReady();
    if (s.projectId === id && s.built) return { ok: true };
    if (s.projectId === id && s.ready) break;
    if (now() > deadline) {
      return { ok: false, message: `Timed out waiting: ${s.projectId === id ? s.why : 'the project did not open'}.` };
    }
    await wait(100);
  }
  const result = await deps.applySync();
  if (!result.ok) return result;
  await deps.saveNow();
  return { ok: true };
}
