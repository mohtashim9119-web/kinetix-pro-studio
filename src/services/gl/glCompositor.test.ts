import { describe, it, expect, beforeEach } from 'vitest';
import { GlCompositor } from './glCompositor';
import {
  NEUTRAL_GRADE,
  brightnessOffsetUniform,
  contrastGainUniform,
  saturationMixUniform,
  temperatureTintUniform,
  type CompositeParams,
} from './compositeParams';
import { VERTEX_SHADER_SOURCE, VERTEX_SHADER_SOURCE_STRAIGHT } from './shaders';

/**
 * Mock-based tests (option (a) from the pre-implementation plan) — this
 * repo's vitest runs in plain Node with no jsdom/WebGL mock infra, so
 * there is no real WebGL2RenderingContext to test against. This hand-rolls
 * a minimal mock object satisfying just the subset of the
 * WebGL2RenderingContext interface GlCompositor actually calls, mirroring
 * videoDecoderPool.test.ts's MockVideoDecoder precedent exactly. This
 * proves the class's call sequencing and resource lifecycle (program/
 * texture/framebuffer creation counts, dispose cleanup, context-loss
 * recreate) — it does NOT and cannot prove the shaders render correct
 * pixels on a real GPU. That's what the already-committed, pixel-verified
 * feasibility spike (src/dev/webglFeasibilitySpike/main.ts) proved
 * empirically instead; shaders.ts's sources are promoted from it unchanged.
 *
 * The per-slot ping-pong FBO pass-chain exercised by the transition and
 * zoom+grade tests below is new *structure* beyond what the spike tested (the
 * spike verified each of the 6 shaders standalone, never chained through an
 * offscreen render target) — these tests prove the chain's call sequence and
 * framebuffer bookkeeping are internally consistent against the mock, not that
 * the chained GPU output is pixel-correct on a real device. In particular the
 * Bug 2 per-layer-transform pass order and its vertex-shader FLIP reassignment
 * (transition programs now sample render targets, not raw uploads) cannot be
 * verified here — that requires a real-Tauri-app readPixels check (the Phase 2
 * Step 1 real-GPU-only failure class). The flip-parity test below proves the
 * WIRING (which VS each program links against); it does NOT prove the pixels
 * come out upright.
 */

let idCounter = 0;
function nextId(prefix: string): { id: string } {
  return { id: `${prefix}-${idCounter++}` };
}

class MockWebGL2 {
  // --- constants (arbitrary but distinct values; real GL constant values
  //     don't matter here, only that equality checks inside the class
  //     under test behave consistently) ---
  readonly VERTEX_SHADER = 1;
  readonly FRAGMENT_SHADER = 2;
  readonly COMPILE_STATUS = 3;
  readonly LINK_STATUS = 4;
  readonly ARRAY_BUFFER = 5;
  readonly STATIC_DRAW = 6;
  readonly TEXTURE_2D = 7;
  readonly RGBA = 8;
  readonly UNSIGNED_BYTE = 9;
  readonly TEXTURE_MIN_FILTER = 10;
  readonly TEXTURE_MAG_FILTER = 11;
  readonly LINEAR = 12;
  readonly TEXTURE_WRAP_S = 13;
  readonly TEXTURE_WRAP_T = 14;
  readonly CLAMP_TO_EDGE = 15;
  readonly FRAMEBUFFER = 16;
  readonly COLOR_ATTACHMENT0 = 17;
  readonly FRAMEBUFFER_COMPLETE = 18;
  readonly TEXTURE0 = 19;
  readonly TEXTURE1 = 20;
  readonly TRIANGLES = 21;

  drawingBufferWidth = 1920;
  drawingBufferHeight = 1080;

  /** Ordered log of GL calls that matter for lifecycle/sequencing assertions. */
  calls: string[] = [];
  /** Each linked program's vertex-shader source, in program-creation order
   *  (setup()'s `this.programs = {...}` literal: blit, crossDissolve, dip,
   *  lightLeak, zoom, grade) — populated by attachShader below. Lets tests
   *  assert WHICH vertex shader variant a program was linked with, not just
   *  that shader-compile/link happened. */
  vertexShaderSourcesByProgram: string[] = [];

  createShader(type: number): unknown { this.calls.push('createShader'); return { ...nextId('shader'), type, source: '' }; }
  shaderSource(shader: unknown, source: string): void { (shader as { source: string }).source = source; }
  compileShader(): void { this.calls.push('compileShader'); }
  getShaderParameter(): boolean { return true; }
  getShaderInfoLog(): string | null { return null; }
  deleteShader(): void { this.calls.push('deleteShader'); }

  createProgram(): unknown { this.calls.push('createProgram'); return nextId('program'); }
  attachShader(_program: unknown, shader: unknown): void {
    const s = shader as { type: number; source: string };
    if (s.type === this.VERTEX_SHADER) this.vertexShaderSourcesByProgram.push(s.source);
  }
  linkProgram(): void { this.calls.push('linkProgram'); }
  getProgramParameter(): boolean { return true; }
  getProgramInfoLog(): string | null { return null; }
  deleteProgram(): void { this.calls.push('deleteProgram'); }

  getUniformLocation(_program: unknown, name: string): unknown { return { name }; }

  createVertexArray(): unknown { this.calls.push('createVertexArray'); return nextId('vao'); }
  bindVertexArray(): void {}
  deleteVertexArray(): void { this.calls.push('deleteVertexArray'); }

  createBuffer(): unknown { this.calls.push('createBuffer'); return nextId('buffer'); }
  bindBuffer(): void {}
  bufferData(): void {}
  deleteBuffer(): void { this.calls.push('deleteBuffer'); }
  enableVertexAttribArray(): void {}
  vertexAttribPointer(): void {}

  createTexture(): unknown { this.calls.push('createTexture'); return nextId('texture'); }
  bindTexture(): void {}
  texParameteri(): void {}
  texImage2D(): void { this.calls.push('texImage2D'); }
  deleteTexture(): void { this.calls.push('deleteTexture'); }
  activeTexture(): void {}

