// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// ---------------------------------------------------------------------------
// WS2 T4.1 (D3) — WebCodecs-toggle default drift guard.
//
// A direct copy of `src/services/faDefaultDrift.test.ts`'s mechanism, applied
// to the second default of the same class that the Step 0 settings-inventory
// sweep found. Written as a sibling rather than as a generalisation of that
// file on purpose: the two guards pin different constants with different prose
// forms, and a shared abstraction would have to be edited (and re-probed) every
// time a third default appears. Copying ~60 lines is the cheaper trade.
//
// WHAT WAS ACTUALLY WRONG, stated as the measurement rather than the
// principle. Before this round `isWebCodecsExportToggleOn()` resolved an absent
// preference with a BARE `true`, written twice inside one function (the `??`
// arm and the `catch` arm), with a third statement of the same value in the doc
// comment above it ("defaults ON for users who have never touched it"). Three
// copies, none of them named, none of them executable against each other —
// exactly the shape that let `types.ts`'s FA comment sit wrong for two full
// sessions while nothing failed. `WEBCODECS_TOGGLE_DEFAULT_ON` gives it a name;
// this file makes every copy of the value answerable to that name.
//
// WHAT THIS FILE DOES **NOT** CLAIM. It does not test that ON is the right
// default. That is an owner call backed by the macOS Intel verification noted
// in `useExport.ts`; this only guarantees that whatever the constant says, the
// code and the prose say the same thing.
//
// A DEFECT IN THIS FILE'S OWN FIRST DRAFT, kept in the record because it is
// the rule working. Probe P3 (flip the constant, leave the prose behind — the
// literal FA failure this pattern exists to catch) came back GREEN. Cause: the
// same edit that introduced `WEBCODECS_TOGGLE_DEFAULT_ON` had rewritten the doc
// comment out of `DEFAULTS_PROSE`'s reach, so the prose arm was scanning zero
// occurrences and could not fail. A prose guard with no prose to scan passes
// forever and looks identical to one that works. Fixed on both sides: the doc
// comment now carries the canonical phrasing, and the floor assertion below
// fails if it ever stops being there. P3 is red now.
//
// IF THIS TEST FAILS: fix the comment or the code, never this test.
// `useExport.ts` owns the value.
// ---------------------------------------------------------------------------

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'fs';
import { dirname, join, relative, resolve } from 'path';
import { fileURLToPath } from 'url';
import { WEBCODECS_TOGGLE_DEFAULT_ON, isWebCodecsExportToggleOn } from './useExport';

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = resolve(HERE, '..');
const REPO = resolve(SRC, '..');

/** Same self-exclusion rationale as `faDefaultDrift.test.ts`: this file's job
 *  is to talk about the pattern, so it is full of the strings it forbids. */
const SELF = resolve(HERE, 'webcodecsDefaultDrift.test.ts');

function collectSourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      collectSourceFiles(full, out);
    } else if (/\.tsx?$/.test(full) && full !== SELF) {
      out.push(full);
    }
  }
  return out;
}

/** Every `WEBCODECS_TOGGLE_DEFAULT_ON <is/=/:> <true|false>` restatement, in
 *  code or comment. Backticks optional on both sides for this repo's
 *  markdown-ish comment style. */
const ASSERTED_VALUE = /WEBCODECS_TOGGLE_DEFAULT_ON`?\s*(?:={1,3}|:|\bis\b)\s*`?(true|false)\b/gi;

/** The English-prose form, which carries no identifier and would slip past the
 *  regex above. This is the phrasing the pre-fix doc comment actually used. */
const DEFAULTS_PROSE = /\bdefaults?\s+(ON|OFF)\s+for\s+users\s+who\s+have\s+never/gi;

