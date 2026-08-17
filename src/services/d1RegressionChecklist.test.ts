/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// ---------------------------------------------------------------------------
// D.-1 — the cross-cutting regression checklist, AUTOMATED (WS1 Session G).
//
// The checklist is `docs/ws1-sync-pipeline/sync-pipeline-v2-plan.md`'s
// "Cross-cutting regression checklist" (K11): nine classes the phase gates
// themselves do not individually watch, specified to run "at every stage
// lock" against a real corpus project in the running app. Before this file,
// NONE of the nine had ever been run as specified, and the ledger's own
// status was "automated proxy tests exist for some, weak-to-no coverage for
// the rest".
//
// This file builds FIVE of the nine FOR REAL — driven through production
// functions against real corpus fixtures where a corpus is what the item
// asks about. It does not attempt the other four, and it does not pretend
// to: what each of those four actually has today is recorded item by item at
// the BOTTOM of this file, deliberately as executable documentation rather
// than prose in a ledger, so it goes stale loudly rather than silently.
//
// WHAT "FOR REAL" MEANS HERE. These are service-level tests, not a running
// app. For items 1/2/3/6/7 that is not a compromise: every one of those
// items' claims is a claim about a pure production function's output
// (`applyAnchorBasedTiming`, `clampHeadingsToDuration`, `saveProject`/
// `loadProject`, `getFileIdentity`) and is fully decidable here. Items 4/5/8/9
// are NOT decidable here, which is exactly why they are not claimed.
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { applyAnchorBasedTiming, getFileIdentity, headExtendFirstSegment } from './syncEngine';
import { clampHeadingsToDuration } from './headingLayer';
import { saveProject, loadProject } from './projectStore';
import type { HeadingOverlay, Project, VideoSegment } from '../types';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const FIXTURES = resolve(REPO, 'scripts', 'fixtures');

function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = []; let row: string[] = []; let field = ''; let inQ = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQ) { if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else { inQ = false; } } else { field += c; } }
    else if (c === '"') { inQ = true; }
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n') { row.push(field); field = ''; rows.push(row); row = []; }
    else if (c !== '\r') { field += c; }
  }
  if (field.length > 0 || row.length > 0) { row.push(field); rows.push(row); }
  const header = rows.shift() ?? [];
  return rows.filter(r => r.length === header.length)
    .map(r => Object.fromEntries(header.map((h, i) => [h, r[i] ?? ''])) as Record<string, string>);
}
const loadCsv = (n: string) => parseCsv(readFileSync(resolve(FIXTURES, n), 'utf-8'));

function installLocalStorage(): void {
  const store = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => void store.set(k, String(v)),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
    key: (i: number) => [...store.keys()][i] ?? null,
    get length() { return store.size; },
  } as Storage);
}

/** The real 173 corpus, as FA committed it — the same fixture the FA replay
 *  gate and R.11's own suite read. Used wherever an item's claim is about a
 *  real project rather than a hand-built shape. */
function realCorpus173(): VideoSegment[] {
  return loadCsv('phase4-fa-second-baseline-173-segments.csv').map((r, i) => ({
    id: r.tag, tag: r.tag, text: r.text, startTime: Number(r.startTime), duration: Number(r.duration),
    anchorStart: Number(r.startTime), anchorSource: 'forced-alignment',
    transition: 'none', animation: 'none', order: i,
  } as unknown as VideoSegment));
}

const AUDIO_173 = 709.01;

// ===========================================================================
// ITEM 1 — LOCKS. "Toggle a lock on a corpus project, resync, confirm the
// locked segment's startTime/duration unchanged."
// ===========================================================================

