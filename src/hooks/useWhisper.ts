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
import type { TranscriptionStatus, Asset, VideoSegment, Project } from '../types';

async function fetchAndDetectSilences(asset: Asset): Promise<SilenceInterval[]> {
  try {
    const resp = await fetch(asset.url);
    const blob = await resp.blob();
    return await detectSilences(blob);
  } catch {
    return [];
  }
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

      console.log('[DEL-DIAG] useWhisper skip-guard', {
        allWhisperAnchored,
        audioUnchanged,
        willSkip: allWhisperAnchored && audioUnchanged,
      });

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
        const silences = await fetchAndDetectSilences(audioAsset);
        const hasAnyWhisperAnchor = segments.some(s => s.anchorSource === 'whisper');
        const alignments = hasAnyWhisperAnchor
          ? alignScenesToTranscriptAnchorAware(segments, tokens, silences, durationSecs)
          : alignScenestoTranscript(segments, tokens, silences);
        const updated = distributeSegmentTimes(segments, alignments, durationSecs);
        const finalSegments = applyHeadingTiming(updated);
        console.log('[DEL-DIAG] useWhisper Option A result', {
          hasAnyWhisperAnchor,
          segments: finalSegments.map(s => ({
            id: s.id, duration: s.duration, anchorStart: s.anchorStart, anchorSource: s.anchorSource, isHeading: s.isHeading,
          })),
        });
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

  return { transcriptionStatus, startTranscription, cancelTranscription, dismissError };
}
