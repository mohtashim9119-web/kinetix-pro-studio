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
  const holdingRef = useRef<{ startWallClock: number; startCurrentTime: number } | null>(null);
  // Accumulated extra VIDEO seconds introduced by splitAudio headings already passed.
  // videoTime = audio.currentTime + splitAudioOffsetRef
  const splitAudioOffsetRef = useRef(0);

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

    // Reset offset + hold state when starting from the beginning.
    if ((audioRef.current?.currentTime ?? 0) < 0.01) {
      splitAudioOffsetRef.current = 0;
      holdingRef.current = null;
    }

    const tick = () => {
      const audio = audioRef.current;
      if (!audio) return;

      const audioT = audio.currentTime;
      // VIDEO time = audio time + accumulated dead time from passed splitAudio headings.
      const videoT = audioT + splitAudioOffsetRef.current;

      const segs = segmentsRef.current;
      const currentSeg = segs.find(s => videoT >= s.startTime && videoT < s.startTime + s.duration);

      // splitAudio hold mode: pause audio, advance video by wall clock.
      if (currentSeg?.isHeading && currentSeg.headingConfig?.splitAudio) {
        if (!holdingRef.current) {
          audio.pause();
          holdingRef.current = { startWallClock: Date.now(), startCurrentTime: videoT };
        }
        const elapsed = (Date.now() - holdingRef.current.startWallClock) / 1000;
        const newVideoT = holdingRef.current.startCurrentTime + elapsed;

        if (newVideoT >= currentSeg.startTime + currentSeg.duration) {
          // Exit hold: accumulate the heading's duration into the offset and resume.
          splitAudioOffsetRef.current += currentSeg.duration;
          holdingRef.current = null;
          audio.play().catch(() => {});
          setCurrentTime(currentSeg.startTime + currentSeg.duration);
        } else {
          setCurrentTime(newVideoT);
        }
        rafRef.current = requestAnimationFrame(tick);
        return;
      }

      // Normal path: video time tracks audio + accumulated offset.
      if (holdingRef.current) {
        holdingRef.current = null;
        audio.play().catch(() => {});
      }
      setCurrentTime(videoT);

      // Defensive resume: if audio stalled mid-playback for any reason, restart it.
      // Guard with !audio.ended so a naturally-finished audio is not restarted here.
      if (audio.paused && !audio.ended) {
        audio.play().catch(() => {});
      }

      // End-of-audio detection via native HTMLMediaElement.ended flag.
      if (audio.ended) {
        setIsPlaying(false);
        audio.currentTime = 0;
        splitAudioOffsetRef.current = 0;
        holdingRef.current = null;
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
