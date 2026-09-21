/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// ---------------------------------------------------------------------------
// Phase 2 (Wave 1 hotfix closeout) — the REAL shipped FA-arm chain, driven
// end to end, not a hand-picked subset.
//
// WHY THIS EXISTS. 1fd9c98's bug (FaEvent::Done serializing
// n_fallback_chunks/infeasible_chunks snake_case) went undetected through
// every existing unit test because every one of them either (a) hand-built a
// `FaRunResult` directly, skipping `runForcedAlignmentForSync`'s own IPC
// parsing entirely, or (b) mocked `computeFaChunkPlan`/the IPC layer in a way
// that never exercised a realistic `Done` payload shape. This test starts at
// the ACTUAL entry point (`runForcedAlignmentForSync`) with only the two
// genuine hardware/IPC boundaries stubbed — `@tauri-apps/api/core`'s
// `invoke`/`Channel` (there is no real Tauri backend in a vitest run) and
// `silenceDetector.ts`'s `detectSilences` (no real `AudioContext` in
// jsdom/node) — then feeds the REAL `FaRunResult` that comes back through
// every REAL downstream function `App.tsx`'s `handleApplySyncFromFiles` FA
// arm calls, in the SAME order, citing the exact `App.tsx` lines each call
// mirrors:
//
//   runForcedAlignmentForSync  (forcedAlignmentRun.ts)      App.tsx ~4160
//   buildCtcInfeasibleLogEntry (syncLog.ts, item 6)         App.tsx 4225-4231
//   evaluateCoverageGate       (App.tsx)                    App.tsx 4294-4302
//   applyUnspokenScriptGate    (faUnspokenGate.ts, R.10)    App.tsx 4332
//   detectAndRetimeFaVictims   (faVictimGate.ts)            App.tsx 4347-4355
//   allCoveredSegmentsAreVictims (faVictimGate.ts)          App.tsx 4362
//   buildFaVictimRetimedLogEntry (syncLog.ts)               App.tsx 4396
//   filterToCoveredSegments    (App.tsx)                    App.tsx 4410-4414
//   applyVictimReplacement     (faVictimGate.ts)            App.tsx 4560-4562
//   snapCoveredBoundaries      (snapBoundaries.ts)          App.tsx 4564
//   headExtendFirstSegment     (syncEngine.ts)               App.tsx 4578
//   insertSkippedScenePlaceholders (skippedScenePlaceholders.ts) App.tsx 4743
//   detectAnchorTrustDefects / applyAnchorTrustCorrections  App.tsx 4787-4799
//   stampWhisperProvenance / stampFaProvenance (timingProvenance.ts) App.tsx 4192-4213
//
// SCOPE BOUNDARY (stated, not hidden). Two pieces of this chain are NOT
// driven live: R.11/R.12/R.13 (faSeamFitGate.ts/faRunPlacementGate.ts — this
// fixture's survivors have no unscripted run for them to act on, the same
// "disjoint from this shape" scope `skippedScenePlaceholders.test.ts` already
// draws for the identical corpus) and `alignScenestoTranscript`, the fuzzy
// text/timing matcher `alignFromCache`/R.10 normally derive `coverage`/
// `whisperAlignments` from — a separately and independently tested pure
// function (`whisperService.test.ts` et al.); this test hand-builds its
// OUTPUT (coverage/whisperAlignments) the same way the pre-existing,
// operator-accepted `skippedScenePlaceholders.test.ts` fixture already does,
// rather than re-deriving it. Neither omission is where 1fd9c98's bug lived —
// that bug was specifically in the IPC/serde boundary this test DOES drive
// for real.
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Mock } from 'vitest';

class FakeChannel<T> {
  onmessage: (message: T) => void = () => {};
}

vi.mock('@tauri-apps/api/core', () => {
  class FakeChannelInner<T> {
    onmessage: (message: T) => void = () => {};
  }
  return { Channel: FakeChannelInner, invoke: vi.fn() };
});
vi.mock('./silenceDetector', () => ({
  detectSilences: vi.fn(async () => ({
    status: 'ok',
    // Same three silences skippedScenePlaceholders.test.ts's fixture uses —
    // A sits in S3's reserved gap, B is the long pause before S4, C is the
    // real S4|S5 seam.
    silences: [{ startSec: 2.90, endSec: 3.20 }, { startSec: 3.30, endSec: 4.90 }, { startSec: 6.30, endSec: 6.80 }],
  })),
}));

