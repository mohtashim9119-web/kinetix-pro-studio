import { useCallback, useRef, useState } from 'react';
import {
  transcribeWithProgress,
  alignScenestoTranscript,
  distributeSegmentTimes,
  filterMalformedTokens,
  toAlignmentLanguageCode,
  type SegmentAlignment,
  type AlignmentLanguageCode,
} from '../services/whisperService';
import { detectSilences } from '../services/silenceDetector';
import type { SilenceInterval, SilenceDetectResult } from '../services/silenceDetector';
import { applyAnchorBasedTiming, getFileIdentity } from '../services/syncEngine';
import { validate1to2 } from '../services/syncContracts';
import { buildSilenceErrorEntry, buildMalformedTokenEntry, buildContractViolationEntry, appendSyncLogEntries } from '../services/syncLog';
import { buildUnappliedTranscript } from '../services/unappliedTranscript';
import type { TranscriptionStatus, Asset, VideoSegment, Project, TranscriptToken, SyncLogEntry } from '../types';

/**
 * Fetches the voiceover blob and scans it for silence.
 *
 * WS4 Feature 3 (decision 11a): the old bare `catch { return []; }` is gone.
 * A fetch failure is now reported as a structured error, exactly like a decode
 * failure, so the caller can tell "no silence found" apart from "the scan never
 * ran" — the two produce very different boundary placement.
 *
 * WS2 Step 10: prefers the already-in-memory `asset.file` over re-fetching
 * `asset.url` (a `blob:` object URL), mirroring `App.tsx`'s
 * `resolveVoiceoverDuration` precedent. `fetch()` against a same-session
 * `blob:` URL was observed failing outright ("Failed to fetch") in a Windows
 * WebView2 build while every DOM-native consumer of the identical URL (the
 * `<video src>` element) kept working — `asset.file` is the same bytes
 * without the extra round-trip through the browser's blob-URL registry.
 * Falls back to `fetch(asset.url)` only when `.file` is absent (a project
 * asset reconstructed from IndexedDB after a reload never carries a `File`
 * reference — `projectStore.ts` strips it before persisting).
 */
export async function fetchAndDetectSilences(asset: Asset): Promise<SilenceDetectResult> {
  let blob: Blob;
  try {
    if (asset.file) {
      blob = asset.file;
    } else {
      const resp = await fetch(asset.url);
      if (!resp.ok) {
        return { status: 'error', errorMessage: `voiceover fetch failed: ${resp.status} ${resp.statusText}` };
      }
      blob = await resp.blob();
    }
  } catch (err) {
    const message = err instanceof Error ? err.message || err.name : String(err);
    return { status: 'error', errorMessage: `voiceover fetch failed: ${message}` };
  }
  return detectSilences(blob);
}

/** What `alignFromCache` hands back to the orchestrator (App.tsx). */
export interface AlignFromCacheResult {
  segments: VideoSegment[];
  coverage: SegmentAlignment[];
  silences: SilenceInterval[];
  /**
   * WS4 Feature 4 — the MALFORMED-FILTERED token array. Callers that do their
   * own token lookups (App.tsx's `snapCoveredBoundaries`) MUST use this array
   * and not `project.transcriptTokens`: `coverage[i].firstTokenIdx` /
   * `lastTokenIdx` are indices into this one, so reading the unfiltered array
   * with them would resolve to the wrong tokens.
   */
  tokens: TranscriptToken[];
  /** WS4 Feature 3 — set only when silence detection failed. Boundaries fell
   *  back to token midpoints; sync still completed. */
  silenceError?: string;
  /** WS4 Feature 4 — how many tokens the malformed filter dropped, and out of
   *  how many. `skippedCount === 0` on a clean transcript. */
  malformedTokenCount: number;
  totalTokenCount: number;
}

/**
 * Re-times `segments` against already-transcribed tokens, with no network/IPC
 * call. Shared by the live Option-A fast-path below and the Option C direct
 * pre-commit call from handleApplySyncFromFiles (App.tsx).
 */
