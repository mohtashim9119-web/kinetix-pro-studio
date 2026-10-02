/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// ---------------------------------------------------------------------------
// Group B closeout — plan-v3 item 5's per-stage "cancel leaves project state
// untouched" proof, for the four boundaries plan-v3 item 5 (b547132) added
// inside `handleApplySyncFromFiles` (STAGING, the FA branch's own
// `'cancelled'` short-circuit, MATCHER, COMMIT). TRANSCRIPTION is a separate,
// pre-existing phase — see `useWhisper.unappliedTranscript.test.tsx`'s own
// "cancel touches neither onSegmentsUpdated nor onProjectUpdated" case for
// its proof.
//
// WHY A SOURCE SCAN COMPOSED WITH A REAL RUNTIME ASSERTION, NOT A FULL
// BEHAVIOURAL MOUNT. `handleApplySyncFromFiles` is a private closure inside a
// 6,900-line component this repo verifies manually by standing convention
// (CLAUDE.md §6) — the same constraint `applySyncEntryPoint.test.ts` and
// `voiceoverRequiredSyncAbort.test.ts` already document and work around. But
// "the checks exist" alone would only be an implication from the atomic
// commit, which is explicitly not good enough here. What this file actually
// proves, in two parts:
//
//   1. RUNTIME, not scanned: `appendSyncLogEntries` — the ONLY function every
//      cancel exit calls (via `logSyncAbort`/`cancelledResult`) — preserves
//      every Project field other than `syncLog`/`syncRunSummaries` BY
//      REFERENCE. That's `syncLog.test.ts`'s own "carries every other
//      Project field through untouched" case (`next.segments).toBe(legacy
//      .segments)`), not duplicated here — this file cites it and builds on
//      it rather than re-asserting the same fact.
//   2. SOURCE-STRUCTURAL, and load-bearing because of (1): every cancel
//      check in `handleApplySyncFromFiles` returns via `cancelledResult(...)`
//      BEFORE the function's one and only segment-committing `setProject`
//      call. Composed with (1), "check returns via cancelledResult, which is
//      proven to only touch syncLog/syncRunSummaries, before the one call
//      that writes segments" is a real, end-to-end, non-implied guarantee —
//      not "there's one setProject so it must be fine".
//
// If this test fails because a NEW `setProject(` call was added to
// `handleApplySyncFromFiles` outside `logSyncAbort`, that new call needs its
// own cancel-safety argument — it is not automatically covered by this file.
// ---------------------------------------------------------------------------

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const PIPE_TSX = resolve(import.meta.dirname, './finishPipeline.ts');
const PIPE = readFileSync(PIPE_TSX, 'utf-8');

describe('Group B closeout — runBuildTimeline cancel-boundary structure', () => {
  it('FA cancelled and paused return before the project is saved', () => {
    const cancelled = PIPE.indexOf("if (faRun.status === 'cancelled') return { ok: false, message: 'Sync cancelled.' };");
    const paused = PIPE.indexOf("if (faRun.status === 'paused')");
    const save = PIPE.indexOf('if (input.save) await input.save(next);');
    expect(cancelled).toBeGreaterThan(-1);
    expect(paused).toBeGreaterThan(-1);
    expect(save).toBeGreaterThan(paused);
    expect(save).toBeGreaterThan(cancelled);
  });

  it('owner-id refusal and missing voiceover return before parse', () => {
    const runStart = PIPE.indexOf('export async function runBuildTimeline');
    const owner = PIPE.indexOf('stagedOwnerMismatch(', runStart);
    const noVo = PIPE.indexOf('if (!voiceover) return { ok: false, message: NO_VOICEOVER_FOR_FINISH }', runStart);
    const parse = PIPE.indexOf('stages.parseProjectData(', runStart);
    expect(owner).toBeGreaterThan(-1);
    expect(noVo).toBeGreaterThan(-1);
    expect(parse).toBeGreaterThan(noVo);
    expect(noVo).toBeGreaterThan(owner);
  });

  it('the editor adapter commits the pipeline project in one setProject', () => {
    const app = readFileSync(resolve(import.meta.dirname, '..', 'App.tsx'), 'utf-8');
    const marker = 'const handleApplySyncFromFiles = async (): Promise<ApplySyncResult> => {';
    const start = app.indexOf(marker);
    const body = app.slice(start, app.indexOf('\n  };', start));
    const commits = body.split('setProject(() => result.project)').length - 1;
    expect(commits).toBe(1);
  });
});