  createFramebuffer(): unknown { this.calls.push('createFramebuffer'); return nextId('fbo'); }
  bindFramebuffer(_target: number, fbo: unknown): void {
    this.calls.push(fbo === null ? 'bindFramebuffer:canvas' : 'bindFramebuffer:target');
  }
  framebufferTexture2D(): void {}
  checkFramebufferStatus(): number { return this.FRAMEBUFFER_COMPLETE; }
  deleteFramebuffer(): void { this.calls.push('deleteFramebuffer'); }

  /** Every uniformNi/Nf call, keyed by the uniform's name (getUniformLocation
   *  below hands back `{ name }` objects specifically so tests can identify
   *  which uniform a call targeted without tracking program identity) — lets
   *  tests assert the actual VALUE wired to e.g. u_dipColor/u_progress/
   *  u_scale/u_brightness, not just that some uniform call happened. */
  uniformCalls: { name: string; args: number[] }[] = [];
  useProgram(): void { this.calls.push('useProgram'); }
  uniform1i(location: unknown, x: number): void { this.uniformCalls.push({ name: (location as { name: string }).name, args: [x] }); }
  uniform1f(location: unknown, x: number): void { this.uniformCalls.push({ name: (location as { name: string }).name, args: [x] }); }
  uniform3f(location: unknown, x: number, y: number, z: number): void { this.uniformCalls.push({ name: (location as { name: string }).name, args: [x, y, z] }); }
  uniform4f(location: unknown, x: number, y: number, z: number, w: number): void { this.uniformCalls.push({ name: (location as { name: string }).name, args: [x, y, z, w] }); }
  drawArrays(): void { this.calls.push('drawArrays'); }
  viewport(): void {}

  /** Most-recent call to a given uniform name. */
  lastUniform(name: string): number[] | undefined {
    for (let i = this.uniformCalls.length - 1; i >= 0; i--) {
      const call = this.uniformCalls[i];
      if (call && call.name === name) return call.args;
    }
    return undefined;
  }

  /** All calls to a given uniform name, in order — needed now that the
   *  per-slot prep passes wire the same uniform (u_texRectA / u_scale) more
   *  than once per renderFrame (once per slot). */
  allUniform(name: string): number[][] {
    return this.uniformCalls.filter((c) => c.name === name).map((c) => c.args);
  }
}

function makeGl(): MockWebGL2 {
  return new MockWebGL2();
}

const neutralParams: CompositeParams = { transition: null, animScaleA: 1, animScaleB: 1, grade: NEUTRAL_GRADE };
const fakeSource = {} as unknown as VideoFrame;

beforeEach(() => {
  idCounter = 0;
});

describe('GlCompositor — construction', () => {
  it('compiles all 6 programs (12 shaders: vertex+fragment each), sets up geometry, and allocates 2 content textures', () => {
    const gl = makeGl();
    new GlCompositor(gl as unknown as WebGL2RenderingContext);

    expect(gl.calls.filter((c) => c === 'createShader')).toHaveLength(12);
    expect(gl.calls.filter((c) => c === 'createProgram')).toHaveLength(6);
    expect(gl.calls.filter((c) => c === 'linkProgram')).toHaveLength(6);
    expect(gl.calls.filter((c) => c === 'createVertexArray')).toHaveLength(1);
    expect(gl.calls.filter((c) => c === 'createBuffer')).toHaveLength(1);
    expect(gl.calls.filter((c) => c === 'createTexture')).toHaveLength(2); // texA, texB only — no render targets yet
    expect(gl.calls.filter((c) => c === 'createFramebuffer')).toHaveLength(0);
  });

  it('throws a clear error when shader compilation fails (no-fallback: an unrecoverable setup failure must not fail silently)', () => {
    const gl = makeGl();
    gl.getShaderParameter = () => false;
    gl.getShaderInfoLog = () => 'mock compile failure';
    expect(() => new GlCompositor(gl as unknown as WebGL2RenderingContext)).toThrow(/shader compile failed/);
  });

  it('throws a clear error when program linking fails', () => {
    const gl = makeGl();
    gl.getProgramParameter = () => false;
    gl.getProgramInfoLog = () => 'mock link failure';
    expect(() => new GlCompositor(gl as unknown as WebGL2RenderingContext)).toThrow(/program link failed/);
  });
});