export async function alignSegmentsFromCachedTranscript(
  audioAsset: Asset,
  segments: VideoSegment[],
  tokens: TranscriptToken[],
  durationSecs: number,
  // WS1 Task 5, docs/work-in-progress.md §11 item 1, owner ruling R-G:
  // defaults to 'whisper', preserving both existing call sites' behavior
  // (this function's own live-Option-A caller and App.tsx's direct Option C
  // call) byte-for-byte. The forced-alignment production branch (App.tsx's
  // cachedTokensReady block) passes 'forced-alignment' explicitly when it
  // substitutes FA-derived tokens for `tokens` above.
  anchorSource: 'whisper' | 'forced-alignment' = 'whisper',
  // WS2 T3.1 — the project's stored/detected language, narrowed by the
  // caller via `toAlignmentLanguageCode` (or passed already-narrowed).
  // `undefined` (unset/unsupported) reproduces this function's pre-T3.1
  // behavior exactly — see `toAlignmentLanguageCode`'s doc comment.
  languageCode?: AlignmentLanguageCode,
): Promise<AlignFromCacheResult> {
  const silenceResult = await fetchAndDetectSilences(audioAsset);
  // Fail-loud, but never fail-stop: a silence-scan failure degrades boundary
  // placement to token midpoints (the documented fallback) and is reported
  // upward, rather than aborting a sync that can still produce a timeline.
  const silences = silenceResult.status === 'ok' ? silenceResult.silences : [];
  const silenceError = silenceResult.status === 'error' ? silenceResult.errorMessage : undefined;
  if (silenceError) {
    console.warn('[sync] silence detection failed — boundaries fall back to token midpoints:', silenceError);
  }

  // WS4 Feature 4 — filter BEFORE alignment, once. Everything downstream (the
  // aligner here, and App.tsx's own snap) uses `usableTokens`; see
  // AlignFromCacheResult.tokens for why that consistency is load-bearing.
  const filtered = filterMalformedTokens(tokens, durationSecs, languageCode);
  const usableTokens = filtered.tokens;
  if (filtered.skippedCount > 0) {
    console.warn(
      `[sync] filtered ${filtered.skippedCount} of ${filtered.totalTokens} malformed transcript token(s) before alignment`,
    );
  }

  const alignments = alignScenestoTranscript(segments, usableTokens, silences, durationSecs, languageCode);
  const updated = distributeSegmentTimes(segments, alignments, anchorSource);
  // Re-derive every segment's span from its (now whisper-tagged) anchor — the
  // same normalization click 2 currently gets for free in App.tsx before
  // alignFromCache even runs. Click 1 otherwise commits the plain aligner's
  // raw matched boundaries verbatim; click 2 carries those forward as anchors
  // and this same pass tightens them — that gap is the click-twice bug.
  // Running it here, on the same segments, in the same call, makes click 1
  // match click 2. No extra silence/audio work: applyAnchorBasedTiming is
  // pure anchor arithmetic (segments + audioDuration in, no tokens/silences).
  // Subsumes the old segment-0-only clamp (PASS 1 handles index 0 the same
  // way); for an already-fully-anchored input (click 2) every pass here is a
  // no-op, since PASS 1-4 just re-derive the same values they're given.
  //
  // WS1b: `alignments` is also returned as `coverage` — the per-segment
  // matched/confidence/matchedWords/totalWords the orchestrator needs for the
  // bidirectional coverage metric + two-signal abort gate (App.tsx). Untouched
  // by the applyAnchorBasedTiming pass below, which only re-derives
  // startTime/duration from anchors, not match quality.
  const final = applyAnchorBasedTiming(updated, durationSecs);
  return {
    segments: final,
    coverage: alignments,
    silences,
    tokens: usableTokens,
    silenceError,
    malformedTokenCount: filtered.skippedCount,
    totalTokenCount: filtered.totalTokens,
  };
}

/**
 * WS2 T4.7 Requirement 4 — what `startTranscription` reports back to its
 * caller.
 *
 * A REFUSAL IS A RETURN VALUE, NOT A STATUS. It deliberately does not travel
 * through `transcriptionStatus`: the only situation that produces one is "a run
 * is already going," and that run owns the status field — writing a refusal
 * into it would replace a live progress percentage with an error the user did
 * not cause, i.e. the refusal would look exactly like the failure of the run it
 * was protecting. The caller surfaces `message` however it surfaces transient
 * messages (App.tsx: a toast) while the real run keeps its progress bar.
 */
