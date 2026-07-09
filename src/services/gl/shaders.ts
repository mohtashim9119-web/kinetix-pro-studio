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

/** Single-texture straight blit — used when no transition is active this
 *  tick (renders slot 'a' alone) and as the first stage of the pass chain
 *  in that case. */
export const BLIT_FRAGMENT_SHADER_SOURCE = `#version 300 es
precision mediump float;
in vec2 v_uv;
out vec4 o_color;
uniform sampler2D u_texA;
void main() {
  o_color = texture(u_texA, v_uv);
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
void main() {
  o_color = mix(texture(u_texA, v_uv), texture(u_texB, v_uv), u_progress);
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
void main() {
  vec3 a = texture(u_texA, v_uv).rgb;
  vec3 b = texture(u_texB, v_uv).rgb;
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
 */
export const LIGHT_LEAK_FRAGMENT_SHADER_SOURCE = `#version 300 es
precision mediump float;
in vec2 v_uv;
out vec4 o_color;
uniform sampler2D u_texA;
uniform sampler2D u_texB;
uniform float u_progress;
void main() {
  vec3 base = mix(texture(u_texA, v_uv).rgb, texture(u_texB, v_uv).rgb, u_progress);
  float strength = u_progress * (1.0 - u_progress) * 4.0;
  vec2 center = vec2(0.75, 0.25);
  float d = distance(v_uv, center);
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
