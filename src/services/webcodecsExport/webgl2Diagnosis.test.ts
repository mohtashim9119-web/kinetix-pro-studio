import { describe, expect, it, vi } from 'vitest';
import {
  diagnoseWebGl2ExportCapability,
  GL_COMPOSITOR_MIN_TEXTURE_SIZE,
  GL_COMPOSITOR_REQUIRED_EXTENSIONS,
  type DiagnosisCanvasLike,
  type DiagnosisGlContextLike,
  type WebGl2DiagnosisDependencies,
} from './webgl2Diagnosis';

const MAX_TEXTURE_SIZE = 0x0d33;
const MAX_RENDERBUFFER_SIZE = 0x84e8;
const MAX_VIEWPORT_DIMS = 0x0d3a;
const RENDERER_PARAMETER = 0x9246;
const VENDOR_PARAMETER = 0x9245;

interface FakeContextOptions {
  lost?: boolean;
  maxTextureSize?: number;
  maxRenderbufferSize?: number;
  maxViewportMin?: number;
  renderer?: string | null;
  vendor?: string | null;
  exposeDebugInfo?: boolean;
  loseContextExtension?: { loseContext: ReturnType<typeof vi.fn> } | null;
}

function fakeGlContext(options: FakeContextOptions = {}): DiagnosisGlContextLike {
  const {
    lost = false,
    maxTextureSize = 8192,
    maxRenderbufferSize = 8192,
    maxViewportMin = 8192,
    renderer = 'ANGLE (NVIDIA, NVIDIA GeForce RTX 3050 Direct3D11)',
    vendor = 'Google Inc. (NVIDIA)',
    exposeDebugInfo = true,
    loseContextExtension = { loseContext: vi.fn() },
  } = options;

  return {
    isContextLost: () => lost,
    getExtension: (name: string) => {
      if (name === 'WEBGL_lose_context') return loseContextExtension;
      if (name === 'WEBGL_debug_renderer_info' && exposeDebugInfo) {
        return {
          UNMASKED_RENDERER_WEBGL: RENDERER_PARAMETER,
          UNMASKED_VENDOR_WEBGL: VENDOR_PARAMETER,
        };
      }
      return null;
    },
    getParameter: (parameter: number) => {
      if (parameter === MAX_TEXTURE_SIZE) return maxTextureSize;
      if (parameter === MAX_RENDERBUFFER_SIZE) return maxRenderbufferSize;
      if (parameter === MAX_VIEWPORT_DIMS) return new Int32Array([maxViewportMin, maxViewportMin]);
      if (parameter === RENDERER_PARAMETER) return renderer;
      if (parameter === VENDOR_PARAMETER) return vendor;
      return null;
    },
  };
}

function fakeCanvas(
  contexts: Record<string, DiagnosisGlContextLike | null | (() => never)>,
): DiagnosisCanvasLike {
  return {
    getContext(contextId: string) {
      const entry = contexts[contextId];
      if (typeof entry === 'function') throw entry();
      return entry ?? null;
    },
  };
}

function deps(overrides: Partial<WebGl2DiagnosisDependencies>): WebGl2DiagnosisDependencies {
  return {
    hasDocument: true,
    createCanvas: () => fakeCanvas({ webgl2: fakeGlContext() }),
    ...overrides,
  };
}

