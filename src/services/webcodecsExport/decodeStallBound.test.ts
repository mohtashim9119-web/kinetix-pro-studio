/**
 * No unbounded decode wait: a decoder that goes silent fails within
 * DECODE_STALL_BOUND_MS with a TYPED error naming the segment index and the
 * asset id and how long it waited — never the generic 30 s watchdog.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

vi.mock('../videoDemuxer', async () => {
  const actual = await vi.importActual<typeof import('../videoDemuxer')>('../videoDemuxer');
  return { ...actual, getOrCreateDemux: vi.fn(), demuxCacheHas: vi.fn(() => true) };
});

import { getOrCreateDemux } from '../videoDemuxer';
import {
  decodeSegmentFrames,
  resetDecodeResourceCounts,
  DECODE_STALL_BOUND_MS,
  DecodeStallError,
  wakeParkedDecodes,
} from './sequentialDecode';
import { SpotPlaybackController } from './spotPlayback';
import { DecodeStalledFailure, decodeStallFailureFrom, decodeStallVia } from './decodeStall';
import { FAILURE_VIA_TO_KIND } from './exportWorkerDiagnostics';
import { WATCHDOG_MS } from './exportPipelineWebCodecs';
import { isNeverResumeKind } from '../exportFailure/exportFailureCopy';
import {
  STALL_BOUND_MS,
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

const WORKER_SRC = readFileSync(resolve(__dirname, 'exportWorker.ts'), 'utf8');

describe('decode stall bound — the value', () => {
  it('is 4000 ms: ~96 frame times at 24 fps, and two spot attempts land well inside the 30 s watchdog', () => {
    expect(DECODE_STALL_BOUND_MS).toBe(STALL_BOUND_MS);
    expect(DECODE_STALL_BOUND_MS / (1000 / 24)).toBeGreaterThan(90);
    expect(2 * DECODE_STALL_BOUND_MS).toBeLessThan(WATCHDOG_MS / 3);
  });
});

describe('decode stall bound — (1) a spot decode that never yields fails typed, inside the bound', () => {
  it('names segment index and asset id and how long it waited — not the watchdog, not after 30 s', async () => {
    behaviour.stallHardware = true;
    behaviour.stallSoftware = true;
    const ctl = new SpotPlaybackController([SPOT_ASSET], [SPEC], {
      preferSoftwareWhenContended: false,
      stallBoundMs: DECODE_STALL_BOUND_MS,
    });
    const started = Date.now();
    const settled = ctl.sampleAt(11).then(
      () => null,
      (e: unknown) => e,
    );
    await vi.advanceTimersByTimeAsync(2 * DECODE_STALL_BOUND_MS + 100);
    const raw = await settled;
    expect(Date.now() - started).toBeLessThan(WATCHDOG_MS);

    const failure = decodeStallFailureFrom(raw, { layer: 'spot', segmentIndex: 7, assetId: null, openDecoders: 1 });
    expect(failure).toBeInstanceOf(DecodeStalledFailure);
    expect(failure!.segmentIndex).toBe(7);
    expect(failure!.assetId).toBe('avatar-02');
    expect(failure!.waitedMs).toBeGreaterThanOrEqual(DECODE_STALL_BOUND_MS);
    expect(failure!.message).toContain('spot_decode_stalled');
    expect(failure!.message).toContain('segment 7');
    expect(failure!.message).toContain('"avatar-02"');
    expect(decodeStallVia(failure!)).toBe('spot-decode-stalled');
    await ctl.dispose();
  });

  it('a main-timeline segment decode that goes silent fails typed too (segment layer)', async () => {
    behaviour.stallHardware = true;
    const gen = decodeSegmentFrames(MAIN_URL, 0, 3, { stallBoundMs: DECODE_STALL_BOUND_MS });
    const settled = gen.next().then(
      () => null,
      (e: unknown) => e,
    );
    await vi.advanceTimersByTimeAsync(DECODE_STALL_BOUND_MS + 50);
    const raw = await settled;
    expect(raw).toBeInstanceOf(DecodeStallError);
    expect(FakeDecoder.instances[0]!.closed).toBe(true);
    const failure = decodeStallFailureFrom(raw, { layer: 'segment', segmentIndex: 3, assetId: 'main', openDecoders: 1 });
    expect(failure!.message).toContain('segment_decode_stalled');
    expect(failure!.message).toContain('segment 3');
    expect(decodeStallVia(failure!)).toBe('decode-stalled');
  });

  it('closing a cursor on a silent decoder does not hang (the cleanup await is bounded too)', async () => {
    behaviour.stallHardware = true;
    const gen = decodeSegmentFrames(MAIN_URL, 0, 3, { stallBoundMs: DECODE_STALL_BOUND_MS });
    const first = gen.next().catch(() => null);
    await vi.advanceTimersByTimeAsync(10);
    // Early termination while the decoder owes output and flush is pending.
    const closing = gen.return(undefined);
    await vi.advanceTimersByTimeAsync(DECODE_STALL_BOUND_MS + 50);
    await closing;
    await first;
    expect(FakeDecoder.instances[0]!.closed).toBe(true);
  });

  it('the worker wires the typed failure: cursor + spot decodes are bounded and mapped to their own vias', () => {
    expect(WORKER_SRC).toMatch(/stallBoundMs:\s*DECODE_STALL_BOUND_MS/);
    expect(WORKER_SRC).toMatch(/decodeStallFailureFrom\(e, \{\s*layer: 'spot'/);
    expect(WORKER_SRC).toMatch(/decodeStallFailureFrom\(e, \{\s*layer: 'segment'/);
    expect(WORKER_SRC).toContain('decodeStallVia(');
    expect(WORKER_SRC).toContain('wakeParkedDecodes()');
  });
});

describe('decode stall bound — pins', () => {
  it('(2) a healthy spot decodes unchanged under the bound (no failure, no findings)', async () => {
    const ctl = new SpotPlaybackController([SPOT_ASSET], [SPEC], {
      preferSoftwareWhenContended: false,
      stallBoundMs: DECODE_STALL_BOUND_MS,
    });
    for (let t = 11; t < 14.5; t += 1 / 24) {
      const samples = await ctl.sampleAt(t);
      expect(samples).toHaveLength(1);
    }
    expect(ctl.snapshotFindings()).toEqual([]);
    expect(FakeDecoder.instances).toHaveLength(1);
    expect(FakeDecoder.instances[0]!.configured).toBe(BASE_CONFIG);
    await ctl.dispose();
  });

  it('(3) the generic watchdog is untouched as the outer backstop (no spot involved)', () => {
    expect(WATCHDOG_MS).toBe(30_000);
    expect(FAILURE_VIA_TO_KIND.watchdog).toBe('encode');
  });

  it('(4) a cancelled run cancels promptly and is not reported as a decode stall', async () => {
    behaviour.stallHardware = true;
    let cancelled = false;
    const gen = decodeSegmentFrames(MAIN_URL, 0, 3, {
      stallBoundMs: DECODE_STALL_BOUND_MS,
      isCancelled: () => cancelled,
    });
    const settled = gen.next().then(
      (r) => ({ ok: true as const, r }),
      (e: unknown) => ({ ok: false as const, e }),
    );
    await vi.advanceTimersByTimeAsync(100);
    cancelled = true;
    wakeParkedDecodes();
    await vi.advanceTimersByTimeAsync(1);
    const out = await settled;
    expect(out.ok).toBe(true);
    if (out.ok) expect(out.r.done).toBe(true);
    expect(FakeDecoder.instances[0]!.closed).toBe(true);
  });

  it('(5) the bounded failure takes the ordinary encode-failure path: session retained, resume offered', () => {
    expect(FAILURE_VIA_TO_KIND['spot-decode-stalled']).toBe('encode');
    expect(FAILURE_VIA_TO_KIND['decode-stalled']).toBe('encode');
    expect(isNeverResumeKind('encode')).toBe(false);
  });
});