describe('GlCompositor — uploadFrame', () => {
  it('slot "a" and slot "b" each bind their own texture and upload via texImage2D', () => {
    const gl = makeGl();
    const compositor = new GlCompositor(gl as unknown as WebGL2RenderingContext);
    gl.calls = [];

    compositor.uploadFrame('a', fakeSource);
    compositor.uploadFrame('b', fakeSource);

    expect(gl.calls.filter((c) => c === 'texImage2D')).toHaveLength(2);
  });

  /**
   * uploadFrame has NO branching on source type — it casts
   * VideoFrame|ImageBitmap|HTMLImageElement to TexImageSource and calls
   * texImage2D once; the browser's own overloaded texImage2D handles the
   * three source kinds identically. So there is no "routing" branch to
   * exercise here — these tests instead lock in call-shape parity (each source
   * kind reaches texImage2D via the same call, for either slot), which is the
   * property image-segment/video-segment mixing actually depends on. Phase 2
   * Step 1's real-GPU 12-combo check already proved this holds pixel-correct
   * on real hardware for video/video, image/image, and video/image pairs.
   */
  const fakeVideoFrame = { codedWidth: 1280, codedHeight: 720 } as unknown as VideoFrame;
  const fakeImageBitmap = { width: 800, height: 600 } as unknown as ImageBitmap;
  const fakeImageElement = { naturalWidth: 800, naturalHeight: 600 } as unknown as HTMLImageElement;

  it.each([
    ['VideoFrame', fakeVideoFrame],
    ['ImageBitmap', fakeImageBitmap],
    ['HTMLImageElement', fakeImageElement],
  ] as const)('slot "a" accepts a %s source identically (single texImage2D call, no error)', (_label, source) => {
    const gl = makeGl();
    const compositor = new GlCompositor(gl as unknown as WebGL2RenderingContext);
    gl.calls = [];

    expect(() => compositor.uploadFrame('a', source)).not.toThrow();
    expect(gl.calls.filter((c) => c === 'texImage2D')).toHaveLength(1);
  });

  it.each([
    ['VideoFrame', fakeVideoFrame],
    ['ImageBitmap', fakeImageBitmap],
    ['HTMLImageElement', fakeImageElement],
  ] as const)('slot "b" accepts a %s source identically (single texImage2D call, no error)', (_label, source) => {
    const gl = makeGl();
    const compositor = new GlCompositor(gl as unknown as WebGL2RenderingContext);
    gl.calls = [];

    expect(() => compositor.uploadFrame('b', source)).not.toThrow();
    expect(gl.calls.filter((c) => c === 'texImage2D')).toHaveLength(1);
  });

  it('mixed-source transition — slot "a" a VideoFrame (outgoing video), slot "b" an ImageBitmap (incoming image) — renderFrame drives the same full per-slot transition chain as a same-type pair, unaffected by the upstream source-kind mismatch', () => {
    const gl = makeGl();
    const compositor = new GlCompositor(gl as unknown as WebGL2RenderingContext);
    compositor.uploadFrame('a', fakeVideoFrame);
    compositor.uploadFrame('b', fakeImageBitmap);
    gl.calls = [];

    compositor.renderFrame({ transition: { type: 'cross-dissolve', progress: 0.5 }, animScaleA: 1, animScaleB: 1, grade: NEUTRAL_GRADE });

    // prep A (blit + zoom) + prep B (blit + zoom) + blend = 5 draws; rtA/rtB/scratch = 3 FBOs.
    expect(gl.calls.filter((c) => c === 'drawArrays')).toHaveLength(5);
    expect(gl.calls.filter((c) => c === 'createFramebuffer')).toHaveLength(3);
  });

  it('image<->image transition — both slots ImageBitmap/HTMLImageElement — same per-slot pass-chain shape as the video<->video case', () => {
    const gl = makeGl();
    const compositor = new GlCompositor(gl as unknown as WebGL2RenderingContext);
    compositor.uploadFrame('a', fakeImageBitmap);
    compositor.uploadFrame('b', fakeImageElement);
    gl.calls = [];

    compositor.renderFrame({ transition: { type: 'dip-black', progress: 0.5 }, animScaleA: 1.2, animScaleB: 1, grade: NEUTRAL_GRADE });

    // Every active transition routes through the full per-slot chain
    // regardless of source kind or whether a slot's zoom is neutral: prep A
    // (blit + zoom) + prep B (blit + zoom) + blend = 5 draws, 3 FBOs.
    expect(gl.calls.filter((c) => c === 'drawArrays')).toHaveLength(5);
    expect(gl.calls.filter((c) => c === 'createFramebuffer')).toHaveLength(3);
  });
});

