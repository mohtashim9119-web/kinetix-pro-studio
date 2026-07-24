/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect, useRef, type RefObject } from 'react';
import type { Asset, VideoSegment } from '../types';

// Smaller than one frame at 60 fps (~16.7 ms) — large enough that ordinary
// float-precision jitter in repeated `audio.currentTime` reads can't trip it,
// small enough that a real seek/advance always clears it (QB2 fix).
export const CURRENT_TIME_EPSILON_SEC = 0.01;

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
  // Last value this hook actually committed via setCurrentTime — lets tick()
  // skip redundant/near-identical updates instead of setting state every
  // frame regardless of whether the audio position meaningfully moved (QB2).
  const currentTimeRef = useRef(0);
  // Derived boolean instead of depending on the `voiceover` object's identity
  // directly — the rAF effect below only ever checks voiceover's truthiness,
  // never its fields, so a same-presence-different-identity object (e.g. the
  // assets array being rebuilt during Apply Sync) shouldn't restart the loop.
  const hasVoiceover = !!voiceover;

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

    if (!isPlaying || !hasVoiceover) return;

    const tick = () => {
      const audio = audioRef.current;
      if (!audio) return;

      // Delta guard (QB2 fix): only push a new currentTime when it actually
      // moved meaningfully. Without this, every tick calls setCurrentTime
      // unconditionally, and if anything else (e.g. an unrelated commit like
      // Apply Sync landing new segments) causes this effect to re-run while
      // the audio position hasn't really advanced, the resulting state-update
      // stream can compound with downstream currentTime consumers and blow
      // React's nested-update budget ("Maximum update depth exceeded").
      if (Math.abs(audio.currentTime - currentTimeRef.current) > CURRENT_TIME_EPSILON_SEC) {
        currentTimeRef.current = audio.currentTime;
        setCurrentTime(audio.currentTime);
      }

      // Defensive resume: if audio stalled mid-playback for any reason, restart it.
      // Guard with !audio.ended so a naturally-finished audio is not restarted here.
      if (audio.paused && !audio.ended) {
        audio.play().catch(() => {});
      }

      const segDur = segmentsRef.current.reduce((a, s) => a + s.duration, 0);
      if (segDur > 0 && audio.currentTime >= segDur) {
        setIsPlaying(false);
        audio.currentTime = 0;
        currentTimeRef.current = 0;
        setCurrentTime(0);
        return;
      }

      // End-of-audio detection via native HTMLMediaElement.ended flag.
      if (audio.ended) {
        setIsPlaying(false);
        audio.currentTime = 0;
        currentTimeRef.current = 0;
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
  }, [isPlaying, hasVoiceover]); // eslint-disable-line react-hooks/exhaustive-deps

  // --- Playback: setInterval manual-advance — no-voiceover path ---
  // Only runs when isPlaying is true and no voiceover asset is loaded.
  // (Decision 1 / Batch C: keep no-voiceover path as a separate setInterval, unchanged.)
  useEffect(() => {
    if (!isPlaying || hasVoiceover) return;

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
  }, [isPlaying, hasVoiceover, globalPlaybackSpeed]); // eslint-disable-line react-hooks/exhaustive-deps

  // --- Playback: playbackRate sync ---
  // Separate effect so neither loop gains globalPlaybackSpeed as a dep.
  // Fires on play-start and whenever the user adjusts speed mid-playback.
  useEffect(() => {
    if (audioRef.current) {
      audioRef.current.playbackRate = globalPlaybackSpeed;
    }
  }, [isPlaying, globalPlaybackSpeed, audioRef]);
}
