/**
 * Diagnostics that prove the Windows spot-decode stall in one line: every
 * decoder creation names engine, hardwareAcceleration, codec, coded vs
 * visible size and the concurrent open-decoder count; a bounded stall names
 * segment, asset, the await, the wait and the open count; and a counter
 * separates "stuck before the decoder was created" from "stuck inside it".
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

vi.mock('../videoDemuxer', async () => {
  const actual = await vi.importActual<typeof import('../videoDemuxer')>('../videoDemuxer');
  return {
    ...actual,
    getOrCreateDemux: vi.fn(),
    demuxCacheHas: vi.fn(() => true),
  };
});

import { getOrCreateDemux, DemuxStallError } from '../videoDemuxer';
import {
  decodeSegmentFrames,
  resetDecodeResourceCounts,
  DECODE_STALL_BOUND_MS,
  decodeDiagnostics,
  resetDecodeDiagnostics,
  setDecoderEventListener,
  decoderEngine,
} from './sequentialDecode';
import { SpotPlaybackController } from './spotPlayback';
import { decodeStallFailureFrom, recordDecodeStall } from './decodeStall';
import {
  behaviour,
  FakeDecoder,
  BASE_CONFIG,
  chunks,
  SPOT_ASSET,
  MAIN_URL,
  SPEC,
  resetFakeDecoders,
} from './fakeVideoDecoder.testUtil';

const WIN_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36 Edg/129.0.0.0';
const MAC_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko)';

const WORKER_SRC = readFileSync(resolve(__dirname, 'exportWorker.ts'), 'utf8');

let lines: string[] = [];

beforeEach(() => {
  vi.useFakeTimers();
  resetFakeDecoders();
  resetDecodeResourceCounts();
  resetDecodeDiagnostics();
  lines = [];
  setDecoderEventListener((line) => lines.push(line));
  vi.stubGlobal('VideoDecoder', FakeDecoder);
  vi.mocked(getOrCreateDemux).mockImplementation(async () => ({
    config: BASE_CONFIG,
    chunks: chunks(84),
    durationSec: 3.5,
  }));
});

afterEach(() => {
  setDecoderEventListener(null);
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('decoder creation line', () => {
  it('names engine, hardwareAcceleration, codec, config size and the concurrent open count', async () => {
    const main = decodeSegmentFrames(MAIN_URL, 0, 3);
    (await main.next()).value?.close();
    const spot = decodeSegmentFrames(SPOT_ASSET.url, 0, 3, { hardwareAcceleration: 'prefer-software' });
    (await spot.next()).value?.close();

    const opens = lines.filter((l) => l.startsWith('decoder_open '));
    expect(opens).toHaveLength(2);
    expect(opens[0]).toMatch(/engine=\S+/);
    expect(opens[0]).toContain('hardwareAcceleration=default');
    expect(opens[0]).toContain('codec=avc1.640020');
    expect(opens[0]).toContain('config=1440x816');
    expect(opens[0]).toContain('openDecoders=1');
    expect(opens[0]).toContain(`asset=${MAIN_URL}`);
    expect(opens[1]).toContain('hardwareAcceleration=prefer-software');
    expect(opens[1]).toContain('openDecoders=2');
    expect(opens[1]).toContain('nonSoftwareOpen=1');

    const first = lines.filter((l) => l.startsWith('decoder_first_frame '));
    expect(first[0]).toContain('coded=');
    expect(first[0]).toContain('visible=1440x810');
    await main.return(undefined);
    await spot.return(undefined);
  });

  it('classifies the engine from the user agent', () => {
    expect(decoderEngine(WIN_UA)).toBe('webview2');
    expect(decoderEngine(MAC_UA)).toBe('wkwebview');
    expect(decoderEngine(undefined)).toBe('unknown');
  });
});

describe('bounded stall line and counters', () => {
  it('a bounded spot stall emits one naming row and counts "inside the decoder"', async () => {
    behaviour.stallHardware = true;
    behaviour.stallSoftware = true;
    const ctl = new SpotPlaybackController([SPOT_ASSET], [SPEC], {
      preferSoftwareWhenContended: false,
      stallBoundMs: DECODE_STALL_BOUND_MS,
    });
    const settled = ctl.sampleAt(11).then(
      () => null,
      (e: unknown) => e,
    );
    await vi.advanceTimersByTimeAsync(2 * DECODE_STALL_BOUND_MS + 100);
    const failure = decodeStallFailureFrom(await settled, {
      layer: 'spot',
      segmentIndex: 7,
      assetId: null,
      openDecoders: 0,
    })!;
    recordDecodeStall(failure);

    const stallLines = lines.filter((l) => l.startsWith('spot_decode_stalled'));
    expect(stallLines).toHaveLength(1);
    expect(stallLines[0]).toContain('segment 7');
    expect(stallLines[0]).toContain('"avatar-02"');
    expect(stallLines[0]).toMatch(/decoder-(output|flush)/);
    expect(stallLines[0]).toMatch(/produced no frame for \d+ms/);
    expect(stallLines[0]).toContain('open decoders:');

    const d = decodeDiagnostics();
    expect(d.stallsInsideDecoder).toBe(1);
    expect(d.stallsBeforeDecoder).toBe(0);
    expect(d.lastStall).toContain('spot_decode_stalled');
    expect(d.events.some((l) => l.startsWith('spot_decode_stalled'))).toBe(true);
    await ctl.dispose();
  });

  it('a demux that never finishes counts as "stuck before the decoder was created"', async () => {
    vi.mocked(getOrCreateDemux).mockRejectedValueOnce(new DemuxStallError(SPOT_ASSET.url, 2, 84, 10_000));
    const gen = decodeSegmentFrames(SPOT_ASSET.url, 0, 3, { stallBoundMs: DECODE_STALL_BOUND_MS });
    await expect(gen.next()).rejects.toThrow(/demux failed/);
    const d = decodeDiagnostics();
    expect(d.stallsBeforeDecoder).toBe(1);
    expect(d.stallsInsideDecoder).toBe(0);
    expect(lines.some((l) => l.startsWith('decode_stalled_before_decoder') && l.includes(SPOT_ASSET.url))).toBe(true);
  });

  it('a live snapshot says where a parked decode is: awaiting demux vs parked on a decoder', async () => {
    behaviour.stallHardware = true;
    const gen = decodeSegmentFrames(MAIN_URL, 0, 3, { stallBoundMs: DECODE_STALL_BOUND_MS });
    const pending = gen.next().catch(() => null);
    await vi.advanceTimersByTimeAsync(10);
    expect(decodeDiagnostics().parkedOnDecoder).toBe(1);
    expect(decodeDiagnostics().awaitingDemux).toBe(0);
    await vi.advanceTimersByTimeAsync(DECODE_STALL_BOUND_MS + 50);
    await pending;
    expect(decodeDiagnostics().parkedOnDecoder).toBe(0);
  });

  it('(pin) a clean run emits no stall line and leaves every stall counter at zero', async () => {
    const ctl = new SpotPlaybackController([SPOT_ASSET], [SPEC], {
      preferSoftwareWhenContended: false,
      stallBoundMs: DECODE_STALL_BOUND_MS,
    });
    for (let t = 11; t < 14.5; t += 1 / 24) await ctl.sampleAt(t);
    await ctl.dispose();
    expect(lines.some((l) => l.includes('stalled'))).toBe(false);
    const d = decodeDiagnostics();
    expect(d.stallsInsideDecoder).toBe(0);
    expect(d.stallsBeforeDecoder).toBe(0);
    expect(d.lastStall).toBeNull();
  });
});

describe('worker wiring', () => {
  it('routes decoder lines to the main thread, records the stall, and names segment + asset on the phase row', () => {
    expect(WORKER_SRC).toContain("setDecoderEventListener((line) => postOut({ type: 'decoder-event', line }))");
    expect(WORKER_SRC).toContain('recordDecodeStall(stall)');
    expect(WORKER_SRC).toMatch(/setContext\(stall\.segmentIndex, stall\.assetId\)/);
    expect(WORKER_SRC).toContain("enter('spot-decode-stalled')");
    expect(WORKER_SRC).toContain('decodeDiagnostics()');
  });
});
