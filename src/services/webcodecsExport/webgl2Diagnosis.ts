/**
 * Read-only WebGL2 export-capability diagnosis.
 *
 * Self-contained: no imports from pipeline, hooks, or glContext. Answers
 * "why not WebGL2" for field diagnosis when isWebCodecsExportCapable()'s
 * boolean gate fails silently. All platform entry points are injected.
 */

import { isSoftwareRasterizer } from './gpuCapabilityProbe';

/** WebGL enum values — inlined so this module needs no DOM/WebGL types at runtime. */
const MAX_TEXTURE_SIZE = 0x0d33;
const MAX_RENDERBUFFER_SIZE = 0x84e8;
const MAX_VIEWPORT_DIMS = 0x0d3a;

/**
 * Extensions queried by this module for diagnosis only. glCompositor.ts uses
 * no optional getExtension() calls — core WebGL2 (GLSL ES 3.0) only.
 */
export const GL_COMPOSITOR_REQUIRED_EXTENSIONS: readonly string[] = [];

/** Largest export width the app ships today (1080p tier, resolutionConfig.ts). */
export const GL_COMPOSITOR_MIN_TEXTURE_SIZE = 1920;

export type WebGl2DiagnosisReasonCode =
  | 'ok'
  | 'canvas-unavailable'
  | 'get-context-null'
  | 'get-context-threw'
  | 'webgl2-unavailable-webgl1-available'
  | 'context-immediately-lost'
  | 'software-renderer'
  | 'missing-required-limit';

export interface WebGl2LimitReport {
  name: 'MAX_TEXTURE_SIZE' | 'MAX_RENDERBUFFER_SIZE' | 'MAX_VIEWPORT_DIMS';
  value: number | null;
  requiredMinimum: number;
  sufficient: boolean;
}

export interface WebGl2DiagnosisReport {
  ok: boolean;
  reasonCode: WebGl2DiagnosisReasonCode;
  /** Human-readable detail for operators / diagnostics blob. */
  reasonDetail: string | null;
  webgl2Available: boolean;
  webgl1Available: boolean;
  contextLost: boolean;
  unmaskedRendererWebGL: string | null;
  unmaskedVendorWebGL: string | null;
  softwareRasterizationDetected: boolean;
  limits: readonly WebGl2LimitReport[];
  missingLimits: readonly string[];
  /** Always empty today — glCompositor.ts requires no optional extensions. */
  missingExtensions: readonly string[];
  /** Milliseconds spent inside diagnoseWebGl2ExportCapability (for cost reporting). */
  elapsedMs: number;
}

export interface WebGl2LoseContextExtension {
  loseContext(): void;
}

export interface WebGl2DebugRendererInfoExtension {
  readonly UNMASKED_RENDERER_WEBGL: number;
  readonly UNMASKED_VENDOR_WEBGL: number;
}

export interface DiagnosisGlContextLike {
  getExtension(name: string): unknown;
  getParameter(parameter: number): unknown;
  isContextLost(): boolean;
}

export interface DiagnosisCanvasLike {
  getContext(contextId: string, attrs?: WebGLContextAttributes): DiagnosisGlContextLike | null;
}

export interface WebGl2DiagnosisDependencies {
  /** False in workers and other scopes without document.createElement. */
  hasDocument: boolean;
  /** Returns a throwaway canvas, or null when none can be allocated. */
  createCanvas: () => DiagnosisCanvasLike | null;
  minTextureSize?: number;
}

