/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Phase 6 dev tool — runs the WebGL2 effects engine's verification checks
 * in-app (no terminal, no separate spike HTML page) so a non-developer can
 * confirm the engine actually works on their own machine. Every test is
 * independent and catches its own errors — one failing test must never stop
 * the rest from running, since the whole point is to show ALL results at
 * once (DevTestPanel.tsx renders every entry regardless of pass/fail).
 *
 * Deliberately reads glCompositor.ts/compositeParams.ts/glContext.ts as
 * black boxes through their existing public API — nothing here modifies
 * those files.
 */

import { GlCompositor, IDENTITY_TEX_RECT } from '../../services/gl/glCompositor';
import { acquireGlContext, isWebGL2Supported } from '../../services/gl/glContext';
import { NEUTRAL_GRADE, type CompositeParams } from '../../services/gl/compositeParams';

const SHADER_PROGRAM_NAMES = ['blit', 'crossDissolve', 'dip', 'lightLeak', 'zoom', 'grade'] as const;

const TEST_CANVAS_SIZE = 64;
const THROUGHPUT_ITERATIONS = 100;
/** A pixel is considered "matching" when every channel is within this many
 *  levels (0-255) — covers ordinary LINEAR-filter edge blur and channel
 *  rounding, not a real mismatch. */
const PIXEL_MATCH_TOLERANCE = 12;

export interface TestResult {
  pass: boolean;
  details: string;
  error?: string;
}

export interface Phase6SpikeResults {
  webgl2Support: TestResult;
  shaderCompile: TestResult & { programs: readonly string[] };
  videoFrameUpload: TestResult;
  pixelProof: TestResult & { matchPercent: number | null; maxDiff: number | null };
  throughput: TestResult & { fps: number | null; iterations: number };
  ranAt: string;
}

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

function buildQuadrantTestCanvas(size: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D context unavailable for synthetic test canvas');
  const half = size / 2;
  ctx.fillStyle = '#ff3b30';
  ctx.fillRect(0, 0, half, half);
  ctx.fillStyle = '#34c759';
  ctx.fillRect(half, 0, half, half);
  ctx.fillStyle = '#007aff';
  ctx.fillRect(0, half, half, half);
  ctx.fillStyle = '#ffcc00';
  ctx.fillRect(half, half, half, half);
  return canvas;
}

/** gl.readPixels rows run bottom-up; canvas/VideoFrame content is top-down. */
function flipRowsRGBA(src: Uint8Array, width: number, height: number): Uint8ClampedArray {
  const out = new Uint8ClampedArray(width * height * 4);
  const rowBytes = width * 4;
  for (let y = 0; y < height; y++) {
    const srcRow = height - 1 - y;
    out.set(src.subarray(srcRow * rowBytes, srcRow * rowBytes + rowBytes), y * rowBytes);
  }
  return out;
}

/** Extracts top-down RGBA pixels from a VideoFrame. Prefers copyTo() (per-plane
 *  layout aware, handles BGRA/RGBX variants); falls back to drawing the frame
 *  onto a throwaway 2D canvas and reading it back when copyTo isn't usable
 *  (unexpected multi-plane format, or the API is missing on this runtime). */
