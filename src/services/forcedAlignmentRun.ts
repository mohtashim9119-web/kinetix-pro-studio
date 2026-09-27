/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// ---------------------------------------------------------------------------
// Production forced-alignment attempt for one Apply Sync run
// (docs/archive/history/work-in-progress.md §11 item 1). The capability-gated
// (`faGate.ts::isFaGateOpenForProject()`) counterpart of `App.tsx`'s DEV-only
// `__faDevAlign` harness: same audio-fetch / chunk-plan / `Channel<FaEvent>`
// steps, but calls the new production command (`fa_align_production`,
// `src-tauri/src/fa_production.rs`) instead of `fa_align_dev`, and — unlike
// the harness, which is purely observational — returns a value its caller is
// meant to actually use.
//
// TYPE-SPINE CONTRACT (plan-v3 Wave 1 item 3, D24). `runForcedAlignmentForSync`
// still never throws — every failure resolves rather than rejects — but there
// is NO `'fallback'` arm any more, and nothing in this module may silently
// substitute Whisper timing for a failed FA attempt. Per the operator rulings
// (`docs/ws1-sync-pipeline/operator-product-rulings-2026-09-19.md`):
// Whisper-only is a flagged-degraded state, never a silent pick, and a
// run-level failure (or offline, once Wave 3 adds a cloud engine) is
// pause-and-ask, never auto-switch. The four outcomes below are exhaustive:
//
//   - 'ok'        clean FA success, nothing degraded.
//   - 'degraded'  FA either didn't run (gate closed) or ran with a known,
//                 named, chunk-level degradation — tokens are still returned,
//                 but the caller MUST surface `reason` rather than treat this
//                 as a clean run.
//   - 'paused'    a run-level failure (or a precondition that makes a real
//                 attempt pointless). The run holds — nothing is committed —
//                 and the caller must ask the user, not choose for them.
//                 `resumable: true` records that the cached Whisper transcript
//                 this run already had is untouched, so "try again" or
//                 "use Whisper" never re-transcribes.
//   - 'cancelled' the user (or a whole-run cancel) stopped this run. Must
//                 never be presented as a failure — see plan-v3 item 5.
//
// Removing the old `'fallback'` arm is deliberate and structural, not
// cosmetic: every previous fallback site is now a compile error until it
// names which of the above it actually means. See this module's own tests
// and `App.tsx`'s FA branch for the repointed call sites.
// ---------------------------------------------------------------------------

import { invoke, Channel } from '@tauri-apps/api/core';
import { detectSilencesSingleFlight } from './silenceDetector';
import { describeInvokeError } from './invokeError';
import { computeFaChunkPlan, computeRunContextAsync, computeUnscriptedRuns, type UnscriptedRun } from './faChunkPlan';
import { loadFaLanguageData } from './faLanguageData';
import { computeLocalPreFaCoverage, type LocalCoverageResult } from './localFaCoverageGate';
import { MatchCancelledError } from './hirschbergMatchClient';
import { faWordSpansToTranscriptTokens, type FaEvent, type FaInfeasibleChunk } from './faBoundaryTypes';
import type { FaLanguageCode } from './faTextNormalize';
import type { Asset, TranscriptToken, VideoSegment } from '../types';
import { alignViaCloud } from './cloudSyncEngine';
import { describeCloudError } from './cloudGateway';
import type { SyncEngineHost } from './syncEngineHost';
import type { GatewayProvenance } from './timingProvenance';

/** Mirrors `App.tsx`'s `__faDevAlign` harness's own `SUPPORTED_FA_LANGUAGES`
 *  list — the 5 languages a real jonatasgrosman ONNX model exists for
 *  (`CLAUDE.md`'s Sync/Whisper invariants). */
export const FA_SUPPORTED_LANGUAGES: readonly FaLanguageCode[] = ['en', 'es', 'fr', 'de', 'pt'];

