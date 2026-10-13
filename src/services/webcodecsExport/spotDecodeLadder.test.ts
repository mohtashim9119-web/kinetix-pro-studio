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

vi.mock('../videoDemuxer', async () => {
  const actual = await vi.importActual<typeof import('../videoDemuxer')>('../videoDemuxer');
  return { ...actual, getOrCreateDemux: vi.fn(), demuxCacheHas: vi.fn(() => true) };
});

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

import {
  FRAME_US,
  STALL_BOUND_MS,
  type FakeFrame,
  behaviour,
  FakeDecoder,
  BASE_CONFIG,
  chunks,
  SPOT_ASSET,
  MAIN_URL,
  SPEC,
  resetFakeDecoders,
} from './fakeVideoDecoder.testUtil';

beforeEach(() => {
  vi.useFakeTimers();
  resetFakeDecoders();
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
