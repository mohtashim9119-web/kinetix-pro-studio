/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// ---------------------------------------------------------------------------
// WS1 Session V — STEP 1. THE RUN-ID-STAMPED CLOSURE BUNDLE (ruling R-AO).
//
// WHY. Session V closes seven register rows on the strength of an operator ear
// pass. R-AO's rule is that a closure value must come from the REAL production
// path, in one derivation, with every arm of the evidence sharing one run id —
// never from a stored target, a prior session's prose, or the operator's own
// message. This file is that derivation.
//
// WHAT IS AND IS NOT REGENERATED, stated plainly because it bounds every claim
// downstream. The four INPUT arms (native-rate silences, raw Whisper tokens,
// regenerated FA words, live chunk plan) are NOT re-derived here: silences come
// off the waveform, Whisper tokens off the whisper.cpp sidecar and FA words off
// the ONNX runtime, none of which run inside vitest. They are consumed as the
// already-stamped, already-verified live-fidelity bundle
// (`.work-phase4/replay/v6`, `verifyBundle` enforced at load in
// `ws1-session-p-pipeline.ts`), and this bundle records their run id as
// `inputRunId` so the provenance chain is explicit rather than implied.
//
// What IS freshly derived, every time, from those inputs through the real rule
// stage in App.tsx's own order: the parsed/anchor-timed segments, the chunk
// plan, the R.5 runs and their acoustic extents, and the COMMITTED BOUNDARIES.
// Those are the values Step 2's table reports and the only ones Step 3 is
// allowed to close a row against.
//
// GENERATOR — gated off the default sweep. Run:
//   WS1_SESSION_V_MEASURE=1 npx vitest run scripts/ws1-session-v-bundle.test.ts
// ---------------------------------------------------------------------------

import { describe, it, expect } from 'vitest';
import { writeFileSync, mkdirSync } from 'fs';
import { resolve } from 'path';
import { createHash } from 'crypto';

import { CORPORA, runProductionPath, tagOf, REPO } from './ws1-session-p-pipeline.js';
import { mintRunId } from './ws1-runid.js';
import { acousticRunExtent } from '../src/services/faRunPlacementGate';

const MEASURE = process.env.WS1_SESSION_V_MEASURE === '1';
const CORPUS = process.env.WS1_V_CORPUS ?? 'v6';

const sha = (s: string): string => createHash('sha256').update(s).digest('hex');