describe('WEBCODECS_TOGGLE_DEFAULT_ON — the constant, the code and the prose agree', () => {
  const files = collectSourceFiles(SRC);

  it('finds source files to scan at all (guards against a silently-empty sweep)', () => {
    expect(files.length).toBeGreaterThan(50);
  });

  it('useExport.ts declares it as a bare boolean literal matching the export', () => {
    const src = readFileSync(join(SRC, 'hooks', 'useExport.ts'), 'utf8');
    const decl = src.match(/export const WEBCODECS_TOGGLE_DEFAULT_ON\s*=\s*(true|false)\s*;/);
    expect(decl, 'useExport.ts must declare WEBCODECS_TOGGLE_DEFAULT_ON as a bare boolean literal').not.toBeNull();
    expect(decl![1]).toBe(String(WEBCODECS_TOGGLE_DEFAULT_ON));
  });

  it('isWebCodecsExportToggleOn contains no bare boolean fallback any more', () => {
    // The specific regression this guard exists for: a future edit that
    // "simplifies" the constant back to an inline literal restores the exact
    // untracked state D3 found, and every other assertion here would still
    // pass. Scan the function body for a literal in either resolution arm.
    const src = readFileSync(join(SRC, 'hooks', 'useExport.ts'), 'utf8');
    const start = src.indexOf('export function isWebCodecsExportToggleOn()');
    expect(start, 'isWebCodecsExportToggleOn not found — this guard has lost its target').toBeGreaterThan(-1);
    const body = src.slice(start, src.indexOf('\n}', start));
    const offenders = [
      ...body.matchAll(/\?\?\s*(true|false)\b/g),
      ...body.matchAll(/catch\s*\{\s*return\s+(true|false)\b/g),
      ...body.matchAll(/:\s*(true|false)\s*;/g),
    ].map((m) => m[0]);
    expect(
      offenders,
      'the absent-preference fallback must be WEBCODECS_TOGGLE_DEFAULT_ON, not an inline literal — ' +
        'an inline literal is the untracked default this guard exists to prevent.',
    ).toEqual([]);
  });

  it('no comment or expression in src/ asserts a disagreeing literal for the default', () => {
    const expected = String(WEBCODECS_TOGGLE_DEFAULT_ON);
    const violations: string[] = [];
    for (const file of files) {
      const text = readFileSync(file, 'utf8');
      for (const m of text.matchAll(ASSERTED_VALUE)) {
        const asserted = m[1]?.toLowerCase();
        if (asserted !== undefined && asserted !== expected) {
          const line = text.slice(0, m.index ?? 0).split('\n').length;
          violations.push(`${relative(REPO, file)}:${line} — asserts "${m[0].trim()}", constant is ${expected}`);
        }
      }
    }
    expect(
      violations,
      `WEBCODECS_TOGGLE_DEFAULT_ON is ${expected}, but these restate it as the opposite:\n${violations.join('\n')}\n\n` +
        'Fix the comment, never this test — useExport.ts owns the value.',
    ).toEqual([]);
  });

  it('the prose scan has something to scan (its first draft silently had nothing)', () => {
    // CLAUDE.md §4 Testing, applied to this file's own reach. On its first
    // draft the assertion below passed under a DESTRUCTIVE PROBE that flipped
    // the constant — because the rewrite that introduced the named constant
    // had also removed the only sentence matching DEFAULTS_PROSE, leaving the
    // scan with zero inputs. A prose guard that scans no prose passes forever
    // and is indistinguishable from a working one. This pins the floor, so a
    // future reword out of the regex's reach fails loudly.
    const hits = files.reduce(
      (n, f) => n + [...readFileSync(f, 'utf8').matchAll(DEFAULTS_PROSE)].length,
      0,
    );
    expect(
      hits,
      'no canonical "defaults ON/OFF for users who have never..." statement remains in src/ — ' +
        'either restore the phrasing in useExport.ts or widen DEFAULTS_PROSE to match the new wording.',
    ).toBeGreaterThan(0);
  });

  it('no "defaults ON/OFF for users who have never..." prose contradicts the constant', () => {
    const expectedWord = WEBCODECS_TOGGLE_DEFAULT_ON ? 'ON' : 'OFF';
    const violations: string[] = [];
    for (const file of files) {
      const text = readFileSync(file, 'utf8');
      for (const m of text.matchAll(DEFAULTS_PROSE)) {
        const said = m[1]?.toUpperCase();
        if (said !== undefined && said !== expectedWord) {
          const line = text.slice(0, m.index ?? 0).split('\n').length;
          violations.push(`${relative(REPO, file)}:${line} — says "${m[0].trim()}", constant resolves ${expectedWord}`);
        }
      }
    }
    expect(violations).toEqual([]);
  });
});

describe('WEBCODECS_TOGGLE_DEFAULT_ON — the runtime resolution IS the constant', () => {
  // Prose agreeing with a constant nothing reads would still be drift. These
  // are the three shapes "no stored preference" takes on the live path.
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it('an empty ui-state resolves to the constant', () => {
    expect(isWebCodecsExportToggleOn()).toBe(WEBCODECS_TOGGLE_DEFAULT_ON);
  });

  it('a wrong-typed stored value resolves to the constant, not to its truthiness', () => {
    localStorage.setItem('kinetix:ui:v1', JSON.stringify({ webcodecsExportEnabled: 'yes' }));
    expect(isWebCodecsExportToggleOn()).toBe(WEBCODECS_TOGGLE_DEFAULT_ON);
  });

  it('an unreadable store resolves to the constant', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('denied'); });
    expect(isWebCodecsExportToggleOn()).toBe(WEBCODECS_TOGGLE_DEFAULT_ON);
  });

  it('an explicit stored choice is never the default’s business, either way', () => {
    localStorage.setItem('kinetix:ui:v1', JSON.stringify({ webcodecsExportEnabled: true }));
    expect(isWebCodecsExportToggleOn()).toBe(true);
    localStorage.setItem('kinetix:ui:v1', JSON.stringify({ webcodecsExportEnabled: false }));
    expect(isWebCodecsExportToggleOn()).toBe(false);
  });
});
