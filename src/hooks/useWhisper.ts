import { useCallback, useRef, useState } from 'react';
import {
  transcribeWithProgress,
  alignScenestoTranscript,
  distributeSegmentTimes,
} from '../services/whisperService';
import type { TranscriptionStatus, Asset, VideoSegment } from '../types';

export interface UseWhisperApi {
  transcriptionStatus: TranscriptionStatus;
  startTranscription: (
    audioAsset: Asset,
    durationSecs: number,
    segments: VideoSegment[],
    onSegmentsUpdated: (segments: VideoSegment[]) => void,
  ) => void;
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
      onSegmentsUpdated: (segments: VideoSegment[]) => void,
    ) => {
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

        const alignments = alignScenestoTranscript(segments, tokens);
        const updated = distributeSegmentTimes(segments, alignments, durationSecs);
        onSegmentsUpdated(updated);

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