describe('GlCompositor — renderFrame pass chain', () => {
  it('neutral params (no transition, no zoom, neutral grade): exactly one draw call, straight to the canvas, no render targets allocated', () => {
    const gl = makeGl();
    const compositor = new GlCompositor(gl as unknown as WebGL2RenderingContext);
    gl.calls = [];

    compositor.renderFrame(neutralParams);

    expect(gl.calls.filter((c) => c === 'drawArrays')).toHaveLength(1);
    expect(gl.calls.filter((c) => c === 'createFramebuffer')).toHaveLength(0);
    expect(gl.calls).toContain('bindFramebuffer:canvas');
    expect(gl.calls).not.toContain('bindFramebuffer:target');
  });

  it('an active transition with no zoom/grade routes through the full per-slot chain (no raw-blend fast path): 5 draws, 3 render targets', () => {
    const gl = makeGl();
    const compositor = new GlCompositor(gl as unknown as WebGL2RenderingContext);
    gl.calls = [];

    compositor.renderFrame({ transition: { type: 'cross-dissolve', progress: 0.5 }, animScaleA: 1, animScaleB: 1, grade: NEUTRAL_GRADE });

    // prep A (blit→scratch, zoom→rtA) + prep B (blit→scratch, zoom→rtB) + blend(rtA,rtB)→canvas
    expect(gl.calls.filter((c) => c === 'drawArrays')).toHaveLength(5);
    expect(gl.calls.filter((c) => c === 'createFramebuffer')).toHaveLength(3);
    // The blend (final pass) goes straight to the canvas when grade is neutral.
    const lastCanvasBindIdx = gl.calls.lastIndexOf('bindFramebuffer:canvas');
    const lastDrawIdx = gl.calls.lastIndexOf('drawArrays');
    expect(lastCanvasBindIdx).toBeGreaterThan(-1);
    expect(lastCanvasBindIdx).toBeLessThan(lastDrawIdx);
  });

  it('no-transition, zoom active, grade neutral: two draw calls (blit -> rt, zoom rt -> canvas), one render-target pair allocated', () => {
    const gl = makeGl();
    const compositor = new GlCompositor(gl as unknown as WebGL2RenderingContext);
    gl.calls = [];

    compositor.renderFrame({ transition: null, animScaleA: 1.2, animScaleB: 1, grade: NEUTRAL_GRADE });

    expect(gl.calls.filter((c) => c === 'drawArrays')).toHaveLength(2);
    expect(gl.calls.filter((c) => c === 'createFramebuffer')).toHaveLength(2); // rt0 + rt1; the single-slot path never needs the 3rd
    const lastCanvasBindIdx = gl.calls.lastIndexOf('bindFramebuffer:canvas');
    const lastDrawIdx = gl.calls.lastIndexOf('drawArrays');
    expect(lastCanvasBindIdx).toBeGreaterThan(-1);
    expect(lastCanvasBindIdx).toBeLessThan(lastDrawIdx);
  });

  it('no-transition, zoom AND grade both active: three draw calls (blit -> rt0, zoom rt0 -> rt1, grade rt1 -> canvas)', () => {
    const gl = makeGl();
    const compositor = new GlCompositor(gl as unknown as WebGL2RenderingContext);
    gl.calls = [];

    compositor.renderFrame({
      transition: null,
      animScaleA: 1.1,
      animScaleB: 1,
      grade: { brightness: 0.2, contrast: 0, saturation: 0, temperature: 0 },
    });

    expect(gl.calls.filter((c) => c === 'drawArrays')).toHaveLength(3);
    expect(gl.calls.filter((c) => c === 'createFramebuffer')).toHaveLength(2);
    const lastCanvasBindIdx = gl.calls.lastIndexOf('bindFramebuffer:canvas');
    const lastDrawIdx = gl.calls.lastIndexOf('drawArrays');
    expect(lastCanvasBindIdx).toBeGreaterThan(-1);
    expect(lastCanvasBindIdx).toBeLessThan(lastDrawIdx);
  });

  it('transition with zoom AND grade: full per-slot chain + grade — six draw calls, three render targets, final pass to canvas', () => {
    const gl = makeGl();
    const compositor = new GlCompositor(gl as unknown as WebGL2RenderingContext);
    gl.calls = [];

    compositor.renderFrame({
      transition: { type: 'dip-black', progress: 0.3 },
      animScaleA: 1.1,
      animScaleB: 1.2,
      grade: { brightness: 0.2, contrast: 0, saturation: 0, temperature: 0 },
    });

    // prep A (2) + prep B (2) + blend(→scratch) (1) + grade(scratch→canvas) (1)
    expect(gl.calls.filter((c) => c === 'drawArrays')).toHaveLength(6);
    expect(gl.calls.filter((c) => c === 'createFramebuffer')).toHaveLength(3);
    // The grade pass (final stage when active) must go to the canvas last.
    const lastCanvasBindIdx = gl.calls.lastIndexOf('bindFramebuffer:canvas');
    const lastDrawIdx = gl.calls.lastIndexOf('drawArrays');
    expect(lastCanvasBindIdx).toBeGreaterThan(-1);
    expect(lastCanvasBindIdx).toBeLessThan(lastDrawIdx);
  });

  it('no-transition, grade active alone (no zoom): two draw calls, one render-target pair allocated', () => {
    const gl = makeGl();
    const compositor = new GlCompositor(gl as unknown as WebGL2RenderingContext);
    gl.calls = [];

    compositor.renderFrame({ transition: null, animScaleA: 1, animScaleB: 1, grade: { brightness: 0, contrast: 0.4, saturation: 0, temperature: 0 } });

    expect(gl.calls.filter((c) => c === 'drawArrays')).toHaveLength(2);
    expect(gl.calls.filter((c) => c === 'createFramebuffer')).toHaveLength(2);
  });

  it('does not re-allocate render targets across calls at the same drawing-buffer size', () => {
    const gl = makeGl();
    const compositor = new GlCompositor(gl as unknown as WebGL2RenderingContext);
    const zoomParams: CompositeParams = { transition: null, animScaleA: 1.3, animScaleB: 1, grade: NEUTRAL_GRADE };

    compositor.renderFrame(zoomParams);
    gl.calls = [];
    compositor.renderFrame(zoomParams);

    expect(gl.calls.filter((c) => c === 'createFramebuffer')).toHaveLength(0);
    expect(gl.calls.filter((c) => c === 'createTexture')).toHaveLength(0);
  });

  it('re-allocates render targets when the drawing-buffer size changes (disposing the old pair first)', () => {
    const gl = makeGl();
    const compositor = new GlCompositor(gl as unknown as WebGL2RenderingContext);
    const zoomParams: CompositeParams = { transition: null, animScaleA: 1.3, animScaleB: 1, grade: NEUTRAL_GRADE };

    compositor.renderFrame(zoomParams);
    gl.drawingBufferWidth = 1280;
    gl.drawingBufferHeight = 720;
    gl.calls = [];
    compositor.renderFrame(zoomParams);

    expect(gl.calls.filter((c) => c === 'deleteFramebuffer')).toHaveLength(2);
    expect(gl.calls.filter((c) => c === 'deleteTexture')).toHaveLength(2);
    expect(gl.calls.filter((c) => c === 'createFramebuffer')).toHaveLength(2);
  });

  it('lazily allocates the 3rd render target only when a transition first needs it (a prior single-slot render allocated only 2)', () => {
    const gl = makeGl();
    const compositor = new GlCompositor(gl as unknown as WebGL2RenderingContext);

    // Single-slot zoom first — allocates rt0 + rt1 only.
    compositor.renderFrame({ transition: null, animScaleA: 1.3, animScaleB: 1, grade: NEUTRAL_GRADE });
    expect(gl.calls.filter((c) => c === 'createFramebuffer')).toHaveLength(2);
    gl.calls = [];

    // A transition at the SAME size now needs the 3rd target — exactly one
    // more framebuffer is allocated, rt0/rt1 are reused (not rebuilt).
    compositor.renderFrame({ transition: { type: 'cross-dissolve', progress: 0.5 }, animScaleA: 1, animScaleB: 1, grade: NEUTRAL_GRADE });
    expect(gl.calls.filter((c) => c === 'createFramebuffer')).toHaveLength(1);
    expect(gl.calls.filter((c) => c === 'deleteFramebuffer')).toHaveLength(0); // rt0/rt1 not rebuilt
  });
});

