/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// ---------------------------------------------------------------------------
// WS1 Session J — FA-default drift guard.
//
// WHY THIS EXISTS, stated as the measured failure rather than as a principle.
// `FA_PROJECT_DEFAULT_ON` (`faGate.ts`) is the single source of truth for what
// an absent `Project.faHighPrecisionSync` resolves to. Its value has moved
// twice: OFF -> ON (WS1 Session G, owner ruling R-AK) and ON -> OFF (WS1
// Session H, value-only). Both times the constant moved and a SECOND,
// prose copy of the value did not. After Session H, `types.ts`'s
// `faHighPrecisionSync` doc comment still read "UNDEFINED MEANS ON ...
// (default `FA_PROJECT_DEFAULT_ON` = true)" for two full sessions, while the
// gate resolved `false`. Nothing failed. Nothing could fail — a comment is not
// reachable from a test.
//
// The one-line edit fixes the instance. It does not fix the mechanism: a third
// flip would re-create the same class of defect somewhere else, because the
// mechanism is "the value is restated in more than one place and only one of
// them is executable". This file is the permanent fix. It makes every prose
// restatement of the default executable, by scanning `src/` for them and
// requiring each one to agree with the runtime constant.
//
// SCOPE, deliberately drawn. This scans `src/` only — live code and the
// comments attached to it, which describe what the app does TODAY and are
// therefore falsifiable. It does NOT scan `docs/`: those files are dated,
// append-only records (CLAUDE.md §5), and `docs/work-in-progress.md` correctly
// records "default ON" as a true statement about WS1 Session G. Asserting over
// them would fail on accurate history.
//
// IF THIS TEST FAILS: do not edit the regex, and do not edit this test to
// match the prose. Either the constant moved and a comment was left behind
// (fix the comment), or a new comment asserted a value that was never true
// (fix the comment). The constant is the authority in both directions.
// ---------------------------------------------------------------------------

import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'fs';
import { dirname, join, relative, resolve } from 'path';
import { fileURLToPath } from 'url';
import { FA_PROJECT_DEFAULT_ON, isFaEnabledForProject } from './faGate';

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = resolve(HERE, '..');
const REPO = resolve(SRC, '..');

/** This file is itself full of the strings it forbids elsewhere (the regexes
 *  below, and this comment). Excluding it by name is not a loophole — it is
 *  the only file whose *job* is to talk about the pattern. */
const SELF = resolve(HERE, 'faDefaultDrift.test.ts');

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

/** Every `FA_PROJECT_DEFAULT_ON <is/=/:> <true|false>` restatement, in code or
 *  in a comment — the exact shape the stale `types.ts` line had. Backticks are
 *  optional on both sides so the markdown-ish comment style this repo uses is
 *  caught too. */
const ASSERTED_VALUE = /FA_PROJECT_DEFAULT_ON`?\s*(?:={1,3}|:|\bis\b)\s*`?(true|false)\b/gi;

/** The English-prose form of the same claim, which carries no identifier at
 *  all and so would slip past the regex above. This is the phrase the stale
 *  comment actually led with. */
const UNDEFINED_MEANS = /UNDEFINED\s+MEANS\s+(ON|OFF)\b/gi;

describe('FA_PROJECT_DEFAULT_ON — the constant and every prose restatement of it agree', () => {
  const files = collectSourceFiles(SRC);

  it('finds source files to scan at all (guards against a silently-empty sweep)', () => {
    // A drift guard that scans nothing passes forever. Pin the floor so a
    // broken path or a moved directory fails loudly instead of going quiet.
    expect(files.length).toBeGreaterThan(50);
  });

  it('the declaration in faGate.ts matches the value the module actually exports', () => {
    const gate = readFileSync(join(SRC, 'services', 'faGate.ts'), 'utf8');
    const decl = gate.match(/export const FA_PROJECT_DEFAULT_ON\s*=\s*(true|false)\s*;/);
    expect(decl, 'faGate.ts must declare FA_PROJECT_DEFAULT_ON as a bare boolean literal').not.toBeNull();
    expect(decl![1]).toBe(String(FA_PROJECT_DEFAULT_ON));
  });

  it('no comment or expression in src/ asserts a disagreeing literal for the default', () => {
    const expected = String(FA_PROJECT_DEFAULT_ON);
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
      `FA_PROJECT_DEFAULT_ON is ${expected}, but these restate it as the opposite:\n${violations.join('\n')}\n\n` +
        'Fix the comment, never this test — faGate.ts owns the value.',
    ).toEqual([]);
  });

  it('no "UNDEFINED MEANS ON/OFF" prose in src/ contradicts the default', () => {
    const expectedWord = FA_PROJECT_DEFAULT_ON ? 'ON' : 'OFF';
    const violations: string[] = [];

    for (const file of files) {
      const text = readFileSync(file, 'utf8');
      for (const m of text.matchAll(UNDEFINED_MEANS)) {
        const said = m[1]?.toUpperCase();
        if (said !== undefined && said !== expectedWord) {
          const line = text.slice(0, m.index ?? 0).split('\n').length;
          violations.push(`${relative(REPO, file)}:${line} — says "${m[0].trim()}", default resolves ${expectedWord}`);
        }
      }
    }

    expect(
      violations,
      `An absent Project.faHighPrecisionSync resolves ${expectedWord}, but these say otherwise:\n${violations.join('\n')}`,
    ).toEqual([]);
  });

  it('the runtime resolution of an absent preference IS the constant, on every absent-ish input', () => {
    // The other half of the pin: prose agreeing with a constant nothing reads
    // would still be drift. These are the three shapes "no preference" takes
    // on the live path (undefined field, null project, absent project).
    expect(isFaEnabledForProject({ faHighPrecisionSync: undefined })).toBe(FA_PROJECT_DEFAULT_ON);
    expect(isFaEnabledForProject(null)).toBe(FA_PROJECT_DEFAULT_ON);
    expect(isFaEnabledForProject(undefined)).toBe(FA_PROJECT_DEFAULT_ON);
    // ...and an EXPLICIT choice is never the default's business, either way.
    expect(isFaEnabledForProject({ faHighPrecisionSync: true })).toBe(true);
    expect(isFaEnabledForProject({ faHighPrecisionSync: false })).toBe(false);
  });
});