import { invoke } from '@tauri-apps/api/core';
import { runForcedAlignmentForSync } from './forcedAlignmentRun';
import { buildCtcInfeasibleLogEntry, buildFaVictimRetimedLogEntry } from './syncLog';
import { detectAndRetimeFaVictims, applyVictimReplacement, allCoveredSegmentsAreVictims } from './faVictimGate';
import { applyUnspokenScriptGate, R10_SKIP_REASON } from './faUnspokenGate';
import type { UnspokenScriptFinding } from './faUnspokenGate';
import { filterToCoveredSegments, evaluateCoverageGate } from '../App';
import { snapCoveredBoundaries } from './snapBoundaries';
import { headExtendFirstSegment } from './syncEngine';
import { insertSkippedScenePlaceholders, stampEstimatedWordTimings } from './skippedScenePlaceholders';
import { detectAnchorTrustDefects, applyAnchorTrustCorrections } from './faAnchorTrustGate';
import { stampWhisperProvenance, stampFaProvenance } from './timingProvenance';
import { countTranscriptWords } from './whisperService';
import type { SegmentAlignment } from './whisperService';
import type { SilenceInterval } from './silenceDetector';
import type { Asset, TranscriptToken, VideoSegment } from '../types';
import { TransitionType, AnimationType } from '../types';

const mockInvoke = invoke as unknown as Mock;

const AUDIO_DURATION = 9.0;
const SYNC_RUN_ID = 'test-run';
const SYNC_RUN_AT = 1_700_000_000_000;

const seg = (id: string, text: string, startTime: number, duration: number): VideoSegment => ({
  id, tag: id, text, startTime, duration, anchorStart: startTime,
  transition: TransitionType.NONE, animation: AnimationType.NONE, order: 0,
}) as unknown as VideoSegment;

const tok = (text: string, startSec: number, endSec: number, confidence: number, wordIndex: number, needsReview = false): TranscriptToken =>
  ({ text, startSec, endSec, confidence, wordIndex, needsReview });

const align = (firstTokenIdx: number, lastTokenIdx: number, totalWords: number): SegmentAlignment => ({
  firstTokenIdx, lastTokenIdx, matched: true, confidence: 1, matchedWords: totalWords, totalWords, longestRun: totalWords,
  audioRegion: { startSec: 0, endSec: 0 },
} as unknown as SegmentAlignment);

const SILENCES: SilenceInterval[] = [{ startSec: 2.90, endSec: 3.20 }, { startSec: 3.30, endSec: 4.90 }, { startSec: 6.30, endSec: 6.80 }];

/**
 * Five scripted scenes — the IDENTICAL corpus shape
 * `skippedScenePlaceholders.test.ts` already proved for the S3-skip
 * mechanism (same segment ids/timings/silences), extended with a SIXTH
 * dimension that fixture never carried: S1's FA chunk is CTC-infeasible.
 * Whisper genuinely heard S1 ("Opening title card", 0.00-0.30s, high
 * confidence) — R.10 correctly keeps it — but `fa_onnx.rs`'s
 * `fallback_words_for_infeasible_chunk` auto-filled its FA span with an
 * even, low-confidence, `needsReview: true` spread across the SAME
 * 0.00-0.30s envelope but with the WRONG internal word boundaries. S1 is
 * the item-6/victim segment;
 * S3 stays the R.10-unspoken/placeholder segment, untouched from the prior
 * fixture, so this test can reuse that fixture's already-proven S2-S5
 * boundary numbers as its own control values.
 */
