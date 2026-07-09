/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * WebGL2 context acquisition on a caller-supplied canvas
 * (docs/webgl-architecture-plan.md Section 6, Phase 1). This module does
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
