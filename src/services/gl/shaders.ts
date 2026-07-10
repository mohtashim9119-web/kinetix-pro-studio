/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * GLSL ES 3.0 shader sources for the WebGL2 effects compositor
 * (docs/webgl-architecture-plan.md Section 6, Phase 1). These are the exact
 * six effects already pixel-verified on both Chromium and the real Tauri
 * WKWebView by src/dev/webglFeasibilitySpike/main.ts (Section 2.2 of the
 * plan) — promoted here as the permanent source of truth, cleaned up and
 * commented, not re-derived. Do not change the math in these shaders
 * without re-running (or re-deriving equivalent evidence for) that spike's
 * pixel checks — a "prettier" but different result is a regression per the
 * plan's Risk Register (Phase 2 row).
 *
 * Every fragment shader takes its source content via `u_texA`/`u_texB`
 * (never a `<video>` element) — see glCompositor.ts's TextureSlot contract.
 */

/** Shared fullscreen-triangle vertex shader. UV is Y-flipped so top-left-
 *  origin video/image content (the same orientation every other renderer in
 *  this app assumes) reads upright. */
export const VERTEX_SHADER_SOURCE = `#version 300 es
layout(location = 0) in vec2 a_pos;
out vec2 v_uv;
void main() {
  v_uv = vec2(a_pos.x * 0.5 + 0.5, 0.5 - a_pos.y * 0.5);
  gl_Position = vec4(a_pos, 0.0, 1.0);
}`;

/** Straight (non-flipped) variant of the fullscreen-triangle vertex shader —
 *  identical to VERTEX_SHADER_SOURCE except the v_uv.y line. Used only by
 *  programs that sample a render-target texture (glCompositor.ts's
 *  drawZoom/drawGrade), never a raw VideoFrame/ImageBitmap upload.
 *
 *  Why two variants: VERTEX_SHADER_SOURCE's Y-flip compensates for
 *  gl.texImage2D's upload convention (a CPU/VideoFrame source's row 0 — its
 *  visual top — lands at texel row 0, needing exactly one flip to display
 *  upright). An FBO-rendered texture has no such mismatch — its row order
 *  already matches window-row order, since the fragment that wrote each
 *  texel came from ordinary window-space rasterization. Reusing the flipped
 *  shader on an FBO-sourced pass flips it AGAIN. Confirmed empirically
 *  (Phase 2 Step 1 real-GPU smoke test, docs/webgl-architecture-plan.md):
 *  every 2-draw chain (zoom-only or grade-only) rendered upside-down, while
 *  1-draw (skip path) and 3-draw (transition+zoom+grade together) chains
 *  came out correct by flip-parity coincidence. drawStage1 — the only pass
 *  that ever samples texA/texB directly — keeps the flipped shader;
 *  drawZoom/drawGrade — which in this compositor's actual call graph only
 *  ever sample a render target (see renderFrame's chain shape) — use this
 *  variant instead, so the total flip count is always exactly one
 *  regardless of chain length. */
export const VERTEX_SHADER_SOURCE_STRAIGHT = `#version 300 es
layout(location = 0) in vec2 a_pos;
out vec2 v_uv;
void main() {
  v_uv = vec2(a_pos.x * 0.5 + 0.5, a_pos.y * 0.5 + 0.5);
  gl_Position = vec4(a_pos, 0.0, 1.0);
}`;

