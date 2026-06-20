import { useCallback, useRef, useState } from 'react';
import {
  transcribeWithProgress,
  alignScenestoTranscript,
  alignScenesToTranscriptAnchorAware,
  distributeSegmentTimes,
  applyHeadingTiming,
} from '../services/whisperService';
import { detectSilences } from '../services/silenceDetector';
import type { SilenceInterval } from '../services/silenceDetector';
import { applyAnchorBasedTiming } from '../services/syncEngine';
import type { TranscriptionStatus, Asset, VideoSegment, Project, TranscriptToken } from '../types';

async function fetchAndDetectSilences(asset: Asset): Promise<SilenceInterval[]> {
  try {
    const resp = await fetch(asset.url);
    const blob = await resp.blob();
    return await detectSilences(blob);
  } catch {
    return [];
  }
}

/** Diagnostic only — temporary, remove once the click-twice bug is found. */
function logSyncDiag(stage: string, segments: VideoSegment[]): void {
  console.log(`[SYNC-DIAG] ${stage}`);
  console.table(segments.map((s, index) => ({
    index,
    startTime: Number(s.startTime.toFixed(3)),
    duration: Number(s.duration.toFixed(3)),
    anchorStart: s.anchorStart !== undefined ? Number(s.anchorStart.toFixed(3)) : undefined,
    anchorSource: s.anchorSource,
    locked: !!s.locked,
  })));
}

/**
 * Re-times `segments` against already-transcribed tokens, with no network/IPC
 * call. Shared by the live Option-A fast-path below and the Option C direct
 * pre-commit call from handleApplySyncFromFiles (App.tsx).
 */
async function alignSegmentsFromCachedTranscript(
  audioAsset: Asset,
  segments: VideoSegment[],
  tokens: TranscriptToken[],
  durationSecs: number,
): Promise<VideoSegment[]> {
  const silences = await fetchAndDetectSilences(audioAsset);
  const hasAnyWhisperAnchor = segments.some(s => s.anchorSource === 'whisper');
  const alignerName = hasAnyWhisperAnchor ? 'alignScenesToTranscriptAnchorAware' : 'alignScenestoTranscript';
  console.log(`[SYNC-DIAG] 3 aligner choice: hasAnyWhisperAnchor=${hasAnyWhisperAnchor} -> ${alignerName}`);
  const alignments = hasAnyWhisperAnchor
    ? alignScenesToTranscriptAnchorAware(segments, tokens, silences, durationSecs)
    : alignScenestoTranscript(segments, tokens, silences);
  const updated = distributeSegmentTimes(segments, alignments, durationSecs);
  logSyncDiag('4 after aligner / distributeSegmentTimes', updated);
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
  const reAnchored = applyAnchorBasedTiming(updated, durationSecs);
  logSyncDiag('5 after applyAnchorBasedTiming (2nd pass, post-distribute)', reAnchored);
  const final = applyHeadingTiming(reAnchored);
  logSyncDiag('6 after applyHeadingTiming', final);
  return final;
}

export interface UseWhisperApi {
  transcriptionStatus: TranscriptionStatus;
  startTranscription: (
    audioAsset: Asset,
    durationSecs: number,
    segments: VideoSegment[],
    project: Project,
    onSegmentsUpdated: (segments: VideoSegment[]) => void,
    onProjectUpdated: (updater: (p: Project) => Project) => void,
  ) => Promise<void>;
  cancelTranscription: () => void;
  dismissError: () => void;
  /** Re-times segments from already-cached tokens — no network/IPC call. */
  alignFromCache: (
    audioAsset: Asset,
    segments: VideoSegment[],
    tokens: TranscriptToken[],
    durationSecs: number,
  ) => Promise<VideoSegment[]>;
}

