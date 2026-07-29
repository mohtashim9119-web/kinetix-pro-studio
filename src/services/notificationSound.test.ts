import { describe, it, expect, vi, afterEach } from 'vitest';
import { playExportCompleteChime, __resetNotificationSoundForTests } from './notificationSound';

class FakeBufferSourceNode {
  buffer: unknown = null;
  connect = vi.fn();
  start = vi.fn();
}

interface FakeAudioContextOptions {
  resumeRejects?: boolean;
}

function installFakeAudioContext(opts: FakeAudioContextOptions = {}) {
  const resume = opts.resumeRejects
    ? vi.fn(() => Promise.reject(new Error('no user gesture')))
    : vi.fn(() => Promise.resolve());
  const decodeAudioData = vi.fn(async () => ({}) as AudioBuffer);
  const createBufferSource = vi.fn(() => new FakeBufferSourceNode());
  const ctx = { resume, decodeAudioData, createBufferSource, destination: {} };
  const Ctor = vi.fn(function (this: unknown) {
    return ctx;
  }) as unknown as typeof AudioContext;
  vi.stubGlobal('AudioContext', Ctor);
  return { ctx, Ctor };
}

function installFetch(succeeds = true) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => {
      if (!succeeds) throw new Error('network error');
      return { arrayBuffer: async () => new ArrayBuffer(8) };
    }),
  );
}

describe('playExportCompleteChime', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    __resetNotificationSoundForTests();
  });

  it('resumes the context, decodes the chime, and starts playback', async () => {
    const { ctx } = installFakeAudioContext();
    installFetch();

    await playExportCompleteChime();

    expect(ctx.resume).toHaveBeenCalledTimes(1);
    expect(ctx.decodeAudioData).toHaveBeenCalledTimes(1);
    expect(ctx.createBufferSource).toHaveBeenCalledTimes(1);
  });

  it('reuses the same AudioContext across repeated calls (singleton)', async () => {
    const { Ctor } = installFakeAudioContext();
    installFetch();

    await playExportCompleteChime();
    await playExportCompleteChime();

    expect(Ctor).toHaveBeenCalledTimes(1);
  });

  it('does not throw when no AudioContext constructor is available', async () => {
    vi.stubGlobal('AudioContext', undefined);
    vi.stubGlobal('webkitAudioContext', undefined);

    await expect(playExportCompleteChime()).resolves.toBeUndefined();
  });

  it('does not throw when resume() rejects (blocked autoplay)', async () => {
    installFakeAudioContext({ resumeRejects: true });
    installFetch();

    await expect(playExportCompleteChime()).resolves.toBeUndefined();
  });

  it('does not throw when fetch/decode fails', async () => {
    installFakeAudioContext();
    installFetch(false);

    await expect(playExportCompleteChime()).resolves.toBeUndefined();
  });
});