describe.runIf(MEASURE)('WS1 Session V — Step 1, the closure bundle', () => {
  it('derives and stamps one bundle from the production path', async () => {
    const spec = CORPORA[CORPUS];
    expect(spec, `unknown corpus ${CORPUS}`).toBeDefined();
    const run = await runProductionPath(spec!);

    const runId = mintRunId().replace(/^p-/, 'v-');
    const outDir = resolve(REPO, '.work-phase4/session-v', runId);
    mkdirSync(outDir, { recursive: true });

    const extents = run.r5runs.map(r => acousticRunExtent(r, run.whisperTokens, run.silences));

    const arms: Record<string, unknown> = {
      silences: { count: run.silences.length, silences: run.silences },
      whisperRaw: { count: run.whisperTokens.length, tokens: run.whisperTokens },
      faWords: { count: run.faTokens.length, words: run.faTokens },
      chunkPlan: { count: run.chunks.length, chunks: run.chunks },
      parsedSegments: {
        count: run.anchorTimed.length,
        segments: run.anchorTimed.map(s => ({
          tag: tagOf(s), id: s.id, startTime: s.startTime, duration: s.duration,
        })),
      },
      committedBoundaries: {
        count: run.committed.length,
        segments: run.committed.map((s, i) => ({
          index: i, tag: tagOf(s), id: s.id,
          startTime: s.startTime, duration: s.duration,
          preRuleStart: run.preRuleSegments.find(p => p.id === s.id)?.startTime ?? null,
        })),
      },
      runExtents: {
        count: extents.length,
        extents: extents.map((e, i) => ({ index: i, startSec: e.startSec, endSec: e.endSec })),
      },
      ruleFindings: {
        fired: run.fired,
        r11: run.r11Kept.map(f => ({ tag: f.segmentTag, corrected: f.correctedValue })),
        r12: run.r12.map(f => ({ tag: f.segmentTag, corrected: f.correctedValue, placement: f.placement })),
        r13: run.r13Kept.map(f => ({ tag: f.segmentTag, corrected: f.correctedValue })),
        r11Excluded: run.r11Excluded.map(e => ({ ...e })),
        r13Excluded: run.r13Excluded.map(e => ({ ...e })),
        unspoken: run.unspoken.map(u => ({ segmentIndex: u.segmentIndex })),
      },
    };

    const manifestArms: Record<string, { file: string; sha256: string; count: number }> = {};
    for (const [name, payload] of Object.entries(arms)) {
      const file = `${name}.json`;
      const body = `${JSON.stringify({ _runId: runId, ...(payload as object) }, null, 2)}\n`;
      writeFileSync(resolve(outDir, file), body);
      const p = payload as { count?: number };
      manifestArms[name] = { file, sha256: sha(body), count: p.count ?? -1 };
    }

    const manifest = {
      runId,
      mintedAt: new Date().toISOString(),
      corpus: CORPUS,
      session: 'WS1 Session V',
      /** The INPUT bundle this derivation consumed, verified by
       *  `loadLiveBundle`'s own `verifyBundle` call before any rule ran. */
      inputRunId: run.runId ?? null,
      audioDuration: spec!.audioDuration,
      fired: run.fired,
      kept: run.kept,
      skipped: run.skipped,
      arms: manifestArms,
    };
    writeFileSync(resolve(outDir, 'run_manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);

    // eslint-disable-next-line no-console
    console.log(`\n[session-v] bundle runId   = ${runId}`);
    // eslint-disable-next-line no-console
    console.log(`[session-v] input  runId   = ${run.runId}`);
    // eslint-disable-next-line no-console
    console.log(`[session-v] outDir         = ${outDir}`);
    // eslint-disable-next-line no-console
    console.log(`[session-v] fired          = ${JSON.stringify(run.fired)} kept=${run.kept} skipped=${run.skipped}`);
    for (const [n, a] of Object.entries(manifestArms)) {
      // eslint-disable-next-line no-console
      console.log(`[session-v]   ${n.padEnd(20)} count=${String(a.count).padStart(5)}  sha=${a.sha256.slice(0, 12)}…`);
    }

    // ---- STEP 2: the seven rows, MEASURED. ----
    const SEVEN = [
      '042_eleven_years', '176_twenty_six_scout', '224_thirty_three',
      '307_forty_nine_years', '340_fifty_eight',
      '266_forty_one_burden', '383_sixty_four',
    ];
    // eslint-disable-next-line no-console
    console.log(`\n[session-v] ---- STEP 2: measured committed boundaries ----`);
    for (const tag of SEVEN) {
      const s = run.committed.find(x => tagOf(x) === tag);
      const pre = run.preRuleSegments.find(x => tagOf(x) === tag);
      const r12 = run.r12.find(x => x.segmentTag === tag);
      const r11 = run.r11Kept.find(x => x.segmentTag === tag);
      const r13 = run.r13Kept.find(x => x.segmentTag === tag);
      // eslint-disable-next-line no-console
      console.log(
        `[session-v] ${tag.padEnd(24)} committed=${s ? s.startTime.toFixed(5) : '(ABSENT)'}` +
        `  preRule=${pre ? pre.startTime.toFixed(5) : '(ABSENT)'}` +
        `  R.11=${r11 ? r11.correctedValue.toFixed(5) : '-'}` +
        `  R.12=${r12 ? `${r12.correctedValue.toFixed(5)} (${r12.placement})` : '-'}` +
        `  R.13=${r13 ? r13.correctedValue.toFixed(5) : '-'}`,
      );
    }

    expect(run.committed.length).toBeGreaterThan(0);
  }, 600_000);
});
