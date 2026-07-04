import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// mp4box's real onSamples/onReady/appendBuffer(...) flow is driven manually in
// each test via the mock file object returned by createFile() — this lets us
// assert the exact sequencing the Phase 0 spike found matters
// (setExtractionOptions()/start() from inside onReady, never a flush() call)
// without needing a real MP4 file or a real mp4box parse.
//
// Each test grabs ITS OWN mock file via createFileMock.mock.results (rather
// than a single shared "latest" variable) — a getOrCreateDemux() call's own
// createFile() invocation is gated behind an async fetch()/arrayBuffer()
// await, so a shared "last created file" variable can still be pointing at
// the PREVIOUS test's object for a few microtask ticks after a new call
// starts, silently corrupting the test instead of failing loudly.
const avcCBox = { write: vi.fn() };

function makeMockMp4BoxFile() {
  return {
    onError: undefined as ((module: string, msg: string) => void) | undefined,
    onSamples: undefined as ((id: number, user: unknown, samples: unknown[]) => void) | undefined,
    onReady: undefined as ((info: unknown) => void) | undefined,
    setExtractionOptions: vi.fn(),
    start: vi.fn(),
    appendBuffer: vi.fn(),
    getTrackById: vi.fn(() => ({
      mdia: { minf: { stbl: { stsd: { entries: [{ avcC: avcCBox }] } } } },
    })),
  };
}
type MockMp4BoxFile = ReturnType<typeof makeMockMp4BoxFile>;

vi.mock('mp4box', () => ({
  createFile: vi.fn((_keepMdatData: boolean) => makeMockMp4BoxFile()),
  MP4BoxBuffer: { fromArrayBuffer: (buf: ArrayBuffer) => buf },
  DataStream: class {
    buffer = new ArrayBuffer(16);
  },
  Endianness: { BIG_ENDIAN: 0 },
}));

import { getOrCreateDemux, clearDemuxCache } from './videoDemuxer';
import { createFile } from 'mp4box';
const createFileMock = createFile as unknown as ReturnType<typeof vi.fn>;

/** Waits for this test's own createFile() call (mockClear()'d in beforeEach,
 *  so call #0 after that point is unambiguously this test's) and returns the
 *  mock mp4box file object it produced. */
async function awaitOwnMockFile(): Promise<MockMp4BoxFile> {
  await vi.waitFor(() => expect(createFileMock).toHaveBeenCalledTimes(1));
  return createFileMock.mock.results[0]!.value as MockMp4BoxFile;
}

function makeSample(overrides: Partial<{ cts: number; timescale: number; duration: number; is_sync: boolean; data: Uint8Array }> = {}) {
  return {
    cts: 0,
    timescale: 1000,
    duration: 33,
    is_sync: true,
    data: new Uint8Array([1, 2, 3]),
    ...overrides,
  };
}

function makeVideoTrack(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    codec: 'avc1.640020',
    nb_samples: 2,
    duration: 2000,
    timescale: 1000,
    video: { width: 1280, height: 720 },
    ...overrides,
  };
}

class MockEncodedVideoChunk {
  type: string;
  timestamp: number;
  duration: number;
  data: Uint8Array;
  constructor(init: { type: string; timestamp: number; duration: number; data: Uint8Array }) {
    this.type = init.type;
    this.timestamp = init.timestamp;
    this.duration = init.duration;
    this.data = init.data;
  }
}

beforeEach(() => {
  clearDemuxCache();
  createFileMock.mockClear();
  avcCBox.write.mockClear();
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(8) })),
  );
  vi.stubGlobal('EncodedVideoChunk', MockEncodedVideoChunk);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('getOrCreateDemux', () => {
  it('calls createFile(true) — keepMdatData for whole-file demux (Phase 0 fix b)', async () => {
    void getOrCreateDemux('blob:keepmdat');
    await awaitOwnMockFile();
    expect(createFileMock).toHaveBeenCalledWith(true);
  });

  it('calls setExtractionOptions()/start() from inside onReady and demuxes samples into chunks (Phase 0 fix a)', async () => {
    const promise = getOrCreateDemux('blob:v1');
    const mockFile = await awaitOwnMockFile();
    await vi.waitFor(() => expect(mockFile.appendBuffer).toHaveBeenCalled());

    const track = makeVideoTrack();
    mockFile.onReady!({ videoTracks: [track] });

    expect(mockFile.setExtractionOptions).toHaveBeenCalledWith(track.id, null, { nbSamples: track.nb_samples });
    expect(mockFile.start).toHaveBeenCalled();
    // The mock mp4box file deliberately has no `flush` method — if demux()
    // ever called mp4boxFile.flush() (the exact regression the Phase 0 spike
    // found and fixed), the onReady call above would have thrown synchronously.

    mockFile.onSamples!(track.id, null, [
      makeSample({ cts: 0, is_sync: true }),
      makeSample({ cts: 33, is_sync: false }),
    ]);

    const result = await promise;
    expect(result.chunks).toHaveLength(2);
    expect(result.chunks[0]).toBeInstanceOf(MockEncodedVideoChunk);
    expect(result.config.codec).toBe('avc1.640020');
    expect(result.config.codedWidth).toBe(1280);
    expect(result.config.codedHeight).toBe(720);
    expect(result.durationSec).toBe(2); // duration 2000 / timescale 1000
  });

  it('caches the demux per URL — a second call for the same URL does not re-fetch', async () => {
    const p1 = getOrCreateDemux('blob:cached');
    const mockFile = await awaitOwnMockFile();
    await vi.waitFor(() => expect(mockFile.appendBuffer).toHaveBeenCalled());
    mockFile.onReady!({ videoTracks: [makeVideoTrack({ nb_samples: 1 })] });
    mockFile.onSamples!(1, null, [makeSample()]);
    await p1;

    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockClear();
    createFileMock.mockClear();

    const result2 = await getOrCreateDemux('blob:cached');
    expect(fetchMock).not.toHaveBeenCalled();
    expect(createFileMock).not.toHaveBeenCalled();
    expect(result2.chunks).toHaveLength(1);
  });

  it('rejects (and does not poison the cache) when no video track is found', async () => {
    const promise = getOrCreateDemux('blob:no-track');
    const mockFile = await awaitOwnMockFile();
    await vi.waitFor(() => expect(mockFile.appendBuffer).toHaveBeenCalled());
    mockFile.onReady!({ videoTracks: [] });
    await expect(promise).rejects.toThrow(/no video track/);

    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockClear();
    createFileMock.mockClear();
    void getOrCreateDemux('blob:no-track');
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled());
    await awaitOwnMockFile(); // a fresh createFile() call proves the URL wasn't poisoned
  });
});
