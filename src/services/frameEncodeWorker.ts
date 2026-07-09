/**
 * frameEncodeWorker.ts — off-main-thread PNG encoder for the export frame loop.
 *
 * Phase 7 Task 10 export speedup. Per docs/phase-7-task-1-export-profiling.md the
 * export is I/O-bound: `canvas.toBlob('image/png')` alone was 47% of per-frame
 * wall time on the main thread, blocking the next frame's render. This worker
 * moves the PNG encode off the main thread so it runs concurrently with the main
 * thread rendering the following frame (segmentEncoder.ts pipelines the dispatch).
 *
 * Contract (must stay pixel-exact vs. the old main-thread `canvas.toBlob` path):
 *   in : { id, buffer: ArrayBuffer (RGBA, transferred), width, height }
 *   out: { id, pngBuffer: ArrayBuffer (transferred) }  on success
 *        { id, error: string }                          on failure
 *
 * The RGBA bytes are produced main-side by `ctx.getImageData()` (sRGB,
 * non-premultiplied). `putImageData` writes them back verbatim and
 * `OffscreenCanvas.convertToBlob('image/png')` runs the same WebKit PNG encoder
 * the main-thread `toBlob` used, so the emitted PNG is byte-for-byte equivalent.
 */

interface EncodeRequest {
  id: number;
  buffer: ArrayBuffer;
  width: number;
  height: number;
}

// `self` in a dedicated worker; typed narrowly to avoid pulling in the
// "webworker" lib (which conflicts with the "DOM" lib this project compiles with).
const workerScope = self as unknown as {
  onmessage: ((e: MessageEvent<EncodeRequest>) => void) | null;
  postMessage: (message: unknown, transfer?: Transferable[]) => void;
};

// Reused across frames — a plain export renders every frame at the same W×H, so
// there's no need to reallocate the OffscreenCanvas per message.
let canvas: OffscreenCanvas | null = null;
let ctx: OffscreenCanvasRenderingContext2D | null = null;

workerScope.onmessage = async (e: MessageEvent<EncodeRequest>) => {
  const { id, buffer, width, height } = e.data;
  try {
    if (!canvas || canvas.width !== width || canvas.height !== height) {
      canvas = new OffscreenCanvas(width, height);
      ctx = canvas.getContext('2d');
    }
    if (!ctx) throw new Error('frameEncodeWorker: failed to get OffscreenCanvas 2D context');

    const imageData = new ImageData(new Uint8ClampedArray(buffer), width, height);
    ctx.putImageData(imageData, 0, 0);

    const blob = await canvas.convertToBlob({ type: 'image/png' });
    const pngBuffer = await blob.arrayBuffer();

    workerScope.postMessage({ id, pngBuffer }, [pngBuffer]);
  } catch (err) {
    workerScope.postMessage({
      id,
      error: err instanceof Error ? err.message : String(err),
    });
  }
};