/**
 * Why a run PAUSED — a run-level failure (or a precondition equivalent to
 * one) rather than a chunk-level degradation. One member per `return`-on-
 * failure below, so the set is exhaustive by construction: adding a new
 * bail-out without naming it here is a type error.
 *
 * The native/IPC-sourced members mirror `fa.rs`'s own `FaErrorKind`
 * (`faBoundaryTypes.ts`'s `FaErrorKind`) one-for-one EXCEPT `'cancelled'`,
 * which is its own top-level `FaRunResult` status and can never reach here —
 * see `classifyFaError` below. `'runtime-load-failed'`, `'out-of-memory'` and
 * `'offline'` are reserved: nothing on the Rust side reports them distinctly
 * from `inference-failed` yet (Wave 3 adds the cloud path `'offline'` covers),
 * so they are not yet reachable, but the taxonomy is named now rather than
 * invented later against a different naming convention.
 */
export type FaFailureKind =
  | 'unsupported-language'
  /** G4 Unit 4 — the cheap, pre-FA bag-of-words coverage check
   *  (localFaCoverageGate.ts) found the script and the cached transcript
   *  sharing 20% or fewer of the script's own words. A precondition pause,
   *  like 'unsupported-language' above: computed before any FA compute is
   *  spent, never after. `detail` carries the coverage percentage and script
   *  word count. `resumable: true`, same as every other pause — the cached
   *  Whisper transcript this check read is untouched either way. */
  | 'hopeless-local-coverage'
  | 'empty-chunk-plan'
  | 'zero-words'
  | 'model-not-found'
  | 'model-hash-mismatch'
  | 'runtime-load-failed'
  | 'audio-stage-failed'
  | 'inference-failed'
  | 'already-running'
  | 'out-of-memory'
  | 'offline'
  /** G6 Step 0a — this binary was compiled without the `fa-inference`
   *  feature (`FaErrorKind::NotImplemented`, `fa.rs`'s
   *  `#[cfg(not(feature = "fa-inference"))]` arm). Split out of the
   *  'inference-failed' catch-all it used to fall into: "the alignment
   *  engine reported an error" implies a transient/fixable-by-retry failure,
   *  which this is not — retrying can never succeed without a different
   *  build. */
  | 'not-compiled';

/**
 * Why a run is DEGRADED rather than clean — FA tokens (or Whisper tokens
 * standing in for them) are still usable, but the caller must flag the run
 * rather than present it as ordinary success.
 *
 * `'gate-closed'`: the FA capability gate was OFF for this project, so FA was
 * never attempted — Whisper-only, and per the operator ruling this must be
 * "visibly flagged degraded, never a silent pick". Retires when the gate
 * itself retires (Wave 2, `faGate.ts`); until then this is how the gate-
 * closed site (previously silent beyond an optional Sync Log line) reports
 * itself through the SAME typed channel every other outcome uses.
 *
 * `'ctc-infeasible-chunk'`: `fa_onnx.rs`'s CTC lattice was infeasible for one
 * or more chunks and placeholder timing was auto-filled for them
 * (`fallback_words_for_infeasible_chunk`). Produced when `FaEvent::Done`
 * carries a non-zero `nFallbackChunks` / non-empty `infeasibleChunks`
 * (plan-v3 item 6). The run still returns tokens; the caller must flag it.
 *
 * `'user-chose-whisper'`: the user answered a `SyncPausedDialog` (item 4) by
 * explicitly picking Whisper timing for this one run, after a `'paused'`
 * run-level failure. Distinct from `'gate-closed'` — the FA toggle is still
 * ON, the user made a one-off choice for THIS run only — so the two must
 * never share a reason: a gate-closed run and a "yes, use Whisper this once"
 * run have different causes and different fixes, and collapsing them would
 * repeat exactly the "one bucket for different causes" mistake D24 already
 * closed once (see the module doc comment's `FaFailureKind` note on
 * `'inference-failed'`).
 */
