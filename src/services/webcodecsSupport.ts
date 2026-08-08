/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Capability check for the WebCodecs preview path (Section 1.6 / 3.2 of
 * docs/webcodecs-architecture-plan.md). Memoized — the runtime capability of
 * a webview cannot change during a session, so there is no reason to re-run
 * the check on every call.
 *
 * This is the sole gate deciding which preview path mounts in PreviewStage.tsx:
 * the WebCodecs path when this returns true, the legacy <video>-element path
 * as the fallback when it returns false (unsupported runtime).
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
