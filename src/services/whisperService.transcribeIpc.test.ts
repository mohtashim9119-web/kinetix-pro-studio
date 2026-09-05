/**
 * The IPC contract between `transcribeWithProgress` and whisper.rs's
 * single-flight registry.
 *
 * WHY THIS FILE EXISTS. The registry keys running jobs by `job_key` and refuses
 * a second job for a key it already holds, and it exposes
 * `whisper_transcribe_attach` so a reloaded page can re-point a surviving job's
 * events at its own channel. Both halves are invisible to every other fixture:
 * the frontend can omit `jobKey` entirely (the parameter is `Option<String>`,
 * so an un-updated caller still compiles AND still runs) and can never call
 * attach at all, and nothing goes red — the shipped defect was exactly that
 * pair, and it surfaced only as a `whisper:already-running:` banner after a
 * Cmd+R during transcription.
 *
 * These tests assert the CALL SHAPE rather than any timing behaviour, because
 * the call shape is the whole contract: which command, with which key, in which
 * order, and — for an attach hit — which commands must NOT be invoked.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Asset } from '../types';

interface WhisperEventMsg {
  event: 'Progress' | 'Done' | 'Error';
  data: Record<string, unknown>;
}

/** Stand-in for Tauri's `Channel`: the native side "emits" by calling this. */
class FakeChannel {
  onmessage: ((msg: WhisperEventMsg) => void) | null = null;
}

const invokeMock = vi.fn();

vi.mock('@tauri-apps/api/core', () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
  Channel: FakeChannel,
}));

const { transcribeWithProgress } = await import('./whisperService');

const AUDIO_BYTES = 'fake-audio-bytes';
/** Opaque to the code under test — it forwards this string to
 *  `whisper_transcribe` and never touches the filesystem. Deliberately not a
 *  real staging path: the K8 tripwire (`scripts/no-tmp-artifacts.test.ts`)
 *  bans the literal in test code, and nothing here needs one. */
const STAGED_AUDIO_PATH = 'staged://kinetix-whisper-x/input.mp3';
const audioAsset = (): Asset => ({
  id: 'voiceover-1',
  name: 'voiceover.mp3',
  url: 'blob:http://tauri.localhost/0',
  type: 'audio',
  file: new File([AUDIO_BYTES], 'voiceover.mp3', { type: 'audio/mpeg' }),
});

/** The command names invoked, in order. */
const invokedCommands = (): string[] => invokeMock.mock.calls.map(c => c[0] as string);

const argsFor = (command: string): Record<string, unknown> | undefined =>
  invokeMock.mock.calls.find(c => c[0] === command)?.[1] as Record<string, unknown> | undefined;

const run = (jobKey?: string): Promise<unknown> =>
  transcribeWithProgress(
    audioAsset(),
    12,
    'en',
    () => {},
    new AbortController().signal,
    jobKey,
  );