/**
 * u_texRectA/u_texRectB — object-cover UV-crop rects, (uOffset, vOffset,
 * uScale, vScale). Added to fix a WKWebView performance regression (see
 * docs/webgl-architecture-plan.md Section 7's object-cover risk-register row,
 * [CORRECTED] annotation): a CPU-side 2D-canvas pre-fit + texImage2D(canvas)
 * step was ~1800-2900x slower than a direct texImage2D(VideoFrame) upload on
 * WKWebView/ANGLE-Metal (36-58ms/frame vs 2.82ms), capping throughput below
 * 30fps before anything else in the render loop ran. This uniform lets the
 * shader crop directly in UV space against the raw uploaded texture — the
 * caller (useGlPreview.ts's computeObjectCoverUvRect) computes the same
 * object-cover math previously done by a CPU canvas draw, now expressed as a
 * texture-space rect: `texture(u_texA, v_uv * u_texRectA.zw + u_texRectA.xy)`.
 * Identity `(0,0,1,1)` — the default whenever GlCompositor.uploadFrame is
 * called without an explicit rect — reduces to `v_uv * 1 + 0 = v_uv`, byte-
 * identical to the pre-crop math, so this is purely additive: every existing
 * pixel-verified assertion for these 4 shaders (Phase 0 spike, Phase 2 Step 1
 * real-GPU check) holds unmodified at the identity default.
 *
 * Only the 4 drawStage1 programs (blit, cross-dissolve, dip, light-leak) gain
 * this uniform — they're the only ones that ever sample u_texA/u_texB
 * directly (raw uploaded content); zoom/grade only ever sample an
 * already-cropped rt0/rt1 render target in this compositor's actual call
 * graph (confirmed via grep before this change, same discipline as Phase 2
 * Step 1's flip-fix), so they are unchanged.
 */

/** Single-texture straight blit — used when no transition is active this
 *  tick (renders slot 'a' alone) and as the first stage of the pass chain
 *  in that case. */
export const BLIT_FRAGMENT_SHADER_SOURCE = `#version 300 es
precision mediump float;
in vec2 v_uv;
out vec4 o_color;
uniform sampler2D u_texA;
uniform vec4 u_texRectA; // (uOffset, vOffset, uScale, vScale)
void main() {
  vec2 uvA = v_uv * u_texRectA.zw + u_texRectA.xy;
  o_color = texture(u_texA, uvA);
}`;

/** cross-dissolve: linear mix of the outgoing (A) and incoming (B) textures
 *  by progress. */
export const CROSS_DISSOLVE_FRAGMENT_SHADER_SOURCE = `#version 300 es
precision mediump float;
in vec2 v_uv;
out vec4 o_color;
uniform sampler2D u_texA;
uniform sampler2D u_texB;
uniform float u_progress; // 0 = pure A, 1 = pure B
uniform vec4 u_texRectA;
uniform vec4 u_texRectB;
void main() {
  vec2 uvA = v_uv * u_texRectA.zw + u_texRectA.xy;
  vec2 uvB = v_uv * u_texRectB.zw + u_texRectB.xy;
  o_color = mix(texture(u_texA, uvA), texture(u_texB, uvB), u_progress);
}`;

/**
 * dip-to-black / dip-to-white, sharing one shader parameterized by
 * `u_dipColor` — first half (progress 0→0.5) fades A to the dip color,
 * second half (0.5→1) fades the dip color to B. Mirrors the two-stage
 * mediation in frameRenderer.ts's applyTransitionBlend 'dip-black'/
 * 'dip-white' case (a true hold on the solid color at the midpoint, not a
 * direct A→B crossfade).
 */
export const DIP_FRAGMENT_SHADER_SOURCE = `#version 300 es
precision mediump float;
in vec2 v_uv;
out vec4 o_color;
uniform sampler2D u_texA;
uniform sampler2D u_texB;
uniform float u_progress;   // 0..1
uniform vec3 u_dipColor;    // (0,0,0) for dip-black, (1,1,1) for dip-white
uniform vec4 u_texRectA;
uniform vec4 u_texRectB;
void main() {
  vec2 uvA = v_uv * u_texRectA.zw + u_texRectA.xy;
  vec2 uvB = v_uv * u_texRectB.zw + u_texRectB.xy;
  vec3 a = texture(u_texA, uvA).rgb;
  vec3 b = texture(u_texB, uvB).rgb;
  vec3 c = (u_progress < 0.5)
    ? mix(a, u_dipColor, u_progress * 2.0)
    : mix(u_dipColor, b, (u_progress - 0.5) * 2.0);
  o_color = vec4(c, 1.0);
}`;