describe('GlCompositor — transition/zoom/grade uniform wiring', () => {
  /**
   * Program-selection/uniform-value tests, not pixel tests — the mock never
   * executes GLSL, so it can't independently re-prove "dip-black renders
   * black." That pixel-math question is already closed (Phase 0 spike +
   * Phase 2 Step 1). What a mock CAN and should catch is a wiring regression:
   * the wrong program selected for a slug, or the right program fed the wrong
   * uniform value.
   */

  it('dip-black selects the dip program with u_dipColor = [0,0,0]', () => {
    const gl = makeGl();
    const compositor = new GlCompositor(gl as unknown as WebGL2RenderingContext);
    gl.calls = [];

    compositor.renderFrame({ transition: { type: 'dip-black', progress: 0.5 }, animScaleA: 1, animScaleB: 1, grade: NEUTRAL_GRADE });

    expect(gl.lastUniform('u_dipColor')).toEqual([0, 0, 0]);
    expect(gl.lastUniform('u_progress')).toEqual([0.5]);
  });

  it('dip-white selects the SAME dip program (shared per glCompositor.ts) with u_dipColor = [1,1,1] — not confused with dip-black', () => {
    const gl = makeGl();
    const compositor = new GlCompositor(gl as unknown as WebGL2RenderingContext);
    gl.calls = [];

    compositor.renderFrame({ transition: { type: 'dip-white', progress: 0.5 }, animScaleA: 1, animScaleB: 1, grade: NEUTRAL_GRADE });

    expect(gl.lastUniform('u_dipColor')).toEqual([1, 1, 1]);
  });

  it('regression guard: dip-black and dip-white driven back-to-back on the SAME compositor instance never bleed into each other\'s u_dipColor — the two are differentiated only by dipColorFor\'s ternary, exactly the "shared mechanism, parameter-only difference" shape the vertex-shader flip bug taught us to distrust', () => {
    const gl = makeGl();
    const compositor = new GlCompositor(gl as unknown as WebGL2RenderingContext);

    gl.calls = [];
    compositor.renderFrame({ transition: { type: 'dip-black', progress: 0.2 }, animScaleA: 1, animScaleB: 1, grade: NEUTRAL_GRADE });
    expect(gl.lastUniform('u_dipColor')).toEqual([0, 0, 0]);

    gl.calls = [];
    compositor.renderFrame({ transition: { type: 'dip-white', progress: 0.8 }, animScaleA: 1, animScaleB: 1, grade: NEUTRAL_GRADE });
    expect(gl.lastUniform('u_dipColor')).toEqual([1, 1, 1]);

    // And back again — proves it's not a one-shot/first-call coincidence.
    gl.calls = [];
    compositor.renderFrame({ transition: { type: 'dip-black', progress: 0.6 }, animScaleA: 1, animScaleB: 1, grade: NEUTRAL_GRADE });
    expect(gl.lastUniform('u_dipColor')).toEqual([0, 0, 0]);
  });

  it('cross-dissolve selects the cross-dissolve program and wires u_progress', () => {
    const gl = makeGl();
    const compositor = new GlCompositor(gl as unknown as WebGL2RenderingContext);
    gl.calls = [];

    compositor.renderFrame({ transition: { type: 'cross-dissolve', progress: 0.75 }, animScaleA: 1, animScaleB: 1, grade: NEUTRAL_GRADE });

    expect(gl.lastUniform('u_progress')).toEqual([0.75]);
    // cross-dissolve/light-leak share no dip-color uniform.
    expect(gl.lastUniform('u_dipColor')).toBeUndefined();
  });

  it('light-leak selects the light-leak program (not cross-dissolve or dip) and wires u_progress', () => {
    const gl = makeGl();
    const compositor = new GlCompositor(gl as unknown as WebGL2RenderingContext);
    gl.calls = [];

    compositor.renderFrame({ transition: { type: 'light-leak', progress: 0.4 }, animScaleA: 1, animScaleB: 1, grade: NEUTRAL_GRADE });

    expect(gl.lastUniform('u_progress')).toEqual([0.4]);
    expect(gl.lastUniform('u_dipColor')).toBeUndefined();
  });

  it('no-transition zoom: u_scale is wired directly from CompositeParams.animScaleA (no re-derivation at render time)', () => {
    const gl = makeGl();
    const compositor = new GlCompositor(gl as unknown as WebGL2RenderingContext);
    gl.calls = [];

    compositor.renderFrame({ transition: null, animScaleA: 1.37, animScaleB: 1, grade: NEUTRAL_GRADE });

    expect(gl.lastUniform('u_scale')).toEqual([1.37]);
  });

  it('per-layer zoom (Bug 2 fix): during a transition, slot A prep wires u_scale=animScaleA and slot B prep wires u_scale=animScaleB — two independent scales in prep order, not one shared scalar applied after the blend', () => {
    const gl = makeGl();
    const compositor = new GlCompositor(gl as unknown as WebGL2RenderingContext);
    gl.calls = [];
    gl.uniformCalls = [];

    compositor.renderFrame({ transition: { type: 'cross-dissolve', progress: 0.5 }, animScaleA: 1.2, animScaleB: 1.4, grade: NEUTRAL_GRADE });

    // renderTransition preps slot A then slot B — exactly two zoom passes, each
    // carrying its own layer's scale, applied BEFORE the blend.
    expect(gl.allUniform('u_scale').map((a) => a[0])).toEqual([1.2, 1.4]);
  });

  it('every grade uniform receives its compositeParams remap, NOT the raw −1..1 slider value — confirms the remaps actually reach the uniforms rather than existing as unused exports', () => {
    const gl = makeGl();
    const compositor = new GlCompositor(gl as unknown as WebGL2RenderingContext);
    gl.calls = [];

    const grade = { brightness: 0.3, contrast: -0.2, saturation: 0.1, temperature: 0.4 };
    compositor.renderFrame({ transition: null, animScaleA: 1, animScaleB: 1, grade });

    const u = (name: string): number => (gl.lastUniform(name) as number[])[0]!;
    expect(u('u_brightness')).toBeCloseTo(brightnessOffsetUniform(0.3), 10);
    expect(u('u_contrast')).toBeCloseTo(contrastGainUniform(-0.2), 10);
    expect(u('u_saturation')).toBeCloseTo(saturationMixUniform(0.1), 10);
    expect(u('u_temperature')).toBeCloseTo(temperatureTintUniform(0.4), 10);

    // The superseded raw pass-through, rejected per channel.
    expect(u('u_brightness')).not.toBeCloseTo(0.3, 2);
    expect(u('u_contrast')).not.toBeCloseTo(-0.2, 2);
    expect(u('u_saturation')).not.toBeCloseTo(0.1, 2);
    expect(u('u_temperature')).not.toBeCloseTo(0.4, 2);
  });

  it('a neutral grade skips the grade pass entirely, and the remaps agree with that skip — each maps 0 to exactly 0, so the two paths cannot disagree about what "neutral" looks like', () => {
    const gl = makeGl();
    const compositor = new GlCompositor(gl as unknown as WebGL2RenderingContext);
    gl.calls = [];

    compositor.renderFrame({
      transition: null,
      animScaleA: 1,
      animScaleB: 1,
      grade: { brightness: 0, contrast: 0, saturation: 0, temperature: 0 },
    });

    // isNeutralGrade tests the SLIDER values, so the skip is decided upstream of
    // the remaps: no grade uniform is sent at all.
    for (const name of ['u_brightness', 'u_contrast', 'u_saturation', 'u_temperature']) {
      expect(gl.lastUniform(name)).toBeUndefined();
    }
    // Which is only sound because a remapped neutral is still a no-op. If any
    // remap moved 0 off 0, a neutral grade would render one way through the skip
    // and another way through the grade pass (reachable via a zoomed segment).
    expect(brightnessOffsetUniform(0)).toBe(0);
    expect(contrastGainUniform(0)).toBe(0);
    expect(saturationMixUniform(0)).toBe(0);
    expect(temperatureTintUniform(0)).toBe(0);
  });

  it('contrast=-1 (the pre-remap flat-gray/brown collapse point) sends a gain of 0.625×, never gain-zero', () => {
    const gl = makeGl();
    const compositor = new GlCompositor(gl as unknown as WebGL2RenderingContext);
    gl.calls = [];

    compositor.renderFrame({
      transition: null,
      animScaleA: 1,
      animScaleB: 1,
      grade: { brightness: 0, contrast: -1, saturation: 0, temperature: 0 },
    });

    const uContrast = (gl.lastUniform('u_contrast') as number[])[0]!;
    // The raw feed sent exactly -1 here, making the shader's "1 + u_contrast"
    // gain exactly 0 (every pixel -> flat gray, then tinted by temperature).
    expect(1 + uContrast).toBeCloseTo(1 / 1.6, 10);
    expect(1 + uContrast).toBeGreaterThan(0);
  });

  it('brightness=+1 sends a +0.25 offset, not the frame-blowing +1', () => {
    const gl = makeGl();
    const compositor = new GlCompositor(gl as unknown as WebGL2RenderingContext);
    gl.calls = [];

    compositor.renderFrame({
      transition: null,
      animScaleA: 1,
      animScaleB: 1,
      grade: { brightness: 1, contrast: 0, saturation: 0, temperature: 0 },
    });

    expect((gl.lastUniform('u_brightness') as number[])[0]).toBeCloseTo(0.25, 10);
  });
});

