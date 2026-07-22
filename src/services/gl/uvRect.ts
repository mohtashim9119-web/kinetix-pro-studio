/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Object-cover / object-contain UV-rect math — moved verbatim out of
 * src/hooks/useGlPreview.ts (docs/webcodecs-export-plan.md §4.5) so the
 * WebCodecs export worker (src/services/webcodecsExport/exportWorker.ts) can
 * use the same cover-fit math useGlPreview.ts already pixel-verified, without
 * importing a React hook module (a worker must not pull in React/DOM). Pure
 * move: no logic, variable name, or comment inside either function changed —
 * useGlPreview.ts now imports both from here instead of defining them.
 */

import type { TexRect } from './glCompositor';

/**
 * object-cover UV-crop rect — the exact crop math PreviewCanvas.tsx and the
 * legacy `<video className="object-cover">`/`<img>` use (scale to fill,
 * center-crop the overflowing axis), expressed in the SOURCE's own [0,1] UV
 * space rather than destination pixels, so it can be fed directly to
 * GlCompositor.uploadFrame's texRect param and wired as shaders.ts's
 * u_texRectA/u_texRectB uniform (see that file's doc comment for the
 * mechanism and why: a CPU-side pixel-rect pre-fit onto an intermediate 2D
 * canvas — this function's original form, and the ONLY reason a canvas hop
 * ever existed in this hook — measured 36-58ms/frame on WKWebView, ~1800-
 * 2900x slower than uploading the raw source directly; see
 * docs/history.md (WebGL2 Effects Engine — Full Plan, archived 2026-07-20) Section 7's [CORRECTED] object-cover row).
 *
 * Pure and dependency-free so it's directly unit-testable (see
 * useGlPreview.test.ts), same discipline as toSourceTime/computeKeepSet.
 * Same-aspect source/destination yields identity (0,0,1,1) — full [0,1] UV,
 * no crop.
 */
export function computeObjectCoverUvRect(
  srcW: number,
  srcH: number,
  dstW: number,
  dstH: number,
): TexRect {
  const dstRatio = dstW / dstH;
  const srcRatio = srcW / srcH;
  let sx = 0;
  let sy = 0;
  let sw = srcW;
  let sh = srcH;
  if (srcRatio > dstRatio) {
    sw = srcH * dstRatio;
    sx = (srcW - sw) / 2;
  } else {
    sh = srcW / dstRatio;
    sy = (srcH - sh) / 2;
  }
  return { uOffset: sx / srcW, vOffset: sy / srcH, uScale: sw / srcW, vScale: sh / srcH };
}

/**
 * object-contain UV rect — the preview-frame counterpart to
 * computeObjectCoverUvRect above (kept alongside it; export's canvas pipeline
 * still uses cover-fill via frameRenderer.ts's drawImageCover, untouched).
 * Scales so the WHOLE source fits inside the destination, letterboxing
 * (bars top/bottom) or pillarboxing (bars left/right) the other axis instead
 * of cropping it.
 *
 * Unlike cover, this rect's uOffset/uScale can push `v_uv * uScale + uOffset`
 * outside [0,1] for the bar region — that's intentional: the BLIT fragment
 * shader (shaders.ts) treats an out-of-[0,1] uv as "outside the frame" and
 * paints it black rather than sampling (which CLAMP_TO_EDGE would otherwise
 * stretch). Same-aspect source/destination still yields identity (0,0,1,1).
 */
export function computeObjectContainUvRect(
  srcW: number,
  srcH: number,
  dstW: number,
  dstH: number,
): TexRect {
  const dstRatio = dstW / dstH;
  const srcRatio = srcW / srcH;
  let uOffset = 0;
  let vOffset = 0;
  let uScale = 1;
  let vScale = 1;
  if (srcRatio > dstRatio) {
    // Source proportionally wider than destination — fits by width,
    // letterboxed top/bottom.
    vScale = srcRatio / dstRatio;
    vOffset = -(vScale - 1) / 2;
  } else if (srcRatio < dstRatio) {
    // Source proportionally taller/narrower than destination — fits by
    // height, pillarboxed left/right.
    uScale = dstRatio / srcRatio;
    uOffset = -(uScale - 1) / 2;
  }
  return { uOffset, vOffset, uScale, vScale };
}