function stringParameter(context: DiagnosisGlContextLike, parameter: number): string | null {
  const value = context.getParameter(parameter);
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function intParameter(context: DiagnosisGlContextLike, parameter: number): number | null {
  const value = context.getParameter(parameter);
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function viewportMinimum(context: DiagnosisGlContextLike): number | null {
  const value = context.getParameter(MAX_VIEWPORT_DIMS);
  if (value instanceof Int32Array && value.length >= 2) {
    return Math.min(value[0]!, value[1]!);
  }
  if (Array.isArray(value) && value.length >= 2) {
    const w = value[0];
    const h = value[1];
    if (typeof w === 'number' && typeof h === 'number') return Math.min(w, h);
  }
  return null;
}

function readRendererIdentity(context: DiagnosisGlContextLike): {
  unmaskedRendererWebGL: string | null;
  unmaskedVendorWebGL: string | null;
} {
  const debugInfo = context.getExtension('WEBGL_debug_renderer_info') as WebGl2DebugRendererInfoExtension | null;
  if (!debugInfo) {
    return { unmaskedRendererWebGL: null, unmaskedVendorWebGL: null };
  }
  return {
    unmaskedRendererWebGL: stringParameter(context, debugInfo.UNMASKED_RENDERER_WEBGL),
    unmaskedVendorWebGL: stringParameter(context, debugInfo.UNMASKED_VENDOR_WEBGL),
  };
}

function collectLimits(
  context: DiagnosisGlContextLike,
  minTextureSize: number,
): { limits: WebGl2LimitReport[]; missingLimits: string[] } {
  const limits: WebGl2LimitReport[] = [
    {
      name: 'MAX_TEXTURE_SIZE',
      value: intParameter(context, MAX_TEXTURE_SIZE),
      requiredMinimum: minTextureSize,
      sufficient: (intParameter(context, MAX_TEXTURE_SIZE) ?? 0) >= minTextureSize,
    },
    {
      name: 'MAX_RENDERBUFFER_SIZE',
      value: intParameter(context, MAX_RENDERBUFFER_SIZE),
      requiredMinimum: minTextureSize,
      sufficient: (intParameter(context, MAX_RENDERBUFFER_SIZE) ?? 0) >= minTextureSize,
    },
    {
      name: 'MAX_VIEWPORT_DIMS',
      value: viewportMinimum(context),
      requiredMinimum: minTextureSize,
      sufficient: (viewportMinimum(context) ?? 0) >= minTextureSize,
    },
  ];
  const missingLimits = limits.filter((l) => !l.sufficient).map((l) => l.name);
  return { limits, missingLimits };
}

function releaseContext(context: DiagnosisGlContextLike): void {
  try {
    const loseExt = context.getExtension('WEBGL_lose_context') as WebGl2LoseContextExtension | null;
    loseExt?.loseContext();
  } catch {
    // Best-effort release only — diagnosis must never throw from cleanup.
  }
}

function tryGetContext(
  canvas: DiagnosisCanvasLike,
  contextId: string,
): { context: DiagnosisGlContextLike | null; threw: unknown | null } {
  try {
    return { context: canvas.getContext(contextId), threw: null };
  } catch (err) {
    return { context: null, threw: err };
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function buildReport(
  partial: Omit<WebGl2DiagnosisReport, 'elapsedMs'>,
  startedAt: number,
): WebGl2DiagnosisReport {
  return { ...partial, elapsedMs: Math.round((performance.now() - startedAt) * 100) / 100 };
}

/**
 * Probes WebGL2 export readiness on a throwaway canvas. Never throws — a
 * diagnosis module that throws during diagnosis is worse than no module.
 */
export function diagnoseWebGl2ExportCapability(
  dependencies: WebGl2DiagnosisDependencies,
): WebGl2DiagnosisReport {
  const startedAt = performance.now();
  const minTextureSize = dependencies.minTextureSize ?? GL_COMPOSITOR_MIN_TEXTURE_SIZE;

  let canvas: DiagnosisCanvasLike | null = null;
  try {
    canvas = dependencies.createCanvas();
  } catch (err) {
    return buildReport(
      {
        ok: false,
        reasonCode: 'canvas-unavailable',
        reasonDetail: `createCanvas threw: ${errorMessage(err)}`,
        webgl2Available: false,
        webgl1Available: false,
        contextLost: false,
        unmaskedRendererWebGL: null,
        unmaskedVendorWebGL: null,
        softwareRasterizationDetected: false,
        limits: [],
        missingLimits: [],
        missingExtensions: [...GL_COMPOSITOR_REQUIRED_EXTENSIONS],
      },
      startedAt,
    );
  }

  if (!canvas) {
    const scope = dependencies.hasDocument ? 'document scope' : 'worker scope';
    return buildReport(
      {
        ok: false,
        reasonCode: 'canvas-unavailable',
        reasonDetail: `No canvas could be allocated (${scope}; OffscreenCanvas absent or createElement unavailable).`,
        webgl2Available: false,
        webgl1Available: false,
        contextLost: false,
        unmaskedRendererWebGL: null,
        unmaskedVendorWebGL: null,
        softwareRasterizationDetected: false,
        limits: [],
        missingLimits: [],
        missingExtensions: [...GL_COMPOSITOR_REQUIRED_EXTENSIONS],
      },
      startedAt,
    );
  }

  const webgl2Attempt = tryGetContext(canvas, 'webgl2');
  if (webgl2Attempt.threw !== null) {
    return buildReport(
      {
        ok: false,
        reasonCode: 'get-context-threw',
        reasonDetail: errorMessage(webgl2Attempt.threw),
        webgl2Available: false,
        webgl1Available: false,
        contextLost: false,
        unmaskedRendererWebGL: null,
        unmaskedVendorWebGL: null,
        softwareRasterizationDetected: false,
        limits: [],
        missingLimits: [],
        missingExtensions: [...GL_COMPOSITOR_REQUIRED_EXTENSIONS],
      },
      startedAt,
    );
  }

  const gl2 = webgl2Attempt.context;
  if (!gl2) {
    const webgl1Attempt = tryGetContext(canvas, 'webgl');
    const webgl1 =
      webgl1Attempt.context ??
      (webgl1Attempt.threw === null ? tryGetContext(canvas, 'experimental-webgl').context : null);
    if (webgl1) {
      releaseContext(webgl1);
      return buildReport(
        {
          ok: false,
          reasonCode: 'webgl2-unavailable-webgl1-available',
          reasonDetail: 'WebGL1 context succeeded but WebGL2 returned null — partial GPU capability only.',
          webgl2Available: false,
          webgl1Available: true,
          contextLost: false,
          unmaskedRendererWebGL: null,
          unmaskedVendorWebGL: null,
          softwareRasterizationDetected: false,
          limits: [],
          missingLimits: [],
          missingExtensions: [...GL_COMPOSITOR_REQUIRED_EXTENSIONS],
        },
        startedAt,
      );
    }
    return buildReport(
      {
        ok: false,
        reasonCode: 'get-context-null',
        reasonDetail: 'canvas.getContext("webgl2") returned null and no WebGL1 fallback context was created.',
        webgl2Available: false,
        webgl1Available: false,
        contextLost: false,
        unmaskedRendererWebGL: null,
        unmaskedVendorWebGL: null,
        softwareRasterizationDetected: false,
        limits: [],
        missingLimits: [],
        missingExtensions: [...GL_COMPOSITOR_REQUIRED_EXTENSIONS],
      },
      startedAt,
    );
  }

  try {
    if (gl2.isContextLost()) {
      return buildReport(
        {
          ok: false,
          reasonCode: 'context-immediately-lost',
          reasonDetail: 'WebGL2 context was created but isContextLost() is already true.',
          webgl2Available: false,
          webgl1Available: false,
          contextLost: true,
          unmaskedRendererWebGL: null,
          unmaskedVendorWebGL: null,
          softwareRasterizationDetected: false,
          limits: [],
          missingLimits: [],
          missingExtensions: [...GL_COMPOSITOR_REQUIRED_EXTENSIONS],
        },
        startedAt,
      );
    }

    const identity = readRendererIdentity(gl2);
    const { limits, missingLimits } = collectLimits(gl2, minTextureSize);

    if (missingLimits.length > 0) {
      return buildReport(
        {
          ok: false,
          reasonCode: 'missing-required-limit',
          reasonDetail: `Insufficient GL limits for ${minTextureSize}px export: ${missingLimits.join(', ')}.`,
          webgl2Available: true,
          webgl1Available: false,
          contextLost: false,
          unmaskedRendererWebGL: identity.unmaskedRendererWebGL,
          unmaskedVendorWebGL: identity.unmaskedVendorWebGL,
          softwareRasterizationDetected: isSoftwareRasterizer(
            identity.unmaskedRendererWebGL,
            identity.unmaskedVendorWebGL,
          ),
          limits,
          missingLimits,
          missingExtensions: [],
        },
        startedAt,
      );
    }

    const software = isSoftwareRasterizer(identity.unmaskedRendererWebGL, identity.unmaskedVendorWebGL);
    if (software) {
      return buildReport(
        {
          ok: false,
          reasonCode: 'software-renderer',
          reasonDetail: 'WebGL2 context reports a software rasterizer (SwiftShader or equivalent).',
          webgl2Available: true,
          webgl1Available: false,
          contextLost: false,
          unmaskedRendererWebGL: identity.unmaskedRendererWebGL,
          unmaskedVendorWebGL: identity.unmaskedVendorWebGL,
          softwareRasterizationDetected: true,
          limits,
          missingLimits: [],
          missingExtensions: [],
        },
        startedAt,
      );
    }

    return buildReport(
      {
        ok: true,
        reasonCode: 'ok',
        reasonDetail: null,
        webgl2Available: true,
        webgl1Available: false,
        contextLost: false,
        unmaskedRendererWebGL: identity.unmaskedRendererWebGL,
        unmaskedVendorWebGL: identity.unmaskedVendorWebGL,
        softwareRasterizationDetected: false,
        limits,
        missingLimits: [],
        missingExtensions: [],
      },
      startedAt,
    );
  } finally {
    releaseContext(gl2);
  }
}