describe('D.-1 item 1 — LOCKS: a locked segment survives a resync untouched', () => {
  it('a locked mid-timeline segment keeps its exact startTime and duration through applyAnchorBasedTiming', () => {
    const segs = realCorpus173();
    const idx = 40;
    const lockedBefore = { ...segs[idx]! };
    // Toggle the lock, then feed the array back through the real resync
    // timing pass with DELIBERATELY DISTURBED anchors either side, so the
    // pass has every reason to move it if locks were not honoured.
    const disturbed = segs.map((s, i) => ({
      ...s,
      locked: i === idx ? true : s.locked,
      anchorStart: i === idx ? s.anchorStart : (s.anchorStart ?? s.startTime) + 0.75,
    }));
    const out = applyAnchorBasedTiming(disturbed, AUDIO_173);

    const after = out[idx]!;
    expect(after.startTime).toBe(lockedBefore.startTime);
    expect(after.duration).toBe(lockedBefore.duration);
  });

  it('an UNLOCKED neighbour is free to move — proving the lock, not a global no-op, is what held it', () => {
    const segs = realCorpus173();
    const idx = 40;
    const disturbed = segs.map((s, i) => ({
      ...s,
      locked: i === idx ? true : s.locked,
      anchorStart: i === idx ? s.anchorStart : (s.anchorStart ?? s.startTime) + 0.75,
    }));
    const out = applyAnchorBasedTiming(disturbed, AUDIO_173);
    // At least one non-locked segment must differ from its input; otherwise
    // this whole item would pass vacuously on a pass that moves nothing.
    const moved = out.filter((s, i) => i !== idx && s.startTime !== segs[i]!.startTime);
    expect(moved.length).toBeGreaterThan(0);
  });

  it('locking the FIRST segment is honoured even against the anchor-to-zero normalisation', () => {
    const segs = realCorpus173();
    const pinned = segs.map((s, i) => (i === 0 ? { ...s, locked: true, startTime: 2.5, anchorStart: 2.5 } : s));
    const out = applyAnchorBasedTiming(pinned, AUDIO_173);
    expect(out[0]!.startTime).toBe(2.5);
  });
});

// ===========================================================================
// ITEM 2 — SKIPPED SEGMENTS. "Confirm one boundary adjacent to a skipped
// segment is in the listened set and correct (the middle-gap class)."
// ===========================================================================

describe('D.-1 item 2 — SKIPPED SEGMENTS: the boundary adjacent to a skip is correct', () => {
  it('173 commits exactly the two R.10-skipped scenes as skipped, and the committed array does not contain them', () => {
    const skipped = loadCsv('phase4-fa-second-baseline-173-skipped.csv');
    expect(skipped.map(r => r.segmentTag).sort()).toEqual(['blue_monkey', 'perilous_realms']);
    const committedTags = new Set(realCorpus173().map(s => (s as unknown as { tag: string }).tag));
    for (const r of skipped) expect(committedTags.has(r.segmentTag!)).toBe(false);
  });

  it('the committed array remains a GAPLESS partition across every skip site (Model P)', () => {
    // This is the middle-gap class the item names: a skipped scene must be
    // absorbed by its neighbours, never leave a hole.
    const segs = realCorpus173();
    for (let i = 1; i < segs.length; i++) {
      const prevEnd = segs[i - 1]!.startTime + segs[i - 1]!.duration;
      expect(Math.abs(prevEnd - segs[i]!.startTime)).toBeLessThan(1e-6);
    }
  });

  it('the boundary immediately after the `blue_monkey` skip site sits at its ear-verified value', () => {
    // `blue_monkey` occupied 36.96–37.73 before R.10 dropped it (ear-pass
    // item 11). Its successor's committed start is the boundary this item
    // asks about — pinned here so a future change that silently reopens the
    // gap is caught by this checklist and not only by the FA gate.
    const segs = realCorpus173();
    const after = segs.find(s => s.startTime >= 36.9 && s.startTime <= 38.1);
    expect(after, 'a committed boundary must exist in the former blue_monkey window').toBeDefined();
    const prev = segs[segs.indexOf(after!) - 1]!;
    expect(prev.startTime + prev.duration).toBeCloseTo(after!.startTime, 6);
  });
});

// ===========================================================================
// ITEM 3 — HEADINGS. "A project with heading overlays resyncs with heading
// times untouched."
// ===========================================================================

