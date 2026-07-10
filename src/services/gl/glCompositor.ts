/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * The WebGL2 effects compositor (docs/webgl-architecture-plan.md Section 6,
 * Phase 1). Owns all GL resources for one canvas: the compiled shader
 * programs (shaders.ts), two content texture slots ('a' = current segment,
 * 'b' = incoming segment during a transition), and the fullscreen-triangle
 * geometry every pass draws with.
 *
 * `renderFrame` is a synchronous, stateless-per-call short pass chain
 * (transition-or-blit -> zoom -> grade), never a fused single shader —
 * see the Phase 1 planning note in the architecture plan: the spike
 * (src/dev/webglFeasibilitySpike/main.ts) pixel-verified 6 single-purpose
 * shaders, and fusing them would be new, unverified math. Skipped stages
 * (no active zoom, neutral grade) render straight to the canvas backbuffer
 * instead of routing through an unnecessary offscreen pass.
 *
 * No rAF loop, no async work anywhere in this class — every method does
 * exactly the GL calls implied by its name and returns, per Section 4's
 * design constraint (an export loop must be able to drive this identically
 * to a playhead-driven preview loop).
 *
 * Phase 2 Step 1 correction: the pass chain originally linked every program
 * against the same (flipped) vertex shader, which double-flipped any chain
 * that routed through exactly one intermediate render target (zoom-only or
 * grade-only — a 2-draw chain), confirmed upside-down by a real-GPU smoke
 * test before this was caught. drawZoom/drawGrade now link against
 * shaders.ts's VERTEX_SHADER_SOURCE_STRAIGHT instead — see that export's
 * doc comment for the full mechanism.
 */

import type { CompositeParams, GradeParams, TransitionSlug } from './compositeParams';
import {
  VERTEX_SHADER_SOURCE,
  VERTEX_SHADER_SOURCE_STRAIGHT,
  BLIT_FRAGMENT_SHADER_SOURCE,
  CROSS_DISSOLVE_FRAGMENT_SHADER_SOURCE,
  DIP_FRAGMENT_SHADER_SOURCE,
  LIGHT_LEAK_FRAGMENT_SHADER_SOURCE,
  ZOOM_FRAGMENT_SHADER_SOURCE,
  GRADE_FRAGMENT_SHADER_SOURCE,
} from './shaders';

export type TextureSlot = 'a' | 'b';

/**
 * Whatever the decode pool (videoDecoderPool.ts, unmodified) or a still-
 * image source hands the compositor. `VideoFrame` is the primary/expected
 * case per Section 4's input contract (never an HTML5 `<video>` seek);
 * `ImageBitmap`/`HTMLImageElement` cover image segments.
 *
 * (Was briefly widened to include `HTMLCanvasElement | OffscreenCanvas` in
 * Phase 3 for a CPU-side object-cover pre-fit step — reverted in the same
 * phase after that step was found to cause a severe WKWebView performance
 * regression; see the [CORRECTED] annotation on plan Section 7's object-cover
 * risk-register row. Object-cover is now done via UV-crop uniforms
 * (u_texRectA/u_texRectB, shaders.ts) directly against this raw upload — no
 * canvas hop, so the widened union is no longer needed.)
 */
export type UploadSource = VideoFrame | ImageBitmap | HTMLImageElement;

/**
 * Object-cover UV-crop rect for one texture slot — see shaders.ts's
 * u_texRectA/u_texRectB doc comment for the full mechanism and why this
 * exists. `(uOffset, vOffset)` is the crop's top-left in the source's own
 * [0,1] UV space; `(uScale, vScale)` is the cropped region's size in that
 * same space. Computed by useGlPreview.ts's computeObjectCoverUvRect from
 * (srcW, srcH, dstW, dstH) — this module has no opinion on resolution, it
 * only stores and wires whatever rect it's given.
 */
export interface TexRect {
  uOffset: number;
  vOffset: number;
  uScale: number;
  vScale: number;
}

/** No crop — samples the full [0,1] source UV, i.e. `v_uv * 1 + 0 = v_uv`,
 *  byte-identical to this compositor's pre-UV-crop-uniform behavior. Default
 *  for both slots at construction and whenever uploadFrame is called without
 *  an explicit rect (every existing Phase 1/2 test call site). */
