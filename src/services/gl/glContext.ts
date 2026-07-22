/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * WebGL2 context acquisition on a caller-supplied canvas
 * (docs/history.md (WebGL2 Effects Engine — Full Plan, archived 2026-07-20) Section 6, Phase 1). This module does
 * not create or mount any DOM — the caller owns the `<canvas>` element;
 * this module only turns it into a configured WebGL2 context and wires
 * context-loss/restore handling.
 */

/**
 * Memoized capability check — the runtime capability of a webview cannot
 * change during a session, so there is no reason to re-run the check on
 * every call. Mirrors webcodecsSupport.ts's isWebCodecsPreviewSupported()
 * memoization pattern exactly (module-level cache + a test-only reset).
 *
 * Unlike isWebCodecsPreviewSupported()'s simple `'X' in window` check,
 * WebGL2 support can't be answered by object-presence alone — a browser
 * can expose the WebGL2RenderingContext class while context creation still
 * fails for a given GPU/driver, so this actually attempts
 * canvas.getContext('webgl2') on a throwaway canvas, matching the spike's
 * own capability probe.
 */
let cachedSupport: boolean | null = null;

export function isWebGL2Supported(): boolean {
  if (cachedSupport !== null) return cachedSupport;
  cachedSupport = (() => {
    if (typeof document === 'undefined') return false;
    try {
      const canvas = document.createElement('canvas');
      return canvas.getContext('webgl2') !== null;
    } catch {
      return false;
    }
  })();
  return cachedSupport;
}

/** Test-only: clears the memoized result so a test can simulate a different runtime. */
export function __resetWebGL2SupportCacheForTests(): void {
  cachedSupport = null;
}

export interface AcquireGlContextOptions {
  /**
   * Default true. Image segments (still frames) and possible future
   * overlay-layer compositing (explicitly out of scope for this plan's
   * scoped effects — Section 5.4 — but not precluded architecturally) may
   * need per-pixel alpha; the cost of `alpha: true` when content ends up
   * fully opaque (the common case: video segments) is negligible. Exposed
   * so a caller can opt out if a future profiling pass finds it matters.
   */
  alpha?: boolean;
  /**
   * Default false. Nothing in this compositor's contract needs the
   * drawing buffer preserved after a draw — renderFrame's output is
   * consumed either by immediate on-screen presentation (preview) or, per
   * Section 4's export-readiness design, by constructing a `VideoFrame`
   * from the canvas within the same task the draw happened in. `readPixels`
   * (used only by this module's own tests, via a mock context) does not
   * depend on this flag.
   */
  preserveDrawingBuffer?: boolean;
  /**
   * Called when the context is lost (`webglcontextlost`). This module
   * always calls `event.preventDefault()` first — per spec, that is what
   * keeps the browser willing to restore the context later instead of
   * abandoning it permanently — then invokes this callback so the caller
   * (glCompositor.ts, via its owner) can react (e.g. stop issuing draw
   * calls until restored).
   */
  onContextLost?: (event: Event) => void;
  /**
   * Called when the context is restored (`webglcontextrestored`). This is
   * the signal glCompositor.ts's handleContextRestored() is wired to —
   * every GL resource (programs, textures, VAO) from the old context is
   * invalid and must be re-created against the new one.
   */
  onContextRestored?: () => void;
}

/**
 * Acquires a real WebGL2 context on `canvas` and wires context-loss/restore
 * listeners. Returns `null` if context creation fails (unsupported runtime,
 * exhausted GPU contexts, etc.) — callers must treat `null` as a hard
 * failure with no fallback rendering path, per the plan's no-fallback
 * constraint (Section 3.4): `isWebGL2Supported()` is a diagnostic, not a
 * router to a second maintained path.
 */
export function acquireGlContext(
  canvas: HTMLCanvasElement,
  options: AcquireGlContextOptions = {},
): WebGL2RenderingContext | null {
  const gl = canvas.getContext('webgl2', {
    alpha: options.alpha ?? true,
    preserveDrawingBuffer: options.preserveDrawingBuffer ?? false,
  }) as WebGL2RenderingContext | null;
  if (!gl) return null;

  canvas.addEventListener('webglcontextlost', (event) => {
    // Required by spec: an unhandled (non-prevented) loss event tells the
    // browser this context is not being managed and it will never fire
    // 'webglcontextrestored' — the context is abandoned permanently.
    event.preventDefault();
    options.onContextLost?.(event);
  });
  canvas.addEventListener('webglcontextrestored', () => {
    options.onContextRestored?.();
  });

  return gl;
}

export interface AcquireOffscreenGlContextOptions extends WebGLContextAttributes {
  /**
   * Called the moment the export worker's context is lost. Unlike
   * `acquireGlContext` above (preview, which wants to recover), this module
   * deliberately never calls `event.preventDefault()` inside its
   * `contextlost` listener. Per the same spec rule `acquireGlContext`'s own
   * `onContextLost` doc cites — an unhandled loss event is what leaves a
   * context abandoned rather than restorable — omitting `preventDefault()`
   * here GUARANTEES the browser will never fire `contextrestored` for this
   * context. That is exactly the plan's requirement (docs/webcodecs-export-plan.md
   * §4.1: "Worker OffscreenCanvas context loss is a hard fail … never a
   * silent restore-and-continue") enforced structurally, by construction,
   * rather than by a flag this module would otherwise have to remember to
   * check everywhere — there is no restore path to build, reason about, or
   * accidentally wire a dead listener for (the mistake the plan's §6 already
   * corrected once, for the on-screen `acquireGlContext` case). `onLost` is
   * invoked exactly once, synchronously, so the caller (exportWorker.ts) can
   * post a typed error and tear down immediately.
   */
  onLost?: (event: Event) => void;
}

/**
 * Acquires a real WebGL2 context on an `OffscreenCanvas` for the export
 * worker (docs/webcodecs-export-plan.md §4.1/§6). Additive sibling of
 * `acquireGlContext` above — that function is untouched, and its only
 * production caller (useGlPreview.ts) is unaffected by this addition.
 *
 * Deliberately a SEPARATE function rather than a widened `acquireGlContext`
 * signature: `OffscreenCanvas` fires the short-named `contextlost`/
 * `contextrestored` events, not the on-screen canvas's `webglcontextlost`/
 * `webglcontextrestored` — a signature-widening would have wired listeners
 * that never fire (the plan §6 correction to the original draft, which made
 * exactly this mistake).
 *
 * Returns `null` if context creation fails, same hard-failure contract as
 * `acquireGlContext` — there is no fallback rendering path for export either.
 */
export function acquireOffscreenGlContext(
  canvas: OffscreenCanvas,
  options: AcquireOffscreenGlContextOptions = {},
): WebGL2RenderingContext | null {
  const { onLost, ...contextAttributes } = options;
  const gl = canvas.getContext('webgl2', {
    desynchronized: true,
    ...contextAttributes,
  }) as WebGL2RenderingContext | null;
  if (!gl) return null;

  // No `contextrestored` listener: per this file's own onLost doc above, the
  // absence of `preventDefault()` in the listener below means the UA can
  // never dispatch one for this context — wiring a listener that can
  // provably never fire would repeat the exact mistake plan §6 corrected.
  canvas.addEventListener('contextlost', (event) => {
    onLost?.(event);
  });

  return gl;
}
