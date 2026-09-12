import { describe, expect, it, vi } from 'vitest';
import {
  inspectWebGL2,
  isSoftwareRasterizer,
  probeGpuCapabilities,
  TOP_1080P30_ENCODER_CONFIG,
  type WebGL2ContextLike,
} from './gpuCapabilityProbe';

const RENDERER_PARAMETER = 0x9246;
const VENDOR_PARAMETER = 0x9245;

function fakeContext(
  renderer: unknown,
  vendor: unknown,
  exposeDebugInfo = true,
): WebGL2ContextLike {
  return {
    getExtension: () => exposeDebugInfo
      ? {
          UNMASKED_RENDERER_WEBGL: RENDERER_PARAMETER,
          UNMASKED_VENDOR_WEBGL: VENDOR_PARAMETER,
        }
      : null,
    getParameter: (parameter) => {
      if (parameter === RENDERER_PARAMETER) return renderer;
      if (parameter === VENDOR_PARAMETER) return vendor;
      return null;
    },
  };
}

describe('inspectWebGL2', () => {
  it('reports the unmasked hardware renderer and vendor', () => {
    const report = inspectWebGL2(() =>
      fakeContext(
        'ANGLE (NVIDIA, NVIDIA GeForce RTX 3050 Direct3D11)',
        'Google Inc. (NVIDIA)',
      ),
    );

    expect(report).toEqual({
      webgl2Available: true,
      unmaskedRendererWebGL:
        'ANGLE (NVIDIA, NVIDIA GeForce RTX 3050 Direct3D11)',
      unmaskedVendorWebGL: 'Google Inc. (NVIDIA)',
      softwareRasterizationDetected: false,
    });
  });

  it('reports an unavailable WebGL2 context when getContext returns null', () => {
    expect(inspectWebGL2(() => null)).toEqual({
      webgl2Available: false,
      unmaskedRendererWebGL: null,
      unmaskedVendorWebGL: null,
      softwareRasterizationDetected: false,
    });
  });

  it('keeps renderer fields null when debug renderer info is unavailable', () => {
    expect(inspectWebGL2(() => fakeContext('hidden', 'hidden', false))).toEqual({
      webgl2Available: true,
      unmaskedRendererWebGL: null,
      unmaskedVendorWebGL: null,
      softwareRasterizationDetected: false,
    });
  });
});

describe('isSoftwareRasterizer', () => {
  it.each([
    ['ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero)))', 'Google Inc.'],
    ['Google Inc. software renderer', 'Google Inc.'],
    ['ANGLE (Software only, D3D11)', 'Microsoft'],
  ])('detects software marker in %s', (renderer, vendor) => {
    expect(isSoftwareRasterizer(renderer, vendor)).toBe(true);
  });

  it('does not classify a Google ANGLE hardware identity as software', () => {
    expect(
      isSoftwareRasterizer(
        'ANGLE (NVIDIA, NVIDIA GeForce RTX 3050 Direct3D11)',
        'Google Inc. (NVIDIA)',
      ),
    ).toBe(false);
  });
});

describe('probeGpuCapabilities', () => {
  it('probes the exact top-of-ladder 1080p30 config', async () => {
    const isConfigSupported = vi.fn(async () => ({ supported: true }));

    const report = await probeGpuCapabilities({
      createWebGL2Context: () =>
        fakeContext('ANGLE (AMD, Radeon RX 580 Direct3D11)', 'Google Inc. (AMD)'),
      isVideoEncoderConfigSupported: isConfigSupported,
    });

    expect(isConfigSupported).toHaveBeenCalledOnce();
    expect(isConfigSupported).toHaveBeenCalledWith({
      codec: 'avc1.640028',
      width: 1920,
      height: 1080,
      framerate: 30,
      bitrate: 8_000_000,
      latencyMode: 'quality',
      hardwareAcceleration: 'prefer-hardware',
      avc: { format: 'annexb' },
    });
    expect(report.top1080p30EncoderConfig).toEqual(
      TOP_1080P30_ENCODER_CONFIG,
    );
    expect(report.top1080p30EncoderSupport).toEqual({
      supported: true,
      error: null,
    });
  });

  it('reports an isConfigSupported failure without throwing', async () => {
    const report = await probeGpuCapabilities({
      createWebGL2Context: () => null,
      isVideoEncoderConfigSupported: async () => {
        throw new Error('VideoEncoder unavailable');
      },
    });

    expect(report.top1080p30EncoderSupport).toEqual({
      supported: null,
      error: 'VideoEncoder unavailable',
    });
  });
});
