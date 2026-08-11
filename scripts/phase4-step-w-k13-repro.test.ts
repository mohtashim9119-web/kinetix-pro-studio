// Phase 4 Step W — LIVE K13 lock-preservation regression guard.
//
// Purpose: keep structural check C11 trustworthy. This file used to assert
// the DEFECT (K13: a resync silently cleared a locked segment's lock and
// reset its position) against production code and the real 173-segment
// corpus, so C11 was proven against a demonstrated defect rather than an
// asserted one. K13 is now fixed — `preserveSegmentLocks` (App.tsx) restores
// a previously-locked segment's lock/startTime/duration onto its Apply-Sync
// counterpart by unique assetId, validating the restore before committing it
// (see that function's own doc comment for the full design).
//
// This file is INVERTED accordingly: every assertion below now proves the
// FIX, still against the real 173-segment corpus, and MUST FAIL if the fix
// ever regresses — that is the point. Do not "repair" a failure here by
// loosening an assertion; a failure means a lock stopped surviving Apply
// Sync, and the underlying regression is what needs fixing, not this file.
//
// Flipped 2026-08-11, the day K13 was fixed. The filename is unchanged, but
// the artifact's `part2` keys were renamed that same day to describe the
// fixed world instead of the defect it replaced (baselineDurationSec ->
// baselineStartSec, durationWithLockSec -> naturallyResyncedStartSec,
// durationWithoutLockSec -> restoredStartSec). `scripts/phase4-step-w-trust.py`
// and `phase4-step-x-verify.py` were updated to the new key names and the
// fixed-state verdicts in the same commit as this comment. Any future rename
// of these keys must update both consumer scripts in the same commit, or they
// KeyError/misreport — as happened here between the rename and this fix.
//
// Run: npx vitest run scripts/phase4-step-w-k13-repro.test.ts
import { describe, it, expect } from 'vitest';
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { parseProjectData, preserveSegmentLocks } from '../src/App';
import type { VideoSegment } from '../src/types';

const PROJ = '/Users/mohtashim/Downloads/All Projects Test Data/173 Segs Project';
const BASELINE = 'scripts/fixtures/phase4-baseline-173-segments.csv';
const OUT_DIR = '.work-phase4';
const OUT = `${OUT_DIR}/step-w-c11-live-repro.json`;
const AUDIO_DURATION = 709.01;

function loadBaselineSegments(): VideoSegment[] {
  const lines = readFileSync(BASELINE, 'utf8').trim().split('\n');
  // Columns are order,tag,text,startTime,duration,endTime,anchorSource. `text`
  // can itself contain commas, so the numeric columns are read from the END of
  // the row (the last four fields are fixed and comma-free), not by index from
  // the front.
  return lines.slice(1).map((line, i) => {
    const parts = line.split(',');
    const start = parseFloat(parts[parts.length - 4]!);
    const dur = parseFloat(parts[parts.length - 3]!);
    return {
      id: `seg-${i}`,
      startTime: start,
      duration: dur,
      anchorStart: start,
      anchorSource: 'whisper',
      text: '',
    } as unknown as VideoSegment;
  });
}

// Neither the live corpus parse nor the golden baseline carry real assetIds
// (parseProjectData is called with no real Asset[] here, and the baseline CSV
// has no assetId column at all) — a deterministic, order-based synthetic
// assetId is layered on so preserveSegmentLocks' unique-assetId matching has
// something real to match against, simulating each scene already pointing at
// its own distinct asset. Mirrors loadBaselineSegments' own precedent of
// synthesizing `id`.
function withSyntheticAssetIds(segments: VideoSegment[]): VideoSegment[] {
  return segments.map((s, i) => ({ ...s, assetId: `asset-${i}` }));
}

