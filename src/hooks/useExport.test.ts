import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  parentDir,
  isWebCodecsExportCapable,
  __resetWebCodecsExportCapabilityForTests,
  isWebCodecsExportToggleOn,
  setWebCodecsExportToggle,
  isWebCodecsExportGateOpen,
  formatElapsed,
  formatElapsedLong,
  formatFrameSpanDuration,
} from './useExport';
import { normalizeSaveSessionFileResult } from '../services/tauriFfmpeg';
import { readFileSync } from 'fs';
import { resolve } from 'path';

/**
 * formatElapsed / formatElapsedLong — the live-timer and completion-toast
 * duration formatters (export UX timer + toast feature). Both are pure
 * functions with no React/DOM dependency, so — unlike the hook's own
 * start/tick/stop/reset timer behavior, which needs an actual render to
 * exercise (this repo has no jsdom/@testing-library/react/react-test-renderer
 * — confirmed absent from node_modules, same limitation documented in
 * usePlayback.test.ts's and useGlPreview.test.ts's own headers) — they can be
 * fully unit-tested here. The timer's live start/tick/stop/reset behavior and
 * the chime/toast integration are verified manually per the feature's own
 * validation checklist instead.
 */
describe('formatElapsed', () => {
  it('formats 0 seconds as 00:00', () => {
    expect(formatElapsed(0)).toBe('00:00');
  });

  it('formats 65 seconds as 01:05', () => {
    expect(formatElapsed(65)).toBe('01:05');
  });

  it('formats 3661 seconds (over an hour) as 01:01:01', () => {
    expect(formatElapsed(3661)).toBe('01:01:01');
  });

  it('zero-pads single-digit minutes and seconds under an hour', () => {
    expect(formatElapsed(5)).toBe('00:05');
    expect(formatElapsed(60)).toBe('01:00');
  });

  it('stays in MM:SS form up to (but not including) one hour', () => {
    expect(formatElapsed(3599)).toBe('59:59');
  });

  it('switches to HH:MM:SS at exactly one hour', () => {
    expect(formatElapsed(3600)).toBe('01:00:00');
  });

  it('floors fractional seconds and clamps negative input to zero', () => {
    expect(formatElapsed(65.9)).toBe('01:05');
    expect(formatElapsed(-5)).toBe('00:00');
  });
});

/**
 * WS3 Round 20 — the sealing dialog rendered "10 FRAMES LOST / 0s" on the
 * machine-1 field run (40,374 of 40,384 at 30 fps = 0.33 s, floored to 0).
 * A zero beside a non-zero frame count reads as a display bug and undermines
 * the frame count next to it. Sub-second spans show milliseconds; ≥ 1 s
 * rounds UP so a loss is never understated.
 */
describe('formatFrameSpanDuration', () => {
  it('10 frames at 30 fps is "333 ms", never "0s"', () => {
    expect(formatFrameSpanDuration(10 / 30)).toBe('333 ms');
  });

  it('1 frame at 30 fps is "33 ms"', () => {
    expect(formatFrameSpanDuration(1 / 30)).toBe('33 ms');
  });

  it('a true zero is "0s"', () => {
    expect(formatFrameSpanDuration(0)).toBe('0s');
  });

  it('rounds up past one second so a loss is never understated', () => {
    expect(formatFrameSpanDuration(1.0)).toBe('1s');
    expect(formatFrameSpanDuration(1.03)).toBe('2s');
    expect(formatFrameSpanDuration(40_374 / 30)).toBe('22m 26s'); // 1345.8 s kept, ceil 1346
  });

  it('a negative input clamps to zero rather than printing a sign', () => {
    expect(formatFrameSpanDuration(-3)).toBe('0s');
  });
});

/**
 * WS3 Round 20 — `save_session_file` now returns a durability report; a
 * `void`/non-object result (older native build, test fakes) must read as
 * confirmed, since the pre-Round-20 contract was "returned ⇒ saved".
 */
