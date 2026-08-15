/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// ---------------------------------------------------------------------------
// Production forced-alignment attempt for one Apply Sync run
// (docs/work-in-progress.md §11 item 1). The capability-gated
// (`faGate.ts::isFaGateOpen()`) counterpart of `App.tsx`'s DEV-only
// `__faDevAlign` harness: same audio-fetch / chunk-plan / `Channel<FaEvent>`
// steps, but calls the new production command (`fa_align_production`,
// `src-tauri/src/fa_production.rs`) instead of `fa_align_dev`, and — unlike
// the harness, which is purely observational — returns a value its caller is
// meant to actually use.
//
// FAIL-CLEAN CONTRACT: `runForcedAlignmentForSync` never throws. Every
// failure (unsupported language, empty chunk plan, IPC rejection of any
// kind — no model present, hash mismatch, inference error, cancellation)
// resolves to `null`. The caller's job is exactly one branch: FA tokens, or
// fall back to whatever Whisper tokens it already had — never a partial
// commit, never a crash.
// ---------------------------------------------------------------------------

import { invoke, Channel } from '@tauri-apps/api/core';
import { detectSilences } from './silenceDetector';
import { computeFaChunkPlan } from './faChunkPlan';
import { faWordSpansToTranscriptTokens, type FaEvent, type FaWordSpan } from './faBoundaryTypes';
import { bytesToBase64 } from './tauriFfmpeg';
import type { FaLanguageCode } from './faTextNormalize';
import type { Asset, TranscriptToken, VideoSegment } from '../types';

/** Mirrors `App.tsx`'s `__faDevAlign` harness's own `SUPPORTED_FA_LANGUAGES`
 *  list — the 5 languages a real jonatasgrosman ONNX model exists for
 *  (`CLAUDE.md`'s Sync/Whisper invariants). */
export const FA_SUPPORTED_LANGUAGES: readonly FaLanguageCode[] = ['en', 'es', 'fr', 'de', 'pt'];

/**
 * Runs forced alignment for the current Apply Sync run and returns the
 * resulting `TranscriptToken[]` (one entry per aligned word, via
 * `faWordSpansToTranscriptTokens`) — or `null` on any failure, per this
 * module's fail-clean contract above. Never mutates `project`, never throws.
 *
 * `anchorTimedSegments` must already carry `text`/`startTime` (i.e. the
 * output of `applyAnchorBasedTiming`) — `computeFaChunkPlan` derives its
 * per-chunk text attribution from segment `startTime` membership.
 * `whisperTokens` is the RAW cached Whisper transcript (unfiltered — matches
 * `__faDevAlign`'s own `project.transcriptTokens` argument), used only to
 * derive chunk boundaries (via `faAnchors.ts`'s three-source-agreement run
 * structure), never returned or merged with the FA output.
 */
export async function runForcedAlignmentForSync(
  voiceoverAsset: Asset,
  anchorTimedSegments: VideoSegment[],
  whisperTokens: TranscriptToken[],
  audioDuration: number,
  languageCode: string | undefined,
): Promise<TranscriptToken[] | null> {
  if (!languageCode || !FA_SUPPORTED_LANGUAGES.includes(languageCode as FaLanguageCode)) {
    console.warn(
      `[fa] project.language (${String(languageCode)}) is not one of the 5 FA-supported languages ` +
      `(${FA_SUPPORTED_LANGUAGES.join(', ')}) — falling back to Whisper timing.`,
    );
    return null;
  }
  const language = languageCode as FaLanguageCode;

  try {
    const voiceoverBlob = voiceoverAsset.file ?? await (await fetch(voiceoverAsset.url)).blob();
    const buffer = await voiceoverBlob.arrayBuffer();
    const audioB64 = bytesToBase64(new Uint8Array(buffer));
    const audioExtHint = voiceoverAsset.file?.type
      || voiceoverAsset.file?.name.split('.').pop()
      || '';

    const silenceResult = await detectSilences(voiceoverBlob);
    const silences = silenceResult.status === 'ok' ? silenceResult.silences : [];
    if (silenceResult.status !== 'ok') {
      console.warn('[fa] silence detection failed, chunking with zero silences:', silenceResult.errorMessage);
    }

    const chunks = computeFaChunkPlan(anchorTimedSegments, whisperTokens, silences, audioDuration);
    if (chunks.length === 0) {
      console.warn('[fa] chunk plan is empty (every segment has empty text) — falling back to Whisper timing.');
      return null;
    }

    const channel = new Channel<FaEvent>();
    const words = await new Promise<FaWordSpan[]>((resolve, reject) => {
      channel.onmessage = (msg) => {
        if (msg.event === 'Done') {
          resolve(msg.data.words);
        } else if (msg.event === 'Error') {
          reject(new Error(msg.data.message));
        }
      };
      invoke('fa_align_production', {
        audioB64,
        audioExtHint,
        chunks,
        language,
        onEvent: channel,
      }).catch((err: unknown) => reject(err instanceof Error ? err : new Error(String(err))));
    });

    if (words.length === 0) {
      console.warn('[fa] forced alignment returned zero words — falling back to Whisper timing.');
      return null;
    }
    return faWordSpansToTranscriptTokens(words);
  } catch (err) {
    console.warn('[fa] forced alignment failed — falling back to Whisper timing:', err);
    return null;
  }
}
