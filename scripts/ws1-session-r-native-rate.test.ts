/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// ---------------------------------------------------------------------------
// WS1 Session R — STEP 5. IS THE STILL-PLAYING CHECKER'S AMPLITUDE FLOOR A
// SAMPLE-RATE ARTEFACT? RE-DERIVED ON NATIVE-RATE AUDIO, WITH A CONTROL ARM.
//
// THE CLAIM UNDER TEST (WS1 Session Q, §11 step 6). All four Class B rows the
// still-playing checker misses fail ONE conjunct and one only —
// `BOUNDARY_QUALITY_ABSOLUTE_AMPLITUDE_FLOOR` (0.05) — by 0.007-0.035, while
// clearing the distance and loudness-ratio conjuncts by 34x-97x. Session Q
// measured that on the replay bundle's `audio_16k.wav`, and flagged the
// possibility that the floor was calibrated on one sample rate while the app
// runs another, without being able to test it.
//
// WHY THE RATE CAN MOVE THE NUMBER AT ALL, stated before measuring so this is
// falsifiable rather than a just-so story. `buildWaveformSource` takes a PEAK
// (max-abs) per block of `sampleRate / PEAKS_PER_SECOND` samples and then
// normalizes the whole array by the GLOBAL peak. Block size scales with the
// rate, so the same wall-clock window is always covered — that part is
// rate-invariant. What is NOT rate-invariant is the decimation filter:
// resampling 44.1kHz speech down to 16kHz low-passes it, removing the
// high-frequency transient energy (fricatives, plosive onsets) that a max-abs
// peak is most sensitive to. Quiet consonantal stretches lose proportionally
// more peak amplitude than loud vowel stretches, and both the numerator and
// the global-max denominator move. So a boundary sitting at 0.043 at 16kHz has
// no obligation to sit at 0.043 at 48kHz.
//
// WHAT THE APP ACTUALLY RUNS, measured not assumed. `waveformPipeline.ts`
// decodes via `new AudioContext()` + `decodeAudioData`, and WebAudio resamples
// to the CONTEXT's rate — the output device rate, typically 48000 on macOS —
// not to the file's own rate. The V6 source (`6.m4a`) is 44100/stereo, and the
// app reads channel 0. The real in-app condition is therefore 48kHz, the
// replay capture is 16kHz, and the file's own rate is a third value. All three
// are measured below rather than picking one and hoping.
//
// THE CONTROL ARM IS THE POINT. The floor is not a free parameter: it was
// calibrated 2026-08-02 to give 29 true positives on V6 AND **zero false
// positives on the 173-segment project** (`syncConstants.ts`'s own header).
// Any re-derivation that recovers Class B recall by lowering the floor must be
// checked against that second corpus at the same rate, or it is not a
// re-derivation, it is fitting to five rows. 173 is therefore measured on
// every arm too, and its false-positive count is reported beside V6's recall.
//
// NOTHING IS RETUNED HERE. This file measures; it changes no constant. If the
// rate does move the numbers, the retune is its own change with its own
// evidence — and if it does not, the 1/5 recall is a real property of the
// checker and not a measurement artefact, which is equally worth knowing.
// ---------------------------------------------------------------------------

import { describe, it, expect } from 'vitest';
import { execFileSync } from 'child_process';
import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { resolve } from 'path';
import { buildWaveformSource } from '../src/services/waveformPeaks';
import { validateBoundaryQuality } from '../src/services/syncContracts';
import {
  BOUNDARY_QUALITY_LOUDNESS_RATIO_K, BOUNDARY_QUALITY_SUSTAINED_WINDOW_SEC,
  BOUNDARY_QUALITY_ABSOLUTE_AMPLITUDE_FLOOR, BOUNDARY_QUALITY_MIN_DISTANCE_SEC,
} from '../src/services/syncConstants';
import { alignScenestoTranscript, distributeSegmentTimes } from '../src/services/whisperService';
import { applyAnchorBasedTiming } from '../src/services/syncEngine';
import { CORPORA, OUT_ROOT, runProductionPath, tagOf } from './ws1-session-p-pipeline.js';

const MEASURE = process.env.WS1_SESSION_R_MEASURE === '1';

/** Source audio, at its own native rate — NOT the replay bundle's 16kHz capture. */
const NATIVE_AUDIO: Record<string, string> = {
  v6: '/Users/mohtashim/Downloads/All Projects Test Data/V6 Natural Long Pause Segs/6.m4a',
  '173': '/Users/mohtashim/Downloads/All Projects Test Data/173 Segs Project/voiceover.m4a',
};