export type FaDegradedReason = 'gate-closed' | 'ctc-infeasible-chunk' | 'user-chose-whisper';

/**
 * The outcome of one FA attempt. Discriminated so the caller cannot read
 * tokens off a failed run, and cannot fall back without having been told why.
 * See the module doc comment above for what each status means.
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
      /** G4 Unit 4 — set when the pre-FA coverage check (localFaCoverageGate.ts)
       *  landed 'marginal' for this run: real FA still ran (only 'hopeless'
       *  pauses before this point), but the script and the cached transcript
       *  matched fewer words than a clean pairing normally would. Warn-only —
       *  App.tsx logs it, nothing here treats it as a failure. */
      localCoverageWarning?: LocalCoverageResult;
      /** Wave 3 U2 — set only when the cloud gateway produced these words:
       *  the model + revision it reported, for the provenance stamp. */
      cloudProvenance?: GatewayProvenance;
    }
  | {
      status: 'degraded';
      reason: FaDegradedReason;
      /** Whisper tokens (gate-closed / user-chose-whisper) or FA tokens with
       *  an auto-filled span (`ctc-infeasible-chunk`) — always present, so a
       *  degraded run still commits a real timeline. Never read as if it were
       *  a clean 'ok' result. */
      tokens: TranscriptToken[];
      unscriptedRuns: UnscriptedRun[];
      detail?: string;
      silenceError?: string;
      /** Present only for `ctc-infeasible-chunk`. */
      nFallbackChunks?: number;
      infeasibleChunks?: FaInfeasibleChunk[];
      /** G4 Unit 4 — see the 'ok' variant's own doc comment; same meaning. */
      localCoverageWarning?: LocalCoverageResult;
      /** Wave 3 U2 — set only when the cloud gateway produced these words:
       *  the model + revision it reported, for the provenance stamp. */
      cloudProvenance?: GatewayProvenance;
    }
  | {
      status: 'paused';
      reason: FaFailureKind;
      /** The underlying message, where there was one (the IPC rejection's
       *  text, the unsupported language code). Undefined where the reason is
       *  the whole story. */
      detail?: string;
      /** Always `true` — named explicitly (rather than left implicit) so a
       *  reader of a persisted paused record doesn't have to know the
       *  invariant separately: the cached Whisper transcript this run already
       *  had is untouched, so resuming (retry FA, or accept Whisper) never
       *  re-transcribes. See `faSyncPauseStore.ts`. */
      resumable: true;
    }
  | { status: 'cancelled' };

/** Maps `fa.rs`'s `FaErrorKind` (as it arrives over IPC on `FaError`) to this
 *  module's own `FaFailureKind` taxonomy. Cancellation is deliberately NOT a
 *  member of `FaFailureKind` — it is its own `FaRunResult` status — so this
 *  function returns `'cancelled'` as a sentinel the caller below branches on
 *  before ever constructing a `'paused'` result, which is what keeps
 *  "cancelled must never present as a failure" (plan-v3 item 5, M3.1 site 4)
 *  true by construction rather than by convention. */
function classifyFaError(err: unknown): FaFailureKind | 'cancelled' {
  const kind = err !== null && typeof err === 'object' && 'kind' in err
    ? (err as { kind: unknown }).kind
    : undefined;
  switch (kind) {
    case 'cancelled': return 'cancelled';
    case 'modelNotFound': return 'model-not-found';
    case 'modelHashMismatch': return 'model-hash-mismatch';
    case 'alreadyRunning': return 'already-running';
    case 'inferenceFailed': return 'inference-failed';
    // G6 Step 0a — split out of the catch-all below: this is a build-config
    // fact, not an inference error, and telling the user to "try again"
    // (the 'inference-failed' copy) would be dishonest — retrying can never
    // succeed without a different build.
    case 'notImplemented': return 'not-compiled';
    // 'stateLockPoisoned' and anything else (a plain Error, a staging-call
    // rejection with no `kind` at all) fall into the same catch-all a
    // caller cannot usefully split further without guessing at backend
    // prose — matches the old 'inference-error' fallback reason's own
    // documented reasoning.
    default: return 'inference-failed';
  }
}