export const IDENTITY_TEX_RECT: TexRect = { uOffset: 0, vOffset: 0, uScale: 1, vScale: 1 };

interface RenderTarget {
  texture: WebGLTexture;
  framebuffer: WebGLFramebuffer;
  width: number;
  height: number;
}

interface BlitProgram {
  program: WebGLProgram;
  uTexA: WebGLUniformLocation | null;
  uTexRectA: WebGLUniformLocation | null;
}

interface TransitionProgram {
  program: WebGLProgram;
  uTexA: WebGLUniformLocation | null;
  uTexB: WebGLUniformLocation | null;
  uProgress: WebGLUniformLocation | null;
  uTexRectA: WebGLUniformLocation | null;
  uTexRectB: WebGLUniformLocation | null;
}

interface DipProgram extends TransitionProgram {
  uDipColor: WebGLUniformLocation | null;
}

interface ZoomProgram {
  program: WebGLProgram;
  uTexA: WebGLUniformLocation | null;
  uScale: WebGLUniformLocation | null;
}

interface GradeProgram {
  program: WebGLProgram;
  uTexA: WebGLUniformLocation | null;
  uBrightness: WebGLUniformLocation | null;
  uContrast: WebGLUniformLocation | null;
  uSaturation: WebGLUniformLocation | null;
  uTemperature: WebGLUniformLocation | null;
}

interface Programs {
  blit: BlitProgram;
  crossDissolve: TransitionProgram;
  dip: DipProgram;
  lightLeak: TransitionProgram;
  zoom: ZoomProgram;
  grade: GradeProgram;
}

function compileShader(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader {
  const shader = gl.createShader(type);
  if (!shader) throw new Error('GlCompositor: gl.createShader() returned null');
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const info = gl.getShaderInfoLog(shader);
    gl.deleteShader(shader);
    throw new Error(`GlCompositor: shader compile failed: ${info ?? '(no info log)'}`);
  }
  return shader;
}

function linkProgram(gl: WebGL2RenderingContext, fragSrc: string, vertSrc: string = VERTEX_SHADER_SOURCE): WebGLProgram {
  const vs = compileShader(gl, gl.VERTEX_SHADER, vertSrc);
  const fs = compileShader(gl, gl.FRAGMENT_SHADER, fragSrc);
  const program = gl.createProgram();
  if (!program) throw new Error('GlCompositor: gl.createProgram() returned null');
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.linkProgram(program);
  // Shaders are flagged for deletion once detached (below); the program
  // itself still links and runs fine — this just avoids leaking the
  // intermediate shader objects once the program is linked.
  gl.deleteShader(vs);
  gl.deleteShader(fs);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const info = gl.getProgramInfoLog(program);
    gl.deleteProgram(program);
    throw new Error(`GlCompositor: program link failed: ${info ?? '(no info log)'}`);
  }
  return program;
}

function createContentTexture(gl: WebGL2RenderingContext): WebGLTexture {
  const texture = gl.createTexture();
  if (!texture) throw new Error('GlCompositor: gl.createTexture() returned null');
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return texture;
}

function createRenderTarget(gl: WebGL2RenderingContext, width: number, height: number): RenderTarget {
  const texture = createContentTexture(gl);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);

  const framebuffer = gl.createFramebuffer();
  if (!framebuffer) throw new Error('GlCompositor: gl.createFramebuffer() returned null');
  gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
  const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  if (status !== gl.FRAMEBUFFER_COMPLETE) {
    throw new Error(`GlCompositor: incomplete framebuffer (status 0x${status.toString(16)})`);
  }
  return { texture, framebuffer, width, height };
}

function isNeutralGrade(grade: GradeParams): boolean {
  return grade.brightness === 0 && grade.contrast === 0 && grade.saturation === 0 && grade.temperature === 0;
}

