/**
 * Windows spot-decode stall — the spot decoder must not contend with the
 * main-timeline decoder, and a spot decoder that stalls gets ONE software
 * retry, never a loop.
 *
 * Field shape (AMD RX 580 / ANGLE D3D11): a second hardware VideoDecoder
 * accepts configure + decode, then stops emitting frames without firing
 * `error`, so `flush()` never settles. The fake below reproduces exactly
 * that: a decoder configured without `prefer-software` swallows every chunk
 * when `stallHardware` is on, and its flush only settles on close().
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../videoDemuxer', () => ({
  getOrCreateDemux: vi.fn(),
  demuxCacheHas: vi.fn(() => true),
}));

import { getOrCreateDemux } from '../videoDemuxer';
import {
  decodeSegmentFrames,
  decodeResourceCounts,
  resetDecodeResourceCounts,
} from './sequentialDecode';
import {
  SpotPlaybackController,
  SpotDecodeStalledError,
  isWindowsDecoderPlatform,
} from './spotPlayback';
import type { Asset } from '../../types';

const FPS = 24;
const FRAME_US = Math.round(1e6 / FPS);
const STALL_BOUND_MS = 4000;

interface FakeFrame {
  timestamp: number;
  displayWidth: number;
  displayHeight: number;
  closed: boolean;
  close(): void;
}

const behaviour = { stallHardware: false, stallSoftware: false, softwareUnsupported: false };

class FakeDecoder {
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

const BASE_CONFIG: VideoDecoderConfig = {
  codec: 'avc1.640020',
  codedWidth: 1440,
  codedHeight: 816,
  description: new Uint8Array([1, 2, 3]),
};

function chunks(n: number): EncodedVideoChunk[] {
  return Array.from({ length: n }, (_, i) => ({
    type: i % 48 === 0 ? 'key' : 'delta',
    timestamp: i * FRAME_US,
    duration: FRAME_US,
  })) as unknown as EncodedVideoChunk[];
}

const SPOT_ASSET: Asset = {
  id: 'avatar-02',
  type: 'video',
  url: 'asset://avatar-02.mp4',
  duration: 3.5,
} as unknown as Asset;
const MAIN_URL = 'asset://main.mp4';

const SPEC = { assetId: 'avatar-02', startSec: 11, durSec: 3.5, xPct: 60, yPct: 60, wPct: 30, hPct: 30 };

beforeEach(() => {
  vi.useFakeTimers();
  FakeDecoder.instances = [];
  behaviour.stallHardware = false;
  behaviour.stallSoftware = false;
  behaviour.softwareUnsupported = false;
  resetDecodeResourceCounts();
  vi.stubGlobal('VideoDecoder', FakeDecoder);
  vi.mocked(getOrCreateDemux).mockImplementation(async () => ({
    config: BASE_CONFIG,
    chunks: chunks(84),
    durationSec: 3.5,
  }));
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

/** Opens a main-timeline decoder the way exportWorker's cursor does (no
 *  options) and pulls one frame so the decoder is actually constructed. */
async function openMainTimelineDecoder(): Promise<AsyncGenerator<VideoFrame>> {
  const gen = decodeSegmentFrames(MAIN_URL, 0, 10);
  const first = await gen.next();
  (first.value as unknown as FakeFrame).close();
  return gen;
}

function spotDecoders(): FakeDecoder[] {
  // Main-timeline decoders are configured from the same demux config; tell
  // them apart by construction order (tests open the main one first).
  return FakeDecoder.instances;
}

