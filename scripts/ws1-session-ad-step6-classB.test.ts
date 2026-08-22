/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// ---------------------------------------------------------------------------
// WS1 Session AD — Step 6. CLASS B: DOES A SINGLE RE-DERIVED AMPLITUDE FLOOR
// CATCH ALL FIVE ROWS WITH ZERO FALSE POSITIVES, ACROSS ALL THREE CORPORA?
//
// Session AB (Part W(h)) measured all five Class B rows' amplitude deficits
// below `BOUNDARY_QUALITY_ABSOLUTE_AMPLITUDE_FLOOR` (0.05) but did not touch
// the checker. Session AD Step 0's ear pass reconfirms the same five targets
// unchanged (`scripts/ws1-ear-pass-ledger.ts`, sitting `ear-verify-ad`) — the
// deficits below are therefore evidence-backed, not merely measured against
// an unverified target.
//
// THE NAMED TRAP (stated in the session brief, checked directly rather than
// assumed): `167_smell_of_butchery` ALREADY clears the current 0.05 floor
// (amplitude 0.256) and is ALREADY flagged by the shipped checker — yet it
// remains an open, uncorrected register row. So "the floor catches it" and
// "the row is fixed" are different claims; lowering the floor can only ever
// change DETECTION (whether the checker flags a boundary as suspicious), and
// this file measures detection only, exactly like `ws1-session-q-still-
// playing.test.ts` (Session Q, Step 6) it extends.
//
// METHODOLOGY, extending Session Q's still-playing recall measurement AND
// correcting it per Session R's own finding (Part P(e)): the replay bundle's
// `audio_16k.wav` is a MEASURED SAMPLE-RATE ARTEFACT — decimation to 16kHz
// removes high-frequency transient energy a max-abs peak is most sensitive
// to, so a boundary's amplitude at 16kHz has no obligation to match its
// amplitude at the app's real native decode rate (48000 on macOS, via
// `AudioContext`/`decodeAudioData` — measured, not assumed, `ws1-session-r-
// native-rate.test.ts`'s own header). This file decodes NATIVE-RATE audio
// via `ffmpeg`, the same way that script does, rather than reading the
// replay bundle's 16kHz capture Session AB's Class A search used.
//
//  1. Decode each corpus's own source audio (not the replay capture) to
//     48000 Hz mono, channel 0 — mirroring `waveformPipeline.ts`'s real
//     in-app decode path.
//  2. Run the real production path (`runProductionPath`) for v6, 173 AND
//     spanish (Session R's own native-rate script covered v6+173 only).
//  3. Call `validateBoundaryQuality(..., 'report-all')` per corpus — this
//     already computes each fallback pair's REAL boundaryAmplitude,
//     quietestAmplitude/Time and the CURRENT (0.05-floor) `flagged` value,
//     now on native-rate PCM.
//  4. Locate the 5 Class B rows among v6's fallback pairs; the candidate new
//     floor is the minimum of their currently-failing amplitudes AT NATIVE
//     RATE (167 and, at native rate, 403 already clear 0.05 — Session R's
//     own finding, reproduced here — so neither constrains the new floor).
//  5. Recompute `flagged` under the candidate floor for EVERY fallback pair
//     in EVERY corpus (not just the 5 defects) using the checker's own
//     three-conjunct formula (`syncContracts.ts`), and count how many
//     newly pass that did not pass under the shipped 0.05 floor — these are
//     the false-positive risk the shipped floor was calibrated to avoid
//     (Session Q, Part O(g): "the floor is calibrated against two OTHER
//     projects' false-positive rates"; Session R Part P(e): 173 never binds
//     on the loudness-RATIO conjunct at ANY floor, so its own zero-firing
//     count is NOT EXERCISED evidence, not a clean pass — reproduced below).
//
// Reports TWO false-positive counts, deliberately not conflated:
//   (a) against every fallback pair examined, labeled or not — the honest,
//       maximal count (an unlabeled pair that newly passes is UNVERIFIED
//       risk, not an asserted defect or an asserted false positive);
//   (b) against the subset that also carry an EAR-CONFIRMED-CORRECT ledger
//       entry (`ws1-ear-pass-ledger.ts`) — a strong claim (a genuinely
//       healthy boundary the new floor would wrongly flag), reported
//       separately because it is the narrower, precedent-consistent measure
//       Session AB's own Class A control population used.
// ---------------------------------------------------------------------------