export class GlCompositor {
  private gl: WebGL2RenderingContext;
  private programs!: Programs;
  private vao!: WebGLVertexArrayObject;
  private vbo!: WebGLBuffer;
  private texA!: WebGLTexture;
  private texB!: WebGLTexture;
  /** The object-cover UV-crop rect most recently uploaded for each slot (see
   *  TexRect's doc) — set by uploadFrame, read by drawStage1 when wiring
   *  u_texRectA/u_texRectB. Reset to identity in setup() so a slot that's
   *  never had uploadFrame called with an explicit rect (every existing
   *  Phase 1/2 test) renders with the pre-crop-uniform behavior. */
  private texRectA: TexRect = IDENTITY_TEX_RECT;
  private texRectB: TexRect = IDENTITY_TEX_RECT;
  /** Ping-pong intermediate render targets for the pass chain — allocated
   *  lazily (on first renderFrame call that needs one) and re-allocated
   *  whenever the canvas's drawing-buffer size changes. */
  private rt0: RenderTarget | null = null;
  private rt1: RenderTarget | null = null;

  constructor(gl: WebGL2RenderingContext) {
    this.gl = gl;
    this.setup();
  }

  /** Builds every GL resource this class owns. Called from the constructor
   *  and again from handleContextRestored() — a real context loss
   *  invalidates every object on the old context, but the WebGL2RenderingContext
   *  reference itself survives restoration per spec, so re-running the same
   *  setup against `this.gl` is correct in both cases. */
  private setup(): void {
    const gl = this.gl;

    this.programs = {
      blit: this.makeBlitProgram(linkProgram(gl, BLIT_FRAGMENT_SHADER_SOURCE)),
      crossDissolve: this.makeTransitionProgram(linkProgram(gl, CROSS_DISSOLVE_FRAGMENT_SHADER_SOURCE)),
      dip: this.makeDipProgram(linkProgram(gl, DIP_FRAGMENT_SHADER_SOURCE)),
      lightLeak: this.makeTransitionProgram(linkProgram(gl, LIGHT_LEAK_FRAGMENT_SHADER_SOURCE)),
      zoom: this.makeZoomProgram(linkProgram(gl, ZOOM_FRAGMENT_SHADER_SOURCE, VERTEX_SHADER_SOURCE_STRAIGHT)),
      grade: this.makeGradeProgram(linkProgram(gl, GRADE_FRAGMENT_SHADER_SOURCE, VERTEX_SHADER_SOURCE_STRAIGHT)),
    };

    this.vao = gl.createVertexArray() ?? (() => { throw new Error('GlCompositor: gl.createVertexArray() returned null'); })();
    gl.bindVertexArray(this.vao);
    this.vbo = gl.createBuffer() ?? (() => { throw new Error('GlCompositor: gl.createBuffer() returned null'); })();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);

    this.texA = createContentTexture(gl);
    this.texB = createContentTexture(gl);

