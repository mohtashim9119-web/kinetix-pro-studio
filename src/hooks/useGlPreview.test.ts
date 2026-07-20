import { describe, it, expect } from 'vitest';
import { computeObjectCoverUvRect } from './useGlPreview';

/**
 * Pure-function tests, mock-free — the useGlPreview hook itself can't be
 * unit-tested (this repo has no jsdom/@testing-library/react, same precedent
 * as useWebCodecsPreview.test.ts / compositeParams.test.ts), so its pure,
 * export-reusable helper is tested directly against inputs/outputs. This is
 * the object-cover crop math both PreviewCanvas.tsx and the legacy
 * `<video className="object-cover">` use, now expressed in the source's own
 * UV space (uOffset/vOffset/uScale/vScale) for direct upload to
 * shaders.ts's u_texRectA/u_texRectB uniform — replacing the earlier
 * pixel-rect form that fed a CPU-canvas pre-fit step, removed after it was
 * found to cause a severe WKWebView performance regression (see
 * docs/history.md (WebGL2 Effects Engine — Full Plan, archived 2026-07-20) Section 7's [CORRECTED] object-cover row).
 */

describe('computeObjectCoverUvRect', () => {
  it('same aspect (16:9 source into 16:9 destination): identity — no crop, full [0,1] UV', () => {
    const r = computeObjectCoverUvRect(1280, 720, 1920, 1080);
    expect(r).toEqual({ uOffset: 0, vOffset: 0, uScale: 1, vScale: 1 });
  });

  it('wider-than-destination source: crops horizontally (uScale < 1, centered uOffset), full vScale', () => {
    // 2:1 source (2000x1000) into 1:1 destination (1000x1000): keep full
    // height (vScale=1, vOffset=0), crop width to 1000/2000=0.5 of the
    // source, centered — uOffset = (1 - 0.5) / 2 = 0.25.
    const r = computeObjectCoverUvRect(2000, 1000, 1000, 1000);
    expect(r.vScale).toBe(1);
    expect(r.vOffset).toBe(0);
    expect(r.uScale).toBeCloseTo(0.5, 6);
    expect(r.uOffset).toBeCloseTo(0.25, 6);
  });

  it('taller-than-destination source: crops vertically (vScale < 1, centered vOffset), full uScale', () => {
    // 1:2 source (1000x2000) into 1:1 destination: keep full width
    // (uScale=1, uOffset=0), crop height to 1000/2000=0.5, vOffset=0.25.
    const r = computeObjectCoverUvRect(1000, 2000, 1000, 1000);
    expect(r.uScale).toBe(1);
    expect(r.uOffset).toBe(0);
    expect(r.vScale).toBeCloseTo(0.5, 6);
    expect(r.vOffset).toBeCloseTo(0.25, 6);
  });

  it('portrait source into landscape destination: keeps full uScale, crops top/bottom', () => {
    // 720x1280 (9:16) into 1920x1080 (16:9): srcRatio 0.5625 < dstRatio
    // 1.777, so keep full width (uScale=1), crop height to
    // (720/1.777)/1280 ≈ 0.3164, vOffset = (1 - 0.3164)/2 ≈ 0.3418.
    const r = computeObjectCoverUvRect(720, 1280, 1920, 1080);
    const expectedShPx = 720 / (1920 / 1080);
    expect(r.uScale).toBe(1);
    expect(r.uOffset).toBe(0);
    expect(r.vScale).toBeCloseTo(expectedShPx / 1280, 6);
    expect(r.vOffset).toBeCloseTo((1280 - expectedShPx) / 2 / 1280, 6);
  });

  it('matches PreviewCanvas.tsx\'s own cover math exactly (frameRatio vs canvasRatio branch, same crop), converted to UV space, so the GL path and the legacy canvas fill the stage identically', () => {
    // Reproduce PreviewCanvas.tsx's inline pixel-rect computation for the
    // same inputs, then convert to UV by dividing by the source dimensions —
    // the same conversion computeObjectCoverUvRect performs internally.
    const frameW = 1600;
    const frameH = 900;
    const canvasW = 800;
    const canvasH = 800;
    const canvasRatio = canvasW / canvasH;
    const frameRatio = frameW / frameH;
    let sx = 0;
    let sy = 0;
    let sw = frameW;
    let sh = frameH;
    if (frameRatio > canvasRatio) {
      sw = frameH * canvasRatio;
      sx = (frameW - sw) / 2;
    } else {
      sh = frameW / canvasRatio;
      sy = (frameH - sh) / 2;
    }
    const expected = { uOffset: sx / frameW, vOffset: sy / frameH, uScale: sw / frameW, vScale: sh / frameH };
    expect(computeObjectCoverUvRect(frameW, frameH, canvasW, canvasH)).toEqual(expected);
  });

  it('the returned rect always samples within [0,1]: uOffset+uScale<=1 and vOffset+vScale<=1 (no out-of-bounds source read)', () => {
    for (const [srcW, srcH, dstW, dstH] of [
      [1280, 720, 1920, 1080],
      [2000, 1000, 1000, 1000],
      [1000, 2000, 1000, 1000],
      [720, 1280, 1920, 1080],
      [3840, 2160, 800, 600],
    ] as const) {
      const r = computeObjectCoverUvRect(srcW, srcH, dstW, dstH);
      expect(r.uOffset + r.uScale).toBeLessThanOrEqual(1 + 1e-9);
      expect(r.vOffset + r.vScale).toBeLessThanOrEqual(1 + 1e-9);
      expect(r.uOffset).toBeGreaterThanOrEqual(0);
      expect(r.vOffset).toBeGreaterThanOrEqual(0);
    }
  });
});

