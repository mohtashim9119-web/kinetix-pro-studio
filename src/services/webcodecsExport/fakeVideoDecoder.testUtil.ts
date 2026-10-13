/**
 * Test-only VideoDecoder fake for the Windows spot-decode stall suites.
 *
 * Reproduces the field shape (AMD RX 580 / ANGLE D3D11): a decoder whose mode
 * is set to stall accepts configure + decode, emits nothing, fires no error,
 * and its flush() settles only when the decoder is closed (spec: close rejects
 * pending flushes with AbortError).
 */
import type { Asset } from '../../types';

export const FPS = 24;
export const FRAME_US = Math.round(1e6 / FPS);
export const STALL_BOUND_MS = 4000;

export interface FakeFrame {
  timestamp: number;
  displayWidth: number;
  displayHeight: number;
  closed: boolean;
  close(): void;
}

export const behaviour = { stallHardware: false, stallSoftware: false, softwareUnsupported: false };

export class FakeDecoder {
  static instances: FakeDecoder[] = [];
  configured: VideoDecoderConfig | null = null;
  closed = false;
  private pendingFlush: { resolve: () => void; reject: (e: unknown) => void } | null = null;
  constructor(private readonly init: { output: (f: FakeFrame) => void; error: (e: Error) => void }) {
    FakeDecoder.instances.push(this);
  }
  get state(): string {
    return this.closed ? 'closed' : this.configured ? 'configured' : 'unconfigured';
  }
  get software(): boolean {
    return this.configured?.hardwareAcceleration === 'prefer-software';
  }
  private stalls(): boolean {
    return this.software ? behaviour.stallSoftware : behaviour.stallHardware;
  }
  configure(config: VideoDecoderConfig): void {
    this.configured = config;
    if (this.software && behaviour.softwareUnsupported) {
      queueMicrotask(() => {
        const e = new Error('Unsupported configuration');
        e.name = 'NotSupportedError';
        // Spec: "close VideoDecoder with exception" — pending flushes reject,
        // then the error callback runs.
        this.close();
        this.init.error(e);
      });
    }
  }
  decode(chunk: EncodedVideoChunk): void {
    if (this.closed) throw new Error('decode on closed decoder');
    if (this.stalls() || (this.software && behaviour.softwareUnsupported)) return;
    const ts = chunk.timestamp;
    queueMicrotask(() => {
      if (this.closed) return;
      const frame: FakeFrame = {
        timestamp: ts,
        displayWidth: 1440,
        displayHeight: 810,
        closed: false,
        close() {
          this.closed = true;
        },
      };
      this.init.output(frame);
    });
  }
  flush(): Promise<void> {
    if (this.stalls() || (this.software && behaviour.softwareUnsupported)) {
      return new Promise((resolve, reject) => {
        this.pendingFlush = { resolve, reject };
      });
    }
    return new Promise((resolve) => queueMicrotask(resolve));
  }
  close(): void {
    this.closed = true;
    if (this.pendingFlush) {
      const e = new Error('Aborted due to close()');
      e.name = 'AbortError';
      this.pendingFlush.reject(e);
      this.pendingFlush = null;
    }
  }
}

export const BASE_CONFIG: VideoDecoderConfig = {
  codec: 'avc1.640020',
  codedWidth: 1440,
  codedHeight: 816,
  description: new Uint8Array([1, 2, 3]),
};

export function chunks(n: number): EncodedVideoChunk[] {
  return Array.from({ length: n }, (_, i) => ({
    type: i % 48 === 0 ? 'key' : 'delta',
    timestamp: i * FRAME_US,
    duration: FRAME_US,
  })) as unknown as EncodedVideoChunk[];
}

export const SPOT_ASSET: Asset = {
  id: 'avatar-02',
  type: 'video',
  url: 'asset://avatar-02.mp4',
  duration: 3.5,
} as unknown as Asset;
export const MAIN_URL = 'asset://main.mp4';

export const SPEC = { assetId: 'avatar-02', startSec: 11, durSec: 3.5, xPct: 60, yPct: 60, wPct: 30, hPct: 30 };

export function resetFakeDecoders(): void {
  FakeDecoder.instances = [];
  behaviour.stallHardware = false;
  behaviour.stallSoftware = false;
  behaviour.softwareUnsupported = false;
}