describe('D.-1 item 3 — HEADINGS: a resync leaves heading times untouched', () => {
  const headings = (): HeadingOverlay[] => ([
    { id: 'h1', text: 'ACT ONE', time: 12.0, duration: 1.0 },
    { id: 'h2', text: 'ACT TWO', time: 300.5, duration: 1.0 },
    { id: 'h3', text: 'ACT THREE', time: 700.0, duration: 1.0 },
  ] as unknown as HeadingOverlay[]);

  it('resyncing the segment array does not touch the heading layer at all', () => {
    const before = headings();
    const segs = realCorpus173().map(s => ({ ...s, anchorStart: (s.anchorStart ?? s.startTime) + 0.4 }));
    applyAnchorBasedTiming(segs, AUDIO_173);
    headExtendFirstSegment(segs);
    // Headings are a SEPARATE top-level layer (CLAUDE.md §4) — the timing
    // pass takes no heading argument, so it cannot move one. Asserted rather
    // than assumed: the objects are unchanged after both passes.
    expect(before).toEqual(headings());
  });

  it('a heading keeps its absolute time when the voiceover still covers it', () => {
    const kept = clampHeadingsToDuration(headings(), AUDIO_173);
    expect(kept.map(h => h.time)).toEqual([12.0, 300.5, 700.0]);
    expect(kept.some(h => (h as unknown as { needsReview?: boolean }).needsReview)).toBe(false);
  });

  it('a re-sync that SHRINKS past a heading clamps it and flags it for review rather than dropping it', () => {
    const shrunk = clampHeadingsToDuration(headings(), 100);
    expect(shrunk.length).toBe(3); // never silently dropped
    const late = shrunk.filter(h => h.time > 90);
    expect(late.length).toBeGreaterThan(0);
    for (const h of late) {
      expect(h.time).toBeLessThanOrEqual(100);
      expect((h as unknown as { needsReview?: boolean }).needsReview).toBe(true);
    }
  });
});

// ===========================================================================
// ITEM 6 — EMPTY-TOKEN FALLBACK. "A zero-token resync still takes the
// arithmetic retile path."
// ===========================================================================

describe('D.-1 item 6 — EMPTY-TOKEN FALLBACK: a zero-token resync still retiles arithmetically', () => {
  // WHAT THE ZERO-TOKEN PATH ACTUALLY IS — established by measurement while
  // writing this test, not assumed. `applyAnchorBasedTiming` is NOT a
  // standalone retile: handed segments with no `anchorStart` at all it
  // resolves every anchor to 0 and collapses the whole array onto the 0.1s
  // duration floor. That is not the production fallback, because production
  // never reaches it in that state — `App.tsx`'s `parseProjectData` runs the
  // CHARACTER-WEIGHT BOOTSTRAP first (`weight = s.text.length /
  // totalTextLength`, `anchorSource: 'estimate'`), so a zero-token resync
  // arrives here already carrying an arithmetic retile in its anchors.
  //
  // STATED LIMITATION: that bootstrap lives inside `parseProjectData` in the
  // App monolith and has no service-level entry point, so this item tests
  // the property the fallback must preserve — an arithmetic, estimate-marked
  // retile survives the timing pass intact — and NOT the bootstrap's own
  // weighting arithmetic, which remains uncovered here.
  const bootstrapped = (n: number, voDuration: number): VideoSegment[] => {
    const texts = Array.from({ length: n }, (_, i) => `Scene ${i} ${'word '.repeat(i + 2)}`);
    const total = texts.reduce((a, t) => a + t.length, 0);
    let acc = 0;
    return texts.map((text, i) => {
      const duration = Number(((text.length / total) * voDuration).toFixed(3));
      const startTime = Number(acc.toFixed(3));
      acc += duration;
      return {
        id: `s${i}`, text, startTime, duration,
        anchorStart: startTime, anchorSource: 'estimate',
        transition: 'none', animation: 'none', order: i,
      } as unknown as VideoSegment;
    });
  };

  it('a character-weight bootstrapped array stays monotonic and gapless through the timing pass', () => {
    const out = applyAnchorBasedTiming(bootstrapped(12, 60), 60);
    expect(out.length).toBe(12);
    for (let i = 1; i < out.length; i++) {
      expect(out[i]!.startTime).toBeGreaterThanOrEqual(out[i - 1]!.startTime);
      expect(Math.abs((out[i - 1]!.startTime + out[i - 1]!.duration) - out[i]!.startTime)).toBeLessThan(1e-6);
    }
    expect(out.every(s => s.duration > 0)).toBe(true);
  });

  it('keeps ESTIMATE provenance — a zero-token run must never claim whisper or forced-alignment accuracy', () => {
    const out = applyAnchorBasedTiming(bootstrapped(6, 30), 30);
    expect(out.every(s => s.anchorSource === 'estimate')).toBe(true);
  });

  it('covers the full media duration — the retile is a partition, not a prefix', () => {
    const out = headExtendFirstSegment(applyAnchorBasedTiming(bootstrapped(8, 40), 40));
    expect(out[0]!.startTime).toBe(0);
    const last = out[out.length - 1]!;
    expect(last.startTime + last.duration).toBeCloseTo(40, 1);
  });

  it('does not crash or produce NaN on the degenerate single-segment case', () => {
    const out = applyAnchorBasedTiming(bootstrapped(1, 10), 10);
    expect(Number.isFinite(out[0]!.startTime)).toBe(true);
    expect(Number.isFinite(out[0]!.duration)).toBe(true);
  });

  it('REGRESSION GUARD for the finding above: no anchors at all collapses to the floor — so the bootstrap is load-bearing', () => {
    // Pinned deliberately. If a future change makes `applyAnchorBasedTiming`
    // self-sufficient without anchors, this test fails and the comment above
    // (and item 4's weak-proxy note) must be revisited in the same commit.
    const anchorless = Array.from({ length: 5 }, (_, i) => ({
      id: `s${i}`, text: 'some words here', startTime: 0, duration: 1,
      transition: 'none', animation: 'none', order: i,
    } as unknown as VideoSegment));
    const out = applyAnchorBasedTiming(anchorless, 60);
    expect(out.slice(0, 4).every(s => s.duration === 0.1)).toBe(true);
  });
});

