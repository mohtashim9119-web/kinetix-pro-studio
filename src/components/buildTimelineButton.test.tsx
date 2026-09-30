// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// ---------------------------------------------------------------------------
// Wave 3 U4.6 — the Build Timeline button and the silent-progress ruling,
// asserted on real mounts.
//
// OLD-BUG-FIRST. Each of these was run red against the pre-U4.6 tree:
//   - three filled slots (script + scene doc + voiceover, no media) left the
//     button ENABLED — the operator's product ruling needs all four;
//   - the purple 0–100% transcription bar RENDERED while transcribing.
// ---------------------------------------------------------------------------

import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { DropZonePanel } from './DropZonePanel';
import { TranscriptionBar } from './TranscriptionBar';
import { makeProps, type DropZonePanelProps } from './dropZonePanelTestProps';
import { deleteAllStagedForProject, putStagedFile } from '../services/stagedFilesStore';
import { ALL_PERSISTED_SLOTS, planStagedReconcile, toStoredRow } from '../services/stagedFilesPersist';
import { BUILD_TIMELINE_COPY } from '../services/buildTimelineGate';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const PROJECT = 'build-timeline-button-project';

let root: Root | null = null;
let container: HTMLDivElement | null = null;

afterEach(() => {
  if (root) act(() => { root!.unmount(); });
  container?.remove();
  root = null;
  container = null;
});

function mount(node: React.ReactElement): HTMLDivElement {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => { root!.render(node); });
  return container;
}

async function settle(): Promise<void> {
  await act(async () => { await new Promise(r => setTimeout(r, 25)); });
}

/** Stages a script file (so the run has something new to build from). */
async function stageScript(): Promise<void> {
  const next = {
    scriptFile: { file: new File(['Hello there.'], 'script.txt', { type: 'text/plain', lastModified: 7 }), key: 's-1' },
    sceneFile: null, voiceoverFile: null, assetFiles: [], zipFiles: [],
  };
  const plan = planStagedReconcile(
    { scriptFile: null, sceneFile: null, voiceoverFile: null, assetFiles: [], zipFiles: [] },
    next,
    ALL_PERSISTED_SLOTS,
  );
  for (const e of plan.write) await putStagedFile(await toStoredRow(PROJECT, e));
}

function buildButton(el: HTMLElement): HTMLButtonElement {
  const btn = [...el.querySelectorAll('button')]
    .find(b => /build timeline|timeline ready|already synced|transcribing/i.test(b.textContent ?? ''));
  expect(btn, 'no Build Timeline button rendered').toBeDefined();
  return btn as HTMLButtonElement;
}

async function mountPanel(overrides: Partial<DropZonePanelProps>): Promise<HTMLDivElement> {
  const el = mount(<DropZonePanel {...makeProps({ projectId: PROJECT, ...overrides })} />);
  await settle();
  return el;
}

describe('U9 — Build Timeline is spine-only (script + scene doc + voiceover); media is optional', () => {
  beforeEach(async () => { await deleteAllStagedForProject(PROJECT); });

  it('OLD BUG (U4.6 reversal): three spine slots and NO media → ENABLED, with the honest no-media hint', async () => {
    await stageScript();
    const el = await mountPanel({
      persistedSceneDetails: '[Scene 1] Intro', persistedSceneDetailsName: 'scenes.txt',
      persistedVoiceoverName: 'vo.m4a',
      persistedAssetCount: 0,
    });
    const btn = buildButton(el);
    expect(btn.disabled, 'Build Timeline is still disabled without media (the U4.6 four-slot gate)').toBe(false);
    expect(el.querySelector('[data-testid="build-timeline-no-media-hint"]')?.textContent).toBe(BUILD_TIMELINE_COPY.noMediaHint);
  });

  it('names every missing spine slot, in slot order — never media', async () => {
    await stageScript();
    const el = await mountPanel({ persistedAssetCount: 0 });
    expect(buildButton(el).title).toBe('Add scene doc and voiceover to build the timeline');
    expect(buildButton(el).disabled).toBe(true);
  });

  it('a missing script alone reads "Add script to build the timeline"', async () => {
    const el = await mountPanel({
      persistedSceneDetails: '[Scene 1] Intro', persistedSceneDetailsName: 'scenes.txt',
      persistedVoiceoverName: 'vo.m4a', persistedAssetCount: 3,
    });
    expect(buildButton(el).title).toBe('Add script to build the timeline');
  });

  it('spine + media → enabled, labelled Build Timeline, no no-media hint', async () => {
    await stageScript();
    const el = await mountPanel({
      persistedSceneDetails: '[Scene 1] Intro', persistedSceneDetailsName: 'scenes.txt',
      persistedVoiceoverName: 'vo.m4a',
      persistedAssetCount: 2,
    });
    const btn = buildButton(el);
    expect(btn.disabled).toBe(false);
    expect(btn.textContent).toContain(BUILD_TIMELINE_COPY.label);
    expect(el.querySelector('[data-testid="build-timeline-no-media-hint"]')).toBeNull();
  });

  it('the Media block is always visible — empty project shows it in its empty state', async () => {
    const el = await mountPanel({ persistedAssetCount: 0, assets: [] });
    expect(el.querySelector('[data-testid="media-block"]')).not.toBeNull();
    expect(el.querySelector('[data-testid="media-block-empty"]')).not.toBeNull();
  });
});

describe('U4.6 — progress is silent (the purple bar is gone), failures stay loud', () => {
  const noop = () => {};

  it('transcribing renders nothing', () => {
    const el = mount(
      <TranscriptionBar
        status={{ phase: 'transcribing', percent: 42, jobId: 'j' }}
        onCancel={noop} onDismiss={noop} onDownloadModel={noop}
      />,
    );
    expect(el.textContent, 'the purple transcription progress bar still renders (the pre-U4.6 bug)').toBe('');
  });

  it('an error still renders, assertively', () => {
    const el = mount(
      <TranscriptionBar
        status={{ phase: 'error', message: 'boom', jobId: 'j' }}
        onCancel={noop} onDismiss={noop} onDownloadModel={noop}
      />,
    );
    expect(el.querySelector('[role="alert"]')?.textContent).toContain('Transcription failed: boom');
  });

  it('a warning still renders', () => {
    const el = mount(
      <TranscriptionBar
        status={{ phase: 'warning', message: 'No speech was transcribed', jobId: 'j' }}
        onCancel={noop} onDismiss={noop} onDownloadModel={noop}
      />,
    );
    expect(el.textContent).toContain('No speech was transcribed');
  });
});