// --- Bug 4 fix (cold-load black screen): GL-init effect re-fire mechanism ----
//
// PARTIAL COVERAGE NOTE: this repo has no jsdom/happy-dom/@testing-library/
// react/react-test-renderer (confirmed absent from node_modules), so
// useGlPreview cannot actually be rendered and observed here — same
// limitation this file's own header comment already documents for
// computeObjectCoverUvRect. The tests below do NOT render the hook or prove
// React itself re-invokes the effect; they mechanically re-state React's own
// documented dependency-array shallow-compare (Object.is per entry) applied
// to the EXACT before/after shapes this fix changes, so the specific claim
// "adding canvasNode to the deps array is what makes the difference in the
// cold-load-already-enabled scenario" is at least verified as arithmetically
// true, independent of trusting a manual read of the diff. Real end-to-end
// confirmation still requires the real Tauri app (per the prior audit) or a
// future jsdom-based render harness (a separate, not-yet-made decision).
describe('GL-init effect dependency-array shallow-compare — pure re-statement of the Bug 4 fix mechanism', () => {
  /** React re-invokes a useLayoutEffect/useEffect exactly when at least one
   *  entry of its dependency array differs (Object.is) from the previous
   *  render's array — this is a direct restatement of that rule, not
   *  production logic (useGlPreview.ts never calls this; React does the
   *  equivalent comparison internally). */
  function depsChanged(prevDeps: readonly unknown[], nextDeps: readonly unknown[]): boolean {
    return prevDeps.length !== nextDeps.length || prevDeps.some((prev, i) => !Object.is(prev, nextDeps[i]));
  }

  it('pre-fix shape ([enabled] only): canvas attaching after enabled was already true leaves the deps unchanged — effect would NOT re-fire (reproduces Bug 4)', () => {
    // Render 1 (cold load, dev toggle persisted true): enabled=true, canvas
    // not yet mounted. Render 2 (currentSegment/canvas hydrate): enabled is
    // STILL true (never transitioned), and the pre-fix deps array [enabled]
    // has no way to see the canvas at all.
    const prevDeps = [true];
    const nextDeps = [true];
    expect(depsChanged(prevDeps, nextDeps)).toBe(false);
  });

  it('post-fix shape ([enabled, canvasNode]): the same canvas-attach transition DOES change the deps — effect correctly re-fires', () => {
    const prevDeps = [true, null];
    const nextDeps = [true, {} as HTMLCanvasElement]; // any distinct reference stands in for "the canvas mounted"
    expect(depsChanged(prevDeps, nextDeps)).toBe(true);
  });

  it('the pre-fix OFF->ON toggle workaround also changes the deps (both pre- and post-fix) — confirms why toggling always happened to recover, independent of canvas timing', () => {
    const prevDeps = [false];
    const nextDeps = [true];
    expect(depsChanged(prevDeps, nextDeps)).toBe(true);

    const prevDepsWithCanvas = [false, {} as HTMLCanvasElement];
    const nextDepsWithCanvas = [true, {} as HTMLCanvasElement];
    expect(depsChanged(prevDepsWithCanvas, nextDepsWithCanvas)).toBe(true);
  });

  it('residual gap (per-tick render effect, paused session): canvas attaching while every OTHER dependency stays identical still changes deps once canvasNode is included, closing the gap the mount-effect-only fix would have left', () => {
    // Models the render effect's larger dependency array collapsed to just
    // the two values relevant to this scenario (enabled, canvasNode) plus a
    // stand-in for "everything else" (currentTime) staying frozen — the
    // paused-at-the-exact-hydration-moment case flagged in the Phase 1 audit.
    const prevDeps = [true, null, 0]; // enabled, canvasNode, currentTime
    const nextDeps = [true, {} as HTMLCanvasElement, 0]; // canvas attaches; currentTime unchanged (paused)
    expect(depsChanged(prevDeps, nextDeps)).toBe(true);

    // Without canvasNode in the array (the pre-fix shape for this effect),
    // the same paused/late-attach scenario would NOT have re-fired it.
    const prevDepsNoCanvas = [true, 0]; // enabled, currentTime
    const nextDepsNoCanvas = [true, 0];
    expect(depsChanged(prevDepsNoCanvas, nextDepsNoCanvas)).toBe(false);
  });
});
