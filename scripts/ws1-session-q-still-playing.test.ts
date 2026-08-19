/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// ---------------------------------------------------------------------------
// WS1 Session Q — STEP 6. THE STILL-PLAYING DETECTOR'S RECALL AND MARGINS.
//
// `validateBoundaryQuality` (`syncContracts.ts`, Contract 5→6, rule
// `loud-fallback-boundary`) is the shipped "this cut landed on audio that's
// still playing" warning. The live run reported it catching 2 of the 5 Class B
// boundaries. Two questions have never been measured:
//
//   1. Are the 3 misses THRESHOLD misses or STRUCTURAL ones? The checker only
//      ever examines FALLBACK boundaries — pairs for which
//      `boundaryUsedFallback` says no detected silence was assignable at all.
//      A Class B boundary that DID snap to a silence is invisible to it at any
//      threshold, and no retune can recover it.
//   2. For any miss that IS examined, what is the margin on each of the three
//      conjuncts (`BOUNDARY_QUALITY_ABSOLUTE_AMPLITUDE_FLOOR`,
//      `BOUNDARY_QUALITY_MIN_DISTANCE_SEC`, `BOUNDARY_QUALITY_LOUDNESS_RATIO_K`)?
//
// The waveform is built by the REAL `buildWaveformSource` from the replay
// bundle's own `audio_16k.wav`. MEASURED CAVEAT, stated rather than glossed:
// the app decodes the user's original file at its native rate; this decodes
// the 16 kHz mono capture of the same audio. `buildWaveformSource` normalizes
// by global peak and reduces at 100 columns/second, so the two agree to
// resampling error, not bit-exactly.
// ---------------------------------------------------------------------------

import { describe, it, expect } from 'vitest';
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { resolve } from 'path';
import { buildWaveformSource } from '../src/services/waveformPeaks';
import { computeBoundarySearchWindow, boundaryUsedFallback } from '../src/services/snapBoundaries';
import { findQuietestRegion } from '../src/services/boundaryQuality';
import { validateBoundaryQuality } from '../src/services/syncContracts';
import {
  alignScenestoTranscript, distributeSegmentTimes, filterMalformedTokens,
} from '../src/services/whisperService';
import {
  BOUNDARY_QUALITY_LOUDNESS_RATIO_K, BOUNDARY_QUALITY_SUSTAINED_WINDOW_SEC,
  BOUNDARY_QUALITY_ABSOLUTE_AMPLITUDE_FLOOR, BOUNDARY_QUALITY_MIN_DISTANCE_SEC,
} from '../src/services/syncConstants';
import { applyAnchorBasedTiming } from '../src/services/syncEngine';
import { CORPORA, OUT_ROOT, REPLAY_ROOT, runProductionPath, tagOf } from './ws1-session-p-pipeline.js';

const MEASURE = process.env.WS1_SESSION_Q_MEASURE === '1';

/** Class B, from Session P's ear pass: committed (early) -> ear-correct. */
const CLASS_B = [
  { committed: 167.03, ear: 167.70 },
  { committed: 494.43, ear: 494.75 },
  { committed: 856.09, ear: 856.52 },
  { committed: 1266.21, ear: 1266.66 },
  { committed: 1273.14, ear: 1273.55 },
];

/** Minimal 16-bit PCM WAV reader — enough for the mono 16 kHz replay capture.
 *  Walks the RIFF chunk list rather than assuming a 44-byte header. */
function readWavMono16(path: string): { pcm: Float32Array; sampleRate: number; duration: number } {
  const buf = readFileSync(path);
  if (buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WAVE') {
    throw new Error(`not a RIFF/WAVE file: ${path}`);
  }
  let off = 12;
  let sampleRate = 0; let channels = 1; let bits = 16;
  let dataOff = -1; let dataLen = 0;
  while (off + 8 <= buf.length) {
    const id = buf.toString('ascii', off, off + 4);
    const size = buf.readUInt32LE(off + 4);
    const body = off + 8;
    if (id === 'fmt ') {
      channels = buf.readUInt16LE(body + 2);
      sampleRate = buf.readUInt32LE(body + 4);
      bits = buf.readUInt16LE(body + 14);
    } else if (id === 'data') { dataOff = body; dataLen = size; }
    off = body + size + (size % 2);
  }
  if (dataOff < 0 || bits !== 16) throw new Error(`unsupported wav (bits=${bits}) in ${path}`);
  const frames = Math.floor(dataLen / (2 * channels));
  const pcm = new Float32Array(frames);
  for (let i = 0; i < frames; i++) pcm[i] = buf.readInt16LE(dataOff + i * 2 * channels) / 32768;
  return { pcm, sampleRate, duration: frames / sampleRate };
}