function fixture() {
  // Whisper tokens — the TRUSTED transcript, unfabricated. S1 is genuinely
  // spoken at 0.00-0.30s.
  const whisperTokens: TranscriptToken[] = [
    tok('Opening', 0.00, 0.12, 0.9, 0), tok('title', 0.12, 0.22, 0.9, 1), tok('card', 0.22, 0.30, 0.9, 2),
    tok('we', 0.31, 0.60, 0.03, 3), tok('begin', 0.60, 1.20, 0.03, 4), tok('our', 1.20, 1.80, 0.03, 5),
    tok('story', 1.80, 2.40, 0.03, 6), tok('now', 2.40, 2.90, 0.03, 7),
    tok('never', 3.20, 3.22, 1e-4, 8), tok('spoken', 3.22, 3.24, 1e-4, 9),
    tok('phantom', 3.24, 3.26, 1e-4, 10), tok('text', 3.26, 3.28, 1e-4, 11),
    tok('the', 5.00, 5.20, 0.9, 12), tok('story', 5.20, 5.50, 0.9, 13),
    tok('continues', 5.50, 6.00, 0.9, 14), tok('here', 6.00, 6.30, 0.9, 15),
    tok('and', 6.80, 7.00, 0.9, 16), tok('finally', 7.00, 7.40, 0.9, 17),
    tok('we', 7.40, 7.60, 0.9, 18), tok('end', 7.60, 8.00, 0.9, 19),
  ];
  // FA committed tokens (what the mocked `Done` event returns, reshaped by
  // `faWordSpansToTranscriptTokens`): identical to Whisper's for every
  // segment EXCEPT S1 (indices 0-2), which carries `fallback_words_for_
  // infeasible_chunk`'s fabrication — an even split across the SAME outer
  // envelope (0.00-0.30s) the true words occupy (a CTC chunk is scene-
  // bounded, never bleeding into the next scene), but with the wrong
  // INTERNAL word boundaries, confidence 0, and needsReview true. This is
  // what makes the segment-level partition stable (S2 must never overlap
  // S1's infeasible chunk) while still proving the victim gate replaces the
  // WORD-level fabrication — see the "carries WHISPER-SPACE timings" test.
  const faTokens: TranscriptToken[] = whisperTokens.map(t => ({ ...t }));
  faTokens[0] = tok('Opening', 0.00, 0.10, 0, 0, true);
  faTokens[1] = tok('title', 0.10, 0.20, 0, 1, true);
  faTokens[2] = tok('card', 0.20, 0.30, 0, 2, true);

  const segments: VideoSegment[] = [
    seg('s1', 'Opening title card', 0.00, 0.30),
    seg('s2', 'we begin our story now', 0.30, 2.90),
    seg('s3', 'never spoken phantom text', 3.20, 1.80),
    seg('s4', 'the story continues here', 5.00, 1.80),
    seg('s5', 'and finally we end', 6.80, 2.20),
  ];
  // FA-space coverage — every scene "matches" by construction, same indices
  // whichever token array (whisper or FA) is in play (fabrication only
  // changes VALUES at these positions, never count/order).
  const coverage: SegmentAlignment[] = [align(0, 2, 3), align(3, 7, 5), align(8, 11, 4), align(12, 15, 4), align(16, 19, 4)];
  // Whisper-space alignment for S1 only — the victim gate's own trusted
  // evidence (faVictimGate.ts only reads this for a segment that already
  // passed the coverage+infeasible-overlap filter, i.e. S1). Bypasses
  // `alignScenestoTranscript` itself — see the module doc comment's scope
  // boundary.
  const whisperAlignments: SegmentAlignment[] = [align(0, 2, 3)];
  const unspoken: UnspokenScriptFinding[] = [
    { segmentIndex: 2, segmentId: 's3', segmentTag: 's3', maxWordConfidence: 1e-4, faWordCount: 4 },
  ];
  return { whisperTokens, faTokens, segments, coverage, whisperAlignments, unspoken };
}

function makeAsset(): Asset {
  return {
    id: 'vo1', name: 'voiceover.wav', url: 'blob:voiceover', type: 'audio',
    file: new File([new Uint8Array([1, 2, 3, 4])], 'voiceover.wav', { type: 'audio/wav' }),
  };
}

const FAKE_STAGED_PATH = '/fake-staging-dir/kinetix-fa-production-inputs/deadbeef.wav';

/** Wires the mocked IPC boundary to a realistic `Done` payload — camelCase
 *  keys, exactly the wire shape `fa.rs`'s now-fixed `#[serde(rename_all_
 *  fields = "camelCase")]` produces (this is the wire shape 1fd9c98 fixed).
 *  `infeasibleChunks: []` (the control run) omits `nFallbackChunks`/
 *  `infeasibleChunks` entirely, mirroring `skip_serializing_if` on the real
 *  struct — `runForcedAlignmentForSync`'s own `?? []`/`?? 0` defaulting is
 *  what's under test on that path. */