/**
 * Runs forced alignment for the current Apply Sync run and returns a typed
 * `FaRunResult` — never `null`, never a throw. See the module doc comment for
 * what each status means.
 *
 * `anchorTimedSegments` must already carry `text`/`startTime` (i.e. the
 * output of `applyAnchorBasedTiming`) — `computeFaChunkPlan` derives its
 * per-chunk text attribution from segment `startTime` membership.
 * `whisperTokens` is the RAW cached Whisper transcript (unfiltered — matches
 * `__faDevAlign`'s own `project.transcriptTokens` argument), used only to
 * derive chunk boundaries (via `faAnchors.ts`'s three-source-agreement run
 * structure), never returned or merged with the FA output.
 *
 * `signal` (plan-v3 item 5): when provided and already aborted, or aborted
 * while this run is in flight, the run resolves `{status: 'cancelled'}`
 * rather than 'paused' — mirrors `whisperService.ts`'s own
 * `AbortSignal`-driven `whisper_cancel` wiring so FA and Whisper cancellation
 * follow the same pattern. On abort, `fa_cancel` is invoked so the native
 * chunk loop (which polls at every chunk boundary, `fa_onnx.rs`) actually
 * stops rather than the frontend merely giving up on waiting for it.
 */
export async function runForcedAlignmentForSync(
  voiceoverAsset: Asset,
  anchorTimedSegments: VideoSegment[],
  whisperTokens: TranscriptToken[],
  audioDuration: number,
  languageCode: string | undefined,
  signal?: AbortSignal,
  // WS2 G2 completion, Unit 2 — the staged audio's content hash
  // (`spine.ts`'s `computeAudioHash`, already computed once by App.tsx's
  // Apply Sync flow before this call). Threaded through to
  // `detectSilencesSingleFlight` so this run's `detectSilences` pass can be
  // shared with `useWhisper.ts`'s `alignSegmentsFromCachedTranscript` later
  // in the SAME sync — see `silenceDetector.ts`'s own doc comment.
  // `undefined` (no computable hash) always detects fresh, exactly the
  // pre-Unit-2 behavior.
  audioHash?: string,
  // G4 Unit 4 — set by App.tsx from a one-shot ref when the user answered a
  // 'hopeless-local-coverage' SyncPausedDialog with "continue anyway", so
  // the very next attempt does not immediately re-pause on the identical
  // coverage number. `undefined`/`false` (every existing call site) runs the
  // check normally — this parameter WIDENS what a caller may opt into, it
  // narrows nothing.
  skipLocalCoverageCheck?: boolean,
  // Wave 3 U2 — where the alignment runs. `'cloud'` sends the SAME chunk plan
  // this function builds to the sync gateway instead of `fa_align_production`;
  // every precondition above the compute (language, the G4 coverage check —
  // Wave 3's mid-coverage abort, which therefore stops a mismatched script
  // before any cloud FA is charged) and every outcome mapping below is
  // shared. Default `'local'` keeps every existing caller unchanged.
  host: SyncEngineHost = 'local',
): Promise<FaRunResult> {
  if (signal?.aborted) return { status: 'cancelled' };

  if (!languageCode || !FA_SUPPORTED_LANGUAGES.includes(languageCode as FaLanguageCode)) {
    console.warn(
      `[fa] project.language (${String(languageCode)}) is not one of the 5 FA-supported languages ` +
      `(${FA_SUPPORTED_LANGUAGES.join(', ')}) — pausing for the user to choose.`,
    );
    return { status: 'paused', reason: 'unsupported-language', detail: String(languageCode), resumable: true };
  }
  const language = languageCode as FaLanguageCode;

  // G4 Unit 4 — local pre-FA coverage check (STATUS.md-adjacent, operator
  // design; local sibling of Wave 3's planned cloud mid-coverage abort — see
  // localFaCoverageGate.ts's own header for the full rationale). Cheap
  // (bag-of-words, no alignment) and synchronous, so it runs before any of
  // the real compute below. 'hopeless' PAUSES — never auto-aborts — so the
  // user decides; 'marginal' rides along on the eventual ok/degraded result
  // as a warn-only finding App.tsx logs, and does not stop this attempt.
  const coverage = computeLocalPreFaCoverage(anchorTimedSegments, whisperTokens, language);
  if (coverage.band === 'hopeless' && !skipLocalCoverageCheck) {
    console.warn(
      `[fa] local pre-FA coverage is hopeless (${(coverage.coverage * 100).toFixed(0)}% of ${coverage.scriptWordCount} ` +
      'script words found in the cached transcript) — pausing for the user to choose.',
    );
    return {
      status: 'paused',
      reason: 'hopeless-local-coverage',
      detail: `${(coverage.coverage * 100).toFixed(0)}% of ${coverage.scriptWordCount} script words matched`,
      resumable: true,
    };
  }

  // Everything below this point is wrapped in one try/catch — matching the
  // pre-existing "never throws" contract — so an unexpected throw from
  // fetch/blob conversion/chunk planning (not just the two invoke() calls,
  // which have their own more specific inner try/catches below) still
  // resolves rather than propagates. The two inner try/catches return early
  // on their own catch, so they never fall through into this one.
  try {
    return await runFaAttempt(
      voiceoverAsset, anchorTimedSegments, whisperTokens, audioDuration, language, signal, audioHash,
      coverage.band === 'marginal' ? coverage : undefined,
      host,
    );
  } catch (err) {
    // Anything reaching here is NOT one of the two invoke() calls (they have
    // their own inner try/catches and always return, never rethrow) — an
    // unexpected throw from fetch/blob conversion/chunk planning. Never a
    // real 'cancelled' kind at this outer layer (nothing here rejects with
    // `{kind:'cancelled'}` except the invoke wrappers above), so this is
    // always a genuine pause, classified the same way an IPC rejection would
    // be for consistency, defaulting to 'inference-failed'.
    const kind = classifyFaError(err);
    console.warn('[fa] forced alignment failed — pausing for the user to choose:', err);
    return {
      status: 'paused',
      reason: kind === 'cancelled' ? 'inference-failed' : kind,
      detail: describeInvokeError(err),
      resumable: true,
    };
  }
}