/**
 * light-leak: cross-dissolve base plus a procedural warm radial bloom,
 * screen-blended, peaking mid-transition. The `progress*(1-progress)*4`
 * shaping is ported verbatim from frameRenderer.ts's applyTransitionBlend
 * 'light-leak' case (`bloomAlpha = alpha * (1 - alpha) * 4`) — it peaks at
 * exactly 1.0 when progress=0.5 and is 0 at both ends, matching the
 * Canvas2D reference's shape so the two renderers don't visually diverge.
 *
 * Deliberate: the bloom's `center`/`distance` falloff uses the RAW, uncropped
 * v_uv (destination/visible-frame space) — NOT the cropped uvA/uvB — so the
 * bloom stays anchored to the visible frame regardless of the source's own
 * crop. Only the two texture() sampling calls use the remapped UV. Mapping
 * the bloom calc onto a cropped UV would shift/distort the leak position
 * based on the source's own extent, which is a different (wrong) visual
 * result, not just an equivalent reformulation.
 */
export const LIGHT_LEAK_FRAGMENT_SHADER_SOURCE = `#version 300 es
precision mediump float;
in vec2 v_uv;
out vec4 o_color;
uniform sampler2D u_texA;
uniform sampler2D u_texB;
uniform float u_progress;
uniform vec4 u_texRectA;
uniform vec4 u_texRectB;
void main() {
  vec2 uvA = v_uv * u_texRectA.zw + u_texRectA.xy;
  vec2 uvB = v_uv * u_texRectB.zw + u_texRectB.xy;
  vec3 base = mix(texture(u_texA, uvA).rgb, texture(u_texB, uvB).rgb, u_progress);
  float strength = u_progress * (1.0 - u_progress) * 4.0;
  vec2 center = vec2(0.75, 0.25);
  float d = distance(v_uv, center); // raw v_uv — bloom stays anchored to the visible frame
  vec3 leak = vec3(1.0, 0.85, 0.6) * smoothstep(0.9, 0.0, d) * strength;
  // Screen blend: 1 - (1-base)*(1-leak).
  o_color = vec4(1.0 - (1.0 - base) * (1.0 - leak), 1.0);
}`;

/**
 * zoom in/out: UV scale around the frame center, driven by `u_scale` — the
 * caller resolves `u_scale` from the `1.0 ± 0.05*t` rate math shared today
 * by canvasAnimations.ts's ZOOM_IN/ZOOM_OUT cases (see compositeParams.ts's
 * animScale derivation), this shader only applies whatever scale it's given.
 */
export const ZOOM_FRAGMENT_SHADER_SOURCE = `#version 300 es
precision mediump float;
in vec2 v_uv;
out vec4 o_color;
uniform sampler2D u_texA;
uniform float u_scale;
void main() {
  vec2 uv = (v_uv - 0.5) / u_scale + 0.5;
  o_color = texture(u_texA, uv);
}`;

/**
 * Color grade: brightness/contrast/saturation/temperature, each -1..1 with
 * 0 neutral — the proposed manual-control set (plan Section 5.3, flagged
 * there as a proposal). Operates in normalized RGB (no color-space
 * conversion) deliberately, per Section 4's export-readiness constraint:
 * keeping this shader's math in plain normalized RGB now means a future
 * color-managed variant (Phase C of the WebCodecs plan) can be slotted in
 * without this shader's grade math itself changing shape.
 */
export const GRADE_FRAGMENT_SHADER_SOURCE = `#version 300 es
precision mediump float;
in vec2 v_uv;
out vec4 o_color;
uniform sampler2D u_texA;
uniform float u_brightness;  // -1..1, 0 = neutral
uniform float u_contrast;    // -1..1, 0 = neutral
uniform float u_saturation;  // -1..1, 0 = neutral
uniform float u_temperature; // -1..1, 0 = neutral (+ = warm)
void main() {
  vec3 c = texture(u_texA, v_uv).rgb;
  c += u_brightness;
  c = (c - 0.5) * (1.0 + u_contrast) + 0.5;
  float luma = dot(c, vec3(0.2126, 0.7152, 0.0722));
  c = mix(vec3(luma), c, 1.0 + u_saturation);
  c.r += u_temperature * 0.1;
  c.b -= u_temperature * 0.1;
  o_color = vec4(clamp(c, 0.0, 1.0), 1.0);
}`;