/** The five Class B rows, by committed value (Session Q step 6). */
const CLASS_B_COMMITTED: Array<{ label: string; committed: number }> = [
  { label: '056_dropping_torch', committed: 167.03 },
  { label: '167_smell_of_butchery', committed: 494.43 },
  { label: '286_fact_to_act', committed: 856.09 },
  { label: '400_endless_dark', committed: 1266.21 },
  { label: '403_vigilant_embers', committed: 1273.14 },
];

/**
 * Decode to channel-0 mono f32 PCM at `rate`, mirroring what the app's
 * `decodeAudioData` + `getChannelData(0)` produces at that context rate.
 * `pan=mono|c0=c0` takes the LEFT channel specifically rather than downmixing
 * — a downmix would average away exactly the transient energy this measurement
 * is about.
 */
function decodeAt(path: string, rate: number): Float32Array {
  const buf = execFileSync('ffmpeg', [
    '-v', 'error', '-i', path,
    '-af', `pan=mono|c0=c0,aresample=${rate}`,
    '-ar', String(rate), '-f', 'f32le', '-',
  ], { maxBuffer: 1024 * 1024 * 1024 });
  return new Float32Array(buf.buffer, buf.byteOffset, Math.floor(buf.byteLength / 4));
}

describe.skipIf(!MEASURE)('WS1 Session R — still-playing amplitude floor across sample rates (Step 5)', () => {
  it('measures V6 Class B recall and 173 false positives at 16k / 44.1k / 48k', async () => {
    mkdirSync(OUT_ROOT, { recursive: true });
    const RATES = [16000, 44100, 48000];

    const perCorpus: Record<string, unknown> = {};

    for (const key of ['v6', '173']) {
      const audioPath = NATIVE_AUDIO[key]!;
      if (!existsSync(audioPath)) { perCorpus[key] = { error: `missing source audio: ${audioPath}` }; continue; }

      const spec = CORPORA[key]!;
      const r = await runProductionPath(spec);
      const usable = r.usableFaTokens;

      // The checker's own inputs, derived exactly as the production path does.
      const alignedSegments = applyAnchorBasedTiming(
        distributeSegmentTimes(
          r.anchorTimed,
          alignScenestoTranscript(r.anchorTimed, usable, r.silences, spec.audioDuration),
          'forced-alignment',
        ),
        spec.audioDuration,
      );
      const alignments = alignScenestoTranscript(alignedSegments, usable, r.silences, spec.audioDuration);

      const arms: Record<string, unknown> = {};
      for (const rate of RATES) {
        const pcm = decodeAt(audioPath, rate);
        const duration = pcm.length / rate;
        const src = buildWaveformSource(pcm, rate, duration);

        const all = validateBoundaryQuality(
          r.committed, alignments, usable, r.silences, src,
          BOUNDARY_QUALITY_LOUDNESS_RATIO_K, BOUNDARY_QUALITY_SUSTAINED_WINDOW_SEC,
          'report-all',
        );
        const violations = validateBoundaryQuality(
          r.committed, alignments, usable, r.silences, src,
          BOUNDARY_QUALITY_LOUDNESS_RATIO_K, BOUNDARY_QUALITY_SUSTAINED_WINDOW_SEC,
          'violations',
        );

        const near = (a: number, b: number): boolean => Math.abs(a - b) <= 0.011;
        const classB = key !== 'v6' ? [] : CLASS_B_COMMITTED.map(cb => {
          const m = all.find(x => near(x.boundaryTime, cb.committed));
          const amp = m?.boundaryAmplitude;
          const quiet = m?.quietestAmplitude;
          return {
            label: cb.label, committed: cb.committed,
            found: m !== undefined,
            boundaryAmplitude: amp ?? null,
            quietestAmplitude: quiet ?? null,
            quietestTime: m?.quietestTime ?? null,
            distanceSec: m && m.quietestTime !== undefined ? Math.abs(m.boundaryTime - m.quietestTime) : null,
            ratio: amp !== undefined && quiet !== undefined && quiet > 0 ? amp / quiet : null,
            clearsAmplitudeFloor: amp !== undefined ? amp > BOUNDARY_QUALITY_ABSOLUTE_AMPLITUDE_FLOOR : null,
            amplitudeMarginToFloor: amp !== undefined ? amp - BOUNDARY_QUALITY_ABSOLUTE_AMPLITUDE_FLOOR : null,
            flagged: m?.flagged ?? false,
          };
        });

        // FLOOR SWEEP — what would it COST to lower the floor far enough to
        // reach the remaining misses? Replays the checker's own three
        // conjuncts (`syncContracts.ts`: amp >= floor && distance >=
        // MIN_DISTANCE && amp > k * quietestMean) at candidate floors, from
        // the report-all measurements. Reported for BOTH corpora so V6's
        // recall gain is always read next to 173's false-positive cost — the
        // floor's calibration property is "zero false positives on 173", and a
        // recall number without that number beside it is not a re-derivation.
        const FLOORS = [0.05, 0.045, 0.04, 0.035, 0.03, 0.028, 0.025, 0.02, 0.015];
        const wouldFire = (m: typeof all[number], floor: number): boolean =>
          m.quietestAmplitude !== undefined && m.quietestTime !== undefined &&
          m.boundaryAmplitude >= floor &&
          Math.abs(m.boundaryTime - m.quietestTime) >= BOUNDARY_QUALITY_MIN_DISTANCE_SEC &&
          m.boundaryAmplitude > BOUNDARY_QUALITY_LOUDNESS_RATIO_K * m.quietestAmplitude;
        const floorSweep = FLOORS.map(floor => ({
          floor,
          totalFiring: all.filter(m => wouldFire(m, floor)).length,
          classBFiring: key !== 'v6' ? null : CLASS_B_COMMITTED.filter(cb => {
            const m = all.find(x => Math.abs(x.boundaryTime - cb.committed) <= 0.011);
            return m !== undefined && wouldFire(m, floor);
          }).length,
        }));

        // WHICH CONJUNCT ACTUALLY BINDS. A control corpus that reports zero
        // false positives at every floor is not evidence ABOUT the floor — it
        // may simply be failing a different conjunct throughout, in which case
        // it cannot validate a floor change at all. This breakdown is what
        // distinguishes "the floor is safe to lower" from "this corpus was
        // never going to fire either way."
        const conjuncts = {
          pairs: all.length,
          passDistance: all.filter(m => m.quietestTime !== undefined &&
            Math.abs(m.boundaryTime - m.quietestTime) >= BOUNDARY_QUALITY_MIN_DISTANCE_SEC).length,
          passRatio: all.filter(m => m.quietestAmplitude !== undefined &&
            m.boundaryAmplitude > BOUNDARY_QUALITY_LOUDNESS_RATIO_K * m.quietestAmplitude).length,
          passFloorAt050: all.filter(m => m.boundaryAmplitude >= 0.05).length,
          passFloorAt025: all.filter(m => m.boundaryAmplitude >= 0.025).length,
          passDistanceAndRatio: all.filter(m => m.quietestTime !== undefined && m.quietestAmplitude !== undefined &&
            Math.abs(m.boundaryTime - m.quietestTime) >= BOUNDARY_QUALITY_MIN_DISTANCE_SEC &&
            m.boundaryAmplitude > BOUNDARY_QUALITY_LOUDNESS_RATIO_K * m.quietestAmplitude).length,
          amplitudeMax: all.reduce((m, x) => Math.max(m, x.boundaryAmplitude), 0),
        };

        arms[String(rate)] = {
          conjuncts,
          sampleRate: rate, pcmSamples: pcm.length, decodedDuration: duration,
          fallbackBoundariesExamined: all.length,
          violationCount: violations.length,
          flaggedCount: all.filter(x => x.flagged).length,
          classB,
          classBClearingFloor: classB.filter(x => x.clearsAmplitudeFloor === true).length,
          classBFlagged: classB.filter(x => x.flagged).length,
          floorSweep,
        };
      }

      perCorpus[key] = { corpus: key, audioPath, runId: r.runId, arms };
    }

    const out = {
      floor: BOUNDARY_QUALITY_ABSOLUTE_AMPLITUDE_FLOOR,
      ratioK: BOUNDARY_QUALITY_LOUDNESS_RATIO_K,
      sustainedWindowSec: BOUNDARY_QUALITY_SUSTAINED_WINDOW_SEC,
      note: 'v6 = recall arm (5 Class B rows). 173 = CONTROL arm (floor was calibrated for ZERO false positives here).',
      perCorpus,
    };

    writeFileSync(resolve(OUT_ROOT, 'stepR5-native-rate.json'), JSON.stringify(out, null, 2));
    // eslint-disable-next-line no-console
    console.log('[STEP R5]', JSON.stringify(out, null, 2));

    expect(Object.keys(perCorpus).length).toBe(2);
  }, 1_800_000);
});