describe('Windows spot-decode stall — proactive route', () => {
  it('(1) with a main-timeline decoder already open, the spot decoder is configured prefer-software', async () => {
    const main = await openMainTimelineDecoder();
    expect(decodeResourceCounts().decodersOpen).toBe(1);

    const ctl = new SpotPlaybackController([SPOT_ASSET], [SPEC], {
      preferSoftwareWhenContended: true,
      stallBoundMs: STALL_BOUND_MS,
    });
    const samples = await ctl.sampleAt(11);
    expect(samples).toHaveLength(1);

    const spotDecoder = spotDecoders()[1]!;
    expect(spotDecoder.configured?.hardwareAcceleration).toBe('prefer-software');
    expect(spotDecoder.configured?.codec).toBe('avc1.640020');
    await ctl.dispose();
    await main.return(undefined);
  });

  it('does not fire on a platform that is not gated in (macOS keeps the default decoder)', async () => {
    const main = await openMainTimelineDecoder();
    const ctl = new SpotPlaybackController([SPOT_ASSET], [SPEC], {
      preferSoftwareWhenContended: false,
      stallBoundMs: STALL_BOUND_MS,
    });
    await ctl.sampleAt(11);
    expect(spotDecoders()[1]!.configured).toBe(BASE_CONFIG);
    await ctl.dispose();
    await main.return(undefined);
  });

  it('does not fire when no other decoder is open (nothing to contend with)', async () => {
    const ctl = new SpotPlaybackController([SPOT_ASSET], [SPEC], {
      preferSoftwareWhenContended: true,
      stallBoundMs: STALL_BOUND_MS,
    });
    await ctl.sampleAt(11);
    expect(spotDecoders()[0]!.configured).toBe(BASE_CONFIG);
    await ctl.dispose();
  });

  it('detects the gated platform from the worker user agent (WebView2 on Windows only)', () => {
    expect(
      isWindowsDecoderPlatform(
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36 Edg/129.0.0.0',
      ),
    ).toBe(true);
    expect(
      isWindowsDecoderPlatform('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko)'),
    ).toBe(false);
    expect(isWindowsDecoderPlatform(undefined)).toBe(false);
  });

  it('falls back to the default decoder when software decode is unsupported on the proactive route', async () => {
    behaviour.softwareUnsupported = true;
    const main = await openMainTimelineDecoder();
    const ctl = new SpotPlaybackController([SPOT_ASSET], [SPEC], {
      preferSoftwareWhenContended: true,
      stallBoundMs: STALL_BOUND_MS,
    });
    const samples = await ctl.sampleAt(11);
    expect(samples).toHaveLength(1);
    const [, first, second] = spotDecoders();
    expect(first!.configured?.hardwareAcceleration).toBe('prefer-software');
    expect(second!.configured).toBe(BASE_CONFIG);
    await ctl.dispose();
    await main.return(undefined);
  });
});

describe('Windows spot-decode stall — reactive route (one downgrade per asset)', () => {
  it('(2) a spot decoder that stalls once is retried exactly once in software and then succeeds', async () => {
    behaviour.stallHardware = true;
    const ctl = new SpotPlaybackController([SPOT_ASSET], [SPEC], {
      preferSoftwareWhenContended: false,
      stallBoundMs: STALL_BOUND_MS,
    });
    const pending = ctl.sampleAt(11);
    await vi.advanceTimersByTimeAsync(STALL_BOUND_MS + 50);
    const samples = await pending;
    expect(samples).toHaveLength(1);

    expect(spotDecoders()).toHaveLength(2);
    expect(spotDecoders()[0]!.configured).toBe(BASE_CONFIG);
    expect(spotDecoders()[0]!.closed).toBe(true);
    expect(spotDecoders()[1]!.configured?.hardwareAcceleration).toBe('prefer-software');
    expect(ctl.snapshotFindings().some((f) => f.startsWith('spot-decoder-downgraded:') && f.includes('avatar-02'))).toBe(true);

    // Later frames of the same window keep using the software session.
    await ctl.sampleAt(12);
    expect(spotDecoders()).toHaveLength(2);
    await ctl.dispose();
  });

  it('(3) a spot decoder that stalls twice fails honestly, naming the asset, with no third attempt', async () => {
    behaviour.stallHardware = true;
    behaviour.stallSoftware = true;
    const ctl = new SpotPlaybackController([SPOT_ASSET], [SPEC], {
      preferSoftwareWhenContended: false,
      stallBoundMs: STALL_BOUND_MS,
    });
    const pending = ctl.sampleAt(11);
    const settled = pending.then(
      () => null,
      (e: unknown) => e,
    );
    await vi.advanceTimersByTimeAsync(STALL_BOUND_MS * 2 + 100);
    const err = await settled;
    expect(err).toBeInstanceOf(SpotDecodeStalledError);
    expect((err as Error).message).toContain('avatar-02');
    expect((err as SpotDecodeStalledError).assetId).toBe('avatar-02');
    expect((err as SpotDecodeStalledError).attempts).toBe(2);

    // Pin: exactly two decoders, never a third — even if sampled again.
    expect(spotDecoders()).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(STALL_BOUND_MS * 3);
    expect(spotDecoders()).toHaveLength(2);
    await ctl.dispose();
  });

  it('a later window of an already-downgraded asset starts in software and a stall there fails, never re-ladders', async () => {
    behaviour.stallHardware = true;
    const spec2 = { ...SPEC, startSec: 30 };
    const ctl = new SpotPlaybackController([SPOT_ASSET], [SPEC, spec2], {
      preferSoftwareWhenContended: false,
      stallBoundMs: STALL_BOUND_MS,
    });
    const first = ctl.sampleAt(11);
    await vi.advanceTimersByTimeAsync(STALL_BOUND_MS + 50);
    await first;
    expect(spotDecoders()).toHaveLength(2);

    await ctl.sampleAt(30);
    expect(spotDecoders()).toHaveLength(3);
    expect(spotDecoders()[2]!.configured?.hardwareAcceleration).toBe('prefer-software');
    await ctl.dispose();
  });
});

