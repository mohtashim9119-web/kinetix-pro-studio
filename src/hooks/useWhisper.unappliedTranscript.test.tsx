// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// ---------------------------------------------------------------------------
// WS2 T4.7 Requirements 3 + 4, at the hook.
//
// Two things happen at 100% that nothing downstream can compensate for if they
// are missing, so they are asserted here rather than through App.tsx:
//
//   • The `unappliedTranscript` record is written in the SAME project update
//     as the tokens, BEFORE anything resembling an Apply Sync runs. "Before
//     apply" is not a timing claim to be inspected afterwards — by the time an
//     Apply Sync has run there is nothing left to observe — so it is asserted
//     as: the completion update carries the record, and the completion
//     callback fires with it already present.
//
//   • The flush hook (`onCompleted`) runs after that update and before the
//     terminal 'done' status, so "done" on screen means "on disk", not "in a
//     React state update racing a reload."
//
// Requirement 4's refusal is asserted for what it must NOT do as much as what
// it returns: a refused duplicate must not abort the running job, must not
// advance the generation counter, and must not touch `transcriptionStatus` —
// a refusal that blanked the live progress bar would be indistinguishable, to
// the user, from the failure of the run it was protecting.
//
// The hook is driven through `createRoot` + `act` (the repo's own pattern —
// there is no @testing-library/react here). whisper-cli and silence detection
// are IPC and are mocked; nothing else is.
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';
import { TransitionType, AnimationType, type Asset, type Project, type TranscriptToken, type TranscriptionStatus } from '../types';
import type { StartTranscriptionOutcome, UseWhisperApi } from './useWhisper';

const mockTranscribe = vi.fn();

vi.mock('../services/whisperService', async () => {
  const actual = await vi.importActual<typeof import('../services/whisperService')>('../services/whisperService');
  return {
    ...actual,
    transcribeWithProgress: (...args: unknown[]) => mockTranscribe(...args),
  };
});

vi.mock('../services/silenceDetector', () => ({
  detectSilences: vi.fn(async () => ({ status: 'ok' as const, silences: [] })),
}));

const { useWhisper } = await import('./useWhisper');

const TOKENS: TranscriptToken[] = [
  { text: 'hello', startSec: 0, endSec: 0.4 },
  { text: 'world', startSec: 0.5, endSec: 0.9 },
];

function audioAsset(withFile = true): Asset {
  const file = new File(['bytes'], 'vo.mp3', { type: 'audio/mpeg', lastModified: 1_700_000_000_000 });
  return {
    id: 'staged-asset-1',
    name: 'vo.mp3',
    url: 'blob:http://localhost/vo',
    type: 'audio',
    addedAt: 0,
    ...(withFile ? { file } : {}),
  };
}

function project(over: Partial<Project> = {}): Project {
  return {
    id: 'project-1',
    name: 'Test',
    script: '',
    sceneDetails: '',
    segments: [],
    assets: [],
    globalTransition: TransitionType.NONE,
    globalTransitionDuration: 0.5,
    globalAnimation: AnimationType.NONE,
    globalOverlayConfig: { color: '#fff', backgroundColor: '#000', fontFamily: 'sans-serif' },
    ...over,
  };
}

/** Mounts `useWhisper` and hands back a live handle plus the latest status. */
function mountWhisper(): { api: () => UseWhisperApi; status: () => TranscriptionStatus; unmount: () => void } {
  let latest: UseWhisperApi | null = null;
  let latestStatus: TranscriptionStatus = { phase: 'idle' };
  const container = document.createElement('div');
  document.body.appendChild(container);
  let root: Root;

  function Probe(): null {
    const api = useWhisper();
    latest = api;
    latestStatus = api.transcriptionStatus;
    return null;
  }

  act(() => {
    root = createRoot(container);
    root.render(<Probe />);
  });

  return {
    api: () => {
      if (!latest) throw new Error('hook never rendered');
      return latest;
    },
    status: () => latestStatus,
    unmount: () => {
      act(() => root.unmount());
      container.remove();
    },
  };
}