async function extractVideoFramePixels(
  frame: VideoFrame,
  width: number,
  height: number,
): Promise<Uint8ClampedArray> {
  const format = frame.format;
  const singlePlaneRgb = format === 'RGBA' || format === 'RGBX' || format === 'BGRA' || format === 'BGRX';

  if (typeof frame.copyTo === 'function' && singlePlaneRgb) {
    const byteLength = frame.allocationSize();
    const buffer = new Uint8Array(byteLength);
    const layouts = await frame.copyTo(buffer);
    const layout = layouts[0]!;
    const swapRB = format === 'BGRA' || format === 'BGRX';
    const out = new Uint8ClampedArray(width * height * 4);
    for (let y = 0; y < height; y++) {
      const rowStart = layout.offset + y * layout.stride;
      for (let x = 0; x < width; x++) {
        const srcIdx = rowStart + x * 4;
        const dstIdx = (y * width + x) * 4;
        if (swapRB) {
          out[dstIdx] = buffer[srcIdx + 2]!;
          out[dstIdx + 1] = buffer[srcIdx + 1]!;
          out[dstIdx + 2] = buffer[srcIdx]!;
          out[dstIdx + 3] = buffer[srcIdx + 3]!;
        } else {
          out[dstIdx] = buffer[srcIdx]!;
          out[dstIdx + 1] = buffer[srcIdx + 1]!;
          out[dstIdx + 2] = buffer[srcIdx + 2]!;
          out[dstIdx + 3] = buffer[srcIdx + 3]!;
        }
      }
    }
    return out;
  }

  const tmp = document.createElement('canvas');
  tmp.width = width;
  tmp.height = height;
  const ctx2d = tmp.getContext('2d');
  if (!ctx2d) throw new Error('2D fallback context unavailable for VideoFrame readback');
  ctx2d.drawImage(frame, 0, 0, width, height);
  return ctx2d.getImageData(0, 0, width, height).data;
}

function comparePixels(
  a: Uint8ClampedArray,
  b: Uint8ClampedArray,
): { matchPercent: number; maxDiff: number } {
  const n = Math.min(a.length, b.length);
  const totalPixels = n / 4;
  let matching = 0;
  let maxDiff = 0;
  for (let i = 0; i < n; i += 4) {
    let pixelMax = 0;
    for (let c = 0; c < 4; c++) {
      const d = Math.abs(a[i + c]! - b[i + c]!);
      if (d > pixelMax) pixelMax = d;
    }
    if (pixelMax > maxDiff) maxDiff = pixelMax;
    if (pixelMax <= PIXEL_MATCH_TOLERANCE) matching++;
  }
  return { matchPercent: totalPixels > 0 ? (matching / totalPixels) * 100 : 0, maxDiff };
}

const MINIMAL_PARAMS: CompositeParams = { transition: null, animScaleA: 1, animScaleB: 1, grade: NEUTRAL_GRADE };

/**
 * Runs all Phase 6 spike tests in sequence and returns a fully populated
 * results object — every field is always present (never throws), so the
 * caller can render every row regardless of what failed.
 */