describe.skipIf(!MEASURE)('WS1 Session Q — still-playing detector recall and margins (Step 6)', () => {
  it('reports which Class B rows the checker can even see, and the margin on each miss', async () => {
    const spec = CORPORA.v6!;
    const r = await runProductionPath(spec);
    mkdirSync(OUT_ROOT, { recursive: true });

    const wav = readWavMono16(resolve(REPLAY_ROOT, spec.key, 'audio_16k.wav'));
    const waveform = buildWaveformSource(wav.pcm, wav.sampleRate, wav.duration);

    // The checker is a Contract 5→6 pass: it runs on the COMMITTED segments
    // with the alignments and tokens `snapCoveredBoundaries` itself saw, which
    // on the FA branch are the FILTERED FA tokens (see ws1-session-p-pipeline).
    const usable = r.usableFaTokens;
    const alignedSegments = applyAnchorBasedTiming(
      distributeSegmentTimes(
        r.anchorTimed,
        alignScenestoTranscript(r.anchorTimed, usable, r.silences, spec.audioDuration),
        'forced-alignment',
      ),
      spec.audioDuration,
    );
    const alignments = alignScenestoTranscript(alignedSegments, usable, r.silences, spec.audioDuration);

    const all = validateBoundaryQuality(
      r.committed, alignments, usable, r.silences, waveform,
      BOUNDARY_QUALITY_LOUDNESS_RATIO_K, BOUNDARY_QUALITY_SUSTAINED_WINDOW_SEC, 'report-all',
    );
    const violations = validateBoundaryQuality(
      r.committed, alignments, usable, r.silences, waveform,
      BOUNDARY_QUALITY_LOUDNESS_RATIO_K, BOUNDARY_QUALITY_SUSTAINED_WINDOW_SEC,
    );

    // Per Class B row: is its pair EXAMINED at all (fallback), and if so what
    // are the three conjunct margins?
    const rows = CLASS_B.map(cb => {
      let bi = -1; let best = Infinity;
      for (let i = 1; i < r.committed.length; i++) {
        const d = Math.abs(r.committed[i]!.startTime - cb.committed);
        if (d < best) { best = d; bi = i; }
      }
      const pairIndex = bi - 1; // validateBoundaryQuality indexes by the LEFT segment
      const m = all.find(x => x.segmentIndex === pairIndex);
      const currAlign = alignments[pairIndex];
      const nextAlign = alignments[pairIndex + 1];

      let examined = false; let windowInfo: unknown = null; let conjuncts: unknown = null;
      if (currAlign && nextAlign &&
          currAlign.firstTokenIdx >= 0 && currAlign.lastTokenIdx >= 0 &&
          nextAlign.firstTokenIdx >= 0 && nextAlign.lastTokenIdx >= 0) {
        const w = computeBoundarySearchWindow(
          usable[currAlign.lastTokenIdx]!.endSec, usable[nextAlign.firstTokenIdx]!.startSec,
          usable[currAlign.firstTokenIdx]!.startSec, usable[nextAlign.lastTokenIdx]!.endSec,
        );
        examined = boundaryUsedFallback(
          usable, r.silences, w,
          currAlign.firstTokenIdx, currAlign.lastTokenIdx,
          nextAlign.firstTokenIdx, nextAlign.lastTokenIdx,
        );
        windowInfo = { searchStart: w.searchStart, searchEnd: w.searchEnd, spokenGapWidth: w.spokenGapWidth };
        const t = r.committed[bi]!.startTime;
        const col = Math.max(0, Math.min(waveform.peaks.length - 1, Math.round(t * waveform.peaksPerSecond)));
        const amp = waveform.peaks[col] ?? 0;
        const quiet = findQuietestRegion(
          waveform.peaks, waveform.peaksPerSecond, w.searchStart, w.searchEnd,
          BOUNDARY_QUALITY_SUSTAINED_WINDOW_SEC,
        );
        const dist = quiet.found && quiet.time !== undefined ? Math.abs(t - quiet.time) : undefined;
        conjuncts = {
          boundaryAmplitude: amp,
          floorMargin: amp - BOUNDARY_QUALITY_ABSOLUTE_AMPLITUDE_FLOOR,
          floorPasses: amp >= BOUNDARY_QUALITY_ABSOLUTE_AMPLITUDE_FLOOR,
          quietestTime: quiet.time ?? null,
          quietestAmplitude: quiet.meanAmplitude ?? null,
          distanceSec: dist ?? null,
          distanceMargin: dist === undefined ? null : dist - BOUNDARY_QUALITY_MIN_DISTANCE_SEC,
          distancePasses: dist !== undefined && dist >= BOUNDARY_QUALITY_MIN_DISTANCE_SEC,
          ratio: quiet.meanAmplitude ? amp / quiet.meanAmplitude : null,
          ratioMargin: quiet.meanAmplitude ? amp / quiet.meanAmplitude - BOUNDARY_QUALITY_LOUDNESS_RATIO_K : null,
          ratioPasses: !!quiet.meanAmplitude && amp > BOUNDARY_QUALITY_LOUDNESS_RATIO_K * quiet.meanAmplitude,
        };
      }

      return {
        classBCommitted: cb.committed, classBEar: cb.ear,
        matchedSegmentIndex: bi, matchedTag: tagOf(r.committed[bi]!),
        matchedCommitted: r.committed[bi]!.startTime, matchResidual: best,
        pairIndex, examinedAsFallback: examined,
        reportedByChecker: !!m, flaggedByChecker: m?.flagged ?? false,
        window: windowInfo, conjuncts,
      };
    });

    const out = {
      runId: r.runId,
      constants: {
        k: BOUNDARY_QUALITY_LOUDNESS_RATIO_K,
        sustainedWindowSec: BOUNDARY_QUALITY_SUSTAINED_WINDOW_SEC,
        amplitudeFloor: BOUNDARY_QUALITY_ABSOLUTE_AMPLITUDE_FLOOR,
        minDistanceSec: BOUNDARY_QUALITY_MIN_DISTANCE_SEC,
      },
      waveform: { sampleRate: wav.sampleRate, duration: wav.duration, columns: waveform.peaks.length },
      fallbackPairsExamined: all.length,
      totalFlagged: violations.length,
      classB: rows,
      recall: `${rows.filter(x => x.flaggedByChecker).length}/${rows.length}`,
      structurallyInvisible: rows.filter(x => !x.examinedAsFallback).length,
    };
    writeFileSync(resolve(OUT_ROOT, 'stepQ6-still-playing.json'), JSON.stringify(out, null, 2));
    // eslint-disable-next-line no-console
    console.log('[STEP Q6]', JSON.stringify(out, null, 2));

    expect(rows.length).toBe(5);
  }, 900_000);
});