export function useWhisper(): UseWhisperApi {
  const [transcriptionStatus, setTranscriptionStatus] =
    useState<TranscriptionStatus>({ phase: 'idle' });

  // Generation counter — stale async callbacks bail out when the counter has
  // advanced past their own snapshot (same pattern as useExport).
  const generationRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);

  const startTranscription = useCallback(
    async (
      audioAsset: Asset,
      durationSecs: number,
      segments: VideoSegment[],
      project: Project,
      onSegmentsUpdated: (segments: VideoSegment[]) => void,
      onProjectUpdated: (updater: (p: Project) => Project) => void,
    ) => {
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

      // Hybrid skip-guard: if every segment already has an anchor and the audio
      // hasn't changed, anchors from the previous sync are authoritative. The
      // applyAnchorBasedTiming pass in App.tsx has already produced correct
      // startTime/duration values; running Whisper now would only overwrite them
      // with a fresh full-audio alignment (which is the reported bug).
      //
      // This guard intentionally does NOT trigger on the audio-change path —
      // that case falls through to the full Whisper run below, which is correct.
      const allWhisperAnchored = segments.length > 0
        && segments.every(s => s.anchorSource === 'whisper');
      const audioUnchanged = project.lastTranscribedAssetId === audioAsset.id
        && Array.isArray(project.transcriptTokens)
        && project.transcriptTokens.length > 0;

      if (allWhisperAnchored && audioUnchanged) {
        console.log('[whisper] Skipping — all segments have Whisper anchors, audio unchanged');
        return;
      }

      // Option A: skip Whisper if audio hasn't changed
      const alreadyTranscribed =
        project.lastTranscribedAssetId === audioAsset.id &&
        project.transcriptTokens &&
        project.transcriptTokens.length > 0;

      if (alreadyTranscribed) {
        const tokens = project.transcriptTokens!;
        const finalSegments = await alignSegmentsFromCachedTranscript(audioAsset, segments, tokens, durationSecs);
        if (!segmentSetStillValid(finalSegments)) {
          console.warn('[whisper] Discarding Option A alignment — segment set no longer matches');
          return;
        }
        onSegmentsUpdated(finalSegments);
        return;
      }

      // Cancel any job already running.
      abortRef.current?.abort();

      const jobId = crypto.randomUUID();
      const generation = ++generationRef.current;
      const controller = new AbortController();
      abortRef.current = controller;

      setTranscriptionStatus({ phase: 'transcribing', percent: 0, jobId });

      try {
        const tokens = await transcribeWithProgress(
          audioAsset,
          durationSecs,
          (percent) => {
            if (generationRef.current !== generation) return;
            setTranscriptionStatus({ phase: 'transcribing', percent, jobId });
          },
          controller.signal,
        );

        if (generationRef.current !== generation) return;

        const silences = await fetchAndDetectSilences(audioAsset);
        if (generationRef.current !== generation) return;

        const alignments = alignScenestoTranscript(segments, tokens, silences);
        const updated = distributeSegmentTimes(segments, alignments, durationSecs);
        const finalSegments = applyHeadingTiming(updated);

        // Store transcript tokens before the segment gate — the transcript is valid
        // for this audio even if alignment is rejected due to a scene structure change.
        // Preserving tokens here enables Option A caching on the next re-sync.
        onProjectUpdated(p => ({
          ...p,
          lastTranscribedAssetId: audioAsset.id,
          transcriptTokens: tokens,
        }));

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
        if (generationRef.current !== generation) return;
        if (err instanceof DOMException && err.name === 'AbortError') {
          setTranscriptionStatus({ phase: 'idle' });
          return;
        }
        const message = err instanceof Error ? err.message : String(err);
        setTranscriptionStatus({ phase: 'error', message, jobId });
      }
    },
    [],
  );

  const cancelTranscription = useCallback(() => {
    abortRef.current?.abort();
    generationRef.current++;
    setTranscriptionStatus({ phase: 'idle' });
  }, []);

  const dismissError = useCallback(() => {
    setTranscriptionStatus({ phase: 'idle' });
  }, []);

  return { transcriptionStatus, startTranscription, cancelTranscription, dismissError, alignFromCache: alignSegmentsFromCachedTranscript };
}
