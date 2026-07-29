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
} from './useExport';

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
