/**
 * D10 fix — resolves once a video element has actually painted a frame at
 * its current seek target, not merely "buffered enough to maybe play" (all
 * 'canplay' guarantees — it can fire before anything is decoded/presented,
 * which is why an earlier canplay-based mitigation for the preview
 * transition black-flash never engaged reliably).
 *
 * Originally built for the preview path (PreviewStage.tsx); also used by
 * frameRenderer.ts's export-side seekVideo to close the same seek/paint race
 * on the canvas-composited export pipeline (residual export judder audit).
 *
 * Fallback chain: requestVideoFrameCallback (fires only after a frame is
 * submitted for compositing) -> 'seeked' + one rAF tick as a best-effort
 * proxy on engines without rVFC -> a fixed timeout so callers never hang.
 * Never rejects.
 */
export function waitForVideoFrame(video: HTMLVideoElement): Promise<void> {
  return new Promise<void>((resolve) => {
    let settled = false;
    let rvfcHandle: number | undefined;
    let onSeeked: (() => void) | undefined;

    const rvfcVideo = video as HTMLVideoElement & {
      requestVideoFrameCallback?: (callback: () => void) => number;
      cancelVideoFrameCallback?: (handle: number) => void;
    };

    const cleanup = () => {
      clearTimeout(timeoutId);
      if (rvfcHandle !== undefined) {
        rvfcVideo.cancelVideoFrameCallback?.(rvfcHandle);
      }
      if (onSeeked) {
        video.removeEventListener('seeked', onSeeked);
      }
    };

    const finish = () => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve();
    };

    if (typeof rvfcVideo.requestVideoFrameCallback === 'function') {
      rvfcHandle = rvfcVideo.requestVideoFrameCallback(() => finish());
    } else {
      onSeeked = () => requestAnimationFrame(() => finish());
      video.addEventListener('seeked', onSeeked);
    }

    const timeoutId = setTimeout(finish, 400);
  });
}
