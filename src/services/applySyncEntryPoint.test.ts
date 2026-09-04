/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// ---------------------------------------------------------------------------
// WS2-50 Commit 1 — one Apply Sync entry point, one staged-files input.
//
// THE DEFECT THIS EXISTS TO PREVENT A RECURRENCE OF. Two buttons start an
// Apply Sync: `DropZonePanel`'s own, and the unapplied-transcript recovery
// banner's "Apply". They shared the handler and diverged on its INPUT — the
// panel passed its live staged files, the banner passed a hand-written
// all-`null` `StagedFiles` literal. The literal was written on the reasoning
// that a user returning to a saved project has nothing staged and every staged
// field falls back to its committed project value; the second half only holds
// once something has been committed. Operator-reported: after a reload of a
// project whose first Apply Sync never completed, the banner's Apply aborted
// on an empty scene doc with all four slots visibly re-populated, while the
// panel's button succeeded on the same project in the same session.
//
// WHY A STRUCTURAL GUARD RATHER THAN "pass the right argument". Passing the
// right argument at the banner leaves the ABILITY to pass a wrong one at the
// next call site added. So `handleApplySyncFromFiles` takes no staged argument
// at all and reads the shared live ref itself. These tests assert exactly that
// property, in both directions: the entry point takes no input, and no caller
// manufactures one.
//
// THESE ARE SOURCE SCANS, WHICH IS A WEAKER GUARANTEE THAN A BEHAVIOURAL TEST
// — the same admission `unappliedTranscriptDrift.test.ts` makes, for the same
// reason: both functions are private to a 6,800-line component this repo
// verifies manually by standing convention (CLAUDE.md §6, Testing). What they
// buy is that the specific edit which reintroduces a second input has
// something executable objecting to it.
//
// IF THIS TEST FAILS: do not re-add a `staged` parameter and do not relax the
// scan. Publish the value into the shared ref instead.
// ---------------------------------------------------------------------------

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';

const HERE = dirname(fileURLToPath(import.meta.url));
const APP_TSX = resolve(HERE, '..', 'App.tsx');
const PANEL_TSX = resolve(HERE, '..', 'components', 'DropZonePanel.tsx');

const APP_SRC = readFileSync(APP_TSX, 'utf-8');
const PANEL_SRC = readFileSync(PANEL_TSX, 'utf-8');

/** Source of one `const <name> = ...` arrow body, signature to its closing
 *  `\n  };` at component-member indentation. */
function memberBody(src: string, marker: string): string {
  const start = src.indexOf(marker);
  expect(start, `'${marker}' not found — this guard has lost its target`).toBeGreaterThan(-1);
  const rest = src.slice(start + marker.length);
  const end = rest.indexOf('\n  };');
  expect(end).toBeGreaterThan(-1);
  return rest.slice(0, end);
}

const APPLY_MARKER = 'const handleApplySyncFromFiles = async (): Promise<ApplySyncResult> => {';

/** Line and block comments removed, so a scan cannot be satisfied or defeated
 *  by prose. Crude but sufficient: this file's targets never appear in string
 *  literals in `App.tsx`. */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
}

