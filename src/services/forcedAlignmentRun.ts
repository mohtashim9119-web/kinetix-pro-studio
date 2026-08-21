/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// ---------------------------------------------------------------------------
// Production forced-alignment attempt for one Apply Sync run
// (docs/work-in-progress.md §11 item 1). The capability-gated
// (`faGate.ts::isFaGateOpenForProject()`) counterpart of `App.tsx`'s DEV-only
// `__faDevAlign` harness: same audio-fetch / chunk-plan / `Channel<FaEvent>`
// steps, but calls the new production command (`fa_align_production`,
// `src-tauri/src/fa_production.rs`) instead of `fa_align_dev`, and — unlike
// the harness, which is purely observational — returns a value its caller is
// meant to actually use.
//
// FAIL-CLEAN CONTRACT: `runForcedAlignmentForSync` never throws. Every
// failure (unsupported language, empty chunk plan, IPC rejection of any
// kind — no model present, hash mismatch, inference error, cancellation)
// resolves to a `'fallback'` result. The caller's job is exactly one branch:
// FA tokens, or fall back to whatever Whisper tokens it already had — never a
// partial commit, never a crash.
//
// FAIL-CLEAN IS NOT FAIL-SILENT (WS1 Session J). This function used to return
// `TranscriptToken[] | null`, and `null` was the ONLY thing it said about a
// failure — the reason went to `console.warn` and nowhere else. That made a
// run where FA silently failed indistinguishable, in `project.syncLog`, from
// a run where FA succeeded: same entries, same summary, same committed shape,
// Whisper timing shipped under the user's explicit "high-precision sync"
// choice. The contract is unchanged (still never throws, still always leaves
// the caller one branch); what changed is that the result now NAMES which of
// the failure paths fired, so `App.tsx` can put it in the durable log.
// ---------------------------------------------------------------------------

import { invoke, Channel } from '@tauri-apps/api/core';
import { detectSilences } from './silenceDetector';
import { computeFaChunkPlan, computeUnscriptedRuns, type UnscriptedRun } from './faChunkPlan';
import { faWordSpansToTranscriptTokens, type FaEvent, type FaWordSpan } from './faBoundaryTypes';
import type { FaLanguageCode } from './faTextNormalize';
import type { Asset, TranscriptToken, VideoSegment } from '../types';

/** Mirrors `App.tsx`'s `__faDevAlign` harness's own `SUPPORTED_FA_LANGUAGES`
 *  list — the 5 languages a real jonatasgrosman ONNX model exists for
 *  (`CLAUDE.md`'s Sync/Whisper invariants). */
export const FA_SUPPORTED_LANGUAGES: readonly FaLanguageCode[] = ['en', 'es', 'fr', 'de', 'pt'];

/**
 * Which failure path sent this run back to Whisper timing. One member per
 * `return`-on-failure in the function below, so the set is exhaustive by
 * construction rather than by intention — adding a new bail-out without adding
 * a member here is a type error.
 *
 * `'inference-error'` deliberately covers several distinct native-side causes
 * (no model file, manifest hash mismatch, ONNX runtime failure, a cancelled
 * or rejected IPC call). They all arrive through the same rejection path and
 * are only distinguishable by the message the backend attached, which is
 * carried verbatim in `detail` — inventing separate members here would mean
 * pattern-matching backend prose to decide which one to use, i.e. guessing.
 */
export type FaFallbackReason =
  | 'unsupported-language'
  | 'empty-chunk-plan'
  | 'zero-words'
  | 'inference-error';

/**
 * The outcome of one FA attempt. Discriminated so the caller cannot read
 * tokens off a failed run, and cannot fall back without having been told why.
 */
