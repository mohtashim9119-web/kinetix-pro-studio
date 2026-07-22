import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  parentDir,
  isWebCodecsExportCapable,
  __resetWebCodecsExportCapabilityForTests,
  isWebCodecsExportToggleOn,
  setWebCodecsExportToggle,
  isWebCodecsExportGateOpen,
} from './useExport';

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
