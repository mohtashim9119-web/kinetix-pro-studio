/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// ---------------------------------------------------------------------------
// WS1 Session S — STEPS 2 AND 3. WHY R.12's VALUE LANDS EARLY, MEASURED.
//
// THE QUESTION, from the owner's live ear pass over all ten v6 unscripted
// runs: five of R.12's seven corrections are audibly EARLY (the cut happens
// before it should), two are correct, and one row never reaches R.12 at all
// (that is Step 1's R.11/R.12 collision, a different file).
//
// This file MEASURES and computes a candidate table. It changes no production
// code and ships no value change. Its heavy arm is env-gated
// (`WS1_SESSION_S_MEASURE=1`) because it decodes 24 minutes of 44.1 kHz audio
// through the ffmpeg sidecar — see the repo rule that generators never run in
// the default sweep. The cheap arm (structural facts about the seven rows)
// runs always.
//
// WS1 SESSION T SUPERSESSION NOTE. This file's own STEP 3 exit condition
// concluded NO CANDIDATE SHIPS — the unclamped midpoint fixed five rows but
// missed `383_sixty_four` by 0.100s. That conclusion is SUPERSEDED: Session T
// found the missing piece (the run's onset itself was a Whisper timestamp
// sitting inside the real silence, not merely clamped wrong) and the owner's
// A/B `ear-verify-t` sitting resolved the 0.100s gap at 383 the OTHER
// direction than this file's own Step-1-linked solo listen had. The two
// cheap-arm tests below are UPDATED to assert the current, positive result
// rather than left asserting a now-false negative — see each test's own
// comment. The MEASURE-gated heavy arm below is UNCHANGED and left as the
// historical record of Session S's own RMS profiling.
//
// THE RMS PROFILE'S OWN FRAME GRID IS THE DETECTOR'S. `silenceDetector.ts` is
// UNMODIFIABLE this session, and the point of the profile is to see what the
// detector saw — so the frame size (20 ms), the RMS definition
// (sqrt(mean(x^2)) over the frame), the dB conversion and the frame origin
// (frame f starts at `f * floor(0.020 * rate) / rate`) are copied from it
// exactly. A profile computed on a different grid could not be compared to the
// detector's own output at all.
//
// NATIVE RATE, NOT THE 16 kHz CAPTURE. WS1 Session R measured that 16 kHz
// decimation moves per-frame amplitude enough to cross a threshold
// (`403_vigilant_embers`, 0.0433 -> 0.0544). A breath is exactly the
// low-but-nonzero band that decimation damages most, so this profile is taken
// at the file's own 44100 Hz off channel 0, the same signal
// `scripts/ws1-native-silences.py` feeds the live-fidelity silence arm.
// ---------------------------------------------------------------------------

import { describe, it, expect } from 'vitest';
import { execFileSync } from 'child_process';
import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { resolve } from 'path';
import { CORPORA, OUT_ROOT, REPO, runProductionPath, tagOf } from './ws1-session-p-pipeline.js';
import type { ProductionRun } from './ws1-session-p-pipeline.js';
import type { SilenceInterval } from '../src/services/silenceDetector';

const MEASURE = process.env.WS1_SESSION_S_MEASURE === '1';

const V6_AUDIO = '/Users/mohtashim/Downloads/All Projects Test Data/V6 Natural Long Pause Segs/6.m4a';
const V6_NATIVE_RATE = 44100;
const FFMPEG = resolve(REPO, 'src-tauri/binaries/ffmpeg-x86_64-apple-darwin');

/** `silenceDetector.ts`'s own defaults, restated here as READ-ONLY facts about
 *  the detector this profile is trying to see through. Nothing here tunes it. */
const DETECTOR_FRAME_MS = 20;
const DETECTOR_THRESHOLD_DB = -45;

