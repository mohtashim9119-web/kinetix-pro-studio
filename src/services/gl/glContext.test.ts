import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { isWebGL2Supported, __resetWebGL2SupportCacheForTests, acquireGlContext } from './glContext';

/**
 * This repo's vitest runs in plain Node (no jsdom, no vitest `environment`
 * configured — confirmed before choosing this approach) — there is no real
 * `document`/`HTMLCanvasElement`/WebGL2 to test against. These tests use
 * hand-rolled mock objects satisfying just the subset of the canvas/DOM
 * interface this module actually calls, mirroring
 * videoDecoderPool.test.ts's MockVideoDecoder/MockVideoFrame precedent
 * (vi.stubGlobal + a minimal mock class, not a full DOM shim). This proves
 * the module's own logic (option-passing, listener wiring, memoization,
 * preventDefault-on-loss) — it does not and cannot prove real-GPU context
 * creation, which is what the already-committed feasibility spike
 * (src/dev/webglFeasibilitySpike/main.ts) verified empirically instead.
 */

type Listener = (event: unknown) => void;

function makeMockCanvas(getContextImpl: (type: string, opts?: unknown) => unknown) {
  const listeners = new Map<string, Listener[]>();
  return {
    getContext: vi.fn(getContextImpl),
    addEventListener: vi.fn((type: string, cb: Listener) => {
      const list = listeners.get(type) ?? [];
      list.push(cb);
      listeners.set(type, list);
    }),
    __fire(type: string, event: unknown): void {
      for (const cb of listeners.get(type) ?? []) cb(event);
    },
  };
}

describe('isWebGL2Supported', () => {
  beforeEach(() => {
    __resetWebGL2SupportCacheForTests();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    __resetWebGL2SupportCacheForTests();
  });

  it('returns false when document is unavailable (non-browser runtime)', () => {
    vi.stubGlobal('document', undefined);
    expect(isWebGL2Supported()).toBe(false);
  });

  it('returns true when a throwaway canvas successfully creates a webgl2 context', () => {
    vi.stubGlobal('document', {
      createElement: () => makeMockCanvas(() => ({ fakeGl: true })),
    });
    expect(isWebGL2Supported()).toBe(true);
  });

  it('returns false when context creation returns null', () => {
    vi.stubGlobal('document', {
      createElement: () => makeMockCanvas(() => null),
    });
    expect(isWebGL2Supported()).toBe(false);
  });

  it('returns false when context creation throws', () => {
    vi.stubGlobal('document', {
      createElement: () => makeMockCanvas(() => { throw new Error('boom'); }),
    });
    expect(isWebGL2Supported()).toBe(false);
  });

  it('memoizes the result — a second call does not re-invoke createElement', () => {
    const createElement = vi.fn(() => makeMockCanvas(() => ({ fakeGl: true })));
    vi.stubGlobal('document', { createElement });
    isWebGL2Supported();
    isWebGL2Supported();
    expect(createElement).toHaveBeenCalledTimes(1);
  });

  it('__resetWebGL2SupportCacheForTests clears the memoized value so a changed runtime is re-probed', () => {
    const createElement = vi.fn(() => makeMockCanvas(() => ({ fakeGl: true })));
    vi.stubGlobal('document', { createElement });
    isWebGL2Supported();
    __resetWebGL2SupportCacheForTests();
    isWebGL2Supported();
    expect(createElement).toHaveBeenCalledTimes(2);
  });
});

describe('acquireGlContext', () => {
  it('returns null when canvas.getContext(\'webgl2\', ...) returns null', () => {
    const canvas = makeMockCanvas(() => null);
    const result = acquireGlContext(canvas as unknown as HTMLCanvasElement);
    expect(result).toBeNull();
  });

  it('returns the context and defaults alpha:true, preserveDrawingBuffer:false', () => {
    const fakeGl = { marker: 'gl' };
    const canvas = makeMockCanvas(() => fakeGl);
    const result = acquireGlContext(canvas as unknown as HTMLCanvasElement);
    expect(result).toBe(fakeGl);
    expect(canvas.getContext).toHaveBeenCalledWith('webgl2', { alpha: true, preserveDrawingBuffer: false });
  });

  it('honors explicit alpha/preserveDrawingBuffer overrides', () => {
    const canvas = makeMockCanvas(() => ({}));
    acquireGlContext(canvas as unknown as HTMLCanvasElement, { alpha: false, preserveDrawingBuffer: true });
    expect(canvas.getContext).toHaveBeenCalledWith('webgl2', { alpha: false, preserveDrawingBuffer: true });
  });

  it('registers webglcontextlost and webglcontextrestored listeners', () => {
    const canvas = makeMockCanvas(() => ({}));
    acquireGlContext(canvas as unknown as HTMLCanvasElement);
    expect(canvas.addEventListener).toHaveBeenCalledWith('webglcontextlost', expect.any(Function));
    expect(canvas.addEventListener).toHaveBeenCalledWith('webglcontextrestored', expect.any(Function));
  });

  it('does NOT register listeners when context creation fails (nothing to wire up)', () => {
    const canvas = makeMockCanvas(() => null);
    acquireGlContext(canvas as unknown as HTMLCanvasElement);
    expect(canvas.addEventListener).not.toHaveBeenCalled();
  });

  it('forced context-loss: preventDefault() is called (required by spec to allow restoration) and onContextLost fires', () => {
    const canvas = makeMockCanvas(() => ({}));
    const onContextLost = vi.fn();
    acquireGlContext(canvas as unknown as HTMLCanvasElement, { onContextLost });

    const fakeEvent = { preventDefault: vi.fn() };
    canvas.__fire('webglcontextlost', fakeEvent);

    expect(fakeEvent.preventDefault).toHaveBeenCalledTimes(1);
    expect(onContextLost).toHaveBeenCalledWith(fakeEvent);
  });

  it('forced context-restore: onContextRestored fires (this is the signal glCompositor.ts wires handleContextRestored() to)', () => {
    const canvas = makeMockCanvas(() => ({}));
    const onContextRestored = vi.fn();
    acquireGlContext(canvas as unknown as HTMLCanvasElement, { onContextRestored });

    canvas.__fire('webglcontextrestored', undefined);

    expect(onContextRestored).toHaveBeenCalledTimes(1);
  });

  it('a full loss -> restore cycle fires onContextLost once and onContextRestored once, in order, without re-registering listeners', () => {
    const canvas = makeMockCanvas(() => ({}));
    const events: string[] = [];
    acquireGlContext(canvas as unknown as HTMLCanvasElement, {
      onContextLost: () => events.push('lost'),
      onContextRestored: () => events.push('restored'),
    });

    canvas.__fire('webglcontextlost', { preventDefault: vi.fn() });
    canvas.__fire('webglcontextrestored', undefined);

    expect(events).toEqual(['lost', 'restored']);
    expect(canvas.addEventListener).toHaveBeenCalledTimes(2);
  });
});