describe('K13 — lock preservation across Apply Sync (LIVE regression guard, production code)', () => {
  const record: Record<string, unknown> = { generatedAt: new Date().toISOString() };

  it('PART 1 — preserveSegmentLocks restores a lock parseProjectData itself never carries', async () => {
    const script = readFileSync(`${PROJ}/script.txt`, 'utf8');
    const scene = readFileSync(`${PROJ}/sync.txt`, 'utf8');

    // Two independent parses of the SAME real script/scene doc — simulating
    // "the project as it stood before this Apply Sync" and "the freshly
    // re-parsed array this Apply Sync just produced". parseProjectData still
    // mints every segment with locked === undefined (that has not changed —
    // this file no longer needs to re-prove it in isolation); the fix lives
    // entirely in preserveSegmentLocks, exercised below.
    const previousRaw = await parseProjectData(script, scene, [], AUDIO_DURATION);
    const newRaw = await parseProjectData(script, scene, [], AUDIO_DURATION);
    expect(previousRaw.length).toBeGreaterThan(100); // the real 173-segment project
    expect(newRaw.length).toBe(previousRaw.length);

    const previousSegments = withSyntheticAssetIds(previousRaw);
    const newSegments = withSyntheticAssetIds(newRaw);

    // Lock a real segment comfortably inside the corpus, the way the UI's
    // lock toggle does (App.tsx: `{ ...s, locked: !s.locked }`).
    const LOCK_INDEX = Math.floor(previousSegments.length / 2);
    const lockedPrevious = previousSegments.map((s, i) => (i === LOCK_INDEX ? { ...s, locked: true } : s));

    const { segments: restored, dropped } = preserveSegmentLocks(newSegments, lockedPrevious, AUDIO_DURATION);
    const lockedCount = restored.filter(s => s.locked === true).length;

    record.part1 = {
      claim: 'preserveSegmentLocks restores the lock parseProjectData itself never carries — '
        + 'a resync no longer silently discards it.',
      project: '173-seg (real corpus scene doc + script)',
      segmentsParsed: newSegments.length,
      segmentsCarryingAnyLockField: lockedCount,
      droppedLockCount: dropped.length,
      verdict: lockedCount === 1 && dropped.length === 0 ? 'LOCK RESTORED' : 'DEFECT STILL PRESENT',
    };

    // The fix: exactly the locked segment survives, matched to its new
    // counterpart by assetId, and nothing was dropped.
    expect(dropped).toEqual([]);
    expect(lockedCount).toBe(1);
    expect(restored[LOCK_INDEX]!.locked).toBe(true);
  });

  it('PART 2 — the restored position is exact: it matches the OLD lock, not a freshly re-derived one', () => {
    const base = loadBaselineSegments();
    expect(base.length).toBeGreaterThan(100);
    const withAssetIds = withSyntheticAssetIds(base);

    // Pick a real segment comfortably longer than the perturbation below —
    // same selection rule Part 2 always used.
    const i = withAssetIds.findIndex((s, k) => k > 0 && k < withAssetIds.length - 2 && s.duration > 2.0);
    expect(i).toBeGreaterThan(0);

    const previousSegments = withAssetIds.map((s, k) => (k === i ? { ...s, locked: true } : s));

    // Simulate a real resync where SOMETHING upstream shifted this segment's
    // naturally-derived position by 0.9s, even though its own lock should
    // have pinned it — exactly the shape K13 used to lose silently.
    const SHIFT = 0.9;
    const committed = withAssetIds.map((s, k) => (k === i ? { ...s, startTime: s.startTime + SHIFT } : s));

    const { segments: restored, dropped } = preserveSegmentLocks(committed, previousSegments, AUDIO_DURATION);

    const restoredStartSec = restored[i]!.startTime;
    const driftFromOldMs = Math.abs(restoredStartSec - base[i]!.startTime) * 1000;
    const naturalDriftMs = Math.abs(committed[i]!.startTime - base[i]!.startTime) * 1000;

    record.part2 = {
      claim: 'preserveSegmentLocks restores the segment\'s EXACT old position — the freshly '
        + 're-derived (drifted) position the natural resync would otherwise have committed is '
        + 'discarded in favour of the saved one.',
      segmentIndex: i,
      baselineStartSec: base[i]!.startTime,
      naturallyResyncedStartSec: committed[i]!.startTime,
      restoredStartSec,
      // How far this segment would have silently drifted without the fix —
      // the same load-bearing-ness Part 2 always measured, now shown as the
      // gap the fix closes rather than a gap nothing closes.
      divergenceMs: naturalDriftMs,
      verdict: driftFromOldMs < 1 && dropped.length === 0 ? 'POSITION PRESERVED' : 'position lost',
    };

    expect(dropped).toEqual([]);
    expect(driftFromOldMs).toBeLessThan(1);
    // Sanity check on the fixture itself: the simulated drift must have been
    // real, or this test would trivially pass with nothing to fix.
    expect(naturalDriftMs).toBeGreaterThan(1);
    expect(record.part2 as { verdict: string }).toMatchObject({ verdict: 'POSITION PRESERVED' });
  });

  it('PART 3 — writes the C11 evidence artifact for the Step X harness', () => {
    record.summary = 'K13 is FIXED: preserveSegmentLocks (App.tsx) restores a locked segment\'s '
      + 'lock and exact position across Apply Sync, verified against the real 173-segment corpus '
      + '(Part 1: the lock reaches the committed array; Part 2: its position matches the saved '
      + 'one, not a freshly re-derived one). This file now guards the fix rather than the defect '
      + '— see the header comment.';
    mkdirSync(OUT_DIR, { recursive: true });
    writeFileSync(OUT, JSON.stringify(record, null, 2));
    expect(record.part1).toBeDefined();
    expect(record.part2).toBeDefined();
  });
});
