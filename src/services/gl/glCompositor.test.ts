import { describe, it, expect, beforeEach } from 'vitest';
import { GlCompositor } from './glCompositor';
import { NEUTRAL_GRADE, type CompositeParams } from './compositeParams';

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

  createShader(): unknown { this.calls.push('createShader'); return nextId('shader'); }
  shaderSource(): void {}
  compileShader(): void { this.calls.push('compileShader'); }
  getShaderParameter(): boolean { return true; }
  getShaderInfoLog(): string | null { return null; }
  deleteShader(): void { this.calls.push('deleteShader'); }

  createProgram(): unknown { this.calls.push('createProgram'); return nextId('program'); }
  attachShader(): void {}
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

  useProgram(): void { this.calls.push('useProgram'); }
  uniform1i(): void {}
  uniform1f(): void {}
  uniform3f(): void {}
  drawArrays(): void { this.calls.push('drawArrays'); }
  viewport(): void {}
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