    // Intermediate render targets are re-created lazily by ensureRenderTargets()
    // once renderFrame knows the real drawing-buffer size — a restore always
    // invalidates whatever the old ones were.
    this.rt0 = null;
    this.rt1 = null;
  }

  private makeBlitProgram(program: WebGLProgram): BlitProgram {
    const gl = this.gl;
    return {
      program,
      uTexA: gl.getUniformLocation(program, 'u_texA'),
      uTexRectA: gl.getUniformLocation(program, 'u_texRectA'),
    };
  }

  private makeTransitionProgram(program: WebGLProgram): TransitionProgram {
    const gl = this.gl;
    return {
      program,
      uTexA: gl.getUniformLocation(program, 'u_texA'),
      uTexB: gl.getUniformLocation(program, 'u_texB'),
      uProgress: gl.getUniformLocation(program, 'u_progress'),
      uTexRectA: gl.getUniformLocation(program, 'u_texRectA'),
      uTexRectB: gl.getUniformLocation(program, 'u_texRectB'),
    };
  }

  private makeDipProgram(program: WebGLProgram): DipProgram {
    return { ...this.makeTransitionProgram(program), uDipColor: this.gl.getUniformLocation(program, 'u_dipColor') };
  }

  private makeZoomProgram(program: WebGLProgram): ZoomProgram {
    const gl = this.gl;
    return {
      program,
      uTexA: gl.getUniformLocation(program, 'u_texA'),
      uScale: gl.getUniformLocation(program, 'u_scale'),
    };
  }

  private makeGradeProgram(program: WebGLProgram): GradeProgram {
    const gl = this.gl;
    return {
      program,
      uTexA: gl.getUniformLocation(program, 'u_texA'),
      uBrightness: gl.getUniformLocation(program, 'u_brightness'),
      uContrast: gl.getUniformLocation(program, 'u_contrast'),
      uSaturation: gl.getUniformLocation(program, 'u_saturation'),
      uTemperature: gl.getUniformLocation(program, 'u_temperature'),
    };
  }

  /**
   * Uploads decoded/still content into a texture slot. 'a' is always the
   * current segment's content; 'b' is only meaningful (and only expected
   * to be uploaded) while a transition is active — see compositeParams.ts's
   * TextureSlot contract note. The `as unknown as TexImageSource` cast
   * mirrors the spike's own upload call shape exactly (VideoFrame's
   * assignability to TexImageSource varies by lib.dom.d.ts version; the
   * runtime call is identical either way).
   *
   * `texRect` is the object-cover UV-crop rect for this slot's content
   * (identity/no-crop when omitted — every pre-Phase-3-fix call site, and
   * still the correct default for source content that already matches the
   * destination aspect). Stored, not applied here — drawStage1 wires it as
   * u_texRectA/u_texRectB on whichever of the 4 stage-1 programs it selects.
   * Uploading raw source content directly (never via an intermediate 2D
   * canvas) is the whole point of this uniform's existence: see shaders.ts's
   * u_texRectA/u_texRectB doc comment for the WKWebView regression this
   * fixes.
   */
  uploadFrame(slot: TextureSlot, source: UploadSource, texRect: TexRect = IDENTITY_TEX_RECT): void {
    const gl = this.gl;
    const texture = slot === 'a' ? this.texA : this.texB;
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source as unknown as TexImageSource);
    if (slot === 'a') this.texRectA = texRect;
    else this.texRectB = texRect;
  }

  private ensureRenderTargets(width: number, height: number): void {
    if (this.rt0 && this.rt0.width === width && this.rt0.height === height) return;
    const gl = this.gl;
    if (this.rt0) {
      gl.deleteTexture(this.rt0.texture);
      gl.deleteFramebuffer(this.rt0.framebuffer);
    }
    if (this.rt1) {
      gl.deleteTexture(this.rt1.texture);
      gl.deleteFramebuffer(this.rt1.framebuffer);
    }
    this.rt0 = createRenderTarget(gl, width, height);
    this.rt1 = createRenderTarget(gl, width, height);
  }

  private bindTarget(target: RenderTarget | null): void {
    this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, target ? target.framebuffer : null);
  }

  private drawStage1(transition: CompositeParams['transition'], target: RenderTarget | null): void {
    const gl = this.gl;
    this.bindTarget(target);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.texA);

    if (!transition) {
      const p = this.programs.blit;
      gl.useProgram(p.program);
      gl.uniform1i(p.uTexA, 0);
      gl.uniform4f(p.uTexRectA, this.texRectA.uOffset, this.texRectA.vOffset, this.texRectA.uScale, this.texRectA.vScale);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      return;
    }

    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.texB);

    const dipColorFor = (type: TransitionSlug): [number, number, number] => (type === 'dip-white' ? [1, 1, 1] : [0, 0, 0]);

    if (transition.type === 'cross-dissolve' || transition.type === 'light-leak') {
      const p = transition.type === 'cross-dissolve' ? this.programs.crossDissolve : this.programs.lightLeak;
      gl.useProgram(p.program);
      gl.uniform1i(p.uTexA, 0);
      gl.uniform1i(p.uTexB, 1);
      gl.uniform1f(p.uProgress, transition.progress);
      gl.uniform4f(p.uTexRectA, this.texRectA.uOffset, this.texRectA.vOffset, this.texRectA.uScale, this.texRectA.vScale);
      gl.uniform4f(p.uTexRectB, this.texRectB.uOffset, this.texRectB.vOffset, this.texRectB.uScale, this.texRectB.vScale);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      return;
    }

    // dip-black / dip-white
    const p = this.programs.dip;
    gl.useProgram(p.program);
    gl.uniform1i(p.uTexA, 0);
    gl.uniform1i(p.uTexB, 1);
    gl.uniform1f(p.uProgress, transition.progress);
    const [r, g, b] = dipColorFor(transition.type);
    gl.uniform3f(p.uDipColor, r, g, b);
    gl.uniform4f(p.uTexRectA, this.texRectA.uOffset, this.texRectA.vOffset, this.texRectA.uScale, this.texRectA.vScale);
    gl.uniform4f(p.uTexRectB, this.texRectB.uOffset, this.texRectB.vOffset, this.texRectB.uScale, this.texRectB.vScale);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  private drawZoom(sourceTexture: WebGLTexture, scale: number, target: RenderTarget | null): void {
    const gl = this.gl;
    this.bindTarget(target);
    const p = this.programs.zoom;
    gl.useProgram(p.program);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, sourceTexture);
    gl.uniform1i(p.uTexA, 0);
    gl.uniform1f(p.uScale, scale);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  private drawGrade(sourceTexture: WebGLTexture, grade: GradeParams, target: RenderTarget | null): void {
    const gl = this.gl;
    this.bindTarget(target);
    const p = this.programs.grade;
    gl.useProgram(p.program);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, sourceTexture);
    gl.uniform1i(p.uTexA, 0);
    gl.uniform1f(p.uBrightness, grade.brightness);
    gl.uniform1f(p.uContrast, grade.contrast);
    gl.uniform1f(p.uSaturation, grade.saturation);
    gl.uniform1f(p.uTemperature, grade.temperature);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  /**
   * Renders one composited frame from whatever is currently in texture
   * slots 'a'/'b' to the canvas, per `params`. Synchronous, one call —
   * see the file header for the pass-chain design and why skipped stages
   * (no zoom, neutral grade) go straight to the canvas instead of
   * detouring through an offscreen target.
   */
  renderFrame(params: CompositeParams): void {
    const gl = this.gl;
    const width = gl.drawingBufferWidth;
    const height = gl.drawingBufferHeight;
    gl.viewport(0, 0, width, height);
    gl.bindVertexArray(this.vao);

    const needsZoom = params.animScale !== 1;
    const needsGrade = !isNeutralGrade(params.grade);

    if (!needsZoom && !needsGrade) {
      this.drawStage1(params.transition, null);
      gl.bindVertexArray(null);
      return;
    }

    this.ensureRenderTargets(width, height);
    const rt0 = this.rt0!;
    const rt1 = this.rt1!;

    this.drawStage1(params.transition, rt0);

    if (needsZoom && needsGrade) {
      this.drawZoom(rt0.texture, params.animScale, rt1);
      this.drawGrade(rt1.texture, params.grade, null);
    } else if (needsZoom) {
      this.drawZoom(rt0.texture, params.animScale, null);
    } else {
      this.drawGrade(rt0.texture, params.grade, null);
    }

    gl.bindVertexArray(null);
  }

  /** Wired to glContext.ts's `onContextRestored` callback by whoever owns
   *  both this compositor and the context (Phase 3 integration) — every GL
   *  object this class holds was invalidated by the loss, so this just
   *  re-runs setup() from scratch against the (now-valid-again) context. */
  handleContextRestored(): void {
    this.setup();
  }

  dispose(): void {
    const gl = this.gl;
    for (const p of Object.values(this.programs)) gl.deleteProgram(p.program);
    gl.deleteTexture(this.texA);
    gl.deleteTexture(this.texB);
    if (this.rt0) {
      gl.deleteTexture(this.rt0.texture);
      gl.deleteFramebuffer(this.rt0.framebuffer);
      this.rt0 = null;
    }
    if (this.rt1) {
      gl.deleteTexture(this.rt1.texture);
      gl.deleteFramebuffer(this.rt1.framebuffer);
      this.rt1 = null;
    }
    gl.deleteBuffer(this.vbo);
    gl.deleteVertexArray(this.vao);
  }
}