async function runFaAttempt(
  voiceoverAsset: Asset,
  anchorTimedSegments: VideoSegment[],
  whisperTokens: TranscriptToken[],
  audioDuration: number,
  language: FaLanguageCode,
  signal: AbortSignal | undefined,
  audioHash?: string,
  // G4 Unit 4 — set only when the caller's own coverage check landed
  // 'marginal' (never 'hopeless' — that pauses before this function is ever
  // called). Rides along on the eventual ok/degraded result so App.tsx can
  // log a warn-only finding; nothing in this function branches on it.
  localCoverageWarning?: LocalCoverageResult,
  host: SyncEngineHost = 'local',
): Promise<FaRunResult> {
  const voiceoverBlob = voiceoverAsset.file ?? await (await fetch(voiceoverAsset.url)).blob();

  const silenceResult = await detectSilencesSingleFlight(audioHash, voiceoverBlob);
  const silences = silenceResult.status === 'ok' ? silenceResult.silences : [];
  const silenceError = silenceResult.status === 'ok' ? undefined : silenceResult.errorMessage;
  if (silenceError !== undefined) {
    console.warn('[fa] silence detection failed, chunking with zero silences:', silenceError);
  }
  if (signal?.aborted) return { status: 'cancelled' };

  // WS2 G2 item 2 — off-main-thread matcher. Warms `computeRunContext`'s
  // reference-identity memo (item 1) by running the ONE Hirschberg pass this
  // scope needs in a worker; `computeFaChunkPlan` and `computeUnscriptedRuns`
  // below then hit that cache and return synchronously without re-running
  // it. `signal` reaching here is the M3.6 "AbortSignal so C8's cancel
  // reaches it" requirement — an abort mid-match terminates the worker
  // (`hirschbergMatchClient.ts`) and surfaces as this run's own typed
  // `'cancelled'` outcome, never a paused/failed one.
  //
  // G4 Unit 2 — `language` (below, and at the two calls after this one) is
  // real and already validated here, unlike App.tsx's shared multi-gate
  // memo where R.10/R.12 still outnumber R.11's real-language call and the
  // warm-up deliberately keeps favoring `undefined` (see App.tsx's own
  // comment). This function is the single, self-contained owner of all
  // three `computeRunContext`-backed calls in this one FA run — there is no
  // competing majority to favor, so all three consistently use the real,
  // known language and the memo stays warm end to end.
  try {
    await computeRunContextAsync(anchorTimedSegments, whisperTokens, silences, audioDuration, language, signal);
  } catch (err) {
    if (err instanceof MatchCancelledError) return { status: 'cancelled' };
    throw err;
  }
  if (signal?.aborted) return { status: 'cancelled' };

  // G4 Unit 2 — `loadFaLanguageData` is the TS-side production data path for
  // `scripts/fixtures/fa-vocab-<lang>.json`/`fa-cardinal-<lang>.json`
  // (`faLanguageData.ts`'s own header has the full mechanism). Before this,
  // `computeFaChunkPlan` here received no `languageCode` at all — not even
  // the languageCode-alone canonicalization G4 Unit 1 gave `detectSeamFit
  // Defects` — so this run's own chunk-text word count could disagree with
  // the text Rust's `fa_onnx.rs` actually normalizes and aligns against
  // (its OWN embedded copy of the same five files, `include_str!`, already
  // correct — this wiring is TS-side qi-bookkeeping parity, not an
  // inference-quality fix). `languageData` is `undefined` only for a
  // language this build has no shipped pack for (NR-6, no silent
  // fallback) — `computeFaChunkPlan`'s own `vocabChars`/`cardinalData`
  // params are optional and fall back to `languageCode`-alone behavior in
  // that case, exactly as before this unit for any such language.
  const languageData = loadFaLanguageData(language);
  const chunks = computeFaChunkPlan(
    anchorTimedSegments, whisperTokens, silences, audioDuration, undefined, language,
    languageData?.vocabChars, languageData?.cardinalData,
  );
  if (chunks.length === 0) {
    console.warn('[fa] chunk plan is empty (every segment has empty text) — pausing for the user to choose.');
    return { status: 'paused', reason: 'empty-chunk-plan', resumable: true };
  }

  if (host === 'cloud') {
    return runCloudFaAttempt(
      voiceoverBlob, audioHash, chunks, anchorTimedSegments, whisperTokens, silences, silenceError,
      audioDuration, language, signal, localCoverageWarning,
    );
  }

  const buffer = await voiceoverBlob.arrayBuffer();
  const audioExtHint = voiceoverAsset.file?.type
    || voiceoverAsset.file?.name.split('.').pop()
    || '';
  if (signal?.aborted) return { status: 'cancelled' };

  let inputPath: string;
  try {
    // Raw IPC body (Uint8Array) staged to a content-addressed temp file by
    // fa_stage_audio_raw, not base64+JSON — a long/uncompressed voiceover as
    // base64 inflates ~5-8x across the JS heap and the WKWebView IPC bridge
    // before Rust ever sees it (fa_stage_audio_raw's own doc comment has the
    // full accounting). 'kinetix-fa-production-inputs' namespaces this
    // command's staged inputs apart from the DEV harness's own
    // 'kinetix-fa-dev-inputs' so the two can never collide on the same
    // content-addressed path. Deferred until after the empty-chunk-plan
    // check above — matching the pre-existing fail-cheap-before-IPC
    // ordering — so a run that's about to pause never pays for staging a
    // file it will not use.
    inputPath = await invoke<string>('fa_stage_audio_raw', new Uint8Array(buffer), {
      headers: {
        'cache-dir': 'kinetix-fa-production-inputs',
        'ext-hint': audioExtHint,
      },
    });
  } catch (err) {
    // fa_stage_audio_raw returns Result<String, String> (fa_shared.rs) — a bare
    // string, never a typed FaError — so this site is classified by WHICH
    // call failed (staging), not by decoding backend prose. Distinct from
    // 'inference-failed' in the mapping table because the failure is
    // filesystem/IO, not inference.
    console.warn('[fa] audio staging failed — pausing for the user to choose:', err);
    return { status: 'paused', reason: 'audio-stage-failed', detail: describeInvokeError(err), resumable: true };
  }
  if (signal?.aborted) {
    invoke('fa_cancel', {}).catch(() => {});
    return { status: 'cancelled' };
  }

  const channel = new Channel<FaEvent>();
  let done: Extract<FaEvent, { event: 'Done' }>['data'];
  try {
    done = await new Promise<Extract<FaEvent, { event: 'Done' }>['data']>((resolve, reject) => {
      const onAbort = (): void => {
        invoke('fa_cancel', {}).catch(() => {});
        reject({ kind: 'cancelled' });
      };
      signal?.addEventListener('abort', onAbort, { once: true });
      channel.onmessage = (msg) => {
        // Wave 1 hotfix FIX 3 — detach the abort listener ONLY on a TERMINAL
        // event. This used to run on every message, so the first per-chunk
        // `Progress` silently disarmed cancel for the rest of the run: an
        // early Cancel (before any chunk finished) worked, a Cancel minutes
        // into a long project did nothing and the run continued to commit
        // (`forcedAlignmentRun.test.ts`'s late-cancel case is the repro).
        if (msg.event === 'Progress') return;
        signal?.removeEventListener('abort', onAbort);
        if (msg.event === 'Done') {
          resolve(msg.data);
        } else if (msg.event === 'Error') {
          // Carries the ORIGINAL FaEvent::Error payload shape rather than
          // wrapping it into a plain Error — the channel's Error variant is
          // message-only (faBoundaryTypes.ts's FaEvent), never a typed kind,
          // so classifyFaError's catch-all applies, same as before.
          reject(new Error(msg.data.message));
        }
      };
      invoke('fa_align_production', {
        inputPath,
        chunks,
        language,
        onEvent: channel,
      }).catch((err: unknown) => {
        signal?.removeEventListener('abort', onAbort);
        // Reject with the ORIGINAL error object (not wrapped into a plain
        // Error) — fa_align_production rejects with a real, typed `FaError
        // { kind, message }` (fa.rs), and wrapping it here would discard
        // `kind` before classifyFaError ever saw it, which is exactly the
        // "split the catch-all at the IPC boundary" fix plan-v3 item 3 asks
        // for at this site.
        reject(err);
      });
    });
  } catch (err) {
    const kind = classifyFaError(err);
    if (kind === 'cancelled') return { status: 'cancelled' };
    console.warn('[fa] forced alignment failed — pausing for the user to choose:', err);
    return { status: 'paused', reason: kind, detail: describeInvokeError(err), resumable: true };
  }

  const words = done.words;
  const infeasibleChunks: FaInfeasibleChunk[] = done.infeasibleChunks ?? [];
  const nFallbackChunks = done.nFallbackChunks ?? infeasibleChunks.length;
  if (words.length === 0) {
    console.warn('[fa] forced alignment returned zero words — pausing for the user to choose.');
    return { status: 'paused', reason: 'zero-words', resumable: true };
  }
  const tokens = faWordSpansToTranscriptTokens(words);
  const unscriptedRuns = computeUnscriptedRuns(anchorTimedSegments, whisperTokens, silences, audioDuration, language);
  if (nFallbackChunks > 0 || infeasibleChunks.length > 0) {
    return {
      status: 'degraded',
      reason: 'ctc-infeasible-chunk',
      tokens,
      unscriptedRuns,
      silenceError,
      nFallbackChunks: nFallbackChunks > 0 ? nFallbackChunks : infeasibleChunks.length,
      infeasibleChunks,
      localCoverageWarning,
    };
  }
  return {
    status: 'ok',
    tokens,
    // Same four arguments `computeFaChunkPlan` was given three statements
    // above, so these are R.5's OWN excisions for this run — not a
    // re-derivation against different inputs.
    unscriptedRuns,
    silenceError,
    localCoverageWarning,
  };
}

