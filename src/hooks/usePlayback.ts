/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect, useRef, type RefObject } from 'react';
import type { Asset, VideoSegment } from '../types';

interface UsePlaybackParams {
  isPlaying: boolean;
  setIsPlaying: (v: boolean | ((p: boolean) => boolean)) => void;
  setCurrentTime: (v: number | ((p: number) => number)) => void;
  audioRef: RefObject<HTMLAudioElement | null>;
  segments: VideoSegment[];
  voiceover: Asset | undefined;
  globalPlaybackSpeed: number;
  isExporting: boolean;
}

/**
 * Encapsulates the three playback effects extracted from App.tsx:
 *   1. Audio pause when isPlaying goes false
 *   2. rAF loop — voiceover path (audio master clock, ~16 ms ticks)
 *   3. setInterval — no-voiceover path (manual advance at 100 ms)
 *   4. playbackRate sync
 */
export function usePlayback({
  isPlaying,
  setIsPlaying,
  setCurrentTime,
  audioRef,
  segments,
  voiceover,
  globalPlaybackSpeed,
  isExporting,
}: UsePlaybackParams): void {
  const rafRef = useRef<number | null>(null);
  const segmentsRef = useRef<VideoSegment[]>(segments);

  // Keep segmentsRef current so the setInterval closure always reads the latest
  // durations without segments appearing in the interval's dependency array.
  // Intentionally no dependency array — must run after every render.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    segmentsRef.current = segments;
  });

  // --- Playback: audio pause on user stop ---
  useEffect(() => {
    if (!isPlaying && !isExporting) {
      audioRef.current?.pause();
    }
  }, [isPlaying, isExporting, audioRef]);

  // --- Playback: rAF loop — voiceover path (audio element is master clock) ---
  // Reads audioRef.current.currentTime on every animation frame (~16 ms at 60 fps).
  // All values inside tick are read via stable refs or setters — no stale closure risk.
  useEffect(() => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }

    if (!isPlaying || !voiceover) return;

    const tick = () => {
      const audio = audioRef.current;
      if (!audio) return;

      setCurrentTime(audio.currentTime);

      // Defensive resume: if audio stalled mid-playback for any reason, restart it.
      // Guard with !audio.ended so a naturally-finished audio is not restarted here.
      if (audio.paused && !audio.ended) {
        audio.play().catch(() => {});
      }

      // End-of-audio detection via native HTMLMediaElement.ended flag.
      if (audio.ended) {
        setIsPlaying(false);
        audio.currentTime = 0;
        setCurrentTime(0);
        return; // do not schedule next frame
      }

      rafRef.current = requestAnimationFrame(tick);
    };

    rafRef.current = requestAnimationFrame(tick);

    return () => {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
  }, [isPlaying, voiceover]); // eslint-disable-line react-hooks/exhaustive-deps

  // --- Playback: setInterval manual-advance — no-voiceover path ---
  // Only runs when isPlaying is true and no voiceover asset is loaded.
  // (Decision 1 / Batch C: keep no-voiceover path as a separate setInterval, unchanged.)
  useEffect(() => {
    if (!isPlaying || voiceover) return;

    const interval = setInterval(() => {
      const segDur = segmentsRef.current.reduce((acc, s) => acc + s.duration, 0);
      const maxDuration = (!segDur || isNaN(segDur) || !isFinite(segDur)) ? 10 : segDur;
      setCurrentTime(prev => {
        const next = prev + 0.1 * globalPlaybackSpeed;
        if (next >= maxDuration) {
          setIsPlaying(false);
          return 0;
        }
        return next;
      });
    }, 100);

    return () => clearInterval(interval);
  }, [isPlaying, voiceover, globalPlaybackSpeed]); // eslint-disable-line react-hooks/exhaustive-deps

  // --- Playback: playbackRate sync ---
  // Separate effect so neither loop gains globalPlaybackSpeed as a dep.
  // Fires on play-start and whenever the user adjusts speed mid-playback.
  useEffect(() => {
    if (audioRef.current) {
      audioRef.current.playbackRate = globalPlaybackSpeed;
    }
  }, [isPlaying, globalPlaybackSpeed, audioRef]);
}