export type StartTranscriptionOutcome =
  | { started: true }
  | { started: false; reason: 'already-running'; message: string };

/** Mirrors `whisper.rs`'s `IN_FLIGHT_REFUSAL_PREFIX`. */
const NATIVE_IN_FLIGHT_REFUSAL_PREFIX = 'whisper:already-running:';

/**
 * The key the NATIVE single-flight registry files this job under, or
 * `undefined` when the caller supplied no project id (which leaves the native
 * side on its own shared-bucket default, exactly as before).
 *
 * WHY IT CARRIES THE AUDIO'S IDENTITY AND NOT JUST `Project.id`. The native key
 * decides two different things at once: which job a duplicate is refused
 * against, and which job a reloaded page RE-ATTACHES to. Project id alone is
 * right for the first and wrong for the second — a whisper-cli child survives a
 * Cmd+R, so a page that reloads and then transcribes a DIFFERENT file for the
 * same project would attach to the old file's job and adopt its tokens as
 * though they described the new audio. Naming the audio in the key makes that
 * misattribution unrepresentable rather than merely unlikely.
 *
 * It does not reintroduce the flaw that ruled out keying by `audio_path`
 * (whisper.rs's key-choice note): a fresh temp path is minted per call and so
 * never collides with itself, whereas `getFileIdentity` is stable for the same
 * bytes across calls AND across reloads — two attempts at the same audio still
 * land on one key and the second is still refused.
 *
 * Same-project/different-file duplicates stay covered: the in-page gate above
 * refuses those on `projectId` before this key is ever built.
 */
function nativeJobKey(projectId: string | undefined, audioAsset: Asset): string | undefined {
  if (projectId === undefined) return undefined;
  // `.file` is absent for a project asset rehydrated from IndexedDB (its File
  // is stripped before persisting), so fall back to the asset id — also stable
  // for the same audio, and the only identity such a call has.
  const audioIdentity = audioAsset.file ? getFileIdentity(audioAsset.file) : audioAsset.id;
  return `${projectId}::${audioIdentity}`;
}

export interface StartTranscriptionOptions {
  /**
   * `Project.id` this run belongs to. Requirement 4's single-flight gate is
   * scoped to it, and the scoping is the point: a second attempt for the SAME
   * project is a duplicate and is refused, while a run for a DIFFERENT project
   * (the user switched projects mid-transcription) keeps the pre-existing
   * cancel-then-start behaviour — refusing there would strand the new project
   * behind a job whose result it can never use.
   *
   * Omitted (`undefined`) reproduces the pre-T4.7 behaviour exactly: no
   * identity to compare, so no refusal is possible and every call cancels the
   * previous run and starts. Existing callers and tests are unaffected.
   */
  projectId?: string;
  /**
   * Fired once, immediately after the completion `onProjectUpdated` write, on
   * the 100%-with-tokens path ONLY — not on the empty-token warning path, not
   * on cancel, not on error. Requirement 3's durability hook: App.tsx uses it
   * to flush the just-written `unappliedTranscript` past the 500 ms autosave
   * debounce, so the window in which a finished transcript exists only in
   * React state is closed rather than merely shortened.
   *
   * Awaited, so a caller that returns a promise (a real disk write) is
   * sequenced before this call resolves; a throw is swallowed and logged —
   * a failed flush must not turn a successful transcription into an error.
   */
  onCompleted?: () => void | Promise<void>;
}