describe('WS2-50 — a single Apply Sync entry point', () => {
  it('the entry point declares no staged parameter', () => {
    expect(
      APP_SRC,
      'handleApplySyncFromFiles no longer has the zero-argument signature — a caller can ' +
        'supply staged files again, which is the divergence this guard exists to stop.',
    ).toContain(APPLY_MARKER);
    expect(
      APP_SRC,
      'handleApplySyncFromFiles has regrown a `staged` parameter.',
    ).not.toContain('handleApplySyncFromFiles = async (staged');
  });

  it('the entry point reads the shared live ref as its first statement', () => {
    const body = memberBody(APP_SRC, APPLY_MARKER);
    const firstStatement = body
      .split('\n')
      .map(l => l.trim())
      .filter(l => l !== '' && !l.startsWith('//'))[0];
    expect(
      firstStatement,
      'the first executable statement of Apply Sync is no longer the staged-files read. It ' +
        'must be: the panel clears its slots the moment it hands control here, so any read ' +
        'that happens after an await observes the cleared value, not the user’s files.',
    ).toBe('const staged: StagedFiles = stagedFilesRef.current;');
  });

  it('the shared ref is read in exactly one place', () => {
    // Assignments (`stagedFilesRef.current = ...`) are writes and are exempt;
    // any second READ is a second place the app can disagree with itself about
    // what is staged.
    const reads = APP_SRC.split('\n').filter(
      l => l.includes('stagedFilesRef.current') && !/stagedFilesRef\.current\s*=/.test(l),
    );
    expect(
      reads.map(l => l.trim()),
      'the shared staged-files ref is read somewhere other than the Apply Sync entry point.',
    ).toEqual(['const staged: StagedFiles = stagedFilesRef.current;']);
  });

  it('no call site in App.tsx constructs a StagedFiles value', () => {
    // The banner used to build one out of nulls. Any `StagedFiles`-shaped
    // object literal in App.tsx is that mistake returning, whatever it is
    // handed to.
    //
    // Scanned over the whole comment-stripped source rather than per line
    // start: a destructive probe (WS2-50 P4) rebuilt the literal on ONE line
    // and the original line-anchored regex stayed green. Property ACCESS
    // (`staged.scriptFile`) has no colon and is unaffected.
    const code = stripComments(APP_SRC);
    const keyed = code.match(/\b(scriptFile|sceneFile|voiceoverFile|assetFiles|zipFiles)\s*:/g) ?? [];
    expect(
      keyed,
      'App.tsx builds a StagedFiles literal again — the recovery banner’s empty-literal ' +
        'defect in a new spelling.',
    ).toEqual([]);
  });

  it('the empty-scene-doc abort is told which scene text it actually parsed', () => {
    // The two-argument form is what separates "a real doc with no scene tags"
    // from "no scene doc at all". Dropping the argument silently restores the
    // misleading message, and a destructive probe (WS2-50 P12) confirmed the
    // pure-function unit tests stay green when it is dropped — they exercise
    // the predicate, never the call site.
    const body = memberBody(APP_SRC, APPLY_MARKER);
    expect(
      body,
      'the abort no longer passes the resolved scene text, so a project with no scene doc is ' +
        'told again to "add scene tags" to a document it does not have.',
    ).toContain('emptySceneDocAbortMessage(newSegmentsRaw.length, sceneText)');
  });

  it('the recovery banner invokes the entry point with no arguments', () => {
    const body = memberBody(
      APP_SRC,
      'const handleApplyUnappliedTranscript = useCallback(async (): Promise<boolean> => {',
    );
    expect(
      body,
      'the recovery banner’s apply no longer calls the shared entry point argument-free.',
    ).toContain('result = await handleApplySyncFromFiles();');
  });
});

describe('WS2-50 — DropZonePanel supplies live staged state, never a literal', () => {
  it('the onApplySync prop takes no argument', () => {
    expect(
      PANEL_SRC,
      'onApplySync accepts a staged snapshot again, which lets this panel hand Apply Sync an ' +
        'input that differs from the ref the recovery banner’s path reads.',
    ).toContain('onApplySync: () => void;');
    expect(PANEL_SRC).not.toContain('onApplySync: (staged');
  });

  it('every onApplySync call is argument-free', () => {
    const calls = PANEL_SRC.split('\n').filter(l => /onApplySync\(/.test(l));
    expect(calls.length, 'no onApplySync call found — this guard has lost its target')
      .toBeGreaterThan(0);
    for (const call of calls) {
      expect(call.trim(), 'an onApplySync call passes a snapshot').toMatch(/onApplySync\(\)/);
    }
  });

  it('staged changes are published upward synchronously, from the ref', () => {
    const body = memberBody(
      PANEL_SRC,
      'const updateStaged = (updater: (prev: StagedFiles) => StagedFiles) => {',
    );
    // Derived from the ref rather than setState's `prev`, so the ref, the
    // parent and React state advance in one synchronous turn.
    expect(body, 'updateStaged no longer derives the next value from the ref')
      .toContain('const next = updater(stagedRef.current);');
    expect(body, 'updateStaged no longer writes the ref').toContain('stagedRef.current = next;');
    expect(
      body,
      'updateStaged no longer publishes the change to App.tsx — the shared ref would go stale ' +
        'and Apply Sync would run on files the user has since replaced.',
    ).toContain('onStagedFilesChange(next);');
  });

  it('the panel republishes what it holds on every mount', () => {
    // The panel unmounts on App.tsx's showDashboard ternary and remounts with
    // empty local state. Without a mount-time publish the parent's ref keeps
    // serving File handles for slots the user can no longer see.
    expect(
      PANEL_SRC,
      'the mount-time publish is gone — after a dashboard round trip the panel and Apply Sync ' +
        'would disagree about what is staged.',
    ).toMatch(/useEffect\(\(\) => \{\s*onStagedFilesChange\(stagedRef\.current\);\s*\}, \[onStagedFilesChange\]\);/);
  });
});
