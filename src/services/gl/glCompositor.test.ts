import { describe, it, expect, beforeEach } from 'vitest';
import { GlCompositor } from './glCompositor';
import { NEUTRAL_GRADE, type CompositeParams } from './compositeParams';
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
 * The ping-pong FBO pass-chain exercised by the "zoom+grade both active"
 * tests below is new *structure* beyond what the spike tested (the spike
 * verified each of the 6 shaders standalone, never chained through an
 * offscreen render target) — these tests prove the chain's call sequence
 * and framebuffer bookkeeping are internally consistent against the mock,
 * not that the chained GPU output is pixel-correct on a real device. That
 * remains open for a manual real-app check before Phase 3 integration.
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
  drawArrays(): void { this.calls.push('drawArrays'); }
  viewport(): void {}

  /** Most-recent call to a given uniform name — sufficient for these tests
   *  since each renderFrame call only ever drives one stage-1 program. */
  lastUniform(name: string): number[] | undefined {
    for (let i = this.uniformCalls.length - 1; i >= 0; i--) {
      const call = this.uniformCalls[i];
      if (call && call.name === name) return call.args;
    }
    return undefined;
  }
}

function makeGl(): MockWebGL2 {
  return new MockWebGL2();
}

const neutralParams: CompositeParams = { transition: null, animScale: 1, grade: NEUTRAL_GRADE };
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
   * uploadFrame (glCompositor.ts:269) has NO branching on source type — it
   * casts VideoFrame|ImageBitmap|HTMLImageElement to TexImageSource and
   * calls texImage2D once; the browser's own overloaded texImage2D handles
   * the three source kinds identically. So there is no "routing" branch to
   * exercise here — these tests instead lock in call-shape parity (each
   * source kind reaches texImage2D via the same call, for either slot),
   * which is the property image-segment/video-segment mixing actually
   * depends on. Phase 2 Step 1's real-GPU 12-combo check already proved
   * this holds pixel-correct on real hardware for video/video, image/image,
   * and video/image pairs (docs/webgl-architecture-plan.md Progress
   * Tracker) — these are the mock-based call-sequencing counterpart that
   * check didn't leave behind.
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

  it('mixed-source transition — slot "a" a VideoFrame (outgoing video), slot "b" an ImageBitmap (incoming image) — renderFrame drives the same single-pass draw as a same-type pair, unaffected by the upstream source-kind mismatch', () => {
    const gl = makeGl();
    const compositor = new GlCompositor(gl as unknown as WebGL2RenderingContext);
    compositor.uploadFrame('a', fakeVideoFrame);
    compositor.uploadFrame('b', fakeImageBitmap);
    gl.calls = [];

    compositor.renderFrame({ transition: { type: 'cross-dissolve', progress: 0.5 }, animScale: 1, grade: NEUTRAL_GRADE });

    expect(gl.calls.filter((c) => c === 'drawArrays')).toHaveLength(1);
    expect(gl.calls.filter((c) => c === 'createFramebuffer')).toHaveLength(0);
  });

  it('image<->image transition — both slots ImageBitmap/HTMLImageElement — same pass-chain shape as the video<->video case', () => {
    const gl = makeGl();
    const compositor = new GlCompositor(gl as unknown as WebGL2RenderingContext);
    compositor.uploadFrame('a', fakeImageBitmap);
    compositor.uploadFrame('b', fakeImageElement);
    gl.calls = [];

    compositor.renderFrame({ transition: { type: 'dip-black', progress: 0.5 }, animScale: 1.2, grade: NEUTRAL_GRADE });

    // dip-black + zoom active: 2 draws (stage1 -> rt, zoom rt -> canvas),
    // identical shape to the existing "zoom active" video-sourced test.
    expect(gl.calls.filter((c) => c === 'drawArrays')).toHaveLength(2);
    expect(gl.calls.filter((c) => c === 'createFramebuffer')).toHaveLength(2);
  });

  /**
   * Phase 3 widened UploadSource (HTMLCanvasElement | OffscreenCanvas) —
   * the object-cover pre-fit target useGlPreview.ts uploads (plan Section 7
   * risk register, object-cover row). Same call-shape-parity discipline as
   * the VideoFrame/ImageBitmap/HTMLImageElement tests above: uploadFrame has
   * no source-type branching, so these lock in that the two newly-accepted
   * kinds reach texImage2D via the exact same single call, for either slot —
   * giving this Phase-1 file equivalent coverage over its expanded surface
   * before Phase 3's preview driver depends on it.
   */
  const fakeCanvasElement = { width: 1920, height: 1080, getContext: () => null } as unknown as HTMLCanvasElement;
  const fakeOffscreenCanvas = { width: 1920, height: 1080, getContext: () => null } as unknown as OffscreenCanvas;

  it.each([
    ['HTMLCanvasElement', fakeCanvasElement],
    ['OffscreenCanvas', fakeOffscreenCanvas],
  ] as const)('slot "a" accepts a %s source identically (single texImage2D call, no error)', (_label, source) => {
    const gl = makeGl();
    const compositor = new GlCompositor(gl as unknown as WebGL2RenderingContext);
    gl.calls = [];

    expect(() => compositor.uploadFrame('a', source)).not.toThrow();
    expect(gl.calls.filter((c) => c === 'texImage2D')).toHaveLength(1);
  });

  it.each([
    ['HTMLCanvasElement', fakeCanvasElement],
    ['OffscreenCanvas', fakeOffscreenCanvas],
  ] as const)('slot "b" accepts a %s source identically (single texImage2D call, no error)', (_label, source) => {
    const gl = makeGl();
    const compositor = new GlCompositor(gl as unknown as WebGL2RenderingContext);
    gl.calls = [];

    expect(() => compositor.uploadFrame('b', source)).not.toThrow();
    expect(gl.calls.filter((c) => c === 'texImage2D')).toHaveLength(1);
  });

  it('canvas<->canvas transition — both slots pre-fit HTMLCanvasElement (the object-cover fit path) — same single-pass draw shape as the video<->video and image<->image cases', () => {
    const gl = makeGl();
    const compositor = new GlCompositor(gl as unknown as WebGL2RenderingContext);
    compositor.uploadFrame('a', fakeCanvasElement);
    compositor.uploadFrame('b', fakeOffscreenCanvas);
    gl.calls = [];

    compositor.renderFrame({ transition: { type: 'cross-dissolve', progress: 0.5 }, animScale: 1, grade: NEUTRAL_GRADE });

    expect(gl.calls.filter((c) => c === 'drawArrays')).toHaveLength(1);
    expect(gl.calls.filter((c) => c === 'createFramebuffer')).toHaveLength(0);
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

  it('an active transition with no zoom/grade: one draw call using both texture units (still a single pass to canvas)', () => {
    const gl = makeGl();
    const compositor = new GlCompositor(gl as unknown as WebGL2RenderingContext);
    gl.calls = [];

    compositor.renderFrame({ transition: { type: 'cross-dissolve', progress: 0.5 }, animScale: 1, grade: NEUTRAL_GRADE });

    expect(gl.calls.filter((c) => c === 'drawArrays')).toHaveLength(1);
    expect(gl.calls.filter((c) => c === 'createFramebuffer')).toHaveLength(0);
  });

  it('zoom active, grade neutral: two draw calls, one render target pair allocated (stage1 -> rt, zoom rt -> canvas)', () => {
    const gl = makeGl();
    const compositor = new GlCompositor(gl as unknown as WebGL2RenderingContext);
    gl.calls = [];

    compositor.renderFrame({ transition: null, animScale: 1.2, grade: NEUTRAL_GRADE });

    expect(gl.calls.filter((c) => c === 'drawArrays')).toHaveLength(2);
    expect(gl.calls.filter((c) => c === 'createFramebuffer')).toHaveLength(2); // rt0 + rt1 allocated together
    // createRenderTarget() itself unbinds to the default framebuffer right
    // after creating each target (extra "canvas" binds unrelated to the
    // pass chain) — the meaningful assertion is that the canvas bind for
    // the zoom pass's own output happens before the final draw call.
    const lastCanvasBindIdx = gl.calls.lastIndexOf('bindFramebuffer:canvas');
    const lastDrawIdx = gl.calls.lastIndexOf('drawArrays');
    expect(lastCanvasBindIdx).toBeGreaterThan(-1);
    expect(lastCanvasBindIdx).toBeLessThan(lastDrawIdx);
  });

  it('zoom AND grade both active: three draw calls, chained through both render targets, final pass to canvas', () => {
    const gl = makeGl();
    const compositor = new GlCompositor(gl as unknown as WebGL2RenderingContext);
    gl.calls = [];

    compositor.renderFrame({
      transition: { type: 'dip-black', progress: 0.3 },
      animScale: 1.1,
      grade: { brightness: 0.2, contrast: 0, saturation: 0, temperature: 0 },
    });

    expect(gl.calls.filter((c) => c === 'drawArrays')).toHaveLength(3);
    // The canvas bind for the grade pass (always the final stage when
    // active) must happen before the final draw call.
    const lastCanvasBindIdx = gl.calls.lastIndexOf('bindFramebuffer:canvas');
    const lastDrawIdx = gl.calls.lastIndexOf('drawArrays');
    expect(lastCanvasBindIdx).toBeGreaterThan(-1);
    expect(lastCanvasBindIdx).toBeLessThan(lastDrawIdx);
  });

  it('grade active alone (no zoom): two draw calls, one render target pair allocated', () => {
    const gl = makeGl();
    const compositor = new GlCompositor(gl as unknown as WebGL2RenderingContext);
    gl.calls = [];

    compositor.renderFrame({ transition: null, animScale: 1, grade: { brightness: 0, contrast: 0.4, saturation: 0, temperature: 0 } });

    expect(gl.calls.filter((c) => c === 'drawArrays')).toHaveLength(2);
    expect(gl.calls.filter((c) => c === 'createFramebuffer')).toHaveLength(2);
  });

  it('does not re-allocate render targets across calls at the same drawing-buffer size', () => {
    const gl = makeGl();
    const compositor = new GlCompositor(gl as unknown as WebGL2RenderingContext);
    const zoomParams: CompositeParams = { transition: null, animScale: 1.3, grade: NEUTRAL_GRADE };

    compositor.renderFrame(zoomParams);
    gl.calls = [];
    compositor.renderFrame(zoomParams);

    expect(gl.calls.filter((c) => c === 'createFramebuffer')).toHaveLength(0);
    expect(gl.calls.filter((c) => c === 'createTexture')).toHaveLength(0);
  });

  it('re-allocates render targets when the drawing-buffer size changes (disposing the old pair first)', () => {
    const gl = makeGl();
    const compositor = new GlCompositor(gl as unknown as WebGL2RenderingContext);
    const zoomParams: CompositeParams = { transition: null, animScale: 1.3, grade: NEUTRAL_GRADE };

    compositor.renderFrame(zoomParams);
    gl.drawingBufferWidth = 1280;
    gl.drawingBufferHeight = 720;
    gl.calls = [];
    compositor.renderFrame(zoomParams);

    expect(gl.calls.filter((c) => c === 'deleteFramebuffer')).toHaveLength(2);
    expect(gl.calls.filter((c) => c === 'deleteTexture')).toHaveLength(2);
    expect(gl.calls.filter((c) => c === 'createFramebuffer')).toHaveLength(2);
  });
});

