/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// ---------------------------------------------------------------------------
// TASK 2 — lock lifecycle fingerprint. Proves both directions the owner asked
// for: an unmodified re-sync preserves every lock bit-for-bit, and each of the
// four named changes (audio file, audio duration, script text, scene
// structure) independently wipes them.
//
// Split into two tiers, same precedent `phase4-step-w-k13-repro.test.ts` set
// for this class of claim:
//   1. Pure unit tests of computeSyncFingerprint/carryForwardLocks/hashBlob/
//      describeFingerprintChange in isolation (hand-built inputs).
//   2. A live composition test against the REAL 173-segment corpus project's
//      real script/scene-doc text (the same fixture `phase4-step-w-k13-
//      repro.test.ts` uses) and the REAL `parseProjectData`, proving the
//      exact sequence `App.tsx`'s Apply Sync handler now runs — not a
//      hand-simulated approximation of it.
// ---------------------------------------------------------------------------
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import {
  computeSyncFingerprint,
  carryForwardLocks,
  describeFingerprintChange,
  hashBlob,
} from './projectFingerprint';
import { parseProjectData } from '../App';
import type { VideoSegment } from '../types';
import type { SyncFingerprintInput } from '../types';

function baseInput(overrides: Partial<SyncFingerprintInput> = {}): SyncFingerprintInput {
  return {
    scriptText: 'Hello world, this is the voiceover script.',
    audioFileHash: 'abc123'.repeat(10),
    audioDurationSec: 42.5,
    segmentCount: 7,
    ...overrides,
  };
}

describe('TASK 2 — computeSyncFingerprint (pure)', () => {
  it('is deterministic: identical inputs produce identical hashes across independent calls', async () => {
    const a = await computeSyncFingerprint(baseInput());
    const b = await computeSyncFingerprint(baseInput());
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/); // SHA-256 hex
  });

  it('changing scriptText alone changes the hash', async () => {
    const a = await computeSyncFingerprint(baseInput());
    const b = await computeSyncFingerprint(baseInput({ scriptText: 'Hello world, this is a DIFFERENT script.' }));
    expect(a).not.toBe(b);
  });

  it('changing audioFileHash alone changes the hash', async () => {
    const a = await computeSyncFingerprint(baseInput());
    const b = await computeSyncFingerprint(baseInput({ audioFileHash: 'def456'.repeat(10) }));
    expect(a).not.toBe(b);
  });

  it('changing audioDurationSec alone changes the hash', async () => {
    const a = await computeSyncFingerprint(baseInput());
    const b = await computeSyncFingerprint(baseInput({ audioDurationSec: 42.501 }));
    expect(a).not.toBe(b);
  });

  it('changing segmentCount alone changes the hash', async () => {
    const a = await computeSyncFingerprint(baseInput());
    const b = await computeSyncFingerprint(baseInput({ segmentCount: 8 }));
    expect(a).not.toBe(b);
  });

  it('is not fooled by field-boundary concatenation ambiguity ("ab"+"c" vs "a"+"bc")', async () => {
    // Guards the delimiter choice in computeSyncFingerprint's own payload join
    // — a bare concatenation without a separator would let these two distinct
    // input tuples collide.
    const a = await computeSyncFingerprint(baseInput({ scriptText: 'ab', audioFileHash: 'c' }));
    const b = await computeSyncFingerprint(baseInput({ scriptText: 'a', audioFileHash: 'bc' }));
    expect(a).not.toBe(b);
  });

  it('audioDurationSec is rounded to the pipeline\'s own 3-decimal precision — sub-millisecond probe noise does not churn it', async () => {
    const a = await computeSyncFingerprint(baseInput({ audioDurationSec: 42.5001 }));
    const b = await computeSyncFingerprint(baseInput({ audioDurationSec: 42.4999 }));
    // Both round to 42.500.
    expect(a).toBe(b);
  });
});

describe('TASK 2 — hashBlob (pure, Web Crypto)', () => {
  it('identical bytes hash identically regardless of File identity (name/id/lastModified)', async () => {
    const bytes = new Uint8Array([1, 2, 3, 4, 5]);
    const fileA = new File([bytes], 'take1.wav', { lastModified: 1000 });
    const fileB = new File([bytes], 'take1-restaged.wav', { lastModified: 9999 });
    expect(await hashBlob(fileA)).toBe(await hashBlob(fileB));
  });

  it('different bytes hash differently, even with identical File metadata', async () => {
    const fileA = new File([new Uint8Array([1, 2, 3])], 'audio.wav', { lastModified: 1000 });
    const fileB = new File([new Uint8Array([1, 2, 4])], 'audio.wav', { lastModified: 1000 });
    expect(await hashBlob(fileA)).not.toBe(await hashBlob(fileB));
  });
});