describe('GlCompositor — object-cover UV-crop uniform wiring (u_texRectA/u_texRectB)', () => {
  /**
   * WKWebView performance-fix follow-up (docs/history.md (WebGL2 Effects Engine — Full Plan, archived 2026-07-20)
   * Section 7's [CORRECTED] object-cover row): object-cover is a UV-crop
   * uniform the shader applies, not a CPU-canvas pre-fit. Under the Bug 2
   * per-layer pass order the crop is applied in the per-slot PREP pass (blit),
   * NOT in the transition programs — those now sample the already-cropped
   * rtA/rtB and so are fed IDENTITY rects. blit is slot-agnostic (it only has
   * a u_texRectA uniform), so slot A's and slot B's crops both travel through
   * u_texRectA on their respective prep passes, in prep order. These are
   * wiring tests, not pixel tests — same discipline as the dip-color/u_scale/
   * grade tests above.
   */

  it('identity default: uploadFrame with no explicit rect wires u_texRectA = [0,0,1,1] on the blit prep pass', () => {
    const gl = makeGl();
    const compositor = new GlCompositor(gl as unknown as WebGL2RenderingContext);
    compositor.uploadFrame('a', fakeSource); // no rect arg — identity default
    gl.calls = [];
    gl.uniformCalls = [];

    compositor.renderFrame(neutralParams); // no transition -> single blit, samples texRectA

    expect(gl.lastUniform('u_texRectA')).toEqual([0, 0, 1, 1]);
  });

  it('the blit prep pass wires an explicit crop rect for slot A', () => {
    const gl = makeGl();
    const compositor = new GlCompositor(gl as unknown as WebGL2RenderingContext);
    compositor.uploadFrame('a', fakeSource, { uOffset: 0.1, vOffset: 0.2, uScale: 0.5, vScale: 0.6 });
    gl.calls = [];
    gl.uniformCalls = [];

    compositor.renderFrame(neutralParams);

    expect(gl.lastUniform('u_texRectA')).toEqual([0.1, 0.2, 0.5, 0.6]);
  });

  it('cross-dissolve: each slot\'s crop is applied in its own prep pass (slot A then slot B, both via blit\'s u_texRectA), and the transition-blend pass feeds IDENTITY rects (it samples already-cropped rtA/rtB) — a swap would crop the wrong content into the wrong slot', () => {
    const gl = makeGl();
    const compositor = new GlCompositor(gl as unknown as WebGL2RenderingContext);
    compositor.uploadFrame('a', fakeSource, { uOffset: 0.25, vOffset: 0, uScale: 0.5, vScale: 1 });
    compositor.uploadFrame('b', fakeSource, { uOffset: 0, vOffset: 0.1, uScale: 1, vScale: 0.8 });
    gl.calls = [];
    gl.uniformCalls = [];

    compositor.renderFrame({ transition: { type: 'cross-dissolve', progress: 0.5 }, animScaleA: 1, animScaleB: 1, grade: NEUTRAL_GRADE });

    const texRectA = gl.allUniform('u_texRectA');
    // prep blit A (slot A crop), prep blit B (slot B crop), then blend (identity)
    expect(texRectA[0]).toEqual([0.25, 0, 0.5, 1]); // slot A, prep pass
    expect(texRectA[1]).toEqual([0, 0.1, 1, 0.8]);  // slot B, prep pass
    expect(texRectA[texRectA.length - 1]).toEqual([0, 0, 1, 1]); // transition-blend feeds identity
    // u_texRectB is only ever set by the transition-blend pass, now identity.
    expect(gl.allUniform('u_texRectB')).toEqual([[0, 0, 1, 1]]);
  });

  it('dip: same per-slot prep crop + identity-at-blend property, exercised on the dip program specifically (and u_dipColor still wired)', () => {
    const gl = makeGl();
    const compositor = new GlCompositor(gl as unknown as WebGL2RenderingContext);
    compositor.uploadFrame('a', fakeSource, { uOffset: 0.1, vOffset: 0, uScale: 0.8, vScale: 1 });
    compositor.uploadFrame('b', fakeSource, { uOffset: 0, vOffset: 0.05, uScale: 1, vScale: 0.9 });
    gl.calls = [];
    gl.uniformCalls = [];

    compositor.renderFrame({ transition: { type: 'dip-black', progress: 0.5 }, animScaleA: 1, animScaleB: 1, grade: NEUTRAL_GRADE });

    const texRectA = gl.allUniform('u_texRectA');
    expect(texRectA[0]).toEqual([0.1, 0, 0.8, 1]);   // slot A prep
    expect(texRectA[1]).toEqual([0, 0.05, 1, 0.9]);  // slot B prep
    expect(texRectA[texRectA.length - 1]).toEqual([0, 0, 1, 1]); // blend identity
    expect(gl.allUniform('u_texRectB')).toEqual([[0, 0, 1, 1]]);
    // u_dipColor wiring (pre-existing behavior) is unaffected by the crop relocation.
    expect(gl.lastUniform('u_dipColor')).toEqual([0, 0, 0]);
  });

  it('light-leak: same per-slot prep crop + identity-at-blend property as the other stage programs', () => {
    const gl = makeGl();
    const compositor = new GlCompositor(gl as unknown as WebGL2RenderingContext);
    compositor.uploadFrame('a', fakeSource, { uOffset: 0.2, vOffset: 0, uScale: 0.6, vScale: 1 });
    compositor.uploadFrame('b', fakeSource, { uOffset: 0, vOffset: 0, uScale: 1, vScale: 1 });
    gl.calls = [];
    gl.uniformCalls = [];

    compositor.renderFrame({ transition: { type: 'light-leak', progress: 0.5 }, animScaleA: 1, animScaleB: 1, grade: NEUTRAL_GRADE });

    const texRectA = gl.allUniform('u_texRectA');
    expect(texRectA[0]).toEqual([0.2, 0, 0.6, 1]); // slot A prep
    expect(texRectA[1]).toEqual([0, 0, 1, 1]);     // slot B prep (identity crop, but still a real prep-pass wiring)
    expect(texRectA[texRectA.length - 1]).toEqual([0, 0, 1, 1]); // blend identity
    expect(gl.allUniform('u_texRectB')).toEqual([[0, 0, 1, 1]]);
  });

  it('zoom and grade never receive a u_texRectA/u_texRectB uniform call — during a full transition+zoom+grade chain the only texRect calls come from the two prep blits (u_texRectA) and the single blend (u_texRectA + u_texRectB): exactly 4, none from zoom/grade', () => {
    const gl = makeGl();
    const compositor = new GlCompositor(gl as unknown as WebGL2RenderingContext);
    compositor.uploadFrame('a', fakeSource, { uOffset: 0.1, vOffset: 0.1, uScale: 0.8, vScale: 0.8 });
    compositor.uploadFrame('b', fakeSource, { uOffset: 0, vOffset: 0, uScale: 1, vScale: 1 });
    gl.calls = [];
    gl.uniformCalls = [];

    compositor.renderFrame({
      transition: { type: 'dip-black', progress: 0.3 },
      animScaleA: 1.1,
      animScaleB: 1.2,
      grade: { brightness: 0.2, contrast: 0, saturation: 0, temperature: 0 },
    });

    // prep blit A: u_texRectA (1); prep blit B: u_texRectA (1); blend:
    // u_texRectA + u_texRectB (2). zoom/grade programs have no texRect uniform
    // fields at all (see ZoomProgram/GradeProgram), so the total is exactly 4 —
    // any contribution from zoom/grade would push it above 4.
    const texRectCalls = gl.uniformCalls.filter((c) => c.name === 'u_texRectA' || c.name === 'u_texRectB');
    expect(texRectCalls).toHaveLength(4);
  });
});