export interface UseWhisperApi {
  transcriptionStatus: TranscriptionStatus;
  startTranscription: (
    audioAsset: Asset,
    durationSecs: number,
    segments: VideoSegment[],
    /** Phase 2a (H.1/H.7) — the project's stored/overridden language code, or
     *  `undefined` to auto-detect. `undefined` here is what makes the run use
     *  `-l auto`; once detection (or an explicit override) sets a value, this
     *  should be passed on every subsequent call so detection never re-runs
     *  and silently overwrites a user's choice. */
    language: string | undefined,
    onSegmentsUpdated: (segments: VideoSegment[]) => void,
    onProjectUpdated: (updater: (p: Project) => Project) => void,
    /** WS2 T4.7 — single-flight scoping + the completion flush hook. Optional;
     *  omitting it reproduces the pre-T4.7 behaviour exactly. */
    opts?: StartTranscriptionOptions,
  ) => Promise<StartTranscriptionOutcome>;
  cancelTranscription: () => void;
  dismissError: () => void;
  /** Clears a terminal transcription status (`done` / `warning`) without
   *  touching an in-flight run. Used when the user discards an unapplied
   *  transcript whose completion state would otherwise keep Apply Sync live. */
  clearTerminalTranscriptionStatus: () => void;
  /**
   * Re-times segments from already-cached tokens — no network/IPC call.
   * WS1b: also returns the per-segment `coverage` (matched/confidence/
   * matchedWords/totalWords) alongside the re-timed `segments`, so the caller
   * (App.tsx's handleApplySyncFromFiles) can run the coverage gate before
   * committing.
   *
   * The detected `silences` are returned too (middle-gap position-offset fix):
   * the orchestrator re-snaps the covered-only boundaries after filtering
   * (`snapCoveredBoundaries`), and that needs the same silence set this call
   * already detected — re-detecting it at the call site would decode the audio
   * a second time for identical output.
   *
   * WS4: the result also carries `silenceError` (Feature 3), the malformed-token
   * counts (Feature 4), and the FILTERED `tokens` array those counts describe.
   * See AlignFromCacheResult.
   */
  alignFromCache: (
    audioAsset: Asset,
    segments: VideoSegment[],
    tokens: TranscriptToken[],
    durationSecs: number,
    anchorSource?: 'whisper' | 'forced-alignment',
    languageCode?: AlignmentLanguageCode,
  ) => Promise<AlignFromCacheResult>;
}