/** The run's onset AS THE WAVEFORM HAS IT: the END of the first detected
 *  silence beginning at or after the outgoing word's last frame.
 *
 *  WHY THE DETECTOR'S OWN ARRAY AND NOT A FRESH FRAME SCAN. A naive
 *  "first frame at or above -45 dBFS" answer is wrong on this corpus and
 *  measurably so — it returns 125.54 for `042_eleven_years` (a 4-frame,
 *  -41 dBFS BREATH) and 370.06 for `125_night_circle` (likewise), because a
 *  breath crosses the same threshold speech does. `detectSilences` does not
 *  have that problem: a silence only ends at a loud frame that FOLLOWED at
 *  least 0.25s of continuous sub-threshold audio, so its `endSec` is the first
 *  energy after a real pause. Reading it costs nothing, consumes the shipped
 *  array unchanged (this session may not touch `silenceDetector.ts`), and is
 *  the same quantity the app itself would have.
 *
 *  Falls back to `toSec` when no silence exists in range — reported, never
 *  guessed at. */
function waveformOnset(silences: readonly SilenceInterval[], fromSec: number, toSec: number): number {
  let best: SilenceInterval | undefined;
  for (const s of silences) {
    if (s.startSec < fromSec - 1e-9 || s.endSec > toSec + 1e-9) continue;
    if (best === undefined || s.startSec < best.startSec) best = s;
  }
  return best ? best.endSec : toSec;
}

/** Reporting floor for the band scan. Frames below this are the room's noise
 *  floor (or, on this corpus, literal all-zero samples). Used ONLY to describe
 *  the profile in this measurement — it is not a threshold anything ships. */
const REPORT_FLOOR_DB = -60;
/** A band must last at least this many frames (60 ms) to be reported. One or
 *  two isolated frames a few dB above the floor are noise, not a breath. */
const MIN_BAND_FRAMES = 3;

export interface EnergyBand { startSec: number; endSec: number; maxDb: number; frames: number; crossesDetectorThreshold: boolean }

/** Contiguous runs of frames above `cutDb` lying strictly between
 *  the outgoing word's decay and the run's waveform onset — i.e. the breaths
 *  and pre-speech noises. The FIRST such run is dropped when it begins at the
 *  window's own first frame, because that is the outgoing word still decaying,
 *  not a separate event. `crossesDetectorThreshold` records the one fact that
 *  decides how `silenceDetector.ts` treated the band: at or above -45 dBFS it
 *  BREAKS silence (the band is excluded from every detected silence); below,
 *  it is MERGED into the surrounding silence and invisible downstream.
 *
 *  TWO CUTS ARE RUN, and both are needed — measured, not defensive. A breath
 *  can sit on EITHER side of the detector's threshold, and which side it lands
 *  on decides whether the detector saw it: `042`/`125`/`307`/`340` carry
 *  breaths at -33 to -43 dBFS, which CROSS -45 and are therefore excluded from
 *  silence, while `176` carries one at -53 dBFS, which does NOT cross and is
 *  merged into silence. A single-cut scan finds one family and misses the
 *  other, and either miss would have supported a different (wrong) story about
 *  the mechanism. */
function energyBands(pcm: Float32Array, rate: number, fromSec: number, toSec: number, cutDb: number): EnergyBand[] {
  const fr = rmsProfile(pcm, rate, fromSec, toSec);
  const bands: EnergyBand[] = [];
  let start = -1; let maxDb = -Infinity;
  for (let i = 0; i < fr.length; i++) {
    const above = fr[i]!.db >= cutDb;
    if (above) { if (start < 0) { start = i; maxDb = -Infinity; } maxDb = Math.max(maxDb, fr[i]!.db); }
    if ((!above || i === fr.length - 1) && start >= 0) {
      const endIdx = above ? i : i - 1;
      const frames = endIdx - start + 1;
      if (frames >= MIN_BAND_FRAMES && start > 0) {
        bands.push({
          startSec: fr[start]!.startSec, endSec: fr[endIdx]!.startSec + DETECTOR_FRAME_MS / 1000,
          maxDb: Number(maxDb.toFixed(2)), frames, crossesDetectorThreshold: maxDb >= DETECTOR_THRESHOLD_DB,
        });
      }
      start = -1;
    }
  }
  return bands;
}

/** The first detected silence beginning at or after `t` — the fallback view
 *  for `042_eleven_years`, whose real pre-speech silence starts AFTER R.12's
 *  own placement gap ends and is therefore invisible to the shipped rule. */
