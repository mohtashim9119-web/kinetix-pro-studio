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