export type FaRunResult =
  | {
      status: 'ok';
      tokens: TranscriptToken[];
      /** R.5's unit of work — the unscripted-audio runs this run's chunk plan
       *  excised, surfaced from `computeUnscriptedRuns` (the SAME production
       *  pass `computeFaChunkPlan` derives them from, called with the SAME
       *  four arguments) so `App.tsx` can log R.5's firings.
       *
       *  Returned from HERE rather than recomputed at the call site because
       *  this is the only place that holds the exact silence array the chunk
       *  plan was built against: `App.tsx`'s own `aligned.silences` is a
       *  separate detection pass, and logging R.5 against silences R.5 did not
       *  use would be a provenance error of exactly the kind this workstream
       *  keeps finding. Costs one extra `computeRunContext` pass per FA run,
       *  paid against a run that already costs 76-231 s of inference. */
      unscriptedRuns: UnscriptedRun[];
      /** Set when silence detection failed and the chunk plan was built with
       *  ZERO silences. Not a fallback — the run continued and produced real
       *  FA tokens — but a real degradation of chunk placement that was
       *  previously `console.warn`-only. */
      silenceError?: string;
    }
  | {
      status: 'fallback';
      reason: FaFallbackReason;
      /** The underlying message, where there was one (the IPC rejection's
       *  text, the unsupported language code). Undefined where the reason is
       *  the whole story. */
      detail?: string;
    };

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
): Promise<FaRunResult> {
  if (!languageCode || !FA_SUPPORTED_LANGUAGES.includes(languageCode as FaLanguageCode)) {
    console.warn(
      `[fa] project.language (${String(languageCode)}) is not one of the 5 FA-supported languages ` +
      `(${FA_SUPPORTED_LANGUAGES.join(', ')}) — falling back to Whisper timing.`,
    );
    return { status: 'fallback', reason: 'unsupported-language', detail: String(languageCode) };
  }
  const language = languageCode as FaLanguageCode;

  try {
    const voiceoverBlob = voiceoverAsset.file ?? await (await fetch(voiceoverAsset.url)).blob();

    const silenceResult = await detectSilences(voiceoverBlob);
    const silences = silenceResult.status === 'ok' ? silenceResult.silences : [];
    const silenceError = silenceResult.status === 'ok' ? undefined : silenceResult.errorMessage;
    if (silenceError !== undefined) {
      console.warn('[fa] silence detection failed, chunking with zero silences:', silenceError);
    }

    const chunks = computeFaChunkPlan(anchorTimedSegments, whisperTokens, silences, audioDuration);
    if (chunks.length === 0) {
      console.warn('[fa] chunk plan is empty (every segment has empty text) — falling back to Whisper timing.');
      return { status: 'fallback', reason: 'empty-chunk-plan' };
    }

    const buffer = await voiceoverBlob.arrayBuffer();
    const audioExtHint = voiceoverAsset.file?.type
      || voiceoverAsset.file?.name.split('.').pop()
      || '';
    // Raw IPC body (Uint8Array) staged to a content-addressed temp file by
    // fa_stage_audio_raw, not base64+JSON — a long/uncompressed voiceover as
    // base64 inflates ~5-8x across the JS heap and the WKWebView IPC bridge
    // before Rust ever sees it (fa_stage_audio_raw's own doc comment has the
    // full accounting). 'kinetix-fa-production-inputs' namespaces this
    // command's staged inputs apart from the DEV harness's own
    // 'kinetix-fa-dev-inputs' so the two can never collide on the same
    // content-addressed path. Deferred until after the empty-chunk-plan
    // check above — matching the pre-existing fail-cheap-before-IPC
    // ordering — so a run that's about to fall back never pays for staging
    // a file it will not use.
    const inputPath = await invoke<string>('fa_stage_audio_raw', new Uint8Array(buffer), {
      headers: {
        'cache-dir': 'kinetix-fa-production-inputs',
        'ext-hint': audioExtHint,
      },
    });

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
        inputPath,
        chunks,
        language,
        onEvent: channel,
      }).catch((err: unknown) => reject(err instanceof Error ? err : new Error(String(err))));
    });

    if (words.length === 0) {
      console.warn('[fa] forced alignment returned zero words — falling back to Whisper timing.');
      return { status: 'fallback', reason: 'zero-words' };
    }
    return {
      status: 'ok',
      tokens: faWordSpansToTranscriptTokens(words),
      // Same four arguments `computeFaChunkPlan` was given three statements
      // above, so these are R.5's OWN excisions for this run — not a
      // re-derivation against different inputs.
      unscriptedRuns: computeUnscriptedRuns(anchorTimedSegments, whisperTokens, silences, audioDuration),
      silenceError,
    };
  } catch (err) {
    console.warn('[fa] forced alignment failed — falling back to Whisper timing:', err);
    return {
      status: 'fallback',
      reason: 'inference-error',
      detail: err instanceof Error ? err.message : String(err),
    };
  }
}
