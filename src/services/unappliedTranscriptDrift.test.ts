/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// ---------------------------------------------------------------------------
// WS2 T4.7 Requirement 5 — unapplied-transcript default drift guard.
//
// WHAT IS BEING PROTECTED: the ABSENCE of `unappliedTranscript` on a brand-new
// project (`App.tsx`'s `makeDefaultProject`), and the absence of any
// auto-apply on the recovery path. Both are absences, and an absence cannot be
// protected by a comment — the edit that breaks it looks like tidying, and
// nothing executable objects. Same argument, same shape, and deliberately the
// same source-scan technique as `languageDefaultDrift.test.ts`.
//
// WHY THE DEFAULT MATTERS. The recovery banner is a plain derived render off
// this field. Seeding it at creation — even as `undefined`-ish placeholder
// scaffolding that later gets an object — makes every brand-new project open
// with a banner offering to apply a transcript that does not exist, and the
// only two ways to remove that banner are "apply" (which would abort) and
// "discard" (which would look, to the user, like the app lost something).
//
// WHY AUTO-APPLY MATTERS. Requirement 3 is "always ask; never auto-apply." The
// tempting shortcut is an effect on mount that applies a record silently
// because "the user obviously wanted it applied — they ran the transcription."
// They ran the transcription; they did not choose to rewrite this timeline
// right now, and an Apply Sync is a whole-timeline rewrite.
//
// IF THIS TEST FAILS: do not add the field to the default project and do not
// relax the scan.
// ---------------------------------------------------------------------------

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';

const HERE = dirname(fileURLToPath(import.meta.url));
const APP_TSX = resolve(HERE, '..', 'App.tsx');

/** The body of `makeDefaultProject`, from its signature to the first column-0
 *  `}` that closes it. A source scan and not a call, for the same reason
 *  `languageDefaultDrift.test.ts` gives: the function is module-private to
 *  `App.tsx`, and importing `App` drags in the whole component tree for a
 *  one-key assertion. */
function makeDefaultProjectBody(): string {
  const src = readFileSync(APP_TSX, 'utf-8');
  const marker = 'function makeDefaultProject(): Project {';
  const start = src.indexOf(marker);
  expect(start, `'${marker}' not found in App.tsx — this guard has lost its target`).toBeGreaterThan(-1);
  const rest = src.slice(start + marker.length);
  const end = rest.indexOf('\n}');
  expect(end, 'could not find the closing brace of makeDefaultProject').toBeGreaterThan(-1);
  return rest.slice(0, end);
}

describe('WS2 T4.7 — a new project must carry NO unappliedTranscript field', () => {
  it('makeDefaultProject sets no `unappliedTranscript` key', () => {
    const offenders = makeDefaultProjectBody()
      .split('\n')
      .filter(line => /^\s*'?unappliedTranscript'?\s*:/.test(line));
    expect(
      offenders,
      'makeDefaultProject must not seed `unappliedTranscript` — the recovery banner is a ' +
        'plain derived render off this field, so a seeded key makes every new project open ' +
        'offering to apply a transcript that does not exist. See the header of this file.',
    ).toEqual([]);
  });
});

describe('WS2 T4.7 — the recovery path must never auto-apply', () => {
  const APP_SRC = readFileSync(APP_TSX, 'utf-8');

  it('the only caller of handleApplyUnappliedTranscript is the banner’s onApply prop', () => {
    // An auto-apply would show up as a second reference — most plausibly
    // inside a `useEffect`. Counting references is the check that survives
    // whatever shape such an effect took.
    const refs = APP_SRC.split('\n').filter(l => l.includes('handleApplyUnappliedTranscript'));
    // Exactly two: the `const handleApplyUnappliedTranscript = ...` definition
    // and the `onApply={...}` prop.
    const definition = refs.filter(l => /const handleApplyUnappliedTranscript/.test(l));
    const propUse = refs.filter(l => /onApply=\{handleApplyUnappliedTranscript\}/.test(l));
    expect(definition).toHaveLength(1);
    expect(propUse).toHaveLength(1);
    expect(
      refs,
      'handleApplyUnappliedTranscript gained a caller beyond the banner’s own button. ' +
        'Requirement 3 is "always ask; never auto-apply".',
    ).toHaveLength(2);
  });

  it('restoreUnappliedTranscriptTokens is never called outside the user-initiated apply handler', () => {
    // The restore is the half that would be harmless-looking to hoist into a
    // hydration effect ("just put the tokens back so the sync button works").
    // Doing so silently re-arms `cachedTokensReady` for a transcript the user
    // was never told about, which is auto-apply in all but name — the very
    // next Apply Sync consumes it without ever having offered.
    const refs = APP_SRC.split('\n').filter(l => l.includes('restoreUnappliedTranscriptTokens'));
    expect(refs).toHaveLength(2); // the import, and the one call in the handler
  });
});

