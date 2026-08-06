// Phase 4 Step W — LIVE K13 lock-preservation repro.
//
// Purpose: make structural check C11 trustworthy. Before this file, C11 was
// proven on hand-written synthetic pre/post fixtures only — i.e. it was proven
// against a defect this repo had asserted but never demonstrated in code. This
// file demonstrates it, against the REAL production functions and the REAL 173
// corpus project, and writes a machine-readable artifact that the Step X
// verification harness consumes as C11's "real half".
//
// It asserts the DEFECT, not the fix. Every assertion below is expected to pass
// today and MUST START FAILING when K13 is fixed at Stage 3 — that is the point.
// If it starts failing, do not "repair" it: read it as the lock work having
// landed, and retire it together with the defect.
//
// Run: npx vitest run scripts/phase4-step-w-k13-repro.test.ts
import { describe, it, expect } from 'vitest';
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { parseProjectData } from '../src/App';
import { applyAnchorBasedTiming } from '../src/services/syncEngine';
import type { VideoSegment } from '../src/types';

const PROJ = '/Users/mohtashim/Downloads/All Projects Test Data/173 Segs Project';
const BASELINE = 'docs/phase4-baseline-173-segments.csv';
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

describe('K13 — lock preservation across Apply Sync (LIVE repro, production code)', () => {
  const record: Record<string, unknown> = { generatedAt: new Date().toISOString() };

  it('PART 1 — parseProjectData mints every segment with locked === undefined', async () => {
    const script = readFileSync(`${PROJ}/script.txt`, 'utf8');
    const scene = readFileSync(`${PROJ}/sync.txt`, 'utf8');
    const segs = await parseProjectData(script, scene, [], AUDIO_DURATION);

    expect(segs.length).toBeGreaterThan(100); // the real 173-segment project
    const anyLocked = segs.filter(s => s.locked !== undefined);

    record.part1 = {
      claim: 'Apply Sync rebuilds the timeline clean-slate; the freshly minted '
        + 'segments carry no lock state at all, so no lock can reach the timing chain.',
      project: '173-seg (real corpus scene doc + script)',
      segmentsParsed: segs.length,
      segmentsCarryingAnyLockField: anyLocked.length,
      verdict: anyLocked.length === 0 ? 'DEFECT CONFIRMED' : 'lock state present',
    };

    // The defect: not one segment carries a lock field.
    expect(anyLocked.length).toBe(0);
  });

  it('PART 2 — the lost flag is load-bearing: locked vs unlocked timing differs', () => {
    const base = loadBaselineSegments();
    expect(base.length).toBeGreaterThan(100);

    // Pick a real segment comfortably longer than the perturbation, lock it the
    // way the UI's lock toggle does (App.tsx: `{ ...s, locked: !s.locked }`),
    // and pull its SUCCESSOR's anchor 0.9s earlier so the available span is now
    // shorter than the locked duration. That is exactly the shape
    // `applyAnchorBasedTiming`'s locked branch exists for: locked keeps the
    // preserved duration, unlocked shrinks to the span.
    const SQUEEZE = 0.9;
    const i = base.findIndex((s, k) => k > 0 && k < base.length - 2 && s.duration > 2.0);
    expect(i).toBeGreaterThan(0);

    const perturb = (arr: VideoSegment[]) => {
      arr[i + 1] = { ...arr[i + 1]!, anchorStart: arr[i + 1]!.anchorStart! - SQUEEZE };
      return arr;
    };
    const withLocks = perturb(base.map((s, k) => ({ ...s, locked: k === i })));
    const withoutLocks = perturb(base.map(s => ({ ...s })));

    const lockedOut = applyAnchorBasedTiming(withLocks as VideoSegment[], AUDIO_DURATION);
    const unlockedOut = applyAnchorBasedTiming(withoutLocks as VideoSegment[], AUDIO_DURATION);

    const dLock = Math.abs(lockedOut[i]!.duration - base[i]!.duration);
    const dNoLock = Math.abs(unlockedOut[i]!.duration - base[i]!.duration);
    const movedMs = Math.abs(lockedOut[i]!.duration - unlockedOut[i]!.duration) * 1000;

    record.part2 = {
      claim: 'applyAnchorBasedTiming honours `locked` — so losing the flag at '
        + 'Part 1 is not cosmetic, it changes the committed timeline.',
      segmentIndex: i,
      baselineDurationSec: base[i]!.duration,
      durationWithLockSec: lockedOut[i]!.duration,
      durationWithoutLockSec: unlockedOut[i]!.duration,
      divergenceMs: movedMs,
      verdict: movedMs > 1 ? 'FLAG IS LOAD-BEARING' : 'no divergence observed',
    };

    expect(movedMs).toBeGreaterThan(1);
    expect(dLock).toBeLessThanOrEqual(dNoLock);
  });

  it('PART 3 — writes the C11 evidence artifact for the Step X harness', () => {
    record.summary = 'K13 confirmed live against production code and the real 173 '
      + 'corpus: locks cannot survive Apply Sync (Part 1), and the flag they lose '
      + 'materially changes committed durations (Part 2). C11 therefore checks a '
      + 'demonstrated defect, not an asserted one.';
    mkdirSync(OUT_DIR, { recursive: true });
    writeFileSync(OUT, JSON.stringify(record, null, 2));
    expect(record.part1).toBeDefined();
    expect(record.part2).toBeDefined();
  });
});