/**
 * Wave 3 U2 — the cloud arm of `runFaAttempt`, entered after the shared chunk
 * plan is built. Outcome mapping mirrors the local arm: no words → 'zero-words'
 * pause; any infeasible chunk → 'degraded'/'ctc-infeasible-chunk' (the gateway
 * reports the count, not per-chunk detail, so `infeasibleChunks` is empty);
 * a gateway that could not be reached → the 'offline' pause Wave 1 reserved
 * for exactly this; any other cloud failure → 'inference-failed' with the
 * typed reason in `detail`. Never a silent switch to the local engine
 * (the G3 offline contract): the pause dialog offers that choice.
 */
async function runCloudFaAttempt(
  voiceoverBlob: Blob,
  audioHash: string | undefined,
  chunks: ReturnType<typeof computeFaChunkPlan>,
  anchorTimedSegments: VideoSegment[],
  whisperTokens: TranscriptToken[],
  silences: Parameters<typeof computeUnscriptedRuns>[2],
  silenceError: string | undefined,
  audioDuration: number,
  language: FaLanguageCode,
  signal: AbortSignal | undefined,
  localCoverageWarning: LocalCoverageResult | undefined,
): Promise<FaRunResult> {
  if (!audioHash) {
    return {
      status: 'paused', reason: 'audio-stage-failed',
      detail: 'cloud alignment needs the voiceover content hash, which was not available', resumable: true,
    };
  }
  if (signal?.aborted) return { status: 'cancelled' };
  const outcome = await alignViaCloud({ voiceoverBlob, audioHash, chunks, language, signal });
  if (outcome.status === 'cancelled') return { status: 'cancelled' };
  if (outcome.status === 'failed') {
    const offline = outcome.error.kind === 'unreachable' || outcome.error.kind === 'timeout';
    console.warn('[fa] cloud forced alignment failed — pausing for the user to choose:', outcome.error);
    return {
      status: 'paused',
      reason: offline ? 'offline' : 'inference-failed',
      detail: describeCloudError(outcome.error),
      resumable: true,
    };
  }
  if (outcome.words.length === 0) {
    console.warn('[fa] cloud forced alignment returned zero words — pausing for the user to choose.');
    return { status: 'paused', reason: 'zero-words', resumable: true };
  }
  const tokens = faWordSpansToTranscriptTokens(outcome.words);
  const unscriptedRuns = computeUnscriptedRuns(anchorTimedSegments, whisperTokens, silences, audioDuration, language);
  if (outcome.nFallbackChunks > 0) {
    return {
      status: 'degraded',
      reason: 'ctc-infeasible-chunk',
      tokens,
      unscriptedRuns,
      silenceError,
      nFallbackChunks: outcome.nFallbackChunks,
      infeasibleChunks: [],
      localCoverageWarning,
      cloudProvenance: outcome.provenance,
    };
  }
  return { status: 'ok', tokens, unscriptedRuns, silenceError, localCoverageWarning, cloudProvenance: outcome.provenance };
}