describe('normalizeSaveSessionFileResult', () => {
  it('void reads as confirmed', () => {
    expect(normalizeSaveSessionFileResult(undefined)).toEqual({ durableConfirmed: true, durabilityWarning: null });
    expect(normalizeSaveSessionFileResult(null)).toEqual({ durableConfirmed: true, durabilityWarning: null });
  });

  it('an explicit false with a warning passes through', () => {
    expect(normalizeSaveSessionFileResult({ durableConfirmed: false, durabilityWarning: 'x [os_error=32]' }))
      .toEqual({ durableConfirmed: false, durabilityWarning: 'x [os_error=32]' });
  });

  it('a confirmed result never carries a stale warning', () => {
    expect(normalizeSaveSessionFileResult({ durableConfirmed: true, durabilityWarning: null }))
      .toEqual({ durableConfirmed: true, durabilityWarning: null });
    expect(normalizeSaveSessionFileResult({ durableConfirmed: true, durabilityWarning: 42 }).durabilityWarning).toBeNull();
  });
});

describe('formatElapsedLong', () => {
  it('formats 45 seconds as "45s"', () => {
    expect(formatElapsedLong(45)).toBe('45s');
  });

  it('formats 65 seconds as "1m 5s"', () => {
    expect(formatElapsedLong(65)).toBe('1m 5s');
  });

  it('formats 3661 seconds as "1h 1m 1s"', () => {
    expect(formatElapsedLong(3661)).toBe('1h 1m 1s');
  });

  it('omits the minutes unit entirely under a minute', () => {
    expect(formatElapsedLong(0)).toBe('0s');
  });

  it('omits the hours unit entirely under an hour', () => {
    expect(formatElapsedLong(125)).toBe('2m 5s');
  });

  it('still shows 0m/0s components once a larger unit is present', () => {
    expect(formatElapsedLong(3600)).toBe('1h 0m 0s');
    expect(formatElapsedLong(60)).toBe('1m 0s');
  });
});

describe('parentDir', () => {
  it('returns the parent directory of a macOS/POSIX path', () => {
    expect(parentDir('/Users/name/video.mp4')).toBe('/Users/name');
  });

  it('returns the parent directory of a Windows path (backslash separators)', () => {
    expect(parentDir('C:\\Users\\name\\video.mp4')).toBe('C:\\Users\\name');
  });

  it('handles a Windows path with mixed separators, splitting on the last of either', () => {
    expect(parentDir('C:\\Users\\name/video.mp4')).toBe('C:\\Users\\name');
  });

  it('returns null when the path has no directory component', () => {
    expect(parentDir('video.mp4')).toBeNull();
  });
});

/**
 * WebCodecs export gate (docs/webcodecs-export-plan.md §4.4/§6). This repo's
 * default vitest environment is `node` (no jsdom, confirmed by
 * lookPresetService.test.ts/glContext.test.ts's own comments) — there is no
 * real `window`/`Worker`/`localStorage`, so these tests stub just the
 * object-presence surface isWebCodecsExportCapable() actually checks
 * (mirrors glContext.test.ts's mock-canvas approach) and a Map-backed
 * localStorage (mirrors lookPresetService.test.ts's installLocalStorage).
 */
describe('isWebCodecsExportCapable', () => {
  beforeEach(() => {
    __resetWebCodecsExportCapabilityForTests();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    __resetWebCodecsExportCapabilityForTests();
  });

  it('returns false when window is unavailable (non-browser runtime)', () => {
    vi.stubGlobal('window', undefined);
    expect(isWebCodecsExportCapable()).toBe(false);
  });

  it('returns false when VideoEncoder/VideoDecoder/EncodedVideoChunk are missing', () => {
    vi.stubGlobal('window', {});
    expect(isWebCodecsExportCapable()).toBe(false);
  });

  it('returns false when WebGL2 is unsupported even if WebCodecs classes exist', () => {
    vi.stubGlobal('window', { VideoEncoder: class {}, VideoDecoder: class {}, EncodedVideoChunk: class {} });
    // isWebGL2Supported() (glContext.ts) returns false when `document` is undefined —
    // true in this plain-node test environment, so no separate document stub is needed.
    expect(isWebCodecsExportCapable()).toBe(false);
  });

  it('memoizes the result — a second call does not re-probe', () => {
    vi.stubGlobal('window', {});
    expect(isWebCodecsExportCapable()).toBe(false);
    // Change the stub after the first (memoized) call — if the function
    // re-probed, this would now see the classes and return true.
    vi.stubGlobal('window', { VideoEncoder: class {}, VideoDecoder: class {}, EncodedVideoChunk: class {} });
    expect(isWebCodecsExportCapable()).toBe(false);
  });
});