describe('Windows spot-decode stall — pins', () => {
  it('(4) healthy decode is unchanged: config passed through by identity, same frames in the same order', async () => {
    const gen = decodeSegmentFrames(MAIN_URL, 0, 1);
    const seen: number[] = [];
    for await (const f of gen) {
      seen.push(f.timestamp);
      f.close();
    }
    expect(FakeDecoder.instances).toHaveLength(1);
    expect(FakeDecoder.instances[0]!.configured).toBe(BASE_CONFIG);
    // [0, 1s) backs onto the GOP at 0 and runs to the margin keyframe (48):
    // the generator yields every frame from startSec through that margin.
    expect(seen).toEqual(Array.from({ length: 49 }, (_, i) => i * FRAME_US));

    // A healthy spot on an un-gated platform is byte-for-byte the old path.
    const ctl = new SpotPlaybackController([SPOT_ASSET], [SPEC], {
      preferSoftwareWhenContended: false,
      stallBoundMs: STALL_BOUND_MS,
    });
    const [sample] = await ctl.sampleAt(11.5);
    // at-or-before 0.5s local: frame 11 (458337us); frame 12 (500004us) is past it.
    expect((sample!.source as unknown as FakeFrame).timestamp).toBe(11 * FRAME_US);
    expect(FakeDecoder.instances[1]!.configured).toBe(BASE_CONFIG);
    expect(ctl.snapshotFindings()).toEqual([]);
    await ctl.dispose();
  });

  it('(5) the main-timeline decoder is never downgraded by the spot path', async () => {
    const main = await openMainTimelineDecoder();
    behaviour.stallHardware = true;
    const ctl = new SpotPlaybackController([SPOT_ASSET], [SPEC], {
      preferSoftwareWhenContended: false,
      stallBoundMs: STALL_BOUND_MS,
    });
    const pending = ctl.sampleAt(11);
    await vi.advanceTimersByTimeAsync(STALL_BOUND_MS + 50);
    await pending;

    const mainDecoder = FakeDecoder.instances[0]!;
    expect(mainDecoder.configured).toBe(BASE_CONFIG);
    expect(mainDecoder.closed).toBe(false);
    expect(FakeDecoder.instances.filter((d) => d.configured?.hardwareAcceleration === 'prefer-software')).toHaveLength(1);
    expect(FakeDecoder.instances.indexOf(mainDecoder)).toBe(0);
    await ctl.dispose();
    await main.return(undefined);
  });
});
