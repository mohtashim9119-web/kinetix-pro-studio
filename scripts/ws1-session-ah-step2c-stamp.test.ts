/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// ---------------------------------------------------------------------------
// WS1 Session AH — STEP 2c. Stamp the re-captured 173 bundle and archive it.
//
// Copies the six arms of the re-capture into `.work-phase4/session-ah/173-bundle/`
// with a single run id and a manifest, so this bundle is verifiable the same way
// `verifyBundle` verifies the Session P ones — and so the RETIRED 126-chunk arm
// stays untouched in `.work-phase4/replay/173/` as the historical record rather
// than being overwritten.
//
// Gated: WS1_SESSION_AH_MEASURE=1 npx vitest run scripts/ws1-session-ah-step2c-stamp.test.ts
// ---------------------------------------------------------------------------

import { describe, it } from 'vitest';
import { writeFileSync, readFileSync, copyFileSync, mkdirSync, statSync } from 'fs';
import { resolve } from 'path';
import { createHash } from 'crypto';

import { CORPORA, runProductionPath, tagOf, REPO, REPLAY_ROOT } from './ws1-session-p-pipeline.js';
import { mintRunId, stampArm, writeManifest, sha256File } from './ws1-runid.js';
import { parseProjectData } from '../src/App';
import { applyAnchorBasedTiming } from '../src/services/syncEngine';

const MEASURE = process.env.WS1_SESSION_AH_MEASURE === '1';
const OUT = resolve(REPO, '.work-phase4/session-ah');
const BUNDLE = resolve(OUT, '173-bundle');

describe.skipIf(!MEASURE)('WS1 Session AH Step 2c — stamp the re-captured 173 bundle', () => {
  it('writes six arms plus a manifest', async () => {
    mkdirSync(BUNDLE, { recursive: true });
    const spec = CORPORA['173']!;
    const src = resolve(REPLAY_ROOT, '173');
    const runId = mintRunId().replace(/^p-/, 'ah-');

    // Arms carried forward unchanged (verified against the Session P manifest
    // this session — silences additionally RE-DERIVED from audio and found
    // byte-identical, 237 entries, 0 elementwise diffs).
    for (const f of ['silences_native.json', 'whisper_raw_tokens.json']) copyFileSync(resolve(src, f), resolve(BUNDLE, f));
    // Arms produced this session.
    for (const f of ['fa_ah_chunks.json', 'fa_ah_words.json']) copyFileSync(resolve(src, f), resolve(BUNDLE, f));

    // Parsed segments + committed boundaries, which the Session P bundles never
    // carried and which make this bundle self-describing.
    const segsRaw = await parseProjectData(
      readFileSync(spec.scriptPath, 'utf-8'), readFileSync(spec.sceneDetailsPath, 'utf-8'), [], spec.audioDuration,
    );
    const anchorTimed = applyAnchorBasedTiming(segsRaw, spec.audioDuration);
    writeFileSync(resolve(BUNDLE, 'parsed_segments.json'), JSON.stringify({
      note: 'parseProjectData + applyAnchorBasedTiming, at HEAD',
      scriptPath: spec.scriptPath, sceneDetailsPath: spec.sceneDetailsPath,
      scriptSha256: sha256File(spec.scriptPath), syncSha256: sha256File(spec.sceneDetailsPath),
      count: anchorTimed.length,
      segments: anchorTimed.map(s => ({ id: s.id, tag: tagOf(s), startTime: s.startTime, duration: s.duration, text: s.text })),
    }, null, 2));

    const run = await runProductionPath(spec, true, undefined, 'fa_ah_words.json');
    writeFileSync(resolve(BUNDLE, 'committed_boundaries.json'), JSON.stringify({
      note: 'runProductionPath over fa_ah_words.json — App.tsx\'s own rule order',
      fired: run.fired, count: run.committed.length,
      committed: run.committed.map(s => ({ tag: tagOf(s), startTime: s.startTime, duration: s.duration })),
    }, null, 2));

    const arms: Record<string, string> = {
      silences: 'silences_native.json',
      whisperRaw: 'whisper_raw_tokens.json',
      chunkPlan: 'fa_ah_chunks.json',
      faWords: 'fa_ah_words.json',
      parsedSegments: 'parsed_segments.json',
      committedBoundaries: 'committed_boundaries.json',
    };
    const manifestArms: Record<string, { file: string; sha256: string; count: number }> = {};
    for (const [name, file] of Object.entries(arms)) {
      const { sha256, count } = stampArm(resolve(BUNDLE, file), runId);
      manifestArms[name] = { file, sha256, count };
    }
    writeManifest(BUNDLE, { runId, mintedAt: new Date().toISOString(), arms: manifestArms });

    const model = resolve(process.env.HOME!, 'Library/Application Support/com.kinetix.pro-studio/fa-models/en/model.onnx');
    const L = [
      '# WS1 Session AH Step 2c — the re-captured 173 bundle',
      '',
      `- runId: \`${runId}\``,
      `- location: \`.work-phase4/session-ah/173-bundle/\``,
      '',
      '| arm | file | sha256 | count |',
      '|---|---|---|---|',
      ...Object.entries(manifestArms).map(([n, a]) => `| ${n} | \`${a.file}\` | \`${a.sha256.slice(0, 16)}\` | ${a.count} |`),
      '',
      '## Provenance of the FA run',
      '',
      `- model: \`${model}\``,
      `- model sha256: \`${createHash('sha256').update(readFileSync(model)).digest('hex')}\``,
      `- model bytes: ${statSync(model).size}`,
      '- ONNX Runtime: **1.23.2** (`src-tauri/onnxruntime/onnxruntime.manifest.json`, `ort =2.0.0-rc.13`, C API 17)',
      '- harness: `fa_onnx.rs`\'s `session_p_regen::regenerate_fa_against_live_plan`',
      '- wall clock: **5:21.89** (310.62s user, 8.16s system, 99% cpu — single-threaded as pinned)',
      '',
      '## Session Y single-thread pinning — quoted from `src-tauri/src/fa_onnx.rs:411-422`',
      '',
      '```rust',
      '    Session::builder()',
      '        .map_err(|e| FaOnnxError::OrtSession(e.to_string()))?',
      '        .with_intra_threads(1)',
      '        .map_err(|e| FaOnnxError::OrtSession(e.to_string()))?',
      '        .with_inter_threads(1)',
      '        .map_err(|e| FaOnnxError::OrtSession(e.to_string()))?',
      '        .with_parallel_execution(false)',
      '        .map_err(|e| FaOnnxError::OrtSession(e.to_string()))?',
      '        .with_deterministic_compute(true)',
      '        .map_err(|e| FaOnnxError::OrtSession(e.to_string()))?',
      '        .commit_from_file(model_path)',
      '```',
      '',
      'All four pins ACTIVE — this is the only `load_session` any production or regen path calls.',
    ].join('\n');
    writeFileSync(resolve(OUT, 'step2c-bundle.md'), L + '\n');
    console.log(L);
  }, 900_000);
});