describe('GlCompositor — transition/zoom/grade uniform wiring', () => {
  /**
   * Program-selection/uniform-value tests, not pixel tests — the mock never
   * executes GLSL, so it can't independently re-prove "dip-black renders
   * black." That pixel-math question is already closed (Phase 0 spike,
   * standalone, both engines + Phase 2 Step 1's chained 12-combo real-GPU
   * check). What a mock CAN and should catch is a wiring regression: the
   * wrong program selected for a slug, or the right program fed the wrong
   * uniform value — exactly the class of bug Step 1 found (two things
   * sharing a mechanism, differentiated only by a parameter/branch).
   */

  it('dip-black selects the dip program with u_dipColor = [0,0,0]', () => {
    const gl = makeGl();
    const compositor = new GlCompositor(gl as unknown as WebGL2RenderingContext);
    gl.calls = [];

    compositor.renderFrame({ transition: { type: 'dip-black', progress: 0.5 }, animScale: 1, grade: NEUTRAL_GRADE });

    expect(gl.lastUniform('u_dipColor')).toEqual([0, 0, 0]);
    expect(gl.lastUniform('u_progress')).toEqual([0.5]);
  });

  it('dip-white selects the SAME dip program (shared per glCompositor.ts) with u_dipColor = [1,1,1] — not confused with dip-black', () => {
    const gl = makeGl();
    const compositor = new GlCompositor(gl as unknown as WebGL2RenderingContext);
    gl.calls = [];

    compositor.renderFrame({ transition: { type: 'dip-white', progress: 0.5 }, animScale: 1, grade: NEUTRAL_GRADE });

    expect(gl.lastUniform('u_dipColor')).toEqual([1, 1, 1]);
  });

  it('regression guard: dip-black and dip-white driven back-to-back on the SAME compositor instance never bleed into each other\'s u_dipColor — the two are differentiated only by dipColorFor\'s ternary, exactly the "shared mechanism, parameter-only difference" shape the vertex-shader flip bug taught us to distrust', () => {
    const gl = makeGl();
    const compositor = new GlCompositor(gl as unknown as WebGL2RenderingContext);

    gl.calls = [];
    compositor.renderFrame({ transition: { type: 'dip-black', progress: 0.2 }, animScale: 1, grade: NEUTRAL_GRADE });
    expect(gl.lastUniform('u_dipColor')).toEqual([0, 0, 0]);

    gl.calls = [];
    compositor.renderFrame({ transition: { type: 'dip-white', progress: 0.8 }, animScale: 1, grade: NEUTRAL_GRADE });
    expect(gl.lastUniform('u_dipColor')).toEqual([1, 1, 1]);

    // And back again — proves it's not a one-shot/first-call coincidence.
    gl.calls = [];
    compositor.renderFrame({ transition: { type: 'dip-black', progress: 0.6 }, animScale: 1, grade: NEUTRAL_GRADE });
    expect(gl.lastUniform('u_dipColor')).toEqual([0, 0, 0]);
  });

  it('cross-dissolve selects the cross-dissolve program and wires u_progress', () => {
    const gl = makeGl();
    const compositor = new GlCompositor(gl as unknown as WebGL2RenderingContext);
    gl.calls = [];

    compositor.renderFrame({ transition: { type: 'cross-dissolve', progress: 0.75 }, animScale: 1, grade: NEUTRAL_GRADE });

    expect(gl.lastUniform('u_progress')).toEqual([0.75]);
    // cross-dissolve/light-leak share no dip-color uniform.
    expect(gl.lastUniform('u_dipColor')).toBeUndefined();
  });

  it('light-leak selects the light-leak program (not cross-dissolve or dip) and wires u_progress', () => {
    const gl = makeGl();
    const compositor = new GlCompositor(gl as unknown as WebGL2RenderingContext);
    gl.calls = [];

    compositor.renderFrame({ transition: { type: 'light-leak', progress: 0.4 }, animScale: 1, grade: NEUTRAL_GRADE });

    expect(gl.lastUniform('u_progress')).toEqual([0.4]);
    expect(gl.lastUniform('u_dipColor')).toBeUndefined();
  });

  it('u_scale is wired directly from CompositeParams.animScale (no re-derivation at render time)', () => {
    const gl = makeGl();
    const compositor = new GlCompositor(gl as unknown as WebGL2RenderingContext);
    gl.calls = [];

    compositor.renderFrame({ transition: null, animScale: 1.37, grade: NEUTRAL_GRADE });

    expect(gl.lastUniform('u_scale')).toEqual([1.37]);
  });

  it('grade uniforms are wired directly from GradeParams fields', () => {
    const gl = makeGl();
    const compositor = new GlCompositor(gl as unknown as WebGL2RenderingContext);
    gl.calls = [];

    compositor.renderFrame({
      transition: null,
      animScale: 1,
      grade: { brightness: 0.3, contrast: -0.2, saturation: 0.1, temperature: 0.4 },
    });

    expect(gl.lastUniform('u_brightness')).toEqual([0.3]);
    expect(gl.lastUniform('u_contrast')).toEqual([-0.2]);
    expect(gl.lastUniform('u_saturation')).toEqual([0.1]);
    expect(gl.lastUniform('u_temperature')).toEqual([0.4]);
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
    const zoomParams: CompositeParams = { transition: null, animScale: 1.3, grade: NEUTRAL_GRADE };

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

describe('GlCompositor — vertex-shader flip correction (Phase 2 Step 1 regression)', () => {
  it('drawStage1 programs (blit/cross-dissolve/dip/light-leak) use the flipped vertex shader; zoom/grade use the straight one', () => {
    const gl = makeGl();
    new GlCompositor(gl as unknown as WebGL2RenderingContext);

    // setup() links programs in exactly this order: blit, crossDissolve,
    // dip, lightLeak, zoom, grade — attachShader records each program's
    // vertex-shader source in that same order.
    const [blitVS, crossDissolveVS, dipVS, lightLeakVS, zoomVS, gradeVS] = gl.vertexShaderSourcesByProgram;

    // These sample texA/texB directly (raw VideoFrame/ImageBitmap uploads) — need the flip.
    expect(blitVS).toBe(VERTEX_SHADER_SOURCE);
    expect(crossDissolveVS).toBe(VERTEX_SHADER_SOURCE);
    expect(dipVS).toBe(VERTEX_SHADER_SOURCE);
    expect(lightLeakVS).toBe(VERTEX_SHADER_SOURCE);

    // zoom/grade only ever sample a render-target texture in this
    // compositor's call graph (renderFrame always routes them through
    // rt0/rt1) — must NOT re-apply the flip, or the chain double-flips.
    // This is exactly the bug the Phase 2 Step 1 real-GPU smoke test found:
    // every 2-draw zoom-only/grade-only chain rendered upside-down.
    expect(zoomVS).toBe(VERTEX_SHADER_SOURCE_STRAIGHT);
    expect(gradeVS).toBe(VERTEX_SHADER_SOURCE_STRAIGHT);
    expect(zoomVS).not.toBe(VERTEX_SHADER_SOURCE);
    expect(gradeVS).not.toBe(VERTEX_SHADER_SOURCE);
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

  it('also deletes the render-target textures/framebuffers when they were allocated', () => {
    const gl = makeGl();
    const compositor = new GlCompositor(gl as unknown as WebGL2RenderingContext);
    compositor.renderFrame({ transition: null, animScale: 1.3, grade: NEUTRAL_GRADE });
    gl.calls = [];

    compositor.dispose();

    expect(gl.calls.filter((c) => c === 'deleteTexture')).toHaveLength(4); // texA, texB, rt0, rt1
    expect(gl.calls.filter((c) => c === 'deleteFramebuffer')).toHaveLength(2);
  });
});