function nearestSilenceAfter(t: number, silences: readonly SilenceInterval[]): SilenceInterval | undefined {
  let best: SilenceInterval | undefined;
  for (const s of silences) if (s.startSec >= t - 1e-9 && (best === undefined || s.startSec < best.startSec)) best = s;
  return best;
}

let cached: ProductionRun | undefined;
async function v6(): Promise<ProductionRun> {
  if (!cached) cached = await runProductionPath(CORPORA.v6!);
  return cached;
}

/** Decode to channel-0 mono f32 at the file's NATIVE rate — the same
 *  `pan=mono|c0=c0` (verbatim left channel, never an L+R downmix) that
 *  `ws1-native-silences.py` uses, for the reason its docstring gives. */
function decodeNative(path: string, rate: number): Float32Array {
  const buf = execFileSync(FFMPEG, [
    '-hide_banner', '-loglevel', 'error', '-i', path,
    '-af', 'pan=mono|c0=c0', '-ar', String(rate),
    '-f', 'f32le', '-acodec', 'pcm_f32le', '-',
  ], { maxBuffer: 1024 * 1024 * 1024 });
  return new Float32Array(buf.buffer, buf.byteOffset, Math.floor(buf.byteLength / 4));
}

interface Frame { index: number; startSec: number; rms: number; db: number }

/** The owner's Session S live verdicts, by tag — see `ws1-ear-pass-ledger.ts`,
 *  sitting `live-runs-s`, for the authoritative record. */
const EAR_S: Record<string, 'PASS' | 'EARLY' | 'UNSCORED'> = {
  '042_eleven_years': 'EARLY', '125_night_circle': 'PASS', '176_twenty_six_scout': 'EARLY',
  '224_thirty_three': 'EARLY', '307_forty_nine_years': 'EARLY', '340_fifty_eight': 'EARLY',
  '383_sixty_four': 'PASS',
  // R.12's EIGHTH row, reached for the first time by Session S's own R-AP
  // exclusion. The owner heard R.11's 792.18 (MAJOR); nobody has heard R.12's
  // 788.65, so it constrains no candidate and is reported, not scored.
  '266_forty_one_burden': 'UNSCORED',
};

/** The detector's frame scan, restricted to a time window. Frame indices are
 *  ABSOLUTE (`f * frameSamples / rate`), so they line up with the detector's
 *  own numbering rather than restarting at the window. */
function rmsProfile(pcm: Float32Array, rate: number, fromSec: number, toSec: number): Frame[] {
  const frameSamples = Math.floor((DETECTOR_FRAME_MS / 1000) * rate);
  const first = Math.max(0, Math.floor((fromSec * rate) / frameSamples));
  const last = Math.min(Math.floor(pcm.length / frameSamples) - 1, Math.ceil((toSec * rate) / frameSamples));
  const out: Frame[] = [];
  for (let f = first; f <= last; f++) {
    const offset = f * frameSamples;
    let sumSq = 0;
    for (let i = 0; i < frameSamples; i++) { const s = pcm[offset + i] ?? 0; sumSq += s * s; }
    const rms = Math.sqrt(sumSq / frameSamples);
    out.push({ index: f, startSec: (f * frameSamples) / rate, rms, db: rms === 0 ? -Infinity : 20 * Math.log10(rms) });
  }
  return out;
}

/** One R.12-eligible row's full acoustic picture. */
export interface RowPicture {
  tag: string;
  runIndex: number;
  /** The outgoing segment's own last transcript word end — R.12's `gapStart`. */
  prevWordEndSec: number;
  /** The run's acoustic onset (first substantive Whisper token) — R.12's `gapEnd`. */
  runOnsetSec: number;
  /** The last FA word ending at or before `prevWordEndSec`, and the first FA
   *  word starting at or after `runOnsetSec` — FA never sees the run itself
   *  (R.5 excises it), so these bracket the region rather than fill it. */
  lastFaWordEndSec: number | null;
  firstFaWordAfterSec: number | null;
  silence: { startSec: number; endSec: number } | null;
  silenceMidSec: number | null;
  clampedLoSec: number;
  clampedHiSec: number;
  committedValue: number;
  correctedValue: number;
  placement: string;
  earVerdict: 'PASS' | 'EARLY';
}