describe('diagnoseWebGl2ExportCapability', () => {
  it('reports ok for a healthy WebGL2 context with sufficient limits', () => {
    const loseContext = vi.fn();
    const report = diagnoseWebGl2ExportCapability(
      deps({
        createCanvas: () =>
          fakeCanvas({
            webgl2: fakeGlContext({ loseContextExtension: { loseContext: loseContext } }),
          }),
      }),
    );

    expect(report.reasonCode).toBe('ok');
    expect(report.ok).toBe(true);
    expect(report.webgl2Available).toBe(true);
    expect(report.unmaskedRendererWebGL).toContain('RTX 3050');
    expect(report.missingLimits).toEqual([]);
    expect(report.missingExtensions).toEqual([]);
    expect(GL_COMPOSITOR_REQUIRED_EXTENSIONS).toEqual([]);
    expect(loseContext).toHaveBeenCalledOnce();
  });

  it('get-context-null — webgl2 and webgl1 both unavailable', () => {
    const report = diagnoseWebGl2ExportCapability(
      deps({
        createCanvas: () => fakeCanvas({ webgl2: null, webgl: null, 'experimental-webgl': null }),
      }),
    );

    expect(report).toMatchObject({
      ok: false,
      reasonCode: 'get-context-null',
      webgl2Available: false,
      webgl1Available: false,
    });
    expect(report.reasonDetail).toContain('returned null');
  });

  it('get-context-threw — surfaces the thrown message without propagating', () => {
    const report = diagnoseWebGl2ExportCapability(
      deps({
        createCanvas: () => ({
          getContext(contextId: string) {
            if (contextId === 'webgl2') throw new Error('GPU process blocked WebGL2');
            return null;
          },
        }),
      }),
    );

    expect(report).toMatchObject({
      ok: false,
      reasonCode: 'get-context-threw',
      webgl2Available: false,
    });
    expect(report.reasonDetail).toBe('GPU process blocked WebGL2');
  });

  it('webgl2-unavailable-webgl1-available — partial capability', () => {
    const loseContext = vi.fn();
    const report = diagnoseWebGl2ExportCapability(
      deps({
        createCanvas: () =>
          fakeCanvas({
            webgl2: null,
            webgl: fakeGlContext({ loseContextExtension: { loseContext: loseContext } }),
          }),
      }),
    );

    expect(report).toMatchObject({
      ok: false,
      reasonCode: 'webgl2-unavailable-webgl1-available',
      webgl2Available: false,
      webgl1Available: true,
    });
    expect(loseContext).toHaveBeenCalledOnce();
  });

  it('context-immediately-lost — isContextLost() true right after creation', () => {
    const report = diagnoseWebGl2ExportCapability(
      deps({
        createCanvas: () => fakeCanvas({ webgl2: fakeGlContext({ lost: true }) }),
      }),
    );

    expect(report).toMatchObject({
      ok: false,
      reasonCode: 'context-immediately-lost',
      contextLost: true,
      webgl2Available: false,
    });
  });

  it('software-renderer — SwiftShader identity via shared isSoftwareRasterizer markers', () => {
    const report = diagnoseWebGl2ExportCapability(
      deps({
        createCanvas: () =>
          fakeCanvas({
            webgl2: fakeGlContext({
              renderer: 'ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero)))',
              vendor: 'Google Inc.',
            }),
          }),
      }),
    );

    expect(report).toMatchObject({
      ok: false,
      reasonCode: 'software-renderer',
      webgl2Available: true,
      softwareRasterizationDetected: true,
    });
  });

  it('canvas-unavailable — worker scope with no canvas factory', () => {
    const report = diagnoseWebGl2ExportCapability({
      hasDocument: false,
      createCanvas: () => null,
    });

    expect(report).toMatchObject({
      ok: false,
      reasonCode: 'canvas-unavailable',
      webgl2Available: false,
    });
    expect(report.reasonDetail).toContain('worker scope');
  });

  it('canvas-unavailable — createCanvas throws without diagnosis throwing', () => {
    const report = diagnoseWebGl2ExportCapability({
      hasDocument: true,
      createCanvas: () => {
        throw new Error('document.createElement is not a function');
      },
    });

    expect(report.reasonCode).toBe('canvas-unavailable');
    expect(report.reasonDetail).toContain('createCanvas threw');
  });

  it('missing-required-limit — MAX_TEXTURE_SIZE below export minimum', () => {
    const report = diagnoseWebGl2ExportCapability(
      deps({
        createCanvas: () =>
          fakeCanvas({
            webgl2: fakeGlContext({
              maxTextureSize: 1024,
              maxRenderbufferSize: 8192,
              maxViewportMin: 8192,
            }),
          }),
        minTextureSize: GL_COMPOSITOR_MIN_TEXTURE_SIZE,
      }),
    );

    expect(report).toMatchObject({
      ok: false,
      reasonCode: 'missing-required-limit',
      webgl2Available: true,
    });
    expect(report.missingLimits).toContain('MAX_TEXTURE_SIZE');
    expect(report.limits.find((l) => l.name === 'MAX_TEXTURE_SIZE')?.value).toBe(1024);
  });

  it('degrades gracefully when WEBGL_debug_renderer_info is absent', () => {
    const report = diagnoseWebGl2ExportCapability(
      deps({
        createCanvas: () => fakeCanvas({ webgl2: fakeGlContext({ exposeDebugInfo: false }) }),
      }),
    );

    expect(report.reasonCode).toBe('ok');
    expect(report.unmaskedRendererWebGL).toBeNull();
    expect(report.unmaskedVendorWebGL).toBeNull();
    expect(report.softwareRasterizationDetected).toBe(false);
  });

  it('never throws from diagnoseWebGl2ExportCapability itself', () => {
    expect(() =>
      diagnoseWebGl2ExportCapability({
        hasDocument: false,
        createCanvas: () => {
          throw new RangeError('totally broken');
        },
      }),
    ).not.toThrow();
  });
});