export async function runPhase6Spike(): Promise<Phase6SpikeResults> {
  const results: Phase6SpikeResults = {
    webgl2Support: { pass: false, details: '' },
    shaderCompile: { pass: false, details: '', programs: SHADER_PROGRAM_NAMES },
    videoFrameUpload: { pass: false, details: '' },
    pixelProof: { pass: false, details: '', matchPercent: null, maxDiff: null },
    throughput: { pass: false, details: '', fps: null, iterations: THROUGHPUT_ITERATIONS },
    ranAt: new Date().toISOString(),
  };

  // (a) WebGL2 support ---------------------------------------------------
  try {
    const supported = isWebGL2Supported();
    results.webgl2Support = {
      pass: supported,
      details: supported
        ? 'WebGL2 context can be created on this device.'
        : 'WebGL2 is not available on this device — the compositor cannot run at all.',
    };
  } catch (e) {
    results.webgl2Support = { pass: false, details: 'The support check itself threw an error.', error: errMsg(e) };
  }

  if (!results.webgl2Support.pass) {
    const skipped = 'Skipped — WebGL2 is unavailable, so nothing downstream can run.';
    results.shaderCompile = { pass: false, details: skipped, programs: SHADER_PROGRAM_NAMES };
    results.videoFrameUpload = { pass: false, details: skipped };
    results.pixelProof = { pass: false, details: skipped, matchPercent: null, maxDiff: null };
    results.throughput = { pass: false, details: skipped, fps: null, iterations: 0 };
    return results;
  }

  // Shared hidden canvas + context + compositor for tests (b)-(e). Kept out
  // of the DOM entirely — a detached canvas is enough for a real GPU context.
  let gl: WebGL2RenderingContext | null = null;
  let compositor: GlCompositor | null = null;

  // (b) all 6 shader programs compile -------------------------------------
  try {
    const canvas = document.createElement('canvas');
    canvas.width = TEST_CANVAS_SIZE;
    canvas.height = TEST_CANVAS_SIZE;
    gl = acquireGlContext(canvas);
    if (!gl) throw new Error('acquireGlContext returned null on a WebGL2-capable device');
    gl.getError(); // clear any stale error before we start attributing one to construction
    compositor = new GlCompositor(gl);
    const err = gl.getError();
    if (err !== gl.NO_ERROR) throw new Error(`GL error 0x${err.toString(16)} after compositor construction`);
    results.shaderCompile = {
      pass: true,
      details: 'All 6 shader programs (blit, cross-dissolve, dip, light-leak, zoom, grade) compiled and linked with no GL error.',
      programs: SHADER_PROGRAM_NAMES,
    };
  } catch (e) {
    results.shaderCompile = {
      pass: false,
      details: 'GlCompositor construction failed — at least one shader did not compile or link.',
      programs: SHADER_PROGRAM_NAMES,
      error: errMsg(e),
    };
  }

  // (c) VideoFrame -> GPU texture upload -----------------------------------
  if (gl && compositor) {
    const g = gl;
    const c = compositor;
    try {
      const srcCanvas = document.createElement('canvas');
      srcCanvas.width = TEST_CANVAS_SIZE;
      srcCanvas.height = TEST_CANVAS_SIZE;
      const ctx2d = srcCanvas.getContext('2d');
      if (!ctx2d) throw new Error('2D context unavailable for synthetic VideoFrame source');
      ctx2d.fillStyle = '#3366ff';
      ctx2d.fillRect(0, 0, TEST_CANVAS_SIZE, TEST_CANVAS_SIZE);
      const frame = new VideoFrame(srcCanvas, { timestamp: 0 });
      try {
        g.getError();
        c.uploadFrame('a', frame, IDENTITY_TEX_RECT);
        const err = g.getError();
        if (err !== g.NO_ERROR) throw new Error(`GL error 0x${err.toString(16)} after uploadFrame`);
        results.videoFrameUpload = {
          pass: true,
          details: 'A synthetic VideoFrame (from a canvas) uploaded to the GPU texture slot with no GL error.',
        };
      } finally {
        frame.close();
      }
    } catch (e) {
      results.videoFrameUpload = { pass: false, details: 'VideoFrame -> GPU texture upload failed.', error: errMsg(e) };
    }
  } else {
    results.videoFrameUpload = { pass: false, details: 'Skipped — the compositor from test (b) is unavailable.' };
  }

  // (d) canvas -> VideoFrame pixel proof ------------------------------------
  if (gl && compositor) {
    const g = gl;
    const c = compositor;
    try {
      const testCanvas = buildQuadrantTestCanvas(TEST_CANVAS_SIZE);
      const testFrame = new VideoFrame(testCanvas, { timestamp: 0 });
      try {
        c.uploadFrame('a', testFrame, IDENTITY_TEX_RECT);
      } finally {
        testFrame.close();
      }
      c.renderFrame(MINIMAL_PARAMS);

      const glPixelsRaw = new Uint8Array(TEST_CANVAS_SIZE * TEST_CANVAS_SIZE * 4);
      g.readPixels(0, 0, TEST_CANVAS_SIZE, TEST_CANVAS_SIZE, g.RGBA, g.UNSIGNED_BYTE, glPixelsRaw);
      const glPixels = flipRowsRGBA(glPixelsRaw, TEST_CANVAS_SIZE, TEST_CANVAS_SIZE);

      // Constructing this in the same task the draw happened in is exactly
      // the export-readiness contract glContext.ts documents for readPixels.
      const outputFrame = new VideoFrame(g.canvas as HTMLCanvasElement, { timestamp: 0 });
      let framePixels: Uint8ClampedArray;
      try {
        framePixels = await extractVideoFramePixels(outputFrame, TEST_CANVAS_SIZE, TEST_CANVAS_SIZE);
      } finally {
        outputFrame.close();
      }

      const { matchPercent, maxDiff } = comparePixels(glPixels, framePixels);
      const pass = matchPercent >= 90;
      results.pixelProof = {
        pass,
        details: `Compared gl.readPixels against a VideoFrame built from the same canvas: ${matchPercent.toFixed(1)}% of pixels matched within tolerance (±${PIXEL_MATCH_TOLERANCE}/channel), max channel diff ${maxDiff}.`,
        matchPercent,
        maxDiff,
      };
    } catch (e) {
      results.pixelProof = { pass: false, details: 'Pixel proof failed.', matchPercent: null, maxDiff: null, error: errMsg(e) };
    }
  } else {
    results.pixelProof = { pass: false, details: 'Skipped — the compositor from test (b) is unavailable.', matchPercent: null, maxDiff: null };
  }

  // (e) throughput -----------------------------------------------------------
  if (gl && compositor) {
    const g = gl;
    const c = compositor;
    try {
      const bitmapCanvas = buildQuadrantTestCanvas(TEST_CANVAS_SIZE);
      const bitmap = await createImageBitmap(bitmapCanvas);
      const start = performance.now();
      for (let i = 0; i < THROUGHPUT_ITERATIONS; i++) {
        c.uploadFrame('a', bitmap, IDENTITY_TEX_RECT);
        c.renderFrame(MINIMAL_PARAMS);
      }
      g.finish(); // force the queued GPU work to complete before we stop the clock
      const elapsedMs = performance.now() - start;
      bitmap.close();
      const fps = THROUGHPUT_ITERATIONS / (elapsedMs / 1000);
      results.throughput = {
        pass: fps >= 24,
        details: `${THROUGHPUT_ITERATIONS} upload+render cycles took ${elapsedMs.toFixed(1)}ms -> ${fps.toFixed(1)} fps.`,
        fps,
        iterations: THROUGHPUT_ITERATIONS,
      };
    } catch (e) {
      results.throughput = {
        pass: false,
        details: 'Throughput measurement failed.',
        fps: null,
        iterations: THROUGHPUT_ITERATIONS,
        error: errMsg(e),
      };
    }
  } else {
    results.throughput = { pass: false, details: 'Skipped — the compositor from test (b) is unavailable.', fps: null, iterations: 0 };
  }

  try {
    compositor?.dispose();
  } catch {
    // best-effort cleanup only — a dispose failure shouldn't hide the actual test results
  }

  return results;
}

/** Human-readable, copy/paste-friendly text version of the results — used by
 *  DevTestPanel's "Copy Results" button. */
export function formatResultsAsText(results: Phase6SpikeResults): string {
  const line = (label: string, r: TestResult): string =>
    `${r.pass ? 'PASS' : 'FAIL'}  ${label}\n  ${r.details}${r.error ? `\n  error: ${r.error}` : ''}`;

  return [
    `Phase 6 WebGL2 Spike Results — ${results.ranAt}`,
    '',
    line('WebGL2 support', results.webgl2Support),
    '',
    line(`Shader compile (${results.shaderCompile.programs.join(', ')})`, results.shaderCompile),
    '',
    line('VideoFrame -> GPU texture upload', results.videoFrameUpload),
    '',
    line('Canvas -> VideoFrame pixel proof', results.pixelProof) +
      (results.pixelProof.matchPercent !== null
        ? `\n  match: ${results.pixelProof.matchPercent.toFixed(1)}%, max diff: ${results.pixelProof.maxDiff}`
        : ''),
    '',
    line('Throughput', results.throughput) + (results.throughput.fps !== null ? `\n  fps: ${results.throughput.fps.toFixed(1)}` : ''),
  ].join('\n');
}