// ---------------------------------------------------------------------------
// The App.tsx WIRING guards below were added because destructive probes found
// them missing, not because they looked prudent. Probes P7, P10 and P11 (this
// session's `.work-phase4/session-ws2-47/probe-results.txt`) each introduced a
// real defect in `handleApplySyncFromFiles`/`handleApplyUnappliedTranscript`
// and the whole T4.7 fixture set stayed GREEN.
//
// THEY ARE SOURCE SCANS, AND THAT IS A WEAKER GUARANTEE THAN A BEHAVIOURAL
// TEST — say so rather than let the file's green tick imply otherwise. They
// assert that specific lines are in specific places; they cannot observe what
// the running app does with them. The reason they are scans anyway is the same
// reason `languageDefaultDrift.test.ts` is one: the functions are private to a
// 6,600-line component whose orchestration this repo verifies manually by
// standing convention (CLAUDE.md §6, Testing). What they DO buy is the exact
// failure mode probes P7/P10/P11 demonstrated: a later edit that moves the
// clear, drops it, or makes an abort path claim success now has something
// executable objecting to it.
// ---------------------------------------------------------------------------

describe('WS2 T4.7 — App.tsx apply-ordering wiring (probe-driven source guards)', () => {
  const APP_SRC = readFileSync(APP_TSX, 'utf-8');

  /** `handleApplySyncFromFiles`'s body, signature to its closing `  };`. */
  function applySyncBody(): string {
    const marker = 'const handleApplySyncFromFiles = async (staged: StagedFiles): Promise<ApplySyncResult> => {';
    const start = APP_SRC.indexOf(marker);
    expect(start, `'${marker}' not found — this guard has lost its target`).toBeGreaterThan(-1);
    const rest = APP_SRC.slice(start + marker.length);
    const end = rest.indexOf('\n  };');
    expect(end).toBeGreaterThan(-1);
    return rest.slice(0, end);
  }

  it('P10 — the atomic commit clears the record inside itself, not in a follow-up update', () => {
    // The record means "a finished transcript no timeline write has consumed",
    // so it must stop being true in the very update that consumes it. A
    // separate follow-up setProject leaves a window where the timeline is
    // already written and the banner still offers to write it again.
    const body = applySyncBody();
    const commitStart = body.indexOf('// 8. Single atomic state update');
    expect(commitStart, 'step 8 marker not found').toBeGreaterThan(-1);
    const commit = body.slice(commitStart, body.indexOf("syncMark('setProject:called')", commitStart));
    expect(
      commit,
      'the step-8 commit no longer clears unappliedTranscript — an applied transcript would ' +
        'stay on offer in the recovery banner after the timeline had already consumed it.',
    ).toContain('unappliedTranscript: undefined');
  });

  it('P11 — every abort path reports failure, so no aborted sync can clear the record', () => {
    // `handleApplySyncFromFiles` returns whether step 8 was reached. An abort
    // that returned `{ ok: true }` would tell the recovery caller the timeline was
    // written and license it to discard the transcript.
    const body = applySyncBody();
    const aborts = body.split('\n')
      .map((line, i, all) => ({ line: line.trim(), next: (all[i + 1] ?? '').trim() }))
      .filter(x => x.line === 'setIsProcessing(false);' && x.next.startsWith('return'));
    expect(aborts.length, 'no abort paths found — this guard has lost its target').toBeGreaterThan(0);
    for (const a of aborts) {
      expect(
        a.next,
        `an abort path returns "${a.next}" instead of "{ ok: false, message: ... }"`,
      ).toMatch(/^return \{ ok: false, message:/);
    }
    // Exactly one success path at the very end.
    const successes = body.split('\n').filter(l => l.trim() === 'return { ok: true };');
    expect(successes).toHaveLength(1);
  });

  it('P7 — the apply handler never clears the record itself; only the commit does', () => {
    // Clearing alongside the RESTORE is the tempting shortcut ("the tokens are
    // in transcriptTokens now anyway") and is exactly the bug: a sync that then
    // aborted would leave the user with neither copy and no banner.
    const refs = APP_SRC.split('\n').filter(l => l.includes('clearUnappliedTranscript'));
    // The import, and the one call in the DISCARD handler. Any third reference
    // is a clear that is not user-initiated and not inside the atomic commit.
    expect(
      refs,
      'clearUnappliedTranscript gained a call site. The only non-import caller may be the ' +
        'Discard handler; Apply clears through the atomic commit, never directly.',
    ).toHaveLength(2);
    const inDiscard = APP_SRC.indexOf('clearDiscardedTranscriptCache(clearUnappliedTranscript');
    expect(inDiscard, 'the Discard handler no longer clears the record').toBeGreaterThan(-1);
  });
});
