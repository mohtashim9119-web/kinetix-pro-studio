/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// ---------------------------------------------------------------------------
// WS1 Session W — STEP 1. PRE-FIX CAPTURE OF 173 (CAPTURE ONLY).
//
// WHY. The operator's live sync of 173 on 2026-08-21 (project "FINAL TEST
// 173", syncRunId 59b1a1a8-4657-47ce-bd80-90208c4768ad) surfaced what sounds
// like a wrong cut at the segment 6-7 boundary. Before anyone chases it,
// this file freezes a run-id-stamped derivation of the CURRENT production
// rule stage over 173 — same discipline as `ws1-session-v-bundle.test.ts`,
// same `runProductionPath` (App.tsx's own order), same R-AO rule (one run id
// across every arm this pass writes).
//
// INPUT ARMS — NOT regenerated here, per R-AO precedent. They are read from
// the already-stamped, already-verified live-fidelity bundle at
// `.work-phase4/replay/173` (runId p-20260819T133910Z-5bf038bb,
// `verifyBundle` enforced at load by `loadLiveBundle`). Those arms —
// `silences_native.json` (native 48kHz left-channel), `whisper_raw_tokens.json`
// (raw whisper.cpp output), `fa_live_words.json` (the Rust ONNX engine,
// `fa_onnx::align_chunked` via `fa::fa_align` — filename convention shared
// with the v6 bundle's own `fa_live_*` arms, as opposed to the retired
// `fa_production_*`/Python-arm captures) — were checked against the LIVE
// project's own transcoded audio before this file was written: the replay
// bundle's `audio_16k.wav` is byte-for-byte sha256-identical
// (c6150bcf51…) to the durable FA audio cache entry the live 2026-08-21 sync
// itself produced, and to `lastTranscribedFileIdentity`
// ("voiceover.m4a|17151452|1784183884000") recorded in the live project.
// Same source audio, so this bundle's inputs are a valid stand-in for a
// fresh capture — but they were not literally re-run against the ONNX
// runtime just now. Session W's own report states this explicitly rather
// than letting the run-id stamp imply otherwise.
//
// WHAT IS freshly derived here, every time, through the real rule stage at
// current HEAD: parsed/anchor-timed segments, the chunk plan, the R.5 runs,
// and the COMMITTED BOUNDARIES for all 173 segments — not just a named
// subset (Session V closed 7 named rows; Session W captures every row,
// capture-only, no rows closed).
//
// GENERATOR — gated off the default sweep. Run:
//   WS1_SESSION_W_MEASURE=1 npx vitest run scripts/ws1-session-w-bundle.test.ts
// ---------------------------------------------------------------------------

import { describe, it, expect } from 'vitest';
import { writeFileSync, mkdirSync } from 'fs';
import { resolve } from 'path';
import { createHash } from 'crypto';

import { CORPORA, runProductionPath, tagOf, REPO } from './ws1-session-p-pipeline.js';
import { mintRunId } from './ws1-runid.js';
import { acousticRunExtent } from '../src/services/faRunPlacementGate';
import { canonicalize } from '../src/services/textNormalize';
import type { TranscriptToken, VideoSegment } from '../src/types';

interface NearestSilence {
  startSec: number; endSec: number; midpoint: number; distance: number;
}

function nearestSilence(t: number, silences: Array<{ startSec: number; endSec: number }>): NearestSilence | null {
  let best: NearestSilence | null = null;
  for (const s of silences) {
    const mid = (s.startSec + s.endSec) / 2;
    const dist = t >= s.startSec && t <= s.endSec ? 0 : Math.min(Math.abs(t - s.startSec), Math.abs(t - s.endSec));
    if (!best || dist < best.distance) best = { startSec: s.startSec, endSec: s.endSec, midpoint: mid, distance: dist };
  }
  return best;
}

function textOf(s: VideoSegment): string {
  return (s as unknown as { text?: string }).text ?? '';
}

function wordsInRange(tokens: TranscriptToken[], start: number, end: number): TranscriptToken[] {
  return tokens.filter(t => t.startSec >= start && t.startSec < end).sort((a, b) => a.startSec - b.startSec);
}

const MEASURE = process.env.WS1_SESSION_W_MEASURE === '1';
const CORPUS = '173';

const sha = (s: string): string => createHash('sha256').update(s).digest('hex');

