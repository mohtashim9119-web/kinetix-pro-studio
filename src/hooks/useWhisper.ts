import { useCallback, useRef, useState } from 'react';
import {
  transcribeWithProgress,
  alignScenestoTranscript,
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
      // Option A: skip Whisper if audio hasn't changed
      const alreadyTranscribed =
        project.lastTranscribedAssetId === audioAsset.id &&
        project.transcriptTokens &&
        project.transcriptTokens.length > 0;

      if (alreadyTranscribed) {
        const tokens = project.transcriptTokens!;
        const silences = await fetchAndDetectSilences(audioAsset);
        const alignments = alignScenestoTranscript(segments, tokens, silences);
        const updated = distributeSegmentTimes(segments, alignments, durationSecs);
        onSegmentsUpdated(applyHeadingTiming(updated));
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
        onSegmentsUpdated(applyHeadingTiming(updated));

        onProjectUpdated(p => ({
          ...p,
          lastTranscribedAssetId: audioAsset.id,
          transcriptTokens: tokens,
        }));

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