describe('isWebCodecsExportToggleOn / setWebCodecsExportToggle', () => {
  function installLocalStorage(): void {
    const store = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
      setItem: (k: string, v: string) => void store.set(k, String(v)),
      removeItem: (k: string) => void store.delete(k),
      clear: () => store.clear(),
      key: (i: number) => [...store.keys()][i] ?? null,
      get length() {
        return store.size;
      },
    } as Storage);
  }

  beforeEach(() => {
    installLocalStorage();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('defaults to OFF when nothing has been persisted', () => {
    expect(isWebCodecsExportToggleOn()).toBe(true);
  });

  it('persists true/false through setWebCodecsExportToggle and reads it back', () => {
    setWebCodecsExportToggle(true);
    expect(isWebCodecsExportToggleOn()).toBe(true);
    setWebCodecsExportToggle(false);
    expect(isWebCodecsExportToggleOn()).toBe(false);
  });

  it('returns false (not throw) when localStorage is unavailable', () => {
    vi.unstubAllGlobals();
    vi.stubGlobal('localStorage', undefined);
    expect(isWebCodecsExportToggleOn()).toBe(true);
  });
});

describe('isWebCodecsExportGateOpen', () => {
  function installLocalStorage(): void {
    const store = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
      setItem: (k: string, v: string) => void store.set(k, String(v)),
      removeItem: (k: string) => void store.delete(k),
      clear: () => store.clear(),
      key: (i: number) => [...store.keys()][i] ?? null,
      get length() {
        return store.size;
      },
    } as Storage);
  }

  beforeEach(() => {
    installLocalStorage();
    __resetWebCodecsExportCapabilityForTests();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    __resetWebCodecsExportCapabilityForTests();
  });

  it('stays closed when the toggle is on but the runtime is incapable', () => {
    vi.stubGlobal('window', undefined);
    setWebCodecsExportToggle(true);
    expect(isWebCodecsExportGateOpen()).toBe(false);
  });

  it('stays closed when the runtime is capable-shaped but the toggle is off', () => {
    // Object-presence alone isn't full capability (WebGL2 also gates), but this
    // proves the toggle side of the AND independently of the capability probe.
    setWebCodecsExportToggle(false);
    expect(isWebCodecsExportGateOpen()).toBe(false);
  });
});

import { progressFor } from './useExport';

describe('progressFor — one smooth run across pieces', () => {
  const piece = (index: number, frame: number) =>
    ({ type: 'encoding_segment', index, total: 5, frame, totalFrames: 1000, cumulative: true }) as const;

  it('WebCodecs (cumulative frames): no jump when a piece finishes and the next starts', () => {
    // End of piece 1 (frame 200 of 1000) then the first frame of piece 2.
    expect(progressFor(piece(0, 200))).toBe(18);
    expect(progressFor(piece(1, 201))).toBe(18);
    expect(progressFor(piece(1, 400))).toBe(36);
    expect(progressFor(piece(4, 1000))).toBe(90);
  });

  it('increases monotonically frame by frame, never leaping more than a point', () => {
    let last = 0;
    for (let f = 0; f <= 1000; f += 5) {
      const pct = progressFor(piece(Math.min(4, Math.floor(f / 200)), f));
      expect(pct).toBeGreaterThanOrEqual(last);
      expect(pct - last).toBeLessThanOrEqual(1);
      last = pct;
    }
  });

  it('a stage without `cumulative` (per-piece frames) keeps the equal-slice maths', () => {
    expect(progressFor({ type: 'encoding_segment', index: 1, total: 4, frame: 50, totalFrames: 100 })).toBe(Math.round(((1 + 0.5) / 4) * 90));
  });
});

import { releaseAbandonedResumedSession, retainFailedRunSession } from './useExport';
import type { RetainForResumeReport } from '../services/tauriFfmpeg';

/**
 * A resumed run renders into the re-entered session; the fresh session made
 * for it never holds a byte. When the run fails and the resumed session is
 * retained, the fresh one must be released too. The fake models the native
 * pair: each session holds this process's claim while the run is live, and an
 * unforced destroy releases the claim and deletes a folder with no manifest
 * (`destroy_session_dir`).
 */