export function useWhisper(): UseWhisperApi {
  const [transcriptionStatus, setTranscriptionStatus] =
    useState<TranscriptionStatus>({ phase: 'idle' });

  // Generation counter — stale async callbacks bail out when the counter has
  // advanced past their own snapshot (same pattern as useExport).
  const generationRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);

  // WS2 T4.7 Requirement 4 — the single-flight gate's whole state: the
  // `Project.id` of the run currently in flight, or null when nothing is
  // running. A REF AND NOT STATE, deliberately: the gate must be readable and
  // writable synchronously within one `startTranscription` call so two calls in
  // the same tick cannot both pass it, and a `useState` value is stale for
  // exactly that long. Nothing renders from it.
  //
  // Cleared in the `finally` below rather than at each exit, so an abort, a
  // throw, an empty-token warning and a clean finish all release the gate —
  // a gate that leaks on one exit path locks the user out of transcribing that
  // project for the rest of the session, which is a worse failure than the
  // duplicate run it was stopping.
  const inFlightProjectIdRef = useRef<string | null>(null);

  const startTranscription = useCallback(
    async (
      audioAsset: Asset,
      durationSecs: number,
      segments: VideoSegment[],
      language: string | undefined,
      onSegmentsUpdated: (segments: VideoSegment[]) => void,
      onProjectUpdated: (updater: (p: Project) => Project) => void,
      opts?: StartTranscriptionOptions,
    ): Promise<StartTranscriptionOutcome> => {
      // WS2 T4.7 Requirement 4 — duplicate-run refusal, BEFORE any state is
      // touched. Checked first so a refused call is a true no-op: it must not
      // abort the running job, must not bump the generation counter, and must
      // not overwrite `transcriptionStatus` (see StartTranscriptionOutcome).
      // Scoped to the project id, and only when one was supplied — see
      // StartTranscriptionOptions.projectId.
      const projectId = opts?.projectId;
      if (projectId !== undefined && inFlightProjectIdRef.current === projectId) {
        return {
          started: false,
          reason: 'already-running',
          message: 'A transcription is already running for this project — wait for it to finish or cancel it first.',
        };
      }

      // Capture expected segment IDs at entry — before any async work or Option A branch.
      // Gates onSegmentsUpdated so a stale alignment result is discarded if the scene
      // structure changed (e.g. user removed a scene and re-synced) while Whisper ran.
      const expectedSegmentIds = new Set(segments.map(s => s.id));
      const expectedCount = segments.length;
      const segmentSetStillValid = (out: VideoSegment[]): boolean => {
        if (out.length !== expectedCount) return false;
        for (const s of out) {
          if (!expectedSegmentIds.has(s.id)) return false;
        }
        return true;
      };

      // Cancel any job already running. Reached only when the gate above did
      // NOT refuse, i.e. this is a run for a different project (or an
      // id-less legacy caller) — never a duplicate for the same one.
      abortRef.current?.abort();

      // Claim the gate. Only when an id was supplied: an id-less caller has no
      // identity to be a duplicate OF, and claiming `undefined` would make the
      // next id-less call refuse itself.
      if (projectId !== undefined) inFlightProjectIdRef.current = projectId;

      const jobId = crypto.randomUUID();
      const generation = ++generationRef.current;
      const controller = new AbortController();
      abortRef.current = controller;

      setTranscriptionStatus({ phase: 'transcribing', percent: 0, jobId });

      try {
        const { tokens, detectedLanguage } = await transcribeWithProgress(
          audioAsset,
          durationSecs,
          language,
          (percent) => {
            if (generationRef.current !== generation) return;
            setTranscriptionStatus({ phase: 'transcribing', percent, jobId });
          },
          controller.signal,
          nativeJobKey(projectId, audioAsset),
        );

        if (generationRef.current !== generation) return { started: true };

        if (tokens.length === 0) {
          // Whisper returned no tokens — keep the existing character-weight
          // estimate timings instead of overwriting with zero-collapsed
          // alignment results (alignScenestoTranscript maps every segment to
          // {t0:0,t1:0} when tokens is empty).
          //
          // A zero-token result is a decode/recognition failure masquerading as
          // success: whisper-cli exits 0 with no transcript (confirmed for
          // M4A/AAC-family inputs pre-Part-1; still possible for silent or
          // unintelligible audio). Surface it as a NON-blocking warning — sync
          // still proceeds via the estimate-timing fallback (the correct
          // degraded behavior), but the user is told rather than left guessing.
          // 'warning' is a terminal phase, so Apply Sync's gating re-enables the
          // same way 'done' did.
          console.warn('[whisper] empty token array received — keeping estimate timings');
          setTranscriptionStatus({
            phase: 'warning',
            message: 'No speech was transcribed — segment timing falls back to an estimate. Check the audio has clear speech.',
            jobId,
          });
          setTimeout(() => {
            if (generationRef.current === generation) {
              setTranscriptionStatus({ phase: 'idle' });
            }
          }, 8000);
          return { started: true };
        }

        const silenceResult = await fetchAndDetectSilences(audioAsset);
        if (generationRef.current !== generation) return { started: true };

        // WS4 Features 3 + 4 on the fresh-transcription path, plus the R11
        // staging-run-id mechanism (Pipeline Contract Program, Pair 1, Step 7,
        // docs/sync-pipeline-contract-plan.md §3): this path now mints its own
        // log entries by REUSING `jobId` as the syncRunId (no new mint) —
        // SyncLogPanel already groups entries by syncRunId, so this renders as
        // its own summary-less run. The Apply Sync that follows still re-emits
        // the same silence/malformed-token findings via alignFromCache (the
        // two runs can legitimately see different data if the user re-stages
        // in between), and the existing console.warn calls below are KEPT for
        // now — their removal is a later-pair decision (§5 console-only
        // inventory), not part of this wiring.
        const syncRunId = jobId;
        const syncRunAt = Date.now();
        const silences = silenceResult.status === 'ok' ? silenceResult.silences : [];
        if (silenceResult.status === 'error') {
          console.warn(
            '[whisper] silence detection failed — boundaries fall back to token midpoints:',
            silenceResult.errorMessage,
          );
        }
        const languageCode = toAlignmentLanguageCode(language);
        const filtered = filterMalformedTokens(tokens, durationSecs, languageCode);
        if (filtered.skippedCount > 0) {
          console.warn(
            `[whisper] filtered ${filtered.skippedCount} of ${filtered.totalTokens} malformed transcript token(s) before alignment`,
          );
        }

        // Contract 1→2 validator (syncContracts.ts) — pure, zero behavior
        // change; only ever adds log entries below, never alters `filtered`
        // or anything downstream of it.
        const violations = validate1to2(filtered.tokens, filtered.drops, filtered.totalTokens, durationSecs);
        const stagingLogEntries: SyncLogEntry[] = [
          ...(silenceResult.status === 'error'
            ? [buildSilenceErrorEntry(syncRunId, silenceResult.errorMessage, syncRunAt)]
            : []),
          ...(filtered.skippedCount > 0
            ? [buildMalformedTokenEntry(syncRunId, filtered.skippedCount, filtered.totalTokens, syncRunAt, filtered.drops)]
            : []),
          ...violations.map(v => buildContractViolationEntry(syncRunId, v, syncRunAt)),
        ];

        const alignments = alignScenestoTranscript(segments, filtered.tokens, silences, durationSecs, languageCode);
        const finalSegments = distributeSegmentTimes(segments, alignments);

        // Store transcript tokens before the segment gate — the transcript is valid
        // for this audio even if alignment is rejected due to a scene structure change.
        // Preserving tokens here enables Option A caching on the next re-sync.
        onProjectUpdated(p => ({
          // WS-logs — fold this run's entries in FIRST, same convention
          // App.tsx's Apply Sync commit uses (appendSyncLogEntries is pure and
          // only touches syncLog/syncRunSummaries). No summary: this staging
          // run has no segment-coverage outcome to roll up, only whatever
          // silence/malformed-token/contract findings it produced.
          ...appendSyncLogEntries(p, stagingLogEntries, undefined),
          lastTranscribedAssetId: audioAsset.id,
          // Only overwrite when we actually have a File to compute from — the
          // re-sync call site (App.tsx) resolves a committed Asset that may
          // have lost its File reference across a reload. Falling back to the
          // existing value avoids erasing a still-valid identity in that case.
          lastTranscribedFileIdentity: audioAsset.file
            ? getFileIdentity(audioAsset.file)
            : p.lastTranscribedFileIdentity,
          transcriptTokens: tokens,
          // Phase 2a (H.1/H.7) — detection is a SUGGESTION that fills the gap
          // only once: only ever written when the project has no language yet.
          // An already-set value (from a prior detection OR an explicit
          // Project Settings override) is never overwritten here — re-running
          // this same transcription with a stored language passes it directly
          // (see the language param above), so detectedLanguage is undefined
          // on that path anyway and this branch is a no-op by construction.
          language: p.language ?? detectedLanguage,
          // WS1 Session M — the durable, non-sticky record of what `-l auto`
          // detected, for the FA gate to read even when the sticky `language`
          // above stayed undefined. Written whenever THIS run detected
          // something; never erased by an explicit-language run (which detects
          // nothing, leaving `detectedLanguage` undefined here) — the prior
          // detection still describes the current transcript.
          detectedLanguage: detectedLanguage ?? p.detectedLanguage,
          // WS2 T4.7 Requirement 3 — the durable "finished but unspent" record,
          // written in the SAME atomic update as the tokens it copies so no
          // observer can see one without the other.
          //
          // WHY IT IS NOT REDUNDANT WITH `transcriptTokens` ABOVE. That field
          // is written on this path and is also what an already-applied sync
          // leaves behind, so its presence answers "are tokens cached?" and
          // cannot answer "is there a result the user has not spent yet?" —
          // the question the recovery banner asks. This record answers only the
          // second, and is cleared by Apply Sync's own commit.
          //
          // It writes NO language field of its own: `language` /
          // `detectedLanguage` above are this update's established, separately
          // reasoned writers (H.7 stickiness), and `buildUnappliedTranscript`
          // touches neither — see `unappliedTranscript.ts`'s
          // `withUnappliedTranscript` note.
          unappliedTranscript: buildUnappliedTranscript(
            tokens,
            audioAsset.id,
            audioAsset.file ? getFileIdentity(audioAsset.file) : p.lastTranscribedFileIdentity,
          ),
        }));

        // Requirement 3's durability step. Awaited BEFORE the terminal status
        // is set, so "done" on screen means the transcript is on disk and not
        // merely in a React state update racing a reload. Fire-and-forget would
        // reduce the loss window; awaiting closes it.
        //
        // A flush failure is logged and swallowed: the transcription itself
        // succeeded, its result is in memory, and reporting a save problem as a
        // transcription error would send the user to re-run whisper-cli for a
        // fault that re-running cannot fix. `usePersistProject`'s `saveError`
        // is the surface for that, and it is already wired.
        if (opts?.onCompleted) {
          try {
            await opts.onCompleted();
          } catch (flushErr) {
            console.error('[whisper] unapplied-transcript flush failed:', flushErr);
          }
        }

        if (segmentSetStillValid(finalSegments)) {
          onSegmentsUpdated(finalSegments);
        } else {
          console.warn('[whisper] Discarding fresh transcription alignment — segment set no longer matches');
        }

        setTranscriptionStatus({ phase: 'done', jobId });

        // Auto-dismiss success banner after 3 s.
        setTimeout(() => {
          if (generationRef.current === generation) {
            setTranscriptionStatus({ phase: 'idle' });
          }
        }, 3000);
      } catch (err) {
        if (generationRef.current !== generation) return { started: true };
        if (err instanceof DOMException && err.name === 'AbortError') {
          setTranscriptionStatus({ phase: 'idle' });
          return { started: true };
        }
        const raw = err instanceof Error ? err.message : String(err);
        // The native refusal is machine-tagged precisely so it can be told
        // apart from a spawn/model/ffmpeg failure (whisper.rs's
        // IN_FLIGHT_REFUSAL_PREFIX). Reached only in the narrow race where a
        // job terminates between this run's attach probe and its start; the
        // user gets a sentence about what is happening rather than the tag.
        const message = raw.startsWith(NATIVE_IN_FLIGHT_REFUSAL_PREFIX)
          ? 'A transcription for this audio is already running — wait for it to finish or cancel it first.'
          : raw;
        setTranscriptionStatus({ phase: 'error', message, jobId });
      } finally {
        // Release the single-flight gate on EVERY exit — clean finish, empty
        // tokens, cancel, throw. One un-released path would lock the user out
        // of transcribing this project for the rest of the session, a strictly
        // worse failure than the duplicate run the gate exists to stop.
        //
        // Guarded by an identity check rather than an unconditional null: if a
        // run for a DIFFERENT project has since claimed the gate (the user
        // switched projects, which aborts this run), the ref is that run's to
        // release, not ours.
        if (projectId !== undefined && inFlightProjectIdRef.current === projectId) {
          inFlightProjectIdRef.current = null;
        }
      }
      return { started: true };
    },
    [],
  );

  const cancelTranscription = useCallback(() => {
    abortRef.current?.abort();
    generationRef.current++;
    // Release the gate synchronously as well as in the run's own `finally`.
    // The `finally` runs a microtask later (the aborted `await` has to reject
    // first), and a user who cancels and immediately re-clicks inside that
    // window would otherwise be refused for a run they just stopped.
    inFlightProjectIdRef.current = null;
    setTranscriptionStatus({ phase: 'idle' });
  }, []);

  const dismissError = useCallback(() => {
    setTranscriptionStatus({ phase: 'idle' });
  }, []);

  const clearTerminalTranscriptionStatus = useCallback(() => {
    setTranscriptionStatus(prev =>
      prev.phase === 'done' || prev.phase === 'warning'
        ? { phase: 'idle' }
        : prev,
    );
  }, []);

  return {
    transcriptionStatus,
    startTranscription,
    cancelTranscription,
    dismissError,
    clearTerminalTranscriptionStatus,
    alignFromCache: alignSegmentsFromCachedTranscript,
  };
}