import { describe, it, expect } from 'vitest';
import { execFileSync } from 'child_process';
import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { resolve } from 'path';
import { buildWaveformSource } from '../src/services/waveformPeaks';
import { validateBoundaryQuality, type BoundaryQualityMeasurement } from '../src/services/syncContracts';
import { alignScenestoTranscript, distributeSegmentTimes } from '../src/services/whisperService';
import {
  BOUNDARY_QUALITY_LOUDNESS_RATIO_K, BOUNDARY_QUALITY_SUSTAINED_WINDOW_SEC,
  BOUNDARY_QUALITY_MIN_DISTANCE_SEC,
} from '../src/services/syncConstants';
import { applyAnchorBasedTiming } from '../src/services/syncEngine';
import { CORPORA, REPO, runProductionPath, tagOf } from './ws1-session-p-pipeline.js';
import { earPassAuthorising, type Corpus as LedgerCorpus } from './ws1-ear-pass-ledger.js';

const MEASURE = process.env.WS1_SESSION_AD_MEASURE === '1';
const OUT_AD = resolve(REPO, '.work-phase4', 'session-ad');
const NATIVE_RATE = 48000;

/** Source audio at its OWN native rate — NOT the replay bundle's 16kHz
 *  capture. Same three files `ws1-session-r-native-rate.test.ts` (v6, 173)
 *  and the ear-list docs (spanish) already name. */
const NATIVE_AUDIO: Record<string, string> = {
  v6: '/Users/mohtashim/Downloads/All Projects Test Data/V6 Natural Long Pause Segs/6.m4a',
  '173': '/Users/mohtashim/Downloads/All Projects Test Data/173 Segs Project/voiceover.m4a',
  spanish: '/Users/mohtashim/Downloads/All Projects Test Data/Spanish Project/Spanish VOiceover.m4a',
};

/** Decode to channel-0 mono f32 PCM at `rate`, mirroring `ws1-session-r-
 *  native-rate.test.ts`'s own `decodeAt` (which mirrors the app's real
 *  `decodeAudioData` + `getChannelData(0)` at the context rate). */
function decodeAt(path: string, rate: number): Float32Array {
  const buf = execFileSync('ffmpeg', [
    '-v', 'error', '-i', path,
    '-af', `pan=mono|c0=c0,aresample=${rate}`,
    '-ar', String(rate), '-f', 'f32le', '-',
  ], { maxBuffer: 1024 * 1024 * 1024 });
  return new Float32Array(buf.buffer, buf.byteOffset, Math.floor(buf.byteLength / 4));
}

/** Class B, from Session P's ear pass, reconfirmed unchanged by Session AD's
 *  own A/B pass (sitting `ear-verify-ad`). */
const CLASS_B = [
  { tag: '056_dropping_torch', committed: 167.03, ear: 167.70 },
  { tag: '167_smell_of_butchery', committed: 494.43, ear: 494.75 },
  { tag: '286_fact_to_act', committed: 856.09, ear: 856.52 },
  { tag: '400_endless_dark', committed: 1266.21, ear: 1266.66 },
  { tag: '403_vigilant_embers', committed: 1273.14, ear: 1273.55 },
];

/** The checker's own three-conjunct formula (`syncContracts.ts`), re-applied
 *  with a candidate floor in place of the shipped constant. Pure re-derivation
 *  from a measurement's own recorded fields — no new acoustic analysis. */
function reflag(m: BoundaryQualityMeasurement, floor: number): boolean {
  if (m.quietestAmplitude === undefined || m.quietestTime === undefined) return false;
  const distance = Math.abs(m.boundaryTime - m.quietestTime);
  return (
    m.boundaryAmplitude >= floor &&
    distance >= BOUNDARY_QUALITY_MIN_DISTANCE_SEC &&
    m.boundaryAmplitude > BOUNDARY_QUALITY_LOUDNESS_RATIO_K * m.quietestAmplitude
  );
}