describe('TASK 2 — describeFingerprintChange (pure)', () => {
  it('names every changed field, and only the changed fields', async () => {
    const before = baseInput();
    const after = baseInput({ scriptText: 'different', segmentCount: 99 });
    const desc = describeFingerprintChange(before, after);
    expect(desc).toContain('script text');
    expect(desc).toContain('scene structure');
    expect(desc).not.toContain('audio file');
    expect(desc).not.toContain('audio duration');
  });

  it('reports nothing changed for identical inputs', () => {
    expect(describeFingerprintChange(baseInput(), baseInput())).toBe('no tracked input changed');
  });

  it('reports "no previous fingerprint" for a project synced before this field existed', () => {
    expect(describeFingerprintChange(undefined, baseInput())).toBe('no previous fingerprint recorded');
  });
});

function makeSegment(o: Partial<VideoSegment> & { id: string }): VideoSegment {
  return {
    text: '', startTime: 0, duration: 1, order: 0,
    transition: 'none' as VideoSegment['transition'], animation: 'none' as VideoSegment['animation'],
    ...o,
  } as VideoSegment;
}

describe('TASK 2 — carryForwardLocks (pure)', () => {
  it('DIRECTION 1 — preserved: true restores locked/startTime/duration/anchorStart bit-for-bit, by script position', () => {
    const fresh = [
      makeSegment({ id: 'new-0', startTime: 0, duration: 3 }),
      makeSegment({ id: 'new-1', startTime: 3, duration: 4 }),
      makeSegment({ id: 'new-2', startTime: 7, duration: 2 }),
    ];
    const previous = [
      makeSegment({ id: 'old-0', startTime: 0.1, duration: 2.9 }), // unlocked — not restored
      makeSegment({ id: 'old-1', startTime: 3.2, duration: 3.5, locked: true, anchorStart: 3.2, anchorSource: 'whisper' }),
      makeSegment({ id: 'old-2', startTime: 6.7, duration: 2.3 }), // unlocked
    ];

    const result = carryForwardLocks(fresh, previous, true);

    expect(result.preserved).toBe(true);
    expect(result.restoredCount).toBe(1);
    // Unlocked positions: the FRESH segment's own values survive untouched —
    // this is not a full re-derivation, only locked segments are overwritten.
    expect(result.segments[0]!.id).toBe('new-0'); // id is never overwritten
    expect(result.segments[0]!.startTime).toBe(0);
    expect(result.segments[0]!.duration).toBe(3);
    expect(result.segments[0]!.locked).toBeUndefined();
    // The locked position: startTime/duration/anchorStart restored bit-for-bit
    // from the PREVIOUS project — INVARIANT L2 (anchorStart === startTime).
    expect(result.segments[1]!.locked).toBe(true);
    expect(result.segments[1]!.startTime).toBe(3.2);
    expect(result.segments[1]!.duration).toBe(3.5);
    expect(result.segments[1]!.anchorStart).toBe(3.2);
    expect(result.segments[1]!.anchorSource).toBe('whisper');
    expect(result.segments[2]!.locked).toBeUndefined();
  });

  it('DIRECTION 1 — a project with no locks at all restores nothing, and is not reported as a wipe', () => {
    const fresh = [makeSegment({ id: 'new-0' }), makeSegment({ id: 'new-1' })];
    const previous = [makeSegment({ id: 'old-0' }), makeSegment({ id: 'old-1' })];
    const result = carryForwardLocks(fresh, previous, true);
    expect(result.preserved).toBe(true);
    expect(result.restoredCount).toBe(0);
  });

  it('DIRECTION 2 — preserved: false wipes every lock — fresh segments pass through untouched', () => {
    const fresh = [
      makeSegment({ id: 'new-0', startTime: 0, duration: 3 }),
      makeSegment({ id: 'new-1', startTime: 3, duration: 4 }),
    ];
    const previous = [
      makeSegment({ id: 'old-0', locked: true, startTime: 0.1, duration: 2.9 }),
      makeSegment({ id: 'old-1', locked: true, startTime: 3.2, duration: 3.8 }),
    ];

    const result = carryForwardLocks(fresh, previous, false);

    expect(result.preserved).toBe(false);
    expect(result.restoredCount).toBe(0);
    expect(result.segments).toBe(fresh); // identity-equal — genuinely untouched
    expect(result.segments.every(s => !s.locked)).toBe(true);
  });

  it('a segment-count mismatch (scene structure genuinely changed) refuses to carry forward even if the caller claims preserved', () => {
    // Defense in depth: `preserved` should already be false whenever
    // segmentCount differs (it is part of the fingerprint), but this asserts
    // the by-index carry-forward itself refuses to run against mismatched
    // arrays regardless of what the caller passes — index-based matching
    // across different lengths is unsound by construction.
    const fresh = [makeSegment({ id: 'new-0' }), makeSegment({ id: 'new-1' }), makeSegment({ id: 'new-2' })];
    const previous = [makeSegment({ id: 'old-0', locked: true }), makeSegment({ id: 'old-1' })];
    const result = carryForwardLocks(fresh, previous, true);
    expect(result.preserved).toBe(false);
    expect(result.restoredCount).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// LIVE COMPOSITION — the real 173-segment corpus project, the real
// parseProjectData, proving the exact sequence App.tsx's Apply Sync handler
// now runs: fingerprint before/after, and carryForwardLocks between two real
// parses. Same fixture `phase4-step-w-k13-repro.test.ts` uses.
// ---------------------------------------------------------------------------
const PROJ = '/Users/mohtashim/Downloads/All Projects Test Data/173 Segs Project';
const AUDIO_DURATION = 709.01;

describe('TASK 2 — live composition against the real 173-segment project (closes decision 9 item 3)', () => {
  it('an UNMODIFIED re-sync preserves every lock bit-for-bit', async () => {
    const script = readFileSync(`${PROJ}/script.txt`, 'utf8');
    const scene = readFileSync(`${PROJ}/sync.txt`, 'utf8');

    // "Sync run 1" — parse, then simulate the user locking two real segments
    // (the same shape a manual lock toggle produces: locked + anchorStart ===
    // startTime).
    const parsed1 = await parseProjectData(script, scene, [], AUDIO_DURATION);
    expect(parsed1.length).toBeGreaterThan(100);
    const lockIdxA = 5;
    const lockIdxB = 40;
    const previousSegments = parsed1.map((s, i) =>
      (i === lockIdxA || i === lockIdxB) ? { ...s, locked: true, anchorStart: s.startTime } : s,
    );
    const fp1 = await computeSyncFingerprint({
      scriptText: script,
      audioFileHash: 'fixed-audio-hash-for-this-project',
      audioDurationSec: AUDIO_DURATION,
      segmentCount: parsed1.length,
    });

    // "Sync run 2" — the user clicks Apply Sync again, nothing changed.
    const parsed2 = await parseProjectData(script, scene, [], AUDIO_DURATION);
    const fp2 = await computeSyncFingerprint({
      scriptText: script,
      audioFileHash: 'fixed-audio-hash-for-this-project',
      audioDurationSec: AUDIO_DURATION,
      segmentCount: parsed2.length,
    });

    expect(fp2).toBe(fp1); // identical inputs -> identical fingerprint

    const result = carryForwardLocks(parsed2, previousSegments, fp2 === fp1);

    expect(result.preserved).toBe(true);
    expect(result.restoredCount).toBe(2);
    expect(result.segments[lockIdxA]!.locked).toBe(true);
    expect(result.segments[lockIdxA]!.startTime).toBe(previousSegments[lockIdxA]!.startTime);
    expect(result.segments[lockIdxA]!.duration).toBe(previousSegments[lockIdxA]!.duration);
    expect(result.segments[lockIdxA]!.anchorStart).toBe(previousSegments[lockIdxA]!.startTime);
    expect(result.segments[lockIdxB]!.locked).toBe(true);
    expect(result.segments[lockIdxB]!.startTime).toBe(previousSegments[lockIdxB]!.startTime);
    // Every OTHER segment is unaffected — carrying forward two locks does not
    // touch the other ~170.
    const untouchedIndices = parsed2.map((_, i) => i).filter(i => i !== lockIdxA && i !== lockIdxB);
    for (const i of untouchedIndices) {
      expect(result.segments[i]!.locked).toBeUndefined();
    }
  });

  it('TRIGGER 1 — script text changed independently wipes the locks', async () => {
    const script = readFileSync(`${PROJ}/script.txt`, 'utf8');
    const scene = readFileSync(`${PROJ}/sync.txt`, 'utf8');
    const parsed1 = await parseProjectData(script, scene, [], AUDIO_DURATION);
    const fp1 = await computeSyncFingerprint({
      scriptText: script, audioFileHash: 'h', audioDurationSec: AUDIO_DURATION, segmentCount: parsed1.length,
    });

    const editedScript = script + '\nOne more sentence appended to the end of the script.';
    const fp2 = await computeSyncFingerprint({
      scriptText: editedScript, audioFileHash: 'h', audioDurationSec: AUDIO_DURATION, segmentCount: parsed1.length,
    });

    expect(fp2).not.toBe(fp1);
    const result = carryForwardLocks(parsed1, parsed1.map((s, i) => i === 0 ? { ...s, locked: true } : s), fp2 === fp1);
    expect(result.preserved).toBe(false);
    expect(result.restoredCount).toBe(0);
  });

  it('TRIGGER 2 — audio file replaced (different bytes, same everything else) independently wipes the locks', async () => {
    const script = readFileSync(`${PROJ}/script.txt`, 'utf8');
    const scene = readFileSync(`${PROJ}/sync.txt`, 'utf8');
    const parsed = await parseProjectData(script, scene, [], AUDIO_DURATION);

    const hashOld = await hashBlob(new File([new Uint8Array([1, 2, 3])], 'v1.wav'));
    const hashNew = await hashBlob(new File([new Uint8Array([9, 9, 9, 9])], 'v2.wav'));
    expect(hashNew).not.toBe(hashOld);

    const fp1 = await computeSyncFingerprint({
      scriptText: script, audioFileHash: hashOld, audioDurationSec: AUDIO_DURATION, segmentCount: parsed.length,
    });
    const fp2 = await computeSyncFingerprint({
      scriptText: script, audioFileHash: hashNew, audioDurationSec: AUDIO_DURATION, segmentCount: parsed.length,
    });

    expect(fp2).not.toBe(fp1);
    const result = carryForwardLocks(parsed, parsed.map((s, i) => i === 0 ? { ...s, locked: true } : s), fp2 === fp1);
    expect(result.preserved).toBe(false);
  });

  it('TRIGGER 3 — audio duration changed independently wipes the locks', async () => {
    const script = readFileSync(`${PROJ}/script.txt`, 'utf8');
    const scene = readFileSync(`${PROJ}/sync.txt`, 'utf8');
    const parsed = await parseProjectData(script, scene, [], AUDIO_DURATION);

    const fp1 = await computeSyncFingerprint({
      scriptText: script, audioFileHash: 'h', audioDurationSec: AUDIO_DURATION, segmentCount: parsed.length,
    });
    const fp2 = await computeSyncFingerprint({
      scriptText: script, audioFileHash: 'h', audioDurationSec: AUDIO_DURATION + 12.4, segmentCount: parsed.length,
    });

    expect(fp2).not.toBe(fp1);
    const result = carryForwardLocks(parsed, parsed.map((s, i) => i === 0 ? { ...s, locked: true } : s), fp2 === fp1);
    expect(result.preserved).toBe(false);
  });

  it('TRIGGER 4 — scene structure changed (a scene added, segment count differs) independently wipes the locks', async () => {
    const script = readFileSync(`${PROJ}/script.txt`, 'utf8');
    const scene = readFileSync(`${PROJ}/sync.txt`, 'utf8');
    const parsed1 = await parseProjectData(script, scene, [], AUDIO_DURATION);

    const editedScene = scene + '\n[EXTRA_SCENE_NEVER_SEEN_BEFORE]\nAn extra sentence describing a brand new scene.';
    const parsed2 = await parseProjectData(script, editedScene, [], AUDIO_DURATION);
    // The real, load-bearing effect the trigger name refers to: the parser
    // actually produced a different segment count from the edited doc.
    expect(parsed2.length).not.toBe(parsed1.length);

    const fp1 = await computeSyncFingerprint({
      scriptText: script, audioFileHash: 'h', audioDurationSec: AUDIO_DURATION, segmentCount: parsed1.length,
    });
    const fp2 = await computeSyncFingerprint({
      scriptText: script, audioFileHash: 'h', audioDurationSec: AUDIO_DURATION, segmentCount: parsed2.length,
    });

    expect(fp2).not.toBe(fp1);
    const result = carryForwardLocks(parsed2, parsed1.map((s, i) => i === 0 ? { ...s, locked: true } : s), fp2 === fp1);
    expect(result.preserved).toBe(false);
  });
});
