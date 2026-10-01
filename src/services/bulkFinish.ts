/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// ---------------------------------------------------------------------------
// Bulk finish is ACTIVE. The cloud batch leaves each row's transcript in the
// gateway cache and does not write it onto the project. Finish adopts that
// cache (or force-starts only on a miss) and runs the extracted finish
// pipeline — never by opening the editor.
// ---------------------------------------------------------------------------

import type { TranscriptToken } from '../types';
import { lookupCloudCache } from './cloudGateway';
import { cloudTranscribeLanguage } from './cloudSyncEngine';
import type { FinishResult } from './bulkBatch';

/** How long finish waits for the editor to become ready after the active steps. */
export const BULK_FINISH_WAIT_MS = 90_000;

/** v1.2.2 — input in the editor this recently means the operator is working there. */
export const BULK_ACTIVE_EDIT_MS = 20_000;

/**
 * Is the operator actively editing? Then a finish must not flip the editor
 * into another project under them: the row waits for its own Open. Busy means
 * the editor is open AND (they touched it within `BULK_ACTIVE_EDIT_MS`, or a
 * sync is running there). The dashboard is never "editing".
 */
export function isOperatorActivelyEditing(s: { editorOpen: boolean; syncRunning: boolean; msSinceInput: number }): boolean {
  return s.editorOpen && (s.syncRunning || s.msSinceInput < BULK_ACTIVE_EDIT_MS);
}

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
  /** Build this row's timeline without opening the editor. */
  finish: (id: string) => Promise<FinishResult>;
}

/**
 * Finish a bulk row in the background: the extracted pipeline, no project
 * switch, no screen flip.
 */
export async function runBulkProjectFinish(
  id: string,
  deps: BulkFinishDeps,
): Promise<FinishResult> {
  return deps.finish(id);
}