beforeEach(() => {
  // React's `act` refuses to flush unless the environment opts in. Set here
  // rather than globally so this file's act(...) calls are quiet without
  // changing the behaviour of every other test in the repo.
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.clearAllMocks();
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('Requirement 3 — the completion write', () => {
  it('writes unappliedTranscript in the same update as the tokens, at 100% and before any apply', async () => {
    mockTranscribe.mockResolvedValue({ tokens: TOKENS, detectedLanguage: 'en' });
    const h = mountWhisper();
    let committed: Project | null = null;

    await act(async () => {
      await h.api().startTranscription(
        audioAsset(), 30, [], undefined, () => {},
        updater => { committed = updater(project()); },
      );
    });

    const rec = committed!.unappliedTranscript;
    expect(rec, 'no unappliedTranscript was written at completion').toBeDefined();
    expect(rec!.tokens).toEqual(TOKENS);
    expect(rec!.assetId).toBe('staged-asset-1');
    // The identity the recovery path actually compares on — `getFileIdentity`'s
    // `name|size|lastModified`, not the ephemeral asset id.
    expect(rec!.fileIdentity).toBe('vo.mp3|5|1700000000000');
    expect(Number.isNaN(Date.parse(rec!.completedAt))).toBe(false);
    // Same update, not a follow-up one.
    expect(committed!.transcriptTokens).toEqual(TOKENS);
    h.unmount();
  });

  it('fires onCompleted after the project update and before the terminal "done" status', async () => {
    mockTranscribe.mockResolvedValue({ tokens: TOKENS, detectedLanguage: 'en' });
    const h = mountWhisper();
    let committed: Project | null = null;
    const seenAtFlush: { hadRecord: boolean; phase: string }[] = [];

    await act(async () => {
      await h.api().startTranscription(
        audioAsset(), 30, [], undefined, () => {},
        updater => { committed = updater(project()); },
        {
          onCompleted: () => {
            seenAtFlush.push({
              hadRecord: committed?.unappliedTranscript !== undefined,
              phase: h.status().phase,
            });
          },
        },
      );
    });

    expect(seenAtFlush).toHaveLength(1);
    // The record already exists when the flush runs — otherwise the flush
    // would persist the project from before it, which is the whole failure
    // this hook exists to prevent.
    expect(seenAtFlush[0]!.hadRecord).toBe(true);
    // ...and 'done' has not been announced yet.
    expect(seenAtFlush[0]!.phase).not.toBe('done');
    h.unmount();
  });

  it('a flush failure does not turn a successful transcription into an error', async () => {
    mockTranscribe.mockResolvedValue({ tokens: TOKENS, detectedLanguage: 'en' });
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const h = mountWhisper();

    await act(async () => {
      await h.api().startTranscription(
        audioAsset(), 30, [], undefined, () => {}, () => {},
        { onCompleted: () => { throw new Error('disk full'); } },
      );
    });

    expect(h.status().phase).toBe('done');
    h.unmount();
  });

  it('writes NO record on the empty-token path — there is nothing to recover', async () => {
    mockTranscribe.mockResolvedValue({ tokens: [], detectedLanguage: undefined });
    const h = mountWhisper();
    const updates: Project[] = [];
    const onCompleted = vi.fn();

    await act(async () => {
      await h.api().startTranscription(
        audioAsset(), 30, [], undefined, () => {},
        updater => { updates.push(updater(project())); },
        { onCompleted },
      );
    });

    expect(updates).toHaveLength(0);
    expect(onCompleted).not.toHaveBeenCalled();
    expect(h.status().phase).toBe('warning');
    h.unmount();
  });

  it('falls back to the project’s stored identity when the asset carries no File', async () => {
    mockTranscribe.mockResolvedValue({ tokens: TOKENS, detectedLanguage: 'en' });
    const h = mountWhisper();
    let committed: Project | null = null;

    await act(async () => {
      await h.api().startTranscription(
        audioAsset(false), 30, [], undefined, () => {},
        updater => { committed = updater(project({ lastTranscribedFileIdentity: 'prior.mp3|9|9' })); },
      );
    });

    expect(committed!.unappliedTranscript!.fileIdentity).toBe('prior.mp3|9|9');
    h.unmount();
  });
});

describe('Requirement 5 — the completion write must not disturb language', () => {
  it('leaves an already-set sticky language alone', async () => {
    mockTranscribe.mockResolvedValue({ tokens: TOKENS, detectedLanguage: 'en' });
    const h = mountWhisper();
    let committed: Project | null = null;

    await act(async () => {
      await h.api().startTranscription(
        audioAsset(), 30, [], 'es', () => {},
        updater => { committed = updater(project({ language: 'es', detectedLanguage: 'es' })); },
      );
    });

    // H.7 stickiness is unchanged by T4.7: a detection never displaces a
    // stored language, and recording a recovery marker adds no second writer.
    expect(committed!.language).toBe('es');
    expect(committed!.unappliedTranscript).toBeDefined();
    h.unmount();
  });

  it('still lets an explicit completion fill an EMPTY language — T4.7 adds no new suppression', async () => {
    mockTranscribe.mockResolvedValue({ tokens: TOKENS, detectedLanguage: 'fr' });
    const h = mountWhisper();
    let committed: Project | null = null;

    await act(async () => {
      await h.api().startTranscription(
        audioAsset(), 30, [], undefined, () => {},
        updater => { committed = updater(project()); },
      );
    });

    expect(committed!.language).toBe('fr');
    expect(committed!.detectedLanguage).toBe('fr');
    h.unmount();
  });
});

describe('Requirement 4 — duplicate-run refusal', () => {
  /** A transcription that never settles, so a run stays genuinely in flight. */
  function hangingRun(): void {
    mockTranscribe.mockImplementation(() => new Promise(() => {}));
  }

  /** First call hangs (the run that holds the gate); every later call resolves
   *  normally, so a test can `await` the SECOND attempt. Needed because
   *  `startTranscription` only returns when its whole run is over — awaiting a
   *  call that legitimately started a hanging run would hang the test, and
   *  "it hung" is not the same observation as "it started". */
  function hangFirstThenResolve(): void {
    let n = 0;
    mockTranscribe.mockImplementation(() => {
      n += 1;
      return n === 1
        ? new Promise(() => {})
        : Promise.resolve({ tokens: TOKENS, detectedLanguage: 'en' });
    });
  }

  it('refuses a second attempt for the SAME project, with a message', async () => {
    hangingRun();
    const h = mountWhisper();
    let second: StartTranscriptionOutcome | null = null;

    await act(async () => {
      void h.api().startTranscription(
        audioAsset(), 30, [], undefined, () => {}, () => {}, { projectId: 'project-1' },
      );
    });
    await act(async () => {
      second = await h.api().startTranscription(
        audioAsset(), 30, [], undefined, () => {}, () => {}, { projectId: 'project-1' },
      );
    });

    expect(second!.started).toBe(false);
    expect(second).toMatchObject({ reason: 'already-running' });
    expect((second as unknown as { message: string }).message).toMatch(/already running/i);
    h.unmount();
  });

  it('a refusal is a true no-op — the live run keeps its progress status', async () => {
    // The refusal must not surface through `transcriptionStatus`: blanking a
    // live progress bar makes the refusal look like the failure of the run it
    // was protecting.
    let emitProgress: ((p: number) => void) | null = null;
    mockTranscribe.mockImplementation((_a, _d, _l, onProgress) => {
      emitProgress = onProgress as (p: number) => void;
      return new Promise(() => {});
    });
    const h = mountWhisper();

    await act(async () => {
      void h.api().startTranscription(
        audioAsset(), 30, [], undefined, () => {}, () => {}, { projectId: 'project-1' },
      );
    });
    await act(async () => { emitProgress!(42); });
    const before = h.status();

    await act(async () => {
      await h.api().startTranscription(
        audioAsset(), 30, [], undefined, () => {}, () => {}, { projectId: 'project-1' },
      );
    });

    expect(h.status()).toEqual(before);
    expect(h.status()).toMatchObject({ phase: 'transcribing', percent: 42 });
    // And the refused call did not abort the live run either — progress still
    // reaches the status after the refusal.
    await act(async () => { emitProgress!(77); });
    expect(h.status()).toMatchObject({ phase: 'transcribing', percent: 77 });
    h.unmount();
  });

  it('does NOT refuse a run for a different project — that path still cancels and restarts', async () => {
    hangFirstThenResolve();
    const h = mountWhisper();
    let second: StartTranscriptionOutcome | null = null;

    await act(async () => {
      void h.api().startTranscription(
        audioAsset(), 30, [], undefined, () => {}, () => {}, { projectId: 'project-1' },
      );
    });
    await act(async () => {
      second = await h.api().startTranscription(
        audioAsset(), 30, [], undefined, () => {}, () => {}, { projectId: 'project-2' },
      );
    });

    expect(second!.started).toBe(true);
    h.unmount();
  });

  it('releases the gate when the run finishes, so a later attempt is allowed', async () => {
    mockTranscribe.mockResolvedValue({ tokens: TOKENS, detectedLanguage: 'en' });
    const h = mountWhisper();
    let second: StartTranscriptionOutcome | null = null;

    await act(async () => {
      await h.api().startTranscription(
        audioAsset(), 30, [], undefined, () => {}, () => {}, { projectId: 'project-1' },
      );
    });
    await act(async () => {
      second = await h.api().startTranscription(
        audioAsset(), 30, [], undefined, () => {}, () => {}, { projectId: 'project-1' },
      );
    });

    expect(second!.started).toBe(true);
    h.unmount();
  });

  it('releases the gate on cancel, so a user who cancels can immediately retry', async () => {
    hangFirstThenResolve();
    const h = mountWhisper();
    let second: StartTranscriptionOutcome | null = null;

    await act(async () => {
      void h.api().startTranscription(
        audioAsset(), 30, [], undefined, () => {}, () => {}, { projectId: 'project-1' },
      );
    });
    act(() => { h.api().cancelTranscription(); });
    await act(async () => {
      second = await h.api().startTranscription(
        audioAsset(), 30, [], undefined, () => {}, () => {}, { projectId: 'project-1' },
      );
    });

    expect(second!.started).toBe(true);
    h.unmount();
  });

  it('an id-less caller is never refused — pre-T4.7 behaviour is unchanged', async () => {
    hangFirstThenResolve();
    const h = mountWhisper();
    let second: StartTranscriptionOutcome | null = null;

    await act(async () => {
      void h.api().startTranscription(audioAsset(), 30, [], undefined, () => {}, () => {});
    });
    await act(async () => {
      second = await h.api().startTranscription(audioAsset(), 30, [], undefined, () => {}, () => {});
    });

    expect(second!.started).toBe(true);
    h.unmount();
  });
});