function mockFaRun(faTokens: readonly TranscriptToken[], infeasibleChunks: readonly { chunkIndex: number; startSec: number; endSec: number; wordCount: number }[]): void {
  mockInvoke.mockImplementation(async (cmd: string, args?: { onEvent: FakeChannel<unknown> }) => {
    if (cmd === 'fa_stage_audio_raw') return FAKE_STAGED_PATH;
    if (cmd === 'fa_align_production') {
      const words = faTokens.map(t => ({
        word: t.text, startSec: t.startSec, endSec: t.endSec,
        confidence: t.confidence ?? 0, needsReview: t.needsReview ?? false, wordIndex: t.wordIndex,
      }));
      const data = infeasibleChunks.length > 0
        ? { words, nFallbackChunks: infeasibleChunks.length, infeasibleChunks }
        : { words };
      (args!.onEvent as unknown as FakeChannel<unknown>).onmessage({ event: 'Done', data });
      return;
    }
    throw new Error(`unexpected invoke: ${cmd}`);
  });
}

/** App.tsx's FA-arm stage order, from the real FA run through R.14/R.15 and
 *  provenance — see the module doc comment's line-cited table. `victim:
 *  false` runs the identical pipeline against a HEALTHY (non-fabricated) S1
 *  and no infeasible chunk — the control this test's "neighbours unchanged"
 *  assertion needs. */
async function runPipeline(opts: { victim: boolean }) {
  const f = fixture();
  if (opts.victim) {
    mockFaRun(f.faTokens, [{ chunkIndex: 0, startSec: 0.00, endSec: 0.30, wordCount: 3 }]);
  } else {
    // Control: S1's FA tokens are the TRUSTED (non-fabricated) values, and
    // the run has no infeasible chunk at all.
    const healthyTokens = f.faTokens.map((t, i) => (i <= 2 ? { ...f.whisperTokens[i]! } : t));
    mockFaRun(healthyTokens, []);
  }

  // App.tsx ~4160 — the real entry point, real IPC parsing.
  const faRun = await runForcedAlignmentForSync(makeAsset(), f.segments, f.whisperTokens, AUDIO_DURATION, 'en');
  if (faRun.status !== 'degraded' && faRun.status !== 'ok') {
    throw new Error(`test setup produced an unexpected FaRunResult: ${JSON.stringify(faRun)}`);
  }
  const faTokensCommitted = faRun.tokens;

  // App.tsx 4225-4231 — item 6's grouped finding, built off the RAW (pre-
  // victim-replacement) FA result tokens, exactly like App.tsx does.
  const infeasibleChunks = faRun.status === 'degraded' && faRun.reason === 'ctc-infeasible-chunk' ? (faRun.infeasibleChunks ?? []) : [];
  const item6Entry = buildCtcInfeasibleLogEntry(SYNC_RUN_ID, faTokensCommitted, infeasibleChunks, SYNC_RUN_AT);

  // App.tsx 4192-4213 — provenance, stamped off the SAME faRun discriminant
  // App.tsx branches on.
  const transcriptionDegraded = faRun.status === 'degraded' && faRun.reason !== 'ctc-infeasible-chunk'
    ? { kind: 'gate-closed' as const } : undefined;
  const transcription = stampWhisperProvenance({ language: 'en', completedAt: SYNC_RUN_AT, degraded: transcriptionDegraded });
  const alignment = faRun.status === 'ok'
    ? stampFaProvenance({ language: 'en', completedAt: SYNC_RUN_AT })
    : faRun.status === 'degraded' && faRun.reason === 'ctc-infeasible-chunk'
      ? stampFaProvenance({ language: 'en', completedAt: SYNC_RUN_AT, degraded: { kind: 'fa-chunk-infeasible' } })
      : undefined;

  // App.tsx 4294-4302 — the coverage gate, on the PRE-R.10 coverage.
  const totalTranscriptWords = countTranscriptWords(f.whisperTokens, 'en');
  const gate = evaluateCoverageGate(f.segments, f.coverage, totalTranscriptWords);

  // App.tsx 4332 — R.10 (hand-fed finding, see module doc comment's scope
  // boundary — same precedent skippedScenePlaceholders.test.ts sets).
  const coverageAfterR10 = applyUnspokenScriptGate(f.coverage, f.unspoken);
  const unspokenIndices = new Set(f.unspoken.map(u => u.segmentIndex));

  // App.tsx 4347-4355 — the victim gate, against the REAL faRun's infeasible
  // chunks and the REAL committed FA token array.
  const faVictims = detectAndRetimeFaVictims(
    f.segments, coverageAfterR10, faTokensCommitted, infeasibleChunks,
    f.whisperAlignments, f.whisperTokens, unspokenIndices,
  );
  const runLevelPause = allCoveredSegmentsAreVictims(coverageAfterR10, faVictims.candidates);
  const victimEntry = buildFaVictimRetimedLogEntry(SYNC_RUN_ID, faVictims.retimed, SYNC_RUN_AT);

  // App.tsx 4410-4414, 4560-4562 — skip filter, then victim replacement
  // applied to the committed token array BEFORE snap (App.tsx's own
  // ordering — see forcedAlignmentRun.ts's module doc comment on why).
  const { kept, skipped, keptAlignments } = filterToCoveredSegments(f.segments, coverageAfterR10, unspokenIndices);
  const transcriptTokens = applyVictimReplacement(faTokensCommitted, faVictims.replacement, faVictims.replacementByWordIndex);

  // App.tsx 4564, 4578 — snap, then head-extend.
  let committed = snapCoveredBoundaries(kept, keptAlignments, transcriptTokens, SILENCES, AUDIO_DURATION);
  committed = headExtendFirstSegment(committed);

  // App.tsx 4743 — skipped-scene placeholders (S3).
  const skippedIndices = new Set(skipped.map(r => r.segmentIndex));
  const insertion = insertSkippedScenePlaceholders(
    committed, keptAlignments, f.segments, skippedIndices, coverageAfterR10, transcriptTokens, AUDIO_DURATION,
  );
  committed = insertion.segments;
  const placeholderAlignments = insertion.alignments;

  // App.tsx 4787-4799 — R.14/R.15, the anchor-trust gate, LAST in the stage.
  const anchorTrustFindings = detectAnchorTrustDefects(committed, placeholderAlignments, transcriptTokens, SILENCES);
  committed = applyAnchorTrustCorrections(committed, anchorTrustFindings);

  const faWordTimings = faVictims.retimed.length > 0
    ? stampEstimatedWordTimings(transcriptTokens, insertion.placeholders, f.coverage, transcriptTokens)
    : transcriptTokens;

  return {
    faRun, item6Entry, transcription, alignment, gate, faVictims, runLevelPause, victimEntry,
    committed, anchorTrustFindings, faWordTimings, placeholders: insertion.placeholders,
  };
}

