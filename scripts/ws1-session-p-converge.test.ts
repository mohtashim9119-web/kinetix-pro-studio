/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// WS1 Session P — STEP 2c. Re-run the full reproduction over the REGENERATED,
// run-id-stamped live bundle and report which rows now match the live app.
// Measurement only: it asserts the bundle's integrity and that the pipeline
// still commits a full partition, and dumps everything else for the report.

import { describe, it, expect } from 'vitest';
import { writeFileSync, mkdirSync } from 'fs';
import { resolve } from 'path';
import { CORPORA, OUT_ROOT, runProductionPath, tagOf } from './ws1-session-p-pipeline.js';

/** The six tags the STALE-vintage bundle produced (Session P Step 2's own
 *  measurement, `.work-phase4/session-p/step2-report.json`). The convergence
 *  question is which of these survive regeneration. */
const STALE_R11_TAGS = [
  '043_night_migration', '192_scout_listening', '226_four_scouts',
  '232_sudden_halt', '233_firelight_speech', '322_body_readiness',
];

// GENERATOR / MEASUREMENT — NOT part of the default `npm test` sweep.
// Set WS1_SESSION_P_MEASURE=1 to run. Same convention as the Rust
// `#[ignore]`d measurement modules: these write into `.work-phase4/` and take
// minutes, and one of them REWRITES a bundle arm — letting that happen inside
// a plain `npm test` un-stamps the bundle and breaks every consumer, which is
// exactly what it did once before this gate existed.
const MEASURE = process.env.WS1_SESSION_P_MEASURE === '1';

describe.skipIf(!MEASURE)('WS1 Session P — Step 2c convergence on the regenerated bundle', () => {
  it('reports the full reproduction table', async () => {
    const r = await runProductionPath(CORPORA.v6!);
    mkdirSync(OUT_ROOT, { recursive: true });

    const liveTags = r.r11.map(f => f.segmentTag ?? "");
    const started = STALE_R11_TAGS.filter(t => !liveTags.includes(t));
    const appeared = liveTags.filter(t => !STALE_R11_TAGS.includes(t));

    const report = {
      runId: r.runId,
      inputs: {
        whisperTokens: r.whisperTokens.length,
        silences: r.silences.length,
        faTokens: r.faTokens.length,
        chunks: r.chunks.length,
      },
      whisperFilter: r.whisperFilter,
      aborted: r.aborted,
      kept: r.kept,
      skipped: r.skipped,
      fired: r.fired,
      r11: r.r11.map(f => ({
        tag: f.segmentTag, segmentIndex: f.segmentIndex, chunkIndex: f.chunkIndex,
        fit: f.fit, fitDeviation: f.fitDeviation, edge: f.edge,
        committedValue: f.committedValue, correctedValue: f.correctedValue,
        delta: f.delta, spanMaxConfidence: f.spanMaxConfidence,
      })),
      r12: r.r12.map(f => ({ ...f })),
      r13: r.r13.map(f => ({ ...f })),
      r5runs: r.r5runs.map(x => ({ ...x })),
      unspoken: r.unspoken.map(x => ({ ...x })),
      convergence: { staleTags: STALE_R11_TAGS, liveTags, droppedVsStale: started, newVsStale: appeared },
      committed: r.committed.map((s, i) => ({
        i, tag: tagOf(s), id: s.id, startTime: s.startTime, duration: s.duration,
        end: s.startTime + s.duration,
      })),
      preRule: r.preRuleSegments.map((s, i) => ({ i, tag: tagOf(s), startTime: s.startTime })),
      chunkPlan: r.chunks.map((c, i) => ({ i, startSec: c.startSec, endSec: c.endSec, text: c.text })),
    };
    writeFileSync(resolve(OUT_ROOT, 'step2c-report.json'), JSON.stringify(report, null, 2));

    // eslint-disable-next-line no-console
    console.log('[STEP 2c]', JSON.stringify({
      runId: r.runId, inputs: report.inputs, whisperFilter: r.whisperFilter,
      kept: r.kept, skipped: r.skipped, fired: r.fired,
      r11: report.r11.map(f => `${f.tag} ${f.committedValue}->${f.correctedValue}`),
      convergence: report.convergence,
    }, null, 2));

    expect(r.kept + r.skipped).toBe(447);
  }, 900_000);
});
