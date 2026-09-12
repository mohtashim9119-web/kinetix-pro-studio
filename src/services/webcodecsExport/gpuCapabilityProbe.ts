/**
 * Read-only GPU/WebCodecs capability probe.
 *
 * All platform entry points are injected so importing this module has no
 * side effects and its behavior is testable without a browser.
 */

export const TOP_1080P30_ENCODER_CONFIG: Readonly<VideoEncoderConfig> = {
  codec: 'avc1.640028',
  width: 1920,
  height: 1080,
  framerate: 30,
  bitrate: 8_000_000,
  latencyMode: 'quality',
  hardwareAcceleration: 'prefer-hardware',
  avc: { format: 'annexb' },
};

export interface DebugRendererInfoLike {
  readonly UNMASKED_RENDERER_WEBGL: number;
  readonly UNMASKED_VENDOR_WEBGL: number;
}

export interface WebGL2ContextLike {
  getExtension(name: 'WEBGL_debug_renderer_info'): DebugRendererInfoLike | null;
  getParameter(parameter: number): unknown;
}

export type WebGL2ContextFactory = () => WebGL2ContextLike | null;

export interface WebGL2CapabilityReport {
  webgl2Available: boolean;
  unmaskedRendererWebGL: string | null;
  unmaskedVendorWebGL: string | null;
  softwareRasterizationDetected: boolean;
}

export interface VideoEncoderSupportReport {
  supported: boolean | null;
  error: string | null;
}

export interface GpuCapabilityReport extends WebGL2CapabilityReport {
  top1080p30EncoderConfig: Readonly<VideoEncoderConfig>;
  top1080p30EncoderSupport: VideoEncoderSupportReport;
}

export interface GpuCapabilityProbeDependencies {
  createWebGL2Context: WebGL2ContextFactory;
  isVideoEncoderConfigSupported: (
    config: VideoEncoderConfig,
  ) => Promise<Pick<VideoEncoderSupport, 'supported'>>;
}

const SOFTWARE_RENDERER_MARKERS = [
  /swiftshader/i,
  /google inc\..*software renderer/i,
  /software only/i,
] as const;

function stringParameter(
  context: WebGL2ContextLike,
  parameter: number,
): string | null {
  const value = context.getParameter(parameter);
  return typeof value === 'string' && value.length > 0 ? value : null;
}

export function isSoftwareRasterizer(
  renderer: string | null,
  vendor: string | null,
): boolean {
  const identity = `${vendor ?? ''} ${renderer ?? ''}`;
  return SOFTWARE_RENDERER_MARKERS.some((marker) => marker.test(identity));
}

export function inspectWebGL2(
  createContext: WebGL2ContextFactory,
): WebGL2CapabilityReport {
  const context = createContext();
  if (!context) {
    return {
      webgl2Available: false,
      unmaskedRendererWebGL: null,
      unmaskedVendorWebGL: null,
      softwareRasterizationDetected: false,
    };
  }

  const debugInfo = context.getExtension('WEBGL_debug_renderer_info');
  const renderer = debugInfo
    ? stringParameter(context, debugInfo.UNMASKED_RENDERER_WEBGL)
    : null;
  const vendor = debugInfo
    ? stringParameter(context, debugInfo.UNMASKED_VENDOR_WEBGL)
    : null;

  return {
    webgl2Available: true,
    unmaskedRendererWebGL: renderer,
    unmaskedVendorWebGL: vendor,
    softwareRasterizationDetected: isSoftwareRasterizer(renderer, vendor),
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function probeGpuCapabilities(
  dependencies: GpuCapabilityProbeDependencies,
): Promise<GpuCapabilityReport> {
  const webgl = inspectWebGL2(dependencies.createWebGL2Context);
  let encoderSupport: VideoEncoderSupportReport;

  try {
    const result = await dependencies.isVideoEncoderConfigSupported({
      ...TOP_1080P30_ENCODER_CONFIG,
      avc: { format: 'annexb' },
    });
    encoderSupport = { supported: result.supported === true, error: null };
  } catch (error) {
    encoderSupport = { supported: null, error: errorMessage(error) };
  }

  return {
    ...webgl,
    top1080p30EncoderConfig: TOP_1080P30_ENCODER_CONFIG,
    top1080p30EncoderSupport: encoderSupport,
  };
}