beforeEach(() => {
  mockInvoke.mockReset();
});

const byId = (arr: readonly VideoSegment[], id: string) => arr.find(s => s.id === id)!;
const endOf = (s: VideoSegment) => Number((s.startTime + s.duration).toFixed(3));

describe('the real shipped FA-arm chain — a CTC-infeasible chunk on a genuinely-spoken segment', () => {
  it('runForcedAlignmentForSync classifies the real (camelCase, wire-shaped) Done payload as degraded/ctc-infeasible-chunk, never a clean ok', async () => {
    const run = await runPipeline({ victim: true });
    expect(run.faRun.status).toBe('degraded');
    expect(run.faRun.status === 'degraded' && run.faRun.reason).toBe('ctc-infeasible-chunk');
    expect(run.faRun.status === 'degraded' && run.faRun.nFallbackChunks).toBe(1);
    expect(run.faRun.status === 'degraded' && run.faRun.infeasibleChunks).toEqual([
      { chunkIndex: 0, startSec: 0.00, endSec: 0.30, wordCount: 3 },
    ]);
  });

  it('item 6 — the grouped CTC-infeasible-chunk finding fires, naming the fabricated span and word count', async () => {
    const run = await runPipeline({ victim: true });
    expect(run.item6Entry).toBeDefined();
    expect(run.item6Entry!.type).toBe('warning');
    expect(run.item6Entry!.message).toContain('1 alignment chunk (0.00–0.30s)');
    expect(run.item6Entry!.message).toContain('3 words marked Estimated');
  });

  it('the coverage gate is never tripped by this run — real speech, just a fabricated span', async () => {
    const run = await runPipeline({ victim: true });
    expect(run.gate.aborted).toBe(false);
  });

  it('the victim finding fires with exactly S1 — the run-level pause never fires (S2/S4/S5 are healthy)', async () => {
    const run = await runPipeline({ victim: true });
    expect(run.faVictims.candidates).toEqual([{ segmentIndex: 0, segmentId: 's1', segmentTag: 's1' }]);
    expect(run.faVictims.retimed).toHaveLength(1);
    expect(run.faVictims.retimed[0]!.segmentId).toBe('s1');
    expect(run.runLevelPause).toBe(false);
    expect(run.victimEntry).toBeDefined();
    expect(run.victimEntry!.message).toContain('1 scene (s1) re-timed from Whisper alignment');
  });

  it('the victim carries WHISPER-SPACE per-word timings (0.12/0.22/0.30, not the fabricated even 0.10 split) and every replaced word is needsReview', async () => {
    const run = await runPipeline({ victim: true });
    const v = run.faVictims.retimed[0]!;
    expect(v.trustedStartSec).toBe(0.00);
    expect(v.trustedEndSec).toBe(0.30);
    expect(v.estimatedWordCount).toBe(3);
    const s1Words = run.faWordTimings.filter(t => t.wordIndex! <= 2);
    expect(s1Words).toHaveLength(3);
    for (const w of s1Words) expect(w.needsReview).toBe(true);
    expect(s1Words[0]!.startSec).toBe(0.00);
    expect(s1Words[2]!.endSec).toBe(0.30);
  });

  it('S1 commits at the same boundary the control (healthy S1) run produces — victim replacement fixes the WORDS, not the already-correct segment envelope', async () => {
    const withVictim = await runPipeline({ victim: true });
    const control = await runPipeline({ victim: false });
    const s1 = byId(withVictim.committed, 's1');
    expect(s1.startTime).toBe(0);
    // snapCoveredBoundaries snaps the S1|S2 seam to the midpoint of S1's
    // last spoken word (0.30) and S2's first (0.31) — 0.305, the same
    // number skippedScenePlaceholders.test.ts's identical fixture asserts.
    expect(endOf(s1)).toBe(0.305);
    expect(endOf(s1)).toBe(endOf(byId(control.committed, 's1')));
  });

  it('S3 (the unrelated R.10-skipped scene) still gets its Estimated placeholder clamped exactly [S2.end, S4.start]', async () => {
    const run = await runPipeline({ victim: true });
    expect(run.committed.map(s => s.id)).toEqual(['s1', 's2', 's3', 's4', 's5']);
    const s2 = byId(run.committed, 's2');
    const s3 = byId(run.committed, 's3');
    const s4 = byId(run.committed, 's4');
    expect(s3.startTime).toBe(endOf(s2));
    expect(endOf(s3)).toBe(s4.startTime);
    expect(s3.startTime).toBe(2.9);
    expect(endOf(s3)).toBe(5.0);
    expect(s3.anchorSource).toBe('estimate');
  });

  it('no R.14/R.15 line — the anchor-trust gate does not fire on this run', async () => {
    const run = await runPipeline({ victim: true });
    expect(run.anchorTrustFindings).toEqual([]);
  });

  it("neighbours' committed bounds are byte-identical to the control (no victim, healthy S1) run", async () => {
    const withVictim = await runPipeline({ victim: true });
    const control = await runPipeline({ victim: false });
    expect(control.faRun.status).toBe('ok');
    expect(control.faVictims.retimed).toEqual([]);
    for (const id of ['s1', 's2', 's3', 's4', 's5']) {
      expect(byId(withVictim.committed, id).startTime).toBe(byId(control.committed, id).startTime);
      expect(endOf(byId(withVictim.committed, id))).toBe(endOf(byId(control.committed, id)));
    }
  });

  it('alignment provenance is stamped degraded kind fa-chunk-infeasible; transcription provenance is not', async () => {
    const run = await runPipeline({ victim: true });
    expect(run.alignment).toBeDefined();
    expect(run.alignment!.engine).toBe('fa');
    expect(run.alignment!.degraded).toEqual({ kind: 'fa-chunk-infeasible' });
    expect(run.transcription.degraded).toBeUndefined();
  });

  it("the S3 skip's own reason is unaffected by the unrelated S1 victim — R.10 fired for the reason it always fires for", async () => {
    const run = await runPipeline({ victim: true });
    const s3Placeholder = run.placeholders.find(p => p.segmentId === 's3');
    expect(s3Placeholder).toBeDefined();
    expect(s3Placeholder!.segmentIndex).toBe(2);
  });
});

describe('control — a clean run with no infeasible chunk produces none of the item-6/victim machinery', () => {
  it('no item-6 finding, no victim candidates, ok status', async () => {
    const run = await runPipeline({ victim: false });
    expect(run.faRun.status).toBe('ok');
    expect(run.item6Entry).toBeUndefined();
    expect(run.faVictims.candidates).toEqual([]);
    expect(run.victimEntry).toBeUndefined();
    expect(run.alignment?.degraded).toBeUndefined();
  });
});

// Keeps R10_SKIP_REASON's import from going unused if the assertions above
// are ever trimmed — this module re-exercises the exact reason string
// `filterToCoveredSegments` records for S3, matching
// `skippedScenePlaceholders.test.ts`'s own check.
void R10_SKIP_REASON;
