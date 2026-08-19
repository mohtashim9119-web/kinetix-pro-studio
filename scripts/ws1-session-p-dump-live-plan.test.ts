/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// ---------------------------------------------------------------------------
// WS1 Session P — STEP 1 OF REGENERATION: dump the LIVE chunk plan.
//
// The captured `fa_production_chunks.json` holds 280 chunks; the current code
// computes 277 from the same corpus. Every FA word in
// `fa_production_words.json` was aligned against the 280-chunk windows, so
// every rule reading those words is reading a stale vintage. This file emits
// the plan the CURRENT code produces, which the Rust regeneration step then
// aligns against.
//
// LIVE FIDELITY IS THE WHOLE POINT, so the call below is byte-for-byte the
// production call — `computeFaChunkPlan(anchorTimed, whisperTokens, silences,
// audioDuration)`, four arguments, every optional left at its default,
// exactly as `forcedAlignmentRun.ts:147` invokes it. Adding an argument here
// (a language, a vocab set) would produce a plan production cannot produce.
//
// INPUT ARMS, deliberately the live-fidelity pair (Session P Step 1):
//   * raw Whisper tokens (`whisper_raw_tokens.json`) — production passes
//     `projectRef.current.transcriptTokens`, the UNFILTERED array;
//     `filterMalformedTokens` runs later and on a different consumer.
//   * native-rate silences (`silences_native.json`) — what `silenceDetector.ts`
//     actually computes in the app. The 16 kHz arm is the golden-replay
//     baseline's arm and is frozen; see `ws1-silence-arms.test.ts`.
//
// This is a GENERATOR, not an assertion of correctness: the only thing it
// asserts is that the plan is non-empty and that it differs from the stale
// capture (if it ever stopped differing, the vintage gap closed on its own
// and the regeneration is unnecessary).
// ---------------------------------------------------------------------------

import { describe, it, expect } from 'vitest';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

import { parseProjectData } from '../src/App';
import { applyAnchorBasedTiming } from '../src/services/syncEngine';
import { computeFaChunkPlan } from '../src/services/faChunkPlan';
import type { TranscriptToken } from '../src/types';
import type { SilenceInterval } from '../src/services/silenceDetector';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const V6 = resolve(REPO, '.work-phase4/replay/v6');
const AUDIO_DURATION = 1421.29;
const SCRIPT = '/Users/mohtashim/Downloads/All Projects Test Data/V6 Natural Long Pause Segs/All Text Files/Script.txt';
const SCENES = '/Users/mohtashim/Downloads/All Projects Test Data/V6 Natural Long Pause Segs/All Text Files/Sync.txt';

function requireFile(path: string, how: string): string {
  if (!existsSync(path)) throw new Error(`Missing input: ${path}\nRegenerate it:\n    ${how}`);
  return path;
}

// GENERATOR / MEASUREMENT — NOT part of the default `npm test` sweep.
// Set WS1_SESSION_P_MEASURE=1 to run. Same convention as the Rust
// `#[ignore]`d measurement modules: these write into `.work-phase4/` and take
// minutes, and one of them REWRITES a bundle arm — letting that happen inside
// a plain `npm test` un-stamps the bundle and breaks every consumer, which is
// exactly what it did once before this gate existed.
const MEASURE = process.env.WS1_SESSION_P_MEASURE === '1';

describe.skipIf(!MEASURE)('WS1 Session P — dump the live chunk plan', () => {
  it('emits fa_live_chunks.json from the production four-argument call', async () => {
    const rawTokens: TranscriptToken[] = (JSON.parse(readFileSync(
      requireFile(resolve(V6, 'whisper_raw_tokens.json'), 'python3 scripts/ws1-whisper-raw-tokens.py …'), 'utf-8'),
    ) as { tokens: Array<{ text: string; startSec: number; endSec: number }> }).tokens
      .map(t => ({ text: t.text, startSec: t.startSec, endSec: t.endSec }));

    const silences: SilenceInterval[] = (JSON.parse(readFileSync(
      requireFile(resolve(V6, 'silences_native.json'), 'python3 scripts/ws1-native-silences.py --all'), 'utf-8'),
    ) as { silences: SilenceInterval[] }).silences;

    const segsRaw = await parseProjectData(
      readFileSync(SCRIPT, 'utf-8'), readFileSync(SCENES, 'utf-8'), [], AUDIO_DURATION);
    const anchorTimed = applyAnchorBasedTiming(segsRaw, AUDIO_DURATION);

    // The production call. Four arguments. Nothing else.
    const chunks = computeFaChunkPlan(anchorTimed, rawTokens, silences, AUDIO_DURATION);

    expect(chunks.length).toBeGreaterThan(0);

    const stale = (JSON.parse(readFileSync(resolve(V6, 'fa_production_chunks.json'), 'utf-8')) as {
      chunks: Array<{ startSec: number; endSec: number; text: string }>;
    }).chunks;

    // If this ever fails, the live plan has converged onto the stale capture
    // and this whole regeneration step is moot — which is worth knowing loudly.
    expect(chunks.length, 'live plan matches the stale 280-chunk capture — vintage gap closed').not.toBe(stale.length);

    writeFileSync(resolve(V6, 'fa_live_chunks.json'), `${JSON.stringify({
      audioDuration: AUDIO_DURATION,
      language: 'en',
      _source: {
        note: 'LIVE plan — computeFaChunkPlan(anchorTimed, rawWhisperTokens, nativeSilences, audioDuration), the production four-argument call',
        whisperArm: 'whisper_raw_tokens.json (raw, unfiltered)',
        silenceArm: 'silences_native.json (native-rate left channel)',
        rawTokenCount: rawTokens.length,
        silenceCount: silences.length,
        anchorTimedSegments: anchorTimed.length,
        staleCaptureChunks: stale.length,
      },
      chunks: chunks.map(c => ({ startSec: c.startSec, endSec: c.endSec, text: c.text })),
    }, null, 2)}\n`);

    // eslint-disable-next-line no-console
    console.log(`[session-p] live chunk plan: ${chunks.length} chunks (stale capture: ${stale.length})`);
  }, 900_000);
});