describe('GlCompositor — context-loss recreate', () => {
  it('handleContextRestored() re-runs full setup: programs/geometry/textures are all re-created', () => {
    const gl = makeGl();
    const compositor = new GlCompositor(gl as unknown as WebGL2RenderingContext);
    gl.calls = [];

    compositor.handleContextRestored();

    expect(gl.calls.filter((c) => c === 'createProgram')).toHaveLength(6);
    expect(gl.calls.filter((c) => c === 'createVertexArray')).toHaveLength(1);
    expect(gl.calls.filter((c) => c === 'createBuffer')).toHaveLength(1);
    expect(gl.calls.filter((c) => c === 'createTexture')).toHaveLength(2);
  });

  it('after a restore, a render-target-needing renderFrame allocates fresh targets rather than reusing stale (now-invalid) ones', () => {
    const gl = makeGl();
    const compositor = new GlCompositor(gl as unknown as WebGL2RenderingContext);
    const zoomParams: CompositeParams = { transition: null, animScaleA: 1.3, animScaleB: 1, grade: NEUTRAL_GRADE };

    // Allocate render targets once, pre-restore.
    compositor.renderFrame(zoomParams);
    compositor.handleContextRestored();
    gl.calls = [];

    // Same drawing-buffer size as before the restore — if the compositor
    // incorrectly kept its old rt0/rt1 handles across the restore, this
    // would wrongly skip re-allocation (the size-based skip check in
    // ensureRenderTargets would find a "match"). It must not.
    compositor.renderFrame(zoomParams);

    expect(gl.calls.filter((c) => c === 'createFramebuffer')).toHaveLength(2);
  });
});

