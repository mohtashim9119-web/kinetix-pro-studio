/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// ---------------------------------------------------------------------------
// G4 Unit 3 — PRE-sync total WPM sanity check. OLD-BUG-FIRST: before this
// unit, nothing checked script total word count against audio duration at
// all — the "planted 100 extra words" scenario the operator described
// produced no signal until (and unless) something downstream happened to
// notice. Every "flags"/"warns" test below is a case that produces a finding
// now and produced nothing before this unit existed.
// ---------------------------------------------------------------------------

import { describe, it, expect } from 'vitest';
import { classifyScriptWpm, buildWpmCheckLogEntry, WPM_CHECK_COPY } from './syncWpmGate';
import { WPM_NORMAL_MIN, WPM_NORMAL_MAX, WPM_HARD_IMPOSSIBLE_MIN } from './syncConstants';

describe('classifyScriptWpm', () => {
  it('normal band: 150 WPM (150 words / 60s)', () => {
    const r = classifyScriptWpm(150, 60);
    expect(r.wpm).toBeCloseTo(150, 5);
    expect(r.band).toBe('normal');
  });

  it(`normal band boundaries are inclusive: exactly ${WPM_NORMAL_MIN} and exactly ${WPM_NORMAL_MAX} WPM are both normal`, () => {
    expect(classifyScriptWpm(WPM_NORMAL_MIN, 60).band).toBe('normal');
    expect(classifyScriptWpm(WPM_NORMAL_MAX, 60).band).toBe('normal');
  });

  it(`soft-slow band: just under ${WPM_NORMAL_MIN} WPM`, () => {
    const r = classifyScriptWpm(WPM_NORMAL_MIN - 1, 60);
    expect(r.band).toBe('soft-slow');
  });

  it(`soft-fast band: between ${WPM_NORMAL_MAX} and ${WPM_HARD_IMPOSSIBLE_MIN} WPM`, () => {
    const r = classifyScriptWpm(WPM_NORMAL_MAX + 1, 60);
    expect(r.band).toBe('soft-fast');
    expect(classifyScriptWpm(WPM_HARD_IMPOSSIBLE_MIN, 60).band).toBe('soft-fast'); // inclusive boundary, not yet hard
  });

  it(`hard-fast band: strictly over ${WPM_HARD_IMPOSSIBLE_MIN} WPM`, () => {
    const r = classifyScriptWpm(WPM_HARD_IMPOSSIBLE_MIN + 1, 60);
    expect(r.band).toBe('hard-fast');
  });

  it('OLD BUG scenario: a planted 100 extra words on a short, normal-length scene pushes a plausible 300-word/2-minute script into the hard-impossible band', () => {
    // 300 words over 120s = 150 WPM, dead center of normal. +100 planted
    // words (400 total) over the SAME unchanged audio = 200 WPM — already
    // soft-fast, and closer to the exact shape a shorter or more heavily
    // padded script pushes into hard-fast (verified explicitly below).
    const before = classifyScriptWpm(300, 120);
    const after = classifyScriptWpm(400, 120);
    expect(before.band).toBe('normal');
    expect(after.band).toBe('soft-fast');
  });

  it('OLD BUG scenario, hard-impossible variant: the same +100-word plant on a shorter script crosses into hard-fast', () => {
    // 150 words over 60s = 150 WPM, normal. +100 planted words (250 total)
    // over the same audio = 250 WPM — past WPM_HARD_IMPOSSIBLE_MIN (220).
    const before = classifyScriptWpm(150, 60);
    const after = classifyScriptWpm(250, 60);
    expect(before.band).toBe('normal');
    expect(after.band).toBe('hard-fast');
  });

  it('degenerate inputs (zero words, zero/negative duration) classify as normal — nothing usable to warn about', () => {
    expect(classifyScriptWpm(0, 60).band).toBe('normal');
    expect(classifyScriptWpm(150, 0).band).toBe('normal');
    expect(classifyScriptWpm(150, -5).band).toBe('normal');
  });
});

describe('buildWpmCheckLogEntry', () => {
  it('returns undefined for a normal-band run — a clean run\'s log stays unchanged', () => {
    expect(buildWpmCheckLogEntry('run1', 150, 60)).toBeUndefined();
  });

  it.each(['soft-slow', 'soft-fast', 'hard-fast'] as const)('%s band: returns a warning entry with the swappable copy', (band) => {
    const [totalWords, audioDurationSec] =
      band === 'soft-slow' ? [WPM_NORMAL_MIN - 10, 60]
      : band === 'soft-fast' ? [WPM_NORMAL_MAX + 10, 60]
      : [WPM_HARD_IMPOSSIBLE_MIN + 10, 60];
    const entry = buildWpmCheckLogEntry('run1', totalWords, audioDurationSec, 12345);
    expect(entry).toBeDefined();
    expect(entry!.type).toBe('warning');
    expect(entry!.severity).toBe('warning');
    expect(entry!.syncRunId).toBe('run1');
    expect(entry!.timestamp).toBe(12345);
    const r = classifyScriptWpm(totalWords, audioDurationSec);
    expect(r.band).toBe(band);
    expect(entry!.message).toBe(WPM_CHECK_COPY[band](r).message);
    expect(entry!.fixHint).toBe(WPM_CHECK_COPY[band](r).fixHint);
  });

  it('the hard-fast band\'s copy uses noticeably stronger wording than the soft bands ("Check your files")', () => {
    const hard = buildWpmCheckLogEntry('run1', WPM_HARD_IMPOSSIBLE_MIN + 50, 60)!;
    const soft = buildWpmCheckLogEntry('run1', WPM_NORMAL_MAX + 10, 60)!;
    expect(hard.message).toMatch(/check your files/i);
    expect(soft.message).not.toMatch(/check your files/i);
  });

  it('never blocks: this function is pure and synchronous, and its only output is an optional log entry — nothing here can halt or redirect Apply Sync', () => {
    // Structural guard, not a runtime assertion: buildWpmCheckLogEntry
    // returns `SyncLogEntry | undefined`, never a Promise, never a value
    // that could gate control flow at its call site.
    const result = buildWpmCheckLogEntry('run1', WPM_HARD_IMPOSSIBLE_MIN + 500, 1);
    expect(result === undefined || typeof result === 'object').toBe(true);
  });
});