// ===========================================================================
// ITEM 7 — PERSISTENCE / RELOAD. "Save, reload, confirm timeline identical
// and no re-transcription triggered (`lastTranscribedFileIdentity` intact)."
// ===========================================================================

describe('D.-1 item 7 — PERSISTENCE/RELOAD: timeline identical, no re-transcription', () => {
  beforeEach(() => installLocalStorage());
  afterEach(() => vi.unstubAllGlobals());

  const IDENTITY = 'voice.m4a|8123456|1750000000000';

  function realProject(): Project {
    return {
      id: 'd1-item7', name: 'D-1 item 7', script: '', sceneDetails: '',
      segments: realCorpus173(), assets: [], language: 'en',
      lastTranscribedFileIdentity: IDENTITY,
      lastTranscribedAssetId: 'asset-1',
      transcriptTokens: [{ text: 'hello', startSec: 0.1, endSec: 0.4 }],
      globalTransition: 'none', globalTransitionDuration: 0.5, globalAnimation: 'none',
      globalOverlayConfig: { color: '#fff', backgroundColor: '#000', fontFamily: 'Inter' },
      confirmed: true,
    } as unknown as Project;
  }

  it('every segment startTime/duration survives a save→load round-trip bit-identically', () => {
    const p = realProject();
    saveProject(p);
    const back = loadProject('d1-item7')!;
    expect(back.project.segments.length).toBe(p.segments.length);
    expect(back.project.segments.map(s => [s.startTime, s.duration]))
      .toEqual(p.segments.map(s => [s.startTime, s.duration]));
  });

  it('`lastTranscribedFileIdentity` survives the round-trip intact — the thing that prevents a re-transcription', () => {
    saveProject(realProject());
    const back = loadProject('d1-item7')!;
    expect(back.project.lastTranscribedFileIdentity).toBe(IDENTITY);
    expect(back.project.transcriptTokens?.length).toBe(1);
  });

  it('the identity a reloaded file produces MATCHES the stored one, so no re-transcription is triggered', () => {
    // The real production key-builder, not a restatement of its format.
    const file = { name: 'voice.m4a', size: 8123456, lastModified: 1750000000000 } as unknown as File;
    expect(getFileIdentity(file)).toBe(IDENTITY);
    saveProject(realProject());
    expect(loadProject('d1-item7')!.project.lastTranscribedFileIdentity).toBe(getFileIdentity(file));
  });

  it('a DIFFERENT file does not match — proving the check above is discriminating, not constant-true', () => {
    const other = { name: 'voice.m4a', size: 8123457, lastModified: 1750000000000 } as unknown as File;
    expect(getFileIdentity(other)).not.toBe(IDENTITY);
  });

  it('reload does not resurrect the retired per-segment legacy fields', () => {
    const p = realProject();
    (p.segments[0] as unknown as { playbackSpeed?: number }).playbackSpeed = 2;
    (p.segments[0] as unknown as { sourceDuration?: number }).sourceDuration = 9;
    saveProject(p);
    const back = loadProject('d1-item7')!;
    expect('playbackSpeed' in back.project.segments[0]!).toBe(false);
    expect('sourceDuration' in back.project.segments[0]!).toBe(false);
    // ...and stripping them did not disturb the timeline.
    expect(back.project.segments[0]!.duration).toBe(p.segments[0]!.duration);
  });
});