describe('WS1 Session S — Step 2/3 structural picture of R.12\'s seven rows', () => {
  const TIMEOUT = 300_000;

  it('writes the seven rows\' structural descriptors, and separates the two passing rows by clamping', async () => {
    const r = await v6();
    expect(r.fired['R.12'], 'R.12 firing count on the live v6 bundle').toBeGreaterThan(0);

    const rows = r.r12.map(f => {
      const lo = f.backingSilence ? Math.max(f.backingSilence.startSec, f.gapStartSec) : f.gapStartSec;
      const hi = f.backingSilence ? Math.min(f.backingSilence.endSec, f.gapEndSec) : f.gapEndSec;
      return {
        tag: f.segmentTag ?? '', runIndex: f.runIndex,
        gapStartSec: f.gapStartSec, gapEndSec: f.gapEndSec,
        silence: f.backingSilence ?? null,
        silenceMidSec: f.backingSilence ? (f.backingSilence.startSec + f.backingSilence.endSec) / 2 : null,
        clampedLoSec: lo, clampedHiSec: hi,
        /** How far the detected silence runs PAST the run's acoustic onset.
         *  Positive means the detector called frames silent that Whisper says
         *  already carry the recitation's first word. */
        silenceOverhangSec: f.backingSilence ? f.backingSilence.endSec - f.gapEndSec : null,
        committedValue: f.committedValue, correctedValue: f.correctedValue, placement: f.placement,
      };
    });

    mkdirSync(OUT_ROOT, { recursive: true });
    writeFileSync(resolve(OUT_ROOT, 'stepS-r12-rows.json'), JSON.stringify({ runId: r.runId, rows }, null, 2));

    // WS1 SESSION S found a structural separator here: on the two
    // ear-passing rows the chosen silence stayed inside the gap, while every
    // EARLY row's silence overhung the run's onset by a full second or more.
    // WS1 SESSION T ROOT-CAUSED THAT SEPARATOR AND REMOVED IT — it was a
    // SYMPTOM of the defect (a Whisper-timestamp onset sitting inside the
    // real silence), not an independent signal, and now that
    // `acousticRunExtent` measures the onset off the waveform, the gap's own
    // right edge tracks the backing silence's end on every row, not just two.
    // Asserted here as the new, opposite finding: overhang is now ~0 on ALL
    // eight rows (042 still takes the fallback path since it has no gap-local
    // silence at the RAW onset — Session T's correction is what makes that
    // pause visible to it at all, see the other describe block above).
    const byTag = new Map(rows.map(x => [x.tag, x]));
    const overhang = (t: string): number => byTag.get(t)!.silenceOverhangSec ?? Number.NaN;
    // `125_night_circle` is the one row this doesn't apply to, unchanged from
    // Session S's own finding: its backing silence was ALREADY entirely
    // inside the gap before Session T touched anything (the clamp never bit
    // here), so its onset was never corrected and its overhang stays
    // negative — it is not one of the seven rows the fix changed.
    expect(overhang('125_night_circle')).toBeLessThan(0);
    for (const t of ['042_eleven_years', '176_twenty_six_scout', '224_thirty_three',
      '266_forty_one_burden', '307_forty_nine_years', '340_fifty_eight', '383_sixty_four']) {
      const o = overhang(t);
      if (Number.isNaN(o)) continue; // 042: fallback path, no backing silence to measure.
      expect(Math.abs(o), `${t}: overhang should now be ~0, the discriminator Session S found is gone`).toBeLessThan(0.005);
    }
  }, TIMEOUT);

  // WS1 SESSION S's STEP 3 EXIT CONDITION, RE-DERIVED AND NOW INVERTED. The
  // original form of this test (kept here in spirit, not literally) asserted
  // a NEGATIVE: the unclamped midpoint moved all five EARLY rows later but
  // missed `383_sixty_four` by 0.100s, so no candidate shipped. WS1 SESSION T
  // supplied the missing piece — the onset itself was measured wrong, not
  // just clamped wrong — and the A/B `ear-verify-t` sitting resolved the
  // 0.100s gap the OTHER way than Session S's own solo listen had (383's
  // ear-correct value moved from 1188.95 to 1189.05, not the reverse). This
  // test now asserts the POSITIVE: `r.r12`'s live `correctedValue` (the real,
  // shipped output, not a hand-rederived candidate) matches the six A/B
  // targets to the register's own 0.005s tolerance.
  it('WS1 Session T: the shipped correctedValue now matches all six ear-verify-t targets', async () => {
    const r = await v6();
    const shipped = (tag: string): number => r.r12.find(x => x.segmentTag === tag)!.correctedValue;
    const TARGETS: Record<string, number> = {
      '042_eleven_years': 125.76, '125_night_circle': 370.75, '176_twenty_six_scout': 522.46,
      '224_thirty_three': 664.33, '307_forty_nine_years': 925.43, '340_fifty_eight': 1045.62,
      '383_sixty_four': 1189.05,
    };
    for (const [tag, target] of Object.entries(TARGETS)) {
      expect(Math.abs(shipped(tag) - target), `${tag}: shipped ${shipped(tag)}, ear-verify-t target ${target}`).toBeLessThan(0.005);
    }
    // 266 is the ONE row this fix does not close AT THE `ear-verify-t` VALUE
    // (788.65) — it is a separate, measured 0.10s move off the value that
    // sitting confirmed. WS1 SESSION V ran the follow-up A/B this row was
    // left flagged for (`ear-verify-v`) and confirmed 788.75 instead — see
    // `s-266-live-path-collision` (now `status: 'fixed'`) and
    // `ws1-session-q-production-pins.test.ts`'s `pinEarVerified` for the
    // closure. This assertion is unchanged: it only pins that shipped stays
    // away from 788.65, which remains true at 788.75.
    expect(Math.abs(shipped('266_forty_one_burden') - 788.65)).toBeGreaterThan(0.05);
  }, TIMEOUT);
});

