/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// ---------------------------------------------------------------------------
// WS1 Session AH — STEP 2a. Re-capture 173's chunk plan AT HEAD.
//
// WHY. `.work-phase4/replay/173/fa_live_chunks.json` holds 126 chunks; current
// code computes 119 from the SAME stamped inputs (Session AG measured this and
// could not attribute it). Session AH bisected it: every committed tree from
// `4b9bea9` — the commit that was HEAD when the bundle was minted — through
// HEAD produces 119, with a byte-identical chunk[11], and none of the eight
// arm/attribution combinations available produces 126. The stored plan is
// therefore not reproducible from any version-controlled state, so it is
// retired rather than trusted.
//
// This writes the HEAD plan as a SEPARATE arm (`fa_ah_chunks.json`), never over
// `fa_live_chunks.json` — the same additive discipline Session AG used for its
// own arms. `fa_onnx.rs`'s `session_p_regen` harness then aligns the same
// `audio_16k.wav` against it via FA_REGEN_PLAN/FA_REGEN_OUT.
//
// Gated: WS1_SESSION_AH_MEASURE=1 npx vitest run scripts/ws1-session-ah-step2-capture.test.ts
// ---------------------------------------------------------------------------

import { describe, it } from 'vitest';
import { writeFileSync, readFileSync, mkdirSync } from 'fs';
import { resolve } from 'path';
import { createHash } from 'crypto';

import { CORPORA, REPO, REPLAY_ROOT, loadLiveBundle } from './ws1-session-p-pipeline.js';
import { parseProjectData } from '../src/App';
import { applyAnchorBasedTiming } from '../src/services/syncEngine';
import { computeFaChunkPlan } from '../src/services/faChunkPlan';
import { mintRunId } from './ws1-runid.js';

const MEASURE = process.env.WS1_SESSION_AH_MEASURE === '1';
const OUT = resolve(REPO, '.work-phase4/session-ah');

describe.skipIf(!MEASURE)('WS1 Session AH Step 2a — re-capture the 173 chunk plan at HEAD', () => {
  it('writes fa_ah_chunks.json and records provenance', async () => {
    mkdirSync(OUT, { recursive: true });
    const spec = CORPORA['173']!;
    const { whisperTokens, silences, runId } = loadLiveBundle('173');

    const segs = await parseProjectData(
      readFileSync(spec.scriptPath, 'utf-8'), readFileSync(spec.sceneDetailsPath, 'utf-8'), [], spec.audioDuration,
    );
    const anchorTimed = applyAnchorBasedTiming(segs, spec.audioDuration);
    const chunks = computeFaChunkPlan(anchorTimed, whisperTokens, silences, spec.audioDuration);

    const ahRunId = mintRunId().replace(/^p-/, 'ah-');
    const payload = {
      _runId: ahRunId,
      audioDuration: spec.audioDuration,
      language: spec.language,
      _source: {
        note: 'WS1 Session AH re-capture — computeFaChunkPlan(anchorTimed, rawWhisperTokens, '
          + 'nativeSilences, audioDuration), the production four-argument call, AT HEAD.',
        whisperArm: 'whisper_raw_tokens.json (raw, unfiltered) — carried forward from bundle ' + runId,
        silenceArm: 'silences_native.json (native-rate left channel) — re-derived this session '
          + 'from audio and byte-identical to the stamped arm (237 silences, 0 elementwise diffs)',
        rawTokenCount: whisperTokens.length,
        silenceCount: silences.length,
        anchorTimedSegments: anchorTimed.length,
        supersedes: 'fa_live_chunks.json (126 chunks, runId ' + runId + ') — RETIRED, not reproducible '
          + 'from any committed tree; see step2-recapture.md',
      },
      chunks,
    };
    const dest = resolve(REPLAY_ROOT, '173', 'fa_ah_chunks.json');
    const text = JSON.stringify(payload, null, 2);
    writeFileSync(dest, text);

    const L = [
      `runId          : ${ahRunId}`,
      `chunks         : ${chunks.length}`,
      `segments       : ${anchorTimed.length}`,
      `whisper tokens : ${whisperTokens.length}`,
      `silences       : ${silences.length}`,
      `sha256         : ${createHash('sha256').update(text).digest('hex')}`,
      `wrote          : ${dest}`,
    ].join('\n');
    writeFileSync(resolve(OUT, 'step2a-plan.txt'), L + '\n');
    console.log(L);
  }, 600_000);
});