describe('transcribeWithProgress — native single-flight IPC contract', () => {
  beforeEach(() => {
    invokeMock.mockReset();
  });

  it('files the job under the caller-supplied key, so the native gate can refuse a duplicate', async () => {
    invokeMock.mockImplementation(async (command: string, args: Record<string, unknown>) => {
      if (command === 'whisper_transcribe_attach') return false;
      if (command === 'whisper_stage_audio_raw') return STAGED_AUDIO_PATH;
      if (command === 'whisper_transcribe') {
        (args.onEvent as FakeChannel).onmessage?.({
          event: 'Done',
          data: { tokens: [], detectedLanguage: undefined },
        });
      }
      return undefined;
    });

    await run('project-7::voiceover.mp3|17|1700000000000');

    // The defect this pins: `whisper_transcribe` was invoked with no jobKey at
    // all, collapsing every job in the app onto whisper.rs's DEFAULT_JOB_KEY.
    expect(argsFor('whisper_transcribe')?.jobKey).toBe('project-7::voiceover.mp3|17|1700000000000');
  });

  it('attaches to a job that survived the reload instead of starting a second one', async () => {
    invokeMock.mockImplementation(async (command: string, args: Record<string, unknown>) => {
      if (command === 'whisper_transcribe_attach') {
        // A job for this key is still running; its events now come here.
        queueMicrotask(() => {
          (args.onEvent as FakeChannel).onmessage?.({
            event: 'Done',
            data: { tokens: [{ startSec: 0, endSec: 1, text: 'hi' }], detectedLanguage: 'en' },
          });
        });
        return true;
      }
      return undefined;
    });

    const result = await run('project-7::voiceover.mp3|17|1700000000000');

    // Settles from the ATTACHED job's own terminal event...
    expect(result).toEqual({
      tokens: [{ startSec: 0, endSec: 1, text: 'hi' }],
      detectedLanguage: 'en',
    });
    // ...and starts nothing: a second `whisper_transcribe` is what the native
    // registry refuses, and re-staging would rewrite the audio for no reason.
    expect(invokedCommands()).toEqual(['whisper_transcribe_attach']);
  });

  it('starts normally when nothing is in flight, probing attach before staging audio', async () => {
    invokeMock.mockImplementation(async (command: string, args: Record<string, unknown>) => {
      if (command === 'whisper_transcribe_attach') return false;
      if (command === 'whisper_stage_audio_raw') return STAGED_AUDIO_PATH;
      if (command === 'whisper_transcribe') {
        (args.onEvent as FakeChannel).onmessage?.({
          event: 'Done',
          data: { tokens: [], detectedLanguage: undefined },
        });
      }
      return undefined;
    });

    await run('project-7::voiceover.mp3|17|1700000000000');

    // Order matters: staging writes the whole voiceover to a temp dir, and an
    // attach hit must not pay that cost (nor leak the directory, which only
    // whisper_transcribe cleans up).
    expect(invokedCommands()).toEqual([
      'whisper_transcribe_attach',
      'whisper_stage_audio_raw',
      'whisper_transcribe',
    ]);
  });

  it('gives the attach probe its own channel, never the one the start path streams through', async () => {
    invokeMock.mockImplementation(async (command: string, args: Record<string, unknown>) => {
      if (command === 'whisper_transcribe_attach') return false;
      if (command === 'whisper_stage_audio_raw') return STAGED_AUDIO_PATH;
      if (command === 'whisper_transcribe') {
        (args.onEvent as FakeChannel).onmessage?.({
          event: 'Done',
          data: { tokens: [], detectedLanguage: undefined },
        });
      }
      return undefined;
    });

    await run('project-7::voiceover.mp3|17|1700000000000');

    // A `Channel` handed to a command is deserialized Rust-side, and DROPPING
    // that Rust-side channel evals an `{ end: true }` marker back here, which
    // makes the JS Channel unregister its own callback for good. Reusing one
    // channel across both invokes therefore hands `whisper_transcribe` a
    // channel the refused probe already killed: every event is dropped in
    // silence and the run hangs at 0% with no error. Distinct objects is the
    // property that prevents it.
    const probeChannel = argsFor('whisper_transcribe_attach')?.onEvent;
    const startChannel = argsFor('whisper_transcribe')?.onEvent;
    expect(probeChannel).toBeInstanceOf(FakeChannel);
    expect(startChannel).toBeInstanceOf(FakeChannel);
    expect(startChannel).not.toBe(probeChannel);
  });

  it('cancels by key, so one job\'s cancel cannot kill another project\'s run', async () => {
    const controller = new AbortController();
    invokeMock.mockImplementation(async (command: string) => {
      if (command === 'whisper_transcribe_attach') return false;
      if (command === 'whisper_stage_audio_raw') return STAGED_AUDIO_PATH;
      // whisper_transcribe never settles — the run is aborted mid-flight.
      if (command === 'whisper_transcribe') return new Promise(() => {});
      return undefined;
    });

    const pending = transcribeWithProgress(
      audioAsset(),
      12,
      'en',
      () => {},
      controller.signal,
      'project-7::voiceover.mp3|17|1700000000000',
    );
    await vi.waitFor(() => expect(invokedCommands()).toContain('whisper_transcribe'));
    controller.abort();

    await expect(pending).rejects.toThrow(/abort/i);
    expect(argsFor('whisper_cancel')?.jobKey).toBe('project-7::voiceover.mp3|17|1700000000000');
  });

  it('omits the key entirely when the caller has no project identity, leaving native behaviour unchanged', async () => {
    invokeMock.mockImplementation(async (command: string, args: Record<string, unknown>) => {
      if (command === 'whisper_stage_audio_raw') return STAGED_AUDIO_PATH;
      if (command === 'whisper_transcribe') {
        (args.onEvent as FakeChannel).onmessage?.({
          event: 'Done',
          data: { tokens: [], detectedLanguage: undefined },
        });
      }
      return undefined;
    });

    await run(undefined);

    // No key means no identity to attach BY — probing would risk adopting a
    // job started for different audio, so the probe is skipped outright.
    expect(invokedCommands()).toEqual(['whisper_stage_audio_raw', 'whisper_transcribe']);
    expect(argsFor('whisper_transcribe')?.jobKey).toBeUndefined();
  });
});
