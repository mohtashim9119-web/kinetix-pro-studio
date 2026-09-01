/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// ---------------------------------------------------------------------------
// WS2 T4.1 — language-default drift guard.
//
// WHAT IS BEING PROTECTED: the ABSENCE of a `language` field on a brand-new
// project (`App.tsx`'s `makeDefaultProject`). An absence cannot be protected
// by a comment, because the edit that breaks it — adding one obviously-correct
// line — looks like tidying, and nothing executable objects.
//
// WHY IT MATTERS, as a mechanism rather than a preference. `faGate.ts`'s
// `resolveFaLanguage` is `project.language ?? project.detectedLanguage`.
// `language` is the user's STICKY choice: `useWhisper.ts`'s transcription
// writes a detection only into an EMPTY `language` (`p.language ??
// detectedLanguage`), so once the field holds anything, no later detection can
// displace it. Seeding `'en'` at creation therefore does not "default" the
// language — it PERMANENTLY SHADOWS Whisper detection for every project ever
// created, and a Spanish voiceover resolves FA to English forever.
//
// THE ARGUMENT THIS TEST EXISTS TO DEFEAT, because it is correct as far as it
// goes: `'en'` and `undefined` take the same `canonicalize()` branch
// (`textNormalize.ts`'s `NON_ENGLISH_CANONICALIZE_LANGUAGES` is `{es,fr,de,pt}`
// and excludes `'en'`), so seeding `'en'` IS byte-for-byte identical on the
// matcher side. It is not identical on the FA-language-resolution side. Parity
// on one arm is not parity.
//
// CONSEQUENCE FOR WS2 T4.2: the new-project language dropdown must default to
// an explicit "Auto-detect" option that WRITES NOTHING, with the five
// supported codes as opt-in choices. Existing projects need no migration,
// because nothing changes for a project that has no field.
//
// IF THIS TEST FAILS: do not add `language` to the default project and do not
// relax the scan. If a default is genuinely wanted, it belongs in
// `resolveFaLanguage`'s fallback chain where detection can still precede it —
// not in the stored project, where it outranks detection permanently.
// ---------------------------------------------------------------------------

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import { resolveFaLanguage } from './faGate';

const HERE = dirname(fileURLToPath(import.meta.url));
const APP_TSX = resolve(HERE, '..', 'App.tsx');

/** The body of `makeDefaultProject`, from its signature to the first
 *  column-0 `}` that closes it. Deliberately a source scan and not a call:
 *  `makeDefaultProject` is module-private to `App.tsx`, and importing `App`
 *  drags in the entire component tree for what is a one-key assertion. */
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

describe('WS2 T4.1 — a new project must carry NO language field', () => {
  it('makeDefaultProject sets no `language` key', () => {
    // Matches a `language:` property key at any indentation. Does not match
    // `detectedLanguage:` (the `\b` after the optional quote plus the leading
    // boundary class), which is a different field and legitimately absent too.
    const body = makeDefaultProjectBody();
    const offenders = body
      .split('\n')
      .filter((line) => /^\s*'?language'?\s*:/.test(line));
    expect(
      offenders,
      'makeDefaultProject must not seed `language` — it permanently shadows Whisper ' +
        'detection via resolveFaLanguage (`language ?? detectedLanguage`). See the ' +
        'header of this file.',
    ).toEqual([]);
  });

  it('makeDefaultProject sets no `detectedLanguage` key either', () => {
    const body = makeDefaultProjectBody();
    const offenders = body
      .split('\n')
      .filter((line) => /^\s*'?detectedLanguage'?\s*:/.test(line));
    expect(offenders).toEqual([]);
  });
});

describe('WS2 T4.1 — why the absence is load-bearing (resolveFaLanguage)', () => {
  it('falls through to a Whisper detection when `language` is absent', () => {
    expect(resolveFaLanguage({ language: undefined, detectedLanguage: 'es' })).toBe('es');
  });

  it('a seeded `en` would shadow that detection permanently — the defect being locked out', () => {
    // Not an aspiration: this is the exact behaviour a default of 'en' buys.
    expect(resolveFaLanguage({ language: 'en', detectedLanguage: 'es' })).toBe('en');
  });

  it('an explicit user choice still wins, which is the behaviour we DO want', () => {
    expect(resolveFaLanguage({ language: 'fr', detectedLanguage: 'es' })).toBe('fr');
  });

  it('resolves undefined when neither exists — the never-transcribed project', () => {
    expect(resolveFaLanguage({ language: undefined, detectedLanguage: undefined })).toBeUndefined();
  });
});
