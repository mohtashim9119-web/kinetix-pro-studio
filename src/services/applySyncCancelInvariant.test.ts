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

const APP_TSX = resolve(import.meta.dirname, '..', 'App.tsx');
const SRC = readFileSync(APP_TSX, 'utf-8');
const LINES = SRC.split('\n');

const ENTRY_MARKER = 'const handleApplySyncFromFiles = async (): Promise<ApplySyncResult> => {';

/** 1-indexed line numbers (to match editor/grep line numbers) of every exact
 *  `needle` occurrence between the entry point's own opening line and the
 *  function's closing `  };`. */
function lineNumbersOf(needle: string): number[] {
  const start = LINES.findIndex(l => l.includes(ENTRY_MARKER));
  expect(start, 'handleApplySyncFromFiles entry marker not found').toBeGreaterThan(-1);
  let end = LINES.length;
  for (let i = start + 1; i < LINES.length; i++) {
    if (LINES[i] === '  };') { end = i; break; }
  }
  const hits: number[] = [];
  for (let i = start; i < end; i++) {
    if (LINES[i]!.includes(needle)) hits.push(i + 1);
  }
  return hits;
}

describe('Group B closeout — handleApplySyncFromFiles cancel-boundary structure', () => {
  it('logSyncAbort — the shared exit every cancel check funnels through — calls ONLY appendSyncLogEntries, never a segment/asset field', () => {
    const start = LINES.findIndex(l => l.includes('const logSyncAbort = (message: string, totalSegments: number): void => {'));
    expect(start, 'logSyncAbort definition not found').toBeGreaterThan(-1);
    let end = start;
    for (let i = start + 1; i < LINES.length; i++) {
      if (LINES[i] === '    };') { end = i; break; }
    }
    const body = LINES.slice(start, end + 1).join('\n');
    expect(body).toContain('appendSyncLogEntries(');
    // The negative half of the proof: no other project field is written here.
    // (`syncLog`/`syncRunSummaries` are appendSyncLogEntries's own — proven
    // reference-preserving for everything else in syncLog.test.ts.)
    expect(body).not.toMatch(/segments\s*:/);
    expect(body).not.toMatch(/\bassets\s*:/);
    expect(body).not.toMatch(/voiceoverId\s*:/);
  });

  it('every plan-v3 item 5 cancel check returns via cancelledResult(...)', () => {
    const staging = lineNumbersOf('if (syncAbortController.signal.aborted) return cancelledResult();');
    expect(staging, 'STAGING boundary check not found at its expected shape').toHaveLength(1);

    const faCancelled = lineNumbersOf("if (faRun.status === 'cancelled') return cancelledResult(newSegmentsRaw.length);");
    expect(faCancelled, 'FA branch\'s own cancelled short-circuit not found').toHaveLength(1);

    // MATCHER and COMMIT share an identical literal
    // (`cancelledResult(newSegmentsRaw.length)` / `cancelledResult(lockRestoredSegments.length)`
    // respectively) — matched by their distinct argument expressions so this
    // assertion can't quietly collapse two checks into one match.
    const matcher = lineNumbersOf('if (syncAbortController.signal.aborted) return cancelledResult(newSegmentsRaw.length);');
    expect(matcher, 'MATCHER boundary check not found').toHaveLength(1);

    const commit = lineNumbersOf('if (syncAbortController.signal.aborted) return cancelledResult(lockRestoredSegments.length);');
    expect(commit, 'COMMIT boundary check not found').toHaveLength(1);

    // Ordering: STAGING, then FA's own cancelled arm, then MATCHER, then
    // COMMIT — each strictly before the next, and (checked in the next case)
    // all strictly before the one real commit.
    expect(staging[0]!).toBeLessThan(faCancelled[0]!);
    expect(faCancelled[0]!).toBeLessThan(matcher[0]!);
    expect(matcher[0]!).toBeLessThan(commit[0]!);
  });

  it('the function contains exactly one segment-committing setProject, and it sits strictly after every cancel check', () => {
    const start = LINES.findIndex(l => l.includes(ENTRY_MARKER));
    let end = LINES.length;
    for (let i = start + 1; i < LINES.length; i++) {
      if (LINES[i] === '  };') { end = i; break; }
    }
    const setProjectLines: number[] = [];
    for (let i = start; i < end; i++) {
      if (/\bsetProject\(/.test(LINES[i]!)) setProjectLines.push(i + 1);
    }
    // Exactly three: logSyncAbort's own (shared by every abort/cancel path),
    // the 'paused' branch's (same appendSyncLogEntries shape, not a cancel
    // path but equally reference-preserving), and the one real commit.
    expect(
      setProjectLines,
      'the number of setProject calls in handleApplySyncFromFiles changed — a ' +
        'new one needs its own cancel-safety argument, not silent coverage by this file',
    ).toHaveLength(3);

    const realCommit = setProjectLines[2]!;
    const commitCheck = lineNumbersOf('if (syncAbortController.signal.aborted) return cancelledResult(lockRestoredSegments.length);')[0]!;
    expect(
      realCommit,
      'the real commit setProject no longer sits after the COMMIT boundary check',
    ).toBeGreaterThan(commitCheck);
  });
});
