/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// ---------------------------------------------------------------------------
// WS2 T4.1 (C4) — WebCodecs-toggle CONSUMER-SET guard.
//
// WHAT WENT WRONG, stated as the measurement. D6 rewrote three surfaces — this
// hook's gate header, `isWebCodecsExportToggleOn`'s doc comment, and the App
// Settings block's title and body copy — to say the stored toggle also selects
// the WebGL2 preview renderer, citing `PreviewStage.tsx:399`'s
// `glPathActive = useWebCodecsPath && webgl2Supported`. That line's
// `useWebCodecsPath` is bound nineteen lines earlier from
// `isWebCodecsPreviewSupported()`, a `'VideoDecoder' in window` capability
// probe. The rationale was written from a LINE NUMBER and a same-named local
// variable rather than from the value flowing through it, and nothing in the
// suite could tell the difference: the claim lived only in prose, and prose
// answers to nobody.
//
// WHAT THIS FILE DOES. It reads the stored toggle's own accessors out of
// `useExport.ts` and asserts that the set of files referencing them is exactly
// the allowlist below. A fourth product file that starts reading the toggle
// reddens this test, which is the point: a copy change that claims a new
// consumer now has to be accompanied by the wiring, and wiring that appears
// without the copy is equally visible.
//
// WHAT IT DOES NOT CLAIM. It does not assert the toggle *should* be
// export-only — that is C4's owner ruling, recorded in `useExport.ts`'s gate
// header. It only guarantees that whatever the prose says, the import graph
// agrees.
//
// DESTRUCTIVE PROBE (CLAUDE.md §4 Testing — reach is established by breaking
// it, never by a green run). A third product consumer was added to
// `PreviewStage.tsx` (an `isWebCodecsExportToggleOn()` call) and this file went
// RED on `consumer set is exactly the allowlist`, naming the offending path.
// Probe reverted. The suite as it stood before this file was GREEN under the
// same mutation.
//
// IF THIS TEST FAILS: either the new consumer is intended — in which case add
// it here AND correct every prose surface that describes the toggle's reach —
// or it is D6 happening again.
// ---------------------------------------------------------------------------

import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'fs';
import { dirname, join, relative, resolve } from 'path';
import { fileURLToPath } from 'url';

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = resolve(HERE, '..');

/** Self-exclusion, same rationale as the sibling drift guards: this file's job
 *  is to talk about the accessors, so it is full of the strings it counts. */
const SELF = 'hooks/webcodecsToggleConsumers.test.ts';

/**
 * The identifiers through which the PERSISTED toggle is reachable. The raw key
 * string is included so a consumer that bypasses the accessors and reads
 * `kinetix:ui:v1` directly is caught too — that is the likelier shape of a
 * future bypass than an import.
 *
 * `isWebCodecsExportCapable` is deliberately ABSENT: it is a pure runtime
 * capability probe with no stored value behind it, and the App Settings modal
 * legitimately calls it to grey the control out.
 */
const TOGGLE_REFERENCES = [
  'isWebCodecsExportToggleOn',
  'setWebCodecsExportToggle',
  'isWebCodecsExportGateOpen',
  'webcodecsExportEnabled',
];

/**
 * THE ALLOWLIST — every file permitted to reach the stored toggle, with the
 * reason each one is on it. Two product entries, which is the claim C4's copy
 * now makes; the third is a dev-only harness that ships in no build.
 */
const ALLOWED: ReadonlyArray<{ path: string; why: string }> = [
  { path: 'hooks/useExport.ts', why: 'owns the key, the accessors and the export gate' },
  { path: 'components/AppSettingsModal.tsx', why: 'the settings surface — the control itself' },
  {
    path: 'dev/webcodecsStep2Spike/main.ts',
    why: 'dev-only spike harness under src/dev/, reachable from no product route and in no bundle',
  },
];

const ALLOWED_PATHS = new Set(ALLOWED.map((a) => a.path));

function collectSourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) collectSourceFiles(full, out);
    else if (/\.tsx?$/.test(full)) out.push(full);
  }
  return out;
}

/**
 * Comments stripped, because this guard is about WIRING and prose about the
 * toggle is exactly what a file is supposed to be free to carry — the D6
 * paragraph itself names the key, and so does `ProjectSettingsModal.tsx`'s
 * header explaining why the control left that modal. Counting those as
 * consumers would make the allowlist a list of files that mention the toggle,
 * which is the opposite of the claim being pinned.
 *
 * Block comments and whole-line `//` / ` * ` comments only. This repo puts its
 * comments on their own lines; a trailing `//` after code is left alone rather
 * than risk truncating a string literal that contains one.
 */
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((line) => !/^\s*(\/\/|\*)/.test(line))
    .join('\n');
}

/** Every non-test source file whose CODE references the persisted toggle. */
function consumerPaths(): string[] {
  const hits: string[] = [];
  for (const full of collectSourceFiles(SRC)) {
    const rel = relative(SRC, full).split('\\').join('/');
    if (rel === SELF) continue;
    if (/\.test\.tsx?$/.test(rel)) continue;
    const src = stripComments(readFileSync(full, 'utf8'));
    if (TOGGLE_REFERENCES.some((ref) => src.includes(ref))) hits.push(rel);
  }
  return hits.sort();
}

describe('WebCodecs toggle — the consumer set matches what the copy claims (C4)', () => {
  it('finds source files to scan at all (guards against a silently-empty sweep)', () => {
    expect(collectSourceFiles(SRC).length).toBeGreaterThan(50);
  });

  it('the accessors this guard scans for still exist in useExport.ts', () => {
    // Without this floor, renaming an accessor empties the sweep and every
    // assertion below passes forever — the exact failure mode a destructive
    // probe caught in `webcodecsDefaultDrift.test.ts`'s first draft.
    const src = stripComments(readFileSync(join(SRC, 'hooks', 'useExport.ts'), 'utf8'));
    for (const ref of TOGGLE_REFERENCES) {
      expect(src, `useExport.ts no longer mentions ${ref} — this guard has lost its target`).toContain(ref);
    }
  });

  it('consumer set is exactly the allowlist', () => {
    expect(
      consumerPaths(),
      'a file outside the allowlist reads the persisted WebCodecs toggle. Either wire it ' +
        'deliberately and add it here WITH every prose surface that describes the toggle updated, ' +
        'or remove the read. Unlisted reads are how D6 shipped a false claim.',
    ).toEqual([...ALLOWED_PATHS].sort());
  });

  it('every allowlist entry is a real, still-existing consumer (no stale grants)', () => {
    const actual = new Set(consumerPaths());
    for (const { path } of ALLOWED) {
      expect(actual.has(path), `allowlist entry ${path} no longer reads the toggle — drop it`).toBe(true);
    }
  });

  it('PreviewStage.tsx does not read the toggle — the specific claim D6 got wrong', () => {
    const src = stripComments(readFileSync(join(SRC, 'components', 'PreviewStage.tsx'), 'utf8'));
    for (const ref of TOGGLE_REFERENCES) {
      expect(
        src.includes(ref),
        `PreviewStage.tsx references ${ref}. If the preview is genuinely being wired to the ` +
          'toggle, note that the Canvas2D fallback was deleted at the WebGL2 cutover, so this ' +
          'switch would disable the only preview renderer that exists (C4 ruling).',
      ).toBe(false);
    }
    // Positive half: it selects its path from the capability probe instead.
    expect(src).toContain('isWebCodecsPreviewSupported');
  });
});