describe.runIf(MEASURE)('WS1 Session W — Step 1, the pre-fix capture bundle', () => {
  it('derives and stamps a fresh 173 bundle from the production path (capture only)', async () => {
    const spec = CORPORA[CORPUS];
    expect(spec, `unknown corpus ${CORPUS}`).toBeDefined();
    const run = await runProductionPath(spec!);

    const runId = mintRunId().replace(/^p-/, 'w-');
    const outDir = resolve(REPO, '.work-phase4/session-w', runId);
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
      whisperFilter: run.whisperFilter,
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
      session: 'WS1 Session W (capture only, no fixes, no rows closed)',
      inputRunId: run.runId ?? null,
      inputBundleDir: '.work-phase4/replay/173',
      audioDuration: spec!.audioDuration,
      fired: run.fired,
      kept: run.kept,
      skipped: run.skipped,
      aborted: run.aborted,
      arms: manifestArms,
    };
    writeFileSync(resolve(outDir, 'run_manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);

    // eslint-disable-next-line no-console
    console.log(`\n[session-w] bundle runId   = ${runId}`);
    // eslint-disable-next-line no-console
    console.log(`[session-w] input  runId   = ${run.runId}`);
    // eslint-disable-next-line no-console
    console.log(`[session-w] outDir         = ${outDir}`);
    // eslint-disable-next-line no-console
    console.log(`[session-w] fired          = ${JSON.stringify(run.fired)} kept=${run.kept} skipped=${run.skipped} aborted=${run.aborted}`);
    for (const [n, a] of Object.entries(manifestArms)) {
      // eslint-disable-next-line no-console
      console.log(`[session-w]   ${n.padEnd(20)} count=${String(a.count).padStart(5)}  sha=${a.sha256.slice(0, 12)}…`);
    }

    // ---- Boundaries around the operator's reported 6-7 seam (index 4..8, 0-based) ----
    // eslint-disable-next-line no-console
    console.log(`\n[session-w] ---- committed boundaries, segments 5-9 (1-based) ----`);
    for (let i = 4; i <= 8 && i < run.committed.length; i++) {
      const s = run.committed[i]!;
      // eslint-disable-next-line no-console
      console.log(`[session-w] idx=${i} (segment ${i + 1}) tag=${tagOf(s)} start=${s.startTime.toFixed(5)} dur=${s.duration.toFixed(5)} end=${(s.startTime + s.duration).toFixed(5)}`);
    }

    // ---- STEP 4: full pre-fix reference sheet, one row per boundary ----
    // Boundary i sits at committed[i].startTime (i=1..172); boundary 0 is the
    // recording's own start (0.00), not a real cut.
    const refRows: string[] = ['boundaryIndex,segmentAfter1Based,tag,committedValue,nearestSilenceStart,nearestSilenceEnd,nearestSilenceMidpoint,distanceToSilence,lastWordEndBefore,firstWordStartAfter,onNonSilence,matchedWords,totalWords,confidencePct'];
    for (let i = 0; i < run.committed.length; i++) {
      const s = run.committed[i]!;
      const t = s.startTime;
      const near = nearestSilence(t, run.silences);
      const before = run.whisperTokens.filter(w => w.endSec <= t).sort((a, b) => b.endSec - a.endSec)[0];
      const after = run.whisperTokens.filter(w => w.startSec >= t).sort((a, b) => a.startSec - b.startSec)[0];
      const onNonSilence = !near || near.distance > 0.02;
      const align = run.keptAlignments[i];
      const totalWords = align?.totalWords ?? -1;
      const matchedWords = align?.matchedWords ?? -1;
      const confPct = totalWords > 0 ? ((matchedWords / totalWords) * 100).toFixed(1) : 'n/a';
      refRows.push([
        i, i + 1, tagOf(s), t.toFixed(5),
        near ? near.startSec.toFixed(3) : '', near ? near.endSec.toFixed(3) : '', near ? near.midpoint.toFixed(3) : '',
        near ? near.distance.toFixed(3) : '',
        before ? before.endSec.toFixed(3) : '', after ? after.startSec.toFixed(3) : '',
        onNonSilence ? 'yes' : 'no',
        matchedWords, totalWords, confPct,
      ].join(','));
    }
    writeFileSync(resolve(outDir, 'reference-sheet.csv'), `${refRows.join('\n')}\n`);
    // eslint-disable-next-line no-console
    console.log(`[session-w] reference-sheet.csv written (${run.committed.length} rows)`);

    // ---- STEP 5: attribution dump for boundaries 5-6, 6-7, 7-8 (1-based) ----
    const boundaries: Array<[number, number]> = [[4, 5], [5, 6], [6, 7]];
    const seamDump: unknown[] = [];
    for (const [li, ri] of boundaries) {
      const left = run.committed[li]!;
      const right = run.committed[ri]!;
      const leftWords = wordsInRange(run.usableFaTokens, left.startTime, left.startTime + left.duration).slice(-4);
      const rightWords = wordsInRange(run.usableFaTokens, right.startTime, right.startTime + right.duration).slice(0, 4);
      const leftScriptTokens = new Set(canonicalize(textOf(left)));
      const rightScriptTokens = new Set(canonicalize(textOf(right)));
      const annotate = (w: TranscriptToken, ownerTokens: Set<string>) => {
        const norm = canonicalize(w.text);
        const inOwnerScript = norm.some(t => ownerTokens.has(t));
        return { text: w.text, startSec: w.startSec, endSec: w.endSec, confidence: w.confidence ?? null, inOwnerScript };
      };
      seamDump.push({
        boundary: `${li + 1}-${ri + 1}`,
        leftTag: tagOf(left), rightTag: tagOf(right),
        leftText: textOf(left), rightText: textOf(right),
        committedBoundaryValue: right.startTime,
        lastFourLeft: leftWords.map(w => annotate(w, leftScriptTokens)),
        firstFourRight: rightWords.map(w => annotate(w, rightScriptTokens)),
      });
    }
    writeFileSync(resolve(outDir, 'seam-attribution.json'), `${JSON.stringify({ _runId: runId, seams: seamDump }, null, 2)}\n`);
    // eslint-disable-next-line no-console
    console.log(`[session-w] seam-attribution.json written (${seamDump.length} boundaries)`);
    // eslint-disable-next-line no-console
    console.log(JSON.stringify(seamDump, null, 2));

    expect(run.committed.length).toBeGreaterThan(0);
  }, 600_000);
});