describe('retainFailedRunSession — a failed resumed run leaks no fresh session', () => {
  function disk() {
    const dirs = new Set(['fresh', 'resumed']);
    const claims = new Set(['fresh', 'resumed']);
    const manifests = new Set(['resumed']);
    const destroyed: { sessionId: string; opts?: { force?: boolean; failureKind?: string } }[] = [];
    const retained = (sessionId: string): RetainForResumeReport => {
      claims.delete(sessionId);
      return { sessionId, path: `/x/kinetix-export-${sessionId}`, disposition: 'retained', retainedBytes: 4_000, reclaimedBytes: 0, removed: [] };
    };
    const fresh = {
      ffmpeg: { retainForResume: async () => retained('fresh') },
      dispose: async (opts?: { force?: boolean; failureKind?: string }) => {
        destroyed.push({ sessionId: 'fresh', opts });
        claims.delete('fresh');
        if (opts?.force || !manifests.has('fresh')) dirs.delete('fresh');
        return { disposition: 'destroyed' as const };
      },
    } as unknown as Parameters<typeof retainFailedRunSession>[1];
    const resumed = { retainForResume: async () => retained('resumed') };
    return { dirs, claims, destroyed, fresh, resumed };
  }

  it('the resumed session is retained, and the fresh one is destroyed (guarded): no folder, no claim of ours', async () => {
    const d = disk();
    const report = await retainFailedRunSession(d.resumed, d.fresh, 'encode:watchdog');
    expect(report?.sessionId).toBe('resumed');
    expect(d.destroyed).toEqual([{ sessionId: 'fresh', opts: { force: false, failureKind: 'encode:watchdog' } }]);
    expect(d.dirs.has('fresh')).toBe(false);
    expect(d.claims.has('fresh')).toBe(false);
    // The kept session's fate is unchanged: retained, claim released.
    expect(d.dirs.has('resumed')).toBe(true);
    expect(d.claims.has('resumed')).toBe(false);
  });

  it('a run that was NOT resumed retained the fresh session itself — it is never destroyed here', async () => {
    const d = disk();
    const report = await retainFailedRunSession(null, d.fresh, 'encode');
    expect(report?.sessionId).toBe('fresh');
    expect(d.destroyed).toEqual([]);
    expect(d.dirs.has('fresh')).toBe(true);
  });
});

/**
 * The paths that only ever reached the FRESH session: a delivery failure on a
 * resumed run, and unmount/reload. The resumed session they abandoned kept
 * this process's claim, which reads `live` for the rest of the app run — so
 * the next Retry was refused as "another window is using this session". The
 * release is the same unforced destroy C4 uses for the unused fresh session:
 * the native manifest guard keeps every file and drops the claim.
 */
describe('releaseAbandonedResumedSession', () => {
  it('releases the resumed session unforced, so its files stay and its claim goes', async () => {
    const calls: unknown[] = [];
    await releaseAbandonedResumedSession(
      { destroy: async (opts?: { force?: boolean; failureKind?: string }) => { calls.push(opts); return null; } },
      'delivery-failed',
    );
    expect(calls).toEqual([{ force: false, failureKind: 'delivery-failed' }]);
  });

  it('is a no-op for a run that was not resumed', async () => {
    await expect(releaseAbandonedResumedSession(null, 'unmount')).resolves.toBeUndefined();
  });

  it('is best-effort: a failing release never throws', async () => {
    await expect(releaseAbandonedResumedSession(
      { destroy: async () => { throw new Error('EBUSY'); } },
      'unmount',
    )).resolves.toBeUndefined();
  });

  it('is wired into the delivery-failure path (before the fresh teardown) and the unmount cleanup', () => {
    const src = readFileSync(resolve(import.meta.dirname, 'useExport.ts'), 'utf-8');
    const delivery = src.indexOf("await teardown(false, 'delivery-failed');");
    expect(delivery).toBeGreaterThan(-1);
    const release = src.lastIndexOf("await releaseAbandonedResumedSession(resumeFfmpeg as never, 'delivery-failed');", delivery);
    expect(release).toBeGreaterThan(-1);
    expect(delivery - release).toBeLessThan(200);
    // The unmount releases with the truthful label: `cancel` after a cancel, else `unmount`.
    const unmount = src.indexOf("void teardown(false, label);");
    const unmountRelease = src.indexOf("void releaseAbandonedResumedSession(resumedSessionRef.current, label);");
    expect(src).toContain("const label = teardownLabelRef.current ?? 'unmount';");
    expect(unmountRelease).toBeGreaterThan(-1);
    expect(Math.abs(unmount - unmountRelease)).toBeLessThan(200);
    expect(src).toContain('resumedSessionRef.current = adopted.resumable.session');
  });
});