describe.skipIf(!MEASURE)('WS1 Session S — Step 2. Frame-level RMS across the pre-run region (native rate)', () => {
  const TIMEOUT = 900_000;

  it('profiles all seven R.12 rows plus the L7 row at 44.1 kHz off channel 0', async () => {
    expect(existsSync(V6_AUDIO), `source audio must be present: ${V6_AUDIO}`).toBe(true);
    const r = await v6();
    const pcm = decodeNative(V6_AUDIO, V6_NATIVE_RATE);

    const EAR: Record<string, 'PASS' | 'EARLY'> = {
      '042_eleven_years': 'EARLY', '125_night_circle': 'PASS', '176_twenty_six_scout': 'EARLY',
      '224_thirty_three': 'EARLY', '307_forty_nine_years': 'EARLY', '340_fifty_eight': 'EARLY',
      '383_sixty_four': 'PASS',
    };

    const out: unknown[] = [];
    for (const f of r.r12) {
      const from = f.gapStartSec - 0.60;
      const to = f.gapEndSec + 2.50;
      const frames = rmsProfile(pcm, V6_NATIVE_RATE, from, to);
      const faBefore = r.faTokens.filter(t => t.endSec <= f.gapStartSec + 1e-9);
      const faAfter = r.faTokens.filter(t => t.startSec >= f.gapEndSec - 1e-9);
      out.push({
        tag: f.segmentTag, runIndex: f.runIndex, earVerdict: EAR[f.segmentTag ?? ''] ?? '?',
        prevWordEndSec: f.gapStartSec, runOnsetSec: f.gapEndSec,
        lastFaWordEnd: faBefore.length ? faBefore[faBefore.length - 1]!.endSec : null,
        lastFaWordText: faBefore.length ? faBefore[faBefore.length - 1]!.text : null,
        firstFaWordAfterStart: faAfter.length ? faAfter[0]!.startSec : null,
        firstFaWordAfterText: faAfter.length ? faAfter[0]!.text : null,
        silence: f.backingSilence ?? null,
        committedValue: f.committedValue, correctedValue: f.correctedValue, placement: f.placement,
        windowFromSec: from, windowToSec: to,
        thresholdDb: DETECTOR_THRESHOLD_DB, frameMs: DETECTOR_FRAME_MS,
        frames: frames.map(x => ({ t: Number(x.startSec.toFixed(4)), db: Number(x.db.toFixed(2)), rms: Number(x.rms.toFixed(7)) })),
      });
    }

    // The L7 row (R.11's 266_forty_one_burden) profiled on the same grid, so
    // Step 1's structural claim can be read against the same acoustic picture.
    const l7 = r.r11.find(x => x.segmentTag === '266_forty_one_burden');
    if (l7) {
      const run6 = r.r5runs[6]!;
      out.push({
        tag: l7.segmentTag, runIndex: 6, earVerdict: 'MAJOR',
        prevWordEndSec: null, runOnsetSec: run6.startSec,
        r11Committed: l7.committedValue, r11Corrected: l7.correctedValue,
        runRaw: { startSec: run6.startSec, endSec: run6.endSec },
        windowFromSec: run6.startSec - 1.5, windowToSec: run6.endSec + 1.5,
        thresholdDb: DETECTOR_THRESHOLD_DB, frameMs: DETECTOR_FRAME_MS,
        frames: rmsProfile(pcm, V6_NATIVE_RATE, run6.startSec - 1.5, run6.endSec + 1.5)
          .map(x => ({ t: Number(x.startSec.toFixed(4)), db: Number(x.db.toFixed(2)), rms: Number(x.rms.toFixed(7)) })),
      });
    }

    mkdirSync(OUT_ROOT, { recursive: true });
    writeFileSync(resolve(OUT_ROOT, 'stepS2-rms-profile.json'), JSON.stringify({ runId: r.runId, rate: V6_NATIVE_RATE, rows: out }, null, 2));
    expect(out.length).toBe(r.r12.length + (l7 ? 1 : 0));
  }, TIMEOUT);

  // -------------------------------------------------------------------------
  // STEP 3 — THE CANDIDATE PLACEMENT TABLE. Measurement only; nothing here
  // changes a value, and the exit condition is stated up front: a candidate
  // ships only if it reproduces BOTH ear-CORRECT rows (`125_night_circle` ->
  // 370.75 and `383_sixty_four` -> 1188.95) to the register's own 0.005s
  // tolerance AND moves the five EARLY rows later. No additive offset is
  // considered — an offset that forced agreement would be a corpus-fitted
  // constant wearing a rule's clothes.
  // -------------------------------------------------------------------------
  it('computes all five principled candidates for all seven R.12 rows', async () => {
    const r = await v6();
    const pcm = decodeNative(V6_AUDIO, V6_NATIVE_RATE);

    const rows = r.r12.map(f => {
      const sil = f.backingSilence ?? nearestSilenceAfter(f.gapEndSec, r.silences);
      const onsetW = f.gapEndSec;                                  // Whisper's own run onset
      const onsetA = waveformOnset(r.silences, f.gapStartSec, f.runEndSec);
      const excludedBands = energyBands(pcm, V6_NATIVE_RATE, f.gapStartSec, onsetA, DETECTOR_THRESHOLD_DB);
      const mergedBands = energyBands(pcm, V6_NATIVE_RATE, f.gapStartSec, onsetA, REPORT_FLOOR_DB)
        .filter(b => !b.crossesDetectorThreshold);
      const allBands = [...excludedBands, ...mergedBands].sort((x, y) => x.startSec - y.startSec);
      const breath = allBands.length > 0 ? allBands[allBands.length - 1]! : undefined;

      // The SHIPPED clamp, and it only exists when a silence really does
      // intersect the placement gap. `042_eleven_years` is the row where it
      // does not — its nearest silence starts AFTER the gap ends — so its
      // clamped candidate is `null` and its shipped value is the
      // `run-start-fallback`. Reporting an inverted interval's "midpoint"
      // there would have invented a number.
      const overlaps = sil !== undefined && Math.min(sil.endSec, f.gapEndSec) - Math.max(sil.startSec, f.gapStartSec) > 1e-9;
      const clampedLo = sil ? Math.max(sil.startSec, f.gapStartSec) : f.gapStartSec;
      const clampedHi = sil ? Math.min(sil.endSec, f.gapEndSec) : f.gapEndSec;

      return {
        tag: f.segmentTag, runIndex: f.runIndex, earVerdict: EAR_S[f.segmentTag ?? ''],
        prevWordEndSec: f.gapStartSec,
        whisperOnsetSec: onsetW,
        waveformOnsetSec: onsetA,
        /** How far Whisper's run onset precedes the first frame the detector
         *  would call speech. THE measured mechanism: positive means R.12's
         *  clamp is anchored to a timestamp inside the silence. */
        onsetErrorSec: onsetA - onsetW,
        silence: sil ?? null,
        silenceIntersectsGap: overlaps,
        excludedBands, mergedBands,
        breathBand: breath ?? null,
        committed: f.correctedValue,
        // (a) midpoint of the leading silence — as SHIPPED (clamped to the
        //     gap) and UNCLAMPED, because the clamp is the thing under test.
        a_clampedMid: overlaps ? (clampedLo + clampedHi) / 2 : f.correctedValue,
        a_fullMid: sil ? (sil.startSec + sil.endSec) / 2 : null,
        // (b) end of the leading silence.
        b_silenceEnd: sil ? sil.endSec : null,
        // (c) acoustic onset of the run's first word — both readings.
        c_onsetWhisper: onsetW,
        c_onsetWaveform: onsetA,
        // (d) midpoint of [breath end, onset].
        d_breathEndToOnsetMid: breath ? (breath.endSec + onsetA) / 2 : null,
        // (e) midpoint of [prev word end, breath start].
        e_prevWordToBreathMid: breath ? (f.gapStartSec + breath.startSec) / 2 : null,
      };
    });

    writeFileSync(resolve(OUT_ROOT, 'stepS3-candidates.json'), JSON.stringify({ runId: r.runId, rows }, null, 2));

    // THE EXIT TEST, executed. For each candidate: does it reproduce BOTH
    // ear-CORRECT rows? Recorded as data so the negative result cannot be
    // softened into prose later.
    const KEYS = ['a_clampedMid', 'a_fullMid', 'b_silenceEnd', 'c_onsetWhisper', 'c_onsetWaveform',
      'd_breathEndToOnsetMid', 'e_prevWordToBreathMid'] as const;
    const EAR_CORRECT: Record<string, number> = { '125_night_circle': 370.75, '383_sixty_four': 1188.95 };
    const verdicts: Record<string, { reproducesBothCorrect: boolean; movesAllFiveLater: boolean; detail: string[] }> = {};
    for (const k of KEYS) {
      const detail: string[] = [];
      let both = true;
      for (const [tag, target] of Object.entries(EAR_CORRECT)) {
        const v = rows.find(x => x.tag === tag)?.[k];
        const ok = typeof v === 'number' && Math.abs(v - target) < 0.005;
        if (!ok) both = false;
        detail.push(`${tag}: ${typeof v === 'number' ? v.toFixed(3) : 'n/a'} vs ${target} -> ${ok ? 'OK' : 'MISS'}`);
      }
      const early = rows.filter(x => x.earVerdict === 'EARLY');
      const movesAll = early.every(x => typeof x[k] === 'number' && (x[k] as number) > x.committed + 1e-9);
      verdicts[k] = { reproducesBothCorrect: both, movesAllFiveLater: movesAll, detail };
    }
    writeFileSync(resolve(OUT_ROOT, 'stepS3-verdicts.json'), JSON.stringify(verdicts, null, 2));

    // The measured negative, asserted so a future run cannot quietly flip it
    // without someone seeing: NO candidate satisfies both halves of the exit
    // condition. `a_clampedMid` is the shipped behaviour and by construction
    // reproduces both correct rows — it is exactly the one that fails the five.
    const shippable = KEYS.filter(k => verdicts[k]!.reproducesBothCorrect && verdicts[k]!.movesAllFiveLater);
    expect(shippable, `a candidate now satisfies BOTH exit conditions: ${shippable.join(', ')} — Session S ` +
      'measured none, so this is new information and the value change it licenses needs its own ear pass').toEqual([]);
    expect(verdicts['a_clampedMid']!.reproducesBothCorrect, 'the shipped placement is the two correct rows').toBe(true);
    expect(verdicts['a_clampedMid']!.movesAllFiveLater, '...and moves none of the five').toBe(false);
  }, TIMEOUT);
});
