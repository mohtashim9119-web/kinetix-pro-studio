/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// ---------------------------------------------------------------------------
// WS1 Session Q — STEP 5 PREREQUISITE: dump the LIVE chunk plan for ANY corpus.
//
// `ws1-session-p-dump-live-plan.test.ts` is v6-hardcoded, including an
// assertion that the live plan DIFFERS from v6's stale 280-chunk capture.
// Step 5 needs the same dump for 173 and Spanish, where no such difference is
// known in advance and asserting one would be assuming the answer. This file
// is the corpus-parameterised sibling: same production four-argument call,
// same two live-fidelity input arms, no assertion about the stale capture —
// the delta is REPORTED instead.
//
//   WS1_SESSION_Q_MEASURE=1 WS1_Q_CORPUS=173 npx vitest run \
//     scripts/ws1-session-q-dump-live-plan.test.ts
// ---------------------------------------------------------------------------

import { describe, it, expect } from 'vitest';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { resolve } from 'path';

import { parseProjectData } from '../src/App';
import { applyAnchorBasedTiming } from '../src/services/syncEngine';
import { computeFaChunkPlan } from '../src/services/faChunkPlan';
import { CORPORA, REPLAY_ROOT } from './ws1-session-p-pipeline.js';
import type { TranscriptToken } from '../src/types';
import type { SilenceInterval } from '../src/services/silenceDetector';

const MEASURE = process.env.WS1_SESSION_Q_MEASURE === '1';
const KEY = process.env.WS1_Q_CORPUS ?? 'v6';

describe.skipIf(!MEASURE)(`WS1 Session Q — live chunk plan for ${KEY}`, () => {
  it('emits fa_live_chunks.json from the production four-argument call', async () => {
    const spec = CORPORA[KEY];
    if (!spec) throw new Error(`unknown corpus ${KEY}`);
    const dir = resolve(REPLAY_ROOT, KEY);

    const rawPath = resolve(dir, 'whisper_raw_tokens.json');
    if (!existsSync(rawPath)) {
      throw new Error(`Missing raw whisper arm: ${rawPath}\n  python3 scripts/ws1-whisper-raw-tokens.py --stdout <capture> --out ${rawPath}`);
    }
    const rawTokens: TranscriptToken[] = (JSON.parse(readFileSync(rawPath, 'utf-8')) as {
      tokens: Array<{ text: string; startSec: number; endSec: number }>;
    }).tokens.map(t => ({ text: t.text, startSec: t.startSec, endSec: t.endSec }));

    const silPath = resolve(dir, 'silences_native.json');
    if (!existsSync(silPath)) throw new Error(`Missing native silence arm: ${silPath}`);
    const silences: SilenceInterval[] = (JSON.parse(readFileSync(silPath, 'utf-8')) as {
      silences: SilenceInterval[];
    }).silences;

    const segsRaw = await parseProjectData(
      readFileSync(spec.scriptPath, 'utf-8'), readFileSync(spec.sceneDetailsPath, 'utf-8'), [], spec.audioDuration,
    );
    const anchorTimed = applyAnchorBasedTiming(segsRaw, spec.audioDuration);

    // The production call. Four arguments. Nothing else.
    const chunks = computeFaChunkPlan(anchorTimed, rawTokens, silences, spec.audioDuration);
    expect(chunks.length).toBeGreaterThan(0);

    const stalePath = resolve(dir, 'fa_production_chunks.json');
    const stale = existsSync(stalePath)
      ? (JSON.parse(readFileSync(stalePath, 'utf-8')) as { chunks: unknown[] }).chunks.length
      : null;

    writeFileSync(resolve(dir, 'fa_live_chunks.json'), `${JSON.stringify({
      audioDuration: spec.audioDuration,
      language: spec.language,
      _source: {
        note: 'LIVE plan — computeFaChunkPlan(anchorTimed, rawWhisperTokens, nativeSilences, audioDuration), the production four-argument call',
        whisperArm: 'whisper_raw_tokens.json (raw, unfiltered)',
        silenceArm: 'silences_native.json (native-rate left channel)',
        rawTokenCount: rawTokens.length,
        silenceCount: silences.length,
        anchorTimedSegments: anchorTimed.length,
        staleCaptureChunks: stale,
      },
      chunks: chunks.map(c => ({ startSec: c.startSec, endSec: c.endSec, text: c.text })),
    }, null, 2)}\n`);

    // eslint-disable-next-line no-console
    console.log(`[session-q] ${KEY}: live plan ${chunks.length} chunks (stale capture: ${stale ?? 'none'}), raw tokens ${rawTokens.length}, silences ${silences.length}`);
  }, 900_000);
});