describe('GlCompositor — vertex-shader flip parity (Bug 2 per-layer reassignment)', () => {
  it('the ONLY program that samples a raw upload (blit) uses the flipped vertex shader; every program that samples a RENDER TARGET (transition-blend/zoom/grade) uses the straight one — exactly one net flip, now located at the per-slot prep entry', () => {
    const gl = makeGl();
    new GlCompositor(gl as unknown as WebGL2RenderingContext);

    // setup() links programs in exactly this order: blit, crossDissolve,
    // dip, lightLeak, zoom, grade — attachShader records each program's
    // vertex-shader source in that same order.
    const [blitVS, crossDissolveVS, dipVS, lightLeakVS, zoomVS, gradeVS] = gl.vertexShaderSourcesByProgram;

    // blit samples raw texA/texB (VideoFrame/ImageBitmap uploads) in the
    // per-slot prep pass — it carries the single Y-flip.
    expect(blitVS).toBe(VERTEX_SHADER_SOURCE);

    // The transition programs now sample the ALREADY-PREPPED rtA/rtB render
    // targets (not raw uploads), so they must use the STRAIGHT vertex shader.
    // Pre-Bug-2 they sampled raw uploads and used the flipped shader; behind
    // the per-slot prep, re-flipping an FBO-sourced sample would double-flip
    // (the Phase 2 Step 1 real-GPU failure class). This is the critical
    // flip-parity reassignment — it must be STRAIGHT, definitely not flipped.
    expect(crossDissolveVS).toBe(VERTEX_SHADER_SOURCE_STRAIGHT);
    expect(dipVS).toBe(VERTEX_SHADER_SOURCE_STRAIGHT);
    expect(lightLeakVS).toBe(VERTEX_SHADER_SOURCE_STRAIGHT);
    expect(crossDissolveVS).not.toBe(VERTEX_SHADER_SOURCE);
    expect(dipVS).not.toBe(VERTEX_SHADER_SOURCE);
    expect(lightLeakVS).not.toBe(VERTEX_SHADER_SOURCE);

    // zoom/grade sample render targets — straight, unchanged from Phase 2 Step 1.
    expect(zoomVS).toBe(VERTEX_SHADER_SOURCE_STRAIGHT);
    expect(gradeVS).toBe(VERTEX_SHADER_SOURCE_STRAIGHT);

    // Net flip count across all 6 programs must be exactly one (blit) — the
    // single flip from top-left-origin upload orientation to display.
    const flippedCount = gl.vertexShaderSourcesByProgram.filter((s) => s === VERTEX_SHADER_SOURCE).length;
    expect(flippedCount).toBe(1);
    const straightCount = gl.vertexShaderSourcesByProgram.filter((s) => s === VERTEX_SHADER_SOURCE_STRAIGHT).length;
    expect(straightCount).toBe(5);
  });
});

describe('GlCompositor — dispose', () => {
  it('deletes all 6 programs, both content textures, and geometry buffers/VAO when no render targets were ever allocated', () => {
    const gl = makeGl();
    const compositor = new GlCompositor(gl as unknown as WebGL2RenderingContext);
    gl.calls = [];

    compositor.dispose();

    expect(gl.calls.filter((c) => c === 'deleteProgram')).toHaveLength(6);
    expect(gl.calls.filter((c) => c === 'deleteTexture')).toHaveLength(2);
    expect(gl.calls.filter((c) => c === 'deleteFramebuffer')).toHaveLength(0);
    expect(gl.calls.filter((c) => c === 'deleteBuffer')).toHaveLength(1);
    expect(gl.calls.filter((c) => c === 'deleteVertexArray')).toHaveLength(1);
  });

  it('also deletes the two render-target textures/framebuffers allocated by a single-slot render', () => {
    const gl = makeGl();
    const compositor = new GlCompositor(gl as unknown as WebGL2RenderingContext);
    compositor.renderFrame({ transition: null, animScaleA: 1.3, animScaleB: 1, grade: NEUTRAL_GRADE });
    gl.calls = [];

    compositor.dispose();

    expect(gl.calls.filter((c) => c === 'deleteTexture')).toHaveLength(4); // texA, texB, rt0, rt1
    expect(gl.calls.filter((c) => c === 'deleteFramebuffer')).toHaveLength(2);
  });

  it('deletes all THREE render targets when a transition allocated the 3rd', () => {
    const gl = makeGl();
    const compositor = new GlCompositor(gl as unknown as WebGL2RenderingContext);
    compositor.renderFrame({ transition: { type: 'cross-dissolve', progress: 0.5 }, animScaleA: 1, animScaleB: 1, grade: NEUTRAL_GRADE });
    gl.calls = [];

    compositor.dispose();

    expect(gl.calls.filter((c) => c === 'deleteTexture')).toHaveLength(5); // texA, texB, rt0, rt1, rt2
    expect(gl.calls.filter((c) => c === 'deleteFramebuffer')).toHaveLength(3);
  });
});
