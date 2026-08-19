/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// ---------------------------------------------------------------------------
// WS1 Session P — THE TWO SILENCE ARMS, PINNED.
//
// Session P Step 1 measured that the harness and the shipped app were snapping
// against two DIFFERENT silence arrays:
//
//   * 16 kHz MONO arm (`silences_app.json`, via phase4-handoff-app-silence.py)
//     — what the Step M golden replay is baselined against. FROZEN: the
//     committed `scripts/fixtures/phase4-baseline-*-silences.csv` must stay
//     byte-identical, so this arm may never be "corrected" toward the app.
//
//   * NATIVE-RATE LEFT-CHANNEL arm (`silences_native.json`, via
//     ws1-native-silences.py) — what `silenceDetector.ts` actually computes in
//     the app (`decodeAudioData` at the context rate, `getChannelData(0)`).
//     Consumed only by the R-AO production-path gate.
//
// This file exists so neither arm can drift silently, and so the DIVERGENCE
// ITSELF stays a measured, pinned fact rather than folklore. The first test is
// the validated port from Session P Step 1: it re-runs silenceDetector.ts's
// frame loop over the 16 kHz WAV and must reproduce all 547 committed entries
// value for value. If that ever fails, the 16 kHz arm moved and the golden
// baseline is no longer describing the same audio.
//
// Why a port rather than calling `detectSilences` directly: that function takes
// a Blob and needs AudioContext/decodeAudioData, neither of which exists under
// vitest. The loop below is a line-for-line transcription of it (frame size,
// RMS, dB, boundary conditions, trailing-silence case) and is validated BY this
// very test — it reproduces the committed array, which is the only evidence
// that the transcription is faithful. `src/services/silenceDetector.ts` is
// UNCHANGED and is not imported here.
// ---------------------------------------------------------------------------

import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import type { SilenceInterval } from '../src/services/silenceDetector';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const V6 = resolve(REPO, '.work-phase4/replay/v6');
const RESTORE = 'python3 scripts/phase4-restore-replay-inputs.py';
const NATIVE = 'python3 scripts/ws1-native-silences.py --all';

function requireFile(path: string, how: string): string {
  if (!existsSync(path)) throw new Error(`Missing replay input: ${path}\nRegenerate it:\n    ${how}`);
  return path;
}

/** Reads a 16-bit PCM mono WAV into normalized float samples, the same way
 *  AudioBuffer.getChannelData yields them (int16 / 32768). */
function readPcm16Mono(path: string): Float32Array {
  const buf = readFileSync(path);
  // Walk RIFF chunks rather than assuming a 44-byte header.
  let offset = 12;
  let dataOffset = -1;
  let dataLength = 0;
  while (offset + 8 <= buf.byteLength) {
    const id = buf.toString('ascii', offset, offset + 4);
    const size = buf.readUInt32LE(offset + 4);
    if (id === 'data') { dataOffset = offset + 8; dataLength = size; break; }
    offset += 8 + size + (size % 2);
  }
  if (dataOffset < 0) throw new Error(`no data chunk in ${path}`);
  const n = Math.floor(dataLength / 2);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = buf.readInt16LE(dataOffset + i * 2) / 32768.0;
  return out;
}

/** Line-for-line port of silenceDetector.ts's detectSilences frame loop. */
function scanSilences(
  channelData: Float32Array,
  sampleRate: number,
  thresholdDb = -45,
  minDurationSec = 0.25,
  frameSizeMs = 20,
): SilenceInterval[] {
  const frameSizeSamples = Math.floor((frameSizeMs / 1000) * sampleRate);
  const totalFrames = Math.floor(channelData.length / frameSizeSamples);
  const silences: SilenceInterval[] = [];
  let silenceStart: number | null = null;

  for (let f = 0; f < totalFrames; f++) {
    const offset = f * frameSizeSamples;
    let sumSq = 0;
    for (let i = 0; i < frameSizeSamples; i++) {
      const s = channelData[offset + i] ?? 0;
      sumSq += s * s;
    }
    const rms = Math.sqrt(sumSq / frameSizeSamples);
    const db = rms === 0 ? -Infinity : 20 * Math.log10(rms);
    const frameSec = (f * frameSizeSamples) / sampleRate;
    if (db < thresholdDb) {
      if (silenceStart === null) silenceStart = frameSec;
    } else if (silenceStart !== null) {
      if (frameSec - silenceStart >= minDurationSec) silences.push({ startSec: silenceStart, endSec: frameSec });
      silenceStart = null;
    }
  }
  if (silenceStart !== null) {
    const endSec = (totalFrames * frameSizeSamples) / sampleRate;
    if (endSec - silenceStart >= minDurationSec) silences.push({ startSec: silenceStart, endSec });
  }
  return silences;
}

const loadArm = (file: string, how: string): SilenceInterval[] =>
  (JSON.parse(readFileSync(requireFile(resolve(V6, file), how), 'utf-8')) as { silences: SilenceInterval[] }).silences;

describe('WS1 Session P — silence arms', () => {
  it('16 kHz arm: the scan reproduces all 547 committed entries value for value', () => {
    const wav = readPcm16Mono(requireFile(resolve(V6, 'audio_16k.wav'), RESTORE));
    const scanned = scanSilences(wav, 16000);
    const committed = loadArm('silences_app.json', RESTORE);

    expect(scanned.length).toBe(547);
    expect(committed.length).toBe(547);
    for (let i = 0; i < committed.length; i++) {
      expect(scanned[i]!.startSec).toBeCloseTo(committed[i]!.startSec, 9);
      expect(scanned[i]!.endSec).toBeCloseTo(committed[i]!.endSec, 9);
    }
  }, 300_000);

  it('native arm exists, is the live-fidelity shape, and is NOT the 16 kHz arm', () => {
    const app = loadArm('silences_app.json', RESTORE);
    const native = loadArm('silences_native.json', NATIVE);

    // The measured Session P divergence, pinned. If these ever coincide, one of
    // the two generators has been changed to imitate the other.
    expect(app.length).toBe(547);
    expect(native.length).toBe(546);

    // The phantom the 16 kHz downmix invents and the app never produces.
    const phantom = app.find(s => Math.abs(s.startSec - 1128.68) < 1e-6);
    expect(phantom, '16 kHz arm must still carry the [1128.68,1129.04] phantom').toBeDefined();
    expect(native.some(s => Math.abs(s.startSec - 1128.68) < 1e-6)).toBe(false);

    // The 20 ms silence-end shift that makes the two arms commit 671.18 vs
    // 671.17 — R.11's corrected value is this silence's midpoint.
    const appSil = app.find(s => Math.abs(s.startSec - 670.86) < 1e-6)!;
    const natSil = native.find(s => Math.abs(s.startSec - 670.86) < 1e-6)!;
    expect((appSil.startSec + appSil.endSec) / 2).toBeCloseTo(671.18, 6);
    expect((natSil.startSec + natSil.endSec) / 2).toBeCloseTo(671.17, 6);
  });
});
