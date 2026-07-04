/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Capability check for the WebCodecs preview path (Section 1.6 / 3.2 of
 * docs/webcodecs-architecture-plan.md). Memoized — the runtime capability of
 * a webview cannot change during a session, so there is no reason to re-run
 * the check on every call.
 *
 * Phase 1+2: combined with an explicit dev-only toggle at the call site
 * (PreviewStage.tsx) so the new path never activates for real users during
 * development. Phase 7 removes that toggle and makes this the sole gate.
 */

let cachedSupport: boolean | null = null;

export function isWebCodecsPreviewSupported(): boolean {
  if (cachedSupport !== null) return cachedSupport;
  cachedSupport =
    typeof window !== 'undefined' &&
    'VideoDecoder' in window &&
    'EncodedVideoChunk' in window;
  return cachedSupport;
}

/** Test-only: clears the memoized result so a test can simulate a different runtime. */
export function __resetWebCodecsSupportCacheForTests(): void {
  cachedSupport = null;
}