describe.skipIf(!MEASURE)('WS1 Session AD — Class B floor re-derivation, cross-corpus (Step 6)', () => {
  it('measures whether one re-derived amplitude floor catches all 5 Class B rows with zero false positives', async () => {
    mkdirSync(OUT_AD, { recursive: true });

    const perCorpus: Record<string, {
      runId: string | undefined;
      all: BoundaryQualityMeasurement[];
      committed: { startTime: number }[];
      tagged: string[];
    }> = {};

    for (const key of ['v6', '173', 'spanish'] as const) {
      const spec = CORPORA[key]!;
      const audioPath = NATIVE_AUDIO[key]!;
      if (!existsSync(audioPath)) throw new Error(`missing native source audio: ${audioPath}`);
      const r = await runProductionPath(spec);
      const pcm = decodeAt(audioPath, NATIVE_RATE);
      const duration = pcm.length / NATIVE_RATE;
      const waveform = buildWaveformSource(pcm, NATIVE_RATE, duration);
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

      perCorpus[key] = {
        runId: r.runId, all,
        committed: r.committed.map(s => ({ startTime: s.startTime })),
        tagged: r.committed.map(s => tagOf(s)),
      };
    }

    // Locate the 5 Class B rows among v6's fallback-examined pairs.
    const v6 = perCorpus.v6!;
    const classBRows = CLASS_B.map(cb => {
      let bi = -1; let best = Infinity;
      for (let i = 1; i < v6.committed.length; i++) {
        const d = Math.abs(v6.committed[i]!.startTime - cb.committed);
        if (d < best) { best = d; bi = i; }
      }
      const pairIndex = bi - 1;
      const m = v6.all.find(x => x.segmentIndex === pairIndex);
      return { ...cb, pairIndex, matchedTag: v6.tagged[bi], measurement: m };
    });

    const missing = classBRows.filter(r => !r.measurement);
    if (missing.length > 0) {
      throw new Error(`Class B row(s) not found as a fallback-examined pair: ${missing.map(r => r.tag).join(', ')}`);
    }

    const amplitudes = classBRows.map(r => r.measurement!.boundaryAmplitude);
    const candidateFloor = Math.min(...amplitudes);

    const classBReport = classBRows.map(r => ({
      tag: r.tag, matchedTag: r.matchedTag, committed: r.committed,
      boundaryAmplitude: r.measurement!.boundaryAmplitude,
      oldFlagged: r.measurement!.flagged,
      newFlagged: reflag(r.measurement!, candidateFloor),
    }));

    // False-positive sweep: every OTHER fallback pair, all 3 corpora.
    const classBPairIndices = new Set(classBRows.map(r => r.pairIndex));
    let totalFallbackPairs = 0;
    const newlyFlagged: { corpus: string; segmentIndex: number; tag: string; boundaryTime: number; boundaryAmplitude: number }[] = [];

    for (const key of ['v6', '173', 'spanish'] as const) {
      const c = perCorpus[key]!;
      for (const m of c.all) {
        totalFallbackPairs++;
        if (key === 'v6' && classBPairIndices.has(m.segmentIndex)) continue; // the defects themselves
        if (!m.flagged && reflag(m, candidateFloor)) {
          newlyFlagged.push({
            corpus: key, segmentIndex: m.segmentIndex,
            tag: c.tagged[m.segmentIndex + 1] ?? '(unknown)',
            boundaryTime: m.boundaryTime, boundaryAmplitude: m.boundaryAmplitude,
          });
        }
      }
    }

    const newlyFlaggedConfirmedHealthy = newlyFlagged.filter(x =>
      earPassAuthorising(x.corpus as LedgerCorpus, x.tag, x.boundaryTime),
    );

    const out = {
      sampleRate: NATIVE_RATE,
      note: 'Decoded at native rate (48000, matching the app real AudioContext decode path), ' +
        'NOT the replay bundle 16kHz capture — Session R (Part P(e)) measured the 16kHz arm as a ' +
        'sample-rate artefact that moves amplitude values across the floor line.',
      candidateFloor,
      constants: {
        shippedFloor: 0.05,
        k: BOUNDARY_QUALITY_LOUDNESS_RATIO_K,
        minDistanceSec: BOUNDARY_QUALITY_MIN_DISTANCE_SEC,
      },
      classB: classBReport,
      recallAtCandidateFloor: `${classBReport.filter(r => r.newFlagged).length}/5`,
      totalFallbackPairsAcrossCorpora: totalFallbackPairs,
      newlyFlaggedTotal_allPairs: newlyFlagged.length,
      newlyFlaggedConfirmedHealthy_earBacked: newlyFlaggedConfirmedHealthy.length,
      newlyFlaggedRows: newlyFlagged,
      runIds: { v6: perCorpus.v6!.runId, '173': perCorpus['173']!.runId, spanish: perCorpus.spanish!.runId },
    };
    writeFileSync(resolve(OUT_AD, 'step6-classB-floor.json'), JSON.stringify(out, null, 2));
    // eslint-disable-next-line no-console
    console.log('[STEP AD-6]', JSON.stringify(out, null, 2));

    expect(classBReport.length).toBe(5);
  }, 1_800_000);
});