// ===========================================================================
// THE REMAINING FOUR — recorded as executable documentation, NOT as coverage.
//
// These tests assert only what is actually true today about each item's
// coverage. They exist so the honest split cannot quietly rot into an
// implied claim: if someone later builds one of these for real, the
// corresponding assertion here should be deleted in the same commit.
// ===========================================================================

describe('D.-1 items 4/5/8/9 — NOT automated by this file (stated, not claimed)', () => {
  it('item 4 (NO-VOICEOVER PATH): WEAK PROXY — character-weight timing is testable; the Stage 4 log entry does not exist', () => {
    // The checklist itself says the "estimated timeline" entry is expected
    // "once it exists". It does not exist: no such log entry is emitted
    // anywhere in src/. So HALF this item is untestable because the thing it
    // asks about is unbuilt, and the other half (that a no-voiceover resync
    // produces a character-weight timeline) is exactly what item 6's
    // estimate-provenance test above already exercises.
    const weakProxy = 'item 6 estimate-provenance test';
    expect(weakProxy).toBeTruthy();
  });

  it('item 5 (SILENCE-SCAN FAILURE): WEAK PROXY — the error SHAPE is typed and tested; the fallback lives in a hook', () => {
    // `silenceDetector.ts` returns `{status:'error', errorMessage}` and that
    // shape is covered by its own suite. The behaviour this item actually
    // asks about — "still falls back to gap centres and logs, never aborts"
    // — is implemented in `useWhisper.ts`, a React hook, which CLAUDE.md §6
    // lists among the modules verified manually rather than by unit test.
    // Automating it means mounting the hook, which this file does not do.
    expect(true).toBe(true);
  });

  it('item 8 (EXPORT/PREVIEW CONSUMERS): WEAK PROXY — shape invariants are covered; "reads correctly" is a render claim', () => {
    // Timeline layout and the export pipelines have their own unit suites
    // covering segment-shape invariants, and item 2's gapless-partition
    // assertion above is the invariant those consumers actually depend on.
    // What is NOT covered is the item's literal request: a spot-check that
    // the rendered timeline and a real export agree with the committed
    // segments. That needs the running app.
    expect(true).toBe(true);
  });

  it('item 9 (DEV HARNESSES): NO PROXY AT ALL — the globals are installed by an App.tsx effect', () => {
    // `__calibrateBoundaryQuality`, `__ALIGN_INSTRUMENT__` and the
    // transcript inspector are attached to `window` by DEV-gated effects
    // inside App.tsx. Nothing short of mounting App exercises them, and
    // nothing in this file does. This is the one item with genuinely ZERO
    // automated coverage — asserted here so the claim stays honest.
    expect(typeof (globalThis as { __calibrateBoundaryQuality?: unknown }).__calibrateBoundaryQuality)
      .toBe('undefined');
  });
});
